/// Dependency-top publication orchestrator for the fresh v8 package.
///
/// Companion modules depend on maker_v8; maker_v8 does not import them. This
/// module imports both sides, derives every activation value from a concrete
/// sealed registry, and is the only public route to maker_v8's package-only
/// finalizer.
module animacraft_v8::publication_v8;

use animacraft_v8::complete_v8::{Self as complete, CompleteRegistryV8};
use animacraft_v8::composition_v8::{Self as composition, CompositionRegistryV8};
use animacraft_v8::expansion_pack_v8::{
    Self as pack,
    ExpansionPackRegistryV8,
};
use animacraft_v8::maker_v8::{
    Self as maker,
    ActivationBindingsV8,
    CapabilityCommitmentsV8,
    EconomicsV8,
    MakerAdminCapV8,
    MakerRootV8,
    MakerTreasuryV8,
    RegistryCommitmentsV8,
    RightsV8,
    RowCountsV8,
};
use animacraft_v8::physical_v8::{Self as physical, PhysicalRegistryV8};
use animacraft_v8::protocol_config_v8::{Self as protocol, ProtocolConfigV8};
use animacraft_v8::seal_v8::{Self as seal, SealRegistryV8};
use animacraft_v8::soul_v8::{Self as soul, SoulRegistryV8};
use std::option::{Self as option, Option};
use std::string::String;
use sui::clock::Clock;

const VERSION: u64 = 8;
const EPhysicalDeclarationMismatch: u64 = 0;
const EMakerSealCoverageMissing: u64 = 1;
const ECompletePackPolicyMismatch: u64 = 2;

public fun version_v8(): u64 { VERSION }

/// Creates the complete mandatory DRAFT object graph in one transaction.
/// Expected capability commitments are precomputed from immutable content and
/// canonical rows; they never contain IDs allocated by this transaction.
public fun begin_maker_v8<PaymentCoin>(
    config: &ProtocolConfigV8,
    maker_key: String,
    maker_version: String,
    previous_root_id: Option<ID>,
    previous_version_commitment: Option<vector<u8>>,
    renderer_commitment: vector<u8>,
    manifest_blob_id: String,
    manifest_sha256: vector<u8>,
    content_commitment: vector<u8>,
    expected_counts: RowCountsV8,
    expected_registry_commitments: RegistryCommitmentsV8,
    expected_capability_commitments: CapabilityCommitmentsV8,
    expected_composition_item_count: u64,
    expected_composition_rule_count: u64,
    expected_complete_output_count: u64,
    expected_physical_policy_count: u64,
    declared_capabilities: u64,
    economics: EconomicsV8,
    rights: RightsV8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let physical_declared =
        (declared_capabilities & protocol::capability_physical_v8()) != 0;
    let composition_commitment =
        *maker::capability_composition_commitment_v8(&expected_capability_commitments);
    let pack_commitment =
        *maker::capability_pack_commitment_v8(&expected_capability_commitments);
    let complete_commitment =
        *maker::capability_complete_commitment_v8(&expected_capability_commitments);
    let seal_commitment =
        *maker::capability_seal_commitment_v8(&expected_capability_commitments);
    let soul_commitment =
        *maker::capability_soul_commitment_v8(&expected_capability_commitments);
    let physical_commitment =
        maker::capability_physical_commitment_v8(&expected_capability_commitments);
    assert!(
        physical_declared == physical_commitment.is_some(),
        EPhysicalDeclarationMismatch,
    );
    if (!physical_declared) {
        assert!(expected_physical_policy_count == 0, EPhysicalDeclarationMismatch);
    };
    let expected_slot_count = maker::row_counts_slots_v8(&expected_counts);
    let expected_pack_release_count = maker::row_counts_pack_releases_v8(&expected_counts);
    let expected_protected_asset_count = maker::row_counts_protected_assets_v8(&expected_counts);
    let (root, treasury, admin) = maker::new_maker_v8<PaymentCoin>(
        config,
        maker_key,
        maker_version,
        previous_root_id,
        previous_version_commitment,
        renderer_commitment,
        manifest_blob_id,
        manifest_sha256,
        content_commitment,
        expected_counts,
        expected_registry_commitments,
        expected_capability_commitments,
        expected_physical_policy_count,
        declared_capabilities,
        economics,
        rights,
        clock,
        ctx,
    );
    let composition_registry = composition::new_composition_registry_v8(
        &root,
        &admin,
        expected_slot_count,
        expected_composition_item_count,
        expected_composition_rule_count,
        composition_commitment,
        ctx,
    );
    let pack_registry = pack::new_expansion_pack_registry_v8(
        &root,
        &admin,
        expected_pack_release_count,
        pack_commitment,
        ctx,
    );
    let complete_registry = complete::new_complete_registry_v8(
        &root,
        &admin,
        expected_complete_output_count,
        expected_pack_release_count,
        complete_commitment,
        ctx,
    );
    let seal_registry = seal::new_seal_registry_v8(
        &root,
        &admin,
        expected_protected_asset_count,
        seal_commitment,
        ctx,
    );
    let soul_registry = soul::new_soul_registry_v8(
        &root,
        &admin,
        soul_commitment,
        ctx,
    );
    if (physical_declared) {
        let physical_registry = physical::new_physical_registry_v8(
            &root,
            &admin,
            expected_physical_policy_count,
            physical_commitment.destroy_some(),
            ctx,
        );
        physical::share_physical_registry_v8(physical_registry);
    } else {
        physical_commitment.destroy_none();
    };
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    soul::share_soul_registry_v8(soul_registry);
    maker::share_maker_objects_v8(root, treasury, admin, ctx);
}

/// Atomically validates the mandatory same-package registries for a Maker that
/// does not declare Physical.
public fun seal_and_activate_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    treasury: &MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    composition_registry: &CompositionRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    complete_registry: &CompleteRegistryV8,
    seal_registry: &SealRegistryV8,
    soul_registry: &SoulRegistryV8,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_physical_declaration(root, false);
    let bindings = mandatory_bindings(
        root,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
        option::none(),
        option::none(),
        0,
    );
    maker::activate_checked_v8(
        root,
        admin,
        treasury,
        config,
        bindings,
        clock,
        ctx,
    );
}

/// Physical activation accepts the concrete same-package registry type. A
/// foreign TypeOrigin cannot satisfy this signature or construct its fields.
public fun seal_and_activate_physical_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    treasury: &MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    composition_registry: &CompositionRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    complete_registry: &CompleteRegistryV8,
    seal_registry: &SealRegistryV8,
    soul_registry: &SoulRegistryV8,
    physical_registry: &PhysicalRegistryV8,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_physical_declaration(root, true);
    let (physical_registry_id, physical_commitment, physical_policy_count) =
        physical::assert_activation_ready_v8(physical_registry, root);
    let bindings = mandatory_bindings(
        root,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
        option::some(physical_registry_id),
        option::some(physical_commitment),
        physical_policy_count,
    );
    maker::activate_checked_v8(
        root,
        admin,
        treasury,
        config,
        bindings,
        clock,
        ctx,
    );
}

/// A paused Root is resumed only after the same concrete registries are still
/// sealed, bound to the current ownership epoch, and equal to the activation
/// tuple already recorded by the Root.
public fun resume_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    composition_registry: &CompositionRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    complete_registry: &CompleteRegistryV8,
    seal_registry: &SealRegistryV8,
    soul_registry: &SoulRegistryV8,
    ctx: &TxContext,
) {
    assert_physical_declaration(root, false);
    let bindings = mandatory_bindings(
        root,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
        option::none(),
        option::none(),
        0,
    );
    maker::assert_bound_activation_v8(root, &bindings);
    maker::resume_checked_v8(root, admin, config, ctx);
}

public fun resume_physical_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    config: &ProtocolConfigV8,
    composition_registry: &CompositionRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    complete_registry: &CompleteRegistryV8,
    seal_registry: &SealRegistryV8,
    soul_registry: &SoulRegistryV8,
    physical_registry: &PhysicalRegistryV8,
    ctx: &TxContext,
) {
    assert_physical_declaration(root, true);
    let (physical_registry_id, physical_commitment, physical_policy_count) =
        physical::assert_activation_ready_v8(physical_registry, root);
    let bindings = mandatory_bindings(
        root,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
        option::some(physical_registry_id),
        option::some(physical_commitment),
        physical_policy_count,
    );
    maker::assert_bound_activation_v8(root, &bindings);
    maker::resume_checked_v8(root, admin, config, ctx);
}

/// Atomically advances every authoritative per-Maker registry to the next
/// ownership epoch before core mutates the Root and transfers the exact cap.
/// Pack releases and wallet loadouts intentionally remain stale until their
/// separate co-authorized readmission/recovery paths run.
public fun transfer_maker_control_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    composition_registry: &mut CompositionRegistryV8,
    pack_registry: &mut ExpansionPackRegistryV8,
    complete_registry: &mut CompleteRegistryV8,
    seal_registry: &mut SealRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    recipient: address,
    ctx: &TxContext,
) {
    maker::assert_current_admin_v8(root, &admin);
    assert_physical_declaration(root, false);
    rebind_mandatory(
        root,
        &admin,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
    );
    maker::transfer_control_checked_v8(root, admin, recipient, ctx);
}


public fun transfer_physical_maker_control_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: MakerAdminCapV8,
    composition_registry: &mut CompositionRegistryV8,
    pack_registry: &mut ExpansionPackRegistryV8,
    complete_registry: &mut CompleteRegistryV8,
    seal_registry: &mut SealRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    physical_registry: &mut PhysicalRegistryV8,
    recipient: address,
    ctx: &TxContext,
) {
    maker::assert_current_admin_v8(root, &admin);
    assert_physical_declaration(root, true);
    let next_epoch = maker::ownership_epoch_v8(root) + 1;
    rebind_mandatory(
        root,
        &admin,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
    );
    physical::rebind_ownership_epoch_v8(
        physical_registry,
        root,
        &admin,
        next_epoch,
    );
    maker::transfer_control_checked_v8(root, admin, recipient, ctx);
}

fun mandatory_bindings<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    composition_registry: &CompositionRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    complete_registry: &CompleteRegistryV8,
    seal_registry: &SealRegistryV8,
    soul_registry: &SoulRegistryV8,
    physical_registry_id: Option<ID>,
    physical_commitment: Option<vector<u8>>,
    physical_policy_count: u64,
): ActivationBindingsV8 {
    let (
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
    ) = composition::assert_activation_ready_v8(composition_registry, root);
    let (
        pack_registry_id,
        pack_commitment,
        pack_release_count,
        pack_protected_style_count,
    ) = pack::assert_activation_ready_v8(pack_registry, root);
    let (
        complete_registry_id,
        complete_commitment,
        _complete_output_count,
        complete_protected_output_count,
        complete_pack_policy_count,
    ) = complete::assert_activation_ready_v8(complete_registry, root);
    assert!(complete_pack_policy_count == pack_release_count, ECompletePackPolicyMismatch);
    let (
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
    ) = seal::assert_activation_ready_v8(seal_registry, root);
    let (soul_registry_id, soul_commitment) =
        soul::assert_activation_ready_v8(soul_registry, root);
    assert_maker_style_seal_coverage(root, seal_registry);
    maker::new_activation_bindings_v8(
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
        pack_registry_id,
        pack_commitment,
        pack_release_count,
        pack_protected_style_count,
        complete_registry_id,
        complete_commitment,
        complete_protected_output_count,
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
        soul_registry_id,
        soul_commitment,
        physical_registry_id,
        physical_commitment,
        physical_policy_count,
    )
}

fun rebind_mandatory<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    composition_registry: &mut CompositionRegistryV8,
    pack_registry: &mut ExpansionPackRegistryV8,
    complete_registry: &mut CompleteRegistryV8,
    seal_registry: &mut SealRegistryV8,
    soul_registry: &mut SoulRegistryV8,
) {
    let next_epoch = maker::ownership_epoch_v8(root) + 1;
    composition::rebind_ownership_epoch_v8(composition_registry, root, admin, next_epoch);
    pack::rebind_ownership_epoch_v8(pack_registry, root, admin, next_epoch);
    complete::rebind_ownership_epoch_v8(complete_registry, root, admin, next_epoch);
    seal::rebind_ownership_epoch_v8(seal_registry, root, admin, next_epoch);
    soul::rebind_ownership_epoch_v8(soul_registry, root, admin, next_epoch);
}

fun assert_physical_declaration<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    expected: bool,
) {
    let declared =
        (maker::root_declared_capabilities_v8(root) & protocol::capability_physical_v8()) != 0;
    assert!(declared == expected, EPhysicalDeclarationMismatch);
}

fun assert_maker_style_seal_coverage<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    seal_registry: &SealRegistryV8,
) {
    let root_content_commitment = *maker::content_commitment_v8(root);
    let scope_key = seal::maker_style_scope_key_v8();
    let scope_commitment =
        seal::maker_style_scope_commitment_v8(root_content_commitment);
    let mut index = 0;
    let protected_style_count = maker::protected_style_count_v8(root);
    while (index < protected_style_count) {
        let (part_key, item_key, style_key, asset_commitment) =
            maker::protected_style_coverage_row_v8(root, index);
        let asset_key = seal::style_asset_key_v8(part_key, item_key, style_key);
        let seal_id = seal::derive_seal_id_v8(
            root_content_commitment,
            seal::scope_maker_style_v8(),
            scope_key,
            scope_commitment,
            asset_key,
            asset_commitment,
        );
        assert!(
            seal::check_asset_covered_v8(
                seal_registry,
                root,
                seal::scope_maker_style_v8(),
                scope_key,
                &scope_commitment,
                asset_key,
                &asset_commitment,
                &seal_id,
            ),
            EMakerSealCoverageMissing,
        );
        index = index + 1;
    };
}

#[test_only]
public struct PhysicalFixtureV8 {
    config: ProtocolConfigV8,
    protocol_treasury:
        animacraft_v8::protocol_config_v8::ProtocolTreasuryV8<sui::sui::SUI>,
    protocol_cap: animacraft_v8::protocol_config_v8::ProtocolAdminCapV8,
    root: MakerRootV8<sui::sui::SUI>,
    treasury: MakerTreasuryV8<sui::sui::SUI>,
    admin: MakerAdminCapV8,
    composition_registry: CompositionRegistryV8,
    pack_registry: ExpansionPackRegistryV8,
    complete_registry: CompleteRegistryV8,
    seal_registry: SealRegistryV8,
    soul_registry: SoulRegistryV8,
    physical_registry: PhysicalRegistryV8,
}

#[test_only]
fun new_physical_fixture_v8(
    root_expected_physical_policy_count: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): PhysicalFixtureV8 {
    let root_content_commitment = maker::test_digest(3);
    let composition_commitment =
        composition::empty_registry_commitment_v8(root_content_commitment);
    let pack_commitment = pack::empty_registry_commitment_v8(root_content_commitment);
    let complete_commitment = complete::empty_registry_commitment_v8(root_content_commitment);
    let seal_commitment = seal::empty_registry_commitment_v8(root_content_commitment);
    let soul_commitment = soul::registry_commitment_v8(root_content_commitment);
    let physical_empty = physical::empty_registry_commitment_v8(root_content_commitment);
    let physical_commitment = physical::advance_policy_commitment_v8(
        root_content_commitment,
        0,
        physical_empty,
        physical::source_maker_style_v8(),
        physical::maker_style_scope_key_v8(),
        root_content_commitment,
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
        maker::test_digest(24),
        maker::test_digest(40),
        1,
        true,
    );
    let expected_counts = maker::new_row_counts_v8(1, 1, 1, 1, 0, 0, 0, 0, 0);
    let expected_capability_commitments = maker::new_capability_commitments_v8(
        composition_commitment,
        pack_commitment,
        complete_commitment,
        seal_commitment,
        soul_commitment,
        option::some(physical_commitment),
    );
    let economics = maker::new_economics_v8(
        maker::access_free_v8(),
        0,
        maker::access_free_v8(),
        0,
        0,
        0,
        protocol::default_primary_protocol_fee_bps_v8(),
    );
    let rights = maker::new_rights_v8(
        maker::rights_onchain_native_v8(),
        true,
        250,
        250,
        500,
    );
    let (config, protocol_treasury, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, ctx);
    let (mut root, treasury, admin) = maker::new_maker_v8<sui::sui::SUI>(
        &config,
        b"physical-maker-test".to_string(),
        b"8.0.0".to_string(),
        option::none(),
        option::none(),
        maker::test_digest(1),
        b"walrus-manifest".to_string(),
        maker::test_digest(2),
        root_content_commitment,
        expected_counts,
        maker::test_registry_commitments(false, root_content_commitment),
        expected_capability_commitments,
        root_expected_physical_policy_count,
        protocol::required_capabilities_v8() | protocol::capability_physical_v8(),
        economics,
        rights,
        clock,
        ctx,
    );
    let mut composition_registry = composition::new_composition_registry_v8(
        &root,
        &admin,
        0,
        0,
        0,
        composition_commitment,
        ctx,
    );
    let mut pack_registry = pack::new_expansion_pack_registry_v8(
        &root,
        &admin,
        0,
        pack_commitment,
        ctx,
    );
    let mut complete_registry = complete::new_complete_registry_v8(
        &root,
        &admin,
        0,
        0,
        complete_commitment,
        ctx,
    );
    let mut seal_registry = seal::new_seal_registry_v8(
        &root,
        &admin,
        0,
        seal_commitment,
        ctx,
    );
    let soul_registry = soul::new_soul_registry_v8(
        &root,
        &admin,
        soul_commitment,
        ctx,
    );
    let mut physical_registry = physical::new_physical_registry_v8(
        &root,
        &admin,
        1,
        physical_commitment,
        ctx,
    );
    maker::append_test_rows(&mut root, &admin, false);
    physical::append_maker_style_policy_v8(
        &mut physical_registry,
        &root,
        &admin,
        0,
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
        maker::test_digest(24),
        maker::test_digest(40),
        1,
        true,
    );
    composition::seal_composition_registry_v8(&mut composition_registry, &root, &admin);
    pack::seal_expansion_pack_registry_v8(&mut pack_registry, &root, &admin);
    complete::seal_complete_registry_v8(&mut complete_registry, &root, &admin);
    seal::seal_registry_v8(&mut seal_registry, &root, &admin);
    physical::seal_physical_registry_v8(&mut physical_registry, &root, &admin);
    PhysicalFixtureV8 {
        config,
        protocol_treasury,
        protocol_cap,
        root,
        treasury,
        admin,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
        physical_registry,
    }
}

#[test_only]
fun activate_physical_fixture_v8(
    fixture: &mut PhysicalFixtureV8,
    clock: &Clock,
    ctx: &TxContext,
) {
    seal_and_activate_physical_maker_v8(
        &mut fixture.root,
        &fixture.admin,
        &fixture.treasury,
        &fixture.config,
        &fixture.composition_registry,
        &fixture.pack_registry,
        &fixture.complete_registry,
        &fixture.seal_registry,
        &fixture.soul_registry,
        &fixture.physical_registry,
        clock,
        ctx,
    );
}

#[test_only]
fun share_physical_fixture_v8(fixture: PhysicalFixtureV8, ctx: &TxContext) {
    let PhysicalFixtureV8 {
        config,
        protocol_treasury,
        protocol_cap,
        root,
        treasury,
        admin,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
        physical_registry,
    } = fixture;
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    soul::share_soul_registry_v8(soul_registry);
    physical::share_physical_registry_v8(physical_registry);
    maker::share_maker_objects_v8(root, treasury, admin, ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
}

#[test]
fun physical_maker_activates_and_materializes_exact_policy() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 801, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    assert!(maker::root_lifecycle_v8(&fixture.root) == maker::lifecycle_active_v8(), 0);
    assert!(maker::root_expected_physical_policy_count_v8(&fixture.root) == 1, 0);
    let root = &fixture.root;
    let admin = &fixture.admin;
    let root_content_commitment = *maker::content_commitment_v8(root);
    physical::materialize_physical_v8(
        &mut fixture.physical_registry,
        root,
        admin,
        physical::source_maker_style_v8(),
        physical::maker_style_scope_key_v8(),
        root_content_commitment,
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
        @0xA11,
        &mut ctx,
    );
    assert!(physical::registry_total_materialized_v8(&fixture.physical_registry) == 1, 0);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun included_pack_uses_free_maker_access_without_pack_pass() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 830, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let (mut release, pack_admin) =
        pack::new_active_release_and_admin_for_testing(&fixture.root, &mut ctx);
    pack::set_included_access_for_testing(&mut release);
    let proof = pack::authorize_pack_style_v8(
        &release,
        &fixture.root,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        &ctx,
    );
    let (_, _, _, _, _, _, _, _, _, _, holder, _, _, _, _, _, _) =
        pack::consume_style_access_proof_v8(proof);
    assert!(holder == @0xA11, 0);
    pack::share_release_and_admin_for_testing(release, pack_admin, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 18, location = animacraft_v8::maker_v8)]
fun included_pack_rejects_paid_maker_without_maker_pass() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 831, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    maker::set_paid_maker_access_for_testing(&mut fixture.root, 1_000);
    let (mut release, pack_admin) =
        pack::new_active_release_and_admin_for_testing(&fixture.root, &mut ctx);
    pack::set_included_access_for_testing(&mut release);
    let proof = pack::authorize_pack_style_v8(
        &release,
        &fixture.root,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        &ctx,
    );
    let (_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _) =
        pack::consume_style_access_proof_v8(proof);
    pack::share_release_and_admin_for_testing(release, pack_admin, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun included_pack_accepts_current_paid_maker_pass() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 832, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    maker::set_paid_maker_access_for_testing(&mut fixture.root, 1_000);
    let payment = sui::coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    let config = &fixture.config;
    let protocol_treasury = &mut fixture.protocol_treasury;
    let root = &mut fixture.root;
    let treasury = &mut fixture.treasury;
    maker::purchase_maker_pass_v8(
        root,
        treasury,
        config,
        protocol_treasury,
        payment,
        &clock,
        &mut ctx,
    );
    let (mut release, pack_admin) =
        pack::new_active_release_and_admin_for_testing(&fixture.root, &mut ctx);
    pack::set_included_access_for_testing(&mut release);
    let proof = pack::authorize_pack_style_v8(
        &release,
        &fixture.root,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        &ctx,
    );
    let (_, _, _, _, _, _, _, _, _, _, holder, _, _, _, _, _, _) =
        pack::consume_style_access_proof_v8(proof);
    assert!(holder == @0xA11, 0);
    maker::withdraw_maker_revenue_v8(
        &fixture.root,
        &fixture.admin,
        &mut fixture.treasury,
        900,
        @0xB11,
        &mut ctx,
    );
    protocol::withdraw_protocol_revenue_v8(
        &fixture.config,
        &fixture.protocol_cap,
        &mut fixture.protocol_treasury,
        100,
        @0xB12,
        &mut ctx,
    );
    pack::share_release_and_admin_for_testing(release, pack_admin, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun paid_complete_settles_exact_content_subtotal() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 833, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    maker::set_complete_policy_for_testing(
        &mut fixture.root,
        maker::complete_paid_every_time_v8(),
        1_600,
        0,
        0,
    );
    let authorization = complete::new_sealed_authorization_for_soul_testing(
        &fixture.complete_registry,
        &fixture.root,
        @0xA11,
    );
    assert!(complete::authorization_required_content_payment_v8(&authorization) == 1_600, 0);
    let payment = sui::coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(1_600),
        &mut ctx,
    );
    let root = &fixture.root;
    let config = &fixture.config;
    let treasury = &mut fixture.treasury;
    let protocol_treasury = &mut fixture.protocol_treasury;
    let complete_registry = &mut fixture.complete_registry;
    let soul_authorization = complete::complete_with_payment_v8(
        complete_registry,
        root,
        treasury,
        config,
        protocol_treasury,
        payment,
        authorization,
        &clock,
        &mut ctx,
    );
    consume_complete_soul_authorization_for_testing(soul_authorization);
    assert!(maker::maker_treasury_balance_v8(&fixture.treasury) == 1_440, 0);
    assert!(protocol::protocol_treasury_balance_v8(&fixture.protocol_treasury) == 160, 0);
    maker::withdraw_maker_revenue_v8(
        &fixture.root,
        &fixture.admin,
        &mut fixture.treasury,
        1_440,
        @0xB11,
        &mut ctx,
    );
    protocol::withdraw_protocol_revenue_v8(
        &fixture.config,
        &fixture.protocol_cap,
        &mut fixture.protocol_treasury,
        160,
        @0xB12,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 16, location = animacraft_v8::maker_v8)]
fun paid_complete_rejects_wrong_gross_payment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 838, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    maker::set_complete_policy_for_testing(
        &mut fixture.root,
        maker::complete_paid_every_time_v8(),
        1_600,
        0,
        0,
    );
    let authorization = complete::new_sealed_authorization_for_soul_testing(
        &fixture.complete_registry,
        &fixture.root,
        @0xA11,
    );
    let payment = sui::coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(1_599),
        &mut ctx,
    );
    let root = &fixture.root;
    let config = &fixture.config;
    let treasury = &mut fixture.treasury;
    let protocol_treasury = &mut fixture.protocol_treasury;
    let complete_registry = &mut fixture.complete_registry;
    let soul_authorization = complete::complete_with_payment_v8(
        complete_registry,
        root,
        treasury,
        config,
        protocol_treasury,
        payment,
        authorization,
        &clock,
        &mut ctx,
    );
    consume_complete_soul_authorization_for_testing(soul_authorization);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun quota_then_paid_is_free_once_then_paid() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 834, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    maker::set_complete_policy_for_testing(
        &mut fixture.root,
        maker::complete_free_quota_then_paid_v8(),
        1_000,
        1,
        0,
    );
    let first = complete::new_sealed_authorization_for_soul_testing(
        &fixture.complete_registry,
        &fixture.root,
        @0xA11,
    );
    assert!(complete::authorization_required_content_payment_v8(&first) == 0, 0);
    let root = &fixture.root;
    let config = &fixture.config;
    let complete_registry = &mut fixture.complete_registry;
    let soul_authorization = complete::complete_without_payment_v8(
        complete_registry,
        root,
        config,
        first,
        &clock,
        &mut ctx,
    );
    consume_complete_soul_authorization_for_testing(soul_authorization);
    let second = complete::new_sealed_authorization_for_soul_testing(
        &fixture.complete_registry,
        &fixture.root,
        @0xA11,
    );
    assert!(complete::authorization_required_content_payment_v8(&second) == 1_000, 0);
    let payment = sui::coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(1_000),
        &mut ctx,
    );
    let root = &fixture.root;
    let config = &fixture.config;
    let treasury = &mut fixture.treasury;
    let protocol_treasury = &mut fixture.protocol_treasury;
    let complete_registry = &mut fixture.complete_registry;
    let soul_authorization = complete::complete_with_payment_v8(
        complete_registry,
        root,
        treasury,
        config,
        protocol_treasury,
        payment,
        second,
        &clock,
        &mut ctx,
    );
    consume_complete_soul_authorization_for_testing(soul_authorization);
    assert!(complete::wallet_complete_count_v8(&fixture.complete_registry, @0xA11) == 2, 0);
    maker::withdraw_maker_revenue_v8(
        &fixture.root,
        &fixture.admin,
        &mut fixture.treasury,
        900,
        @0xB11,
        &mut ctx,
    );
    protocol::withdraw_protocol_revenue_v8(
        &fixture.config,
        &fixture.protocol_cap,
        &mut fixture.protocol_treasury,
        100,
        @0xB12,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun registered_pack_complete_policy_is_activated_and_charged_once() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 836, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let root_content = maker::test_digest(3);
    let composition_commitment = composition::empty_registry_commitment_v8(root_content);
    let seal_commitment = seal::empty_registry_commitment_v8(root_content);
    let soul_commitment = soul::registry_commitment_v8(root_content);
    let namespace = b"test".to_string();
    let pack_key = b"orphan".to_string();
    let manifest_commitment = maker::test_digest(41);
    let release_content = maker::test_digest(42);
    let style_empty = pack::empty_style_registry_commitment_v8(
        root_content,
        namespace,
        pack_key,
        manifest_commitment,
        release_content,
    );
    let style_commitment = pack::advance_style_commitment_v8(
        root_content,
        namespace,
        pack_key,
        manifest_commitment,
        release_content,
        0,
        style_empty,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        b"walrus-pack-style".to_string(),
        maker::test_digest(24),
        false,
        vector[],
    );
    let pack_commitment = pack::advance_release_commitment_v8(
        root_content,
        0,
        pack::empty_registry_commitment_v8(root_content),
        namespace,
        pack_key,
        manifest_commitment,
        release_content,
        style_commitment,
        pack::access_free_v8(),
        0,
        maker::complete_paid_every_time_v8(),
        600,
        0,
        0,
        0,
        seal_commitment,
    );
    let pack_scope_key = pack::pack_seal_scope_key_v8(namespace, pack_key);
    let complete_commitment = complete::advance_pack_policy_commitment_v8(
        root_content,
        0,
        complete::empty_registry_commitment_v8(root_content),
        pack_scope_key,
        release_content,
        maker::complete_paid_every_time_v8(),
        600,
        0,
        0,
    );
    let core_commitments = maker::test_registry_commitments(false, root_content);
    let capabilities = maker::new_capability_commitments_v8(
        composition_commitment,
        pack_commitment,
        complete_commitment,
        seal_commitment,
        soul_commitment,
        option::none(),
    );
    let economics = maker::new_economics_v8(
        maker::access_free_v8(),
        0,
        maker::complete_unlimited_free_v8(),
        0,
        0,
        0,
        protocol::default_primary_protocol_fee_bps_v8(),
    );
    let rights = maker::new_rights_v8(
        maker::rights_onchain_native_v8(),
        true,
        250,
        250,
        500,
    );
    let (config, mut protocol_treasury, protocol_cap) =
        protocol::new_protocol_for_testing<sui::sui::SUI>(true, &mut ctx);
    let (mut root, mut maker_treasury, maker_admin) = maker::new_maker_v8<sui::sui::SUI>(
        &config,
        b"pack-complete-maker".to_string(),
        b"8.0.0".to_string(),
        option::none(),
        option::none(),
        maker::test_digest(1),
        b"walrus-manifest".to_string(),
        maker::test_digest(2),
        root_content,
        maker::new_row_counts_v8(1, 1, 1, 1, 0, 0, 0, 1, 0),
        core_commitments,
        capabilities,
        0,
        protocol::required_capabilities_v8(),
        economics,
        rights,
        &clock,
        &mut ctx,
    );
    let mut composition_registry = composition::new_composition_registry_v8(
        &root,
        &maker_admin,
        0,
        0,
        0,
        composition_commitment,
        &mut ctx,
    );
    let mut pack_registry = pack::new_expansion_pack_registry_v8(
        &root,
        &maker_admin,
        1,
        pack_commitment,
        &mut ctx,
    );
    let mut complete_registry = complete::new_complete_registry_v8(
        &root,
        &maker_admin,
        0,
        1,
        complete_commitment,
        &mut ctx,
    );
    let mut seal_registry = seal::new_seal_registry_v8(
        &root,
        &maker_admin,
        0,
        seal_commitment,
        &mut ctx,
    );
    let soul_registry = soul::new_soul_registry_v8(
        &root,
        &maker_admin,
        soul_commitment,
        &mut ctx,
    );
    let (mut release, pack_admin) =
        pack::new_sealed_release_and_admin_for_testing(&root, &mut ctx);
    maker::append_test_rows(&mut root, &maker_admin, false);
    pack::bind_seal_and_complete_policy_for_testing(
        &mut release,
        &seal_registry,
        maker::complete_paid_every_time_v8(),
        600,
        0,
        0,
    );
    pack::append_release_to_registry_v8(
        &mut pack_registry,
        &release,
        &root,
        &maker_admin,
        0,
    );
    complete::append_complete_pack_policy_v8(
        &mut complete_registry,
        &pack_registry,
        &release,
        &root,
        &maker_admin,
        0,
    );
    composition::seal_composition_registry_v8(
        &mut composition_registry,
        &root,
        &maker_admin,
    );
    pack::seal_expansion_pack_registry_v8(&mut pack_registry, &root, &maker_admin);
    complete::seal_complete_registry_v8(&mut complete_registry, &root, &maker_admin);
    seal::seal_registry_v8(&mut seal_registry, &root, &maker_admin);
    seal_and_activate_maker_v8(
        &mut root,
        &maker_admin,
        &maker_treasury,
        &config,
        &composition_registry,
        &pack_registry,
        &complete_registry,
        &seal_registry,
        &soul_registry,
        &clock,
        &ctx,
    );
    pack::activate_expansion_pack_v8(
        &mut release,
        &pack_registry,
        &root,
        &maker_admin,
        &pack_admin,
        &ctx,
    );
    pack::claim_free_expansion_pack_v8(&mut release, &root, &clock, &mut ctx);
    let proof = pack::authorize_pack_style_v8(
        &release,
        &root,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        &ctx,
    );
    let selection_commitment = complete::advance_required_pack_selection_commitment_v8(
        root_content,
        0,
        complete::empty_required_pack_selection_commitment_v8(root_content),
        pack_scope_key,
        release_content,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        maker::test_digest(24),
        false,
        vector[],
    );
    let mut authorization = complete::new_pack_authorization_for_testing(
        &complete_registry,
        &root,
        @0xA11,
        selection_commitment,
    );
    complete::append_pack_style_to_complete_v8(
        &mut authorization,
        &complete_registry,
        proof,
    );
    complete::seal_complete_authorization_v8(&mut authorization);
    assert!(complete::authorization_required_content_payment_v8(&authorization) == 600, 0);
    let payment = sui::coin::from_balance(
        sui::balance::create_for_testing<sui::sui::SUI>(600),
        &mut ctx,
    );
    let soul_authorization = complete::complete_with_payment_v8(
        &mut complete_registry,
        &root,
        &mut maker_treasury,
        &config,
        &mut protocol_treasury,
        payment,
        authorization,
        &clock,
        &mut ctx,
    );
    consume_complete_soul_authorization_for_testing(soul_authorization);
    assert!(complete::registry_pack_policy_count_v8(&complete_registry) == 1, 0);
    assert!(complete::pack_wallet_complete_count_v8(
        &complete_registry,
        pack_scope_key,
        @0xA11,
    ) == 1, 0);
    assert!(complete::pack_total_complete_count_v8(
        &complete_registry,
        pack_scope_key,
    ) == 1, 0);
    maker::withdraw_maker_revenue_v8(
        &root,
        &maker_admin,
        &mut maker_treasury,
        540,
        @0xB11,
        &mut ctx,
    );
    protocol::withdraw_protocol_revenue_v8(
        &config,
        &protocol_cap,
        &mut protocol_treasury,
        60,
        @0xB12,
        &mut ctx,
    );
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    soul::share_soul_registry_v8(soul_registry);
    pack::share_release_and_admin_for_testing(release, pack_admin, &ctx);
    maker::share_maker_objects_v8(root, maker_treasury, maker_admin, &ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 12, location = animacraft_v8::complete_v8)]
fun concurrent_complete_authorization_cannot_bypass_cas() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 835, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let first = complete::new_sealed_authorization_for_soul_testing(
        &fixture.complete_registry,
        &fixture.root,
        @0xA11,
    );
    let stale = complete::new_sealed_authorization_for_soul_testing(
        &fixture.complete_registry,
        &fixture.root,
        @0xA11,
    );
    let root = &fixture.root;
    let config = &fixture.config;
    let complete_registry = &mut fixture.complete_registry;
    let soul_authorization = complete::complete_without_payment_v8(
        complete_registry,
        root,
        config,
        first,
        &clock,
        &mut ctx,
    );
    consume_complete_soul_authorization_for_testing(soul_authorization);
    let root = &fixture.root;
    let config = &fixture.config;
    let complete_registry = &mut fixture.complete_registry;
    let soul_authorization = complete::complete_without_payment_v8(
        complete_registry,
        root,
        config,
        stale,
        &clock,
        &mut ctx,
    );
    consume_complete_soul_authorization_for_testing(soul_authorization);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun physical_commitment_is_independent_of_object_identity() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 802, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let fixture_a = new_physical_fixture_v8(1, &clock, &mut ctx);
    let fixture_b = new_physical_fixture_v8(1, &clock, &mut ctx);
    assert!(maker::root_id_v8(&fixture_a.root) != maker::root_id_v8(&fixture_b.root), 0);
    assert!(
        physical::registry_id_v8(&fixture_a.physical_registry)
            != physical::registry_id_v8(&fixture_b.physical_registry),
        0,
    );
    assert!(
        physical::registry_commitment_v8(&fixture_a.physical_registry)
            == physical::registry_commitment_v8(&fixture_b.physical_registry),
        0,
    );
    share_physical_fixture_v8(fixture_a, &ctx);
    share_physical_fixture_v8(fixture_b, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::physical_v8)]
fun physical_wrong_root_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 803, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    physical::corrupt_registry_root_for_testing(
        &mut fixture.physical_registry,
        object::id_from_address(@0xBEEF),
    );
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::physical_v8)]
fun physical_wrong_epoch_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 804, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    physical::corrupt_registry_epoch_for_testing(&mut fixture.physical_registry);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::physical_v8)]
fun physical_wrong_content_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 805, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    physical::corrupt_registry_content_for_testing(
        &mut fixture.physical_registry,
        maker::test_digest(99),
    );
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 1, location = animacraft_v8::physical_v8)]
fun physical_wrong_commitment_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 806, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    physical::corrupt_registry_commitment_for_testing(
        &mut fixture.physical_registry,
        maker::test_digest(99),
    );
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 11, location = animacraft_v8::maker_v8)]
fun physical_policy_count_mismatch_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 807, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(0, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = ECompletePackPolicyMismatch)]
fun complete_pack_policy_count_must_equal_registered_pack_count() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 837, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    complete::set_pack_policy_count_for_testing(&mut fixture.complete_registry, 1);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::maker_v8)]
fun physical_activation_replay_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 808, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 10, location = animacraft_v8::physical_v8)]
fun physical_materialization_replay_exhausts_supply() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 809, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let root = &fixture.root;
    let admin = &fixture.admin;
    let root_content_commitment = *maker::content_commitment_v8(root);
    physical::materialize_physical_v8(
        &mut fixture.physical_registry,
        root,
        admin,
        physical::source_maker_style_v8(),
        physical::maker_style_scope_key_v8(),
        root_content_commitment,
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
        @0xA11,
        &mut ctx,
    );
    physical::materialize_physical_v8(
        &mut fixture.physical_registry,
        root,
        admin,
        physical::source_maker_style_v8(),
        physical::maker_style_scope_key_v8(),
        root_content_commitment,
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
        @0xA11,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 11, location = animacraft_v8::physical_v8)]
fun physical_materialization_requires_current_owner() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 810, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let mut wrong_ctx = sui::tx_context::new_from_hint(@0xB11, 811, 0, 0, 0);
    let root = &fixture.root;
    let admin = &fixture.admin;
    let root_content_commitment = *maker::content_commitment_v8(root);
    physical::materialize_physical_v8(
        &mut fixture.physical_registry,
        root,
        admin,
        physical::source_maker_style_v8(),
        physical::maker_style_scope_key_v8(),
        root_content_commitment,
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
        @0xB11,
        &mut wrong_ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun physical_asset_epoch_recovery_is_explicit() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 812, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let PhysicalFixtureV8 {
        config,
        protocol_treasury,
        protocol_cap,
        mut root,
        treasury,
        admin,
        mut composition_registry,
        mut pack_registry,
        mut complete_registry,
        mut seal_registry,
        mut soul_registry,
        mut physical_registry,
    } = fixture;
    let mut asset = physical::new_current_asset_for_testing(
        &physical_registry,
        &root,
        @0xA11,
        true,
        &mut ctx,
    );
    transfer_physical_maker_control_v8(
        &mut root,
        admin,
        &mut composition_registry,
        &mut pack_registry,
        &mut complete_registry,
        &mut seal_registry,
        &mut soul_registry,
        &mut physical_registry,
        @0xB11,
        &ctx,
    );
    physical::recover_physical_epoch_v8(&mut asset, &physical_registry, &root, &ctx);
    assert!(
        physical::asset_ownership_epoch_v8(&asset)
            == physical::registry_ownership_epoch_v8(&physical_registry),
        0,
    );
    physical::consume_physical_v8(&mut physical_registry, &root, asset, &ctx);
    assert!(physical::registry_total_consumed_v8(&physical_registry) == 1, 0);
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    soul::share_soul_registry_v8(soul_registry);
    physical::share_physical_registry_v8(physical_registry);
    maker::share_maker_without_admin_for_testing(root, treasury);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::physical_v8)]
fun stale_physical_asset_must_recover_before_use() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 813, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let PhysicalFixtureV8 {
        config,
        protocol_treasury,
        protocol_cap,
        mut root,
        treasury,
        admin,
        mut composition_registry,
        mut pack_registry,
        mut complete_registry,
        mut seal_registry,
        mut soul_registry,
        mut physical_registry,
    } = fixture;
    let asset = physical::new_current_asset_for_testing(
        &physical_registry,
        &root,
        @0xA11,
        true,
        &mut ctx,
    );
    transfer_physical_maker_control_v8(
        &mut root,
        admin,
        &mut composition_registry,
        &mut pack_registry,
        &mut complete_registry,
        &mut seal_registry,
        &mut soul_registry,
        &mut physical_registry,
        @0xB11,
        &ctx,
    );
    physical::consume_physical_v8(&mut physical_registry, &root, asset, &ctx);
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    soul::share_soul_registry_v8(soul_registry);
    physical::share_physical_registry_v8(physical_registry);
    maker::share_maker_without_admin_for_testing(root, treasury);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::expansion_pack_v8)]
fun orphan_pack_release_cannot_back_physical_policy() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 814, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    let release = pack::new_orphan_sealed_release_for_testing(&fixture.root, &mut ctx);
    let pack_registry = &fixture.pack_registry;
    let root = &fixture.root;
    let admin = &fixture.admin;
    physical::append_pack_style_policy_v8(
        &mut fixture.physical_registry,
        pack_registry,
        root,
        admin,
        &release,
        1,
        b"face".to_string(),
        b"base".to_string(),
        b"pack".to_string(),
        maker::test_digest(24),
        maker::test_digest(40),
        1,
        true,
    );
    pack::share_release_for_testing(release);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun transferable_physical_asset_uses_module_mediated_path() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 815, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let asset = physical::new_current_asset_for_testing(
        &fixture.physical_registry,
        &fixture.root,
        @0xA11,
        true,
        &mut ctx,
    );
    physical::transfer_physical_v8(
        asset,
        &fixture.physical_registry,
        &fixture.root,
        @0xB11,
        &ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 12, location = animacraft_v8::physical_v8)]
fun nontransferable_physical_asset_is_rejected() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 816, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let asset = physical::new_current_asset_for_testing(
        &fixture.physical_registry,
        &fixture.root,
        @0xA11,
        false,
        &mut ctx,
    );
    physical::transfer_physical_v8(
        asset,
        &fixture.physical_registry,
        &fixture.root,
        @0xB11,
        &ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test_only]
fun complete_for_soul_testing(
    fixture: &mut PhysicalFixtureV8,
    clock: &Clock,
    ctx: &mut TxContext,
): complete::SoulMintAuthorizationV8 {
    let root = &fixture.root;
    let authorization = complete::new_sealed_authorization_for_soul_testing(
        &fixture.complete_registry,
        root,
        ctx.sender(),
    );
    complete::complete_without_payment_v8(
        &mut fixture.complete_registry,
        root,
        &fixture.config,
        authorization,
        clock,
        ctx,
    )
}

#[test_only]
fun consume_complete_soul_authorization_for_testing(
    authorization: complete::SoulMintAuthorizationV8,
) {
    let (_, _, _, _, _, _, _, _, _, _, _, _) =
        complete::consume_soul_mint_authorization_v8(authorization);
}

#[test]
fun complete_mints_native_canonical_soul_in_same_ptb() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 820, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let authorization = complete_for_soul_testing(&mut fixture, &clock, &mut ctx);
    let root = &fixture.root;
    soul::mint_canonical_soul_v8(
        &mut fixture.soul_registry,
        root,
        authorization,
        &mut ctx,
    );
    assert!(complete::registry_total_completes_v8(&fixture.complete_registry) == 1, 0);
    assert!(soul::soul_registry_minted_count_v8(&fixture.soul_registry) == 1, 0);
    assert!(maker::root_soul_registry_id_v8(&fixture.root).is_some(), 0);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::maker_v8)]
fun paused_root_cannot_create_runtime_loadout() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 829, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let admin = &fixture.admin;
    maker::pause_maker_v8(&mut fixture.root, admin, &ctx);
    composition::create_owned_loadout_v8(
        &fixture.composition_registry,
        &fixture.root,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::maker_v8)]
fun paused_root_cannot_mint_canonical_soul() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 821, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let authorization = complete_for_soul_testing(&mut fixture, &clock, &mut ctx);
    let admin = &fixture.admin;
    maker::pause_maker_v8(&mut fixture.root, admin, &ctx);
    let root = &fixture.root;
    soul::mint_canonical_soul_v8(
        &mut fixture.soul_registry,
        root,
        authorization,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::maker_v8)]
fun archived_root_cannot_mint_canonical_soul() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 822, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let authorization = complete_for_soul_testing(&mut fixture, &clock, &mut ctx);
    let admin = &fixture.admin;
    maker::archive_maker_v8(&mut fixture.root, admin, &ctx);
    let root = &fixture.root;
    soul::mint_canonical_soul_v8(
        &mut fixture.soul_registry,
        root,
        authorization,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 2, location = animacraft_v8::soul_v8)]
fun soul_authorization_holder_is_exact() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 823, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let mut authorization = complete_for_soul_testing(&mut fixture, &clock, &mut ctx);
    complete::set_soul_authorization_holder_for_testing(&mut authorization, @0xB11);
    let root = &fixture.root;
    soul::mint_canonical_soul_v8(
        &mut fixture.soul_registry,
        root,
        authorization,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::soul_v8)]
fun soul_authorization_content_is_exact() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 824, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let mut authorization = complete_for_soul_testing(&mut fixture, &clock, &mut ctx);
    complete::set_soul_authorization_content_for_testing(
        &mut authorization,
        maker::test_digest(99),
    );
    let root = &fixture.root;
    soul::mint_canonical_soul_v8(
        &mut fixture.soul_registry,
        root,
        authorization,
        &mut ctx,
    );
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 3, location = animacraft_v8::soul_v8)]
fun complete_receipt_cannot_mint_soul_twice() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 825, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let authorization = complete_for_soul_testing(&mut fixture, &clock, &mut ctx);
    let (first, replay) = complete::duplicate_soul_authorization_for_testing(authorization);
    let root = &fixture.root;
    soul::mint_canonical_soul_v8(&mut fixture.soul_registry, root, first, &mut ctx);
    soul::mint_canonical_soul_v8(&mut fixture.soul_registry, root, replay, &mut ctx);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 0, location = animacraft_v8::soul_v8)]
fun pre_transfer_soul_authorization_is_epoch_stale() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 826, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let authorization = complete_for_soul_testing(&mut fixture, &clock, &mut ctx);
    let PhysicalFixtureV8 {
        config,
        protocol_treasury,
        protocol_cap,
        mut root,
        treasury,
        admin,
        mut composition_registry,
        mut pack_registry,
        mut complete_registry,
        mut seal_registry,
        mut soul_registry,
        mut physical_registry,
    } = fixture;
    transfer_physical_maker_control_v8(
        &mut root,
        admin,
        &mut composition_registry,
        &mut pack_registry,
        &mut complete_registry,
        &mut seal_registry,
        &mut soul_registry,
        &mut physical_registry,
        @0xB11,
        &ctx,
    );
    soul::mint_canonical_soul_v8(&mut soul_registry, &root, authorization, &mut ctx);
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    soul::share_soul_registry_v8(soul_registry);
    physical::share_physical_registry_v8(physical_registry);
    maker::share_maker_without_admin_for_testing(root, treasury);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}

#[test]
fun every_companion_empty_commitment_binds_root_content() {
    let first = maker::test_digest(3);
    let second = maker::test_digest(4);
    assert!(
        composition::empty_registry_commitment_v8(first)
            != composition::empty_registry_commitment_v8(second),
        0,
    );
    assert!(pack::empty_registry_commitment_v8(first) != pack::empty_registry_commitment_v8(second), 0);
    assert!(
        complete::empty_registry_commitment_v8(first)
            != complete::empty_registry_commitment_v8(second),
        0,
    );
    assert!(seal::empty_registry_commitment_v8(first) != seal::empty_registry_commitment_v8(second), 0);
    assert!(soul::registry_commitment_v8(first) != soul::registry_commitment_v8(second), 0);
    assert!(
        physical::empty_registry_commitment_v8(first)
            != physical::empty_registry_commitment_v8(second),
        0,
    );
}

#[test]
fun seal_coverage_rejects_wrong_scope_and_commitment() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 827, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    let root_content_commitment = *maker::content_commitment_v8(&fixture.root);
    let scope_key = seal::maker_style_scope_key_v8();
    let scope_commitment = seal::maker_style_scope_commitment_v8(root_content_commitment);
    let asset_key = seal::style_asset_key_v8(
        b"face".to_string(),
        b"base".to_string(),
        b"default".to_string(),
    );
    let empty = seal::empty_registry_commitment_v8(root_content_commitment);
    let (expected, expected_seal_id) = seal::advance_protected_asset_commitment_v8(
        root_content_commitment,
        0,
        empty,
        seal::scope_maker_style_v8(),
        scope_key,
        scope_commitment,
        asset_key,
        maker::test_digest(24),
    );
    let mut registry = seal::new_seal_registry_v8(
        &fixture.root,
        &fixture.admin,
        1,
        expected,
        &mut ctx,
    );
    let observed_seal_id = seal::append_protected_asset_v8(
        &mut registry,
        &fixture.root,
        &fixture.admin,
        0,
        seal::scope_maker_style_v8(),
        scope_key,
        scope_commitment,
        asset_key,
        maker::test_digest(24),
    );
    assert!(observed_seal_id == expected_seal_id, 0);
    seal::seal_registry_v8(&mut registry, &fixture.root, &fixture.admin);
    assert!(
        seal::check_asset_covered_v8(
            &registry,
            &fixture.root,
            seal::scope_maker_style_v8(),
            scope_key,
            &scope_commitment,
            asset_key,
            &maker::test_digest(24),
            &expected_seal_id,
        ),
        0,
    );
    assert!(
        !seal::check_asset_covered_v8(
            &registry,
            &fixture.root,
            seal::scope_pack_style_v8(),
            scope_key,
            &scope_commitment,
            asset_key,
            &maker::test_digest(24),
            &expected_seal_id,
        ),
        0,
    );
    assert!(
        !seal::check_asset_covered_v8(
            &registry,
            &fixture.root,
            seal::scope_maker_style_v8(),
            scope_key,
            &maker::test_digest(99),
            asset_key,
            &maker::test_digest(24),
            &expected_seal_id,
        ),
        0,
    );
    seal::share_seal_registry_v8(registry);
    share_physical_fixture_v8(fixture, &ctx);
    clock.destroy_for_testing();
}

#[test]
fun pack_control_transfer_allows_recipient_epoch_readmission() {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 828, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut fixture = new_physical_fixture_v8(1, &clock, &mut ctx);
    activate_physical_fixture_v8(&mut fixture, &clock, &ctx);
    let PhysicalFixtureV8 {
        config,
        protocol_treasury,
        protocol_cap,
        mut root,
        treasury,
        admin,
        mut composition_registry,
        mut pack_registry,
        mut complete_registry,
        mut seal_registry,
        mut soul_registry,
        mut physical_registry,
    } = fixture;
    let (mut release, pack_admin) =
        pack::new_active_release_and_admin_for_testing(&root, &mut ctx);
    let mut pack_admin = pack::transfer_expansion_pack_control_for_testing(
        &mut release,
        pack_admin,
        @0xB11,
        &ctx,
    );
    let next_epoch = maker::ownership_epoch_v8(&root) + 1;
    rebind_mandatory(
        &root,
        &admin,
        &mut composition_registry,
        &mut pack_registry,
        &mut complete_registry,
        &mut seal_registry,
        &mut soul_registry,
    );
    physical::rebind_ownership_epoch_v8(
        &mut physical_registry,
        &root,
        &admin,
        next_epoch,
    );
    let maker_admin = maker::transfer_control_for_testing(
        &mut root,
        admin,
        @0xB11,
        &ctx,
    );
    let recipient_ctx = sui::tx_context::new_from_hint(@0xB11, 829, 0, 0, 0);
    pack::readmit_expansion_pack_epoch_v8(
        &mut release,
        &root,
        &maker_admin,
        &mut pack_admin,
        &recipient_ctx,
    );
    assert!(
        pack::release_ownership_epoch_v8(&release) == maker::ownership_epoch_v8(&root),
        0,
    );
    assert!(pack::release_lifecycle_v8(&release) == pack::lifecycle_paused_v8(), 0);
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    soul::share_soul_registry_v8(soul_registry);
    physical::share_physical_registry_v8(physical_registry);
    maker::share_maker_objects_v8(root, treasury, maker_admin, &recipient_ctx);
    pack::share_release_and_admin_for_testing(release, pack_admin, &recipient_ctx);
    protocol::destroy_protocol_for_testing(config, protocol_treasury, protocol_cap);
    clock.destroy_for_testing();
}
