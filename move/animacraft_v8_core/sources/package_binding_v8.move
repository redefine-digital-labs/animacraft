/// Protocol-admin-certified identities for the seven packages that make one
/// Animacraft v8 product release. Package bytes are not introspectable in
/// Move: the three digests are governance-certified facts whose published
/// package bytes must be locked by off-chain readback.
module animacraft_v8_core::package_binding_v8;

use animacraft_v8_core::protocol_config_v8::{
    Self as protocol,
    ProtocolAdminCapV8,
    ProtocolConfigV8,
};
use std::bcs;
use std::hash;
use std::option::{Self as option, Option};
use std::string::String;
use std::type_name;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;
const NATIVE_CAPABILITY_MASK: u64 = 127;

const EInvalidCommitment: u64 = 0;
const ETypeOriginMismatch: u64 = 1;
const EPackageCollision: u64 = 2;
const EBindingCommitmentMismatch: u64 = 3;
const EPackageLineageMismatch: u64 = 4;
const EProtocolCatalogMismatch: u64 = 5;
const ECapabilityMismatch: u64 = 6;
const ECallCapUnavailable: u64 = 8;
const ECallCapMismatch: u64 = 9;
const ECallCapsNotInstalled: u64 = 10;

/// Off-chain evidence committed by the protocol administrator after reading
/// back the published package. Core cannot calculate these bytes on chain.
public struct PackageCommitmentsV8 has copy, drop, store {
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
}

/// One exact package role. Original and callable markers must be in the same
/// package lineage. The callable ID is always the marker's defining ID.
public struct ExactPackageBindingV8 has copy, drop, store {
    original_package_id: ID,
    callable_package_id: ID,
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
    commitment: vector<u8>,
}

/// The exact seven-role tuple. Physical and Market are mandatory native
/// roles, so the capability mask is a fixed 0b1111111 rather than input.
public struct ProductReleaseBindingV8 has copy, drop, store {
    version: u64,
    native_capability_mask: u64,
    core: ExactPackageBindingV8,
    seal: ExactPackageBindingV8,
    runtime: ExactPackageBindingV8,
    output: ExactPackageBindingV8,
    physical: ExactPackageBindingV8,
    market: ExactPackageBindingV8,
    release: ExactPackageBindingV8,
    commitment: vector<u8>,
}

/// One immutable protocol-governed catalog entry. Only a ProtocolAdminCap can
/// create it; a Maker author can select it but cannot certify roles or hashes.
public struct ProductReleaseCatalogV8 has key {
    id: UID,
    version: u64,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    binding: ProductReleaseBindingV8,
    call_cap_set: PackageCallCapSetBindingV8,
    seal_call_cap: Option<PackageCallCapV8<SealRoleV8>>,
    runtime_call_cap: Option<PackageCallCapV8<RuntimeRoleV8>>,
    output_call_cap: Option<PackageCallCapV8<OutputRoleV8>>,
    physical_call_cap: Option<PackageCallCapV8<PhysicalRoleV8>>,
    market_call_cap: Option<PackageCallCapV8<MarketRoleV8>>,
    release_call_cap: Option<PackageCallCapV8<ReleaseRoleV8>>,
}

/// Exact certified tuple copied into a Root. Fields are module-private, so a
/// production caller cannot synthesize a certified snapshot.
public struct CertifiedProductReleaseBindingV8 has copy, drop, store {
    catalog_id: ID,
    protocol_config_id: ID,
    protocol_config_revision: u64,
    protocol_config_commitment: vector<u8>,
    binding: ProductReleaseBindingV8,
    call_cap_set: PackageCallCapSetBindingV8,
}

/// Ephemeral Release-side proof. It intentionally has no abilities.
public struct ReleaseCatalogWitnessV8 {
    certified: CertifiedProductReleaseBindingV8,
}

/// Concrete Core-defined call capabilities. Each has `store` but deliberately
/// lacks copy/drop/key: protocol setup must move it into the corresponding
/// exact companion's private config field. A transaction caller can neither
/// synthesize nor extract a borrowed substitute from that config.
public struct PackageCallCapV8<phantom Role> has store {
    version: u64,
    authority_id: ID,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    role_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
}

public struct PackageCallCapSetBindingV8 has copy, drop, store {
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    seal_authority_id: ID,
    runtime_authority_id: ID,
    output_authority_id: ID,
    physical_authority_id: ID,
    market_authority_id: ID,
    release_authority_id: ID,
    commitment: vector<u8>,
}

public struct SealRoleV8 has drop {}
public struct RuntimeRoleV8 has drop {}
public struct OutputRoleV8 has drop {}
public struct PhysicalRoleV8 has drop {}
public struct MarketRoleV8 has drop {}
public struct ReleaseRoleV8 has drop {}

/// Ephemeral Runtime-side Pack readiness proof. It intentionally has no
/// abilities and binds the immutable Root tuple plus concrete object IDs.
public struct RuntimePackReadinessV8 {
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
}

public struct ExactPackageBindingCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    original_package_id: ID,
    callable_package_id: ID,
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
}

public struct ProductReleaseBindingCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    native_capability_mask: u64,
    core: ExactPackageBindingV8,
    seal: ExactPackageBindingV8,
    runtime: ExactPackageBindingV8,
    output: ExactPackageBindingV8,
    physical: ExactPackageBindingV8,
    market: ExactPackageBindingV8,
    release: ExactPackageBindingV8,
}

public struct PackageCallCapSetCommitmentInputV8 has drop {
    domain: vector<u8>,
    version: u64,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    seal_authority_id: ID,
    runtime_authority_id: ID,
    output_authority_id: ID,
    physical_authority_id: ID,
    market_authority_id: ID,
    release_authority_id: ID,
}

public fun version_v8(): u64 { VERSION }
public fun native_capability_mask_v8(): u64 { NATIVE_CAPABILITY_MASK }

public fun new_package_commitments_v8(
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
): PackageCommitmentsV8 {
    assert_hash(&source_commitment);
    assert_hash(&package_commitment);
    assert_hash(&abi_commitment);
    PackageCommitmentsV8 {
        source_commitment,
        package_commitment,
        abi_commitment,
    }
}

/// Creates the only production ProductRelease catalog path. Every role uses
/// an original marker and an exact-version callable marker from one lineage.
/// It also creates one non-copy/non-drop call capability per companion role.
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
    config: &ProtocolConfigV8,
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
    let core = new_exact_package_binding<CoreOriginalMarker, CoreCallableMarker>(
        core_commitments,
    );
    let seal = new_exact_package_binding<SealOriginalMarker, SealCallableMarker>(
        seal_commitments,
    );
    let runtime = new_exact_package_binding<
        RuntimeOriginalMarker,
        RuntimeCallableMarker,
    >(runtime_commitments);
    let output = new_exact_package_binding<OutputOriginalMarker, OutputCallableMarker>(
        output_commitments,
    );
    let physical = new_exact_package_binding<
        PhysicalOriginalMarker,
        PhysicalCallableMarker,
    >(physical_commitments);
    let market = new_exact_package_binding<MarketOriginalMarker, MarketCallableMarker>(
        market_commitments,
    );
    let release = new_exact_package_binding<
        ReleaseOriginalMarker,
        ReleaseCallableMarker,
    >(release_commitments);
    assert!(
        core.original_package_id
            == protocol::config_core_original_package_id_v8(config),
        EProtocolCatalogMismatch,
    );
    assert!(
        core.callable_package_id
            == protocol::config_core_callable_package_id_v8(config),
        EProtocolCatalogMismatch,
    );
    let binding = new_product_release_binding(
        core,
        seal,
        runtime,
        output,
        physical,
        market,
        release,
    );
    let catalog_uid = object::new(ctx);
    let catalog_id = catalog_uid.to_inner();
    let product_binding_commitment = binding.commitment;
    let seal_authority_id = fresh_authority_id(ctx);
    let runtime_authority_id = fresh_authority_id(ctx);
    let output_authority_id = fresh_authority_id(ctx);
    let physical_authority_id = fresh_authority_id(ctx);
    let market_authority_id = fresh_authority_id(ctx);
    let release_authority_id = fresh_authority_id(ctx);
    let call_cap_set = new_call_cap_set_binding(
        catalog_id,
        product_binding_commitment,
        seal_authority_id,
        runtime_authority_id,
        output_authority_id,
        physical_authority_id,
        market_authority_id,
        release_authority_id,
    );
    let call_cap_set_commitment = call_cap_set.commitment;
    ProductReleaseCatalogV8 {
        id: catalog_uid,
        version: VERSION,
        protocol_config_id: protocol::config_id_v8(config),
        protocol_config_revision: protocol::config_revision_v8(config),
        protocol_config_commitment: *protocol::config_commitment_v8(config),
        binding,
        call_cap_set,
        seal_call_cap: option::some(PackageCallCapV8<SealRoleV8> {
            version: VERSION,
            authority_id: seal_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.seal.commitment,
            call_cap_set_commitment,
        }),
        runtime_call_cap: option::some(PackageCallCapV8<RuntimeRoleV8> {
            version: VERSION,
            authority_id: runtime_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.runtime.commitment,
            call_cap_set_commitment,
        }),
        output_call_cap: option::some(PackageCallCapV8<OutputRoleV8> {
            version: VERSION,
            authority_id: output_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.output.commitment,
            call_cap_set_commitment,
        }),
        physical_call_cap: option::some(PackageCallCapV8<PhysicalRoleV8> {
            version: VERSION,
            authority_id: physical_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.physical.commitment,
            call_cap_set_commitment,
        }),
        market_call_cap: option::some(PackageCallCapV8<MarketRoleV8> {
            version: VERSION,
            authority_id: market_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.market.commitment,
            call_cap_set_commitment,
        }),
        release_call_cap: option::some(PackageCallCapV8<ReleaseRoleV8> {
            version: VERSION,
            authority_id: release_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.release.commitment,
            call_cap_set_commitment,
        }),
    }
}

public fun share_product_release_catalog_v8(catalog: ProductReleaseCatalogV8) {
    assert!(catalog.seal_call_cap.is_none(), ECallCapsNotInstalled);
    assert!(catalog.runtime_call_cap.is_none(), ECallCapsNotInstalled);
    assert!(catalog.output_call_cap.is_none(), ECallCapsNotInstalled);
    assert!(catalog.physical_call_cap.is_none(), ECallCapsNotInstalled);
    assert!(catalog.market_call_cap.is_none(), ECallCapsNotInstalled);
    assert!(catalog.release_call_cap.is_none(), ECallCapsNotInstalled);
    transfer::share_object(catalog);
}

public fun take_seal_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<SealRoleV8> {
    assert_catalog_setup_admin(config, admin, catalog);
    assert!(catalog.seal_call_cap.is_some(), ECallCapUnavailable);
    catalog.seal_call_cap.extract()
}
public fun take_runtime_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<RuntimeRoleV8> {
    assert_catalog_setup_admin(config, admin, catalog);
    assert!(catalog.runtime_call_cap.is_some(), ECallCapUnavailable);
    catalog.runtime_call_cap.extract()
}
public fun take_output_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<OutputRoleV8> {
    assert_catalog_setup_admin(config, admin, catalog);
    assert!(catalog.output_call_cap.is_some(), ECallCapUnavailable);
    catalog.output_call_cap.extract()
}
public fun take_physical_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<PhysicalRoleV8> {
    assert_catalog_setup_admin(config, admin, catalog);
    assert!(catalog.physical_call_cap.is_some(), ECallCapUnavailable);
    catalog.physical_call_cap.extract()
}
public fun take_market_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<MarketRoleV8> {
    assert_catalog_setup_admin(config, admin, catalog);
    assert!(catalog.market_call_cap.is_some(), ECallCapUnavailable);
    catalog.market_call_cap.extract()
}
public fun take_release_call_cap_v8(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &mut ProductReleaseCatalogV8,
): PackageCallCapV8<ReleaseRoleV8> {
    assert_catalog_setup_admin(config, admin, catalog);
    assert!(catalog.release_call_cap.is_some(), ECallCapUnavailable);
    catalog.release_call_cap.extract()
}

/// Exact Release borrows this capability only from its private configuration.
public fun certify_release_catalog_witness_v8(
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<ReleaseRoleV8>,
): ReleaseCatalogWitnessV8 {
    assert_catalog_current_v8(config, catalog);
    assert_release_call_cap_v8(catalog, cap);
    ReleaseCatalogWitnessV8 { certified: certified_snapshot(catalog) }
}

/// Exact Runtime calls this only after deriving every field from its live
/// private registry state while borrowing its embedded Runtime capability.
public(package) fun certify_runtime_pack_readiness_v8(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<RuntimeRoleV8>,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
): RuntimePackReadinessV8 {
    assert_runtime_call_cap_v8(catalog, cap);
    assert_hash(&root_content_commitment);
    assert_hash(&policy_commitment);
    RuntimePackReadinessV8 {
        catalog_id: object::id(catalog),
        product_binding_commitment: catalog.binding.commitment,
        root_id,
        root_version,
        root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    }
}

public fun assert_seal_call_cap_v8(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<SealRoleV8>,
) { assert_call_cap(catalog, cap, &catalog.binding.seal, catalog.call_cap_set.seal_authority_id) }
public fun assert_runtime_call_cap_v8(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<RuntimeRoleV8>,
) { assert_call_cap(catalog, cap, &catalog.binding.runtime, catalog.call_cap_set.runtime_authority_id) }
public fun assert_output_call_cap_v8(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<OutputRoleV8>,
) { assert_call_cap(catalog, cap, &catalog.binding.output, catalog.call_cap_set.output_authority_id) }
public fun assert_physical_call_cap_v8(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<PhysicalRoleV8>,
) { assert_call_cap(catalog, cap, &catalog.binding.physical, catalog.call_cap_set.physical_authority_id) }
public fun assert_market_call_cap_v8(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<MarketRoleV8>,
) { assert_call_cap(catalog, cap, &catalog.binding.market, catalog.call_cap_set.market_authority_id) }
public fun assert_release_call_cap_v8(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<ReleaseRoleV8>,
) { assert_call_cap(catalog, cap, &catalog.binding.release, catalog.call_cap_set.release_authority_id) }

fun assert_catalog_setup_admin(
    config: &ProtocolConfigV8,
    admin: &ProtocolAdminCapV8,
    catalog: &ProductReleaseCatalogV8,
) {
    protocol::assert_protocol_admin_v8(config, admin);
    assert_catalog_current_v8(config, catalog);
}

fun assert_call_cap<Role>(
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<Role>,
    role: &ExactPackageBindingV8,
    authority_id: ID,
) {
    assert_catalog_well_formed(catalog);
    assert!(cap.version == VERSION, ECallCapMismatch);
    assert!(cap.authority_id == authority_id, ECallCapMismatch);
    assert!(cap.catalog_id == object::id(catalog), ECallCapMismatch);
    assert!(
        &cap.product_binding_commitment == &catalog.binding.commitment,
        ECallCapMismatch,
    );
    assert!(
        &cap.role_binding_commitment == &role.commitment,
        ECallCapMismatch,
    );
    assert!(
        &cap.call_cap_set_commitment == &catalog.call_cap_set.commitment,
        ECallCapMismatch,
    );
}

public fun assert_catalog_current_v8(
    config: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
) {
    protocol::assert_enabled_v8(config);
    assert_catalog_well_formed(catalog);
    assert!(catalog.protocol_config_id == protocol::config_id_v8(config), EProtocolCatalogMismatch);
    assert!(
        catalog.protocol_config_revision == protocol::config_revision_v8(config),
        EProtocolCatalogMismatch,
    );
    assert!(
        &catalog.protocol_config_commitment == protocol::config_commitment_v8(config),
        EProtocolCatalogMismatch,
    );
}

/// Variant used by generic Maker paths, because payment-type checking belongs
/// to the Root's exact protocol assertion rather than the catalog itself.
public fun assert_catalog_snapshot_v8(
    catalog: &ProductReleaseCatalogV8,
    expected_config_id: ID,
    expected_config_revision: u64,
    expected_config_commitment: &vector<u8>,
) {
    assert_catalog_well_formed(catalog);
    assert!(catalog.protocol_config_id == expected_config_id, EProtocolCatalogMismatch);
    assert!(
        catalog.protocol_config_revision == expected_config_revision,
        EProtocolCatalogMismatch,
    );
    assert!(
        &catalog.protocol_config_commitment == expected_config_commitment,
        EProtocolCatalogMismatch,
    );
}

public fun assert_certified_binding_v8(
    certified: &CertifiedProductReleaseBindingV8,
) {
    assert_product_release_binding_well_formed_v8(&certified.binding);
    assert_hash(&certified.protocol_config_commitment);
    assert_call_cap_set_well_formed(
        &certified.call_cap_set,
        certified.catalog_id,
        certified.binding.commitment,
    );
}

/// Proves that two snapshots name the complete same call-capability set, not
/// merely the same catalog or product binding. Core activation uses this when
/// it copies the catalog-governed set into one Maker Root.
public fun assert_same_call_cap_set_v8(
    left: &PackageCallCapSetBindingV8,
    right: &PackageCallCapSetBindingV8,
) {
    assert_call_cap_set_well_formed(
        left,
        left.catalog_id,
        left.product_binding_commitment,
    );
    assert_call_cap_set_well_formed(
        right,
        right.catalog_id,
        right.product_binding_commitment,
    );
    assert!(left.version == right.version, ECallCapMismatch);
    assert!(left.catalog_id == right.catalog_id, ECallCapMismatch);
    assert!(
        &left.product_binding_commitment == &right.product_binding_commitment,
        ECallCapMismatch,
    );
    assert!(left.seal_authority_id == right.seal_authority_id, ECallCapMismatch);
    assert!(left.runtime_authority_id == right.runtime_authority_id, ECallCapMismatch);
    assert!(left.output_authority_id == right.output_authority_id, ECallCapMismatch);
    assert!(left.physical_authority_id == right.physical_authority_id, ECallCapMismatch);
    assert!(left.market_authority_id == right.market_authority_id, ECallCapMismatch);
    assert!(left.release_authority_id == right.release_authority_id, ECallCapMismatch);
    assert!(&left.commitment == &right.commitment, ECallCapMismatch);
}

public(package) fun consume_release_catalog_witness_v8(
    witness: ReleaseCatalogWitnessV8,
): CertifiedProductReleaseBindingV8 {
    let ReleaseCatalogWitnessV8 { certified } = witness;
    assert_certified_binding_v8(&certified);
    certified
}

public(package) fun consume_runtime_pack_readiness_v8(
    witness: RuntimePackReadinessV8,
): (ID, vector<u8>, ID, u64, vector<u8>, ID, ID, vector<u8>) {
    let RuntimePackReadinessV8 {
        catalog_id,
        product_binding_commitment,
        root_id,
        root_version,
        root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    } = witness;
    (
        catalog_id,
        product_binding_commitment,
        root_id,
        root_version,
        root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    )
}

public fun assert_type_origins_v8<OriginalMarker, CallableMarker>(
    binding: &ExactPackageBindingV8,
) {
    assert_same_lineage<OriginalMarker, CallableMarker>();
    assert_binding_well_formed(binding);
    assert!(
        binding.original_package_id
            == object::id_from_address(type_name::original_id<OriginalMarker>()),
        ETypeOriginMismatch,
    );
    assert!(
        binding.callable_package_id
            == object::id_from_address(type_name::defining_id<CallableMarker>()),
        ETypeOriginMismatch,
    );
}

/// Proves that a live generic object type belongs to the exact original
/// package lineage frozen for one product role. Persistent object types keep
/// their original TypeOrigin across compatible package upgrades, while the
/// separate callable marker above proves the currently callable package.
public fun assert_type_original_v8<T>(binding: &ExactPackageBindingV8) {
    assert_binding_well_formed(binding);
    assert!(
        binding.original_package_id
            == object::id_from_address(type_name::original_id<T>()),
        ETypeOriginMismatch,
    );
}

public fun assert_product_release_binding_well_formed_v8(
    binding: &ProductReleaseBindingV8,
) {
    assert!(binding.version == VERSION, EBindingCommitmentMismatch);
    assert!(binding.native_capability_mask == NATIVE_CAPABILITY_MASK, ECapabilityMismatch);
    assert_binding_well_formed(&binding.core);
    assert_binding_well_formed(&binding.seal);
    assert_binding_well_formed(&binding.runtime);
    assert_binding_well_formed(&binding.output);
    assert_binding_well_formed(&binding.physical);
    assert_binding_well_formed(&binding.market);
    assert_binding_well_formed(&binding.release);
    assert_distinct_package_roles(
        &binding.core,
        &binding.seal,
        &binding.runtime,
        &binding.output,
        &binding.physical,
        &binding.market,
        &binding.release,
    );
    let expected = hash::sha2_256(bcs::to_bytes(
        &ProductReleaseBindingCommitmentInputV8 {
            domain: b"animacraft-v8/product-release-binding",
            version: binding.version,
            native_capability_mask: binding.native_capability_mask,
            core: binding.core,
            seal: binding.seal,
            runtime: binding.runtime,
            output: binding.output,
            physical: binding.physical,
            market: binding.market,
            release: binding.release,
        },
    ));
    assert!(&expected == &binding.commitment, EBindingCommitmentMismatch);
}

fun new_exact_package_binding<OriginalMarker, CallableMarker>(
    commitments: PackageCommitmentsV8,
): ExactPackageBindingV8 {
    assert_same_lineage<OriginalMarker, CallableMarker>();
    new_binding(
        object::id_from_address(type_name::original_id<OriginalMarker>()),
        object::id_from_address(type_name::defining_id<CallableMarker>()),
        commitments.source_commitment,
        commitments.package_commitment,
        commitments.abi_commitment,
    )
}

fun new_product_release_binding(
    core: ExactPackageBindingV8,
    seal: ExactPackageBindingV8,
    runtime: ExactPackageBindingV8,
    output: ExactPackageBindingV8,
    physical: ExactPackageBindingV8,
    market: ExactPackageBindingV8,
    release: ExactPackageBindingV8,
): ProductReleaseBindingV8 {
    assert_binding_well_formed(&core);
    assert_binding_well_formed(&seal);
    assert_binding_well_formed(&runtime);
    assert_binding_well_formed(&output);
    assert_binding_well_formed(&physical);
    assert_binding_well_formed(&market);
    assert_binding_well_formed(&release);
    assert_distinct_package_roles(
        &core,
        &seal,
        &runtime,
        &output,
        &physical,
        &market,
        &release,
    );
    let commitment = hash::sha2_256(bcs::to_bytes(
        &ProductReleaseBindingCommitmentInputV8 {
            domain: b"animacraft-v8/product-release-binding",
            version: VERSION,
            native_capability_mask: NATIVE_CAPABILITY_MASK,
            core,
            seal,
            runtime,
            output,
            physical,
            market,
            release,
        },
    ));
    ProductReleaseBindingV8 {
        version: VERSION,
        native_capability_mask: NATIVE_CAPABILITY_MASK,
        core,
        seal,
        runtime,
        output,
        physical,
        market,
        release,
        commitment,
    }
}

fun new_call_cap_set_binding(
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    seal_authority_id: ID,
    runtime_authority_id: ID,
    output_authority_id: ID,
    physical_authority_id: ID,
    market_authority_id: ID,
    release_authority_id: ID,
): PackageCallCapSetBindingV8 {
    let commitment = hash::sha2_256(bcs::to_bytes(
        &PackageCallCapSetCommitmentInputV8 {
            domain: b"animacraft-v8/package-call-cap-set",
            version: VERSION,
            catalog_id,
            product_binding_commitment,
            seal_authority_id,
            runtime_authority_id,
            output_authority_id,
            physical_authority_id,
            market_authority_id,
            release_authority_id,
        },
    ));
    PackageCallCapSetBindingV8 {
        version: VERSION,
        catalog_id,
        product_binding_commitment,
        seal_authority_id,
        runtime_authority_id,
        output_authority_id,
        physical_authority_id,
        market_authority_id,
        release_authority_id,
        commitment,
    }
}

fun fresh_authority_id(ctx: &mut TxContext): ID {
    let nonce = object::new(ctx);
    let id = nonce.to_inner();
    nonce.delete();
    id
}

fun new_binding(
    original_package_id: ID,
    callable_package_id: ID,
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
): ExactPackageBindingV8 {
    assert_hash(&source_commitment);
    assert_hash(&package_commitment);
    assert_hash(&abi_commitment);
    let commitment = hash::sha2_256(bcs::to_bytes(
        &ExactPackageBindingCommitmentInputV8 {
            domain: b"animacraft-v8/exact-package-binding",
            version: VERSION,
            original_package_id,
            callable_package_id,
            source_commitment,
            package_commitment,
            abi_commitment,
        },
    ));
    ExactPackageBindingV8 {
        original_package_id,
        callable_package_id,
        source_commitment,
        package_commitment,
        abi_commitment,
        commitment,
    }
}

fun certified_snapshot(
    catalog: &ProductReleaseCatalogV8,
): CertifiedProductReleaseBindingV8 {
    CertifiedProductReleaseBindingV8 {
        catalog_id: object::id(catalog),
        protocol_config_id: catalog.protocol_config_id,
        protocol_config_revision: catalog.protocol_config_revision,
        protocol_config_commitment: catalog.protocol_config_commitment,
        binding: catalog.binding,
        call_cap_set: catalog.call_cap_set,
    }
}

fun assert_catalog_well_formed(catalog: &ProductReleaseCatalogV8) {
    assert!(catalog.version == VERSION, EProtocolCatalogMismatch);
    assert_hash(&catalog.protocol_config_commitment);
    assert_product_release_binding_well_formed_v8(&catalog.binding);
    assert_call_cap_set_well_formed(
        &catalog.call_cap_set,
        object::id(catalog),
        catalog.binding.commitment,
    );
}

fun assert_call_cap_set_well_formed(
    call_cap_set: &PackageCallCapSetBindingV8,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
) {
    assert!(call_cap_set.version == VERSION, ECallCapMismatch);
    assert!(call_cap_set.catalog_id == catalog_id, ECallCapMismatch);
    assert!(
        &call_cap_set.product_binding_commitment == &product_binding_commitment,
        ECallCapMismatch,
    );
    let expected = hash::sha2_256(bcs::to_bytes(
        &PackageCallCapSetCommitmentInputV8 {
            domain: b"animacraft-v8/package-call-cap-set",
            version: call_cap_set.version,
            catalog_id: call_cap_set.catalog_id,
            product_binding_commitment: call_cap_set.product_binding_commitment,
            seal_authority_id: call_cap_set.seal_authority_id,
            runtime_authority_id: call_cap_set.runtime_authority_id,
            output_authority_id: call_cap_set.output_authority_id,
            physical_authority_id: call_cap_set.physical_authority_id,
            market_authority_id: call_cap_set.market_authority_id,
            release_authority_id: call_cap_set.release_authority_id,
        },
    ));
    assert!(&expected == &call_cap_set.commitment, ECallCapMismatch);
}

fun assert_binding_well_formed(binding: &ExactPackageBindingV8) {
    assert_hash(&binding.source_commitment);
    assert_hash(&binding.package_commitment);
    assert_hash(&binding.abi_commitment);
    let expected = hash::sha2_256(bcs::to_bytes(
        &ExactPackageBindingCommitmentInputV8 {
            domain: b"animacraft-v8/exact-package-binding",
            version: VERSION,
            original_package_id: binding.original_package_id,
            callable_package_id: binding.callable_package_id,
            source_commitment: binding.source_commitment,
            package_commitment: binding.package_commitment,
            abi_commitment: binding.abi_commitment,
        },
    ));
    assert!(&expected == &binding.commitment, EBindingCommitmentMismatch);
}

fun assert_same_lineage<OriginalMarker, CallableMarker>() {
    assert!(
        type_name::original_id<OriginalMarker>()
            == type_name::original_id<CallableMarker>(),
        EPackageLineageMismatch,
    );
}

/// Rejects collisions across roles in either column, including cross-column
/// collisions. Original == callable is allowed only within the same role for
/// an initial package publication.
fun assert_distinct_package_roles(
    core: &ExactPackageBindingV8,
    seal: &ExactPackageBindingV8,
    runtime: &ExactPackageBindingV8,
    output: &ExactPackageBindingV8,
    physical: &ExactPackageBindingV8,
    market: &ExactPackageBindingV8,
    release: &ExactPackageBindingV8,
) {
    let originals = vector[
        core.original_package_id,
        seal.original_package_id,
        runtime.original_package_id,
        output.original_package_id,
        physical.original_package_id,
        market.original_package_id,
        release.original_package_id,
    ];
    let callables = vector[
        core.callable_package_id,
        seal.callable_package_id,
        runtime.callable_package_id,
        output.callable_package_id,
        physical.callable_package_id,
        market.callable_package_id,
        release.callable_package_id,
    ];
    let mut left = 0;
    while (left < originals.length()) {
        let mut right = left + 1;
        while (right < originals.length()) {
            assert!(&originals[left] != &originals[right], EPackageCollision);
            assert!(&callables[left] != &callables[right], EPackageCollision);
            assert!(&originals[left] != &callables[right], EPackageCollision);
            assert!(&callables[left] != &originals[right], EPackageCollision);
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

public fun catalog_id_v8(catalog: &ProductReleaseCatalogV8): ID { object::id(catalog) }
public fun catalog_protocol_config_id_v8(catalog: &ProductReleaseCatalogV8): ID {
    catalog.protocol_config_id
}
public fun catalog_protocol_config_revision_v8(catalog: &ProductReleaseCatalogV8): u64 {
    catalog.protocol_config_revision
}
public fun catalog_protocol_config_commitment_v8(
    catalog: &ProductReleaseCatalogV8,
): &vector<u8> { &catalog.protocol_config_commitment }
public fun catalog_binding_v8(
    catalog: &ProductReleaseCatalogV8,
): &ProductReleaseBindingV8 { &catalog.binding }
public fun certified_catalog_id_v8(certified: &CertifiedProductReleaseBindingV8): ID {
    certified.catalog_id
}
public fun certified_protocol_config_id_v8(
    certified: &CertifiedProductReleaseBindingV8,
): ID { certified.protocol_config_id }
public fun certified_protocol_config_revision_v8(
    certified: &CertifiedProductReleaseBindingV8,
): u64 { certified.protocol_config_revision }
public fun certified_protocol_config_commitment_v8(
    certified: &CertifiedProductReleaseBindingV8,
): &vector<u8> { &certified.protocol_config_commitment }
public fun certified_binding_v8(
    certified: &CertifiedProductReleaseBindingV8,
): &ProductReleaseBindingV8 { &certified.binding }
public fun original_package_id_v8(binding: &ExactPackageBindingV8): ID {
    binding.original_package_id
}
public fun callable_package_id_v8(binding: &ExactPackageBindingV8): ID {
    binding.callable_package_id
}
public fun source_commitment_v8(binding: &ExactPackageBindingV8): &vector<u8> {
    &binding.source_commitment
}
public fun package_commitment_v8(binding: &ExactPackageBindingV8): &vector<u8> {
    &binding.package_commitment
}
public fun abi_commitment_v8(binding: &ExactPackageBindingV8): &vector<u8> {
    &binding.abi_commitment
}
public fun exact_binding_commitment_v8(binding: &ExactPackageBindingV8): &vector<u8> {
    &binding.commitment
}
public fun product_binding_commitment_v8(binding: &ProductReleaseBindingV8): &vector<u8> {
    &binding.commitment
}
public fun binding_native_capability_mask_v8(binding: &ProductReleaseBindingV8): u64 {
    binding.native_capability_mask
}
public fun assert_native_capability_mask_v8(binding: &ProductReleaseBindingV8) {
    assert!(binding.native_capability_mask == NATIVE_CAPABILITY_MASK, ECapabilityMismatch);
}
public fun core_binding_v8(binding: &ProductReleaseBindingV8): &ExactPackageBindingV8 {
    &binding.core
}
public fun seal_binding_v8(binding: &ProductReleaseBindingV8): &ExactPackageBindingV8 {
    &binding.seal
}
public fun runtime_binding_v8(binding: &ProductReleaseBindingV8): &ExactPackageBindingV8 {
    &binding.runtime
}
public fun output_binding_v8(binding: &ProductReleaseBindingV8): &ExactPackageBindingV8 {
    &binding.output
}
public fun physical_binding_v8(binding: &ProductReleaseBindingV8): &ExactPackageBindingV8 {
    &binding.physical
}
public fun market_binding_v8(binding: &ProductReleaseBindingV8): &ExactPackageBindingV8 {
    &binding.market
}
public fun release_binding_v8(binding: &ProductReleaseBindingV8): &ExactPackageBindingV8 {
    &binding.release
}
public fun catalog_call_cap_set_v8(
    catalog: &ProductReleaseCatalogV8,
): &PackageCallCapSetBindingV8 { &catalog.call_cap_set }
public fun certified_call_cap_set_v8(
    certified: &CertifiedProductReleaseBindingV8,
): &PackageCallCapSetBindingV8 { &certified.call_cap_set }
public fun call_cap_set_commitment_v8(
    binding: &PackageCallCapSetBindingV8,
): &vector<u8> { &binding.commitment }
public fun call_cap_authority_id_v8<Role>(cap: &PackageCallCapV8<Role>): ID {
    cap.authority_id
}
public fun seal_authority_id_v8(binding: &PackageCallCapSetBindingV8): ID {
    binding.seal_authority_id
}
public fun runtime_authority_id_v8(binding: &PackageCallCapSetBindingV8): ID {
    binding.runtime_authority_id
}
public fun output_authority_id_v8(binding: &PackageCallCapSetBindingV8): ID {
    binding.output_authority_id
}
public fun physical_authority_id_v8(binding: &PackageCallCapSetBindingV8): ID {
    binding.physical_authority_id
}
public fun market_authority_id_v8(binding: &PackageCallCapSetBindingV8): ID {
    binding.market_authority_id
}
public fun release_authority_id_v8(binding: &PackageCallCapSetBindingV8): ID {
    binding.release_authority_id
}

#[test_only]
public fun new_exact_package_binding_for_testing(
    original_package_id: address,
    callable_package_id: address,
    byte: u8,
): ExactPackageBindingV8 {
    new_binding(
        object::id_from_address(original_package_id),
        object::id_from_address(callable_package_id),
        test_hash(byte),
        test_hash(byte + 1),
        test_hash(byte + 2),
    )
}

#[test_only]
public fun product_release_catalog_for_testing(
    config: &ProtocolConfigV8,
    core_original_package_id: address,
    core_callable_package_id: address,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    let binding = new_product_release_binding(
        new_exact_package_binding_for_testing(core_original_package_id, core_callable_package_id, 1),
        new_exact_package_binding_for_testing(@0x11, @0x21, 4),
        new_exact_package_binding_for_testing(@0x12, @0x22, 7),
        new_exact_package_binding_for_testing(@0x13, @0x23, 10),
        new_exact_package_binding_for_testing(@0x14, @0x24, 13),
        new_exact_package_binding_for_testing(@0x15, @0x25, 16),
        new_exact_package_binding_for_testing(@0x16, @0x26, 19),
    );
    catalog_from_binding_for_testing(config, binding, ctx)
}

/// External companion tests use their real marker TypeOrigin for the Release
/// role while retaining synthetic, pairwise-distinct IDs for packages that are
/// not under test. Production catalog construction remains the certified path.
#[test_only]
public fun product_release_catalog_with_release_for_testing<
    ReleaseOriginalMarker,
    ReleaseCallableMarker,
>(
    config: &ProtocolConfigV8,
    core_original_package_id: address,
    core_callable_package_id: address,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    let binding = new_product_release_binding(
        new_exact_package_binding_for_testing(
            core_original_package_id,
            core_callable_package_id,
            1,
        ),
        new_exact_package_binding_for_testing(@0x11, @0x21, 4),
        new_exact_package_binding_for_testing(@0x12, @0x22, 7),
        new_exact_package_binding_for_testing(@0x13, @0x23, 10),
        new_exact_package_binding_for_testing(@0x14, @0x24, 13),
        new_exact_package_binding_for_testing(@0x15, @0x25, 16),
        new_exact_package_binding<ReleaseOriginalMarker, ReleaseCallableMarker>(
            new_package_commitments_v8(test_hash(19), test_hash(20), test_hash(21)),
        ),
    );
    catalog_from_binding_for_testing(config, binding, ctx)
}

/// Test catalog variant for exercising a real Physical companion's TypeOrigin
/// boundary while the not-yet-materialized Market and Release roles retain
/// isolated fixture package IDs.
#[test_only]
public fun product_release_catalog_for_physical_testing<
    PhysicalOriginalMarker,
    PhysicalCallableMarker,
>(
    config: &ProtocolConfigV8,
    core_original_package_id: address,
    core_callable_package_id: address,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    let physical = new_exact_package_binding<
        PhysicalOriginalMarker,
        PhysicalCallableMarker,
    >(new_package_commitments_v8(test_hash(13), test_hash(14), test_hash(15)));
    let binding = new_product_release_binding(
        new_exact_package_binding_for_testing(
            core_original_package_id,
            core_callable_package_id,
            1,
        ),
        new_exact_package_binding_for_testing(@0x11, @0x21, 4),
        new_exact_package_binding_for_testing(@0x12, @0x22, 7),
        new_exact_package_binding_for_testing(@0x13, @0x23, 10),
        physical,
        new_exact_package_binding_for_testing(@0x15, @0x25, 16),
        new_exact_package_binding_for_testing(@0x16, @0x26, 19),
    );
    catalog_from_binding_for_testing(config, binding, ctx)
}

#[test_only]
fun catalog_from_binding_for_testing(
    config: &ProtocolConfigV8,
    binding: ProductReleaseBindingV8,
    ctx: &mut TxContext,
): ProductReleaseCatalogV8 {
    let catalog_uid = object::new(ctx);
    let catalog_id = catalog_uid.to_inner();
    let product_binding_commitment = binding.commitment;
    let seal_authority_id = fresh_authority_id(ctx);
    let runtime_authority_id = fresh_authority_id(ctx);
    let output_authority_id = fresh_authority_id(ctx);
    let physical_authority_id = fresh_authority_id(ctx);
    let market_authority_id = fresh_authority_id(ctx);
    let release_authority_id = fresh_authority_id(ctx);
    let call_cap_set = new_call_cap_set_binding(
        catalog_id,
        product_binding_commitment,
        seal_authority_id,
        runtime_authority_id,
        output_authority_id,
        physical_authority_id,
        market_authority_id,
        release_authority_id,
    );
    let call_cap_set_commitment = call_cap_set.commitment;
    ProductReleaseCatalogV8 {
        id: catalog_uid,
        version: VERSION,
        protocol_config_id: protocol::config_id_v8(config),
        protocol_config_revision: protocol::config_revision_v8(config),
        protocol_config_commitment: *protocol::config_commitment_v8(config),
        binding,
        call_cap_set,
        seal_call_cap: option::some(PackageCallCapV8<SealRoleV8> {
            version: VERSION,
            authority_id: seal_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.seal.commitment,
            call_cap_set_commitment,
        }),
        runtime_call_cap: option::some(PackageCallCapV8<RuntimeRoleV8> {
            version: VERSION,
            authority_id: runtime_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.runtime.commitment,
            call_cap_set_commitment,
        }),
        output_call_cap: option::some(PackageCallCapV8<OutputRoleV8> {
            version: VERSION,
            authority_id: output_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.output.commitment,
            call_cap_set_commitment,
        }),
        physical_call_cap: option::some(PackageCallCapV8<PhysicalRoleV8> {
            version: VERSION,
            authority_id: physical_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.physical.commitment,
            call_cap_set_commitment,
        }),
        market_call_cap: option::some(PackageCallCapV8<MarketRoleV8> {
            version: VERSION,
            authority_id: market_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.market.commitment,
            call_cap_set_commitment,
        }),
        release_call_cap: option::some(PackageCallCapV8<ReleaseRoleV8> {
            version: VERSION,
            authority_id: release_authority_id,
            catalog_id,
            product_binding_commitment,
            role_binding_commitment: binding.release.commitment,
            call_cap_set_commitment,
        }),
    }
}

#[test_only]
public fun release_catalog_witness_for_testing(
    catalog: &ProductReleaseCatalogV8,
): ReleaseCatalogWitnessV8 {
    ReleaseCatalogWitnessV8 { certified: certified_snapshot(catalog) }
}

#[test_only]
public fun runtime_pack_readiness_for_testing(
    catalog: &ProductReleaseCatalogV8,
    root_id: ID,
    root_version: u64,
    root_content_commitment: vector<u8>,
    pack_registry_id: ID,
    admission_authority_id: ID,
    policy_commitment: vector<u8>,
): RuntimePackReadinessV8 {
    RuntimePackReadinessV8 {
        catalog_id: object::id(catalog),
        product_binding_commitment: catalog.binding.commitment,
        root_id,
        root_version,
        root_content_commitment,
        pack_registry_id,
        admission_authority_id,
        policy_commitment,
    }
}

#[test_only]
public fun destroy_catalog_for_testing(catalog: ProductReleaseCatalogV8) {
    let ProductReleaseCatalogV8 {
        id,
        version: _,
        protocol_config_id: _,
        protocol_config_revision: _,
        protocol_config_commitment: _,
        binding: _,
        call_cap_set: _,
        seal_call_cap,
        runtime_call_cap,
        output_call_cap,
        physical_call_cap,
        market_call_cap,
        release_call_cap,
    } = catalog;
    destroy_optional_call_cap_for_testing(seal_call_cap);
    destroy_optional_call_cap_for_testing(runtime_call_cap);
    destroy_optional_call_cap_for_testing(output_call_cap);
    destroy_optional_call_cap_for_testing(physical_call_cap);
    destroy_optional_call_cap_for_testing(market_call_cap);
    destroy_optional_call_cap_for_testing(release_call_cap);
    id.delete();
}

#[test_only]
fun destroy_optional_call_cap_for_testing<Role>(cap: Option<PackageCallCapV8<Role>>) {
    if (cap.is_some()) {
        let PackageCallCapV8 {
            version: _,
            authority_id: _,
            catalog_id: _,
            product_binding_commitment: _,
            role_binding_commitment: _,
            call_cap_set_commitment: _,
        } = cap.destroy_some();
    } else {
        cap.destroy_none();
    }
}

#[test_only]
public fun destroy_call_cap_for_testing<Role>(cap: PackageCallCapV8<Role>) {
    let PackageCallCapV8 {
        version: _,
        authority_id: _,
        catalog_id: _,
        product_binding_commitment: _,
        role_binding_commitment: _,
        call_cap_set_commitment: _,
    } = cap;
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

#[test]
fun exact_binding_records_defining_id_and_same_lineage() {
    let binding = new_exact_package_binding<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    >(new_package_commitments_v8(test_hash(1), test_hash(2), test_hash(3)));
    assert_type_origins_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    >(&binding);
    assert_type_original_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    >(&binding);
}

#[test, expected_failure(abort_code = ETypeOriginMismatch)]
fun live_object_type_origin_must_match_the_frozen_role() {
    let binding = new_exact_package_binding_for_testing(@0x77, @0x78, 30);
    assert_type_original_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    >(&binding);
}

#[test, expected_failure(abort_code = EPackageLineageMismatch)]
fun cross_lineage_markers_are_rejected() {
    new_exact_package_binding<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        sui::sui::SUI,
    >(new_package_commitments_v8(test_hash(1), test_hash(2), test_hash(3)));
}

#[test, expected_failure(abort_code = EPackageCollision)]
fun cross_column_role_collision_is_rejected() {
    new_product_release_binding(
        new_exact_package_binding_for_testing(@0x10, @0x20, 1),
        new_exact_package_binding_for_testing(@0x20, @0x21, 4),
        new_exact_package_binding_for_testing(@0x12, @0x22, 7),
        new_exact_package_binding_for_testing(@0x13, @0x23, 10),
        new_exact_package_binding_for_testing(@0x14, @0x24, 13),
        new_exact_package_binding_for_testing(@0x15, @0x25, 16),
        new_exact_package_binding_for_testing(@0x16, @0x26, 19),
    );
}

#[test, expected_failure(abort_code = EPackageCollision)]
fun same_column_role_collision_is_rejected() {
    let duplicate = new_exact_package_binding_for_testing(@0x11, @0x21, 1);
    new_product_release_binding(
        duplicate,
        duplicate,
        new_exact_package_binding_for_testing(@0x12, @0x22, 4),
        new_exact_package_binding_for_testing(@0x13, @0x23, 7),
        new_exact_package_binding_for_testing(@0x14, @0x24, 10),
        new_exact_package_binding_for_testing(@0x15, @0x25, 13),
        new_exact_package_binding_for_testing(@0x16, @0x26, 16),
    );
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun malformed_commitment_is_rejected() {
    new_package_commitments_v8(vector[1], test_hash(2), test_hash(3));
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun all_zero_commitment_is_rejected() {
    new_package_commitments_v8(test_hash(0), test_hash(2), test_hash(3));
}

#[test, expected_failure(abort_code = 0)]
fun maker_author_cannot_certify_roles_without_exact_protocol_admin() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 701, 0, 0, 0);
    let (config_a, cap_a) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let (config_b, cap_b) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let commitments = new_package_commitments_v8(
        test_hash(1),
        test_hash(2),
        test_hash(3),
    );
    let catalog = certify_product_release_catalog_v8<
        ProductReleaseBindingV8,
        ProductReleaseCatalogV8,
        ProductReleaseBindingV8,
        ProductReleaseCatalogV8,
        ProductReleaseBindingV8,
        ProductReleaseCatalogV8,
        ProductReleaseBindingV8,
        ProductReleaseCatalogV8,
        ProductReleaseBindingV8,
        ProductReleaseCatalogV8,
        ProductReleaseBindingV8,
        ProductReleaseCatalogV8,
        ProductReleaseBindingV8,
        ProductReleaseCatalogV8,
    >(
        &config_a,
        &cap_b,
        commitments,
        commitments,
        commitments,
        commitments,
        commitments,
        commitments,
        commitments,
        &mut ctx,
    );
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config_a, cap_a);
    protocol::destroy_protocol_for_testing(config_b, cap_b);
}

#[test]
fun exact_call_caps_are_taken_once_before_catalog_share() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 702, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = product_release_catalog_for_testing(
        &config,
        @0x10,
        @0x20,
        &mut ctx,
    );
    let seal = take_seal_call_cap_v8(&config, &protocol_cap, &mut catalog);
    let runtime = take_runtime_call_cap_v8(&config, &protocol_cap, &mut catalog);
    let output = take_output_call_cap_v8(&config, &protocol_cap, &mut catalog);
    let physical = take_physical_call_cap_v8(&config, &protocol_cap, &mut catalog);
    let market = take_market_call_cap_v8(&config, &protocol_cap, &mut catalog);
    let release = take_release_call_cap_v8(&config, &protocol_cap, &mut catalog);
    assert_seal_call_cap_v8(&catalog, &seal);
    assert_runtime_call_cap_v8(&catalog, &runtime);
    assert_output_call_cap_v8(&catalog, &output);
    assert_physical_call_cap_v8(&catalog, &physical);
    assert_market_call_cap_v8(&catalog, &market);
    assert_release_call_cap_v8(&catalog, &release);
    destroy_call_cap_for_testing(seal);
    destroy_call_cap_for_testing(runtime);
    destroy_call_cap_for_testing(output);
    destroy_call_cap_for_testing(physical);
    destroy_call_cap_for_testing(market);
    destroy_call_cap_for_testing(release);
    share_product_release_catalog_v8(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}

#[test, expected_failure(abort_code = ECallCapsNotInstalled)]
fun catalog_cannot_share_before_all_caps_are_installed() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 703, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let catalog = product_release_catalog_for_testing(
        &config,
        @0x10,
        @0x20,
        &mut ctx,
    );
    share_product_release_catalog_v8(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}

#[test, expected_failure(abort_code = ECallCapUnavailable)]
fun call_cap_cannot_be_taken_twice() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 704, 0, 0, 0);
    let (config, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let mut catalog = product_release_catalog_for_testing(
        &config,
        @0x10,
        @0x20,
        &mut ctx,
    );
    let first = take_runtime_call_cap_v8(&config, &protocol_cap, &mut catalog);
    let second = take_runtime_call_cap_v8(&config, &protocol_cap, &mut catalog);
    destroy_call_cap_for_testing(first);
    destroy_call_cap_for_testing(second);
    destroy_catalog_for_testing(catalog);
    protocol::destroy_protocol_for_testing(config, protocol_cap);
}
