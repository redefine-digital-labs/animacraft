/// Fresh dependency-top orchestration for the unified Animacraft Maker v8.
/// Core owns Root fields; this exact package owns public discovery, lifecycle,
/// and unprotected render transport. No legacy package is imported.
module animacraft_v8_release::release_v8;

use animacraft_v8_core::activation_v8::{
    Self as activation,
    MarketReadinessV8,
    OutputReadinessV8,
    PhysicalReadinessV8,
    RuntimeActivationReadinessV8,
    SealReadinessV8,
};
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::maker_v8::{
    Self as maker,
    CapabilityRegistryBindingV8,
    MakerAdminCapV8,
    MakerRootV8,
    RightsSnapshotV8,
};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
    ReleaseRoleV8,
};
use animacraft_v8_core::protocol_config_v8::{ProtocolConfigV8, ProtocolTreasuryV8};
use animacraft_v8_core::treasury_v8::MakerTreasuryV8;
use animacraft_v8_output::output_v8::{
    Self as output,
    CompleteSessionV8,
    OutputRegistryV8,
    SoulMintAuthorizationV8,
};
use animacraft_v8_runtime::runtime_v8::MakerLoadoutV8;
use animacraft_v8_seal::seal_v8::{
    Self as seal,
    CiphertextCertificationV8,
    SealPolicyConfigV8,
};
use std::string::String;
use sui::event;

#[test_only]
use animacraft_v8_core::base_registry_v8 as base;
#[test_only]
use animacraft_v8_core::core_v8 as core;
#[test_only]
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolAdminCapV8};
#[test_only]
use animacraft_v8_core::treasury_v8 as core_treasury;
#[test_only]
use animacraft_v8_seal::seal_v8::{SealCallableMarkerV8, SealOriginalMarkerV8};
#[test_only]
use sui::sui::SUI;

const VERSION: u64 = 8;

const EConfigMismatch: u64 = 0;
const EReadbackMismatch: u64 = 1;
const ERenderWitnessMismatch: u64 = 2;
const ELifecycleMismatch: u64 = 3;

public struct ReleaseOriginalMarkerV8 has drop {}
public struct ReleaseCallableMarkerV8 has drop {}

/// Protocol setup moves Core's unique Release capability into this exact
/// shared config. There is no accessor that can expose or extract the cap.
public struct ReleasePackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    release_call_cap: PackageCallCapV8<ReleaseRoleV8>,
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
    native_capability_mask: u64,
    capability_binding_commitment: vector<u8>,
    base_registry_id: ID,
    seal_policy_config_id: ID,
    seal_registry_id: ID,
    runtime_definition_registry_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    output_registry_id: ID,
    soul_registry_id: ID,
    physical_registry_id: ID,
    market_registry_id: ID,
    market_treasury_id: ID,
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
    capability_binding_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }

public fun new_release_package_config_v8(
    catalog: &ProductReleaseCatalogV8,
    release_call_cap: PackageCallCapV8<ReleaseRoleV8>,
    ctx: &mut TxContext,
): ReleasePackageConfigV8 {
    binding::assert_release_call_cap_v8(catalog, &release_call_cap);
    assert_release_type_origins(catalog);
    let product = binding::catalog_binding_v8(catalog);
    ReleasePackageConfigV8 {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment: *binding::product_binding_commitment_v8(product),
        call_cap_set_commitment:
            *binding::call_cap_set_commitment_v8(binding::catalog_call_cap_set_v8(catalog)),
        release_call_cap,
    }
}

public fun share_release_package_config_v8(config: ReleasePackageConfigV8) {
    transfer::share_object(config)
}

/// Sole production bridge from Release's private call capability to Core's
/// one-time DRAFT product-catalog finalizer. Callers supply live objects, never
/// a capability or a caller-authored binding witness.
public fun finalize_product_release_binding_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let witness = binding::certify_release_catalog_witness_v8(
        protocol_config,
        catalog,
        &release_config.release_call_cap,
    );
    maker::finalize_product_release_binding_v8(
        root,
        admin,
        protocol_config,
        witness,
        ctx,
    );
    assert_root_product_binding(root, catalog, release_config);
}

/// Exact Release wrapper for license-wrapped author evidence. The embedded
/// Release capability certifies the connected signer; no confirmation flag or
/// creator address is accepted from the author document.
public fun new_license_wrapped_rights_snapshot_v8(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
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
        protocol_config,
        catalog,
        &release_config.release_call_cap,
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

/// Consumes all five Core-owned, no-ability readiness values. Core performs the
/// mutation; this module re-reads the complete live tuple before discovery.
public fun seal_and_activate_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    protocol_treasury: &ProtocolTreasuryV8<PaymentCoin>,
    release_config: &ReleasePackageConfigV8,
    seal_readiness: SealReadinessV8,
    runtime_readiness: RuntimeActivationReadinessV8,
    output_readiness: OutputReadinessV8,
    physical_readiness: PhysicalReadinessV8,
    market_readiness: MarketReadinessV8,
    ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    activation::activate_maker_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(
        root,
        admin,
        protocol_config,
        catalog,
        base_registry,
        maker_treasury,
        protocol_treasury,
        &release_config.release_call_cap,
        seal_readiness,
        runtime_readiness,
        output_readiness,
        physical_readiness,
        market_readiness,
        ctx,
    );
    maker::assert_current_protocol_config_v8(root, protocol_config);
    binding::assert_catalog_current_v8(protocol_config, catalog);
    let capability = assert_control_readback(
        root,
        admin,
        catalog,
        release_config,
        maker::lifecycle_active_v8(),
        ctx,
    );
    assert!(maker::capability_base_registry_id_v8(capability) == object::id(base_registry),
        EReadbackMismatch);
    assert!(maker::capability_maker_treasury_id_v8(capability) == object::id(maker_treasury),
        EReadbackMismatch);
    assert!(maker::capability_protocol_treasury_id_v8(capability) == object::id(protocol_treasury),
        EReadbackMismatch);
    emit_activation(root, admin, catalog, capability);
}

public fun pause_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let (from, to) = activation::pause_maker_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(root, admin, catalog, &release_config.release_call_cap, ctx);
    emit_lifecycle_after_readback(root, admin, catalog, release_config, from, to, ctx);
}

public fun resume_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let (from, to) = activation::resume_maker_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(
        root,
        admin,
        protocol_config,
        catalog,
        &release_config.release_call_cap,
        ctx,
    );
    maker::assert_current_protocol_config_v8(root, protocol_config);
    binding::assert_catalog_current_v8(protocol_config, catalog);
    emit_lifecycle_after_readback(root, admin, catalog, release_config, from, to, ctx);
}

public fun archive_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    assert_config(catalog, release_config);
    let (from, to) = activation::archive_maker_v8<
        PaymentCoin,
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(root, admin, catalog, &release_config.release_call_cap, ctx);
    emit_lifecycle_after_readback(root, admin, catalog, release_config, from, to, ctx);
}

/// Exact Release-only wrapper for Output's generic transport boundary.
public fun finish_unprotected_complete_v8<PaymentCoin>(
    session: CompleteSessionV8,
    output_registry: &OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
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
    assert!(maker::capability_output_registry_id_v8(capability)
        == object::id(output_registry), EReadbackMismatch);
    let root_id = maker::root_id_v8(root);
    let catalog_id = binding::catalog_id_v8(catalog);
    let output_registry_id = object::id(output_registry);
    let control_epoch = maker::root_control_epoch_v8(root);
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
        ReleaseOriginalMarkerV8,
        ReleaseRenderWitnessV8,
    >(
        witness,
        session,
        output_registry,
        root,
        catalog,
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
        control_epoch: maker::root_control_epoch_v8(root),
        from,
        to,
        capability_binding_commitment:
            *maker::capability_binding_commitment_v8(capability),
    });
}

fun assert_control_readback<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
    expected_lifecycle: u8,
    ctx: &TxContext,
): &CapabilityRegistryBindingV8 {
    maker::assert_admin_v8(root, admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EReadbackMismatch);
    assert!(maker::root_lifecycle_v8(root) == expected_lifecycle, ELifecycleMismatch);
    assert_bound_root_catalog(root, catalog, release_config)
}

fun assert_bound_root_catalog<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
): &CapabilityRegistryBindingV8 {
    assert_root_product_binding(root, catalog, release_config);
    let catalog_id = binding::catalog_id_v8(catalog);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(maker::capability_catalog_id_v8(capability) == catalog_id, EReadbackMismatch);
    assert!(maker::capability_protocol_config_id_v8(capability)
        == maker::root_protocol_config_id_v8(root), EReadbackMismatch);
    assert!(maker::capability_base_registry_id_v8(capability)
        == maker::root_base_registry_id_v8(root), EReadbackMismatch);
    assert!(maker::capability_maker_treasury_id_v8(capability)
        == maker::root_maker_treasury_id_v8(root), EReadbackMismatch);
    assert!(maker::capability_protocol_treasury_id_v8(capability)
        == maker::root_protocol_treasury_id_v8(root), EReadbackMismatch);
    assert!(maker::capability_native_capability_mask_v8(capability)
        == binding::native_capability_mask_v8(), EReadbackMismatch);
    binding::assert_same_call_cap_set_v8(
        maker::capability_call_cap_set_v8(capability),
        binding::catalog_call_cap_set_v8(catalog),
    );
    capability
}

fun assert_root_product_binding<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    release_config: &ReleasePackageConfigV8,
) {
    assert_config(catalog, release_config);
    binding::assert_catalog_snapshot_v8(
        catalog,
        maker::root_protocol_config_id_v8(root),
        maker::root_protocol_config_revision_v8(root),
        maker::root_protocol_config_commitment_v8(root),
    );
    let catalog_id = binding::catalog_id_v8(catalog);
    assert!(maker::root_product_release_catalog_id_v8(root) == catalog_id,
        EReadbackMismatch);
    let root_product = maker::root_product_release_binding_v8(root);
    assert!(
        binding::product_binding_commitment_v8(root_product)
            == binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        EReadbackMismatch,
    );
    binding::assert_same_call_cap_set_v8(
        maker::root_product_release_call_cap_set_v8(root),
        binding::catalog_call_cap_set_v8(catalog),
    );
}

fun assert_config(
    catalog: &ProductReleaseCatalogV8,
    config: &ReleasePackageConfigV8,
) {
    assert!(config.version == VERSION, EConfigMismatch);
    assert!(config.catalog_id == binding::catalog_id_v8(catalog), EConfigMismatch);
    assert!(
        &config.product_binding_commitment
            == binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        EConfigMismatch,
    );
    assert!(
        &config.call_cap_set_commitment
            == binding::call_cap_set_commitment_v8(binding::catalog_call_cap_set_v8(catalog)),
        EConfigMismatch,
    );
    binding::assert_release_call_cap_v8(catalog, &config.release_call_cap);
    assert_release_type_origins(catalog);
}

fun assert_release_type_origins(catalog: &ProductReleaseCatalogV8) {
    binding::assert_type_origins_v8<ReleaseOriginalMarkerV8, ReleaseCallableMarkerV8>(
        binding::release_binding_v8(binding::catalog_binding_v8(catalog)),
    )
}

fun emit_activation<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
    capability: &CapabilityRegistryBindingV8,
) {
    event::emit(MakerV8Activated {
        root_id: maker::root_id_v8(root),
        version: maker::root_version_v8(root),
        owner: maker::root_owner_v8(root),
        control_epoch: maker::root_control_epoch_v8(root),
        admin_cap_id: maker::admin_id_v8(admin),
        maker_key: *maker::root_maker_key_v8(root),
        maker_version: maker::root_maker_version_v8(root),
        version_commitment: *maker::root_version_commitment_v8(root),
        content_commitment: *maker::root_content_commitment_v8(root),
        renderer_commitment: *maker::root_renderer_commitment_v8(root),
        protocol_config_id: maker::root_protocol_config_id_v8(root),
        protocol_config_revision: maker::root_protocol_config_revision_v8(root),
        protocol_config_commitment: *maker::root_protocol_config_commitment_v8(root),
        protocol_treasury_id: maker::root_protocol_treasury_id_v8(root),
        maker_treasury_id: maker::root_maker_treasury_id_v8(root),
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment:
            *binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        call_cap_set_commitment:
            *binding::call_cap_set_commitment_v8(binding::catalog_call_cap_set_v8(catalog)),
        native_capability_mask: maker::capability_native_capability_mask_v8(capability),
        capability_binding_commitment:
            *maker::capability_binding_commitment_v8(capability),
        base_registry_id: maker::capability_base_registry_id_v8(capability),
        seal_policy_config_id: maker::capability_seal_policy_config_id_v8(capability),
        seal_registry_id: maker::capability_seal_registry_id_v8(capability),
        runtime_definition_registry_id:
            maker::capability_runtime_definition_registry_id_v8(capability),
        pack_registry_id: maker::capability_pack_registry_id_v8(capability),
        admission_authority_id: maker::capability_admission_authority_id_v8(capability),
        output_registry_id: maker::capability_output_registry_id_v8(capability),
        soul_registry_id: maker::capability_soul_registry_id_v8(capability),
        physical_registry_id: maker::capability_physical_registry_id_v8(capability),
        market_registry_id: maker::capability_market_registry_id_v8(capability),
        market_treasury_id: maker::capability_market_treasury_id_v8(capability),
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
        release_call_cap,
    } = config;
    id.delete();
    binding::destroy_call_cap_for_testing(release_call_cap);
}

#[test_only]
public struct TestRegistry has key { id: UID }

#[test_only]
public struct TestFixture {
    config: ProtocolConfigV8,
    protocol_treasury: ProtocolTreasuryV8<SUI>,
    protocol_admin: ProtocolAdminCapV8,
    root: MakerRootV8<SUI>,
    base_registry: BaseDefinitionRegistryV8,
    maker_treasury: MakerTreasuryV8<SUI>,
    admin: MakerAdminCapV8,
    catalog: ProductReleaseCatalogV8,
    release_config: ReleasePackageConfigV8,
    seal_policy_config: SealPolicyConfigV8,
    seal_registry: TestRegistry,
    runtime_definitions: TestRegistry,
    pack_registry: TestRegistry,
    admission_authority: TestRegistry,
    output_registry: TestRegistry,
    soul_registry: TestRegistry,
    physical_registry: TestRegistry,
    market_registry: TestRegistry,
    market_treasury: TestRegistry,
}

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut value = vector[];
    let mut index = 0u64;
    while (index < 32) {
        value.push_back(byte);
        index = index + 1;
    };
    value
}

#[test_only]
fun new_test_fixture(ctx: &mut TxContext): TestFixture {
    let (config, protocol_treasury, protocol_admin) =
        protocol::new_protocol_with_treasury_for_testing<SUI>(true, ctx);
    let economics = maker::new_economics_snapshot_v8<SUI>(
        &config,
        maker::access_free_v8(),
        0,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
    );
    let rights = maker::new_onchain_native_rights_snapshot_v8(ctx, 250, 250, 500);
    let root_content_commitment = test_hash(5);
    let counts = base::new_base_definition_counts_v8(1, 1, 1, 1, 0, 0);
    let commitments = base::minimal_expected_commitments_for_testing(
        root_content_commitment,
    );
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, maker_treasury, admin) =
        core::new_initial_maker_draft_v8<SUI>(
            &config,
            b"release-fixture".to_string(),
            test_hash(6),
            b"fixture-blob".to_string(),
            test_hash(7),
            root_content_commitment,
            counts,
            commitments,
            test_hash(8),
            economics,
            rights,
            &clock,
            ctx,
        );
    base::populate_and_seal_minimal_for_testing(&mut base_registry, &root, &admin);
    let mut catalog = binding::product_release_catalog_for_release_seal_testing<
        SealOriginalMarkerV8,
        SealCallableMarkerV8,
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(
        &config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        ctx,
    );
    let release_call_cap = binding::take_release_call_cap_v8(
        &config,
        &protocol_admin,
        &mut catalog,
    );
    let seal_call_cap = binding::take_seal_call_cap_v8(
        &config,
        &protocol_admin,
        &mut catalog,
    );
    let release_config = new_release_package_config_v8(
        &catalog,
        release_call_cap,
        ctx,
    );
    finalize_product_release_binding_v8(
        &mut root,
        &admin,
        &config,
        &catalog,
        &release_config,
        ctx,
    );
    let seal_policy_config = seal::new_policy_for_testing(
        &config,
        &catalog,
        seal_call_cap,
        vector[object::id_from_address(@0x100), object::id_from_address(@0x200)],
        vector[2, 3],
        4,
        test_hash(14),
        test_hash(15),
        ctx,
    );
    clock.destroy_for_testing();
    TestFixture {
        config,
        protocol_treasury,
        protocol_admin,
        root,
        base_registry,
        maker_treasury,
        admin,
        catalog,
        release_config,
        seal_policy_config,
        seal_registry: TestRegistry { id: object::new(ctx) },
        runtime_definitions: TestRegistry { id: object::new(ctx) },
        pack_registry: TestRegistry { id: object::new(ctx) },
        admission_authority: TestRegistry { id: object::new(ctx) },
        output_registry: TestRegistry { id: object::new(ctx) },
        soul_registry: TestRegistry { id: object::new(ctx) },
        physical_registry: TestRegistry { id: object::new(ctx) },
        market_registry: TestRegistry { id: object::new(ctx) },
        market_treasury: TestRegistry { id: object::new(ctx) },
    }
}

#[test_only]
fun readiness_for_fixture(fixture: &TestFixture): (
    SealReadinessV8,
    RuntimeActivationReadinessV8,
    OutputReadinessV8,
    PhysicalReadinessV8,
    MarketReadinessV8,
) {
    activation::readiness_set_for_testing(
        &fixture.root,
        &fixture.catalog,
        &fixture.seal_policy_config,
        &fixture.seal_registry,
        &fixture.runtime_definitions,
        &fixture.pack_registry,
        &fixture.admission_authority,
        &fixture.output_registry,
        &fixture.soul_registry,
        &fixture.physical_registry,
        &fixture.market_registry,
        &fixture.market_treasury,
    )
}

#[test_only]
fun activate_fixture(fixture: &mut TestFixture, ctx: &TxContext) {
    let (seal, runtime, output, physical, market) = readiness_for_fixture(fixture);
    seal_and_activate_maker_v8(
        &mut fixture.root,
        &fixture.admin,
        &fixture.config,
        &fixture.catalog,
        &fixture.base_registry,
        &fixture.maker_treasury,
        &fixture.protocol_treasury,
        &fixture.release_config,
        seal,
        runtime,
        output,
        physical,
        market,
        ctx,
    );
}

#[test_only]
fun pause_fixture(fixture: &mut TestFixture, ctx: &TxContext) {
    let admin = &fixture.admin;
    let catalog = &fixture.catalog;
    let release_config = &fixture.release_config;
    let root = &mut fixture.root;
    pause_maker_v8(root, admin, catalog, release_config, ctx)
}

#[test_only]
fun resume_fixture(fixture: &mut TestFixture, ctx: &TxContext) {
    let admin = &fixture.admin;
    let config = &fixture.config;
    let catalog = &fixture.catalog;
    let release_config = &fixture.release_config;
    let root = &mut fixture.root;
    resume_maker_v8(root, admin, config, catalog, release_config, ctx)
}

#[test_only]
fun archive_fixture(fixture: &mut TestFixture, ctx: &TxContext) {
    let admin = &fixture.admin;
    let catalog = &fixture.catalog;
    let release_config = &fixture.release_config;
    let root = &mut fixture.root;
    archive_maker_v8(root, admin, catalog, release_config, ctx)
}

#[test_only]
fun disable_fixture_protocol(fixture: &mut TestFixture) {
    let protocol_admin = &fixture.protocol_admin;
    let config = &mut fixture.config;
    protocol::set_protocol_enabled_v8(config, protocol_admin, false)
}

#[test_only]
fun pause_fixture_with_admin(
    fixture: &mut TestFixture,
    admin: &MakerAdminCapV8,
    ctx: &TxContext,
) {
    let catalog = &fixture.catalog;
    let release_config = &fixture.release_config;
    let root = &mut fixture.root;
    pause_maker_v8(root, admin, catalog, release_config, ctx)
}

#[test_only]
fun pause_fixture_with_catalog(
    fixture: &mut TestFixture,
    catalog: &ProductReleaseCatalogV8,
    ctx: &TxContext,
) {
    let admin = &fixture.admin;
    let release_config = &fixture.release_config;
    let root = &mut fixture.root;
    pause_maker_v8(root, admin, catalog, release_config, ctx)
}

#[test_only]
fun pause_fixture_with_wrong_type_origin(
    fixture: &mut TestFixture,
    ctx: &TxContext,
) {
    let admin = &fixture.admin;
    let catalog = &fixture.catalog;
    let release_call_cap = &fixture.release_config.release_call_cap;
    let root = &mut fixture.root;
    activation::pause_maker_v8<SUI, SUI, SUI>(
        root,
        admin,
        catalog,
        release_call_cap,
        ctx,
    );
}

#[test_only]
fun pause_fixture_with_release_cap(
    fixture: &mut TestFixture,
    release_call_cap: &PackageCallCapV8<ReleaseRoleV8>,
    ctx: &TxContext,
) {
    let admin = &fixture.admin;
    let catalog = &fixture.catalog;
    let root = &mut fixture.root;
    activation::pause_maker_v8<
        SUI,
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(root, admin, catalog, release_call_cap, ctx);
}

#[test_only]
fun delete_test_registry(registry: TestRegistry) {
    let TestRegistry { id } = registry;
    id.delete();
}

#[test_only]
fun destroy_test_fixture(fixture: TestFixture) {
    let TestFixture {
        config,
        protocol_treasury,
        protocol_admin,
        root,
        base_registry,
        maker_treasury,
        admin,
        catalog,
        release_config,
        seal_policy_config,
        seal_registry,
        runtime_definitions,
        pack_registry,
        admission_authority,
        output_registry,
        soul_registry,
        physical_registry,
        market_registry,
        market_treasury,
    } = fixture;
    seal::destroy_policy_for_testing(seal_policy_config);
    delete_test_registry(seal_registry);
    delete_test_registry(runtime_definitions);
    delete_test_registry(pack_registry);
    delete_test_registry(admission_authority);
    delete_test_registry(output_registry);
    delete_test_registry(soul_registry);
    delete_test_registry(physical_registry);
    delete_test_registry(market_registry);
    delete_test_registry(market_treasury);
    base::share_base_definition_registry_for_testing(base_registry);
    core_treasury::destroy_maker_treasury_for_testing(maker_treasury);
    maker::destroy_maker_for_testing(root, admin);
    destroy_release_package_config_for_testing(release_config);
    binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_with_treasury_for_testing(
        config,
        protocol_treasury,
        protocol_admin,
    );
}

#[test]
fun activation_emits_exact_live_tuple_once() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 901, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);

    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_active_v8(), 99);
    let capability = maker::root_capability_registry_binding_v8(&fixture.root);
    let events = event::events_by_type<MakerV8Activated>();
    assert!(events.length() == 1, 99);
    assert!(event::events_by_type<MakerV8LifecycleChanged>().is_empty(), 99);
    let activated = &events[0];
    assert!(activated.root_id == maker::root_id_v8(&fixture.root), 99);
    assert!(activated.version == maker::root_version_v8(&fixture.root), 99);
    assert!(activated.owner == maker::root_owner_v8(&fixture.root), 99);
    assert!(activated.control_epoch == maker::root_control_epoch_v8(&fixture.root), 99);
    assert!(activated.admin_cap_id == maker::admin_id_v8(&fixture.admin), 99);
    assert!(&activated.maker_key == maker::root_maker_key_v8(&fixture.root), 99);
    assert!(activated.maker_version == maker::root_maker_version_v8(&fixture.root), 99);
    assert!(&activated.version_commitment
        == maker::root_version_commitment_v8(&fixture.root), 99);
    assert!(&activated.content_commitment
        == maker::root_content_commitment_v8(&fixture.root), 99);
    assert!(&activated.renderer_commitment
        == maker::root_renderer_commitment_v8(&fixture.root), 99);
    assert!(activated.protocol_config_id
        == maker::root_protocol_config_id_v8(&fixture.root), 99);
    assert!(activated.protocol_config_revision
        == maker::root_protocol_config_revision_v8(&fixture.root), 99);
    assert!(&activated.protocol_config_commitment
        == maker::root_protocol_config_commitment_v8(&fixture.root), 99);
    assert!(activated.protocol_treasury_id
        == object::id(&fixture.protocol_treasury), 99);
    assert!(activated.maker_treasury_id == object::id(&fixture.maker_treasury), 99);
    assert!(activated.catalog_id == binding::catalog_id_v8(&fixture.catalog), 99);
    assert!(&activated.product_binding_commitment
        == binding::product_binding_commitment_v8(
            binding::catalog_binding_v8(&fixture.catalog)), 99);
    assert!(&activated.call_cap_set_commitment
        == binding::call_cap_set_commitment_v8(
            binding::catalog_call_cap_set_v8(&fixture.catalog)), 99);
    assert!(activated.native_capability_mask
        == maker::capability_native_capability_mask_v8(capability), 99);
    assert!(&activated.capability_binding_commitment
        == maker::capability_binding_commitment_v8(capability), 99);
    assert!(activated.base_registry_id == object::id(&fixture.base_registry), 99);
    assert!(activated.seal_policy_config_id
        == object::id(&fixture.seal_policy_config), 99);
    assert!(activated.seal_registry_id == object::id(&fixture.seal_registry), 99);
    assert!(activated.runtime_definition_registry_id
        == object::id(&fixture.runtime_definitions), 99);
    assert!(activated.pack_registry_id == object::id(&fixture.pack_registry), 99);
    assert!(activated.admission_authority_id
        == object::id(&fixture.admission_authority), 99);
    assert!(activated.output_registry_id == object::id(&fixture.output_registry), 99);
    assert!(activated.soul_registry_id == object::id(&fixture.soul_registry), 99);
    assert!(activated.physical_registry_id == object::id(&fixture.physical_registry), 99);
    assert!(activated.market_registry_id == object::id(&fixture.market_registry), 99);
    assert!(activated.market_treasury_id == object::id(&fixture.market_treasury), 99);
    destroy_test_fixture(fixture);
}

#[test]
fun lifecycle_transitions_emit_exact_readbacks() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 902, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    pause_fixture(&mut fixture, &ctx);
    resume_fixture(&mut fixture, &ctx);
    pause_fixture(&mut fixture, &ctx);
    archive_fixture(&mut fixture, &ctx);

    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_archived_v8(), 99);
    let events = event::events_by_type<MakerV8LifecycleChanged>();
    assert!(events.length() == 4, 99);
    assert!(events[0].from == maker::lifecycle_active_v8(), 99);
    assert!(events[0].to == maker::lifecycle_paused_v8(), 99);
    assert!(events[1].from == maker::lifecycle_paused_v8(), 99);
    assert!(events[1].to == maker::lifecycle_active_v8(), 99);
    assert!(events[2].from == maker::lifecycle_active_v8(), 99);
    assert!(events[2].to == maker::lifecycle_paused_v8(), 99);
    assert!(events[3].from == maker::lifecycle_paused_v8(), 99);
    assert!(events[3].to == maker::lifecycle_archived_v8(), 99);
    let capability = maker::root_capability_registry_binding_v8(&fixture.root);
    let mut index = 0u64;
    while (index < events.length()) {
        let changed = &events[index];
        assert!(changed.root_id == maker::root_id_v8(&fixture.root), 99);
        assert!(changed.catalog_id == binding::catalog_id_v8(&fixture.catalog), 99);
        assert!(changed.maker_version == maker::root_maker_version_v8(&fixture.root), 99);
        assert!(&changed.content_commitment
            == maker::root_content_commitment_v8(&fixture.root), 99);
        assert!(changed.owner == maker::root_owner_v8(&fixture.root), 99);
        assert!(changed.control_epoch == maker::root_control_epoch_v8(&fixture.root), 99);
        assert!(&changed.capability_binding_commitment
            == maker::capability_binding_commitment_v8(capability), 99);
        index = index + 1;
    };
    destroy_test_fixture(fixture);
}

#[test]
fun disabled_protocol_still_allows_pause_and_archive() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 903, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    disable_fixture_protocol(&mut fixture);
    pause_fixture(&mut fixture, &ctx);
    archive_fixture(&mut fixture, &ctx);
    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_archived_v8(), 99);
    let events = event::events_by_type<MakerV8LifecycleChanged>();
    assert!(events.length() == 2, 99);
    destroy_test_fixture(fixture);
}

#[test]
fun active_can_archive_directly_with_exact_event() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 914, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    archive_fixture(&mut fixture, &ctx);
    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_archived_v8(), 99);
    let events = event::events_by_type<MakerV8LifecycleChanged>();
    assert!(events.length() == 1, 99);
    assert!(events[0].from == maker::lifecycle_active_v8(), 99);
    assert!(events[0].to == maker::lifecycle_archived_v8(), 99);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun active_cannot_pause_twice() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 904, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    pause_fixture(&mut fixture, &ctx);
    pause_fixture(&mut fixture, &ctx);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun active_cannot_resume() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 905, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    resume_fixture(&mut fixture, &ctx);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8_core::maker_v8)]
fun archived_is_terminal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 906, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    archive_fixture(&mut fixture, &ctx);
    pause_fixture(&mut fixture, &ctx);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::activation_v8)]
fun wrong_owner_cannot_pause() {
    let mut owner_ctx = sui::tx_context::new_from_hint(@0xA11, 907, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut owner_ctx);
    activate_fixture(&mut fixture, &owner_ctx);
    let attacker_ctx = sui::tx_context::new_from_hint(@0xB0B, 908, 0, 0, 0);
    pause_fixture(&mut fixture, &attacker_ctx);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::maker_v8)]
fun wrong_admin_cannot_pause() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 909, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let other = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    pause_fixture_with_admin(&mut fixture, &other.admin, &ctx);
    destroy_test_fixture(other);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EConfigMismatch)]
fun cross_catalog_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 910, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    let other_catalog = binding::product_release_catalog_with_release_for_testing<
        ReleaseOriginalMarkerV8,
        ReleaseCallableMarkerV8,
    >(
        &fixture.config,
        maker::root_core_original_package_id_v8(&fixture.root).to_address(),
        maker::root_core_callable_package_id_v8(&fixture.root).to_address(),
        &mut ctx,
    );
    pause_fixture_with_catalog(&mut fixture, &other_catalog, &ctx);
    binding::destroy_catalog_for_testing(other_catalog);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::package_binding_v8)]
fun wrong_release_type_origin_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 911, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    pause_fixture_with_wrong_type_origin(&mut fixture, &ctx);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 9, location = animacraft_v8_core::package_binding_v8)]
fun wrong_release_call_cap_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 915, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let other = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    pause_fixture_with_release_cap(
        &mut fixture,
        &other.release_config.release_call_cap,
        &ctx,
    );
    destroy_test_fixture(other);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::protocol_config_v8)]
fun disabled_protocol_rejects_resume() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 912, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    pause_fixture(&mut fixture, &ctx);
    disable_fixture_protocol(&mut fixture);
    resume_fixture(&mut fixture, &ctx);
    destroy_test_fixture(fixture);
}

#[test]
fun wrapped_rights_and_base_transport_use_private_release_authority() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 916, 0, 0, 0);
    let fixture = new_test_fixture(&mut ctx);
    let rights = new_license_wrapped_rights_snapshot_v8(
        &fixture.config,
        &fixture.catalog,
        &fixture.release_config,
        b"walrus://rights-evidence".to_string(),
        b"rights-blob".to_string(),
        test_hash(31),
        test_hash(32),
        250,
        250,
        500,
        &ctx,
    );
    assert!(maker::rights_origin_v8(&rights) == maker::rights_license_wrapped_v8(), 99);
    assert!(maker::rights_creator_v8(&rights) == ctx.sender(), 99);
    assert!(maker::rights_creator_confirmed_v8(&rights), 99);
    assert!(maker::rights_evidence_certified_v8(&rights), 99);
    assert!(*option::borrow(maker::rights_certification_catalog_id_v8(&rights))
        == binding::catalog_id_v8(&fixture.catalog), 99);

    let certification = certify_base_ciphertext_v8(
        &fixture.config,
        &fixture.catalog,
        &fixture.release_config,
        &fixture.seal_policy_config,
        &fixture.root,
        b"style/body".to_string(),
        test_hash(33),
        b"asset/body".to_string(),
        test_hash(34),
        b"ciphertext-blob".to_string(),
        test_hash(35),
        test_hash(36),
        &ctx,
    );
    seal::destroy_ciphertext_certification_for_testing(certification);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 10, location = animacraft_v8_core::maker_v8)]
fun product_release_binding_cannot_be_finalized_twice() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 917, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let admin = &fixture.admin;
    let config = &fixture.config;
    let catalog = &fixture.catalog;
    let release_config = &fixture.release_config;
    let root = &mut fixture.root;
    finalize_product_release_binding_v8(
        root,
        admin,
        config,
        catalog,
        release_config,
        &ctx,
    );
    destroy_test_fixture(fixture);
}

#[test]
fun release_render_witness_roundtrip_is_internal_and_exact() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 913, 0, 0, 0);
    let fixture = new_test_fixture(&mut ctx);
    let root_id = maker::root_id_v8(&fixture.root);
    let catalog_id = binding::catalog_id_v8(&fixture.catalog);
    let output_registry_id = object::id(&fixture.output_registry);
    let control_epoch = maker::root_control_epoch_v8(&fixture.root);
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
    destroy_test_fixture(fixture);
}
