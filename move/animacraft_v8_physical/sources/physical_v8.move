/// Fresh Physical policy registry for the unified Animacraft Maker v8 product.
/// No legacy object, package, migration, or caller-supplied object identity is
/// accepted by this module.
module animacraft_v8_physical::physical_v8;

use animacraft_v8_core::companion_binding_v2::{
    Self as companion, MakerRuntimeCompanionBindingBuilderV2,
};
use animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2;
use animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1;

/// Constructed only after this module validates its actual companion objects.
public struct MakerCompanionBindingWitnessV2 has drop {}

public fun bind_maker_physical_companion_v2<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    registry: &PhysicalRegistryV8,
    base_registry: &BaseDefinitionRegistryV8,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    maker::assert_companion_builder_root_v2(&builder, root, admin, ctx);
    binding::assert_catalog_current_v8(protocol_config, catalog);
    binding::assert_replacement_current_v2(replacement, catalog);
    assert_config(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    assert_activation_ready(registry);
    companion::append_physical_v2(builder, MakerCompanionBindingWitnessV2 {},
        protocol_config, catalog, replacement, object::id(registry), ctx)
}



use animacraft_v8_core::base_registry_v8::{
    Self as base,
    BaseDefinitionRegistryV8,
    StyleRowV2,
};
use animacraft_v8_core::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCallCapV8,
    PhysicalRoleV8,
    ProductReleaseCatalogV8,
};
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolConfigV8,
    ProtocolTreasuryV8,
};
use animacraft_v8_core::treasury_v8::{
    Self as core_treasury,
    MakerTreasuryV8,
};
use animacraft_v8_output::output_v8::{
    Self as output,
    PhysicalCompleteBindingV8,
    PhysicalMaterializationWitnessV8,
    PhysicalSelectionBindingV8,
};
use animacraft_v8_runtime::runtime_v8::{
    Self as runtime,
    MakerLoadoutV8,
    PackAdminCapV8,
    PackPassV8,
    PackRegistryV8,
    PackReleaseV8,
    PackTreasuryV8,
    RuntimePhysicalPackAccessWitnessV8,
    RuntimePhysicalPackPolicyWitnessV8,
    RuntimePhysicalSelectionWitnessV8,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::String;
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::table::{Self as table, Table};
use sui::transfer::Receiving;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_POLICY_COUNT: u64 = 10_000;
const MAX_SUPPLY_PER_POLICY: u64 = 1_000_000_000;
const BPS_DENOMINATOR: u128 = 10_000;

const SOURCE_BASE_STYLE: u8 = 0;
const SOURCE_PACK_STYLE: u8 = 1;

const ISSUE_FREE_CLAIM: u8 = 0;
const ISSUE_PAID_PURCHASE: u8 = 1;
const ISSUE_PROOF_MATERIALIZE: u8 = 2;

const PROOF_NONE: u8 = 0;
const PROOF_CANONICAL_SOUL: u8 = 2;

const MARKET_CUSTODY: u8 = 0;
const MARKET_RETURN: u8 = 1;
const MARKET_PURCHASE: u8 = 2;

const EInvalidConfig: u64 = 0;
const EInvalidBinding: u64 = 1;
const EInvalidCommitment: u64 = 2;
const EInvalidCount: u64 = 3;
const EInvalidSequence: u64 = 4;
const EInvalidPolicy: u64 = 5;
const EDuplicatePolicy: u64 = 6;
const ERegistrySealed: u64 = 7;
const ERegistryNotSealed: u64 = 8;
const ERegistryNotReady: u64 = 9;
const EStaleRevision: u64 = 10;
const EWrongHolder: u64 = 12;
const EWrongPayment: u64 = 13;
const EReplay: u64 = 14;
const ESupplyExhausted: u64 = 15;
const ENotTransferable: u64 = 16;
const EInvalidTreasury: u64 = 17;
const EWrongIssuance: u64 = 18;
const EInvalidRecipient: u64 = 19;
const EInvalidMarketAuthority: u64 = 20;
const EInvalidMarketCustody: u64 = 21;
const EOwnershipEpochOverflow: u64 = 22;

public struct PhysicalOriginalMarkerV8 has drop {}
public struct PhysicalCallableMarkerV8 has drop {}
public struct PhysicalSetupInstallWitnessV2 has drop {}
public struct PhysicalRuntimeWitnessV2 has drop {}

/// Catalog-installed configuration records consumption of the unique setup cap.
public struct PhysicalPackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    installation_commitment: vector<u8>,
}

public struct PhysicalPolicyKeyV8 has copy, drop, store {
    source_kind: u8,
    source_id: ID,
    part_key: String,
    item_key: String,
    style_key: String,
}

/// Immutable source identity copied into policy rows, issued assets, and the
/// asset commitment preimage. The fields deliberately retain the historical
/// flat-field order so nested BCS encoding is byte-for-byte identical.
public struct PhysicalSourceBindingV8 has copy, drop, store {
    source_kind: u8,
    source_id: ID,
    source_semantic_id: String,
    source_content_commitment: vector<u8>,
    source_treasury_id: Option<ID>,
    pack_registry_id: Option<ID>,
    pack_registry_revision: u64,
    registered_pack_owner: Option<address>,
    registered_pack_control_epoch: u64,
    registered_pack_admin_cap_id: Option<ID>,
}

/// Immutable visual descriptor copied into policy rows, issued assets, and
/// the asset commitment preimage. Its field order matches the former flat
/// segment, preserving the commitment's BCS byte sequence.
public struct PhysicalStyleDescriptorV8 has copy, drop, store {
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    style_asset_blob_id: String,
    style_asset_sha256: vector<u8>,
    style_protected: bool,
}

/// Frozen policy row. Base Style identity is copied only after reading the
/// exact sealed Core row; those copied fields are later re-readable and do not
/// grant authority independent of the bound Root/Base registry tuple.
public struct PhysicalStylePolicyV8 has copy, drop, store {
    sequence: u64,
    source: PhysicalSourceBindingV8,
    style: PhysicalStyleDescriptorV8,
    style_payload_commitment: vector<u8>,
    style_seal_binding_commitment: vector<u8>,
    source_style_commitment: vector<u8>,
    style_identity_commitment: vector<u8>,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    issued_count: u64,
    consumed_count: u64,
    row_commitment: vector<u8>,
}

public struct PhysicalProofProvenanceV8 has copy, drop, store {
    output_registry_id: ID,
    soul_registry_id: ID,
    output_key: String,
    output_policy_commitment: vector<u8>,
    output_id: ID,
    receipt_id: ID,
    soul_id: ID,
    soul_ownership_epoch: u64,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
    soul_commitment: vector<u8>,
    materialization_key: String,
    witness_commitment: vector<u8>,
}

/// Wallet-owned physical instance. `key` without `store` is deliberate: only
/// Physical's holder-checked transfer/consume paths can move or destroy it.
public struct PhysicalAssetV8 has key {
    id: UID,
    version: u64,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    source: PhysicalSourceBindingV8,
    style: PhysicalStyleDescriptorV8,
    style_seal_binding_commitment: vector<u8>,
    source_style_commitment: vector<u8>,
    style_identity_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
    material_policy_commitment: vector<u8>,
    policy_row_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    serial: u64,
    holder: address,
    ownership_epoch: u64,
    transferable: bool,
    authorization_key: vector<u8>,
    proof: Option<PhysicalProofProvenanceV8>,
    provenance_commitment: vector<u8>,
}

/// Persistent readback derived only from the live custody inputs. Market may
/// store this value in its listing, but it is data rather than authority: each
/// release hook also requires Market's exact private call cap, the exact live
/// Market objects, the listing UID, and the real `Receiving<PhysicalAssetV8>`.
public struct PhysicalMarketCustodyBindingV8 has copy, drop, store {
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    market_authority_id: ID,
    market_registry_id: ID,
    market_treasury_id: ID,
    listing_id: ID,
    physical_package_config_id: ID,
    physical_registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    asset_id: ID,
    asset_content_commitment: vector<u8>,
    source_kind: u8,
    source_id: ID,
    source_semantic_id: String,
    source_content_commitment: vector<u8>,
    source_treasury_id: ID,
    holder: address,
    ownership_epoch: u64,
    transferable: bool,
    provenance_commitment: vector<u8>,
}

/// Ephemeral custody acknowledgement. Deliberately has no copy/drop/store/key
/// ability, so Market must consume it in the listing-open transaction.
public struct PhysicalMarketCustodyTicketV8 {
    binding: PhysicalMarketCustodyBindingV8,
}

public struct PhysicalSelectionEvidenceV8 has copy, drop {
    loadout_id: ID,
    root_id: ID,
    maker_version: u64,
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

public struct PhysicalPackAccessBindingV8 has copy, drop {
    root_id: ID,
    maker_version: u64,
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

/// One shared registry per Maker Root. Future Pack/issuance lanes are present
/// from genesis so activation can prove them exactly zero without a struct
/// layout upgrade or an off-chain negative assertion.
public struct PhysicalRegistryV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    package_config_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    base_registry_id: ID,
    expected_base_policy_count: u64,
    observed_base_policy_count: u64,
    expected_base_policy_commitment: vector<u8>,
    rolling_base_policy_commitment: vector<u8>,
    base_sealed: bool,
    base_policy_keys: vector<PhysicalPolicyKeyV8>,
    base_policies: Table<PhysicalPolicyKeyV8, PhysicalStylePolicyV8>,
    revision: u64,
    pack_policy_count: u64,
    pack_policy_keys: vector<PhysicalPolicyKeyV8>,
    pack_policies: Table<PhysicalPolicyKeyV8, PhysicalStylePolicyV8>,
    total_issued: u64,
    total_free_claimed: u64,
    total_paid_purchased: u64,
    total_proof_materialized: u64,
    total_consumed: u64,
    gross_paid_atomic: u128,
    protocol_paid_atomic: u128,
    maker_paid_atomic: u128,
    pack_paid_atomic: u128,
    used_authorization_count: u64,
    used_authorizations: Table<vector<u8>, bool>,
}

public struct BaseStyleIdentityInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    base_registry_id: ID,
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    asset_blob_id: String,
    asset_sha256: vector<u8>,
    protected: bool,
    payload_commitment: vector<u8>,
}

public struct EmptyBasePolicyCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    product_binding_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    base_registry_id: ID,
}

public struct BasePolicyRowCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    product_binding_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    base_registry_id: ID,
    sequence: u64,
    style_identity_commitment: vector<u8>,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
}

public struct BasePolicyAdvanceCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    sequence: u64,
    prior_commitment: vector<u8>,
    row_commitment: vector<u8>,
}

public struct PhysicalReadinessCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    catalog_id: ID,
    package_config_id: ID,
    call_cap_set_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    base_registry_id: ID,
    physical_registry_id: ID,
    expected_base_policy_count: u64,
    observed_base_policy_count: u64,
    base_policy_commitment: vector<u8>,
    revision: u64,
    pack_policy_count: u64,
    total_issued: u64,
    total_consumed: u64,
    gross_paid_atomic: u128,
    protocol_paid_atomic: u128,
    maker_paid_atomic: u128,
    pack_paid_atomic: u128,
    used_authorization_count: u64,
}

public struct PackPolicyRowCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    product_binding_commitment: vector<u8>,
    physical_registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    registry_revision: u64,
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
    style_identity_commitment: vector<u8>,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
}

public struct PhysicalAuthorizationKeyInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    registry_id: ID,
    root_id: ID,
    source_kind: u8,
    source_id: ID,
    policy_row_commitment: vector<u8>,
    holder: address,
    subject_id: ID,
    subject_commitment: vector<u8>,
}

public struct PhysicalAssetCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    source: PhysicalSourceBindingV8,
    style: PhysicalStyleDescriptorV8,
    style_seal_binding_commitment: vector<u8>,
    source_style_commitment: vector<u8>,
    style_identity_commitment: vector<u8>,
    asset_content_commitment: vector<u8>,
    material_policy_commitment: vector<u8>,
    policy_row_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    serial: u64,
    original_holder: address,
    transferable: bool,
    authorization_key: vector<u8>,
    proof: Option<PhysicalProofProvenanceV8>,
}

public struct PhysicalRegistrySealedV8 has copy, drop {
    root_id: ID,
    registry_id: ID,
    base_policy_count: u64,
    base_policy_commitment: vector<u8>,
}

public struct PackPhysicalPolicyRegisteredV8 has copy, drop {
    root_id: ID,
    registry_id: ID,
    registry_revision: u64,
    pack_registry_id: ID,
    pack_registry_revision: u64,
    release_id: ID,
    pack_treasury_id: ID,
    style_identity_commitment: vector<u8>,
    row_commitment: vector<u8>,
}

public struct PhysicalAssetIssuedV8 has copy, drop {
    asset_id: ID,
    root_id: ID,
    registry_id: ID,
    source_kind: u8,
    source_id: ID,
    serial: u64,
    holder: address,
    issuance_kind: u8,
    authorization_key: vector<u8>,
    provenance_commitment: vector<u8>,
}

public struct PhysicalAssetTransferredV8 has copy, drop {
    asset_id: ID,
    previous_holder: address,
    holder: address,
    ownership_epoch: u64,
}

public struct PhysicalAssetConsumedV8 has copy, drop {
    asset_id: ID,
    root_id: ID,
    registry_id: ID,
    source_kind: u8,
    source_id: ID,
    serial: u64,
    holder: address,
    provenance_commitment: vector<u8>,
}

public struct PhysicalMarketCustodyTransitionV8 has copy, drop {
    action: u8,
    listing_id: ID,
    asset_id: ID,
    source_kind: u8,
    source_treasury_id: ID,
    previous_holder: address,
    holder: address,
    previous_ownership_epoch: u64,
    ownership_epoch: u64,
    provenance_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }
public fun source_base_style_v8(): u8 { SOURCE_BASE_STYLE }
public fun source_pack_style_v8(): u8 { SOURCE_PACK_STYLE }
public fun issue_free_claim_v8(): u8 { ISSUE_FREE_CLAIM }
public fun issue_paid_purchase_v8(): u8 { ISSUE_PAID_PURCHASE }
public fun issue_proof_materialize_v8(): u8 { ISSUE_PROOF_MATERIALIZE }
public fun proof_none_v8(): u8 { PROOF_NONE }
public fun proof_canonical_soul_v8(): u8 { PROOF_CANONICAL_SOUL }

public fun new_physical_package_config_v8(
    catalog: &mut ProductReleaseCatalogV8,
    physical_call_cap: PackageCallCapV8<PhysicalRoleV8>,
    ctx: &mut TxContext,
): PhysicalPackageConfigV8 {
    let id = object::new(ctx);
    let installation_commitment = binding::consume_physical_call_cap_v8(
        catalog, physical_call_cap, PhysicalSetupInstallWitnessV2 {}, object::uid_to_inner(&id));
    let (_, _, _, product, cap_set, _) = binding::catalog_terms_v2(catalog);
    PhysicalPackageConfigV8 {
        id, version: VERSION, catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *cap_set,
        installation_commitment,
    }
}

public fun share_physical_package_config_v8(config: PhysicalPackageConfigV8) {
    transfer::share_object(config)
}

public fun new_physical_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    expected_base_policy_count: u64,
    expected_base_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): PhysicalRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_config(catalog, config);
    assert_base_registry(root, base_registry);
    new_registry(
        root,
        base_registry,
        config,
        expected_base_policy_count,
        expected_base_policy_commitment,
        ctx,
    )
}

fun new_registry<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    config: &PhysicalPackageConfigV8,
    expected_base_policy_count: u64,
    expected_base_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): PhysicalRegistryV8 {
    assert!(expected_base_policy_count <= MAX_POLICY_COUNT, EInvalidCount);
    assert_hash(&expected_base_policy_commitment);
    let rolling_base_policy_commitment = empty_base_policy_commitment_v8(
        root,
        base_registry,
        config,
    );
    if (expected_base_policy_count == 0) {
        assert!(
            expected_base_policy_commitment == rolling_base_policy_commitment,
            EInvalidCommitment,
        );
    };
    PhysicalRegistryV8 {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: config.catalog_id,
        package_config_id: object::id(config),
        product_binding_commitment: config.product_binding_commitment,
        call_cap_set_commitment: config.call_cap_set_commitment,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        base_registry_id: object::id(base_registry),
        expected_base_policy_count,
        observed_base_policy_count: 0,
        expected_base_policy_commitment,
        rolling_base_policy_commitment,
        base_sealed: false,
        base_policy_keys: vector[],
        base_policies: table::new(ctx),
        revision: 0,
        pack_policy_count: 0,
        pack_policy_keys: vector[],
        pack_policies: table::new(ctx),
        total_issued: 0,
        total_free_claimed: 0,
        total_paid_purchased: 0,
        total_proof_materialized: 0,
        total_consumed: 0,
        gross_paid_atomic: 0,
        protocol_paid_atomic: 0,
        maker_paid_atomic: 0,
        pack_paid_atomic: 0,
        used_authorization_count: 0,
        used_authorizations: table::new(ctx),
    }
}

public fun empty_base_policy_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    config: &PhysicalPackageConfigV8,
): vector<u8> {
    assert_base_registry(root, base_registry);
    hash::sha2_256(bcs::to_bytes(&EmptyBasePolicyCommitmentInputV8 {
        domain: b"animacraft-v8/physical/base-empty",
        version: VERSION,
        product_binding_commitment: config.product_binding_commitment,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        base_registry_id: object::id(base_registry),
    }))
}

public fun derive_base_style_identity_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    part_key: String,
    item_key: String,
    style_key: String,
): vector<u8> {
    assert_base_registry(root, base_registry);
    let row = base::borrow_style_v2(base_registry, part_key, item_key, style_key);
    derive_style_identity(root, base_registry, row)
}

public fun derive_base_policy_row_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    config: &PhysicalPackageConfigV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
): vector<u8> {
    assert_base_registry(root, base_registry);
    assert_hash(&material_policy_commitment);
    assert_policy_terms(issuance_kind, proof_kind, price_atomic, max_supply);
    let style = base::borrow_style_v2(base_registry, part_key, item_key, style_key);
    let style_identity_commitment = derive_style_identity(root, base_registry, style);
    hash::sha2_256(bcs::to_bytes(&BasePolicyRowCommitmentInputV8 {
        domain: b"animacraft-v8/physical/base-policy",
        version: VERSION,
        product_binding_commitment: config.product_binding_commitment,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        base_registry_id: object::id(base_registry),
        sequence,
        style_identity_commitment,
        material_policy_commitment,
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
    }))
}

public fun advance_base_policy_commitment_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    sequence: u64,
    prior_commitment: vector<u8>,
    row_commitment: vector<u8>,
): vector<u8> {
    assert_hash(&prior_commitment);
    assert_hash(&row_commitment);
    hash::sha2_256(bcs::to_bytes(&BasePolicyAdvanceCommitmentInputV8 {
        domain: b"animacraft-v8/physical/base-row",
        version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        sequence,
        prior_commitment,
        row_commitment,
    }))
}

public fun append_base_style_policy_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    row_commitment: vector<u8>,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    append_base_style_policy(
        registry,
        root,
        base_registry,
        config,
        sequence,
        part_key,
        item_key,
        style_key,
        material_policy_commitment,
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
        row_commitment,
    )
}

fun append_base_style_policy<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    config: &PhysicalPackageConfigV8,
    sequence: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    row_commitment: vector<u8>,
) {
    assert!(!registry.base_sealed, ERegistrySealed);
    assert!(sequence == registry.observed_base_policy_count, EInvalidSequence);
    assert!(sequence < registry.expected_base_policy_count, EInvalidCount);
    let expected_row = derive_base_policy_row_commitment_v8(
        root,
        base_registry,
        config,
        sequence,
        part_key,
        item_key,
        style_key,
        material_policy_commitment,
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
    );
    assert!(row_commitment == expected_row, EInvalidCommitment);
    let style = base::borrow_style_v2(base_registry, part_key, item_key, style_key);
    let key = PhysicalPolicyKeyV8 {
        source_kind: SOURCE_BASE_STYLE,
        source_id: object::id(base_registry),
        part_key: *base::style_part_key_v2(style),
        item_key: *base::style_item_key_v2(style),
        style_key: *base::style_key_v2(style),
    };
    assert!(!registry.base_policies.contains(key), EDuplicatePolicy);
    let next = advance_base_policy_commitment_v8(
        root,
        sequence,
        registry.rolling_base_policy_commitment,
        row_commitment,
    );
    registry.base_policies.add(key, PhysicalStylePolicyV8 {
        sequence,
        source: PhysicalSourceBindingV8 {
            source_kind: SOURCE_BASE_STYLE,
            source_id: object::id(base_registry),
            source_semantic_id: b"".to_string(),
            source_content_commitment: *maker::root_content_commitment_v8(root),
            source_treasury_id: option::none(),
            pack_registry_id: option::none(),
            pack_registry_revision: 0,
            registered_pack_owner: option::none(),
            registered_pack_control_epoch: 0,
            registered_pack_admin_cap_id: option::none(),
        },
        style: PhysicalStyleDescriptorV8 {
            part_key: *base::style_part_key_v2(style),
            item_key: *base::style_item_key_v2(style),
            style_key: *base::style_key_v2(style),
            layer_track_key: *base::style_layer_track_key_v2(style),
            color_channel_key: *base::style_color_channel_key_v2(style),
            default_swatch_key: *base::style_default_swatch_key_v2(style),
            style_asset_blob_id: *base::style_asset_blob_id_v2(style),
            style_asset_sha256: *base::style_asset_sha256_v2(style),
            style_protected: base::style_protected_v2(style),
        },
        style_payload_commitment: *base::style_payload_commitment_v2(style),
        style_seal_binding_commitment: vector[],
        source_style_commitment: *base::style_payload_commitment_v2(style),
        style_identity_commitment: derive_style_identity(root, base_registry, style),
        material_policy_commitment,
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
        issued_count: 0,
        consumed_count: 0,
        row_commitment,
    });
    registry.base_policy_keys.push_back(key);
    registry.observed_base_policy_count = registry.observed_base_policy_count + 1;
    registry.rolling_base_policy_commitment = next;
}

public fun seal_physical_registry_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    seal_registry(registry)
}

fun seal_registry(registry: &mut PhysicalRegistryV8) {
    assert!(!registry.base_sealed, ERegistrySealed);
    assert!(
        registry.observed_base_policy_count == registry.expected_base_policy_count,
        EInvalidCount,
    );
    assert!(
        registry.base_policy_keys.length() == registry.expected_base_policy_count,
        EInvalidCount,
    );
    assert!(
        registry.rolling_base_policy_commitment
            == registry.expected_base_policy_commitment,
        EInvalidCommitment,
    );
    registry.base_sealed = true;
    event::emit(PhysicalRegistrySealedV8 {
        root_id: registry.root_id,
        registry_id: object::id(registry),
        base_policy_count: registry.observed_base_policy_count,
        base_policy_commitment: registry.rolling_base_policy_commitment,
    });
}

public fun validate_physical_activation_readiness_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    registry: &PhysicalRegistryV8,
): vector<u8> {
    binding::assert_catalog_current_v8(protocol_config, catalog);
    binding::assert_replacement_current_v2(replacement, catalog);
    maker::assert_product_release_catalog_v8(root, catalog);
    assert_config(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    maker::assert_draft_v8(root);
    assert_activation_ready(registry);
    derive_readiness_commitment(registry)
}

fun derive_readiness_commitment(registry: &PhysicalRegistryV8): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&PhysicalReadinessCommitmentInputV8 {
        domain: b"animacraft-v8/physical/readiness",
        version: VERSION,
        catalog_id: registry.catalog_id,
        package_config_id: registry.package_config_id,
        call_cap_set_commitment: registry.call_cap_set_commitment,
        root_id: registry.root_id,
        maker_version: registry.maker_version,
        root_content_commitment: registry.root_content_commitment,
        base_registry_id: registry.base_registry_id,
        physical_registry_id: object::id(registry),
        expected_base_policy_count: registry.expected_base_policy_count,
        observed_base_policy_count: registry.observed_base_policy_count,
        base_policy_commitment: registry.rolling_base_policy_commitment,
        revision: registry.revision,
        pack_policy_count: registry.pack_policy_count,
        total_issued: registry.total_issued,
        total_consumed: registry.total_consumed,
        gross_paid_atomic: registry.gross_paid_atomic,
        protocol_paid_atomic: registry.protocol_paid_atomic,
        maker_paid_atomic: registry.maker_paid_atomic,
        pack_paid_atomic: registry.pack_paid_atomic,
        used_authorization_count: registry.used_authorization_count,
    }))
}

public fun share_physical_registry_v8(registry: PhysicalRegistryV8) {
    transfer::share_object(registry)
}

/// Installs one Pack-backed policy after activation. The caller must present
/// both current Maker and Pack control, the exact Physical config, and the
/// current Physical registry revision. Runtime derives and consumes the live
/// admitted Release/Style/Treasury witness; IDs and semantic keys alone never
/// authorize a row.
public fun register_pack_style_policy_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    maker_admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_admin: &PackAdminCapV8,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    expected_revision: u64,
    part_key: String,
    item_key: String,
    style_key: String,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    ctx: &TxContext,
) {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_active_registry(registry, root, catalog, config);
    maker::assert_admin_v8(root, maker_admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EWrongHolder);
    assert!(registry.revision == expected_revision, EStaleRevision);
    assert!(
        registry.observed_base_policy_count + registry.pack_policy_count
            < MAX_POLICY_COUNT,
        EInvalidCount,
    );
    assert_hash(&material_policy_commitment);
    assert_policy_terms(
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
    );
    let witness = runtime::new_physical_pack_policy_witness_v8<PaymentCoin, PhysicalRuntimeWitnessV2>(
        root, PhysicalRuntimeWitnessV2 {}, protocol_config, catalog, replacement,
        packs,
        release,
        pack_admin,
        pack_treasury,
        part_key,
        item_key,
        style_key,
        ctx,
    );
    append_pack_policy_from_witness(
        registry,
        root,
        protocol_config,
        catalog,
        replacement,
        config,
        expected_revision,
        witness,
        material_policy_commitment,
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
    )
}

#[allow(lint(unused_object_with_fields))]
fun append_pack_policy_from_witness<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    _config: &PhysicalPackageConfigV8,
    expected_revision: u64,
    witness: RuntimePhysicalPackPolicyWitnessV8,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
) {
    let (
        root_id,
        maker_version,
        root_content_commitment,
        pack_registry_id,
        pack_registry_revision,
        release_id,
        semantic_pack_id,
        release_content_commitment,
        pack_owner,
        pack_control_epoch,
        pack_admin_cap_id,
        pack_treasury_id,
        style_index,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        color_channel_key,
        default_swatch_key,
        asset_blob_id,
        asset_sha256,
        asset_content_commitment,
        protected,
        seal_binding_commitment,
        source_style_commitment,
        style_identity_commitment,
    ) = runtime::consume_physical_pack_policy_witness_v8<PaymentCoin, PhysicalRuntimeWitnessV2>(
        witness, PhysicalRuntimeWitnessV2 {}, root, protocol_config, catalog, replacement);
    assert!(registry.revision == expected_revision, EStaleRevision);
    assert!(root_id == registry.root_id, EInvalidBinding);
    assert!(maker_version == registry.maker_version, EInvalidBinding);
    assert!(root_content_commitment == registry.root_content_commitment, EInvalidBinding);
    let key = PhysicalPolicyKeyV8 {
        source_kind: SOURCE_PACK_STYLE,
        source_id: release_id,
        part_key,
        item_key,
        style_key,
    };
    assert!(!registry.pack_policies.contains(key), EDuplicatePolicy);
    let next_revision = expected_revision + 1;
    let sequence = registry.expected_base_policy_count + registry.pack_policy_count;
    let row_commitment = hash::sha2_256(bcs::to_bytes(
        &PackPolicyRowCommitmentInputV8 {
            domain: b"animacraft-v8/physical/pack-policy",
            version: VERSION,
            product_binding_commitment: registry.product_binding_commitment,
            physical_registry_id: object::id(registry),
            root_id,
            maker_version,
            root_content_commitment,
            registry_revision: next_revision,
            pack_registry_id,
            pack_registry_revision,
            release_id,
            semantic_pack_id,
            release_content_commitment,
            pack_owner,
            pack_control_epoch,
            pack_admin_cap_id,
            pack_treasury_id,
            style_index,
            style_identity_commitment,
            material_policy_commitment,
            issuance_kind,
            proof_kind,
            price_atomic,
            max_supply,
            transferable,
        },
    ));
    registry.pack_policies.add(key, PhysicalStylePolicyV8 {
        sequence,
        source: PhysicalSourceBindingV8 {
            source_kind: SOURCE_PACK_STYLE,
            source_id: release_id,
            source_semantic_id: semantic_pack_id,
            source_content_commitment: release_content_commitment,
            source_treasury_id: option::some(pack_treasury_id),
            pack_registry_id: option::some(pack_registry_id),
            pack_registry_revision,
            registered_pack_owner: option::some(pack_owner),
            registered_pack_control_epoch: pack_control_epoch,
            registered_pack_admin_cap_id: option::some(pack_admin_cap_id),
        },
        style: PhysicalStyleDescriptorV8 {
            part_key,
            item_key,
            style_key,
            layer_track_key,
            color_channel_key,
            default_swatch_key,
            style_asset_blob_id: asset_blob_id,
            style_asset_sha256: asset_sha256,
            style_protected: protected,
        },
        style_payload_commitment: asset_content_commitment,
        style_seal_binding_commitment: seal_binding_commitment,
        source_style_commitment,
        style_identity_commitment,
        material_policy_commitment,
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
        issued_count: 0,
        consumed_count: 0,
        row_commitment,
    });
    registry.pack_policy_keys.push_back(key);
    registry.pack_policy_count = registry.pack_policy_count + 1;
    registry.revision = next_revision;
    event::emit(PackPhysicalPolicyRegisteredV8 {
        root_id,
        registry_id: object::id(registry),
        registry_revision: next_revision,
        pack_registry_id,
        pack_registry_revision,
        release_id,
        pack_treasury_id,
        style_identity_commitment,
        row_commitment,
    });
}

/// One free claim per exact policy and holder. The current selection comes
/// from Runtime's no-ability proof chain; caller-supplied keys are absent.
public fun claim_free_base_style_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    selection_witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_active_registry(registry, root, catalog, config);
    let selection = consume_runtime_selection(selection_witness, loadout, ctx);
    assert_selection_root(registry, &selection, ctx);
    let policy = *borrow_base_policy_by_selection(registry, &selection);
    assert!(policy.issuance_kind == ISSUE_FREE_CLAIM, EWrongIssuance);
    let authorization_key = derive_authorization_key(
        b"animacraft-v8/physical/free-claim",
        registry,
        &policy,
        selection.holder,
        policy.source.source_id,
        vector[],
    );
    issue_asset(
        registry,
        policy,
        selection.holder,
        expected_issued_count,
        authorization_key,
        option::none(),
        ctx,
    )
}

public fun claim_free_pack_style_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    selection_witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_active_registry(registry, root, catalog, config);
    let selection = consume_runtime_selection(selection_witness, loadout, ctx);
    assert_selection_root(registry, &selection, ctx);
    let access = certify_pack_access(
        root,
        protocol_config,
        catalog,
        replacement,
        config,
        packs,
        release,
        pack_treasury,
        pass,
        loadout,
        selection.selection_index,
        ctx,
    );
    assert_pack_selection_matches(&selection, &access);
    let policy = *borrow_pack_policy_by_access(registry, &access);
    assert!(policy.issuance_kind == ISSUE_FREE_CLAIM, EWrongIssuance);
    let authorization_key = derive_authorization_key(
        b"animacraft-v8/physical/free-claim",
        registry,
        &policy,
        selection.holder,
        policy.source.source_id,
        vector[],
    );
    issue_asset(
        registry,
        policy,
        selection.holder,
        expected_issued_count,
        authorization_key,
        option::none(),
        ctx,
    )
}

/// Exact-price Base purchase. Payment is atomically split between Core's
/// ProtocolTreasury and the Root-bound MakerTreasury; Physical owns no funds.
public fun purchase_base_style_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    selection_witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_active_registry(registry, root, catalog, config);
    let selection = consume_runtime_selection(selection_witness, loadout, ctx);
    assert_selection_root(registry, &selection, ctx);
    let policy = *borrow_base_policy_by_selection(registry, &selection);
    assert!(policy.issuance_kind == ISSUE_PAID_PURCHASE, EWrongIssuance);
    let payment_id = object::id(&payment);
    let authorization_key = derive_authorization_key(
        b"animacraft-v8/physical/paid-purchase",
        registry,
        &policy,
        selection.holder,
        payment_id,
        vector[],
    );
    assert_issue_available(
        registry,
        &policy,
        expected_issued_count,
        &authorization_key,
    );
    let (protocol_atomic, maker_atomic) = settle_base_payment(
        registry,
        root,
        protocol_config,
        protocol_treasury,
        maker_treasury,
        policy.price_atomic,
        payment,
        ctx,
    );
    assert!(protocol_atomic + maker_atomic == policy.price_atomic, EWrongPayment);
    issue_asset(
        registry,
        policy,
        selection.holder,
        expected_issued_count,
        authorization_key,
        option::none(),
        ctx,
    )
}

/// Exact-price Pack purchase. The residual goes only to Runtime's exact
/// Release-bound PackTreasury; there is no Physical treasury.
public fun purchase_pack_style_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &mut PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    protocol_config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    payment: Coin<PaymentCoin>,
    selection_witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_active_registry(registry, root, catalog, config);
    let selection = consume_runtime_selection(selection_witness, loadout, ctx);
    assert_selection_root(registry, &selection, ctx);
    let access = certify_pack_access(
        root,
        protocol_config,
        catalog,
        replacement,
        config,
        packs,
        release,
        pack_treasury,
        pass,
        loadout,
        selection.selection_index,
        ctx,
    );
    assert_pack_selection_matches(&selection, &access);
    let policy = *borrow_pack_policy_by_access(registry, &access);
    assert!(policy.issuance_kind == ISSUE_PAID_PURCHASE, EWrongIssuance);
    let payment_id = object::id(&payment);
    let authorization_key = derive_authorization_key(
        b"animacraft-v8/physical/paid-purchase",
        registry,
        &policy,
        selection.holder,
        payment_id,
        vector[],
    );
    assert_issue_available(
        registry,
        &policy,
        expected_issued_count,
        &authorization_key,
    );
    let (protocol_atomic, pack_atomic) = settle_pack_payment(
        registry,
        root,
        release,
        pack_treasury,
        protocol_config,
        protocol_treasury,
        policy.price_atomic,
        payment,
        ctx,
    );
    assert!(protocol_atomic + pack_atomic == policy.price_atomic, EWrongPayment);
    issue_asset(
        registry,
        policy,
        selection.holder,
        expected_issued_count,
        authorization_key,
        option::none(),
        ctx,
    )
}

/// Soul-only materialization for a Base Style. Output has already reserved the
/// exact Soul/materialization key and consumed the current Runtime selection.
public fun materialize_base_style_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    witness: PhysicalMaterializationWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_active_registry(registry, root, catalog, config);
    let (complete, selection, materialization_key, witness_commitment) =
        output::consume_physical_materialization_witness_v8<PhysicalRuntimeWitnessV2>(
            witness, PhysicalRuntimeWitnessV2 {}, protocol_config, catalog, replacement);
    let soul_registry_id = assert_complete_binding(registry, root, &complete, ctx);
    assert_output_selection_current(&complete, &selection, loadout);
    let policy = *borrow_base_policy_v8(registry, &selection);
    assert!(policy.issuance_kind == ISSUE_PROOF_MATERIALIZE, EWrongIssuance);
    let proof = proof_provenance(
        &complete,
        soul_registry_id,
        materialization_key,
        witness_commitment,
    );
    let authorization_key = derive_authorization_key(
        b"animacraft-v8/physical/proof-materialize",
        registry,
        &policy,
        @0x0,
        output::physical_complete_soul_id_v8(&complete),
        proof.soul_commitment,
    );
    issue_asset(
        registry,
        policy,
        output::physical_complete_holder_v8(&complete),
        expected_issued_count,
        authorization_key,
        option::some(proof),
        ctx,
    )
}

/// Pack materialization additionally re-reads current admission, ACTIVE
/// Release, exact PackTreasury, holder Pass, loadout, and Style via Runtime.
public fun materialize_pack_style_v8<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    witness: PhysicalMaterializationWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    assert_active_registry(registry, root, catalog, config);
    let (complete, selection, materialization_key, witness_commitment) =
        output::consume_physical_materialization_witness_v8<PhysicalRuntimeWitnessV2>(
            witness, PhysicalRuntimeWitnessV2 {}, protocol_config, catalog, replacement);
    let soul_registry_id = assert_complete_binding(registry, root, &complete, ctx);
    assert_output_selection_current(&complete, &selection, loadout);
    let access = certify_pack_access(
        root,
        protocol_config,
        catalog,
        replacement,
        config,
        packs,
        release,
        pack_treasury,
        pass,
        loadout,
        output::physical_selection_index_v8(&selection),
        ctx,
    );
    assert_output_pack_selection_matches(&selection, &access);
    let policy = *borrow_pack_policy_by_access(registry, &access);
    assert!(policy.issuance_kind == ISSUE_PROOF_MATERIALIZE, EWrongIssuance);
    let proof = proof_provenance(
        &complete,
        soul_registry_id,
        materialization_key,
        witness_commitment,
    );
    let authorization_key = derive_authorization_key(
        b"animacraft-v8/physical/proof-materialize",
        registry,
        &policy,
        @0x0,
        output::physical_complete_soul_id_v8(&complete),
        proof.soul_commitment,
    );
    issue_asset(
        registry,
        policy,
        output::physical_complete_holder_v8(&complete),
        expected_issued_count,
        authorization_key,
        option::some(proof),
        ctx,
    )
}

/// Custodies one exact Base-sourced asset under the listing UID. All binding
/// fields are derived from live objects and the asset; no caller-provided ID,
/// hash, source discriminator, holder, epoch, or transferable flag is accepted.
public fun custody_base_physical_for_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
): PhysicalMarketCustodyTicketV8 {
    assert_market_custody_current<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert_asset_holder(&asset, ctx);
    assert!(asset.transferable, ENotTransferable);
    assert_market_asset_registry_binding(physical_registry, root, &asset);
    let source_treasury_id = object::id(maker_treasury);
    assert_base_market_source(physical_registry, root, &asset, source_treasury_id);
    custody_physical_for_market(
        physical_registry,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
        listing_parent,
        asset,
        source_treasury_id,
    )
}

/// Typed Pack branch. The treasury ID is read from the exact
/// `PackTreasuryV8<PaymentCoin>` object and must equal the immutable ID carried
/// by the registry policy and asset.
public fun custody_pack_physical_for_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
): PhysicalMarketCustodyTicketV8 {
    assert_market_custody_current<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    assert_asset_holder(&asset, ctx);
    assert!(asset.transferable, ENotTransferable);
    assert_market_asset_registry_binding(physical_registry, root, &asset);
    let source_treasury_id = object::id(pack_treasury);
    assert_pack_market_source(&asset, source_treasury_id);
    custody_physical_for_market(
        physical_registry,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
        listing_parent,
        asset,
        source_treasury_id,
    )
}

/// Consumes the no-ability ticket in the listing-open transaction. The
/// returned binding is intentionally storable readback and is revalidated
/// against live authority, parent, Receiving, registry, and asset on release.
public fun consume_physical_market_custody_ticket_v8(
    ticket: PhysicalMarketCustodyTicketV8,
): PhysicalMarketCustodyBindingV8 {
    let PhysicalMarketCustodyTicketV8 { binding } = ticket;
    binding
}

public fun borrow_physical_market_custody_ticket_binding_v8(
    ticket: &PhysicalMarketCustodyTicketV8,
): &PhysicalMarketCustodyBindingV8 { &ticket.binding }

/// Cancel/recover hook. Retains the bound replacement/caller authority without
/// requiring current protocol enablement, revision or ACTIVE lifecycle:
/// PAUSED/ARCHIVED Root state, protocol disablement, or catalog snapshot drift
/// cannot trap the seller's object. Logical holder/epoch/provenance are not
/// mutated; the exact stored holder is the only return address.
public fun return_physical_from_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
) {
    assert_market_authority<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(
        root,
        protocol_config,
        catalog,
        replacement,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    assert_market_custody_live_binding(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        market_call_cap,
        market_registry,
        market_treasury,
        listing_parent,
        custody,
    );
    let asset = receive_and_assert_market_asset(
        physical_registry,
        root,
        listing_parent,
        receiving,
        custody,
    );
    let asset_id = object::id(&asset);
    let holder = asset.holder;
    let ownership_epoch = asset.ownership_epoch;
    let source_kind = asset.source.source_kind;
    let source_treasury_id = custody.source_treasury_id;
    let provenance_commitment = asset.provenance_commitment;
    event::emit(PhysicalMarketCustodyTransitionV8 {
        action: MARKET_RETURN,
        listing_id: custody.listing_id,
        asset_id,
        source_kind,
        source_treasury_id,
        previous_holder: holder,
        holder,
        previous_ownership_epoch: ownership_epoch,
        ownership_epoch,
        provenance_commitment,
    });
    transfer::transfer(asset, holder)
}

/// ACTIVE/current Base purchase hook. Buyer identity is the transaction
/// sender, not a caller-selected address. Only holder and epoch change.
public fun purchase_base_physical_from_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    assert_market_custody_current<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert_market_custody_live_binding(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        market_call_cap,
        market_registry,
        market_treasury,
        listing_parent,
        custody,
    );
    let source_treasury_id = object::id(maker_treasury);
    assert!(custody.source_kind == SOURCE_BASE_STYLE, EInvalidMarketCustody);
    assert!(custody.source_treasury_id == source_treasury_id, EInvalidTreasury);
    let asset = receive_and_assert_market_asset(
        physical_registry,
        root,
        listing_parent,
        receiving,
        custody,
    );
    assert_base_market_source(physical_registry, root, &asset, source_treasury_id);
    purchase_received_market_asset(asset, custody, ctx)
}

/// ACTIVE/current Pack purchase hook, statically distinct from the Base path.
public fun purchase_pack_physical_from_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    assert_market_custody_current<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    assert_market_custody_live_binding(
        physical_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        market_call_cap,
        market_registry,
        market_treasury,
        listing_parent,
        custody,
    );
    let source_treasury_id = object::id(pack_treasury);
    assert!(custody.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
    assert!(custody.source_treasury_id == source_treasury_id, EInvalidTreasury);
    let asset = receive_and_assert_market_asset(
        physical_registry,
        root,
        listing_parent,
        receiving,
        custody,
    );
    assert_pack_market_source(&asset, source_treasury_id);
    purchase_received_market_asset(asset, custody, ctx)
}

#[allow(unused_mut_parameter)]
fun custody_physical_for_market<MarketRegistry: key, MarketTreasury: key>(
    physical_registry: &PhysicalRegistryV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    asset: PhysicalAssetV8,
    source_treasury_id: ID,
): PhysicalMarketCustodyTicketV8 {
    let custody = new_physical_market_custody_binding(
        physical_registry,
        protocol_config,
        catalog,
        replacement,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
        listing_parent,
        &asset,
        source_treasury_id,
    );
    let listing_id = custody.listing_id;
    event::emit(PhysicalMarketCustodyTransitionV8 {
        action: MARKET_CUSTODY,
        listing_id,
        asset_id: custody.asset_id,
        source_kind: custody.source_kind,
        source_treasury_id,
        previous_holder: custody.holder,
        holder: custody.holder,
        previous_ownership_epoch: custody.ownership_epoch,
        ownership_epoch: custody.ownership_epoch,
        provenance_commitment: custody.provenance_commitment,
    });
    transfer::transfer(asset, listing_id.to_address());
    PhysicalMarketCustodyTicketV8 { binding: custody }
}

fun new_physical_market_custody_binding<MarketRegistry: key, MarketTreasury: key>(
    physical_registry: &PhysicalRegistryV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &UID,
    asset: &PhysicalAssetV8,
    source_treasury_id: ID,
): PhysicalMarketCustodyBindingV8 {
    binding::assert_catalog_current_v8(protocol_config, catalog);
    binding::assert_runtime_caller_cap_v1(market_call_cap, 1, replacement, catalog);
    let (_, _, _, product, call_cap_set, _) = binding::catalog_terms_v2(catalog);
    PhysicalMarketCustodyBindingV8 {
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *call_cap_set,
        market_authority_id: binding::catalog_authority_id_v2(catalog, 4),
        market_registry_id: object::id(market_registry),
        market_treasury_id: object::id(market_treasury),
        listing_id: object::uid_to_inner(listing_parent),
        physical_package_config_id: object::id(physical_config),
        physical_registry_id: object::id(physical_registry),
        root_id: asset.root_id,
        maker_version: asset.maker_version,
        root_content_commitment: asset.root_content_commitment,
        asset_id: object::id(asset),
        asset_content_commitment: asset.asset_content_commitment,
        source_kind: asset.source.source_kind,
        source_id: asset.source.source_id,
        source_semantic_id: asset.source.source_semantic_id,
        source_content_commitment: asset.source.source_content_commitment,
        source_treasury_id,
        holder: asset.holder,
        ownership_epoch: asset.ownership_epoch,
        transferable: asset.transferable,
        provenance_commitment: asset.provenance_commitment,
    }
}

fun purchase_received_market_asset(
    mut asset: PhysicalAssetV8,
    custody: &PhysicalMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    let buyer = ctx.sender();
    assert!(buyer != @0x0 && buyer != asset.holder, EInvalidRecipient);
    assert!(asset.ownership_epoch < 0xffffffffffffffff, EOwnershipEpochOverflow);
    let previous_holder = asset.holder;
    let previous_ownership_epoch = asset.ownership_epoch;
    asset.holder = buyer;
    asset.ownership_epoch = previous_ownership_epoch + 1;
    event::emit(PhysicalMarketCustodyTransitionV8 {
        action: MARKET_PURCHASE,
        listing_id: custody.listing_id,
        asset_id: object::id(&asset),
        source_kind: asset.source.source_kind,
        source_treasury_id: custody.source_treasury_id,
        previous_holder,
        holder: buyer,
        previous_ownership_epoch,
        ownership_epoch: asset.ownership_epoch,
        provenance_commitment: asset.provenance_commitment,
    });
    transfer::transfer(asset, buyer)
}

public fun transfer_new_physical_asset_to_holder_v8(asset: PhysicalAssetV8) {
    let holder = asset.holder;
    transfer::transfer(asset, holder)
}

/// Direct holder-authorized transfer. It intentionally accepts no Root,
/// Release, registry lifecycle, payment, or recipient-unlock proof.
public fun transfer_physical_asset_v8(
    mut asset: PhysicalAssetV8,
    recipient: address,
    expected_ownership_epoch: u64,
    ctx: &TxContext,
) {
    assert_asset_holder(&asset, ctx);
    assert!(asset.transferable, ENotTransferable);
    assert!(asset.ownership_epoch == expected_ownership_epoch, EStaleRevision);
    assert!(recipient != @0x0 && recipient != asset.holder, EInvalidRecipient);
    let previous_holder = asset.holder;
    asset.holder = recipient;
    asset.ownership_epoch = asset.ownership_epoch + 1;
    event::emit(PhysicalAssetTransferredV8 {
        asset_id: object::id(&asset),
        previous_holder,
        holder: recipient,
        ownership_epoch: asset.ownership_epoch,
    });
    transfer::transfer(asset, recipient)
}

/// Holder-safe terminal consume. No source lifecycle is consulted, so a
/// PAUSED/ARCHIVED Root or Pack cannot trap the asset.
public fun consume_physical_asset_v8(
    registry: &mut PhysicalRegistryV8,
    asset: PhysicalAssetV8,
    expected_ownership_epoch: u64,
    ctx: &TxContext,
) {
    assert_asset_holder(&asset, ctx);
    assert!(asset.ownership_epoch == expected_ownership_epoch, EStaleRevision);
    assert!(asset.registry_id == object::id(registry), EInvalidBinding);
    assert!(asset.root_id == registry.root_id, EInvalidBinding);
    let key = PhysicalPolicyKeyV8 {
        source_kind: asset.source.source_kind,
        source_id: asset.source.source_id,
        part_key: asset.style.part_key,
        item_key: asset.style.item_key,
        style_key: asset.style.style_key,
    };
    let policy = if (asset.source.source_kind == SOURCE_BASE_STYLE) {
        registry.base_policies.borrow_mut(key)
    } else {
        assert!(asset.source.source_kind == SOURCE_PACK_STYLE, EInvalidBinding);
        registry.pack_policies.borrow_mut(key)
    };
    assert!(policy.row_commitment == asset.policy_row_commitment, EInvalidBinding);
    assert!(policy.consumed_count < policy.issued_count, EInvalidCount);
    policy.consumed_count = policy.consumed_count + 1;
    registry.total_consumed = registry.total_consumed + 1;
    let asset_id = object::id(&asset);
    let root_id = asset.root_id;
    let registry_id = asset.registry_id;
    let source_kind = asset.source.source_kind;
    let source_id = asset.source.source_id;
    let serial = asset.serial;
    let holder = asset.holder;
    let provenance_commitment = asset.provenance_commitment;
    let PhysicalAssetV8 {
        id, version: _, registry_id: _, root_id: _, maker_version: _,
        root_content_commitment: _, source: _, style: _,
        style_seal_binding_commitment: _, source_style_commitment: _,
        style_identity_commitment: _,
        asset_content_commitment: _, material_policy_commitment: _,
        policy_row_commitment: _, issuance_kind: _, proof_kind: _, serial: _,
        holder: _, ownership_epoch: _, transferable: _, authorization_key: _,
        proof: _, provenance_commitment: _,
    } = asset;
    id.delete();
    event::emit(PhysicalAssetConsumedV8 {
        asset_id,
        root_id,
        registry_id,
        source_kind,
        source_id,
        serial,
        holder,
        provenance_commitment,
    });
}

fun assert_active_registry<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
) {
    assert_config(catalog, config);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(), ERegistryNotReady);
    maker::assert_product_release_catalog_v8(root, catalog);
    maker::assert_root_identity_v8(
        root,
        registry.root_id,
        registry.maker_version,
        &registry.root_content_commitment,
    );
    assert!(registry.version == VERSION, EInvalidBinding);
    assert!(registry.base_sealed, ERegistryNotSealed);
    assert!(
        registry.rolling_base_policy_commitment
            == registry.expected_base_policy_commitment,
        EInvalidCommitment,
    );
    assert!(registry.catalog_id == binding::catalog_id_v8(catalog), EInvalidBinding);
    assert!(registry.package_config_id == object::id(config), EInvalidBinding);
    maker::assert_base_registry_identity_v8(root, registry.base_registry_id,
        registry.root_id, registry.maker_version, &registry.root_content_commitment);
    assert!(companion::physical_registry_id_v2(maker::root_companion_registry_ids_v2(root))
        == object::id(registry), EInvalidBinding);
}

fun assert_market_custody_current<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
) {
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    assert_active_registry(physical_registry, root, catalog, physical_config);
    assert_market_authority<
        PaymentCoin,
        MarketRegistry,
        MarketTreasury,
    >(root, protocol_config, catalog, replacement, market_call_cap, market_registry, market_treasury);
    assert!(&physical_registry.product_binding_commitment
        == maker::root_product_release_binding_commitment_v8(root), EInvalidMarketAuthority);
    assert!(&physical_registry.call_cap_set_commitment
        == maker::root_product_release_call_cap_set_commitment_v8(root), EInvalidMarketAuthority);
}

#[allow(lint(unused_object_with_fields))]
fun assert_market_authority<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    _protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
) {
    binding::assert_replacement_current_v2(replacement, catalog);
    binding::assert_runtime_caller_cap_v1(market_call_cap, 1, replacement, catalog);
    maker::assert_product_release_catalog_v8(root, catalog);
    let market_binding = binding::binding_at_v2(binding::catalog_binding_v8(catalog), 5);
    binding::assert_exact_single_argument_type_v2<MarketRegistry, PaymentCoin>(
        market_binding, &b"market_v8", &b"MarketRegistryV8");
    binding::assert_exact_single_argument_type_v2<MarketTreasury, PaymentCoin>(
        market_binding, &b"market_v8", &b"MarketTreasuryV8");
    assert!(companion::market_registry_id_v2(maker::root_companion_registry_ids_v2(root))
        == object::id(market_registry), EInvalidMarketAuthority);
    // Market validates its immutable registry -> treasury relation before
    // exposing its private caller cap. Ticket consumption also matches this ID.
    assert!(object::id(market_registry) != object::id(market_treasury), EInvalidMarketAuthority);
}

fun assert_market_custody_live_binding<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    market_call_cap: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &UID,
    custody: &PhysicalMarketCustodyBindingV8,
) {
    assert_market_authority<PaymentCoin, MarketRegistry, MarketTreasury>(
        root, protocol_config, catalog, replacement, market_call_cap, market_registry, market_treasury);
    let (_, _, _, product, call_cap_set, _) = binding::catalog_terms_v2(catalog);
    assert!(custody.version == VERSION, EInvalidMarketCustody);
    assert!(custody.catalog_id == binding::catalog_id_v8(catalog), EInvalidMarketCustody);
    assert!(
        &custody.product_binding_commitment
            == binding::product_binding_commitment_v8(product),
        EInvalidMarketCustody,
    );
    assert!(
        &custody.call_cap_set_commitment
            == call_cap_set,
        EInvalidMarketCustody,
    );
    assert!(
        custody.market_authority_id == binding::catalog_authority_id_v2(catalog, 4),
        EInvalidMarketCustody,
    );
    assert!(custody.market_registry_id == object::id(market_registry), EInvalidMarketCustody);
    assert!(custody.market_treasury_id == object::id(market_treasury), EInvalidMarketCustody);
    assert!(custody.listing_id == object::uid_to_inner(listing_parent), EInvalidMarketCustody);
    assert!(
        custody.physical_package_config_id == physical_registry.package_config_id,
        EInvalidMarketCustody,
    );
    assert!(
        custody.physical_registry_id == object::id(physical_registry),
        EInvalidMarketCustody,
    );
    assert!(
        companion::physical_registry_id_v2(maker::root_companion_registry_ids_v2(root)) == object::id(physical_registry),
        EInvalidMarketAuthority,
    );
    assert!(custody.root_id == maker::root_id_v8(root), EInvalidMarketCustody);
    assert!(
        custody.maker_version == maker::root_maker_version_v8(root),
        EInvalidMarketCustody,
    );
    assert!(
        &custody.root_content_commitment == maker::root_content_commitment_v8(root),
        EInvalidMarketCustody,
    );
    assert!(custody.transferable, ENotTransferable);
    assert_hash(&custody.asset_content_commitment);
    assert_hash(&custody.source_content_commitment);
    assert_hash(&custody.provenance_commitment);
}

fun receive_and_assert_market_asset<PaymentCoin>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    listing_parent: &mut UID,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
): PhysicalAssetV8 {
    assert!(
        transfer::receiving_object_id(&receiving) == custody.asset_id,
        EInvalidMarketCustody,
    );
    let asset = transfer::receive(listing_parent, receiving);
    assert_market_asset_registry_binding(physical_registry, root, &asset);
    assert_market_custody_asset(custody, root, &asset);
    asset
}

fun assert_market_custody_asset<PaymentCoin>(
    custody: &PhysicalMarketCustodyBindingV8,
    root: &MakerRootV8<PaymentCoin>,
    asset: &PhysicalAssetV8,
) {
    assert!(custody.asset_id == object::id(asset), EInvalidMarketCustody);
    assert!(custody.physical_registry_id == asset.registry_id, EInvalidMarketCustody);
    assert!(custody.root_id == asset.root_id, EInvalidMarketCustody);
    assert!(custody.maker_version == asset.maker_version, EInvalidMarketCustody);
    assert!(
        custody.root_content_commitment == asset.root_content_commitment,
        EInvalidMarketCustody,
    );
    assert!(
        custody.asset_content_commitment == asset.asset_content_commitment,
        EInvalidMarketCustody,
    );
    assert!(custody.source_kind == asset.source.source_kind, EInvalidMarketCustody);
    assert!(custody.source_id == asset.source.source_id, EInvalidMarketCustody);
    assert!(
        custody.source_semantic_id == asset.source.source_semantic_id,
        EInvalidMarketCustody,
    );
    assert!(
        custody.source_content_commitment == asset.source.source_content_commitment,
        EInvalidMarketCustody,
    );
    assert!(custody.holder == asset.holder, EWrongHolder);
    assert!(custody.ownership_epoch == asset.ownership_epoch, EStaleRevision);
    assert!(custody.transferable == asset.transferable, ENotTransferable);
    assert!(custody.transferable, ENotTransferable);
    assert!(
        custody.provenance_commitment == asset.provenance_commitment,
        EInvalidCommitment,
    );
    if (asset.source.source_kind == SOURCE_BASE_STYLE) {
        assert!(asset.source.source_treasury_id.is_none(), EInvalidTreasury);
        maker::assert_maker_treasury_identity_v8(root, custody.source_treasury_id);
    } else {
        assert!(asset.source.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
        assert!(asset.source.source_treasury_id.is_some(), EInvalidTreasury);
        assert!(
            custody.source_treasury_id == *asset.source.source_treasury_id.borrow(),
            EInvalidTreasury,
        );
    };
}

fun assert_market_asset_registry_binding<PaymentCoin>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    asset: &PhysicalAssetV8,
) {
    assert!(asset.version == VERSION, EInvalidBinding);
    assert!(asset.registry_id == object::id(physical_registry), EInvalidBinding);
    maker::assert_root_identity_v8(
        root,
        asset.root_id,
        asset.maker_version,
        &asset.root_content_commitment,
    );
    assert!(physical_registry.root_id == asset.root_id, EInvalidBinding);
    assert!(physical_registry.maker_version == asset.maker_version, EInvalidBinding);
    assert!(
        physical_registry.root_content_commitment == asset.root_content_commitment,
        EInvalidBinding,
    );
    let key = PhysicalPolicyKeyV8 {
        source_kind: asset.source.source_kind,
        source_id: asset.source.source_id,
        part_key: asset.style.part_key,
        item_key: asset.style.item_key,
        style_key: asset.style.style_key,
    };
    let policy = if (asset.source.source_kind == SOURCE_BASE_STYLE) {
        physical_registry.base_policies.borrow(key)
    } else {
        assert!(asset.source.source_kind == SOURCE_PACK_STYLE, EInvalidBinding);
        physical_registry.pack_policies.borrow(key)
    };
    assert!(policy.source.source_kind == asset.source.source_kind, EInvalidBinding);
    assert!(policy.source.source_id == asset.source.source_id, EInvalidBinding);
    assert!(policy.source.source_semantic_id == asset.source.source_semantic_id, EInvalidBinding);
    assert!(
        policy.source.source_content_commitment == asset.source.source_content_commitment,
        EInvalidBinding,
    );
    assert!(policy.source.source_treasury_id == asset.source.source_treasury_id, EInvalidTreasury);
    assert!(policy.source.pack_registry_id == asset.source.pack_registry_id, EInvalidBinding);
    assert!(policy.source.pack_registry_revision == asset.source.pack_registry_revision, EInvalidBinding);
    assert!(policy.row_commitment == asset.policy_row_commitment, EInvalidBinding);
    assert!(
        policy.style_payload_commitment == asset.asset_content_commitment,
        EInvalidBinding,
    );
    assert!(policy.transferable == asset.transferable, EInvalidBinding);
    assert_hash(&asset.provenance_commitment);
}

fun assert_base_market_source<PaymentCoin>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    asset: &PhysicalAssetV8,
    source_treasury_id: ID,
) {
    assert!(asset.source.source_kind == SOURCE_BASE_STYLE, EInvalidMarketCustody);
    assert!(asset.source.source_id == physical_registry.base_registry_id, EInvalidBinding);
    assert!(asset.source.source_semantic_id == b"".to_string(), EInvalidBinding);
    assert!(
        &asset.source.source_content_commitment == maker::root_content_commitment_v8(root),
        EInvalidCommitment,
    );
    assert!(asset.source.source_treasury_id.is_none(), EInvalidTreasury);
    maker::assert_maker_treasury_identity_v8(root, source_treasury_id);
    assert!(asset.source.pack_registry_id.is_none(), EInvalidBinding);
    assert!(asset.source.registered_pack_owner.is_none(), EInvalidBinding);
    assert!(asset.source.registered_pack_admin_cap_id.is_none(), EInvalidBinding);
}

fun assert_pack_market_source(
    asset: &PhysicalAssetV8,
    source_treasury_id: ID,
) {
    assert!(asset.source.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
    assert!(asset.source.source_treasury_id.is_some(), EInvalidTreasury);
    assert!(*asset.source.source_treasury_id.borrow() == source_treasury_id, EInvalidTreasury);
    assert!(asset.source.pack_registry_id.is_some(), EInvalidBinding);
    assert!(asset.source.registered_pack_owner.is_some(), EInvalidBinding);
    assert!(asset.source.registered_pack_admin_cap_id.is_some(), EInvalidBinding);
}

fun consume_runtime_selection(
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): PhysicalSelectionEvidenceV8 {
    let (
        loadout_id,
        root_id,
        maker_version,
        root_content_commitment,
        holder,
        loadout_revision,
        loadout_commitment,
        selection_index,
        selection_commitment,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        source_class,
        source_definition_id,
        source_semantic_id,
        source_content_commitment,
        source_epoch,
        pricing_commitment,
        asset_content_commitment,
    ) = runtime::consume_physical_selection_witness_v8(witness, loadout, ctx);
    PhysicalSelectionEvidenceV8 {
        loadout_id,
        root_id,
        maker_version,
        root_content_commitment,
        holder,
        loadout_revision,
        loadout_commitment,
        selection_index,
        selection_commitment,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        source_class,
        source_definition_id,
        source_semantic_id,
        source_content_commitment,
        source_epoch,
        pricing_commitment,
        asset_content_commitment,
    }
}

#[allow(lint(unused_object_with_fields))]
fun certify_pack_access<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    _config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    loadout: &MakerLoadoutV8,
    selection_index: u64,
    ctx: &TxContext,
): PhysicalPackAccessBindingV8 {
    let witness: RuntimePhysicalPackAccessWitnessV8 =
        runtime::new_physical_pack_access_witness_v8<PaymentCoin, PhysicalRuntimeWitnessV2>(
        root, PhysicalRuntimeWitnessV2 {}, protocol_config, catalog, replacement,
            packs,
            release,
            pack_treasury,
            pass,
            loadout,
            selection_index,
            ctx,
        );
    let (
        root_id,
        maker_version,
        root_content_commitment,
        holder,
        pack_registry_id,
        pack_registry_revision,
        release_id,
        semantic_pack_id,
        release_content_commitment,
        pack_treasury_id,
        pack_pass_id,
        pack_pass_commitment,
        loadout_id,
        loadout_revision,
        loadout_commitment,
        selection_index,
        selection_commitment,
        pricing_commitment,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        asset_content_commitment,
        style_identity_commitment,
    ) = runtime::consume_physical_pack_access_witness_v8<PaymentCoin, PhysicalRuntimeWitnessV2>(
        witness, PhysicalRuntimeWitnessV2 {}, root, protocol_config, catalog, replacement);
    PhysicalPackAccessBindingV8 {
        root_id,
        maker_version,
        root_content_commitment,
        holder,
        pack_registry_id,
        pack_registry_revision,
        release_id,
        semantic_pack_id,
        release_content_commitment,
        pack_treasury_id,
        pack_pass_id,
        pack_pass_commitment,
        loadout_id,
        loadout_revision,
        loadout_commitment,
        selection_index,
        selection_commitment,
        pricing_commitment,
        part_key,
        item_key,
        style_key,
        layer_track_key,
        asset_content_commitment,
        style_identity_commitment,
    }
}

fun assert_selection_root(
    registry: &PhysicalRegistryV8,
    selection: &PhysicalSelectionEvidenceV8,
    ctx: &TxContext,
) {
    assert!(selection.root_id == registry.root_id, EInvalidBinding);
    assert!(selection.maker_version == registry.maker_version, EInvalidBinding);
    assert!(selection.root_content_commitment == registry.root_content_commitment, EInvalidBinding);
    assert!(selection.holder == ctx.sender() && selection.holder != @0x0, EWrongHolder);
}

fun borrow_base_policy_by_selection(
    registry: &PhysicalRegistryV8,
    selection: &PhysicalSelectionEvidenceV8,
): &PhysicalStylePolicyV8 {
    assert!(selection.source_class == runtime::source_base_v8(), EInvalidBinding);
    assert!(selection.source_definition_id == registry.root_id, EInvalidBinding);
    assert!(selection.source_semantic_id.is_empty(), EInvalidBinding);
    assert!(selection.source_content_commitment == registry.root_content_commitment, EInvalidBinding);
    assert!(selection.source_epoch == 0, EInvalidBinding);
    let policy = borrow_base_policy_by_keys(
        registry,
        selection.part_key,
        selection.item_key,
        selection.style_key,
    );
    assert!(policy.style.layer_track_key == selection.layer_track_key, EInvalidBinding);
    assert!(policy.style_payload_commitment == selection.asset_content_commitment, EInvalidBinding);
    policy
}

fun borrow_pack_policy_by_access(
    registry: &PhysicalRegistryV8,
    access: &PhysicalPackAccessBindingV8,
): &PhysicalStylePolicyV8 {
    assert!(access.root_id == registry.root_id, EInvalidBinding);
    assert!(access.maker_version == registry.maker_version, EInvalidBinding);
    assert!(access.root_content_commitment == registry.root_content_commitment, EInvalidBinding);
    let key = PhysicalPolicyKeyV8 {
        source_kind: SOURCE_PACK_STYLE,
        source_id: access.release_id,
        part_key: access.part_key,
        item_key: access.item_key,
        style_key: access.style_key,
    };
    let policy = registry.pack_policies.borrow(key);
    assert!(*policy.source.pack_registry_id.borrow() == access.pack_registry_id, EInvalidBinding);
    assert!(access.pack_registry_revision >= policy.source.pack_registry_revision,
        EStaleRevision);
    assert!(*policy.source.source_treasury_id.borrow() == access.pack_treasury_id, EInvalidTreasury);
    assert_hash(&access.pack_pass_commitment);
    assert!(policy.source.source_semantic_id == access.semantic_pack_id, EInvalidBinding);
    assert!(policy.source.source_content_commitment == access.release_content_commitment, EInvalidBinding);
    assert!(policy.style.layer_track_key == access.layer_track_key, EInvalidBinding);
    assert!(policy.style_payload_commitment == access.asset_content_commitment, EInvalidBinding);
    assert!(policy.style_identity_commitment == access.style_identity_commitment, EInvalidBinding);
    policy
}

fun assert_pack_selection_matches(
    selection: &PhysicalSelectionEvidenceV8,
    access: &PhysicalPackAccessBindingV8,
) {
    assert!(selection.source_class == runtime::source_pack_v8(), EInvalidBinding);
    assert!(selection.root_id == access.root_id, EInvalidBinding);
    assert!(selection.maker_version == access.maker_version, EInvalidBinding);
    assert!(selection.root_content_commitment == access.root_content_commitment, EInvalidBinding);
    assert!(selection.holder == access.holder, EWrongHolder);
    assert!(selection.loadout_id == access.loadout_id, EInvalidBinding);
    assert!(selection.loadout_revision == access.loadout_revision, EStaleRevision);
    assert!(selection.loadout_commitment == access.loadout_commitment, EInvalidBinding);
    assert!(selection.selection_index == access.selection_index, EInvalidBinding);
    assert!(selection.selection_commitment == access.selection_commitment, EInvalidBinding);
    assert!(selection.source_definition_id == access.release_id, EInvalidBinding);
    assert!(selection.source_semantic_id == access.semantic_pack_id, EInvalidBinding);
    assert!(selection.source_content_commitment == access.release_content_commitment, EInvalidBinding);
    assert!(selection.source_epoch == 0, EInvalidBinding);
    assert!(selection.pricing_commitment == access.pricing_commitment, EInvalidBinding);
    assert!(selection.part_key == access.part_key, EInvalidBinding);
    assert!(selection.item_key == access.item_key, EInvalidBinding);
    assert!(selection.style_key == access.style_key, EInvalidBinding);
    assert!(selection.layer_track_key == access.layer_track_key, EInvalidBinding);
    assert!(selection.asset_content_commitment == access.asset_content_commitment, EInvalidBinding);
}

fun assert_output_pack_selection_matches(
    selection: &PhysicalSelectionBindingV8,
    access: &PhysicalPackAccessBindingV8,
) {
    assert!(output::physical_selection_source_class_v8(selection)
        == runtime::source_pack_v8(), EInvalidBinding);
    assert!(output::physical_selection_loadout_id_v8(selection)
        == access.loadout_id, EInvalidBinding);
    assert!(output::physical_selection_loadout_revision_v8(selection)
        == access.loadout_revision, EStaleRevision);
    assert!(output::physical_selection_loadout_commitment_v8(selection)
        == &access.loadout_commitment, EInvalidBinding);
    assert!(output::physical_selection_index_v8(selection)
        == access.selection_index, EInvalidBinding);
    assert!(output::physical_selection_commitment_v8(selection)
        == &access.selection_commitment, EInvalidBinding);
    assert!(output::physical_selection_source_definition_id_v8(selection)
        == access.release_id, EInvalidBinding);
    assert!(output::physical_selection_source_semantic_id_v8(selection)
        == &access.semantic_pack_id, EInvalidBinding);
    assert!(output::physical_selection_source_content_commitment_v8(selection)
        == &access.release_content_commitment, EInvalidBinding);
    assert!(output::physical_selection_source_epoch_v8(selection) == 0, EInvalidBinding);
    assert!(output::physical_selection_pricing_commitment_v8(selection)
        == &access.pricing_commitment, EInvalidBinding);
    assert!(output::physical_selection_part_key_v8(selection) == &access.part_key,
        EInvalidBinding);
    assert!(output::physical_selection_item_key_v8(selection) == &access.item_key,
        EInvalidBinding);
    assert!(output::physical_selection_style_key_v8(selection) == &access.style_key,
        EInvalidBinding);
    assert!(output::physical_selection_layer_track_key_v8(selection)
        == &access.layer_track_key, EInvalidBinding);
    assert!(output::physical_selection_asset_content_commitment_v8(selection)
        == &access.asset_content_commitment, EInvalidBinding);
}

fun assert_complete_binding<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    complete: &PhysicalCompleteBindingV8,
    ctx: &TxContext,
): ID {
    assert!(output::physical_complete_root_id_v8(complete) == registry.root_id,
        EInvalidBinding);
    assert!(output::physical_complete_maker_version_v8(complete)
        == registry.maker_version, EInvalidBinding);
    assert!(output::physical_complete_root_content_commitment_v8(complete)
        == &registry.root_content_commitment, EInvalidBinding);
    assert!(output::physical_complete_holder_v8(complete) == ctx.sender()
        && ctx.sender() != @0x0, EWrongHolder);
    maker::assert_root_identity_v8(
        root,
        output::physical_complete_root_id_v8(complete),
        output::physical_complete_maker_version_v8(complete),
        output::physical_complete_root_content_commitment_v8(complete),
    );
    let companions = maker::root_companion_registry_ids_v2(root);
    assert!(companion::physical_registry_id_v2(companions) == object::id(registry),
        EInvalidBinding);
    assert!(companion::output_registry_id_v2(companions)
        == output::physical_complete_output_registry_id_v8(complete),
        EInvalidBinding);
    companion::soul_registry_id_v2(companions)
}

fun assert_output_selection_current(
    complete: &PhysicalCompleteBindingV8,
    selection: &PhysicalSelectionBindingV8,
    loadout: &MakerLoadoutV8,
) {
    assert!(output::physical_selection_loadout_id_v8(selection)
        == runtime::loadout_id_v8(loadout), EInvalidBinding);
    assert!(output::physical_selection_loadout_revision_v8(selection)
        == runtime::loadout_revision_v8(loadout), EStaleRevision);
    assert!(output::physical_selection_loadout_commitment_v8(selection)
        == runtime::loadout_commitment_v8(loadout), EInvalidBinding);
    assert!(output::physical_complete_holder_v8(complete) != @0x0, EWrongHolder);
}

fun proof_provenance(
    complete: &PhysicalCompleteBindingV8,
    soul_registry_id: ID,
    materialization_key: String,
    witness_commitment: vector<u8>,
): PhysicalProofProvenanceV8 {
    assert_hash(&witness_commitment);
    PhysicalProofProvenanceV8 {
        output_registry_id: output::physical_complete_output_registry_id_v8(complete),
        soul_registry_id,
        output_key: *output::physical_complete_output_key_v8(complete),
        output_policy_commitment:
            *output::physical_complete_policy_commitment_v8(complete),
        output_id: output::physical_complete_output_id_v8(complete),
        receipt_id: output::physical_complete_receipt_id_v8(complete),
        soul_id: output::physical_complete_soul_id_v8(complete),
        soul_ownership_epoch: output::physical_complete_soul_epoch_v8(complete),
        recipe_commitment: *output::physical_complete_recipe_commitment_v8(complete),
        render_commitment: *output::physical_complete_render_commitment_v8(complete),
        output_commitment: *output::physical_complete_output_commitment_v8(complete),
        receipt_commitment: *output::physical_complete_receipt_commitment_v8(complete),
        soul_commitment: *output::physical_complete_soul_commitment_v8(complete),
        materialization_key,
        witness_commitment,
    }
}

fun derive_authorization_key(
    domain: vector<u8>,
    registry: &PhysicalRegistryV8,
    policy: &PhysicalStylePolicyV8,
    holder: address,
    subject_id: ID,
    subject_commitment: vector<u8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&PhysicalAuthorizationKeyInputV8 {
        domain,
        version: VERSION,
        registry_id: object::id(registry),
        root_id: registry.root_id,
        source_kind: policy.source.source_kind,
        source_id: policy.source.source_id,
        policy_row_commitment: policy.row_commitment,
        holder,
        subject_id,
        subject_commitment,
    }))
}

fun assert_issue_available(
    registry: &PhysicalRegistryV8,
    policy: &PhysicalStylePolicyV8,
    expected_issued_count: u64,
    authorization_key: &vector<u8>,
) {
    assert_hash(authorization_key);
    assert!(policy.issued_count == expected_issued_count, EStaleRevision);
    assert!(policy.issued_count < policy.max_supply, ESupplyExhausted);
    assert!(!registry.used_authorizations.contains(*authorization_key), EReplay);
    let current = if (policy.source.source_kind == SOURCE_BASE_STYLE) {
        registry.base_policies.borrow(PhysicalPolicyKeyV8 {
            source_kind: policy.source.source_kind,
            source_id: policy.source.source_id,
            part_key: policy.style.part_key,
            item_key: policy.style.item_key,
            style_key: policy.style.style_key,
        })
    } else {
        registry.pack_policies.borrow(PhysicalPolicyKeyV8 {
            source_kind: policy.source.source_kind,
            source_id: policy.source.source_id,
            part_key: policy.style.part_key,
            item_key: policy.style.item_key,
            style_key: policy.style.style_key,
        })
    };
    assert!(current.row_commitment == policy.row_commitment, EInvalidBinding);
    assert!(current.issued_count == expected_issued_count, EStaleRevision);
}

fun issue_asset(
    registry: &mut PhysicalRegistryV8,
    policy: PhysicalStylePolicyV8,
    holder: address,
    expected_issued_count: u64,
    authorization_key: vector<u8>,
    proof: Option<PhysicalProofProvenanceV8>,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    assert_issue_available(
        registry,
        &policy,
        expected_issued_count,
        &authorization_key,
    );
    if (policy.proof_kind == PROOF_NONE) {
        assert!(proof.is_none(), EWrongIssuance);
    } else {
        assert!(policy.proof_kind == PROOF_CANONICAL_SOUL && proof.is_some(),
            EWrongIssuance);
    };
    registry.used_authorizations.add(authorization_key, true);
    registry.used_authorization_count = registry.used_authorization_count + 1;
    let current = if (policy.source.source_kind == SOURCE_BASE_STYLE) {
        registry.base_policies.borrow_mut(PhysicalPolicyKeyV8 {
            source_kind: policy.source.source_kind,
            source_id: policy.source.source_id,
            part_key: policy.style.part_key,
            item_key: policy.style.item_key,
            style_key: policy.style.style_key,
        })
    } else {
        registry.pack_policies.borrow_mut(PhysicalPolicyKeyV8 {
            source_kind: policy.source.source_kind,
            source_id: policy.source.source_id,
            part_key: policy.style.part_key,
            item_key: policy.style.item_key,
            style_key: policy.style.style_key,
        })
    };
    assert!(current.row_commitment == policy.row_commitment, EInvalidBinding);
    assert!(current.issued_count == expected_issued_count, EStaleRevision);
    current.issued_count = current.issued_count + 1;
    let serial = current.issued_count;
    registry.total_issued = registry.total_issued + 1;
    if (policy.issuance_kind == ISSUE_FREE_CLAIM) {
        registry.total_free_claimed = registry.total_free_claimed + 1;
    } else if (policy.issuance_kind == ISSUE_PAID_PURCHASE) {
        registry.total_paid_purchased = registry.total_paid_purchased + 1;
    } else {
        assert!(policy.issuance_kind == ISSUE_PROOF_MATERIALIZE, EWrongIssuance);
        registry.total_proof_materialized = registry.total_proof_materialized + 1;
    };
    let provenance_commitment = hash::sha2_256(bcs::to_bytes(
        &PhysicalAssetCommitmentInputV8 {
            domain: b"animacraft-v8/physical/asset",
            version: VERSION,
            registry_id: object::id(registry),
            root_id: registry.root_id,
            maker_version: registry.maker_version,
            root_content_commitment: registry.root_content_commitment,
            source: policy.source,
            style: policy.style,
            style_seal_binding_commitment: policy.style_seal_binding_commitment,
            source_style_commitment: policy.source_style_commitment,
            style_identity_commitment: policy.style_identity_commitment,
            asset_content_commitment: policy.style_payload_commitment,
            material_policy_commitment: policy.material_policy_commitment,
            policy_row_commitment: policy.row_commitment,
            issuance_kind: policy.issuance_kind,
            proof_kind: policy.proof_kind,
            serial,
            original_holder: holder,
            transferable: policy.transferable,
            authorization_key,
            proof,
        },
    ));
    let asset = PhysicalAssetV8 {
        id: object::new(ctx),
        version: VERSION,
        registry_id: object::id(registry),
        root_id: registry.root_id,
        maker_version: registry.maker_version,
        root_content_commitment: registry.root_content_commitment,
        source: policy.source,
        style: policy.style,
        style_seal_binding_commitment: policy.style_seal_binding_commitment,
        source_style_commitment: policy.source_style_commitment,
        style_identity_commitment: policy.style_identity_commitment,
        asset_content_commitment: policy.style_payload_commitment,
        material_policy_commitment: policy.material_policy_commitment,
        policy_row_commitment: policy.row_commitment,
        issuance_kind: policy.issuance_kind,
        proof_kind: policy.proof_kind,
        serial,
        holder,
        ownership_epoch: 0,
        transferable: policy.transferable,
        authorization_key,
        proof,
        provenance_commitment,
    };
    event::emit(PhysicalAssetIssuedV8 {
        asset_id: object::id(&asset),
        root_id: registry.root_id,
        registry_id: object::id(registry),
        source_kind: policy.source.source_kind,
        source_id: policy.source.source_id,
        serial,
        holder,
        issuance_kind: policy.issuance_kind,
        authorization_key,
        provenance_commitment,
    });
    asset
}

fun settle_base_payment<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    maker_treasury: &mut MakerTreasuryV8<PaymentCoin>,
    gross: u64,
    mut payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
): (u64, u64) {
    maker::assert_current_protocol_config_v8(root, config);
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert!(coin::value(&payment) == gross && gross > 0, EWrongPayment);
    let economics = maker::root_economics_v8(root);
    let protocol_atomic = protocol_share(
        gross,
        maker::economics_primary_content_fee_bps_v8(&economics),
    );
    let maker_atomic = gross - protocol_atomic;
    if (protocol_atomic > 0) {
        let protocol_payment = coin::split(&mut payment, protocol_atomic, ctx);
        protocol::deposit_protocol_revenue_v8(config, protocol_treasury, protocol_payment);
    };
    assert!(coin::value(&payment) == maker_atomic && maker_atomic > 0, EWrongPayment);
    core_treasury::deposit_maker_revenue_v8(root, maker_treasury, config, payment);
    registry.gross_paid_atomic = registry.gross_paid_atomic + (gross as u128);
    registry.protocol_paid_atomic = registry.protocol_paid_atomic + (protocol_atomic as u128);
    registry.maker_paid_atomic = registry.maker_paid_atomic + (maker_atomic as u128);
    (protocol_atomic, maker_atomic)
}

fun settle_pack_payment<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &mut PackTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    protocol_treasury: &mut ProtocolTreasuryV8<PaymentCoin>,
    gross: u64,
    mut payment: Coin<PaymentCoin>,
    ctx: &mut TxContext,
): (u64, u64) {
    maker::assert_current_protocol_config_v8(root, config);
    assert!(coin::value(&payment) == gross && gross > 0, EWrongPayment);
    let economics = maker::root_economics_v8(root);
    let protocol_atomic = protocol_share(
        gross,
        maker::economics_primary_content_fee_bps_v8(&economics),
    );
    let pack_atomic = gross - protocol_atomic;
    if (protocol_atomic > 0) {
        let protocol_payment = coin::split(&mut payment, protocol_atomic, ctx);
        protocol::deposit_protocol_revenue_v8(config, protocol_treasury, protocol_payment);
    };
    assert!(coin::value(&payment) == pack_atomic && pack_atomic > 0, EWrongPayment);
    runtime::deposit_pack_revenue_v8(release, pack_treasury, payment);
    registry.gross_paid_atomic = registry.gross_paid_atomic + (gross as u128);
    registry.protocol_paid_atomic = registry.protocol_paid_atomic + (protocol_atomic as u128);
    registry.pack_paid_atomic = registry.pack_paid_atomic + (pack_atomic as u128);
    (protocol_atomic, pack_atomic)
}

fun protocol_share(gross: u64, fee_bps: u16): u64 {
    assert!(fee_bps <= 10_000, EWrongPayment);
    let share_u128 = ((gross as u128) * (fee_bps as u128)) / BPS_DENOMINATOR;
    assert!(fee_bps == 0 || share_u128 > 0, EWrongPayment);
    let share = share_u128 as u64;
    assert!(share < gross, EWrongPayment);
    share
}

fun assert_asset_holder(asset: &PhysicalAssetV8, ctx: &TxContext) {
    assert!(asset.version == VERSION, EInvalidBinding);
    assert!(asset.holder == ctx.sender() && asset.holder != @0x0, EWrongHolder);
}

fun derive_style_identity<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    row: &StyleRowV2,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&BaseStyleIdentityInputV8 {
        domain: b"animacraft-v8/physical/base-style",
        version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        base_registry_id: object::id(base_registry),
        part_key: *base::style_part_key_v2(row),
        item_key: *base::style_item_key_v2(row),
        style_key: *base::style_key_v2(row),
        layer_track_key: *base::style_layer_track_key_v2(row),
        color_channel_key: *base::style_color_channel_key_v2(row),
        default_swatch_key: *base::style_default_swatch_key_v2(row),
        asset_blob_id: *base::style_asset_blob_id_v2(row),
        asset_sha256: *base::style_asset_sha256_v2(row),
        protected: base::style_protected_v2(row),
        payload_commitment: *base::style_payload_commitment_v2(row),
    }))
}

fun assert_config(catalog: &ProductReleaseCatalogV8, config: &PhysicalPackageConfigV8) {
    assert_config_binding(catalog, config);
    binding::assert_exact_witness_type_v2<PhysicalSetupInstallWitnessV2>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 4),
        &b"physical_v8", &b"PhysicalSetupInstallWitnessV2");
}

fun assert_config_binding(catalog: &ProductReleaseCatalogV8, config: &PhysicalPackageConfigV8) {
    assert!(config.version == VERSION && config.catalog_id == object::id(catalog), EInvalidConfig);
    let (_, _, _, product, cap_set, _) = binding::catalog_terms_v2(catalog);
    assert!(&config.product_binding_commitment == binding::product_binding_commitment_v8(product)
        && &config.call_cap_set_commitment == cap_set, EInvalidConfig);
    binding::assert_role_config_installation_v2(catalog, 4, object::id(config),
        &config.installation_commitment);
}

fun assert_base_registry<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
) {
    maker::assert_base_registry_identity_v8(
        root,
        object::id(base_registry),
        base::registry_root_id_v2(base_registry),
        base::registry_maker_version_v2(base_registry),
        base::registry_root_content_commitment_v2(base_registry),
    );
    assert!(base::registry_sealed_v2(base_registry), ERegistryNotReady);
}

fun assert_registry_identity<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    config: &PhysicalPackageConfigV8,
) {
    assert!(registry.version == VERSION, EInvalidBinding);
    maker::assert_root_identity_v8(
        root,
        registry.root_id,
        registry.maker_version,
        &registry.root_content_commitment,
    );
    assert_base_registry(root, base_registry);
    assert!(registry.base_registry_id == object::id(base_registry), EInvalidBinding);
    assert!(registry.catalog_id == config.catalog_id, EInvalidBinding);
    assert!(registry.package_config_id == object::id(config), EInvalidBinding);
    assert!(
        registry.product_binding_commitment == config.product_binding_commitment,
        EInvalidBinding,
    );
    assert!(
        registry.call_cap_set_commitment == config.call_cap_set_commitment,
        EInvalidBinding,
    );
}

fun assert_policy_terms(
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
) {
    assert!(max_supply > 0 && max_supply <= MAX_SUPPLY_PER_POLICY, EInvalidPolicy);
    if (issuance_kind == ISSUE_FREE_CLAIM) {
        assert!(price_atomic == 0 && proof_kind == PROOF_NONE, EInvalidPolicy);
        return
    };
    if (issuance_kind == ISSUE_PAID_PURCHASE) {
        assert!(price_atomic > 0 && proof_kind == PROOF_NONE, EInvalidPolicy);
        return
    };
    assert!(issuance_kind == ISSUE_PROOF_MATERIALIZE, EInvalidPolicy);
    assert!(price_atomic == 0, EInvalidPolicy);
    assert!(proof_kind == PROOF_CANONICAL_SOUL, EInvalidPolicy);
}

fun assert_activation_ready(registry: &PhysicalRegistryV8) {
    assert!(registry.base_sealed, ERegistryNotSealed);
    assert!(
        registry.observed_base_policy_count == registry.expected_base_policy_count,
        EInvalidCount,
    );
    assert!(
        registry.rolling_base_policy_commitment
            == registry.expected_base_policy_commitment,
        EInvalidCommitment,
    );
    assert!(registry.revision == 0, ERegistryNotReady);
    assert!(registry.pack_policy_count == 0, ERegistryNotReady);
    assert!(registry.pack_policy_keys.is_empty(), ERegistryNotReady);
    assert!(registry.total_issued == 0, ERegistryNotReady);
    assert!(registry.total_free_claimed == 0, ERegistryNotReady);
    assert!(registry.total_paid_purchased == 0, ERegistryNotReady);
    assert!(registry.total_proof_materialized == 0, ERegistryNotReady);
    assert!(registry.total_consumed == 0, ERegistryNotReady);
    assert!(registry.gross_paid_atomic == 0, ERegistryNotReady);
    assert!(registry.protocol_paid_atomic == 0, ERegistryNotReady);
    assert!(registry.maker_paid_atomic == 0, ERegistryNotReady);
    assert!(registry.pack_paid_atomic == 0, ERegistryNotReady);
    assert!(registry.used_authorization_count == 0, ERegistryNotReady);
    assert!(registry.used_authorizations.is_empty(), ERegistryNotReady);
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
    let mut any = false;
    let mut index = 0;
    while (index < HASH_LENGTH) {
        if (value[index] != 0) any = true;
        index = index + 1;
    };
    assert!(any, EInvalidCommitment);
}

public fun config_id_v8(config: &PhysicalPackageConfigV8): ID { object::id(config) }
public fun registry_id_v8(registry: &PhysicalRegistryV8): ID { object::id(registry) }
public fun registry_root_id_v8(registry: &PhysicalRegistryV8): ID { registry.root_id }
public fun registry_maker_version_v8(registry: &PhysicalRegistryV8): u64 {
    registry.maker_version
}
public fun registry_root_content_commitment_v8(
    registry: &PhysicalRegistryV8,
): &vector<u8> { &registry.root_content_commitment }
public fun registry_base_registry_id_v8(registry: &PhysicalRegistryV8): ID {
    registry.base_registry_id
}
public fun registry_expected_base_policy_count_v8(registry: &PhysicalRegistryV8): u64 {
    registry.expected_base_policy_count
}
public fun registry_observed_base_policy_count_v8(registry: &PhysicalRegistryV8): u64 {
    registry.observed_base_policy_count
}
public fun registry_base_policy_commitment_v8(
    registry: &PhysicalRegistryV8,
): &vector<u8> { &registry.rolling_base_policy_commitment }
public fun registry_base_sealed_v8(registry: &PhysicalRegistryV8): bool {
    registry.base_sealed
}
public fun registry_revision_v8(registry: &PhysicalRegistryV8): u64 {
    registry.revision
}
public fun registry_pack_policy_count_v8(registry: &PhysicalRegistryV8): u64 {
    registry.pack_policy_count
}
public fun registry_total_issued_v8(registry: &PhysicalRegistryV8): u64 {
    registry.total_issued
}
public fun registry_total_free_claimed_v8(registry: &PhysicalRegistryV8): u64 {
    registry.total_free_claimed
}
public fun registry_total_paid_purchased_v8(registry: &PhysicalRegistryV8): u64 {
    registry.total_paid_purchased
}
public fun registry_total_proof_materialized_v8(registry: &PhysicalRegistryV8): u64 {
    registry.total_proof_materialized
}
public fun registry_total_consumed_v8(registry: &PhysicalRegistryV8): u64 {
    registry.total_consumed
}
public fun registry_gross_paid_atomic_v8(registry: &PhysicalRegistryV8): u128 {
    registry.gross_paid_atomic
}
public fun registry_protocol_paid_atomic_v8(registry: &PhysicalRegistryV8): u128 {
    registry.protocol_paid_atomic
}
public fun registry_maker_paid_atomic_v8(registry: &PhysicalRegistryV8): u128 {
    registry.maker_paid_atomic
}
public fun registry_pack_paid_atomic_v8(registry: &PhysicalRegistryV8): u128 {
    registry.pack_paid_atomic
}
public fun registry_used_authorization_count_v8(
    registry: &PhysicalRegistryV8,
): u64 { registry.used_authorization_count }
public fun borrow_base_policy_v8(
    registry: &PhysicalRegistryV8,
    selection: &PhysicalSelectionBindingV8,
): &PhysicalStylePolicyV8 {
    assert!(
        output::physical_selection_source_class_v8(selection) == SOURCE_BASE_STYLE,
        EInvalidBinding,
    );
    assert!(
        output::physical_selection_source_definition_id_v8(selection) == registry.root_id,
        EInvalidBinding,
    );
    assert!(
        output::physical_selection_source_semantic_id_v8(selection).is_empty(),
        EInvalidBinding,
    );
    assert!(
        output::physical_selection_source_content_commitment_v8(selection)
            == &registry.root_content_commitment,
        EInvalidBinding,
    );
    assert!(output::physical_selection_source_epoch_v8(selection) == 0,
        EInvalidBinding);
    let policy = borrow_base_policy_by_keys(
        registry,
        *output::physical_selection_part_key_v8(selection),
        *output::physical_selection_item_key_v8(selection),
        *output::physical_selection_style_key_v8(selection),
    );
    assert!(
        &policy.style.layer_track_key
            == output::physical_selection_layer_track_key_v8(selection),
        EInvalidBinding,
    );
    assert!(
        &policy.style_payload_commitment
            == output::physical_selection_asset_content_commitment_v8(selection),
        EInvalidBinding,
    );
    policy
}

fun borrow_base_policy_by_keys(
    registry: &PhysicalRegistryV8,
    part_key: String,
    item_key: String,
    style_key: String,
): &PhysicalStylePolicyV8 {
    registry.base_policies.borrow(PhysicalPolicyKeyV8 {
        source_kind: SOURCE_BASE_STYLE,
        source_id: registry.base_registry_id,
        part_key,
        item_key,
        style_key,
    })
}
public fun policy_sequence_v8(policy: &PhysicalStylePolicyV8): u64 { policy.sequence }
public fun policy_source_kind_v8(policy: &PhysicalStylePolicyV8): u8 {
    policy.source.source_kind
}
public fun policy_source_id_v8(policy: &PhysicalStylePolicyV8): ID {
    policy.source.source_id
}
public fun policy_source_semantic_id_v8(
    policy: &PhysicalStylePolicyV8,
): &String { &policy.source.source_semantic_id }
public fun policy_source_content_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.source.source_content_commitment }
public fun policy_source_treasury_id_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<ID> { &policy.source.source_treasury_id }
public fun policy_pack_registry_id_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<ID> { &policy.source.pack_registry_id }
public fun policy_pack_registry_revision_v8(policy: &PhysicalStylePolicyV8): u64 {
    policy.source.pack_registry_revision
}
public fun policy_registered_pack_owner_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<address> { &policy.source.registered_pack_owner }
public fun policy_registered_pack_control_epoch_v8(
    policy: &PhysicalStylePolicyV8,
): u64 { policy.source.registered_pack_control_epoch }
public fun policy_registered_pack_admin_cap_id_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<ID> { &policy.source.registered_pack_admin_cap_id }
public fun policy_part_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.style.part_key }
public fun policy_item_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.style.item_key }
public fun policy_style_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.style.style_key }
public fun policy_layer_track_key_v8(policy: &PhysicalStylePolicyV8): &String {
    &policy.style.layer_track_key
}
public fun policy_color_channel_key_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<String> { &policy.style.color_channel_key }
public fun policy_default_swatch_key_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<String> { &policy.style.default_swatch_key }
public fun policy_style_asset_blob_id_v8(
    policy: &PhysicalStylePolicyV8,
): &String { &policy.style.style_asset_blob_id }
public fun policy_style_asset_sha256_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.style.style_asset_sha256 }
public fun policy_style_protected_v8(policy: &PhysicalStylePolicyV8): bool {
    policy.style.style_protected
}
public fun policy_style_payload_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.style_payload_commitment }
public fun policy_style_seal_binding_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.style_seal_binding_commitment }
public fun policy_source_style_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.source_style_commitment }
public fun policy_style_identity_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.style_identity_commitment }
public fun policy_material_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.material_policy_commitment }
public fun policy_issuance_kind_v8(policy: &PhysicalStylePolicyV8): u8 {
    policy.issuance_kind
}
public fun policy_proof_kind_v8(policy: &PhysicalStylePolicyV8): u8 {
    policy.proof_kind
}
public fun policy_price_atomic_v8(policy: &PhysicalStylePolicyV8): u64 {
    policy.price_atomic
}
public fun policy_max_supply_v8(policy: &PhysicalStylePolicyV8): u64 {
    policy.max_supply
}
public fun policy_transferable_v8(policy: &PhysicalStylePolicyV8): bool {
    policy.transferable
}
public fun policy_issued_count_v8(policy: &PhysicalStylePolicyV8): u64 {
    policy.issued_count
}
public fun policy_consumed_count_v8(policy: &PhysicalStylePolicyV8): u64 {
    policy.consumed_count
}
public fun policy_row_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.row_commitment }

public fun proof_output_registry_id_v8(proof: &PhysicalProofProvenanceV8): ID {
    proof.output_registry_id
}
public fun proof_soul_registry_id_v8(proof: &PhysicalProofProvenanceV8): ID {
    proof.soul_registry_id
}
public fun proof_output_key_v8(proof: &PhysicalProofProvenanceV8): &String {
    &proof.output_key
}
public fun proof_output_policy_commitment_v8(
    proof: &PhysicalProofProvenanceV8,
): &vector<u8> { &proof.output_policy_commitment }
public fun proof_output_id_v8(proof: &PhysicalProofProvenanceV8): ID {
    proof.output_id
}
public fun proof_receipt_id_v8(proof: &PhysicalProofProvenanceV8): ID {
    proof.receipt_id
}
public fun proof_soul_id_v8(proof: &PhysicalProofProvenanceV8): ID {
    proof.soul_id
}
public fun proof_soul_ownership_epoch_v8(proof: &PhysicalProofProvenanceV8): u64 {
    proof.soul_ownership_epoch
}
public fun proof_recipe_commitment_v8(
    proof: &PhysicalProofProvenanceV8,
): &vector<u8> { &proof.recipe_commitment }
public fun proof_render_commitment_v8(
    proof: &PhysicalProofProvenanceV8,
): &vector<u8> { &proof.render_commitment }
public fun proof_output_commitment_v8(
    proof: &PhysicalProofProvenanceV8,
): &vector<u8> { &proof.output_commitment }
public fun proof_receipt_commitment_v8(
    proof: &PhysicalProofProvenanceV8,
): &vector<u8> { &proof.receipt_commitment }
public fun proof_soul_commitment_v8(
    proof: &PhysicalProofProvenanceV8,
): &vector<u8> { &proof.soul_commitment }
public fun proof_materialization_key_v8(
    proof: &PhysicalProofProvenanceV8,
): &String { &proof.materialization_key }
public fun proof_witness_commitment_v8(
    proof: &PhysicalProofProvenanceV8,
): &vector<u8> { &proof.witness_commitment }

public fun asset_id_v8(asset: &PhysicalAssetV8): ID { object::id(asset) }
public fun asset_registry_id_v8(asset: &PhysicalAssetV8): ID { asset.registry_id }
public fun asset_root_id_v8(asset: &PhysicalAssetV8): ID { asset.root_id }
public fun asset_maker_version_v8(asset: &PhysicalAssetV8): u64 {
    asset.maker_version
}
public fun asset_root_content_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.root_content_commitment }
public fun asset_source_kind_v8(asset: &PhysicalAssetV8): u8 { asset.source.source_kind }
public fun asset_source_id_v8(asset: &PhysicalAssetV8): ID { asset.source.source_id }
public fun asset_source_semantic_id_v8(asset: &PhysicalAssetV8): &String {
    &asset.source.source_semantic_id
}
public fun asset_source_content_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.source.source_content_commitment }
public fun asset_source_treasury_id_v8(
    asset: &PhysicalAssetV8,
): &Option<ID> { &asset.source.source_treasury_id }
public fun asset_pack_registry_id_v8(asset: &PhysicalAssetV8): &Option<ID> {
    &asset.source.pack_registry_id
}
public fun asset_pack_registry_revision_v8(asset: &PhysicalAssetV8): u64 {
    asset.source.pack_registry_revision
}
public fun asset_registered_pack_owner_v8(
    asset: &PhysicalAssetV8,
): &Option<address> { &asset.source.registered_pack_owner }
public fun asset_registered_pack_control_epoch_v8(asset: &PhysicalAssetV8): u64 {
    asset.source.registered_pack_control_epoch
}
public fun asset_registered_pack_admin_cap_id_v8(
    asset: &PhysicalAssetV8,
): &Option<ID> { &asset.source.registered_pack_admin_cap_id }
public fun asset_part_key_v8(asset: &PhysicalAssetV8): &String { &asset.style.part_key }
public fun asset_item_key_v8(asset: &PhysicalAssetV8): &String { &asset.style.item_key }
public fun asset_style_key_v8(asset: &PhysicalAssetV8): &String { &asset.style.style_key }
public fun asset_layer_track_key_v8(asset: &PhysicalAssetV8): &String {
    &asset.style.layer_track_key
}
public fun asset_color_channel_key_v8(asset: &PhysicalAssetV8): &Option<String> {
    &asset.style.color_channel_key
}
public fun asset_default_swatch_key_v8(asset: &PhysicalAssetV8): &Option<String> {
    &asset.style.default_swatch_key
}
public fun asset_style_asset_blob_id_v8(asset: &PhysicalAssetV8): &String {
    &asset.style.style_asset_blob_id
}
public fun asset_style_asset_sha256_v8(asset: &PhysicalAssetV8): &vector<u8> {
    &asset.style.style_asset_sha256
}
public fun asset_style_protected_v8(asset: &PhysicalAssetV8): bool {
    asset.style.style_protected
}
public fun asset_style_seal_binding_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.style_seal_binding_commitment }
public fun asset_source_style_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.source_style_commitment }
public fun asset_style_identity_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.style_identity_commitment }
public fun asset_content_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.asset_content_commitment }
public fun asset_material_policy_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.material_policy_commitment }
public fun asset_policy_row_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.policy_row_commitment }
public fun asset_issuance_kind_v8(asset: &PhysicalAssetV8): u8 {
    asset.issuance_kind
}
public fun asset_proof_kind_v8(asset: &PhysicalAssetV8): u8 { asset.proof_kind }
public fun asset_serial_v8(asset: &PhysicalAssetV8): u64 { asset.serial }
public fun asset_holder_v8(asset: &PhysicalAssetV8): address { asset.holder }
public fun asset_ownership_epoch_v8(asset: &PhysicalAssetV8): u64 {
    asset.ownership_epoch
}
public fun asset_transferable_v8(asset: &PhysicalAssetV8): bool {
    asset.transferable
}
public fun asset_authorization_key_v8(asset: &PhysicalAssetV8): &vector<u8> {
    &asset.authorization_key
}
public fun asset_provenance_commitment_v8(asset: &PhysicalAssetV8): &vector<u8> {
    &asset.provenance_commitment
}
public fun asset_proof_v8(asset: &PhysicalAssetV8): &Option<PhysicalProofProvenanceV8> {
    &asset.proof
}

public fun physical_market_custody_version_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): u64 { custody.version }
public fun physical_market_custody_catalog_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.catalog_id }
public fun physical_market_custody_product_binding_commitment_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): &vector<u8> { &custody.product_binding_commitment }
public fun physical_market_custody_call_cap_set_commitment_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): &vector<u8> { &custody.call_cap_set_commitment }
public fun physical_market_custody_market_authority_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.market_authority_id }
public fun physical_market_custody_market_registry_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.market_registry_id }
public fun physical_market_custody_market_treasury_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.market_treasury_id }
public fun physical_market_custody_listing_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.listing_id }
public fun physical_market_custody_physical_package_config_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.physical_package_config_id }
public fun physical_market_custody_physical_registry_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.physical_registry_id }
public fun physical_market_custody_root_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.root_id }
public fun physical_market_custody_maker_version_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): u64 { custody.maker_version }
public fun physical_market_custody_root_content_commitment_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): &vector<u8> { &custody.root_content_commitment }
public fun physical_market_custody_asset_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.asset_id }
public fun physical_market_custody_asset_content_commitment_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): &vector<u8> { &custody.asset_content_commitment }
public fun physical_market_custody_source_kind_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): u8 { custody.source_kind }
public fun physical_market_custody_source_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.source_id }
public fun physical_market_custody_source_semantic_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): &String { &custody.source_semantic_id }
public fun physical_market_custody_source_content_commitment_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): &vector<u8> { &custody.source_content_commitment }
public fun physical_market_custody_source_treasury_id_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): ID { custody.source_treasury_id }
public fun physical_market_custody_holder_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): address { custody.holder }
public fun physical_market_custody_ownership_epoch_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): u64 { custody.ownership_epoch }
public fun physical_market_custody_transferable_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): bool { custody.transferable }
public fun physical_market_custody_provenance_commitment_v8(
    custody: &PhysicalMarketCustodyBindingV8,
): &vector<u8> { &custody.provenance_commitment }


#[test_only]
public struct PhysicalMarketTestListingV8 has key {
    id: UID,
    custody: Option<PhysicalMarketCustodyBindingV8>,
}

#[test_only]
public struct PhysicalAssetReadbackForTesting has copy, drop {
    id: ID, holder: address, epoch: u64, provenance: vector<u8>,
    asset_content: vector<u8>, source_id: ID, source_content: vector<u8>,
}
#[test_only]
fun asset_readback_for_testing(asset: &PhysicalAssetV8): PhysicalAssetReadbackForTesting {
    PhysicalAssetReadbackForTesting { id: object::id(asset), holder: asset.holder,
        epoch: asset.ownership_epoch, provenance: asset.provenance_commitment,
        asset_content: asset.asset_content_commitment, source_id: asset.source.source_id,
        source_content: asset.source.source_content_commitment }
}
#[test_only]
public fun assert_asset_readback_for_testing(
    asset: &PhysicalAssetV8, expected: PhysicalAssetReadbackForTesting,
    holder: address, epoch: u64,
) {
    assert!(object::id(asset) == expected.id, EInvalidMarketCustody);
    assert!(asset.holder == holder, EWrongHolder);
    assert!(asset.ownership_epoch == epoch, EStaleRevision);
    assert!(asset.provenance_commitment == expected.provenance, EInvalidCommitment);
    assert!(asset.asset_content_commitment == expected.asset_content, EInvalidCommitment);
    assert!(asset.source.source_id == expected.source_id, EInvalidMarketCustody);
    assert!(asset.source.source_content_commitment == expected.source_content, EInvalidCommitment);
}

/// Custody/Receiving integration only. The upper test issues the asset using
/// actual entitlements, and supplies the real Market config's installed caller.
#[test_only]
public fun custody_asset_for_testing<MarketRegistry: key, MarketTreasury: key>(
    pack: bool, mode: u8, registry: &PhysicalRegistryV8,
    root: &MakerRootV8<sui::sui::SUI>, protocol: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8, replacement: &FreshTupleReplacementBindingV2,
    config: &PhysicalPackageConfigV8, caller: &RuntimeCallerCapV1,
    market_registry: &MarketRegistry, market_treasury: &MarketTreasury,
    maker_treasury: &MakerTreasuryV8<sui::sui::SUI>,
    pack_treasury: &PackTreasuryV8<sui::sui::SUI>, asset: PhysicalAssetV8,
    wrong_asset: Option<PhysicalAssetV8>, ctx: &mut TxContext,
): (ID, ID, PhysicalAssetReadbackForTesting) {
    let snapshot = asset_readback_for_testing(&asset);
    let mut listing = PhysicalMarketTestListingV8 { id: object::new(ctx), custody: option::none() };
    let ticket = if (pack) {
        custody_pack_physical_for_market_v8(registry, root, protocol, catalog, replacement,
            config, caller, market_registry, market_treasury, &mut listing.id, pack_treasury, asset, ctx)
    } else {
        custody_base_physical_for_market_v8(registry, root, protocol, catalog, replacement,
            config, caller, market_registry, market_treasury, &mut listing.id, maker_treasury, asset, ctx)
    };
    let mut custody = consume_physical_market_custody_ticket_v8(ticket);
    let mut listing_id = object::id(&listing);
    let mut receiving_id = snapshot.id;
    // Only positive setup paths inspect postconditions here. Mode 3 is the
    // caller-gate negative path: unexpected acceptance must return normally,
    // not be masked by an equivalent test-helper abort.
    if (mode != 3) {
        assert!(custody.listing_id == listing_id, EInvalidMarketCustody);
        assert!(custody.asset_id == snapshot.id, EInvalidMarketCustody);
        assert!(custody.source_kind == if (pack) { SOURCE_PACK_STYLE } else { SOURCE_BASE_STYLE },
            EInvalidMarketCustody);
        assert!(custody.source_treasury_id == if (pack) { object::id(pack_treasury) }
            else { object::id(maker_treasury) }, EInvalidTreasury);
        assert!(custody.holder == snapshot.holder, EWrongHolder);
        assert!(custody.ownership_epoch == snapshot.epoch, EStaleRevision);
        assert!(custody.transferable, ENotTransferable);
    };
    if (mode == 1) {
        let mut wrong_listing = PhysicalMarketTestListingV8 { id: object::new(ctx), custody: option::none() };
        listing_id = object::id(&wrong_listing);
        // Preserve the original negative: bypass the field check so Sui's
        // receive primitive, not a simulated owner string, checks the parent.
        custody.listing_id = listing_id;
        wrong_listing.custody = option::some(custody);
        transfer::share_object(wrong_listing);
    } else {
        listing.custody = option::some(custody);
    };
    if (wrong_asset.is_some()) {
        let wrong_asset = wrong_asset.destroy_some();
        receiving_id = object::id(&wrong_asset);
        transfer::transfer(wrong_asset, object::id(&listing).to_address());
    } else { wrong_asset.destroy_none(); };
    transfer::share_object(listing);
    (listing_id, receiving_id, snapshot)
}

#[test_only]
public fun return_binding_for_testing<MarketRegistry: key, MarketTreasury: key>(
    registry: &PhysicalRegistryV8, root: &MakerRootV8<sui::sui::SUI>,
    protocol: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2, config: &PhysicalPackageConfigV8,
    caller: &RuntimeCallerCapV1, market_registry: &MarketRegistry, market_treasury: &MarketTreasury,
    maker_treasury: &MakerTreasuryV8<sui::sui::SUI>, asset: &PhysicalAssetV8, ctx: &mut TxContext,
): (PhysicalMarketTestListingV8, PhysicalMarketCustodyBindingV8) {
    assert_market_authority(root, protocol, catalog, replacement, caller, market_registry, market_treasury);
    let listing = PhysicalMarketTestListingV8 { id: object::new(ctx), custody: option::none() };
    let custody = new_physical_market_custody_binding(registry, protocol, catalog, replacement,
        config, caller, market_registry, market_treasury, &listing.id, asset, object::id(maker_treasury));
    (listing, custody)
}
#[test_only]
public fun assert_return_authority_for_testing<MarketRegistry: key, MarketTreasury: key>(
    registry: &PhysicalRegistryV8, root: &MakerRootV8<sui::sui::SUI>, protocol: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8, replacement: &FreshTupleReplacementBindingV2,
    caller: &RuntimeCallerCapV1, market_registry: &MarketRegistry, market_treasury: &MarketTreasury,
    listing: &PhysicalMarketTestListingV8, custody: &PhysicalMarketCustodyBindingV8, asset: &PhysicalAssetV8,
) {
    assert_market_authority(root, protocol, catalog, replacement, caller, market_registry, market_treasury);
    assert_market_custody_live_binding(registry, root, protocol, catalog, replacement,
        caller, market_registry, market_treasury, &listing.id, custody);
    assert_market_custody_asset(custody, root, asset);
}

#[test_only]
fun receive_test_market_asset(
    listing: &mut PhysicalMarketTestListingV8,
    receiving: Receiving<PhysicalAssetV8>,
): (PhysicalAssetV8, PhysicalMarketCustodyBindingV8) {
    assert!(listing.custody.is_some(), EInvalidMarketCustody);
    let custody = listing.custody.extract();
    assert!(custody.listing_id == object::id(listing), EInvalidMarketCustody);
    assert!(
        transfer::receiving_object_id(&receiving) == custody.asset_id,
        EInvalidMarketCustody,
    );
    let asset = transfer::receive(&mut listing.id, receiving);
    assert!(object::id(&asset) == custody.asset_id, EInvalidMarketCustody);
    assert!(asset.registry_id == custody.physical_registry_id, EInvalidMarketCustody);
    assert!(asset.root_id == custody.root_id, EInvalidMarketCustody);
    assert!(asset.maker_version == custody.maker_version, EInvalidMarketCustody);
    assert!(asset.root_content_commitment == custody.root_content_commitment,
        EInvalidMarketCustody);
    assert!(asset.asset_content_commitment == custody.asset_content_commitment,
        EInvalidMarketCustody);
    assert!(asset.source.source_kind == custody.source_kind, EInvalidMarketCustody);
    assert!(asset.source.source_id == custody.source_id, EInvalidMarketCustody);
    assert!(asset.source.source_semantic_id == custody.source_semantic_id,
        EInvalidMarketCustody);
    assert!(asset.source.source_content_commitment == custody.source_content_commitment,
        EInvalidMarketCustody);
    assert!(asset.holder == custody.holder, EWrongHolder);
    assert!(asset.ownership_epoch == custody.ownership_epoch, EStaleRevision);
    assert!(asset.transferable == custody.transferable && asset.transferable,
        ENotTransferable);
    assert!(asset.provenance_commitment == custody.provenance_commitment,
        EInvalidCommitment);
    if (asset.source.source_kind == SOURCE_BASE_STYLE) {
        assert!(asset.source.source_treasury_id.is_none(), EInvalidTreasury);
    } else {
        assert!(asset.source.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
        assert!(asset.source.source_treasury_id.is_some(), EInvalidTreasury);
        assert!(*asset.source.source_treasury_id.borrow() == custody.source_treasury_id,
            EInvalidTreasury);
    };
    (asset, custody)
}

#[test_only]
public fun return_test_market_asset(
    mut listing: PhysicalMarketTestListingV8,
    receiving: Receiving<PhysicalAssetV8>,
) {
    let (asset, _custody) = receive_test_market_asset(&mut listing, receiving);
    let PhysicalMarketTestListingV8 { id: listing_id, custody: empty } = listing;
    assert!(empty.is_none(), EInvalidMarketCustody);
    listing_id.delete();
    let holder = asset.holder;
    transfer::transfer(asset, holder)
}

#[test_only]
public fun purchase_test_market_asset(
    mut listing: PhysicalMarketTestListingV8,
    receiving: Receiving<PhysicalAssetV8>,
    ctx: &TxContext,
) {
    let (asset, custody) = receive_test_market_asset(&mut listing, receiving);
    let PhysicalMarketTestListingV8 { id: listing_id, custody: empty } = listing;
    assert!(empty.is_none(), EInvalidMarketCustody);
    listing_id.delete();
    purchase_received_market_asset(asset, &custody, ctx)
}

#[test_only]
public fun destroy_empty_test_market_listing(listing: PhysicalMarketTestListingV8) {
    let PhysicalMarketTestListingV8 { id, custody } = listing;
    assert!(custody.is_none(), EInvalidMarketCustody);
    id.delete()
}

#[test_only]
public fun issue_transferable_base_physical_for_market_testing(
    registry: &mut PhysicalRegistryV8,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    assert!(!registry.base_policy_keys.is_empty(), EInvalidPolicy);
    let key = *registry.base_policy_keys.borrow(0);
    let policy = *registry.base_policies.borrow(key);
    assert!(policy.source.source_kind == SOURCE_BASE_STYLE, EInvalidPolicy);
    assert!(policy.transferable, ENotTransferable);
    assert!(policy.proof_kind == PROOF_NONE, EWrongIssuance);
    let nonce = object::new(ctx);
    let nonce_id = nonce.to_inner();
    nonce.delete();
    let authorization_key = hash::sha2_256(bcs::to_bytes(&nonce_id));
    issue_asset(
        registry,
        policy,
        ctx.sender(),
        policy.issued_count,
        authorization_key,
        option::none(),
        ctx,
    )
}

#[test_only]
public fun issue_transferable_pack_physical_for_market_testing(
    registry: &mut PhysicalRegistryV8,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    assert!(!registry.pack_policy_keys.is_empty(), EInvalidPolicy);
    let key = *registry.pack_policy_keys.borrow(0);
    let policy = *registry.pack_policies.borrow(key);
    assert!(policy.source.source_kind == SOURCE_PACK_STYLE, EInvalidPolicy);
    assert!(policy.transferable, ENotTransferable);
    assert!(policy.proof_kind == PROOF_NONE, EWrongIssuance);
    let nonce = object::new(ctx);
    let nonce_id = nonce.to_inner();
    nonce.delete();
    let authorization_key = hash::sha2_256(bcs::to_bytes(&nonce_id));
    issue_asset(
        registry,
        policy,
        ctx.sender(),
        policy.issued_count,
        authorization_key,
        option::none(),
        ctx,
    )
}

#[test_only]
public fun destroy_physical_market_asset_for_testing(asset: PhysicalAssetV8) {
    destroy_asset_for_testing(asset)
}

#[test_only]
fun destroy_asset_for_testing(asset: PhysicalAssetV8) {
    let PhysicalAssetV8 {
        id,
        version: _,
        registry_id: _,
        root_id: _,
        maker_version: _,
        root_content_commitment: _,
        source: _,
        style: _,
        style_seal_binding_commitment: _,
        source_style_commitment: _,
        style_identity_commitment: _,
        asset_content_commitment: _,
        material_policy_commitment: _,
        policy_row_commitment: _,
        issuance_kind: _,
        proof_kind: _,
        serial: _,
        holder: _,
        ownership_epoch: _,
        transferable: _,
        authorization_key: _,
        proof: _,
        provenance_commitment: _,
    } = asset;
    id.delete()
}

#[test_only]
public fun destroy_config_for_testing(config: PhysicalPackageConfigV8) {
    let PhysicalPackageConfigV8 {
        id,
        version: _,
        catalog_id: _,
        product_binding_commitment: _,
        call_cap_set_commitment: _,
        installation_commitment: _,
    } = config;
    id.delete()
}

#[test_only]
public fun destroy_registry_for_testing(registry: PhysicalRegistryV8) {
    let PhysicalRegistryV8 {
        id,
        version: _,
        catalog_id: _,
        package_config_id: _,
        product_binding_commitment: _,
        call_cap_set_commitment: _,
        root_id: _,
        maker_version: _,
        root_content_commitment: _,
        base_registry_id: _,
        expected_base_policy_count: _,
        observed_base_policy_count: _,
        expected_base_policy_commitment: _,
        rolling_base_policy_commitment: _,
        base_sealed: _,
        mut base_policy_keys,
        mut base_policies,
        revision: _,
        pack_policy_count: _,
        mut pack_policy_keys,
        mut pack_policies,
        total_issued: _,
        total_free_claimed: _,
        total_paid_purchased: _,
        total_proof_materialized: _,
        total_consumed: _,
        gross_paid_atomic: _,
        protocol_paid_atomic: _,
        maker_paid_atomic: _,
        pack_paid_atomic: _,
        used_authorization_count: _,
        used_authorizations,
    } = registry;
    while (!base_policy_keys.is_empty()) {
        let key = base_policy_keys.pop_back();
        let _ = base_policies.remove(key);
    };
    base_policy_keys.destroy_empty();
    base_policies.destroy_empty();
    while (!pack_policy_keys.is_empty()) {
        let key = pack_policy_keys.pop_back();
        let _ = pack_policies.remove(key);
    };
    pack_policy_keys.destroy_empty();
    pack_policies.destroy_empty();
    used_authorizations.drop();
    id.delete();
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

#[test_only]
fun new_registry_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): PhysicalRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_config_binding(catalog, config);
    assert_base_registry(root, base_registry);
    new_registry(root, base_registry, config, expected_count, expected_commitment, ctx)
}

#[test_only]
fun append_base_style_policy_for_testing<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    sequence: u64,
    material: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    row_commitment: vector<u8>,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config_binding(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    append_base_style_policy(
        registry,
        root,
        base_registry,
        config,
        sequence,
        b"part".to_string(),
        b"item".to_string(),
        b"style".to_string(),
        material,
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
        row_commitment,
    )
}

#[test_only]
fun seal_for_testing<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_config_binding(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    seal_registry(registry)
}

#[test_only]
fun assert_local_readiness_for_testing<PaymentCoin>(
    registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
): vector<u8> {
    maker::assert_draft_v8(root);
    assert_config_binding(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    assert_activation_ready(registry);
    derive_readiness_commitment(registry)
}

#[test]
fun exact_policy_term_matrix_is_fail_closed() {
    assert_policy_terms(ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1);
    assert_policy_terms(ISSUE_PAID_PURCHASE, PROOF_NONE, 1, 1);
    assert_policy_terms(ISSUE_PROOF_MATERIALIZE, PROOF_CANONICAL_SOUL, 0, 1);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun proof_policy_rejects_removed_receipt_only_mode() {
    assert_policy_terms(ISSUE_PROOF_MATERIALIZE, 1, 0, 1);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun paid_policy_rejects_zero_price() {
    assert_policy_terms(ISSUE_PAID_PURCHASE, PROOF_NONE, 0, 1);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun free_policy_rejects_nonzero_price() {
    assert_policy_terms(ISSUE_FREE_CLAIM, PROOF_NONE, 1, 1);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun unknown_issuance_kind_is_rejected() {
    assert_policy_terms(99, PROOF_NONE, 0, 1);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun proof_policy_rejects_missing_proof() {
    assert_policy_terms(ISSUE_PROOF_MATERIALIZE, PROOF_NONE, 0, 1);
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun supply_must_be_bounded_and_nonzero() {
    assert_policy_terms(ISSUE_FREE_CLAIM, PROOF_NONE, 0, 0);
}

#[test_only]
public fun zero_policy_registry_seals_and_is_ready_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let empty = empty_base_policy_commitment_v8(root, base_registry, physical_config);
    let mut registry = new_registry_for_testing(
        root,
        admin,
        base_registry,
        catalog,
        physical_config,
        0,
        empty,
        ctx,
    );
    seal_for_testing(
        &mut registry,
        root,
        admin,
        base_registry,
        catalog,
        physical_config,
    );
    assert_hash(&assert_local_readiness_for_testing(
        &registry,
        root,
        base_registry,
        catalog,
        physical_config,
    ));
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun zero_policy_registry_rejects_nonempty_commitment_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let registry = new_registry_for_testing(
        root,
        admin,
        base_registry,
        catalog,
        physical_config,
        0,
        test_hash(88),
        ctx,
    );
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun readiness_rejects_unsealed_registry_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let empty = empty_base_policy_commitment_v8(
        root, base_registry, physical_config,
    );
    let registry = new_registry_for_testing(
        root,
        admin,
        base_registry,
        catalog,
        physical_config,
        0,
        empty,
        ctx,
    );
    let _ = assert_local_readiness_for_testing(
        &registry, root, base_registry, catalog, physical_config,
    );
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun base_policy_is_derived_from_exact_live_style_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let material = test_hash(30);
    let row = derive_base_policy_row_commitment_v8(
        root,
        base_registry,
        physical_config,
        0,
        b"part".to_string(),
        b"item".to_string(),
        b"style".to_string(),
        material,
        ISSUE_PROOF_MATERIALIZE,
        PROOF_CANONICAL_SOUL,
        0,
        100,
        true,
    );
    let empty = empty_base_policy_commitment_v8(root, base_registry, physical_config);
    let final_commitment = advance_base_policy_commitment_v8(root, 0, empty, row);
    let mut registry = new_registry_for_testing(
        root,
        admin,
        base_registry,
        catalog,
        physical_config,
        1,
        final_commitment,
        ctx,
    );
    append_base_style_policy_for_testing(
        &mut registry,
        root,
        admin,
        base_registry,
        catalog,
        physical_config,
        0,
        material,
        ISSUE_PROOF_MATERIALIZE,
        PROOF_CANONICAL_SOUL,
        0,
        100,
        true,
        row,
    );
    let selection = output::physical_base_selection_binding_for_testing_v8(
        maker::root_id_v8(root),
        b"part".to_string(), b"item".to_string(), b"style".to_string(),
        b"track".to_string(), *maker::root_content_commitment_v8(root),
        test_hash(14),
    );
    let policy = borrow_base_policy_v8(&registry, &selection);
    assert!(policy.sequence == 0, EInvalidSequence);
    assert!(
        &policy.style_identity_commitment == &derive_base_style_identity_v8(
            root,
            base_registry,
            b"part".to_string(),
            b"item".to_string(),
            b"style".to_string(),
        ),
        EInvalidCommitment,
    );
    seal_for_testing(
        &mut registry,
        root,
        admin,
        base_registry,
        catalog,
        physical_config,
    );
    assert_hash(&assert_local_readiness_for_testing(
        &registry,
        root,
        base_registry,
        catalog,
        physical_config,
    ));
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun seal_rejects_missing_expected_row_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let mut registry = new_registry_for_testing(
        root, admin, base_registry, catalog, physical_config,
        1, test_hash(31), ctx);
    seal_for_testing(&mut registry, root, admin, base_registry,
        catalog, physical_config);
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun append_rejects_wrong_row_commitment_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let mut registry = new_registry_for_testing(
        root, admin, base_registry, catalog, physical_config,
        1, test_hash(32), ctx);
    append_base_style_policy_for_testing(
        &mut registry, root, admin, base_registry, catalog,
        physical_config, 0, test_hash(33), ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, test_hash(99));
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun append_rejects_out_of_order_sequence_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let material = test_hash(34);
    let row = derive_base_policy_row_commitment_v8(
        root, base_registry, physical_config, 1, b"part".to_string(),
        b"item".to_string(), b"style".to_string(), material,
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, false);
    let mut registry = new_registry_for_testing(
        root, admin, base_registry, catalog, physical_config,
        2, test_hash(35), ctx);
    append_base_style_policy_for_testing(
        &mut registry, root, admin, base_registry, catalog,
        physical_config, 1, material, ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, row);
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun duplicate_base_style_policy_is_rejected_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let material = test_hash(36);
    let empty = empty_base_policy_commitment_v8(root, base_registry, physical_config);
    let row0 = derive_base_policy_row_commitment_v8(
        root, base_registry, physical_config, 0, b"part".to_string(),
        b"item".to_string(), b"style".to_string(), material,
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, false);
    let next = advance_base_policy_commitment_v8(root, 0, empty, row0);
    let row1 = derive_base_policy_row_commitment_v8(
        root, base_registry, physical_config, 1, b"part".to_string(),
        b"item".to_string(), b"style".to_string(), material,
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, false);
    let final_commitment = advance_base_policy_commitment_v8(root, 1, next, row1);
    let mut registry = new_registry_for_testing(
        root, admin, base_registry, catalog, physical_config,
        2, final_commitment, ctx);
    append_base_style_policy_for_testing(
        &mut registry, root, admin, base_registry, catalog,
        physical_config, 0, material, ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, row0);
    append_base_style_policy_for_testing(
        &mut registry, root, admin, base_registry, catalog,
        physical_config, 1, material, ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, row1);
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun readiness_rejects_nonzero_future_runtime_lane_for_testing(
    root: &MakerRootV8<sui::sui::SUI>, admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8, catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8, ctx: &mut TxContext,
) {
    let empty = empty_base_policy_commitment_v8(root, base_registry, physical_config);
    let mut registry = new_registry_for_testing(
        root, admin, base_registry, catalog, physical_config,
        0, empty, ctx);
    seal_for_testing(&mut registry, root, admin, base_registry,
        catalog, physical_config);
    registry.revision = 1;
    let _ = assert_local_readiness_for_testing(
        &registry, root, base_registry, catalog, physical_config);
    destroy_registry_for_testing(registry);
}

#[test_only]
public fun assert_exact_pack_asset_for_testing(
    asset: &PhysicalAssetV8, release: &PackReleaseV8<sui::sui::SUI>,
    treasury: &PackTreasuryV8<sui::sui::SUI>, packs: &PackRegistryV8, admin: &PackAdminCapV8,
) {
    assert!(asset.source.source_kind == SOURCE_PACK_STYLE, EInvalidBinding);
    assert!(asset.source.source_id == runtime::pack_release_id_v8(release),
        EInvalidBinding);
    assert!(asset.source.source_treasury_id.is_some(), EInvalidTreasury);
    assert!(*asset.source.source_treasury_id.borrow()
        == object::id(treasury), EInvalidTreasury);
    assert!(*asset.source.pack_registry_id.borrow()
        == object::id(packs), EInvalidBinding);
    assert!(asset.source.pack_registry_revision
        == runtime::pack_registry_revision_v8(packs),
        EStaleRevision);
    assert!(*asset.source.registered_pack_owner.borrow() == @0xA11, EWrongHolder);
    assert!(asset.source.registered_pack_control_epoch == 0, EInvalidBinding);
    assert!(*asset.source.registered_pack_admin_cap_id.borrow()
        == object::id(admin), EInvalidBinding);
    assert!(asset.style.part_key == b"part".to_string()
        && asset.style.item_key == b"pack-item".to_string()
        && asset.style.style_key == b"pack-style".to_string()
        && asset.style.layer_track_key == b"track".to_string(), EInvalidBinding);
    assert!(asset.style.style_asset_blob_id == b"pack-style-blob".to_string(),
        EInvalidBinding);
    assert!(asset.style.style_asset_sha256 == test_hash(72), EInvalidCommitment);
    assert!(asset.source_style_commitment == test_hash(74), EInvalidCommitment);
    assert!(asset.serial == 1 && asset.ownership_epoch == 0, EInvalidSequence);
}

#[test_only]
public fun assert_registered_pack_control_for_testing(
    registry: &PhysicalRegistryV8, release: &PackReleaseV8<sui::sui::SUI>,
    admin: &PackAdminCapV8, expected_epoch: u64,
) {
    let policy = registry.pack_policies.borrow(PhysicalPolicyKeyV8 {
        source_kind: SOURCE_PACK_STYLE, source_id: object::id(release),
        part_key: b"part".to_string(), item_key: b"pack-item".to_string(),
        style_key: b"pack-style".to_string(),
    });
    assert!(policy.source.registered_pack_control_epoch == expected_epoch, EInvalidBinding);
    assert!(*policy.source.registered_pack_admin_cap_id.borrow() == object::id(admin), EInvalidBinding);
}

/// Preserved internal proof-accounting unit. The provenance fields below are
/// intentionally synthetic data, NOT a native Soul/materialization certificate.
/// Its selection witness and registry are real upper-fixture objects.
#[test_only]
public fun assert_proof_accounting_for_testing(
    registry: &mut PhysicalRegistryV8, loadout: &MakerLoadoutV8,
    witness: RuntimePhysicalSelectionWitnessV8, output_registry_id: ID,
    soul_registry_id: ID, seal_registry_id: ID, seal_policy_id: ID, ctx: &mut TxContext,
) {
    let selection = consume_runtime_selection(witness, loadout, ctx);
    assert_selection_root(registry, &selection, ctx);
    let policy = *borrow_base_policy_by_selection(
        registry,
        &selection,
    );
    let soul_id = soul_registry_id;
    let soul_commitment = test_hash(121);
    let proof = PhysicalProofProvenanceV8 {
        output_registry_id: output_registry_id,
        soul_registry_id: soul_registry_id,
        output_key: b"physical-test-output".to_string(),
        output_policy_commitment: test_hash(122),
        output_id: seal_registry_id,
        receipt_id: seal_policy_id,
        soul_id,
        soul_ownership_epoch: 0,
        recipe_commitment: test_hash(123),
        render_commitment: test_hash(124),
        output_commitment: test_hash(125),
        receipt_commitment: test_hash(126),
        soul_commitment,
        materialization_key: b"physical-test-materialization".to_string(),
        witness_commitment: test_hash(127),
    };
    let authorization_key = derive_authorization_key(
        b"animacraft-v8/physical/proof-materialize",
        registry,
        &policy,
        @0x0,
        soul_id,
        soul_commitment,
    );
    let asset = issue_asset(
        registry,
        policy,
        @0xA11,
        0,
        authorization_key,
        option::some(proof),
        ctx,
    );
    assert!(asset.proof.is_some(), EWrongIssuance);
    assert!(asset.proof_kind == PROOF_CANONICAL_SOUL, EWrongIssuance);
    assert!(asset.source.source_id == registry.base_registry_id,
        EInvalidBinding);
    assert!(asset.source.source_treasury_id.is_none(), EInvalidTreasury);
    assert!(registry.total_proof_materialized == 1,
        EInvalidCount);
    consume_physical_asset_v8(registry, asset, 0, ctx);
}

#[test, expected_failure(abort_code = EWrongPayment)]
fun physical_payment_share_rejects_nonzero_rounding_to_zero() {
    let _ = protocol_share(1, 1);
}

/// Internal custody binding matrix, not a claim of end-to-end listing or
/// settlement. All authority objects come from the actual upper bootstrap.
#[test_only]
public fun market_custody_matrix_for_testing<MarketRegistry: key, MarketTreasury: key>(
    case: u8, registry: &mut PhysicalRegistryV8, root: &MakerRootV8<sui::sui::SUI>,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2, config: &PhysicalPackageConfigV8,
    market_call_cap: &RuntimeCallerCapV1, market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury, maker_treasury: &MakerTreasuryV8<sui::sui::SUI>,
    ctx: &mut TxContext,
) {
    assert_market_authority(root, protocol_config, catalog, replacement,
        market_call_cap, market_registry, market_treasury);
    let asset = issue_transferable_base_physical_for_market_testing(registry, ctx);
    let listing = PhysicalMarketTestListingV8 { id: object::new(ctx), custody: option::none() };
    let mut custody = new_physical_market_custody_binding(registry, protocol_config,
        catalog, replacement, config, market_call_cap, market_registry, market_treasury,
        &listing.id, &asset, object::id(maker_treasury));
    if (case == 0) {
        assert_market_custody_live_binding(
        registry,
        root,
        protocol_config,
        catalog,
        replacement,
        market_call_cap,
        market_registry,
        market_treasury,
        &listing.id,
        &custody,
        );
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 1) {
        custody.version = 7;
        assert_market_custody_live_binding(
        registry,
        root,
        protocol_config,
        catalog,
        replacement,
        market_call_cap,
        market_registry,
        market_treasury,
        &listing.id,
        &custody,
        );
    }
    else if (case == 2) {
        custody.asset_id = object::id_from_address(@0xBAD);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 3) {
        custody.physical_registry_id = object::id_from_address(@0xBAD);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 4) {
        custody.root_id = object::id_from_address(@0xBAD);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 5) {
        custody.maker_version = custody.maker_version + 1;
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 6) {
        custody.root_content_commitment = test_hash(201);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 7) {
        custody.source_kind = SOURCE_PACK_STYLE;
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 8) {
        custody.source_id = object::id_from_address(@0xBAD);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 9) {
        custody.source_content_commitment = test_hash(202);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 10) {
        custody.source_treasury_id = object::id_from_address(@0xBAD);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 11) {
        custody.holder = @0xB22;
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 12) {
        custody.ownership_epoch = custody.ownership_epoch + 1;
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 13) {
        custody.transferable = false;
        assert_market_custody_asset(&custody, root, &asset);
    }
    else if (case == 14) {
        custody.provenance_commitment = test_hash(203);
        assert_market_custody_asset(&custody, root, &asset);
    }
    else { abort EInvalidPolicy };
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
}
