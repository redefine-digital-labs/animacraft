#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const packageRoles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const protocolMaxFields = 32;
const observations = [];

for (const role of packageRoles) {
  const packageName = `animacraft_v8_${role}`;
  const disassemblyDir = path.resolve(
    'move',
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
  for (const filename of fs.readdirSync(disassemblyDir).filter((name) => name.endsWith('.mvb'))) {
    const moduleName = filename.slice(0, -4);
    const disassembly = fs.readFileSync(path.join(disassemblyDir, filename), 'utf8');
    for (const match of disassembly.matchAll(/^struct\s+([A-Za-z][A-Za-z0-9_]*)[^\n{]*\{\n([\s\S]*?)^\}/gm)) {
      const [, structName, body] = match;
      const fieldCount = body.split('\n')
        .filter((line) => /^\s+[A-Za-z][A-Za-z0-9_]*:\s/.test(line))
        .length;
      observations.push({ role, moduleName, structName, fieldCount });
    }
  }
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
  structCount: observations.length,
  maximum,
  makerRoot,
  violations,
}, null, 2)}\n`);
if (violations.length > 0) process.exitCode = 1;
