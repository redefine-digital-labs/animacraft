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
    PackageCallCapV8,
    PhysicalRoleV8,
    ProductReleaseCatalogV8,
};
use animacraft_v8_output::output_v8::{Self as output, PhysicalSelectionBindingV8};
use std::bcs;
use std::hash;
use std::option::Option;
use std::string::String;
use sui::event;
use sui::table::{Self as table, Table};

#[test_only]
use animacraft_v8_core::core_v8 as core;
#[test_only]
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
};
#[test_only]
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_POLICY_COUNT: u64 = 10_000;
const MAX_SUPPLY_PER_POLICY: u64 = 1_000_000_000;

const SOURCE_BASE_STYLE: u8 = 0;
const SOURCE_PACK_STYLE: u8 = 1;

const ISSUE_FREE_CLAIM: u8 = 0;
const ISSUE_PAID_PURCHASE: u8 = 1;
const ISSUE_PROOF_MATERIALIZE: u8 = 2;

const PROOF_NONE: u8 = 0;
const PROOF_CANONICAL_SOUL: u8 = 2;

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
    used_authorization_keys: vector<vector<u8>>,
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

public struct PhysicalRegistrySealedV8 has copy, drop {
    root_id: ID,
    registry_id: ID,
    base_policy_count: u64,
    base_policy_commitment: vector<u8>,
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
        used_authorization_keys: vector[],
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
    assert!(registry.used_authorization_keys.is_empty(), ERegistryNotReady);
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
        output::physical_selection_source_content_commitment_v8(selection)
            == &registry.root_content_commitment,
        EInvalidBinding,
    );
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
public fun policy_part_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.part_key }
public fun policy_item_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.item_key }
public fun policy_style_key_v8(policy: &PhysicalStylePolicyV8): &String { &policy.style_key }
public fun policy_layer_track_key_v8(policy: &PhysicalStylePolicyV8): &String {
    &policy.layer_track_key
}
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
public fun policy_row_commitment_v8(
    policy: &PhysicalStylePolicyV8,
): &vector<u8> { &policy.row_commitment }

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
        mut used_authorization_keys,
        mut used_authorizations,
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
    while (!used_authorization_keys.is_empty()) {
        let key = used_authorization_keys.pop_back();
        let _ = used_authorizations.remove(key);
    };
    used_authorization_keys.destroy_empty();
    used_authorizations.destroy_empty();
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
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun paid_policy_rejects_zero_price() {
    assert_policy_terms(ISSUE_PAID_PURCHASE, PROOF_NONE, 0, 1);
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun free_policy_rejects_nonzero_price() {
    assert_policy_terms(ISSUE_FREE_CLAIM, PROOF_NONE, 1, 1);
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun unknown_issuance_kind_is_rejected() {
    assert_policy_terms(99, PROOF_NONE, 0, 1);
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun proof_policy_rejects_missing_proof() {
    assert_policy_terms(ISSUE_PROOF_MATERIALIZE, PROOF_NONE, 0, 1);
    abort EInvalidPolicy
}

#[test, expected_failure(abort_code = EInvalidPolicy)]
fun supply_must_be_bounded_and_nonzero() {
    assert_policy_terms(ISSUE_FREE_CLAIM, PROOF_NONE, 0, 0);
    abort EInvalidPolicy
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
    abort EInvalidCommitment
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
    abort ERegistryNotSealed
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
    abort EInvalidCount
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
    abort EInvalidCommitment
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
    abort EInvalidSequence
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
    abort EDuplicatePolicy
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
    abort ERegistryNotReady
}
