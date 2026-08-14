module output_adversarial_bypass::attack;

use animacraft_v8_output::output_v8::{Self as output, OutputRegistryV8};

// Must fail: callers cannot grief Complete counters directly.
public fun mutate_counter(registry: &mut OutputRegistryV8, holder: address) {
    output::mutate_base_counter(registry, holder, 0)
}
