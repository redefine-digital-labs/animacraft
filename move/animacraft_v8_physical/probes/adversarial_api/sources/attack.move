module physical_adversarial_api::attack;

use animacraft_v8_core::package_binding_v8::{PackageCallCapV8, PhysicalRoleV8};
use animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8;

// Must fail: an external package cannot forge the config or install a caller-
// selected Physical call capability.
public fun forge_config(
    id: UID,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    physical_call_cap: PackageCallCapV8<PhysicalRoleV8>,
): PhysicalPackageConfigV8 {
    PhysicalPackageConfigV8 {
        id,
        version: 8,
        catalog_id,
        product_binding_commitment,
        call_cap_set_commitment,
        physical_call_cap,
    }
}
