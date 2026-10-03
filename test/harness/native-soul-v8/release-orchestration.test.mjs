import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { nativeGraphChecks, nativeGraphReleaseChecks, TEST_ADDRESSES } from '../../../scripts/native-soul-test-graph.mjs';

const root = new URL('../../../', import.meta.url);
const checker = new URL('scripts/verify-move-struct-field-limits.mjs', root).pathname;
test('all public Move commands use the same explicit paired graph, with no old direct package path', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const modes = { build: 'build', 'build:disassemble': 'disassemble', 'field-limits': 'field-gates',
    test: 'packages', probes: 'probes', size: 'size-gates', 'release-gates': 'release-gates' };
  for (const [command, mode] of Object.entries(modes)) {
    assert.equal(scripts[`move:${command}`], `node scripts/native-soul-test-graph.mjs --check ${mode}`);
  }
  assert.deepEqual(nativeGraphChecks('release-gates'), nativeGraphReleaseChecks());
  assert.equal(nativeGraphChecks('probes').length, 7);
  assert.equal(nativeGraphChecks('disassemble').length, 8);
  assert.equal(nativeGraphChecks('field-gates').length, 9);
  assert.equal(nativeGraphChecks('size-gates').length, 16);
  assert.equal(nativeGraphChecks('field-gates').at(-1), 'field-limits');
  assert.ok(nativeGraphChecks('field-gates').includes('disassemble:soulidity'));
});
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'paired-field-limits-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = {};
  for (const name of Object.keys(TEST_ADDRESSES)) {
    const build = join(directory, name, 'build', name);
    mkdirSync(join(build, 'disassembly'), { recursive: true });
    mkdirSync(join(build, 'bytecode_modules'));
    const module = name === 'animacraft_v8_core' ? 'maker_v8' : 'sample';
    const struct = name === 'animacraft_v8_core' ? 'MakerRootV8' : 'Sample';
    files[name] = join(build, 'disassembly', `${module}.mvb`);
    writeFileSync(join(build, 'bytecode_modules', `${module}.mv`), 'bytecode inventory fixture');
    writeFileSync(files[name], `module 100.${module} {\nstruct ${struct} {\n  field: u64\n}\n}\n`);
  }
  return { directory, files, run: () => spawnSync(process.execPath,
    [checker, '--packages-root', directory], { encoding: 'utf8' }) };
}

test('paired field limit covers all eight packages including Soulidity and exact32/33 boundary', t => {
  const f = fixture(t);
  const content = count => `module 107.sample {\nstruct Sample {\n${Array.from({ length: count },
    (_, i) => `  field${i}: u64`).join('\n')}\n}\n}\n`;
  writeFileSync(f.files.soulidity, content(32));
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.packages.length, 8);
  assert.equal(report.maximum.role, 'soulidity');
  assert.equal(report.maximum.fieldCount, 32);
  writeFileSync(f.files.soulidity, content(33));
  result = f.run();
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).violations[0].fieldCount, 33);
});

for (const failure of ['missing-module', 'empty-module', 'wrong-module', 'no-structs', 'missing-bytecode']) {
  test(`field coverage fails closed for ${failure}`, t => {
    const f = fixture(t), file = f.files.soulidity;
    if (failure === 'missing-module') rmSync(file);
    if (failure === 'empty-module') writeFileSync(file, '');
    if (failure === 'wrong-module') writeFileSync(file, 'module 107.wrong {\n}\n');
    if (failure === 'no-structs') writeFileSync(file, 'module 107.sample {\n}\n');
    if (failure === 'missing-bytecode') rmSync(join(f.directory, 'soulidity/build/soulidity/bytecode_modules/sample.mv'));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No disassembled modules|Invalid disassembled module|No Move structs|inventory mismatch/);
  });
}

test('required-file CI shell accepts the current harness and rejects retired or incomplete layouts', t => {
  const workflow = readFileSync(new URL('.github/workflows/repository-hygiene.yml', root), 'utf8');
  const block = workflow.match(/      - name: Verify required files\n        run: \|\n([\s\S]*?)(?=\n      - name:)/);
  assert.ok(block, 'required-file CI shell must exist');
  const shell = block[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const run = cwd => spawnSync('bash', ['-e', '-c', shell], { cwd, encoding: 'utf8' });
  assert.equal(run(root).status, 0, 'the actual checkout must satisfy the exact CI shell');
  const directory = mkdtempSync(join(tmpdir(), 'paired-required-files-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const put = path => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'required-file fixture');
  };
  for (const [, path] of shell.matchAll(/^test -f ([^\s"$]+)$/gm)) put(path);
  for (const role of ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']) {
    put(`move/animacraft_v8_${role}/Move.toml`);
  }
  assert.equal(run(directory).status, 0);
  const harness = 'test/harness/animacraft_v8_seal_cap_harness';
  put(`${harness}/Move.toml`);
  assert.notEqual(run(directory).status, 0, 'the retired companion package must be rejected');
  rmSync(join(directory, harness, 'Move.toml'));
  for (const required of ['fixture/slim-core/Move.toml', 'fixture/slim-core/sources/base_registry_v8.move',
    'scripts/verify_reproducibility.mjs']) {
    rmSync(join(directory, harness, required));
    assert.notEqual(run(directory).status, 0, `${required} must remain required`);
    put(`${harness}/${required}`);
  }
  assert.equal(run(directory).status, 0);
});

test('Animacraft web CI verifies the exact paired source before cross-product JS checks', () => {
  const workflow = readFileSync(new URL('.github/workflows/repository-hygiene.yml', root), 'utf8');
  const web = workflow.slice(workflow.indexOf('  web:'), workflow.indexOf('\n  move:'));
  const sequence = ['Require exact paired source revision', 'Checkout paired Soulidity source',
    'Verify paired source checkout', 'Check production build'];
  for (let index = 0; index < sequence.length; index++) {
    assert.ok(web.includes(sequence[index]), `web job requires ${sequence[index]}`);
    if (index) assert.ok(web.indexOf(sequence[index - 1]) < web.indexOf(sequence[index]));
  }
  assert.ok(web.includes('SOULIDITY_COMMIT_SHA: ${{ inputs.soulidity_commit_sha || vars.SOULIDITY_COMMIT_SHA }}'));
  assert.match(web, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(web, /repository: redefine-digital-labs\/soulidity\n\s+ref: \$\{\{ env.SOULIDITY_COMMIT_SHA \}\}\n\s+path: _paired\/soulidity\n\s+persist-credentials: false/);
  assert.ok(web.includes('test "$(git -C _paired/soulidity rev-parse HEAD)" = "$SOULIDITY_COMMIT_SHA"'));
  assert.match(web, /SOULIDITY_WORKSPACE: \$\{\{ github.workspace \}\}\/_paired\/soulidity/);
  assert.match(web, /run: npm run check/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(web, /secrets\.|contents: write|git push/);
});

test('Animacraft CI validates exact peer before checkout and replaces independent Move routes', () => {
  const workflow = readFileSync(new URL('.github/workflows/repository-hygiene.yml', root), 'utf8');
  const before = (a, b) => { assert.ok(workflow.includes(a)); assert.ok(workflow.indexOf(a) < workflow.indexOf(b)); };
  before('Require exact paired source revision', 'Checkout paired Soulidity source');
  before('Checkout paired Soulidity source', 'Verify paired source checkout');
  before('Verify paired source checkout', 'Install pinned Sui CLI');
  before('sha256sum --check --strict', 'tar -xOzf');
  before('Verify test-only seal-cap reproducibility', 'Run paired eight-package Move and joint gates');
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /ref: \$\{\{ env.SOULIDITY_COMMIT_SHA \}\}/);
  assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+soulidity_commit_sha:\n\s+description:[^\n]+\n\s+required: true\n\s+type: string/);
  assert.ok(workflow.includes('SOULIDITY_COMMIT_SHA: ${{ inputs.soulidity_commit_sha || vars.SOULIDITY_COMMIT_SHA }}'));
  assert.match(workflow, /git -C _paired\/soulidity rev-parse HEAD/);
  assert.match(workflow, /ANIMACRAFT_SUI_ARCHIVE="\$RUNNER_TEMP\/\$SUI_ARCHIVE"/);
  assert.match(workflow, /--soulidity-root "\$GITHUB_WORKSPACE\/_paired\/soulidity"/);
  assert.match(workflow, /--sui "\$RUNNER_TEMP\/sui-bin\/sui" --check release-gates/);
  assert.doesNotMatch(workflow, /npm run move:(?:build|test|probes|size|field-limits)\b|sui move (?:build|test) --path/);
  assert.match(workflow, /name: Bundle paired Move gate evidence\n\s+if: always\(\)/);
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/paired-move-evidence.tgz/);
});
