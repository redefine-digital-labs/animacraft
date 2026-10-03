/// Companion-independent constructor for the exact Core object pair. It does
/// not create, import, or claim readiness for any future companion package.
module animacraft_v8_core::core_v8;

use animacraft_v8_core::base_registry_v8::{
    Self as base,
    BaseDefinitionCountsV8,
    BaseDefinitionRegistryV8,
};
use animacraft_v8_core::maker_v8::{
    Self as maker,
    EconomicsSnapshotV8,
    MakerAdminCapV8,
    MakerRootV8,
    RightsSnapshotV8,
    SuccessorAuthorityV8,
};
use animacraft_v8_core::package_binding_v8::{
    Self as package_binding,
    ProductReleaseCatalogV8,
    FreshTupleReplacementBindingV2,
};
use animacraft_v8_core::companion_binding_v2::MakerRuntimeCompanionBindingBuilderV2;
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
};
use animacraft_v8_core::treasury_v8::{
    Self as treasury,
    MakerTreasuryV8,
};
use std::bcs;
use std::hash;
use std::string::{Self as string, String};
use std::type_name;
use sui::clock::Clock;
use sui::dynamic_field;
use walrus::blob::{Self as walrus_blob, Blob};
use walrus::system::{Self as walrus_system, System};

const VERSION: u64 = 8;
const WALRUS_SCHEMA_REVISION: u64 = 1;
const MAX_BLOB_ID_BYTES: u64 = 512;

const EWalrusInvalid: u64 = 0;
const EWalrusBootstrapExists: u64 = 1;
const EWalrusOwnerMismatch: u64 = 2;
const EWalrusReplay: u64 = 3;
const EWalrusBindingMismatch: u64 = 4;

public struct LivingContentBindingV8 has copy, drop, store {
    schema_revision: u64,
    creator_defaults_commitment: vector<u8>,
    blob_id: String,
    sha256: vector<u8>,
    byte_length: u64,
    content_commitment: vector<u8>,
}

public struct WalrusCertificationPolicyV1 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    system_id: ID,
    commitment: vector<u8>,
}

public struct WalrusCertificationBootstrapKeyV1 has copy, drop, store {}

public struct WalrusCertificationBootstrapSlotV1 has store {
    policy_id: ID,
    system_id: ID,
}

/// Facts read from the pinned Walrus objects, not an assertion by a platform
/// signer. Blob does not contain an application SHA-256 or a System ID: the
/// policy pins the typed System and the author separately commits to the bytes.
public struct WalrusStorageProofV1 has copy, drop, store {
    system_id: ID,
    blob_object_id: ID,
    blob_id: u256,
    size: u64,
    encoding_type: u8,
    registered_epoch: u32,
    certified_epoch: u32,
    end_epoch: u32,
    checked_epoch: u32,
}

public struct WalrusStorageProofCommitmentInputV1 has drop {
    domain: String, schema_revision: u64, proof: WalrusStorageProofV1,
}

public struct CertifiedLivingContentV1 has key {
    id: UID,
    version: u64,
    policy_id: ID,
    system_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    binding: LivingContentBindingV8,
    storage_proof: WalrusStorageProofV1,
    storage_proof_commitment: vector<u8>,
    certification_commitment: vector<u8>,
}

public struct LivingContentUseWitnessV1 {
    certificate_id: ID,
    root_id: ID,
    maker_version: u64,
    root_content_commitment: vector<u8>,
    binding: LivingContentBindingV8,
    certification_commitment: vector<u8>,
}

public struct LivingContentReplayKeyV1 has copy, drop, store {
    root_id: ID,
    maker_version: u64,
    content_commitment: vector<u8>,
}

public struct LivingContentReplayMarkerV1 has store {}

public struct LivingContentBindingCommitmentInputV1 has drop {
    domain: String, schema_revision: u64,
    creator_defaults_commitment: vector<u8>, blob_id: String,
    sha256: vector<u8>, byte_length: u64, bundle_commitment: vector<u8>,
}

public struct LivingContentCertificationCommitmentInputV1 has drop {
    domain: String, schema_revision: u64, certificate_id: ID, policy_id: ID,
    system_id: ID, root_id: ID, maker_version: u64,
    root_content_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
    storage_proof_commitment: vector<u8>,
}

public struct WalrusCertificationPolicyCommitmentInputV1 has drop {
    domain: String, schema_revision: u64, policy_id: ID, catalog_id: ID,
    package_tuple_commitment: vector<u8>, system_id: ID,
}

public struct WalrusCertificationBootstrapSlotCommitmentInputV1 has drop {
    domain: String, schema_revision: u64, catalog_id: ID,
    slot_key_type_name: String, slot_key_bcs: vector<u8>, policy_id: ID,
    system_id: ID,
}

public fun version_v8(): u64 { VERSION }

public fun new_living_content_binding_v8(
    creator_defaults_commitment: vector<u8>,
    blob_id: String,
    sha256: vector<u8>,
    byte_length: u64,
    content_commitment: vector<u8>,
): LivingContentBindingV8 {
    assert_hash(&creator_defaults_commitment);
    assert!(!blob_id.is_empty() && blob_id.length() <= MAX_BLOB_ID_BYTES,
        EWalrusInvalid);
    assert_hash(&sha256);
    assert!(byte_length > 0, EWalrusInvalid);
    assert_hash(&content_commitment);
    LivingContentBindingV8 {
        schema_revision: WALRUS_SCHEMA_REVISION,
        creator_defaults_commitment,
        blob_id,
        sha256,
        byte_length,
        content_commitment,
    }
}

public fun living_content_binding_commitment_v1(
    binding: &LivingContentBindingV8,
): vector<u8> {
    assert_living_content_binding(binding);
    hash::sha2_256(bcs::to_bytes(
        &LivingContentBindingCommitmentInputV1 {
            domain: b"animacraft-fresh-v8/output/living-content-binding/v1"
                .to_string(),
            schema_revision: WALRUS_SCHEMA_REVISION,
            creator_defaults_commitment: binding.creator_defaults_commitment,
            blob_id: binding.blob_id,
            sha256: binding.sha256,
            byte_length: binding.byte_length,
            bundle_commitment: binding.content_commitment,
        }))
}

public fun bootstrap_walrus_certification_policy_v1(
    protocol_config: &ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
    system: &System,
    ctx: &mut TxContext,
) {
    protocol::assert_protocol_admin_v8(protocol_config, protocol_admin);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    package_binding::assert_catalog_setup_complete_v2(catalog);
    // Also forces the pinned Walrus package to validate its actual System
    // version/inner state; an arbitrary object ID is not configuration proof.
    let _epoch = walrus_system::epoch(system);
    let policy_uid = object::new(ctx);
    let policy_id = policy_uid.to_inner();
    let catalog_id = package_binding::catalog_id_v8(catalog);
    let package_tuple_commitment =
        *package_binding::product_binding_commitment_v8(
            package_binding::catalog_binding_v8(catalog));
    let system_id = object::id(system);
    let policy_commitment = derive_walrus_policy_commitment(
        policy_id, catalog_id, package_tuple_commitment, system_id);
    let catalog_uid = package_binding::catalog_uid_mut_v2(catalog);
    assert!(!dynamic_field::exists(
        catalog_uid, WalrusCertificationBootstrapKeyV1 {}),
        EWalrusBootstrapExists);
    dynamic_field::add(
        catalog_uid,
        WalrusCertificationBootstrapKeyV1 {},
        WalrusCertificationBootstrapSlotV1 {
            policy_id,
            system_id,
        },
    );
    transfer::share_object(WalrusCertificationPolicyV1 {
        id: policy_uid,
        version: WALRUS_SCHEMA_REVISION,
        catalog_id,
        package_tuple_commitment,
        system_id,
        commitment: policy_commitment,
    });
}

/// The current Maker owner publishes using their own exact AdminCap. Walrus
/// certification proves storage, not the binding's author-declared SHA-256;
/// readers must still fetch and independently verify the actual content bytes.
public fun certify_walrus_living_content_v1<PaymentCoin>(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    policy: &mut WalrusCertificationPolicyV1,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    binding: LivingContentBindingV8,
    blob: &Blob,
    system: &System,
    ctx: &mut TxContext,
): CertifiedLivingContentV1 {
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    maker::assert_product_release_catalog_v8(root, catalog);
    assert_walrus_policy(policy, catalog);
    maker::assert_draft_admin_v8(root, admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EWalrusOwnerMismatch);
    assert!(binding.creator_defaults_commitment
        == *maker::root_creator_defaults_commitment_v1(root),
        EWalrusBindingMismatch);
    let binding_commitment = living_content_binding_commitment_v1(&binding);
    assert!(&binding_commitment
        == maker::root_living_content_binding_commitment_v1(root),
        EWalrusBindingMismatch);
    let storage_proof = read_walrus_storage_proof(policy, &binding, blob, system);
    let storage_proof_commitment = derive_walrus_storage_proof_commitment(&storage_proof);
    let replay_key = LivingContentReplayKeyV1 {
        root_id: maker::root_id_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        content_commitment: binding.content_commitment,
    };
    assert!(!dynamic_field::exists(&policy.id, replay_key), EWalrusReplay);
    dynamic_field::add(
        &mut policy.id, replay_key, LivingContentReplayMarkerV1 {});
    let certificate_uid = object::new(ctx);
    let certificate_id = certificate_uid.to_inner();
    let root_id = maker::root_id_v8(root);
    let maker_version = maker::root_maker_version_v8(root);
    let root_content_commitment = *maker::root_content_commitment_v8(root);
    let certification_commitment = hash::sha2_256(bcs::to_bytes(
        &LivingContentCertificationCommitmentInputV1 {
            domain:
                b"animacraft-fresh-v8/core/walrus-living-content-certificate/v1"
                    .to_string(),
            schema_revision: WALRUS_SCHEMA_REVISION,
            certificate_id,
            policy_id: object::id(policy),
            system_id: policy.system_id,
            root_id,
            maker_version,
            root_content_commitment,
            living_content_binding_commitment: binding_commitment,
            storage_proof_commitment,
        }));
    CertifiedLivingContentV1 {
        id: certificate_uid,
        version: WALRUS_SCHEMA_REVISION,
        policy_id: object::id(policy),
        system_id: policy.system_id,
        root_id,
        maker_version,
        root_content_commitment,
        binding,
        storage_proof,
        storage_proof_commitment,
        certification_commitment,
    }
}

/// Freeze after companion binding and activation in the author's same PTB.
/// This is a storage operation, never an alternative certificate constructor.
public fun freeze_certified_living_content_v1(certificate: CertifiedLivingContentV1) {
    transfer::freeze_object(certificate);
}

public fun issue_living_content_use_witness_v1<PaymentCoin>(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    policy: &WalrusCertificationPolicyV1,
    certificate: &CertifiedLivingContentV1,
    system: &System,
    root: &MakerRootV8<PaymentCoin>,
): LivingContentUseWitnessV1 {
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    maker::assert_product_release_catalog_v8(root, catalog);
    assert_walrus_policy(policy, catalog);
    assert_certified_living_content(certificate, policy, root);
    assert_walrus_storage_current(&certificate.storage_proof, system);
    LivingContentUseWitnessV1 {
        certificate_id: object::id(certificate),
        root_id: certificate.root_id,
        maker_version: certificate.maker_version,
        root_content_commitment: certificate.root_content_commitment,
        binding: certificate.binding,
        certification_commitment: certificate.certification_commitment,
    }
}

public fun assert_certified_living_content_v1<PaymentCoin>(
    policy: &WalrusCertificationPolicyV1,
    certificate: &CertifiedLivingContentV1,
    system: &System,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert_certified_living_content(certificate, policy, root);
    assert_walrus_storage_current(&certificate.storage_proof, system);
}

public fun assert_walrus_policy_current_v1(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    policy: &WalrusCertificationPolicyV1,
) {
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    assert_walrus_policy(policy, catalog);
}

#[test_only]
public fun walrus_policy_id_for_testing(catalog: &ProductReleaseCatalogV8): ID {
    let slot = dynamic_field::borrow<WalrusCertificationBootstrapKeyV1, WalrusCertificationBootstrapSlotV1>(
        package_binding::catalog_uid_v2(catalog), WalrusCertificationBootstrapKeyV1 {});
    slot.policy_id
}

public fun consume_living_content_use_witness_v1<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    binding: &LivingContentBindingV8,
    witness: LivingContentUseWitnessV1,
): (ID, vector<u8>) {
    let LivingContentUseWitnessV1 {
        certificate_id,
        root_id,
        maker_version,
        root_content_commitment,
        binding: witnessed_binding,
        certification_commitment,
    } = witness;
    maker::assert_root_identity_v8(
        root, root_id, maker_version, &root_content_commitment);
    assert!(witnessed_binding == *binding, EWalrusBindingMismatch);
    assert!(living_content_binding_commitment_v1(binding)
        == *maker::root_living_content_binding_commitment_v1(root),
        EWalrusBindingMismatch);
    assert_hash(&certification_commitment);
    (certificate_id, certification_commitment)
}

public fun walrus_bootstrap_slot_commitment_v1(
    catalog: &ProductReleaseCatalogV8,
): vector<u8> {
    let key = WalrusCertificationBootstrapKeyV1 {};
    let slot = dynamic_field::borrow<WalrusCertificationBootstrapKeyV1,
        WalrusCertificationBootstrapSlotV1>(
            package_binding::catalog_uid_v2(catalog), key);
    hash::sha2_256(bcs::to_bytes(
        &WalrusCertificationBootstrapSlotCommitmentInputV1 {
            domain:
                b"animacraft-fresh-v8/core/walrus-certification-bootstrap-slot/v1"
                    .to_string(),
            schema_revision: WALRUS_SCHEMA_REVISION,
            catalog_id: package_binding::catalog_id_v8(catalog),
            slot_key_type_name: string::from_ascii(
                type_name::with_original_ids<WalrusCertificationBootstrapKeyV1>()
                    .into_string()),
            slot_key_bcs: bcs::to_bytes(&key),
            policy_id: slot.policy_id,
            system_id: slot.system_id,
        }))
}

/// Allocates one DRAFT Root, its exact AdminCap, and the immutable base
/// definition registry. The caller may create companion objects in the same
/// transaction before sharing the Core objects.
public fun new_initial_maker_draft_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    maker_key: String,
    maker_document_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    expected_base_counts: BaseDefinitionCountsV8,
    expected_author_rows_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    clock: &Clock,
    ctx: &mut TxContext,
): (
    MakerRootV8<PaymentCoin>,
    BaseDefinitionRegistryV8,
    MakerTreasuryV8<PaymentCoin>,
    MakerAdminCapV8,
) {
    let expected_base_definition_count = base::definition_count_v2(&expected_base_counts);
    let (mut root, admin) = maker::new_initial_maker_draft_v8<PaymentCoin>(
        config,
        expected_base_definition_count,
        expected_author_rows_commitment,
        expected_pack_admission_policy_commitment,
        maker_key,
        maker_document_commitment,
        creator_defaults_commitment,
        living_content_binding_commitment,
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        economics,
        rights,
        clock,
        ctx,
    );
    let registry = base::new_base_definition_registry_v8(
        &root,
        &admin,
        expected_base_counts,
        ctx,
    );
    maker::finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        object::id(&registry),
    );
    let maker_treasury = treasury::new_maker_treasury_v8(
        &mut root,
        &admin,
        ctx,
    );
    (root, registry, maker_treasury, admin)
}

/// Creates version N+1 from an exact typed predecessor. Maker key, next
/// version, predecessor ID, and predecessor commitment are not caller input.
public fun new_successor_maker_draft_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    previous: &mut MakerRootV8<PaymentCoin>,
    previous_admin: &MakerAdminCapV8,
    authority: SuccessorAuthorityV8<PaymentCoin>,
    expected_previous_control_epoch: u64,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    expected_base_counts: BaseDefinitionCountsV8,
    expected_author_rows_commitment: vector<u8>,
    expected_pack_admission_policy_commitment: vector<u8>,
    maker_document_commitment: vector<u8>,
    creator_defaults_commitment: vector<u8>,
    living_content_binding_commitment: vector<u8>,
    economics: EconomicsSnapshotV8,
    rights: RightsSnapshotV8,
    clock: &Clock,
    ctx: &mut TxContext,
): (
    MakerRootV8<PaymentCoin>,
    BaseDefinitionRegistryV8,
    MakerTreasuryV8<PaymentCoin>,
    MakerAdminCapV8,
) {
    let expected_base_definition_count = base::definition_count_v2(&expected_base_counts);
    let (mut root, admin) = maker::new_successor_maker_draft_v8<PaymentCoin>(
        config,
        previous,
        previous_admin,
        authority,
        expected_previous_control_epoch,
        expected_base_definition_count,
        expected_author_rows_commitment,
        expected_pack_admission_policy_commitment,
        maker_document_commitment,
        creator_defaults_commitment,
        living_content_binding_commitment,
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        economics,
        rights,
        clock,
        ctx,
    );
    let registry = base::new_base_definition_registry_v8(
        &root,
        &admin,
        expected_base_counts,
        ctx,
    );
    maker::finalize_base_registry_binding_v8(
        &mut root,
        &admin,
        object::id(&registry),
    );
    let maker_treasury = treasury::new_maker_treasury_v8(
        &mut root,
        &admin,
        ctx,
    );
    (root, registry, maker_treasury, admin)
}

public fun share_maker_draft_v8<PaymentCoin>(
    root: MakerRootV8<PaymentCoin>,
    registry: BaseDefinitionRegistryV8,
    maker_treasury: MakerTreasuryV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    ctx: &TxContext,
) {
    base::assert_draft_registry_identity_v8(&registry, &root, &admin);
    treasury::assert_maker_treasury_v8(&root, &maker_treasury);
    base::share_base_definition_registry_v8(registry);
    treasury::share_maker_treasury_v8(maker_treasury);
    maker::share_maker_root_and_admin_v8(root, admin, ctx);
}

/// Complete Core-only readiness. It intentionally cannot change lifecycle.
/// Only certified, sealed artwork may create its unique companion authority.
public fun begin_maker_companion_binding_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    base_registry: &BaseDefinitionRegistryV8,
    policy: &WalrusCertificationPolicyV1, certificate: &CertifiedLivingContentV1,
    system: &System,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    assert_companion_source_v2(root, protocol_config, catalog, base_registry, policy, certificate, system);
    maker::begin_companion_binding_v2(root, admin, protocol_config, catalog, replacement, ctx)
}

public fun finish_maker_companion_binding_v2<PaymentCoin>(
    builder: MakerRuntimeCompanionBindingBuilderV2<PaymentCoin>,
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    base_registry: &BaseDefinitionRegistryV8,
    policy: &WalrusCertificationPolicyV1, certificate: &CertifiedLivingContentV1,
    system: &System,
    ctx: &TxContext,
) {
    assert_companion_source_v2(root, protocol_config, catalog, base_registry, policy, certificate, system);
    maker::finish_companion_binding_v2(builder, root, admin, protocol_config, catalog, replacement, ctx);
}

fun assert_companion_source_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8, base_registry: &BaseDefinitionRegistryV8,
    policy: &WalrusCertificationPolicyV1, certificate: &CertifiedLivingContentV1,
    system: &System,
) {
    assert_walrus_policy_current_v1(protocol_config, catalog, policy);
    assert_certified_living_content_v1(policy, certificate, system, root);
    // Third readiness value is protected-style count, not total definitions.
    let (_, commitment, _) = base::assert_activation_ready_v8(base_registry, root);
    assert!(&commitment == maker::root_sealed_base_registry_commitment_v2(root),
        EWalrusBindingMismatch);
}

public fun assert_activation_scaffold_ready_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    registry: &BaseDefinitionRegistryV8,
): (ID, vector<u8>, u64) {
    maker::assert_activation_scaffold_ready_v8(root);
    base::assert_activation_ready_v8(registry, root)
}

fun assert_living_content_binding(binding: &LivingContentBindingV8) {
    assert!(binding.schema_revision == WALRUS_SCHEMA_REVISION,
        EWalrusInvalid);
    assert_hash(&binding.creator_defaults_commitment);
    assert!(!binding.blob_id.is_empty()
        && binding.blob_id.length() <= MAX_BLOB_ID_BYTES, EWalrusInvalid);
    assert_hash(&binding.sha256);
    assert!(binding.byte_length > 0, EWalrusInvalid);
    assert_hash(&binding.content_commitment);
}

fun derive_walrus_policy_commitment(
    policy_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    system_id: ID,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(
        &WalrusCertificationPolicyCommitmentInputV1 {
            domain: b"animacraft-fresh-v8/core/walrus-certification-policy/v1"
                .to_string(),
            schema_revision: WALRUS_SCHEMA_REVISION,
            policy_id,
            catalog_id,
            package_tuple_commitment,
            system_id,
        }))
}

fun assert_walrus_policy(
    policy: &WalrusCertificationPolicyV1,
    catalog: &ProductReleaseCatalogV8,
) {
    assert!(policy.version == WALRUS_SCHEMA_REVISION,
        EWalrusInvalid);
    assert!(policy.catalog_id == package_binding::catalog_id_v8(catalog),
        EWalrusInvalid);
    assert!(&policy.package_tuple_commitment
        == package_binding::product_binding_commitment_v8(
            package_binding::catalog_binding_v8(catalog)), EWalrusInvalid);
    let expected = derive_walrus_policy_commitment(
        object::id(policy), policy.catalog_id, policy.package_tuple_commitment,
        policy.system_id);
    assert!(&expected == &policy.commitment, EWalrusInvalid);
    let slot = dynamic_field::borrow<WalrusCertificationBootstrapKeyV1,
        WalrusCertificationBootstrapSlotV1>(package_binding::catalog_uid_v2(catalog),
        WalrusCertificationBootstrapKeyV1 {});
    assert!(slot.policy_id == object::id(policy) && slot.system_id == policy.system_id,
        EWalrusBindingMismatch);
}

fun read_walrus_storage_proof(
    policy: &WalrusCertificationPolicyV1,
    binding: &LivingContentBindingV8,
    blob: &Blob,
    system: &System,
): WalrusStorageProofV1 {
    assert!(object::id(system) == policy.system_id, EWalrusBindingMismatch);
    let checked_epoch = walrus_system::epoch(system);
    let certified_epoch = walrus_blob::certified_epoch(blob);
    assert!(certified_epoch.is_some() && !walrus_blob::is_deletable(blob), EWalrusInvalid);
    let proof = WalrusStorageProofV1 {
        system_id: object::id(system), blob_object_id: object::id(blob),
        blob_id: walrus_blob::blob_id(blob), size: walrus_blob::size(blob),
        encoding_type: walrus_blob::encoding_type(blob),
        registered_epoch: walrus_blob::registered_epoch(blob),
        certified_epoch: *certified_epoch.borrow(),
        end_epoch: walrus_blob::end_epoch(blob), checked_epoch,
    };
    assert_walrus_storage_proof(&proof, binding, policy.system_id);
    proof
}

fun assert_walrus_storage_proof(
    proof: &WalrusStorageProofV1, binding: &LivingContentBindingV8, system_id: ID,
) {
    assert!(proof.system_id == system_id
        && proof.registered_epoch <= proof.certified_epoch
        && proof.certified_epoch <= proof.checked_epoch
        && proof.checked_epoch < proof.end_epoch, EWalrusInvalid);
    assert!(proof.size == binding.byte_length
        && walrus_blob_id_string_v1(proof.blob_id) == binding.blob_id, EWalrusBindingMismatch);
}

fun derive_walrus_storage_proof_commitment(proof: &WalrusStorageProofV1): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&WalrusStorageProofCommitmentInputV1 {
        domain: b"animacraft-fresh-v8/core/walrus-storage-proof/v1".to_string(),
        schema_revision: WALRUS_SCHEMA_REVISION, proof: *proof,
    }))
}

/// Frozen certification is historical evidence, not an evergreen permission.
/// Every public use-witness/companion/activation gate re-reads this exact live
/// Walrus System, so freezing a certificate cannot defer activation past expiry.
fun assert_walrus_storage_current(proof: &WalrusStorageProofV1, system: &System) {
    assert!(object::id(system) == proof.system_id, EWalrusBindingMismatch);
    let current_epoch = walrus_system::epoch(system);
    assert!(current_epoch >= proof.checked_epoch && current_epoch < proof.end_epoch, EWalrusInvalid);
}

/// Canonical Walrus BlobId is unpadded base64url of the 32 little-endian bytes,
/// not a hex address and not the Sui Blob object's ID.
public fun walrus_blob_id_string_v1(blob_id: u256): String {
    let bytes = bcs::to_bytes(&blob_id);
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut encoded = vector[];
    let mut i = 0;
    while (i < 30) {
        let a = bytes[i]; let b = bytes[i + 1]; let c = bytes[i + 2];
        encoded.push_back(alphabet[(a >> 2) as u64]);
        encoded.push_back(alphabet[(((a & 3) << 4) | (b >> 4)) as u64]);
        encoded.push_back(alphabet[(((b & 15) << 2) | (c >> 6)) as u64]);
        encoded.push_back(alphabet[(c & 63) as u64]);
        i = i + 3;
    };
    let a = bytes[30]; let b = bytes[31];
    encoded.push_back(alphabet[(a >> 2) as u64]);
    encoded.push_back(alphabet[(((a & 3) << 4) | (b >> 4)) as u64]);
    encoded.push_back(alphabet[((b & 15) << 2) as u64]);
    string::utf8(encoded)
}

fun assert_certified_living_content<PaymentCoin>(
    certificate: &CertifiedLivingContentV1,
    policy: &WalrusCertificationPolicyV1,
    root: &MakerRootV8<PaymentCoin>,
) {
    assert!(certificate.version == WALRUS_SCHEMA_REVISION,
        EWalrusBindingMismatch);
    assert!(certificate.policy_id == object::id(policy),
        EWalrusBindingMismatch);
    assert!(certificate.system_id == policy.system_id,
        EWalrusBindingMismatch);
    maker::assert_root_identity_v8(
        root, certificate.root_id, certificate.maker_version,
        &certificate.root_content_commitment);
    assert!(certificate.binding.creator_defaults_commitment
        == *maker::root_creator_defaults_commitment_v1(root),
        EWalrusBindingMismatch);
    let binding_commitment =
        living_content_binding_commitment_v1(&certificate.binding);
    assert!(&binding_commitment
        == maker::root_living_content_binding_commitment_v1(root),
        EWalrusBindingMismatch);
    assert_walrus_storage_proof(&certificate.storage_proof, &certificate.binding, policy.system_id);
    assert!(derive_walrus_storage_proof_commitment(&certificate.storage_proof)
        == certificate.storage_proof_commitment, EWalrusBindingMismatch);
    let expected = hash::sha2_256(bcs::to_bytes(
        &LivingContentCertificationCommitmentInputV1 {
            domain:
                b"animacraft-fresh-v8/core/walrus-living-content-certificate/v1"
                    .to_string(),
            schema_revision: WALRUS_SCHEMA_REVISION,
            certificate_id: object::id(certificate),
            policy_id: certificate.policy_id,
            system_id: certificate.system_id,
            root_id: certificate.root_id,
            maker_version: certificate.maker_version,
            root_content_commitment: certificate.root_content_commitment,
            living_content_binding_commitment: binding_commitment,
            storage_proof_commitment: certificate.storage_proof_commitment,
        }));
    assert!(&expected == &certificate.certification_commitment,
        EWalrusBindingMismatch);
}

fun assert_hash(value: &vector<u8>) {
    assert!(protocol::is_nonzero_hash_v2(value), EWalrusInvalid);
}

public fun certified_living_content_id_v1(
    certificate: &CertifiedLivingContentV1,
): ID { object::id(certificate) }
public fun certified_living_content_commitment_v1(
    certificate: &CertifiedLivingContentV1,
): &vector<u8> { &certificate.certification_commitment }
public fun certified_living_content_binding_v1(
    certificate: &CertifiedLivingContentV1,
): &LivingContentBindingV8 { &certificate.binding }

// Isolated storage-proof fixtures, NOT full seven-package initialization or
// live Walrus quorum acceptance. The Walrus dependency creates the real System,
// paid Storage and registered Blob. Only its documented certification test hook
// replaces the external storage committee. No Animacraft approval cap exists.
#[test_only]
public struct WalrusFixture {
    config: ProtocolConfigV8, protocol_admin: ProtocolAdminCapV8,
    catalog: ProductReleaseCatalogV8, root: MakerRootV8<sui::sui::SUI>,
    admin: MakerAdminCapV8, binding: LivingContentBindingV8,
    system: System, blob: Blob,
}

#[test_only]
fun walrus_test_root(
    config: &ProtocolConfigV8, binding: &LivingContentBindingV8, ctx: &mut TxContext,
): (MakerRootV8<sui::sui::SUI>, MakerAdminCapV8) {
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(config, 0, 0, 0, 0, 0, 0);
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let clock = sui::clock::create_for_testing(ctx);
    let (root, admin) = maker::new_initial_maker_draft_v8<sui::sui::SUI>(
        config, 1, vector::tabulate!(32, |_| 1), vector::tabulate!(32, |_| 2),
        b"independent-author".to_string(), vector::tabulate!(32, |_| 30),
        binding.creator_defaults_commitment, living_content_binding_commitment_v1(binding),
        vector::tabulate!(32, |_| 3), b"manifest".to_string(), vector::tabulate!(32, |_| 4),
        vector::tabulate!(32, |_| 5), economics, rights, &clock, ctx);
    clock.destroy_for_testing();
    (root, admin)
}

#[test_only]
fun walrus_fixture(mode: u8, scenario: &mut sui::test_scenario::Scenario): WalrusFixture {
    let system = walrus_system::new_for_testing(scenario.ctx());
    walrus_fixture_from_system(mode, system, 3, scenario)
}

#[test_only]
fun walrus_fixture_from_system(
    mode: u8, mut system: System, epochs_ahead: u32, scenario: &mut sui::test_scenario::Scenario,
): WalrusFixture {
    let ctx = scenario.ctx();
    let mut payment = walrus::test_utils::mint_frost(1_000_000_000_000, ctx);
    let size = 1_000;
    let blob_id = walrus_blob::derive_blob_id(0xABC, 1, size);
    let encoded_size = walrus::encoding::encoded_blob_length(size, 1, walrus_system::n_shards(&system));
    let storage = walrus_system::reserve_space(&mut system, encoded_size, epochs_ahead, &mut payment, ctx);
    let mut blob = walrus_system::register_blob(&mut system, storage, blob_id,
        0xABC, size, 1, mode == 2, &mut payment, ctx);
    sui::coin::burn_for_testing(payment);
    if (mode != 1) {
        let message = if (mode == 2) {
            walrus::messages::certified_deletable_blob_message_for_testing(blob_id, object::id(&blob))
        } else {
            walrus::messages::certified_permanent_blob_message_for_testing(blob_id)
        };
        walrus_blob::certify_with_certified_msg_for_testing(&mut blob,
            walrus_system::epoch(&system) + (if (mode == 3) { 1 } else { 0 }), message);
    };
    let binding = new_living_content_binding_v8(vector::tabulate!(32, |_| 31),
        walrus_blob_id_string_v1(if (mode == 4) { blob_id + 1 } else { blob_id }),
        vector::tabulate!(32, |_| 32), if (mode == 5) { size + 1 } else { size },
        vector::tabulate!(32, |_| 33));
    // Walrus's System fixture internally calls TxContext::dummy. Enter the
    // actual author transaction before constructing any author-owned authority.
    scenario.next_tx(@0xA11);
    let ctx = scenario.ctx();
    let (config, protocol_admin) = protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    let (mut root, admin) = walrus_test_root(&config, &binding, ctx);
    let mut catalog = package_binding::product_release_catalog_for_testing(&config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(), @0x11, @0x21, ctx);
    package_binding::complete_catalog_setup_for_testing(&mut catalog, ctx);
    maker::finalize_product_release_binding_v8(&mut root, &admin, &config, &catalog, ctx);
    bootstrap_walrus_certification_policy_v1(&config, &protocol_admin, &mut catalog, &system, ctx);
    WalrusFixture { config, protocol_admin, catalog, root, admin, binding, system, blob }
}

#[test_only]
fun run_walrus_fixture(mode: u8) {
    let mut scenario = sui::test_scenario::begin(@0xA11);
    let WalrusFixture { config, protocol_admin, mut catalog, root, admin, mut binding, system, blob }
        = walrus_fixture(mode, &mut scenario);
    scenario.next_tx(if (mode == 6) { @0xBAD } else { @0xA11 });
    let mut policy = scenario.take_shared<WalrusCertificationPolicyV1>();
    if (mode == 7) {
        // Simulate a policy pinned to a different System; the actual typed
        // Walrus System input must not satisfy it. This is negative-only data
        // corruption, not a production policy constructor or fixture authority.
        policy.system_id = object::id(&blob);
        policy.commitment = derive_walrus_policy_commitment(object::id(&policy),
            policy.catalog_id, policy.package_tuple_commitment, policy.system_id);
        let slot = dynamic_field::borrow_mut<WalrusCertificationBootstrapKeyV1,
            WalrusCertificationBootstrapSlotV1>(package_binding::catalog_uid_mut_v2(&mut catalog),
            WalrusCertificationBootstrapKeyV1 {});
        slot.system_id = policy.system_id;
    };
    if (mode == 12) {
        let (other_root, other_admin) = walrus_test_root(&config, &binding, scenario.ctx());
        let forbidden = certify_walrus_living_content_v1(&config, &catalog, &mut policy,
            &root, &other_admin, binding, &blob, &system, scenario.ctx());
        freeze_certified_living_content_v1(forbidden);
        maker::destroy_maker_for_testing(other_root, other_admin);
    };
    if (mode == 13) { binding.sha256 = vector::tabulate!(32, |_| 99); };
    if (mode == 14) {
        let other_catalog = package_binding::product_release_catalog_for_testing(&config,
            maker::root_core_original_package_id_v8(&root).to_address(),
            maker::root_core_callable_package_id_v8(&root).to_address(), @0x11, @0x21, scenario.ctx());
        let forbidden = certify_walrus_living_content_v1(&config, &other_catalog, &mut policy,
            &root, &admin, binding, &blob, &system, scenario.ctx());
        freeze_certified_living_content_v1(forbidden);
        package_binding::destroy_catalog_for_testing(other_catalog);
    };
    if (mode == 17) { policy.commitment = vector::tabulate!(32, |_| 99); };
    if (mode == 18) {
        let slot = dynamic_field::borrow_mut<WalrusCertificationBootstrapKeyV1,
            WalrusCertificationBootstrapSlotV1>(package_binding::catalog_uid_mut_v2(&mut catalog),
            WalrusCertificationBootstrapKeyV1 {});
        slot.policy_id = object::id(&blob);
    };
    let mut certificate = certify_walrus_living_content_v1(&config, &catalog,
        &mut policy, &root, &admin, binding,
        &blob, &system, scenario.ctx());
    if (mode == 15) { certificate.certification_commitment = vector::tabulate!(32, |_| 99); };
    if (mode == 16) { certificate.storage_proof_commitment = vector::tabulate!(32, |_| 99); };
    assert_certified_living_content_v1(&policy, &certificate, &system, &root);
    assert!(certificate.storage_proof.blob_object_id == object::id(&blob));
    assert!(certificate.storage_proof.blob_id == walrus_blob::blob_id(&blob));
    assert!(certificate.storage_proof.checked_epoch == walrus_system::epoch(&system));
    assert!(certificate.binding.sha256 == binding.sha256);
    let witness = issue_living_content_use_witness_v1(&config, &catalog,
        &policy, &certificate, &system, &root);
    let (id, commitment) = consume_living_content_use_witness_v1(&root, &binding, witness);
    assert!(id == object::id(&certificate) && commitment == certificate.certification_commitment);
    if (mode == 8) {
        let replay = certify_walrus_living_content_v1(&config, &catalog,
            &mut policy, &root, &admin, binding,
            &blob, &system, scenario.ctx());
        freeze_certified_living_content_v1(replay);
    };
    if (mode == 9) {
        bootstrap_walrus_certification_policy_v1(&config, &protocol_admin,
            &mut catalog, &system, scenario.ctx());
    };
    if (mode == 10 || mode == 11) {
        // Exact pure predicate boundary from a real typed Blob proof. Walrus's
        // public fixture API does not allow arbitrary System epoch mutation.
        let mut expired = certificate.storage_proof;
        expired.checked_epoch = expired.end_epoch + (if (mode == 11) { 1 } else { 0 });
        assert_walrus_storage_proof(&expired, &binding, policy.system_id);
    };
    freeze_certified_living_content_v1(certificate);
    sui::test_scenario::return_shared(policy);
    std::unit_test::destroy(WalrusFixture { config, protocol_admin, catalog, root, admin, binding, system, blob });
    scenario.end();
}

#[test]
fun walrus_author_certifies_real_permanent_blob_and_freezes_certificate() { run_walrus_fixture(0); }
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_rejects_uncertified_blob() { run_walrus_fixture(1); }
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_rejects_deletable_blob() { run_walrus_fixture(2); }
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_rejects_future_certified_epoch() { run_walrus_fixture(3); }
#[test, expected_failure(abort_code = EWalrusBindingMismatch)]
fun walrus_rejects_different_blob_id() { run_walrus_fixture(4); }
#[test, expected_failure(abort_code = EWalrusBindingMismatch)]
fun walrus_rejects_different_byte_length() { run_walrus_fixture(5); }
#[test, expected_failure(abort_code = EWalrusOwnerMismatch)]
fun walrus_rejects_different_sender_even_with_exact_admin() { run_walrus_fixture(6); }
#[test, expected_failure(abort_code = EWalrusBindingMismatch)]
fun walrus_rejects_different_system() { run_walrus_fixture(7); }
#[test, expected_failure(abort_code = EWalrusReplay)]
fun walrus_rejects_replayed_root_version_content() { run_walrus_fixture(8); }
#[test, expected_failure(abort_code = EWalrusBootstrapExists)]
fun walrus_rejects_second_policy_bootstrap() { run_walrus_fixture(9); }
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_storage_proof_rejects_expiry_equality() { run_walrus_fixture(10); }
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_storage_proof_rejects_past_expiry() { run_walrus_fixture(11); }
#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::maker_v8)]
fun walrus_rejects_other_root_admin_from_same_author() { run_walrus_fixture(12); }
#[test, expected_failure(abort_code = EWalrusBindingMismatch)]
fun walrus_rejects_author_hash_changed_after_root_commitment() { run_walrus_fixture(13); }
#[test, expected_failure(abort_code = 20, location = animacraft_v8_core::maker_v8)]
fun walrus_rejects_other_catalog_for_bound_root() { run_walrus_fixture(14); }
#[test, expected_failure(abort_code = EWalrusBindingMismatch)]
fun walrus_rejects_certificate_commitment_corruption() { run_walrus_fixture(15); }
#[test, expected_failure(abort_code = EWalrusBindingMismatch)]
fun walrus_rejects_storage_proof_commitment_corruption() { run_walrus_fixture(16); }
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_rejects_policy_commitment_corruption() { run_walrus_fixture(17); }
#[test, expected_failure(abort_code = EWalrusBindingMismatch)]
fun walrus_rejects_other_policy_id_in_unique_catalog_slot() { run_walrus_fixture(18); }

#[test]
fun walrus_blob_id_encoding_is_canonical_little_endian_base64url() {
    assert!(walrus_blob_id_string_v1(0) == b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string());
    assert!(walrus_blob_id_string_v1(1) == b"AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string());
    assert!(walrus_blob_id_string_v1(251) == b"-wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string());
    assert!(walrus_blob_id_string_v1(115792089237316195423570985008687907853269984665640564039457584007913129639935)
        == b"__________________________________________8".to_string());
}

#[test_only]
fun walrus_frozen_certificate_expiry_fixture(mode: u8) {
    // Official Walrus committee/init runner advances the SAME shared System,
    // rather than mutating a proof's claimed time or using the Sui epoch.
    let (mut runner, nodes) = walrus::e2e_runner::setup_committee_for_epoch_one();
    runner.scenario().next_tx(@0xA11);
    let system = runner.scenario().take_shared<System>();
    assert!(walrus_system::epoch(&system) == 1);
    let WalrusFixture { config, protocol_admin, catalog, root, admin, binding, system, blob }
        = walrus_fixture_from_system(0, system, 1, runner.scenario());
    runner.scenario().next_tx(@0xA11);
    let mut policy = runner.scenario().take_shared<WalrusCertificationPolicyV1>();
    let certificate = certify_walrus_living_content_v1(&config, &catalog, &mut policy,
        &root, &admin, binding, &blob, &system, runner.scenario().ctx());
    assert!(certificate.storage_proof.checked_epoch == 1 && certificate.storage_proof.end_epoch == 2);
    assert_certified_living_content_v1(&policy, &certificate, &system, &root);
    freeze_certified_living_content_v1(certificate);
    sui::test_scenario::return_shared(policy);
    sui::test_scenario::return_shared(system);
    runner.next_epoch();
    runner.scenario().next_tx(@0xA11);
    let system = runner.scenario().take_shared<System>();
    let mut policy = runner.scenario().take_shared<WalrusCertificationPolicyV1>();
    let certificate = runner.scenario().take_immutable<CertifiedLivingContentV1>();
    assert!(walrus_system::epoch(&system) == 2);
    // Its historical proof is still internally valid. Only the actual current
    // System check rejects it at the activation/use-witness boundary.
    assert_certified_living_content(&certificate, &policy, &root);
    if (mode == 1) {
        let witness = issue_living_content_use_witness_v1(&config, &catalog,
            &policy, &certificate, &system, &root);
        let (_, _) = consume_living_content_use_witness_v1(&root, &binding, witness);
    } else if (mode == 2) {
        let forbidden = certify_walrus_living_content_v1(&config, &catalog, &mut policy,
            &root, &admin, binding, &blob, &system, runner.scenario().ctx());
        freeze_certified_living_content_v1(forbidden);
    } else {
        assert_certified_living_content_v1(&policy, &certificate, &system, &root);
    };
    sui::test_scenario::return_immutable(certificate);
    sui::test_scenario::return_shared(policy);
    sui::test_scenario::return_shared(system);
    protocol::destroy_protocol_for_testing(config, protocol_admin);
    package_binding::destroy_catalog_for_testing(catalog);
    maker::destroy_maker_for_testing(root, admin);
    walrus_blob::burn(blob);
    std::unit_test::destroy(nodes);
    runner.destroy();
}

#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_frozen_certificate_cannot_bypass_real_system_epoch_expiry() {
    walrus_frozen_certificate_expiry_fixture(0);
}
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_frozen_certificate_cannot_issue_read_witness_after_real_epoch_expiry() {
    walrus_frozen_certificate_expiry_fixture(1);
}
#[test, expected_failure(abort_code = EWalrusInvalid)]
fun walrus_cannot_certify_actual_blob_at_real_epoch_expiry() {
    walrus_frozen_certificate_expiry_fixture(2);
}
