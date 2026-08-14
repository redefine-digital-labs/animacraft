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
    MakerAdminCapV8,
    MakerRootV8,
    MakerTreasuryV8,
};
use animacraft_v8::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8::seal_v8::{Self as seal, SealRegistryV8};
use std::option;
use sui::clock::Clock;

const VERSION: u64 = 8;

public fun version_v8(): u64 { VERSION }

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
