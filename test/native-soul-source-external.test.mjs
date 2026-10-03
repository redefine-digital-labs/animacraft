import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { populateFixtureLockDigests } from './fixtures/native-source-digest-fixture.mjs';
import { captureNativeSoulSource, restoreNativeSoulSource, verifyNativeSoulSourceCheckout,
  assertNativeSoulSourceRevision, NATIVE_SOUL_SOURCE_ORDER as ORDER, NATIVE_SOUL_SOURCE_NAMES as NAMES } from '../scripts/native-soul-source-cas.mjs';

// Independent literal pins copied from the current Soulidity manifest. These
// are existing external packages, never replacement IDs for fresh product roles.
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7';
const STABLE = '0xecf47609d7da919ea98e7fd04f6e0648a0a79b337aaad373fa37aac8febf19c8';
const EXT = '0xe0917b74a5912e4ad186ac634e29c922ab83903f71af7500969f9411706f9b9a';
const KIOSK_ORIGINAL = '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879';
const KIOSK_CALLABLE = '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3';
const CIRCLE = 'https://github.com/circlefin/stablecoin-sui.git';
const CIRCLE_REV = 'd0904aec1bbe46b38f811654070032363a5a2966';
const KIOSK_REV = '7a07937149c0af057be8f6747e60d0f1acd88fde';
const framework = 'Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "722ac4fcf4841346c91775f596c4ce23fb7fbd0f" }';
const external = [
  `usdc = { git = "${CIRCLE}", subdir = "packages/usdc", rev = "${CIRCLE_REV}", addr_subst = { "usdc" = "${USDC}", "stablecoin" = "${STABLE}", "sui_extensions" = "${EXT}" } }`,
  `stablecoin = { git = "${CIRCLE}", subdir = "packages/stablecoin", rev = "${CIRCLE_REV}", override = true, addr_subst = { "stablecoin" = "${STABLE}", "sui_extensions" = "${EXT}" } }`,
  `sui_extensions = { git = "${CIRCLE}", subdir = "packages/sui_extensions", rev = "${CIRCLE_REV}", override = true, addr_subst = { "sui_extensions" = "${EXT}" } }`,
  'Walrus = { git = "https://github.com/MystenLabs/walrus.git", subdir = "mainnet-contracts/walrus", rev = "a19764ff77f501a79db88dc6d922a2c73848e989" }',
  `Kiosk = { git = "https://github.com/MystenLabs/apps.git", subdir = "kiosk", rev = "${KIOSK_REV}", override = true, addr_subst = { "kiosk" = "${KIOSK_ORIGINAL}" } }`,
].join('\n');
const replacements = `[dep-replacements.mainnet]\nusdc = { published-at = "${USDC}", original-id = "${USDC}" }\nstablecoin = { published-at = "${STABLE}", original-id = "${STABLE}" }\nsui_extensions = { published-at = "${EXT}", original-id = "${EXT}" }\nKiosk = { published-at = "${KIOSK_CALLABLE}", original-id = "${KIOSK_ORIGINAL}" }\n`;
const kioskLockSource = `{ git = "https://github.com/MystenLabs/apps.git", subdir = "kiosk", rev = "${KIOSK_REV}" }`;
const externalLock = ['usdc', 'stablecoin', 'sui_extensions'].map(name =>
  `\n[pinned.mainnet.${name}]\nsource = { git = "${CIRCLE}", subdir = "packages/${name}", rev = "${CIRCLE_REV}" }\n`).join('')
  + `\n[pinned.mainnet.Kiosk]\nsource = ${kioskLockSource}\n`
  + '\n[pinned.mainnet.soulidity]\nsource = { root = true }\ndeps = { usdc = "usdc", stablecoin = "stablecoin", sui_extensions = "sui_extensions", Kiosk = "Kiosk" }\n';
const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const invalid = { code: 'NATIVE_SOUL_SOURCE_INVALID' };
async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'native-external-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const roots = { animacraft: join(temp, 'ac'), soulidity: join(temp, 'so') };
  for (const root of Object.values(roots)) {
    await mkdir(join(root, 'move'), { recursive: true });
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['-c', 'user.name=Isolated Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
  }
  const pkg = role => join(roots[role === 'soulidity' ? 'soulidity' : 'animacraft'], 'move', NAMES[role]);
  for (const role of ORDER) {
    await mkdir(join(pkg(role), 'sources'), { recursive: true });
    const deps = role === 'core' ? [] : role === 'soulidity' ? ['core', 'output'] : role === 'release' ? ['core', 'soulidity'] : ['core'];
    const manifest = `[package]\nname = "${NAMES[role]}"\nedition = "2024.beta"\n\n[dependencies]\n${framework}\n`
      + deps.map(d => `${NAMES[d]} = { local = "${pkg(d)}" }`).join('\n')
      + (role === 'soulidity' ? '\n' + external : '') + `\n\n[addresses]\n${NAMES[role]} = "0x0"\n`
      + (role === 'soulidity' ? '\n' + replacements : '');
    await writeFile(join(pkg(role), 'Move.toml'), manifest);
    await writeFile(join(pkg(role), 'Move.lock'), '[move]\nversion = 4\n'
      + '\n[pinned.mainnet.Sui]\nsource = ' + framework.slice('Sui = '.length) + '\n'
      + (role === 'soulidity' ? externalLock : ''));
    await writeFile(join(pkg(role), 'sources/main.move'), `module ${NAMES[role]}::example;\npublic fun number(): u8 { 1 }\n`);
  }
  await populateFixtureLockDigests(pkg, ORDER, NAMES);
  const storePath = join(temp, 'cas'), checkoutRoot = join(temp, 'checkout');
  return { temp, roots, pkg, storePath, checkoutRoot,
    capture: () => captureNativeSoulSource({ animacraftRoot: roots.animacraft, soulidityRoot: roots.soulidity, storePath }) };
}

test('current Circle/Kiosk manifests survive capture and cold restore with exact independent original/callable identities', async t => {
  const f = await fixture(t), original = await readFile(join(f.pkg('soulidity'), 'Move.toml'), 'utf8');
  const sourceRevision = await f.capture();
  assertNativeSoulSourceRevision(sourceRevision);
  assert.deepEqual(await readFile(join(f.pkg('soulidity'), 'Move.toml'), 'utf8'), original);
  await rm(f.roots.animacraft, { recursive: true }); await rm(f.roots.soulidity, { recursive: true });
  await restoreNativeSoulSource({ sourceRevision, storePath: f.storePath, checkoutRoot: f.checkoutRoot });
  await verifyNativeSoulSourceCheckout({ sourceRevision, checkoutRoot: f.checkoutRoot });
  const cold = await readFile(join(f.checkoutRoot, 'move/soulidity/Move.toml'), 'utf8');
  assert.ok(cold.includes(external)); assert.ok(cold.includes(replacements));
  assert.ok(cold.includes('animacraft_v8_core = { local = "../animacraft_v8_core" }'));
  assert.equal(cold.includes(f.temp), false);
  assert.notEqual(KIOSK_ORIGINAL, KIOSK_CALLABLE);
  const coldLock = await readFile(join(f.checkoutRoot, 'move/soulidity/Move.lock'), 'utf8');
  for (const line of externalLock.trim().split('\n').filter(line => line && !line.startsWith('deps ='))) assert.ok(coldLock.includes(line), line);
  for (const name of ['usdc', 'stablecoin', 'sui_extensions', 'Kiosk']) assert.ok(coldLock.includes(`${name} = "${name}"`));
});

const attacks = {
  'Circle revision changed': s => s.replace(CIRCLE_REV, '1'.repeat(40)),
  'Circle repository changed': s => s.replace(CIRCLE, 'https://github.com/other/stablecoin-sui.git'),
  'Circle package subdirectory changed': s => s.replace('packages/usdc', 'packages/stablecoin'),
  'Kiosk revision changed': s => s.replace(KIOSK_REV, '1'.repeat(40)),
  'USDC substitution changed': s => s.replace(`"usdc" = "${USDC}"`, `"usdc" = "${STABLE}"`),
  'Kiosk substitution uses callable ID': s => s.replace(`"kiosk" = "${KIOSK_ORIGINAL}"`, `"kiosk" = "${KIOSK_CALLABLE}"`),
  'Kiosk original replacement uses callable ID': s => s.replace(`original-id = "${KIOSK_ORIGINAL}"`, `original-id = "${KIOSK_CALLABLE}"`),
  'Kiosk callable replacement uses original ID': s => s.replace(`published-at = "${KIOSK_CALLABLE}"`, `published-at = "${KIOSK_ORIGINAL}"`),
  'USDC replacement changed': s => s.replace(`published-at = "${USDC}"`, `published-at = "${STABLE}"`),
  'zero replacement ID': s => s.replace(`published-at = "${USDC}"`, 'published-at = "0x' + '0'.repeat(64) + '"'),
  'short replacement ID': s => s.replace(`published-at = "${USDC}"`, 'published-at = "0x2"'),
  'missing Kiosk replacement pair': s => s.replace(/^Kiosk = \{ published-at[^\n]+\n/m, ''),
  'missing Kiosk dependency pair': s => s.replace(/^Kiosk = \{ git[^\n]+\n/m, ''),
  'unknown address-substituted dependency': s => s.replace(/^Kiosk = \{ git/m, 'Unknown = { git'),
  'unknown substitution key': s => s.replace('addr_subst = { "usdc"', 'addr_subst = { "foreign"'),
  'missing substitution key': s => s.replace(`"usdc" = "${USDC}", `, ''),
  'duplicate substitution key': s => s.replace(`"usdc" = "${USDC}"`, `"usdc" = "${USDC}", "usdc" = "${USDC}"`),
  'dotted substitution key': s => s.replace('"usdc" = ', '"usdc.address" = '),
  'escaped quoted substitution key': s => s.replace('"usdc" = ', '"u\\u0073dc" = '),
  'escaped address': s => s.replace(`"usdc" = "${USDC}"`, `"usdc" = "\\u0030${USDC.slice(1)}"`),
  'noncanonical address case': s => s.replace(`"usdc" = "${USDC}"`, `"usdc" = "${USDC.toUpperCase()}"`),
  'nested local substitution': s => s.replace(`"usdc" = "${USDC}"`, '"usdc" = { local = "/tmp/outside" }'),
  'extra local git field': s => s.replace('addr_subst = { "usdc"', 'local = "/tmp/outside", addr_subst = { "usdc"'),
  'duplicate addr_subst': s => s.replace('addr_subst = { "usdc"', 'addr_subst = {}, addr_subst = { "usdc"'),
  'unexpected USDC override': s => s.replace('addr_subst = { "usdc"', 'override = true, addr_subst = { "usdc"'),
  'missing stablecoin override': s => s.replace('override = true, addr_subst = { "stablecoin"', 'addr_subst = { "stablecoin"'),
  'unknown replacement package': s => s.replace('[dep-replacements.mainnet]', '[dep-replacements.mainnet]\nunknown = { published-at = "' + USDC + '", original-id = "' + USDC + '" }'),
  'fresh package replacement': s => s.replace('[dep-replacements.mainnet]', '[dep-replacements.mainnet]\nanimacraft_v8_core = { published-at = "' + USDC + '", original-id = "' + USDC + '" }'),
  'duplicate replacement field': s => s.replace(`published-at = "${USDC}"`, `published-at = "${USDC}", published-at = "${USDC}"`),
  'testnet replacement branch': s => s.replace('[dep-replacements.mainnet]', '[dep-replacements.testnet]'),
  'escaped dependency key': s => s.replace('usdc = { git', '"u\\u0073dc" = { git'),
  'unknown local source': s => s.replace('[dependencies]', '[dependencies]\nforeign = { local = "/tmp/outside" }'),
  'absolute git subdirectory': s => s.replace('crates/sui-framework/packages/sui-framework', '/tmp/absolute'),
  'traversal git subdirectory': s => s.replace('crates/sui-framework/packages/sui-framework', 'crates/../sui-framework'),
  'git URL userinfo': s => s.replace('https://github.com/MystenLabs/sui.git', 'https://username@github.com/MystenLabs/sui.git'),
  'git URL percent path': s => s.replace('https://github.com/MystenLabs/sui.git', 'https://github.com/MystenLabs/%73ui.git'),
  'retired Animacraft dependency': s => s.replace('[dependencies]', '[dependencies]\nanimacraft = { git = "https://github.com/redefine-digital-labs/animacraft.git", subdir = "move/animacraft", rev = "fde2d617bc0dba74f27ec255fd12434f632adc23" }'),
  'retired Physical V7 dependency': s => s.replace('[dependencies]', '[dependencies]\nanimacraft_physical_v7 = { git = "https://github.com/redefine-digital-labs/animacraft.git", subdir = "move/animacraft_physical_v7", rev = "fde2d617bc0dba74f27ec255fd12434f632adc23" }'),
};
for (const [name, change] of Object.entries(attacks)) test(`capture rejects ${name}`, async t => {
  const f = await fixture(t), file = join(f.pkg('soulidity'), 'Move.toml'), original = await readFile(file, 'utf8'), tampered = change(original);
  assert.notEqual(tampered, original, 'attack must actually change bytes'); await writeFile(file, tampered);
  await assert.rejects(f.capture(), invalid); assert.equal(await readFile(file, 'utf8'), tampered);
});

test('bare ASCII substitution keys retain the same exact permitted mapping', async t => {
  const f = await fixture(t), file = join(f.pkg('soulidity'), 'Move.toml');
  const original = await readFile(file, 'utf8'), bare = original.replace(/"(usdc|stablecoin|sui_extensions|kiosk)" =/g, '$1 =');
  assert.notEqual(bare, original); await writeFile(file, bare);
  const sourceRevision = await f.capture();
  await restoreNativeSoulSource({ sourceRevision, storePath: f.storePath, checkoutRoot: f.checkoutRoot });
  assert.ok((await readFile(join(f.checkoutRoot, 'move/soulidity/Move.toml'), 'utf8')).includes(`kiosk = "${KIOSK_ORIGINAL}"`));
});
test('known address substitutions and replacements are not permitted on a fresh Animacraft role', async t => {
  const f = await fixture(t), file = join(f.pkg('core'), 'Move.toml');
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('[dependencies]', '[dependencies]\n' + external) + '\n' + replacements);
  await assert.rejects(f.capture(), invalid);
});

// Rehash BOTH original/transformed manifests, metadata and CAS inventory: these
// negatives must reach the parser again, not accidentally pass via a hash error.
async function rewriteCas(f, sourceRevision, change, filename = 'Move.toml') {
  const revision = structuredClone(sourceRevision), pkg = revision.packages.find(p => p.role === 'soulidity');
  for (const list of [pkg.originalFiles, pkg.files]) {
    const row = list.find(r => r.path === filename), bytes = Buffer.from(change(await readFile(join(f.storePath, row.sha256), 'utf8')));
    const sha256 = hash(bytes); await writeFile(join(f.storePath, sha256), bytes);
    Object.assign(row, { sha256, byteLength: String(bytes.length) });
  }
  const { snapshotSha256: _, ...payload } = revision; revision.snapshotSha256 = hash(canonical(payload));
  assertNativeSoulSourceRevision(revision);
  await writeFile(join(f.storePath, 'snapshot.json'), canonical(revision));
  const expected = new Set(['snapshot.json', ...revision.packages.flatMap(p => [...p.files, ...p.originalFiles].map(r => r.sha256))]);
  for (const file of await readdir(f.storePath)) if (!expected.has(file)) await rm(join(f.storePath, file));
  return revision;
}
for (const name of ['USDC substitution changed', 'Kiosk original replacement uses callable ID', 'unknown substitution key',
  'duplicate substitution key', 'escaped quoted substitution key', 'extra local git field', 'fresh package replacement'])
  test(`cold restore reparses fully rehashed ${name}`, async t => {
    const f = await fixture(t), first = await f.capture(), revised = await rewriteCas(f, first, attacks[name]);
    await assert.rejects(restoreNativeSoulSource({ sourceRevision: revised, storePath: f.storePath, checkoutRoot: f.checkoutRoot }),
      e => e.code === 'NATIVE_SOUL_SOURCE_INVALID' && !/hash|CAS bytes|CAS inventory|manifest differs|transformation drift/.test(e.message));
  });

const lockAttacks = {
  'known Kiosk URL': s => s.replace(kioskLockSource, kioskLockSource.replace('MystenLabs/apps.git', 'other/apps.git')),
  'known Kiosk revision': s => s.replace(kioskLockSource, kioskLockSource.replace(KIOSK_REV, '1'.repeat(40))),
  'known Kiosk subdirectory': s => s.replace(kioskLockSource, kioskLockSource.replace('"kiosk"', '"different"')),
  'known Circle revision': s => s.replace(CIRCLE_REV, '1'.repeat(40)),
  'known source replaced with root': s => s.replace(kioskLockSource, '{ root = true }'),
  'known source replaced with local': s => s.replace(kioskLockSource, '{ local = "../animacraft_v8_core" }'),
  'numbered alias wrong source': s => s.replaceAll('mainnet.Kiosk]', 'mainnet.Kiosk_2]').replace('Kiosk = "Kiosk"', 'Kiosk = "Kiosk_2"')
    .replace(kioskLockSource, kioskLockSource.replace(KIOSK_REV, '1'.repeat(40))),
  'renamed alias wrong source': s => s.replace('mainnet.Kiosk]', 'mainnet.InnocentName]').replace('Kiosk = "Kiosk"', 'Kiosk = "InnocentName"')
    .replace(kioskLockSource, kioskLockSource.replace('MystenLabs/apps.git', 'other/apps.git')),
  'known reference missing target': s => s.replace('Kiosk = "Kiosk"', 'Kiosk = "MissingTarget"'),
  'known reference wrong known target': s => s.replace('Kiosk = "Kiosk"', 'Kiosk = "usdc"'),
  'lock source substitution not allowed': s => s.replace(kioskLockSource, kioskLockSource.slice(0, -2) + `, addr_subst = { kiosk = "${KIOSK_ORIGINAL}" } }`),
  'manifest dependency missing from own root deps': s => s.replace(', Kiosk = "Kiosk"', ''),
  'manifest dependencies without own root section': s => s.replace(/\n\[pinned\.mainnet\.soulidity\]\n[^]*$/, '\n'),
  'manifest dependency absent from both source and root deps': s => s.replace(/\n\[pinned\.mainnet\.Kiosk\]\nsource = [^\n]+\n/, '\n')
    .replace(', Kiosk = "Kiosk"', ''),
  'own root source replaced by git': s => s.replace('[pinned.mainnet.soulidity]\nsource = { root = true }',
    '[pinned.mainnet.soulidity]\nsource = ' + kioskLockSource),
};
for (const [name, change] of Object.entries(lockAttacks)) {
  test(`capture rejects Move.lock ${name}`, async t => {
    const f = await fixture(t), file = join(f.pkg('soulidity'), 'Move.lock'), original = await readFile(file, 'utf8');
    const changed = change(original); assert.notEqual(changed, original); await writeFile(file, changed);
    await assert.rejects(f.capture(), invalid);
  });
  test(`cold restore rejects fully rehashed Move.lock ${name}`, async t => {
    const f = await fixture(t), first = await f.capture(), revised = await rewriteCas(f, first, change, 'Move.lock');
    await assert.rejects(restoreNativeSoulSource({ sourceRevision: revised, storePath: f.storePath, checkoutRoot: f.checkoutRoot }),
      e => e.code === 'NATIVE_SOUL_SOURCE_INVALID' && !/hash|CAS bytes|CAS inventory|manifest differs|transformation drift/.test(e.message));
  });
}
for (const alias of ['Kiosk_2', 'NamedAlias']) test(`valid known dependency alias ${alias} remains pinned to actual Kiosk Git source`, async t => {
  const f = await fixture(t), file = join(f.pkg('soulidity'), 'Move.lock');
  const lock = (await readFile(file, 'utf8')).replace('mainnet.Kiosk]', `mainnet.${alias}]`).replace('Kiosk = "Kiosk"', `Kiosk = "${alias}"`);
  await writeFile(file, lock); const sourceRevision = await f.capture();
  await restoreNativeSoulSource({ sourceRevision, storePath: f.storePath, checkoutRoot: f.checkoutRoot });
  const cold = await readFile(join(f.checkoutRoot, 'move/soulidity/Move.lock'), 'utf8');
  const aliasSection = text => text.split(`[pinned.mainnet.${alias}]\n`)[1].split('\n[')[0];
  assert.equal(aliasSection(cold), aliasSection(lock), 'external alias source bytes are not normalized');
  assert.ok(cold.includes(`Kiosk = "${alias}"`));
  assert.equal(cold.includes(f.temp), false, 'native local paths and their digests are intentionally relocated');
  await verifyNativeSoulSourceCheckout({ sourceRevision, checkoutRoot: f.checkoutRoot });
});
