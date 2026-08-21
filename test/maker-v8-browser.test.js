import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { bcs } from '@mysten/sui/bcs';
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
  decodeMakerV8CoreEventV8,
  makerV8TransactionEventsDigestV8,
  readFinalizedMakerV8EnvelopeV8,
} from '../maker-v8-browser.js';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';

const planHash = `0x${'ab'.repeat(32)}`;
const finalizedTransactionBytes = toBase64(new Uint8Array([4, 5]));

const objectId = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const packageId = objectId;
const suiDigest = '11111111111111111111111111111111';
const listingOpenedEventBcs = bcs.struct('MarketListingOpenedV8Test', {
  listing_id: bcs.Address,
  registry_id: bcs.Address,
  lane: bcs.u8(),
  root_id: bcs.Address,
  asset_id: bcs.Address,
  seller: bcs.Address,
  ownership_epoch: bcs.u64(),
  gross_atomic: bcs.u64(),
  quote_commitment: bcs.vector(bcs.u8()),
});
const listingSettledEventBcs = bcs.struct('MarketListingSettledV8Test', {
  listing_id: bcs.Address,
  registry_id: bcs.Address,
  lane: bcs.u8(),
  asset_id: bcs.Address,
  seller: bcs.Address,
  buyer: bcs.Address,
  gross_atomic: bcs.u64(),
  protocol_atomic: bcs.u64(),
  creator_atomic: bcs.u64(),
  source_atomic: bcs.u64(),
  seller_atomic: bcs.u64(),
});
const listingClosedEventBcs = bcs.struct('MarketListingClosedV8Test', {
  listing_id: bcs.Address,
  registry_id: bcs.Address,
  lane: bcs.u8(),
  asset_id: bcs.Address,
  seller: bcs.Address,
  recovered: bcs.bool(),
});
const makerTransferredEventBcs = bcs.struct('MakerControlTransferredV8Test', {
  root_id: bcs.Address,
  previous_owner: bcs.Address,
  new_owner: bcs.Address,
  previous_control_epoch: bcs.u64(),
  new_control_epoch: bcs.u64(),
  new_admin_cap_id: bcs.Address,
});
const physicalTransitionEventBcs = bcs.struct('PhysicalMarketCustodyTransitionV8Test', {
  action: bcs.u8(),
  listing_id: bcs.Address,
  asset_id: bcs.Address,
  source_kind: bcs.u8(),
  source_treasury_id: bcs.Address,
  previous_holder: bcs.Address,
  holder: bcs.Address,
  previous_ownership_epoch: bcs.u64(),
  ownership_epoch: bcs.u64(),
  provenance_commitment: bcs.vector(bcs.u8()),
});
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

test('five pinned fresh-v8 event layouts decode BCS as authority and reject JSON or byte drift', async () => {
  const origins = {
    marketPackageId: packageId(9),
    corePackageId: packageId(1),
    physicalPackageId: packageId(3),
  };
  const callables = {
    market: packageId(19),
    core: packageId(11),
    physical: packageId(13),
  };
  const market = {
    runtime: {
      typeOrigins: origins,
      callablePackageId: callables.market,
      sourceRuntime: {
        roles: Object.fromEntries(Object.entries(callables).map(([role, callablePackageId]) => [
          role, { callablePackageId },
        ])),
      },
    },
  };
  const commitment = Array(32).fill(7);
  const cases = [
    {
      name: 'MarketListingOpenedV8', module: 'market_v8', role: 'market', origin: 'marketPackageId',
      schema: listingOpenedEventBcs, expectedLength: 210, tamperField: 'seller',
      sha256: '347743d9998044a0fcacd76742de1ec86a3936ef26fa17314aeca66a7103aa55',
      fields: {
        listing_id: objectId(11), registry_id: objectId(12), lane: 0, root_id: objectId(13),
        asset_id: objectId(14), seller: objectId(15), ownership_epoch: '72623859790382856',
        gross_atomic: '10', quote_commitment: commitment,
      },
    },
    {
      name: 'MarketListingSettledV8', module: 'market_v8', role: 'market', origin: 'marketPackageId',
      schema: listingSettledEventBcs, expectedLength: 201, tamperField: 'buyer',
      sha256: '54680762d15a3369d6aefa6ca5e85d504953359b0ef481ef893468c1cd0f5806',
      fields: {
        listing_id: objectId(21), registry_id: objectId(22), lane: 1, asset_id: objectId(23),
        seller: objectId(24), buyer: objectId(25), gross_atomic: '10', protocol_atomic: '1',
        creator_atomic: '2', source_atomic: '3', seller_atomic: '4',
      },
    },
    {
      name: 'MarketListingClosedV8', module: 'market_v8', role: 'market', origin: 'marketPackageId',
      schema: listingClosedEventBcs, expectedLength: 130, tamperField: 'seller',
      sha256: '4a7e82ee7aa110c28e955873d532696a6cba00b3c659dcad644c04943a384cb8',
      fields: {
        listing_id: objectId(31), registry_id: objectId(32), lane: 2, asset_id: objectId(33),
        seller: objectId(34), recovered: true,
      },
    },
    {
      name: 'MakerControlTransferredV8', module: 'maker_v8', role: 'core', origin: 'corePackageId',
      schema: makerTransferredEventBcs, expectedLength: 144, tamperField: 'new_owner',
      sha256: '085ea109860a61756fc4deffec953dbe5a6fb0c3285e429e94c8b78afda2cb4e',
      fields: {
        root_id: objectId(41), previous_owner: objectId(42), new_owner: objectId(43),
        previous_control_epoch: '72623859790382856', new_control_epoch: '72623859790382857',
        new_admin_cap_id: objectId(44),
      },
    },
    {
      name: 'PhysicalMarketCustodyTransitionV8', module: 'physical_v8', role: 'physical', origin: 'physicalPackageId',
      schema: physicalTransitionEventBcs, expectedLength: 211, tamperField: 'holder',
      sha256: 'c8e7605d19b7d142f5445f8a5fdcd6838c9ba1056a7b4e93a0bb3606ef62d459',
      fields: {
        action: 2, listing_id: objectId(51), asset_id: objectId(52), source_kind: 1,
        source_treasury_id: objectId(53), previous_holder: objectId(54), holder: objectId(55),
        previous_ownership_epoch: '72623859790382856', ownership_epoch: '72623859790382857',
        provenance_commitment: commitment,
      },
    },
  ];
  const decode = (entry, bytes, json) => decodeMakerV8CoreEventV8({
    event: {
      packageId: callables[entry.role],
      module: entry.module,
      sender: objectId(99),
      eventType: `${origins[entry.origin]}::${entry.module}::${entry.name}`,
      bcs: bytes,
      json,
    },
    transactionDigest: suiDigest,
    eventsDigest: suiDigest,
    market,
  });
  for (const entry of cases) {
    const bytes = entry.schema.serialize(entry.fields).toBytes();
    assert.equal(bytes.length, entry.expectedLength, entry.name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.name} fixture`);
    const withoutJson = decode(entry, bytes, null);
    assert.equal(withoutJson.type, `${origins[entry.origin]}::${entry.module}::${entry.name}`);
    assert.equal(withoutJson.parsedJson[entry.tamperField], entry.fields[entry.tamperField]);
    assert.doesNotThrow(() => decode(entry, bytes, entry.fields));
    await assert.rejects(
      async () => decode(entry, bytes, {
        ...entry.fields,
        [entry.tamperField]: objectId(999),
      }),
      (error) => error.code === 'MAKER_V8_BROWSER_EVENT_JSON_BCS_DRIFT',
    );
    await assert.rejects(
      async () => decode(entry, Uint8Array.from([...bytes, 0]), null),
      (error) => error.code === 'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
    );
    await assert.rejects(
      async () => decode(entry, bytes.slice(0, -1), null),
      (error) => error.code === 'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
    );
  }

  const closed = listingClosedEventBcs.serialize(cases[2].fields).toBytes();
  closed[closed.length - 1] = 2;
  assert.throws(
    () => decode(cases[2], closed, null),
    (error) => error.code === 'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
  );

  const opened = listingOpenedEventBcs.serialize(cases[0].fields).toBytes();
  assert.throws(
    () => decodeMakerV8CoreEventV8({
      event: {
        packageId: origins.marketPackageId,
        module: 'market_v8',
        sender: objectId(99),
        eventType: `${origins.marketPackageId}::market_v8::MarketListingOpenedV8`,
        bcs: opened,
        json: null,
      },
      transactionDigest: suiDigest,
      eventsDigest: suiDigest,
      market,
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_EVENT_ORIGIN_DRIFT',
  );
  const commitmentLengthOffset = opened.length - 33;
  assert.equal(opened[commitmentLengthOffset], 32);
  const noncanonicalLength = Uint8Array.from([
    ...opened.slice(0, commitmentLengthOffset), 0xa0, 0x00, ...opened.slice(commitmentLengthOffset + 1, -1),
  ]);
  assert.equal(noncanonicalLength.length, opened.length);
  assert.throws(
    () => decode(cases[0], noncanonicalLength, null),
    (error) => error.code === 'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
  );
});

test('official Sui RPC TransactionEvents vector pins BCS, typed Blake2b, and base58 digest', () => {
  // Public Sui response captured in MystenLabs/sui#20877.  This independently
  // pins the Rust TransactionEvents digest, rather than comparing two copies
  // of this repository's implementation.
  const event = {
    packageId: '0x9a84b6a7914aedd6741e73cc2ca23cbc77e22ed3c5f884c072a51868fedde45b',
    module: 'hyperspace',
    sender: '0x36a05394e882fb4160790c9214c7f00438e6a11ef07c5ace2ad818d34cda575e',
    eventType: '0x9a84b6a7914aedd6741e73cc2ca23cbc77e22ed3c5f884c072a51868fedde45b::hyperspace::ItemListed<0xee496a0cc04d06a345982ba6697c90c619020de9e274408c7819f787ff66e1a1::suifrens::SuiFren<0x8894fa02fc6f36cbc485ae9145d05f247a78e220814fb8419ab261bd81f08f32::bullshark::Bullshark>, 0x9a84b6a7914aedd6741e73cc2ca23cbc77e22ed3c5f884c072a51868fedde45b::hyperspace_mp::Hyperspace_mp>',
    bcs: fromBase64('n77AZQCfwqscBWLT5mazPSWlhikwVBLlav2S18M9vqZ50mowsdBPvsX3K13DdqzRQbJD1KGDz2GN9dZiDaWrsYD5iCgCAAAA'),
  };
  const observed = makerV8TransactionEventsDigestV8([event]);
  assert.equal(observed.digest, '8fpiGNxDRJm7WP3v7cEYRQRKANLvGzMCiQeoEpbMV8WZ');
  assert.equal(
    observed.bcs,
    'AZqEtqeRSu3WdB5zzCyiPLx34i7TxfiEwHKlGGj+3eRbCmh5cGVyc3BhY2U2oFOU6IL7QWB5DJIUx/AEOOahHvB8Ws4q2BjTTNpXXpqEtqeRSu3WdB5zzCyiPLx34i7TxfiEwHKlGGj+3eRbCmh5cGVyc3BhY2UKSXRlbUxpc3RlZAIH7klqDMBNBqNFmCumaXyQxhkCDenidECMeBn3h/9m4aEIc3VpZnJlbnMHU3VpRnJlbgEHiJT6AvxvNsvEha6RRdBfJHp44iCBT7hBmrJhvYHwjzIJYnVsbHNoYXJrCUJ1bGxzaGFyawAHmoS2p5FK7dZ0HnPMLKI8vHfiLtPF+ITAcqUYaP7d5FsNaHlwZXJzcGFjZV9tcA1IeXBlcnNwYWNlX21wAEifvsBlAJ/CqxwFYtPmZrM9JaWGKTBUEuVq/ZLXwz2+pnnSajCx0E++xfcrXcN2rNFBskPUoYPPYY311mINpauxgPmIKAIAAAA=',
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
  let tamperEventJson = false;
  let tamperEventSender = false;
  let replaceEvent = false;
  const eventJson = {
    listing_id: ids.listing,
    registry_id: ids.registry,
    lane: 0,
    root_id: ids.root,
    asset_id: objectId(15),
    seller: objectId(99),
    ownership_epoch: '4',
    gross_atomic: '1000',
    quote_commitment: Array(32).fill(7),
  };
  const eventBcs = listingOpenedEventBcs.serialize(eventJson).toBytes();
  const replacementEventJson = { ...eventJson, seller: objectId(98) };
  const replacementEventBcs = listingOpenedEventBcs.serialize(replacementEventJson).toBytes();
  const eventForRpc = () => ({
    packageId: packageId(9),
    module: 'market_v8',
    sender: tamperEventSender ? objectId(98) : objectId(99),
    eventType: `${packageId(9)}::market_v8::MarketListingOpenedV8`,
    bcs: replaceEvent ? replacementEventBcs : eventBcs,
    json: replaceEvent
      ? replacementEventJson
      : tamperEventJson ? { ...eventJson, seller: objectId(98) } : eventJson,
  });
  const transactionEventsDigest = makerV8TransactionEventsDigestV8([eventForRpc()]).digest;
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
              eventsDigest: transactionEventsDigest,
              bcs: effectsBytes,
              changedObjects: [
                changed(ids.registry, registryInputVersion, '8'), changed(ids.treasury, '5', '8'),
                changed(ids.listing, null, '8', 'Created', outputOwner),
              ],
              unchangedConsensusObjects: [{
                kind: 'ReadOnlyRoot', objectId: ids.root, version: '7', digest: suiDigest,
              }],
            },
            events: [eventForRpc()],
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
        marketPackageId: packageId(9),
        physicalPackageId: packageId(3),
        outputPackageId: packageId(2),
      },
      callablePackageId: packageId(9),
      sourceRuntime: {
        roles: {
          core: { callablePackageId: packageId(1) },
          market: { callablePackageId: packageId(9) },
          physical: { callablePackageId: packageId(3) },
        },
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
        status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
        eventsDigest: transactionEventsDigest,
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
  assert.equal(receipt.effects.eventsDigest, transactionEventsDigest);
  assert.deepEqual(receipt.effects.objects.map(({ role }) => role), [
    'ROOT', 'REGISTRY', 'TREASURY', 'LISTING',
  ]);
  assert.equal(receipt.effects.objects.find(({ role }) => role === 'REGISTRY').after.ref.version, '8');
  assert.equal(receipt.effects.objects.find(({ role }) => role === 'LISTING').change, 'CREATED');

  tamperEventJson = true;
  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client,
      market,
      request: {
        digest: suiDigest,
        planHash,
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
          eventsDigest: transactionEventsDigest,
        },
        identity: recoveryIdentity(),
        plan: { fingerprint: planHash, transactionBytes: finalizedTransactionBytes, sourceSnapshot: { descriptor } },
      },
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_EVENT_JSON_BCS_DRIFT',
  );
  tamperEventJson = false;

  replaceEvent = true;
  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client,
      market,
      request: {
        digest: suiDigest,
        planHash,
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
          eventsDigest: transactionEventsDigest,
        },
        identity: recoveryIdentity(),
        plan: { fingerprint: planHash, transactionBytes: finalizedTransactionBytes, sourceSnapshot: { descriptor } },
      },
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_EVENTS_DIGEST_DRIFT',
  );
  replaceEvent = false;

  tamperEventSender = true;
  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client,
      market,
      request: {
        digest: suiDigest,
        planHash,
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
          eventsDigest: transactionEventsDigest,
        },
        identity: recoveryIdentity(),
        plan: { fingerprint: planHash, transactionBytes: finalizedTransactionBytes, sourceSnapshot: { descriptor } },
      },
    }),
    (error) => error.code === 'MAKER_V8_BROWSER_EVENTS_DIGEST_DRIFT',
  );
  tamperEventSender = false;

  await assert.rejects(
    readFinalizedMakerV8EnvelopeV8({
      client,
      market,
      request: {
        digest: suiDigest,
        planHash: 'ab'.repeat(32),
        outcome: {
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
          eventsDigest: transactionEventsDigest,
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
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
          eventsDigest: transactionEventsDigest,
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
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
          eventsDigest: transactionEventsDigest,
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
          status: 'FINALIZED_SUCCESS', epoch: '77', effectsFingerprint,
          eventsDigest: transactionEventsDigest,
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
