module physical_adversarial_asset_store::attack;

use animacraft_v8_physical::physical_v8::PhysicalAssetV8;

// Must fail: the holder-owned asset is `key` only. An outside package cannot
// wrap it in storage and route around Physical's holder/epoch checks.
public struct StoredPhysicalAsset has key {
    id: UID,
    asset: PhysicalAssetV8,
}
