import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS, assertNativeSoulExternalPublicationEntries,
  verifyNativeSoulExternalSourceTree, nativeSoulExternalCommitmentEntries,
  readNativeSoulExternalPublications } from '../scripts/native-soul-external-publications.mjs';
import { renderPublishedToml, parsePublishedToml } from '../scripts/mainnet-v8-release-lib.mjs';
import { publishedPrefixSnapshot, bindInitialPublishedPrefix } from '../scripts/mainnet-v8-release.mjs';
import { NATIVE_SOUL_SOURCE_ORDER, NATIVE_SOUL_SOURCE_NAMES } from '../scripts/native-soul-source-cas.mjs';

// Independent current-source publication vector, never latest IDs or fake caps.
const expected = [
  ['Kiosk', '434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879', 'dfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3', '4'],
  ['WAL', '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59', '356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59', '1'],
  ['Walrus', 'fdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77', 'fa65cb2d62f4d39e60346fb7d501c12538ca2bbc646eaa37ece2aec5f897814e', '2'],
  ['stablecoin', 'ecf47609d7da919ea98e7fd04f6e0648a0a79b337aaad373fa37aac8febf19c8', 'ecf47609d7da919ea98e7fd04f6e0648a0a79b337aaad373fa37aac8febf19c8', '1'],
  ['sui_extensions', 'e0917b74a5912e4ad186ac634e29c922ab83903f71af7500969f9411706f9b9a', 'e0917b74a5912e4ad186ac634e29c922ab83903f71af7500969f9411706f9b9a', '1'],
  ['usdc', 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7', 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7', '1'],
];
const entries = () => NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(pin => ({ packageName: pin.packageName,
  source: `/tmp/cached-sources/${pin.rev}/${pin.subdir}`, originalId: pin.originalId,
  publishedAt: pin.publishedAt, version: pin.version }));
const file = () => ({ buildEnv: 'mainnet', chainId: '35834a8a', entries: [], externalEntries: entries() });
const invalid = { code: 'NATIVE_SOUL_EXTERNAL_PUBLICATION_INVALID' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = v => JSON.stringify(v, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

test('fixed current six publication versions keep upgraded originals distinct and no invented capability', () => {
  assert.deepEqual(entries().map(e => [e.packageName, e.originalId.slice(2), e.publishedAt.slice(2), e.version]), expected);
  const text = renderPublishedToml(file());
  assert.deepEqual(parsePublishedToml(text), file());
  assert.equal((text.match(/\[\[published\]\]/g) || []).length, 6);
  for (const absent of ['upgrade-capability', 'toolchain-version', 'build-config']) assert.equal(text.includes(absent), false);
  assert.equal(entries()[0].originalId === entries()[0].publishedAt, false);
  assert.equal(entries()[2].originalId === entries()[2].publishedAt, false);
});
for (const [name, modify] of Object.entries({
  missing: e => e.pop(), duplicate: e => e[1] = e[0], reordered: e => e.reverse(),
  oldKiosk: e => e[0].publishedAt = e[0].originalId, wrongOriginal: e => e[0].originalId = e[0].publishedAt,
  wrongVersion: e => e[0].version = '3', zeroVersion: e => e[0].version = '0', numericVersion: e => e[0].version = 4,
  currentWalrusGuess: e => e[2].publishedAt = e[2].originalId,
  addedCap: e => e[0].upgradeCapability = e[0].publishedAt,
  wrongName: e => e[0].packageName = 'Other', relative: e => e[0].source = './kiosk',
  wrongDirectory: e => e[0].source += '/evil', escaped: e => e[0].source = '/tmp/x/../kiosk',
  control: e => e[0].source = '/tmp/\nkiosk',
})) test(`publication parser/renderer reject ${name}`, () => {
  const value = file(); modify(value.externalEntries);
  assert.throws(() => renderPublishedToml(value), invalid);
  assert.throws(() => assertNativeSoulExternalPublicationEntries(value.externalEntries), invalid);
});
test('old native-only ephemeral file cannot silently lose all external publications', () => {
  const text = renderPublishedToml(file()).split('[[published]]')[0];
  assert.throws(() => parsePublishedToml(text));
  const value = file(); delete value.externalEntries;
  assert.throws(() => renderPublishedToml(value));
  assert.throws(() => publishedPrefixSnapshot({ executionPlanId: 'a'.repeat(64), events: [] }, '/tmp/source'));
});
test('six metadata rows are mandatory in initial Core and every cold relocated prefix commitment', () => {
  const wal = { executionPlanId: 'a'.repeat(64), events: [] };
  const before = publishedPrefixSnapshot(wal, '/tmp/a', 0, entries());
  const relocated = entries().map(e => ({ ...e, source: e.source.replace('/tmp/cached-sources', '/tmp/another-cache') }));
  const after = publishedPrefixSnapshot(wal, '/tmp/b', 0, relocated);
  assert.equal(before.entries.length, 0); assert.equal(before.externalEntries.length, 6);
  assert.equal(before.sha256, after.sha256); assert.notEqual(before.rawSha256, after.rawSha256);
  assert.deepEqual(nativeSoulExternalCommitmentEntries(entries(), '/tmp/plan'),
    nativeSoulExternalCommitmentEntries(relocated, '/tmp/plan'));
  assert.notEqual(before.sha256, publishedPrefixSnapshot({ ...wal, executionPlanId: 'b'.repeat(64) }, '/tmp/a', 0, entries()).sha256);
});
test('cold parser rejects hidden external metadata or native rows following external rows', () => {
  const text = renderPublishedToml(file());
  assert.throws(() => parsePublishedToml(text.replace('version = 4', 'version = 4\nupgrade-capability = "0x2"')));
  assert.throws(() => parsePublishedToml(text.replace('version = 4', 'version = 4\nsource = { local = "/tmp/evil" }')));
  assert.throws(() => parsePublishedToml(text.replace('version = 4', 'version = 04')));
});
test('actual initial Core binder durably rereads the same portable hash as cold prefix, not raw cache paths', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'initial-external-publication-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const publishedTomlPath = path.join(root, 'Published.toml'), executionPlanId = 'a'.repeat(64);
  writeFileSync(publishedTomlPath, renderPublishedToml(file()));
  const initial = await bindInitialPublishedPrefix({ executionPlanId, checkoutRoot: root, publishedTomlPath, externalEntries: entries() });
  assert.equal(initial.rawSha256, hash(readFileSync(publishedTomlPath)));
  assert.notEqual(initial.sha256, initial.rawSha256);
  const coldEntries = entries().map(e => ({ ...e, source: e.source.replace('/tmp/cached-sources', '/cold/cache') }));
  const cold = publishedPrefixSnapshot({ executionPlanId, events: [] }, '/cold/checkout', 0, coldEntries);
  assert.equal(initial.sha256, cold.sha256);
  writeFileSync(publishedTomlPath, renderPublishedToml(file()).replace('version = 4', 'version = 3'));
  await assert.rejects(bindInitialPublishedPrefix({ executionPlanId, checkoutRoot: root, publishedTomlPath, externalEntries: entries() }),
    { code: 'MAINNET_V8_PUBLISHED_TOML_COLD_READ_DRIFT' });
});

function sourceFixture(t) {
  const repository = mkdtempSync(path.join(tmpdir(), 'external-publication-source-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  const directory = path.join(repository, 'pkg'); mkdirSync(path.join(directory, 'sources'), { recursive: true });
  for (const [name, text] of Object.entries({ 'Move.toml': '[package]\nname="pkg"\n',
    'Move.lock': '[move]\nversion=4\n', 'Published.toml': '[published.mainnet]\nversion=1\n',
    'sources/main.move': 'module pkg::main;\n', '.gitignore': 'sources/ignored.move\n' })) writeFileSync(path.join(directory, name), text);
  const git = args => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'exact input']);
  return { repository, directory, rev: git(['rev-parse', 'HEAD']).trim(), subdir: 'pkg', git };
}
test('local source evidence verifies committed bytes including locks and publication metadata', t => {
  const f = sourceFixture(t), original = verifyNativeSoulExternalSourceTree(f);
  assert.equal(original.directory, realpathSync(f.directory)); assert.match(original.filesSha256, /^[0-9a-f]{64}$/);
  mkdirSync(path.join(f.directory, 'build')); writeFileSync(path.join(f.directory, 'build/generated.move'), 'generated not a compiler input');
  assert.deepEqual(verifyNativeSoulExternalSourceTree(f), original);
});
for (const name of ['Move.toml', 'Move.lock', 'Published.toml', 'sources/main.move', 'sources/ignored.move', 'sources/new.move']) {
  test(`actual filesystem check rejects modified or untracked ${name}, not just Git status`, t => {
    const f = sourceFixture(t); writeFileSync(path.join(f.directory, name), 'tampered\n');
    assert.throws(() => verifyNativeSoulExternalSourceTree(f), invalid);
  });
}
test('actual filesystem check rejects missing file, symlink, symlink subtree and wrong revision', t => {
  const f = sourceFixture(t);
  assert.throws(() => verifyNativeSoulExternalSourceTree({ ...f, rev: 'a'.repeat(40) }), invalid);
  assert.throws(() => verifyNativeSoulExternalSourceTree({ ...f, subdir: '../pkg' }), invalid);
  rmSync(path.join(f.directory, 'sources/main.move'));
  assert.throws(() => verifyNativeSoulExternalSourceTree(f), invalid);
  symlinkSync(path.join(f.directory, 'Move.toml'), path.join(f.directory, 'sources/main.move'));
  assert.throws(() => verifyNativeSoulExternalSourceTree(f), invalid);
  rmSync(path.join(f.directory, 'sources'), { recursive: true });
  symlinkSync(f.repository, path.join(f.directory, 'sources'));
  assert.throws(() => verifyNativeSoulExternalSourceTree(f), invalid);
});
test('a nested sources/build directory cannot hide untracked compiler input', t => {
  const f = sourceFixture(t);
  mkdirSync(path.join(f.directory, 'sources/build'));
  writeFileSync(path.join(f.directory, 'sources/build/injected.move'), 'module pkg::injected;');
  assert.throws(() => verifyNativeSoulExternalSourceTree(f), invalid);
});

function frozenFixture(t) {
  const checkoutRoot = mkdtempSync(path.join(tmpdir(), 'external-publication-frozen-'));
  t.after(() => rmSync(checkoutRoot, { recursive: true, force: true }));
  const lock = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(p => `[pinned.mainnet.${p.packageName}]\nsource = { git = "${p.git}", subdir = "${p.subdir}", rev = "${p.rev}" }\nuse_environment = "mainnet"\n`).join('\n');
  const manifest = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.filter(p => !['WAL', 'Walrus'].includes(p.packageName))
    .map(p => `${p.packageName} = { published-at = "${p.publishedAt}", original-id = "${p.originalId}" }`).join('\n');
  const sourceRevision = { schema: 'animacraft.native-source-snapshot.v1', repositories: {
    animacraft: { baseGitCommit: '1'.repeat(40), baseGitTree: '2'.repeat(40) },
    soulidity: { baseGitCommit: '3'.repeat(40), baseGitTree: '4'.repeat(40) },
  }, packages: NATIVE_SOUL_SOURCE_ORDER.map(role => {
    const packageName = NATIVE_SOUL_SOURCE_NAMES[role], directory = path.join(checkoutRoot, 'move', packageName);
    mkdirSync(path.join(directory, 'sources'), { recursive: true });
    const files = Object.entries({ 'Move.lock': lock, 'Move.toml': manifest, 'sources/main.move': 'module test::main;' }).map(([name, text]) => {
      writeFileSync(path.join(directory, name), text);
      return { path: name, byteLength: String(Buffer.byteLength(text)), sha256: hash(text) };
    });
    return { role, packageName, repository: role === 'soulidity' ? 'soulidity' : 'animacraft', files, originalFiles: structuredClone(files) };
  }) };
  const rehash = () => { delete sourceRevision.snapshotSha256; sourceRevision.snapshotSha256 = hash(canonical(sourceRevision)); };
  rehash(); return { checkoutRoot, sourceRevision, rehash };
}
test('relative or empty MOVE_HOME cannot select a different cache from the clean-room compiler', t => {
  const f = frozenFixture(t);
  for (const moveHome of ['', '.move', '/tmp/a/../cache']) {
    assert.throws(() => readNativeSoulExternalPublications({ ...f, moveHome }), invalid);
  }
});
for (const type of ['source-bytes', 'source-hash', 'wrong-frozen-pin', 'missing-frozen-pin', 'duplicate-frozen-pin']) {
  test(`actual reader rejects ${type} before external cache access`, t => {
    const f = frozenFixture(t), pkg = f.sourceRevision.packages.find(p => p.role === 'release');
    const filename = path.join(f.checkoutRoot, 'move', pkg.packageName, 'Move.lock');
    let text = readFileSync(filename, 'utf8');
    if (type === 'source-bytes') text += '# modified';
    if (type === 'source-hash') { pkg.files[0].sha256 = 'a'.repeat(64); f.rehash(); }
    if (type === 'wrong-frozen-pin') text = text.replace('7a07937149c0af057be8f6747e60d0f1acd88fde', 'a'.repeat(40));
    if (type === 'missing-frozen-pin') text = text.replace('[pinned.mainnet.Kiosk]', '[pinned.mainnet.NotKiosk]');
    if (type === 'duplicate-frozen-pin') text += '\n[pinned.mainnet.Kiosk]\n';
    writeFileSync(filename, text);
    if (type.includes('frozen-pin')) { pkg.files[0] = { ...pkg.files[0], byteLength: String(Buffer.byteLength(text)), sha256: hash(text) }; f.rehash(); }
    assert.throws(() => readNativeSoulExternalPublications({ ...f, moveHome: '/unavailable-do-not-fetch' }), invalid);
  });
}
