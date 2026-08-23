module runtime_adversarial_physical_replay::attack;

use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8,
    RuntimePhysicalSelectionWitnessV8};

// Must fail: a no-ability current-selection witness is consumed exactly once.
public fun replay(
    witness: RuntimePhysicalSelectionWitnessV8,
    loadout: &MakerLoadoutV8,
    ctx: &TxContext,
) {
    consume(witness, loadout, ctx);
    consume(witness, loadout, ctx);
}

fun consume(
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
