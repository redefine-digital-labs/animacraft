import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedDependencies = new Map([
  ['@mysten/sui', '2.20.2'],
  ['@mysten/wallet-standard', '0.21.4'],
  ['@noble/hashes', '2.2.0'],
  ['@protobuf-ts/runtime-rpc', '2.11.1'],
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
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const allowedTopFiles = new Set([
  '.gitignore', '.nvmrc', '.vercelignore', 'CONTRIBUTING.md', 'GOVERNANCE.md',
  'README.md', 'SECURITY.md', 'UNIFIED_MAKER_V8.md', 'app.js', 'chain-error-ui.js',
  'config.example.js', 'index.html', 'maker-commerce-v8.js', 'maker-v8-actions.js',
  'maker-v8-browser.js', 'maker-v8-chain.js', 'maker-v8-compiler.js',
  'maker-v8-document.js', 'maker-v8-finalized.js', 'maker-v8-market.js',
  'maker-v8-publication-store.js', 'maker-v8-recovery.js', 'maker-v8-runtime.js',
  'maker-v8-sui-grpc.js',
  'package-lock.json', 'package.json', 'styles.css', 'vercel.json', 'vite.config.js',
]);
const allowedTopDirectories = new Set(['.github', 'docs', 'move', 'public-v8', 'scripts', 'test']);
const allowedTests = new Set([
  'test/chain-error-ui.test.js', 'test/maker-commerce-v8.test.js',
  'test/maker-v8-browser.test.js', 'test/maker-v8-chain.test.js',
  'test/maker-v8-core-publish-limits.test.js',
  'test/maker-v8-compiler.test.js', 'test/maker-v8-document.test.js',
  'test/maker-v8-market.test.js', 'test/maker-v8-recovery.test.js',
  'test/maker-v8-publication-store.test.js', 'test/maker-v8-runtime.test.js',
  'test/maker-v8-sui-grpc.test.js',
  'test/mainnet-v8-release-lib.test.js', 'test/mainnet-v8-release.test.js',
  'test/web-v8-controller-real.test.js',
  'test/web-v8-production-factory.test.js', 'test/web-v8-real-market.test.js',
  'test/web-v8-shell.test.js',
  'test/fixtures/maker-v8-compiler-v1.json',
  'test/fixtures/maker-v8-runtime-attestation.js',
  'test/fixtures/market-v8-abi.json', 'test/fixtures/web-v8-chain.json',
  'test/harness/animacraft_v8_field_limit_32/Move.lock',
  'test/harness/animacraft_v8_field_limit_32/Move.toml',
  'test/harness/animacraft_v8_field_limit_32/sources/field_limit.move',
  'test/harness/animacraft_v8_field_limit_33/Move.lock',
  'test/harness/animacraft_v8_field_limit_33/Move.toml',
  'test/harness/animacraft_v8_field_limit_33/sources/field_limit.move',
  'test/harness/animacraft_v8_field_limit_protocol133.json',
  'test/harness/animacraft_v8_seal_cap_harness/Move.lock',
  'test/harness/animacraft_v8_seal_cap_harness/Move.toml',
  'test/harness/animacraft_v8_seal_cap_harness/README.md',
  'test/harness/animacraft_v8_seal_cap_harness/evidence/approved-protocol-profile.json',
  'test/harness/animacraft_v8_seal_cap_harness/evidence/manifest.json',
  'test/harness/animacraft_v8_seal_cap_harness/evidence/protocol-config-v133.rpc.json',
  'test/harness/animacraft_v8_seal_cap_harness/evidence/seal-333-colored.rpc.json',
  'test/harness/animacraft_v8_seal_cap_harness/evidence/seal-334-colored.rpc.json',
  'test/harness/animacraft_v8_seal_cap_harness/evidence/seal-500-colorless.rpc.json',
  'test/harness/animacraft_v8_seal_cap_harness/evidence/seal-501-colorless.rpc.json',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/Move.lock',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/Move.toml',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/sources/activation_v8.move',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/sources/base_registry_v8.move',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/sources/core_v8.move',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/sources/maker_v8.move',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/sources/package_binding_v8.move',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/sources/protocol_config_v8.move',
  'test/harness/animacraft_v8_seal_cap_harness/fixture/slim-core/sources/treasury_v8.move',
  'test/harness/animacraft_v8_seal_cap_harness/scripts/evidence.mjs',
  'test/harness/animacraft_v8_seal_cap_harness/scripts/generate_commitments.mjs',
  'test/harness/animacraft_v8_seal_cap_harness/scripts/run_localnet_replay.mjs',
  'test/harness/animacraft_v8_seal_cap_harness/scripts/verify_reproducibility.mjs',
  'test/harness/animacraft_v8_seal_cap_harness/sources/seal_style_cap_harness.move',
]);
const allowedDocs = new Set([
  'docs/codex/CLIENT_V8_CUTOVER_SPEC.md',
  'docs/codex/CURRENT.md',
  'docs/codex/MAINNET_V8_RELEASE_SPEC.md',
  'docs/codex/PROJECT_MEMORY.md',
]);
const allowedGithub = new Set([
  '.github/CODEOWNERS', '.github/pull_request_template.md',
  '.github/workflows/repository-hygiene.yml',
]);
const allowedScripts = new Set([
  'scripts/fresh-v8-delivery-scan.mjs',
  'scripts/mainnet-v8-release-lib.mjs',
  'scripts/mainnet-v8-release.mjs',
  'scripts/maker-v8-sui-grpc-mainnet-smoke.mjs',
  'scripts/verify-move-struct-field-limits.mjs',
]);
const moveRoots = new Set([
  'animacraft_v8_core', 'animacraft_v8_seal', 'animacraft_v8_runtime',
  'animacraft_v8_output', 'animacraft_v8_physical', 'animacraft_v8_market',
  'animacraft_v8_release',
]);

const retired = /makerV8ReleaseEnabled|OCMaker|MakerRootV5|CommerceV5|commerce_v5|composition_v6|physical_v7|publication_v[4-7]|SALE_PENDING|LegacyMakerMigrated|CreatorProfile/;
const productionPaths = [
  'README.md', 'SECURITY.md', 'GOVERNANCE.md', 'CONTRIBUTING.md',
  'UNIFIED_MAKER_V8.md', 'docs/codex/CLIENT_V8_CUTOVER_SPEC.md',
  'app.js', 'index.html', 'styles.css', 'chain-error-ui.js', 'config.example.js',
  'public-v8/config.js', 'package.json', 'vite.config.js',
  'maker-commerce-v8.js', 'maker-v8-actions.js', 'maker-v8-browser.js',
  'maker-v8-chain.js', 'maker-v8-compiler.js', 'maker-v8-document.js',
  'maker-v8-finalized.js', 'maker-v8-market.js', 'maker-v8-recovery.js',
  'maker-v8-publication-store.js', 'maker-v8-runtime.js', 'maker-v8-sui-grpc.js',
];
const productionText = productionPaths
  .map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
const productionTransportPaths = [
  ...productionPaths.filter((path) => /(?:^|\/)\w[^/]*\.js$/.test(path)),
  'scripts/mainnet-v8-release-lib.mjs',
  'scripts/mainnet-v8-release.mjs',
  'scripts/maker-v8-sui-grpc-mainnet-smoke.mjs',
];
const forbiddenSuiTransport = /@mysten\/sui\/(?:jsonrpc|client)|SuiJsonRpcClient|getJsonRpcFullnodeUrl|JsonRpcProvider|\b(?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)\s*\(|\[\s*["'](?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)["']\s*\]\s*\(/i;
// The official GraphQL SDK bundles a query operation named getTransactionBlock.
// In built JavaScript, reject only executable legacy member calls, not that
// unrelated GraphQL operation name.
const forbiddenBundledSuiTransport = /@mysten\/sui\/(?:jsonrpc|client)|SuiJsonRpcClient|getJsonRpcFullnodeUrl|JsonRpcProvider|\.(?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)\s*\(|\[\s*["'](?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock|tryGetPastObject|getPastObject)["']\s*\]\s*\(/i;
const handwrittenJsonRpcEnvelope = /["']jsonrpc["']\s*:\s*["']2\.0["']|\bjsonRpcClient\b/i;

if (mode !== '--dist') {
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
    else if (top === 'scripts' && !allowedScripts.has(path)) rejected.push(path);
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

  if (retired.test(productionText)) {
    throw new Error('Retired product identifiers remain in production source or docs.');
  }
  const importLines = productionText.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
  if (/legacy|expansion-pack|maker-(?:commerce-v5|composable|physical-v7|publication-v4)/i.test(importLines)) {
    throw new Error('A retired product module remains imported by the production surface.');
  }
  const forbiddenTransportSources = productionTransportPaths.filter((path) => {
    const contents = readFileSync(join(root, path), 'utf8');
    return forbiddenSuiTransport.test(contents) || handwrittenJsonRpcEnvelope.test(contents);
  });
  if (forbiddenTransportSources.length > 0) {
    throw new Error(`Production source contains a forbidden Sui JSON-RPC dependency, legacy call, or fallback:\n${forbiddenTransportSources.join('\n')}`);
  }
  if (/\b(?:signAndExecuteTransaction|signTransaction|broadcastTransaction)\b/.test(
    readFileSync(join(root, 'maker-v8-sui-grpc.js'), 'utf8'),
  )) {
    throw new Error('Maker v8 Sui gRPC transport contains a signing path; execution accepts only external exact signatures.');
  }
  console.log(`Fresh-v8 source scan passed: ${tracked.length} tracked files.`);
}

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
if (mode !== '--source') {
  const dist = join(root, 'dist');
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
      if (retired.test(contents)) {
        throw new Error(`Retired product identifier was emitted: ${name}`);
      }
    }
  }
  if (forbiddenBundledSuiTransport.test(distText) || handwrittenJsonRpcEnvelope.test(distText)) {
    throw new Error('Production dist contains a forbidden Sui JSON-RPC dependency, legacy call, or fallback.');
  }
  console.log(`Fresh-v8 dist scan passed: ${distPaths.length} production artifacts.`);
}
