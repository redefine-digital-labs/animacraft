module release_companion_compile::probe;

// Positive external-package compile coverage for every formerly exercised API.
// Current signatures require the live replacement/bootstrap authority where applicable.

public fun new_release_package_config_v8(
    catalog: &mut animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    release_call_cap: animacraft_v8_core::package_binding_v8::PackageCallCapV8<animacraft_v8_core::package_binding_v8::ReleaseRoleV8>,
    ctx: &mut TxContext,
): animacraft_v8_release::release_v8::ReleasePackageConfigV8 {
    animacraft_v8_release::release_v8::new_release_package_config_v8(
        catalog, release_call_cap, ctx
    )
}

public fun finalize_product_release_binding_v8<PaymentCoin>(
    root: &mut animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    animacraft_v8_release::release_v8::finalize_product_release_binding_v8<PaymentCoin>(
        root, admin, protocol_config, catalog, release_config, ctx
    )
}

public fun new_license_wrapped_rights_snapshot_v8(
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8,
    evidence_locator: std::string::String,
    evidence_blob_id: std::string::String,
    evidence_sha256: vector<u8>,
    terms_commitment: vector<u8>,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
    maker_resale_royalty_bps: u16,
    ctx: &TxContext,
): animacraft_v8_core::maker_v8::RightsSnapshotV8 {
    animacraft_v8_release::release_v8::new_license_wrapped_rights_snapshot_v8(
        protocol_config, catalog, replacement, release_config, evidence_locator, evidence_blob_id, evidence_sha256, terms_commitment, soul_creator_royalty_bps, maker_source_royalty_bps, maker_resale_royalty_bps, ctx
    )
}

public fun certify_base_ciphertext_v8<PaymentCoin>(
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8,
    policy: &animacraft_v8_seal::seal_v8::SealPolicyConfigV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    scope_key: std::string::String,
    scope_commitment: vector<u8>,
    asset_key: std::string::String,
    asset_content_commitment: vector<u8>,
    ciphertext_blob_id: std::string::String,
    ciphertext_sha256: vector<u8>,
    ciphertext_blob_commitment: vector<u8>,
    ctx: &TxContext,
): animacraft_v8_seal::seal_v8::CiphertextCertificationV8 {
    animacraft_v8_release::release_v8::certify_base_ciphertext_v8<PaymentCoin>(
        protocol_config, catalog, release_config, policy, root, scope_key, scope_commitment, asset_key, asset_content_commitment, ciphertext_blob_id, ciphertext_sha256, ciphertext_blob_commitment, ctx
    )
}

public fun seal_and_activate_maker_v8<PaymentCoin>(
    root: &mut animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>, admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8, catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    bootstrap_certificate: &animacraft_v8_core::package_binding_v8::FreshTupleBootstrapCertificateV2,
    walrus_policy: &animacraft_v8_core::core_v8::WalrusCertificationPolicyV1, living_certificate: &animacraft_v8_core::core_v8::CertifiedLivingContentV1,
    system: &walrus::system::System,
    base_registry: &animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8,
    ctx: &TxContext,
) {
    animacraft_v8_release::release_v8::seal_and_activate_maker_v8<PaymentCoin>(
        root, admin, protocol_config, catalog, replacement, bootstrap_certificate, walrus_policy, living_certificate, system, base_registry, release_config, ctx
    )
}

public fun pause_maker_v8<PaymentCoin>(
    root: &mut animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>, admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8, catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8, ctx: &TxContext,
) {
    animacraft_v8_release::release_v8::pause_maker_v8<PaymentCoin>(
        root, admin, protocol_config, catalog, replacement, release_config, ctx
    )
}

public fun resume_maker_v8<PaymentCoin>(
    root: &mut animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>, admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8, catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8, ctx: &TxContext,
) {
    animacraft_v8_release::release_v8::resume_maker_v8<PaymentCoin>(
        root, admin, protocol_config, catalog, replacement, release_config, ctx
    )
}

public fun archive_maker_v8<PaymentCoin>(
    root: &mut animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>, admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8, catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8, ctx: &TxContext,
) {
    animacraft_v8_release::release_v8::archive_maker_v8<PaymentCoin>(
        root, admin, protocol_config, catalog, replacement, release_config, ctx
    )
}

public fun finish_unprotected_complete_v8<PaymentCoin>(
    session: animacraft_v8_output::output_v8::CompleteSessionV8,
    output_registry: &animacraft_v8_output::output_v8::OutputRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    release_config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8,
    loadout: &animacraft_v8_runtime::runtime_v8::MakerLoadoutV8,
    render_blob_id: std::string::String,
    render_sha256: vector<u8>,
    render_blob_commitment: vector<u8>,
    ctx: &mut TxContext,
): animacraft_v8_output::output_v8::SoulMintAuthorizationV8 {
    animacraft_v8_release::release_v8::finish_unprotected_complete_v8<PaymentCoin>(
        session, output_registry, root, protocol_config, catalog, replacement, release_config, loadout, render_blob_id, render_sha256, render_blob_commitment, ctx
    )
}

public fun config_id_v8(config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8): ID {
    animacraft_v8_release::release_v8::config_id_v8(
        config
    )
}

public fun config_catalog_id_v8(config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8): ID {
    animacraft_v8_release::release_v8::config_catalog_id_v8(
        config
    )
}

public fun config_product_binding_commitment_v8(
    config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8,
): &vector<u8> {
    animacraft_v8_release::release_v8::config_product_binding_commitment_v8(
        config
    )
}

public fun config_call_cap_set_commitment_v8(
    config: &animacraft_v8_release::release_v8::ReleasePackageConfigV8,
): &vector<u8> {
    animacraft_v8_release::release_v8::config_call_cap_set_commitment_v8(
        config
    )
}

public fun version_v8(): u64 {
    animacraft_v8_release::release_v8::version_v8()
}
