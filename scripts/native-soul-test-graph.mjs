import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FRAMEWORK_REVISION = '722ac4fcf4841346c91775f596c4ce23fb7fbd0f';
export const NATIVE_GRAPH_SUI_VERSION = 'sui 1.80.1-671ba71e69c7';
export const TEST_ADDRESSES = Object.freeze(Object.fromEntries([
  'animacraft_v8_core', 'animacraft_v8_seal', 'animacraft_v8_runtime',
  'animacraft_v8_output', 'animacraft_v8_physical', 'animacraft_v8_market',
  'animacraft_v8_release', 'soulidity',
].map((name, index) => [name, `0x${(0x100 + index).toString(16)}`])));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const fail = message => { throw new Error(`NATIVE_TEST_GRAPH: ${message}`); };

// A deliberately bounded transformer for the repository's legacy manifests.
// Unknown local dependencies/address declarations fail closed. All other text,
// including Git revisions, dev dependencies and replacement tables, is retained.
export function rewriteTestManifest(text, name, source, destinations, namedDestinations = {}) {
  if (!Object.hasOwn(TEST_ADDRESSES, name)) fail('unknown package');
  if (!new RegExp(`^name\\s*=\\s*"${name}"\\s*$`, 'm').test(text)) fail('package name mismatch');
  let section = '';
  let seenAddress = false;
  const lines = text.split('\n').map(line => {
    const table = /^\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (table) section = table[1];
    if (['addresses', 'dev-addresses'].includes(section) && !table && line.trim() && !line.trim().startsWith('#')) {
      const field = /^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*"0x[0-9a-fA-F]+"\s*(?:#.*)?$/.exec(line);
      if (!field || field[1] !== name) fail(`unsupported address declaration in ${name}`);
      if (section === 'addresses') seenAddress = true;
      return `${name} = "${TEST_ADDRESSES[name]}"`;
    }
    return line.replace(/\blocal\s*=\s*"([^"\n]+)"/g, (_match, path) => {
      const declaration = /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*\{\s*local\s*=\s*"[^"\n]+"\s*\}\s*(?:#.*)?$/.exec(line);
      const dependency = declaration?.[1];
      const named = Object.hasOwn(namedDestinations, dependency) ? namedDestinations[dependency] : undefined;
      let destination = destinations.get(resolve(source, path));
      if (named && destination && named !== destination) fail(`dependency name/path mismatch: ${name}/${dependency}`);
      // Explicit roots select the source authority. Only a simple known-package
      // absolute path may relocate; unknown/aliased/relative dependencies fail.
      if (!destination && named && ['dependencies', 'dev-dependencies'].includes(section)
        && isAbsolute(path) && basename(path) === dependency) destination = named;
      if (!destination) fail(`unmapped local dependency ${name}: ${path}`);
      return `local = ${JSON.stringify(destination)}`;
    });
  });
  if (!seenAddress) fail(`missing own address in ${name}`);
  return lines.join('\n');
}

async function sourceFiles(root, subdir) {
  const folder = join(root, subdir);
  let entries;
  try {
    if ((await lstat(folder)).isSymbolicLink()) fail(`source directory symlink forbidden: ${subdir}`);
    entries = await readdir(folder, { withFileTypes: true });
  }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(subdir, entry.name);
    if (entry.isSymbolicLink()) fail(`source symlink forbidden: ${path}`);
    if (entry.isDirectory()) result.push(...await sourceFiles(root, path));
    else if (entry.isFile()) result.push(path);
    else fail(`non-regular source: ${path}`);
  }
  return result;
}

function harnessManifest(profile, packages) {
  const names = Object.keys(TEST_ADDRESSES).filter(name => profile === 'full'
    || !['animacraft_v8_physical', 'animacraft_v8_market', 'animacraft_v8_release'].includes(name));
  return `[package]\nname = "native_soul_v8_graph"\nedition = "2024.beta"\n\n[dependencies]\n`
    + ['Sui', 'MoveStdlib'].map(name => `${name} = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/${name === 'Sui' ? 'sui-framework' : 'move-stdlib'}", rev = "${FRAMEWORK_REVISION}", override = true }`).join('\n')
    + '\n' + names.map(name => `${name} = { local = ${JSON.stringify(packages[name].destination)} }`).join('\n')
    + '\n\n[addresses]\nnative_soul_v8_graph = "0x108"\n';
}

// Probe build products are mutable outputs, never snapshot inputs. Keep the
// original relative topology so existing adversarial runners retain their rules.
async function packageInputs(root) {
  const paths = [...await sourceFiles(root, 'sources'), ...await sourceFiles(root, 'tests'),
    ...await sourceFiles(root, 'scripts')];
  let probes;
  try {
    if ((await lstat(join(root, 'probes'))).isSymbolicLink()) fail('probe directory symlink forbidden');
    probes = await readdir(join(root, 'probes'), { withFileTypes: true });
  } catch (error) { if (error.code === 'ENOENT') return paths; throw error; }
  for (const probe of probes.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!probe.isDirectory() || probe.isSymbolicLink()) fail('invalid probe directory');
    const folder = join('probes', probe.name);
    const manifest = join(folder, 'Move.toml');
    if (!(await lstat(join(root, manifest))).isFile()) fail('invalid probe manifest');
    paths.push(manifest, ...await sourceFiles(root, join(folder, 'sources')),
      ...await sourceFiles(root, join(folder, 'tests')));
  }
  return paths;
}

export async function createNativeTestGraph({ animacraftRoot = repository, soulidityRoot, harnessRoot = join(repository, 'test/harness/native-soul-v8') }) {
  if (!soulidityRoot) fail('--soulidity-root is required; no historical worktree fallback');
  const roots = {};
  const requestedRoots = {};
  for (const name of Object.keys(TEST_ADDRESSES)) {
    requestedRoots[name] = resolve(name === 'soulidity'
      ? join(soulidityRoot, 'move/soulidity') : join(animacraftRoot, 'move', name));
    roots[name] = await realpath(requestedRoots[name]);
  }
  if (new Set(Object.values(roots)).size !== 8) fail('package source aliases');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'native-soul-v8-graph-')));
  const packages = Object.fromEntries(Object.entries(roots).map(([name, source]) => [name,
    { source, requestedSource: requestedRoots[name], destination: join(directory, 'packages', name), address: TEST_ADDRESSES[name], files: [] }]));
  const destinations = new Map(Object.values(packages).map(p => [p.source, p.destination]));
  for (const [name, path] of Object.entries(requestedRoots)) destinations.set(path, packages[name].destination);
  let totalBytes = 0;
  let totalFiles = 0;
  for (const [name, pkg] of Object.entries(packages)) {
    await mkdir(pkg.destination, { recursive: true });
    const original = await readFile(join(pkg.source, 'Move.toml'));
    pkg.originalManifestSha256 = digest(original);
    const manifest = rewriteTestManifest(original.toString('utf8'), name, pkg.source, destinations,
      Object.fromEntries(Object.entries(packages).map(([key, value]) => [key, value.destination])));
    pkg.generatedManifestSha256 = digest(manifest);
    await writeFile(join(pkg.destination, 'Move.toml'), manifest, { flag: 'wx' });
    const paths = await packageInputs(pkg.source);
    if (!paths.some(path => path.endsWith('.move'))) fail(`no Move sources: ${name}`);
    for (const path of paths) {
      const bytes = await readFile(join(pkg.source, path));
      totalBytes += bytes.length;
      if (++totalFiles > 2000 || totalBytes > 64 * 1024 * 1024) fail('source snapshot bound exceeded');
      await mkdir(dirname(join(pkg.destination, path)), { recursive: true });
      await copyFile(join(pkg.source, path), join(pkg.destination, path));
      pkg.files.push({ path, sha256: digest(bytes), bytes: bytes.length });
    }
  }
  const harnesses = {};
  for (const profile of ['smoke', 'full']) {
    const destination = join(directory, profile);
    await mkdir(join(destination, 'sources'), { recursive: true });
    const manifest = harnessManifest(profile, packages);
    await writeFile(join(destination, 'Move.toml'), manifest, { flag: 'wx' });
    const source = await realpath(join(harnessRoot, profile));
    const paths = [...await sourceFiles(source, 'sources'), ...await sourceFiles(source, 'tests')];
    if (!paths.includes('sources/identities.move')) fail('missing harness identity case');
    const files = [];
    let harnessBytes = 0;
    for (const path of paths) {
      const bytes = await readFile(join(source, path));
      harnessBytes += bytes.length;
      if (paths.length > 2000 || harnessBytes > 8 * 1024 * 1024) fail('harness source bound exceeded');
      await mkdir(dirname(join(destination, path)), { recursive: true });
      await copyFile(join(source, path), join(destination, path));
      files.push({ path, sha256: digest(bytes), bytes: bytes.length });
    }
    harnesses[profile] = { destination, source, files, manifestSha256: digest(manifest) };
  }
  const graph = { schema: 1, directory, frameworkRevision: FRAMEWORK_REVISION,
    addresses: TEST_ADDRESSES, packages, harnesses, totalFiles, totalBytes,
    limits: 'Address and source-integrity harness only; no native completion or deployment acceptance.' };
  const fieldSource = join(repository, 'scripts/verify-move-struct-field-limits.mjs');
  const fieldDestination = join(directory, 'verify-move-struct-field-limits.mjs');
  const fieldBytes = await readFile(fieldSource);
  await writeFile(fieldDestination, fieldBytes, { flag: 'wx' });
  graph.fieldChecker = { source: fieldSource, destination: fieldDestination, sha256: digest(fieldBytes) };
  await writeFile(join(directory, 'graph.json'), json(graph), { flag: 'wx' });
  await verifyNativeTestGraph(graph);
  return graph;
}

export async function verifyNativeTestGraph(graph) {
  if (graph.schema !== 1 || graph.frameworkRevision !== FRAMEWORK_REVISION
    || JSON.stringify(graph.addresses) !== JSON.stringify(TEST_ADDRESSES)) fail('graph schema/address map mismatch');
  if (graph.fieldChecker?.destination !== join(graph.directory, 'verify-move-struct-field-limits.mjs')) fail('field checker destination mismatch');
  for (const path of [graph.fieldChecker.source, graph.fieldChecker.destination]) {
    if (digest(await readFile(path)) !== graph.fieldChecker.sha256) fail('field checker source drift');
  }
  if (JSON.stringify(Object.keys(graph.packages)) !== JSON.stringify(Object.keys(TEST_ADDRESSES))
    || JSON.stringify(Object.keys(graph.harnesses)) !== JSON.stringify(['smoke', 'full'])) fail('graph package/profile inventory mismatch');
  const destinations = new Map();
  for (const pkg of Object.values(graph.packages)) {
    if (typeof pkg.requestedSource !== 'string' || await realpath(pkg.requestedSource) !== pkg.source) fail('original source alias mismatch');
    destinations.set(pkg.source, pkg.destination);
    destinations.set(pkg.requestedSource, pkg.destination);
  }
  for (const [name, pkg] of Object.entries(graph.packages)) {
    if (pkg.destination !== join(graph.directory, 'packages', name) || pkg.address !== TEST_ADDRESSES[name]) fail('graph destination mismatch');
    const original = await readFile(join(pkg.source, 'Move.toml'));
    const generated = await readFile(join(pkg.destination, 'Move.toml'));
    if (digest(original) !== pkg.originalManifestSha256) fail(`original manifest drift: ${name}`);
    if (digest(generated) !== pkg.generatedManifestSha256) fail(`generated manifest drift: ${name}`);
    if (generated.toString('utf8') !== rewriteTestManifest(original.toString('utf8'), name, pkg.source, destinations,
      Object.fromEntries(Object.entries(graph.packages).map(([key, value]) => [key, value.destination])))) fail(`generated manifest is not the bounded original transform: ${name}`);
    const current = await packageInputs(pkg.source);
    const copied = await packageInputs(pkg.destination);
    if (JSON.stringify(current) !== JSON.stringify(pkg.files.map(f => f.path)) || JSON.stringify(copied) !== JSON.stringify(current)) fail(`source inventory drift: ${name}`);
    for (const file of pkg.files) for (const root of [pkg.source, pkg.destination]) {
      const path = join(root, file.path);
      if (!(await lstat(path)).isFile() || digest(await readFile(path)) !== file.sha256) fail(`source bytes drift: ${name}/${file.path}`);
    }
  }
  for (const [profile, harness] of Object.entries(graph.harnesses)) {
    if (harness.destination !== join(graph.directory, profile)) fail('harness destination mismatch');
    const original = [...await sourceFiles(harness.source, 'sources'), ...await sourceFiles(harness.source, 'tests')];
    const copied = [...await sourceFiles(harness.destination, 'sources'), ...await sourceFiles(harness.destination, 'tests')];
    if (!original.includes('sources/identities.move') || JSON.stringify(original) !== JSON.stringify(copied)
      || JSON.stringify(original) !== JSON.stringify(harness.files.map(f => f.path))) fail('harness source inventory drift');
    for (const file of harness.files) for (const root of [harness.source, harness.destination]) {
      if (digest(await readFile(join(root, file.path))) !== file.sha256) fail('harness source bytes drift');
    }
    const manifest = await readFile(join(harness.destination, 'Move.toml'), 'utf8');
    if (digest(manifest) !== harness.manifestSha256 || manifest !== harnessManifest(profile, graph.packages)) fail('harness manifest drift');
  }
  return true;
}

export function nativeGraphCheckCommand(graph, check) {
  if (check.startsWith('disassemble:')) {
    const name = check.slice('disassemble:'.length);
    if (!Object.hasOwn(TEST_ADDRESSES, name)) fail('unknown package check');
    return ['move', 'build', '--path', graph.packages[name].destination,
      '--force', '--disassemble', '--warnings-are-errors'];
  }
  if (check.startsWith('package:')) {
    const name = check.slice('package:'.length);
    if (!Object.hasOwn(TEST_ADDRESSES, name)) fail('unknown package check');
    return ['move', 'test', '--path', graph.packages[name].destination, '--warnings-are-errors'];
  }
  if (!['smoke', 'full', 'bootstrap', 'acceptance', 'build'].includes(check)) fail('check must be smoke, full, bootstrap, acceptance or build');
  const profile = check === 'smoke' ? 'smoke' : 'full';
  const command = ['move', check === 'build' ? 'build' : 'test', '--path', graph.harnesses[profile].destination, '--warnings-are-errors'];
  if (check !== 'build' && check !== 'acceptance') command.push(check === 'bootstrap' ? 'native_graph_bootstrap' : 'native_graph_addresses');
  return command;
}

export function nativeGraphPackageChecks() {
  return [...Object.keys(TEST_ADDRESSES).map(name => `package:${name}`), 'acceptance'];
}

export function nativeGraphReleaseChecks() {
  const packages = Object.keys(TEST_ADDRESSES);
  const animacraft = packages.filter(name => name !== 'soulidity');
  return [...nativeGraphPackageChecks(), 'build',
    ...animacraft.map(name => `probes:${name}`),
    ...packages.flatMap(name => [`disassemble:${name}`, ...(name === 'soulidity' ? [] : [`size:${name}`])]),
    'field-limits'];
}

export function nativeGraphChecks(selection) {
  const packages = Object.keys(TEST_ADDRESSES);
  switch (selection) {
    case 'release-gates': return nativeGraphReleaseChecks();
    case 'packages': return nativeGraphPackageChecks();
    case 'probes': return packages.filter(name => name !== 'soulidity').map(name => `probes:${name}`);
    case 'disassemble': return packages.map(name => `disassemble:${name}`);
    case 'field-gates': return [...nativeGraphChecks('disassemble'), 'field-limits'];
    case 'size-gates': return [...packages.flatMap(name => [`disassemble:${name}`,
      ...(name === 'soulidity' ? [] : [`size:${name}`])]), 'field-limits'];
    default: return [selection];
  }
}

export function assertNativeGraphToolchain(version) {
  if (version !== NATIVE_GRAPH_SUI_VERSION) fail(`unapproved Sui toolchain: expected ${NATIVE_GRAPH_SUI_VERSION}`);
}

function inspectNativeGraphToolchain(sui) {
  const version = spawnSync(sui, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (version.status !== 0) fail('Sui toolchain version unavailable');
  assertNativeGraphToolchain(version.stdout.trim());
  return version.stdout.trim();
}

export async function runNativeGraphCheck(graph, check, { sui = 'sui' } = {}) {
  const auxiliary = /^(probes|size):(.+)$/.exec(check);
  let executable = sui;
  let command;
  if (check === 'field-limits') {
    executable = process.execPath;
    command = [graph.fieldChecker.destination, '--packages-root', join(graph.directory, 'packages')];
  } else if (auxiliary) {
    const [, kind, name] = auxiliary;
    if (!Object.hasOwn(TEST_ADDRESSES, name) || name === 'soulidity') fail('unknown auxiliary package check');
    if (!isAbsolute(sui) || basename(sui) !== 'sui') fail('auxiliary checks require an absolute approved executable named sui');
    executable = process.execPath;
    command = [join(graph.packages[name].destination, 'scripts',
      kind === 'probes' ? 'run_adversarial_probes.mjs' : 'measure_package_size.mjs')];
  } else command = nativeGraphCheckCommand(graph, check);
  await verifyNativeTestGraph(graph);
  const version = inspectNativeGraphToolchain(sui);
  const result = spawnSync(executable, command, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: auxiliary ? 600000 : 120000,
    env: auxiliary ? { ...process.env, PATH: `${dirname(sui)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` } : process.env });
  await verifyNativeTestGraph(graph);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  await writeFile(join(graph.directory, `${check}.log`), output);
  const evidence = { check, command: [executable, ...command], exitCode: result.status,
    suiVersion: version, nodeVersion: process.version,
    signal: result.signal, error: result.error?.message ?? null, outputSha256: digest(output),
    originalAndSnapshotSourcesVerified: true };
  await writeFile(join(graph.directory, `${check}.json`), json(evidence));
  return { ...evidence, output };
}

async function main() {
  const values = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--animacraft-root', '--soulidity-root', '--check', '--sui'].includes(args[i]) || !args[i + 1] || values[args[i]]) fail('invalid CLI arguments');
    values[args[i]] = args[i + 1];
  }
  const sui = values['--sui'] || 'sui';
  if (values['--check']) inspectNativeGraphToolchain(sui);
  const graph = await createNativeTestGraph({ animacraftRoot: values['--animacraft-root'], soulidityRoot: values['--soulidity-root'] });
  console.log(json({ graph: join(graph.directory, 'graph.json'), addresses: graph.addresses,
    files: graph.totalFiles, bytes: graph.totalBytes }));
  if (values['--check']) {
    const checks = nativeGraphChecks(values['--check']);
    for (const check of checks) {
      const result = await runNativeGraphCheck(graph, check, { sui });
      console.log(result.output);
      console.log(json({ exitCode: result.exitCode, evidence: join(graph.directory, `${check}.json`) }));
      process.exitCode = result.exitCode ?? 1;
      if (process.exitCode !== 0) break;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
