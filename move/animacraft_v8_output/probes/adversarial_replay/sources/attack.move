module output_adversarial_replay::attack;

use animacraft_v8_core::package_binding_v8::{PackageCallCapV8,
    PhysicalRoleV8, ProductReleaseCatalogV8};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_output::output_v8::{Self as output,
    OutputRegistryV8, PhysicalMaterializationWitnessV8, SoulMintAuthorizationV8,
    SoulRegistryV8};

public struct PhysicalOriginalMarker has drop {}
public struct PhysicalCallableMarker has drop {}

public fun replay(
    witness: PhysicalMaterializationWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<PhysicalRoleV8>,
) {
    consume(witness, catalog, cap);
    consume(witness, catalog, cap);
}

public fun replay_soul<PaymentCoin>(
    authorization: SoulMintAuthorizationV8,
    registry: &mut OutputRegistryV8,
    souls: &mut SoulRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &mut TxContext,
) {
    output::mint_canonical_soul_v8(authorization, registry, souls, root, ctx);
    output::mint_canonical_soul_v8(authorization, registry, souls, root, ctx);
}

fun consume(
    witness: PhysicalMaterializationWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<PhysicalRoleV8>,
) {
    let (_complete, _selection, _key, _commitment) =
        output::consume_physical_materialization_witness_v8<
            PhysicalOriginalMarker,
            PhysicalCallableMarker,
        >(witness, catalog, cap);
}
