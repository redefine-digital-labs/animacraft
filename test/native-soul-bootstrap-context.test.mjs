import assert from 'node:assert/strict';
import test from 'node:test';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { deriveNativeSoulBootstrapStageData as derive } from '../scripts/native-soul-bootstrap-context.mjs';
import { nativeSoulBootstrapInputFromStageData, mainnetV8CatalogCommitmentsFromFinalManifest,
  sha256MainnetV8Json } from '../scripts/mainnet-v8-release-lib.mjs';
import { NativeSoulBootstrapBcs, NATIVE_SOUL_BOOTSTRAP_USDC_TYPE } from '../scripts/native-soul-bootstrap-readback.mjs';
import { contextFixture } from './fixtures/native-soul-bootstrap-context-fixture.mjs';
import { bootstrapStages, bootstrapId as id } from './fixtures/native-soul-bootstrap-fixture.mjs';
import { rewriteHistoricalObject } from './fixtures/native-soul-bootstrap-history-fixture.mjs';

const invalid = fn => assert.throws(fn);
function rewriteContent(row, kind, change) {
  rewriteHistoricalObject(row, object => {
    const value = NativeSoulBootstrapBcs[kind].parse(new Uint8Array(object.data.Move.contents));
    change(value); object.data.Move.contents = [...NativeSoulBootstrapBcs[kind].serialize(value).toBytes()];
  });
}
for (const stage of bootstrapStages) test(`${stage}: sole schedule and certified latest refs derive actual native input`, () => {
  const f = contextFixture(stage), before = structuredClone(f), result = derive(f);
  const input = nativeSoulBootstrapInputFromStageData(stage, result.stageData);
  assert.equal(Object.keys(input.packageIds).length, 8);
  assert.equal(input.protocolConfig.initialSharedVersion, '7');
  assert.equal(input.protocolAdminCap.version, String(stage === 'INITIALIZE_PROTOCOL' ? 9 : 11 + bootstrapStages.indexOf(stage)));
  assert.deepEqual(input.protocolAdminCap, result.priorObjects.protocolAdmin.reference);
  assert.deepEqual(f, before); assert.ok(Object.isFrozen(result.stageData.packageIds));
  assert.ok(Object.isFrozen(result.priorObjects.protocolAdmin.reference));
  if (stage === 'SETUP_RELEASE') {
    assert.deepEqual(input.commitments, mainnetV8CatalogCommitmentsFromFinalManifest(f.manifest, f.plan));
    assert.equal(Object.keys(input.commitments).length, 7); assert.equal('soulidity' in input.commitments, false);
    assert.equal('keyServerCertificates' in input, false);
    assert.deepEqual(result.stageData.keyServerCertificates, f.keyServerCertificates);
  }
  if (stage === 'FINALIZE_BOOTSTRAP') {
    assert.equal(input.catalog.initialSharedVersion, '13');
    assert.equal(input.bootstrapAdmin.version, '14'); assert.equal(input.replacement.version, '13');
    assert.deepEqual(result.priorObjects.outputConfig, f.priorReadbacks.SETUP_RELEASE.objects.outputConfig);
    assert.deepEqual(result.priorObjects.bootstrapSlot, f.priorReadbacks.BEGIN_BOOTSTRAP.objects.bootstrapSlot);
  }
  f.priorReadbacks.core.protocolAdminCap.reference.version = '100';
  assert.notEqual(result.priorObjects.protocolAdmin.reference.version, '100');
});
for (const stage of bootstrapStages) for (const problem of ['missing-core', 'future', 'unknown', 'external']) {
  test(`${stage}: rejects ${problem} predecessor/context inventory`, () => {
    const f = contextFixture(stage);
    if (problem === 'missing-core') delete f.priorReadbacks.core;
    if (problem === 'future') f.priorReadbacks[stage] = {};
    if (problem === 'unknown') f.priorReadbacks.oldBootstrap = {};
    if (problem === 'external') f.sender = id(444);
    invalid(() => derive(f));
  });
}
for (const stage of bootstrapStages.slice(1)) test(`${stage}: no missing intermediate native predecessor`, () => {
  const f = contextFixture(stage); delete f.priorReadbacks.INITIALIZE_PROTOCOL; invalid(() => derive(f));
});
for (const problem of ['role', 'package', 'transaction', 'digest', 'type', 'owner', 'UID', 'config', 'fresh', 'tail']) {
  test(`Core ${problem} substitution rejects full BCS/identity, never fields JSON authority`, () => {
    const f = contextFixture('INITIALIZE_PROTOCOL'), core = f.priorReadbacks.core, row = core.protocolAdminCap;
    if (problem === 'role') core.role = 'seal';
    if (problem === 'package') core.package.reference.objectId = id(666);
    if (problem === 'transaction') core.transactionDigest = core.protocolAdminCap.reference.digest;
    if (problem === 'digest') row.reference.digest = core.protocolConfig.reference.digest;
    if (problem === 'type') row.type = row.type.replace('ProtocolAdminCapV8', 'OtherAdmin');
    if (problem === 'owner') {
      rewriteHistoricalObject(row, object => { object.owner = { AddressOwner: id(333) }; }); row.owner.AddressOwner = id(333);
    }
    if (problem === 'UID') rewriteContent(row, 'protocolAdmin', value => { value.id = id(334); });
    if (problem === 'config') rewriteContent(row, 'protocolAdmin', value => { value.config_id = id(335); });
    if (problem === 'fresh') rewriteContent(core.protocolConfig, 'protocol', value => { value.enabled = true; });
    if (problem === 'tail') row.objectBcsBase64 = toBase64(new Uint8Array([...fromBase64(row.objectBcsBase64), 0]));
    invalid(() => derive(f));
  });
}
test('fresh Core context requires the actual USDC init value and rejects the retired empty-payment fixture', () => {
  const f = contextFixture('INITIALIZE_PROTOCOL');
  const object = f.priorReadbacks.core.protocolConfig;
  let payment;
  rewriteContent(object, 'protocol', value => { payment = value.payment_coin_type; });
  assert.equal(payment, NATIVE_SOUL_BOOTSTRAP_USDC_TYPE);
  assert.doesNotThrow(() => derive(f));
  rewriteContent(object, 'protocol', value => { value.payment_coin_type = ''; });
  assert.throws(() => derive(f), { code: 'NATIVE_SOUL_BOOTSTRAP_CONTEXT_INVALID' });
});
for (const problem of ['stage', 'schema', 'input-ref', 'input-package', 'prior', 'output-digest', 'output-type', 'relation', 'source-commitment', 'extra-kind']) {
  test(`native predecessor ${problem} cannot redefine derived context`, () => {
    const f = contextFixture('BEGIN_BOOTSTRAP'), r = f.priorReadbacks.SETUP_RELEASE;
    if (problem === 'stage') r.stage = 'BEGIN_BOOTSTRAP';
    if (problem === 'schema') r.schema = 'old';
    if (problem === 'input-ref') r.input.protocolAdminCap.version = '9';
    if (problem === 'input-package') r.input.packageIds.soulidity = id(999);
    if (problem === 'prior') r.priorObjects.protocolAdmin = structuredClone(f.priorReadbacks.INITIALIZE_PROTOCOL.priorObjects.protocolAdmin);
    if (problem === 'output-digest') r.objects.catalog.reference.digest = r.objects.protocol.reference.digest;
    if (problem === 'output-type') r.objects.catalog.type = r.objects.catalog.type.replace('ProductReleaseCatalogV8', 'OtherCatalog');
    if (problem === 'relation') rewriteContent(r.objects.replacement, 'replacement', value => { value.catalog_id = id(888); });
    if (problem === 'source-commitment') rewriteContent(r.objects.catalog, 'catalog', value => { value.binding.bindings[0].source_commitment.fill(99); });
    if (problem === 'extra-kind') r.objects.other = r.objects.protocol;
    invalid(() => derive(f));
  });
}
for (const problem of ['missing-certificates', 'missing-system', 'certificate-id', 'certificate-content', 'system-id', 'system-version', 'extra']) {
  test(`SETUP exact external evidence rejects ${problem}`, () => {
    const f = contextFixture('SETUP_RELEASE');
    if (problem === 'missing-certificates') delete f.keyServerCertificates;
    if (problem === 'missing-system') delete f.walrusSystem;
    if (problem === 'certificate-id') f.keyServerCertificates[0].objectId = id(333);
    if (problem === 'certificate-content') f.keyServerCertificates[0].contentSha256 = '1'.repeat(64);
    if (problem === 'system-id') f.walrusSystem.objectId = id(333);
    if (problem === 'system-version') f.walrusSystem.initialSharedVersion = '0';
    if (problem === 'extra') f.walrusSystem.version = '1';
    invalid(() => derive(f));
  });
}
for (const stage of bootstrapStages.filter(s => s !== 'SETUP_RELEASE')) test(`${stage}: SETUP externals are not accepted`, () => {
  const f = contextFixture(stage); f.keyServerCertificates = []; invalid(() => derive(f));
});
test('manifest hash/source identity and sole schedule reject inconsistent authority', () => {
  const f = contextFixture('INITIALIZE_PROTOCOL'); f.manifest.packages[6].packageId = id(777);
  invalid(() => derive(f));
  const g = contextFixture('INITIALIZE_PROTOCOL'); g.plan.steps.pop();
  delete g.plan.executionPlanId; g.plan.executionPlanId = sha256MainnetV8Json(g.plan);
  g.manifest.executionPlanId = g.plan.executionPlanId; delete g.manifest.releaseId; g.manifest.releaseId = sha256MainnetV8Json(g.manifest);
  assert.throws(() => derive(g), /sole release schedule/);
});
test('unknown stage does not fall back to old bootstrap', () => {
  const f = contextFixture('INITIALIZE_PROTOCOL'); f.stage = 'BOOTSTRAP_RELEASE'; invalid(() => derive(f));
});
