module output_companion_compile::probe;

use animacraft_v8_core::maker_v8::{MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::activation_v8::OutputReadinessV8;
use animacraft_v8_core::package_binding_v8::{PackageCallCapV8,
    OutputRoleV8, PhysicalRoleV8, ProductReleaseCatalogV8};
use animacraft_v8_runtime::runtime_v8::{MakerLoadoutV8,
    RuntimePhysicalSelectionWitnessV8};
use animacraft_v8_output::output_v8::{Self as output,
    CanonicalSoulV8, CompleteReceiptV8, OutputPackageConfigV8,
    OutputPolicyRowV8, OutputRegistryV8,
    PhysicalCompleteBindingV8, PhysicalMaterializationWitnessV8,
    PhysicalSelectionBindingV8, SoulRegistryV8};

public struct PhysicalOriginalMarker has drop {}
public struct PhysicalCallableMarker has drop {}

public fun new_output_config(
    catalog: &ProductReleaseCatalogV8,
    cap: PackageCallCapV8<OutputRoleV8>,
    ctx: &mut TxContext,
): OutputPackageConfigV8 {
    output::new_output_package_config_v8(catalog, cap, ctx)
}

public fun new_registries<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    expected_count: u64,
    expected_commitment: vector<u8>,
    ctx: &mut TxContext,
): (OutputRegistryV8, SoulRegistryV8) {
    output::new_output_registries_v8(
        root, admin, expected_count, expected_commitment, ctx)
}

public fun append_policy<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    sequence: u64,
    output_key: std::string::String,
    protected: bool,
    scope_key: std::string::String,
    renderer_schema_commitment: vector<u8>,
    pack_policy: u8,
    allowlist: vector<std::string::String>,
    row_commitment: vector<u8>,
) {
    output::append_output_policy_v8(
        registry, root, admin, sequence, output_key, protected, scope_key,
        renderer_schema_commitment, pack_policy, allowlist, row_commitment)
}

public fun seal_policy<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
) {
    output::seal_output_registry_v8(registry, root, admin)
}

public fun inspect_policy(
    registry: &OutputRegistryV8,
    output_key: std::string::String,
): &OutputPolicyRowV8 {
    output::output_policy_row_v8(registry, output_key)
}

public fun certify_readiness<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &OutputPackageConfigV8,
    registry: &OutputRegistryV8,
    souls: &SoulRegistryV8,
): OutputReadinessV8 {
    output::certify_output_activation_readiness_v8(
        root, catalog, config, registry, souls)
}

public fun inspect_receipt(receipt: &CompleteReceiptV8) {
    let _holder = output::receipt_holder_v8(receipt);
    let _key = output::receipt_output_key_v8(receipt);
    let _policy = output::receipt_output_policy_commitment_v8(receipt);
    let _loadout = output::receipt_loadout_id_v8(receipt);
    let _revision = output::receipt_loadout_revision_v8(receipt);
    let _commitment = output::receipt_loadout_commitment_v8(receipt);
}

public fun consume_for_physical(
    witness: PhysicalMaterializationWitnessV8,
    catalog: &ProductReleaseCatalogV8,
    cap: &PackageCallCapV8<PhysicalRoleV8>,
): (PhysicalCompleteBindingV8, PhysicalSelectionBindingV8,
    std::string::String, vector<u8>) {
    output::consume_physical_materialization_witness_v8<
        PhysicalOriginalMarker,
        PhysicalCallableMarker,
    >(witness, catalog, cap)
}

public fun new_physical_witness<PaymentCoin>(
    registry: &mut OutputRegistryV8,
    souls: &SoulRegistryV8,
    receipt: &CompleteReceiptV8,
    soul: &CanonicalSoulV8,
    root: &MakerRootV8<PaymentCoin>,
    loadout: &MakerLoadoutV8,
    selection: RuntimePhysicalSelectionWitnessV8,
    materialization_key: std::string::String,
    ctx: &TxContext,
): PhysicalMaterializationWitnessV8 {
    output::new_physical_materialization_witness_v8(
        registry, souls, receipt, soul, root, loadout, selection,
        materialization_key, ctx)
}

public fun inspect_physical(
    complete: &PhysicalCompleteBindingV8,
    selection: &PhysicalSelectionBindingV8,
) {
    let _output_registry = output::physical_complete_output_registry_id_v8(complete);
    let _output_key = output::physical_complete_output_key_v8(complete);
    let _policy = output::physical_complete_policy_commitment_v8(complete);
    let _receipt = output::physical_complete_receipt_id_v8(complete);
    let _soul = output::physical_complete_soul_id_v8(complete);
    let _recipe = output::physical_complete_recipe_commitment_v8(complete);
    let _render = output::physical_complete_render_commitment_v8(complete);
    let _loadout = output::physical_selection_loadout_id_v8(selection);
    let _index = output::physical_selection_index_v8(selection);
    let _selection = output::physical_selection_commitment_v8(selection);
    let _part = output::physical_selection_part_key_v8(selection);
    let _item = output::physical_selection_item_key_v8(selection);
    let _style = output::physical_selection_style_key_v8(selection);
    let _track = output::physical_selection_layer_track_key_v8(selection);
    let _source = output::physical_selection_source_definition_id_v8(selection);
    let _asset = output::physical_selection_asset_content_commitment_v8(selection);
}
