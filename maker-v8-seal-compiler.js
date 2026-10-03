import { bcs } from '@mysten/sui/bcs';

const BV = bcs.byteVector();
const prefix = { domain: bcs.string(), schema_revision: bcs.u64() };
const identity = { registry_id: bcs.Address, root_id: bcs.Address, maker_version: bcs.u64() };
export const MAKER_V8_SEAL_ID_BCS_V2 = bcs.struct('SealIdInputV2', {
  ...prefix, product_binding_commitment: BV, policy_commitment: BV,
  root_content_commitment: BV, maker_version: bcs.u64(), scope_kind: bcs.u8(),
  scope_key: bcs.string(), asset_key: bcs.string(),
});
export const MAKER_V8_SEAL_CERTIFICATION_BCS_V2 = bcs.struct('CiphertextCertificationCommitmentInputV2', {
  ...prefix, catalog_id: bcs.Address, product_binding_commitment: BV,
  policy_commitment: BV, root_content_commitment: BV, maker_version: bcs.u64(),
  scope_kind: bcs.u8(), scope_key: bcs.string(), scope_commitment: BV,
  asset_key: bcs.string(), asset_content_commitment: BV,
  ciphertext_blob_id: bcs.string(), ciphertext_sha256: BV, ciphertext_blob_commitment: BV,
});
export const MAKER_V8_SEAL_ROW_BCS_V2 = bcs.struct('ProtectedAssetV8', {
  scope_kind: bcs.u8(), scope_key: bcs.string(), scope_commitment: BV,
  asset_key: bcs.string(), asset_content_commitment: BV, ciphertext_blob_id: bcs.string(),
  ciphertext_sha256: BV, ciphertext_blob_commitment: BV, certification_commitment: BV, seal_id: BV,
});
const Empty = bcs.struct('RegistryEmptyCommitmentInputV2', { ...prefix, ...identity, category_tag: bcs.u8() });
const Row = bcs.struct('RegistryRowCommitmentInputV2', { ...prefix, ...identity, category_tag: bcs.u8(), sequence: bcs.u64(), row_bcs: BV });
const Advance = bcs.struct('RegistryAdvanceCommitmentInputV2', { ...prefix, registry_id: bcs.Address, category_tag: bcs.u8(), sequence: bcs.u64(), prior_rolling_commitment: BV, row_commitment: BV });
export const MAKER_V8_SEAL_REGISTRY_BCS_V2 = bcs.struct('SealRegistryCommitmentInputV2', {
  ...prefix, ...identity, root_content_commitment: BV, policy_id: bcs.Address,
  base_count: bcs.u64(), pack_count: bcs.u64(), complete_count: bcs.u64(),
  base_commitment: BV, pack_commitment: BV, complete_commitment: BV,
  revision: bcs.u64(), sealed: bcs.bool(),
});
export const MAKER_V8_SEAL_READBACK_FIELDS_V2 = Object.freeze([
  'version', 'rootId', 'makerVersion', 'rootContentCommitment', 'catalogId',
  'productBindingCommitment', 'policyConfigId', 'policyCommitment',
  'expectedBaseCount', 'expectedPackCount', 'expectedCompleteCount',
  'baseCount', 'packCount', 'completeCount', 'baseCommitment', 'packCommitment',
  'completeCommitment', 'revision', 'commitment', 'sealed', 'runtimeRevision',
]);
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
function bytes(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Seal commitment requires exact canonical 32-byte hex.');
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
}
async function hash(type, value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', type.serialize(value).toBytes())));
}
const domain = name => ({ domain: `animacraft-fresh-v8/compiler/registry-${name}/v2`, schema_revision: 2n });

// This storage lane deliberately requires actual certified object IDs. It is
// never used as a pre-creation commitment or as a substitute for author intent.
export async function deriveMakerV8SealStorageV2({ registryId, rootId, makerVersion, rootContentCommitment, policyId, rows }) {
  for (const value of [registryId, rootId, policyId]) if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) throw new Error('Seal storage requires exact nonzero object IDs.');
  if (!/^(0|[1-9][0-9]*)$/.test(String(makerVersion)) || (typeof makerVersion === 'number' && !Number.isSafeInteger(makerVersion)) || BigInt(makerVersion) > 18446744073709551615n) throw new Error('Seal maker version requires exact u64.');
  makerVersion = BigInt(makerVersion);
  const contentBytes = bytes(rootContentCommitment);
  if (!Array.isArray(rows)) throw new Error('Seal rows require an ordered array.');
  // Finish all caller-owned reads and BCS serialization before the first await.
  const rowBytes = rows.map((row, index) => {
    const category_tag = row.scope_kind;
    if (![0, 1, 2].includes(category_tag) || String(row.sequence) !== String(index)) throw new Error('Seal rows require exact global append sequence and scope.');
    const row_bcs = MAKER_V8_SEAL_ROW_BCS_V2.serialize(row).toBytes();
    const decoded = MAKER_V8_SEAL_ROW_BCS_V2.parse(row_bcs);
    for (const key of ['scope_commitment', 'asset_content_commitment', 'ciphertext_sha256', 'ciphertext_blob_commitment', 'certification_commitment', 'seal_id']) if (decoded[key].length !== 32) throw new Error('Seal row hashes must be exactly 32 bytes.');
    return { category_tag, row_bcs };
  });
  const ids = { registry_id: registryId, root_id: rootId, maker_version: makerVersion };
  const counts = [0n, 0n, 0n];
  const lanes = await Promise.all(counts.map((_, category_tag) => hash(Empty, { ...domain('empty'), ...ids, category_tag })));
  const checkpoint = async sealed => Object.freeze({
    baseCount: String(counts[0]), packCount: String(counts[1]), completeCount: String(counts[2]),
    baseCommitment: lanes[0], packCommitment: lanes[1], completeCommitment: lanes[2], revision: '0', runtimeRevision: '0', sealed,
    commitment: await hash(MAKER_V8_SEAL_REGISTRY_BCS_V2, {
      domain: 'animacraft-fresh-v8/seal/registry/v2', schema_revision: 2n, ...ids,
      root_content_commitment: contentBytes, policy_id: policyId,
      base_count: counts[0], pack_count: counts[1], complete_count: counts[2],
      base_commitment: bytes(lanes[0]), pack_commitment: bytes(lanes[1]), complete_commitment: bytes(lanes[2]), revision: 0n, sealed,
    }),
  });
  const checkpoints = [await checkpoint(false)];
  for (const [index, { category_tag, row_bcs }] of rowBytes.entries()) {
    const sequence = BigInt(index);
    const row_commitment = await hash(Row, { ...domain('row'), ...ids, category_tag, sequence, row_bcs });
    lanes[category_tag] = await hash(Advance, { ...domain('advance'), registry_id: registryId, category_tag, sequence, prior_rolling_commitment: bytes(lanes[category_tag]), row_commitment: bytes(row_commitment) });
    counts[category_tag] += 1n;
    checkpoints.push(await checkpoint(false));
  }
  return Object.freeze({ checkpoints: Object.freeze(checkpoints), sealed: await checkpoint(true) });
}
