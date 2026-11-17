import { cp, copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeTestGraph, runNativeGraphCheck } from './native-soul-test-graph.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  if (!['--soulidity-root', '--sui'].includes(name) || !process.argv[index + 1] || options[name]) {
    throw new Error('Expected --soulidity-root <paired-source> and optional --sui <binary>');
  }
  options[name] = process.argv[index + 1];
}
if (!options['--soulidity-root']) throw new Error('An explicit paired Soulidity source root is required');
await readFile(join(resolve(options['--soulidity-root']),
  'move/soulidity/sources/animacraft_pack_adapter_v1.move'));

// Pin all production dependencies through the existing verified graph. This
// harness selects the Pack regression and the real native creation helpers.
const harness = await mkdtemp(join(tmpdir(), 'soul-pack-native-harness-'));
await mkdir(join(harness, 'smoke/sources'), { recursive: true });
await mkdir(join(harness, 'full/tests'), { recursive: true });
await copyFile(join(repository, 'test/harness/native-soul-v8/smoke/sources/identities.move'),
  join(harness, 'smoke/sources/identities.move'));
await cp(join(repository, 'test/harness/native-soul-v8/full/sources'),
  join(harness, 'full/sources'), { recursive: true });
await copyFile(join(repository, 'test/harness/native-soul-v8/full/tests/native_soul_pack_v1.move'),
  join(harness, 'full/tests/native_soul_pack_v1.move'));
const graph = await createNativeTestGraph({ animacraftRoot: repository,
  soulidityRoot: resolve(options['--soulidity-root']), harnessRoot: harness });
console.log(JSON.stringify({ graph: join(graph.directory, 'graph.json'), scope: 'native Soul Pack regression' }));
const result = await runNativeGraphCheck(graph, 'acceptance', { sui: options['--sui'] || 'sui', timeoutMs: 600000 });
console.log(result.output);
console.log(JSON.stringify({ exitCode: result.exitCode, evidence: join(graph.directory, 'acceptance.json') }));
process.exitCode = result.exitCode ?? 1;
