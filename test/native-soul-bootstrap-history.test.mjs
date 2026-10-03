import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeNativeSoulBootstrapHistoryObject as decode, validateNativeSoulBootstrapHistory as validate } from '../scripts/native-soul-bootstrap-history.mjs';
import { bootstrapHistoryFixture as fixture, objectDigest, rewriteHistoricalObject } from './fixtures/native-soul-bootstrap-history-fixture.mjs';
import { bootstrapStages, bootstrapId as id } from './fixtures/native-soul-bootstrap-fixture.mjs';
import { MakerV8WalrusSystemBcs } from '../maker-v8-walrus-execution.js';

const historyError = { code: 'NATIVE_SOUL_BOOTSTRAP_HISTORY_INVALID' };
const digest = toBase58(new Uint8Array(32).fill(99));
function encodeEffects(f) { f.refreshEffects(); return f.args(); }
function rowFor(f, kind) { return f.effects.V2.changedObjects.find(([objectId]) => objectId === (f.objects[kind] ?? f.priorObjects[kind]).reference.objectId)[1]; }
function updateOutputDigest(f, kind) { rowFor(f, kind).outputState.ObjectWrite[0] = f.objects[kind].reference.digest; f.refreshEffects(); }
for (const stage of bootstrapStages) {
  test(`${stage}: cold full-Object journal round-trip binds real digests, bytes and effects without current RPC`, t => {
    const f = fixture(stage), args = f.args();
    const cold = JSON.parse(JSON.stringify({ ...args, transactionBytes: toBase64(args.transactionBytes), effectsBytes: toBase64(args.effectsBytes) }));
    cold.transactionBytes = fromBase64(cold.transactionBytes); cold.effectsBytes = fromBase64(cold.effectsBytes);
    const before = structuredClone(cold);
    const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('history must remain offline'); });
    const result = validate(cold);
    assert.equal(result.effects.transactionDigest, TransactionDataBuilder.getDigestFromBytes(args.transactionBytes));
    assert.deepEqual(cold, before); assert.equal(network.mock.callCount(), 0);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.objects.protocol.reference));
    for (const [kind, evidence] of Object.entries(f.objects)) {
      assert.equal(objectDigest(fromBase64(evidence.objectBcsBase64)), evidence.reference.digest);
      assert.deepEqual(result.objects[kind], decode(evidence, { kind, packageIds: f.input.packageIds }));
    }
    assert.deepEqual(f.input.protocolAdminCap, f.priorObjects.protocolAdmin.reference);
    if (stage === 'FINALIZE_BOOTSTRAP') {
      assert.deepEqual(f.input.bootstrapAdmin, f.priorObjects.bootstrapAdmin.reference);
      assert.equal(result.writes.deletedByKind.bootstrapAdmin.objectId, f.input.bootstrapAdmin.objectId);
    }
  });
}

test('Object digest uses typed Blake2b, not SHA-256 of the same full Object bytes', () => {
  const f = fixture('INITIALIZE_PROTOCOL'), e = f.objects.protocol;
  const good = decode(e, { kind: 'protocol', packageIds: f.input.packageIds });
  assert.equal(good.reference.digest, e.reference.digest);
  assert.throws(() => decode({ ...e, reference: { ...e.reference,
    digest: toBase58(sha256(fromBase64(e.objectBcsBase64))) } }), /digest/);
});
for (const [name, mutate] of Object.entries({
  'envelope digest': e => { e.reference.digest = digest; },
  'envelope UID': e => { e.reference.objectId = id(999); },
  'envelope version': e => { e.reference.version = '13'; },
  'envelope type': e => { e.type = e.type.replace('ProtocolConfigV8', 'OtherConfig'); },
  'envelope owner': e => { e.owner = { kind: 'immutable' }; },
  'envelope previous transaction': e => { e.previousTransaction = digest; },
  'full BCS trailing bytes': e => { e.objectBcsBase64 = toBase64(new Uint8Array([...fromBase64(e.objectBcsBase64), 0])); },
  'full BCS truncated': e => { e.objectBcsBase64 = toBase64(fromBase64(e.objectBcsBase64).slice(0, -1)); },
  'noncanonical base64': e => { e.objectBcsBase64 += '\n'; },
  'unknown envelope field': e => { e.currentVersion = '13'; },
  'zero reference version': e => { e.reference.version = '0'; },
})) test(`historical object rejects ${name}`, () => {
  const f = fixture('INITIALIZE_PROTOCOL'), e = structuredClone(f.objects.protocol); mutate(e);
  assert.throws(() => decode(e, { kind: 'protocol', packageIds: f.input.packageIds }));
});
test('self-consistent Object hash cannot hide a content UID mismatch', () => {
  const f = fixture('INITIALIZE_PROTOCOL'), e = f.objects.protocol;
  rewriteHistoricalObject(e, p => { p.data.Move.contents[31] ^= 1; });
  assert.equal(objectDigest(fromBase64(e.objectBcsBase64)), e.reference.digest);
  assert.throws(() => decode(e), /object ID/);
});
test('well-formed wrong Move type is rejected by the expected bootstrap role decoder', () => {
  const f = fixture('INITIALIZE_PROTOCOL'), e = f.objects.protocol;
  rewriteHistoricalObject(e, p => { p.data.Move.type.Other.name = 'OtherConfig'; });
  e.type = e.type.replace('ProtocolConfigV8', 'OtherConfig');
  assert.throws(() => decode(e, { kind: 'protocol', packageIds: f.input.packageIds }), { code: 'NATIVE_SOUL_BOOTSTRAP_OBJECT_INVALID' });
});
for (const stage of bootstrapStages) test(`${stage}: exact predecessor inventory cannot be missing or expanded`, () => {
  const f = fixture(stage), missing = structuredClone(f.priorObjects); delete missing.protocolAdmin;
  assert.throws(() => validate({ ...f.args(), priorObjects: missing }), historyError);
  assert.throws(() => validate({ ...f.args(), priorObjects: { ...f.priorObjects, unrelated: f.priorObjects.protocol } }), historyError);
});
test('changed effects before digest cannot substitute the actual shared predecessor', () => {
  const f = fixture('INITIALIZE_PROTOCOL'); rowFor(f, 'protocol').inputState.Exist[0][1] = digest;
  assert.throws(() => validate(encodeEffects(f)), /effects before differs/);
});
test('self-consistent but different predecessor Object is rejected even when its contents are equal', () => {
  const f = fixture('INITIALIZE_PROTOCOL'); rewriteHistoricalObject(f.priorObjects.protocol, p => { p.storageRebate = '1'; });
  assert.throws(() => validate(f.args()), /effects before differs/);
});
test('self-consistent post Object hash must equal the output effects digest', () => {
  const f = fixture('SETUP_RELEASE'); rewriteHistoricalObject(f.objects.catalog, p => { p.storageRebate = '1'; });
  assert.throws(() => validate(f.args()), /historical write differs/);
});
test('even a matching effects digest cannot accept a post Object from a different transaction', () => {
  const f = fixture('SETUP_RELEASE'); rewriteHistoricalObject(f.objects.catalog, p => { p.previousTransaction = digest; });
  f.objects.catalog.previousTransaction = digest; updateOutputDigest(f, 'catalog');
  assert.throws(() => validate(f.args()), /historical write differs/);
});
test('consumed bootstrap admin deletion must match its exact full predecessor', () => {
  const f = fixture('FINALIZE_BOOTSTRAP'); rewriteHistoricalObject(f.priorObjects.bootstrapAdmin, p => { p.storageRebate = '1'; });
  assert.throws(() => validate(f.args()), /effects before differs/);
});
test('missing consumed admin deletion cannot pass a successful finalization digest', () => {
  const f = fixture('FINALIZE_BOOTSTRAP');
  f.effects.V2.changedObjects = f.effects.V2.changedObjects.filter(([objectId]) => objectId !== f.input.bootstrapAdmin.objectId);
  f.effects.V2.gasObjectIndex--;
  assert.throws(() => validate(encodeEffects(f)), /deletion cardinality/);
});
test('read-only replacement cannot change between predecessor and output evidence', () => {
  const f = fixture('BEGIN_BOOTSTRAP'); rewriteHistoricalObject(f.objects.replacement, p => { p.storageRebate = '1'; });
  assert.throws(() => validate(f.args()), /read-only object changed/);
});
test('immutable PTB reference cannot be replaced by another valid same-content version', () => {
  const f = fixture('BEGIN_BOOTSTRAP');
  for (const collection of [f.priorObjects, f.objects]) {
    rewriteHistoricalObject(collection.replacement, p => { p.data.Move.version = '8'; });
    collection.replacement.reference.version = '8';
  }
  assert.throws(() => validate(f.args()), /exact immutable input/);
});
test('final protocol admin readback still matches the saved prior reference although not a PTB input', () => {
  const f = fixture('FINALIZE_BOOTSTRAP'); f.input.protocolAdminCap.digest = digest;
  assert.throws(() => validate(f.args()), /exact protocol admin input/);
});
test('readonly current/latest protocol cannot silently replace the historical predecessor', () => {
  const f = fixture('FINALIZE_BOOTSTRAP'); rewriteHistoricalObject(f.objects.protocol, p => { p.storageRebate = '1'; });
  assert.throws(() => validate(f.args()), /read-only object changed/);
});
test('consensus inventory is exact, including stages without consensus roots', () => {
  const f = fixture('SETUP_RELEASE'); assert.throws(() => validate({ ...f.args(), consensusObjects: {} }), /exact consensus history inventory/);
  const init = fixture('INITIALIZE_PROTOCOL');
  assert.throws(() => validate({ ...init.args(), consensusObjects: f.consensusObjects }), /exact consensus history inventory/);
});
test('Walrus consensus root full Object must match the exact effects version and digest', () => {
  const f = fixture('SETUP_RELEASE'), e = f.consensusObjects[f.input.walrusSystem.objectId];
  rewriteHistoricalObject(e, p => { p.storageRebate = '1'; });
  assert.throws(() => validate(f.args()), /consensus history differs/);
});
test('even self-consistent consensus owner and effects cannot substitute initial shared version', () => {
  const f = fixture('SETUP_RELEASE'), e = f.consensusObjects[f.input.walrusSystem.objectId];
  rewriteHistoricalObject(e, p => { p.owner.Shared.initialSharedVersion = '6'; });
  e.owner.initialSharedVersion = '6'; f.effects.V2.unchangedConsensusObjects[0][1].ReadOnlyRoot[1] = e.reference.digest;
  assert.throws(() => validate(encodeEffects(f)), /consensus history owner/);
});
test('same protocol identity with a different valid consensus Object is not the certified predecessor', () => {
  const f = fixture('BEGIN_BOOTSTRAP'), e = f.consensusObjects[f.input.protocolConfig.objectId];
  rewriteHistoricalObject(e, p => { p.storageRebate = '1'; });
  f.effects.V2.unchangedConsensusObjects[0][1].ReadOnlyRoot[1] = e.reference.digest;
  assert.throws(() => validate(encodeEffects(f)), /consensus predecessor drift/);
});
for (const [name, mutate, expected] of [
  ['reference regression', p => { p.data.Move.version = '8'; }, /regressed or forked/],
  ['same-version digest fork', p => { p.storageRebate = '1'; }, /regressed or forked/],
  ['execution package switch', p => {
    p.data.Move.version = '10';
    const fields = MakerV8WalrusSystemBcs.parse(p.data.Move.contents);
    fields.package_id = id(999);
    p.data.Move.contents = MakerV8WalrusSystemBcs.serialize(fields).toBytes();
  }, /Walrus/],
]) test(`consensus ${name} is rejected even after full Object and effects rehash`, () => {
  const f = fixture('SETUP_RELEASE'), e = f.consensusObjects[f.input.walrusSystem.objectId];
  rewriteHistoricalObject(e, mutate);
  e.reference.version = bcs.Object.parse(fromBase64(e.objectBcsBase64)).data.Move.version;
  f.effects.V2.unchangedConsensusObjects[0][1].ReadOnlyRoot = [e.reference.version, e.reference.digest];
  assert.throws(() => validate(encodeEffects(f)), expected);
});
