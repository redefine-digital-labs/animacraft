#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

execFileSync('sui', [
  'move', 'build', '--force', '--warnings-are-errors', '--path',
  path.join(root, 'probes', 'companion_compile'),
], { stdio: 'inherit' });

for (const [name, expectedCode] of [
  ['adversarial_abilities', 'E05001'],
  ['adversarial_forge_config', 'E04001'],
  ['adversarial_mutate_registry', 'E04001'],
  ['adversarial_steal_cap', 'E04001'],
]) {
  try {
    execFileSync('sui', [
      'move', 'build', '--force', '--warnings-are-errors', '--path',
      path.join(root, 'probes', name),
    ], { encoding: 'utf8', stdio: 'pipe' });
    throw new Error(`${name} unexpectedly compiled`);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`
      .replace(/\u001b\[[0-9;]*m/g, '');
    if (error.message === `${name} unexpectedly compiled`) throw error;
    const diagnostics = [...output.matchAll(/error\[(E\d+)\]/g)]
      .map((match) => match[1]);
    const sourcePath = path.join('sources', 'attack.move');
    if (diagnostics.length !== 1
      || diagnostics[0] !== expectedCode
      || !output.includes(sourcePath)
      || output.includes('warning[')) {
      process.stderr.write(output);
      throw new Error(
        `${name} must fail once at its own attack source with ${expectedCode}; `
          + `observed ${JSON.stringify(diagnostics)}`,
      );
    }
    process.stdout.write(`${name}: exact ${expectedCode} failure observed\n`);
  }
}
