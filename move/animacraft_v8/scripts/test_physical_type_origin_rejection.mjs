import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probeRoot = path.join(packageRoot, 'probes', 'type_origin_compile_fail');
const result = spawnSync(
  'sui',
  ['move', 'build', '--warnings-are-errors'],
  { cwd: probeRoot, encoding: 'utf8' },
);
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

if (result.error) {
  throw result.error;
}
if (result.status === 0) {
  throw new Error('Foreign PhysicalRegistryV8 unexpectedly compiled.');
}
if (!output.includes('animacraft_v8_type_origin_probe::probe::PhysicalRegistryV8')) {
  throw new Error(`Compile failed for an unexpected reason:\n${output}`);
}
if (!output.includes('animacraft_v8::physical_v8::PhysicalRegistryV8')) {
  throw new Error(`Compiler did not report the canonical Physical TypeOrigin:\n${output}`);
}
if (!output.includes('animacraft_v8_type_origin_probe::probe::SoulMintAuthorizationV8')) {
  throw new Error(`Compiler did not reject the forged Soul proof:\n${output}`);
}
if (!output.includes('animacraft_v8::complete_v8::SoulMintAuthorizationV8')) {
  throw new Error(`Compiler did not report the canonical Soul proof TypeOrigin:\n${output}`);
}

process.stdout.write(JSON.stringify({
  rejected: true,
  probeTypeOrigin: 'animacraft_v8_type_origin_probe::probe::PhysicalRegistryV8',
  requiredTypeOrigin: 'animacraft_v8::physical_v8::PhysicalRegistryV8',
  forgedSoulProof: 'animacraft_v8_type_origin_probe::probe::SoulMintAuthorizationV8',
  requiredSoulProof: 'animacraft_v8::complete_v8::SoulMintAuthorizationV8',
}, null, 2) + '\n');
