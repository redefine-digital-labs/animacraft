#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function build(relativePath) {
  return spawnSync('sui', ['move', 'build', '--force', '--warnings-are-errors', '--path', relativePath], {
    cwd: packageDir,
    encoding: 'utf8',
  });
}

function expectPass(relativePath) {
  const result = build(relativePath);
  if (result.status !== 0) {
    throw new Error(`${relativePath} failed to compile\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  process.stdout.write(`${relativePath}: positive companion compile PASS\n`);
}

function expectFailure(relativePath, patterns) {
  const result = build(relativePath);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) throw new Error(`${relativePath} unexpectedly compiled`);
  for (const pattern of patterns) {
    if (!output.includes(pattern)) {
      throw new Error(`${relativePath} missing diagnostic ${pattern}\n${output}`);
    }
  }
  process.stdout.write(`${relativePath}: expected compile failure PASS\n`);
}

expectPass('probes/companion_compile');
expectFailure('probes/adversarial_abilities', [
  'CiphertextCertificationV8',
  'BaseDecryptProofV8',
  'PackDecryptProofV8',
  'CompleteDecryptProofV8',
  'PrivateSealReadinessWitnessV8',
  'SealReadinessV8',
  'copy',
  'drop',
  'store',
]);
expectFailure('probes/adversarial_api', [
  'BaseDecryptProofV8',
  'CiphertextCertificationV8',
  'PrivateSealReadinessWitnessV8',
  'SealReadinessV8',
]);
