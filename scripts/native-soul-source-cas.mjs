import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, realpath, readdir, readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
export const NATIVE_SOUL_SOURCE_SCHEMA = 'animacraft.native-source-snapshot.v1';
export const NATIVE_SOUL_SOURCE_ORDER = Object.freeze(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'soulidity', 'release']);
export const NATIVE_SOUL_SOURCE_NAMES = Object.freeze(Object.fromEntries(NATIVE_SOUL_SOURCE_ORDER.map(role =>
  [role, role === 'soulidity' ? 'soulidity' : `animacraft_v8_${role}`])));
const EDGES = { core: [], seal: ['core'], runtime: ['core', 'seal'], output: ['core', 'seal', 'runtime'],
  physical: ['core', 'output', 'runtime'], market: ['core', 'output', 'physical', 'runtime', 'release'],
  soulidity: ['core', 'output'], release: ['core', 'seal', 'runtime', 'output', 'physical', 'soulidity'] };
function closure(role, seen = new Set()) {
  for (const next of EDGES[role]) if (!seen.has(next)) { seen.add(next); closure(next, seen); }
  return seen;
}
const MAX_BYTES = 64 * 1024 * 1024, MAX_FILE = 4 * 1024 * 1024, MAX_FILES = 2000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function fail(message) { const e = new Error(`Invalid native source snapshot: ${message}`); e.code = 'NATIVE_SOUL_SOURCE_INVALID'; throw e; }
function check(value, message) { if (!value) fail(message); }
function keys(value, names) { check(value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join() === [...names].sort().join(), 'unexpected metadata fields'); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const repositoryFor = role => role === 'soulidity' ? 'soulidity' : 'animacraft';
// Existing Circle/Kiosk identity substitutions are not product package aliases.
// Keep original type addresses distinct from upgraded callable package IDs.
const CIRCLE_SOURCE = 'https://github.com/circlefin/stablecoin-sui.git';
const CIRCLE_REVISION = 'd0904aec1bbe46b38f811654070032363a5a2966';
const CIRCLE_ADDRESSES = Object.freeze({
  usdc: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7',
  stablecoin: '0xecf47609d7da919ea98e7fd04f6e0648a0a79b337aaad373fa37aac8febf19c8',
  sui_extensions: '0xe0917b74a5912e4ad186ac634e29c922ab83903f71af7500969f9411706f9b9a',
});
const EXTERNAL_SUBSTITUTIONS = freeze({
  usdc: { git: CIRCLE_SOURCE, subdir: 'packages/usdc', rev: CIRCLE_REVISION,
    override: undefined, addresses: CIRCLE_ADDRESSES, original: CIRCLE_ADDRESSES.usdc, callable: CIRCLE_ADDRESSES.usdc },
  stablecoin: { git: CIRCLE_SOURCE, subdir: 'packages/stablecoin', rev: CIRCLE_REVISION,
    override: 'true', addresses: { stablecoin: CIRCLE_ADDRESSES.stablecoin, sui_extensions: CIRCLE_ADDRESSES.sui_extensions },
    original: CIRCLE_ADDRESSES.stablecoin, callable: CIRCLE_ADDRESSES.stablecoin },
  sui_extensions: { git: CIRCLE_SOURCE, subdir: 'packages/sui_extensions', rev: CIRCLE_REVISION,
    override: 'true', addresses: { sui_extensions: CIRCLE_ADDRESSES.sui_extensions },
    original: CIRCLE_ADDRESSES.sui_extensions, callable: CIRCLE_ADDRESSES.sui_extensions },
  Kiosk: { git: 'https://github.com/MystenLabs/apps.git', subdir: 'kiosk', rev: '7a07937149c0af057be8f6747e60d0f1acd88fde',
    override: 'true', addresses: { kiosk: '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879' },
    original: '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879',
    callable: '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3' },
});
// Publication verification shares this exact approved source substitution; it
// must not infer a TypeOrigin from the callable ID or ambient SDK defaults.
export const NATIVE_SOUL_KIOSK_DEPENDENCY = Object.freeze({
  original: EXTERNAL_SUBSTITUTIONS.Kiosk.original,
  callable: EXTERNAL_SUBSTITUTIONS.Kiosk.callable,
});
function addressMap(text, replacement = false) {
  check(typeof text === 'string' && /^\{[^{}]*\}$/.test(text), 'unsupported external address map');
  const result = Object.create(null);
  for (const entry of text.slice(1, -1).split(',')) {
    const match = replacement
      ? /^\s*(published-at|original-id)\s*=\s*"(0x[0-9a-f]{64})"\s*$/.exec(entry)
      : /^\s*(?:"([A-Za-z_][A-Za-z_0-9]*)"|([A-Za-z_][A-Za-z_0-9]*))\s*=\s*"(0x[0-9a-f]{64})"\s*$/.exec(entry);
    check(match, 'unsupported external address entry');
    const key = replacement ? match[1] : match[1] || match[2];
    const value = replacement ? match[2] : match[3];
    check(!Object.hasOwn(result, key) && value !== `0x${'0'.repeat(64)}`, 'duplicate/zero external address');
    result[key] = value;
  }
  return result;
}
function matchesExternalSource(name, git) {
  const expected = EXTERNAL_SUBSTITUTIONS[name];
  return Boolean(git && expected && git[1] === expected.git && git[2] === expected.subdir && git[3] === expected.rev);
}
function checkExternalManifestLock(metadata) {
  for (const name of metadata.externalDependencies || []) {
    const target = metadata.rootDependencies?.get(name);
    check(metadata.rootSource === true && target && matchesExternalSource(name, metadata.lockSources?.get(target)),
      'external manifest dependency is missing or mismatched in its mainnet lock root');
  }
}

// Sui testnet-v1.78.1 move-package-alt: legacy_parser -> CombinedDependency ->
// Package::compute_digest (toml_edit 0.22.24). The [addresses] manifest format
// includes dev dependencies in this digest, but drops addr_subst/replacements.
// Those IDs remain independently checked above; this is NOT linkage attestation.
function nativeDependencyDigest(metadata, original = false) {
  const deps = new Map(metadata.dependencies);
  check(!['Bridge', 'DeepBook', 'SuiSystem', 'sui', 'std', 'bridge', 'deepbook', 'sui_system'].some(name => deps.has(name)),
    'unsupported explicit system dependency digest');
  if (metadata.implicitDependencies !== false && !deps.has('Sui') && !deps.has('MoveStdlib')) {
    for (const name of ['std', 'sui']) deps.set(name, { source: `System = { system = "${name}" }`, override: true, dev: false });
  }
  const serialized = deps.size === 0 ? 'deps = {}\n' : `deps = { ${[...deps.keys()].sort().map(name => {
    const dep = deps.get(name);
    return `${name} = { ${original ? dep.originalSource ?? dep.source : dep.source}, override = ${dep.override}${dep.dev ? ', modes = ["test"]' : ''}, use-environment = "mainnet" }`;
  }).join(', ')} }\n`;
  return hash(serialized).toUpperCase();
}

function normalizeNativeLockDigests(text, role, digests, localDependencies) {
  const sections = new Map(); let section = '';
  for (const line of text.split('\n')) {
    const header = /^\[([^\]]+)\]$/.exec(line.trim());
    if (header) { section = header[1]; sections.set(section, []); }
    else sections.get(section)?.push(line.trim());
  }
  const required = new Set();
  function requirePackage(name) {
    if (required.has(name)) return;
    required.add(name);
    for (const dependency of localDependencies.get(name)) requirePackage(dependency);
  }
  requirePackage(NATIVE_SOUL_SOURCE_NAMES[role]);
  for (const name of required) check(sections.has(`pinned.mainnet.${name}`), 'native lock closure section is required');
  const replacements = new Map();
  for (const [nameOfSection, lines] of sections) {
    const match = /^pinned\.mainnet\.([A-Za-z_][A-Za-z_0-9]*)$/.exec(nameOfSection);
    if (!match || !digests.has(match[1])) continue;
    const name = match[1];
    check(required.has(name), 'native lock package is outside current manifest closure');
    const expectedSource = name === NATIVE_SOUL_SOURCE_NAMES[role]
      ? /^source\s*=\s*\{\s*root\s*=\s*true\s*\}$/
      : new RegExp(`^source = \\{ local = "\\.\\./${name}" \\}$`);
    check(lines.some(value => expectedSource.test(value)), 'native lock digest must describe its exact local source');
    check(lines.some(value => /^use_environment\s*=\s*"mainnet"$/.test(value)), 'native lock digest environment');
    const dependencyLine = lines.find(value => /^deps\s*=/.test(value)) ?? '';
    const references = new Map([...dependencyLine.matchAll(/([A-Za-z_][A-Za-z_0-9]*)\s*=\s*"([A-Za-z_][A-Za-z_0-9]*)"/g)]
      .map(pair => [pair[1], pair[2]]));
    for (const dependency of localDependencies.get(name)) check(references.get(dependency) === dependency,
      'native lock dependency reference does not match current manifest');
    for (const [dependency, target] of references) if (digests.has(dependency) || digests.has(target)) {
      check(localDependencies.get(name).includes(dependency) && target === dependency,
        'native lock dependency reference is outside current manifest');
    }
    const digestLines = lines.filter(value => /^manifest_digest\s*=/.test(value));
    check(digestLines.length === 1 && /^manifest_digest\s*=\s*"[0-9A-F]{64}"$/.test(digestLines[0]),
      'native lock manifest digest is required in exact format');
    check(digestLines[0].match(/"([0-9A-F]{64})"$/)[1] === digests.get(name).original,
      `native lock digest does not match original manifest: ${role} -> ${name}`);
    replacements.set(nameOfSection, digests.get(name).derived);
  }
  section = '';
  return text.split('\n').map(line => {
    const trimmed = line.trim(), header = /^\[([^\]]+)\]$/.exec(trimmed);
    if (header) { section = header[1]; return line; }
    return replacements.has(section) && /^manifest_digest\s*=/.test(trimmed)
      ? `manifest_digest = "${replacements.get(section)}"` : line;
  }).join('\n');
}

function deriveNativeManifestFiles(packages, blobs, resolveLocal) {
  const derived = new Map(), digests = new Map(), localDependencies = new Map();
  for (const pkg of packages) {
    const metadata = {}, files = new Map();
    for (const filename of ['Move.toml', 'Move.lock']) {
      const original = blobs.get(pkg.originalFiles.find(row => row.path === filename).sha256);
      files.set(filename, remapManifest(new TextDecoder('utf-8', { fatal: true }).decode(original),
        pkg.role, filename, resolveLocal ? (name, local) => resolveLocal(pkg, name, local) : undefined, metadata));
    }
    checkExternalManifestLock(metadata);
    localDependencies.set(pkg.packageName, [...metadata.dependencies].filter(([, dep]) => dep.source.startsWith('Local = ')).map(([name]) => name));
    digests.set(pkg.packageName, { original: nativeDependencyDigest(metadata, true), derived: nativeDependencyDigest(metadata) });
    derived.set(pkg.packageName, files);
  }
  for (const pkg of packages) {
    const files = derived.get(pkg.packageName);
    files.set('Move.lock', normalizeNativeLockDigests(files.get('Move.lock'), pkg.role, digests, localDependencies));
  }
  return derived;
}
function sourcePath(value) { check(typeof value === 'string' && (['Move.toml', 'Move.lock'].includes(value)
  || /^sources\/(?:[A-Za-z_0-9.-]+\/)*[A-Za-z_][A-Za-z_0-9]*\.move$/.test(value))
  && !value.split('/').some(p => p === '.' || p === '..'), 'source path'); }
function record(file, bytes) { return { path: file, byteLength: String(bytes.length), sha256: hash(bytes) }; }
function records(rows) {
  check(Array.isArray(rows) && rows.length >= 3 && rows.length <= MAX_FILES, 'source file count');
  let prior = '';
  for (const row of rows) {
    keys(row, ['path', 'byteLength', 'sha256']); sourcePath(row.path);
    check(prior < row.path, 'source order/duplicate'); prior = row.path;
    check(typeof row.sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.sha256), 'source hash');
    check(typeof row.byteLength === 'string' && /^(0|[1-9][0-9]*)$/.test(row.byteLength)
      && row.byteLength.length <= 8 && Number(row.byteLength) <= MAX_FILE, 'source byte length');
  }
  check(rows.some(r => r.path === 'Move.toml') && rows.some(r => r.path === 'Move.lock')
    && rows.some(r => r.path.startsWith('sources/')), 'required source files');
}
export function assertNativeSoulSourceRevision(value) {
  keys(value, ['schema', 'snapshotSha256', 'repositories', 'packages']);
  check(value.schema === NATIVE_SOUL_SOURCE_SCHEMA, 'unsupported source schema');
  keys(value.repositories, ['animacraft', 'soulidity']);
  for (const repo of Object.values(value.repositories)) {
    keys(repo, ['baseGitCommit', 'baseGitTree']);
    for (const id of Object.values(repo)) check(typeof id === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id), 'base Git identity');
  }
  check(Array.isArray(value.packages) && value.packages.length === 8, 'exact eight source packages');
  let count = 0, bytes = 0;
  value.packages.forEach((pkg, i) => {
    keys(pkg, ['role', 'packageName', 'repository', 'originalFiles', 'files']);
    check(pkg.role === NATIVE_SOUL_SOURCE_ORDER[i] && pkg.packageName === NATIVE_SOUL_SOURCE_NAMES[pkg.role]
      && pkg.repository === repositoryFor(pkg.role), 'source package identity/order');
    records(pkg.originalFiles); records(pkg.files);
    check(pkg.originalFiles.map(r => r.path).join() === pkg.files.map(r => r.path).join(), 'transformed source inventory');
    pkg.files.forEach((row, index) => {
      if (row.path.startsWith('sources/')) check(canonical(row) === canonical(pkg.originalFiles[index]), 'Move source was transformed');
      count++; bytes += Number(row.byteLength) + Number(pkg.originalFiles[index].byteLength);
    });
  });
  check(count <= MAX_FILES && bytes <= MAX_BYTES * 2, 'snapshot bound');
  const { snapshotSha256, ...payload } = value;
  check(typeof snapshotSha256 === 'string' && /^[0-9a-f]{64}$/.test(snapshotSha256)
    && hash(canonical(payload)) === snapshotSha256, 'snapshot commitment');
  return value;
}
async function directory(filename) {
  const stat = await lstat(filename); check(stat.isDirectory() && !stat.isSymbolicLink(), 'directory symlink/non-directory');
}
async function readRegular(filename) {
  const stat = await lstat(filename);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_FILE, 'non-regular/linked/oversized source');
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat(); check(actual.ino === stat.ino && actual.dev === stat.dev && actual.size === stat.size, 'source replaced during open');
    const bytes = await handle.readFile(); check(bytes.length === stat.size, 'source changed during read'); return bytes;
  } finally { await handle.close(); }
}
async function listPackage(root) {
  await directory(root); await directory(path.join(root, 'sources'));
  const files = ['Move.lock', 'Move.toml'];
  async function walk(subdir) {
    for (const entry of await readdir(path.join(root, subdir), { withFileTypes: true })) {
      check(!entry.isSymbolicLink(), 'source symlink');
      const relative = `${subdir}/${entry.name}`;
      if (entry.isDirectory()) { sourcePath(`${relative}/placeholder.move`); await walk(relative); }
      else if (entry.name.endsWith('.move')) { sourcePath(relative); check(entry.isFile(), 'non-regular Move source'); files.push(relative); }
      check(files.length <= MAX_FILES, 'source file count');
    }
  }
  await walk('sources'); return files.sort();
}

// Only the repository's one-line TOML local source forms are accepted. Unknown
// syntax fails rather than falling back to a permissive text substitution.
// Production own addresses are never rewritten; test addresses are retained.
function remapManifest(text, role, filename, resolveLocal, metadata = {}) {
  check(!text.includes('\r') && !text.includes('\0'), 'unsupported manifest encoding');
  let section = '', own = 0, packageName = 0;
  const seen = new Set(), assignments = new Set();
  const substituted = new Set(), replaced = new Set();
  const lockSources = new Map(), lockReferences = [];
  const rootDependencies = new Map();
  let rootSource = false;
  const dependencies = new Map(); let implicitDependencies = true;
  const result = text.split('\n').map(line => {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#')) return line;
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(trimmed);
    if (header) {
      section = header[1]; check(!seen.has(section), 'duplicate TOML section'); seen.add(section);
      check(filename === 'Move.toml'
        ? ['package', 'dependencies', 'dev-dependencies', 'addresses', 'dev-addresses', 'environments'].includes(section)
          || (role === 'soulidity' && section === 'dep-replacements.mainnet')
        : section === 'move' || /^pinned\.(?:mainnet|testnet)\.[A-Za-z_][A-Za-z_0-9]*$/.test(section),
      'unsupported TOML section');
    } else {
      // Parse every non-comment statement, not merely lines containing literal
      // "local". Quoted/escaped/dotted keys and dependency sub-tables cannot
      // hide a filesystem source outside the committed closure.
      const assignment = /^([A-Za-z_][A-Za-z_0-9-]*)\s*=\s*(.+)$/.exec(trimmed);
      check(assignment && section, 'unsupported TOML assignment');
      const [, key, value] = assignment;
      check(!assignments.has(`${section}.${key}`), 'duplicate TOML key'); assignments.add(`${section}.${key}`);
      const dependency = filename === 'Move.toml' && ['dependencies', 'dev-dependencies'].includes(section);
      const lockSource = filename === 'Move.lock' && key === 'source' && section.startsWith('pinned.');
      if (dependency || lockSource) {
        const local = /^\{\s*local\s*=\s*"[^"\\]+"\s*\}$/.test(value);
        const root = lockSource && section.endsWith(`.${NATIVE_SOUL_SOURCE_NAMES[role]}`) && /^\{\s*root\s*=\s*true\s*\}$/.test(value);
        const git = /^\{\s*git\s*=\s*"(https:\/\/[^"\\]+)"\s*,\s*subdir\s*=\s*"([^"\\]+)"\s*,\s*rev\s*=\s*"([0-9a-f]{40})"(?:\s*,\s*override\s*=\s*(true|false))?(?:\s*,\s*addr_subst\s*=\s*(\{[^{}]*\}))?\s*\}$/.exec(value);
        check(local || root || git, 'unsupported dependency/source syntax');
        if (dependency) {
          check(!dependencies.has(key), 'duplicate normal/dev dependency digest');
          const source = local
            ? `Local = { local = "../${key}" }`
            : `Git = { git = ${JSON.stringify(git[1])}, rev = ${JSON.stringify(git[3])}, subdir = ${JSON.stringify(git[2])} }`;
          const originalSource = local ? `Local = { local = ${JSON.stringify(value.match(/"([^"\\]+)"/)[1])} }` : source;
          dependencies.set(key, { source, originalSource, override: git?.[4] === 'true', dev: section === 'dev-dependencies' });
        }
        if (lockSource) {
          lockSources.set(section, git);
          if (section === `pinned.mainnet.${NATIVE_SOUL_SOURCE_NAMES[role]}`) rootSource = root;
          const name = section.split('.')[2].replace(/_[1-9][0-9]*$/, '');
          if (Object.hasOwn(EXTERNAL_SUBSTITUTIONS, name)) {
            check(matchesExternalSource(name, git) && git[4] === undefined && git[5] === undefined,
              'external lock source identity mismatch');
          }
        }
        if (git) {
          let url; try { url = new URL(git[1]); } catch { fail('unsafe Git repository URL'); }
          check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
            && !/[\s%?#@]/.test(git[1]) && url.href === git[1], 'unsafe Git repository URL');
          check(/^[A-Za-z_0-9.-]+(?:\/[A-Za-z_0-9.-]+)*$/.test(git[2])
            && !git[2].split('/').some(part => part === '.' || part === '..'), 'unsafe Git subdirectory');
          const known = role === 'soulidity' && dependency && Object.hasOwn(EXTERNAL_SUBSTITUTIONS, key);
          if (known || git[5] !== undefined) {
            check(known && section === 'dependencies', 'unapproved external address substitution');
            const expected = EXTERNAL_SUBSTITUTIONS[key];
            check(git[1] === expected.git && git[2] === expected.subdir && git[3] === expected.rev
              && git[4] === expected.override && canonical(addressMap(git[5])) === canonical(expected.addresses),
            'external source/address identity mismatch');
            substituted.add(key);
          }
        }
      } else if (filename === 'Move.toml' && section === 'dep-replacements.mainnet') {
        check(role === 'soulidity' && Object.hasOwn(EXTERNAL_SUBSTITUTIONS, key), 'unapproved external replacement');
        const expected = EXTERNAL_SUBSTITUTIONS[key];
        check(canonical(addressMap(value, true)) === canonical({ 'published-at': expected.callable, 'original-id': expected.original }),
          'external replacement identity mismatch');
        replaced.add(key);
      } else if (filename === 'Move.lock' && key === 'deps' && section.startsWith('pinned.')) {
        check(/^\{\s*(?:[A-Za-z_][A-Za-z_0-9]*\s*=\s*"[A-Za-z_][A-Za-z_0-9]*"(?:\s*,\s*[A-Za-z_][A-Za-z_0-9]*\s*=\s*"[A-Za-z_][A-Za-z_0-9]*")*)?\s*\}$/.test(value), 'unsupported lock dependency map');
        const depKeys = new Set();
        for (const pair of value.matchAll(/([A-Za-z_][A-Za-z_0-9]*)\s*=\s*"([A-Za-z_][A-Za-z_0-9]*)"/g)) {
          check(!depKeys.has(pair[1]), 'duplicate lock dependency key'); depKeys.add(pair[1]);
          if (section === `pinned.mainnet.${NATIVE_SOUL_SOURCE_NAMES[role]}`) {
            rootDependencies.set(pair[1], `pinned.mainnet.${pair[2]}`);
          }
          if (Object.hasOwn(EXTERNAL_SUBSTITUTIONS, pair[1])) {
            lockReferences.push({ name: pair[1], target: `pinned.${section.split('.')[1]}.${pair[2]}` });
          }
        }
      } else {
        check(/^(?:"[^"\\]*"|[0-9]+|true|false)$/.test(value), 'unsupported TOML value');
        check(key !== 'local' && key !== 'source', 'source outside dependency section');
        if (filename === 'Move.toml' && section === 'package' && key === 'implicit-dependencies') implicitDependencies = value !== 'false';
      }
    }
    check(!/(?:^|[,{\s])["']?animacraft(?:_physical_v7)?["']?\s*=/.test(trimmed)
      && !/(?:^|\.)animacraft(?:_physical_v7)?$/.test(section), 'retired Animacraft dependency is not approved');
    if (filename === 'Move.toml' && section === 'package' && /^name\s*=/.test(trimmed)) {
      check(trimmed === `name = "${NATIVE_SOUL_SOURCE_NAMES[role]}"`, 'exact package name'); packageName++;
    }
    if (filename === 'Move.toml' && section === 'addresses' && !header) {
      check(new RegExp(`^${NATIVE_SOUL_SOURCE_NAMES[role]}\\s*=\\s*"0x0"$`).test(trimmed), 'production own address must remain zero'); own++;
    }
    if (!/\blocal\b/.test(trimmed)) return line;
    let name, prefix, local;
    if (filename === 'Move.toml') {
      const match = /^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*\{\s*local\s*=\s*"([^"\\]+)"\s*\}\s*$/.exec(trimmed);
      check(match && ['dependencies', 'dev-dependencies'].includes(section), 'unsupported local manifest edge');
      name = match[1]; local = match[2]; prefix = `${name} = `;
      const dependency = NATIVE_SOUL_SOURCE_ORDER.find(r => NATIVE_SOUL_SOURCE_NAMES[r] === name);
      check(dependency && EDGES[role].includes(dependency), 'unapproved local dependency');
      check((section === 'dev-dependencies') === (role === 'market' && dependency === 'release'), 'local dependency mode');
    } else {
      const match = /^source\s*=\s*\{\s*local\s*=\s*"([^"\\]+)"\s*\}\s*$/.exec(trimmed);
      const pinned = /^pinned\.(?:mainnet|testnet)\.([A-Za-z_][A-Za-z_0-9]*)$/.exec(section);
      check(match && pinned, 'unsupported local lock edge'); name = pinned[1]; local = match[1]; prefix = 'source = ';
      check([...closure(role)].some(dependency => NATIVE_SOUL_SOURCE_NAMES[dependency] === name)
        && name !== NATIVE_SOUL_SOURCE_NAMES[role], 'unapproved local lock package');
    }
    resolveLocal?.(name, local);
    return `${prefix}{ local = "../${name}" }`;
  }).join('\n');
  if (filename === 'Move.toml') check(own === 1 && packageName === 1, 'own address/package declaration');
  check(canonical([...substituted].sort()) === canonical([...replaced].sort()), 'external substitutions/replacements must match');
  for (const ref of lockReferences) check(matchesExternalSource(ref.name, lockSources.get(ref.target)),
    'external lock dependency target mismatch');
  if (filename === 'Move.toml') Object.assign(metadata, { externalDependencies: [...substituted], dependencies, implicitDependencies });
  else Object.assign(metadata, { rootSource, rootDependencies, lockSources });
  return result;
}

export async function inspectNativeSoulSourceRepositories({ animacraftRoot, soulidityRoot }) {
  check(typeof animacraftRoot === 'string' && typeof soulidityRoot === 'string', 'both source repositories are required');
  const roots = {}, repositories = {};
  for (const [name, value] of Object.entries({ animacraft: animacraftRoot, soulidity: soulidityRoot })) {
    const root = path.resolve(value); await directory(root); roots[name] = await realpath(root);
    const git = async arg => (await exec('git', ['rev-parse', arg], { cwd: root, timeout: 10000, maxBuffer: 1024 * 1024 })).stdout.trim();
    check(await realpath(await git('--show-toplevel')) === roots[name], 'source root is not repository root');
    repositories[name] = { baseGitCommit: await git('HEAD'), baseGitTree: await git('HEAD^{tree}') };
    await directory(path.join(roots[name], 'move'));
  }
  check(roots.animacraft !== roots.soulidity, 'repository aliases');
  return { roots, repositories };
}

export async function captureNativeSoulSource({ animacraftRoot, soulidityRoot, storePath }) {
  const { roots, repositories } = await inspectNativeSoulSourceRepositories({ animacraftRoot, soulidityRoot });
  const packageRoots = Object.fromEntries(NATIVE_SOUL_SOURCE_ORDER.map(role =>
    [NATIVE_SOUL_SOURCE_NAMES[role], path.join(roots[repositoryFor(role)], 'move', NATIVE_SOUL_SOURCE_NAMES[role])]));
  const requestedRoots = { animacraft: path.resolve(animacraftRoot), soulidity: path.resolve(soulidityRoot) };
  const requestedPackages = Object.fromEntries(NATIVE_SOUL_SOURCE_ORDER.map(role =>
    [NATIVE_SOUL_SOURCE_NAMES[role], path.join(requestedRoots[repositoryFor(role)], 'move', NATIVE_SOUL_SOURCE_NAMES[role])]));
  const packages = [], blobs = new Map(), observed = [];
  let total = 0;
  for (const role of NATIVE_SOUL_SOURCE_ORDER) {
    const packageName = NATIVE_SOUL_SOURCE_NAMES[role], root = packageRoots[packageName];
    const paths = await listPackage(root), originalFiles = [];
    for (const relative of paths) {
      const original = await readRegular(path.join(root, relative)); total += original.length;
      check(total <= MAX_BYTES, 'snapshot byte bound');
      originalFiles.push(record(relative, original));
      blobs.set(hash(original), original);
    }
    packages.push({ role, packageName, repository: repositoryFor(role), originalFiles, files: [] });
    observed.push({ root, paths, records: originalFiles });
  }
  const derived = deriveNativeManifestFiles(packages, blobs, (pkg, name, local) => {
    const root = packageRoots[pkg.packageName];
    check(path.normalize(local) === local && packageRoots[name]
      && [packageRoots[name], requestedPackages[name]].includes(path.resolve(root, local)), 'local edge escaped exact package');
  });
  for (const pkg of packages) pkg.files = pkg.originalFiles.map(row => {
    if (row.path.startsWith('sources/')) return row;
    const bytes = Buffer.from(derived.get(pkg.packageName).get(row.path));
    blobs.set(hash(bytes), bytes); return record(row.path, bytes);
  });
  // Re-enumerate and reread all selected bytes after capture; neither dirty nor
  // untracked files are omitted. Concurrent edits invalidate this preparation.
  for (const row of observed) {
    check(canonical(await listPackage(row.root)) === canonical(row.paths), 'source inventory drift');
    for (const file of row.records) check(hash(await readRegular(path.join(row.root, file.path))) === file.sha256, 'source bytes drift');
  }
  const after = await inspectNativeSoulSourceRepositories({ animacraftRoot, soulidityRoot });
  check(canonical(after.repositories) === canonical(repositories), 'base Git metadata drift');
  const payload = { schema: NATIVE_SOUL_SOURCE_SCHEMA, repositories, packages };
  const sourceRevision = { ...payload, snapshotSha256: hash(canonical(payload)) };
  assertNativeSoulSourceRevision(sourceRevision);
  check(typeof storePath === 'string' && path.isAbsolute(storePath), 'absolute CAS path required');
  for (const root of Object.values(packageRoots)) check(!path.resolve(storePath).startsWith(`${root}${path.sep}`) && path.resolve(storePath) !== root, 'CAS inside source package');
  await directory(path.dirname(storePath)); await mkdir(storePath, { mode: 0o700 });
  for (const [name, bytes] of blobs) {
    const file = await open(path.join(storePath, name), 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  }
  const manifest = await open(path.join(storePath, 'snapshot.json'), 'wx', 0o600);
  try { await manifest.writeFile(canonical(sourceRevision)); await manifest.sync(); } finally { await manifest.close(); }
  const dir = await open(storePath, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  return freeze(sourceRevision);
}

export async function restoreNativeSoulSource({ sourceRevision, storePath, checkoutRoot }) {
  assertNativeSoulSourceRevision(sourceRevision); await directory(storePath);
  const stored = JSON.parse((await readRegular(path.join(storePath, 'snapshot.json'))).toString('utf8'));
  check(canonical(stored) === canonical(sourceRevision), 'CAS manifest differs from plan');
  const expected = new Set(['snapshot.json', ...sourceRevision.packages.flatMap(pkg => [...pkg.files, ...pkg.originalFiles].map(row => row.sha256))]);
  check(canonical((await readdir(storePath)).sort()) === canonical([...expected].sort()), 'CAS inventory');
  const blobs = new Map();
  for (const pkg of sourceRevision.packages) for (const row of [...pkg.originalFiles, ...pkg.files]) {
    if (!blobs.has(row.sha256)) blobs.set(row.sha256, await readRegular(path.join(storePath, row.sha256)));
    const bytes = blobs.get(row.sha256);
    check(bytes.length === Number(row.byteLength) && hash(bytes) === row.sha256, 'CAS bytes mismatch');
  }
  // Re-derive paths AND all local dependency digests from the original closure.
  // Never accept a compiler-rewritten lock by ignoring the changed hash.
  const derived = deriveNativeManifestFiles(sourceRevision.packages, blobs);
  for (const pkg of sourceRevision.packages) {
    for (const filename of ['Move.toml', 'Move.lock']) {
      check(hash(Buffer.from(derived.get(pkg.packageName).get(filename))) === pkg.files.find(row => row.path === filename).sha256,
        'manifest transformation drift');
    }
  }
  await directory(path.dirname(checkoutRoot)); await mkdir(checkoutRoot, { mode: 0o700 });
  await mkdir(path.join(checkoutRoot, 'move'), { mode: 0o700 });
  for (const pkg of sourceRevision.packages) {
    const root = path.join(checkoutRoot, 'move', pkg.packageName); await mkdir(root, { mode: 0o700 });
    for (const row of pkg.files) {
      await mkdir(path.dirname(path.join(root, row.path)), { recursive: true, mode: 0o700 });
      const file = await open(path.join(root, row.path), 'wx', 0o600);
      try { await file.writeFile(blobs.get(row.sha256)); } finally { await file.close(); }
    }
  }
  return freeze({ sourceRevision, checkoutRoot });
}

export async function verifyNativeSoulSourceCheckout({ sourceRevision, checkoutRoot }) {
  assertNativeSoulSourceRevision(sourceRevision); await directory(checkoutRoot); await directory(path.join(checkoutRoot, 'move'));
  for (const pkg of sourceRevision.packages) {
    const root = path.join(checkoutRoot, 'move', pkg.packageName);
    check(canonical(await listPackage(root)) === canonical(pkg.files.map(row => row.path)), 'cold source inventory drift');
    for (const row of pkg.files) {
      const bytes = await readRegular(path.join(root, row.path));
      check(hash(bytes) === row.sha256 && bytes.length === Number(row.byteLength), 'cold source bytes drift');
    }
  }
}
