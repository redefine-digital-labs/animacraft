/// Canonical Composition, external Item admission/ownership, and independent
/// post-activation Expansion Pack state for fresh Animacraft v8.
module animacraft_v8_runtime::runtime_v8;

use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCallCapV8,
    PhysicalRoleV8,
    ProductReleaseCatalogV8,
};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8,
    ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::{Self as core_treasury, MakerAccessPassV8};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use sui::balance::{Self as balance, Balance};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_KEY_BYTES: u64 = 128;
const MAX_LOCATOR_BYTES: u64 = 512;
const MAX_PART_PROFILES: u64 = 750;
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

const BASE_ITEM_GATE_INCLUDED: u8 = 0;

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

/// Stable package lineage markers used by Core and Seal exact-role checks.
public struct RuntimeOriginalMarkerV8 has drop {}
public struct RuntimeCallableMarkerV8 has drop {}

public struct PartProfileKeyV8 has copy, drop, store { part_key: String }
public struct PackStyleKeyV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
}
public struct WalletKeyV8 has copy, drop, store { wallet: address }

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
    releases: Table<ID, PackAdmissionRecordV8>,
    semantic_releases: Table<String, ID>,
    external_admissions: Table<ID, ExternalAdmissionRecordV8>,
}

/// Same-transaction proof that the initial Runtime registry tuple is exact,
/// sealed, and has zero mutable post-activation admission rows.
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

public struct PackStyleV8 has copy, drop, store {
    index: u64,
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
    selections: vector<Option<LoadoutSelectionV8>>,
    selection_count: u64,
    commitment: vector<u8>,
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
}
public struct RuntimeReadinessCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_id: ID, root_version: u64,
    root_content_commitment: vector<u8>, definition_registry_id: ID,
    definition_profile_count: u64, definition_profile_commitment: vector<u8>,
    pack_registry_id: ID, pack_registry_revision: u64,
    pack_release_count: u64, external_admission_count: u64,
    admission_authority_id: ID, policy_commitment: vector<u8>,
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
    root_content_commitment: vector<u8>, selections: vector<Option<LoadoutSelectionV8>>,
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
public fun base_item_gate_included_v8(): u8 { BASE_ITEM_GATE_INCLUDED }
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
    ctx: &mut TxContext,
): (RuntimeDefinitionRegistryV8, PackRegistryV8, PackAdmissionAuthorityV8) {
    maker::assert_draft_admin_v8(root, admin);
    maker::assert_base_registry_identity_v8(
        root,
        base::registry_id_v8(base_registry),
        base::registry_root_id_v8(base_registry),
        base::registry_maker_version_v8(base_registry),
        base::registry_root_content_commitment_v8(base_registry),
    );
    assert!(base::registry_sealed_v8(base_registry), ENotSealed);
    assert!(expected_profile_count == base::registry_part_count_v8(base_registry), EInvalidCount);
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
    );
    assert!(&policy_commitment
        == maker::root_expected_pack_admission_policy_commitment_v8(root), EInvalidCommitment);
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
        base_registry_id: base::registry_id_v8(base_registry),
        expected_profile_count,
        observed_profile_count: 0,
        expected_profile_commitment,
        rolling_profile_commitment: empty_profile_commitment_v8(root_content_commitment),
        admission_ceiling,
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
        releases: table::new(ctx),
        semantic_releases: table::new(ctx),
        external_admissions: table::new(ctx),
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
    let part = base::borrow_part_v8(base_registry, part_key);
    assert!(base::part_key_v8(part) == &part_key, EInvalidBinding);
    assert!(base::part_sequence_v8(part)
        == base::registry_track_count_v8(base_registry) + sequence, EPartOrder);
    let required = base::part_required_v8(part);
    assert_profile_policy(
        wardrobe_mode, behavior, capacity, registry.admission_ceiling, required);
    let core_part_payload_commitment = *base::part_payload_commitment_v8(part);
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
    assert!(definitions.profiles.contains(PartProfileKeyV8 { part_key }), EMissing);
    assert_pack_style_base_references(
        definitions, base_registry, release, &part_key, &layer_track_key,
        &color_channel_key, &default_swatch_key);
    let style = PackStyleV8 {
        index: sequence,
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
    assert!(definitions.profiles.contains(PartProfileKeyV8 { part_key }), EMissing);
    assert_key(&item_key);
    assert_key(&style_key);
    assert_hash(&asset_content_commitment);
    RuntimePackRegistrationWitnessV8 {
        release_id: object::id(release),
        release_content_commitment: release.content_commitment,
        sequence,
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
        part_key,
        item_key,
        style_key,
        asset_content_commitment: witness_asset_content,
    } = witness;
    assert!(release_id == object::id(release), EInvalidBinding);
    assert!(release_content_commitment == release.content_commitment, EInvalidBinding);
    assert!(asset_content_commitment == witness_asset_content, EInvalidBinding);
    assert!(sequence == release.observed_style_count, EInvalidSequence);
    assert!(definitions.profiles.contains(PartProfileKeyV8 { part_key }), EMissing);
    assert_pack_style_base_references(
        definitions, base_registry, release, &part_key, &layer_track_key,
        &color_channel_key, &default_swatch_key);
    let style = PackStyleV8 {
        index: sequence,
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
/// post-activation Pack policy. The exact Physical call capability and marker
/// origins prevent another package from turning Pack IDs into policy rows.
public fun new_physical_pack_policy_witness_v8<
    PaymentCoin,
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: &PackageCallCapV8<PhysicalRoleV8>,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_admin: &PackAdminCapV8,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    part_key: String,
    item_key: String,
    style_key: String,
    ctx: &TxContext,
): RuntimePhysicalPackPolicyWitnessV8 {
    assert_physical_caller<
        PaymentCoin,
        PhysicalOriginalMarker,
        PhysicalCallableMarker,
    >(root, catalog, physical_call_cap, packs);
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
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: &PackageCallCapV8<PhysicalRoleV8>,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    loadout: &MakerLoadoutV8,
    selection_index: u64,
    ctx: &TxContext,
): RuntimePhysicalPackAccessWitnessV8 {
    assert_physical_caller<
        PaymentCoin,
        PhysicalOriginalMarker,
        PhysicalCallableMarker,
    >(root, catalog, physical_call_cap, packs);
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

/// Physical consumes the policy witness under the same exact call capability.
public fun consume_physical_pack_policy_witness_v8<
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
>(
    witness: RuntimePhysicalPackPolicyWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: &PackageCallCapV8<PhysicalRoleV8>,
): (
    ID, u64, vector<u8>, ID, u64, ID, String, vector<u8>, address, u64,
    ID, ID, u64, String, String, String, String, Option<String>,
    Option<String>, String, vector<u8>, vector<u8>, bool, vector<u8>,
    vector<u8>, vector<u8>,
) {
    binding::assert_physical_call_cap_v8(catalog, physical_call_cap);
    binding::assert_type_origins_v8<PhysicalOriginalMarker, PhysicalCallableMarker>(
        binding::physical_binding_v8(binding::catalog_binding_v8(catalog)),
    );
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

/// Physical consumes the live Pack access witness under the same exact cap.
public fun consume_physical_pack_access_witness_v8<
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
>(
    witness: RuntimePhysicalPackAccessWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: &PackageCallCapV8<PhysicalRoleV8>,
): (
    ID, u64, vector<u8>, address, ID, u64, ID, String, vector<u8>, ID,
    ID, vector<u8>, ID, u64, vector<u8>, u64, vector<u8>, vector<u8>,
    String, String, String, String, vector<u8>, vector<u8>,
) {
    binding::assert_physical_call_cap_v8(catalog, physical_call_cap);
    binding::assert_type_origins_v8<PhysicalOriginalMarker, PhysicalCallableMarker>(
        binding::physical_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    let RuntimePhysicalPackAccessWitnessV8 {
        root_id, root_version, root_content_commitment, holder,
        pack_registry_id, pack_registry_revision, release_id,
        semantic_pack_id, release_content_commitment, pack_treasury_id,
        pack_pass_id, pack_pass_commitment, loadout_id, loadout_revision,
        loadout_commitment, selection_index, selection_commitment,
        pricing_commitment, part_key, item_key, style_key, layer_track_key,
        asset_content_commitment, style_identity_commitment,
    } = witness;
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

/// Package-private mutation reached only after runtime_binding_v8 consumes
/// Core's exact no-ability OutputRuntimeRequestV8 in the same transaction.
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
/// abilities and can only be created after Core's exact Output request was
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
    let _track = base::borrow_track_v8(base_registry, layer_track_key);
    assert_color_pair(&color_channel_key, &default_swatch_key);
    if (color_channel_key.is_some()) {
        let _color = base::borrow_color_v8(
            base_registry,
            *color_channel_key.borrow(),
            *default_swatch_key.borrow(),
        );
    };
    assert_locator(&asset_blob_id);
    assert_hash(&asset_sha256);
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

public fun create_maker_loadout_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    maker_access: &MakerAccessPassV8,
    ctx: &mut TxContext,
): MakerLoadoutV8 {
    assert_root_active(root);
    assert_definition_identity(definitions, root);
    assert!(definitions.sealed, ENotSealed);
    assert_pack_registry_identity(packs, definitions, root);
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    let mut selections = vector[];
    let mut i = 0;
    while (i < definitions.expected_profile_count) {
        selections.push_back(option::none());
        i = i + 1;
    };
    let commitment = canonical_loadout_commitment(
        definitions.root_id,
        definitions.root_version,
        definitions.root_content_commitment,
        &selections,
    );
    MakerLoadoutV8 {
        id: object::new(ctx),
        version: VERSION,
        root_id: definitions.root_id,
        root_version: definitions.root_version,
        root_content_commitment: definitions.root_content_commitment,
        definition_registry_id: object::id(definitions),
        pack_registry_id: object::id(packs),
        maker_access_pass_id: core_treasury::maker_access_pass_id_v8(maker_access),
        maker_access_commitment: maker_access_entitlement_commitment_v8(maker_access),
        holder: ctx.sender(),
        revision: 0,
        selections,
        selection_count: 0,
        commitment,
    }
}

public fun transfer_maker_loadout_to_holder_v8(loadout: MakerLoadoutV8) {
    let holder = loadout.holder;
    transfer::transfer(loadout, holder)
}

public fun select_base_style_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    swatch_key: Option<String>,
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_definition_binding(definitions, root, base_registry);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key });
    assert_slot_empty(loadout, profile.index);
    let item = base::borrow_item_v8(base_registry, part_key, item_key);
    assert!(base::item_gate_kind_v8(item) == BASE_ITEM_GATE_INCLUDED, EInvalidPolicy);
    let style = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
    let layer_track_key = *base::style_layer_track_key_v8(style);
    let _track = base::borrow_track_v8(base_registry, layer_track_key);
    let color_channel_key = *base::style_color_channel_key_v8(style);
    let selected_swatch = exact_selected_swatch(
        base_registry,
        &color_channel_key,
        swatch_key,
    );
    let selection = LoadoutSelectionV8 {
        selection_index: profile.index,
        part_key,
        item_key,
        style_key,
        color_channel_key,
        swatch_key: selected_swatch,
        layer_track_key,
        asset_blob_id: *base::style_asset_blob_id_v8(style),
        asset_sha256: *base::style_asset_sha256_v8(style),
        asset_content_commitment: *base::style_payload_commitment_v8(style),
        source_class: SOURCE_BASE,
        source_definition_id: loadout.root_id,
        source_semantic_id: b"".to_string(),
        access_subject: loadout.maker_access_pass_id,
        source_epoch: 0,
        pricing_commitment: loadout.maker_access_commitment,
        protected: base::style_protected_v8(style),
        seal_binding_commitment: vector[],
    };
    // Fail closed until the exact Seal certificate is present.
    assert!(!selection.protected, ENotReady);
    install_selection(loadout, profile.index, selection);
}

public(package) fun select_protected_base_style_after_seal_v8<PaymentCoin>(
    loadout: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_access: &MakerAccessPassV8,
    expected_revision: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    swatch_key: Option<String>,
    seal_binding_commitment: vector<u8>,
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_definition_binding(definitions, root, base_registry);
    assert_hash(&seal_binding_commitment);
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key });
    assert_slot_empty(loadout, profile.index);
    let item = base::borrow_item_v8(base_registry, part_key, item_key);
    assert!(base::item_gate_kind_v8(item) == BASE_ITEM_GATE_INCLUDED, EInvalidPolicy);
    let style = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
    assert!(base::style_protected_v8(style), EInvalidProof);
    let layer_track_key = *base::style_layer_track_key_v8(style);
    let _track = base::borrow_track_v8(base_registry, layer_track_key);
    let color_channel_key = *base::style_color_channel_key_v8(style);
    let selected_swatch = exact_selected_swatch(base_registry, &color_channel_key, swatch_key);
    let selection = LoadoutSelectionV8 {
        selection_index: profile.index,
        part_key,
        item_key,
        style_key,
        color_channel_key,
        swatch_key: selected_swatch,
        layer_track_key,
        asset_blob_id: *base::style_asset_blob_id_v8(style),
        asset_sha256: *base::style_asset_sha256_v8(style),
        asset_content_commitment: *base::style_payload_commitment_v8(style),
        source_class: SOURCE_BASE,
        source_definition_id: loadout.root_id,
        source_semantic_id: b"".to_string(),
        access_subject: loadout.maker_access_pass_id,
        source_epoch: 0,
        pricing_commitment: loadout.maker_access_commitment,
        protected: true,
        seal_binding_commitment,
    };
    install_selection(loadout, profile.index, selection);
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
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key });
    assert_slot_empty(loadout, profile.index);
    let style = release.styles.borrow(PackStyleKeyV8 { part_key, item_key, style_key });
    assert_definition_binding(definitions, root, base_registry);
    let selected_swatch = exact_pack_swatch(base_registry, style, swatch_key);
    let pricing_commitment = pack_pricing_commitment(release);
    let selection = LoadoutSelectionV8 {
        selection_index: profile.index,
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
    install_selection(loadout, profile.index, selection);
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
    ctx: &TxContext,
) {
    assert_loadout_write(loadout, root, definitions, packs, expected_revision, ctx);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert_external_access(packs, product, item, ctx.sender());
    let profile = definitions.profiles.borrow(PartProfileKeyV8 { part_key: product.part_key });
    assert!(profile.wardrobe_mode == WARDROBE_SLOT, EFixedPart);
    assert_external_profile_behavior(profile);
    assert_slot_empty(loadout, profile.index);
    assert!(item.equip_lock.is_none(), EEquipLocked);
    let next_revision = loadout.revision + 1;
    let selection = LoadoutSelectionV8 {
        selection_index: profile.index,
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
    install_selection(loadout, profile.index, selection);
    item.equip_lock = option::some(EquipLockV8 {
        loadout_id: object::id(loadout),
        equip_revision: next_revision,
        selection_index: profile.index,
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
    let lock = item.equip_lock.destroy_some();
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
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.base_registry_id == base::registry_id_v8(base_registry), EInvalidBinding);
    assert!(base::registry_root_id_v8(base_registry) == loadout.root_id, EInvalidBinding);
    assert!(base::registry_maker_version_v8(base_registry) == loadout.root_version, EInvalidBinding);
    assert!(base::registry_root_content_commitment_v8(base_registry)
        == &loadout.root_content_commitment, EInvalidBinding);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE, EInvalidProof);
    assert!(selection.access_subject == loadout.maker_access_pass_id, EInvalidProof);
    assert!(selection.pricing_commitment == loadout.maker_access_commitment, EInvalidProof);
    let item = base::borrow_item_v8(
        base_registry, selection.part_key, selection.item_key);
    assert!(base::item_gate_kind_v8(item) == BASE_ITEM_GATE_INCLUDED, EInvalidPolicy);
    let style = base::borrow_style_v8(
        base_registry, selection.part_key, selection.item_key, selection.style_key,
    );
    assert!(base::style_layer_track_key_v8(style) == &selection.layer_track_key, EInvalidProof);
    assert!(base::style_asset_blob_id_v8(style) == &selection.asset_blob_id, EInvalidProof);
    assert!(base::style_asset_sha256_v8(style) == &selection.asset_sha256, EInvalidProof);
    assert!(base::style_payload_commitment_v8(style) == &selection.asset_content_commitment, EInvalidProof);
    assert!(!selection.protected && !base::style_protected_v8(style), ENotReady);
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
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert_loadout_maker_access(loadout, root, maker_access, ctx);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.base_registry_id == base::registry_id_v8(base_registry), EInvalidBinding);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE && selection.protected, EInvalidProof);
    assert!(selection.access_subject == loadout.maker_access_pass_id, EInvalidProof);
    assert!(selection.pricing_commitment == loadout.maker_access_commitment, EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    let item = base::borrow_item_v8(
        base_registry, selection.part_key, selection.item_key);
    assert!(base::item_gate_kind_v8(item) == BASE_ITEM_GATE_INCLUDED, EInvalidPolicy);
    let style = base::borrow_style_v8(
        base_registry, selection.part_key, selection.item_key, selection.style_key);
    assert!(base::style_protected_v8(style), EInvalidProof);
    assert!(base::style_layer_track_key_v8(style) == &selection.layer_track_key, EInvalidProof);
    assert!(base::style_asset_blob_id_v8(style) == &selection.asset_blob_id, EInvalidProof);
    assert!(base::style_asset_sha256_v8(style) == &selection.asset_sha256, EInvalidProof);
    assert!(base::style_payload_commitment_v8(style) == &selection.asset_content_commitment, EInvalidProof);
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
    core_treasury::assert_maker_access_pass_v8(root, maker_access, ctx.sender());
    assert!(loadout.maker_access_pass_id
        == core_treasury::maker_access_pass_id_v8(maker_access), EInvalidProof);
    assert!(loadout.maker_access_commitment
        == maker_access_entitlement_commitment_v8(maker_access), EInvalidProof);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.base_registry_id == base::registry_id_v8(base_registry), EInvalidBinding);
    assert_root_compatibility(loadout.root_id, loadout.root_version,
        &loadout.root_content_commitment, root);
    let selection = loadout.selections.borrow(selection_index).borrow();
    assert!(selection.source_class == SOURCE_BASE && selection.protected, EInvalidProof);
    assert!(selection.access_subject == loadout.maker_access_pass_id, EInvalidProof);
    assert!(selection.pricing_commitment == loadout.maker_access_commitment, EInvalidProof);
    assert!(selection.seal_binding_commitment == seal_binding_commitment, EInvalidProof);
    let item = base::borrow_item_v8(
        base_registry, selection.part_key, selection.item_key);
    assert!(base::item_gate_kind_v8(item) == BASE_ITEM_GATE_INCLUDED, EInvalidPolicy);
    let style = base::borrow_style_v8(
        base_registry, selection.part_key, selection.item_key, selection.style_key);
    assert!(base::style_protected_v8(style), EInvalidProof);
    assert!(base::style_payload_commitment_v8(style) == &selection.asset_content_commitment,
        EInvalidProof);
    RuntimeBaseEntitlementWitnessV8 {
        loadout_id: object::id(loadout),
        loadout_revision: loadout.revision,
        selection_index,
        holder: ctx.sender(),
        entitlement_id: core_treasury::maker_access_pass_id_v8(maker_access),
        entitlement_commitment: maker_access_entitlement_commitment_v8(maker_access),
        asset_content_commitment: selection.asset_content_commitment,
    }
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
    mut proofs: vector<SelectionAccessProofV8>,
    ctx: &TxContext,
): RuntimeLoadoutAuthorizationV8 {
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.definition_registry_id == object::id(definitions), EInvalidBinding);
    assert!(definitions.sealed, ENotSealed);
    assert!(proofs.length() == loadout.selection_count, EProofOrder);
    proofs.reverse();
    let mut ordered_selection_commitments = vector[];
    let mut ordered_pricing_commitments = vector[];
    let mut used_packs = vector[];
    let mut selection_index = 0;
    while (selection_index < loadout.selections.length()) {
        let maybe_selection = loadout.selections.borrow(selection_index);
        let profile = definitions.profiles.borrow(PartProfileKeyV8 {
            part_key: *definitions.profile_keys.borrow(selection_index),
        });
        if (profile.required) {
            assert!(maybe_selection.is_some(), ERequiredPart);
        };
        if (maybe_selection.is_some()) {
            let selection = maybe_selection.borrow();
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
        pass_id: core_treasury::maker_access_pass_id_v8(pass),
        root_id: core_treasury::maker_access_pass_root_id_v8(pass),
        maker_version: core_treasury::maker_access_pass_maker_version_v8(pass),
        root_content_commitment:
            *core_treasury::maker_access_pass_root_content_commitment_v8(pass),
        holder: core_treasury::maker_access_pass_holder_v8(pass),
        paid_atomic: core_treasury::maker_access_pass_paid_atomic_v8(pass),
        issued_at_ms: core_treasury::maker_access_pass_issued_at_ms_v8(pass),
    }))
}
public fun loadout_id_v8(loadout: &MakerLoadoutV8): ID { object::id(loadout) }
public fun loadout_revision_v8(loadout: &MakerLoadoutV8): u64 { loadout.revision }
public fun loadout_commitment_v8(loadout: &MakerLoadoutV8): &vector<u8> { &loadout.commitment }
public fun loadout_selection_count_v8(loadout: &MakerLoadoutV8): u64 { loadout.selection_count }
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

fun recompute_loadout(loadout: &mut MakerLoadoutV8) {
    loadout.commitment = canonical_loadout_commitment(
        loadout.root_id,
        loadout.root_version,
        loadout.root_content_commitment,
        &loadout.selections,
    );
}

fun canonical_loadout_commitment(
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    selections: &vector<Option<LoadoutSelectionV8>>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&LoadoutCommitmentInputV8 {
        domain: b"animacraft-v8/runtime/current-loadout",
        version: VERSION,
        root_id,
        root_version,
        root_content_commitment,
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
        let _color = base::borrow_color_v8(base_registry, *channel.borrow(), *swatch.borrow());
    };
    swatch
}

fun exact_pack_swatch(
    base_registry: &BaseDefinitionRegistryV8,
    style: &PackStyleV8,
    swatch: Option<String>,
): Option<String> {
    assert!(style.color_channel_key.is_some() == swatch.is_some(), EInvalidBinding);
    if (swatch.is_some()) {
        let _color = base::borrow_color_v8(
            base_registry, *style.color_channel_key.borrow(), *swatch.borrow());
    };
    swatch
}

fun assert_pack_style_base_references<PaymentCoin>(
    definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    part_key: &String,
    layer_track_key: &String,
    color_channel_key: &Option<String>,
    default_swatch_key: &Option<String>,
) {
    assert!(definitions.base_registry_id == base::registry_id_v8(base_registry), EInvalidBinding);
    assert!(base::registry_root_id_v8(base_registry) == release.root_id, EInvalidBinding);
    assert!(base::registry_maker_version_v8(base_registry) == release.root_version, EInvalidBinding);
    assert!(base::registry_root_content_commitment_v8(base_registry)
        == &release.root_content_commitment, EInvalidBinding);
    let _part = base::borrow_part_v8(base_registry, *part_key);
    let _track = base::borrow_track_v8(base_registry, *layer_track_key);
    assert_color_pair(color_channel_key, default_swatch_key);
    if (color_channel_key.is_some()) {
        let _color = base::borrow_color_v8(
            base_registry, *color_channel_key.borrow(), *default_swatch_key.borrow());
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
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: &PackageCallCapV8<PhysicalRoleV8>,
    packs: &PackRegistryV8,
) {
    binding::assert_physical_call_cap_v8(catalog, physical_call_cap);
    binding::assert_type_origins_v8<PhysicalOriginalMarker, PhysicalCallableMarker>(
        binding::physical_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    maker::assert_active_capability_registry_v8(root);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(
        maker::capability_catalog_id_v8(capability) == binding::catalog_id_v8(catalog),
        EInvalidBinding,
    );
    assert!(
        maker::capability_pack_registry_id_v8(capability) == object::id(packs),
        EInvalidBinding,
    );
    assert!(packs.version == VERSION, EInvalidBinding);
    maker::assert_root_identity_v8(
        root,
        packs.root_id,
        packs.root_version,
        &packs.root_content_commitment,
    );
    let admission = maker::root_pack_admission_binding_v8(root);
    assert!(
        maker::pack_registry_id_v8(admission) == object::id(packs),
        EInvalidBinding,
    );
    assert!(
        &packs.admission_policy_commitment
            == maker::pack_admission_policy_commitment_v8(admission),
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
        == core_treasury::maker_access_pass_id_v8(maker_access), EInvalidProof);
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
    assert!(registry.base_registry_id == base::registry_id_v8(base_registry), EInvalidBinding);
    assert!(base::registry_root_id_v8(base_registry) == registry.root_id, EInvalidBinding);
    assert!(base::registry_maker_version_v8(base_registry) == registry.root_version, EInvalidBinding);
    assert!(base::registry_root_content_commitment_v8(base_registry)
        == &registry.root_content_commitment, EInvalidBinding);
    assert!(base::registry_sealed_v8(base_registry), ENotSealed);
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
        == maker::root_expected_pack_admission_policy_commitment_v8(root), EInvalidBinding);
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
    assert!(loadout.version == VERSION, EInvalidBinding);
    assert!(loadout.holder == ctx.sender(), EWrongHolder);
    assert!(loadout.revision == expected_revision, EStaleRevision);
}

fun assert_slot_empty(loadout: &MakerLoadoutV8, index: u64) {
    assert!(index < loadout.selections.length(), EPartOrder);
    assert!(loadout.selections.borrow(index).is_none(), EDuplicate);
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
    assert!(capacity == 1, EInvalidPolicy);
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

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun profile_rejects_multi_selection_capacity() {
    assert_profile_policy(WARDROBE_SLOT, BEHAVIOR_HYBRID, 2, ADMISSION_OPEN, false);
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
        base_registry_id: maker::root_base_registry_id_v8(root),
        expected_profile_count: 0,
        observed_profile_count: 0,
        expected_profile_commitment: test_hash(70),
        rolling_profile_commitment: test_hash(70),
        admission_ceiling: ADMISSION_DISABLED,
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
            *maker::root_expected_pack_admission_policy_commitment_v8(root),
        revision: 0,
        release_count: 0,
        external_admission_count: 0,
        releases: table::new(ctx),
        semantic_releases: table::new(ctx),
        external_admissions: table::new(ctx),
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
    let loadout_commitment = canonical_loadout_commitment(
        packs.root_id,
        packs.root_version,
        packs.root_content_commitment,
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
        release_count: _, external_admission_count: _, releases,
        semantic_releases, external_admissions } = packs;
    releases.destroy_empty();
    semantic_releases.destroy_empty();
    external_admissions.destroy_empty();
    pack_uid.delete();
    let RuntimeDefinitionRegistryV8 { id: definition_uid, version: _, root_id: _,
        root_version: _, root_content_commitment: _, base_registry_id: _,
        expected_profile_count: _, observed_profile_count: _,
        expected_profile_commitment: _, rolling_profile_commitment: _,
        admission_ceiling: _, sealed: _, profile_keys: _, profiles } = definitions;
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
fun test_loadout(ctx: &mut TxContext): MakerLoadoutV8 {
    let root_id = object::id_from_address(@0x11);
    let selections = vector[option::none()];
    let commitment = canonical_loadout_commitment(root_id, 1, test_hash(9), &selections);
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
        selections,
        selection_count: 0,
        commitment,
    }
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
fun destroy_test_loadout(loadout: MakerLoadoutV8) {
    let MakerLoadoutV8 {
        id, version: _, root_id: _, root_version: _, root_content_commitment: _,
        definition_registry_id: _, pack_registry_id: _, maker_access_pass_id: _,
        maker_access_commitment: _, holder: _, revision: _,
        selections: _, selection_count: _, commitment: _,
    } = loadout;
    id.delete();
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
