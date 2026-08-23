module market_adversarial_forge_config::attack;

use animacraft_v8_core::package_binding_v8::{MarketRoleV8, PackageCallCapV8};
use animacraft_v8_market::market_v8::MarketPackageConfigV8;

// Must fail independently: an external package cannot forge a config with a
// selected Market call capability.
public fun forge_config(
    id: UID,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    market_call_cap: PackageCallCapV8<MarketRoleV8>,
): MarketPackageConfigV8 {
    MarketPackageConfigV8 {
        id,
        version: 8,
        catalog_id,
        product_binding_commitment,
        call_cap_set_commitment,
        market_call_cap,
    }
}
