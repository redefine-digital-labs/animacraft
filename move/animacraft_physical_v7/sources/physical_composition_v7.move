/// Additive physical composition for Animacraft.
///
/// v6 introduced composable definitions and entitlement/lock semantics. v7
/// makes the concrete visual Style a physical Sui object and gives every Soul
/// a shared, Soul-bound wardrobe that truly owns deposited assets. StyleAssetV7
/// is deliberately `key`-only and is defined in this same module as
/// SoulWardrobeV7: only these audited entry points can transfer or receive it.
/// Smart Color is intentionally absent from every v7 type.
module animacraft_physical_v7::physical_composition_v7;

use animacraft::animacraft::{Self as legacy, ProtocolFeeAdminCap, RecipeSlot};
use animacraft::commerce_v5::{
    Self as commerce,
    CommerceProtocolConfigV5,
    MakerControlCapV5,
    MakerRootV5,
    StyleSelectionV5,
};
use animacraft::composition_v6::{
    Self as composition,
    CompositionAdminCapV6,
    CompositionProtocolConfigV6,
    CompositionProtocolTreasuryV6,
    CompositionRegistryV6,
    ItemProductV6,
    MakerProfileV6,
    OwnedItemV6,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use std::type_name;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;
use sui::table::{Self as table, Table};
use sui::transfer::{Self as transfer, Receiving};

const VERSION: u64 = 7;
const HASH_LENGTH: u64 = 32;
const MAX_DEFINITION_IDENTIFIER_BYTES: u64 = 512;

/// Part behavior. Fixed may receive one official Soul-local Style only during
/// the staged initial mint and is immutable afterwards. Soul-local accepts
/// included objects only; Open accepts wallet-owned objects only; Hybrid
/// accepts both.
const PART_FIXED: u8 = 0;
const PART_SOUL_LOCAL: u8 = 1;
const PART_OPEN: u8 = 2;
const PART_HYBRID: u8 = 3;

const SOURCE_OFFICIAL: u8 = 0;
const SOURCE_CERTIFIED: u8 = 1;
const SOURCE_OPEN: u8 = 2;

const SUPPLY_SOUL_LOCAL_INCLUDED: u8 = 0;
const SUPPLY_OPEN_EDITION: u8 = 1;
const SUPPLY_LIMITED_EDITION: u8 = 2;

const ASSET_SOUL_LOCAL: u8 = 0;
const ASSET_OWNED: u8 = 1;

/// Explicit acquisition boundary. Included content is either Base or an
/// exact v5 Pack row; independently supplied products are wallet-owned and
/// settle through v6 before v7 materialization.
const ENTITLEMENT_BASE_INCLUDED: u8 = 0;
const ENTITLEMENT_WALLET_FREE: u8 = 1;
const ENTITLEMENT_WALLET_PAID: u8 = 2;
const ENTITLEMENT_PACK_INCLUDED: u8 = 3;

const EInvalidAdmin: u64 = 0;
const EProtocolDisabled: u64 = 1;
const EProtocolMismatch: u64 = 2;
const EDependencyMissing: u64 = 3;
const EOwnerProofMismatch: u64 = 4;
const EListingProofMismatch: u64 = 5;
const EAlreadyBound: u64 = 7;
const EProfileExists: u64 = 8;
const EProfileNotComposable: u64 = 9;
const EProfileNotSealed: u64 = 10;
const EProfileAlreadySealed: u64 = 11;
const EInvalidPartPolicy: u64 = 12;
const EPartPolicyExists: u64 = 13;
const EPartPolicyMissing: u64 = 14;
const ENoPartPolicies: u64 = 15;
const EFamilyAlreadyExists: u64 = 16;
const EProductAlreadyExists: u64 = 17;
const EProductNotAdmitted: u64 = 18;
const EFamilyMismatch: u64 = 19;
const EInvalidCommitment: u64 = 20;
const EInvalidString: u64 = 21;
const EInvalidSupply: u64 = 22;
const ESoldOut: u64 = 23;
const EStyleInactive: u64 = 24;
const ENotStyleCreator: u64 = 25;
const EInvalidBinding: u64 = 26;
const EInvalidSoul: u64 = 27;
const EWardrobeExists: u64 = 28;
const EWardrobeListed: u64 = 29;
const EStaleRevision: u64 = 30;
const EAssetMismatch: u64 = 31;
const ENotAssetHolder: u64 = 32;
const EAssetAlreadyDeposited: u64 = 33;
const EAssetNotDeposited: u64 = 34;
const EAssetAlreadyEquipped: u64 = 35;
const EAssetNotEquipped: u64 = 36;
const ESlotOccupied: u64 = 37;
const EWrongSlot: u64 = 38;
const EFixedPart: u64 = 39;
const ESourceForbidden: u64 = 40;
const ERequiredPart: u64 = 41;
const ERuleViolation: u64 = 42;
const ESoulLocalWithdrawal: u64 = 43;
const EExternalAssetsRemain: u64 = 44;
const EInvalidRecipient: u64 = 45;
const EIncludedStyleAlreadyClaimed: u64 = 46;
const EWrongAccessKind: u64 = 47;
const EWrongProduct: u64 = 48;
const EWrongReceivingAsset: u64 = 49;
const ERequiredPartEmpty: u64 = 50;
const EFreeStyleAlreadyClaimed: u64 = 51;
const EWardrobeNotInitialized: u64 = 52;
const EInitialSelectionEmpty: u64 = 53;
const EStyleNotTransferable: u64 = 54;
const EInitialAuthorizationMismatch: u64 = 55;
const EInitialAuthorizationNotSealed: u64 = 56;
const EDuplicateInitialProduct: u64 = 57;
const EEntitlementMissing: u64 = 58;
const ELogicalStyleExpected: u64 = 59;

public struct PhysicalProtocolConfigV7 has key {
    id: UID,
    version: u64,
    v6_config_id: ID,
    v5_config_id: ID,
    v6_admin_cap_id: ID,
    registry_id: ID,
    soul_owner_proof_type: String,
    listing_proof_type: Option<String>,
    enabled: bool,
}

public struct PhysicalAdminCapV7 has key {
    id: UID,
    version: u64,
    config_id: ID,
}

public struct PhysicalRegistryV7 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profiles: Table<ID, ID>,
    family_seed_products: Table<ID, ID>,
    style_products: Table<ID, ID>,
    wardrobes: Table<ID, ID>,
    /// Permanent replay protection for one-free-claim-per-wallet products.
    /// v6 wallet entitlements are consumed by the v7 materialization bridge,
    /// so the claim receipt must live independently in v7.
    free_style_claims: Table<FreeStyleClaimKeyV7, bool>,
    family_count: u64,
    product_count: u64,
    wardrobe_count: u64,
}

public struct FreeStyleClaimKeyV7 has copy, drop, store {
    style_product_id: ID,
    wallet: address,
}

public struct PartPolicyKeyV7 has copy, drop, store {
    slot_key: String,
}

public struct PartPolicyV7 has copy, drop, store {
    slot_key: String,
    behavior: u8,
    required: bool,
    max_source_kind: u8,
}

public struct MakerPhysicalProfileV7 has key {
    id: UID,
    version: u64,
    config_id: ID,
    v6_profile_id: ID,
    root_id: ID,
    slot_schema_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    part_policies: Table<PartPolicyKeyV7, PartPolicyV7>,
    required_slot_keys: vector<String>,
    part_policy_count: u64,
    sealed: bool,
}

/// ItemFamily is the broad commercial family (for example "Classic Long
/// Hair"). It is immutable and groups exact products. The exact color/cut is
/// never represented by a Smart Color channel; it is a StyleProduct below.
public struct ItemFamilyV7 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profile_id: ID,
    seed_v6_product_id: ID,
    creator: address,
    slot_key: String,
    family_key: String,
    label: String,
    family_commitment: vector<u8>,
    rights_origin: u8,
}

/// Concrete color/cut/product definition. Definition fields are immutable
/// after sharing; only active and minted_supply change. Primary price and split
/// are copied from its v6 product, whose purchase path performs settlement.
public struct StyleProductV7 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profile_id: ID,
    /// The immutable v6 profile whose commerce admission and settlement path
    /// backs this concrete product. This is deliberately distinct from the v7
    /// physical profile ID above.
    v6_profile_id: ID,
    family_id: ID,
    v6_product_id: ID,
    original_creator: address,
    slot_key: String,
    style_key: String,
    /// Exact legacy/v5 RecipeSlot Item identity. It may differ across Styles
    /// grouped under one stable v7 family_key because v5 flattened rows.
    recipe_item_key: String,
    label: String,
    source_kind: u8,
    entitlement_kind: u8,
    /// Exact immutable v5 Pack identity for a Pack-included Style. None means
    /// Base or an independently sold wallet-owned Style.
    pack_key: Option<String>,
    supply_kind: u8,
    max_supply: u64,
    minted_supply: u64,
    price_atomic: u64,
    protocol_fee_bps: u16,
    maker_ecosystem_fee_bps: u16,
    transferable: bool,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
    /// Immutable Walrus locator for the canonical v6 definition bytes. Many
    /// official definitions may share one Quilt Blob and use distinct
    /// identifiers; standalone external Blobs use an empty identifier.
    definition_blob_id: String,
    definition_identifier: String,
    /// Immutable Walrus locator for the exact PNG referenced by the one
    /// component in the canonical definition. Renderer verifies its raw
    /// SHA-256 against definition.component.assetHash.
    asset_blob_id: String,
    asset_identifier: String,
    renderer_commitment: vector<u8>,
    required_v6_product_ids: vector<ID>,
    excluded_v6_product_ids: vector<ID>,
    active: bool,
}

/// Concrete asset instance. No `store` ability is intentional: arbitrary
/// wallets, Kiosks and other packages cannot bypass custody or settlement.
public struct StyleAssetV7 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profile_id: ID,
    family_id: ID,
    style_product_id: ID,
    v6_product_id: ID,
    original_creator: address,
    slot_key: String,
    source_kind: u8,
    asset_kind: u8,
    serial: u64,
    transferable: bool,
    holder: address,
    bound_soul_id: Option<ID>,
    ownership_epoch: u64,
    required_v6_product_ids: vector<ID>,
    excluded_v6_product_ids: vector<ID>,
}

public struct CustodyRecordV7 has copy, drop, store {
    style_product_id: ID,
    family_id: ID,
    v6_product_id: ID,
    slot_key: String,
    source_kind: u8,
    asset_kind: u8,
    /// Mirrors the child object's binding while it is owned by this wardrobe.
    /// This makes indexers able to verify custody without trusting UI state.
    bound_soul_id: Option<ID>,
    equipped: bool,
    required_v6_product_ids: vector<ID>,
    excluded_v6_product_ids: vector<ID>,
}

/// Non-storable, non-droppable staged proof that exact v7 StyleProduct IDs
/// resolve to the canonical v5 Complete recipe/style-selection hash. Anyone
/// may assemble it, but only Soulidity can consume it into a wardrobe because
/// wardrobe creation also requires Soulidity's private OwnerProof and the
/// authenticated recipe hash obtained from CommerceV5SoulMintAuthorization.
public struct InitialPhysicalLoadoutAuthorizationV7 {
    version: u64,
    config_id: ID,
    profile_id: ID,
    v6_profile_id: ID,
    root_id: ID,
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
    style_selections: vector<StyleSelectionV5>,
    /// Recipe indices that produce physical PNG children. Logical None/Color
    /// rows stay in style_selections for the complete v5 hash but never mint a
    /// sentinel object.
    visual_recipe_indices: vector<u64>,
    style_product_ids: vector<ID>,
    authorization_commitment: vector<u8>,
    sealed: bool,
}

public struct InitialPhysicalAuthorizationHashInputV7 has copy, drop, store {
    version: u64,
    config_id: ID,
    profile_id: ID,
    v6_profile_id: ID,
    root_id: ID,
    recipe_hash: vector<u8>,
    visual_recipe_indices: vector<u64>,
    style_product_ids: vector<ID>,
}

/// Shared companion bound to one Soul ID. StyleAsset children are actually
/// object-owned by this object's UID. The tables are an enumerable canonical
/// index; Receiving<StyleAssetV7> proves the corresponding child still exists.
public struct SoulWardrobeV7 has key {
    id: UID,
    version: u64,
    config_id: ID,
    profile_id: ID,
    root_id: ID,
    soul_id: ID,
    slot_schema_commitment: vector<u8>,
    revision: u64,
    initialized: bool,
    listed: bool,
    inventory: Table<ID, CustodyRecordV7>,
    claimed_included_products: Table<ID, ID>,
    equipped_by_slot: Table<PartPolicyKeyV7, ID>,
    equipped_asset_ids: vector<ID>,
    initial_product_by_slot: Table<PartPolicyKeyV7, ID>,
    authorized_initial_style_product_ids: vector<ID>,
    initial_recipe_hash: vector<u8>,
    initial_authorization_commitment: vector<u8>,
    initial_style_product_ids: vector<ID>,
    initial_asset_ids: vector<ID>,
    external_asset_count: u64,
    soul_local_asset_count: u64,
    equipped_count: u64,
}

public struct PhysicalProtocolInitializedV7 has copy, drop {
    config_id: ID,
    registry_id: ID,
    owner_proof_type: String,
}

public struct PartPolicyRegisteredV7 has copy, drop {
    profile_id: ID,
    slot_key: String,
    behavior: u8,
    required: bool,
    max_source_kind: u8,
}

public struct ItemFamilyPublishedV7 has copy, drop {
    family_id: ID,
    profile_id: ID,
    seed_v6_product_id: ID,
    creator: address,
    slot_key: String,
}

public struct StyleProductPublishedV7 has copy, drop {
    style_product_id: ID,
    family_id: ID,
    v6_product_id: ID,
    original_creator: address,
    recipe_item_key: String,
    supply_kind: u8,
    max_supply: u64,
    definition_blob_id: String,
    definition_identifier: String,
    asset_blob_id: String,
    asset_identifier: String,
    definition_commitment: vector<u8>,
    asset_commitment: vector<u8>,
}

public struct SoulWardrobeCreatedV7 has copy, drop {
    wardrobe_id: ID,
    soul_id: ID,
    profile_id: ID,
    initial_recipe_hash: vector<u8>,
    initial_authorization_commitment: vector<u8>,
}

public struct SoulWardrobeFinalizedV7 has copy, drop {
    wardrobe_id: ID,
    soul_id: ID,
    revision: u64,
    initial_style_count: u64,
}

public struct StyleAssetMaterializedV7 has copy, drop {
    asset_id: ID,
    style_product_id: ID,
    asset_kind: u8,
    serial: u64,
    soul_id: Option<ID>,
}

public struct WardrobeMutationV7 has copy, drop {
    wardrobe_id: ID,
    soul_id: ID,
    asset_id: ID,
    slot_key: String,
    operation: u8,
    revision: u64,
}

public fun physical_protocol_version_v7(): u64 { VERSION }
public fun part_fixed_v7(): u8 { PART_FIXED }
public fun part_soul_local_v7(): u8 { PART_SOUL_LOCAL }
public fun part_open_v7(): u8 { PART_OPEN }
public fun part_hybrid_v7(): u8 { PART_HYBRID }
public fun supply_soul_local_included_v7(): u8 { SUPPLY_SOUL_LOCAL_INCLUDED }
public fun supply_open_edition_v7(): u8 { SUPPLY_OPEN_EDITION }
public fun supply_limited_edition_v7(): u8 { SUPPLY_LIMITED_EDITION }
public fun asset_soul_local_v7(): u8 { ASSET_SOUL_LOCAL }
public fun asset_owned_v7(): u8 { ASSET_OWNED }
public fun entitlement_base_included_v7(): u8 { ENTITLEMENT_BASE_INCLUDED }
public fun entitlement_wallet_free_v7(): u8 { ENTITLEMENT_WALLET_FREE }
public fun entitlement_wallet_paid_v7(): u8 { ENTITLEMENT_WALLET_PAID }
public fun entitlement_pack_included_v7(): u8 { ENTITLEMENT_PACK_INCLUDED }
public fun source_official_v7(): u8 { SOURCE_OFFICIAL }
public fun source_certified_v7(): u8 { SOURCE_CERTIFIED }
public fun source_open_v7(): u8 { SOURCE_OPEN }

fun new_protocol_objects<OwnerProof: drop>(
    v6_config: &CompositionProtocolConfigV6,
    v6_admin: &CompositionAdminCapV6,
    v5_config: &CommerceProtocolConfigV5,
    ctx: &mut TxContext,
): (PhysicalProtocolConfigV7, PhysicalRegistryV7, PhysicalAdminCapV7) {
    assert!(
        composition::composition_admin_cap_config_id_v6(v6_admin)
            == composition::protocol_config_id_v6(v6_config),
        EInvalidAdmin,
    );
    assert!(
        composition::protocol_v5_config_id_v6(v6_config)
            == commerce::protocol_config_id_v5(v5_config),
        EProtocolMismatch,
    );
    let bound = composition::protocol_soul_owner_proof_type_v6(v6_config);
    assert!(bound.is_some(), EDependencyMissing);
    let proof_type = defining_type_name<OwnerProof>();
    assert!(&proof_type == bound.borrow(), EOwnerProofMismatch);
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let registry = PhysicalRegistryV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        profiles: table::new(ctx),
        family_seed_products: table::new(ctx),
        style_products: table::new(ctx),
        wardrobes: table::new(ctx),
        free_style_claims: table::new(ctx),
        family_count: 0,
        product_count: 0,
        wardrobe_count: 0,
    };
    let config = PhysicalProtocolConfigV7 {
        id: config_uid,
        version: VERSION,
        v6_config_id: object::id(v6_config),
        v5_config_id: object::id(v5_config),
        v6_admin_cap_id: object::id(v6_admin),
        registry_id: object::id(&registry),
        soul_owner_proof_type: proof_type,
        listing_proof_type: option::none(),
        enabled: false,
    };
    let admin = PhysicalAdminCapV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
    };
    (config, registry, admin)
}

/// Canonical additive initializer. It claims a dynamic marker on the canonical
/// v6 AdminCap, so replay cannot create a second v7 registry.
public fun initialize_physical_protocol_v7<OwnerProof: drop>(
    v6_config: &CompositionProtocolConfigV6,
    v6_admin: &mut CompositionAdminCapV6,
    v5_config: &CommerceProtocolConfigV5,
    ctx: &mut TxContext,
) {
    composition::claim_physical_v7_initializer(v6_config, v6_admin);
    let (config, registry, admin) = new_protocol_objects<OwnerProof>(
        v6_config,
        v6_admin,
        v5_config,
        ctx,
    );
    event::emit(PhysicalProtocolInitializedV7 {
        config_id: object::id(&config),
        registry_id: object::id(&registry),
        owner_proof_type: *&config.soul_owner_proof_type,
    });
    transfer::share_object(config);
    transfer::share_object(registry);
    transfer::transfer(admin, ctx.sender());
}

#[test_only]
public fun new_physical_protocol_v7_for_testing<OwnerProof: drop>(
    v6_config: &CompositionProtocolConfigV6,
    v6_admin: &CompositionAdminCapV6,
    v5_config: &CommerceProtocolConfigV5,
    ctx: &mut TxContext,
): (PhysicalProtocolConfigV7, PhysicalRegistryV7, PhysicalAdminCapV7) {
    new_protocol_objects<OwnerProof>(v6_config, v6_admin, v5_config, ctx)
}

public fun update_physical_protocol_enabled_v7(
    config: &mut PhysicalProtocolConfigV7,
    admin: &PhysicalAdminCapV7,
    enabled: bool,
) {
    assert_admin(config, admin);
    config.enabled = enabled;
}

public fun bind_listing_proof_type_v7<ListingProof: drop>(
    config: &mut PhysicalProtocolConfigV7,
    admin: &PhysicalAdminCapV7,
) {
    assert_admin(config, admin);
    assert!(config.listing_proof_type.is_none(), EAlreadyBound);
    config.listing_proof_type = option::some(defining_type_name<ListingProof>());
}

public fun transfer_physical_admin_cap_v7(
    cap: PhysicalAdminCapV7,
    recipient: address,
) {
    assert!(recipient != @0x0, EInvalidRecipient);
    transfer::transfer(cap, recipient);
}

fun new_physical_profile(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    v5_config: &CommerceProtocolConfigV5,
    ctx: &mut TxContext,
): MakerPhysicalProfileV7 {
    assert_publication_gate(config, v6_config, v5_config);
    assert_registry(config, registry);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert!(
        commerce::root_lifecycle_v5(root) != commerce::lifecycle_archived()
            && commerce::root_lifecycle_v5(root)
                != commerce::lifecycle_sale_pending(),
        EProtocolMismatch,
    );
    assert_v6_profile_link(config, v6_profile, root);
    assert!(composition::profile_sealed_v6(v6_profile), EProfileNotSealed);
    assert!(
        composition::profile_mode_v6(v6_profile)
            == composition::profile_mode_composable_v6()
            && composition::profile_loadout_mutable_v6(v6_profile)
            && composition::profile_item_assetization_v6(v6_profile),
        EProfileNotComposable,
    );
    let v6_profile_id = object::id(v6_profile);
    assert!(!registry.profiles.contains(v6_profile_id), EProfileExists);
    let profile = MakerPhysicalProfileV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        v6_profile_id,
        root_id: commerce::root_id_v5(root),
        slot_schema_commitment:
            *composition::profile_slot_schema_commitment_v6(v6_profile),
        renderer_commitment:
            *composition::profile_renderer_commitment_v6(v6_profile),
        part_policies: table::new(ctx),
        required_slot_keys: vector[],
        part_policy_count: 0,
        sealed: false,
    };
    registry.profiles.add(v6_profile_id, object::id(&profile));
    profile
}

public fun create_maker_physical_profile_v7(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    v5_config: &CommerceProtocolConfigV5,
    ctx: &mut TxContext,
) {
    let profile = new_physical_profile(
        registry,
        config,
        v6_config,
        v6_profile,
        root,
        cap,
        v5_config,
        ctx,
    );
    transfer::share_object(profile);
}

public fun register_part_policy_v7(
    profile: &mut MakerPhysicalProfileV7,
    config: &PhysicalProtocolConfigV7,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    slot_key: String,
    behavior: u8,
    required: bool,
    max_source_kind: u8,
    ctx: &TxContext,
) {
    assert_config_profile(config, profile);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert!(profile.root_id == object::id(root), EProtocolMismatch);
    assert!(!profile.sealed, EProfileAlreadySealed);
    assert_part_policy(behavior, required, max_source_kind, &slot_key);
    let key = PartPolicyKeyV7 { slot_key: *&slot_key };
    assert!(!profile.part_policies.contains(key), EPartPolicyExists);
    profile.part_policies.add(key, PartPolicyV7 {
        slot_key: *&slot_key,
        behavior,
        required,
        max_source_kind,
    });
    if (required) {
        profile.required_slot_keys.push_back(*&slot_key);
    };
    profile.part_policy_count = profile.part_policy_count + 1;
    event::emit(PartPolicyRegisteredV7 {
        profile_id: object::id(profile),
        slot_key,
        behavior,
        required,
        max_source_kind,
    });
}

public fun seal_maker_physical_profile_v7(
    profile: &mut MakerPhysicalProfileV7,
    config: &PhysicalProtocolConfigV7,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    ctx: &TxContext,
) {
    assert_config_profile(config, profile);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert!(profile.root_id == object::id(root), EProtocolMismatch);
    assert!(!profile.sealed, EProfileAlreadySealed);
    assert!(profile.part_policy_count > 0, ENoPartPolicies);
    profile.sealed = true;
}

fun new_item_family_definition(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    family_key: String,
    label: String,
    family_commitment: vector<u8>,
    ctx: &mut TxContext,
): ItemFamilyV7 {
    assert_registry(config, registry);
    assert_config_profile(config, profile);
    assert_v6_product_link(config, profile, v6_profile, v6_product);
    let product_id = object::id(v6_product);
    assert_v6_admission_active(v6_profile, product_id);
    assert_family_seed_unregistered(registry, product_id);
    assert_non_empty(&family_key);
    assert_non_empty(&label);
    assert_hash(&family_commitment);
    assert!(
        &family_commitment == composition::product_family_commitment_v6(v6_product),
        EFamilyMismatch,
    );
    let family = ItemFamilyV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        profile_id: object::id(profile),
        seed_v6_product_id: product_id,
        creator: composition::product_original_creator_v6(v6_product),
        slot_key: *composition::product_slot_key_v6(v6_product),
        family_key,
        label,
        family_commitment,
        rights_origin: composition::product_rights_origin_v6(v6_product),
    };
    registry.family_seed_products.add(product_id, object::id(&family));
    registry.family_count = registry.family_count + 1;
    event::emit(ItemFamilyPublishedV7 {
        family_id: object::id(&family),
        profile_id: object::id(profile),
        seed_v6_product_id: product_id,
        creator: family.creator,
        slot_key: *&family.slot_key,
    });
    family
}

fun new_official_item_family(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    v5_config: &CommerceProtocolConfigV5,
    family_key: String,
    label: String,
    family_commitment: vector<u8>,
    ctx: &mut TxContext,
): ItemFamilyV7 {
    assert_operational(config, v6_config, profile, v6_profile, root, v5_config);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert!(
        composition::product_origin_kind_v6(v6_product)
            == composition::origin_official_v6(),
        ESourceForbidden,
    );
    assert_v6_admission_source(v6_profile, v6_product);
    new_item_family_definition(
        registry,
        config,
        profile,
        v6_profile,
        v6_product,
        family_key,
        label,
        family_commitment,
        ctx,
    )
}

fun new_external_item_family(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    family_key: String,
    label: String,
    family_commitment: vector<u8>,
    ctx: &mut TxContext,
): ItemFamilyV7 {
    assert_operational(config, v6_config, profile, v6_profile, root, v5_config);
    assert_external_publication_authority(v6_profile, v6_product, ctx);
    new_item_family_definition(
        registry,
        config,
        profile,
        v6_profile,
        v6_product,
        family_key,
        label,
        family_commitment,
        ctx,
    )
}

public fun publish_item_family_v7(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    v5_config: &CommerceProtocolConfigV5,
    family_key: String,
    label: String,
    family_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    assert_registry(config, registry);
    let family = new_official_item_family(
        registry,
        config,
        v6_config,
        profile,
        v6_profile,
        v6_product,
        root,
        cap,
        v5_config,
        family_key,
        label,
        family_commitment,
        ctx,
    );
    transfer::freeze_object(family);
}

/// Independent third-party supplier publication. The immutable v6 product
/// must already be actively admitted to this sealed Maker profile as
/// Certified/Open, and both its publisher and original creator must be the
/// transaction sender. No Maker control capability is accepted on this path.
public fun publish_external_item_family_v7(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    family_key: String,
    label: String,
    family_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    let family = new_external_item_family(
        registry,
        config,
        v6_config,
        profile,
        v6_profile,
        v6_product,
        root,
        v5_config,
        family_key,
        label,
        family_commitment,
        ctx,
    );
    transfer::freeze_object(family);
}

fun new_style_product_definition(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    family: &ItemFamilyV7,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    style_key: String,
    recipe_item_key: String,
    label: String,
    supply_kind: u8,
    max_supply: u64,
    definition_blob_id: String,
    definition_identifier: String,
    asset_blob_id: String,
    asset_identifier: String,
    renderer_commitment: vector<u8>,
    ctx: &mut TxContext,
): StyleProductV7 {
    assert_registry(config, registry);
    assert_v6_product_link(config, profile, v6_profile, v6_product);
    let v6_product_id = object::id(v6_product);
    assert_v6_admission_active(v6_profile, v6_product_id);
    assert!(family.config_id == object::id(config), EFamilyMismatch);
    assert!(family.profile_id == object::id(profile), EFamilyMismatch);
    assert!(
        &family.slot_key == composition::product_slot_key_v6(v6_product),
        EFamilyMismatch,
    );
    assert!(
        family.creator == composition::product_original_creator_v6(v6_product),
        EFamilyMismatch,
    );
    assert!(
        &family.family_commitment
            == composition::product_family_commitment_v6(v6_product),
        EFamilyMismatch,
    );
    assert!(
        family.rights_origin == composition::product_rights_origin_v6(v6_product),
        EFamilyMismatch,
    );
    assert_style_product_unregistered(registry, v6_product_id);
    assert_non_empty(&style_key);
    assert_non_empty(&label);
    assert_non_empty(&definition_blob_id);
    assert_non_empty(&asset_blob_id);
    assert_locator_identifier(&definition_identifier);
    assert_locator_identifier(&asset_identifier);
    assert_hash(&renderer_commitment);
    assert!(&renderer_commitment == &profile.renderer_commitment, EInvalidCommitment);
    assert_supply(v6_product, supply_kind, max_supply);
    assert_product_part_compatible(profile, v6_product, supply_kind);
    let pack_key = if (supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED) {
        // Only initial/Base/Pack content projects into the frozen v5 Recipe.
        // A genuine post-release third-party Item has no legacy Item row and
        // therefore carries an empty recipe_item_key by design.
        assert_non_empty(&recipe_item_key);
        assert!(commerce::style_registry_sealed_v5(root), EProfileNotSealed);
        assert!(
            commerce::style_product_row_kind_v5(
                root,
                *composition::product_slot_key_v6(v6_product),
                *&recipe_item_key,
                *&style_key,
            ) == commerce::style_row_visual_v5(),
            ELogicalStyleExpected,
        );
        commerce::style_product_pack_key_v5(
            root,
            *composition::product_slot_key_v6(v6_product),
            *&recipe_item_key,
            *&style_key,
        )
    } else {
        option::none()
    };
    let entitlement_kind = entitlement_kind_for_v6_product(
        v6_product,
        supply_kind,
        &pack_key,
    );
    let product = StyleProductV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        profile_id: object::id(profile),
        v6_profile_id: profile.v6_profile_id,
        family_id: object::id(family),
        v6_product_id,
        original_creator: composition::product_original_creator_v6(v6_product),
        slot_key: *composition::product_slot_key_v6(v6_product),
        style_key,
        recipe_item_key: *&recipe_item_key,
        label,
        source_kind: composition::product_origin_kind_v6(v6_product),
        entitlement_kind,
        pack_key,
        supply_kind,
        max_supply,
        minted_supply: 0,
        price_atomic: composition::product_price_atomic_v6(v6_product),
        protocol_fee_bps:
            composition::product_primary_protocol_fee_bps_v6(v6_product),
        maker_ecosystem_fee_bps:
            composition::product_maker_ecosystem_fee_bps_v6(v6_product),
        transferable: composition::product_transferable_v6(v6_product),
        definition_commitment:
            *composition::product_definition_commitment_v6(v6_product),
        asset_commitment:
            *composition::product_asset_commitment_v6(v6_product),
        definition_blob_id: *&definition_blob_id,
        definition_identifier: *&definition_identifier,
        asset_blob_id: *&asset_blob_id,
        asset_identifier: *&asset_identifier,
        renderer_commitment,
        required_v6_product_ids:
            *composition::product_required_product_ids_v6(v6_product),
        excluded_v6_product_ids:
            *composition::product_excluded_product_ids_v6(v6_product),
        active: true,
    };
    registry.style_products.add(v6_product_id, object::id(&product));
    registry.product_count = registry.product_count + 1;
    event::emit(StyleProductPublishedV7 {
        style_product_id: object::id(&product),
        family_id: object::id(family),
        v6_product_id,
        original_creator: product.original_creator,
        recipe_item_key,
        supply_kind,
        max_supply,
        definition_blob_id,
        definition_identifier,
        asset_blob_id,
        asset_identifier,
        definition_commitment:
            *composition::product_definition_commitment_v6(v6_product),
        asset_commitment:
            *composition::product_asset_commitment_v6(v6_product),
    });
    product
}

fun new_official_style_product(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    family: &ItemFamilyV7,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    v5_config: &CommerceProtocolConfigV5,
    style_key: String,
    recipe_item_key: String,
    label: String,
    supply_kind: u8,
    max_supply: u64,
    definition_blob_id: String,
    definition_identifier: String,
    asset_blob_id: String,
    asset_identifier: String,
    renderer_commitment: vector<u8>,
    ctx: &mut TxContext,
): StyleProductV7 {
    assert_operational(config, v6_config, profile, v6_profile, root, v5_config);
    commerce::assert_extension_control_v5(root, cap, ctx);
    assert!(
        composition::product_origin_kind_v6(v6_product)
            == composition::origin_official_v6(),
        ESourceForbidden,
    );
    assert_v6_admission_source(v6_profile, v6_product);
    new_style_product_definition(
        registry,
        config,
        profile,
        v6_profile,
        family,
        v6_product,
        root,
        style_key,
        recipe_item_key,
        label,
        supply_kind,
        max_supply,
        definition_blob_id,
        definition_identifier,
        asset_blob_id,
        asset_identifier,
        renderer_commitment,
        ctx,
    )
}

fun new_external_style_product(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    family: &ItemFamilyV7,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    style_key: String,
    recipe_item_key: String,
    label: String,
    supply_kind: u8,
    max_supply: u64,
    definition_blob_id: String,
    definition_identifier: String,
    asset_blob_id: String,
    asset_identifier: String,
    renderer_commitment: vector<u8>,
    ctx: &mut TxContext,
): StyleProductV7 {
    assert_operational(config, v6_config, profile, v6_profile, root, v5_config);
    assert_external_publication_authority(v6_profile, v6_product, ctx);
    assert!(supply_kind != SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    new_style_product_definition(
        registry,
        config,
        profile,
        v6_profile,
        family,
        v6_product,
        root,
        style_key,
        recipe_item_key,
        label,
        supply_kind,
        max_supply,
        definition_blob_id,
        definition_identifier,
        asset_blob_id,
        asset_identifier,
        renderer_commitment,
        ctx,
    )
}

public fun publish_style_product_v7(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    family: &ItemFamilyV7,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    cap: &MakerControlCapV5,
    v5_config: &CommerceProtocolConfigV5,
    style_key: String,
    recipe_item_key: String,
    label: String,
    supply_kind: u8,
    max_supply: u64,
    definition_blob_id: String,
    definition_identifier: String,
    asset_blob_id: String,
    asset_identifier: String,
    renderer_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    let product = new_official_style_product(
        registry,
        config,
        v6_config,
        profile,
        v6_profile,
        family,
        v6_product,
        root,
        cap,
        v5_config,
        style_key,
        recipe_item_key,
        label,
        supply_kind,
        max_supply,
        definition_blob_id,
        definition_identifier,
        asset_blob_id,
        asset_identifier,
        renderer_commitment,
        ctx,
    );
    transfer::share_object(product);
}

/// Certified/Open supplier self-publication. Admission and every immutable
/// product commitment were already validated in v6; v7 additionally proves
/// the supplier owns that exact definition and that the target Part accepts
/// its source/supply before adding the one canonical v6->v7 registry mapping.
public fun publish_external_style_product_v7(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    family: &ItemFamilyV7,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    style_key: String,
    recipe_item_key: String,
    label: String,
    supply_kind: u8,
    max_supply: u64,
    definition_blob_id: String,
    definition_identifier: String,
    asset_blob_id: String,
    asset_identifier: String,
    renderer_commitment: vector<u8>,
    ctx: &mut TxContext,
) {
    let product = new_external_style_product(
        registry,
        config,
        v6_config,
        profile,
        v6_profile,
        family,
        v6_product,
        root,
        v5_config,
        style_key,
        recipe_item_key,
        label,
        supply_kind,
        max_supply,
        definition_blob_id,
        definition_identifier,
        asset_blob_id,
        asset_identifier,
        renderer_commitment,
        ctx,
    );
    transfer::share_object(product);
}

public fun set_style_product_active_v7(
    product: &mut StyleProductV7,
    active: bool,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == product.original_creator, ENotStyleCreator);
    product.active = active;
}

public fun begin_initial_physical_loadout_authorization_v7(
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    root: &MakerRootV5,
    recipe_hash: vector<u8>,
    recipe: vector<RecipeSlot>,
): InitialPhysicalLoadoutAuthorizationV7 {
    assert_config_profile(config, profile);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(profile.root_id == object::id(root), EProtocolMismatch);
    assert_hash(&recipe_hash);
    assert!(recipe.length() > 0, EInitialSelectionEmpty);
    InitialPhysicalLoadoutAuthorizationV7 {
        version: VERSION,
        config_id: object::id(config),
        profile_id: object::id(profile),
        v6_profile_id: profile.v6_profile_id,
        root_id: object::id(root),
        recipe_hash,
        recipe,
        style_selections: vector[],
        visual_recipe_indices: vector[],
        style_product_ids: vector[],
        authorization_commitment: vector[],
        sealed: false,
    }
}

public fun append_initial_style_to_authorization_v7(
    authorization: &mut InitialPhysicalLoadoutAuthorizationV7,
    root: &MakerRootV5,
    family: &ItemFamilyV7,
    product: &StyleProductV7,
) {
    assert!(!authorization.sealed, EInitialAuthorizationNotSealed);
    assert!(authorization.root_id == object::id(root), EProtocolMismatch);
    assert!(commerce::style_registry_sealed_v5(root), EProfileNotSealed);
    assert!(family.config_id == authorization.config_id, EProtocolMismatch);
    assert!(family.profile_id == authorization.profile_id, EProtocolMismatch);
    assert!(product.config_id == authorization.config_id, EProtocolMismatch);
    assert!(product.profile_id == authorization.profile_id, EProtocolMismatch);
    assert!(product.v6_profile_id == authorization.v6_profile_id, EProtocolMismatch);
    assert!(product.family_id == object::id(family), EFamilyMismatch);
    assert_included_entitlement_kind(product);
    assert!(product.supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    assert!(product.active, EStyleInactive);
    let product_id = object::id(product);
    assert!(
        !vector_contains_id(&authorization.style_product_ids, product_id),
        EDuplicateInitialProduct,
    );
    let index = authorization.style_selections.length();
    assert!(index < authorization.recipe.length(), EInitialAuthorizationMismatch);
    let recipe_slot = authorization.recipe.borrow(index);
    assert!(
        legacy::recipe_slot_part_key(recipe_slot) == &product.slot_key,
        EInitialAuthorizationMismatch,
    );
    assert!(
        legacy::recipe_slot_item_key(recipe_slot) == &product.recipe_item_key,
        EInitialAuthorizationMismatch,
    );
    assert!(
        commerce::style_product_row_kind_v5(
            root,
            *&product.slot_key,
            *&product.recipe_item_key,
            *&product.style_key,
        ) == commerce::style_row_visual_v5(),
        ELogicalStyleExpected,
    );
    let registered_pack_key = commerce::style_product_pack_key_v5(
        root,
        *&product.slot_key,
        *&product.recipe_item_key,
        *&product.style_key,
    );
    assert!(&registered_pack_key == &product.pack_key, EWrongAccessKind);
    authorization.style_selections.push_back(commerce::new_style_selection_v5(
        *&product.slot_key,
        *&product.recipe_item_key,
        *&product.style_key,
    ));
    authorization.visual_recipe_indices.push_back(index);
    authorization.style_product_ids.push_back(product_id);
}

/// Appends a canonical v5 logical None/Color row. It participates in the
/// complete recipe hash and preserves exact order, but intentionally creates
/// no physical StyleProduct/StyleAsset sentinel in v7.
public fun append_initial_logical_style_to_authorization_v7(
    authorization: &mut InitialPhysicalLoadoutAuthorizationV7,
    root: &MakerRootV5,
    style_key: String,
) {
    assert!(!authorization.sealed, EInitialAuthorizationNotSealed);
    assert!(authorization.root_id == object::id(root), EProtocolMismatch);
    assert!(commerce::style_registry_sealed_v5(root), EProfileNotSealed);
    let index = authorization.style_selections.length();
    assert!(index < authorization.recipe.length(), EInitialAuthorizationMismatch);
    let recipe_slot = authorization.recipe.borrow(index);
    let part_key = *legacy::recipe_slot_part_key(recipe_slot);
    let item_key = *legacy::recipe_slot_item_key(recipe_slot);
    let row_kind = commerce::style_product_row_kind_v5(
        root,
        *&part_key,
        *&item_key,
        *&style_key,
    );
    assert!(
        row_kind == commerce::style_row_logical_none_v5()
            || row_kind == commerce::style_row_logical_color_v5(),
        ELogicalStyleExpected,
    );
    authorization.style_selections.push_back(commerce::new_style_selection_v5(
        part_key,
        item_key,
        style_key,
    ));
}

fun initial_physical_authorization_commitment(
    version: u64,
    config_id: ID,
    profile_id: ID,
    v6_profile_id: ID,
    root_id: ID,
    recipe_hash: &vector<u8>,
    visual_recipe_indices: &vector<u64>,
    style_product_ids: &vector<ID>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&InitialPhysicalAuthorizationHashInputV7 {
        version,
        config_id,
        profile_id,
        v6_profile_id,
        root_id,
        recipe_hash: *recipe_hash,
        visual_recipe_indices: *visual_recipe_indices,
        style_product_ids: *style_product_ids,
    }))
}

public fun seal_initial_physical_loadout_authorization_v7(
    authorization: &mut InitialPhysicalLoadoutAuthorizationV7,
) {
    assert!(!authorization.sealed, EInitialAuthorizationNotSealed);
    assert!(authorization.style_product_ids.length() > 0, EInitialSelectionEmpty);
    assert!(
        authorization.style_selections.length() == authorization.recipe.length(),
        EInitialAuthorizationMismatch,
    );
    assert!(
        commerce::hash_complete_selection_v5(
            &authorization.recipe,
            &authorization.style_selections,
        ) == authorization.recipe_hash,
        EInitialAuthorizationMismatch,
    );
    authorization.authorization_commitment = initial_physical_authorization_commitment(
        authorization.version,
        authorization.config_id,
        authorization.profile_id,
        authorization.v6_profile_id,
        authorization.root_id,
        &authorization.recipe_hash,
        &authorization.visual_recipe_indices,
        &authorization.style_product_ids,
    );
    authorization.sealed = true;
}

public fun initial_authorization_recipe_hash_v7(
    authorization: &InitialPhysicalLoadoutAuthorizationV7,
): &vector<u8> {
    &authorization.recipe_hash
}

public fun initial_authorization_style_product_ids_v7(
    authorization: &InitialPhysicalLoadoutAuthorizationV7,
): &vector<ID> {
    &authorization.style_product_ids
}

public fun initial_authorization_visual_recipe_indices_v7(
    authorization: &InitialPhysicalLoadoutAuthorizationV7,
): &vector<u64> {
    &authorization.visual_recipe_indices
}

public fun initial_authorization_commitment_v7(
    authorization: &InitialPhysicalLoadoutAuthorizationV7,
): &vector<u8> {
    &authorization.authorization_commitment
}

public fun initial_authorization_root_id_v7(
    authorization: &InitialPhysicalLoadoutAuthorizationV7,
): ID {
    authorization.root_id
}

fun consume_initial_physical_authorization(
    authorization: InitialPhysicalLoadoutAuthorizationV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    root: &MakerRootV5,
    authenticated_recipe_hash: &vector<u8>,
): (vector<ID>, vector<u8>, vector<u8>) {
    let InitialPhysicalLoadoutAuthorizationV7 {
        version,
        config_id,
        profile_id,
        v6_profile_id,
        root_id,
        recipe_hash,
        recipe: _,
        style_selections: _,
        visual_recipe_indices,
        style_product_ids,
        authorization_commitment,
        sealed,
    } = authorization;
    assert!(version == VERSION && sealed, EInitialAuthorizationNotSealed);
    assert!(config_id == object::id(config), EProtocolMismatch);
    assert!(profile_id == object::id(profile), EProtocolMismatch);
    assert!(v6_profile_id == profile.v6_profile_id, EProtocolMismatch);
    assert!(root_id == object::id(root), EProtocolMismatch);
    assert!(&recipe_hash == authenticated_recipe_hash, EInitialAuthorizationMismatch);
    assert!(style_product_ids.length() > 0, EInitialSelectionEmpty);
    assert!(
        authorization_commitment == initial_physical_authorization_commitment(
            version,
            config_id,
            profile_id,
            v6_profile_id,
            root_id,
            &recipe_hash,
            &visual_recipe_indices,
            &style_product_ids,
        ),
        EInitialAuthorizationMismatch,
    );
    (style_product_ids, recipe_hash, authorization_commitment)
}

fun new_wardrobe<OwnerProof: drop>(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    soul_id: ID,
    authorized_initial_style_product_ids: vector<ID>,
    initial_recipe_hash: vector<u8>,
    initial_authorization_commitment: vector<u8>,
    _proof: OwnerProof,
    ctx: &mut TxContext,
): SoulWardrobeV7 {
    assert_registry(config, registry);
    assert_owner_proof<OwnerProof>(config);
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(soul_id.to_address() != @0x0, EInvalidSoul);
    assert!(authorized_initial_style_product_ids.length() > 0, EInitialSelectionEmpty);
    assert_hash(&initial_recipe_hash);
    assert_hash(&initial_authorization_commitment);
    assert!(!registry.wardrobes.contains(soul_id), EWardrobeExists);
    let wardrobe = SoulWardrobeV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        profile_id: object::id(profile),
        root_id: profile.root_id,
        soul_id,
        slot_schema_commitment: *&profile.slot_schema_commitment,
        revision: 0,
        initialized: false,
        listed: false,
        inventory: table::new(ctx),
        claimed_included_products: table::new(ctx),
        equipped_by_slot: table::new(ctx),
        equipped_asset_ids: vector[],
        initial_product_by_slot: table::new(ctx),
        authorized_initial_style_product_ids,
        initial_recipe_hash: *&initial_recipe_hash,
        initial_authorization_commitment: *&initial_authorization_commitment,
        initial_style_product_ids: vector[],
        initial_asset_ids: vector[],
        external_asset_count: 0,
        soul_local_asset_count: 0,
        equipped_count: 0,
    };
    registry.wardrobes.add(soul_id, object::id(&wardrobe));
    registry.wardrobe_count = registry.wardrobe_count + 1;
    event::emit(SoulWardrobeCreatedV7 {
        wardrobe_id: object::id(&wardrobe),
        soul_id,
        profile_id: object::id(profile),
        initial_recipe_hash,
        initial_authorization_commitment,
    });
    wardrobe
}

/// Begins the canonical wardrobe in the Soul mint PTB. The returned key-only
/// object cannot survive the transaction until `finalize_soul_wardrobe_v7`
/// consumes and shares it, so an empty or incomplete starting look cannot be
/// published accidentally.
public fun create_soul_wardrobe_v7<OwnerProof: drop>(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    initial_authorization: InitialPhysicalLoadoutAuthorizationV7,
    authenticated_recipe_hash: &vector<u8>,
    proof: OwnerProof,
    ctx: &mut TxContext,
): SoulWardrobeV7 {
    assert_operational(
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
    );
    let (authorized_product_ids, initial_recipe_hash, authorization_commitment) =
        consume_initial_physical_authorization(
            initial_authorization,
            config,
            profile,
            root,
            authenticated_recipe_hash,
        );
    new_wardrobe(
        registry,
        config,
        profile,
        soul_id,
        authorized_product_ids,
        initial_recipe_hash,
        authorization_commitment,
        proof,
        ctx,
    )
}

/// Eagerly materializes only the exact Soul-local Included Style selected for
/// the starting appearance. Catalog alternatives remain definitions and are
/// not minted. Rules are validated once, order-independently, at finalization.
public fun claim_initial_included_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &mut StyleProductV7,
    soul_id: ID,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert!(!wardrobe.initialized, EWardrobeNotInitialized);
    assert_wardrobe_config(wardrobe, config);
    assert!(wardrobe.profile_id == object::id(profile), EProtocolMismatch);
    assert!(wardrobe.soul_id == soul_id, EInvalidSoul);
    assert!(!wardrobe.listed, EWardrobeListed);
    assert!(wardrobe.revision == expected_revision, EStaleRevision);
    assert!(product.config_id == object::id(config), EProtocolMismatch);
    assert!(product.profile_id == object::id(profile), EProtocolMismatch);
    assert_product_admitted(v6_profile, product);
    assert!(product.supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    // The staged authorization is derived from the exact v5 Complete
    // authorization, so both Base and entitled/paid Pack rows are safe here.
    assert_included_entitlement_kind(product);
    let style_product_id = object::id(product);
    assert!(
        !wardrobe.claimed_included_products.contains(style_product_id),
        EIncludedStyleAlreadyClaimed,
    );
    let selection_index = wardrobe.initial_style_product_ids.length();
    assert!(
        selection_index < wardrobe.authorized_initial_style_product_ids.length(),
        EInitialAuthorizationMismatch,
    );
    assert!(
        *wardrobe.authorized_initial_style_product_ids.borrow(selection_index)
            == style_product_id,
        EInitialAuthorizationMismatch,
    );
    let asset = create_style_asset(
        config,
        product,
        ASSET_SOUL_LOCAL,
        @0x0,
        option::some(soul_id),
        0,
        ctx,
    );
    assert_initial_part_accepts_asset(profile, &asset);
    let slot = PartPolicyKeyV7 { slot_key: *&asset.slot_key };
    assert!(!wardrobe.equipped_by_slot.contains(slot), ESlotOccupied);
    let asset_id = object::id(&asset);
    wardrobe.claimed_included_products.add(style_product_id, asset_id);
    add_to_wardrobe(wardrobe, &asset);
    wardrobe.inventory.borrow_mut(asset_id).equipped = true;
    wardrobe.equipped_by_slot.add(slot, asset_id);
    wardrobe.equipped_asset_ids.push_back(asset_id);
    wardrobe.initial_product_by_slot.add(slot, style_product_id);
    wardrobe.initial_style_product_ids.push_back(style_product_id);
    wardrobe.initial_asset_ids.push_back(asset_id);
    wardrobe.equipped_count = wardrobe.equipped_count + 1;
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, slot_key, 8);
}

/// Final step of the Soul mint PTB. It proves the initial selection is
/// non-empty, fills every canonical required Part, and satisfies all product
/// rules before the wardrobe becomes a shared companion object.
public fun finalize_soul_wardrobe_v7<OwnerProof: drop>(
    mut wardrobe: SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    soul_id: ID,
    _proof: OwnerProof,
    expected_revision: u64,
) {
    assert_owner_proof<OwnerProof>(config);
    assert_wardrobe_config(&wardrobe, config);
    assert!(wardrobe.profile_id == object::id(profile), EProtocolMismatch);
    assert!(wardrobe.soul_id == soul_id, EInvalidSoul);
    assert!(!wardrobe.initialized, EWardrobeNotInitialized);
    assert!(wardrobe.revision == expected_revision, EStaleRevision);
    assert!(wardrobe.initial_style_product_ids.length() > 0, EInitialSelectionEmpty);
    assert!(
        wardrobe.initial_style_product_ids
            == wardrobe.authorized_initial_style_product_ids,
        EInitialAuthorizationMismatch,
    );
    assert_wardrobe_complete_internal(&wardrobe, profile);
    wardrobe.initialized = true;
    increment_revision(&mut wardrobe);
    event::emit(SoulWardrobeFinalizedV7 {
        wardrobe_id: object::id(&wardrobe),
        soul_id,
        revision: wardrobe.revision,
        initial_style_count: wardrobe.initial_style_product_ids.length(),
    });
    transfer::share_object(wardrobe);
}

fun next_serial(product: &mut StyleProductV7): u64 {
    assert!(product.active, EStyleInactive);
    if (product.supply_kind == SUPPLY_LIMITED_EDITION) {
        assert!(product.minted_supply < product.max_supply, ESoldOut);
    };
    product.minted_supply = product.minted_supply + 1;
    product.minted_supply
}

fun create_style_asset(
    config: &PhysicalProtocolConfigV7,
    product: &mut StyleProductV7,
    asset_kind: u8,
    holder: address,
    bound_soul_id: Option<ID>,
    ownership_epoch: u64,
    ctx: &mut TxContext,
): StyleAssetV7 {
    let serial = next_serial(product);
    materialize_style_asset(
        config,
        product,
        asset_kind,
        holder,
        bound_soul_id,
        ownership_epoch,
        serial,
        ctx,
    )
}

/// Existing v6 receipts are already-issued rights. Their migration is a
/// recovery path, not a new primary mint: creator pause/inactivation or a v7
/// cap lower than pre-existing v6 issuance must never trap them.
fun create_migrated_style_asset(
    config: &PhysicalProtocolConfigV7,
    product: &mut StyleProductV7,
    holder: address,
    ownership_epoch: u64,
    ctx: &mut TxContext,
): StyleAssetV7 {
    product.minted_supply = product.minted_supply + 1;
    materialize_style_asset(
        config,
        product,
        ASSET_OWNED,
        holder,
        option::none(),
        ownership_epoch,
        product.minted_supply,
        ctx,
    )
}

fun materialize_style_asset(
    config: &PhysicalProtocolConfigV7,
    product: &StyleProductV7,
    asset_kind: u8,
    holder: address,
    bound_soul_id: Option<ID>,
    ownership_epoch: u64,
    serial: u64,
    ctx: &mut TxContext,
): StyleAssetV7 {
    let asset = StyleAssetV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id: object::id(config),
        profile_id: product.profile_id,
        family_id: product.family_id,
        style_product_id: object::id(product),
        v6_product_id: product.v6_product_id,
        original_creator: product.original_creator,
        slot_key: *&product.slot_key,
        source_kind: product.source_kind,
        asset_kind,
        serial,
        transferable: product.transferable,
        holder,
        bound_soul_id,
        ownership_epoch,
        required_v6_product_ids: *&product.required_v6_product_ids,
        excluded_v6_product_ids: *&product.excluded_v6_product_ids,
    };
    event::emit(StyleAssetMaterializedV7 {
        asset_id: object::id(&asset),
        style_product_id: object::id(product),
        asset_kind,
        serial,
        soul_id: bound_soul_id,
    });
    asset
}

fun consume_v6_owned_receipt(
    v6_registry: &mut CompositionRegistryV6,
    v6_config: &CompositionProtocolConfigV6,
    v6_profile: &MakerProfileV6,
    style_product: &StyleProductV7,
    receipt: OwnedItemV6,
    ctx: &TxContext,
): (address, bool, u64) {
    let (v6_product_id, holder, transferable, ownership_epoch) =
        composition::consume_owned_item_for_physical_v7(
            v6_registry,
            v6_config,
            v6_profile,
            receipt,
            ctx,
        );
    assert!(v6_product_id == style_product.v6_product_id, EWrongProduct);
    (holder, transferable, ownership_epoch)
}

public fun claim_free_owned_style_v7(
    v7_registry: &mut PhysicalRegistryV7,
    v7_config: &PhysicalProtocolConfigV7,
    style_product: &mut StyleProductV7,
    v6_registry: &mut CompositionRegistryV6,
    v6_config: &CompositionProtocolConfigV6,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_registry(v7_config, v7_registry);
    assert_style_sale_link(v7_config, style_product, v6_config, v6_profile, v6_product);
    assert!(style_product.supply_kind != SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    assert!(
        composition::product_access_kind_v6(v6_product)
            == composition::access_free_v6(),
        EWrongAccessKind,
    );
    assert_supply_available(style_product);
    let free_claim_key = reserve_free_style_claim(
        v7_registry,
        object::id(style_product),
        ctx.sender(),
    );
    let receipt = composition::claim_free_owned_item_for_physical_v7(
        v6_registry,
        v6_config,
        v6_profile,
        v6_product,
        root,
        v5_config,
        clock,
        ctx,
    );
    let (holder, transferable, ownership_epoch) = consume_v6_owned_receipt(
        v6_registry,
        v6_config,
        v6_profile,
        style_product,
        receipt,
        ctx,
    );
    assert!(transferable == style_product.transferable, EAssetMismatch);
    let asset = create_style_asset(
        v7_config,
        style_product,
        ASSET_OWNED,
        holder,
        option::none(),
        ownership_epoch,
        ctx,
    );
    v7_registry.free_style_claims.add(free_claim_key, true);
    transfer::transfer(asset, holder);
}

fun reserve_free_style_claim(
    registry: &PhysicalRegistryV7,
    style_product_id: ID,
    wallet: address,
): FreeStyleClaimKeyV7 {
    let key = FreeStyleClaimKeyV7 { style_product_id, wallet };
    assert!(!registry.free_style_claims.contains(key), EFreeStyleAlreadyClaimed);
    key
}

public fun purchase_owned_style_v7<PaymentCoin>(
    v7_config: &PhysicalProtocolConfigV7,
    style_product: &mut StyleProductV7,
    v6_registry: &mut CompositionRegistryV6,
    v6_config: &CompositionProtocolConfigV6,
    v6_treasury: &mut CompositionProtocolTreasuryV6<PaymentCoin>,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_style_sale_link(v7_config, style_product, v6_config, v6_profile, v6_product);
    assert!(style_product.supply_kind != SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    assert!(
        composition::product_access_kind_v6(v6_product)
            == composition::access_paid_v6(),
        EWrongAccessKind,
    );
    assert_supply_available(style_product);
    let receipt = composition::purchase_owned_item_for_physical_v7(
        v6_registry,
        v6_config,
        v6_treasury,
        v6_profile,
        v6_product,
        root,
        v5_config,
        payment,
        clock,
        ctx,
    );
    let (holder, transferable, ownership_epoch) = consume_v6_owned_receipt(
        v6_registry,
        v6_config,
        v6_profile,
        style_product,
        receipt,
        ctx,
    );
    assert!(transferable == style_product.transferable, EAssetMismatch);
    let asset = create_style_asset(
        v7_config,
        style_product,
        ASSET_OWNED,
        holder,
        option::none(),
        ownership_epoch,
        ctx,
    );
    transfer::transfer(asset, holder);
}

/// Migration of an already-issued v6 OwnedItem. It performs no sale and is
/// available during a pause/archive, mirroring the non-trapping v6 bridge.
public fun materialize_legacy_owned_style_v7(
    v7_config: &PhysicalProtocolConfigV7,
    style_product: &mut StyleProductV7,
    v6_registry: &mut CompositionRegistryV6,
    v6_config: &CompositionProtocolConfigV6,
    v6_profile: &MakerProfileV6,
    receipt: OwnedItemV6,
    ctx: &mut TxContext,
) {
    assert!(style_product.config_id == object::id(v7_config), EProtocolMismatch);
    assert!(style_product.v6_profile_id == object::id(v6_profile), EProtocolMismatch);
    assert!(style_product.supply_kind != SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    let (holder, transferable, ownership_epoch) = consume_v6_owned_receipt(
        v6_registry,
        v6_config,
        v6_profile,
        style_product,
        receipt,
        ctx,
    );
    assert!(transferable == style_product.transferable, EAssetMismatch);
    let asset = create_migrated_style_asset(
        v7_config,
        style_product,
        holder,
        ownership_epoch,
        ctx,
    );
    transfer::transfer(asset, holder);
}

/// Recovery-safe holder transfer for an unbound wallet-owned Style. This is
/// intentionally independent of Maker/protocol lifecycle so pause or archive
/// cannot freeze user property. Secondary marketplace settlement remains
/// fail-closed until a reviewed Kiosk/royalty adapter is introduced; this ABI
/// is a direct owner-authorized gift/transfer, not a sale primitive.
public fun transfer_owned_style_v7(
    mut asset: StyleAssetV7,
    recipient: address,
    ctx: &TxContext,
) {
    assert!(asset.asset_kind == ASSET_OWNED, EAssetMismatch);
    assert!(asset.holder == ctx.sender(), ENotAssetHolder);
    assert!(asset.bound_soul_id.is_none(), EAssetAlreadyDeposited);
    assert!(asset.transferable, EStyleNotTransferable);
    assert!(recipient != @0x0 && recipient != ctx.sender(), EInvalidRecipient);
    asset.holder = recipient;
    asset.ownership_epoch = asset.ownership_epoch + 1;
    transfer::transfer(asset, recipient);
}

fun custody_record(asset: &StyleAssetV7, equipped: bool): CustodyRecordV7 {
    CustodyRecordV7 {
        style_product_id: asset.style_product_id,
        family_id: asset.family_id,
        v6_product_id: asset.v6_product_id,
        slot_key: *&asset.slot_key,
        source_kind: asset.source_kind,
        asset_kind: asset.asset_kind,
        bound_soul_id: asset.bound_soul_id,
        equipped,
        required_v6_product_ids: *&asset.required_v6_product_ids,
        excluded_v6_product_ids: *&asset.excluded_v6_product_ids,
    }
}

fun add_to_wardrobe(
    wardrobe: &mut SoulWardrobeV7,
    asset: &StyleAssetV7,
) {
    let asset_id = object::id(asset);
    assert!(!wardrobe.inventory.contains(asset_id), EAssetAlreadyDeposited);
    wardrobe.inventory.add(asset_id, custody_record(asset, false));
    if (asset.asset_kind == ASSET_OWNED) {
        wardrobe.external_asset_count = wardrobe.external_asset_count + 1;
    } else {
        wardrobe.soul_local_asset_count = wardrobe.soul_local_asset_count + 1;
    };
}

fun deposit_owned_internal(
    wardrobe: &mut SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
    product: &StyleProductV7,
    mut asset: StyleAssetV7,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    assert_asset_product(wardrobe, product, &asset);
    assert!(asset.asset_kind == ASSET_OWNED, EAssetMismatch);
    assert!(asset.holder == ctx.sender(), ENotAssetHolder);
    assert!(asset.bound_soul_id.is_none(), EAssetAlreadyDeposited);
    assert_part_accepts_asset(profile, &asset);
    asset.holder = @0x0;
    asset.bound_soul_id = option::some(wardrobe.soul_id);
    add_to_wardrobe(wardrobe, &asset);
    let asset_id = object::id(&asset);
    transfer::transfer(asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, *&product.slot_key, 0);
}

public fun deposit_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    asset: StyleAssetV7,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, product);
    deposit_owned_internal(
        wardrobe,
        profile,
        product,
        asset,
        expected_revision,
        ctx,
    );
}

fun equip_received_internal(
    wardrobe: &mut SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
    product: &StyleProductV7,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    let receiving_id = transfer::receiving_object_id(&receiving);
    assert!(wardrobe.inventory.contains(receiving_id), EAssetNotDeposited);
    let asset = transfer::receive(&mut wardrobe.id, receiving);
    assert!(object::id(&asset) == receiving_id, EWrongReceivingAsset);
    assert_asset_product(wardrobe, product, &asset);
    assert_part_accepts_asset(profile, &asset);
    let slot = PartPolicyKeyV7 { slot_key: *&asset.slot_key };
    assert!(!wardrobe.equipped_by_slot.contains(slot), ESlotOccupied);
    let record = wardrobe.inventory.borrow_mut(receiving_id);
    assert!(!record.equipped, EAssetAlreadyEquipped);
    record.equipped = true;
    wardrobe.equipped_by_slot.add(slot, receiving_id);
    wardrobe.equipped_asset_ids.push_back(receiving_id);
    wardrobe.equipped_count = wardrobe.equipped_count + 1;
    assert_equipped_rules(wardrobe);
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, receiving_id, slot_key, 1);
}

public fun equip_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, product);
    equip_received_internal(
        wardrobe,
        profile,
        product,
        receiving,
        expected_revision,
    );
}

/// One-signature wallet -> wardrobe -> equipped path. This avoids requiring a
/// Receiving ticket for an object whose parent changes earlier in the PTB.
public fun deposit_and_equip_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    asset: StyleAssetV7,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, product);
    deposit_and_equip_internal(
        wardrobe,
        profile,
        product,
        asset,
        expected_revision,
        ctx,
    );
}

fun deposit_and_equip_internal(
    wardrobe: &mut SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
    product: &StyleProductV7,
    mut asset: StyleAssetV7,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    assert_asset_product(wardrobe, product, &asset);
    assert!(asset.asset_kind == ASSET_OWNED, EAssetMismatch);
    assert!(asset.holder == ctx.sender(), ENotAssetHolder);
    assert_part_accepts_asset(profile, &asset);
    let slot = PartPolicyKeyV7 { slot_key: *&asset.slot_key };
    assert!(!wardrobe.equipped_by_slot.contains(slot), ESlotOccupied);
    asset.holder = @0x0;
    asset.bound_soul_id = option::some(wardrobe.soul_id);
    let asset_id = object::id(&asset);
    add_to_wardrobe(wardrobe, &asset);
    wardrobe.inventory.borrow_mut(asset_id).equipped = true;
    wardrobe.equipped_by_slot.add(slot, asset_id);
    wardrobe.equipped_asset_ids.push_back(asset_id);
    wardrobe.equipped_count = wardrobe.equipped_count + 1;
    assert_equipped_rules(wardrobe);
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, slot_key, 5);
}

fun swap_internal(
    wardrobe: &mut SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
    new_product: &StyleProductV7,
    new_receiving: Receiving<StyleAssetV7>,
    old_receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    let new_id = transfer::receiving_object_id(&new_receiving);
    let old_id = transfer::receiving_object_id(&old_receiving);
    assert!(new_id != old_id, EAssetMismatch);
    let new_asset = transfer::receive(&mut wardrobe.id, new_receiving);
    let old_asset = transfer::receive(&mut wardrobe.id, old_receiving);
    assert_asset_product(wardrobe, new_product, &new_asset);
    assert_part_accepts_asset(profile, &new_asset);
    assert!(&new_asset.slot_key == &old_asset.slot_key, EWrongSlot);
    let slot = PartPolicyKeyV7 { slot_key: *&new_asset.slot_key };
    assert!(wardrobe.equipped_by_slot.contains(slot), EAssetNotEquipped);
    assert!(*wardrobe.equipped_by_slot.borrow(slot) == old_id, EAssetNotEquipped);
    assert!(wardrobe.inventory.borrow(old_id).equipped, EAssetNotEquipped);
    assert!(!wardrobe.inventory.borrow(new_id).equipped, EAssetAlreadyEquipped);
    wardrobe.inventory.borrow_mut(old_id).equipped = false;
    wardrobe.inventory.borrow_mut(new_id).equipped = true;
    let _ = wardrobe.equipped_by_slot.remove(slot);
    wardrobe.equipped_by_slot.add(slot, new_id);
    replace_equipped_id(&mut wardrobe.equipped_asset_ids, old_id, new_id);
    assert_equipped_rules(wardrobe);
    let slot_key = *&new_asset.slot_key;
    transfer::transfer(old_asset, object::id_address(wardrobe));
    transfer::transfer(new_asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, new_id, slot_key, 2);
}

public fun swap_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    new_product: &StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    new_receiving: Receiving<StyleAssetV7>,
    old_receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, new_product);
    swap_internal(
        wardrobe,
        profile,
        new_product,
        new_receiving,
        old_receiving,
        expected_revision,
    );
}

/// Atomic wallet deposit plus replacement of the currently equipped child.
public fun deposit_and_swap_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    new_product: &StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    mut new_asset: StyleAssetV7,
    old_receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, new_product);
    assert_wardrobe_mutable(wardrobe, expected_revision);
    assert_asset_product(wardrobe, new_product, &new_asset);
    assert!(new_asset.asset_kind == ASSET_OWNED, EAssetMismatch);
    assert!(new_asset.holder == ctx.sender(), ENotAssetHolder);
    assert_part_accepts_asset(profile, &new_asset);
    let old_id = transfer::receiving_object_id(&old_receiving);
    let old_asset = transfer::receive(&mut wardrobe.id, old_receiving);
    assert!(&new_asset.slot_key == &old_asset.slot_key, EWrongSlot);
    let slot = PartPolicyKeyV7 { slot_key: *&new_asset.slot_key };
    assert!(wardrobe.equipped_by_slot.contains(slot), EAssetNotEquipped);
    assert!(*wardrobe.equipped_by_slot.borrow(slot) == old_id, EAssetNotEquipped);
    new_asset.holder = @0x0;
    new_asset.bound_soul_id = option::some(wardrobe.soul_id);
    let new_id = object::id(&new_asset);
    add_to_wardrobe(wardrobe, &new_asset);
    wardrobe.inventory.borrow_mut(old_id).equipped = false;
    wardrobe.inventory.borrow_mut(new_id).equipped = true;
    let _ = wardrobe.equipped_by_slot.remove(slot);
    wardrobe.equipped_by_slot.add(slot, new_id);
    replace_equipped_id(&mut wardrobe.equipped_asset_ids, old_id, new_id);
    assert_equipped_rules(wardrobe);
    let slot_key = *&new_asset.slot_key;
    transfer::transfer(old_asset, object::id_address(wardrobe));
    transfer::transfer(new_asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, new_id, slot_key, 6);
}

public fun unequip_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    unequip_received_internal(
        wardrobe,
        profile,
        receiving,
        expected_revision,
    );
}

fun unequip_received_internal(
    wardrobe: &mut SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    let asset_id = transfer::receiving_object_id(&receiving);
    let asset = transfer::receive(&mut wardrobe.id, receiving);
    let policy = part_policy(profile, *&asset.slot_key);
    assert_part_can_unequip(policy);
    let slot = PartPolicyKeyV7 { slot_key: *&asset.slot_key };
    assert!(wardrobe.equipped_by_slot.contains(slot), EAssetNotEquipped);
    assert!(*wardrobe.equipped_by_slot.borrow(slot) == asset_id, EAssetNotEquipped);
    wardrobe.inventory.borrow_mut(asset_id).equipped = false;
    let _ = wardrobe.equipped_by_slot.remove(slot);
    remove_equipped_id(&mut wardrobe.equipped_asset_ids, asset_id);
    wardrobe.equipped_count = wardrobe.equipped_count - 1;
    assert_equipped_rules(wardrobe);
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, slot_key, 3);
}

/// Recovery path deliberately omits v5/v6 enabled/lifecycle checks. Pause and
/// archive can stop new deposits/equips but can never trap an external asset.
public fun withdraw_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    soul_id: ID,
    _proof: OwnerProof,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_owner_proof<OwnerProof>(config);
    assert_wardrobe_config(wardrobe, config);
    assert!(wardrobe.soul_id == soul_id, EInvalidSoul);
    withdraw_received_internal(
        wardrobe,
        receiving,
        expected_revision,
        ctx.sender(),
    );
}

fun withdraw_received_internal(
    wardrobe: &mut SoulWardrobeV7,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    recipient: address,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    let asset_id = transfer::receiving_object_id(&receiving);
    assert!(wardrobe.inventory.contains(asset_id), EAssetNotDeposited);
    assert!(!wardrobe.inventory.borrow(asset_id).equipped, EAssetAlreadyEquipped);
    let mut asset = transfer::receive(&mut wardrobe.id, receiving);
    let record = wardrobe.inventory.remove(asset_id);
    assert_withdrawable_asset(&asset, &record);
    wardrobe.external_asset_count = wardrobe.external_asset_count - 1;
    asset.holder = recipient;
    asset.bound_soul_id = option::none();
    asset.ownership_epoch = asset.ownership_epoch + 1;
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, recipient);
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, slot_key, 4);
}

/// Emergency recovery for an equipped wallet-owned Style. Unlike normal
/// unequip it deliberately bypasses v5/v6/v7 operational and admission gates,
/// so a protocol pause, archived Maker, or revoked product can never trap a
/// user's asset. A required Hybrid slot may become temporarily incomplete;
/// listing/transfer now re-check canonical completeness and stays blocked
/// until the Soul-local included Style is restored after operations resume.
public fun emergency_unequip_and_withdraw_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    soul_id: ID,
    _proof: OwnerProof,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_owner_proof<OwnerProof>(config);
    assert_wardrobe_config(wardrobe, config);
    assert!(wardrobe.soul_id == soul_id, EInvalidSoul);
    emergency_unequip_and_withdraw_internal(
        wardrobe,
        receiving,
        expected_revision,
        ctx.sender(),
    );
}

fun emergency_unequip_and_withdraw_internal(
    wardrobe: &mut SoulWardrobeV7,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    recipient: address,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    let asset_id = transfer::receiving_object_id(&receiving);
    assert!(wardrobe.inventory.contains(asset_id), EAssetNotDeposited);
    let mut asset = transfer::receive(&mut wardrobe.id, receiving);
    assert!(object::id(&asset) == asset_id, EWrongReceivingAsset);
    let record = wardrobe.inventory.remove(asset_id);
    assert!(record.equipped, EAssetNotEquipped);
    assert_withdrawable_asset(&asset, &record);
    let slot = PartPolicyKeyV7 { slot_key: *&asset.slot_key };
    assert!(wardrobe.equipped_by_slot.contains(slot), EAssetNotEquipped);
    assert!(*wardrobe.equipped_by_slot.borrow(slot) == asset_id, EAssetNotEquipped);
    let _ = wardrobe.equipped_by_slot.remove(slot);
    remove_equipped_id(&mut wardrobe.equipped_asset_ids, asset_id);
    wardrobe.equipped_count = wardrobe.equipped_count - 1;
    wardrobe.external_asset_count = wardrobe.external_asset_count - 1;
    asset.holder = recipient;
    asset.bound_soul_id = option::none();
    asset.ownership_epoch = asset.ownership_epoch + 1;
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, recipient);
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, slot_key, 9);
}

public fun claim_included_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &mut StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, product);
    assert_postmint_included_entitlement(root, product, ctx.sender());
    claim_included_internal(
        wardrobe,
        config,
        profile,
        product,
        soul_id,
        expected_revision,
        ctx,
    );
}

fun claim_included_internal(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    product: &mut StyleProductV7,
    soul_id: ID,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    assert!(product.supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    assert_included_entitlement_kind(product);
    let style_product_id = object::id(product);
    assert!(
        !wardrobe.claimed_included_products.contains(style_product_id),
        EIncludedStyleAlreadyClaimed,
    );
    let asset = create_style_asset(
        config,
        product,
        ASSET_SOUL_LOCAL,
        @0x0,
        option::some(soul_id),
        0,
        ctx,
    );
    assert_part_accepts_asset(profile, &asset);
    let asset_id = object::id(&asset);
    wardrobe.claimed_included_products.add(style_product_id, asset_id);
    add_to_wardrobe(wardrobe, &asset);
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, slot_key, 7);
}

/// Atomic catalog selection for an empty Part. The exact INCLUDED Style is
/// materialized once for this Soul, placed under the wardrobe, and equipped
/// in one transaction; the caller never needs to predict a new child ID.
public fun claim_and_equip_included_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &mut StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, product);
    assert_postmint_included_entitlement(root, product, ctx.sender());
    claim_and_equip_included_internal(
        wardrobe,
        config,
        profile,
        product,
        soul_id,
        expected_revision,
        ctx,
    );
}

fun claim_and_equip_included_internal(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    product: &mut StyleProductV7,
    soul_id: ID,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    assert!(product.supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    assert_included_entitlement_kind(product);
    let style_product_id = object::id(product);
    assert!(
        !wardrobe.claimed_included_products.contains(style_product_id),
        EIncludedStyleAlreadyClaimed,
    );
    let asset = create_style_asset(
        config,
        product,
        ASSET_SOUL_LOCAL,
        @0x0,
        option::some(soul_id),
        0,
        ctx,
    );
    assert_part_accepts_asset(profile, &asset);
    let slot = PartPolicyKeyV7 { slot_key: *&asset.slot_key };
    assert!(!wardrobe.equipped_by_slot.contains(slot), ESlotOccupied);
    let asset_id = object::id(&asset);
    wardrobe.claimed_included_products.add(style_product_id, asset_id);
    add_to_wardrobe(wardrobe, &asset);
    wardrobe.inventory.borrow_mut(asset_id).equipped = true;
    wardrobe.equipped_by_slot.add(slot, asset_id);
    wardrobe.equipped_asset_ids.push_back(asset_id);
    wardrobe.equipped_count = wardrobe.equipped_count + 1;
    assert_equipped_rules(wardrobe);
    let slot_key = *&asset.slot_key;
    transfer::transfer(asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, asset_id, slot_key, 10);
}

/// Atomic catalog selection for an occupied Part. The old child remains in
/// wardrobe custody unequipped; the newly materialized included Style becomes
/// the active child. Fixed Parts remain immutable because the normal Part
/// acceptance gate rejects them.
public fun claim_and_swap_included_style_v7<OwnerProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &mut StyleProductV7,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    proof: OwnerProof,
    old_receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert_owner_action(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul_id,
        proof,
    );
    assert_product_admitted(v6_profile, product);
    assert_postmint_included_entitlement(root, product, ctx.sender());
    claim_and_swap_included_internal(
        wardrobe,
        config,
        profile,
        product,
        soul_id,
        old_receiving,
        expected_revision,
        ctx,
    );
}

fun claim_and_swap_included_internal(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    product: &mut StyleProductV7,
    soul_id: ID,
    old_receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert_wardrobe_mutable(wardrobe, expected_revision);
    assert!(product.supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED, EInvalidSupply);
    assert_included_entitlement_kind(product);
    let style_product_id = object::id(product);
    assert!(
        !wardrobe.claimed_included_products.contains(style_product_id),
        EIncludedStyleAlreadyClaimed,
    );
    let new_asset = create_style_asset(
        config,
        product,
        ASSET_SOUL_LOCAL,
        @0x0,
        option::some(soul_id),
        0,
        ctx,
    );
    assert_part_accepts_asset(profile, &new_asset);
    let old_id = transfer::receiving_object_id(&old_receiving);
    assert!(wardrobe.inventory.contains(old_id), EAssetNotDeposited);
    let old_asset = transfer::receive(&mut wardrobe.id, old_receiving);
    assert!(&new_asset.slot_key == &old_asset.slot_key, EWrongSlot);
    let slot = PartPolicyKeyV7 { slot_key: *&new_asset.slot_key };
    assert!(wardrobe.equipped_by_slot.contains(slot), EAssetNotEquipped);
    assert!(*wardrobe.equipped_by_slot.borrow(slot) == old_id, EAssetNotEquipped);
    assert!(wardrobe.inventory.borrow(old_id).equipped, EAssetNotEquipped);
    let new_id = object::id(&new_asset);
    wardrobe.claimed_included_products.add(style_product_id, new_id);
    add_to_wardrobe(wardrobe, &new_asset);
    wardrobe.inventory.borrow_mut(old_id).equipped = false;
    wardrobe.inventory.borrow_mut(new_id).equipped = true;
    let _ = wardrobe.equipped_by_slot.remove(slot);
    wardrobe.equipped_by_slot.add(slot, new_id);
    replace_equipped_id(&mut wardrobe.equipped_asset_ids, old_id, new_id);
    assert_equipped_rules(wardrobe);
    let slot_key = *&new_asset.slot_key;
    transfer::transfer(old_asset, object::id_address(wardrobe));
    transfer::transfer(new_asset, object::id_address(wardrobe));
    increment_revision(wardrobe);
    emit_wardrobe(wardrobe, new_id, slot_key, 11);
}

/// Soulidity calls this with its private listing proof in the same PTB as
/// listing/delisting. A listed wardrobe rejects every owner mutation.
public fun set_wardrobe_listed_v7<ListingProof: drop>(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    soul_id: ID,
    listed: bool,
    _proof: ListingProof,
    expected_revision: u64,
) {
    assert_listing_proof<ListingProof>(config);
    assert_wardrobe_config(wardrobe, config);
    assert!(wardrobe.soul_id == soul_id, EInvalidSoul);
    assert!(wardrobe.initialized, EWardrobeNotInitialized);
    assert!(wardrobe.revision == expected_revision, EStaleRevision);
    if (listed) {
        assert!(!wardrobe.listed, EWardrobeListed);
        assert!(wardrobe.external_asset_count == 0, EExternalAssetsRemain);
        assert_wardrobe_complete_internal(wardrobe, profile);
    } else {
        assert!(wardrobe.listed, EWardrobeListed);
    };
    wardrobe.listed = listed;
    increment_revision(wardrobe);
}

public fun assert_wardrobe_transferable_v7(
    wardrobe: &SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
) {
    assert!(wardrobe.initialized, EWardrobeNotInitialized);
    assert!(!wardrobe.listed, EWardrobeListed);
    assert!(wardrobe.external_asset_count == 0, EExternalAssetsRemain);
    assert_wardrobe_complete_internal(wardrobe, profile);
}

public fun assert_wardrobe_complete_v7(
    wardrobe: &SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
) {
    assert!(wardrobe.initialized, EWardrobeNotInitialized);
    assert_wardrobe_complete_internal(wardrobe, profile);
}

fun assert_wardrobe_complete_internal(
    wardrobe: &SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
) {
    assert!(wardrobe.profile_id == object::id(profile), EProtocolMismatch);
    let mut i = 0;
    while (i < profile.required_slot_keys.length()) {
        let slot_key = *profile.required_slot_keys.borrow(i);
        let policy = part_policy(profile, slot_key);
        assert!(policy.required, EInvalidPartPolicy);
        assert!(
            wardrobe.equipped_by_slot.contains(PartPolicyKeyV7 { slot_key }),
            ERequiredPartEmpty,
        );
        i = i + 1;
    };
    assert_equipped_rules(wardrobe);
}

// --- Read ABI ------------------------------------------------------------

public fun physical_config_id_v7(self: &PhysicalProtocolConfigV7): ID {
    object::id(self)
}
public fun physical_protocol_enabled_v7(self: &PhysicalProtocolConfigV7): bool {
    self.enabled
}
public fun physical_registry_id_v7(self: &PhysicalProtocolConfigV7): ID {
    self.registry_id
}
public fun physical_v6_config_id_v7(self: &PhysicalProtocolConfigV7): ID {
    self.v6_config_id
}
public fun physical_v5_config_id_v7(self: &PhysicalProtocolConfigV7): ID {
    self.v5_config_id
}
public fun physical_soul_owner_proof_type_v7(
    self: &PhysicalProtocolConfigV7,
): &String {
    &self.soul_owner_proof_type
}
public fun physical_listing_proof_type_v7(
    self: &PhysicalProtocolConfigV7,
): &Option<String> {
    &self.listing_proof_type
}
public fun physical_registry_profile_count_v7(self: &PhysicalRegistryV7): u64 {
    self.profiles.length()
}
public fun physical_registry_family_count_v7(self: &PhysicalRegistryV7): u64 {
    self.family_count
}
public fun physical_registry_product_count_v7(self: &PhysicalRegistryV7): u64 {
    self.product_count
}
public fun physical_registry_wardrobe_count_v7(self: &PhysicalRegistryV7): u64 {
    self.wardrobe_count
}
public fun free_style_claimed_v7(
    self: &PhysicalRegistryV7,
    style_product_id: ID,
    wallet: address,
): bool {
    self.free_style_claims.contains(FreeStyleClaimKeyV7 {
        style_product_id,
        wallet,
    })
}
public fun physical_profile_id_v7(self: &MakerPhysicalProfileV7): ID {
    object::id(self)
}
public fun physical_profile_v6_id_v7(self: &MakerPhysicalProfileV7): ID {
    self.v6_profile_id
}
public fun physical_profile_root_id_v7(self: &MakerPhysicalProfileV7): ID {
    self.root_id
}
public fun physical_profile_sealed_v7(self: &MakerPhysicalProfileV7): bool {
    self.sealed
}
public fun physical_profile_slot_schema_commitment_v7(
    self: &MakerPhysicalProfileV7,
): &vector<u8> {
    &self.slot_schema_commitment
}
public fun physical_profile_renderer_commitment_v7(
    self: &MakerPhysicalProfileV7,
): &vector<u8> {
    &self.renderer_commitment
}
public fun physical_profile_required_slot_keys_v7(
    self: &MakerPhysicalProfileV7,
): &vector<String> {
    &self.required_slot_keys
}
public fun physical_profile_part_policy_count_v7(
    self: &MakerPhysicalProfileV7,
): u64 {
    self.part_policy_count
}
/// Soulidity uses this in its atomic Soul mint adapter. A Soul's provenance
/// root and v6 appearance profile must resolve to this exact immutable v7
/// profile; matching only one identifier is not sufficient.
public fun assert_physical_profile_binding_v7(
    self: &MakerPhysicalProfileV7,
    expected_root_id: ID,
    expected_v6_profile_id: ID,
    expected_slot_schema_commitment: &vector<u8>,
    expected_renderer_commitment: &vector<u8>,
) {
    assert!(self.sealed, EProfileNotSealed);
    assert!(self.root_id == expected_root_id, EProtocolMismatch);
    assert!(self.v6_profile_id == expected_v6_profile_id, EProtocolMismatch);
    assert!(
        &self.slot_schema_commitment == expected_slot_schema_commitment,
        EProtocolMismatch,
    );
    assert!(
        &self.renderer_commitment == expected_renderer_commitment,
        EProtocolMismatch,
    );
}
public fun part_policy_v7(
    profile: &MakerPhysicalProfileV7,
    slot_key: String,
): &PartPolicyV7 {
    profile.part_policies.borrow(PartPolicyKeyV7 { slot_key })
}
public fun part_policy_behavior_v7(self: &PartPolicyV7): u8 { self.behavior }
public fun part_policy_slot_key_v7(self: &PartPolicyV7): &String {
    &self.slot_key
}
public fun part_policy_required_v7(self: &PartPolicyV7): bool { self.required }
public fun part_policy_max_source_kind_v7(self: &PartPolicyV7): u8 {
    self.max_source_kind
}
public fun family_id_v7(self: &ItemFamilyV7): ID { object::id(self) }
public fun family_profile_id_v7(self: &ItemFamilyV7): ID { self.profile_id }
public fun family_seed_v6_product_id_v7(self: &ItemFamilyV7): ID {
    self.seed_v6_product_id
}
public fun family_creator_v7(self: &ItemFamilyV7): address { self.creator }
public fun family_slot_key_v7(self: &ItemFamilyV7): &String { &self.slot_key }
public fun family_key_v7(self: &ItemFamilyV7): &String { &self.family_key }
public fun family_label_v7(self: &ItemFamilyV7): &String { &self.label }
public fun family_commitment_v7(self: &ItemFamilyV7): &vector<u8> {
    &self.family_commitment
}
public fun family_rights_origin_v7(self: &ItemFamilyV7): u8 {
    self.rights_origin
}
public fun style_product_id_v7(self: &StyleProductV7): ID { object::id(self) }
public fun style_product_profile_id_v7(self: &StyleProductV7): ID {
    self.profile_id
}
public fun style_product_v6_profile_id_v7(self: &StyleProductV7): ID {
    self.v6_profile_id
}
public fun style_product_family_id_v7(self: &StyleProductV7): ID { self.family_id }
public fun style_product_v6_id_v7(self: &StyleProductV7): ID { self.v6_product_id }
public fun style_product_creator_v7(self: &StyleProductV7): address {
    self.original_creator
}
public fun style_product_slot_key_v7(self: &StyleProductV7): &String {
    &self.slot_key
}
public fun style_product_style_key_v7(self: &StyleProductV7): &String {
    &self.style_key
}
public fun style_product_recipe_item_key_v7(self: &StyleProductV7): &String {
    &self.recipe_item_key
}
public fun style_product_label_v7(self: &StyleProductV7): &String {
    &self.label
}
public fun style_product_source_kind_v7(self: &StyleProductV7): u8 {
    self.source_kind
}
public fun style_product_entitlement_kind_v7(self: &StyleProductV7): u8 {
    self.entitlement_kind
}
public fun style_product_pack_key_v7(self: &StyleProductV7): &Option<String> {
    &self.pack_key
}
public fun style_product_supply_kind_v7(self: &StyleProductV7): u8 {
    self.supply_kind
}
public fun style_product_max_supply_v7(self: &StyleProductV7): u64 {
    self.max_supply
}
public fun style_product_minted_supply_v7(self: &StyleProductV7): u64 {
    self.minted_supply
}
public fun style_product_available_v7(self: &StyleProductV7): bool {
    self.active
        && (self.supply_kind != SUPPLY_LIMITED_EDITION
            || self.minted_supply < self.max_supply)
}
public fun style_product_price_atomic_v7(self: &StyleProductV7): u64 {
    self.price_atomic
}
public fun style_product_protocol_fee_bps_v7(self: &StyleProductV7): u16 {
    self.protocol_fee_bps
}
public fun style_product_maker_fee_bps_v7(self: &StyleProductV7): u16 {
    self.maker_ecosystem_fee_bps
}
public fun style_product_active_v7(self: &StyleProductV7): bool { self.active }
public fun style_product_transferable_v7(self: &StyleProductV7): bool {
    self.transferable
}
public fun style_product_definition_commitment_v7(
    self: &StyleProductV7,
): &vector<u8> {
    &self.definition_commitment
}
public fun style_product_asset_commitment_v7(
    self: &StyleProductV7,
): &vector<u8> {
    &self.asset_commitment
}
public fun style_product_definition_blob_id_v7(
    self: &StyleProductV7,
): &String {
    &self.definition_blob_id
}
public fun style_product_definition_identifier_v7(
    self: &StyleProductV7,
): &String {
    &self.definition_identifier
}
public fun style_product_asset_blob_id_v7(
    self: &StyleProductV7,
): &String {
    &self.asset_blob_id
}
public fun style_product_asset_identifier_v7(
    self: &StyleProductV7,
): &String {
    &self.asset_identifier
}
public fun style_product_renderer_commitment_v7(
    self: &StyleProductV7,
): &vector<u8> {
    &self.renderer_commitment
}
public fun style_product_required_v6_ids_v7(
    self: &StyleProductV7,
): &vector<ID> {
    &self.required_v6_product_ids
}
public fun style_product_excluded_v6_ids_v7(
    self: &StyleProductV7,
): &vector<ID> {
    &self.excluded_v6_product_ids
}
public fun style_asset_id_v7(self: &StyleAssetV7): ID { object::id(self) }
public fun style_asset_product_id_v7(self: &StyleAssetV7): ID {
    self.style_product_id
}
public fun style_asset_family_id_v7(self: &StyleAssetV7): ID { self.family_id }
public fun style_asset_v6_product_id_v7(self: &StyleAssetV7): ID {
    self.v6_product_id
}
public fun style_asset_original_creator_v7(self: &StyleAssetV7): address {
    self.original_creator
}
public fun style_asset_slot_key_v7(self: &StyleAssetV7): &String { &self.slot_key }
public fun style_asset_kind_v7(self: &StyleAssetV7): u8 { self.asset_kind }
public fun style_asset_serial_v7(self: &StyleAssetV7): u64 { self.serial }
public fun style_asset_holder_v7(self: &StyleAssetV7): address { self.holder }
public fun style_asset_transferable_v7(self: &StyleAssetV7): bool {
    self.transferable
}
public fun style_asset_source_kind_v7(self: &StyleAssetV7): u8 {
    self.source_kind
}
public fun style_asset_bound_soul_id_v7(self: &StyleAssetV7): Option<ID> {
    self.bound_soul_id
}
public fun style_asset_ownership_epoch_v7(self: &StyleAssetV7): u64 {
    self.ownership_epoch
}
public fun style_asset_required_v6_ids_v7(
    self: &StyleAssetV7,
): &vector<ID> {
    &self.required_v6_product_ids
}
public fun style_asset_excluded_v6_ids_v7(
    self: &StyleAssetV7,
): &vector<ID> {
    &self.excluded_v6_product_ids
}
public fun wardrobe_id_v7(self: &SoulWardrobeV7): ID { object::id(self) }
public fun wardrobe_soul_id_v7(self: &SoulWardrobeV7): ID { self.soul_id }
public fun wardrobe_profile_id_v7(self: &SoulWardrobeV7): ID { self.profile_id }
public fun wardrobe_root_id_v7(self: &SoulWardrobeV7): ID { self.root_id }
public fun wardrobe_slot_schema_commitment_v7(
    self: &SoulWardrobeV7,
): &vector<u8> {
    &self.slot_schema_commitment
}
public fun wardrobe_revision_v7(self: &SoulWardrobeV7): u64 { self.revision }
public fun wardrobe_initialized_v7(self: &SoulWardrobeV7): bool { self.initialized }
public fun wardrobe_listed_v7(self: &SoulWardrobeV7): bool { self.listed }
public fun wardrobe_external_asset_count_v7(self: &SoulWardrobeV7): u64 {
    self.external_asset_count
}
public fun wardrobe_soul_local_asset_count_v7(self: &SoulWardrobeV7): u64 {
    self.soul_local_asset_count
}
public fun wardrobe_equipped_count_v7(self: &SoulWardrobeV7): u64 {
    self.equipped_count
}
public fun wardrobe_initial_style_products_v7(self: &SoulWardrobeV7): &vector<ID> {
    &self.initial_style_product_ids
}
public fun wardrobe_authorized_initial_style_products_v7(
    self: &SoulWardrobeV7,
): &vector<ID> {
    &self.authorized_initial_style_product_ids
}
public fun wardrobe_initial_authorization_commitment_v7(
    self: &SoulWardrobeV7,
): &vector<u8> {
    &self.initial_authorization_commitment
}
public fun wardrobe_initial_recipe_hash_v7(
    self: &SoulWardrobeV7,
): &vector<u8> {
    &self.initial_recipe_hash
}
public fun wardrobe_initial_asset_ids_v7(self: &SoulWardrobeV7): &vector<ID> {
    &self.initial_asset_ids
}
public fun wardrobe_initial_style_for_slot_v7(
    self: &SoulWardrobeV7,
    slot_key: String,
): Option<ID> {
    let key = PartPolicyKeyV7 { slot_key };
    if (self.initial_product_by_slot.contains(key)) {
        option::some(*self.initial_product_by_slot.borrow(key))
    } else {
        option::none()
    }
}
public fun wardrobe_equipped_asset_v7(
    self: &SoulWardrobeV7,
    slot_key: String,
): Option<ID> {
    let key = PartPolicyKeyV7 { slot_key };
    if (self.equipped_by_slot.contains(key)) {
        option::some(*self.equipped_by_slot.borrow(key))
    } else {
        option::none()
    }
}
public fun wardrobe_has_asset_v7(self: &SoulWardrobeV7, asset_id: ID): bool {
    self.inventory.contains(asset_id)
}
public fun wardrobe_custody_record_v7(
    self: &SoulWardrobeV7,
    asset_id: ID,
): &CustodyRecordV7 {
    self.inventory.borrow(asset_id)
}
public fun custody_style_product_id_v7(self: &CustodyRecordV7): ID {
    self.style_product_id
}
public fun custody_family_id_v7(self: &CustodyRecordV7): ID { self.family_id }
public fun custody_v6_product_id_v7(self: &CustodyRecordV7): ID {
    self.v6_product_id
}
public fun custody_slot_key_v7(self: &CustodyRecordV7): &String {
    &self.slot_key
}
public fun custody_source_kind_v7(self: &CustodyRecordV7): u8 {
    self.source_kind
}
public fun custody_asset_kind_v7(self: &CustodyRecordV7): u8 {
    self.asset_kind
}
public fun custody_bound_soul_id_v7(self: &CustodyRecordV7): Option<ID> {
    self.bound_soul_id
}
public fun custody_equipped_v7(self: &CustodyRecordV7): bool { self.equipped }
public fun custody_required_v6_ids_v7(
    self: &CustodyRecordV7,
): &vector<ID> {
    &self.required_v6_product_ids
}
public fun custody_excluded_v6_ids_v7(
    self: &CustodyRecordV7,
): &vector<ID> {
    &self.excluded_v6_product_ids
}

// --- Invariants ----------------------------------------------------------

fun assert_admin(config: &PhysicalProtocolConfigV7, admin: &PhysicalAdminCapV7) {
    assert!(admin.config_id == object::id(config), EInvalidAdmin);
}

fun assert_registry(config: &PhysicalProtocolConfigV7, registry: &PhysicalRegistryV7) {
    assert!(registry.config_id == object::id(config), EProtocolMismatch);
    assert!(object::id(registry) == config.registry_id, EProtocolMismatch);
}

fun assert_publication_gate(
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
) {
    assert!(config.enabled, EProtocolDisabled);
    assert!(composition::protocol_enabled_v6(v6_config), EProtocolDisabled);
    commerce::assert_extension_protocol_enabled_v5(v5_config);
    assert_config_links(config, v6_config, v5_config);
}

fun assert_config_links(
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    v5_config: &CommerceProtocolConfigV5,
) {
    assert!(config.v6_config_id == object::id(v6_config), EProtocolMismatch);
    assert!(config.v5_config_id == object::id(v5_config), EProtocolMismatch);
    assert!(
        composition::protocol_v5_config_id_v6(v6_config) == object::id(v5_config),
        EProtocolMismatch,
    );
}

fun assert_config_profile(
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
) {
    assert!(profile.config_id == object::id(config), EProtocolMismatch);
}

fun assert_v6_profile_link(
    config: &PhysicalProtocolConfigV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
) {
    assert!(
        composition::profile_config_id_v6(v6_profile) == config.v6_config_id,
        EProtocolMismatch,
    );
    assert!(
        composition::profile_root_id_v6(v6_profile) == object::id(root),
        EProtocolMismatch,
    );
}

fun assert_v6_product_link(
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
) {
    assert!(profile.v6_profile_id == object::id(v6_profile), EProtocolMismatch);
    assert!(
        composition::product_config_id_v6(v6_product) == config.v6_config_id,
        EProtocolMismatch,
    );
    assert!(
        composition::product_slot_schema_commitment_v6(v6_product)
            == &profile.slot_schema_commitment,
        EProtocolMismatch,
    );
    assert!(
        profile.part_policies.contains(PartPolicyKeyV7 {
            slot_key: *composition::product_slot_key_v6(v6_product),
        }),
        EPartPolicyMissing,
    );
}

fun assert_operational(
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
) {
    assert_publication_gate(config, v6_config, v5_config);
    assert_config_profile(config, profile);
    assert!(profile.sealed, EProfileNotSealed);
    assert!(profile.v6_profile_id == object::id(v6_profile), EProtocolMismatch);
    assert_v6_profile_link(config, v6_profile, root);
    commerce::assert_extension_operational_v5(root, v5_config);
}

fun assert_owner_action<OwnerProof: drop>(
    wardrobe: &SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    soul_id: ID,
    _proof: OwnerProof,
) {
    assert_owner_proof<OwnerProof>(config);
    assert_operational(config, v6_config, profile, v6_profile, root, v5_config);
    assert_wardrobe_config(wardrobe, config);
    assert!(wardrobe.profile_id == object::id(profile), EProtocolMismatch);
    assert!(wardrobe.root_id == object::id(root), EProtocolMismatch);
    assert!(wardrobe.soul_id == soul_id, EInvalidSoul);
}

fun assert_wardrobe_config(
    wardrobe: &SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
) {
    assert!(wardrobe.config_id == object::id(config), EProtocolMismatch);
}

fun assert_owner_proof<Proof: drop>(config: &PhysicalProtocolConfigV7) {
    assert!(
        &defining_type_name<Proof>() == &config.soul_owner_proof_type,
        EOwnerProofMismatch,
    );
}

fun assert_listing_proof<Proof: drop>(config: &PhysicalProtocolConfigV7) {
    assert!(config.listing_proof_type.is_some(), EDependencyMissing);
    assert!(
        &defining_type_name<Proof>() == config.listing_proof_type.borrow(),
        EListingProofMismatch,
    );
}

fun assert_part_policy(
    behavior: u8,
    required: bool,
    max_source_kind: u8,
    slot_key: &String,
) {
    assert_non_empty(slot_key);
    assert!(behavior <= PART_HYBRID, EInvalidPartPolicy);
    assert!(max_source_kind <= SOURCE_OPEN, EInvalidPartPolicy);
    if (behavior == PART_FIXED || behavior == PART_SOUL_LOCAL) {
        assert!(max_source_kind == SOURCE_OFFICIAL, EInvalidPartPolicy);
    };
    // A required Open slot can neither receive a Soul-local initial Style nor
    // be empty at finalization, making every Soul unmintable. Hybrid is the
    // safe required+external form because its immutable initial Soul-local
    // Style remains in custody and can be swapped back before transfer/listing.
    assert!(!(required && behavior == PART_OPEN), EInvalidPartPolicy);
}

fun part_policy(
    profile: &MakerPhysicalProfileV7,
    slot_key: String,
): &PartPolicyV7 {
    let key = PartPolicyKeyV7 { slot_key };
    assert!(profile.part_policies.contains(key), EPartPolicyMissing);
    profile.part_policies.borrow(key)
}

fun assert_supply(v6_product: &ItemProductV6, supply_kind: u8, max_supply: u64) {
    assert!(supply_kind <= SUPPLY_LIMITED_EDITION, EInvalidSupply);
    if (supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED) {
        assert!(max_supply == 0, EInvalidSupply);
        assert!(
            composition::product_access_kind_v6(v6_product)
                == composition::access_embedded_v6()
                && composition::product_binding_kind_v6(v6_product)
                    == composition::binding_embedded_v6()
                && !composition::product_transferable_v6(v6_product),
            EInvalidBinding,
        );
        assert!(
            composition::product_origin_kind_v6(v6_product)
                == composition::origin_official_v6(),
            ESourceForbidden,
        );
    } else {
        assert!(
            composition::product_binding_kind_v6(v6_product)
                == composition::binding_owned_v6(),
            EInvalidBinding,
        );
        assert!(
            composition::product_access_kind_v6(v6_product)
                == composition::access_free_v6()
                || composition::product_access_kind_v6(v6_product)
                    == composition::access_paid_v6(),
            EWrongAccessKind,
        );
        if (supply_kind == SUPPLY_OPEN_EDITION) {
            assert!(max_supply == 0, EInvalidSupply);
        } else {
            assert!(max_supply > 0, EInvalidSupply);
        };
    };
}

fun entitlement_kind_for_v6_product(
    v6_product: &ItemProductV6,
    supply_kind: u8,
    pack_key: &Option<String>,
): u8 {
    if (supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED) {
        if (pack_key.is_some()) {
            ENTITLEMENT_PACK_INCLUDED
        } else {
            ENTITLEMENT_BASE_INCLUDED
        }
    } else if (
        composition::product_access_kind_v6(v6_product)
            == composition::access_free_v6()
    ) {
        ENTITLEMENT_WALLET_FREE
    } else {
        assert!(
            composition::product_access_kind_v6(v6_product)
                == composition::access_paid_v6(),
            EWrongAccessKind,
        );
        ENTITLEMENT_WALLET_PAID
    }
}

fun assert_included_entitlement_kind(product: &StyleProductV7) {
    assert!(
        product.entitlement_kind == ENTITLEMENT_BASE_INCLUDED
            || product.entitlement_kind == ENTITLEMENT_PACK_INCLUDED,
        EWrongAccessKind,
    );
    if (product.entitlement_kind == ENTITLEMENT_PACK_INCLUDED) {
        assert!(product.pack_key.is_some(), EWrongAccessKind);
    } else {
        assert!(product.pack_key.is_none(), EWrongAccessKind);
    };
}

fun assert_postmint_included_entitlement(
    root: &MakerRootV5,
    product: &StyleProductV7,
    owner: address,
) {
    assert_included_entitlement_kind(product);
    let entitled = if (product.entitlement_kind == ENTITLEMENT_PACK_INCLUDED) {
        commerce::has_pack_entitlement_v5(
            root,
            *product.pack_key.borrow(),
            owner,
        )
    } else {
        commerce::has_base_entitlement_v5(root, owner)
    };
    assert!(entitled, EEntitlementMissing);
}

/// Rejects unsellable definitions at publication time instead of accepting
/// payment and discovering only later that the target Part can never equip
/// the asset kind/source.
fun assert_product_part_compatible(
    profile: &MakerPhysicalProfileV7,
    v6_product: &ItemProductV6,
    supply_kind: u8,
) {
    let policy = part_policy(profile, *composition::product_slot_key_v6(v6_product));
    let source_kind = composition::product_origin_kind_v6(v6_product);
    assert_supply_part_policy_compatible(policy, source_kind, supply_kind);
}

fun assert_supply_part_policy_compatible(
    policy: &PartPolicyV7,
    source_kind: u8,
    supply_kind: u8,
) {
    assert!(source_kind <= policy.max_source_kind, ESourceForbidden);
    if (supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED) {
        assert!(source_kind == SOURCE_OFFICIAL, ESourceForbidden);
        assert!(
            policy.behavior == PART_FIXED
                || policy.behavior == PART_SOUL_LOCAL
                || policy.behavior == PART_HYBRID,
            ESourceForbidden,
        );
    } else {
        assert!(
            policy.behavior == PART_OPEN || policy.behavior == PART_HYBRID,
            ESourceForbidden,
        );
    };
}

fun assert_supply_available(product: &StyleProductV7) {
    assert!(product.active, EStyleInactive);
    if (product.supply_kind == SUPPLY_LIMITED_EDITION) {
        assert!(product.minted_supply < product.max_supply, ESoldOut);
    };
}

fun assert_style_sale_link(
    v7_config: &PhysicalProtocolConfigV7,
    style_product: &StyleProductV7,
    v6_config: &CompositionProtocolConfigV6,
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
) {
    assert!(v7_config.enabled, EProtocolDisabled);
    assert!(composition::protocol_enabled_v6(v6_config), EProtocolDisabled);
    assert!(style_product.config_id == object::id(v7_config), EProtocolMismatch);
    assert!(style_product.v6_profile_id == object::id(v6_profile), EProtocolMismatch);
    assert!(style_product.v6_product_id == object::id(v6_product), EWrongProduct);
    assert!(composition::product_config_id_v6(v6_product) == object::id(v6_config), EProtocolMismatch);
    assert_product_admitted(v6_profile, style_product);
    assert!(style_product.active, EStyleInactive);
}

/// v6 admission is the Maker/governance kill switch for a concrete product.
/// Presence alone is insufficient: a revoked record must fail every *new*
/// mint/deposit/equip path. Recovery operations intentionally do not call
/// this helper, so unequip, withdraw and legacy receipt materialization stay
/// available while a product is contained.
fun assert_v6_admission_active(
    v6_profile: &MakerProfileV6,
    v6_product_id: ID,
) {
    assert!(
        composition::item_is_admitted_v6(v6_profile, v6_product_id),
        EProductNotAdmitted,
    );
    assert!(
        composition::admission_active_v6(v6_profile, v6_product_id),
        EProductNotAdmitted,
    );
}

fun assert_v6_admission_source(
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
) {
    let product_id = object::id(v6_product);
    assert_v6_admission_active(v6_profile, product_id);
    assert!(
        composition::admission_source_kind_v6(v6_profile, product_id)
            == composition::product_origin_kind_v6(v6_product),
        ESourceForbidden,
    );
}

fun assert_family_seed_unregistered(
    registry: &PhysicalRegistryV7,
    v6_product_id: ID,
) {
    assert!(
        !registry.family_seed_products.contains(v6_product_id),
        EFamilyAlreadyExists,
    );
}

fun assert_style_product_unregistered(
    registry: &PhysicalRegistryV7,
    v6_product_id: ID,
) {
    assert!(
        !registry.style_products.contains(v6_product_id),
        EProductAlreadyExists,
    );
}

fun assert_external_publication_authority(
    v6_profile: &MakerProfileV6,
    v6_product: &ItemProductV6,
    ctx: &TxContext,
) {
    let origin = composition::product_origin_kind_v6(v6_product);
    assert!(
        origin == composition::origin_certified_v6()
            || origin == composition::origin_open_v6(),
        ESourceForbidden,
    );
    assert_v6_admission_source(v6_profile, v6_product);
    assert!(
        composition::product_original_creator_v6(v6_product) == ctx.sender()
            && composition::product_publisher_v6(v6_product) == ctx.sender(),
        ENotStyleCreator,
    );
}

fun assert_product_admitted(
    v6_profile: &MakerProfileV6,
    product: &StyleProductV7,
) {
    assert!(product.v6_profile_id == object::id(v6_profile), EProtocolMismatch);
    assert_v6_admission_active(v6_profile, product.v6_product_id);
}

fun assert_asset_product(
    wardrobe: &SoulWardrobeV7,
    product: &StyleProductV7,
    asset: &StyleAssetV7,
) {
    assert!(product.config_id == wardrobe.config_id, EProtocolMismatch);
    assert!(product.profile_id == wardrobe.profile_id, EProtocolMismatch);
    assert!(asset.config_id == wardrobe.config_id, EAssetMismatch);
    assert!(asset.profile_id == wardrobe.profile_id, EAssetMismatch);
    assert!(asset.style_product_id == object::id(product), EAssetMismatch);
    assert!(asset.family_id == product.family_id, EAssetMismatch);
    assert!(&asset.slot_key == &product.slot_key, EWrongSlot);
}

fun assert_part_accepts_asset(
    profile: &MakerPhysicalProfileV7,
    asset: &StyleAssetV7,
) {
    let policy = part_policy(profile, *&asset.slot_key);
    assert!(policy.behavior != PART_FIXED, EFixedPart);
    assert!(asset.source_kind <= policy.max_source_kind, ESourceForbidden);
    if (asset.asset_kind == ASSET_SOUL_LOCAL) {
        assert!(
            policy.behavior == PART_SOUL_LOCAL || policy.behavior == PART_HYBRID,
            ESourceForbidden,
        );
    } else {
        assert!(
            policy.behavior == PART_OPEN || policy.behavior == PART_HYBRID,
            ESourceForbidden,
        );
    };
}

fun assert_initial_part_accepts_asset(
    profile: &MakerPhysicalProfileV7,
    asset: &StyleAssetV7,
) {
    let policy = part_policy(profile, *&asset.slot_key);
    assert!(asset.source_kind <= policy.max_source_kind, ESourceForbidden);
    assert!(asset.asset_kind == ASSET_SOUL_LOCAL, EAssetMismatch);
    assert!(asset.source_kind == SOURCE_OFFICIAL, ESourceForbidden);
    assert!(
        policy.behavior == PART_FIXED
            || policy.behavior == PART_SOUL_LOCAL
            || policy.behavior == PART_HYBRID,
        ESourceForbidden,
    );
}

fun assert_part_can_unequip(policy: &PartPolicyV7) {
    assert!(policy.behavior != PART_FIXED, EFixedPart);
    assert!(!policy.required, ERequiredPart);
}

fun assert_withdrawable_asset(asset: &StyleAssetV7, record: &CustodyRecordV7) {
    assert!(asset.asset_kind == ASSET_OWNED, ESoulLocalWithdrawal);
    assert!(record.asset_kind == ASSET_OWNED, EAssetMismatch);
}

fun assert_wardrobe_mutable(wardrobe: &SoulWardrobeV7, expected_revision: u64) {
    assert!(wardrobe.initialized, EWardrobeNotInitialized);
    assert!(!wardrobe.listed, EWardrobeListed);
    assert!(wardrobe.revision == expected_revision, EStaleRevision);
}

fun assert_equipped_rules(wardrobe: &SoulWardrobeV7) {
    let mut i = 0;
    while (i < wardrobe.equipped_asset_ids.length()) {
        let asset_id = *wardrobe.equipped_asset_ids.borrow(i);
        let record = wardrobe.inventory.borrow(asset_id);
        assert!(record.equipped, ERuleViolation);
        let mut required_index = 0;
        while (required_index < record.required_v6_product_ids.length()) {
            assert!(
                equipped_contains_v6_product(
                    wardrobe,
                    *record.required_v6_product_ids.borrow(required_index),
                ),
                ERuleViolation,
            );
            required_index = required_index + 1;
        };
        let mut excluded_index = 0;
        while (excluded_index < record.excluded_v6_product_ids.length()) {
            assert!(
                !equipped_contains_v6_product(
                    wardrobe,
                    *record.excluded_v6_product_ids.borrow(excluded_index),
                ),
                ERuleViolation,
            );
            excluded_index = excluded_index + 1;
        };
        i = i + 1;
    };
}

fun equipped_contains_v6_product(wardrobe: &SoulWardrobeV7, product_id: ID): bool {
    let mut i = 0;
    while (i < wardrobe.equipped_asset_ids.length()) {
        let asset_id = *wardrobe.equipped_asset_ids.borrow(i);
        if (wardrobe.inventory.borrow(asset_id).v6_product_id == product_id) {
            return true
        };
        i = i + 1;
    };
    false
}

fun vector_contains_id(values: &vector<ID>, value: ID): bool {
    let mut i = 0;
    while (i < values.length()) {
        if (*values.borrow(i) == value) {
            return true
        };
        i = i + 1;
    };
    false
}

fun replace_equipped_id(values: &mut vector<ID>, old: ID, new: ID) {
    let mut i = 0;
    while (i < values.length()) {
        if (*values.borrow(i) == old) {
            *values.borrow_mut(i) = new;
            return
        };
        i = i + 1;
    };
    abort EAssetNotEquipped
}

fun remove_equipped_id(values: &mut vector<ID>, value: ID) {
    let mut i = 0;
    while (i < values.length()) {
        if (*values.borrow(i) == value) {
            let _ = values.remove(i);
            return
        };
        i = i + 1;
    };
    abort EAssetNotEquipped
}

fun increment_revision(wardrobe: &mut SoulWardrobeV7) {
    wardrobe.revision = wardrobe.revision + 1;
}

fun emit_wardrobe(
    wardrobe: &SoulWardrobeV7,
    asset_id: ID,
    slot_key: String,
    operation: u8,
) {
    event::emit(WardrobeMutationV7 {
        wardrobe_id: object::id(wardrobe),
        soul_id: wardrobe.soul_id,
        asset_id,
        slot_key,
        operation,
        revision: wardrobe.revision,
    });
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
}

fun assert_non_empty(value: &String) {
    assert!(string::as_bytes(value).length() > 0, EInvalidString);
}

fun assert_locator_identifier(value: &String) {
    assert!(
        string::as_bytes(value).length() <= MAX_DEFINITION_IDENTIFIER_BYTES,
        EInvalidString,
    );
}

fun defining_type_name<T>(): String {
    string::from_ascii(type_name::with_defining_ids<T>().into_string())
}

#[test_only]
public struct TrustedOwnerProofV7 has drop {}
#[test_only]
public struct TrustedListingProofV7 has drop {}

#[test_only]
public fun trusted_owner_proof_v7(): TrustedOwnerProofV7 { TrustedOwnerProofV7 {} }
#[test_only]
public fun trusted_listing_proof_v7(): TrustedListingProofV7 {
    TrustedListingProofV7 {}
}

#[test_only]
fun test_hash(value: u8): vector<u8> {
    let mut result = vector[];
    let mut i = 0;
    while (i < HASH_LENGTH) {
        result.push_back(value);
        i = i + 1;
    };
    result
}

#[test_only]
fun test_protocol(
    ctx: &mut TxContext,
): (PhysicalProtocolConfigV7, PhysicalRegistryV7) {
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let registry = PhysicalRegistryV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        profiles: table::new(ctx),
        family_seed_products: table::new(ctx),
        style_products: table::new(ctx),
        wardrobes: table::new(ctx),
        free_style_claims: table::new(ctx),
        family_count: 0,
        product_count: 0,
        wardrobe_count: 0,
    };
    let config = PhysicalProtocolConfigV7 {
        id: config_uid,
        version: VERSION,
        v6_config_id: object::id_from_address(@0x6006),
        v5_config_id: object::id_from_address(@0x5005),
        v6_admin_cap_id: object::id_from_address(@0xA006),
        registry_id: object::id(&registry),
        soul_owner_proof_type: defining_type_name<TrustedOwnerProofV7>(),
        listing_proof_type: option::some(defining_type_name<TrustedListingProofV7>()),
        enabled: true,
    };
    (config, registry)
}

#[test_only]
fun test_profile(
    config_id: ID,
    required: bool,
    behavior: u8,
    ctx: &mut TxContext,
): MakerPhysicalProfileV7 {
    let slot_key = b"body".to_string();
    let mut policies = table::new(ctx);
    policies.add(
        PartPolicyKeyV7 { slot_key: *&slot_key },
        PartPolicyV7 {
            slot_key: *&slot_key,
            behavior,
            required,
            max_source_kind: if (behavior == PART_OPEN || behavior == PART_HYBRID) {
                SOURCE_OPEN
            } else {
                SOURCE_OFFICIAL
            },
        },
    );
    MakerPhysicalProfileV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        v6_profile_id: object::id_from_address(@0x6007),
        root_id: object::id_from_address(@0x5007),
        slot_schema_commitment: test_hash(7),
        renderer_commitment: test_hash(8),
        part_policies: policies,
        required_slot_keys: if (required) { vector[slot_key] } else { vector[] },
        part_policy_count: 1,
        sealed: true,
    }
}

#[test_only]
fun test_style_product(
    config_id: ID,
    profile_id: ID,
    supply_kind: u8,
    max_supply: u64,
    minted_supply: u64,
    v6_product_id: ID,
    required_v6_product_ids: vector<ID>,
    excluded_v6_product_ids: vector<ID>,
    ctx: &mut TxContext,
): StyleProductV7 {
    StyleProductV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        profile_id,
        v6_profile_id: object::id_from_address(@0x6007),
        family_id: object::id_from_address(@0xF007),
        v6_product_id,
        original_creator: @0xA11,
        slot_key: b"body".to_string(),
        style_key: b"test-style".to_string(),
        recipe_item_key: b"base".to_string(),
        label: b"Test style".to_string(),
        source_kind: SOURCE_OFFICIAL,
        entitlement_kind: if (supply_kind == SUPPLY_SOUL_LOCAL_INCLUDED) {
            ENTITLEMENT_BASE_INCLUDED
        } else {
            ENTITLEMENT_WALLET_FREE
        },
        pack_key: option::none(),
        supply_kind,
        max_supply,
        minted_supply,
        price_atomic: 0,
        protocol_fee_bps: 1000,
        maker_ecosystem_fee_bps: 9000,
        transferable: true,
        definition_commitment: test_hash(11),
        asset_commitment: test_hash(12),
        definition_blob_id: b"definition-blob".to_string(),
        definition_identifier: b"definition.json".to_string(),
        asset_blob_id: b"asset-blob".to_string(),
        asset_identifier: b"style.png".to_string(),
        renderer_commitment: test_hash(8),
        required_v6_product_ids,
        excluded_v6_product_ids,
        active: true,
    }
}

#[test_only]
fun test_wardrobe(
    config_id: ID,
    profile: &MakerPhysicalProfileV7,
    initialized: bool,
    ctx: &mut TxContext,
): SoulWardrobeV7 {
    SoulWardrobeV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id,
        profile_id: object::id(profile),
        root_id: profile.root_id,
        soul_id: object::id_from_address(@0x5071),
        slot_schema_commitment: *&profile.slot_schema_commitment,
        revision: 0,
        initialized,
        listed: false,
        inventory: table::new(ctx),
        claimed_included_products: table::new(ctx),
        equipped_by_slot: table::new(ctx),
        equipped_asset_ids: vector[],
        initial_product_by_slot: table::new(ctx),
        authorized_initial_style_product_ids: vector[],
        initial_recipe_hash: test_hash(96),
        initial_authorization_commitment: test_hash(97),
        initial_style_product_ids: vector[],
        initial_asset_ids: vector[],
        external_asset_count: 0,
        soul_local_asset_count: 0,
        equipped_count: 0,
    }
}

#[test_only]
fun test_owned_asset(
    product: &StyleProductV7,
    holder: address,
    ctx: &mut TxContext,
): StyleAssetV7 {
    StyleAssetV7 {
        id: object::new(ctx),
        version: VERSION,
        config_id: product.config_id,
        profile_id: product.profile_id,
        family_id: product.family_id,
        style_product_id: object::id(product),
        v6_product_id: product.v6_product_id,
        original_creator: product.original_creator,
        slot_key: *&product.slot_key,
        source_kind: product.source_kind,
        asset_kind: ASSET_OWNED,
        serial: 1,
        transferable: product.transferable,
        holder,
        bound_soul_id: option::none(),
        ownership_epoch: 0,
        required_v6_product_ids: *&product.required_v6_product_ids,
        excluded_v6_product_ids: *&product.excluded_v6_product_ids,
    }
}

#[test]
fun owned_style_child_deposit_equip_unequip_withdraw_round_trip() {
    let sender = @0xA11;
    let mut scenario = sui::test_scenario::begin(sender);
    let asset_id;
    {
        let ctx = scenario.ctx();
        let config_id = object::id_from_address(@0x7007);
        let profile = test_profile(config_id, false, PART_HYBRID, ctx);
        let mut product = test_style_product(
            config_id,
            object::id(&profile),
            SUPPLY_OPEN_EDITION,
            0,
            0,
            object::id_from_address(@0x7101),
            vector[],
            vector[],
            ctx,
        );
        let wardrobe = test_wardrobe(config_id, &profile, true, ctx);
        let asset = test_owned_asset(&product, sender, ctx);
        // Creator deactivation stops new issuance, not use of an asset that
        // the wallet already owns. v6 admission remains active in production.
        product.active = false;
        asset_id = object::id(&asset);
        transfer::share_object(profile);
        transfer::share_object(product);
        transfer::share_object(wardrobe);
        transfer::transfer(asset, sender);
    };

    scenario.next_tx(sender);
    {
        let profile = scenario.take_shared<MakerPhysicalProfileV7>();
        let product = scenario.take_shared<StyleProductV7>();
        let mut wardrobe = scenario.take_shared<SoulWardrobeV7>();
        let asset = scenario.take_from_sender_by_id<StyleAssetV7>(asset_id);
        deposit_and_equip_internal(
            &mut wardrobe,
            &profile,
            &product,
            asset,
            0,
            scenario.ctx(),
        );
        assert!(wardrobe.external_asset_count == 1);
        assert!(wardrobe.equipped_count == 1);
        assert!(wardrobe.revision == 1);
        let custody = wardrobe.inventory.borrow(asset_id);
        assert!(custody.bound_soul_id.is_some());
        assert!(*custody.bound_soul_id.borrow() == wardrobe.soul_id);
        assert!(*wardrobe.equipped_by_slot.borrow(PartPolicyKeyV7 {
            slot_key: b"body".to_string(),
        }) == asset_id);
        sui::test_scenario::return_shared(profile);
        sui::test_scenario::return_shared(product);
        sui::test_scenario::return_shared(wardrobe);
    };

    scenario.next_tx(sender);
    {
        let profile = scenario.take_shared<MakerPhysicalProfileV7>();
        let product = scenario.take_shared<StyleProductV7>();
        let mut wardrobe = scenario.take_shared<SoulWardrobeV7>();
        let receiving = sui::test_scenario::receiving_ticket_by_id<StyleAssetV7>(asset_id);
        unequip_received_internal(&mut wardrobe, &profile, receiving, 1);
        assert!(wardrobe.equipped_count == 0);
        assert!(wardrobe.revision == 2);
        sui::test_scenario::return_shared(profile);
        sui::test_scenario::return_shared(product);
        sui::test_scenario::return_shared(wardrobe);
    };

    scenario.next_tx(sender);
    {
        let profile = scenario.take_shared<MakerPhysicalProfileV7>();
        let product = scenario.take_shared<StyleProductV7>();
        let mut wardrobe = scenario.take_shared<SoulWardrobeV7>();
        let receiving = sui::test_scenario::receiving_ticket_by_id<StyleAssetV7>(asset_id);
        withdraw_received_internal(&mut wardrobe, receiving, 2, sender);
        assert!(wardrobe.external_asset_count == 0);
        assert!(wardrobe.revision == 3);
        sui::test_scenario::return_shared(profile);
        sui::test_scenario::return_shared(product);
        sui::test_scenario::return_shared(wardrobe);
    };

    scenario.next_tx(sender);
    {
        let asset = scenario.take_from_sender_by_id<StyleAssetV7>(asset_id);
        assert!(asset.holder == sender);
        assert!(asset.bound_soul_id.is_none());
        assert!(asset.ownership_epoch == 1);
        scenario.return_to_sender(asset);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = 51, location = animacraft_physical_v7::physical_composition_v7)]
fun free_style_claim_replay_is_permanently_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7001, 0, 0, 0);
    let (_config, mut registry) = test_protocol(&mut ctx);
    let product_id = object::id_from_address(@0x7101);
    let key = reserve_free_style_claim(&registry, product_id, @0xA11);
    registry.free_style_claims.add(key, true);
    let _ = reserve_free_style_claim(&registry, product_id, @0xA11);
    abort 99
}

#[test, expected_failure(abort_code = 23, location = animacraft_physical_v7::physical_composition_v7)]
fun limited_style_supply_cannot_overmint() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7002, 0, 0, 0);
    let product = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_LIMITED_EDITION,
        1,
        1,
        object::id_from_address(@0x7102),
        vector[],
        vector[],
        &mut ctx,
    );
    let _ = next_serial(&mut product);
    abort 99
}

#[test, expected_failure(abort_code = 30, location = animacraft_physical_v7::physical_composition_v7)]
fun wardrobe_rejects_stale_revision() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7003, 0, 0, 0);
    let config_id = object::id_from_address(@0x7007);
    let profile = test_profile(config_id, false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(config_id, &profile, true, &mut ctx);
    wardrobe.revision = 2;
    assert_wardrobe_mutable(&wardrobe, 1);
    abort 99
}

#[test, expected_failure(abort_code = 44, location = animacraft_physical_v7::physical_composition_v7)]
fun external_assets_must_leave_before_soul_transfer() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7004, 0, 0, 0);
    let config_id = object::id_from_address(@0x7007);
    let profile = test_profile(config_id, false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(config_id, &profile, true, &mut ctx);
    wardrobe.external_asset_count = 1;
    assert_wardrobe_transferable_v7(&wardrobe, &profile);
    abort 99
}

#[test, expected_failure(abort_code = 50, location = animacraft_physical_v7::physical_composition_v7)]
fun required_slot_completion_uses_canonical_profile_not_caller_input() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7005, 0, 0, 0);
    let config_id = object::id_from_address(@0x7007);
    let profile = test_profile(config_id, true, PART_SOUL_LOCAL, &mut ctx);
    let wardrobe = test_wardrobe(config_id, &profile, true, &mut ctx);
    assert_wardrobe_complete_v7(&wardrobe, &profile);
    abort 99
}

#[test, expected_failure(abort_code = 53, location = animacraft_physical_v7::physical_composition_v7)]
fun empty_initial_wardrobe_cannot_be_finalized() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7006, 0, 0, 0);
    let (config, _registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let wardrobe = test_wardrobe(object::id(&config), &profile, false, &mut ctx);
    let soul_id = wardrobe.soul_id;
    finalize_soul_wardrobe_v7(
        wardrobe,
        &config,
        &profile,
        soul_id,
        trusted_owner_proof_v7(),
        0,
    );
    abort 99
}

#[test, expected_failure(abort_code = 42, location = animacraft_physical_v7::physical_composition_v7)]
fun required_rule_matches_v6_product_id_not_v7_object_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7007, 0, 0, 0);
    let config_id = object::id_from_address(@0x7007);
    let profile = test_profile(config_id, false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(config_id, &profile, true, &mut ctx);
    let soul_id = wardrobe.soul_id;
    let asset_id = object::id_from_address(@0xA701);
    wardrobe.inventory.add(asset_id, CustodyRecordV7 {
        style_product_id: object::id_from_address(@0x5701),
        family_id: object::id_from_address(@0xF701),
        v6_product_id: object::id_from_address(@0x6701),
        slot_key: b"body".to_string(),
        source_kind: SOURCE_OFFICIAL,
        asset_kind: ASSET_OWNED,
        bound_soul_id: option::some(soul_id),
        equipped: true,
        required_v6_product_ids: vector[object::id_from_address(@0x6702)],
        excluded_v6_product_ids: vector[],
    });
    wardrobe.equipped_asset_ids.push_back(asset_id);
    wardrobe.equipped_count = 1;
    assert_equipped_rules(&wardrobe);
    abort 99
}

#[test]
fun required_rule_accepts_matching_v6_product_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7008, 0, 0, 0);
    let config_id = object::id_from_address(@0x7007);
    let profile = test_profile(config_id, false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(config_id, &profile, true, &mut ctx);
    let soul_id = wardrobe.soul_id;
    let first_id = object::id_from_address(@0xA711);
    let second_id = object::id_from_address(@0xA712);
    wardrobe.inventory.add(first_id, CustodyRecordV7 {
        style_product_id: object::id_from_address(@0x5711),
        family_id: object::id_from_address(@0xF711),
        v6_product_id: object::id_from_address(@0x6711),
        slot_key: b"body".to_string(),
        source_kind: SOURCE_OFFICIAL,
        asset_kind: ASSET_OWNED,
        bound_soul_id: option::some(soul_id),
        equipped: true,
        required_v6_product_ids: vector[object::id_from_address(@0x6712)],
        excluded_v6_product_ids: vector[],
    });
    wardrobe.inventory.add(second_id, CustodyRecordV7 {
        style_product_id: object::id_from_address(@0x5712),
        family_id: object::id_from_address(@0xF712),
        v6_product_id: object::id_from_address(@0x6712),
        slot_key: b"accessory".to_string(),
        source_kind: SOURCE_OFFICIAL,
        asset_kind: ASSET_OWNED,
        bound_soul_id: option::some(soul_id),
        equipped: true,
        required_v6_product_ids: vector[],
        excluded_v6_product_ids: vector[],
    });
    wardrobe.equipped_asset_ids.push_back(first_id);
    wardrobe.equipped_asset_ids.push_back(second_id);
    wardrobe.equipped_count = 2;
    assert_equipped_rules(&wardrobe);
    std::unit_test::destroy(profile);
    std::unit_test::destroy(wardrobe);
}

#[test]
fun staged_initial_selection_materializes_only_selected_style_and_finalizes() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7009, 0, 0, 0);
    let (config, registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), true, PART_SOUL_LOCAL, &mut ctx);
    let mut product = test_style_product(
        object::id(&config),
        object::id(&profile),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7191),
        vector[],
        vector[],
        &mut ctx,
    );
    let v6_product_id = product.v6_product_id;
    let v6_profile = composition::new_admission_profile_stub_v6_for_testing(
        v6_product_id,
        true,
        &mut ctx,
    );
    product.v6_profile_id = object::id(&v6_profile);
    let mut wardrobe = test_wardrobe(object::id(&config), &profile, false, &mut ctx);
    wardrobe.authorized_initial_style_product_ids.push_back(object::id(&product));
    let soul_id = wardrobe.soul_id;
    claim_initial_included_style_v7(
        &mut wardrobe,
        &config,
        &profile,
        &v6_profile,
        &mut product,
        soul_id,
        0,
        &mut ctx,
    );
    assert!(wardrobe.initial_style_product_ids.length() == 1);
    assert!(wardrobe.initial_asset_ids.length() == 1);
    assert!(wardrobe.soul_local_asset_count == 1);
    assert!(wardrobe.equipped_count == 1);
    assert!(product.minted_supply == 1);
    assert_wardrobe_complete_internal(&wardrobe, &profile);
    finalize_soul_wardrobe_v7(
        wardrobe,
        &config,
        &profile,
        soul_id,
        trusted_owner_proof_v7(),
        1,
    );
    std::unit_test::destroy(config);
    std::unit_test::destroy(registry);
    std::unit_test::destroy(profile);
    std::unit_test::destroy(product);
    composition::destroy_profile_v6_for_testing(v6_profile);
}

#[test, expected_failure(abort_code = 46, location = animacraft_physical_v7::physical_composition_v7)]
fun included_style_cannot_be_claimed_twice_for_one_soul() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7010, 0, 0, 0);
    let (config, _registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let mut product = test_style_product(
        object::id(&config),
        object::id(&profile),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7192),
        vector[],
        vector[],
        &mut ctx,
    );
    let v6_product_id = product.v6_product_id;
    let v6_profile = composition::new_admission_profile_stub_v6_for_testing(
        v6_product_id,
        true,
        &mut ctx,
    );
    product.v6_profile_id = object::id(&v6_profile);
    let mut wardrobe = test_wardrobe(object::id(&config), &profile, false, &mut ctx);
    wardrobe.authorized_initial_style_product_ids.push_back(object::id(&product));
    let soul_id = wardrobe.soul_id;
    claim_initial_included_style_v7(
        &mut wardrobe,
        &config,
        &profile,
        &v6_profile,
        &mut product,
        soul_id,
        0,
        &mut ctx,
    );
    claim_initial_included_style_v7(
        &mut wardrobe,
        &config,
        &profile,
        &v6_profile,
        &mut product,
        soul_id,
        1,
        &mut ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 41, location = animacraft_physical_v7::physical_composition_v7)]
fun required_part_cannot_be_unequipped() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7011, 0, 0, 0);
    let profile = test_profile(
        object::id_from_address(@0x7007),
        true,
        PART_SOUL_LOCAL,
        &mut ctx,
    );
    assert_part_can_unequip(part_policy(&profile, b"body".to_string()));
    abort 99
}

#[test, expected_failure(abort_code = 18, location = animacraft_physical_v7::physical_composition_v7)]
fun revoked_v6_admission_blocks_initial_style_materialization() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7016, 0, 0, 0);
    let (config, _registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let mut product = test_style_product(
        object::id(&config),
        object::id(&profile),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7196),
        vector[],
        vector[],
        &mut ctx,
    );
    let v6_profile = composition::new_admission_profile_stub_v6_for_testing(
        product.v6_product_id,
        false,
        &mut ctx,
    );
    product.v6_profile_id = object::id(&v6_profile);
    let mut wardrobe = test_wardrobe(object::id(&config), &profile, false, &mut ctx);
    wardrobe.authorized_initial_style_product_ids.push_back(object::id(&product));
    let soul_id = wardrobe.soul_id;
    claim_initial_included_style_v7(
        &mut wardrobe,
        &config,
        &profile,
        &v6_profile,
        &mut product,
        soul_id,
        0,
        &mut ctx,
    );
    abort 99
}

#[test, expected_failure(abort_code = 18, location = animacraft_physical_v7::physical_composition_v7)]
fun revoked_v6_admission_blocks_new_equip_gate() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7017, 0, 0, 0);
    let mut product = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_OPEN_EDITION,
        0,
        0,
        object::id_from_address(@0x7197),
        vector[],
        vector[],
        &mut ctx,
    );
    let v6_profile = composition::new_admission_profile_stub_v6_for_testing(
        product.v6_product_id,
        false,
        &mut ctx,
    );
    product.v6_profile_id = object::id(&v6_profile);
    // Every public deposit/equip/swap entry invokes this exact gate after its
    // owner/provenance checks and before receiving or moving the child.
    assert_product_admitted(&v6_profile, &product);
    abort 99
}

#[test, expected_failure(abort_code = 43, location = animacraft_physical_v7::physical_composition_v7)]
fun soul_local_asset_can_never_be_withdrawn() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7012, 0, 0, 0);
    let mut product = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7193),
        vector[],
        vector[],
        &mut ctx,
    );
    let mut asset = test_owned_asset(&product, @0x0, &mut ctx);
    asset.asset_kind = ASSET_SOUL_LOCAL;
    asset.bound_soul_id = option::some(object::id_from_address(@0x5071));
    let record = custody_record(&asset, false);
    assert_withdrawable_asset(&asset, &record);
    abort 99
}

#[test, expected_failure(abort_code = 29, location = animacraft_physical_v7::physical_composition_v7)]
fun listed_wardrobe_rejects_mutation() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7013, 0, 0, 0);
    let config_id = object::id_from_address(@0x7007);
    let profile = test_profile(config_id, false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(config_id, &profile, true, &mut ctx);
    wardrobe.listed = true;
    assert_wardrobe_mutable(&wardrobe, 0);
    abort 99
}

#[test, expected_failure(abort_code = 52, location = animacraft_physical_v7::physical_composition_v7)]
fun uninitialized_wardrobe_rejects_normal_mutation() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7014, 0, 0, 0);
    let config_id = object::id_from_address(@0x7007);
    let profile = test_profile(config_id, false, PART_HYBRID, &mut ctx);
    let wardrobe = test_wardrobe(config_id, &profile, false, &mut ctx);
    assert_wardrobe_mutable(&wardrobe, 0);
    abort 99
}

#[test]
fun legacy_receipt_materialization_cannot_be_trapped_by_pause_or_cap() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7015, 0, 0, 0);
    let (config, registry) = test_protocol(&mut ctx);
    let mut product = test_style_product(
        object::id(&config),
        object::id_from_address(@0x7008),
        SUPPLY_LIMITED_EDITION,
        1,
        1,
        object::id_from_address(@0x7194),
        vector[],
        vector[],
        &mut ctx,
    );
    product.active = false;
    let asset = create_migrated_style_asset(&config, &mut product, @0xA11, 4, &mut ctx);
    assert!(product.minted_supply == 2);
    assert!(asset.serial == 2);
    assert!(asset.ownership_epoch == 4);
    std::unit_test::destroy(asset);
    std::unit_test::destroy(product);
    std::unit_test::destroy(config);
    std::unit_test::destroy(registry);
}

#[test, expected_failure(abort_code = 12, location = animacraft_physical_v7::physical_composition_v7)]
fun required_open_part_is_rejected_before_profile_seal() {
    assert_part_policy(PART_OPEN, true, SOURCE_OPEN, &b"body".to_string());
    abort 99
}

#[test, expected_failure(abort_code = 40, location = animacraft_physical_v7::physical_composition_v7)]
fun owned_style_cannot_publish_into_soul_local_part() {
    let policy = PartPolicyV7 {
        slot_key: b"body".to_string(),
        behavior: PART_SOUL_LOCAL,
        required: false,
        max_source_kind: SOURCE_OFFICIAL,
    };
    assert_supply_part_policy_compatible(
        &policy,
        SOURCE_OFFICIAL,
        SUPPLY_OPEN_EDITION,
    );
    abort 99
}

#[test, expected_failure(abort_code = 40, location = animacraft_physical_v7::physical_composition_v7)]
fun included_style_cannot_publish_into_open_part() {
    let policy = PartPolicyV7 {
        slot_key: b"body".to_string(),
        behavior: PART_OPEN,
        required: false,
        max_source_kind: SOURCE_OPEN,
    };
    assert_supply_part_policy_compatible(
        &policy,
        SOURCE_OFFICIAL,
        SUPPLY_SOUL_LOCAL_INCLUDED,
    );
    abort 99
}

#[test, expected_failure(abort_code = 24, location = animacraft_physical_v7::physical_composition_v7)]
fun inactive_style_cannot_issue_a_new_asset() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7018, 0, 0, 0);
    let mut product = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_OPEN_EDITION,
        0,
        0,
        object::id_from_address(@0x7198),
        vector[],
        vector[],
        &mut ctx,
    );
    product.active = false;
    let _ = next_serial(&mut product);
    abort 99
}

#[test]
fun atomic_included_claim_equips_new_child() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7019, 0, 0, 0);
    let (config, registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let mut product = test_style_product(
        object::id(&config),
        object::id(&profile),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7199),
        vector[],
        vector[],
        &mut ctx,
    );
    let mut wardrobe = test_wardrobe(object::id(&config), &profile, true, &mut ctx);
    let soul_id = wardrobe.soul_id;
    claim_and_equip_included_internal(
        &mut wardrobe,
        &config,
        &profile,
        &mut product,
        soul_id,
        0,
        &mut ctx,
    );
    assert!(wardrobe.equipped_count == 1);
    assert!(wardrobe.soul_local_asset_count == 1);
    assert!(wardrobe.revision == 1);
    assert!(wardrobe.claimed_included_products.contains(object::id(&product)));
    std::unit_test::destroy(config);
    std::unit_test::destroy(registry);
    std::unit_test::destroy(profile);
    std::unit_test::destroy(product);
    std::unit_test::destroy(wardrobe);
}

#[test]
fun direct_owned_style_transfer_updates_holder_and_epoch() {
    let sender = @0xA11;
    let recipient = @0xB11;
    let mut scenario = sui::test_scenario::begin(sender);
    let asset_id;
    {
        let ctx = scenario.ctx();
        let product = test_style_product(
            object::id_from_address(@0x7007),
            object::id_from_address(@0x7008),
            SUPPLY_OPEN_EDITION,
            0,
            0,
            object::id_from_address(@0x7200),
            vector[],
            vector[],
            ctx,
        );
        let asset = test_owned_asset(&product, sender, ctx);
        asset_id = object::id(&asset);
        std::unit_test::destroy(product);
        transfer::transfer(asset, sender);
    };
    scenario.next_tx(sender);
    {
        let asset = scenario.take_from_sender_by_id<StyleAssetV7>(asset_id);
        transfer_owned_style_v7(asset, recipient, scenario.ctx());
    };
    scenario.next_tx(recipient);
    {
        let asset = scenario.take_from_sender_by_id<StyleAssetV7>(asset_id);
        assert!(asset.holder == recipient);
        assert!(asset.bound_soul_id.is_none());
        assert!(asset.ownership_epoch == 1);
        scenario.return_to_sender(asset);
    };
    scenario.end();
}

#[test]
fun paused_recovery_can_atomically_remove_equipped_external_style() {
    let sender = @0xA11;
    let mut scenario = sui::test_scenario::begin(sender);
    let asset_id;
    {
        let ctx = scenario.ctx();
        let (config, registry) = test_protocol(ctx);
        let profile = test_profile(object::id(&config), true, PART_HYBRID, ctx);
        let product = test_style_product(
            object::id(&config),
            object::id(&profile),
            SUPPLY_OPEN_EDITION,
            0,
            0,
            object::id_from_address(@0x7201),
            vector[],
            vector[],
            ctx,
        );
        let wardrobe = test_wardrobe(object::id(&config), &profile, true, ctx);
        let asset = test_owned_asset(&product, sender, ctx);
        asset_id = object::id(&asset);
        std::unit_test::destroy(registry);
        transfer::share_object(config);
        transfer::share_object(profile);
        transfer::share_object(product);
        transfer::share_object(wardrobe);
        transfer::transfer(asset, sender);
    };
    scenario.next_tx(sender);
    {
        let profile = scenario.take_shared<MakerPhysicalProfileV7>();
        let product = scenario.take_shared<StyleProductV7>();
        let mut wardrobe = scenario.take_shared<SoulWardrobeV7>();
        let asset = scenario.take_from_sender_by_id<StyleAssetV7>(asset_id);
        deposit_and_equip_internal(
            &mut wardrobe,
            &profile,
            &product,
            asset,
            0,
            scenario.ctx(),
        );
        sui::test_scenario::return_shared(profile);
        sui::test_scenario::return_shared(product);
        sui::test_scenario::return_shared(wardrobe);
    };
    scenario.next_tx(sender);
    {
        let config = scenario.take_shared<PhysicalProtocolConfigV7>();
        let mut wardrobe = scenario.take_shared<SoulWardrobeV7>();
        let soul_id = wardrobe.soul_id;
        let receiving = sui::test_scenario::receiving_ticket_by_id<StyleAssetV7>(asset_id);
        emergency_unequip_and_withdraw_style_v7(
            &mut wardrobe,
            &config,
            soul_id,
            trusted_owner_proof_v7(),
            receiving,
            1,
            scenario.ctx(),
        );
        assert!(wardrobe.external_asset_count == 0);
        assert!(wardrobe.equipped_count == 0);
        assert!(wardrobe.revision == 2);
        sui::test_scenario::return_shared(config);
        sui::test_scenario::return_shared(wardrobe);
    };
    scenario.next_tx(sender);
    {
        let asset = scenario.take_from_sender_by_id<StyleAssetV7>(asset_id);
        assert!(asset.holder == sender);
        assert!(asset.bound_soul_id.is_none());
        assert!(asset.ownership_epoch == 1);
        scenario.return_to_sender(asset);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = 55, location = animacraft_physical_v7::physical_composition_v7)]
fun physical_initial_authorization_rejects_style_key_tampering() {
    let recipe = vector[legacy::new_recipe_slot(
        b"body".to_string(),
        b"base".to_string(),
        b"#000000".to_string(),
        0,
    )];
    let expected_selections = vector[commerce::new_style_selection_v5(
        b"body".to_string(),
        b"base".to_string(),
        b"authorized-style".to_string(),
    )];
    let recipe_hash = commerce::hash_complete_selection_v5(
        &recipe,
        &expected_selections,
    );
    let config_id = object::id_from_address(@0x7007);
    let profile_id = object::id_from_address(@0x7008);
    let mut authorization = InitialPhysicalLoadoutAuthorizationV7 {
        version: VERSION,
        config_id,
        profile_id,
        v6_profile_id: object::id_from_address(@0x6007),
        root_id: object::id_from_address(@0x5007),
        recipe_hash,
        recipe,
        style_selections: vector[commerce::new_style_selection_v5(
            b"body".to_string(),
            b"base".to_string(),
            b"tampered-style".to_string(),
        )],
        visual_recipe_indices: vector[0],
        style_product_ids: vector[object::id_from_address(@0x7203)],
        authorization_commitment: vector[],
        sealed: false,
    };
    seal_initial_physical_loadout_authorization_v7(&mut authorization);
    abort 99
}

#[test]
fun complete_authorization_keeps_logical_rows_but_materializes_visual_subset() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7025, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        v5_config,
        protocol_treasury,
        mut root,
        treasury,
        vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    commerce::register_base_logical_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hat".to_string(),
        b"__ac_none".to_string(),
        b"__animacraft_none__".to_string(),
        commerce::style_row_logical_none_v5(),
        &ctx,
    );
    commerce::seal_style_registry_v5(&mut root, &cap, &ctx);

    let (v7_config, v7_registry) = test_protocol(&mut ctx);
    let mut physical_profile = test_profile(
        object::id(&v7_config),
        false,
        PART_HYBRID,
        &mut ctx,
    );
    physical_profile.root_id = object::id(&root);
    let family = ItemFamilyV7 {
        id: object::new(&mut ctx),
        version: VERSION,
        config_id: object::id(&v7_config),
        profile_id: object::id(&physical_profile),
        seed_v6_product_id: object::id_from_address(@0x7401),
        creator: @0xA11,
        slot_key: b"eyes".to_string(),
        family_key: b"eye-family".to_string(),
        label: b"Eyes".to_string(),
        family_commitment: test_hash(1),
        rights_origin: 0,
    };
    let mut product = test_style_product(
        object::id(&v7_config),
        object::id(&physical_profile),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7402),
        vector[],
        vector[],
        &mut ctx,
    );
    product.family_id = object::id(&family);
    product.slot_key = b"eyes".to_string();
    product.recipe_item_key = b"bright".to_string();
    product.style_key = b"default".to_string();
    let recipe = vector[
        legacy::new_recipe_slot(
            b"eyes".to_string(),
            b"bright".to_string(),
            b"#2db7a3".to_string(),
            0,
        ),
        legacy::new_recipe_slot(
            b"hat".to_string(),
            b"__ac_none".to_string(),
            b"#00000000".to_string(),
            1,
        ),
    ];
    let selections = vector[
        commerce::new_style_selection_v5(
            b"eyes".to_string(),
            b"bright".to_string(),
            b"default".to_string(),
        ),
        commerce::new_style_selection_v5(
            b"hat".to_string(),
            b"__ac_none".to_string(),
            b"__animacraft_none__".to_string(),
        ),
    ];
    let recipe_hash = commerce::hash_complete_selection_v5(&recipe, &selections);
    let mut authorization = begin_initial_physical_loadout_authorization_v7(
        &v7_config,
        &physical_profile,
        &root,
        *&recipe_hash,
        recipe,
    );
    append_initial_style_to_authorization_v7(
        &mut authorization,
        &root,
        &family,
        &product,
    );
    append_initial_logical_style_to_authorization_v7(
        &mut authorization,
        &root,
        b"__animacraft_none__".to_string(),
    );
    seal_initial_physical_loadout_authorization_v7(&mut authorization);
    assert!(initial_authorization_style_product_ids_v7(&authorization).length() == 1);
    assert!(initial_authorization_visual_recipe_indices_v7(&authorization) == &vector[0]);
    assert!(initial_authorization_commitment_v7(&authorization).length() == HASH_LENGTH);
    let (product_ids, consumed_hash, commitment) =
        consume_initial_physical_authorization(
            authorization,
            &v7_config,
            &physical_profile,
            &root,
            &recipe_hash,
        );
    assert!(product_ids.length() == 1);
    assert!(&consumed_hash == &recipe_hash);
    assert!(commitment.length() == HASH_LENGTH);
    std::unit_test::destroy(product_ids);
    std::unit_test::destroy(consumed_hash);
    std::unit_test::destroy(commitment);
    std::unit_test::destroy(selections);
    std::unit_test::destroy(family);
    std::unit_test::destroy(product);
    std::unit_test::destroy(v7_config);
    std::unit_test::destroy(v7_registry);
    std::unit_test::destroy(physical_profile);
    sui::clock::destroy_for_testing(clock);
    commerce::destroy_v5_world_for_testing(
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        v5_config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    );
}

#[test, expected_failure(abort_code = 55, location = animacraft_physical_v7::physical_composition_v7)]
fun initial_authorization_rejects_visual_rows_out_of_recipe_order() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7026, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _legacy_profile,
        maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _v5_config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        &ctx,
    );
    commerce::register_base_style_v5(
        &mut root,
        &cap,
        &maker,
        b"hat".to_string(),
        b"moon".to_string(),
        b"default".to_string(),
        &ctx,
    );
    commerce::seal_style_registry_v5(&mut root, &cap, &ctx);
    let (v7_config, _v7_registry) = test_protocol(&mut ctx);
    let mut physical_profile = test_profile(
        object::id(&v7_config),
        false,
        PART_HYBRID,
        &mut ctx,
    );
    physical_profile.root_id = object::id(&root);
    let family = ItemFamilyV7 {
        id: object::new(&mut ctx),
        version: VERSION,
        config_id: object::id(&v7_config),
        profile_id: object::id(&physical_profile),
        seed_v6_product_id: object::id_from_address(@0x7411),
        creator: @0xA11,
        slot_key: b"hat".to_string(),
        family_key: b"headwear".to_string(),
        label: b"Headwear".to_string(),
        family_commitment: test_hash(1),
        rights_origin: 0,
    };
    let mut product = test_style_product(
        object::id(&v7_config),
        object::id(&physical_profile),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7412),
        vector[],
        vector[],
        &mut ctx,
    );
    product.family_id = object::id(&family);
    product.slot_key = b"hat".to_string();
    product.recipe_item_key = b"moon".to_string();
    product.style_key = b"default".to_string();
    let recipe = vector[
        legacy::new_recipe_slot(
            b"eyes".to_string(),
            b"bright".to_string(),
            b"#2db7a3".to_string(),
            0,
        ),
        legacy::new_recipe_slot(
            b"hat".to_string(),
            b"moon".to_string(),
            b"#ffffff".to_string(),
            1,
        ),
    ];
    let selections = vector[
        commerce::new_style_selection_v5(
            b"eyes".to_string(),
            b"bright".to_string(),
            b"default".to_string(),
        ),
        commerce::new_style_selection_v5(
            b"hat".to_string(),
            b"moon".to_string(),
            b"default".to_string(),
        ),
    ];
    let recipe_hash = commerce::hash_complete_selection_v5(&recipe, &selections);
    let mut authorization = begin_initial_physical_loadout_authorization_v7(
        &v7_config,
        &physical_profile,
        &root,
        recipe_hash,
        recipe,
    );
    append_initial_style_to_authorization_v7(
        &mut authorization,
        &root,
        &family,
        &product,
    );
    abort 99
}

#[test, expected_failure(abort_code = 28, location = animacraft_physical_v7::physical_composition_v7)]
fun reconstructed_initial_authorization_cannot_replay_same_soul() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7027, 0, 0, 0);
    let (config, mut registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let soul_id = object::id_from_address(@0x7501);
    let first = new_wardrobe(
        &mut registry,
        &config,
        &profile,
        soul_id,
        vector[object::id_from_address(@0x7502)],
        test_hash(1),
        test_hash(2),
        trusted_owner_proof_v7(),
        &mut ctx,
    );
    let _replayed = new_wardrobe(
        &mut registry,
        &config,
        &profile,
        soul_id,
        vector[object::id_from_address(@0x7502)],
        *wardrobe_initial_recipe_hash_v7(&first),
        *wardrobe_initial_authorization_commitment_v7(&first),
        trusted_owner_proof_v7(),
        &mut ctx,
    );
    abort 99
}

#[test]
fun listing_freeze_round_trip_is_revisioned_and_transfer_safe() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7028, 0, 0, 0);
    let (config, registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(object::id(&config), &profile, true, &mut ctx);
    let soul_id = wardrobe.soul_id;
    set_wardrobe_listed_v7(
        &mut wardrobe,
        &config,
        &profile,
        soul_id,
        true,
        trusted_listing_proof_v7(),
        0,
    );
    assert!(wardrobe.listed);
    assert!(wardrobe.revision == 1);
    set_wardrobe_listed_v7(
        &mut wardrobe,
        &config,
        &profile,
        soul_id,
        false,
        trusted_listing_proof_v7(),
        1,
    );
    assert!(!wardrobe.listed);
    assert!(wardrobe.revision == 2);
    assert_wardrobe_transferable_v7(&wardrobe, &profile);
    std::unit_test::destroy(config);
    std::unit_test::destroy(registry);
    std::unit_test::destroy(profile);
    std::unit_test::destroy(wardrobe);
}

#[test, expected_failure(abort_code = 44, location = animacraft_physical_v7::physical_composition_v7)]
fun listing_rejects_wardrobe_with_external_custody() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7029, 0, 0, 0);
    let (config, _registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(object::id(&config), &profile, true, &mut ctx);
    wardrobe.external_asset_count = 1;
    let soul_id = wardrobe.soul_id;
    set_wardrobe_listed_v7(
        &mut wardrobe,
        &config,
        &profile,
        soul_id,
        true,
        trusted_listing_proof_v7(),
        0,
    );
    abort 99
}

#[test, expected_failure(abort_code = 7, location = animacraft_physical_v7::physical_composition_v7)]
fun listing_proof_type_binding_is_one_time() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7030, 0, 0, 0);
    let mut config = PhysicalProtocolConfigV7 {
        id: object::new(&mut ctx),
        version: VERSION,
        v6_config_id: object::id_from_address(@0x6006),
        v5_config_id: object::id_from_address(@0x5005),
        v6_admin_cap_id: object::id_from_address(@0x6A06),
        registry_id: object::id_from_address(@0x7002),
        soul_owner_proof_type: defining_type_name<TrustedOwnerProofV7>(),
        listing_proof_type: option::none(),
        enabled: true,
    };
    let admin = PhysicalAdminCapV7 {
        id: object::new(&mut ctx),
        version: VERSION,
        config_id: object::id(&config),
    };
    bind_listing_proof_type_v7<TrustedListingProofV7>(&mut config, &admin);
    bind_listing_proof_type_v7<TrustedListingProofV7>(&mut config, &admin);
    abort 99
}

#[test]
fun one_family_can_preserve_distinct_exact_legacy_item_keys() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7031, 0, 0, 0);
    let family_id = object::id_from_address(@0x7601);
    let mut first = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7602),
        vector[],
        vector[],
        &mut ctx,
    );
    let mut second = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7603),
        vector[],
        vector[],
        &mut ctx,
    );
    first.family_id = family_id;
    second.family_id = family_id;
    first.recipe_item_key = b"legacy-long-hair".to_string();
    second.recipe_item_key = b"legacy-highlight-hair".to_string();
    assert!(style_product_family_id_v7(&first) == style_product_family_id_v7(&second));
    assert!(style_product_recipe_item_key_v7(&first) == &b"legacy-long-hair".to_string());
    assert!(style_product_recipe_item_key_v7(&second) == &b"legacy-highlight-hair".to_string());
    std::unit_test::destroy(first);
    std::unit_test::destroy(second);
}

#[test]
fun certified_supplier_can_publish_only_its_own_admitted_product() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7032, 0, 0, 0);
    let product = composition::new_external_item_product_stub_v6_for_testing(
        object::id_from_address(@0x6006),
        @0xA11,
        @0xA11,
        composition::origin_certified_v6(),
        b"body".to_string(),
        test_hash(1),
        test_hash(93),
        &mut ctx,
    );
    let profile = composition::new_admission_profile_stub_with_source_v6_for_testing(
        object::id(&product),
        composition::admission_certified_v6(),
        true,
        &mut ctx,
    );
    assert_external_publication_authority(&profile, &product, &ctx);
    composition::destroy_item_product_v6_for_testing(product);
    composition::destroy_profile_v6_for_testing(profile);
}

#[test, expected_failure(abort_code = 25, location = animacraft_physical_v7::physical_composition_v7)]
fun external_supplier_cannot_squat_another_creators_product() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7033, 0, 0, 0);
    let product = composition::new_external_item_product_stub_v6_for_testing(
        object::id_from_address(@0x6006),
        @0xB11,
        @0xB11,
        composition::origin_certified_v6(),
        b"body".to_string(),
        test_hash(1),
        test_hash(93),
        &mut ctx,
    );
    let profile = composition::new_admission_profile_stub_with_source_v6_for_testing(
        object::id(&product),
        composition::admission_certified_v6(),
        true,
        &mut ctx,
    );
    assert_external_publication_authority(&profile, &product, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = 40, location = animacraft_physical_v7::physical_composition_v7)]
fun external_supplier_source_must_match_exact_v6_admission() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7034, 0, 0, 0);
    let product = composition::new_external_item_product_stub_v6_for_testing(
        object::id_from_address(@0x6006),
        @0xA11,
        @0xA11,
        composition::origin_certified_v6(),
        b"body".to_string(),
        test_hash(1),
        test_hash(93),
        &mut ctx,
    );
    let profile = composition::new_admission_profile_stub_with_source_v6_for_testing(
        object::id(&product),
        composition::admission_open_v6(),
        true,
        &mut ctx,
    );
    assert_external_publication_authority(&profile, &product, &ctx);
    abort 99
}

#[test, expected_failure(abort_code = 17, location = animacraft_physical_v7::physical_composition_v7)]
fun v6_product_can_have_only_one_v7_style_registry_mapping() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7035, 0, 0, 0);
    let (_config, mut registry) = test_protocol(&mut ctx);
    let v6_product_id = object::id_from_address(@0x7701);
    registry.style_products.add(v6_product_id, object::id_from_address(@0x7702));
    assert_style_product_unregistered(&registry, v6_product_id);
    abort 99
}

#[test, expected_failure(abort_code = 16, location = animacraft_physical_v7::physical_composition_v7)]
fun v6_seed_product_can_have_only_one_v7_family_mapping() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7036, 0, 0, 0);
    let (_config, mut registry) = test_protocol(&mut ctx);
    let v6_product_id = object::id_from_address(@0x7711);
    registry.family_seed_products.add(v6_product_id, object::id_from_address(@0x7712));
    assert_family_seed_unregistered(&registry, v6_product_id);
    abort 99
}

#[test, expected_failure(abort_code = 55, location = animacraft_physical_v7::physical_composition_v7)]
fun finalization_rejects_partial_authenticated_initial_vector() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7021, 0, 0, 0);
    let (config, _registry) = test_protocol(&mut ctx);
    let profile = test_profile(object::id(&config), false, PART_HYBRID, &mut ctx);
    let mut wardrobe = test_wardrobe(object::id(&config), &profile, false, &mut ctx);
    let first = object::id_from_address(@0x7204);
    wardrobe.authorized_initial_style_product_ids = vector[
        first,
        object::id_from_address(@0x7205),
    ];
    wardrobe.initial_style_product_ids.push_back(first);
    let soul_id = wardrobe.soul_id;
    finalize_soul_wardrobe_v7(
        wardrobe,
        &config,
        &profile,
        soul_id,
        trusted_owner_proof_v7(),
        0,
    );
    abort 99
}

#[test, expected_failure(abort_code = 58, location = animacraft_physical_v7::physical_composition_v7)]
fun postmint_paid_base_included_style_requires_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7022, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::update_base_access_v5(
        &mut root,
        &cap,
        commerce::pack_access_paid_once(),
        100,
        &ctx,
    );
    let product = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7301),
        vector[],
        vector[],
        &mut ctx,
    );
    assert_postmint_included_entitlement(&root, &product, ctx.sender());
    abort 99
}

#[test, expected_failure(abort_code = 58, location = animacraft_physical_v7::physical_composition_v7)]
fun postmint_paid_pack_included_style_requires_entitlement() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7023, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        _profile,
        _maker,
        _legacy_treasury,
        _legacy_config,
        _legacy_protocol_treasury,
        _protocol_admin,
        _config,
        _protocol_treasury,
        mut root,
        _treasury,
        _vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::add_pack_v5(
        &mut root,
        &cap,
        b"paid-pack".to_string(),
        b"Paid Pack".to_string(),
        commerce::pack_access_paid_once(),
        200,
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &ctx,
    );
    let mut product = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7302),
        vector[],
        vector[],
        &mut ctx,
    );
    product.entitlement_kind = ENTITLEMENT_PACK_INCLUDED;
    product.pack_key = option::some(b"paid-pack".to_string());
    assert_postmint_included_entitlement(&root, &product, ctx.sender());
    abort 99
}

#[test]
fun postmint_paid_base_and_pack_entitlements_allow_included_styles() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7024, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        mut root,
        treasury,
        vault,
        cap,
    ) = commerce::v5_world_for_testing(
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &mut ctx,
        &clock,
    );
    commerce::update_base_access_v5(
        &mut root,
        &cap,
        commerce::pack_access_paid_once(),
        100,
        &ctx,
    );
    commerce::add_pack_v5(
        &mut root,
        &cap,
        b"paid-pack".to_string(),
        b"Paid Pack".to_string(),
        commerce::pack_access_paid_once(),
        200,
        commerce::new_completion_policy(commerce::policy_unlimited_free(), 0, 0),
        &ctx,
    );
    commerce::grant_base_entitlement_v5_for_testing(&mut root, ctx.sender());
    commerce::grant_pack_entitlement_v5_for_testing(
        &mut root,
        b"paid-pack".to_string(),
        ctx.sender(),
    );
    let base = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7303),
        vector[],
        vector[],
        &mut ctx,
    );
    let mut pack = test_style_product(
        object::id_from_address(@0x7007),
        object::id_from_address(@0x7008),
        SUPPLY_SOUL_LOCAL_INCLUDED,
        0,
        0,
        object::id_from_address(@0x7304),
        vector[],
        vector[],
        &mut ctx,
    );
    pack.entitlement_kind = ENTITLEMENT_PACK_INCLUDED;
    pack.pack_key = option::some(b"paid-pack".to_string());
    assert_postmint_included_entitlement(&root, &base, ctx.sender());
    assert_postmint_included_entitlement(&root, &pack, ctx.sender());
    std::unit_test::destroy(base);
    std::unit_test::destroy(pack);
    sui::clock::destroy_for_testing(clock);
    commerce::destroy_v5_world_for_testing(
        profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        config,
        protocol_treasury,
        root,
        treasury,
        vault,
        cap,
    );
}
