module runtime_output_companion_probe::probe;

use animacraft_v8_core::activation_v8::OutputRuntimeRequestV8;
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::package_binding_v8::ProductReleaseCatalogV8;
use animacraft_v8_runtime::runtime_binding_v8::{Self as runtime_binding,
    RuntimePackageConfigV8};
use animacraft_v8_runtime::runtime_v8::{
    Self as runtime,
    MakerLoadoutV8,
    PackCompleteLineV8,
    PackPassV8,
    PackRegistryV8,
    PackReleaseV8,
    RuntimePhysicalSelectionWitnessV8,
    RuntimeLoadoutAuthorizationV8,
    SelectionAccessProofV8,
};

public fun authorize_pack_complete<PaymentCoin, OutputRegistry: key>(
    request: OutputRuntimeRequestV8,
    root: &MakerRootV8<PaymentCoin>,
    catalog: &ProductReleaseCatalogV8,
    config: &RuntimePackageConfigV8,
    output_registry: &OutputRegistry,
    release: &mut PackReleaseV8<PaymentCoin>,
    packs: &PackRegistryV8,
    pass: &PackPassV8,
    authorization: &RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): PackCompleteLineV8 {
    runtime_binding::authorize_pack_complete_from_output_v8(
        request, root, catalog, config, output_registry, release, packs, pass,
        authorization, loadout, ctx,
    )
}

public fun consume_free_pack_complete<PaymentCoin>(
    line: PackCompleteLineV8,
    release: &PackReleaseV8<PaymentCoin>,
    root: &MakerRootV8<PaymentCoin>,
    ctx: &TxContext,
) {
    let (_release_id, _ordinal) =
        runtime::consume_free_pack_complete_line_v8(line, release, root, ctx);
}

public fun consume_for_output(
    authorization: RuntimeLoadoutAuthorizationV8,
    loadout: &MakerLoadoutV8,
) {
    let (
        _loadout_id, _root_id, _root_version, _root_content_commitment,
        _revision, _loadout_commitment, _selection_count,
        _selection_commitments, _pricing_commitments,
        _used_packs,
    ) = runtime::consume_loadout_authorization_v8(authorization, loadout);
}


public fun certify_physical_selection(
    proof: SelectionAccessProofV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
): RuntimePhysicalSelectionWitnessV8 {
    runtime::certify_physical_selection_v8(proof, loadout, ctx)
}

public fun consume_physical_selection(
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
) {
    let (_loadout_id, _root_id, _root_version, _root_content, _holder,
        _revision, _loadout_commitment, _index, _selection_commitment,
        _part_key, _item_key, _style_key, _layer_track_key,
        _source_class, _source_definition_id, _source_semantic_id,
        _source_content, _source_epoch, _pricing_commitment, _asset_content) =
        runtime::consume_physical_selection_witness_v8(witness, loadout, ctx);
}
