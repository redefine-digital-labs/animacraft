import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { executeMainnetV8Release, MAINNET_V8_WAL_FILENAME } from '../scripts/mainnet-v8-release.mjs';
import { contextFixture } from './fixtures/native-soul-bootstrap-context-fixture.mjs';

// Structural SOURCE data only; no compilation, signature or chain finality.
const fixture = () => contextFixture('INITIALIZE_PROTOCOL').plan;
const hashPlan = plan => {
  delete plan.executionPlanId;
  plan.executionPlanId = L.sha256MainnetV8Json(plan);
  return plan;
};
const contentError = error => typeof error.code === 'string'
  && !(error instanceof TypeError);

test('pure plan data validates eight publications and all fourteen exact stages', () => {
  const input = fixture();
  const result = L.buildMainnetV8ReleasePlanContents(input);
  assert.deepEqual(result, input);
  assert.equal(L.assertMainnetV8ReleasePlanContents(result), result);
  assert.equal(result.packages.length, 8);
  assert.equal(result.steps.length, 14);
  assert.equal(result.steps[12].kind, 'ACTIVATE_SOULIDITY_MARKET');
  assert.equal(result.steps[13].kind, 'VERIFY_AND_EXPORT');
  assert.equal(result.executionPlanId, hashPlan(structuredClone(result)).executionPlanId);
});

test('pure builder detaches and recursively freezes every input-bearing branch', () => {
  const input = fixture(), result = L.buildMainnetV8ReleasePlanContents(input);
  const original = structuredClone(result);
  input.sourceRevision.packages[0].files[0].sha256 = '9'.repeat(64);
  input.packages[0].sourceArtifact.originalFiles[0].sha256 = '8'.repeat(64);
  input.toolchain.suiVersion = 'changed';
  input.sealPolicy.keyServers[0].weight = '2';
  assert.deepEqual(result, original);
  const frozen = value => {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    Object.values(value).forEach(frozen);
  };
  frozen(result);
  assert.throws(() => { result.steps[12].kind = 'VERIFY_AND_EXPORT'; }, TypeError);
});

const mutations = {
  'missing Soulidity publication': p => p.packages.splice(6, 1),
  'swapped Soulidity and Release': p => [p.packages[6], p.packages[7]] = [p.packages[7], p.packages[6]],
  'wrong package name': p => p.packages[6].packageName = p.packages[7].packageName,
  'forged source commitment': p => p.packages[6].sourceCommitment = '9'.repeat(64),
  'wrong original source row': p => p.packages[6].sourceArtifact.originalFiles[0].sha256 = '9'.repeat(64),
  'wrong derived source row': p => p.packages[6].sourceArtifact.files[0].sha256 = '9'.repeat(64),
  'wrong source repository identity': p => p.packages[6].sourceArtifact.release.repository = 'animacraft',
  'missing source revision package': p => p.sourceRevision.packages.splice(6, 1),
  'missing market activation': p => p.steps.splice(12, 1),
  'old verify ordinal': p => p.steps[13].ordinal = '12',
  'duplicated bootstrap stage': p => p.steps[11] = structuredClone(p.steps[10]),
  'swapped final stages': p => [p.steps[12], p.steps[13]] = [p.steps[13], p.steps[12]],
  'extra stage field': p => p.steps[12].enabled = true,
  'extra stage': p => p.steps.push(structuredClone(p.steps[13])),
  'changed sender': p => p.sender = `0x${'1'.repeat(64)}`,
  'wrong chain network': p => p.chain.network = 'testnet',
  'wrong full chain ID': p => p.chain.chainIdentifier = '0'.repeat(64),
  'wrong short chain ID': p => p.chain.legacyChainIdentifier = 'deadbeef',
  'wrong protocol': p => p.protocolProfile.protocolVersion = '134',
  'wrong approved compiler': p => p.toolchain.suiBinarySha256 = '0'.repeat(64),
  'wrong payment type': p => p.paymentCoinType = '0x2::sui::SUI',
  'wrong Seal threshold': p => p.sealPolicy.threshold = '1',
  'extra plan field': p => p.enabled = true,
};
for (const [name, change] of Object.entries(mutations)) {
  test(`complete plan data rejects ${name} even with recomputed executionPlanId`, () => {
    const plan = fixture(); change(plan); hashPlan(plan);
    assert.throws(() => L.assertMainnetV8ReleasePlanContents(plan), contentError);
    // Public validation must inspect the same contents.
    assert.throws(() => L.assertMainnetV8ReleasePlan(plan), contentError);
  });
}

test('plan data rejects a stale hash and nondeterministic JSON', () => {
  const stale = fixture(); stale.executionPlanId = '9'.repeat(64);
  assert.throws(() => L.assertMainnetV8ReleasePlanContents(stale), contentError);
  const undefinedField = fixture(); undefinedField.ignored = undefined;
  assert.throws(() => L.assertMainnetV8ReleasePlanContents(undefinedField), contentError);
});

test('public plan accepts exact contents but incomplete manifest and READY evidence still fail', async t => {
  const plan = fixture();
  assert.deepEqual(L.assertMainnetV8ReleasePlan(plan), plan);
  assert.deepEqual(L.buildMainnetV8ReleasePlan(plan), plan);
  assert.deepEqual(L.assertReleasePlan(plan), plan);
  assert.deepEqual(L.createReleasePlan(plan), plan);
  assert.throws(() => L.buildMainnetV8FinalManifest({ plan, packages: [] }), contentError);
  const root = await mkdtemp(join(tmpdir(), 'native-plan-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(L.createMainnetV8ReleaseWal(join(root, 'wal.json'), plan), contentError);
  assert.deepEqual(await readdir(root), [], 'invalid READY must leave no WAL or lock');
});

test('cold WAL and execution reject invalid event history before any external operation', async t => {
  const plan = fixture();
  // A valid plan alone does not replace the complete event history.
  const wal = { schemaVersion: L.MAINNET_V8_RELEASE_WAL_SCHEMA,
    executionPlanId: plan.executionPlanId, releaseId: null, finalManifest: null,
    plan, revision: '1', headEventSha256: '0'.repeat(64), events: [], walSha256: '0'.repeat(64) };
  assert.throws(() => L.assertMainnetV8ReleaseWal(wal), contentError);
  const root = await mkdtemp(join(tmpdir(), 'native-plan-execution-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, MAINNET_V8_WAL_FILENAME);
  await writeFile(target, `${L.canonicalMainnetV8Json(wal)}\n`);
  await assert.rejects(L.readMainnetV8ReleaseWal(target), contentError);
  const touched = [];
  const noCalls = new Proxy({}, { get: (_, name) => { touched.push(name); throw new Error('Unexpected external operation'); } });
  await assert.rejects(executeMainnetV8Release({ stateDir: root,
    expectedExecutionPlanId: plan.executionPlanId, client: noCalls, transport: noCalls }), contentError);
  assert.deepEqual(touched, []);
  assert.deepEqual(await readdir(root), [MAINNET_V8_WAL_FILENAME]);
});
