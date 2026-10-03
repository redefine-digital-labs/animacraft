import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import { MAKER_V8_BASE_ROW_BCS_V2, MAKER_V8_VISIBILITY_TOKEN_BCS_V1, MAKER_V8_COLOR_SWATCH_BCS_V2 } from './maker-v8-base-rows.js';
import { RuleRow } from './maker-v8-rule-wire.js';

const bytes = bcs.vector(bcs.u8());
export const MAKER_V8_COLOR_CHANNEL_DRAFT_BCS_V2 = bcs.struct('ColorChannelDraftV2', {
  sequence: bcs.u64(), key: bcs.string(), label: bcs.string(), default_swatch_key: bcs.string(),
  expected_swatches: bcs.u64(), swatches: bcs.vector(MAKER_V8_COLOR_SWATCH_BCS_V2),
});
export const MAKER_V8_PACK_VISIBILITY_ROW_BCS_V2 = bcs.struct('PackVisibilityRowV2', {
  subject: bcs.u8(), definition_source: bcs.u8(), part_key: bcs.string(), item_key: bcs.string(),
  style_key: bcs.option(bcs.string()), visibility_tokens: bcs.vector(MAKER_V8_VISIBILITY_TOKEN_BCS_V1),
  visibility_commitment: bytes,
});
export const MAKER_V8_PACK_DEFINITION_ROWS_BCS = bcs.struct('PackDefinitionRowsV2', {
  semantic_pack_id: bcs.string(), tracks: bcs.vector(MAKER_V8_BASE_ROW_BCS_V2.track),
  colors: bcs.vector(MAKER_V8_BASE_ROW_BCS_V2.color), parts: bcs.vector(MAKER_V8_BASE_ROW_BCS_V2.part),
  rules: bcs.vector(RuleRow), visibility: bcs.vector(MAKER_V8_PACK_VISIBILITY_ROW_BCS_V2),
});
export const MAKER_V8_PACK_DEFINITIONS_BCS = bcs.struct('PackDefinitionsV8', {
  version: bcs.u64(), release_id: bcs.Address, release_content_commitment: bytes,
  rows: MAKER_V8_PACK_DEFINITION_ROWS_BCS, commitment: bytes,
});
export const MAKER_V8_PACK_DEFINITIONS_DRAFT_BCS = bcs.struct('PackDefinitionsDraftV8', {
  next_chunk: bcs.u64(), expected_commitment: bytes, rows: MAKER_V8_PACK_DEFINITION_ROWS_BCS,
});
const Commitment = bcs.struct('PackDefinitionsCommitmentInputV8', {
  domain: bytes, version: bcs.u64(), release_id: bcs.Address,
  release_content_commitment: bytes, rows: MAKER_V8_PACK_DEFINITION_ROWS_BCS,
});
export function packDefinitionCommitmentV8(releaseId, contentCommitment, rows) {
  return sha256(Commitment.serialize({
    domain: [...new TextEncoder().encode('animacraft-v8/runtime/pack-definitions')], version: 8,
    release_id: releaseId, release_content_commitment: contentCommitment, rows,
  }).toBytes());
}
