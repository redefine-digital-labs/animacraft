import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { assertMainnetV8TransactionMatchesReady, executeMainnetV8Release,
  MAINNET_V8_PLAN_FILENAME, MAINNET_V8_WAL_FILENAME } from '../scripts/mainnet-v8-release.mjs';
import { nativeSoulPublicationWalFixture } from './fixtures/native-soul-full-wal-fixture.mjs';

const prefix = await nativeSoulPublicationWalFixture();
const clone = value => structuredClone(value);
const time = '2026-09-09T00:00:00.000Z';
const signedEvidence = () => L.buildMainnetV8SignedEvidence(prefix.publications[0].input);
const initial = () => L.buildMainnetV8InitialWalContents(prefix.plan,
  { evidence: prefix.publications[0].ready, recordedAt: time });
const signedInput = wal => ({ ordinal: '0', attempt: '0', status: 'SIGNED', evidence: signedEvidence(),
  expectedRevision: wal.revision, expectedHeadEventSha256: wal.headEventSha256, recordedAt: time });
function broadcastEvidence() {
  const input = prefix.publications[0].input;
  const watermark = { epoch: '1242', checkpointSequence: '319550150', checkpointDigest: input.digest };
  const common = { kind: 'TYPED_NOT_FOUND', code: 'NOT_FOUND', service: 'sui.rpc.v2.LedgerService',
    method: 'GetTransaction', digest: input.digest, signedArtifactSha256: input.signedArtifactSha256,
    chainIdentifier: L.MAINNET_V8_CHAIN_IDENTIFIER, endpoint: 'https://fullnode.mainnet.sui.io/' };
  const firstQuery = { ...common, afterWatermark: null, observedAt: '2026-09-09T00:00:01.000Z' };
  const secondQuery = { ...common, afterWatermark: watermark, observedAt: '2026-09-09T00:00:02.000Z' };
  return L.buildMainnetV8OutcomeEvidence({ ...input, status: 'OUTCOME_PENDING', observation: {
    kind: 'BROADCAST_INTENT', details: { firstQuery, firstQuerySha256: L.sha256MainnetV8Json(firstQuery),
      secondQuery, secondQuerySha256: L.sha256MainnetV8Json(secondQuery), watermark },
  } });
}
const frozen = value => {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(frozen);
};

test('shared initial builder validates complete cold history and detaches/freeze inputs', () => {
  const plan = clone(prefix.plan), evidence = clone(prefix.publications[0].ready);
  const wal = L.buildMainnetV8InitialWalContents(plan, { evidence, recordedAt: time });
  const bytes = L.canonicalMainnetV8Json(wal);
  plan.packages[0].sourceCommitment = 'f'.repeat(64);
  evidence.unsignedEnvelope.digest = 'mutated';
  assert.equal(L.canonicalMainnetV8Json(wal), bytes);
  assert.deepEqual(L.assertMainnetV8ReleaseWalContents(JSON.parse(bytes)), wal);
  frozen(wal);
});

test('shared append builder retains the exact predecessor, detaches and validates full history', () => {
  const current = clone(initial()), input = clone(signedInput(current));
  const before = L.canonicalMainnetV8Json(current), wal = L.appendMainnetV8WalContents(current, input);
  assert.equal(L.canonicalMainnetV8Json(current), before);
  assert.equal(wal.events[1].previousEventSha256, current.events[0].eventSha256);
  assert.equal(wal.revision, '2');
  const bytes = L.canonicalMainnetV8Json(wal);
  current.plan.sender = 'changed'; input.evidence.signedArtifact.signature = 'changed';
  assert.equal(L.canonicalMainnetV8Json(wal), bytes);
  assert.deepEqual(L.assertMainnetV8ReleaseWalContents(JSON.parse(bytes)), wal);
  frozen(wal);
});

for (const field of ['expectedRevision', 'expectedHeadEventSha256']) test(`pure append rejects stale ${field}`, () => {
  const wal = initial(), input = signedInput(wal);
  input[field] = field === 'expectedRevision' ? '0' : 'f'.repeat(64);
  assert.throws(() => L.appendMainnetV8WalContents(wal, input), { code: 'MAINNET_V8_WAL_CAS_MISMATCH' });
});

test('pure append validates all existing rows instead of trusting a matching head/CAS', () => {
  const wal = clone(prefix.wal);
  wal.events[0].evidence.readyArtifact.packageCommitment = 'f'.repeat(64);
  assert.throws(() => L.appendMainnetV8WalContents(wal, signedInput(wal)), error =>
    error.code?.startsWith('MAINNET_V8_'));
});

test('READY cannot jump directly to a valid finalized certificate without signed/query/finality history', () => {
  const wal = initial();
  assert.throws(() => L.appendMainnetV8WalContents(wal, { ...signedInput(wal),
    status: 'FINALIZED_SUCCESS', evidence: prefix.publications[0].outcome }),
  { code: 'MAINNET_V8_WAL_TRANSITION_INVALID' });
});

test('SIGNED cannot broadcast before recording its query intent', () => {
  const start = initial(), wal = L.appendMainnetV8WalContents(start, signedInput(start));
  const evidence = broadcastEvidence();
  assert.throws(() => L.appendMainnetV8WalContents(wal, { ...signedInput(wal),
    status: 'OUTCOME_PENDING', evidence }), { code: 'MAINNET_V8_WAL_TRANSITION_INVALID' });
});

test('query followed by two bound NOT_FOUND records admits only a broadcast-intent data row', () => {
  const start = initial(), signed = L.appendMainnetV8WalContents(start, signedInput(start));
  const query = L.buildMainnetV8OutcomeEvidence({ ...prefix.publications[0].input,
    status: 'OUTCOME_PENDING', observation: { kind: 'QUERY_INTENT', details: {} } });
  const queried = L.appendMainnetV8WalContents(signed, { ...signedInput(signed), status: 'OUTCOME_PENDING', evidence: query });
  const broadcast = L.appendMainnetV8WalContents(queried, { ...signedInput(queried), status: 'OUTCOME_PENDING', evidence: broadcastEvidence() });
  assert.equal(broadcast.events.at(-1).evidence.observation.kind, 'BROADCAST_INTENT');
  assert.deepEqual(L.assertMainnetV8ReleaseWal(broadcast), broadcast);
});

test('public matcher, manifest builder and WAL validator consume the same exact history', async () => {
  assert.deepEqual(L.assertMainnetV8ReleaseWal(prefix.wal), prefix.wal);
  assert.deepEqual(L.buildMainnetV8ManifestEvidence({ plan: prefix.plan, finalManifest: prefix.manifest }),
    L.buildMainnetV8ManifestEvidenceContents({ plan: prefix.plan, finalManifest: prefix.manifest }));
  await assertMainnetV8TransactionMatchesReady({ ...prefix.publications[0], plan: prefix.plan });
});

test('public file create/read/append roundtrip the exact offline-built history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'native-wal-contents-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'history.json'), contents = `${L.canonicalMainnetV8Json(initial())}\n`;
  const created = await L.createMainnetV8ReleaseWal(path, prefix.plan,
    { evidence: prefix.publications[0].ready, recordedAt: time });
  assert.deepEqual(created, initial());
  assert.equal(await readFile(path, 'utf8'), contents);
  assert.deepEqual(await L.readMainnetV8ReleaseWal(path), created);
  const appended = await L.appendMainnetV8ReleaseWal(path, signedInput(created));
  assert.deepEqual(appended, L.appendMainnetV8WalContents(created, signedInput(created)));
  assert.deepEqual(await L.readMainnetV8ReleaseWal(path), appended);
  assert.deepEqual(await readdir(directory), ['history.json']);
});

test('a valid sealed history still needs explicit plan approval before execute operations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'native-wal-execute-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, MAINNET_V8_PLAN_FILENAME), `${L.canonicalMainnetV8Json(prefix.plan)}\n`);
  const walPath = join(directory, MAINNET_V8_WAL_FILENAME), bytes = `${L.canonicalMainnetV8Json(prefix.wal)}\n`;
  await writeFile(walPath, bytes);
  const invoked = [];
  const operations = new Proxy({}, { get: (_target, name) => async () => { invoked.push(String(name)); throw new Error('must not run'); } });
  await assert.rejects(executeMainnetV8Release({ stateDir: directory, dependencies: operations }), { code: 'MAINNET_V8_HASH_INVALID' });
  assert.deepEqual(invoked, []);
  assert.equal(await readFile(walPath, 'utf8'), bytes);
});
