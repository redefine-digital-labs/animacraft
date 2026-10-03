import test from 'node:test';
import assert from 'node:assert/strict';
import filesystem from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { withMainnetV8WalFileLock as lock } from '../scripts/mainnet-v8-release-lib.mjs';

// Spec 7.3: schedule real filesystem operations, never replace the ownership
// algorithm or enable guarded release, signing, RPC or synthetic WAL fixtures.
const localHost = createHash('sha256').update(hostname()).digest('hex');
const scope = new AsyncLocalStorage();
const moduleUrl = new URL('../scripts/mainnet-v8-release-lib.mjs', import.meta.url).href;
const locked = { code: 'MAINNET_V8_WAL_LOCKED' };
const markerName = (pid, nonce = 'a'.repeat(32)) => `owner.${localHost}.${pid}.${nonce}`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 8000);
    })]);
  } finally { clearTimeout(timer); }
}
async function fixture(t) {
  // macOS /var and /private/var must denote the same scheduler paths.
  const root = await filesystem.realpath(await filesystem.mkdtemp(join(tmpdir(), 'native-wal-marker-race-')));
  t.after(() => filesystem.rm(root, { recursive: true, force: true }));
  const path = join(root, 'wal.json');
  return { root, path, lockPath: `${path}.lock` };
}
function schedule(t, hooks) {
  for (const [method, hook] of Object.entries(hooks)) {
    const original = filesystem[method].bind(filesystem);
    t.mock.method(filesystem, method, (...args) => hook(scope.getStore(), args, () => original(...args)));
  }
  syncBuiltinESMExports();
  return () => { t.mock.restoreAll(); syncBuiltinESMExports(); };
}
function tracked(role, path, action) {
  // Attach rejection handling immediately, including failures before a barrier.
  return scope.run(role, () => lock(path, action)).then(value => ({ value }), error => ({ error }));
}
function successful(outcome, value) {
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.value, value);
}
function counter() {
  let active = 0, maximum = 0, calls = 0;
  return {
    async run(action) {
      active += 1; calls += 1; maximum = Math.max(maximum, active);
      try { return await action(); } finally { active -= 1; }
    },
    assert(callsExpected) { assert.equal(maximum, 1); assert.equal(active, 0); assert.equal(calls, callsExpected); },
  };
}

test('a late dead-marker cleaner cannot remove a newly published owner marker', async t => {
  const { root, path, lockPath } = await fixture(t);
  const deadPath = join(lockPath, markerName(99999999));
  await filesystem.mkdir(lockPath, { mode: 0o700 });
  await filesystem.mkdir(deadPath, { mode: 0o700 });
  const cleanerPaused = deferred(), resumeCleaner = deferred();
  const freshPublished = deferred(), resumeFresh = deferred(), freshEntered = deferred(), finishFresh = deferred();
  let freshMarker, delayed = false;
  const realRmdir = filesystem.rmdir.bind(filesystem), realReaddir = filesystem.readdir.bind(filesystem);
  const restore = schedule(t, {
    rmdir: async (role, args, real) => {
      if (role === 'cleaner' && args[0] === deadPath && !delayed) {
        delayed = true; cleanerPaused.resolve(); await resumeCleaner.promise;
      }
      return real();
    },
    mkdir: async (role, args, real) => {
      const result = await real();
      if (role === 'fresh' && dirname(args[0]) === lockPath) {
        freshMarker = args[0]; freshPublished.resolve(); await resumeFresh.promise;
      }
      return result;
    },
  });
  const counts = counter();
  const cleaner = tracked('cleaner', path, () => counts.run(() => assert.fail('fresh contender is already published')));
  let fresh;
  try {
    await bounded(cleanerPaused.promise, 'old cleaner reaches exact dead-marker rmdir');
    // Another dead-marker cleanup wins first; the delayed syscall must now get
    // ENOENT and must never target the successor's different nonce pathname.
    await realRmdir(deadPath);
    fresh = tracked('fresh', path, () => counts.run(async () => {
      freshEntered.resolve(); await finishFresh.promise; return 'fresh';
    }));
    await bounded(freshPublished.promise, 'fresh owner marker publication');
    resumeCleaner.resolve();
    assert.equal((await bounded(cleaner, 'late cleaner rejection')).error?.code, locked.code);
    assert.deepEqual(await realReaddir(lockPath), [basename(freshMarker)]);
    resumeFresh.resolve();
    await bounded(freshEntered.promise, 'fresh callback');
    await assert.rejects(lock(path, () => counts.run(() => assert.fail('overlap'))), locked);
    assert.deepEqual(await realReaddir(lockPath), [basename(freshMarker)]);
  } finally {
    resumeCleaner.resolve(); resumeFresh.resolve(); finishFresh.resolve();
    try { await bounded(Promise.all([cleaner, fresh]), 'race cleanup'); } finally { restore(); }
  }
  successful(await fresh, 'fresh'); counts.assert(1);
  assert.deepEqual(await filesystem.readdir(root), []);
});

test('late parent rmdir preserves a successor marker and real callback exclusivity', async t => {
  const { root, path, lockPath } = await fixture(t);
  const parentPaused = deferred(), resumeParent = deferred();
  const freshEntered = deferred(), finishFresh = deferred();
  let delayed = false;
  const restore = schedule(t, {
    rmdir: async (role, args, real) => {
      if (role === 'old' && args[0] === lockPath && !delayed) {
        delayed = true; parentPaused.resolve(); await resumeParent.promise;
      }
      return real();
    },
  });
  const counts = counter();
  const old = tracked('old', path, () => counts.run(() => 'old'));
  let fresh;
  try {
    await bounded(parentPaused.promise, 'old owner released its own marker');
    assert.deepEqual(await filesystem.readdir(lockPath), []);
    fresh = tracked('fresh', path, () => counts.run(async () => {
      freshEntered.resolve(); await finishFresh.promise; return 'fresh';
    }));
    await bounded(freshEntered.promise, 'successor callback');
    const owner = await filesystem.readdir(lockPath);
    assert.equal(owner.length, 1);
    resumeParent.resolve();
    successful(await bounded(old, 'old parent cleanup'), 'old');
    assert.deepEqual(await filesystem.readdir(lockPath), owner);
    await assert.rejects(lock(path, () => counts.run(() => assert.fail('overlap'))), locked);
  } finally {
    resumeParent.resolve(); finishFresh.resolve();
    try { await bounded(Promise.all([old, fresh]), 'parent race cleanup'); } finally { restore(); }
  }
  successful(await fresh, 'fresh'); counts.assert(2);
  assert.deepEqual(await filesystem.readdir(root), []);
});

test('parent removal between creation and owner publication retries with a fresh marker', async t => {
  const { root, path, lockPath } = await fixture(t);
  const realRmdir = filesystem.rmdir.bind(filesystem);
  let interrupted = false;
  const attemptedMarkers = [];
  const restore = schedule(t, {
    mkdir: async (_role, args, real) => {
      if (dirname(args[0]) === lockPath) {
        attemptedMarkers.push(basename(args[0]));
        if (!interrupted) { interrupted = true; await realRmdir(lockPath); }
      }
      return real();
    },
  });
  try {
    assert.equal(await lock(path, canonicalPath => {
      assert.equal(canonicalPath, path); return 'retried';
    }), 'retried');
    assert.equal(attemptedMarkers.length, 2);
    assert.notEqual(attemptedMarkers[0], attemptedMarkers[1]);
    assert.deepEqual(await filesystem.readdir(root), []);
  } finally { restore(); }
});

test('a contender published after the final singleton scan still cannot overlap the callback', async t => {
  const { root, path, lockPath } = await fixture(t);
  const scanned = deferred(), returnScan = deferred(), published = deferred(), continueContender = deferred();
  const entered = deferred(), finish = deferred();
  let scans = 0;
  const restore = schedule(t, {
    readdir: async (role, args, real) => {
      const result = await real();
      if (role === 'first' && args[0] === lockPath && ++scans === 2) {
        assert.equal(result.length, 1); scanned.resolve(); await returnScan.promise;
      }
      return result;
    },
    mkdir: async (role, args, real) => {
      const result = await real();
      if (role === 'contender' && dirname(args[0]) === lockPath) {
        published.resolve(); await continueContender.promise;
      }
      return result;
    },
  });
  const counts = counter();
  const first = tracked('first', path, () => counts.run(async () => { entered.resolve(); await finish.promise; }));
  let contender;
  try {
    await bounded(scanned.promise, 'final singleton scan');
    contender = tracked('contender', path, () => counts.run(() => assert.fail('post-scan overlap')));
    await bounded(published.promise, 'post-scan marker');
    returnScan.resolve(); await bounded(entered.promise, 'first callback after stale singleton scan');
    assert.equal((await filesystem.readdir(lockPath)).length, 2);
    continueContender.resolve();
    assert.equal((await bounded(contender, 'post-scan contender')).error?.code, locked.code);
    assert.equal((await filesystem.readdir(lockPath)).length, 1);
  } finally {
    returnScan.resolve(); continueContender.resolve(); finish.resolve();
    try { await bounded(Promise.all([first, contender]), 'post-scan cleanup'); } finally { restore(); }
  }
  successful(await first, undefined); counts.assert(1);
  assert.deepEqual(await filesystem.readdir(root), []);
});

test('same PID with distinct nonces remains contention after both markers are published', async t => {
  const { root, path, lockPath } = await fixture(t);
  const entered = deferred(), finish = deferred();
  const published = [];
  const restore = schedule(t, {
    mkdir: async (_role, args, real) => {
      const result = await real();
      if (dirname(args[0]) === lockPath) published.push(basename(args[0]));
      return result;
    },
  });
  const counts = counter();
  const first = tracked('first', path, () => counts.run(async () => { entered.resolve(); await finish.promise; }));
  try {
    await bounded(entered.promise, 'first same-PID callback');
    await assert.rejects(lock(path, () => counts.run(() => assert.fail('same-PID overlap'))), locked);
    assert.equal(published.length, 2);
    assert.notEqual(published[0], published[1]);
    for (const marker of published) assert.ok(marker.startsWith(`owner.${localHost}.${process.pid}.`));
    assert.deepEqual(await filesystem.readdir(lockPath), [published[0]]);
  } finally {
    finish.resolve();
    try { await bounded(first, 'same-PID cleanup'); } finally { restore(); }
  }
  successful(await first, undefined); counts.assert(1);
  assert.deepEqual(await filesystem.readdir(root), []);
});

test('parent symlink aliases share one canonical lock domain and callback path', async t => {
  const { root, path } = await fixture(t);
  const actual = join(root, 'actual'), alias = join(root, 'alias');
  await filesystem.mkdir(actual, { mode: 0o700 });
  await filesystem.symlink(actual, alias, 'dir');
  const target = join(actual, basename(path)), aliasTarget = join(alias, basename(path));
  const entered = deferred(), finish = deferred();
  const counts = counter();
  const first = tracked('alias', aliasTarget, canonicalPath => counts.run(async () => {
    assert.equal(canonicalPath, target); entered.resolve(); await finish.promise;
  }));
  try {
    await bounded(entered.promise, 'alias callback');
    await assert.rejects(lock(target, () => counts.run(() => assert.fail('alias overlap'))), locked);
  } finally { finish.resolve(); await bounded(first, 'alias cleanup'); }
  successful(await first, undefined);
  assert.equal(await lock(target, canonicalPath => counts.run(() => canonicalPath)), target);
  counts.assert(2);
  assert.deepEqual(await filesystem.readdir(actual), []);
});

for (const kind of ['symlink', 'hardlink']) test(`WAL leaf ${kind} is rejected before the callback`, async t => {
  const { root, path, lockPath } = await fixture(t);
  const original = join(root, 'original');
  await filesystem.writeFile(original, 'preserve', { mode: 0o600 });
  if (kind === 'symlink') await filesystem.symlink(original, path);
  else await filesystem.link(original, path);
  await assert.rejects(lock(path, () => assert.fail('linked WAL callback')), { code: 'MAINNET_V8_WAL_PATH_INVALID' });
  assert.equal(await filesystem.readFile(original, 'utf8'), 'preserve');
  await assert.rejects(filesystem.lstat(lockPath), { code: 'ENOENT' });
  assert.equal((await filesystem.lstat(path)).isSymbolicLink(), kind === 'symlink');
});

for (const kind of ['parent', 'marker']) test(`${kind} lock symlink is rejected and its target is preserved`, async t => {
  const { root, path, lockPath } = await fixture(t);
  const original = join(root, 'original');
  await filesystem.mkdir(original, { mode: 0o700 });
  let linkPath = lockPath;
  if (kind === 'marker') {
    await filesystem.mkdir(lockPath, { mode: 0o700 });
    linkPath = join(lockPath, markerName(99999999));
  }
  await filesystem.symlink(original, linkPath, 'dir');
  await assert.rejects(lock(path, () => assert.fail('linked lock callback')), { code: 'MAINNET_V8_WAL_LOCK_INVALID' });
  assert.equal((await filesystem.lstat(linkPath)).isSymbolicLink(), true);
  assert.deepEqual(await filesystem.readdir(original), []);
  if (kind === 'marker') assert.deepEqual(await filesystem.readdir(lockPath), [basename(linkPath)]);
});

// Every child contends through the production primitive. IPC holds successful
// callbacks open, so the parent can assert both refusal and durable ownership.
function childParticipant(t, path) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withMainnetV8WalFileLock as lock } from ${JSON.stringify(moduleUrl)};
    process.on('disconnect', () => process.exit(1));
    process.on('message', async message => {
      if (message !== 'acquire') return;
      try {
        await lock(${JSON.stringify(path)}, async () => {
          process.send({ type: 'entered', pid: process.pid });
          await new Promise(resolve => {
            const listener = message => {
              if (message === 'release') { process.off('message', listener); resolve(); }
            };
            process.on('message', listener);
          });
          process.send({ type: 'leaving', pid: process.pid });
        });
        process.send({ type: 'released', pid: process.pid });
      } catch (error) { process.send({ type: 'rejected', code: error.code, pid: process.pid }); }
    });
    process.send({ type: 'ready', pid: process.pid });
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const pending = [], waiting = [];
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.on('message', message => waiting.length ? waiting.shift().resolve(message) : pending.push(message));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.on('error', error => { while (waiting.length) waiting.shift().reject(error); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await bounded(exited, 'child cleanup');
  });
  return {
    child, exited,
    send(message) { child.send(message); },
    async next(type) {
      const message = await bounded(pending.length ? Promise.resolve(pending.shift())
        : new Promise((resolve, reject) => waiting.push({ resolve, reject })), `child ${child.pid} ${type}: ${stderr}`);
      assert.equal(message.type, type, JSON.stringify(message)); return message;
    },
  };
}

test('three real child writers reject overlap and recover a killed winner while contenders stay alive', async t => {
  const { root, path, lockPath } = await fixture(t);
  const peers = [childParticipant(t, path), childParticipant(t, path), childParticipant(t, path)];
  await Promise.all(peers.map(peer => peer.next('ready')));
  const [first, second, third] = peers;
  const active = new Set();
  let maximum = 0;
  const entered = async peer => {
    const message = await peer.next('entered');
    active.add(message.pid); maximum = Math.max(maximum, active.size);
    assert.equal(active.size, 1, 'real callbacks must never overlap');
  };
  const rejected = async peer => { assert.equal((await peer.next('rejected')).code, locked.code); };
  first.send('acquire'); await entered(first);
  second.send('acquire'); third.send('acquire');
  await Promise.all([rejected(second), rejected(third)]);
  const deadOwner = await filesystem.readdir(lockPath);
  assert.equal(deadOwner.length, 1);
  assert.ok(deadOwner[0].startsWith(`owner.${localHost}.${first.child.pid}.`));
  first.child.kill('SIGKILL');
  assert.equal((await bounded(first.exited, 'winner death')).signal, 'SIGKILL');
  active.delete(first.child.pid);
  assert.deepEqual(await filesystem.readdir(lockPath), deadOwner);
  second.send('acquire'); await entered(second);
  assert.equal((await filesystem.readdir(lockPath)).some(name => name === deadOwner[0]), false);
  third.send('acquire'); await rejected(third);
  second.send('release'); active.delete((await second.next('leaving')).pid); await second.next('released');
  third.send('acquire'); await entered(third);
  third.send('release'); active.delete((await third.next('leaving')).pid); await third.next('released');
  assert.equal(maximum, 1); assert.equal(active.size, 0);
  assert.deepEqual(await filesystem.readdir(root), []);
});
