module market_adversarial_steal_cap::attack;

use animacraft_v8_core::package_binding_v8::{MarketRoleV8, PackageCallCapV8};
use animacraft_v8_market::market_v8::MarketPackageConfigV8;

// Must fail independently: the private Market call cap cannot even be
// borrowed through an external-package accessor.
public fun steal_cap(
    config: &MarketPackageConfigV8,
): &PackageCallCapV8<MarketRoleV8> {
    &config.market_call_cap
}
