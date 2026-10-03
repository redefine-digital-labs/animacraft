import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { deriveDynamicFieldID, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils';
import { certifyNativeSoulBootstrapHistory as load, nativeSoulBootstrapPriorKinds } from '../scripts/native-soul-bootstrap-loader.mjs';
import { validateNativeSoulBootstrapHistory } from '../scripts/native-soul-bootstrap-history.mjs';
import { bootstrapHistoryFixture, rewriteHistoricalObject } from './fixtures/native-soul-bootstrap-history-fixture.mjs';
import { bootstrapStages as STAGES, bootstrapId as id } from './fixtures/native-soul-bootstrap-fixture.mjs';

for (const stage of STAGES) test(`${stage}: public prior projection is exact, immutable and detached`, () => {
  const kinds = nativeSoulBootstrapPriorKinds(stage);
  assert.deepEqual([...kinds].sort(), Object.keys(bootstrapHistoryFixture(stage).priorObjects).sort());
  assert.ok(Object.isFrozen(kinds));
  assert.throws(() => kinds.push('other'), TypeError);
  assert.notEqual(kinds, nativeSoulBootstrapPriorKinds(stage));
});
test('public prior projection rejects unknown and inherited stage keys', () => {
  for (const stage of ['OLD_BOOTSTRAP', 'toString', '__proto__', null, undefined, 1, {}]) {
    assert.throws(() => nativeSoulBootstrapPriorKinds(stage), { code: 'NATIVE_SOUL_BOOTSTRAP_LOADER_INVALID' });
  }
});

function fixture(stage) {
  const f = bootstrapHistoryFixture(stage), calls = [];
  const evidence = [...Object.values(f.objects), ...Object.values(f.consensusObjects)];
  const readHistoricalObject = async reference => {
    calls.push(structuredClone(reference)); assert.ok(Object.isFrozen(reference));
    const matches = evidence.filter(row => JSON.stringify(row.reference) === JSON.stringify(reference));
    assert.ok(matches.length > 0, 'No latest/fallback read is permitted');
    return structuredClone(matches[0]);
  };
  const input = () => ({ stage, input: f.input, sender: f.sender, transactionBytes: f.transactionBytes,
    effectsBytes: f.effectsBytes, priorObjects: f.priorObjects, readHistoricalObject });
  return { f, calls, evidence, input, readHistoricalObject };
}
function useAddressGas(f, net) {
  const tx = bcs.TransactionData.parse(f.transactionBytes); tx.V1.gasData.payment = [];
  f.transactionBytes = bcs.TransactionData.serialize(tx).toBytes();
  const digest = TransactionDataBuilder.getDigestFromBytes(f.transactionBytes);
  f.effects.V2.changedObjects.splice(f.effects.V2.gasObjectIndex, 1);
  f.effects.V2.gasObjectIndex = null; f.effects.V2.transactionDigest = digest;
  for (const [objectId, change] of f.effects.V2.changedObjects) {
    if (!change.outputState.ObjectWrite) continue;
    const evidence = Object.values(f.objects).find(row => row.reference.objectId === objectId);
    rewriteHistoricalObject(evidence, object => { object.previousTransaction = digest; });
    evidence.previousTransaction = digest; change.outputState.ObjectWrite[0] = evidence.reference.digest;
  }
  f.effects.V2.gasUsed = { computationCost: net > 0n ? String(net) : '0', storageCost: '0',
    storageRebate: net < 0n ? String(-net) : '0', nonRefundableStorageFee: '11' };
  if (net !== 0n) f.effects.V2.changedObjects.push([
    deriveDynamicFieldID('0xacc', '0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>', bcs.Address.serialize(f.sender).toBytes()), {
      inputState: { NotExist: true }, idOperation: { None: true }, outputState: { AccumulatorWriteV1: {
        address: { address: f.sender, ty: '0x2::balance::Balance<0x2::sui::SUI>' },
        operation: net > 0n ? { Split: true } : { Merge: true }, value: { Integer: String(net < 0n ? -net : net) },
      } },
    },
  ]);
  f.refreshEffects();
}
for (const stage of STAGES) for (const net of [3n, -7n, 0n]) {
  test(`${stage}: address gas ${net} survives real loader and cold full-Object/write-set validation`, async () => {
    const f = fixture(stage); useAddressGas(f.f, net);
    const result = await load(f.input());
    const journal = JSON.parse(JSON.stringify({ objects: result.objects, priorObjects: result.priorObjects, consensusObjects: result.consensusObjects }));
    assert.deepEqual(validateNativeSoulBootstrapHistory({ ...f.input(), ...journal }), result.history);
    assert.equal(result.history.effects.gasPaymentKind, 'address-balance');
    assert.equal(result.history.effects.accumulators.length, net === 0n ? 0 : 1);
    assert.equal(f.calls.length, { INITIALIZE_PROTOCOL: 3, SETUP_RELEASE: 16, BEGIN_BOOTSTRAP: 5, FINALIZE_BOOTSTRAP: 6 }[stage]);
  });
}
test('address gas tampering rejects before RPC and in cold history, not just at the loader boundary', async () => {
  const f = fixture('FINALIZE_BOOTSTRAP'); useAddressGas(f.f, 3n);
  f.f.effects.V2.changedObjects.at(-1)[1].outputState.AccumulatorWriteV1.value.Integer = '4'; f.f.refreshEffects();
  await assert.rejects(() => load(f.input()), /exact sender SUI gas accumulator/);
  assert.equal(f.calls.length, 0);
  assert.throws(() => validateNativeSoulBootstrapHistory({ ...f.input(), objects: f.f.objects,
    consensusObjects: f.f.consensusObjects }), /exact sender SUI gas accumulator/);
});
for (const stage of STAGES) test(`${stage}: actual historical callback yields cold-replayable journal evidence`, async () => {
  const f = fixture(stage), result = await load(f.input());
  assert.equal(result.schema, 'native-soul-bootstrap-history-v1');
  assert.deepEqual(result.objects, f.f.objects); assert.deepEqual(result.priorObjects, f.f.priorObjects);
  assert.deepEqual(result.consensusObjects, f.f.consensusObjects);
  const replay = JSON.parse(JSON.stringify({ objects: result.objects, priorObjects: result.priorObjects, consensusObjects: result.consensusObjects }));
  assert.deepEqual(validateNativeSoulBootstrapHistory({ ...f.f.args(), ...replay }), result.history);
  assert.equal(f.calls.length, { INITIALIZE_PROTOCOL: 3, SETUP_RELEASE: 16, BEGIN_BOOTSTRAP: 5, FINALIZE_BOOTSTRAP: 6 }[stage]);
  assert.equal(new Set(f.calls.map(row => row.objectId)).size, f.calls.length);
  assert.ok(!f.calls.some(row => row.objectId === id(901)), 'Gas is verified from effects, never misclassified as bootstrap business');
});
for (const stage of STAGES) for (const field of ['objectId', 'version', 'digest']) {
  test(`${stage}: historical ${field} substitution fails without fallback`, async () => {
    const f = fixture(stage); let failed = false;
    await assert.rejects(() => load({ ...f.input(), readHistoricalObject: async request => {
      const response = await f.readHistoricalObject(request);
      if (!failed) { failed = true; response.reference[field] = field === 'objectId' ? id(999) : field === 'version' ? '13' : toBase58(new Uint8Array(32).fill(97)); }
      return response;
    } }));
    assert.ok(f.calls.length <= 4, 'No new reads after the first batch rejects');
  });
}
for (const stage of STAGES) test(`${stage}: missing predecessor fails before reading`, async () => {
  const f = fixture(stage); delete f.f.priorObjects.protocolAdmin;
  await assert.rejects(() => load(f.input())); assert.equal(f.calls.length, 0);
});
test('unknown stage and absent callback/byte inputs fail before RPC', async () => {
  const f = fixture('SETUP_RELEASE');
  for (const change of [{ stage: 'OLD_BOOTSTRAP' }, { readHistoricalObject: null }, { effectsBytes: [] }]) {
    await assert.rejects(() => load({ ...f.input(), ...change }), { code: 'NATIVE_SOUL_BOOTSTRAP_LOADER_INVALID' });
  }
  assert.equal(f.calls.length, 0);
});
test('final admin deletion is checked against predecessor before any historical reads', async () => {
  const f = fixture('FINALIZE_BOOTSTRAP'); f.f.effects.V2.changedObjects.find(([, c]) => c.idOperation.Deleted)[0] = id(999); f.f.refreshEffects();
  await assert.rejects(() => load(f.input()), /exact bootstrap admin deletion/); assert.equal(f.calls.length, 0);
});
test('SETUP consensus uses exact effect-selected System version, not its initial version/latest', async () => {
  const f = fixture('SETUP_RELEASE'); await load(f.input());
  const request = f.calls.find(row => row.objectId === f.f.input.walrusSystem.objectId);
  assert.deepEqual(request, f.f.consensusObjects[request.objectId].reference);
  assert.notEqual(request.version, f.f.input.walrusSystem.initialSharedVersion);
});
test('consensus current-version substitution rejects even with internally valid Object BCS', async () => {
  const f = fixture('SETUP_RELEASE');
  await assert.rejects(() => load({ ...f.input(), readHistoricalObject: async request => {
    const result = await f.readHistoricalObject(request);
    if (request.objectId === f.f.input.walrusSystem.objectId) {
      rewriteHistoricalObject(result, object => { object.data.Move.version = '13'; }); result.reference.version = '13';
    }
    return result;
  } }), /requested ID\/version\/digest/);
});
test('unknown written type cannot become a guessed kind', async () => {
  const f = fixture('SETUP_RELEASE'), kind = 'runtimeConfig', row = f.f.objects[kind];
  rewriteHistoricalObject(row, object => { object.data.Move.type.Other.name = 'UnknownConfig'; });
  row.type = row.type.replace('RuntimePackageConfigV8', 'UnknownConfig');
  f.f.effects.V2.changedObjects.find(([objectId]) => objectId === row.reference.objectId)[1].outputState.ObjectWrite[0] = row.reference.digest; f.f.refreshEffects();
  await assert.rejects(() => load(f.input()), /unknown or ambiguous exact type/);
});
test('two valid written objects of one exact kind cannot replace the required inventory', async () => {
  const f = fixture('SETUP_RELEASE'), row = f.f.objects.runtimeConfig;
  const seal = bcs.Object.parse(fromBase64(f.f.objects.sealConfig.objectBcsBase64)).data.Move;
  const contents = [...seal.contents]; contents.splice(0, 32, ...Buffer.from(row.reference.objectId.slice(2), 'hex'));
  rewriteHistoricalObject(row, object => { object.data.Move.type = seal.type; object.data.Move.contents = contents; });
  row.type = f.f.objects.sealConfig.type;
  f.f.effects.V2.changedObjects.find(([objectId]) => objectId === row.reference.objectId)[1].outputState.ObjectWrite[0] = row.reference.digest; f.f.refreshEffects();
  await assert.rejects(() => load(f.input()), /duplicate written\/read-only kind/);
});
test('wrong transaction is rejected for writes even when Object/effects digests are recomputed', async () => {
  const f = fixture('INITIALIZE_PROTOCOL'), row = f.f.objects.protocolTreasury;
  const otherTx = toBase58(new Uint8Array(32).fill(97));
  rewriteHistoricalObject(row, object => { object.previousTransaction = otherTx; }); row.previousTransaction = otherTx;
  f.f.effects.V2.changedObjects.find(([objectId]) => objectId === row.reference.objectId)[1].outputState.ObjectWrite[0] = row.reference.digest; f.f.refreshEffects();
  await assert.rejects(() => load(f.input()), /not from this exact transaction/);
});
test('relationships are verified after reads, not replaced by type/count classification', async () => {
  const f = fixture('INITIALIZE_PROTOCOL'), row = f.f.objects.protocolTreasury;
  const raw = bcs.Object.parse(fromBase64(row.objectBcsBase64));
  // UID and type remain correct; change config_id (UID 32 + version u64).
  raw.data.Move.contents.set ? raw.data.Move.contents.set(new Uint8Array(32).fill(99), 40)
    : raw.data.Move.contents.splice(40, 32, ...new Uint8Array(32).fill(99));
  rewriteHistoricalObject(row, object => { object.data.Move.contents = raw.data.Move.contents; });
  f.f.effects.V2.changedObjects.find(([objectId]) => objectId === row.reference.objectId)[1].outputState.ObjectWrite[0] = row.reference.digest; f.f.refreshEffects();
  await assert.rejects(() => load(f.input()), /fresh treasury/);
});
test('caller data is snapshotted once before awaiting historical reads', async () => {
  const f = fixture('BEGIN_BOOTSTRAP'), expected = structuredClone(f.f.objects); let mutated = false;
  const result = await load({ ...f.input(), readHistoricalObject: async request => {
    const response = await f.readHistoricalObject(request);
    if (!mutated) { mutated = true; f.f.input.packageIds.core = id(999); f.f.priorObjects.protocol.reference.digest = 'invalid'; f.f.transactionBytes.fill(0); f.f.effectsBytes.fill(0); }
    return response;
  } });
  assert.deepEqual(result.objects, expected);
});
test('journal evidence remains detached and frozen after callback data is mutated', async () => {
  const f = fixture('INITIALIZE_PROTOCOL');
  const result = await load({ ...f.input(), readHistoricalObject: request => f.evidence.find(row => row.reference.objectId === request.objectId) });
  const expected = result.objects.protocol.reference.digest;
  f.f.objects.protocol.reference.digest = 'changed';
  assert.equal(result.objects.protocol.reference.digest, expected);
  assert.ok(Object.isFrozen(result.objects.protocol.reference));
  assert.throws(() => { result.objects.protocol.reference.digest = 'changed'; }, TypeError);
});
test('bounded parallel reads await every already-started request when one fails', async () => {
  const f = fixture('SETUP_RELEASE'); const pending = []; let settled = false;
  const result = load({ ...f.input(), readHistoricalObject: request => new Promise((resolve, reject) => { pending.push({ request, resolve, reject }); }) });
  const observed = result.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(pending.length, 4);
  const failure = new Error('historical RPC failed'); pending[0].reject(failure);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false); assert.equal(pending.length, 4);
  for (const p of pending.slice(1)) p.resolve(await f.readHistoricalObject(p.request));
  await assert.rejects(result, error => error === failure); await observed; assert.equal(settled, true); assert.equal(pending.length, 4);
});
test('unknown extra writes and unsupported consensus variants reject before reads', async () => {
  for (const mode of ['write', 'consensus']) {
    const f = fixture('SETUP_RELEASE');
    if (mode === 'write') { const row = structuredClone(f.f.effects.V2.changedObjects[0]); row[0] = id(999); f.f.effects.V2.changedObjects.push(row); }
    else f.f.effects.V2.unchangedConsensusObjects[0][1] = { PerEpochConfig: true };
    f.f.refreshEffects(); await assert.rejects(() => load(f.input())); assert.equal(f.calls.length, 0);
  }
});
