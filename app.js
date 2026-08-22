import {
  MAKER_V8_ROLES,
  makerV8StableType,
} from './maker-v8-runtime.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
  isMakerV8RuntimeAttested,
  makerV8AttestedPackageTuple,
} from './maker-v8-chain.js';
import { classifyFreshV8Error } from './chain-error-ui.js';
import {
  MAKER_V8_ACTIONS as SHARED_MAKER_V8_ACTIONS,
  makerV8ActionV8,
} from './maker-v8-actions.js';
import { assertFinalizedMarketReadbackV8 as assertCoreV2FinalizedMarketReadbackV8 } from './maker-v8-finalized.js';
import * as productionBrowserModule from './maker-v8-browser.js';
import * as productionMarketModule from './maker-v8-market.js';
import * as productionRecoveryModule from './maker-v8-recovery.js';

export const WEB_V8_CONTEXT_SCHEMA = 'animacraft.web-market-context.v8';
export const WEB_V8_ROUTE_SCHEMA = 'animacraft.web-route-view.v8';
export const WEB_V8_BROWSE_SCHEMA = 'animacraft.web-market-browse.v8';
export const WEB_V8_INVENTORY_SCHEMA = 'animacraft.web-owned-inventory.v8';
export const WEB_V8_EXECUTION_SCHEMA = 'animacraft.web-execution.v8';
export const WEB_V8_CACHE_SCHEMA = 'animacraft.web-cache.v8';
export const WEB_V8_READBACK_SCHEMA = 'animacraft.web-market-finalized-readback.v8';
export const UNSUPPORTED_PRODUCT_CODE = 'UNSUPPORTED_LEGACY_PRODUCT';
const MAKER_V8_CHAIN_SCHEMA = 'animacraft.maker-v8-chain.v8';

const EXACT_SUI_ID = /^0x[0-9a-f]{64}$/;
const CANONICAL_U64 = /^(?:0|[1-9][0-9]*)$/;
const CACHE_PREFIX = 'soulidity:fresh-maker-v8:';
const ROOT_LIFECYCLES = Object.freeze(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
const QUOTE_FIELDS = Object.freeze([
  'grossAtomic',
  'protocolAtomic',
  'creatorAtomic',
  'sourceAtomic',
  'sellerAtomic',
]);
const PURCHASE_ACTIONS = new Set([
  'purchaseMakerControl',
  'purchaseSoulBundle',
  'purchaseBasePhysical',
  'purchasePackPhysical',
]);
const LIST_ACTIONS = new Set([
  'listMakerControl',
  'listSoulBundle',
  'listBasePhysical',
  'listPackPhysical',
]);
const FROZEN_LISTING_ACTIONS = new Set([
  'cancelMakerControl',
  'recoverMakerControl',
  'cancelSoulListing',
  'recoverSoulListing',
  'cancelPhysicalListing',
  'recoverPhysicalListing',
]);
const OWNED_INVENTORY_ACTIONS = new Set([
  'listSoulBundle',
  'listBasePhysical',
  'listPackPhysical',
]);
const MAKER_TREASURY_ACTIONS = new Set([
  'listMakerControl',
  'listBasePhysical',
  'purchaseSoulBundle',
  'purchaseBasePhysical',
]);

export const MARKET_V8_ACTIONS = SHARED_MAKER_V8_ACTIONS;

function appError(code, message, layer = 'VALIDATION', details = undefined) {
  const error = new Error(message);
  error.name = 'FreshV8WebError';
  error.code = code;
  error.layer = layer;
  if (details !== undefined) error.details = details;
  return error;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function exactKeys(value, fields, label) {
  if (!isPlainRecord(value)) {
    throw appError('WEB_V8_RECORD_INVALID', `${label} must be a plain record.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw appError(
      'WEB_V8_FIELDS_INVALID',
      `${label} must contain exactly: ${expected.join(', ')}.`,
      'VALIDATION',
      { actual, expected },
    );
  }
}

function exactId(value, label) {
  if (typeof value !== 'string' || !EXACT_SUI_ID.test(value) || /^0x0+$/.test(value)) {
    throw appError('WEB_V8_ID_INVALID', `${label} must be an exact lowercase non-zero Sui ID.`);
  }
  return value;
}

function exactText(value, label, maximum = 512) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw appError('WEB_V8_TEXT_INVALID', `${label} must be an exact non-empty string.`);
  }
  return value;
}

function exactU64(value, label) {
  const raw = typeof value === 'bigint' ? value.toString() : value;
  if (typeof raw !== 'string' || !CANONICAL_U64.test(raw) || BigInt(raw) >= (1n << 64n)) {
    throw appError('WEB_V8_U64_INVALID', `${label} must be a canonical u64 decimal string.`);
  }
  return raw;
}

function exactU8(value, label) {
  const normalized = typeof value === 'number' && Number.isInteger(value) ? String(value) : exactU64(value, label);
  if (!CANONICAL_U64.test(normalized) || BigInt(normalized) > 255n) {
    throw appError('WEB_V8_U8_INVALID', `${label} must be a canonical u8 value.`);
  }
  return Number(normalized);
}

async function readCurrentMainnetEpoch(client) {
  let value;
  if (typeof client?.core?.getCurrentSystemState === 'function') {
    value = (await client.core.getCurrentSystemState())?.systemState?.epoch;
  } else if (typeof client?.getLatestSuiSystemState === 'function') {
    value = (await client.getLatestSuiSystemState())?.epoch;
  } else if (typeof client?.getCurrentEpoch === 'function') {
    value = (await client.getCurrentEpoch())?.epoch;
  } else {
    throw appError('WEB_V8_CURRENT_EPOCH_UNAVAILABLE', 'Current Mainnet epoch is unavailable.', 'CONTEXT');
  }
  return exactU64(String(value ?? ''), 'currentEpoch');
}

function stableJson(value) {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(value[key])}`
  )).join(',')}}`;
}

function clonePublic(value) {
  return JSON.parse(stableJson(value));
}

function actionById(value) {
  const action = makerV8ActionV8(value);
  if (!action) throw appError('WEB_V8_ACTION_UNKNOWN', 'The selected Market action is not one of the fourteen v8 actions.');
  return action;
}

function objectRef(value, label) {
  exactKeys(value, ['id', 'version', 'digest'], label);
  return Object.freeze({
    id: exactId(value.id, `${label}.id`),
    version: exactU64(value.version, `${label}.version`),
    digest: exactText(value.digest, `${label}.digest`),
  });
}

function routeIdentity(route) {
  return `${route.kind}:${route.id || ''}`;
}

export function parseFreshV8Route(input, base = 'https://animacraft.invalid') {
  let url;
  try {
    url = new URL(String(input || '/'), base);
  } catch {
    return Object.freeze({ valid: false, code: UNSUPPORTED_PRODUCT_CODE, path: String(input || '') });
  }
  if (url.search || url.hash || /%2f|%5c/i.test(url.pathname)) {
    return Object.freeze({ valid: false, code: UNSUPPORTED_PRODUCT_CODE, path: url.pathname });
  }
  if (url.pathname === '/' || url.pathname === '/market' || url.pathname === '/market/') {
    return Object.freeze({ valid: true, kind: 'market', id: null, canonicalPath: '/market' });
  }
  const listing = /^\/market\/(0x[0-9a-f]{64})\/?$/.exec(url.pathname);
  if (listing) {
    return Object.freeze({ valid: true, kind: 'listing', id: exactId(listing[1], 'listingId'), canonicalPath: `/market/${listing[1]}` });
  }
  const maker = /^\/maker\/(0x[0-9a-f]{64})\/?$/.exec(url.pathname);
  if (maker) {
    return Object.freeze({ valid: true, kind: 'maker', id: exactId(maker[1], 'rootId'), canonicalPath: `/maker/${maker[1]}` });
  }
  return Object.freeze({ valid: false, code: UNSUPPORTED_PRODUCT_CODE, path: url.pathname });
}

export function inspectFreshV8Cache(storage) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function'
    || typeof storage.getItem !== 'function') return Object.freeze({ valid: true, entries: Object.freeze([]) });
  const entries = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key !== 'string' || !key.startsWith('soulidity:')) continue;
    if (!key.startsWith(CACHE_PREFIX)) {
      entries.push(Object.freeze({ key, code: UNSUPPORTED_PRODUCT_CODE }));
      continue;
    }
    try {
      const value = JSON.parse(storage.getItem(key));
      if (!isPlainRecord(value) || value.schemaVersion !== WEB_V8_CACHE_SCHEMA) {
        entries.push(Object.freeze({ key, code: UNSUPPORTED_PRODUCT_CODE }));
      }
    } catch {
      entries.push(Object.freeze({ key, code: 'WEB_V8_CACHE_INVALID' }));
    }
  }
  return Object.freeze({ valid: entries.length === 0, entries: Object.freeze(entries) });
}

export function assertWebV8ExecutionConfig(value) {
  exactKeys(value, [
    'schemaVersion',
    'network',
    'chainIdentifier',
    'allowWalletSignature',
    'allowBroadcast',
  ], 'Web v8 execution config');
  if (value.schemaVersion !== WEB_V8_EXECUTION_SCHEMA) {
    throw appError('WEB_V8_EXECUTION_SCHEMA_INVALID', `schemaVersion must equal ${WEB_V8_EXECUTION_SCHEMA}.`);
  }
  const network = exactText(value.network, 'network').toLowerCase();
  if (!['mainnet', 'testnet', 'devnet', 'localnet'].includes(network)) {
    throw appError('WEB_V8_NETWORK_INVALID', 'network must name one supported Sui network.');
  }
  const chainIdentifier = exactText(value.chainIdentifier, 'chainIdentifier');
  if (chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
    throw appError('WEB_V8_CHAIN_ID_INVALID', 'Execution must pin the exact Sui Mainnet chain identifier.', 'CONFIGURATION');
  }
  if (typeof value.allowWalletSignature !== 'boolean' || typeof value.allowBroadcast !== 'boolean') {
    throw appError('WEB_V8_EXECUTION_FLAG_INVALID', 'Execution flags must be explicit booleans.');
  }
  if (value.allowBroadcast && !value.allowWalletSignature) {
    throw appError('WEB_V8_EXECUTION_FLAG_INVALID', 'Broadcast cannot be enabled while wallet signature is disabled.');
  }
  return Object.freeze({
    schemaVersion: WEB_V8_EXECUTION_SCHEMA,
    network,
    chainIdentifier,
    allowWalletSignature: value.allowWalletSignature,
    allowBroadcast: value.allowBroadcast,
  });
}

export function marketRuntimeFromMakerRuntime(runtime, network) {
  if (network !== undefined && network !== 'mainnet') {
    throw appError('WEB_V8_NETWORK_INVALID', 'The Market v8 client is pinned to mainnet.', 'CONFIGURATION');
  }
  // The Market client consumes the already-validated complete seven-role
  // runtime. It derives its narrower package view internally and cannot be
  // initialized from a caller-built subset.
  return runtime;
}

export async function assertLiveMakerV8Runtime(rawRuntime, rpc) {
  if (!rpc || typeof rpc.getSuiClient !== 'function') {
    throw appError('WEB_V8_RUNTIME_ATTESTATION_REQUIRED', 'A live Sui client is required to attest ProductReleaseCatalog and companion configs.', 'LINEAGE');
  }
  const suiClient = await rpc.getSuiClient();
  const attested = await attestMakerV8Runtime(suiClient, rawRuntime, { network: 'mainnet' });
  return attested.runtime;
}

function assertMethod(record, name, label) {
  if (!record || typeof record[name] !== 'function') {
    throw appError('WEB_V8_ADAPTER_INVALID', `${label}.${name} is required.`, 'CONFIGURATION');
  }
}

export function assertFreshV8Adapters(value) {
  if (!isPlainRecord(value)) throw appError('WEB_V8_ADAPTER_INVALID', 'Fresh v8 adapters must be a plain record.', 'CONFIGURATION');
  for (const group of ['rpc', 'wallet', 'transactions']) {
    if (!isPlainRecord(value[group])) throw appError('WEB_V8_ADAPTER_INVALID', `${group} adapter is required.`, 'CONFIGURATION');
  }
  for (const method of ['getChainIdentifier', 'getSuiClient', 'loadRoute', 'browseMarket', 'loadOwnedInventory', 'loadActionContext', 'queryTransaction', 'readbackMarketAction']) {
    assertMethod(value.rpc, method, 'rpc');
  }
  for (const method of ['getCurrentAccount', 'reconnect', 'signExactTransaction', 'verifyExactSignature']) {
    assertMethod(value.wallet, method, 'wallet');
  }
  for (const method of ['buildExactTransaction', 'deriveTransactionDigest', 'dryRunExactTransaction', 'broadcastExactTransaction']) {
    assertMethod(value.transactions, method, 'transactions');
  }
  return value;
}

export function createSuiV8BrowserAdapters({ client, wallet, dataSource, transactions, persistence }) {
  if (!client || !wallet || !dataSource || !transactions) {
    throw appError('WEB_V8_ADAPTER_INVALID', 'Sui client, wallet, data source, and transaction boundaries are required.', 'CONFIGURATION');
  }
  return assertFreshV8Adapters({
    rpc: {
      getChainIdentifier: () => client.getChainIdentifier(),
      getSuiClient: () => client,
      resolveRoleLineages: (requests) => dataSource.resolveRoleLineages(requests),
      loadRoute: (request) => dataSource.loadRoute(request),
      browseMarket: (request) => dataSource.browseMarket(request),
      loadOwnedInventory: (request) => dataSource.loadOwnedInventory(request),
      loadActionContext: (request) => dataSource.loadActionContext(request),
      queryTransaction: (request) => dataSource.queryTransaction({ client, ...request }),
      readbackMarketAction: (request) => dataSource.readbackMarketAction({ client, ...request }),
    },
    wallet: {
      getCurrentAccount: () => wallet.getCurrentAccount(),
      reconnect: () => wallet.reconnect(),
      signExactTransaction: (request) => wallet.signExactTransaction(request),
      verifyExactSignature: (request) => wallet.verifyExactSignature(request),
    },
    transactions: {
      buildExactTransaction: (request) => transactions.buildExactTransaction({ client, ...request }),
      deriveTransactionDigest: (bytes) => transactions.deriveTransactionDigest(bytes),
      dryRunExactTransaction: (request) => transactions.dryRunExactTransaction({ client, ...request }),
      broadcastExactTransaction: (request) => transactions.broadcastExactTransaction({ client, ...request }),
    },
    ...(persistence ? { persistence } : {}),
  });
}

function assertAccount(value, execution) {
  exactKeys(value, ['address', 'network'], 'Wallet account');
  const address = exactId(value.address, 'Wallet account address');
  if (value.network !== execution.network) {
    throw appError('WEB_V8_WALLET_NETWORK_MISMATCH', 'Wallet network does not match the pinned execution network.', 'CONTEXT');
  }
  return Object.freeze({ address, network: value.network });
}

function assertPackageTuple(value, runtime) {
  if (!Array.isArray(value) || value.length !== MAKER_V8_ROLES.length) {
    throw appError('WEB_V8_PACKAGE_TUPLE_INVALID', 'Live context must bind all seven package roles.', 'BINDING');
  }
  const seen = new Set();
  const attestedByRole = new Map(makerV8AttestedPackageTuple(runtime).map((entry) => [entry.role, entry]));
  const tuple = value.map((entry, index) => {
    exactKeys(entry, ['role', 'originalPackageId', 'callablePackageId', 'packageDigest'], `packageTuple[${index}]`);
    const role = exactText(entry.role, `packageTuple[${index}].role`).toLowerCase();
    if (!MAKER_V8_ROLES.includes(role) || seen.has(role)) {
      throw appError('WEB_V8_PACKAGE_TUPLE_INVALID', 'Package tuple roles must be the unique seven-role set.', 'BINDING');
    }
    seen.add(role);
    const originalPackageId = exactId(entry.originalPackageId, `${role}.originalPackageId`);
    const callablePackageId = exactId(entry.callablePackageId, `${role}.callablePackageId`);
    const packageDigest = exactText(entry.packageDigest, `${role}.packageDigest`);
    if (originalPackageId !== runtime.roles[role].typeOriginPackageId
      || callablePackageId !== runtime.roles[role].callablePackageId
      || packageDigest !== attestedByRole.get(role)?.packageDigest) {
      throw appError('WEB_V8_PACKAGE_TUPLE_DRIFT', `${role} package identity drifted from the runtime gate.`, 'CONTEXT');
    }
    return Object.freeze({
      role: role.toUpperCase(),
      originalPackageId,
      callablePackageId,
      packageDigest,
    });
  });
  return Object.freeze(tuple.sort((left, right) => left.role.localeCompare(right.role)));
}

function assertAuthority(value) {
  exactKeys(value, ['kind', 'refs'], 'Lane authority');
  const kind = exactText(value.kind, 'Lane authority kind').toUpperCase();
  if (!Array.isArray(value.refs) || !value.refs.length) {
    throw appError('WEB_V8_AUTHORITY_INVALID', 'Lane authority must contain live object references.', 'AUTHORITY');
  }
  return Object.freeze({
    kind,
    refs: Object.freeze(value.refs.map((entry, index) => objectRef(entry, `authority.refs[${index}]`))),
  });
}

function assertActivation(value, runtime, rootRef) {
  exactKeys(value, ['eventType', 'rootId', 'lifecycle'], 'Maker activation');
  const expectedType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  if (value.eventType !== expectedType) {
    throw appError('WEB_V8_ACTIVATION_EVENT_MISMATCH', 'Discovery did not use the exact MakerV8Activated stable TypeOrigin.', 'BINDING');
  }
  if (exactId(value.rootId, 'activation.rootId') !== rootRef.id) {
    throw appError('WEB_V8_ACTIVATION_ROOT_MISMATCH', 'Activation event and live Root do not match.', 'CONTEXT');
  }
  if (value.lifecycle !== 'ACTIVE') {
    throw appError('WEB_V8_ROOT_NOT_ACTIVE', 'Public Maker discovery requires an exact ACTIVE Root.', 'ELIGIBILITY');
  }
  return Object.freeze({ eventType: expectedType, rootId: rootRef.id, lifecycle: 'ACTIVE' });
}

function assertMarketParsedRef(value, kind, ref, execution, label) {
  if (!isPlainRecord(value) || value.kind !== kind || value.network !== execution.network
    || exactId(value.objectId, `${label}.objectId`) !== ref.id
    || exactU64(value.objectVersion, `${label}.objectVersion`) !== ref.version
    || exactText(value.digest, `${label}.digest`) !== ref.digest) {
    throw appError('WEB_V8_MARKET_READBACK_MISMATCH', `${label} must be the exact parsed live Market object.`, 'CONTEXT');
  }
  return value;
}

function assertChainParsedRef(value, ref, execution, label) {
  if (!isPlainRecord(value) || value.schemaVersion !== MAKER_V8_CHAIN_SCHEMA
    || value.network !== execution.network
    || exactId(value.objectId, `${label}.objectId`) !== ref.id
    || exactU64(value.version, `${label}.version`) !== ref.version
    || exactText(value.digest, `${label}.digest`) !== ref.digest
    || typeof value.type !== 'string') {
    throw appError('WEB_V8_CHAIN_READBACK_MISMATCH', `${label} must be an exact maker-v8-chain parsed object.`, 'CONTEXT');
  }
  return value;
}

function assertChainParsedObject(value, expectedId, execution, label) {
  if (!isPlainRecord(value) || value.schemaVersion !== MAKER_V8_CHAIN_SCHEMA
    || value.network !== execution.network) {
    throw appError('WEB_V8_CHAIN_READBACK_MISMATCH', `${label} must be an exact maker-v8-chain parsed object.`, 'CONTEXT');
  }
  if (exactId(value.objectId, `${label}.objectId`) !== expectedId) {
    throw appError('WEB_V8_CHAIN_READBACK_MISMATCH', `${label} does not match its verified binding.`, 'CONTEXT');
  }
  exactU64(value.version, `${label}.version`);
  exactText(value.digest, `${label}.digest`);
  exactText(value.type, `${label}.type`);
  return value;
}

function assertTypedLiveObject(value, expectedId, execution, label) {
  if (!isPlainRecord(value) || value.network !== execution.network
    || exactId(value.objectId, `${label}.objectId`) !== expectedId) {
    throw appError('WEB_V8_OBJECT_BINDING_MISMATCH', `${label} does not match the live typed object binding.`, 'CUSTODY');
  }
  exactText(value.type, `${label}.type`);
  return value;
}

function assertVerifiedBuilderState(builderInput, action, refs, runtime, execution) {
  assertMarketParsedRef(builderInput.registry, 'MarketRegistryV8', refs.registry, execution, 'registry');
  assertMarketParsedRef(builderInput.treasury, 'MarketTreasuryV8', refs.treasury, execution, 'treasury');
  const root = assertChainParsedRef(builderInput.root, refs.root, execution, 'root');
  exactU8(root.lifecycleCode, 'root.lifecycleCode');
  if (!isPlainRecord(root.binding)) {
    throw appError('WEB_V8_ROOT_BINDING_REQUIRED', 'Verified Root capability bindings are required.', 'BINDING');
  }
  const makerTreasuryId = exactId(root.binding.makerTreasuryId, 'root.binding.makerTreasuryId');

  const protocolConfig = assertChainParsedObject(
    builderInput.protocolConfig,
    runtime.protocolConfigId,
    execution,
    'protocolConfig',
  );
  if (typeof protocolConfig.enabled !== 'boolean') {
    throw appError('WEB_V8_PROTOCOL_READBACK_INVALID', 'Protocol enabled state must come from verified readback.', 'CONTEXT');
  }
  exactU64(protocolConfig.revision, 'protocolConfig.revision');
  exactText(protocolConfig.commitment, 'protocolConfig.commitment');

  if (PURCHASE_ACTIONS.has(action.id) && hasOwn(builderInput, 'payment')) {
    throw appError(
      'MARKET_V8_CALLER_PAYMENT_FORBIDDEN',
      'Payment coin IDs and balances must be derived by the exact-balance Transaction intent.',
      'VALIDATION',
    );
  }

  if (!LIST_ACTIONS.has(action.id)) {
    const expectedListingKind = action.lane === 'MAKER'
      ? 'MakerListingV8'
      : action.lane === 'SOUL' ? 'SoulListingV8' : 'PhysicalListingV8';
    assertMarketParsedRef(builderInput.listing, expectedListingKind, refs.primary, execution, 'listing');
  }

  if (MAKER_TREASURY_ACTIONS.has(action.id)) {
    const makerTreasury = assertChainParsedObject(
      builderInput.makerTreasury,
      makerTreasuryId,
      execution,
      'makerTreasury',
    );
    exactU64(makerTreasury.balanceAtomic, 'makerTreasury.balanceAtomic');
  }

  if (action.id === 'listBasePhysical' || action.id === 'listPackPhysical') {
    const assetId = exactId(builderInput.asset?.objectId, 'asset.objectId');
    const asset = assertChainParsedObject(builderInput.asset, assetId, execution, 'asset');
    const sourceKind = exactU8(asset.sourceKind, 'asset.sourceKind');
    if (!hasOwn(asset, 'sourceTreasuryId')) {
      throw appError('WEB_V8_PHYSICAL_SOURCE_REQUIRED', 'Physical provenance must include sourceTreasuryId.', 'CUSTODY');
    }
    if (action.id === 'listBasePhysical') {
      if (sourceKind !== 0 || asset.sourceTreasuryId !== null
        || exactId(builderInput.makerTreasury?.objectId, 'makerTreasury.objectId') !== makerTreasuryId) {
        throw appError('WEB_V8_PHYSICAL_SOURCE_MISMATCH', 'Base Physical provenance must bind the verified MakerTreasury and no Pack treasury.', 'CUSTODY');
      }
    } else {
      const packTreasuryId = exactId(builderInput.packTreasury?.objectId, 'packTreasury.objectId');
      assertTypedLiveObject(builderInput.packTreasury, packTreasuryId, execution, 'packTreasury');
      if (sourceKind !== 1 || exactId(asset.sourceTreasuryId, 'asset.sourceTreasuryId') !== packTreasuryId) {
        throw appError('WEB_V8_PHYSICAL_SOURCE_MISMATCH', 'Pack Physical provenance must bind its exact verified PackTreasury.', 'CUSTODY');
      }
    }
  }
}

export function assertFreshV8ActionContext(value, request, runtime, execution, account) {
  exactKeys(value, [
    'schemaVersion',
    'source',
    'requestId',
    'chainIdentifier',
    'route',
    'action',
    'activation',
    'packageTuple',
    'builderInput',
    'refs',
    'authority',
  ], 'Fresh v8 action context');
  if (value.schemaVersion !== WEB_V8_CONTEXT_SCHEMA || value.source !== 'LIVE_RPC') {
    throw appError('WEB_V8_CONTEXT_SOURCE_INVALID', 'Action context must be a live fresh-v8 RPC result.', 'CONTEXT');
  }
  if (value.requestId !== request.requestId || value.chainIdentifier !== execution.chainIdentifier
    || value.action !== request.action || value.route !== routeIdentity(request.route)) {
    throw appError('WEB_V8_CONTEXT_DRIFT', 'Action context does not bind the exact request, chain, route, and action.', 'CONTEXT');
  }
  if (!isPlainRecord(value.builderInput)) {
    throw appError('WEB_V8_BUILDER_INPUT_INVALID', 'Live context did not return exact builder inputs.', 'VALIDATION');
  }
  exactKeys(value.refs, ['primary', 'root', 'registry', 'treasury'], 'Action object refs');
  const refs = Object.freeze({
    primary: objectRef(value.refs.primary, 'refs.primary'),
    root: objectRef(value.refs.root, 'refs.root'),
    registry: objectRef(value.refs.registry, 'refs.registry'),
    treasury: objectRef(value.refs.treasury, 'refs.treasury'),
  });
  if (request.route.kind === 'maker' && request.route.id !== refs.root.id) {
    throw appError('WEB_V8_ROUTE_ROOT_MISMATCH', 'Maker route does not match the live Root.', 'CONTEXT');
  }
  if (request.route.kind === 'listing' && request.route.id !== refs.primary.id) {
    throw appError('WEB_V8_ROUTE_LISTING_MISMATCH', 'Listing route does not match the live typed listing.', 'CONTEXT');
  }
  if (OWNED_INVENTORY_ACTIONS.has(request.action)) {
    const selectedInventoryId = exactId(
      request.selectedInventoryId,
      'request.selectedInventoryId',
    );
    if (refs.primary.id !== selectedInventoryId) {
      throw appError(
        'WEB_V8_INVENTORY_SELECTION_DRIFT',
        'Live action authority does not match the explicitly selected owned object.',
        'CUSTODY',
      );
    }
  }
  const wallet = value.builderInput.wallet;
  if (!isPlainRecord(wallet) || wallet.address !== account.address || wallet.network !== execution.network) {
    throw appError('WEB_V8_BUILDER_WALLET_MISMATCH', 'Builder input is not bound to the active wallet and network.', 'CONTEXT');
  }
  assertVerifiedBuilderState(value.builderInput, actionById(request.action), refs, runtime, execution);
  return Object.freeze({
    schemaVersion: WEB_V8_CONTEXT_SCHEMA,
    source: 'LIVE_RPC',
    requestId: value.requestId,
    chainIdentifier: value.chainIdentifier,
    route: value.route,
    action: value.action,
    activation: assertActivation(value.activation, runtime, refs.root),
    packageTuple: assertPackageTuple(value.packageTuple, runtime),
    builderInput: value.builderInput,
    refs,
    authority: assertAuthority(value.authority),
  });
}

function parsedListingForAction(marketClient, action, builderInput) {
  if (action.lane === 'MAKER') return builderInput.listing?.kind === 'MakerListingV8'
    ? builderInput.listing : marketClient.parseMakerListing(builderInput.listing);
  if (action.lane === 'SOUL') return builderInput.listing?.kind === 'SoulListingV8'
    ? builderInput.listing : marketClient.parseSoulListing(builderInput.listing);
  return builderInput.listing?.kind === 'PhysicalListingV8'
    ? builderInput.listing : marketClient.parsePhysicalListing(builderInput.listing);
}

function normalizedQuoteParts(value) {
  const normalized = {};
  for (const field of QUOTE_FIELDS) normalized[field] = exactU64(value[field], `quote.${field}`);
  normalized.commitment = exactText(value.commitment, 'quote.commitment');
  if (QUOTE_FIELDS.slice(1).reduce((sum, field) => sum + BigInt(normalized[field]), 0n)
    !== BigInt(normalized.grossAtomic)) {
    throw appError('WEB_V8_QUOTE_SPLIT_INVALID', 'Quote splits do not sum to the exact gross.', 'VALIDATION');
  }
  return Object.freeze(normalized);
}

function quoteForAction(marketClient, action, builderInput, grossAtomic) {
  const registry = builderInput.registry?.kind === 'MarketRegistryV8'
    ? builderInput.registry
    : marketClient.parseRegistry(builderInput.registry);
  let gross = grossAtomic;
  if (!LIST_ACTIONS.has(action.id)) {
    const listing = parsedListingForAction(marketClient, action, builderInput);
    if (FROZEN_LISTING_ACTIONS.has(action.id)) {
      return normalizedQuoteParts({
        grossAtomic: listing.fields.grossAtomic,
        protocolAtomic: listing.fields.protocolAtomic,
        creatorAtomic: listing.fields.creatorAtomic,
        sourceAtomic: listing.fields.sourceAtomic ?? 0n,
        sellerAtomic: listing.fields.sellerAtomic,
        commitment: listing.fields.quoteCommitment,
      });
    }
    gross = listing.fields.grossAtomic;
  }
  const quote = marketClient[action.quote](registry, exactU64(gross, 'grossAtomic'));
  return normalizedQuoteParts(quote);
}

function quoteKindForAction(marketModule, action) {
  if (action.lane === 'MAKER') return marketModule.MARKET_V8_QUOTE_KINDS.MAKER_RESALE;
  if (action.lane === 'SOUL') return marketModule.MARKET_V8_QUOTE_KINDS.SOUL_RESALE;
  return marketModule.MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE;
}

function quoteInspectionInput(marketModule, state) {
  const input = builderInputFor(state);
  return Object.freeze({
    registry: input.registry,
    treasury: input.treasury,
    root: input.root,
    wallet: input.wallet,
    quoteKind: quoteKindForAction(marketModule, state.action),
    grossAtomic: state.quote.grossAtomic,
  });
}

function normalizedInspectedQuote(quote) {
  if (quote?.evidence?.source !== 'chain-dry-run') {
    throw appError('WEB_V8_QUOTE_EVIDENCE_INVALID', 'Quote review requires exact chain dry-run evidence.', 'VALIDATION');
  }
  const normalized = {};
  for (const field of QUOTE_FIELDS) normalized[field] = exactU64(quote[field], `quote.${field}`);
  normalized.commitment = exactText(quote.commitment, 'quote.commitment');
  normalized.evidence = Object.freeze({
    source: 'chain-dry-run',
    network: exactText(quote.evidence.network, 'quote.evidence.network'),
    target: exactText(quote.evidence.target, 'quote.evidence.target'),
    rootId: exactId(quote.evidence.rootId, 'quote.evidence.rootId'),
    registryId: exactId(quote.evidence.registryId, 'quote.evidence.registryId'),
  });
  return Object.freeze(normalized);
}

function frozenListingQuoteEvidence(state) {
  return Object.freeze({
    source: 'live-listing',
    network: state.execution.network,
    listingId: state.context.refs.primary.id,
    listingVersion: state.context.refs.primary.version,
    listingRevision: exactU64(
      state.context.builderInput.expectation?.listingRevision,
      'expectation.listingRevision',
    ),
    quoteCommitment: exactText(state.quote.commitment, 'quote.commitment'),
  });
}

function contextFingerprint(context, quote, account) {
  return stableJson({
    account,
    route: context.route,
    action: context.action,
    activation: context.activation,
    packageTuple: context.packageTuple,
    refs: context.refs,
    authority: context.authority,
    quote,
    expectation: context.builderInput.expectation || null,
    rootReadback: {
      lifecycleCode: context.builderInput.root.lifecycleCode,
      binding: context.builderInput.root.binding,
    },
    protocolReadback: {
      enabled: context.builderInput.protocolConfig.enabled,
      revision: context.builderInput.protocolConfig.revision,
      commitment: context.builderInput.protocolConfig.commitment,
    },
    makerTreasuryReadback: context.builderInput.makerTreasury
      ? { balanceAtomic: context.builderInput.makerTreasury.balanceAtomic }
      : null,
  });
}

function builderInputFor(state) {
  const input = { ...state.context.builderInput };
  if (LIST_ACTIONS.has(state.action.id)) input.grossAtomic = state.grossAtomic;
  if (LIST_ACTIONS.has(state.action.id) || PURCHASE_ACTIONS.has(state.action.id)) {
    input.chainQuote = state.chainQuoteProof;
  }
  return input;
}

function exactPaymentIntentFor(state) {
  if (!PURCHASE_ACTIONS.has(state.action.id)) return null;
  if (hasOwn(state.context.builderInput, 'payment')) {
    throw appError('MARKET_V8_CALLER_PAYMENT_FORBIDDEN', 'Caller-selected payment coins are forbidden.', 'VALIDATION');
  }
  return Object.freeze({
    type: state.runtime.paymentCoinType,
    balanceAtomic: exactU64(state.quote.grossAtomic, 'quote.grossAtomic'),
    resolution: 'TRANSACTION_COIN_WITH_BALANCE',
  });
}

function recoveryLaneFor(state) {
  if (state.action.lane !== 'PHYSICAL') return state.action.lane;
  const sourceKind = exactU8(
    state.context.builderInput.listing?.fields?.custody?.sourceKind,
    'listing.custody.sourceKind',
  );
  if (sourceKind === 0) return 'PHYSICAL_BASE';
  if (sourceKind === 1) return 'PHYSICAL_PACK';
  throw appError(
    'WEB_V8_PHYSICAL_SOURCE_MISMATCH',
    'Physical cancel/recovery identity requires an exact Base or Pack listing source.',
    'CUSTODY',
  );
}

function recoveryIdentity(state, execution) {
  return Object.freeze({
    chain: execution.chainIdentifier,
    wallet: state.account.address,
    lane: recoveryLaneFor(state),
    action: state.action.id,
    packageTuple: state.context.packageTuple,
    paymentCoin: state.runtime.paymentCoinType,
    listing: state.context.refs.primary,
    root: state.context.refs.root,
    registry: state.context.refs.registry,
    treasury: state.context.refs.treasury,
    rootContentCommitment: exactText(
      state.context.builderInput.rootContentCommitment
        || state.context.builderInput.registry?.fields?.rootContentCommitment,
      'rootContentCommitment',
    ),
    protocolRevision: exactU64(
      state.context.builderInput.protocolRevision
        ?? state.context.builderInput.registry?.fields?.protocolConfigRevision,
      'protocolRevision',
    ),
    listingRevision: exactU64(
      state.context.builderInput.expectation?.listingRevision ?? '0',
      'listingRevision',
    ),
    quoteCommitment: state.quote.commitment,
    authority: Object.freeze({
      kind: state.context.authority.kind,
      refs: state.context.authority.refs,
    }),
  });
}

function transactionPlan(evidence, state) {
  if (!isPlainRecord(evidence)
    || evidence.schema !== 'animacraft.market-recovery-evidence.v8'
    || evidence.descriptor?.action !== state.action.id) {
    throw appError('WEB_V8_SIGNING_EVIDENCE_INVALID', 'Transaction plan must come from the exact branded Market action evidence.', 'VALIDATION');
  }
  return Object.freeze({
    transactionBytes: exactText(evidence.transactionBytes, 'transactionBytes', 180_000),
    transactionDigest: exactText(evidence.transactionDigest, 'transactionDigest'),
    stage: `MARKET_${state.action.kind}`,
    sequence: exactU64(state.context.builderInput.expectation?.listingRevision ?? '0', 'sequence'),
    signer: state.account.address,
    epochWindow: Object.freeze({
      start: exactU64(evidence.epochWindow?.start, 'epochWindow.start'),
      end: exactU64(evidence.epochWindow?.end, 'epochWindow.end'),
    }),
    gas: clonePublic(evidence.gasData),
    expiration: clonePublic(evidence.expiration),
    sourceSnapshot: Object.freeze({
      schema: 'animacraft.market-source-snapshot.v8',
      fingerprint: exactText(evidence.sourceFingerprint, 'sourceFingerprint'),
      descriptor: clonePublic(evidence.descriptor),
    }),
  });
}

export function assertFinalizedMarketReadbackV8(value, request, marketClient, marketModule) {
  return assertCoreV2FinalizedMarketReadbackV8(value, request, marketClient, marketModule);
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return `web-v8:${globalThis.crypto.randomUUID()}`;
  return `web-v8:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function sessionId() {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web-v8-session:${suffix}`;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
  });
}

async function requestWhileTransactionActive(request, done) {
  try {
    return await requestResult(request);
  } catch (error) {
    await done.catch(() => {});
    throw error;
  }
}

export function createIndexedDbRecoveryAdapter(indexedDb, {
  databaseName = 'animacraft-fresh-maker-v8',
} = {}) {
  if (!indexedDb || typeof indexedDb.open !== 'function') {
    throw appError('WEB_V8_INDEXEDDB_REQUIRED', 'Durable IndexedDB storage is required.', 'STORAGE');
  }
  let opened;
  const open = () => {
    if (opened) return opened;
    opened = new Promise((resolve, reject) => {
      const request = indexedDb.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const store of ['active', 'receipts', 'failures']) {
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open fresh v8 recovery storage.'));
    });
    return opened;
  };
  const read = async (store, key) => {
    const database = await open();
    const transaction = database.transaction(store, 'readonly');
    const done = transactionDone(transaction);
    const value = await requestWhileTransactionActive(transaction.objectStore(store).get(key), done);
    await done;
    return value ?? null;
  };
  return Object.freeze({
    load: (scopeKey) => read('active', scopeKey),
    async compareAndSwap(scopeKey, expectedRevision, nextRecord, options = {}) {
      if (!isPlainRecord(options)) {
        throw appError('MAKER_V8_RECOVERY_RECORD_INVALID', 'Recovery commit options must be an exact record.', 'STORAGE');
      }
      const optionKeys = Object.keys(options);
      const validOptions = optionKeys.length === 0
        || (optionKeys.length === 1 && options.archiveFinalizedFailure === true)
        || (optionKeys.length === 1 && options.discardUnsigned === true)
        || (optionKeys.length === 1 && Object.hasOwn(options, 'completionReceipt'))
        || (optionKeys.length === 1 && options.replaceTombstone === true)
        || (optionKeys.length === 1 && options.replaceFinalizedFailure === true)
        || (optionKeys.length === 1 && Object.hasOwn(options, 'resetUnsigned'));
      if (!validOptions) {
        throw appError(
          'MAKER_V8_RECOVERY_RECORD_INVALID',
          'Recovery commit options are unsupported or ambiguous.',
          'STORAGE',
        );
      }
      const database = await open();
      const transaction = database.transaction(['active', 'receipts', 'failures'], 'readwrite');
      const done = transactionDone(transaction);
      const active = transaction.objectStore('active');
      const current = await requestWhileTransactionActive(active.get(scopeKey), done);
      const actualRevision = current?.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        transaction.abort();
        await done.catch(() => {});
        throw appError('MAKER_V8_RECOVERY_CAS_CONFLICT', 'Recovery state changed in another tab.', 'CONCURRENCY');
      }
      if (!nextRecord) {
        transaction.abort();
        await done.catch(() => {});
        throw appError(
          'MAKER_V8_RECOVERY_RECORD_INVALID',
          'Physical recovery deletion is forbidden because it resets the durable CAS revision.',
          'STORAGE',
        );
      }
      if (options.archiveFinalizedFailure === true && nextRecord.failure) {
        transaction.objectStore('failures').put(
          nextRecord.failure,
          `${nextRecord.identityKey}:digest:${nextRecord.failure.digest}`,
        );
      }
      if (Object.hasOwn(options, 'completionReceipt')) {
        const receipt = options.completionReceipt;
        const receipts = transaction.objectStore('receipts');
        const prior = receipt?.identityKey
          ? await requestWhileTransactionActive(receipts.get(receipt.identityKey), done)
          : null;
        if (!receipt || current?.state !== 'VERIFIED' || nextRecord.state !== 'CLEANED'
          || current.identityKey !== receipt.identityKey
          || nextRecord.identityKey !== receipt.identityKey
          || nextRecord.plan !== null || nextRecord.signed !== null
          || stableJson(current.receipt) !== stableJson(receipt)
          || stableJson(nextRecord.receipt) !== stableJson(receipt)
          || (prior && stableJson(prior) !== stableJson(receipt))) {
          transaction.abort();
          await done.catch(() => {});
          throw appError(
            'MAKER_V8_RECOVERY_RECEIPT_INVALID',
            'Verified cleanup requires an atomic CLEANED tombstone and its exact receipt.',
            'STORAGE',
          );
        }
        receipts.put(receipt, receipt.identityKey);
      }
      active.put(nextRecord, scopeKey);
      await done;
      return nextRecord ?? null;
    },
    loadReceipt: (identityKey) => read('receipts', identityKey),
    loadFinalizedFailure: (identityKey, digest) => read('failures', `${identityKey}:digest:${digest}`),
    async listFinalizedFailures(scopeKey) {
      const database = await open();
      const transaction = database.transaction('failures', 'readonly');
      const done = transactionDone(transaction);
      const values = await requestWhileTransactionActive(transaction.objectStore('failures').getAll(), done);
      await done;
      return values.filter((entry) => entry?.scopeKey === scopeKey);
    },
  });
}

function normalizeView(result, request, runtime, execution) {
  exactKeys(result, ['schemaVersion', 'source', 'requestId', 'chainIdentifier', 'route', 'activation', 'view', 'availableActions'], 'Route view');
  if (result.schemaVersion !== WEB_V8_ROUTE_SCHEMA || result.source !== 'LIVE_RPC'
    || result.requestId !== request.requestId || result.chainIdentifier !== execution.chainIdentifier
    || result.route !== routeIdentity(request.route)) {
    throw appError('WEB_V8_ROUTE_VIEW_INVALID', 'Route view does not bind the live request.', 'CONTEXT');
  }
  if (!isPlainRecord(result.view)) throw appError('WEB_V8_ROUTE_VIEW_INVALID', 'Route view is invalid.', 'VALIDATION');
  if (!Array.isArray(result.availableActions)
    || result.availableActions.some((id) => makerV8ActionV8(id)?.id !== id)) {
    throw appError('WEB_V8_ROUTE_ACTIONS_INVALID', 'Route view exposed an unknown action.', 'VALIDATION');
  }
  const rootId = exactId(result.activation.rootId, 'activation.rootId');
  assertActivation(result.activation, runtime, { id: rootId });
  return Object.freeze({
    view: Object.freeze({
      title: exactText(result.view.title, 'view.title'),
      subtitle: exactText(result.view.subtitle, 'view.subtitle', 2_048),
      lifecycle: exactText(result.view.lifecycle, 'view.lifecycle'),
      listingKind: result.view.listingKind === null ? null : exactText(result.view.listingKind, 'view.listingKind'),
      listingStatus: result.view.listingStatus === null ? null : exactText(result.view.listingStatus, 'view.listingStatus'),
    }),
    availableActions: Object.freeze([...new Set(result.availableActions)]),
  });
}

function normalizeBrowse(result, request, runtime, execution) {
  exactKeys(result, ['schemaVersion', 'source', 'requestId', 'chainIdentifier', 'makers', 'listings'], 'Market browse result');
  if (result.schemaVersion !== WEB_V8_BROWSE_SCHEMA || result.source !== 'LIVE_RPC'
    || result.requestId !== request.requestId || result.chainIdentifier !== execution.chainIdentifier) {
    throw appError('WEB_V8_BROWSE_INVALID', 'Market browse result does not bind the live request.', 'CONTEXT');
  }
  if (!Array.isArray(result.makers) || !Array.isArray(result.listings)) {
    throw appError('WEB_V8_BROWSE_INVALID', 'Market browse collections are invalid.', 'VALIDATION');
  }
  const eventType = makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated');
  const makers = result.makers.map((maker, index) => {
    exactKeys(maker, ['rootId', 'title', 'eventType', 'lifecycle'], `makers[${index}]`);
    if (maker.eventType !== eventType || maker.lifecycle !== 'ACTIVE') {
      throw appError('WEB_V8_BROWSE_ACTIVATION_INVALID', 'Market browse contained an unverified Maker.', 'BINDING');
    }
    return Object.freeze({ rootId: exactId(maker.rootId, 'maker.rootId'), title: exactText(maker.title, 'maker.title'), eventType, lifecycle: 'ACTIVE' });
  });
  const listings = result.listings.map((listing, index) => {
    exactKeys(listing, ['listingId', 'rootId', 'title', 'kind', 'status', 'grossAtomic', 'quoteCommitment'], `listings[${index}]`);
    return Object.freeze({
      listingId: exactId(listing.listingId, 'listing.listingId'),
      rootId: exactId(listing.rootId, 'listing.rootId'),
      title: exactText(listing.title, 'listing.title'),
      kind: exactText(listing.kind, 'listing.kind'),
      status: exactText(listing.status, 'listing.status'),
      grossAtomic: exactU64(listing.grossAtomic, 'listing.grossAtomic'),
      quoteCommitment: exactText(listing.quoteCommitment, 'listing.quoteCommitment'),
    });
  });
  return Object.freeze({ makers: Object.freeze(makers), listings: Object.freeze(listings) });
}

function normalizeOwnedInventory(result, request, execution, account) {
  exactKeys(result, [
    'schemaVersion',
    'source',
    'requestId',
    'chainIdentifier',
    'route',
    'action',
    'account',
    'rootId',
    'choices',
  ], 'Owned inventory result');
  if (result.schemaVersion !== WEB_V8_INVENTORY_SCHEMA || result.source !== 'LIVE_RPC'
    || result.requestId !== request.requestId
    || result.chainIdentifier !== execution.chainIdentifier
    || result.route !== routeIdentity(request.route)
    || result.action !== request.action
    || exactId(result.account, 'inventory.account') !== account.address
    || exactId(result.rootId, 'inventory.rootId') !== request.route.id
    || !Array.isArray(result.choices)) {
    throw appError(
      'WEB_V8_INVENTORY_CONTEXT_DRIFT',
      'Owned inventory choices do not bind the exact live request, account, Root, and action.',
      'CONTEXT',
    );
  }
  const action = actionById(request.action);
  if (!OWNED_INVENTORY_ACTIONS.has(action.id)) {
    throw appError('WEB_V8_INVENTORY_ACTION_INVALID', 'This action does not consume an owned Soul or Physical object.');
  }
  const expectedKind = action.id === 'listSoulBundle'
    ? 'SOUL_BUNDLE'
    : action.id === 'listBasePhysical' ? 'PHYSICAL_BASE' : 'PHYSICAL_PACK';
  const expectedSourceKind = action.id === 'listBasePhysical' ? 0
    : action.id === 'listPackPhysical' ? 1 : null;
  const seen = new Set();
  const choices = result.choices.map((choice, index) => {
    exactKeys(choice, [
      'id',
      'kind',
      'objectIds',
      'ownershipEpoch',
      'sourceKind',
      'sourceId',
      'sourceTreasuryId',
    ], `inventory.choices[${index}]`);
    const choiceId = exactId(choice.id, `inventory.choices[${index}].id`);
    if (seen.has(choiceId)) {
      throw appError('WEB_V8_INVENTORY_DUPLICATE', 'Owned inventory contains a duplicate selectable ID.', 'CUSTODY');
    }
    seen.add(choiceId);
    if (choice.kind !== expectedKind || !Array.isArray(choice.objectIds)) {
      throw appError('WEB_V8_INVENTORY_KIND_MISMATCH', 'Owned inventory choice belongs to another listing lane.', 'CUSTODY');
    }
    const objectIds = Object.freeze(choice.objectIds.map((value, objectIndex) => (
      exactId(value, `inventory.choices[${index}].objectIds[${objectIndex}]`)
    )));
    const soul = expectedKind === 'SOUL_BUNDLE';
    if ((soul && (objectIds.length !== 3 || choiceId !== objectIds[0]
        || choice.sourceKind !== null || choice.sourceId !== null || choice.sourceTreasuryId !== null))
      || (!soul && (objectIds.length !== 1 || choiceId !== objectIds[0]
        || exactU8(choice.sourceKind, `inventory.choices[${index}].sourceKind`) !== expectedSourceKind))) {
      throw appError('WEB_V8_INVENTORY_BINDING_MISMATCH', 'Owned inventory choice has inconsistent bundle or provenance fields.', 'CUSTODY');
    }
    const sourceId = soul ? null : exactId(choice.sourceId, `inventory.choices[${index}].sourceId`);
    const sourceTreasuryId = choice.sourceTreasuryId === null
      ? null : exactId(choice.sourceTreasuryId, `inventory.choices[${index}].sourceTreasuryId`);
    if (!soul && ((expectedSourceKind === 0 && sourceTreasuryId !== null)
      || (expectedSourceKind === 1 && sourceTreasuryId === null))) {
      throw appError('WEB_V8_INVENTORY_BINDING_MISMATCH', 'Physical inventory source treasury does not match its lane.', 'CUSTODY');
    }
    return Object.freeze({
      id: choiceId,
      kind: expectedKind,
      objectIds,
      ownershipEpoch: exactU64(choice.ownershipEpoch, `inventory.choices[${index}].ownershipEpoch`),
      sourceKind: expectedSourceKind,
      sourceId,
      sourceTreasuryId,
    });
  });
  return Object.freeze(choices);
}

function disconnectedWalletError(error) {
  return ['MAKER_V8_BROWSER_WALLET_UNAVAILABLE', 'MAKER_V8_BROWSER_WALLET_NOT_CONNECTED']
    .includes(error?.code)
    || /no (?:compatible )?(?:sui )?wallet|no wallet standard provider|not connected|connect .*wallet/i
      .test(String(error?.message || ''));
}

export function createFreshV8Controller({
  route,
  runtime,
  execution,
  adapters: adapterInput,
  marketModule,
  recoveryModule,
  indexedDb = globalThis.indexedDB,
}) {
  if (!route?.valid) throw appError(UNSUPPORTED_PRODUCT_CODE, 'This link is not a fresh Maker v8 route.');
  const adapters = assertFreshV8Adapters(adapterInput);
  if (!isMakerV8RuntimeAttested(runtime)) {
    throw appError('WEB_V8_RUNTIME_ATTESTATION_REQUIRED', 'Controller runtime must come from a live Mainnet ProductReleaseCatalog readback.', 'LINEAGE');
  }
  const marketRuntime = marketRuntimeFromMakerRuntime(runtime, execution.network);
  const marketClient = marketModule.createMarketV8Client(marketRuntime, { network: execution.network });
  if (!marketClient
    || MARKET_V8_ACTIONS.some((action) => typeof marketClient[action.builder] !== 'function')
    || typeof marketClient.buildQuoteInspection !== 'function'
    || typeof marketClient.inspectQuoteOnChain !== 'function'
    || typeof marketModule.inspectMarketActionOnChainV8 !== 'function'
    || typeof marketModule.createMarketV8RecoveryEvidenceV8 !== 'function') {
    throw appError('WEB_V8_MARKET_MODULE_INVALID', 'Market module must expose fourteen Transaction builders and chain quote inspection.', 'CONFIGURATION');
  }
  if (typeof recoveryModule?.createMakerV8RecoveryController !== 'function'
    || typeof recoveryModule?.makerV8RecoveryScopeKey !== 'function'
    || typeof recoveryModule?.canonicalMakerV8RecoveryIdentity !== 'function') {
    throw appError('WEB_V8_RECOVERY_MODULE_INVALID', 'Recovery module must expose its controller and stable Root scope key.', 'CONFIGURATION');
  }
  const persistence = adapters.persistence || createIndexedDbRecoveryAdapter(indexedDb);
  let currentIdentity = null;
  const recovery = recoveryModule.createMakerV8RecoveryController({
    persist: persistence,
    deriveTransactionDigest: (bytes) => adapters.transactions.deriveTransactionDigest(bytes),
    verifySignature: (request) => adapters.wallet.verifyExactSignature(request),
    getContext: async ({ identity }) => {
      const fresh = await refetchExactSigningSnapshot({ identity });
      return Object.freeze({
        identity: fresh.identity,
        currentEpoch: await readCurrentMainnetEpoch(fresh.suiClient),
      });
    },
    sign: async (request) => {
      if (!execution.allowWalletSignature) {
        throw appError('WEB_V8_SIGNING_DISABLED', 'Wallet signing is disabled by the pinned deployment configuration.', 'SIGNING');
      }
      return adapters.wallet.signExactTransaction(request);
    },
    broadcast: async (request) => {
      if (!execution.allowBroadcast) {
        throw appError('WEB_V8_BROADCAST_DISABLED', 'Broadcast is disabled by the pinned deployment configuration.', 'BROADCAST');
      }
      return adapters.transactions.broadcastExactTransaction(request);
    },
    query: (request) => adapters.rpc.queryTransaction(request),
    readback: async (request) => assertFinalizedMarketReadbackV8(
      await adapters.rpc.readbackMarketAction(request),
      request,
      marketClient,
      marketModule,
    ),
    sessionId: sessionId(),
  });

  const state = {
    route,
    runtime,
    execution,
    status: 'READING',
    busy: false,
    account: null,
    view: null,
    browse: null,
    availableActions: [],
    action: null,
    inventoryChoices: [],
    selectedInventoryId: null,
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
  const listeners = new Set();
  const snapshot = () => Object.freeze({
    ...state,
    availableActions: Object.freeze([...state.availableActions]),
    inventoryChoices: Object.freeze([...state.inventoryChoices]),
  });
  const emit = () => listeners.forEach((listener) => listener(snapshot()));
  const setBusy = (busy, status = state.status) => { state.busy = busy; state.status = status; emit(); };
  const rememberError = (error) => {
    state.busy = false;
    state.issue = classifyFreshV8Error(error, { action: state.action?.id || route.kind });
    state.status = state.issue.layer === 'FINALIZED_EXECUTION'
      ? 'FINALIZED_FAILURE'
      : state.issue.layer === 'WALLET' ? 'RECONNECT_REQUIRED' : 'ERROR';
    emit();
    throw error;
  };

  function invalidateActionContext({ clearInventory = false } = {}) {
    state.context = null;
    state.quote = null;
    state.fingerprint = null;
    state.reviewedFingerprint = null;
    state.paymentFingerprint = null;
    state.quoteEvidence = null;
    state.chainQuoteProof = null;
    state.prepared = null;
    state.recoveryRecord = null;
    state.completionReceipt = null;
    currentIdentity = null;
    if (clearInventory) {
      state.inventoryChoices = [];
      state.selectedInventoryId = null;
    }
  }

  async function readCurrentAccount({ optional = false } = {}) {
    try {
      const account = assertAccount(await adapters.wallet.getCurrentAccount(), execution);
      if (state.account && stableJson(account) !== stableJson(state.account)) {
        invalidateActionContext({ clearInventory: true });
      }
      state.account = account;
      return account;
    } catch (error) {
      if (optional && disconnectedWalletError(error)) {
        state.account = null;
        invalidateActionContext({ clearInventory: true });
        return null;
      }
      throw error;
    }
  }

  async function loadOwnedInventory({ preserveSelection = false } = {}) {
    if (!state.action || !OWNED_INVENTORY_ACTIONS.has(state.action.id) || !state.account) {
      throw appError(
        'WEB_V8_INVENTORY_CONTEXT_REQUIRED',
        'Connect a wallet and select a Soul or Physical listing action first.',
        'CUSTODY',
      );
    }
    const selectedInventoryId = preserveSelection ? state.selectedInventoryId : null;
    invalidateActionContext();
    state.inventoryChoices = [];
    state.selectedInventoryId = null;
    const requested = {
      requestId: requestId(),
      route,
      action: state.action.id,
      account: state.account,
      eventType: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated'),
      marketTypes: marketClient.types,
      runtime,
    };
    state.status = 'READING_INVENTORY';
    emit();
    state.inventoryChoices = normalizeOwnedInventory(
      await adapters.rpc.loadOwnedInventory(requested),
      requested,
      execution,
      state.account,
    );
    state.selectedInventoryId = null;
    if (!state.inventoryChoices.length) {
      throw appError(
        'WEB_V8_INVENTORY_EMPTY',
        'The connected wallet has no exact owned object for this listing lane.',
        'CUSTODY',
      );
    }
    if (selectedInventoryId
      && !state.inventoryChoices.some((choice) => choice.id === selectedInventoryId)) {
      throw appError(
        'WEB_V8_INVENTORY_SELECTION_STALE',
        'The selected owned object is no longer present in the refreshed wallet inventory.',
        'CUSTODY',
      );
    }
    state.selectedInventoryId = selectedInventoryId;
    state.status = selectedInventoryId ? 'READING' : 'SELECTION_REQUIRED';
  }

  async function loadSelectedAction() {
    if (!state.action) return;
    if (!state.account) {
      throw appError('WEB_V8_WALLET_REQUIRED', 'Connect the wallet that will authorize this action.', 'WALLET');
    }
    if (OWNED_INVENTORY_ACTIONS.has(state.action.id) && !state.selectedInventoryId) {
      throw appError(
        'WEB_V8_INVENTORY_SELECTION_REQUIRED',
        'Select the exact owned Soul bundle or Physical asset before building a list action.',
        'CUSTODY',
      );
    }
    // Refetch is an authority boundary. Invalidate every prior approval before
    // asking the RPC adapter for a new object snapshot, including failed reads.
    invalidateActionContext();
    const requested = {
      requestId: requestId(),
      route,
      action: state.action.id,
      eventType: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated'),
      marketTypes: marketClient.types,
      account: state.account,
      runtime,
      ...(OWNED_INVENTORY_ACTIONS.has(state.action.id)
        ? { selectedInventoryId: state.selectedInventoryId }
        : {}),
    };
    state.status = 'READING';
    emit();
    const raw = await adapters.rpc.loadActionContext(requested);
    const context = assertFreshV8ActionContext(raw, requested, runtime, execution, state.account);
    const verifiedLifecycle = ROOT_LIFECYCLES[exactU8(context.builderInput.root.lifecycleCode, 'root.lifecycleCode')];
    if (state.view && state.view.lifecycle !== verifiedLifecycle) {
      throw appError(
        'WEB_V8_VIEW_ROOT_LIFECYCLE_MISMATCH',
        'Visible lifecycle does not match the verified Root readback.',
        'CONTEXT',
      );
    }
    const quote = quoteForAction(marketClient, state.action, context.builderInput, state.grossAtomic);
    const fingerprint = contextFingerprint(context, quote, state.account);
    if (fingerprint !== state.fingerprint) {
      state.reviewedFingerprint = null;
      state.paymentFingerprint = null;
      state.quoteEvidence = null;
      state.chainQuoteProof = null;
      state.prepared = null;
      state.recoveryRecord = null;
    }
    state.context = context;
    state.quote = quote;
    state.fingerprint = fingerprint;
    const liveIdentity = recoveryIdentity(state, execution);
    const scopeKey = recoveryModule.makerV8RecoveryScopeKey(liveIdentity);
    const pendingAtRoot = await persistence.load(scopeKey);
    if (pendingAtRoot?.identity) {
      // Re-enter through Recovery validation using the immutable identity saved
      // with the plan. Never reconstruct an old signed action from fresh refs.
      state.recoveryRecord = await recovery.load(pendingAtRoot.identity);
      currentIdentity = pendingAtRoot.identity;
      if (!state.recoveryRecord) {
        state.completionReceipt = await recovery.loadReceipt(pendingAtRoot.identity);
      }
    } else {
      currentIdentity = liveIdentity;
      state.recoveryRecord = await recovery.load(liveIdentity);
      if (!state.recoveryRecord) state.completionReceipt = await recovery.loadReceipt(liveIdentity);
    }
    state.status = state.recoveryRecord?.state
      || (state.completionReceipt ? 'CLEANED' : 'QUOTING');
  }

  async function refresh() {
    try {
      setBusy(true, 'READING');
      state.issue = null;
      const observedChain = await adapters.rpc.getChainIdentifier();
      if (observedChain !== execution.chainIdentifier) {
        throw appError('WEB_V8_NETWORK_MISMATCH', 'RPC chain identifier does not match the pinned deployment.', 'CONTEXT');
      }
      if (route.kind === 'market') {
        const request = {
          requestId: requestId(),
          eventType: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated'),
          listingTypes: Object.freeze([
            marketClient.types.makerListing,
            marketClient.types.soulListing,
            marketClient.types.physicalListing,
          ]),
        };
        state.browse = normalizeBrowse(await adapters.rpc.browseMarket(request), request, runtime, execution);
        state.status = 'READY';
      } else {
        const request = { requestId: requestId(), route };
        const result = normalizeView(await adapters.rpc.loadRoute({
          ...request,
          eventType: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated'),
          listingTypes: marketClient.types,
        }), request, runtime, execution);
        state.view = result.view;
        state.availableActions = result.availableActions;
        if (state.action && !state.availableActions.includes(state.action.id)) {
          state.action = null;
          invalidateActionContext({ clearInventory: true });
        }
        const account = await readCurrentAccount({ optional: true });
        if (!account) {
          state.status = 'READY';
        } else {
          if (!state.action && state.availableActions.length) {
            state.action = actionById(state.availableActions[0]);
          }
          if (state.action && OWNED_INVENTORY_ACTIONS.has(state.action.id)) {
            if (state.selectedInventoryId) {
              await loadOwnedInventory({ preserveSelection: true });
              await loadSelectedAction();
            } else await loadOwnedInventory();
          } else if (state.action) {
            await loadSelectedAction();
          } else {
            state.status = 'READY';
          }
        }
      }
      state.busy = false;
      emit();
      return snapshot();
    } catch (error) {
      return rememberError(error);
    }
  }

  async function selectAction(id) {
    try {
      const action = actionById(id);
      if (!state.availableActions.includes(action.id)) {
        throw appError('WEB_V8_ACTION_NOT_AVAILABLE', 'The live route does not expose this action.', 'ELIGIBILITY');
      }
      state.action = action;
      state.issue = null;
      invalidateActionContext({ clearInventory: true });
      setBusy(true, 'READING');
      await readCurrentAccount();
      if (OWNED_INVENTORY_ACTIONS.has(action.id)) await loadOwnedInventory();
      else await loadSelectedAction();
      state.busy = false;
      emit();
      return snapshot();
    } catch (error) {
      return rememberError(error);
    }
  }

  async function selectInventory(id) {
    try {
      if (!state.action || !OWNED_INVENTORY_ACTIONS.has(state.action.id)) {
        throw appError('WEB_V8_INVENTORY_ACTION_INVALID', 'No owned-inventory list action is selected.');
      }
      const selected = exactId(id, 'selectedInventoryId');
      if (!state.inventoryChoices.some((choice) => choice.id === selected)) {
        throw appError(
          'WEB_V8_INVENTORY_SELECTION_STALE',
          'The selected owned object is not present in the latest verified inventory.',
          'CUSTODY',
        );
      }
      state.issue = null;
      setBusy(true, 'READING');
      await readCurrentAccount();
      state.selectedInventoryId = selected;
      await loadSelectedAction();
      state.busy = false;
      emit();
      return snapshot();
    } catch (error) {
      return rememberError(error);
    }
  }

  async function setGrossAtomic(value) {
    try {
      state.grossAtomic = exactU64(value, 'grossAtomic');
      state.reviewedFingerprint = null;
      state.paymentFingerprint = null;
      state.prepared = null;
      if (state.action && (!OWNED_INVENTORY_ACTIONS.has(state.action.id)
        || state.selectedInventoryId)) await loadSelectedAction();
      emit();
    } catch (error) {
      rememberError(error);
    }
  }

  async function reviewQuote() {
    try {
      if (!state.fingerprint || !state.quote) throw appError('WEB_V8_QUOTE_REQUIRED', 'Refresh and calculate the exact quote first.', 'VALIDATION');
      setBusy(true, 'QUOTING');
      const localFingerprint = state.fingerprint;
      if (FROZEN_LISTING_ACTIONS.has(state.action.id)) {
        const evidence = frozenListingQuoteEvidence(state);
        if (localFingerprint !== state.fingerprint) {
          throw appError('WEB_V8_QUOTE_CONTEXT_DRIFT', 'Live listing context changed during quote review.', 'CONTEXT');
        }
        state.quoteEvidence = evidence;
        state.chainQuoteProof = null;
        state.reviewedFingerprint = state.fingerprint;
        state.status = 'READY';
        state.busy = false;
        emit();
        return Object.freeze({ ...state.quote, evidence });
      }
      const inspected = await marketClient.inspectQuoteOnChain(
        await adapters.rpc.getSuiClient(),
        quoteInspectionInput(marketModule, state),
      );
      if (localFingerprint !== state.fingerprint) {
        throw appError('WEB_V8_QUOTE_CONTEXT_DRIFT', 'Live context changed during chain quote inspection.', 'CONTEXT');
      }
      const chainQuote = normalizedInspectedQuote(inspected);
      for (const field of [...QUOTE_FIELDS, 'commitment']) {
        if (chainQuote[field] !== state.quote[field]) {
          throw appError('MARKET_V8_QUOTE_DRIFT', 'Chain quote differs from the current local mirror.', 'CONTEXT');
        }
      }
      state.quote = chainQuote;
      state.quoteEvidence = chainQuote.evidence;
      state.chainQuoteProof = inspected;
      state.reviewedFingerprint = state.fingerprint;
      if (!PURCHASE_ACTIONS.has(state.action.id)) state.status = 'READY';
      state.busy = false;
      emit();
      return chainQuote;
    } catch (error) {
      return rememberError(error);
    }
  }

  function confirmExactPayment() {
    if (state.reviewedFingerprint !== state.fingerprint) {
      throw appError('WEB_V8_QUOTE_REVIEW_REQUIRED', 'Review the current quote before confirming exact payment.', 'VALIDATION');
    }
    if (!state.quoteEvidence) throw appError('WEB_V8_QUOTE_EVIDENCE_REQUIRED', 'Chain quote inspection must complete before payment confirmation.', 'VALIDATION');
    exactPaymentIntentFor(state);
    state.paymentFingerprint = state.fingerprint;
    state.status = 'READY';
    emit();
  }

  async function rebuildAndSimulateExactAction(
    expectedPlan = null,
    candidate = state,
    suppliedClient = null,
    suppliedMarketClient = null,
  ) {
    const suiClient = suppliedClient || await adapters.rpc.getSuiClient();
    const freshRuntime = suppliedMarketClient
      ? candidate.runtime
      : (await attestMakerV8Runtime(suiClient, candidate.runtime, { network: execution.network })).runtime;
    const freshMarketClient = suppliedMarketClient
      || marketModule.createMarketV8Client(freshRuntime, { network: execution.network });
    const compiled = freshMarketClient[candidate.action.builder](builderInputFor(candidate));
    if (!compiled?.transaction || !compiled?.descriptor || compiled.descriptor.action !== candidate.action.id) {
      throw appError('WEB_V8_TRANSACTION_BUILDER_INVALID', 'Market builder did not return the exact typed action Transaction.', 'VALIDATION');
    }
    const dryRunProof = await marketModule.inspectMarketActionOnChainV8(
      suiClient,
      compiled,
    );
    const evidence = marketModule.createMarketV8RecoveryEvidenceV8(
      compiled,
      dryRunProof,
    );
    const plan = transactionPlan(evidence, candidate);
    const comparablePlan = expectedPlan
      ? Object.freeze({
          ...plan,
          fingerprint: expectedPlan.fingerprint,
          market: Object.freeze({
            schema: evidence.schema,
            descriptor: clonePublic(evidence.descriptor),
            runtime: clonePublic(evidence.runtime),
          }),
        })
      : plan;
    if (expectedPlan && stableJson(expectedPlan) !== stableJson(comparablePlan)) {
      throw appError(
        'WEB_V8_DURABLE_TRANSACTION_DRIFT',
        'Fresh wallet, object, quote, epoch, gas, or TransactionData state differs from the complete durable plan; discard and review a new plan instead of signing replacement bytes.',
        'CONTEXT',
        {
          changedFields: [...new Set([...Object.keys(expectedPlan), ...Object.keys(comparablePlan)])]
            .filter((field) => stableJson(expectedPlan[field]) !== stableJson(comparablePlan[field])),
        },
      );
    }
    return Object.freeze({ compiled, evidence, plan });
  }

  async function refetchExactSigningSnapshot(durable) {
    // Every pre-sign authority is reacquired. Clearing the UI approvals first
    // prevents a failed refetch from leaving a stale quote/payment affordance.
    state.reviewedFingerprint = null;
    state.paymentFingerprint = null;
    state.quoteEvidence = null;
    state.chainQuoteProof = null;
    state.prepared = null;
    emit();

    const observedChain = await adapters.rpc.getChainIdentifier();
    if (observedChain !== execution.chainIdentifier) {
      throw appError('WEB_V8_NETWORK_MISMATCH', 'RPC chain changed before wallet signature.', 'CONTEXT');
    }
    const account = assertAccount(await adapters.wallet.getCurrentAccount(), execution);
    if (!state.account || stableJson(account) !== stableJson(state.account)) {
      throw appError('WEB_V8_WALLET_CONTEXT_DRIFT', 'Connected wallet changed after the durable plan was prepared.', 'CONTEXT');
    }
    const suiClient = await adapters.rpc.getSuiClient();
    const freshRuntime = (await attestMakerV8Runtime(suiClient, runtime, { network: execution.network })).runtime;
    const freshMarketClient = marketModule.createMarketV8Client(freshRuntime, { network: execution.network });
    const durableAction = actionById(durable.identity.action);
    const request = {
      requestId: requestId(),
      route,
      action: durableAction.id,
      eventType: makerV8StableType(freshRuntime, 'release', 'release_v8', 'MakerV8Activated'),
      marketTypes: freshMarketClient.types,
      account,
      runtime: freshRuntime,
      ...(OWNED_INVENTORY_ACTIONS.has(durableAction.id)
        ? { selectedInventoryId: durable.identity.listing.id }
        : {}),
    };
    const context = assertFreshV8ActionContext(
      await adapters.rpc.loadActionContext(request),
      request,
      freshRuntime,
      execution,
      account,
    );
    const localQuote = quoteForAction(freshMarketClient, durableAction, context.builderInput, state.grossAtomic);
    let candidate = {
      ...state,
      action: durableAction,
      runtime: freshRuntime,
      account,
      context,
      quote: localQuote,
      quoteEvidence: null,
      chainQuoteProof: null,
    };
    if (FROZEN_LISTING_ACTIONS.has(durableAction.id)) {
      const evidence = frozenListingQuoteEvidence(candidate);
      candidate = Object.freeze({
        ...candidate,
        quoteEvidence: evidence,
      });
    } else {
      const inspected = await freshMarketClient.inspectQuoteOnChain(
        suiClient,
        quoteInspectionInput(marketModule, candidate),
      );
      const chainQuote = normalizedInspectedQuote(inspected);
      for (const field of [...QUOTE_FIELDS, 'commitment']) {
        if (chainQuote[field] !== localQuote[field]) {
          throw appError('MARKET_V8_QUOTE_DRIFT', 'Fresh pre-sign chain quote differs from the complete live context.', 'CONTEXT');
        }
      }
      candidate = Object.freeze({
        ...candidate,
        quote: chainQuote,
        quoteEvidence: chainQuote.evidence,
        chainQuoteProof: inspected,
      });
    }
    const liveIdentity = recoveryModule.canonicalMakerV8RecoveryIdentity(recoveryIdentity(candidate, execution));
    const durableIdentity = recoveryModule.canonicalMakerV8RecoveryIdentity(durable.identity);
    if (stableJson(liveIdentity) !== stableJson(durableIdentity)) {
      throw appError('WEB_V8_SIGNING_CONTEXT_DRIFT', 'Wallet, objects, revisions, commitments, or lane authority changed before signing.', 'CONTEXT');
    }
    return Object.freeze({ candidate, suiClient, marketClient: freshMarketClient, identity: durableIdentity });
  }

  async function prepare() {
    try {
      if (state.reviewedFingerprint !== state.fingerprint) {
        throw appError('WEB_V8_QUOTE_REVIEW_REQUIRED', 'The current exact quote has not been reviewed.', 'VALIDATION');
      }
      if (!state.quoteEvidence) {
        throw appError('WEB_V8_QUOTE_EVIDENCE_REQUIRED', 'The exact chain quote or frozen live listing quote must be reviewed before Transaction preparation.', 'VALIDATION');
      }
      if (PURCHASE_ACTIONS.has(state.action.id) && state.paymentFingerprint !== state.fingerprint) {
        throw appError('WEB_V8_EXACT_PAYMENT_CONFIRMATION_REQUIRED', 'Exact payment has not been confirmed.', 'VALIDATION');
      }
      setBusy(true, 'READY');
      const { compiled, evidence, plan } = await rebuildAndSimulateExactAction();
      const identity = recoveryIdentity(state, execution);
      currentIdentity = identity;
      const record = await recovery.prepare({
        identity,
        plan,
        evidence,
        options: {
          afterFinalizedFailure: state.recoveryRecord?.state === 'FINALIZED_FAILURE',
        },
      });
      state.prepared = Object.freeze({
        descriptor: clonePublic(compiled.descriptor),
        digest: plan.transactionDigest,
        identity,
      });
      state.recoveryRecord = record;
      state.completionReceipt = null;
      state.status = record.state;
      state.busy = false;
      emit();
      return state.prepared;
    } catch (error) {
      return rememberError(error);
    }
  }

  async function requestSignature(confirmation) {
    try {
      if (confirmation !== 'SIGN EXACT TRANSACTION') {
        throw appError('WEB_V8_SIGNATURE_CONFIRMATION_REQUIRED', 'Type the exact signature confirmation phrase.', 'SIGNING');
      }
      if (!currentIdentity) throw appError('WEB_V8_CONTEXT_UNAVAILABLE', 'Prepare the exact Transaction first.', 'CONTEXT');
      setBusy(true, 'AWAITING_SIGNATURE');
      const durable = await recovery.load(currentIdentity);
      if (!durable?.plan) throw appError('WEB_V8_DURABLE_PLAN_REQUIRED', 'No durable unsigned plan exists for this Root.', 'RECOVERY');
      const fresh = await refetchExactSigningSnapshot(durable);
      const { evidence, plan } = await rebuildAndSimulateExactAction(
        durable.plan,
        fresh.candidate,
        fresh.suiClient,
        fresh.marketClient,
      );
      const record = await recovery.requestSignature({
        identity: durable.identity,
        liveIdentity: fresh.identity,
        plan,
        expectedRevision: durable.revision,
        expectedPlanHash: durable.plan.fingerprint,
        evidence,
      });
      state.recoveryRecord = record;
      state.status = record.state;
      state.busy = false;
      emit();
      return record;
    } catch (error) {
      return rememberError(error);
    }
  }

  async function recoverOutcome() {
    try {
      if (!currentIdentity) throw appError('WEB_V8_CONTEXT_UNAVAILABLE', 'Refresh the exact action context first.', 'CONTEXT');
      setBusy(true, 'OUTCOME_PENDING');
      const durable = await recovery.load(currentIdentity);
      const record = durable?.state === 'VERIFIED'
        ? durable
        : await recovery.recover(currentIdentity, { replayIfNotFound: false });
      if (record.state === 'VERIFIED') {
        setBusy(true, 'CLEANING');
        const receipt = await recovery.cleanupVerified(currentIdentity);
        state.recoveryRecord = null;
        state.completionReceipt = receipt;
        state.prepared = null;
        state.status = 'CLEANED';
        state.busy = false;
        emit();
        return Object.freeze({ state: 'CLEANED', receipt });
      }
      state.recoveryRecord = record;
      state.status = record.state;
      state.busy = false;
      emit();
      return record;
    } catch (error) {
      return rememberError(error);
    }
  }

  async function replayExact(confirmation) {
    try {
      if (confirmation !== 'REPLAY SAVED BYTES') {
        throw appError('WEB_V8_REPLAY_CONFIRMATION_REQUIRED', 'Type the exact replay confirmation phrase.', 'BROADCAST');
      }
      if (!currentIdentity) throw appError('WEB_V8_CONTEXT_UNAVAILABLE', 'Refresh the exact action context first.', 'CONTEXT');
      setBusy(true, 'BROADCASTING');
      const record = await recovery.broadcastSigned(currentIdentity);
      state.recoveryRecord = record;
      state.status = record.state;
      state.busy = false;
      emit();
      return record;
    } catch (error) {
      return rememberError(error);
    }
  }

  return Object.freeze({
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    refresh,
    async reconnect() {
      try {
        state.issue = null;
        setBusy(true, 'CONNECTING');
        const account = assertAccount(await adapters.wallet.reconnect(), execution);
        if (state.account && stableJson(account) !== stableJson(state.account)) {
          invalidateActionContext({ clearInventory: true });
        }
        state.account = account;
        if (state.action && OWNED_INVENTORY_ACTIONS.has(state.action.id)) {
          if (state.selectedInventoryId) {
            await loadOwnedInventory({ preserveSelection: true });
            await loadSelectedAction();
          } else await loadOwnedInventory();
        } else if (state.action) {
          await loadSelectedAction();
        } else {
          state.status = 'READY';
        }
        state.busy = false;
        emit();
        return snapshot();
      } catch (error) {
        return rememberError(error);
      }
    },
    selectAction,
    selectInventory,
    setGrossAtomic,
    reviewQuote,
    confirmExactPayment,
    prepare,
    requestSignature,
    recoverOutcome,
    replayExact,
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function shortId(value) {
  return typeof value === 'string' && value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value || '—';
}

function actionControls(state) {
  return MARKET_V8_ACTIONS.map((action) => {
    const available = state.availableActions.includes(action.id);
    const selected = state.action?.id === action.id;
    return `<button type="button" class="action-chip ${selected ? 'selected' : ''}" data-action="${action.id}" aria-pressed="${selected}" ${available && !state.busy ? '' : 'disabled'}><span>${escapeHtml(action.label)}</span><small>${action.lane} · ${action.kind}</small></button>`;
  }).join('');
}

function inventoryMarkup(state) {
  if (!OWNED_INVENTORY_ACTIONS.has(state.action?.id)) return '';
  const names = state.action.id === 'listSoulBundle'
    ? ['Output', 'Receipt', 'Soul'] : ['Asset'];
  const choices = state.inventoryChoices.map((choice) => {
    const selected = state.selectedInventoryId === choice.id;
    const objectIds = choice.objectIds.map((objectId, index) => `
      <div><dt>${escapeHtml(names[index] || `Object ${index + 1}`)}</dt><dd><code>${escapeHtml(objectId)}</code></dd></div>`).join('');
    const provenance = choice.sourceId ? `
      <div><dt>Source</dt><dd><code>${escapeHtml(choice.sourceId)}</code></dd></div>
      ${choice.sourceTreasuryId ? `<div><dt>Source treasury</dt><dd><code>${escapeHtml(choice.sourceTreasuryId)}</code></dd></div>` : ''}` : '';
    return `<button type="button" class="inventory-choice ${selected ? 'selected' : ''}" data-inventory-id="${escapeHtml(choice.id)}" aria-pressed="${selected}" ${state.busy ? 'disabled' : ''}>
      <span class="inventory-choice-heading"><strong>${escapeHtml(choice.kind.replaceAll('_', ' '))}</strong><span>Ownership epoch ${escapeHtml(choice.ownershipEpoch)}</span></span>
      <dl>${objectIds}${provenance}</dl>
    </button>`;
  }).join('');
  return `<section class="inventory-panel" aria-labelledby="inventory-title">
    <div class="section-heading"><div><p class="eyebrow">Live wallet inventory</p><h2 id="inventory-title">Select the exact object to list</h2></div><span class="safety-badge">No selection is persisted</span></div>
    <p class="fine-print">Inventory is read again for action context and before signing. A missing or changed selection fails closed.</p>
    <div class="inventory-grid">${choices || '<p class="empty-state">Reconnect the owning wallet to load exact inventory choices.</p>'}</div>
  </section>`;
}

function browseMarkup(state) {
  if (!state.browse) return '<p class="empty-state">Reading MakerV8Activated and typed listing objects…</p>';
  const listings = state.browse.listings.map((listing) => `
    <a class="market-card" href="/market/${listing.listingId}">
      <span class="state-pill">${escapeHtml(listing.kind)} · ${escapeHtml(listing.status)}</span>
      <h3>${escapeHtml(listing.title)}</h3>
      <p>${escapeHtml(listing.grossAtomic)} atomic units</p>
      <code>${escapeHtml(shortId(listing.quoteCommitment))}</code>
    </a>`).join('');
  const makers = state.browse.makers.map((maker) => `
    <a class="market-card maker-card" href="/maker/${maker.rootId}">
      <span class="state-pill active">MakerV8Activated · ACTIVE</span>
      <h3>${escapeHtml(maker.title)}</h3>
      <code>${escapeHtml(shortId(maker.rootId))}</code>
    </a>`).join('');
  return `<div class="market-grid">${listings || makers || '<p class="empty-state">No verified v8 listings are open.</p>'}</div>${makers ? `<h2>Activated Makers</h2><div class="market-grid">${makers}</div>` : ''}`;
}

function issueMarkup(issue) {
  if (!issue) return '';
  return `<section class="issue-panel" role="alert" aria-labelledby="issue-title">
    <span class="layer-pill">${escapeHtml(issue.layer)}</span>
    <h2 id="issue-title">${escapeHtml(issue.title)}</h2>
    <p>${escapeHtml(issue.nextAction)}</p>
    <details><summary>Diagnostic</summary><pre>${escapeHtml(issue.diagnostic)}</pre></details>
  </section>`;
}

function quoteMarkup(state) {
  if (!state.quote) return '<p class="empty-state">Select an eligible action to calculate the live quote.</p>';
  const reviewed = state.reviewedFingerprint === state.fingerprint;
  const payment = state.paymentFingerprint === state.fingerprint;
  const purchase = PURCHASE_ACTIONS.has(state.action.id);
  const frozen = FROZEN_LISTING_ACTIONS.has(state.action.id);
  const evidenceLabel = frozen
    ? (state.quoteEvidence ? 'Live listing quote verified' : 'Awaiting listing review')
    : (state.quoteEvidence ? 'Chain dry-run verified' : 'Awaiting chain inspection');
  return `<section class="quote-panel" aria-labelledby="quote-title">
    <div class="section-heading"><div><p class="eyebrow">${evidenceLabel}</p><h2 id="quote-title">Exact quote review</h2></div><code>${escapeHtml(shortId(state.quote.commitment))}</code></div>
    <dl class="quote-grid">
      ${QUOTE_FIELDS.map((field) => `<div><dt>${escapeHtml(field.replace('Atomic', ''))}</dt><dd>${escapeHtml(state.quote[field])}</dd></div>`).join('')}
    </dl>
    <div class="review-row">
      <button type="button" data-command="review" ${state.busy ? 'disabled' : ''}>${frozen
        ? (reviewed ? 'Frozen listing quote reviewed' : 'Review frozen listing quote')
        : (reviewed ? 'Chain quote reviewed' : 'Inspect & review chain quote')}</button>
      ${purchase ? `<button type="button" data-command="payment" ${reviewed && !state.busy ? '' : 'disabled'}>${payment ? `Exact ${escapeHtml(state.quote.grossAtomic)} intent confirmed` : `Confirm exact ${escapeHtml(state.quote.grossAtomic)} payment intent`}</button>` : ''}
    </div>
    <p class="fine-print">${frozen
      ? 'Cancel and recovery preserve the exact economics committed by the verified live listing; object state is read again before signing.'
      : `The Transaction derives exact ${escapeHtml(state.runtime.paymentCoinType)} balance from the current wallet at build time. Refreshing account or chain state clears every confirmation.`}</p>
  </section>`;
}

function executionMarkup(state) {
  const currentReview = state.reviewedFingerprint === state.fingerprint && Boolean(state.quoteEvidence);
  const currentPayment = !PURCHASE_ACTIONS.has(state.action?.id) || state.paymentFingerprint === state.fingerprint;
  const canPrepare = state.status === 'READY' && currentReview && currentPayment && !state.busy;
  const signed = ['SIGNED_DURABLE', 'BROADCASTING', 'OUTCOME_PENDING'].includes(state.status);
  return `<section class="execution-panel" aria-labelledby="execution-title">
    <div class="section-heading"><div><p class="eyebrow">Local-first execution</p><h2 id="execution-title">Build, dry run, persist, recover</h2></div><span class="safety-badge">Signature ${state.execution.allowWalletSignature ? 'enabled' : 'disabled'} · Broadcast ${state.execution.allowBroadcast ? 'enabled' : 'disabled'}</span></div>
    <div class="execution-actions">
      <button type="button" data-command="prepare" ${canPrepare ? '' : 'disabled'}>Build & dry run</button>
      <label>Signature confirmation<input id="signaturePhrase" autocomplete="off" spellcheck="false" placeholder="SIGN EXACT TRANSACTION" /></label>
      <button type="button" data-command="sign" ${state.prepared && state.execution.allowWalletSignature && !state.busy ? '' : 'disabled'}>Request wallet signature</button>
      <button type="button" data-command="recover" ${signed && !state.busy ? '' : 'disabled'}>Refresh saved outcome</button>
      <label>Replay confirmation<input id="replayPhrase" autocomplete="off" spellcheck="false" placeholder="REPLAY SAVED BYTES" /></label>
      <button type="button" data-command="replay" ${signed && state.execution.allowBroadcast && !state.busy ? '' : 'disabled'}>Replay identical saved bytes</button>
    </div>
    ${state.prepared ? `<dl class="prepared-summary"><div><dt>Action</dt><dd>${escapeHtml(state.prepared.descriptor.action)}</dd></div><div><dt>Move target</dt><dd><code>${escapeHtml(state.prepared.descriptor.target)}</code></dd></div><div><dt>Digest</dt><dd><code>${escapeHtml(state.prepared.digest)}</code></dd></div></dl>` : ''}
  </section>`;
}

export function renderFreshV8App(root, controller) {
  if (!root || typeof root.addEventListener !== 'function') throw appError('WEB_V8_ROOT_INVALID', 'A browser application root is required.');
  root.addEventListener('click', async (event) => {
    const actionButton = event.target.closest?.('[data-action]');
    const inventoryButton = event.target.closest?.('[data-inventory-id]');
    const commandButton = event.target.closest?.('[data-command]');
    try {
      if (actionButton) await controller.selectAction(actionButton.dataset.action);
      if (inventoryButton) await controller.selectInventory(inventoryButton.dataset.inventoryId);
      if (commandButton?.dataset.command === 'refresh') await controller.refresh();
      if (commandButton?.dataset.command === 'reconnect') await controller.reconnect();
      if (commandButton?.dataset.command === 'review') await controller.reviewQuote();
      if (commandButton?.dataset.command === 'payment') controller.confirmExactPayment();
      if (commandButton?.dataset.command === 'price') {
        await controller.setGrossAtomic(root.querySelector('#grossAtomic')?.value || '');
      }
      if (commandButton?.dataset.command === 'prepare') await controller.prepare();
      if (commandButton?.dataset.command === 'sign') await controller.requestSignature(root.querySelector('#signaturePhrase')?.value || '');
      if (commandButton?.dataset.command === 'recover') await controller.recoverOutcome();
      if (commandButton?.dataset.command === 'replay') await controller.replayExact(root.querySelector('#replayPhrase')?.value || '');
    } catch {
      // Controller state already carries the layered diagnostic.
    }
  });
  return controller.subscribe((state) => {
    const detail = state.route.kind === 'market' ? browseMarkup(state) : `
      <section class="object-hero">
        <p class="eyebrow">${escapeHtml(state.view?.listingKind || 'Maker v8 Root')}</p>
        <h1>${escapeHtml(state.view?.title || 'Reading live object state')}</h1>
        <p>${escapeHtml(state.view?.subtitle || 'The exact typed object and activation event are being verified.')}</p>
        <div class="object-meta"><span>${escapeHtml(state.view?.lifecycle || 'READING')}</span><span>${escapeHtml(state.view?.listingStatus || '—')}</span><code>${escapeHtml(shortId(state.route.id))}</code></div>
      </section>
      <section aria-labelledby="actions-title"><div class="section-heading"><div><p class="eyebrow">Static ABI surface</p><h2 id="actions-title">Four lanes · fourteen actions</h2></div></div><div class="action-grid">${actionControls(state)}</div></section>
      ${inventoryMarkup(state)}
      ${LIST_ACTIONS.has(state.action?.id) ? `<section class="price-row"><label for="grossAtomic">Gross atomic amount</label><input id="grossAtomic" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(state.grossAtomic)}" /><button type="button" data-command="price">Recalculate</button></section>` : ''}
      ${quoteMarkup(state)}
      ${executionMarkup(state)}`;
    root.innerHTML = `
      <div class="app-shell">
        <header class="app-header">
          <a class="brand" href="/market" aria-label="Animacraft fresh v8 market"><span class="brand-mark" aria-hidden="true">A8</span><span><strong>Animacraft</strong><small>Fresh Maker v8 market</small></span></a>
          <div class="header-actions"><span class="network-badge">${escapeHtml(state.execution.chainIdentifier)}</span><button type="button" data-command="refresh" ${state.busy ? 'disabled' : ''}>Refresh</button><button type="button" data-command="reconnect" ${state.busy ? 'disabled' : ''}>Reconnect wallet</button></div>
        </header>
        <div class="status-strip" role="status" aria-live="polite"><span class="status-dot"></span><strong>${escapeHtml(state.status)}</strong><span>${escapeHtml(state.account ? shortId(state.account.address) : 'wallet not connected')}</span></div>
        <main>${issueMarkup(state.issue)}${detail}</main>
        <footer><p>Only verified MakerV8Activated Roots and typed Market listings appear. Signing and broadcast are deployment-disabled by default.</p></footer>
      </div>`;
  });
}

function renderBootstrapError(root, error) {
  const issue = classifyFreshV8Error(error, { action: 'bootstrap' });
  root.innerHTML = `<main class="bootstrap-error"><a class="brand" href="/market">Animacraft v8</a>${issueMarkup(issue)}<p><a href="/market">Open the fresh v8 market</a></p></main>`;
}

export async function bootstrapFreshV8Browser({
  win = window,
  doc = document,
  root = doc.querySelector('#app'),
  route = parseFreshV8Route(win.location.href),
  rawRuntime = win.SoulidityMakerV8,
  rawExecution = win.SoulidityV8Execution,
  adapters,
  browserModule,
  marketModule,
  recoveryModule,
} = {}) {
  if (!root) throw appError('WEB_V8_ROOT_INVALID', 'The #app root is missing.');
  try {
    if (!route.valid) throw appError(UNSUPPORTED_PRODUCT_CODE, 'This link or cached product is not supported by the fresh Maker v8 client.');
    const cache = inspectFreshV8Cache(win.localStorage);
    if (!cache.valid) throw appError(UNSUPPORTED_PRODUCT_CODE, 'Unsupported product cache entries were detected and were not converted.');
    const execution = assertWebV8ExecutionConfig(rawExecution);
    let concreteAdapters = adapters;
    if (concreteAdapters === undefined) {
      const browser = browserModule || productionBrowserModule;
      if (typeof browser?.createProductionMakerV8BrowserAdapters !== 'function') {
        throw appError('WEB_V8_ADAPTER_INVALID', 'The production fresh-v8 browser adapter factory is unavailable.', 'CONFIGURATION');
      }
      concreteAdapters = browser.createProductionMakerV8BrowserAdapters({
        runtime: rawRuntime,
        execution,
      });
    }
    const checkedAdapters = assertFreshV8Adapters(concreteAdapters);
    const observedChain = await checkedAdapters.rpc.getChainIdentifier();
    if (observedChain !== execution.chainIdentifier) {
      throw appError('WEB_V8_NETWORK_MISMATCH', 'RPC is connected to a different chain.', 'CONTEXT');
    }
    const runtime = await assertLiveMakerV8Runtime(rawRuntime, checkedAdapters.rpc);
    const market = marketModule || productionMarketModule;
    const recovery = recoveryModule || productionRecoveryModule;
    const controller = createFreshV8Controller({
      route,
      runtime,
      execution,
      adapters: checkedAdapters,
      marketModule: market,
      recoveryModule: recovery,
      indexedDb: win.indexedDB,
    });
    renderFreshV8App(root, controller);
    await controller.refresh();
    return controller;
  } catch (error) {
    renderBootstrapError(root, error);
    throw error;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  queueMicrotask(() => {
    bootstrapFreshV8Browser().catch(() => {
      // The complete layered bootstrap error is already visible in #app.
    });
  });
}
