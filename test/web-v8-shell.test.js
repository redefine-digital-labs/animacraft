import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  MARKET_V8_ACTIONS,
  UNSUPPORTED_PRODUCT_CODE,
  WEB_V8_CACHE_SCHEMA,
  WEB_V8_CONTEXT_SCHEMA,
  assertFreshV8ActionContext,
  assertLiveMakerV8Runtime,
  assertWebV8ExecutionConfig,
  inspectFreshV8Cache,
  marketRuntimeFromMakerRuntime,
  parseFreshV8Route,
} from '../maker-v8-market-controller.js';
import { assertMakerV8Runtime, makerV8StableType } from '../maker-v8-runtime.js';
import { runtimeAttestationRpc } from './fixtures/maker-v8-runtime-attestation.js';
import { nativeGraphReleaseChecks } from '../scripts/native-soul-test-graph.mjs';

const id = (byte) => `0x${byte.repeat(32)}`;
const digest = (byte) => byte.repeat(32);
const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const roleBytes = Object.freeze({ core: '10', seal: '11', runtime: '12', output: '13', physical: '14', market: '15', release: '16' });

function runtimeInput(enabled = true) {
  return {
    schemaVersion: 'animacraft.maker-v8-runtime.v8',
    protocolVersion: 8,
    enabled,
    catalogId: id('80'),
    protocolConfigId: id('81'),
    protocolTreasuryId: id('82'),
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    clockObjectId: `0x${'0'.repeat(63)}6`,
    roles: Object.fromEntries(roles.map((role) => [role, {
      typeOriginPackageId: id(roleBytes[role]),
      callablePackageId: id(roleBytes[role]),
    }])),
    roleConfigIds: {
      seal: id('83'), runtime: id('84'), output: id('85'), physical: id('86'), market: id('87'), release: id('88'),
    },
    makerBindings: [],
  };
}

const execution = assertWebV8ExecutionConfig({
  schemaVersion: 'animacraft.web-execution.v8',
  network: 'mainnet',
  chainIdentifier: '35834a8a',
  allowWalletSignature: false,
  allowBroadcast: false,
});
const runtime = await assertLiveMakerV8Runtime(runtimeInput(), {
  async getSuiClient() { return runtimeAttestationRpc(runtimeInput()); },
});

test('only three canonical fresh-v8 routes are accepted', () => {
  const listingId = id('20');
  const rootId = id('21');
  assert.deepEqual(parseFreshV8Route('/market'), {
    valid: true, kind: 'market', id: null, canonicalPath: '/market',
  });
  assert.equal(parseFreshV8Route(`/market/${listingId}`).kind, 'listing');
  assert.equal(parseFreshV8Route(`/maker/${rootId}`).kind, 'maker');
  for (const path of [
    '/templates',
    '/creator',
    `/market/${listingId}?source=cache`,
    `/market%2f${listingId}`,
    '/maker/not-an-object',
  ]) {
    const parsed = parseFreshV8Route(path);
    assert.equal(parsed.valid, false, path);
    assert.equal(parsed.code, UNSUPPORTED_PRODUCT_CODE, path);
  }
});

test('unsupported cache entries are rejected without conversion or deletion', () => {
  const entries = new Map([
    ['soulidity:retired-product', '{"root":"x"}'],
    ['soulidity:fresh-maker-v8:route', JSON.stringify({ schemaVersion: WEB_V8_CACHE_SCHEMA })],
  ]);
  const storage = {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; },
  };
  const result = inspectFreshV8Cache(storage);
  assert.equal(result.valid, false);
  assert.deepEqual(result.entries, [{ key: 'soulidity:retired-product', code: UNSUPPORTED_PRODUCT_CODE }]);
  assert.equal(entries.size, 2, 'scanner must not mutate browser data');
});

test('the runtime bridge consumes the strict seven-role tuple', async () => {
  const initial = runtimeInput();
  const checked = await assertLiveMakerV8Runtime(initial, {
    async getSuiClient() { return runtimeAttestationRpc(initial); },
  });
  const market = marketRuntimeFromMakerRuntime(checked, 'mainnet');
  assert.equal(Object.keys(checked.roles).length, 7);
  assert.equal(market, checked);
  assert.equal(market.roles.market.callablePackageId, checked.roles.market.callablePackageId);

  const upgraded = runtimeInput();
  upgraded.roles.market.callablePackageId = id('19');
  const upgradedRuntime = await assertLiveMakerV8Runtime(upgraded, {
    async getSuiClient() { return runtimeAttestationRpc(upgraded); },
  });
  assert.equal(upgradedRuntime.roles.market.callablePackageId, id('19'));
});

test('live action context binds route, wallet, activation, seven packages, refs, and authority refs', () => {
  const route = parseFreshV8Route(`/market/${id('30')}`);
  const account = { address: id('40'), network: 'mainnet' };
  const request = { requestId: 'web-v8:test-request', route, action: 'purchaseMakerControl' };
  const ref = (byte) => ({ id: id(byte), version: '7', digest: digest(byte) });
  const context = {
    schemaVersion: WEB_V8_CONTEXT_SCHEMA,
    source: 'LIVE_RPC',
    requestId: request.requestId,
    chainIdentifier: '35834a8a',
    route: `listing:${route.id}`,
    action: request.action,
    activation: {
      eventType: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated'),
      rootId: id('31'),
      lifecycle: 'ACTIVE',
    },
    packageTuple: roles.map((role, index) => ({
      role,
      originalPackageId: runtime.roles[role].typeOriginPackageId,
      callablePackageId: runtime.roles[role].callablePackageId,
      packageDigest: String(index + 2).repeat(44),
    })),
    builderInput: { wallet: account },
    refs: {
      primary: ref('30'), root: ref('31'), registry: ref('32'), treasury: ref('33'),
    },
    authority: { kind: 'MAKER_ADMIN_RECEIVING', refs: [ref('34')] },
  };
  context.builderInput = {
    wallet: account,
    registry: {
      kind: 'MarketRegistryV8', network: 'mainnet', objectId: id('32'), objectVersion: '7', digest: digest('32'),
    },
    treasury: {
      kind: 'MarketTreasuryV8', network: 'mainnet', objectId: id('33'), objectVersion: '7', digest: digest('33'),
    },
    listing: {
      kind: 'MakerListingV8', network: 'mainnet', objectId: id('30'), objectVersion: '7', digest: digest('30'),
    },
    root: {
      schemaVersion: 'animacraft.maker-v8-chain.v8', network: 'mainnet', objectId: id('31'),
      version: '7', digest: digest('31'), type: `${runtime.roles.core.typeOriginPackageId}::maker_v8::MakerRootV8<${runtime.paymentCoinType}>`,
      lifecycleCode: 1, binding: { makerTreasuryId: id('35') },
    },
    protocolConfig: {
      schemaVersion: 'animacraft.maker-v8-chain.v8', network: 'mainnet', objectId: runtime.protocolConfigId,
      version: '7', digest: digest('36'), type: `${runtime.roles.core.typeOriginPackageId}::protocol_config_v8::ProtocolConfigV8`,
      enabled: true, revision: '7', commitment: `0x${'aa'.repeat(32)}`,
    },
  };
  const checked = assertFreshV8ActionContext(context, request, runtime, execution, account);
  assert.equal(checked.refs.primary.id, route.id);
  assert.equal(checked.packageTuple.length, 7);
  assert.equal(checked.authority.refs.length, 1);

  assert.throws(
    () => assertFreshV8ActionContext({ ...context, chainIdentifier: 'testnet' }, request, runtime, execution, account),
    { code: 'WEB_V8_CONTEXT_DRIFT' },
  );
  assert.throws(
    () => assertFreshV8ActionContext({
      ...context,
      packageTuple: context.packageTuple.map((entry, index) => (
        index === 5 ? { ...entry, packageDigest: 'Z'.repeat(32) } : entry
      )),
    }, request, runtime, execution, account),
    { code: 'WEB_V8_PACKAGE_TUPLE_DRIFT' },
  );
  assert.throws(
    () => assertFreshV8ActionContext({
      ...context,
      packageTuple: context.packageTuple.map((entry, index) => (
        index === 0 ? { ...entry, baseRegistryModuleSha256: 'aa'.repeat(32) } : entry
      )),
    }, request, runtime, execution, account),
    { code: 'WEB_V8_FIELDS_INVALID' },
  );
  assert.throws(
    () => assertFreshV8ActionContext({ ...context, authority: { kind: 'MAKER', refs: [], authorized: true } }, request, runtime, execution, account),
    { code: 'WEB_V8_FIELDS_INVALID' },
  );
  assert.throws(
    () => assertFreshV8ActionContext({ ...context, activation: { ...context.activation, lifecycle: 'DRAFT' } }, request, runtime, execution, account),
    { code: 'WEB_V8_ROOT_NOT_ACTIVE' },
  );
  assert.throws(
    () => assertFreshV8ActionContext({
      ...context,
      builderInput: { ...context.builderInput, root: { ...context.builderInput.root, schemaVersion: undefined } },
    }, request, runtime, execution, account),
    { code: 'WEB_V8_CHAIN_READBACK_MISMATCH' },
  );
  assert.throws(
    () => assertFreshV8ActionContext({
      ...context,
      builderInput: {
        ...context.builderInput,
        payment: { objectId: id('50'), balanceAtomic: '1000000' },
      },
    }, request, runtime, execution, account),
    { code: 'MARKET_V8_CALLER_PAYMENT_FORBIDDEN' },
  );
});

test('the approved original Animacraft information architecture stays intact while Market remains isolated in Soulidity', async () => {
  assert.equal(MARKET_V8_ACTIONS.length, 14);
  assert.equal(new Set(MARKET_V8_ACTIONS.map((action) => action.id)).size, 14);
  assert.deepEqual(
    MARKET_V8_ACTIONS.filter((action) => action.kind === 'PURCHASE').map((action) => action.lane),
    ['MAKER', 'SOUL', 'PHYSICAL_BASE', 'PHYSICAL_PACK'],
  );
  const [html, originalApp, workspaceView, marketApp] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../original-product-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace-v8-view.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-v8-market-controller.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /<main id="appMain">/);
  assert.match(html, /aria-live="polite"/);
  for (const route of ['templates', 'make', 'creator', 'docs']) {
    assert.match(html, new RegExp(`data-page=["']${route}["']`), route);
  }
  assert.doesNotMatch(html, /data-page=["'](?:collection|pack|market|mypage)["']/);
  assert.match(html, /id="soulidityMySoulsLink"/);
  assert.match(originalApp, /\['soulidityMySoulsLink', '\/my-souls', true\]/);
  assert.match(html, /id="makerV4CreatorMount"/);
  assert.match(html, /id="makerV4PlayerMount"/);
  for (const label of ['Expansion Packs', 'Composable Items', 'Commerce & Rights', 'Soul Configuration', 'Preflight']) {
    assert.match(workspaceView, new RegExp(label));
  }
  assert.match(html, /id="soulidityMarketLink"/);
  assert.match(originalApp, /\['soulidityMarketLink', '\/market', false\]/);
  assert.match(marketApp, /role="alert"/);
  assert.match(marketApp, /aria-pressed=/);
  assert.match(marketApp, /role="status" aria-live="polite"/);
});

test('production entry keeps the approved original product app on v8-only execution boundaries', async () => {
  const files = [
    '../app.js', '../maker-v8-market-controller.js', '../index.html', '../chain-error-ui.js', '../public-v8/config.js',
    '../config.example.js', '../README.md', '../vite.config.js',
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
  assert.doesNotMatch(importLines, /maker-(?:commerce|composable|physical|publication|legacy)|expansion-pack|oc-handoff/i);
  assert.doesNotMatch(source, /SALE_PENDING|dual[-_ ]path/i);
  assert.match(source, /createOriginalProductApp/);
  assert.doesNotMatch(source, /product-shell\.js|createProductShell|fresh-v8-bindings\.css|creator-workspace\.css/);
  assert.match(source, /createMakerV8ProductBridge/);
  assert.match(source, /createMakerV8ProductRuntime/);
  assert.match(source, /createProductionMakerV8BrowserAdapters/);
  assert.match(source, /MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT/);
  assert.doesNotMatch(source, /@mysten\/sui\/(?:jsonrpc|client)|SuiJsonRpcClient|getJsonRpcFullnodeUrl|JsonRpcProvider/);
  assert.doesNotMatch(source, /["']jsonrpc["']\s*:\s*["']2\.0["']/);
  assert.doesNotMatch(source, /\.(?:queryTransactionBlocks|getTransactionBlock|dryRunTransactionBlock|executeTransactionBlock|devInspectTransactionBlock)\s*\(/);
  const publicEntry = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(publicEntry, /maker-v8-market(?:-controller)?\.js/);
  assert.match(source, /UNSUPPORTED_LEGACY_PRODUCT/);
  assert.match(source, /publicDir:\s*['"]public-v8['"]/);
  assert.deepEqual(
    (await readdir(new URL('../public-v8/', import.meta.url))).sort(),
    ['config.js', 'theme-bootstrap.js'],
  );
});

test('checked-in deployment config has complete explicit Mainnet authority, not a historical candidate tuple', async () => {
  const source = await readFile(new URL('../public-v8/config.js', import.meta.url), 'utf8');
  const context = { window: {} };
  runInNewContext(source, context);
  const runtime = assertMakerV8Runtime(JSON.parse(JSON.stringify(context.window.SoulidityMakerV8)));
  const execution = assertWebV8ExecutionConfig(JSON.parse(JSON.stringify(context.window.SoulidityV8Execution)));
  assert.equal(runtime.enabled, true);
  assert.deepEqual(Object.keys(runtime.roles).sort(), [...roles].sort());
  assert.equal(new Set(Object.values(runtime.roles).map(role => role.callablePackageId)).size, 7);
  for (const value of [runtime.catalogId, runtime.protocolConfigId, runtime.protocolTreasuryId]) {
    assert.match(value, /^0x[0-9a-f]{64}$/);
  }
  const native = context.window.SoulidityMakerV8.nativeSoulIntegration;
  assert.equal(native.expectedNativeBinding.soulOriginalType, `${native.soulidityOriginalPackageId}::soul::Soul`);
  assert.equal(native.expectedNativeBinding.soulDefiningType, `${native.soulidityCallablePackageId}::soul::Soul`);
  assert.equal(execution.network, 'mainnet');
  assert.equal(execution.chainIdentifier, '35834a8a');
  // The Sept10 approved deployment replaced the earlier disabled candidate.
  // This checks explicit policy shape; real authority is attested separately.
  assert.equal(typeof execution.allowWalletSignature, 'boolean');
  assert.equal(typeof execution.allowBroadcast, 'boolean');
  assert.ok(Object.isFrozen(context.window.SoulidityMakerV8));
  assert.ok(Object.isFrozen(context.window.SoulidityV8Execution));
  assert.doesNotMatch(source, /placeholderId|0x(?:10|11|12|13|14|15|16|80|81|82|83|84|85|86|87|88){32}/);
});

test('CI pins the verified Sui CLI and gates all fresh web and Move artifacts', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/repository-hygiene.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /SUI_RELEASE:\s*mainnet-v1\.80\.1/);
  assert.match(workflow, /SUI_ARCHIVE:\s*sui-mainnet-v1\.80\.1-ubuntu-x86_64\.tgz/);
  assert.match(workflow, /SUI_ARCHIVE_SHA256:\s*97f9aed10e0c2fe3204ce4639ac992e1449b17c14f22f30e9f903ead54ac7336/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.ok(workflow.indexOf('sha256sum --check --strict') < workflow.indexOf('tar -xOzf'));
  assert.match(workflow, /sui 1\.80\.1-671ba71e69c7/);
  assert.doesNotMatch(workflow, /releases\.sui\.io|SUI_BINARY_SHA256|1\.78\.1/);
  assert.match(workflow, /npm run check/);
  const webJob = workflow.slice(workflow.indexOf('\n  web:'), workflow.indexOf('\n  move:'));
  assert.match(webJob, /MOVE_HOME: \$\{\{ runner\.temp \}\}\/native-soul-external-sources/);
  const prepareSources = webJob.indexOf('node scripts/prepare-native-soul-external-sources.mjs "$MOVE_HOME"');
  assert.ok(prepareSources >= 0 && prepareSources < webJob.indexOf('run: npm run check'),
    'Fresh Web runners must verify pinned external sources before the source/build-entry tests');
  assert.match(workflow, /npm run scan:fresh:source/);
  assert.match(workflow, /node scripts\/native-soul-test-graph\.mjs/);
  assert.match(workflow, /--soulidity-root "\$GITHUB_WORKSPACE\/_paired\/soulidity"/);
  assert.match(workflow, /--check release-gates/);
  const checks = nativeGraphReleaseChecks();
  for (const role of roles) for (const kind of ['package', 'probes', 'disassemble', 'size']) {
    assert.ok(checks.includes(`${kind}:animacraft_v8_${role}`));
  }
  for (const check of ['package:soulidity', 'acceptance', 'build', 'disassemble:soulidity', 'field-limits']) {
    assert.ok(checks.includes(check));
  }
});
