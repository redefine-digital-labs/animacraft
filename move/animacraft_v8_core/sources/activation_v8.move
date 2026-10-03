/// Fresh V2 activation and lifecycle orchestration. Legacy five-readiness
/// snapshots are intentionally absent: authorization is the live Catalog,
/// immutable replacement/bootstrap certificate, exact living-content
/// certificate and a private Release witness of the fixed full type name.
module animacraft_v8_core::activation_v8;

use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::companion_binding_v2 as companion;
use animacraft_v8_core::core_v8::{
    Self as core,
    CertifiedLivingContentV1,
    WalrusCertificationPolicyV1,
};
use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
use animacraft_v8_core::package_binding_v8::{
    Self as package_binding,
    FreshTupleBootstrapCertificateV2,
    FreshTupleReplacementBindingV2,
    ProductReleaseCatalogV8,
};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use sui::event;
use walrus::system::System;

const VERSION: u64 = 8;
const ENotCurrentOwner: u64 = 0;
const ECompanionMismatch: u64 = 1;

public struct MakerLifecycleChangedV2 has copy, drop {
    root_id: ID,
    previous: u8,
    current: u8,
}

public fun version_v8(): u64 { VERSION }

public fun activate_maker_v8<PaymentCoin, ReleaseActivationWitness: drop>(
    release_witness: ReleaseActivationWitness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    bootstrap_certificate: &FreshTupleBootstrapCertificateV2,
    walrus_policy: &WalrusCertificationPolicyV1,
    living_certificate: &CertifiedLivingContentV1,
    system: &System,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    pack_registry_id: ID,
    admission_authority_id: ID,
    pack_admission_policy_commitment: vector<u8>,
    ctx: &TxContext,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), ENotCurrentOwner);
    package_binding::assert_catalog_current_v8(protocol_config, catalog);
    package_binding::assert_replacement_current_v2(replacement, catalog);
    package_binding::assert_bootstrap_certificate_v2(
        bootstrap_certificate, replacement, catalog);
    maker::assert_product_release_catalog_v8(root, catalog);
    package_binding::assert_exact_witness_type_v2<ReleaseActivationWitness>(
        package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 6),
        &b"release_v8",
        &b"ReleaseActivationWitnessV2",
    );
    core::assert_walrus_policy_current_v1(
        protocol_config, catalog, walrus_policy);
    core::assert_certified_living_content_v1(
        walrus_policy, living_certificate, system, root);
    let ids = maker::root_companion_registry_ids_v2(root);
    assert!(companion::pack_registry_id_v2(ids) == pack_registry_id
        && companion::admission_authority_id_v2(ids) == admission_authority_id,
        ECompanionMismatch);
    assert!(&pack_admission_policy_commitment
        == maker::root_expected_pack_admission_policy_commitment_v2(root),
        ECompanionMismatch);
    let (_base_registry_id, _base_commitment, _base_count) =
        core::assert_activation_scaffold_ready_v8(root, base_registry);
    maker::activate_from_core_v8(
        root, admin, protocol_config, catalog, replacement);
    let _ = release_witness;
    event::emit(MakerLifecycleChangedV2 {
        root_id: maker::root_id_v8(root),
        previous: 0,
        current: 1,
    });
}

public fun pause_maker_v8<PaymentCoin, ReleaseLifecycleWitness: drop>(
    release_witness: ReleaseLifecycleWitness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    ctx: &TxContext,
) {
    transition_with_release_witness(
        release_witness, protocol_config, catalog, replacement, root, admin,
        2, ctx);
}

public fun resume_maker_v8<PaymentCoin, ReleaseLifecycleWitness: drop>(
    release_witness: ReleaseLifecycleWitness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    ctx: &TxContext,
) {
    transition_with_release_witness(
        release_witness, protocol_config, catalog, replacement, root, admin,
        1, ctx);
}

public fun archive_maker_v8<PaymentCoin, ReleaseLifecycleWitness: drop>(
    release_witness: ReleaseLifecycleWitness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    ctx: &TxContext,
) {
    transition_with_release_witness(
        release_witness, protocol_config, catalog, replacement, root, admin,
        3, ctx);
}

fun transition_with_release_witness<
    PaymentCoin,
    ReleaseLifecycleWitness: drop,
>(
    release_witness: ReleaseLifecycleWitness,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    next: u8,
    ctx: &TxContext,
) {
    package_binding::assert_exact_witness_type_v2<ReleaseLifecycleWitness>(
        package_binding::binding_at_v2(
            package_binding::catalog_binding_v8(catalog), 6),
        &b"release_v8",
        &b"ReleaseLifecycleWitnessV2",
    );
    let (previous, current) = maker::transition_lifecycle_from_core_v8(
        root, admin, protocol_config, catalog, replacement, next, ctx);
    let _ = release_witness;
    event::emit(MakerLifecycleChangedV2 {
        root_id: maker::root_id_v8(root), previous, current,
    });
}
