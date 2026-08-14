#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execFileSync('sui', ['move', 'build', '--force', '--warnings-are-errors', '--path',
  path.join(root, 'probes', 'companion_compile')], { stdio: 'inherit' });

for (const [name, expected] of [
  ['adversarial_abilities', [
    'CompleteSessionV8',
    'ProtectedCompletePendingV8',
    'SoulMintAuthorizationV8',
    'PhysicalMaterializationWitnessV8',
    'CompleteOutputV8',
    'CompleteReceiptV8',
    'CanonicalSoulV8',
    'does not have the ability',
  ]],
  ['adversarial_api', [
    'output_call_cap', 'PhysicalMaterializationWitnessV8', 'restricted visibility',
  ]],
  ['adversarial_bypass', ['mutate_base_counter', 'restricted visibility']],
  ['adversarial_replay', ['witness', 'authorization', 'previously moved']],
]) {
  try {
    execFileSync('sui', ['move', 'build', '--force', '--warnings-are-errors', '--path',
      path.join(root, 'probes', name)], { encoding: 'utf8', stdio: 'pipe' });
    throw new Error(`${name} unexpectedly compiled`);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    if (error.message === `${name} unexpectedly compiled`) throw error;
    const missing = expected.filter((fragment) => !output.includes(fragment));
    if (missing.length > 0) {
      process.stderr.write(output);
      throw new Error(`${name} failed for an unexpected reason; missing ${missing.join(', ')}`);
    }
    process.stdout.write(`${name}: expected failure observed\n`);
  }
}
