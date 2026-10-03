module physical_adversarial_cap_extraction::attack;

use animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8;

// Setup consumes the Physical capability. Its installed config still cannot
// be unpacked externally to extract or reconstruct private installation state.
public fun steal_cap(
    config: PhysicalPackageConfigV8,
): vector<u8> {
    let PhysicalPackageConfigV8 {
        id: _,
        version: _,
        catalog_id: _,
        product_binding_commitment: _,
        call_cap_set_commitment: _,
        installation_commitment,
    } = config;
    installation_commitment
}
