module output_native_soul_compile::probe;

use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_output::output_v8::{Self as output,
    SoulMintAuthorizationV8, OutputRegistryV8, SoulRegistryV8};

/// Positive production-ABI compile control for the replay probe. Actual type
/// pinning and the private witness's facts are checked at runtime by Output.
public fun consume_once<PaymentCoin, MintWitness: drop>(
    authorization: SoulMintAuthorizationV8,
    registry: &mut OutputRegistryV8,
    souls: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol: &ProtocolConfigV8,
    soul_id: ID,
    state_id: ID,
    witness: MintWitness,
    ctx: &mut TxContext,
) {
    let binding = output::bind_native_soul_v8(
        authorization, registry, souls, root, protocol, soul_id, state_id,
        witness, ctx);
    output::freeze_native_soul_binding_v8(binding);
}
