import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import { MAKER_V8_SEAL_ROW_BCS_V2, MAKER_V8_SEAL_REGISTRY_BCS_V2 } from './maker-v8-seal-compiler.js';
const BV = bcs.byteVector();
const prefix = { domain: bcs.string(), schema_revision: bcs.u64() };
const Row = bcs.struct('RegistryRowCommitmentInputV2', { ...prefix, registry_id: bcs.Address, root_id: bcs.Address, maker_version: bcs.u64(), category_tag: bcs.u8(), sequence: bcs.u64(), row_bcs: BV });
const Advance = bcs.struct('RegistryAdvanceCommitmentInputV2', { ...prefix, registry_id: bcs.Address, category_tag: bcs.u8(), sequence: bcs.u64(), prior_rolling_commitment: BV, row_commitment: BV });
const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
const hash = (type, value) => hex(sha256(type.serialize(value).toBytes()));
const bytes = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) throw new Error('Invalid Seal hash.');
  return Uint8Array.from(value.match(/../g), x => parseInt(x, 16));
};
const count = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 18446744073709551615n) throw new Error('Invalid Seal u64.');
  return BigInt(value);
};
const fields = ['registryId', 'rootId', 'makerVersion', 'rootContentCommitment', 'policyId', 'baseCount', 'packCount', 'completeCount', 'baseCommitment', 'packCommitment', 'completeCommitment', 'revision', 'runtimeRevision', 'sealed'];
export function deriveMakerV8SealRuntimeRegistryCommitmentV2(state) {
  if (!state || ![Object.prototype, null].includes(Object.getPrototypeOf(state)) || Reflect.ownKeys(state).length !== fields.length
    || fields.some(k => !Object.hasOwn(Object.getOwnPropertyDescriptor(state, k) || {}, 'value'))) throw new Error('Invalid exact Seal registry state.');
  for (const key of ['registryId', 'rootId', 'policyId']) if (!/^0x[0-9a-f]{64}$/.test(state[key]) || /^0x0+$/.test(state[key])) throw new Error('Invalid Seal ID.');
  if (!count(state.makerVersion) || state.sealed !== true) throw new Error('Runtime Seal requires a sealed Maker registry.');
  const revision = count(state.revision); count(state.runtimeRevision);
  if (state.revision !== state.runtimeRevision) throw new Error('Runtime Seal revision mismatch.');
  return hash(MAKER_V8_SEAL_REGISTRY_BCS_V2, { domain: 'animacraft-fresh-v8/seal/registry/v2', schema_revision: 2n,
    registry_id: state.registryId, root_id: state.rootId, maker_version: count(state.makerVersion), root_content_commitment: bytes(state.rootContentCommitment), policy_id: state.policyId,
    base_count: count(state.baseCount), pack_count: count(state.packCount), complete_count: count(state.completeCount),
    base_commitment: bytes(state.baseCommitment), pack_commitment: bytes(state.packCommitment), complete_commitment: bytes(state.completeCommitment), revision, sealed: true });
}
export function advanceMakerV8SealRuntimeV2(input, row) {
  deriveMakerV8SealRuntimeRegistryCommitmentV2(input);
  const state = { ...input };
  const scope = row.scope_kind;
  if (![0, 1, 2].includes(scope)) throw new Error('Invalid Seal scope.');
  const sequence = count(state.baseCount) + count(state.packCount) + count(state.completeCount);
  if (sequence >= 18446744073709551615n || count(state.runtimeRevision) >= 18446744073709551615n) throw new Error('Seal counter overflow.');
  const lane = ['base', 'pack', 'complete'][scope];
  const rowCommitment = hash(Row, { domain: 'animacraft-fresh-v8/compiler/registry-row/v2', schema_revision: 2n,
    registry_id: state.registryId, root_id: state.rootId, maker_version: state.makerVersion, category_tag: scope, sequence,
    row_bcs: MAKER_V8_SEAL_ROW_BCS_V2.serialize(row).toBytes() });
  state[`${lane}Commitment`] = hash(Advance, { domain: 'animacraft-fresh-v8/compiler/registry-advance/v2', schema_revision: 2n,
    registry_id: state.registryId, category_tag: scope, sequence, prior_rolling_commitment: bytes(state[`${lane}Commitment`]), row_commitment: bytes(rowCommitment) });
  state[`${lane}Count`] = String(count(state[`${lane}Count`]) + 1n);
  state.revision = state.runtimeRevision = String(count(state.runtimeRevision) + 1n);
  return Object.freeze({ state: Object.freeze(state), commitment: deriveMakerV8SealRuntimeRegistryCommitmentV2(state) });
}
