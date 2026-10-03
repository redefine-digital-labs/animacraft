#!/usr/bin/env node
// Negative compile boundary, not native runtime/key-server acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../move/animacraft_v8_output/probes/no_holder_read', import.meta.url));
let rejected = false;
try {
  execFileSync('sui', ['move', 'build', '--path', target, '--warnings-are-errors'],
    { encoding: 'utf8', stdio: 'pipe' });
} catch (error) {
  const diagnostic = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '');
  const errors = [...diagnostic.matchAll(/error\[([^\]]+)\]/g)].map(match => match[1]);
  assert.deepEqual(errors, ['EC03003'], diagnostic);
  assert.match(diagnostic, /Unbound function 'complete_decrypt_fields_v8' in module 'animacraft_v8_output::output_v8'/);
  rejected = true;
}
assert(rejected, 'The fresh target unexpectedly exposes the retired holder-only read API');
process.stdout.write('PASS: holder-only read API is absent from the compiled target.\n');
