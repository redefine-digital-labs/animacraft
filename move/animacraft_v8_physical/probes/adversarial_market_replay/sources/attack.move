module physical_adversarial_market_replay::attack;

use animacraft_v8_physical::physical_v8::PhysicalAssetV8;
use sui::transfer::Receiving;

// Must fail: one Receiving capability cannot authorize two settlement calls.
public fun duplicate_receiving(
    receiving: Receiving<PhysicalAssetV8>,
): (Receiving<PhysicalAssetV8>, Receiving<PhysicalAssetV8>) {
    (receiving, receiving)
}
