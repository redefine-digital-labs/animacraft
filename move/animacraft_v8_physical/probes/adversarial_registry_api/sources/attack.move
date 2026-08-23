module physical_adversarial_registry_api::attack;

use animacraft_v8_physical::physical_v8::PhysicalRegistryV8;

// Must fail: registry counters, revision, and replay state are private.
public fun mutate_registry(registry: &mut PhysicalRegistryV8) {
    registry.revision = registry.revision + 1;
}
