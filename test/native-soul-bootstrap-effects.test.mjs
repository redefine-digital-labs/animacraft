import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { deriveDynamicFieldID, toBase58 } from '@mysten/sui/utils';
import { buildNativeSoulBootstrapTransaction } from '../scripts/native-soul-bootstrap-transactions.mjs';
import { assertNativeSoulBootstrapGasEffects as assertGas, decodeNativeSoulBootstrapEffects, decodeNativeSoulBootstrapEffectsSync } from '../scripts/native-soul-bootstrap-effects.mjs';
import { nativeSoulBootstrapFixture, bootstrapStages } from './fixtures/native-soul-bootstrap-fixture.mjs';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const digest = n => toBase58(new Uint8Array(32).fill(n));
const sender = id(999);
const input = {
  packageIds: Object.fromEntries(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release', 'soulidity'].map((role, i) => [role, id(100 + i)])),
  protocolConfig: { objectId: id(200), initialSharedVersion: '1' },
  protocolAdminCap: { objectId: id(201), version: '1', digest: digest(1) },
};
const reference = n => ({ objectId: id(n), version: '2', digest: digest(n % 255) });
const existed = n => ({ Exist: [['2', digest(n % 255)], { AddressOwner: sender }] });
const write = n => [id(n), { inputState: existed(n), outputState: { ObjectWrite: [digest(3), { AddressOwner: sender }] }, idOperation: { None: true } }];
const deleted = n => [id(n), { inputState: existed(n), outputState: { NotExist: true }, idOperation: { Deleted: true } }];
function addressGas(net) {
  return [deriveDynamicFieldID('0xacc', '0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>', bcs.Address.serialize(sender).toBytes()), {
    inputState: { NotExist: true }, idOperation: { None: true }, outputState: { AccumulatorWriteV1: {
      address: { address: sender, ty: '0x2::balance::Balance<0x2::sui::SUI>' },
      operation: net > 0n ? { Split: true } : { Merge: true }, value: { Integer: String(net < 0n ? -net : net) },
    } },
  }];
}
async function fixture(payment = [], stage = 'INITIALIZE_PROTOCOL', stageInput = input) {
  const transaction = buildNativeSoulBootstrapTransaction(stage, stageInput);
  transaction.setSender(sender); transaction.setGasOwner(sender); transaction.setGasPrice(1);
  transaction.setGasBudget(1000); transaction.setGasPayment(payment);
  transaction.setExpiration({ ValidDuring: { minEpoch: '43', maxEpoch: '44',
    minTimestamp: null, maxTimestamp: null, chain: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', nonce: 1 } });
  const transactionBytes = await transaction.build();
  const value = { V2: { status: { Success: true }, executedEpoch: '43',
    gasUsed: { computationCost: '1', storageCost: '2', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: TransactionDataBuilder.getDigestFromBytes(transactionBytes), gasObjectIndex: null,
    eventsDigest: null, dependencies: [], lamportVersion: '3', changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } };
  return { transactionBytes, value,
    read: () => decodeNativeSoulBootstrapEffects({ stage, input: stageInput, sender, transactionBytes,
      effectsBytes: bcs.TransactionEffects.serialize(value).toBytes() }) };
}
test('retains business creation, mutation, deletion, wrap and accumulator evidence', async () => {
  const f = await fixture();
  const created = write(210); created[1].inputState = { NotExist: true }; created[1].idOperation = { Created: true };
  const wrapped = deleted(213); wrapped[1].idOperation = { None: true };
  f.value.V2.changedObjects = [created, write(211), deleted(212), wrapped,
    [id(214), { inputState: { NotExist: true }, idOperation: { None: true }, outputState: { AccumulatorWriteV1: {
      address: { address: sender, ty: '0x2::balance::Balance<0x2::sui::SUI>' }, operation: { Split: true }, value: { Integer: '3' },
    } } }]];
  const result = await f.read();
  assert.deepEqual(result.writes.map(row => row.operation), ['CREATED', 'MUTATED']);
  assert.equal(result.deleted[0].objectId, id(212)); assert.equal(result.wrapped[0].objectId, id(213));
  assert.equal(result.accumulators[0].delta.value.Integer, '3'); assert.equal(result.gas.length, 0);
  assert.equal(result.deleted[0].before.digest, digest(212)); assert.ok(Object.isFrozen(result.deleted[0]));
});
for (const net of [3n, -7n, 0n, 9007199254740993n]) test(`address gas validates exact signed net ${net} without Number rounding`, async () => {
  const f = await fixture();
  f.value.V2.gasUsed = { computationCost: net > 0n ? String(net) : '0', storageCost: '0',
    storageRebate: net < 0n ? String(-net) : '0', nonRefundableStorageFee: '99' };
  if (net !== 0n) f.value.V2.changedObjects.push(addressGas(net));
  const effects = await f.read();
  assert.equal(effects.gasPaymentKind, 'address-balance');
  assert.doesNotThrow(() => assertGas({ sender, effects }));
  assert.equal(effects.accumulators.length, net === 0n ? 0 : 1, 'raw evidence is retained');
});
for (const problem of ['id', 'owner', 'type', 'direction', 'amount', 'tuple', 'extra', 'missing',
  'zero-row', 'refund-direction', 'signed-overflow', 'summary-overflow', 'coin-mix', 'address-index']) {
  test(`address gas rejects ${problem} through actual TransactionData/Effects BCS`, async () => {
    const f = await fixture(problem === 'coin-mix' ? [reference(220)] : []);
    const row = addressGas(3n), delta = row[1].outputState.AccumulatorWriteV1;
    f.value.V2.changedObjects = [row];
    if (problem === 'id') row[0] = id(9999);
    if (problem === 'owner') delta.address.address = id(888);
    if (problem === 'type') delta.address.ty = '0x2::balance::Balance<0x2::sui::OTHER>';
    if (problem === 'direction') delta.operation = { Merge: true };
    if (problem === 'amount') delta.value.Integer = '4';
    if (problem === 'tuple') delta.value = { IntegerTuple: ['3', '0'] };
    if (problem === 'extra') { const extra = addressGas(3n); extra[0] = id(9998); f.value.V2.changedObjects.push(extra); }
    if (problem === 'missing') f.value.V2.changedObjects = [];
    if (problem === 'zero-row') f.value.V2.gasUsed.storageRebate = '3';
    if (problem === 'refund-direction') { f.value.V2.gasUsed.storageRebate = '6'; }
    if (problem === 'signed-overflow') f.value.V2.gasUsed.storageRebate = '9223372036854775808';
    if (problem === 'summary-overflow') f.value.V2.gasUsed.computationCost = '18446744073709551615';
    if (problem === 'coin-mix') { f.value.V2.changedObjects.push(write(220)); f.value.V2.gasObjectIndex = 1; }
    if (problem === 'address-index') f.value.V2.gasObjectIndex = 0;
    await assert.rejects(async () => assertGas({ sender, effects: await f.read() }), /Invalid native bootstrap effects/);
  });
}
test('transaction-derived payment kind cannot be omitted or inferred from empty gas arrays', async () => {
  const f = await fixture(), effects = structuredClone(await f.read());
  delete effects.gasPaymentKind;
  assert.throws(() => assertGas({ sender, effects }), /exact gas payment kind/);
});

for (const stage of bootstrapStages) {
  test(`${stage}: synchronous exact kind equals actual async Transaction.build and returns identical effects without RPC`, async t => {
    const stageInput = nativeSoulBootstrapFixture(stage).input;
    const tx = buildNativeSoulBootstrapTransaction(stage, stageInput);
    const syncKind = TransactionDataBuilder.restore(tx.getData()).build({ onlyTransactionKind: true });
    assert.deepEqual(syncKind, await tx.build({ onlyTransactionKind: true }));
    const f = await fixture([], stage, stageInput);
    const created = write(800); created[1].inputState = { NotExist: true }; created[1].idOperation = { Created: true };
    f.value.V2.changedObjects = [created, write(801), deleted(802)];
    const args = { stage, input: stageInput, sender, transactionBytes: f.transactionBytes,
      effectsBytes: bcs.TransactionEffects.serialize(f.value).toBytes() };
    const before = structuredClone(args);
    const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network'); });
    const asyncBuild = t.mock.method(Transaction.prototype, 'build', () => { throw new Error('unexpected async builder'); });
    const sync = decodeNativeSoulBootstrapEffectsSync(args);
    assert.ok(!(sync instanceof Promise));
    const promise = decodeNativeSoulBootstrapEffects(args);
    assert.ok(promise instanceof Promise);
    assert.deepEqual(await promise, sync);
    assert.deepEqual(args, before);
    assert.ok(Object.isFrozen(sync) && Object.isFrozen(sync.writes[0]));
    assert.equal(network.mock.callCount(), 0); assert.equal(asyncBuild.mock.callCount(), 0);
  });
  test(`${stage}: synchronous throws and async rejection preserve the same exact failure`, async () => {
    const stageInput = nativeSoulBootstrapFixture(stage).input, f = await fixture([], stage, stageInput);
    const base = { stage, input: stageInput, sender, transactionBytes: f.transactionBytes,
      effectsBytes: bcs.TransactionEffects.serialize(f.value).toBytes() };
    const variants = [
      { ...base, sender: id(888) },
      { ...base, input: { ...stageInput, protocolConfig: { ...stageInput.protocolConfig, objectId: id(998) } } },
      { ...base, transactionBytes: new Uint8Array([...base.transactionBytes, 0]) },
      { ...base, effectsBytes: new Uint8Array([...base.effectsBytes, 0]) },
      { ...base, effectsBytes: bcs.TransactionEffects.serialize({ V2: { ...f.value.V2, transactionDigest: digest(99) } }).toBytes() },
      { ...base, stage: 'RETIRED_STAGE' },
    ];
    for (const args of variants) {
      let expected;
      assert.throws(() => { try { decodeNativeSoulBootstrapEffectsSync(args); } catch (e) { expected = e; throw e; } });
      let promise;
      assert.doesNotThrow(() => { promise = decodeNativeSoulBootstrapEffects(args); });
      await assert.rejects(promise, e => e.constructor === expected.constructor && e.code === expected.code && e.message === expected.message);
    }
  });
}
test('excludes only exact gas payment and smashing, never every sender-owned write', async () => {
  const f = await fixture([reference(220), reference(221)]);
  f.value.V2.changedObjects = [write(222), write(220), deleted(221), deleted(223)];
  f.value.V2.gasObjectIndex = 1;
  const result = await f.read();
  assert.deepEqual(result.gas.map(row => row.objectId), [id(220), id(221)]);
  assert.deepEqual(result.writes.map(row => row.objectId), [id(222)]);
  assert.deepEqual(result.deleted.map(row => row.objectId), [id(223)]);
});
for (const problem of ['wrong-index', 'missing-index', 'wrong-reference', 'wrong-owner', 'missing-smash']) {
  test(`rejects gas evidence ${problem}`, async () => {
    const f = await fixture([reference(220), reference(221)]);
    f.value.V2.changedObjects = [write(220), deleted(221), write(222)]; f.value.V2.gasObjectIndex = 0;
    if (problem === 'wrong-index') f.value.V2.gasObjectIndex = 2;
    if (problem === 'missing-index') f.value.V2.gasObjectIndex = null;
    if (problem === 'wrong-reference') f.value.V2.changedObjects[0][1].inputState.Exist[0][1] = digest(99);
    if (problem === 'wrong-owner') f.value.V2.changedObjects[0][1].outputState.ObjectWrite[1] = { AddressOwner: id(888) };
    if (problem === 'missing-smash') f.value.V2.changedObjects.splice(1, 1);
    await assert.rejects(f.read, /Invalid native bootstrap effects/);
  });
}
for (const problem of ['digest', 'duplicate-object', 'unexpected-gas', 'unbacked-delete', 'deleted-write', 'version', 'package-write']) {
  test(`rejects malformed effects ${problem}`, async () => {
    const f = await fixture(); f.value.V2.changedObjects = [write(220)];
    if (problem === 'digest') f.value.V2.transactionDigest = digest(99);
    if (problem === 'duplicate-object') f.value.V2.changedObjects.push(write(220));
    if (problem === 'unexpected-gas') f.value.V2.gasObjectIndex = 0;
    if (problem === 'unbacked-delete') f.value.V2.changedObjects = [[id(220), { inputState: { NotExist: true }, outputState: { NotExist: true }, idOperation: { Deleted: true } }]];
    if (problem === 'deleted-write') f.value.V2.changedObjects[0][1].idOperation = { Deleted: true };
    if (problem === 'version') f.value.V2.lamportVersion = '2';
    if (problem === 'package-write') f.value.V2.changedObjects[0][1].outputState = { PackageWrite: ['3', digest(9)] };
    await assert.rejects(f.read, /Invalid native bootstrap effects/);
  });
}
test('binds decoded effects to exact stage arguments, signer and canonical bytes', async () => {
  const f = await fixture(); const effectsBytes = bcs.TransactionEffects.serialize(f.value).toBytes();
  const base = { stage: 'INITIALIZE_PROTOCOL', input, sender, transactionBytes: f.transactionBytes, effectsBytes };
  await assert.rejects(() => decodeNativeSoulBootstrapEffects({ ...base, sender: id(888) }), /sender\/gas owner/);
  await assert.rejects(() => decodeNativeSoulBootstrapEffects({ ...base, input: { ...input,
    protocolConfig: { ...input.protocolConfig, objectId: id(9999) } } }), /TransactionKind/);
  await assert.rejects(() => decodeNativeSoulBootstrapEffects({ ...base,
    effectsBytes: new Uint8Array([...effectsBytes, 0]) }), /canonical BCS/);
  await assert.rejects(() => decodeNativeSoulBootstrapEffects({ ...base,
    transactionBytes: new Uint8Array([...f.transactionBytes, 0]) }), /canonical BCS/);
});
