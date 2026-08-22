import { SuiGraphQLClient, isSuiGraphQLClient } from '@mysten/sui/graphql';
import { SuiGrpcClient, isSuiGrpcClient } from '@mysten/sui/grpc';
import {
  fromBase58,
  fromBase64,
  normalizeStructTag,
  normalizeSuiAddress,
  parseStructTag,
  toBase58,
  toBase64,
} from '@mysten/sui/utils';

export const MAKER_V8_SUI_GRPC_SCHEMA = 'animacraft.maker-v8-sui-grpc.v1';
export const MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT = 'https://fullnode.mainnet.sui.io:443';
export const MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT = 'https://graphql.mainnet.sui.io/graphql';
export const MAKER_V8_SUI_MAINNET_GENESIS_DIGEST = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
export const MAKER_V8_SUI_EVENT_DISCOVERY_SOURCE = 'SUI_GRAPHQL_INDEX';

export const MAKER_V8_SUI_EVENT_DISCOVERY_QUERY = `
  query MakerV8EventDiscovery(
    $first: Int
    $after: String
    $last: Int
    $before: String
    $filter: EventFilter!
  ) {
    chainIdentifier
    events(first: $first, after: $after, last: $last, before: $before, filter: $filter) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          sequenceNumber
          timestamp
          eventBcs
          transaction { digest }
          sender { address }
          transactionModule {
            name
            package { address }
          }
          contents {
            bcs
            json
            type { repr }
          }
        }
      }
    }
  }
`;

const TRANSPORT_BRAND = Symbol(MAKER_V8_SUI_GRPC_SCHEMA);
const UINT = /^(?:0|[1-9][0-9]*)$/;
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class MakerV8SuiGrpcTransportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MakerV8SuiGrpcTransportError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new MakerV8SuiGrpcTransportError(code, message, details);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, label, maximum = 1024) {
  if (typeof value !== 'string' || value.length === 0
    || new TextEncoder().encode(value).length > maximum) {
    fail('MAKER_V8_SUI_GRPC_TEXT_INVALID', `${label} must be non-empty bounded text.`);
  }
  return value;
}

function decimal(value, label, { positive = false } = {}) {
  if (typeof value !== 'string' || !UINT.test(value) || (positive && value === '0')) {
    fail('MAKER_V8_SUI_GRPC_DECIMAL_INVALID', `${label} must be a canonical decimal string.`, { value });
  }
  return value;
}

function uint64(value, label, { positive = false } = {}) {
  if (typeof value !== 'bigint' || value < 0n || (positive && value === 0n)) {
    fail('MAKER_V8_SUI_GRPC_UINT64_INVALID', `${label} must be an exact bigint uint64.`, {
      observedType: typeof value,
    });
  }
  return value;
}

function address(value, label) {
  try {
    const normalized = normalizeSuiAddress(boundedText(value, label));
    if (normalized !== value) throw new Error('non-canonical');
    return normalized;
  } catch {
    fail('MAKER_V8_SUI_GRPC_ADDRESS_INVALID', `${label} must be one canonical Sui address.`, { value });
  }
}

function digest(value, label) {
  try {
    const bytes = fromBase58(boundedText(value, label, 128));
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('non-canonical');
    return value;
  } catch {
    fail('MAKER_V8_SUI_GRPC_DIGEST_INVALID', `${label} must be one canonical 32-byte Base58 digest.`, { value });
  }
}

function typeName(value, label) {
  const input = boundedText(value, label, 4096);
  try {
    return normalizeStructTag(input);
  } catch {
    fail('MAKER_V8_SUI_GRPC_TYPE_INVALID', `${label} must be one Move struct type.`, { value });
  }
}

function bytes(value, label, { allowEmpty = false, maximum = 4 * 1024 * 1024 } = {}) {
  if (!(value instanceof Uint8Array)
    || (!allowEmpty && value.length === 0)
    || value.length > maximum) {
    fail('MAKER_V8_SUI_GRPC_BCS_INVALID', `${label} must be bounded BCS bytes.`, {
      byteLength: value?.length ?? null,
    });
  }
  return new Uint8Array(value);
}

function canonicalBase64(value, label) {
  try {
    const decoded = fromBase64(boundedText(value, label, 8 * 1024 * 1024));
    if (toBase64(decoded) !== value) throw new Error('non-canonical');
    return value;
  } catch {
    fail('MAKER_V8_SUI_GRPC_BASE64_INVALID', `${label} must be canonical Base64.`);
  }
}

function endpoint(value, label) {
  if (typeof value !== 'string') {
    fail('MAKER_V8_SUI_GRPC_ENDPOINT_INVALID', `${label} must be an absolute HTTPS URL.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('MAKER_V8_SUI_GRPC_ENDPOINT_INVALID', `${label} must be an absolute HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    fail('MAKER_V8_SUI_GRPC_ENDPOINT_INVALID', `${label} must be a credential-free HTTPS URL.`);
  }
  return value.replace(/\/$/, '');
}

function coreOwner(owner, label) {
  if (!plain(owner) || typeof owner.$kind !== 'string') {
    fail('MAKER_V8_SUI_GRPC_OWNER_INVALID', `${label} has no exact Core owner union.`);
  }
  switch (owner.$kind) {
    case 'AddressOwner':
      return Object.freeze({ AddressOwner: address(owner.AddressOwner, `${label}.AddressOwner`) });
    case 'ObjectOwner':
      return Object.freeze({ ObjectOwner: address(owner.ObjectOwner, `${label}.ObjectOwner`) });
    case 'Shared':
      if (!plain(owner.Shared)) fail('MAKER_V8_SUI_GRPC_OWNER_INVALID', `${label}.Shared is malformed.`);
      return Object.freeze({
        Shared: Object.freeze({
          initial_shared_version: decimal(owner.Shared.initialSharedVersion, `${label}.Shared.initialSharedVersion`, { positive: true }),
        }),
      });
    case 'Immutable':
      if (owner.Immutable !== true) fail('MAKER_V8_SUI_GRPC_OWNER_INVALID', `${label}.Immutable is malformed.`);
      return Object.freeze({ Immutable: true });
    case 'ConsensusAddressOwner':
    case 'Unknown':
      fail('MAKER_V8_SUI_GRPC_OWNER_UNSUPPORTED', `${label} cannot be represented by the existing Maker v8 parser.`, {
        ownerKind: owner.$kind,
      });
      break;
    default:
      fail('MAKER_V8_SUI_GRPC_OWNER_INVALID', `${label} has an unknown Core owner kind.`, {
        ownerKind: owner.$kind,
      });
  }
}

function rawOwner(owner, label) {
  if (!plain(owner) || !Number.isInteger(owner.kind)) {
    fail('MAKER_V8_SUI_GRPC_OWNER_INVALID', `${label} has no exact raw gRPC owner.`);
  }
  switch (owner.kind) {
    case 1:
      return Object.freeze({ AddressOwner: address(owner.address, `${label}.address`) });
    case 2:
      return Object.freeze({ ObjectOwner: address(owner.address, `${label}.address`) });
    case 3:
      return Object.freeze({
        Shared: Object.freeze({
          initial_shared_version: uint64(owner.version, `${label}.version`, { positive: true }).toString(),
        }),
      });
    case 4:
      return Object.freeze({ Immutable: true });
    case 5:
      fail('MAKER_V8_SUI_GRPC_OWNER_UNSUPPORTED', `${label} consensus ownership cannot be represented by the existing Maker v8 parser.`);
      break;
    default:
      fail('MAKER_V8_SUI_GRPC_OWNER_INVALID', `${label} has an unknown raw gRPC owner kind.`, {
        ownerKind: owner.kind,
      });
  }
}

function currentReference(object, label) {
  if (!plain(object)) fail('MAKER_V8_SUI_GRPC_OBJECT_INVALID', `${label} is not a Core object.`);
  return Object.freeze({
    objectId: address(object.objectId, `${label}.objectId`),
    version: decimal(object.version, `${label}.version`, { positive: true }),
    digest: digest(object.digest, `${label}.digest`),
  });
}

function rawReference(object, label) {
  if (!plain(object)) fail('MAKER_V8_SUI_GRPC_OBJECT_INVALID', `${label} is not a raw gRPC object.`);
  return Object.freeze({
    objectId: address(object.objectId, `${label}.objectId`),
    version: uint64(object.version, `${label}.version`, { positive: true }).toString(),
    digest: digest(object.digest, `${label}.digest`),
  });
}

export function normalizeMakerV8CurrentMoveObject(object, options = {}) {
  const reference = currentReference(object, 'object');
  const normalizedType = typeName(object.type, 'object.type');
  const data = {
    ...reference,
    type: normalizedType,
    owner: coreOwner(object.owner, 'object.owner'),
    previousTransaction: object.previousTransaction == null
      ? null
      : digest(object.previousTransaction, 'object.previousTransaction'),
  };
  if (options.showContent === true) {
    if (!plain(object.json)) {
      fail('MAKER_V8_SUI_GRPC_OBJECT_JSON_INVALID', 'Current Move object JSON must be one parsed field record.');
    }
    data.content = Object.freeze({
      dataType: 'moveObject',
      type: normalizedType,
      fields: object.json,
    });
  }
  if (options.showBcs === true) {
    data.bcs = Object.freeze({
      dataType: 'moveObject',
      type: normalizedType,
      version: reference.version,
      bcsBytes: toBase64(bytes(object.content, 'object.content')),
    });
  }
  return Object.freeze({ data: Object.freeze(data) });
}

export function canonicalMakerV8PackageModuleMap(rawPackage) {
  if (!plain(rawPackage) || !Array.isArray(rawPackage.modules)) {
    fail('MAKER_V8_SUI_GRPC_PACKAGE_INVALID', 'Raw package modules are missing.');
  }
  const rows = rawPackage.modules.map((module, index) => {
    if (!plain(module) || typeof module.name !== 'string' || !MODULE_NAME.test(module.name)) {
      fail('MAKER_V8_SUI_GRPC_PACKAGE_MODULE_INVALID', `package.modules[${index}] has an invalid name.`);
    }
    return [module.name, toBase64(bytes(module.contents, `package.modules[${index}].contents`, { maximum: 1024 * 1024 }))];
  }).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1][0] === rows[index][0]) {
      fail('MAKER_V8_SUI_GRPC_PACKAGE_MODULE_DUPLICATE', 'Raw package contains a duplicate module name.', {
        module: rows[index][0],
      });
    }
  }
  return Object.freeze(Object.fromEntries(rows));
}

export function normalizeMakerV8RawPackageObject(object, expectedReference = null) {
  const reference = rawReference(object, 'packageObject');
  if (object.objectType !== 'package' || !plain(object.package)) {
    fail('MAKER_V8_SUI_GRPC_PACKAGE_INVALID', 'Raw gRPC object is not a Move package.');
  }
  const owner = rawOwner(object.owner, 'packageObject.owner');
  if (!Object.hasOwn(owner, 'Immutable')) {
    fail('MAKER_V8_SUI_GRPC_PACKAGE_OWNER_INVALID', 'Move package must be immutable.');
  }
  if (expectedReference
    && (reference.objectId !== expectedReference.objectId
      || reference.version !== expectedReference.version
      || reference.digest !== expectedReference.digest)) {
    fail('MAKER_V8_SUI_GRPC_PACKAGE_DRIFT', 'Core and raw package object references differ.', {
      core: expectedReference,
      raw: reference,
    });
  }
  if (object.package.storageId !== reference.objectId
    || uint64(object.package.version, 'package.version', { positive: true }).toString() !== reference.version) {
    fail('MAKER_V8_SUI_GRPC_PACKAGE_DRIFT', 'Raw package identity differs from its object envelope.');
  }
  address(object.package.originalId, 'package.originalId');
  const moduleMap = canonicalMakerV8PackageModuleMap(object.package);
  return Object.freeze({
    data: Object.freeze({
      ...reference,
      type: 'package',
      owner,
      previousTransaction: object.previousTransaction == null
        ? null
        : digest(object.previousTransaction, 'packageObject.previousTransaction'),
      bcs: Object.freeze({
        dataType: 'package',
        id: reference.objectId,
        version: reference.version,
        moduleMap,
      }),
    }),
  });
}

export function normalizeMakerV8HistoricalObject(object, requested) {
  const reference = rawReference(object, 'historicalObject');
  if (reference.objectId !== requested.objectId || reference.version !== requested.version.toString()) {
    fail('MAKER_V8_SUI_GRPC_HISTORY_DRIFT', 'Historical gRPC response differs from the exact requested object/version.', {
      requested: { objectId: requested.objectId, version: requested.version.toString() },
      observed: reference,
    });
  }
  const previousTransaction = digest(object.previousTransaction, 'historicalObject.previousTransaction');
  const normalizedType = object.objectType === 'package'
    ? 'package'
    : typeName(object.objectType, 'historicalObject.objectType');
  return Object.freeze({
    schemaVersion: MAKER_V8_SUI_GRPC_SCHEMA,
    ...reference,
    type: normalizedType,
    owner: rawOwner(object.owner, 'historicalObject.owner'),
    previousTransaction,
    contentBcs: object.contents?.value == null
      ? null
      : bytes(object.contents.value, 'historicalObject.contents.value'),
    objectBcs: object.bcs?.value == null
      ? null
      : bytes(object.bcs.value, 'historicalObject.bcs.value'),
  });
}

export function isMakerV8SuiGrpcNotFoundError(error) {
  return error instanceof Error && error.name === 'RpcError' && error.code === 'NOT_FOUND';
}

async function unary(call, label) {
  const result = await call;
  if (!plain(result) || !plain(result.response)) {
    fail('MAKER_V8_SUI_GRPC_UNARY_INVALID', `${label} did not return an official unary response envelope.`);
  }
  return result.response;
}

function serviceInfo(response) {
  if (!plain(response)) fail('MAKER_V8_SUI_GRPC_SERVICE_INFO_INVALID', 'getServiceInfo response is malformed.');
  if (response.chainId !== MAKER_V8_SUI_MAINNET_GENESIS_DIGEST || response.chain !== 'mainnet') {
    fail('MAKER_V8_SUI_GRPC_CHAIN_MISMATCH', 'gRPC service is not the pinned Sui Mainnet genesis.', {
      observedChainId: response.chainId ?? null,
      observedChain: response.chain ?? null,
    });
  }
  const epoch = uint64(response.epoch, 'serviceInfo.epoch');
  const checkpointHeight = uint64(response.checkpointHeight, 'serviceInfo.checkpointHeight');
  const lowestAvailableCheckpoint = uint64(response.lowestAvailableCheckpoint, 'serviceInfo.lowestAvailableCheckpoint');
  const lowestAvailableCheckpointObjects = uint64(
    response.lowestAvailableCheckpointObjects,
    'serviceInfo.lowestAvailableCheckpointObjects',
  );
  if (lowestAvailableCheckpoint > checkpointHeight || lowestAvailableCheckpointObjects > checkpointHeight) {
    fail('MAKER_V8_SUI_GRPC_SERVICE_INFO_INVALID', 'gRPC service pruning watermarks exceed its executed checkpoint.');
  }
  return Object.freeze({
    schemaVersion: MAKER_V8_SUI_GRPC_SCHEMA,
    chainIdentifier: response.chainId,
    chain: response.chain,
    epoch: epoch.toString(),
    checkpointHeight: checkpointHeight.toString(),
    lowestAvailableCheckpoint: lowestAvailableCheckpoint.toString(),
    lowestAvailableCheckpointObjects: lowestAvailableCheckpointObjects.toString(),
    server: response.server == null ? null : boundedText(response.server, 'serviceInfo.server'),
  });
}

function checkpoint(response, requested) {
  const value = response?.checkpoint;
  if (!plain(value)) fail('MAKER_V8_SUI_GRPC_CHECKPOINT_INVALID', 'getCheckpoint omitted its checkpoint.');
  const sequenceNumber = uint64(value.sequenceNumber, 'checkpoint.sequenceNumber');
  const checkpointDigest = digest(value.digest, 'checkpoint.digest');
  if (requested.sequenceNumber !== undefined && sequenceNumber !== requested.sequenceNumber) {
    fail('MAKER_V8_SUI_GRPC_CHECKPOINT_DRIFT', 'getCheckpoint returned another sequence number.');
  }
  if (requested.digest !== undefined && checkpointDigest !== requested.digest) {
    fail('MAKER_V8_SUI_GRPC_CHECKPOINT_DRIFT', 'getCheckpoint returned another digest.');
  }
  return Object.freeze({ sequenceNumber: sequenceNumber.toString(), digest: checkpointDigest });
}

export function normalizeMakerV8FinalizedTransactionEvidence(transaction, expectedDigest) {
  if (!plain(transaction)) {
    fail('MAKER_V8_SUI_GRPC_TRANSACTION_INVALID', 'Raw getTransaction omitted its executed transaction.');
  }
  const observedDigest = digest(transaction.digest, 'transaction.digest');
  if (observedDigest !== expectedDigest) {
    fail('MAKER_V8_SUI_GRPC_TRANSACTION_DRIFT', 'Raw getTransaction returned another digest.');
  }
  const checkpointHeight = uint64(transaction.checkpoint, 'transaction.checkpoint');
  const transactionBcs = bytes(transaction.transaction?.bcs?.value, 'transaction.transaction.bcs.value');
  if (transaction.transaction?.digest != null
    && digest(transaction.transaction.digest, 'transaction.transaction.digest') !== expectedDigest) {
    fail('MAKER_V8_SUI_GRPC_TRANSACTION_DRIFT', 'Raw TransactionData digest differs from the requested digest.');
  }
  if (!Array.isArray(transaction.signatures) || transaction.signatures.length === 0) {
    fail('MAKER_V8_SUI_GRPC_SIGNATURES_INVALID', 'Finalized transaction has no exact user signature BCS.');
  }
  const signatureBcs = transaction.signatures.map((signature, index) => (
    bytes(signature?.bcs?.value, `transaction.signatures[${index}].bcs.value`)
  ));
  const effects = transaction.effects;
  if (!plain(effects) || !plain(effects.status)) {
    fail('MAKER_V8_SUI_GRPC_EFFECTS_INVALID', 'Finalized transaction has no raw effects status.');
  }
  if (digest(effects.transactionDigest, 'transaction.effects.transactionDigest') !== expectedDigest) {
    fail('MAKER_V8_SUI_GRPC_TRANSACTION_DRIFT', 'Raw effects bind another transaction digest.');
  }
  const effectsBcs = bytes(effects.bcs?.value, 'transaction.effects.bcs.value');
  const epoch = uint64(effects.epoch, 'transaction.effects.epoch');
  const eventsDigest = effects.eventsDigest == null
    ? null
    : digest(effects.eventsDigest, 'transaction.effects.eventsDigest');
  let transactionEvents = null;
  if (eventsDigest !== null) {
    if (!plain(transaction.events)
      || digest(transaction.events.digest, 'transaction.events.digest') !== eventsDigest) {
      fail('MAKER_V8_SUI_GRPC_EVENTS_DRIFT', 'TransactionEvents digest differs from raw effects.');
    }
    transactionEvents = Object.freeze({
      digest: eventsDigest,
      bcs: bytes(transaction.events.bcs?.value, 'transaction.events.bcs.value'),
    });
  } else if (transaction.events?.digest != null || transaction.events?.bcs?.value != null) {
    fail('MAKER_V8_SUI_GRPC_EVENTS_DRIFT', 'Raw events exist while effects declare no events digest.');
  }
  return Object.freeze({
    schemaVersion: MAKER_V8_SUI_GRPC_SCHEMA,
    chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
    digest: expectedDigest,
    checkpoint: checkpointHeight.toString(),
    epoch: epoch.toString(),
    transactionBcs,
    transactionBcsBase64: toBase64(transactionBcs),
    signatureBcs: Object.freeze(signatureBcs),
    signatures: Object.freeze(signatureBcs.map((value) => toBase64(value))),
    effectsBcs,
    effectsBcsBase64: toBase64(effectsBcs),
    effectsStatus: effects.status,
    effectsDigest: digest(effects.digest, 'transaction.effects.digest'),
    eventsDigest,
    transactionEvents,
  });
}

export function normalizeMakerV8GraphQLEvent(event, expectedType) {
  if (!plain(event) || !plain(event.transaction) || !plain(event.sender)
    || !plain(event.transactionModule) || !plain(event.transactionModule.package)
    || !plain(event.contents) || !plain(event.contents.type)) {
    fail('MAKER_V8_SUI_GRAPHQL_EVENT_INVALID', 'GraphQL event discovery returned an incomplete event shape.');
  }
  if (!Number.isSafeInteger(event.sequenceNumber) || event.sequenceNumber < 0) {
    fail('MAKER_V8_SUI_GRAPHQL_EVENT_INVALID', 'GraphQL event sequenceNumber is invalid.');
  }
  const observedType = typeName(event.contents.type.repr, 'event.contents.type.repr');
  if (observedType !== typeName(expectedType, 'expectedEventType')) {
    fail('MAKER_V8_SUI_GRAPHQL_EVENT_DRIFT', 'GraphQL event type differs from its discovery filter.', {
      expectedType,
      observedType,
    });
  }
  if (!plain(event.contents.json)) {
    fail('MAKER_V8_SUI_GRAPHQL_EVENT_INVALID', 'GraphQL event JSON payload must be one Move struct record.');
  }
  const transactionDigest = digest(event.transaction.digest, 'event.transaction.digest');
  const timestamp = Date.parse(boundedText(event.timestamp, 'event.timestamp'));
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    fail('MAKER_V8_SUI_GRAPHQL_EVENT_INVALID', 'GraphQL event timestamp is invalid.');
  }
  return Object.freeze({
    id: Object.freeze({ txDigest: transactionDigest, eventSeq: String(event.sequenceNumber) }),
    packageId: address(event.transactionModule.package.address, 'event.transactionModule.package.address'),
    transactionModule: boundedText(event.transactionModule.name, 'event.transactionModule.name'),
    sender: address(event.sender.address, 'event.sender.address'),
    type: observedType,
    parsedJson: event.contents.json,
    bcs: canonicalBase64(event.contents.bcs, 'event.contents.bcs'),
    timestampMs: String(timestamp),
    eventBcs: event.eventBcs == null ? null : canonicalBase64(event.eventBcs, 'event.eventBcs'),
    discoverySource: MAKER_V8_SUI_EVENT_DISCOVERY_SOURCE,
  });
}

function assertGrpcClient(client) {
  const methods = ['getObject', 'listOwnedObjects', 'listCoins', 'getBalance'];
  if (!client || client.network !== 'mainnet' || !client.core || typeof client.core !== 'object'
    || !client.ledgerService || typeof client.ledgerService !== 'object'
    || methods.some((name) => typeof client[name] !== 'function')
    || ['getTransaction', 'getProtocolConfig', 'getCurrentSystemState'].some((name) => typeof client.core[name] !== 'function')
    || ['getObject', 'getTransaction', 'getServiceInfo', 'getCheckpoint'].some((name) => typeof client.ledgerService[name] !== 'function')) {
    fail('MAKER_V8_SUI_GRPC_CLIENT_INVALID', 'An exact read-capable SuiGrpcClient surface is required.');
  }
  return client;
}

function assertGraphQLClient(client) {
  if (!client || client.network !== 'mainnet' || typeof client.query !== 'function') {
    fail('MAKER_V8_SUI_GRAPHQL_CLIENT_INVALID', 'An exact Mainnet SuiGraphQLClient query surface is required.');
  }
  return client;
}

export function isMakerV8SuiGrpcTransport(value) {
  return Boolean(value) && value[TRANSPORT_BRAND] === true
    && value.schemaVersion === MAKER_V8_SUI_GRPC_SCHEMA
    && value.network === 'mainnet'
    && value.chainIdentifier === MAKER_V8_SUI_MAINNET_GENESIS_DIGEST;
}

export function assertMakerV8SuiGrpcTransport(value) {
  if (!isMakerV8SuiGrpcTransport(value)) {
    fail('MAKER_V8_SUI_GRPC_TRANSPORT_INVALID', 'A branded strict Maker v8 Sui gRPC transport is required.');
  }
  return value;
}

export function createMakerV8SuiGrpcTransport({
  grpcClient,
  graphqlClient,
  grpcEndpoint = MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  graphqlEndpoint = MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT,
} = {}) {
  const grpc = assertGrpcClient(grpcClient);
  const graphql = assertGraphQLClient(graphqlClient);
  const authoritativeEndpoint = endpoint(grpcEndpoint, 'grpcEndpoint');
  const discoveryEndpoint = endpoint(graphqlEndpoint, 'graphqlEndpoint');

  const readServiceInfo = async () => serviceInfo(await unary(
      grpc.ledgerService.getServiceInfo({}),
      'ledgerService.getServiceInfo',
    ));
  let pinnedServiceInfo = null;
  const ensurePinnedMainnet = async () => {
    if (pinnedServiceInfo === null) {
      pinnedServiceInfo = readServiceInfo().catch((error) => {
        pinnedServiceInfo = null;
        throw error;
      });
    }
    return pinnedServiceInfo;
  };
  const getServiceInfo = async () => {
    const info = await readServiceInfo();
    pinnedServiceInfo = Promise.resolve(info);
    return info;
  };

  const getCheckpoint = async (input) => {
    await ensurePinnedMainnet();
    if (!plain(input)) fail('MAKER_V8_SUI_GRPC_CHECKPOINT_REQUEST_INVALID', 'Checkpoint request is required.');
    const hasSequence = Object.hasOwn(input, 'sequenceNumber');
    const hasDigest = Object.hasOwn(input, 'digest');
    if (hasSequence === hasDigest) {
      fail('MAKER_V8_SUI_GRPC_CHECKPOINT_REQUEST_INVALID', 'Checkpoint request must contain exactly one identifier.');
    }
    const requested = hasSequence
      ? { sequenceNumber: uint64(input.sequenceNumber, 'checkpoint.sequenceNumber') }
      : { digest: digest(input.digest, 'checkpoint.digest') };
    const checkpointId = hasSequence
      ? { oneofKind: 'sequenceNumber', sequenceNumber: requested.sequenceNumber }
      : { oneofKind: 'digest', digest: requested.digest };
    const response = await unary(grpc.ledgerService.getCheckpoint({
      checkpointId,
      readMask: { paths: ['sequence_number', 'digest'] },
    }), 'ledgerService.getCheckpoint');
    return checkpoint(response, requested);
  };

  const getChainIdentifier = async () => ({
    chainIdentifier: (await getServiceInfo()).chainIdentifier,
  });

  const getObject = async (input) => {
    await ensurePinnedMainnet();
    if (!plain(input)) fail('MAKER_V8_SUI_GRPC_OBJECT_REQUEST_INVALID', 'Object request is required.');
    const objectId = address(input.id ?? input.objectId, 'objectId');
    if (input.id != null && input.objectId != null && input.id !== input.objectId) {
      fail('MAKER_V8_SUI_GRPC_OBJECT_REQUEST_INVALID', 'Object request contains conflicting IDs.');
    }
    const options = plain(input.options) ? input.options : {};
    const response = await grpc.getObject({
      objectId,
      include: { content: true, json: true, previousTransaction: true, objectBcs: options.showBcs === true },
    });
    const object = response?.object;
    const reference = currentReference(object, 'object');
    if (reference.objectId !== objectId) {
      fail('MAKER_V8_SUI_GRPC_OBJECT_DRIFT', 'Core getObject returned another object ID.');
    }
    if (object.type !== 'package') return normalizeMakerV8CurrentMoveObject(object, options);
    const raw = await unary(grpc.ledgerService.getObject({
      objectId,
      readMask: {
        paths: [
          'object_id', 'version', 'digest', 'owner', 'object_type', 'previous_transaction',
          'package',
        ],
      },
    }), 'ledgerService.getObject(package)');
    return normalizeMakerV8RawPackageObject(raw.object, reference);
  };

  const getOwnedObjects = async (input) => {
    await ensurePinnedMainnet();
    if (!plain(input)) fail('MAKER_V8_SUI_GRPC_OWNED_REQUEST_INVALID', 'Owned-object request is required.');
    const owner = address(input.owner, 'owner');
    const filter = input.filter == null ? null : input.filter;
    if (filter !== null && (!plain(filter) || Object.keys(filter).length !== 1 || typeof filter.StructType !== 'string')) {
      fail('MAKER_V8_SUI_GRPC_OWNED_FILTER_INVALID', 'Only one exact StructType owned-object filter is supported.');
    }
    const options = plain(input.options) ? input.options : {};
    const response = await grpc.listOwnedObjects({
      owner,
      type: filter === null ? undefined : typeName(filter.StructType, 'filter.StructType'),
      cursor: input.cursor ?? null,
      limit: input.limit,
      include: { content: true, json: true, previousTransaction: true, objectBcs: options.showBcs === true },
    });
    if (!plain(response) || !Array.isArray(response.objects)
      || typeof response.hasNextPage !== 'boolean'
      || !(response.cursor === null || typeof response.cursor === 'string')) {
      fail('MAKER_V8_SUI_GRPC_PAGE_INVALID', 'Core listOwnedObjects returned an invalid page.');
    }
    return Object.freeze({
      data: Object.freeze(response.objects.map((object) => normalizeMakerV8CurrentMoveObject(object, options))),
      nextCursor: response.cursor,
      hasNextPage: response.hasNextPage,
    });
  };

  const getCoins = async (input) => {
    await ensurePinnedMainnet();
    if (!plain(input)) fail('MAKER_V8_SUI_GRPC_COINS_REQUEST_INVALID', 'Coin request is required.');
    const response = await grpc.listCoins({
      owner: address(input.owner, 'owner'),
      coinType: input.coinType == null ? undefined : typeName(input.coinType, 'coinType'),
      cursor: input.cursor ?? null,
      limit: input.limit,
    });
    if (!plain(response) || !Array.isArray(response.objects)
      || typeof response.hasNextPage !== 'boolean'
      || !(response.cursor === null || typeof response.cursor === 'string')) {
      fail('MAKER_V8_SUI_GRPC_PAGE_INVALID', 'Core listCoins returned an invalid page.');
    }
    return Object.freeze({
      data: Object.freeze(response.objects.map((coin, index) => {
        const reference = currentReference(coin, `coins[${index}]`);
        coreOwner(coin.owner, `coins[${index}].owner`);
        return Object.freeze({
          coinType: (() => {
            const tag = parseStructTag(typeName(coin.type, `coins[${index}].type`));
            if (tag.module !== 'coin' || tag.name !== 'Coin' || tag.typeParams.length !== 1) {
              fail('MAKER_V8_SUI_GRPC_COIN_TYPE_INVALID', `coins[${index}].type is not Coin<T>.`);
            }
            return normalizeStructTag(tag.typeParams[0]);
          })(),
          coinObjectId: reference.objectId,
          version: reference.version,
          digest: reference.digest,
          balance: decimal(coin.balance, `coins[${index}].balance`),
          previousTransaction: null,
        });
      })),
      nextCursor: response.cursor,
      hasNextPage: response.hasNextPage,
    });
  };

  const getProtocolConfig = async () => {
    await ensurePinnedMainnet();
    const response = await grpc.core.getProtocolConfig();
    const profile = response?.protocolConfig;
    if (!plain(profile) || !plain(profile.attributes) || !plain(profile.featureFlags)) {
      fail('MAKER_V8_SUI_GRPC_PROTOCOL_INVALID', 'Core protocol config has an invalid exact shape.');
    }
    const attributes = Object.fromEntries(Object.entries(profile.attributes).map(([name, value]) => {
      boundedText(name, 'protocol.attribute.name');
      if (value === null) return [name, null];
      return [name, Object.freeze({ u64: decimal(value, `protocol.attributes.${name}`) })];
    }));
    for (const [name, value] of Object.entries(profile.featureFlags)) {
      boundedText(name, 'protocol.featureFlag.name');
      if (typeof value !== 'boolean') {
        fail('MAKER_V8_SUI_GRPC_PROTOCOL_INVALID', `protocol.featureFlags.${name} must be boolean.`);
      }
    }
    return Object.freeze({
      protocolVersion: decimal(profile.protocolVersion, 'protocol.protocolVersion', { positive: true }),
      featureFlags: Object.freeze({ ...profile.featureFlags }),
      attributes: Object.freeze(attributes),
    });
  };

  const getLatestSuiSystemState = async () => {
    await ensurePinnedMainnet();
    const response = await grpc.core.getCurrentSystemState();
    return Object.freeze({ epoch: decimal(response?.systemState?.epoch, 'systemState.epoch') });
  };

  const getHistoricalObject = async (input) => {
    await ensurePinnedMainnet();
    if (!plain(input)) fail('MAKER_V8_SUI_GRPC_HISTORY_REQUEST_INVALID', 'Historical object request is required.');
    const requested = {
      objectId: address(input.objectId, 'historical.objectId'),
      version: uint64(input.version, 'historical.version', { positive: true }),
    };
    const response = await unary(grpc.ledgerService.getObject({
      objectId: requested.objectId,
      version: requested.version,
      readMask: {
        paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'previous_transaction', 'contents', 'bcs'],
      },
    }), 'ledgerService.getObject(historical)');
    return normalizeMakerV8HistoricalObject(response.object, requested);
  };

  const getFinalizedTransactionEvidence = async (input) => {
    await ensurePinnedMainnet();
    if (!plain(input)) fail('MAKER_V8_SUI_GRPC_TRANSACTION_REQUEST_INVALID', 'Transaction request is required.');
    const expectedDigest = digest(input.digest, 'transaction.digest');
    const response = await unary(grpc.ledgerService.getTransaction({
      digest: expectedDigest,
      readMask: {
        paths: [
          'digest', 'checkpoint', 'transaction.digest', 'transaction.bcs', 'signatures',
          'effects.bcs', 'effects.digest', 'effects.status', 'effects.epoch',
          'effects.transaction_digest', 'effects.events_digest', 'events.bcs', 'events.digest',
        ],
      },
    }), 'ledgerService.getTransaction');
    return normalizeMakerV8FinalizedTransactionEvidence(response.transaction, expectedDigest);
  };

  const discoverEvents = async ({ type, cursor = null, limit = 50, order = 'descending', signal } = {}) => {
    const eventType = typeName(type, 'event.type');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      fail('MAKER_V8_SUI_GRAPHQL_PAGE_SIZE_INVALID', 'GraphQL event page size must be within 1..100.');
    }
    if (!['ascending', 'descending'].includes(order) || !(cursor === null || typeof cursor === 'string')) {
      fail('MAKER_V8_SUI_GRAPHQL_PAGE_INVALID', 'GraphQL event pagination request is invalid.');
    }
    const descending = order === 'descending';
    const result = await graphql.query({
      query: MAKER_V8_SUI_EVENT_DISCOVERY_QUERY,
      variables: {
        first: descending ? null : limit,
        after: descending ? null : cursor,
        last: descending ? limit : null,
        before: descending ? cursor : null,
        filter: { type: eventType },
      },
      operationName: 'MakerV8EventDiscovery',
      signal,
    });
    if (Array.isArray(result?.errors) && result.errors.length > 0) {
      fail('MAKER_V8_SUI_GRAPHQL_REQUEST_FAILED', 'GraphQL event discovery returned errors.', {
        errors: result.errors.map((error) => String(error?.message ?? error)),
      });
    }
    if (result?.data?.chainIdentifier !== MAKER_V8_SUI_MAINNET_GENESIS_DIGEST) {
      fail('MAKER_V8_SUI_GRAPHQL_CHAIN_MISMATCH', 'GraphQL event index is not the pinned Sui Mainnet genesis.', {
        observedChainIdentifier: result?.data?.chainIdentifier ?? null,
      });
    }
    const connection = result?.data?.events;
    if (!plain(connection) || !plain(connection.pageInfo) || !Array.isArray(connection.edges)
      || typeof connection.pageInfo.hasNextPage !== 'boolean'
      || typeof connection.pageInfo.hasPreviousPage !== 'boolean') {
      fail('MAKER_V8_SUI_GRAPHQL_PAGE_INVALID', 'GraphQL event discovery returned an invalid connection.');
    }
    const orderedEdges = descending ? [...connection.edges].reverse() : [...connection.edges];
    const seen = new Set();
    const data = orderedEdges.map((edge, index) => {
      if (!plain(edge) || typeof edge.cursor !== 'string') {
        fail('MAKER_V8_SUI_GRAPHQL_PAGE_INVALID', `GraphQL event edge ${index} is invalid.`);
      }
      const event = normalizeMakerV8GraphQLEvent(edge.node, eventType);
      const key = `${event.id.txDigest}:${event.id.eventSeq}`;
      if (seen.has(key)) fail('MAKER_V8_SUI_GRAPHQL_EVENT_DUPLICATE', 'GraphQL event page contains a duplicate event ID.');
      seen.add(key);
      return event;
    });
    const hasNextPage = descending
      ? connection.pageInfo.hasPreviousPage
      : connection.pageInfo.hasNextPage;
    const nextCursor = hasNextPage
      ? (descending ? connection.pageInfo.startCursor : connection.pageInfo.endCursor)
      : null;
    if (hasNextPage && (typeof nextCursor !== 'string' || nextCursor.length === 0)) {
      fail('MAKER_V8_SUI_GRAPHQL_PAGE_INVALID', 'GraphQL event page omitted its continuation cursor.');
    }
    return Object.freeze({ data: Object.freeze(data), nextCursor, hasNextPage });
  };

  const queryEvents = async (input) => {
    if (!plain(input) || !plain(input.query) || Object.keys(input.query).length !== 1
      || typeof input.query.MoveEventType !== 'string') {
      fail('MAKER_V8_SUI_GRAPHQL_FILTER_INVALID', 'Only exact MoveEventType discovery is supported.');
    }
    return discoverEvents({
      type: input.query.MoveEventType,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
      order: input.order ?? 'descending',
      signal: input.signal,
    });
  };

  const getCheckpointWatermark = async () => {
    const info = await getServiceInfo();
    const latest = await getCheckpoint({ sequenceNumber: BigInt(info.checkpointHeight) });
    return Object.freeze({
      schemaVersion: MAKER_V8_SUI_GRPC_SCHEMA,
      chainIdentifier: info.chainIdentifier,
      epoch: info.epoch,
      checkpoint: latest,
      lowestAvailableCheckpoint: info.lowestAvailableCheckpoint,
      lowestAvailableCheckpointObjects: info.lowestAvailableCheckpointObjects,
    });
  };

  const readOnlyCore = Object.freeze({
    getObjects: grpc.core.getObjects && (async (input) => {
      await ensurePinnedMainnet();
      return grpc.core.getObjects(input);
    }),
    listOwnedObjects: grpc.core.listOwnedObjects && (async (input) => {
      await ensurePinnedMainnet();
      return grpc.core.listOwnedObjects(input);
    }),
    listCoins: grpc.core.listCoins && (async (input) => {
      await ensurePinnedMainnet();
      return grpc.core.listCoins(input);
    }),
    getBalance: grpc.core.getBalance && (async (input) => {
      await ensurePinnedMainnet();
      return grpc.core.getBalance(input);
    }),
    getTransaction: async (input) => {
      await ensurePinnedMainnet();
      return grpc.core.getTransaction(input);
    },
    getProtocolConfig: async () => {
      await ensurePinnedMainnet();
      return grpc.core.getProtocolConfig();
    },
    getCurrentSystemState: async () => {
      await ensurePinnedMainnet();
      return grpc.core.getCurrentSystemState();
    },
    getChainIdentifier,
  });

  return Object.freeze({
    get [TRANSPORT_BRAND]() { return true; },
    schemaVersion: MAKER_V8_SUI_GRPC_SCHEMA,
    network: 'mainnet',
    chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
    authoritativeSource: 'SuiGrpcClient',
    eventDiscoverySource: 'SuiGraphQLClient',
    grpcEndpoint: authoritativeEndpoint,
    graphqlEndpoint: discoveryEndpoint,
    core: readOnlyCore,
    getChainIdentifier,
    getObject,
    getOwnedObjects,
    getCoins,
    getBalance: async (input) => {
      await ensurePinnedMainnet();
      return grpc.getBalance(input);
    },
    listOwnedObjects: async (input) => {
      await ensurePinnedMainnet();
      return grpc.listOwnedObjects(input);
    },
    listCoins: async (input) => {
      await ensurePinnedMainnet();
      return grpc.listCoins(input);
    },
    getProtocolConfig,
    getLatestSuiSystemState,
    getHistoricalObject,
    getFinalizedTransactionEvidence,
    getServiceInfo,
    getCheckpoint,
    getCheckpointWatermark,
    discoverEvents,
    queryEvents,
  });
}

export function createProductionMakerV8SuiGrpcTransport({
  grpcEndpoint = MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  graphqlEndpoint = MAKER_V8_SUI_GRAPHQL_MAINNET_ENDPOINT,
  graphqlFetch,
} = {}) {
  const authoritativeEndpoint = endpoint(grpcEndpoint, 'grpcEndpoint');
  const discoveryEndpoint = endpoint(graphqlEndpoint, 'graphqlEndpoint');
  const grpcClient = new SuiGrpcClient({ network: 'mainnet', baseUrl: authoritativeEndpoint });
  const graphqlClient = new SuiGraphQLClient({
    network: 'mainnet',
    url: discoveryEndpoint,
    ...(graphqlFetch === undefined ? {} : { fetch: graphqlFetch }),
  });
  if (!isSuiGrpcClient(grpcClient) || !isSuiGraphQLClient(graphqlClient)) {
    fail('MAKER_V8_SUI_OFFICIAL_CLIENT_REQUIRED', 'Production transport requires official branded Sui SDK clients.');
  }
  return createMakerV8SuiGrpcTransport({
    grpcClient,
    graphqlClient,
    grpcEndpoint: authoritativeEndpoint,
    graphqlEndpoint: discoveryEndpoint,
  });
}
