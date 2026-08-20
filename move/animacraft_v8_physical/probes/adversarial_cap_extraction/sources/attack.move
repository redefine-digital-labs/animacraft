module physical_adversarial_cap_extraction::attack;

use animacraft_v8_core::package_binding_v8::{PackageCallCapV8, PhysicalRoleV8};
use animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8;

// Must fail: the nested Physical call capability cannot be extracted.
public fun steal_cap(
    config: PhysicalPackageConfigV8,
): PackageCallCapV8<PhysicalRoleV8> {
    let PhysicalPackageConfigV8 {
        id: _,
        version: _,
        catalog_id: _,
        product_binding_commitment: _,
        call_cap_set_commitment: _,
        physical_call_cap,
    } = config;
    physical_call_cap
}
