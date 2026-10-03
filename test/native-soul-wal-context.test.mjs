import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWalTransition as transition, MAINNET_V8_RELEASE_STEPS as steps,
  assertStageReadyWalContext, assertStageSuccessContext,
  nativeSoulBootstrapInputFromStageData, sha256MainnetV8Json,
  deriveMainnetV8MarketActivationWalContext,
} from '../scripts/mainnet-v8-release-lib.mjs';
import { deriveNativeSoulBootstrapStageData } from '../scripts/native-soul-bootstrap-context.mjs';
import { contextFixture } from './fixtures/native-soul-bootstrap-context-fixture.mjs';
import { nativeSoulMarketActivationFixture } from './fixtures/native-soul-market-activation-fixture.mjs';

const hash = n => String(n).repeat(64);
function event(ordinal, status, revision = '1', intent = null) {
  return { ordinal, status, revision, attempt: '0', eventSha256: hash(1), previousEventSha256: hash(0),
    evidence: { observation: { kind: intent, details: {} } } };
}
function next(previous, ordinal, status, intent = null) {
  return { ...event(ordinal, status, String(BigInt(previous.revision) + 1n), intent),
    previousEventSha256: previous.eventSha256 };
}
const invalid = { code: 'MAINNET_V8_WAL_TRANSITION_INVALID' };

// These exercise the actual transition validator used by the public parser;
// row evidence/finality and source/context are separate mandatory validators.
test('single release transition graph retains all14 stages', () => {
  assert.equal(steps.length, 14);
});
test('first event is exclusively Core0 attempt0 READY with zero predecessor', () => {
  transition(null, event('0', 'READY'));
  for (const changes of [{ ordinal: '1' }, { status: 'SIGNED' }, { attempt: '1' },
    { revision: '2' }, { previousEventSha256: hash(2) }]) {
    assert.throws(() => transition(null, { ...event('0', 'READY'), ...changes }), invalid);
  }
});
for (const step of steps.filter(s => s.kind !== 'VERIFY_AND_EXPORT')) {
  test(`${step.ordinal} ${step.kind}: READY must sign then query before any broadcast`, () => {
    const ready = event(step.ordinal, 'READY'), signed = next(ready, step.ordinal, 'SIGNED');
    transition(ready, signed);
    const query = next(signed, step.ordinal, 'OUTCOME_PENDING', 'QUERY_INTENT'); transition(signed, query);
    transition(query, next(query, step.ordinal, 'OUTCOME_PENDING', 'BROADCAST_INTENT'));
    assert.throws(() => transition(ready, next(ready, step.ordinal, 'FINALIZED_SUCCESS')), invalid);
    assert.throws(() => transition(signed, next(signed, step.ordinal, 'OUTCOME_PENDING', 'BROADCAST_INTENT')), invalid);
  });
}
for (const ordinal of ['0', '1', '2', '3', '4', '5', '6', '8', '9', '10', '11', '12']) {
  test(`finalized ordinal${ordinal} advances only to the immediate next READY`, () => {
    const previous = event(ordinal, 'FINALIZED_SUCCESS'), wanted = String(BigInt(ordinal) + 1n);
    transition(previous, next(previous, wanted, 'READY'));
    assert.throws(() => transition(previous, next(previous, String(BigInt(ordinal) + 2n), 'READY')), invalid);
    assert.throws(() => transition(previous, next(previous, ordinal, 'READY')), invalid);
  });
}
test('Release7 must seal all8 publications before INIT8; Soulidity6 cannot seal', () => {
  const completed = event('7', 'FINALIZED_SUCCESS'), sealed = next(completed, '7', 'FINAL_MANIFEST_SEALED');
  transition(completed, sealed); transition(sealed, next(sealed, '8', 'READY'));
  assert.throws(() => transition(completed, next(completed, '8', 'READY')), invalid);
  const soulidity = event('6', 'FINALIZED_SUCCESS');
  assert.throws(() => transition(soulidity, next(soulidity, '6', 'FINAL_MANIFEST_SEALED')), invalid);
  assert.throws(() => transition(sealed, next(sealed, '7', 'READY')), invalid);
});
test('VERIFY13 finishes without signature and cannot advance beyond the schedule', () => {
  const ready = event('13', 'READY'), complete = next(ready, '13', 'FINALIZED_SUCCESS');
  transition(ready, complete); transition(ready, next(ready, '13', 'INCIDENT_STOPPED'));
  assert.throws(() => transition(ready, next(ready, '13', 'SIGNED')), invalid);
  assert.throws(() => transition(complete, next(complete, '14', 'READY')), invalid);
});
for (const status of ['SIGNED', 'OUTCOME_UNKNOWN', 'BROADCAST_ACCEPTED', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND']) {
  test(`${status} cannot advance or rebuild a fresh native packet`, () => {
    const previous = event('9', status);
    assert.throws(() => transition(previous, next(previous, '10', 'READY')), invalid);
    const fresh = next(previous, '9', 'READY'); fresh.attempt = '1';
    assert.throws(() => transition(previous, fresh), invalid);
  });
}
test('unknown submission may query exact cursor; revision/hash/cursor drift reject', () => {
  const previous = event('9', 'OUTCOME_UNKNOWN'), query = next(previous, '9', 'OUTCOME_PENDING', 'QUERY_INTENT');
  transition(previous, query);
  for (const changes of [{ ordinal: '10' }, { revision: '5' }, { previousEventSha256: hash(2) }, { attempt: '1' }]) {
    assert.throws(() => transition(previous, { ...query, ...changes }), invalid);
  }
});
test('typed native readback incident can recover only the identical finalized transaction evidence', () => {
  const previous = event('10', 'INCIDENT_STOPPED');
  const finality = { fixture: 'already validated finality certificate' };
  previous.evidence.observation.details = { finalityEvidence: finality, finalityEvidenceSha256: hash(3),
    incident: { code: 'NATIVE_SOUL_BOOTSTRAP_HISTORY_INVALID', message: 'exact history mismatch', details: {} } };
  const current = next(previous, '10', 'FINALIZED_SUCCESS_PENDING_READBACK');
  current.evidence.observation.details = { finalityEvidence: structuredClone(finality), finalityEvidenceSha256: hash(3) };
  transition(previous, current);
  current.evidence.observation.details.finalityEvidenceSha256 = hash(4);
  assert.throws(() => transition(previous, current), invalid);
  current.evidence.observation.details.finalityEvidenceSha256 = hash(3);
  current.evidence.observation.details.finalityEvidence.fixture = 'different transaction';
  assert.throws(() => transition(previous, current), invalid);
  current.evidence.observation.details.finalityEvidence = finality;
  previous.evidence.observation.details.incident.code = 'MAKER_V8_CORE_ARTIFACT_UNMEASURED';
  assert.throws(() => transition(previous, current), invalid);
});

function context(stage) {
  const f = contextFixture(stage), projected = deriveNativeSoulBootstrapStageData(f);
  const ordinal = steps.find(s => s.kind === stage).ordinal;
  const successful = new Map(Object.entries(f.priorReadbacks).map(([kind, readback]) => [
    kind === 'core' ? '0' : steps.find(s => s.kind === kind).ordinal,
    { details: { certificate: { readback, readbackSha256: sha256MainnetV8Json(readback) } } },
  ]));
  const wal = { plan: f.plan, releaseId: f.manifest.releaseId, finalManifest: f.manifest };
  const ready = { readyArtifact: { kind: stage, stageData: structuredClone(projected.stageData) } };
  const readyEvent = { ...event(ordinal, 'READY'), evidence: ready };
  // This is the context projection boundary, not another fabricated finality
  // proof. Complete Object/effects/signature checks are exercised separately by
  // native-stage-ready actual outcome+WAL-evidence tests.
  const readback = { schema: 'native-soul-bootstrap-history-v1', stage,
    input: nativeSoulBootstrapInputFromStageData(stage, projected.stageData),
    priorObjects: structuredClone(projected.priorObjects), objects: {}, consensusObjects: {} };
  const success = { ...event(ordinal, 'FINALIZED_SUCCESS'),
    evidence: { observation: { details: { certificate: { readback } } } } };
  return { f, projected, ordinal, successful, wal, ready, readyEvent, success, readback };
}
for (const { kind: stage } of steps.filter(s => ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'].includes(s.kind))) {
  test(`${stage}: actual READY/success context shares exact certified-predecessor derivation`, () => {
    const c = context(stage), before = structuredClone(c);
    assertStageReadyWalContext(c.readyEvent, c.wal, c.f.manifest, c.successful);
    assertStageSuccessContext(c.success, c.ready, c.wal, c.f.manifest, c.successful);
    assert.deepEqual(c, before);
  });
  test(`${stage}: canonical but different READY owned ref cannot replace certified history`, () => {
    const c = context(stage); c.ready.readyArtifact.stageData.protocolAdminCap.version = '999';
    assert.throws(() => assertStageReadyWalContext(c.readyEvent, c.wal, c.f.manifest, c.successful));
    assert.throws(() => assertStageSuccessContext(c.success, c.ready, c.wal, c.f.manifest, c.successful));
  });
  test(`${stage}: success input and predecessor Object packet cannot self-report alternative history`, () => {
    const c = context(stage);
    c.readback.input = structuredClone(c.readback.input); c.readback.input.protocolAdminCap.version = '999';
    assert.throws(() => assertStageSuccessContext(c.success, c.ready, c.wal, c.f.manifest, c.successful), /differs from READY/);
    c.readback.input = nativeSoulBootstrapInputFromStageData(stage, c.projected.stageData);
    c.readback.priorObjects.protocolAdmin.reference.version = '999';
    assert.throws(() => assertStageSuccessContext(c.success, c.ready, c.wal, c.f.manifest, c.successful), /exact predecessor/);
  });
  test(`${stage}: missing Core or nearest native predecessor and absent seal reject`, () => {
    const c = context(stage);
    assert.throws(() => assertStageReadyWalContext(c.readyEvent, c.wal, null, c.successful));
    const missing = new Map(c.successful); missing.delete('0');
    assert.throws(() => assertStageReadyWalContext(c.readyEvent, c.wal, c.f.manifest, missing), /Core/);
    if (stage !== 'INITIALIZE_PROTOCOL') {
      const prior = new Map(c.successful); prior.delete(String(BigInt(c.ordinal) - 1n));
      assert.throws(() => assertStageReadyWalContext(c.readyEvent, c.wal, c.f.manifest, prior), /predecessor/);
    }
  });
}
test('SETUP context rejects manifest-extraneous eighth Catalog commitment after normalizing other data', () => {
  const c = context('SETUP_RELEASE');
  c.ready.readyArtifact.stageData.commitments.soulidity = structuredClone(c.ready.readyArtifact.stageData.commitments.release);
  assert.throws(() => assertStageReadyWalContext(c.readyEvent, c.wal, c.f.manifest, c.successful));
});
test('BEGIN and FINALIZE cannot consume a freshly self-reported replacement instead of sealed setup history', () => {
  for (const stage of ['BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP']) {
    const c = context(stage); c.ready.readyArtifact.stageData.replacement.version = '999';
    assert.throws(() => assertStageReadyWalContext(c.readyEvent, c.wal, c.f.manifest, c.successful));
  }
});
test('publication context keeps eight source roles and rejects missing prefix or known self/future targets without a guessed role DAG', () => {
  const c = context('INITIALIZE_PROTOCOL');
  const all = new Map(c.f.manifest.packages.map((row, i) => [String(i), { details: { certificate: {
    readback: { package: { reference: { objectId: row.packageId } } },
  } } }]));
  for (const ordinal of ['6', '7']) {
    const role = steps[Number(ordinal)].role;
    const e = event(ordinal, 'READY'); e.evidence = { readyArtifact: { role,
      packageArtifact: { role }, dependencies: [c.f.manifest.packages[0].packageId] } };
    assertStageReadyWalContext(e, c.wal, null, all);
    e.evidence.readyArtifact.dependencies.push(c.f.manifest.packages[Number(ordinal)].packageId);
    assert.throws(() => assertStageReadyWalContext(e, c.wal, null, all), /future native target/);
    e.evidence.readyArtifact.dependencies.pop(); const missing = new Map(all); missing.delete('1');
    assert.throws(() => assertStageReadyWalContext(e, c.wal, null, missing), /incomplete finalized native prefix/);
    e.evidence.readyArtifact.role = 'seal';
    assert.throws(() => assertStageReadyWalContext(e, c.wal, null, all), /source-plan role/);
  }
});
test('VERIFY13 READY and success require market12 as well as FINALIZE11 full history', () => {
  const c = context('FINALIZE_BOOTSTRAP'), readback = c.readback;
  c.successful.set('11', { details: { certificate: { readback, readbackSha256: sha256MainnetV8Json(readback) } } });
  const marketReadback = { schema: 'native-soul-market-activation-history-v1', stage: 'ACTIVATE_SOULIDITY_MARKET' };
  c.successful.set('12', { details: { certificate: { readback: marketReadback, readbackSha256: sha256MainnetV8Json(marketReadback) } } });
  const stageData = { releaseId: c.wal.releaseId, finalManifestSha256: sha256MainnetV8Json(c.f.manifest),
    bootstrapCertificateSha256: sha256MainnetV8Json(readback), marketActivationCertificateSha256: sha256MainnetV8Json(marketReadback),
    exportFilename: 'native-release.json' };
  const ready = { readyArtifact: { kind: 'VERIFY_AND_EXPORT', stageData } };
  const readyEvent = { ...event('13', 'READY'), evidence: ready };
  const verification = { executionPlanId: c.f.plan.executionPlanId, releaseId: c.wal.releaseId,
    finalManifestSha256: stageData.finalManifestSha256,
    runtimeAttestationSha256: sha256MainnetV8Json(readback),
    marketActivationCertificateSha256: sha256MainnetV8Json(marketReadback),
    packageVerification: { executionPlanId: c.f.plan.executionPlanId, releaseId: c.wal.releaseId,
      packages: structuredClone(c.f.manifest.packages) } };
  c.wal.executionPlanId = c.f.plan.executionPlanId;
  const success = { ...event('13', 'FINALIZED_SUCCESS'), evidence: { observation: { details: {
    certificate: { verification, exports: { filename: stageData.exportFilename } },
  } } } };
  assertStageReadyWalContext(readyEvent, c.wal, c.f.manifest, c.successful);
  assertStageSuccessContext(success, ready, c.wal, c.f.manifest, c.successful);
  const missing = new Map(c.successful); missing.delete('11');
  assert.throws(() => assertStageReadyWalContext(readyEvent, c.wal, c.f.manifest, missing), /sealed native bootstrap/);
  const noMarket = new Map(c.successful); noMarket.delete('12');
  assert.throws(() => assertStageReadyWalContext(readyEvent, c.wal, c.f.manifest, noMarket), /sealed native bootstrap/);
  assert.throws(() => assertStageSuccessContext(success, ready, c.wal, c.f.manifest, noMarket), /sealed bootstrap predecessor/);
  verification.runtimeAttestationSha256 = sha256MainnetV8Json({ attestation: 'retired' });
  assert.throws(() => assertStageSuccessContext(success, ready, c.wal, c.f.manifest, c.successful), /sealed release\/bootstrap/);
  verification.runtimeAttestationSha256 = sha256MainnetV8Json(readback);
  verification.packageVerification.packages[7].packageId = verification.packageVerification.packages[6].packageId;
  assert.throws(() => assertStageSuccessContext(success, ready, c.wal, c.f.manifest, c.successful), /sealed release\/bootstrap/);
});

function marketContext() {
  const c = context('FINALIZE_BOOTSTRAP'), row = c.f.manifest.packages[6];
  const f = nativeSoulMarketActivationFixture({ packageId: row.packageId, sender: c.f.plan.sender,
    previousTransaction: row.publishDigest });
  const objects = Object.fromEntries(Object.entries(f.priorObjects).map(([kind, object]) => [kind, {
    ...structuredClone(object), owner: object.owner.kind === 'shared'
      ? { Shared: { initial_shared_version: object.owner.initialSharedVersion } }
      : { AddressOwner: object.owner.address },
  }]));
  const publication = { schemaVersion: 'animacraft.mainnet-v8-release-runner.v1', kind: 'PACKAGE_PUBLISH_CERTIFICATE',
    role: 'soulidity', transactionDigest: row.publishDigest,
    package: { reference: { objectId: row.packageId, version: row.packageVersion, digest: row.packageDigest } },
    soulidityInitialization: { packageId: row.packageId, objects } };
  // The same certified-map boundary used by the runner. Publication finality
  // is tested by its own actual certificate entry; these are not mock caps.
  const successful = new Map([
    ['6', { details: { certificate: { readback: publication } } }],
    ['11', { details: { certificate: { readback: c.readback } } }],
  ]);
  const ready = { readyArtifact: { kind: 'ACTIVATE_SOULIDITY_MARKET', stageData: structuredClone(f.input) } };
  const readyEvent = { ...event('12', 'READY'), evidence: ready };
  const success = { ...event('12', 'FINALIZED_SUCCESS'), evidence: { observation: { details: { certificate: { readback: f.journal } } } } };
  return { c, f, successful, publication, ready, readyEvent, success };
}
test('market12 actual READY/success context binds SO6 full objects, sealed package identity and FINAL11', () => {
  const m = marketContext();
  const observed = () => ({ c: m.c, successful: m.successful, ready: m.ready, readyEvent: m.readyEvent, success: m.success });
  const before = structuredClone(observed());
  const derived = deriveMainnetV8MarketActivationWalContext({ plan: m.c.wal.plan,
    manifest: m.c.f.manifest, successfulCertificates: m.successful });
  assert.deepEqual(derived, { stageData: m.f.input, priorObjects: m.f.priorObjects });
  assert.ok(Object.isFrozen(derived) && Object.isFrozen(derived.priorObjects.marketAdminCapV2.reference));
  assertStageReadyWalContext(m.readyEvent, m.c.wal, m.c.f.manifest, m.successful);
  assertStageSuccessContext(m.success, m.ready, m.c.wal, m.c.f.manifest, m.successful);
  assert.deepEqual(observed(), before);
});
for (const [name, mutate] of Object.entries({
  'missing SO publication': m => m.successful.delete('6'),
  'missing FINAL11': m => m.successful.delete('11'),
  'wrong SO package': m => { m.publication.package.reference.objectId = `0x${'9'.repeat(64)}`; },
  'wrong SO digest': m => { m.publication.package.reference.digest = m.publication.transactionDigest; },
  'wrong SO version': m => { m.publication.package.reference.version = '999'; },
  'wrong SO publish digest': m => { m.publication.transactionDigest = m.publication.package.reference.digest; },
  'wrong prior transaction': m => { m.publication.soulidityInitialization.objects.marketAdminCapV2.previousTransaction = m.publication.package.reference.digest; },
  'missing admin full BCS': m => { delete m.publication.soulidityInitialization.objects.marketAdminCapV2.objectBcsBase64; },
  'address owner passed as object owner': m => { const o = m.publication.soulidityInitialization.objects.marketAdminCapV2; o.owner = { ObjectOwner: o.owner.AddressOwner }; },
})) test(`market context rejects ${name} before READY or success acceptance`, () => {
  const m = marketContext(); mutate(m);
  assert.throws(() => assertStageReadyWalContext(m.readyEvent, m.c.wal, m.c.f.manifest, m.successful));
  assert.throws(() => assertStageSuccessContext(m.success, m.ready, m.c.wal, m.c.f.manifest, m.successful));
});
test('market success cannot substitute READY or historical prior object packets', () => {
  const m = marketContext(); m.ready.readyArtifact.stageData.marketAdminCap.version = '999';
  assert.throws(() => assertStageReadyWalContext(m.readyEvent, m.c.wal, m.c.f.manifest, m.successful));
  assert.throws(() => assertStageSuccessContext(m.success, m.ready, m.c.wal, m.c.f.manifest, m.successful));
  m.ready.readyArtifact.stageData = structuredClone(m.f.input);
  m.f.journal.input.marketConfig.initialSharedVersion = '999';
  assert.throws(() => assertStageSuccessContext(m.success, m.ready, m.c.wal, m.c.f.manifest, m.successful));
  m.f.journal.input = structuredClone(m.f.input);
  m.f.journal.priorObjects = structuredClone(m.f.priorObjects);
  m.f.journal.priorObjects.marketAdminCapV2.reference.version = '999';
  assert.throws(() => assertStageSuccessContext(m.success, m.ready, m.c.wal, m.c.f.manifest, m.successful));
});
