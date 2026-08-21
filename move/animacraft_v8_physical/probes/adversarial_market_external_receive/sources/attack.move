module physical_adversarial_market_external_receive::attack;

use animacraft_v8_physical::physical_v8::PhysicalAssetV8;
use sui::transfer::{Self as transfer, Receiving};

// Must fail Sui verification: non-store Physical assets can only be received
// by the module that defines them.
public fun receive_outside_physical(
    parent: &mut UID,
    receiving: Receiving<PhysicalAssetV8>,
): PhysicalAssetV8 {
    transfer::receive(parent, receiving)
}
