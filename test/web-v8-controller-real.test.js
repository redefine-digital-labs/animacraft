import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bcs } from '@mysten/sui/bcs';
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';

import {
  WEB_V8_CONTEXT_SCHEMA,
  WEB_V8_EXECUTION_SCHEMA,
  WEB_V8_INVENTORY_SCHEMA,
  WEB_V8_RECOVERY_DATABASE_NAME,
  WEB_V8_RECOVERY_DATABASE_VERSION,
  WEB_V8_ROUTE_SCHEMA,
  WEB_V8_UNSIGNED_DISCARD_CONFIRMATION,
  WEB_V8_UNSIGNED_RECLAIM_CONFIRMATION,
  assertWebV8ExecutionConfig,
  createIndexedDbRecoveryAdapter,
  createFreshV8Controller,
  parseFreshV8Route,
  renderFreshV8App,
} from '../app.js';
import { makerV8StableType } from '../maker-v8-runtime.js';
import { MAKER_V8_TRANSACTION_ABSENCE_SCHEMA } from '../maker-v8-actions.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
} from '../maker-v8-chain.js';
import { runtimeAttestationRpc } from './fixtures/maker-v8-runtime-attestation.js';

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

function absentTransactionResult(transactionDigest, watermarkEpoch = '100') {
  return {
    status: 'NOT_FOUND',
    digest: transactionDigest,
    absence: {
      schemaVersion: MAKER_V8_TRANSACTION_ABSENCE_SCHEMA,
      kind: 'SUI_JSON_RPC_TRANSACTION_NOT_FOUND',
      rpcCode: -32602,
      rpcType: 'InvalidParams',
      requestedDigest: transactionDigest,
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      watermarkEpoch,
      watermarkCheckpointSequence: '777',
      watermarkCheckpointDigest: digest,
    },
  };
}

test('web execution config rejects a signing-only deployment', () => {
  assert.throws(
    () => assertWebV8ExecutionConfig({
      schemaVersion: WEB_V8_EXECUTION_SCHEMA,
      network: 'mainnet',
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: false,
    }),
    { code: 'WEB_V8_EXECUTION_FLAG_INVALID', layer: 'CONFIGURATION' },
  );
});

test('production UI exposes the exact durable-state liveness buttons', () => {
  const action = (actionId) => ({ id: actionId });
  const prepared = (actionId) => ({
    descriptor: { action: actionId, target: `${packageId('5')}::market_v8::${actionId}` },
    digest: `${actionId}:digest`,
  });
  const base = {
    route: { kind: 'maker', id: id(104) },
    runtime: { paymentCoinType: '0x2::sui::SUI' },
    execution: {
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: true,
    },
    status: 'QUOTING',
    busy: false,
    account: { address: id(200) },
    view: {
      title: 'Durable state fixture', subtitle: 'Production UI liveness',
      lifecycle: 'PAUSED', listingKind: null, listingStatus: null,
    },
    browse: null,
    availableActions: ['listMakerControl'],
    action: action('listMakerControl'),
    grossAtomic: '1000000',
    context: null,
    quote: null,
    quoteEvidence: null,
    chainQuoteProof: null,
    fingerprint: null,
    reviewedFingerprint: null,
    paymentFingerprint: null,
    prepared: null,
    recoveryRecord: null,
    completionReceipt: null,
    issue: null,
  };
  const render = (patch) => {
    const root = { innerHTML: '', addEventListener() {} };
    renderFreshV8App(root, {
      subscribe(listener) {
        listener({ ...base, ...patch });
        return () => {};
      },
    });
    return root.innerHTML;
  };
  const button = (html, command) => {
    const match = html.match(new RegExp(`<button[^>]*data-command="${command}"[^>]*>`));
    assert.ok(match, `missing production ${command} button`);
    return { tag: match[0], enabled: !match[0].includes('disabled') };
  };

  const verified = render({
    status: 'VERIFIED',
    recoveryRecord: { state: 'VERIFIED' },
    prepared: prepared('listMakerControl'),
  });
  assert.equal(button(verified, 'recover').enabled, true);
  assert.match(verified, /Persist receipt & finish cleanup/);

  const awaiting = render({
    status: 'AWAITING_SIGNATURE',
    recoveryRecord: { state: 'AWAITING_SIGNATURE' },
    prepared: prepared('listMakerControl'),
  });
  assert.equal(button(awaiting, 'reclaim').enabled, true);
  assert.equal(button(awaiting, 'discard').enabled, false);
  assert.equal(button(awaiting, 'sign').enabled, false);

  const ready = render({
    status: 'READY',
    recoveryRecord: { state: 'READY' },
    prepared: prepared('listMakerControl'),
  });
  assert.equal(button(ready, 'discard').enabled, true);
  assert.equal(button(ready, 'sign').enabled, true);

  const terminal = render({
    status: 'OUTCOME_PENDING',
    view: { ...base.view, listingKind: 'MAKER', listingStatus: 'SETTLED' },
    availableActions: [],
    action: action('purchaseMakerControl'),
    recoveryRecord: { state: 'OUTCOME_PENDING' },
    prepared: prepared('purchaseMakerControl'),
  });
  assert.equal(button(terminal, 'recover').enabled, true);
  assert.equal(button(terminal, 'replay').enabled, true);
  assert.match(
    terminal.match(/<button[^>]*data-action="purchaseMakerControl"[^>]*>/)?.[0] || '',
    /disabled/,
    'terminal live action stays disabled while immutable WAL recovery remains enabled',
  );

  const quote = {
    grossAtomic: '1000000', protocolAtomic: '1', creatorAtomic: '1',
    sourceAtomic: '1', sellerAtomic: '999997', commitment: `0x${'ab'.repeat(32)}`,
  };
  const expiredTerminal = render({
    status: 'EXPIRED_NOT_FOUND',
    recoveryRecord: { state: 'EXPIRED_NOT_FOUND' },
    prepared: null,
  });
  assert.equal(button(expiredTerminal, 'refresh').enabled, true);
  const expiredFresh = render({
    status: 'READY',
    action: action('cancelMakerControl'),
    availableActions: ['cancelMakerControl'],
    quote,
    quoteEvidence: { source: 'MAINNET_DRY_RUN' },
    fingerprint: 'fresh-after-expiration',
    reviewedFingerprint: 'fresh-after-expiration',
    recoveryRecord: null,
    prepared: null,
  });
  assert.equal(button(expiredFresh, 'prepare').enabled, true);
  assert.equal(button(expiredFresh, 'discard').enabled, false);
  assert.equal(button(expiredFresh, 'replay').enabled, false);

  const finalizedFailure = render({
    status: 'FINALIZED_FAILURE',
    action: action('cancelMakerControl'),
    availableActions: ['cancelMakerControl'],
    quote,
    fingerprint: 'fresh-after-failure',
    recoveryRecord: { state: 'FINALIZED_FAILURE' },
    prepared: prepared('cancelMakerControl'),
  });
  assert.equal(button(finalizedFailure, 'review').enabled, true);
  assert.equal(button(finalizedFailure, 'prepare').enabled, false);
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class IndexedDbRequest {
  constructor(run) {
    queueMicrotask(() => {
      try {
        this.result = run();
        this.onsuccess?.();
      } catch (error) {
        this.error = error;
        this.onerror?.();
      }
    });
  }
}

class IndexedDbStore {
  constructor(transaction, records) {
    this.transaction = transaction;
    this.records = records;
  }

  get(key) {
    const request = new IndexedDbRequest(() => clone(this.records.get(key)));
    this.transaction.touch();
    return request;
  }

  getAll() {
    const request = new IndexedDbRequest(() => clone([...this.records.values()]));
    this.transaction.touch();
    return request;
  }

  put(value, key) {
    this.records.set(key, clone(value));
    this.transaction.touch();
  }

  delete(key) {
    this.records.delete(key);
    this.transaction.touch();
  }
}

class IndexedDbTransaction {
  constructor(database) {
    this.database = database;
    this.scheduled = false;
    this.aborted = false;
    this.error = null;
  }

  objectStore(name) {
    return new IndexedDbStore(this, this.database.records.get(name));
  }

  touch() {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      if (!this.aborted) this.oncomplete?.();
    }, 0);
  }

  abort() {
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }
}

class IndexedDbDatabase {
  constructor() {
    this.records = new Map();
    this.objectStoreNames = { contains: (name) => this.records.has(name) };
  }

  createObjectStore(name) {
    this.records.set(name, new Map());
  }

  transaction() {
    return new IndexedDbTransaction(this);
  }
}

function memoryIndexedDb() {
  const database = new IndexedDbDatabase();
  const openCalls = [];
  let initialized = false;
  return {
    database,
    openCalls,
    factory: {
      open(name, version) {
        openCalls.push({ name, version });
        const request = {};
        queueMicrotask(() => {
          request.result = database;
          if (!initialized) {
            initialized = true;
            request.onupgradeneeded?.();
          }
          queueMicrotask(() => request.onsuccess?.());
        });
        return request;
      },
    },
  };
}

test('fresh recovery opens a new version-one database instead of upgrading the pre-release cache', async () => {
  const memory = memoryIndexedDb();
  const adapter = createIndexedDbRecoveryAdapter(memory.factory);
  assert.equal(await adapter.load('missing-scope'), null);
  assert.deepEqual(memory.openCalls, [{
    name: WEB_V8_RECOVERY_DATABASE_NAME,
    version: WEB_V8_RECOVERY_DATABASE_VERSION,
  }]);
  assert.notEqual(WEB_V8_RECOVERY_DATABASE_NAME, 'animacraft-fresh-maker-v8');
  assert.equal(WEB_V8_RECOVERY_DATABASE_VERSION, 1);
});

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

function exactListTransaction(descriptor) {
  const [packageIdValue, moduleName, functionName] = descriptor.target.split('::');
  const inputs = descriptor.arguments.map((argument) => {
    if (argument.kind === 'u64') return Inputs.Pure(bcs.u64().serialize(BigInt(argument.value)));
    return Inputs.SharedObjectRef({ objectId: argument.objectId, initialSharedVersion: '1', mutable: true });
  });
  const data = TransactionDataBuilder.restore({
    version: 2,
    sender: descriptor.sender,
    expiration: null,
    gasData: {
      budget: '10000000', price: '1000', owner: descriptor.sender,
      payment: [{ objectId: id(999), version: '1', digest }],
    },
    inputs,
    commands: [{
      MoveCall: {
        package: packageIdValue, module: moduleName, function: functionName,
        typeArguments: [...descriptor.typeArguments],
        arguments: inputs.map((_, Input) => ({ Input, $kind: 'Input' })),
      },
      $kind: 'MoveCall',
    }],
  });
  const bytes = data.build();
  return {
    transactionBytes: toBase64(bytes),
    transactionDigest: TransactionDataBuilder.getDigestFromBytes(bytes),
  };
}

function runtimeFixture() {
  const rolePackages = {
    core: packageId('1'), seal: packageId('6'), runtime: packageId('4'), output: packageId('2'), physical: packageId('3'), market: packageId('5'), release: packageId('7'),
  };
  return {
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
  };
}

function moveObject(type, objectId, fields, version = '7') {
  return {
    data: {
      objectId,
      version,
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

function fixture(runtime, { registryVersion = '7', adminVersion = '7' } = {}) {
  const market = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  const IDs = {
    registry: id(100), treasury: id(101), catalog: runtime.catalogId, config: runtime.roleConfigIds.market, root: id(104),
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
  }, registryVersion);
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
    version: objectId === IDs.admin ? adminVersion : '7',
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
      adminCapId: IDs.admin,
      ownerAddress: IDs.seller,
      creatorAddress: id(201),
      controlEpoch: '5',
      binding: Object.freeze({
        makerTreasuryId: IDs.makerTreasury,
        marketRegistryId: IDs.registry,
        marketTreasuryId: IDs.treasury,
      }),
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

function packageTuple(runtime) {
  return Object.entries(runtime.roles).map(([role, entry], index) => ({
    role,
    originalPackageId: entry.typeOriginPackageId,
    callablePackageId: entry.callablePackageId,
    packageDigest: `${index + 2}`.repeat(44),
  }));
}

function renderRoot() {
  return {
    innerHTML: '',
    click: null,
    addEventListener(type, listener) {
      assert.equal(type, 'click');
      this.click = listener;
    },
    querySelector() { return null; },
  };
}

function layeredError(code, message, layer) {
  const error = new Error(message);
  error.code = code;
  error.layer = layer;
  return error;
}

test('detail routes browse verified live state while disconnected and render every reconnect failure layer', {
  skip: available ? false : 'Run with the integrated Maker v8 Market and Recovery modules.',
}, async () => {
  const rawRuntime = runtimeFixture();
  const runtime = (await attestMakerV8Runtime(runtimeAttestationRpc(rawRuntime), rawRuntime)).runtime;
  const data = fixture(runtime);
  const listingId = id(260);
  const execution = {
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network: 'mainnet',
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: false,
    allowBroadcast: false,
  };
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  let reconnectMode = 'no-provider';
  let routeReads = 0;
  const adapters = {
    persistence: recoveryModule.createMakerV8RecoveryMemoryAdapter(),
    rpc: {
      async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
      async getSuiClient() { throw new Error('passive detail browse must not request a signing client'); },
      async browseMarket() { throw new Error('not used'); },
      async loadOwnedInventory() { throw new Error('not used'); },
      async loadRoute(request) {
        routeReads += 1;
        return {
          schemaVersion: WEB_V8_ROUTE_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
          route: `${request.route.kind}:${request.route.id}`,
          activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
          view: {
            title: request.route.kind === 'maker' ? 'Disconnected Maker detail' : 'Disconnected Listing detail',
            subtitle: 'Verified without wallet authority',
            lifecycle: 'PAUSED',
            listingKind: request.route.kind === 'listing' ? 'MakerListingV8' : null,
            listingStatus: request.route.kind === 'listing' ? 'OPEN' : null,
          },
          availableActions: request.route.kind === 'listing'
            ? ['cancelMakerControl', 'recoverMakerControl'] : ['listMakerControl'],
        };
      },
      async loadActionContext() { throw new Error('disconnected browse must not select action authority'); },
      async queryTransaction() { throw new Error('not used'); },
      async readbackMarketAction() { throw new Error('not used'); },
    },
    wallet: {
      async getCurrentAccount() {
        throw layeredError(
          'MAKER_V8_BROWSER_WALLET_NOT_CONNECTED',
          'Connect a Sui Mainnet wallet account first.',
          'WALLET',
        );
      },
      async reconnect() {
        if (reconnectMode === 'no-provider') {
          throw layeredError(
            'MAKER_V8_BROWSER_WALLET_UNAVAILABLE',
            'No compatible Sui Wallet Standard wallet is registered.',
            'WALLET',
          );
        }
        if (reconnectMode === 'rejected') {
          throw layeredError(
            'MAKER_V8_BROWSER_WALLET_RECONNECT_REJECTED',
            'The wallet rejected the reconnect request.',
            'WALLET',
          );
        }
        return { address: data.wallet.address, network: 'testnet' };
      },
      async signExactTransaction() { throw new Error('not used'); },
      async verifyExactSignature() { throw new Error('not used'); },
    },
    transactions: {
      async buildExactTransaction() { throw new Error('not used'); },
      async deriveTransactionDigest() { throw new Error('not used'); },
      async dryRunExactTransaction() { throw new Error('not used'); },
      async broadcastExactTransaction() { throw new Error('not used'); },
    },
  };

  for (const route of [
    parseFreshV8Route(`/maker/${data.IDs.root}`),
    parseFreshV8Route(`/market/${listingId}`),
  ]) {
    const controller = createFreshV8Controller({
      route, runtime, execution, adapters, marketModule, recoveryModule,
    });
    await controller.refresh();
    const state = controller.snapshot();
    assert.equal(state.account, null);
    assert.equal(state.action, null, 'passive detail browse must not choose wallet authority');
    assert.equal(state.status, 'READY');
    assert.match(state.view.title, /Disconnected/);
  }
  assert.equal(routeReads, 2);

  const controller = createFreshV8Controller({
    route: parseFreshV8Route(`/maker/${data.IDs.root}`),
    runtime,
    execution,
    adapters,
    marketModule,
    recoveryModule,
  });
  const root = renderRoot();
  renderFreshV8App(root, controller);
  await controller.refresh();
  assert.match(root.innerHTML, /Disconnected Maker detail/);
  assert.match(root.innerHTML, /Reconnect wallet/);

  const reconnectClick = {
    target: {
      closest(selector) {
        return selector === '[data-command]' ? { dataset: { command: 'reconnect' } } : null;
      },
    },
  };
  for (const [mode, expectedLayer, expectedStatus] of [
    ['no-provider', 'WALLET', 'RECONNECT_REQUIRED'],
    ['rejected', 'WALLET', 'RECONNECT_REQUIRED'],
    ['wrong-network', 'STALE_CONTEXT', 'ERROR'],
  ]) {
    reconnectMode = mode;
    await root.click(reconnectClick);
    assert.equal(controller.snapshot().issue.layer, expectedLayer);
    assert.equal(controller.snapshot().status, expectedStatus);
    assert.match(root.innerHTML, new RegExp(`layer-pill">${expectedLayer}`));
    assert.match(root.innerHTML, /Disconnected Maker detail/);
    assert.match(root.innerHTML, /Reconnect wallet/);
  }
});

test('owned Soul and Physical inventory renders every exact choice and never selects or refetches the first implicitly', {
  skip: available ? false : 'Run with the integrated Maker v8 Market and Recovery modules.',
}, async () => {
  const rawRuntime = runtimeFixture();
  const runtime = (await attestMakerV8Runtime(runtimeAttestationRpc(rawRuntime), rawRuntime)).runtime;
  const data = fixture(runtime);
  const execution = {
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network: 'mainnet',
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: false,
    allowBroadcast: false,
  };
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  const bundles = [
    [id(301), id(302), id(303)],
    [id(311), id(312), id(313)],
  ];
  const physicalAssets = [
    { id: id(331), sourceId: id(341) },
    { id: id(332), sourceId: id(342) },
  ];
  const chainObject = (objectId, type, fields = {}) => ({
    schemaVersion: 'animacraft.maker-v8-chain.v8',
    objectId,
    version: '7',
    digest,
    network: 'mainnet',
    type,
    ...fields,
  });
  const rootObject = Object.freeze({
    ...data.builderInput.root,
    lifecycleCode: marketModule.MARKET_V8_LIFECYCLES.ACTIVE,
    binding: Object.freeze({
      ...data.builderInput.root.binding,
      outputRegistryId: id(320),
      soulRegistryId: id(321),
      physicalRegistryId: id(322),
    }),
  });
  const ref = (objectId) => ({ id: objectId, version: '7', digest });
  const inventoryRequests = [];
  const soulContextRequests = [];
  const physicalContextRequests = [];
  let selectedStillOwned = true;
  let omitSelectedFromInventory = false;
  const adapters = {
    persistence: recoveryModule.createMakerV8RecoveryMemoryAdapter(),
    rpc: {
      async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
      async getSuiClient() { throw new Error('not used until quote review'); },
      async browseMarket() { throw new Error('not used'); },
      async loadRoute(request) {
        return {
          schemaVersion: WEB_V8_ROUTE_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
          route: `maker:${data.IDs.root}`,
          activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
          view: {
            title: 'Multiple exact assets', subtitle: 'Choose exact authority', lifecycle: 'ACTIVE',
            listingKind: null, listingStatus: null,
          },
          availableActions: ['listSoulBundle', 'listBasePhysical'],
        };
      },
      async loadOwnedInventory(request) {
        inventoryRequests.push(request.action);
        const soul = request.action === 'listSoulBundle';
        return {
          schemaVersion: WEB_V8_INVENTORY_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
          route: `maker:${data.IDs.root}`,
          action: request.action,
          account: data.wallet.address,
          rootId: data.IDs.root,
          choices: soul
            ? bundles.map((objectIds) => ({
                id: objectIds[0], kind: 'SOUL_BUNDLE', objectIds, ownershipEpoch: '5',
                sourceKind: null, sourceId: null, sourceTreasuryId: null,
              }))
            : physicalAssets
                .filter((asset) => !omitSelectedFromInventory || asset.id !== physicalAssets[1].id)
                .map((asset) => ({
                id: asset.id, kind: 'PHYSICAL_BASE', objectIds: [asset.id], ownershipEpoch: '6',
                sourceKind: 0, sourceId: asset.sourceId, sourceTreasuryId: null,
                })),
        };
      },
      async loadActionContext(request) {
        const soul = request.action === 'listSoulBundle';
        (soul ? soulContextRequests : physicalContextRequests).push(request.selectedInventoryId);
        if (!selectedStillOwned) {
          throw layeredError(
            'MAKER_V8_BROWSER_INVENTORY_SELECTION_STALE',
            'The selected Soul bundle is no longer in connected inventory.',
            'CUSTODY',
          );
        }
        const selected = soul
          ? bundles.find((entry) => entry[0] === request.selectedInventoryId)
          : physicalAssets.find((entry) => entry.id === request.selectedInventoryId);
        assert.ok(selected, 'only an explicit current inventory ID may reach action context');
        const primaryId = soul ? selected[0] : selected.id;
        return {
          schemaVersion: WEB_V8_CONTEXT_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
          route: `maker:${data.IDs.root}`,
          action: request.action,
          activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
          packageTuple: packageTuple(runtime),
          builderInput: {
            ...data.builderInput,
            root: rootObject,
            wallet: data.wallet,
            ...(soul ? {
              outputRegistry: chainObject(id(320), data.market.types.outputRegistry),
              soulRegistry: chainObject(id(321), data.market.types.soulRegistry),
              outputAsset: chainObject(selected[0], data.market.types.completeOutput),
              receipt: chainObject(selected[1], data.market.types.completeReceipt),
              soul: chainObject(selected[2], data.market.types.canonicalSoul),
            } : {
              physicalRegistry: chainObject(id(322), data.market.types.physicalRegistry),
              physicalConfig: chainObject(runtime.roleConfigIds.physical, data.market.types.physicalConfig),
              asset: chainObject(selected.id, data.market.types.physicalAsset, {
                sourceKind: 0,
                sourceTreasuryId: null,
                sourceId: selected.sourceId,
                ownershipEpoch: '6',
              }),
            }),
            expectedRegistryRevision: data.registry.fields.revision,
          },
          refs: {
            primary: ref(primaryId), root: ref(data.IDs.root),
            registry: ref(data.IDs.registry), treasury: ref(data.IDs.treasury),
          },
          authority: {
            kind: soul ? 'SOUL_LIST' : 'PHYSICAL_BASE_LIST',
            refs: soul ? selected.map(ref) : [ref(selected.id)],
          },
        };
      },
      async queryTransaction() { throw new Error('not used'); },
      async readbackMarketAction() { throw new Error('not used'); },
    },
    wallet: {
      async getCurrentAccount() { return data.wallet; },
      async reconnect() { return data.wallet; },
      async signExactTransaction() { throw new Error('not used'); },
      async verifyExactSignature() { throw new Error('not used'); },
    },
    transactions: {
      async buildExactTransaction() { throw new Error('not used'); },
      async deriveTransactionDigest() { throw new Error('not used'); },
      async dryRunExactTransaction() { throw new Error('not used'); },
      async broadcastExactTransaction() { throw new Error('not used'); },
    },
  };
  const controller = createFreshV8Controller({
    route: parseFreshV8Route(`/maker/${data.IDs.root}`),
    runtime,
    execution,
    adapters,
    marketModule,
    recoveryModule,
  });
  const root = renderRoot();
  renderFreshV8App(root, controller);
  await controller.refresh();
  assert.equal(controller.snapshot().status, 'SELECTION_REQUIRED');
  assert.equal(controller.snapshot().selectedInventoryId, null);
  assert.deepEqual(soulContextRequests, []);
  for (const objectId of bundles.flat()) assert.match(root.innerHTML, new RegExp(objectId));

  await root.click({
    target: {
      closest(selector) {
        return selector === '[data-inventory-id]'
          ? { dataset: { inventoryId: bundles[1][0] } } : null;
      },
    },
  });
  assert.equal(controller.snapshot().selectedInventoryId, bundles[1][0]);
  assert.deepEqual(soulContextRequests, [bundles[1][0]]);
  assert.doesNotMatch(root.innerHTML, new RegExp(`data-inventory-id="${bundles[0][0]}"[^>]*aria-pressed="true"`));
  assert.match(root.innerHTML, new RegExp(`data-inventory-id="${bundles[1][0]}"[^>]*aria-pressed="true"`));

  await controller.refresh();
  assert.equal(controller.snapshot().selectedInventoryId, bundles[1][0]);
  assert.deepEqual(soulContextRequests, [bundles[1][0], bundles[1][0]],
    'refresh must retain only the selected ID and reacquire its exact live context');
  assert.deepEqual(inventoryRequests, ['listSoulBundle', 'listSoulBundle'],
    'refresh must also replace the visible choices from a new owned-inventory read');

  selectedStillOwned = false;
  await assert.rejects(() => controller.setGrossAtomic('1000001'), {
    code: 'MAKER_V8_BROWSER_INVENTORY_SELECTION_STALE',
  });
  assert.deepEqual(soulContextRequests, [bundles[1][0], bundles[1][0], bundles[1][0]]);
  assert.equal(controller.snapshot().context, null);
  assert.equal(controller.snapshot().issue.layer, 'CUSTODY_AUTHORITY');

  selectedStillOwned = true;
  await controller.selectAction('listBasePhysical');
  assert.equal(controller.snapshot().selectedInventoryId, null);
  assert.equal(controller.snapshot().status, 'SELECTION_REQUIRED');
  assert.deepEqual(physicalContextRequests, []);
  assert.deepEqual(inventoryRequests, ['listSoulBundle', 'listSoulBundle', 'listBasePhysical']);
  for (const asset of physicalAssets) {
    assert.match(root.innerHTML, new RegExp(asset.id));
    assert.match(root.innerHTML, new RegExp(asset.sourceId));
  }
  await root.click({
    target: {
      closest(selector) {
        return selector === '[data-inventory-id]'
          ? { dataset: { inventoryId: physicalAssets[1].id } } : null;
      },
    },
  });
  assert.equal(controller.snapshot().selectedInventoryId, physicalAssets[1].id);
  assert.deepEqual(physicalContextRequests, [physicalAssets[1].id]);
  assert.doesNotMatch(root.innerHTML, new RegExp(`data-inventory-id="${physicalAssets[0].id}"[^>]*aria-pressed="true"`));
  assert.match(root.innerHTML, new RegExp(`data-inventory-id="${physicalAssets[1].id}"[^>]*aria-pressed="true"`));

  omitSelectedFromInventory = true;
  await assert.rejects(() => controller.refresh(), { code: 'WEB_V8_INVENTORY_SELECTION_STALE' });
  assert.equal(controller.snapshot().selectedInventoryId, null);
  assert.equal(controller.snapshot().context, null);
  assert.equal(controller.snapshot().issue.layer, 'CUSTODY_AUTHORITY');
});

test('all six cancel/recover controllers review frozen live listing economics without Move quote inspection', {
  skip: available ? false : 'Run with the integrated Maker v8 Market and Recovery modules.',
}, async () => {
  const rawRuntime = runtimeFixture();
  const runtime = (await attestMakerV8Runtime(runtimeAttestationRpc(rawRuntime), rawRuntime)).runtime;
  const data = fixture(runtime);
  const execution = {
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network: 'mainnet',
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: false,
    allowBroadcast: false,
  };
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  const ref = (objectId) => ({ id: objectId, version: '7', digest });
  const quote = Object.freeze({
    grossAtomic: 1_000_000n,
    protocolAtomic: 12_345n,
    creatorAtomic: 23_456n,
    sourceAtomic: 34_567n,
    sellerAtomic: 929_632n,
    quoteCommitment: `0x${'ab'.repeat(32)}`,
  });
  const cases = [
    ['cancelMakerControl', 'MakerListingV8', 'ACTIVE'],
    ['recoverMakerControl', 'MakerListingV8', 'ARCHIVED'],
    ['cancelSoulListing', 'SoulListingV8', 'ACTIVE'],
    ['recoverSoulListing', 'SoulListingV8', 'PAUSED'],
    ['cancelPhysicalListing', 'PhysicalListingV8', 'ACTIVE'],
    ['recoverPhysicalListing', 'PhysicalListingV8', 'ARCHIVED'],
  ];
  for (const [action, listingKind, lifecycle] of cases) {
    const listingId = id(400 + cases.findIndex((entry) => entry[0] === action));
    const lifecycleCode = marketModule.MARKET_V8_LIFECYCLES[lifecycle];
    let suiClientReads = 0;
    const listing = {
      kind: listingKind,
      network: 'mainnet',
      objectId: listingId,
      objectVersion: 7n,
      digest,
      fields: {
        ...quote,
        sourceAtomic: listingKind === 'MakerListingV8' ? 0n : quote.sourceAtomic,
        sellerAtomic: listingKind === 'MakerListingV8'
          ? quote.sellerAtomic + quote.sourceAtomic : quote.sellerAtomic,
        ...(listingKind === 'PhysicalListingV8'
          ? { custody: { sourceKind: action === 'recoverPhysicalListing' ? 1 : 0 } }
          : {}),
        revision: 0n,
      },
    };
    const adapters = {
      persistence: recoveryModule.createMakerV8RecoveryMemoryAdapter(),
      rpc: {
        async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
        async getSuiClient() { suiClientReads += 1; throw new Error('Move quote inspection is unavailable'); },
        async browseMarket() { throw new Error('not used'); },
        async loadOwnedInventory() { throw new Error('not used'); },
        async loadRoute(request) {
          return {
            schemaVersion: WEB_V8_ROUTE_SCHEMA,
            source: 'LIVE_RPC',
            requestId: request.requestId,
            chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
            route: `listing:${listingId}`,
            activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
            view: {
              title: `${action} listing`, subtitle: 'Frozen quote fixture', lifecycle,
              listingKind, listingStatus: 'OPEN',
            },
            availableActions: [action],
          };
        },
        async loadActionContext(request) {
          return {
            schemaVersion: WEB_V8_CONTEXT_SCHEMA,
            source: 'LIVE_RPC',
            requestId: request.requestId,
            chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
            route: `listing:${listingId}`,
            action,
            activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
            packageTuple: packageTuple(runtime),
            builderInput: {
              ...data.builderInput,
              root: { ...data.builderInput.root, lifecycleCode },
              listing,
              expectation: {
                listingRevision: listing.fields.revision,
                registryRevision: data.registry.fields.revision,
                quoteCommitment: listing.fields.quoteCommitment,
              },
            },
            refs: {
              primary: ref(listingId), root: ref(data.IDs.root),
              registry: ref(data.IDs.registry), treasury: ref(data.IDs.treasury),
            },
            authority: { kind: `${action}_AUTHORITY`, refs: [ref(listingId)] },
          };
        },
        async queryTransaction() { throw new Error('not used'); },
        async readbackMarketAction() { throw new Error('not used'); },
      },
      wallet: {
        async getCurrentAccount() { return data.wallet; },
        async reconnect() { return data.wallet; },
        async signExactTransaction() { throw new Error('not used'); },
        async verifyExactSignature() { throw new Error('not used'); },
      },
      transactions: {
        async buildExactTransaction() { throw new Error('not used'); },
        async deriveTransactionDigest() { throw new Error('not used'); },
        async dryRunExactTransaction() { throw new Error('not used'); },
        async broadcastExactTransaction() { throw new Error('not used'); },
      },
    };
    const controller = createFreshV8Controller({
      route: parseFreshV8Route(`/market/${listingId}`),
      runtime,
      execution,
      adapters,
      marketModule,
      recoveryModule,
    });
    await controller.refresh();
    const reviewed = await controller.reviewQuote();
    assert.equal(reviewed.evidence.source, 'live-listing');
    assert.equal(reviewed.grossAtomic, quote.grossAtomic.toString());
    assert.equal(reviewed.protocolAtomic, quote.protocolAtomic.toString());
    assert.equal(reviewed.commitment, quote.quoteCommitment);
    assert.equal(suiClientReads, 0, `${action} must not invoke unavailable Move quote inspection`);
    assert.equal(controller.snapshot().status, 'READY');
  }
});

const sharedOwner = Object.freeze({ kind: 'Shared', value: { initialSharedVersion: '1' } });
const addressOwner = (value) => ({ kind: 'AddressOwner', value });

function coreRef(objectId, version, owner) {
  return { objectId, version, digest, owner };
}

function history(objectId, type, ref, parsed, previousTransaction) {
  return {
    objectId,
    type,
    ownerKind: ref.owner.kind,
    ref,
    owner: ref.owner,
    previousTransaction,
    parsed,
  };
}

function snakeCounters(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([field, value]) => [
    field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value,
  ]));
}

function finalizedListMakerEnvelope(data, request) {
  const { IDs, market } = data;
  const descriptor = request.plan.sourceSnapshot.descriptor;
  const pre = descriptor.preState;
  const listingId = id(109);
  const registryBefore = {
    ...snakeCounters(pre.registry),
    version: '8',
    catalog_id: descriptor.catalogId,
    package_config_id: descriptor.roleConfigIds.market,
    root_id: descriptor.rootId,
    maker_version: '42',
    root_content_commitment: descriptor.rootContentCommitment,
    protocol_config_id: descriptor.protocolConfigId,
    protocol_config_revision: descriptor.protocolRevision,
    treasury_id: descriptor.treasuryId,
    sealed: true,
  };
  const registryAfter = {
    ...registryBefore,
    revision: String(BigInt(registryBefore.revision) + 1n),
    listing_count: String(BigInt(registryBefore.listing_count) + 1n),
    escrow_count: String(BigInt(registryBefore.escrow_count) + 1n),
  };
  const treasuryParsed = {
    version: '8',
    catalog_id: descriptor.catalogId,
    package_config_id: descriptor.roleConfigIds.market,
    root_id: descriptor.rootId,
    maker_version: '42',
    root_content_commitment: descriptor.rootContentCommitment,
    escrow: { value: '0' },
    gross_escrowed_atomic: pre.treasury.grossEscrowedAtomic,
    gross_released_atomic: pre.treasury.grossReleasedAtomic,
  };
  const rootParsed = {
    owner: IDs.seller,
    creator: pre.root.creator,
    admin_cap_id: IDs.admin,
    control_epoch: pre.root.controlEpoch,
    content_commitment: descriptor.rootContentCommitment,
  };
  const adminParsed = {
    root_id: IDs.root,
    owner: IDs.seller,
    control_epoch: pre.root.controlEpoch,
  };
  const listingParsed = {
    version: '8',
    registry_id: IDs.registry,
    treasury_id: IDs.treasury,
    package_config_id: descriptor.roleConfigIds.market,
    root_id: IDs.root,
    maker_version: '42',
    root_content_commitment: descriptor.rootContentCommitment,
    admin_cap_id: IDs.admin,
    seller: IDs.seller,
    expected_control_epoch: pre.ownershipEpoch,
    gross_atomic: pre.quote.grossAtomic,
    protocol_atomic: pre.quote.protocolAtomic,
    creator_atomic: pre.quote.creatorAtomic,
    seller_atomic: pre.quote.sellerAtomic,
    quote_commitment: pre.quote.commitment,
    status: '0',
    revision: '0',
    terminal_recipient: id(0),
  };
  const makerRevenue = { revenue: { value: '0' }, total_collected: '0', total_withdrawn: '0' };
  const unchangedRef = (objectId) => ({ ...coreRef(objectId, '7', sharedOwner), kind: 'ReadOnlyRoot' });
  const rootRef = unchangedRef(IDs.root);
  const treasuryRef = unchangedRef(IDs.treasury);
  const makerTreasuryRef = unchangedRef(IDs.makerTreasury);
  const registryInput = coreRef(IDs.registry, '7', sharedOwner);
  const registryOutput = coreRef(IDs.registry, '8', sharedOwner);
  const adminInput = coreRef(IDs.admin, '7', addressOwner(IDs.seller));
  const adminOutput = coreRef(IDs.admin, '8', { kind: 'ObjectOwner', value: listingId });
  const listingOutput = coreRef(listingId, '8', {
    kind: 'Shared', value: { initialSharedVersion: '8' },
  });
  const objectEvidence = (
    role,
    objectId,
    type,
    change,
    idOperation,
    before,
    after,
    revenue = { before: null, after: null },
  ) => ({
    role,
    objectId,
    type,
    ownerKind: (after ?? before).ownerKind,
    change,
    idOperation,
    before,
    after,
    revenue,
  });
  const effectsBytes = new Uint8Array([1, 2, 3]);
  const effectsFingerprint = `0x${[...sha256(effectsBytes)]
    .map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
  const event = {
    id: { txDigest: request.digest, eventSeq: '0' },
    packageId: descriptor.target.split('::')[0],
    transactionModule: 'market_v8',
    sender: IDs.seller,
    type: `${market.runtime.typeOrigins.marketPackageId}::market_v8::MarketListingOpenedV8`,
    parsedJson: {
      listing_id: listingId,
      registry_id: IDs.registry,
      lane: String(marketModule.MARKET_V8_LANES.MAKER),
      root_id: IDs.root,
      asset_id: IDs.admin,
      seller: IDs.seller,
      ownership_epoch: pre.ownershipEpoch,
      gross_atomic: pre.quote.grossAtomic,
      quote_commitment: pre.quote.commitment,
    },
    bcs: toBase64(new Uint8Array([9])),
    eventsDigest: digest,
  };
  return {
    schemaVersion: 'animacraft.web-market-finalized-readback.v8',
    source: 'FINALIZED_CORE_V2',
    digest: request.digest,
    epoch: request.outcome.epoch,
    effectsFingerprint,
    eventsDigest: digest,
    planHash: request.planHash,
    identity: request.identity,
    transaction: {
      sender: IDs.seller,
      status: 'SUCCESS',
      target: descriptor.target,
      typeArguments: descriptor.typeArguments,
    },
    event,
    events: [event],
    effects: {
      transactionDigest: request.digest,
      epoch: request.outcome.epoch,
      eventsDigest: digest,
      transactionBcs: request.plan.transactionBytes,
      eventsBcs: toBase64(new Uint8Array([8, 9])),
      bcs: toBase64(effectsBytes),
      changedObjects: [
        { objectId: IDs.registry, inputState: 'Exists', input: registryInput, outputState: 'ObjectWrite', output: registryOutput, idOperation: 'None' },
        { objectId: IDs.admin, inputState: 'Exists', input: adminInput, outputState: 'ObjectWrite', output: adminOutput, idOperation: 'None' },
        { objectId: listingId, inputState: 'DoesNotExist', input: null, outputState: 'ObjectWrite', output: listingOutput, idOperation: 'Created' },
      ],
      unchangedConsensusObjects: [
        { objectId: IDs.root, version: '7', digest, owner: sharedOwner, kind: 'ReadOnlyRoot' },
        { objectId: IDs.treasury, version: '7', digest, owner: sharedOwner, kind: 'ReadOnlyRoot' },
        { objectId: IDs.makerTreasury, version: '7', digest, owner: sharedOwner, kind: 'ReadOnlyRoot' },
      ],
      objects: [
        objectEvidence('ROOT', IDs.root, market.types.makerRoot, 'READBACK', 'None',
          history(IDs.root, market.types.makerRoot, rootRef, rootParsed, 'prior'),
          history(IDs.root, market.types.makerRoot, rootRef, rootParsed, 'prior')),
        objectEvidence('REGISTRY', IDs.registry, market.types.marketRegistry, 'CHANGED', 'None',
          history(IDs.registry, market.types.marketRegistry, registryInput, registryBefore, 'prior'),
          history(IDs.registry, market.types.marketRegistry, registryOutput, registryAfter, request.digest)),
        objectEvidence('TREASURY', IDs.treasury, market.types.marketTreasury, 'READBACK', 'None',
          history(IDs.treasury, market.types.marketTreasury, treasuryRef, treasuryParsed, 'prior'),
          history(IDs.treasury, market.types.marketTreasury, treasuryRef, treasuryParsed, 'prior')),
        objectEvidence('LISTING', listingId, market.types.makerListing, 'CREATED', 'Created', null,
          history(listingId, market.types.makerListing, listingOutput, listingParsed, request.digest)),
        objectEvidence('ADMIN', IDs.admin, market.types.makerAdmin, 'CHANGED', 'None',
          history(IDs.admin, market.types.makerAdmin, adminInput, adminParsed, 'prior'),
          history(IDs.admin, market.types.makerAdmin, adminOutput, adminParsed, request.digest)),
        objectEvidence('MAKER_TREASURY', IDs.makerTreasury, market.types.makerTreasury, 'READBACK', 'None',
          history(IDs.makerTreasury, market.types.makerTreasury, makerTreasuryRef, makerRevenue, 'prior'),
          history(IDs.makerTreasury, market.types.makerTreasury, makerTreasuryRef, makerRevenue, 'prior'),
          {
            before: { balance: '0', totalCollected: '0', totalWithdrawn: '0', integerWidth: 128 },
            after: { balance: '0', totalCollected: '0', totalWithdrawn: '0', integerWidth: 128 },
          }),
      ],
    },
  };
}

test('controller uses real builder, forces re-review on ref drift, and stays unsigned', {
  skip: available ? false : 'Run with the integrated Maker v8 Market and Recovery modules.',
}, async () => {
  const rawRuntime = runtimeFixture();
  const runtime = (await attestMakerV8Runtime(runtimeAttestationRpc(rawRuntime), rawRuntime)).runtime;
  const data = fixture(runtime);
  const route = parseFreshV8Route(`/maker/${data.IDs.root}`);
  const execution = {
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network: 'mainnet',
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: false,
    allowBroadcast: false,
  };
  let registryRefVersion = '7';
  const ref = (objectId, version = '7') => ({ id: objectId, version, digest });
  const packageTuple = Object.entries(runtime.roles).map(([role, entry], index) => ({
    role,
    originalPackageId: entry.typeOriginPackageId,
    callablePackageId: entry.callablePackageId,
    packageDigest: `${index + 2}`.repeat(44),
  }));
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  const persistence = recoveryModule.createMakerV8RecoveryMemoryAdapter();
  let buildCalls = 0;
  let dryRunCalls = 0;
  let signCalls = 0;
  const inspectedQuote = data.market.quoteMakerResale(data.registry, '1000000');
  const driftedQuote = data.market.quoteMakerResale(data.registry, '1000001');
  let injectQuoteDrift = false;
  const suiClient = runtimeAttestationRpc(runtime, {
    async simulateTransaction() {
      const quote = injectQuoteDrift ? driftedQuote : inspectedQuote;
      return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(quote) }] }] };
    },
    async dryRunTransactionBlock() {
      dryRunCalls += 1;
      return { effects: { status: { status: 'success' } } };
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '100' } }; },
      resolveTransactionPlugin() {
        return async (transactionData, _options, next) => {
          transactionData.inputs = transactionData.inputs.map((input) => {
            if (!input.UnresolvedObject) return input;
            if (input.UnresolvedObject.objectId === data.IDs.admin) {
              return Inputs.ObjectRef({
                objectId: data.IDs.admin,
                version: '7',
                digest,
              });
            }
            return Inputs.SharedObjectRef({
              objectId: input.UnresolvedObject.objectId,
              initialSharedVersion: '1',
              mutable: true,
            });
          });
          transactionData.gasData = {
            budget: '10000000',
            price: '1000',
            owner: transactionData.sender,
            payment: [{ objectId: id(999), version: '1', digest }],
          };
          await next();
        };
      },
    },
  });
  const adapters = {
    persistence,
    rpc: {
      async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
      async getSuiClient() { return suiClient; },
      async browseMarket() { throw new Error('not used'); },
      async loadOwnedInventory() { throw new Error('not used'); },
      async loadRoute(request) {
        return {
          schemaVersion: WEB_V8_ROUTE_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
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
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
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
      async queryTransaction({ digest: transactionDigest }) {
        return absentTransactionResult(transactionDigest);
      },
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
          ...exactListTransaction(descriptor),
          epochWindow: { start: '100', end: '101' },
          gas: { budget: '10000000', price: '1000' },
          sourceSnapshot: { tree: 'fixture-tree', action: descriptor.action },
        };
      },
      async deriveTransactionDigest(bytes) {
        return TransactionDataBuilder.getDigestFromBytes(Buffer.from(bytes, 'base64'));
      },
      async dryRunExactTransaction() { throw new Error('private Market simulation is the only dry-run authority'); },
      async broadcastExactTransaction() { throw new Error('must stay disabled'); },
    },
  };
  let disconnectedWalletReads = 0;
  const marketAdapters = {
    ...adapters,
    rpc: {
      ...adapters.rpc,
      async browseMarket(request) {
        return {
          schemaVersion: 'animacraft.web-market-browse.v8',
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
          makers: [],
          listings: [],
        };
      },
    },
    wallet: {
      ...adapters.wallet,
      async getCurrentAccount() {
        disconnectedWalletReads += 1;
        throw new Error('no Wallet Standard provider or connected account');
      },
    },
  };
  const publicController = createFreshV8Controller({
    route: parseFreshV8Route('/market'),
    runtime,
    execution,
    adapters: marketAdapters,
    marketModule,
    recoveryModule,
  });
  await publicController.refresh();
  assert.equal(disconnectedWalletReads, 0, 'public market browse must not require a wallet provider');
  assert.equal(publicController.snapshot().account, null);
  await publicController.reconnect();
  assert.equal(publicController.snapshot().account.address, data.wallet.address);

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
  assert.equal(buildCalls, 0, 'caller transaction adapter is not a signing authority');
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

test('fresh controller signs durable WAL, verifies Core V2 finality, and reloads its receipt tombstone', {
  skip: available ? false : 'Run with the integrated Maker v8 Market and Recovery modules.',
}, async () => {
  const rawRuntime = runtimeFixture();
  const runtime = (await attestMakerV8Runtime(runtimeAttestationRpc(rawRuntime), rawRuntime)).runtime;
  const firstData = fixture(runtime);
  const route = parseFreshV8Route(`/maker/${firstData.IDs.root}`);
  const execution = {
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network: 'mainnet',
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: true,
    allowBroadcast: true,
  };
  const ref = (objectId, version = '7') => ({ id: objectId, version, digest });
  const packageTuple = Object.entries(runtime.roles).map(([role, entry], index) => ({
    role,
    originalPackageId: entry.typeOriginPackageId,
    callablePackageId: entry.callablePackageId,
    packageDigest: `${index + 2}`.repeat(44),
  }));
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  const memory = memoryIndexedDb();
  const databaseName = `animacraft-fresh-maker-v8-test:${globalThis.crypto.randomUUID()}`;
  const persistence = createIndexedDbRecoveryAdapter(memory.factory, { databaseName });
  let interruptVerifiedCleanup = true;
  const crashAfterVerifiedPersistence = {
    load: (...args) => persistence.load(...args),
    loadReceipt: (...args) => persistence.loadReceipt(...args),
    loadFinalizedFailure: (...args) => persistence.loadFinalizedFailure(...args),
    listFinalizedFailures: (...args) => persistence.listFinalizedFailures(...args),
    loadExpiredNotFound: (...args) => persistence.loadExpiredNotFound(...args),
    listExpiredNotFound: (...args) => persistence.listExpiredNotFound(...args),
    async compareAndSwap(scopeKey, expectedRevision, nextRecord, options) {
      if (interruptVerifiedCleanup && nextRecord?.state === 'CLEANED') {
        interruptVerifiedCleanup = false;
        throw new Error('simulated page crash after durable VERIFIED');
      }
      return persistence.compareAndSwap(scopeKey, expectedRevision, nextRecord, options);
    },
  };
  const actionContextRequestIds = [];
  const actionContextRefs = [];
  const queryRequests = [];
  const readbackRequests = [];
  const signRequests = [];
  let dryRunCalls = 0;
  let finalized = null;
  let currentEpoch = '100';

  const suiClient = runtimeAttestationRpc(runtime, {
    async simulateTransaction() {
      const live = fixture(runtime);
      const quote = live.market.quoteMakerResale(live.registry, '1000000');
      return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(quote) }] }] };
    },
    async dryRunTransactionBlock() {
      dryRunCalls += 1;
      return { effects: { status: { status: 'success' } } };
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: currentEpoch } }; },
      resolveTransactionPlugin() {
        return async (transactionData, _options, next) => {
          const liveVersion = finalized ? '8' : '7';
          transactionData.inputs = transactionData.inputs.map((input) => {
            if (!input.UnresolvedObject) return input;
            if (input.UnresolvedObject.objectId === firstData.IDs.admin) {
              return Inputs.ObjectRef({
                objectId: firstData.IDs.admin,
                version: liveVersion,
                digest,
              });
            }
            return Inputs.SharedObjectRef({
              objectId: input.UnresolvedObject.objectId,
              initialSharedVersion: '1',
              mutable: true,
            });
          });
          transactionData.gasData = {
            budget: '10000000',
            price: '1000',
            owner: firstData.IDs.seller,
            payment: [{ objectId: id(999), version: '1', digest }],
          };
          await next();
        };
      },
    },
  });

  const adapters = {
    persistence: crashAfterVerifiedPersistence,
    rpc: {
      async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
      async getSuiClient() { return suiClient; },
      async browseMarket() { throw new Error('not used'); },
      async loadOwnedInventory() { throw new Error('not used'); },
      async loadRoute(request) {
        return {
          schemaVersion: WEB_V8_ROUTE_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
          route: `maker:${firstData.IDs.root}`,
          activation: { eventType, rootId: firstData.IDs.root, lifecycle: 'ACTIVE' },
          view: {
            title: 'Fixture Maker',
            subtitle: 'Fresh controller Recovery fixture',
            lifecycle: 'PAUSED',
            listingKind: null,
            listingStatus: null,
          },
          availableActions: ['listMakerControl'],
        };
      },
      async loadActionContext(request) {
        actionContextRequestIds.push(request.requestId);
        const live = finalized
          ? fixture(runtime, { registryVersion: '8', adminVersion: '8' })
          : firstData;
        const finalizedVersion = finalized ? '8' : '7';
        const primary = ref(live.IDs.admin, finalizedVersion);
        const registry = ref(live.IDs.registry, finalizedVersion);
        const builderInput = { ...live.builderInput };
        actionContextRefs.push({ primary, registry });
        return {
          schemaVersion: WEB_V8_CONTEXT_SCHEMA,
          source: 'LIVE_RPC',
          requestId: request.requestId,
          chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
          route: `maker:${live.IDs.root}`,
          action: 'listMakerControl',
          activation: { eventType, rootId: live.IDs.root, lifecycle: 'ACTIVE' },
          packageTuple: packageTuple.map((entry) => ({ ...entry })),
          builderInput,
          refs: {
            primary,
            root: ref(live.IDs.root),
            registry,
            treasury: ref(live.IDs.treasury),
          },
          authority: { kind: 'MAKER_ADMIN', refs: [{ ...primary }] },
        };
      },
      async queryTransaction(request) {
        queryRequests.push(clone(request));
        assert.ok(request.plan, 'query must receive the complete durable plan');
        assert.equal(request.planHash, request.plan.fingerprint);
        if (!finalized) finalized = finalizedListMakerEnvelope(firstData, {
          ...request,
          outcome: {
            status: 'FINALIZED_SUCCESS',
            epoch: '100',
            effectsFingerprint: `0x${[...sha256(new Uint8Array([1, 2, 3]))]
              .map((entry) => entry.toString(16).padStart(2, '0')).join('')}`,
            eventsDigest: digest,
          },
        });
        return {
          status: 'FINALIZED_SUCCESS',
          digest: request.digest,
          epoch: finalized.epoch,
          effectsFingerprint: finalized.effectsFingerprint,
          eventsDigest: finalized.eventsDigest,
          error: null,
        };
      },
      async readbackMarketAction(request) {
        readbackRequests.push(clone(request));
        assert.ok(request.plan, 'readback must receive the complete durable plan');
        assert.equal(request.planHash, request.plan.fingerprint);
        assert.equal(Object.hasOwn(request, 'checkpoint'), false);
        assert.equal(Object.hasOwn(request, 'postState'), false);
        finalized = finalizedListMakerEnvelope(firstData, request);
        assert.equal(Object.hasOwn(finalized, 'verified'), false,
          'the RPC callback must return raw Core V2 evidence, not caller authority');
        return finalized;
      },
    },
    wallet: {
      async getCurrentAccount() { return { ...firstData.wallet }; },
      async reconnect() { return { ...firstData.wallet }; },
      async signExactTransaction(request) {
        signRequests.push(clone(request));
        return {
          bytes: request.bytes,
          signature: `sig:${request.digest}:${request.signer}`,
          digest: request.digest,
          signer: request.signer,
        };
      },
      async verifyExactSignature({ bytes, signature, digest: signedDigest, signer }) {
        return {
          verified: signature === `sig:${signedDigest}:${signer}`,
          bytes,
          digest: signedDigest,
          signer,
        };
      },
    },
    transactions: {
      async buildExactTransaction() { throw new Error('private Market builder is required'); },
      async deriveTransactionDigest(bytes) {
        return TransactionDataBuilder.getDigestFromBytes(Buffer.from(bytes, 'base64'));
      },
      async dryRunExactTransaction() { throw new Error('private Market simulation is required'); },
      async broadcastExactTransaction() { throw new Error('broadcast must stay disabled'); },
    },
  };

  const controller = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters,
    marketModule,
    recoveryModule,
  });
  await controller.refresh();
  await controller.reviewQuote();
  await controller.prepare();
  const signed = await controller.requestSignature('SIGN EXACT TRANSACTION');
  assert.equal(signed.state, 'SIGNED_DURABLE');
  assert.equal(signRequests.length, 1);
  assert.match(signRequests[0].recovery.sessionId,
    /^web-v8-session:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(signRequests[0].recovery.planHash, signed.plan.fingerprint);
  assert.equal(actionContextRequestIds.length, 2,
    'signature must perform a second live identity refetch');
  assert.equal(new Set(actionContextRequestIds).size, actionContextRequestIds.length);
  assert.equal(dryRunCalls, 2,
    'prepare and requestSignature must consume separate one-shot simulations');

  const scopeKey = recoveryModule.makerV8RecoveryScopeKey(signed.identity);
  const durableSigned = await persistence.load(scopeKey);
  assert.equal(durableSigned.state, 'SIGNED_DURABLE');
  assert.deepEqual(durableSigned.plan, signed.plan);
  assert.deepEqual(durableSigned.signed, signed.signed);
  const validSignedSuccessor = {
    ...clone(durableSigned),
    revision: durableSigned.revision + 1,
    writerSessionId: 'adversarial-session',
    updatedAt: durableSigned.updatedAt + 1,
  };
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, validSignedSuccessor, {
      completionReceipt: null,
      discardUnsigned: true,
    }),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, {
      ...validSignedSuccessor,
      state: 'DISCARDED',
      plan: null,
      signed: null,
      queryOutcome: null,
      lastError: null,
      receipt: null,
      failure: null,
      expiration: null,
    }, { discardUnsigned: true }),
    { code: 'MAKER_V8_RECOVERY_UNSIGNED_DISCARD_FORBIDDEN' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, {
      ...validSignedSuccessor,
      identity: { ...validSignedSuccessor.identity, wallet: id(123_456) },
    }),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, {
      ...validSignedSuccessor,
      attempt: durableSigned.attempt + 1,
    }),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, {
      ...validSignedSuccessor,
      plan: { ...validSignedSuccessor.plan, fingerprint: `0x${'cd'.repeat(32)}` },
    }),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, {
      ...validSignedSuccessor,
      state: 'READY',
      signed: null,
      signatureSessionId: null,
      signatureDisposition: null,
      signatureLease: null,
      queryOutcome: null,
      lastError: null,
      receipt: null,
      failure: null,
      expiration: null,
    }),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, {
      ...validSignedSuccessor,
      revision: durableSigned.revision + 2,
    }),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision - 1, validSignedSuccessor),
    { code: 'MAKER_V8_RECOVERY_CAS_CONFLICT' },
  );
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableSigned.revision, null),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );
  assert.deepEqual(await persistence.load(scopeKey), durableSigned,
    'invalid commit options and physical deletion cannot reset the durable revision');

  await assert.rejects(
    controller.recoverOutcome(),
    { code: 'MAKER_V8_RECOVERY_STORAGE_FAILED' },
  );
  assert.equal(queryRequests.length, 1);
  assert.equal(readbackRequests.length, 1);
  assert.deepEqual(queryRequests[0].plan, signed.plan);
  assert.deepEqual(readbackRequests[0].plan, signed.plan);
  const durableVerified = await persistence.load(scopeKey);
  assert.equal(durableVerified.state, 'VERIFIED');
  assert.equal(durableVerified.receipt.planHash, signed.plan.fingerprint);
  assert.equal(durableVerified.receipt.evidence.source, 'FINALIZED_CORE_V2');
  await assert.rejects(
    persistence.compareAndSwap(scopeKey, durableVerified.revision, {
      ...clone(durableVerified),
      revision: durableVerified.revision + 1,
      state: 'CLEANED',
      plan: null,
      signed: null,
      signatureSessionId: null,
      signatureDisposition: null,
      signatureLease: null,
      queryOutcome: null,
      lastError: null,
      failure: null,
      expiration: null,
      writerSessionId: 'forged-cleanup-session',
      updatedAt: durableVerified.updatedAt + 1,
    }),
    { code: 'MAKER_V8_RECOVERY_STORAGE_RECORD_INVALID' },
  );

  const recoveryPersistence = createIndexedDbRecoveryAdapter(memory.factory, { databaseName });
  const recoveryPage = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: { ...adapters, persistence: recoveryPersistence },
    marketModule,
    recoveryModule,
  });
  await recoveryPage.refresh();
  assert.equal(recoveryPage.snapshot().status, 'VERIFIED');
  assert.equal(recoveryPage.snapshot().recoveryRecord.state, 'VERIFIED');
  const cleaned = await recoveryPage.recoverOutcome();
  assert.equal(cleaned.state, 'CLEANED');
  assert.equal(queryRequests.length, 1, 'VERIFIED cleanup must not query again');
  assert.equal(readbackRequests.length, 1, 'VERIFIED cleanup must not read back again');
  assert.equal(recoveryPage.snapshot().status, 'CLEANED');
  assert.equal(recoveryPage.snapshot().recoveryRecord, null);
  assert.deepEqual(recoveryPage.snapshot().completionReceipt, cleaned.receipt);

  const receipt = cleaned.receipt;
  const tombstone = await recoveryPersistence.load(scopeKey);
  assert.equal(tombstone.state, 'CLEANED');
  assert.equal(tombstone.plan, null);
  assert.equal(tombstone.signed, null);
  assert.equal(memory.database.records.get('receipts').size, 1);

  const reloadedPersistence = createIndexedDbRecoveryAdapter(memory.factory, { databaseName });
  const reloaded = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: { ...adapters, persistence: reloadedPersistence },
    marketModule,
    recoveryModule,
  });
  await reloaded.refresh();
  assert.equal(actionContextRequestIds.length, 4,
    'a new page/controller must refetch live identity instead of caching authority');
  assert.equal(new Set(actionContextRequestIds).size, actionContextRequestIds.length);
  assert.deepEqual(actionContextRefs.map((entry) => entry.registry.version), ['7', '7', '8', '8']);
  assert.deepEqual(actionContextRefs.map((entry) => entry.primary.version), ['7', '7', '8', '8']);
  assert.equal(reloaded.snapshot().status, 'CLEANED');
  assert.equal(reloaded.snapshot().recoveryRecord, null);
  assert.deepEqual(reloaded.snapshot().completionReceipt, receipt);
  assert.deepEqual(await reloadedPersistence.loadReceipt(tombstone.identityKey), receipt);
  assert.deepEqual(memory.openCalls, [
    { name: databaseName, version: WEB_V8_RECOVERY_DATABASE_VERSION },
    { name: databaseName, version: WEB_V8_RECOVERY_DATABASE_VERSION },
    { name: databaseName, version: WEB_V8_RECOVERY_DATABASE_VERSION },
  ]);

  // A generic wallet transport failure is outcome-unknown. A random new page
  // session must rediscover the AWAITING_SIGNATURE WAL, wait out its bounded
  // lease, and require the exact product phrase plus a trusted no-artifact
  // confirmation before it can return to READY. Reclaim itself must not depend
  // on mutable live refs or a dry run: no new signature is produced, and those
  // refs may legitimately have drifted while the old wallet prompt was open.
  finalized = null;
  const awaitingMemory = memoryIndexedDb();
  const awaitingDatabaseName = `animacraft-fresh-maker-v8-awaiting:${globalThis.crypto.randomUUID()}`;
  let leaseNow = 0;
  const leaseClock = () => Math.max(Date.now(), leaseNow);
  const awaitingPersistence = createIndexedDbRecoveryAdapter(awaitingMemory.factory, {
    databaseName: awaitingDatabaseName,
    clock: leaseClock,
  });
  const leasedRecoveryModule = {
    ...recoveryModule,
    createMakerV8RecoveryController(options) {
      return recoveryModule.createMakerV8RecoveryController({
        ...options,
        signatureLeaseMs: 1_000,
        clock: leaseClock,
      });
    },
  };
  let unknownWalletCalls = 0;
  const awaitingAdapters = {
    ...adapters,
    persistence: awaitingPersistence,
    wallet: {
      ...adapters.wallet,
      async signExactTransaction() {
        unknownWalletCalls += 1;
        throw new Error('wallet transport closed without a signed-artifact disposition');
      },
    },
  };
  const awaitingPage = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: awaitingAdapters,
    marketModule,
    recoveryModule: leasedRecoveryModule,
  });
  await awaitingPage.refresh();
  await awaitingPage.reviewQuote();
  await awaitingPage.prepare();
  const dryRunsBeforeUnknown = dryRunCalls;
  await assert.rejects(
    awaitingPage.requestSignature('SIGN EXACT TRANSACTION'),
    { code: 'MAKER_V8_RECOVERY_SIGNING_FAILED', layer: 'SIGNING' },
  );
  assert.equal(unknownWalletCalls, 1);
  assert.equal(dryRunCalls, dryRunsBeforeUnknown + 1);
  assert.equal(awaitingPage.snapshot().status, 'AWAITING_SIGNATURE');
  const awaitingRecord = await awaitingPersistence.load(scopeKey);
  assert.equal(awaitingRecord.state, 'AWAITING_SIGNATURE');
  assert.equal(awaitingRecord.signatureDisposition, 'OUTCOME_UNKNOWN');
  const abandonedSigningSession = awaitingRecord.signatureSessionId;
  assert.match(abandonedSigningSession,
    /^web-v8-session:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const randomReload = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: awaitingAdapters,
    marketModule,
    recoveryModule: leasedRecoveryModule,
  });
  await randomReload.refresh();
  assert.equal(randomReload.snapshot().status, 'AWAITING_SIGNATURE');
  assert.equal(randomReload.snapshot().recoveryRecord.signatureSessionId, abandonedSigningSession);
  assert.ok(randomReload.snapshot().prepared, 'reload reconstructs the immutable durable plan summary');
  await assert.rejects(
    randomReload.reclaimAwaitingSignature('yes, nothing was signed'),
    { code: 'WEB_V8_UNSIGNED_RECLAIM_CONFIRMATION_REQUIRED' },
  );
  assert.equal(randomReload.snapshot().status, 'AWAITING_SIGNATURE');

  leaseNow = awaitingRecord.signatureLease.expiresAtMs - 1;
  const dryRunsBeforeEarlyReclaim = dryRunCalls;
  await assert.rejects(
    randomReload.reclaimAwaitingSignature(WEB_V8_UNSIGNED_RECLAIM_CONFIRMATION),
    { code: 'MAKER_V8_RECOVERY_SIGNATURE_LEASE_ACTIVE' },
  );
  assert.equal(dryRunCalls, dryRunsBeforeEarlyReclaim,
    'pre-expiry reclaim never rebuilds or simulates the abandoned plan');
  assert.equal(randomReload.snapshot().status, 'AWAITING_SIGNATURE');
  assert.equal((await awaitingPersistence.load(scopeKey)).revision, awaitingRecord.revision);

  const forgedEarlyReady = {
    ...clone(awaitingRecord),
    revision: awaitingRecord.revision + 1,
    state: 'READY',
    signatureSessionId: null,
    signatureDisposition: null,
    signatureLease: null,
    lastError: null,
    writerSessionId: 'forged-reset-session',
    updatedAt: awaitingRecord.updatedAt + 1,
  };
  await assert.rejects(
    awaitingPersistence.compareAndSwap(scopeKey, awaitingRecord.revision, forgedEarlyReady, {
      resetUnsigned: {
        kind: 'EXTERNAL_UNSIGNED_CONFIRMATION',
        scopeKey,
        identityKey: awaitingRecord.identityKey,
        planHash: awaitingRecord.plan.fingerprint,
        sessionId: awaitingRecord.signatureSessionId,
        leaseExpiresAtMs: awaitingRecord.signatureLease.expiresAtMs,
        checkedAtMs: awaitingRecord.signatureLease.expiresAtMs - 1,
      },
    }),
    { code: 'MAKER_V8_RECOVERY_UNSIGNED_CONFIRMATION_INVALID' },
  );
  await assert.rejects(
    awaitingPersistence.compareAndSwap(scopeKey, awaitingRecord.revision, forgedEarlyReady, {
      resetUnsigned: {
        kind: 'EXTERNAL_UNSIGNED_CONFIRMATION',
        scopeKey,
        identityKey: awaitingRecord.identityKey,
        planHash: awaitingRecord.plan.fingerprint,
        sessionId: awaitingRecord.signatureSessionId,
        leaseExpiresAtMs: awaitingRecord.signatureLease.expiresAtMs,
        checkedAtMs: awaitingRecord.signatureLease.expiresAtMs,
      },
    }),
    { code: 'MAKER_V8_RECOVERY_UNSIGNED_CONFIRMATION_INVALID' },
    'the storage adapter rejects a caller that claims a future post-lease check',
  );
  assert.equal((await awaitingPersistence.load(scopeKey)).state, 'AWAITING_SIGNATURE');

  leaseNow = awaitingRecord.signatureLease.expiresAtMs;
  finalized = { refDrift: true };
  const contextReadsBeforeReclaim = actionContextRequestIds.length;
  const dryRunsBeforeReclaim = dryRunCalls;
  const reclaimed = await randomReload.reclaimAwaitingSignature(
    WEB_V8_UNSIGNED_RECLAIM_CONFIRMATION,
  );
  assert.equal(reclaimed.state, 'READY');
  assert.equal(unknownWalletCalls, 1, 'reclaim never opens a second wallet prompt');
  assert.equal(actionContextRequestIds.length, contextReadsBeforeReclaim,
    'post-lease no-artifact reclaim stays available after live object drift');
  assert.equal(dryRunCalls, dryRunsBeforeReclaim,
    'post-lease no-artifact reclaim does not authorize or dry-run a stale plan');
  assert.notEqual(reclaimed.writerSessionId, abandonedSigningSession);
  assert.match(reclaimed.writerSessionId,
    /^web-v8-session:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  // READY is also durable across a random reload. If live refs drift, signing
  // fails before a wallet prompt and the UI returns to READY so the explicit
  // unsigned discard/rebuild path remains reachable.
  const readyReload = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: awaitingAdapters,
    marketModule,
    recoveryModule: leasedRecoveryModule,
  });
  await readyReload.refresh();
  assert.equal(readyReload.snapshot().status, 'READY');
  assert.equal(readyReload.snapshot().recoveryRecord.state, 'READY');
  await assert.rejects(
    readyReload.discardUnsigned('discard it'),
    { code: 'WEB_V8_UNSIGNED_DISCARD_CONFIRMATION_REQUIRED' },
  );
  await assert.rejects(
    readyReload.requestSignature('SIGN EXACT TRANSACTION'),
    { code: 'WEB_V8_SIGNING_CONTEXT_DRIFT', layer: 'CONTEXT' },
  );
  assert.equal(unknownWalletCalls, 1, 'ref drift fails before Wallet Standard');
  assert.equal(readyReload.snapshot().status, 'READY');
  assert.equal(readyReload.snapshot().recoveryRecord.state, 'READY');

  const discardedAttempt = reclaimed.attempt;
  const discardedRevision = reclaimed.revision + 1;
  const oldDigest = reclaimed.plan.transactionDigest;
  await readyReload.discardUnsigned(WEB_V8_UNSIGNED_DISCARD_CONFIRMATION);
  assert.equal(readyReload.snapshot().status, 'QUOTING');
  const discardTombstone = await awaitingPersistence.load(scopeKey);
  assert.equal(discardTombstone.state, 'DISCARDED');
  assert.equal(discardTombstone.revision, discardedRevision);
  assert.equal(discardTombstone.plan, null);
  leaseNow = 0;
  const tombstoneClockDelay = Math.max(0, discardTombstone.updatedAt - Date.now() + 1);
  if (tombstoneClockDelay) {
    await new Promise((resolve) => setTimeout(resolve, tombstoneClockDelay));
  }
  await readyReload.reviewQuote();
  await readyReload.prepare();
  const rebuilt = await awaitingPersistence.load(scopeKey);
  assert.equal(rebuilt.state, 'READY');
  assert.equal(rebuilt.attempt, discardedAttempt + 1);
  assert.equal(rebuilt.revision, discardTombstone.revision + 1,
    'discard/rebuild keeps the Root CAS revision monotonic (no ABA)');
  assert.notEqual(rebuilt.plan.transactionDigest, oldDigest,
    'fresh object refs produce new canonical bytes after the discarded plan drifted');

  // An authoritative NOT_FOUND only retires signed bytes after the on-chain
  // epoch has passed their Transaction expiration. The archive and tombstone
  // are atomic, the old digest stays blocked, and a reload can prepare fresh
  // bytes under the same logical identity.
  finalized = null;
  currentEpoch = '100';
  const expirationMemory = memoryIndexedDb();
  const expirationDatabaseName = `animacraft-fresh-maker-v8-expiration:${globalThis.crypto.randomUUID()}`;
  const expirationPersistence = createIndexedDbRecoveryAdapter(expirationMemory.factory, {
    databaseName: expirationDatabaseName,
  });
  const expirationAdapters = {
    ...adapters,
    persistence: expirationPersistence,
    rpc: {
      ...adapters.rpc,
      async queryTransaction(request) {
        return absentTransactionResult(request.digest, currentEpoch);
      },
      async readbackMarketAction() { throw new Error('NOT_FOUND must not read finalized state'); },
    },
  };
  const expirationPage = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: expirationAdapters,
    marketModule,
    recoveryModule,
  });
  await expirationPage.refresh();
  await expirationPage.reviewQuote();
  await expirationPage.prepare();
  const expiringSigned = await expirationPage.requestSignature('SIGN EXACT TRANSACTION');
  assert.equal(expiringSigned.state, 'SIGNED_DURABLE');
  assert.equal(expiringSigned.plan.expiration.epoch, '101');
  currentEpoch = '102';
  const expired = await expirationPage.recoverOutcome();
  assert.equal(expired.state, 'EXPIRED_NOT_FOUND');
  assert.equal(expired.plan, null);
  assert.equal(expired.signed, null);
  assert.equal(expired.expiration.digest, expiringSigned.signed.digest);
  assert.equal(expired.expiration.planHash, expiringSigned.plan.fingerprint);
  assert.deepEqual(Object.keys(expired.expiration).sort(), [
    'absence',
    'digest',
    'expirationEpoch',
    'identity',
    'identityKey',
    'observedEpoch',
    'planHash',
    'queryStatus',
    'retiredAt',
    'schemaVersion',
    'scopeKey',
  ]);
  assert.equal(expired.expiration.scopeKey, scopeKey);
  assert.equal(expired.expiration.identityKey, expiringSigned.identityKey);
  assert.deepEqual(expired.expiration.identity, expiringSigned.identity);
  assert.equal(expired.expiration.expirationEpoch, '101');
  assert.equal(expired.expiration.observedEpoch, '102');
  assert.equal(expired.expiration.queryStatus, 'NOT_FOUND');
  assert.equal(expired.expiration.absence.watermarkEpoch, '102');
  assert.equal(expired.expiration.absence.watermarkCheckpointSequence, '777');
  assert.equal(expired.expiration.absence.requestedDigest, expiringSigned.signed.digest);
  assert.equal(expired.expiration.absence.chainIdentifier,
    MAKER_V8_MAINNET_CHAIN_IDENTIFIER);
  assert.ok(Number.isSafeInteger(expired.expiration.retiredAt));
  assert.equal(expirationMemory.database.records.get('expirations').size, 1);
  assert.deepEqual(
    await expirationPersistence.loadExpiredNotFound(
      expiringSigned.identityKey,
      expiringSigned.signed.digest,
    ),
    expired.expiration,
  );

  const expiredReload = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: expirationAdapters,
    marketModule,
    recoveryModule,
  });
  await expiredReload.refresh();
  assert.equal(expiredReload.snapshot().status, 'QUOTING');
  assert.equal(expiredReload.snapshot().recoveryRecord, null);
  await expiredReload.reviewQuote();
  await expiredReload.prepare();
  const expirationReplacement = await expirationPersistence.load(scopeKey);
  assert.equal(expirationReplacement.state, 'READY');
  assert.equal(expirationReplacement.identityKey, expiringSigned.identityKey,
    'epoch/gas refresh preserves the same logical action identity');
  assert.equal(expirationReplacement.attempt, expired.attempt + 1);
  assert.equal(expirationReplacement.revision, expired.revision + 1);
  assert.notEqual(expirationReplacement.plan.transactionDigest, expired.expiration.digest);
  assert.deepEqual(
    await expirationPersistence.loadExpiredNotFound(
      expiringSigned.identityKey,
      expiringSigned.signed.digest,
    ),
    expired.expiration,
    'fresh preparation preserves the expired digest archive',
  );

  // Finalized Move failure has the same liveness rule: only its exact failed
  // digest/plan is terminal. A new controller can re-review a freshly rebuilt
  // epoch/gas plan for the same identity while retaining the failure archive.
  currentEpoch = '100';
  const failureMemory = memoryIndexedDb();
  const failureDatabaseName = `animacraft-fresh-maker-v8-failure:${globalThis.crypto.randomUUID()}`;
  const failurePersistence = createIndexedDbRecoveryAdapter(failureMemory.factory, {
    databaseName: failureDatabaseName,
  });
  const failureEffectsFingerprint = `0x${'ef'.repeat(32)}`;
  const failureAdapters = {
    ...adapters,
    persistence: failurePersistence,
    rpc: {
      ...adapters.rpc,
      async queryTransaction(request) {
        return {
          status: 'FINALIZED_FAILURE',
          digest: request.digest,
          epoch: currentEpoch,
          effectsFingerprint: failureEffectsFingerprint,
          eventsDigest: null,
          error: { code: 'MOVE_ABORT', message: 'MoveAbort(8)' },
        };
      },
      async readbackMarketAction() { throw new Error('failure must not run success readback'); },
    },
  };
  const failurePage = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: failureAdapters,
    marketModule,
    recoveryModule,
  });
  await failurePage.refresh();
  await failurePage.reviewQuote();
  await failurePage.prepare();
  const failureSigned = await failurePage.requestSignature('SIGN EXACT TRANSACTION');
  const finalizedFailure = await failurePage.recoverOutcome();
  assert.equal(finalizedFailure.state, 'FINALIZED_FAILURE');
  assert.equal(finalizedFailure.failure.digest, failureSigned.signed.digest);
  assert.equal(failureMemory.database.records.get('failures').size, 1);

  currentEpoch = '102';
  const failureReload = createFreshV8Controller({
    route,
    runtime,
    execution,
    adapters: failureAdapters,
    marketModule,
    recoveryModule,
  });
  await failureReload.refresh();
  assert.equal(failureReload.snapshot().status, 'FINALIZED_FAILURE');
  await failureReload.reviewQuote();
  await failureReload.prepare();
  const failureReplacement = await failurePersistence.load(scopeKey);
  assert.equal(failureReplacement.state, 'READY');
  assert.equal(failureReplacement.identityKey, failureSigned.identityKey);
  assert.equal(failureReplacement.attempt, finalizedFailure.attempt + 1);
  assert.equal(failureReplacement.revision, finalizedFailure.revision + 1);
  assert.notEqual(failureReplacement.plan.transactionDigest, finalizedFailure.failure.digest);
  assert.deepEqual(
    await failurePersistence.loadFinalizedFailure(
      failureSigned.identityKey,
      failureSigned.signed.digest,
    ),
    finalizedFailure.failure,
  );
});

test('terminal listing reload discovers purchase/cancel/recover WAL by Root before live actions', {
  skip: available ? false : 'Run with the integrated Maker v8 Market and Recovery modules.',
}, async (t) => {
  const rawRuntime = runtimeFixture();
  const runtime = (await attestMakerV8Runtime(runtimeAttestationRpc(rawRuntime), rawRuntime)).runtime;
  const data = fixture(runtime);
  const execution = {
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network: 'mainnet',
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: false,
    allowBroadcast: false,
  };
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  const cases = [
    ['purchaseMakerControl', 'SETTLED'],
    ['cancelMakerControl', 'CANCELED'],
    ['recoverMakerControl', 'RECOVERED'],
  ];
  for (const [action, listingStatus] of cases) {
    await t.test(action, async () => {
      const listingId = id(4_000 + cases.findIndex(([candidate]) => candidate === action));
      const route = parseFreshV8Route(`/market/${listingId}`);
      const identity = Object.freeze({
        chain: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        action,
        root: Object.freeze({ id: data.IDs.root }),
      });
      const plan = Object.freeze({
        transactionDigest: `${action}:immutable-digest`,
        fingerprint: `0x${'ab'.repeat(32)}`,
        market: Object.freeze({
          descriptor: Object.freeze({
            action,
            target: `${runtime.roles.market.callablePackageId}::market_v8::${action}`,
          }),
        }),
      });
      const receipt = Object.freeze({
        digest: plan.transactionDigest,
        planHash: plan.fingerprint,
        action,
      });
      let durable = Object.freeze({
        state: 'OUTCOME_PENDING',
        identity,
        plan,
        signed: Object.freeze({ digest: plan.transactionDigest }),
      });
      let cleanedTombstone = null;
      const calls = [];
      const terminalRecovery = {
        ...recoveryModule,
        createMakerV8RecoveryController() {
          return Object.freeze({
            async loadByScope(scope) {
              calls.push({ kind: 'loadByScope', scope: clone(scope) });
              assert.deepEqual(scope, {
                chain: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
                rootId: data.IDs.root,
              });
              return durable;
            },
            async load(requestIdentity) {
              calls.push({ kind: 'load', identity: clone(requestIdentity) });
              assert.deepEqual(requestIdentity, identity);
              return durable;
            },
            async loadReceipt(requestIdentity) {
              calls.push({ kind: 'loadReceipt', identity: clone(requestIdentity) });
              return cleanedTombstone ? receipt : null;
            },
            async recover(requestIdentity, options) {
              calls.push({ kind: 'recover', identity: clone(requestIdentity), options: clone(options) });
              assert.deepEqual(requestIdentity, identity);
              assert.deepEqual(options, { replayIfNotFound: false });
              durable = Object.freeze({ ...durable, state: 'VERIFIED', receipt });
              return durable;
            },
            async cleanupVerified(requestIdentity) {
              calls.push({ kind: 'cleanup', identity: clone(requestIdentity) });
              assert.deepEqual(requestIdentity, identity);
              assert.equal(durable.state, 'VERIFIED');
              cleanedTombstone = Object.freeze({ state: 'CLEANED', identity, receipt });
              durable = null;
              return receipt;
            },
          });
        },
      };
      let actionContextReads = 0;
      const terminalAdapters = {
          persistence: {
            async load() {
              calls.push({ kind: 'loadTombstone' });
              return cleanedTombstone;
            },
          },
          rpc: {
            async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
            async getSuiClient() { return runtimeAttestationRpc(runtime); },
            async browseMarket() { throw new Error('not used'); },
            async loadRoute(request) {
              return {
                schemaVersion: WEB_V8_ROUTE_SCHEMA,
                source: 'LIVE_RPC',
                requestId: request.requestId,
                chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
                route: `listing:${listingId}`,
                activation: { eventType, rootId: data.IDs.root, lifecycle: 'ACTIVE' },
                view: {
                  title: 'Terminal listing',
                  subtitle: 'No live action remains after finality.',
                  lifecycle: 'PAUSED',
                  listingKind: 'MAKER',
                  listingStatus,
                },
                availableActions: [],
              };
            },
            async loadActionContext() {
              actionContextReads += 1;
              throw new Error('terminal listing must recover without live action context');
            },
            async loadOwnedInventory() {
              throw new Error('terminal listing must recover without wallet inventory');
            },
            async queryTransaction() { throw new Error('owned by recovery boundary'); },
            async readbackMarketAction() { throw new Error('owned by recovery boundary'); },
          },
          wallet: {
            async getCurrentAccount() { return data.wallet; },
            async reconnect() { return data.wallet; },
            async signExactTransaction() { throw new Error('not used'); },
            async verifyExactSignature() { throw new Error('not used'); },
          },
          transactions: {
            async buildExactTransaction() { throw new Error('not used'); },
            async deriveTransactionDigest() { throw new Error('not used'); },
            async dryRunExactTransaction() { throw new Error('not used'); },
            async broadcastExactTransaction() { throw new Error('not used'); },
          },
        };
      const createTerminalPage = () => createFreshV8Controller({
        route,
        runtime,
        execution,
        adapters: terminalAdapters,
        marketModule,
        recoveryModule: terminalRecovery,
      });
      const controller = createTerminalPage();
      await controller.refresh();
      assert.equal(controller.snapshot().status, 'OUTCOME_PENDING');
      assert.equal(controller.snapshot().action.id, action);
      assert.deepEqual(controller.snapshot().availableActions, []);
      assert.equal(actionContextReads, 0);
      const cleaned = await controller.recoverOutcome();
      assert.deepEqual(cleaned, { state: 'CLEANED', receipt });
      assert.equal(controller.snapshot().status, 'CLEANED');
      assert.deepEqual(calls.map((entry) => entry.kind), [
        'loadByScope', 'load', 'recover', 'cleanup',
      ]);
      const cleanedReload = createTerminalPage();
      await cleanedReload.refresh();
      assert.equal(cleanedReload.snapshot().status, 'CLEANED');
      assert.equal(cleanedReload.snapshot().action.id, action);
      assert.deepEqual(cleanedReload.snapshot().completionReceipt, receipt);
      assert.equal(actionContextReads, 0);
      assert.deepEqual(calls.slice(-3).map((entry) => entry.kind), [
        'loadByScope', 'loadTombstone', 'loadReceipt',
      ]);
    });
  }
});
