import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertNativeGraphToolchain, createNativeTestGraph, nativeGraphCheckCommand, nativeGraphPackageChecks, nativeGraphReleaseChecks, NATIVE_GRAPH_SUI_VERSION, rewriteTestManifest, runNativeGraphCheck, TEST_ADDRESSES, verifyNativeTestGraph } from '../../../scripts/native-soul-test-graph.mjs';

test('release gates include all suites, probes, ordered disassembly/budgets and eight-package fields on one graph', () => {
  const checks = nativeGraphReleaseChecks();
  assert.deepEqual(checks.slice(0, 10), [...nativeGraphPackageChecks(), 'build']);
  assert.equal(checks.length, 33);
  assert.equal(new Set(checks).size, 33);
  assert.equal(checks.at(-1), 'field-limits');
  for (const name of Object.keys(TEST_ADDRESSES)) {
    assert.ok(checks.includes(`disassemble:${name}`));
    if (name === 'soulidity') continue;
    assert.ok(checks.indexOf(`probes:${name}`) > checks.indexOf('build'));
    assert.equal(checks.indexOf(`size:${name}`), checks.indexOf(`disassemble:${name}`) + 1);
  }
  assert.ok(!nativeGraphReleaseChecks().some(check => ['smoke', 'full', 'bootstrap'].includes(check)));
});

test('field checker implementation is snapshotted and cannot drift after graph creation', async t => {
  const { graph } = await graphFixture(t);
  assert.deepEqual(await readFile(graph.fieldChecker.destination), await readFile(graph.fieldChecker.source));
  await writeFile(graph.fieldChecker.destination, '// altered field check');
  await assert.rejects(verifyNativeTestGraph(graph), /field checker source drift/);
});

test('toolchain rejects rolling, older and merely version-compatible binaries', () => {
  assert.doesNotThrow(() => assertNativeGraphToolchain(NATIVE_GRAPH_SUI_VERSION));
  assert.equal(NATIVE_GRAPH_SUI_VERSION, 'sui 1.80.1-671ba71e69c7');
  for (const value of ['', 'sui 1.78.1-homebrew', 'sui 1.80.1-othercommit', 'sui 1.81.0-671ba71e69c7'])
    assert.throws(() => assertNativeGraphToolchain(value), /unapproved Sui toolchain/);
});

test('auxiliary execution cannot fall back to a different PATH binary or unknown package', async () => {
  for (const sui of ['sui', '/approved/renamed-sui']) await assert.rejects(
    runNativeGraphCheck({}, 'probes:animacraft_v8_core', { sui }), /absolute approved executable named sui/);
  for (const check of ['probes:soulidity', 'size:unknown']) await assert.rejects(
    runNativeGraphCheck({}, check, { sui: '/approved/sui' }), /unknown auxiliary package check/);
  assert.deepEqual(nativeGraphCheckCommand({ packages: { animacraft_v8_core: { destination: '/paired/core' } } },
    'disassemble:animacraft_v8_core'), ['move', 'build', '--path', '/paired/core', '--force', '--disassemble', '--warnings-are-errors']);
  assert.throws(() => nativeGraphCheckCommand({}, 'disassemble:unknown'), /unknown package check/);
});

test('CLI rejects an unapproved executable before inspecting source roots or allocating a graph', () => {
  const result = spawnSync(process.execPath, [new URL('../../../scripts/native-soul-test-graph.mjs', import.meta.url).pathname,
    '--sui', process.execPath, '--check', 'release-gates'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unapproved Sui toolchain/);
  assert.doesNotMatch(result.stderr, /soulidity-root is required/);
  assert.equal(result.stdout, '');
});

test('bootstrap is a real full-graph VM command, never the identity filter or production build', () => {
  const graph = { harnesses: { smoke: { destination: '/tmp/test-smoke' }, full: { destination: '/tmp/test-full' } } };
  assert.deepEqual(nativeGraphCheckCommand(graph, 'bootstrap'),
    ['move', 'test', '--path', '/tmp/test-full', '--warnings-are-errors', 'native_graph_bootstrap']);
  assert.deepEqual(nativeGraphCheckCommand(graph, 'full'),
    ['move', 'test', '--path', '/tmp/test-full', '--warnings-are-errors', 'native_graph_addresses']);
  assert.deepEqual(nativeGraphCheckCommand(graph, 'smoke'),
    ['move', 'test', '--path', '/tmp/test-smoke', '--warnings-are-errors', 'native_graph_addresses']);
  assert.deepEqual(nativeGraphCheckCommand(graph, 'build'),
    ['move', 'build', '--path', '/tmp/test-full', '--warnings-are-errors']);
  assert.deepEqual(nativeGraphCheckCommand(graph, 'acceptance'),
    ['move', 'test', '--path', '/tmp/test-full', '--warnings-are-errors']);
  assert.throws(() => nativeGraphCheckCommand(graph, 'skip-tests'), /check must be/);
});

test('complete package gate includes all eight own suites and unfiltered integration on one graph', () => {
  const graph = { packages: Object.fromEntries(Object.keys(TEST_ADDRESSES).map(name =>
    [name, { destination: `/same-graph/${name}` }])), harnesses: { full: { destination: '/same-graph/full' } } };
  const checks = nativeGraphPackageChecks();
  assert.equal(checks.length, 9);
  assert.equal(new Set(checks).size, 9);
  assert.ok(checks.includes('package:soulidity'));
  assert.equal(checks.at(-1), 'acceptance');
  for (const name of Object.keys(TEST_ADDRESSES)) assert.deepEqual(
    nativeGraphCheckCommand(graph, `package:${name}`),
    ['move', 'test', '--path', `/same-graph/${name}`, '--warnings-are-errors']);
  assert.deepEqual(nativeGraphCheckCommand(graph, checks.at(-1)),
    ['move', 'test', '--path', '/same-graph/full', '--warnings-are-errors']);
  assert.throws(() => nativeGraphCheckCommand(graph, 'package:unknown'), /unknown package check/);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'native-graph-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const animacraftRoot = join(root, 'animacraft');
  const soulidityRoot = join(root, 'soulidity');
  for (const name of Object.keys(TEST_ADDRESSES)) {
    const path = name === 'soulidity' ? join(soulidityRoot, 'move/soulidity') : join(animacraftRoot, 'move', name);
    await mkdir(join(path, 'sources'), { recursive: true });
    await mkdir(join(path, 'tests'), { recursive: true });
    const core = join(animacraftRoot, 'move/animacraft_v8_core');
    const dependency = name === 'animacraft_v8_core' ? '' : `animacraft_v8_core = { local = ${JSON.stringify(core)} }\n`;
    await writeFile(join(path, 'Move.toml'), `[package]\nname = "${name}"\nedition = "2024.beta"\n\n[dependencies]\n${dependency}\n[addresses]\n${name} = "0x0"\n\n[dev-addresses]\n${name} = "0x16"\n`);
    await writeFile(join(path, 'sources/source.move'), `module ${name}::unchanged;\n#[test_only]\npublic fun retained_helper() {}\n`);
    await writeFile(join(path, 'tests/negative.move'), `#[test]\n#[expected_failure]\nfun retained_negative() { abort 7 }\n`);
  }
  return { root, animacraftRoot, soulidityRoot };
}

async function graphFixture(t) {
  const f = await fixture(t);
  const graph = await createNativeTestGraph(f);
  // These are exclusively the mkdtemp directories allocated by this unit test.
  t.after(() => rm(graph.directory, { recursive: true, force: true }));
  return { ...f, graph };
}

test('generated graph preserves every source and negative test, with distinct own addresses', async t => {
  const { graph } = await graphFixture(t);
  assert.equal(graph.directory, await realpath(graph.directory));
  assert.equal(new Set(Object.values(graph.addresses)).size, 8);
  assert.equal(graph.totalFiles, 16);
  assert.equal(await verifyNativeTestGraph(graph), true);
  for (const [name, pkg] of Object.entries(graph.packages)) {
    const original = await readFile(join(pkg.source, 'Move.toml'), 'utf8');
    const generated = await readFile(join(pkg.destination, 'Move.toml'), 'utf8');
    assert.match(original, /= "0x0"/);
    assert.match(original, /= "0x16"/);
    assert.equal(generated.match(new RegExp(`${name} = "${TEST_ADDRESSES[name]}"`, 'g')).length, 2);
    for (const file of pkg.files) assert.deepEqual(
      await readFile(join(pkg.destination, file.path)), await readFile(join(pkg.source, file.path)));
    assert.match(await readFile(join(pkg.destination, 'tests/negative.move'), 'utf8'), /expected_failure/);
  }
});

test('manifest rewrite preserves external pins and rejects unmapped local authority', () => {
  const source = '/tmp/native-test-source';
  const original = '[package]\nname = "animacraft_v8_core"\n[dependencies]\nSui = { git = "https://example.invalid/sui", rev = "pinned" }\n[addresses]\nanimacraft_v8_core = "0x0"\n';
  assert.match(rewriteTestManifest(original, 'animacraft_v8_core', source, new Map()), /rev = "pinned"/);
  assert.throws(() => rewriteTestManifest(original.replace('[addresses]', 'Unknown = { local = "../unknown" }\n[addresses]'), 'animacraft_v8_core', source, new Map()), /unmapped local dependency/);
  assert.throws(() => rewriteTestManifest(original.replace('animacraft_v8_core = "0x0"', 'other = "0x0"'), 'animacraft_v8_core', source, new Map()), /unsupported address/);
});

test('probe inputs and runners are snapshotted, generated artifacts excluded, drift rejected', async t => {
  const f = await fixture(t);
  const source = join(f.animacraftRoot, 'move/animacraft_v8_core');
  await mkdir(join(source, 'scripts'));
  await writeFile(join(source, 'scripts/run_adversarial_probes.mjs'), '// original runner\n');
  const probe = join(source, 'probes/companion_compile');
  await mkdir(join(probe, 'sources'), { recursive: true });
  await mkdir(join(probe, 'build'));
  await writeFile(join(probe, 'Move.toml'), '[dependencies]\nanimacraft_v8_core = { local = "../.." }\n');
  await writeFile(join(probe, 'sources/probe.move'), '// exact probe\n');
  await writeFile(join(probe, 'Move.lock'), 'generated');
  await writeFile(join(probe, 'build/stale.mv'), 'stale');
  const graph = await createNativeTestGraph(f);
  t.after(() => rm(graph.directory, { recursive: true, force: true }));
  const pkg = graph.packages.animacraft_v8_core;
  assert.deepEqual(pkg.files.map(file => file.path), ['sources/source.move', 'tests/negative.move',
    'scripts/run_adversarial_probes.mjs', 'probes/companion_compile/Move.toml', 'probes/companion_compile/sources/probe.move']);
  await assert.rejects(readFile(join(pkg.destination, 'probes/companion_compile/Move.lock')), { code: 'ENOENT' });
  await mkdir(join(pkg.destination, 'probes/companion_compile/build'));
  await writeFile(join(pkg.destination, 'probes/companion_compile/build/new.mv'), 'output');
  assert.equal(await verifyNativeTestGraph(graph), true);
  await writeFile(join(pkg.destination, 'probes/companion_compile/sources/probe.move'), '// changed');
  await assert.rejects(verifyNativeTestGraph(graph), /source bytes drift/);
});

test('probe manifest symlinks cannot bypass snapshot provenance', async t => {
  const f = await fixture(t);
  const root = join(f.animacraftRoot, 'move/animacraft_v8_core');
  await mkdir(join(root, 'probes/attack'), { recursive: true });
  await symlink(join(root, 'Move.toml'), join(root, 'probes/attack/Move.toml'));
  await assert.rejects(createNativeTestGraph(f), /invalid probe manifest/);
});

test('snapshot byte drift is rejected rather than compiling a second implementation', async t => {
  const { graph } = await graphFixture(t);
  await writeFile(join(graph.packages.animacraft_v8_runtime.destination, 'sources/source.move'), 'changed');
  await assert.rejects(verifyNativeTestGraph(graph), /source bytes drift/);
});

test('relocated explicit roots replace historical absolute paths without changing sources', async t => {
  const f = await fixture(t);
  const manifest = join(f.soulidityRoot, 'move/soulidity/Move.toml');
  await writeFile(manifest, (await readFile(manifest, 'utf8')).replace(
    join(f.animacraftRoot, 'move/animacraft_v8_core'), '/historical/worktree/move/animacraft_v8_core'));
  const graph = await createNativeTestGraph(f);
  t.after(() => rm(graph.directory, { recursive: true, force: true }));
  assert.equal(await verifyNativeTestGraph(graph), true);
  assert.ok((await readFile(join(graph.packages.soulidity.destination, 'Move.toml'), 'utf8'))
    .includes(graph.packages.animacraft_v8_core.destination));
  assert.ok((await readFile(manifest, 'utf8')).includes('/historical/worktree/'));
});

test('relocation rejects unknown roots, aliases, relative drift and name/path disagreement', () => {
  const header = '[package]\nname = "soulidity"\n[dependencies]\n';
  const footer = '\n[addresses]\nsoulidity = "0x0"\n';
  const named = { animacraft_v8_core: '/snapshot/core' };
  const rewrite = (dependency, path, mappings = new Map()) => rewriteTestManifest(
    `${header}${dependency} = { local = "${path}" }${footer}`, 'soulidity', '/source', mappings, named);
  assert.match(rewrite('animacraft_v8_core', '/old/animacraft_v8_core'), /local = "\/snapshot\/core"/);
  for (const [dependency, path] of [
    ['unknown', '/old/unknown'], ['Alias', '/old/animacraft_v8_core'],
    ['animacraft_v8_core', '../animacraft_v8_core'], ['animacraft_v8_core', '/old/wrong'],
  ]) assert.throws(() => rewrite(dependency, path), /unmapped local dependency/);
  assert.throws(() => rewrite('animacraft_v8_core', '/old/animacraft_v8_core',
    new Map([['/old/animacraft_v8_core', '/snapshot/wrong']])), /name\/path mismatch/);
});

test('original source and test inventory changes require a new snapshot', async t => {
  const { graph } = await graphFixture(t);
  await writeFile(join(graph.packages.soulidity.source, 'tests/new-negative.move'), 'new test');
  await assert.rejects(verifyNativeTestGraph(graph), /source inventory drift/);
});

test('generated manifest address drift is rejected', async t => {
  const { graph } = await graphFixture(t);
  const path = join(graph.packages.animacraft_v8_output.destination, 'Move.toml');
  await writeFile(path, (await readFile(path, 'utf8')).replaceAll('0x103', '0x0'));
  await assert.rejects(verifyNativeTestGraph(graph), /generated manifest drift/);
});

test('explicit Soulidity source is required and source symlinks are rejected', async t => {
  await assert.rejects(createNativeTestGraph({}), /soulidity-root is required/);
  const f = await fixture(t);
  await symlink(join(f.animacraftRoot, 'move/animacraft_v8_core/sources/source.move'), join(f.soulidityRoot, 'move/soulidity/tests/alias.move'));
  await assert.rejects(createNativeTestGraph(f), /source symlink forbidden/);
});

test('graph inventories reject empty, missing and extra package/profile entries', async t => {
  const { graph } = await graphFixture(t);
  for (const mutate of [
    value => { value.packages = {}; },
    value => { delete value.packages.soulidity; },
    value => { value.packages.unexpected = value.packages.soulidity; },
    value => { value.harnesses = {}; },
    value => { delete value.harnesses.full; },
    value => { value.harnesses.unexpected = value.harnesses.full; },
  ]) {
    const changed = structuredClone(graph);
    mutate(changed);
    await assert.rejects(verifyNativeTestGraph(changed), /inventory mismatch/);
  }
});

test('rehashing generated package manifest cannot authorize an unbounded transform', async t => {
  const { graph } = await graphFixture(t);
  const pkg = graph.packages.animacraft_v8_output;
  const path = join(pkg.destination, 'Move.toml');
  const changed = (await readFile(path, 'utf8')).replaceAll('0x103', '0x999');
  await writeFile(path, changed);
  pkg.generatedManifestSha256 = createHash('sha256').update(changed).digest('hex');
  await assert.rejects(verifyNativeTestGraph(graph), /not the bounded original transform/);
});

test('rehashing harness manifest cannot substitute dependency addresses', async t => {
  const { graph } = await graphFixture(t);
  const harness = graph.harnesses.full;
  const path = join(harness.destination, 'Move.toml');
  const changed = (await readFile(path, 'utf8')).replace('0x108', '0x999');
  await writeFile(path, changed);
  harness.manifestSha256 = createHash('sha256').update(changed).digest('hex');
  await assert.rejects(verifyNativeTestGraph(graph), /harness manifest drift/);
});

test('harness snapshot cannot omit an existing source or add a hidden test', async t => {
  const { graph } = await graphFixture(t);
  await writeFile(join(graph.harnesses.smoke.destination, 'sources/extra.move'), '#[test] fun surprise() {}');
  await assert.rejects(verifyNativeTestGraph(graph), /harness source inventory drift/);
});
