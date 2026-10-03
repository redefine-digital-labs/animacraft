import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNativeSoulSourceRevision } from './native-soul-source-cas.mjs';

// These are the existing source pins/publication targets, not latest-package
// discovery. The four Circle/Kiosk IDs also occur in Soulidity's frozen manifest;
// WAL/Walrus metadata comes from Published.toml at this exact Walrus revision.
const circle = 'https://github.com/circlefin/stablecoin-sui.git';
const circleRev = 'd0904aec1bbe46b38f811654070032363a5a2966';
const walrus = 'https://github.com/MystenLabs/walrus.git';
const walrusRev = 'a19764ff77f501a79db88dc6d922a2c73848e989';
const pins = [
  ['Kiosk', 'https://github.com/MystenLabs/apps.git', '7a07937149c0af057be8f6747e60d0f1acd88fde', 'kiosk',
    '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879',
    '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3', '4'],
  ['WAL', walrus, walrusRev, 'mainnet-contracts/wal',
    '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59',
    '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59', '1'],
  ['Walrus', walrus, walrusRev, 'mainnet-contracts/walrus',
    '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77',
    '0xfa65cb2d62f4d39e60346fb7d501c12538ca2bbc646eaa37ece2aec5f897814e', '2'],
  ['stablecoin', circle, circleRev, 'packages/stablecoin',
    '0xecf47609d7da919ea98e7fd04f6e0648a0a79b337aaad373fa37aac8febf19c8',
    '0xecf47609d7da919ea98e7fd04f6e0648a0a79b337aaad373fa37aac8febf19c8', '1'],
  ['sui_extensions', circle, circleRev, 'packages/sui_extensions',
    '0xe0917b74a5912e4ad186ac634e29c922ab83903f71af7500969f9411706f9b9a',
    '0xe0917b74a5912e4ad186ac634e29c922ab83903f71af7500969f9411706f9b9a', '1'],
  ['usdc', circle, circleRev, 'packages/usdc',
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7',
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7', '1'],
];
export const NATIVE_SOUL_EXTERNAL_PUBLICATIONS = Object.freeze(pins.map(
  ([packageName, git, rev, subdir, originalId, publishedAt, version]) =>
    Object.freeze({ packageName, git, rev, subdir, originalId, publishedAt, version }),
));
// Static publication linkage is a minimum under Sui unified linkage. It is not
// the current Walrus System execution authority (certified independently).
const walrusMinimum = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.find(row => row.packageName === 'Walrus');
export const NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY = Object.freeze({
  originalPackageId: walrusMinimum.originalId, publishedAt: walrusMinimum.publishedAt,
  version: walrusMinimum.version,
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check(value, message) {
  if (!value) { const error = new Error(`External publication: ${message}`);
    error.code = 'NATIVE_SOUL_EXTERNAL_PUBLICATION_INVALID'; throw error; }
}
function exact(value, names) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join() === [...names].sort().join(), 'unexpected fields');
}
export function assertNativeSoulExternalPublicationEntries(entries) {
  check(Array.isArray(entries) && entries.length === pins.length, 'exact six external publications required');
  entries.forEach((entry, i) => {
    exact(entry, ['packageName', 'source', 'publishedAt', 'originalId', 'version']);
    const pin = NATIVE_SOUL_EXTERNAL_PUBLICATIONS[i];
    for (const name of ['packageName', 'publishedAt', 'originalId', 'version']) {
      check(entry[name] === pin[name], `${pin.packageName} ${name} differs from fixed publication`);
    }
    check(typeof entry.source === 'string' && entry.source.length < 16384
      && !/[\x00-\x1f\x7f]/.test(entry.source) && path.resolve(entry.source) === entry.source
      && path.basename(entry.source) === path.basename(pin.subdir), 'noncanonical external source directory');
  });
  check(new Set(entries.map(entry => entry.source)).size === pins.length, 'duplicate external source');
  return entries;
}

function git(repository, args) {
  // No lazy fetch or user Git helpers: this is a bounded, local evidence check.
  return execFileSync('git', ['--no-replace-objects', '-C', repository, ...args], {
    encoding: 'utf8', timeout: 25000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const sourceFile = name => name.endsWith('.move')
  || ['Move.toml', 'Move.lock', 'Published.toml'].includes(path.basename(name));

/** Check actual compiler inputs against the exact commit, including ignored or
 * untracked Move files. Git status alone intentionally excludes lock/pub files
 * in the approved CLI and is not sufficient for our sealed build. */
export function verifyNativeSoulExternalSourceTree({ repository, rev, subdir }) {
  check(typeof rev === 'string' && /^[0-9a-f]{40}$/.test(rev), 'nonexact Git revision');
  check(typeof subdir === 'string' && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(subdir), 'unsafe Git subdirectory');
  const root = realpathSync(repository);
  check(git(root, ['rev-parse', 'HEAD']).trim() === rev, 'cache revision mismatch');
  const directory = path.join(root, subdir);
  check(realpathSync(directory) === directory, 'symlink package directory');
  const expected = new Map();
  for (const row of git(root, ['ls-tree', '-rz', rev, '--', subdir]).split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(row);
    const filename = row.slice(row.indexOf('\t') + 1);
    if (!sourceFile(filename)) continue;
    check(match, 'nonregular pinned compiler input');
    expected.set(filename.slice(subdir.length + 1), match[2]);
  }
  check(expected.has('Move.toml') && expected.size <= 2000, 'missing or unbounded pinned manifest');
  const observed = new Map();
  let count = 0, totalBytes = 0;
  function visit(relative = '') {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      if (relative === '' && (name === 'build' || name === '.git')) continue;
      check(++count <= 10000, 'unbounded source inventory');
      const next = relative ? `${relative}/${name}` : name;
      const filename = path.join(directory, next), stat = lstatSync(filename);
      check(!stat.isSymbolicLink(), 'symlink inside dependency');
      if (stat.isDirectory()) visit(next);
      else if (sourceFile(next)) {
        check(stat.isFile() && stat.size <= 4 * 1024 * 1024, 'invalid compiler input');
        const bytes = readFileSync(filename); totalBytes += bytes.length;
        check(totalBytes <= 64 * 1024 * 1024, 'unbounded compiler input bytes');
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        check(expected.get(next) === blob, `compiler input differs from pinned commit: ${next}`);
        observed.set(next, hash(bytes));
      }
    }
  }
  visit();
  check(expected.size === observed.size, 'missing pinned compiler input');
  return Object.freeze({ directory, filesSha256: hash(JSON.stringify([...observed].sort())) });
}

function frozenFile(sourceRevision, checkoutRoot, role, name) {
  const pkg = sourceRevision.packages.find(row => row.role === role);
  const evidence = pkg?.files.find(row => row.path === name);
  check(evidence, 'missing frozen source metadata');
  const filename = path.join(realpathSync(checkoutRoot), 'move', pkg.packageName, name);
  check(lstatSync(filename).isFile() && realpathSync(filename) === path.resolve(filename), 'unsafe frozen metadata path');
  const bytes = readFileSync(filename);
  check(String(bytes.length) === evidence.byteLength && hash(bytes) === evidence.sha256, 'frozen source metadata drift');
  return bytes.toString('utf8');
}

/** No network or checkout mutation. A missing/corrupt cache is an explicit build
 * prerequisite failure, never permission to compile unpublished dependencies. */
export function readNativeSoulExternalPublications({ sourceRevision, checkoutRoot,
  moveHome = process.env.MOVE_HOME ?? path.join(os.homedir(), '.move') }) {
  assertNativeSoulSourceRevision(sourceRevision);
  // A relative MOVE_HOME would resolve differently in the runner and the CLI's
  // clean-room cwd. Do not silently substitute the default for an empty value.
  check(typeof moveHome === 'string' && path.isAbsolute(moveHome)
    && path.resolve(moveHome) === moveHome && !/[\x00-\x1f\x7f]/.test(moveHome), 'MOVE_HOME must be an exact absolute cache root');
  const lock = frozenFile(sourceRevision, checkoutRoot, 'release', 'Move.lock');
  const manifest = frozenFile(sourceRevision, checkoutRoot, 'soulidity', 'Move.toml');
  const rows = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(pin => {
    const header = `[pinned.mainnet.${pin.packageName}]`;
    check(lock.split(header).length === 2, `missing or duplicate frozen ${pin.packageName} pin`);
    const section = lock.split(header)[1].split('\n[')[0];
    check(section.includes(`source = { git = "${pin.git}", subdir = "${pin.subdir}", rev = "${pin.rev}" }`)
      && section.includes('use_environment = "mainnet"'), 'external frozen Git pin mismatch');
    if (!['WAL', 'Walrus'].includes(pin.packageName)) {
      check(manifest.includes(`${pin.packageName} = { published-at = "${pin.publishedAt}", original-id = "${pin.originalId}" }`),
        'external frozen replacement mismatch');
    }
    // Matches approved move-package-alt GitCache::tree_for_sha/url_to_file_name.
    const repository = path.join(path.resolve(moveHome), 'git', `${pin.git.replace(/[/:.@]/g, '_')}_${pin.rev}`);
    const { directory } = verifyNativeSoulExternalSourceTree({ repository, rev: pin.rev, subdir: pin.subdir });
    const metadataFile = ['WAL', 'Walrus'].includes(pin.packageName) ? 'Published.toml'
      : pin.packageName === 'Kiosk' ? null : 'Move.lock';
    if (metadataFile) {
      const metadata = readFileSync(path.join(directory, metadataFile), 'utf8');
      const sectionName = metadataFile === 'Published.toml' ? '[published.mainnet]' : '[env.mainnet]';
      const section = metadata.split(sectionName)[1]?.split('\n[')[0];
      check(section && section.includes('chain-id = "35834a8a"'), 'missing mainnet external metadata');
      for (const [name, value] of metadataFile === 'Published.toml'
        ? [['original-id', `"${pin.originalId}"`], ['published-at', `"${pin.publishedAt}"`], ['version', pin.version]]
        : [['original-published-id', `"${pin.originalId}"`], ['latest-published-id', `"${pin.publishedAt}"`], ['published-version', `"${pin.version}"`]]) {
        check(section.split('\n').includes(`${name} = ${value}`), 'pinned external publication metadata mismatch');
      }
    }
    return Object.freeze({ packageName: pin.packageName, source: directory,
      publishedAt: pin.publishedAt, originalId: pin.originalId, version: pin.version });
  });
  assertNativeSoulExternalPublicationEntries(rows);
  return Object.freeze(rows);
}

export function nativeSoulExternalCommitmentEntries(entries, commitmentRoot) {
  assertNativeSoulExternalPublicationEntries(entries);
  return entries.map((entry, index) => ({ ...entry, source: path.join(commitmentRoot,
    'external', NATIVE_SOUL_EXTERNAL_PUBLICATIONS[index].rev, NATIVE_SOUL_EXTERNAL_PUBLICATIONS[index].subdir) }));
}
