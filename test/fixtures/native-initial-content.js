import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { EncryptedObject } from '@mysten/seal';
import { deriveDynamicFieldID, toBase64, toBase58, fromHex, toHex } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { NativeContentStateBCS as State, NativeContentBCS as Content, NativeContentKeyBCS as Key,
  NativeContentSlotBCS as Slot, nativeContentFieldBCS as Field } from '../../maker-v8-native-content-evidence.js';
import { contentEnvelopeKey, encodeContentEnvelope, CONTENT_ENVELOPE_SCHEMA } from '../../maker-v8-native-envelope-codec.js';
export const fixtureId = n => `0x${n.toString(16).padStart(64, '0')}`;
export const nativeMintDigest = toBase58(new Uint8Array(32).fill(17));
export function nativeInitialInputFixture(input, packageId) {
  input = structuredClone(input);
  for (const entry of input.initialContent) {
    const slot = { contentObjectId: input.expectedContentObjectId, kind: entry.kind, name: entry.name,
      versionIndex: entry.expectedVersionIndex, blobObjectId: entry.blobObjectId };
    const name = new TextEncoder().encode(entry.name); const doc = new Uint8Array(75 + name.length);
    doc.set(new TextEncoder().encode('soul-content:')); doc[13] = 1; new DataView(doc.buffer).setUint32(14, entry.kind, false);
    doc.set(fromHex(input.expectedContentObjectId), 18); doc.set(name, 50);
    new DataView(doc.buffer).setBigUint64(51 + name.length, BigInt(entry.expectedVersionIndex), false);
    const documentId = `0x${toHex(doc)}`;
    const sidecar = { version: 1, mode: 'seal-envelope', sealPackageId: packageId, documentId,
      encryptedDek: toBase64(encryptedObjectFixture({ packageId, id: documentId }).encryptedObject), iv: toBase64(new Uint8Array(12)),
      cipher: 'AES-GCM-256', mimeType: 'text/markdown', fileName: `${entry.name}.md`, contentHash: 'ab'.repeat(32) };
    entry.encryptedEnvelope = encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...slot, sidecar }, packageId);
  }
  return input;
}
export function encryptedObjectFixture({ packageId, id }) {
  return { encryptedObject: EncryptedObject.serialize({ version: 0, packageId, id, services: [[fixtureId(90), 1]], threshold: 1,
    encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96), encryptedShares: [new Uint8Array(32)], encryptedRandomness: new Uint8Array(32) } },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(16), aad: new Uint8Array() } } }).toBytes() };
}
export function nativeInitialEvidenceFixture({ input, originalPackageId: pkg, soulId, stateId, signer, transactionDigest = nativeMintDigest }) {
  const id = fixtureId; const objects = []; const changes = []; const full = new Map();
  const add = (objectId, type, codec, value, parent = null) => {
    const owner = parent === null ? { Shared: { initialSharedVersion: '11' } } : { ObjectOwner: parent };
    const objectBcs = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type, true).struct },
      hasPublicTransfer: false, version: '11', contents: codec.serialize(value).toBytes() } }, owner,
      previousTransaction: transactionDigest, storageRebate: '0' }).toBytes();
    const digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...objectBcs]), { dkLen: 32 }));
    objects.push({ objectId, objectBcsBase64: toBase64(objectBcs) }); full.set(objectId, { objectId, objectBcs });
    changes.push([objectId, { inputState: { NotExist: true }, outputState: { ObjectWrite: [digest, owner] }, idOperation: { Created: true } }]);
  };
  const table = (n, size) => ({ id: id(n), size: String(size) });
  const entries = input.initialContent; const contentId = input.expectedContentObjectId;
  add(stateId, `${pkg}::soul::SoulState`, State, { id: stateId, version: '1', soul_id: soulId, creator: signer,
    creator_royalty_bps: 0, current_owner: signer, current_kiosk_id: id(20), ownership_epoch: '0', grant_capacity: '12',
    active_grants: table(901, 0), active_grant_ids: table(902, 0), active_grant_count: '0', content_id: contentId,
    config_ext: table(903, entries.length + input.initialStateConfig.length), collection_id: null, access_list_id: null, is_listed: false });
  add(contentId, `${pkg}::content::SoulContent`, Content, { id: contentId, version: '1', soul_id: soulId,
    items: table(904, entries.length), count_by_kind: table(905, new Set(entries.map(e => e.kind)).size), active: table(906, 0) });
  const field = (parent, keyType, keyCodec, name, valueType, valueCodec, value) => {
    const objectId = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(name).toBytes());
    add(objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, Field(keyCodec, valueCodec), { id: objectId, name, value }, parent);
  };
  const kinds = new Map(); const configs = [...input.initialStateConfig];
  for (const entry of entries) {
    field(id(904), `${pkg}::content::ContentKey`, Key, { kind: entry.kind, name: entry.name }, `vector<${pkg}::content::ContentSlot>`, bcs.vector(Slot),
      [{ version: '1', kind: entry.kind, blob_object_id: entry.blobObjectId, is_public: Boolean(entry.slotReadModeMask & 8),
        deleted: false, purged: false, download_policy: ['public', 'owner_only', 'allowlist'].indexOf(entry.downloadPolicy),
        grant_scope_mask: ['1', '2', '4', '8', '8'][entry.kind], read_mode_mask: String(entry.slotReadModeMask),
        op_mask: ['0', '7', '7', '15', '15'][entry.kind], seal_encrypted: true, created_at_ms: '1' }]);
    kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
    configs.push({ key: contentEnvelopeKey({ contentObjectId: contentId, kind: entry.kind, name: entry.name,
      versionIndex: entry.expectedVersionIndex, blobObjectId: entry.blobObjectId }), valueUtf8: entry.encryptedEnvelope });
  }
  for (const [kind, count] of kinds) field(id(905), 'u32', bcs.u32(), kind, 'u64', bcs.u64(), String(count));
  for (const config of configs) field(id(903), '0x1::string::String', bcs.string(), config.key, 'vector<u8>', bcs.vector(bcs.u8()), [...new TextEncoder().encode(config.valueUtf8)]);
  const effectsBcs = bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: '10',
    gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' }, transactionDigest,
    gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '11', changedObjects: changes,
    unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes();
  return { evidence: { schema: 'animacraft.native-initial-content-evidence.v1', effectsBcsBase64: toBase64(effectsBcs), objects },
    effectsBcs, effectsSha256: [...sha256(effectsBcs)].map(b => b.toString(16).padStart(2, '0')).join(''), full };
}
