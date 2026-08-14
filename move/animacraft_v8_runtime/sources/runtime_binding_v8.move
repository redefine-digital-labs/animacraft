/// Exact Core call-cap, activation-readiness, and Output-request boundary for
/// the fresh Animacraft v8 Runtime package.
module animacraft_v8_runtime::runtime_binding_v8;

use animacraft_v8_core::activation_v8::{
    Self as activation,
    OutputRuntimeRequestV8,
    RuntimeActivationReadinessV8,
};
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    PackageCallCapV8,
    ProductReleaseCatalogV8,
    RuntimeRoleV8,
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
    RuntimeCallableMarkerV8,
    RuntimeDefinitionRegistryV8,
    RuntimeLoadoutAuthorizationV8,
    RuntimeOriginalMarkerV8,
};

const VERSION: u64 = 8;

const EConfigMismatch: u64 = 0;
const EReadinessMismatch: u64 = 1;

/// Shared Runtime configuration privately nests Core's unique Runtime call
/// capability. No public accessor can expose or move the capability back out.
public struct RuntimePackageConfigV8 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    runtime_call_cap: PackageCallCapV8<RuntimeRoleV8>,
}

public fun version_v8(): u64 { VERSION }

/// Protocol setup first removes the unique Runtime cap from Core's catalog,
/// then moves it here. Possession of the cap is the constructor authority.
public fun new_runtime_package_config_v8(
    catalog: &ProductReleaseCatalogV8,
    runtime_call_cap: PackageCallCapV8<RuntimeRoleV8>,
    ctx: &mut TxContext,
): RuntimePackageConfigV8 {
    binding::assert_runtime_call_cap_v8(catalog, &runtime_call_cap);
    binding::assert_type_origins_v8<RuntimeOriginalMarkerV8, RuntimeCallableMarkerV8>(
        binding::runtime_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    RuntimePackageConfigV8 {
        id: object::new(ctx),
        version: VERSION,
        catalog_id: binding::catalog_id_v8(catalog),
        product_binding_commitment:
            *binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        runtime_call_cap,
    }
}

public fun share_runtime_package_config_v8(config: RuntimePackageConfigV8) {
    transfer::share_object(config);
}

/// Consumes Runtime's private DRAFT/zero-registry receipt, rebinds it to all
/// three live key objects, and obtains Core's sole production Runtime
/// activation readiness. The companion commitment is Runtime-derived.
public fun certify_runtime_activation_readiness_v8<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &RuntimePackageConfigV8,
    definitions: &RuntimeDefinitionRegistryV8,
    packs: &PackRegistryV8,
    authority: &PackAdmissionAuthorityV8,
    receipt: RuntimeActivationReadinessReceiptV8,
): RuntimeActivationReadinessV8 {
    assert_config(catalog, config);
    let (
        root_id,
        root_version,
        root_content_commitment,
        definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
        companion_commitment,
    ) = runtime::consume_activation_readiness_v8(receipt);
    maker::assert_root_identity_v8(root, root_id, root_version, &root_content_commitment);
    assert!(definition_registry_id == object::id(definitions), EReadinessMismatch);
    assert!(pack_registry_id == object::id(packs), EReadinessMismatch);
    assert!(admission_authority_id == object::id(authority), EReadinessMismatch);
    assert!(
        &policy_commitment == maker::root_expected_pack_admission_policy_commitment_v8(root),
        EReadinessMismatch,
    );
    activation::certify_runtime_activation_readiness_v8<
        PaymentCoin,
        RuntimeOriginalMarkerV8,
        RuntimeCallableMarkerV8,
        RuntimeDefinitionRegistryV8,
        PackRegistryV8,
        PackAdmissionAuthorityV8,
    >(
        root,
        catalog,
        &config.runtime_call_cap,
        definitions,
        packs,
        authority,
        companion_commitment,
    )
}

/// Catalog-frozen Runtime authority certifies exact external product content.
/// The returned no-ability value is required by CERTIFIED Maker admission.
public fun certify_external_item_product_v8(
    catalog: &ProductReleaseCatalogV8,
    config: &RuntimePackageConfigV8,
    product: &ExternalItemProductV8,
): ExternalItemAttestationV8 {
    assert_config(catalog, config);
    runtime::new_external_item_attestation_v8(binding::catalog_id_v8(catalog), product)
}

/// Exact Output must create the no-ability Core request in this transaction.
/// Runtime consumes it before the first Pack Complete counter mutation.
public fun authorize_pack_complete_from_output_v8<PaymentCoin, OutputRegistry: key>(
    request: OutputRuntimeRequestV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &RuntimePackageConfigV8,
    output_registry: &OutputRegistry,
    release: &mut PackReleaseV8<PaymentCoin>,
    packs: &PackRegistryV8,
    pass: &PackPassV8,
    authorization: &RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): PackCompleteLineV8 {
    assert_config(catalog, config);
    let _request_id = activation::consume_output_runtime_request_v8<
        PaymentCoin,
        RuntimeOriginalMarkerV8,
        RuntimeCallableMarkerV8,
        OutputRegistry,
    >(
        request,
        root,
        catalog,
        &config.runtime_call_cap,
        output_registry,
        ctx,
    );
    runtime::authorize_pack_complete_line_v8(
        release,
        packs,
        pass,
        authorization,
        loadout,
        ctx,
    )
}

fun assert_config(catalog: &ProductReleaseCatalogV8, config: &RuntimePackageConfigV8) {
    assert!(config.version == VERSION, EConfigMismatch);
    assert!(config.catalog_id == binding::catalog_id_v8(catalog), EConfigMismatch);
    assert!(
        &config.product_binding_commitment
            == binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        EConfigMismatch,
    );
    binding::assert_runtime_call_cap_v8(catalog, &config.runtime_call_cap);
}

#[test_only]
public fun destroy_runtime_package_config_for_testing(config: RuntimePackageConfigV8) {
    let RuntimePackageConfigV8 {
        id,
        version: _,
        catalog_id: _,
        product_binding_commitment: _,
        runtime_call_cap,
    } = config;
    id.delete();
    binding::destroy_call_cap_for_testing(runtime_call_cap);
}
