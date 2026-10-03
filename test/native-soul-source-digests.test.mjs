import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { captureNativeSoulSource, restoreNativeSoulSource, verifyNativeSoulSourceCheckout,
  assertNativeSoulSourceRevision } from '../scripts/native-soul-source-cas.mjs';
import { fixtureDependencySerialization, populateFixtureLockDigests } from './fixtures/native-source-digest-fixture.mjs';

const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'soulidity', 'release'];
const names = Object.fromEntries(roles.map(role => [role, role === 'soulidity' ? role : `animacraft_v8_${role}`]));
const exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const invalid = { code: 'NATIVE_SOUL_SOURCE_INVALID' };

// Independently captured from Rust serde + toml_edit =0.22.24, the pinned Sui
// legacy-manifest RepinTriggers layout. Probe source was inspected at
// /tmp/native-manifest-digest-probe-Legj2D/src/main.rs; no production JS normalizer
// produced these expected strings/hashes, and the Rust binary is not needed by CI.
const golden = {
  implicit: ['deps = { std = { System = { system = "std" }, override = true, use-environment = "mainnet" }, sui = { System = { system = "sui" }, override = true, use-environment = "mainnet" } }\n', 'E41BBD67BE8940D26C79D78B028477EF5B33BA217A1282C78ACB344CF8A5ECF6'],
  releaseOriginal: ['deps = { animacraft_v8_core = { Local = { local = "../animacraft_v8_core" }, override = false, use-environment = "mainnet" }, soulidity = { Local = { local = "../../../so/move/soulidity" }, override = false, use-environment = "mainnet" }, std = { System = { system = "std" }, override = true, use-environment = "mainnet" }, sui = { System = { system = "sui" }, override = true, use-environment = "mainnet" } }\n', '5F9D8D7A43AC76A76E0FD2F3EEEBB84F98F67CB3C56B436711FB5206CE8130E6'],
  releaseDerived: ['deps = { animacraft_v8_core = { Local = { local = "../animacraft_v8_core" }, override = false, use-environment = "mainnet" }, soulidity = { Local = { local = "../soulidity" }, override = false, use-environment = "mainnet" }, std = { System = { system = "std" }, override = true, use-environment = "mainnet" }, sui = { System = { system = "sui" }, override = true, use-environment = "mainnet" } }\n', '348101E976AA1EF820894D4192944DCC6FF029D3652E89977A7BEFCA4A90C520'],
  market: ['deps = { Alpha = { Git = { git = "https://example.invalid/a.git", rev = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", subdir = "pkg/a" }, override = false, use-environment = "mainnet" }, Zebra = { Git = { git = "https://example.invalid/z.git", rev = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", subdir = "pkg/z" }, override = true, use-environment = "mainnet" }, animacraft_v8_core = { Local = { local = "../animacraft_v8_core" }, override = false, use-environment = "mainnet" }, animacraft_v8_release = { Local = { local = "../animacraft_v8_release" }, override = false, modes = ["test"], use-environment = "mainnet" }, std = { System = { system = "std" }, override = true, use-environment = "mainnet" }, sui = { System = { system = "sui" }, override = true, use-environment = "mainnet" } }\n', '107EA76E1287FA697D862BA76E0532FE3F52F27C699CEF1EAF6BD3EA00F82A43'],
};
const gitA = 'Alpha = { git = "https://example.invalid/a.git", subdir = "pkg/a", rev = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }';
const gitZ = 'Zebra = { git = "https://example.invalid/z.git", subdir = "pkg/z", rev = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", override = true }';
const section = (text, name) => text.split(`[pinned.mainnet.${name}]\n`)[1]?.split('\n[')[0];
const digest = (text, name) => /manifest_digest = "([0-9A-F]{64})"/.exec(section(text, name))?.[1];
async function fixture(t, coreExtra = '') {
  const temp = await mkdtemp(join(tmpdir(), 'native-digest-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const roots = { ac: join(temp, 'ac'), so: join(temp, 'so') };
  for (const root of Object.values(roots)) {
    await mkdir(join(root, 'move'), { recursive: true }); await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['-c', 'user.name=Digest Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'base'], { cwd: root });
  }
  const pkg = role => join(roots[role === 'soulidity' ? 'so' : 'ac'], 'move', names[role]);
  for (const role of roles) {
    await mkdir(join(pkg(role), 'sources'), { recursive: true });
    const deps = role === 'core' ? [] : role === 'release' ? ['core', 'soulidity'] : role === 'soulidity' ? ['core', 'output'] : ['core'];
    const manifest = `[package]\nname = "${names[role]}"\nedition = "2024.beta"\n${role === 'core' ? coreExtra : ''}\n[dependencies]\n`
      + (role === 'market' ? gitZ + '\n' : '')
      + deps.map(dep => `${names[dep]} = { local = "${relative(pkg(role), pkg(dep))}" }`).join('\n')
      + (role === 'market' ? `\n${gitA}\n[dev-dependencies]\nanimacraft_v8_release = { local = "../animacraft_v8_release" }` : '')
      + `\n[addresses]\n${names[role]} = "0x0"\n`;
    await writeFile(join(pkg(role), 'Move.toml'), manifest);
    await writeFile(join(pkg(role), 'Move.lock'), '[move]\nversion = 4\n');
    await writeFile(join(pkg(role), 'sources/main.move'), `module ${names[role]}::fixture;\npublic fun marker(): u8 { 1 }\n`);
  }
  await populateFixtureLockDigests(pkg, roles, names);
  const storePath = join(temp, 'cas'), checkoutRoot = join(temp, 'checkout');
  const f = { temp, roots, pkg, storePath, checkoutRoot,
    capture: () => captureNativeSoulSource({ animacraftRoot: roots.ac, soulidityRoot: roots.so, storePath }) };
  f.restore = sourceRevision => restoreNativeSoulSource({ sourceRevision, storePath, checkoutRoot });
  return f;
}
async function sourceBytes(f, revision, role, filename, original = false) {
  const pkg = revision.packages.find(p => p.role === role);
  return readFile(join(f.storePath, pkg[original ? 'originalFiles' : 'files'].find(row => row.path === filename).sha256), 'utf8');
}
async function rehashCas(f, revision, role, transform, { original = true, derived = true } = {}) {
  const copy = structuredClone(revision), pkg = copy.packages.find(p => p.role === role);
  for (const key of [...(original ? ['originalFiles'] : []), ...(derived ? ['files'] : [])]) {
    const row = pkg[key].find(row => row.path === 'Move.lock'), old = await readFile(join(f.storePath, row.sha256), 'utf8');
    const bytes = Buffer.from(transform(old)); assert.notEqual(bytes.toString(), old, 'actual attack');
    Object.assign(row, { sha256: hash(bytes), byteLength: String(bytes.length) }); await writeFile(join(f.storePath, row.sha256), bytes);
  }
  const { snapshotSha256, ...payload } = copy; copy.snapshotSha256 = hash(canonical(payload)); assertNativeSoulSourceRevision(copy);
  const expected = new Set(['snapshot.json', ...copy.packages.flatMap(p => [...p.originalFiles, ...p.files].map(row => row.sha256))]);
  for (const name of await readdir(f.storePath)) if (!expected.has(name)) await rm(join(f.storePath, name));
  await writeFile(join(f.storePath, 'snapshot.json'), canonical(copy)); return copy;
}

test('Rust golden serialization binds implicit framework, Git order/override and Market test-mode digests', async t => {
  const f = await fixture(t), revision = await f.capture();
  for (const [role, key] of [['core', 'implicit'], ['market', 'market'], ['release', 'releaseOriginal']]) {
    const raw = await readFile(join(f.pkg(role), 'Move.toml'), 'utf8');
    assert.equal(fixtureDependencySerialization(raw), golden[key][0], 'input constructor agrees with independent Rust bytes');
    assert.equal(hash(golden[key][0]).toUpperCase(), golden[key][1]);
    assert.equal(digest(await sourceBytes(f, revision, role, 'Move.lock', true), names[role]), golden[key][1]);
  }
  assert.equal(digest(await sourceBytes(f, revision, 'core', 'Move.lock'), names.core), golden.implicit[1]);
  assert.equal(digest(await sourceBytes(f, revision, 'market', 'Move.lock'), names.market), golden.market[1]);
  assert.equal(fixtureDependencySerialization(await sourceBytes(f, revision, 'release', 'Move.toml')), golden.releaseDerived[0]);
  assert.equal(digest(await sourceBytes(f, revision, 'release', 'Move.lock'), names.release), golden.releaseDerived[1]);
});
test('cross-repository relocation changes the root and every transitive occurrence, then cold restore verifies exact bytes', async t => {
  const f = await fixture(t), revision = await f.capture();
  for (const role of ['release', 'market']) {
    assert.equal(digest(await sourceBytes(f, revision, role, 'Move.lock', true), names.release), golden.releaseOriginal[1]);
    assert.equal(digest(await sourceBytes(f, revision, role, 'Move.lock'), names.release), golden.releaseDerived[1]);
  }
  await rm(f.roots.ac, { recursive: true }); await rm(f.roots.so, { recursive: true });
  await f.restore(revision); await verifyNativeSoulSourceCheckout({ sourceRevision: revision, checkoutRoot: f.checkoutRoot });
});
test('explicit implicit-dependencies=false uses the exact empty serde representation', async t => {
  const f = await fixture(t, 'implicit-dependencies = false\n'), revision = await f.capture();
  assert.equal(digest(await sourceBytes(f, revision, 'core', 'Move.lock'), names.core), hash('deps = {}\n').toUpperCase());
  await f.restore(revision);
});
test('a distinct Git alias is preserved byte-for-byte, never assigned the similarly named local package digest', async t => {
  const f = await fixture(t), file = join(f.pkg('market'), 'Move.lock');
  const alias = '\n[pinned.mainnet.animacraft_v8_core_2]\nsource = { git = "https://example.invalid/other.git", subdir = "pkg", rev = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }\nmanifest_digest = "' + 'F'.repeat(64) + '"\n';
  await writeFile(file, await readFile(file, 'utf8') + alias);
  const revision = await f.capture(); assert.ok((await sourceBytes(f, revision, 'market', 'Move.lock')).endsWith(alias));
  await f.restore(revision);
});

const attacks = {
  'wrong original digest': text => text.replace(/manifest_digest = "[0-9A-F]{64}"/, `manifest_digest = "${'A'.repeat(64)}"`),
  'missing root digest': text => text.replace(/manifest_digest = "[0-9A-F]{64}"\n/, ''),
  'wrong digest environment': text => text.replace('use_environment = "mainnet"', 'use_environment = "testnet"'),
  'same-name Git instead of root': text => text.replace('source = { root = true }', 'source = { git = "https://example.invalid/core.git", subdir = "pkg", rev = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }'),
  'same-name Git without digest': text => text.replace('source = { root = true }', 'source = { git = "https://example.invalid/core.git", subdir = "pkg", rev = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }').replace(/manifest_digest = "[0-9A-F]{64}"\n/, ''),
  'missing own root section': text => text.replace(/\n\[pinned\.mainnet\.animacraft_v8_core\][\s\S]*$/, '\n'),
};
for (const [name, change] of Object.entries(attacks)) for (const mode of ['capture', 'cold']) test(`${mode} rejects ${name}, including a fully rehashed CAS`, async t => {
  const f = await fixture(t);
  if (mode === 'capture') {
    const file = join(f.pkg('core'), 'Move.lock'), old = await readFile(file, 'utf8');
    assert.notEqual(change(old), old); await writeFile(file, change(old)); await assert.rejects(f.capture(), invalid);
  } else {
    const revision = await f.capture(), forged = await rehashCas(f, revision, 'core', change);
    await assert.rejects(f.restore(forged), error => error.code === invalid.code && !/CAS bytes|snapshot commitment|CAS inventory/.test(error.message));
  }
});
test('derived digest forgery fails semantic cold reconstruction after every CAS hash is updated', async t => {
  const f = await fixture(t), revision = await f.capture();
  const forged = await rehashCas(f, revision, 'release', text => text.replace(golden.releaseDerived[1], 'A'.repeat(64)), { original: false });
  await assert.rejects(f.restore(forged), error => error.code === invalid.code && /transformation drift/.test(error.message));
});
for (const attack of ['missing transitive section', 'missing local mapping', 'wrong local mapping', 'native mapping to Git alias']) for (const mode of ['capture', 'cold']) test(`${mode} rejects ${attack} in an otherwise valid closure`, async t => {
  const f = await fixture(t), file = join(f.pkg('market'), 'Move.lock');
  const change = old => attack === 'missing transitive section' ? old.replace(/\n\[pinned\.mainnet\.soulidity\][^\[]*/, '\n')
    : attack === 'native mapping to Git alias' ? old.replace('animacraft_v8_release = "animacraft_v8_release"', 'animacraft_v8_release = "Other"')
      + '\n[pinned.mainnet.Other]\nsource = { git = "https://example.invalid/other.git", subdir = "pkg", rev = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }\n'
    : old.replace('animacraft_v8_release = "animacraft_v8_release"', attack === 'missing local mapping' ? '' : 'animacraft_v8_release = "animacraft_v8_core"').replace(',  }', ' }');
  if (mode === 'capture') {
    const old = await readFile(file, 'utf8'), changed = change(old);
    assert.notEqual(changed, old); await writeFile(file, changed); await assert.rejects(f.capture(), invalid);
  } else {
    const revision = await f.capture(), forged = await rehashCas(f, revision, 'market', change);
    await assert.rejects(f.restore(forged), error => error.code === invalid.code && !/CAS bytes|snapshot commitment|CAS inventory/.test(error.message));
  }
});
test('checkout verification rejects compiler-time lock mutation, without blessing regenerated digests', async t => {
  const f = await fixture(t), revision = await f.capture(); await f.restore(revision);
  await verifyNativeSoulSourceCheckout({ sourceRevision: revision, checkoutRoot: f.checkoutRoot });
  const file = join(f.checkoutRoot, 'move', names.release, 'Move.lock');
  // Deterministic offline compiler-transport stand-in; not a Move build/VM claim.
  await exec(process.execPath, ['-e', 'const fs=require("node:fs");fs.appendFileSync(process.argv[1],"\\n# resolver rewrote the lock\\n")', file]);
  await assert.rejects(verifyNativeSoulSourceCheckout({ sourceRevision: revision, checkoutRoot: f.checkoutRoot }), error => error.code === invalid.code && /cold source bytes drift/.test(error.message));
});
