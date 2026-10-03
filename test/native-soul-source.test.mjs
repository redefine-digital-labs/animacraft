import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { populateFixtureLockDigests } from './fixtures/native-source-digest-fixture.mjs';
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS, readNativeSoulExternalPublications } from '../scripts/native-soul-external-publications.mjs';
import { captureNativeSoulSource, restoreNativeSoulSource, assertNativeSoulSourceRevision,
  verifyNativeSoulSourceCheckout, NATIVE_SOUL_SOURCE_ORDER as ORDER, NATIVE_SOUL_SOURCE_NAMES as NAMES } from '../scripts/native-soul-source-cas.mjs';
import { prepareMainnetV8Source, inspectMainnetV8FreshSourceArchive, inspectMainnetV8GitSource,
  prepareMainnetV8Release, buildMainnetV8Package } from '../scripts/mainnet-v8-release.mjs';
import { MAINNET_V8_SUI_VERSION, MAINNET_V8_SUI_VERSION_OUTPUT, MAINNET_V8_SUI_SOURCE_COMMIT,
  MAINNET_V8_SUI_BINARY_SHA256, MAINNET_V8_FRAMEWORK_REVISION, MAINNET_V8_RELEASE_SIGNER,
  assertMainnetV8SourceArtifact, assertMainnetV8SourcePlan, buildMainnetV8ReleasePlan,
  buildMainnetV8SealPolicyTemplate, MAINNET_V8_BROWSER_KEY_SERVERS, MAINNET_V8_BROWSER_SEAL_THRESHOLD, MAINNET_V8_ROLE_ORDER, renderPublishedToml } from '../scripts/mainnet-v8-release-lib.mjs';

const exec = promisify(execFile);
const TOOLCHAIN = { suiVersion: MAINNET_V8_SUI_VERSION, suiVersionOutput: MAINNET_V8_SUI_VERSION_OUTPUT,
  suiSourceCommit: MAINNET_V8_SUI_SOURCE_COMMIT, suiBinarySha256: MAINNET_V8_SUI_BINARY_SHA256,
  frameworkRevision: MAINNET_V8_FRAMEWORK_REVISION };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const bad = error => /source|SOURCE|ENOENT|EEXIST/.test(error.code ?? '') || /source|manifest|CAS|dependency/i.test(error.message);
async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'native-source-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const roots = { animacraft: join(temp, 'animacraft'), soulidity: join(temp, 'soulidity') };
  for (const root of Object.values(roots)) {
    await mkdir(join(root, 'move'), { recursive: true });
    await exec('git', ['init', '-q'], { cwd: root });
    await writeFile(join(root, 'base.txt'), 'base provenance only');
    await exec('git', ['add', 'base.txt'], { cwd: root });
    await exec('git', ['-c', 'user.name=Source Fixture', '-c', 'user.email=source@example.invalid', 'commit', '-qm', 'base'], { cwd: root });
  }
  const pkg = role => join(roots[role === 'soulidity' ? 'soulidity' : 'animacraft'], 'move', NAMES[role]);
  for (const role of ORDER) {
    const root = pkg(role); await mkdir(join(root, 'sources'), { recursive: true });
    const deps = role === 'soulidity' ? ['core', 'output'] : role === 'release' ? ['core', 'soulidity'] : role === 'core' ? [] : ['core'];
    await writeFile(join(root, 'Move.toml'), `[package]\nname = "${NAMES[role]}"\nedition = "2024.beta"\n\n[dependencies]\n`
      + deps.map(dep => `${NAMES[dep]} = { local = "${pkg(dep)}" }`).join('\n')
      + `\n\n[addresses]\n${NAMES[role]} = "0x0"\n`);
    await writeFile(join(root, 'Move.lock'), '[move]\nversion = 4\n'
      + deps.map(dep => `\n[pinned.mainnet.${NAMES[dep]}]\nsource = { local = "${pkg(dep)}" }\n`).join(''));
    await writeFile(join(root, 'sources', 'main.move'), `module ${NAMES[role]}::example;\npublic fun value(): u8 { 1 }\n`);
  }
  await populateFixtureLockDigests(pkg, ORDER, NAMES);
  // None of the Move files are committed; source capture must use these bytes.
  await writeFile(join(roots.animacraft, '.env'), 'DO_NOT_CAPTURE_SECRET');
  const args = { repositoryRoot: roots.animacraft, soulidityRoot: roots.soulidity,
    storePath: join(temp, 'cas'), checkoutRoot: join(temp, 'checkout'), toolchain: TOOLCHAIN };
  return { temp, roots, pkg, args, capture: () => captureNativeSoulSource({ animacraftRoot: roots.animacraft,
    soulidityRoot: roots.soulidity, storePath: args.storePath }) };
}

// Build-entry tests require the same pre-fetched pinned external Git sources as
// an approved build. Prepare an explicit dedicated MOVE_HOME with
// scripts/prepare-native-soul-external-sources.mjs before the test process.
// The test itself performs no network fetch or production validator bypass.
async function buildFixture(t) {
  const f = await fixture(t), pins = NATIVE_SOUL_EXTERNAL_PUBLICATIONS;
  const circle = pins.filter(p => ['usdc', 'stablecoin', 'sui_extensions'].includes(p.packageName));
  const declarations = pins.map(p => {
    let suffix = '';
    if (p.packageName === 'Kiosk') suffix = `, override = true, addr_subst = { "kiosk" = "${p.originalId}" }`;
    if (circle.includes(p)) {
      const addresses = circle.filter(row => p.packageName === 'usdc'
        || (p.packageName === 'stablecoin' && row.packageName !== 'usdc') || row === p);
      suffix = `${p.packageName === 'usdc' ? '' : ', override = true'}, addr_subst = { ${addresses.map(row => `"${row.packageName}" = "${row.originalId}"`).join(', ')} }`;
    }
    return `${p.packageName} = { git = "${p.git}", subdir = "${p.subdir}", rev = "${p.rev}"${suffix} }`;
  }).join('\n');
  const replaced = pins.filter(p => !['WAL', 'Walrus'].includes(p.packageName));
  const manifest = join(f.pkg('soulidity'), 'Move.toml');
  await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('[dependencies]', `[dependencies]\n${declarations}`)
    + '\n[dep-replacements.mainnet]\n' + replaced.map(p => `${p.packageName} = { published-at = "${p.publishedAt}", original-id = "${p.originalId}" }`).join('\n') + '\n');
  for (const role of ORDER) {
    const filename = join(f.pkg(role), 'Move.lock');
    let lock = await readFile(filename, 'utf8');
    lock += pins.map(p => `\n[pinned.mainnet.${p.packageName}]\nsource = { git = "${p.git}", subdir = "${p.subdir}", rev = "${p.rev}" }\nuse_environment = "mainnet"\nmanifest_digest = "${'A'.repeat(64)}"\ndeps = {}\n`).join('');
    if (role === 'soulidity') lock = lock.replace(/(\[pinned.mainnet.soulidity\]\n)([^\[]*)/, (_, header, body) =>
      header + body.replace(/^deps = \{ /m, `deps = { ${replaced.map(p => `${p.packageName} = "${p.packageName}"`).join(', ')}, `));
    await writeFile(filename, lock);
  }
  await populateFixtureLockDigests(f.pkg, ORDER, NAMES);
  const plan = await prepareMainnetV8Source(f.args);
  await writeFile(join(f.temp, 'Published.toml'), renderPublishedToml({ buildEnv: 'mainnet', chainId: '35834a8a', entries: [],
    externalEntries: readNativeSoulExternalPublications({ sourceRevision: plan.sourceRevision, checkoutRoot: f.args.checkoutRoot }) }));
  return { f, plan };
}

test('actual runner SOURCE prepare -> artifact/plan -> cold restore uses all current eight dirty packages', async t => {
  const f = await fixture(t), plan = await prepareMainnetV8Source(f.args);
  assertMainnetV8SourcePlan(plan);
  assert.deepEqual(plan.packages.map(p => p.role), ORDER);
  assert.equal(MAINNET_V8_ROLE_ORDER.length, 7, 'source package count never changes Catalog roles');
  assert.equal('clean' in plan.sourceRevision, false);
  assert.deepEqual(await inspectMainnetV8GitSource(f.args), plan.sourceRevision.repositories);
  for (const pkg of plan.packages) {
    assertMainnetV8SourceArtifact(pkg.sourceArtifact);
    assert.equal(pkg.sourceArtifact.release.snapshotSha256, plan.sourceRevision.snapshotSha256);
    const manifest = await readFile(join(f.args.checkoutRoot, 'move', pkg.packageName, 'Move.toml'), 'utf8');
    assert.match(manifest, new RegExp(`${pkg.packageName} = "0x0"`));
    assert.equal(manifest.includes(f.temp), false, 'remapped build manifest does not escape cold checkout');
  }
  const soul = plan.sourceRevision.packages.find(p => p.role === 'soulidity');
  assert.notEqual(soul.originalFiles.find(p => p.path === 'Move.toml').sha256, soul.files.find(p => p.path === 'Move.toml').sha256);
  const casText = (await Promise.all((await readdir(f.args.storePath)).map(name => readFile(join(f.args.storePath, name), 'utf8')))).join();
  assert.equal(casText.includes('DO_NOT_CAPTURE_SECRET'), false);
  // The exact captured bytes survive removal of both original repositories.
  await rm(f.roots.animacraft, { recursive: true }); await rm(f.roots.soulidity, { recursive: true });
  const cold = await inspectMainnetV8FreshSourceArchive({ sourceStorePath: f.args.storePath, plan });
  assert.equal(cold.sourceRevision.snapshotSha256, plan.sourceRevision.snapshotSha256);
  assert.deepEqual(cold.sourceCommitments, Object.fromEntries(plan.packages.map(p => [p.role, p.sourceCommitment])));
});
test('dirty changes and untracked Move source change identity without claiming a new base Git commit', async t => {
  const f = await fixture(t), first = await prepareMainnetV8Source(f.args);
  await writeFile(join(f.pkg('core'), 'sources', 'new.move'), 'module animacraft_v8_core::new_source;\n');
  const second = await prepareMainnetV8Source({ ...f.args, storePath: join(f.temp, 'cas2'), checkoutRoot: join(f.temp, 'checkout2') });
  assert.notEqual(first.sourceRevision.snapshotSha256, second.sourceRevision.snapshotSha256);
  assert.deepEqual(first.sourceRevision.repositories, second.sourceRevision.repositories);
  assert.equal(second.sourceRevision.packages[0].files.some(r => r.path === 'sources/new.move'), true);
});
test('public release plan retains all eight source packages and rejects seven', async t => {
  const f = await fixture(t), source = await prepareMainnetV8Source(f.args);
  const plan = buildMainnetV8ReleasePlan({ ...source, sender: MAINNET_V8_RELEASE_SIGNER,
    sealPolicy: buildMainnetV8SealPolicyTemplate({ keyServers: MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId }) => ({ objectId, weight: '1' })), threshold: MAINNET_V8_BROWSER_SEAL_THRESHOLD }) });
  assert.equal(plan.packages.length, 8);
  assert.equal(plan.steps.length, 14);
  assert.throws(() => assertMainnetV8SourcePlan({ ...source, packages: source.packages.slice(0, 7) }));
});
test('original prepare rejects a missing compiler before RPC or READY', async t => {
  const f = await fixture(t); let called = false;
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network expected'); });
  const client = new Proxy({}, { get() { called = true; throw new Error('No network expected'); } });
  await assert.rejects(prepareMainnetV8Release({ repositoryRoot: f.roots.animacraft, soulidityRoot: f.roots.soulidity,
    stateDir: join(f.temp, 'release-state'), suiBinary: join(f.temp, 'missing-sui'), sender: MAINNET_V8_RELEASE_SIGNER,
    sealPolicy: buildMainnetV8SealPolicyTemplate({ keyServers: MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId }) => ({ objectId, weight: '1' })), threshold: MAINNET_V8_BROWSER_SEAL_THRESHOLD }), client }),
  { code: 'ENOENT' });
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(called, false); assert.equal((await readdir(f.temp)).some(name => name.startsWith('release-state')), false);
});
for (const problem of ['old-schema', 'seven-packages', 'source-hash', 'original-hash', 'source-path', 'source-address', 'repository']) {
  test(`source identity rejects ${problem}`, async t => {
    const f = await fixture(t), source = await prepareMainnetV8Source(f.args), copy = structuredClone(source);
    if (problem === 'old-schema') copy.sourceRevision = { gitCommit: '1'.repeat(40), gitTree: '2'.repeat(40), clean: true };
    if (problem === 'seven-packages') copy.sourceRevision.packages.pop();
    if (problem === 'source-hash') copy.packages[0].sourceArtifact.files[0].sha256 = '0'.repeat(64);
    if (problem === 'original-hash') copy.packages[0].sourceArtifact.originalFiles[0].sha256 = '0'.repeat(64);
    if (problem === 'source-path') copy.sourceRevision.packages[0].files[0].path = '../.env';
    if (problem === 'source-address') copy.sourceRevision.packages[0].packageName = 'other';
    if (problem === 'repository') copy.packages[0].sourceArtifact.release.repository = 'soulidity';
    assert.throws(() => assertMainnetV8SourcePlan(copy));
  });
}
for (const problem of ['source-file-symlink', 'source-dir-symlink', 'package-symlink', 'missing-lock', 'nonzero-address',
  'unknown-local', 'wrong-local-target', 'escaped-local', 'old-dependency', 'unknown-lock-edge', 'multiline-local']) {
  test(`capture rejects ${problem} without modifying source`, async t => {
    const f = await fixture(t), root = f.pkg('core'), manifest = join(root, 'Move.toml');
    if (problem === 'source-file-symlink') { await rm(join(root, 'sources/main.move')); await symlink(join(f.roots.animacraft, '.env'), join(root, 'sources/main.move')); }
    if (problem === 'source-dir-symlink') { await rm(join(root, 'sources'), { recursive: true }); await symlink(join(f.pkg('seal'), 'sources'), join(root, 'sources')); }
    if (problem === 'package-symlink') { await rm(root, { recursive: true }); await symlink(f.pkg('seal'), root); }
    if (problem === 'missing-lock') await rm(join(root, 'Move.lock'));
    if (problem === 'nonzero-address') await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('"0x0"', '"0x100"'));
    if (problem === 'unknown-local') await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('[dependencies]', `[dependencies]\nother = { local = "../other" }`));
    if (problem === 'wrong-local-target') await writeFile(join(f.pkg('seal'), 'Move.toml'), (await readFile(join(f.pkg('seal'), 'Move.toml'), 'utf8')).replace(f.pkg('core'), f.pkg('output')));
    if (problem === 'escaped-local') await writeFile(join(f.pkg('seal'), 'Move.toml'), (await readFile(join(f.pkg('seal'), 'Move.toml'), 'utf8')).replace(f.pkg('core'), '/tmp/outside'));
    if (problem === 'old-dependency') await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('[dependencies]', '[dependencies]\nanimacraft = { git = "https://example.invalid/old", rev = "old" }'));
    if (problem === 'unknown-lock-edge') await writeFile(join(root, 'Move.lock'), '[pinned.mainnet.soulidity]\nsource = { local = "../soulidity" }\n');
    if (problem === 'multiline-local') await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('[dependencies]', '[dependencies.foo]\nlocal = "../other"'));
    const original = await readFile(manifest);
    await assert.rejects(f.capture, bad);
    assert.deepEqual(await readFile(manifest), original);
  });
}
for (const problem of ['missing', 'corrupt', 'symlink', 'extra', 'manifest', 'cas-symlink']) {
  test(`cold restore rejects ${problem}, never recaptures HEAD`, async t => {
    const f = await fixture(t), plan = await prepareMainnetV8Source(f.args);
    const row = plan.sourceRevision.packages[0].files[2], filename = join(f.args.storePath, row.sha256);
    if (problem === 'missing') await rm(filename);
    if (problem === 'corrupt') await writeFile(filename, 'corrupt');
    if (problem === 'symlink') { await rm(filename); await symlink(join(f.pkg('core'), row.path), filename); }
    if (problem === 'extra') await writeFile(join(f.args.storePath, 'extra'), 'not permitted');
    if (problem === 'manifest') await writeFile(join(f.args.storePath, 'snapshot.json'), '{}');
    let sourceStorePath = f.args.storePath;
    if (problem === 'cas-symlink') { sourceStorePath = join(f.temp, 'linked-cas'); await symlink(f.args.storePath, sourceStorePath); }
    await assert.rejects(inspectMainnetV8FreshSourceArchive({ sourceStorePath, plan }), bad);
  });
}
test('cold checkout detects source edits, added files and preserves exact production zero addresses', async t => {
  const f = await fixture(t), plan = await prepareMainnetV8Source(f.args);
  await verifyNativeSoulSourceCheckout({ sourceRevision: plan.sourceRevision, checkoutRoot: f.args.checkoutRoot });
  await writeFile(join(f.args.checkoutRoot, 'move', NAMES.core, 'sources/main.move'), 'changed');
  await assert.rejects(verifyNativeSoulSourceCheckout({ sourceRevision: plan.sourceRevision, checkoutRoot: f.args.checkoutRoot }), bad);
});
test('existing build entry checks the whole captured closure before and after build; permits eighth source package', async t => {
  const { f, plan } = await buildFixture(t);
  const compiler = join(f.temp, 'fixture-compiler');
  // A deterministic compiler-transport fixture, not Sui bytecode/VM evidence.
  await writeFile(compiler, `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');
const p=process.argv[process.argv.indexOf('--path')+1],n=path.basename(p),d=path.join(p,'build',n,'bytecode_modules');
fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'example.mv'),Buffer.from([1,2,3]));
process.stdout.write(JSON.stringify({modules:['AQID'],dependencies:['0x${'1'.padStart(64, '0')}'],digest:Array(32).fill(1)}));\n`, { mode: 0o700 });
  const params = { role: 'soulidity', checkoutRoot: f.args.checkoutRoot, publishedTomlPath: join(f.temp, 'Published.toml'),
    suiBinary: compiler, sourceRevision: plan.sourceRevision, toolchain: TOOLCHAIN,
    sourceArtifact: plan.packages.find(p => p.role === 'soulidity').sourceArtifact };
  const build = await buildMainnetV8Package(params);
  assert.equal(build.role, 'soulidity'); assert.deepEqual(build.sourceArtifact, params.sourceArtifact);
  await writeFile(join(f.args.checkoutRoot, 'move', NAMES.core, 'sources', 'added.move'), 'unexpected');
  await assert.rejects(buildMainnetV8Package(params), bad);
});
test('old source artifact is rejected directly', () => assert.throws(() => assertMainnetV8SourceArtifact({
  domain: 'animacraft-v8/source-artifact/v1', role: 'core', packageName: NAMES.core,
  release: { gitCommit: '1'.repeat(40), gitTree: '2'.repeat(40) }, toolchain: TOOLCHAIN, files: [],
})));
for (const filename of ['Move.lock', 'sources/main.move']) test(`build postcheck rejects compiler-time ${filename} mutation`, async t => {
  const { f, plan } = await buildFixture(t), compiler = join(f.temp, 'mutating-compiler');
  await writeFile(compiler, `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');
const p=process.argv[process.argv.indexOf('--path')+1],n=path.basename(p),d=path.join(p,'build',n,'bytecode_modules');
fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'example.mv'),Buffer.from([1,2,3]));
fs.appendFileSync(path.join(p,${JSON.stringify(filename)}),'\\n// changed while compiler executes');
process.stdout.write(JSON.stringify({modules:['AQID'],dependencies:['0x${'1'.padStart(64, '0')}'],digest:Array(32).fill(1)}));\n`, { mode: 0o700 });
  await assert.rejects(buildMainnetV8Package({ role: 'core', checkoutRoot: f.args.checkoutRoot,
    publishedTomlPath: join(f.temp, 'Published.toml'), suiBinary: compiler, sourceRevision: plan.sourceRevision,
    toolchain: TOOLCHAIN, sourceArtifact: plan.packages[0].sourceArtifact }),
  error => error.code === 'NATIVE_SOUL_SOURCE_INVALID' && /cold source bytes drift/.test(error.message));
});
const disguisedSources = [
  ['escaped inline key', 'Move.toml', '[dependencies]\nOutside = { "\\u006cocal" = "/tmp/outside" }'],
  ['quoted inline key', 'Move.toml', '[dependencies]\nOutside = { "local" = "/tmp/outside" }'],
  ['dotted dependency key', 'Move.toml', '[dependencies]\nOutside."\\u006cocal" = "/tmp/outside"'],
  ['quoted table', 'Move.toml', '[dependencies."Outside"]\n"\\u006cocal" = "/tmp/outside"'],
  ['bare subtable', 'Move.toml', '[dependencies.Outside]\nlocal = "/tmp/outside"'],
  ['escaped lock source', 'Move.lock', '[pinned.mainnet.Outside]\nsource = { "\\u006cocal" = "/tmp/outside" }'],
  ['quoted lock source', 'Move.lock', '[pinned.mainnet.Outside]\n"source" = { local = "/tmp/outside" }'],
  ...[
    ['absolute Git subdir', 'https://example.invalid/repo.git', '/tmp/outside'],
    ['Git parent subdir', 'https://example.invalid/repo.git', '../outside'],
    ['Git noncanonical subdir', 'https://example.invalid/repo.git', 'a/../outside'],
    ['Git dot subdir', 'https://example.invalid/repo.git', './inside'],
    ['Git credentials', 'https://user:secret@example.invalid/repo.git', 'inside'],
    ['Git query', 'https://example.invalid/repo.git?token=secret', 'inside'],
    ['Git fragment', 'https://example.invalid/repo.git#token', 'inside'],
    ['Git whitespace', 'https://example.invalid/ repo.git', 'inside'],
  ].map(([name, url, subdir]) => [name, 'Move.toml', `[dependencies]\nOutside = { git = "${url}", subdir = "${subdir}", rev = "${'a'.repeat(40)}" }`]),
];
for (const [name, filename, attack] of disguisedSources) for (const mode of ['capture', 'cold restore']) {
  test(`${mode} rejects ${name} through source grammar even with valid content hashes`, async t => {
    const f = await fixture(t), original = await readFile(join(f.pkg('core'), filename), 'utf8');
    const forged = filename === 'Move.toml' ? original.replace('[dependencies]', attack) : `${original}\n${attack}\n`;
    if (mode === 'capture') {
      await writeFile(join(f.pkg('core'), filename), forged);
      await assert.rejects(f.capture, { code: 'NATIVE_SOUL_SOURCE_INVALID' });
      return;
    }
    const revision = structuredClone(await f.capture()), bytes = Buffer.from(forged), digest = hash(bytes);
    for (const rows of [revision.packages[0].originalFiles, revision.packages[0].files]) {
      Object.assign(rows.find(row => row.path === filename), { sha256: digest, byteLength: String(bytes.length) });
    }
    const { snapshotSha256: ignored, ...payload } = revision;
    revision.snapshotSha256 = hash(canonical(payload)); assertNativeSoulSourceRevision(revision);
    await writeFile(join(f.args.storePath, digest), bytes);
    const expected = new Set(['snapshot.json', ...revision.packages.flatMap(pkg => [...pkg.files, ...pkg.originalFiles].map(row => row.sha256))]);
    for (const entry of await readdir(f.args.storePath)) if (!expected.has(entry)) await rm(join(f.args.storePath, entry));
    await writeFile(join(f.args.storePath, 'snapshot.json'), canonical(revision));
    await assert.rejects(restoreNativeSoulSource({ sourceRevision: revision, storePath: f.args.storePath,
      checkoutRoot: join(f.temp, 'forged-cold') }), error => error.code === 'NATIVE_SOUL_SOURCE_INVALID'
        && /unsupported (?:dependency\/source syntax|TOML)|unsafe Git/.test(error.message));
  });
}
