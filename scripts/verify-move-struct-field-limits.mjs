#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--packages-root')) {
  throw new Error('Usage: verify-move-struct-field-limits.mjs [--packages-root DIRECTORY]');
}
const packagesRoot = path.resolve(args[1] ?? 'move');
const packageRoles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release',
  ...(args.length ? ['soulidity'] : [])];
const protocolMaxFields = 32;
const observations = [];

for (const role of packageRoles) {
  const packageName = role === 'soulidity' ? role : `animacraft_v8_${role}`;
  const disassemblyDir = path.resolve(
    packagesRoot,
    packageName,
    'build',
    packageName,
    'disassembly',
  );
  if (!fs.existsSync(disassemblyDir)) {
    throw new Error(
      `Missing ${disassemblyDir}; run npm run move:build:disassemble first.`,
    );
  }
  const modules = fs.readdirSync(disassemblyDir).filter((name) => name.endsWith('.mvb'));
  if (modules.length === 0) throw new Error(`No disassembled modules in ${packageName}`);
  const bytecodeModules = fs.readdirSync(path.join(disassemblyDir, '../bytecode_modules'))
    .filter(name => name.endsWith('.mv')).map(name => name.slice(0, -3)).sort();
  if (JSON.stringify(modules.map(name => name.slice(0, -4)).sort()) !== JSON.stringify(bytecodeModules)) {
    throw new Error(`Disassembly/bytecode module inventory mismatch in ${packageName}`);
  }
  const before = observations.length;
  for (const filename of modules) {
    const moduleName = filename.slice(0, -4);
    const disassembly = fs.readFileSync(path.join(disassemblyDir, filename), 'utf8');
    const declaredModule = /^module\s+(?:0x)?[0-9a-fA-F]{1,64}\.([A-Za-z][A-Za-z0-9_]*)\s*\{/m.exec(disassembly);
    if (declaredModule?.[1] !== moduleName) throw new Error(`Invalid disassembled module ${packageName}/${filename}`);
    for (const match of disassembly.matchAll(/^struct\s+([A-Za-z][A-Za-z0-9_]*)[^\n{]*\{\n([\s\S]*?)^\}/gm)) {
      const [, structName, body] = match;
      const fieldCount = body.split('\n')
        .filter((line) => /^\s+[A-Za-z][A-Za-z0-9_]*:\s/.test(line))
        .length;
      observations.push({ role, moduleName, structName, fieldCount });
    }
  }
  if (observations.length === before) throw new Error(`No Move structs found in ${packageName}`);
}

if (observations.length === 0) throw new Error('No production Move structs found.');
const violations = observations.filter(({ fieldCount }) => fieldCount > protocolMaxFields);
const maximum = observations.reduce((left, right) =>
  (right.fieldCount > left.fieldCount ? right : left));
const makerRoot = observations.find(({ role, moduleName, structName }) =>
  role === 'core' && moduleName === 'maker_v8' && structName === 'MakerRootV8');
if (!makerRoot) throw new Error('MakerRootV8 was not found in production disassembly.');

process.stdout.write(`${JSON.stringify({
  protocolMaxFields,
  packages: packageRoles,
  structCount: observations.length,
  maximum,
  makerRoot,
  violations,
}, null, 2)}\n`);
if (violations.length > 0) process.exitCode = 1;
