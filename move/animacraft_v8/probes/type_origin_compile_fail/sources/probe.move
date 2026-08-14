/// This package MUST NOT compile. It proves that an identically named foreign
/// object cannot satisfy publication_v8's concrete PhysicalRegistryV8 input.
module animacraft_v8_type_origin_probe::probe;

use animacraft_v8::complete_v8::CompleteRegistryV8;
use animacraft_v8::composition_v8::CompositionRegistryV8;
use animacraft_v8::expansion_pack_v8::ExpansionPackRegistryV8;
use animacraft_v8::maker_v8::{MakerAdminCapV8, MakerRootV8, MakerTreasuryV8};
use animacraft_v8::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8::publication_v8;
use animacraft_v8::seal_v8::SealRegistryV8;
use animacraft_v8::soul_v8::{Self as soul, SoulRegistryV8};
use sui::clock::Clock;

public struct PhysicalRegistryV8 has drop { marker: bool }
public struct SoulMintAuthorizationV8 has drop { marker: bool }

public fun forged_type_origin_cannot_activate<PaymentCoin>(
    root: &mut MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    treasury: &MakerTreasuryV8<PaymentCoin>,
    config: &ProtocolConfigV8,
    composition_registry: &CompositionRegistryV8,
    pack_registry: &ExpansionPackRegistryV8,
    complete_registry: &CompleteRegistryV8,
    seal_registry: &SealRegistryV8,
    soul_registry: &SoulRegistryV8,
    forged_physical_registry: &PhysicalRegistryV8,
    clock: &Clock,
    ctx: &TxContext,
) {
    publication_v8::seal_and_activate_physical_maker_v8(
        root,
        admin,
        treasury,
        config,
        composition_registry,
        pack_registry,
        complete_registry,
        seal_registry,
        soul_registry,
        forged_physical_registry,
        clock,
        ctx,
    );
}

public fun forged_soul_proof_cannot_mint<PaymentCoin>(
    registry: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    forged_authorization: SoulMintAuthorizationV8,
    ctx: &mut TxContext,
) {
    soul::mint_canonical_soul_v8(registry, root, forged_authorization, ctx);
}
