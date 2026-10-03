import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { nativeSoulCompletedWalFixture } from './fixtures/native-soul-completed-wal-fixture.mjs';

const f = await nativeSoulCompletedWalFixture();
const clone = value => structuredClone(value);
const hash = text => createHash('sha256').update(text).digest('hex');
// Independent reference encoding: test-only, never used by the release runner.
const referenceJson = value => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(referenceJson).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${referenceJson(value[key])}`).join(',')}}`;
const code = expected => error => error?.code === expected;
const nodes = value => 1 + (value && typeof value === 'object'
  ? Object.values(value).reduce((sum, entry) => sum + nodes(entry), 0) : 0);
const pages = count => Array.from({ length: count }, () => Array(10_000).fill(null));

// Exercise the exact publication -> manifest -> init boundary with a large,
// valid synthetic history. These are offline RPC diagnostics, not real chain
// transactions, production signatures, or a modification of a live WAL.
function largePublicationPrefix() {
  const sealIndex = f.wal.events.findIndex(event => event.status === 'FINAL_MANIFEST_SEALED');
  const prefix = clone(f.wal);
  prefix.events = clone(f.wal.events.slice(0, sealIndex + 1));
  const query = clone(prefix.events[2]);
  assert.equal(query.evidence.observation.kind, 'QUERY_INTENT');
  const input = f.publications[0].input;
  const error = { code: 'RPC_UNAVAILABLE', message: 'Synthetic bounded recovery history',
    service: 'sui.rpc.v2.LedgerService', method: 'GetTransaction', details: { pages: pages(18) } };
  const evidence = L.buildMainnetV8OutcomeEvidence({ ...input, status: 'OUTCOME_UNKNOWN',
    observation: { error, errorSha256: L.sha256MainnetV8Json(error) } });
  const inserted = Array.from({ length: 3 }, () => [
    { ...clone(query), status: 'OUTCOME_UNKNOWN', evidence: clone(evidence) }, clone(query),
  ]).flat();
  prefix.events.splice(3, 0, ...inserted);
  let previous = '0'.repeat(64);
  prefix.events.forEach((event, index) => {
    event.revision = String(index + 1);
    event.previousEventSha256 = previous;
    event.recordedAt = new Date(Date.UTC(2026, 8, 9, 0, 0, index)).toISOString();
    delete event.eventSha256;
    event.eventSha256 = L.sha256MainnetV8Json(event);
    previous = event.eventSha256;
  });
  prefix.revision = String(prefix.events.length);
  prefix.headEventSha256 = previous;
  delete prefix.walSha256;
  prefix.walSha256 = hash(referenceJson(prefix));
  return prefix;
}

test('valid >500k-node publication WAL appends initialization and a second event, then cold-reads unchanged', async () => {
  const prefix = largePublicationPrefix();
  assert.ok(nodes(prefix) > 500_000);
  assert.throws(() => L.canonicalMainnetV8Json(prefix), code('MAINNET_V8_JSON_DOMAIN_INVALID'));
  // Fails before the fix with the same aggregate-node error as live ordinal8.
  L.assertMainnetV8ReleaseWalContents(prefix);
  assert.equal(L.canonicalMainnetV8WalJson(prefix), referenceJson(prefix));
  const root = await mkdtemp(join(tmpdir(), 'wal-container-budget-'));
  try {
    const path = join(root, 'release-wal.json');
    await writeFile(path, `${referenceJson(prefix)}\n`, { mode: 0o600 });
    let wal = await L.readReleaseWal(path);
    const first = clone(wal.events);
    for (const status of ['READY', 'SIGNED']) {
      const event = f.wal.events.find(row => row.ordinal === '8' && row.status === status);
      wal = await L.appendReleaseWal({ path, expectedRevision: wal.revision,
        expectedHeadEventSha256: wal.headEventSha256,
        event: { ordinal: '8', attempt: '0', status, evidence: event.evidence,
          recordedAt: new Date(Date.UTC(2026, 8, 9, 0, 0, Number(wal.revision))).toISOString() } });
      assert.deepEqual(wal.events.slice(0, first.length), first);
      assert.equal(await readFile(path, 'utf8'), `${referenceJson(wal)}\n`);
      assert.deepEqual(await L.readReleaseWal(path), wal);
    }
    await assert.rejects(() => L.appendReleaseWal({ path, expectedRevision: prefix.revision,
      expectedHeadEventSha256: prefix.headEventSha256,
      event: { ordinal: '8', attempt: '0', status: 'SIGNED', evidence: wal.events.at(-1).evidence } }),
    code('MAINNET_V8_WAL_CAS_MISMATCH'));
    const tampered = clone(wal);
    tampered.events[0].evidence.readyArtifact.packageArtifact.modules[0].moduleBytecodeSha256 = 'f'.repeat(64);
    assert.throws(() => L.assertMainnetV8ReleaseWalContents(tampered));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('WAL encoding keeps all old bytes and completed-history commitments unchanged', () => {
  assert.equal(L.canonicalMainnetV8WalJson(f.wal), L.canonicalMainnetV8Json(f.wal));
  const payload = clone(f.wal); delete payload.walSha256;
  assert.equal(hash(referenceJson(payload)), f.wal.walSha256);
  assert.deepEqual(L.assertMainnetV8ReleaseWalContents(f.wal), f.wal);
  // The final certificate is not the append-only container: it still fits the
  // generic domain. Keep that API strict rather than expanding it by association.
  const finalCertificate = { plan: f.wal.plan, manifest: f.wal.finalManifest,
    finalized: f.wal.events.filter(row => row.status === 'FINALIZED_SUCCESS')
      .map(row => row.evidence.observation.details) };
  assert.ok(nodes(finalCertificate) < 500_000);
  assert.doesNotThrow(() => L.canonicalMainnetV8Json(finalCertificate));
});

test('WAL budget does not expand single-event, metadata, depth, accessor, or generic domains', () => {
  const single = clone(f.wal); single.events = [{ payload: pages(50) }];
  assert.throws(() => L.canonicalMainnetV8WalJson(single), code('MAINNET_V8_JSON_DOMAIN_INVALID'));
  const metadata = clone(f.wal); metadata.plan = { payload: pages(50) };
  assert.throws(() => L.canonicalMainnetV8WalJson(metadata), code('MAINNET_V8_JSON_DOMAIN_INVALID'));
  const deep = clone(f.wal); let tail = deep.events = {};
  for (let i = 0; i < 129; i++) { tail.next = {}; tail = tail.next; }
  assert.throws(() => L.canonicalMainnetV8WalJson(deep), code('MAINNET_V8_JSON_DOMAIN_INVALID'));
  let accessed = false;
  const accessor = clone(f.wal);
  Object.defineProperty(accessor, 'events', { enumerable: true, get() { accessed = true; return []; } });
  assert.throws(() => L.canonicalMainnetV8WalJson(accessor), code('MAINNET_V8_JSON_DOMAIN_INVALID'));
  assert.equal(accessed, false);
  assert.throws(() => L.canonicalMainnetV8Json(pages(50)), code('MAINNET_V8_JSON_DOMAIN_INVALID'));
});

test('WAL aggregate remains bounded independently of its per-event budgets', () => {
  const wal = clone(f.wal);
  // Shared references are not cycles, but each encoded occurrence counts.
  const event = { payload: pages(49) };
  wal.events = Array(17).fill(event);
  assert.throws(() => L.canonicalMainnetV8WalJson(wal), code('MAINNET_V8_JSON_DOMAIN_INVALID'));
});

test('oversized WAL files are rejected before JSON parsing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wal-file-size-'));
  try {
    const path = join(root, 'release-wal.json');
    const handle = await open(path, 'wx', 0o600);
    try { await handle.truncate(128 * 1024 * 1024 + 2); } finally { await handle.close(); }
    await assert.rejects(() => L.readReleaseWal(path), code('MAINNET_V8_CANONICAL_BYTES_EXCEEDED'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
