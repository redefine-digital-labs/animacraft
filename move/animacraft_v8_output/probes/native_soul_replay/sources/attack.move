module output_native_soul_replay::attack;

use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_output::output_v8::{Self as output,
    SoulMintAuthorizationV8, OutputRegistryV8, SoulRegistryV8};

/// Must fail specifically because Complete authorization has already moved,
/// not because the old, removed mint entrypoint cannot be resolved.
public fun replay<PaymentCoin, MintWitness: drop>(
    authorization: SoulMintAuthorizationV8,
    registry: &mut OutputRegistryV8,
    souls: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol: &ProtocolConfigV8,
    soul_id: ID,
    state_id: ID,
    witness: MintWitness,
    second_witness: MintWitness,
    ctx: &mut TxContext,
) {
    let first = output::bind_native_soul_v8(
        authorization, registry, souls, root, protocol, soul_id, state_id,
        witness, ctx);
    output::freeze_native_soul_binding_v8(first);
    let duplicate = output::bind_native_soul_v8(
        authorization, registry, souls, root, protocol, soul_id, state_id,
        second_witness, ctx);
    output::freeze_native_soul_binding_v8(duplicate);
}
