import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils';
import { buildNativeSoulMarketActivationTransaction as build, deriveNativeSoulMarketActivationInput as derive,
  nativeSoulMarketActivationOutputReferences as refs, validateNativeSoulMarketActivationHistory as validate } from '../scripts/native-soul-market-activation.mjs';
import { NativeSoulPublicationBcs } from '../scripts/native-soul-publication-outputs.mjs';
import { nativeSoulMarketActivationFixture as fixture } from './fixtures/native-soul-market-activation-fixture.mjs';
import { rewriteHistoricalObject } from './fixtures/native-soul-bootstrap-history-fixture.mjs';
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const digest = n => toBase58(new Uint8Array(32).fill(n));
function content(row, kind, mutate) {
  rewriteHistoricalObject(row, object => {
    const fields = NativeSoulPublicationBcs[kind].parse(new Uint8Array(object.data.Move.contents)); mutate(fields);
    object.data.Move.contents = [...NativeSoulPublicationBcs[kind].serialize(fields).toBytes()];
  });
}
function rebind(f, key) {
  f.rawEffects.V2.changedObjects.find(([objectId]) => objectId === f.objects[key].reference.objectId)[1].outputState.ObjectWrite[0] = f.objects[key].reference.digest;
  f.refresh();
}
test('actual builder emits exactly current two Move setter calls true, using one config/admin pair', async () => {
  const f = fixture(), tx = build(f.input), data = tx.getData();
  assert.equal(data.commands.length, 2);
  assert.deepEqual(data.commands.map(c => [c.MoveCall.package, c.MoveCall.module, c.MoveCall.function, c.MoveCall.typeArguments]),
    ['primary', 'secondary'].map(gate => [f.input.packageId, 'market', `update_config_v2_${gate}_enabled`, []]));
  for (const command of data.commands) {
    assert.deepEqual(command.MoveCall.arguments.slice(0, 2), [{ Input: 0, type: 'object', $kind: 'Input' }, { Input: 1, type: 'object', $kind: 'Input' }]);
    const index = command.MoveCall.arguments[2].Input;
    assert.equal(bcs.Bool.parse(fromBase64(data.inputs[index].Pure.bytes)), true);
  }
  assert.deepEqual(await tx.build({ onlyTransactionKind: true }), TransactionDataBuilder.restore(data).build({ onlyTransactionKind: true }));
  const workspace = process.env.SOULIDITY_WORKSPACE ?? fileURLToPath(new URL('../_paired/soulidity', import.meta.url));
  const source = readFileSync(join(workspace, 'move/soulidity/sources/market.move'), 'utf8');
  for (const gate of ['primary', 'secondary']) assert.match(source, new RegExp(`public fun update_config_v2_${gate}_enabled\\(\\s*config: &mut MarketConfigV2,\\s*admin_cap: &MarketAdminCapV2,\\s*enabled: bool,\\s*\\)`));
});
for (const net of [3n, -7n, 0n]) test(`full historical activation accepts exact net gas ${net} and returns a frozen cold journal`, () => {
  const f = fixture({ net }), before = structuredClone(f.args()), expected = Object.fromEntries(Object.entries(f.objects).map(([k, v]) => [k, v.reference]));
  assert.deepEqual(refs(f.args()), expected);
  const result = validate(f.args());
  assert.deepEqual(Object.keys(result).sort(), ['schema', 'stage', 'input', 'priorObjects', 'objects'].sort());
  assert.equal(result.stage, 'ACTIVATE_SOULIDITY_MARKET');
  assert.equal(result.schema, 'native-soul-market-activation-history-v1');
  assert.ok(Object.isFrozen(result.objects.marketConfigV2.reference));
  assert.deepEqual(validate({ ...f.args(), ...JSON.parse(JSON.stringify(result)) }), result);
  assert.deepEqual(f.args(), before);
  f.input.marketConfig.objectId = id(99); assert.notEqual(result.input.marketConfig.objectId, id(99));
});
test('shared fixture supports exact publication identity/authority/version for actual runner and cold-context callers', () => {
  const f = fixture({ packageId: id(101), sender: id(102), marketConfigId: id(103), marketAdminCapId: id(104),
    priorVersion: '19', previousTransaction: digest(105) });
  assert.equal(f.input.packageId, id(101)); assert.equal(f.input.marketConfig.initialSharedVersion, '19');
  assert.equal(f.input.marketAdminCap.objectId, id(104));
  assert.equal(f.priorObjects.marketConfigV2.previousTransaction, digest(105));
  assert.equal(f.priorObjects.marketAdminCapV2.previousTransaction, digest(105));
  assert.equal(validate(f.args()).objects.marketConfigV2.reference.version, '24');
});
for (const problem of ['package', 'config-id', 'birth', 'admin-id', 'admin-version', 'admin-digest', 'extra']) test(`input ${problem} cannot replace prior authority`, () => {
  const f = fixture();
  if (problem === 'package') f.input.packageId = id(99);
  if (problem === 'config-id') f.input.marketConfig.objectId = id(99);
  if (problem === 'birth') f.input.marketConfig.initialSharedVersion = '6';
  if (problem === 'admin-id') f.input.marketAdminCap.objectId = id(99);
  if (problem === 'admin-version') f.input.marketAdminCap.version = '6';
  if (problem === 'admin-digest') f.input.marketAdminCap.digest = digest(99);
  if (problem === 'extra') f.input.enabled = true;
  assert.throws(() => refs(f.args()));
});
for (const problem of ['missing', 'owner', 'admin-binding', 'primary', 'secondary', 'fee', 'recipient', 'legacy', 'type', 'UID', 'ability', 'digest']) {
  test(`predecessor ${problem} must be exact fresh certified config/admin BCS`, () => {
    const f = fixture(), p = f.priorObjects;
    if (problem === 'missing') delete p.marketAdminCapV2;
    if (problem === 'owner') { rewriteHistoricalObject(p.marketAdminCapV2, o => { o.owner = { AddressOwner: id(99) }; }); p.marketAdminCapV2.owner.address = id(99); }
    if (problem === 'admin-binding') content(p.marketAdminCapV2, 'marketAdminCapV2', v => { v.config_id = id(99); });
    if (problem === 'primary') content(p.marketConfigV2, 'marketConfigV2', v => { v.primary_enabled = true; });
    if (problem === 'secondary') content(p.marketConfigV2, 'marketConfigV2', v => { v.secondary_enabled = true; });
    if (problem === 'fee') content(p.marketConfigV2, 'marketConfigV2', v => { v.platform_fee_bps = 251; });
    if (problem === 'recipient') content(p.marketConfigV2, 'marketConfigV2', v => { v.fee_recipient = id(99); });
    if (problem === 'legacy') content(p.marketConfigV2, 'marketConfigV2', v => { v.legacy_config_id = id(99); });
    if (problem === 'type') p.marketConfigV2.type = p.marketConfigV2.type.replace('MarketConfigV2', 'Other');
    if (problem === 'UID') content(p.marketConfigV2, 'marketConfigV2', v => { v.id = id(99); });
    if (problem === 'ability') rewriteHistoricalObject(p.marketAdminCapV2, o => { o.data.Move.hasPublicTransfer = false; });
    if (problem === 'digest') p.marketConfigV2.reference.digest = digest(99);
    assert.throws(() => derive({ packageId: f.input.packageId, sender: f.sender, priorObjects: p }));
  });
}
for (const problem of ['missing-admin', 'extra', 'created', 'deleted', 'wrapped', 'before-version', 'before-digest', 'before-owner', 'output-owner', 'lamport', 'duplicate', 'consensus', 'gas-amount', 'gas-owner', 'gas-missing', 'gas-index', 'digest']) {
  test(`effect ${problem} rejects before any output read`, () => {
    const f = fixture(), e = f.rawEffects.V2, change = e.changedObjects[0][1];
    if (problem === 'missing-admin') e.changedObjects.splice(1, 1);
    if (problem === 'extra') { const extra = structuredClone(e.changedObjects[0]); extra[0] = id(99); e.changedObjects.push(extra); }
    if (problem === 'created') { change.inputState = { NotExist: true }; change.idOperation = { Created: true }; }
    if (problem === 'deleted') { change.outputState = { NotExist: true }; change.idOperation = { Deleted: true }; }
    if (problem === 'wrapped') change.outputState = { NotExist: true };
    if (problem === 'before-version') change.inputState.Exist[0][0] = '6';
    if (problem === 'before-digest') change.inputState.Exist[0][1] = digest(99);
    if (problem === 'before-owner') change.inputState.Exist[1] = { AddressOwner: f.sender };
    if (problem === 'output-owner') change.outputState.ObjectWrite[1] = { AddressOwner: f.sender };
    if (problem === 'lamport') e.lamportVersion = '7';
    if (problem === 'duplicate') e.changedObjects.push(structuredClone(e.changedObjects[0]));
    if (problem === 'consensus') e.unchangedConsensusObjects.push([id(99), { ReadOnlyRoot: ['7', digest(99)] }]);
    if (problem === 'gas-amount') e.changedObjects.at(-1)[1].outputState.AccumulatorWriteV1.value.Integer = '4';
    if (problem === 'gas-owner') e.changedObjects.at(-1)[1].outputState.AccumulatorWriteV1.address.address = id(99);
    if (problem === 'gas-missing') e.changedObjects.pop();
    if (problem === 'gas-index') e.gasObjectIndex = 0;
    if (problem === 'digest') e.transactionDigest = digest(99);
    f.refresh(); assert.throws(() => refs(f.args()));
  });
}
for (const problem of ['primary', 'secondary', 'fee', 'recipient', 'admin-binding', 'previous-tx', 'version', 'tail', 'extra', 'missing']) test(`output ${problem} cannot falsely certify enabled Market`, () => {
  const f = fixture(), o = f.objects;
  if (problem === 'primary') content(o.marketConfigV2, 'marketConfigV2', v => { v.primary_enabled = false; });
  if (problem === 'secondary') content(o.marketConfigV2, 'marketConfigV2', v => { v.secondary_enabled = false; });
  if (problem === 'fee') content(o.marketConfigV2, 'marketConfigV2', v => { v.platform_fee_bps = 249; });
  if (problem === 'recipient') content(o.marketConfigV2, 'marketConfigV2', v => { v.fee_recipient = id(99); });
  if (problem === 'admin-binding') content(o.marketAdminCapV2, 'marketAdminCapV2', v => { v.config_id = id(99); });
  if (problem === 'previous-tx') { rewriteHistoricalObject(o.marketConfigV2, v => { v.previousTransaction = digest(99); }); o.marketConfigV2.previousTransaction = digest(99); }
  if (problem === 'version') { rewriteHistoricalObject(o.marketConfigV2, v => { v.data.Move.version = '13'; }); o.marketConfigV2.reference.version = '13'; }
  if (problem === 'tail') o.marketConfigV2.objectBcsBase64 = toBase64(new Uint8Array([...fromBase64(o.marketConfigV2.objectBcsBase64), 0]));
  if (problem === 'extra') o.other = o.marketConfigV2;
  if (problem === 'missing') delete o.marketConfigV2;
  if (!['missing', 'extra'].includes(problem)) { rebind(f, 'marketConfigV2'); rebind(f, 'marketAdminCapV2'); }
  assert.throws(() => validate(f.args()));
});
for (const problem of ['false', 'one-call', 'reordered', 'extra-call', 'wrong-function', 'sender', 'gas-owner', 'coin-gas', 'tail']) test(`signed transaction ${problem} cannot become activation evidence`, () => {
  const f = fixture(), tx = bcs.TransactionData.parse(f.transactionBytes);
  if (problem === 'false') tx.V1.kind.ProgrammableTransaction.inputs[2].Pure.bytes = toBase64(bcs.Bool.serialize(false).toBytes());
  if (problem === 'one-call') tx.V1.kind.ProgrammableTransaction.commands.pop();
  if (problem === 'reordered') tx.V1.kind.ProgrammableTransaction.commands.reverse();
  if (problem === 'extra-call') tx.V1.kind.ProgrammableTransaction.commands.push(structuredClone(tx.V1.kind.ProgrammableTransaction.commands[0]));
  if (problem === 'wrong-function') tx.V1.kind.ProgrammableTransaction.commands[0].MoveCall.function = 'update_config_v2_fee_recipient';
  if (problem === 'sender') tx.V1.sender = id(99);
  if (problem === 'gas-owner') tx.V1.gasData.owner = id(99);
  if (problem === 'coin-gas') tx.V1.gasData.payment = [{ objectId: id(99), version: '7', digest: digest(99) }];
  f.transactionBytes = bcs.TransactionData.serialize(tx).toBytes();
  if (problem === 'tail') f.transactionBytes = new Uint8Array([...f.transactionBytes, 0]);
  f.rawEffects.V2.transactionDigest = TransactionDataBuilder.getDigestFromBytes(f.transactionBytes); f.refresh();
  assert.throws(() => refs(f.args()));
});
