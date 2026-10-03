/// Exact Sui Seal policy for fresh Animacraft v8 ciphertexts. The package
/// depends only on Core and the pinned Sui framework. Its entry functions are
/// the policy calls dry-run by Sui Seal key servers before releasing shares.
module animacraft_v8_seal::seal_v8;

use animacraft_v8_core::companion_binding_v2::{
    Self as companion, MakerRuntimeCompanionBindingBuilderV2,
};
use animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2;

/// Constructed only after this module validates its actual companion objects.
public struct MakerCompanionBindingWitnessV2 has drop {}

public fun bind_maker_seal_companion_v2<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    policy: &SealPolicyConfigV8,
    registry: &SealRegistryV8,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    maker::assert_companion_builder_root_v2(&builder, root, admin, ctx);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    package_binding::assert_replacement_current_v2(replacement, catalog);
    assert_catalog_root(catalog, root);
    assert_policy_root(policy, root);
    package_binding::assert_role_config_installation_v2(
        catalog, 1, object::id(policy), &policy.config_commitment);
    assert!(policy.finalized, EInvalidConfig);
    assert_registry_binding(registry, root, policy);
    assert!(registry.sealed, ERegistryNotSealed);
    assert_counts_exact(registry);
    assert!(registry.runtime_revision == 0 && registry.runtime_keys.is_empty(), EInvalidBinding);
    companion::append_seal_v2(builder, MakerCompanionBindingWitnessV2 {},
        protocol_config, catalog, replacement, object::id(registry), ctx)
}



use animacraft_v8_core::base_registry_v8 as base_registry;
use animacraft_v8_core::maker_v8::{Self as maker, MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as package_binding,
    ExactPackageBindingV8,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
    SealRoleV8,
};
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
};
use std::bcs;
use std::hash;
use std::string::{Self as string, String};
use std::type_name;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const SCHEMA_REVISION: u64 = 2;
const HASH_LENGTH: u64 = 32;
const MAX_KEY_SERVERS: u64 = 64;
// Seal encrypt requires expanded weighted shares and threshold strictly < 255.
const MAX_KEY_SHARES: u64 = 254;
const MAX_SCOPE_KEY_BYTES: u64 = 256;
const MAX_ASSET_KEY_BYTES: u64 = 512;
const MAX_BLOB_ID_BYTES: u64 = 512;
const MAX_PROTECTED_ASSETS: u64 = 100_000;
// Single supported profile for fresh initialization, matching both product SDKs.
const CIPHER_SUITE: vector<u8> = b"BonehFranklinBLS12381DemCCA/AesGcm256";
const KEY_DERIVATION: vector<u8> = b"SHA3-256:SUI-SEAL-IBE-BLS12381-H2-00:SUI-SEAL-IBE-BLS12381-H3-00";
const CIPHERTEXT_FORMAT: vector<u8> = b"Seal/EncryptedObject/BCS/v0";
const MAX_PLAINTEXT_BYTES: u64 = 3 * 1024 * 1024;

const SCOPE_BASE: u8 = 0;
const SCOPE_PACK: u8 = 1;
const SCOPE_COMPLETE: u8 = 2;

const EInvalidConfig: u64 = 0;
const EInvalidBinding: u64 = 1;
const EInvalidCommitment: u64 = 2;
const EInvalidKeyServers: u64 = 3;
const EInvalidScope: u64 = 4;
const EInvalidKey: u64 = 5;
const EInvalidCount: u64 = 6;
const EInvalidSequence: u64 = 7;
const EDuplicateAsset: u64 = 8;
const ERegistrySealed: u64 = 9;
const ERegistryNotSealed: u64 = 10;
const EAssetMissing: u64 = 11;
const ENoAccess: u64 = 12;
const EInvalidProof: u64 = 13;
const EInvalidLifecycle: u64 = 14;
const ECatalogMismatch: u64 = 15;

/// Stable type-origin marker used by a Core-certified product binding.
public struct SealOriginalMarkerV8 has drop {}

/// Exact callable marker. On upgrade its defining package must be the callable
/// package frozen in the Core catalog while its original lineage stays fixed.
public struct SealCallableMarkerV8 has drop {}

/// Private-construction witness consumed by Core in the same call that
/// creates and commits the Seal role config.
public struct SealSetupInstallWitnessV2 has drop {}

#[test_only]
public struct WrongSealSetupInstallWitnessV2 has drop {}

public struct KeyServerRowV2 has copy, drop, store {
    key_server_id: ID,
    weight: u16,
}

/// Immutable key-server and encryption-policy configuration. No mutator is
/// exposed; a policy change requires a new certified product release/config.
public struct SealPolicyConfigV8 has key {
    id: UID,
    version: u64,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    seal_original_package_id: ID,
    seal_callable_package_id: ID,
    seal_binding_commitment: vector<u8>,
    seal_authority_id: ID,
    call_cap_set_commitment: vector<u8>,
    role: u8,
    finalized: bool,
    key_servers: vector<KeyServerRowV2>,
    threshold: u16,
    cipher_suite: String,
    key_derivation: String,
    ciphertext_format: String,
    max_plaintext_bytes: u64,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
    commitment: vector<u8>,
    config_commitment: vector<u8>,
}

public struct ProtectedAssetKeyV8 has copy, drop, store {
    scope_kind: u8,
    scope_key: String,
    asset_key: String,
}

public struct ProtectedAssetV8 has copy, drop, store {
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
}

/// Complete immutable readback used by Runtime/Output selection validation.
/// It grants no decryption authority.
public struct ProtectedAssetSnapshotV8 has copy, drop, store {
    registry_id: ID,
    registry_commitment: vector<u8>,
    runtime_revision: u64,
    runtime_commitment: vector<u8>,
    policy_config_id: ID,
    policy_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
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
}

/// Exactly one immutable DRAFT-built registry for a Maker. A zero-row Maker
/// still creates and explicitly seals this object with the domain-separated
/// empty commitment.
public struct SealRegistryV8 has key {
    id: UID,
    version: u64,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    policy_config_id: ID,
    policy_commitment: vector<u8>,
    expected_base_count: u64,
    expected_pack_count: u64,
    expected_complete_count: u64,
    base_count: u64,
    pack_count: u64,
    complete_count: u64,
    base_commitment: vector<u8>,
    pack_commitment: vector<u8>,
    complete_commitment: vector<u8>,
    revision: u64,
    commitment: vector<u8>,
    sealed: bool,
    keys: vector<ProtectedAssetKeyV8>,
    assets: Table<ProtectedAssetKeyV8, ProtectedAssetV8>,
    runtime_revision: u64,
    runtime_keys: vector<ProtectedAssetKeyV8>,
    runtime_assets: Table<ProtectedAssetKeyV8, ProtectedAssetV8>,
}

/// Exact transport certification minted only through the catalog-frozen
/// Release authority. It cannot be copied, dropped, or stored.
public struct CiphertextCertificationV8 {
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    policy_config_id: ID,
    policy_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
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
}

/// Transaction-local proof that the exact holder owns/holds the Maker access
/// entitlement reread by the catalog-frozen Runtime authority.
public struct BaseDecryptProofV8 {
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    entitlement_id: ID,
    entitlement_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    seal_id: vector<u8>,
}

/// Transaction-local proof of both base and exact Pack entitlement.
public struct PackDecryptProofV8 {
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    base_entitlement_id: ID,
    base_entitlement_commitment: vector<u8>,
    pack_entitlement_id: ID,
    pack_entitlement_commitment: vector<u8>,
    pack_release_id: ID,
    pack_content_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    seal_id: vector<u8>,
}

/// Transaction-local proof of an exact Complete/Soul ownership receipt. The
/// recipe, render, output, and receipt commitments are all bound.
public struct CompleteDecryptProofV8 {
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    holder: address,
    receipt_id: ID,
    output_id: ID,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    seal_id: vector<u8>,
}

public struct KeyServerSetCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    ordered_key_servers: vector<KeyServerRowV2>,
    threshold: u16,
}

public struct EncryptionPolicyCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    cipher_suite: String,
    key_derivation: String,
    ciphertext_format: String,
    max_plaintext_bytes: u64,
}

public struct SealPolicyCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    policy_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
}

public struct SealRegistryCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    policy_id: ID,
    base_count: u64,
    pack_count: u64,
    complete_count: u64,
    base_commitment: vector<u8>,
    pack_commitment: vector<u8>,
    complete_commitment: vector<u8>,
    revision: u64,
    sealed: bool,
}

public struct CiphertextCertificationCommitmentInputV2 has drop {
    domain: String, schema_revision: u64, catalog_id: ID,
    product_binding_commitment: vector<u8>, policy_commitment: vector<u8>,
    root_content_commitment: vector<u8>, maker_version: u64, scope_kind: u8,
    scope_key: String, scope_commitment: vector<u8>, asset_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
}

public struct SealIdInputV2 has drop {
    domain: String, schema_revision: u64, product_binding_commitment: vector<u8>,
    policy_commitment: vector<u8>, root_content_commitment: vector<u8>,
    maker_version: u64, scope_kind: u8, scope_key: String,
    asset_key: String,
}

public struct CompleteInstanceCommitmentInputV2 has drop {
    domain: String, schema_revision: u64, recipe_commitment: vector<u8>,
    render_commitment: vector<u8>, output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
}

public struct SealPolicyCreatedV8 has copy, drop {
    config_id: ID, catalog_id: ID, threshold: u16,
    key_server_set_commitment: vector<u8>, commitment: vector<u8>,
}

public struct ProtectedAssetAppendedV8 has copy, drop {
    registry_id: ID, root_id: ID, sequence: u64, scope_kind: u8,
    seal_id: vector<u8>, rolling_commitment: vector<u8>,
}

public struct SealRegistrySealedV8 has copy, drop {
    registry_id: ID, root_id: ID, total_count: u64,
    commitment: vector<u8>,
}

public struct RuntimeProtectedAssetRegisteredV8 has copy, drop {
    registry_id: ID, root_id: ID, previous_revision: u64,
    new_revision: u64, scope_kind: u8, seal_id: vector<u8>,
    runtime_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }
public fun scope_base_v8(): u8 { SCOPE_BASE }
public fun scope_pack_v8(): u8 { SCOPE_PACK }
public fun scope_complete_v8(): u8 { SCOPE_COMPLETE }

public fun new_seal_policy_config_v8(
    protocol_config: &ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
    seal_call_cap: PackageCallCapV8<SealRoleV8>,
    key_server_ids: vector<ID>,
    weights: vector<u16>,
    threshold: u16,
    cipher_suite: String,
    key_derivation: String,
    ciphertext_format: String,
    max_plaintext_bytes: u64,
    ctx: &mut TxContext,
): SealPolicyConfigV8 {
    protocol::assert_protocol_admin_v8(protocol_config, protocol_admin);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    let product = package_binding::catalog_binding_v8(catalog);
    let seal = package_binding::binding_at_v2(product, 1);
    let setup_module = b"seal_v8";
    let setup_datatype = b"SealSetupInstallWitnessV2";
    package_binding::assert_exact_witness_type_v2<SealSetupInstallWitnessV2>(
        seal, &setup_module, &setup_datatype);
    let key_servers = validate_key_servers(key_server_ids, weights, threshold);
    let key_server_set_commitment = derive_key_server_set_commitment(
        key_servers, threshold);
    let encryption_policy_commitment = derive_encryption_policy_commitment(
        cipher_suite, key_derivation, ciphertext_format,
        max_plaintext_bytes);
    let protocol_config_id = protocol::config_id_v8(protocol_config);
    let protocol_config_revision = protocol::config_revision_v8(protocol_config);
    let catalog_id = package_binding::catalog_id_v8(catalog);
    let product_binding_commitment = *package_binding::product_binding_commitment_v8(product);
    let (seal_original_package_id, seal_callable_package_id, _, _, _,
        seal_binding_commitment_ref) =
        package_binding::exact_binding_terms_v2(seal);
    let seal_binding_commitment = *seal_binding_commitment_ref;
    let seal_authority_id = package_binding::catalog_authority_id_v2(catalog, 0);
    let (_, _, _, _, call_cap_set_commitment_ref, _) =
        package_binding::catalog_terms_v2(catalog);
    let call_cap_set_commitment = *call_cap_set_commitment_ref;
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    let commitment = derive_policy_commitment(
        config_id, catalog_id, product_binding_commitment,
        call_cap_set_commitment, key_server_set_commitment,
        encryption_policy_commitment);
    let config_commitment = package_binding::consume_seal_call_cap_v8(
        catalog, seal_call_cap, SealSetupInstallWitnessV2 {},
        config_id, commitment, key_server_set_commitment,
        encryption_policy_commitment);
    let result = SealPolicyConfigV8 {
        id: config_uid, version: VERSION, protocol_config_id,
        protocol_config_revision, catalog_id, product_binding_commitment,
        seal_original_package_id, seal_callable_package_id,
        seal_binding_commitment, seal_authority_id, call_cap_set_commitment,
        role: 1, finalized: true, key_servers, threshold,
        cipher_suite, key_derivation, ciphertext_format, max_plaintext_bytes,
        key_server_set_commitment, encryption_policy_commitment, commitment,
        config_commitment,
    };
    event::emit(SealPolicyCreatedV8 {
        config_id: object::id(&result), catalog_id, threshold,
        key_server_set_commitment, commitment,
    });
    result
}

public fun share_seal_policy_config_v8(config: SealPolicyConfigV8) {
    transfer::share_object(config);
}

/// Stable semantic instance key for protected Complete output. Receipt/output
/// object IDs remain exact proof fields, while the preimage uses commitments
/// that can be certified without a same-transaction object-ID fixed point.
public fun complete_instance_commitment_v8(
    recipe_commitment: vector<u8>, render_commitment: vector<u8>,
    output_commitment: vector<u8>, receipt_commitment: vector<u8>,
): vector<u8> {
    assert_hash(&recipe_commitment);
    assert_hash(&render_commitment);
    assert_hash(&output_commitment);
    assert_hash(&receipt_commitment);
    hash::sha2_256(bcs::to_bytes(&CompleteInstanceCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/seal/complete-instance/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        recipe_commitment, render_commitment, output_commitment,
        receipt_commitment,
    }))
}

public fun derive_ciphertext_certification_commitment_v8(
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    policy_commitment: vector<u8>,
    root_content_commitment: vector<u8>,
    maker_version: u64,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
): vector<u8> {
    assert_scope(scope_kind);
    assert_semantic_key(&scope_key, MAX_SCOPE_KEY_BYTES);
    assert_semantic_key(&asset_key, MAX_ASSET_KEY_BYTES);
    assert_non_empty_bounded(&ciphertext_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&product_binding_commitment);
    assert_hash(&policy_commitment);
    assert_hash(&root_content_commitment);
    assert_hash(&scope_commitment);
    assert_hash(&asset_content_commitment);
    assert_hash(&ciphertext_sha256);
    assert_hash(&ciphertext_blob_commitment);
    assert!(maker_version > 0, EInvalidBinding);
    hash::sha2_256(bcs::to_bytes(&CiphertextCertificationCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/seal/ciphertext-certification/v2"
            .to_string(),
        schema_revision: SCHEMA_REVISION,
        catalog_id, product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version, scope_kind, scope_key,
        scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment,
    }))
}

public fun derive_seal_id_v8(
    product_binding_commitment: vector<u8>,
    policy_commitment: vector<u8>,
    root_content_commitment: vector<u8>,
    maker_version: u64,
    scope_kind: u8,
    scope_key: String,
    asset_key: String,
): vector<u8> {
    assert_scope(scope_kind);
    assert_semantic_key(&scope_key, MAX_SCOPE_KEY_BYTES);
    assert_semantic_key(&asset_key, MAX_ASSET_KEY_BYTES);
    assert_hash(&product_binding_commitment);
    assert_hash(&policy_commitment);
    assert_hash(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&SealIdInputV2 {
        domain: b"animacraft-fresh-v8/seal/ciphertext-id/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version, scope_kind, scope_key,
        asset_key,
    }))
}

/// Release/transport calls this only after independently certifying the exact
/// ciphertext bytes and blob binding. The chain derives, rather than accepts,
/// both the certification commitment and Sui Seal identity.
public fun certify_ciphertext_v8<
    PaymentCoin,
    ReleaseOriginalMarker,
    ReleaseTransportWitness,
>(
    witness: ReleaseTransportWitness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    scope_kind: u8,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
): (ReleaseTransportWitness, CiphertextCertificationV8) {
    let lifecycle = maker::root_lifecycle_v8(root);
    assert!(lifecycle == maker::lifecycle_draft_v8()
        || lifecycle == maker::lifecycle_active_v8(), EInvalidLifecycle);
    maker::assert_current_protocol_config_v8(root, protocol_config);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    assert_role_witness<PaymentCoin, ReleaseOriginalMarker, ReleaseTransportWitness>(
        root, package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 6),
        b"release_v8", b"ReleaseOriginalMarkerV8",
        b"ReleaseTransportWitnessV8");
    assert_policy_root(policy, root);
    assert_catalog_root(catalog, root);
    let catalog_id = policy.catalog_id;
    let product_binding_commitment = policy.product_binding_commitment;
    let policy_commitment = policy.commitment;
    let root_id = maker::root_id_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let certification_commitment = derive_ciphertext_certification_commitment_v8(
        catalog_id, product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version, scope_kind, scope_key,
        scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment,
    );
    let seal_id = derive_seal_id_v8(
        product_binding_commitment, policy_commitment, root_content_commitment,
        maker_version, scope_kind, scope_key, asset_key,
    );
    (witness, CiphertextCertificationV8 {
        catalog_id, product_binding_commitment,
        policy_config_id: object::id(policy), policy_commitment, root_id,
        maker_version, root_content_commitment, scope_kind, scope_key,
        scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment,
        certification_commitment, seal_id,
    })
}

public fun new_seal_registry_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    policy: &SealPolicyConfigV8,
    expected_base_count: u64,
    expected_pack_count: u64,
    expected_complete_count: u64,
    ctx: &mut TxContext,
): SealRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_policy_root(policy, root);
    let expected_count = checked_total(expected_base_count, expected_pack_count, expected_complete_count);
    assert!(expected_count <= MAX_PROTECTED_ASSETS, EInvalidCount);
    let registry_uid = object::new(ctx);
    let registry_id = registry_uid.to_inner();
    let root_id = maker::root_id_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let policy_id = object::id(policy);
    let base_commitment = base_registry::registry_empty_commitment_v2(
        registry_id, root_id, maker_version, SCOPE_BASE);
    let pack_commitment = base_registry::registry_empty_commitment_v2(
        registry_id, root_id, maker_version, SCOPE_PACK);
    let complete_commitment = base_registry::registry_empty_commitment_v2(
        registry_id, root_id, maker_version, SCOPE_COMPLETE);
    let commitment = derive_registry_commitment(
        registry_id, root_id, maker_version, root_content_commitment,
        policy_id, 0, 0, 0, base_commitment, pack_commitment,
        complete_commitment, 0, false);
    SealRegistryV8 {
        id: registry_uid, version: VERSION, root_id,
        maker_version, root_content_commitment, catalog_id: policy.catalog_id,
        product_binding_commitment: policy.product_binding_commitment,
        policy_config_id: policy_id, policy_commitment: policy.commitment,
        expected_base_count, expected_pack_count, expected_complete_count,
        base_count: 0, pack_count: 0, complete_count: 0,
        base_commitment, pack_commitment, complete_commitment,
        revision: 0, commitment, sealed: false,
        keys: vector[], assets: table::new(ctx), runtime_revision: 0,
        runtime_keys: vector[], runtime_assets: table::new(ctx),
    }
}

public fun share_seal_registry_v8(registry: SealRegistryV8) {
    transfer::share_object(registry);
}

fun advance_scope_commitment(
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    scope_kind: u8,
    sequence: u64,
    prior_commitment: vector<u8>,
    row: ProtectedAssetV8,
): vector<u8> {
    assert_scope(scope_kind);
    assert!(row.scope_kind == scope_kind, EInvalidScope);
    assert_hash(&prior_commitment);
    assert_valid_row(&row);
    let row_commitment = base_registry::registry_row_commitment_v2(
        registry_id, root_id, maker_version, scope_kind, sequence,
        bcs::to_bytes(&row));
    base_registry::registry_advance_commitment_v2(
        registry_id, scope_kind, sequence, prior_commitment, row_commitment)
}

fun derive_registry_commitment(
    registry_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    policy_id: ID,
    base_count: u64,
    pack_count: u64,
    complete_count: u64,
    base_commitment: vector<u8>,
    pack_commitment: vector<u8>,
    complete_commitment: vector<u8>,
    revision: u64,
    sealed: bool,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert_hash(&base_commitment);
    assert_hash(&pack_commitment);
    assert_hash(&complete_commitment);
    hash::sha2_256(bcs::to_bytes(&SealRegistryCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/seal/registry/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        registry_id,
        root_id,
        maker_version,
        root_content_commitment,
        policy_id,
        base_count,
        pack_count,
        complete_count,
        base_commitment,
        pack_commitment,
        complete_commitment,
        revision,
        sealed,
    }))
}

fun refresh_registry_commitment(registry: &mut SealRegistryV8) {
    registry.commitment = derive_registry_commitment(
        object::id(registry),
        registry.root_id,
        registry.maker_version,
        registry.root_content_commitment,
        registry.policy_config_id,
        registry.base_count,
        registry.pack_count,
        registry.complete_count,
        registry.base_commitment,
        registry.pack_commitment,
        registry.complete_commitment,
        registry.revision,
        registry.sealed,
    );
}

public fun append_protected_asset_v8<PaymentCoin>(
    registry: &mut SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    policy: &SealPolicyConfigV8,
    sequence: u64,
    certification: CiphertextCertificationV8,
): vector<u8> {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root, policy);
    assert!(!registry.sealed, ERegistrySealed);
    let observed_count = checked_total(
        registry.base_count, registry.pack_count, registry.complete_count);
    let expected_count = checked_total(
        registry.expected_base_count,
        registry.expected_pack_count,
        registry.expected_complete_count);
    assert!(sequence == observed_count, EInvalidSequence);
    assert!(sequence < expected_count, EInvalidCount);
    let row = consume_certification(certification, registry, policy);
    assert_scope_count_available(registry, row.scope_kind);
    let key = ProtectedAssetKeyV8 {
        scope_kind: row.scope_kind, scope_key: row.scope_key, asset_key: row.asset_key,
    };
    assert!(!registry.assets.contains(key), EDuplicateAsset);
    let prior = if (row.scope_kind == SCOPE_BASE) registry.base_commitment
        else if (row.scope_kind == SCOPE_PACK) registry.pack_commitment
        else registry.complete_commitment;
    let next = advance_scope_commitment(
        object::id(registry), registry.root_id, registry.maker_version,
        row.scope_kind, sequence, prior, row);
    let seal_id = row.seal_id;
    let scope_kind = row.scope_kind;
    registry.assets.add(key, row);
    registry.keys.push_back(key);
    if (scope_kind == SCOPE_BASE) {
        registry.base_count = registry.base_count + 1;
        registry.base_commitment = next;
    } else if (scope_kind == SCOPE_PACK) {
        registry.pack_count = registry.pack_count + 1;
        registry.pack_commitment = next;
    } else {
        registry.complete_count = registry.complete_count + 1;
        registry.complete_commitment = next;
    };
    refresh_registry_commitment(registry);
    event::emit(ProtectedAssetAppendedV8 {
        registry_id: object::id(registry), root_id: registry.root_id,
        sequence, scope_kind, seal_id, rolling_commitment: next,
    });
    seal_id
}

public fun seal_registry_v8<PaymentCoin>(
    registry: &mut SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    policy: &SealPolicyConfigV8,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert_registry_binding(registry, root, policy);
    assert!(!registry.sealed, ERegistrySealed);
    assert_counts_exact(registry);
    registry.sealed = true;
    refresh_registry_commitment(registry);
    event::emit(SealRegistrySealedV8 {
        registry_id: object::id(registry), root_id: registry.root_id,
        total_count: checked_total(
            registry.base_count, registry.pack_count, registry.complete_count),
        commitment: registry.commitment,
    });
}

/// Post-activation Pack ciphertext registration. Runtime must reread the
/// exact admitted Pack and use its catalog-frozen nested authority; Release
/// must already have certified the transport bytes into `certification`.
public fun register_pack_ciphertext_v8<
    PaymentCoin,
    RuntimeOriginalMarker,
    RuntimeRegistrationWitness,
>(
    witness: RuntimeRegistrationWitness,
    registry: &mut SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    policy: &SealPolicyConfigV8,
    catalog: &ProductReleaseCatalogV8,
    expected_revision: u64,
    certification: CiphertextCertificationV8,
): (RuntimeRegistrationWitness, vector<u8>) {
    assert_catalog_root(catalog, root);
    assert_role_witness<PaymentCoin, RuntimeOriginalMarker, RuntimeRegistrationWitness>(
        root, package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 2),
        b"runtime_v8", b"RuntimeOriginalMarkerV8",
        b"RuntimePackRegistrationWitnessV8");
    (witness, register_runtime_asset(registry, root, policy, expected_revision,
        certification, SCOPE_PACK))
}

/// Post-activation Complete ciphertext registration. Release can statically
/// verify Output's exact receipt and holds the frozen private authority.
public fun register_complete_ciphertext_v8<
    PaymentCoin,
    ReleaseOriginalMarker,
    ReleaseRegistrationWitness,
>(
    witness: ReleaseRegistrationWitness,
    registry: &mut SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    policy: &SealPolicyConfigV8,
    catalog: &ProductReleaseCatalogV8,
    expected_revision: u64,
    certification: CiphertextCertificationV8,
): (ReleaseRegistrationWitness, vector<u8>) {
    assert_catalog_root(catalog, root);
    assert_role_witness<PaymentCoin, ReleaseOriginalMarker, ReleaseRegistrationWitness>(
        root, package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 6),
        b"release_v8", b"ReleaseOriginalMarkerV8",
        b"ReleaseTransportWitnessV8");
    (witness, register_runtime_asset(registry, root, policy, expected_revision,
        certification, SCOPE_COMPLETE))
}

/// Core-catalog-frozen Runtime authority converts a live exact base
/// entitlement readback into a transaction-local Seal proof.
public fun certify_base_entitlement_v8<
    PaymentCoin,
    RuntimeOriginalMarker,
    RuntimeEntitlementWitness,
>(
    witness: RuntimeEntitlementWitness,
    catalog: &ProductReleaseCatalogV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
    entitlement_id: ID,
    entitlement_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    seal_id: vector<u8>,
): (RuntimeEntitlementWitness, BaseDecryptProofV8) {
    assert_catalog_root(catalog, root);
    assert_role_witness<PaymentCoin, RuntimeOriginalMarker, RuntimeEntitlementWitness>(
        root, package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 2),
        b"runtime_v8", b"RuntimeOriginalMarkerV8",
        b"RuntimeBaseEntitlementWitnessV8");
    assert_holder_and_proof_fields(holder, &entitlement_commitment, &scope_key, &asset_key, &seal_id);
    (witness, BaseDecryptProofV8 {
        root_id: maker::root_id_v8(root), maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root), holder,
        entitlement_id, entitlement_commitment, scope_key, asset_key, seal_id,
    })
}

public fun certify_pack_entitlement_v8<
    PaymentCoin,
    RuntimeOriginalMarker,
    RuntimeEntitlementWitness,
>(
    witness: RuntimeEntitlementWitness,
    catalog: &ProductReleaseCatalogV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
    base_entitlement_id: ID,
    base_entitlement_commitment: vector<u8>,
    pack_entitlement_id: ID,
    pack_entitlement_commitment: vector<u8>,
    pack_release_id: ID,
    pack_content_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    seal_id: vector<u8>,
): (RuntimeEntitlementWitness, PackDecryptProofV8) {
    assert_catalog_root(catalog, root);
    assert_role_witness<PaymentCoin, RuntimeOriginalMarker, RuntimeEntitlementWitness>(
        root, package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 2),
        b"runtime_v8", b"RuntimeOriginalMarkerV8",
        b"RuntimePackEntitlementWitnessV8");
    assert_holder_and_proof_fields(holder, &base_entitlement_commitment, &scope_key, &asset_key, &seal_id);
    assert_hash(&pack_entitlement_commitment);
    assert_hash(&pack_content_commitment);
    (witness, PackDecryptProofV8 {
        root_id: maker::root_id_v8(root), maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root), holder,
        base_entitlement_id, base_entitlement_commitment, pack_entitlement_id,
        pack_entitlement_commitment, pack_release_id, pack_content_commitment,
        scope_key, asset_key, seal_id,
    })
}

/// The exact Release authority is used because Release can statically verify
/// Output's receipt while Seal cannot import Output without creating a cycle.
public fun certify_complete_receipt_v8<
    PaymentCoin,
    ReleaseOriginalMarker,
    ReleaseReceiptWitness,
>(
    witness: ReleaseReceiptWitness,
    catalog: &ProductReleaseCatalogV8,
    root: &MakerRootV8<PaymentCoin>,
    holder: address,
    receipt_id: ID,
    output_id: ID,
    recipe_commitment: vector<u8>,
    render_commitment: vector<u8>,
    output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    seal_id: vector<u8>,
): (ReleaseReceiptWitness, CompleteDecryptProofV8) {
    assert_catalog_root(catalog, root);
    assert_role_witness<PaymentCoin, ReleaseOriginalMarker, ReleaseReceiptWitness>(
        root, package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 6),
        b"release_v8", b"ReleaseOriginalMarkerV8",
        b"ReleaseTransportWitnessV8");
    assert_holder_and_proof_fields(holder, &receipt_commitment, &scope_key, &asset_key, &seal_id);
    assert_hash(&recipe_commitment);
    assert_hash(&render_commitment);
    assert_hash(&output_commitment);
    (witness, CompleteDecryptProofV8 {
        root_id: maker::root_id_v8(root), maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root), holder,
        receipt_id, output_id, recipe_commitment, render_commitment,
        output_commitment, receipt_commitment, scope_key, asset_key, seal_id,
    })
}

/// Consumes the exact Complete proof only after re-running Seal's live
/// registry/policy/root/holder access check. All instance fields come back
/// from the proof itself so Output can compare them with its private pending
/// objects; caller-supplied expected fields never become Seal authority.
public fun consume_complete_decrypt_proof_v8<PaymentCoin>(
    id: vector<u8>,
    registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    proof: CompleteDecryptProofV8,
    ctx: &TxContext,
): (ID, ID, vector<u8>, vector<u8>, vector<u8>, vector<u8>, String, String, vector<u8>) {
    assert!(check_complete_access(
        registry,
        policy,
        root,
        &proof,
        ctx.sender(),
        &id,
    ), ENoAccess);
    let CompleteDecryptProofV8 {
        root_id: _,
        maker_version: _,
        root_content_commitment: _,
        holder: _,
        receipt_id,
        output_id,
        recipe_commitment,
        render_commitment,
        output_commitment,
        receipt_commitment,
        scope_key,
        asset_key,
        seal_id,
    } = proof;
    assert!(seal_id == id, EInvalidProof);
    (receipt_id, output_id, recipe_commitment, render_commitment,
        output_commitment, receipt_commitment, scope_key, asset_key, seal_id)
}

/// Release creates and consumes this proof inside its single Seal approval
/// entry. A transaction-local proof is not a key-server PTB input.
public fun consume_base_decrypt_proof_v8<PaymentCoin>(
    id: vector<u8>, registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
    proof: BaseDecryptProofV8, ctx: &TxContext,
) {
    assert!(check_base_access(registry, policy, root, &proof, ctx.sender(), &id), ENoAccess);
    let BaseDecryptProofV8 { root_id: _, maker_version: _, root_content_commitment: _,
        holder: _, entitlement_id: _, entitlement_commitment: _, scope_key: _,
        asset_key: _, seal_id: _ } = proof;
}

public fun consume_pack_decrypt_proof_v8<PaymentCoin>(
    id: vector<u8>, registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
    proof: PackDecryptProofV8, ctx: &TxContext,
) {
    assert!(check_pack_access(registry, policy, root, &proof, ctx.sender(), &id), ENoAccess);
    let PackDecryptProofV8 { root_id: _, maker_version: _, root_content_commitment: _,
        holder: _, base_entitlement_id: _, base_entitlement_commitment: _,
        pack_entitlement_id: _, pack_entitlement_commitment: _, pack_release_id: _,
        pack_content_commitment: _, scope_key: _, asset_key: _, seal_id: _ } = proof;
}

/// Exact protected-row readback for Runtime/Output. The returned value is a
/// complete immutable snapshot, not an entitlement or decrypt approval.
public fun protected_asset_snapshot_v8<PaymentCoin>(
    registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
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
): ProtectedAssetSnapshotV8 {
    assert_registry_binding(registry, root, policy);
    assert!(registry.sealed, ERegistryNotSealed);
    let key = ProtectedAssetKeyV8 { scope_kind, scope_key, asset_key };
    let row = if (registry.assets.contains(key)) registry.assets.borrow(key)
        else {
            assert!(registry.runtime_assets.contains(key), EAssetMissing);
            registry.runtime_assets.borrow(key)
        };
    assert!(row.scope_commitment == scope_commitment, EInvalidCommitment);
    assert!(row.asset_content_commitment == asset_content_commitment, EInvalidCommitment);
    assert!(row.ciphertext_blob_id == ciphertext_blob_id, EInvalidCommitment);
    assert!(row.ciphertext_sha256 == ciphertext_sha256, EInvalidCommitment);
    assert!(row.ciphertext_blob_commitment == ciphertext_blob_commitment, EInvalidCommitment);
    assert!(row.certification_commitment == certification_commitment, EInvalidCommitment);
    assert!(row.seal_id == seal_id, EInvalidCommitment);
    assert!(seal_id == derive_seal_id_v8(
        registry.product_binding_commitment, registry.policy_commitment,
        registry.root_content_commitment, registry.maker_version,
        row.scope_kind, row.scope_key, row.asset_key), EInvalidCommitment);
    ProtectedAssetSnapshotV8 {
        registry_id: object::id(registry),
        registry_commitment: registry.commitment,
        runtime_revision: registry.runtime_revision,
        runtime_commitment: registry.commitment,
        policy_config_id: object::id(policy), policy_commitment: policy.commitment,
        root_id: registry.root_id, maker_version: registry.maker_version,
        root_content_commitment: registry.root_content_commitment,
        scope_kind: row.scope_kind, scope_key: row.scope_key,
        scope_commitment: row.scope_commitment, asset_key: row.asset_key,
        asset_content_commitment: row.asset_content_commitment,
        ciphertext_blob_id: row.ciphertext_blob_id,
        ciphertext_sha256: row.ciphertext_sha256,
        ciphertext_blob_commitment: row.ciphertext_blob_commitment,
        certification_commitment: row.certification_commitment,
        seal_id: row.seal_id,
    }
}

fun check_base_access<PaymentCoin>(
    registry: &SealRegistryV8, policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>, proof: &BaseDecryptProofV8,
    holder: address, id: &vector<u8>,
): bool {
    if (!approval_registry_valid(registry, policy, root)) return false;
    if (!proof_root_matches(root, proof.root_id, proof.maker_version, &proof.root_content_commitment)) return false;
    if (holder == @0x0 || proof.holder != holder || &proof.seal_id != id) return false;
    if (proof.entitlement_commitment.length() != HASH_LENGTH) return false;
    row_matches(registry, SCOPE_BASE, proof.scope_key, proof.asset_key, id, id, 0)
}

fun check_pack_access<PaymentCoin>(
    registry: &SealRegistryV8, policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>, proof: &PackDecryptProofV8,
    holder: address, id: &vector<u8>,
): bool {
    if (!approval_registry_valid(registry, policy, root)) return false;
    if (!proof_root_matches(root, proof.root_id, proof.maker_version, &proof.root_content_commitment)) return false;
    if (holder == @0x0 || proof.holder != holder || &proof.seal_id != id) return false;
    if (proof.base_entitlement_commitment.length() != HASH_LENGTH
        || proof.pack_entitlement_commitment.length() != HASH_LENGTH
        || proof.pack_content_commitment.length() != HASH_LENGTH) return false;
    row_matches(registry, SCOPE_PACK, proof.scope_key, proof.asset_key, id,
        &proof.pack_content_commitment, 1)
}

fun check_complete_access<PaymentCoin>(
    registry: &SealRegistryV8, policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>, proof: &CompleteDecryptProofV8,
    holder: address, id: &vector<u8>,
): bool {
    if (!approval_registry_valid(registry, policy, root)) return false;
    if (!proof_root_matches(root, proof.root_id, proof.maker_version, &proof.root_content_commitment)) return false;
    if (holder == @0x0 || proof.holder != holder || &proof.seal_id != id) return false;
    if (proof.recipe_commitment.length() != HASH_LENGTH
        || proof.render_commitment.length() != HASH_LENGTH
        || proof.output_commitment.length() != HASH_LENGTH
        || proof.receipt_commitment.length() != HASH_LENGTH) return false;
    let instance_commitment = complete_instance_commitment_v8(
        proof.recipe_commitment, proof.render_commitment,
        proof.output_commitment, proof.receipt_commitment);
    row_matches(registry, SCOPE_COMPLETE, proof.scope_key, proof.asset_key, id,
        &instance_commitment, 3)
}

fun row_matches(
    registry: &SealRegistryV8, scope_kind: u8, scope_key: String,
    asset_key: String, id: &vector<u8>, expected_scope_or_asset: &vector<u8>,
    expected_kind: u8,
): bool {
    let key = ProtectedAssetKeyV8 { scope_kind, scope_key, asset_key };
    if (registry.assets.contains(key)) {
        return protected_row_matches(registry.assets.borrow(key), registry,
            id, expected_scope_or_asset, expected_kind)
    };
    if (!registry.runtime_assets.contains(key)) return false;
    protected_row_matches(registry.runtime_assets.borrow(key), registry,
        id, expected_scope_or_asset, expected_kind)
}

fun protected_row_matches(
    row: &ProtectedAssetV8, registry: &SealRegistryV8,
    id: &vector<u8>, expected_scope_or_asset: &vector<u8>, expected_kind: u8,
): bool {
    if (&row.seal_id != id) return false;
    if (expected_kind == 1 && &row.scope_commitment != expected_scope_or_asset) return false;
    if (expected_kind == 2 && &row.asset_content_commitment != expected_scope_or_asset) return false;
    if (expected_kind == 3 && &row.scope_commitment != expected_scope_or_asset) return false;
    row.seal_id == derive_seal_id_v8(
        registry.product_binding_commitment, registry.policy_commitment,
        registry.root_content_commitment, registry.maker_version,
        row.scope_kind, row.scope_key, row.asset_key,
    )
}

fun register_runtime_asset<PaymentCoin>(
    registry: &mut SealRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    policy: &SealPolicyConfigV8,
    expected_revision: u64,
    certification: CiphertextCertificationV8,
    required_scope: u8,
): vector<u8> {
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(), EInvalidLifecycle);
    assert_registry_binding(registry, root, policy);
    assert!(registry.sealed, ERegistryNotSealed);
    assert!(registry.runtime_revision == expected_revision, EInvalidSequence);
    let row = consume_certification(certification, registry, policy);
    assert!(row.scope_kind == required_scope, EInvalidScope);
    let key = ProtectedAssetKeyV8 {
        scope_kind: row.scope_kind, scope_key: row.scope_key, asset_key: row.asset_key,
    };
    assert!(!registry.assets.contains(key) && !registry.runtime_assets.contains(key), EDuplicateAsset);
    let scope_kind = row.scope_kind;
    let prior = if (scope_kind == SCOPE_BASE) registry.base_commitment
        else if (scope_kind == SCOPE_PACK) registry.pack_commitment
        else registry.complete_commitment;
    let sequence = checked_total(
        registry.base_count, registry.pack_count, registry.complete_count);
    let next = advance_scope_commitment(
        object::id(registry), registry.root_id, registry.maker_version,
        scope_kind, sequence, prior, row);
    let seal_id = row.seal_id;
    registry.runtime_assets.add(key, row);
    registry.runtime_keys.push_back(key);
    registry.runtime_revision = expected_revision + 1;
    registry.revision = registry.runtime_revision;
    if (scope_kind == SCOPE_BASE) {
        registry.base_count = registry.base_count + 1;
        registry.base_commitment = next;
    } else if (scope_kind == SCOPE_PACK) {
        registry.pack_count = registry.pack_count + 1;
        registry.pack_commitment = next;
    } else {
        registry.complete_count = registry.complete_count + 1;
        registry.complete_commitment = next;
    };
    refresh_registry_commitment(registry);
    event::emit(RuntimeProtectedAssetRegisteredV8 {
        registry_id: object::id(registry), root_id: registry.root_id,
        previous_revision: expected_revision, new_revision: expected_revision + 1,
        scope_kind, seal_id, runtime_commitment: registry.commitment,
    });
    seal_id
}

fun approval_registry_valid<PaymentCoin>(
    registry: &SealRegistryV8, policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
): bool {
    let lifecycle = maker::root_lifecycle_v8(root);
    lifecycle != maker::lifecycle_draft_v8()
        && (lifecycle == maker::lifecycle_active_v8()
            || lifecycle == maker::lifecycle_paused_v8()
            || lifecycle == maker::lifecycle_archived_v8())
        && registry.sealed
        && registry_binding_matches(registry, root, policy)
        && registry.base_count == registry.expected_base_count
        && registry.pack_count >= registry.expected_pack_count
        && registry.complete_count >= registry.expected_complete_count
        && registry.revision == registry.runtime_revision
        && registry.commitment == derive_registry_commitment(
            object::id(registry), registry.root_id, registry.maker_version,
            registry.root_content_commitment, registry.policy_config_id,
            registry.base_count, registry.pack_count, registry.complete_count,
            registry.base_commitment, registry.pack_commitment,
            registry.complete_commitment, registry.revision, true)
}

fun proof_root_matches<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, root_id: ID, maker_version: u64,
    content: &vector<u8>,
): bool {
    root_id == maker::root_id_v8(root)
        && maker_version == maker::root_maker_version_v8(root)
        && content == maker::root_content_commitment_v8(root)
}

fun consume_certification(
    certification: CiphertextCertificationV8,
    registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8,
): ProtectedAssetV8 {
    let CiphertextCertificationV8 {
        catalog_id, product_binding_commitment, policy_config_id,
        policy_commitment, root_id, maker_version, root_content_commitment,
        scope_kind, scope_key, scope_commitment, asset_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment, seal_id,
    } = certification;
    assert!(catalog_id == registry.catalog_id && catalog_id == policy.catalog_id, ECatalogMismatch);
    assert!(product_binding_commitment == registry.product_binding_commitment, EInvalidBinding);
    assert!(policy_config_id == object::id(policy) && policy_commitment == policy.commitment, EInvalidConfig);
    assert!(root_id == registry.root_id && maker_version == registry.maker_version, EInvalidBinding);
    assert!(root_content_commitment == registry.root_content_commitment, EInvalidBinding);
    let derived_certification = derive_ciphertext_certification_commitment_v8(
        catalog_id, product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version, scope_kind, scope_key,
        scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment,
    );
    assert!(certification_commitment == derived_certification, EInvalidCommitment);
    let derived_id = derive_seal_id_v8(
        product_binding_commitment, policy_commitment, root_content_commitment,
        maker_version, scope_kind, scope_key, asset_key,
    );
    assert!(seal_id == derived_id, EInvalidCommitment);
    ProtectedAssetV8 { scope_kind, scope_key, scope_commitment, asset_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment, seal_id }
}

fun assert_policy_root<PaymentCoin>(
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
) {
    assert!(policy.version == VERSION, EInvalidConfig);
    assert!(policy.catalog_id == maker::root_product_release_catalog_id_v8(root), ECatalogMismatch);
    assert!(&policy.product_binding_commitment
        == maker::root_product_release_binding_commitment_v8(root), EInvalidBinding);
    assert!(&policy.call_cap_set_commitment
        == maker::root_product_release_call_cap_set_commitment_v8(root), EInvalidBinding);
}

fun assert_role_witness<PaymentCoin, OriginalMarker, CallableWitness>(
    _root: &MakerRootV8<PaymentCoin>,
    binding: &ExactPackageBindingV8,
    expected_module: vector<u8>,
    expected_marker_datatype: vector<u8>,
    expected_witness_datatype: vector<u8>,
) {
    package_binding::assert_exact_witness_type_v2<OriginalMarker>(
        binding, &expected_module, &expected_marker_datatype);
    package_binding::assert_exact_witness_type_v2<CallableWitness>(
        binding, &expected_module, &expected_witness_datatype);
}

fun assert_catalog_root<PaymentCoin>(
    catalog: &ProductReleaseCatalogV8, root: &MakerRootV8<PaymentCoin>,
) {
    maker::assert_product_release_catalog_v8(root, catalog);
}

fun assert_registry_binding<PaymentCoin>(
    registry: &SealRegistryV8, root: &MakerRootV8<PaymentCoin>,
    policy: &SealPolicyConfigV8,
) {
    assert!(registry_binding_matches(registry, root, policy), EInvalidBinding);
}

fun registry_binding_matches<PaymentCoin>(
    registry: &SealRegistryV8, root: &MakerRootV8<PaymentCoin>,
    policy: &SealPolicyConfigV8,
): bool {
    registry.version == VERSION
        && registry.root_id == maker::root_id_v8(root)
        && registry.maker_version == maker::root_maker_version_v8(root)
        && &registry.root_content_commitment == maker::root_content_commitment_v8(root)
        && registry.catalog_id == policy.catalog_id
        && registry.product_binding_commitment == policy.product_binding_commitment
        && registry.policy_config_id == object::id(policy)
        && registry.policy_commitment == policy.commitment
}

fun validate_key_servers(
    ids: vector<ID>, weights: vector<u16>, threshold: u16,
): vector<KeyServerRowV2> {
    let count = ids.length();
    assert!(count > 0 && count <= MAX_KEY_SERVERS && count == weights.length(), EInvalidKeyServers);
    let mut result = vector[];
    let mut total = 0u64;
    let mut index = 0;
    let mut previous = vector[];
    while (index < count) {
        let id = ids[index];
        let weight = weights[index];
        let address = id.to_address();
        let bytes = object::id_to_bytes(&id);
        assert!(address != @0x0 && weight > 0, EInvalidKeyServers);
        if (index > 0) assert!(lexicographically_less(&previous, &bytes), EInvalidKeyServers);
        previous = bytes;
        total = total + (weight as u64);
        result.push_back(KeyServerRowV2 { key_server_id: id, weight });
        index = index + 1;
    };
    assert!(total <= MAX_KEY_SHARES
        && threshold > 0 && (threshold as u64) <= total, EInvalidKeyServers);
    result
}

fun lexicographically_less(left: &vector<u8>, right: &vector<u8>): bool {
    assert!(left.length() == right.length(), EInvalidKeyServers);
    let mut index = 0;
    while (index < left.length()) {
        if (left[index] < right[index]) return true;
        if (left[index] > right[index]) return false;
        index = index + 1;
    };
    false
}

fun derive_key_server_set_commitment(
    ordered_key_servers: vector<KeyServerRowV2>,
    threshold: u16,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&KeyServerSetCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/seal/key-server-set/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        ordered_key_servers,
        threshold,
    }))
}

fun derive_encryption_policy_commitment(
    cipher_suite: String,
    key_derivation: String,
    ciphertext_format: String,
    max_plaintext_bytes: u64,
): vector<u8> {
    let cipher = CIPHER_SUITE;
    let derivation = KEY_DERIVATION;
    let format = CIPHERTEXT_FORMAT;
    assert!(cipher_suite.as_bytes() == &cipher
        && key_derivation.as_bytes() == &derivation
        && ciphertext_format.as_bytes() == &format, EInvalidConfig);
    assert!(max_plaintext_bytes > 0
        && max_plaintext_bytes <= MAX_PLAINTEXT_BYTES, EInvalidConfig);
    hash::sha2_256(bcs::to_bytes(&EncryptionPolicyCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/seal/encryption-policy/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        cipher_suite,
        key_derivation,
        ciphertext_format,
        max_plaintext_bytes,
    }))
}

#[test]
fun encryption_profile_supported() {
    let commitment = derive_encryption_policy_commitment(
        CIPHER_SUITE.to_string(), KEY_DERIVATION.to_string(),
        CIPHERTEXT_FORMAT.to_string(), MAX_PLAINTEXT_BYTES);
    assert!(commitment.length() == HASH_LENGTH);
}

#[test, expected_failure(abort_code = EInvalidConfig)]
fun encryption_profile_rejects_wrong_cipher() {
    derive_encryption_policy_commitment(b"AES-256-GCM".to_string(),
        KEY_DERIVATION.to_string(), CIPHERTEXT_FORMAT.to_string(), MAX_PLAINTEXT_BYTES);
}

#[test, expected_failure(abort_code = EInvalidConfig)]
fun encryption_profile_rejects_wrong_kdf() {
    derive_encryption_policy_commitment(CIPHER_SUITE.to_string(),
        b"HKDF-SHA256".to_string(), CIPHERTEXT_FORMAT.to_string(), MAX_PLAINTEXT_BYTES);
}

#[test, expected_failure(abort_code = EInvalidConfig)]
fun encryption_profile_rejects_wrong_format() {
    derive_encryption_policy_commitment(CIPHER_SUITE.to_string(),
        KEY_DERIVATION.to_string(), b"application/vnd.animacraft.ciphertext.v2".to_string(), MAX_PLAINTEXT_BYTES);
}

fun derive_policy_commitment(
    policy_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
): vector<u8> {
    assert_hash(&package_tuple_commitment);
    assert_hash(&call_cap_set_commitment);
    assert_hash(&key_server_set_commitment);
    assert_hash(&encryption_policy_commitment);
    hash::sha2_256(bcs::to_bytes(&SealPolicyCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/seal/policy/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        policy_id,
        catalog_id,
        package_tuple_commitment,
        call_cap_set_commitment,
        key_server_set_commitment,
        encryption_policy_commitment,
    }))
}

fun assert_valid_row(row: &ProtectedAssetV8) {
    assert_scope(row.scope_kind);
    assert_semantic_key(&row.scope_key, MAX_SCOPE_KEY_BYTES);
    assert_semantic_key(&row.asset_key, MAX_ASSET_KEY_BYTES);
    assert_non_empty_bounded(&row.ciphertext_blob_id, MAX_BLOB_ID_BYTES);
    assert_hash(&row.scope_commitment);
    assert_hash(&row.asset_content_commitment);
    assert_hash(&row.ciphertext_sha256);
    assert_hash(&row.ciphertext_blob_commitment);
    assert_hash(&row.certification_commitment);
    assert_hash(&row.seal_id);
}

fun assert_scope_count_available(registry: &SealRegistryV8, scope_kind: u8) {
    if (scope_kind == SCOPE_BASE) {
        assert!(registry.base_count < registry.expected_base_count,
            EInvalidCount)
    } else if (scope_kind == SCOPE_PACK) {
        assert!(registry.pack_count < registry.expected_pack_count,
            EInvalidCount)
    } else {
        assert!(registry.complete_count < registry.expected_complete_count,
            EInvalidCount)
    };
}

fun assert_counts_exact(registry: &SealRegistryV8) {
    assert!(registry.base_count == registry.expected_base_count, EInvalidCount);
    assert!(registry.pack_count == registry.expected_pack_count, EInvalidCount);
    assert!(registry.complete_count == registry.expected_complete_count,
        EInvalidCount);
}

fun checked_total(base: u64, pack: u64, complete: u64): u64 {
    let first = base + pack;
    assert!(first >= base, EInvalidCount);
    let total = first + complete;
    assert!(total >= first, EInvalidCount);
    total
}

fun assert_holder_and_proof_fields(
    holder: address, commitment: &vector<u8>, scope_key: &String,
    asset_key: &String, seal_id: &vector<u8>,
) {
    assert!(holder != @0x0, EInvalidProof);
    assert_hash(commitment);
    assert_hash(seal_id);
    assert_semantic_key(scope_key, MAX_SCOPE_KEY_BYTES);
    assert_semantic_key(asset_key, MAX_ASSET_KEY_BYTES);
}

fun assert_scope(scope_kind: u8) {
    assert!(scope_kind == SCOPE_BASE || scope_kind == SCOPE_PACK
        || scope_kind == SCOPE_COMPLETE, EInvalidScope);
}

fun assert_semantic_key(value: &String, max: u64) {
    assert_non_empty_bounded(value, max);
    let bytes = string::as_bytes(value);
    let mut index = 0;
    while (index < bytes.length()) {
        assert!(bytes[index] != 0, EInvalidKey);
        index = index + 1;
    };
}

fun assert_non_empty_bounded(value: &String, max: u64) {
    let length = string::as_bytes(value).length();
    assert!(length > 0 && length <= max, EInvalidKey);
}

fun assert_hash(value: &vector<u8>) {
    assert!(value.length() == HASH_LENGTH, EInvalidCommitment);
    let mut any_nonzero = false;
    let mut index = 0;
    while (index < HASH_LENGTH) {
        if (value[index] != 0) any_nonzero = true;
        index = index + 1;
    };
    assert!(any_nonzero, EInvalidCommitment);
}

public fun policy_id_v8(policy: &SealPolicyConfigV8): ID { object::id(policy) }
public fun policy_catalog_id_v8(policy: &SealPolicyConfigV8): ID { policy.catalog_id }
public fun policy_seal_authority_id_v8(policy: &SealPolicyConfigV8): ID { policy.seal_authority_id }
public fun policy_call_cap_set_commitment_v8(policy: &SealPolicyConfigV8): &vector<u8> { &policy.call_cap_set_commitment }
public fun policy_threshold_v8(policy: &SealPolicyConfigV8): u16 { policy.threshold }
public fun policy_key_server_count_v8(policy: &SealPolicyConfigV8): u64 { policy.key_servers.length() }
public fun policy_key_server_id_v8(policy: &SealPolicyConfigV8, index: u64): ID { policy.key_servers[index].key_server_id }
public fun policy_key_server_weight_v8(policy: &SealPolicyConfigV8, index: u64): u16 { policy.key_servers[index].weight }
public fun policy_key_server_set_commitment_v8(policy: &SealPolicyConfigV8): &vector<u8> { &policy.key_server_set_commitment }
public fun policy_encryption_commitment_v8(policy: &SealPolicyConfigV8): &vector<u8> { &policy.encryption_policy_commitment }
public fun policy_commitment_v8(policy: &SealPolicyConfigV8): &vector<u8> { &policy.commitment }
public fun registry_id_v8(registry: &SealRegistryV8): ID { object::id(registry) }
public fun registry_root_id_v8(registry: &SealRegistryV8): ID { registry.root_id }
public fun registry_policy_config_id_v8(registry: &SealRegistryV8): ID { registry.policy_config_id }
public fun registry_expected_count_v8(registry: &SealRegistryV8): u64 {
    checked_total(registry.expected_base_count, registry.expected_pack_count,
        registry.expected_complete_count)
}
public fun registry_observed_count_v8(registry: &SealRegistryV8): u64 {
    checked_total(registry.base_count, registry.pack_count,
        registry.complete_count)
}
public fun registry_sealed_v8(registry: &SealRegistryV8): bool { registry.sealed }
public fun registry_commitment_v8(registry: &SealRegistryV8): &vector<u8> {
    &registry.commitment
}
public fun registry_runtime_revision_v8(registry: &SealRegistryV8): u64 { registry.runtime_revision }
public fun asset_seal_id_v8(registry: &SealRegistryV8, scope_kind: u8, scope_key: String, asset_key: String): &vector<u8> {
    let key = ProtectedAssetKeyV8 { scope_kind, scope_key, asset_key };
    if (registry.assets.contains(key)) return &registry.assets.borrow(key).seal_id;
    &registry.runtime_assets.borrow(key).seal_id
}
public fun snapshot_registry_id_v8(snapshot: &ProtectedAssetSnapshotV8): ID { snapshot.registry_id }
public fun snapshot_registry_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.registry_commitment }
public fun snapshot_runtime_revision_v8(snapshot: &ProtectedAssetSnapshotV8): u64 { snapshot.runtime_revision }
public fun snapshot_runtime_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.runtime_commitment }
public fun snapshot_policy_config_id_v8(snapshot: &ProtectedAssetSnapshotV8): ID { snapshot.policy_config_id }
public fun snapshot_policy_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.policy_commitment }
public fun snapshot_root_id_v8(snapshot: &ProtectedAssetSnapshotV8): ID { snapshot.root_id }
public fun snapshot_maker_version_v8(snapshot: &ProtectedAssetSnapshotV8): u64 { snapshot.maker_version }
public fun snapshot_root_content_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.root_content_commitment }
public fun snapshot_scope_kind_v8(snapshot: &ProtectedAssetSnapshotV8): u8 { snapshot.scope_kind }
public fun snapshot_scope_key_v8(snapshot: &ProtectedAssetSnapshotV8): &String { &snapshot.scope_key }
public fun snapshot_scope_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.scope_commitment }
public fun snapshot_asset_key_v8(snapshot: &ProtectedAssetSnapshotV8): &String { &snapshot.asset_key }
public fun snapshot_asset_content_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.asset_content_commitment }
public fun snapshot_ciphertext_blob_id_v8(snapshot: &ProtectedAssetSnapshotV8): &String { &snapshot.ciphertext_blob_id }
public fun snapshot_ciphertext_sha256_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.ciphertext_sha256 }
public fun snapshot_ciphertext_blob_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.ciphertext_blob_commitment }
public fun snapshot_certification_commitment_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.certification_commitment }
public fun snapshot_seal_id_v8(snapshot: &ProtectedAssetSnapshotV8): &vector<u8> { &snapshot.seal_id }

#[test_only]
public fun new_policy_for_testing(
    protocol_config: &ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
    key_server_ids: vector<ID>, weights: vector<u16>, threshold: u16,
    ctx: &mut TxContext,
): SealPolicyConfigV8 {
    let seal_call_cap = package_binding::take_seal_call_cap_v8(
        protocol_config, protocol_admin, catalog);
    new_seal_policy_config_v8(
        protocol_config, protocol_admin, catalog, seal_call_cap,
        key_server_ids, weights,
        threshold, CIPHER_SUITE.to_string(), KEY_DERIVATION.to_string(),
        CIPHERTEXT_FORMAT.to_string(),
        MAX_PLAINTEXT_BYTES,
        ctx)
}

#[test_only]
public fun destroy_ciphertext_certification_for_testing(
    certification: CiphertextCertificationV8,
) {
    let CiphertextCertificationV8 {
        catalog_id: _,
        product_binding_commitment: _,
        policy_config_id: _,
        policy_commitment: _,
        root_id: _,
        maker_version: _,
        root_content_commitment: _,
        scope_kind: _,
        scope_key: _,
        scope_commitment: _,
        asset_key: _,
        asset_content_commitment: _,
        ciphertext_blob_id: _,
        ciphertext_sha256: _,
        ciphertext_blob_commitment: _,
        certification_commitment: _,
        seal_id: _,
    } = certification;
}

#[test_only]
public fun certification_for_testing<PaymentCoin>(
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
    scope_kind: u8, scope_key: String, scope_commitment: vector<u8>,
    asset_key: String, asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String, ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
): CiphertextCertificationV8 {
    let catalog_id = policy.catalog_id;
    let product_binding_commitment = policy.product_binding_commitment;
    let policy_commitment = policy.commitment;
    let root_id = maker::root_id_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let certification_commitment = derive_ciphertext_certification_commitment_v8(
        catalog_id, product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version, scope_kind, scope_key,
        scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment);
    let seal_id = derive_seal_id_v8(product_binding_commitment,
        policy_commitment, root_content_commitment, maker_version, scope_kind,
        scope_key, asset_key);
    CiphertextCertificationV8 { catalog_id, product_binding_commitment,
        policy_config_id: object::id(policy), policy_commitment, root_id,
        maker_version, root_content_commitment, scope_kind, scope_key,
        scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment,
        certification_commitment, seal_id }
}

#[test_only]
public fun new_registry_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    policy: &SealPolicyConfigV8, expected_base_count: u64,
    expected_pack_count: u64, expected_complete_count: u64,
    ctx: &mut TxContext,
): SealRegistryV8 {
    new_seal_registry_v8(
        root, admin, policy, expected_base_count, expected_pack_count,
        expected_complete_count, ctx)
}

#[test_only]
public fun new_empty_registry_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    policy: &SealPolicyConfigV8,
    ctx: &mut TxContext,
): SealRegistryV8 {
    let mut registry = new_registry_for_testing(
        root, admin, policy, 0, 0, 0, ctx,
    );
    seal_registry_v8(&mut registry, root, admin, policy);
    registry
}

#[test_only]
public fun certification_and_id_for_testing<PaymentCoin>(
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
    scope_kind: u8,
    scope_key: String, scope_commitment: vector<u8>, asset_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
): (CiphertextCertificationV8, vector<u8>) {
    let certification = certification_for_testing(policy, root, scope_kind,
        scope_key, scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment);
    let id = certification.seal_id;
    (certification, id)
}

#[test_only]
public fun base_proof_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, holder: address, scope_key: String,
    asset_key: String, seal_id: vector<u8>,
): BaseDecryptProofV8 {
    BaseDecryptProofV8 { root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root),
        holder, entitlement_id: object::id_from_address(@0xE1),
        entitlement_commitment: test_hash(81), scope_key, asset_key, seal_id }
}

#[test_only]
public fun pack_proof_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, holder: address,
    pack_release_id: ID, pack_content_commitment: vector<u8>,
    scope_key: String, asset_key: String, seal_id: vector<u8>,
): PackDecryptProofV8 {
    PackDecryptProofV8 { root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root), holder,
        base_entitlement_id: object::id_from_address(@0xE1),
        base_entitlement_commitment: test_hash(81),
        pack_entitlement_id: object::id_from_address(@0xE2),
        pack_entitlement_commitment: test_hash(82), pack_release_id,
        pack_content_commitment, scope_key, asset_key, seal_id }
}

#[test_only]
public fun complete_proof_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, holder: address,
    output_commitment: vector<u8>, scope_key: String, asset_key: String,
    seal_id: vector<u8>,
): CompleteDecryptProofV8 {
    complete_proof_exact_for_testing(
        root,
        holder,
        object::id_from_address(@0xE3),
        object::id_from_address(@0xE4),
        test_hash(83),
        test_hash(84),
        output_commitment,
        test_hash(85),
        scope_key,
        asset_key,
        seal_id,
    )
}

#[test_only]
fun complete_proof_exact_for_testing<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, holder: address,
    receipt_id: ID, output_id: ID, recipe_commitment: vector<u8>,
    render_commitment: vector<u8>, output_commitment: vector<u8>,
    receipt_commitment: vector<u8>, scope_key: String, asset_key: String,
    seal_id: vector<u8>,
): CompleteDecryptProofV8 {
    CompleteDecryptProofV8 { root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        root_content_commitment: *maker::root_content_commitment_v8(root), holder,
        receipt_id, output_id, recipe_commitment, render_commitment,
        output_commitment, receipt_commitment, scope_key, asset_key, seal_id }
}

#[test_only]
fun complete_binding_fixture(ctx: &mut TxContext): (
    ProtocolConfigV8,
    ProtocolAdminCapV8,
    MakerRootV8<sui::sui::SUI>,
    animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    animacraft_v8_core::treasury_v8::MakerTreasuryV8<sui::sui::SUI>,
    MakerAdminCapV8,
    ProductReleaseCatalogV8,
    SealPolicyConfigV8,
    SealRegistryV8,
    vector<u8>,
) {
    let (config, protocol_admin, mut root, base_registry, maker_treasury,
        admin, catalog, policy) = new_test_fixture(ctx);
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 0, 0, 0, ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let instance = complete_instance_commitment_v8(
        test_hash(83), test_hash(84), test_hash(33), test_hash(85));
    let certification = certification_for_testing(
        &policy,
        &root,
        SCOPE_COMPLETE,
        b"complete/runtime".to_string(),
        instance,
        b"receipt/runtime/one".to_string(),
        test_hash(33),
        b"runtime-blob".to_string(),
        test_hash(43),
        test_hash(53),
    );
    let seal_id = certification.seal_id;
    assert!(register_runtime_asset_for_testing(
        &mut registry, &root, &policy, 0, certification, SCOPE_COMPLETE,
    ) == seal_id, EInvalidCommitment);
    (config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, registry, seal_id)
}

#[test_only]
public fun register_runtime_asset_for_testing<PaymentCoin>(
    registry: &mut SealRegistryV8, root: &MakerRootV8<PaymentCoin>,
    policy: &SealPolicyConfigV8, expected_revision: u64,
    certification: CiphertextCertificationV8, required_scope: u8,
): vector<u8> {
    register_runtime_asset(registry, root, policy, expected_revision,
        certification, required_scope)
}

#[test_only]
public fun destroy_policy_for_testing(policy: SealPolicyConfigV8) {
    let SealPolicyConfigV8 { id, version: _, protocol_config_id: _,
        protocol_config_revision: _, catalog_id: _, product_binding_commitment: _,
        seal_original_package_id: _, seal_callable_package_id: _,
        seal_binding_commitment: _, seal_authority_id: _,
        call_cap_set_commitment: _, role: _, finalized: _,
        key_servers: _, threshold: _, cipher_suite: _, key_derivation: _,
        ciphertext_format: _, max_plaintext_bytes: _,
        key_server_set_commitment: _, encryption_policy_commitment: _,
        commitment: _, config_commitment: _ } = policy;
    id.delete();
}

#[test_only]
public fun destroy_registry_for_testing(registry: SealRegistryV8) {
    let SealRegistryV8 { id, version: _, root_id: _, maker_version: _,
        root_content_commitment: _, catalog_id: _, product_binding_commitment: _,
        policy_config_id: _, policy_commitment: _, expected_base_count: _,
        expected_pack_count: _, expected_complete_count: _,
        base_count: _, pack_count: _, complete_count: _,
        base_commitment: _, pack_commitment: _, complete_commitment: _,
        revision: _, commitment: _, sealed: _,
        mut keys, mut assets, runtime_revision: _,
        mut runtime_keys, mut runtime_assets } = registry;
    while (!keys.is_empty()) { let key = keys.pop_back(); let _row = assets.remove(key); };
    keys.destroy_empty();
    assets.destroy_empty();
    while (!runtime_keys.is_empty()) {
        let key = runtime_keys.pop_back();
        let _row = runtime_assets.remove(key);
    };
    runtime_keys.destroy_empty();
    runtime_assets.destroy_empty();
    id.delete();
}

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[]; let mut i = 0;
    while (i < HASH_LENGTH) { value.push_back(byte); i = i + 1; };
    value
}

#[test_only]
fun new_test_fixture(ctx: &mut TxContext): (
    ProtocolConfigV8,
    ProtocolAdminCapV8,
    MakerRootV8<sui::sui::SUI>,
    animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    animacraft_v8_core::treasury_v8::MakerTreasuryV8<sui::sui::SUI>,
    MakerAdminCapV8,
    ProductReleaseCatalogV8,
    SealPolicyConfigV8,
) {
    use animacraft_v8_core::base_registry_v8 as base;
    use animacraft_v8_core::core_v8 as core;
    let (config, protocol_admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    let content = test_hash(10);
    let counts = base::new_base_definition_counts_v8(1, 0, 1, 1, 1, 0, 1);
    let author_rows_commitment = base::minimal_author_rows_commitment_for_testing();
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &config, 0 /* ACCESS_FREE */, 0,
        maker::complete_unlimited_free_v8(), 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, base_registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<sui::sui::SUI>(
        &config, b"maker-semantic-key".to_string(),
        test_hash(20), test_hash(21), test_hash(22), test_hash(11),
        b"walrus-manifest".to_string(), test_hash(12), content,
        counts, author_rows_commitment, test_hash(13), economics, rights, &clock, ctx);
    clock.destroy_for_testing();
    let mut catalog = package_binding::product_release_catalog_for_testing(
        &config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        type_name::original_id<SealOriginalMarkerV8>(),
        type_name::defining_id<SealCallableMarkerV8>(),
        ctx);
    let policy = new_policy_for_testing(
        &config, &protocol_admin, &mut catalog,
        vector[object::id_from_address(@0x100), object::id_from_address(@0x200)],
        vector[2, 3], 4, ctx);
    package_binding::complete_catalog_setup_for_testing(&mut catalog, ctx);
    maker::finalize_product_release_binding_v8(
        &mut root, &admin, &config, &catalog, ctx);
    (config, protocol_admin, root, base_registry, maker_treasury, admin, catalog, policy)
}

#[test_only]
fun finish_test_fixture(
    config: ProtocolConfigV8,
    protocol_admin: ProtocolAdminCapV8,
    mut root: MakerRootV8<sui::sui::SUI>,
    base_registry: animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    maker_treasury: animacraft_v8_core::treasury_v8::MakerTreasuryV8<sui::sui::SUI>,
    admin: MakerAdminCapV8,
    catalog: ProductReleaseCatalogV8,
    policy: SealPolicyConfigV8,
    ctx: &TxContext,
) {
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_draft_v8());
    destroy_policy_for_testing(policy);
    package_binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_admin);
    animacraft_v8_core::core_v8::share_maker_draft_v8(
        root, base_registry, maker_treasury, admin, ctx);
}

#[test]
fun seal_identity_is_pre_encryption_and_commits_to_every_semantic_key() {
    let binding = test_hash(1);
    let policy = test_hash(2);
    let root = test_hash(3);
    let id = derive_seal_id_v8(binding, policy, root, 1, SCOPE_BASE,
        b"maker/base".to_string(), b"part/item/style".to_string());
    assert!(id != derive_seal_id_v8(binding, policy, root, 2, SCOPE_BASE,
        b"maker/base".to_string(), b"part/item/style".to_string()), EInvalidCommitment);
    assert!(id != derive_seal_id_v8(binding, policy, root, 1, SCOPE_PACK,
        b"maker/base".to_string(), b"part/item/style".to_string()), EInvalidCommitment);
    assert!(id != derive_seal_id_v8(binding, policy, root, 1, SCOPE_BASE,
        b"maker/other".to_string(), b"part/item/style".to_string()), EInvalidCommitment);
    assert!(id != derive_seal_id_v8(binding, policy, root, 1, SCOPE_BASE,
        b"maker/base".to_string(), b"part/item/other".to_string()), EInvalidCommitment);
}

#[test]
fun explicit_zero_row_registry_seals_exactly() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, protocol_admin, root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 0, 0, 0, &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    assert!(registry_sealed_v8(&registry), ERegistryNotSealed);
    assert!(registry_observed_count_v8(&registry) == 0, EInvalidCount);
    assert!(registry_expected_count_v8(&registry) == 0
        && registry_observed_count_v8(&registry) == 0,
        EInvalidCount);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, &ctx);
}

#[test]
fun base_pack_complete_rows_append_in_exact_sequence_and_approve() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let (config, protocol_admin, mut root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let (base_cert, base_id) = certification_and_id_for_testing(
        &policy, &root, SCOPE_BASE, b"maker/base".to_string(),
        test_hash(21), b"body/base/style-a".to_string(), test_hash(31),
        b"blob-base".to_string(), test_hash(41), test_hash(51));
    let (pack_cert, pack_id) = certification_and_id_for_testing(
        &policy, &root, SCOPE_PACK, b"pack/celestial".to_string(),
        test_hash(22), b"body/pack/style-b".to_string(), test_hash(32),
        b"blob-pack".to_string(), test_hash(42), test_hash(52));
    let complete_instance = complete_instance_commitment_v8(
        test_hash(83), test_hash(84), test_hash(33), test_hash(85));
    let (complete_cert, complete_id) = certification_and_id_for_testing(
        &policy, &root, SCOPE_COMPLETE, b"complete/default".to_string(),
        complete_instance, b"recipe/render/001".to_string(), test_hash(33),
        b"blob-complete".to_string(), test_hash(43), test_hash(53));
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 1, 1, 1, &mut ctx);
    assert!(append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, base_cert) == base_id, EInvalidCommitment);
    assert!(append_protected_asset_v8(&mut registry, &root, &admin, &policy, 1, pack_cert) == pack_id, EInvalidCommitment);
    assert!(append_protected_asset_v8(&mut registry, &root, &admin, &policy, 2, complete_cert) == complete_id, EInvalidCommitment);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    let base_certification = derive_ciphertext_certification_commitment_v8(
        policy.catalog_id, policy.product_binding_commitment, policy.commitment,
        *maker::root_content_commitment_v8(&root), 1, SCOPE_BASE,
        b"maker/base".to_string(), test_hash(21),
        b"body/base/style-a".to_string(), test_hash(31),
        b"blob-base".to_string(), test_hash(41), test_hash(51));
    let snapshot = protected_asset_snapshot_v8(&registry, &policy, &root,
        SCOPE_BASE, b"maker/base".to_string(), test_hash(21),
        b"body/base/style-a".to_string(), test_hash(31),
        b"blob-base".to_string(), test_hash(41), test_hash(51),
        base_certification, base_id);
    assert!(snapshot_registry_id_v8(&snapshot) == object::id(&registry), EInvalidBinding);
    assert!(snapshot_root_id_v8(&snapshot) == maker::root_id_v8(&root), EInvalidBinding);
    assert!(snapshot_scope_kind_v8(&snapshot) == SCOPE_BASE, EInvalidScope);
    assert!(snapshot_seal_id_v8(&snapshot) == &base_id, EInvalidCommitment);
    assert!(registry.base_count == 1 && registry.pack_count == 1
        && registry.complete_count == 1
        && registry_observed_count_v8(&registry) == 3, EInvalidCount);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let base_proof = base_proof_for_testing(&root, @0xA11,
        b"maker/base".to_string(), b"body/base/style-a".to_string(), base_id);
    consume_base_decrypt_proof_v8(base_id, &registry, &policy, &root, base_proof, &ctx);
    let pack_proof = pack_proof_for_testing(&root, @0xA11,
        object::id_from_address(@0xB1), test_hash(22),
        b"pack/celestial".to_string(), b"body/pack/style-b".to_string(), pack_id);
    consume_pack_decrypt_proof_v8(pack_id, &registry, &policy, &root, pack_proof, &ctx);
    let complete_proof = complete_proof_for_testing(&root, @0xA11, test_hash(33),
        b"complete/default".to_string(), b"recipe/render/001".to_string(), complete_id);
    consume_complete_decrypt_proof_v8(complete_id, &registry, &policy, &root, complete_proof, &ctx);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, &ctx);
}

#[test]
fun paused_and_archived_do_not_trap_exact_holder() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let (config, protocol_admin, mut root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let (cert, id) = certification_and_id_for_testing(
        &policy, &root, SCOPE_BASE, b"maker/base".to_string(),
        test_hash(21), b"body/base/style".to_string(), test_hash(31),
        b"blob".to_string(), test_hash(41), test_hash(51));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_paused_v8());
    let proof = base_proof_for_testing(&root, @0xA11, b"maker/base".to_string(),
        b"body/base/style".to_string(), id);
    consume_base_decrypt_proof_v8(id, &registry, &policy, &root, proof, &ctx);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_archived_v8());
    let proof = base_proof_for_testing(&root, @0xA11, b"maker/base".to_string(),
        b"body/base/style".to_string(), id);
    consume_base_decrypt_proof_v8(id, &registry, &policy, &root, proof, &ctx);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, &ctx);
}

#[test]
fun active_complete_registration_uses_revision_cas_and_exact_receipt() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 30, 0, 0, 0);
    let (config, protocol_admin, mut root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    let before = *registry_commitment_v8(&registry);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let instance = complete_instance_commitment_v8(
        test_hash(83), test_hash(84), test_hash(33), test_hash(85));
    let certification = certification_for_testing(&policy, &root, SCOPE_COMPLETE,
        b"complete/runtime".to_string(), instance,
        b"receipt/runtime/one".to_string(), test_hash(33),
        b"runtime-blob".to_string(), test_hash(43), test_hash(53));
    let id = certification.seal_id;
    assert!(register_runtime_asset_for_testing(&mut registry, &root, &policy, 0,
        certification, SCOPE_COMPLETE) == id, EInvalidCommitment);
    assert!(registry_runtime_revision_v8(&registry) == 1, EInvalidSequence);
    assert!(registry_commitment_v8(&registry) != &before,
        EInvalidCommitment);
    let proof = complete_proof_for_testing(&root, @0xA11, test_hash(33),
        b"complete/runtime".to_string(), b"receipt/runtime/one".to_string(), id);
    consume_complete_decrypt_proof_v8(id, &registry, &policy, &root, proof, &ctx);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, &ctx);
}

#[test]
fun complete_output_proof_consumption_binds_registered_live_instance() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 35, 0, 0, 0);
    let (config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, registry, seal_id) = complete_binding_fixture(&mut ctx);
    let proof = complete_proof_for_testing(
        &root, @0xA11, test_hash(33), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    let (receipt_id, output_id, recipe_commitment, render_commitment,
        output_commitment, receipt_commitment, scope_key, asset_key,
        consumed_id) = consume_complete_decrypt_proof_v8(
        seal_id, &registry, &policy, &root, proof, &ctx);
    assert!(receipt_id == object::id_from_address(@0xE3), EInvalidProof);
    assert!(output_id == object::id_from_address(@0xE4), EInvalidProof);
    assert!(recipe_commitment == test_hash(83), EInvalidProof);
    assert!(render_commitment == test_hash(84), EInvalidProof);
    assert!(output_commitment == test_hash(33), EInvalidProof);
    assert!(receipt_commitment == test_hash(85), EInvalidProof);
    assert!(scope_key == b"complete/runtime".to_string(), EInvalidProof);
    assert!(asset_key == b"receipt/runtime/one".to_string(), EInvalidProof);
    assert!(consumed_id == seal_id, EInvalidProof);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, policy, &ctx);
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_cross_holder() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 36, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury,
        _admin, _catalog, policy, registry, seal_id) =
        complete_binding_fixture(&mut ctx);
    let proof = complete_proof_for_testing(
        &root, @0xB0B, test_hash(33), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    consume_complete_decrypt_proof_v8(
        seal_id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_recipe_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 39, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury,
        _admin, _catalog, policy, registry, seal_id) =
        complete_binding_fixture(&mut ctx);
    let proof = complete_proof_exact_for_testing(
        &root, @0xA11, object::id_from_address(@0xE3),
        object::id_from_address(@0xE4), test_hash(99), test_hash(84),
        test_hash(33), test_hash(85), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    consume_complete_decrypt_proof_v8(
        seal_id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_render_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 40, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury,
        _admin, _catalog, policy, registry, seal_id) =
        complete_binding_fixture(&mut ctx);
    let proof = complete_proof_exact_for_testing(
        &root, @0xA11, object::id_from_address(@0xE3),
        object::id_from_address(@0xE4), test_hash(83), test_hash(99),
        test_hash(33), test_hash(85), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    consume_complete_decrypt_proof_v8(
        seal_id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_output_commitment_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 41, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury,
        _admin, _catalog, policy, registry, seal_id) =
        complete_binding_fixture(&mut ctx);
    let proof = complete_proof_exact_for_testing(
        &root, @0xA11, object::id_from_address(@0xE3),
        object::id_from_address(@0xE4), test_hash(83), test_hash(84),
        test_hash(99), test_hash(85), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    consume_complete_decrypt_proof_v8(
        seal_id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_receipt_commitment_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 42, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury,
        _admin, _catalog, policy, registry, seal_id) =
        complete_binding_fixture(&mut ctx);
    let proof = complete_proof_exact_for_testing(
        &root, @0xA11, object::id_from_address(@0xE3),
        object::id_from_address(@0xE4), test_hash(83), test_hash(84),
        test_hash(33), test_hash(99), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    consume_complete_decrypt_proof_v8(
        seal_id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_unregistered_instance() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 43, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury,
        admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 0, 0, 0, &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = complete_proof_for_testing(
        &root, @0xA11, test_hash(33), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), test_hash(44));
    consume_complete_decrypt_proof_v8(
        test_hash(44), &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_wrong_policy() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 44, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury,
        _admin, _catalog, _policy, registry, seal_id) =
        complete_binding_fixture(&mut ctx);
    let (_wrong_config, _wrong_protocol_admin, _wrong_root,
        _wrong_base_registry, _wrong_maker_treasury, _wrong_admin,
        _wrong_catalog, wrong_policy) = new_test_fixture(&mut ctx);
    let proof = complete_proof_for_testing(
        &root, @0xA11, test_hash(33), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    consume_complete_decrypt_proof_v8(
        seal_id, &registry, &wrong_policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_output_proof_rejects_wrong_root() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 45, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury,
        _admin, _catalog, policy, registry, seal_id) =
        complete_binding_fixture(&mut ctx);
    let (_wrong_config, _wrong_protocol_admin, wrong_root,
        _wrong_base_registry, _wrong_maker_treasury, _wrong_admin,
        _wrong_catalog, _wrong_policy) = new_test_fixture(&mut ctx);
    let proof = complete_proof_for_testing(
        &root, @0xA11, test_hash(33), b"complete/runtime".to_string(),
        b"receipt/runtime/one".to_string(), seal_id);
    consume_complete_decrypt_proof_v8(
        seal_id, &registry, &policy, &wrong_root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = EInvalidSequence)]
fun runtime_registration_rejects_stale_revision() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 32, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) =
        new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let instance = complete_instance_commitment_v8(
        test_hash(83), test_hash(84), test_hash(33), test_hash(85));
    let certification = certification_for_testing(&policy, &root, SCOPE_COMPLETE,
        b"complete/runtime".to_string(), instance, b"receipt/two".to_string(),
        test_hash(33), b"runtime-blob".to_string(), test_hash(43), test_hash(53));
    register_runtime_asset_for_testing(&mut registry, &root, &policy, 1,
        certification, SCOPE_COMPLETE);
    abort EInvalidSequence
}

#[test, expected_failure(abort_code = EInvalidLifecycle)]
fun paused_root_cannot_register_new_ciphertext() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 33, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) =
        new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_paused_v8());
    let certification = certification_for_testing(&policy, &root, SCOPE_PACK,
        b"pack/runtime".to_string(), test_hash(22), b"style/two".to_string(),
        test_hash(32), b"runtime-blob".to_string(), test_hash(42), test_hash(52));
    register_runtime_asset_for_testing(&mut registry, &root, &policy, 0,
        certification, SCOPE_PACK);
    abort EInvalidLifecycle
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun protected_snapshot_rejects_any_ciphertext_drift() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 34, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) =
        new_test_fixture(&mut ctx);
    let (cert, id) = certification_and_id_for_testing(
        &policy, &root, SCOPE_BASE, b"maker/base".to_string(),
        test_hash(21), b"style/one".to_string(), test_hash(31),
        b"blob".to_string(), test_hash(41), test_hash(51));
    let certification_commitment = cert.certification_commitment;
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    let _snapshot = protected_asset_snapshot_v8(&registry, &policy, &root,
        SCOPE_BASE, b"maker/base".to_string(), test_hash(21),
        b"style/one".to_string(), test_hash(31), b"blob".to_string(),
        test_hash(99), test_hash(51), certification_commitment, id);
    abort EInvalidCommitment
}

#[test, expected_failure(abort_code = EInvalidSequence)]
fun rejects_out_of_order_append() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 4, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (cert, _) = certification_and_id_for_testing(&policy, &root,
        SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 1, cert);
    abort EInvalidSequence
}

#[test, expected_failure(abort_code = EDuplicateAsset)]
fun rejects_duplicate_semantic_scope_asset_key() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 5, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (first, _) = certification_and_id_for_testing(&policy, &root,
        SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let (duplicate, _) = certification_and_id_for_testing(&policy, &root,
        SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 2, 0, 0,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, first);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 1, duplicate);
    abort EDuplicateAsset
}

#[test, expected_failure(abort_code = EInvalidCount)]
fun rejects_seal_before_expected_counts() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 6, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    abort EInvalidCount
}

#[test]
fun seal_rehashes_exact_registry_summary_and_sealed_bit() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7, 0, 0, 0);
    let (config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy) = new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 0, 0, 0, &mut ctx);
    let before = *registry_commitment_v8(&registry);
    assert!(before == derive_registry_commitment(
        object::id(&registry), registry.root_id, registry.maker_version,
        registry.root_content_commitment, registry.policy_config_id,
        0, 0, 0, registry.base_commitment, registry.pack_commitment,
        registry.complete_commitment, 0, false), EInvalidCommitment);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    assert!(before != registry.commitment, EInvalidCommitment);
    assert!(registry.commitment == derive_registry_commitment(
        object::id(&registry), registry.root_id, registry.maker_version,
        registry.root_content_commitment, registry.policy_config_id,
        0, 0, 0, registry.base_commitment, registry.pack_commitment,
        registry.complete_commitment, 0, true), EInvalidCommitment);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry,
        maker_treasury, admin, catalog, policy, &ctx);
}

#[test, expected_failure(abort_code = ENoAccess)]
fun approval_rejects_tampered_exact_registry_summary() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 46, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury,
        admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (certification, seal_id) = certification_and_id_for_testing(
        &policy, &root, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 1, 0, 0, &mut ctx);
    append_protected_asset_v8(
        &mut registry, &root, &admin, &policy, 0, certification);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    registry.commitment = test_hash(99);
    let proof = base_proof_for_testing(
        &root, @0xA11, b"maker/base".to_string(), b"asset".to_string(), seal_id);
    consume_base_decrypt_proof_v8(
        seal_id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ERegistrySealed)]
fun rejects_append_after_explicit_empty_seal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 8, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    let cert = certification_for_testing(&policy, &root, SCOPE_BASE,
        b"maker/base".to_string(), test_hash(2), b"asset".to_string(),
        test_hash(3), b"blob".to_string(), test_hash(4), test_hash(5));
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    abort ERegistrySealed
}

#[test, expected_failure(abort_code = ENoAccess)]
fun draft_root_never_approves_decrypt() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 9, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (cert, id) = certification_and_id_for_testing(&policy,
        &root, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    let proof = base_proof_for_testing(&root, @0xA11, b"maker/base".to_string(),
        b"asset".to_string(), id);
    consume_base_decrypt_proof_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun wrong_holder_never_approves_decrypt() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 10, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (cert, id) = certification_and_id_for_testing(&policy,
        &root, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = base_proof_for_testing(&root, @0xB0B, b"maker/base".to_string(),
        b"asset".to_string(), id);
    consume_base_decrypt_proof_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun pack_proof_must_bind_exact_release_content() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 11, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (cert, id) = certification_and_id_for_testing(&policy,
        &root, SCOPE_PACK, b"pack/one".to_string(), test_hash(22),
        b"asset".to_string(), test_hash(3), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 1, 0,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = pack_proof_for_testing(&root, @0xA11, object::id_from_address(@0xB1),
        test_hash(99), b"pack/one".to_string(), b"asset".to_string(), id);
    consume_pack_decrypt_proof_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun base_consumer_rejects_different_approval_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 71, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury,
        admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (cert, id) = certification_and_id_for_testing(&policy, &root,
        SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0, &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = base_proof_for_testing(&root, @0xA11,
        b"maker/base".to_string(), b"asset".to_string(), id);
    consume_base_decrypt_proof_v8(test_hash(99), &registry, &policy, &root, proof, &ctx);
    abort EInvalidProof
}

#[test, expected_failure(abort_code = ENoAccess)]
fun pack_consumer_rejects_different_approval_id() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 72, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury,
        admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let (cert, id) = certification_and_id_for_testing(&policy, &root,
        SCOPE_PACK, b"pack/one".to_string(), test_hash(22),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 1, 0, &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = pack_proof_for_testing(&root, @0xA11, object::id_from_address(@0xB1),
        test_hash(22), b"pack/one".to_string(), b"asset".to_string(), id);
    consume_pack_decrypt_proof_v8(test_hash(99), &registry, &policy, &root, proof, &ctx);
    abort EInvalidProof
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_proof_must_bind_exact_output_commitment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 12, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let complete_instance = complete_instance_commitment_v8(
        test_hash(83), test_hash(84), test_hash(33), test_hash(85));
    let (cert, id) = certification_and_id_for_testing(&policy,
        &root, SCOPE_COMPLETE, b"complete/default".to_string(), complete_instance,
        b"receipt/one".to_string(), test_hash(33), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 1,
        &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = complete_proof_for_testing(&root, @0xA11, test_hash(99),
        b"complete/default".to_string(), b"receipt/one".to_string(), id);
    consume_complete_decrypt_proof_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = EInvalidKeyServers)]
fun key_server_ids_must_be_strictly_sorted_and_unique() {
    validate_key_servers(
        vector[object::id_from_address(@0x200), object::id_from_address(@0x100)],
        vector[1, 1], 1);
    abort EInvalidKeyServers
}

#[test]
fun seal_policy_v2_binds_policy_id_and_exact_children() {
    let rows = vector[
        KeyServerRowV2 {
            key_server_id: object::id_from_address(@0x100), weight: 2,
        },
        KeyServerRowV2 {
            key_server_id: object::id_from_address(@0x200), weight: 3,
        },
    ];
    let key_servers = derive_key_server_set_commitment(rows, 4);
    let encryption = derive_encryption_policy_commitment(
        CIPHER_SUITE.to_string(), KEY_DERIVATION.to_string(),
        CIPHERTEXT_FORMAT.to_string(),
        MAX_PLAINTEXT_BYTES);
    let first = derive_policy_commitment(
        object::id_from_address(@0xA), object::id_from_address(@0xB),
        test_hash(1), test_hash(2), key_servers, encryption);
    let second = derive_policy_commitment(
        object::id_from_address(@0xC), object::id_from_address(@0xB),
        test_hash(1), test_hash(2), key_servers, encryption);
    assert!(first != second, EInvalidCommitment);
}

#[test]
fun key_server_weights_allow_254_total_and_threshold() {
    let rows = validate_key_servers(
        vector[object::id_from_address(@0x100), object::id_from_address(@0x200)],
        vector[127, 127], 254);
    assert!(rows.length() == 2);
    assert!(rows[0].weight == 127 && rows[1].weight == 127);
}

#[test, expected_failure(abort_code = EInvalidKeyServers)]
fun key_server_weights_reject_255_total() {
    validate_key_servers(
        vector[object::id_from_address(@0x100), object::id_from_address(@0x200)],
        vector[127, 128], 1);
}

#[test, expected_failure(abort_code = EInvalidKeyServers)]
fun key_server_weights_reject_255_threshold() {
    validate_key_servers(vector[object::id_from_address(@0x100)], vector[254], 255);
}

#[test, expected_failure(abort_code = EInvalidKeyServers)]
fun key_server_weights_reject_oversized_u16_weight() {
    validate_key_servers(vector[object::id_from_address(@0x100)], vector[65535], 1);
}

#[test, expected_failure(
    abort_code = 8,
    location = animacraft_v8_core::package_binding_v8,
)]
fun setup_rejects_same_package_wrong_witness_struct() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 13, 0, 0, 0);
    let (config, protocol_admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = package_binding::product_release_catalog_for_testing(
        &config,
        protocol::config_core_original_package_id_v8(&config).to_address(),
        protocol::config_core_callable_package_id_v8(&config).to_address(),
        type_name::original_id<SealOriginalMarkerV8>(),
        type_name::defining_id<SealCallableMarkerV8>(),
        &mut ctx);
    let cap = package_binding::take_seal_call_cap_v8(
        &config, &protocol_admin, &mut catalog);
    let config_uid = object::new(&mut ctx);
    let config_id = config_uid.to_inner();
    config_uid.delete();
    let _ = package_binding::consume_seal_call_cap_v8(
        &mut catalog, cap, WrongSealSetupInstallWitnessV2 {}, config_id,
        test_hash(1), test_hash(2), test_hash(3));
    package_binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_admin);
}

#[test, expected_failure(
    abort_code = 8,
    location = animacraft_v8_core::package_binding_v8,
)]
fun setup_rejects_call_cap_from_another_catalog() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 14, 0, 0, 0);
    let (config, protocol_admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut source = package_binding::product_release_catalog_for_testing(
        &config,
        protocol::config_core_original_package_id_v8(&config).to_address(),
        protocol::config_core_callable_package_id_v8(&config).to_address(),
        type_name::original_id<SealOriginalMarkerV8>(),
        type_name::defining_id<SealCallableMarkerV8>(),
        &mut ctx);
    let mut target = package_binding::product_release_catalog_for_testing(
        &config,
        protocol::config_core_original_package_id_v8(&config).to_address(),
        protocol::config_core_callable_package_id_v8(&config).to_address(),
        type_name::original_id<SealOriginalMarkerV8>(),
        type_name::defining_id<SealCallableMarkerV8>(),
        &mut ctx);
    let cap = package_binding::take_seal_call_cap_v8(
        &config, &protocol_admin, &mut source);
    // Advance the target through actual setup so the cross-catalog cap check,
    // rather than the earlier setup-order guard, is the tested rejection.
    let target_cap = package_binding::take_seal_call_cap_v8(
        &config, &protocol_admin, &mut target);
    package_binding::destroy_call_cap_for_testing(target_cap);
    let policy = new_seal_policy_config_v8(
        &config, &protocol_admin, &mut target, cap,
        vector[object::id_from_address(@0x100)], vector[1], 1,
        CIPHER_SUITE.to_string(), KEY_DERIVATION.to_string(),
        CIPHERTEXT_FORMAT.to_string(),
        MAX_PLAINTEXT_BYTES, &mut ctx);
    destroy_policy_for_testing(policy);
    package_binding::destroy_catalog_for_testing(source);
    package_binding::destroy_catalog_for_testing(target);
    protocol::destroy_protocol_for_testing(config, protocol_admin);
}
