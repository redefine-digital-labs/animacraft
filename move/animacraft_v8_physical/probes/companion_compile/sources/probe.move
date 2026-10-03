module physical_companion_probe::probe;

// Positive external-package compile coverage for every formerly exercised API.
// Current signatures require the live replacement/bootstrap authority where applicable.

public fun new_physical_package_config_v8(
    catalog: &mut animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    physical_call_cap: animacraft_v8_core::package_binding_v8::PackageCallCapV8<animacraft_v8_core::package_binding_v8::PhysicalRoleV8>,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8 {
    animacraft_v8_physical::physical_v8::new_physical_package_config_v8(
        catalog, physical_call_cap, ctx
    )
}

public fun empty_base_policy_commitment_v8<PaymentCoin>(
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    base_registry: &animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
): vector<u8> {
    animacraft_v8_physical::physical_v8::empty_base_policy_commitment_v8<PaymentCoin>(
        root, base_registry, config
    )
}

public fun new_physical_registry_v8<PaymentCoin>(
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    base_registry: &animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    expected_base_policy_count: u64,
    expected_base_policy_commitment: vector<u8>,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalRegistryV8 {
    animacraft_v8_physical::physical_v8::new_physical_registry_v8<PaymentCoin>(
        root, admin, base_registry, catalog, config, expected_base_policy_count, expected_base_policy_commitment, ctx
    )
}

public fun derive_base_policy_row_commitment_v8<PaymentCoin>(
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    base_registry: &animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    sequence: u64,
    part_key: std::string::String,
    item_key: std::string::String,
    style_key: std::string::String,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
): vector<u8> {
    animacraft_v8_physical::physical_v8::derive_base_policy_row_commitment_v8<PaymentCoin>(
        root, base_registry, config, sequence, part_key, item_key, style_key, material_policy_commitment, issuance_kind, proof_kind, price_atomic, max_supply, transferable
    )
}

public fun issue_proof_materialize_v8(): u8 {
    animacraft_v8_physical::physical_v8::issue_proof_materialize_v8()
}

public fun proof_canonical_soul_v8(): u8 {
    animacraft_v8_physical::physical_v8::proof_canonical_soul_v8()
}

public fun advance_base_policy_commitment_v8<PaymentCoin>(
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    sequence: u64,
    prior_commitment: vector<u8>,
    row_commitment: vector<u8>,
): vector<u8> {
    animacraft_v8_physical::physical_v8::advance_base_policy_commitment_v8<PaymentCoin>(
        root, sequence, prior_commitment, row_commitment
    )
}

public fun append_base_style_policy_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    base_registry: &animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    sequence: u64,
    part_key: std::string::String,
    item_key: std::string::String,
    style_key: std::string::String,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    row_commitment: vector<u8>,
) {
    animacraft_v8_physical::physical_v8::append_base_style_policy_v8<PaymentCoin>(
        registry, root, admin, base_registry, catalog, config, sequence, part_key, item_key, style_key, material_policy_commitment, issuance_kind, proof_kind, price_atomic, max_supply, transferable, row_commitment
    )
}

public fun seal_physical_registry_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    base_registry: &animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
) {
    animacraft_v8_physical::physical_v8::seal_physical_registry_v8<PaymentCoin>(
        registry, root, admin, base_registry, catalog, config
    )
}

public fun validate_physical_activation_readiness_v2<PaymentCoin>(
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    base_registry: &animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
): vector<u8> {
    animacraft_v8_physical::physical_v8::validate_physical_activation_readiness_v2<PaymentCoin>(
        root, base_registry, protocol_config, catalog, replacement, config, registry
    )
}

public fun borrow_base_policy_v8(
    registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    selection: &animacraft_v8_output::output_v8::PhysicalSelectionBindingV8,
): &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8 {
    animacraft_v8_physical::physical_v8::borrow_base_policy_v8(
        registry, selection
    )
}

public fun policy_part_key_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): &std::string::String {
    animacraft_v8_physical::physical_v8::policy_part_key_v8(
        policy
    )
}

public fun policy_item_key_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): &std::string::String {
    animacraft_v8_physical::physical_v8::policy_item_key_v8(
        policy
    )
}

public fun policy_style_key_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): &std::string::String {
    animacraft_v8_physical::physical_v8::policy_style_key_v8(
        policy
    )
}

public fun policy_layer_track_key_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): &std::string::String {
    animacraft_v8_physical::physical_v8::policy_layer_track_key_v8(
        policy
    )
}

public fun policy_sequence_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): u64 {
    animacraft_v8_physical::physical_v8::policy_sequence_v8(
        policy
    )
}

public fun policy_issuance_kind_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): u8 {
    animacraft_v8_physical::physical_v8::policy_issuance_kind_v8(
        policy
    )
}

public fun policy_proof_kind_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): u8 {
    animacraft_v8_physical::physical_v8::policy_proof_kind_v8(
        policy
    )
}

public fun policy_price_atomic_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): u64 {
    animacraft_v8_physical::physical_v8::policy_price_atomic_v8(
        policy
    )
}

public fun policy_max_supply_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): u64 {
    animacraft_v8_physical::physical_v8::policy_max_supply_v8(
        policy
    )
}

public fun policy_transferable_v8(policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8): bool {
    animacraft_v8_physical::physical_v8::policy_transferable_v8(
        policy
    )
}

public fun policy_row_commitment_v8(
    policy: &animacraft_v8_physical::physical_v8::PhysicalStylePolicyV8,
): &vector<u8> {
    animacraft_v8_physical::physical_v8::policy_row_commitment_v8(
        policy
    )
}

public fun register_pack_style_policy_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    maker_admin: &animacraft_v8_core::maker_v8::MakerAdminCapV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    packs: &animacraft_v8_runtime::runtime_v8::PackRegistryV8,
    release: &animacraft_v8_runtime::runtime_v8::PackReleaseV8<PaymentCoin>,
    pack_admin: &animacraft_v8_runtime::runtime_v8::PackAdminCapV8,
    pack_treasury: &animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    expected_revision: u64,
    part_key: std::string::String,
    item_key: std::string::String,
    style_key: std::string::String,
    material_policy_commitment: vector<u8>,
    issuance_kind: u8,
    proof_kind: u8,
    price_atomic: u64,
    max_supply: u64,
    transferable: bool,
    ctx: &TxContext,
) {
    animacraft_v8_physical::physical_v8::register_pack_style_policy_v8<PaymentCoin>(
        registry, root, maker_admin, protocol_config, catalog, replacement, config, packs, release, pack_admin, pack_treasury, expected_revision, part_key, item_key, style_key, material_policy_commitment, issuance_kind, proof_kind, price_atomic, max_supply, transferable, ctx
    )
}

public fun issue_free_claim_v8(): u8 {
    animacraft_v8_physical::physical_v8::issue_free_claim_v8()
}

public fun proof_none_v8(): u8 {
    animacraft_v8_physical::physical_v8::proof_none_v8()
}

public fun claim_free_base_style_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    selection_witness: animacraft_v8_runtime::runtime_v8::RuntimePhysicalSelectionWitnessV8,
    loadout: &animacraft_v8_runtime::runtime_v8::MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalAssetV8 {
    animacraft_v8_physical::physical_v8::claim_free_base_style_v8<PaymentCoin>(
        registry, root, protocol_config, catalog, replacement, config, selection_witness, loadout, expected_issued_count, ctx
    )
}

public fun claim_free_pack_style_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    packs: &animacraft_v8_runtime::runtime_v8::PackRegistryV8,
    release: &animacraft_v8_runtime::runtime_v8::PackReleaseV8<PaymentCoin>,
    pack_treasury: &animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    pass: &animacraft_v8_runtime::runtime_v8::PackPassV8,
    selection_witness: animacraft_v8_runtime::runtime_v8::RuntimePhysicalSelectionWitnessV8,
    loadout: &animacraft_v8_runtime::runtime_v8::MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalAssetV8 {
    animacraft_v8_physical::physical_v8::claim_free_pack_style_v8<PaymentCoin>(
        registry, root, protocol_config, catalog, replacement, config, packs, release, pack_treasury, pass, selection_witness, loadout, expected_issued_count, ctx
    )
}

public fun purchase_base_style_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    protocol_treasury: &mut animacraft_v8_core::protocol_config_v8::ProtocolTreasuryV8<PaymentCoin>,
    maker_treasury: &mut animacraft_v8_core::treasury_v8::MakerTreasuryV8<PaymentCoin>,
    payment: sui::coin::Coin<PaymentCoin>,
    selection_witness: animacraft_v8_runtime::runtime_v8::RuntimePhysicalSelectionWitnessV8,
    loadout: &animacraft_v8_runtime::runtime_v8::MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalAssetV8 {
    animacraft_v8_physical::physical_v8::purchase_base_style_v8<PaymentCoin>(
        registry, root, catalog, replacement, config, protocol_config, protocol_treasury, maker_treasury, payment, selection_witness, loadout, expected_issued_count, ctx
    )
}

public fun purchase_pack_style_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    packs: &animacraft_v8_runtime::runtime_v8::PackRegistryV8,
    release: &animacraft_v8_runtime::runtime_v8::PackReleaseV8<PaymentCoin>,
    pack_treasury: &mut animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    pass: &animacraft_v8_runtime::runtime_v8::PackPassV8,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    protocol_treasury: &mut animacraft_v8_core::protocol_config_v8::ProtocolTreasuryV8<PaymentCoin>,
    payment: sui::coin::Coin<PaymentCoin>,
    selection_witness: animacraft_v8_runtime::runtime_v8::RuntimePhysicalSelectionWitnessV8,
    loadout: &animacraft_v8_runtime::runtime_v8::MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalAssetV8 {
    animacraft_v8_physical::physical_v8::purchase_pack_style_v8<PaymentCoin>(
        registry, root, catalog, replacement, config, packs, release, pack_treasury, pass, protocol_config, protocol_treasury, payment, selection_witness, loadout, expected_issued_count, ctx
    )
}

public fun materialize_base_style_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    witness: animacraft_v8_output::output_v8::PhysicalMaterializationWitnessV8,
    loadout: &animacraft_v8_runtime::runtime_v8::MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalAssetV8 {
    animacraft_v8_physical::physical_v8::materialize_base_style_v8<PaymentCoin>(
        registry, root, protocol_config, catalog, replacement, config, witness, loadout, expected_issued_count, ctx
    )
}

public fun materialize_pack_style_v8<PaymentCoin>(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    packs: &animacraft_v8_runtime::runtime_v8::PackRegistryV8,
    release: &animacraft_v8_runtime::runtime_v8::PackReleaseV8<PaymentCoin>,
    pack_treasury: &animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    pass: &animacraft_v8_runtime::runtime_v8::PackPassV8,
    witness: animacraft_v8_output::output_v8::PhysicalMaterializationWitnessV8,
    loadout: &animacraft_v8_runtime::runtime_v8::MakerLoadoutV8,
    expected_issued_count: u64,
    ctx: &mut TxContext,
): animacraft_v8_physical::physical_v8::PhysicalAssetV8 {
    animacraft_v8_physical::physical_v8::materialize_pack_style_v8<PaymentCoin>(
        registry, root, protocol_config, catalog, replacement, config, packs, release, pack_treasury, pass, witness, loadout, expected_issued_count, ctx
    )
}

public fun transfer_physical_asset_v8(
    mut asset: animacraft_v8_physical::physical_v8::PhysicalAssetV8,
    recipient: address,
    expected_ownership_epoch: u64,
    ctx: &TxContext,
) {
    animacraft_v8_physical::physical_v8::transfer_physical_asset_v8(
        asset, recipient, expected_ownership_epoch, ctx
    )
}

public fun consume_physical_asset_v8(
    registry: &mut animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    asset: animacraft_v8_physical::physical_v8::PhysicalAssetV8,
    expected_ownership_epoch: u64,
    ctx: &TxContext,
) {
    animacraft_v8_physical::physical_v8::consume_physical_asset_v8(
        registry, asset, expected_ownership_epoch, ctx
    )
}

public fun custody_base_physical_for_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    market_call_cap: &animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    maker_treasury: &animacraft_v8_core::treasury_v8::MakerTreasuryV8<PaymentCoin>,
    asset: animacraft_v8_physical::physical_v8::PhysicalAssetV8,
    ctx: &TxContext,
): animacraft_v8_physical::physical_v8::PhysicalMarketCustodyTicketV8 {
    animacraft_v8_physical::physical_v8::custody_base_physical_for_market_v8<PaymentCoin, MarketRegistry, MarketTreasury>(
        physical_registry, root, protocol_config, catalog, replacement, physical_config, market_call_cap, market_registry, market_treasury, listing_parent, maker_treasury, asset, ctx
    )
}

public fun custody_pack_physical_for_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    market_call_cap: &animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    pack_treasury: &animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    asset: animacraft_v8_physical::physical_v8::PhysicalAssetV8,
    ctx: &TxContext,
): animacraft_v8_physical::physical_v8::PhysicalMarketCustodyTicketV8 {
    animacraft_v8_physical::physical_v8::custody_pack_physical_for_market_v8<PaymentCoin, MarketRegistry, MarketTreasury>(
        physical_registry, root, protocol_config, catalog, replacement, physical_config, market_call_cap, market_registry, market_treasury, listing_parent, pack_treasury, asset, ctx
    )
}

public fun consume_physical_market_custody_ticket_v8(
    ticket: animacraft_v8_physical::physical_v8::PhysicalMarketCustodyTicketV8,
): animacraft_v8_physical::physical_v8::PhysicalMarketCustodyBindingV8 {
    animacraft_v8_physical::physical_v8::consume_physical_market_custody_ticket_v8(
        ticket
    )
}

public fun return_physical_from_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    market_call_cap: &animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    receiving: sui::transfer::Receiving<animacraft_v8_physical::physical_v8::PhysicalAssetV8>,
    custody: &animacraft_v8_physical::physical_v8::PhysicalMarketCustodyBindingV8,
) {
    animacraft_v8_physical::physical_v8::return_physical_from_market_v8<PaymentCoin, MarketRegistry, MarketTreasury>(
        physical_registry, root, protocol_config, catalog, replacement, market_call_cap, market_registry, market_treasury, listing_parent, receiving, custody
    )
}

public fun purchase_base_physical_from_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    market_call_cap: &animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    maker_treasury: &animacraft_v8_core::treasury_v8::MakerTreasuryV8<PaymentCoin>,
    receiving: sui::transfer::Receiving<animacraft_v8_physical::physical_v8::PhysicalAssetV8>,
    custody: &animacraft_v8_physical::physical_v8::PhysicalMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    animacraft_v8_physical::physical_v8::purchase_base_physical_from_market_v8<PaymentCoin, MarketRegistry, MarketTreasury>(
        physical_registry, root, protocol_config, catalog, replacement, physical_config, market_call_cap, market_registry, market_treasury, listing_parent, maker_treasury, receiving, custody, ctx
    )
}

public fun purchase_pack_physical_from_market_v8<
    PaymentCoin,
    MarketRegistry: key,
    MarketTreasury: key,
>(
    physical_registry: &animacraft_v8_physical::physical_v8::PhysicalRegistryV8,
    root: &animacraft_v8_core::maker_v8::MakerRootV8<PaymentCoin>,
    protocol_config: &animacraft_v8_core::protocol_config_v8::ProtocolConfigV8,
    catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8,
    replacement: &animacraft_v8_core::package_binding_v8::FreshTupleReplacementBindingV2,
    physical_config: &animacraft_v8_physical::physical_v8::PhysicalPackageConfigV8,
    market_call_cap: &animacraft_v8_core::package_binding_v8::RuntimeCallerCapV1,
    market_registry: &MarketRegistry,
    market_treasury: &MarketTreasury,
    listing_parent: &mut UID,
    pack_treasury: &animacraft_v8_runtime::runtime_v8::PackTreasuryV8<PaymentCoin>,
    receiving: sui::transfer::Receiving<animacraft_v8_physical::physical_v8::PhysicalAssetV8>,
    custody: &animacraft_v8_physical::physical_v8::PhysicalMarketCustodyBindingV8,
    ctx: &TxContext,
) {
    animacraft_v8_physical::physical_v8::purchase_pack_physical_from_market_v8<PaymentCoin, MarketRegistry, MarketTreasury>(
        physical_registry, root, protocol_config, catalog, replacement, physical_config, market_call_cap, market_registry, market_treasury, listing_parent, pack_treasury, receiving, custody, ctx
    )
}

public fun assert_exact_physical_type_origin(catalog: &animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8) {
    // Role 4 is Physical in the current catalog tuple. V2 checks the original
    // and defining package IDs together with the exact module/datatype name.
    let binding = animacraft_v8_core::package_binding_v8::binding_at_v2(
        animacraft_v8_core::package_binding_v8::catalog_binding_v8(catalog), 4);
    animacraft_v8_core::package_binding_v8::assert_exact_witness_type_v2<
        animacraft_v8_physical::physical_v8::PhysicalOriginalMarkerV8,
    >(binding, &b"physical_v8", &b"PhysicalOriginalMarkerV8");
    animacraft_v8_core::package_binding_v8::assert_exact_witness_type_v2<
        animacraft_v8_physical::physical_v8::PhysicalCallableMarkerV8,
    >(binding, &b"physical_v8", &b"PhysicalCallableMarkerV8")
}
