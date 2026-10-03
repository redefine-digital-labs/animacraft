import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64 } from '@mysten/sui/utils';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { nativeSoulBootstrapContextFromWal } from '../scripts/mainnet-v8-release.mjs';
import { bootstrapStages } from './fixtures/native-soul-bootstrap-fixture.mjs';
import { nativeSoulStageDataFixture } from './fixtures/native-soul-native-stage-ready-fixture.mjs';
import { appendFixtureEvent } from './fixtures/native-soul-full-wal-fixture.mjs';
import { nativeSoulBootstrapWalFixture, nativeSoulBootstrapWalStageFixture,
  appendNativeSoulBootstrapWalStage } from './fixtures/native-soul-full-wal-native-fixture.mjs';

const fixture = nativeSoulBootstrapWalFixture();
function beforeStage(fullWal, index) {
  const wal = structuredClone(fullWal);
  wal.events = wal.events.slice(0, 41 + index * 5);
  wal.revision = String(wal.events.length); wal.headEventSha256 = wal.events.at(-1).eventSha256;
  delete wal.walSha256; wal.walSha256 = L.sha256MainnetV8Json(wal);
  L.assertMainnetV8ReleaseWalContents(wal);
  return wal;
}
function context(wal, stage) {
  const extras = stage === 'SETUP_RELEASE' ? nativeSoulStageDataFixture(stage) : {};
  return structuredClone(nativeSoulBootstrapContextFromWal({ wal, stage,
    ...(stage === 'SETUP_RELEASE' ? { keyServerCertificates: extras.keyServerCertificates,
      walrusSystem: extras.walrusSystem, walrusExecution: extras.walrusExecution } : {}) }));
}

test('one sealed eight-publication WAL continues through all four native stages, ending before market activation', async () => {
  const { wal, stages, publications } = await fixture;
  assert.equal(wal.revision, '61'); assert.equal(wal.events.at(-1).ordinal, '11');
  assert.equal(wal.events.at(-1).status, 'FINALIZED_SUCCESS');
  assert.deepEqual(stages.map(row => row.stage), bootstrapStages);
  assert.equal(new Set([...publications, ...stages].map(row => row.input.digest)).size, 12);
  assert.equal(wal.events.some(row => Number(row.ordinal) >= 12), false);
  assert.doesNotThrow(() => L.assertMainnetV8ReleaseWalContents(JSON.parse(JSON.stringify(wal))));
});

for (const [index, stage] of bootstrapStages.entries()) test(`${stage} retains exact context, READY bytes, query-first finality and cold history`, async () => {
  const f = await fixture, row = f.stages[index], wal = beforeStage(f.wal, index);
  const expected = context(wal, stage), certificate = row.input.observation.certificate;
  assert.deepEqual(row.readyArtifact.stageData, expected.stageData);
  assert.deepEqual(certificate.readback.priorObjects, expected.priorObjects);
  assert.deepEqual(certificate.readback.input, L.nativeSoulBootstrapInputFromStageData(stage, expected.stageData));
  const events = f.wal.events.slice(41 + index * 5, 46 + index * 5);
  assert.deepEqual(events.map(e => e.status), ['READY', 'SIGNED', 'OUTCOME_PENDING', 'FINALIZED_SUCCESS_PENDING_READBACK', 'FINALIZED_SUCCESS']);
  assert.equal(events[2].evidence.observation.kind, 'QUERY_INTENT');
  assert.equal(row.unsignedEnvelope.transactionBase64, certificate.finalityEvidence.transactionBase64);
  assert.deepEqual(events[4].evidence, L.buildMainnetV8OutcomeEvidence(row.input));
  assert.deepEqual(row.readyArtifact.predecessorReadback.certificate,
    index === 0 ? f.publications[7].input.observation : f.stages[index - 1].input.observation);
  const tx = bcs.TransactionData.parse(fromBase64(certificate.finalityEvidence.transactionBase64)).V1;
  assert.deepEqual(tx.gasData.payment, []);
  assert.equal(tx.expiration.ValidDuring.chain, L.MAINNET_V8_CHAIN_IDENTIFIER);
  assert.equal(tx.expiration.ValidDuring.minEpoch, certificate.finalityEvidence.epoch);
  // Current Move receipt shapes are encoded and semantically checked; this is
  // still an offline fixture, not proof of checkpoint or signature execution.
  const count = [2, 1, 0, 0][index], finality = certificate.finalityEvidence;
  if (count) {
    assert.equal(finality.transactionEvents.eventCount, String(count));
    assert.equal(finality.eventsDigest, finality.transactionEvents.digest);
  } else {
    assert.equal(finality.eventsDigest, null); assert.equal(finality.transactionEvents, null);
  }
});

test('Core published owned ref and shared birth flow into INIT, and every subsequent input uses the latest exact history', async () => {
  const { stages, publications } = await fixture;
  const publication = publications[0].input.observation.certificate.readback;
  const histories = stages.map(row => row.input.observation.certificate.readback);
  assert.deepEqual(histories[0].priorObjects.protocolAdmin.reference, publication.protocolAdminCap.reference);
  assert.equal(histories[0].priorObjects.protocolAdmin.objectBcsBase64, publication.protocolAdminCap.objectBcsBase64);
  assert.equal(histories[0].input.protocolConfig.initialSharedVersion, publication.protocolConfig.owner.Shared.initial_shared_version);
  const latest = structuredClone(histories[0].priorObjects);
  for (const history of histories) {
    for (const [kind, value] of Object.entries(history.priorObjects)) assert.deepEqual(value, latest[kind]);
    for (const [kind, value] of Object.entries(history.objects)) {
      if (latest[kind]?.owner.kind === 'shared') assert.equal(value.owner.initialSharedVersion, latest[kind].owner.initialSharedVersion);
      latest[kind] = value;
    }
  }
  assert.deepEqual(histories.map(h => h.input.protocolAdminCap.version), ['7', '8', '10', '11']);
  assert.equal(histories[2].input.catalog.initialSharedVersion, '10');
  assert.equal(histories[3].input.catalog.initialSharedVersion, '10');
  assert.equal(histories[3].input.replacement.version, '10');
  assert.equal(histories[3].input.bootstrapAdmin.version, '11');
});

test('FINAL deletes the exact BEGIN-created BootstrapAdmin and keeps read-only history unchanged', async () => {
  const { stages } = await fixture;
  const begun = stages[2].input.observation.certificate.readback;
  const final = stages[3].input.observation.certificate;
  const prior = final.readback.priorObjects.bootstrapAdmin;
  assert.deepEqual(prior, begun.objects.bootstrapAdmin);
  const effects = bcs.TransactionEffects.parse(fromBase64(final.finalityEvidence.effectsBcsBase64)).V2;
  const deletion = effects.changedObjects.find(([objectId]) => objectId === prior.reference.objectId)[1];
  assert.equal(deletion.idOperation.$kind, 'Deleted'); assert.equal(deletion.outputState.$kind, 'NotExist');
  assert.deepEqual(deletion.inputState.Exist[0], [prior.reference.version, prior.reference.digest]);
  assert.equal('bootstrapAdmin' in final.readback.objects, false);
  for (const kind of ['protocol', 'protocolAdmin', 'replacement']) assert.deepEqual(final.readback.objects[kind], final.readback.priorObjects[kind]);
});

test('a fully rehashed stale owned admin transaction/outcome is individually valid but cannot enter the next READY', async () => {
  const f = await fixture, wal = beforeStage(f.wal, 1), changed = context(wal, 'SETUP_RELEASE');
  changed.priorObjects.protocolAdmin = structuredClone(f.stages[0].input.observation.certificate.readback.priorObjects.protocolAdmin);
  changed.stageData.protocolAdminCap = structuredClone(changed.priorObjects.protocolAdmin.reference);
  const row = await nativeSoulBootstrapWalStageFixture({ wal, stage: 'SETUP_RELEASE', contextOverride: changed });
  assert.doesNotThrow(() => L.buildMainnetV8OutcomeEvidence(row.input));
  assert.notEqual(row.input.digest, f.stages[1].input.digest);
  assert.throws(() => appendNativeSoulBootstrapWalStage(wal, row),
    e => e.code === 'MAINNET_V8_WAL_INVALID' && /predecessor-derived inputs/.test(e.message));
});

test('a fully rehashed read-only protocol substitution passes standalone history but fails exact success predecessor binding', async () => {
  const f = await fixture, wal = beforeStage(f.wal, 2), changed = context(wal, 'BEGIN_BOOTSTRAP');
  changed.priorObjects.protocol = structuredClone(f.stages[0].input.observation.certificate.readback.objects.protocol);
  const row = await nativeSoulBootstrapWalStageFixture({ wal, stage: 'BEGIN_BOOTSTRAP', contextOverride: changed });
  assert.deepEqual(row.readyArtifact.stageData, f.stages[2].readyArtifact.stageData);
  assert.equal(row.input.digest, f.stages[2].input.digest);
  assert.notEqual(row.input.observation.certificate.finalityEvidence.effectsDigest,
    f.stages[2].input.observation.certificate.finalityEvidence.effectsDigest);
  assert.doesNotThrow(() => L.buildMainnetV8OutcomeEvidence(row.input));
  assert.throws(() => appendNativeSoulBootstrapWalStage(wal, row),
    e => e.code === 'MAINNET_V8_WAL_INVALID' && /Native success differs from READY or exact predecessor history/.test(e.message));
});

test('rehashing the READY predecessor certificate cannot replace the immediate native predecessor with an older valid one', async () => {
  const f = await fixture, wal = beforeStage(f.wal, 3), row = f.stages[3];
  const artifact = structuredClone(row.readyArtifact);
  artifact.predecessorReadback.certificate = structuredClone(f.stages[0].input.observation);
  artifact.predecessorReadback.certificateSha256 = L.sha256MainnetV8Json(artifact.predecessorReadback.certificate);
  const ready = L.buildMainnetV8ReadyEvidence({ ordinal: row.ordinal, readyArtifact: artifact, unsignedEnvelope: row.unsignedEnvelope });
  assert.throws(() => appendFixtureEvent(wal, { ordinal: row.ordinal, status: 'READY', evidence: ready }),
    e => e.code === 'MAINNET_V8_WAL_INVALID' && /preceding finalized certificate/.test(e.message));
});
