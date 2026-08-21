import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
} from '../app.js';
import { assertMakerV8Runtime, makerV8StableType } from '../maker-v8-runtime.js';

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
  chainIdentifier: 'mainnet',
  allowWalletSignature: false,
  allowBroadcast: false,
});
const runtime = assertMakerV8Runtime(runtimeInput());

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
  const checked = await assertLiveMakerV8Runtime(runtimeInput(), {});
  const market = marketRuntimeFromMakerRuntime(checked, 'mainnet');
  assert.equal(Object.keys(checked.roles).length, 7);
  assert.equal(market, checked);
  assert.equal(market.roles.market.callablePackageId, checked.roles.market.callablePackageId);

  const upgraded = runtimeInput();
  upgraded.roles.market.callablePackageId = id('19');
  const calls = [];
  const upgradedRuntime = await assertLiveMakerV8Runtime(upgraded, {
    async resolveRoleLineages(requests) {
      calls.push(requests);
      return { market: id('15') };
    },
  });
  assert.equal(upgradedRuntime.roles.market.callablePackageId, id('19'));
  assert.equal(calls[0][0].role, 'market');
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
    chainIdentifier: 'mainnet',
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
      packageDigest: digest(String(index + 1).padStart(2, '0')),
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

test('the UI exposes exactly fourteen static Market actions and accessible semantics', async () => {
  assert.equal(MARKET_V8_ACTIONS.length, 14);
  assert.equal(new Set(MARKET_V8_ACTIONS.map((action) => action.id)).size, 14);
  assert.deepEqual(
    MARKET_V8_ACTIONS.filter((action) => action.kind === 'PURCHASE').map((action) => action.lane),
    ['MAKER', 'SOUL', 'PHYSICAL_BASE', 'PHYSICAL_PACK'],
  );
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(html, /<main[\s>]/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Skip to fresh v8 market/);
  assert.match(app, /role="alert"/);
  assert.match(app, /aria-pressed=/);
  assert.match(app, /role="status" aria-live="polite"/);
});

test('production entry files have no retired imports, aliases, routes, or pending pseudo-state', async () => {
  const files = ['../app.js', '../index.html', '../chain-error-ui.js', '../public/config.js', '../config.example.js'];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
  assert.doesNotMatch(importLines, /maker-(?:commerce|composable|physical|publication|legacy)|expansion-pack|oc-handoff/i);
  assert.doesNotMatch(source, /SALE_PENDING|dual[-_ ]path/i);
  assert.doesNotMatch(source, /data-page=|#templates|#creator|#make(?:\b|["'])/i);
  assert.doesNotMatch(source, /ANIMACRAFT_CONFIG|makerV8ReleaseEnabled|commerceV\d|compositionV\d|physicalV\d/i);
  assert.match(source, /UNSUPPORTED_LEGACY_PRODUCT/);
});
