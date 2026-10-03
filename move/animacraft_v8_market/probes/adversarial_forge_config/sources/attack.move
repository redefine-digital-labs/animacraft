module market_adversarial_forge_config::attack;

use animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1;
use animacraft_v8_market::market_v8::MarketPackageConfigV8;

// Must fail independently: an external package cannot forge a config with a
// selected installation commitment and retained runtime caller capability.
public fun forge_config(
    id: UID,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    installation_commitment: vector<u8>,
    runtime_caller_cap: Option<RuntimeCallerCapV1>,
): MarketPackageConfigV8 {
    MarketPackageConfigV8 {
        id,
        version: 8,
        catalog_id,
        product_binding_commitment,
        call_cap_set_commitment,
        installation_commitment,
        runtime_caller_cap,
    }
}
