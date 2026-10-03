/// Deployment-time binding of the one native Soul identity. Creator publication
/// neither installs nor approves this protocol-scoped authority.
module animacraft_v8_core::soulidity_binding_v8 {
use std::type_name::{Self as type_name, TypeName};
use animacraft_v8_core::protocol_config_v8::{Self as protocol, ProtocolConfigV8, ProtocolAdminCapV8, SoulidityBindingV8};

const ETypeMismatch: u64 = 0;
const EPackageMismatch: u64 = 1;

public fun install_soulidity_binding_v8<Soul: key, MintWitness: drop, OwnerWitness: drop>(
    config: &mut ProtocolConfigV8, admin: &ProtocolAdminCapV8,
) {
    protocol::assert_protocol_admin_v8(config, admin);
    assert_name<Soul>(b"soul", b"Soul");
    assert_name<MintWitness>(b"animacraft_v8_binding", b"MintBindingWitnessV8");
    assert_name<OwnerWitness>(b"animacraft_v8_binding", b"SoulOwnerWitnessV8");
    // Original IDs identify package lineage; defining IDs identify the release
    // that first introduced each type, not the currently callable package.
    // Soul may predate both witnesses, which must share one introduction release.
    assert_package_lineage(
        type_name::original_id<Soul>(), type_name::original_id<MintWitness>(),
        type_name::original_id<OwnerWitness>(), type_name::defining_id<MintWitness>(),
        type_name::defining_id<OwnerWitness>());
    protocol::attach_soulidity_binding_v8(config, admin,
        type_name::with_original_ids<Soul>(), type_name::with_defining_ids<Soul>(),
        type_name::with_original_ids<MintWitness>(), type_name::with_defining_ids<MintWitness>(),
        type_name::with_original_ids<OwnerWitness>(), type_name::with_defining_ids<OwnerWitness>());
}

fun assert_package_lineage(
    soul_original: address, mint_original: address, owner_original: address,
    mint_defining: address, owner_defining: address,
) {
    assert!(soul_original == mint_original && mint_original == owner_original
        && mint_defining == owner_defining, EPackageMismatch);
}

fun assert_name<T>(module_name: vector<u8>, datatype: vector<u8>) {
    assert_named(type_name::with_original_ids<T>(), &module_name, &datatype);
    assert_named(type_name::with_defining_ids<T>(), &module_name, &datatype);
}
fun assert_named(name: TypeName, module_name: &vector<u8>, datatype: &vector<u8>) {
    assert!(&name.module_string().into_bytes() == module_name
        && &name.datatype_string().into_bytes() == datatype, ETypeMismatch);
    let length = name.address_string().into_bytes().length() + 4 + module_name.length() + datatype.length();
    assert!(name.into_string().into_bytes().length() == length, ETypeMismatch);
}

public fun binding_v8(config: &ProtocolConfigV8): &SoulidityBindingV8 { protocol::borrow_soulidity_binding_v8(config) }
public fun native_soul_original_v8(config: &ProtocolConfigV8): TypeName { protocol::soulidity_soul_original_v8(binding_v8(config)) }
public fun native_soul_defining_v8(config: &ProtocolConfigV8): TypeName { protocol::soulidity_soul_defining_v8(binding_v8(config)) }
public fun mint_witness_original_v8(config: &ProtocolConfigV8): TypeName { protocol::soulidity_mint_original_v8(binding_v8(config)) }
public fun mint_witness_defining_v8(config: &ProtocolConfigV8): TypeName { protocol::soulidity_mint_defining_v8(binding_v8(config)) }
public fun owner_witness_original_v8(config: &ProtocolConfigV8): TypeName { protocol::soulidity_owner_original_v8(binding_v8(config)) }
public fun owner_witness_defining_v8(config: &ProtocolConfigV8): TypeName { protocol::soulidity_owner_defining_v8(binding_v8(config)) }
public fun assert_native_soul_v8<Soul: key>(config: &ProtocolConfigV8) {
    assert!(type_name::with_original_ids<Soul>() == native_soul_original_v8(config)
        && type_name::with_defining_ids<Soul>() == native_soul_defining_v8(config), ETypeMismatch);
}
public fun assert_mint_witness_v8<W: drop>(config: &ProtocolConfigV8) {
    assert!(type_name::with_original_ids<W>() == mint_witness_original_v8(config)
        && type_name::with_defining_ids<W>() == mint_witness_defining_v8(config), ETypeMismatch);
}
public fun assert_owner_witness_v8<W: drop>(config: &ProtocolConfigV8) {
    assert!(type_name::with_original_ids<W>() == owner_witness_original_v8(config)
        && type_name::with_defining_ids<W>() == owner_witness_defining_v8(config), ETypeMismatch);
}

#[test_only]
use animacraft_v8_core::soul::Soul;
#[test_only]
use animacraft_v8_core::animacraft_v8_binding::{MintBindingWitnessV8, SoulOwnerWitnessV8};
#[test_only]
public struct WrongWitness has drop {}
#[test_only]
public struct WrongSoul has key { id: UID }

#[test]
fun soulidity_binding_accepts_witnesses_introduced_in_upgrade() {
    // Native Soul was introduced in the original release (0x11); proofs were
    // introduced together at 0x22. Their original package lineage remains 0x11.
    assert_package_lineage(@0x11, @0x11, @0x11, @0x22, @0x22);
    assert_package_lineage(@0x11, @0x11, @0x11, @0x11, @0x11);
}

#[test]
#[expected_failure(abort_code = EPackageMismatch)]
fun soulidity_binding_rejects_foreign_soul_lineage() {
    assert_package_lineage(@0x99, @0x11, @0x11, @0x22, @0x22);
}

#[test]
#[expected_failure(abort_code = EPackageMismatch)]
fun soulidity_binding_rejects_foreign_owner_lineage() {
    assert_package_lineage(@0x11, @0x11, @0x99, @0x22, @0x22);
}

#[test]
#[expected_failure(abort_code = EPackageMismatch)]
fun soulidity_binding_rejects_split_witness_introduction() {
    assert_package_lineage(@0x11, @0x11, @0x11, @0x22, @0x33);
}

#[test]
fun soulidity_binding_install_and_assert() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    assert_native_soul_v8<Soul>(&config);
    assert_mint_witness_v8<MintBindingWitnessV8>(&config);
    assert_owner_witness_v8<SoulOwnerWitnessV8>(&config);
    assert!(protocol::soulidity_binding_config_id_v8(binding_v8(&config)) == object::id(&config));
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = ETypeMismatch)]
fun soulidity_binding_reject_wrong_install_proof() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, WrongWitness, SoulOwnerWitnessV8>(&mut config, &admin);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = ETypeMismatch)]
fun soulidity_binding_reject_wrong_runtime_proof() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    assert_owner_witness_v8<WrongWitness>(&config);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = 12, location = protocol)]
fun soulidity_binding_reject_second_install() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = 0, location = protocol)]
fun soulidity_binding_reject_other_config_admin() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    let (other, other_admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &other_admin);
    protocol::destroy_protocol_for_testing(config, admin);
    protocol::destroy_protocol_for_testing(other, other_admin);
}

#[test]
#[expected_failure(abort_code = 10, location = protocol)]
fun soulidity_binding_reject_after_catalog() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    protocol::claim_product_release_catalog_v2(&mut config, &admin, object::id_from_address(@0x42));
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = 13, location = protocol)]
fun fresh_catalog_rejects_missing_native_binding() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    protocol::claim_product_release_catalog_v2(&mut config, &admin, object::id_from_address(@0x42));
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun fresh_catalog_claim_follows_legitimate_native_installation() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    let catalog_id = object::id_from_address(@0x42);
    protocol::claim_product_release_catalog_v2(&mut config, &admin, catalog_id);
    protocol::assert_product_release_catalog_if_claimed_v2(&config, catalog_id);
    assert_native_soul_v8<Soul>(&config);
    assert_mint_witness_v8<MintBindingWitnessV8>(&config);
    assert_owner_witness_v8<SoulOwnerWitnessV8>(&config);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = 10, location = protocol)]
fun fresh_catalog_rejects_duplicate_after_native_installation() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    protocol::claim_product_release_catalog_v2(&mut config, &admin, object::id_from_address(@0x42));
    protocol::claim_product_release_catalog_v2(&mut config, &admin, object::id_from_address(@0x43));
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = 0, location = protocol)]
fun fresh_catalog_checks_admin_before_missing_native_binding() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    let (other, other_admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    protocol::claim_product_release_catalog_v2(&mut config, &other_admin, object::id_from_address(@0x42));
    protocol::destroy_protocol_for_testing(config, admin);
    protocol::destroy_protocol_for_testing(other, other_admin);
}

#[test]
#[expected_failure(abort_code = 1, location = protocol)]
fun fresh_catalog_checks_enabled_before_missing_native_binding() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(false, &mut ctx);
    protocol::claim_product_release_catalog_v2(&mut config, &admin, object::id_from_address(@0x42));
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = 13, location = protocol)]
fun soulidity_binding_reject_uninstalled_other_config() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    let (other, other_admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    assert_native_soul_v8<Soul>(&other);
    protocol::destroy_protocol_for_testing(config, admin);
    protocol::destroy_protocol_for_testing(other, other_admin);
}

#[test]
#[expected_failure(abort_code = ETypeMismatch)]
fun soulidity_binding_reject_wrong_native_soul() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    assert_native_soul_v8<WrongSoul>(&config);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = ETypeMismatch)]
fun soulidity_binding_reject_wrong_owner_install() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, WrongWitness>(&mut config, &admin);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
#[expected_failure(abort_code = ETypeMismatch)]
fun soulidity_binding_reject_mint_owner_substitution() {
    let mut ctx = tx_context::dummy();
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    install_soulidity_binding_v8<Soul, MintBindingWitnessV8, SoulOwnerWitnessV8>(&mut config, &admin);
    assert_mint_witness_v8<SoulOwnerWitnessV8>(&config);
    protocol::destroy_protocol_for_testing(config, admin);
}
}

// These are real VM types used only to exercise the production generic install
// path. Neither test module is present in the deployable Core package.
#[test_only]
module animacraft_v8_core::soul {
    public struct Soul has key { id: UID }
}
#[test_only]
module animacraft_v8_core::animacraft_v8_binding {
    public struct MintBindingWitnessV8 has drop {}
    public struct SoulOwnerWitnessV8 has drop {
        soul_id: ID, soul_state_id: ID, holder: address, ownership_epoch: u64,
    }
    // Test-only exact-shaped bytes for Runtime's generic verifier. Production
    // native witnesses still derive exclusively from the live SoulState.
    public fun owner_for_testing(
        soul_id: ID, soul_state_id: ID, holder: address, ownership_epoch: u64,
    ): SoulOwnerWitnessV8 {
        SoulOwnerWitnessV8 { soul_id, soul_state_id, holder, ownership_epoch }
    }
}

// Kept in Core's test graph so its basename does not collide with the real
// Output module when compiling Output's isolated Market authority fixture.
#[test_only]
module 0x13::output_v8 {
    use animacraft_v8_core::package_binding_v8::{Self as binding, ProductReleaseCatalogV8, PackageCallCapV8, OutputRoleV8};
    public struct OutputSetupInstallWitnessV2 has drop {}
    public struct OutputRuntimeCallerCapInstallWitnessV2 has drop {}
    public struct MakerCompanionBindingWitnessV2 has drop {}
    public fun setup_for_testing(catalog: &mut ProductReleaseCatalogV8, cap: PackageCallCapV8<OutputRoleV8>, config_id: ID) {
        binding::consume_output_call_cap_v8(catalog, cap, OutputSetupInstallWitnessV2 {}, config_id);
    }
    public fun companion_witness_for_testing(): MakerCompanionBindingWitnessV2 { MakerCompanionBindingWitnessV2 {} }
    public fun bootstrap_witness_for_testing(): OutputRuntimeCallerCapInstallWitnessV2 { OutputRuntimeCallerCapInstallWitnessV2 {} }
}
