/// Core-owned terminal activation and one-shot Output -> Runtime authorization.
/// This module depends only on Core modules; no companion package is imported.
module animacraft_v8_core::activation_v8;

use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8};
use animacraft_v8_core::maker_v8::{
    Self as maker,
    MakerAdminCapV8,
    MakerRootV8,
};
use animacraft_v8_core::package_binding_v8::{
    Self as binding,
    ExactPackageBindingV8,
    MarketRoleV8,
    OutputRoleV8,
    PackageCallCapV8,
    PhysicalRoleV8,
    ProductReleaseCatalogV8,
    ReleaseRoleV8,
    RuntimeRoleV8,
    SealRoleV8,
};
use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolConfigV8,
    ProtocolTreasuryV8,
};
use animacraft_v8_core::treasury_v8::{Self as treasury, MakerTreasuryV8};
use std::bcs;
use std::hash;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;

const ROLE_SEAL: u8 = 0;
const ROLE_RUNTIME: u8 = 1;
const ROLE_OUTPUT: u8 = 2;
const ROLE_PHYSICAL: u8 = 3;
const ROLE_MARKET: u8 = 4;

const EInvalidCommitment: u64 = 0;
const EReadinessMismatch: u64 = 1;
const ERegistryCollision: u64 = 2;
const EOutputRequestMismatch: u64 = 3;

/// All five readiness values deliberately have no abilities. Their fields are
/// private and each value must be consumed by exactly one activation attempt.
public struct SealReadinessV8 {
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    registry_id: ID,
    companion_commitment: vector<u8>,
    commitment: vector<u8>,
}

public struct RuntimeActivationReadinessV8 {
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    runtime_definition_registry_id: ID,
    pack_registry_id: ID,
    admission_authority_id: ID,
    expected_pack_policy_commitment: vector<u8>,
    companion_commitment: vector<u8>,
    commitment: vector<u8>,
}

public struct OutputReadinessV8 {
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    registry_id: ID,
    companion_commitment: vector<u8>,
    commitment: vector<u8>,
}

public struct PhysicalReadinessV8 {
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    registry_id: ID,
    companion_commitment: vector<u8>,
    commitment: vector<u8>,
}

public struct MarketReadinessV8 {
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    registry_id: ID,
    companion_commitment: vector<u8>,
    commitment: vector<u8>,
}

/// Output creates this no-ability token and Runtime must consume it before a
/// counter mutation. The request is exact to one Root, catalog, live Output
/// registry, signer, and transaction-derived request ID.
public struct OutputRuntimeRequestV8 {
    request_id: ID,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    output_registry_id: ID,
    requester: address,
    commitment: vector<u8>,
}

public struct RoleReadinessCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    role: u8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    role_binding_commitment: vector<u8>,
    companion_ids: vector<ID>,
    expected_pack_policy_commitment: vector<u8>,
    companion_commitment: vector<u8>,
}

public struct OutputRuntimeRequestCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    request_id: ID,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    output_registry_id: ID,
    requester: address,
}

public fun version_v8(): u64 { VERSION }

public fun certify_seal_readiness_v8<
    PaymentCoin,
    SealOriginalMarker,
    SealCallableMarker,
    SealRegistry: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<SealRoleV8>,
    registry: &SealRegistry,
    companion_commitment: vector<u8>,
): SealReadinessV8 {
    binding::assert_seal_call_cap_v8(catalog, cap);
    let role_binding = binding::seal_binding_v8(binding::catalog_binding_v8(catalog));
    binding::assert_type_origins_v8<SealOriginalMarker, SealCallableMarker>(role_binding);
    let (root_id, catalog_id, call_cap_set_commitment) = assert_draft_root_catalog(root, catalog);
    let registry_id = object::id(registry);
    let commitment = readiness_commitment(
        ROLE_SEAL,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        role_binding,
        vector[registry_id],
        vector[],
        companion_commitment,
    );
    SealReadinessV8 {
        root_id,
        catalog_id,
        call_cap_set_commitment,
        registry_id,
        companion_commitment,
        commitment,
    }
}

public fun certify_runtime_activation_readiness_v8<
    PaymentCoin,
    RuntimeOriginalMarker,
    RuntimeCallableMarker,
    RuntimeDefinitionRegistry: key,
    PackRegistry: key,
    AdmissionAuthority: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<RuntimeRoleV8>,
    runtime_definition_registry: &RuntimeDefinitionRegistry,
    pack_registry: &PackRegistry,
    admission_authority: &AdmissionAuthority,
    companion_commitment: vector<u8>,
): RuntimeActivationReadinessV8 {
    binding::assert_runtime_call_cap_v8(catalog, cap);
    let role_binding = binding::runtime_binding_v8(binding::catalog_binding_v8(catalog));
    binding::assert_type_origins_v8<RuntimeOriginalMarker, RuntimeCallableMarker>(role_binding);
    let (root_id, catalog_id, call_cap_set_commitment) = assert_draft_root_catalog(root, catalog);
    let runtime_definition_registry_id = object::id(runtime_definition_registry);
    let pack_registry_id = object::id(pack_registry);
    let admission_authority_id = object::id(admission_authority);
    let companion_ids = vector[
        runtime_definition_registry_id,
        pack_registry_id,
        admission_authority_id,
    ];
    assert_distinct_nonzero_ids(&companion_ids);
    let expected_pack_policy_commitment =
        *maker::root_expected_pack_admission_policy_commitment_v8(root);
    let commitment = readiness_commitment(
        ROLE_RUNTIME,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        role_binding,
        companion_ids,
        expected_pack_policy_commitment,
        companion_commitment,
    );
    RuntimeActivationReadinessV8 {
        root_id,
        catalog_id,
        call_cap_set_commitment,
        runtime_definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        expected_pack_policy_commitment,
        companion_commitment,
        commitment,
    }
}

public fun certify_output_readiness_v8<
    PaymentCoin,
    OutputOriginalMarker,
    OutputCallableMarker,
    OutputRegistry: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<OutputRoleV8>,
    registry: &OutputRegistry,
    companion_commitment: vector<u8>,
): OutputReadinessV8 {
    binding::assert_output_call_cap_v8(catalog, cap);
    let role_binding = binding::output_binding_v8(binding::catalog_binding_v8(catalog));
    binding::assert_type_origins_v8<OutputOriginalMarker, OutputCallableMarker>(role_binding);
    let (root_id, catalog_id, call_cap_set_commitment) = assert_draft_root_catalog(root, catalog);
    let registry_id = object::id(registry);
    let commitment = readiness_commitment(
        ROLE_OUTPUT,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        role_binding,
        vector[registry_id],
        vector[],
        companion_commitment,
    );
    OutputReadinessV8 {
        root_id,
        catalog_id,
        call_cap_set_commitment,
        registry_id,
        companion_commitment,
        commitment,
    }
}

public fun certify_physical_readiness_v8<
    PaymentCoin,
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
    PhysicalRegistry: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<PhysicalRoleV8>,
    registry: &PhysicalRegistry,
    companion_commitment: vector<u8>,
): PhysicalReadinessV8 {
    binding::assert_physical_call_cap_v8(catalog, cap);
    let role_binding = binding::physical_binding_v8(binding::catalog_binding_v8(catalog));
    binding::assert_type_origins_v8<PhysicalOriginalMarker, PhysicalCallableMarker>(role_binding);
    let (root_id, catalog_id, call_cap_set_commitment) = assert_draft_root_catalog(root, catalog);
    let registry_id = object::id(registry);
    let commitment = readiness_commitment(
        ROLE_PHYSICAL,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        role_binding,
        vector[registry_id],
        vector[],
        companion_commitment,
    );
    PhysicalReadinessV8 {
        root_id,
        catalog_id,
        call_cap_set_commitment,
        registry_id,
        companion_commitment,
        commitment,
    }
}

public fun certify_market_readiness_v8<
    PaymentCoin,
    MarketOriginalMarker,
    MarketCallableMarker,
    MarketRegistry: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<MarketRoleV8>,
    registry: &MarketRegistry,
    companion_commitment: vector<u8>,
): MarketReadinessV8 {
    binding::assert_market_call_cap_v8(catalog, cap);
    let role_binding = binding::market_binding_v8(binding::catalog_binding_v8(catalog));
    binding::assert_type_origins_v8<MarketOriginalMarker, MarketCallableMarker>(role_binding);
    let (root_id, catalog_id, call_cap_set_commitment) = assert_draft_root_catalog(root, catalog);
    let registry_id = object::id(registry);
    let commitment = readiness_commitment(
        ROLE_MARKET,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        role_binding,
        vector[registry_id],
        vector[],
        companion_commitment,
    );
    MarketReadinessV8 {
        root_id,
        catalog_id,
        call_cap_set_commitment,
        registry_id,
        companion_commitment,
        commitment,
    }
}

/// Terminal Release entry. No registry ID is accepted: all companion IDs are
/// extracted from cap-gated, no-ability readiness values created from live
/// key references. Core deliberately emits no discovery event.
public fun activate_maker_v8<PaymentCoin, ReleaseOriginalMarker, ReleaseCallableMarker>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    protocol_treasury: &ProtocolTreasuryV8<PaymentCoin>,
    release_cap: &PackageCallCapV8<ReleaseRoleV8>,
    seal_readiness: SealReadinessV8,
    runtime_readiness: RuntimeActivationReadinessV8,
    output_readiness: OutputReadinessV8,
    physical_readiness: PhysicalReadinessV8,
    market_readiness: MarketReadinessV8,
    ctx: &TxContext,
) {
    binding::assert_release_call_cap_v8(catalog, release_cap);
    binding::assert_type_origins_v8<ReleaseOriginalMarker, ReleaseCallableMarker>(
        binding::release_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    activate_with_verified_release(
        root,
        admin,
        config,
        catalog,
        base_registry,
        maker_treasury,
        protocol_treasury,
        seal_readiness,
        runtime_readiness,
        output_readiness,
        physical_readiness,
        market_readiness,
        ctx,
    );
}

fun activate_with_verified_release<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    protocol_treasury: &ProtocolTreasuryV8<PaymentCoin>,
    seal_readiness: SealReadinessV8,
    runtime_readiness: RuntimeActivationReadinessV8,
    output_readiness: OutputReadinessV8,
    physical_readiness: PhysicalReadinessV8,
    market_readiness: MarketReadinessV8,
    ctx: &TxContext,
) {
    maker::assert_draft_admin_v8(root, admin);
    assert!(maker::root_owner_v8(root) == ctx.sender(), EReadinessMismatch);
    maker::assert_current_protocol_config_v8(root, config);
    protocol::assert_exact_protocol_treasury_v8(config, protocol_treasury);
    treasury::assert_maker_treasury_v8(root, maker_treasury);
    binding::assert_catalog_current_v8(config, catalog);
    let (root_id, catalog_id, call_cap_set_commitment) = assert_draft_root_catalog(root, catalog);
    let (base_registry_id, _, _) = base::assert_activation_ready_v8(base_registry, root);

    let (seal_registry_id, seal_readiness_commitment) = consume_seal_readiness(
        seal_readiness,
        root_id,
        catalog_id,
        &call_cap_set_commitment,
        binding::seal_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    let (
        runtime_definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        expected_pack_policy_commitment,
        runtime_readiness_commitment,
    ) = consume_runtime_readiness(
        runtime_readiness,
        root_id,
        catalog_id,
        &call_cap_set_commitment,
        binding::runtime_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    assert!(
        &expected_pack_policy_commitment
            == maker::root_expected_pack_admission_policy_commitment_v8(root),
        EReadinessMismatch,
    );
    let (output_registry_id, output_readiness_commitment) = consume_output_readiness(
        output_readiness,
        root_id,
        catalog_id,
        &call_cap_set_commitment,
        binding::output_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    let (physical_registry_id, physical_readiness_commitment) = consume_physical_readiness(
        physical_readiness,
        root_id,
        catalog_id,
        &call_cap_set_commitment,
        binding::physical_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    let (market_registry_id, market_readiness_commitment) = consume_market_readiness(
        market_readiness,
        root_id,
        catalog_id,
        &call_cap_set_commitment,
        binding::market_binding_v8(binding::catalog_binding_v8(catalog)),
    );

    maker::finalize_pack_admission_binding_from_core_v8(
        root,
        admin,
        pack_registry_id,
        admission_authority_id,
        expected_pack_policy_commitment,
    );
    maker::finalize_capability_registry_binding_v8(
        root,
        admin,
        binding::native_capability_mask_v8(),
        catalog_id,
        *binding::catalog_call_cap_set_v8(catalog),
        object::id(config),
        base_registry_id,
        object::id(maker_treasury),
        object::id(protocol_treasury),
        seal_registry_id,
        runtime_definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        output_registry_id,
        physical_registry_id,
        market_registry_id,
        seal_readiness_commitment,
        runtime_readiness_commitment,
        output_readiness_commitment,
        physical_readiness_commitment,
        market_readiness_commitment,
    );
    maker::activate_from_core_v8(root, admin);
}

public fun new_output_runtime_request_v8<
    PaymentCoin,
    OutputOriginalMarker,
    OutputCallableMarker,
    OutputRegistry: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    output_cap: &PackageCallCapV8<OutputRoleV8>,
    output_registry: &OutputRegistry,
    ctx: &mut TxContext,
): OutputRuntimeRequestV8 {
    binding::assert_output_call_cap_v8(catalog, output_cap);
    binding::assert_type_origins_v8<OutputOriginalMarker, OutputCallableMarker>(
        binding::output_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    new_verified_output_request(root, catalog, output_registry, ctx)
}

fun new_verified_output_request<PaymentCoin, OutputRegistry: key>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    output_registry: &OutputRegistry,
    ctx: &mut TxContext,
): OutputRuntimeRequestV8 {
    let (root_id, catalog_id, call_cap_set_commitment) =
        assert_active_root_catalog(root, catalog);
    let output_registry_id = object::id(output_registry);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(
        maker::capability_output_registry_id_v8(capability) == output_registry_id,
        EOutputRequestMismatch,
    );
    let request_id = fresh_id(ctx);
    let requester = ctx.sender();
    let commitment = output_request_commitment(
        request_id,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        output_registry_id,
        requester,
    );
    OutputRuntimeRequestV8 {
        request_id,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        output_registry_id,
        requester,
        commitment,
    }
}

public fun consume_output_runtime_request_v8<
    PaymentCoin,
    RuntimeOriginalMarker,
    RuntimeCallableMarker,
    OutputRegistry: key,
>(
    request: OutputRuntimeRequestV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    runtime_cap: &PackageCallCapV8<RuntimeRoleV8>,
    output_registry: &OutputRegistry,
    ctx: &TxContext,
): ID {
    binding::assert_runtime_call_cap_v8(catalog, runtime_cap);
    binding::assert_type_origins_v8<RuntimeOriginalMarker, RuntimeCallableMarker>(
        binding::runtime_binding_v8(binding::catalog_binding_v8(catalog)),
    );
    consume_verified_output_request(request, root, catalog, output_registry, ctx)
}

fun consume_verified_output_request<PaymentCoin, OutputRegistry: key>(
    request: OutputRuntimeRequestV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    output_registry: &OutputRegistry,
    ctx: &TxContext,
): ID {
    let (root_id, catalog_id, call_cap_set_commitment) =
        assert_active_root_catalog(root, catalog);
    let OutputRuntimeRequestV8 {
        request_id,
        root_id: request_root_id,
        catalog_id: request_catalog_id,
        call_cap_set_commitment: request_call_cap_set_commitment,
        output_registry_id,
        requester,
        commitment,
    } = request;
    assert!(request_root_id == root_id, EOutputRequestMismatch);
    assert!(request_catalog_id == catalog_id, EOutputRequestMismatch);
    assert!(
        &request_call_cap_set_commitment == &call_cap_set_commitment,
        EOutputRequestMismatch,
    );
    assert!(output_registry_id == object::id(output_registry), EOutputRequestMismatch);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(
        maker::capability_output_registry_id_v8(capability) == output_registry_id,
        EOutputRequestMismatch,
    );
    assert!(requester == ctx.sender(), EOutputRequestMismatch);
    let expected = output_request_commitment(
        request_id,
        request_root_id,
        request_catalog_id,
        request_call_cap_set_commitment,
        output_registry_id,
        requester,
    );
    assert!(&expected == &commitment, EOutputRequestMismatch);
    request_id
}

fun assert_draft_root_catalog<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
): (ID, ID, vector<u8>) {
    maker::assert_draft_v8(root);
    assert_root_catalog(root, catalog)
}

fun assert_active_root_catalog<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
): (ID, ID, vector<u8>) {
    maker::assert_active_capability_registry_v8(root);
    let (root_id, catalog_id, call_cap_set_commitment) =
        assert_root_catalog(root, catalog);
    let capability = maker::root_capability_registry_binding_v8(root);
    assert!(maker::capability_catalog_id_v8(capability) == catalog_id, EReadinessMismatch);
    binding::assert_same_call_cap_set_v8(
        maker::capability_call_cap_set_v8(capability),
        binding::catalog_call_cap_set_v8(catalog),
    );
    (root_id, catalog_id, call_cap_set_commitment)
}

fun assert_root_catalog<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
): (ID, ID, vector<u8>) {
    binding::assert_catalog_snapshot_v8(
        catalog,
        maker::root_protocol_config_id_v8(root),
        maker::root_protocol_config_revision_v8(root),
        maker::root_protocol_config_commitment_v8(root),
    );
    let catalog_id = object::id(catalog);
    assert!(
        maker::root_product_release_catalog_id_v8(root) == catalog_id,
        EReadinessMismatch,
    );
    let root_product = maker::root_product_release_binding_v8(root);
    assert!(
        binding::product_binding_commitment_v8(root_product)
            == binding::product_binding_commitment_v8(binding::catalog_binding_v8(catalog)),
        EReadinessMismatch,
    );
    binding::assert_same_call_cap_set_v8(
        maker::root_product_release_call_cap_set_v8(root),
        binding::catalog_call_cap_set_v8(catalog),
    );
    (
        object::id(root),
        catalog_id,
        *binding::call_cap_set_commitment_v8(binding::catalog_call_cap_set_v8(catalog)),
    )
}

fun readiness_commitment(
    role: u8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    role_binding: &ExactPackageBindingV8,
    companion_ids: vector<ID>,
    expected_pack_policy_commitment: vector<u8>,
    companion_commitment: vector<u8>,
): vector<u8> {
    assert_hash(&call_cap_set_commitment);
    assert_hash(&companion_commitment);
    if (role == ROLE_RUNTIME) {
        assert_hash(&expected_pack_policy_commitment);
    } else {
        assert!(expected_pack_policy_commitment.is_empty(), EInvalidCommitment);
    };
    assert_distinct_nonzero_ids(&companion_ids);
    hash::sha2_256(bcs::to_bytes(&RoleReadinessCommitmentInputV8 {
        domain: b"animacraft-v8/role-readiness",
        version: VERSION,
        role,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        role_binding_commitment: *binding::exact_binding_commitment_v8(role_binding),
        companion_ids,
        expected_pack_policy_commitment,
        companion_commitment,
    }))
}

fun assert_common_readiness(
    role: u8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    registry_ids: vector<ID>,
    expected_pack_policy_commitment: vector<u8>,
    companion_commitment: vector<u8>,
    commitment: vector<u8>,
    expected_root_id: ID,
    expected_catalog_id: ID,
    expected_call_cap_set_commitment: &vector<u8>,
    role_binding: &ExactPackageBindingV8,
) {
    assert!(root_id == expected_root_id, EReadinessMismatch);
    assert!(catalog_id == expected_catalog_id, EReadinessMismatch);
    assert!(
        &call_cap_set_commitment == expected_call_cap_set_commitment,
        EReadinessMismatch,
    );
    let expected = readiness_commitment(
        role,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        role_binding,
        registry_ids,
        expected_pack_policy_commitment,
        companion_commitment,
    );
    assert!(&expected == &commitment, EReadinessMismatch);
}

fun consume_seal_readiness(
    readiness: SealReadinessV8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: &vector<u8>,
    role_binding: &ExactPackageBindingV8,
): (ID, vector<u8>) {
    let SealReadinessV8 {
        root_id: value_root_id,
        catalog_id: value_catalog_id,
        call_cap_set_commitment: value_call_cap_set_commitment,
        registry_id,
        companion_commitment,
        commitment,
    } = readiness;
    assert_common_readiness(ROLE_SEAL, value_root_id, value_catalog_id,
        value_call_cap_set_commitment, vector[registry_id], vector[],
        companion_commitment, commitment, root_id, catalog_id,
        call_cap_set_commitment, role_binding);
    (registry_id, commitment)
}

fun consume_runtime_readiness(
    readiness: RuntimeActivationReadinessV8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: &vector<u8>,
    role_binding: &ExactPackageBindingV8,
): (ID, ID, ID, vector<u8>, vector<u8>) {
    let RuntimeActivationReadinessV8 {
        root_id: value_root_id,
        catalog_id: value_catalog_id,
        call_cap_set_commitment: value_call_cap_set_commitment,
        runtime_definition_registry_id,
        pack_registry_id,
        admission_authority_id,
        expected_pack_policy_commitment,
        companion_commitment,
        commitment,
    } = readiness;
    assert_common_readiness(ROLE_RUNTIME, value_root_id, value_catalog_id,
        value_call_cap_set_commitment, vector[runtime_definition_registry_id,
        pack_registry_id, admission_authority_id], expected_pack_policy_commitment,
        companion_commitment, commitment, root_id, catalog_id,
        call_cap_set_commitment, role_binding);
    (runtime_definition_registry_id, pack_registry_id, admission_authority_id,
        expected_pack_policy_commitment, commitment)
}

fun consume_output_readiness(
    readiness: OutputReadinessV8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: &vector<u8>,
    role_binding: &ExactPackageBindingV8,
): (ID, vector<u8>) {
    let OutputReadinessV8 { root_id: value_root_id, catalog_id: value_catalog_id,
        call_cap_set_commitment: value_call_cap_set_commitment, registry_id,
        companion_commitment, commitment } = readiness;
    assert_common_readiness(ROLE_OUTPUT, value_root_id, value_catalog_id,
        value_call_cap_set_commitment, vector[registry_id], vector[],
        companion_commitment, commitment, root_id, catalog_id,
        call_cap_set_commitment, role_binding);
    (registry_id, commitment)
}

fun consume_physical_readiness(
    readiness: PhysicalReadinessV8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: &vector<u8>,
    role_binding: &ExactPackageBindingV8,
): (ID, vector<u8>) {
    let PhysicalReadinessV8 { root_id: value_root_id, catalog_id: value_catalog_id,
        call_cap_set_commitment: value_call_cap_set_commitment, registry_id,
        companion_commitment, commitment } = readiness;
    assert_common_readiness(ROLE_PHYSICAL, value_root_id, value_catalog_id,
        value_call_cap_set_commitment, vector[registry_id], vector[],
        companion_commitment, commitment, root_id, catalog_id,
        call_cap_set_commitment, role_binding);
    (registry_id, commitment)
}

fun consume_market_readiness(
    readiness: MarketReadinessV8,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: &vector<u8>,
    role_binding: &ExactPackageBindingV8,
): (ID, vector<u8>) {
    let MarketReadinessV8 { root_id: value_root_id, catalog_id: value_catalog_id,
        call_cap_set_commitment: value_call_cap_set_commitment, registry_id,
        companion_commitment, commitment } = readiness;
    assert_common_readiness(ROLE_MARKET, value_root_id, value_catalog_id,
        value_call_cap_set_commitment, vector[registry_id], vector[],
        companion_commitment, commitment, root_id, catalog_id,
        call_cap_set_commitment, role_binding);
    (registry_id, commitment)
}

fun output_request_commitment(
    request_id: ID,
    root_id: ID,
    catalog_id: ID,
    call_cap_set_commitment: vector<u8>,
    output_registry_id: ID,
    requester: address,
): vector<u8> {
    assert_hash(&call_cap_set_commitment);
    hash::sha2_256(bcs::to_bytes(&OutputRuntimeRequestCommitmentInputV8 {
        domain: b"animacraft-v8/output-runtime-request",
        version: VERSION,
        request_id,
        root_id,
        catalog_id,
        call_cap_set_commitment,
        output_registry_id,
        requester,
    }))
}

fun assert_distinct_nonzero_ids(ids: &vector<ID>) {
    let zero = object::id_from_address(@0x0);
    let mut left = 0;
    while (left < ids.length()) {
        assert!(ids[left] != zero, ERegistryCollision);
        let mut right = left + 1;
        while (right < ids.length()) {
            assert!(ids[left] != ids[right], ERegistryCollision);
            right = right + 1;
        };
        left = left + 1;
    };
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

fun fresh_id(ctx: &mut TxContext): ID {
    let nonce = object::new(ctx);
    let id = nonce.to_inner();
    nonce.delete();
    id
}

#[test_only]
public fun readiness_set_for_testing<
    PaymentCoin,
    SealRegistry: key,
    RuntimeDefinitionRegistry: key,
    PackRegistry: key,
    AdmissionAuthority: key,
    OutputRegistry: key,
    PhysicalRegistry: key,
    MarketRegistry: key,
>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    seal_registry: &SealRegistry,
    runtime_definition_registry: &RuntimeDefinitionRegistry,
    pack_registry: &PackRegistry,
    admission_authority: &AdmissionAuthority,
    output_registry: &OutputRegistry,
    physical_registry: &PhysicalRegistry,
    market_registry: &MarketRegistry,
): (
    SealReadinessV8,
    RuntimeActivationReadinessV8,
    OutputReadinessV8,
    PhysicalReadinessV8,
    MarketReadinessV8,
) {
    let (root_id, catalog_id, call_cap_set_commitment) =
        assert_draft_root_catalog(root, catalog);
    let seal_registry_id = object::id(seal_registry);
    let runtime_definition_registry_id = object::id(runtime_definition_registry);
    let pack_registry_id = object::id(pack_registry);
    let admission_authority_id = object::id(admission_authority);
    let output_registry_id = object::id(output_registry);
    let physical_registry_id = object::id(physical_registry);
    let market_registry_id = object::id(market_registry);
    let expected_pack_policy_commitment =
        *maker::root_expected_pack_admission_policy_commitment_v8(root);
    let seal_companion = test_hash(21);
    let runtime_companion = test_hash(22);
    let output_companion = test_hash(23);
    let physical_companion = test_hash(24);
    let market_companion = test_hash(25);
    let seal_commitment = readiness_commitment(ROLE_SEAL, root_id, catalog_id,
        call_cap_set_commitment, binding::seal_binding_v8(binding::catalog_binding_v8(catalog)),
        vector[seal_registry_id], vector[], seal_companion);
    let runtime_commitment = readiness_commitment(ROLE_RUNTIME, root_id, catalog_id,
        call_cap_set_commitment, binding::runtime_binding_v8(binding::catalog_binding_v8(catalog)),
        vector[runtime_definition_registry_id, pack_registry_id, admission_authority_id],
        expected_pack_policy_commitment, runtime_companion);
    let output_commitment = readiness_commitment(ROLE_OUTPUT, root_id, catalog_id,
        call_cap_set_commitment, binding::output_binding_v8(binding::catalog_binding_v8(catalog)),
        vector[output_registry_id], vector[], output_companion);
    let physical_commitment = readiness_commitment(ROLE_PHYSICAL, root_id, catalog_id,
        call_cap_set_commitment, binding::physical_binding_v8(binding::catalog_binding_v8(catalog)),
        vector[physical_registry_id], vector[], physical_companion);
    let market_commitment = readiness_commitment(ROLE_MARKET, root_id, catalog_id,
        call_cap_set_commitment, binding::market_binding_v8(binding::catalog_binding_v8(catalog)),
        vector[market_registry_id], vector[], market_companion);
    (
        SealReadinessV8 { root_id, catalog_id, call_cap_set_commitment,
            registry_id: seal_registry_id, companion_commitment: seal_companion,
            commitment: seal_commitment },
        RuntimeActivationReadinessV8 { root_id, catalog_id, call_cap_set_commitment,
            runtime_definition_registry_id, pack_registry_id, admission_authority_id,
            expected_pack_policy_commitment, companion_commitment: runtime_companion,
            commitment: runtime_commitment },
        OutputReadinessV8 { root_id, catalog_id, call_cap_set_commitment,
            registry_id: output_registry_id, companion_commitment: output_companion,
            commitment: output_commitment },
        PhysicalReadinessV8 { root_id, catalog_id, call_cap_set_commitment,
            registry_id: physical_registry_id, companion_commitment: physical_companion,
            commitment: physical_commitment },
        MarketReadinessV8 { root_id, catalog_id, call_cap_set_commitment,
            registry_id: market_registry_id, companion_commitment: market_companion,
            commitment: market_commitment },
    )
}

#[test_only]
public fun activate_maker_for_testing<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    base_registry: &BaseDefinitionRegistryV8,
    maker_treasury: &MakerTreasuryV8<PaymentCoin>,
    protocol_treasury: &ProtocolTreasuryV8<PaymentCoin>,
    release_cap: &PackageCallCapV8<ReleaseRoleV8>,
    seal_readiness: SealReadinessV8,
    runtime_readiness: RuntimeActivationReadinessV8,
    output_readiness: OutputReadinessV8,
    physical_readiness: PhysicalReadinessV8,
    market_readiness: MarketReadinessV8,
    ctx: &TxContext,
) {
    binding::assert_release_call_cap_v8(catalog, release_cap);
    activate_with_verified_release(root, admin, config, catalog, base_registry,
        maker_treasury, protocol_treasury, seal_readiness, runtime_readiness,
        output_readiness, physical_readiness, market_readiness, ctx);
}

#[test_only]
public fun new_output_runtime_request_for_testing<PaymentCoin, OutputRegistry: key>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    output_registry: &OutputRegistry,
    ctx: &mut TxContext,
): OutputRuntimeRequestV8 {
    new_verified_output_request(root, catalog, output_registry, ctx)
}

#[test_only]
public fun consume_output_runtime_request_for_testing<PaymentCoin, OutputRegistry: key>(
    request: OutputRuntimeRequestV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    output_registry: &OutputRegistry,
    ctx: &TxContext,
): ID {
    consume_verified_output_request(request, root, catalog, output_registry, ctx)
}

#[test_only]
public fun set_seal_root_for_testing(readiness: &mut SealReadinessV8, root_id: ID) {
    readiness.root_id = root_id;
}

#[test_only]
public fun set_seal_catalog_for_testing(readiness: &mut SealReadinessV8, catalog_id: ID) {
    readiness.catalog_id = catalog_id;
}

#[test_only]
public fun set_seal_registry_for_testing(readiness: &mut SealReadinessV8, registry_id: ID) {
    readiness.registry_id = registry_id;
}

#[test_only]
public fun set_seal_companion_commitment_for_testing(
    readiness: &mut SealReadinessV8,
    commitment: vector<u8>,
) {
    readiness.companion_commitment = commitment;
}

#[test_only]
public fun set_seal_call_cap_set_commitment_for_testing(
    readiness: &mut SealReadinessV8,
    commitment: vector<u8>,
) {
    readiness.call_cap_set_commitment = commitment;
}

#[test_only]
public fun set_output_request_root_for_testing(
    request: &mut OutputRuntimeRequestV8,
    root_id: ID,
) {
    request.root_id = root_id;
}

#[test_only]
public fun destroy_output_readiness_for_testing(readiness: OutputReadinessV8) {
    let OutputReadinessV8 { root_id: _, catalog_id: _, call_cap_set_commitment: _,
        registry_id: _, companion_commitment: _, commitment: _ } = readiness;
}

#[test_only]
public fun destroy_output_request_for_testing(request: OutputRuntimeRequestV8) {
    let OutputRuntimeRequestV8 { request_id: _, root_id: _, catalog_id: _,
        call_cap_set_commitment: _, output_registry_id: _, requester: _,
        commitment: _ } = request;
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
public struct TestRegistry has key { id: UID }

#[test_only]
public struct TestFixture {
    config: ProtocolConfigV8,
    protocol_treasury: ProtocolTreasuryV8<sui::sui::SUI>,
    protocol_admin: animacraft_v8_core::protocol_config_v8::ProtocolAdminCapV8,
    root: MakerRootV8<sui::sui::SUI>,
    base_registry: BaseDefinitionRegistryV8,
    maker_treasury: MakerTreasuryV8<sui::sui::SUI>,
    admin: MakerAdminCapV8,
    catalog: ProductReleaseCatalogV8,
    release_cap: PackageCallCapV8<ReleaseRoleV8>,
    runtime_cap: PackageCallCapV8<RuntimeRoleV8>,
    output_cap: PackageCallCapV8<OutputRoleV8>,
    seal_registry: TestRegistry,
    runtime_definitions: TestRegistry,
    pack_registry: TestRegistry,
    admission_authority: TestRegistry,
    output_registry: TestRegistry,
    physical_registry: TestRegistry,
    market_registry: TestRegistry,
}

#[test_only]
fun new_test_fixture(ctx: &mut TxContext): TestFixture {
    let (config, protocol_treasury, protocol_admin) =
        protocol::new_protocol_with_treasury_for_testing<sui::sui::SUI>(true, ctx);
    let economics = maker::new_economics_snapshot_v8<sui::sui::SUI>(
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
    let commitments =
        base::minimal_expected_commitments_for_testing(root_content_commitment);
    let clock = sui::clock::create_for_testing(ctx);
    let (mut root, mut base_registry, maker_treasury, admin) =
        animacraft_v8_core::core_v8::new_initial_maker_draft_v8<sui::sui::SUI>(
            &config,
            b"activation-fixture".to_string(),
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
    let mut catalog = binding::product_release_catalog_for_testing(
        &config,
        maker::root_core_original_package_id_v8(&root).to_address(),
        maker::root_core_callable_package_id_v8(&root).to_address(),
        ctx,
    );
    let witness = binding::release_catalog_witness_for_testing(&catalog);
    maker::finalize_product_release_binding_v8(
        &mut root,
        &admin,
        &config,
        witness,
        ctx,
    );
    let release_cap = binding::take_release_call_cap_v8(
        &config,
        &protocol_admin,
        &mut catalog,
    );
    let runtime_cap = binding::take_runtime_call_cap_v8(
        &config,
        &protocol_admin,
        &mut catalog,
    );
    let output_cap = binding::take_output_call_cap_v8(
        &config,
        &protocol_admin,
        &mut catalog,
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
        release_cap,
        runtime_cap,
        output_cap,
        seal_registry: TestRegistry { id: object::new(ctx) },
        runtime_definitions: TestRegistry { id: object::new(ctx) },
        pack_registry: TestRegistry { id: object::new(ctx) },
        admission_authority: TestRegistry { id: object::new(ctx) },
        output_registry: TestRegistry { id: object::new(ctx) },
        physical_registry: TestRegistry { id: object::new(ctx) },
        market_registry: TestRegistry { id: object::new(ctx) },
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
    readiness_set_for_testing(
        &fixture.root,
        &fixture.catalog,
        &fixture.seal_registry,
        &fixture.runtime_definitions,
        &fixture.pack_registry,
        &fixture.admission_authority,
        &fixture.output_registry,
        &fixture.physical_registry,
        &fixture.market_registry,
    )
}

#[test_only]
fun activate_fixture(fixture: &mut TestFixture, ctx: &TxContext) {
    let (seal, runtime, output, physical, market) = readiness_for_fixture(fixture);
    activate_fixture_with_readiness(
        fixture, seal, runtime, output, physical, market, ctx,
    );
}

#[test_only]
fun activate_fixture_with_readiness(
    fixture: &mut TestFixture,
    seal: SealReadinessV8,
    runtime: RuntimeActivationReadinessV8,
    output: OutputReadinessV8,
    physical: PhysicalReadinessV8,
    market: MarketReadinessV8,
    ctx: &TxContext,
) {
    let admin = &fixture.admin;
    let config = &fixture.config;
    let catalog = &fixture.catalog;
    let base_registry = &fixture.base_registry;
    let maker_treasury = &fixture.maker_treasury;
    let protocol_treasury = &fixture.protocol_treasury;
    let release_cap = &fixture.release_cap;
    let root = &mut fixture.root;
    activate_maker_for_testing(
        root,
        admin,
        config,
        catalog,
        base_registry,
        maker_treasury,
        protocol_treasury,
        release_cap,
        seal,
        runtime,
        output,
        physical,
        market,
        ctx,
    );
}

#[test_only]
fun activate_fixture_with_protocol_treasury(
    fixture: &mut TestFixture,
    protocol_treasury: &ProtocolTreasuryV8<sui::sui::SUI>,
    ctx: &TxContext,
) {
    let (seal, runtime, output, physical, market) = readiness_for_fixture(fixture);
    let admin = &fixture.admin;
    let config = &fixture.config;
    let catalog = &fixture.catalog;
    let base_registry = &fixture.base_registry;
    let maker_treasury = &fixture.maker_treasury;
    let release_cap = &fixture.release_cap;
    let root = &mut fixture.root;
    activate_maker_for_testing(root, admin, config, catalog, base_registry,
        maker_treasury, protocol_treasury, release_cap, seal, runtime, output,
        physical, market, ctx);
}

#[test_only]
fun activate_fixture_with_maker_treasury(
    fixture: &mut TestFixture,
    maker_treasury: &MakerTreasuryV8<sui::sui::SUI>,
    ctx: &TxContext,
) {
    let (seal, runtime, output, physical, market) = readiness_for_fixture(fixture);
    let admin = &fixture.admin;
    let config = &fixture.config;
    let catalog = &fixture.catalog;
    let base_registry = &fixture.base_registry;
    let protocol_treasury = &fixture.protocol_treasury;
    let release_cap = &fixture.release_cap;
    let root = &mut fixture.root;
    activate_maker_for_testing(root, admin, config, catalog, base_registry,
        maker_treasury, protocol_treasury, release_cap, seal, runtime, output,
        physical, market, ctx);
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
        release_cap,
        runtime_cap,
        output_cap,
        seal_registry,
        runtime_definitions,
        pack_registry,
        admission_authority,
        output_registry,
        physical_registry,
        market_registry,
    } = fixture;
    let TestRegistry { id: seal_id } = seal_registry;
    let TestRegistry { id: runtime_definitions_id } = runtime_definitions;
    let TestRegistry { id: pack_id } = pack_registry;
    let TestRegistry { id: admission_id } = admission_authority;
    let TestRegistry { id: output_id } = output_registry;
    let TestRegistry { id: physical_id } = physical_registry;
    let TestRegistry { id: market_id } = market_registry;
    seal_id.delete();
    runtime_definitions_id.delete();
    pack_id.delete();
    admission_id.delete();
    output_id.delete();
    physical_id.delete();
    market_id.delete();
    base::share_base_definition_registry_v8(base_registry);
    treasury::destroy_maker_treasury_for_testing(maker_treasury);
    maker::destroy_maker_for_testing(root, admin);
    binding::destroy_call_cap_for_testing(release_cap);
    binding::destroy_call_cap_for_testing(runtime_cap);
    binding::destroy_call_cap_for_testing(output_cap);
    binding::destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_with_treasury_for_testing(
        config,
        protocol_treasury,
        protocol_admin,
    );
}

#[test]
fun exact_terminal_activation_binds_all_capabilities() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 801, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_active_v8(), 99);
    let capability = maker::root_capability_registry_binding_v8(&fixture.root);
    assert!(maker::capability_output_registry_id_v8(capability)
        == object::id(&fixture.output_registry), 99);
    assert!(maker::capability_pack_registry_id_v8(capability)
        == object::id(&fixture.pack_registry), 99);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 0)]
fun second_activation_is_forbidden() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 802, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    let admin = &fixture.admin;
    let root = &mut fixture.root;
    maker::activate_from_core_v8(root, admin);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = ERegistryCollision)]
fun zero_companion_id_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 803, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let (mut seal, runtime, output, physical, market) = readiness_for_fixture(&fixture);
    set_seal_registry_for_testing(&mut seal, object::id_from_address(@0x0));
    activate_fixture_with_readiness(
        &mut fixture, seal, runtime, output, physical, market, &ctx,
    );
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EReadinessMismatch)]
fun cross_root_readiness_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 804, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let (mut seal, runtime, output, physical, market) = readiness_for_fixture(&fixture);
    set_seal_root_for_testing(&mut seal, object::id_from_address(@0xBAD));
    activate_fixture_with_readiness(
        &mut fixture, seal, runtime, output, physical, market, &ctx,
    );
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EReadinessMismatch)]
fun cross_catalog_readiness_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 805, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let (mut seal, runtime, output, physical, market) = readiness_for_fixture(&fixture);
    set_seal_catalog_for_testing(&mut seal, object::id_from_address(@0xBAD));
    activate_fixture_with_readiness(
        &mut fixture, seal, runtime, output, physical, market, &ctx,
    );
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun zero_companion_commitment_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 806, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let (mut seal, runtime, output, physical, market) = readiness_for_fixture(&fixture);
    set_seal_companion_commitment_for_testing(&mut seal, vector[0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    activate_fixture_with_readiness(
        &mut fixture, seal, runtime, output, physical, market, &ctx,
    );
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EReadinessMismatch)]
fun cross_call_cap_set_commitment_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 811, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let (mut seal, runtime, output, physical, market) = readiness_for_fixture(&fixture);
    set_seal_call_cap_set_commitment_for_testing(&mut seal, test_hash(77));
    activate_fixture_with_readiness(
        &mut fixture, seal, runtime, output, physical, market, &ctx,
    );
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 9)]
fun readiness_cap_cannot_cross_catalogs() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 812, 0, 0, 0);
    let fixture = new_test_fixture(&mut ctx);
    let catalog_b = binding::product_release_catalog_for_testing(
        &fixture.config,
        maker::root_core_original_package_id_v8(&fixture.root).to_address(),
        maker::root_core_callable_package_id_v8(&fixture.root).to_address(),
        &mut ctx,
    );
    let readiness = certify_output_readiness_v8<
        sui::sui::SUI,
        TestRegistry,
        TestRegistry,
        TestRegistry,
    >(&fixture.root, &catalog_b, &fixture.output_cap, &fixture.output_registry,
        test_hash(31));
    destroy_output_readiness_for_testing(readiness);
    binding::destroy_catalog_for_testing(catalog_b);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 1)]
fun readiness_requires_exact_role_type_origin() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 813, 0, 0, 0);
    let fixture = new_test_fixture(&mut ctx);
    let readiness = certify_output_readiness_v8<
        sui::sui::SUI,
        TestRegistry,
        TestRegistry,
        TestRegistry,
    >(&fixture.root, &fixture.catalog, &fixture.output_cap,
        &fixture.output_registry, test_hash(31));
    destroy_output_readiness_for_testing(readiness);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 7)]
fun activation_rejects_cross_protocol_treasury() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 816, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let other = new_test_fixture(&mut ctx);
    activate_fixture_with_protocol_treasury(
        &mut fixture,
        &other.protocol_treasury,
        &ctx,
    );
    destroy_test_fixture(fixture);
    destroy_test_fixture(other);
}

#[test, expected_failure(abort_code = 25)]
fun activation_rejects_cross_maker_treasury() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 817, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    let other = new_test_fixture(&mut ctx);
    activate_fixture_with_maker_treasury(
        &mut fixture,
        &other.maker_treasury,
        &ctx,
    );
    destroy_test_fixture(fixture);
    destroy_test_fixture(other);
}

#[test]
fun output_request_is_consumed_for_exact_registry_and_requester() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 807, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    let request = new_output_runtime_request_for_testing(
        &fixture.root,
        &fixture.catalog,
        &fixture.output_registry,
        &mut ctx,
    );
    let request_id = consume_output_runtime_request_for_testing(
        request,
        &fixture.root,
        &fixture.catalog,
        &fixture.output_registry,
        &ctx,
    );
    assert!(request_id != object::id_from_address(@0x0), 99);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EOutputRequestMismatch)]
fun output_request_rejects_cross_registry() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 808, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    let request = new_output_runtime_request_for_testing(
        &fixture.root, &fixture.catalog, &fixture.output_registry, &mut ctx);
    consume_output_runtime_request_for_testing(request, &fixture.root, &fixture.catalog,
        &fixture.market_registry, &ctx);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EOutputRequestMismatch)]
fun output_request_rejects_cross_root() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 814, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    let mut request = new_output_runtime_request_for_testing(
        &fixture.root, &fixture.catalog, &fixture.output_registry, &mut ctx);
    set_output_request_root_for_testing(&mut request, object::id_from_address(@0xBAD));
    consume_output_runtime_request_for_testing(request, &fixture.root, &fixture.catalog,
        &fixture.output_registry, &ctx);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = 9)]
fun output_request_cap_cannot_cross_catalogs() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 815, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    let catalog_b = binding::product_release_catalog_for_testing(
        &fixture.config,
        maker::root_core_original_package_id_v8(&fixture.root).to_address(),
        maker::root_core_callable_package_id_v8(&fixture.root).to_address(),
        &mut ctx,
    );
    let request = new_output_runtime_request_v8<
        sui::sui::SUI,
        TestRegistry,
        TestRegistry,
        TestRegistry,
    >(&fixture.root, &catalog_b, &fixture.output_cap, &fixture.output_registry,
        &mut ctx);
    destroy_output_request_for_testing(request);
    binding::destroy_catalog_for_testing(catalog_b);
    destroy_test_fixture(fixture);
}

#[test, expected_failure(abort_code = EOutputRequestMismatch)]
fun output_request_rejects_cross_requester() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 809, 0, 0, 0);
    let mut fixture = new_test_fixture(&mut ctx);
    activate_fixture(&mut fixture, &ctx);
    let request = new_output_runtime_request_for_testing(
        &fixture.root, &fixture.catalog, &fixture.output_registry, &mut ctx);
    let other_ctx = sui::tx_context::new_from_hint(@0xB22, 810, 0, 0, 0);
    consume_output_runtime_request_for_testing(request, &fixture.root, &fixture.catalog,
        &fixture.output_registry, &other_ctx);
    destroy_test_fixture(fixture);
}
