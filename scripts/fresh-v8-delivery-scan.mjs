import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBrowserBackendRetirementSource, assertBrowserBackendRetirementDist } from './browser-backend-retirement-guard.mjs';
import { hasForbiddenSuiTransportSource } from './sui-transport-source-guard.mjs';

const allowedDependencies = new Map([
  ['@mysten/dapp-kit-core', '1.6.4'],
  ['@mysten/seal', '1.4.4'],
  ['@mysten/slush-wallet', '1.1.4'],
  ['@mysten/sui', '2.26.2'],
  ['@mysten/wallet-standard', '0.21.4'],
  ['@mysten/walrus', '1.2.19'],
  ['@mysten/walrus-wasm', '0.3.1'],
  ['@noble/hashes', '2.2.0'],
  ['@protobuf-ts/runtime-rpc', '2.11.1'],
  ['@protobuf-ts/grpcweb-transport', '2.11.1'],
]);
const allowedDevDependencies = new Map([
  ['fake-indexeddb', '6.2.5'],
  ['vite', '8.1.4'],
]);

const mode = process.argv[2] ?? '--all';
if (!['--all', '--source', '--dist'].includes(mode)) {
  throw new Error('Usage: fresh-v8-delivery-scan.mjs [--all|--source|--dist]');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const deliveryFiles = execFileSync(
  'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8' },
)
  .trim().split('\n').filter(Boolean);
const moveRoots = new Set([
  'animacraft_v8_core', 'animacraft_v8_seal', 'animacraft_v8_runtime',
  'animacraft_v8_output', 'animacraft_v8_physical', 'animacraft_v8_market',
  'animacraft_v8_release',
]);

const retiredProductionPath = /^(?:chain-runtime|chain-commerce-v5|chain-publication-recovery|runtime-config|maker-v4|maker-publication-v4|maker-commerce-v5|maker-commerce-chain-v5|maker-commerce-publication-v5|maker-seal-v5|maker-composable|maker-physical-v7|expansion-pack-publication|expansion-pack-lifecycle|expansion-pack-player|oc-handoff|completion-receipt-v5|walrus-certification)\.js$/;
const rejectedRedrawPath = /^(?:product-shell\.js|creator-workspace\.css|fresh-v8-bindings\.css|test\/product-shell\.test\.js)$/;

const productionPaths = deliveryFiles.filter((path) => (
  /^(?:[^/]+\.(?:js|css)|index\.html|config\.example\.js|package\.json|vite\.config\.js)$/.test(path)
  || /^api\/.*\.js$/.test(path)
  || /^public-v8\/.*\.js$/.test(path)
  || /^scripts\/.*\.mjs$/.test(path)
)).filter((path) => existsSync(join(root, path)));
const productSurfacePaths = productionPaths.filter((path) => !path.startsWith('scripts/'));
const productionText = productSurfacePaths
  .map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
const productionTransportPaths = [
  ...productionPaths.filter((path) => /\.(?:js|mjs)$/.test(path)),
// The scanner and its pure classifier necessarily contain the forbidden names.
].filter((path) => !['scripts/fresh-v8-delivery-scan.mjs', 'scripts/sui-transport-source-guard.mjs'].includes(path));
// The official GraphQL SDK bundles a query operation named getTransactionBlock.
// In built JavaScript, reject only executable legacy member calls, not that
// unrelated GraphQL operation name.
const forbiddenBundledSuiTransport = /@mysten\/sui\/(?:jsonrpc|client)|SuiJsonRpcClient|getJsonRpcFullnodeUrl|JsonRpcProvider|\.(?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)\s*\(|\[\s*["'](?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)["']\s*\]\s*\(/i;
const handwrittenJsonRpcEnvelope = /["']jsonrpc["']\s*:\s*["']2\.0["']|\bjsonRpcClient\b/i;

if (mode !== '--dist') {
  assertBrowserBackendRetirementSource(root);
  const rejected = [];
  for (const path of deliveryFiles) {
    const [top, second] = path.split('/');
    if (existsSync(join(root, path)) && rejectedRedrawPath.test(path)) rejected.push(path);
    if (!second && retiredProductionPath.test(path)) rejected.push(path);
    if (top === 'move' && !moveRoots.has(second)) rejected.push(path);
    if (top === 'public' || /^public-v8\/(?:config-old|legacy)/i.test(path)) rejected.push(path);
  }
  if (rejected.length) {
    throw new Error(`Retired production paths remain in the delivery surface:\n${rejected.join('\n')}`);
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

  // The approved original DOM, i18n and Docs copy intentionally retain some
  // historical labels. Authority retirement is therefore enforced through
  // exact production paths/imports and executable transport calls below, not
  // an unsafe whole-bundle substring ban that would reject the approved UI.
  const importLines = productionText.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
  if (/from\s+["']\.\/(?:chain-runtime|chain-commerce-v5|chain-publication-recovery|runtime-config|maker-v4|maker-publication-v4|maker-commerce-v5|maker-commerce-chain-v5|maker-commerce-publication-v5|maker-seal-v5|maker-composable(?:-v6|-v6-bridge|-v6-workspace)?|maker-physical-v7(?:-workspace|-i18n)?|expansion-pack-publication(?:-controller|-store|-v8-app)?|expansion-pack-lifecycle(?:-controller|-inventory|-recovery-store|-v8)?|expansion-pack-player(?:-v8|-acquisition-recovery-store)?|oc-handoff|completion-receipt-v5|walrus-certification)\.js["']/i.test(importLines)) {
    throw new Error('A retired product module remains imported by the production surface.');
  }
  const forbiddenTransportSources = productionTransportPaths.filter((path) => {
    const contents = readFileSync(join(root, path), 'utf8');
    return hasForbiddenSuiTransportSource(contents) || handwrittenJsonRpcEnvelope.test(contents);
  });
  if (forbiddenTransportSources.length > 0) {
    throw new Error(`Production source contains a forbidden Sui JSON-RPC dependency, legacy call, or fallback:\n${forbiddenTransportSources.join('\n')}`);
  }
  if (/\b(?:signAndExecuteTransaction|signTransaction|broadcastTransaction)\b/.test(
    readFileSync(join(root, 'maker-v8-sui-grpc.js'), 'utf8'),
  )) {
    throw new Error('Maker v8 Sui gRPC transport contains a signing path; execution accepts only external exact signatures.');
  }
  console.log(`Fresh-v8 product source scan passed: ${deliveryFiles.length} delivery files.`);
}

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
if (mode !== '--source') {
  const dist = join(root, 'dist');
  assertBrowserBackendRetirementDist(dist);
  if (!statSync(dist).isDirectory()) {
    throw new Error('dist is required; run the production build before the dist scan.');
  }
  const distPaths = walk(dist);
  let distText = '';
  for (const path of distPaths) {
    const name = relative(dist, path);
    if (/makers|legacy|commerce-v5|physical-v7|composition-v6/i.test(name)) {
      throw new Error(`Retired artifact was emitted: ${name}`);
    }
    if (/\.(?:js|css|html|json|txt|md)$/.test(path)) {
      const contents = readFileSync(path, 'utf8');
      distText += `\n${contents}`;
    }
  }
  if (forbiddenBundledSuiTransport.test(distText) || handwrittenJsonRpcEnvelope.test(distText)) {
    throw new Error('Production dist contains a forbidden Sui JSON-RPC dependency, legacy call, or fallback.');
  }
  console.log(`Fresh-v8 dist scan passed: ${distPaths.length} production artifacts.`);
}
