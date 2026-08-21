import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  WEB_V8_CONTEXT_SCHEMA,
  WEB_V8_EXECUTION_SCHEMA,
  WEB_V8_ROUTE_SCHEMA,
  createFreshV8Controller,
  parseFreshV8Route,
} from '../app.js';
import { assertMakerV8Runtime, makerV8StableType } from '../maker-v8-runtime.js';

async function optionalModule(environmentName, localName) {
  const localPath = new URL(`../${localName}`, import.meta.url).pathname;
  const path = process.env[environmentName] || localPath;
  try {
    await access(path);
    return await import(pathToFileURL(path));
  } catch {
    return null;
  }
}

const marketModule = await optionalModule('MAKER_V8_MARKET_MODULE', 'maker-v8-market.js');
const recoveryModule = await optionalModule('MAKER_V8_RECOVERY_MODULE', 'maker-v8-recovery.js');
const available = Boolean(marketModule && recoveryModule);
const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const packageId = (digit) => `0x${digit.repeat(64)}`;
const bytes32 = (value) => Array(32).fill(value);
const digest = '11111111111111111111111111111111';

function u64Bytes(value) {
  const bytes = [];
  let remaining = BigInt(value);
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  return bytes;
}

function hexBytes(value) {
  return value.slice(2).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16));
}

function vector32(value) {
  const bytes = hexBytes(value);
  assert.equal(bytes.length, 32);
  return [32, ...bytes];
}

function quoteBytes(quote) {
  return Uint8Array.from([
    quote.quoteKind,
    ...hexBytes(quote.rootId),
    ...u64Bytes(quote.makerVersion),
    ...vector32(quote.rootContentCommitment),
    ...vector32(quote.economicsCommitment),
    ...vector32(quote.rightsCommitment),
    ...u64Bytes(quote.grossAtomic),
    ...u64Bytes(quote.protocolAtomic),
    ...u64Bytes(quote.creatorAtomic),
    ...u64Bytes(quote.sourceAtomic),
    ...u64Bytes(quote.sellerAtomic),
    ...vector32(quote.commitment),
  ]);
}

function runtimeFixture() {
  const rolePackages = {
    core: packageId('1'), seal: packageId('6'), runtime: packageId('4'), output: packageId('2'), physical: packageId('3'), market: packageId('5'), release: packageId('7'),
  };
  return assertMakerV8Runtime({
    schemaVersion: 'animacraft.maker-v8-runtime.v8',
    protocolVersion: 8,
    enabled: true,
    catalogId: id(900),
    protocolConfigId: id(901),
    protocolTreasuryId: id(902),
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    clockObjectId: `0x${'0'.repeat(63)}6`,
    roles: Object.fromEntries(Object.entries(rolePackages).map(([role, packageValue]) => [role, {
      typeOriginPackageId: packageValue,
      callablePackageId: packageValue,
    }])),
    roleConfigIds: {
      seal: id(910), runtime: id(911), output: id(912), physical: id(913), market: id(914), release: id(915),
    },
    makerBindings: [],
  });
}

function moveObject(type, objectId, fields) {
  return {
    data: {
      objectId,
      version: '7',
      digest,
      content: {
        dataType: 'moveObject',
        type,
        hasPublicTransfer: false,
        fields: { id: { id: objectId }, ...fields },
      },
    },
  };
}

function fixture(runtime) {
  const market = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  const IDs = {
    registry: id(100), treasury: id(101), catalog: runtime.catalogId, config: id(103), root: id(104),
    protocolConfig: runtime.protocolConfigId, admin: id(107), makerTreasury: id(108), seller: id(200),
  };
  const registryResponse = moveObject(market.types.marketRegistry, IDs.registry, {
    version: '8', catalog_id: IDs.catalog, package_config_id: IDs.config,
    product_binding_commitment: bytes32(1), call_cap_set_commitment: bytes32(2),
    root_id: IDs.root, maker_version: '42', root_content_commitment: bytes32(0xaa),
    protocol_config_id: IDs.protocolConfig, protocol_config_revision: '7',
    protocol_config_commitment: bytes32(0xdd), economics_commitment: bytes32(0xbb),
    rights_commitment: bytes32(0xcc), maker_market_fee_bps: '250', soul_market_fee_bps: '300',
    soul_creator_royalty_bps: '500', maker_source_royalty_bps: '200', maker_resale_royalty_bps: '400',
    treasury_id: IDs.treasury, sealed: true, revision: '4', listing_count: '0', escrow_count: '0',
    completed_sale_count: '0', canceled_sale_count: '0', recovered_sale_count: '0', gross_volume_atomic: '0',
    protocol_paid_atomic: '0', creator_paid_atomic: '0', source_paid_atomic: '0', seller_paid_atomic: '0',
    zero_state_commitment: bytes32(3),
  });
  const treasuryResponse = moveObject(market.types.marketTreasury, IDs.treasury, {
    version: '8', catalog_id: IDs.catalog, package_config_id: IDs.config, root_id: IDs.root,
    maker_version: '42', root_content_commitment: bytes32(0xaa), escrow: { value: '0' },
    gross_escrowed_atomic: '0', gross_released_atomic: '0',
  });
  const registry = market.parseRegistry(registryResponse);
  const treasury = market.parseTreasury(treasuryResponse);
  const object = (objectId, type, fields = {}) => ({
    schemaVersion: 'animacraft.maker-v8-chain.v8',
    objectId,
    version: '7',
    digest,
    network: 'mainnet',
    type,
    ...fields,
  });
  const wallet = { address: IDs.seller, network: 'mainnet' };
  const builderInput = {
    registry,
    treasury,
    root: object(IDs.root, market.types.makerRoot, {
      binding: Object.freeze({ makerTreasuryId: IDs.makerTreasury }),
      lifecycleCode: marketModule.MARKET_V8_LIFECYCLES.PAUSED,
    }),
    catalog: object(IDs.catalog, market.types.catalog),
    config: object(IDs.config, market.types.marketConfig),
    protocolConfig: object(IDs.protocolConfig, market.types.protocolConfig, {
      enabled: true,
      revision: registry.fields.protocolConfigRevision,
      commitment: registry.fields.protocolConfigCommitment,
    }),
    wallet,
    admin: object(IDs.admin, market.types.makerAdmin),
    makerTreasury: object(IDs.makerTreasury, market.types.makerTreasury, { balanceAtomic: '0' }),
    grossAtomic: '1000000',
    expectedRegistryRevision: registry.fields.revision,
  };
  return { market, IDs, registry, treasury, builderInput, wallet };
}

test('controller uses real builder, forces re-review on ref drift, and stays unsigned', {
  skip: available ? false : 'Run with the integrated Maker v8 Market and Recovery modules.',
}, async () => {
  const runtime = runtimeFixture();
  const data = fixture(runtime);
  const route = parseFreshV8Route(`/maker/${data.IDs.root}`);
  const execution = {
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network: 'mainnet',
    chainIdentifier: 'mainnet',
    allowWalletSignature: false,
    allowBroadcast: false,
  };
  let registryRefVersion = '7';
  const ref = (objectId, version = '7') => ({ id: objectId, version, digest });
  const packageTuple = Object.entries(runtime.roles).map(([role, entry], index) => ({
    role,
    originalPackageId: entry.typeOriginPackageId,
    callablePackageId: entry.callablePackageId,
    packageDigest: `${index + 1}`.repeat(32),
  }));
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  const persistence = recoveryModule.createMakerV8RecoveryMemoryAdapter();
  let buildCalls = 0;
  let dryRunCalls = 0;
  let signCalls = 0;
  const inspectedQuote = data.market.quoteMakerResale(data.registry, '1000000');
  const driftedQuote = data.market.quoteMakerResale(data.registry, '1000001');
  let injectQuoteDrift = false;
  const suiClient = {
    async simulateTransaction() {
      const quote = injectQuoteDrift ? driftedQuote : inspectedQuote;
      return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(quote) }] }] };
    },
  };
  const adapters = {
    persistence,
    rpc: {
      async getChainIdentifier() { return 'mainnet'; },
      async getSuiClient() { return suiClient; },
      async resolveRoleLineages() { return {}; },
      async browseMarket() { throw new Error('not used'); },
      async loadRoute(request) {
        return {
          schemaVersion: WEB_V8_ROUTE_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: 'mainnet',
          route: `maker:${data.IDs.root}`,
          activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
          view: { title: 'Fixture Maker', subtitle: 'Live checked-in v8 fixture', lifecycle: 'PAUSED', listingKind: null, listingStatus: null },
          availableActions: ['listMakerControl'],
        };
      },
      async loadActionContext(request) {
        return {
          schemaVersion: WEB_V8_CONTEXT_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: 'mainnet',
          route: `maker:${data.IDs.root}`,
          action: 'listMakerControl',
          activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
          packageTuple,
          builderInput: data.builderInput,
          refs: {
            primary: ref(data.IDs.admin), root: ref(data.IDs.root),
            registry: ref(data.IDs.registry, registryRefVersion), treasury: ref(data.IDs.treasury),
          },
          authority: { kind: 'MAKER_ADMIN', refs: [ref(data.IDs.admin)] },
        };
      },
      async queryTransaction({ digest: transactionDigest }) { return { status: 'NOT_FOUND', digest: transactionDigest, checkpoint: null, error: null }; },
      async readbackMarketAction() { throw new Error('not used'); },
    },
    wallet: {
      async getCurrentAccount() { return data.wallet; },
      async reconnect() { return data.wallet; },
      async signExactTransaction() { signCalls += 1; throw new Error('must stay disabled'); },
      async verifyExactSignature() { return true; },
    },
    transactions: {
      async buildExactTransaction({ client, transaction, descriptor }) {
        buildCalls += 1;
        assert.equal(client, suiClient, 'wallet coin resolution must use the current Sui client');
        assert.equal(descriptor.target, `${runtime.roles.market.callablePackageId}::market_v8::list_maker_control_v8`);
        assert.equal(typeof transaction.getData, 'function');
        return {
          transactionBytes: 'fixture-exact-transaction-bytes',
          transactionDigest: 'fixture-exact-transaction-digest',
          epochWindow: { start: '100', end: '101' },
          gas: { budget: '10000000', price: '1000' },
          sourceSnapshot: { tree: 'fixture-tree', action: descriptor.action },
        };
      },
      async deriveTransactionDigest() { return 'fixture-exact-transaction-digest'; },
      async dryRunExactTransaction({ descriptor }) { dryRunCalls += 1; return { status: 'SUCCESS', action: descriptor.action }; },
      async broadcastExactTransaction() { throw new Error('must stay disabled'); },
    },
  };
  const controller = createFreshV8Controller({ route, runtime, execution, adapters, marketModule, recoveryModule });
  await controller.refresh();
  assert.equal(controller.snapshot().status, 'QUOTING');
  injectQuoteDrift = true;
  await assert.rejects(() => controller.reviewQuote(), { code: 'MARKET_V8_QUOTE_DRIFT' });
  assert.equal(controller.snapshot().reviewedFingerprint, null);
  assert.equal(controller.snapshot().prepared, null);
  assert.equal(controller.snapshot().issue.layer, 'STALE_CONTEXT');
  injectQuoteDrift = false;
  await controller.reviewQuote();
  assert.equal(controller.snapshot().status, 'READY');
  const prepared = await controller.prepare();
  assert.equal(prepared.descriptor.action, 'listMakerControl');
  assert.equal(controller.snapshot().status, 'READY');
  assert.equal(buildCalls, 1);
  assert.equal(dryRunCalls, 1);
  assert.equal(signCalls, 0);
  await assert.rejects(() => controller.requestSignature('SIGN EXACT TRANSACTION'));
  assert.equal(signCalls, 0);

  registryRefVersion = '8';
  await assert.rejects(() => controller.refresh());
  assert.equal(controller.snapshot().reviewedFingerprint, null);
  assert.equal(controller.snapshot().prepared, null);
  assert.equal(controller.snapshot().issue.layer, 'STALE_CONTEXT');
});
