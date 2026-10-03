/// Canonical Composition, external Item admission/ownership, and independent
/// post-activation Expansion Pack state for fresh Animacraft v8.
module animacraft_v8_runtime::runtime_v8;

use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::companion_binding_v2::{Self as companion, MakerRuntimeCompanionBindingBuilderV2};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCallCapV8,
    RuntimeRoleV8,
    ProductReleaseCatalogV8,
    FreshTupleReplacementBindingV2,
    RuntimeCallerCapV1,
};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8,
    ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::{Self as core_treasury, MakerAccessPassV8};
use animacraft_v8_core::soulidity_binding_v8 as native_binding;
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::balance::{Self as balance, Balance};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::dynamic_field as df;
use sui::table::{Self as table, Table};
use sui::transfer::Receiving;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_KEY_BYTES: u64 = 128;
const MAX_LOCATOR_BYTES: u64 = 512;
const MAX_MEDIA_TYPE_BYTES: u64 = 256;
const MAX_ASSET_BYTES: u64 = 12582912;
const MAX_PART_PROFILES: u64 = 750;
const MAX_PART_CAPACITY: u64 = 64;
const MAX_LOADOUT_SELECTIONS: u64 = 500;
const MAX_PACK_STYLES: u64 = 10_000;
const MAX_PRICE: u64 = 1_000_000_000_000;
const MAX_COMPLETE_COUNT: u64 = 1_000_000_000;
const BPS_DENOMINATOR: u128 = 10_000;

const WARDROBE_FIXED: u8 = 0;
const WARDROBE_SLOT: u8 = 1;

const BEHAVIOR_FIXED: u8 = 0;
const BEHAVIOR_SOUL_LOCAL: u8 = 1;
const BEHAVIOR_OPEN: u8 = 2;
const BEHAVIOR_HYBRID: u8 = 3;

const ADMISSION_DISABLED: u8 = 0;
const ADMISSION_CERTIFIED: u8 = 1;
const ADMISSION_OPEN: u8 = 2;

const SOURCE_BASE: u8 = 0;
const SOURCE_PACK: u8 = 1;
const SOURCE_EXTERNAL: u8 = 2;

#[test_only]
const RULE_REQUIRE: u8 = 0;
#[test_only]
const RULE_EXCLUDE: u8 = 1;

const ACCESS_FREE: u8 = 0;
const ACCESS_PAID: u8 = 1;
const ACCESS_INCLUDED_WITH_MAKER: u8 = 2;

const COMPLETE_UNLIMITED_FREE: u8 = 0;
const COMPLETE_FREE_QUOTA_THEN_PAID: u8 = 1;
const COMPLETE_PAID_EVERY_TIME: u8 = 2;
const COMPLETE_FREE_QUOTA_THEN_BLOCK: u8 = 3;

const PACK_DRAFT: u8 = 0;
const PACK_SEALED: u8 = 1;
const PACK_ACTIVE: u8 = 2;
const PACK_PAUSED: u8 = 3;
const PACK_ARCHIVED: u8 = 4;

const PRODUCT_ACTIVE: u8 = 0;
const PRODUCT_PAUSED: u8 = 1;
const PRODUCT_ARCHIVED: u8 = 2;

const ADMISSION_ACTIVE: u8 = 0;
const ADMISSION_REVOKED: u8 = 1;

const EInvalidBinding: u64 = 0;
const EInvalidCommitment: u64 = 1;
const EInvalidKey: u64 = 2;
const EInvalidCount: u64 = 3;
const EInvalidSequence: u64 = 4;
const EAlreadySealed: u64 = 5;
const ENotSealed: u64 = 6;
const EStaleRevision: u64 = 7;
const EWrongHolder: u64 = 8;
const EInvalidLifecycle: u64 = 9;
const EInvalidPolicy: u64 = 10;
const EDuplicate: u64 = 11;
const EMissing: u64 = 12;
const EPartOrder: u64 = 13;
const EFixedPart: u64 = 14;
const EAdmissionDenied: u64 = 15;
const EAttestationRequired: u64 = 16;
const EWrongPayment: u64 = 17;
const EEquipLocked: u64 = 18;
const ENotEquipped: u64 = 19;
const ERequiredPart: u64 = 20;
const EInvalidProof: u64 = 21;
const EProofOrder: u64 = 22;
const EPassMissing: u64 = 23;
const ECompleteBlocked: u64 = 24;
const EInsufficientRevenue: u64 = 25;
const EInvalidRecipient: u64 = 26;
const EAlreadyAdmitted: u64 = 27;
const ENotReady: u64 = 28;
const EWrongControl: u64 = 29;
const ERuleViolation: u64 = 30;
const EOwnedInstanceRequired: u64 = 31;
const EItemNotTransferable: u64 = 32;
const ERecipientAlreadyOwned: u64 = 33;
const EPackAccessAlreadyIssued: u64 = 34;
const EInvalidEquipmentMarketAuthority: u64 = 35;
const EInvalidEquipmentMarketCustody: u64 = 36;

/// Entry access is unique per holder, independent of completion quota.
public struct PackAccessKeyV8 has copy, drop, store { holder: address }

/// Stable package lineage markers used by Core and Seal exact-role checks.
public struct RuntimeOriginalMarkerV8 has drop {}

/// Only this package can prove installation of Runtime's unique setup cap.
public struct RuntimeSetupInstallWitnessV2 has drop {}

public(package) fun install_runtime_setup_v2(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<RuntimeRoleV8>,
    config_id: ID,
): vector<u8> {
    binding::consume_runtime_call_cap_v8(
        catalog, cap, RuntimeSetupInstallWitnessV2 {}, config_id)
}

public(package) fun assert_pack_complete_root_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    packs: &PackRegistryV8,
    loadout: &MakerLoadoutV8,
) {
    maker::assert_root_identity_v8(root, packs.root_id, packs.root_version,
        &packs.root_content_commitment);
    maker::assert_root_identity_v8(root, loadout.root_id, loadout.root_version,
        &loadout.root_content_commitment);
    assert!(loadout.pack_registry_id == object::id(packs), EInvalidBinding);
    assert!(companion::pack_registry_id_v2(maker::root_companion_registry_ids_v2(root))
        == object::id(packs), EInvalidBinding);
}
public struct RuntimeCallableMarkerV8 has drop {}

public struct PartProfileKeyV8 has copy, drop, store { part_key: String }
public struct PackStyleKeyV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}
public struct WalletKeyV8 has copy, drop, store { wallet: address }
public struct BaseItemHolderKeyV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    holder: address,
}

/// Immutable compiler-derived Runtime interpretation of one exact Core Part.
/// The opaque Core payload is included in the row commitment, never inferred.
public struct PartProfileV8 has copy, drop, store {
    index: u64,
    part_key: String,
    core_part_payload_commitment: vector<u8>,
    required: bool,
    wardrobe_mode: u8,
    behavior: u8,
    capacity: u64,
    admission_ceiling: u8,
    profile_commitment: vector<u8>,
}

/// Immutable Runtime definition registry. Write authority follows the exact
/// Core AdminCap/control epoch, but compatibility excludes that epoch.
public struct RuntimeDefinitionRegistryV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    base_registry_id: ID,
    expected_profile_count: u64,
    observed_profile_count: u64,
    expected_profile_commitment: vector<u8>,
    rolling_profile_commitment: vector<u8>,
    admission_ceiling: u8,
    item_assetization: bool,
    sealed: bool,
    profile_keys: vector<String>,
    profiles: Table<PartProfileKeyV8, PartProfileV8>,
}

/// Exact registry write authority ID frozen into Core. It carries no mutable
/// trust claims; every write also rechecks the current Core AdminCap.
public struct PackAdmissionAuthorityV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
}

public struct PackAdmissionRecordV8 has copy, drop, store {
    release_id: ID,
    semantic_pack_id: String,
    release_content_commitment: vector<u8>,
    admitted_revision: u64,
    admission_state: u8,
}

public struct ExternalAdmissionRecordV8 has copy, drop, store {
    product_id: ID,
    compatibility_commitment: vector<u8>,
    product_content_commitment: vector<u8>,
    attestation_commitment: Option<vector<u8>>,
    admitted_revision: u64,
    admission_state: u8,
}

public struct BaseItemOwnershipRecordV8 has copy, drop, store {
    item_id: ID,
    ownership_epoch: u64,
}

/// Mutable post-activation Pack and external-product admission registry.
/// Revision is the sole mutation CAS; no mutable set enters Root content.
public struct PackRegistryV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    definition_registry_id: ID,
    admission_authority_id: ID,
    admission_policy_commitment: vector<u8>,
    revision: u64,
    release_count: u64,
    external_admission_count: u64,
    wardrobe_revision: u64,
    base_item_count: u64,
    releases: Table<ID, PackAdmissionRecordV8>,
    semantic_releases: Table<String, ID>,
    external_admissions: Table<ID, ExternalAdmissionRecordV8>,
    base_item_owners: Table<BaseItemHolderKeyV8, BaseItemOwnershipRecordV8>,
}

/// Same-transaction proof that the initial Runtime registry tuple is exact,
/// sealed, and has zero mutable post-activation admission rows.
public struct MakerCompanionBindingWitnessV2 has drop {}

public struct RuntimeActivationReadinessReceiptV8 {
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    definition_registry_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
    companion_commitment: vector<u8>,
}

/// Definition scopes match Core semantic sources, NOT Runtime selection classes.
/// PACK_SELF binds to this exact Release, never a globally looked-up Pack name.
public struct PackStyleDefinitionSourcesV8 has copy, drop, store {
    part: u8,
    track: u8,
    color: Option<u8>,
}

public fun new_pack_style_definition_sources_v8(
    part: u8, track: u8, color: Option<u8>,
): PackStyleDefinitionSourcesV8 {
    assert!(part == 1 || part == 2, EInvalidPolicy);
    assert!(track == 1 || track == 2, EInvalidPolicy);
    if (color.is_some()) assert!(*color.borrow() == 1 || *color.borrow() == 2, EInvalidPolicy);
    PackStyleDefinitionSourcesV8 { part, track, color }
}

fun pack_definition_source_id<PaymentCoin>(release: &PackReleaseV8<PaymentCoin>, source: u8): ID {
    assert!(source == 1 || source == 2, EInvalidPolicy);
    if (source == 1) release.root_id else object::id(release)
}

public struct PackStyleV8 has copy, drop, store {
    index: u64,
    definition_sources: PackStyleDefinitionSourcesV8,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_content_commitment: vector<u8>,
    protected: bool,
    seal_binding_commitment: vector<u8>,
    style_commitment: vector<u8>,
}

public struct PackDefinitionsKeyV8 has copy, drop, store {}
public struct PackDefinitionsDraftKeyV8 has copy, drop, store {}
public struct PackColorDraftKeyV8 has copy, drop, store {}
public struct PackDefinitionsDraftV8 has store {
    next_chunk: u64,
    expected_commitment: vector<u8>,
    rows: base::PackDefinitionRowsV2,
}
public struct PackDefinitionsV8 has copy, drop, store {
    version: u64,
    release_id: ID,
    release_content_commitment: vector<u8>,
    rows: base::PackDefinitionRowsV2,
    commitment: vector<u8>,
}
public struct PackDefinitionsCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, release_id: ID,
    release_content_commitment: vector<u8>, rows: base::PackDefinitionRowsV2,
}

/// One-time immutable attachment by the exact draft owner. No style may already
/// have been appended against a different definition universe.
public fun register_pack_definitions_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    rows: base::PackDefinitionRowsV2, expected_commitment: vector<u8>, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT, EInvalidLifecycle);
    assert!(release.observed_style_count == 0, EInvalidCount);
    assert!(!df::exists(&release.id, PackDefinitionsDraftKeyV8 {}), EInvalidPolicy);
    assert!(!df::exists(&release.id, PackDefinitionsKeyV8 {}), EDuplicate);
    assert!(base::pack_semantic_id_v2(&rows) == &release.semantic_pack_id, EInvalidBinding);
    assert_pack_reference_source(base_registry, release, release.root_id);
    base::assert_pack_additive_definitions_v2(base_registry, &rows);
    let release_id = object::id(release);
    let commitment = pack_definitions_commitment_v8(release_id, release.content_commitment, &rows);
    assert!(commitment == expected_commitment, EInvalidCommitment);
    df::add(&mut release.id, PackDefinitionsKeyV8 {}, PackDefinitionsV8 {
        version: VERSION, release_id, release_content_commitment: release.content_commitment,
        rows, commitment,
    });
}

/// Draft chunks are never returned by pack_definitions_v8. Finalization reuses
/// the exact one-time registration authority and full-content commitment.
public fun begin_pack_definitions_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8,
    expected_commitment: vector<u8>, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT, EInvalidLifecycle);
    assert!(release.observed_style_count == 0, EInvalidCount);
    assert!(expected_commitment.length() == 32, EInvalidCommitment);
    assert!(!df::exists(&release.id, PackDefinitionsKeyV8 {})
        && !df::exists(&release.id, PackDefinitionsDraftKeyV8 {}), EDuplicate);
    let rows = base::new_pack_definition_rows_v2(release.semantic_pack_id,
        vector[], vector[], vector[], vector[], vector[]);
    df::add(&mut release.id, PackDefinitionsDraftKeyV8 {},
        PackDefinitionsDraftV8 { next_chunk: 0, expected_commitment, rows });
}

public fun append_pack_definitions_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, expected_chunk: u64,
    tracks: vector<base::TrackRowV2>, colors: vector<base::ColorChannelRowV2>,
    parts: vector<base::PartRowV2>, rules: vector<base::RuleRowV2>,
    visibility: vector<base::PackVisibilityRowV2>, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT, EInvalidLifecycle);
    assert!(release.observed_style_count == 0, EInvalidCount);
    assert!(!df::exists(&release.id, PackColorDraftKeyV8 {}), EInvalidPolicy);
    let draft: &mut PackDefinitionsDraftV8 = df::borrow_mut(&mut release.id, PackDefinitionsDraftKeyV8 {});
    assert!(draft.next_chunk == expected_chunk, EInvalidSequence);
    base::append_pack_definition_rows_v2(&mut draft.rows, tracks, colors, parts, rules, visibility);
    draft.next_chunk = draft.next_chunk + 1;
}

public fun finalize_pack_definitions_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, expected_chunks: u64, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(!df::exists(&release.id, PackColorDraftKeyV8 {}), EInvalidPolicy);
    let PackDefinitionsDraftV8 { next_chunk, expected_commitment, rows } =
        df::remove(&mut release.id, PackDefinitionsDraftKeyV8 {});
    assert!(next_chunk == expected_chunks, EInvalidSequence);
    register_pack_definitions_v8(release, cap, base_registry, rows, expected_commitment, ctx);
}

public fun begin_pack_color_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, expected_chunk: u64,
    sequence: u64, key: String, label: String, default_swatch_key: String, expected_swatches: u64, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT && release.observed_style_count == 0, EInvalidPolicy);
    assert!(!df::exists(&release.id, PackColorDraftKeyV8 {}), EDuplicate);
    let draft: &mut PackDefinitionsDraftV8 = df::borrow_mut(&mut release.id, PackDefinitionsDraftKeyV8 {});
    assert!(draft.next_chunk == expected_chunk && base::pack_colors_v2(&draft.rows).length() == sequence, EInvalidSequence);
    draft.next_chunk = draft.next_chunk + 1;
    let color = base::new_color_channel_draft_v2(sequence, key, label, default_swatch_key, expected_swatches);
    df::add(&mut release.id, PackColorDraftKeyV8 {}, color);
}

public fun append_pack_color_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, expected_chunk: u64,
    expected_start: u64, swatches: vector<base::ColorSwatchV2>, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT && release.observed_style_count == 0, EInvalidPolicy);
    let draft: &mut PackDefinitionsDraftV8 = df::borrow_mut(&mut release.id, PackDefinitionsDraftKeyV8 {});
    assert!(draft.next_chunk == expected_chunk, EInvalidSequence);
    draft.next_chunk = draft.next_chunk + 1;
    let color: &mut base::ColorChannelDraftV2 = df::borrow_mut(&mut release.id, PackColorDraftKeyV8 {});
    base::append_color_channel_draft_v2(color, expected_start, swatches);
}

public fun finish_pack_color_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, expected_chunk: u64, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT && release.observed_style_count == 0, EInvalidPolicy);
    let row = base::finish_color_channel_draft_v2(df::remove(&mut release.id, PackColorDraftKeyV8 {}));
    let draft: &mut PackDefinitionsDraftV8 = df::borrow_mut(&mut release.id, PackDefinitionsDraftKeyV8 {});
    assert!(draft.next_chunk == expected_chunk, EInvalidSequence);
    base::append_pack_definition_rows_v2(&mut draft.rows, vector[], vector[row], vector[], vector[], vector[]);
    draft.next_chunk = draft.next_chunk + 1;
}

public fun pack_definitions_commitment_v8(
    release_id: ID, release_content_commitment: vector<u8>, rows: &base::PackDefinitionRowsV2,
): vector<u8> {
    assert_hash(&release_content_commitment);
    hash::sha2_256(bcs::to_bytes(&PackDefinitionsCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/pack-definitions", version: VERSION,
        release_id, release_content_commitment, rows: *rows,
    }))
}

public fun pack_definitions_v8<PaymentCoin>(release: &PackReleaseV8<PaymentCoin>): &PackDefinitionsV8 {
    df::borrow(&release.id, PackDefinitionsKeyV8 {})
}

/// Resolves a definition's exact identity, not an entitlement. Draft authoring
/// uses the same lookup; selection must separately require admission/lifecycle.
fun assert_pack_reference_source<PaymentCoin>(
    base_registry: &BaseDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    source_definition_id: ID,
) {
    assert!(base::registry_sealed_v2(base_registry), ENotSealed);
    assert!(base::registry_root_id_v2(base_registry) == release.root_id
        && base::registry_maker_version_v2(base_registry) == release.root_version
        && base::registry_root_content_commitment_v2(base_registry)
            == &release.root_content_commitment, EInvalidBinding);
    assert!(source_definition_id == release.root_id
        || source_definition_id == object::id(release), EInvalidBinding);
    if (source_definition_id == object::id(release)) {
        let owned = pack_definitions_v8(release);
        assert!(owned.version == VERSION && owned.release_id == object::id(release)
            && owned.release_content_commitment == release.content_commitment
            && base::pack_semantic_id_v2(&owned.rows) == &release.semantic_pack_id, EInvalidBinding);
    };
}

public fun resolve_pack_track_v8<PaymentCoin>(
    base_registry: &BaseDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    source_definition_id: ID, key: String,
): &base::TrackRowV2 {
    assert_pack_reference_source(base_registry, release, source_definition_id);
    if (source_definition_id == release.root_id) base::borrow_track_v2(base_registry, key)
    else base::borrow_pack_track_v2(&pack_definitions_v8(release).rows, key)
}

public fun resolve_pack_part_v8<PaymentCoin>(
    base_registry: &BaseDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    source_definition_id: ID, key: String,
): &base::PartRowV2 {
    assert_pack_reference_source(base_registry, release, source_definition_id);
    if (source_definition_id == release.root_id) base::borrow_part_v2(base_registry, key)
    else base::borrow_pack_part_v2(&pack_definitions_v8(release).rows, key)
}

public fun resolve_pack_color_v8<PaymentCoin>(
    base_registry: &BaseDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    source_definition_id: ID, channel_key: String, swatch_key: String,
): &base::ColorSwatchV2 {
    assert_pack_reference_source(base_registry, release, source_definition_id);
    if (source_definition_id == release.root_id) base::borrow_color_v2(base_registry, channel_key, swatch_key)
    else base::borrow_pack_color_v2(&pack_definitions_v8(release).rows, channel_key, swatch_key)
}

/// Derived from immutable owned rows and the sealed parent policy. No separate
/// mutable profile registry can reinterpret a previously attached Pack slot.
public fun pack_part_profiles_v8<PaymentCoin>(
    definitions: &RuntimeDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
): vector<PartProfileV8> {
    assert!(definitions.sealed, ENotSealed);
    assert!(definitions.version == VERSION && definitions.root_id == release.root_id
        && definitions.root_version == release.root_version
        && definitions.root_content_commitment == release.root_content_commitment, EInvalidBinding);
    let owned = pack_definitions_v8(release);
    assert!(owned.version == VERSION && owned.release_id == object::id(release)
        && owned.release_content_commitment == release.content_commitment, EInvalidBinding);
    let mut profiles = vector[];
    let mut rolling = empty_profile_commitment_v8(release.content_commitment);
    base::pack_parts_v2(&owned.rows).do_ref!(|row| {
        let (key, sequence, required, payload) = base::part_identity_terms_v2(row);
        let (mode, capacity) = base::part_slot_terms_v2(row);
        assert!(!required && sequence == profiles.length(), EInvalidPolicy);
        // Same authoring mapping as Base: FIXED -> fixed; SLOT -> soul-local
        // when admission is closed, otherwise hybrid. No new author policy.
        let behavior = if (mode == WARDROBE_FIXED) BEHAVIOR_FIXED
            else if (definitions.admission_ceiling == ADMISSION_DISABLED) BEHAVIOR_SOUL_LOCAL
            else BEHAVIOR_HYBRID;
        rolling = advance_profile_commitment_v8(release.content_commitment, sequence,
            rolling, *key, *payload, required, mode, behavior, capacity, definitions.admission_ceiling);
        profiles.push_back(PartProfileV8 { index: sequence, part_key: *key,
            core_part_payload_commitment: *payload, required, wardrobe_mode: mode,
            behavior, capacity, admission_ceiling: definitions.admission_ceiling,
            profile_commitment: rolling });
    });
    profiles
}

public struct PackReleaseV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    creator: address,
    owner: address,
    control_epoch: u64,
    admin_cap_id: ID,
    treasury_id: ID,
    semantic_pack_id: String,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    lifecycle: u8,
    access_kind: u8,
    access_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    expected_style_count: u64,
    observed_style_count: u64,
    expected_style_commitment: vector<u8>,
    rolling_style_commitment: vector<u8>,
    protected_style_count: u64,
    pass_count: u64,
    total_complete_count: u64,
    styles: Table<PackStyleKeyV8, PackStyleV8>,
    complete_by_wallet: Table<WalletKeyV8, u64>,
}

public struct PackAdminCapV8 has key {
    id: UID,
    version: u64,
    release_id: ID,
    owner: address,
    control_epoch: u64,
}

public struct PackTreasuryV8<phantom PaymentCoin> has key {
    id: UID,
    version: u64,
    release_id: ID,
    revenue: Balance<PaymentCoin>,
    total_collected: u64,
    total_withdrawn: u64,
}

/// Holder entitlement binds immutable Maker compatibility, never Maker or
/// Pack control epoch. Control resale therefore does not erase access.
public struct PackPassV8 has key {
    id: UID,
    version: u64,
    release_id: ID,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    holder: address,
    paid_atomic: u64,
    issued_at_ms: u64,
    commitment: vector<u8>,
}

/// No-ability line item consumed by Output. Policy counters are incremented
/// atomically before this value is returned.
public struct PackCompleteLineV8 {
    release_id: ID,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    holder: address,
    ordinal: u64,
    price_atomic: u64,
}

public struct ExternalItemProductV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    creator: address,
    owner: address,
    control_epoch: u64,
    admin_cap_id: ID,
    lifecycle: u8,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_media_type: String,
    asset_byte_length: u64,
    asset_content_commitment: vector<u8>,
    compatibility_commitment: vector<u8>,
    content_commitment: vector<u8>,
    transferable: bool,
    supply: u64,
}

public struct ExternalItemAdminCapV8 has key {
    id: UID,
    version: u64,
    product_id: ID,
    owner: address,
    control_epoch: u64,
}

public struct EquipLockV8 has copy, drop, store {
    loadout_id: ID,
    equip_revision: u64,
    selection_index: u64,
}

public struct OwnedExternalItemV8 has key {
    id: UID,
    version: u64,
    product_id: ID,
    product_content_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
    holder: address,
    ownership_epoch: u64,
    transferable: bool,
    equip_lock: Option<EquipLockV8>,
}

/// Transferable official Base Item instance. The holder may choose any Style
/// belonging to the exact immutable Item, but the object can be locked to only
/// one Maker loadout slot at a time.
public struct OwnedBaseItemV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    definition_registry_id: ID,
    pack_registry_id: ID,
    base_registry_id: ID,
    part_key: String,
    item_key: String,
    item_payload_commitment: vector<u8>,
    holder: address,
    ownership_epoch: u64,
    transferable: bool,
    equip_lock: Option<EquipLockV8>,
}

/// Frozen readback, not authority. Releasing the child also requires Market's
/// private installed caller cap, the exact live registry/treasury and parent UID.
/// The full pre-custody object commitment preserves all content and ownership
/// fields without adding a second transferable equipment identity.
public struct EquipmentMarketCustodyBindingV8 has copy, drop, store {
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    market_authority_id: ID,
    market_registry_id: ID,
    market_treasury_id: ID,
    listing_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    asset_id: ID,
    asset_kind: u8,
    source_id: ID,
    asset_commitment: vector<u8>,
    holder: address,
    ownership_epoch: u64,
}

/// Must be consumed by the caller in the same custody transaction.
public struct EquipmentMarketCustodyTicketV8 {
    binding: EquipmentMarketCustodyBindingV8,
}

public struct EquipmentMarketCustodyTransitionV8 has copy, drop {
    action: u8,
    listing_id: ID,
    asset_id: ID,
    asset_kind: u8,
    source_id: ID,
    previous_holder: address,
    holder: address,
    previous_ownership_epoch: u64,
    ownership_epoch: u64,
    asset_commitment: vector<u8>,
}

/// Catalog-authority attestation for CERTIFIED admission. No caller boolean
/// can substitute for this no-ability value.
public struct ExternalItemAttestationV8 {
    catalog_id: ID,
    product_id: ID,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    compatibility_commitment: vector<u8>,
    product_content_commitment: vector<u8>,
    attestation_commitment: vector<u8>,
}

/// Canonical current selection. Every field participates in the current-state
/// loadout commitment, including exact Style/Track/color/asset/access binding.
public struct LoadoutSelectionV8 has copy, drop, store {
    selection_index: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    color_channel_key: Option<String>,
    swatch_key: Option<String>,
    layer_track_key: String,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_content_commitment: vector<u8>,
    source_class: u8,
    source_definition_id: ID,
    source_semantic_id: String,
    access_subject: ID,
    source_epoch: u64,
    pricing_commitment: vector<u8>,
    protected: bool,
    seal_binding_commitment: vector<u8>,
}

/// A committed Part range belongs to one exact definition, not a bare local key.
/// Base ranges name the Maker Root; Pack-owned ranges name the Pack Release.
public struct DefinitionSlotV8 has copy, drop, store {
    source_definition_id: ID,
    part_key: String,
    profile_commitment: vector<u8>,
    start: u64,
    capacity: u64,
}

/// Explicit enrollment survives even when a Pack adds no Parts or no selected
/// Style. Definition commitment already binds exact Release ID/content/rows.
public struct AttachedPackDefinitionV8 has copy, drop, store {
    release_id: ID,
    definition_commitment: vector<u8>,
}

public struct MakerLoadoutV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    definition_registry_id: ID,
    pack_registry_id: ID,
    maker_access_pass_id: ID,
    maker_access_commitment: vector<u8>,
    holder: address,
    revision: u64,
    attached_pack_definitions: vector<AttachedPackDefinitionV8>,
    definition_slots: vector<DefinitionSlotV8>,
    selections: vector<Option<LoadoutSelectionV8>>,
    selection_count: u64,
    commitment: vector<u8>,
}

/// Soul equipment reuses the same selections and instance locks, but is not a
/// wallet's temporary Player loadout. This field leaves its BCS layout intact.
public struct SoulEquipmentKeyV8 has copy, drop, store {}

/// Persistent layout identity, NOT an owner authorization. The owner binding is
/// temporarily removed by the atomic-update guard; this marker must survive it.
public struct SoulEquipmentLayoutKeyV8 has copy, drop, store {}

#[test]
fun soul_equipment_key_bcs_matches_client() {
    assert!(bcs::to_bytes(&SoulEquipmentKeyV8 {}) == vector[0], 100);
}
public struct SoulEquipmentBindingV8 has copy, drop, store {
    soul_id: ID,
    soul_state_id: ID,
    holder: address,
    ownership_epoch: u64,
    protocol_config_id: ID,
}
public struct SoulEquipmentOwnerClaimV8 has drop {
    soul_id: ID, soul_state_id: ID, holder: address, ownership_epoch: u64,
}
/// No abilities: all mutations in one transaction must finish by validating the
/// final selected visibility and restoring this exact binding. Intermediate
/// replacement states may be invalid; the guard cannot be stored or discarded.
public struct SoulEquipmentUpdateV8 {
    loadout_id: ID,
    binding: SoulEquipmentBindingV8,
}
public struct SoulEquipmentChangedV8 has copy, drop {
    soul_id: ID, soul_state_id: ID, loadout_id: ID, holder: address,
    ownership_epoch: u64, revision: u64, selection_count: u64, commitment: vector<u8>,
}

/// Individual same-transaction proof. It has no abilities and must be ordered
/// and sealed into one RuntimeLoadoutAuthorizationV8 before Output can use it.
public struct SelectionAccessProofV8 {
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    selection_index: u64,
    selection_commitment: vector<u8>,
    source_class: u8,
    source_definition_id: ID,
    source_semantic_id: String,
    source_content_commitment: vector<u8>,
    source_epoch: u64,
    pricing_commitment: vector<u8>,
}

/// Transaction-local, non-droppable evidence for one exact attachment. The
/// private mode bit prevents content-only equipment evidence authorizing Complete.
public struct PackDefinitionProofV8 {
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    binding_index: u64,
    release_id: ID,
    definition_commitment: vector<u8>,
    profiles: vector<PartProfileV8>,
    completion_checked: bool,
}

/// One-use bridge from an entitlement-checked selection proof to Output's
/// Physical materialization boundary. It binds the exact current selection;
/// no caller-provided identity or commitment is authoritative.
public struct RuntimePhysicalSelectionWitnessV8 {
    loadout_id: ID,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    selection_index: u64,
    selection_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    source_class: u8,
    source_definition_id: ID,
    source_semantic_id: String,
    source_content_commitment: vector<u8>,
    source_epoch: u64,
    pricing_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
}

/// Physical-only, same-transaction proof for registering one immutable Pack
/// Style policy after Maker activation. Every identity is read from the live
/// admitted Release, its exact current Pack control objects, and the exact
/// Style row. The value has no abilities and cannot become an ID-only policy
/// authority.
public struct RuntimePhysicalPackPolicyWitnessV8 {
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    pack_registry_id: ID,
    pack_registry_revision: u64,
    release_id: ID,
    semantic_pack_id: String,
    release_content_commitment: vector<u8>,
    pack_owner: address,
    pack_control_epoch: u64,
    pack_admin_cap_id: ID,
    pack_treasury_id: ID,
    style_index: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_content_commitment: vector<u8>,
    protected: bool,
    seal_binding_commitment: vector<u8>,
    style_commitment: vector<u8>,
    style_identity_commitment: vector<u8>,
}

/// Physical-only live Pack access proof. It re-reads the current loadout,
/// active admission, active Release, exact holder Pass, and exact Style row.
/// Physical compares this no-ability value with its independently consumed
/// Runtime/Output selection witness before issuing an asset.
public struct RuntimePhysicalPackAccessWitnessV8 {
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    pack_registry_id: ID,
    pack_registry_revision: u64,
    release_id: ID,
    semantic_pack_id: String,
    release_content_commitment: vector<u8>,
    pack_treasury_id: ID,
    pack_pass_id: ID,
    pack_pass_commitment: vector<u8>,
    loadout_id: ID,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    selection_index: u64,
    selection_commitment: vector<u8>,
    pricing_commitment: vector<u8>,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    asset_content_commitment: vector<u8>,
    style_identity_commitment: vector<u8>,
}

public struct UsedPackV8 has copy, drop, store {
    release_id: ID,
    semantic_pack_id: String,
    release_content_commitment: vector<u8>,
    pricing_commitment: vector<u8>,
}

public struct RuntimeLoadoutAuthorizationV8 {
    loadout_id: ID,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    loadout_revision: u64,
    loadout_commitment: vector<u8>,
    selection_count: u64,
    ordered_selection_commitments: vector<vector<u8>>,
    ordered_pricing_commitments: vector<vector<u8>>,
    used_packs: vector<UsedPackV8>,
}

/// Private Runtime witness round-tripped through Seal. Seal validates this
/// type's exact frozen Runtime package origin but cannot inspect or forge it.
public struct RuntimeBaseEntitlementWitnessV8 {
    loadout_id: ID,
    loadout_revision: u64,
    selection_index: u64,
    holder: address,
    entitlement_id: ID,
    entitlement_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
}

/// Pack variant additionally binds the exact live admitted Release and Pass.
public struct RuntimePackEntitlementWitnessV8 {
    loadout_id: ID,
    loadout_revision: u64,
    selection_index: u64,
    holder: address,
    pack_release_id: ID,
    pack_content_commitment: vector<u8>,
    pack_pass_id: ID,
    pack_pass_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
}

public struct RuntimePackRegistrationWitnessV8 {
    release_id: ID,
    release_content_commitment: vector<u8>,
    sequence: u64,
    definition_sources: PackStyleDefinitionSourcesV8,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_content_commitment: vector<u8>,
}

public struct PartProfileCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_content_commitment: vector<u8>,
    sequence: u64, previous: vector<u8>, part_key: String,
    core_part_payload_commitment: vector<u8>, required: bool,
    wardrobe_mode: u8, behavior: u8, capacity: u64, admission_ceiling: u8,
}
public struct RuntimePolicyCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_content_commitment: vector<u8>,
    profile_count: u64, profile_commitment: vector<u8>, admission_ceiling: u8,
    item_assetization: bool,
}
public struct RuntimeReadinessCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, root_version: u64,
    root_content_commitment: vector<u8>, definition_registry_id: ID,
    definition_profile_count: u64, definition_profile_commitment: vector<u8>,
    pack_registry_id: ID, pack_registry_revision: u64,
    pack_release_count: u64, external_admission_count: u64,
    wardrobe_revision: u64, base_item_count: u64,
    admission_authority_id: ID, policy_commitment: vector<u8>,
}
public struct OwnedBaseItemCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, item_id: ID,
    root_id: ID, root_version: u64, root_content_commitment: vector<u8>,
    definition_registry_id: ID, pack_registry_id: ID, base_registry_id: ID,
    part_key: String, item_key: String, item_payload_commitment: vector<u8>,
    holder: address, ownership_epoch: u64,
}
public struct MakerAccessEntitlementCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, pass_id: ID, root_id: ID,
    maker_version: u64, root_content_commitment: vector<u8>, holder: address,
    paid_atomic: u64, issued_at_ms: u64,
}
public struct EmptyCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_content_commitment: vector<u8>,
}
public struct PackEmptyCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
}
public struct PackStyleCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>, sequence: u64, previous: vector<u8>,
    style: PackStyleV8,
}
public struct LoadoutCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, root_version: u64,
    root_content_commitment: vector<u8>, attached_pack_definitions: vector<AttachedPackDefinitionV8>,
    definition_slots: vector<DefinitionSlotV8>,
    selections: vector<Option<LoadoutSelectionV8>>,
}
public struct SelectionCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, selection: LoadoutSelectionV8,
}
public struct PricingCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, release_id: ID,
    release_content_commitment: vector<u8>, access_kind: u8,
    access_price_atomic: u64, complete_mode: u8, complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64, complete_total_cap: u64,
}
public struct ExternalProductCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, root_version: u64,
    root_content_commitment: vector<u8>, profile_commitment: vector<u8>,
    part_key: String, item_key: String, style_key: String, layer_track_key: String,
    color_channel_key: Option<String>, default_swatch_key: Option<String>,
    asset_blob_id: String, asset_sha256: vector<u8>,
    asset_media_type: String, asset_byte_length: u64,
    asset_content_commitment: vector<u8>, transferable: bool,
}
public struct AttestationCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, catalog_id: ID, product_id: ID,
    root_id: ID, root_version: u64, root_content_commitment: vector<u8>,
    compatibility_commitment: vector<u8>, product_content_commitment: vector<u8>,
}
public struct ExternalContentCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, compatibility_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
}
public struct PackPassCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, release_id: ID, root_id: ID,
    root_version: u64, root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>, holder: address,
    paid_atomic: u64, issued_at_ms: u64,
}
public struct PhysicalPackStyleIdentityInputV8 has drop {
    domain: vector<u8>, version: u64,
    root_id: ID, root_version: u64,
    root_content_commitment: vector<u8>,
    pack_registry_id: ID, release_id: ID,
    semantic_pack_id: String, release_content_commitment: vector<u8>,
    pack_treasury_id: ID, style: PackStyleV8,
}
public struct SealBindingCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, registry_id: ID,
    registry_commitment: vector<u8>, runtime_revision: u64,
    runtime_commitment: vector<u8>, policy_config_id: ID,
    policy_commitment: vector<u8>, root_id: ID, root_version: u64,
    root_content_commitment: vector<u8>, scope_kind: u8, scope_key: String,
    scope_commitment: vector<u8>, asset_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>, seal_id: vector<u8>,
}

public struct RuntimeRegistriesCreatedV8 has copy, drop {
    root_id: ID, definition_registry_id: ID, pack_registry_id: ID,
    admission_authority_id: ID,
}
public struct PackRegistryRevisionAdvancedV8 has copy, drop {
    root_id: ID, previous_revision: u64, revision: u64, subject_id: ID, operation: u8,
}
public struct PackLifecycleChangedV8 has copy, drop {
    release_id: ID, previous_lifecycle: u8, lifecycle: u8,
}
public struct ExternalItemEquipChangedV8 has copy, drop {
    item_id: ID, loadout_id: ID, revision: u64, equipped: bool,
}
public struct BaseItemOwnershipChangedV8 has copy, drop {
    item_id: ID, part_key: String, item_key: String,
    previous_holder: Option<address>, holder: address, ownership_epoch: u64,
}
public struct BaseItemEquipChangedV8 has copy, drop {
    item_id: ID, loadout_id: ID, revision: u64, equipped: bool,
}

public fun version_v8(): u64 { VERSION }
public fun wardrobe_fixed_v8(): u8 { WARDROBE_FIXED }
public fun wardrobe_slot_v8(): u8 { WARDROBE_SLOT }
public fun behavior_fixed_v8(): u8 { BEHAVIOR_FIXED }
public fun behavior_soul_local_v8(): u8 { BEHAVIOR_SOUL_LOCAL }
public fun behavior_open_v8(): u8 { BEHAVIOR_OPEN }
public fun behavior_hybrid_v8(): u8 { BEHAVIOR_HYBRID }
public fun admission_disabled_v8(): u8 { ADMISSION_DISABLED }
public fun admission_certified_v8(): u8 { ADMISSION_CERTIFIED }
public fun admission_open_v8(): u8 { ADMISSION_OPEN }
public fun source_base_v8(): u8 { SOURCE_BASE }
public fun source_pack_v8(): u8 { SOURCE_PACK }
public fun source_external_v8(): u8 { SOURCE_EXTERNAL }
public fun access_free_v8(): u8 { ACCESS_FREE }
public fun access_paid_v8(): u8 { ACCESS_PAID }
public fun access_included_with_maker_v8(): u8 { ACCESS_INCLUDED_WITH_MAKER }
public fun pack_draft_v8(): u8 { PACK_DRAFT }
public fun pack_sealed_v8(): u8 { PACK_SEALED }
public fun pack_active_v8(): u8 { PACK_ACTIVE }
public fun pack_paused_v8(): u8 { PACK_PAUSED }
public fun pack_archived_v8(): u8 { PACK_ARCHIVED }

public fun base_seal_scope_key_v8(): String { b"maker/base".to_string() }

public fun pack_seal_scope_key_v8(semantic_pack_id: String): String {
    assert_key(&semantic_pack_id);
    let mut bytes = b"pack/";
    bytes.append(semantic_pack_id.into_bytes());
    bytes.to_string()
}

public fun style_seal_asset_key_v8(
    part_key: String, item_key: String, style_key: String,
): String {
    assert_key(&part_key);
    assert_key(&item_key);
    assert_key(&style_key);
    let mut bytes = part_key.into_bytes();
    bytes.push_back(47);
    bytes.append(item_key.into_bytes());
    bytes.push_back(47);
    bytes.append(style_key.into_bytes());
    bytes.to_string()
}

public fun seal_binding_commitment_v8(
    registry_id: ID,
    registry_commitment: vector<u8>,
    runtime_revision: u64,
    runtime_commitment: vector<u8>,
    policy_config_id: ID,
    policy_commitment: vector<u8>,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
    seal_id: vector<u8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&SealBindingCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/seal-binding",
        version: VERSION,
        registry_id,
        registry_commitment,
        runtime_revision,
        runtime_commitment,
        policy_config_id,
        policy_commitment,
        root_id,
        root_version,
        root_content_commitment,
        scope_kind,
        scope_key,
        scope_commitment,
        asset_key,
        asset_content_commitment,
        ciphertext_blob_id,
        ciphertext_sha256,
        ciphertext_blob_commitment,
        certification_commitment,
        seal_id,
    }))
}

public fun empty_profile_commitment_v8(root_content_commitment: vector<u8>): vector<u8> {
    assert_hash(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&EmptyCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/part-profiles-empty",
        version: VERSION,
        root_content_commitment,
    }))
}

public fun advance_profile_commitment_v8(
    root_content_commitment: vector<u8>, sequence: u64, previous: vector<u8>,
    part_key: String, core_part_payload_commitment: vector<u8>, required: bool,
    wardrobe_mode: u8, behavior: u8, capacity: u64, admission_ceiling: u8,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert_hash(&previous);
    assert_key(&part_key);
    assert_hash(&core_part_payload_commitment);
    assert_profile_policy(wardrobe_mode, behavior, capacity, admission_ceiling, required);
    hash::sha2_256(bcs::to_bytes(&PartProfileCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/part-profile",
        version: VERSION,
        root_content_commitment,
        sequence,
        previous,
        part_key,
        core_part_payload_commitment,
        required,
        wardrobe_mode,
        behavior,
        capacity,
        admission_ceiling,
    }))
}

public fun runtime_policy_commitment_v8(
    root_content_commitment: vector<u8>,
    profile_count: u64,
    profile_commitment: vector<u8>,
    admission_ceiling: u8,
    item_assetization: bool,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert!(profile_count > 0 && profile_count <= MAX_PART_PROFILES, EInvalidCount);
    assert_hash(&profile_commitment);
    assert_admission_ceiling(admission_ceiling);
    hash::sha2_256(bcs::to_bytes(&RuntimePolicyCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/admission-policy",
        version: VERSION,
        root_content_commitment,
        profile_count,
        profile_commitment,
        admission_ceiling,
        item_assetization,
    }))
}

/// Creates the exact DRAFT registries and the key-only admission authority.
/// The mutable Pack registry always begins empty at revision zero.
public fun new_runtime_registries_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    expected_profile_count: u64,
    expected_profile_commitment: vector<u8>,
    admission_ceiling: u8,
    item_assetization: bool,
    ctx: &mut TxContext,
): (RuntimeDefinitionRegistryV8, PackRegistryV8, PackAdmissionAuthorityV8) {
    maker::assert_draft_admin_v8(root, admin);
    maker::assert_base_registry_identity_v8(
        root,
        sui::object::id(base_registry),
        base::registry_root_id_v2(base_registry),
        base::registry_maker_version_v2(base_registry),
        base::registry_root_content_commitment_v2(base_registry),
    );
    assert!(base::registry_sealed_v2(base_registry), ENotSealed);
    assert!(expected_profile_count == base::registry_part_count_v2(base_registry), EInvalidCount);
    assert!(expected_profile_count > 0 && expected_profile_count <= MAX_PART_PROFILES, EInvalidCount);
    assert_admission_ceiling(admission_ceiling);
    assert_hash(&expected_profile_commitment);
    let root_id = maker::root_id_v8(root);
    let root_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let policy_commitment = runtime_policy_commitment_v8(
        root_content_commitment,
        expected_profile_count,
        expected_profile_commitment,
        admission_ceiling,
        item_assetization,
    );
    assert!(&policy_commitment
        == maker::root_expected_pack_admission_policy_commitment_v2(root), EInvalidCommitment);
    let definition_uid = object::new(ctx);
    let definition_registry_id = definition_uid.to_inner();
    let authority_uid = object::new(ctx);
    let admission_authority_id = authority_uid.to_inner();
    let pack_uid = object::new(ctx);
    let pack_registry_id = pack_uid.to_inner();
    let definitions = RuntimeDefinitionRegistryV8 {
        id: definition_uid,
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
        base_registry_id: sui::object::id(base_registry),
        expected_profile_count,
        observed_profile_count: 0,
        expected_profile_commitment,
        rolling_profile_commitment: empty_profile_commitment_v8(root_content_commitment),
        admission_ceiling,
        item_assetization,
        sealed: false,
        profile_keys: vector[],
        profiles: table::new(ctx),
    };
    let packs = PackRegistryV8 {
        id: pack_uid,
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
        definition_registry_id,
        admission_authority_id,
        admission_policy_commitment: policy_commitment,
        revision: 0,
        release_count: 0,
        external_admission_count: 0,
        wardrobe_revision: 0,
        base_item_count: 0,
        releases: table::new(ctx),
        semantic_releases: table::new(ctx),
        external_admissions: table::new(ctx),
        base_item_owners: table::new(ctx),
    };
    let authority = PackAdmissionAuthorityV8 {
        id: authority_uid,
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
    };
    event::emit(RuntimeRegistriesCreatedV8 {
        root_id,
        definition_registry_id,
        pack_registry_id,
        admission_authority_id,
    });
    (definitions, packs, authority)
}

public fun append_part_profile_v8<PaymentCoin>(
    registry: &mut RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    sequence: u64,
    part_key: String,
    wardrobe_mode: u8,
    behavior: u8,
    capacity: u64,
) {
    assert_definition_write(registry, root, admin, base_registry, sequence);
    assert!(sequence < registry.expected_profile_count, EInvalidCount);
    let part = base::borrow_part_v2(base_registry, part_key);
    let (base_part_key, base_part_sequence, required, part_payload_commitment) =
        base::part_identity_terms_v2(part);
    assert!(base_part_key == &part_key, EInvalidBinding);
    assert!(base_part_sequence == sequence, EPartOrder);
    assert_profile_policy(
        wardrobe_mode, behavior, capacity, registry.admission_ceiling, required);
    let core_part_payload_commitment = *part_payload_commitment;
    let profile_commitment = advance_profile_commitment_v8(
        registry.root_content_commitment,
        sequence,
        registry.rolling_profile_commitment,
        part_key,
        core_part_payload_commitment,
        required,
        wardrobe_mode,
        behavior,
        capacity,
        registry.admission_ceiling,
    );
    let key = PartProfileKeyV8 { part_key };
    assert!(!registry.profiles.contains(key), EDuplicate);
    registry.profiles.add(key, PartProfileV8 {
        index: sequence,
        part_key,
        core_part_payload_commitment,
        required,
        wardrobe_mode,
        behavior,
        capacity,
        admission_ceiling: registry.admission_ceiling,
        profile_commitment,
    });
    registry.profile_keys.push_back(part_key);
    registry.observed_profile_count = registry.observed_profile_count + 1;
    registry.rolling_profile_commitment = profile_commitment;
}

public fun seal_runtime_definitions_v8<PaymentCoin>(
    registry: &mut RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_definition_binding(registry, root, base_registry);
    assert!(!registry.sealed, EAlreadySealed);
    assert!(registry.observed_profile_count == registry.expected_profile_count, EInvalidCount);
    assert!(registry.profile_keys.length() == registry.expected_profile_count, EInvalidCount);
    assert!(registry.rolling_profile_commitment == registry.expected_profile_commitment, EInvalidCommitment);
    let total_capacity = total_slot_capacity(registry);
    assert!(total_capacity > 0 && total_capacity <= MAX_LOADOUT_SELECTIONS, EInvalidCount);
    registry.sealed = true;
}

/// DRAFT zero-registry readiness. This is deliberately unavailable after any
/// Pack/external admission revision and proves the immutable definition side.
public fun runtime_activation_readiness_v8<PaymentCoin>(
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    root: &MakerRootV8<PaymentCoin>,
): RuntimeActivationReadinessReceiptV8 {
    maker::assert_draft_v8(root);
    assert_definition_identity(definitions, root);
    assert!(definitions.sealed, ENotSealed);
    assert_pack_registry_identity(packs, definitions, root);
    assert_authority_identity(authority, packs, root);
    assert!(packs.revision == 0, ENotReady);
    assert!(packs.release_count == 0, ENotReady);
    assert!(packs.external_admission_count == 0, ENotReady);
    assert!(packs.wardrobe_revision == 0, ENotReady);
    assert!(packs.base_item_count == 0, ENotReady);
    let definition_registry_id = object::id(definitions);
    let pack_registry_id = object::id(packs);
    let admission_authority_id = object::id(authority);
    let companion_commitment = hash::sha2_256(bcs::to_bytes(
        &RuntimeReadinessCommitmentInputV8 {
            domain: b"animacraft-v8/runtime/activation-readiness",
            version: VERSION,
            root_id: packs.root_id,
            root_version: packs.root_version,
            root_content_commitment: packs.root_content_commitment,
            definition_registry_id,
            definition_profile_count: definitions.observed_profile_count,
            definition_profile_commitment: definitions.rolling_profile_commitment,
            pack_registry_id,
            pack_registry_revision: packs.revision,
            pack_release_count: packs.release_count,
            external_admission_count: packs.external_admission_count,
            wardrobe_revision: packs.wardrobe_revision,
            base_item_count: packs.base_item_count,
            admission_authority_id,
            policy_commitment: packs.admission_policy_commitment,
        },
    ));
    RuntimeActivationReadinessReceiptV8 {
        root_id: packs.root_id,
        root_version: packs.root_version,
        root_content_commitment: packs.root_content_commitment,
        definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        policy_commitment: packs.admission_policy_commitment,
        companion_commitment,
    }
}

public fun bind_runtime_companion_v2<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    authority: &PackAdmissionAuthorityV8, ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    maker::assert_companion_builder_root_v2(&builder, root, admin, ctx);
    maker::assert_product_release_catalog_v8(root, catalog);
    let receipt = runtime_activation_readiness_v8(definitions, packs, authority, root);
    let (_, _, _, definitions_id, packs_id, authority_id, policy, _) =
        consume_activation_readiness_v8(receipt);
    assert!(&policy == maker::root_expected_pack_admission_policy_commitment_v2(root),
        EInvalidPolicy);
    companion::append_runtime_v2(builder, MakerCompanionBindingWitnessV2 {},
        protocol_config, catalog, replacement, definitions_id, packs_id, authority_id, ctx)
}

public(package) fun consume_activation_readiness_v8(
    receipt: RuntimeActivationReadinessReceiptV8,
): (ID, u64, vector<u8>, ID, ID, ID, vector<u8>, vector<u8>) {
    let RuntimeActivationReadinessReceiptV8 {
        root_id, root_version, root_content_commitment, definition_registry_id,
        pack_registry_id, admission_authority_id, policy_commitment,
        companion_commitment,
    } = receipt;
    (
        root_id, root_version, root_content_commitment, definition_registry_id,
        pack_registry_id, admission_authority_id, policy_commitment,
        companion_commitment,
    )
}

public fun share_runtime_definition_registry_v8(registry: RuntimeDefinitionRegistryV8) {
    transfer::share_object(registry);
}
public fun share_pack_registry_v8(registry: PackRegistryV8) {
    transfer::share_object(registry);
}
public fun transfer_pack_admission_authority_v8(
    authority: PackAdmissionAuthorityV8,
    recipient: address,
) {
    assert!(recipient != @0x0, EInvalidRecipient);
    transfer::transfer(authority, recipient);
}

public fun empty_pack_style_commitment_v8(
    root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert_hash(&release_content_commitment);
    hash::sha2_256(bcs::to_bytes(&PackEmptyCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/pack-styles-empty",
        version: VERSION,
        root_content_commitment,
        release_content_commitment,
    }))
}

public fun advance_pack_style_commitment_v8(
    root_content_commitment: vector<u8>,
    release_content_commitment: vector<u8>,
    sequence: u64,
    previous: vector<u8>,
    style: PackStyleV8,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert_hash(&release_content_commitment);
    assert_hash(&previous);
    assert_pack_style(&style);
    hash::sha2_256(bcs::to_bytes(&PackStyleCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/pack-style",
        version: VERSION,
        root_content_commitment,
        release_content_commitment,
        sequence,
        previous,
        style,
    }))
}

/// Creates an independent post-activation Pack release. Its immutable Maker
/// compatibility excludes the Maker control epoch; its own control is exact.
public fun new_pack_release_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    semantic_pack_id: String,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    access_kind: u8,
    access_price_atomic: u64,
    complete_mode: u8,
    complete_price_atomic: u64,
    complete_free_quota_per_wallet: u64,
    complete_total_cap: u64,
    expected_style_count: u64,
    expected_style_commitment: vector<u8>,
    ctx: &mut TxContext,
): (PackReleaseV8<PaymentCoin>, PackAdminCapV8, PackTreasuryV8<PaymentCoin>) {
    assert_root_active(root);
    assert_definition_identity(definitions, root);
    assert!(definitions.sealed, ENotSealed);
    assert_key(&semantic_pack_id);
    assert_locator(&manifest_blob_id);
    assert_hash(&manifest_sha256);
    assert_hash(&content_commitment);
    assert_access_policy(access_kind, access_price_atomic);
    assert_complete_policy(
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
    );
    assert!(expected_style_count > 0 && expected_style_count <= MAX_PACK_STYLES, EInvalidCount);
    assert_hash(&expected_style_commitment);
    let release_uid = object::new(ctx);
    let release_id = release_uid.to_inner();
    let admin_uid = object::new(ctx);
    let admin_cap_id = admin_uid.to_inner();
    let treasury_uid = object::new(ctx);
    let treasury_id = treasury_uid.to_inner();
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let release = PackReleaseV8<PaymentCoin> {
        id: release_uid,
        version: VERSION,
        root_id: maker::root_id_v8(root),
        root_version: maker::root_maker_version_v8(root),
        root_content_commitment,
        creator: ctx.sender(),
        owner: ctx.sender(),
        control_epoch: 0,
        admin_cap_id,
        treasury_id,
        semantic_pack_id,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        lifecycle: PACK_DRAFT,
        access_kind,
        access_price_atomic,
        complete_mode,
        complete_price_atomic,
        complete_free_quota_per_wallet,
        complete_total_cap,
        expected_style_count,
        observed_style_count: 0,
        expected_style_commitment,
        rolling_style_commitment: empty_pack_style_commitment_v8(
            root_content_commitment,
            content_commitment,
        ),
        protected_style_count: 0,
        pass_count: 0,
        total_complete_count: 0,
        styles: table::new(ctx),
        complete_by_wallet: table::new(ctx),
    };
    let cap = PackAdminCapV8 {
        id: admin_uid,
        version: VERSION,
        release_id,
        owner: ctx.sender(),
        control_epoch: 0,
    };
    let treasury = PackTreasuryV8<PaymentCoin> {
        id: treasury_uid,
        version: VERSION,
        release_id,
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    };
    (release, cap, treasury)
}

/// Appends an unprotected official Style. Protected Styles use the Seal-bound
/// entry point added by the exact Seal package integration.
public fun append_unprotected_pack_style_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    cap: &PackAdminCapV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    sequence: u64,
    definition_sources: PackStyleDefinitionSourcesV8,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_content_commitment: vector<u8>,
    style_commitment: vector<u8>,
    ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT, EInvalidLifecycle);
    assert!(sequence == release.observed_style_count, EInvalidSequence);
    assert!(sequence < release.expected_style_count, EInvalidCount);
    assert!(definitions.root_id == release.root_id, EInvalidBinding);
    assert!(definitions.root_version == release.root_version, EInvalidBinding);
    assert!(definitions.root_content_commitment == release.root_content_commitment, EInvalidBinding);
    assert!(definitions.sealed, ENotSealed);
    let _profile = pack_style_part_profile(definitions, release, definition_sources.part, part_key);
    assert_pack_style_references(
        definitions, base_registry, release, &definition_sources, &part_key, &layer_track_key,
        &color_channel_key, &default_swatch_key);
    assert_pack_style_visibility_definitions(base_registry, release, &definition_sources, part_key, item_key, style_key);
    let style = PackStyleV8 {
        index: sequence,
        definition_sources,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        color_channel_key,
        default_swatch_key,
        asset_blob_id,
        asset_sha256,
        asset_content_commitment,
        protected: false,
        seal_binding_commitment: vector[],
        style_commitment,
    };
    assert_pack_style(&style);
    let key = PackStyleKeyV8 { part_key, item_key, style_key };
    assert!(!release.styles.contains(key), EDuplicate);
    let next = advance_pack_style_commitment_v8(
        release.root_content_commitment,
        release.content_commitment,
        sequence,
        release.rolling_style_commitment,
        style,
    );
    release.styles.add(key, style);
    release.observed_style_count = release.observed_style_count + 1;
    release.rolling_style_commitment = next;
}

public(package) fun new_pack_registration_witness_v8<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>,
    cap: &PackAdminCapV8,
    definitions: &RuntimeDefinitionRegistryV8,
    sequence: u64,
    definition_sources: PackStyleDefinitionSourcesV8,
    part_key: String,
    item_key: String,
    style_key: String,
    asset_content_commitment: vector<u8>,
    ctx: &TxContext,
): RuntimePackRegistrationWitnessV8 {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT, EInvalidLifecycle);
    assert!(sequence == release.observed_style_count, EInvalidSequence);
    assert!(sequence < release.expected_style_count, EInvalidCount);
    assert!(definitions.root_id == release.root_id, EInvalidBinding);
    assert!(definitions.root_version == release.root_version, EInvalidBinding);
    assert!(definitions.root_content_commitment == release.root_content_commitment, EInvalidBinding);
    assert!(definitions.sealed, ENotSealed);
    let _profile = pack_style_part_profile(definitions, release, definition_sources.part, part_key);
    assert_key(&item_key);
    assert_key(&style_key);
    assert_hash(&asset_content_commitment);
    RuntimePackRegistrationWitnessV8 {
        release_id: object::id(release),
        release_content_commitment: release.content_commitment,
        sequence,
        definition_sources,
        part_key,
        item_key,
        style_key,
        asset_content_commitment,
    }
}

public(package) fun append_certified_pack_style_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    cap: &PackAdminCapV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    witness: RuntimePackRegistrationWitnessV8,
    definition_sources: PackStyleDefinitionSourcesV8,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    asset_content_commitment: vector<u8>,
    seal_binding_commitment: vector<u8>,
    style_commitment: vector<u8>,
    ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    let RuntimePackRegistrationWitnessV8 {
        release_id,
        release_content_commitment,
        sequence,
        definition_sources: witness_sources,
        part_key,
        item_key,
        style_key,
        asset_content_commitment: witness_asset_content,
    } = witness;
    assert!(release_id == object::id(release), EInvalidBinding);
    assert!(release_content_commitment == release.content_commitment, EInvalidBinding);
    assert!(asset_content_commitment == witness_asset_content, EInvalidBinding);
    assert!(definition_sources == witness_sources, EInvalidBinding);
    assert!(sequence == release.observed_style_count, EInvalidSequence);
    let _profile = pack_style_part_profile(definitions, release, definition_sources.part, part_key);
    assert_pack_style_references(
        definitions, base_registry, release, &definition_sources, &part_key, &layer_track_key,
        &color_channel_key, &default_swatch_key);
    assert_pack_style_visibility_definitions(base_registry, release, &definition_sources, part_key, item_key, style_key);
    let style = PackStyleV8 {
        index: sequence,
        definition_sources,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        color_channel_key,
        default_swatch_key,
        asset_blob_id: ciphertext_blob_id,
        asset_sha256: ciphertext_sha256,
        asset_content_commitment,
        protected: true,
        seal_binding_commitment,
        style_commitment,
    };
    assert_pack_style(&style);
    let key = PackStyleKeyV8 { part_key, item_key, style_key };
    assert!(!release.styles.contains(key), EDuplicate);
    let next = advance_pack_style_commitment_v8(
        release.root_content_commitment,
        release.content_commitment,
        sequence,
        release.rolling_style_commitment,
        style,
    );
    release.styles.add(key, style);
    release.observed_style_count = release.observed_style_count + 1;
    release.protected_style_count = release.protected_style_count + 1;
    release.rolling_style_commitment = next;
}

public fun seal_pack_release_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    cap: &PackAdminCapV8,
    ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_DRAFT, EInvalidLifecycle);
    assert!(!df::exists(&release.id, PackDefinitionsDraftKeyV8 {}), EInvalidPolicy);
    // Finalized definitions are immutable and every appended Style has already
    // resolved its scoped references. Only an unfinished definition draft blocks
    // sealing; the exact declared Style count/commitment still must match.
    assert!(release.observed_style_count == release.expected_style_count, EInvalidCount);
    assert!(release.rolling_style_commitment == release.expected_style_commitment, EInvalidCommitment);
    release.lifecycle = PACK_SEALED;
    event::emit(PackLifecycleChangedV8 {
        release_id: object::id(release),
        previous_lifecycle: PACK_DRAFT,
        lifecycle: PACK_SEALED,
    });
}

public fun share_pack_release_v8<PaymentCoin>(release: PackReleaseV8<PaymentCoin>) {
    transfer::share_object(release)
}

public fun share_pack_treasury_v8<PaymentCoin>(treasury: PackTreasuryV8<PaymentCoin>) {
    transfer::share_object(treasury)
}

public fun transfer_pack_admin_cap_v8(cap: PackAdminCapV8, recipient: address) {
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(cap.owner == recipient, EWrongControl);
    transfer::transfer(cap, recipient)
}

/// Transfer Pack write authority without changing Release compatibility,
/// Passes, loadouts, or access proofs.
public fun transfer_pack_control_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    mut cap: PackAdminCapV8,
    recipient: address,
    ctx: &TxContext,
) {
    assert_pack_control(release, &cap, ctx);
    assert!(recipient != @0x0 && recipient != release.owner, EInvalidRecipient);
    release.owner = recipient;
    release.control_epoch = release.control_epoch + 1;
    cap.owner = recipient;
    cap.control_epoch = release.control_epoch;
    transfer::transfer(cap, recipient)
}

/// Maker-controlled admission uses the exact current revision CAS. Admission
/// activates a sealed release without rewriting Root content.
public fun admit_pack_release_v8<PaymentCoin>(
    registry: &mut PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    release: &mut PackReleaseV8<PaymentCoin>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_root_active(root);
    maker::assert_admin_v8(root, maker_admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EWrongControl);
    assert_pack_registry_identity(registry, definitions, root);
    assert_authority_identity(authority, registry, root);
    assert!(registry.revision == expected_revision, EStaleRevision);
    assert_release_compatibility(release, registry);
    assert!(release.lifecycle == PACK_SEALED, EInvalidLifecycle);
    let release_id = object::id(release);
    assert!(!registry.releases.contains(release_id), EAlreadyAdmitted);
    assert!(!registry.semantic_releases.contains(release.semantic_pack_id), EAlreadyAdmitted);
    registry.revision = registry.revision + 1;
    registry.release_count = registry.release_count + 1;
    registry.releases.add(release_id, PackAdmissionRecordV8 {
        release_id,
        semantic_pack_id: release.semantic_pack_id,
        release_content_commitment: release.content_commitment,
        admitted_revision: registry.revision,
        admission_state: ADMISSION_ACTIVE,
    });
    registry.semantic_releases.add(release.semantic_pack_id, release_id);
    release.lifecycle = PACK_ACTIVE;
    event::emit(PackRegistryRevisionAdvancedV8 {
        root_id: registry.root_id,
        previous_revision: expected_revision,
        revision: registry.revision,
        subject_id: release_id,
        operation: 0,
    });
    event::emit(PackLifecycleChangedV8 {
        release_id,
        previous_lifecycle: PACK_SEALED,
        lifecycle: PACK_ACTIVE,
    });
}

public fun revoke_pack_admission_v8<PaymentCoin>(
    registry: &mut PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    release_id: ID,
    expected_revision: u64,
    ctx: &TxContext,
) {
    maker::assert_admin_v8(root, maker_admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EWrongControl);
    assert_pack_registry_identity(registry, definitions, root);
    assert_authority_identity(authority, registry, root);
    assert!(registry.revision == expected_revision, EStaleRevision);
    let record = registry.releases.borrow_mut(release_id);
    assert!(record.admission_state == ADMISSION_ACTIVE, EAdmissionDenied);
    record.admission_state = ADMISSION_REVOKED;
    registry.revision = registry.revision + 1;
    event::emit(PackRegistryRevisionAdvancedV8 {
        root_id: registry.root_id,
        previous_revision: expected_revision,
        revision: registry.revision,
        subject_id: release_id,
        operation: 1,
    });
}

public fun pause_pack_release_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    set_pack_lifecycle(release, PACK_PAUSED);
}

public fun resume_pack_release_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8,
    registry: &PackRegistryV8, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_PAUSED, EInvalidLifecycle);
    assert_active_pack_admission(registry, release);
    set_pack_lifecycle(release, PACK_ACTIVE);
}

public fun archive_pack_release_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, ctx: &TxContext,
) {
    assert_pack_write(release, cap, ctx);
    assert!(release.lifecycle == PACK_ACTIVE || release.lifecycle == PACK_PAUSED, EInvalidLifecycle);
    set_pack_lifecycle(release, PACK_ARCHIVED);
}

public fun issue_free_pack_pass_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    registry: &PackRegistryV8,
    clock: &Clock,
    ctx: &mut TxContext,
): PackPassV8 {
    assert_active_pack_admission(registry, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert!(release.access_kind == ACCESS_FREE, EInvalidPolicy);
    new_pack_pass(release, 0, clock.timestamp_ms(), ctx)
}

public fun transfer_pack_pass_to_holder_v8(pass: PackPassV8) {
    let holder = pass.holder;
    transfer::transfer(pass, holder)
}

/// Purchase one exact Pack entitlement. Protocol revenue and the Pack
/// residual are deposited atomically; no loose fee Coin is returned.
public fun purchase_pack_pass_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    registry: &PackRegistryV8,
    treasury: &mut PackTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
): PackPassV8 {
    assert_active_pack_admission(registry, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert!(release.access_kind == ACCESS_PAID, EInvalidPolicy);
    assert_root_compatibility(release.root_id, release.root_version,
        &release.root_content_commitment, root);
    maker::assert_current_protocol_config_v8(root, config);
    assert_treasury(release, treasury);
    let gross = release.access_price_atomic;
    assert!(gross > 0 && coin::value(&payment) == gross, EWrongPayment);
    let economics = maker::root_economics_v8(root);
    let protocol_atomic = protocol_share(
        gross, maker::economics_primary_content_fee_bps_v8(&economics));
    if (protocol_atomic > 0) {
        let protocol_payment = coin::split(&mut payment, protocol_atomic, ctx);
        protocol::deposit_protocol_revenue_v8(config, protocol_treasury, protocol_payment);
    };
    assert!(coin::value(&payment) == gross - protocol_atomic, EWrongPayment);
    deposit_pack_revenue_v8(release, treasury, payment);
    new_pack_pass(release, gross, clock.timestamp_ms(), ctx)
}

/// INCLUDED_WITH_MAKER is authorized only by Core's exact non-transferable
/// MakerAccessPass, never by a caller-supplied boolean.
public fun issue_included_pack_pass_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    registry: &PackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    clock: &Clock,
    ctx: &mut TxContext,
): PackPassV8 {
    assert_active_pack_admission(registry, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert!(release.access_kind == ACCESS_INCLUDED_WITH_MAKER, EInvalidPolicy);
    assert_root_compatibility(release.root_id, release.root_version,
        &release.root_content_commitment, root);
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    new_pack_pass(release, 0, clock.timestamp_ms(), ctx)
}

/// Builds the only Runtime authority accepted when Physical installs a
/// post-activation Pack policy. The private exact Physical witness and current
/// replacement prevent another package from turning Pack IDs into policy rows.
public fun new_physical_pack_policy_witness_v8<
    PaymentCoin,
    PhysicalAuthority: drop,
>(
    root: &MakerRootV8<PaymentCoin>,
    physical_authority: PhysicalAuthority,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_admin: &PackAdminCapV8,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    part_key: String,
    item_key: String,
    style_key: String,
    ctx: &TxContext,
): RuntimePhysicalPackPolicyWitnessV8 {
    assert_physical_caller(root, physical_authority, protocol_config, catalog, replacement, packs);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_control(release, pack_admin, ctx);
    assert_treasury(release, pack_treasury);
    let style = release.styles.borrow(PackStyleKeyV8 {
        part_key,
        item_key,
        style_key,
    });
    let style_identity_commitment = physical_pack_style_identity(
        packs,
        release,
        pack_treasury,
        style,
    );
    RuntimePhysicalPackPolicyWitnessV8 {
        root_id: release.root_id,
        root_version: release.root_version,
        root_content_commitment: release.root_content_commitment,
        pack_registry_id: object::id(packs),
        pack_registry_revision: packs.revision,
        release_id: object::id(release),
        semantic_pack_id: release.semantic_pack_id,
        release_content_commitment: release.content_commitment,
        pack_owner: release.owner,
        pack_control_epoch: release.control_epoch,
        pack_admin_cap_id: object::id(pack_admin),
        pack_treasury_id: object::id(pack_treasury),
        style_index: style.index,
        part_key: style.part_key,
        item_key: style.item_key,
        style_key: style.style_key,
        layer_track_key: style.layer_track_key,
        color_channel_key: style.color_channel_key,
        default_swatch_key: style.default_swatch_key,
        asset_blob_id: style.asset_blob_id,
        asset_sha256: style.asset_sha256,
        asset_content_commitment: style.asset_content_commitment,
        protected: style.protected,
        seal_binding_commitment: style.seal_binding_commitment,
        style_commitment: style.style_commitment,
        style_identity_commitment,
    }
}

/// Re-reads one current Pack selection and its holder entitlement. This is
/// deliberately separate from Output's Soul witness: NONE policies can issue
/// without a Soul, while Soul materialization compares both independent
/// witnesses before minting.
public fun new_physical_pack_access_witness_v8<
    PaymentCoin,
    PhysicalAuthority: drop,
>(
    root: &MakerRootV8<PaymentCoin>,
    physical_authority: PhysicalAuthority,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    loadout: &MakerLoadoutV8,
    selection_index: u64,
    ctx: &TxContext,
): RuntimePhysicalPackAccessWitnessV8 {
    assert_physical_caller(root, physical_authority, protocol_config, catalog, replacement, packs);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_treasury(release, pack_treasury);
    assert_pack_pass(release, pass, ctx.sender());
    assert!(loadout.version == VERSION, EInvalidBinding);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_root_compatibility(
        loadout.root_id,
        loadout.root_version,
        &loadout.root_content_commitment,
        root,
    );
    assert!(loadout.pack_registry_id == object::id(packs), EInvalidBinding);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.selection_index == selection_index, EInvalidProof);
    assert!(selection.source_class == SOURCE_PACK, EInvalidProof);
    assert!(selection.source_definition_id == object::id(release), EInvalidProof);
    assert!(&selection.source_semantic_id == &release.semantic_pack_id, EInvalidProof);
    assert!(selection.access_subject == object::id(pass), EInvalidProof);
    assert!(selection.source_epoch == 0, EInvalidProof);
    let pricing_commitment = pack_pricing_commitment(release);
    assert!(selection.pricing_commitment == pricing_commitment, EInvalidProof);
    let style = release.styles.borrow(PackStyleKeyV8 {
        part_key: selection.part_key,
        item_key: selection.item_key,
        style_key: selection.style_key,
    });
    assert!(style.layer_track_key == selection.layer_track_key, EInvalidProof);
    assert!(style.asset_content_commitment == selection.asset_content_commitment, EInvalidProof);
    let style_identity_commitment = physical_pack_style_identity(
        packs,
        release,
        pack_treasury,
        style,
    );
    RuntimePhysicalPackAccessWitnessV8 {
        root_id: release.root_id,
        root_version: release.root_version,
        root_content_commitment: release.root_content_commitment,
        holder: ctx.sender(),
        pack_registry_id: object::id(packs),
        pack_registry_revision: packs.revision,
        release_id: object::id(release),
        semantic_pack_id: release.semantic_pack_id,
        release_content_commitment: release.content_commitment,
        pack_treasury_id: object::id(pack_treasury),
        pack_pass_id: object::id(pass),
        pack_pass_commitment: pass.commitment,
        loadout_id: object::id(loadout),
        loadout_revision: loadout.revision,
        loadout_commitment: loadout.commitment,
        selection_index,
        selection_commitment: selection_commitment_v8(*selection),
        pricing_commitment,
        part_key: selection.part_key,
        item_key: selection.item_key,
        style_key: selection.style_key,
        layer_track_key: selection.layer_track_key,
        asset_content_commitment: selection.asset_content_commitment,
        style_identity_commitment,
    }
}

/// Physical consumes the policy witness under exact current package authority.
public fun consume_physical_pack_policy_witness_v8<
    PaymentCoin,
    PhysicalAuthority: drop,
>(
    witness: RuntimePhysicalPackPolicyWitnessV8,
    physical_authority: PhysicalAuthority,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
): (
    ID, u64, vector<u8>, ID, u64, ID, String, vector<u8>, address, u64,
    ID, ID, u64, String, String, String, String, Option<String>,
    Option<String>, String, vector<u8>, vector<u8>, bool, vector<u8>,
    vector<u8>, vector<u8>,
) {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    binding::assert_exact_witness_type_v2<PhysicalAuthority>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 4),
        &b"physical_v8", &b"PhysicalRuntimeWitnessV2");
    let _ = physical_authority;
    let RuntimePhysicalPackPolicyWitnessV8 {
        root_id, root_version, root_content_commitment,
        pack_registry_id, pack_registry_revision, release_id,
        semantic_pack_id, release_content_commitment, pack_owner,
        pack_control_epoch, pack_admin_cap_id, pack_treasury_id,
        style_index, part_key, item_key, style_key, layer_track_key,
        color_channel_key, default_swatch_key, asset_blob_id,
        asset_sha256, asset_content_commitment, protected,
        seal_binding_commitment, style_commitment,
        style_identity_commitment,
    } = witness;
    maker::assert_root_identity_v8(root, root_id, root_version, &root_content_commitment);
    (
        root_id, root_version, root_content_commitment,
        pack_registry_id, pack_registry_revision, release_id,
        semantic_pack_id, release_content_commitment, pack_owner,
        pack_control_epoch, pack_admin_cap_id, pack_treasury_id,
        style_index, part_key, item_key, style_key, layer_track_key,
        color_channel_key, default_swatch_key, asset_blob_id,
        asset_sha256, asset_content_commitment, protected,
        seal_binding_commitment, style_commitment,
        style_identity_commitment,
    )
}

/// Physical consumes the live Pack access witness under current package authority.
public fun consume_physical_pack_access_witness_v8<
    PaymentCoin,
    PhysicalAuthority: drop,
>(
    witness: RuntimePhysicalPackAccessWitnessV8,
    physical_authority: PhysicalAuthority,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
): (
    ID, u64, vector<u8>, address, ID, u64, ID, String, vector<u8>, ID,
    ID, vector<u8>, ID, u64, vector<u8>, u64, vector<u8>, vector<u8>,
    String, String, String, String, vector<u8>, vector<u8>,
) {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    binding::assert_exact_witness_type_v2<PhysicalAuthority>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 4),
        &b"physical_v8", &b"PhysicalRuntimeWitnessV2");
    let _ = physical_authority;
    let RuntimePhysicalPackAccessWitnessV8 {
        root_id, root_version, root_content_commitment, holder,
        pack_registry_id, pack_registry_revision, release_id,
        semantic_pack_id, release_content_commitment, pack_treasury_id,
        pack_pass_id, pack_pass_commitment, loadout_id, loadout_revision,
        loadout_commitment, selection_index, selection_commitment,
        pricing_commitment, part_key, item_key, style_key, layer_track_key,
        asset_content_commitment, style_identity_commitment,
    } = witness;
    maker::assert_root_identity_v8(root, root_id, root_version, &root_content_commitment);
    (
        root_id, root_version, root_content_commitment, holder,
        pack_registry_id, pack_registry_revision, release_id,
        semantic_pack_id, release_content_commitment, pack_treasury_id,
        pack_pass_id, pack_pass_commitment, loadout_id, loadout_revision,
        loadout_commitment, selection_index, selection_commitment,
        pricing_commitment, part_key, item_key, style_key, layer_track_key,
        asset_content_commitment, style_identity_commitment,
    )
}

/// Package-private mutation reached after runtime_binding_v8 validates Output's
/// installed caller cap and current replacement authority in this transaction.
public(package) fun authorize_pack_complete_line_v8<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    registry: &PackRegistryV8,
    pass: &PackPassV8,
    authorization: &RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): PackCompleteLineV8 {
    assert_active_pack_admission(registry, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_pass(release, pass, ctx.sender());
    assert!(authorization.loadout_id == object::id(loadout), EInvalidProof);
    assert!(authorization.loadout_revision == loadout.revision, EInvalidProof);
    assert!(authorization.loadout_commitment == loadout.commitment, EInvalidProof);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    let current_pricing_commitment = pack_pricing_commitment(release);
    assert_used_pack(
        &authorization.used_packs,
        object::id(release),
        &release.semantic_pack_id,
        &release.content_commitment,
        &current_pricing_commitment,
    );
    let key = WalletKeyV8 { wallet: ctx.sender() };
    let wallet_count = if (release.complete_by_wallet.contains(key)) {
        *release.complete_by_wallet.borrow(key)
    } else { 0 };
    if (release.complete_total_cap != 0) {
        assert!(release.total_complete_count < release.complete_total_cap, ECompleteBlocked);
    };
    let price_atomic = complete_price_for_ordinal(
        release.complete_mode,
        release.complete_price_atomic,
        release.complete_free_quota_per_wallet,
        wallet_count,
    );
    if (release.complete_by_wallet.contains(key)) {
        *release.complete_by_wallet.borrow_mut(key) = wallet_count + 1;
    } else {
        release.complete_by_wallet.add(key, 1);
    };
    release.total_complete_count = release.total_complete_count + 1;
    PackCompleteLineV8 {
        release_id: object::id(release),
        root_id: release.root_id,
        root_version: release.root_version,
        root_content_commitment: release.root_content_commitment,
        release_content_commitment: release.content_commitment,
        holder: ctx.sender(),
        ordinal: wallet_count,
        price_atomic,
    }
}

public fun deposit_pack_revenue_v8<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>,
    treasury: &mut PackTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
) {
    assert_treasury(release, treasury);
    let amount = coin::value(&payment);
    assert!(amount > 0, EWrongPayment);
    treasury.total_collected = treasury.total_collected + amount;
    coin::put(&mut treasury.revenue, payment);
}

public fun withdraw_pack_revenue_v8<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>,
    cap: &PackAdminCapV8,
    treasury: &mut PackTreasuryV8<PaymentCoin>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_pack_control(release, cap, ctx);
    assert_treasury(release, treasury);
    assert!(recipient != @0x0, EInvalidRecipient);
    assert!(amount > 0 && amount <= balance::value(&treasury.revenue), EInsufficientRevenue);
    let payment = coin::take(&mut treasury.revenue, amount, ctx);
    treasury.total_withdrawn = treasury.total_withdrawn + amount;
    transfer::public_transfer(payment, recipient);
}

public(package) fun consume_pack_complete_line_v8(
    line: PackCompleteLineV8,
): (ID, ID, u64, vector<u8>, vector<u8>, address, u64, u64) {
    let PackCompleteLineV8 {
        release_id, root_id, root_version, root_content_commitment,
        release_content_commitment, holder, ordinal, price_atomic,
    } = line;
    (
        release_id, root_id, root_version, root_content_commitment,
        release_content_commitment, holder, ordinal, price_atomic,
    )
}

/// Consumes and settles an authorized paid Pack Complete line. The line has no
/// abilities and can only be created after Output's exact caller cap was
/// consumed, so no caller can retain, copy, or forge a reusable charge.
public fun settle_paid_pack_complete_line_v8<PaymentCoin>(
    line: PackCompleteLineV8,
    release: &PackReleaseV8<PaymentCoin>,
    treasury: &mut PackTreasuryV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    mut payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
) : (ID, u64) {
    let (release_id, root_id, root_version, root_content_commitment,
        release_content_commitment, holder, ordinal, price_atomic) =
        consume_pack_complete_line_v8(line);
    assert!(release_id == object::id(release), EInvalidBinding);
    assert!(release_content_commitment == release.content_commitment, EInvalidBinding);
    assert!(holder == ctx.sender(), EWrongHolder);
    assert_root_compatibility(root_id, root_version, &root_content_commitment, root);
    maker::assert_current_protocol_config_v8(root, config);
    assert_treasury(release, treasury);
    assert!(price_atomic > 0 && coin::value(&payment) == price_atomic, EWrongPayment);
    let economics = maker::root_economics_v8(root);
    let protocol_atomic = protocol_share(
        price_atomic, maker::economics_primary_content_fee_bps_v8(&economics));
    if (protocol_atomic > 0) {
        let protocol_payment = coin::split(&mut payment, protocol_atomic, ctx);
        protocol::deposit_protocol_revenue_v8(config, protocol_treasury, protocol_payment);
    };
    assert!(coin::value(&payment) == price_atomic - protocol_atomic, EWrongPayment);
    deposit_pack_revenue_v8(release, treasury, payment);
    (release_id, ordinal)
}

/// Consumes an authorized zero-price Pack Complete line after rechecking its
/// exact live Release, immutable Root tuple, and current transaction holder.
public fun consume_free_pack_complete_line_v8<PaymentCoin>(
    line: PackCompleteLineV8,
    release: &PackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &TxContext,
): (ID, u64) {
    let (release_id, root_id, root_version, root_content_commitment,
        release_content_commitment, holder, ordinal, price_atomic) =
        consume_pack_complete_line_v8(line);
    assert!(release_id == object::id(release), EInvalidBinding);
    assert!(release_content_commitment == release.content_commitment, EInvalidBinding);
    assert!(holder == ctx.sender(), EWrongHolder);
    assert!(price_atomic == 0, EWrongPayment);
    assert_root_compatibility(root_id, root_version, &root_content_commitment, root);
    (release_id, ordinal)
}

public fun new_external_item_product_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    asset_media_type: String,
    asset_byte_length: u64,
    asset_content_commitment: vector<u8>,
    transferable: bool,
    ctx: &mut TxContext,
): (ExternalItemProductV8, ExternalItemAdminCapV8) {
    assert_root_active(root);
    assert_definition_binding(definitions, root, base_registry);
    assert!(definitions.sealed, ENotSealed);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key });
    assert!(profile.wardrobe_mode == WARDROBE_SLOT, EFixedPart);
    assert_external_profile_behavior(profile);
    assert!(profile.admission_ceiling != ADMISSION_DISABLED, EAdmissionDenied);
    assert_key(&item_key);
    assert_key(&style_key);
    assert_key(&layer_track_key);
    let _track = base::borrow_track_v2(base_registry, layer_track_key);
    assert_color_pair(&color_channel_key, &default_swatch_key);
    if (color_channel_key.is_some()) {
        let _color = base::borrow_color_v2(
            base_registry,
            *color_channel_key.borrow(),
            *default_swatch_key.borrow(),
        );
    };
    assert_locator(&asset_blob_id);
    assert_hash(&asset_sha256);
    assert_asset_descriptor(&asset_media_type, asset_byte_length);
    assert_hash(&asset_content_commitment);
    let compatibility_commitment = hash::sha2_256(bcs::to_bytes(
        &ExternalProductCommitmentInputV8 {
            domain: b"animacraft-v8/runtime/external-compatibility",
            version: VERSION,
            root_id: definitions.root_id,
            root_version: definitions.root_version,
            root_content_commitment: definitions.root_content_commitment,
            profile_commitment: profile.profile_commitment,
            part_key,
            item_key,
            style_key,
            layer_track_key,
            color_channel_key,
            default_swatch_key,
            asset_blob_id,
            asset_sha256,
            asset_media_type,
            asset_byte_length,
            asset_content_commitment,
            transferable,
        },
    ));
    let content_commitment = hash::sha2_256(bcs::to_bytes(
        &ExternalContentCommitmentInputV8 {
            domain: b"animacraft-v8/runtime/external-product",
            version: VERSION,
            compatibility_commitment,
            asset_content_commitment,
        },
    ));
    let product_uid = object::new(ctx);
    let product_id = product_uid.to_inner();
    let cap_uid = object::new(ctx);
    let cap_id = cap_uid.to_inner();
    let product = ExternalItemProductV8 {
        id: product_uid,
        version: VERSION,
        root_id: definitions.root_id,
        root_version: definitions.root_version,
        root_content_commitment: definitions.root_content_commitment,
        creator: ctx.sender(),
        owner: ctx.sender(),
        control_epoch: 0,
        admin_cap_id: cap_id,
        lifecycle: PRODUCT_ACTIVE,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        color_channel_key,
        default_swatch_key,
        asset_blob_id,
        asset_sha256,
        asset_media_type,
        asset_byte_length,
        asset_content_commitment,
        compatibility_commitment,
        content_commitment,
        transferable,
        supply: 0,
    };
    let cap = ExternalItemAdminCapV8 {
        id: cap_uid,
        version: VERSION,
        product_id,
        owner: ctx.sender(),
        control_epoch: 0,
    };
    (product, cap)
}

public(package) fun new_external_item_attestation_v8(
    catalog_id: ID,
    product: &ExternalItemProductV8,
): ExternalItemAttestationV8 {
    let attestation_commitment = hash::sha2_256(bcs::to_bytes(
        &AttestationCommitmentInputV8 {
            domain: b"animacraft-v8/runtime/external-attestation",
            version: VERSION,
            catalog_id,
            product_id: object::id(product),
            root_id: product.root_id,
            root_version: product.root_version,
            root_content_commitment: product.root_content_commitment,
            compatibility_commitment: product.compatibility_commitment,
            product_content_commitment: product.content_commitment,
        },
    ));
    ExternalItemAttestationV8 {
        catalog_id,
        product_id: object::id(product),
        root_id: product.root_id,
        root_version: product.root_version,
        root_content_commitment: product.root_content_commitment,
        compatibility_commitment: product.compatibility_commitment,
        product_content_commitment: product.content_commitment,
        attestation_commitment,
    }
}

public fun admit_open_external_product_v8<PaymentCoin>(
    registry: &mut PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    product: &ExternalItemProductV8,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert!(definitions.admission_ceiling == ADMISSION_OPEN, EAdmissionDenied);
    admit_external_product(
        registry, authority, definitions, root, maker_admin, product,
        option::none(), expected_revision, ctx,
    );
}

public fun admit_certified_external_product_v8<PaymentCoin>(
    registry: &mut PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    product: &ExternalItemProductV8,
    attestation: ExternalItemAttestationV8,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert!(definitions.admission_ceiling >= ADMISSION_CERTIFIED, EAdmissionDenied);
    let ExternalItemAttestationV8 {
        catalog_id, product_id, root_id, root_version,
        root_content_commitment, compatibility_commitment,
        product_content_commitment, attestation_commitment,
    } = attestation;
    assert!(catalog_id == maker::root_product_release_catalog_id_v8(root), EAttestationRequired);
    assert!(product_id == object::id(product), EAttestationRequired);
    assert!(root_id == product.root_id, EAttestationRequired);
    assert!(root_version == product.root_version, EAttestationRequired);
    assert!(root_content_commitment == product.root_content_commitment, EAttestationRequired);
    assert!(compatibility_commitment == product.compatibility_commitment, EAttestationRequired);
    assert!(product_content_commitment == product.content_commitment, EAttestationRequired);
    admit_external_product(
        registry, authority, definitions, root, maker_admin, product,
        option::some(attestation_commitment), expected_revision, ctx,
    );
}

public fun revoke_external_product_v8<PaymentCoin>(
    registry: &mut PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    product_id: ID,
    expected_revision: u64,
    ctx: &TxContext,
) {
    maker::assert_admin_v8(root, maker_admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EWrongControl);
    assert_pack_registry_identity(registry, definitions, root);
    assert_authority_identity(authority, registry, root);
    assert!(registry.revision == expected_revision, EStaleRevision);
    let record = registry.external_admissions.borrow_mut(product_id);
    assert!(record.admission_state == ADMISSION_ACTIVE, EAdmissionDenied);
    record.admission_state = ADMISSION_REVOKED;
    registry.revision = registry.revision + 1;
    event::emit(PackRegistryRevisionAdvancedV8 {
        root_id: registry.root_id,
        previous_revision: expected_revision,
        revision: registry.revision,
        subject_id: product_id,
        operation: 3,
    });
}

public fun pause_external_product_v8(
    product: &mut ExternalItemProductV8,
    cap: &ExternalItemAdminCapV8,
    ctx: &TxContext,
) {
    assert_product_control(product, cap, ctx);
    assert!(product.lifecycle == PRODUCT_ACTIVE, EInvalidLifecycle);
    product.lifecycle = PRODUCT_PAUSED;
}

public fun resume_external_product_v8(
    product: &mut ExternalItemProductV8,
    cap: &ExternalItemAdminCapV8,
    ctx: &TxContext,
) {
    assert_product_control(product, cap, ctx);
    assert!(product.lifecycle == PRODUCT_PAUSED, EInvalidLifecycle);
    product.lifecycle = PRODUCT_ACTIVE;
}

public fun archive_external_product_v8(
    product: &mut ExternalItemProductV8,
    cap: &ExternalItemAdminCapV8,
    ctx: &TxContext,
) {
    assert_product_control(product, cap, ctx);
    assert!(product.lifecycle != PRODUCT_ARCHIVED, EInvalidLifecycle);
    product.lifecycle = PRODUCT_ARCHIVED;
}

public fun share_external_item_product_v8(product: ExternalItemProductV8) {
    transfer::share_object(product)
}

public fun transfer_external_item_admin_cap_v8(
    cap: ExternalItemAdminCapV8,
    recipient: address,
) {
    assert!(recipient != @0x0 && cap.owner == recipient, EWrongControl);
    transfer::transfer(cap, recipient)
}

public fun transfer_external_item_control_v8(
    product: &mut ExternalItemProductV8,
    mut cap: ExternalItemAdminCapV8,
    recipient: address,
    ctx: &TxContext,
) {
    assert_product_control(product, &cap, ctx);
    assert!(recipient != @0x0 && recipient != product.owner, EInvalidRecipient);
    product.owner = recipient;
    product.control_epoch = product.control_epoch + 1;
    cap.owner = recipient;
    cap.control_epoch = product.control_epoch;
    transfer::transfer(cap, recipient)
}

public fun mint_owned_external_item_v8(
    product: &mut ExternalItemProductV8,
    cap: &ExternalItemAdminCapV8,
    recipient: address,
    ctx: &mut TxContext,
): OwnedExternalItemV8 {
    assert_product_control(product, cap, ctx);
    assert!(product.lifecycle == PRODUCT_ACTIVE, EInvalidLifecycle);
    assert!(recipient != @0x0, EInvalidRecipient);
    product.supply = product.supply + 1;
    OwnedExternalItemV8 {
        id: object::new(ctx),
        version: VERSION,
        product_id: object::id(product),
        product_content_commitment: product.content_commitment,
        asset_content_commitment: product.asset_content_commitment,
        holder: recipient,
        ownership_epoch: 0,
        transferable: product.transferable,
        equip_lock: option::none(),
    }
}

public fun transfer_new_owned_item_to_holder_v8(item: OwnedExternalItemV8) {
    let holder = item.holder;
    transfer::transfer(item, holder)
}

public fun transfer_owned_external_item_v8(
    mut item: OwnedExternalItemV8,
    recipient: address,
    ctx: &TxContext,
) {
    prepare_owned_item_transfer(&mut item, recipient, ctx);
    transfer::transfer(item, recipient)
}

fun prepare_owned_item_transfer(
    item: &mut OwnedExternalItemV8,
    recipient: address,
    ctx: &TxContext,
) {
    assert_owned_holder(item, ctx);
    assert!(item.transferable, EAdmissionDenied);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    assert!(recipient != @0x0, EInvalidRecipient);
    item.holder = recipient;
    item.ownership_epoch = item.ownership_epoch + 1;
}

/// Claims one official Base Item for this holder. The exact Maker access pass
/// is the issuance entitlement; the registry prevents a second claim of the
/// same Item by the same holder.
public fun claim_owned_base_item_v8<PaymentCoin>(
    packs: &mut PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    part_key: String,
    item_key: String,
    ctx: &mut TxContext,
): OwnedBaseItemV8 {
    assert_root_active(root);
    assert_pack_registry_identity(packs, definitions, root);
    assert_definition_binding(definitions, root, base_registry);
    assert!(definitions.sealed, ENotSealed);
    assert!(definitions.item_assetization, EInvalidPolicy);
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    let item = base::borrow_item_v2(base_registry, part_key, item_key);
    base::assert_public_item_v2(item);
    let key = BaseItemHolderKeyV8 { part_key, item_key, holder: ctx.sender() };
    assert!(!packs.base_item_owners.contains(key), EDuplicate);
    let uid = object::new(ctx);
    let item_id = uid.to_inner();
    let owned = OwnedBaseItemV8 {
        id: uid,
        version: VERSION,
        root_id: definitions.root_id,
        root_version: definitions.root_version,
        root_content_commitment: definitions.root_content_commitment,
        definition_registry_id: object::id(definitions),
        pack_registry_id: object::id(packs),
        base_registry_id: definitions.base_registry_id,
        part_key,
        item_key,
        item_payload_commitment: *base::item_payload_commitment_v2(item),
        holder: ctx.sender(),
        ownership_epoch: 0,
        transferable: true,
        equip_lock: option::none(),
    };
    packs.base_item_owners.add(key, BaseItemOwnershipRecordV8 {
        item_id,
        ownership_epoch: 0,
    });
    packs.wardrobe_revision = packs.wardrobe_revision + 1;
    packs.base_item_count = packs.base_item_count + 1;
    event::emit(BaseItemOwnershipChangedV8 {
        item_id,
        part_key,
        item_key,
        previous_holder: option::none(),
        holder: ctx.sender(),
        ownership_epoch: 0,
    });
    owned
}

public fun transfer_new_owned_base_item_to_holder_v8(item: OwnedBaseItemV8) {
    let holder = item.holder;
    transfer::transfer(item, holder)
}

/// Transfers custody and atomically rotates the one-per-holder entitlement.
/// An equipped item can never move to a second wallet.
public fun transfer_owned_base_item_v8(
    packs: &mut PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    mut item: OwnedBaseItemV8,
    recipient: address,
    ctx: &TxContext,
) {
    prepare_owned_base_item_transfer(packs, definitions, &mut item, recipient, ctx);
    transfer::transfer(item, recipient)
}

fun prepare_owned_base_item_transfer(
    packs: &mut PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    item: &mut OwnedBaseItemV8,
    recipient: address,
    ctx: &TxContext,
) {
    assert_owned_base_holder(item, ctx);
    rotate_owned_base_item_holder(packs, definitions, item, recipient)
}

/// Called only after either the wallet-holder or exact market-custody proof.
/// Keep the one-per-holder registry mutation identical in both paths.
fun rotate_owned_base_item_holder(
    packs: &mut PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    item: &mut OwnedBaseItemV8,
    recipient: address,
) {
    assert_owned_base_item_registry(item, packs, definitions);
    assert!(item.transferable, EItemNotTransferable);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    assert!(recipient != @0x0 && recipient != item.holder, EInvalidRecipient);
    let old_key = BaseItemHolderKeyV8 {
        part_key: item.part_key,
        item_key: item.item_key,
        holder: item.holder,
    };
    let old_record = packs.base_item_owners.remove(old_key);
    assert!(old_record.item_id == object::id(item), EInvalidBinding);
    assert!(old_record.ownership_epoch == item.ownership_epoch, EInvalidBinding);
    let new_key = BaseItemHolderKeyV8 {
        part_key: item.part_key,
        item_key: item.item_key,
        holder: recipient,
    };
    assert!(!packs.base_item_owners.contains(new_key), ERecipientAlreadyOwned);
    let previous_holder = item.holder;
    item.holder = recipient;
    item.ownership_epoch = item.ownership_epoch + 1;
    packs.base_item_owners.add(new_key, BaseItemOwnershipRecordV8 {
        item_id: object::id(item),
        ownership_epoch: item.ownership_epoch,
    });
    packs.wardrobe_revision = packs.wardrobe_revision + 1;
    event::emit(BaseItemOwnershipChangedV8 {
        item_id: object::id(item),
        part_key: item.part_key,
        item_key: item.item_key,
        previous_holder: option::some(previous_holder),
        holder: recipient,
        ownership_epoch: item.ownership_epoch,
    })
}

/// The instance becomes an address-owned child of the listing. Its logical
/// holder, epoch and Base entitlement remain reserved until buy or cancellation.
public fun custody_owned_base_item_for_market_v8<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    item: OwnedBaseItemV8,
    ctx: &TxContext,
): EquipmentMarketCustodyTicketV8 {
    assert_equipment_market_current(root, protocol_config, catalog, replacement,
        market_call_cap, market_registry, market_treasury);
    assert_equipment_market_base_registries(root, packs, definitions);
    assert_definition_binding(definitions, root, base_registry);
    assert_owned_base_item(&item, packs, definitions, base_registry, ctx);
    assert!(item.transferable, EItemNotTransferable);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    let custody = new_equipment_market_custody(root, catalog, market_registry,
        market_treasury, listing_parent, object::id(&item), SOURCE_BASE,
        item.base_registry_id, equipment_market_asset_commitment(&item),
        item.holder, item.ownership_epoch);
    emit_equipment_market_transition(&custody, 0, item.holder, item.ownership_epoch);
    transfer::transfer(item, custody.listing_id.to_address());
    EquipmentMarketCustodyTicketV8 { binding: custody }
}

/// Ownership is independent of current product admission/lifecycle. A genuine
/// already-issued transferable instance may be sold without buying access again.
public fun custody_owned_external_item_for_market_v8<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    product: &ExternalItemProductV8,
    item: OwnedExternalItemV8,
    ctx: &TxContext,
): EquipmentMarketCustodyTicketV8 {
    assert_equipment_market_current(root, protocol_config, catalog, replacement,
        market_call_cap, market_registry, market_treasury);
    assert_owned_holder(&item, ctx);
    maker::assert_root_identity_v8(root, product.root_id, product.root_version,
        &product.root_content_commitment);
    assert!(product.version == VERSION, EInvalidBinding);
    assert!(item.product_id == object::id(product), EInvalidBinding);
    assert!(item.product_content_commitment == product.content_commitment, EInvalidBinding);
    assert!(item.asset_content_commitment == product.asset_content_commitment, EInvalidBinding);
    assert!(item.transferable == product.transferable && item.transferable, EItemNotTransferable);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    let custody = new_equipment_market_custody(root, catalog, market_registry,
        market_treasury, listing_parent, object::id(&item), SOURCE_EXTERNAL,
        item.product_id, equipment_market_asset_commitment(&item),
        item.holder, item.ownership_epoch);
    emit_equipment_market_transition(&custody, 0, item.holder, item.ownership_epoch);
    transfer::transfer(item, custody.listing_id.to_address());
    EquipmentMarketCustodyTicketV8 { binding: custody }
}

public fun consume_equipment_market_custody_ticket_v8(
    ticket: EquipmentMarketCustodyTicketV8,
): EquipmentMarketCustodyBindingV8 {
    let EquipmentMarketCustodyTicketV8 { binding } = ticket;
    binding
}

public fun borrow_equipment_market_custody_ticket_binding_v8(
    ticket: &EquipmentMarketCustodyTicketV8,
): &EquipmentMarketCustodyBindingV8 { &ticket.binding }

/// No active/protocol-revision gate: cancellation returns only to the recorded
/// seller and leaves all ownership/entitlement bytes unchanged.
public fun return_owned_base_item_from_market_v8<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    receiving: Receiving<OwnedBaseItemV8>,
    custody: &EquipmentMarketCustodyBindingV8,
) {
    assert_equipment_market_custody(root, catalog, replacement, market_call_cap,
        market_registry, market_treasury, listing_parent, custody);
    assert_equipment_market_base_registries(root, packs, definitions);
    let item = receive_market_base_item(listing_parent, receiving, custody);
    assert_owned_base_item_registry(&item, packs, definitions);
    assert_owned_base_item_record(&item, packs);
    emit_equipment_market_transition(custody, 2, item.holder, item.ownership_epoch);
    transfer::transfer(item, custody.holder)
}

public fun return_owned_external_item_from_market_v8<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    receiving: Receiving<OwnedExternalItemV8>,
    custody: &EquipmentMarketCustodyBindingV8,
) {
    assert_equipment_market_custody(root, catalog, replacement, market_call_cap,
        market_registry, market_treasury, listing_parent, custody);
    let item = receive_market_external_item(listing_parent, receiving, custody);
    emit_equipment_market_transition(custody, 2, item.holder, item.ownership_epoch);
    transfer::transfer(item, custody.holder)
}

/// Market must settle payment in the same transaction. Only its private cap
/// can reach this primitive; the buyer is always the transaction sender.
public fun purchase_owned_base_item_from_market_v8<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    packs: &mut PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    receiving: Receiving<OwnedBaseItemV8>,
    custody: &EquipmentMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    assert_equipment_market_current(root, protocol_config, catalog, replacement,
        market_call_cap, market_registry, market_treasury);
    assert_equipment_market_custody(root, catalog, replacement, market_call_cap,
        market_registry, market_treasury, listing_parent, custody);
    assert_equipment_market_base_registries(root, packs, definitions);
    let mut item = receive_market_base_item(listing_parent, receiving, custody);
    rotate_owned_base_item_holder(packs, definitions, &mut item, ctx.sender());
    emit_equipment_market_transition(custody, 1, item.holder, item.ownership_epoch);
    transfer::transfer(item, ctx.sender())
}

public fun purchase_owned_external_item_from_market_v8<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    receiving: Receiving<OwnedExternalItemV8>,
    custody: &EquipmentMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    assert_equipment_market_current(root, protocol_config, catalog, replacement,
        market_call_cap, market_registry, market_treasury);
    assert_equipment_market_custody(root, catalog, replacement, market_call_cap,
        market_registry, market_treasury, listing_parent, custody);
    let mut item = receive_market_external_item(listing_parent, receiving, custody);
    assert!(ctx.sender() != @0x0 && ctx.sender() != item.holder, EInvalidRecipient);
    item.holder = ctx.sender();
    item.ownership_epoch = item.ownership_epoch + 1;
    emit_equipment_market_transition(custody, 1, item.holder, item.ownership_epoch);
    transfer::transfer(item, ctx.sender())
}

#[allow(lint(unused_object_with_fields))]
fun assert_equipment_market_authority<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
) {
    binding::assert_runtime_caller_cap_v1(market_call_cap, 1, replacement, catalog);
    maker::assert_product_release_catalog_v8(root, catalog);
    let market_binding = binding::binding_at_v2(binding::catalog_binding_v8(catalog), 5);
    binding::assert_exact_single_argument_type_v2<MarketRegistry, PaymentCoin>(
        market_binding, &b"market_v8", &b"MarketRegistryV8");
    binding::assert_exact_single_argument_type_v2<MarketTreasury, PaymentCoin>(
        market_binding, &b"market_v8", &b"MarketTreasuryV8");
    assert!(companion::market_registry_id_v2(maker::root_companion_registry_ids_v2(root))
        == object::id(market_registry), EInvalidEquipmentMarketAuthority);
    // The exact Market package checks registry -> treasury before exposing its
    // private cap; later releases also match the frozen treasury ID below.
    assert!(object::id(market_registry) != object::id(market_treasury), EInvalidEquipmentMarketAuthority);
}

fun assert_equipment_market_current<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
) {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_equipment_market_authority(root, catalog, replacement, market_call_cap,
        market_registry, market_treasury);
}

fun assert_equipment_market_base_registries<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
) {
    assert_pack_registry_identity(packs, definitions, root);
    let ids = maker::root_companion_registry_ids_v2(root);
    assert!(companion::pack_registry_id_v2(ids) == object::id(packs), EInvalidBinding);
    assert!(companion::runtime_definition_registry_id_v2(ids) == object::id(definitions), EInvalidBinding);
    assert!(definitions.sealed, ENotSealed);
}

fun equipment_market_asset_commitment<Asset: key>(asset: &Asset): vector<u8> {
    let mut bytes = b"animacraft-v8/runtime/equipment-market-asset";
    bytes.append(bcs::to_bytes(asset));
    hash::sha2_256(bytes)
}

fun new_equipment_market_custody<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &UID,
    asset_id: ID,
    asset_kind: u8,
    source_id: ID,
    asset_commitment: vector<u8>,
    holder: address,
    ownership_epoch: u64,
): EquipmentMarketCustodyBindingV8 {
    let (_, _, _, product, call_cap_set, _) = binding::catalog_terms_v2(catalog);
    EquipmentMarketCustodyBindingV8 {
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *call_cap_set,
        market_authority_id: binding::catalog_authority_id_v2(catalog, 4),
        market_registry_id: object::id(market_registry),
        market_treasury_id: object::id(market_treasury),
        listing_id: object::uid_to_inner(listing_parent),
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        asset_id, asset_kind, source_id, asset_commitment, holder, ownership_epoch,
    }
}

fun assert_equipment_market_custody<PaymentCoin, MarketRegistry: key, MarketTreasury: key>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &UID,
    custody: &EquipmentMarketCustodyBindingV8,
) {
    assert_equipment_market_authority(root, catalog, replacement, market_call_cap,
        market_registry, market_treasury);
    let (_, _, _, product, call_cap_set, _) = binding::catalog_terms_v2(catalog);
    assert!(custody.version == VERSION
        && custody.catalog_id == binding::catalog_id_v8(catalog)
        && &custody.product_binding_commitment == binding::product_binding_commitment_v8(product)
        && &custody.call_cap_set_commitment == call_cap_set
        && custody.market_authority_id == binding::catalog_authority_id_v2(catalog, 4)
        && custody.market_registry_id == object::id(market_registry)
        && custody.market_treasury_id == object::id(market_treasury)
        && custody.listing_id == object::uid_to_inner(listing_parent), EInvalidEquipmentMarketCustody);
    maker::assert_root_identity_v8(root, custody.root_id, custody.maker_version,
        &custody.root_content_commitment);
}

fun receive_market_base_item(
    listing_parent: &mut UID,
    receiving: Receiving<OwnedBaseItemV8>,
    custody: &EquipmentMarketCustodyBindingV8,
): OwnedBaseItemV8 {
    assert!(custody.asset_kind == SOURCE_BASE, EInvalidEquipmentMarketCustody);
    let item = transfer::receive(listing_parent, receiving);
    assert!(object::id(&item) == custody.asset_id && item.base_registry_id == custody.source_id
        && item.holder == custody.holder && item.ownership_epoch == custody.ownership_epoch
        && item.version == VERSION && item.transferable && item.equip_lock.is_none()
        && equipment_market_asset_commitment(&item) == custody.asset_commitment,
        EInvalidEquipmentMarketCustody);
    item
}

fun receive_market_external_item(
    listing_parent: &mut UID,
    receiving: Receiving<OwnedExternalItemV8>,
    custody: &EquipmentMarketCustodyBindingV8,
): OwnedExternalItemV8 {
    assert!(custody.asset_kind == SOURCE_EXTERNAL, EInvalidEquipmentMarketCustody);
    let item = transfer::receive(listing_parent, receiving);
    assert!(object::id(&item) == custody.asset_id && item.product_id == custody.source_id
        && item.holder == custody.holder && item.ownership_epoch == custody.ownership_epoch
        && item.version == VERSION && item.transferable && item.equip_lock.is_none()
        && equipment_market_asset_commitment(&item) == custody.asset_commitment,
        EInvalidEquipmentMarketCustody);
    item
}

fun emit_equipment_market_transition(
    custody: &EquipmentMarketCustodyBindingV8,
    action: u8,
    holder: address,
    ownership_epoch: u64,
) {
    event::emit(EquipmentMarketCustodyTransitionV8 {
        action, listing_id: custody.listing_id, asset_id: custody.asset_id,
        asset_kind: custody.asset_kind, source_id: custody.source_id,
        previous_holder: custody.holder, holder,
        previous_ownership_epoch: custody.ownership_epoch, ownership_epoch,
        asset_commitment: custody.asset_commitment,
    });
}

public fun create_maker_loadout_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    maker_access: &MakerAccessPassV8,
    ctx: &mut TxContext,
): MakerLoadoutV8 {
    create_loadout(root, definitions, packs, maker_access, false, ctx)
}

fun create_loadout<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8, maker_access: &MakerAccessPassV8,
    equipment_layout: bool, ctx: &mut TxContext,
): MakerLoadoutV8 {
    assert_root_active(root);
    assert_definition_identity(definitions, root);
    assert!(definitions.sealed, ENotSealed);
    assert_pack_registry_identity(packs, definitions, root);
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    let slot_count = if (equipment_layout) definitions.profile_keys.length() else total_slot_capacity(definitions);
    let definition_slots = definition_slots_for_layout(definitions, equipment_layout);
    assert!(slot_count > 0 && slot_count <= MAX_LOADOUT_SELECTIONS, EInvalidCount);
    let mut selections = vector[];
    let mut i = 0;
    while (i < slot_count) {
        selections.push_back(option::none());
        i = i + 1;
    };
    let commitment = canonical_loadout_commitment(
        definitions.root_id,
        definitions.root_version,
        definitions.root_content_commitment,
        &vector[],
        &definition_slots,
        &selections,
    );
    let mut loadout = MakerLoadoutV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id: definitions.root_id,
        root_version: definitions.root_version,
        root_content_commitment: definitions.root_content_commitment,
        definition_registry_id: object::id(definitions),
        pack_registry_id: object::id(packs),
        maker_access_pass_id: sui::object::id(maker_access),
        maker_access_commitment: maker_access_entitlement_commitment_v8(maker_access),
        holder: ctx.sender(),
        revision: 0,
        attached_pack_definitions: vector[],
        definition_slots,
        selections,
        selection_count: 0,
        commitment,
    };
    if (equipment_layout) df::add(&mut loadout.id, SoulEquipmentLayoutKeyV8 {}, true);
    loadout
}

public fun transfer_maker_loadout_to_holder_v8(loadout: MakerLoadoutV8) {
    assert!(!is_soul_equipment_v8(&loadout), EEquipLocked);
    let holder = loadout.holder;
    transfer::transfer(loadout, holder)
}

public fun is_soul_equipment_v8(loadout: &MakerLoadoutV8): bool {
    df::exists_with_type<SoulEquipmentKeyV8, SoulEquipmentBindingV8>(&loadout.id, SoulEquipmentKeyV8 {})
}

fun has_equipment_layout(loadout: &MakerLoadoutV8): bool {
    df::exists_with_type<SoulEquipmentLayoutKeyV8, bool>(&loadout.id, SoulEquipmentLayoutKeyV8 {})
}

fun loadout_part_capacity(loadout: &MakerLoadoutV8, profile: &PartProfileV8): u64 {
    if (has_equipment_layout(loadout)) 1 else profile.capacity
}
public fun soul_equipment_binding_v8(loadout: &MakerLoadoutV8): &SoulEquipmentBindingV8 {
    df::borrow(&loadout.id, SoulEquipmentKeyV8 {})
}
public fun soul_equipment_soul_id_v8(loadout: &MakerLoadoutV8): ID { soul_equipment_binding_v8(loadout).soul_id }
public fun soul_equipment_state_id_v8(loadout: &MakerLoadoutV8): ID { soul_equipment_binding_v8(loadout).soul_state_id }

fun assert_soul_equipment_claim<W: drop>(witness: &W, binding: &SoulEquipmentBindingV8) {
    assert!(bcs::to_bytes(witness) == bcs::to_bytes(&SoulEquipmentOwnerClaimV8 {
        soul_id: binding.soul_id, soul_state_id: binding.soul_state_id,
        holder: binding.holder, ownership_epoch: binding.ownership_epoch,
    }), EWrongHolder);
}

// create_loadout always allocates a fresh UID in this transaction.
// The type-level linter also sees the separate owned Player loadout path; no
// caller-supplied loadout can reach this share.
#[allow(lint(share_owned))]
public fun create_soul_equipment_v8<PaymentCoin, W: drop>(
    root: &MakerRootV8<PaymentCoin>, protocol: &ProtocolConfigV8,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    maker_access: &MakerAccessPassV8, soul_id: ID, soul_state_id: ID,
    ownership_epoch: u64, witness: W, ctx: &mut TxContext,
): ID {
    maker::assert_current_protocol_config_v8(root, protocol);
    native_binding::assert_owner_witness_v8<W>(protocol);
    let binding = SoulEquipmentBindingV8 {
        soul_id, soul_state_id, holder: ctx.sender(), ownership_epoch,
        protocol_config_id: object::id(protocol),
    };
    assert_soul_equipment_claim(&witness, &binding);
    let _ = witness;
    let mut loadout = create_loadout(root, definitions, packs, maker_access, true, ctx);
    df::add(&mut loadout.id, SoulEquipmentKeyV8 {}, binding);
    let id = object::id(&loadout);
    emit_soul_equipment_changed(&loadout, soul_equipment_binding_v8(&loadout));
    transfer::share_object(loadout);
    id
}

/// Read-only live native-owner authorization. Keep the binding installed and
/// require the exact frozen witness type; existing selections retain their own
/// entitlement checks in Runtime/Seal after this native guard succeeds.
public fun assert_soul_equipment_read_v8<W: drop>(
    equipment: &MakerLoadoutV8, protocol: &ProtocolConfigV8,
    witness: W, ctx: &TxContext,
) {
    native_binding::assert_owner_witness_v8<W>(protocol);
    assert!(equipment.version == VERSION && is_soul_equipment_v8(equipment)
        && has_equipment_layout(equipment), EInvalidBinding);
    let binding = soul_equipment_binding_v8(equipment);
    assert!(binding.protocol_config_id == object::id(protocol), EInvalidBinding);
    assert!(binding.holder == ctx.sender() && equipment.holder == ctx.sender(), EWrongHolder);
    assert_soul_equipment_claim(&witness, binding);
    let _ = witness;
}

public fun begin_soul_equipment_update_v8<W: drop>(
    loadout: &mut MakerLoadoutV8, protocol: &ProtocolConfigV8,
    expected_revision: u64, witness: W, ctx: &TxContext,
): SoulEquipmentUpdateV8 {
    assert!(has_equipment_layout(loadout), EInvalidBinding);
    native_binding::assert_owner_witness_v8<W>(protocol);
    let binding = *soul_equipment_binding_v8(loadout);
    assert!(binding.protocol_config_id == object::id(protocol), EInvalidBinding);
    assert!(binding.holder == ctx.sender() && loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.revision == expected_revision, EStaleRevision);
    assert_soul_equipment_claim(&witness, &binding);
    let _ = witness;
    let binding = df::remove(&mut loadout.id, SoulEquipmentKeyV8 {});
    SoulEquipmentUpdateV8 { loadout_id: object::id(loadout), binding }
}

/// An adapter borrows the same transaction-wide guard for each mutation. Raw
/// Player mutations still reject bound equipment; opening it always creates
/// this non-droppable final-validation obligation.
public fun assert_soul_equipment_update_v8(
    loadout: &MakerLoadoutV8, update: &SoulEquipmentUpdateV8, ctx: &TxContext,
) {
    assert_equipment_update_binding(loadout, update);
    assert!(update.binding.holder == ctx.sender(), EWrongHolder);
}

fun assert_equipment_update_binding(loadout: &MakerLoadoutV8, update: &SoulEquipmentUpdateV8) {
    assert!(update.loadout_id == object::id(loadout) && loadout.version == VERSION
        && loadout.holder == update.binding.holder && !is_soul_equipment_v8(loadout)
        && has_equipment_layout(loadout), EInvalidBinding);
}

/// One final condition check, not a Complete authorization. Empty/sparse
/// equipment, outstanding combination rules and recovery without entitlement
/// or decrypt access remain valid. Only selected definition visibility applies.
public fun finish_soul_equipment_update_v8(
    loadout: &mut MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8, pack_proofs: vector<PackDefinitionProofV8>, update: SoulEquipmentUpdateV8,
) {
    assert_equipment_update_binding(loadout, &update);
    assert!(loadout.definition_registry_id == object::id(definitions)
        && definitions.version == VERSION && definitions.root_id == loadout.root_id
        && definitions.root_version == loadout.root_version
        && definitions.root_content_commitment == loadout.root_content_commitment,
        EInvalidBinding);
    assert!(definitions.sealed && base::registry_sealed_v2(base_registry), ENotSealed);
    assert!(definitions.base_registry_id == object::id(base_registry)
        && base::registry_root_id_v2(base_registry) == loadout.root_id
        && base::registry_maker_version_v2(base_registry) == loadout.root_version
        && base::registry_root_content_commitment_v2(base_registry) == &loadout.root_content_commitment,
        EInvalidBinding);
    let _ = consume_pack_definition_proofs(loadout, definitions, pack_proofs, false);
    assert_loadout_visibility(loadout, base_registry);
    let SoulEquipmentUpdateV8 { loadout_id: _, binding } = update;
    df::add(&mut loadout.id, SoulEquipmentKeyV8 {}, binding);
    emit_soul_equipment_changed(loadout, &binding);
}

fun emit_soul_equipment_changed(loadout: &MakerLoadoutV8, binding: &SoulEquipmentBindingV8) {
    event::emit(SoulEquipmentChangedV8 {
        soul_id: binding.soul_id, soul_state_id: binding.soul_state_id,
        loadout_id: object::id(loadout), holder: binding.holder,
        ownership_epoch: binding.ownership_epoch, revision: loadout.revision,
        selection_count: loadout.selection_count, commitment: loadout.commitment,
    });
}

/// Close only empty equipment. Every actual instance must first be unequipped,
/// so closing cannot strand a wallet component's lock or sell it with the Soul.
public fun close_soul_equipment_v8<W: drop>(
    mut loadout: MakerLoadoutV8, protocol: &ProtocolConfigV8,
    revision: u64, witness: W, ctx: &TxContext,
): ID {
    let guard = begin_soul_equipment_update_v8(&mut loadout, protocol, revision, witness, ctx);
    assert!(loadout.selection_count == 0, EEquipLocked);
    let SoulEquipmentUpdateV8 { loadout_id, binding: _ } = guard;
    let _: bool = df::remove(&mut loadout.id, SoulEquipmentLayoutKeyV8 {});
    let MakerLoadoutV8 {
        id, version: _, root_id: _, root_version: _, root_content_commitment: _,
        definition_registry_id: _, pack_registry_id: _, maker_access_pass_id: _,
        maker_access_commitment: _, holder: _, revision: _, attached_pack_definitions: _, definition_slots: _, selections,
        selection_count: _, commitment: _,
    } = loadout;
    selections.do!(|selection| assert!(selection.is_none(), EEquipLocked));
    id.delete();
    loadout_id
}

public fun select_base_style_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    target_selection_index: Option<u64>,
    part_key: String,
    item_key: String,
    style_key: String,
    swatch_key: Option<String>,
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_definition_binding(definitions, root, base_registry);
    assert!(!definitions.item_assetization, EOwnedInstanceRequired);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key });
    let selection_index = selection_slot(loadout, definitions, profile, target_selection_index);
    let item = base::borrow_item_v2(base_registry, part_key, item_key);
    base::assert_public_item_v2(item);
    let style = base::borrow_style_v2(base_registry, part_key, item_key, style_key);
    let layer_track_key = *base::style_layer_track_key_v2(style);
    let _track = base::borrow_track_v2(base_registry, layer_track_key);
    let color_channel_key = *base::style_color_channel_key_v2(style);
    let selected_swatch = exact_selected_swatch(
        base_registry,
        &color_channel_key,
        swatch_key,
    );
    let selection = LoadoutSelectionV8 {
        selection_index,
        part_key,
        item_key,
        style_key,
        color_channel_key,
        swatch_key: selected_swatch,
        layer_track_key,
        asset_blob_id: *base::style_asset_blob_id_v2(style),
        asset_sha256: *base::style_asset_sha256_v2(style),
        asset_content_commitment: *base::style_payload_commitment_v2(style),
        source_class: SOURCE_BASE,
        source_definition_id: loadout.root_id,
        source_semantic_id: b"".to_string(),
        access_subject: loadout.maker_access_pass_id,
        source_epoch: 0,
        pricing_commitment: loadout.maker_access_commitment,
        protected: base::style_protected_v2(style),
        seal_binding_commitment: vector[],
    };
    // Fail closed until the exact Seal certificate is present.
    assert!(!selection.protected, ENotReady);
    install_selection(loadout, selection_index, selection);
}

/// Equips one Style from an exact holder-owned Base Item. The Item object is
/// locked to the installed global slot until the matching unequip call.
public fun equip_owned_base_style_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    item: &mut OwnedBaseItemV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    target_selection_index: Option<u64>,
    style_key: String,
    swatch_key: Option<String>,
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_definition_binding(definitions, root, base_registry);
    assert!(definitions.item_assetization, EInvalidPolicy);
    assert_owned_base_item(item, packs, definitions, base_registry, ctx);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 {
        part_key: item.part_key,
    });
    let selection_index = selection_slot(loadout, definitions, profile, target_selection_index);
    let style = base::borrow_style_v2(
        base_registry, item.part_key, item.item_key, style_key,
    );
    let layer_track_key = *base::style_layer_track_key_v2(style);
    let _track = base::borrow_track_v2(base_registry, layer_track_key);
    let color_channel_key = *base::style_color_channel_key_v2(style);
    let selected_swatch = exact_selected_swatch(
        base_registry, &color_channel_key, swatch_key,
    );
    let selection = LoadoutSelectionV8 {
        selection_index,
        part_key: item.part_key,
        item_key: item.item_key,
        style_key,
        color_channel_key,
        swatch_key: selected_swatch,
        layer_track_key,
        asset_blob_id: *base::style_asset_blob_id_v2(style),
        asset_sha256: *base::style_asset_sha256_v2(style),
        asset_content_commitment: *base::style_payload_commitment_v2(style),
        source_class: SOURCE_BASE,
        source_definition_id: loadout.root_id,
        source_semantic_id: b"".to_string(),
        access_subject: object::id(item),
        source_epoch: item.ownership_epoch,
        pricing_commitment: owned_base_item_commitment(item),
        protected: base::style_protected_v2(style),
        seal_binding_commitment: vector[],
    };
    assert!(!selection.protected, ENotReady);
    let next_revision = loadout.revision + 1;
    install_selection(loadout, selection_index, selection);
    item.equip_lock = option::some(EquipLockV8 {
        loadout_id: object::id(loadout),
        equip_revision: next_revision,
        selection_index,
    });
    event::emit(BaseItemEquipChangedV8 {
        item_id: object::id(item),
        loadout_id: object::id(loadout),
        revision: next_revision,
        equipped: true,
    });
}

public(package) fun select_protected_base_style_after_seal_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    target_selection_index: Option<u64>,
    part_key: String,
    item_key: String,
    style_key: String,
    swatch_key: Option<String>,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
) {
    assert!(!definitions.item_assetization, EOwnedInstanceRequired);
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_definition_binding(definitions, root, base_registry);
    assert_hash(&seal_binding_commitment);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key });
    let selection_index = selection_slot(loadout, definitions, profile, target_selection_index);
    let item = base::borrow_item_v2(base_registry, part_key, item_key);
    base::assert_public_item_v2(item);
    let style = base::borrow_style_v2(base_registry, part_key, item_key, style_key);
    assert!(base::style_protected_v2(style), EInvalidProof);
    let layer_track_key = *base::style_layer_track_key_v2(style);
    let _track = base::borrow_track_v2(base_registry, layer_track_key);
    let color_channel_key = *base::style_color_channel_key_v2(style);
    let selected_swatch = exact_selected_swatch(base_registry, &color_channel_key, swatch_key);
    let selection = LoadoutSelectionV8 {
        selection_index,
        part_key,
        item_key,
        style_key,
        color_channel_key,
        swatch_key: selected_swatch,
        layer_track_key,
        asset_blob_id: *base::style_asset_blob_id_v2(style),
        asset_sha256: *base::style_asset_sha256_v2(style),
        asset_content_commitment: *base::style_payload_commitment_v2(style),
        source_class: SOURCE_BASE,
        source_definition_id: loadout.root_id,
        source_semantic_id: b"".to_string(),
        access_subject: loadout.maker_access_pass_id,
        source_epoch: 0,
        pricing_commitment: loadout.maker_access_commitment,
        protected: true,
        seal_binding_commitment,
    };
    install_selection(loadout, selection_index, selection);
}

/// Assetized Base variant. The holder-owned Item remains locked to the exact
/// installed slot while Seal's snapshot commitment proves the protected row.
public(package) fun equip_protected_owned_base_style_after_seal_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    item: &mut OwnedBaseItemV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    target_selection_index: Option<u64>,
    style_key: String,
    swatch_key: Option<String>,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_definition_binding(definitions, root, base_registry);
    assert!(definitions.item_assetization, EInvalidPolicy);
    assert_owned_base_item(item, packs, definitions, base_registry, ctx);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    assert_hash(&seal_binding_commitment);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 {
        part_key: item.part_key,
    });
    let selection_index = selection_slot(loadout, definitions, profile, target_selection_index);
    let style = base::borrow_style_v2(
        base_registry, item.part_key, item.item_key, style_key,
    );
    assert!(base::style_protected_v2(style), EInvalidProof);
    let layer_track_key = *base::style_layer_track_key_v2(style);
    let _track = base::borrow_track_v2(base_registry, layer_track_key);
    let color_channel_key = *base::style_color_channel_key_v2(style);
    let selected_swatch = exact_selected_swatch(
        base_registry, &color_channel_key, swatch_key,
    );
    let selection = LoadoutSelectionV8 {
        selection_index,
        part_key: item.part_key,
        item_key: item.item_key,
        style_key,
        color_channel_key,
        swatch_key: selected_swatch,
        layer_track_key,
        asset_blob_id: *base::style_asset_blob_id_v2(style),
        asset_sha256: *base::style_asset_sha256_v2(style),
        asset_content_commitment: *base::style_payload_commitment_v2(style),
        source_class: SOURCE_BASE,
        source_definition_id: loadout.root_id,
        source_semantic_id: b"".to_string(),
        access_subject: object::id(item),
        source_epoch: item.ownership_epoch,
        pricing_commitment: owned_base_item_commitment(item),
        protected: true,
        seal_binding_commitment,
    };
    let next_revision = loadout.revision + 1;
    install_selection(loadout, selection_index, selection);
    item.equip_lock = option::some(EquipLockV8 {
        loadout_id: object::id(loadout),
        equip_revision: next_revision,
        selection_index,
    });
    event::emit(BaseItemEquipChangedV8 {
        item_id: object::id(item),
        loadout_id: object::id(loadout),
        revision: next_revision,
        equipped: true,
    });
}

/// Explicit holder action, not a side effect of global Pack admission. Existing
/// ranges/selections remain byte-for-byte unchanged; new slots append at the end.
public fun attach_pack_definitions_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8, root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, pass: &PackPassV8,
    maker_access: &MakerAccessPassV8, expected_revision: u64, ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_pass(release, pass, ctx.sender());
    let profiles = pack_part_profiles_v8(definitions, release);
    append_pack_definition_slots(loadout, object::id(release),
        pack_definitions_v8(release).commitment, &profiles);
}

fun append_pack_definition_slots(
    loadout: &mut MakerLoadoutV8, release_id: ID, definition_commitment: vector<u8>, profiles: &vector<PartProfileV8>,
) {
    assert!(release_id != loadout.root_id, EInvalidBinding);
    assert_hash(&definition_commitment);
    assert!(loadout.attached_pack_definitions.length() < MAX_LOADOUT_SELECTIONS, EInvalidCount);
    loadout.attached_pack_definitions.do_ref!(|binding| {
        assert!(binding.release_id != release_id, EDuplicate);
    });
    loadout.attached_pack_definitions.push_back(AttachedPackDefinitionV8 { release_id, definition_commitment });
    let mut start = loadout.selections.length();
    profiles.do_ref!(|profile| {
        assert!(profile.capacity > 0 && profile.capacity <= MAX_PART_CAPACITY, EInvalidCount);
        let capacity = loadout_part_capacity(loadout, profile);
        assert!(start + capacity <= MAX_LOADOUT_SELECTIONS, EInvalidCount);
        loadout.definition_slots.push_back(DefinitionSlotV8 {
            source_definition_id: release_id, part_key: profile.part_key,
            profile_commitment: profile.profile_commitment, start, capacity,
        });
        let end = start + capacity;
        while (start < end) {
            loadout.selections.push_back(option::none());
            start = start + 1;
        };
    });
    loadout.revision = loadout.revision + 1;
    recompute_loadout(loadout);
}

public fun select_pack_style_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pass: &PackPassV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    target_selection_index: Option<u64>,
    part_key: String,
    item_key: String,
    style_key: String,
    swatch_key: Option<String>,
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_pass(release, pass, ctx.sender());
    let style = release.styles.borrow(PackStyleKeyV8 { part_key, item_key, style_key });
    assert_pack_definition_attachment(loadout, release);
    assert_definition_binding(definitions, root, base_registry);
    let profile = pack_style_part_profile(definitions, release, style.definition_sources.part, part_key);
    let selection_index = scoped_selection_slot(loadout,
        pack_definition_source_id(release, style.definition_sources.part), &profile, target_selection_index);
    let selected_swatch = exact_pack_swatch(base_registry, release, style, swatch_key);
    let pricing_commitment = pack_pricing_commitment(release);
    let selection = LoadoutSelectionV8 {
        selection_index,
        part_key,
        item_key,
        style_key,
        color_channel_key: style.color_channel_key,
        swatch_key: selected_swatch,
        layer_track_key: style.layer_track_key,
        asset_blob_id: style.asset_blob_id,
        asset_sha256: style.asset_sha256,
        asset_content_commitment: style.asset_content_commitment,
        source_class: SOURCE_PACK,
        source_definition_id: object::id(release),
        source_semantic_id: release.semantic_pack_id,
        access_subject: object::id(pass),
        // Pack ownership/control changes never revoke holder compatibility.
        source_epoch: 0,
        pricing_commitment,
        protected: style.protected,
        seal_binding_commitment: style.seal_binding_commitment,
    };
    install_selection(loadout, selection_index, selection);
}

public fun equip_external_style_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    item: &mut OwnedExternalItemV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    product: &ExternalItemProductV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    target_selection_index: Option<u64>,
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_external_access(packs, product, item, ctx.sender());
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key: product.part_key });
    assert!(profile.wardrobe_mode == WARDROBE_SLOT, EFixedPart);
    assert_external_profile_behavior(profile);
    let selection_index = selection_slot(loadout, definitions, profile, target_selection_index);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    let next_revision = loadout.revision + 1;
    let selection = LoadoutSelectionV8 {
        selection_index,
        part_key: product.part_key,
        item_key: product.item_key,
        style_key: product.style_key,
        color_channel_key: product.color_channel_key,
        swatch_key: product.default_swatch_key,
        layer_track_key: product.layer_track_key,
        asset_blob_id: product.asset_blob_id,
        asset_sha256: product.asset_sha256,
        asset_content_commitment: product.asset_content_commitment,
        source_class: SOURCE_EXTERNAL,
        source_definition_id: object::id(product),
        source_semantic_id: b"".to_string(),
        access_subject: object::id(item),
        source_epoch: item.ownership_epoch,
        pricing_commitment: hash::sha2_256(b"animacraft-v8/runtime/external-pricing"),
        protected: false,
        seal_binding_commitment: vector[],
    };
    install_selection(loadout, selection_index, selection);
    item.equip_lock = option::some(EquipLockV8 {
        loadout_id: object::id(loadout),
        equip_revision: next_revision,
        selection_index,
    });
    event::emit(ExternalItemEquipChangedV8 {
        item_id: object::id(item),
        loadout_id: object::id(loadout),
        revision: next_revision,
        equipped: true,
    });
}

/// Holder-safe for every Root/product lifecycle. It atomically clears both the
/// canonical selection and the owned instance lock.
public fun unequip_external_style_v8(
    loadout: &mut MakerLoadoutV8,
    item: &mut OwnedExternalItemV8,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_loadout_holder_revision(loadout, expected_revision, ctx);
    assert_owned_holder(item, ctx);
    let lock = item.equip_lock.extract();
    assert!(lock.loadout_id == object::id(loadout), ENotEquipped);
    let selection = loadout.selections.borrow(lock.selection_index).borrow();
    assert!(selection.source_class == SOURCE_EXTERNAL, ENotEquipped);
    assert!(selection.access_subject == object::id(item), ENotEquipped);
    clear_selection(loadout, lock.selection_index);
    event::emit(ExternalItemEquipChangedV8 {
        item_id: object::id(item),
        loadout_id: object::id(loadout),
        revision: loadout.revision,
        equipped: false,
    });
}

public fun unequip_owned_base_style_v8(
    loadout: &mut MakerLoadoutV8,
    item: &mut OwnedBaseItemV8,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_loadout_holder_revision(loadout, expected_revision, ctx);
    assert_owned_base_holder(item, ctx);
    let lock = item.equip_lock.extract();
    assert!(lock.loadout_id == object::id(loadout), ENotEquipped);
    let selection = loadout.selections.borrow(lock.selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE, ENotEquipped);
    assert!(selection.access_subject == object::id(item), ENotEquipped);
    assert!(selection.source_epoch == item.ownership_epoch, ENotEquipped);
    clear_selection(loadout, lock.selection_index);
    event::emit(BaseItemEquipChangedV8 {
        item_id: object::id(item),
        loadout_id: object::id(loadout),
        revision: loadout.revision,
        equipped: false,
    });
}

/// Base and Pack selections can be removed without a source object. This is a
/// recovery operation and therefore remains available while source state is
/// paused or archived.
public fun clear_non_external_selection_v8(
    loadout: &mut MakerLoadoutV8,
    selection_index: u64,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_loadout_holder_revision(loadout, expected_revision, ctx);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class != SOURCE_EXTERNAL, EEquipLocked);
    assert!(selection.source_class != SOURCE_BASE
        || selection.access_subject == loadout.maker_access_pass_id, EEquipLocked);
    clear_selection(loadout, selection_index);
}

public fun prove_base_selection_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    ctx: &TxContext,
): SelectionAccessProofV8 {
    assert!(!definitions.item_assetization, EOwnedInstanceRequired);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.base_registry_id == sui::object::id(base_registry), EInvalidBinding);
    assert!(base::registry_root_id_v2(base_registry) == loadout.root_id, EInvalidBinding);
    assert!(base::registry_maker_version_v2(base_registry) == loadout.root_version, EInvalidBinding);
    assert!(base::registry_root_content_commitment_v2(base_registry)
        == &loadout.root_content_commitment, EInvalidBinding);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE, EInvalidProof);
    assert!(selection.access_subject == loadout.maker_access_pass_id, EInvalidProof);
    assert!(selection.pricing_commitment == loadout.maker_access_commitment, EInvalidProof);
    let item = base::borrow_item_v2(
        base_registry, selection.part_key, selection.item_key);
    base::assert_public_item_v2(item);
    let style = base::borrow_style_v2(
        base_registry, selection.part_key, selection.item_key, selection.style_key,
    );
    assert!(base::style_layer_track_key_v2(style) == &selection.layer_track_key, EInvalidProof);
    assert!(base::style_asset_blob_id_v2(style) == &selection.asset_blob_id, EInvalidProof);
    assert!(base::style_asset_sha256_v2(style) == &selection.asset_sha256, EInvalidProof);
    assert!(base::style_payload_commitment_v2(style) == &selection.asset_content_commitment, EInvalidProof);
    assert!(!selection.protected && !base::style_protected_v2(style), ENotReady);
    new_selection_proof(loadout, selection, loadout.root_content_commitment)
}

public fun prove_owned_base_selection_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    item: &OwnedBaseItemV8,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    ctx: &TxContext,
): SelectionAccessProofV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_pack_registry_identity(packs, definitions, root);
    assert_definition_binding(definitions, root, base_registry);
    assert!(definitions.item_assetization, EInvalidPolicy);
    assert_owned_base_item(item, packs, definitions, base_registry, ctx);
    let lock = item.equip_lock.borrow();
    assert!(lock.loadout_id == object::id(loadout), ENotEquipped);
    assert!(lock.selection_index == selection_index, ENotEquipped);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE, EInvalidProof);
    assert!(selection.access_subject == object::id(item), EInvalidProof);
    assert!(selection.source_epoch == item.ownership_epoch, EInvalidProof);
    assert!(selection.pricing_commitment == owned_base_item_commitment(item), EInvalidProof);
    assert!(selection.part_key == item.part_key && selection.item_key == item.item_key,
        EInvalidProof);
    let style = base::borrow_style_v2(
        base_registry, selection.part_key, selection.item_key, selection.style_key,
    );
    assert!(base::style_layer_track_key_v2(style) == &selection.layer_track_key,
        EInvalidProof);
    assert!(base::style_asset_blob_id_v2(style) == &selection.asset_blob_id,
        EInvalidProof);
    assert!(base::style_asset_sha256_v2(style) == &selection.asset_sha256,
        EInvalidProof);
    assert!(base::style_payload_commitment_v2(style)
        == &selection.asset_content_commitment, EInvalidProof);
    assert!(!selection.protected && !base::style_protected_v2(style), ENotReady);
    new_selection_proof(loadout, selection, loadout.root_content_commitment)
}

public(package) fun prove_protected_base_selection_after_seal_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
): SelectionAccessProofV8 {
    assert!(!definitions.item_assetization, EOwnedInstanceRequired);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.base_registry_id == sui::object::id(base_registry), EInvalidBinding);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE && selection.protected, EInvalidProof);
    assert!(selection.access_subject == loadout.maker_access_pass_id, EInvalidProof);
    assert!(selection.pricing_commitment == loadout.maker_access_commitment, EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    let item = base::borrow_item_v2(
        base_registry, selection.part_key, selection.item_key);
    base::assert_public_item_v2(item);
    let style = base::borrow_style_v2(
        base_registry, selection.part_key, selection.item_key, selection.style_key);
    assert!(base::style_protected_v2(style), EInvalidProof);
    assert!(base::style_layer_track_key_v2(style) == &selection.layer_track_key, EInvalidProof);
    assert!(base::style_asset_blob_id_v2(style) == &selection.asset_blob_id, EInvalidProof);
    assert!(base::style_asset_sha256_v2(style) == &selection.asset_sha256, EInvalidProof);
    assert!(base::style_payload_commitment_v2(style) == &selection.asset_content_commitment, EInvalidProof);
    new_selection_proof(loadout, selection, loadout.root_content_commitment)
}

public(package) fun prove_protected_owned_base_selection_after_seal_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    item: &OwnedBaseItemV8,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
): SelectionAccessProofV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_pack_registry_identity(packs, definitions, root);
    assert_definition_binding(definitions, root, base_registry);
    assert!(definitions.item_assetization, EInvalidPolicy);
    assert_owned_base_item(item, packs, definitions, base_registry, ctx);
    let lock = item.equip_lock.borrow();
    assert!(lock.loadout_id == object::id(loadout), ENotEquipped);
    assert!(lock.selection_index == selection_index, ENotEquipped);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE && selection.protected, EInvalidProof);
    assert!(selection.access_subject == object::id(item), EInvalidProof);
    assert!(selection.source_epoch == item.ownership_epoch, EInvalidProof);
    assert!(selection.pricing_commitment == owned_base_item_commitment(item), EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    assert!(selection.part_key == item.part_key && selection.item_key == item.item_key,
        EInvalidProof);
    let style = base::borrow_style_v2(
        base_registry, selection.part_key, selection.item_key, selection.style_key,
    );
    assert!(base::style_protected_v2(style), EInvalidProof);
    assert!(base::style_layer_track_key_v2(style) == &selection.layer_track_key,
        EInvalidProof);
    assert!(base::style_asset_blob_id_v2(style) == &selection.asset_blob_id,
        EInvalidProof);
    assert!(base::style_asset_sha256_v2(style) == &selection.asset_sha256,
        EInvalidProof);
    assert!(base::style_payload_commitment_v2(style)
        == &selection.asset_content_commitment, EInvalidProof);
    new_selection_proof(loadout, selection, loadout.root_content_commitment)
}

public(package) fun new_base_entitlement_witness_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
): RuntimeBaseEntitlementWitnessV8 {
    assert!(!definitions.item_assetization, EOwnedInstanceRequired);
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    assert!(loadout.maker_access_pass_id
        == sui::object::id(maker_access), EInvalidProof);
    assert!(loadout.maker_access_commitment
        == maker_access_entitlement_commitment_v8(maker_access), EInvalidProof);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.base_registry_id == sui::object::id(base_registry), EInvalidBinding);
    assert_root_compatibility(loadout.root_id, loadout.root_version,
        &loadout.root_content_commitment, root);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE && selection.protected, EInvalidProof);
    assert!(selection.access_subject == loadout.maker_access_pass_id, EInvalidProof);
    assert!(selection.pricing_commitment == loadout.maker_access_commitment, EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    let item = base::borrow_item_v2(
        base_registry, selection.part_key, selection.item_key);
    base::assert_public_item_v2(item);
    let style = base::borrow_style_v2(
        base_registry, selection.part_key, selection.item_key, selection.style_key);
    assert!(base::style_protected_v2(style), EInvalidProof);
    assert!(base::style_payload_commitment_v2(style) == &selection.asset_content_commitment,
        EInvalidProof);
    RuntimeBaseEntitlementWitnessV8 {
        loadout_id: object::id(loadout),
        loadout_revision: loadout.revision,
        selection_index,
        holder: ctx.sender(),
        entitlement_id: sui::object::id(maker_access),
        entitlement_commitment: maker_access_entitlement_commitment_v8(maker_access),
        asset_content_commitment: selection.asset_content_commitment,
    }
}

public(package) fun new_owned_base_entitlement_witness_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    item: &OwnedBaseItemV8,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
): RuntimeBaseEntitlementWitnessV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_pack_registry_identity(packs, definitions, root);
    assert_definition_binding(definitions, root, base_registry);
    assert!(definitions.item_assetization, EInvalidPolicy);
    assert_owned_base_item(item, packs, definitions, base_registry, ctx);
    let lock = item.equip_lock.borrow();
    assert!(lock.loadout_id == object::id(loadout), ENotEquipped);
    assert!(lock.selection_index == selection_index, ENotEquipped);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE && selection.protected, EInvalidProof);
    assert!(selection.access_subject == object::id(item), EInvalidProof);
    assert!(selection.source_epoch == item.ownership_epoch, EInvalidProof);
    assert!(selection.pricing_commitment == owned_base_item_commitment(item), EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    let style = base::borrow_style_v2(
        base_registry, selection.part_key, selection.item_key, selection.style_key,
    );
    assert!(base::style_protected_v2(style), EInvalidProof);
    assert!(base::style_payload_commitment_v2(style)
        == &selection.asset_content_commitment, EInvalidProof);
    RuntimeBaseEntitlementWitnessV8 {
        loadout_id: object::id(loadout),
        loadout_revision: loadout.revision,
        selection_index,
        holder: ctx.sender(),
        entitlement_id: object::id(item),
        entitlement_commitment: owned_base_item_commitment(item),
        asset_content_commitment: loadout.selections.borrow(selection_index)
            .borrow().asset_content_commitment,
    }
}

public(package) fun owned_base_item_entitlement_commitment_v8(
    item: &OwnedBaseItemV8,
): vector<u8> {
    owned_base_item_commitment(item)
}

public fun prove_pack_selection_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pass: &PackPassV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    ctx: &TxContext,
): SelectionAccessProofV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(object::id(packs) == loadout.pack_registry_id, EInvalidBinding);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_pass(release, pass, ctx.sender());
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_PACK, EInvalidProof);
    assert!(selection.source_definition_id == object::id(release), EInvalidProof);
    assert!(&selection.source_semantic_id == &release.semantic_pack_id, EInvalidProof);
    assert!(selection.access_subject == object::id(pass), EInvalidProof);
    assert!(selection.source_epoch == 0, EInvalidProof);
    assert!(selection.pricing_commitment == pack_pricing_commitment(release), EInvalidProof);
    assert_pack_definition_attachment(loadout, release);
    let style = release.styles.borrow(PackStyleKeyV8 {
        part_key: selection.part_key,
        item_key: selection.item_key,
        style_key: selection.style_key,
    });
    assert!(style.asset_content_commitment == selection.asset_content_commitment, EInvalidProof);
    assert!(style.layer_track_key == selection.layer_track_key, EInvalidProof);
    assert!(!style.protected, ENotReady);
    new_selection_proof(loadout, selection, release.content_commitment)
}

public(package) fun prove_protected_pack_selection_after_seal_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pass: &PackPassV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
): SelectionAccessProofV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(object::id(packs) == loadout.pack_registry_id, EInvalidBinding);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_pass(release, pass, ctx.sender());
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_PACK, EInvalidProof);
    assert!(selection.source_definition_id == object::id(release), EInvalidProof);
    assert!(&selection.source_semantic_id == &release.semantic_pack_id, EInvalidProof);
    assert!(selection.access_subject == object::id(pass), EInvalidProof);
    assert!(selection.source_epoch == 0, EInvalidProof);
    assert!(selection.pricing_commitment == pack_pricing_commitment(release), EInvalidProof);
    assert_pack_definition_attachment(loadout, release);
    let style = release.styles.borrow(PackStyleKeyV8 {
        part_key: selection.part_key,
        item_key: selection.item_key,
        style_key: selection.style_key,
    });
    assert!(style.protected && selection.protected, EInvalidProof);
    assert!(style.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    assert!(style.asset_content_commitment == selection.asset_content_commitment, EInvalidProof);
    assert!(style.layer_track_key == selection.layer_track_key, EInvalidProof);
    new_selection_proof(loadout, selection, release.content_commitment)
}

public(package) fun new_pack_entitlement_witness_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pass: &PackPassV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
): RuntimePackEntitlementWitnessV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(object::id(packs) == loadout.pack_registry_id, EInvalidBinding);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_pass(release, pass, ctx.sender());
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_PACK, EInvalidProof);
    assert!(selection.source_definition_id == object::id(release), EInvalidProof);
    assert!(&selection.source_semantic_id == &release.semantic_pack_id, EInvalidProof);
    assert!(selection.access_subject == object::id(pass), EInvalidProof);
    assert!(selection.protected, EInvalidProof);
    assert!(selection.source_epoch == 0, EInvalidProof);
    assert!(selection.pricing_commitment == pack_pricing_commitment(release), EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    let style = release.styles.borrow(PackStyleKeyV8 {
        part_key: selection.part_key,
        item_key: selection.item_key,
        style_key: selection.style_key,
    });
    assert!(style.protected, EInvalidProof);
    assert!(style.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    assert!(style.asset_content_commitment == selection.asset_content_commitment, EInvalidProof);
    RuntimePackEntitlementWitnessV8 {
        loadout_id: object::id(loadout),
        loadout_revision: loadout.revision,
        selection_index,
        holder: ctx.sender(),
        pack_release_id: object::id(release),
        pack_content_commitment: release.content_commitment,
        pack_pass_id: object::id(pass),
        pack_pass_commitment: pass.commitment,
        asset_content_commitment: selection.asset_content_commitment,
    }
}

public fun prove_external_selection_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    packs: &PackRegistryV8,
    product: &ExternalItemProductV8,
    item: &OwnedExternalItemV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    selection_index: u64,
    ctx: &TxContext,
): SelectionAccessProofV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(object::id(packs) == loadout.pack_registry_id, EInvalidBinding);
    assert_external_access(packs, product, item, ctx.sender());
    let lock = item.equip_lock.borrow();
    assert!(lock.loadout_id == object::id(loadout), ENotEquipped);
    assert!(lock.selection_index == selection_index, ENotEquipped);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_EXTERNAL, EInvalidProof);
    assert!(selection.source_definition_id == object::id(product), EInvalidProof);
    assert!(selection.access_subject == object::id(item), EInvalidProof);
    assert!(selection.source_epoch == item.ownership_epoch, EInvalidProof);
    assert!(selection.asset_content_commitment == item.asset_content_commitment, EInvalidProof);
    new_selection_proof(loadout, selection, product.content_commitment)
}

/// Converts an already entitlement-checked proof into the exact current
/// selection witness used by Output. The index, identities, revisions, and
/// commitments all come from the consumed proof and live loadout.
public fun certify_physical_selection_v8(
    proof: SelectionAccessProofV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): RuntimePhysicalSelectionWitnessV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    let SelectionAccessProofV8 {
        loadout_id, loadout_revision, loadout_commitment, selection_index,
        selection_commitment, source_class, source_definition_id,
        source_semantic_id, source_content_commitment, source_epoch,
        pricing_commitment,
    } = proof;
    assert!(loadout_id == object::id(loadout), EInvalidProof);
    assert!(loadout_revision == loadout.revision, EInvalidProof);
    assert!(loadout_commitment == loadout.commitment, EInvalidProof);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.selection_index == selection_index, EInvalidProof);
    assert!(selection_commitment == selection_commitment_v8(*selection), EInvalidProof);
    assert!(source_class == selection.source_class, EInvalidProof);
    assert!(source_definition_id == selection.source_definition_id, EInvalidProof);
    assert!(source_semantic_id == selection.source_semantic_id, EInvalidProof);
    assert!(source_epoch == selection.source_epoch, EInvalidProof);
    assert!(pricing_commitment == selection.pricing_commitment, EInvalidProof);
    assert_hash(&source_content_commitment);
    RuntimePhysicalSelectionWitnessV8 {
        loadout_id, root_id: loadout.root_id,
        root_version: loadout.root_version,
        root_content_commitment: loadout.root_content_commitment,
        holder: loadout.holder, loadout_revision, loadout_commitment,
        selection_index, selection_commitment,
        part_key: selection.part_key, item_key: selection.item_key,
        style_key: selection.style_key, layer_track_key: selection.layer_track_key,
        source_class,
        source_definition_id, source_semantic_id, source_content_commitment,
        source_epoch, pricing_commitment,
        asset_content_commitment: selection.asset_content_commitment,
    }
}

/// Output consumes the witness against the same live loadout. Any intervening
/// mutation or holder drift aborts before materialization authorization exists.
public fun consume_physical_selection_witness_v8(
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): (ID, ID, u64, vector<u8>, address, u64, vector<u8>, u64, vector<u8>, String, String, String, String, u8, ID, String, vector<u8>, u64, vector<u8>, vector<u8>) {
    let RuntimePhysicalSelectionWitnessV8 {
        loadout_id, root_id, root_version, root_content_commitment, holder,
        loadout_revision, loadout_commitment, selection_index,
        selection_commitment, part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id,
        source_semantic_id, source_content_commitment, source_epoch,
        pricing_commitment, asset_content_commitment,
    } = witness;
    assert!(holder == ctx.sender() && holder == loadout.holder, EWrongHolder);
    assert!(loadout_id == object::id(loadout), EInvalidProof);
    assert!(root_id == loadout.root_id, EInvalidProof);
    assert!(root_version == loadout.root_version, EInvalidProof);
    assert!(root_content_commitment == loadout.root_content_commitment, EInvalidProof);
    assert!(loadout_revision == loadout.revision, EInvalidProof);
    assert!(loadout_commitment == loadout.commitment, EInvalidProof);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.selection_index == selection_index, EInvalidProof);
    assert!(selection_commitment == selection_commitment_v8(*selection), EInvalidProof);
    assert!(part_key == selection.part_key, EInvalidProof);
    assert!(item_key == selection.item_key, EInvalidProof);
    assert!(style_key == selection.style_key, EInvalidProof);
    assert!(layer_track_key == selection.layer_track_key, EInvalidProof);
    assert!(source_class == selection.source_class, EInvalidProof);
    assert!(source_definition_id == selection.source_definition_id, EInvalidProof);
    assert!(source_semantic_id == selection.source_semantic_id, EInvalidProof);
    assert!(source_epoch == selection.source_epoch, EInvalidProof);
    assert!(pricing_commitment == selection.pricing_commitment, EInvalidProof);
    assert!(asset_content_commitment == selection.asset_content_commitment,
        EInvalidProof);
    (
        loadout_id, root_id, root_version, root_content_commitment, holder,
        loadout_revision, loadout_commitment, selection_index,
        selection_commitment, part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id,
        source_semantic_id, source_content_commitment, source_epoch,
        pricing_commitment, asset_content_commitment,
    )
}

/// Consumes exactly one proof per present selection, in increasing immutable
/// Part order. No duplicate/missing/unrelated proof can survive this seal.
public fun seal_ordered_selection_proofs_v8(
    loadout: &MakerLoadoutV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    pack_proofs: vector<PackDefinitionProofV8>,
    mut proofs: vector<SelectionAccessProofV8>,
    ctx: &TxContext,
): RuntimeLoadoutAuthorizationV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.sealed, ENotSealed);
    assert!(definitions.base_registry_id == sui::object::id(base_registry), EInvalidBinding);
    let profiles = consume_pack_definition_proofs(loadout, definitions, pack_proofs, true);
    assert!(base::registry_sealed_v2(base_registry), ENotSealed);
    assert!(base::registry_root_id_v2(base_registry) == loadout.root_id, EInvalidBinding);
    assert!(base::registry_maker_version_v2(base_registry) == loadout.root_version, EInvalidBinding);
    assert!(base::registry_root_content_commitment_v2(base_registry)
        == &loadout.root_content_commitment, EInvalidBinding);
    assert!(proofs.length() == loadout.selection_count, EProofOrder);
    proofs.reverse();
    let mut ordered_selection_commitments = vector[];
    let mut ordered_pricing_commitments = vector[];
    let mut used_packs = vector[];
    let mut profile_index = 0;
    let mut selection_index = 0;
    while (profile_index < profiles.length()) {
        let profile = &profiles[profile_index];
        let profile_end = selection_index + loadout_part_capacity(loadout, profile);
        let mut profile_selection_count = 0u64;
        while (selection_index < profile_end) {
            let maybe_selection = loadout.selections.borrow(selection_index);
            if (maybe_selection.is_some()) {
                profile_selection_count = profile_selection_count + 1;
                let selection = maybe_selection.borrow();
                assert!(&selection.part_key == &profile.part_key, EInvalidBinding);
                let proof = proofs.pop_back();
                let SelectionAccessProofV8 {
                    loadout_id,
                    loadout_revision,
                    loadout_commitment,
                    selection_index: proof_index,
                    selection_commitment,
                    source_class,
                    source_definition_id,
                    source_semantic_id,
                    source_content_commitment,
                    source_epoch,
                    pricing_commitment,
                } = proof;
                assert!(loadout_id == object::id(loadout), EInvalidProof);
                assert!(loadout_revision == loadout.revision, EInvalidProof);
                assert!(loadout_commitment == loadout.commitment, EInvalidProof);
                assert!(proof_index == selection_index, EProofOrder);
                assert!(source_class == selection.source_class, EInvalidProof);
                assert!(source_definition_id == selection.source_definition_id, EInvalidProof);
                assert!(source_semantic_id == selection.source_semantic_id, EInvalidProof);
                assert!(source_epoch == selection.source_epoch, EInvalidProof);
                assert!(pricing_commitment == selection.pricing_commitment, EInvalidProof);
                assert!(selection_commitment == selection_commitment_v8(*selection), EInvalidProof);
                ordered_selection_commitments.push_back(selection_commitment);
                ordered_pricing_commitments.push_back(pricing_commitment);
                if (source_class == SOURCE_PACK
                    && !used_pack_contains(&used_packs, source_definition_id)) {
                    used_packs.push_back(UsedPackV8 {
                        release_id: source_definition_id,
                        semantic_pack_id: source_semantic_id,
                        release_content_commitment: source_content_commitment,
                        pricing_commitment,
                    });
                };
            };
            selection_index = selection_index + 1;
        };
        if (profile.required) assert!(profile_selection_count > 0, ERequiredPart);
        profile_index = profile_index + 1;
    };
    assert!(selection_index == loadout.selections.length(), EPartOrder);
    assert_loadout_rules(loadout, base_registry);
    assert_loadout_visibility(loadout, base_registry);
    assert!(proofs.is_empty(), EProofOrder);
    proofs.destroy_empty();
    RuntimeLoadoutAuthorizationV8 {
        loadout_id: object::id(loadout),
        root_id: loadout.root_id,
        root_version: loadout.root_version,
        root_content_commitment: loadout.root_content_commitment,
        loadout_revision: loadout.revision,
        loadout_commitment: loadout.commitment,
        selection_count: loadout.selection_count,
        ordered_selection_commitments,
        ordered_pricing_commitments,
        used_packs,
    }
}

/// Output must pass the same loadout at consumption time. A later same-PTB
/// mutation therefore invalidates this no-ability authorization.
public fun consume_loadout_authorization_v8(
    authorization: RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
): (ID, ID, u64, vector<u8>, u64, vector<u8>, u64, vector<vector<u8>>, vector<vector<u8>>, vector<UsedPackV8>) {
    let RuntimeLoadoutAuthorizationV8 {
        loadout_id, root_id, root_version, root_content_commitment,
        loadout_revision, loadout_commitment, selection_count,
        ordered_selection_commitments, ordered_pricing_commitments,
        used_packs,
    } = authorization;
    assert!(loadout_id == object::id(loadout), EInvalidProof);
    assert!(root_id == loadout.root_id, EInvalidProof);
    assert!(root_version == loadout.root_version, EInvalidProof);
    assert!(root_content_commitment == loadout.root_content_commitment, EInvalidProof);
    assert!(loadout_revision == loadout.revision, EInvalidProof);
    assert!(loadout_commitment == loadout.commitment, EInvalidProof);
    assert!(selection_count == loadout.selection_count, EInvalidProof);
    (
        loadout_id, root_id, root_version, root_content_commitment,
        loadout_revision, loadout_commitment, selection_count,
        ordered_selection_commitments, ordered_pricing_commitments,
        used_packs,
    )
}

public fun selection_commitment_v8(selection: LoadoutSelectionV8): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&SelectionCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/selection",
        version: VERSION,
        selection,
    }))
}

public fun definition_registry_id_v8(registry: &RuntimeDefinitionRegistryV8): ID { object::id(registry) }
public fun definition_registry_sealed_v8(registry: &RuntimeDefinitionRegistryV8): bool { registry.sealed }
public fun definition_registry_commitment_v8(registry: &RuntimeDefinitionRegistryV8): &vector<u8> {
    &registry.rolling_profile_commitment
}
public fun definition_profile_count_v8(registry: &RuntimeDefinitionRegistryV8): u64 {
    registry.observed_profile_count
}
public fun definition_item_assetization_v8(registry: &RuntimeDefinitionRegistryV8): bool {
    registry.item_assetization
}
public fun part_profile_v8(registry: &RuntimeDefinitionRegistryV8, part_key: String): &PartProfileV8 {
    registry.profiles.borrow(PartProfileKeyV8 { part_key })
}
public fun part_profile_index_v8(profile: &PartProfileV8): u64 { profile.index }
public fun part_profile_wardrobe_mode_v8(profile: &PartProfileV8): u8 { profile.wardrobe_mode }
public fun part_profile_behavior_v8(profile: &PartProfileV8): u8 { profile.behavior }
public fun part_profile_capacity_v8(profile: &PartProfileV8): u64 { profile.capacity }
public fun part_profile_admission_ceiling_v8(profile: &PartProfileV8): u8 {
    profile.admission_ceiling
}
public fun part_profile_required_v8(profile: &PartProfileV8): bool { profile.required }
public fun part_profile_commitment_v8(profile: &PartProfileV8): &vector<u8> { &profile.profile_commitment }
public fun pack_registry_id_v8(registry: &PackRegistryV8): ID { object::id(registry) }
public fun pack_registry_revision_v8(registry: &PackRegistryV8): u64 { registry.revision }
public fun pack_registry_release_count_v8(registry: &PackRegistryV8): u64 { registry.release_count }
public fun pack_registry_external_count_v8(registry: &PackRegistryV8): u64 {
    registry.external_admission_count
}
public fun pack_registry_wardrobe_revision_v8(registry: &PackRegistryV8): u64 {
    registry.wardrobe_revision
}
public fun pack_registry_base_item_count_v8(registry: &PackRegistryV8): u64 {
    registry.base_item_count
}
public fun pack_registry_base_item_owner_v8(
    registry: &PackRegistryV8, part_key: String, item_key: String, holder: address,
): Option<BaseItemOwnershipRecordV8> {
    let key = BaseItemHolderKeyV8 { part_key, item_key, holder };
    if (registry.base_item_owners.contains(key)) option::some(*registry.base_item_owners.borrow(key))
    else option::none()
}
public fun base_item_ownership_id_v8(record: &BaseItemOwnershipRecordV8): ID { record.item_id }
public fun base_item_ownership_epoch_v8(record: &BaseItemOwnershipRecordV8): u64 { record.ownership_epoch }
public fun pack_release_id_v8<PaymentCoin>(release: &PackReleaseV8<PaymentCoin>): ID { object::id(release) }
public fun pack_release_lifecycle_v8<PaymentCoin>(release: &PackReleaseV8<PaymentCoin>): u8 {
    release.lifecycle
}
public fun pack_release_content_commitment_v8<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>,
): &vector<u8> { &release.content_commitment }
public fun pack_release_semantic_id_v8<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>,
): &String { &release.semantic_pack_id }
public fun pack_release_root_id_v8<PaymentCoin>(release: &PackReleaseV8<PaymentCoin>): ID {
    release.root_id
}
public fun pack_release_root_version_v8<PaymentCoin>(release: &PackReleaseV8<PaymentCoin>): u64 {
    release.root_version
}
public fun pack_pass_commitment_v8(pass: &PackPassV8): vector<u8> { pass.commitment }
public fun maker_access_entitlement_commitment_v8(pass: &MakerAccessPassV8): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&MakerAccessEntitlementCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/maker-access-entitlement",
        version: VERSION,
        pass_id: sui::object::id(pass),
        root_id: core_treasury::maker_access_pass_root_id_v2(pass),
        maker_version: core_treasury::maker_access_pass_maker_version_v2(pass),
        root_content_commitment:
            *core_treasury::maker_access_pass_root_content_commitment_v2(pass),
        holder: core_treasury::maker_access_pass_holder_v2(pass),
        paid_atomic: core_treasury::maker_access_pass_paid_atomic_v2(pass),
        issued_at_ms: core_treasury::maker_access_pass_issued_at_ms_v2(pass),
    }))
}
public fun loadout_id_v8(loadout: &MakerLoadoutV8): ID { object::id(loadout) }
public fun loadout_revision_v8(loadout: &MakerLoadoutV8): u64 { loadout.revision }
public fun loadout_commitment_v8(loadout: &MakerLoadoutV8): &vector<u8> { &loadout.commitment }
public fun loadout_selection_count_v8(loadout: &MakerLoadoutV8): u64 { loadout.selection_count }
public fun loadout_attached_pack_definitions_v8(loadout: &MakerLoadoutV8): &vector<AttachedPackDefinitionV8> {
    &loadout.attached_pack_definitions
}
public fun loadout_definition_slots_v8(loadout: &MakerLoadoutV8): &vector<DefinitionSlotV8> {
    &loadout.definition_slots
}
/// Preserve slot identity, including empty slots, in immutable completed recipes.
public fun loadout_selections_v8(loadout: &MakerLoadoutV8): &vector<Option<LoadoutSelectionV8>> {
    &loadout.selections
}
public fun loadout_selection_v8(loadout: &MakerLoadoutV8, index: u64): &Option<LoadoutSelectionV8> {
    loadout.selections.borrow(index)
}
public fun used_pack_release_id_v8(used: &UsedPackV8): ID { used.release_id }
public fun used_pack_semantic_id_v8(used: &UsedPackV8): &String { &used.semantic_pack_id }
public fun used_pack_content_commitment_v8(used: &UsedPackV8): &vector<u8> {
    &used.release_content_commitment
}
public fun used_pack_pricing_commitment_v8(used: &UsedPackV8): &vector<u8> {
    &used.pricing_commitment
}
public fun owned_item_locked_v8(item: &OwnedExternalItemV8): bool { item.equip_lock.is_some() }
public fun owned_item_holder_v8(item: &OwnedExternalItemV8): address { item.holder }
public fun owned_item_ownership_epoch_v8(item: &OwnedExternalItemV8): u64 { item.ownership_epoch }
public fun owned_base_item_id_v8(item: &OwnedBaseItemV8): ID { object::id(item) }
public fun owned_base_item_holder_v8(item: &OwnedBaseItemV8): address { item.holder }
public fun owned_base_item_ownership_epoch_v8(item: &OwnedBaseItemV8): u64 { item.ownership_epoch }
public fun owned_base_item_part_key_v8(item: &OwnedBaseItemV8): &String { &item.part_key }
public fun owned_base_item_item_key_v8(item: &OwnedBaseItemV8): &String { &item.item_key }
public fun owned_base_item_locked_v8(item: &OwnedBaseItemV8): bool {
    item.equip_lock.is_some()
}
public fun equipment_market_custody_listing_id_v8(binding: &EquipmentMarketCustodyBindingV8): ID { binding.listing_id }
public fun equipment_market_custody_asset_id_v8(binding: &EquipmentMarketCustodyBindingV8): ID { binding.asset_id }
public fun equipment_market_custody_asset_kind_v8(binding: &EquipmentMarketCustodyBindingV8): u8 { binding.asset_kind }
public fun equipment_market_custody_source_id_v8(binding: &EquipmentMarketCustodyBindingV8): ID { binding.source_id }
public fun equipment_market_custody_holder_v8(binding: &EquipmentMarketCustodyBindingV8): address { binding.holder }
public fun equipment_market_custody_ownership_epoch_v8(binding: &EquipmentMarketCustodyBindingV8): u64 { binding.ownership_epoch }
public fun equipment_market_custody_asset_commitment_v8(binding: &EquipmentMarketCustodyBindingV8): &vector<u8> { &binding.asset_commitment }
public fun pack_treasury_balance_v8<PaymentCoin>(treasury: &PackTreasuryV8<PaymentCoin>): u64 {
    balance::value(&treasury.revenue)
}

fun admit_external_product<PaymentCoin>(
    registry: &mut PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    product: &ExternalItemProductV8,
    attestation_commitment: Option<vector<u8>>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_root_active(root);
    maker::assert_admin_v8(root, maker_admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EWrongControl);
    assert_pack_registry_identity(registry, definitions, root);
    assert_authority_identity(authority, registry, root);
    assert!(registry.revision == expected_revision, EStaleRevision);
    assert!(product.root_id == registry.root_id, EInvalidBinding);
    assert!(product.root_version == registry.root_version, EInvalidBinding);
    assert!(product.root_content_commitment == registry.root_content_commitment, EInvalidBinding);
    assert!(product.lifecycle == PRODUCT_ACTIVE, EInvalidLifecycle);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key: product.part_key });
    assert!(profile.wardrobe_mode == WARDROBE_SLOT, EFixedPart);
    assert_external_profile_behavior(profile);
    assert!(profile.admission_ceiling == definitions.admission_ceiling, EInvalidPolicy);
    if (definitions.admission_ceiling == ADMISSION_CERTIFIED) {
        assert!(attestation_commitment.is_some(), EAttestationRequired);
    };
    let product_id = object::id(product);
    assert!(!registry.external_admissions.contains(product_id), EAlreadyAdmitted);
    registry.revision = registry.revision + 1;
    registry.external_admission_count = registry.external_admission_count + 1;
    registry.external_admissions.add(product_id, ExternalAdmissionRecordV8 {
        product_id,
        compatibility_commitment: product.compatibility_commitment,
        product_content_commitment: product.content_commitment,
        attestation_commitment,
        admitted_revision: registry.revision,
        admission_state: ADMISSION_ACTIVE,
    });
    event::emit(PackRegistryRevisionAdvancedV8 {
        root_id: registry.root_id,
        previous_revision: expected_revision,
        revision: registry.revision,
        subject_id: product_id,
        operation: 2,
    });
}

fun assert_external_access(
    registry: &PackRegistryV8,
    product: &ExternalItemProductV8,
    item: &OwnedExternalItemV8,
    holder: address,
) {
    assert!(product.lifecycle == PRODUCT_ACTIVE, EInvalidLifecycle);
    assert!(product.root_id == registry.root_id, EInvalidBinding);
    assert!(product.root_version == registry.root_version, EInvalidBinding);
    assert!(product.root_content_commitment == registry.root_content_commitment, EInvalidBinding);
    let record = registry.external_admissions.borrow(object::id(product));
    assert!(record.admission_state == ADMISSION_ACTIVE, EAdmissionDenied);
    assert!(record.compatibility_commitment == product.compatibility_commitment, EAdmissionDenied);
    assert!(record.product_content_commitment == product.content_commitment, EAdmissionDenied);
    assert!(item.product_id == object::id(product), EInvalidBinding);
    assert!(item.product_content_commitment == product.content_commitment, EInvalidBinding);
    assert!(item.asset_content_commitment == product.asset_content_commitment, EInvalidBinding);
    assert!(item.holder == holder, EWrongHolder);
}

fun new_pack_pass<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    paid_atomic: u64,
    issued_at_ms: u64,
    ctx: &mut TxContext,
): PackPassV8 {
    let key = PackAccessKeyV8 { holder: ctx.sender() };
    assert!(!df::exists(&release.id, key), EPackAccessAlreadyIssued);
    df::add(&mut release.id, key, true);
    release.pass_count = release.pass_count + 1;
    let commitment = hash::sha2_256(bcs::to_bytes(&PackPassCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/pack-pass",
        version: VERSION,
        release_id: object::id(release),
        root_id: release.root_id,
        root_version: release.root_version,
        root_content_commitment: release.root_content_commitment,
        release_content_commitment: release.content_commitment,
        holder: ctx.sender(),
        paid_atomic,
        issued_at_ms,
    }));
    PackPassV8 {
        id: object::new(ctx),
        version: VERSION,
        release_id: object::id(release),
        root_id: release.root_id,
        root_version: release.root_version,
        root_content_commitment: release.root_content_commitment,
        release_content_commitment: release.content_commitment,
        holder: ctx.sender(),
        paid_atomic,
        issued_at_ms,
        commitment,
    }
}

fun install_selection(loadout: &mut MakerLoadoutV8, index: u64, selection: LoadoutSelectionV8) {
    assert!(selection.selection_index == index, EPartOrder);
    assert_slot_empty(loadout, index);
    *loadout.selections.borrow_mut(index) = option::some(selection);
    loadout.selection_count = loadout.selection_count + 1;
    loadout.revision = loadout.revision + 1;
    recompute_loadout(loadout);
}

fun clear_selection(loadout: &mut MakerLoadoutV8, index: u64) {
    assert!(loadout.selections.borrow(index).is_some(), EMissing);
    let _selection = option::extract(loadout.selections.borrow_mut(index));
    loadout.selection_count = loadout.selection_count - 1;
    loadout.revision = loadout.revision + 1;
    recompute_loadout(loadout);
}

// A Base-scoped Style can still depend on Pack-owned tracks, colors or rules.
// Such a Release must enter the explicit attachment/proof chain even when it
// contributes no Part slots. Selection source alone cannot represent that fact.
fun assert_pack_definition_attachment<PaymentCoin>(
    loadout: &MakerLoadoutV8, release: &PackReleaseV8<PaymentCoin>,
) {
    if (!df::exists(&release.id, PackDefinitionsKeyV8 {})) return;
    let owned = pack_definitions_v8(release);
    assert!(owned.version == VERSION && owned.release_id == object::id(release)
        && owned.release_content_commitment == release.content_commitment, EInvalidBinding);
    let mut count = 0u64;
    loadout.attached_pack_definitions.do_ref!(|binding| {
        if (binding.release_id == object::id(release)) {
            assert!(binding.definition_commitment == owned.commitment, EInvalidBinding);
            count = count + 1;
        };
    });
    assert!(count == 1, EInvalidBinding);
}

fun consume_pack_definition_proofs(
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    mut proofs: vector<PackDefinitionProofV8>, completion: bool,
): vector<PartProfileV8> {
    assert!(definitions.version == VERSION && definitions.sealed
        && loadout.definition_registry_id == object::id(definitions)
        && loadout.root_id == definitions.root_id && loadout.root_version == definitions.root_version
        && loadout.root_content_commitment == definitions.root_content_commitment, EInvalidBinding);
    assert!(proofs.length() == loadout.attached_pack_definitions.length(), EProofOrder);
    let mut slots = definition_slots_for_layout(definitions, has_equipment_layout(loadout));
    let mut profiles = vector[];
    definitions.profile_keys.do_ref!(|key| { profiles.push_back(*definitions.profiles.borrow(PartProfileKeyV8 { part_key: *key })); });
    let mut capacity = 0;
    slots.do_ref!(|slot| { capacity = capacity + slot.capacity; });
    let mut index = 0;
    let mut seen = vector[];
    proofs.reverse();
    while (!proofs.is_empty()) {
        let PackDefinitionProofV8 { loadout_id, loadout_revision, loadout_commitment,
            binding_index, release_id, definition_commitment, profiles: own_profiles, completion_checked } = proofs.pop_back();
        let binding = &loadout.attached_pack_definitions[index];
        assert!(binding_index == index, EProofOrder);
        assert!(loadout_id == object::id(loadout) && loadout_revision == loadout.revision
            && loadout_commitment == loadout.commitment, EInvalidProof);
        assert!(!completion || completion_checked, EInvalidProof);
        assert!(release_id == binding.release_id && definition_commitment == binding.definition_commitment
            && release_id != loadout.root_id && !seen.contains(&release_id), EInvalidProof);
        seen.push_back(release_id);
        own_profiles.do_ref!(|profile| {
            let part_capacity = loadout_part_capacity(loadout, profile);
            assert!(profile.capacity > 0 && profile.capacity <= MAX_PART_CAPACITY
                && capacity + part_capacity <= MAX_LOADOUT_SELECTIONS, EInvalidCount);
            slots.push_back(DefinitionSlotV8 { source_definition_id: release_id, part_key: profile.part_key,
                profile_commitment: profile.profile_commitment, start: capacity, capacity: part_capacity });
            profiles.push_back(*profile); capacity = capacity + part_capacity;
        });
        index = index + 1;
    };
    proofs.destroy_empty();
    assert!(loadout.definition_slots == slots && loadout.selections.length() == capacity, EInvalidBinding);
    let mut count = 0;
    slots.do_ref!(|slot| {
        let mut position = slot.start;
        while (position < slot.start + slot.capacity) {
            if (loadout.selections[position].is_some()) {
                let selection = loadout.selections[position].borrow();
                assert!(selection.selection_index == position && selection.part_key == slot.part_key, EInvalidBinding);
                count = count + 1;
            };
            position = position + 1;
        };
    });
    assert!(count == loadout.selection_count, EInvalidCount);
    profiles
}

fun recompute_loadout(loadout: &mut MakerLoadoutV8) {
    loadout.commitment = canonical_loadout_commitment(
        loadout.root_id,
        loadout.root_version,
        loadout.root_content_commitment,
        &loadout.attached_pack_definitions,
        &loadout.definition_slots,
        &loadout.selections,
    );
}

fun canonical_loadout_commitment(
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    attached_pack_definitions: &vector<AttachedPackDefinitionV8>,
    definition_slots: &vector<DefinitionSlotV8>,
    selections: &vector<Option<LoadoutSelectionV8>>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&LoadoutCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/current-loadout",
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
        attached_pack_definitions: *attached_pack_definitions,
        definition_slots: *definition_slots,
        selections: *selections,
    }))
}

fun new_selection_proof(
    loadout: &MakerLoadoutV8,
    selection: &LoadoutSelectionV8,
    source_content_commitment: vector<u8>,
): SelectionAccessProofV8 {
    assert_hash(&source_content_commitment);
    SelectionAccessProofV8 {
        loadout_id: object::id(loadout),
        loadout_revision: loadout.revision,
        loadout_commitment: loadout.commitment,
        selection_index: selection.selection_index,
        selection_commitment: selection_commitment_v8(*selection),
        source_class: selection.source_class,
        source_definition_id: selection.source_definition_id,
        source_semantic_id: selection.source_semantic_id,
        source_content_commitment,
        source_epoch: selection.source_epoch,
        pricing_commitment: selection.pricing_commitment,
    }
}

fun used_pack_contains(packs: &vector<UsedPackV8>, release_id: ID): bool {
    let mut i = 0;
    while (i < packs.length()) {
        if (packs.borrow(i).release_id == release_id) return true;
        i = i + 1;
    };
    false
}

fun assert_used_pack(
    packs: &vector<UsedPackV8>,
    release_id: ID,
    semantic_pack_id: &String,
    content_commitment: &vector<u8>,
    pricing_commitment: &vector<u8>,
) {
    let mut i = 0;
    while (i < packs.length()) {
        let used = packs.borrow(i);
        if (used.release_id == release_id) {
            assert!(&used.semantic_pack_id == semantic_pack_id, EInvalidProof);
            assert!(&used.release_content_commitment == content_commitment, EInvalidProof);
            assert!(&used.pricing_commitment == pricing_commitment, EInvalidProof);
            return
        };
        i = i + 1;
    };
    abort EInvalidProof
}

fun exact_selected_swatch(
    base_registry: &BaseDefinitionRegistryV8,
    channel: &Option<String>,
    swatch: Option<String>,
): Option<String> {
    assert!(channel.is_some() == swatch.is_some(), EInvalidBinding);
    if (channel.is_some()) {
        let _color = base::borrow_color_v2(base_registry, *channel.borrow(), *swatch.borrow());
    };
    swatch
}

fun exact_pack_swatch<PaymentCoin>(
    base_registry: &BaseDefinitionRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    style: &PackStyleV8,
    swatch: Option<String>,
): Option<String> {
    assert!(style.color_channel_key.is_some() == swatch.is_some(), EInvalidBinding);
    assert!(style.definition_sources.color.is_some() == swatch.is_some(), EInvalidBinding);
    if (swatch.is_some()) {
        let _color = resolve_pack_color_v8(base_registry, release,
            pack_definition_source_id(release, *style.definition_sources.color.borrow()),
            *style.color_channel_key.borrow(), *swatch.borrow());
    };
    swatch
}

fun assert_pack_style_visibility_definitions<PaymentCoin>(
    base_registry: &BaseDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    sources: &PackStyleDefinitionSourcesV8, part_key: String, item_key: String, style_key: String,
) {
    if (!df::exists(&release.id, PackDefinitionsKeyV8 {})) return;
    let rows = &pack_definitions_v8(release).rows;
    let item = base::borrow_pack_visibility_v2(rows, 1, part_key, item_key, option::none());
    let (item_source, tokens, _) = base::pack_visibility_terms_v2(item);
    let inherited = sources.part == 1 && base::contains_item_v2(base_registry, part_key, item_key);
    assert!(item_source == if (inherited) 1 else 2, EInvalidBinding);
    if (inherited) {
        assert!(tokens == base::item_visibility_tokens_v1(base::borrow_item_v2(base_registry, part_key, item_key)), EInvalidBinding);
        assert!(!base::contains_style_v2(base_registry, part_key, item_key, style_key), EInvalidBinding);
    };
    let style = base::borrow_pack_visibility_v2(rows, 2, part_key, item_key, option::some(style_key));
    let (style_source, _, _) = base::pack_visibility_terms_v2(style);
    assert!(style_source == 2, EInvalidBinding);
}

fun pack_style_part_profile<PaymentCoin>(
    definitions: &RuntimeDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    source: u8, part_key: String,
): PartProfileV8 {
    assert!(definitions.sealed && definitions.root_id == release.root_id
        && definitions.root_version == release.root_version
        && definitions.root_content_commitment == release.root_content_commitment, EInvalidBinding);
    assert!(source == 1 || source == 2, EInvalidPolicy);
    if (source == 1) {
        let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key });
        assert_pack_profile(profile);
        *profile
    } else {
        let profiles = pack_part_profiles_v8(definitions, release);
        let mut index = 0;
        while (index < profiles.length()) {
            if (profiles[index].part_key == part_key) return profiles[index];
            index = index + 1;
        };
        abort EInvalidBinding
    }
}

fun assert_pack_style_references<PaymentCoin>(
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    sources: &PackStyleDefinitionSourcesV8,
    part_key: &String,
    layer_track_key: &String,
    color_channel_key: &Option<String>,
    default_swatch_key: &Option<String>,
) {
    assert!(!df::exists(&release.id, PackDefinitionsDraftKeyV8 {}), EInvalidPolicy);
    assert!(definitions.base_registry_id == sui::object::id(base_registry), EInvalidBinding);
    assert!(base::registry_root_id_v2(base_registry) == release.root_id, EInvalidBinding);
    assert!(base::registry_maker_version_v2(base_registry) == release.root_version, EInvalidBinding);
    assert!(base::registry_root_content_commitment_v2(base_registry)
        == &release.root_content_commitment, EInvalidBinding);
    let _part = resolve_pack_part_v8(base_registry, release,
        pack_definition_source_id(release, sources.part), *part_key);
    let _track = resolve_pack_track_v8(base_registry, release,
        pack_definition_source_id(release, sources.track), *layer_track_key);
    assert_color_pair(color_channel_key, default_swatch_key);
    assert!(sources.color.is_some() == color_channel_key.is_some(), EInvalidBinding);
    if (color_channel_key.is_some()) {
        let _color = resolve_pack_color_v8(
            base_registry, release, pack_definition_source_id(release, *sources.color.borrow()),
            *color_channel_key.borrow(), *default_swatch_key.borrow());
    };
}

fun pack_pricing_commitment<PaymentCoin>(release: &PackReleaseV8<PaymentCoin>): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&PricingCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/pack-pricing",
        version: VERSION,
        release_id: object::id(release),
        release_content_commitment: release.content_commitment,
        access_kind: release.access_kind,
        access_price_atomic: release.access_price_atomic,
        complete_mode: release.complete_mode,
        complete_price_atomic: release.complete_price_atomic,
        complete_free_quota_per_wallet: release.complete_free_quota_per_wallet,
        complete_total_cap: release.complete_total_cap,
    }))
}

fun assert_physical_caller<
    PaymentCoin,
    PhysicalAuthority: drop,
>(
    root: &MakerRootV8<PaymentCoin>,
    physical_authority: PhysicalAuthority,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    packs: &PackRegistryV8,
) {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    binding::assert_exact_witness_type_v2<PhysicalAuthority>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 4),
        &b"physical_v8", &b"PhysicalRuntimeWitnessV2");
    let _ = physical_authority;
    maker::assert_product_release_catalog_v8(root, catalog);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(), EInvalidLifecycle);
    let registry_ids = maker::root_companion_registry_ids_v2(root);
    assert!(
        companion::pack_registry_id_v2(registry_ids) == object::id(packs),
        EInvalidBinding,
    );
    assert!(packs.version == VERSION, EInvalidBinding);
    maker::assert_root_identity_v8(
        root,
        packs.root_id,
        packs.root_version,
        &packs.root_content_commitment,
    );
    assert!(
        &packs.admission_policy_commitment
            == maker::root_expected_pack_admission_policy_commitment_v2(root),
        EInvalidBinding,
    );
}

fun physical_pack_style_identity<PaymentCoin>(
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    treasury: &PackTreasuryV8<PaymentCoin>,
    style: &PackStyleV8,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&PhysicalPackStyleIdentityInputV8 {
        domain: b"animacraft-v8/runtime/physical-pack-style",
        version: VERSION,
        root_id: release.root_id,
        root_version: release.root_version,
        root_content_commitment: release.root_content_commitment,
        pack_registry_id: object::id(packs),
        release_id: object::id(release),
        semantic_pack_id: release.semantic_pack_id,
        release_content_commitment: release.content_commitment,
        pack_treasury_id: object::id(treasury),
        style: *style,
    }))
}

fun protocol_share(gross: u64, fee_bps: u16): u64 {
    assert!(fee_bps <= 10_000, EInvalidPolicy);
    let share_u128 = ((gross as u128) * (fee_bps as u128)) / BPS_DENOMINATOR;
    assert!(fee_bps == 0 || share_u128 > 0, EWrongPayment);
    let share = share_u128 as u64;
    assert!(share < gross, EWrongPayment);
    share
}

fun assert_root_compatibility<PaymentCoin>(
    root_id: ID,
    root_version: u64,
    root_content_commitment: &vector<u8>,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(root_id == maker::root_id_v8(root), EInvalidBinding);
    assert!(root_version == maker::root_maker_version_v8(root), EInvalidBinding);
    assert!(root_content_commitment == maker::root_content_commitment_v8(root), EInvalidBinding);
}

fun assert_loadout_maker_access<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8,
    ctx: &TxContext,
) {
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    assert_root_compatibility(loadout.root_id, loadout.root_version,
        &loadout.root_content_commitment, root);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.maker_access_pass_id
        == sui::object::id(maker_access), EInvalidProof);
    assert!(loadout.maker_access_commitment
        == maker_access_entitlement_commitment_v8(maker_access), EInvalidProof);
}

fun complete_price_for_ordinal(mode: u8, price: u64, quota: u64, ordinal: u64): u64 {
    if (mode == COMPLETE_UNLIMITED_FREE) 0
    else if (mode == COMPLETE_PAID_EVERY_TIME) price
    else if (ordinal < quota) 0
    else {
        assert!(mode == COMPLETE_FREE_QUOTA_THEN_PAID, ECompleteBlocked);
        price
    }
}

fun set_pack_lifecycle<PaymentCoin>(release: &mut PackReleaseV8<PaymentCoin>, lifecycle: u8) {
    let previous_lifecycle = release.lifecycle;
    release.lifecycle = lifecycle;
    event::emit(PackLifecycleChangedV8 {
        release_id: object::id(release), previous_lifecycle, lifecycle,
    });
}

fun assert_definition_write<PaymentCoin>(
    registry: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    sequence: u64,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_definition_binding(registry, root, base_registry);
    assert!(!registry.sealed, EAlreadySealed);
    assert!(sequence == registry.observed_profile_count, EInvalidSequence);
}

fun assert_definition_binding<PaymentCoin>(
    registry: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
) {
    assert_definition_identity(registry, root);
    assert!(registry.base_registry_id == sui::object::id(base_registry), EInvalidBinding);
    assert!(base::registry_root_id_v2(base_registry) == registry.root_id, EInvalidBinding);
    assert!(base::registry_maker_version_v2(base_registry) == registry.root_version, EInvalidBinding);
    assert!(base::registry_root_content_commitment_v2(base_registry)
        == &registry.root_content_commitment, EInvalidBinding);
    assert!(base::registry_sealed_v2(base_registry), ENotSealed);
}

fun assert_definition_identity<PaymentCoin>(
    registry: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(registry.version == VERSION, EInvalidBinding);
    maker::assert_root_identity_v8(
        root, registry.root_id, registry.root_version, &registry.root_content_commitment,
    );
}

fun assert_pack_registry_identity<PaymentCoin>(
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_definition_identity(definitions, root);
    assert!(packs.version == VERSION, EInvalidBinding);
    assert!(packs.root_id == definitions.root_id, EInvalidBinding);
    assert!(packs.root_version == definitions.root_version, EInvalidBinding);
    assert!(packs.root_content_commitment == definitions.root_content_commitment, EInvalidBinding);
    assert!(packs.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(&packs.admission_policy_commitment
        == maker::root_expected_pack_admission_policy_commitment_v2(root), EInvalidBinding);
}

fun assert_authority_identity<PaymentCoin>(
    authority: &PackAdmissionAuthorityV8,
    packs: &PackRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(authority.version == VERSION, EInvalidBinding);
    assert!(object::id(authority) == packs.admission_authority_id, EInvalidBinding);
    maker::assert_root_identity_v8(
        root, authority.root_id, authority.root_version, &authority.root_content_commitment,
    );
}

fun assert_loadout_write<PaymentCoin>(
    loadout: &MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_root_active(root);
    assert_loadout_holder_revision(loadout, expected_revision, ctx);
    assert_definition_identity(definitions, root);
    assert_pack_registry_identity(packs, definitions, root);
    assert!(loadout.root_id == definitions.root_id, EInvalidBinding);
    assert!(loadout.root_version == definitions.root_version, EInvalidBinding);
    assert!(loadout.root_content_commitment == definitions.root_content_commitment, EInvalidBinding);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(loadout.pack_registry_id == object::id(packs), EInvalidBinding);
}

fun assert_loadout_holder_revision(
    loadout: &MakerLoadoutV8, expected_revision: u64, ctx: &TxContext,
) {
    assert!(!is_soul_equipment_v8(loadout), EEquipLocked);
    assert!(loadout.version == VERSION, EInvalidBinding);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.revision == expected_revision, EStaleRevision);
}

fun assert_slot_empty(loadout: &MakerLoadoutV8, index: u64) {
    assert!(index < loadout.selections.length(), EPartOrder);
    assert!(loadout.selections.borrow(index).is_none(), EDuplicate);
}

fun total_slot_capacity(definitions: &RuntimeDefinitionRegistryV8): u64 {
    let mut total = 0;
    let mut profile_index = 0;
    while (profile_index < definitions.profile_keys.length()) {
        let profile = definitions.profiles.borrow(PartProfileKeyV8 {
            part_key: *definitions.profile_keys.borrow(profile_index),
        });
        total = total + profile.capacity;
        assert!(total <= MAX_LOADOUT_SELECTIONS, EInvalidCount);
        profile_index = profile_index + 1;
    };
    total
}

#[test_only]
fun base_definition_slots(definitions: &RuntimeDefinitionRegistryV8): vector<DefinitionSlotV8> {
    definition_slots_for_layout(definitions, false)
}

fun definition_slots_for_layout(definitions: &RuntimeDefinitionRegistryV8, equipment_layout: bool): vector<DefinitionSlotV8> {
    let mut slots = vector[];
    let mut start = 0;
    definitions.profile_keys.do_ref!(|key| {
        let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key: *key });
        let capacity = if (equipment_layout) 1 else profile.capacity;
        slots.push_back(DefinitionSlotV8 {
            source_definition_id: definitions.root_id, part_key: profile.part_key,
            profile_commitment: profile.profile_commitment, start, capacity,
        });
        start = start + capacity;
        assert!(start <= MAX_LOADOUT_SELECTIONS, EInvalidCount);
    });
    slots
}

fun profile_slot_start(
    loadout: &MakerLoadoutV8,
    profile: &PartProfileV8,
): u64 {
    definition_profile_slot_start(loadout, loadout.root_id, profile)
}

fun definition_profile_slot_start(
    loadout: &MakerLoadoutV8, source_definition_id: ID, profile: &PartProfileV8,
): u64 {
    let mut index = 0;
    while (index < loadout.definition_slots.length()) {
        let slot = loadout.definition_slots.borrow(index);
        if (slot.source_definition_id == source_definition_id && slot.part_key == profile.part_key) {
            assert!(slot.profile_commitment == profile.profile_commitment
                && slot.capacity == loadout_part_capacity(loadout, profile), EInvalidBinding);
            return slot.start
        };
        index = index + 1;
    };
    abort EInvalidBinding
}

/// Explicit slots preserve sparse named loadouts and exact Player recipes.
/// None is the ordinary add operation; Some never moves an occupied selection
/// or escapes the selected Part's flattened capacity range.
fun selection_slot(
    loadout: &MakerLoadoutV8,
    definitions: &RuntimeDefinitionRegistryV8,
    profile: &PartProfileV8,
    target_selection_index: Option<u64>,
): u64 {
    assert!(definitions.sealed && definitions.root_id == loadout.root_id, EInvalidBinding);
    scoped_selection_slot(loadout, loadout.root_id, profile, target_selection_index)
}

fun scoped_selection_slot(
    loadout: &MakerLoadoutV8, source_definition_id: ID, profile: &PartProfileV8,
    target_selection_index: Option<u64>,
): u64 {
    let start = if (source_definition_id == loadout.root_id) profile_slot_start(loadout, profile)
        else definition_profile_slot_start(loadout, source_definition_id, profile);
    let end = start + loadout_part_capacity(loadout, profile);
    assert!(end <= loadout.selections.length(), EPartOrder);
    if (target_selection_index.is_some()) {
        let index = target_selection_index.destroy_some();
        assert!(index >= start && index < end, EPartOrder);
        assert_slot_empty(loadout, index);
        return index
    };
    let mut index = start;
    while (index < end) {
        if (loadout.selections[index].is_none()) return index;
        index = index + 1;
    };
    abort EDuplicate
}

fun selection_matches_rule_selector(
    selection: &LoadoutSelectionV8,
    selector: &base::SemanticSelectorV2,
): bool {
    assert!(selection.source_class <= SOURCE_EXTERNAL, EInvalidProof);
    let source_key = if (selection.source_class == SOURCE_PACK) {
        option::some(selection.source_semantic_id)
    } else if (selection.source_class == SOURCE_EXTERNAL) {
        let mut bytes = b"0x";
        bytes.append(sui::address::to_string(
            selection.source_definition_id.to_address()).into_bytes());
        option::some(string::utf8(bytes))
    } else {
        option::none()
    };
    // Core reserves 0 for ANY; Runtime's concrete source classes start at 0.
    base::semantic_selector_matches_v2(selector, selection.source_class + 1,
        &source_key, &selection.part_key, &selection.item_key, &selection.style_key)
}

#[test_only]
fun selection_contains_selector(
    loadout: &MakerLoadoutV8,
    selector: &base::SemanticSelectorV2,
): bool {
    let mut selection_index = 0;
    while (selection_index < loadout.selections.length()) {
        let maybe_selection = loadout.selections.borrow(selection_index);
        if (maybe_selection.is_some()) {
            let selection = maybe_selection.borrow();
            if (selection_matches_rule_selector(selection, selector)) return true;
        };
        selection_index = selection_index + 1;
    };
    false
}

/// Authoring BASE means the combined local document: inherited Base content
/// plus this Release's additions. Other Packs never become local BASE. ANY and
/// explicit source selectors retain Core semantics within the exact Part scope.
fun pack_selector_contains<PaymentCoin>(
    loadout: &MakerLoadoutV8, release: &PackReleaseV8<PaymentCoin>,
    selector: &base::SemanticSelectorV2,
): bool {
    let (source, _, part_key, _, _) = base::semantic_selector_terms_v2(selector);
    let mut definition_id = release.root_id;
    base::pack_parts_v2(&pack_definitions_v8(release).rows).do_ref!(|row| {
        let (key, _, _, _) = base::part_identity_terms_v2(row);
        if (key == part_key) definition_id = object::id(release);
    });
    scoped_pack_selector_contains(loadout, selector, definition_id,
        if (source == 1) option::some(object::id(release)) else option::none())
}

// Inherited Item programs use Root Part ranges without interpreting Pack
// additions as BASE. Authored programs may map only their own exact Release.
fun scoped_pack_selector_contains(
    loadout: &MakerLoadoutV8, selector: &base::SemanticSelectorV2,
    definition_id: ID, local_release: Option<ID>,
): bool {
    let (_, _, part_key, _, _) = base::semantic_selector_terms_v2(selector);
    let mut start = 0;
    let mut end = 0;
    let mut found = false;
    loadout.definition_slots.do_ref!(|slot| {
        if (slot.source_definition_id == definition_id && &slot.part_key == part_key) {
            assert!(!found, EInvalidBinding);
            found = true; start = slot.start; end = start + slot.capacity;
        };
    });
    assert!(end <= loadout.selections.length(), EInvalidBinding);
    let mut index = start;
    while (index < end) {
        if (loadout.selections[index].is_some()) {
            let selection = loadout.selections[index].borrow();
            let local_addition = local_release.is_some() && selection.source_class == SOURCE_PACK
                && selection.source_definition_id == *local_release.borrow();
            if (local_addition) {
                if (base::semantic_selector_matches_v2(selector, 1, &option::none(),
                    &selection.part_key, &selection.item_key, &selection.style_key)) return true;
            } else if (selection_matches_rule_selector(selection, selector)) return true;
        };
        index = index + 1;
    };
    false
}

fun assert_pack_visibility_program<PaymentCoin>(
    loadout: &MakerLoadoutV8, release: &PackReleaseV8<PaymentCoin>,
    tokens: &vector<base::VisibilityTokenV1>,
) {
    let mut selected = vector[];
    tokens.do_ref!(|token| {
        let selector = base::visibility_token_selector_v1(token);
        if (selector.is_some()) selected.push_back(pack_selector_contains(loadout, release, selector.borrow()));
    });
    assert!(base::visibility_is_satisfied_v1(tokens, &selected), ERuleViolation);
}

fun assert_inherited_pack_item_visibility_program(
    loadout: &MakerLoadoutV8, tokens: &vector<base::VisibilityTokenV1>,
) {
    let mut selected = vector[];
    tokens.do_ref!(|token| {
        let selector = base::visibility_token_selector_v1(token);
        if (selector.is_some()) selected.push_back(scoped_pack_selector_contains(
            loadout, selector.borrow(), loadout.root_id, option::none()));
    });
    assert!(base::visibility_is_satisfied_v1(tokens, &selected), ERuleViolation);
}

/// Read-only content validation; not an entitlement proof or completion permit.
/// The final proof must still certify access and consume every committed binding.
public fun validate_attached_pack_definitions_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, binding_index: u64, ctx: &TxContext,
) {
    validate_attached_pack_definitions_internal(loadout, definitions, base_registry, release, binding_index, true, ctx);
}

public fun prove_attached_pack_definitions_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8, root: &MakerRootV8<PaymentCoin>, packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, pass: &PackPassV8, maker_access: &MakerAccessPassV8,
    binding_index: u64, ctx: &TxContext,
): PackDefinitionProofV8 {
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(object::id(packs) == loadout.pack_registry_id, EInvalidBinding);
    assert_active_pack_admission(packs, release);
    assert!(release.lifecycle == PACK_ACTIVE, EInvalidLifecycle);
    assert_pack_pass(release, pass, ctx.sender());
    validate_attached_pack_definitions_internal(loadout, definitions, base_registry, release, binding_index, true, ctx);
    new_pack_definition_proof(loadout, definitions, release, binding_index, true)
}

public fun prove_equipment_pack_definitions_v8<PaymentCoin>(
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8, base_registry: &BaseDefinitionRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, binding_index: u64, ctx: &TxContext,
): PackDefinitionProofV8 {
    validate_attached_pack_definitions_internal(loadout, definitions, base_registry, release, binding_index, false, ctx);
    new_pack_definition_proof(loadout, definitions, release, binding_index, false)
}

fun new_pack_definition_proof<PaymentCoin>(
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, binding_index: u64, completion_checked: bool,
): PackDefinitionProofV8 {
    PackDefinitionProofV8 { loadout_id: object::id(loadout), loadout_revision: loadout.revision,
        loadout_commitment: loadout.commitment, binding_index, release_id: object::id(release),
        definition_commitment: pack_definitions_v8(release).commitment,
        profiles: pack_part_profiles_v8(definitions, release), completion_checked }
}

fun validate_attached_pack_definitions_internal<PaymentCoin>(
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    binding_index: u64, completion: bool, ctx: &TxContext,
) {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.definition_registry_id == object::id(definitions)
        && loadout.root_id == definitions.root_id && loadout.root_version == definitions.root_version
        && loadout.root_content_commitment == definitions.root_content_commitment, EInvalidBinding);
    assert!(definitions.base_registry_id == object::id(base_registry), EInvalidBinding);
    assert_pack_reference_source(base_registry, release, release.root_id);
    assert!(binding_index < loadout.attached_pack_definitions.length(), EInvalidBinding);
    let binding = &loadout.attached_pack_definitions[binding_index];
    let owned = pack_definitions_v8(release);
    base::assert_pack_additive_definitions_v2(base_registry, &owned.rows);
    assert!(binding.release_id == object::id(release)
        && binding.definition_commitment == owned.commitment, EInvalidBinding);
    let profiles = pack_part_profiles_v8(definitions, release);
    let mut observed = 0;
    loadout.definition_slots.do_ref!(|slot| {
        if (slot.source_definition_id == object::id(release)) observed = observed + 1;
    });
    assert!(observed == profiles.length(), EInvalidBinding);
    profiles.do_ref!(|profile| {
        let start = definition_profile_slot_start(loadout, object::id(release), profile);
        let end = start + loadout_part_capacity(loadout, profile);
        assert!(end <= loadout.selections.length(), EInvalidBinding);
        let mut selected = false;
        let mut index = start;
        while (index < end) {
            if (loadout.selections[index].is_some()) selected = true;
            index = index + 1;
        };
        if (selected) assert_pack_visibility_program(loadout, release,
            base::part_visibility_tokens_v1(base::borrow_pack_part_v2(&owned.rows, profile.part_key)));
    });
    loadout.selections.do_ref!(|maybe_selection| {
        if (maybe_selection.is_some()) {
            let selection = maybe_selection.borrow();
            if (selection.source_class == SOURCE_PACK && selection.source_definition_id == object::id(release)) {
                let style = release.styles.borrow(PackStyleKeyV8 { part_key: selection.part_key,
                    item_key: selection.item_key, style_key: selection.style_key });
                assert_pack_style_visibility_definitions(base_registry, release, &style.definition_sources,
                    selection.part_key, selection.item_key, selection.style_key);
                let profile = pack_style_part_profile(definitions, release, style.definition_sources.part, selection.part_key);
                let definition_id = if (style.definition_sources.part == 1) loadout.root_id else object::id(release);
                let start = definition_profile_slot_start(loadout, definition_id, &profile);
                assert!(selection.selection_index >= start
                    && selection.selection_index < start + loadout_part_capacity(loadout, &profile), EInvalidBinding);
                let item_row = base::borrow_pack_visibility_v2(&owned.rows, 1, selection.part_key,
                    selection.item_key, option::none());
                let (item_source, item_tokens, _) = base::pack_visibility_terms_v2(item_row);
                if (item_source == 1) assert_inherited_pack_item_visibility_program(loadout, item_tokens)
                else assert_pack_visibility_program(loadout, release, item_tokens);
                let style_row = base::borrow_pack_visibility_v2(&owned.rows, 2, selection.part_key,
                    selection.item_key, option::some(selection.style_key));
                let (_, style_tokens, _) = base::pack_visibility_terms_v2(style_row);
                assert_pack_visibility_program(loadout, release, style_tokens);
            };
        };
    });
    if (completion) base::pack_rules_v2(&owned.rows).do_ref!(|rule| {
        let (_, trigger, _, targets, _) = base::rule_terms_v2(rule);
        let trigger_selected = pack_selector_contains(loadout, release, trigger);
        let mut matches = vector[];
        targets.do_ref!(|target| { matches.push_back(pack_selector_contains(loadout, release, target)); });
        assert!(base::rule_is_satisfied_v2(rule, trigger_selected, &matches), ERuleViolation);
    });
}

fun assert_visibility_program(
    loadout: &MakerLoadoutV8, tokens: &vector<base::VisibilityTokenV1>,
) {
    let mut selected = vector[];
    let mut index = 0;
    while (index < tokens.length()) {
        let selector = base::visibility_token_selector_v1(&tokens[index]);
        if (selector.is_some()) {
            selected.push_back(scoped_pack_selector_contains(loadout, selector.borrow(), loadout.root_id, option::none()));
        };
        index = index + 1;
    };
    assert!(base::visibility_is_satisfied_v1(tokens, &selected), ERuleViolation);
}

/// Root definition ranges only. Pack row programs are validated by the typed
/// attachment proof; no replacement is chosen implicitly.
fun assert_loadout_visibility(
    loadout: &MakerLoadoutV8, base_registry: &BaseDefinitionRegistryV8,
) {
    let mut index = 0;
    while (index < loadout.selections.length()) {
        let selection = &loadout.selections[index];
        let mut base_slot = false;
        loadout.definition_slots.do_ref!(|slot| {
            if (slot.source_definition_id == loadout.root_id && index >= slot.start && index < slot.start + slot.capacity) base_slot = true;
        });
        if (selection.is_some() && base_slot) {
            let selection = selection.borrow();
            assert_visibility_program(loadout, base::part_visibility_tokens_v1(
                base::borrow_part_v2(base_registry, selection.part_key)));
            if (selection.source_class == SOURCE_BASE) {
                assert_visibility_program(loadout, base::item_visibility_tokens_v1(
                    base::borrow_item_v2(base_registry, selection.part_key, selection.item_key)));
                assert_visibility_program(loadout, base::style_visibility_tokens_v1(
                    base::borrow_style_v2(base_registry, selection.part_key,
                        selection.item_key, selection.style_key)));
            };
        };
        index = index + 1;
    };
}

fun assert_loadout_rule(loadout: &MakerLoadoutV8, rule: &base::RuleRowV2) {
    let (_, trigger, _, targets, _) = base::rule_terms_v2(rule);
    let trigger_selected = scoped_pack_selector_contains(loadout, trigger, loadout.root_id, option::none());
    let mut target_matches = vector[];
    let mut target_index = 0u64;
    while (target_index < targets.length()) {
        target_matches.push_back(scoped_pack_selector_contains(
            loadout, &targets[target_index], loadout.root_id, option::none()));
        target_index = target_index + 1;
    };
    assert!(base::rule_is_satisfied_v2(rule, trigger_selected, &target_matches),
        ERuleViolation);
}

fun assert_loadout_rules(
    loadout: &MakerLoadoutV8,
    base_registry: &BaseDefinitionRegistryV8,
) {
    let mut rule_index = 0;
    let rule_count = base::registry_rule_count_v2(base_registry);
    while (rule_index < rule_count) {
        assert_loadout_rule(loadout, base::borrow_rule_at_v2(base_registry, rule_index));
        rule_index = rule_index + 1;
    };
}

fun assert_release_compatibility<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>, registry: &PackRegistryV8,
) {
    assert!(release.version == VERSION, EInvalidBinding);
    assert!(release.root_id == registry.root_id, EInvalidBinding);
    assert!(release.root_version == registry.root_version, EInvalidBinding);
    assert!(release.root_content_commitment == registry.root_content_commitment, EInvalidBinding);
}

fun assert_active_pack_admission<PaymentCoin>(
    registry: &PackRegistryV8, release: &PackReleaseV8<PaymentCoin>,
) {
    assert_release_compatibility(release, registry);
    let record = registry.releases.borrow(object::id(release));
    assert!(record.admission_state == ADMISSION_ACTIVE, EAdmissionDenied);
    assert!(&record.semantic_pack_id == &release.semantic_pack_id, EAdmissionDenied);
    assert!(*registry.semantic_releases.borrow(release.semantic_pack_id)
        == object::id(release), EAdmissionDenied);
    assert!(record.release_content_commitment == release.content_commitment, EAdmissionDenied);
}

fun assert_pack_write<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, ctx: &TxContext,
) {
    assert_pack_control(release, cap, ctx);
    assert!(release.lifecycle != PACK_ARCHIVED, EInvalidLifecycle);
}

fun assert_pack_control<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>, cap: &PackAdminCapV8, ctx: &TxContext,
) {
    assert!(release.version == VERSION && cap.version == VERSION, EInvalidBinding);
    assert!(object::id(release) == cap.release_id, EWrongControl);
    assert!(release.admin_cap_id == object::id(cap), EWrongControl);
    assert!(release.owner == ctx.sender() && cap.owner == ctx.sender(), EWrongControl);
    assert!(release.control_epoch == cap.control_epoch, EWrongControl);
}

fun assert_product_control(
    product: &ExternalItemProductV8, cap: &ExternalItemAdminCapV8, ctx: &TxContext,
) {
    assert!(product.version == VERSION && cap.version == VERSION, EInvalidBinding);
    assert!(object::id(product) == cap.product_id, EWrongControl);
    assert!(product.admin_cap_id == object::id(cap), EWrongControl);
    assert!(product.owner == ctx.sender() && cap.owner == ctx.sender(), EWrongControl);
    assert!(product.control_epoch == cap.control_epoch, EWrongControl);
}

fun assert_owned_holder(item: &OwnedExternalItemV8, ctx: &TxContext) {
    assert!(item.version == VERSION, EInvalidBinding);
    assert!(item.holder == ctx.sender(), EWrongHolder);
}

fun assert_owned_base_holder(item: &OwnedBaseItemV8, ctx: &TxContext) {
    assert!(item.version == VERSION, EInvalidBinding);
    assert!(item.holder == ctx.sender(), EWrongHolder);
}

fun assert_owned_base_item_registry(
    item: &OwnedBaseItemV8,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
) {
    assert!(definitions.item_assetization, EInvalidPolicy);
    assert!(item.root_id == definitions.root_id, EInvalidBinding);
    assert!(item.root_version == definitions.root_version, EInvalidBinding);
    assert!(item.root_content_commitment == definitions.root_content_commitment,
        EInvalidBinding);
    assert!(item.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(item.pack_registry_id == object::id(packs), EInvalidBinding);
    assert!(item.base_registry_id == definitions.base_registry_id, EInvalidBinding);
    assert!(packs.definition_registry_id == object::id(definitions), EInvalidBinding);
}

fun assert_owned_base_item(
    item: &OwnedBaseItemV8,
    packs: &PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    ctx: &TxContext,
) {
    assert_owned_base_holder(item, ctx);
    assert_owned_base_item_registry(item, packs, definitions);
    assert!(item.base_registry_id == sui::object::id(base_registry), EInvalidBinding);
    let base_item = base::borrow_item_v2(base_registry, item.part_key, item.item_key);
    base::assert_public_item_v2(base_item);
    assert!(base::item_payload_commitment_v2(base_item)
        == &item.item_payload_commitment, EInvalidBinding);
    assert_owned_base_item_record(item, packs);
}

fun assert_owned_base_item_record(item: &OwnedBaseItemV8, packs: &PackRegistryV8) {
    let record = packs.base_item_owners.borrow(BaseItemHolderKeyV8 {
        part_key: item.part_key,
        item_key: item.item_key,
        holder: item.holder,
    });
    assert!(record.item_id == object::id(item), EInvalidBinding);
    assert!(record.ownership_epoch == item.ownership_epoch, EInvalidBinding);
}

fun owned_base_item_commitment(item: &OwnedBaseItemV8): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&OwnedBaseItemCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/owned-base-item",
        version: VERSION,
        item_id: object::id(item),
        root_id: item.root_id,
        root_version: item.root_version,
        root_content_commitment: item.root_content_commitment,
        definition_registry_id: item.definition_registry_id,
        pack_registry_id: item.pack_registry_id,
        base_registry_id: item.base_registry_id,
        part_key: item.part_key,
        item_key: item.item_key,
        item_payload_commitment: item.item_payload_commitment,
        holder: item.holder,
        ownership_epoch: item.ownership_epoch,
    }))
}

fun assert_pack_pass<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>, pass: &PackPassV8, holder: address,
) {
    assert!(pass.version == VERSION, EPassMissing);
    assert!(pass.release_id == object::id(release), EPassMissing);
    assert!(pass.root_id == release.root_id, EPassMissing);
    assert!(pass.root_version == release.root_version, EPassMissing);
    assert!(pass.root_content_commitment == release.root_content_commitment, EPassMissing);
    assert!(pass.release_content_commitment == release.content_commitment, EPassMissing);
    assert!(pass.holder == holder, EPassMissing);
    let expected = hash::sha2_256(bcs::to_bytes(&PackPassCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/pack-pass",
        version: VERSION,
        release_id: pass.release_id,
        root_id: pass.root_id,
        root_version: pass.root_version,
        root_content_commitment: pass.root_content_commitment,
        release_content_commitment: pass.release_content_commitment,
        holder: pass.holder,
        paid_atomic: pass.paid_atomic,
        issued_at_ms: pass.issued_at_ms,
    }));
    assert!(pass.commitment == expected, EPassMissing);
}

fun assert_treasury<PaymentCoin>(
    release: &PackReleaseV8<PaymentCoin>, treasury: &PackTreasuryV8<PaymentCoin>,
) {
    assert!(treasury.version == VERSION, EInvalidBinding);
    assert!(treasury.release_id == object::id(release), EInvalidBinding);
    assert!(release.treasury_id == object::id(treasury), EInvalidBinding);
}

fun assert_pack_style(style: &PackStyleV8) {
    assert_key(&style.part_key);
    assert_key(&style.item_key);
    assert_key(&style.style_key);
    assert_key(&style.layer_track_key);
    assert_color_pair(&style.color_channel_key, &style.default_swatch_key);
    assert!(style.definition_sources.color.is_some() == style.color_channel_key.is_some(), EInvalidBinding);
    let _ = new_pack_style_definition_sources_v8(style.definition_sources.part,
        style.definition_sources.track, style.definition_sources.color);
    assert_locator(&style.asset_blob_id);
    assert_hash(&style.asset_sha256);
    assert_hash(&style.asset_content_commitment);
    assert_hash(&style.style_commitment);
    if (style.protected) assert_hash(&style.seal_binding_commitment)
    else assert!(style.seal_binding_commitment.is_empty(), EInvalidCommitment);
}

fun assert_profile_policy(
    wardrobe_mode: u8,
    behavior: u8,
    capacity: u64,
    admission_ceiling: u8,
    required: bool,
) {
    assert!(wardrobe_mode == WARDROBE_FIXED || wardrobe_mode == WARDROBE_SLOT, EInvalidPolicy);
    assert!(behavior <= BEHAVIOR_HYBRID, EInvalidPolicy);
    assert!(capacity > 0 && capacity <= MAX_PART_CAPACITY, EInvalidPolicy);
    assert_admission_ceiling(admission_ceiling);
    if (wardrobe_mode == WARDROBE_FIXED) {
        assert!(behavior == BEHAVIOR_FIXED, EInvalidPolicy);
    } else {
        assert!(behavior == BEHAVIOR_SOUL_LOCAL
            || behavior == BEHAVIOR_OPEN
            || behavior == BEHAVIOR_HYBRID, EInvalidPolicy);
    };
    if (required) assert!(behavior != BEHAVIOR_OPEN, EInvalidPolicy);
}

fun assert_external_profile_behavior(profile: &PartProfileV8) {
    assert!(behavior_accepts_external(profile.behavior), EAdmissionDenied);
}

fun assert_pack_profile(profile: &PartProfileV8) {
    assert!(profile.wardrobe_mode == WARDROBE_SLOT, EFixedPart);
    assert!(profile.behavior == BEHAVIOR_SOUL_LOCAL
        || profile.behavior == BEHAVIOR_OPEN
        || profile.behavior == BEHAVIOR_HYBRID, EAdmissionDenied);
}

fun behavior_accepts_external(behavior: u8): bool {
    behavior == BEHAVIOR_OPEN || behavior == BEHAVIOR_HYBRID
}

fun assert_admission_ceiling(value: u8) {
    assert!(value <= ADMISSION_OPEN, EInvalidPolicy);
}

fun assert_access_policy(kind: u8, price: u64) {
    let valid = (kind == ACCESS_FREE && price == 0)
        || (kind == ACCESS_PAID && price > 0)
        || (kind == ACCESS_INCLUDED_WITH_MAKER && price == 0);
    assert!(valid && price <= MAX_PRICE, EInvalidPolicy);
}

fun assert_complete_policy(mode: u8, price: u64, quota: u64, total_cap: u64) {
    let valid = (mode == COMPLETE_UNLIMITED_FREE && price == 0 && quota == 0)
        || (mode == COMPLETE_FREE_QUOTA_THEN_PAID && price > 0 && quota > 0)
        || (mode == COMPLETE_PAID_EVERY_TIME && price > 0 && quota == 0)
        || (mode == COMPLETE_FREE_QUOTA_THEN_BLOCK && price == 0 && quota > 0);
    assert!(valid, EInvalidPolicy);
    assert!(price <= MAX_PRICE && quota <= MAX_COMPLETE_COUNT, EInvalidPolicy);
    assert!(total_cap <= MAX_COMPLETE_COUNT, EInvalidPolicy);
    assert!(total_cap == 0 || total_cap >= quota, EInvalidPolicy);
}

fun assert_root_active<PaymentCoin>(root: &MakerRootV8<PaymentCoin>) {
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(), EInvalidLifecycle);
}

fun assert_color_pair(channel: &Option<String>, swatch: &Option<String>) {
    assert!(channel.is_some() == swatch.is_some(), EInvalidBinding);
    if (channel.is_some()) {
        assert_key(channel.borrow());
        assert_key(swatch.borrow());
    };
}

fun assert_key(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_KEY_BYTES, EInvalidKey);
    let bytes = string::as_bytes(value);
    let mut i = 0;
    while (i < bytes.length()) {
        assert!(bytes[i] != 0 && bytes[i] != 47, EInvalidKey);
        i = i + 1;
    };
}

fun assert_locator(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_LOCATOR_BYTES, EInvalidKey);
}

fun assert_asset_media_type(value: &String) {
    assert!(value.length() > 0 && value.length() <= MAX_MEDIA_TYPE_BYTES, EInvalidKey);
    assert!(
        value == &b"image/avif".to_string()
            || value == &b"image/gif".to_string()
            || value == &b"image/jpeg".to_string()
            || value == &b"image/png".to_string()
            || value == &b"image/webp".to_string(),
        EInvalidPolicy,
    );
}

fun assert_asset_descriptor(media_type: &String, byte_length: u64) {
    assert_asset_media_type(media_type);
    assert!(byte_length > 0 && byte_length <= MAX_ASSET_BYTES, EInvalidCount);
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}

public(package) fun consume_base_entitlement_witness(
    witness: RuntimeBaseEntitlementWitnessV8,
): (ID, u64, u64, address, ID, vector<u8>, vector<u8>) {
    let RuntimeBaseEntitlementWitnessV8 {
        loadout_id, loadout_revision, selection_index, holder,
        entitlement_id, entitlement_commitment, asset_content_commitment,
    } = witness;
    (
        loadout_id, loadout_revision, selection_index, holder,
        entitlement_id, entitlement_commitment, asset_content_commitment,
    )
}

public(package) fun consume_pack_entitlement_witness(
    witness: RuntimePackEntitlementWitnessV8,
): (ID, u64, u64, address, ID, vector<u8>, ID, vector<u8>, vector<u8>) {
    let RuntimePackEntitlementWitnessV8 {
        loadout_id, loadout_revision, selection_index, holder,
        pack_release_id, pack_content_commitment, pack_pass_id,
        pack_pass_commitment, asset_content_commitment,
    } = witness;
    (
        loadout_id, loadout_revision, selection_index, holder,
        pack_release_id, pack_content_commitment, pack_pass_id,
        pack_pass_commitment, asset_content_commitment,
    )
}

#[test]
fun canonical_current_state_ignores_edit_history_and_revision() {
    let mut ctx_a = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let mut ctx_b = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let mut a = test_loadout(&mut ctx_a);
    let mut b = test_loadout(&mut ctx_b);
    let first = test_selection(0, b"first".to_string(), SOURCE_BASE, a.root_id);
    let final_selection = test_selection(0, b"final".to_string(), SOURCE_BASE, a.root_id);
    install_selection(&mut a, 0, first);
    clear_selection(&mut a, 0);
    install_selection(&mut a, 0, final_selection);
    install_selection(&mut b, 0, final_selection);
    assert!(a.revision == 3, EInvalidProof);
    assert!(b.revision == 1, EInvalidProof);
    assert!(a.commitment == b.commitment, EInvalidProof);
    destroy_test_loadout(a);
    destroy_test_loadout(b);
}

#[test]
fun canonical_state_changes_for_exact_color_binding() {
    let root_id = object::id_from_address(@0x11);
    let mut one = test_selection(0, b"style".to_string(), SOURCE_BASE, root_id);
    let mut two = one;
    one.color_channel_key = option::some(b"fur".to_string());
    one.swatch_key = option::some(b"red".to_string());
    two.color_channel_key = option::some(b"fur".to_string());
    two.swatch_key = option::some(b"blue".to_string());
    assert!(selection_commitment_v8(one) != selection_commitment_v8(two), EInvalidProof);
}

#[test]
fun fixed_profile_is_valid_and_keeps_capacity_one() {
    assert_profile_policy(WARDROBE_FIXED, BEHAVIOR_FIXED, 1, ADMISSION_DISABLED, true);
    assert_profile_policy(WARDROBE_FIXED, BEHAVIOR_FIXED, 1, ADMISSION_OPEN, false);
}

#[test]
fun composable_slot_profile_accepts_pack_styles() {
    let profile = test_profile(WARDROBE_SLOT, BEHAVIOR_SOUL_LOCAL, true);
    assert_pack_profile(&profile);
}

#[test, expected_failure(abort_code = EFixedPart)]
fun fixed_profile_rejects_pack_styles() {
    let profile = test_profile(WARDROBE_FIXED, BEHAVIOR_FIXED, true);
    assert_pack_profile(&profile);
}

#[test]
fun slot_profile_accepts_multi_selection_capacity() {
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_HYBRID, 2, ADMISSION_OPEN, false);
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_SOUL_LOCAL, MAX_PART_CAPACITY,
        ADMISSION_CERTIFIED, true);
}

#[test]
fun flattened_part_slots_allocate_every_capacity_position_exactly_once() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 70, 0, 0, 0);
    let definitions = test_definitions_with_capacity(&mut ctx, 2);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 2);
    let root_id = loadout.root_id;
    let profile = definitions.profiles.borrow(PartProfileKeyV8 {
        part_key: b"body".to_string(),
    });
    let first = selection_slot(&loadout, &definitions, profile, option::none());
    assert!(first == 0, EPartOrder);
    install_selection(&mut loadout, first, test_selection(
        first, b"one".to_string(), SOURCE_BASE, root_id));
    let second = selection_slot(&loadout, &definitions, profile, option::none());
    assert!(second == 1, EPartOrder);
    install_selection(&mut loadout, second, test_selection(
        second, b"two".to_string(), SOURCE_BASE, root_id));
    assert!(loadout.selection_count == 2, EInvalidCount);
    destroy_test_definitions(definitions);
    destroy_test_loadout(loadout);
}

#[test]
fun definition_layout_is_committed_and_does_not_reindex_on_profile_index_change() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 72, 0, 0, 0);
    let definitions = test_definitions_with_capacity(&mut ctx, 2);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 2);
    loadout.definition_slots = base_definition_slots(&definitions);
    recompute_loadout(&mut loadout);
    let committed = loadout.commitment;
    let mut profile = *definitions.profiles.borrow(PartProfileKeyV8 { part_key: b"body".to_string() });
    // The persisted definition identity/range, not mutable index metadata,
    // decides the meaning of an existing loadout's positions.
    profile.index = 99;
    assert!(profile_slot_start(&loadout, &profile) == 0, EPartOrder);
    loadout.definition_slots[0].source_definition_id = object::id_from_address(@0x22);
    recompute_loadout(&mut loadout);
    assert!(committed != loadout.commitment, EInvalidProof);
    loadout.definition_slots = base_definition_slots(&definitions);
    loadout.definition_slots[0].profile_commitment = test_hash(99);
    recompute_loadout(&mut loadout);
    assert!(committed != loadout.commitment, EInvalidProof);
    destroy_test_definitions(definitions);
    destroy_test_loadout(loadout);
}

#[test]
fun definition_slot_bcs_matches_client() {
    let slot = DefinitionSlotV8 { source_definition_id: object::id_from_address(@0x11),
        part_key: b"body".to_string(), profile_commitment: test_hash(2), start: 0, capacity: 2 };
    assert!(bcs::to_bytes(&slot) == x"000000000000000000000000000000000000000000000000000000000000001104626f647920020202020202020202020202020202020202020202020202020202020202020200000000000000000200000000000000", EInvalidProof);
}

#[test, expected_failure(abort_code = EInvalidBinding)]
fun definition_layout_rejects_same_key_from_another_release() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 73, 0, 0, 0);
    let definitions = test_definitions_with_capacity(&mut ctx, 2);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 2);
    loadout.definition_slots[0].source_definition_id = object::id_from_address(@0x22);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key: b"body".to_string() });
    let _ = profile_slot_start(&loadout, profile);
    destroy_test_definitions(definitions);
    destroy_test_loadout(loadout);
}

#[test_only]
fun explicit_slot_case(case: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 71, 0, 0, 0);
    let mut definitions = test_definitions_with_capacity(&mut ctx, 2);
    let mut second = test_profile(WARDROBE_SLOT, BEHAVIOR_HYBRID, false);
    second.index = 1;
    second.part_key = b"hat".to_string();
    second.capacity = 2;
    definitions.profiles.add(PartProfileKeyV8 { part_key: second.part_key }, second);
    definitions.profile_keys.push_back(second.part_key);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 4);
    loadout.definition_slots = base_definition_slots(&definitions);
    recompute_loadout(&mut loadout);
    let target = if (case == 1) 1 else if (case == 2) 4 else 3;
    let slot = selection_slot(&loadout, &definitions, &second, option::some(target));
    assert!(slot == 3, EPartOrder);
    let mut selected = test_selection(slot, b"sparse".to_string(), SOURCE_PACK, loadout.root_id);
    selected.part_key = second.part_key;
    install_selection(&mut loadout, slot, selected);
    assert!(loadout.selections[0].is_none() && loadout.selections[1].is_none()
        && loadout.selections[2].is_none() && loadout.selections[3].is_some(), EPartOrder);
    if (case == 3) {
        let _ = selection_slot(&loadout, &definitions, &second, option::some(3));
        abort EInvalidProof
    };
    // None still chooses the first available slot inside this Part only.
    assert!(selection_slot(&loadout, &definitions, &second, option::none()) == 2, EPartOrder);
    let sparse_commitment = loadout.commitment;
    clear_selection(&mut loadout, slot);
    assert!(loadout.selection_count == 0 && loadout.revision == 2, EInvalidCount);
    let restored = selection_slot(&loadout, &definitions, &second, option::some(3));
    install_selection(&mut loadout, restored, selected);
    assert!(loadout.commitment == sparse_commitment && loadout.revision == 3
        && loadout.selection_count == 1 && loadout.selections[2].is_none(), EInvalidProof);
    let _ = definitions.profiles.remove(PartProfileKeyV8 { part_key: second.part_key });
    destroy_test_definitions(definitions);
    destroy_test_loadout(loadout);
}

#[test]
fun explicit_target_slot_preserves_sparse_second_part_and_none_first_empty() { explicit_slot_case(0); }

#[test, expected_failure(abort_code = EPartOrder)]
fun explicit_target_slot_rejects_another_part() { explicit_slot_case(1); }

#[test, expected_failure(abort_code = EPartOrder)]
fun explicit_target_slot_rejects_outside_capacity() { explicit_slot_case(2); }

#[test, expected_failure(abort_code = EDuplicate)]
fun explicit_target_slot_rejects_occupied_slot() { explicit_slot_case(3); }

#[test]
fun rule_selection_preserves_source_item_and_style_identity() {
    let product_id = object::id_from_address(@0x11);
    let local = test_selection(0, b"blue".to_string(), SOURCE_BASE, product_id);
    let pack = test_selection(0, b"blue".to_string(), SOURCE_PACK, product_id);
    let external = test_selection(0, b"blue".to_string(), SOURCE_EXTERNAL, product_id);
    let part = base::new_semantic_selector_v2(0, option::none(),
        b"body".to_string(), option::none(), option::none());
    let local_style = base::new_semantic_selector_v2(1, option::none(),
        b"body".to_string(), option::some(b"item".to_string()),
        option::some(b"blue".to_string()));
    let pack_style = base::new_semantic_selector_v2(2, option::some(b"pack".to_string()),
        b"body".to_string(), option::some(b"item".to_string()),
        option::some(b"blue".to_string()));
    let wrong_pack = base::new_semantic_selector_v2(2, option::some(b"other".to_string()),
        b"body".to_string(), option::some(b"item".to_string()), option::none());
    let product = base::new_semantic_selector_v2(3, option::some(
        b"0x0000000000000000000000000000000000000000000000000000000000000011".to_string()),
        b"body".to_string(), option::some(b"item".to_string()), option::none());
    let other_product = base::new_semantic_selector_v2(3, option::some(
        b"0x0000000000000000000000000000000000000000000000000000000000000012".to_string()),
        b"body".to_string(), option::some(b"item".to_string()), option::none());
    assert!(selection_matches_rule_selector(&local, &local_style), ERuleViolation);
    assert!(!selection_matches_rule_selector(&pack, &local_style), ERuleViolation);
    assert!(selection_matches_rule_selector(&pack, &pack_style), ERuleViolation);
    assert!(!selection_matches_rule_selector(&local, &pack_style), ERuleViolation);
    assert!(!selection_matches_rule_selector(&pack, &wrong_pack), ERuleViolation);
    assert!(selection_matches_rule_selector(&external, &product), ERuleViolation);
    assert!(!selection_matches_rule_selector(&external, &other_product), ERuleViolation);
    assert!(!selection_matches_rule_selector(&pack, &product), ERuleViolation);
    assert!(selection_matches_rule_selector(&local, &part)
        && selection_matches_rule_selector(&pack, &part)
        && selection_matches_rule_selector(&external, &part), ERuleViolation);
    let red = test_selection(0, b"red".to_string(), SOURCE_BASE, product_id);
    assert!(!selection_matches_rule_selector(&red, &local_style), ERuleViolation);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun require_rule_all_rejects_one_missing_target() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 70, 0, 0, 0);
    let mut loadout = test_loadout(&mut ctx);
    let root_id = loadout.root_id;
    install_selection(&mut loadout, 0,
        test_selection(0, b"blue".to_string(), SOURCE_BASE, root_id));
    assert_loadout_rule(&loadout, &test_style_rule(RULE_REQUIRE, 0));
    destroy_test_loadout(loadout);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun exclude_rule_rejects_any_one_target() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 70, 0, 0, 0);
    let mut loadout = test_loadout(&mut ctx);
    let root_id = loadout.root_id;
    install_selection(&mut loadout, 0,
        test_selection(0, b"blue".to_string(), SOURCE_BASE, root_id));
    assert_loadout_rule(&loadout, &test_style_rule(RULE_EXCLUDE, 1));
    destroy_test_loadout(loadout);
}

#[test]
fun rule_loadout_matches_any_and_inactive_trigger() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 70, 0, 0, 0);
    let mut loadout = test_loadout(&mut ctx);
    assert_loadout_rule(&loadout, &test_style_rule(RULE_REQUIRE, 0));
    assert_loadout_rule(&loadout, &test_style_rule(RULE_EXCLUDE, 1));
    let root_id = loadout.root_id;
    install_selection(&mut loadout, 0,
        test_selection(0, b"blue".to_string(), SOURCE_BASE, root_id));
    assert_loadout_rule(&loadout, &test_style_rule(RULE_REQUIRE, 1));
    destroy_test_loadout(loadout);
}

#[test_only]
fun test_style_rule(kind: u8, target_mode: u8): base::RuleRowV2 {
    let trigger = base::new_semantic_selector_v2(0, option::none(),
        b"body".to_string(), option::none(), option::none());
    let blue = base::new_semantic_selector_v2(1, option::none(),
        b"body".to_string(), option::some(b"item".to_string()),
        option::some(b"blue".to_string()));
    let red = base::new_semantic_selector_v2(1, option::none(),
        b"body".to_string(), option::some(b"item".to_string()),
        option::some(b"red".to_string()));
    base::new_rule_row_v2(0, b"styles".to_string(), kind, trigger,
        target_mode, vector[blue, red], test_hash(10))
}

#[test_only]
fun visibility_authorization_case(subject: u8, source: u8, predicate_source: u8, negate: bool) {
    let hint = 220 + (subject as u64) * 1000 + (source as u64) * 100
        + (predicate_source as u64) * 10 + if (negate) 1 else 0;
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, hint, 0, 0, 0);
    let source_id = object::id_from_address(@0x11);
    let source_key = if (predicate_source == 2) option::some(b"pack".to_string())
        else if (predicate_source == 3) option::some(
            b"0x0000000000000000000000000000000000000000000000000000000000000011".to_string())
        else option::none();
    let mut tokens = vector[base::new_visibility_token_v1(0, option::some(
        base::new_semantic_selector_v2(predicate_source, source_key, b"part".to_string(),
            option::some(b"item".to_string()), option::some(b"style".to_string()))), 0)];
    if (negate) tokens.push_back(base::new_visibility_token_v1(1, option::none(), 1));
    let registry = base::new_visibility_registry_for_testing(tokens, subject, &mut ctx);
    let mut definitions = test_definitions_with_capacity(&mut ctx, 1);
    let mut profile = definitions.profiles.remove(PartProfileKeyV8 { part_key: b"body".to_string() });
    profile.part_key = b"part".to_string();
    definitions.profiles.add(PartProfileKeyV8 { part_key: profile.part_key }, profile);
    definitions.profile_keys = vector[profile.part_key];
    definitions.base_registry_id = object::id(&registry);
    definitions.root_id = base::registry_root_id_v2(&registry);
    definitions.root_version = base::registry_maker_version_v2(&registry);
    definitions.root_content_commitment = *base::registry_root_content_commitment_v2(&registry);
    let mut loadout = test_loadout(&mut ctx);
    loadout.root_id = definitions.root_id;
    loadout.root_version = definitions.root_version;
    loadout.root_content_commitment = definitions.root_content_commitment;
    loadout.definition_registry_id = object::id(&definitions);
    let mut selection = test_selection(0, b"style".to_string(), source, source_id);
    loadout.definition_slots = base_definition_slots(&definitions);
    selection.part_key = b"part".to_string();
    install_selection(&mut loadout, 0, selection);
    let original_commitment = loadout.commitment;
    let original_revision = loadout.revision;
    let proof = new_selection_proof(&loadout, loadout.selections[0].borrow(), test_hash(6));
    let authorization = seal_ordered_selection_proofs_v8(
        &loadout, &definitions, &registry, vector[], vector[proof], &ctx);
    let (_, _, _, _, _, _, _, _, _, _) = consume_loadout_authorization_v8(authorization, &loadout);
    assert!(loadout.commitment == original_commitment && loadout.revision == original_revision
        && loadout.selection_count == 1, EInvalidProof);
    let _ = definitions.profiles.remove(PartProfileKeyV8 { part_key: profile.part_key });
    profile.part_key = b"body".to_string();
    definitions.profiles.add(PartProfileKeyV8 { part_key: profile.part_key }, profile);
    destroy_test_definitions(definitions);
    destroy_test_loadout(loadout);
    base::share_base_definition_registry_for_testing(registry);
}

#[test]
fun visibility_authorization_accepts_selected_base_part_item_and_style() {
    visibility_authorization_case(0, SOURCE_BASE, 1, false);
    visibility_authorization_case(1, SOURCE_BASE, 1, false);
    visibility_authorization_case(2, SOURCE_BASE, 1, false);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun visibility_authorization_rejects_false_selected_style() {
    visibility_authorization_case(2, SOURCE_BASE, 1, true);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun visibility_authorization_rejects_false_selected_item() {
    visibility_authorization_case(1, SOURCE_BASE, 1, true);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun visibility_authorization_rejects_false_host_part() {
    visibility_authorization_case(0, SOURCE_BASE, 1, true);
}

#[test]
fun visibility_authorization_matches_exact_pack_and_external_sources() {
    visibility_authorization_case(0, SOURCE_PACK, 2, false);
    visibility_authorization_case(0, SOURCE_EXTERNAL, 3, false);
    visibility_authorization_case(0, SOURCE_PACK, 1, true);
    visibility_authorization_case(0, SOURCE_EXTERNAL, 1, true);
}

#[test]
fun visibility_authorization_does_not_apply_unselected_base_style_to_other_sources() {
    visibility_authorization_case(2, SOURCE_PACK, 1, false);
    visibility_authorization_case(2, SOURCE_EXTERNAL, 1, false);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun visibility_authorization_pack_same_name_does_not_satisfy_base() {
    visibility_authorization_case(0, SOURCE_PACK, 1, false);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun visibility_authorization_external_same_name_does_not_satisfy_base() {
    visibility_authorization_case(0, SOURCE_EXTERNAL, 1, false);
}

#[test, expected_failure(abort_code = ERuleViolation)]
fun visibility_authorization_base_same_name_does_not_satisfy_pack() {
    visibility_authorization_case(2, SOURCE_BASE, 2, false);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun profile_rejects_capacity_above_product_limit() {
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_HYBRID,
        MAX_PART_CAPACITY + 1, ADMISSION_OPEN, false);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun profile_rejects_unknown_wardrobe_mode() {
    assert_profile_policy(2, BEHAVIOR_HYBRID, 1, ADMISSION_OPEN, false);
}

#[test]
fun slot_profile_accepts_all_three_composable_behaviors() {
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_SOUL_LOCAL, 1, ADMISSION_OPEN, true);
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_OPEN, 1, ADMISSION_OPEN, false);
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_HYBRID, 1, ADMISSION_OPEN, true);
}

#[test]
fun only_open_and_hybrid_behaviors_accept_external_items() {
    assert!(!behavior_accepts_external(BEHAVIOR_FIXED), EInvalidPolicy);
    assert!(!behavior_accepts_external(BEHAVIOR_SOUL_LOCAL), EInvalidPolicy);
    assert!(behavior_accepts_external(BEHAVIOR_OPEN), EInvalidPolicy);
    assert!(behavior_accepts_external(BEHAVIOR_HYBRID), EInvalidPolicy);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun required_profile_rejects_open_behavior() {
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_OPEN, 1, ADMISSION_OPEN, true);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun fixed_wardrobe_rejects_nonfixed_behavior() {
    assert_profile_policy(WARDROBE_FIXED, BEHAVIOR_SOUL_LOCAL, 1, ADMISSION_OPEN, false);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun slot_wardrobe_rejects_fixed_behavior() {
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_FIXED, 1, ADMISSION_OPEN, false);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun profile_rejects_unknown_behavior() {
    assert_profile_policy(WARDROBE_SLOT, 4, 1, ADMISSION_OPEN, false);
}

#[test]
fun all_pack_complete_modes_validate() {
    assert_complete_policy(COMPLETE_UNLIMITED_FREE, 0, 0, 0);
    assert_complete_policy(COMPLETE_FREE_QUOTA_THEN_PAID, 10, 2, 100);
    assert_complete_policy(COMPLETE_PAID_EVERY_TIME, 10, 0, 0);
    assert_complete_policy(COMPLETE_FREE_QUOTA_THEN_BLOCK, 0, 2, 2);
}

#[test]
fun external_render_asset_descriptor_accepts_supported_image() {
    assert_asset_descriptor(&b"image/png".to_string(), 12582912);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun external_render_asset_descriptor_rejects_non_image_media() {
    assert_asset_descriptor(&b"text/html".to_string(), 1);
}

#[test, expected_failure(abort_code = EInvalidCount)]
fun external_render_asset_descriptor_rejects_zero_bytes() {
    assert_asset_descriptor(&b"image/png".to_string(), 0);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun complete_total_cap_cannot_undercut_quota() {
    assert_complete_policy(COMPLETE_FREE_QUOTA_THEN_BLOCK, 0, 2, 1);
}

#[test]
fun complete_price_switches_exactly_after_quota() {
    assert!(complete_price_for_ordinal(COMPLETE_FREE_QUOTA_THEN_PAID, 25, 2, 0) == 0, EInvalidPolicy);
    assert!(complete_price_for_ordinal(COMPLETE_FREE_QUOTA_THEN_PAID, 25, 2, 1) == 0, EInvalidPolicy);
    assert!(complete_price_for_ordinal(COMPLETE_FREE_QUOTA_THEN_PAID, 25, 2, 2) == 25, EInvalidPolicy);
}

#[test, expected_failure(abort_code = ECompleteBlocked)]
fun free_quota_then_block_rejects_paid_tail() {
    complete_price_for_ordinal(COMPLETE_FREE_QUOTA_THEN_BLOCK, 0, 1, 1);
}

#[test]
fun fixed_and_slot_are_distinct_commitment_inputs() {
    let root = test_hash(1);
    let previous = empty_profile_commitment_v8(root);
    let fixed = advance_profile_commitment_v8(
        root, 0, previous, b"body".to_string(), test_hash(2), true,
        WARDROBE_FIXED, BEHAVIOR_FIXED, 1, ADMISSION_OPEN,
    );
    let slot = advance_profile_commitment_v8(
        root, 0, previous, b"body".to_string(), test_hash(2), true,
        WARDROBE_SLOT, BEHAVIOR_HYBRID, 1, ADMISSION_OPEN,
    );
    assert!(fixed != slot, EInvalidCommitment);
}

#[test]
fun pack_empty_commitment_binds_release_content() {
    let root = test_hash(1);
    assert!(empty_pack_style_commitment_v8(root, test_hash(2))
        != empty_pack_style_commitment_v8(root, test_hash(3)), EInvalidCommitment);
}

#[test, expected_failure(abort_code = EStaleRevision)]
fun loadout_revision_is_exact_cas() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let loadout = test_loadout(&mut ctx);
    assert_loadout_holder_revision(&loadout, 1, &ctx);
    destroy_test_loadout(loadout);
}

#[test]
fun physical_selection_witness_round_trips_exact_current_source() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 60, 0, 0, 0);
    let mut loadout = test_loadout(&mut ctx);
    let selection = test_selection(0, b"style".to_string(), SOURCE_PACK,
        object::id_from_address(@0x21));
    install_selection(&mut loadout, 0, selection);
    let proof = new_selection_proof(&loadout,
        loadout.selections.borrow(0).borrow(), test_hash(6));
    let witness = certify_physical_selection_v8(proof, &loadout, &ctx);
    let (loadout_id, root_id, root_version, root_content, holder,
        revision, loadout_commitment, index, selection_commitment,
        part_key, item_key, style_key, layer_track_key,
        source_class, source_definition_id, source_semantic_id,
        source_content, source_epoch, pricing_commitment, asset_content) =
        consume_physical_selection_witness_v8(witness, &loadout, &ctx);
    assert!(loadout_id == object::id(&loadout), EInvalidProof);
    assert!(root_id == loadout.root_id && root_version == loadout.root_version,
        EInvalidProof);
    assert!(root_content == loadout.root_content_commitment, EInvalidProof);
    assert!(holder == @0xA11 && revision == loadout.revision, EInvalidProof);
    assert!(loadout_commitment == loadout.commitment, EInvalidProof);
    assert!(index == 0 && selection_commitment == selection_commitment_v8(selection),
        EInvalidProof);
    assert!(part_key == selection.part_key && item_key == selection.item_key,
        EInvalidProof);
    assert!(style_key == selection.style_key
        && layer_track_key == selection.layer_track_key, EInvalidProof);
    assert!(source_class == SOURCE_PACK, EInvalidProof);
    assert!(source_definition_id == selection.source_definition_id,
        EInvalidProof);
    assert!(source_semantic_id == selection.source_semantic_id,
        EInvalidProof);
    assert!(source_content == test_hash(6) && source_epoch == 0,
        EInvalidProof);
    assert!(pricing_commitment == selection.pricing_commitment,
        EInvalidProof);
    assert!(asset_content == selection.asset_content_commitment,
        EInvalidProof);
    destroy_test_loadout(loadout)
}

#[test, expected_failure(abort_code = EInvalidProof)]
fun physical_selection_witness_rejects_loadout_mutation() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 61, 0, 0, 0);
    let mut loadout = test_loadout(&mut ctx);
    let selection = test_selection(0, b"first".to_string(), SOURCE_BASE,
        object::id_from_address(@0x21));
    install_selection(&mut loadout, 0, selection);
    let proof = new_selection_proof(&loadout,
        loadout.selections.borrow(0).borrow(), test_hash(6));
    let witness = certify_physical_selection_v8(proof, &loadout, &ctx);
    clear_selection(&mut loadout, 0);
    install_selection(&mut loadout, 0, test_selection(
        0, b"second".to_string(), SOURCE_BASE,
        object::id_from_address(@0x21)));
    consume_test_physical_witness(witness, &loadout, &ctx);
    destroy_test_loadout(loadout)
}

#[test, expected_failure(abort_code = EWrongHolder)]
fun physical_selection_witness_rejects_wrong_holder() {
    let mut owner_ctx = sui::tx_context::new_from_hint(@0xA11, 62, 0, 0, 0);
    let wrong_ctx = sui::tx_context::new_from_hint(@0xB0B, 63, 0, 0, 0);
    let mut loadout = test_loadout(&mut owner_ctx);
    let selection = test_selection(0, b"style".to_string(), SOURCE_BASE,
        object::id_from_address(@0x21));
    install_selection(&mut loadout, 0, selection);
    let proof = new_selection_proof(&loadout,
        loadout.selections.borrow(0).borrow(), test_hash(6));
    let witness = certify_physical_selection_v8(proof, &loadout, &wrong_ctx);
    consume_test_physical_witness(witness, &loadout, &wrong_ctx);
    destroy_test_loadout(loadout)
}

#[test, expected_failure(abort_code = EEquipLocked)]
fun equipped_owned_item_cannot_transfer() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 4, 0, 0, 0);
    let mut item = OwnedExternalItemV8 {
        id: object::new(&mut ctx),
        version: VERSION,
        product_id: object::id_from_address(@0x22),
        product_content_commitment: test_hash(1),
        asset_content_commitment: test_hash(2),
        holder: @0xA11,
        ownership_epoch: 0,
        transferable: true,
        equip_lock: option::some(EquipLockV8 {
            loadout_id: object::id_from_address(@0x33),
            equip_revision: 1,
            selection_index: 0,
        }),
    };
    prepare_owned_item_transfer(&mut item, @0xB11, &ctx);
    destroy_test_owned_item(item);
}

#[test, expected_failure(abort_code = EEquipLocked)]
fun equipped_owned_base_item_cannot_transfer() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 64, 0, 0, 0);
    let (definitions, mut packs, mut item) = test_owned_base_fixture(&mut ctx);
    item.equip_lock = option::some(EquipLockV8 {
        loadout_id: object::id_from_address(@0x33),
        equip_revision: 1,
        selection_index: 0,
    });
    prepare_owned_base_item_transfer(
        &mut packs, &definitions, &mut item, @0xB11, &ctx,
    );
    destroy_test_owned_base_fixture(definitions, packs, item);
}

#[test]
fun unlocked_owned_base_item_transfer_rotates_registry_and_epoch() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 65, 0, 0, 0);
    let (definitions, mut packs, mut item) = test_owned_base_fixture(&mut ctx);
    let original_commitment = owned_base_item_commitment(&item);
    prepare_owned_base_item_transfer(
        &mut packs, &definitions, &mut item, @0xB11, &ctx,
    );
    assert!(item.holder == @0xB11, EWrongHolder);
    assert!(item.ownership_epoch == 1, EInvalidBinding);
    assert!(packs.wardrobe_revision == 1, EInvalidBinding);
    let record = packs.base_item_owners.borrow(BaseItemHolderKeyV8 {
        part_key: item.part_key,
        item_key: item.item_key,
        holder: @0xB11,
    });
    assert!(record.item_id == object::id(&item), EInvalidBinding);
    assert!(record.ownership_epoch == 1, EInvalidBinding);
    assert!(owned_base_item_commitment(&item) != original_commitment, EInvalidCommitment);
    destroy_test_owned_base_fixture(definitions, packs, item);
}

#[test, expected_failure(abort_code = ERecipientAlreadyOwned)]
fun owned_base_item_transfer_rejects_duplicate_recipient_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 66, 0, 0, 0);
    let (definitions, mut packs, mut item) = test_owned_base_fixture(&mut ctx);
    packs.base_item_owners.add(BaseItemHolderKeyV8 {
        part_key: item.part_key,
        item_key: item.item_key,
        holder: @0xB11,
    }, BaseItemOwnershipRecordV8 {
        item_id: object::id_from_address(@0x44),
        ownership_epoch: 0,
    });
    prepare_owned_base_item_transfer(
        &mut packs, &definitions, &mut item, @0xB11, &ctx,
    );
    destroy_test_owned_base_fixture(definitions, packs, item);
}

#[test, expected_failure(abort_code = EEquipLocked)]
fun generic_clear_cannot_bypass_owned_base_item_lock() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 67, 0, 0, 0);
    let mut loadout = test_loadout(&mut ctx);
    let mut selection = test_selection(0, b"style".to_string(), SOURCE_BASE,
        loadout.root_id);
    selection.access_subject = object::id_from_address(@0x44);
    install_selection(&mut loadout, 0, selection);
    clear_non_external_selection_v8(&mut loadout, 0, 1, &ctx);
    destroy_test_loadout(loadout);
}

#[test]
fun unlocked_owned_item_transfer_increments_ownership_epoch() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 5, 0, 0, 0);
    let mut item = OwnedExternalItemV8 {
        id: object::new(&mut ctx),
        version: VERSION,
        product_id: object::id_from_address(@0x22),
        product_content_commitment: test_hash(1),
        asset_content_commitment: test_hash(2),
        holder: @0xA11,
        ownership_epoch: 0,
        transferable: true,
        equip_lock: option::none(),
    };
    prepare_owned_item_transfer(&mut item, @0xB11, &ctx);
    assert!(item.holder == @0xB11, EWrongHolder);
    assert!(item.ownership_epoch == 1, EInvalidBinding);
    destroy_test_owned_item(item);
}

#[test]
fun loadout_commitment_binds_source_identity_and_epoch() {
    let root_id = object::id_from_address(@0x11);
    let one = test_selection(0, b"style".to_string(), SOURCE_EXTERNAL, root_id);
    let mut two = one;
    two.source_epoch = 1;
    assert!(selection_commitment_v8(one) != selection_commitment_v8(two), EInvalidProof);
}

#[test]
fun protocol_share_uses_exact_floor_arithmetic() {
    assert!(protocol_share(10_000, 250) == 250, EWrongPayment);
    assert!(protocol_share(99, 0) == 0, EWrongPayment);
}

#[test]
fun pack_pricing_ignores_write_control_epoch() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 50, 0, 0, 0);
    let mut release = test_pack_release(&mut ctx);
    let before = pack_pricing_commitment(&release);
    release.control_epoch = 77;
    release.owner = @0xB11;
    assert!(pack_pricing_commitment(&release) == before, EInvalidCommitment);
    destroy_test_pack_release(release)
}

#[test]
fun pack_pricing_binds_access_and_complete_economics() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 51, 0, 0, 0);
    let mut release = test_pack_release(&mut ctx);
    let before = pack_pricing_commitment(&release);
    release.access_price_atomic = 101;
    assert!(pack_pricing_commitment(&release) != before, EInvalidCommitment);
    let access_changed = pack_pricing_commitment(&release);
    release.complete_free_quota_per_wallet = 3;
    release.complete_total_cap = 9;
    assert!(pack_pricing_commitment(&release) != access_changed, EInvalidCommitment);
    destroy_test_pack_release(release)
}

#[test]
fun seal_binding_commits_runtime_revision_and_exact_ciphertext() {
    let one = seal_binding_commitment_v8(
        object::id_from_address(@0x1), test_hash(1), 0, test_hash(2),
        object::id_from_address(@0x2), test_hash(3), object::id_from_address(@0x3),
        1, test_hash(4), 1, b"pack/one".to_string(), test_hash(5),
        b"part/item/style".to_string(), test_hash(6), b"blob".to_string(),
        test_hash(7), test_hash(8), test_hash(9), test_hash(10));
    let two = seal_binding_commitment_v8(
        object::id_from_address(@0x1), test_hash(1), 1, test_hash(2),
        object::id_from_address(@0x2), test_hash(3), object::id_from_address(@0x3),
        1, test_hash(4), 1, b"pack/one".to_string(), test_hash(5),
        b"part/item/style".to_string(), test_hash(6), b"blob".to_string(),
        test_hash(7), test_hash(8), test_hash(9), test_hash(10));
    assert!(one != two, EInvalidCommitment)
}

#[test, expected_failure(abort_code = EWrongPayment)]
fun nonzero_protocol_fee_cannot_round_to_zero() {
    protocol_share(1, 1);
    abort EWrongPayment
}

#[test, expected_failure(abort_code = EInvalidKey)]
fun semantic_key_components_cannot_smuggle_path_delimiters() {
    let _ = style_seal_asset_key_v8(
        b"body/other".to_string(), b"item".to_string(), b"style".to_string());
    abort EInvalidKey
}

#[test_only]
fun consume_test_physical_witness(
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
) {
    let (_loadout_id, _root_id, _root_version, _root_content, _holder,
        _revision, _loadout_commitment, _index, _selection_commitment,
        _part_key, _item_key, _style_key, _layer_track_key,
        _source_class, _source_definition_id, _source_semantic_id,
        _source_content, _source_epoch, _pricing_commitment, _asset_content) =
        consume_physical_selection_witness_v8(witness, loadout, ctx);
}

/// Cross-package Physical tests use real Runtime object layouts and exact
/// immutable Root tuples without publishing shared objects.
#[test_only]
public fun new_physical_runtime_fixture_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    ctx: &mut TxContext,
): (
    RuntimeDefinitionRegistryV8,
    PackRegistryV8,
    PackAdmissionAuthorityV8,
) {
    let definition_uid = object::new(ctx);
    let definition_id = definition_uid.to_inner();
    let pack_uid = object::new(ctx);
    let authority_uid = object::new(ctx);
    let authority_id = authority_uid.to_inner();
    let root_id = maker::root_id_v8(root);
    let root_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let definitions = RuntimeDefinitionRegistryV8 {
        id: definition_uid,
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
        base_registry_id: maker::root_base_registry_id_v2(root),
        expected_profile_count: 0,
        observed_profile_count: 0,
        expected_profile_commitment: test_hash(70),
        rolling_profile_commitment: test_hash(70),
        admission_ceiling: ADMISSION_DISABLED,
        item_assetization: false,
        sealed: true,
        profile_keys: vector[],
        profiles: table::new(ctx),
    };
    let packs = PackRegistryV8 {
        id: pack_uid,
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
        definition_registry_id: definition_id,
        admission_authority_id: authority_id,
        admission_policy_commitment:
            *maker::root_expected_pack_admission_policy_commitment_v2(root),
        revision: 0,
        release_count: 0,
        external_admission_count: 0,
        wardrobe_revision: 0,
        base_item_count: 0,
        releases: table::new(ctx),
        semantic_releases: table::new(ctx),
        external_admissions: table::new(ctx),
        base_item_owners: table::new(ctx),
    };
    let authority = PackAdmissionAuthorityV8 {
        id: authority_uid,
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
    };
    (definitions, packs, authority)
}

#[test_only]
/// Derives fixture row bytes only; creates no release, pass, admission or cap.
/// Upper integration tests append the same row through the public author API.
public fun physical_pack_style_commitment_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
): vector<u8> {
    let content = *maker::root_content_commitment_v8(root);
    let release_content = test_hash(71);
    advance_pack_style_commitment_v8(content, release_content, 0,
        empty_pack_style_commitment_v8(content, release_content), PackStyleV8 {
            index: 0, definition_sources: new_pack_style_definition_sources_v8(1, 1, option::none()),
            part_key: b"part".to_string(), item_key: b"pack-item".to_string(),
            style_key: b"pack-style".to_string(), layer_track_key: b"track".to_string(),
            color_channel_key: option::none(), default_swatch_key: option::none(),
            asset_blob_id: b"pack-style-blob".to_string(), asset_sha256: test_hash(72),
            asset_content_commitment: test_hash(73), protected: false,
            seal_binding_commitment: vector[], style_commitment: test_hash(74),
        })
}

#[test_only]
public fun add_physical_pack_fixture_for_testing<PaymentCoin>(
    packs: &mut PackRegistryV8,
    definitions: &RuntimeDefinitionRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &mut TxContext,
): (
    PackReleaseV8<PaymentCoin>,
    PackAdminCapV8,
    PackTreasuryV8<PaymentCoin>,
    PackPassV8,
    MakerLoadoutV8,
) {
    assert!(packs.definition_registry_id == object::id(definitions), EInvalidBinding);
    maker::assert_root_identity_v8(
        root,
        packs.root_id,
        packs.root_version,
        &packs.root_content_commitment,
    );
    let release_uid = object::new(ctx);
    let release_id = release_uid.to_inner();
    let admin_uid = object::new(ctx);
    let admin_id = admin_uid.to_inner();
    let treasury_uid = object::new(ctx);
    let treasury_id = treasury_uid.to_inner();
    let pass_uid = object::new(ctx);
    let pass_id = pass_uid.to_inner();
    let semantic_pack_id = b"physical-pack".to_string();
    let release_content_commitment = test_hash(71);
    let style = PackStyleV8 {
        index: 0,
        definition_sources: new_pack_style_definition_sources_v8(1, 1, option::none()),
        part_key: b"part".to_string(),
        item_key: b"pack-item".to_string(),
        style_key: b"pack-style".to_string(),
        layer_track_key: b"track".to_string(),
        color_channel_key: option::none(),
        default_swatch_key: option::none(),
        asset_blob_id: b"pack-style-blob".to_string(),
        asset_sha256: test_hash(72),
        asset_content_commitment: test_hash(73),
        protected: false,
        seal_binding_commitment: vector[],
        style_commitment: test_hash(74),
    };
    let mut styles = table::new(ctx);
    styles.add(PackStyleKeyV8 {
        part_key: style.part_key,
        item_key: style.item_key,
        style_key: style.style_key,
    }, style);
    let release = PackReleaseV8<PaymentCoin> {
        id: release_uid,
        version: VERSION,
        root_id: packs.root_id,
        root_version: packs.root_version,
        root_content_commitment: packs.root_content_commitment,
        creator: ctx.sender(),
        owner: ctx.sender(),
        control_epoch: 0,
        admin_cap_id: admin_id,
        treasury_id,
        semantic_pack_id,
        manifest_blob_id: b"physical-pack-manifest".to_string(),
        manifest_sha256: test_hash(75),
        content_commitment: release_content_commitment,
        lifecycle: PACK_ACTIVE,
        access_kind: ACCESS_FREE,
        access_price_atomic: 0,
        complete_mode: COMPLETE_UNLIMITED_FREE,
        complete_price_atomic: 0,
        complete_free_quota_per_wallet: 0,
        complete_total_cap: 0,
        expected_style_count: 1,
        observed_style_count: 1,
        expected_style_commitment: test_hash(76),
        rolling_style_commitment: test_hash(76),
        protected_style_count: 0,
        pass_count: 1,
        total_complete_count: 0,
        styles,
        complete_by_wallet: table::new(ctx),
    };
    packs.revision = packs.revision + 1;
    packs.release_count = packs.release_count + 1;
    packs.releases.add(release_id, PackAdmissionRecordV8 {
        release_id,
        semantic_pack_id,
        release_content_commitment,
        admitted_revision: packs.revision,
        admission_state: ADMISSION_ACTIVE,
    });
    packs.semantic_releases.add(semantic_pack_id, release_id);
    let admin = PackAdminCapV8 {
        id: admin_uid,
        version: VERSION,
        release_id,
        owner: ctx.sender(),
        control_epoch: 0,
    };
    let treasury = PackTreasuryV8<PaymentCoin> {
        id: treasury_uid,
        version: VERSION,
        release_id,
        revenue: balance::zero(),
        total_collected: 0,
        total_withdrawn: 0,
    };
    let pass_commitment = hash::sha2_256(bcs::to_bytes(&PackPassCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/pack-pass",
        version: VERSION,
        release_id,
        root_id: packs.root_id,
        root_version: packs.root_version,
        root_content_commitment: packs.root_content_commitment,
        release_content_commitment,
        holder: ctx.sender(),
        paid_atomic: 0,
        issued_at_ms: 1,
    }));
    let pass = PackPassV8 {
        id: pass_uid,
        version: VERSION,
        release_id,
        root_id: packs.root_id,
        root_version: packs.root_version,
        root_content_commitment: packs.root_content_commitment,
        release_content_commitment,
        holder: ctx.sender(),
        paid_atomic: 0,
        issued_at_ms: 1,
        commitment: pass_commitment,
    };
    let selection = LoadoutSelectionV8 {
        selection_index: 0,
        part_key: style.part_key,
        item_key: style.item_key,
        style_key: style.style_key,
        color_channel_key: option::none(),
        swatch_key: option::none(),
        layer_track_key: style.layer_track_key,
        asset_blob_id: style.asset_blob_id,
        asset_sha256: style.asset_sha256,
        asset_content_commitment: style.asset_content_commitment,
        source_class: SOURCE_PACK,
        source_definition_id: release_id,
        source_semantic_id: semantic_pack_id,
        access_subject: pass_id,
        source_epoch: 0,
        pricing_commitment: pack_pricing_commitment(&release),
        protected: false,
        seal_binding_commitment: vector[],
    };
    let selections = vector[option::some(selection)];
    let definition_slots = base_definition_slots(definitions);
    let loadout_commitment = canonical_loadout_commitment(
        packs.root_id,
        packs.root_version,
        packs.root_content_commitment,
        &vector[],
        &definition_slots,
        &selections,
    );
    let loadout = MakerLoadoutV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id: packs.root_id,
        root_version: packs.root_version,
        root_content_commitment: packs.root_content_commitment,
        definition_registry_id: object::id(definitions),
        pack_registry_id: object::id(packs),
        maker_access_pass_id: object::id_from_address(@0xA0),
        maker_access_commitment: test_hash(77),
        holder: ctx.sender(),
        revision: 0,
        attached_pack_definitions: vector[],
        definition_slots,
        selections,
        selection_count: 1,
        commitment: loadout_commitment,
    };
    (release, admin, treasury, pass, loadout)
}

#[test_only]
public fun physical_selection_witness_for_testing(
    loadout: &MakerLoadoutV8,
    source_content_commitment: vector<u8>,
    selection_index: u64,
    ctx: &TxContext,
): RuntimePhysicalSelectionWitnessV8 {
    let selection = loadout.selections.borrow(selection_index).borrow();
    let proof = new_selection_proof(loadout, selection, source_content_commitment);
    certify_physical_selection_v8(proof, loadout, ctx)
}

#[test_only]
public fun set_physical_base_selection_for_testing<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_root_compatibility(
        loadout.root_id,
        loadout.root_version,
        &loadout.root_content_commitment,
        root,
    );
    let selection = LoadoutSelectionV8 {
        selection_index: 0,
        part_key: b"part".to_string(),
        item_key: b"item".to_string(),
        style_key: b"style".to_string(),
        color_channel_key: option::none(),
        swatch_key: option::none(),
        layer_track_key: b"track".to_string(),
        asset_blob_id: b"style-blob".to_string(),
        asset_sha256: test_hash(13),
        asset_content_commitment: test_hash(14),
        source_class: SOURCE_BASE,
        source_definition_id: loadout.root_id,
        source_semantic_id: b"".to_string(),
        access_subject: loadout.maker_access_pass_id,
        source_epoch: 0,
        pricing_commitment: loadout.maker_access_commitment,
        protected: false,
        seal_binding_commitment: vector[],
    };
    *loadout.selections.borrow_mut(0) = option::some(selection);
    loadout.revision = loadout.revision + 1;
    recompute_loadout(loadout);
}

#[test_only]
public fun mutate_physical_loadout_for_testing(loadout: &mut MakerLoadoutV8) {
    loadout.revision = loadout.revision + 1;
    recompute_loadout(loadout);
}

#[test_only]
public fun set_physical_pack_lifecycle_for_testing<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    lifecycle: u8,
) {
    release.lifecycle = lifecycle;
}

#[test_only]
public fun set_physical_pack_admission_for_testing<PaymentCoin>(
    packs: &mut PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    active: bool,
) {
    let record = packs.releases.borrow_mut(object::id(release));
    record.admission_state = if (active) ADMISSION_ACTIVE else ADMISSION_REVOKED;
    packs.revision = packs.revision + 1;
}

#[test_only]
public fun advance_physical_pack_control_for_testing<PaymentCoin>(
    release: &mut PackReleaseV8<PaymentCoin>,
    admin: &mut PackAdminCapV8,
) {
    release.control_epoch = release.control_epoch + 1;
    admin.control_epoch = release.control_epoch;
}

#[test_only]
public fun destroy_physical_pack_fixture_for_testing<PaymentCoin>(
    release: PackReleaseV8<PaymentCoin>,
    admin: PackAdminCapV8,
    treasury: PackTreasuryV8<PaymentCoin>,
    pass: PackPassV8,
    loadout: MakerLoadoutV8,
) {
    let PackReleaseV8 {
        id: release_uid, version: _, root_id: _, root_version: _,
        root_content_commitment: _, creator: _, owner: _, control_epoch: _,
        admin_cap_id: _, treasury_id: _, semantic_pack_id: _,
        manifest_blob_id: _, manifest_sha256: _, content_commitment: _,
        lifecycle: _, access_kind: _, access_price_atomic: _, complete_mode: _,
        complete_price_atomic: _, complete_free_quota_per_wallet: _,
        complete_total_cap: _, expected_style_count: _, observed_style_count: _,
        expected_style_commitment: _, rolling_style_commitment: _,
        protected_style_count: _, pass_count: _, total_complete_count: _,
        mut styles, complete_by_wallet,
    } = release;
    let _ = styles.remove(PackStyleKeyV8 {
        part_key: b"part".to_string(),
        item_key: b"pack-item".to_string(),
        style_key: b"pack-style".to_string(),
    });
    styles.destroy_empty();
    complete_by_wallet.destroy_empty();
    release_uid.delete();
    let PackAdminCapV8 { id: admin_uid, version: _, release_id: _, owner: _,
        control_epoch: _ } = admin;
    admin_uid.delete();
    let PackTreasuryV8 { id: treasury_uid, version: _, release_id: _, revenue,
        total_collected: _, total_withdrawn: _ } = treasury;
    let _ = revenue.destroy_for_testing();
    treasury_uid.delete();
    let PackPassV8 { id: pass_uid, version: _, release_id: _, root_id: _,
        root_version: _, root_content_commitment: _, release_content_commitment: _,
        holder: _, paid_atomic: _, issued_at_ms: _, commitment: _ } = pass;
    pass_uid.delete();
    destroy_test_loadout(loadout);
}

#[test_only]
public fun destroy_physical_runtime_fixture_for_testing(
    definitions: RuntimeDefinitionRegistryV8,
    mut packs: PackRegistryV8,
    authority: PackAdmissionAuthorityV8,
    release_id: ID,
) {
    let semantic_pack_id = b"physical-pack".to_string();
    let _ = packs.releases.remove(release_id);
    let _ = packs.semantic_releases.remove(semantic_pack_id);
    let PackRegistryV8 { id: pack_uid, version: _, root_id: _, root_version: _,
        root_content_commitment: _, definition_registry_id: _,
        admission_authority_id: _, admission_policy_commitment: _, revision: _,
        release_count: _, external_admission_count: _, wardrobe_revision: _,
        base_item_count: _, releases, semantic_releases, external_admissions,
        base_item_owners } = packs;
    releases.destroy_empty();
    semantic_releases.destroy_empty();
    external_admissions.destroy_empty();
    base_item_owners.destroy_empty();
    pack_uid.delete();
    let RuntimeDefinitionRegistryV8 { id: definition_uid, version: _, root_id: _,
        root_version: _, root_content_commitment: _, base_registry_id: _,
        expected_profile_count: _, observed_profile_count: _,
        expected_profile_commitment: _, rolling_profile_commitment: _,
        admission_ceiling: _, item_assetization: _, sealed: _, profile_keys: _,
        profiles } = definitions;
    profiles.destroy_empty();
    definition_uid.delete();
    let PackAdmissionAuthorityV8 { id: authority_uid, version: _, root_id: _,
        root_version: _, root_content_commitment: _ } = authority;
    authority_uid.delete();
}

#[test_only]
fun test_hash(value: u8): vector<u8> {
    let mut bytes = vector[];
    let mut i = 0;
    while (i < HASH_LENGTH) {
        bytes.push_back(value);
        i = i + 1;
    };
    bytes
}

#[test_only]
fun test_selection(
    index: u64, style_key: String, source_class: u8, root_id: ID,
): LoadoutSelectionV8 {
    LoadoutSelectionV8 {
        selection_index: index,
        part_key: b"body".to_string(),
        item_key: b"item".to_string(),
        style_key,
        color_channel_key: option::none(),
        swatch_key: option::none(),
        layer_track_key: b"body".to_string(),
        asset_blob_id: b"blob".to_string(),
        asset_sha256: test_hash(1),
        asset_content_commitment: test_hash(2),
        source_class,
        source_definition_id: root_id,
        source_semantic_id: if (source_class == SOURCE_PACK) b"pack".to_string()
            else b"".to_string(),
        access_subject: root_id,
        source_epoch: 0,
        pricing_commitment: test_hash(3),
        protected: false,
        seal_binding_commitment: vector[],
    }
}

#[test_only]
fun test_profile(
    wardrobe_mode: u8,
    behavior: u8,
    required: bool,
): PartProfileV8 {
    PartProfileV8 {
        index: 0,
        part_key: b"body".to_string(),
        core_part_payload_commitment: test_hash(1),
        required,
        wardrobe_mode,
        behavior,
        capacity: 1,
        admission_ceiling: ADMISSION_OPEN,
        profile_commitment: test_hash(2),
    }
}

#[test_only]
fun test_loadout(ctx: &mut TxContext): MakerLoadoutV8 {
    test_loadout_with_capacity(ctx, 1)
}

#[test]
fun completed_selection_copy_preserves_sparse_slots_after_loadout_mutation() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 901, 0, 0, 0);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 500);
    let mut first = test_selection(1, b"first".to_string(), SOURCE_BASE, loadout.root_id);
    first.color_channel_key = option::some(b"tint".to_string());
    first.swatch_key = option::some(b"red".to_string());
    let mut last = test_selection(499, b"last".to_string(), SOURCE_PACK, loadout.root_id);
    last.color_channel_key = option::some(b"tint".to_string());
    last.swatch_key = option::some(b"blue".to_string());
    last.protected = true;
    last.seal_binding_commitment = test_hash(7);
    *loadout.selections.borrow_mut(1) = option::some(first);
    *loadout.selections.borrow_mut(499) = option::some(last);
    let copied = *loadout_selections_v8(&loadout);
    let before = canonical_loadout_commitment(loadout.root_id, 1, test_hash(9), &loadout.attached_pack_definitions, &loadout.definition_slots, &copied);
    *loadout.selections.borrow_mut(1) = option::none();
    loadout.selections.borrow_mut(499).borrow_mut().swatch_key = option::some(b"green".to_string());
    assert!(copied.length() == 500 && copied[0].is_none() && copied[2].is_none(), 100);
    assert!(*copied[1].borrow() == first && *copied[499].borrow() == last, 101);
    assert!(before == canonical_loadout_commitment(loadout.root_id, 1, test_hash(9), &loadout.attached_pack_definitions, &loadout.definition_slots, &copied), 102);
    assert!(before != canonical_loadout_commitment(loadout.root_id, 1, test_hash(9), &loadout.attached_pack_definitions, &loadout.definition_slots, &loadout.selections), 103);
    destroy_test_loadout(loadout);
}

#[test_only]
fun test_loadout_with_capacity(ctx: &mut TxContext, capacity: u64): MakerLoadoutV8 {
    let root_id = object::id_from_address(@0x11);
    let mut selections = vector[];
    let mut index = 0;
    while (index < capacity) {
        selections.push_back(option::none());
        index = index + 1;
    };
    let definition_slots = vector[DefinitionSlotV8 { source_definition_id: root_id,
        part_key: b"body".to_string(), profile_commitment: test_hash(2), start: 0, capacity }];
    let commitment = canonical_loadout_commitment(root_id, 1, test_hash(9), &vector[], &definition_slots, &selections);
    MakerLoadoutV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id,
        root_version: 1,
        root_content_commitment: test_hash(9),
        definition_registry_id: object::id_from_address(@0x12),
        pack_registry_id: object::id_from_address(@0x13),
        maker_access_pass_id: object::id_from_address(@0x14),
        maker_access_commitment: test_hash(14),
        holder: @0xA11,
        revision: 0,
        attached_pack_definitions: vector[],
        definition_slots,
        selections,
        selection_count: 0,
        commitment,
    }
}

#[test_only]
fun test_definitions_with_capacity(
    ctx: &mut TxContext,
    capacity: u64,
): RuntimeDefinitionRegistryV8 {
    let mut profiles = table::new(ctx);
    profiles.add(PartProfileKeyV8 { part_key: b"body".to_string() }, PartProfileV8 {
        index: 0,
        part_key: b"body".to_string(),
        core_part_payload_commitment: test_hash(1),
        required: true,
        wardrobe_mode: WARDROBE_SLOT,
        behavior: BEHAVIOR_HYBRID,
        capacity,
        admission_ceiling: ADMISSION_OPEN,
        profile_commitment: test_hash(2),
    });
    RuntimeDefinitionRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id_from_address(@0x11),
        root_version: 1,
        root_content_commitment: test_hash(9),
        base_registry_id: object::id_from_address(@0x15),
        expected_profile_count: 1,
        observed_profile_count: 1,
        expected_profile_commitment: test_hash(2),
        rolling_profile_commitment: test_hash(2),
        admission_ceiling: ADMISSION_OPEN,
        item_assetization: false,
        sealed: true,
        profile_keys: vector[b"body".to_string()],
        profiles,
    }
}

#[test_only]
fun test_owned_base_fixture(
    ctx: &mut TxContext,
): (RuntimeDefinitionRegistryV8, PackRegistryV8, OwnedBaseItemV8) {
    let mut definitions = test_definitions_with_capacity(ctx, 1);
    definitions.item_assetization = true;
    let pack_uid = object::new(ctx);
    let pack_id = pack_uid.to_inner();
    let item_uid = object::new(ctx);
    let item_id = item_uid.to_inner();
    let part_key = b"body".to_string();
    let item_key = b"item".to_string();
    let mut owners = table::new(ctx);
    owners.add(BaseItemHolderKeyV8 {
        part_key,
        item_key,
        holder: @0xA11,
    }, BaseItemOwnershipRecordV8 {
        item_id,
        ownership_epoch: 0,
    });
    let packs = PackRegistryV8 {
        id: pack_uid,
        version: VERSION,
        root_id: definitions.root_id,
        root_version: definitions.root_version,
        root_content_commitment: definitions.root_content_commitment,
        definition_registry_id: object::id(&definitions),
        admission_authority_id: object::id_from_address(@0x16),
        admission_policy_commitment: test_hash(16),
        revision: 0,
        release_count: 0,
        external_admission_count: 0,
        wardrobe_revision: 0,
        base_item_count: 1,
        releases: table::new(ctx),
        semantic_releases: table::new(ctx),
        external_admissions: table::new(ctx),
        base_item_owners: owners,
    };
    let item = OwnedBaseItemV8 {
        id: item_uid,
        version: VERSION,
        root_id: definitions.root_id,
        root_version: definitions.root_version,
        root_content_commitment: definitions.root_content_commitment,
        definition_registry_id: object::id(&definitions),
        pack_registry_id: pack_id,
        base_registry_id: definitions.base_registry_id,
        part_key,
        item_key,
        item_payload_commitment: test_hash(17),
        holder: @0xA11,
        ownership_epoch: 0,
        transferable: true,
        equip_lock: option::none(),
    };
    (definitions, packs, item)
}

#[test_only]
fun destroy_test_owned_base_fixture(
    definitions: RuntimeDefinitionRegistryV8,
    mut packs: PackRegistryV8,
    item: OwnedBaseItemV8,
) {
    let _record = packs.base_item_owners.remove(BaseItemHolderKeyV8 {
        part_key: item.part_key,
        item_key: item.item_key,
        holder: item.holder,
    });
    let PackRegistryV8 {
        id: pack_id, version: _, root_id: _, root_version: _,
        root_content_commitment: _, definition_registry_id: _,
        admission_authority_id: _, admission_policy_commitment: _, revision: _,
        release_count: _, external_admission_count: _, wardrobe_revision: _,
        base_item_count: _, releases, semantic_releases, external_admissions,
        base_item_owners,
    } = packs;
    releases.destroy_empty();
    semantic_releases.destroy_empty();
    external_admissions.destroy_empty();
    base_item_owners.destroy_empty();
    pack_id.delete();
    let OwnedBaseItemV8 {
        id: item_id, version: _, root_id: _, root_version: _,
        root_content_commitment: _, definition_registry_id: _, pack_registry_id: _,
        base_registry_id: _, part_key: _, item_key: _, item_payload_commitment: _,
        holder: _, ownership_epoch: _, transferable: _, equip_lock: _,
    } = item;
    item_id.delete();
    destroy_test_definitions(definitions);
}

#[test_only]
fun destroy_test_definitions(mut definitions: RuntimeDefinitionRegistryV8) {
    definitions.profile_keys.do_ref!(|key| {
        if (definitions.profiles.contains(PartProfileKeyV8 { part_key: *key })) {
            let _ = definitions.profiles.remove(PartProfileKeyV8 { part_key: *key });
        };
    });
    // Some older Player fixtures deliberately rename the profile-key vector
    // while retaining the original row to exercise invalid-identity handling.
    vector[b"body".to_string(), b"part".to_string()].do!(|key| {
        if (definitions.profiles.contains(PartProfileKeyV8 { part_key: key })) {
            let _ = definitions.profiles.remove(PartProfileKeyV8 { part_key: key });
        };
    });
    let RuntimeDefinitionRegistryV8 {
        id, version: _, root_id: _, root_version: _, root_content_commitment: _,
        base_registry_id: _, expected_profile_count: _, observed_profile_count: _,
        expected_profile_commitment: _, rolling_profile_commitment: _,
        admission_ceiling: _, item_assetization: _, sealed: _, profile_keys: _, profiles,
    } = definitions;
    profiles.destroy_empty();
    id.delete();
}

#[test_only]
fun test_pack_release(
    ctx: &mut TxContext,
): PackReleaseV8<sui::sui::SUI> {
    PackReleaseV8<sui::sui::SUI> {
        id: object::new(ctx),
        version: VERSION,
        root_id: object::id_from_address(@0x11),
        root_version: 1,
        root_content_commitment: test_hash(1),
        creator: @0xA11,
        owner: @0xA11,
        control_epoch: 0,
        admin_cap_id: object::id_from_address(@0x12),
        treasury_id: object::id_from_address(@0x13),
        semantic_pack_id: b"pack".to_string(),
        manifest_blob_id: b"manifest".to_string(),
        manifest_sha256: test_hash(2),
        content_commitment: test_hash(3),
        lifecycle: PACK_ACTIVE,
        access_kind: ACCESS_PAID,
        access_price_atomic: 100,
        complete_mode: COMPLETE_FREE_QUOTA_THEN_PAID,
        complete_price_atomic: 10,
        complete_free_quota_per_wallet: 2,
        complete_total_cap: 8,
        expected_style_count: 1,
        observed_style_count: 0,
        expected_style_commitment: test_hash(4),
        rolling_style_commitment: test_hash(5),
        protected_style_count: 0,
        pass_count: 0,
        total_complete_count: 0,
        styles: table::new(ctx),
        complete_by_wallet: table::new(ctx),
    }
}

#[test_only]
fun test_pack_visibility_row(
    semantic: String, subject: u8, source: u8, part: String, item: String,
    style: Option<String>, tokens: vector<base::VisibilityTokenV1>,
): base::PackVisibilityRowV2 {
    base::new_pack_visibility_row_v2(subject, source, part, item, style, tokens,
        base::visibility_program_commitment_v1(source,
            if (source == 1) option::none() else option::some(semantic),
            subject, part, option::some(item), style, &tokens))
}

#[test_only]
fun pack_rule_context_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 904, 0, 0, 0);
    let registry = base::new_visibility_registry_for_testing(vector[], 0, &mut ctx);
    let mut definitions = test_definitions_with_capacity(&mut ctx, 2);
    definitions.root_id = base::registry_root_id_v2(&registry);
    definitions.root_version = base::registry_maker_version_v2(&registry);
    definitions.root_content_commitment = *base::registry_root_content_commitment_v2(&registry);
    definitions.base_registry_id = object::id(&registry);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 2);
    loadout.definition_registry_id = object::id(&definitions);
    loadout.root_id = definitions.root_id; loadout.root_version = definitions.root_version;
    loadout.root_content_commitment = definitions.root_content_commitment;
    loadout.definition_slots[0].source_definition_id = definitions.root_id;
    let mut release = test_pack_release(&mut ctx);
    release.root_id = definitions.root_id; release.root_version = definitions.root_version;
    release.root_content_commitment = definitions.root_content_commitment;
    release.lifecycle = PACK_DRAFT;
    let cap_uid = object::new(&mut ctx);
    release.admin_cap_id = cap_uid.to_inner();
    let cap = PackAdminCapV8 { id: cap_uid, version: VERSION, release_id: object::id(&release), owner: @0xA11, control_epoch: 0 };
    let body = base::new_semantic_selector_v2(if (case == 10) 2 else if (case == 12) 0 else 1,
        if (case == 10) option::some(b"other".to_string()) else option::none(),
        b"body".to_string(), option::none(), option::none());
    let tokens = if (case == 8) vector[base::new_visibility_token_v1(0, option::some(body), 0)] else vector[];
    let part = base::new_part_row_v2(0, b"addon".to_string(), b"Addon".to_string(), 0, 0, 0, true, false, 1, 2,
        vector[], tokens, base::visibility_program_commitment_v1(2, option::some(release.semantic_pack_id),
            0, b"addon".to_string(), option::none(), option::none(), &tokens), test_hash(2));
    let mut targets = vector[body];
    if (case == 3) targets.push_back(base::new_semantic_selector_v2(1, option::none(), b"addon".to_string(),
        option::some(b"not-selected".to_string()), option::none()));
    let rule = base::new_rule_row_v2(0, b"context-rule".to_string(), if (case == 2) 1 else 0,
        base::new_semantic_selector_v2(if (case == 5 || case == 7) 0 else 1, option::none(),
            b"addon".to_string(), option::none(), option::none()),
        if (case == 2 || case == 3) 1 else 0, targets, test_hash(3));
    let style_tokens = if (case == 13 || case == 14) vector[base::new_visibility_token_v1(0, option::some(body), 0)] else vector[];
    let mut visibility = vector[test_pack_visibility_row(release.semantic_pack_id, 1, 2,
        b"addon".to_string(), b"item".to_string(), option::none(), vector[])];
    if (case != 15) visibility.push_back(test_pack_visibility_row(release.semantic_pack_id, 2, 2,
        b"addon".to_string(), b"item".to_string(), option::some(b"own-item".to_string()), style_tokens));
    let rows = base::new_pack_definition_rows_v2(release.semantic_pack_id, vector[], vector[], vector[part],
        if (case == 8 || case >= 13) vector[] else vector[rule], visibility);
    let commitment = pack_definitions_commitment_v8(object::id(&release), release.content_commitment, &rows);
    register_pack_definitions_v8(&mut release, &cap, &registry, rows, commitment, &ctx);
    let profiles = pack_part_profiles_v8(&definitions, &release);
    append_pack_definition_slots(&mut loadout, object::id(&release), commitment, &profiles);
    if (case == 9) loadout.attached_pack_definitions[0].definition_commitment = test_hash(99);
    let mut own = test_selection(2, b"own-item".to_string(), SOURCE_PACK, object::id(&release));
    own.part_key = b"addon".to_string();
    own.source_semantic_id = release.semantic_pack_id;
    let style_key = PackStyleKeyV8 { part_key: own.part_key, item_key: own.item_key, style_key: own.style_key };
    release.styles.add(style_key, PackStyleV8 { index: 0,
        definition_sources: new_pack_style_definition_sources_v8(2, 1, option::none()),
        part_key: own.part_key, item_key: own.item_key, style_key: own.style_key,
        layer_track_key: own.layer_track_key, color_channel_key: option::none(), default_swatch_key: option::none(),
        asset_blob_id: own.asset_blob_id, asset_sha256: own.asset_sha256, asset_content_commitment: own.asset_content_commitment,
        protected: false, seal_binding_commitment: vector[], style_commitment: test_hash(11) });
    if (case == 4 || case == 5 || case == 7) {
        own.source_class = SOURCE_EXTERNAL; own.source_definition_id = object::id_from_address(@0xBAD);
    };
    if (case == 6) {
        let other = object::id_from_address(@0xBAD);
        append_pack_definition_slots(&mut loadout, other, test_hash(44), &profiles);
        own.selection_index = 4; own.source_definition_id = other;
        install_selection(&mut loadout, 4, own);
    } else install_selection(&mut loadout, 2, own);
    if (case != 1 && case != 7 && case != 8 && case != 14) {
        let mut inherited = test_selection(0, b"body-item".to_string(), SOURCE_BASE, loadout.root_id);
        if (case >= 10 && case <= 12) {
            inherited.source_class = SOURCE_PACK;
            inherited.source_definition_id = object::id_from_address(@0xBAD);
            inherited.source_semantic_id = b"other".to_string();
        };
        install_selection(&mut loadout, 0, inherited);
    };
    validate_attached_pack_definitions_v8(&loadout, &definitions, &registry, &release, 0, &ctx);
    let _ = release.styles.remove(style_key);
    let _: PackDefinitionsV8 = df::remove(&mut release.id, PackDefinitionsKeyV8 {});
    let PackAdminCapV8 { id, version: _, release_id: _, owner: _, control_epoch: _ } = cap; id.delete();
    destroy_test_pack_release(release);
    destroy_test_loadout(loadout);
    destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
}

#[test]
fun pack_rule_context_local_base_matches_owned_addition() { pack_rule_context_case(0) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_rule_context_require_missing_target_rejects() { pack_rule_context_case(1) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_rule_context_exclude_reuses_core_semantics() { pack_rule_context_case(2) }
#[test]
fun pack_rule_context_require_any_retains_alternatives() { pack_rule_context_case(3) }
#[test]
fun pack_rule_context_external_is_not_local_base() { pack_rule_context_case(4) }
#[test]
fun pack_rule_context_any_retains_external_in_exact_part() { pack_rule_context_case(5) }
#[test]
fun pack_rule_context_same_named_foreign_part_cannot_trigger() { pack_rule_context_case(6) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_rule_context_checks_without_pack_sourced_selection() { pack_rule_context_case(7) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_rule_context_part_visibility_rejects_missing_dependency() { pack_rule_context_case(8) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_rule_context_rejects_different_attachment_commitment() { pack_rule_context_case(9) }
#[test]
fun pack_rule_context_explicit_pack_target_keeps_semantic_identity() { pack_rule_context_case(10) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_rule_context_foreign_pack_cannot_satisfy_local_base() { pack_rule_context_case(11) }
#[test]
fun pack_rule_context_any_target_keeps_foreign_pack() { pack_rule_context_case(12) }
#[test]
fun pack_rule_context_style_visibility_accepts_dependency() { pack_rule_context_case(13) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_rule_context_style_visibility_rejects_missing_dependency() { pack_rule_context_case(14) }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_core::base_registry_v8)]
fun pack_rule_context_style_visibility_metadata_is_required() { pack_rule_context_case(15) }

#[test_only]
fun pack_inherited_visibility_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 906, 0, 0, 0);
    let tokens = vector[base::new_visibility_token_v1(0, option::some(base::new_semantic_selector_v2(
        0, option::none(), b"part".to_string(), option::some(b"item".to_string()), option::some(b"style".to_string()))), 0)];
    let registry = base::new_visibility_registry_for_testing(tokens, 1, &mut ctx);
    let mut definitions = test_definitions_with_capacity(&mut ctx, 2);
    let mut profile = definitions.profiles.remove(PartProfileKeyV8 { part_key: b"body".to_string() });
    profile.part_key = b"part".to_string(); definitions.profile_keys = vector[profile.part_key];
    definitions.profiles.add(PartProfileKeyV8 { part_key: profile.part_key }, profile);
    definitions.root_id = base::registry_root_id_v2(&registry);
    definitions.root_version = base::registry_maker_version_v2(&registry);
    definitions.root_content_commitment = *base::registry_root_content_commitment_v2(&registry);
    definitions.base_registry_id = object::id(&registry);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 2);
    loadout.definition_registry_id = object::id(&definitions);
    loadout.root_id = definitions.root_id; loadout.root_version = definitions.root_version;
    loadout.root_content_commitment = definitions.root_content_commitment;
    loadout.definition_slots[0].source_definition_id = definitions.root_id;
    loadout.definition_slots[0].part_key = b"part".to_string();
    let mut release = test_pack_release(&mut ctx);
    release.root_id = definitions.root_id; release.root_version = definitions.root_version;
    release.root_content_commitment = definitions.root_content_commitment;
    release.lifecycle = PACK_DRAFT;
    let cap_uid = object::new(&mut ctx); release.admin_cap_id = cap_uid.to_inner();
    let cap = PackAdminCapV8 { id: cap_uid, version: VERSION, release_id: object::id(&release), owner: @0xA11, control_epoch: 0 };
    let style_key = if (case == 3) b"style".to_string() else b"added".to_string();
    let rows = base::new_pack_definition_rows_v2(release.semantic_pack_id, vector[], vector[], vector[], vector[], vector[
        test_pack_visibility_row(release.semantic_pack_id, 1, 1, b"part".to_string(), b"item".to_string(),
            option::none(), if (case == 2) vector[] else tokens),
        test_pack_visibility_row(release.semantic_pack_id, 2, 2, b"part".to_string(), b"item".to_string(),
            option::some(style_key), vector[]),
    ]);
    let commitment = pack_definitions_commitment_v8(object::id(&release), release.content_commitment, &rows);
    register_pack_definitions_v8(&mut release, &cap, &registry, rows, commitment, &ctx);
    append_pack_definition_slots(&mut loadout, object::id(&release), commitment, &vector[]);
    let mut own = test_selection(0, style_key, SOURCE_PACK, object::id(&release));
    own.part_key = b"part".to_string(); own.source_semantic_id = release.semantic_pack_id;
    let key = PackStyleKeyV8 { part_key: own.part_key, item_key: own.item_key, style_key: own.style_key };
    release.styles.add(key, PackStyleV8 { index: 0,
        definition_sources: new_pack_style_definition_sources_v8(1, 1, option::none()),
        part_key: own.part_key, item_key: own.item_key, style_key: own.style_key, layer_track_key: own.layer_track_key,
        color_channel_key: option::none(), default_swatch_key: option::none(), asset_blob_id: own.asset_blob_id,
        asset_sha256: own.asset_sha256, asset_content_commitment: own.asset_content_commitment,
        protected: false, seal_binding_commitment: vector[], style_commitment: test_hash(11) });
    install_selection(&mut loadout, 0, own);
    let mut dependency = test_selection(if (case == 1) 2 else 1, b"style".to_string(), SOURCE_BASE, loadout.root_id);
    dependency.part_key = b"part".to_string();
    if (case == 1) {
        let mut profile = test_profile(WARDROBE_SLOT, BEHAVIOR_HYBRID, false);
        profile.part_key = b"part".to_string();
        append_pack_definition_slots(&mut loadout, object::id_from_address(@0xBAD), test_hash(44), &vector[profile]);
        dependency.source_class = SOURCE_EXTERNAL; dependency.source_definition_id = object::id_from_address(@0xBAD);
    };
    install_selection(&mut loadout, dependency.selection_index, dependency);
    validate_attached_pack_definitions_v8(&loadout, &definitions, &registry, &release, 0, &ctx);
    let _ = release.styles.remove(key);
    let _: PackDefinitionsV8 = df::remove(&mut release.id, PackDefinitionsKeyV8 {});
    let PackAdminCapV8 { id, version: _, release_id: _, owner: _, control_epoch: _ } = cap; id.delete();
    destroy_test_pack_release(release); destroy_test_loadout(loadout); destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
}

#[test]
fun pack_inherited_visibility_any_matches_base_scope() { pack_inherited_visibility_case(0) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_inherited_visibility_any_rejects_foreign_same_named_scope() { pack_inherited_visibility_case(1) }
#[test, expected_failure(abort_code = 11, location = animacraft_v8_core::base_registry_v8)]
fun pack_inherited_visibility_cannot_replace_base_item_program() { pack_inherited_visibility_case(2) }
#[test, expected_failure(abort_code = 5, location = animacraft_v8_core::base_registry_v8)]
fun pack_inherited_visibility_cannot_shadow_base_style() { pack_inherited_visibility_case(3) }

#[test_only]
fun pack_definition_proof_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 910, 0, 0, 0);
    let mut loadout = test_loadout(&mut ctx);
    if (case != 1 && case != 3 && case != 10) df::add(&mut loadout.id, SoulEquipmentLayoutKeyV8 {}, true);
    let (mut definitions, registry) = equipment_visibility_definitions_for_testing(&mut loadout, vector[], 0, &mut ctx);
    // Optional Base profile isolates zero-selection final-consumer behavior.
    definitions.profile_keys.do_ref!(|key| {
        definitions.profiles.borrow_mut(PartProfileKeyV8 { part_key: *key }).required = false;
    });
    let mut release = test_pack_release(&mut ctx);
    release.root_id = loadout.root_id; release.root_version = loadout.root_version;
    release.root_content_commitment = loadout.root_content_commitment; release.lifecycle = PACK_DRAFT;
    let cap_uid = object::new(&mut ctx); release.admin_cap_id = cap_uid.to_inner();
    let cap = PackAdminCapV8 { id: cap_uid, version: VERSION, release_id: object::id(&release), owner: ctx.sender(), control_epoch: 0 };
    let own_part = case == 2 || case == 3 || case == 14 || case == 15;
    let part = base::new_part_row_v2(0, b"addon".to_string(), b"Addon".to_string(), 0, 0, 0, true, false, 1, 2,
        vector[], vector[], base::visibility_program_commitment_v1(2, option::some(release.semantic_pack_id),
            0, b"addon".to_string(), option::none(), option::none(), &vector[]), test_hash(3));
    let rule = base::new_rule_row_v2(0, b"pending-complete".to_string(), 0,
        base::new_semantic_selector_v2(1, option::none(), b"addon".to_string(), option::none(), option::none()), 0,
        vector[base::new_semantic_selector_v2(2, option::some(b"absent".to_string()), b"part".to_string(), option::none(), option::none())], test_hash(4));
    let rows = base::new_pack_definition_rows_v2(release.semantic_pack_id, vector[], vector[],
        if (own_part) vector[part] else vector[], if (case == 14 || case == 15) vector[rule] else vector[],
        if (own_part) vector[
            test_pack_visibility_row(release.semantic_pack_id, 1, 2, b"addon".to_string(), b"item".to_string(), option::none(), vector[]),
            test_pack_visibility_row(release.semantic_pack_id, 2, 2, b"addon".to_string(), b"item".to_string(), option::some(b"style".to_string()), vector[]),
        ] else vector[]);
    let commitment = pack_definitions_commitment_v8(object::id(&release), release.content_commitment, &rows);
    register_pack_definitions_v8(&mut release, &cap, &registry, rows, commitment, &ctx);
    append_pack_definition_slots(&mut loadout, object::id(&release), commitment, &pack_part_profiles_v8(&definitions, &release));
    if (own_part) {
        let mut selection = test_selection(3, b"style".to_string(), SOURCE_PACK, object::id(&release));
        selection.part_key = b"addon".to_string(); selection.source_semantic_id = release.semantic_pack_id;
        release.styles.add(PackStyleKeyV8 { part_key: selection.part_key, item_key: selection.item_key, style_key: selection.style_key },
            PackStyleV8 { index: 0, definition_sources: new_pack_style_definition_sources_v8(2, 1, option::none()),
                part_key: selection.part_key, item_key: selection.item_key, style_key: selection.style_key,
                layer_track_key: selection.layer_track_key, color_channel_key: option::none(), default_swatch_key: option::none(),
                asset_blob_id: selection.asset_blob_id, asset_sha256: selection.asset_sha256, asset_content_commitment: selection.asset_content_commitment,
                protected: false, seal_binding_commitment: vector[], style_commitment: test_hash(8) });
        install_selection(&mut loadout, 3, selection);
    };
    if (case == 13) append_pack_definition_slots(&mut loadout, object::id_from_address(@0xBAD), test_hash(9), &vector[]);
    if (case == 15) validate_attached_pack_definitions_v8(&loadout, &definitions, &registry, &release, 0, &ctx);
    // Equipment producer is public. Completion mode below isolates the final
    // consumer only; the public entitlement producer has its own full fixture.
    let mut proof = prove_equipment_pack_definitions_v8(&loadout, &definitions, &registry, &release, 0, &ctx);
    if (case == 1 || case == 3) proof.completion_checked = true;
    if (case == 4) proof.loadout_revision = proof.loadout_revision + 1;
    if (case == 5) proof.loadout_commitment = test_hash(99);
    if (case == 6 || case == 13) proof.binding_index = 1;
    if (case == 7) proof.release_id = object::id_from_address(@0xBAD);
    if (case == 11) loadout.definition_slots[0].capacity = 2;
    if (case == 12) proof.loadout_id = object::id_from_address(@0xBAD);
    let mut proofs = vector[proof];
    if (case == 8) {
        let PackDefinitionProofV8 { loadout_id: _, loadout_revision: _, loadout_commitment: _, binding_index: _,
            release_id: _, definition_commitment: _, profiles: _, completion_checked: _ } = proofs.pop_back();
    };
    if (case == 9 || case == 13) proofs.push_back(prove_equipment_pack_definitions_v8(
        &loadout, &definitions, &registry, &release, 0, &ctx));
    if (case == 1 || case == 3 || case == 10) {
        let selections = if (own_part) vector[new_selection_proof(&loadout, loadout.selections[3].borrow(), release.content_commitment)] else vector[];
        let authorization = seal_ordered_selection_proofs_v8(&loadout, &definitions, &registry, proofs, selections, &ctx);
        assert!(authorization.used_packs.length() == if (own_part) 1 else 0, EInvalidProof);
        let (_, _, _, _, _, _, _, _, _, _) = consume_loadout_authorization_v8(authorization, &loadout);
    } else {
        let guard = SoulEquipmentUpdateV8 { loadout_id: object::id(&loadout), binding: SoulEquipmentBindingV8 {
            soul_id: object::id_from_address(@0x42), soul_state_id: object::id_from_address(@0x43),
            holder: ctx.sender(), ownership_epoch: 0, protocol_config_id: object::id_from_address(@0x44) } };
        finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, proofs, guard);
        assert!(is_soul_equipment_v8(&loadout), EInvalidProof);
    };
    if (own_part) { let _ = release.styles.remove(PackStyleKeyV8 { part_key: b"addon".to_string(), item_key: b"item".to_string(), style_key: b"style".to_string() }); };
    let _: PackDefinitionsV8 = df::remove(&mut release.id, PackDefinitionsKeyV8 {});
    let PackAdminCapV8 { id, version: _, release_id: _, owner: _, control_epoch: _ } = cap; id.delete();
    destroy_test_pack_release(release); destroy_test_loadout(loadout); destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
}

#[test]
fun pack_definition_proof_equipment_empty_attachment_finishes() { pack_definition_proof_case(0) }
#[test]
fun pack_definition_proof_completion_empty_attachment_not_charged() { pack_definition_proof_case(1) }
#[test]
fun pack_definition_proof_equipment_owned_part_finishes() { pack_definition_proof_case(2) }
#[test]
fun pack_definition_proof_completion_owned_part_traverses_selection() { pack_definition_proof_case(3) }
#[test, expected_failure(abort_code = EInvalidProof)]
fun pack_definition_proof_rejects_stale_revision() { pack_definition_proof_case(4) }
#[test, expected_failure(abort_code = EInvalidProof)]
fun pack_definition_proof_rejects_stale_commitment() { pack_definition_proof_case(5) }
#[test, expected_failure(abort_code = EProofOrder)]
fun pack_definition_proof_rejects_wrong_index() { pack_definition_proof_case(6) }
#[test, expected_failure(abort_code = EInvalidProof)]
fun pack_definition_proof_rejects_wrong_release() { pack_definition_proof_case(7) }
#[test, expected_failure(abort_code = EProofOrder)]
fun pack_definition_proof_requires_zero_part_attachment() { pack_definition_proof_case(8) }
#[test, expected_failure(abort_code = EProofOrder)]
fun pack_definition_proof_rejects_duplicate_proof() { pack_definition_proof_case(9) }
#[test, expected_failure(abort_code = EInvalidProof)]
fun pack_definition_proof_equipment_cannot_authorize_completion() { pack_definition_proof_case(10) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_definition_proof_rejects_different_layout() { pack_definition_proof_case(11) }
#[test, expected_failure(abort_code = EInvalidProof)]
fun pack_definition_proof_rejects_other_loadout() { pack_definition_proof_case(12) }
#[test, expected_failure(abort_code = EProofOrder)]
fun pack_definition_proof_rejects_wrong_order_for_two_bindings() { pack_definition_proof_case(13) }
#[test]
fun pack_definition_proof_equipment_keeps_pending_complete_rule() { pack_definition_proof_case(14) }
#[test, expected_failure(abort_code = ERuleViolation)]
fun pack_definition_proof_completion_requires_pack_rule() { pack_definition_proof_case(15) }

#[test_only]
fun pack_definition_public_producer_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 911, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (config, protocol_admin) = protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(&config, 0, 0, 0, 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(&ctx, 250, 250, 500);
    let (mut root, mut registry, treasury, maker_admin) = animacraft_v8_core::core_v8::new_initial_maker_draft_v8<sui::sui::SUI>(
        &config, b"proof-test".to_string(), test_hash(1), test_hash(2), test_hash(3), test_hash(4),
        b"manifest".to_string(), test_hash(5), test_hash(6), base::new_base_definition_counts_v8(1, 0, 1, 1, 1, 0, 1),
        base::minimal_author_rows_commitment_for_testing(), test_hash(7), economics, rights, &clock, &mut ctx);
    base::populate_and_seal_minimal_for_testing(&mut registry, &mut root, &maker_admin);
    maker::set_lifecycle_for_testing(&mut root, 1);
    let access = core_treasury::new_maker_access_for_testing(&root, ctx.sender(), &mut ctx);
    let (mut definitions, mut packs, authority) = new_physical_runtime_fixture_for_testing(&root, &mut ctx);
    let mut profile = test_profile(WARDROBE_FIXED, BEHAVIOR_FIXED, true); profile.part_key = b"part".to_string();
    definitions.profile_keys = vector[profile.part_key];
    definitions.profiles.add(PartProfileKeyV8 { part_key: profile.part_key }, profile);
    let mut loadout = test_loadout(&mut ctx);
    loadout.root_id = object::id(&root); loadout.root_version = maker::root_maker_version_v8(&root);
    loadout.root_content_commitment = *maker::root_content_commitment_v8(&root);
    loadout.definition_registry_id = object::id(&definitions); loadout.pack_registry_id = object::id(&packs);
    loadout.maker_access_pass_id = object::id(&access); loadout.maker_access_commitment = maker_access_entitlement_commitment_v8(&access);
    loadout.definition_slots = base_definition_slots(&definitions); recompute_loadout(&mut loadout);
    select_base_style_v8(&mut loadout, &root, &definitions, &packs, &registry, &access, 0, option::some(0),
        b"part".to_string(), b"item".to_string(), b"style".to_string(), option::none(), &ctx);
    let mut release = test_pack_release(&mut ctx);
    release.root_id = loadout.root_id; release.root_version = loadout.root_version;
    release.root_content_commitment = loadout.root_content_commitment; release.lifecycle = PACK_DRAFT;
    let cap_uid = object::new(&mut ctx); release.admin_cap_id = cap_uid.to_inner();
    let cap = PackAdminCapV8 { id: cap_uid, version: VERSION, release_id: object::id(&release), owner: ctx.sender(), control_epoch: 0 };
    let rows = base::new_pack_definition_rows_v2(release.semantic_pack_id, vector[], vector[], vector[], vector[], vector[]);
    let commitment = pack_definitions_commitment_v8(object::id(&release), release.content_commitment, &rows);
    register_pack_definitions_v8(&mut release, &cap, &registry, rows, commitment, &ctx);
    // Sealed lifecycle and issued pass are controlled prerequisites: publication
    // remains guarded. Admission, public proof production, and consumption run.
    release.lifecycle = PACK_SEALED;
    admit_pack_release_v8(&mut packs, &authority, &definitions, &root, &maker_admin, &mut release, 0, &ctx);
    let pass = new_pack_pass(&mut release, 0, 0, &mut ctx);
    append_pack_definition_slots(&mut loadout, object::id(&release), commitment, &vector[]);
    if (case == 1) packs.releases.borrow_mut(object::id(&release)).admission_state = ADMISSION_REVOKED;
    if (case == 2) release.lifecycle = PACK_PAUSED;
    let proof = prove_attached_pack_definitions_v8(&loadout, &definitions, &registry, &root, &packs, &release, &pass, &access, 0, &ctx);
    let selection = prove_base_selection_v8(&loadout, &definitions, &registry, &root, &access, 0, &ctx);
    let authorization = seal_ordered_selection_proofs_v8(&loadout, &definitions, &registry, vector[proof], vector[selection], &ctx);
    assert!(authorization.used_packs.is_empty(), EInvalidProof);
    let (_, _, _, _, _, _, _, _, _, _) = consume_loadout_authorization_v8(authorization, &loadout);
    std::unit_test::destroy(release); std::unit_test::destroy(pass); std::unit_test::destroy(cap);
    std::unit_test::destroy(packs); std::unit_test::destroy(authority); std::unit_test::destroy(access);
    destroy_test_loadout(loadout); destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry); core_treasury::destroy_maker_treasury_for_testing(treasury);
    maker::destroy_maker_for_testing(root, maker_admin); clock.destroy_for_testing();
    protocol::destroy_protocol_for_testing(config, protocol_admin);
}

#[test]
fun pack_definition_public_producer_authorizes_real_entitlements() { pack_definition_public_producer_case(0) }
#[test, expected_failure(abort_code = EAdmissionDenied)]
fun pack_definition_public_producer_rejects_revoked_admission() { pack_definition_public_producer_case(1) }
#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun pack_definition_public_producer_rejects_paused_release() { pack_definition_public_producer_case(2) }

#[test_only]
fun pack_attachment_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 903, 0, 0, 0);
    let mut loadout = test_loadout_with_capacity(&mut ctx, 2);
    let slots = loadout.definition_slots;
    let selections = loadout.selections;
    let before = loadout.commitment;
    let release_id = object::id_from_address(@0x22);
    append_pack_definition_slots(&mut loadout, release_id, test_hash(1), &vector[]);
    assert!(loadout.definition_slots == slots && loadout.selections == selections
        && loadout.selection_count == 0 && loadout.revision == 1
        && loadout.commitment != before, EInvalidProof);
    assert!(loadout.attached_pack_definitions == vector[AttachedPackDefinitionV8 {
        release_id, definition_commitment: test_hash(1) }], EInvalidProof);
    if (case == 1) append_pack_definition_slots(&mut loadout, release_id, test_hash(1), &vector[]);
    if (case == 2) {
        let definitions = test_definitions_with_capacity(&mut ctx, 2);
        loadout.definition_registry_id = object::id(&definitions);
        let _ = consume_pack_definition_proofs(&loadout, &definitions, vector[], true);
        destroy_test_definitions(definitions);
    };
    let pinned = loadout.commitment;
    loadout.attached_pack_definitions[0].definition_commitment = test_hash(2);
    recompute_loadout(&mut loadout);
    assert!(loadout.commitment != pinned, EInvalidProof);
    loadout.attached_pack_definitions[0].definition_commitment = test_hash(1);
    append_pack_definition_slots(&mut loadout, object::id_from_address(@0x23), test_hash(3), &vector[]);
    let ordered = loadout.commitment;
    loadout.attached_pack_definitions.reverse();
    recompute_loadout(&mut loadout);
    assert!(ordered != loadout.commitment && loadout.definition_slots == slots, EInvalidProof);
    destroy_test_loadout(loadout);
}

#[test_only]
fun pack_selection_attachment_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 912, 0, 0, 0);
    let mut release = test_pack_release(&mut ctx);
    let mut loadout = test_loadout(&mut ctx);
    let rows = base::new_pack_definition_rows_v2(release.semantic_pack_id,
        vector[], vector[], vector[], vector[], vector[]);
    let commitment = pack_definitions_commitment_v8(object::id(&release), release.content_commitment, &rows);
    if (case != 0) {
        let value = PackDefinitionsV8 { version: VERSION, release_id: object::id(&release),
            release_content_commitment: release.content_commitment, rows, commitment };
        df::add(&mut release.id, PackDefinitionsKeyV8 {}, value);
        if (case != 1) loadout.attached_pack_definitions.push_back(AttachedPackDefinitionV8 {
            release_id: if (case == 4) object::id_from_address(@0xBAD) else object::id(&release),
            definition_commitment: if (case == 3) test_hash(99) else commitment,
        });
        if (case == 5) {
            let duplicate = loadout.attached_pack_definitions[0];
            loadout.attached_pack_definitions.push_back(duplicate);
        };
    };
    // Zero owned Parts is intentional: Base-scoped Styles need this binding too.
    assert_pack_definition_attachment(&loadout, &release);
    if (case != 0) { let _: PackDefinitionsV8 = df::remove(&mut release.id, PackDefinitionsKeyV8 {}); };
    destroy_test_loadout(loadout);
    destroy_test_pack_release(release);
}

#[test]
fun pack_selection_attachment_preserves_simple_release() { pack_selection_attachment_case(0) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_selection_attachment_requires_zero_part_definitions() { pack_selection_attachment_case(1) }
#[test]
fun pack_selection_attachment_accepts_exact_binding() { pack_selection_attachment_case(2) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_selection_attachment_rejects_changed_commitment() { pack_selection_attachment_case(3) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_selection_attachment_rejects_other_release() { pack_selection_attachment_case(4) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_selection_attachment_rejects_duplicate() { pack_selection_attachment_case(5) }

#[test]
fun pack_attachment_without_parts_or_selections_changes_commitment() { pack_attachment_case(0) }
#[test, expected_failure(abort_code = EDuplicate)]
fun pack_attachment_without_parts_cannot_duplicate() { pack_attachment_case(1) }
#[test, expected_failure(abort_code = EProofOrder)]
fun pack_attachment_without_selected_styles_still_requires_proof() { pack_attachment_case(2) }
#[test]
fun pack_attachment_bcs_matches_clients() {
    let binding = AttachedPackDefinitionV8 { release_id: object::id_from_address(@0x22), definition_commitment: test_hash(1) };
    assert!(bcs::to_bytes(&binding) == x"0000000000000000000000000000000000000000000000000000000000000022200101010101010101010101010101010101010101010101010101010101010101", EInvalidProof);
}

#[test_only]
fun pack_reference_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 902, 0, 0, 0);
    let registry = base::new_visibility_registry_for_testing(vector[], 0, &mut ctx);
    let mut release = test_pack_release(&mut ctx);
    release.root_id = base::registry_root_id_v2(&registry);
    release.root_version = base::registry_maker_version_v2(&registry);
    release.root_content_commitment = *base::registry_root_content_commitment_v2(&registry);
    release.lifecycle = PACK_DRAFT;
    let cap_uid = object::new(&mut ctx);
    release.admin_cap_id = cap_uid.to_inner();
    let cap = PackAdminCapV8 { id: cap_uid, version: VERSION, release_id: object::id(&release),
        owner: @0xA11, control_epoch: 0 };
    let track = base::new_track_row_v2(0, b"overlay".to_string(), b"Pack Track".to_string(), 99, false);
    let swatch = base::new_color_swatch_v2(b"red".to_string(), b"Red".to_string(), 0xff0000ff, vector[]);
    let color = base::new_color_channel_row_v2(0, b"pack-tint".to_string(), b"Tint".to_string(), b"red".to_string(), vector[swatch]);
    let part = base::new_part_row_v2(0, b"addon".to_string(), b"Pack Part".to_string(), 0, 0, 0,
        true, false, if (case == 15 || case == 24) 0 else 1, 2, vector[], vector[], base::visibility_program_commitment_v1(2,
            option::some(release.semantic_pack_id), 0, b"addon".to_string(), option::none(), option::none(), &vector[]), test_hash(2));
    let style_part = if (case == 8 || case >= 22) b"addon".to_string() else b"part".to_string();
    let rows = base::new_pack_definition_rows_v2(release.semantic_pack_id,
        vector[track], vector[color], vector[part], vector[], vector[
            test_pack_visibility_row(release.semantic_pack_id, 1, 2, style_part,
                b"pack-item".to_string(), option::none(), vector[]),
            test_pack_visibility_row(release.semantic_pack_id, 2, 2, style_part,
                b"pack-item".to_string(), option::some(b"pack-style".to_string()), vector[]),
        ]);
    let commitment = pack_definitions_commitment_v8(object::id(&release), release.content_commitment, &rows);
    register_pack_definitions_v8(&mut release, &cap, &registry, rows, commitment, &ctx);
    let own_id = object::id(&release);
    if (case == 1) {
        let _ = resolve_pack_track_v8(&registry, &release, object::id_from_address(@0xBAD), b"overlay".to_string());
    };
    if (case == 2) {
        let _ = resolve_pack_color_v8(&registry, &release, own_id, b"pack-tint".to_string(), b"missing".to_string());
    };
    if (case == 3) {
        let _ = resolve_pack_color_v8(&registry, &release, release.root_id, b"pack-tint".to_string(), b"red".to_string());
    };
    if (case == 4) release.root_content_commitment = test_hash(99);
    if (case == 5) release.content_commitment = test_hash(99);
    assert!(*resolve_pack_track_v8(&registry, &release, own_id, b"overlay".to_string()) == track, EInvalidProof);
    assert!(*resolve_pack_track_v8(&registry, &release, release.root_id, b"track".to_string())
        == *base::borrow_track_v2(&registry, b"track".to_string()), EInvalidProof);
    assert!(*resolve_pack_track_v8(&registry, &release, release.root_id, b"track".to_string()) != track, EInvalidProof);
    assert!(*resolve_pack_part_v8(&registry, &release, own_id, b"addon".to_string()) == part, EInvalidProof);
    assert!(*resolve_pack_part_v8(&registry, &release, release.root_id, b"part".to_string()) != part, EInvalidProof);
    assert!(*resolve_pack_color_v8(&registry, &release, own_id, b"pack-tint".to_string(), b"red".to_string()) == swatch, EInvalidProof);
    if ((case >= 6 && case <= 9) || (case >= 22 && case <= 29)) {
        let mut definitions = test_definitions_with_capacity(&mut ctx, 2);
        definitions.root_id = release.root_id;
        definitions.root_version = release.root_version;
        definitions.root_content_commitment = release.root_content_commitment;
        definitions.base_registry_id = object::id(&registry);
        let mut profile = definitions.profiles.remove(PartProfileKeyV8 { part_key: b"body".to_string() });
        profile.part_key = b"part".to_string();
        definitions.profile_keys = vector[profile.part_key];
        definitions.profiles.add(PartProfileKeyV8 { part_key: profile.part_key }, profile);
        let sources = new_pack_style_definition_sources_v8(if (case == 8 || case >= 22) 2 else 1,
            if (case == 9) 1 else 2, if (case == 7) option::none() else option::some(2));
        let previous = release.rolling_style_commitment;
        if (case >= 25) {
            // Declare the expected complete Style before the real append. Never
            // fake observed counts or copy the resulting rolling commitment.
            let expected_style = PackStyleV8 { index: 0, definition_sources: sources,
                part_key: style_part, item_key: b"pack-item".to_string(), style_key: b"pack-style".to_string(),
                layer_track_key: b"overlay".to_string(), color_channel_key: option::some(b"pack-tint".to_string()),
                default_swatch_key: option::some(b"red".to_string()), asset_blob_id: b"blob".to_string(),
                asset_sha256: test_hash(7), asset_content_commitment: test_hash(8), protected: false,
                seal_binding_commitment: vector[], style_commitment: test_hash(9) };
            release.expected_style_commitment = if (case == 27) test_hash(99) else advance_pack_style_commitment_v8(
                release.root_content_commitment, release.content_commitment, 0, previous, expected_style);
            if (case == 26) release.expected_style_count = 2;
        };
        if (case == 22 || case == 23) {
            // Runtime witness/append test only: external Seal certification is
            // deliberately not asserted by this controlled fixture.
            let witness = new_pack_registration_witness_v8(&release, &cap, &definitions,
                0, sources, style_part, b"pack-item".to_string(), b"pack-style".to_string(), test_hash(8), &ctx);
            append_certified_pack_style_v8(&mut release, &cap, &definitions, &registry, witness,
                if (case == 23) new_pack_style_definition_sources_v8(2, 1, option::some(2)) else sources,
                b"overlay".to_string(), option::some(b"pack-tint".to_string()), option::some(b"red".to_string()),
                b"blob".to_string(), test_hash(7), test_hash(8), test_hash(10), test_hash(9), &ctx);
        } else {
            append_unprotected_pack_style_v8(&mut release, &cap, &definitions, &registry, 0, sources,
                style_part, b"pack-item".to_string(), b"pack-style".to_string(), if (case == 9) b"track".to_string() else b"overlay".to_string(),
                option::some(b"pack-tint".to_string()), option::some(b"red".to_string()), b"blob".to_string(),
                test_hash(7), test_hash(8), test_hash(9), &ctx);
        };
        let style = release.styles.borrow(PackStyleKeyV8 { part_key: style_part,
            item_key: b"pack-item".to_string(), style_key: b"pack-style".to_string() });
        assert!(style.definition_sources == sources && release.observed_style_count == 1, EInvalidProof);
        assert!(exact_pack_swatch(&registry, &release, style, option::some(b"red".to_string()))
            == option::some(b"red".to_string()), EInvalidProof);
        let mut substituted = *style;
        substituted.definition_sources.track = if (sources.track == 1) 2 else 1;
        assert!(release.rolling_style_commitment != advance_pack_style_commitment_v8(
            release.root_content_commitment, release.content_commitment, 0, previous, substituted), EInvalidProof);
        substituted = *style;
        substituted.definition_sources.color = option::some(1);
        assert!(release.rolling_style_commitment != advance_pack_style_commitment_v8(
            release.root_content_commitment, release.content_commitment, 0, previous, substituted), EInvalidProof);
        if (case >= 25) {
            if (case == 28) {
                let wrong_author = tx_context::new_from_hint(@0xBAD, 903, 0, 0, 0);
                seal_pack_release_v8(&mut release, &cap, &wrong_author);
            } else seal_pack_release_v8(&mut release, &cap, &ctx);
            assert!(release.lifecycle == PACK_SEALED && release.observed_style_count == 1
                && release.rolling_style_commitment == release.expected_style_commitment, EInvalidProof);
            if (case == 29) seal_pack_release_v8(&mut release, &cap, &ctx);
        };
        let mut profile = definitions.profiles.remove(PartProfileKeyV8 { part_key: b"part".to_string() });
        profile.part_key = b"body".to_string();
        definitions.profiles.add(PartProfileKeyV8 { part_key: profile.part_key }, profile);
        destroy_test_definitions(definitions);
        let _ = release.styles.remove(PackStyleKeyV8 { part_key: style_part,
            item_key: b"pack-item".to_string(), style_key: b"pack-style".to_string() });
    };
    if (case >= 10 && case <= 21) {
        let mut definitions = test_definitions_with_capacity(&mut ctx, 2);
        definitions.root_id = release.root_id;
        definitions.root_version = release.root_version;
        definitions.root_content_commitment = release.root_content_commitment;
        if (case == 12) definitions.admission_ceiling = ADMISSION_DISABLED;
        if (case == 13) definitions.sealed = false;
        let profiles = pack_part_profiles_v8(&definitions, &release);
        assert!(profiles.length() == 1 && profiles[0].part_key == b"addon".to_string()
            && profiles[0].capacity == 2 && !profiles[0].required
            && profiles[0].wardrobe_mode == if (case == 15) WARDROBE_FIXED else WARDROBE_SLOT, EInvalidProof);
        assert!(profiles[0].behavior == if (case == 15) BEHAVIOR_FIXED
            else if (case == 12) BEHAVIOR_SOUL_LOCAL else BEHAVIOR_HYBRID, EInvalidProof);
        let mut loadout = test_loadout_with_capacity(&mut ctx, if (case == 16) 499 else 2);
        let occupied = test_selection(0, b"kept".to_string(), SOURCE_BASE, loadout.root_id);
        install_selection(&mut loadout, 0, occupied);
        let previous_slots = loadout.definition_slots;
        let previous_selections = loadout.selections;
        let revision = loadout.revision;
        let commitment = loadout.commitment;
        if (case == 19) {
            let _ = scoped_selection_slot(&loadout, own_id, &profiles[0], option::none());
        };
        append_pack_definition_slots(&mut loadout, own_id, pack_definitions_v8(&release).commitment, &profiles);
        assert!(loadout.revision == revision + 1 && loadout.commitment != commitment
            && loadout.selection_count == 1, EInvalidProof);
        assert!(loadout.definition_slots[0] == previous_slots[0]
            && loadout.selections[0] == previous_selections[0]
            && loadout.selections[1] == previous_selections[1], EInvalidProof);
        assert!(loadout.definition_slots[1].source_definition_id == own_id
            && loadout.definition_slots[1].start == 2 && loadout.definition_slots[1].capacity == 2
            && loadout.definition_slots[1].profile_commitment == profiles[0].profile_commitment
            && loadout.selections.length() == 4
            && loadout.selections[2].is_none() && loadout.selections[3].is_none(), EInvalidProof);
        if (case == 11) append_pack_definition_slots(&mut loadout, own_id, pack_definitions_v8(&release).commitment, &profiles);
        if (case == 14) {
            // Same local Part name in another Release gets a distinct stable range.
            let next_id = object::id_from_address(@0xBAD);
            append_pack_definition_slots(&mut loadout, next_id, test_hash(44), &profiles);
            assert!(loadout.definition_slots[1].start == 2
                && loadout.definition_slots[2].start == 4
                && loadout.definition_slots[2].source_definition_id == next_id
                && loadout.selections[0] == previous_selections[0], EInvalidProof);
        };
        if (case >= 17) {
            // Even with an identical Base key, resolve only this Release's range.
            loadout.definition_slots[0].part_key = profiles[0].part_key;
            let profile = pack_style_part_profile(&definitions, &release, 2, profiles[0].part_key);
            if (case == 20) loadout.definition_slots[1].profile_commitment = test_hash(99);
            let position = scoped_selection_slot(&loadout, own_id, &profile,
                if (case == 18) option::some(0) else option::none());
            assert!(position == 2, EInvalidProof);
            install_selection(&mut loadout, position, test_selection(position, b"own-a".to_string(), SOURCE_PACK, own_id));
            let next = scoped_selection_slot(&loadout, own_id, &profile, option::none());
            assert!(next == 3 && loadout.selections[0] == previous_selections[0], EInvalidProof);
            install_selection(&mut loadout, next, test_selection(next, b"own-b".to_string(), SOURCE_PACK, own_id));
            if (case == 21) { let _ = scoped_selection_slot(&loadout, own_id, &profile, option::none()); };
        };
        destroy_test_loadout(loadout);
        destroy_test_definitions(definitions);
    };
    let _: PackDefinitionsV8 = df::remove(&mut release.id, PackDefinitionsKeyV8 {});
    let PackAdminCapV8 { id, version: _, release_id: _, owner: _, control_epoch: _ } = cap;
    id.delete();
    destroy_test_pack_release(release);
    base::share_base_definition_registry_for_testing(registry);
}

#[test]
fun pack_reference_exact_source_preserves_additive_keys() { pack_reference_case(0) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_reference_rejects_foreign_definition() { pack_reference_case(1) }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_core::base_registry_v8)]
fun pack_reference_never_substitutes_default_swatch() { pack_reference_case(2) }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_core::base_registry_v8)]
fun pack_reference_never_falls_back_to_other_scope() { pack_reference_case(3) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_reference_rejects_other_parent_content() { pack_reference_case(4) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_reference_rejects_changed_release_content() { pack_reference_case(5) }
#[test]
fun pack_reference_public_append_persists_owned_track_color_sources() { pack_reference_case(6) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_reference_append_rejects_missing_color_source() { pack_reference_case(7) }
#[test]
fun pack_reference_append_resolves_owned_part_profile() { pack_reference_case(8) }
#[test]
fun pack_reference_public_append_allows_independent_base_track_pack_color() { pack_reference_case(9) }
#[test]
fun pack_reference_scope_bcs_matches_clients() {
    assert!(bcs::to_bytes(&new_pack_style_definition_sources_v8(1, 2, option::some(2))) == x"01020102", EInvalidProof);
    assert!(bcs::to_bytes(&new_pack_style_definition_sources_v8(1, 1, option::none())) == x"010100", EInvalidProof);
}
#[test, expected_failure(abort_code = EInvalidPolicy)]
fun pack_reference_scope_rejects_any() { new_pack_style_definition_sources_v8(0, 1, option::none()); }
#[test, expected_failure(abort_code = EInvalidPolicy)]
fun pack_reference_scope_rejects_external_color() { new_pack_style_definition_sources_v8(1, 1, option::some(3)); }
#[test]
fun pack_reference_owned_profiles_attach_without_reindexing() { pack_reference_case(10) }
#[test, expected_failure(abort_code = EDuplicate)]
fun pack_reference_attach_rejects_duplicate_release() { pack_reference_case(11) }
#[test]
fun pack_reference_owned_profiles_preserve_closed_admission() { pack_reference_case(12) }
#[test, expected_failure(abort_code = ENotSealed)]
fun pack_reference_owned_profiles_reject_unsealed_parent() { pack_reference_case(13) }
#[test]
fun pack_reference_attach_second_pack_preserves_prior_ranges() { pack_reference_case(14) }
#[test]
fun pack_reference_owned_profiles_preserve_fixed_parts() { pack_reference_case(15) }
#[test, expected_failure(abort_code = EInvalidCount)]
fun pack_reference_attach_rejects_total_capacity_overflow() { pack_reference_case(16) }
#[test]
fun pack_reference_owned_selection_uses_exact_attached_range() { pack_reference_case(17) }
#[test, expected_failure(abort_code = EPartOrder)]
fun pack_reference_owned_selection_cannot_target_base_slot() { pack_reference_case(18) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_reference_owned_selection_requires_attachment() { pack_reference_case(19) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_reference_owned_selection_requires_exact_profile_hash() { pack_reference_case(20) }
#[test, expected_failure(abort_code = EDuplicate)]
fun pack_reference_owned_selection_stops_at_part_capacity() { pack_reference_case(21) }
#[test]
fun pack_reference_protected_witness_resolves_owned_part() { pack_reference_case(22) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_reference_protected_witness_rejects_source_substitution() { pack_reference_case(23) }
#[test]
fun pack_reference_public_append_accepts_own_fixed_part() { pack_reference_case(24) }
#[test]
fun pack_reference_authored_seal_after_exact_scoped_append() { pack_reference_case(25) }
#[test, expected_failure(abort_code = EInvalidCount)]
fun pack_reference_authored_seal_rejects_missing_style() { pack_reference_case(26) }
#[test, expected_failure(abort_code = EInvalidCommitment)]
fun pack_reference_authored_seal_rejects_wrong_style_commitment() { pack_reference_case(27) }
#[test, expected_failure(abort_code = EWrongControl)]
fun pack_reference_authored_seal_rejects_other_author() { pack_reference_case(28) }
#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun pack_reference_authored_seal_cannot_repeat() { pack_reference_case(29) }

#[test_only]
fun pack_definitions_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 901, 0, 0, 0);
    let registry = base::new_visibility_registry_for_testing(vector[], 0, &mut ctx);
    let mut release = test_pack_release(&mut ctx);
    release.root_id = base::registry_root_id_v2(&registry);
    release.root_version = base::registry_maker_version_v2(&registry);
    release.root_content_commitment = *base::registry_root_content_commitment_v2(&registry);
    release.lifecycle = if (case == 2) PACK_ACTIVE else PACK_DRAFT;
    let cap_uid = object::new(&mut ctx);
    release.admin_cap_id = cap_uid.to_inner();
    let cap = PackAdminCapV8 { id: cap_uid, version: VERSION, release_id: object::id(&release),
        owner: if (case == 1) @0xBAD else @0xA11, control_epoch: 0 };
    if (case == 3) release.observed_style_count = 1;
    if (case == 8) release.root_content_commitment = test_hash(99);
    let mut tracks = vector[base::new_track_row_v2(0, b"overlay".to_string(), b"Overlay".to_string(), 2, false)];
    if (case >= 9) tracks.push_back(base::new_track_row_v2(1, b"upper".to_string(), b"Upper".to_string(), 3, false));
    let swatches = vector[base::new_color_swatch_v2(b"red".to_string(), b"Red".to_string(), 1, vector[]),
        base::new_color_swatch_v2(b"blue".to_string(), b"Blue".to_string(), 2, vector[])];
    let colors = if (case >= 14) vector[base::new_color_channel_row_v2(0, b"tint".to_string(),
        b"Tint".to_string(), b"blue".to_string(), swatches)] else vector[];
    let rows = base::new_pack_definition_rows_v2(
        if (case == 7) b"other".to_string() else release.semantic_pack_id,
        tracks,
        colors, vector[], vector[], vector[]);
    let expected = pack_definitions_commitment_v8(object::id(&release), release.content_commitment, &rows);
    assert!(expected != pack_definitions_commitment_v8(object::id_from_address(@0x22),
        release.content_commitment, &rows), EInvalidProof);
    if (case >= 9) {
        begin_pack_definitions_v8(&mut release, &cap, expected, &ctx);
        assert!(!df::exists(&release.id, PackDefinitionsKeyV8 {}), EInvalidProof);
        if (case == 12) register_pack_definitions_v8(&mut release, &cap, &registry, rows, expected, &ctx);
        if (case == 13) {
            release.observed_style_count = release.expected_style_count;
            release.rolling_style_commitment = release.expected_style_commitment;
            seal_pack_release_v8(&mut release, &cap, &ctx);
        };
        append_pack_definitions_v8(&mut release, &cap, 0, vector[tracks[0]], vector[], vector[], vector[], vector[], &ctx);
        if (case == 11) finalize_pack_definitions_v8(&mut release, &cap, &registry, 1, &ctx);
        append_pack_definitions_v8(&mut release, &cap, if (case == 10) 0 else 1,
            vector[tracks[1]], vector[], vector[], vector[], vector[], &ctx);
        if (case >= 14) {
            if (case == 20) {
                let wrong_author = tx_context::new_from_hint(@0xBAD, 903, 0, 0, 0);
                begin_pack_color_v8(&mut release, &cap, 2, 0, b"tint".to_string(), b"Tint".to_string(),
                    b"blue".to_string(), 2, &wrong_author);
            };
            begin_pack_color_v8(&mut release, &cap, 2, 0, b"tint".to_string(), b"Tint".to_string(),
                b"blue".to_string(), 2, &ctx);
            if (case == 18) append_pack_definitions_v8(&mut release, &cap, 3,
                vector[], vector[], vector[], vector[], vector[], &ctx);
            if (case == 19) finalize_pack_definitions_v8(&mut release, &cap, &registry, 3, &ctx);
            if (case == 21) seal_pack_release_v8(&mut release, &cap, &ctx);
            append_pack_color_v8(&mut release, &cap, 3, 0, vector[swatches[0]], &ctx);
            assert!(!df::exists(&release.id, PackDefinitionsKeyV8 {}), EInvalidProof);
            if (case == 16) finish_pack_color_v8(&mut release, &cap, 4, &ctx);
            append_pack_color_v8(&mut release, &cap, if (case == 15) 3 else 4,
                if (case == 22) 0 else 1, vector[swatches[if (case == 17) 0 else 1]], &ctx);
            finish_pack_color_v8(&mut release, &cap, 5, &ctx);
            assert!(!df::exists(&release.id, PackColorDraftKeyV8 {}), EInvalidProof);
        };
        finalize_pack_definitions_v8(&mut release, &cap, &registry, if (case >= 14) 6 else 2, &ctx);
        assert!(!df::exists(&release.id, PackDefinitionsDraftKeyV8 {}), EInvalidProof);
    } else register_pack_definitions_v8(&mut release, &cap, &registry, rows,
        if (case == 4) test_hash(0) else expected, &ctx);
    let saved = pack_definitions_v8(&release);
    assert!(saved.release_id == object::id(&release) && saved.rows == rows
        && saved.commitment == expected, EInvalidProof);
    if (case == 5) register_pack_definitions_v8(&mut release, &cap, &registry, rows, expected, &ctx);
    if (case == 6) {
        seal_pack_release_v8(&mut release, &cap, &ctx);
    };
    let _: PackDefinitionsV8 = df::remove(&mut release.id, PackDefinitionsKeyV8 {});
    let PackAdminCapV8 { id, version: _, release_id: _, owner: _, control_epoch: _ } = cap;
    id.delete();
    destroy_test_pack_release(release);
    base::share_base_definition_registry_for_testing(registry);
}

#[test]
fun pack_definitions_register_exact_immutable_release_rows() { pack_definitions_case(0) }
#[test]
fun pack_definitions_chunks_finalize_same_exact_rows() { pack_definitions_case(9) }
#[test, expected_failure(abort_code = EInvalidSequence)]
fun pack_definitions_chunks_reject_replayed_ordinal() { pack_definitions_case(10) }
#[test, expected_failure(abort_code = EInvalidCommitment)]
fun pack_definitions_chunks_reject_incomplete_content() { pack_definitions_case(11) }
#[test, expected_failure(abort_code = EInvalidPolicy)]
fun pack_definitions_chunks_reject_atomic_replacement() { pack_definitions_case(12) }
#[test, expected_failure(abort_code = EInvalidPolicy)]
fun pack_definitions_chunks_cannot_seal_partial_release() { pack_definitions_case(13) }
#[test]
fun pack_definitions_color_chunks_match_complete_rows() { pack_definitions_case(14) }
#[test, expected_failure(abort_code = EInvalidSequence)]
fun pack_definitions_color_chunks_reject_replayed_chunk() { pack_definitions_case(15) }
#[test, expected_failure(abort_code = 8, location = animacraft_v8_core::base_registry_v8)]
fun pack_definitions_color_chunks_reject_partial_finish() { pack_definitions_case(16) }
#[test, expected_failure(abort_code = 5, location = animacraft_v8_core::base_registry_v8)]
fun pack_definitions_color_chunks_reject_cross_batch_duplicate() { pack_definitions_case(17) }
#[test, expected_failure(abort_code = EInvalidPolicy)]
fun pack_definitions_color_chunks_block_outer_append() { pack_definitions_case(18) }
#[test, expected_failure(abort_code = EInvalidPolicy)]
fun pack_definitions_color_chunks_block_outer_finalize() { pack_definitions_case(19) }
#[test, expected_failure(abort_code = EWrongControl)]
fun pack_definitions_color_chunks_reject_other_author() { pack_definitions_case(20) }
#[test, expected_failure(abort_code = EInvalidPolicy)]
fun pack_definitions_color_chunks_block_seal() { pack_definitions_case(21) }
#[test, expected_failure(abort_code = 4, location = animacraft_v8_core::base_registry_v8)]
fun pack_definitions_color_chunks_reject_rebased_swatch_offset() { pack_definitions_case(22) }
#[test]
fun pack_profile_commitment_matches_client() {
    let content = test_hash(20);
    let previous = empty_profile_commitment_v8(content);
    assert!(advance_profile_commitment_v8(content, 0, previous, b"plume".to_string(),
        test_hash(32), false, WARDROBE_SLOT, BEHAVIOR_HYBRID, 2, ADMISSION_CERTIFIED)
        == x"8d135d901e9ec1c72cc028bdef5b4601c6d36a5f60fc57daace0a477c734f6b5", EInvalidCommitment);
}
#[test]
fun pack_definitions_commitment_matches_client() {
    assert!(bcs::to_bytes(&PackDefinitionsKeyV8 {}) == x"00", EInvalidCommitment);
    let rows = base::new_pack_definition_rows_v2(b"extras".to_string(), vector[], vector[], vector[], vector[], vector[]);
    assert!(pack_definitions_commitment_v8(object::id_from_address(@0x22), test_hash(1), &rows)
        == x"f1adc4b85ba61f64a2061b721acaa691b3b20d01772b76d85860e6a7b65d82d4", EInvalidCommitment);
}
#[test, expected_failure(abort_code = EWrongControl)]
fun pack_definitions_reject_other_author() { pack_definitions_case(1) }
#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun pack_definitions_reject_active_release() { pack_definitions_case(2) }
#[test, expected_failure(abort_code = EInvalidCount)]
fun pack_definitions_reject_existing_styles() { pack_definitions_case(3) }
#[test, expected_failure(abort_code = EInvalidCommitment)]
fun pack_definitions_reject_wrong_commitment() { pack_definitions_case(4) }
#[test, expected_failure(abort_code = EDuplicate)]
fun pack_definitions_cannot_replace_attached_rows() { pack_definitions_case(5) }
#[test, expected_failure(abort_code = EInvalidCount)]
fun pack_definitions_cannot_seal_before_expected_styles() { pack_definitions_case(6) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_definitions_reject_other_semantic_pack() { pack_definitions_case(7) }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun pack_definitions_reject_other_base_content() { pack_definitions_case(8) }

#[test, expected_failure(abort_code = EPackAccessAlreadyIssued)]
fun pack_access_rejects_duplicate_holder() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 81, 0, 0, 0);
    let mut release = test_pack_release(&mut ctx);
    transfer_pack_pass_to_holder_v8(new_pack_pass(&mut release, 10, 0, &mut ctx));
    transfer_pack_pass_to_holder_v8(new_pack_pass(&mut release, 10, 1, &mut ctx));
    destroy_test_pack_release(release);
}

#[test]
fun pack_access_distinct_holders_are_independent() {
    let mut scenario = sui::test_scenario::begin(@0xA11);
    let mut release = test_pack_release(scenario.ctx());
    assert!(scenario.ctx().sender() == @0xA11, EWrongHolder);
    transfer_pack_pass_to_holder_v8(new_pack_pass(&mut release, 0, 0, scenario.ctx()));
    transfer::share_object(release);
    // TxContext sender is native transaction state, not a per-value field.
    scenario.next_tx(@0xB0B);
    let mut release = scenario.take_shared<PackReleaseV8<sui::sui::SUI>>();
    assert!(scenario.ctx().sender() == @0xB0B, EWrongHolder);
    transfer_pack_pass_to_holder_v8(new_pack_pass(&mut release, 10, 1, scenario.ctx()));
    assert!(release.pass_count == 2, EInvalidCount);
    assert!(df::remove<PackAccessKeyV8, bool>(&mut release.id, PackAccessKeyV8 { holder: @0xA11 }), EInvalidProof);
    assert!(df::remove<PackAccessKeyV8, bool>(&mut release.id, PackAccessKeyV8 { holder: @0xB0B }), EInvalidProof);
    sui::test_scenario::return_shared(release);
    scenario.end();
}

#[test_only]
fun destroy_test_pack_release(release: PackReleaseV8<sui::sui::SUI>) {
    let PackReleaseV8 {
        id, version: _, root_id: _, root_version: _, root_content_commitment: _,
        creator: _, owner: _, control_epoch: _, admin_cap_id: _, treasury_id: _,
        semantic_pack_id: _, manifest_blob_id: _, manifest_sha256: _,
        content_commitment: _, lifecycle: _, access_kind: _, access_price_atomic: _,
        complete_mode: _, complete_price_atomic: _, complete_free_quota_per_wallet: _,
        complete_total_cap: _, expected_style_count: _, observed_style_count: _,
        expected_style_commitment: _, rolling_style_commitment: _, protected_style_count: _,
        pass_count: _, total_complete_count: _, styles, complete_by_wallet,
    } = release;
    id.delete();
    styles.destroy_empty();
    complete_by_wallet.destroy_empty();
}

#[test_only]
fun destroy_test_loadout(mut loadout: MakerLoadoutV8) {
    if (has_equipment_layout(&loadout)) {
        let _: bool = df::remove(&mut loadout.id, SoulEquipmentLayoutKeyV8 {});
    };
    if (is_soul_equipment_v8(&loadout)) {
        let _: SoulEquipmentBindingV8 = df::remove(&mut loadout.id, SoulEquipmentKeyV8 {});
    };
    let MakerLoadoutV8 {
        id, version: _, root_id: _, root_version: _, root_content_commitment: _,
        definition_registry_id: _, pack_registry_id: _, maker_access_pass_id: _,
        maker_access_commitment: _, holder: _, revision: _, attached_pack_definitions: _, definition_slots: _,
        selections: _, selection_count: _, commitment: _,
    } = loadout;
    id.delete();
}


#[test_only]
fun equipment_fixture(ctx: &mut TxContext): (
    MakerLoadoutV8, ProtocolConfigV8,
    animacraft_v8_core::protocol_config_v8::ProtocolAdminCapV8,
) {
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, ctx);
    native_binding::install_soulidity_binding_v8<
        animacraft_v8_core::soul::Soul,
        animacraft_v8_core::animacraft_v8_binding::MintBindingWitnessV8,
        animacraft_v8_core::animacraft_v8_binding::SoulOwnerWitnessV8,
    >(&mut config, &admin);
    let mut loadout = test_loadout(ctx);
    df::add(&mut loadout.id, SoulEquipmentLayoutKeyV8 {}, true);
    df::add(&mut loadout.id, SoulEquipmentKeyV8 {}, SoulEquipmentBindingV8 {
        soul_id: object::id_from_address(@0x42),
        soul_state_id: object::id_from_address(@0x43),
        holder: ctx.sender(), ownership_epoch: 2,
        protocol_config_id: object::id(&config),
    });
    (loadout, config, admin)
}

#[test_only]
fun equipment_test_update(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 801, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    // Sui's test sender is VM-global, not stored independently in each context.
    if (case == 6) { let _wrong_ctx = tx_context::new_from_hint(@0xB22, 802, 0, 0, 0); };
    let witness = animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
        object::id_from_address(if (case == 1) @0x99 else @0x42),
        object::id_from_address(if (case == 2) @0x99 else @0x43),
        if (case == 3) @0xB22 else @0xA11,
        if (case == 4) 3 else 2,
    );
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config,
        if (case == 5) 1 else 0, witness, &ctx);
    assert!(!is_soul_equipment_v8(&loadout), 100);
    if (case == 7) {
        let mut other = test_loadout(&mut ctx);
        finish_test_empty_equipment(&mut other, guard, &mut ctx);
        destroy_test_loadout(other);
    } else {
        assert_loadout_holder_revision(&loadout, 0, &ctx);
        finish_test_empty_equipment(&mut loadout, guard, &mut ctx);
        assert!(is_soul_equipment_v8(&loadout)
            && soul_equipment_soul_id_v8(&loadout) == object::id_from_address(@0x42)
            && soul_equipment_state_id_v8(&loadout) == object::id_from_address(@0x43)
            && soul_equipment_binding_v8(&loadout).ownership_epoch == 2, 101);
    };
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test_only]
fun equipment_single_slot_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 901 + (case as u64), 0, 0, 0);
    let definitions = test_definitions_with_capacity(&mut ctx, 3);
    let profile = *definitions.profiles.borrow(PartProfileKeyV8 { part_key: b"body".to_string() });
    let player = test_loadout_with_capacity(&mut ctx, 3);
    assert!(selection_slot(&player, &definitions, &profile, option::some(2)) == 2, 121);
    assert!(base_definition_slots(&definitions)[0].capacity == 3, 122);
    let (mut equipment, config, admin) = equipment_fixture(&mut ctx);
    equipment.definition_registry_id = object::id(&definitions);
    equipment.definition_slots = definition_slots_for_layout(&definitions, true);
    recompute_loadout(&mut equipment);
    let guard = begin_soul_equipment_update_v8(&mut equipment, &config, 0,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    assert!(!is_soul_equipment_v8(&equipment) && has_equipment_layout(&equipment), 123);
    assert!(equipment.definition_slots[0].capacity == 1 && equipment.selections.length() == 1, 124);
    assert!(selection_slot(&equipment, &definitions, &profile, option::none()) == 0, 125);
    if (case == 1) {
        let selection = test_selection(0, b"style".to_string(), SOURCE_BASE, equipment.root_id);
        install_selection(&mut equipment, 0, selection);
        let _ = selection_slot(&equipment, &definitions, &profile, option::none());
    };
    if (case == 2) { let _ = selection_slot(&equipment, &definitions, &profile, option::some(1)); };
    if (case == 3) {
        equipment.definition_slots[0].capacity = 3;
        equipment.selections = vector[option::none(), option::none(), option::none()];
        let _ = consume_pack_definition_proofs(&equipment, &definitions, vector[], false);
    };
    // A Pack-owned Part with the same label/key is a separate definition, not
    // another slot in the Base Part. Its Maker capacity still does not apply.
    let release_id = object::id_from_address(@0x99);
    append_pack_definition_slots(&mut equipment, release_id, test_hash(4), &vector[profile]);
    assert!(equipment.definition_slots[1].capacity == 1 && equipment.definition_slots[1].start == 1
        && equipment.selections.length() == 2, 126);
    assert!(scoped_selection_slot(&equipment, release_id, &profile, option::none()) == 1, 127);
    let proof = PackDefinitionProofV8 { loadout_id: object::id(&equipment), loadout_revision: equipment.revision,
        loadout_commitment: equipment.commitment, binding_index: 0, release_id,
        definition_commitment: test_hash(4), profiles: vector[profile], completion_checked: false };
    let profiles = consume_pack_definition_proofs(&equipment, &definitions, vector[proof], false);
    assert!(profiles.length() == 2 && profiles[0].capacity == 3 && profiles[1].capacity == 3, 128);
    // This unit exercises layout while the actual public guard is open. Final
    // visibility validation is covered separately by the equipment journey tests.
    std::unit_test::destroy(guard);
    destroy_test_loadout(equipment); destroy_test_loadout(player);
    destroy_test_definitions(definitions);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun equipment_single_slot_survives_guard_and_pack_proofs_without_changing_player() { equipment_single_slot_case(0); }
#[test, expected_failure(abort_code = EDuplicate)]
fun equipment_single_slot_rejects_second_item() { equipment_single_slot_case(1); }
#[test, expected_failure(abort_code = EPartOrder)]
fun equipment_single_slot_rejects_explicit_extra_position() { equipment_single_slot_case(2); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_single_slot_rejects_forged_multi_capacity_proof_layout() { equipment_single_slot_case(3); }

/// Adapt pre-existing empty-equipment tests to an actual sealed definition
/// registry. This is test-only setup, not an alternate guard consumer.
#[test_only]
fun finish_test_empty_equipment(
    loadout: &mut MakerLoadoutV8, guard: SoulEquipmentUpdateV8, ctx: &mut TxContext,
) {
    assert!(loadout.selection_count == 0, 110);
    let (definitions, base) = equipment_visibility_definitions_for_testing(loadout, vector[], 0, ctx);
    finish_soul_equipment_update_v8(loadout, &definitions, &base, vector[], guard);
    destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(base);
}

#[test_only]
public fun equipment_visibility_definitions_for_testing(
    loadout: &mut MakerLoadoutV8, tokens: vector<base::VisibilityTokenV1>, subject: u8, ctx: &mut TxContext,
): (RuntimeDefinitionRegistryV8, BaseDefinitionRegistryV8) {
    let registry = base::new_equipment_visibility_registry_for_testing(tokens, subject, ctx);
    while (loadout.selections.length() < 3) loadout.selections.push_back(option::none());
    let mut definitions = test_definitions_with_capacity(ctx, 1);
    let mut profile = definitions.profiles.remove(PartProfileKeyV8 { part_key: b"body".to_string() });
    definitions.profile_keys = vector[b"part".to_string(), b"spare".to_string(), b"dependent".to_string()];
    let mut profile_index = 0;
    definitions.profile_keys.do_ref!(|key| {
        profile.part_key = *key; profile.index = profile_index;
        definitions.profiles.add(PartProfileKeyV8 { part_key: *key }, profile);
        profile_index = profile_index + 1;
    });
    definitions.expected_profile_count = 3; definitions.observed_profile_count = 3;
    definitions.base_registry_id = object::id(&registry);
    definitions.root_id = base::registry_root_id_v2(&registry);
    definitions.root_version = base::registry_maker_version_v2(&registry);
    definitions.root_content_commitment = *base::registry_root_content_commitment_v2(&registry);
    loadout.root_id = definitions.root_id;
    loadout.root_version = definitions.root_version;
    loadout.root_content_commitment = definitions.root_content_commitment;
    loadout.definition_registry_id = object::id(&definitions);
    loadout.definition_slots = base_definition_slots(&definitions);
    loadout.commitment = canonical_loadout_commitment(loadout.root_id, loadout.root_version,
        loadout.root_content_commitment, &loadout.attached_pack_definitions, &loadout.definition_slots, &loadout.selections);
    (definitions, registry)
}

#[test_only]
public fun destroy_equipment_visibility_definitions_for_testing(definitions: RuntimeDefinitionRegistryV8) {
    destroy_test_definitions(definitions);
}

#[test_only]
public fun install_equipment_visibility_selection_for_testing(
    loadout: &mut MakerLoadoutV8, index: u64, source: u8, protected: bool,
) {
    while (loadout.selections.length() <= index) loadout.selections.push_back(option::none());
    let mut selection = test_selection(index, b"style".to_string(), source,
        if (source == SOURCE_EXTERNAL) object::id_from_address(@0x11) else loadout.root_id);
    selection.part_key = loadout.definition_slots[index].part_key;
    selection.access_subject = loadout.maker_access_pass_id;
    selection.protected = protected;
    install_selection(loadout, index, selection);
}

#[test_only]
fun equipment_visibility_tokens(source: u8, negate: bool): vector<base::VisibilityTokenV1> {
    let source_key = if (source == 2) option::some(b"pack".to_string())
        else if (source == 3) option::some(
            b"0x0000000000000000000000000000000000000000000000000000000000000011".to_string())
        else option::none();
    let mut tokens = vector[base::new_visibility_token_v1(0, option::some(base::new_semantic_selector_v2(
        source, source_key, b"part".to_string(), option::some(b"item".to_string()),
        option::some(b"style".to_string()))), 0)];
    if (negate) tokens.push_back(base::new_visibility_token_v1(1, option::none(), 1));
    tokens
}

#[test_only]
fun equipment_visibility_finish_case(subject: u8, source: u8, predicate: u8, negate: bool, empty: bool) {
    let hint = 840 + (subject as u64) * 1000 + (source as u64) * 100
        + (predicate as u64) * 10 + if (negate) 2 else if (empty) 1 else 0;
    let mut ctx = tx_context::new_from_hint(@0xA11, hint, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let (definitions, registry) = equipment_visibility_definitions_for_testing(&mut loadout,
        equipment_visibility_tokens(predicate, negate), subject, &mut ctx);
    if (!empty) install_equipment_visibility_selection_for_testing(&mut loadout, 0, source, false);
    let revision = loadout.revision;
    let commitment = loadout.commitment;
    let selections = loadout.selections;
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, revision,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    assert_soul_equipment_update_v8(&loadout, &guard, &ctx);
    finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], guard);
    assert!(loadout.revision == revision && loadout.commitment == commitment
        && loadout.selections == selections && is_soul_equipment_v8(&loadout), 111);
    destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun equipment_final_visibility_accepts_sparse_selected_base_all_three_levels() {
    equipment_visibility_finish_case(0, SOURCE_BASE, 1, false, false);
    equipment_visibility_finish_case(1, SOURCE_BASE, 1, false, false);
    equipment_visibility_finish_case(2, SOURCE_BASE, 1, false, false);
}
#[test]
fun equipment_final_visibility_accepts_empty_despite_required_profile_and_false_program() {
    equipment_visibility_finish_case(0, SOURCE_BASE, 1, false, true);
}
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_visibility_rejects_false_part() { equipment_visibility_finish_case(0, SOURCE_BASE, 1, true, false); }
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_visibility_rejects_false_item() { equipment_visibility_finish_case(1, SOURCE_BASE, 1, true, false); }
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_visibility_rejects_false_style() { equipment_visibility_finish_case(2, SOURCE_BASE, 1, true, false); }
#[test]
fun equipment_final_visibility_matches_any_pack_and_external_product() {
    equipment_visibility_finish_case(0, SOURCE_BASE, 0, false, false);
    equipment_visibility_finish_case(0, SOURCE_PACK, 2, false, false);
    equipment_visibility_finish_case(0, SOURCE_EXTERNAL, 3, false, false);
}
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_visibility_pack_name_cannot_satisfy_base_selector() { equipment_visibility_finish_case(0, SOURCE_PACK, 1, false, false); }
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_visibility_base_name_cannot_satisfy_pack_selector() { equipment_visibility_finish_case(0, SOURCE_BASE, 2, false, false); }
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_visibility_external_name_cannot_satisfy_base_selector() { equipment_visibility_finish_case(0, SOURCE_EXTERNAL, 1, false, false); }
#[test]
fun equipment_final_visibility_does_not_apply_unselected_base_style_to_pack_or_external() {
    equipment_visibility_finish_case(2, SOURCE_PACK, 1, false, false);
    equipment_visibility_finish_case(2, SOURCE_EXTERNAL, 1, false, false);
}

#[test_only]
fun equipment_visibility_atomic_case(mode: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 841, 0, 0, 0);
    let (mut loadout, mut config, admin) = equipment_fixture(&mut ctx);
    let (definitions, registry) = equipment_visibility_definitions_for_testing(&mut loadout,
        equipment_visibility_tokens(1, false), 0, &mut ctx);
    install_equipment_visibility_selection_for_testing(&mut loadout, 0, SOURCE_BASE, true);
    install_equipment_visibility_selection_for_testing(&mut loadout, 2, SOURCE_PACK, true);
    let original = loadout.selections;
    let original_commitment = loadout.commitment;
    // Removal/finalization does not acquire purchase/decrypt authority and
    // does not require an active Maker or enabled protocol.
    protocol::set_protocol_enabled_v8(&mut config, &admin, false);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 2,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    assert_soul_equipment_update_v8(&loadout, &guard, &ctx);
    clear_non_external_selection_v8(&mut loadout, 0, 2, &ctx);
    // The selected Pack now has a false host Part; the transaction may repair
    // it or clear everything before the only final validation.
    assert!(loadout.revision == 3 && loadout.selection_count == 1, 112);
    if (mode == 1) {
        assert_soul_equipment_update_v8(&loadout, &guard, &ctx);
        clear_non_external_selection_v8(&mut loadout, 2, 3, &ctx);
    } else if (mode == 2) {
        assert_soul_equipment_update_v8(&loadout, &guard, &ctx);
        // Use the same install primitive used by real BASE/Pack selection.
        install_selection(&mut loadout, 0, *original[0].borrow());
    } else if (mode == 3) {
        clear_non_external_selection_v8(&mut loadout, 2, 2, &ctx);
    };
    finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], guard);
    assert!(loadout.revision == 4 && is_soul_equipment_v8(&loadout), 113);
    if (mode == 1) {
        assert!(loadout.selection_count == 0 && loadout.selections.length() == 3, 114);
    } else {
        assert!(loadout.selections == original && loadout.commitment == original_commitment, 115);
    };
    destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_atomic_removing_dependency_rejects_final_invalid_state() { equipment_visibility_atomic_case(0); }
#[test]
fun equipment_atomic_all_clear_allows_intermediate_invalid_and_empty_final() { equipment_visibility_atomic_case(1); }
#[test]
fun equipment_atomic_replacement_restores_identity_after_intermediate_invalid() { equipment_visibility_atomic_case(2); }
#[test, expected_failure(abort_code = EStaleRevision)]
fun equipment_atomic_each_mutation_requires_adjacent_revision() { equipment_visibility_atomic_case(3); }

#[test_only]
fun equipment_visibility_binding_case(mode: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 842, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let (mut definitions, registry) = equipment_visibility_definitions_for_testing(&mut loadout, vector[], 0, &mut ctx);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 0,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    if (mode == 0) definitions.base_registry_id = object::id_from_address(@0x99);
    if (mode == 1) definitions.sealed = false;
    if (mode == 2) definitions.root_id = object::id_from_address(@0x99);
    if (mode == 3) definitions.root_version = definitions.root_version + 1;
    if (mode == 4) definitions.root_content_commitment = test_hash(99);
    if (mode == 5) loadout.definition_registry_id = object::id_from_address(@0x99);
    if (mode == 6) definitions.version = 99;
    if (mode == 7) {
        let other = test_loadout(&mut ctx);
        assert_soul_equipment_update_v8(&other, &guard, &ctx);
        destroy_test_loadout(other);
    };
    if (mode == 8) {
        let second = begin_soul_equipment_update_v8(&mut loadout, &config, 0,
            animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
                object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
        finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], second);
    };
    finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], guard);
    destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_finish_rejects_wrong_base_id() { equipment_visibility_binding_case(0); }
#[test, expected_failure(abort_code = ENotSealed)]
fun equipment_finish_rejects_unsealed_definitions() { equipment_visibility_binding_case(1); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_finish_rejects_definition_root_drift() { equipment_visibility_binding_case(2); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_finish_rejects_definition_root_version_drift() { equipment_visibility_binding_case(3); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_finish_rejects_definition_root_hash_drift() { equipment_visibility_binding_case(4); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_finish_rejects_other_definitions_id() { equipment_visibility_binding_case(5); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_finish_rejects_wrong_definitions_version() { equipment_visibility_binding_case(6); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun equipment_mutation_guard_rejects_other_loadout() { equipment_visibility_binding_case(7); }
#[test, expected_failure(abort_code = 1, location = sui::dynamic_field)]
fun equipment_update_cannot_begin_twice() { equipment_visibility_binding_case(8); }

#[test, expected_failure(abort_code = ENotSealed)]
fun equipment_finish_rejects_exact_but_unsealed_base_registry() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 843, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let economics = maker::new_economics_snapshot_v8<u64>(&config, 0, 0, 0, 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(&ctx, 250, 250, 500);
    let (root, registry, treasury, maker_admin) = animacraft_v8_core::core_v8::new_initial_maker_draft_v8<u64>(
        &config, b"equipment-test".to_string(), test_hash(1), test_hash(2), test_hash(3), test_hash(4),
        b"manifest".to_string(), test_hash(5), test_hash(6), base::new_base_definition_counts_v8(1, 0, 1, 1, 1, 0, 1),
        base::minimal_author_rows_commitment_for_testing(), test_hash(7), economics, rights, &clock, &mut ctx);
    let mut definitions = test_definitions_with_capacity(&mut ctx, 1);
    definitions.base_registry_id = object::id(&registry);
    definitions.root_id = base::registry_root_id_v2(&registry);
    definitions.root_version = base::registry_maker_version_v2(&registry);
    definitions.root_content_commitment = *base::registry_root_content_commitment_v2(&registry);
    loadout.root_id = definitions.root_id;
    loadout.root_version = definitions.root_version;
    loadout.root_content_commitment = definitions.root_content_commitment;
    loadout.definition_registry_id = object::id(&definitions);
    loadout.definition_slots = base_definition_slots(&definitions);
    recompute_loadout(&mut loadout);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 0,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], guard);
    destroy_test_loadout(loadout);
    destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
    core_treasury::destroy_maker_treasury_for_testing(treasury);
    maker::destroy_maker_for_testing(root, maker_admin);
    clock.destroy_for_testing();
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test_only]
fun equipment_instance_final_failure_case(external: bool, clear_all: bool) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 844, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let (definitions, registry) = equipment_visibility_definitions_for_testing(&mut loadout,
        equipment_visibility_tokens(if (external) 3 else 1, false), 0, &mut ctx);
    install_equipment_visibility_selection_for_testing(&mut loadout, 0, if (external) SOURCE_EXTERNAL else SOURCE_BASE, false);
    install_equipment_visibility_selection_for_testing(&mut loadout, 2, SOURCE_PACK, false);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 2,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    if (external) {
        let mut item = OwnedExternalItemV8 {
            id: object::new(&mut ctx), version: VERSION, product_id: object::id_from_address(@0x11),
            product_content_commitment: test_hash(1), asset_content_commitment: test_hash(2),
            holder: ctx.sender(), ownership_epoch: 0, transferable: true,
            equip_lock: option::some(EquipLockV8 { loadout_id: object::id(&loadout), equip_revision: 1, selection_index: 0 }),
        };
        loadout.selections[0].borrow_mut().access_subject = object::id(&item);
        unequip_external_style_v8(&mut loadout, &mut item, 2, &ctx);
        assert!(item.equip_lock.is_none() && loadout.revision == 3, 116);
        if (clear_all) clear_non_external_selection_v8(&mut loadout, 2, 3, &ctx);
        // A false final host condition aborts this same transaction after the
        // real lock/revision mutation; there is no earlier successful finish.
        finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], guard);
        assert!(clear_all && loadout.selection_count == 0 && loadout.revision == 4, 117);
        destroy_test_owned_item(item);
    } else {
        let (item_definitions, packs, mut item) = test_owned_base_fixture(&mut ctx);
        loadout.selections[0].borrow_mut().access_subject = object::id(&item);
        loadout.selections[0].borrow_mut().source_epoch = item.ownership_epoch;
        item.equip_lock = option::some(EquipLockV8 { loadout_id: object::id(&loadout), equip_revision: 1, selection_index: 0 });
        unequip_owned_base_style_v8(&mut loadout, &mut item, 2, &ctx);
        assert!(item.equip_lock.is_none() && loadout.revision == 3, 116);
        if (clear_all) clear_non_external_selection_v8(&mut loadout, 2, 3, &ctx);
        finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], guard);
        assert!(clear_all && loadout.selection_count == 0 && loadout.revision == 4, 117);
        destroy_test_owned_base_fixture(item_definitions, packs, item);
    };
    destroy_test_definitions(definitions);
    base::share_base_definition_registry_for_testing(registry);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_failure_aborts_after_owned_base_lock_and_revision_mutation() { equipment_instance_final_failure_case(false, false); }
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_final_failure_aborts_after_external_lock_and_revision_mutation() { equipment_instance_final_failure_case(true, false); }
#[test]
fun equipment_all_clear_keeps_owned_base_unlock_and_final_empty() { equipment_instance_final_failure_case(false, true); }
#[test]
fun equipment_all_clear_keeps_external_unlock_and_final_empty() { equipment_instance_final_failure_case(true, true); }

/// Real public select/remove/reselect against author-appended and sealed rows.
/// Only the access entitlement is a test-only precondition, not an issuance test.
#[test_only]
fun equipment_public_replacement_case(mode: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 845, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let track = base::new_track_row_v2(0, b"track".to_string(), b"Track".to_string(), 0, false);
    let tokens = equipment_visibility_tokens(1, false);
    let part = base::new_part_row_v2(0, b"part".to_string(), b"Part".to_string(), 0, 0, 0,
        true, true, 1, 1, vector[b"track".to_string()], tokens,
        base::visibility_program_commitment_v1(1, option::none(), 0, b"part".to_string(), option::none(), option::none(), &tokens), test_hash(11));
    let spare = base::new_part_row_v2(1, b"spare".to_string(), b"Spare".to_string(), 0, 1, 1,
        true, false, 1, 1, vector[b"track".to_string()], vector[],
        base::visibility_program_commitment_v1(1, option::none(), 0, b"spare".to_string(), option::none(), option::none(), &vector[]), test_hash(16));
    let dependent = base::new_part_row_v2(2, b"dependent".to_string(), b"Dependent".to_string(), 0, 2, 2,
        true, false, 1, 1, vector[b"track".to_string()], tokens,
        base::visibility_program_commitment_v1(1, option::none(), 0, b"dependent".to_string(), option::none(), option::none(), &tokens), test_hash(17));
    let item = base::new_item_row_v2(0, b"part".to_string(), b"item".to_string(), b"Item".to_string(),
        0, 0, b"style".to_string(), vector[], base::visibility_program_commitment_v1(1, option::none(), 1,
            b"part".to_string(), option::some(b"item".to_string()), option::none(), &vector[]), test_hash(12));
    let style = base::new_style_row_v2(0, b"part".to_string(), b"item".to_string(), b"style".to_string(),
        b"Style".to_string(), 0, b"track".to_string(), option::none(), option::none(), b"asset".to_string(),
        b"blob".to_string(), test_hash(13), false, base::new_transform_fixed_v1(base::new_signed_milli_v1(false, 0),
            base::new_signed_milli_v1(false, 0), 1_000_000, base::new_signed_milli_v1(false, 0)), 1_000_000, 0,
        option::none(), vector[], base::visibility_program_commitment_v1(1, option::none(), 2,
            b"part".to_string(), option::some(b"item".to_string()), option::some(b"style".to_string()), &vector[]), test_hash(14));
    let trigger = base::new_semantic_selector_v2(1, option::none(), b"part".to_string(),
        option::some(b"item".to_string()), option::some(b"style".to_string()));
    let target = base::new_semantic_selector_v2(2, option::some(b"missing-pack".to_string()), b"part".to_string(),
        option::some(b"item".to_string()), option::some(b"style".to_string()));
    let rule = base::new_rule_row_v2(0, b"complete-only-require".to_string(), 0, trigger, 0, vector[target], test_hash(15));
    let asset = base::new_asset_row_v2(0, b"asset".to_string(), b"image".to_string(), b"image/png".to_string(), 32, test_hash(13));
    let rows = vector[bcs::to_bytes(&track), bcs::to_bytes(&part), bcs::to_bytes(&spare), bcs::to_bytes(&dependent), bcs::to_bytes(&item),
        bcs::to_bytes(&style), bcs::to_bytes(&rule), bcs::to_bytes(&asset)];
    let categories = vector[0u8, 2, 2, 2, 3, 4, 5, 6];
    let category_indices = vector[0, 0, 1, 2, 0, 0, 0, 0];
    let mut rolling = base::author_rows_empty_commitment_v2();
    let mut index = 0;
    while (index < rows.length()) {
        rolling = base::author_rows_advance_commitment_v2(categories[index], category_indices[index], index, rolling, rows[index]);
        index = index + 1;
    };
    let clock = sui::clock::create_for_testing(&mut ctx);
    let economics = maker::new_economics_snapshot_v8<u64>(&config, 0, 0, 0, 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(&ctx, 250, 250, 500);
    let (mut root, mut registry, treasury, maker_admin) = animacraft_v8_core::core_v8::new_initial_maker_draft_v8<u64>(
        &config, b"equipment-test".to_string(), test_hash(1), test_hash(2), test_hash(3), test_hash(4),
        b"manifest".to_string(), test_hash(5), test_hash(6), base::new_base_definition_counts_v8(1, 0, 3, 1, 1, 1, 1),
        base::author_rows_seal_commitment_v2(vector[1, 0, 3, 1, 1, 1, 1], rolling), test_hash(7), economics, rights, &clock, &mut ctx);
    base::append_track_v2(&mut registry, &root, &maker_admin, track);
    base::append_part_v2(&mut registry, &root, &maker_admin, part);
    base::append_part_v2(&mut registry, &root, &maker_admin, spare);
    base::append_part_v2(&mut registry, &root, &maker_admin, dependent);
    base::append_item_v2(&mut registry, &root, &maker_admin, item);
    base::append_style_v2(&mut registry, &root, &maker_admin, style);
    base::append_rule_v2(&mut registry, &root, &maker_admin, rule);
    base::append_asset_v2(&mut registry, &root, &maker_admin, asset);
    base::seal_base_definition_registry_v8(&mut registry, &mut root, &maker_admin);
    maker::set_lifecycle_for_testing(&mut root, 1);
    let access = core_treasury::new_maker_access_for_testing(&root, ctx.sender(), &mut ctx);
    let (mut definitions, packs, authority) = new_physical_runtime_fixture_for_testing(&root, &mut ctx);
    let mut profile = test_profile(WARDROBE_SLOT, BEHAVIOR_HYBRID, true);
    profile.capacity = 1;
    definitions.profile_keys = vector[b"part".to_string(), b"spare".to_string(), b"dependent".to_string()];
    let mut profile_index = 0;
    definitions.profile_keys.do_ref!(|key| {
        profile.part_key = *key; profile.index = profile_index;
        definitions.profiles.add(PartProfileKeyV8 { part_key: *key }, profile);
        profile_index = profile_index + 1;
    });
    loadout.root_id = object::id(&root); loadout.root_version = maker::root_maker_version_v8(&root);
    loadout.root_content_commitment = *maker::root_content_commitment_v8(&root);
    loadout.definition_registry_id = object::id(&definitions); loadout.pack_registry_id = object::id(&packs);
    loadout.maker_access_pass_id = object::id(&access); loadout.maker_access_commitment = maker_access_entitlement_commitment_v8(&access);
    loadout.selections = vector[option::none(), option::none(), option::none()];
    loadout.definition_slots = base_definition_slots(&definitions);
    recompute_loadout(&mut loadout);
    let initial_guard = begin_soul_equipment_update_v8(&mut loadout, &config, 0,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    select_base_style_v8(&mut loadout, &root, &definitions, &packs, &registry, &access, 0, option::some(0),
        b"part".to_string(), b"item".to_string(), b"style".to_string(), option::none(), &ctx);
    install_equipment_visibility_selection_for_testing(&mut loadout, 2, SOURCE_PACK, false);
    finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], initial_guard);
    let original = loadout.selections;
    let commitment = loadout.commitment;
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 2,
        animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
            object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2), &ctx);
    clear_non_external_selection_v8(&mut loadout, 0, 2, &ctx);
    assert!(!selection_contains_selector(&loadout, &trigger) && loadout.selection_count == 1, 118);
    if (mode != 1) select_base_style_v8(&mut loadout, &root, &definitions, &packs, &registry, &access,
        if (mode == 2) 2 else 3, option::some(0), b"part".to_string(), b"item".to_string(),
        b"style".to_string(), option::none(), &ctx);
    // This is an actual nonempty registry Rule with an unsatisfied target.
    // It remains a Complete-only gate, not a new equipment restriction.
    assert!(base::registry_rule_count_v2(&registry) == 1 && !base::rule_is_satisfied_v2(
        base::borrow_rule_at_v2(&registry, 0), true, &vector[false]), 119);
    finish_soul_equipment_update_v8(&mut loadout, &definitions, &registry, vector[], guard);
    assert!(loadout.revision == 4 && loadout.selections == original && loadout.commitment == commitment, 120);
    destroy_test_definitions(definitions); std::unit_test::destroy(packs); std::unit_test::destroy(authority);
    std::unit_test::destroy(access);
    destroy_test_loadout(loadout);
    base::share_base_definition_registry_for_testing(registry);
    core_treasury::destroy_maker_treasury_for_testing(treasury);
    maker::destroy_maker_for_testing(root, maker_admin);
    clock.destroy_for_testing(); protocol::destroy_protocol_for_testing(config, admin);
}
#[test]
fun equipment_public_reselect_repairs_intermediate_false_without_enforcing_complete_rules() { equipment_public_replacement_case(0); }
#[test, expected_failure(abort_code = ERuleViolation)]
fun equipment_public_remove_without_reselect_aborts_final_visibility() { equipment_public_replacement_case(1); }
#[test, expected_failure(abort_code = EStaleRevision)]
fun equipment_public_reselect_rejects_stale_revision_in_same_guard() { equipment_public_replacement_case(2); }

#[test_only]
public fun soul_equipment_read_fixture_for_testing(
    soul_id: ID, soul_state_id: ID, holder: address, ownership_epoch: u64,
    protocol_config_id: ID, ctx: &mut TxContext,
): MakerLoadoutV8 {
    let mut equipment = test_loadout(ctx);
    equipment.holder = holder;
    df::add(&mut equipment.id, SoulEquipmentLayoutKeyV8 {}, true);
    df::add(&mut equipment.id, SoulEquipmentKeyV8 {}, SoulEquipmentBindingV8 {
        soul_id, soul_state_id, holder, ownership_epoch, protocol_config_id,
    });
    equipment
}

#[test_only]
public fun destroy_soul_equipment_read_fixture_for_testing(equipment: MakerLoadoutV8) {
    destroy_test_loadout(equipment);
}

#[test_only]
fun equipment_test_read(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 820, 0, 0, 0);
    let (mut equipment, mut config, admin) = equipment_fixture(&mut ctx);
    // Read authorization must not depend on enabled/new-issuance protocol state.
    protocol::set_protocol_enabled_v8(&mut config, &admin, false);
    if (case == 5) { ctx = tx_context::new_from_hint(@0xB22, 821, 0, 0, 0); };
    if (case == 6) {
        let binding: &mut SoulEquipmentBindingV8 = df::borrow_mut(&mut equipment.id, SoulEquipmentKeyV8 {});
        binding.protocol_config_id = object::id_from_address(@0x99);
    };
    if (case == 7) { equipment.version = 7; };
    if (case == 8) { equipment.holder = @0xB22; };
    if (case == 9) { let _: SoulEquipmentBindingV8 = df::remove(&mut equipment.id, SoulEquipmentKeyV8 {}); };
    let before = bcs::to_bytes(&equipment);
    let witness = animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
        object::id_from_address(if (case == 1) @0x99 else @0x42),
        object::id_from_address(if (case == 2) @0x99 else @0x43),
        if (case == 3) @0xB22 else @0xA11,
        if (case == 4) 3 else 2,
    );
    assert_soul_equipment_read_v8(&equipment, &config, witness, &ctx);
    assert!(case == 0 && bcs::to_bytes(&equipment) == before
        && is_soul_equipment_v8(&equipment)
        && soul_equipment_binding_v8(&equipment).ownership_epoch == 2
        && soul_equipment_soul_id_v8(&equipment) == object::id_from_address(@0x42)
        && soul_equipment_state_id_v8(&equipment) == object::id_from_address(@0x43), 110);
    destroy_test_loadout(equipment);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun soul_equipment_read_preserves_binding_and_allows_disabled_protocol() { equipment_test_read(0); }
#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_read_rejects_wrong_soul() { equipment_test_read(1); }
#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_read_rejects_wrong_state() { equipment_test_read(2); }
#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_read_rejects_wrong_witness_holder() { equipment_test_read(3); }
#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_read_rejects_changed_epoch() { equipment_test_read(4); }
#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_read_rejects_wrong_sender() { equipment_test_read(5); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun soul_equipment_read_rejects_wrong_protocol() { equipment_test_read(6); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun soul_equipment_read_rejects_wrong_version() { equipment_test_read(7); }
#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_read_rejects_wrong_loadout_holder() { equipment_test_read(8); }
#[test, expected_failure(abort_code = EInvalidBinding)]
fun soul_equipment_read_rejects_player_loadout() { equipment_test_read(9); }

#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::soulidity_binding_v8)]
fun soul_equipment_read_rejects_same_bytes_wrong_witness_type() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 822, 0, 0, 0);
    let (equipment, config, admin) = equipment_fixture(&mut ctx);
    let witness = SoulEquipmentOwnerClaimV8 {
        soul_id: object::id_from_address(@0x42), soul_state_id: object::id_from_address(@0x43),
        holder: ctx.sender(), ownership_epoch: 2,
    };
    assert_soul_equipment_read_v8(&equipment, &config, witness, &ctx);
    destroy_test_loadout(equipment);
    protocol::destroy_protocol_for_testing(config, admin);
    abort 110
}

#[test]
fun soul_equipment_owner_round_trip_restores_exact_binding() { equipment_test_update(0); }

#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_rejects_wrong_soul() { equipment_test_update(1); }

#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_rejects_wrong_state() { equipment_test_update(2); }

#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_rejects_wrong_witness_holder() { equipment_test_update(3); }

#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_rejects_changed_ownership_epoch() { equipment_test_update(4); }

#[test, expected_failure(abort_code = EStaleRevision)]
fun soul_equipment_rejects_stale_revision() { equipment_test_update(5); }

#[test, expected_failure(abort_code = EWrongHolder)]
fun soul_equipment_rejects_wrong_sender() { equipment_test_update(6); }

#[test, expected_failure(abort_code = EInvalidBinding)]
fun soul_equipment_rejects_restore_to_other_loadout() { equipment_test_update(7); }

#[test, expected_failure(abort_code = EEquipLocked)]
fun soul_equipment_rejects_raw_player_mutation() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 803, 0, 0, 0);
    let (loadout, config, admin) = equipment_fixture(&mut ctx);
    assert_loadout_holder_revision(&loadout, 0, &ctx);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test, expected_failure(abort_code = EEquipLocked)]
fun soul_equipment_rejects_player_transfer() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 804, 0, 0, 0);
    let (loadout, config, admin) = equipment_fixture(&mut ctx);
    transfer_maker_loadout_to_holder_v8(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test, expected_failure(abort_code = 0, location = native_binding)]
fun soul_equipment_rejects_forged_type_with_identical_bytes() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 805, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let witness = SoulEquipmentOwnerClaimV8 {
        soul_id: object::id_from_address(@0x42), soul_state_id: object::id_from_address(@0x43),
        holder: ctx.sender(), ownership_epoch: 2,
    };
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 0, witness, &ctx);
    finish_test_empty_equipment(&mut loadout, guard, &mut ctx);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test, expected_failure(abort_code = EInvalidBinding)]
fun soul_equipment_rejects_other_protocol_with_same_types() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 806, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let (other, other_config, other_admin) = equipment_fixture(&mut ctx);
    let witness = animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
        object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &other_config, 0, witness, &ctx);
    finish_test_empty_equipment(&mut loadout, guard, &mut ctx);
    destroy_test_loadout(loadout);
    destroy_test_loadout(other);
    protocol::destroy_protocol_for_testing(config, admin);
    protocol::destroy_protocol_for_testing(other_config, other_admin);
}

#[test]
fun soul_equipment_unequip_releases_actual_base_instance_lock() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 807, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let (definitions, packs, mut item) = test_owned_base_fixture(&mut ctx);
    let mut selection = test_selection(0, b"style".to_string(), SOURCE_BASE, loadout.root_id);
    selection.access_subject = object::id(&item);
    selection.source_epoch = item.ownership_epoch;
    // Seed the already-equipped state; exercise the production unlock operation.
    install_selection(&mut loadout, 0, selection);
    item.equip_lock = option::some(EquipLockV8 {
        loadout_id: object::id(&loadout), equip_revision: 1, selection_index: 0,
    });
    let witness = animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
        object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 1, witness, &ctx);
    unequip_owned_base_style_v8(&mut loadout, &mut item, 1, &ctx);
    finish_test_empty_equipment(&mut loadout, guard, &mut ctx);
    assert!(item.equip_lock.is_none() && loadout.selection_count == 0
        && loadout.revision == 2 && is_soul_equipment_v8(&loadout), 102);
    destroy_test_owned_base_fixture(definitions, packs, item);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}


#[test_only]
fun equipment_close_test(nonempty: bool) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 808, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    if (nonempty) {
        let selection = test_selection(0, b"style".to_string(), SOURCE_EXTERNAL, loadout.root_id);
        install_selection(&mut loadout, 0, selection);
    };
    let id = object::id(&loadout);
    let revision = loadout.revision;
    let witness = animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
        object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2);
    assert!(close_soul_equipment_v8(loadout, &config, revision, witness, &ctx) == id, 103);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test_only]
fun equipment_clear_entitlement_test(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 810, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let source = if (case == 1) SOURCE_PACK else if (case == 3) SOURCE_EXTERNAL else SOURCE_BASE;
    let mut selection = test_selection(0, b"style".to_string(), source, loadout.root_id);
    selection.access_subject = if (case == 2 || case == 3) object::id_from_address(@0x99)
        else loadout.maker_access_pass_id;
    selection.protected = case == 4;
    install_selection(&mut loadout, 0, selection);
    if (case == 5) clear_non_external_selection_v8(&mut loadout, 0, 1, &ctx);
    let witness = animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
        object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 1, witness, &ctx);
    clear_non_external_selection_v8(&mut loadout, 0, 1, &ctx);
    finish_test_empty_equipment(&mut loadout, guard, &mut ctx);
    assert!(loadout.selection_count == 0 && loadout.selections[0].is_none()
        && loadout.revision == 2 && is_soul_equipment_v8(&loadout), 106);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun soul_equipment_clears_base_entitlement_without_source() { equipment_clear_entitlement_test(0); }
#[test]
fun soul_equipment_clears_pack_entitlement_without_source() { equipment_clear_entitlement_test(1); }
#[test, expected_failure(abort_code = EEquipLocked)]
fun soul_equipment_clear_cannot_strand_owned_base_lock() { equipment_clear_entitlement_test(2); }
#[test, expected_failure(abort_code = EEquipLocked)]
fun soul_equipment_clear_cannot_strand_external_lock() { equipment_clear_entitlement_test(3); }
#[test]
fun soul_equipment_clears_protected_entitlement_without_decryption() { equipment_clear_entitlement_test(4); }
#[test, expected_failure(abort_code = EEquipLocked)]
fun soul_equipment_clear_rejects_raw_player_mutation() { equipment_clear_entitlement_test(5); }
#[test]
fun soul_equipment_empty_can_close() { equipment_close_test(false); }
#[test, expected_failure(abort_code = EEquipLocked)]
fun soul_equipment_nonempty_cannot_close_and_strand_items() { equipment_close_test(true); }

#[test]
fun soul_equipment_unequip_releases_actual_external_instance_lock() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 809, 0, 0, 0);
    let (mut loadout, config, admin) = equipment_fixture(&mut ctx);
    let mut item = OwnedExternalItemV8 {
        id: object::new(&mut ctx), version: VERSION,
        product_id: object::id_from_address(@0x70),
        product_content_commitment: test_hash(1), asset_content_commitment: test_hash(2),
        holder: ctx.sender(), ownership_epoch: 0, transferable: true,
        equip_lock: option::some(EquipLockV8 {
            loadout_id: object::id(&loadout), equip_revision: 1, selection_index: 0,
        }),
    };
    let mut selection = test_selection(0, b"style".to_string(), SOURCE_EXTERNAL, item.product_id);
    selection.access_subject = object::id(&item);
    install_selection(&mut loadout, 0, selection);
    let witness = animacraft_v8_core::animacraft_v8_binding::owner_for_testing(
        object::id_from_address(@0x42), object::id_from_address(@0x43), ctx.sender(), 2);
    let guard = begin_soul_equipment_update_v8(&mut loadout, &config, 1, witness, &ctx);
    unequip_external_style_v8(&mut loadout, &mut item, 1, &ctx);
    finish_test_empty_equipment(&mut loadout, guard, &mut ctx);
    assert!(item.equip_lock.is_none() && loadout.selection_count == 0
        && loadout.revision == 2 && is_soul_equipment_v8(&loadout), 104);
    prepare_owned_item_transfer(&mut item, @0xB22, &ctx);
    assert!(item.holder == @0xB22 && item.ownership_epoch == 1, 105);
    destroy_test_owned_item(item);
    destroy_test_loadout(loadout);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test_only]
fun destroy_test_owned_item(item: OwnedExternalItemV8) {
    let OwnedExternalItemV8 {
        id, version: _, product_id: _, product_content_commitment: _,
        asset_content_commitment: _, holder: _, ownership_epoch: _,
        transferable: _, equip_lock: _,
    } = item;
    id.delete();
}
