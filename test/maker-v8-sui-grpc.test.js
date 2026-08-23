import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { GrpcTypes } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import {
  fromBase64,
  fromHex,
  normalizeStructTag,
  toBase58,
  toBase64,
} from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
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
const SENDER_KEYPAIR = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(1));
const SPONSOR_KEYPAIR = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(2));
const ATTACKER_KEYPAIR = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(3));
const OWNER = SENDER_KEYPAIR.toSuiAddress();
const PARENT = objectId('2');
const OBJECT = objectId('3');
const PACKAGE = objectId('4');
const PREVIOUS_TX = digest(7);
const PACKAGE_DIGEST = digest(9);
const CHECKPOINT_DIGEST = digest(10);
const OTHER_DIGEST = digest(13);
const TYPE = `${PACKAGE}::maker_v8::MakerRootV8<0x2::sui::SUI>`;
const EVENT_TYPE = `${PACKAGE}::release_v8::MakerV8Activated`;

const SUI_EVENT_BCS = bcs.struct('SuiEventV8GrpcTest', {
  package_id: bcs.Address,
  transaction_module: bcs.string(),
  sender: bcs.Address,
  event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()),
});
const SUI_TRANSACTION_EVENTS_BCS = bcs.struct('SuiTransactionEventsV8GrpcTest', {
  data: bcs.vector(SUI_EVENT_BCS),
});

function typedDigest(name, value) {
  const domain = new TextEncoder().encode(`${name}::`);
  const typed = new Uint8Array(domain.length + value.length);
  typed.set(domain);
  typed.set(value, domain.length);
  return toBase58(blake2b(typed, { dkLen: 32 }));
}

function concatBytes(...values) {
  const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

const HISTORICAL_CONTENT_BCS = concatBytes(
  fromHex(OBJECT.slice(2)),
  bcs.u64().serialize('8').toBytes(),
);
const HISTORICAL_OBJECT_BCS = bcs.Object.serialize({
  data: {
    Move: {
      type: { Other: TypeTagSerializer.parseFromStr(normalizeStructTag(TYPE), true).struct },
      hasPublicTransfer: true,
      version: '11',
      contents: HISTORICAL_CONTENT_BCS,
    },
  },
  owner: { ObjectOwner: PARENT },
  previousTransaction: PREVIOUS_TX,
  storageRebate: '77',
}).toBytes();
const OBJECT_DIGEST = typedDigest('Object', HISTORICAL_OBJECT_BCS);

const TRANSACTION_DATA = {
  V1: {
    kind: { ProgrammableTransaction: { inputs: [], commands: [] } },
    sender: OWNER,
    gasData: {
      payment: [{ objectId: OBJECT, version: '10', digest: OBJECT_DIGEST }],
      owner: OWNER,
      price: '1',
      budget: '1000',
    },
    expiration: { None: true },
  },
};
const TRANSACTION_BCS = bcs.TransactionData.serialize(TRANSACTION_DATA).toBytes();
const TX = TransactionDataBuilder.getDigestFromBytes(TRANSACTION_BCS);
const TRANSACTION_EVENTS = {
  data: [{
    package_id: PACKAGE,
    transaction_module: 'release_v8',
    sender: OWNER,
    event_type: TypeTagSerializer.parseFromStr(normalizeStructTag(EVENT_TYPE), true).struct,
    contents: new Uint8Array([37, 38]),
  }],
};
const TRANSACTION_EVENTS_BCS = SUI_TRANSACTION_EVENTS_BCS.serialize(TRANSACTION_EVENTS).toBytes();
const EVENTS_DIGEST = typedDigest('TransactionEvents', TRANSACTION_EVENTS_BCS);
const TRANSACTION_EFFECTS = {
  V1: {
    status: { Success: true },
    executedEpoch: '91',
    gasUsed: {
      computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0',
    },
    modifiedAtVersions: [],
    sharedObjects: [],
    transactionDigest: TX,
    created: [], mutated: [], unwrapped: [], deleted: [], unwrappedThenDeleted: [], wrapped: [],
    gasObject: [{ objectId: OBJECT, version: '11', digest: OBJECT_DIGEST }, { AddressOwner: OWNER }],
    eventsDigest: EVENTS_DIGEST,
    dependencies: [],
  },
};
const TRANSACTION_EFFECTS_BCS = bcs.TransactionEffects.serialize(TRANSACTION_EFFECTS).toBytes();
const EFFECTS_DIGEST = typedDigest('TransactionEffects', TRANSACTION_EFFECTS_BCS);
const USER_SIGNATURE_BCS = fromBase64((await SENDER_KEYPAIR.signTransaction(TRANSACTION_BCS)).signature);
const HISTORICAL_JSON = GrpcTypes.Object.fromJson({
  json: { id: OBJECT, version: '8' },
}).json;
const MOVE_TYPE = GrpcTypes.OpenSignatureBody_Type;
const DATATYPE_KIND = GrpcTypes.DatatypeDescriptor_DatatypeKind;
const SUI_PACKAGE = normalizeStructTag('0x2::sui::SUI').split('::')[0];
const UID_TYPE = `${SUI_PACKAGE}::object::UID`;
const ID_TYPE = `${SUI_PACKAGE}::object::ID`;
const ROOT_TYPE = `${PACKAGE}::maker_v8::MakerRootV8`;

const datatypeFixtures = new Map([
  [`${PACKAGE}:maker_v8:MakerRootV8`, {
    typeName: ROOT_TYPE,
    definingId: PACKAGE,
    module: 'maker_v8',
    name: 'MakerRootV8',
    abilities: [],
    typeParameters: [{ constraints: [], isPhantom: true }],
    kind: DATATYPE_KIND.STRUCT,
    fields: [
      {
        name: 'id', position: 0,
        type: { type: MOVE_TYPE.DATATYPE, typeName: UID_TYPE, typeParameterInstantiation: [] },
      },
      {
        name: 'version', position: 1,
        type: { type: MOVE_TYPE.U64, typeParameterInstantiation: [] },
      },
    ],
    variants: [],
  }],
  [`${SUI_PACKAGE}:object:UID`, {
    typeName: UID_TYPE,
    definingId: SUI_PACKAGE,
    module: 'object',
    name: 'UID',
    abilities: [],
    typeParameters: [],
    kind: DATATYPE_KIND.STRUCT,
    fields: [{
      name: 'id', position: 0,
      type: { type: MOVE_TYPE.DATATYPE, typeName: ID_TYPE, typeParameterInstantiation: [] },
    }],
    variants: [],
  }],
  [`${SUI_PACKAGE}:object:ID`, {
    typeName: ID_TYPE,
    definingId: SUI_PACKAGE,
    module: 'object',
    name: 'ID',
    abilities: [],
    typeParameters: [],
    kind: DATATYPE_KIND.STRUCT,
    fields: [{
      name: 'bytes', position: 0,
      type: { type: MOVE_TYPE.ADDRESS, typeParameterInstantiation: [] },
    }],
    variants: [],
  }],
]);

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
    hasPublicTransfer: true,
    previousTransaction: PREVIOUS_TX,
    storageRebate: 77n,
    contents: { name: normalizeStructTag(TYPE), value: HISTORICAL_CONTENT_BCS },
    bcs: { name: 'Object', value: HISTORICAL_OBJECT_BCS },
    json: HISTORICAL_JSON,
    ...overrides,
  };
}

function coreTransactionResult(transactionBcs = TRANSACTION_BCS, overrides = {}) {
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBcs);
  return {
    $kind: 'Transaction',
    Transaction: {
      digest: transactionDigest,
      epoch: '91',
      status: { success: true, error: null },
      transaction: undefined,
      bcs: transactionBcs,
      signatures: [toBase64(USER_SIGNATURE_BCS)],
      effects: {
        bcs: TRANSACTION_EFFECTS_BCS,
        transactionDigest,
        status: { success: true, error: null },
        eventsDigest: EVENTS_DIGEST,
        changedObjects: [],
      },
      events: [],
      objectTypes: {},
      ...overrides,
    },
  };
}

function rawTransaction(overrides = {}) {
  return {
    digest: TX,
    checkpoint: 77n,
    transaction: { digest: TX, bcs: { name: 'TransactionData', value: TRANSACTION_BCS } },
    signatures: [{ bcs: { name: 'UserSignatureBytes', value: USER_SIGNATURE_BCS } }],
    effects: {
      bcs: { name: 'TransactionEffects', value: TRANSACTION_EFFECTS_BCS },
      digest: EFFECTS_DIGEST,
      version: 1,
      status: { success: true },
      epoch: 91n,
      transactionDigest: TX,
      eventsDigest: EVENTS_DIGEST,
    },
    events: {
      digest: EVENTS_DIGEST,
      bcs: { name: 'TransactionEvents', value: TRANSACTION_EVENTS_BCS },
      events: [],
    },
    ...overrides,
  };
}

async function installSignedTransaction(fixture, {
  senderKeypair = SENDER_KEYPAIR,
  gasOwnerKeypair = senderKeypair,
  senderAddress = senderKeypair.toSuiAddress(),
  gasOwnerAddress = gasOwnerKeypair.toSuiAddress(),
  signerKeypairs = senderKeypair === gasOwnerKeypair
    ? [senderKeypair]
    : [senderKeypair, gasOwnerKeypair],
  signatureBytes = null,
  signatureFactory = null,
} = {}) {
  const transactionData = structuredClone(TRANSACTION_DATA);
  transactionData.V1.sender = senderAddress;
  transactionData.V1.gasData.owner = gasOwnerAddress;
  const transactionBcs = bcs.TransactionData.serialize(transactionData).toBytes();
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBcs);
  const signatures = signatureBytes
    ?? (signatureFactory
      ? await signatureFactory(transactionBcs)
      : await Promise.all(
        signerKeypairs.map(async (keypair) => fromBase64(
          (await keypair.signTransaction(transactionBcs)).signature,
        )),
      ));
  const transactionEffects = structuredClone(TRANSACTION_EFFECTS);
  transactionEffects.V1.transactionDigest = transactionDigest;
  transactionEffects.V1.gasObject[1] = { AddressOwner: gasOwnerAddress };
  const transactionEffectsBcs = bcs.TransactionEffects.serialize(transactionEffects).toBytes();
  fixture.values.transaction = rawTransaction({
    digest: transactionDigest,
    transaction: {
      digest: transactionDigest,
      bcs: { name: 'TransactionData', value: transactionBcs },
    },
    signatures: signatures.map((value) => ({
      bcs: { name: 'UserSignatureBytes', value },
    })),
    effects: {
      bcs: { name: 'TransactionEffects', value: transactionEffectsBcs },
      digest: typedDigest('TransactionEffects', transactionEffectsBcs),
      version: 1,
      status: { success: true },
      epoch: 91n,
      transactionDigest,
      eventsDigest: EVENTS_DIGEST,
    },
  });
  return Object.freeze({ transactionData, transactionBcs, transactionDigest, signatures });
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
    checkpoint: { sequenceNumber: 100n, digest: CHECKPOINT_DIGEST, summary: { epoch: 91n } },
    protocolConfig: {
      protocolVersion: '133',
      featureFlags: { receive_objects: true },
      attributes: {
        object_runtime_max_num_cached_objects: '1000',
        object_runtime_max_num_store_entries: '1000',
        bridge_should_try_to_finalize_committee: 'true',
        gasless_allowed_token_types: '[["0x2::coin::COIN","10000"]]',
        opaque_empty_string: '',
        optional_future_limit: null,
      },
    },
    coreTransaction: coreTransactionResult(),
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
    async simulateTransaction(input) {
      calls.push(['grpc.simulateTransaction', input]);
      return structuredClone(values.coreTransaction);
    },
    async executeTransaction(input) {
      calls.push(['grpc.executeTransaction', input]);
      return structuredClone(values.coreTransaction);
    },
    core: {
      async getObjects() { return { objects: [] }; },
      async listOwnedObjects(input) { return grpcClient.listOwnedObjects(input); },
      async listCoins(input) { return grpcClient.listCoins(input); },
      async getBalance(input) { return grpcClient.getBalance(input); },
      async getTransaction(input) {
        calls.push(['core.getTransaction', input]);
        return structuredClone(values.coreTransaction);
      },
      async simulateTransaction(input) { return grpcClient.simulateTransaction(input); },
      async executeTransaction(input) { return grpcClient.executeTransaction(input); },
      async getProtocolConfig() { return { protocolConfig: structuredClone(values.protocolConfig) }; },
      async getCurrentSystemState() { return { systemState: { epoch: '91' } }; },
      resolveTransactionPlugin() { return async (_data, _options, next) => next(); },
    },
    ledgerService: {
      async getObject(input) {
        const object = input.version === undefined ? values.rawPackage : values.historical;
        const response = GrpcTypes.GetObjectResponse.create({ object });
        calls.push(['ledger.getObject', input, response]);
        return { response };
      },
      async getTransaction(input) {
        const response = GrpcTypes.GetTransactionResponse.create({ transaction: values.transaction });
        calls.push(['ledger.getTransaction', input, response]);
        return { response };
      },
      async getServiceInfo(input) {
        const response = GrpcTypes.GetServiceInfoResponse.create(values.serviceInfo);
        calls.push(['ledger.getServiceInfo', input, response]);
        return { response };
      },
      async getCheckpoint(input) {
        const response = GrpcTypes.GetCheckpointResponse.create({ checkpoint: values.checkpoint });
        calls.push(['ledger.getCheckpoint', input, response]);
        return { response };
      },
    },
    movePackageService: {
      async getDatatype(input) {
        const descriptor = datatypeFixtures.get(`${input.packageId}:${input.moduleName}:${input.name}`);
        if (!descriptor) throw new Error(`unexpected datatype ${JSON.stringify(input)}`);
        const response = GrpcTypes.GetDatatypeResponse.create({ datatype: descriptor });
        calls.push(['movePackage.getDatatype', input, response]);
        return { response };
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

test('production factory is official, branded, and exposes gRPC authority without a signing path', () => {
  assert.equal(MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT, 'https://fullnode.mainnet.sui.io:443');
  assert.equal(MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT, 'https://graphql.mainnet.sui.io/graphql');
  assert.equal(MAKER_V8_SUI_MAINNET_GENESIS_DIGEST, '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S');
  const transport = createProductionMakerV8SuiGrpcTransport();
  assert.equal(isMakerV8SuiGrpcTransport(transport), true);
  assert.equal(assertMakerV8SuiGrpcTransport(transport), transport);
  assert.equal(transport.grpcEndpoint, MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT);
  assert.equal(transport.graphqlEndpoint, MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT);
  assert.equal(transport.chainIdentifier, MAKER_V8_SUI_MAINNET_GENESIS_DIGEST);
  assert.equal(typeof transport.executeTransaction, 'function');
  assert.equal(transport.signAndExecuteTransaction, undefined);
  assert.equal(typeof transport.core.executeTransaction, 'function');
  assert.equal(typeof transport.core.simulateTransaction, 'function');
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

test('ledger unary responses require real protobuf-ts message prototypes', async () => {
  const fixture = fixtures();
  const official = GrpcTypes.GetServiceInfoResponse.create(fixture.values.serviceInfo);
  assert.equal(Object.getPrototypeOf(official), GrpcTypes.GetServiceInfoResponse.messagePrototype);
  assert.notEqual(Object.getPrototypeOf(official), Object.prototype);
  const plainClone = structuredClone(official);
  assert.equal(Object.getPrototypeOf(plainClone), Object.prototype);
  fixture.grpcClient.ledgerService.getServiceInfo = async () => ({ response: plainClone });
  await assert.rejects(
    fixture.transport.getServiceInfo(),
    code('MAKER_V8_SUI_GRPC_SDK_MESSAGE_INVALID'),
  );
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
  assert.ok(rawCall.readMask.paths.includes('package.modules.name'));
  assert.ok(rawCall.readMask.paths.includes('package.modules.contents'));
  assert.equal(fixture.values.rawPackage.package.storageId, undefined);
  assert.equal(fixture.values.rawPackage.package.originalId, undefined);
  assert.equal(fixture.values.rawPackage.package.version, undefined);
  const rawResponse = fixture.calls.find(([name]) => name === 'ledger.getObject')[2];
  assert.equal(Object.getPrototypeOf(rawResponse), GrpcTypes.GetObjectResponse.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.object), GrpcTypes.Object.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.object.package), GrpcTypes.Package.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.object.package.modules[0]), GrpcTypes.Module.messagePrototype);

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
    protocolVersion: '133',
    featureFlags: { receive_objects: true },
    attributes: {
      object_runtime_max_num_cached_objects: '1000',
      object_runtime_max_num_store_entries: '1000',
      bridge_should_try_to_finalize_committee: 'true',
      gasless_allowed_token_types: '[["0x2::coin::COIN","10000"]]',
      opaque_empty_string: '',
      optional_future_limit: null,
    },
  });

  fixture.values.protocolConfig.attributes.optional_future_limit = 1000;
  await assert.rejects(fixture.transport.getProtocolConfig(), code('MAKER_V8_SUI_GRPC_PROTOCOL_INVALID'));
  const malformedNumeric = fixtures();
  malformedNumeric.values.protocolConfig.attributes.object_runtime_max_num_cached_objects = '1e3';
  await assert.rejects(
    malformedNumeric.transport.getProtocolConfig(),
    code('MAKER_V8_SUI_GRPC_DECIMAL_INVALID'),
  );
  await assert.rejects(
    fixture.transport.getOwnedObjects({ owner: OWNER, filter: { MatchAll: [] } }),
    code('MAKER_V8_SUI_GRPC_OWNED_FILTER_INVALID'),
  );
});

test('historical Object BCS binds exact version, ID, type, owner, contents, metadata, and digest', async () => {
  const fixture = fixtures();
  const historical = await fixture.transport.getHistoricalObject({ objectId: OBJECT, version: 11n });
  assert.equal(historical.objectId, OBJECT);
  assert.equal(historical.version, '11');
  assert.equal(historical.previousTransaction, PREVIOUS_TX);
  assert.deepEqual(historical.parsed, { id: OBJECT, version: '8' });
  assert.deepEqual(historical.contentBcs, HISTORICAL_CONTENT_BCS);
  assert.deepEqual(historical.objectBcs, HISTORICAL_OBJECT_BCS);
  const call = fixture.calls.find(([name]) => name === 'ledger.getObject')[1];
  assert.equal(typeof call.version, 'bigint');
  assert.equal(call.version, 11n);
  assert.ok(call.readMask.paths.includes('previous_transaction'));
  assert.ok(call.readMask.paths.includes('storage_rebate'));
  assert.ok(call.readMask.paths.includes('json'));
  const rawResponse = fixture.calls.find(([name]) => name === 'ledger.getObject')[2];
  assert.equal(Object.getPrototypeOf(rawResponse.object.bcs), GrpcTypes.Bcs.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.object.contents), GrpcTypes.Bcs.messagePrototype);
  assert.deepEqual(
    fixture.calls.filter(([name]) => name === 'movePackage.getDatatype').map(([, input]) => input.name),
    ['MakerRootV8', 'UID', 'ID'],
  );

  fixture.values.historical.version = 12n;
  await assert.rejects(
    fixture.transport.getHistoricalObject({ objectId: OBJECT, version: 11n }),
    code('MAKER_V8_SUI_GRPC_HISTORY_DRIFT'),
  );
  await assert.rejects(
    fixture.transport.getHistoricalObject({ objectId: OBJECT, version: '11' }),
    code('MAKER_V8_SUI_GRPC_UINT64_INVALID'),
  );

  for (const [mutate, expected] of [
    [(value) => { value.bcs.name = 'ObjectV2'; }, 'MAKER_V8_SUI_GRPC_BCS_NAME_INVALID'],
    [(value) => { value.contents.name = normalizeStructTag(`${PACKAGE}::maker_v8::OtherRootV8`); }, 'MAKER_V8_SUI_GRPC_BCS_NAME_INVALID'],
    [(value) => { value.digest = OTHER_DIGEST; }, 'MAKER_V8_SUI_GRPC_HISTORY_BCS_DRIFT'],
    [(value) => { value.owner = { kind: 1, address: OWNER }; }, 'MAKER_V8_SUI_GRPC_HISTORY_BCS_DRIFT'],
    [(value) => { value.contents.value = new Uint8Array(value.contents.value).fill(0, 32); }, 'MAKER_V8_SUI_GRPC_HISTORY_BCS_DRIFT'],
    [(value) => { value.bcs.value = concatBytes(value.bcs.value, Uint8Array.of(0)); }, 'MAKER_V8_SUI_GRPC_BCS_NONCANONICAL'],
    [(value) => { value.json = GrpcTypes.Object.fromJson({ json: { id: OBJECT, version: '9' } }).json; }, 'MAKER_V8_SUI_GRPC_HISTORY_JSON_DRIFT'],
  ]) {
    const drift = fixtures();
    mutate(drift.values.historical);
    await assert.rejects(
      drift.transport.getHistoricalObject({ objectId: OBJECT, version: 11n }),
      code(expected),
    );
  }
});

test('only exact GetTransaction RpcError NOT_FOUND is digest-bound by the requested call', async () => {
  const fixture = fixtures();
  const notFound = new RpcError(`Transaction ${TX} not found`, 'NOT_FOUND');
  notFound.serviceName = 'sui.rpc.v2.LedgerService';
  notFound.methodName = 'GetTransaction';
  fixture.grpcClient.ledgerService.getTransaction = async (input) => {
    fixture.calls.push(['ledger.getTransaction', input]);
    throw notFound;
  };
  assert.equal(isMakerV8SuiGrpcNotFoundError(notFound, TX), false);
  let caught;
  try {
    await fixture.transport.getFinalizedTransactionEvidence({ digest: TX });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, notFound);
  assert.equal(isMakerV8SuiGrpcNotFoundError(caught, TX), true);
  assert.equal(isMakerV8SuiGrpcNotFoundError(caught, OTHER_DIGEST), false);
  assert.equal(fixture.calls.find(([name]) => name === 'ledger.getTransaction')[1].digest, TX);

  for (const [codeValue, serviceName, methodName] of [
    ['UNAVAILABLE', 'sui.rpc.v2.LedgerService', 'GetTransaction'],
    ['NOT_FOUND', 'sui.rpc.v2.StateService', 'GetTransaction'],
    ['NOT_FOUND', 'sui.rpc.v2.LedgerService', 'GetObject'],
  ]) {
    const error = new RpcError('not found', codeValue);
    error.serviceName = serviceName;
    error.methodName = methodName;
    assert.equal(isMakerV8SuiGrpcNotFoundError(error, TX), false);
  }
});

test('Ledger finality and Core transaction reads correlate digest, epoch, status, and effects', async () => {
  const fixture = fixtures();
  const finality = await fixture.transport.getTransactionFinality({ digest: TX });
  assert.deepEqual(finality, {
    schemaVersion: 'animacraft.maker-v8-sui-grpc.v1',
    chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
    digest: TX,
    checkpoint: '77',
    epoch: '91',
    status: { success: true, error: null },
  });
  const result = await fixture.transport.getTransaction({
    digest: TX,
    include: { effects: true },
  });
  assert.equal(result.$kind, 'Transaction');
  assert.equal(result.Transaction.effects.transactionDigest, TX);
  assert.equal(fixture.calls.filter(([name]) => name === 'ledger.getTransaction').length, 2);
  assert.equal(fixture.calls.filter(([name]) => name === 'core.getTransaction').length, 1);

  const drift = fixtures();
  drift.values.coreTransaction.Transaction.epoch = '92';
  await assert.rejects(
    drift.transport.getTransaction({ digest: TX, include: { effects: true } }),
    code('MAKER_V8_SUI_GRPC_FINALITY_DRIFT'),
  );
});

test('official gRPC simulation and execution forward exact bytes/signatures and reject result drift', async () => {
  const fixture = fixtures();
  fixture.values.coreTransaction.Transaction.digest = null;
  const simulated = await fixture.transport.core.simulateTransaction({
    transaction: TRANSACTION_BCS,
    include: { effects: true },
  });
  assert.equal(simulated.Transaction.digest, TX);
  const simulationCall = fixture.calls.find(([name]) => name === 'grpc.simulateTransaction')[1];
  assert.deepEqual(simulationCall.transaction, TRANSACTION_BCS);
  assert.deepEqual(simulationCall.include, { effects: true, bcs: true });

  fixture.values.coreTransaction.Transaction.digest = TX;
  const signature = toBase64(USER_SIGNATURE_BCS);
  const executed = await fixture.transport.core.executeTransaction({
    transaction: TRANSACTION_BCS,
    signatures: [signature],
    include: { effects: true, events: true },
  });
  assert.equal(executed.Transaction.digest, TX);
  const executionCall = fixture.calls.find(([name]) => name === 'grpc.executeTransaction')[1];
  assert.deepEqual(executionCall.transaction, TRANSACTION_BCS);
  assert.deepEqual(executionCall.signatures, [signature]);

  const drift = fixtures();
  drift.values.coreTransaction.Transaction.digest = OTHER_DIGEST;
  await assert.rejects(
    drift.transport.simulateTransaction({ transaction: TRANSACTION_BCS }),
    code('MAKER_V8_SUI_GRPC_CORE_TRANSACTION_INVALID'),
  );

  const byteDrift = fixtures();
  byteDrift.values.coreTransaction.Transaction.digest = null;
  byteDrift.values.coreTransaction.Transaction.bcs = new Uint8Array([1]);
  await assert.rejects(
    byteDrift.transport.simulateTransaction({ transaction: TRANSACTION_BCS }),
    code('MAKER_V8_SUI_GRPC_SIMULATION_DRIFT'),
  );
});

test('raw finalized transaction evidence binds checkpoint, transaction/signature/effects/events BCS and digests', async () => {
  const fixture = fixtures();
  const evidence = await fixture.transport.getFinalizedTransactionEvidence({ digest: TX });
  assert.equal(evidence.chainIdentifier, MAKER_V8_SUI_MAINNET_GENESIS_DIGEST);
  assert.equal(evidence.checkpoint, '77');
  assert.equal(evidence.epoch, '91');
  assert.equal(evidence.transactionBcsBase64, toBase64(TRANSACTION_BCS));
  assert.deepEqual(evidence.signatures, [toBase64(USER_SIGNATURE_BCS)]);
  assert.equal(evidence.effectsBcsBase64, toBase64(TRANSACTION_EFFECTS_BCS));
  assert.equal(evidence.effectsDigest, EFFECTS_DIGEST);
  assert.equal(evidence.eventsDigest, EVENTS_DIGEST);
  assert.equal(evidence.transactionEvents.digest, EVENTS_DIGEST);
  assert.deepEqual(evidence.transactionEvents.bcs, TRANSACTION_EVENTS_BCS);
  assert.equal(evidence.transactionEvents.eventCount, 1);
  const call = fixture.calls.find(([name]) => name === 'ledger.getTransaction')[1];
  assert.ok(call.readMask.paths.includes('checkpoint'));
  assert.ok(call.readMask.paths.includes('transaction.bcs'));
  assert.ok(call.readMask.paths.includes('signatures.bcs'));
  assert.ok(call.readMask.paths.includes('effects.bcs'));
  assert.ok(call.readMask.paths.includes('events.bcs'));
  const rawResponse = fixture.calls.find(([name]) => name === 'ledger.getTransaction')[2];
  assert.equal(Object.getPrototypeOf(rawResponse), GrpcTypes.GetTransactionResponse.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.transaction), GrpcTypes.ExecutedTransaction.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.transaction.transaction.bcs), GrpcTypes.Bcs.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.transaction.effects), GrpcTypes.TransactionEffects.messagePrototype);
  assert.equal(Object.getPrototypeOf(rawResponse.transaction.events), GrpcTypes.TransactionEvents.messagePrototype);

  fixture.values.transaction.effects.eventsDigest = OTHER_DIGEST;
  await assert.rejects(
    fixture.transport.getFinalizedTransactionEvidence({ digest: TX }),
    code('MAKER_V8_SUI_GRPC_EVENTS_DRIFT'),
  );

  const rejects = async (mutate, expected) => {
    const drift = fixtures();
    mutate(drift.values.transaction);
    await assert.rejects(
      drift.transport.getFinalizedTransactionEvidence({ digest: TX }),
      code(expected),
    );
  };
  await rejects(
    (value) => { value.transaction.digest = OTHER_DIGEST; },
    'MAKER_V8_SUI_GRPC_TRANSACTION_DRIFT',
  );
  await rejects((value) => {
    const changed = structuredClone(TRANSACTION_DATA);
    changed.V1.gasData.budget = '1001';
    value.transaction.bcs.value = bcs.TransactionData.serialize(changed).toBytes();
  }, 'MAKER_V8_SUI_GRPC_TRANSACTION_BCS_DRIFT');
  await rejects(
    (value) => { value.transaction.bcs.value = concatBytes(value.transaction.bcs.value, Uint8Array.of(0)); },
    'MAKER_V8_SUI_GRPC_BCS_NONCANONICAL',
  );
  await rejects(
    (value) => { value.transaction.bcs.name = 'SenderSignedData'; },
    'MAKER_V8_SUI_GRPC_BCS_NAME_INVALID',
  );
  await rejects(
    (value) => { value.signatures[0].bcs.name = 'UserSignature'; },
    'MAKER_V8_SUI_GRPC_BCS_NAME_INVALID',
  );
  await rejects(
    (value) => { value.effects.status = { success: false }; },
    'MAKER_V8_SUI_GRPC_FINALITY_STATUS_INVALID',
  );
  await rejects((value) => {
    const changed = structuredClone(TRANSACTION_EFFECTS);
    changed.V1.transactionDigest = OTHER_DIGEST;
    value.effects.bcs.value = bcs.TransactionEffects.serialize(changed).toBytes();
  }, 'MAKER_V8_SUI_GRPC_EFFECTS_DRIFT');
  await rejects((value) => {
    const changed = structuredClone(TRANSACTION_EFFECTS);
    changed.V1.status = { Failure: { error: { InsufficientGas: true }, command: null } };
    value.effects.bcs.value = bcs.TransactionEffects.serialize(changed).toBytes();
  }, 'MAKER_V8_SUI_GRPC_EFFECTS_DRIFT');
  await rejects(
    (value) => { value.effects.bcs.value = concatBytes(value.effects.bcs.value, Uint8Array.of(0)); },
    'MAKER_V8_SUI_GRPC_BCS_NONCANONICAL',
  );
  await rejects(
    (value) => { value.effects.digest = OTHER_DIGEST; },
    'MAKER_V8_SUI_GRPC_EFFECTS_DRIFT',
  );
  await rejects(
    (value) => { value.events.bcs.name = 'Event'; },
    'MAKER_V8_SUI_GRPC_BCS_NAME_INVALID',
  );
  await rejects((value) => {
    value.events.bcs.value = SUI_TRANSACTION_EVENTS_BCS.serialize({ data: [] }).toBytes();
  }, 'MAKER_V8_SUI_GRPC_EVENTS_DRIFT');
  await rejects(
    (value) => { value.events.bcs.value = concatBytes(value.events.bcs.value, Uint8Array.of(0)); },
    'MAKER_V8_SUI_GRPC_BCS_NONCANONICAL',
  );
});

test('finalized evidence accepts exact sender-only and sponsored ED25519 signer multisets', async () => {
  const senderOnly = fixtures();
  const senderOnlyTransaction = await installSignedTransaction(senderOnly);
  const senderOnlyEvidence = await senderOnly.transport.getFinalizedTransactionEvidence({
    digest: senderOnlyTransaction.transactionDigest,
  });
  assert.equal(senderOnlyEvidence.signatures.length, 1);

  const sponsored = fixtures();
  const sponsoredTransaction = await installSignedTransaction(sponsored, {
    gasOwnerKeypair: SPONSOR_KEYPAIR,
    signerKeypairs: [SPONSOR_KEYPAIR, SENDER_KEYPAIR],
  });
  const sponsoredEvidence = await sponsored.transport.getFinalizedTransactionEvidence({
    digest: sponsoredTransaction.transactionDigest,
  });
  assert.equal(sponsoredEvidence.signatures.length, 2);
});

test('serialized signatures reject malformed flags, trailing bytes, noncanonical BCS, and ZkLogin', async () => {
  const malformedFlag = fixtures();
  const malformedBytes = new Uint8Array(USER_SIGNATURE_BCS);
  malformedBytes[0] = 4;
  const malformedTransaction = await installSignedTransaction(malformedFlag, {
    signatureBytes: [malformedBytes],
  });
  await assert.rejects(
    malformedFlag.transport.getFinalizedTransactionEvidence({
      digest: malformedTransaction.transactionDigest,
    }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_BCS_INVALID'),
  );

  const trailing = fixtures();
  const trailingTransaction = await installSignedTransaction(trailing, {
    signatureBytes: [concatBytes(USER_SIGNATURE_BCS, Uint8Array.of(0))],
  });
  await assert.rejects(
    trailing.transport.getFinalizedTransactionEvidence({ digest: trailingTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_BCS_NONCANONICAL'),
  );

  const multisigPublicKey = MultiSigPublicKey.fromPublicKeys({
    threshold: 1,
    publicKeys: [{ publicKey: SENDER_KEYPAIR.getPublicKey(), weight: 1 }],
  });
  const multisig = fixtures();
  const multisigTransaction = await installSignedTransaction(multisig, {
    senderAddress: multisigPublicKey.toSuiAddress(),
    gasOwnerAddress: multisigPublicKey.toSuiAddress(),
    signatureFactory: async (transactionBcs) => {
      const partial = await SENDER_KEYPAIR.signTransaction(transactionBcs);
      return [fromBase64(multisigPublicKey.combinePartialSignatures([partial.signature]))];
    },
  });
  const multisigEvidence = await multisig.transport.getFinalizedTransactionEvidence({
    digest: multisigTransaction.transactionDigest,
  });
  assert.equal(multisigEvidence.signatures.length, 1);
  const canonicalMultisig = multisig.values.transaction.signatures[0].bcs.value;
  const overlongUlebMultisig = new Uint8Array(canonicalMultisig.length + 1);
  overlongUlebMultisig[0] = canonicalMultisig[0];
  overlongUlebMultisig.set([0x81, 0], 1);
  overlongUlebMultisig.set(canonicalMultisig.slice(2), 3);
  multisig.values.transaction.signatures[0].bcs.value = overlongUlebMultisig;
  await assert.rejects(
    multisig.transport.getFinalizedTransactionEvidence({ digest: multisigTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_BCS_NONCANONICAL'),
  );
  multisig.values.transaction.signatures[0].bcs.value = concatBytes(
    canonicalMultisig,
    Uint8Array.of(0),
  );
  await assert.rejects(
    multisig.transport.getFinalizedTransactionEvidence({ digest: multisigTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_BCS_NONCANONICAL'),
  );

  const zkLogin = fixtures();
  const zkLoginSignature = fromBase64(getZkLoginSignature({
    inputs: {
      proofPoints: {
        a: ['1', '2', '1'],
        b: [['1', '2'], ['1', '2'], ['1', '2']],
        c: ['1', '2', '1'],
      },
      issBase64Details: { value: 'ImlzcyI6ImFiYyIs', indexMod4: 0 },
      headerBase64: 'e30',
      addressSeed: '1',
    },
    maxEpoch: '999',
    userSignature: USER_SIGNATURE_BCS,
  }));
  const zkLoginTransaction = await installSignedTransaction(zkLogin, {
    signatureBytes: [zkLoginSignature],
  });
  await assert.rejects(
    zkLogin.transport.getFinalizedTransactionEvidence({ digest: zkLoginTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_SCHEME_UNSUPPORTED'),
  );
});

test('serialized signatures must verify offline over the exact canonical TransactionData BCS', async () => {
  const wrongTransaction = fixtures();
  const wrongTransactionSignature = fromBase64(
    (await SENDER_KEYPAIR.signTransaction(Uint8Array.of(9, 8, 7))).signature,
  );
  const wrongTransactionData = await installSignedTransaction(wrongTransaction, {
    signatureBytes: [wrongTransactionSignature],
  });
  await assert.rejects(
    wrongTransaction.transport.getFinalizedTransactionEvidence({
      digest: wrongTransactionData.transactionDigest,
    }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_VERIFICATION_FAILED'),
  );

  const corrupted = fixtures();
  const corruptedSignature = new Uint8Array(USER_SIGNATURE_BCS);
  corruptedSignature[1] ^= 0x80;
  const corruptedTransaction = await installSignedTransaction(corrupted, {
    signatureBytes: [corruptedSignature],
  });
  await assert.rejects(
    corrupted.transport.getFinalizedTransactionEvidence({ digest: corruptedTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_VERIFICATION_FAILED'),
  );
});

test('finalized evidence rejects wrong, duplicate, missing, and extra signer signatures', async () => {
  const wrongSigner = fixtures();
  const wrongSignerTransaction = await installSignedTransaction(wrongSigner, {
    signerKeypairs: [ATTACKER_KEYPAIR],
  });
  await assert.rejects(
    wrongSigner.transport.getFinalizedTransactionEvidence({ digest: wrongSignerTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_SIGNER_EXTRA'),
  );

  const duplicate = fixtures();
  const duplicateTransaction = await installSignedTransaction(duplicate, {
    gasOwnerKeypair: SPONSOR_KEYPAIR,
    signerKeypairs: [SENDER_KEYPAIR, SENDER_KEYPAIR],
  });
  await assert.rejects(
    duplicate.transport.getFinalizedTransactionEvidence({ digest: duplicateTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_SIGNER_DUPLICATE'),
  );

  const missing = fixtures();
  const missingTransaction = await installSignedTransaction(missing, {
    gasOwnerKeypair: SPONSOR_KEYPAIR,
    signerKeypairs: [SENDER_KEYPAIR],
  });
  await assert.rejects(
    missing.transport.getFinalizedTransactionEvidence({ digest: missingTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_SIGNER_MISSING'),
  );

  const extra = fixtures();
  const extraTransaction = await installSignedTransaction(extra, {
    signerKeypairs: [SENDER_KEYPAIR, ATTACKER_KEYPAIR],
  });
  await assert.rejects(
    extra.transport.getFinalizedTransactionEvidence({ digest: extraTransaction.transactionDigest }),
    code('MAKER_V8_SUI_GRPC_SIGNATURE_SIGNER_EXTRA'),
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
    sequenceNumber: '100', digest: CHECKPOINT_DIGEST, epoch: '91',
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
  assert.ok(checkpointCalls.at(-1)[1].readMask.paths.includes('summary.epoch'));
  assert.equal(
    Object.getPrototypeOf(checkpointCalls.at(-1)[2].checkpoint.summary),
    GrpcTypes.CheckpointSummary.messagePrototype,
  );

  const epochDrift = fixtures();
  epochDrift.values.checkpoint.summary.epoch = 92n;
  await assert.rejects(
    epochDrift.transport.getCheckpointWatermark(),
    code('MAKER_V8_SUI_GRPC_CHECKPOINT_EPOCH_DRIFT'),
  );

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
