import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from '@mysten/sui/jsonRpc';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import {
  Transaction,
  TransactionDataBuilder,
} from '@mysten/sui/transactions';
import {
  fromBase64,
  normalizeStructTag,
  toBase64,
  toBase58,
} from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import {
  SUI_MAINNET_CHAIN,
  StandardConnect,
  StandardEvents,
  SuiSignTransaction,
  getWallets,
} from '@mysten/wallet-standard';

import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
  createMakerV8ChainClient,
} from './maker-v8-chain.js';
import {
  MARKET_V8_LANES,
  MARKET_V8_LISTING_STATUS,
  MARKET_V8_QUOTE_KINDS,
  createMarketV8Client,
} from './maker-v8-market.js';
import { MAKER_V8_ROLES } from './maker-v8-runtime.js';
import {
  MAKER_V8_ACTIONS,
  makerV8ActionV8,
} from './maker-v8-actions.js';

export const MAKER_V8_BROWSER_SCHEMA = 'animacraft.maker-v8-browser.v8';
export const MAKER_V8_OFFICIAL_MAINNET_RPC_URL = getJsonRpcFullnodeUrl('mainnet');
export const MAKER_V8_WALLET_CHAIN = SUI_MAINNET_CHAIN;

const WEB_V8_CONTEXT_SCHEMA = 'animacraft.web-market-context.v8';
const WEB_V8_ROUTE_SCHEMA = 'animacraft.web-route-view.v8';
const WEB_V8_BROWSE_SCHEMA = 'animacraft.web-market-browse.v8';
const WEB_V8_READBACK_SCHEMA = 'animacraft.web-market-finalized-readback.v8';
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{20,64}$/;
const ACTIONS = Object.freeze(Object.fromEntries(
  MAKER_V8_ACTIONS.map((action) => [action.id, action]),
));
const LIST_ACTIONS = new Set(Object.entries(ACTIONS)
  .filter(([, value]) => value.kind === 'LIST').map(([name]) => name));
const PURCHASE_ACTIONS = new Set(Object.entries(ACTIONS)
  .filter(([, value]) => value.kind === 'PURCHASE').map(([name]) => name));

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fail(code, message, layer = 'CONFIGURATION', details = {}) {
  throw new MakerV8BrowserError(code, message, layer, details);
}

export class MakerV8BrowserError extends Error {
  constructor(code, message, layer = 'CONFIGURATION', details = {}) {
    super(message);
    this.name = 'MakerV8BrowserError';
    this.code = code;
    this.layer = layer;
    this.details = freeze({ ...details });
  }
}

function id(value, label) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!EXACT_ID.test(normalized) || /^0x0+$/.test(normalized)) {
    fail('MAKER_V8_BROWSER_ID_INVALID', `${label} must be an exact non-zero Sui ID.`, 'VALIDATION');
  }
  return normalized;
}

function decimal(value, label) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    fail('MAKER_V8_BROWSER_INTEGER_INVALID', `${label} must be a canonical integer.`, 'VALIDATION');
  }
  return normalized;
}

function digest(value, label) {
  if (typeof value !== 'string' || !BASE58.test(value)) {
    fail('MAKER_V8_BROWSER_DIGEST_INVALID', `${label} must be an exact Sui digest.`, 'VALIDATION');
  }
  return value;
}

function exactPlanHash(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) {
    fail('MAKER_V8_BROWSER_PLAN_HASH_INVALID', 'Finalized readback requires the exact durable planHash.', 'READBACK');
  }
  return value;
}

async function coreEffectsFingerprint(effects) {
  if (!(effects?.bcs instanceof Uint8Array) || effects.bcs.length === 0) {
    fail('MAKER_V8_BROWSER_EFFECTS_BCS_MISSING', 'Core V2 finalized effects BCS is required.', 'READBACK');
  }
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    fail('MAKER_V8_BROWSER_WEB_CRYPTO_REQUIRED', 'Browser Web Crypto is required for effects fingerprinting.');
  }
  const hashed = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', effects.bcs));
  return `0x${[...hashed].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function objectRef(value, label) {
  const objectId = value?.objectId ?? value?.id;
  const version = value?.version ?? value?.objectVersion;
  return freeze({
    id: id(objectId, `${label}.id`),
    version: decimal(version, `${label}.version`),
    digest: digest(value?.digest, `${label}.digest`),
  });
}

function routeIdentity(route) {
  return `${route.kind}:${route.id || ''}`;
}

function executionConfig(value) {
  if (!plain(value)
    || value.network !== MAKER_V8_CHAIN_NETWORK
    || value.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || typeof value.allowWalletSignature !== 'boolean'
    || typeof value.allowBroadcast !== 'boolean'
    || (value.allowBroadcast && !value.allowWalletSignature)) {
    fail(
      'MAKER_V8_BROWSER_EXECUTION_INVALID',
      `Execution must pin ${MAKER_V8_CHAIN_NETWORK}/${MAKER_V8_MAINNET_CHAIN_IDENTIFIER} with explicit monotonic gates.`,
    );
  }
  return freeze({
    network: MAKER_V8_CHAIN_NETWORK,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: value.allowWalletSignature,
    allowBroadcast: value.allowBroadcast,
  });
}

async function observedChainIdentifier(client) {
  if (typeof client?.getChainIdentifier === 'function') return client.getChainIdentifier();
  if (typeof client?.core?.getChainIdentifier === 'function') {
    const response = await client.core.getChainIdentifier();
    return typeof response === 'string' ? response : response?.chainIdentifier;
  }
  fail('MAKER_V8_BROWSER_RPC_INVALID', 'Sui client does not expose a chain identifier.');
}

async function assertPinnedMainnet(client) {
  const observed = await observedChainIdentifier(client);
  if (observed !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
    fail(
      'MAKER_V8_BROWSER_NETWORK_DRIFT',
      'RPC no longer identifies the pinned Sui Mainnet chain.',
      'CONTEXT',
      { expected: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, observed: observed ?? null },
    );
  }
  return observed;
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_BROWSER_ADAPTER_INVALID', `${label}.${method} is required.`);
  }
}

function moveObject(response, expectedId, expectedType, label) {
  const data = response?.data;
  if (!plain(data) || response.error || !plain(data.content)
    || data.content.dataType !== 'moveObject') {
    fail('MAKER_V8_BROWSER_OBJECT_READ_FAILED', `${label} is not a parsed live Move object.`, 'READBACK');
  }
  const observedId = id(data.objectId, `${label}.objectId`);
  if (expectedId && observedId !== id(expectedId, `${label}.expectedId`)) {
    fail('MAKER_V8_BROWSER_OBJECT_DRIFT', `${label} object identity drifted.`, 'CONTEXT');
  }
  let type;
  try {
    type = normalizeStructTag(data.type ?? data.content.type);
  } catch {
    fail('MAKER_V8_BROWSER_OBJECT_TYPE_INVALID', `${label} has an invalid Move type.`, 'READBACK');
  }
  if (expectedType && type !== normalizeStructTag(expectedType)) {
    fail('MAKER_V8_BROWSER_OBJECT_TYPE_DRIFT', `${label} has the wrong stable TypeOrigin.`, 'CONTEXT');
  }
  return freeze({
    schemaVersion: 'animacraft.maker-v8-chain.v8',
    network: MAKER_V8_CHAIN_NETWORK,
    objectId: observedId,
    version: decimal(data.version, `${label}.version`),
    digest: digest(data.digest, `${label}.digest`),
    type,
    fields: data.content.fields,
    owner: data.owner,
  });
}

async function getObject(client, objectId, expectedType, label) {
  const response = await client.getObject({
    id: objectId,
    options: { showType: true, showContent: true, showOwner: true },
  });
  return moveObject(response, objectId, expectedType, label);
}

async function allEventPages(client, type, maximum = 5_000) {
  const events = [];
  let cursor = null;
  do {
    const page = await client.queryEvents({
      query: { MoveEventType: type },
      cursor,
      limit: 100,
      order: 'descending',
    });
    if (!plain(page) || !Array.isArray(page.data)) {
      fail('MAKER_V8_BROWSER_EVENT_PAGE_INVALID', 'RPC returned an invalid event page.', 'READBACK');
    }
    events.push(...page.data);
    if (events.length > maximum) {
      fail('MAKER_V8_BROWSER_RESULT_LIMIT', 'Live event discovery exceeded the bounded result limit.', 'READBACK');
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
    if (page.hasNextPage && !cursor) {
      fail('MAKER_V8_BROWSER_EVENT_CURSOR_INVALID', 'RPC omitted the next event cursor.', 'READBACK');
    }
  } while (cursor);
  return events;
}

function listingRootId(listing) {
  return listing.kind === 'MakerListingV8'
    ? listing.fields.rootId
    : listing.fields.custody.rootId;
}

function listingLane(listing) {
  if (listing.kind === 'MakerListingV8') return MARKET_V8_LANES.MAKER;
  if (listing.kind === 'SoulListingV8') return MARKET_V8_LANES.SOUL;
  return listing.fields.custody.sourceKind === 0
    ? MARKET_V8_LANES.PHYSICAL_BASE : MARKET_V8_LANES.PHYSICAL_PACK;
}

function listingActions(listing) {
  if (listing.fields.status !== MARKET_V8_LISTING_STATUS.OPEN) return [];
  if (listing.kind === 'MakerListingV8') {
    return ['purchaseMakerControl', 'cancelMakerControl', 'recoverMakerControl'];
  }
  if (listing.kind === 'SoulListingV8') {
    return ['purchaseSoulBundle', 'cancelSoulListing', 'recoverSoulListing'];
  }
  return [
    listing.fields.custody.sourceKind === 0
      ? 'purchaseBasePhysical' : 'purchasePackPhysical',
    'cancelPhysicalListing',
    'recoverPhysicalListing',
  ];
}

function rootActions(root) {
  if (root.lifecycle === 'PAUSED') return ['listMakerControl'];
  if (root.lifecycle === 'ACTIVE') {
    return ['listSoulBundle', 'listBasePhysical', 'listPackPhysical'];
  }
  return [];
}

function quoteKind(action) {
  if (ACTIONS[action].lane === 'MAKER') return MARKET_V8_QUOTE_KINDS.MAKER_RESALE;
  if (ACTIONS[action].lane === 'SOUL') return MARKET_V8_QUOTE_KINDS.SOUL_RESALE;
  return MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE;
}

function ownerEvidence(owner) {
  if (!owner) return freeze({ kind: 'NONE', value: null });
  const kind = owner.$kind
    ?? (owner.AddressOwner ? 'AddressOwner'
      : owner.ObjectOwner ? 'ObjectOwner'
        : owner.Shared ? 'Shared'
          : owner.Immutable ? 'Immutable'
            : owner.ConsensusAddressOwner ? 'ConsensusAddressOwner' : 'Unknown');
  return freeze({ kind, value: owner[kind] ?? owner });
}

function changedRef(change, side, label) {
  const version = change?.[`${side}Version`];
  const objectDigest = change?.[`${side}Digest`];
  const owner = change?.[`${side}Owner`];
  if (version === null && objectDigest === null && owner === null) return null;
  if (version === null || objectDigest === null || owner === null) {
    fail('MAKER_V8_BROWSER_EFFECT_REF_INVALID', `${label} has an incomplete ${side} effects ref.`, 'READBACK');
  }
  return freeze({
    objectId: id(change.objectId, `${label}.objectId`),
    version: decimal(version, `${label}.${side}Version`),
    digest: digest(objectDigest, `${label}.${side}Digest`),
    owner: ownerEvidence(owner),
  });
}

function historicalUnavailable(ref, role, status, cause = null) {
  fail(
    'MAKER_V8_BROWSER_READBACK_UNAVAILABLE',
    `${role} historical object version is unavailable; retry against an archival Sui Mainnet RPC.`,
    'READBACK',
    {
      retryable: true,
      archivalRpcRequired: true,
      objectId: ref.objectId,
      version: ref.version,
      status,
      cause,
    },
  );
}

async function exactPastObject(client, ref, expectedType, role, outputDigest = null) {
  if (typeof client?.tryGetPastObject !== 'function') {
    historicalUnavailable(ref, role, 'METHOD_UNAVAILABLE');
  }
  // SDK 2.20.2's JSON-RPC method serializes `version` as a JSON number.  Only
  // convert when the u64 round-trips exactly; larger versions require an
  // archival Core/gRPC reader rather than silent IEEE-754 precision loss.
  const numericVersion = Number(ref.version);
  if (!Number.isSafeInteger(numericVersion)
    || BigInt(numericVersion).toString() !== ref.version) {
    historicalUnavailable(ref, role, 'VERSION_OUTSIDE_JSON_RPC_SAFE_RANGE');
  }
  let response;
  try {
    response = await client.tryGetPastObject({
      id: ref.objectId,
      version: numericVersion,
      options: {
        showType: true,
        showContent: true,
        showOwner: true,
        showPreviousTransaction: true,
      },
    });
  } catch (error) {
    historicalUnavailable(ref, role, 'RPC_ERROR', String(error?.message || error));
  }
  if (response?.status !== 'VersionFound') {
    historicalUnavailable(ref, role, response?.status ?? 'INVALID_RESPONSE');
  }
  const details = response.details;
  const observed = {
    objectId: id(details?.objectId, `${role}.details.objectId`),
    version: decimal(details?.version, `${role}.details.version`),
    digest: digest(details?.digest, `${role}.details.digest`),
  };
  if (observed.objectId !== ref.objectId
    || observed.version !== ref.version
    || observed.digest !== ref.digest) {
    fail('MAKER_V8_BROWSER_HISTORICAL_REF_DRIFT', `${role} historical object differs from its effects ref.`, 'READBACK');
  }
  if (outputDigest && details.previousTransaction !== outputDigest) {
    fail('MAKER_V8_BROWSER_OUTPUT_TRANSACTION_DRIFT', `${role} output was not written by the finalized transaction.`, 'READBACK');
  }
  let type;
  try {
    type = normalizeStructTag(details.type ?? details.content?.type);
  } catch {
    fail('MAKER_V8_BROWSER_HISTORICAL_TYPE_INVALID', `${role} historical object type is invalid.`, 'READBACK');
  }
  if (expectedType && type !== normalizeStructTag(expectedType)) {
    fail('MAKER_V8_BROWSER_HISTORICAL_TYPE_DRIFT', `${role} historical object has the wrong TypeOrigin.`, 'READBACK');
  }
  if (details.content?.dataType !== 'moveObject' || !plain(details.content.fields)) {
    fail('MAKER_V8_BROWSER_HISTORICAL_CONTENT_INVALID', `${role} historical object is not parsed Move content.`, 'READBACK');
  }
  return freeze({
    objectId: ref.objectId,
    type,
    ownerKind: ownerEvidence(details.owner).kind,
    ref,
    owner: ownerEvidence(details.owner),
    previousTransaction: details.previousTransaction ?? null,
    parsed: details.content.fields,
  });
}

function coreTransaction(result) {
  const transaction = result?.$kind === 'Transaction'
    ? result.Transaction
    : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
  if (!transaction) {
    fail('MAKER_V8_BROWSER_CORE_TRANSACTION_INVALID', 'Core V2 returned an invalid finalized transaction.', 'READBACK');
  }
  return transaction;
}

function finalizedMarketCall(transactionData) {
  if (!plain(transactionData) || !Array.isArray(transactionData.commands)) {
    fail('MAKER_V8_BROWSER_CORE_INPUT_MISSING', 'Finalized Core V2 transaction input is missing.', 'READBACK');
  }
  const calls = transactionData.commands
    .map((command) => command?.MoveCall)
    .filter((call) => call?.module === 'market_v8');
  if (calls.length !== 1) {
    fail('MAKER_V8_BROWSER_FINALIZED_CALL_INVALID', 'Finalized input must contain exactly one Market v8 Move call.', 'READBACK');
  }
  const call = calls[0];
  const packageId = id(call.package, 'transaction.target.package');
  const target = `${packageId}::${call.module}::${call.function}`;
  return freeze({
    sender: id(transactionData.sender, 'transaction.sender'),
    status: 'SUCCESS',
    packageId,
    module: call.module,
    function: call.function,
    target,
    typeArguments: freeze((call.typeArguments || []).map((type) => normalizeStructTag(type))),
  });
}

const MARKET_LISTING_OPENED_EVENT_BCS = bcs.struct('MarketListingOpenedV8', {
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
const MARKET_LISTING_SETTLED_EVENT_BCS = bcs.struct('MarketListingSettledV8', {
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
const MARKET_LISTING_CLOSED_EVENT_BCS = bcs.struct('MarketListingClosedV8', {
  listing_id: bcs.Address,
  registry_id: bcs.Address,
  lane: bcs.u8(),
  asset_id: bcs.Address,
  seller: bcs.Address,
  recovered: bcs.bool(),
});
const MAKER_CONTROL_TRANSFERRED_EVENT_BCS = bcs.struct('MakerControlTransferredV8', {
  root_id: bcs.Address,
  previous_owner: bcs.Address,
  new_owner: bcs.Address,
  previous_control_epoch: bcs.u64(),
  new_control_epoch: bcs.u64(),
  new_admin_cap_id: bcs.Address,
});
const PHYSICAL_CUSTODY_TRANSITION_EVENT_BCS = bcs.struct('PhysicalMarketCustodyTransitionV8', {
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
const SUI_EVENT_BCS = bcs.struct('SuiEventV8Pinned', {
  package_id: bcs.Address,
  transaction_module: bcs.string(),
  sender: bcs.Address,
  event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()),
});
const SUI_TRANSACTION_EVENTS_BCS = bcs.struct('SuiTransactionEventsV8Pinned', {
  data: bcs.vector(SUI_EVENT_BCS),
});
const TRANSACTION_EVENTS_DIGEST_DOMAIN = new TextEncoder().encode('TransactionEvents::');

const EVENT_FIELD_KIND = Object.freeze({
  MarketListingOpenedV8: Object.freeze({
    listing_id: 'id', registry_id: 'id', lane: 'u8', root_id: 'id', asset_id: 'id',
    seller: 'id', ownership_epoch: 'u64', gross_atomic: 'u64', quote_commitment: 'commitment',
  }),
  MarketListingSettledV8: Object.freeze({
    listing_id: 'id', registry_id: 'id', lane: 'u8', asset_id: 'id', seller: 'id', buyer: 'id',
    gross_atomic: 'u64', protocol_atomic: 'u64', creator_atomic: 'u64',
    source_atomic: 'u64', seller_atomic: 'u64',
  }),
  MarketListingClosedV8: Object.freeze({
    listing_id: 'id', registry_id: 'id', lane: 'u8', asset_id: 'id', seller: 'id', recovered: 'bool',
  }),
  MakerControlTransferredV8: Object.freeze({
    root_id: 'id', previous_owner: 'id', new_owner: 'id', previous_control_epoch: 'u64',
    new_control_epoch: 'u64', new_admin_cap_id: 'id',
  }),
  PhysicalMarketCustodyTransitionV8: Object.freeze({
    action: 'u8', listing_id: 'id', asset_id: 'id', source_kind: 'u8', source_treasury_id: 'id',
    previous_holder: 'id', holder: 'id', previous_ownership_epoch: 'u64',
    ownership_epoch: 'u64', provenance_commitment: 'commitment',
  }),
});

function knownEventLayout(market, eventType) {
  const origins = market?.runtime?.typeOrigins;
  if (!origins) return null;
  const layouts = [
    ['marketPackageId', 'market_v8', 'MarketListingOpenedV8', MARKET_LISTING_OPENED_EVENT_BCS, 210],
    ['marketPackageId', 'market_v8', 'MarketListingSettledV8', MARKET_LISTING_SETTLED_EVENT_BCS, 201],
    ['marketPackageId', 'market_v8', 'MarketListingClosedV8', MARKET_LISTING_CLOSED_EVENT_BCS, 130],
    ['corePackageId', 'maker_v8', 'MakerControlTransferredV8', MAKER_CONTROL_TRANSFERRED_EVENT_BCS, 144],
    ['physicalPackageId', 'physical_v8', 'PhysicalMarketCustodyTransitionV8', PHYSICAL_CUSTODY_TRANSITION_EVENT_BCS, 211],
  ];
  const normalized = normalizeStructTag(eventType);
  for (const [origin, moduleName, name, layout, expectedLength] of layouts) {
    const packageValue = origins[origin];
    if (packageValue && normalized === normalizeStructTag(`${packageValue}::${moduleName}::${name}`)) {
      return freeze({
        name,
        moduleName,
        typeOriginPackageId: id(packageValue, `${name}.typeOriginPackageId`),
        layout,
        expectedLength,
      });
    }
  }
  return null;
}

function eventStructTag(eventType, label) {
  let parsed;
  try {
    parsed = TypeTagSerializer.parseFromStr(normalizeStructTag(eventType), true);
  } catch (cause) {
    fail('MAKER_V8_BROWSER_CORE_EVENT_INVALID', `${label} has an invalid event StructTag.`, 'READBACK', {
      cause: String(cause?.message || cause),
    });
  }
  if (!parsed?.struct) {
    fail('MAKER_V8_BROWSER_CORE_EVENT_INVALID', `${label} must be a concrete event StructTag.`, 'READBACK');
  }
  return parsed.struct;
}

/** Rebuild Sui's exact TransactionEvents BCS and typed digest from Core events. */
export function makerV8TransactionEventsDigestV8(events) {
  if (!Array.isArray(events) || events.length === 0) {
    fail('MAKER_V8_BROWSER_FINALIZED_EVENT_MISSING', 'TransactionEvents must contain at least one event.', 'READBACK');
  }
  const data = events.map((event, index) => {
    if (!event || typeof event.module !== 'string' || event.module.length === 0
      || typeof event.eventType !== 'string'
      || !(event.bcs instanceof Uint8Array) || event.bcs.length === 0) {
      fail('MAKER_V8_BROWSER_CORE_EVENT_INVALID', `Core V2 event ${index} cannot form TransactionEvents BCS.`, 'READBACK');
    }
    return {
      package_id: id(event.packageId, `events[${index}].packageId`),
      transaction_module: event.module,
      sender: id(event.sender, `events[${index}].sender`),
      event_type: eventStructTag(event.eventType, `events[${index}].eventType`),
      contents: event.bcs,
    };
  });
  let bytes;
  try {
    bytes = SUI_TRANSACTION_EVENTS_BCS.serialize({ data }).toBytes();
  } catch (cause) {
    fail('MAKER_V8_BROWSER_CORE_EVENT_INVALID', 'TransactionEvents BCS reconstruction failed.', 'READBACK', {
      cause: String(cause?.message || cause),
    });
  }
  const typed = new Uint8Array(TRANSACTION_EVENTS_DIGEST_DOMAIN.length + bytes.length);
  typed.set(TRANSACTION_EVENTS_DIGEST_DOMAIN);
  typed.set(bytes, TRANSACTION_EVENTS_DIGEST_DOMAIN.length);
  return freeze({
    bcs: toBase64(bytes),
    digest: toBase58(blake2b(typed, { dkLen: 32 })),
  });
}

function canonicalEventField(value, kind, label) {
  if (kind === 'id') return id(value, label);
  if (kind === 'u64') return decimal(value, label);
  if (kind === 'u8') {
    const normalized = decimal(value, label);
    if (BigInt(normalized) > 255n) fail('MAKER_V8_BROWSER_EVENT_BCS_INVALID', `${label} exceeds u8.`, 'READBACK');
    return Number(normalized);
  }
  if (kind === 'bool') {
    if (typeof value !== 'boolean') fail('MAKER_V8_BROWSER_EVENT_BCS_INVALID', `${label} must be bool.`, 'READBACK');
    return value;
  }
  if (kind === 'commitment') return commitmentHex(value, label);
  fail('MAKER_V8_BROWSER_EVENT_BCS_INVALID', `${label} has an unknown pinned field kind.`, 'READBACK');
}

function decodeKnownEventBcs(event, layout, index) {
  if (event.bcs.length !== layout.expectedLength) {
    fail(
      'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
      `Core V2 event ${index} ${layout.name} BCS has the wrong exact length.`,
      'READBACK',
      { expectedLength: layout.expectedLength, actualLength: event.bcs.length },
    );
  }
  let decoded;
  try {
    decoded = layout.layout.parse(event.bcs);
  } catch (cause) {
    fail(
      'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
      `Core V2 event ${index} ${layout.name} BCS could not be decoded.`,
      'READBACK',
      { cause: String(cause?.message || cause) },
    );
  }
  let canonicalBytes;
  try {
    canonicalBytes = layout.layout.serialize(decoded).toBytes();
  } catch (cause) {
    fail(
      'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
      `Core V2 event ${index} ${layout.name} BCS could not be canonically re-encoded.`,
      'READBACK',
      { cause: String(cause?.message || cause) },
    );
  }
  if (canonicalBytes.length !== event.bcs.length
    || canonicalBytes.some((byte, position) => byte !== event.bcs[position])) {
    fail(
      'MAKER_V8_BROWSER_EVENT_BCS_INVALID',
      `Core V2 event ${index} ${layout.name} BCS is noncanonical or has trailing bytes.`,
      'READBACK',
    );
  }
  const kinds = EVENT_FIELD_KIND[layout.name];
  const decodedKeys = Object.keys(decoded).sort();
  const expectedKeys = Object.keys(kinds).sort();
  if (decodedKeys.length !== expectedKeys.length
    || decodedKeys.some((field, position) => field !== expectedKeys[position])) {
    fail('MAKER_V8_BROWSER_EVENT_BCS_INVALID', `${layout.name} BCS fields are not exact.`, 'READBACK');
  }
  const authority = Object.freeze(Object.fromEntries(Object.entries(kinds).map(([field, kind]) => [
    field,
    canonicalEventField(decoded[field], kind, `${layout.name}.${field}`),
  ])));
  if (event.json !== null && event.json !== undefined) {
    if (!plain(event.json)) {
      fail('MAKER_V8_BROWSER_EVENT_JSON_BCS_DRIFT', `${layout.name} JSON display value is invalid.`, 'READBACK');
    }
    const jsonKeys = Object.keys(event.json).sort();
    if (jsonKeys.length !== expectedKeys.length
      || jsonKeys.some((field, position) => field !== expectedKeys[position])) {
      fail('MAKER_V8_BROWSER_EVENT_JSON_BCS_DRIFT', `${layout.name} JSON fields differ from its BCS event.`, 'READBACK');
    }
    const display = Object.fromEntries(Object.entries(kinds).map(([field, kind]) => [
      field,
      canonicalEventField(event.json[field], kind, `${layout.name}.json.${field}`),
    ]));
    if (JSON.stringify(display) !== JSON.stringify(authority)) {
      fail('MAKER_V8_BROWSER_EVENT_JSON_BCS_DRIFT', `${layout.name} JSON values differ from its BCS event.`, 'READBACK');
    }
  }
  return authority;
}

function coreEvent(event, index, transactionDigest, eventsDigest, market, emitter) {
  if (!event || typeof event.eventType !== 'string'
    || !(event.bcs instanceof Uint8Array) || event.bcs.length === 0) {
    fail('MAKER_V8_BROWSER_CORE_EVENT_INVALID', `Core V2 event ${index} is not parsed.`, 'READBACK');
  }
  const eventType = normalizeStructTag(event.eventType);
  const layout = knownEventLayout(market, eventType);
  const parsedJson = layout ? decodeKnownEventBcs(event, layout, index) : freeze({ ...event.json });
  const packageValue = id(event.packageId, `events[${index}].packageId`);
  if (layout && (packageValue !== emitter?.packageId || event.module !== emitter?.module)) {
    fail(
      'MAKER_V8_BROWSER_EVENT_ORIGIN_DRIFT',
      `${layout.name} metadata differs from the exact finalized top-level Market call.`,
      'READBACK',
    );
  }
  return freeze({
    id: freeze({ txDigest: transactionDigest, eventSeq: String(index) }),
    packageId: packageValue,
    transactionModule: event.module,
    sender: id(event.sender, `events[${index}].sender`),
    type: eventType,
    parsedJson,
    bcs: toBase64(event.bcs),
    eventsDigest,
  });
}

/** Decode the five security-relevant fresh-v8 events from their Core V2 BCS. */
export function decodeMakerV8CoreEventV8({
  event,
  index = 0,
  transactionDigest,
  eventsDigest,
  market,
  emitter,
}) {
  if (!Number.isSafeInteger(index) || index < 0) {
    fail('MAKER_V8_BROWSER_CORE_EVENT_INVALID', 'Core V2 event index must be a non-negative safe integer.', 'READBACK');
  }
  return coreEvent(
    event,
    index,
    digest(transactionDigest, 'event.transactionDigest'),
    digest(eventsDigest, 'event.eventsDigest'),
    market,
    freeze({
      packageId: id(emitter?.packageId, 'event.emitter.packageId'),
      module: emitter?.module === 'market_v8' ? emitter.module : null,
    }),
  );
}

const ARGUMENT_ROLES = Object.freeze({
  registry: 'REGISTRY', treasury: 'TREASURY', listing: 'LISTING', root: 'ROOT',
  outputRegistry: 'OUTPUT_REGISTRY', soulRegistry: 'SOUL_REGISTRY',
  physicalRegistry: 'PHYSICAL_REGISTRY',
  admin: 'ADMIN', adminReceiving: 'ADMIN',
  outputAsset: 'OUTPUT', outputReceiving: 'OUTPUT',
  receipt: 'RECEIPT', receiptReceiving: 'RECEIPT',
  soul: 'SOUL', soulReceiving: 'SOUL', asset: 'ASSET', receiving: 'ASSET',
  protocolTreasury: 'PROTOCOL_TREASURY', makerTreasury: 'MAKER_TREASURY',
  packTreasury: 'PACK_TREASURY',
});

function trackedRoleRequests(descriptor, parsedEvent) {
  if (!plain(descriptor) || !plain(descriptor.preState)
    || descriptor.preState.action !== descriptor.action
    || descriptor.preState.lane !== descriptor.lane
    || !Array.isArray(descriptor.arguments)) {
    fail('MAKER_V8_BROWSER_DURABLE_DESCRIPTOR_INVALID', 'Readback requires the exact durable fresh-v8 descriptor.', 'READBACK');
  }
  const requests = new Map();
  const add = (role, objectIdValue, type = null) => {
    if (!objectIdValue) return;
    const normalized = id(objectIdValue, `${role}.objectId`);
    const existing = requests.get(role);
    if (existing && existing.objectId !== normalized) {
      fail('MAKER_V8_BROWSER_ROLE_AMBIGUOUS', `${role} resolves to multiple object IDs.`, 'READBACK');
    }
    requests.set(role, freeze({ role, objectId: normalized, type: type ? normalizeStructTag(type) : null }));
  };
  add('ROOT', descriptor.rootId);
  add('REGISTRY', descriptor.registryId);
  add('TREASURY', descriptor.treasuryId);
  add('LISTING', parsedEvent.fields.listingId);
  descriptor.arguments.forEach((argument) => {
    const role = ARGUMENT_ROLES[argument?.name];
    if (role && argument.objectId) add(role, argument.objectId, argument.type);
  });
  return freeze([...requests.values()]);
}

function objectChangeName(change) {
  if (change.idOperation === 'Created') return 'CREATED';
  if (change.idOperation === 'Deleted' || change.outputState === 'DoesNotExist') return 'DELETED';
  return 'CHANGED';
}

function scalarField(fields, ...names) {
  for (const name of names) {
    const value = fields?.[name];
    if (value !== undefined) return value?.fields?.value ?? value?.value ?? value;
  }
  return undefined;
}

export function parseMakerV8MoveOptionIdV8(value, label = 'physical.sourceTreasuryId') {
  if (typeof value === 'string') return id(value, label);
  const vec = Array.isArray(value)
    ? value
    : value?.vec ?? value?.fields?.vec;
  if (!Array.isArray(vec) || vec.length > 1) {
    fail(
      'MAKER_V8_BROWSER_OPTION_INVALID',
      `${label} must be an exact zero-or-one-element Move Option<ID>.`,
      'READBACK',
    );
  }
  return vec.length === 0 ? null : id(vec[0], label);
}

function commitmentHex(value, label) {
  if (Array.isArray(value) && value.length === 32
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return `0x${value.map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
  }
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  fail('MAKER_V8_BROWSER_COMMITMENT_INVALID', `${label} is not an exact 32-byte commitment.`, 'READBACK');
}

function validatePhysicalCustody(descriptor, objects) {
  if (![MARKET_V8_LANES.PHYSICAL_BASE, MARKET_V8_LANES.PHYSICAL_PACK].includes(descriptor.lane)) return;
  if (descriptor.lane !== descriptor.preState.lane) {
    fail('MAKER_V8_BROWSER_PHYSICAL_LANE_DRIFT', 'Physical descriptor lane differs from its exact pre-state.', 'READBACK');
  }
  const listingObject = objects.find((entry) => entry.role === 'LISTING');
  const fields = listingObject?.after?.parsed ?? listingObject?.before?.parsed;
  const custodyValue = scalarField(fields, 'custody');
  const custody = custodyValue?.fields ?? custodyValue;
  if (!plain(custody)) {
    fail('MAKER_V8_BROWSER_PHYSICAL_CUSTODY_DRIFT', 'Physical listing custody binding is missing.', 'READBACK');
  }
  const sourceKind = Number(scalarField(custody, 'source_kind', 'sourceKind'));
  const expectedSourceKind = descriptor.lane === MARKET_V8_LANES.PHYSICAL_BASE ? 0 : 1;
  const sourceRole = expectedSourceKind === 0 ? 'MAKER_TREASURY' : 'PACK_TREASURY';
  const sourceTreasury = objects.find((entry) => entry.role === sourceRole);
  const custodyTreasuryId = parseMakerV8MoveOptionIdV8(
    scalarField(custody, 'source_treasury_id', 'sourceTreasuryId'),
    'physical.custody.sourceTreasuryId',
  );
  const expected = descriptor.preState.physical;
  const exactCommitment = (camel, snake) => commitmentHex(
    scalarField(custody, snake, camel), `physical.${camel}`,
  );
  if (!plain(expected)
    || sourceKind !== expectedSourceKind
    || custodyTreasuryId !== expected.sourceTreasuryId
    || (sourceTreasury && custodyTreasuryId !== sourceTreasury.objectId)
    || id(scalarField(custody, 'source_id', 'sourceId'), 'physical.sourceId') !== expected.sourceId
    || String(scalarField(custody, 'source_semantic_id', 'sourceSemanticId')) !== expected.sourceSemanticId
    || exactCommitment('assetContentCommitment', 'asset_content_commitment') !== expected.assetContentCommitment
    || exactCommitment('sourceContentCommitment', 'source_content_commitment') !== expected.sourceContentCommitment
    || exactCommitment('provenanceCommitment', 'provenance_commitment') !== expected.provenanceCommitment
    || scalarField(custody, 'transferable') !== expected.transferable) {
    fail('MAKER_V8_BROWSER_PHYSICAL_CUSTODY_DRIFT', 'Physical lane does not match exact custody source kind and treasury.', 'READBACK');
  }
  const assetObject = objects.find((entry) => entry.role === 'ASSET');
  const asset = assetObject?.before?.parsed ?? assetObject?.after?.parsed;
  if (asset) {
    const assetTreasuryId = parseMakerV8MoveOptionIdV8(
      scalarField(asset, 'source_treasury_id', 'sourceTreasuryId'),
      'physical.asset.sourceTreasuryId',
    );
    const expectedAssetTreasuryId = expectedSourceKind === 0 ? null : expected.sourceTreasuryId;
    if (Number(scalarField(asset, 'source_kind', 'sourceKind')) !== expectedSourceKind
      || assetTreasuryId !== expectedAssetTreasuryId
      || id(scalarField(asset, 'source_id', 'sourceId'), 'physical.asset.sourceId') !== expected.sourceId
      || String(scalarField(asset, 'source_semantic_id', 'sourceSemanticId')) !== expected.sourceSemanticId
      || commitmentHex(
        scalarField(asset, 'asset_content_commitment', 'assetContentCommitment'),
        'physical.asset.assetContentCommitment',
      ) !== expected.assetContentCommitment
      || commitmentHex(
        scalarField(asset, 'source_content_commitment', 'sourceContentCommitment'),
        'physical.asset.sourceContentCommitment',
      ) !== expected.sourceContentCommitment
      || commitmentHex(
        scalarField(asset, 'provenance_commitment', 'provenanceCommitment'),
        'physical.asset.provenanceCommitment',
      ) !== expected.provenanceCommitment
      || scalarField(asset, 'transferable') !== expected.transferable) {
      fail('MAKER_V8_BROWSER_PHYSICAL_ASSET_DRIFT', 'Physical asset provenance differs from its exact listing custody binding.', 'READBACK');
    }
  }
}

function revenueSnapshot(snapshot, role) {
  if (!['PROTOCOL_TREASURY', 'MAKER_TREASURY', 'PACK_TREASURY'].includes(role)) return null;
  if (!snapshot?.parsed) return null;
  return freeze({
    balance: decimal(scalarField(snapshot.parsed, 'revenue', 'balance'), `${role}.balance`),
    totalCollected: decimal(
      scalarField(snapshot.parsed, 'total_collected', 'totalCollected'),
      `${role}.totalCollected`,
    ),
    totalWithdrawn: decimal(
      scalarField(snapshot.parsed, 'total_withdrawn', 'totalWithdrawn'),
      `${role}.totalWithdrawn`,
    ),
    integerWidth: role === 'PACK_TREASURY' ? 64 : 128,
  });
}

function addressOwner(ref) {
  return ref?.owner?.kind === 'AddressOwner'
    ? id(ref.owner.value, 'effects.outputOwner.AddressOwner') : null;
}

function parentOwner(ref) {
  return ref?.owner?.kind === 'ObjectOwner'
    ? id(ref.owner.value, 'effects.owner.ObjectOwner') : null;
}

function tableId(snapshot, field, label) {
  const table = snapshot?.parsed?.[field];
  const value = table?.fields?.id?.id ?? table?.fields?.id ?? table?.id?.id ?? table?.id;
  return id(value, label);
}

function assertCompanionEvents({ events, market, descriptor, action, terminal, objects }) {
  const eventByType = (type) => events.filter((event) => event.type === normalizeStructTag(type));
  const coreTransferType = `${market.runtime.typeOrigins.corePackageId}::maker_v8::MakerControlTransferredV8`;
  const makerTransfers = eventByType(coreTransferType);
  if (descriptor.action === 'purchaseMakerControl') {
    if (makerTransfers.length !== 1) {
      fail('MAKER_V8_BROWSER_MAKER_EVENT_MISSING', 'Maker purchase requires one exact control-transfer companion event.', 'READBACK');
    }
    const event = makerTransfers[0];
    const fields = event.parsedJson;
    const newAdmin = objects.find((entry) => entry.role === 'ADMIN_NEW');
    if (event.sender !== descriptor.sender
      || id(scalarField(fields, 'root_id', 'rootId'), 'makerTransfer.rootId') !== descriptor.rootId
      || id(scalarField(fields, 'previous_owner', 'previousOwner'), 'makerTransfer.previousOwner') !== descriptor.preState.root.owner
      || id(scalarField(fields, 'new_owner', 'newOwner'), 'makerTransfer.newOwner') !== descriptor.sender
      || decimal(scalarField(fields, 'previous_control_epoch', 'previousControlEpoch'), 'makerTransfer.previousEpoch') !== descriptor.preState.root.controlEpoch
      || decimal(scalarField(fields, 'new_control_epoch', 'newControlEpoch'), 'makerTransfer.newEpoch')
        !== (BigInt(descriptor.preState.root.controlEpoch) + 1n).toString()
      || id(scalarField(fields, 'new_admin_cap_id', 'newAdminCapId'), 'makerTransfer.newAdminCapId') !== newAdmin?.objectId) {
      fail('MAKER_V8_BROWSER_MAKER_EVENT_DRIFT', 'Maker control-transfer companion event differs from exact effects.', 'READBACK');
    }
  } else if (makerTransfers.length !== 0) {
    fail('MAKER_V8_BROWSER_MAKER_EVENT_DRIFT', 'Non-Maker-purchase action emitted an unexpected control-transfer event.', 'READBACK');
  }

  const physicalType = `${market.runtime.typeOrigins.physicalPackageId}::physical_v8::PhysicalMarketCustodyTransitionV8`;
  const physicalEvents = eventByType(physicalType);
  const physical = action.lanes.some((lane) => lane.startsWith('PHYSICAL_'));
  if (!physical) {
    if (physicalEvents.length !== 0) {
      fail('MAKER_V8_BROWSER_PHYSICAL_EVENT_DRIFT', 'Non-Physical action emitted a custody companion event.', 'READBACK');
    }
    return;
  }
  if (physicalEvents.length !== 1) {
    fail('MAKER_V8_BROWSER_PHYSICAL_EVENT_MISSING', 'Physical action requires one exact custody companion event.', 'READBACK');
  }
  const event = physicalEvents[0];
  const fields = event.parsedJson;
  const purchase = action.kind === 'PURCHASE';
  const expectedAction = action.kind === 'LIST' ? '0' : purchase ? '2' : '1';
  const expectedEpoch = purchase
    ? (BigInt(descriptor.preState.ownershipEpoch) + 1n).toString()
    : descriptor.preState.ownershipEpoch;
  const expectedHolder = purchase ? descriptor.sender : descriptor.preState.seller;
  if (event.sender !== descriptor.sender
    || decimal(scalarField(fields, 'action'), 'physicalEvent.action') !== expectedAction
    || id(scalarField(fields, 'listing_id', 'listingId'), 'physicalEvent.listingId') !== terminal.fields.listingId
    || id(scalarField(fields, 'asset_id', 'assetId'), 'physicalEvent.assetId') !== descriptor.preState.assetIds[0]
    || decimal(scalarField(fields, 'source_kind', 'sourceKind'), 'physicalEvent.sourceKind') !== descriptor.preState.physical.sourceKind
    || id(scalarField(fields, 'source_treasury_id', 'sourceTreasuryId'), 'physicalEvent.sourceTreasuryId') !== descriptor.preState.physical.sourceTreasuryId
    || id(scalarField(fields, 'previous_holder', 'previousHolder'), 'physicalEvent.previousHolder') !== descriptor.preState.seller
    || id(scalarField(fields, 'holder'), 'physicalEvent.holder') !== expectedHolder
    || decimal(scalarField(fields, 'previous_ownership_epoch', 'previousOwnershipEpoch'), 'physicalEvent.previousEpoch') !== descriptor.preState.ownershipEpoch
    || decimal(scalarField(fields, 'ownership_epoch', 'ownershipEpoch'), 'physicalEvent.epoch') !== expectedEpoch
    || commitmentHex(scalarField(fields, 'provenance_commitment', 'provenanceCommitment'), 'physicalEvent.provenance') !== descriptor.preState.physical.provenanceCommitment) {
    fail('MAKER_V8_BROWSER_PHYSICAL_EVENT_DRIFT', 'Physical custody companion event differs from exact effects and provenance.', 'READBACK');
  }
}

/** Effects-bound receipt envelope using only exact Core V2 execution refs. */
export async function readFinalizedMakerV8EnvelopeV8({ client, market, request }) {
  if (typeof client?.core?.getTransaction !== 'function') {
    fail('MAKER_V8_BROWSER_CORE_V2_REQUIRED', 'Core V2 getTransaction is required for finalized readback.', 'READBACK');
  }
  const transactionDigest = digest(request?.digest, 'request.digest');
  const planHash = exactPlanHash(request?.planHash ?? request?.plan?.planHash);
  if (request?.plan?.fingerprint !== planHash) {
    fail('MAKER_V8_BROWSER_PLAN_HASH_INVALID', 'Readback planHash differs from the exact durable plan fingerprint.', 'READBACK');
  }
  const descriptor = request?.plan?.sourceSnapshot?.descriptor;
  const coreResult = await client.core.getTransaction({
    digest: transactionDigest,
    include: { transaction: true, bcs: true, effects: true, events: true, objectTypes: true },
  });
  const finalized = coreTransaction(coreResult);
  const effects = finalized.effects;
  if (finalized.digest !== transactionDigest
    || effects?.transactionDigest !== transactionDigest
    || finalized.status?.success !== true
    || effects.status?.success !== true) {
    fail('MAKER_V8_BROWSER_FINALIZED_DRIFT', 'Core V2 transaction/effects do not bind the finalized successful digest.', 'READBACK');
  }
  if (!(finalized.bcs instanceof Uint8Array)
    || toBase64(finalized.bcs) !== request?.plan?.transactionBytes) {
    fail('MAKER_V8_BROWSER_FINALIZED_BYTES_DRIFT', 'Core V2 TransactionData bytes differ from the exact durable signed plan.', 'READBACK');
  }
  const epoch = decimal(finalized.epoch, 'transaction.epoch');
  const effectsFingerprint = await coreEffectsFingerprint(effects);
  const queriedEventsDigest = request?.outcome?.eventsDigest ?? null;
  if (decimal(request?.outcome?.epoch, 'outcome.epoch') !== epoch
    || request?.outcome?.effectsFingerprint !== effectsFingerprint
    || queriedEventsDigest !== (effects.eventsDigest ?? null)) {
    fail('MAKER_V8_BROWSER_FINALIZED_DRIFT', 'Readback Core V2 evidence differs from the finalized query evidence.', 'READBACK');
  }
  const transaction = finalizedMarketCall(finalized.transaction);
  const marketCallablePackageId = id(
    market?.runtime?.sourceRuntime?.roles?.market?.callablePackageId
      ?? market?.runtime?.callablePackageId,
    'runtime.market.callablePackageId',
  );
  if (transaction.packageId !== marketCallablePackageId
    || transaction.module !== 'market_v8'
    || transaction.sender !== descriptor?.sender
    || transaction.target !== descriptor?.target
    || JSON.stringify(transaction.typeArguments) !== JSON.stringify(descriptor?.typeArguments)) {
    fail(
      'MAKER_V8_BROWSER_FINALIZED_CALL_INVALID',
      'Finalized top-level Market call differs from the attested callable and durable descriptor.',
      'READBACK',
    );
  }
  const eventsDigest = effects.eventsDigest ? digest(effects.eventsDigest, 'effects.eventsDigest') : null;
  if (!eventsDigest || !Array.isArray(finalized.events)) {
    fail('MAKER_V8_BROWSER_FINALIZED_EVENT_MISSING', 'Finalized effects do not bind an event digest and events.', 'READBACK');
  }
  const transactionEvents = makerV8TransactionEventsDigestV8(finalized.events);
  if (transactionEvents.digest !== eventsDigest) {
    fail(
      'MAKER_V8_BROWSER_EVENTS_DIGEST_DRIFT',
      'Reconstructed TransactionEvents BCS digest differs from finalized effects.',
      'READBACK',
      { expected: eventsDigest, observed: transactionEvents.digest },
    );
  }
  const events = freeze(finalized.events.map((event, index) => decodeMakerV8CoreEventV8({
    event,
    index,
    transactionDigest,
    eventsDigest,
    market,
    emitter: freeze({ packageId: transaction.packageId, module: transaction.module }),
  })));
  const action = makerV8ActionV8(request.identity.action);
  if (!action) fail('MAKER_V8_BROWSER_ACTION_INVALID', 'Unknown durable Market action.', 'READBACK');
  if (descriptor?.action !== action.id
    || descriptor.sender !== request.identity.wallet
    || descriptor.rootId !== request.identity.root?.id
    || descriptor.registryId !== request.identity.registry?.id
    || descriptor.treasuryId !== request.identity.treasury?.id) {
    fail('MAKER_V8_BROWSER_DURABLE_DESCRIPTOR_INVALID', 'Durable action descriptor differs from the exact recovery identity.', 'READBACK');
  }
  const allowedLanes = action.lanes.map((lane) => MARKET_V8_LANES[lane]);
  if (!allowedLanes.includes(descriptor?.lane)) {
    fail('MAKER_V8_BROWSER_PHYSICAL_LANE_DRIFT', 'Durable descriptor lane differs from the exact action contract.', 'READBACK');
  }
  const expectedKind = action.kind === 'LIST' ? 'MarketListingOpenedV8'
    : action.kind === 'PURCHASE' ? 'MarketListingSettledV8' : 'MarketListingClosedV8';
  const parsedEvents = events.map((event) => {
    try { return { event, parsed: market.parseEvent(event) }; } catch { return null; }
  }).filter(Boolean);
  const terminal = parsedEvents.filter(({ parsed }) => parsed.kind === expectedKind);
  if (terminal.length !== 1) {
    fail('MAKER_V8_BROWSER_FINALIZED_EVENT_MISSING', 'Expected exact terminal Market event is not unique.', 'READBACK');
  }
  if (terminal[0].event.sender !== descriptor.sender
    || terminal[0].parsed.fields.lane !== descriptor?.lane) {
    fail('MAKER_V8_BROWSER_FINALIZED_EVENT_DRIFT', 'Terminal Market event sender or lane differs from the durable descriptor.', 'READBACK');
  }
  if ([MARKET_V8_LANES.PHYSICAL_BASE, MARKET_V8_LANES.PHYSICAL_PACK].includes(descriptor.lane)
    && !events.some((event) => event.type.endsWith('::physical_v8::PhysicalMarketCustodyTransitionV8'))) {
    fail('MAKER_V8_BROWSER_PHYSICAL_EVENT_MISSING', 'Physical action lacks its exact custody transition companion event.', 'READBACK');
  }
  const changes = new Map();
  const changedObjects = freeze((effects.changedObjects || []).map((change, index) => {
    const objectIdValue = id(change.objectId, `effects.changedObjects[${index}].objectId`);
    if (changes.has(objectIdValue)) {
      fail('MAKER_V8_BROWSER_EFFECT_OBJECT_DUPLICATE', 'Core V2 effects repeat a changed object.', 'READBACK');
    }
    const normalized = freeze({
      objectId: objectIdValue,
      inputState: change.inputState,
      input: changedRef(change, 'input', `effects.changedObjects[${index}]`),
      outputState: change.outputState,
      output: changedRef(change, 'output', `effects.changedObjects[${index}]`),
      idOperation: change.idOperation,
    });
    changes.set(objectIdValue, { raw: change, normalized });
    return normalized;
  }));
  const unchanged = new Map((effects.unchangedConsensusObjects || []).map((entry, index) => {
    const objectIdValue = id(entry.objectId, `effects.unchangedConsensusObjects[${index}].objectId`);
    if (!entry.version || !entry.digest) return [objectIdValue, null];
    return [objectIdValue, freeze({
      objectId: objectIdValue,
      version: decimal(entry.version, `effects.unchangedConsensusObjects[${index}].version`),
      digest: digest(entry.digest, `effects.unchangedConsensusObjects[${index}].digest`),
      owner: freeze({ kind: 'Shared', value: null }),
      kind: entry.kind,
    })];
  }));
  const objects = [];
  for (const roleRequest of trackedRoleRequests(descriptor, terminal[0].parsed)) {
    const changed = changes.get(roleRequest.objectId);
    const readonly = unchanged.get(roleRequest.objectId);
    if (!changed && !readonly) {
      fail('MAKER_V8_BROWSER_OBJECT_EVIDENCE_MISSING', `${roleRequest.role} is absent from exact Core V2 effects.`, 'READBACK');
    }
    const beforeRef = changed?.normalized.input ?? readonly;
    const afterRef = changed?.normalized.output ?? readonly;
    const before = beforeRef
      ? await exactPastObject(client, beforeRef, roleRequest.type, `${roleRequest.role}.before`) : null;
    const after = afterRef
      ? await exactPastObject(client, afterRef, roleRequest.type, `${roleRequest.role}.after`, changed ? transactionDigest : null) : null;
    const type = roleRequest.type
      ?? finalized.objectTypes?.[roleRequest.objectId]
      ?? before?.type ?? after?.type;
    if (!type) fail('MAKER_V8_BROWSER_OBJECT_TYPE_INVALID', `${roleRequest.role} effects omit object type.`, 'READBACK');
    objects.push(freeze({
      role: roleRequest.role,
      objectId: roleRequest.objectId,
      type: normalizeStructTag(type),
      ownerKind: (after ?? before)?.ownerKind,
      change: changed ? objectChangeName(changed.raw) : 'READBACK',
      idOperation: changed?.raw.idOperation ?? 'None',
      before,
      after,
      revenue: freeze({
        before: revenueSnapshot(before, roleRequest.role),
        after: revenueSnapshot(after, roleRequest.role),
      }),
    }));
  }
  if (descriptor.action === 'purchaseSoulBundle') {
    const outputOrigin = market.runtime.typeOrigins.outputPackageId;
    const registryRows = new Map(objects.map((entry) => [entry.role, entry]));
    for (const [role, recordName, registryRole, tableField] of [
      ['OUTPUT_RECORD', 'OutputRecordV8', 'OUTPUT_REGISTRY', 'outputs'],
      ['SOUL_RECORD', 'SoulRecordV8', 'SOUL_REGISTRY', 'souls'],
    ]) {
      const recordType = normalizeStructTag(`${outputOrigin}::output_v8::${recordName}`);
      const expectedType = normalizeStructTag(`0x2::dynamic_field::Field<0x2::object::ID,${recordType}>`);
      const registry = registryRows.get(registryRole);
      const expectedParent = tableId(registry?.before ?? registry?.after, tableField, `${role}.tableId`);
      const candidates = [...changes.values()].filter(({ normalized }) => {
        const type = finalized.objectTypes?.[normalized.objectId];
        return typeof type === 'string'
          && normalizeStructTag(type) === expectedType
          && parentOwner(normalized.input) === expectedParent
          && parentOwner(normalized.output) === expectedParent;
      });
      if (candidates.length !== 1) {
        fail('MAKER_V8_BROWSER_DYNAMIC_RECORD_AMBIGUOUS', `${role} is not unique in Core V2 effects.`, 'READBACK');
      }
      const candidate = candidates[0];
      const before = candidate.normalized.input
        ? await exactPastObject(client, candidate.normalized.input, null, `${role}.before`) : null;
      const after = candidate.normalized.output
        ? await exactPastObject(client, candidate.normalized.output, null, `${role}.after`, transactionDigest) : null;
      objects.push(freeze({
        role,
        objectId: candidate.normalized.objectId,
        type: expectedType,
        ownerKind: (after ?? before)?.ownerKind,
        change: objectChangeName(candidate.raw),
        idOperation: candidate.raw.idOperation,
        before,
        after,
        revenue: freeze({ before: null, after: null }),
      }));
    }
  }
  if (descriptor.action === 'purchaseMakerControl') {
    const adminArgument = descriptor.arguments.find((argument) => argument.name === 'adminReceiving');
    const adminType = normalizeStructTag(adminArgument?.type);
    const candidates = [...changes.values()].filter(({ raw, normalized }) => (
      raw.idOperation === 'Created'
      && typeof finalized.objectTypes?.[normalized.objectId] === 'string'
      && normalizeStructTag(finalized.objectTypes[normalized.objectId]) === adminType
      && addressOwner(normalized.output) === descriptor.sender
    ));
    if (candidates.length !== 1) {
      fail('MAKER_V8_BROWSER_ADMIN_OUTPUT_AMBIGUOUS', 'Maker purchase new AdminCap is not unique in Core V2 effects.', 'READBACK');
    }
    const candidate = candidates[0];
    const after = await exactPastObject(
      client, candidate.normalized.output, adminType, 'ADMIN_NEW.after', transactionDigest,
    );
    objects.push(freeze({
      role: 'ADMIN_NEW',
      objectId: candidate.normalized.objectId,
      type: adminType,
      ownerKind: after.ownerKind,
      change: 'CREATED',
      idOperation: 'Created',
      before: null,
      after,
      revenue: freeze({ before: null, after: null }),
    }));
  }
  if (action.kind === 'PURCHASE') {
    const paymentCoin = normalizeStructTag(`0x2::coin::Coin<${descriptor.typeArguments?.[0]}>`);
    const expectedLines = [
      { role: 'CREATOR_COIN', owner: id(descriptor.preState.root?.creator, 'CREATOR_COIN.owner'), amount: decimal(descriptor.preState.quote?.creatorAtomic, 'CREATOR_COIN.balance') },
      { role: 'SELLER_COIN', owner: id(descriptor.preState.seller, 'SELLER_COIN.owner'), amount: decimal(descriptor.preState.quote?.sellerAtomic, 'SELLER_COIN.balance') },
    ];
    const candidates = [];
    for (const candidate of changes.values()) {
      const candidateType = finalized.objectTypes?.[candidate.normalized.objectId];
      if (candidate.raw.idOperation !== 'Created'
        || typeof candidateType !== 'string'
        || normalizeStructTag(candidateType) !== paymentCoin
        || !candidate.normalized.output) continue;
      const after = await exactPastObject(
        client, candidate.normalized.output, paymentCoin, 'PAYOUT_COIN.after', transactionDigest,
      );
      candidates.push({
        candidate,
        after,
        owner: addressOwner(candidate.normalized.output),
        amount: decimal(scalarField(after.parsed, 'balance'), 'PAYOUT_COIN.balance'),
      });
    }
    const groupedExpected = new Map();
    const matchedCandidateIds = new Set();
    for (const line of expectedLines.filter((entry) => entry.amount !== '0')) {
      const key = `${line.owner}:${line.amount}`;
      groupedExpected.set(key, [...(groupedExpected.get(key) || []), line]);
    }
    for (const [key, lines] of groupedExpected) {
      const matches = candidates
        .filter((entry) => `${entry.owner}:${entry.amount}` === key)
        .sort((left, right) => left.candidate.normalized.objectId.localeCompare(right.candidate.normalized.objectId));
      if (matches.length !== lines.length) {
        fail('MAKER_V8_BROWSER_COIN_OUTPUT_AMBIGUOUS', 'Exact creator/seller Coin output multiset does not match the quote.', 'READBACK', {
          key,
          expectedCount: lines.length,
          observedCount: matches.length,
        });
      }
      [...lines].sort((left, right) => left.role.localeCompare(right.role))
        .forEach((line, index) => {
          const { candidate, after } = matches[index];
          matchedCandidateIds.add(candidate.normalized.objectId);
          objects.push(freeze({
            role: line.role,
            objectId: candidate.normalized.objectId,
            type: paymentCoin,
            ownerKind: after.ownerKind,
            change: 'CREATED',
            idOperation: 'Created',
            before: null,
            after,
            revenue: freeze({ before: null, after: null }),
          }));
        });
    }
    if (candidates.some(({ candidate }) => !matchedCandidateIds.has(candidate.normalized.objectId))) {
      fail(
        'MAKER_V8_BROWSER_COIN_OUTPUT_AMBIGUOUS',
        'Finalized effects contain an unexpected surviving payment Coin output.',
        'READBACK',
      );
    }
    const zeroCreator = expectedLines.find((entry) => entry.role === 'CREATOR_COIN' && entry.amount === '0');
    if (zeroCreator && candidates.some((entry) => entry.owner === zeroCreator.owner && entry.amount === '0')) {
      fail('MAKER_V8_BROWSER_COIN_OUTPUT_AMBIGUOUS', 'Zero creator payout must not create a surviving Coin.', 'READBACK');
    }
  }
  assertCompanionEvents({
    events,
    market,
    descriptor,
    action,
    terminal: terminal[0].parsed,
    objects,
  });
  validatePhysicalCustody(descriptor, objects);
  return freeze({
    schemaVersion: WEB_V8_READBACK_SCHEMA,
    source: 'FINALIZED_CORE_V2',
    digest: transactionDigest,
    epoch,
    effectsFingerprint,
    eventsDigest,
    planHash,
    identity: request.identity,
    transaction,
    event: terminal[0].event,
    events,
    effects: freeze({
      transactionDigest,
      epoch,
      eventsDigest,
      eventsBcs: transactionEvents.bcs,
      transactionBcs: finalized.bcs instanceof Uint8Array ? toBase64(finalized.bcs) : null,
      bcs: effects.bcs instanceof Uint8Array ? toBase64(effects.bcs) : null,
      changedObjects,
      unchangedConsensusObjects: freeze([...unchanged.values()].filter(Boolean)),
      objects: freeze(objects),
    }),
  });
}

/**
 * Default live reader for the public fresh-v8 product path. It reads only the
 * seven-role runtime, stable activation/event types, and typed Market objects.
 */
export function createMakerV8LiveDataSourceV8({ client, runtime: runtimeInput }) {
  if (!client || !runtimeInput) {
    fail('MAKER_V8_BROWSER_DATA_SOURCE_INVALID', 'A concrete client and seven-role runtime are required.');
  }
  let readyPromise;
  const ready = () => {
    if (!readyPromise) {
      readyPromise = (async () => {
        await assertPinnedMainnet(client);
        const attested = await attestMakerV8Runtime(client, runtimeInput, {
          network: MAKER_V8_CHAIN_NETWORK,
        });
        return freeze({
          ...attested,
          chain: createMakerV8ChainClient(attested.runtime, {
            rpc: client,
            network: MAKER_V8_CHAIN_NETWORK,
          }),
          market: createMarketV8Client(attested.runtime, { network: MAKER_V8_CHAIN_NETWORK }),
        });
      })();
    }
    return readyPromise;
  };

  async function loadListing(objectId) {
    const { market } = await ready();
    const response = await client.getObject({
      id: objectId,
      options: { showType: true, showContent: true, showOwner: true },
    });
    const observed = response?.data?.type ?? response?.data?.content?.type;
    if (observed && normalizeStructTag(observed) === market.types.makerListing) return market.parseMakerListing(response);
    if (observed && normalizeStructTag(observed) === market.types.soulListing) return market.parseSoulListing(response);
    if (observed && normalizeStructTag(observed) === market.types.physicalListing) return market.parsePhysicalListing(response);
    fail('MAKER_V8_BROWSER_LISTING_TYPE_INVALID', 'Route object is not a typed fresh-v8 Market listing.', 'READBACK');
  }

  async function activationForRoot(rootId) {
    const { chain } = await ready();
    const activation = (await chain.discover()).find((entry) => entry.binding.rootId === rootId);
    if (!activation) {
      fail('MAKER_V8_BROWSER_ACTIVATION_NOT_FOUND', 'No exact MakerV8Activated event binds this Root.', 'READBACK');
    }
    return activation;
  }

  async function commonContext(rootId) {
    const state = await ready();
    const activation = await activationForRoot(rootId);
    const { root } = await state.chain.loadContext(activation);
    const operational = await state.chain.loadOperationalState(root);
    const [registryResponse, treasuryResponse, packageTuple] = await Promise.all([
      client.getObject({
        id: root.binding.marketRegistryId,
        options: { showType: true, showContent: true, showOwner: true },
      }),
      client.getObject({
        id: root.binding.marketTreasuryId,
        options: { showType: true, showContent: true, showOwner: true },
      }),
      Promise.all(MAKER_V8_ROLES.map(async (role) => {
        const identity = state.runtime.roles[role];
        const response = await client.getObject({
          id: identity.callablePackageId,
          options: { showBcs: true },
        });
        if (!response?.data?.digest) {
          fail('MAKER_V8_BROWSER_PACKAGE_READ_FAILED', `${role} callable package could not be read.`, 'READBACK');
        }
        return freeze({
          role,
          originalPackageId: identity.typeOriginPackageId,
          callablePackageId: identity.callablePackageId,
          packageDigest: digest(response.data.digest, `${role}.packageDigest`),
        });
      })),
    ]);
    const registry = state.market.parseRegistry(registryResponse);
    const treasury = state.market.parseTreasury(treasuryResponse);
    if (registry.fields.rootId !== root.objectId
      || registry.fields.treasuryId !== treasury.objectId
      || treasury.fields.rootId !== root.objectId) {
      fail('MAKER_V8_BROWSER_MARKET_BINDING_DRIFT', 'Market Registry/Treasury no longer bind the live Root.', 'CONTEXT');
    }
    return freeze({
      ...state,
      activation,
      root,
      protocolConfig: operational.protocolConfig,
      makerTreasury: operational.makerTreasury,
      registry,
      treasury,
      packageTuple: freeze(packageTuple),
      catalog: state.catalog,
      config: state.configs.market,
    });
  }

  async function genericRootObject(common, bindingField, typeField, label) {
    return getObject(
      client,
      common.root.binding[bindingField],
      common.market.types[typeField],
      label,
    );
  }

  async function receiving(common, objectId, listingId, expectedType) {
    return common.chain.receivingRef(objectId, listingId, expectedType);
  }

  async function chainQuote(common, action, wallet, grossAtomic) {
    if (!LIST_ACTIONS.has(action) && !PURCHASE_ACTIONS.has(action)) return null;
    return common.market.inspectQuoteOnChain(client, {
      registry: common.registry,
      treasury: common.treasury,
      root: common.root,
      wallet,
      quoteKind: quoteKind(action),
      grossAtomic,
    });
  }

  async function listingContext(common, listing, action, wallet) {
    const input = {
      registry: common.registry,
      treasury: common.treasury,
      listing,
      root: common.root,
      protocolConfig: common.protocolConfig,
      catalog: common.catalog,
      config: common.config,
      wallet,
      expectation: freeze({
        listingRevision: listing.fields.revision.toString(),
        registryRevision: common.registry.fields.revision.toString(),
        quoteCommitment: listing.fields.quoteCommitment,
      }),
    };
    const refs = [];
    if (listing.kind === 'MakerListingV8') {
      input.adminReceiving = await receiving(
        common,
        listing.fields.adminCapId,
        listing.objectId,
        common.market.types.makerAdmin,
      );
      refs.push(input.adminReceiving);
    } else if (listing.kind === 'SoulListingV8') {
      input.outputRegistry = await genericRootObject(common, 'outputRegistryId', 'outputRegistry', 'OutputRegistryV8');
      input.soulRegistry = await genericRootObject(common, 'soulRegistryId', 'soulRegistry', 'SoulRegistryV8');
      const custody = listing.fields.custody;
      [input.outputReceiving, input.receiptReceiving, input.soulReceiving] = await Promise.all([
        receiving(common, custody.outputId, listing.objectId, common.market.types.completeOutput),
        receiving(common, custody.receiptId, listing.objectId, common.market.types.completeReceipt),
        receiving(common, custody.soulId, listing.objectId, common.market.types.canonicalSoul),
      ]);
      refs.push(input.outputReceiving, input.receiptReceiving, input.soulReceiving);
      if (action === 'purchaseSoulBundle') input.makerTreasury = common.makerTreasury;
    } else {
      input.physicalRegistry = await genericRootObject(common, 'physicalRegistryId', 'physicalRegistry', 'PhysicalRegistryV8');
      input.physicalConfig = common.configs.physical;
      const custody = listing.fields.custody;
      input.receiving = await receiving(
        common,
        custody.assetId,
        listing.objectId,
        common.market.types.physicalAsset,
      );
      refs.push(input.receiving);
      if (action === 'purchaseBasePhysical') input.makerTreasury = common.makerTreasury;
      if (action === 'purchasePackPhysical') {
        [input.packRelease, input.packTreasury] = await Promise.all([
          getObject(client, custody.sourceId, common.market.types.packRelease, 'PackReleaseV8'),
          getObject(client, custody.sourceTreasuryId, common.market.types.packTreasury, 'PackTreasuryV8'),
        ]);
      }
    }
    if (PURCHASE_ACTIONS.has(action)) {
      input.protocolTreasury = await getObject(
        client,
        common.runtime.protocolTreasuryId,
        common.market.types.protocolTreasury,
        'ProtocolTreasuryV8',
      );
    }
    if (PURCHASE_ACTIONS.has(action)) {
      input.chainQuote = await chainQuote(
        common,
        action,
        wallet,
        listing.fields.grossAtomic.toString(),
      );
    }
    return freeze({ input, authorityRefs: refs });
  }

  async function listContext(common, action, wallet, request) {
    const inventory = await common.chain.inventory(wallet.address, common.root);
    const input = {
      registry: common.registry,
      treasury: common.treasury,
      root: common.root,
      protocolConfig: common.protocolConfig,
      catalog: common.catalog,
      config: common.config,
      wallet,
      expectedRegistryRevision: common.registry.fields.revision.toString(),
    };
    const refs = [];
    if (action === 'listMakerControl') {
      input.admin = inventory.adminCaps[0];
      input.makerTreasury = common.makerTreasury;
      if (!input.admin) fail('MAKER_V8_BROWSER_INVENTORY_EMPTY', 'Wallet has no exact Maker AdminCap for this Root.', 'CUSTODY');
      refs.push(input.admin);
    } else if (action === 'listSoulBundle') {
      const bundle = inventory.soulBundles[0];
      if (!bundle) fail('MAKER_V8_BROWSER_INVENTORY_EMPTY', 'Wallet has no exact Soul bundle for this Root.', 'CUSTODY');
      input.outputRegistry = await genericRootObject(common, 'outputRegistryId', 'outputRegistry', 'OutputRegistryV8');
      input.soulRegistry = await genericRootObject(common, 'soulRegistryId', 'soulRegistry', 'SoulRegistryV8');
      input.outputAsset = bundle.output;
      input.receipt = bundle.receipt;
      input.soul = bundle.soul;
      refs.push(bundle.output, bundle.receipt, bundle.soul);
    } else {
      const expectedSource = action === 'listBasePhysical' ? 0 : 1;
      input.asset = inventory.physicalAssets.find((asset) => asset.sourceKind === expectedSource);
      if (!input.asset) fail('MAKER_V8_BROWSER_INVENTORY_EMPTY', 'Wallet has no exact typed Physical asset for this lane.', 'CUSTODY');
      input.physicalRegistry = await genericRootObject(common, 'physicalRegistryId', 'physicalRegistry', 'PhysicalRegistryV8');
      input.physicalConfig = common.configs.physical;
      if (expectedSource === 0) input.makerTreasury = common.makerTreasury;
      else {
        input.packTreasury = await getObject(
          client,
          input.asset.sourceTreasuryId,
          common.market.types.packTreasury,
          'PackTreasuryV8',
        );
      }
      refs.push(input.asset);
    }
    const grossAtomic = decimal(request.grossAtomic ?? '1000000', 'grossAtomic');
    input.chainQuote = await chainQuote(common, action, wallet, grossAtomic);
    return freeze({ input, authorityRefs: refs });
  }

  return freeze({
    async resolveRoleLineages(requests) {
      if (!Array.isArray(requests)) {
        fail('MAKER_V8_BROWSER_LINEAGE_REQUEST_INVALID', 'Role lineage request must be an array.', 'VALIDATION');
      }
      const { runtime } = await ready();
      return freeze(Object.fromEntries(requests.map(({ role, callablePackageId }) => {
        if (!MAKER_V8_ROLES.includes(role)
          || runtime.roles[role].callablePackageId !== callablePackageId) {
          fail('MAKER_V8_BROWSER_LINEAGE_DRIFT', 'Callable package lineage differs from the attested Catalog.', 'CONTEXT');
        }
        return [role, runtime.roles[role].typeOriginPackageId];
      })));
    },

    async loadRoute(request) {
      await assertPinnedMainnet(client);
      let common;
      let listing = null;
      if (request.route.kind === 'listing') {
        listing = await loadListing(request.route.id);
        common = await commonContext(listingRootId(listing));
      } else if (request.route.kind === 'maker') {
        common = await commonContext(request.route.id);
      } else {
        fail('MAKER_V8_BROWSER_ROUTE_INVALID', 'Detailed route must name a Maker Root or typed listing.', 'VALIDATION');
      }
      return freeze({
        schemaVersion: WEB_V8_ROUTE_SCHEMA,
        source: 'LIVE_RPC',
        requestId: request.requestId,
        chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        route: routeIdentity(request.route),
        activation: freeze({
          eventType: common.activation.type,
          rootId: common.root.objectId,
          lifecycle: 'ACTIVE',
        }),
        view: freeze({
          title: listing ? `${listing.kind} ${listing.objectId.slice(0, 10)}` : common.root.makerKey,
          subtitle: listing ? `Typed Market custody for ${common.root.makerKey}` : 'Verified fresh-v8 Maker Root',
          lifecycle: common.root.lifecycle,
          listingKind: listing?.kind ?? null,
          listingStatus: listing ? Object.keys(MARKET_V8_LISTING_STATUS)
            .find((name) => MARKET_V8_LISTING_STATUS[name] === listing.fields.status) : null,
        }),
        availableActions: freeze(listing ? listingActions(listing) : rootActions(common.root)),
      });
    },

    async browseMarket(request) {
      await assertPinnedMainnet(client);
      const state = await ready();
      const activations = await state.chain.discover();
      const roots = await Promise.all(activations.map(async (activation) => {
        try {
          return (await state.chain.loadContext(activation)).root;
        } catch {
          return null;
        }
      }));
      const makers = roots.filter((root) => root?.lifecycle === 'ACTIVE').map((root) => {
        const activation = activations.find((entry) => entry.binding.rootId === root.objectId);
        return freeze({
          rootId: root.objectId,
          title: root.makerKey,
          eventType: activation.type,
          lifecycle: 'ACTIVE',
        });
      });
      const openedType = `${state.runtime.roles.market.typeOriginPackageId}::market_v8::MarketListingOpenedV8`;
      const opened = await allEventPages(client, openedType);
      const unique = new Map();
      for (const event of opened) {
        const parsed = state.market.parseEvent(event);
        if (!unique.has(parsed.fields.listingId)) unique.set(parsed.fields.listingId, parsed);
      }
      const listings = (await Promise.all([...unique.keys()].map(async (listingId) => {
        try {
          const listing = await loadListing(listingId);
          if (listing.fields.status !== MARKET_V8_LISTING_STATUS.OPEN) return null;
          return freeze({
            listingId,
            rootId: listingRootId(listing),
            title: `${listing.kind} ${listingId.slice(0, 10)}`,
            kind: listing.kind,
            status: 'OPEN',
            grossAtomic: listing.fields.grossAtomic.toString(),
            quoteCommitment: listing.fields.quoteCommitment,
          });
        } catch {
          return null;
        }
      }))).filter(Boolean);
      return freeze({
        schemaVersion: WEB_V8_BROWSE_SCHEMA,
        source: 'LIVE_RPC',
        requestId: request.requestId,
        chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        makers: freeze(makers),
        listings: freeze(listings),
      });
    },

    async loadActionContext(request) {
      await assertPinnedMainnet(client);
      const action = makerV8ActionV8(request.action);
      if (!action) fail('MAKER_V8_BROWSER_ACTION_INVALID', 'Unknown fresh-v8 Market action.', 'VALIDATION');
      const actionId = action.id;
      const wallet = freeze({
        address: id(request.account?.address, 'account.address'),
        network: MAKER_V8_CHAIN_NETWORK,
      });
      let common;
      let listing = null;
      if (request.route.kind === 'listing') {
        listing = await loadListing(request.route.id);
        common = await commonContext(listingRootId(listing));
      } else {
        common = await commonContext(request.route.id);
      }
      const selected = listing
        ? await listingContext(common, listing, actionId, wallet)
        : await listContext(common, actionId, wallet, request);
      const primary = listing ?? selected.authorityRefs[0];
      return freeze({
        schemaVersion: WEB_V8_CONTEXT_SCHEMA,
        source: 'LIVE_RPC',
        requestId: request.requestId,
        chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        route: routeIdentity(request.route),
        action: actionId,
        activation: freeze({
          eventType: common.activation.type,
          rootId: common.root.objectId,
          lifecycle: 'ACTIVE',
        }),
        packageTuple: common.packageTuple,
        builderInput: freeze({
          ...selected.input,
          rootContentCommitment: common.root.contentCommitment,
          protocolRevision: common.protocolConfig.revision.toString(),
        }),
        refs: freeze({
          primary: objectRef(primary, 'primary'),
          root: objectRef(common.root, 'root'),
          registry: objectRef(common.registry, 'registry'),
          treasury: objectRef(common.treasury, 'treasury'),
        }),
        authority: freeze({
          kind: `${action.lane}_${action.kind}`,
          refs: freeze(selected.authorityRefs.map((entry, index) => objectRef(entry, `authority[${index}]`))),
        }),
      });
    },

    async queryTransaction({ digest: transactionDigest }) {
      await assertPinnedMainnet(client);
      try {
        if (typeof client?.core?.getTransaction !== 'function') {
          fail('MAKER_V8_BROWSER_CORE_V2_REQUIRED', 'Core V2 getTransaction is required for transaction queries.', 'READBACK');
        }
        const result = await client.core.getTransaction({
          digest: transactionDigest,
          include: { effects: true },
        });
        const transaction = coreTransaction(result);
        if (transaction.digest !== transactionDigest
          || transaction.effects?.transactionDigest !== transactionDigest) {
          fail('MAKER_V8_BROWSER_FINALIZED_DRIFT', 'Core V2 query returned another transaction digest.', 'READBACK');
        }
        const succeeded = transaction.status?.success === true
          && transaction.effects?.status?.success === true
          && result.$kind === 'Transaction';
        const effectsFingerprint = await coreEffectsFingerprint(transaction.effects);
        return freeze({
          status: succeeded ? 'FINALIZED_SUCCESS' : 'FINALIZED_FAILURE',
          digest: transactionDigest,
          epoch: decimal(transaction.epoch, 'transaction.epoch'),
          effectsFingerprint,
          eventsDigest: transaction.effects.eventsDigest ?? null,
          error: succeeded ? null : freeze({
            message: String(
              transaction.effects?.status?.error?.message
              ?? transaction.status?.error?.message
              ?? 'Move execution failed.',
            ),
          }),
        });
      } catch (error) {
        if (/not found|could not find the referenced transaction|transaction.*does not exist/i.test(String(error?.message || ''))) {
          return freeze({
            status: 'NOT_FOUND', digest: null, epoch: null,
            effectsFingerprint: null, eventsDigest: null, error: null,
          });
        }
        throw error;
      }
    },

    async readbackMarketAction(request) {
      await assertPinnedMainnet(client);
      const state = await ready();
      return readFinalizedMakerV8EnvelopeV8({ client, market: state.market, request });
    },
  });
}

function walletCandidates(registry, selectedWalletId) {
  const candidates = registry.get().filter((wallet) => (
    wallet?.chains?.includes(SUI_MAINNET_CHAIN)
    && typeof wallet.features?.[StandardConnect]?.connect === 'function'
    && typeof wallet.features?.[StandardEvents]?.on === 'function'
    && typeof wallet.features?.[SuiSignTransaction]?.signTransaction === 'function'
  ));
  if (!selectedWalletId) return candidates;
  return candidates.filter((wallet) => wallet.id === selectedWalletId || wallet.name === selectedWalletId);
}

function mainnetAccount(accounts) {
  return (accounts || []).find((account) => (
    account?.chains?.includes(SUI_MAINNET_CHAIN)
    && account?.features?.includes(SuiSignTransaction)
  )) ?? null;
}

/** Wallet Standard connector with account and chain drift invalidation. */
export function createWalletStandardConnectorV8({
  registry,
  execution,
  client,
  walletId = null,
}) {
  const checkedExecution = executionConfig(execution);
  if (!registry || typeof registry.get !== 'function' || typeof registry.on !== 'function') {
    fail('MAKER_V8_BROWSER_WALLET_REGISTRY_INVALID', 'Wallet Standard registry is required.');
  }
  let activeWallet = null;
  let activeAccount = null;
  let revision = 0;
  let offWallet = null;
  const listeners = new Set();
  const notify = () => {
    const snapshot = freeze({
      revision,
      account: activeAccount ? {
        address: id(activeAccount.address, 'wallet.account.address'),
        network: MAKER_V8_CHAIN_NETWORK,
      } : null,
    });
    listeners.forEach((listener) => listener(snapshot));
  };
  const invalidate = (accounts = activeWallet?.accounts ?? []) => {
    revision += 1;
    activeAccount = mainnetAccount(accounts);
    notify();
  };
  const bind = (wallet, accounts = wallet.accounts) => {
    offWallet?.();
    activeWallet = wallet;
    activeAccount = mainnetAccount(accounts);
    offWallet = wallet.features[StandardEvents].on('change', (properties) => {
      if (properties.chains && !properties.chains.includes(SUI_MAINNET_CHAIN)) {
        invalidate([]);
        return;
      }
      invalidate(properties.accounts ?? activeWallet.accounts);
    });
    revision += 1;
    notify();
  };
  const select = () => {
    if (activeWallet && walletCandidates(registry, walletId).includes(activeWallet)) return activeWallet;
    const candidates = walletCandidates(registry, walletId);
    const wallet = candidates.find((entry) => mainnetAccount(entry.accounts)) ?? candidates[0];
    if (!wallet) fail('MAKER_V8_BROWSER_WALLET_UNAVAILABLE', 'No compatible Sui Wallet Standard wallet is registered.', 'WALLET');
    bind(wallet);
    return wallet;
  };
  const requireAccount = () => {
    const wallet = select();
    const account = activeAccount ?? mainnetAccount(wallet.accounts);
    if (!account) fail('MAKER_V8_BROWSER_WALLET_NOT_CONNECTED', 'Connect a Sui Mainnet wallet account first.', 'WALLET');
    if (!account.chains.includes(SUI_MAINNET_CHAIN)
      || !account.features.includes(SuiSignTransaction)) {
      fail('MAKER_V8_BROWSER_WALLET_NETWORK_DRIFT', 'Wallet account no longer authorizes Sui Mainnet signing.', 'CONTEXT');
    }
    activeAccount = account;
    return Object.freeze({ wallet, account, revision, address: id(account.address, 'wallet.account.address') });
  };
  const registryChanged = () => {
    if (activeWallet && !registry.get().includes(activeWallet)) {
      offWallet?.();
      activeWallet = null;
      activeAccount = null;
    }
    revision += 1;
    notify();
  };
  const offRegister = registry.on('register', registryChanged);
  const offUnregister = registry.on('unregister', registryChanged);

  return freeze({
    async getCurrentAccount() {
      const captured = requireAccount();
      return freeze({ address: captured.address, network: checkedExecution.network });
    },

    async reconnect() {
      const wallet = select();
      const result = await wallet.features[StandardConnect].connect();
      const account = mainnetAccount(result?.accounts ?? wallet.accounts);
      if (!account) {
        invalidate([]);
        fail('MAKER_V8_BROWSER_WALLET_NETWORK_DRIFT', 'Wallet did not authorize a Sui Mainnet account.', 'CONTEXT');
      }
      bind(wallet, result.accounts);
      return freeze({ address: id(account.address, 'wallet.account.address'), network: checkedExecution.network });
    },

    async signExactTransaction({ bytes, digest: expectedDigest, signer }) {
      if (!checkedExecution.allowWalletSignature) {
        fail('WEB_V8_SIGNING_DISABLED', 'Wallet signing is disabled by the pinned deployment gate.', 'SIGNING');
      }
      await assertPinnedMainnet(client);
      const captured = requireAccount();
      const expectedSigner = id(signer, 'signer');
      if (captured.address !== expectedSigner) {
        fail('MAKER_V8_BROWSER_ACCOUNT_DRIFT', 'Current wallet account differs from the prepared signer.', 'CONTEXT');
      }
      const raw = canonicalTransactionBytes(bytes);
      const actualDigest = TransactionDataBuilder.getDigestFromBytes(raw);
      if (actualDigest !== expectedDigest) {
        fail('MAKER_V8_BROWSER_DIGEST_DRIFT', 'Prepared digest does not match the exact TransactionData bytes.', 'CONTEXT');
      }
      const result = await captured.wallet.features[SuiSignTransaction].signTransaction({
        transaction: Transaction.from(raw),
        account: captured.account,
        chain: SUI_MAINNET_CHAIN,
      });
      await assertPinnedMainnet(client);
      const current = requireAccount();
      if (current.wallet !== captured.wallet || current.account !== captured.account
        || current.revision !== captured.revision || current.address !== captured.address) {
        fail('MAKER_V8_BROWSER_ACCOUNT_DRIFT', 'Wallet account changed while the signature prompt was open.', 'CONTEXT');
      }
      const returned = canonicalTransactionBytes(result?.bytes);
      if (toBase64(returned) !== toBase64(raw)) {
        fail('MAKER_V8_BROWSER_SIGNED_BYTES_DRIFT', 'Wallet returned different TransactionData bytes.', 'SIGNING');
      }
      const signature = result?.signature;
      if (typeof signature !== 'string' || !signature.length
        || !await isValidTransactionSignature(raw, signature, { client, address: captured.address })) {
        fail('MAKER_V8_BROWSER_SIGNATURE_INVALID', 'Wallet signature does not authenticate the exact bytes and signer.', 'SIGNING');
      }
      return freeze({
        bytes: toBase64(raw),
        signature,
        digest: actualDigest,
        signer: captured.address,
        signedAt: Date.now(),
      });
    },

    async verifyExactSignature({ bytes, signature, digest: expectedDigest, signer }) {
      const raw = canonicalTransactionBytes(bytes);
      const address = id(signer, 'signer');
      const actualDigest = TransactionDataBuilder.getDigestFromBytes(raw);
      const verified = actualDigest === expectedDigest
        && await isValidTransactionSignature(raw, signature, { client, address });
      return verified ? freeze({
        verified: true,
        bytes: toBase64(raw),
        digest: actualDigest,
        signer: address,
      }) : false;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') fail('MAKER_V8_BROWSER_LISTENER_INVALID', 'Wallet listener must be a function.');
      listeners.add(listener);
      notify();
      return () => listeners.delete(listener);
    },

    dispose() {
      offWallet?.();
      offRegister?.();
      offUnregister?.();
      listeners.clear();
    },
  });
}

function canonicalTransactionBytes(value) {
  if (typeof value !== 'string' || value.length < 8) {
    fail('MAKER_V8_BROWSER_TRANSACTION_BYTES_INVALID', 'TransactionData bytes must be canonical base64.', 'VALIDATION');
  }
  let raw;
  try {
    raw = fromBase64(value);
    if (toBase64(raw) !== value) throw new Error('non-canonical');
    TransactionDataBuilder.fromBytes(raw);
  } catch {
    fail('MAKER_V8_BROWSER_TRANSACTION_BYTES_INVALID', 'TransactionData bytes must be canonical base64.', 'VALIDATION');
  }
  return raw;
}

function transactionFromDescriptor(descriptor) {
  if (!plain(descriptor) || descriptor.schema !== 'animacraft.market-action.v8'
    || makerV8ActionV8(descriptor.action)?.id !== descriptor.action
    || descriptor.network !== MAKER_V8_CHAIN_NETWORK
    || typeof descriptor.target !== 'string' || !Array.isArray(descriptor.arguments)
    || !Array.isArray(descriptor.typeArguments)) {
    fail('MAKER_V8_BROWSER_DESCRIPTOR_INVALID', 'Transaction descriptor is not an exact fresh-v8 Market action.', 'VALIDATION');
  }
  const transaction = new Transaction();
  transaction.setSender(id(descriptor.sender, 'descriptor.sender'));
  const args = descriptor.arguments.map((argument, index) => {
    if (!plain(argument)) fail('MAKER_V8_BROWSER_DESCRIPTOR_INVALID', `Argument ${index} is invalid.`, 'VALIDATION');
    if (argument.kind === 'u64') return transaction.pure.u64(BigInt(decimal(argument.value, `argument[${index}].value`)));
    if (argument.kind === 'receiving') {
      return transaction.receivingRef({
        objectId: id(argument.objectId, `argument[${index}].objectId`),
        version: decimal(argument.version, `argument[${index}].version`),
        digest: digest(argument.digest, `argument[${index}].digest`),
      });
    }
    if (argument.kind === 'payment') {
      return transaction.coin({
        type: normalizeStructTag(argument.type),
        balance: BigInt(decimal(argument.balanceAtomic, `argument[${index}].balanceAtomic`)),
      });
    }
    if (argument.kind === 'object') return transaction.object(id(argument.objectId, `argument[${index}].objectId`));
    fail('MAKER_V8_BROWSER_DESCRIPTOR_INVALID', `Argument ${index} has an unknown kind.`, 'VALIDATION');
  });
  const [targetPackage, targetModule, targetFunction] = descriptor.target.split('::');
  id(targetPackage, 'descriptor.target.package');
  if (!/^[a-z_][a-z0-9_]*$/.test(targetModule)
    || !/^[a-z_][a-z0-9_]*$/.test(targetFunction)) {
    fail('MAKER_V8_BROWSER_DESCRIPTOR_INVALID', 'Descriptor target is not a canonical Move target.', 'VALIDATION');
  }
  transaction.moveCall({
    target: descriptor.target,
    typeArguments: descriptor.typeArguments.map((type) => normalizeStructTag(type)),
    arguments: args,
  });
  return transaction;
}

async function currentEpoch(client) {
  if (typeof client?.core?.getCurrentSystemState === 'function') {
    return decimal((await client.core.getCurrentSystemState())?.systemState?.epoch, 'currentEpoch');
  }
  if (typeof client?.getCurrentEpoch === 'function') {
    return decimal((await client.getCurrentEpoch())?.epoch, 'currentEpoch');
  }
  if (typeof client?.getLatestSuiSystemState === 'function') {
    return decimal((await client.getLatestSuiSystemState())?.epoch, 'currentEpoch');
  }
  fail('MAKER_V8_BROWSER_EPOCH_UNAVAILABLE', 'Current Sui epoch is required for bounded expiration.', 'CONTEXT');
}

function jsonGasData(snapshot) {
  return freeze({
    budget: decimal(snapshot.gasData?.budget, 'gas.budget'),
    price: decimal(snapshot.gasData?.price, 'gas.price'),
    owner: id(snapshot.gasData?.owner, 'gas.owner'),
    payment: freeze((snapshot.gasData?.payment || []).map((entry, index) => freeze({
      objectId: id(entry.objectId, `gas.payment[${index}].objectId`),
      version: decimal(entry.version, `gas.payment[${index}].version`),
      digest: digest(entry.digest, `gas.payment[${index}].digest`),
    }))),
  });
}

function assertBuiltDescriptor(snapshot, descriptor) {
  if (snapshot.sender !== descriptor.sender) {
    fail('MAKER_V8_BROWSER_TRANSACTION_DRIFT', 'Built sender differs from the reviewed descriptor.', 'CONTEXT');
  }
  const [pkg, module, fn] = descriptor.target.split('::');
  const calls = snapshot.commands.filter((command) => command.MoveCall
    && command.MoveCall.package === pkg
    && command.MoveCall.module === module
    && command.MoveCall.function === fn);
  if (calls.length !== 1) {
    fail('MAKER_V8_BROWSER_TRANSACTION_DRIFT', 'Built transaction does not contain the exact reviewed Market call.', 'CONTEXT');
  }
}

/** Canonical SDK build/digest/dry-run/broadcast boundaries. */
export function createMakerV8TransactionAdaptersV8({ client, execution, wallet }) {
  const checkedExecution = executionConfig(execution);
  const builtBytes = new Map();
  return freeze({
    async buildExactTransaction({ descriptor }) {
      await assertPinnedMainnet(client);
      const start = BigInt(await currentEpoch(client));
      const transaction = transactionFromDescriptor(descriptor);
      transaction.setExpiration({ Epoch: (start + 1n).toString() });
      const raw = await transaction.build({ client });
      await assertPinnedMainnet(client);
      const bytes = toBase64(raw);
      const snapshot = TransactionDataBuilder.fromBytes(raw).snapshot();
      assertBuiltDescriptor(snapshot, descriptor);
      const transactionDigest = TransactionDataBuilder.getDigestFromBytes(raw);
      builtBytes.set(bytes, freeze({ descriptor, transactionDigest }));
      while (builtBytes.size > 32) builtBytes.delete(builtBytes.keys().next().value);
      return freeze({
        transactionBytes: bytes,
        transactionDigest,
        epochWindow: freeze({ start: start.toString(), end: (start + 1n).toString() }),
        gas: jsonGasData(snapshot),
        sourceSnapshot: freeze({
          schema: MAKER_V8_BROWSER_SCHEMA,
          action: descriptor.action,
          target: descriptor.target,
          rootId: descriptor.rootId,
          registryId: descriptor.registryId,
          treasuryId: descriptor.treasuryId,
          protocolRevision: descriptor.protocolRevision,
          preState: descriptor.preState,
        }),
      });
    },

    deriveTransactionDigest(bytes) {
      return TransactionDataBuilder.getDigestFromBytes(canonicalTransactionBytes(bytes));
    },

    async dryRunExactTransaction({ transactionBytes, descriptor }) {
      await assertPinnedMainnet(client);
      const raw = canonicalTransactionBytes(transactionBytes);
      const registered = builtBytes.get(transactionBytes);
      if (!registered || registered.descriptor !== descriptor
        || registered.transactionDigest !== TransactionDataBuilder.getDigestFromBytes(raw)) {
        fail('MAKER_V8_BROWSER_BUILD_PROOF_REQUIRED', 'Dry-run accepts only freshly built canonical bytes.', 'DRY_RUN');
      }
      assertBuiltDescriptor(TransactionDataBuilder.fromBytes(raw).snapshot(), descriptor);
      const result = await client.dryRunTransactionBlock({ transactionBlock: transactionBytes });
      await assertPinnedMainnet(client);
      const status = result?.effects?.status?.status ?? result?.effects?.status;
      if (status !== 'success' && status !== 'SUCCESS') {
        return freeze({ status: 'FAILURE', error: result?.effects?.status?.error ?? result?.error ?? null });
      }
      return freeze({ status: 'SUCCESS' });
    },

    async broadcastExactTransaction({ bytes, signature, digest: expectedDigest, signer }) {
      if (!checkedExecution.allowBroadcast) {
        fail('WEB_V8_BROADCAST_DISABLED', 'Broadcast is disabled by the pinned deployment gate.', 'BROADCAST');
      }
      await assertPinnedMainnet(client);
      const account = await wallet.getCurrentAccount();
      if (account.address !== id(signer, 'signer') || account.network !== MAKER_V8_CHAIN_NETWORK) {
        fail('MAKER_V8_BROWSER_ACCOUNT_DRIFT', 'Current wallet account differs from the durable signer.', 'CONTEXT');
      }
      const raw = canonicalTransactionBytes(bytes);
      if (TransactionDataBuilder.getDigestFromBytes(raw) !== expectedDigest) {
        fail('MAKER_V8_BROWSER_DIGEST_DRIFT', 'Broadcast bytes differ from the durable digest.', 'CONTEXT');
      }
      if (!await isValidTransactionSignature(raw, signature, { client, address: account.address })) {
        fail('MAKER_V8_BROWSER_SIGNATURE_INVALID', 'Broadcast signature does not authenticate the exact durable bytes.', 'BROADCAST');
      }
      const result = await client.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: { showEffects: true, showEvents: true, showObjectChanges: true },
      });
      await assertPinnedMainnet(client);
      if (result?.digest !== expectedDigest) {
        fail('MAKER_V8_BROWSER_BROADCAST_DIGEST_DRIFT', 'RPC accepted a different transaction digest.', 'BROADCAST');
      }
      return freeze({ digest: expectedDigest, accepted: true });
    },
  });
}

/**
 * Production factory. The default path creates its own official Mainnet
 * client, live reader, and Wallet Standard connector; no adapter global is
 * consulted or required.
 */
export function createProductionMakerV8BrowserAdapters({
  runtime,
  execution,
  client = new SuiJsonRpcClient({
    url: MAKER_V8_OFFICIAL_MAINNET_RPC_URL,
    network: MAKER_V8_CHAIN_NETWORK,
  }),
  walletRegistry = getWallets(),
  walletId = null,
  dataSource = null,
  persistence = null,
} = {}) {
  const checkedExecution = executionConfig(execution);
  const reader = dataSource || createMakerV8LiveDataSourceV8({ client, runtime });
  for (const method of [
    'resolveRoleLineages', 'loadRoute', 'browseMarket', 'loadActionContext',
    'queryTransaction', 'readbackMarketAction',
  ]) requireMethod(reader, method, 'dataSource');
  const wallet = createWalletStandardConnectorV8({
    registry: walletRegistry,
    execution: checkedExecution,
    client,
    walletId,
  });
  const transactions = createMakerV8TransactionAdaptersV8({
    client,
    execution: checkedExecution,
    wallet,
  });
  return freeze({
    rpc: freeze({
      async getChainIdentifier() {
        await assertPinnedMainnet(client);
        return MAKER_V8_MAINNET_CHAIN_IDENTIFIER;
      },
      async getSuiClient() {
        await assertPinnedMainnet(client);
        return client;
      },
      resolveRoleLineages: (requests) => reader.resolveRoleLineages(requests),
      loadRoute: (request) => reader.loadRoute(request),
      browseMarket: (request) => reader.browseMarket(request),
      loadActionContext: (request) => reader.loadActionContext(request),
      queryTransaction: (request) => reader.queryTransaction(request),
      readbackMarketAction: (request) => reader.readbackMarketAction(request),
    }),
    wallet,
    transactions,
    ...(persistence ? { persistence } : {}),
  });
}
