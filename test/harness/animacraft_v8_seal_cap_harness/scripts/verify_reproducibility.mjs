#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndVerifyEvidence, sha256Bytes } from './evidence.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const harnessDirectory = resolve(scriptDirectory, '..');
const root = resolve(harnessDirectory, '../../..');
const productionCore = join(root, 'move/animacraft_v8_core');
const fixture = join(harnessDirectory, 'fixture/slim-core');
const expectedMoveRoots = [
  'animacraft_v8_core',
  'animacraft_v8_market',
  'animacraft_v8_output',
  'animacraft_v8_physical',
  'animacraft_v8_release',
  'animacraft_v8_runtime',
  'animacraft_v8_seal',
];
const expectedFixtureSources = [
  'activation_v8.move',
  'base_registry_v8.move',
  'core_v8.move',
  'maker_v8.move',
  'package_binding_v8.move',
  'protocol_config_v8.move',
  'treasury_v8.move',
];
const buildTimeoutMs = 180_000;

function fail(message) {
  throw new Error(`seal-cap quick gate: ${message}`);
}

function run(command, args, { capture = false } = {}) {
  process.stdout.write(`+ ${command} ${args.join(' ')}\n`);
  return execFileSync(command, args, {
    cwd: root,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    timeout: buildTimeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function exactList(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${expected.join(', ')}, got ${actual.join(', ')}`);
  }
}

const version = String(run('sui', ['--version'], { capture: true })).trim();
if (!/^sui 1\.76\.1(?:[-+\s]|$)/.test(version)) {
  fail(`Sui CLI must be exactly 1.76.1; got ${version}`);
}

const evidence = loadAndVerifyEvidence(harnessDirectory);
const { manifest } = evidence;
process.stdout.write(
  `ok: approved protocol profile ${manifest.approvedProtocolProfile.canonicalSha256}\n`,
);
run(process.execPath, ['--check', join(scriptDirectory, 'run_localnet_replay.mjs')]);

const harnessRelative = 'test/harness/animacraft_v8_seal_cap_harness';
const trackedHarnessFiles = String(run('git', [
  'ls-files', '--', harnessRelative,
], { capture: true })).trim().split('\n').filter(Boolean);
const forbiddenTracked = trackedHarnessFiles.filter((path) =>
  /(^|\/)(?:build|trace|network)(?:\/|$)|(?:^|\/)(?:sui\.keystore|client\.yaml|fullnode\.yaml|network\.yaml|genesis\.blob|Published\.toml|SlimPublished\.toml)$/.test(path));
if (forbiddenTracked.length > 0) {
  fail(`generated, key, or network-state paths are tracked: ${forbiddenTracked.join(', ')}`);
}

const moveRoots = readdirSync(join(root, 'move'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('animacraft_v8_'))
  .filter((entry) => {
    try {
      return statSync(join(root, 'move', entry.name, 'Move.toml')).isFile();
    } catch {
      return false;
    }
  })
  .map(({ name }) => name)
  .sort();
exactList(moveRoots, expectedMoveRoots, 'production Move roots');
if (moveRoots.length !== manifest.production.moveRootCount) {
  fail(`expected ${manifest.production.moveRootCount} production Move roots`);
}

const fixtureSourcesDirectory = join(fixture, 'sources');
const fixtureSources = readdirSync(fixtureSourcesDirectory)
  .filter((name) => name.endsWith('.move'))
  .sort();
exactList(fixtureSources, expectedFixtureSources, 'slim fixture modules');
exactList(
  Object.keys(manifest.fixtureSources).sort(),
  expectedFixtureSources,
  'manifest fixture modules',
);
exactList(
  Object.keys(manifest.fixtureMetadata).sort(),
  ['Move.lock', 'Move.toml'],
  'manifest fixture metadata',
);
for (const [name, expectedHash] of Object.entries(manifest.fixtureSources)) {
  const actualHash = sha256File(join(fixtureSourcesDirectory, name));
  if (actualHash !== expectedHash) fail(`${name} fixture SHA-256 drift`);
}
for (const [name, expectedHash] of Object.entries(manifest.fixtureMetadata)) {
  const actualHash = sha256File(join(fixture, name));
  if (actualHash !== expectedHash) fail(`${name} fixture metadata SHA-256 drift`);
}

const productionSource = join(productionCore, 'sources/base_registry_v8.move');
const fixtureSource = join(fixtureSourcesDirectory, 'base_registry_v8.move');
const productionSourceBytes = readFileSync(productionSource);
if (!productionSourceBytes.equals(readFileSync(fixtureSource))) {
  fail('fixture base_registry_v8.move is not byte-for-byte production source');
}
if (productionSourceBytes.length !== manifest.production.baseRegistrySourceBytes
    || sha256Bytes(productionSourceBytes) !== manifest.production.baseRegistrySourceSha256) {
  fail('production base_registry_v8.move byte length or SHA-256 drift');
}

const buildArgs = (path) => [
  'move', 'build', '--path', path, '--force', '--disassemble', '--warnings-are-errors',
];
run('sui', buildArgs(productionCore));
run('sui', buildArgs(fixture));
run('sui', [
  'move', 'build', '--path', harnessDirectory, '--force', '--warnings-are-errors',
]);

const productionBuild = join(productionCore, 'build/animacraft_v8_core');
const fixtureBuild = join(fixture, 'build/animacraft_v8_core');
const productionBytecode = join(productionBuild, 'bytecode_modules/base_registry_v8.mv');
const fixtureBytecode = join(fixtureBuild, 'bytecode_modules/base_registry_v8.mv');
const productionMv = readFileSync(productionBytecode);
const fixtureMv = readFileSync(fixtureBytecode);
if (!productionMv.equals(fixtureMv)) {
  fail('fixture base_registry_v8.mv is not byte-for-byte production bytecode');
}
if (productionMv.length !== manifest.production.baseRegistryBytecodeBytes
    || sha256Bytes(productionMv) !== manifest.production.baseRegistryBytecodeSha256) {
  fail('production base_registry_v8.mv byte length or SHA-256 drift');
}
const productionDisassembly = readFileSync(
  join(productionBuild, 'disassembly/base_registry_v8.mvb'),
);
const fixtureDisassembly = readFileSync(
  join(fixtureBuild, 'disassembly/base_registry_v8.mvb'),
);
if (!productionDisassembly.equals(fixtureDisassembly)) {
  fail('fixture base_registry_v8.mvb is not byte-for-byte production disassembly');
}
for (const [label, disassembly] of [
  ['production', productionDisassembly],
  ['fixture', fixtureDisassembly],
]) {
  const text = disassembly.toString('utf8');
  if (!/^module\s+[0-9a-fA-F]+\.base_registry_v8\s*\{/m.test(text)) {
    fail(`${label} forced disassembly does not declare base_registry_v8`);
  }
}
process.stdout.write(
  `ok: production/fixture base_registry_v8.mv cmp (${productionMv.length} B, ${sha256Bytes(productionMv)})\n`,
);

const sizeJson = String(run(process.execPath, [
  join(productionCore, 'scripts/measure_package_size.mjs'),
], { capture: true }));
const size = JSON.parse(sizeJson);
if (size.packageObjectBytes !== manifest.production.corePackageObjectBytes
    || size.targetHeadroomBytes !== manifest.production.coreTargetHeadroomBytes
    || size.modules.length !== manifest.production.coreModuleCount) {
  fail(
    `Core size drift: ${size.packageObjectBytes} B / ${size.targetHeadroomBytes} B headroom / ${size.modules.length} modules`,
  );
}
process.stdout.write(
  `ok: production Core ${size.packageObjectBytes} B, ${size.targetHeadroomBytes} B target headroom\n`,
);

run(process.execPath, [join(scriptDirectory, 'generate_commitments.mjs'), '--self-test']);
process.stdout.write('ok: canonical protocol/effects artifact hashes and typed fields\n');
process.stdout.write(`ok: seal-cap quick reproducibility gate passed with ${version}\n`);
