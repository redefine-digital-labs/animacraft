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
    CapabilityCommitmentsV8,
    EconomicsV8,
    MakerAdminCapV8,
    MakerRootV8,
    MakerTreasuryV8,
    RegistryCommitmentsV8,
    RightsV8,
    RowCountsV8,
};
use animacraft_v8::protocol_config_v8::{Self as protocol, ProtocolConfigV8};
use animacraft_v8::seal_v8::{Self as seal, SealRegistryV8};
use std::option::{Self as option, Option};
use std::string::String;
use sui::clock::Clock;

const VERSION: u64 = 8;
const EPhysicalUnavailable: u64 = 0;

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
    declared_capabilities: u64,
    economics: EconomicsV8,
    rights: RightsV8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Physical has no callable v8 implementation in this package yet. A
    // caller may not publish a declaration that the finalizer cannot prove.
    assert!(
        (declared_capabilities & protocol::capability_physical_v8()) == 0,
        EPhysicalUnavailable,
    );
    let composition_commitment =
        *maker::capability_composition_commitment_v8(&expected_capability_commitments);
    let pack_commitment =
        *maker::capability_pack_commitment_v8(&expected_capability_commitments);
    let complete_commitment =
        *maker::capability_complete_commitment_v8(&expected_capability_commitments);
    let seal_commitment =
        *maker::capability_seal_commitment_v8(&expected_capability_commitments);
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
    composition::share_composition_registry_v8(composition_registry);
    pack::share_expansion_pack_registry_v8(pack_registry);
    complete::share_complete_registry_v8(complete_registry);
    seal::share_seal_registry_v8(seal_registry);
    maker::share_maker_objects_v8(root, treasury, admin, ctx);
}

/// Atomically validates all mandatory same-package registries and activates a
/// Maker that does not declare Physical. A Physical-capable overload must not
/// be added until it consumes the exact private Physical binding witness
/// described in COMPANION_INTERFACE.md.
public fun seal_and_activate_maker_v8<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    treasury: &MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    composition_registry: &CompositionRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    complete_registry: &CompleteRegistryV8,
    seal_registry: &SealRegistryV8,
    clock: &Clock,
    ctx: &TxContext,
) {
    let (
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
    ) = composition::assert_activation_ready_v8(composition_registry, root);
    let (
        pack_registry_id,
        pack_commitment,
        pack_release_count,
    ) = pack::assert_activation_ready_v8(pack_registry, root);
    let (
        complete_registry_id,
        complete_commitment,
        _complete_output_count,
    ) = complete::assert_activation_ready_v8(complete_registry, root);
    let (
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
    ) = seal::assert_activation_ready_v8(seal_registry, root);
    let bindings = maker::new_activation_bindings_v8(
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
        pack_registry_id,
        pack_commitment,
        pack_release_count,
        complete_registry_id,
        complete_commitment,
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
        option::none(),
        option::none(),
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
    ctx: &TxContext,
) {
    let (
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
    ) = composition::assert_activation_ready_v8(composition_registry, root);
    let (
        pack_registry_id,
        pack_commitment,
        pack_release_count,
    ) = pack::assert_activation_ready_v8(pack_registry, root);
    let (
        complete_registry_id,
        complete_commitment,
        _complete_output_count,
    ) = complete::assert_activation_ready_v8(complete_registry, root);
    let (
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
    ) = seal::assert_activation_ready_v8(seal_registry, root);
    let bindings = maker::new_activation_bindings_v8(
        composition_registry_id,
        composition_commitment,
        composition_slot_count,
        pack_registry_id,
        pack_commitment,
        pack_release_count,
        complete_registry_id,
        complete_commitment,
        seal_registry_id,
        seal_commitment,
        protected_asset_count,
        option::none(),
        option::none(),
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
    recipient: address,
    ctx: &TxContext,
) {
    maker::assert_current_admin_v8(root, &admin);
    let next_epoch = maker::ownership_epoch_v8(root) + 1;
    composition::rebind_ownership_epoch_v8(
        composition_registry,
        root,
        &admin,
        next_epoch,
    );
    pack::rebind_ownership_epoch_v8(pack_registry, root, &admin, next_epoch);
    complete::rebind_ownership_epoch_v8(
        complete_registry,
        root,
        &admin,
        next_epoch,
    );
    seal::rebind_ownership_epoch_v8(seal_registry, root, &admin, next_epoch);
    maker::transfer_control_checked_v8(root, admin, recipient, ctx);
}
