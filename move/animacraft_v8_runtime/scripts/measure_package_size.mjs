#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(packageDir, 'build', 'animacraft_v8_runtime');
const bytecodeDir = path.join(buildDir, 'bytecode_modules');
const disassemblyDir = path.join(buildDir, 'disassembly');
const targetBytes = 90_000;
const hardMaxBytes = 102_400;

if (!fs.existsSync(bytecodeDir) || !fs.existsSync(disassemblyDir)) {
  throw new Error(
    'Run `sui move build --force --disassemble --warnings-are-errors` first.',
  );
}

const modules = fs.readdirSync(bytecodeDir)
  .filter((name) => name.endsWith('.mv'))
  .sort()
  .map((filename) => {
    const moduleName = filename.slice(0, -3);
    const bytecodeBytes = fs.statSync(path.join(bytecodeDir, filename)).size;
    const disassembly = fs.readFileSync(
      path.join(disassemblyDir, `${moduleName}.mvb`),
      'utf8',
    );
    const declaredModule = disassembly
      .match(/^module\s+[^.]+\.([A-Za-z][A-Za-z0-9_]*)\s*\{/m)?.[1];
    if (declaredModule !== moduleName) {
      throw new Error(`Disassembly module mismatch for ${filename}.`);
    }
    const datatypeNames = [
      ...disassembly.matchAll(/^(?:struct|enum)\s+([A-Za-z][A-Za-z0-9_]*)\b/gm),
    ].map((match) => match[1]);
    const dependencyAddresses = [
      ...disassembly.matchAll(/^use\s+([0-9a-fA-F]{64})::/gm),
    ]
      .map((match) => match[1].toLowerCase())
      .filter((address) => !/^0+$/.test(address));
    return { moduleName, bytecodeBytes, datatypeNames, dependencyAddresses };
  });

if (modules.length === 0) throw new Error('No production Move modules found.');
const dependencies = new Set(modules.flatMap((module) => module.dependencyAddresses));
const moduleMapBytes = modules.reduce(
  (total, module) => total + Buffer.byteLength(module.moduleName) + module.bytecodeBytes,
  0,
);
const typeOriginBytes = modules.reduce(
  (total, module) => total + module.datatypeNames.reduce(
    (subtotal, name) => subtotal + Buffer.byteLength(module.moduleName)
      + Buffer.byteLength(name) + 32,
    0,
  ),
  0,
);
const typeOriginCount = modules.reduce(
  (total, module) => total + module.datatypeNames.length,
  0,
);
const linkageBytes = dependencies.size * (32 + 32 + 8);
const packageObjectBytes = 8 + moduleMapBytes + typeOriginBytes + linkageBytes;
const result = {
  formula: 'MovePackage::size',
  moduleBytecodeBytes: modules.reduce((total, module) => total + module.bytecodeBytes, 0),
  moduleMapBytes,
  typeOriginCount,
  typeOriginBytes,
  linkageCount: dependencies.size,
  linkageBytes,
  sequenceNumberBytes: 8,
  packageObjectBytes,
  targetBytes,
  targetHeadroomBytes: targetBytes - packageObjectBytes,
  hardMaxBytes,
  hardMaxHeadroomBytes: hardMaxBytes - packageObjectBytes,
  modules: modules.map(({ moduleName, bytecodeBytes, datatypeNames }) => ({
    moduleName,
    bytecodeBytes,
    typeOriginCount: datatypeNames.length,
  })),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (packageObjectBytes > targetBytes) process.exitCode = 1;
