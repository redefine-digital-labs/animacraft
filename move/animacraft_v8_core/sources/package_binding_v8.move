/// Canonical seven-package identity catalog for fresh Animacraft v8.
/// The catalog is the sole persistent owner of the tuple and authority set.
module animacraft_v8_core::package_binding_v8;

use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::{Self as string, String};
use std::type_name;
use sui::dynamic_field;

const SCHEMA_REVISION: u64 = 2;
#[test_only]
const HASH_LENGTH: u64 = 32;
const NATIVE_CAPABILITY_MASK: u64 = 127;

const ROLE_CORE: u8 = 0;
const ROLE_SEAL: u8 = 1;
const ROLE_RUNTIME: u8 = 2;
const ROLE_OUTPUT: u8 = 3;
const ROLE_PHYSICAL: u8 = 4;
const ROLE_MARKET: u8 = 5;
const ROLE_RELEASE: u8 = 6;

const CAP_SEAL: u8 = 0;
const CAP_RUNTIME: u8 = 1;
const CAP_OUTPUT: u8 = 2;
const CAP_PHYSICAL: u8 = 3;
const CAP_MARKET: u8 = 4;
const CAP_RELEASE: u8 = 5;
const SETUP_CAP_COUNT: u8 = 6;

const BOOTSTRAP_SEALED: u8 = 0;
const BOOTSTRAP_IN_PROGRESS: u8 = 1;
const BOOTSTRAP_CERTIFIED: u8 = 2;
const RUNTIME_CALLER_OUTPUT: u8 = 0;
const RUNTIME_CALLER_MARKET: u8 = 1;
const INSTALL_OUTPUT_CALLER_CAP: u8 = 4;
const INSTALL_MARKET_CALLER_CAP: u8 = 8;
// Runtime's config is already installed by its unique setup cap. Native Soul
// types are frozen in ProtocolConfig before catalog creation, not installed
// later by Runtime. Bootstrap installs only the two real Runtime caller caps.
const INSTALL_COMPLETE_MASK: u8 = 12;

const EInvalidCommitment: u64 = 0;
const ETypeOriginMismatch: u64 = 1;
const ERoleCollision: u64 = 2;
const EProtocolCatalogMismatch: u64 = 3;
const ECatalogCommitmentMismatch: u64 = 4;
const ECallCapAlreadyTaken: u64 = 5;
const ECallCapsNotInstalled: u64 = 6;
const ESetupWitnessMismatch: u64 = 8;
const ESetupInstallMismatch: u64 = 9;
const EReplacementMismatch: u64 = 10;
const EBootstrapStateMismatch: u64 = 11;
const EBootstrapAdminMismatch: u64 = 12;
const EBootstrapInstallMismatch: u64 = 13;
const ERuntimeCallerCapMismatch: u64 = 14;

public struct PackageCommitmentsV8 has copy, drop, store {
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
}

public struct ExactPackageBindingV8 has copy, drop, store {
    original_package_id: ID,
    callable_package_id: ID,
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
    commitment: vector<u8>,
}

/// Binding order: CORE, SEAL, RUNTIME, OUTPUT, PHYSICAL, MARKET, RELEASE.
public struct ProductReleaseBindingV8 has copy, drop, store {
    bindings: vector<ExactPackageBindingV8>,
    commitment: vector<u8>,
}

/// Authority order: SEAL, RUNTIME, OUTPUT, PHYSICAL, MARKET, RELEASE.
public struct ProductReleaseCatalogV8 has key {
    id: UID,
    schema_revision: u64,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    binding: ProductReleaseBindingV8,
    authority_ids: vector<ID>,
    call_cap_set_commitment: vector<u8>,
    catalog_commitment: vector<u8>,
    next_setup_role: u8,
    role_config_ids: vector<ID>,
    role_config_commitments: vector<vector<u8>>,
}

/// Ephemeral one-use setup capability. With no abilities it cannot be copied,
/// dropped, serialized or stored in an external object; the same PTB must
/// consume it through the matching role-specific Core gate.
public struct PackageCallCapV8<phantom Role> {
    role: u8,
    schema_revision: u64,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    role_authority_id: ID,
    role_binding_commitment: vector<u8>,
}

public struct SealRoleV8 has drop {}
public struct RuntimeRoleV8 has drop {}
public struct OutputRoleV8 has drop {}
public struct PhysicalRoleV8 has drop {}
public struct MarketRoleV8 has drop {}
public struct ReleaseRoleV8 has drop {}

public struct ExactPackageBindingInputV2 has drop {
    domain: String,
    schema_revision: u64,
    role: u8,
    original_package_id: ID,
    callable_package_id: ID,
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
}

public struct PackageCallCapSetCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    catalog_id: ID,
    core_binding_commitment: vector<u8>,
    seal_binding_commitment: vector<u8>,
    runtime_binding_commitment: vector<u8>,
    output_binding_commitment: vector<u8>,
    physical_binding_commitment: vector<u8>,
    market_binding_commitment: vector<u8>,
    release_binding_commitment: vector<u8>,
    seal_authority_id: ID,
    runtime_authority_id: ID,
    output_authority_id: ID,
    physical_authority_id: ID,
    market_authority_id: ID,
    release_authority_id: ID,
}

public struct PackageTupleInputV2 has drop {
    domain: String,
    schema_revision: u64,
    catalog_id: ID,
    native_capability_mask: u64,
    call_cap_set_commitment: vector<u8>,
    core_binding: vector<u8>,
    seal_binding: vector<u8>,
    runtime_binding: vector<u8>,
    output_binding: vector<u8>,
    physical_binding: vector<u8>,
    market_binding: vector<u8>,
    release_binding: vector<u8>,
}

public struct CatalogCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    catalog_id: ID,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    native_capability_mask: u64,
    seal_authority_id: ID,
    runtime_authority_id: ID,
    output_authority_id: ID,
    physical_authority_id: ID,
    market_authority_id: ID,
    release_authority_id: ID,
}

public struct FreshTupleReplacementBindingInputV2 has copy, drop, store {
    core_binding_commitment: vector<u8>,
    seal_binding_commitment: vector<u8>,
    runtime_binding_commitment: vector<u8>,
    output_binding_commitment: vector<u8>,
    physical_binding_commitment: vector<u8>,
    market_binding_commitment: vector<u8>,
    release_binding_commitment: vector<u8>,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    runtime_config_id: ID,
    output_config_id: ID,
    market_config_id: ID,
    release_config_id: ID,
}

public struct FreshTupleReplacementBindingV2 has key {
    id: UID,
    version: u64,
    catalog_id: ID,
    core_binding_commitment: vector<u8>,
    seal_binding_commitment: vector<u8>,
    runtime_binding_commitment: vector<u8>,
    output_binding_commitment: vector<u8>,
    physical_binding_commitment: vector<u8>,
    market_binding_commitment: vector<u8>,
    release_binding_commitment: vector<u8>,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    runtime_config_id: ID,
    output_config_id: ID,
    market_config_id: ID,
    release_config_id: ID,
    binding_commitment: vector<u8>,
}

public struct FreshTupleBootstrapAdminV2 has key {
    id: UID,
    version: u64,
    protocol_admin_id: ID,
    replacement_binding_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    caps_minted: bool,
    install_mask: u8,
    install_mark_commitments: vector<vector<u8>>,
    bootstrap_commitment: vector<u8>,
}

public struct FreshTupleBootstrapCertificateV2 has key {
    id: UID,
    version: u64,
    replacement_binding_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    install_mask: u8,
    install_mark_commitments: vector<vector<u8>>,
    certificate_commitment: vector<u8>,
}

public struct FreshTupleBootstrapSlotKeyV2 has copy, drop, store {}

public struct FreshTupleBootstrapSlotV2 has store {
    state: u8,
    replacement_binding_id: ID,
    admin_id: Option<ID>,
    certificate_id: Option<ID>,
    certificate_commitment: Option<vector<u8>>,
}

public struct RuntimeCallerCapV1 has store {
    schema_revision: u64,
    role: u8,
    catalog_id: ID,
    replacement_binding_id: ID,
    package_tuple_commitment: vector<u8>,
    caller_original_package_id: ID,
    caller_callable_package_id: ID,
    call_cap_set_commitment: vector<u8>,
    cap_commitment: vector<u8>,
}

public struct FreshTupleBootstrapUseWitnessV2 {
    replacement_binding_id: ID,
    bootstrap_certificate_id: ID,
    bootstrap_certificate_commitment: vector<u8>,
    release_config_id: ID,
    release_original_package_id: ID,
}

public struct FreshTupleReplacementBindingCommitmentInputV2 has drop {
    domain: String, schema_revision: u64, binding_id: ID, catalog_id: ID,
    core_binding_commitment: vector<u8>, seal_binding_commitment: vector<u8>,
    runtime_binding_commitment: vector<u8>, output_binding_commitment: vector<u8>,
    physical_binding_commitment: vector<u8>, market_binding_commitment: vector<u8>,
    release_binding_commitment: vector<u8>, package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>, runtime_config_id: ID,
    output_config_id: ID, market_config_id: ID, release_config_id: ID,
}

public struct FreshTupleBootstrapAdminCommitmentInputV2 has drop {
    domain: String, schema_revision: u64, admin_id: ID, protocol_admin_id: ID,
    replacement_binding_id: ID, catalog_id: ID,
    package_tuple_commitment: vector<u8>, call_cap_set_commitment: vector<u8>,
    caps_minted: bool, install_mask: u8,
    ordered_install_mark_commitments: vector<vector<u8>>,
}

#[allow(unused_field)]
public struct FreshTupleBootstrapSlotCommitmentInputV2 has drop {
    domain: String, schema_revision: u64, catalog_id: ID, key_type_name: String,
    key_bcs: vector<u8>, state: u8, replacement_binding_id: ID,
    admin_id: Option<ID>, certificate_id: Option<ID>,
    certificate_commitment: Option<vector<u8>>,
}

public struct TupleBootstrapInstallMarkCommitmentInputV2 has drop {
    domain: String, schema_revision: u64, replacement_binding_id: ID,
    role: u8, install_kind: u8, config_id: ID,
    installed_object_id: Option<ID>, installed_commitment: vector<u8>,
    role_witness_type_name: String,
}

public struct FreshTupleBootstrapCertificateCommitmentInputV2 has drop {
    domain: String, schema_revision: u64, certificate_id: ID,
    replacement_binding_id: ID, catalog_id: ID,
    package_tuple_commitment: vector<u8>, call_cap_set_commitment: vector<u8>,
    install_mask: u8, ordered_install_mark_commitments: vector<vector<u8>>,
}

public struct RuntimeCallerCapCommitmentInputV1 has drop {
    domain: String, schema_revision: u64, role: u8, catalog_id: ID,
    replacement_binding_id: ID, package_tuple_commitment: vector<u8>,
    caller_original_package_id: ID, caller_callable_package_id: ID,
    call_cap_set_commitment: vector<u8>,
}

/// Canonical common commitment row for all six package-local role configs.
/// Role-specific positions are always explicit Move Options; a package may
/// not omit a field or substitute a package-local digest layout.
public struct RoleConfigCommitmentInputV2 has drop {
    domain: String,
    schema_revision: u64,
    role: u8,
    config_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    authority_id: ID,
    finalized: bool,
    seal_policy_commitment: Option<vector<u8>>,
    key_server_set_commitment: Option<vector<u8>>,
    encryption_policy_commitment: Option<vector<u8>>,
    external_validator_policy_id: Option<ID>,
    external_validator_registry_id: Option<ID>,
    soul_binding_registry_id: Option<ID>,
    runtime_caller_cap_commitment: Option<vector<u8>>,
    bootstrap_certificate_id: Option<ID>,
    bootstrap_certificate_commitment: Option<vector<u8>>,
}

public fun new_package_commitments_v8(
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
): PackageCommitmentsV8 {
    assert_hash(&source_commitment);
    assert_hash(&package_commitment);
    assert_hash(&abi_commitment);
    PackageCommitmentsV8 { source_commitment, package_commitment, abi_commitment }
}

/// The only production catalog constructor. Cap-set is derived before tuple;
/// both include the freshly allocated catalog ID exactly once.
public fun certify_product_release_catalog_v8<
    CoreOriginalMarker,
    CoreCallableMarker,
    SealOriginalMarker,
    SealCallableMarker,
    RuntimeOriginalMarker,
    RuntimeCallableMarker,
    OutputOriginalMarker,
    OutputCallableMarker,
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
    MarketOriginalMarker,
    MarketCallableMarker,
    ReleaseOriginalMarker,
    ReleaseCallableMarker,
>(
    config: &mut ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    core_commitments: PackageCommitmentsV8,
    seal_commitments: PackageCommitmentsV8,
    runtime_commitments: PackageCommitmentsV8,
    output_commitments: PackageCommitmentsV8,
    physical_commitments: PackageCommitmentsV8,
    market_commitments: PackageCommitmentsV8,
    release_commitments: PackageCommitmentsV8,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    protocol::assert_protocol_admin_v8(config, protocol_admin);
    protocol::assert_enabled_v8(config);
    let bindings = vector[
        new_exact_package_binding<CoreOriginalMarker, CoreCallableMarker>(
            ROLE_CORE, core_commitments),
        new_exact_package_binding<SealOriginalMarker, SealCallableMarker>(
            ROLE_SEAL, seal_commitments),
        new_exact_package_binding<RuntimeOriginalMarker, RuntimeCallableMarker>(
            ROLE_RUNTIME, runtime_commitments),
        new_exact_package_binding<OutputOriginalMarker, OutputCallableMarker>(
            ROLE_OUTPUT, output_commitments),
        new_exact_package_binding<PhysicalOriginalMarker, PhysicalCallableMarker>(
            ROLE_PHYSICAL, physical_commitments),
        new_exact_package_binding<MarketOriginalMarker, MarketCallableMarker>(
            ROLE_MARKET, market_commitments),
        new_exact_package_binding<ReleaseOriginalMarker, ReleaseCallableMarker>(
            ROLE_RELEASE, release_commitments),
    ];
    assert_distinct_bindings(&bindings);
    assert!(bindings[ROLE_CORE as u64].original_package_id
        == protocol::config_core_original_package_id_v8(config),
        EProtocolCatalogMismatch);
    assert!(bindings[ROLE_CORE as u64].callable_package_id
        == protocol::config_core_callable_package_id_v8(config),
        EProtocolCatalogMismatch);

    let catalog_uid = object::new(ctx);
    let catalog_id = catalog_uid.to_inner();
    protocol::claim_product_release_catalog_v2(config, protocol_admin, catalog_id);
    let authority_ids = vector[
        fresh_authority_id(ctx), fresh_authority_id(ctx),
        fresh_authority_id(ctx), fresh_authority_id(ctx),
        fresh_authority_id(ctx), fresh_authority_id(ctx),
    ];
    let call_cap_set_commitment = derive_call_cap_set_commitment(
        catalog_id, &bindings, &authority_ids);
    let tuple_commitment = derive_tuple_commitment(
        catalog_id, &bindings, call_cap_set_commitment);
    let binding = ProductReleaseBindingV8 { bindings, commitment: tuple_commitment };
    let protocol_config_id = protocol::config_id_v8(config);
    let protocol_config_revision = protocol::config_revision_v8(config);
    let protocol_config_commitment = *protocol::config_commitment_v8(config);
    let catalog_commitment = derive_catalog_commitment(
        catalog_id,
        protocol_config_id,
        protocol_config_revision,
        protocol_config_commitment,
        tuple_commitment,
        call_cap_set_commitment,
        &authority_ids,
    );
    ProductReleaseCatalogV8 {
        id: catalog_uid,
        schema_revision: SCHEMA_REVISION,
        protocol_config_id,
        protocol_config_revision,
        protocol_config_commitment,
        binding,
        authority_ids,
        call_cap_set_commitment,
        catalog_commitment,
        next_setup_role: CAP_SEAL,
        role_config_ids: vector[],
        role_config_commitments: vector[],
    }
}

public fun share_product_release_catalog_v8(catalog: ProductReleaseCatalogV8) {
    assert!(catalog.next_setup_role == SETUP_CAP_COUNT, ECallCapsNotInstalled);
    assert!(catalog.role_config_ids.length() == SETUP_CAP_COUNT as u64
        && catalog.role_config_commitments.length() == SETUP_CAP_COUNT as u64,
        ECallCapsNotInstalled);
    assert_catalog_well_formed(&catalog);
    transfer::share_object(catalog);
}

public fun new_fresh_tuple_replacement_binding_input_v2(
    catalog: &ProductReleaseCatalogV8,
    runtime_config_id: ID,
    output_config_id: ID,
    market_config_id: ID,
    release_config_id: ID,
): FreshTupleReplacementBindingInputV2 {
    assert_catalog_setup_complete_v2(catalog);
    replacement_input_from_catalog(
        catalog, runtime_config_id, output_config_id, market_config_id,
        release_config_id)
}

public fun seal_fresh_tuple_replacement_binding_v2(
    protocol_config: &ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
    binding_input: FreshTupleReplacementBindingInputV2,
    ctx: &mut TxContext,
) {
    protocol::assert_protocol_admin_v8(protocol_config, protocol_admin);
    assert_catalog_current_v8(protocol_config, catalog);
    assert_catalog_setup_complete_v2(catalog);
    assert_replacement_input(catalog, &binding_input);
    assert!(!dynamic_field::exists(
        &catalog.id, FreshTupleBootstrapSlotKeyV2 {}),
        EBootstrapStateMismatch);
    let replacement_uid = object::new(ctx);
    let replacement_binding_id = replacement_uid.to_inner();
    let catalog_id = object::id(catalog);
    let binding_commitment = derive_replacement_binding_commitment(
        replacement_binding_id, catalog_id, &binding_input);
    let FreshTupleReplacementBindingInputV2 {
        core_binding_commitment, seal_binding_commitment,
        runtime_binding_commitment, output_binding_commitment,
        physical_binding_commitment, market_binding_commitment,
        release_binding_commitment, package_tuple_commitment,
        call_cap_set_commitment, runtime_config_id, output_config_id,
        market_config_id, release_config_id,
    } = binding_input;
    dynamic_field::add(&mut catalog.id, FreshTupleBootstrapSlotKeyV2 {},
        FreshTupleBootstrapSlotV2 {
            state: BOOTSTRAP_SEALED,
            replacement_binding_id,
            admin_id: option::none(),
            certificate_id: option::none(),
            certificate_commitment: option::none(),
        });
    transfer::freeze_object(FreshTupleReplacementBindingV2 {
        id: replacement_uid, version: SCHEMA_REVISION, catalog_id,
        core_binding_commitment, seal_binding_commitment,
        runtime_binding_commitment, output_binding_commitment,
        physical_binding_commitment, market_binding_commitment,
        release_binding_commitment, package_tuple_commitment,
        call_cap_set_commitment, runtime_config_id, output_config_id,
        market_config_id, release_config_id, binding_commitment,
    });
}

public fun begin_fresh_tuple_bootstrap_v2(
    protocol_config: &ProtocolConfigV8,
    protocol_admin: &ProtocolAdminCapV8,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &mut ProductReleaseCatalogV8,
    ctx: &mut TxContext,
) {
    protocol::assert_protocol_admin_v8(protocol_config, protocol_admin);
    assert_catalog_current_v8(protocol_config, catalog);
    assert_replacement_current_v2(replacement, catalog);
    let admin_uid = object::new(ctx);
    let admin_id = admin_uid.to_inner();
    let slot = dynamic_field::borrow_mut<FreshTupleBootstrapSlotKeyV2,
        FreshTupleBootstrapSlotV2>(
            &mut catalog.id, FreshTupleBootstrapSlotKeyV2 {});
    assert!(slot.state == BOOTSTRAP_SEALED, EBootstrapStateMismatch);
    assert!(slot.replacement_binding_id == object::id(replacement),
        EReplacementMismatch);
    assert!(slot.admin_id.is_none() && slot.certificate_id.is_none(),
        EBootstrapStateMismatch);
    slot.state = BOOTSTRAP_IN_PROGRESS;
    slot.admin_id = option::some(admin_id);
    let mut admin = FreshTupleBootstrapAdminV2 {
        id: admin_uid,
        version: SCHEMA_REVISION,
        protocol_admin_id: object::id(protocol_admin),
        replacement_binding_id: object::id(replacement),
        catalog_id: object::id(catalog),
        package_tuple_commitment: replacement.package_tuple_commitment,
        call_cap_set_commitment: replacement.call_cap_set_commitment,
        caps_minted: false,
        install_mask: 0,
        install_mark_commitments: vector[],
        bootstrap_commitment: vector[],
    };
    admin.bootstrap_commitment = derive_bootstrap_admin_commitment(&admin);
    transfer::transfer(admin, ctx.sender());
}

public fun mint_runtime_caller_caps_v1(
    protocol_config: &ProtocolConfigV8,
    admin: &mut FreshTupleBootstrapAdminV2,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
): (RuntimeCallerCapV1, RuntimeCallerCapV1) {
    assert_catalog_current_v8(protocol_config, catalog);
    assert_replacement_current_v2(replacement, catalog);
    assert_bootstrap_admin(admin, replacement, catalog);
    assert!(!admin.caps_minted && admin.install_mask == 0,
        EBootstrapAdminMismatch);
    assert_bootstrap_slot_admin(catalog, admin);
    admin.caps_minted = true;
    admin.bootstrap_commitment = derive_bootstrap_admin_commitment(admin);
    let output = new_runtime_caller_cap(
        RUNTIME_CALLER_OUTPUT, replacement, catalog,
        &catalog.binding.bindings[ROLE_OUTPUT as u64]);
    let market = new_runtime_caller_cap(
        RUNTIME_CALLER_MARKET, replacement, catalog,
        &catalog.binding.bindings[ROLE_MARKET as u64]);
    (output, market)
}

public fun mark_fresh_tuple_install_v2<Witness: drop>(
    protocol_config: &ProtocolConfigV8,
    admin: &mut FreshTupleBootstrapAdminV2,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
    witness: Witness,
    install_kind: u8,
    config_id: ID,
    installed_object_id: Option<ID>,
    installed_commitment: vector<u8>,
) {
    assert_catalog_current_v8(protocol_config, catalog);
    assert_replacement_current_v2(replacement, catalog);
    assert_bootstrap_admin(admin, replacement, catalog);
    assert_bootstrap_slot_admin(catalog, admin);
    assert!(admin.caps_minted, EBootstrapAdminMismatch);
    assert_hash(&installed_commitment);
    let (role, expected_mask, expected_config_id, expected_module,
        expected_datatype) = install_witness_rule(replacement, install_kind);
    assert!(admin.install_mask == expected_mask, EBootstrapInstallMismatch);
    assert!(config_id == expected_config_id, EBootstrapInstallMismatch);
    let role_binding = &catalog.binding.bindings[role as u64];
    assert_exact_witness_type_v2<Witness>(
        role_binding, &expected_module, &expected_datatype);
    let role_witness_type_name = string::from_ascii(
        type_name::with_original_ids<Witness>().into_string());
    let mark = hash::sha2_256(bcs::to_bytes(
        &TupleBootstrapInstallMarkCommitmentInputV2 {
            domain: b"animacraft-fresh-v8/core/fresh-tuple-bootstrap-install-mark/v2"
                .to_string(),
            schema_revision: SCHEMA_REVISION,
            replacement_binding_id: object::id(replacement),
            role,
            install_kind,
            config_id,
            installed_object_id,
            installed_commitment,
            role_witness_type_name,
        }));
    let _ = witness;
    admin.install_mask = expected_mask + install_kind;
    admin.install_mark_commitments.push_back(mark);
    admin.bootstrap_commitment = derive_bootstrap_admin_commitment(admin);
}

public fun finalize_fresh_tuple_bootstrap_v2(
    protocol_config: &ProtocolConfigV8,
    admin: FreshTupleBootstrapAdminV2,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &mut ProductReleaseCatalogV8,
    ctx: &mut TxContext,
) {
    assert_catalog_current_v8(protocol_config, catalog);
    assert_replacement_current_v2(replacement, catalog);
    assert_bootstrap_admin(&admin, replacement, catalog);
    assert!(admin.caps_minted && admin.install_mask == INSTALL_COMPLETE_MASK,
        EBootstrapInstallMismatch);
    assert!(admin.install_mark_commitments.length() == 2,
        EBootstrapInstallMismatch);
    let admin_id = object::id(&admin);
    let certificate_uid = object::new(ctx);
    let certificate_id = certificate_uid.to_inner();
    let certificate_commitment = derive_bootstrap_certificate_commitment(
        certificate_id, object::id(replacement), object::id(catalog),
        replacement.package_tuple_commitment,
        replacement.call_cap_set_commitment,
        admin.install_mask, admin.install_mark_commitments);
    let slot = dynamic_field::borrow_mut<FreshTupleBootstrapSlotKeyV2,
        FreshTupleBootstrapSlotV2>(
            &mut catalog.id, FreshTupleBootstrapSlotKeyV2 {});
    assert!(slot.state == BOOTSTRAP_IN_PROGRESS,
        EBootstrapStateMismatch);
    assert!(slot.replacement_binding_id == object::id(replacement),
        EReplacementMismatch);
    assert!(slot.admin_id.is_some() && *slot.admin_id.borrow() == admin_id,
        EBootstrapAdminMismatch);
    slot.state = BOOTSTRAP_CERTIFIED;
    slot.admin_id = option::none();
    slot.certificate_id = option::some(certificate_id);
    slot.certificate_commitment = option::some(certificate_commitment);
    let FreshTupleBootstrapAdminV2 {
        id: admin_uid, version: _, protocol_admin_id: _,
        replacement_binding_id: _, catalog_id: _,
        package_tuple_commitment: _, call_cap_set_commitment: _,
        caps_minted: _, install_mask, install_mark_commitments,
        bootstrap_commitment: _,
    } = admin;
    admin_uid.delete();
    transfer::freeze_object(FreshTupleBootstrapCertificateV2 {
        id: certificate_uid, version: SCHEMA_REVISION,
        replacement_binding_id: object::id(replacement),
        catalog_id: object::id(catalog),
        package_tuple_commitment: replacement.package_tuple_commitment,
        call_cap_set_commitment: replacement.call_cap_set_commitment,
        install_mask, install_mark_commitments, certificate_commitment,
    });
}

public fun issue_fresh_tuple_bootstrap_use_witness_v2(
    protocol_config: &ProtocolConfigV8,
    replacement: &FreshTupleReplacementBindingV2,
    certificate: &FreshTupleBootstrapCertificateV2,
    catalog: &ProductReleaseCatalogV8,
    release_config_id: ID,
): FreshTupleBootstrapUseWitnessV2 {
    assert_catalog_current_v8(protocol_config, catalog);
    assert_replacement_current_v2(replacement, catalog);
    assert_bootstrap_certificate_v2(certificate, replacement, catalog);
    assert!(release_config_id == replacement.release_config_id,
        EReplacementMismatch);
    FreshTupleBootstrapUseWitnessV2 {
        replacement_binding_id: object::id(replacement),
        bootstrap_certificate_id: object::id(certificate),
        bootstrap_certificate_commitment: certificate.certificate_commitment,
        release_config_id,
        release_original_package_id:
            catalog.binding.bindings[ROLE_RELEASE as u64].original_package_id,
    }
}

public fun consume_fresh_tuple_bootstrap_use_witness_v2<Witness: drop>(
    protocol_config: &ProtocolConfigV8,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
    use_witness: FreshTupleBootstrapUseWitnessV2,
    release_witness: Witness,
    release_config_id: ID,
    release_config_commitment: vector<u8>,
) {
    assert_catalog_current_v8(protocol_config, catalog);
    assert_replacement_current_v2(replacement, catalog);
    assert_hash(&release_config_commitment);
    let release_binding = &catalog.binding.bindings[ROLE_RELEASE as u64];
    assert_exact_witness_type_v2<Witness>(
        release_binding, &b"release_v8",
        &b"ReleaseBootstrapFinalizeWitnessV2");
    let FreshTupleBootstrapUseWitnessV2 {
        replacement_binding_id, bootstrap_certificate_id: _,
        bootstrap_certificate_commitment, release_config_id: embedded_config,
        release_original_package_id,
    } = use_witness;
    assert!(replacement_binding_id == object::id(replacement),
        EReplacementMismatch);
    assert_hash(&bootstrap_certificate_commitment);
    assert!(embedded_config == release_config_id
        && release_config_id == replacement.release_config_id,
        EReplacementMismatch);
    assert!(release_original_package_id == release_binding.original_package_id,
        EReplacementMismatch);
    let _ = release_witness;
}

public fun take_seal_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<SealRoleV8> {
    take_call_cap(config, admin, catalog, CAP_SEAL)
}

public fun take_runtime_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<RuntimeRoleV8> {
    take_call_cap(config, admin, catalog, CAP_RUNTIME)
}

public fun take_output_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<OutputRoleV8> {
    take_call_cap(config, admin, catalog, CAP_OUTPUT)
}

public fun take_physical_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<PhysicalRoleV8> {
    take_call_cap(config, admin, catalog, CAP_PHYSICAL)
}

public fun take_market_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<MarketRoleV8> {
    take_call_cap(config, admin, catalog, CAP_MARKET)
}

public fun take_release_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<ReleaseRoleV8> {
    take_call_cap(config, admin, catalog, CAP_RELEASE)
}

public fun consume_seal_call_cap_v8<Witness: drop>(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<SealRoleV8>,
    witness: Witness,
    config_id: ID,
    seal_policy_commitment: vector<u8>,
    key_server_set_commitment: vector<u8>,
    encryption_policy_commitment: vector<u8>,
): vector<u8> {
    consume_call_cap(catalog, cap, witness, CAP_SEAL,
        b"seal_v8", b"SealSetupInstallWitnessV2",
        config_id, true,
        option::some(seal_policy_commitment),
        option::some(key_server_set_commitment),
        option::some(encryption_policy_commitment),
        option::none(), option::none(), option::none(), option::none(),
        option::none(), option::none())
}

public fun consume_runtime_call_cap_v8<Witness: drop>(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<RuntimeRoleV8>,
    witness: Witness,
    config_id: ID,
): vector<u8> {
    consume_call_cap(catalog, cap, witness, CAP_RUNTIME,
        b"runtime_v8", b"RuntimeSetupInstallWitnessV2",
        config_id, false,
        option::none(), option::none(), option::none(), option::none(),
        option::none(), option::none(), option::none(), option::none(),
        option::none())
}

public fun consume_output_call_cap_v8<Witness: drop>(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<OutputRoleV8>,
    witness: Witness,
    config_id: ID,
): vector<u8> {
    consume_call_cap(catalog, cap, witness, CAP_OUTPUT,
        b"output_v8", b"OutputSetupInstallWitnessV2",
        config_id, false,
        option::none(), option::none(), option::none(), option::none(),
        option::none(), option::none(), option::none(), option::none(),
        option::none())
}

public fun consume_physical_call_cap_v8<Witness: drop>(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<PhysicalRoleV8>,
    witness: Witness,
    config_id: ID,
): vector<u8> {
    consume_call_cap(catalog, cap, witness, CAP_PHYSICAL,
        b"physical_v8", b"PhysicalSetupInstallWitnessV2",
        config_id, true,
        option::none(), option::none(), option::none(), option::none(),
        option::none(), option::none(), option::none(), option::none(),
        option::none())
}

public fun consume_market_call_cap_v8<Witness: drop>(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<MarketRoleV8>,
    witness: Witness,
    config_id: ID,
): vector<u8> {
    consume_call_cap(catalog, cap, witness, CAP_MARKET,
        b"market_v8", b"MarketSetupInstallWitnessV2",
        config_id, false,
        option::none(), option::none(), option::none(), option::none(),
        option::none(), option::none(), option::none(), option::none(),
        option::none())
}

public fun consume_release_call_cap_v8<Witness: drop>(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<ReleaseRoleV8>,
    witness: Witness,
    config_id: ID,
): vector<u8> {
    consume_call_cap(catalog, cap, witness, CAP_RELEASE,
        b"release_v8", b"ReleaseSetupInstallWitnessV2",
        config_id, false,
        option::none(), option::none(), option::none(), option::none(),
        option::none(), option::none(), option::none(), option::none(),
        option::none())
}

public fun assert_catalog_current_v8(
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
) {
    protocol::assert_enabled_v8(config);
    assert!(protocol::config_id_v8(config) == catalog.protocol_config_id,
        EProtocolCatalogMismatch);
    assert!(protocol::config_revision_v8(config)
        == catalog.protocol_config_revision, EProtocolCatalogMismatch);
    assert!(protocol::config_commitment_v8(config)
        == &catalog.protocol_config_commitment, EProtocolCatalogMismatch);
    protocol::assert_product_release_catalog_if_claimed_v2(
        config, object::id(catalog));
    assert_catalog_well_formed(catalog);
}

/// Existing owners may stop a Maker even after protocol disable/revision drift.
/// The immutable catalog, claimed identity and actual Core package remain exact.
/// Package-only: this is not an alternate live publication/commerce gate.
public(package) fun assert_catalog_for_stop_v8(
    config: &ProtocolConfigV8, catalog: &ProductReleaseCatalogV8,
) {
    protocol::assert_stop_identity_v8(config);
    assert!(protocol::config_id_v8(config) == catalog.protocol_config_id,
        EProtocolCatalogMismatch);
    protocol::assert_product_release_catalog_if_claimed_v2(config, object::id(catalog));
    assert_catalog_well_formed(catalog);
}

/// Package IDs alone do not identify a callable witness: this additionally
/// fixes its module and datatype under both original and defining type names.
public fun assert_exact_witness_type_v2<Witness>(
    binding: &ExactPackageBindingV8,
    expected_module: &vector<u8>,
    expected_datatype: &vector<u8>,
) {
    let original_name = type_name::with_original_ids<Witness>();
    let callable_name = type_name::with_defining_ids<Witness>();
    assert!(binding.original_package_id
        == object::id_from_address(type_name::original_id<Witness>()),
        ESetupWitnessMismatch);
    assert!(binding.callable_package_id
        == object::id_from_address(type_name::defining_id<Witness>()),
        ESetupWitnessMismatch);
    assert!(&original_name.module_string().into_bytes() == expected_module,
        ESetupWitnessMismatch);
    assert!(&original_name.datatype_string().into_bytes() == expected_datatype,
        ESetupWitnessMismatch);
    assert!(&callable_name.module_string().into_bytes() == expected_module,
        ESetupWitnessMismatch);
    assert!(&callable_name.datatype_string().into_bytes() == expected_datatype,
        ESetupWitnessMismatch);
    // Use the VM's canonical address representation (not a hardcoded 0x
    // prefix). Extra type arguments must still be rejected for witnesses.
    let original_length = original_name.address_string().into_bytes().length()
        + 4 + expected_module.length() + expected_datatype.length();
    let callable_length = callable_name.address_string().into_bytes().length()
        + 4 + expected_module.length() + expected_datatype.length();
    assert!(original_name.into_string().into_bytes().length()
        == original_length, ESetupWitnessMismatch);
    assert!(callable_name.into_string().into_bytes().length()
        == callable_length, ESetupWitnessMismatch);
}

/// Exact companion object type with one fixed payment-coin type argument.
/// Unlike witness validation this permits precisely one generic argument,
/// checking original AND defining IDs for both the object and its argument.
public fun assert_exact_single_argument_type_v2<ObjectType, Argument>(
    binding: &ExactPackageBindingV8,
    expected_module: &vector<u8>, expected_datatype: &vector<u8>,
) {
    let original = type_name::with_original_ids<ObjectType>();
    let defining = type_name::with_defining_ids<ObjectType>();
    assert!(binding.original_package_id == object::id_from_address(type_name::original_id<ObjectType>())
        && binding.callable_package_id == object::id_from_address(type_name::defining_id<ObjectType>()),
        ESetupWitnessMismatch);
    assert!(&original.module_string().into_bytes() == expected_module
        && &defining.module_string().into_bytes() == expected_module
        && &original.datatype_string().into_bytes() == expected_datatype
        && &defining.datatype_string().into_bytes() == expected_datatype, ESetupWitnessMismatch);
    let original_prefix = original.address_string().into_bytes().length()
        + 4 + expected_module.length() + expected_datatype.length();
    let defining_prefix = defining.address_string().into_bytes().length()
        + 4 + expected_module.length() + expected_datatype.length();
    assert_single_argument_suffix(original.into_string().into_bytes(), original_prefix,
        type_name::with_original_ids<Argument>().into_string().into_bytes());
    assert_single_argument_suffix(defining.into_string().into_bytes(), defining_prefix,
        type_name::with_defining_ids<Argument>().into_string().into_bytes());
}

fun assert_single_argument_suffix(name: vector<u8>, prefix_length: u64, argument: vector<u8>) {
    let mut suffix = b"<";
    suffix.append(argument);
    suffix.append(b">");
    assert!(name.length() == prefix_length + suffix.length(), ESetupWitnessMismatch);
    let mut index = 0u64;
    while (index < suffix.length()) {
        assert!(name[prefix_length + index] == suffix[index], ESetupWitnessMismatch);
        index = index + 1;
    };
}

fun assert_product_release_binding_well_formed_v8(
    catalog_id: ID,
    binding: &ProductReleaseBindingV8,
    call_cap_set_commitment: &vector<u8>,
) {
    assert!(binding.bindings.length() == 7, ECatalogCommitmentMismatch);
    let mut role = 0;
    while (role < 7) {
        assert_binding_well_formed(role as u8, &binding.bindings[role]);
        role = role + 1;
    };
    assert_distinct_bindings(&binding.bindings);
    let expected = derive_tuple_commitment(
        catalog_id, &binding.bindings, *call_cap_set_commitment);
    assert!(&expected == &binding.commitment, ECatalogCommitmentMismatch);
}

public fun assert_catalog_setup_complete_v2(
    catalog: &ProductReleaseCatalogV8,
) {
    assert_catalog_well_formed(catalog);
    assert!(catalog.next_setup_role == SETUP_CAP_COUNT,
        ECallCapsNotInstalled);
    assert!(catalog.role_config_ids.length() == SETUP_CAP_COUNT as u64
        && catalog.role_config_commitments.length() == SETUP_CAP_COUNT as u64,
        ECallCapsNotInstalled);
}

/// Bind a companion config to its consumed setup capability, not just the tuple.
/// Package roles are 1..6; the installation vectors use zero-based cap slots.
public fun assert_role_config_installation_v2(
    catalog: &ProductReleaseCatalogV8,
    package_role: u8,
    config_id: ID,
    commitment: &vector<u8>,
) {
    assert_catalog_well_formed(catalog);
    assert!(package_role >= ROLE_SEAL && package_role <= ROLE_RELEASE,
        ESetupInstallMismatch);
    let slot = (package_role - 1) as u64;
    assert!(slot < catalog.role_config_ids.length()
        && slot < catalog.role_config_commitments.length(), ESetupInstallMismatch);
    assert!(catalog.role_config_ids[slot] == config_id
        && &catalog.role_config_commitments[slot] == commitment,
        ESetupInstallMismatch);
}

public fun assert_replacement_current_v2(
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
) {
    assert_catalog_setup_complete_v2(catalog);
    assert!(replacement.version == SCHEMA_REVISION, EReplacementMismatch);
    assert!(replacement.catalog_id == object::id(catalog),
        EReplacementMismatch);
    let input = FreshTupleReplacementBindingInputV2 {
        core_binding_commitment: replacement.core_binding_commitment,
        seal_binding_commitment: replacement.seal_binding_commitment,
        runtime_binding_commitment: replacement.runtime_binding_commitment,
        output_binding_commitment: replacement.output_binding_commitment,
        physical_binding_commitment: replacement.physical_binding_commitment,
        market_binding_commitment: replacement.market_binding_commitment,
        release_binding_commitment: replacement.release_binding_commitment,
        package_tuple_commitment: replacement.package_tuple_commitment,
        call_cap_set_commitment: replacement.call_cap_set_commitment,
        runtime_config_id: replacement.runtime_config_id,
        output_config_id: replacement.output_config_id,
        market_config_id: replacement.market_config_id,
        release_config_id: replacement.release_config_id,
    };
    assert_replacement_input(catalog, &input);
    let expected = derive_replacement_binding_commitment(
        object::id(replacement), object::id(catalog), &input);
    assert!(&expected == &replacement.binding_commitment,
        EReplacementMismatch);
}

public fun runtime_caller_cap_commitment_v2(cap: &RuntimeCallerCapV1): &vector<u8> {
    &cap.cap_commitment
}

#[test_only]
public fun destroy_runtime_caller_cap_for_testing(cap: RuntimeCallerCapV1) {
    let RuntimeCallerCapV1 { schema_revision: _, role: _, catalog_id: _,
        replacement_binding_id: _, package_tuple_commitment: _,
        caller_original_package_id: _, caller_callable_package_id: _,
        call_cap_set_commitment: _, cap_commitment: _ } = cap;
}

public fun assert_runtime_caller_cap_v1(
    cap: &RuntimeCallerCapV1,
    expected_role: u8,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
) {
    assert_replacement_current_v2(replacement, catalog);
    assert!(expected_role == RUNTIME_CALLER_OUTPUT
        || expected_role == RUNTIME_CALLER_MARKET,
        ERuntimeCallerCapMismatch);
    let package_role = if (expected_role == RUNTIME_CALLER_OUTPUT) {
        ROLE_OUTPUT
    } else {
        ROLE_MARKET
    };
    let binding = &catalog.binding.bindings[package_role as u64];
    assert!(cap.schema_revision == SCHEMA_REVISION,
        ERuntimeCallerCapMismatch);
    assert!(cap.role == expected_role, ERuntimeCallerCapMismatch);
    assert!(cap.catalog_id == object::id(catalog),
        ERuntimeCallerCapMismatch);
    assert!(cap.replacement_binding_id == object::id(replacement),
        ERuntimeCallerCapMismatch);
    assert!(&cap.package_tuple_commitment
        == &replacement.package_tuple_commitment,
        ERuntimeCallerCapMismatch);
    assert!(cap.caller_original_package_id == binding.original_package_id,
        ERuntimeCallerCapMismatch);
    assert!(cap.caller_callable_package_id == binding.callable_package_id,
        ERuntimeCallerCapMismatch);
    assert!(&cap.call_cap_set_commitment
        == &replacement.call_cap_set_commitment,
        ERuntimeCallerCapMismatch);
    let expected = derive_runtime_caller_cap_commitment(
        expected_role, object::id(catalog), object::id(replacement),
        replacement.package_tuple_commitment,
        binding.original_package_id, binding.callable_package_id,
        replacement.call_cap_set_commitment);
    assert!(&expected == &cap.cap_commitment, ERuntimeCallerCapMismatch);
}

fun take_call_cap<Role>(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
    role: u8,
): PackageCallCapV8<Role> {
    assert!(role < SETUP_CAP_COUNT, ESetupWitnessMismatch);
    protocol::assert_protocol_admin_v8(config, admin);
    assert_catalog_current_v8(config, catalog);
    assert!(catalog.next_setup_role == role, ECallCapAlreadyTaken);
    assert!(catalog.role_config_ids.length() == role as u64
        && catalog.role_config_commitments.length() == role as u64,
        ESetupInstallMismatch);
    catalog.next_setup_role = role + 1;
    PackageCallCapV8<Role> {
        role: role + 1,
        schema_revision: SCHEMA_REVISION,
        catalog_id: object::id(catalog),
        package_tuple_commitment: catalog.binding.commitment,
        call_cap_set_commitment: catalog.call_cap_set_commitment,
        role_authority_id: catalog.authority_ids[role as u64],
        role_binding_commitment:
            catalog.binding.bindings[(role + 1) as u64].commitment,
    }
}

fun consume_call_cap<Role, Witness: drop>(
    catalog: &mut ProductReleaseCatalogV8,
    cap: PackageCallCapV8<Role>,
    witness: Witness,
    role: u8,
    expected_module: vector<u8>,
    expected_datatype: vector<u8>,
    config_id: ID,
    finalized: bool,
    seal_policy_commitment: Option<vector<u8>>,
    key_server_set_commitment: Option<vector<u8>>,
    encryption_policy_commitment: Option<vector<u8>>,
    external_validator_policy_id: Option<ID>,
    external_validator_registry_id: Option<ID>,
    soul_binding_registry_id: Option<ID>,
    runtime_caller_cap_commitment: Option<vector<u8>>,
    bootstrap_certificate_id: Option<ID>,
    bootstrap_certificate_commitment: Option<vector<u8>>,
): vector<u8> {
    assert_catalog_well_formed(catalog);
    assert!(catalog.next_setup_role == role + 1, ECallCapAlreadyTaken);
    assert!(catalog.role_config_ids.length() == role as u64
        && catalog.role_config_commitments.length() == role as u64,
        ESetupInstallMismatch);
    assert!(config_id != object::id(catalog), ESetupInstallMismatch);
    let binding = &catalog.binding.bindings[(role + 1) as u64];
    assert_exact_witness_type_v2<Witness>(
        binding, &expected_module, &expected_datatype);
    let PackageCallCapV8<Role> {
        role: cap_role,
        schema_revision,
        catalog_id,
        package_tuple_commitment,
        call_cap_set_commitment,
        role_authority_id,
        role_binding_commitment,
    } = cap;
    assert!(cap_role == role + 1 && schema_revision == SCHEMA_REVISION,
        ESetupWitnessMismatch);
    assert!(catalog_id == object::id(catalog)
        && package_tuple_commitment == catalog.binding.commitment
        && call_cap_set_commitment == catalog.call_cap_set_commitment
        && role_authority_id == catalog.authority_ids[role as u64]
        && role_binding_commitment == binding.commitment,
        ESetupWitnessMismatch);
    let mut prior = 0;
    while (prior < catalog.role_config_ids.length()) {
        assert!(catalog.role_config_ids[prior] != config_id,
            ESetupInstallMismatch);
        prior = prior + 1;
    };
    let _ = witness;
    let config_commitment = derive_role_config_commitment(
        role + 1,
        config_id,
        object::id(catalog),
        catalog.binding.commitment,
        catalog.call_cap_set_commitment,
        catalog.authority_ids[role as u64],
        finalized,
        seal_policy_commitment,
        key_server_set_commitment,
        encryption_policy_commitment,
        external_validator_policy_id,
        external_validator_registry_id,
        soul_binding_registry_id,
        runtime_caller_cap_commitment,
        bootstrap_certificate_id,
        bootstrap_certificate_commitment,
    );
    catalog.role_config_ids.push_back(config_id);
    catalog.role_config_commitments.push_back(copy config_commitment);
    config_commitment
}

fun derive_role_config_commitment(
    role: u8,
    config_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    authority_id: ID,
    finalized: bool,
    seal_policy_commitment: Option<vector<u8>>,
    key_server_set_commitment: Option<vector<u8>>,
    encryption_policy_commitment: Option<vector<u8>>,
    external_validator_policy_id: Option<ID>,
    external_validator_registry_id: Option<ID>,
    soul_binding_registry_id: Option<ID>,
    runtime_caller_cap_commitment: Option<vector<u8>>,
    bootstrap_certificate_id: Option<ID>,
    bootstrap_certificate_commitment: Option<vector<u8>>,
): vector<u8> {
    assert!(role >= ROLE_SEAL && role <= ROLE_RELEASE,
        ESetupInstallMismatch);
    assert_hash(&package_tuple_commitment);
    assert_hash(&call_cap_set_commitment);
    assert_optional_hash(&seal_policy_commitment);
    assert_optional_hash(&key_server_set_commitment);
    assert_optional_hash(&encryption_policy_commitment);
    assert_optional_hash(&runtime_caller_cap_commitment);
    assert_optional_hash(&bootstrap_certificate_commitment);
    hash::sha2_256(bcs::to_bytes(&RoleConfigCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/package/role-config/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        role,
        config_id,
        catalog_id,
        package_tuple_commitment,
        call_cap_set_commitment,
        authority_id,
        finalized,
        seal_policy_commitment,
        key_server_set_commitment,
        encryption_policy_commitment,
        external_validator_policy_id,
        external_validator_registry_id,
        soul_binding_registry_id,
        runtime_caller_cap_commitment,
        bootstrap_certificate_id,
        bootstrap_certificate_commitment,
    }))
}

fun new_exact_package_binding<OriginalMarker, CallableMarker>(
    role: u8,
    commitments: PackageCommitmentsV8,
): ExactPackageBindingV8 {
    assert!(type_name::original_id<OriginalMarker>()
        == type_name::original_id<CallableMarker>(), ETypeOriginMismatch);
    new_binding(
        role,
        object::id_from_address(type_name::original_id<OriginalMarker>()),
        object::id_from_address(type_name::defining_id<CallableMarker>()),
        commitments,
    )
}

fun new_binding(
    role: u8,
    original_package_id: ID,
    callable_package_id: ID,
    commitments: PackageCommitmentsV8,
): ExactPackageBindingV8 {
    let PackageCommitmentsV8 {
        source_commitment, package_commitment, abi_commitment,
    } = commitments;
    assert_hash(&source_commitment);
    assert_hash(&package_commitment);
    assert_hash(&abi_commitment);
    let commitment = hash::sha2_256(bcs::to_bytes(&ExactPackageBindingInputV2 {
        domain: b"animacraft-fresh-v8/package/exact-binding/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        role,
        original_package_id,
        callable_package_id,
        source_commitment,
        package_commitment,
        abi_commitment,
    }));
    ExactPackageBindingV8 {
        original_package_id,
        callable_package_id,
        source_commitment,
        package_commitment,
        abi_commitment,
        commitment,
    }
}

fun derive_call_cap_set_commitment(
    catalog_id: ID,
    bindings: &vector<ExactPackageBindingV8>,
    authorities: &vector<ID>,
): vector<u8> {
    assert!(bindings.length() == 7, ECatalogCommitmentMismatch);
    assert!(authorities.length() == 6, ECatalogCommitmentMismatch);
    hash::sha2_256(bcs::to_bytes(&PackageCallCapSetCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/package/call-cap-set/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        catalog_id,
        core_binding_commitment: bindings[ROLE_CORE as u64].commitment,
        seal_binding_commitment: bindings[ROLE_SEAL as u64].commitment,
        runtime_binding_commitment: bindings[ROLE_RUNTIME as u64].commitment,
        output_binding_commitment: bindings[ROLE_OUTPUT as u64].commitment,
        physical_binding_commitment: bindings[ROLE_PHYSICAL as u64].commitment,
        market_binding_commitment: bindings[ROLE_MARKET as u64].commitment,
        release_binding_commitment: bindings[ROLE_RELEASE as u64].commitment,
        seal_authority_id: authorities[CAP_SEAL as u64],
        runtime_authority_id: authorities[CAP_RUNTIME as u64],
        output_authority_id: authorities[CAP_OUTPUT as u64],
        physical_authority_id: authorities[CAP_PHYSICAL as u64],
        market_authority_id: authorities[CAP_MARKET as u64],
        release_authority_id: authorities[CAP_RELEASE as u64],
    }))
}

fun derive_tuple_commitment(
    catalog_id: ID,
    bindings: &vector<ExactPackageBindingV8>,
    call_cap_set_commitment: vector<u8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&PackageTupleInputV2 {
        domain: b"animacraft-fresh-v8/package/product-tuple/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        catalog_id,
        native_capability_mask: NATIVE_CAPABILITY_MASK,
        call_cap_set_commitment,
        core_binding: bindings[ROLE_CORE as u64].commitment,
        seal_binding: bindings[ROLE_SEAL as u64].commitment,
        runtime_binding: bindings[ROLE_RUNTIME as u64].commitment,
        output_binding: bindings[ROLE_OUTPUT as u64].commitment,
        physical_binding: bindings[ROLE_PHYSICAL as u64].commitment,
        market_binding: bindings[ROLE_MARKET as u64].commitment,
        release_binding: bindings[ROLE_RELEASE as u64].commitment,
    }))
}

fun derive_catalog_commitment(
    catalog_id: ID,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    authorities: &vector<ID>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&CatalogCommitmentInputV2 {
        domain: b"animacraft-fresh-v8/core/catalog/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        catalog_id,
        protocol_config_id,
        protocol_config_revision,
        protocol_config_commitment,
        package_tuple_commitment,
        call_cap_set_commitment,
        native_capability_mask: NATIVE_CAPABILITY_MASK,
        seal_authority_id: authorities[CAP_SEAL as u64],
        runtime_authority_id: authorities[CAP_RUNTIME as u64],
        output_authority_id: authorities[CAP_OUTPUT as u64],
        physical_authority_id: authorities[CAP_PHYSICAL as u64],
        market_authority_id: authorities[CAP_MARKET as u64],
        release_authority_id: authorities[CAP_RELEASE as u64],
    }))
}

fun replacement_input_from_catalog(
    catalog: &ProductReleaseCatalogV8,
    runtime_config_id: ID,
    output_config_id: ID,
    market_config_id: ID,
    release_config_id: ID,
): FreshTupleReplacementBindingInputV2 {
    FreshTupleReplacementBindingInputV2 {
        core_binding_commitment:
            catalog.binding.bindings[ROLE_CORE as u64].commitment,
        seal_binding_commitment:
            catalog.binding.bindings[ROLE_SEAL as u64].commitment,
        runtime_binding_commitment:
            catalog.binding.bindings[ROLE_RUNTIME as u64].commitment,
        output_binding_commitment:
            catalog.binding.bindings[ROLE_OUTPUT as u64].commitment,
        physical_binding_commitment:
            catalog.binding.bindings[ROLE_PHYSICAL as u64].commitment,
        market_binding_commitment:
            catalog.binding.bindings[ROLE_MARKET as u64].commitment,
        release_binding_commitment:
            catalog.binding.bindings[ROLE_RELEASE as u64].commitment,
        package_tuple_commitment: catalog.binding.commitment,
        call_cap_set_commitment: catalog.call_cap_set_commitment,
        runtime_config_id,
        output_config_id,
        market_config_id,
        release_config_id,
    }
}

fun assert_replacement_input(
    catalog: &ProductReleaseCatalogV8,
    input: &FreshTupleReplacementBindingInputV2,
) {
    let expected = replacement_input_from_catalog(
        catalog,
        catalog.role_config_ids[CAP_RUNTIME as u64],
        catalog.role_config_ids[CAP_OUTPUT as u64],
        catalog.role_config_ids[CAP_MARKET as u64],
        catalog.role_config_ids[CAP_RELEASE as u64],
    );
    assert!(input == &expected, EReplacementMismatch);
}

fun derive_replacement_binding_commitment(
    binding_id: ID,
    catalog_id: ID,
    input: &FreshTupleReplacementBindingInputV2,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(
        &FreshTupleReplacementBindingCommitmentInputV2 {
            domain: b"animacraft-fresh-v8/core/fresh-tuple-replacement-binding/v2"
                .to_string(),
            schema_revision: SCHEMA_REVISION,
            binding_id,
            catalog_id,
            core_binding_commitment: input.core_binding_commitment,
            seal_binding_commitment: input.seal_binding_commitment,
            runtime_binding_commitment: input.runtime_binding_commitment,
            output_binding_commitment: input.output_binding_commitment,
            physical_binding_commitment: input.physical_binding_commitment,
            market_binding_commitment: input.market_binding_commitment,
            release_binding_commitment: input.release_binding_commitment,
            package_tuple_commitment: input.package_tuple_commitment,
            call_cap_set_commitment: input.call_cap_set_commitment,
            runtime_config_id: input.runtime_config_id,
            output_config_id: input.output_config_id,
            market_config_id: input.market_config_id,
            release_config_id: input.release_config_id,
        }))
}

fun derive_bootstrap_admin_commitment(
    admin: &FreshTupleBootstrapAdminV2,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(
        &FreshTupleBootstrapAdminCommitmentInputV2 {
            domain: b"animacraft-fresh-v8/core/fresh-tuple-bootstrap-admin/v2"
                .to_string(),
            schema_revision: SCHEMA_REVISION,
            admin_id: object::id(admin),
            protocol_admin_id: admin.protocol_admin_id,
            replacement_binding_id: admin.replacement_binding_id,
            catalog_id: admin.catalog_id,
            package_tuple_commitment: admin.package_tuple_commitment,
            call_cap_set_commitment: admin.call_cap_set_commitment,
            caps_minted: admin.caps_minted,
            install_mask: admin.install_mask,
            ordered_install_mark_commitments: admin.install_mark_commitments,
        }))
}

fun derive_bootstrap_certificate_commitment(
    certificate_id: ID,
    replacement_binding_id: ID,
    catalog_id: ID,
    package_tuple_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    install_mask: u8,
    ordered_install_mark_commitments: vector<vector<u8>>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(
        &FreshTupleBootstrapCertificateCommitmentInputV2 {
            domain: b"animacraft-fresh-v8/core/fresh-tuple-bootstrap-certificate/v2"
                .to_string(),
            schema_revision: SCHEMA_REVISION,
            certificate_id,
            replacement_binding_id,
            catalog_id,
            package_tuple_commitment,
            call_cap_set_commitment,
            install_mask,
            ordered_install_mark_commitments,
        }))
}

fun new_runtime_caller_cap(
    role: u8,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
    caller_binding: &ExactPackageBindingV8,
): RuntimeCallerCapV1 {
    let cap_commitment = derive_runtime_caller_cap_commitment(
        role, object::id(catalog), object::id(replacement),
        replacement.package_tuple_commitment,
        caller_binding.original_package_id,
        caller_binding.callable_package_id,
        replacement.call_cap_set_commitment);
    RuntimeCallerCapV1 {
        schema_revision: SCHEMA_REVISION,
        role,
        catalog_id: object::id(catalog),
        replacement_binding_id: object::id(replacement),
        package_tuple_commitment: replacement.package_tuple_commitment,
        caller_original_package_id: caller_binding.original_package_id,
        caller_callable_package_id: caller_binding.callable_package_id,
        call_cap_set_commitment: replacement.call_cap_set_commitment,
        cap_commitment,
    }
}

fun derive_runtime_caller_cap_commitment(
    role: u8,
    catalog_id: ID,
    replacement_binding_id: ID,
    package_tuple_commitment: vector<u8>,
    caller_original_package_id: ID,
    caller_callable_package_id: ID,
    call_cap_set_commitment: vector<u8>,
): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&RuntimeCallerCapCommitmentInputV1 {
        domain: b"animacraft-fresh-v8/core/runtime-caller-cap/v1".to_string(),
        schema_revision: SCHEMA_REVISION,
        role,
        catalog_id,
        replacement_binding_id,
        package_tuple_commitment,
        caller_original_package_id,
        caller_callable_package_id,
        call_cap_set_commitment,
    }))
}

fun install_witness_rule(
    replacement: &FreshTupleReplacementBindingV2,
    install_kind: u8,
): (u8, u8, ID, vector<u8>, vector<u8>) {
    if (install_kind == INSTALL_OUTPUT_CALLER_CAP) {
        (ROLE_OUTPUT, 0,
            replacement.output_config_id,
            b"output_v8", b"OutputRuntimeCallerCapInstallWitnessV2")
    } else {
        assert!(install_kind == INSTALL_MARKET_CALLER_CAP,
            EBootstrapInstallMismatch);
        (ROLE_MARKET,
            INSTALL_OUTPUT_CALLER_CAP,
            replacement.market_config_id,
            b"market_v8", b"MarketRuntimeCallerCapInstallWitnessV2")
    }
}

fun assert_bootstrap_admin(
    admin: &FreshTupleBootstrapAdminV2,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
) {
    assert!(admin.version == SCHEMA_REVISION, EBootstrapAdminMismatch);
    assert!(admin.replacement_binding_id == object::id(replacement),
        EBootstrapAdminMismatch);
    assert!(admin.catalog_id == object::id(catalog), EBootstrapAdminMismatch);
    assert!(&admin.package_tuple_commitment
        == &replacement.package_tuple_commitment, EBootstrapAdminMismatch);
    assert!(&admin.call_cap_set_commitment
        == &replacement.call_cap_set_commitment, EBootstrapAdminMismatch);
    assert!(&derive_bootstrap_admin_commitment(admin)
        == &admin.bootstrap_commitment, EBootstrapAdminMismatch);
}

fun assert_bootstrap_slot_admin(
    catalog: &ProductReleaseCatalogV8,
    admin: &FreshTupleBootstrapAdminV2,
) {
    let slot = dynamic_field::borrow<FreshTupleBootstrapSlotKeyV2,
        FreshTupleBootstrapSlotV2>(&catalog.id, FreshTupleBootstrapSlotKeyV2 {});
    assert!(slot.state == BOOTSTRAP_IN_PROGRESS,
        EBootstrapStateMismatch);
    assert!(slot.replacement_binding_id == admin.replacement_binding_id,
        EReplacementMismatch);
    assert!(slot.admin_id.is_some()
        && *slot.admin_id.borrow() == object::id(admin),
        EBootstrapAdminMismatch);
    assert!(slot.certificate_id.is_none(), EBootstrapStateMismatch);
}

public fun assert_bootstrap_certificate_v2(
    certificate: &FreshTupleBootstrapCertificateV2,
    replacement: &FreshTupleReplacementBindingV2,
    catalog: &ProductReleaseCatalogV8,
) {
    assert!(certificate.version == SCHEMA_REVISION,
        EBootstrapStateMismatch);
    assert!(certificate.replacement_binding_id == object::id(replacement),
        EReplacementMismatch);
    assert!(certificate.catalog_id == object::id(catalog),
        EReplacementMismatch);
    assert!(&certificate.package_tuple_commitment
        == &replacement.package_tuple_commitment, EReplacementMismatch);
    assert!(&certificate.call_cap_set_commitment
        == &replacement.call_cap_set_commitment, EReplacementMismatch);
    assert!(certificate.install_mask == INSTALL_COMPLETE_MASK,
        EBootstrapInstallMismatch);
    assert!(certificate.install_mark_commitments.length() == 2,
        EBootstrapInstallMismatch);
    let expected = derive_bootstrap_certificate_commitment(
        object::id(certificate), certificate.replacement_binding_id,
        certificate.catalog_id, certificate.package_tuple_commitment,
        certificate.call_cap_set_commitment, certificate.install_mask,
        certificate.install_mark_commitments);
    assert!(&expected == &certificate.certificate_commitment,
        EBootstrapStateMismatch);
    let slot = dynamic_field::borrow<FreshTupleBootstrapSlotKeyV2,
        FreshTupleBootstrapSlotV2>(&catalog.id, FreshTupleBootstrapSlotKeyV2 {});
    assert!(slot.state == BOOTSTRAP_CERTIFIED,
        EBootstrapStateMismatch);
    assert!(slot.certificate_id.is_some()
        && *slot.certificate_id.borrow() == object::id(certificate),
        EBootstrapStateMismatch);
    assert!(slot.certificate_commitment.is_some()
        && slot.certificate_commitment.borrow()
            == &certificate.certificate_commitment,
        EBootstrapStateMismatch);
}

fun assert_catalog_well_formed(catalog: &ProductReleaseCatalogV8) {
    assert!(catalog.schema_revision == SCHEMA_REVISION,
        ECatalogCommitmentMismatch);
    assert!(catalog.authority_ids.length() == 6,
        ECatalogCommitmentMismatch);
    assert_product_release_binding_well_formed_v8(
        object::id(catalog), &catalog.binding, &catalog.call_cap_set_commitment);
    let expected_caps = derive_call_cap_set_commitment(
        object::id(catalog), &catalog.binding.bindings, &catalog.authority_ids);
    assert!(&expected_caps == &catalog.call_cap_set_commitment,
        ECatalogCommitmentMismatch);
    let expected_catalog = derive_catalog_commitment(
        object::id(catalog),
        catalog.protocol_config_id,
        catalog.protocol_config_revision,
        catalog.protocol_config_commitment,
        catalog.binding.commitment,
        catalog.call_cap_set_commitment,
        &catalog.authority_ids,
    );
    assert!(&expected_catalog == &catalog.catalog_commitment,
        ECatalogCommitmentMismatch);
    assert!(catalog.next_setup_role <= SETUP_CAP_COUNT,
        ESetupInstallMismatch);
    let installed = catalog.role_config_ids.length();
    assert!(installed == catalog.role_config_commitments.length()
        && installed <= catalog.next_setup_role as u64
        && catalog.next_setup_role as u64 <= installed + 1,
        ESetupInstallMismatch);
    let mut role = 0;
    while (role < installed) {
        assert_hash(&catalog.role_config_commitments[role]);
        let mut prior = 0;
        while (prior < role) {
            assert!(catalog.role_config_ids[prior]
                != catalog.role_config_ids[role], ESetupInstallMismatch);
            prior = prior + 1;
        };
        role = role + 1;
    };
}

fun assert_binding_well_formed(role: u8, binding: &ExactPackageBindingV8) {
    let expected = hash::sha2_256(bcs::to_bytes(&ExactPackageBindingInputV2 {
        domain: b"animacraft-fresh-v8/package/exact-binding/v2".to_string(),
        schema_revision: SCHEMA_REVISION,
        role,
        original_package_id: binding.original_package_id,
        callable_package_id: binding.callable_package_id,
        source_commitment: binding.source_commitment,
        package_commitment: binding.package_commitment,
        abi_commitment: binding.abi_commitment,
    }));
    assert!(&expected == &binding.commitment, EInvalidCommitment);
}

fun assert_distinct_bindings(bindings: &vector<ExactPackageBindingV8>) {
    assert!(bindings.length() == 7, ERoleCollision);
    let mut left = 0;
    while (left < 7) {
        let mut right = left + 1;
        while (right < 7) {
            assert!(bindings[left].original_package_id
                != bindings[right].original_package_id, ERoleCollision);
            assert!(bindings[left].callable_package_id
                != bindings[right].callable_package_id, ERoleCollision);
            right = right + 1;
        };
        left = left + 1;
    };
}

fun fresh_authority_id(ctx: &mut TxContext): ID {
    let uid = object::new(ctx);
    let id = uid.to_inner();
    uid.delete();
    id
}

fun assert_hash(value: &vector<u8>) {
    assert!(protocol::is_nonzero_hash_v2(value), EInvalidCommitment);
}

fun assert_optional_hash(value: &Option<vector<u8>>) {
    if (value.is_some()) assert_hash(value.borrow());
}

public fun catalog_id_v8(catalog: &ProductReleaseCatalogV8): ID {
    object::id(catalog)
}
public(package) fun catalog_uid_v2(
    catalog: &ProductReleaseCatalogV8,
): &UID { &catalog.id }
public(package) fun catalog_uid_mut_v2(
    catalog: &mut ProductReleaseCatalogV8,
): &mut UID { &mut catalog.id }
/// Compact complete read views replace the former per-field getter surface.
public fun catalog_terms_v2(
    catalog: &ProductReleaseCatalogV8,
): (ID, u64, &vector<u8>, &ProductReleaseBindingV8, &vector<u8>, &vector<u8>) {
    (
        catalog.protocol_config_id,
        catalog.protocol_config_revision,
        &catalog.protocol_config_commitment,
        &catalog.binding,
        &catalog.call_cap_set_commitment,
        &catalog.catalog_commitment,
    )
}
public fun catalog_binding_v8(
    catalog: &ProductReleaseCatalogV8,
): &ProductReleaseBindingV8 { &catalog.binding }
public fun product_binding_commitment_v8(
    binding: &ProductReleaseBindingV8,
): &vector<u8> { &binding.commitment }
public fun binding_at_v2(
    binding: &ProductReleaseBindingV8,
    role: u8,
): &ExactPackageBindingV8 {
    assert!(role <= ROLE_RELEASE, ESetupWitnessMismatch);
    &binding.bindings[role as u64]
}
public fun exact_binding_terms_v2(
    binding: &ExactPackageBindingV8,
): (ID, ID, &vector<u8>, &vector<u8>, &vector<u8>, &vector<u8>) {
    (
        binding.original_package_id,
        binding.callable_package_id,
        &binding.source_commitment,
        &binding.package_commitment,
        &binding.abi_commitment,
        &binding.commitment,
    )
}
public fun catalog_authority_id_v2(
    catalog: &ProductReleaseCatalogV8,
    role: u8,
): ID {
    assert!(role < SETUP_CAP_COUNT, ESetupInstallMismatch);
    catalog.authority_ids[role as u64]
}
#[test_only]
public fun destroy_catalog_for_testing(catalog: ProductReleaseCatalogV8) {
    let ProductReleaseCatalogV8 {
        id, schema_revision: _, protocol_config_id: _,
        protocol_config_revision: _, protocol_config_commitment: _, binding: _,
        authority_ids: _, call_cap_set_commitment: _, catalog_commitment: _,
        next_setup_role: _, role_config_ids: _, role_config_commitments: _,
    } = catalog;
    id.delete();
}

#[test_only]
public fun destroy_call_cap_for_testing<Role>(cap: PackageCallCapV8<Role>) {
    let PackageCallCapV8<Role> {
        role: _, schema_revision: _, catalog_id: _,
        package_tuple_commitment: _, call_cap_set_commitment: _,
        role_authority_id: _, role_binding_commitment: _,
    } = cap;
}

#[test_only]
fun test_hash(byte: u8): vector<u8> {
    let mut result = vector[];
    let mut index = 0;
    while (index < HASH_LENGTH) {
        result.push_back(byte);
        index = index + 1;
    };
    result
}

#[test_only]
public fun test_commitments_v8(byte: u8): PackageCommitmentsV8 {
    new_package_commitments_v8(test_hash(byte), test_hash(byte + 1), test_hash(byte + 2))
}

/// One canonical test fixture constructor. It preserves the production V2
/// commitments and single-container layout while allowing packages absent
/// from Core/Seal's acyclic test graph to use isolated synthetic IDs.
#[test_only]
public fun product_release_catalog_for_testing(
    config: &ProtocolConfigV8,
    core_original: address,
    core_callable: address,
    seal_original: address,
    seal_callable: address,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    product_release_catalog_at_addresses_for_testing(config,
        vector[core_original, seal_original, @0x12, @0x13, @0x14, @0x15, @0x16],
        vector[core_callable, seal_callable, @0x22, @0x23, @0x24, @0x25, @0x26], ctx)
}

/// Exact isolated VM module identities, with the same canonical catalog
/// commitments. Setup and caller caps must still use the production APIs.
#[test_only]
public fun product_release_catalog_at_addresses_for_testing(
    config: &ProtocolConfigV8, originals: vector<address>, callables: vector<address>,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    assert!(originals.length() == 7 && callables.length() == 7, ERoleCollision);
    let bindings = vector[
        new_binding(ROLE_CORE, object::id_from_address(originals[0]),
            object::id_from_address(callables[0]), test_commitments_v8(1)),
        new_binding(ROLE_SEAL, object::id_from_address(originals[1]),
            object::id_from_address(callables[1]), test_commitments_v8(4)),
        new_binding(ROLE_RUNTIME, object::id_from_address(originals[2]),
            object::id_from_address(callables[2]), test_commitments_v8(7)),
        new_binding(ROLE_OUTPUT, object::id_from_address(originals[3]),
            object::id_from_address(callables[3]), test_commitments_v8(10)),
        new_binding(ROLE_PHYSICAL, object::id_from_address(originals[4]),
            object::id_from_address(callables[4]), test_commitments_v8(13)),
        new_binding(ROLE_MARKET, object::id_from_address(originals[5]),
            object::id_from_address(callables[5]), test_commitments_v8(16)),
        new_binding(ROLE_RELEASE, object::id_from_address(originals[6]),
            object::id_from_address(callables[6]), test_commitments_v8(19)),
    ];
    assert_distinct_bindings(&bindings);
    let uid = object::new(ctx);
    let catalog_id = uid.to_inner();
    let authority_ids = vector[
        fresh_authority_id(ctx), fresh_authority_id(ctx),
        fresh_authority_id(ctx), fresh_authority_id(ctx),
        fresh_authority_id(ctx), fresh_authority_id(ctx),
    ];
    let call_cap_set_commitment = derive_call_cap_set_commitment(
        catalog_id, &bindings, &authority_ids);
    let tuple = derive_tuple_commitment(catalog_id, &bindings,
        call_cap_set_commitment);
    let protocol_config_id = protocol::config_id_v8(config);
    let protocol_config_revision = protocol::config_revision_v8(config);
    let protocol_config_commitment = *protocol::config_commitment_v8(config);
    let catalog_commitment = derive_catalog_commitment(
        catalog_id, protocol_config_id, protocol_config_revision,
        protocol_config_commitment, tuple, call_cap_set_commitment,
        &authority_ids);
    ProductReleaseCatalogV8 {
        id: uid, schema_revision: SCHEMA_REVISION, protocol_config_id,
        protocol_config_revision, protocol_config_commitment,
        binding: ProductReleaseBindingV8 { bindings, commitment: tuple },
        authority_ids, call_cap_set_commitment, catalog_commitment,
        next_setup_role: CAP_SEAL, role_config_ids: vector[],
        role_config_commitments: vector[],
    }
}

#[test_only]
fun mark_setup_for_testing(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
    role: u8,
    ctx: &mut TxContext,
) {
    protocol::assert_protocol_admin_v8(config, admin);
    assert_catalog_current_v8(config, catalog);
    raw_mark_setup_for_testing(catalog, role, ctx);
}

#[test_only]
fun raw_mark_setup_for_testing(
    catalog: &mut ProductReleaseCatalogV8,
    role: u8,
    ctx: &mut TxContext,
) {
    assert!(catalog.next_setup_role == role, ECallCapAlreadyTaken);
    assert!(catalog.role_config_ids.length() == role as u64
        && catalog.role_config_commitments.length() == role as u64,
        ESetupInstallMismatch);
    let config_uid = object::new(ctx);
    let config_id = config_uid.to_inner();
    config_uid.delete();
    catalog.next_setup_role = role + 1;
    catalog.role_config_ids.push_back(config_id);
    catalog.role_config_commitments.push_back(test_hash(100 + role));
}

#[test_only]
public fun complete_catalog_setup_for_testing(
    catalog: &mut ProductReleaseCatalogV8,
    ctx: &mut TxContext,
) {
    while (catalog.next_setup_role < SETUP_CAP_COUNT) {
        let role = catalog.next_setup_role;
        raw_mark_setup_for_testing(catalog, role, ctx);
    };
    assert_catalog_setup_complete_v2(catalog);
}

#[test]
fun catalog_tuple_and_cap_set_have_single_v2_source() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 1, 0, 0, 0);
    let (config, admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = new_test_catalog(&config, &admin, &mut ctx);
    assert_catalog_current_v8(&config, &catalog);
    assert!(catalog.binding.bindings.length() == 7, ERoleCollision);
    assert!(catalog.authority_ids.length() == 6, ERoleCollision);
    mark_setup_for_testing(&config, &admin, &mut catalog, CAP_SEAL, &mut ctx);
    assert!(catalog.role_config_ids.length() == 1
        && catalog.role_config_commitments.length() == 1,
        ESetupInstallMismatch);
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test_only]
public struct TestGenericObject<phantom Coin> has drop {}
#[test_only]
public struct TestExactWitness has drop {}
#[test_only]
public struct TestPairObject<phantom First, phantom Second> has drop {}

#[test_only]
fun generic_object_binding(): ExactPackageBindingV8 {
    new_exact_package_binding<TestGenericObject<u64>, TestGenericObject<u64>>(
        ROLE_MARKET, new_package_commitments_v8(test_hash(1), test_hash(2), test_hash(3)))
}

#[test]
fun exact_generic_object_type_accepts_fixed_payment_argument() {
    assert_exact_single_argument_type_v2<TestGenericObject<u64>, u64>(
        &generic_object_binding(), &b"package_binding_v8", &b"TestGenericObject");
}

#[test]
fun exact_witness_type_accepts_vm_canonical_address_shape() {
    assert_exact_witness_type_v2<TestExactWitness>(
        &generic_object_binding(), &b"package_binding_v8", &b"TestExactWitness");
}

#[test, expected_failure(abort_code = ESetupWitnessMismatch)]
fun exact_witness_type_rejects_generic_object() {
    assert_exact_witness_type_v2<TestGenericObject<u64>>(
        &generic_object_binding(), &b"package_binding_v8", &b"TestGenericObject");
}

#[test, expected_failure(abort_code = ESetupWitnessMismatch)]
fun exact_generic_object_type_rejects_different_payment_argument() {
    assert_exact_single_argument_type_v2<TestGenericObject<u32>, u64>(
        &generic_object_binding(), &b"package_binding_v8", &b"TestGenericObject");
}

#[test, expected_failure(abort_code = ESetupWitnessMismatch)]
fun exact_generic_object_type_rejects_two_arguments() {
    assert_exact_single_argument_type_v2<TestPairObject<u64, u64>, u64>(
        &generic_object_binding(), &b"package_binding_v8", &b"TestPairObject");
}

#[test, expected_failure(abort_code = ESetupWitnessMismatch)]
fun exact_generic_object_type_rejects_different_datatype() {
    assert_exact_single_argument_type_v2<TestGenericObject<u64>, u64>(
        &generic_object_binding(), &b"package_binding_v8", &b"TestGenericObjecT");
}

#[test, expected_failure(abort_code = ECallCapAlreadyTaken)]
fun setup_cap_cannot_be_taken_out_of_order() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 2, 0, 0, 0);
    let (config, admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = new_test_catalog(&config, &admin, &mut ctx);
    let cap = take_runtime_call_cap_v8(&config, &admin, &mut catalog);
    destroy_call_cap_for_testing(cap);
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test_only]
fun check_installed_config_for_testing(mode: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 81, 0, 0, 0);
    let (config, admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = new_test_catalog(&config, &admin, &mut ctx);
    complete_catalog_setup_for_testing(&mut catalog, &mut ctx);
    let role = if (mode == 1) ROLE_CORE else ROLE_RUNTIME;
    let config_id = catalog.role_config_ids[if (mode == 2) 2 else 1];
    let commitment = if (mode == 3) test_hash(250)
        else catalog.role_config_commitments[1];
    assert_role_config_installation_v2(&catalog, role, config_id, &commitment);
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun installed_config_matches_exact_role_id_and_commitment() {
    check_installed_config_for_testing(0);
}

#[test, expected_failure(abort_code = ESetupInstallMismatch)]
fun installed_config_rejects_core_role() {
    check_installed_config_for_testing(1);
}

#[test, expected_failure(abort_code = ESetupInstallMismatch)]
fun installed_config_rejects_other_config_id() {
    check_installed_config_for_testing(2);
}

#[test, expected_failure(abort_code = ESetupInstallMismatch)]
fun installed_config_rejects_other_commitment() {
    check_installed_config_for_testing(3);
}

#[test, expected_failure(abort_code = ESetupInstallMismatch)]
fun next_setup_cap_waits_for_prior_config_install() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 3, 0, 0, 0);
    let (config, admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = new_test_catalog(&config, &admin, &mut ctx);
    let seal = take_seal_call_cap_v8(&config, &admin, &mut catalog);
    let runtime = take_runtime_call_cap_v8(&config, &admin, &mut catalog);
    destroy_call_cap_for_testing(seal);
    destroy_call_cap_for_testing(runtime);
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test, expected_failure(abort_code = ECallCapAlreadyTaken)]
fun setup_cap_cannot_be_taken_twice() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 4, 0, 0, 0);
    let (config, admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = new_test_catalog(&config, &admin, &mut ctx);
    let first = take_seal_call_cap_v8(&config, &admin, &mut catalog);
    let second = take_seal_call_cap_v8(&config, &admin, &mut catalog);
    destroy_call_cap_for_testing(first);
    destroy_call_cap_for_testing(second);
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test, expected_failure(abort_code = ECallCapsNotInstalled)]
fun catalog_cannot_be_shared_before_every_config_install() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 5, 0, 0, 0);
    let (config, admin) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let catalog = new_test_catalog(&config, &admin, &mut ctx);
    share_product_release_catalog_v8(catalog);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test_only]
fun new_test_catalog(
    config: &ProtocolConfigV8,
    _admin: &ProtocolAdminCapV8,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    product_release_catalog_for_testing(
        config,
        protocol::config_core_original_package_id_v8(config).to_address(),
        protocol::config_core_callable_package_id_v8(config).to_address(),
        @0x11,
        @0x21,
        ctx,
    )
}

#[test_only]
public fun bootstrap_config_ids_for_testing(catalog: &ProductReleaseCatalogV8): (ID, ID, ID, ID) {
    (catalog.role_config_ids[1], catalog.role_config_ids[2],
        catalog.role_config_ids[4], catalog.role_config_ids[5])
}

/// Read actual bootstrap identities for cross-package VM fixtures. No object
/// creation, capability fabrication, or state transition is available here.
#[test_only]
public fun bootstrap_authority_ids_for_testing(
    catalog: &ProductReleaseCatalogV8,
): (ID, Option<ID>) {
    let slot = dynamic_field::borrow<FreshTupleBootstrapSlotKeyV2, FreshTupleBootstrapSlotV2>(
        &catalog.id, FreshTupleBootstrapSlotKeyV2 {});
    (slot.replacement_binding_id, slot.certificate_id)
}

#[test_only]
public fun bootstrap_certificate_shape_for_testing(certificate: &FreshTupleBootstrapCertificateV2): (u8, u64) {
    (certificate.install_mask, certificate.install_mark_commitments.length())
}

#[test_only]
fun stop_catalog_fixture(mode: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 95, 0, 0, 0);
    let (mut config, admin) = protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = new_test_catalog(&config, &admin, &mut ctx);
    protocol::set_protocol_enabled_v8(&mut config, &admin, false);
    assert!(protocol::config_revision_v8(&config) != catalog.protocol_config_revision, 99);
    if (mode == 1) {
        // New activity still uses the original strict live gate.
        assert_catalog_current_v8(&config, &catalog);
        abort 99
    };
    if (mode == 2) catalog.protocol_config_id = object::id_from_address(@0xBAD);
    assert_catalog_for_stop_v8(&config, &catalog);
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun disabled_revision_still_allows_exact_catalog_stop() { stop_catalog_fixture(0); }

#[test, expected_failure(abort_code = 1, location = animacraft_v8_core::protocol_config_v8)]
fun disabled_revision_does_not_allow_live_catalog_use() { stop_catalog_fixture(1); }

#[test, expected_failure(abort_code = EProtocolCatalogMismatch)]
fun disabled_stop_rejects_wrong_protocol_identity() { stop_catalog_fixture(2); }
