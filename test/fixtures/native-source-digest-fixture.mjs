import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Test-input builder only: does not import the normalizer under test. Mirrors
// the bounded fixtures' legacy TOML dependencies into the Rust serde layout.
// Independent hardcoded Rust vectors are asserted in source-digests.test.mjs.
export function fixtureDependencySerialization(manifest) {
  let section = ''; const rows = new Map();
  for (const line of manifest.split('\n')) {
    const header = /^\[([^\]]+)\]$/.exec(line.trim());
    if (header) { section = header[1]; continue; }
    if (!['dependencies', 'dev-dependencies'].includes(section)) continue;
    const entry = /^(\w+)\s*=\s*\{(.+)\}\s*$/.exec(line.trim());
    if (!entry) continue;
    const [, name, body] = entry;
    const local = /\blocal\s*=\s*"([^"]+)"/.exec(body);
    const field = key => new RegExp(`\\b${key}\\s*=\\s*"([^"]+)"`).exec(body)?.[1];
    const source = local ? `Local = { local = ${JSON.stringify(local[1])} }`
      : `Git = { git = ${JSON.stringify(field('git'))}, rev = ${JSON.stringify(field('rev'))}, subdir = ${JSON.stringify(field('subdir'))} }`;
    rows.set(name, `${source}, override = ${/\boverride\s*=\s*true/.test(body)}${section === 'dev-dependencies' ? ', modes = ["test"]' : ''}, use-environment = "mainnet"`);
  }
  if (!/implicit-dependencies\s*=\s*false/.test(manifest) && !rows.has('Sui') && !rows.has('MoveStdlib')) {
    for (const name of ['std', 'sui']) rows.set(name, `System = { system = "${name}" }, override = true, use-environment = "mainnet"`);
  }
  if (!rows.size) return 'deps = {}\n';
  return `deps = { ${[...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, fields]) => `${name} = { ${fields} }`).join(', ')} }\n`;
}
export const fixtureManifestDigest = manifest => createHash('sha256').update(fixtureDependencySerialization(manifest)).digest('hex').toUpperCase();

export async function populateFixtureLockDigests(pkg, roles, names) {
  const manifests = new Map(await Promise.all(roles.map(async role => [names[role], await readFile(join(pkg(role), 'Move.toml'), 'utf8')])));
  const digests = new Map([...manifests].map(([name, text]) => [name, fixtureManifestDigest(text)]));
  const localGraph = new Map([...manifests].map(([name, text]) => [name,
    [...text.matchAll(/^(\w+)\s*=\s*\{\s*local\s*=/gm)].map(match => match[1])]));
  const byName = Object.fromEntries(roles.map(role => [names[role], role]));
  for (const role of roles) {
    const filename = join(pkg(role), 'Move.lock'); let text = await readFile(filename, 'utf8');
    const closure = new Set();
    function visit(name) { if (closure.has(name)) return; closure.add(name); for (const dep of localGraph.get(name)) visit(dep); }
    visit(names[role]);
    for (const name of closure) if (!text.includes(`[pinned.mainnet.${name}]`)) {
      text += `\n[pinned.mainnet.${name}]\nsource = ${name === names[role] ? '{ root = true }' : `{ local = "${pkg(byName[name])}" }`}\n`;
    }
    text = text.replace(/(\[pinned\.mainnet\.(\w+)\]\n)([^\[]*)/g, (all, header, name, body) => {
      if (!digests.has(name)) return all;
      const dependencyMap = /^(deps\s*=\s*\{)([^}]*)(\}\s*)$/m.exec(body);
      const oldDeps = dependencyMap?.[2].trim() || '';
      const required = localGraph.get(name).filter(dep => !new RegExp(`\\b${dep}\\s*=`).test(oldDeps));
      const deps = [oldDeps, ...required.map(dep => `${dep} = "${dep}"`)].filter(Boolean).join(', ');
      body = body.replace(/^deps\s*=.*\n/gm, '');
      return header + body.replace(/^use_environment\s*=.*\n|^manifest_digest\s*=.*\n/gm, '')
        + `deps = { ${deps} }\nuse_environment = "mainnet"\nmanifest_digest = "${digests.get(name)}"\n`;
    });
    await writeFile(filename, text);
  }
}
