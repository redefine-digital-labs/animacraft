/// Exact, immutable identities for the seven packages that make one
/// Animacraft v8 product release. This module imports no companion package.
module animacraft_v8_core::package_binding_v8;

use std::bcs;
use std::hash;
use std::type_name;

const VERSION: u64 = 8;
const HASH_LENGTH: u64 = 32;

const EInvalidCommitment: u64 = 0;
const ETypeOriginMismatch: u64 = 1;
const EPackageCollision: u64 = 2;
const EBindingCommitmentMismatch: u64 = 3;

/// One exact package role. `OriginalMarker` must be a type from the original
/// package lineage. `CallableMarker` must be introduced by the exact package
/// version whose modules will be called for this release.
public struct ExactPackageBindingV8 has copy, drop, store {
    original_package_id: ID,
    callable_package_id: ID,
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
    commitment: vector<u8>,
}

/// One product, version 8, with seven required and distinct package roles.
/// This value is immutable after construction; MakerRootV8 permits attaching
/// it only once while the Root is DRAFT.
public struct ProductReleaseBindingV8 has copy, drop, store {
    version: u64,
    core: ExactPackageBindingV8,
    seal: ExactPackageBindingV8,
    runtime: ExactPackageBindingV8,
    output: ExactPackageBindingV8,
    physical: ExactPackageBindingV8,
    market: ExactPackageBindingV8,
    release: ExactPackageBindingV8,
    commitment: vector<u8>,
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
    core: ExactPackageBindingV8,
    seal: ExactPackageBindingV8,
    runtime: ExactPackageBindingV8,
    output: ExactPackageBindingV8,
    physical: ExactPackageBindingV8,
    market: ExactPackageBindingV8,
    release: ExactPackageBindingV8,
}

public fun version_v8(): u64 { VERSION }

/// Derives both identities from marker TypeOrigins rather than trusting IDs
/// supplied by a client. On an upgraded package, use a marker introduced in
/// that exact upgrade as `CallableMarker`.
public fun new_exact_package_binding_v8<OriginalMarker, CallableMarker>(
    source_commitment: vector<u8>,
    package_commitment: vector<u8>,
    abi_commitment: vector<u8>,
): ExactPackageBindingV8 {
    new_binding(
        object::id_from_address(type_name::original_id<OriginalMarker>()),
        object::id_from_address(type_name::defining_id<CallableMarker>()),
        source_commitment,
        package_commitment,
        abi_commitment,
    )
}

public fun new_product_release_binding_v8(
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

/// Checks an already-created binding against the exact two marker origins.
/// A structurally identical type from another package cannot pass.
public fun assert_type_origins_v8<OriginalMarker, CallableMarker>(
    binding: &ExactPackageBindingV8,
) {
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

public fun assert_product_release_binding_well_formed_v8(
    binding: &ProductReleaseBindingV8,
) {
    assert!(binding.version == VERSION, EBindingCommitmentMismatch);
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

fun assert_distinct_package_roles(
    core: &ExactPackageBindingV8,
    seal: &ExactPackageBindingV8,
    runtime: &ExactPackageBindingV8,
    output: &ExactPackageBindingV8,
    physical: &ExactPackageBindingV8,
    market: &ExactPackageBindingV8,
    release: &ExactPackageBindingV8,
) {
    assert_distinct_ids(vector[
        core.original_package_id,
        seal.original_package_id,
        runtime.original_package_id,
        output.original_package_id,
        physical.original_package_id,
        market.original_package_id,
        release.original_package_id,
    ]);
    assert_distinct_ids(vector[
        core.callable_package_id,
        seal.callable_package_id,
        runtime.callable_package_id,
        output.callable_package_id,
        physical.callable_package_id,
        market.callable_package_id,
        release.callable_package_id,
    ]);
}

fun assert_distinct_ids(ids: vector<ID>) {
    let mut left = 0;
    while (left < ids.length()) {
        let mut right = left + 1;
        while (right < ids.length()) {
            assert!(&ids[left] != &ids[right], EPackageCollision);
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
public fun product_release_binding_for_testing(
    core_original_package_id: address,
    core_callable_package_id: address,
): ProductReleaseBindingV8 {
    new_product_release_binding_v8(
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
        new_exact_package_binding_for_testing(@0x16, @0x26, 19),
    )
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
fun exact_binding_records_both_origins_and_three_commitments() {
    let binding = new_exact_package_binding_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
    >(test_hash(1), test_hash(2), test_hash(3));
    assert_type_origins_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
    >(&binding);
    assert!(binding.source_commitment.length() == HASH_LENGTH, EInvalidCommitment);
    assert!(binding.package_commitment.length() == HASH_LENGTH, EInvalidCommitment);
    assert!(binding.abi_commitment.length() == HASH_LENGTH, EInvalidCommitment);
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun malformed_commitment_is_rejected() {
    new_exact_package_binding_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
    >(vector[1], test_hash(2), test_hash(3));
}

#[test, expected_failure(abort_code = EInvalidCommitment)]
fun all_zero_commitment_is_rejected() {
    new_exact_package_binding_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
    >(test_hash(0), test_hash(2), test_hash(3));
}

#[test, expected_failure(abort_code = ETypeOriginMismatch)]
fun wrong_type_origin_is_rejected() {
    let binding = new_exact_package_binding_v8<
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
        animacraft_v8_core::package_binding_v8::ProductReleaseBindingV8,
    >(test_hash(1), test_hash(2), test_hash(3));
    assert_type_origins_v8<sui::sui::SUI, sui::sui::SUI>(&binding);
}

#[test, expected_failure(abort_code = EPackageCollision)]
fun package_role_collision_is_rejected() {
    let duplicate = new_exact_package_binding_for_testing(@0x11, @0x21, 1);
    new_product_release_binding_v8(
        duplicate,
        duplicate,
        new_exact_package_binding_for_testing(@0x12, @0x22, 4),
        new_exact_package_binding_for_testing(@0x13, @0x23, 7),
        new_exact_package_binding_for_testing(@0x14, @0x24, 10),
        new_exact_package_binding_for_testing(@0x15, @0x25, 13),
        new_exact_package_binding_for_testing(@0x16, @0x26, 16),
    );
}
