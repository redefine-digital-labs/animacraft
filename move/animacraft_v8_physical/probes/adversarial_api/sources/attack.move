module physical_adversarial_api::attack;

use animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8;

// Must fail: an external package cannot forge the config or install a caller-
// selected installation commitment after the setup capability is consumed.
public fun forge_config(
    id: UID,
    catalog_id: ID,
    product_binding_commitment: vector<u8>,
    call_cap_set_commitment: vector<u8>,
    installation_commitment: vector<u8>,
): PhysicalPackageConfigV8 {
    PhysicalPackageConfigV8 {
        id,
        version: 8,
        catalog_id,
        product_binding_commitment,
        call_cap_set_commitment,
        installation_commitment,
    }
}
