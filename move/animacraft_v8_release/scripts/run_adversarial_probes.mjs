#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(relativePath) {
  return spawnSync(
    'sui',
    ['move', 'build', '--force', '--warnings-are-errors', '--path', relativePath],
    { cwd: packageDir, encoding: 'utf8' },
  );
}

const companion = run('probes/companion_compile');
if (companion.status !== 0) {
  throw new Error(
    `positive companion failed\n${companion.stdout || ''}\n${companion.stderr || ''}`,
  );
}
process.stdout.write('probes/companion_compile: public API compile PASS\n');

for (const [relativePath, diagnostics] of [
  ['probes/adversarial_abilities', [
    'ReleaseRenderWitnessV8',
    'ReleasePackageConfigV8',
    'does not have the ability',
    'copy',
    'store',
  ]],
  ['probes/adversarial_api', [
    'release_call_cap',
    'ReleaseRenderWitnessV8',
    'restricted visibility',
  ]],
]) {
  const result = run(relativePath);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) {
    throw new Error(`${relativePath} unexpectedly compiled`);
  }
  for (const diagnostic of diagnostics) {
    if (!output.includes(diagnostic)) {
      throw new Error(
        `${relativePath} failed without required diagnostic: ${diagnostic}\n${output}`,
      );
    }
  }
  process.stdout.write(`${relativePath}: expected compile failure PASS\n`);
}
