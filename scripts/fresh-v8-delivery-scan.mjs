import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedDependencies = new Map([
  ['@mysten/sui', '2.20.2'],
  ['@mysten/wallet-standard', '0.21.4'],
  ['@noble/hashes', '2.2.0'],
]);
const allowedDevDependencies = new Map([
  ['vite', '8.1.4'],
]);

const root = fileURLToPath(new URL('../', import.meta.url));
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const allowedTopFiles = new Set([
  '.gitignore', '.nvmrc', '.vercelignore', 'CONTRIBUTING.md', 'GOVERNANCE.md',
  'README.md', 'SECURITY.md', 'UNIFIED_MAKER_V8.md', 'app.js', 'chain-error-ui.js',
  'config.example.js', 'index.html', 'maker-commerce-v8.js', 'maker-v8-actions.js',
  'maker-v8-browser.js', 'maker-v8-chain.js', 'maker-v8-compiler.js',
  'maker-v8-document.js', 'maker-v8-finalized.js', 'maker-v8-market.js',
  'maker-v8-recovery.js', 'maker-v8-runtime.js', 'package-lock.json', 'package.json',
  'styles.css', 'vercel.json', 'vite.config.js',
]);
const allowedTopDirectories = new Set(['.github', 'docs', 'move', 'public-v8', 'scripts', 'test']);
const allowedTests = new Set([
  'test/chain-error-ui.test.js', 'test/maker-commerce-v8.test.js',
  'test/maker-v8-browser.test.js', 'test/maker-v8-chain.test.js',
  'test/maker-v8-compiler.test.js', 'test/maker-v8-document.test.js',
  'test/maker-v8-market.test.js', 'test/maker-v8-recovery.test.js',
  'test/maker-v8-runtime.test.js', 'test/web-v8-controller-real.test.js',
  'test/web-v8-real-market.test.js', 'test/web-v8-shell.test.js',
  'test/fixtures/maker-v8-compiler-v1.json',
  'test/fixtures/maker-v8-runtime-attestation.js',
  'test/fixtures/market-v8-abi.json', 'test/fixtures/web-v8-chain.json',
]);
const allowedDocs = new Set([
  'docs/codex/CLIENT_V8_CUTOVER_SPEC.md',
]);
const allowedGithub = new Set([
  '.github/CODEOWNERS', '.github/pull_request_template.md',
  '.github/workflows/repository-hygiene.yml',
]);
const moveRoots = new Set([
  'animacraft_v8_core', 'animacraft_v8_seal', 'animacraft_v8_runtime',
  'animacraft_v8_output', 'animacraft_v8_physical', 'animacraft_v8_market',
  'animacraft_v8_release',
]);

const rejected = [];
for (const path of tracked) {
  const [top, second] = path.split('/');
  if (!second) {
    if (!allowedTopFiles.has(path)) rejected.push(path);
    continue;
  }
  if (!allowedTopDirectories.has(top)) rejected.push(path);
  else if (top === 'test' && !allowedTests.has(path)) rejected.push(path);
  else if (top === 'docs' && !allowedDocs.has(path)) rejected.push(path);
  else if (top === '.github' && !allowedGithub.has(path)) rejected.push(path);
  else if (top === 'public-v8' && path !== 'public-v8/config.js') rejected.push(path);
  else if (top === 'scripts' && path !== 'scripts/fresh-v8-delivery-scan.mjs') rejected.push(path);
  else if (top === 'move' && !moveRoots.has(second)) rejected.push(path);
}
if (rejected.length) {
  throw new Error(`Retired or unclassified paths remain in the delivery surface:\n${rejected.join('\n')}`);
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const [field, allowed] of [
  ['dependencies', allowedDependencies],
  ['devDependencies', allowedDevDependencies],
]) {
  const actual = new Map(Object.entries(packageJson[field] ?? {}));
  const drift = [
    ...[...actual].filter(([name, version]) => allowed.get(name) !== version)
      .map(([name, version]) => `${field}.${name}=${version}`),
    ...[...allowed].filter(([name]) => !actual.has(name))
      .map(([name, version]) => `${field}.${name} missing (expected ${version})`),
  ];
  if (drift.length) {
    throw new Error(`Fresh-v8 dependency allowlist drift:\n${drift.join('\n')}`);
  }
}

const retired = /OCMaker|MakerRootV5|CommerceV5|commerce_v5|composition_v6|physical_v7|publication_v[4-7]|SALE_PENDING|LegacyMakerMigrated|CreatorProfile/;
const productionText = [
  'README.md', 'app.js', 'index.html', 'chain-error-ui.js', 'config.example.js',
  'public-v8/config.js', 'package.json', 'vite.config.js',
  'maker-v8-browser.js', 'maker-v8-chain.js', 'maker-v8-runtime.js',
].map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
if (retired.test(productionText)) throw new Error('Retired product identifiers remain in production source or docs.');

const importLines = productionText.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
if (/legacy|expansion-pack|maker-(?:commerce-v5|composable|physical-v7|publication-v4)/i.test(importLines)) {
  throw new Error('A retired product module remains imported by the production surface.');
}

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const dist = join(root, 'dist');
if (!statSync(dist).isDirectory()) throw new Error('dist is required; run the production build before scan:fresh.');
const distPaths = walk(dist);
for (const path of distPaths) {
  const name = relative(dist, path);
  if (/makers|legacy|commerce-v5|physical-v7|composition-v6/i.test(name)) {
    throw new Error(`Retired artifact was emitted: ${name}`);
  }
  if (/\.(?:js|css|html|json|txt|md)$/.test(path) && retired.test(readFileSync(path, 'utf8'))) {
    throw new Error(`Retired product identifier was emitted: ${name}`);
  }
}
console.log(`Fresh-v8 delivery scan passed: ${tracked.length} tracked files, ${distPaths.length} production artifacts.`);
