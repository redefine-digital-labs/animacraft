/// Fresh dependency-top orchestration for the unified Animacraft Maker v8.
/// Core owns Root fields; this exact package owns public discovery, lifecycle,
/// and unprotected render transport. Native protected reads use the established
/// Soul identity without introducing another issuer or ciphertext namespace.
module animacraft_v8_release::release_v8;

use walrus::system::System;

use animacraft_v8_core::activation_v8 as activation;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
    RightsSnapshotV8,
};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
    ReleaseRoleV8,
    FreshTupleReplacementBindingV2,
    FreshTupleBootstrapCertificateV2,
};
use animacraft_v8_core::protocol_config_v8::{ProtocolConfigV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::{MakerAccessPassV8, MakerTreasuryV8};
use animacraft_v8_output::output_v8::{
    Self as output,
    CompleteOutputV8,
    CompleteReceiptV8,
    CompleteSessionV8,
    OutputRegistryV8,
    ProtectedCompletePendingV8,
    SoulMintAuthorizationV8,
    OutputPackageConfigV8,
    SoulRegistryV8,
    NativeSoulBindingV8,
};
use soulidity::soul::SoulState;
use soulidity::animacraft_v8_binding as native_read;
use soulidity::animacraft_equipment_adapter_v8 as native_equipment;
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8,
    RuntimeDefinitionRegistryV8, PackRegistryV8, PackAdmissionAuthorityV8,
    OwnedBaseItemV8, PackPassV8, PackReleaseV8};
use animacraft_v8_runtime::runtime_seal_v8 as runtime_seal;
use animacraft_v8_physical::physical_v8::{Self as physical,
    PhysicalPackageConfigV8, PhysicalRegistryV8};
use animacraft_v8_core::companion_binding_v2::{Self as companion, MakerRuntimeCompanionBindingBuilderV2, MakerRuntimeCompanionRegistryIdsV2};
use animacraft_v8_seal::seal_v8::{
    Self as seal,
    CiphertextCertificationV8,
    SealRegistryV8,
    SealPolicyConfigV8,
};
use std::string::String;
use sui::event;

use animacraft_v8_core::core_v8::{Self as core,
    WalrusCertificationPolicyV1, CertifiedLivingContentV1};
#[test_only]
use sui::sui::SUI;

const VERSION: u64 = 8;

const EConfigMismatch: u64 = 0;
const EReadbackMismatch: u64 = 1;
const ERenderWitnessMismatch: u64 = 2;
const ELifecycleMismatch: u64 = 3;

public struct ReleaseOriginalMarkerV8 has drop {}
public struct ReleaseCallableMarkerV8 has drop {}
public struct ReleaseSetupInstallWitnessV2 has drop {}
public struct ReleaseActivationWitnessV2 has drop {}
public struct ReleaseLifecycleWitnessV2 has drop {}
public struct ReleaseRightsWitnessV2 has drop {}

/// Protocol setup consumes Core's unique Release capability and binds its
/// installation commitment to this exact shared config.
public struct ReleasePackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    installation_commitment: vector<u8>,
}

/// Private-constructor, no-ability authority for one unprotected Output finish.
/// The caller supplies render data, never a witness or a pure authority tuple.
public struct ReleaseRenderWitnessV8 {
    root_id: ID,
    catalog_id: ID,
    output_registry_id: ID,
    control_epoch: u64,
    caller: address,
}

/// Private-constructor, no-ability authority for one initial Base ciphertext
/// certification. Seal checks this type's defining package against the frozen
/// Release callable binding and returns it for immediate destruction here.
public struct ReleaseTransportWitnessV8 {
    root_id: ID,
    catalog_id: ID,
    policy_config_id: ID,
    caller: address,
}

/// Sole public discovery event for the exact Release TypeOrigin.
public struct MakerV8Activated has copy, drop {
    root_id: ID,
    version: u64,
    owner: address,
    control_epoch: u64,
    admin_cap_id: ID,
    maker_key: String,
    maker_version: u64,
    version_commitment: vector<u8>,
    content_commitment: vector<u8>,
    renderer_commitment: vector<u8>,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    protocol_treasury_id: ID,
    maker_treasury_id: ID,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    base_registry_id: ID,
    registry_ids: MakerRuntimeCompanionRegistryIdsV2,
    replacement_id: ID,
    bootstrap_certificate_id: ID,
}

public struct MakerV8LifecycleChanged has copy, drop {
    root_id: ID,
    catalog_id: ID,
    maker_version: u64,
    content_commitment: vector<u8>,
    owner: address,
    control_epoch: u64,
    from: u8,
    to: u8,
    registry_ids: MakerRuntimeCompanionRegistryIdsV2,
}

public fun version_v8(): u64 { VERSION }

/// Starts the real companion sequence through Physical. The returned builder
/// must flow through Market and Core finish in the same PTB; it cannot be
/// dropped or stored. This avoids a Release/Market test dependency cycle.
public fun prepare_maker_companion_binding_v2<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    base_registry: &BaseDefinitionRegistryV8,
    walrus_policy: &WalrusCertificationPolicyV1, living_certificate: &CertifiedLivingContentV1,
    system: &System,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    admission: &PackAdmissionAuthorityV8,
    seal_policy: &SealPolicyConfigV8, seal_registry: &SealRegistryV8,
    output_config: &OutputPackageConfigV8, output_registry: &OutputRegistryV8,
    souls: &SoulRegistryV8,
    physical_config: &PhysicalPackageConfigV8, physical_registry: &PhysicalRegistryV8,
    ctx: &TxContext,
): MakerRuntimeCompanionBindingBuilderV2<PaymentCoin> {
    let builder = core::begin_maker_companion_binding_v2(root, admin, protocol_config,
        catalog, replacement, base_registry, walrus_policy, living_certificate, system, ctx);
    let builder = runtime::bind_runtime_companion_v2(builder, root, admin, protocol_config,
        catalog, replacement, definitions, packs, admission, ctx);
    let builder = seal::bind_maker_seal_companion_v2(builder, root, admin, protocol_config,
        catalog, replacement, seal_policy, seal_registry, ctx);
    let builder = output::bind_output_companion_v2(builder, root, admin, protocol_config,
        catalog, replacement, output_config, output_registry, souls, ctx);
    physical::bind_maker_physical_companion_v2(builder, root, admin, protocol_config,
        catalog, replacement, physical_config, physical_registry, base_registry, ctx)
}

public fun new_release_package_config_v8(
    catalog: &mut ProductReleaseCatalogV8,
    release_call_cap: PackageCallCapV8<ReleaseRoleV8>,
    ctx: &mut TxContext,
): ReleasePackageConfigV8 {
    let id = object::new(ctx);
    let installation_commitment = binding::consume_release_call_cap_v8(
        catalog, release_call_cap, ReleaseSetupInstallWitnessV2 {}, id.to_inner());
    let (_, _, _, product, caps, _) = binding::catalog_terms_v2(catalog);
    ReleasePackageConfigV8 {
        id, version: VERSION, catalog_id: object::id(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment: *caps, installation_commitment,
    }
}

public fun share_release_package_config_v8(config: ReleasePackageConfigV8) {
    transfer::share_object(config)
}

/// Release validates its installed config before Core's one-time DRAFT catalog
/// finalizer. Callers supply live objects, never a retained setup capability.
public fun finalize_product_release_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    maker::finalize_product_release_binding_v8(root, admin, protocol_config, catalog, ctx);
    assert_root_product_binding(root, catalog, release_config);
}

/// Exact Release wrapper for license-wrapped author evidence. Its private
/// rights witness certifies the connected signer; no confirmation flag or
/// creator address is accepted from the author document.
public fun new_license_wrapped_rights_snapshot_v8(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    release_config: &ReleasePackageConfigV8,
    evidence_locator: String,
    evidence_blob_id: String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    ctx: &TxContext,
): RightsSnapshotV8 {
    assert_config(catalog, release_config);
    let certification = maker::certify_wrapped_rights_v8(
        ReleaseRightsWitnessV2 {},
        protocol_config,
        catalog,
        replacement,
        evidence_locator,
        evidence_blob_id,
        evidence_sha256,
        terms_commitment,
        ctx,
    );
    maker::new_license_wrapped_rights_snapshot_v8(
        certification,
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
        maker_resale_royalty_bps,
    )
}

/// Certifies one immutable protected Base asset through Release's private
/// transport witness. Scope is fixed on chain; callers cannot relabel a Pack
/// or Complete ciphertext as a Base publication row.
public fun certify_base_ciphertext_v8<PaymentCoin>(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    ctx: &TxContext,
): CiphertextCertificationV8 {
    assert_config(catalog, release_config);
    let root_id = maker::root_id_v8(root);
    let catalog_id = binding::catalog_id_v8(catalog);
    let policy_config_id = seal::policy_id_v8(policy);
    let caller = ctx.sender();
    let witness = ReleaseTransportWitnessV8 {
        root_id,
        catalog_id,
        policy_config_id,
        caller,
    };
    let (witness, certification) = seal::certify_ciphertext_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseTransportWitnessV8,
    >(
        witness,
        protocol_config,
        catalog,
        policy,
        root,
        seal::scope_base_v8(),
        scope_key,
        scope_commitment,
        asset_key,
        asset_content_commitment,
        ciphertext_blob_id,
        ciphertext_sha256,
        ciphertext_blob_commitment,
    );
    let ReleaseTransportWitnessV8 {
        root_id: returned_root_id,
        catalog_id: returned_catalog_id,
        policy_config_id: returned_policy_config_id,
        caller: returned_caller,
    } = witness;
    assert!(returned_root_id == root_id, ERenderWitnessMismatch);
    assert!(returned_catalog_id == catalog_id, ERenderWitnessMismatch);
    assert!(returned_policy_config_id == policy_config_id, ERenderWitnessMismatch);
    assert!(returned_caller == caller, ERenderWitnessMismatch);
    certification
}

/// Certifies one post-activation protected Pack asset through the same frozen
/// Release transport authority. The Pack scope is fixed here so a caller
/// cannot relabel Base or Complete ciphertext as a Pack registration row.
public fun certify_pack_ciphertext_v8<PaymentCoin>(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    scope_key: String,
    scope_commitment: vector<u8>,
    asset_key: String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    ctx: &TxContext,
): CiphertextCertificationV8 {
    assert_config(catalog, release_config);
    let root_id = maker::root_id_v8(root);
    let catalog_id = binding::catalog_id_v8(catalog);
    let policy_config_id = seal::policy_id_v8(policy);
    let caller = ctx.sender();
    let witness = ReleaseTransportWitnessV8 {
        root_id,
        catalog_id,
        policy_config_id,
        caller,
    };
    let (witness, certification) = seal::certify_ciphertext_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseTransportWitnessV8,
    >(
        witness,
        protocol_config,
        catalog,
        policy,
        root,
        seal::scope_pack_v8(),
        scope_key,
        scope_commitment,
        asset_key,
        asset_content_commitment,
        ciphertext_blob_id,
        ciphertext_sha256,
        ciphertext_blob_commitment,
    );
    let ReleaseTransportWitnessV8 {
        root_id: returned_root_id,
        catalog_id: returned_catalog_id,
        policy_config_id: returned_policy_config_id,
        caller: returned_caller,
    } = witness;
    assert!(returned_root_id == root_id, ERenderWitnessMismatch);
    assert!(returned_catalog_id == catalog_id, ERenderWitnessMismatch);
    assert!(returned_policy_config_id == policy_config_id, ERenderWitnessMismatch);
    assert!(returned_caller == caller, ERenderWitnessMismatch);
    certification
}

/// Core validates live replacement/bootstrap/living certificates and the sole
/// installed companion tuple; Release re-reads the result before discovery.
public fun seal_and_activate_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    bootstrap_certificate: &FreshTupleBootstrapCertificateV2,
    walrus_policy: &WalrusCertificationPolicyV1, living_certificate: &CertifiedLivingContentV1,
    system: &System,
    base_registry: &BaseDefinitionRegistryV8,
    release_config: &ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let ids = maker::root_companion_registry_ids_v2(root);
    let packs = companion::pack_registry_id_v2(ids);
    let admission = companion::admission_authority_id_v2(ids);
    let policy = *maker::root_expected_pack_admission_policy_commitment_v2(root);
    activation::activate_maker_v8(
        ReleaseActivationWitnessV2 {}, protocol_config, catalog, replacement,
        bootstrap_certificate, walrus_policy, living_certificate, system, root, admin,
        base_registry, packs, admission, policy, ctx);
    let ids = assert_control_readback(root, admin, catalog, release_config, 1, ctx);
    emit_activation(root, admin, catalog, ids, replacement, bootstrap_certificate);
}

public fun pause_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    release_config: &ReleasePackageConfigV8, ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let from = maker::root_lifecycle_v8(root);
    activation::pause_maker_v8(ReleaseLifecycleWitnessV2 {}, protocol_config, catalog, replacement, root, admin, ctx);
    emit_lifecycle_after_readback(root, admin, catalog, release_config, from, 2, ctx);
}
public fun resume_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    release_config: &ReleasePackageConfigV8, ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let from = maker::root_lifecycle_v8(root);
    activation::resume_maker_v8(ReleaseLifecycleWitnessV2 {}, protocol_config, catalog, replacement, root, admin, ctx);
    emit_lifecycle_after_readback(root, admin, catalog, release_config, from, 1, ctx);
}
public fun archive_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    release_config: &ReleasePackageConfigV8, ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let from = maker::root_lifecycle_v8(root);
    activation::archive_maker_v8(ReleaseLifecycleWitnessV2 {}, protocol_config, catalog, replacement, root, admin, ctx);
    emit_lifecycle_after_readback(root, admin, catalog, release_config, from, 3, ctx);
}

/// Exact Release-only wrapper for Output's generic transport boundary.
public fun finish_unprotected_complete_v8<PaymentCoin>(
    session: CompleteSessionV8,
    output_registry: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    release_config: &ReleasePackageConfigV8,
    loadout: &MakerLoadoutV8,
    render_blob_id: String,
    render_sha256: vector<u8>,
    render_blob_commitment: vector<u8>,
    ctx: &mut TxContext,
): SoulMintAuthorizationV8 {
    assert_config(catalog, release_config);
    let capability = assert_bound_root_catalog(root, catalog, release_config);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(),
        ELifecycleMismatch);
    assert!(companion::output_registry_id_v2(capability)
        == object::id(output_registry), EReadbackMismatch);
    let root_id = maker::root_id_v8(root);
    let catalog_id = binding::catalog_id_v8(catalog);
    let output_registry_id = object::id(output_registry);
    let control_epoch = maker::root_control_epoch_v2(root);
    let caller = ctx.sender();
    let witness = ReleaseRenderWitnessV8 {
        root_id,
        catalog_id,
        output_registry_id,
        control_epoch,
        caller,
    };
    let (witness, authorization) = output::finish_unprotected_complete_v8<
        PaymentCoin,
        ReleaseRenderWitnessV8,
    >(
        witness,
        session,
        output_registry,
        root,
        protocol_config,
        catalog,
        replacement,
        loadout,
        render_blob_id,
        render_sha256,
        render_blob_commitment,
        ctx,
    );
    let ReleaseRenderWitnessV8 {
        root_id: returned_root_id,
        catalog_id: returned_catalog_id,
        output_registry_id: returned_output_registry_id,
        control_epoch: returned_control_epoch,
        caller: returned_caller,
    } = witness;
    assert!(returned_root_id == root_id, ERenderWitnessMismatch);
    assert!(returned_catalog_id == catalog_id, ERenderWitnessMismatch);
    assert!(returned_output_registry_id == output_registry_id, ERenderWitnessMismatch);
    assert!(returned_control_epoch == control_epoch, ERenderWitnessMismatch);
    assert!(returned_caller == caller, ERenderWitnessMismatch);
    authorization
}

/// Exact same-PTB protected Complete bridge. Release first asks Output to
/// derive the immutable Output/Receipt commitments from the consumed Runtime
/// session. It then certifies and registers those exact ciphertext bytes in
/// Seal, turns the private pending receipt into a transaction-local decrypt
/// proof, and returns the one-use Soul authorization. No caller-provided
/// commitment or proof can replace any value read from `pending`.
public fun finish_protected_complete_v8<PaymentCoin>(
    session: CompleteSessionV8,
    output_registry: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    seal_registry: &mut SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    expected_seal_revision: u64,
    loadout: &MakerLoadoutV8,
    ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    scope_key: String,
    asset_key: String,
    ctx: &mut TxContext,
): SoulMintAuthorizationV8 {
    assert_config(catalog, release_config);
    let capability = assert_bound_root_catalog(root, catalog, release_config);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(),
        ELifecycleMismatch);
    assert!(companion::output_registry_id_v2(capability)
        == object::id(output_registry), EReadbackMismatch);
    assert!(companion::seal_registry_id_v2(capability)
        == seal::registry_id_v8(seal_registry), EReadbackMismatch);
    assert!(seal::policy_catalog_id_v8(seal_policy) == object::id(catalog)
        && seal::policy_call_cap_set_commitment_v8(seal_policy)
            == maker::root_product_release_call_cap_set_commitment_v8(root), EReadbackMismatch);
    let pending = output::finish_protected_complete_v8(
        session,
        output_registry,
        root,
        loadout,
        ciphertext_blob_id,
        ciphertext_sha256,
        ciphertext_blob_commitment,
        scope_key,
        asset_key,
        ctx,
    );
    certify_and_finalize_protected_complete(
        pending,
        protocol_config,
        catalog,
        seal_registry,
        seal_policy,
        root,
        expected_seal_revision,
        ctx,
    )
}

fun certify_and_finalize_protected_complete<PaymentCoin>(
    pending: ProtectedCompletePendingV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    seal_registry: &mut SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
    root: &MakerRootV8<PaymentCoin>,
    expected_seal_revision: u64,
    ctx: &TxContext,
): SoulMintAuthorizationV8 {
    let root_id = maker::root_id_v8(root);
    let catalog_id = binding::catalog_id_v8(catalog);
    let policy_config_id = seal::policy_id_v8(seal_policy);
    let caller = ctx.sender();
    let witness = ReleaseTransportWitnessV8 {
        root_id,
        catalog_id,
        policy_config_id,
        caller,
    };
    let instance_commitment =
        output::pending_complete_instance_commitment_v8(&pending);
    let output_commitment = *output::pending_output_commitment_v8(&pending);
    let (witness, certification) = seal::certify_ciphertext_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseTransportWitnessV8,
    >(
        witness,
        protocol_config,
        catalog,
        seal_policy,
        root,
        seal::scope_complete_v8(),
        *output::pending_scope_key_v8(&pending),
        instance_commitment,
        *output::pending_asset_key_v8(&pending),
        output_commitment,
        *output::pending_render_blob_id_v8(&pending),
        *output::pending_render_sha256_v8(&pending),
        *output::pending_render_blob_commitment_v8(&pending),
    );
    let (witness, seal_id) = seal::register_complete_ciphertext_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseTransportWitnessV8,
    >(
        witness,
        seal_registry,
        root,
        seal_policy,
        catalog,
        expected_seal_revision,
        certification,
    );
    let (witness, proof) = seal::certify_complete_receipt_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseTransportWitnessV8,
    >(
        witness,
        catalog,
        root,
        caller,
        output::pending_receipt_id_v8(&pending),
        output::pending_output_id_v8(&pending),
        *output::pending_recipe_commitment_v8(&pending),
        *output::pending_render_commitment_v8(&pending),
        *output::pending_output_commitment_v8(&pending),
        *output::pending_receipt_commitment_v8(&pending),
        *output::pending_scope_key_v8(&pending),
        *output::pending_asset_key_v8(&pending),
        seal_id,
    );
    let authorization = output::finalize_protected_complete_v8(
        pending,
        seal_id,
        seal_registry,
        seal_policy,
        root,
        proof,
        ctx,
    );
    let ReleaseTransportWitnessV8 {
        root_id: returned_root_id,
        catalog_id: returned_catalog_id,
        policy_config_id: returned_policy_config_id,
        caller: returned_caller,
    } = witness;
    assert!(returned_root_id == root_id, ERenderWitnessMismatch);
    assert!(returned_catalog_id == catalog_id, ERenderWitnessMismatch);
    assert!(returned_policy_config_id == policy_config_id,
        ERenderWitnessMismatch);
    assert!(returned_caller == caller, ERenderWitnessMismatch);
    authorization
}

/// Runtime's exact entitlement proof is minted and consumed inside this
/// single Release approval; the key-server PTB supplies only original inputs.
entry fun seal_approve_base_v8<PaymentCoin>(
    id: vector<u8>, release_config: &ReleasePackageConfigV8,
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8, root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8, catalog: &ProductReleaseCatalogV8,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8,
    selection_index: u64, part_key: String, item_key: String, style_key: String,
    ciphertext_blob_commitment: vector<u8>, certification_commitment: vector<u8>,
    seal_id: vector<u8>, ctx: &TxContext,
) {
    assert!(!runtime::is_soul_equipment_v8(loadout), EReadbackMismatch);
    assert_read_seal_binding(root, catalog, release_config, seal_registry, seal_policy);
    let proof = runtime_seal::certify_protected_base_entitlement_v8(
        loadout, definitions, base_registry, root, maker_access, catalog,
        seal_registry, seal_policy, selection_index, part_key, item_key, style_key,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
    seal::consume_base_decrypt_proof_v8(id, seal_registry, seal_policy, root, proof, ctx);
}

entry fun seal_approve_owned_base_v8<PaymentCoin>(
    id: vector<u8>, release_config: &ReleasePackageConfigV8,
    loadout: &MakerLoadoutV8, item: &OwnedBaseItemV8,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8, root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8, catalog: &ProductReleaseCatalogV8,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8,
    selection_index: u64, part_key: String, item_key: String, style_key: String,
    ciphertext_blob_commitment: vector<u8>, certification_commitment: vector<u8>,
    seal_id: vector<u8>, ctx: &TxContext,
) {
    assert!(!runtime::is_soul_equipment_v8(loadout), EReadbackMismatch);
    assert_read_seal_binding(root, catalog, release_config, seal_registry, seal_policy);
    let proof = runtime_seal::certify_protected_owned_base_entitlement_v8(
        loadout, item, definitions, packs, base_registry, root, maker_access, catalog,
        seal_registry, seal_policy, selection_index, part_key, item_key, style_key,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
    seal::consume_base_decrypt_proof_v8(id, seal_registry, seal_policy, root, proof, ctx);
}

entry fun seal_approve_pack_v8<PaymentCoin>(
    id: vector<u8>, release_config: &ReleasePackageConfigV8,
    loadout: &MakerLoadoutV8, packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, pass: &PackPassV8,
    catalog: &ProductReleaseCatalogV8, root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8, seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8, selection_index: u64,
    part_key: String, item_key: String, style_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>, seal_id: vector<u8>, ctx: &TxContext,
) {
    assert!(!runtime::is_soul_equipment_v8(loadout), EReadbackMismatch);
    assert_read_seal_binding(root, catalog, release_config, seal_registry, seal_policy);
    let proof = runtime_seal::certify_protected_pack_entitlement_v8(
        loadout, packs, release, pass, catalog, root, maker_access, seal_registry,
        seal_policy, selection_index, part_key, item_key, style_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
    seal::consume_pack_decrypt_proof_v8(id, seal_registry, seal_policy, root, proof, ctx);
}

/// Native equipment approvals use the same Release namespace, but cannot use
/// the temporary Player entry to bypass current Soul ownership and its DF10.
entry fun seal_approve_equipped_base_v8<PaymentCoin>(
    id: vector<u8>, release_config: &ReleasePackageConfigV8,
    state: &SoulState, protocol: &ProtocolConfigV8,
    loadout: &MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    base_registry: &BaseDefinitionRegistryV8, root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8, catalog: &ProductReleaseCatalogV8,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8,
    selection_index: u64, part_key: String, item_key: String, style_key: String,
    ciphertext_blob_commitment: vector<u8>, certification_commitment: vector<u8>,
    seal_id: vector<u8>, ctx: &TxContext,
) {
    assert_read_seal_binding(root, catalog, release_config, seal_registry, seal_policy);
    native_equipment::assert_equipment_read_v8(state, loadout, protocol, ctx);
    let proof = runtime_seal::certify_protected_base_entitlement_v8(
        loadout, definitions, base_registry, root, maker_access, catalog,
        seal_registry, seal_policy, selection_index, part_key, item_key, style_key,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
    seal::consume_base_decrypt_proof_v8(id, seal_registry, seal_policy, root, proof, ctx);
}

entry fun seal_approve_equipped_owned_base_v8<PaymentCoin>(
    id: vector<u8>, release_config: &ReleasePackageConfigV8,
    state: &SoulState, protocol: &ProtocolConfigV8,
    loadout: &MakerLoadoutV8, item: &OwnedBaseItemV8,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    base_registry: &BaseDefinitionRegistryV8, root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8, catalog: &ProductReleaseCatalogV8,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8,
    selection_index: u64, part_key: String, item_key: String, style_key: String,
    ciphertext_blob_commitment: vector<u8>, certification_commitment: vector<u8>,
    seal_id: vector<u8>, ctx: &TxContext,
) {
    assert_read_seal_binding(root, catalog, release_config, seal_registry, seal_policy);
    native_equipment::assert_equipment_read_v8(state, loadout, protocol, ctx);
    let proof = runtime_seal::certify_protected_owned_base_entitlement_v8(
        loadout, item, definitions, packs, base_registry, root, maker_access, catalog,
        seal_registry, seal_policy, selection_index, part_key, item_key, style_key,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
    seal::consume_base_decrypt_proof_v8(id, seal_registry, seal_policy, root, proof, ctx);
}

entry fun seal_approve_equipped_pack_v8<PaymentCoin>(
    id: vector<u8>, release_config: &ReleasePackageConfigV8,
    state: &SoulState, protocol: &ProtocolConfigV8,
    loadout: &MakerLoadoutV8, packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, pass: &PackPassV8,
    catalog: &ProductReleaseCatalogV8, root: &MakerRootV8<PaymentCoin>,
    maker_access: &MakerAccessPassV8, seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8, selection_index: u64,
    part_key: String, item_key: String, style_key: String,
    asset_content_commitment: vector<u8>, ciphertext_blob_id: String,
    ciphertext_sha256: vector<u8>, ciphertext_blob_commitment: vector<u8>,
    certification_commitment: vector<u8>, seal_id: vector<u8>, ctx: &TxContext,
) {
    assert_read_seal_binding(root, catalog, release_config, seal_registry, seal_policy);
    native_equipment::assert_equipment_read_v8(state, loadout, protocol, ctx);
    let proof = runtime_seal::certify_protected_pack_entitlement_v8(
        loadout, packs, release, pass, catalog, root, maker_access, seal_registry,
        seal_policy, selection_index, part_key, item_key, style_key,
        asset_content_commitment, ciphertext_blob_id, ciphertext_sha256,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
    seal::consume_pack_decrypt_proof_v8(id, seal_registry, seal_policy, root, proof, ctx);
}

fun assert_read_seal_binding<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8, seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8,
) {
    assert_config(catalog, release_config);
    let capability = assert_bound_root_catalog(root, catalog, release_config);
    assert!(companion::seal_registry_id_v2(capability)
        == seal::registry_id_v8(seal_registry), EReadbackMismatch);
    assert!(seal::policy_catalog_id_v8(seal_policy) == object::id(catalog)
        && seal::policy_call_cap_set_commitment_v8(seal_policy)
            == maker::root_product_release_call_cap_set_commitment_v8(root), EReadbackMismatch);
}

/// One Seal-approved PTB call in the existing Release encryption namespace.
/// Live native ownership is derived inside this call, never supplied as a
/// caller tuple or as a result from a preceding PTB command. Listing and paused
/// issuance do not revoke the holder's read access to an existing completed Soul.
entry fun seal_approve_complete_v8<PaymentCoin>(
    id: vector<u8>, state: &SoulState, provenance: &NativeSoulBindingV8,
    complete_output: &CompleteOutputV8, receipt: &CompleteReceiptV8,
    root: &MakerRootV8<PaymentCoin>, protocol: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8, release_config: &ReleasePackageConfigV8,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8, ctx: &TxContext,
) {
    let native_proof = native_read::certify_native_complete_read_v8(
        state, provenance, complete_output, receipt, root, protocol, ctx);
    let (holder, receipt_id, output_id, recipe_commitment,
        render_commitment, output_commitment, receipt_commitment,
        scope_key, asset_key, seal_id) = output::consume_native_complete_decrypt_proof_v8(native_proof);
    approve_complete_fields_v8(id, root, catalog, release_config, seal_registry,
        seal_policy, holder, receipt_id, output_id, recipe_commitment,
        render_commitment, output_commitment, receipt_commitment,
        scope_key, asset_key, seal_id, ctx);
}

/// VM access to the exact single-entry body; production visibility is unchanged.
#[test_only]
public fun seal_approve_complete_for_testing_v8<PaymentCoin>(
    id: vector<u8>, state: &SoulState, provenance: &NativeSoulBindingV8,
    complete_output: &CompleteOutputV8, receipt: &CompleteReceiptV8,
    root: &MakerRootV8<PaymentCoin>, protocol: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8, release_config: &ReleasePackageConfigV8,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8, ctx: &TxContext,
) {
    seal_approve_complete_v8(id, state, provenance, complete_output, receipt,
        root, protocol, catalog, release_config, seal_registry, seal_policy, ctx);
}

fun approve_complete_fields_v8<PaymentCoin>(
    id: vector<u8>, root: &MakerRootV8<PaymentCoin>, catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8, seal_registry: &SealRegistryV8,
    seal_policy: &SealPolicyConfigV8, holder: address, receipt_id: ID, output_id: ID,
    recipe_commitment: vector<u8>, render_commitment: vector<u8>,
    output_commitment: vector<u8>, receipt_commitment: vector<u8>,
    scope_key: String, asset_key: String, seal_id: vector<u8>, ctx: &TxContext,
) {
    assert_read_seal_binding(root, catalog, release_config, seal_registry, seal_policy);
    assert!(seal_id == id, EReadbackMismatch);
    let witness = ReleaseTransportWitnessV8 {
        root_id: maker::root_id_v8(root),
        catalog_id: binding::catalog_id_v8(catalog),
        policy_config_id: seal::policy_id_v8(seal_policy),
        caller: ctx.sender(),
    };
    let (witness, proof) = seal::certify_complete_receipt_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseTransportWitnessV8,
    >(
        witness, catalog, root, holder, receipt_id, output_id,
        recipe_commitment, render_commitment, output_commitment,
        receipt_commitment, scope_key, asset_key, seal_id,
    );
    let (_, _, _, _, _, _, _, _, consumed_id) =
        seal::consume_complete_decrypt_proof_v8(
            id, seal_registry, seal_policy, root, proof, ctx);
    assert!(consumed_id == seal_id, EReadbackMismatch);
    let ReleaseTransportWitnessV8 {
        root_id: returned_root_id,
        catalog_id: returned_catalog_id,
        policy_config_id: returned_policy_config_id,
        caller: returned_caller,
    } = witness;
    assert!(returned_root_id == maker::root_id_v8(root),
        ERenderWitnessMismatch);
    assert!(returned_catalog_id == binding::catalog_id_v8(catalog),
        ERenderWitnessMismatch);
    assert!(returned_policy_config_id == seal::policy_id_v8(seal_policy),
        ERenderWitnessMismatch);
    assert!(returned_caller == ctx.sender(), ERenderWitnessMismatch);
}

fun emit_lifecycle_after_readback<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    from: u8,
    to: u8,
    ctx: &TxContext,
) {
    let capability = assert_control_readback(
        root, admin, catalog, release_config, to, ctx);
    assert!(from != to, ELifecycleMismatch);
    assert!(
        (from == maker::lifecycle_active_v8() && to == maker::lifecycle_paused_v8())
            || (from == maker::lifecycle_paused_v8() && to == maker::lifecycle_active_v8())
            || ((from == maker::lifecycle_active_v8()
                    || from == maker::lifecycle_paused_v8())
                && to == maker::lifecycle_archived_v8()),
        ELifecycleMismatch,
    );
    event::emit(MakerV8LifecycleChanged {
        root_id: maker::root_id_v8(root),
        catalog_id: binding::catalog_id_v8(catalog),
        maker_version: maker::root_maker_version_v8(root),
        content_commitment: *maker::root_content_commitment_v8(root),
        owner: maker::root_owner_v8(root),
        control_epoch: maker::root_control_epoch_v2(root),
        from,
        to,
        registry_ids: *capability,
    });
}

fun assert_control_readback<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    expected_lifecycle: u8,
    ctx: &TxContext,
): &MakerRuntimeCompanionRegistryIdsV2 {
    maker::assert_admin_v8(root, admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EReadbackMismatch);
    assert!(maker::root_lifecycle_v8(root) == expected_lifecycle, ELifecycleMismatch);
    assert_bound_root_catalog(root, catalog, release_config)
}

fun assert_bound_root_catalog<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
): &MakerRuntimeCompanionRegistryIdsV2 {
    assert_root_product_binding(root, catalog, release_config);
    maker::root_companion_registry_ids_v2(root)
}
fun assert_root_product_binding<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
) {
    assert_config(catalog, release_config);
    maker::assert_product_release_catalog_v8(root, catalog);
}
fun assert_config(catalog: &ProductReleaseCatalogV8, config: &ReleasePackageConfigV8) {
    assert!(config.version == VERSION && config.catalog_id == object::id(catalog), EConfigMismatch);
    let (_, _, _, product, caps, _) = binding::catalog_terms_v2(catalog);
    assert!(&config.product_binding_commitment == binding::product_binding_commitment_v8(product)
        && &config.call_cap_set_commitment == caps, EConfigMismatch);
    binding::assert_role_config_installation_v2(catalog, 6, object::id(config), &config.installation_commitment);
}

fun emit_activation<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>, admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8, ids: &MakerRuntimeCompanionRegistryIdsV2,
    replacement: &FreshTupleReplacementBindingV2,
    bootstrap_certificate: &FreshTupleBootstrapCertificateV2,
) {
    let economics = maker::root_economics_v8(root);
    event::emit(MakerV8Activated {
        root_id: object::id(root), version: VERSION, owner: maker::root_owner_v8(root),
        control_epoch: maker::root_control_epoch_v2(root), admin_cap_id: object::id(admin),
        maker_key: *maker::root_maker_key_v2(root), maker_version: maker::root_maker_version_v8(root),
        version_commitment: *maker::root_version_commitment_v2(root),
        content_commitment: *maker::root_content_commitment_v8(root),
        renderer_commitment: *maker::root_renderer_commitment_v2(root),
        protocol_config_id: maker::economics_protocol_config_id_v2(&economics),
        protocol_config_revision: maker::economics_protocol_config_revision_v2(&economics),
        protocol_config_commitment: *maker::economics_protocol_config_commitment_v2(&economics),
        protocol_treasury_id: maker::economics_protocol_treasury_id_v2(&economics),
        maker_treasury_id: maker::root_maker_treasury_id_v2(root),
        catalog_id: object::id(catalog),
        product_binding_commitment: *maker::root_product_release_binding_commitment_v8(root),
        call_cap_set_commitment: *maker::root_product_release_call_cap_set_commitment_v8(root),
        base_registry_id: maker::root_base_registry_id_v2(root),
        registry_ids: *ids, replacement_id: object::id(replacement),
        bootstrap_certificate_id: object::id(bootstrap_certificate),
    });
}

public fun config_id_v8(config: &ReleasePackageConfigV8): ID { object::id(config) }
public fun config_catalog_id_v8(config: &ReleasePackageConfigV8): ID { config.catalog_id }
public fun config_product_binding_commitment_v8(
    config: &ReleasePackageConfigV8,
): &vector<u8> { &config.product_binding_commitment }
public fun config_call_cap_set_commitment_v8(
    config: &ReleasePackageConfigV8,
): &vector<u8> { &config.call_cap_set_commitment }

#[test_only]
public fun destroy_release_package_config_for_testing(config: ReleasePackageConfigV8) {
    let ReleasePackageConfigV8 {
        id,
        version: _,
        catalog_id: _,
        product_binding_commitment: _,
        call_cap_set_commitment: _,
        installation_commitment: _,
    } = config;
    id.delete();
}

/// Exact private event-field assertions fed only by upper-graph real objects.
#[test_only]
public fun capture_activation_event_for_testing(): MakerV8Activated {
    let events = event::events_by_type<MakerV8Activated>();
    assert!(events.length() == 1, 99);
    assert!(event::events_by_type<MakerV8LifecycleChanged>().is_empty(), 99);
    events[0]
}

#[test_only]
public fun assert_activation_for_testing(
    activated: MakerV8Activated,
    root: &MakerRootV8<SUI>, admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8, base_registry: &BaseDefinitionRegistryV8,
    maker_treasury: &MakerTreasuryV8<SUI>, protocol_treasury: &ProtocolTreasuryV8<SUI>,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8,
    companion_ids: vector<ID>, replacement_id: ID, bootstrap_id: ID,
) {
    assert!(companion_ids.length() == 9, 99);
    assert!(maker::root_lifecycle_v8(root) == maker::lifecycle_active_v8(), 99);
    let registry_ids = maker::root_companion_registry_ids_v2(root);
    let economics = maker::root_economics_v8(root);
    let activated = &activated;
    assert!(activated.root_id == maker::root_id_v8(root), 99);
    assert!(activated.version == version_v8(), 99);
    assert!(activated.owner == maker::root_owner_v8(root), 99);
    assert!(activated.control_epoch == maker::root_control_epoch_v2(root), 99);
    assert!(activated.admin_cap_id == object::id(admin), 99);
    assert!(&activated.maker_key == maker::root_maker_key_v2(root), 99);
    assert!(activated.maker_version == maker::root_maker_version_v8(root), 99);
    assert!(&activated.version_commitment
        == maker::root_version_commitment_v2(root), 99);
    assert!(&activated.content_commitment
        == maker::root_content_commitment_v8(root), 99);
    assert!(&activated.renderer_commitment
        == maker::root_renderer_commitment_v2(root), 99);
    assert!(activated.protocol_config_id
        == maker::economics_protocol_config_id_v2(&economics), 99);
    assert!(activated.protocol_config_revision
        == maker::economics_protocol_config_revision_v2(&economics), 99);
    assert!(&activated.protocol_config_commitment
        == maker::economics_protocol_config_commitment_v2(&economics), 99);
    assert!(activated.protocol_treasury_id
        == object::id(protocol_treasury), 99);
    assert!(activated.maker_treasury_id == object::id(maker_treasury), 99);
    assert!(activated.catalog_id == binding::catalog_id_v8(catalog), 99);
    assert!(&activated.product_binding_commitment
        == binding::product_binding_commitment_v8(
            binding::catalog_binding_v8(catalog)), 99);
    let (_, _, _, _, call_caps, _) = binding::catalog_terms_v2(catalog);
    assert!(&activated.call_cap_set_commitment == call_caps, 99);
    // The current event carries the complete installed companion tuple, not
    // the retired capability mask/commitment or flattened registry fields.
    assert!(&activated.registry_ids == registry_ids, 99);
    assert!(activated.base_registry_id == object::id(base_registry), 99);
    assert!(companion::seal_registry_id_v2(&activated.registry_ids)
        == object::id(seal_registry), 99);
    // Policy identity is reached through that exact Seal registry; it is not
    // an independent field of the new discovery event.
    assert!(seal::registry_policy_config_id_v8(seal_registry)
        == object::id(seal_policy), 99);
    assert!(seal::policy_catalog_id_v8(seal_policy)
        == activated.catalog_id, 99);
    assert!(companion::runtime_definition_registry_id_v2(&activated.registry_ids)
        == companion_ids[0], 99);
    assert!(companion::pack_registry_id_v2(&activated.registry_ids)
        == companion_ids[1], 99);
    assert!(companion::admission_authority_id_v2(&activated.registry_ids)
        == companion_ids[2], 99);
    assert!(companion::output_registry_id_v2(&activated.registry_ids)
        == companion_ids[4], 99);
    assert!(companion::soul_registry_id_v2(&activated.registry_ids)
        == companion_ids[5], 99);
    assert!(companion::physical_registry_id_v2(&activated.registry_ids)
        == companion_ids[6], 99);
    assert!(companion::market_registry_id_v2(&activated.registry_ids)
        == companion_ids[7], 99);
    assert!(activated.replacement_id == replacement_id, 99);
    assert!(activated.bootstrap_certificate_id == bootstrap_id, 99);
}

#[test_only]
public fun assert_lifecycle_events_for_testing(
    root: &MakerRootV8<SUI>, catalog: &ProductReleaseCatalogV8,
    previous: vector<u8>, current: vector<u8>,
) {
    let events = event::events_by_type<MakerV8LifecycleChanged>();
    assert!(events.length() == previous.length() && events.length() == current.length(), 99);
    let mut i = 0;
    while (i < events.length()) {
        assert!(events[i].from == previous[i] && events[i].to == current[i], 99);
        i = i + 1;
    };
    let registry_ids = maker::root_companion_registry_ids_v2(root);
    let mut index = 0u64;
    while (index < events.length()) {
        let changed = &events[index];
        assert!(changed.root_id == maker::root_id_v8(root), 99);
        assert!(changed.catalog_id == binding::catalog_id_v8(catalog), 99);
        assert!(changed.maker_version == maker::root_maker_version_v8(root), 99);
        assert!(&changed.content_commitment
            == maker::root_content_commitment_v8(root), 99);
        assert!(changed.owner == maker::root_owner_v8(root), 99);
        assert!(changed.control_epoch == maker::root_control_epoch_v2(root), 99);
        assert!(&changed.registry_ids == registry_ids, 99);
        index = index + 1;
    };
}

/// This deliberately tests pending protected Complete preparation, not the
/// native mint or protected-read end-to-end path.
#[test_only]
public fun assert_protected_complete_preparation_for_testing(
    protocol_config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
    seal_policy: &SealPolicyConfigV8, root: &MakerRootV8<SUI>,
    seal_registry: &mut SealRegistryV8, ctx: &mut TxContext,
) {
    let pending = output::protected_complete_pending_for_testing_v8(
        root,
        ctx.sender(),
        b"complete/protected-fixture".to_string(),
        b"receipt-a11-0".to_string(),
        ctx,
    );
    let config = protocol_config;
    let catalog = catalog;
    let seal_policy_config = seal_policy;
    let root = root;
    let seal_registry = seal_registry;
    let authorization = certify_and_finalize_protected_complete(
        pending,
        config,
        catalog,
        seal_registry,
        seal_policy_config,
        root,
        0,
        ctx,
    );
    assert!(seal::registry_runtime_revision_v8(seal_registry) == 1, 99);
    let (complete_output, receipt) =
        output::borrow_soul_mint_authorization_for_testing_v8(&authorization);
    // This test covers protected Complete preparation, not read access before
    // native mint. Read authorization now requires the actual bound SoulState.
    assert!(output::soul_mint_authorization_protected_v8(&authorization), 100);
    assert!(output::complete_output_holder_v8(complete_output) == ctx.sender()
        && output::receipt_holder_v8(receipt) == ctx.sender(), 101);
    assert!(output::complete_output_commitment_v8(complete_output).length() == 32
        && output::receipt_commitment_v8(receipt).length() == 32
        && output::soul_mint_authorization_commitment_v8(&authorization).length() == 32, 102);
    output::destroy_soul_mint_authorization_for_testing_v8(authorization);
}

#[test_only]
public fun assert_render_witness_roundtrip_for_testing(
    root: &MakerRootV8<SUI>, catalog: &ProductReleaseCatalogV8,
    output_registry: &OutputRegistryV8, ctx: &TxContext,
) {
    let root_id = maker::root_id_v8(root);
    let catalog_id = binding::catalog_id_v8(catalog);
    let output_registry_id = object::id(output_registry);
    let control_epoch = maker::root_control_epoch_v2(root);
    let caller = ctx.sender();
    let witness = ReleaseRenderWitnessV8 {
        root_id,
        catalog_id,
        output_registry_id,
        control_epoch,
        caller,
    };
    let ReleaseRenderWitnessV8 {
        root_id: returned_root_id,
        catalog_id: returned_catalog_id,
        output_registry_id: returned_output_registry_id,
        control_epoch: returned_control_epoch,
        caller: returned_caller,
    } = witness;
    assert!(returned_root_id == root_id, 99);
    assert!(returned_catalog_id == catalog_id, 99);
    assert!(returned_output_registry_id == output_registry_id, 99);
    assert!(returned_control_epoch == control_epoch, 99);
    assert!(returned_caller == caller, 99);
}
