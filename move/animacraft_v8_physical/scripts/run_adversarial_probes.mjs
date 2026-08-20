#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execFileSync('sui', [
  'move', 'build', '--force', '--warnings-are-errors', '--path',
  path.join(root, 'probes', 'companion_compile'),
], { stdio: 'inherit' });

for (const [name, expected] of [
  ['adversarial_abilities', 'does not have the ability'],
  ['adversarial_api', 'restricted visibility'],
  ['adversarial_receipt_proof', 'Unbound function'],
]) {
  try {
    execFileSync('sui', [
      'move', 'build', '--force', '--warnings-are-errors', '--path',
      path.join(root, 'probes', name),
    ], { encoding: 'utf8', stdio: 'pipe' });
    throw new Error(`${name} unexpectedly compiled`);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    if (error.message === `${name} unexpectedly compiled`) throw error;
    if (!output.includes(expected)) {
      process.stderr.write(output);
      throw new Error(`${name} failed for an unexpected reason; missing ${expected}`);
    }
    process.stdout.write(`${name}: expected failure observed\n`);
  }
}
