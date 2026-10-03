import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { encryptMakerV8NativeContentV8, createMakerV8NativeContentSidecarV8 } from '../maker-v8-native-content-crypto.js';
import { CONTENT_ENVELOPE_SCHEMA, encodeContentEnvelope } from '../maker-v8-native-envelope-codec.js';
import { assertMakerV8NativeContentEvidenceV8, readMakerV8NativeContentEvidenceV8,
  NativeContentStateBCS, NativeContentBCS, NativeContentKeyBCS, NativeContentSlotBCS, nativeContentFieldBCS } from '../maker-v8-native-content-evidence.js';
import { encryptedObjectFixture, nativeInitialEvidenceFixture, nativeMintDigest, fixtureId as id } from './fixtures/native-initial-content.js';

async function fixture() {
  const input = { expectedContentObjectId: id(5), initialStateConfig: [{ key: 'custom', valueUtf8: '字' }], initialContent: [] };
  for (const [kind, name] of [[0, 'soul'], [1, 'default']]) {
    const { material } = await encryptMakerV8NativeContentV8({ plaintext: new TextEncoder().encode(name), mimeType: 'text/markdown', fileName: `${name}.md` });
    const slot = { contentObjectId: id(5), kind, name, versionIndex: '0', blobObjectId: id(30 + kind) };
    const sidecar = await createMakerV8NativeContentSidecarV8({ sealClient: { encrypt: encryptedObjectFixture }, threshold: 1,
      sealPackageId: id(3), ...slot, material });
    input.initialContent.push({ kind, name, blobObjectId: slot.blobObjectId, expectedVersionIndex: '0',
      slotReadModeMask: 3, downloadPolicy: 'public', setActive: false,
      encryptedEnvelope: encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...slot, sidecar }, id(3)) });
  }
  const args = { input, originalPackageId: id(3), soulId: id(40), stateId: id(41), signer: id(1), transactionDigest: nativeMintDigest };
  return { ...args, ...nativeInitialEvidenceFixture(args) };
}

// Recompute internally consistent Object/Effects hashes: failures must come from
// semantic association, rather than merely a corrupted checksum.
function mutateObject(f, index, codec, mutate) {
  const row = f.evidence.objects[index]; const object = bcs.Object.parse(fromBase64(row.objectBcsBase64));
  const fields = codec.parse(object.data.Move.contents); mutate(fields); object.data.Move.contents = codec.serialize(fields).toBytes();
  const raw = bcs.Object.serialize(object).toBytes(); row.objectBcsBase64 = toBase64(raw);
  const effects = bcs.TransactionEffects.parse(fromBase64(f.evidence.effectsBcsBase64));
  const digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...raw]), { dkLen: 32 }));
  effects.V2.changedObjects.find(([key]) => key === row.objectId)[1].outputState.ObjectWrite[0] = digest;
  const bytes = bcs.TransactionEffects.serialize(effects).toBytes(); f.evidence.effectsBcsBase64 = toBase64(bytes);
  f.effectsSha256 = [...sha256(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

test('initial content proof reads only effects-version objects and validates again from serialized cold evidence', async () => {
  const f = await fixture(); const calls = [];
  const evidence = await readMakerV8NativeContentEvidenceV8({ ...f, client: { async getHistoricalObject(request) {
    calls.push(request); return f.full.get(request.objectId);
  } } });
  assert.equal(calls.length, f.evidence.objects.length); assert.ok(calls.every(row => row.version === 11n));
  assert.deepEqual(evidence, f.evidence);
  assert.equal(assertMakerV8NativeContentEvidenceV8({ ...f, evidence: JSON.parse(JSON.stringify(evidence)) }), true);
});

test('cold initial proof rejects missing history, substituted effects and changed semantic BCS', async t => {
  const slotCodec = nativeContentFieldBCS(NativeContentKeyBCS, bcs.vector(NativeContentSlotBCS));
  for (const [name, mutate] of Object.entries({
    missing: f => f.evidence.objects.pop(), duplicate: f => f.evidence.objects.push(f.evidence.objects[0]),
    noEffects: f => { f.evidence.effectsBcsBase64 = ''; },
    wrongEffectsHash: f => { f.effectsSha256 = '00'.repeat(32); },
    wrongTransaction: f => { f.transactionDigest = toBase58(new Uint8Array(32).fill(3)); },
    rawBytes: f => { f.evidence.objects[0].objectBcsBase64 = toBase64(new Uint8Array(80)); },
    stateContent: f => mutateObject(f, 0, NativeContentStateBCS, row => { row.content_id = id(99); }),
    contentSoul: f => mutateObject(f, 1, NativeContentBCS, row => { row.soul_id = id(99); }),
    hiddenSlot: f => mutateObject(f, 1, NativeContentBCS, row => { row.items.size = '3'; }),
    configCount: f => mutateObject(f, 0, NativeContentStateBCS, row => { row.config_ext.size = '0'; }),
    slotBlob: f => mutateObject(f, 2, slotCodec, row => { row.value[0].blob_object_id = id(99); }),
    slotRead: f => mutateObject(f, 2, slotCodec, row => { row.value[0].read_mode_mask = '1'; }),
    soulDocMutable: f => mutateObject(f, 2, slotCodec, row => { row.value[0].op_mask = '7'; }),
    soulDocWrongGrant: f => mutateObject(f, 2, slotCodec, row => { row.value[0].grant_scope_mask = '4'; }),
    slotDeleted: f => mutateObject(f, 2, slotCodec, row => { row.value[0].deleted = true; }),
    envelope: f => { f.input.initialContent[0].encryptedEnvelope = f.input.initialContent[1].encryptedEnvelope; },
    configValue: f => { f.input.initialStateConfig[0].valueUtf8 = 'changed'; },
  })) await t.test(name, async () => { const f = await fixture(); mutate(f); assert.throws(() => assertMakerV8NativeContentEvidenceV8(f)); });
});

test('historical collection snapshots input before awaiting and leaves missing history retryable', async () => {
  const f = await fixture(); const before = structuredClone(f.input);
  const evidence = await readMakerV8NativeContentEvidenceV8({ ...f, client: { async getHistoricalObject(request) {
    f.input.expectedContentObjectId = id(999); f.input.initialStateConfig[0].valueUtf8 = 'changed during read';
    return f.full.get(request.objectId);
  } } });
  assert.equal(assertMakerV8NativeContentEvidenceV8({ ...f, input: before, evidence }), true);
  const clean = await fixture();
  await assert.rejects(readMakerV8NativeContentEvidenceV8({ ...clean, client: { async getHistoricalObject() { throw new Error('archival unavailable'); } } }),
    error => error.code === 'MAKER_V8_BROWSER_READBACK_UNAVAILABLE' && error.retryable && error.details.archivalRpcRequired);
});
