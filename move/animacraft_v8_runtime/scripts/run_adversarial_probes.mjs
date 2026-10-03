#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execFileSync('sui', ['move', 'build', '--force', '--warnings-are-errors', '--path',
  path.join(root, 'probes', 'companion_compile')], { stdio: 'inherit' });

for (const [name, expected] of [
  ['adversarial_abilities', ['does not have the ability',
    'RuntimeLoadoutAuthorizationV8', 'SelectionAccessProofV8', 'PackCompleteLineV8',
    'RuntimeBaseEntitlementWitnessV8', 'RuntimePackEntitlementWitnessV8',
    'RuntimePhysicalSelectionWitnessV8']],
  ['adversarial_api', ['restricted visibility', 'RuntimeActivationReadinessReceiptV8',
    'RuntimePhysicalSelectionWitnessV8']],
  ['adversarial_complete_api', ['restricted visibility', 'authorize_pack_complete_line_v8']],
  ['adversarial_physical_replay', ['previously moved', 'witness']],
]) {
  try {
    execFileSync('sui', ['move', 'build', '--force', '--warnings-are-errors', '--path',
      path.join(root, 'probes', name)], { encoding: 'utf8', stdio: 'pipe' });
    throw new Error(`${name} unexpectedly compiled`);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    if (error.message === `${name} unexpectedly compiled`) throw error;
    if (/unbound module member|unbound type|unbound field|too few arguments|too many arguments|invalid subtype|incompatible types|missing fields/i.test(output)) {
      process.stderr.write(output);
      throw new Error(`${name} failed with an unrelated ABI error`);
    }
    const missing = expected.filter((fragment) => !output.includes(fragment));
    if (missing.length > 0) {
      process.stderr.write(output);
      throw new Error(`${name} failed for an unexpected reason; missing ${missing.join(', ')}`);
    }
    process.stdout.write(`${name}: expected failure observed\n`);
  }
}
