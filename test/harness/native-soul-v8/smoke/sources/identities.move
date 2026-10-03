module native_soul_v8_graph::identities;

/// Actual defining-package identities; no fabricated role markers or caps.
public fun package_addresses(): vector<address> {
    vector[
        std::type_name::original_id<animacraft_v8_core::protocol_config_v8::ProtocolConfigV8>(),
        std::type_name::original_id<animacraft_v8_seal::seal_v8::SealPolicyConfigV8>(),
        std::type_name::original_id<animacraft_v8_runtime::runtime_binding_v8::RuntimePackageConfigV8>(),
        std::type_name::original_id<animacraft_v8_output::output_v8::OutputPackageConfigV8>(),
        std::type_name::original_id<soulidity::soul::Soul>(),
    ]
}

#[test]
fun native_graph_addresses() {
    assert!(package_addresses() == vector[@0x100, @0x101, @0x102, @0x103, @0x107], 0);
}
