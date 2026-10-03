import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { bootstrapHistoryFixture } from './fixtures/native-soul-bootstrap-history-fixture.mjs';
import { bootstrapStages } from './fixtures/native-soul-bootstrap-fixture.mjs';
import { bootstrapFinalityEvents } from './fixtures/native-soul-bootstrap-events-fixture.mjs';
import { certifyMainnetV8NativeBootstrap, nativeSoulBootstrapPriorObjectsFromWal, certifyOrdinalReadback } from '../scripts/mainnet-v8-release.mjs';
import { MAINNET_V8_DEFAULT_COMMITTEE, MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
  MAINNET_V8_DEFAULT_COMMITTEE_OWNER, MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256 } from '../scripts/mainnet-v8-release-lib.mjs';
import { validateNativeSoulBootstrapHistory } from '../scripts/native-soul-bootstrap-history.mjs';

function owner(value) {
  if (value.kind === 'shared') return { kind: 'Shared', initialSharedVersion: value.initialSharedVersion };
  if (value.kind === 'address') return { kind: 'AddressOwner', address: value.address };
  if (value.kind === 'object') return { kind: 'ObjectOwner', address: value.objectId };
  return { kind: 'Immutable' };
}
function fixture(stage) {
  const f = bootstrapHistoryFixture(stage), calls = [];
  const eventFields = bootstrapFinalityEvents(f);
  f.effects.V2.eventsDigest = eventFields.eventsDigest; f.refreshEffects();
  const rows = [...Object.values(f.objects), ...Object.values(f.consensusObjects)];
  const transport = {
    getObject: () => { throw new Error('Latest object lookup is forbidden'); },
    getHistoricalObject: async request => {
      assert.equal(typeof request.version, 'bigint'); calls.push(request);
      const row = rows.find(r => r.reference.objectId === request.objectId && r.reference.version === String(request.version));
      assert.ok(row, 'exact historical version required');
      return { ...row.reference, type: row.type, owner: owner(row.owner), previousTransaction: row.previousTransaction,
        objectBcs: fromBase64(row.objectBcsBase64) };
    },
  };
  const args = { stage, input: f.input, priorObjects: f.priorObjects, signer: f.sender, transport,
    finalityEvidence: { digest: TransactionDataBuilder.getDigestFromBytes(f.transactionBytes),
      transactionBase64: toBase64(f.transactionBytes), effectsBcsBase64: toBase64(f.effectsBytes), ...eventFields } };
  return { f, calls, args };
}
for (const stage of bootstrapStages) {
  test(`actual runner reads and journals ${stage} without latest JSON`, async () => {
    const { f, calls, args } = fixture(stage), result = await certifyMainnetV8NativeBootstrap(args);
    assert.deepEqual(Object.keys(result).sort(), ['schema', 'stage', 'input', 'objects', 'priorObjects', 'consensusObjects'].sort());
    assert.equal(result.stage, stage); assert.deepEqual(result.input, f.input);
    assert.ok(Object.isFrozen(result.input) && Object.isFrozen(result.input.packageIds));
    assert.throws(() => { result.input.packageIds.core = result.input.packageIds.seal; }, TypeError);
    const cold = JSON.parse(JSON.stringify(result));
    assert.deepEqual(validateNativeSoulBootstrapHistory({ ...f.args(), ...cold }), validateNativeSoulBootstrapHistory(f.args()));
    assert.equal(calls.length, { INITIALIZE_PROTOCOL: 3, SETUP_RELEASE: 16, BEGIN_BOOTSTRAP: 5, FINALIZE_BOOTSTRAP: 6 }[stage]);
  });
  test(`actual runner rejects ${stage} historical substitution and mismatched finality digest`, async () => {
    const { args, calls } = fixture(stage);
    await assert.rejects(() => certifyMainnetV8NativeBootstrap({ ...args,
      finalityEvidence: { ...args.finalityEvidence, digest: toBase58(new Uint8Array(32).fill(99)) } }));
    assert.equal(calls.length, 0);
    const getHistoricalObject = args.transport.getHistoricalObject;
    args.transport.getHistoricalObject = async request => ({ ...await getHistoricalObject(request), version: '999' });
    await assert.rejects(() => certifyMainnetV8NativeBootstrap(args));
  });
}

function finalized(ordinal, readback) {
  return { ordinal: String(ordinal), status: 'FINALIZED_SUCCESS', evidence: { observation: { details: { certificate: { readback } } } } };
}
for (const [i, stage] of bootstrapStages.entries()) {
  test(`actual readback dispatcher selects ${stage} at ordinal ${i + 8}`, async () => {
    const { f, args } = fixture(stage);
    const coreOutput = row => ({ ...row, owner: owner(row.owner) });
    // Certified-input projection fixture only; no checkpoint/finality claim.
    const wal = { plan: { sender: f.sender }, events: [finalized(0, { role: 'core',
      protocolConfig: coreOutput(f.priorObjects.protocol), protocolAdminCap: coreOutput(f.priorObjects.protocolAdmin) })] };
    for (let previous = 0; previous < i; previous++) wal.events.push(finalized(8 + previous, {
      schema: 'native-soul-bootstrap-history-v1', stage: bootstrapStages[previous], objects: f.priorObjects,
    }));
    const stageData = structuredClone(f.input);
    if (stage === 'SETUP_RELEASE') stageData.keyServerCertificates = [{
      objectId: MAINNET_V8_DEFAULT_COMMITTEE, type: MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
      owner: MAINNET_V8_DEFAULT_COMMITTEE_OWNER, contentSha256: MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
      version: '1', digest: args.finalityEvidence.digest, previousTransaction: args.finalityEvidence.digest,
    }];
    const ready = { readyArtifact: { kind: stage, stageData } };
    const result = await certifyOrdinalReadback({ ordinal: i + 8, wal, ready,
      transport: args.transport, finalityEvidence: args.finalityEvidence });
    assert.equal(result.stage, stage); assert.deepEqual(result.input, f.input);
    assert.deepEqual(result.priorObjects, f.priorObjects);
    ready.readyArtifact.kind = 'BOOTSTRAP_RELEASE';
    await assert.rejects(() => certifyOrdinalReadback({ ordinal: i + 8, wal, ready,
      transport: args.transport, finalityEvidence: args.finalityEvidence }));
  });
}
test('runner snapshots caller input/prior/finality before historical I/O', async () => {
  const { f, args } = fixture('INITIALIZE_PROTOCOL');
  const expectedInput = structuredClone(f.input), expectedPrior = structuredClone(f.priorObjects);
  const read = args.transport.getHistoricalObject;
  let mutated = false;
  args.transport.getHistoricalObject = async request => {
    if (!mutated) {
      mutated = true;
      args.input.packageIds.core = args.input.packageIds.seal;
      args.priorObjects.protocol.reference.version = '999';
      args.finalityEvidence.digest = toBase58(new Uint8Array(32).fill(98));
      args.finalityEvidence.effectsBcsBase64 = '';
      args.finalityEvidence.transactionEvents.bcsBase64 = '';
      args.finalityEvidence.transactionEvents.eventCount = '0';
      args.finalityEvidence.eventsDigest = null;
    }
    return read(request);
  };
  const result = await certifyMainnetV8NativeBootstrap(args);
  assert.deepEqual(result.input, expectedInput); assert.deepEqual(result.priorObjects, expectedPrior);
});
test('actual WAL projection retains latest certified predecessor for each required object kind', () => {
  // Projection-only synthetic records; this does not assert a finalized chain.
  const f = bootstrapHistoryFixture('FINALIZE_BOOTSTRAP');
  const coreOutput = row => ({ ...row, owner: owner(row.owner) });
  const wal = { events: [finalized(0, { role: 'core',
    protocolConfig: coreOutput(f.priorObjects.protocol), protocolAdminCap: coreOutput(f.priorObjects.protocolAdmin) }),
  finalized(8, { schema: 'native-soul-bootstrap-history-v1', stage: 'INITIALIZE_PROTOCOL', objects: {} }),
  finalized(9, { schema: 'native-soul-bootstrap-history-v1', stage: 'SETUP_RELEASE', objects: f.priorObjects }),
  finalized(10, { schema: 'native-soul-bootstrap-history-v1', stage: 'BEGIN_BOOTSTRAP', objects: {
    catalog: f.priorObjects.catalog, bootstrapSlot: f.priorObjects.bootstrapSlot, bootstrapAdmin: f.priorObjects.bootstrapAdmin,
  } })] };
  assert.deepEqual(nativeSoulBootstrapPriorObjectsFromWal({ wal, ordinal: 11 }), f.priorObjects);
  wal.events[3].evidence.observation.details.certificate.readback.stage = 'SETUP_RELEASE';
  assert.throws(() => nativeSoulBootstrapPriorObjectsFromWal({ wal, ordinal: 11 }));
  wal.events.pop(); assert.throws(() => nativeSoulBootstrapPriorObjectsFromWal({ wal, ordinal: 11 }));
  assert.throws(() => nativeSoulBootstrapPriorObjectsFromWal({ wal, ordinal: 7 }));
});
