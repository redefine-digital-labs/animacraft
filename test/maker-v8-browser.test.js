import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import {
  SUI_MAINNET_CHAIN,
  StandardConnect,
  StandardEvents,
  SuiSignTransaction,
} from '@mysten/wallet-standard';

import {
  MAKER_V8_OFFICIAL_MAINNET_RPC_URL,
  createProductionMakerV8BrowserAdapters,
  createWalletStandardConnectorV8,
  readFinalizedMakerV8EnvelopeV8,
} from '../maker-v8-browser.js';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';

const planHash = `0x${'ab'.repeat(32)}`;
const finalizedTransactionBytes = toBase64(new Uint8Array([4, 5]));

const objectId = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const packageId = objectId;
const suiDigest = '11111111111111111111111111111111';
const mainnetExecution = (overrides = {}) => ({
  network: 'mainnet',
  chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  allowWalletSignature: false,
  allowBroadcast: false,
  ...overrides,
});

function walletHarness(keypair, onSign = null) {
  let changeListener = null;
  let signCalls = 0;
  const account = {
    address: keypair.toSuiAddress(),
    chains: [SUI_MAINNET_CHAIN],
    features: [SuiSignTransaction],
    publicKey: keypair.getPublicKey().toRawBytes(),
  };
  const wallet = {
    id: 'fake-wallet',
    name: 'Fake Wallet',
    version: '1.0.0',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    chains: [SUI_MAINNET_CHAIN],
    accounts: [account],
    features: {
      [StandardConnect]: {
        version: '1.0.0',
        connect: async () => ({ accounts: wallet.accounts }),
      },
      [StandardEvents]: {
        version: '1.0.0',
        on(_event, listener) {
          changeListener = listener;
          return () => { changeListener = null; };
        },
      },
      [SuiSignTransaction]: {
        version: '2.0.0',
        async signTransaction({ transaction }) {
          signCalls += 1;
          await onSign?.({ wallet, emit: (properties) => changeListener?.(properties) });
          return keypair.signTransaction(await transaction.build());
        },
      },
    },
  };
  const registryListeners = new Map();
  const registry = {
    get: () => [wallet],
    on(event, listener) {
      registryListeners.set(event, listener);
      return () => registryListeners.delete(event);
    },
  };
  return { wallet, account, registry, get signCalls() { return signCalls; } };
}

function exactBytes(keypair) {
  return TransactionDataBuilder.restore({
    version: 2,
    sender: keypair.toSuiAddress(),
    expiration: { Epoch: '101' },
    gasData: {
      budget: '1000',
      price: '1',
      owner: keypair.toSuiAddress(),
      payment: [],
    },
    inputs: [],
    commands: [],
  }).build();
}

function dataSourceStub() {
  return {
    resolveRoleLineages: async () => ({}),
    loadRoute: async () => ({ route: true }),
    browseMarket: async () => ({ source: 'FAKE_PUBLIC' }),
    loadActionContext: async () => ({ context: true }),
    queryTransaction: async () => ({ status: 'NOT_FOUND' }),
    readbackMarketAction: async () => ({ receipt: true }),
  };
}

function buildClient({ chainIds = [MAKER_V8_MAINNET_CHAIN_IDENTIFIER] } = {}) {
  let chainIndex = 0;
  let dryRuns = 0;
  let broadcasts = 0;
  return {
    core: {
      getCurrentSystemState: async () => ({ systemState: { epoch: '100' } }),
      resolveTransactionPlugin: () => async (data, _options, next) => {
        data.gasData.owner = data.sender;
        data.gasData.budget = '1000';
        data.gasData.price = '1';
        data.gasData.payment = [];
        await next();
      },
    },
    async getChainIdentifier() {
      return chainIds[Math.min(chainIndex++, chainIds.length - 1)];
    },
    async dryRunTransactionBlock() {
      dryRuns += 1;
      return { effects: { status: { status: 'success' } } };
    },
    async executeTransactionBlock({ transactionBlock }) {
      broadcasts += 1;
      return { digest: TransactionDataBuilder.getDigestFromBytes(fromBase64(transactionBlock)) };
    },
    get dryRuns() { return dryRuns; },
    get broadcasts() { return broadcasts; },
  };
}

test('real browser module import and production factory never consult an injected adapter global', async () => {
  Object.defineProperty(globalThis, 'SoulidityV8Adapters', {
    configurable: true,
    get() { throw new Error('legacy adapter global was consulted'); },
  });
  try {
    const module = await import(`../maker-v8-browser.js?fresh=${Date.now()}`);
    assert.equal(typeof module.createProductionMakerV8BrowserAdapters, 'function');
    assert.equal(MAKER_V8_OFFICIAL_MAINNET_RPC_URL, 'https://fullnode.mainnet.sui.io:443');
    const keypair = new Ed25519Keypair();
    const harness = walletHarness(keypair);
    const adapters = module.createProductionMakerV8BrowserAdapters({
      execution: mainnetExecution(),
      client: buildClient(),
      walletRegistry: harness.registry,
      dataSource: dataSourceStub(),
    });
    assert.equal((await adapters.rpc.browseMarket({})).source, 'FAKE_PUBLIC');
  } finally {
    delete globalThis.SoulidityV8Adapters;
  }
});

test('false execution gates permit public browse, canonical build, and dry-run but never sign or broadcast', async () => {
  const keypair = new Ed25519Keypair();
  const harness = walletHarness(keypair);
  const client = buildClient();
  const adapters = createProductionMakerV8BrowserAdapters({
    execution: mainnetExecution(),
    client,
    walletRegistry: harness.registry,
    dataSource: dataSourceStub(),
  });
  assert.equal((await adapters.rpc.browseMarket({})).source, 'FAKE_PUBLIC');
  const descriptor = Object.freeze({
    schema: 'animacraft.market-action.v8',
    action: 'listMakerControl',
    network: 'mainnet',
    sender: keypair.toSuiAddress(),
    target: `${packageId(9)}::market_v8::list_maker_control`,
    typeArguments: [],
    arguments: [],
    rootId: objectId(1), registryId: objectId(2), treasuryId: objectId(3),
    protocolRevision: '1', preState: {},
  });
  const built = await adapters.transactions.buildExactTransaction({ descriptor });
  assert.equal(adapters.transactions.deriveTransactionDigest(built.transactionBytes), built.transactionDigest);
  assert.deepEqual(
    await adapters.transactions.dryRunExactTransaction({
      transactionBytes: built.transactionBytes,
      descriptor,
    }),
    { status: 'SUCCESS' },
  );
  await assert.rejects(
    adapters.wallet.signExactTransaction({
      bytes: built.transactionBytes,
      digest: built.transactionDigest,
      signer: keypair.toSuiAddress(),
    }),
    { code: 'WEB_V8_SIGNING_DISABLED' },
  );
  await assert.rejects(
    adapters.transactions.broadcastExactTransaction({
      bytes: built.transactionBytes,
      digest: built.transactionDigest,
      signer: keypair.toSuiAddress(),
      signature: 'not-reached',
    }),
    { code: 'WEB_V8_BROADCAST_DISABLED' },
  );
  assert.equal(harness.signCalls, 0);
  assert.equal(client.broadcasts, 0);
  assert.equal(client.dryRuns, 1);
});

test('Wallet Standard returns the exact bytes and fails closed on account or RPC network drift', async () => {
  const keypair = new Ed25519Keypair();
  const raw = exactBytes(keypair);
  const bytes = toBase64(raw);
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(raw);
  const stableHarness = walletHarness(keypair);
  const stable = createWalletStandardConnectorV8({
    registry: stableHarness.registry,
    execution: mainnetExecution({ allowWalletSignature: true }),
    client: buildClient(),
  });
  const signed = await stable.signExactTransaction({
    bytes, digest: transactionDigest, signer: keypair.toSuiAddress(),
  });
  assert.equal(signed.bytes, bytes);
  assert.equal(signed.digest, transactionDigest);
  assert.equal((await stable.verifyExactSignature({ ...signed, signer: keypair.toSuiAddress() })).bytes, bytes);

  const broadcastClient = buildClient();
  const broadcastHarness = walletHarness(keypair);
  const enabled = createProductionMakerV8BrowserAdapters({
    execution: mainnetExecution({ allowWalletSignature: true, allowBroadcast: true }),
    client: broadcastClient,
    walletRegistry: broadcastHarness.registry,
    dataSource: dataSourceStub(),
  });
  const enabledSignature = await enabled.wallet.signExactTransaction({
    bytes, digest: transactionDigest, signer: keypair.toSuiAddress(),
  });
  assert.deepEqual(await enabled.transactions.broadcastExactTransaction({
    ...enabledSignature,
    signer: keypair.toSuiAddress(),
  }), { digest: transactionDigest, accepted: true });
  assert.equal(broadcastClient.broadcasts, 1);

  const replacement = new Ed25519Keypair();
  const accountDrift = walletHarness(keypair, async ({ wallet, emit }) => {
    const next = {
      address: replacement.toSuiAddress(), chains: [SUI_MAINNET_CHAIN],
      features: [SuiSignTransaction], publicKey: replacement.getPublicKey().toRawBytes(),
    };
    wallet.accounts = [next];
    emit({ accounts: [next] });
  });
  const driftConnector = createWalletStandardConnectorV8({
    registry: accountDrift.registry,
    execution: mainnetExecution({ allowWalletSignature: true }),
    client: buildClient(),
  });
  await assert.rejects(
    driftConnector.signExactTransaction({
      bytes, digest: transactionDigest, signer: keypair.toSuiAddress(),
    }),
    { code: 'MAKER_V8_BROWSER_ACCOUNT_DRIFT' },
  );

  const networkDrift = createWalletStandardConnectorV8({
    registry: walletHarness(keypair).registry,
    execution: mainnetExecution({ allowWalletSignature: true }),
    client: buildClient({ chainIds: [MAKER_V8_MAINNET_CHAIN_IDENTIFIER, 'testnet-drift'] }),
  });
  await assert.rejects(
    networkDrift.signExactTransaction({
      bytes, digest: transactionDigest, signer: keypair.toSuiAddress(),
    }),
    { code: 'MAKER_V8_BROWSER_NETWORK_DRIFT' },
  );
});

test('Core V2 readback binds exact effects refs, historical snapshots, input call, and events digest', async () => {
  const effectsBytes = new Uint8Array([1, 2, 3]);
  const effectsFingerprint = `0x${createHash('sha256').update(effectsBytes).digest('hex')}`;
  const ids = {
    root: objectId(11), registry: objectId(12), treasury: objectId(13), listing: objectId(14),
  };
  const types = Object.fromEntries(Object.entries(ids).map(([role, value]) => [
    value,
    `${packageId(9)}::market_v8::${role[0].toUpperCase()}${role.slice(1)}V8`,
  ]));
  const owner = { $kind: 'Shared', Shared: { initialSharedVersion: '1' } };
  const outputOwner = { $kind: 'AddressOwner', AddressOwner: objectId(99) };
  const changed = (object, inputVersion, outputVersion, idOperation = 'None', chosenOwner = owner) => ({
    objectId: object,
    inputState: inputVersion ? 'Exists' : 'DoesNotExist',
    inputVersion: inputVersion ?? null,
    inputDigest: inputVersion ? suiDigest : null,
    inputOwner: inputVersion ? chosenOwner : null,
    outputState: 'ObjectWrite',
    outputVersion,
    outputDigest: suiDigest,
    outputOwner: chosenOwner,
    idOperation,
  });
  const past = new Map();
  const remember = (object, version, fields, previousTransaction = 'previous-digest') => {
    past.set(`${object}:${version}`, {
      status: 'VersionFound',
      details: {
        objectId: object, version, digest: suiDigest, type: types[object], owner,
        previousTransaction,
        content: { dataType: 'moveObject', type: types[object], fields },
      },
    });
  };
  remember(ids.root, '7', { control_epoch: '4' });
  remember(ids.registry, '5', { revision: '9' });
  remember(ids.registry, '8', { revision: '10' }, suiDigest);
  remember(ids.treasury, '5', { escrow_atomic: '0' });
  remember(ids.treasury, '8', { escrow_atomic: '0' }, suiDigest);
  remember(ids.listing, '8', { status: '0' }, suiDigest);
  past.get(`${ids.listing}:8`).details.owner = outputOwner;
  let registryInputVersion = '5';
  const client = {
    core: {
      async getTransaction() {
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: suiDigest,
            epoch: '77',
            status: { success: true, error: null },
            transaction: {
              version: 2,
              sender: objectId(99),
              commands: [{
                $kind: 'MoveCall',
                MoveCall: {
                  package: packageId(9), module: 'market_v8', function: 'list_maker_control',
                  typeArguments: [`${packageId(8)}::coin::PAY`], arguments: [],
                },
              }],
            },
            effects: {
              status: { success: true, error: null },
              transactionDigest: suiDigest,
              eventsDigest: suiDigest,
              bcs: effectsBytes,
              changedObjects: [
                changed(ids.registry, registryInputVersion, '8'), changed(ids.treasury, '5', '8'),
                changed(ids.listing, null, '8', 'Created', outputOwner),
              ],
              unchangedConsensusObjects: [{
                kind: 'ReadOnlyRoot', objectId: ids.root, version: '7', digest: suiDigest,
              }],
            },
            events: [{
              packageId: packageId(9), module: 'market_v8', sender: objectId(99),
              eventType: `${packageId(9)}::market_v8::MarketListingOpenedV8`,
              bcs: new Uint8Array([9, 8]), json: { listing_id: ids.listing },
            }],
            objectTypes: types,
            bcs: new Uint8Array([4, 5]),
          },
        };
      },
    },
    async tryGetPastObject({ id, version, options }) {
      assert.equal(typeof version, 'number');
      assert.equal(options.showPreviousTransaction, true);
      return past.get(`${id}:${version}`) ?? { status: 'VersionNotFound', details: [id, version] };
    },
  };
  const market = {
    runtime: {
      typeOrigins: {
        corePackageId: packageId(1),
        physicalPackageId: packageId(3),
        outputPackageId: packageId(2),
      },
    },
    parseEvent(event) {
      assert.equal(event.id.txDigest, suiDigest);
      return {
        kind: 'MarketListingOpenedV8',
        fields: { listingId: event.parsedJson.listing_id, lane: 0 },
      };
    },
  };
  const descriptor = {
    schema: 'animacraft.market-action.v8', action: 'listMakerControl', lane: 0,
    sender: objectId(99), target: `${packageId(9)}::market_v8::list_maker_control`,
    typeArguments: [`${packageId(8)}::coin::PAY`], arguments: [],
    rootId: ids.root, registryId: ids.registry, treasuryId: ids.treasury,
    preState: { action: 'listMakerControl', lane: 0 },
  };
  const recoveryIdentity = (action = 'LISTMAKERCONTROL') => ({
    action,
    wallet: descriptor.sender,
    root: { id: ids.root },
    registry: { id: ids.registry },
    treasury: { id: ids.treasury },
  });
  const receipt = await readFinalizedMakerV8EnvelopeV8({
    client,
    market,
    request: {
      digest: suiDigest,
      planHash,
      outcome: {
        status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint, eventsDigest: suiDigest,
      },
      identity: recoveryIdentity(),
      plan: { fingerprint: planHash, transactionBytes: finalizedTransactionBytes, sourceSnapshot: { descriptor } },
    },
  });
  assert.equal(receipt.source, 'FINALIZED_CORE_V2');
  assert.equal(receipt.epoch, '77');
  assert.equal(receipt.planHash, planHash);
  assert.equal(receipt.effectsFingerprint, effectsFingerprint);
  assert.equal(receipt.transaction.sender, objectId(99));
  assert.equal(receipt.transaction.target, descriptor.target);
  assert.equal(receipt.effects.transactionDigest, suiDigest);
  assert.equal(receipt.effects.eventsDigest, suiDigest);
  assert.deepEqual(receipt.effects.objects.map(({ role }) => role), [
    'ROOT', 'REGISTRY', 'TREASURY', 'LISTING',
  ]);
  assert.equal(receipt.effects.objects.find(({ role }) => role === 'REGISTRY').after.ref.version, '8');
  assert.equal(receipt.effects.objects.find(({ role }) => role === 'LISTING').change, 'CREATED');

  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client,
      market,
      request: {
        digest: suiDigest,
        planHash: 'ab'.repeat(32),
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint, eventsDigest: suiDigest,
        },
        identity: recoveryIdentity(),
        plan: { fingerprint: 'ab'.repeat(32), transactionBytes: finalizedTransactionBytes, sourceSnapshot: { descriptor } },
      },
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_PLAN_HASH_INVALID',
  );

  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client,
      market,
      request: {
        digest: suiDigest,
        planHash,
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint, eventsDigest: suiDigest,
        },
        identity: recoveryIdentity('CANCELPHYSICALLISTING'),
        plan: {
          fingerprint: planHash,
          transactionBytes: finalizedTransactionBytes,
          sourceSnapshot: { descriptor: { ...descriptor, action: 'cancelPhysicalListing' } },
        },
      },
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_PHYSICAL_LANE_DRIFT',
  );

  registryInputVersion = '9007199254740992';
  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client,
      market,
      request: {
        digest: suiDigest,
        planHash,
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint, eventsDigest: suiDigest,
        },
        identity: recoveryIdentity(),
        plan: { fingerprint: planHash, transactionBytes: finalizedTransactionBytes, sourceSnapshot: { descriptor } },
      },
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_READBACK_UNAVAILABLE'
      && error.details.status === 'VERSION_OUTSIDE_JSON_RPC_SAFE_RANGE',
  );
  registryInputVersion = '5';

  past.delete(`${ids.registry}:5`);
  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client, market,
      request: {
        digest: suiDigest, planHash,
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint, eventsDigest: suiDigest,
        },
        identity: recoveryIdentity('listMakerControl'),
        plan: { fingerprint: planHash, transactionBytes: finalizedTransactionBytes, sourceSnapshot: { descriptor } },
      },
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_READBACK_UNAVAILABLE'
      && error.details.archivalRpcRequired === true,
  );
});

test('pinned SDK JSON-RPC past-object transport receives an exact safe integer version', async () => {
  const calls = [];
  const client = new SuiJsonRpcClient({
    network: 'mainnet',
    transport: {
      async request(request) {
        calls.push(request);
        return { status: 'VersionNotFound', details: [objectId(1), 7] };
      },
    },
  });
  await client.tryGetPastObject({ id: objectId(1), version: 7, options: { showContent: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sui_tryGetPastObject');
  assert.equal(calls[0].params[1], 7);
  assert.equal(typeof calls[0].params[1], 'number');
});
