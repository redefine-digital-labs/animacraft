import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { nativeSoulCompletedWalFixture } from './fixtures/native-soul-completed-wal-fixture.mjs';
import { appendFixtureEvent } from './fixtures/native-soul-full-wal-fixture.mjs';

// The original FS test still calls the guarded filesystem APIs and remains
// separate. These offline tests exercise VERIFY incident semantics against the
// same fully connected current 14-stage evidence, not fsync or valid signatures.
const fixture = nativeSoulCompletedWalFixture();
function beforeVerifySuccess(f) {
  const wal = structuredClone(f.wal);
  wal.events.pop(); wal.revision = String(wal.events.length);
  wal.headEventSha256 = wal.events.at(-1).eventSha256;
  delete wal.walSha256; wal.walSha256 = L.sha256MainnetV8Json(wal);
  L.assertMainnetV8ReleaseWalContents(wal);
  return wal;
}
function incidentFor(f) {
  const data = f.verify.ready.readyArtifact.stageData;
  return { code: 'MAINNET_V8_VERIFY_MISMATCH', message: 'Cold verification differs from sealed release evidence.',
    details: { executionPlanId: f.wal.executionPlanId, releaseId: data.releaseId,
      finalManifestSha256: data.finalManifestSha256, bootstrapCertificateSha256: data.bootstrapCertificateSha256,
      marketActivationCertificateSha256: data.marketActivationCertificateSha256,
      check: 'runtime-attestation', expectedSha256: L.sha256MainnetV8Bytes('expected-runtime-attestation'),
      observedSha256: L.sha256MainnetV8Bytes('observed-runtime-attestation') } };
}
function outcome(f, incident, readyHash = f.verify.ready.readyArtifactSha256) {
  return L.buildMainnetV8OutcomeEvidence({ status: 'INCIDENT_STOPPED', ordinal: '13', attempt: '0',
    readyArtifactSha256: readyHash, signedArtifact: null, signedArtifactSha256: null, digest: null,
    observation: { incident, incidentSha256: L.sha256MainnetV8Json(incident) } });
}
function appendIncident(f, evidence) {
  return appendFixtureEvent(beforeVerifySuccess(f), { ordinal: '13', status: 'INCIDENT_STOPPED', evidence });
}

test('VERIFY13 can stop unsigned after all current native and market certificates, preserving cold replay', async () => {
  const f = await fixture;
  assert.equal(f.wal.events.length, 68);
  assert.doesNotThrow(() => L.assertMainnetV8ReleaseWalContents(f.wal));
  const evidence = outcome(f, incidentFor(f));
  const stopped = appendIncident(f, evidence);
  assert.equal(stopped.events.length, 68); assert.equal(stopped.events.at(-1).ordinal, '13');
  assert.equal(stopped.events.at(-1).status, 'INCIDENT_STOPPED');
  assert.deepEqual(stopped.events.slice(0, -1), f.wal.events.slice(0, -1));
  for (const key of ['signedArtifact', 'signedArtifactSha256', 'digest']) assert.equal(Object.hasOwn(evidence, key), false);
  assert.equal(stopped.events.at(-2).evidence.unsignedEnvelope, null);
  assert.doesNotThrow(() => L.assertMainnetV8ReleaseWalContents(JSON.parse(JSON.stringify(stopped))));
  // The successful unsigned path remains a valid alternative, not an incident.
  assert.equal(f.wal.events.at(-1).status, 'FINALIZED_SUCCESS');
  assert.equal(Object.hasOwn(f.wal.events.at(-1).evidence, 'signedArtifact'), false);
});

for (const key of ['executionPlanId', 'releaseId', 'finalManifestSha256', 'bootstrapCertificateSha256',
  'marketActivationCertificateSha256', 'check', 'expectedSha256', 'observedSha256']) {
  test(`VERIFY incident missing ${key} is rejected after repairing its incident hash`, async () => {
    const f = await fixture, incident = incidentFor(f);
    assert.doesNotThrow(() => outcome(f, incident));
    delete incident.details[key];
    assert.throws(() => outcome(f, incident), e => e.code === 'MAINNET_V8_FIELDS_INVALID');
  });
}

for (const key of ['executionPlanId', 'releaseId', 'finalManifestSha256', 'bootstrapCertificateSha256',
  'marketActivationCertificateSha256']) {
  test(`VERIFY incident rehashed wrong ${key} cannot bind to this completed release`, async () => {
    const f = await fixture, incident = incidentFor(f);
    incident.details[key] = 'f'.repeat(64);
    const evidence = outcome(f, incident); // Well-formed mismatch, but wrong release context.
    assert.throws(() => appendIncident(f, evidence), e => e.code === 'MAINNET_V8_WAL_INVALID'
      && /incident differs from sealed release\/bootstrap inputs/.test(e.message));
  });
}

test('VERIFY incident cannot claim a mismatch when expected and observed hashes are equal', async () => {
  const f = await fixture, incident = incidentFor(f);
  incident.details.observedSha256 = incident.details.expectedSha256;
  assert.throws(() => outcome(f, incident), e => e.code === 'MAINNET_V8_WAL_EVIDENCE_INVALID'
    && /does not record an observed mismatch/.test(e.message));
});

test('VERIFY incident must bind the exact durable READY hash, even with valid release context', async () => {
  const f = await fixture, evidence = outcome(f, incidentFor(f), 'f'.repeat(64));
  assert.throws(() => appendIncident(f, evidence), e => e.code === 'MAINNET_V8_WAL_INVALID'
    && /terminal evidence differs from its READY artifact/.test(e.message));
});

test('VERIFY incident with an extra legacy context field is not silently accepted', async () => {
  const f = await fixture, incident = incidentFor(f);
  incident.details.legacyBootstrapOrdinal = '8';
  assert.throws(() => outcome(f, incident), e => e.code === 'MAINNET_V8_FIELDS_INVALID');
});
