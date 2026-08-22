import assert from 'node:assert/strict';
import test from 'node:test';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils';
import {
  MAKER_V8_SUI_EVENT_DISCOVERY_QUERY,
  MAKER_V8_SUI_EVENT_DISCOVERY_SOURCE,
  MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT,
  MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  MakerV8SuiGrpcTransportError,
  assertMakerV8SuiGrpcTransport,
  createMakerV8SuiGrpcTransport,
  createProductionMakerV8SuiGrpcTransport,
  isMakerV8SuiGrpcNotFoundError,
  isMakerV8SuiGrpcTransport,
} from '../maker-v8-sui-grpc.js';

const objectId = (byte) => `0x${byte.repeat(64)}`;
const digest = (byte) => toBase58(new Uint8Array(32).fill(byte));
const OWNER = objectId('1');
const PARENT = objectId('2');
const OBJECT = objectId('3');
const PACKAGE = objectId('4');
const ORIGINAL_PACKAGE = objectId('5');
const TX = digest(6);
const PREVIOUS_TX = digest(7);
const OBJECT_DIGEST = digest(8);
const PACKAGE_DIGEST = digest(9);
const CHECKPOINT_DIGEST = digest(10);
const EFFECTS_DIGEST = digest(11);
const EVENTS_DIGEST = digest(12);
const OTHER_DIGEST = digest(13);
const TYPE = `${PACKAGE}::maker_v8::MakerRootV8<0x2::sui::SUI>`;
const EVENT_TYPE = `${PACKAGE}::release_v8::MakerV8Activated`;

function moveObject(overrides = {}) {
  return {
    objectId: OBJECT,
    version: '17',
    digest: OBJECT_DIGEST,
    owner: { $kind: 'AddressOwner', AddressOwner: OWNER },
    type: TYPE,
    content: new Uint8Array([1, 2, 3]),
    previousTransaction: PREVIOUS_TX,
    objectBcs: new Uint8Array([4, 5, 6]),
    json: { id: OBJECT, version: '8' },
    display: undefined,
    ...overrides,
  };
}

function rawPackage(overrides = {}) {
  return {
    objectId: PACKAGE,
    version: 23n,
    digest: PACKAGE_DIGEST,
    owner: { kind: 4 },
    objectType: 'package',
    previousTransaction: PREVIOUS_TX,
    package: {
      storageId: PACKAGE,
      originalId: ORIGINAL_PACKAGE,
      version: 23n,
      modules: [
        { name: 'zeta', contents: new Uint8Array([9, 8]) },
        { name: 'alpha', contents: new Uint8Array([1, 2]) },
      ],
    },
    ...overrides,
  };
}

function rawHistorical(overrides = {}) {
  return {
    objectId: OBJECT,
    version: 11n,
    digest: OBJECT_DIGEST,
    owner: { kind: 2, address: PARENT },
    objectType: TYPE,
    previousTransaction: PREVIOUS_TX,
    contents: { value: new Uint8Array([21, 22]) },
    bcs: { value: new Uint8Array([23, 24]) },
    ...overrides,
  };
}

function rawTransaction(overrides = {}) {
  return {
    digest: TX,
    checkpoint: 77n,
    transaction: { digest: TX, bcs: { value: new Uint8Array([31, 32]) } },
    signatures: [{ bcs: { value: new Uint8Array([33, 34]) } }],
    effects: {
      bcs: { value: new Uint8Array([35, 36]) },
      digest: EFFECTS_DIGEST,
      status: { success: true },
      epoch: 91n,
      transactionDigest: TX,
      eventsDigest: EVENTS_DIGEST,
    },
    events: { digest: EVENTS_DIGEST, bcs: { value: new Uint8Array([37, 38]) }, events: [] },
    ...overrides,
  };
}

function graphqlEvent(sequenceNumber = 3, overrides = {}) {
  return {
    sequenceNumber,
    timestamp: '2026-08-22T00:00:00.000Z',
    eventBcs: toBase64(new Uint8Array([41, sequenceNumber])),
    transaction: { digest: TX },
    sender: { address: OWNER },
    transactionModule: { name: 'release_v8', package: { address: PACKAGE } },
    contents: {
      bcs: toBase64(new Uint8Array([42, sequenceNumber])),
      json: { root_id: OBJECT, version: '8' },
      type: { repr: EVENT_TYPE },
    },
    ...overrides,
  };
}

function fixtures() {
  const calls = [];
  const values = {
    current: moveObject(),
    rawPackage: rawPackage(),
    historical: rawHistorical(),
    transaction: rawTransaction(),
    serviceInfo: {
      chainId: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
      chain: 'mainnet',
      epoch: 91n,
      checkpointHeight: 100n,
      lowestAvailableCheckpoint: 4n,
      lowestAvailableCheckpointObjects: 9n,
      server: 'fixture-grpc/2.20.2',
    },
    checkpoint: { sequenceNumber: 100n, digest: CHECKPOINT_DIGEST },
    protocolConfig: {
      protocolVersion: '130',
      featureFlags: { receive_objects: true },
      attributes: {
        object_runtime_max_num_cached_objects: '1000',
        object_runtime_max_num_store_entries: '1000',
        optional_future_limit: null,
      },
    },
    graphqlResult: {
      data: {
        chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
        events: {
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: true,
            startCursor: 'cursor-old',
            endCursor: 'cursor-new',
          },
          edges: [
            { cursor: 'edge-1', node: graphqlEvent(1) },
            { cursor: 'edge-2', node: graphqlEvent(2, { transaction: { digest: OTHER_DIGEST } }) },
          ],
        },
      },
    },
  };
  const grpcClient = {
    network: 'mainnet',
    async getObject(input) {
      calls.push(['grpc.getObject', input]);
      return { object: structuredClone(values.current) };
    },
    async listOwnedObjects(input) {
      calls.push(['grpc.listOwnedObjects', input]);
      return { objects: [structuredClone(values.current)], cursor: 'owned-next', hasNextPage: true };
    },
    async listCoins(input) {
      calls.push(['grpc.listCoins', input]);
      return {
        objects: [{
          objectId: objectId('6'), version: '19', digest: digest(14),
          owner: { $kind: 'AddressOwner', AddressOwner: OWNER },
          type: '0x2::coin::Coin<0x2::sui::SUI>', balance: '999',
        }],
        cursor: null,
        hasNextPage: false,
      };
    },
    async getBalance(input) {
      calls.push(['grpc.getBalance', input]);
      return { balance: { coinType: normalizeStructTag('0x2::sui::SUI'), balance: '999', coinBalance: '999', addressBalance: '0' } };
    },
    core: {
      async getObjects() { return { objects: [] }; },
      async listOwnedObjects(input) { return grpcClient.listOwnedObjects(input); },
      async listCoins(input) { return grpcClient.listCoins(input); },
      async getBalance(input) { return grpcClient.getBalance(input); },
      async getTransaction() { return { $kind: 'Transaction' }; },
      async getProtocolConfig() { return { protocolConfig: structuredClone(values.protocolConfig) }; },
      async getCurrentSystemState() { return { systemState: { epoch: '91' } }; },
    },
    ledgerService: {
      async getObject(input) {
        calls.push(['ledger.getObject', input]);
        const object = input.version === undefined ? values.rawPackage : values.historical;
        return { response: { object: structuredClone(object) } };
      },
      async getTransaction(input) {
        calls.push(['ledger.getTransaction', input]);
        return { response: { transaction: structuredClone(values.transaction) } };
      },
      async getServiceInfo(input) {
        calls.push(['ledger.getServiceInfo', input]);
        return { response: structuredClone(values.serviceInfo) };
      },
      async getCheckpoint(input) {
        calls.push(['ledger.getCheckpoint', input]);
        return { response: { checkpoint: structuredClone(values.checkpoint) } };
      },
    },
  };
  const graphqlClient = {
    network: 'mainnet',
    async query(input) {
      calls.push(['graphql.query', input]);
      return structuredClone(values.graphqlResult);
    },
  };
  const transport = createMakerV8SuiGrpcTransport({ grpcClient, graphqlClient });
  return { calls, values, grpcClient, graphqlClient, transport };
}

function code(expected) {
  return (error) => error instanceof MakerV8SuiGrpcTransportError && error.code === expected;
}

test('production factory is official, read-only, branded, and pinned to exact default endpoints/full genesis', () => {
  assert.equal(MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT, 'https://fullnode.mainnet.sui.io:443');
  assert.equal(MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT, 'https://graphql.mainnet.sui.io/graphql');
  assert.equal(MAKER_V8_SUI_MAINNET_GENESIS_DIGEST, '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S');
  const transport = createProductionMakerV8SuiGrpcTransport();
  assert.equal(isMakerV8SuiGrpcTransport(transport), true);
  assert.equal(assertMakerV8SuiGrpcTransport(transport), transport);
  assert.equal(transport.grpcEndpoint, MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT);
  assert.equal(transport.graphqlEndpoint, MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT);
  assert.equal(transport.chainIdentifier, MAKER_V8_SUI_MAINNET_GENESIS_DIGEST);
  assert.equal(transport.executeTransaction, undefined);
  assert.equal(transport.signAndExecuteTransaction, undefined);
  assert.equal(transport.core.executeTransaction, undefined);
  assert.equal(transport.core.simulateTransaction, undefined);
});

test('factory rejects non-Mainnet and incomplete clients while brand cannot be shape-forged', () => {
  const { grpcClient, graphqlClient } = fixtures();
  assert.throws(
    () => createMakerV8SuiGrpcTransport({ grpcClient: { ...grpcClient, network: 'testnet' }, graphqlClient }),
    code('MAKER_V8_SUI_GRPC_CLIENT_INVALID'),
  );
  assert.throws(
    () => createMakerV8SuiGrpcTransport({ grpcClient, graphqlClient: { network: 'mainnet' } }),
    code('MAKER_V8_SUI_GRAPHQL_CLIENT_INVALID'),
  );
  assert.equal(isMakerV8SuiGrpcTransport({
    schemaVersion: 'animacraft.maker-v8-sui-grpc.v1',
    network: 'mainnet',
    chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  }), false);
});

test('Core current Move object becomes the exact existing-parser envelope and GraphQL is not consulted', async () => {
  const { calls, transport } = fixtures();
  const response = await transport.getObject({
    id: OBJECT,
    options: { showType: true, showContent: true, showOwner: true, showBcs: true },
  });
  assert.deepEqual(response.data.content, {
    dataType: 'moveObject',
    type: normalizeStructTag(TYPE),
    fields: { id: OBJECT, version: '8' },
  });
  assert.deepEqual(response.data.owner, { AddressOwner: OWNER });
  assert.equal(response.data.bcs.bcsBytes, toBase64(new Uint8Array([1, 2, 3])));
  assert.equal(response.data.previousTransaction, PREVIOUS_TX);
  assert.deepEqual(calls.find(([name]) => name === 'grpc.getObject')[1], {
    objectId: OBJECT,
    include: { content: true, json: true, previousTransaction: true, objectBcs: true },
  });
  assert.equal(calls.some(([name]) => name === 'graphql.query'), false);
});

test('all existing-parser owner kinds normalize exactly and unsupported Core owner kinds fail closed', async () => {
  const accepted = [
    [{ $kind: 'AddressOwner', AddressOwner: OWNER }, { AddressOwner: OWNER }],
    [{ $kind: 'ObjectOwner', ObjectOwner: PARENT }, { ObjectOwner: PARENT }],
    [{ $kind: 'Shared', Shared: { initialSharedVersion: '5' } }, { Shared: { initial_shared_version: '5' } }],
    [{ $kind: 'Immutable', Immutable: true }, { Immutable: true }],
  ];
  for (const [owner, expected] of accepted) {
    const fixture = fixtures();
    fixture.values.current.owner = owner;
    assert.deepEqual((await fixture.transport.getObject({ id: OBJECT, options: { showContent: true } })).data.owner, expected);
  }
  for (const owner of [
    { $kind: 'ConsensusAddressOwner', ConsensusAddressOwner: { owner: OWNER, startVersion: '5' } },
    { $kind: 'Unknown' },
  ]) {
    const fixture = fixtures();
    fixture.values.current.owner = owner;
    await assert.rejects(
      fixture.transport.getObject({ id: OBJECT, options: { showContent: true } }),
      code('MAKER_V8_SUI_GRPC_OWNER_UNSUPPORTED'),
    );
  }
});

test('raw package modules become a sorted canonical moduleMap and duplicate names are rejected', async () => {
  const fixture = fixtures();
  fixture.values.current = moveObject({
    objectId: PACKAGE,
    version: '23',
    digest: PACKAGE_DIGEST,
    owner: { $kind: 'Immutable', Immutable: true },
    type: 'package',
    json: null,
  });
  const response = await fixture.transport.getObject({ id: PACKAGE, options: { showBcs: true, showOwner: true } });
  assert.deepEqual(Object.keys(response.data.bcs.moduleMap), ['alpha', 'zeta']);
  assert.equal(response.data.bcs.moduleMap.alpha, toBase64(new Uint8Array([1, 2])));
  assert.equal(response.data.bcs.dataType, 'package');
  assert.deepEqual(response.data.owner, { Immutable: true });
  const rawCall = fixture.calls.find(([name]) => name === 'ledger.getObject')[1];
  assert.equal(rawCall.version, undefined);
  assert.ok(rawCall.readMask.paths.includes('package'));

  fixture.values.rawPackage.package.modules.push({ name: 'alpha', contents: new Uint8Array([99]) });
  await assert.rejects(
    fixture.transport.getObject({ id: PACKAGE, options: { showBcs: true } }),
    code('MAKER_V8_SUI_GRPC_PACKAGE_MODULE_DUPLICATE'),
  );
});

test('package Core/raw identity drift is rejected', async () => {
  const fixture = fixtures();
  fixture.values.current = moveObject({
    objectId: PACKAGE,
    version: '23',
    digest: PACKAGE_DIGEST,
    owner: { $kind: 'Immutable', Immutable: true },
    type: 'package',
    json: null,
  });
  fixture.values.rawPackage.digest = OTHER_DIGEST;
  await assert.rejects(
    fixture.transport.getObject({ id: PACKAGE, options: { showBcs: true } }),
    code('MAKER_V8_SUI_GRPC_PACKAGE_DRIFT'),
  );
});

test('owned objects, coins, balance, current epoch, and protocol string|null shapes are exact', async () => {
  const fixture = fixtures();
  const owned = await fixture.transport.getOwnedObjects({
    owner: OWNER,
    filter: { StructType: TYPE },
    options: { showContent: true, showOwner: true },
    cursor: null,
    limit: 25,
  });
  assert.equal(owned.data[0].data.objectId, OBJECT);
  assert.equal(owned.nextCursor, 'owned-next');
  assert.equal(owned.hasNextPage, true);

  const coins = await fixture.transport.getCoins({ owner: OWNER, coinType: '0x2::sui::SUI' });
  assert.equal(coins.data[0].coinType, normalizeStructTag('0x2::sui::SUI'));
  assert.equal(coins.data[0].balance, '999');
  assert.deepEqual(await fixture.transport.getBalance({ owner: OWNER }), {
    balance: { coinType: normalizeStructTag('0x2::sui::SUI'), balance: '999', coinBalance: '999', addressBalance: '0' },
  });
  assert.deepEqual(await fixture.transport.getLatestSuiSystemState(), { epoch: '91' });
  assert.deepEqual(await fixture.transport.getProtocolConfig(), {
    protocolVersion: '130',
    featureFlags: { receive_objects: true },
    attributes: {
      object_runtime_max_num_cached_objects: { u64: '1000' },
      object_runtime_max_num_store_entries: { u64: '1000' },
      optional_future_limit: null,
    },
  });

  fixture.values.protocolConfig.attributes.optional_future_limit = 1000;
  await assert.rejects(fixture.transport.getProtocolConfig(), code('MAKER_V8_SUI_GRPC_DECIMAL_INVALID'));
  await assert.rejects(
    fixture.transport.getOwnedObjects({ owner: OWNER, filter: { MatchAll: [] } }),
    code('MAKER_V8_SUI_GRPC_OWNED_FILTER_INVALID'),
  );
});

test('historical object uses an exact bigint version and rejects history drift', async () => {
  const fixture = fixtures();
  const historical = await fixture.transport.getHistoricalObject({ objectId: OBJECT, version: 11n });
  assert.equal(historical.objectId, OBJECT);
  assert.equal(historical.version, '11');
  assert.equal(historical.previousTransaction, PREVIOUS_TX);
  assert.deepEqual([...historical.contentBcs], [21, 22]);
  const call = fixture.calls.find(([name]) => name === 'ledger.getObject')[1];
  assert.equal(typeof call.version, 'bigint');
  assert.equal(call.version, 11n);
  assert.ok(call.readMask.paths.includes('previous_transaction'));

  fixture.values.historical.version = 12n;
  await assert.rejects(
    fixture.transport.getHistoricalObject({ objectId: OBJECT, version: 11n }),
    code('MAKER_V8_SUI_GRPC_HISTORY_DRIFT'),
  );
  await assert.rejects(
    fixture.transport.getHistoricalObject({ objectId: OBJECT, version: '11' }),
    code('MAKER_V8_SUI_GRPC_UINT64_INVALID'),
  );
});

test('typed RpcError NOT_FOUND remains distinguishable and is never converted into generic absence', async () => {
  const fixture = fixtures();
  const notFound = new RpcError('historical object not found', 'NOT_FOUND');
  fixture.grpcClient.ledgerService.getObject = async () => { throw notFound; };
  assert.equal(isMakerV8SuiGrpcNotFoundError(notFound), true);
  assert.equal(isMakerV8SuiGrpcNotFoundError(new RpcError('unavailable', 'UNAVAILABLE')), false);
  await assert.rejects(
    fixture.transport.getHistoricalObject({ objectId: OBJECT, version: 11n }),
    (error) => error === notFound,
  );
});

test('raw finalized transaction evidence binds checkpoint, transaction/signature/effects/events BCS and digests', async () => {
  const fixture = fixtures();
  const evidence = await fixture.transport.getFinalizedTransactionEvidence({ digest: TX });
  assert.equal(evidence.chainIdentifier, MAKER_V8_SUI_MAINNET_GENESIS_DIGEST);
  assert.equal(evidence.checkpoint, '77');
  assert.equal(evidence.epoch, '91');
  assert.equal(evidence.transactionBcsBase64, toBase64(new Uint8Array([31, 32])));
  assert.deepEqual(evidence.signatures, [toBase64(new Uint8Array([33, 34]))]);
  assert.equal(evidence.effectsBcsBase64, toBase64(new Uint8Array([35, 36])));
  assert.equal(evidence.effectsDigest, EFFECTS_DIGEST);
  assert.equal(evidence.eventsDigest, EVENTS_DIGEST);
  assert.equal(evidence.transactionEvents.digest, EVENTS_DIGEST);
  assert.deepEqual([...evidence.transactionEvents.bcs], [37, 38]);
  const call = fixture.calls.find(([name]) => name === 'ledger.getTransaction')[1];
  assert.ok(call.readMask.paths.includes('checkpoint'));
  assert.ok(call.readMask.paths.includes('transaction.bcs'));
  assert.ok(call.readMask.paths.includes('signatures'));
  assert.ok(call.readMask.paths.includes('effects.bcs'));
  assert.ok(call.readMask.paths.includes('events.bcs'));

  fixture.values.transaction.effects.eventsDigest = OTHER_DIGEST;
  await assert.rejects(
    fixture.transport.getFinalizedTransactionEvidence({ digest: TX }),
    code('MAKER_V8_SUI_GRPC_EVENTS_DRIFT'),
  );
});

test('getServiceInfo/getCheckpoint watermark primitives pin full genesis and exact latest checkpoint', async () => {
  const fixture = fixtures();
  assert.deepEqual(await fixture.transport.getChainIdentifier(), {
    chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  });
  const info = await fixture.transport.getServiceInfo();
  assert.equal(info.checkpointHeight, '100');
  assert.equal(info.lowestAvailableCheckpointObjects, '9');
  assert.deepEqual(await fixture.transport.getCheckpoint({ sequenceNumber: 100n }), {
    sequenceNumber: '100', digest: CHECKPOINT_DIGEST,
  });
  assert.deepEqual(await fixture.transport.getCheckpointWatermark(), {
    schemaVersion: 'animacraft.maker-v8-sui-grpc.v1',
    chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
    epoch: '91',
    checkpoint: { sequenceNumber: '100', digest: CHECKPOINT_DIGEST },
    lowestAvailableCheckpoint: '4',
    lowestAvailableCheckpointObjects: '9',
  });
  const checkpointCalls = fixture.calls.filter(([name]) => name === 'ledger.getCheckpoint');
  assert.equal(checkpointCalls.at(-1)[1].checkpointId.sequenceNumber, 100n);

  fixture.values.serviceInfo.chainId = '35834a8a';
  await assert.rejects(fixture.transport.getServiceInfo(), code('MAKER_V8_SUI_GRPC_CHAIN_MISMATCH'));
});

test('GraphQL is used only for indexed Move-event discovery with strict descending pagination normalization', async () => {
  const fixture = fixtures();
  const page = await fixture.transport.queryEvents({
    query: { MoveEventType: EVENT_TYPE },
    cursor: null,
    limit: 2,
    order: 'descending',
  });
  assert.equal(page.hasNextPage, true);
  assert.equal(page.nextCursor, 'cursor-old');
  assert.deepEqual(page.data.map((event) => event.id.eventSeq), ['2', '1']);
  assert.deepEqual(page.data.map((event) => event.id.txDigest), [OTHER_DIGEST, TX]);
  assert.equal(page.data[0].type, normalizeStructTag(EVENT_TYPE));
  assert.equal(page.data[0].discoverySource, MAKER_V8_SUI_EVENT_DISCOVERY_SOURCE);
  assert.equal(page.data[0].timestampMs, String(Date.parse('2026-08-22T00:00:00.000Z')));
  const query = fixture.calls.find(([name]) => name === 'graphql.query')[1];
  assert.equal(query.query, MAKER_V8_SUI_EVENT_DISCOVERY_QUERY);
  assert.deepEqual(query.variables, {
    first: null,
    after: null,
    last: 2,
    before: null,
    filter: { type: normalizeStructTag(EVENT_TYPE) },
  });
  assert.equal(typeof fixture.transport.getGraphQLObject, 'undefined');
  assert.equal(typeof fixture.transport.getGraphQLTransaction, 'undefined');
});

test('GraphQL discovery rejects event type drift, malformed shapes, duplicates, and non-event filters', async () => {
  const drift = fixtures();
  drift.values.graphqlResult.data.events.edges[0].node.contents.type.repr = `${PACKAGE}::release_v8::OtherEvent`;
  await assert.rejects(
    drift.transport.discoverEvents({ type: EVENT_TYPE }),
    code('MAKER_V8_SUI_GRAPHQL_EVENT_DRIFT'),
  );

  const malformed = fixtures();
  malformed.values.graphqlResult.data.events.edges[0].node.transaction = null;
  await assert.rejects(
    malformed.transport.discoverEvents({ type: EVENT_TYPE }),
    code('MAKER_V8_SUI_GRAPHQL_EVENT_INVALID'),
  );

  const wrongChain = fixtures();
  wrongChain.values.graphqlResult.data.chainIdentifier = '35834a8a';
  await assert.rejects(
    wrongChain.transport.discoverEvents({ type: EVENT_TYPE }),
    code('MAKER_V8_SUI_GRAPHQL_CHAIN_MISMATCH'),
  );

  const duplicate = fixtures();
  duplicate.values.graphqlResult.data.events.edges[1].node = structuredClone(
    duplicate.values.graphqlResult.data.events.edges[0].node,
  );
  await assert.rejects(
    duplicate.transport.discoverEvents({ type: EVENT_TYPE }),
    code('MAKER_V8_SUI_GRAPHQL_EVENT_DUPLICATE'),
  );

  await assert.rejects(
    fixtures().transport.queryEvents({ query: { Sender: OWNER } }),
    code('MAKER_V8_SUI_GRAPHQL_FILTER_INVALID'),
  );
});

test('transport source contains no JSON-RPC fallback or nonexistent 2.20.2 listEvents/listTransactions APIs', async () => {
  assert.doesNotMatch(MAKER_V8_SUI_EVENT_DISCOVERY_QUERY, /mutation|object\s*\(|transaction\s*\(/i);
  const transport = fixtures().transport;
  assert.equal('rpcUrl' in transport, false);
  assert.equal('jsonRpcClient' in transport, false);
  assert.equal('listEvents' in transport, false);
  assert.equal('listTransactions' in transport, false);
});
