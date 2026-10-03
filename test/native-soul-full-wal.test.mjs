import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS } from '../scripts/native-soul-external-publications.mjs';
import { nativeSoulPublicationWalFixture, appendFixtureEvent } from './fixtures/native-soul-full-wal-fixture.mjs';

const fixture = nativeSoulPublicationWalFixture();
const hashWithout = (value, key) => { const clone = structuredClone(value); delete clone[key]; return L.sha256MainnetV8Json(clone); };
function rehashWal(wal) {
  let previous = '0'.repeat(64);
  for (const [i, event] of wal.events.entries()) {
    event.revision = String(i + 1); event.previousEventSha256 = previous;
    event.eventSha256 = hashWithout(event, 'eventSha256'); previous = event.eventSha256;
  }
  wal.revision = String(wal.events.length); wal.headEventSha256 = previous;
  wal.walSha256 = hashWithout(wal, 'walSha256');
  return wal;
}
function prefix(wal, length) {
  const value = structuredClone(wal); value.events = value.events.slice(0, length);
  value.releaseId = null; value.finalManifest = null; return rehashWal(value);
}

test('eight actual publication outcomes form one cold-replayable sealed WAL prefix, not a completed fourteen-stage release', async () => {
  const { plan, manifest, wal, publications } = await fixture;
  assert.equal(plan.steps.length, 14);
  assert.deepEqual(publications.map(p => p.role), L.MAINNET_V8_PUBLISH_ORDER);
  assert.equal(wal.revision, '41'); assert.equal(wal.events.at(-1).ordinal, '7');
  assert.equal(wal.events.at(-1).status, 'FINAL_MANIFEST_SEALED');
  assert.equal(new Set(publications.map(p => p.input.digest)).size, 8);
  assert.equal(new Set(manifest.packages.flatMap(p => [p.packageId, p.upgradeCapId])).size, 16);
  assert.equal(manifest.packages[6].role, 'soulidity'); assert.equal(manifest.packages[7].role, 'release');
  assert.deepEqual(wal.finalManifest, manifest);
  assert.doesNotThrow(() => L.assertMainnetV8ReleaseWalContents(JSON.parse(JSON.stringify(wal))));
  assert.deepEqual(Object.keys(L.mainnetV8CatalogCommitmentsFromFinalManifest(manifest, plan)), L.MAINNET_V8_ROLE_ORDER);
  assert.equal(wal.events.some(e => BigInt(e.ordinal) >= 8n), false);
});

test('each publication retains exact READY, signed packet, query-first finality and actual reader certificate', async () => {
  const { wal, publications } = await fixture;
  for (const [i, p] of publications.entries()) {
    const events = wal.events.slice(i * 5, i * 5 + 5);
    assert.deepEqual(events.map(e => e.status), ['READY', 'SIGNED', 'OUTCOME_PENDING', 'FINALIZED_SUCCESS_PENDING_READBACK', 'FINALIZED_SUCCESS']);
    assert.equal(events[2].evidence.observation.kind, 'QUERY_INTENT');
    assert.equal(events[0].evidence.unsignedEnvelope.transactionBase64, p.input.signedArtifact.transactionBase64);
    assert.equal(events[4].evidence.observation.details.certificate.finalityEvidence.transactionBase64, p.input.signedArtifact.transactionBase64);
    assert.deepEqual(events[4].evidence, p.outcome);
    if (i) assert.deepEqual(p.readyArtifact.predecessorReadback.certificate, publications[i - 1].input.observation);
    else assert.equal(p.readyArtifact.predecessorReadback, null);
  }
});

test('every published package archives the fixed six external versions, including upgraded Kiosk and Walrus', async () => {
  const { publications } = await fixture;
  for (const p of publications) {
    const pkg = p.input.observation.certificate.readback.package;
    assert.deepEqual(p.readyArtifact.dependencies, NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(x => x.publishedAt).sort());
    for (const pin of NATIVE_SOUL_EXTERNAL_PUBLICATIONS) {
      const edge = pkg.linkage.find(e => e.originalId === pin.originalId);
      assert.deepEqual(edge, { originalId: pin.originalId, upgradedId: pin.publishedAt, upgradedVersion: pin.version });
      const evidence = pkg.dependencyPackages.find(e => e.reference.objectId === pin.publishedAt);
      assert.equal(evidence.reference.version, pin.version);
      assert.ok(evidence.objectBcsBase64.length > 0);
    }
  }
});

test('rehashing a valid but wrong preceding certificate cannot connect a READY to another publication', async () => {
  const { wal, publications } = await fixture;
  const prior = prefix(wal, 10), p = publications[2];
  const artifact = structuredClone(p.readyArtifact);
  artifact.predecessorReadback.certificate = structuredClone(publications[0].input.observation);
  artifact.predecessorReadback.certificateSha256 = L.sha256MainnetV8Json(artifact.predecessorReadback.certificate);
  const evidence = L.buildMainnetV8ReadyEvidence({ ordinal: '2', readyArtifact: artifact, unsignedEnvelope: p.unsignedEnvelope });
  assert.throws(() => appendFixtureEvent(prior, { ordinal: '2', status: 'READY', evidence }),
    e => e.code === 'MAINNET_V8_WAL_INVALID' && /preceding finalized certificate/i.test(e.message));
});

test('a fully rehashed unique package ID substitution still fails manifest-to-publication identity', async () => {
  const { plan, wal, manifest } = await fixture;
  const packages = structuredClone(manifest.packages);
  packages[6].packageId = `0x${'999999'.padStart(64, '0')}`;
  const substituted = L.buildMainnetV8FinalManifestContents({ plan, packages });
  const evidence = L.buildMainnetV8ManifestEvidenceContents({ plan, finalManifest: substituted });
  assert.throws(() => appendFixtureEvent(prefix(wal, 40), { ordinal: '7', status: 'FINAL_MANIFEST_SEALED', evidence }),
    e => e.code === 'MAINNET_V8_FINAL_MANIFEST_INVALID' && /differs from finalized evidence/i.test(e.message));
});

test('package/cap alias remains invalid after all manifest and WAL hashes are recalculated', async () => {
  const { wal } = await fixture;
  const changed = structuredClone(wal);
  changed.finalManifest.packages[6].packageId = changed.finalManifest.packages[0].upgradeCapId;
  changed.finalManifest.releaseId = hashWithout(changed.finalManifest, 'releaseId');
  changed.releaseId = changed.finalManifest.releaseId;
  const seal = changed.events.at(-1);
  seal.releaseId = changed.releaseId; seal.evidence.releaseId = changed.releaseId;
  seal.evidence.finalManifest = structuredClone(changed.finalManifest);
  assert.throws(() => L.assertMainnetV8ReleaseWalContents(rehashWal(changed)),
    e => e.code === 'MAINNET_V8_FINAL_MANIFEST_INVALID' && /unique/i.test(e.message));
});

test('a missing Soulidity publication cannot be hidden by repairing every outer hash', async () => {
  const { wal } = await fixture;
  const changed = structuredClone(wal);
  changed.events.splice(30, 5);
  assert.throws(() => L.assertMainnetV8ReleaseWalContents(rehashWal(changed)),
    e => e.code === 'MAINNET_V8_WAL_TRANSITION_INVALID');
});

test('stale revision and stale head reject append without mutating the retained prefix', async () => {
  const { wal, publications } = await fixture;
  const initial = prefix(wal, 1), before = JSON.stringify(initial);
  const evidence = L.buildMainnetV8SignedEvidence(publications[0].input);
  for (const mismatch of [{ expectedRevision: '2', expectedHeadEventSha256: initial.headEventSha256 },
    { expectedRevision: initial.revision, expectedHeadEventSha256: 'f'.repeat(64) }]) {
    assert.throws(() => L.appendMainnetV8WalContents(initial, { ...mismatch, ordinal: '0', attempt: '0',
      status: 'SIGNED', evidence, recordedAt: '2026-09-09T00:00:01.000Z' }),
    e => e.code === 'MAINNET_V8_WAL_CAS_MISMATCH');
    assert.equal(JSON.stringify(initial), before);
  }
});
