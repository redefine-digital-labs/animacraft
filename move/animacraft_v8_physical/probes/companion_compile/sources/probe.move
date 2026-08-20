module physical_companion_probe::probe;

use animacraft_v8_core::activation_v8::PhysicalReadinessV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_core::maker_v8::{MakerAdminCapV8, MakerRootV8};
use animacraft_v8_core::package_binding_v8::{PackageCallCapV8,
    PhysicalRoleV8, ProductReleaseCatalogV8};
use animacraft_v8_physical::physical_v8::{Self as physical,
    PhysicalPackageConfigV8, PhysicalRegistryV8};
use animacraft_v8_output::output_v8::{Self as output, PhysicalSelectionBindingV8};
use std::string::String;

public fun new_config(
    catalog: &ProductReleaseCatalogV8,
    cap: PackageCallCapV8<PhysicalRoleV8>,
    ctx: &mut TxContext,
): PhysicalPackageConfigV8 {
    physical::new_physical_package_config_v8(catalog, cap, ctx)
}

public fun new_zero_registry<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    ctx: &mut TxContext,
): PhysicalRegistryV8 {
    let empty = physical::empty_base_policy_commitment_v8(
        root, base_registry, config,
    );
    physical::new_physical_registry_v8(
        root, admin, base_registry, catalog, config, 0, empty, ctx,
    )
}

public fun append_and_seal<PaymentCoin>(
    registry: &mut PhysicalRegistryV8,
    root: &MakerRootV8<PaymentCoin>,
    admin: &MakerAdminCapV8,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    part_key: String,
    item_key: String,
    style_key: String,
    material_commitment: vector<u8>,
    max_supply: u64,
) {
    let empty = physical::empty_base_policy_commitment_v8(
        root, base_registry, config,
    );
    let row = physical::derive_base_policy_row_commitment_v8(
        root,
        base_registry,
        config,
        0,
        part_key,
        item_key,
        style_key,
        material_commitment,
        physical::issue_proof_materialize_v8(),
        physical::proof_canonical_soul_v8(),
        0,
        max_supply,
        true,
    );
    let _final_commitment = physical::advance_base_policy_commitment_v8(
        root, 0, empty, row,
    );
    physical::append_base_style_policy_v8(
        registry,
        root,
        admin,
        base_registry,
        catalog,
        config,
        0,
        part_key,
        item_key,
        style_key,
        material_commitment,
        physical::issue_proof_materialize_v8(),
        physical::proof_canonical_soul_v8(),
        0,
        max_supply,
        true,
        row,
    );
    physical::seal_physical_registry_v8(
        registry, root, admin, base_registry, catalog, config,
    );
}

public fun certify<PaymentCoin>(
    root: &MakerRootV8<PaymentCoin>,
    base_registry: &BaseDefinitionRegistryV8,
    catalog: &ProductReleaseCatalogV8,
    config: &PhysicalPackageConfigV8,
    registry: &PhysicalRegistryV8,
): PhysicalReadinessV8 {
    physical::certify_physical_activation_readiness_v8(
        root, base_registry, catalog, config, registry,
    )
}

public fun read_policy(
    registry: &PhysicalRegistryV8,
    selection: &PhysicalSelectionBindingV8,
): (u64, u8, u8, u64, u64, bool, vector<u8>) {
    let row = physical::borrow_base_policy_v8(registry, selection);
    assert!(physical::policy_part_key_v8(row)
        == output::physical_selection_part_key_v8(selection), 0);
    assert!(physical::policy_item_key_v8(row)
        == output::physical_selection_item_key_v8(selection), 0);
    assert!(physical::policy_style_key_v8(row)
        == output::physical_selection_style_key_v8(selection), 0);
    assert!(physical::policy_layer_track_key_v8(row)
        == output::physical_selection_layer_track_key_v8(selection), 0);
    (
        physical::policy_sequence_v8(row),
        physical::policy_issuance_kind_v8(row),
        physical::policy_proof_kind_v8(row),
        physical::policy_price_atomic_v8(row),
        physical::policy_max_supply_v8(row),
        physical::policy_transferable_v8(row),
        *physical::policy_row_commitment_v8(row),
    )
}
