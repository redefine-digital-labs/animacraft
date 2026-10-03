/// Exact Core setup, activation facts, and Output caller boundary for
/// the fresh Animacraft v8 Runtime package.
module animacraft_v8_runtime::runtime_binding_v8;

use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
    RuntimeRoleV8,
    RuntimeCallerCapV1,
    FreshTupleReplacementBindingV2,
};
use animacraft_v8_runtime::runtime_v8::{
    Self as runtime,
    ExternalItemAttestationV8,
    ExternalItemProductV8,
    MakerLoadoutV8,
    PackAdmissionAuthorityV8,
    PackCompleteLineV8,
    PackPassV8,
    PackRegistryV8,
    PackReleaseV8,
    RuntimeActivationReadinessReceiptV8,
    RuntimeDefinitionRegistryV8,
    RuntimeLoadoutAuthorizationV8,
};

const VERSION: u64 = 8;

const EConfigMismatch: u64 = 0;
const EReadinessMismatch: u64 = 1;

/// Shared Runtime configuration records consumption of Core's unique setup cap.
public struct RuntimePackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    installation_commitment: vector<u8>,
}

public fun version_v8(): u64 { VERSION }

/// Protocol setup first removes the unique Runtime cap from Core's catalog,
/// then consumes it here. Possession of the cap is the constructor authority.
public fun new_runtime_package_config_v8(
    catalog: &mut ProductReleaseCatalogV8,
    runtime_call_cap: PackageCallCapV8<RuntimeRoleV8>,
    ctx: &mut TxContext,
): RuntimePackageConfigV8 {
    let id = object::new(ctx);
    let installation_commitment = runtime::install_runtime_setup_v2(
        catalog, runtime_call_cap, object::uid_to_inner(&id));
    RuntimePackageConfigV8 {
        id,
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment:
            *binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        installation_commitment,
    }
}

public fun share_runtime_package_config_v8(config: RuntimePackageConfigV8) {
    transfer::share_object(config);
}

/// Consumes Runtime's private receipt and rechecks all three live objects,
/// returning the exact registry and admission facts for current Core activation.
public fun validate_runtime_activation_readiness_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &RuntimePackageConfigV8,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    receipt: RuntimeActivationReadinessReceiptV8,
): (ID, ID, vector<u8>) {
    assert_config(protocol_config, catalog, replacement, config);
    maker::assert_product_release_catalog_v8(root, catalog);
    let (
        root_id,
        root_version,
        root_content_commitment,
        definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
        _companion_commitment,
    ) = runtime::consume_activation_readiness_v8(receipt);
    maker::assert_root_identity_v8(root, root_id, root_version, &root_content_commitment);
    assert!(definition_registry_id == object::id(definitions), EReadinessMismatch);
    assert!(pack_registry_id == object::id(packs), EReadinessMismatch);
    assert!(admission_authority_id == object::id(authority), EReadinessMismatch);
    assert!(
        &policy_commitment == maker::root_expected_pack_admission_policy_commitment_v2(root),
        EReadinessMismatch,
    );
    // Recheck current objects: a same-PTB receipt must not outlive mutations.
    let fresh = runtime::runtime_activation_readiness_v8(definitions, packs, authority, root);
    let (_, _, _, _, _, _, _, fresh_commitment) =
        runtime::consume_activation_readiness_v8(fresh);
    assert!(_companion_commitment == fresh_commitment, EReadinessMismatch);
    (pack_registry_id, admission_authority_id, policy_commitment)
}

/// Catalog-frozen Runtime authority certifies exact external product content.
/// The returned no-ability value is required by CERTIFIED Maker admission.
public fun certify_external_item_product_v8(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &RuntimePackageConfigV8,
    product: &ExternalItemProductV8,
): ExternalItemAttestationV8 {
    assert_config(protocol_config, catalog, replacement, config);
    runtime::new_external_item_attestation_v8(binding::catalog_id_v8(catalog), product)
}

/// Output's privately installed caller cap authorizes same-PTB Pack settlement.
/// Current replacement, Root and registry checks precede all counter mutations.
public fun authorize_pack_complete_from_output_v8<PaymentCoin, OutputRegistry: key>(
    caller_cap: &RuntimeCallerCapV1,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &RuntimePackageConfigV8,
    output_registry: &OutputRegistry,
    release: &mut PackReleaseV8<PaymentCoin>,
    packs: &PackRegistryV8,
    pass: &PackPassV8,
    authorization: &RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): PackCompleteLineV8 {
    assert_config(protocol_config, catalog, replacement, config);
    maker::assert_active_live_authority_v2(root, protocol_config, catalog, replacement);
    binding::assert_runtime_caller_cap_v1(caller_cap, 0, replacement, catalog);
    binding::assert_exact_witness_type_v2<OutputRegistry>(
        binding::binding_at_v2(binding::catalog_binding_v8(catalog), 3),
        &b"output_v8", &b"OutputRegistryV8");
    let _ = output_registry;
    runtime::assert_pack_complete_root_v2(root, packs, loadout);
    runtime::authorize_pack_complete_line_v8(
        release,
        packs,
        pass,
        authorization,
        loadout,
        ctx,
    )
}

fun assert_config(
    protocol_config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
    config: &RuntimePackageConfigV8,
) {
    binding::assert_catalog_current_v8(protocol_config, catalog);
    binding::assert_replacement_current_v2(replacement, catalog);
    assert!(config.version == VERSION, EConfigMismatch);
    assert!(config.catalog_id == binding::catalog_id_v8(catalog), EConfigMismatch);
    assert!(
        &config.product_binding_commitment
            == binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        EConfigMismatch,
    );
    binding::assert_role_config_installation_v2(
        catalog, 2, object::id(config), &config.installation_commitment,
    );
}

#[test_only]
public fun destroy_runtime_package_config_for_testing(config: RuntimePackageConfigV8) {
    let RuntimePackageConfigV8 {
        id,
        version: _,
        catalog_id: _,
        product_binding_commitment: _,
        installation_commitment: _,
    } = config;
    id.delete();
}
