module physical_adversarial_api::attack;

use animacraft_v8_core::package_binding_v8::{PackageCallCapV8, PhysicalRoleV8};
use animacraft_v8_physical::physical_v8::{PhysicalPackageConfigV8,
    PhysicalRegistryV8};

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

// Must fail: registry counters and future mutable lanes are private.
public fun mutate_registry(registry: &mut PhysicalRegistryV8) {
    registry.revision = registry.revision + 1;
}

// Must fail: the nested call capability cannot be extracted from config.
public fun steal_cap(config: PhysicalPackageConfigV8): PackageCallCapV8<PhysicalRoleV8> {
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
