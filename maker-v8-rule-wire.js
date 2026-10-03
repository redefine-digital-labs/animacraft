import { bcs } from '@mysten/sui/bcs';

const text = bcs.option(bcs.string());
export const SemanticSelector = bcs.struct('SemanticSelectorV2', {
  source: bcs.u8(), source_key: text, part_key: bcs.string(), item_key: text, style_key: text,
});
export const RuleRow = bcs.struct('RuleRowV2', {
  sequence: bcs.u64(), key: bcs.string(), kind: bcs.u8(), trigger: SemanticSelector,
  target_mode: bcs.u8(), targets: bcs.vector(SemanticSelector), payload_commitment: bcs.byteVector(),
});
