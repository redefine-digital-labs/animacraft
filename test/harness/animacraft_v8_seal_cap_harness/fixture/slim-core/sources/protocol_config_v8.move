module animacraft_v8_core::protocol_config_v8;
public fun version_v8(): u64 { 8 }
public fun is_nonzero_hash_v2(value: &vector<u8>): bool {
    if (value.length() != 32) return false;
    let mut index = 0;
    while (index < 32) { if (value[index] != 0) return true; index = index + 1; };
    false
}
