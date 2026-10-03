module output_adversarial_replay::attack;

use animacraft_v8_core::package_binding_v8::{FreshTupleReplacementBindingV2,
    ProductReleaseCatalogV8};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_output::output_v8::{Self as output,
    OutputRegistryV8, PhysicalMaterializationWitnessV8, SoulMintAuthorizationV8,
    SoulRegistryV8};

public fun replay<PhysicalRuntimeWitness: drop>(
    witness: PhysicalMaterializationWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    first_authority: PhysicalRuntimeWitness,
    second_authority: PhysicalRuntimeWitness,
    protocol: &ProtocolConfigV8,
    replacement: &FreshTupleReplacementBindingV2,
) {
    consume(witness, first_authority, protocol, catalog, replacement);
    consume(witness, second_authority, protocol, catalog, replacement);
}

public fun replay_soul<PaymentCoin, MintWitness: drop>(
    authorization: SoulMintAuthorizationV8,
    registry: &mut OutputRegistryV8,
    souls: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol: &ProtocolConfigV8,
    soul_id: ID,
    state_id: ID,
    first_witness: MintWitness,
    second_witness: MintWitness,
    ctx: &mut TxContext,
) {
    let first = output::bind_native_soul_v8(authorization, registry, souls, root,
        protocol, soul_id, state_id, first_witness, ctx);
    output::freeze_native_soul_binding_v8(first);
    let second = output::bind_native_soul_v8(authorization, registry, souls, root,
        protocol, soul_id, state_id, second_witness, ctx);
    output::freeze_native_soul_binding_v8(second);
}

fun consume<PhysicalRuntimeWitness: drop>(
    witness: PhysicalMaterializationWitnessV8,
    authority: PhysicalRuntimeWitness,
    protocol: &ProtocolConfigV8,
    catalog: &ProductReleaseCatalogV8,
    replacement: &FreshTupleReplacementBindingV2,
) {
    let (_complete, _selection, _key, _commitment) =
        output::consume_physical_materialization_witness_v8<
            PhysicalRuntimeWitness,
        >(witness, authority, protocol, catalog, replacement);
}
