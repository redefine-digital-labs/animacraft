#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function expectCompileFailure(relativePath, requiredPatterns) {
  const result = spawnSync(
    'sui',
    ['move', 'build', '--force', '--warnings-are-errors', '--path', relativePath],
    { cwd: packageDir, encoding: 'utf8' },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) {
    throw new Error(`${relativePath} unexpectedly compiled`);
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
  process.stdout.write(`${relativePath}: adversarial runtime PASS\n`);
}

expectCompileFailure('probes/adversarial_abilities', [
  'ReleaseCatalogWitnessV8',
  'RuntimePackReadinessV8',
  'SealReadinessV8',
  'RuntimeActivationReadinessV8',
  'OutputReadinessV8',
  'PhysicalReadinessV8',
  'MarketReadinessV8',
  'OutputRuntimeRequestV8',
  'PackageCallCapV8',
  'WrappedRightsCertificationV8',
  'SuccessorAuthorityV8',
  'ReleaseReadinessWitnessV8',
  'copy',
  'drop',
  'store',
]);

expectCompileFailure('probes/adversarial_api', [
  'new_rights_snapshot_v8',
  'certify_runtime_pack_readiness_v8',
  'WrappedRightsCertificationV8',
  'SealReadinessV8',
  'OutputRuntimeRequestV8',
]);

expectRuntimePass('probes/adversarial_runtime');
