import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const targets = { core: 97740, seal: 75000, runtime: 90000, output: 90000, physical: 55000, market: 55000, release: 25000 };
const address = value => value.padStart(64, '0');

async function fixture(t, role) {
  const root = await mkdtemp(join(tmpdir(), 'package-size-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'scripts/measure_package_size.mjs');
  const build = join(root, 'build', `animacraft_v8_${role}`);
  await mkdir(join(root, 'scripts'));
  await mkdir(join(build, 'bytecode_modules'), { recursive: true });
  await mkdir(join(build, 'disassembly'));
  await copyFile(new URL(`../../../move/animacraft_v8_${role}/scripts/measure_package_size.mjs`, import.meta.url), script);
  return {
    async module(name, own, imports, { declaredName = name, bytes = 10 } = {}) {
      await writeFile(join(build, 'bytecode_modules', `${name}.mv`), Buffer.alloc(bytes));
      await writeFile(join(build, 'disassembly', `${name}.mvb`),
        `module ${own}.${declaredName} {\n${imports.map(value => `use ${value}::dependency;`).join('\n')}\nstruct Proof {\n}\n}\n`);
    },
    run() { return spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 }); },
  };
}

for (const [role, target] of Object.entries(targets)) {
  test(`${role}: self imports do not change size when the package receives a nonzero address`, async t => {
    const f = await fixture(t, role);
    await f.module('first', '0', [address('0'), address('1'), address('2'), address('1')]);
    await f.module('second', '0', [address('0'), address('2')]);
    const zero = f.run();
    assert.equal(zero.status, 0, zero.stderr);
    await f.module('first', 'AbC', [address('abc'), address('1'), address('2'), address('1')]);
    await f.module('second', 'abc', [address('ABC'), address('2')]);
    const assigned = f.run();
    assert.equal(assigned.status, 0, assigned.stderr);
    const result = JSON.parse(assigned.stdout);
    assert.deepEqual(result, JSON.parse(zero.stdout));
    assert.equal(result.linkageCount, 2);
    assert.equal(result.linkageBytes, 144);
    assert.equal(result.packageObjectBytes, 268);
    assert.equal(result.targetBytes, target);
    assert.equal(result.hardMaxBytes, 102400);
    if (role === 'seal') assert.equal(result.requiredHardMaxHeadroomBytes, 10000);
  });

  test(`${role}: short and full external addresses are counted exactly once`, async t => {
    const f = await fixture(t, role);
    await f.module('first', '0xabc', ['0xabc', '1', address('1'), '0x2']);
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).linkageCount, 2);
  });

  test(`${role}: inconsistent own addresses, invalid headers and wrong module names fail closed`, async t => {
    const f = await fixture(t, role);
    await f.module('first', 'abc', [address('abc')]);
    await f.module('second', 'def', [address('def')]);
    const mixed = f.run();
    assert.equal(mixed.status, 1);
    assert.match(mixed.stderr, /package address mismatch/);
    await f.module('second', 'not-hex', []);
    assert.equal(f.run().status, 1);
    await f.module('second', 'abc', [], { declaredName: 'wrong' });
    assert.equal(f.run().status, 1);
  });

  test(`${role}: exact working ceiling passes and a one-byte increase fails`, async t => {
    const f = await fixture(t, role);
    // One module named first and one datatype Proof add 55 metadata bytes.
    await f.module('first', '0', [address('0')], { bytes: target - 55 });
    const exact = f.run();
    assert.equal(exact.status, 0, exact.stderr);
    assert.equal(JSON.parse(exact.stdout).packageObjectBytes, target);
    await f.module('first', '0', [address('0')], { bytes: target - 54 });
    const run = f.run();
    assert.equal(run.status, 1);
    const result = JSON.parse(run.stdout);
    assert.equal(result.targetBytes, target);
    assert.equal(result.targetHeadroomBytes, -1);
  });
}

test('Core no-growth ceiling is the already certified Protocol137 evidence, not the protocol maximum', async () => {
  const manifest = JSON.parse(await readFile(new URL('../animacraft_v8_seal_cap_harness/evidence/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.replayProvenance.protocolVersion, '137');
  assert.equal(targets.core, manifest.production.corePackageObjectBytes);
  assert.equal(manifest.production.corePackageMaxBytes, 102400);
  assert.equal(manifest.production.corePackageHeadroomBytes, 4660);
  assert.equal(102400 - targets.core, 4660);
});
