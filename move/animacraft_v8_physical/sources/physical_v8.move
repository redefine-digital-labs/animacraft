/// Fresh Physical policy registry for the unified Animacraft Maker v8 product.
/// No legacy object, package, migration, or caller-supplied object identity is
/// accepted by this module.
module animacraft_v8_physical::physical_v8;

use animacraft_v8_core::activation_v8::{Self as activation, PhysicalReadinessV8};
use animacraft_v8_core::base_registry_v8::{
    Self as base,
    BaseDefinitionRegistryV8,
    StyleRowV8,
};
use animacraft_v8_core::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    MarketRoleV8,
    PackageCallCapV8,
    PhysicalRoleV8,
    ProductReleaseCatalogV8,
    ReleaseRoleV8,
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
    PackAdmissionAuthorityV8,
    PackAdminCapV8,
    PackPassV8,
    PackRegistryV8,
    PackReleaseV8,
    PackTreasuryV8,
    RuntimePhysicalPackAccessWitnessV8,
    RuntimePhysicalPackPolicyWitnessV8,
    RuntimePhysicalSelectionWitnessV8,
    RuntimeDefinitionRegistryV8,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::String;
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::table::{Self as table, Table};
use sui::transfer::Receiving;

#[test_only]
use animacraft_v8_core::core_v8 as core;
#[test_only]
use animacraft_v8_core::activation_v8;
#[test_only]
use animacraft_v8_core::protocol_config_v8::{CorePackageMarkerV8, ProtocolAdminCapV8};
#[test_only]
use animacraft_v8_output::output_v8::{OutputCallableMarkerV8, OutputOriginalMarkerV8};
#[test_only]
use animacraft_v8_runtime::runtime_v8::{RuntimeCallableMarkerV8, RuntimeOriginalMarkerV8};
#[test_only]
use animacraft_v8_seal::seal_v8::{SealCallableMarkerV8, SealOriginalMarkerV8};

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

/// Catalog-installed package configuration. The Physical call capability is
/// private and cannot be extracted, copied, dropped, or stored elsewhere.
public struct PhysicalPackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    physical_call_cap: PackageCallCapV8<PhysicalRoleV8>,
}

public struct PhysicalPolicyKeyV8 has copy, drop, store {
    source_kind: u8,
    source_id: ID,
    part_key: String,
    item_key: String,
    style_key: String,
}

/// Frozen policy row. Base Style identity is copied only after reading the
/// exact sealed Core row; those copied fields are later re-readable and do not
/// grant authority independent of the bound Root/Base registry tuple.
public struct PhysicalStylePolicyV8 has copy, drop, store {
    sequence: u64,
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
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    style_asset_blob_id: String,
    style_asset_sha256: vector<u8>,
    style_protected: bool,
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
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    style_asset_blob_id: String,
    style_asset_sha256: vector<u8>,
    style_protected: bool,
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
    part_key: String,
    item_key: String,
    style_key: String,
    layer_track_key: String,
    color_channel_key: Option<String>,
    default_swatch_key: Option<String>,
    style_asset_blob_id: String,
    style_asset_sha256: vector<u8>,
    style_protected: bool,
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
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: PackageCallCapV8<PhysicalRoleV8>,
    ctx: &mut TxContext,
): PhysicalPackageConfigV8 {
    binding::assert_physical_call_cap_v8(catalog, &physical_call_cap);
    let product = binding::catalog_binding_v8(catalog);
    binding::assert_type_origins_v8<PhysicalOriginalMarkerV8, PhysicalCallableMarkerV8>(
        binding::physical_binding_v8(product),
    );
    PhysicalPackageConfigV8 {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *binding::call_cap_set_commitment_v8(
            binding::catalog_call_cap_set_v8(catalog),
        ),
        physical_call_cap,
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
        base_registry_id: base::registry_id_v8(base_registry),
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
        base_registry_id: base::registry_id_v8(base_registry),
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
    let row = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
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
    let style = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
    let style_identity_commitment = derive_style_identity(root, base_registry, style);
    hash::sha2_256(bcs::to_bytes(&BasePolicyRowCommitmentInputV8 {
        domain: b"animacraft-v8/physical/base-policy",
        version: VERSION,
        product_binding_commitment: config.product_binding_commitment,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        base_registry_id: base::registry_id_v8(base_registry),
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
    let style = base::borrow_style_v8(base_registry, part_key, item_key, style_key);
    let key = PhysicalPolicyKeyV8 {
        source_kind: SOURCE_BASE_STYLE,
        source_id: base::registry_id_v8(base_registry),
        part_key: *base::style_part_key_v8(style),
        item_key: *base::style_item_key_v8(style),
        style_key: *base::style_key_v8(style),
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
        source_kind: SOURCE_BASE_STYLE,
        source_id: base::registry_id_v8(base_registry),
        source_semantic_id: b"".to_string(),
        source_content_commitment: *maker::root_content_commitment_v8(root),
        source_treasury_id: option::none(),
        pack_registry_id: option::none(),
        pack_registry_revision: 0,
        registered_pack_owner: option::none(),
        registered_pack_control_epoch: 0,
        registered_pack_admin_cap_id: option::none(),
        part_key: *base::style_part_key_v8(style),
        item_key: *base::style_item_key_v8(style),
        style_key: *base::style_key_v8(style),
        layer_track_key: *base::style_layer_track_key_v8(style),
        color_channel_key: *base::style_color_channel_key_v8(style),
        default_swatch_key: *base::style_default_swatch_key_v8(style),
        style_asset_blob_id: *base::style_asset_blob_id_v8(style),
        style_asset_sha256: *base::style_asset_sha256_v8(style),
        style_protected: base::style_protected_v8(style),
        style_payload_commitment: *base::style_payload_commitment_v8(style),
        style_seal_binding_commitment: vector[],
        source_style_commitment: *base::style_payload_commitment_v8(style),
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

public fun certify_physical_activation_readiness_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    registry: &PhysicalRegistryV8,
): PhysicalReadinessV8 {
    assert_config(catalog, config);
    assert_registry_identity(registry, root, base_registry, config);
    maker::assert_draft_v8(root);
    assert_activation_ready(registry);
    let companion_commitment = derive_readiness_commitment(registry);
    activation::certify_physical_readiness_v8<
        PaymentCoin,
        PhysicalOriginalMarkerV8,
        PhysicalCallableMarkerV8,
        PhysicalRegistryV8,
    >(
        root,
        catalog,
        &config.physical_call_cap,
        registry,
        companion_commitment,
    )
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
    catalog: &ProductReleaseCatalogV8,
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
    let witness = runtime::new_physical_pack_policy_witness_v8<
        PaymentCoin,
        PhysicalOriginalMarkerV8,
        PhysicalCallableMarkerV8,
    >(
        root,
        catalog,
        &config.physical_call_cap,
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
        catalog,
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

fun append_pack_policy_from_witness(
    registry: &mut PhysicalRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
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
    ) = runtime::consume_physical_pack_policy_witness_v8<
        PhysicalOriginalMarkerV8,
        PhysicalCallableMarkerV8,
    >(witness, catalog, &config.physical_call_cap);
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
        part_key,
        item_key,
        style_key,
        layer_track_key,
        color_channel_key,
        default_swatch_key,
        style_asset_blob_id: asset_blob_id,
        style_asset_sha256: asset_sha256,
        style_protected: protected,
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
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    selection_witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
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
        policy.source_id,
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
    catalog: &ProductReleaseCatalogV8,
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
    assert_active_registry(registry, root, catalog, config);
    let selection = consume_runtime_selection(selection_witness, loadout, ctx);
    assert_selection_root(registry, &selection, ctx);
    let access = certify_pack_access(
        root,
        catalog,
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
        policy.source_id,
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
    assert_active_registry(registry, root, catalog, config);
    let selection = consume_runtime_selection(selection_witness, loadout, ctx);
    assert_selection_root(registry, &selection, ctx);
    let access = certify_pack_access(
        root,
        catalog,
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
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    witness: PhysicalMaterializationWitnessV8,
    loadout: &MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    assert_active_registry(registry, root, catalog, config);
    let (complete, selection, materialization_key, witness_commitment) =
        output::consume_physical_materialization_witness_v8<
            PhysicalOriginalMarkerV8,
            PhysicalCallableMarkerV8,
        >(witness, catalog, &config.physical_call_cap);
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
    catalog: &ProductReleaseCatalogV8,
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
    assert_active_registry(registry, root, catalog, config);
    let (complete, selection, materialization_key, witness_commitment) =
        output::consume_physical_materialization_witness_v8<
            PhysicalOriginalMarkerV8,
            PhysicalCallableMarkerV8,
        >(witness, catalog, &config.physical_call_cap);
    let soul_registry_id = assert_complete_binding(registry, root, &complete, ctx);
    assert_output_selection_current(&complete, &selection, loadout);
    let access = certify_pack_access(
        root,
        catalog,
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
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
): PhysicalMarketCustodyTicketV8 {
    assert_market_custody_current<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert_asset_holder(&asset, ctx);
    assert!(asset.transferable, ENotTransferable);
    assert_market_asset_registry_binding(physical_registry, root, &asset);
    let source_treasury_id = core_treasury::maker_treasury_id_v8(maker_treasury);
    assert_base_market_source(physical_registry, root, &asset, source_treasury_id);
    custody_physical_for_market(
        physical_registry,
        catalog,
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
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    asset: PhysicalAssetV8,
    ctx: &TxContext,
): PhysicalMarketCustodyTicketV8 {
    assert_market_custody_current<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
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
        catalog,
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

/// Cancel/recover hook. Deliberately omits protocol/current/lifecycle checks:
/// PAUSED/ARCHIVED Root state, protocol disablement, or catalog snapshot drift
/// cannot trap the seller's object. Logical holder/epoch/provenance are not
/// mutated; the exact stored holder is the only return address.
public fun return_physical_from_market_v8<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    receiving: Receiving<PhysicalAssetV8>,
    custody: &PhysicalMarketCustodyBindingV8,
) {
    assert_market_authority<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        root,
        catalog,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    assert_market_custody_live_binding(
        physical_registry,
        root,
        catalog,
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
    let source_kind = asset.source_kind;
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
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
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
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    core_treasury::assert_maker_treasury_v8(root, maker_treasury);
    assert_market_custody_live_binding(
        physical_registry,
        root,
        catalog,
        market_call_cap,
        market_registry,
        market_treasury,
        listing_parent,
        custody,
    );
    let source_treasury_id = core_treasury::maker_treasury_id_v8(maker_treasury);
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
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
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
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(
        physical_registry,
        root,
        protocol_config,
        catalog,
        physical_config,
        market_call_cap,
        market_registry,
        market_treasury,
    );
    assert_market_custody_live_binding(
        physical_registry,
        root,
        catalog,
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
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    asset: PhysicalAssetV8,
    source_treasury_id: ID,
): PhysicalMarketCustodyTicketV8 {
    let custody = new_physical_market_custody_binding(
        physical_registry,
        catalog,
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
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &UID,
    asset: &PhysicalAssetV8,
    source_treasury_id: ID,
): PhysicalMarketCustodyBindingV8 {
    let product = binding::catalog_binding_v8(catalog);
    PhysicalMarketCustodyBindingV8 {
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *binding::call_cap_set_commitment_v8(
            binding::catalog_call_cap_set_v8(catalog),
        ),
        market_authority_id: binding::call_cap_authority_id_v8(market_call_cap),
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
        source_kind: asset.source_kind,
        source_id: asset.source_id,
        source_semantic_id: asset.source_semantic_id,
        source_content_commitment: asset.source_content_commitment,
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
        source_kind: asset.source_kind,
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
        source_kind: asset.source_kind,
        source_id: asset.source_id,
        part_key: asset.part_key,
        item_key: asset.item_key,
        style_key: asset.style_key,
    };
    let policy = if (asset.source_kind == SOURCE_BASE_STYLE) {
        registry.base_policies.borrow_mut(key)
    } else {
        assert!(asset.source_kind == SOURCE_PACK_STYLE, EInvalidBinding);
        registry.pack_policies.borrow_mut(key)
    };
    assert!(policy.row_commitment == asset.policy_row_commitment, EInvalidBinding);
    assert!(policy.consumed_count < policy.issued_count, EInvalidCount);
    policy.consumed_count = policy.consumed_count + 1;
    registry.total_consumed = registry.total_consumed + 1;
    let asset_id = object::id(&asset);
    let root_id = asset.root_id;
    let registry_id = asset.registry_id;
    let source_kind = asset.source_kind;
    let source_id = asset.source_id;
    let serial = asset.serial;
    let holder = asset.holder;
    let provenance_commitment = asset.provenance_commitment;
    let PhysicalAssetV8 {
        id, version: _, registry_id: _, root_id: _, maker_version: _,
        root_content_commitment: _, source_kind: _, source_id: _,
        source_semantic_id: _, source_content_commitment: _,
        source_treasury_id: _, pack_registry_id: _, pack_registry_revision: _,
        registered_pack_owner: _, registered_pack_control_epoch: _,
        registered_pack_admin_cap_id: _, part_key: _, item_key: _, style_key: _,
        layer_track_key: _, color_channel_key: _, default_swatch_key: _,
        style_asset_blob_id: _, style_asset_sha256: _, style_protected: _,
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
    maker::assert_active_capability_registry_v8(root);
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
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(
        maker::capability_catalog_id_v8(capability) == binding::catalog_id_v8(catalog),
        EInvalidBinding,
    );
    assert!(
        maker::capability_base_registry_id_v8(capability) == registry.base_registry_id,
        EInvalidBinding,
    );
    assert!(
        maker::capability_physical_registry_id_v8(capability) == object::id(registry),
        EInvalidBinding,
    );
}

fun assert_market_custody_current<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    physical_config: &PhysicalPackageConfigV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
) {
    binding::assert_catalog_current_v8(protocol_config, catalog);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    assert_active_registry(physical_registry, root, catalog, physical_config);
    assert_market_authority<
        PaymentCoin,
        MarketOriginalMarker,
        MarketCallableMarker,
        MarketRegistry,
        MarketTreasury,
    >(root, catalog, market_call_cap, market_registry, market_treasury);
    assert!(
        physical_registry.product_binding_commitment
            == *binding::product_binding_commitment_v8(
                maker::root_product_release_binding_v8(root),
            ),
        EInvalidMarketAuthority,
    );
    assert!(
        physical_registry.call_cap_set_commitment
            == *binding::call_cap_set_commitment_v8(
                maker::root_product_release_call_cap_set_v8(root),
            ),
        EInvalidMarketAuthority,
    );
}

fun assert_market_authority<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
) {
    binding::assert_market_call_cap_v8(catalog, market_call_cap);
    let catalog_product = binding::catalog_binding_v8(catalog);
    let market_binding = binding::market_binding_v8(catalog_product);
    binding::assert_type_origins_v8<MarketOriginalMarker, MarketCallableMarker>(
        market_binding,
    );
    binding::assert_type_original_v8<MarketRegistry>(market_binding);
    binding::assert_type_original_v8<MarketTreasury>(market_binding);
    assert!(
        maker::root_product_release_catalog_id_v8(root) == binding::catalog_id_v8(catalog),
        EInvalidMarketAuthority,
    );
    assert!(
        binding::product_binding_commitment_v8(
            maker::root_product_release_binding_v8(root),
        ) == binding::product_binding_commitment_v8(catalog_product),
        EInvalidMarketAuthority,
    );
    binding::assert_same_call_cap_set_v8(
        maker::root_product_release_call_cap_set_v8(root),
        binding::catalog_call_cap_set_v8(catalog),
    );
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(
        maker::capability_catalog_id_v8(capability) == binding::catalog_id_v8(catalog),
        EInvalidMarketAuthority,
    );
    binding::assert_same_call_cap_set_v8(
        maker::capability_call_cap_set_v8(capability),
        binding::catalog_call_cap_set_v8(catalog),
    );
    assert!(
        maker::capability_market_registry_id_v8(capability) == object::id(market_registry),
        EInvalidMarketAuthority,
    );
    assert!(
        maker::capability_market_treasury_id_v8(capability) == object::id(market_treasury),
        EInvalidMarketAuthority,
    );
}

fun assert_market_custody_live_binding<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    market_call_cap: &PackageCallCapV8<MarketRoleV8>,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &UID,
    custody: &PhysicalMarketCustodyBindingV8,
) {
    let product = binding::catalog_binding_v8(catalog);
    let call_cap_set = binding::catalog_call_cap_set_v8(catalog);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(custody.version == VERSION, EInvalidMarketCustody);
    assert!(custody.catalog_id == binding::catalog_id_v8(catalog), EInvalidMarketCustody);
    assert!(
        &custody.product_binding_commitment
            == binding::product_binding_commitment_v8(product),
        EInvalidMarketCustody,
    );
    assert!(
        &custody.call_cap_set_commitment
            == binding::call_cap_set_commitment_v8(call_cap_set),
        EInvalidMarketCustody,
    );
    assert!(
        custody.market_authority_id == binding::call_cap_authority_id_v8(market_call_cap),
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
        maker::capability_physical_registry_id_v8(capability) == object::id(physical_registry),
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
    assert!(custody.source_kind == asset.source_kind, EInvalidMarketCustody);
    assert!(custody.source_id == asset.source_id, EInvalidMarketCustody);
    assert!(
        custody.source_semantic_id == asset.source_semantic_id,
        EInvalidMarketCustody,
    );
    assert!(
        custody.source_content_commitment == asset.source_content_commitment,
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
    if (asset.source_kind == SOURCE_BASE_STYLE) {
        assert!(asset.source_treasury_id.is_none(), EInvalidTreasury);
        assert!(
            custody.source_treasury_id == maker::root_maker_treasury_id_v8(root),
            EInvalidTreasury,
        );
    } else {
        assert!(asset.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
        assert!(asset.source_treasury_id.is_some(), EInvalidTreasury);
        assert!(
            custody.source_treasury_id == *asset.source_treasury_id.borrow(),
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
        source_kind: asset.source_kind,
        source_id: asset.source_id,
        part_key: asset.part_key,
        item_key: asset.item_key,
        style_key: asset.style_key,
    };
    let policy = if (asset.source_kind == SOURCE_BASE_STYLE) {
        physical_registry.base_policies.borrow(key)
    } else {
        assert!(asset.source_kind == SOURCE_PACK_STYLE, EInvalidBinding);
        physical_registry.pack_policies.borrow(key)
    };
    assert!(policy.source_kind == asset.source_kind, EInvalidBinding);
    assert!(policy.source_id == asset.source_id, EInvalidBinding);
    assert!(policy.source_semantic_id == asset.source_semantic_id, EInvalidBinding);
    assert!(
        policy.source_content_commitment == asset.source_content_commitment,
        EInvalidBinding,
    );
    assert!(policy.source_treasury_id == asset.source_treasury_id, EInvalidTreasury);
    assert!(policy.pack_registry_id == asset.pack_registry_id, EInvalidBinding);
    assert!(policy.pack_registry_revision == asset.pack_registry_revision, EInvalidBinding);
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
    assert!(asset.source_kind == SOURCE_BASE_STYLE, EInvalidMarketCustody);
    assert!(asset.source_id == physical_registry.base_registry_id, EInvalidBinding);
    assert!(asset.source_semantic_id == b"".to_string(), EInvalidBinding);
    assert!(
        &asset.source_content_commitment == maker::root_content_commitment_v8(root),
        EInvalidCommitment,
    );
    assert!(asset.source_treasury_id.is_none(), EInvalidTreasury);
    assert!(source_treasury_id == maker::root_maker_treasury_id_v8(root), EInvalidTreasury);
    assert!(asset.pack_registry_id.is_none(), EInvalidBinding);
    assert!(asset.registered_pack_owner.is_none(), EInvalidBinding);
    assert!(asset.registered_pack_admin_cap_id.is_none(), EInvalidBinding);
}

fun assert_pack_market_source(
    asset: &PhysicalAssetV8,
    source_treasury_id: ID,
) {
    assert!(asset.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
    assert!(asset.source_treasury_id.is_some(), EInvalidTreasury);
    assert!(*asset.source_treasury_id.borrow() == source_treasury_id, EInvalidTreasury);
    assert!(asset.pack_registry_id.is_some(), EInvalidBinding);
    assert!(asset.registered_pack_owner.is_some(), EInvalidBinding);
    assert!(asset.registered_pack_admin_cap_id.is_some(), EInvalidBinding);
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

fun certify_pack_access<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>,
    pack_treasury: &PackTreasuryV8<PaymentCoin>,
    pass: &PackPassV8,
    loadout: &MakerLoadoutV8,
    selection_index: u64,
    ctx: &TxContext,
): PhysicalPackAccessBindingV8 {
    let witness: RuntimePhysicalPackAccessWitnessV8 =
        runtime::new_physical_pack_access_witness_v8<
            PaymentCoin,
            PhysicalOriginalMarkerV8,
            PhysicalCallableMarkerV8,
        >(
            root,
            catalog,
            &config.physical_call_cap,
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
    ) = runtime::consume_physical_pack_access_witness_v8<
        PhysicalOriginalMarkerV8,
        PhysicalCallableMarkerV8,
    >(witness, catalog, &config.physical_call_cap);
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
    assert!(policy.layer_track_key == selection.layer_track_key, EInvalidBinding);
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
    assert!(*policy.pack_registry_id.borrow() == access.pack_registry_id, EInvalidBinding);
    assert!(access.pack_registry_revision >= policy.pack_registry_revision,
        EStaleRevision);
    assert!(*policy.source_treasury_id.borrow() == access.pack_treasury_id, EInvalidTreasury);
    assert_hash(&access.pack_pass_commitment);
    assert!(policy.source_semantic_id == access.semantic_pack_id, EInvalidBinding);
    assert!(policy.source_content_commitment == access.release_content_commitment, EInvalidBinding);
    assert!(policy.layer_track_key == access.layer_track_key, EInvalidBinding);
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
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(maker::capability_output_registry_id_v8(capability)
        == output::physical_complete_output_registry_id_v8(complete),
        EInvalidBinding);
    maker::capability_soul_registry_id_v8(capability)
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
        source_kind: policy.source_kind,
        source_id: policy.source_id,
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
    let current = if (policy.source_kind == SOURCE_BASE_STYLE) {
        registry.base_policies.borrow(PhysicalPolicyKeyV8 {
            source_kind: policy.source_kind,
            source_id: policy.source_id,
            part_key: policy.part_key,
            item_key: policy.item_key,
            style_key: policy.style_key,
        })
    } else {
        registry.pack_policies.borrow(PhysicalPolicyKeyV8 {
            source_kind: policy.source_kind,
            source_id: policy.source_id,
            part_key: policy.part_key,
            item_key: policy.item_key,
            style_key: policy.style_key,
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
    let current = if (policy.source_kind == SOURCE_BASE_STYLE) {
        registry.base_policies.borrow_mut(PhysicalPolicyKeyV8 {
            source_kind: policy.source_kind,
            source_id: policy.source_id,
            part_key: policy.part_key,
            item_key: policy.item_key,
            style_key: policy.style_key,
        })
    } else {
        registry.pack_policies.borrow_mut(PhysicalPolicyKeyV8 {
            source_kind: policy.source_kind,
            source_id: policy.source_id,
            part_key: policy.part_key,
            item_key: policy.item_key,
            style_key: policy.style_key,
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
            source_kind: policy.source_kind,
            source_id: policy.source_id,
            source_semantic_id: policy.source_semantic_id,
            source_content_commitment: policy.source_content_commitment,
            source_treasury_id: policy.source_treasury_id,
            pack_registry_id: policy.pack_registry_id,
            pack_registry_revision: policy.pack_registry_revision,
            registered_pack_owner: policy.registered_pack_owner,
            registered_pack_control_epoch: policy.registered_pack_control_epoch,
            registered_pack_admin_cap_id: policy.registered_pack_admin_cap_id,
            part_key: policy.part_key,
            item_key: policy.item_key,
            style_key: policy.style_key,
            layer_track_key: policy.layer_track_key,
            color_channel_key: policy.color_channel_key,
            default_swatch_key: policy.default_swatch_key,
            style_asset_blob_id: policy.style_asset_blob_id,
            style_asset_sha256: policy.style_asset_sha256,
            style_protected: policy.style_protected,
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
        source_kind: policy.source_kind,
        source_id: policy.source_id,
        source_semantic_id: policy.source_semantic_id,
        source_content_commitment: policy.source_content_commitment,
        source_treasury_id: policy.source_treasury_id,
        pack_registry_id: policy.pack_registry_id,
        pack_registry_revision: policy.pack_registry_revision,
        registered_pack_owner: policy.registered_pack_owner,
        registered_pack_control_epoch: policy.registered_pack_control_epoch,
        registered_pack_admin_cap_id: policy.registered_pack_admin_cap_id,
        part_key: policy.part_key,
        item_key: policy.item_key,
        style_key: policy.style_key,
        layer_track_key: policy.layer_track_key,
        color_channel_key: policy.color_channel_key,
        default_swatch_key: policy.default_swatch_key,
        style_asset_blob_id: policy.style_asset_blob_id,
        style_asset_sha256: policy.style_asset_sha256,
        style_protected: policy.style_protected,
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
        source_kind: policy.source_kind,
        source_id: policy.source_id,
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
    row: &StyleRowV8,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&BaseStyleIdentityInputV8 {
        domain: b"animacraft-v8/physical/base-style",
        version: VERSION,
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        base_registry_id: base::registry_id_v8(base_registry),
        part_key: *base::style_part_key_v8(row),
        item_key: *base::style_item_key_v8(row),
        style_key: *base::style_key_v8(row),
        layer_track_key: *base::style_layer_track_key_v8(row),
        color_channel_key: *base::style_color_channel_key_v8(row),
        default_swatch_key: *base::style_default_swatch_key_v8(row),
        asset_blob_id: *base::style_asset_blob_id_v8(row),
        asset_sha256: *base::style_asset_sha256_v8(row),
        protected: base::style_protected_v8(row),
        payload_commitment: *base::style_payload_commitment_v8(row),
    }))
}

fun assert_config(
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
) {
    assert_config_binding(catalog, config);
    binding::assert_type_origins_v8<PhysicalOriginalMarkerV8, PhysicalCallableMarkerV8>(
        binding::physical_binding_v8(binding::catalog_binding_v8(catalog)),
    );
}

fun assert_config_binding(
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
) {
    assert!(config.version == VERSION, EInvalidConfig);
    assert!(config.catalog_id == binding::catalog_id_v8(catalog), EInvalidConfig);
    let product = binding::catalog_binding_v8(catalog);
    assert!(
        &config.product_binding_commitment == binding::product_binding_commitment_v8(product),
        EInvalidConfig,
    );
    assert!(
        &config.call_cap_set_commitment == binding::call_cap_set_commitment_v8(
            binding::catalog_call_cap_set_v8(catalog),
        ),
        EInvalidConfig,
    );
    binding::assert_physical_call_cap_v8(catalog, &config.physical_call_cap);
}

fun assert_base_registry<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
) {
    maker::assert_base_registry_identity_v8(
        root,
        base::registry_id_v8(base_registry),
        base::registry_root_id_v8(base_registry),
        base::registry_maker_version_v8(base_registry),
        base::registry_root_content_commitment_v8(base_registry),
    );
    assert!(base::registry_sealed_v8(base_registry), ERegistryNotReady);
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
    assert!(registry.base_registry_id == base::registry_id_v8(base_registry), EInvalidBinding);
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
        &policy.layer_track_key
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
    policy.source_kind
}
public fun policy_source_id_v8(policy: &PhysicalStylePolicyV8): ID {
    policy.source_id
}
public fun policy_source_semantic_id_v8(
    policy: &PhysicalStylePolicyV8,
): &String { &policy.source_semantic_id }
public fun policy_source_content_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.source_content_commitment }
public fun policy_source_treasury_id_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<ID> { &policy.source_treasury_id }
public fun policy_pack_registry_id_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<ID> { &policy.pack_registry_id }
public fun policy_pack_registry_revision_v8(policy: &PhysicalStylePolicyV8): u64 {
    policy.pack_registry_revision
}
public fun policy_registered_pack_owner_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<address> { &policy.registered_pack_owner }
public fun policy_registered_pack_control_epoch_v8(
    policy: &PhysicalStylePolicyV8,
): u64 { policy.registered_pack_control_epoch }
public fun policy_registered_pack_admin_cap_id_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<ID> { &policy.registered_pack_admin_cap_id }
public fun policy_part_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.part_key }
public fun policy_item_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.item_key }
public fun policy_style_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.style_key }
public fun policy_layer_track_key_v8(policy: &PhysicalStylePolicyV8): &String {
    &policy.layer_track_key
}
public fun policy_color_channel_key_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<String> { &policy.color_channel_key }
public fun policy_default_swatch_key_v8(
    policy: &PhysicalStylePolicyV8,
): &Option<String> { &policy.default_swatch_key }
public fun policy_style_asset_blob_id_v8(
    policy: &PhysicalStylePolicyV8,
): &String { &policy.style_asset_blob_id }
public fun policy_style_asset_sha256_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.style_asset_sha256 }
public fun policy_style_protected_v8(policy: &PhysicalStylePolicyV8): bool {
    policy.style_protected
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
public fun asset_source_kind_v8(asset: &PhysicalAssetV8): u8 { asset.source_kind }
public fun asset_source_id_v8(asset: &PhysicalAssetV8): ID { asset.source_id }
public fun asset_source_semantic_id_v8(asset: &PhysicalAssetV8): &String {
    &asset.source_semantic_id
}
public fun asset_source_content_commitment_v8(
    asset: &PhysicalAssetV8,
): &vector<u8> { &asset.source_content_commitment }
public fun asset_source_treasury_id_v8(
    asset: &PhysicalAssetV8,
): &Option<ID> { &asset.source_treasury_id }
public fun asset_pack_registry_id_v8(asset: &PhysicalAssetV8): &Option<ID> {
    &asset.pack_registry_id
}
public fun asset_pack_registry_revision_v8(asset: &PhysicalAssetV8): u64 {
    asset.pack_registry_revision
}
public fun asset_registered_pack_owner_v8(
    asset: &PhysicalAssetV8,
): &Option<address> { &asset.registered_pack_owner }
public fun asset_registered_pack_control_epoch_v8(asset: &PhysicalAssetV8): u64 {
    asset.registered_pack_control_epoch
}
public fun asset_registered_pack_admin_cap_id_v8(
    asset: &PhysicalAssetV8,
): &Option<ID> { &asset.registered_pack_admin_cap_id }
public fun asset_part_key_v8(asset: &PhysicalAssetV8): &String { &asset.part_key }
public fun asset_item_key_v8(asset: &PhysicalAssetV8): &String { &asset.item_key }
public fun asset_style_key_v8(asset: &PhysicalAssetV8): &String { &asset.style_key }
public fun asset_layer_track_key_v8(asset: &PhysicalAssetV8): &String {
    &asset.layer_track_key
}
public fun asset_color_channel_key_v8(asset: &PhysicalAssetV8): &Option<String> {
    &asset.color_channel_key
}
public fun asset_default_swatch_key_v8(asset: &PhysicalAssetV8): &Option<String> {
    &asset.default_swatch_key
}
public fun asset_style_asset_blob_id_v8(asset: &PhysicalAssetV8): &String {
    &asset.style_asset_blob_id
}
public fun asset_style_asset_sha256_v8(asset: &PhysicalAssetV8): &vector<u8> {
    &asset.style_asset_sha256
}
public fun asset_style_protected_v8(asset: &PhysicalAssetV8): bool {
    asset.style_protected
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
public struct PhysicalTestRegistryV8 has key { id: UID }

#[test_only]
public struct PhysicalMarketTestListingV8 has key {
    id: UID,
    custody: Option<PhysicalMarketCustodyBindingV8>,
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
    assert!(asset.source_kind == custody.source_kind, EInvalidMarketCustody);
    assert!(asset.source_id == custody.source_id, EInvalidMarketCustody);
    assert!(asset.source_semantic_id == custody.source_semantic_id,
        EInvalidMarketCustody);
    assert!(asset.source_content_commitment == custody.source_content_commitment,
        EInvalidMarketCustody);
    assert!(asset.holder == custody.holder, EWrongHolder);
    assert!(asset.ownership_epoch == custody.ownership_epoch, EStaleRevision);
    assert!(asset.transferable == custody.transferable && asset.transferable,
        ENotTransferable);
    assert!(asset.provenance_commitment == custody.provenance_commitment,
        EInvalidCommitment);
    if (asset.source_kind == SOURCE_BASE_STYLE) {
        assert!(asset.source_treasury_id.is_none(), EInvalidTreasury);
    } else {
        assert!(asset.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
        assert!(asset.source_treasury_id.is_some(), EInvalidTreasury);
        assert!(*asset.source_treasury_id.borrow() == custody.source_treasury_id,
            EInvalidTreasury);
    };
    (asset, custody)
}

#[test_only]
fun return_test_market_asset(
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
fun purchase_test_market_asset(
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
fun destroy_empty_test_market_listing(listing: PhysicalMarketTestListingV8) {
    let PhysicalMarketTestListingV8 { id, custody } = listing;
    assert!(custody.is_none(), EInvalidMarketCustody);
    id.delete()
}

#[test_only]
fun new_base_market_binding_fixture(
    ctx: &mut TxContext,
): (
    ActivePhysicalFixtureV8,
    PhysicalMarketTestListingV8,
    PhysicalAssetV8,
    PhysicalMarketCustodyBindingV8,
) {
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 4, true, ctx,
    );
    let asset = issue_transferable_base_physical_for_market_testing(
        &mut fixture.physical_registry,
        ctx,
    );
    let listing = PhysicalMarketTestListingV8 {
        id: object::new(ctx),
        custody: option::none(),
    };
    let custody = new_physical_market_custody_binding(
        &fixture.physical_registry,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
        &listing.id,
        &asset,
        core_treasury::maker_treasury_id_v8(&fixture.maker_treasury),
    );
    (fixture, listing, asset, custody)
}

#[test_only]
public struct ActivePhysicalFixtureV8 {
    protocol_config: ProtocolConfigV8,
    protocol_treasury: ProtocolTreasuryV8<sui::sui::SUI>,
    protocol_admin: ProtocolAdminCapV8,
    root: MakerRootV8<sui::sui::SUI>,
    base_registry: BaseDefinitionRegistryV8,
    maker_treasury: MakerTreasuryV8<sui::sui::SUI>,
    maker_admin: MakerAdminCapV8,
    catalog: ProductReleaseCatalogV8,
    physical_config: PhysicalPackageConfigV8,
    release_call_cap: PackageCallCapV8<ReleaseRoleV8>,
    market_call_cap: PackageCallCapV8<MarketRoleV8>,
    physical_registry: PhysicalRegistryV8,
    runtime_definitions: RuntimeDefinitionRegistryV8,
    pack_registry: PackRegistryV8,
    admission_authority: PackAdmissionAuthorityV8,
    pack_release: PackReleaseV8<sui::sui::SUI>,
    pack_admin: PackAdminCapV8,
    pack_treasury: PackTreasuryV8<sui::sui::SUI>,
    pack_pass: PackPassV8,
    loadout: MakerLoadoutV8,
    seal_policy_config: PhysicalTestRegistryV8,
    seal_registry: PhysicalTestRegistryV8,
    output_registry: PhysicalTestRegistryV8,
    soul_registry: PhysicalTestRegistryV8,
    market_registry: Coin<sui::sui::SUI>,
    market_treasury: Coin<sui::sui::SUI>,
}

#[test_only]
fun new_active_physical_fixture(
    base_issuance_kind: u8,
    base_proof_kind: u8,
    base_price_atomic: u64,
    base_max_supply: u64,
    base_transferable: bool,
    ctx: &mut TxContext,
): ActivePhysicalFixtureV8 {
    let (protocol_config, protocol_treasury, protocol_admin) =
        protocol::new_protocol_with_treasury_for_testing<sui::sui::SUI>(true, ctx);
    let root_content = test_hash(90);
    let counts = base::new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let commitments = base::minimal_expected_commitments_for_testing(root_content);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &protocol_config,
        maker::access_free_v8(),
        0,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, maker_treasury, maker_admin) =
        core::new_initial_maker_draft_v8<sui::sui::SUI>(
            &protocol_config,
            b"physical-active-fixture".to_string(),
            test_hash(91),
            b"physical-active-manifest".to_string(),
            test_hash(92),
            root_content,
            counts,
            commitments,
            test_hash(93),
            economics,
            rights,
            &clock,
            ctx,
        );
    clock.destroy_for_testing();
    base::populate_and_seal_minimal_for_testing(
        &mut base_registry,
        &root,
        &maker_admin,
    );
    let package_commitments = binding::new_package_commitments_v8(
        test_hash(13),
        test_hash(14),
        test_hash(15),
    );
    let mut catalog = binding::certify_product_release_catalog_v8<
        CorePackageMarkerV8,
        CorePackageMarkerV8,
        SealOriginalMarkerV8,
        SealCallableMarkerV8,
        RuntimeOriginalMarkerV8,
        RuntimeCallableMarkerV8,
        OutputOriginalMarkerV8,
        OutputCallableMarkerV8,
        PhysicalOriginalMarkerV8,
        PhysicalCallableMarkerV8,
        sui::sui::SUI,
        sui::sui::SUI,
        std::ascii::String,
        std::ascii::String,
    >(
        &protocol_config,
        &protocol_admin,
        package_commitments,
        binding::new_package_commitments_v8(test_hash(16), test_hash(17), test_hash(18)),
        binding::new_package_commitments_v8(test_hash(19), test_hash(20), test_hash(21)),
        binding::new_package_commitments_v8(test_hash(22), test_hash(23), test_hash(24)),
        binding::new_package_commitments_v8(test_hash(25), test_hash(26), test_hash(27)),
        binding::new_package_commitments_v8(test_hash(28), test_hash(29), test_hash(30)),
        binding::new_package_commitments_v8(test_hash(31), test_hash(32), test_hash(33)),
        ctx,
    );
    let release_catalog_witness = binding::release_catalog_witness_for_testing(&catalog);
    maker::finalize_product_release_binding_v8(
        &mut root,
        &maker_admin,
        &protocol_config,
        release_catalog_witness,
        ctx,
    );
    let release_call_cap = binding::take_release_call_cap_v8(
        &protocol_config,
        &protocol_admin,
        &mut catalog,
    );
    let physical_call_cap = binding::take_physical_call_cap_v8(
        &protocol_config,
        &protocol_admin,
        &mut catalog,
    );
    let market_call_cap = binding::take_market_call_cap_v8(
        &protocol_config,
        &protocol_admin,
        &mut catalog,
    );
    let physical_config = new_physical_package_config_v8(
        &catalog,
        physical_call_cap,
        ctx,
    );
    let material = test_hash(94);
    let row = derive_base_policy_row_commitment_v8(
        &root,
        &base_registry,
        &physical_config,
        0,
        b"part".to_string(),
        b"item".to_string(),
        b"style".to_string(),
        material,
        base_issuance_kind,
        base_proof_kind,
        base_price_atomic,
        base_max_supply,
        base_transferable,
    );
    let empty = empty_base_policy_commitment_v8(
        &root,
        &base_registry,
        &physical_config,
    );
    let final_commitment = advance_base_policy_commitment_v8(&root, 0, empty, row);
    let mut physical_registry = new_registry_for_testing(
        &root,
        &maker_admin,
        &base_registry,
        &catalog,
        &physical_config,
        1,
        final_commitment,
        ctx,
    );
    append_base_style_policy_for_testing(
        &mut physical_registry,
        &root,
        &maker_admin,
        &base_registry,
        &catalog,
        &physical_config,
        0,
        material,
        base_issuance_kind,
        base_proof_kind,
        base_price_atomic,
        base_max_supply,
        base_transferable,
        row,
    );
    seal_for_testing(
        &mut physical_registry,
        &root,
        &maker_admin,
        &base_registry,
        &catalog,
        &physical_config,
    );
    let (runtime_definitions, mut pack_registry, admission_authority) =
        runtime::new_physical_runtime_fixture_for_testing(&root, ctx);
    let seal_policy_config = PhysicalTestRegistryV8 { id: object::new(ctx) };
    let seal_registry = PhysicalTestRegistryV8 { id: object::new(ctx) };
    let output_registry = PhysicalTestRegistryV8 { id: object::new(ctx) };
    let soul_registry = PhysicalTestRegistryV8 { id: object::new(ctx) };
    let market_registry = coin::mint_for_testing<sui::sui::SUI>(0, ctx);
    let market_treasury = coin::mint_for_testing<sui::sui::SUI>(0, ctx);
    let (seal_ready, runtime_ready, output_ready, physical_ready, market_ready) =
        activation_v8::readiness_set_for_testing(
            &root,
            &catalog,
            &seal_policy_config,
            &seal_registry,
            &runtime_definitions,
            &pack_registry,
            &admission_authority,
            &output_registry,
            &soul_registry,
            &physical_registry,
            &market_registry,
            &market_treasury,
        );
    activation_v8::activate_maker_for_testing(
        &mut root,
        &maker_admin,
        &protocol_config,
        &catalog,
        &base_registry,
        &maker_treasury,
        &protocol_treasury,
        &release_call_cap,
        seal_ready,
        runtime_ready,
        output_ready,
        physical_ready,
        market_ready,
        ctx,
    );
    let (pack_release, pack_admin, pack_treasury, pack_pass, loadout) =
        runtime::add_physical_pack_fixture_for_testing(
            &mut pack_registry,
            &runtime_definitions,
            &root,
            ctx,
        );
    ActivePhysicalFixtureV8 {
        protocol_config,
        protocol_treasury,
        protocol_admin,
        root,
        base_registry,
        maker_treasury,
        maker_admin,
        catalog,
        physical_config,
        release_call_cap,
        market_call_cap,
        physical_registry,
        runtime_definitions,
        pack_registry,
        admission_authority,
        pack_release,
        pack_admin,
        pack_treasury,
        pack_pass,
        loadout,
        seal_policy_config,
        seal_registry,
        output_registry,
        soul_registry,
        market_registry,
        market_treasury,
    }
}

#[test_only]
fun delete_test_registry(registry: PhysicalTestRegistryV8) {
    let PhysicalTestRegistryV8 { id } = registry;
    id.delete();
}

#[test_only]
fun finish_active_physical_fixture(
    fixture: ActivePhysicalFixtureV8,
    ctx: &mut TxContext,
) {
    let ActivePhysicalFixtureV8 {
        protocol_config,
        mut protocol_treasury,
        protocol_admin,
        mut root,
        base_registry,
        maker_treasury,
        maker_admin,
        catalog,
        physical_config,
        release_call_cap,
        market_call_cap,
        physical_registry,
        runtime_definitions,
        pack_registry,
        admission_authority,
        pack_release,
        pack_admin,
        pack_treasury,
        pack_pass,
        loadout,
        seal_policy_config,
        seal_registry,
        output_registry,
        soul_registry,
        market_registry,
        market_treasury,
    } = fixture;
    let release_id = runtime::pack_release_id_v8(&pack_release);
    destroy_registry_for_testing(physical_registry);
    runtime::destroy_physical_pack_fixture_for_testing(
        pack_release,
        pack_admin,
        pack_treasury,
        pack_pass,
        loadout,
    );
    runtime::destroy_physical_runtime_fixture_for_testing(
        runtime_definitions,
        pack_registry,
        admission_authority,
        release_id,
    );
    delete_test_registry(seal_policy_config);
    delete_test_registry(seal_registry);
    delete_test_registry(output_registry);
    delete_test_registry(soul_registry);
    assert!(coin::burn_for_testing(market_registry) == 0, EInvalidCount);
    assert!(coin::burn_for_testing(market_treasury) == 0, EInvalidCount);
    destroy_config_for_testing(physical_config);
    binding::destroy_call_cap_for_testing(release_call_cap);
    binding::destroy_call_cap_for_testing(market_call_cap);
    binding::destroy_catalog_for_testing(catalog);
    let protocol_balance = protocol::protocol_treasury_balance_v8(&protocol_treasury);
    if (protocol_balance > 0) {
        protocol::withdraw_protocol_revenue_v8(
            &protocol_config,
            &protocol_admin,
            &mut protocol_treasury,
            protocol_balance,
            @0xB11,
            ctx,
        );
    };
    protocol::destroy_protocol_with_treasury_for_testing(
        protocol_config,
        protocol_treasury,
        protocol_admin,
    );
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_draft_v8());
    core::share_maker_draft_v8(
        root,
        base_registry,
        maker_treasury,
        maker_admin,
        ctx,
    );
}

#[test_only]
fun register_test_pack_policy(
    fixture: &mut ActivePhysicalFixtureV8,
    expected_revision: u64,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    ctx: &TxContext,
) {
    register_pack_style_policy_v8(
        &mut fixture.physical_registry,
        &fixture.root,
        &fixture.maker_admin,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.pack_registry,
        &fixture.pack_release,
        &fixture.pack_admin,
        &fixture.pack_treasury,
        expected_revision,
        b"part".to_string(),
        b"pack-item".to_string(),
        b"pack-style".to_string(),
        test_hash(95),
        issuance_kind,
        proof_kind,
        price_atomic,
        max_supply,
        transferable,
        ctx,
    )
}

#[test_only]
fun base_selection_witness(
    fixture: &mut ActivePhysicalFixtureV8,
    ctx: &TxContext,
): RuntimePhysicalSelectionWitnessV8 {
    runtime::set_physical_base_selection_for_testing(
        &mut fixture.loadout,
        &fixture.root,
    );
    runtime::physical_selection_witness_for_testing(
        &fixture.loadout,
        *maker::root_content_commitment_v8(&fixture.root),
        0,
        ctx,
    )
}

#[test_only]
fun pack_selection_witness(
    fixture: &ActivePhysicalFixtureV8,
    ctx: &TxContext,
): RuntimePhysicalSelectionWitnessV8 {
    runtime::physical_selection_witness_for_testing(
        &fixture.loadout,
        *runtime::pack_release_content_commitment_v8(&fixture.pack_release),
        0,
        ctx,
    )
}

#[test_only]
fun claim_fixture_base_free(
    fixture: &mut ActivePhysicalFixtureV8,
    witness: RuntimePhysicalSelectionWitnessV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    claim_free_base_style_v8(
        &mut fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.physical_config,
        witness,
        &fixture.loadout,
        expected_issued_count,
        ctx,
    )
}

#[test_only]
fun claim_fixture_pack_free(
    fixture: &mut ActivePhysicalFixtureV8,
    witness: RuntimePhysicalSelectionWitnessV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    claim_free_pack_style_v8(
        &mut fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.pack_registry,
        &fixture.pack_release,
        &fixture.pack_treasury,
        &fixture.pack_pass,
        witness,
        &fixture.loadout,
        expected_issued_count,
        ctx,
    )
}

#[test_only]
fun purchase_fixture_base(
    fixture: &mut ActivePhysicalFixtureV8,
    payment: Coin<sui::sui::SUI>,
    witness: RuntimePhysicalSelectionWitnessV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    purchase_base_style_v8(
        &mut fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.protocol_config,
        &mut fixture.protocol_treasury,
        &mut fixture.maker_treasury,
        payment,
        witness,
        &fixture.loadout,
        expected_issued_count,
        ctx,
    )
}

#[test_only]
fun purchase_fixture_pack(
    fixture: &mut ActivePhysicalFixtureV8,
    payment: Coin<sui::sui::SUI>,
    witness: RuntimePhysicalSelectionWitnessV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    purchase_pack_style_v8(
        &mut fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.pack_registry,
        &fixture.pack_release,
        &mut fixture.pack_treasury,
        &fixture.pack_pass,
        &fixture.protocol_config,
        &mut fixture.protocol_treasury,
        payment,
        witness,
        &fixture.loadout,
        expected_issued_count,
        ctx,
    )
}

#[test_only]
fun purchase_fixture_base_with_treasury(
    fixture: &mut ActivePhysicalFixtureV8,
    maker_treasury: &mut MakerTreasuryV8<sui::sui::SUI>,
    payment: Coin<sui::sui::SUI>,
    witness: RuntimePhysicalSelectionWitnessV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    purchase_base_style_v8(
        &mut fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.protocol_config,
        &mut fixture.protocol_treasury,
        maker_treasury,
        payment,
        witness,
        &fixture.loadout,
        expected_issued_count,
        ctx,
    )
}

#[test_only]
fun purchase_fixture_pack_with_treasury(
    fixture: &mut ActivePhysicalFixtureV8,
    pack_treasury: &mut PackTreasuryV8<sui::sui::SUI>,
    payment: Coin<sui::sui::SUI>,
    witness: RuntimePhysicalSelectionWitnessV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    purchase_pack_style_v8(
        &mut fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.pack_registry,
        &fixture.pack_release,
        pack_treasury,
        &fixture.pack_pass,
        &fixture.protocol_config,
        &mut fixture.protocol_treasury,
        payment,
        witness,
        &fixture.loadout,
        expected_issued_count,
        ctx,
    )
}

#[test_only]
fun set_fixture_pack_admission(
    fixture: &mut ActivePhysicalFixtureV8,
    admitted: bool,
) {
    runtime::set_physical_pack_admission_for_testing(
        &mut fixture.pack_registry,
        &fixture.pack_release,
        admitted,
    )
}

#[test_only]
fun advance_fixture_pack_control(fixture: &mut ActivePhysicalFixtureV8) {
    runtime::advance_physical_pack_control_for_testing(
        &mut fixture.pack_release,
        &mut fixture.pack_admin,
    )
}

#[test_only]
public fun issue_transferable_base_physical_for_market_testing(
    registry: &mut PhysicalRegistryV8,
    ctx: &mut TxContext,
): PhysicalAssetV8 {
    assert!(!registry.base_policy_keys.is_empty(), EInvalidPolicy);
    let key = *registry.base_policy_keys.borrow(0);
    let policy = *registry.base_policies.borrow(key);
    assert!(policy.source_kind == SOURCE_BASE_STYLE, EInvalidPolicy);
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
    assert!(policy.source_kind == SOURCE_PACK_STYLE, EInvalidPolicy);
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
        source_kind: _,
        source_id: _,
        source_semantic_id: _,
        source_content_commitment: _,
        source_treasury_id: _,
        pack_registry_id: _,
        pack_registry_revision: _,
        registered_pack_owner: _,
        registered_pack_control_epoch: _,
        registered_pack_admin_cap_id: _,
        part_key: _,
        item_key: _,
        style_key: _,
        layer_track_key: _,
        color_channel_key: _,
        default_swatch_key: _,
        style_asset_blob_id: _,
        style_asset_sha256: _,
        style_protected: _,
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
        physical_call_cap,
    } = config;
    id.delete();
    binding::destroy_call_cap_for_testing(physical_call_cap)
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
fun new_config_for_testing(
    catalog: &ProductReleaseCatalogV8,
    physical_call_cap: PackageCallCapV8<PhysicalRoleV8>,
    ctx: &mut TxContext,
): PhysicalPackageConfigV8 {
    binding::assert_physical_call_cap_v8(catalog, &physical_call_cap);
    let product = binding::catalog_binding_v8(catalog);
    PhysicalPackageConfigV8 {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *binding::call_cap_set_commitment_v8(
            binding::catalog_call_cap_set_v8(catalog),
        ),
        physical_call_cap,
    }
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

#[test_only]
fun new_test_fixture(ctx: &mut TxContext): (
    ProtocolConfigV8,
    ProtocolAdminCapV8,
    MakerRootV8<sui::sui::SUI>,
    BaseDefinitionRegistryV8,
    MakerTreasuryV8<sui::sui::SUI>,
    MakerAdminCapV8,
    ProductReleaseCatalogV8,
    PhysicalPackageConfigV8,
) {
    let (protocol_config, protocol_admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    let root_content = test_hash(10);
    let counts = base::new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let commitments = base::minimal_expected_commitments_for_testing(root_content);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &protocol_config,
        maker::access_free_v8(),
        0,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<sui::sui::SUI>(
            &protocol_config,
            b"maker-physical-test".to_string(),
            test_hash(11),
            b"walrus-manifest".to_string(),
            test_hash(12),
            root_content,
            counts,
            commitments,
            test_hash(13),
            economics,
            rights,
            &clock,
            ctx,
        );
    clock.destroy_for_testing();
    let mut catalog = binding::product_release_catalog_for_testing(
        &protocol_config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        ctx,
    );
    let release_witness = binding::release_catalog_witness_for_testing(&catalog);
    maker::finalize_product_release_binding_v8(
        &mut root,
        &admin,
        &protocol_config,
        release_witness,
        ctx,
    );
    base::populate_and_seal_minimal_for_testing(&mut base_registry, &root, &admin);
    let physical_call_cap = binding::take_physical_call_cap_v8(
        &protocol_config,
        &protocol_admin,
        &mut catalog,
    );
    let physical_config = new_config_for_testing(&catalog, physical_call_cap, ctx);
    (
        protocol_config,
        protocol_admin,
        root,
        base_registry,
        maker_treasury,
        admin,
        catalog,
        physical_config,
    )
}

#[test_only]
fun finish_test_fixture(
    protocol_config: ProtocolConfigV8,
    protocol_admin: ProtocolAdminCapV8,
    root: MakerRootV8<sui::sui::SUI>,
    base_registry: BaseDefinitionRegistryV8,
    maker_treasury: MakerTreasuryV8<sui::sui::SUI>,
    admin: MakerAdminCapV8,
    catalog: ProductReleaseCatalogV8,
    physical_config: PhysicalPackageConfigV8,
    ctx: &TxContext,
) {
    destroy_config_for_testing(physical_config);
    binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(protocol_config, protocol_admin);
    core::share_maker_draft_v8(root, base_registry, maker_treasury, admin, ctx);
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

#[test]
fun zero_policy_registry_seals_and_is_ready() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let empty = empty_base_policy_commitment_v8(&root, &base_registry, &physical_config);
    let mut registry = new_registry_for_testing(
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
        0,
        empty,
        &mut ctx,
    );
    seal_for_testing(
        &mut registry,
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
    );
    assert_hash(&assert_local_readiness_for_testing(
        &registry,
        &root,
        &base_registry,
        &catalog,
        &physical_config,
    ));
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun zero_policy_registry_rejects_nonempty_commitment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 8, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let registry = new_registry_for_testing(
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
        0,
        test_hash(88),
        &mut ctx,
    );
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test, expected_failure(abort_code = ERegistryNotSealed)]
fun readiness_rejects_unsealed_registry() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 9, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let empty = empty_base_policy_commitment_v8(
        &root, &base_registry, &physical_config,
    );
    let registry = new_registry_for_testing(
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
        0,
        empty,
        &mut ctx,
    );
    let _ = assert_local_readiness_for_testing(
        &registry, &root, &base_registry, &catalog, &physical_config,
    );
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test]
fun base_policy_is_derived_from_exact_live_style() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let material = test_hash(30);
    let row = derive_base_policy_row_commitment_v8(
        &root,
        &base_registry,
        &physical_config,
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
    let empty = empty_base_policy_commitment_v8(&root, &base_registry, &physical_config);
    let final_commitment = advance_base_policy_commitment_v8(&root, 0, empty, row);
    let mut registry = new_registry_for_testing(
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
        1,
        final_commitment,
        &mut ctx,
    );
    append_base_style_policy_for_testing(
        &mut registry,
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
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
        maker::root_id_v8(&root),
        b"part".to_string(), b"item".to_string(), b"style".to_string(),
        b"track".to_string(), *maker::root_content_commitment_v8(&root),
        test_hash(14),
    );
    let policy = borrow_base_policy_v8(&registry, &selection);
    assert!(policy.sequence == 0, EInvalidSequence);
    assert!(
        &policy.style_identity_commitment == &derive_base_style_identity_v8(
            &root,
            &base_registry,
            b"part".to_string(),
            b"item".to_string(),
            b"style".to_string(),
        ),
        EInvalidCommitment,
    );
    seal_for_testing(
        &mut registry,
        &root,
        &admin,
        &base_registry,
        &catalog,
        &physical_config,
    );
    assert_hash(&assert_local_readiness_for_testing(
        &registry,
        &root,
        &base_registry,
        &catalog,
        &physical_config,
    ));
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidCount)]
fun seal_rejects_missing_expected_row() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(
        &root, &admin, &base_registry, &catalog, &physical_config,
        1, test_hash(31), &mut ctx);
    seal_for_testing(&mut registry, &root, &admin, &base_registry,
        &catalog, &physical_config);
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun append_rejects_wrong_row_commitment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 4, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(
        &root, &admin, &base_registry, &catalog, &physical_config,
        1, test_hash(32), &mut ctx);
    append_base_style_policy_for_testing(
        &mut registry, &root, &admin, &base_registry, &catalog,
        &physical_config, 0, test_hash(33), ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, test_hash(99));
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test, expected_failure(abort_code = EInvalidSequence)]
fun append_rejects_out_of_order_sequence() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 5, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let material = test_hash(34);
    let row = derive_base_policy_row_commitment_v8(
        &root, &base_registry, &physical_config, 1, b"part".to_string(),
        b"item".to_string(), b"style".to_string(), material,
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, false);
    let mut registry = new_registry_for_testing(
        &root, &admin, &base_registry, &catalog, &physical_config,
        2, test_hash(35), &mut ctx);
    append_base_style_policy_for_testing(
        &mut registry, &root, &admin, &base_registry, &catalog,
        &physical_config, 1, material, ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, row);
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test, expected_failure(abort_code = EDuplicatePolicy)]
fun duplicate_base_style_policy_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 6, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let material = test_hash(36);
    let empty = empty_base_policy_commitment_v8(&root, &base_registry, &physical_config);
    let row0 = derive_base_policy_row_commitment_v8(
        &root, &base_registry, &physical_config, 0, b"part".to_string(),
        b"item".to_string(), b"style".to_string(), material,
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, false);
    let next = advance_base_policy_commitment_v8(&root, 0, empty, row0);
    let row1 = derive_base_policy_row_commitment_v8(
        &root, &base_registry, &physical_config, 1, b"part".to_string(),
        b"item".to_string(), b"style".to_string(), material,
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, false);
    let final_commitment = advance_base_policy_commitment_v8(&root, 1, next, row1);
    let mut registry = new_registry_for_testing(
        &root, &admin, &base_registry, &catalog, &physical_config,
        2, final_commitment, &mut ctx);
    append_base_style_policy_for_testing(
        &mut registry, &root, &admin, &base_registry, &catalog,
        &physical_config, 0, material, ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, row0);
    append_base_style_policy_for_testing(
        &mut registry, &root, &admin, &base_registry, &catalog,
        &physical_config, 1, material, ISSUE_FREE_CLAIM, PROOF_NONE,
        0, 1, false, row1);
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test, expected_failure(abort_code = ERegistryNotReady)]
fun readiness_rejects_nonzero_future_runtime_lane() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7, 0, 0, 0);
    let (protocol_config, protocol_admin, root, base_registry, maker_treasury,
        admin, catalog, physical_config) = new_test_fixture(&mut ctx);
    let empty = empty_base_policy_commitment_v8(&root, &base_registry, &physical_config);
    let mut registry = new_registry_for_testing(
        &root, &admin, &base_registry, &catalog, &physical_config,
        0, empty, &mut ctx);
    seal_for_testing(&mut registry, &root, &admin, &base_registry,
        &catalog, &physical_config);
    registry.revision = 1;
    let _ = assert_local_readiness_for_testing(
        &registry, &root, &base_registry, &catalog, &physical_config);
    destroy_registry_for_testing(registry);
    finish_test_fixture(protocol_config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, physical_config, &ctx);
}

#[test]
fun pack_policy_registers_from_live_witness_and_free_issues_exact_asset() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 101, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    assert!(fixture.physical_registry.revision == 1, EStaleRevision);
    assert!(fixture.physical_registry.pack_policy_count == 1, EInvalidCount);
    let witness = pack_selection_witness(&fixture, &ctx);
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, &mut ctx);
    assert!(asset.source_kind == SOURCE_PACK_STYLE, EInvalidBinding);
    assert!(asset.source_id == runtime::pack_release_id_v8(&fixture.pack_release),
        EInvalidBinding);
    assert!(asset.source_treasury_id.is_some(), EInvalidTreasury);
    assert!(*asset.source_treasury_id.borrow()
        == object::id(&fixture.pack_treasury), EInvalidTreasury);
    assert!(*asset.pack_registry_id.borrow()
        == object::id(&fixture.pack_registry), EInvalidBinding);
    assert!(asset.pack_registry_revision
        == runtime::pack_registry_revision_v8(&fixture.pack_registry),
        EStaleRevision);
    assert!(*asset.registered_pack_owner.borrow() == @0xA11, EWrongHolder);
    assert!(asset.registered_pack_control_epoch == 0, EInvalidBinding);
    assert!(*asset.registered_pack_admin_cap_id.borrow()
        == object::id(&fixture.pack_admin), EInvalidBinding);
    assert!(asset.part_key == b"part".to_string()
        && asset.item_key == b"pack-item".to_string()
        && asset.style_key == b"pack-style".to_string()
        && asset.layer_track_key == b"track".to_string(), EInvalidBinding);
    assert!(asset.style_asset_blob_id == b"pack-style-blob".to_string(),
        EInvalidBinding);
    assert!(asset.style_asset_sha256 == test_hash(72), EInvalidCommitment);
    assert!(asset.source_style_commitment == test_hash(74), EInvalidCommitment);
    assert!(asset.serial == 1 && asset.ownership_epoch == 0, EInvalidSequence);
    consume_physical_asset_v8(
        &mut fixture.physical_registry,
        asset,
        0,
        &ctx,
    );
    assert!(fixture.physical_registry.total_issued == 1, EInvalidCount);
    assert!(fixture.physical_registry.total_consumed == 1, EInvalidCount);
    finish_active_physical_fixture(fixture, &mut ctx);
}

#[test, expected_failure(abort_code = EDuplicatePolicy)]
fun duplicate_pack_policy_registration_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 102, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    register_test_pack_policy(
        &mut fixture, 1, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EStaleRevision)]
fun pack_policy_registration_requires_exact_registry_revision() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 103, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 1, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = 15)]
fun revoked_pack_admission_blocks_new_issuance() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 104, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    let witness = pack_selection_witness(&fixture, &ctx);
    set_fixture_pack_admission(&mut fixture, false);
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, &mut ctx);
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = 9)]
fun paused_pack_blocks_new_issuance() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 105, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    let witness = pack_selection_witness(&fixture, &ctx);
    runtime::set_physical_pack_lifecycle_for_testing(
        &mut fixture.pack_release,
        runtime::pack_paused_v8(),
    );
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, &mut ctx);
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = 9)]
fun archived_pack_blocks_new_issuance() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 106, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    let witness = pack_selection_witness(&fixture, &ctx);
    runtime::set_physical_pack_lifecycle_for_testing(
        &mut fixture.pack_release,
        runtime::pack_archived_v8(),
    );
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, &mut ctx);
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(
    abort_code = 0,
    location = animacraft_v8_core::maker_v8,
)]
fun paused_root_blocks_new_issuance() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 121, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    maker::set_lifecycle_for_testing(&mut fixture.root, maker::lifecycle_paused_v8());
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test]
fun pack_control_epoch_change_does_not_invalidate_registered_content() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 107, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    advance_fixture_pack_control(&mut fixture);
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    let policy = fixture.physical_registry.pack_policies.borrow(
        PhysicalPolicyKeyV8 {
            source_kind: SOURCE_PACK_STYLE,
            source_id: object::id(&fixture.pack_release),
            part_key: b"part".to_string(),
            item_key: b"pack-item".to_string(),
            style_key: b"pack-style".to_string(),
        },
    );
    assert!(policy.registered_pack_control_epoch == 1, EInvalidBinding);
    assert!(*policy.registered_pack_admin_cap_id.borrow()
        == object::id(&fixture.pack_admin), EInvalidBinding);
    advance_fixture_pack_control(&mut fixture);
    let witness = pack_selection_witness(&fixture, &ctx);
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, &mut ctx);
    consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx);
}

#[test, expected_failure(abort_code = EReplay)]
fun free_claim_replay_is_stable_across_loadout_revisions() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 108, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, &ctx);
    let replay = base_selection_witness(&mut fixture, &ctx);
    let asset = claim_fixture_base_free(&mut fixture, replay, 1, &mut ctx);
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = 21)]
fun stale_runtime_selection_witness_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 109, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    runtime::mutate_physical_loadout_for_testing(&mut fixture.loadout);
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test]
fun paid_base_purchase_splits_exact_protocol_and_maker_residual() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 110, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_PAID_PURCHASE, PROOF_NONE, 100, 2, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100),
        &mut ctx,
    );
    let asset = purchase_fixture_base(&mut fixture, payment, witness, 0, &mut ctx);
    assert!(protocol::protocol_treasury_balance_v8(&fixture.protocol_treasury) == 10,
        EWrongPayment);
    assert!(core_treasury::maker_treasury_balance_v8(&fixture.maker_treasury) == 90,
        EWrongPayment);
    assert!(fixture.physical_registry.gross_paid_atomic == 100, EWrongPayment);
    assert!(fixture.physical_registry.protocol_paid_atomic == 10, EWrongPayment);
    assert!(fixture.physical_registry.maker_paid_atomic == 90, EWrongPayment);
    assert!(fixture.physical_registry.pack_paid_atomic == 0, EWrongPayment);
    consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx);
}

#[test]
fun paid_pack_purchase_splits_exact_protocol_and_pack_residual() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 111, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_PAID_PURCHASE, PROOF_NONE, 100, 2, true, &ctx,
    );
    let witness = pack_selection_witness(&fixture, &ctx);
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100),
        &mut ctx,
    );
    let asset = purchase_fixture_pack(&mut fixture, payment, witness, 0, &mut ctx);
    assert!(protocol::protocol_treasury_balance_v8(&fixture.protocol_treasury) == 10,
        EWrongPayment);
    assert!(runtime::pack_treasury_balance_v8(&fixture.pack_treasury) == 90,
        EWrongPayment);
    assert!(fixture.physical_registry.maker_paid_atomic == 0, EWrongPayment);
    assert!(fixture.physical_registry.pack_paid_atomic == 90, EWrongPayment);
    consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx);
}

#[test]
fun soul_proof_issuance_records_exact_provenance_and_counter() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 120, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_PROOF_MATERIALIZE,
        PROOF_CANONICAL_SOUL,
        0,
        2,
        true,
        &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let selection = consume_runtime_selection(witness, &fixture.loadout, &ctx);
    assert_selection_root(&fixture.physical_registry, &selection, &ctx);
    let policy = *borrow_base_policy_by_selection(
        &fixture.physical_registry,
        &selection,
    );
    let soul_id = object::id(&fixture.soul_registry);
    let soul_commitment = test_hash(121);
    let proof = PhysicalProofProvenanceV8 {
        output_registry_id: object::id(&fixture.output_registry),
        soul_registry_id: object::id(&fixture.soul_registry),
        output_key: b"physical-test-output".to_string(),
        output_policy_commitment: test_hash(122),
        output_id: object::id(&fixture.seal_registry),
        receipt_id: object::id(&fixture.seal_policy_config),
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
        &fixture.physical_registry,
        &policy,
        @0x0,
        soul_id,
        soul_commitment,
    );
    let asset = issue_asset(
        &mut fixture.physical_registry,
        policy,
        @0xA11,
        0,
        authorization_key,
        option::some(proof),
        &mut ctx,
    );
    assert!(asset.proof.is_some(), EWrongIssuance);
    assert!(asset.proof_kind == PROOF_CANONICAL_SOUL, EWrongIssuance);
    assert!(asset.source_id == fixture.physical_registry.base_registry_id,
        EInvalidBinding);
    assert!(asset.source_treasury_id.is_none(), EInvalidTreasury);
    assert!(fixture.physical_registry.total_proof_materialized == 1,
        EInvalidCount);
    consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx);
}

#[test, expected_failure(abort_code = EWrongPayment)]
fun paid_purchase_rejects_wrong_exact_payment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 112, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_PAID_PURCHASE, PROOF_NONE, 100, 2, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(99),
        &mut ctx,
    );
    let asset = purchase_fixture_base(&mut fixture, payment, witness, 0, &mut ctx);
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(
    abort_code = 25,
    location = animacraft_v8_core::maker_v8,
)]
fun paid_purchase_rejects_another_roots_maker_treasury() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 118, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_PAID_PURCHASE, PROOF_NONE, 100, 2, true, &mut ctx,
    );
    let mut other = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100),
        &mut ctx,
    );
    let asset = purchase_fixture_base_with_treasury(
        &mut fixture,
        &mut other.maker_treasury,
        payment,
        witness,
        0,
        &mut ctx,
    );
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx);
    finish_active_physical_fixture(other, &mut ctx)
}

#[test, expected_failure(
    abort_code = 0,
    location = animacraft_v8_runtime::runtime_v8,
)]
fun paid_pack_purchase_rejects_another_releases_pack_treasury() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 122, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    let mut other = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture,
        0,
        ISSUE_PAID_PURCHASE,
        PROOF_NONE,
        100,
        1,
        true,
        &ctx,
    );
    let witness = pack_selection_witness(&fixture, &ctx);
    let payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100),
        &mut ctx,
    );
    let asset = purchase_fixture_pack_with_treasury(
        &mut fixture,
        &mut other.pack_treasury,
        payment,
        witness,
        0,
        &mut ctx,
    );
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx);
    finish_active_physical_fixture(other, &mut ctx)
}

#[test, expected_failure(
    abort_code = 1,
    location = animacraft_v8_core::package_binding_v8,
)]
fun physical_role_rejects_a_core_package_type_origin() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 119, 0, 0, 0);
    let fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    binding::assert_type_origins_v8<ProtocolConfigV8, ProtocolAdminCapV8>(
        binding::physical_binding_v8(binding::catalog_binding_v8(
            &fixture.catalog,
        )),
    );
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = ESupplyExhausted)]
fun supply_cas_blocks_after_exact_max_without_reopening_consumed_supply() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 113, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_PAID_PURCHASE, PROOF_NONE, 100, 1, true, &mut ctx,
    );
    let first_witness = base_selection_witness(&mut fixture, &ctx);
    let first_payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100), &mut ctx);
    let asset = purchase_fixture_base(
        &mut fixture, first_payment, first_witness, 0, &mut ctx,
    );
    consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, &ctx);
    let second_witness = base_selection_witness(&mut fixture, &ctx);
    let second_payment = coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(100), &mut ctx);
    let asset = purchase_fixture_base(
        &mut fixture, second_payment, second_witness, 1, &mut ctx,
    );
    destroy_asset_for_testing(asset);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EWrongPayment)]
fun physical_payment_share_rejects_nonzero_rounding_to_zero() {
    let _ = protocol_share(1, 1);
}

#[test]
fun direct_transfer_remains_available_after_root_pause() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 114, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    maker::set_lifecycle_for_testing(&mut fixture.root, maker::lifecycle_paused_v8());
    transfer_physical_asset_v8(asset, @0xB11, 0, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx);
}

#[test]
fun consume_remains_available_after_root_and_pack_archive() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 115, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &ctx,
    );
    let witness = pack_selection_witness(&fixture, &ctx);
    let asset = claim_fixture_pack_free(&mut fixture, witness, 0, &mut ctx);
    maker::set_lifecycle_for_testing(&mut fixture.root, maker::lifecycle_archived_v8());
    runtime::set_physical_pack_lifecycle_for_testing(
        &mut fixture.pack_release,
        runtime::pack_archived_v8(),
    );
    consume_physical_asset_v8(&mut fixture.physical_registry, asset, 0, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx);
}

#[test, expected_failure(abort_code = ENotTransferable)]
fun nontransferable_asset_rejects_direct_transfer() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 116, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, false, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    transfer_physical_asset_v8(asset, @0xB11, 0, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EWrongHolder)]
fun wrong_holder_cannot_direct_transfer() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 123, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    // `TxContext::new_from_hint` replaces the native test context globally, so
    // construct the adversarial sender only after the asset has been issued.
    let wrong_ctx = sui::tx_context::new_from_hint(@0xB0B, 124, 0, 0, 0);
    transfer_physical_asset_v8(asset, @0xB11, 0, &wrong_ctx);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EStaleRevision)]
fun direct_transfer_requires_exact_asset_ownership_epoch() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 117, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 1, true, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    transfer_physical_asset_v8(asset, @0xB11, 1, &ctx);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test]
fun cross_transaction_base_market_return_preserves_exact_state() {
    let seller = @0xA11;
    let recoverer = @0xCAFE;
    let mut scenario = sui::test_scenario::begin(seller);
    let (asset_id, provenance_commitment, asset_content_commitment, source_content_commitment) = {
        let ctx = scenario.ctx();
        let mut fixture = new_active_physical_fixture(
            ISSUE_FREE_CLAIM, PROOF_NONE, 0, 3, true, ctx,
        );
        let asset = issue_transferable_base_physical_for_market_testing(
            &mut fixture.physical_registry,
            ctx,
        );
        let asset_id = object::id(&asset);
        let provenance_commitment = asset.provenance_commitment;
        let asset_content_commitment = asset.asset_content_commitment;
        let source_content_commitment = asset.source_content_commitment;
        let mut listing = PhysicalMarketTestListingV8 {
            id: object::new(ctx),
            custody: option::none(),
        };
        let listing_id = object::id(&listing);
        let ticket = custody_base_physical_for_market_v8<
            sui::sui::SUI,
            sui::sui::SUI,
            sui::sui::SUI,
            Coin<sui::sui::SUI>,
            Coin<sui::sui::SUI>,
        >(
            &fixture.physical_registry,
            &fixture.root,
            &fixture.protocol_config,
            &fixture.catalog,
            &fixture.physical_config,
            &fixture.market_call_cap,
            &fixture.market_registry,
            &fixture.market_treasury,
            &mut listing.id,
            &fixture.maker_treasury,
            asset,
            ctx,
        );
        let custody = consume_physical_market_custody_ticket_v8(ticket);
        assert!(custody.listing_id == listing_id, EInvalidMarketCustody);
        assert!(custody.asset_id == asset_id, EInvalidMarketCustody);
        assert!(custody.source_kind == SOURCE_BASE_STYLE, EInvalidMarketCustody);
        assert!(
            custody.source_treasury_id
                == core_treasury::maker_treasury_id_v8(&fixture.maker_treasury),
            EInvalidTreasury,
        );
        assert!(custody.holder == seller, EWrongHolder);
        assert!(custody.ownership_epoch == 0, EStaleRevision);
        assert!(custody.transferable, ENotTransferable);
        listing.custody = option::some(custody);
        transfer::share_object(listing);
        finish_active_physical_fixture(fixture, ctx);
        (
            asset_id,
            provenance_commitment,
            asset_content_commitment,
            source_content_commitment,
        )
    };
    scenario.next_tx(recoverer);
    {
        let listing = scenario.take_shared<PhysicalMarketTestListingV8>();
        let receiving = sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id);
        return_test_market_asset(listing, receiving);
    };
    scenario.next_tx(seller);
    {
        let asset = scenario.take_from_sender<PhysicalAssetV8>();
        assert!(object::id(&asset) == asset_id, EInvalidMarketCustody);
        assert!(asset.holder == seller, EWrongHolder);
        assert!(asset.ownership_epoch == 0, EStaleRevision);
        assert!(asset.provenance_commitment == provenance_commitment, EInvalidCommitment);
        assert!(asset.asset_content_commitment == asset_content_commitment, EInvalidCommitment);
        assert!(asset.source_content_commitment == source_content_commitment, EInvalidCommitment);
        destroy_asset_for_testing(asset);
    };
    scenario.end();
}

#[test]
fun cross_transaction_pack_market_purchase_changes_only_owner_state() {
    let seller = @0xA11;
    let buyer = @0xB22;
    let mut scenario = sui::test_scenario::begin(seller);
    let (asset_id, provenance_commitment, source_id, source_content_commitment) = {
        let ctx = scenario.ctx();
        let mut fixture = new_active_physical_fixture(
            ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, ctx,
        );
        register_test_pack_policy(
            &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, ctx,
        );
        let asset = issue_transferable_pack_physical_for_market_testing(
            &mut fixture.physical_registry,
            ctx,
        );
        let asset_id = object::id(&asset);
        let provenance_commitment = asset.provenance_commitment;
        let source_id = asset.source_id;
        let source_content_commitment = asset.source_content_commitment;
        let mut listing = PhysicalMarketTestListingV8 {
            id: object::new(ctx),
            custody: option::none(),
        };
        let ticket = custody_pack_physical_for_market_v8<
            sui::sui::SUI,
            sui::sui::SUI,
            sui::sui::SUI,
            Coin<sui::sui::SUI>,
            Coin<sui::sui::SUI>,
        >(
            &fixture.physical_registry,
            &fixture.root,
            &fixture.protocol_config,
            &fixture.catalog,
            &fixture.physical_config,
            &fixture.market_call_cap,
            &fixture.market_registry,
            &fixture.market_treasury,
            &mut listing.id,
            &fixture.pack_treasury,
            asset,
            ctx,
        );
        let custody = consume_physical_market_custody_ticket_v8(ticket);
        assert!(custody.source_kind == SOURCE_PACK_STYLE, EInvalidMarketCustody);
        assert!(custody.source_treasury_id == object::id(&fixture.pack_treasury),
            EInvalidTreasury);
        listing.custody = option::some(custody);
        transfer::share_object(listing);
        finish_active_physical_fixture(fixture, ctx);
        (asset_id, provenance_commitment, source_id, source_content_commitment)
    };
    scenario.next_tx(buyer);
    {
        let listing = scenario.take_shared<PhysicalMarketTestListingV8>();
        let receiving = sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id);
        purchase_test_market_asset(listing, receiving, scenario.ctx());
    };
    scenario.next_tx(buyer);
    {
        let asset = scenario.take_from_sender<PhysicalAssetV8>();
        assert!(object::id(&asset) == asset_id, EInvalidMarketCustody);
        assert!(asset.holder == buyer, EWrongHolder);
        assert!(asset.ownership_epoch == 1, EStaleRevision);
        assert!(asset.provenance_commitment == provenance_commitment, EInvalidCommitment);
        assert!(asset.source_id == source_id, EInvalidBinding);
        assert!(asset.source_content_commitment == source_content_commitment,
            EInvalidCommitment);
        destroy_asset_for_testing(asset);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = 3, location = sui::transfer)]
fun cross_transaction_wrong_listing_parent_cannot_receive_custodied_asset() {
    let seller = @0xA11;
    let mut scenario = sui::test_scenario::begin(seller);
    let (asset_id, wrong_listing_id) = {
        let ctx = scenario.ctx();
        let mut fixture = new_active_physical_fixture(
            ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, ctx,
        );
        let asset = issue_transferable_base_physical_for_market_testing(
            &mut fixture.physical_registry,
            ctx,
        );
        let asset_id = object::id(&asset);
        let mut correct_listing = PhysicalMarketTestListingV8 {
            id: object::new(ctx),
            custody: option::none(),
        };
        let mut wrong_listing = PhysicalMarketTestListingV8 {
            id: object::new(ctx),
            custody: option::none(),
        };
        let wrong_listing_id = object::id(&wrong_listing);
        let ticket = custody_base_physical_for_market_v8<
            sui::sui::SUI,
            sui::sui::SUI,
            sui::sui::SUI,
            Coin<sui::sui::SUI>,
            Coin<sui::sui::SUI>,
        >(
            &fixture.physical_registry,
            &fixture.root,
            &fixture.protocol_config,
            &fixture.catalog,
            &fixture.physical_config,
            &fixture.market_call_cap,
            &fixture.market_registry,
            &fixture.market_treasury,
            &mut correct_listing.id,
            &fixture.maker_treasury,
            asset,
            ctx,
        );
        let mut custody = consume_physical_market_custody_ticket_v8(ticket);
        // Test-only mutation gets past the early listing readback check; the
        // Sui receive primitive must still reject the wrong real parent.
        custody.listing_id = wrong_listing_id;
        wrong_listing.custody = option::some(custody);
        transfer::share_object(correct_listing);
        transfer::share_object(wrong_listing);
        finish_active_physical_fixture(fixture, ctx);
        (asset_id, wrong_listing_id)
    };
    scenario.next_tx(seller);
    {
        let wrong_listing = scenario.take_shared_by_id<PhysicalMarketTestListingV8>(
            wrong_listing_id,
        );
        let receiving = sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id);
        return_test_market_asset(wrong_listing, receiving);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun cross_transaction_wrong_receiving_asset_is_rejected() {
    let seller = @0xA11;
    let mut scenario = sui::test_scenario::begin(seller);
    let wrong_asset_id = {
        let ctx = scenario.ctx();
        let mut fixture = new_active_physical_fixture(
            ISSUE_FREE_CLAIM, PROOF_NONE, 0, 3, true, ctx,
        );
        let asset = issue_transferable_base_physical_for_market_testing(
            &mut fixture.physical_registry,
            ctx,
        );
        let wrong_asset = issue_transferable_base_physical_for_market_testing(
            &mut fixture.physical_registry,
            ctx,
        );
        let wrong_asset_id = object::id(&wrong_asset);
        let mut listing = PhysicalMarketTestListingV8 {
            id: object::new(ctx),
            custody: option::none(),
        };
        let listing_id = object::id(&listing);
        let ticket = custody_base_physical_for_market_v8<
            sui::sui::SUI,
            sui::sui::SUI,
            sui::sui::SUI,
            Coin<sui::sui::SUI>,
            Coin<sui::sui::SUI>,
        >(
            &fixture.physical_registry,
            &fixture.root,
            &fixture.protocol_config,
            &fixture.catalog,
            &fixture.physical_config,
            &fixture.market_call_cap,
            &fixture.market_registry,
            &fixture.market_treasury,
            &mut listing.id,
            &fixture.maker_treasury,
            asset,
            ctx,
        );
        listing.custody = option::some(
            consume_physical_market_custody_ticket_v8(ticket),
        );
        transfer::transfer(wrong_asset, listing_id.to_address());
        transfer::share_object(listing);
        finish_active_physical_fixture(fixture, ctx);
        wrong_asset_id
    };
    scenario.next_tx(seller);
    {
        let listing = scenario.take_shared<PhysicalMarketTestListingV8>();
        let wrong_receiving =
            sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(wrong_asset_id);
        return_test_market_asset(listing, wrong_receiving);
    };
    scenario.end();
}

#[test, expected_failure(abort_code = EInvalidRecipient)]
fun cross_transaction_seller_cannot_purchase_own_custodied_asset() {
    let seller = @0xA11;
    let mut scenario = sui::test_scenario::begin(seller);
    let asset_id = {
        let ctx = scenario.ctx();
        let mut fixture = new_active_physical_fixture(
            ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, ctx,
        );
        let asset = issue_transferable_base_physical_for_market_testing(
            &mut fixture.physical_registry,
            ctx,
        );
        let asset_id = object::id(&asset);
        let mut listing = PhysicalMarketTestListingV8 {
            id: object::new(ctx),
            custody: option::none(),
        };
        let ticket = custody_base_physical_for_market_v8<
            sui::sui::SUI,
            sui::sui::SUI,
            sui::sui::SUI,
            Coin<sui::sui::SUI>,
            Coin<sui::sui::SUI>,
        >(
            &fixture.physical_registry,
            &fixture.root,
            &fixture.protocol_config,
            &fixture.catalog,
            &fixture.physical_config,
            &fixture.market_call_cap,
            &fixture.market_registry,
            &fixture.market_treasury,
            &mut listing.id,
            &fixture.maker_treasury,
            asset,
            ctx,
        );
        listing.custody = option::some(
            consume_physical_market_custody_ticket_v8(ticket),
        );
        transfer::share_object(listing);
        finish_active_physical_fixture(fixture, ctx);
        asset_id
    };
    scenario.next_tx(seller);
    {
        let listing = scenario.take_shared<PhysicalMarketTestListingV8>();
        let receiving = sui::test_scenario::receiving_ticket_by_id<PhysicalAssetV8>(asset_id);
        purchase_test_market_asset(listing, receiving, scenario.ctx());
    };
    scenario.end();
}

#[test]
fun market_return_authority_survives_pause_archive_and_protocol_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 160, 0, 0, 0);
    let (mut fixture, listing, asset, custody) =
        new_base_market_binding_fixture(&mut ctx);
    maker::set_lifecycle_for_testing(&mut fixture.root, maker::lifecycle_paused_v8());
    let protocol_admin = &fixture.protocol_admin;
    protocol::set_protocol_enabled_v8(
        &mut fixture.protocol_config,
        protocol_admin,
        false,
    );
    assert_market_authority<
        sui::sui::SUI,
        sui::sui::SUI,
        sui::sui::SUI,
        Coin<sui::sui::SUI>,
        Coin<sui::sui::SUI>,
    >(
        &fixture.root,
        &fixture.catalog,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
    );
    assert_market_custody_live_binding(
        &fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
        &listing.id,
        &custody,
    );
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    maker::set_lifecycle_for_testing(&mut fixture.root, maker::lifecycle_archived_v8());
    assert_market_authority<
        sui::sui::SUI,
        sui::sui::SUI,
        sui::sui::SUI,
        Coin<sui::sui::SUI>,
        Coin<sui::sui::SUI>,
    >(
        &fixture.root,
        &fixture.catalog,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
    );
    assert_market_custody_live_binding(
        &fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
        &listing.id,
        &custody,
    );
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = ENotTransferable)]
fun market_custody_rejects_nontransferable_asset() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 161, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, false, &mut ctx,
    );
    let witness = base_selection_witness(&mut fixture, &ctx);
    let asset = claim_fixture_base_free(&mut fixture, witness, 0, &mut ctx);
    let mut listing = PhysicalMarketTestListingV8 {
        id: object::new(&mut ctx),
        custody: option::none(),
    };
    let ticket = custody_base_physical_for_market_v8<
        sui::sui::SUI,
        sui::sui::SUI,
        sui::sui::SUI,
        Coin<sui::sui::SUI>,
        Coin<sui::sui::SUI>,
    >(
        &fixture.physical_registry,
        &fixture.root,
        &fixture.protocol_config,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
        &mut listing.id,
        &fixture.maker_treasury,
        asset,
        &ctx,
    );
    let _binding = consume_physical_market_custody_ticket_v8(ticket);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun typed_base_custody_rejects_pack_source_substitution() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 162, 0, 0, 0);
    let mut fixture = new_active_physical_fixture(
        ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &mut ctx,
    );
    register_test_pack_policy(
        &mut fixture, 0, ISSUE_FREE_CLAIM, PROOF_NONE, 0, 2, true, &ctx,
    );
    let asset = issue_transferable_pack_physical_for_market_testing(
        &mut fixture.physical_registry,
        &mut ctx,
    );
    let mut listing = PhysicalMarketTestListingV8 {
        id: object::new(&mut ctx),
        custody: option::none(),
    };
    let ticket = custody_base_physical_for_market_v8<
        sui::sui::SUI,
        sui::sui::SUI,
        sui::sui::SUI,
        Coin<sui::sui::SUI>,
        Coin<sui::sui::SUI>,
    >(
        &fixture.physical_registry,
        &fixture.root,
        &fixture.protocol_config,
        &fixture.catalog,
        &fixture.physical_config,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
        &mut listing.id,
        &fixture.maker_treasury,
        asset,
        &ctx,
    );
    let _binding = consume_physical_market_custody_ticket_v8(ticket);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test]
fun market_custody_binding_exact_matrix_accepts_live_asset() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 170, 0, 0, 0);
    let (fixture, listing, asset, custody) = new_base_market_binding_fixture(&mut ctx);
    assert_market_custody_live_binding(
        &fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
        &listing.id,
        &custody,
    );
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_binding_version() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 171, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.version = 7;
    assert_market_custody_live_binding(
        &fixture.physical_registry,
        &fixture.root,
        &fixture.catalog,
        &fixture.market_call_cap,
        &fixture.market_registry,
        &fixture.market_treasury,
        &listing.id,
        &custody,
    );
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_asset_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 172, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.asset_id = object::id_from_address(@0xBAD);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_physical_registry() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 173, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.physical_registry_id = object::id_from_address(@0xBAD);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_root_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 174, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.root_id = object::id_from_address(@0xBAD);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_maker_version() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 175, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.maker_version = custody.maker_version + 1;
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_root_content() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 176, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.root_content_commitment = test_hash(201);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_source_kind() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 177, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.source_kind = SOURCE_PACK_STYLE;
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_source_identity() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 178, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.source_id = object::id_from_address(@0xBAD);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidMarketCustody)]
fun market_custody_rejects_wrong_source_content() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 179, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.source_content_commitment = test_hash(202);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidTreasury)]
fun market_custody_rejects_wrong_source_treasury() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 180, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.source_treasury_id = object::id_from_address(@0xBAD);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EWrongHolder)]
fun market_custody_rejects_wrong_stored_holder() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 181, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.holder = @0xB22;
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EStaleRevision)]
fun market_custody_rejects_wrong_ownership_epoch() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 182, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.ownership_epoch = custody.ownership_epoch + 1;
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = ENotTransferable)]
fun market_custody_rejects_wrong_transferable_readback() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 183, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.transferable = false;
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun market_custody_rejects_wrong_provenance() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 184, 0, 0, 0);
    let (fixture, listing, asset, mut custody) = new_base_market_binding_fixture(&mut ctx);
    custody.provenance_commitment = test_hash(203);
    assert_market_custody_asset(&custody, &fixture.root, &asset);
    destroy_asset_for_testing(asset);
    destroy_empty_test_market_listing(listing);
    finish_active_physical_fixture(fixture, &mut ctx)
}
