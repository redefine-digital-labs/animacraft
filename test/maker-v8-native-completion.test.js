import test from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '@mysten/sui/transactions';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { GrpcTypes } from '@mysten/sui/grpc';
import { deriveDynamicFieldID, toBase58 } from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { deriveMakerV8NativeContentIdV8 } from '../maker-v8-native-content-identity.js';
import { nativeInitialInputFixture } from './fixtures/native-initial-content.js';
import { normalizeMakerV8HistoricalObject } from '../maker-v8-sui-grpc.js';
import { appendMakerV8NativeCompletionV8, assertMakerV8NativeCompletionInputV8,
  MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, MAKER_V8_NATIVE_KIOSK_ITEM_KEY_TYPE,
  deriveMakerV8NativeKioskItemIdV8, readMakerV8NativeKioskItemV8 } from '../maker-v8-native-completion.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
function input() {
  return nativeInitialInputFixture({ name: 'Soul', description: 'Exact Complete', currentKioskId: id(20), currentKioskCapOnChainId: id(21),
    mintNonce: '12'.repeat(16), expectedContentObjectId: deriveMakerV8NativeContentIdV8({ soulidityOriginalPackageId: id(2), kioskRegistryId: id(52) }, id(19), '12'.repeat(16)),
    initialStateConfig: [{ key: 'custom', valueUtf8: '字' }],
    initialContent: [
      { kind: 0, name: 'soul', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(30), expectedVersionIndex: '0', encryptedEnvelope: 'ciphertext' },
      { kind: 1, name: 'default', slotReadModeMask: 3, downloadPolicy: 'public', setActive: false, blobObjectId: id(31), expectedVersionIndex: '0', encryptedEnvelope: 'ciphertext' },
    ] }, id(2));
}

test('native Complete ABI consumes authorization into one native state and exact typed content', () => {
  const tx = new Transaction(); tx.setSender(id(19)); const targets = [];
  const auth = tx.moveCall({ target: `${id(3)}::release_v8::finish_unprotected_complete_v8`, arguments: [] });
  const objects = Object.fromEntries(['marketConfig', 'kindRegistry', 'kioskRegistry', 'soulTransferPolicy', 'root', 'protocolConfig', 'outputRegistry', 'soulRegistry', 'clock', 'kiosk', 'personalKioskCap'].map((name, i) => [name, id(50 + i)]));
  objects.contentBlobs = [id(30), id(31)];
  appendMakerV8NativeCompletionV8({ transaction: tx, targets,
    config: { soulidityCallablePackageId: id(1), soulidityOriginalPackageId: id(2), kioskPackageId: id(4), kioskRegistryId: id(52) },
    input: input(), objects, authorization: auth, paymentCoinType: '0x2::sui::SUI', objectArgument: value => tx.object(value) });
  const commands = tx.getData().commands;
  const mint = commands.find(c => c.MoveCall?.function === 'mint_animacraft_v8_in_personal_kiosk').MoveCall;
  assert.equal(mint.arguments.length, 18);
  assert.deepEqual(mint.arguments[10], { Result: 0, $kind: 'Result' });
  assert.deepEqual(mint.typeArguments, ['0x2::sui::SUI']);
  assert.equal(commands.at(-1).MoveCall.function, 'finalize_soul_state');
  assert.deepEqual(commands.filter(c => c.MakeMoveVec).map(c => c.MakeMoveVec.type), [
    `${id(2)}::market::InitialContentEntry`, `${id(2)}::market::StateConfigEntry`,
  ]);
  assert.equal(targets.some(t => t.includes('mint_canonical_soul')), false);
  assert.equal(commands.filter(c => c.MoveCall?.function === 'new_initial_content_entry').length, 2);
});

test('native input refuses missing real Blob content, duplicate consumes, partial Kiosk and mutated native invariants', () => {
  assert.equal(assertMakerV8NativeCompletionInputV8(input()).name, 'Soul');
  assert.equal(assertMakerV8NativeCompletionInputV8({ ...input(), description: '' }).description, '');
  for (const mutate of [
    value => { value.initialContent = []; },
    value => { value.initialContent[1].blobObjectId = value.initialContent[0].blobObjectId; },
    value => { value.currentKioskCapOnChainId = null; },
    value => { value.initialContent[0].slotReadModeMask = 15; },
    value => { value.initialContent[0].downloadPolicy = 'owner_only'; },
    value => { value.initialContent[1].kind = 16; },
    value => { value.name = '界'.repeat(86); },
    value => { value.fakeCertificate = true; },
  ]) {
    const value = input(); mutate(value);
    assert.throws(() => assertMakerV8NativeCompletionInputV8(value), { code: 'MAKER_V8_NATIVE_COMPLETION_INVALID' });
  }
});

test('actual native mint PTB carries public preview bytes and rejects private fields at its input boundary', async () => {
  const value = input();
  const text = JSON.stringify({ schema: 'soulidity.soul-public-preview.v1', tags: ['oc'], previewImages: [] });
  value.initialStateConfig.push({ key: 'soul_public_preview_v1', valueUtf8: text });
  const tx = new Transaction(), targets = []; tx.setSender(id(19));
  const names = ['marketConfig', 'kindRegistry', 'kioskRegistry', 'soulTransferPolicy', 'root', 'protocolConfig', 'outputRegistry', 'soulRegistry', 'clock', 'kiosk', 'personalKioskCap'];
  const objects = Object.fromEntries(names.map((name, i) => [name, id(50 + i)])); objects.contentBlobs = [id(30), id(31)];
  appendMakerV8NativeCompletionV8({ transaction: tx, targets, config: { soulidityCallablePackageId: id(1), soulidityOriginalPackageId: id(2), kioskPackageId: id(4), kioskRegistryId: id(52) },
    input: value, objects, authorization: tx.object(id(99)), paymentCoinType: '0x2::sui::SUI', objectArgument: object => tx.object(object) });
  const data = tx.getData();
  const calls = data.commands.filter(command => command.MoveCall?.function === 'new_state_config_entry');
  assert.equal(calls.length, 2);
  const args = calls[1].MoveCall.arguments;
  const { bcs } = await import('@mysten/sui/bcs');
  assert.equal(data.inputs[args[0].Input].Pure.bytes, bcs.string().serialize('soul_public_preview_v1').toBase64());
  assert.equal(data.inputs[args[1].Input].Pure.bytes, bcs.vector(bcs.u8()).serialize([...new TextEncoder().encode(text)]).toBase64());
  value.initialStateConfig[1].valueUtf8 = JSON.stringify({ ...JSON.parse(text), dek: 'secret' });
  assert.throws(() => assertMakerV8NativeCompletionInputV8(value), { code: 'MAKER_V8_PUBLIC_PREVIEW_INVALID' });
});

function kioskHistoryFixture() {
  const kioskId = id(20), soulId = id(22);
  const fieldId = deriveMakerV8NativeKioskItemIdV8(kioskId, soulId);
  const transactionDigest = toBase58(new Uint8Array(32).fill(7));
  // Match Move's real nested Field<Wrapper<Item>, ID>, not the verifier's flattened projection.
  const layout = bcs.struct('Field', { id: bcs.struct('UID', { id: bcs.Address }),
    name: bcs.struct('Wrapper', { name: bcs.struct('Item', { id: bcs.Address }) }), value: bcs.Address });
  const contents = layout.serialize({ id: { id: fieldId }, name: { name: { id: soulId } }, value: soulId }).toBytes();
  const objectBytes = bcs.Object.serialize({ data: { Move: {
    type: { Other: TypeTagSerializer.parseFromStr(MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, true).struct },
    hasPublicTransfer: false, version: '11', contents,
  } }, owner: { ObjectOwner: kioskId }, previousTransaction: transactionDigest, storageRebate: '77' }).toBytes();
  const domain = new TextEncoder().encode('Object::');
  const typed = new Uint8Array(domain.length + objectBytes.length); typed.set(domain); typed.set(objectBytes, domain.length);
  const digest = toBase58(blake2b(typed, { dkLen: 32 }));
  const historical = normalizeMakerV8HistoricalObject(GrpcTypes.Object.create({ objectId: fieldId, version: 11n, digest,
    owner: { kind: 2, address: kioskId }, objectType: MAKER_V8_NATIVE_KIOSK_ITEM_TYPE,
    hasPublicTransfer: false, previousTransaction: transactionDigest, storageRebate: 77n,
    contents: { name: MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, value: contents }, bcs: { name: 'Object', value: objectBytes },
  }), { objectId: fieldId, version: 11n });
  const response = { objectChanges: [{ type: 'created', objectId: fieldId, objectType: MAKER_V8_NATIVE_KIOSK_ITEM_TYPE, version: '11', digest }],
    compilerEffectsOutputRefs: [{ objectId: fieldId, version: '11', digest, owner: { kind: 'ObjectOwner', value: kioskId } }] };
  return { kioskId, soulId, fieldId, transactionDigest, historical, response };
}

test('native Complete proves the historical Kiosk wrapper through exact 96-byte canonical Object BCS', async () => {
  const fixture = kioskHistoryFixture();
  const { kioskId, soulId, fieldId, historical } = fixture;
  assert.equal(historical.contentBcs.length, 96);
  assert.equal(fieldId, deriveDynamicFieldID(kioskId, MAKER_V8_NATIVE_KIOSK_ITEM_KEY_TYPE, bcs.Address.serialize(soulId).toBytes()));
  assert.notEqual(fieldId, deriveDynamicFieldID(kioskId, '0x2::kiosk::Item', bcs.Address.serialize(soulId).toBytes()));
  for (const current of ['still in original Kiosk', 'transferred to another Kiosk', 'wrapper deleted after sale']) {
    const requests = [];
    const client = { getObject() { assert.fail(`latest ${current} must not influence mint proof`); },
      getDynamicField() { assert.fail('latest dynamic field must never be queried'); },
      async getHistoricalObject(request) { requests.push(request); return historical; } };
    const row = await readMakerV8NativeKioskItemV8({ ...fixture, client });
    assert.deepEqual(requests, [{ objectId: fieldId, version: 11n }]);
    assert.deepEqual(row.fields, { id: fieldId, keyId: soulId, valueId: soulId });
    assert.deepEqual(row.owner, { kind: 'ObjectOwner', value: kioskId });
  }
});

test('native Complete rejects missing, substituted and noncanonical historical Kiosk wrapper evidence', async t => {
  for (const [name, mutate] of [
    ['missing effect', f => { f.response.compilerEffectsOutputRefs = []; }],
    ['duplicate effect', f => { f.response.compilerEffectsOutputRefs.push(f.response.compilerEffectsOutputRefs[0]); }],
    ['missing change', f => { f.response.objectChanges = []; }],
    ['duplicate change', f => { f.response.objectChanges.push(f.response.objectChanges[0]); }],
    ['mutated not created', f => { f.response.objectChanges[0].type = 'mutated'; }],
    ['non-wrapper type', f => { f.response.objectChanges[0].objectType = '0x2::dynamic_field::Field<0x2::kiosk::Item,0x2::object::ID>'; }],
    ['effect version', f => { f.response.compilerEffectsOutputRefs[0].version = '12'; }],
    ['effect digest', f => { f.response.compilerEffectsOutputRefs[0].digest = toBase58(new Uint8Array(32).fill(1)); }],
    ['effect owner', f => { f.response.compilerEffectsOutputRefs[0].owner.value = id(99); }],
    ['history ID', f => { f.historical.objectId = id(99); }],
    ['history type', f => { f.historical.type = '0x2::kiosk::Kiosk'; }],
    ['history version', f => { f.historical.version = '12'; }],
    ['history digest', f => { f.historical.digest = toBase58(new Uint8Array(32).fill(1)); }],
    ['history transaction', f => { f.historical.previousTransaction = toBase58(new Uint8Array(32).fill(1)); }],
    ['history parent', f => { f.historical.owner = { ObjectOwner: id(99) }; }],
    ['address owned', f => { f.historical.owner = { AddressOwner: f.kioskId }; }],
    ['UID BCS', f => { f.historical.contentBcs[31] ^= 1; }],
    ['key BCS', f => { f.historical.contentBcs[63] ^= 1; }],
    ['value BCS', f => { f.historical.contentBcs[95] ^= 1; }],
    ['trailing byte', f => { f.historical.contentBcs = new Uint8Array([...f.historical.contentBcs, 0]); }],
    ['truncated BCS', f => { f.historical.contentBcs = f.historical.contentBcs.slice(0, 95); }],
    ['missing Object BCS', f => { delete f.historical.objectBcs; }],
  ]) await t.test(name, async () => {
    const fixture = structuredClone(kioskHistoryFixture()); mutate(fixture);
    await assert.rejects(readMakerV8NativeKioskItemV8({ ...fixture,
      client: { async getHistoricalObject() { return fixture.historical; } } }), { code: 'MAKER_V8_NATIVE_COMPLETION_INVALID' });
  });
});

test('native Complete unavailable wrapper history remains retryable and never falls back to latest custody', async () => {
  const fixture = kioskHistoryFixture();
  for (const reader of [undefined, async () => { throw new Error('archival version unavailable'); }]) {
    await assert.rejects(readMakerV8NativeKioskItemV8({ ...fixture, client: {
      getHistoricalObject: reader, getObject() { assert.fail('latest-object fallback is forbidden'); },
    } }), error => error.code === 'MAKER_V8_BROWSER_READBACK_UNAVAILABLE'
      && error.layer === 'READBACK' && error.retryable && error.details.archivalRpcRequired
      && error.details.objectId === fixture.fieldId && error.details.version === '11');
  }
});
