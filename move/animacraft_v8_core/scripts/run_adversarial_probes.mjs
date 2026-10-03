#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function expectCompileFailure(relativePath, requiredPatterns, expectedCount, expectedCode) {
  const result = spawnSync(
    'sui',
    ['move', 'build', '--force', '--warnings-are-errors', '--path', relativePath],
    { cwd: packageDir, encoding: 'utf8' },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) {
    throw new Error(`${relativePath} unexpectedly compiled`);
  }
  if (/unbound module member|unbound type|unbound field|too few arguments|too many arguments|invalid subtype|incompatible types|missing fields/i.test(output)) {
    throw new Error(`${relativePath} failed with an unrelated ABI error\n${output}`);
  }
  const diagnostics = [...output.matchAll(/error\[(E(?:C)?\d+)\]/g)]
    .map(match => match[1].replace(/^EC/, 'E'));
  if (diagnostics.length !== expectedCount || diagnostics.some(code => code !== expectedCode)) {
    throw new Error(`${relativePath}: expected ${expectedCount} exact ${expectedCode} diagnostics; got ${JSON.stringify(diagnostics)}\n${output}`);
  }
  for (const pattern of requiredPatterns) {
    if (!output.includes(pattern)) {
      throw new Error(`${relativePath} failed without required diagnostic: ${pattern}\n${output}`);
    }
  }
  process.stdout.write(`${relativePath}: expected compile failure PASS\n`);
}

function expectRuntimePass(relativePath) {
  const result = spawnSync(
    'sui',
    ['move', 'test', '--warnings-are-errors', '--path', relativePath],
    { cwd: packageDir, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `${relativePath} runtime probe failed\n${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  for (const name of ['setup_cap_cannot_cross_catalogs', 'setup_cap_installs_its_own_catalog']) {
    if (!result.stdout.includes(name)) throw new Error(`${relativePath} did not execute ${name}`);
    process.stdout.write(`${result.stdout.split('\n').find(line => line.includes(name))}\n`);
  }
  process.stdout.write(`${relativePath}: adversarial runtime PASS\n`);
}

const companion = spawnSync('sui',
  ['move', 'build', '--force', '--warnings-are-errors', '--path', 'probes/companion_compile'],
  { cwd: packageDir, encoding: 'utf8' });
if (companion.status !== 0) throw new Error(`positive companion failed\n${companion.stdout || ''}\n${companion.stderr || ''}`);
process.stdout.write('probes/companion_compile: public API compile PASS\n');

expectCompileFailure('probes/adversarial_abilities', [
  'MakerRuntimeCompanionBindingBuilderV2',
  'FreshTupleBootstrapUseWitnessV2',
  'RuntimeCallerCapV1',
  'PackageCallCapV8',
  'WrappedRightsCertificationV8',
  'SuccessorAuthorityV8',
  'SealRoleV8', 'RuntimeRoleV8', 'OutputRoleV8', 'PhysicalRoleV8', 'MarketRoleV8', 'ReleaseRoleV8',
  'copy',
  'drop',
  'store',
], 32, 'E05001');

expectCompileFailure('probes/adversarial_api', [
  'new_rights_snapshot_internal_v8',
  'new_builder_v2',
  'WrappedRightsCertificationV8',
  'PackageCallCapV8',
  'RuntimeCallerCapV1',
  'restricted visibility',
], 5, 'E04001');

expectRuntimePass('probes/adversarial_runtime');
