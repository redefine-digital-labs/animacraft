import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';

const BV = bcs.vector(bcs.u8());
export const RuntimeEmpty = bcs.struct('EmptyCommitmentInputV8', { domain: BV, version: bcs.u64(), root_content_commitment: BV });
export const RuntimeProfile = bcs.struct('PartProfileCommitmentInputV8', { domain: BV, version: bcs.u64(), root_content_commitment: BV, sequence: bcs.u64(), previous: BV, part_key: bcs.string(), core_part_payload_commitment: BV, required: bcs.bool(), wardrobe_mode: bcs.u8(), behavior: bcs.u8(), capacity: bcs.u64(), admission_ceiling: bcs.u8() });
const domain = value => [...new TextEncoder().encode(value)];
const hex = value => [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
function fail() { throw Object.assign(new Error('Pack profile rows differ from the sealed Runtime policy.'), { code: 'MAKER_V8_PACK_PROFILE_INVALID' }); }

/** Mirrors pack_part_profiles_v8; input bundle must already be authenticated. */
export function deriveMakerV8PackProfiles(bundle, admission) {
  if (![0, 1, 2].includes(admission) || !/^[0-9a-f]{64}$/.test(bundle?.contentCommitment)
    || !Array.isArray(bundle?.rows?.parts) || bundle.rows.parts.length > 500) fail();
  const content = bundle.contentCommitment.match(/../g).map(value => parseInt(value, 16));
  let rolling = sha256(RuntimeEmpty.serialize({ domain: domain('animacraft-v8/runtime/part-profiles-empty'),
    version: 8, root_content_commitment: content }).toBytes());
  const keys = new Set();
  return Object.freeze(bundle.rows.parts.map((row, index) => {
    if (String(row.sequence) !== String(index) || row.required !== false || ![0, 1].includes(row.slot_mode)
      || !/^[1-9][0-9]*$/.test(String(row.capacity)) || BigInt(row.capacity) > 64n
      || typeof row.key !== 'string' || !row.key || keys.has(row.key)
      || row.payload_commitment?.length !== 32) fail();
    keys.add(row.key);
    rolling = sha256(RuntimeProfile.serialize({ domain: domain('animacraft-v8/runtime/part-profile'), version: 8,
      root_content_commitment: content, sequence: index, previous: [...rolling], part_key: row.key,
      core_part_payload_commitment: row.payload_commitment, required: false, wardrobe_mode: row.slot_mode,
      behavior: row.slot_mode === 0 ? 0 : admission === 0 ? 1 : 3,
      capacity: row.capacity, admission_ceiling: admission }).toBytes());
    return Object.freeze({ partKey: row.key, capacity: String(row.capacity), profileCommitment: hex(rolling) });
  }));
}
