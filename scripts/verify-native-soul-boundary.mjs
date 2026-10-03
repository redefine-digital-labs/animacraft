#!/usr/bin/env node
// Production bytecode/ability checks only, not native mint execution acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'move/animacraft_v8_output');
const clean = (value) => String(value ?? '').replace(/\u001b\[[0-9;]*m/g, '');
function build(target, extra = []) {
  return execFileSync('sui', ['move', 'build', '--path', target,
    '--warnings-are-errors', ...extra], { encoding: 'utf8', stdio: 'pipe' });
}

build(output, ['--disassemble']);
const bytecode = readFileSync(path.join(output,
  'build/animacraft_v8_output/disassembly/output_v8.mvb'), 'utf8');
assert.match(bytecode, /public bind_native_soul_v8</);
assert.doesNotMatch(bytecode, /mint_canonical_soul_v8/,
  'The retired duplicate-Soul issuer must not exist in production bytecode');
process.stdout.write('PASS: native binding exists; duplicate-Soul issuer absent from production bytecode.\n');

build(path.join(output, 'probes/native_soul_compile'));
process.stdout.write('PASS: a downstream caller compiles against the actual native binding ABI.\n');

let rejected = false;
try {
  build(path.join(output, 'probes/native_soul_replay'));
} catch (error) {
  const diagnostic = clean(`${error.stdout ?? ''}\n${error.stderr ?? ''}`);
  const errors = [...diagnostic.matchAll(/error\[([^\]]+)\]/g)].map((match) => match[1]);
  assert.deepEqual(errors, ['EC06002'], diagnostic);
  assert.match(diagnostic, /Invalid usage of previously moved variable 'authorization'/);
  rejected = true;
}
assert(rejected, 'Reusing the same completion authorization unexpectedly compiled');
process.stdout.write('PASS: replay rejected specifically for consuming authorization twice.\n');
