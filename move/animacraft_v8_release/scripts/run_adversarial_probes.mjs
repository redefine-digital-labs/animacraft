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
    'ReleaseTransportWitnessV8',
    'ReleasePackageConfigV8',
    'does not have the ability',
    'copy',
    'store',
  ]],
  ['probes/adversarial_api', [
    'installation_commitment',
    'ReleaseRenderWitnessV8',
    'ReleaseTransportWitnessV8',
    'restricted visibility',
  ]],
]) {
  const result = run(relativePath);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
    .replace(/\u001b\[[0-9;]*m/g, '');
  if (result.status === 0) {
    throw new Error(`${relativePath} unexpectedly compiled`);
  }
  const codes = [...output.matchAll(/error\[(E(?:C)?\d+)\]/g)]
    .map((match) => match[1].replace(/^EC/, 'E'));
  // Two witness storage constraints, two copy constraints and config storage;
  // or three independent private accesses (config and both constructors).
  const [expectedCount, expectedCode] = relativePath.endsWith('adversarial_abilities')
    ? [5, 'E05001'] : [3, 'E04001'];
  if (/unbound module member|unbound type|unbound field|too few arguments|too many arguments|invalid subtype|incompatible types|missing fields/i.test(output)
    || output.includes('warning[')
    || codes.length !== expectedCount
    || codes.some((code) => code !== expectedCode)
    || !output.includes(path.join('sources', 'attack.move'))) {
    throw new Error(`${relativePath} failed with an unrelated ABI error\n${output}`);
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
