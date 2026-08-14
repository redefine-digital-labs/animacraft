/// Exact Sui Seal policy for fresh Animacraft v8 ciphertexts. The package
/// depends only on Core and the pinned Sui framework. Its entry functions are
/// the policy calls dry-run by Sui Seal key servers before releasing shares.
module animacraft_v8_seal::seal_v8;

use animacraft_v8_core::activation_v8 as activation;
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
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const MAX_KEY_SERVERS: u64 = 64;
const MAX_SCOPE_KEY_BYTES: u64 = 256;
const MAX_ASSET_KEY_BYTES: u64 = 512;
const MAX_BLOB_ID_BYTES: u64 = 512;
const MAX_PROTECTED_ASSETS: u64 = 100_000;

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

public struct KeyServerBindingV8 has copy, drop, store {
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
    seal_call_cap: PackageCallCapV8<SealRoleV8>,
    key_servers: vector<KeyServerBindingV8>,
    threshold: u16,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
    commitment: vector<u8>,
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
    expected_count: u64,
    observed_base_count: u64,
    observed_pack_count: u64,
    observed_complete_count: u64,
    observed_count: u64,
    expected_commitment: vector<u8>,
    rolling_commitment: vector<u8>,
    sealed: bool,
    keys: vector<ProtectedAssetKeyV8>,
    assets: Table<ProtectedAssetKeyV8, ProtectedAssetV8>,
    runtime_revision: u64,
    runtime_commitment: vector<u8>,
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

/// Private intermediate witness proves the Seal module itself performed all
/// readiness checks. Its fields and constructor are inaccessible externally.
public struct PrivateSealReadinessWitnessV8 {
    registry_id: ID,
    policy_config_id: ID,
    key_server_ids: vector<ID>,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    seal_authority_id: ID,
    call_cap_set_commitment: vector<u8>,
    registry_commitment: vector<u8>,
    base_count: u64,
    pack_count: u64,
    complete_count: u64,
    total_count: u64,
}

/// Release-facing exact readiness. It has no abilities, so it cannot be
/// persisted, replayed, copied, or discarded by a caller.
public struct SealReadinessV8 {
    registry_id: ID,
    policy_config_id: ID,
    key_server_ids: vector<ID>,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    seal_authority_id: ID,
    call_cap_set_commitment: vector<u8>,
    registry_commitment: vector<u8>,
    base_count: u64,
    pack_count: u64,
    complete_count: u64,
    total_count: u64,
}

public struct SealPolicyCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, protocol_config_id: ID,
    protocol_config_revision: u64, catalog_id: ID,
    product_binding_commitment: vector<u8>, seal_original_package_id: ID,
    seal_callable_package_id: ID, seal_binding_commitment: vector<u8>,
    seal_authority_id: ID, call_cap_set_commitment: vector<u8>,
    key_servers: vector<KeyServerBindingV8>, threshold: u16,
    key_server_set_commitment: vector<u8>, encryption_policy_commitment: vector<u8>,
}

public struct CiphertextCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, catalog_id: ID,
    product_binding_commitment: vector<u8>, policy_commitment: vector<u8>,
    root_content_commitment: vector<u8>, maker_version: u64, scope_kind: u8,
    scope_key: String, scope_commitment: vector<u8>, asset_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
}

public struct SealIdInputV8 has drop {
    domain: vector<u8>, version: u64, product_binding_commitment: vector<u8>,
    policy_commitment: vector<u8>, root_content_commitment: vector<u8>,
    maker_version: u64, scope_kind: u8, scope_key: String,
    scope_commitment: vector<u8>, asset_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
}

public struct EmptyRegistryCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, product_binding_commitment: vector<u8>,
    policy_commitment: vector<u8>, root_content_commitment: vector<u8>,
    maker_version: u64,
}

public struct CompleteInstanceCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, recipe_commitment: vector<u8>,
    render_commitment: vector<u8>, output_commitment: vector<u8>,
    receipt_commitment: vector<u8>,
}

public struct RegistryRowCommitmentInputV8 has drop {
    domain: vector<u8>, version: u64, root_content_commitment: vector<u8>,
    maker_version: u64, sequence: u64, prior_commitment: vector<u8>,
    row: ProtectedAssetV8,
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
    catalog: &ProductReleaseCatalogV8,
    seal_call_cap: PackageCallCapV8<SealRoleV8>,
    key_server_ids: vector<ID>,
    weights: vector<u16>,
    threshold: u16,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): SealPolicyConfigV8 {
    protocol::assert_protocol_admin_v8(protocol_config, protocol_admin);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    package_binding::assert_seal_call_cap_v8(catalog, &seal_call_cap);
    let product = package_binding::catalog_binding_v8(catalog);
    let seal = package_binding::seal_binding_v8(product);
    package_binding::assert_type_origins_v8<SealOriginalMarkerV8, SealCallableMarkerV8>(seal);
    let key_servers = validate_key_servers(key_server_ids, weights, threshold);
    assert_hash(&key_server_set_commitment);
    assert_hash(&encryption_policy_commitment);
    let protocol_config_id = protocol::config_id_v8(protocol_config);
    let protocol_config_revision = protocol::config_revision_v8(protocol_config);
    let catalog_id = package_binding::catalog_id_v8(catalog);
    let product_binding_commitment = *package_binding::product_binding_commitment_v8(product);
    let seal_original_package_id = package_binding::original_package_id_v8(seal);
    let seal_callable_package_id = package_binding::callable_package_id_v8(seal);
    let seal_binding_commitment = *package_binding::exact_binding_commitment_v8(seal);
    let seal_authority_id = package_binding::call_cap_authority_id_v8(&seal_call_cap);
    let call_cap_set_commitment = *package_binding::call_cap_set_commitment_v8(
        package_binding::catalog_call_cap_set_v8(catalog));
    let commitment = derive_policy_commitment(
        protocol_config_id, protocol_config_revision, catalog_id,
        product_binding_commitment, seal_original_package_id,
        seal_callable_package_id, seal_binding_commitment, seal_authority_id,
        call_cap_set_commitment, key_servers,
        threshold, key_server_set_commitment, encryption_policy_commitment,
    );
    let result = SealPolicyConfigV8 {
        id: object::new(ctx), version: VERSION, protocol_config_id,
        protocol_config_revision, catalog_id, product_binding_commitment,
        seal_original_package_id, seal_callable_package_id,
        seal_binding_commitment, seal_authority_id, call_cap_set_commitment,
        seal_call_cap, key_servers, threshold,
        key_server_set_commitment, encryption_policy_commitment, commitment,
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

public fun empty_registry_commitment_v8(
    product_binding_commitment: vector<u8>,
    policy_commitment: vector<u8>,
    root_content_commitment: vector<u8>,
    maker_version: u64,
): vector<u8> {
    assert_hash(&product_binding_commitment);
    assert_hash(&policy_commitment);
    assert_hash(&root_content_commitment);
    assert!(maker_version > 0, EInvalidBinding);
    hash::sha2_256(bcs::to_bytes(&EmptyRegistryCommitmentInputV8 {
        domain: b"animacraft-v8/seal/registry-empty", version: VERSION,
        product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version,
    }))
}

public fun empty_runtime_commitment_v8(
    product_binding_commitment: vector<u8>, policy_commitment: vector<u8>,
    root_content_commitment: vector<u8>, maker_version: u64,
): vector<u8> {
    assert_hash(&product_binding_commitment);
    assert_hash(&policy_commitment);
    assert_hash(&root_content_commitment);
    hash::sha2_256(bcs::to_bytes(&EmptyRegistryCommitmentInputV8 {
        domain: b"animacraft-v8/seal/runtime-empty", version: VERSION,
        product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version,
    }))
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
    hash::sha2_256(bcs::to_bytes(&CompleteInstanceCommitmentInputV8 {
        domain: b"animacraft-v8/seal/complete-instance", version: VERSION,
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
    hash::sha2_256(bcs::to_bytes(&CiphertextCommitmentInputV8 {
        domain: b"animacraft-v8/seal/ciphertext-certification", version: VERSION,
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
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>,
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
    assert_hash(&certification_commitment);
    hash::sha2_256(bcs::to_bytes(&SealIdInputV8 {
        domain: b"animacraft-v8/seal/ciphertext-id", version: VERSION,
        product_binding_commitment, policy_commitment,
        root_content_commitment, maker_version, scope_kind, scope_key,
        scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment,
        certification_commitment,
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
        root, package_binding::release_binding_v8(
            maker::root_product_release_binding_v8(root)));
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
        maker_version, scope_kind, scope_key, scope_commitment, asset_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment,
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
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): SealRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    assert_policy_root(policy, root);
    let expected_count = checked_total(expected_base_count, expected_pack_count, expected_complete_count);
    assert!(expected_count <= MAX_PROTECTED_ASSETS, EInvalidCount);
    assert_hash(&expected_commitment);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let rolling_commitment = empty_registry_commitment_v8(
        policy.product_binding_commitment, policy.commitment,
        root_content_commitment, maker_version,
    );
    if (expected_count == 0) assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    SealRegistryV8 {
        id: object::new(ctx), version: VERSION, root_id: maker::root_id_v8(root),
        maker_version, root_content_commitment, catalog_id: policy.catalog_id,
        product_binding_commitment: policy.product_binding_commitment,
        policy_config_id: object::id(policy), policy_commitment: policy.commitment,
        expected_base_count, expected_pack_count, expected_complete_count,
        expected_count, observed_base_count: 0, observed_pack_count: 0,
        observed_complete_count: 0, observed_count: 0, expected_commitment,
        rolling_commitment, sealed: false, keys: vector[], assets: table::new(ctx),
        runtime_revision: 0,
        runtime_commitment: empty_runtime_commitment_v8(
            policy.product_binding_commitment, policy.commitment,
            root_content_commitment, maker_version),
        runtime_keys: vector[], runtime_assets: table::new(ctx),
    }
}

public fun share_seal_registry_v8(registry: SealRegistryV8) {
    transfer::share_object(registry);
}

public fun advance_registry_commitment_v8(
    root_content_commitment: vector<u8>,
    maker_version: u64,
    sequence: u64,
    prior_commitment: vector<u8>,
    row: ProtectedAssetV8,
): vector<u8> {
    assert_hash(&root_content_commitment);
    assert_hash(&prior_commitment);
    assert_valid_row(&row);
    hash::sha2_256(bcs::to_bytes(&RegistryRowCommitmentInputV8 {
        domain: b"animacraft-v8/seal/registry-row", version: VERSION,
        root_content_commitment, maker_version, sequence, prior_commitment, row,
    }))
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
    assert!(sequence == registry.observed_count, EInvalidSequence);
    assert!(sequence < registry.expected_count, EInvalidCount);
    let row = consume_certification(certification, registry, policy);
    assert_scope_count_available(registry, row.scope_kind);
    let key = ProtectedAssetKeyV8 {
        scope_kind: row.scope_kind, scope_key: row.scope_key, asset_key: row.asset_key,
    };
    assert!(!registry.assets.contains(key), EDuplicateAsset);
    let next = advance_registry_commitment_v8(
        registry.root_content_commitment, registry.maker_version, sequence,
        registry.rolling_commitment, row,
    );
    let seal_id = row.seal_id;
    let scope_kind = row.scope_kind;
    registry.assets.add(key, row);
    registry.keys.push_back(key);
    registry.observed_count = registry.observed_count + 1;
    if (scope_kind == SCOPE_BASE) registry.observed_base_count = registry.observed_base_count + 1
    else if (scope_kind == SCOPE_PACK) registry.observed_pack_count = registry.observed_pack_count + 1
    else registry.observed_complete_count = registry.observed_complete_count + 1;
    registry.rolling_commitment = next;
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
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    registry.sealed = true;
    event::emit(SealRegistrySealedV8 {
        registry_id: object::id(registry), root_id: registry.root_id,
        total_count: registry.observed_count, commitment: registry.rolling_commitment,
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
        root, package_binding::runtime_binding_v8(
            maker::root_product_release_binding_v8(root)));
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
        root, package_binding::release_binding_v8(
            maker::root_product_release_binding_v8(root)));
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
        root, package_binding::runtime_binding_v8(
            maker::root_product_release_binding_v8(root)));
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
        root, package_binding::runtime_binding_v8(
            maker::root_product_release_binding_v8(root)));
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
        root, package_binding::release_binding_v8(
            maker::root_product_release_binding_v8(root)));
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

/// Sui Seal key servers dry-run this entry. The proof must be minted in the
/// same PTB from a live Runtime entitlement and cannot be persisted/replayed.
entry fun seal_approve_base_v8<PaymentCoin>(
    id: vector<u8>, registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
    proof: BaseDecryptProofV8, ctx: &TxContext,
) {
    assert!(check_base_access(registry, policy, root, &proof, ctx.sender(), &id), ENoAccess);
    let BaseDecryptProofV8 { root_id: _, maker_version: _, root_content_commitment: _,
        holder: _, entitlement_id: _, entitlement_commitment: _, scope_key: _,
        asset_key: _, seal_id: _ } = proof;
}

entry fun seal_approve_pack_v8<PaymentCoin>(
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

entry fun seal_approve_complete_v8<PaymentCoin>(
    id: vector<u8>, registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
    proof: CompleteDecryptProofV8, ctx: &TxContext,
) {
    let (_, _, _, _, _, _, _, _, _) = consume_complete_decrypt_proof_v8(
        id, registry, policy, root, proof, ctx);
}

public fun issue_seal_readiness_v8<PaymentCoin>(
    registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
): SealReadinessV8 {
    let private = new_private_readiness(registry, policy, root);
    let PrivateSealReadinessWitnessV8 {
        registry_id, policy_config_id, key_server_ids,
        key_server_set_commitment, encryption_policy_commitment, root_id,
        maker_version, root_content_commitment, catalog_id,
        product_binding_commitment, seal_authority_id,
        call_cap_set_commitment, registry_commitment, base_count,
        pack_count, complete_count, total_count,
    } = private;
    SealReadinessV8 {
        registry_id, policy_config_id, key_server_ids,
        key_server_set_commitment, encryption_policy_commitment, root_id,
        maker_version, root_content_commitment, catalog_id,
        product_binding_commitment, seal_authority_id,
        call_cap_set_commitment, registry_commitment, base_count,
        pack_count, complete_count, total_count,
    }
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
        row.scope_kind, row.scope_key, row.scope_commitment, row.asset_key,
        row.asset_content_commitment, row.ciphertext_blob_id,
        row.ciphertext_sha256, row.ciphertext_blob_commitment,
        row.certification_commitment), EInvalidCommitment);
    ProtectedAssetSnapshotV8 {
        registry_id: object::id(registry),
        registry_commitment: registry.rolling_commitment,
        runtime_revision: registry.runtime_revision,
        runtime_commitment: registry.runtime_commitment,
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

/// The only production terminal-readiness path. Seal consumes and revalidates
/// its local no-ability witness, then uses the capability privately nested in
/// the immutable policy to ask Core to certify both live Seal objects.
public fun certify_activation_readiness_v8<PaymentCoin>(
    readiness: SealReadinessV8,
    registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
): activation::SealReadinessV8 {
    package_binding::assert_seal_call_cap_v8(catalog, &policy.seal_call_cap);
    assert_catalog_root(catalog, root);
    let companion_commitment = consume_local_readiness(readiness, registry, policy, root);
    activation::certify_seal_readiness_v8<
        PaymentCoin,
        SealOriginalMarkerV8,
        SealCallableMarkerV8,
        SealPolicyConfigV8,
        SealRegistryV8,
    >(root, catalog, &policy.seal_call_cap, policy, registry, companion_commitment)
}

fun consume_local_readiness<PaymentCoin>(
    readiness: SealReadinessV8,
    registry: &SealRegistryV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
): vector<u8> {
    let companion_commitment = local_readiness_commitment(&readiness);
    let current = new_private_readiness(registry, policy, root);
    let PrivateSealReadinessWitnessV8 {
        registry_id: current_registry_id, policy_config_id: current_policy_config_id,
        key_server_ids: current_key_server_ids,
        key_server_set_commitment: current_key_server_set_commitment,
        encryption_policy_commitment: current_encryption_policy_commitment,
        root_id: current_root_id, maker_version: current_maker_version,
        root_content_commitment: current_root_content_commitment,
        catalog_id: current_catalog_id,
        product_binding_commitment: current_product_binding_commitment,
        seal_authority_id: current_seal_authority_id,
        call_cap_set_commitment: current_call_cap_set_commitment,
        registry_commitment: current_registry_commitment,
        base_count: current_base_count, pack_count: current_pack_count,
        complete_count: current_complete_count, total_count: current_total_count,
    } = current;
    let SealReadinessV8 {
        registry_id, policy_config_id, key_server_ids,
        key_server_set_commitment, encryption_policy_commitment, root_id,
        maker_version, root_content_commitment, catalog_id,
        product_binding_commitment, seal_authority_id,
        call_cap_set_commitment, registry_commitment, base_count,
        pack_count, complete_count, total_count,
    } = readiness;
    assert!(registry_id == current_registry_id && policy_config_id == current_policy_config_id, EInvalidProof);
    assert!(key_server_ids == current_key_server_ids, EInvalidProof);
    assert!(key_server_set_commitment == current_key_server_set_commitment, EInvalidProof);
    assert!(encryption_policy_commitment == current_encryption_policy_commitment, EInvalidProof);
    assert!(root_id == current_root_id && maker_version == current_maker_version, EInvalidProof);
    assert!(root_content_commitment == current_root_content_commitment, EInvalidProof);
    assert!(catalog_id == current_catalog_id, EInvalidProof);
    assert!(product_binding_commitment == current_product_binding_commitment, EInvalidProof);
    assert!(seal_authority_id == current_seal_authority_id, EInvalidProof);
    assert!(call_cap_set_commitment == current_call_cap_set_commitment, EInvalidProof);
    assert!(registry_commitment == current_registry_commitment, EInvalidProof);
    assert!(base_count == current_base_count && pack_count == current_pack_count, EInvalidProof);
    assert!(complete_count == current_complete_count && total_count == current_total_count, EInvalidProof);
    companion_commitment
}

fun local_readiness_commitment(readiness: &SealReadinessV8): vector<u8> {
    let mut encoded = b"animacraft-v8/seal/activation-readiness";
    let version = VERSION;
    encoded.append(bcs::to_bytes(&version));
    encoded.append(bcs::to_bytes(readiness));
    hash::sha2_256(encoded)
}

fun new_private_readiness<PaymentCoin>(
    registry: &SealRegistryV8, policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
): PrivateSealReadinessWitnessV8 {
    maker::assert_draft_v8(root);
    assert_registry_binding(registry, root, policy);
    assert!(registry.sealed, ERegistryNotSealed);
    assert_counts_exact(registry);
    assert!(registry.rolling_commitment == registry.expected_commitment, EInvalidCommitment);
    PrivateSealReadinessWitnessV8 {
        registry_id: object::id(registry), policy_config_id: object::id(policy),
        key_server_ids: key_server_ids(policy),
        key_server_set_commitment: policy.key_server_set_commitment,
        encryption_policy_commitment: policy.encryption_policy_commitment,
        root_id: registry.root_id, maker_version: registry.maker_version,
        root_content_commitment: registry.root_content_commitment,
        catalog_id: registry.catalog_id,
        product_binding_commitment: registry.product_binding_commitment,
        seal_authority_id: policy.seal_authority_id,
        call_cap_set_commitment: policy.call_cap_set_commitment,
        registry_commitment: registry.rolling_commitment,
        base_count: registry.observed_base_count,
        pack_count: registry.observed_pack_count,
        complete_count: registry.observed_complete_count,
        total_count: registry.observed_count,
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
        row.scope_kind, row.scope_key, row.scope_commitment, row.asset_key,
        row.asset_content_commitment, row.ciphertext_blob_id,
        row.ciphertext_sha256, row.ciphertext_blob_commitment,
        row.certification_commitment,
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
    let next = advance_registry_commitment_v8(
        registry.root_content_commitment, registry.maker_version,
        expected_revision, registry.runtime_commitment, row);
    let seal_id = row.seal_id;
    let scope_kind = row.scope_kind;
    registry.runtime_assets.add(key, row);
    registry.runtime_keys.push_back(key);
    registry.runtime_revision = expected_revision + 1;
    registry.runtime_commitment = next;
    event::emit(RuntimeProtectedAssetRegisteredV8 {
        registry_id: object::id(registry), root_id: registry.root_id,
        previous_revision: expected_revision, new_revision: expected_revision + 1,
        scope_kind, seal_id, runtime_commitment: next,
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
        && registry.observed_count == registry.expected_count
        && registry.rolling_commitment == registry.expected_commitment
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
        maker_version, scope_kind, scope_key, scope_commitment, asset_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment,
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
    let product = maker::root_product_release_binding_v8(root);
    let seal = package_binding::seal_binding_v8(product);
    package_binding::assert_type_origins_v8<SealOriginalMarkerV8, SealCallableMarkerV8>(seal);
    assert!(policy.catalog_id == maker::root_product_release_catalog_id_v8(root), ECatalogMismatch);
    assert!(&policy.product_binding_commitment == package_binding::product_binding_commitment_v8(product), EInvalidBinding);
    assert!(policy.seal_original_package_id == package_binding::original_package_id_v8(seal), EInvalidBinding);
    assert!(policy.seal_callable_package_id == package_binding::callable_package_id_v8(seal), EInvalidBinding);
    assert!(&policy.seal_binding_commitment == package_binding::exact_binding_commitment_v8(seal), EInvalidBinding);
    let call_cap_set = maker::root_product_release_call_cap_set_v8(root);
    assert!(policy.seal_authority_id == package_binding::seal_authority_id_v8(call_cap_set), EInvalidBinding);
    assert!(&policy.call_cap_set_commitment == package_binding::call_cap_set_commitment_v8(call_cap_set), EInvalidBinding);
    assert!(policy.seal_authority_id == package_binding::call_cap_authority_id_v8(&policy.seal_call_cap), EInvalidBinding);
}

fun assert_role_witness<PaymentCoin, OriginalMarker, CallableWitness>(
    _root: &MakerRootV8<PaymentCoin>,
    binding: &ExactPackageBindingV8,
) {
    package_binding::assert_type_origins_v8<OriginalMarker, CallableWitness>(binding);
}

fun assert_catalog_root<PaymentCoin>(
    catalog: &ProductReleaseCatalogV8, root: &MakerRootV8<PaymentCoin>,
) {
    assert!(package_binding::catalog_id_v8(catalog) == maker::root_product_release_catalog_id_v8(root), ECatalogMismatch);
    assert!(package_binding::product_binding_commitment_v8(package_binding::catalog_binding_v8(catalog))
        == package_binding::product_binding_commitment_v8(maker::root_product_release_binding_v8(root)), ECatalogMismatch);
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
): vector<KeyServerBindingV8> {
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
        result.push_back(KeyServerBindingV8 { key_server_id: id, weight });
        index = index + 1;
    };
    assert!(threshold > 0 && (threshold as u64) <= total, EInvalidKeyServers);
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

fun derive_policy_commitment(
    protocol_config_id: ID, protocol_config_revision: u64, catalog_id: ID,
    product_binding_commitment: vector<u8>, seal_original_package_id: ID,
    seal_callable_package_id: ID, seal_binding_commitment: vector<u8>,
    seal_authority_id: ID, call_cap_set_commitment: vector<u8>,
    key_servers: vector<KeyServerBindingV8>, threshold: u16,
    key_server_set_commitment: vector<u8>, encryption_policy_commitment: vector<u8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&SealPolicyCommitmentInputV8 {
        domain: b"animacraft-v8/seal/policy", version: VERSION,
        protocol_config_id, protocol_config_revision, catalog_id,
        product_binding_commitment, seal_original_package_id,
        seal_callable_package_id, seal_binding_commitment, seal_authority_id,
        call_cap_set_commitment, key_servers,
        threshold, key_server_set_commitment, encryption_policy_commitment,
    }))
}

fun key_server_ids(policy: &SealPolicyConfigV8): vector<ID> {
    let mut result = vector[];
    let mut index = 0;
    while (index < policy.key_servers.length()) {
        result.push_back(policy.key_servers[index].key_server_id);
        index = index + 1;
    };
    result
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
    if (scope_kind == SCOPE_BASE) assert!(registry.observed_base_count < registry.expected_base_count, EInvalidCount)
    else if (scope_kind == SCOPE_PACK) assert!(registry.observed_pack_count < registry.expected_pack_count, EInvalidCount)
    else assert!(registry.observed_complete_count < registry.expected_complete_count, EInvalidCount);
}

fun assert_counts_exact(registry: &SealRegistryV8) {
    assert!(registry.observed_base_count == registry.expected_base_count, EInvalidCount);
    assert!(registry.observed_pack_count == registry.expected_pack_count, EInvalidCount);
    assert!(registry.observed_complete_count == registry.expected_complete_count, EInvalidCount);
    assert!(registry.observed_count == registry.expected_count, EInvalidCount);
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
public fun registry_expected_count_v8(registry: &SealRegistryV8): u64 { registry.expected_count }
public fun registry_observed_count_v8(registry: &SealRegistryV8): u64 { registry.observed_count }
public fun registry_sealed_v8(registry: &SealRegistryV8): bool { registry.sealed }
public fun registry_commitment_v8(registry: &SealRegistryV8): &vector<u8> { &registry.rolling_commitment }
public fun registry_expected_commitment_v8(registry: &SealRegistryV8): &vector<u8> { &registry.expected_commitment }
public fun registry_runtime_revision_v8(registry: &SealRegistryV8): u64 { registry.runtime_revision }
public fun registry_runtime_commitment_v8(registry: &SealRegistryV8): &vector<u8> { &registry.runtime_commitment }
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
    catalog: &ProductReleaseCatalogV8,
    seal_call_cap: PackageCallCapV8<SealRoleV8>,
    key_server_ids: vector<ID>, weights: vector<u16>, threshold: u16,
    key_server_set_commitment: vector<u8>, encryption_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): SealPolicyConfigV8 {
    let product = package_binding::catalog_binding_v8(catalog);
    let seal = package_binding::seal_binding_v8(product);
    let key_servers = validate_key_servers(key_server_ids, weights, threshold);
    let protocol_config_id = protocol::config_id_v8(protocol_config);
    let protocol_config_revision = protocol::config_revision_v8(protocol_config);
    let catalog_id = package_binding::catalog_id_v8(catalog);
    let product_binding_commitment = *package_binding::product_binding_commitment_v8(product);
    let seal_original_package_id = package_binding::original_package_id_v8(seal);
    let seal_callable_package_id = package_binding::callable_package_id_v8(seal);
    let seal_binding_commitment = *package_binding::exact_binding_commitment_v8(seal);
    package_binding::assert_seal_call_cap_v8(catalog, &seal_call_cap);
    let seal_authority_id = package_binding::call_cap_authority_id_v8(&seal_call_cap);
    let call_cap_set_commitment = *package_binding::call_cap_set_commitment_v8(
        package_binding::catalog_call_cap_set_v8(catalog));
    let commitment = derive_policy_commitment(protocol_config_id,
        protocol_config_revision, catalog_id, product_binding_commitment,
        seal_original_package_id, seal_callable_package_id,
        seal_binding_commitment, seal_authority_id, call_cap_set_commitment,
        key_servers, threshold,
        key_server_set_commitment, encryption_policy_commitment);
    SealPolicyConfigV8 { id: object::new(ctx), version: VERSION,
        protocol_config_id, protocol_config_revision, catalog_id,
        product_binding_commitment, seal_original_package_id,
        seal_callable_package_id, seal_binding_commitment, key_servers,
        seal_authority_id, call_cap_set_commitment, seal_call_cap,
        threshold, key_server_set_commitment, encryption_policy_commitment,
        commitment }
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
        scope_key, scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment,
        certification_commitment);
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
    expected_commitment: vector<u8>, ctx: &mut TxContext,
): SealRegistryV8 {
    maker::assert_draft_admin_v8(root, admin);
    let expected_count = checked_total(expected_base_count, expected_pack_count, expected_complete_count);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let rolling_commitment = empty_registry_commitment_v8(
        policy.product_binding_commitment, policy.commitment,
        root_content_commitment, maker_version);
    if (expected_count == 0) assert!(expected_commitment == rolling_commitment, EInvalidCommitment);
    SealRegistryV8 { id: object::new(ctx), version: VERSION,
        root_id: maker::root_id_v8(root), maker_version,
        root_content_commitment, catalog_id: policy.catalog_id,
        product_binding_commitment: policy.product_binding_commitment,
        policy_config_id: object::id(policy), policy_commitment: policy.commitment,
        expected_base_count, expected_pack_count, expected_complete_count,
        expected_count, observed_base_count: 0, observed_pack_count: 0,
        observed_complete_count: 0, observed_count: 0, expected_commitment,
        rolling_commitment, sealed: false, keys: vector[], assets: table::new(ctx),
        runtime_revision: 0,
        runtime_commitment: empty_runtime_commitment_v8(
            policy.product_binding_commitment, policy.commitment,
            root_content_commitment, maker_version),
        runtime_keys: vector[], runtime_assets: table::new(ctx) }
}

#[test_only]
public fun certification_and_next_for_testing<PaymentCoin>(
    policy: &SealPolicyConfigV8, root: &MakerRootV8<PaymentCoin>,
    sequence: u64, prior_commitment: vector<u8>, scope_kind: u8,
    scope_key: String, scope_commitment: vector<u8>, asset_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
): (CiphertextCertificationV8, vector<u8>, vector<u8>) {
    let certification = certification_for_testing(policy, root, scope_kind,
        scope_key, scope_commitment, asset_key, asset_content_commitment,
        ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment);
    let row = ProtectedAssetV8 { scope_kind: certification.scope_kind,
        scope_key: certification.scope_key,
        scope_commitment: certification.scope_commitment,
        asset_key: certification.asset_key,
        asset_content_commitment: certification.asset_content_commitment,
        ciphertext_blob_id: certification.ciphertext_blob_id,
        ciphertext_sha256: certification.ciphertext_sha256,
        ciphertext_blob_commitment: certification.ciphertext_blob_commitment,
        certification_commitment: certification.certification_commitment,
        seal_id: certification.seal_id };
    let next = advance_registry_commitment_v8(
        *maker::root_content_commitment_v8(root),
        maker::root_maker_version_v8(root), sequence, prior_commitment, row);
    let id = certification.seal_id;
    (certification, next, id)
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
    let empty = empty_registry_commitment_v8(
        policy.product_binding_commitment,
        policy.commitment,
        *maker::root_content_commitment_v8(&root),
        maker::root_maker_version_v8(&root),
    );
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 0, 0, 0, empty, ctx);
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
        call_cap_set_commitment: _, seal_call_cap, key_servers: _, threshold: _,
        key_server_set_commitment: _, encryption_policy_commitment: _, commitment: _ } = policy;
    package_binding::destroy_call_cap_for_testing(seal_call_cap);
    id.delete();
}

#[test_only]
public fun destroy_registry_for_testing(registry: SealRegistryV8) {
    let SealRegistryV8 { id, version: _, root_id: _, maker_version: _,
        root_content_commitment: _, catalog_id: _, product_binding_commitment: _,
        policy_config_id: _, policy_commitment: _, expected_base_count: _,
        expected_pack_count: _, expected_complete_count: _, expected_count: _,
        observed_base_count: _, observed_pack_count: _, observed_complete_count: _,
        observed_count: _, expected_commitment: _, rolling_commitment: _, sealed: _,
        mut keys, mut assets, runtime_revision: _, runtime_commitment: _,
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
    let counts = base::new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let tracks = base::empty_category_commitment_v8(content, base::category_track_v8());
    let parts = base::empty_category_commitment_v8(content, base::category_part_v8());
    let items = base::empty_category_commitment_v8(content, base::category_item_v8());
    let styles = base::empty_category_commitment_v8(content, base::category_style_v8());
    let colors = base::empty_category_commitment_v8(content, base::category_color_v8());
    let rules = base::empty_category_commitment_v8(content, base::category_rule_v8());
    let commitments = base::new_base_definition_commitments_v8(
        tracks, parts, items, styles, colors, rules, test_hash(17));
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
        &config, maker::access_free_v8(), 0,
        maker::complete_unlimited_free_v8(), 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, base_registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<sui::sui::SUI>(
        &config, b"maker-semantic-key".to_string(), test_hash(11),
        b"walrus-manifest".to_string(), test_hash(12), content,
        counts, commitments, test_hash(13), economics, rights, &clock, ctx);
    clock.destroy_for_testing();
    let mut catalog = package_binding::product_release_catalog_for_testing(
        &config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        ctx);
    let witness = package_binding::release_catalog_witness_for_testing(&catalog);
    maker::finalize_product_release_binding_v8(
        &mut root, &admin, &config, witness, ctx);
    let seal_call_cap = package_binding::take_seal_call_cap_v8(
        &config, &protocol_admin, &mut catalog);
    let policy = new_policy_for_testing(
        &config, &catalog, seal_call_cap,
        vector[object::id_from_address(@0x100), object::id_from_address(@0x200)],
        vector[2, 3], 4, test_hash(14), test_hash(15), ctx);
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

#[test_only]
fun destroy_readiness_for_testing(readiness: SealReadinessV8) {
    let SealReadinessV8 { registry_id: _, policy_config_id: _, key_server_ids: _,
        key_server_set_commitment: _, encryption_policy_commitment: _, root_id: _,
        maker_version: _, root_content_commitment: _, catalog_id: _,
        product_binding_commitment: _, seal_authority_id: _,
        call_cap_set_commitment: _, registry_commitment: _, base_count: _,
        pack_count: _, complete_count: _, total_count: _ } = readiness;
}

#[test]
fun seal_identity_commits_to_every_certified_field() {
    let binding = test_hash(1);
    let policy = test_hash(2);
    let root = test_hash(3);
    let scope = test_hash(4);
    let asset = test_hash(5);
    let ciphertext = test_hash(6);
    let blob = test_hash(7);
    let cert = test_hash(8);
    let id = derive_seal_id_v8(binding, policy, root, 1, SCOPE_BASE,
        b"maker/base".to_string(), scope, b"part/item/style".to_string(),
        asset, b"blob-a".to_string(), ciphertext, blob, cert);
    assert!(id != derive_seal_id_v8(binding, policy, root, 2, SCOPE_BASE,
        b"maker/base".to_string(), scope, b"part/item/style".to_string(),
        asset, b"blob-a".to_string(), ciphertext, blob, cert), EInvalidCommitment);
    assert!(id != derive_seal_id_v8(binding, policy, root, 1, SCOPE_PACK,
        b"maker/base".to_string(), scope, b"part/item/style".to_string(),
        asset, b"blob-a".to_string(), ciphertext, blob, cert), EInvalidCommitment);
    assert!(id != derive_seal_id_v8(binding, policy, root, 1, SCOPE_BASE,
        b"maker/base".to_string(), scope, b"part/item/style".to_string(),
        asset, b"blob-b".to_string(), ciphertext, blob, cert), EInvalidCommitment);
    assert!(id != derive_seal_id_v8(binding, policy, root, 1, SCOPE_BASE,
        b"maker/base".to_string(), scope, b"part/item/style".to_string(),
        asset, b"blob-a".to_string(), test_hash(9), blob, cert), EInvalidCommitment);
}

#[test]
fun explicit_zero_row_registry_seals_and_issues_exact_readiness() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, protocol_admin, root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(
        policy.product_binding_commitment, policy.commitment,
        *maker::root_content_commitment_v8(&root), maker::root_maker_version_v8(&root));
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 0, 0, 0, empty, &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    assert!(registry_sealed_v8(&registry), ERegistryNotSealed);
    assert!(registry_observed_count_v8(&registry) == 0, EInvalidCount);
    let readiness = issue_seal_readiness_v8(&registry, &policy, &root);
    assert!(readiness.registry_id == object::id(&registry), EInvalidProof);
    assert!(readiness.policy_config_id == object::id(&policy), EInvalidProof);
    assert!(readiness.key_server_ids == vector[
        object::id_from_address(@0x100), object::id_from_address(@0x200)], EInvalidProof);
    assert!(readiness.total_count == 0, EInvalidCount);
    assert!(readiness.seal_authority_id == policy.seal_authority_id, EInvalidProof);
    assert!(readiness.call_cap_set_commitment == policy.call_cap_set_commitment, EInvalidProof);
    destroy_readiness_for_testing(readiness);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, &ctx);
}

#[test]
fun base_pack_complete_rows_append_in_exact_sequence_and_approve() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let (config, protocol_admin, mut root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root),
        maker::root_maker_version_v8(&root));
    let (base_cert, after_base, base_id) = certification_and_next_for_testing(
        &policy, &root, 0, empty, SCOPE_BASE, b"maker/base".to_string(),
        test_hash(21), b"body/base/style-a".to_string(), test_hash(31),
        b"blob-base".to_string(), test_hash(41), test_hash(51));
    let (pack_cert, after_pack, pack_id) = certification_and_next_for_testing(
        &policy, &root, 1, after_base, SCOPE_PACK, b"pack/celestial".to_string(),
        test_hash(22), b"body/pack/style-b".to_string(), test_hash(32),
        b"blob-pack".to_string(), test_hash(42), test_hash(52));
    let complete_instance = complete_instance_commitment_v8(
        test_hash(83), test_hash(84), test_hash(33), test_hash(85));
    let (complete_cert, final_commitment, complete_id) = certification_and_next_for_testing(
        &policy, &root, 2, after_pack, SCOPE_COMPLETE, b"complete/default".to_string(),
        complete_instance, b"recipe/render/001".to_string(), test_hash(33),
        b"blob-complete".to_string(), test_hash(43), test_hash(53));
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 1, 1, 1, final_commitment, &mut ctx);
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
    let readiness = issue_seal_readiness_v8(&registry, &policy, &root);
    assert!(readiness.base_count == 1 && readiness.pack_count == 1
        && readiness.complete_count == 1 && readiness.total_count == 3, EInvalidCount);
    destroy_readiness_for_testing(readiness);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let base_proof = base_proof_for_testing(&root, @0xA11,
        b"maker/base".to_string(), b"body/base/style-a".to_string(), base_id);
    seal_approve_base_v8(base_id, &registry, &policy, &root, base_proof, &ctx);
    let pack_proof = pack_proof_for_testing(&root, @0xA11,
        object::id_from_address(@0xB1), test_hash(22),
        b"pack/celestial".to_string(), b"body/pack/style-b".to_string(), pack_id);
    seal_approve_pack_v8(pack_id, &registry, &policy, &root, pack_proof, &ctx);
    let complete_proof = complete_proof_for_testing(&root, @0xA11, test_hash(33),
        b"complete/default".to_string(), b"recipe/render/001".to_string(), complete_id);
    seal_approve_complete_v8(complete_id, &registry, &policy, &root, complete_proof, &ctx);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, &ctx);
}

#[test]
fun paused_and_archived_do_not_trap_exact_holder() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let (config, protocol_admin, mut root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let (cert, final_commitment, id) = certification_and_next_for_testing(
        &policy, &root, 0, empty, SCOPE_BASE, b"maker/base".to_string(),
        test_hash(21), b"body/base/style".to_string(), test_hash(31),
        b"blob".to_string(), test_hash(41), test_hash(51));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        final_commitment, &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_paused_v8());
    let proof = base_proof_for_testing(&root, @0xA11, b"maker/base".to_string(),
        b"body/base/style".to_string(), id);
    seal_approve_base_v8(id, &registry, &policy, &root, proof, &ctx);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_archived_v8());
    let proof = base_proof_for_testing(&root, @0xA11, b"maker/base".to_string(),
        b"body/base/style".to_string(), id);
    seal_approve_base_v8(id, &registry, &policy, &root, proof, &ctx);
    destroy_registry_for_testing(registry);
    finish_test_fixture(config, protocol_admin, root, base_registry, maker_treasury, admin,
        catalog, policy, &ctx);
}

#[test]
fun active_complete_registration_uses_revision_cas_and_exact_receipt() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 30, 0, 0, 0);
    let (config, protocol_admin, mut root, base_registry, maker_treasury, admin, catalog, policy) =
        new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        empty, &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
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
    assert!(registry_commitment_v8(&registry) == &empty, EInvalidCommitment);
    assert!(registry_runtime_commitment_v8(&registry)
        != &empty_runtime_commitment_v8(policy.product_binding_commitment,
            policy.commitment, *maker::root_content_commitment_v8(&root), 1),
        EInvalidCommitment);
    let proof = complete_proof_for_testing(&root, @0xA11, test_hash(33),
        b"complete/runtime".to_string(), b"receipt/runtime/one".to_string(), id);
    seal_approve_complete_v8(id, &registry, &policy, &root, proof, &ctx);
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
    let empty = empty_registry_commitment_v8(
        policy.product_binding_commitment, policy.commitment,
        *maker::root_content_commitment_v8(&root), 1);
    let mut registry = new_registry_for_testing(
        &root, &admin, &policy, 0, 0, 0, empty, &mut ctx);
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

#[test, expected_failure(abort_code = ERegistryNotSealed)]
fun readiness_rejects_unsealed_registry() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 31, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) =
        new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        empty, &mut ctx);
    let _readiness = issue_seal_readiness_v8(&registry, &policy, &root);
    abort ERegistryNotSealed
}

#[test, expected_failure(abort_code = EInvalidSequence)]
fun runtime_registration_rejects_stale_revision() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 32, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) =
        new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        empty, &mut ctx);
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
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        empty, &mut ctx);
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
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let (cert, final_commitment, id) = certification_and_next_for_testing(
        &policy, &root, 0, empty, SCOPE_BASE, b"maker/base".to_string(),
        test_hash(21), b"style/one".to_string(), test_hash(31),
        b"blob".to_string(), test_hash(41), test_hash(51));
    let certification_commitment = cert.certification_commitment;
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        final_commitment, &mut ctx);
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
    let (cert, _, _) = certification_and_next_for_testing(&policy, &root, 0,
        test_hash(1), SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        test_hash(9), &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 1, cert);
    abort EInvalidSequence
}

#[test, expected_failure(abort_code = EDuplicateAsset)]
fun rejects_duplicate_semantic_scope_asset_key() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 5, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let (first, after, _) = certification_and_next_for_testing(&policy, &root, 0,
        empty, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let (duplicate, _, _) = certification_and_next_for_testing(&policy, &root, 1,
        after, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 2, 0, 0,
        test_hash(9), &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, first);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 1, duplicate);
    abort EDuplicateAsset
}

#[test, expected_failure(abort_code = EInvalidCount)]
fun rejects_seal_before_expected_counts() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 6, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        test_hash(9), &mut ctx);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    abort EInvalidCount
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun rejects_seal_with_wrong_final_commitment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 7, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let (cert, _, _) = certification_and_next_for_testing(&policy, &root, 0,
        empty, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(),
        test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        test_hash(99), &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    abort EInvalidCommitment
}

#[test, expected_failure(abort_code = ERegistrySealed)]
fun rejects_append_after_explicit_empty_seal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 8, 0, 0, 0);
    let (_config, _protocol_admin, root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 0,
        empty, &mut ctx);
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
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let (cert, final_commitment, id) = certification_and_next_for_testing(&policy,
        &root, 0, empty, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        final_commitment, &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    let proof = base_proof_for_testing(&root, @0xA11, b"maker/base".to_string(),
        b"asset".to_string(), id);
    seal_approve_base_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun wrong_holder_never_approves_decrypt() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 10, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let (cert, final_commitment, id) = certification_and_next_for_testing(&policy,
        &root, 0, empty, SCOPE_BASE, b"maker/base".to_string(), test_hash(2),
        b"asset".to_string(), test_hash(3), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 1, 0, 0,
        final_commitment, &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = base_proof_for_testing(&root, @0xB0B, b"maker/base".to_string(),
        b"asset".to_string(), id);
    seal_approve_base_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun pack_proof_must_bind_exact_release_content() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 11, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let (cert, final_commitment, id) = certification_and_next_for_testing(&policy,
        &root, 0, empty, SCOPE_PACK, b"pack/one".to_string(), test_hash(22),
        b"asset".to_string(), test_hash(3), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 1, 0,
        final_commitment, &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = pack_proof_for_testing(&root, @0xA11, object::id_from_address(@0xB1),
        test_hash(99), b"pack/one".to_string(), b"asset".to_string(), id);
    seal_approve_pack_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = ENoAccess)]
fun complete_proof_must_bind_exact_output_commitment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 12, 0, 0, 0);
    let (_config, _protocol_admin, mut root, _base_registry, _maker_treasury, admin, _catalog, policy) = new_test_fixture(&mut ctx);
    let empty = empty_registry_commitment_v8(policy.product_binding_commitment,
        policy.commitment, *maker::root_content_commitment_v8(&root), 1);
    let complete_instance = complete_instance_commitment_v8(
        test_hash(83), test_hash(84), test_hash(33), test_hash(85));
    let (cert, final_commitment, id) = certification_and_next_for_testing(&policy,
        &root, 0, empty, SCOPE_COMPLETE, b"complete/default".to_string(), complete_instance,
        b"receipt/one".to_string(), test_hash(33), b"blob".to_string(), test_hash(4), test_hash(5));
    let mut registry = new_registry_for_testing(&root, &admin, &policy, 0, 0, 1,
        final_commitment, &mut ctx);
    append_protected_asset_v8(&mut registry, &root, &admin, &policy, 0, cert);
    seal_registry_v8(&mut registry, &root, &admin, &policy);
    maker::set_lifecycle_for_testing(&mut root, maker::lifecycle_active_v8());
    let proof = complete_proof_for_testing(&root, @0xA11, test_hash(99),
        b"complete/default".to_string(), b"receipt/one".to_string(), id);
    seal_approve_complete_v8(id, &registry, &policy, &root, proof, &ctx);
    abort ENoAccess
}

#[test, expected_failure(abort_code = EInvalidKeyServers)]
fun key_server_ids_must_be_strictly_sorted_and_unique() {
    validate_key_servers(
        vector[object::id_from_address(@0x200), object::id_from_address(@0x100)],
        vector[1, 1], 1);
    abort EInvalidKeyServers
}
