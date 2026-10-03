import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { toBase58 } from '@mysten/sui/utils';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { buildNativeSoulBootstrapTransaction } from '../scripts/native-soul-bootstrap-transactions.mjs';
import { decodeNativeSoulBootstrapEffects } from '../scripts/native-soul-bootstrap-effects.mjs';
import { validateNativeSoulBootstrapWriteSet as validate } from '../scripts/native-soul-bootstrap-write-set.mjs';
import { nativeSoulBootstrapFixture, bootstrapId as id, bootstrapStages } from './fixtures/native-soul-bootstrap-fixture.mjs';

const hash = n => toBase58(new Uint8Array(32).fill(n));
const createdKinds = {
  INITIALIZE_PROTOCOL: ['protocolTreasury'],
  SETUP_RELEASE: ['catalog', 'sealConfig', 'runtimeConfig', 'outputConfig', 'physicalConfig', 'marketConfig',
    'releaseConfig', 'replacement', 'bootstrapSlot', 'walrusPolicy', 'walrusPolicySlot', 'nativeSoulBinding', 'protocolCatalogSlot'],
  BEGIN_BOOTSTRAP: ['bootstrapAdmin'], FINALIZE_BOOTSTRAP: ['bootstrapCertificate'],
};
const mutatedKinds = {
  INITIALIZE_PROTOCOL: ['protocol', 'protocolAdmin'], SETUP_RELEASE: ['protocol', 'protocolAdmin'],
  BEGIN_BOOTSTRAP: ['protocolAdmin', 'catalog', 'bootstrapSlot'],
  FINALIZE_BOOTSTRAP: ['catalog', 'outputConfig', 'marketConfig', 'bootstrapSlot'],
};
function rawOwner(owner) {
  switch (owner.kind) {
    case 'address': return { AddressOwner: owner.address };
    case 'object': return { ObjectOwner: owner.objectId };
    case 'shared': return { Shared: { initialSharedVersion: owner.initialSharedVersion } };
    case 'immutable': return { Immutable: true };
  }
}

// Real canonical TransactionData/Effects V2 and object BCS through the production
// decoder. Synthetic versions/hashes/objects are not an executed/finalized PTB.
async function fixture(stage) {
  const f = nativeSoulBootstrapFixture(stage);
  const tx = buildNativeSoulBootstrapTransaction(stage, f.input);
  tx.setSender(f.sender); tx.setGasOwner(f.sender); tx.setGasPrice(1); tx.setGasBudget(1000);
  const gas = { objectId: id(1000), version: '9', digest: hash(9) };
  tx.setGasPayment([gas]);
  const transactionBytes = await tx.build();
  const changedObjects = [];
  for (const kind of [...createdKinds[stage], ...mutatedKinds[stage]]) {
    const envelope = f.objects[kind], created = createdKinds[stage].includes(kind);
    if (created && envelope.owner.kind === 'shared') envelope.owner.initialSharedVersion = '17';
    changedObjects.push([envelope.objectId, {
      inputState: created ? { NotExist: true } : { Exist: [['9', hash(9)], rawOwner(envelope.owner)] },
      outputState: { ObjectWrite: [hash(17), rawOwner(envelope.owner)] },
      idOperation: created ? { Created: true } : { None: true },
    }]);
  }
  if (stage === 'FINALIZE_BOOTSTRAP') changedObjects.push([f.input.bootstrapAdmin.objectId, {
    inputState: { Exist: [['9', hash(9)], { AddressOwner: f.sender }] },
    outputState: { NotExist: true }, idOperation: { Deleted: true },
  }]);
  changedObjects.push([gas.objectId, { inputState: { Exist: [['9', hash(9)], { AddressOwner: f.sender }] },
    outputState: { ObjectWrite: [hash(17), { AddressOwner: f.sender }] }, idOperation: { None: true } }]);
  const consensus = stage === 'SETUP_RELEASE' ? [f.input.walrusSystem]
    : ['BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'].includes(stage) ? [f.input.protocolConfig] : [];
  const raw = { V2: { status: { Success: true }, executedEpoch: '43',
    gasUsed: { computationCost: '1', storageCost: '2', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest: TransactionDataBuilder.getDigestFromBytes(transactionBytes), gasObjectIndex: changedObjects.length - 1,
    eventsDigest: null, dependencies: [], lamportVersion: '17', changedObjects,
    unchangedConsensusObjects: consensus.map(r => [r.objectId, { ReadOnlyRoot: ['9', hash(9)] }]), auxDataDigest: null } };
  const effects = await decodeNativeSoulBootstrapEffects({ stage, input: f.input, sender: f.sender, transactionBytes,
    effectsBytes: bcs.TransactionEffects.serialize(raw).toBytes() });
  return { ...f, effects: structuredClone(effects), raw,
    args() { return { ...f.args(), effects: this.effects }; } };
}
const invalid = fn => assert.throws(fn, error => ['NATIVE_SOUL_BOOTSTRAP_WRITE_SET_INVALID',
  'NATIVE_SOUL_BOOTSTRAP_READBACK_INVALID'].includes(error.code) || /Invalid native bootstrap/.test(error.message));

for (const stage of bootstrapStages) {
  test(`${stage}: actual typed BCS/effects inventory and immutable returned references`, async () => {
    const f = await fixture(stage), result = validate(f.args());
    assert.deepEqual(Object.keys(result.writesByKind).sort(), [...createdKinds[stage], ...mutatedKinds[stage]].sort());
    assert.deepEqual(Object.keys(result.deletedByKind), stage === 'FINALIZE_BOOTSTRAP' ? ['bootstrapAdmin'] : []);
    assert.ok(Object.isFrozen(result.writesByKind));
    assert.equal(Object.isFrozen(f.effects), false);
    const first = Object.values(result.writesByKind)[0];
    f.effects.writes[0].digest = hash(99);
    assert.equal(first.digest, hash(17));
  });
  for (const kind of [...createdKinds[stage], ...mutatedKinds[stage]]) {
    test(`${stage}: missing ${kind} write is rejected`, async () => {
      const f = await fixture(stage);
      f.effects.writes = f.effects.writes.filter(r => r.objectId !== f.objects[kind].objectId);
      invalid(() => validate(f.args()));
    });
    test(`${stage}: ${kind} wrong operation is rejected`, async () => {
      const f = await fixture(stage), row = f.effects.writes.find(r => r.objectId === f.objects[kind].objectId);
      row.operation = row.operation === 'CREATED' ? 'MUTATED' : 'CREATED';
      invalid(() => validate(f.args()));
    });
  }
  for (const problem of ['extra-write', 'extra-delete', 'wrap', 'accumulator', 'address-gas', 'gas-collision',
    'duplicate-gas', 'duplicate-write', 'unwrapped', 'wrong-owner', 'wrong-version', 'wrong-digest', 'extra-object', 'missing-object']) {
    test(`${stage}: rejects ${problem}`, async () => {
      const f = await fixture(stage), row = f.effects.writes[0];
      if (problem === 'extra-write') f.effects.writes.push({ ...row, objectId: id(9999) });
      if (problem === 'extra-delete') f.effects.deleted.push({ objectId: id(9999), before: null });
      if (problem === 'wrap') f.effects.wrapped.push({ objectId: id(9999), before: null });
      if (problem === 'accumulator') f.effects.accumulators.push({ objectId: id(9999), delta: {} });
      if (problem === 'address-gas') f.effects.gas = [];
      if (problem === 'gas-collision') f.effects.gas[0].objectId = f.objects.protocolAdmin.objectId;
      if (problem === 'duplicate-gas') f.effects.gas.push(f.effects.gas[0]);
      if (problem === 'duplicate-write') f.effects.writes[1] = structuredClone(row);
      if (problem === 'unwrapped') row.operation = 'UNWRAPPED';
      if (problem === 'wrong-owner') row.owner = { kind: 'address', address: id(9999) };
      if (problem === 'wrong-version') row.version = '18';
      if (problem === 'wrong-digest') row.digest = 'not-a-digest';
      if (problem === 'extra-object') f.objects.other = f.objects.protocol;
      if (problem === 'missing-object') delete f.objects.protocol;
      invalid(() => validate(f.args()));
    });
  }
  for (const problem of ['id', 'version', 'digest', 'owner', 'missing']) {
    test(`${stage}: rejects mutated before ${problem}`, async () => {
      const f = await fixture(stage), row = f.effects.writes.find(r => r.operation === 'MUTATED');
      if (problem === 'id') row.before.objectId = id(9999);
      if (problem === 'version') row.before.version = '17';
      if (problem === 'digest') row.before.digest = 'not-a-digest';
      if (problem === 'owner') row.before.owner = { kind: 'address', address: id(9999) };
      if (problem === 'missing') row.before = null;
      invalid(() => validate(f.args()));
    });
  }
}

for (const stage of ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE']) {
  test(`${stage}: shared birth equals actual write version, not historical fixture version`, async () => {
    const f = await fixture(stage), kind = createdKinds[stage].find(k => f.objects[k].owner.kind === 'shared');
    const row = f.effects.writes.find(r => r.objectId === f.objects[kind].objectId);
    row.owner.initialSharedVersion = '7'; f.objects[kind].owner.initialSharedVersion = '7';
    invalid(() => validate(f.args()));
  });
}
for (const stage of ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP']) {
  for (const key of ['version', 'digest']) test(`${stage}: owned Admin before ${key} must equal exact input`, async () => {
    const f = await fixture(stage), row = f.effects.writes.find(r => r.objectId === f.input.protocolAdminCap.objectId);
    row.before[key] = key === 'version' ? '8' : hash(8);
    invalid(() => validate(f.args()));
  });
}
for (const problem of ['absent', 'substitution', 'owner', 'version', 'digest', 'wrapped', 'retained']) {
  test(`FINALIZE_BOOTSTRAP: exact consumed bootstrap Admin ${problem}`, async () => {
    const f = await fixture('FINALIZE_BOOTSTRAP'), row = f.effects.deleted[0];
    if (problem === 'absent') f.effects.deleted = [];
    if (problem === 'substitution') row.objectId = id(9999);
    if (problem === 'owner') row.before.owner.address = id(9999);
    if (problem === 'version') row.before.version = '8';
    if (problem === 'digest') row.before.digest = hash(8);
    if (problem === 'wrapped') { f.effects.deleted = []; f.effects.wrapped = [row]; }
    if (problem === 'retained') { f.effects.deleted = []; f.effects.writes.push({ ...row, operation: 'MUTATED',
      version: '17', digest: hash(17), owner: { kind: 'address', address: f.sender } }); }
    invalid(() => validate(f.args()));
  });
}
test('FINALIZE does not submit ProtocolAdmin; adding a write to its readback is rejected', async () => {
  const f = await fixture('FINALIZE_BOOTSTRAP');
  f.effects.writes.push({ operation: 'MUTATED', objectId: f.input.protocolAdminCap.objectId, version: '17', digest: hash(17),
    owner: { kind: 'address', address: f.sender }, before: { ...f.input.protocolAdminCap, owner: { kind: 'address', address: f.sender } } });
  invalid(() => validate(f.args()));
});
test('new object cannot alias a published package, even with matching BCS and effects identity', async () => {
  const f = await fixture('INITIALIZE_PROTOCOL'), kind = 'protocolTreasury';
  const row = f.effects.writes.find(r => r.objectId === f.objects[kind].objectId);
  row.objectId = f.input.packageIds.soulidity; f.objects[kind].objectId = row.objectId;
  f.mutate(kind, fields => { fields.id = row.objectId; });
  invalid(() => validate(f.args()));
});
test('created object cannot carry a before reference', async () => {
  const f = await fixture('INITIALIZE_PROTOCOL');
  f.effects.writes[0].before = { objectId: f.effects.writes[0].objectId, version: '9', digest: hash(9),
    owner: f.effects.writes[0].owner };
  invalid(() => validate(f.args()));
});
test('shared mutation cannot precede its initial shared version', async () => {
  const f = await fixture('INITIALIZE_PROTOCOL');
  f.effects.writes.find(r => r.objectId === f.input.protocolConfig.objectId).before.version = '6';
  invalid(() => validate(f.args()));
});
test('INITIALIZE has no readonly shared consensus input', async () => {
  const f = await fixture('INITIALIZE_PROTOCOL');
  f.effects.unchangedConsensusObjects.push([f.input.protocolConfig.objectId, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['9', hash(9)] }]);
  invalid(() => validate(f.args()));
});
for (const stage of ['SETUP_RELEASE', 'BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP']) {
  for (const problem of ['missing', 'extra', 'id', 'variant', 'version', 'digest']) {
    test(`${stage}: readonly shared consensus ${problem}`, async () => {
      const f = await fixture(stage), [objectId, state] = f.effects.unchangedConsensusObjects[0];
      if (problem === 'missing') f.effects.unchangedConsensusObjects = [];
      if (problem === 'extra') f.effects.unchangedConsensusObjects.push([id(9999), state]);
      if (problem === 'id') f.effects.unchangedConsensusObjects[0][0] = id(9999);
      if (problem === 'variant') f.effects.unchangedConsensusObjects[0] = [objectId, { $kind: 'Cancelled', Cancelled: '9' }];
      if (problem === 'version') state.ReadOnlyRoot[0] = '6';
      if (problem === 'digest') state.ReadOnlyRoot[1] = 'bad-digest';
      invalid(() => validate(f.args()));
    });
  }
}
