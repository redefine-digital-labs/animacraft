import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { assertMainnetV8ExportConfigContents, assertMainnetV8TransactionMatchesReady,
  assertMainnetV8ReadyWalContext, nextMainnetV8FinalizedAction } from '../scripts/mainnet-v8-release.mjs';
import { nativeSoulCompletedWalFixture } from './fixtures/native-soul-completed-wal-fixture.mjs';
import { appendFixtureEvent } from './fixtures/native-soul-full-wal-fixture.mjs';

const f = await nativeSoulCompletedWalFixture();
const clone = value => structuredClone(value);
const hash = L.sha256MainnetV8Json;
const cases = [...f.publications, ...f.stages, f.market];
function rehashWal(wal) {
  let previous = '0'.repeat(64);
  wal.events.forEach((row, index) => {
    row.revision = String(index + 1); row.previousEventSha256 = previous;
    delete row.eventSha256; row.eventSha256 = hash(row); previous = row.eventSha256;
  });
  wal.revision = String(wal.events.length); wal.headEventSha256 = previous;
  delete wal.walSha256; wal.walSha256 = hash(wal);
  return wal;
}
function before(ordinal, status) {
  const wal = clone(f.wal), index = wal.events.findIndex(row => row.ordinal === String(ordinal) && row.status === status);
  assert.ok(index >= 0);
  wal.events = wal.events.slice(0, index + 1);
  if (!wal.events.some(row => row.status === 'FINAL_MANIFEST_SEALED')) { wal.releaseId = null; wal.finalManifest = null; }
  return L.assertMainnetV8ReleaseWalContents(rehashWal(wal));
}
function outcomeInput(row, status, observation) {
  return { ...row.input, status, observation };
}
function appendOutcome(wal, row, status, observation) {
  return appendFixtureEvent(wal, { ordinal: row.input.ordinal, status,
    evidence: L.buildMainnetV8OutcomeEvidence(outcomeInput(row, status, observation)) });
}
function finalityDetails(row) {
  const certificate = row.input.observation.certificate;
  return { finalityEvidence: certificate.finalityEvidence, finalityEvidenceSha256: certificate.finalityEvidenceSha256 };
}

test('one canonical68-event history covers8publications,4bootstrap,market and unsigned final export', async () => {
  assert.equal(f.wal.events.length, 68);
  assert.equal(f.wal.revision, '68');
  const ready = f.wal.events.filter(row => row.status === 'READY');
  assert.deepEqual(ready.map(row => row.ordinal), L.MAINNET_V8_RELEASE_STEPS.map(row => row.ordinal));
  for (const row of ready.slice(0, -1)) {
    const prefix = before(row.ordinal, 'READY');
    // Both actual validators are required; WAL validation alone is not the
    // compiler's TransactionData byte-graph comparison.
    assertMainnetV8ReadyWalContext({ wal: prefix, ordinal: row.ordinal, readyArtifact: row.evidence.readyArtifact });
    await assertMainnetV8TransactionMatchesReady({ plan: f.plan, ordinal: row.ordinal,
      readyArtifact: row.evidence.readyArtifact, unsignedEnvelope: row.evidence.unsignedEnvelope });
  }
  assert.equal(ready.at(-1).evidence.unsignedEnvelope, null);
  assert.equal(f.wal.events.filter(row => row.ordinal === '13').some(row => row.status === 'SIGNED'), false);
  assert.equal(nextMainnetV8FinalizedAction(f.wal.events.at(-1)).kind, 'COMPLETE');
  assert.deepEqual(L.assertMainnetV8ReleaseWalContents(JSON.parse(L.canonicalMainnetV8Json(f.wal))), f.wal);
  assert.deepEqual(L.assertMainnetV8ReleaseWal(f.wal), f.wal);
});

test('same completed history exports exact paired configs without enabling product writes or decryption', () => {
  assert.deepEqual(assertMainnetV8ExportConfigContents({ wal: f.wal, bytes: f.bytes }), f.config);
  const receive = JSON.parse(f.config.soulidityEnvironment.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON);
  assert.equal(receive.equipmentWritesEnabled, false); assert.equal(receive.marketWritesEnabled, false);
  assert.equal(f.config.protectedDecryptionReady, false);
  assert.equal(f.config.marketActivation.primaryEnabled, true);
  assert.equal(f.config.marketActivation.secondaryEnabled, true);
  assert.equal(f.config.packageIds.soulidity, f.config.soulidityEnvironment.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID);
});

for (const row of cases) {
  const ordinal = row.input.ordinal;
  test(`ordinal${ordinal} unknown outcome recovers by query with identical signed bytes and one success`, () => {
    let wal = before(ordinal, 'OUTCOME_PENDING');
    const error = { code: 'DEADLINE_EXCEEDED', message: 'offline timeout fixture',
      service: 'sui.rpc.v2.LedgerService', method: 'GetTransaction', details: {} };
    wal = appendOutcome(wal, row, 'OUTCOME_UNKNOWN', { error, errorSha256: hash(error) });
    wal = appendOutcome(wal, row, 'OUTCOME_PENDING', { kind: 'QUERY_INTENT', details: {} });
    wal = appendOutcome(wal, row, 'FINALIZED_SUCCESS_PENDING_READBACK', finalityDetails(row));
    wal = appendFixtureEvent(wal, { ordinal, status: 'FINALIZED_SUCCESS', evidence: row.outcome });
    assert.equal(wal.events.filter(event => event.ordinal === ordinal && event.status === 'SIGNED').length, 1);
    assert.equal(wal.events.filter(event => event.ordinal === ordinal && event.status === 'FINALIZED_SUCCESS').length, 1);
    for (const event of wal.events.filter(event => event.ordinal === ordinal && event.evidence.signedArtifact)) {
      assert.deepEqual(event.evidence.signedArtifact, row.input.signedArtifact);
    }
  });
  test(`ordinal${ordinal} known readback incident recovers only its already-finalized transaction`, () => {
    let wal = before(ordinal, 'FINALIZED_SUCCESS_PENDING_READBACK');
    const incident = { code: Number(ordinal) < 8 ? 'MAINNET_V8_CREATED_OUTPUT_INVALID'
      : ordinal === '12' ? 'NATIVE_SOUL_MARKET_ACTIVATION_INVALID' : 'NATIVE_SOUL_BOOTSTRAP_HISTORY_INVALID',
    message: 'offline recoverable readback fixture', details: {} };
    wal = appendOutcome(wal, row, 'INCIDENT_STOPPED', { ...finalityDetails(row), incident, incidentSha256: hash(incident) });
    const altered = clone(finalityDetails(row));
    altered.finalityEvidence.checkpoint = String(BigInt(altered.finalityEvidence.checkpoint) + 1n);
    altered.finalityEvidenceSha256 = hash(altered.finalityEvidence);
    assert.throws(() => appendOutcome(wal, row, 'FINALIZED_SUCCESS_PENDING_READBACK', altered),
      { code: 'MAINNET_V8_WAL_TRANSITION_INVALID' });
    wal = appendOutcome(wal, row, 'FINALIZED_SUCCESS_PENDING_READBACK', finalityDetails(row));
    wal = appendFixtureEvent(wal, { ordinal, status: 'FINALIZED_SUCCESS', evidence: row.outcome });
    assert.equal(wal.events.at(-1).evidence.digest, row.input.digest);
    assert.equal(wal.events.filter(event => event.ordinal === ordinal && event.status === 'SIGNED').length, 1);
  });
  test(`ordinal${ordinal} rehashed success cannot replace its pending finality certificate`, () => {
    const wal = before(ordinal, 'FINALIZED_SUCCESS_PENDING_READBACK');
    const input = clone(row.input), certificate = input.observation.certificate;
    certificate.finalityEvidence.checkpoint = String(BigInt(certificate.finalityEvidence.checkpoint) + 1n);
    certificate.finalityEvidenceSha256 = hash(certificate.finalityEvidence);
    input.observation.certificateSha256 = hash(certificate);
    const evidence = L.buildMainnetV8OutcomeEvidence(input);
    assert.throws(() => appendFixtureEvent(wal, { ordinal, status: 'FINALIZED_SUCCESS', evidence }),
      error => error.code === 'MAINNET_V8_WAL_INVALID' && /exact pending-readback finality bytes/.test(error.message));
  });
}

test('dropping market activation cannot promote an otherwise rehashed final export', () => {
  const wal = clone(f.wal);
  wal.events = wal.events.filter(row => row.ordinal !== '12');
  assert.throws(() => L.assertMainnetV8ReleaseWalContents(rehashWal(wal)),
    error => error.code?.startsWith('MAINNET_V8_'));
});

for (const field of ['moduleMapSha256', 'objectBcsSha256']) test(`final package verification binds ${field} to publication evidence after all rehashes`, () => {
  const wal = before('13', 'READY');
  const certificate = clone(f.verify.outcome.observation.details.certificate);
  certificate.verification.packageVerification.packages[0][field] = 'f'.repeat(64);
  certificate.verification.packageVerificationSha256 = hash(certificate.verification.packageVerification);
  certificate.verificationSha256 = hash(certificate.verification);
  const outcome = L.buildMainnetV8OutcomeEvidence({ status: 'FINALIZED_SUCCESS', ordinal: '13', attempt: '0',
    readyArtifactSha256: f.verify.ready.readyArtifactSha256, signedArtifact: null, signedArtifactSha256: null,
    digest: null, observation: { certificate, certificateSha256: hash(certificate) } });
  assert.throws(() => appendFixtureEvent(wal, { ordinal: '13', status: 'FINALIZED_SUCCESS', evidence: outcome }),
    error => error.code === 'MAINNET_V8_WAL_INVALID');
});
