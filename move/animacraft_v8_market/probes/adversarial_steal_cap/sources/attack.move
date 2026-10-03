module market_adversarial_steal_cap::attack;

use animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1;
use animacraft_v8_market::market_v8::MarketPackageConfigV8;

// Must fail independently: the retained runtime caller cap cannot even be
// borrowed through an external-package accessor.
public fun steal_cap(
    config: &MarketPackageConfigV8,
): &Option<RuntimeCallerCapV1> {
    &config.runtime_caller_cap
}
