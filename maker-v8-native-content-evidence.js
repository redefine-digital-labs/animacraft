import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, fromBase64, toBase64, toBase58, normalizeStructTag } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { contentEnvelopeKey, decodeContentEnvelope } from './maker-v8-native-envelope-codec.js';

const enc = new TextEncoder(); const dec = new TextDecoder('utf-8', { fatal: true });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = bytes => [...sha256(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const check = value => { if (!value) throw Object.assign(new Error('MAKER_V8_NATIVE_CONTENT_EVIDENCE_INVALID'), { code: 'MAKER_V8_NATIVE_CONTENT_EVIDENCE_INVALID' }); };
const Table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
export const NativeContentStateBCS = bcs.struct('SoulState', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address,
  creator: bcs.Address, creator_royalty_bps: bcs.u16(), current_owner: bcs.Address, current_kiosk_id: bcs.Address,
  ownership_epoch: bcs.u64(), grant_capacity: bcs.u64(), active_grants: Table, active_grant_ids: Table,
  active_grant_count: bcs.u64(), content_id: bcs.option(bcs.Address), config_ext: Table,
  collection_id: bcs.option(bcs.Address), access_list_id: bcs.option(bcs.Address), is_listed: bcs.bool() });
export const NativeContentBCS = bcs.struct('SoulContent', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address,
  items: Table, count_by_kind: Table, active: Table });
export const NativeContentKeyBCS = bcs.struct('ContentKey', { kind: bcs.u32(), name: bcs.string() });
export const NativeContentSlotBCS = bcs.struct('ContentSlot', { version: bcs.u64(), kind: bcs.u32(), blob_object_id: bcs.Address,
  is_public: bcs.bool(), deleted: bcs.bool(), purged: bcs.bool(), download_policy: bcs.u8(), grant_scope_mask: bcs.u64(),
  read_mode_mask: bcs.u64(), op_mask: bcs.u64(), seal_encrypted: bcs.bool(), created_at_ms: bcs.u64() });
export const nativeContentFieldBCS = (name, value) => bcs.struct('Field', { id: bcs.Address, name, value });
// Fixed built-ins from Soulidity kind_registry::init + grant::scope_*.
// Descriptor permissions are immutable after registration; custom kinds require
// their own descriptor evidence and must never inherit a built-in default.
const BUILTIN_POLICIES = new Map([[0, ['0', '1']], [1, ['7', '2']], [2, ['7', '4']], [3, ['15', '8']], [4, ['15', '8']]]);

function effectRows(evidence, transactionDigest, effectsSha256) {
  check(evidence?.schema === 'animacraft.native-initial-content-evidence.v1' && Array.isArray(evidence.objects));
  const bytes = fromBase64(evidence.effectsBcsBase64); const effects = bcs.TransactionEffects.parse(bytes);
  check(toBase64(bytes) === evidence.effectsBcsBase64 && bcs.TransactionEffects.serialize(effects).toBase64() === evidence.effectsBcsBase64
    && hash(bytes) === effectsSha256 && effects.V2?.transactionDigest === transactionDigest && effects.V2.status.$kind === 'Success');
  return effects.V2;
}

/** Full Object BCS derives the effects digest; decoded JSON is never an authority. */
function decoded(row, objectId, type, codec, parent, effects, transactionDigest) {
  check(row?.objectId === objectId && typeof row.objectBcsBase64 === 'string');
  const bytes = fromBase64(row.objectBcsBase64); const object = bcs.Object.parse(bytes); const move = object.data.Move;
  const domain = enc.encode('Object::'); const digestBytes = new Uint8Array(domain.length + bytes.length);
  digestBytes.set(domain); digestBytes.set(bytes, domain.length);
  const digest = toBase58(blake2b(digestBytes, { dkLen: 32 }));
  const changes = effects.changedObjects.filter(([id]) => id === objectId);
  check(changes.length === 1 && changes[0][1].inputState.$kind === 'NotExist' && changes[0][1].idOperation.$kind === 'Created');
  const write = changes[0][1].outputState.ObjectWrite;
  check(write && write[0] === digest && same(write[1], object.owner)
    && bcs.Object.serialize(object).toBase64() === row.objectBcsBase64 && object.previousTransaction === transactionDigest
    && move?.version === effects.lamportVersion && move.type.Other
    && normalizeStructTag(TypeTagSerializer.tagToString({ struct: move.type.Other })) === normalizeStructTag(type));
  if (parent === null) check(object.owner.Shared?.initialSharedVersion === effects.lamportVersion);
  else check(object.owner.ObjectOwner === parent);
  const value = codec.parse(move.contents);
  check(value.id === objectId && toBase64(codec.serialize(value).toBytes()) === toBase64(move.contents));
  return value;
}

// The generator names every required object from already verified parent BCS.
// Both online collection and cold validation execute this same graph.
function* graph({ input, originalPackageId: pkg, soulId, stateId, signer }) {
  const state = yield [stateId, `${pkg}::soul::SoulState`, NativeContentStateBCS, null];
  check(state.version === '1' && state.soul_id === soulId && state.content_id === input.expectedContentObjectId
    && state.creator === signer && state.current_owner === signer && state.ownership_epoch === '0' && !state.is_listed);
  const content = yield [input.expectedContentObjectId, `${pkg}::content::SoulContent`, NativeContentBCS, null];
  check(content.version === '1' && content.soul_id === soulId);
  const field = function* (table, keyType, keyCodec, key, valueType, valueCodec) {
    const fieldId = deriveDynamicFieldID(table.id, keyType, keyCodec.serialize(key).toBytes());
    const value = yield [fieldId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, nativeContentFieldBCS(keyCodec, valueCodec), table.id];
    check(same(value.name, key)); return value.value;
  };
  const groups = new Map(); const kinds = new Map(); const active = new Map(); const configs = [...input.initialStateConfig];
  for (const entry of input.initialContent) {
    const key = JSON.stringify([entry.kind, entry.name]); const group = groups.get(key) ?? [];
    check(entry.expectedVersionIndex === String(group.length)); group.push(entry); groups.set(key, group);
    if (group.length === 1) kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
    if (entry.setActive) active.set(entry.kind, { version: '1', kind: entry.kind, name: entry.name,
      version_index: entry.expectedVersionIndex, download_policy: ['public', 'owner_only', 'allowlist'].indexOf(entry.downloadPolicy) });
    const slot = { contentObjectId: input.expectedContentObjectId, kind: entry.kind, name: entry.name,
      versionIndex: entry.expectedVersionIndex, blobObjectId: entry.blobObjectId };
    decodeContentEnvelope(entry.encryptedEnvelope, slot, pkg);
    configs.push({ key: contentEnvelopeKey(slot), valueUtf8: entry.encryptedEnvelope });
  }
  check(content.items.size === String(groups.size) && content.count_by_kind.size === String(kinds.size)
    && content.active.size === String(active.size) && state.config_ext.size === String(configs.length));
  for (const group of groups.values()) {
    const first = group[0]; const key = { kind: first.kind, name: first.name };
    const slots = yield* field(content.items, `${pkg}::content::ContentKey`, NativeContentKeyBCS, key,
      `vector<${pkg}::content::ContentSlot>`, bcs.vector(NativeContentSlotBCS));
    check(slots.length === group.length);
    slots.forEach((slot, index) => { const entry = group[index];
      const policy = BUILTIN_POLICIES.get(entry.kind); check(policy);
      check(slot.version === '1' && slot.kind === entry.kind && slot.blob_object_id === entry.blobObjectId
        && slot.is_public === Boolean(entry.slotReadModeMask & 8) && !slot.deleted && !slot.purged && slot.seal_encrypted
        && slot.read_mode_mask === String(entry.slotReadModeMask)
        && slot.op_mask === policy[0] && slot.grant_scope_mask === policy[1]
        && slot.download_policy === ['public', 'owner_only', 'allowlist'].indexOf(entry.downloadPolicy)); });
  }
  for (const [kind, count] of kinds) check((yield* field(content.count_by_kind, 'u32', bcs.u32(), kind, 'u64', bcs.u64())) === String(count));
  for (const [kind, binding] of active) {
    const codec = bcs.struct('ActiveBinding', { version: bcs.u64(), kind: bcs.u32(), name: bcs.string(), version_index: bcs.u64(), download_policy: bcs.u8() });
    check(same(yield* field(content.active, 'u32', bcs.u32(), kind, `${pkg}::content::ActiveBinding`, codec), binding));
  }
  check(new Set(configs.map(row => row.key)).size === configs.length);
  for (const config of configs) check(dec.decode(Uint8Array.from(yield* field(state.config_ext, '0x1::string::String',
    bcs.string(), config.key, 'vector<u8>', bcs.vector(bcs.u8())))) === config.valueUtf8);
}

export function assertMakerV8NativeContentEvidenceV8(args) {
  const effects = effectRows(args.evidence, args.transactionDigest, args.effectsSha256);
  const objects = args.evidence.objects; check(new Set(objects.map(row => row.objectId)).size === objects.length);
  const seen = new Set(); const walk = graph(args); let next = walk.next();
  while (!next.done) { const [id, type, codec, parent] = next.value;
    seen.add(id); next = walk.next(decoded(objects.find(row => row.objectId === id), id, type, codec, parent, effects, args.transactionDigest)); }
  check(seen.size === objects.length); return true;
}

export async function readMakerV8NativeContentEvidenceV8({ client, effectsBcs, ...args }) {
  args = structuredClone(args); effectsBcs = new Uint8Array(effectsBcs);
  const evidence = { schema: 'animacraft.native-initial-content-evidence.v1', effectsBcsBase64: toBase64(effectsBcs), objects: [] };
  const effects = effectRows(evidence, args.transactionDigest, args.effectsSha256);
  const walk = graph(args); let next = walk.next();
  while (!next.done) {
    const [id, type, codec, parent] = next.value;
    let object;
    try { object = await client.getHistoricalObject({ objectId: id, version: BigInt(effects.lamportVersion) }); }
    catch (cause) { throw Object.assign(new Error('Native initial content history is unavailable; retry the same mint with an archival endpoint.'),
      { code: 'MAKER_V8_BROWSER_READBACK_UNAVAILABLE', layer: 'READBACK', retryable: true,
        details: { objectId: id, version: effects.lamportVersion, archivalRpcRequired: true }, cause }); }
    check(object?.objectId === id && object.objectBcs instanceof Uint8Array);
    const row = { objectId: id, objectBcsBase64: toBase64(object.objectBcs) }; evidence.objects.push(row);
    next = walk.next(decoded(row, id, type, codec, parent, effects, args.transactionDigest));
  }
  assertMakerV8NativeContentEvidenceV8({ ...args, evidence }); return evidence;
}
