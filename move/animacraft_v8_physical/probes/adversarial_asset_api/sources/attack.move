module physical_adversarial_asset_api::attack;

use animacraft_v8_physical::physical_v8::PhysicalAssetV8;

// Must fail: an external package cannot rewrite custody or its independent
// ownership epoch, even while it holds a mutable reference to the key object.
public fun rewrite_asset_custody(asset: &mut PhysicalAssetV8) {
    asset.holder = @0xB11;
    asset.ownership_epoch = asset.ownership_epoch + 1;
}
