import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat, mkdir, realpath, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import * as L from '../scripts/mainnet-v8-release-lib.mjs';
import { executeMainnetV8Release, MAINNET_V8_WAL_FILENAME } from '../scripts/mainnet-v8-release.mjs';
import { nativeSoulCompletedWalFixture } from './fixtures/native-soul-completed-wal-fixture.mjs';

// Real local filesystem operations through the SAME primitives as public WAL
// storage. Contents replay and public readback below verify storage integrity;
// synthetic transaction/signature fixtures do not establish chain authority.
let fixture;
const completedFixture = () => fixture ??= nativeSoulCompletedWalFixture();
const canonical = value => `${L.canonicalMainnetV8Json(value)}\n`;
const lock = L.withMainnetV8WalFileLock;
const replace = L.writeMainnetV8AtomicFile;
const rootFor = async () => realpath(await mkdtemp(join(tmpdir(), 'native-wal-file-primitives-')));
const exists = path => stat(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
const markerName = ({ pid = process.pid, host = hostname(), nonce = 'a'.repeat(32) } = {}) =>
  `owner.${createHash('sha256').update(host).digest('hex')}.${pid}.${nonce}`;
async function createMarker(path, overrides) {
  const name = markerName(overrides);
  await mkdir(`${path}.lock`, { mode: 0o700, recursive: true });
  await mkdir(join(`${path}.lock`, name), { mode: 0o700 });
  return name;
}
async function coldContents(path) {
  const bytes = await readFile(path, 'utf8');
  const wal = JSON.parse(bytes);
  assert.equal(bytes, canonical(wal));
  return L.assertMainnetV8ReleaseWalContents(wal);
}

test('directory-sync failure after lock installation leaves no live-process lock', async t => {
  const root = await rootFor(), path = join(root, 'data.json');
  const originalOpen = filesystem.open;
  const failure = Object.assign(new Error('controlled directory fsync failure'), { code: 'EIO' });
  let injected = false, called = false;
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === root && !injected) {
      t.mock.method(handle, 'sync', async () => { injected = true; throw failure; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(lock(path, () => { called = true; }), error => error === failure);
    assert.equal(injected, true); assert.equal(called, false);
    assert.deepEqual(await readdir(root), []);
    assert.equal(await lock(path, () => 'retry works'), 'retry works');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('dead-marker removal failure preserves it, cleans our marker and allows later retry', async t => {
  const root = await rootFor(), path = join(root, 'data.json');
  const dead = await createMarker(path, { pid: 99999999 });
  const originalRmdir = filesystem.rmdir;
  const failure = Object.assign(new Error('controlled dead-marker removal'), { code: 'EIO' });
  let injected = false;
  t.mock.method(filesystem, 'rmdir', async (...args) => {
    if (args[0] === join(path + '.lock', dead) && !injected) { injected = true; throw failure; }
    return originalRmdir(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(lock(path, () => assert.fail('failed acquisition')), error => error === failure);
    assert.deepEqual(await readdir(path + '.lock'), [dead]);
    assert.equal(await lock(path, () => 'retry'), 'retry');
    assert.deepEqual(await readdir(root), []);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('post-publication scan failure releases only the acquired marker', async t => {
  const root = await rootFor(), path = join(root, 'data.json');
  const originalRead = filesystem.readdir;
  const failure = Object.assign(new Error('controlled marker scan'), { code: 'EACCES' });
  let injected = false;
  t.mock.method(filesystem, 'readdir', async (...args) => {
    if (args[0] === path + '.lock' && !injected) { injected = true; throw failure; }
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(lock(path, () => assert.fail('failed acquisition')), error => error === failure);
    assert.deepEqual(await readdir(root), []);
    assert.equal(await lock(path, () => 'retry'), 'retry');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('directory sync and close errors both survive lock-acquisition cleanup', async t => {
  const root = await rootFor(), path = join(root, 'wal.json');
  const originalOpen = filesystem.open, failures = [new Error('sync failed'), new Error('directory close failed')];
  let injected = false, closed = false;
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === path + '.lock' && !injected) {
      injected = true;
      const actualClose = handle.close.bind(handle);
      t.mock.method(handle, 'sync', async () => { throw failures[0]; });
      t.mock.method(handle, 'close', async () => { await actualClose(); closed = true; throw failures[1]; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(lock(path, () => assert.fail('failed acquisition')), error => error instanceof AggregateError
      && error.errors[0] === failures[0] && error.errors[1] === failures[1]);
    assert.equal(closed, true); assert.deepEqual(await readdir(root), []);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('acquisition and cleanup sync failures preserve both causes without running action', async t => {
  const root = await rootFor(), path = join(root, 'data.json');
  const originalOpen = filesystem.open, failures = [new Error('install sync'), new Error('cleanup sync')];
  let syncCount = 0;
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if ([root, path + '.lock'].includes(args[0])) {
      const originalSync = handle.sync.bind(handle);
      t.mock.method(handle, 'sync', async () => {
        if (syncCount < failures.length) throw failures[syncCount++];
        return originalSync();
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(lock(path, () => assert.fail('failed acquisition')), error =>
      error instanceof AggregateError && error.errors[0] === failures[0] && error.errors[1] === failures[1]);
    assert.deepEqual(await readdir(root), []);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('dead-marker failure and our cleanup failure retain both errors and preserve foreign data', async t => {
  const root = await rootFor(), path = join(root, 'data.json');
  const dead = await createMarker(path, { pid: 99999999 });
  const originalRmdir = filesystem.rmdir, originalOpen = filesystem.open;
  const failures = [new Error('dead marker cleanup'), new Error('own release sync')];
  let failedRemoval = false;
  t.mock.method(filesystem, 'rmdir', async (...args) => {
    if (args[0] === join(path + '.lock', dead)) { failedRemoval = true; throw failures[0]; }
    return originalRmdir(...args);
  });
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === path + '.lock' && failedRemoval) {
      t.mock.method(handle, 'sync', async () => { throw failures[1]; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(lock(path, () => assert.fail('failed acquisition')), error =>
      error instanceof AggregateError && error.errors[0] === failures[0] && error.errors[1] === failures[1]);
    assert.deepEqual(await readdir(path + '.lock'), [dead]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('actual atomic replacement preserves canonical bytes, private modes and removes temporary files', async () => {
  const root = await rootFor(), directory = join(root, 'private'), path = join(directory, 'data.json');
  await replace(path, canonical({ revision: '1' }));
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await replace(path, canonical({ revision: '2', bytes: 'exact\u0000Ω' }));
  assert.equal(await readFile(path, 'utf8'), canonical({ revision: '2', bytes: 'exact\u0000Ω' }));
  assert.deepEqual(await readdir(directory), ['data.json']);
});

test('mutable byte input is rejected before creating any path', async () => {
  const root = await rootFor(), directory = join(root, 'not-created');
  await assert.rejects(replace(join(directory, 'data.json'), Buffer.from('unsafe')), TypeError);
  assert.equal(await exists(directory), false);
});

test('atomic write, close and unlink failures retain every cause and leave failed cleanup visible', async t => {
  const root = await rootFor(), path = join(root, 'wal.json');
  await replace(path, 'original');
  const originalOpen = filesystem.open, originalUnlink = filesystem.unlink;
  const failures = [new Error('write failed'), new Error('file close failed'), new Error('temp unlink failed')];
  let temporary, closed = false;
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[1] === 'wx') {
      temporary = args[0];
      const actualClose = handle.close.bind(handle);
      t.mock.method(handle, 'writeFile', async () => { throw failures[0]; });
      t.mock.method(handle, 'close', async () => { await actualClose(); closed = true; throw failures[1]; });
    }
    return handle;
  });
  t.mock.method(filesystem, 'unlink', async (...args) => {
    if (args[0] === temporary) throw failures[2];
    return originalUnlink(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(replace(path, 'new'), error => error instanceof AggregateError
      && error.errors.length === failures.length && error.errors.every((entry, index) => entry === failures[index]));
    assert.equal(closed, true); assert.equal(await exists(temporary), true);
    assert.equal(await readFile(path, 'utf8'), 'original');
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    if (temporary) await originalUnlink(temporary);
  }
});

test('failed rename preserves the existing directory and cleans its temporary file', async () => {
  const root = await rootFor(), path = join(root, 'target');
  await mkdir(path);
  await writeFile(join(path, 'original'), 'preserve');
  await assert.rejects(replace(path, 'new'), { code: 'MAINNET_V8_WAL_PATH_INVALID' });
  assert.equal(await readFile(join(path, 'original'), 'utf8'), 'preserve');
  assert.deepEqual(await readdir(root), ['target']);
});

for (const phase of ['file', 'directory']) test(`atomic ${phase}-sync failure exposes exact pre/post-rename state for cold recovery`, async t => {
  const root = await rootFor(), path = join(root, 'data.json');
  await replace(path, 'before');
  const originalOpen = filesystem.open;
  const failure = Object.assign(new Error(`controlled ${phase} fsync failure`), { code: 'EIO' });
  let injected = false;
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (!injected && (phase === 'directory' ? args[0] === root : args[1] === 'wx')) {
      t.mock.method(handle, 'sync', async () => { injected = true; throw failure; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(replace(path, 'after'), error => error === failure);
    assert.equal(injected, true);
    // A directory fsync error follows rename: rejection is NOT proof that the
    // previous bytes survived, nor permission to sign/submit a replacement.
    assert.equal(await readFile(path, 'utf8'), phase === 'file' ? 'before' : 'after');
    assert.deepEqual(await readdir(root), ['data.json']);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('an actual held writer lock rejects contention and releases after callback failure', async () => {
  const root = await rootFor(), path = join(root, 'data.json');
  let entered, finish;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const finishPromise = new Promise(resolve => { finish = resolve; });
  const first = lock(path, async () => { entered(); await finishPromise; return 'first'; });
  await enteredPromise;
  try {
    assert.equal((await stat(`${path}.lock`)).mode & 0o777, 0o700);
    const [ownMarker] = await readdir(`${path}.lock`);
    assert.equal((await stat(join(`${path}.lock`, ownMarker))).mode & 0o777, 0o700);
    let called = false;
    await assert.rejects(lock(path, () => { called = true; }), { code: 'MAINNET_V8_WAL_LOCKED' });
    assert.equal(called, false);
  } finally { finish(); }
  assert.equal(await first, 'first');
  const failure = new Error('operation failed');
  await assert.rejects(lock(path, () => { throw failure; }), error => error === failure);
  assert.equal(await lock(path, () => 'recovered'), 'recovered');
  assert.deepEqual(await readdir(root), []);
});

test('same-process and remote owner markers are never stolen', async () => {
  const root = await rootFor();
  for (const [name, overrides] of [['live', {}], ['remote', { host: hostname() + '-remote' }]]) {
    const path = join(root, name), marker = await createMarker(path, overrides);
    await assert.rejects(lock(path, () => assert.fail('must not acquire')), { code: 'MAINNET_V8_WAL_LOCKED' });
    assert.deepEqual(await readdir(path + '.lock'), [marker]);
  }
});

for (const signal of ['SIGTERM', 'SIGKILL']) test('actual child lock is reclaimed only after confirmed ' + signal + ' exit', { timeout: 15_000 }, async t => {
  const root = await rootFor(), path = join(root, 'data.json');
  const moduleUrl = new URL('../scripts/mainnet-v8-release-lib.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', [
    'import { withMainnetV8WalFileLock } from ' + JSON.stringify(moduleUrl) + ';',
    "process.on('disconnect', () => process.exit(1));",
    'await withMainnetV8WalFileLock(' + JSON.stringify(path) + ', async () => {',
    "process.send('locked'); await new Promise(resolve => process.once('message', resolve));",
    '}); process.disconnect();',
  ].join('\n')], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  assert.deepEqual(await once(child, 'message'), ['locked', undefined]);
  const [marker] = await readdir(path + '.lock');
  assert.equal(marker.split('.')[2], String(child.pid));
  await assert.rejects(lock(path, () => assert.fail('child owns lock')), { code: 'MAINNET_V8_WAL_LOCKED' });
  child.kill(signal);
  await exited;
  assert.equal(await exists(path + '.lock'), true);
  assert.equal(await lock(path, () => 'reclaimed'), 'reclaimed');
  assert.deepEqual(await readdir(root), []);
});

test('missing own marker preserves a successor and aggregates action/release failures', async () => {
  const root = await rootFor(), path = join(root, 'data.json');
  const actionFailure = new Error('action failed'), successor = markerName({ nonce: 'b'.repeat(32) });
  await assert.rejects(lock(path, async () => {
    const [own] = await readdir(path + '.lock');
    await rmdir(join(path + '.lock', own));
    await mkdir(join(path + '.lock', successor), { mode: 0o700 });
    throw actionFailure;
  }), error => error instanceof AggregateError && error.errors[0] === actionFailure
    && error.errors[1].code === 'MAINNET_V8_WAL_LOCK_RELEASE_FAILED');
  assert.deepEqual(await readdir(path + '.lock'), [successor]);
  await rmdir(join(path + '.lock', successor));
  await rmdir(path + '.lock');
  await assert.rejects(lock(path, async () => {
    const [own] = await readdir(path + '.lock'); await rmdir(join(path + '.lock', own));
  }), { code: 'MAINNET_V8_WAL_LOCK_RELEASE_FAILED' });
});

for (const thrown of [undefined, null, false, 0, '']) test('falsy action throw ' + String(thrown) + ' is not swallowed', async () => {
  const root = await rootFor(), path = join(root, 'data.json');
  let rejected = false;
  try { await lock(path, () => { throw thrown; }); } catch (error) { rejected = true; assert.equal(error, thrown); }
  assert.equal(rejected, true); assert.deepEqual(await readdir(root), []);
});

test('malformed markers and populated dead markers fail closed without deleting foreign data', async () => {
  const root = await rootFor();
  for (const [index, marker] of ['not-an-owner', markerName({ pid: 0 }), markerName({ pid: 99999999 })].entries()) {
    const path = join(root, String(index));
    await mkdir(path + '.lock', { mode: 0o700 });
    await mkdir(join(path + '.lock', marker), { mode: 0o700 });
    if (index === 2) await writeFile(join(path + '.lock', marker, 'preserve'), 'foreign');
    await assert.rejects(lock(path, () => assert.fail('invalid marker')), error =>
      index === 2 ? ['ENOTEMPTY', 'EEXIST'].includes(error.code) : error.code === 'MAINNET_V8_WAL_LOCK_INVALID');
    assert.deepEqual(await readdir(path + '.lock'), [marker]);
    if (index === 2) assert.equal(await readFile(join(path + '.lock', marker, 'preserve'), 'utf8'), 'foreign');
  }
});

test('retired fixed lock files are rejected and preserved, never migrated or erased', async () => {
  const root = await rootFor(), path = join(root, 'data.json');
  await writeFile(path + '.lock', 'old metadata');
  await assert.rejects(lock(path, () => assert.fail('old lock is not the new protocol')), { code: 'MAINNET_V8_WAL_LOCK_INVALID' });
  assert.equal(await readFile(path + '.lock', 'utf8'), 'old metadata');
});

test('non-private parent directories are rejected without changing their mode or content', async () => {
  const root = await rootFor(), directory = join(root, 'shared'), path = join(directory, 'wal.json');
  await mkdir(directory, { mode: 0o755 });
  await filesystem.chmod(directory, 0o755);
  await writeFile(path, 'preserve');
  await assert.rejects(lock(path, () => assert.fail('shared directory')), { code: 'MAINNET_V8_WAL_PATH_INVALID' });
  await assert.rejects(replace(path, 'changed'), { code: 'MAINNET_V8_WAL_PATH_INVALID' });
  await assert.rejects(L.readMainnetV8ReleaseWal(path), { code: 'MAINNET_V8_WAL_PATH_INVALID' });
  assert.equal((await stat(directory)).mode & 0o777, 0o755);
  assert.equal(await readFile(path, 'utf8'), 'preserve');
  assert.deepEqual(await readdir(directory), ['wal.json']);
});

for (const kind of ['symlink', 'hardlink']) test(`actual cold read rejects a ${kind} introduced after the initial path check`, async t => {
  const root = await rootFor(), path = join(root, 'wal.json'), preserved = join(root, 'preserved');
  await replace(path, '{}');
  const originalOpen = filesystem.open;
  let injected = false;
  t.mock.method(filesystem, 'open', async (...args) => {
    if (args[0] === path && typeof args[1] === 'number' && !injected) {
      injected = true;
      if (kind === 'symlink') {
        await filesystem.rename(path, preserved);
        await filesystem.symlink(preserved, path);
      } else await filesystem.link(path, preserved);
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(L.readMainnetV8ReleaseWal(path), { code: 'MAINNET_V8_WAL_PATH_INVALID' });
    assert.equal(injected, true);
    assert.equal(await readFile(preserved, 'utf8'), '{}');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('cold-read and handle-close errors are both retained, with the actual descriptor closed', async t => {
  const root = await rootFor(), path = join(root, 'wal.json');
  await replace(path, '{}');
  const originalOpen = filesystem.open, failures = [new Error('read failed'), new Error('close failed')];
  let closed = false;
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === path && typeof args[1] === 'number') {
      const actualClose = handle.close.bind(handle);
      t.mock.method(handle, 'read', async () => { throw failures[0]; });
      t.mock.method(handle, 'close', async () => { await actualClose(); closed = true; throw failures[1]; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(L.readMainnetV8ReleaseWal(path), error => error instanceof AggregateError
      && error.errors[0] === failures[0] && error.errors[1] === failures[1]);
    assert.equal(closed, true);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

for (const changed of ['{', '{} ']) test(`cold-read rejects stat/read size drift to ${changed.length} bytes with bounded reads`, async t => {
  const root = await rootFor(), path = join(root, 'wal.json');
  await replace(path, '{}');
  const originalOpen = filesystem.open;
  let injected = false, closed = false, requested = 0;
  t.mock.method(filesystem, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === path && typeof args[1] === 'number') {
      const actualStat = handle.stat.bind(handle), actualRead = handle.read.bind(handle);
      const actualClose = handle.close.bind(handle);
      t.mock.method(handle, 'stat', async () => {
        const before = await actualStat();
        await filesystem.writeFile(path, changed);
        injected = true;
        return before;
      });
      t.mock.method(handle, 'read', async (...readArgs) => {
        requested += readArgs[2];
        return actualRead(...readArgs);
      });
      t.mock.method(handle, 'close', async () => { await actualClose(); closed = true; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(L.readMainnetV8ReleaseWal(path), error => error.code === 'MAINNET_V8_WAL_INVALID'
      && error.message.includes('size changed'));
    assert.equal(injected, true); assert.equal(closed, true);
    // Two initial bytes, at most one short-read retry, and one extra-byte probe.
    assert.ok(requested <= 4);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('public append snapshots reject accessors, hidden data and symbols before filesystem I/O', async () => {
  const root = await rootFor();
  let accessorCalls = 0;
  const accessor = Object.defineProperty({}, 'evidence', { enumerable: true, get() { accessorCalls += 1; return {}; } });
  const hiddenTimestamp = Object.defineProperty({}, 'recordedAt', { value: undefined, enumerable: false });
  const nested = { evidence: Object.defineProperty({}, 'payload', { enumerable: true, get() { accessorCalls += 1; return {}; } }) };
  const symbol = { [Symbol('hidden')]: 'data' };
  for (const [index, input] of [accessor, hiddenTimestamp, nested, symbol].entries()) {
    const directory = join(root, String(index));
    await assert.rejects(L.appendMainnetV8ReleaseWal(join(directory, 'wal.json'), input), { code: 'MAINNET_V8_JSON_DOMAIN_INVALID' });
    assert.equal(await exists(directory), false);
  }
  assert.equal(accessorCalls, 0);
});

test('same file primitives persist all68 Contents events, exact CAS and cold-read hashes without release permission', async () => {
  const { plan, wal: finalWal } = await completedFixture();
  const root = await rootFor(), path = join(root, 'history.json');
  const first = finalWal.events[0];
  let current = L.buildMainnetV8InitialWalContents(plan, { evidence: first.evidence, recordedAt: first.recordedAt });
  await lock(path, () => replace(path, canonical(current)));
  for (const event of finalWal.events.slice(1)) {
    const input = { ...event, expectedRevision: current.revision, expectedHeadEventSha256: current.headEventSha256 };
    current = await lock(path, async () => {
      const before = await coldContents(path);
      const after = L.appendMainnetV8WalContents(before, input);
      await replace(path, canonical(after));
      assert.equal((await coldContents(path)).walSha256, after.walSha256);
      return after;
    });
  }
  assert.deepEqual(await coldContents(path), finalWal);
  const original = await readFile(path, 'utf8');
  await assert.rejects(lock(path, async () => {
    const before = await coldContents(path);
    const after = L.appendMainnetV8WalContents(before, { expectedRevision: '1', expectedHeadEventSha256: first.eventSha256 });
    await replace(path, canonical(after));
  }), { code: 'MAINNET_V8_WAL_CAS_MISMATCH' });
  assert.equal(await readFile(path, 'utf8'), original);
  assert.deepEqual(await readdir(root), ['history.json']);
  // Public readers validate the same complete history; invalid write inputs
  // must still preserve the exact existing journal.
  assert.deepEqual(L.assertMainnetV8ReleaseWal(finalWal), finalWal);
  assert.deepEqual(await L.readMainnetV8ReleaseWal(path), finalWal);
  await assert.rejects(L.createMainnetV8ReleaseWal(join(root, 'forbidden.json'), plan),
    error => error.code?.startsWith('MAINNET_V8_'));
  await assert.rejects(L.appendMainnetV8ReleaseWal(path, {}), { code: 'MAINNET_V8_WAL_CAS_MISMATCH' });
  await assert.rejects(L.appendMainnetV8ReleaseWal(path, { recordedAt: undefined }), { code: 'MAINNET_V8_WAL_CAS_MISMATCH' });
  assert.equal(await exists(join(root, 'forbidden.json')), false);
  assert.equal(await readFile(path, 'utf8'), original);
  await replace(join(root, MAINNET_V8_WAL_FILENAME), original);
  await replace(join(root, 'release-plan.json'), canonical(plan));
  let operationCalls = 0;
  await assert.rejects(executeMainnetV8Release({ stateDir: root,
    client: {}, transport: {}, dependencies: {
      signExactTransaction: () => { operationCalls += 1; },
      broadcastExactTransaction: () => { operationCalls += 1; },
    },
  }), { code: 'MAINNET_V8_HASH_INVALID' });
  assert.equal(operationCalls, 0);
});
