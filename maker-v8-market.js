import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import {
  fromBase58,
  isValidStructTag,
  normalizeStructTag,
  normalizeSuiAddress,
  normalizeSuiObjectId,
} from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

export const MARKET_V8_VERSION = 8n;
export const MARKET_V8_ACTION_SCHEMA = 'animacraft.market-action.v8';
export const MARKET_V8_QUOTE_DOMAIN = 'animacraft-v8/market/quote';

export const MARKET_V8_QUOTE_KINDS = Object.freeze({
  MAKER_RESALE: 0,
  SOUL_RESALE: 1,
  PHYSICAL_RESALE: 2,
});

export const MARKET_V8_LISTING_STATUS = Object.freeze({
  OPEN: 0,
  SETTLED: 1,
  CANCELED: 2,
  RECOVERED: 3,
});

export const MARKET_V8_LANES = Object.freeze({
  MAKER: 0,
  SOUL: 1,
  PHYSICAL_BASE: 2,
  PHYSICAL_PACK: 3,
});

export const MARKET_V8_PHYSICAL_SOURCES = Object.freeze({
  BASE: 0,
  PACK: 1,
});

export const MARKET_V8_LIFECYCLES = Object.freeze({
  DRAFT: 0,
  ACTIVE: 1,
  PAUSED: 2,
  ARCHIVED: 3,
});

const U128_MAX = (1n << 128n) - 1n;
const BPS_DENOMINATOR = 10_000n;
const ZERO_ADDRESS = `0x${'0'.repeat(64)}`;
const EXACT_PACKAGE_ID = /^0x[0-9a-f]{64}$/;
const HEX_BYTES = /^0x(?:[0-9a-f]{2})*$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const UTF8 = new TextEncoder();
const PARSED = Symbol('market-v8-parsed');

const RUNTIME_KEYS = Object.freeze([
  'callablePackageId',
  'paymentCoinType',
  'typeOrigins',
]);
const ORIGIN_KEYS = Object.freeze([
  'corePackageId',
  'marketPackageId',
  'outputPackageId',
  'physicalPackageId',
  'runtimePackageId',
]);
const MARKET_V8_NETWORK = 'mainnet';

function freezeRecord(value) {
  return Object.freeze(value);
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(ErrorType, code, field, message, details) {
  throw new ErrorType(code, field, message, details);
}

export class MarketV8Error extends Error {
  constructor(code, field, message, details = undefined) {
    super(message);
    this.name = 'MarketV8Error';
    this.code = code;
    this.field = field;
    if (details !== undefined) this.details = details;
  }
}

export class MarketV8RuntimeError extends MarketV8Error {
  constructor(code, field, message, details) {
    super(code, field, message, details);
    this.name = 'MarketV8RuntimeError';
  }
}

export class MarketV8ParseError extends MarketV8Error {
  constructor(code, field, message, details) {
    super(code, field, message, details);
    this.name = 'MarketV8ParseError';
  }
}

export class MarketV8EligibilityError extends MarketV8Error {
  constructor(code, field, message, details) {
    super(code, field, message, details);
    this.name = 'MarketV8EligibilityError';
  }
}

export class MarketV8BuildError extends MarketV8Error {
  constructor(code, field, message, details) {
    super(code, field, message, details);
    this.name = 'MarketV8BuildError';
  }
}

function assertExactKeys(value, keys, field, ErrorType = MarketV8ParseError) {
  if (!plainRecord(value)) {
    fail(ErrorType, 'MARKET_V8_RECORD_INVALID', field, `${field} must be a plain record.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      ErrorType,
      'MARKET_V8_FIELDS_INVALID',
      field,
      `${field} must contain exactly: ${expected.join(', ')}.`,
      { actual, expected },
    );
  }
}

function exactPackageId(value, field) {
  if (typeof value !== 'string' || !EXACT_PACKAGE_ID.test(value) || value === ZERO_ADDRESS) {
    fail(
      MarketV8RuntimeError,
      'MARKET_V8_PACKAGE_ID_INVALID',
      field,
      `${field} must be an exact lowercase non-zero 32-byte package ID.`,
    );
  }
  return value;
}

function canonicalStructType(value, field, ErrorType = MarketV8RuntimeError) {
  if (typeof value !== 'string' || value.trim() !== value || /\s/.test(value)) {
    fail(ErrorType, 'MARKET_V8_TYPE_INVALID', field, `${field} must be an exact Move struct type.`);
  }
  try {
    if (!isValidStructTag(value)) throw new TypeError('invalid struct tag');
    return normalizeStructTag(value);
  } catch {
    fail(ErrorType, 'MARKET_V8_TYPE_INVALID', field, `${field} must be an exact Move struct type.`);
  }
}

export function assertMarketV8Runtime(runtime) {
  assertExactKeys(runtime, RUNTIME_KEYS, 'runtime', MarketV8RuntimeError);
  assertExactKeys(runtime.typeOrigins, ORIGIN_KEYS, 'runtime.typeOrigins', MarketV8RuntimeError);
  const origins = freezeRecord(Object.fromEntries(ORIGIN_KEYS.map((key) => [
    key,
    exactPackageId(runtime.typeOrigins[key], `runtime.typeOrigins.${key}`),
  ])));
  return freezeRecord({
    callablePackageId: exactPackageId(runtime.callablePackageId, 'runtime.callablePackageId'),
    paymentCoinType: canonicalStructType(runtime.paymentCoinType, 'runtime.paymentCoinType'),
    typeOrigins: origins,
  });
}

function networkName(value, field, ErrorType = MarketV8BuildError) {
  if (value !== MARKET_V8_NETWORK) {
    fail(ErrorType, 'MARKET_V8_NETWORK_INVALID', field, `${field} must be exactly mainnet.`);
  }
  return value;
}

export function assertMarketV8WalletContext(runtimeInput, wallet, expectedNetwork = MARKET_V8_NETWORK) {
  assertMarketV8Runtime(runtimeInput);
  const sessionNetwork = networkName(expectedNetwork, 'session.network');
  assertExactKeys(wallet, ['address', 'network'], 'wallet', MarketV8BuildError);
  const network = networkName(wallet.network, 'wallet.network');
  if (network !== sessionNetwork) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_WALLET_NETWORK_MISMATCH',
      'wallet.network',
      'Connected wallet network does not match the pinned Market runtime.',
      { actual: network, expected: sessionNetwork },
    );
  }
  return freezeRecord({ network, address: buildAddress(wallet.address, 'wallet.address') });
}

function originType(packageId, moduleName, typeName, typeArguments = []) {
  const suffix = typeArguments.length ? `<${typeArguments.join(',')}>` : '';
  return `${packageId}::${moduleName}::${typeName}${suffix}`;
}

export function marketV8Types(runtimeInput) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const { typeOrigins: origin, paymentCoinType: coin } = runtime;
  return freezeRecord({
    marketRegistry: originType(origin.marketPackageId, 'market_v8', 'MarketRegistryV8', [coin]),
    marketTreasury: originType(origin.marketPackageId, 'market_v8', 'MarketTreasuryV8', [coin]),
    marketConfig: originType(origin.marketPackageId, 'market_v8', 'MarketPackageConfigV8'),
    makerListing: originType(origin.marketPackageId, 'market_v8', 'MakerListingV8', [coin]),
    soulListing: originType(origin.marketPackageId, 'market_v8', 'SoulListingV8', [coin]),
    physicalListing: originType(origin.marketPackageId, 'market_v8', 'PhysicalListingV8', [coin]),
    makerRoot: originType(origin.corePackageId, 'maker_v8', 'MakerRootV8', [coin]),
    makerAdmin: originType(origin.corePackageId, 'maker_v8', 'MakerAdminCapV8'),
    makerTreasury: originType(origin.corePackageId, 'treasury_v8', 'MakerTreasuryV8', [coin]),
    protocolConfig: originType(origin.corePackageId, 'protocol_config_v8', 'ProtocolConfigV8'),
    protocolTreasury: originType(origin.corePackageId, 'protocol_config_v8', 'ProtocolTreasuryV8', [coin]),
    catalog: originType(origin.corePackageId, 'package_binding_v8', 'ProductReleaseCatalogV8'),
    outputRegistry: originType(origin.outputPackageId, 'output_v8', 'OutputRegistryV8'),
    soulRegistry: originType(origin.outputPackageId, 'output_v8', 'SoulRegistryV8'),
    completeOutput: originType(origin.outputPackageId, 'output_v8', 'CompleteOutputV8'),
    completeReceipt: originType(origin.outputPackageId, 'output_v8', 'CompleteReceiptV8'),
    canonicalSoul: originType(origin.outputPackageId, 'output_v8', 'CanonicalSoulV8'),
    physicalRegistry: originType(origin.physicalPackageId, 'physical_v8', 'PhysicalRegistryV8'),
    physicalConfig: originType(origin.physicalPackageId, 'physical_v8', 'PhysicalPackageConfigV8'),
    physicalAsset: originType(origin.physicalPackageId, 'physical_v8', 'PhysicalAssetV8'),
    packRelease: originType(origin.runtimePackageId, 'runtime_v8', 'PackReleaseV8', [coin]),
    packTreasury: originType(origin.runtimePackageId, 'runtime_v8', 'PackTreasuryV8', [coin]),
    paymentCoin: originType(normalizeSuiAddress('0x2'), 'coin', 'Coin', [coin]),
  });
}

function objectId(value, field, { allowZero = false } = {}) {
  let candidate = value;
  if (plainRecord(candidate) && hasOwn(candidate, 'bytes')) candidate = candidate.bytes;
  if (plainRecord(candidate) && hasOwn(candidate, 'id')) candidate = candidate.id;
  if (typeof candidate !== 'string') {
    fail(MarketV8ParseError, 'MARKET_V8_OBJECT_ID_INVALID', field, `${field} must be a Sui ID.`);
  }
  try {
    const normalized = normalizeSuiObjectId(candidate);
    if (!allowZero && normalized === ZERO_ADDRESS) throw new TypeError('zero');
    return normalized;
  } catch {
    fail(MarketV8ParseError, 'MARKET_V8_OBJECT_ID_INVALID', field, `${field} must be a Sui ID.`);
  }
}

function address(value, field, { allowZero = true } = {}) {
  if (typeof value !== 'string') {
    fail(MarketV8ParseError, 'MARKET_V8_ADDRESS_INVALID', field, `${field} must be a Sui address.`);
  }
  try {
    const normalized = normalizeSuiAddress(value);
    if (!allowZero && normalized === ZERO_ADDRESS) throw new TypeError('zero');
    return normalized;
  } catch {
    fail(MarketV8ParseError, 'MARKET_V8_ADDRESS_INVALID', field, `${field} must be a Sui address.`);
  }
}

function uint(value, bits, field, ErrorType = MarketV8ParseError) {
  if ((typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) && typeof value !== 'bigint') {
    fail(
      ErrorType,
      'MARKET_V8_INTEGER_INVALID',
      field,
      `${field} must be a canonical decimal string or bigint; Number values are forbidden.`,
    );
  }
  const parsed = typeof value === 'bigint' ? value : BigInt(value);
  const max = bits === 128 ? U128_MAX : ((1n << BigInt(bits)) - 1n);
  if (parsed < 0n || parsed > max) {
    fail(ErrorType, 'MARKET_V8_INTEGER_RANGE', field, `${field} exceeds u${bits}.`);
  }
  return parsed;
}

function enumUint(value, bits, field, ErrorType = MarketV8ParseError) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > (2 ** bits) - 1) {
      fail(ErrorType, 'MARKET_V8_INTEGER_RANGE', field, `${field} exceeds u${bits}.`);
    }
    return BigInt(value);
  }
  return uint(value, bits, field, ErrorType);
}

function bool(value, field) {
  if (typeof value !== 'boolean') {
    fail(MarketV8ParseError, 'MARKET_V8_BOOL_INVALID', field, `${field} must be boolean.`);
  }
  return value;
}

function bytes(value, field, { length } = {}) {
  let parsed;
  if (value instanceof Uint8Array) {
    parsed = new Uint8Array(value);
  } else if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    parsed = Uint8Array.from(value);
  } else if (typeof value === 'string' && HEX_BYTES.test(value)) {
    parsed = Uint8Array.from(value.slice(2).match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) || []);
  } else {
    fail(MarketV8ParseError, 'MARKET_V8_BYTES_INVALID', field, `${field} must be bytes.`);
  }
  if (length !== undefined && parsed.length !== length) {
    fail(MarketV8ParseError, 'MARKET_V8_BYTES_LENGTH', field, `${field} must contain ${length} bytes.`);
  }
  return `0x${[...parsed].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}

function commitment(value, field) {
  return bytes(value, field, { length: 32 });
}

function expectFields(value, keys, field) {
  assertExactKeys(value, keys, field, MarketV8ParseError);
  return value;
}

function unwrapMoveObject(input, expectedType, kind) {
  let data = input;
  if (plainRecord(data) && hasOwn(data, 'data')) {
    if (data.error) {
      fail(MarketV8ParseError, 'MARKET_V8_OBJECT_RESPONSE_ERROR', kind, `${kind} response contains an error.`);
    }
    data = data.data;
  }
  if (!plainRecord(data)) {
    fail(MarketV8ParseError, 'MARKET_V8_OBJECT_INVALID', kind, `${kind} must be a Sui Move object response.`);
  }
  const content = data.content;
  if (!plainRecord(content) || content.dataType !== 'moveObject' || !plainRecord(content.fields)) {
    fail(MarketV8ParseError, 'MARKET_V8_OBJECT_CONTENT_INVALID', kind, `${kind} must include parsed Move object content.`);
  }
  const actualType = canonicalStructType(content.type || data.type, `${kind}.type`, MarketV8ParseError);
  const canonicalExpected = normalizeStructTag(expectedType);
  if (actualType !== canonicalExpected) {
    fail(
      MarketV8ParseError,
      'MARKET_V8_TYPE_ORIGIN_MISMATCH',
      `${kind}.type`,
      `${kind} has the wrong TypeOrigin or type arguments.`,
      { actual: actualType, expected: canonicalExpected },
    );
  }
  const id = objectId(data.objectId ?? content.fields.id, `${kind}.objectId`);
  const fieldId = objectId(content.fields.id, `${kind}.fields.id`);
  if (id !== fieldId) {
    fail(MarketV8ParseError, 'MARKET_V8_OBJECT_ID_MISMATCH', `${kind}.fields.id`, `${kind} UID does not match objectId.`);
  }
  const version = data.version === undefined ? null : uint(data.version, 64, `${kind}.objectVersion`);
  const digest = data.digest === undefined ? null : digestValue(data.digest, `${kind}.digest`, MarketV8ParseError);
  return { data, content, fields: content.fields, objectId: id, type: actualType, objectVersion: version, digest };
}

function parsedObject(kind, base, fields, network) {
  return Object.freeze({
    [PARSED]: true,
    kind,
    network,
    objectId: base.objectId,
    type: base.type,
    objectVersion: base.objectVersion,
    digest: base.digest,
    fields: freezeRecord(fields),
  });
}

function digestValue(value, field, ErrorType = MarketV8BuildError) {
  if (typeof value !== 'string' || !BASE58.test(value)) {
    fail(ErrorType, 'MARKET_V8_DIGEST_INVALID', field, `${field} must be a base58 Sui digest.`);
  }
  try {
    if (fromBase58(value).length !== 32) throw new TypeError('length');
  } catch {
    fail(ErrorType, 'MARKET_V8_DIGEST_INVALID', field, `${field} must encode exactly 32 bytes.`);
  }
  return value;
}

const REGISTRY_FIELDS = Object.freeze([
  'id', 'version', 'catalog_id', 'package_config_id', 'product_binding_commitment',
  'call_cap_set_commitment', 'root_id', 'maker_version', 'root_content_commitment',
  'protocol_config_id', 'protocol_config_revision', 'protocol_config_commitment',
  'economics_commitment', 'rights_commitment', 'maker_market_fee_bps',
  'soul_market_fee_bps', 'soul_creator_royalty_bps', 'maker_source_royalty_bps',
  'maker_resale_royalty_bps', 'treasury_id', 'sealed', 'revision', 'listing_count',
  'escrow_count', 'completed_sale_count', 'canceled_sale_count', 'recovered_sale_count',
  'gross_volume_atomic', 'protocol_paid_atomic', 'creator_paid_atomic',
  'source_paid_atomic', 'seller_paid_atomic', 'zero_state_commitment',
]);

export function parseMarketRegistryV8(input, runtime, networkInput) {
  const network = networkName(networkInput, 'network', MarketV8ParseError);
  assertMarketV8Runtime(runtime);
  const base = unwrapMoveObject(input, marketV8Types(runtime).marketRegistry, 'MarketRegistryV8');
  const f = expectFields(base.fields, REGISTRY_FIELDS, 'MarketRegistryV8.fields');
  const fields = {
    version: uint(f.version, 64, 'MarketRegistryV8.version'),
    catalogId: objectId(f.catalog_id, 'MarketRegistryV8.catalog_id'),
    packageConfigId: objectId(f.package_config_id, 'MarketRegistryV8.package_config_id'),
    productBindingCommitment: commitment(f.product_binding_commitment, 'MarketRegistryV8.product_binding_commitment'),
    callCapSetCommitment: commitment(f.call_cap_set_commitment, 'MarketRegistryV8.call_cap_set_commitment'),
    rootId: objectId(f.root_id, 'MarketRegistryV8.root_id'),
    makerVersion: uint(f.maker_version, 64, 'MarketRegistryV8.maker_version'),
    rootContentCommitment: commitment(f.root_content_commitment, 'MarketRegistryV8.root_content_commitment'),
    protocolConfigId: objectId(f.protocol_config_id, 'MarketRegistryV8.protocol_config_id'),
    protocolConfigRevision: uint(f.protocol_config_revision, 64, 'MarketRegistryV8.protocol_config_revision'),
    protocolConfigCommitment: commitment(f.protocol_config_commitment, 'MarketRegistryV8.protocol_config_commitment'),
    economicsCommitment: commitment(f.economics_commitment, 'MarketRegistryV8.economics_commitment'),
    rightsCommitment: commitment(f.rights_commitment, 'MarketRegistryV8.rights_commitment'),
    makerMarketFeeBps: uint(f.maker_market_fee_bps, 16, 'MarketRegistryV8.maker_market_fee_bps'),
    soulMarketFeeBps: uint(f.soul_market_fee_bps, 16, 'MarketRegistryV8.soul_market_fee_bps'),
    soulCreatorRoyaltyBps: uint(f.soul_creator_royalty_bps, 16, 'MarketRegistryV8.soul_creator_royalty_bps'),
    makerSourceRoyaltyBps: uint(f.maker_source_royalty_bps, 16, 'MarketRegistryV8.maker_source_royalty_bps'),
    makerResaleRoyaltyBps: uint(f.maker_resale_royalty_bps, 16, 'MarketRegistryV8.maker_resale_royalty_bps'),
    treasuryId: objectId(f.treasury_id, 'MarketRegistryV8.treasury_id'),
    sealed: bool(f.sealed, 'MarketRegistryV8.sealed'),
    revision: uint(f.revision, 64, 'MarketRegistryV8.revision'),
    listingCount: uint(f.listing_count, 64, 'MarketRegistryV8.listing_count'),
    escrowCount: uint(f.escrow_count, 64, 'MarketRegistryV8.escrow_count'),
    completedSaleCount: uint(f.completed_sale_count, 64, 'MarketRegistryV8.completed_sale_count'),
    canceledSaleCount: uint(f.canceled_sale_count, 64, 'MarketRegistryV8.canceled_sale_count'),
    recoveredSaleCount: uint(f.recovered_sale_count, 64, 'MarketRegistryV8.recovered_sale_count'),
    grossVolumeAtomic: uint(f.gross_volume_atomic, 128, 'MarketRegistryV8.gross_volume_atomic'),
    protocolPaidAtomic: uint(f.protocol_paid_atomic, 128, 'MarketRegistryV8.protocol_paid_atomic'),
    creatorPaidAtomic: uint(f.creator_paid_atomic, 128, 'MarketRegistryV8.creator_paid_atomic'),
    sourcePaidAtomic: uint(f.source_paid_atomic, 128, 'MarketRegistryV8.source_paid_atomic'),
    sellerPaidAtomic: uint(f.seller_paid_atomic, 128, 'MarketRegistryV8.seller_paid_atomic'),
    zeroStateCommitment: commitment(f.zero_state_commitment, 'MarketRegistryV8.zero_state_commitment'),
  };
  if (fields.version !== MARKET_V8_VERSION) {
    fail(MarketV8ParseError, 'MARKET_V8_VERSION_MISMATCH', 'MarketRegistryV8.version', 'Market registry version must be 8.');
  }
  for (const [name, value] of Object.entries(fields).filter(([name]) => name.endsWith('Bps'))) {
    if (value > BPS_DENOMINATOR) {
      fail(MarketV8ParseError, 'MARKET_V8_BPS_INVALID', `MarketRegistryV8.${name}`, 'Basis points cannot exceed 10,000.');
    }
  }
  return parsedObject('MarketRegistryV8', base, fields, network);
}

const TREASURY_FIELDS = Object.freeze([
  'id', 'version', 'catalog_id', 'package_config_id', 'root_id', 'maker_version',
  'root_content_commitment', 'escrow', 'gross_escrowed_atomic', 'gross_released_atomic',
]);

export function parseMarketTreasuryV8(input, runtime, networkInput) {
  const network = networkName(networkInput, 'network', MarketV8ParseError);
  assertMarketV8Runtime(runtime);
  const base = unwrapMoveObject(input, marketV8Types(runtime).marketTreasury, 'MarketTreasuryV8');
  const f = expectFields(base.fields, TREASURY_FIELDS, 'MarketTreasuryV8.fields');
  if (!plainRecord(f.escrow) || !hasOwn(f.escrow, 'value')) {
    fail(MarketV8ParseError, 'MARKET_V8_BALANCE_INVALID', 'MarketTreasuryV8.escrow', 'Escrow must contain a Balance value.');
  }
  const fields = {
    version: uint(f.version, 64, 'MarketTreasuryV8.version'),
    catalogId: objectId(f.catalog_id, 'MarketTreasuryV8.catalog_id'),
    packageConfigId: objectId(f.package_config_id, 'MarketTreasuryV8.package_config_id'),
    rootId: objectId(f.root_id, 'MarketTreasuryV8.root_id'),
    makerVersion: uint(f.maker_version, 64, 'MarketTreasuryV8.maker_version'),
    rootContentCommitment: commitment(f.root_content_commitment, 'MarketTreasuryV8.root_content_commitment'),
    escrowAtomic: uint(f.escrow.value, 64, 'MarketTreasuryV8.escrow.value'),
    grossEscrowedAtomic: uint(f.gross_escrowed_atomic, 128, 'MarketTreasuryV8.gross_escrowed_atomic'),
    grossReleasedAtomic: uint(f.gross_released_atomic, 128, 'MarketTreasuryV8.gross_released_atomic'),
  };
  if (fields.version !== MARKET_V8_VERSION) {
    fail(MarketV8ParseError, 'MARKET_V8_VERSION_MISMATCH', 'MarketTreasuryV8.version', 'Market treasury version must be 8.');
  }
  return parsedObject('MarketTreasuryV8', base, fields, network);
}

const MAKER_LISTING_FIELDS = Object.freeze([
  'id', 'version', 'registry_id', 'treasury_id', 'package_config_id', 'root_id',
  'maker_version', 'root_content_commitment', 'admin_cap_id', 'seller',
  'expected_control_epoch', 'gross_atomic', 'protocol_atomic', 'creator_atomic',
  'seller_atomic', 'quote_commitment', 'status', 'revision', 'terminal_recipient',
]);

function parseListingAmounts(f, prefix, { source = true } = {}) {
  const parsed = {
    grossAtomic: uint(f.gross_atomic, 64, `${prefix}.gross_atomic`),
    protocolAtomic: uint(f.protocol_atomic, 64, `${prefix}.protocol_atomic`),
    creatorAtomic: uint(f.creator_atomic, 64, `${prefix}.creator_atomic`),
    sourceAtomic: source ? uint(f.source_atomic, 64, `${prefix}.source_atomic`) : 0n,
    sellerAtomic: uint(f.seller_atomic, 64, `${prefix}.seller_atomic`),
    quoteCommitment: commitment(f.quote_commitment, `${prefix}.quote_commitment`),
    status: Number(uint(f.status, 8, `${prefix}.status`)),
    revision: uint(f.revision, 64, `${prefix}.revision`),
    terminalRecipient: address(f.terminal_recipient, `${prefix}.terminal_recipient`),
  };
  if (!Object.values(MARKET_V8_LISTING_STATUS).includes(parsed.status)) {
    fail(MarketV8ParseError, 'MARKET_V8_LISTING_STATUS_INVALID', `${prefix}.status`, 'Listing status is unknown.');
  }
  if (parsed.grossAtomic === 0n || parsed.protocolAtomic + parsed.creatorAtomic + parsed.sourceAtomic + parsed.sellerAtomic !== parsed.grossAtomic) {
    fail(MarketV8ParseError, 'MARKET_V8_LISTING_AMOUNT_INVALID', `${prefix}.gross_atomic`, 'Listing amounts must be positive and sum exactly to gross.');
  }
  return parsed;
}

export function parseMakerListingV8(input, runtime, networkInput) {
  const network = networkName(networkInput, 'network', MarketV8ParseError);
  assertMarketV8Runtime(runtime);
  const base = unwrapMoveObject(input, marketV8Types(runtime).makerListing, 'MakerListingV8');
  const f = expectFields(base.fields, MAKER_LISTING_FIELDS, 'MakerListingV8.fields');
  const fields = {
    version: uint(f.version, 64, 'MakerListingV8.version'),
    registryId: objectId(f.registry_id, 'MakerListingV8.registry_id'),
    treasuryId: objectId(f.treasury_id, 'MakerListingV8.treasury_id'),
    packageConfigId: objectId(f.package_config_id, 'MakerListingV8.package_config_id'),
    rootId: objectId(f.root_id, 'MakerListingV8.root_id'),
    makerVersion: uint(f.maker_version, 64, 'MakerListingV8.maker_version'),
    rootContentCommitment: commitment(f.root_content_commitment, 'MakerListingV8.root_content_commitment'),
    adminCapId: objectId(f.admin_cap_id, 'MakerListingV8.admin_cap_id'),
    seller: address(f.seller, 'MakerListingV8.seller', { allowZero: false }),
    expectedControlEpoch: uint(f.expected_control_epoch, 64, 'MakerListingV8.expected_control_epoch'),
    ...parseListingAmounts(f, 'MakerListingV8', { source: false }),
  };
  if (fields.version !== MARKET_V8_VERSION) {
    fail(MarketV8ParseError, 'MARKET_V8_VERSION_MISMATCH', 'MakerListingV8.version', 'Maker listing version must be 8.');
  }
  return parsedObject('MakerListingV8', base, fields, network);
}

const SOUL_CUSTODY_FIELDS = Object.freeze([
  'listing_id', 'output_registry_id', 'soul_registry_id', 'market_registry_id',
  'market_treasury_id', 'root_id', 'maker_version', 'root_content_commitment',
  'output_id', 'receipt_id', 'soul_id', 'output_commitment', 'receipt_commitment',
  'soul_commitment', 'seller', 'expected_soul_ownership_epoch',
]);
const ASSET_LISTING_FIELDS = Object.freeze([
  'id', 'version', 'registry_id', 'treasury_id', 'package_config_id', 'custody',
  'gross_atomic', 'protocol_atomic', 'creator_atomic', 'source_atomic', 'seller_atomic',
  'quote_commitment', 'status', 'revision', 'terminal_recipient',
]);

function parseSoulCustody(value) {
  const f = expectFields(value, SOUL_CUSTODY_FIELDS, 'SoulListingV8.custody');
  return freezeRecord({
    listingId: objectId(f.listing_id, 'SoulListingV8.custody.listing_id'),
    outputRegistryId: objectId(f.output_registry_id, 'SoulListingV8.custody.output_registry_id'),
    soulRegistryId: objectId(f.soul_registry_id, 'SoulListingV8.custody.soul_registry_id'),
    marketRegistryId: objectId(f.market_registry_id, 'SoulListingV8.custody.market_registry_id'),
    marketTreasuryId: objectId(f.market_treasury_id, 'SoulListingV8.custody.market_treasury_id'),
    rootId: objectId(f.root_id, 'SoulListingV8.custody.root_id'),
    makerVersion: uint(f.maker_version, 64, 'SoulListingV8.custody.maker_version'),
    rootContentCommitment: commitment(f.root_content_commitment, 'SoulListingV8.custody.root_content_commitment'),
    outputId: objectId(f.output_id, 'SoulListingV8.custody.output_id'),
    receiptId: objectId(f.receipt_id, 'SoulListingV8.custody.receipt_id'),
    soulId: objectId(f.soul_id, 'SoulListingV8.custody.soul_id'),
    outputCommitment: commitment(f.output_commitment, 'SoulListingV8.custody.output_commitment'),
    receiptCommitment: commitment(f.receipt_commitment, 'SoulListingV8.custody.receipt_commitment'),
    soulCommitment: commitment(f.soul_commitment, 'SoulListingV8.custody.soul_commitment'),
    seller: address(f.seller, 'SoulListingV8.custody.seller', { allowZero: false }),
    expectedOwnershipEpoch: uint(f.expected_soul_ownership_epoch, 64, 'SoulListingV8.custody.expected_soul_ownership_epoch'),
  });
}

export function parseSoulListingV8(input, runtime, networkInput) {
  const network = networkName(networkInput, 'network', MarketV8ParseError);
  assertMarketV8Runtime(runtime);
  const base = unwrapMoveObject(input, marketV8Types(runtime).soulListing, 'SoulListingV8');
  const f = expectFields(base.fields, ASSET_LISTING_FIELDS, 'SoulListingV8.fields');
  const fields = {
    version: uint(f.version, 64, 'SoulListingV8.version'),
    registryId: objectId(f.registry_id, 'SoulListingV8.registry_id'),
    treasuryId: objectId(f.treasury_id, 'SoulListingV8.treasury_id'),
    packageConfigId: objectId(f.package_config_id, 'SoulListingV8.package_config_id'),
    custody: parseSoulCustody(f.custody),
    ...parseListingAmounts(f, 'SoulListingV8'),
  };
  if (fields.version !== MARKET_V8_VERSION || fields.custody.listingId !== base.objectId) {
    fail(MarketV8ParseError, 'MARKET_V8_LISTING_BINDING_INVALID', 'SoulListingV8.custody.listing_id', 'Soul custody must bind this v8 listing.');
  }
  return parsedObject('SoulListingV8', base, fields, network);
}

const PHYSICAL_CUSTODY_FIELDS = Object.freeze([
  'version', 'catalog_id', 'product_binding_commitment', 'call_cap_set_commitment',
  'market_authority_id', 'market_registry_id', 'market_treasury_id', 'listing_id',
  'physical_package_config_id', 'physical_registry_id', 'root_id', 'maker_version',
  'root_content_commitment', 'asset_id', 'asset_content_commitment', 'source_kind',
  'source_id', 'source_semantic_id', 'source_content_commitment', 'source_treasury_id',
  'holder', 'ownership_epoch', 'transferable', 'provenance_commitment',
]);

function parsePhysicalCustody(value) {
  const f = expectFields(value, PHYSICAL_CUSTODY_FIELDS, 'PhysicalListingV8.custody');
  const sourceKind = Number(uint(f.source_kind, 8, 'PhysicalListingV8.custody.source_kind'));
  if (![MARKET_V8_PHYSICAL_SOURCES.BASE, MARKET_V8_PHYSICAL_SOURCES.PACK].includes(sourceKind)) {
    fail(MarketV8ParseError, 'MARKET_V8_PHYSICAL_SOURCE_INVALID', 'PhysicalListingV8.custody.source_kind', 'Physical source kind is unknown.');
  }
  return freezeRecord({
    version: uint(f.version, 64, 'PhysicalListingV8.custody.version'),
    catalogId: objectId(f.catalog_id, 'PhysicalListingV8.custody.catalog_id'),
    productBindingCommitment: commitment(f.product_binding_commitment, 'PhysicalListingV8.custody.product_binding_commitment'),
    callCapSetCommitment: commitment(f.call_cap_set_commitment, 'PhysicalListingV8.custody.call_cap_set_commitment'),
    marketAuthorityId: objectId(f.market_authority_id, 'PhysicalListingV8.custody.market_authority_id'),
    marketRegistryId: objectId(f.market_registry_id, 'PhysicalListingV8.custody.market_registry_id'),
    marketTreasuryId: objectId(f.market_treasury_id, 'PhysicalListingV8.custody.market_treasury_id'),
    listingId: objectId(f.listing_id, 'PhysicalListingV8.custody.listing_id'),
    physicalPackageConfigId: objectId(f.physical_package_config_id, 'PhysicalListingV8.custody.physical_package_config_id'),
    physicalRegistryId: objectId(f.physical_registry_id, 'PhysicalListingV8.custody.physical_registry_id'),
    rootId: objectId(f.root_id, 'PhysicalListingV8.custody.root_id'),
    makerVersion: uint(f.maker_version, 64, 'PhysicalListingV8.custody.maker_version'),
    rootContentCommitment: commitment(f.root_content_commitment, 'PhysicalListingV8.custody.root_content_commitment'),
    assetId: objectId(f.asset_id, 'PhysicalListingV8.custody.asset_id'),
    assetContentCommitment: commitment(f.asset_content_commitment, 'PhysicalListingV8.custody.asset_content_commitment'),
    sourceKind,
    sourceId: objectId(f.source_id, 'PhysicalListingV8.custody.source_id'),
    sourceSemanticId: typeof f.source_semantic_id === 'string' ? f.source_semantic_id : fail(MarketV8ParseError, 'MARKET_V8_STRING_INVALID', 'PhysicalListingV8.custody.source_semantic_id', 'Source semantic ID must be a string.'),
    sourceContentCommitment: commitment(f.source_content_commitment, 'PhysicalListingV8.custody.source_content_commitment'),
    sourceTreasuryId: objectId(f.source_treasury_id, 'PhysicalListingV8.custody.source_treasury_id'),
    holder: address(f.holder, 'PhysicalListingV8.custody.holder', { allowZero: false }),
    ownershipEpoch: uint(f.ownership_epoch, 64, 'PhysicalListingV8.custody.ownership_epoch'),
    transferable: bool(f.transferable, 'PhysicalListingV8.custody.transferable'),
    provenanceCommitment: commitment(f.provenance_commitment, 'PhysicalListingV8.custody.provenance_commitment'),
  });
}

export function parsePhysicalListingV8(input, runtime, networkInput) {
  const network = networkName(networkInput, 'network', MarketV8ParseError);
  assertMarketV8Runtime(runtime);
  const base = unwrapMoveObject(input, marketV8Types(runtime).physicalListing, 'PhysicalListingV8');
  const f = expectFields(base.fields, ASSET_LISTING_FIELDS, 'PhysicalListingV8.fields');
  const fields = {
    version: uint(f.version, 64, 'PhysicalListingV8.version'),
    registryId: objectId(f.registry_id, 'PhysicalListingV8.registry_id'),
    treasuryId: objectId(f.treasury_id, 'PhysicalListingV8.treasury_id'),
    packageConfigId: objectId(f.package_config_id, 'PhysicalListingV8.package_config_id'),
    custody: parsePhysicalCustody(f.custody),
    ...parseListingAmounts(f, 'PhysicalListingV8'),
  };
  if (fields.version !== MARKET_V8_VERSION || fields.custody.version !== MARKET_V8_VERSION || fields.custody.listingId !== base.objectId) {
    fail(MarketV8ParseError, 'MARKET_V8_LISTING_BINDING_INVALID', 'PhysicalListingV8.custody.listing_id', 'Physical custody must bind this v8 listing.');
  }
  if (fields.status === MARKET_V8_LISTING_STATUS.OPEN && !fields.custody.transferable) {
    fail(MarketV8ParseError, 'MARKET_V8_PHYSICAL_NOT_TRANSFERABLE', 'PhysicalListingV8.custody.transferable', 'Open Physical custody must remain transferable.');
  }
  return parsedObject('PhysicalListingV8', base, fields, network);
}

function hexToBytes(value, field) {
  const normalized = bytes(value, field);
  return Uint8Array.from(normalized.slice(2).match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) || []);
}

function bytesToHex(value) {
  return `0x${[...value].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}

const MARKET_QUOTE_COMMITMENT_BCS = bcs.struct('MarketQuoteCommitmentInputV8', {
  domain: bcs.vector(bcs.u8()),
  version: bcs.u64(),
  quote_kind: bcs.u8(),
  root_id: bcs.Address,
  maker_version: bcs.u64(),
  root_content_commitment: bcs.vector(bcs.u8()),
  economics_commitment: bcs.vector(bcs.u8()),
  rights_commitment: bcs.vector(bcs.u8()),
  gross_atomic: bcs.u64(),
  protocol_atomic: bcs.u64(),
  creator_atomic: bcs.u64(),
  source_atomic: bcs.u64(),
  seller_atomic: bcs.u64(),
});

function assertRegistry(value) {
  if (!value || value[PARSED] !== true || value.kind !== 'MarketRegistryV8') {
    fail(MarketV8ParseError, 'MARKET_V8_PARSED_REGISTRY_REQUIRED', 'registry', 'A parsed MarketRegistryV8 is required.');
  }
  return value;
}

function assertTreasury(value) {
  if (!value || value[PARSED] !== true || value.kind !== 'MarketTreasuryV8') {
    fail(MarketV8ParseError, 'MARKET_V8_PARSED_TREASURY_REQUIRED', 'treasury', 'A parsed MarketTreasuryV8 is required.');
  }
  return value;
}

function assertListing(value, kinds) {
  if (!value || value[PARSED] !== true || !kinds.includes(value.kind)) {
    fail(
      MarketV8ParseError,
      'MARKET_V8_PARSED_LISTING_REQUIRED',
      'listing',
      `A parsed ${kinds.join(' or ')} is required.`,
    );
  }
  return value;
}

export function marketQuoteCommitmentBcsV8(quoteInput) {
  if (!plainRecord(quoteInput)) {
    fail(MarketV8ParseError, 'MARKET_V8_QUOTE_INVALID', 'quote', 'Quote must be a record.');
  }
  const quoteKind = Number(enumUint(quoteInput.quoteKind, 8, 'quote.quoteKind'));
  if (!Object.values(MARKET_V8_QUOTE_KINDS).includes(quoteKind)) {
    fail(MarketV8ParseError, 'MARKET_V8_QUOTE_KIND_INVALID', 'quote.quoteKind', 'Quote kind is unknown.');
  }
  return MARKET_QUOTE_COMMITMENT_BCS.serialize({
    domain: UTF8.encode(MARKET_V8_QUOTE_DOMAIN),
    version: uint(quoteInput.version ?? MARKET_V8_VERSION, 64, 'quote.version'),
    quote_kind: quoteKind,
    root_id: objectId(quoteInput.rootId, 'quote.rootId'),
    maker_version: uint(quoteInput.makerVersion, 64, 'quote.makerVersion'),
    root_content_commitment: hexToBytes(commitment(quoteInput.rootContentCommitment, 'quote.rootContentCommitment'), 'quote.rootContentCommitment'),
    economics_commitment: hexToBytes(commitment(quoteInput.economicsCommitment, 'quote.economicsCommitment'), 'quote.economicsCommitment'),
    rights_commitment: hexToBytes(commitment(quoteInput.rightsCommitment, 'quote.rightsCommitment'), 'quote.rightsCommitment'),
    gross_atomic: uint(quoteInput.grossAtomic, 64, 'quote.grossAtomic'),
    protocol_atomic: uint(quoteInput.protocolAtomic, 64, 'quote.protocolAtomic'),
    creator_atomic: uint(quoteInput.creatorAtomic, 64, 'quote.creatorAtomic'),
    source_atomic: uint(quoteInput.sourceAtomic, 64, 'quote.sourceAtomic'),
    seller_atomic: uint(quoteInput.sellerAtomic, 64, 'quote.sellerAtomic'),
  }).toBytes();
}

export function deriveMarketQuoteCommitmentV8(quoteInput) {
  return bytesToHex(sha256(marketQuoteCommitmentBcsV8(quoteInput)));
}

function share(grossAtomic, bps, field) {
  const value = (grossAtomic * bps) / BPS_DENOMINATOR;
  if (bps !== 0n && value === 0n) {
    fail(
      MarketV8EligibilityError,
      'MARKET_V8_SHARE_ROUNDS_TO_ZERO',
      field,
      `${field} rounds to zero exactly as Move EShareRoundsToZero.`,
    );
  }
  return value;
}

export function quoteMarketResaleV8(registryInput, quoteKindInput, grossAtomicInput) {
  const registry = assertRegistry(registryInput);
  const quoteKind = Number(enumUint(quoteKindInput, 8, 'quoteKind', MarketV8EligibilityError));
  const grossAtomic = uint(grossAtomicInput, 64, 'grossAtomic', MarketV8EligibilityError);
  if (grossAtomic === 0n) {
    fail(MarketV8EligibilityError, 'MARKET_V8_AMOUNT_INVALID', 'grossAtomic', 'Gross amount must be greater than zero.');
  }
  let protocolBps;
  let creatorBps;
  let sourceBps;
  if (quoteKind === MARKET_V8_QUOTE_KINDS.MAKER_RESALE) {
    protocolBps = registry.fields.makerMarketFeeBps;
    creatorBps = registry.fields.makerResaleRoyaltyBps;
    sourceBps = 0n;
  } else if ([MARKET_V8_QUOTE_KINDS.SOUL_RESALE, MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE].includes(quoteKind)) {
    protocolBps = registry.fields.soulMarketFeeBps;
    creatorBps = registry.fields.soulCreatorRoyaltyBps;
    sourceBps = registry.fields.makerSourceRoyaltyBps;
  } else {
    fail(MarketV8EligibilityError, 'MARKET_V8_QUOTE_KIND_INVALID', 'quoteKind', 'Quote kind is unknown.');
  }
  const protocolAtomic = share(grossAtomic, protocolBps, 'protocolAtomic');
  const creatorAtomic = share(grossAtomic, creatorBps, 'creatorAtomic');
  const sourceAtomic = share(grossAtomic, sourceBps, 'sourceAtomic');
  const distributed = protocolAtomic + creatorAtomic + sourceAtomic;
  if (distributed >= grossAtomic) {
    fail(MarketV8EligibilityError, 'MARKET_V8_DISTRIBUTION_INVALID', 'grossAtomic', 'Distributed shares must be strictly less than gross.');
  }
  const sellerAtomic = grossAtomic - distributed;
  const quote = {
    version: MARKET_V8_VERSION,
    quoteKind,
    rootId: registry.fields.rootId,
    makerVersion: registry.fields.makerVersion,
    rootContentCommitment: registry.fields.rootContentCommitment,
    economicsCommitment: registry.fields.economicsCommitment,
    rightsCommitment: registry.fields.rightsCommitment,
    grossAtomic,
    protocolAtomic,
    creatorAtomic,
    sourceAtomic,
    sellerAtomic,
  };
  return freezeRecord({ ...quote, commitment: deriveMarketQuoteCommitmentV8(quote) });
}

export function quoteMakerResaleV8(registry, grossAtomic) {
  return quoteMarketResaleV8(registry, MARKET_V8_QUOTE_KINDS.MAKER_RESALE, grossAtomic);
}

export function quoteSoulResaleV8(registry, grossAtomic) {
  return quoteMarketResaleV8(registry, MARKET_V8_QUOTE_KINDS.SOUL_RESALE, grossAtomic);
}

export function quotePhysicalResaleV8(registry, grossAtomic) {
  return quoteMarketResaleV8(registry, MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE, grossAtomic);
}

const EVENT_FIELDS = Object.freeze({
  MarketRegistrySealedV8: ['root_id', 'registry_id', 'treasury_id', 'zero_state_commitment'],
  MarketListingOpenedV8: ['listing_id', 'registry_id', 'lane', 'root_id', 'asset_id', 'seller', 'ownership_epoch', 'gross_atomic', 'quote_commitment'],
  MarketListingSettledV8: ['listing_id', 'registry_id', 'lane', 'asset_id', 'seller', 'buyer', 'gross_atomic', 'protocol_atomic', 'creator_atomic', 'source_atomic', 'seller_atomic'],
  MarketListingClosedV8: ['listing_id', 'registry_id', 'lane', 'asset_id', 'seller', 'recovered'],
});

function eventType(runtime, name) {
  return originType(assertMarketV8Runtime(runtime).typeOrigins.marketPackageId, 'market_v8', name);
}

function eventLane(value, field) {
  const lane = Number(uint(value, 8, field));
  if (!Object.values(MARKET_V8_LANES).includes(lane)) {
    fail(MarketV8ParseError, 'MARKET_V8_LANE_INVALID', field, 'Event lane is unknown.');
  }
  return lane;
}

export function parseMarketEventV8(input, runtime, networkInput) {
  const network = networkName(networkInput, 'network', MarketV8ParseError);
  assertMarketV8Runtime(runtime);
  if (!plainRecord(input) || !plainRecord(input.parsedJson)) {
    fail(MarketV8ParseError, 'MARKET_V8_EVENT_INVALID', 'event', 'Event must contain parsedJson.');
  }
  const actualType = canonicalStructType(input.type, 'event.type', MarketV8ParseError);
  const name = Object.keys(EVENT_FIELDS).find((candidate) => actualType === normalizeStructTag(eventType(runtime, candidate)));
  if (!name) {
    fail(MarketV8ParseError, 'MARKET_V8_EVENT_TYPE_ORIGIN_MISMATCH', 'event.type', 'Event has the wrong TypeOrigin or event type.');
  }
  const f = expectFields(input.parsedJson, EVENT_FIELDS[name], `${name}.parsedJson`);
  let fields;
  if (name === 'MarketRegistrySealedV8') {
    fields = {
      rootId: objectId(f.root_id, `${name}.root_id`),
      registryId: objectId(f.registry_id, `${name}.registry_id`),
      treasuryId: objectId(f.treasury_id, `${name}.treasury_id`),
      zeroStateCommitment: commitment(f.zero_state_commitment, `${name}.zero_state_commitment`),
    };
  } else if (name === 'MarketListingOpenedV8') {
    fields = {
      listingId: objectId(f.listing_id, `${name}.listing_id`),
      registryId: objectId(f.registry_id, `${name}.registry_id`),
      lane: eventLane(f.lane, `${name}.lane`),
      rootId: objectId(f.root_id, `${name}.root_id`),
      assetId: objectId(f.asset_id, `${name}.asset_id`),
      seller: address(f.seller, `${name}.seller`, { allowZero: false }),
      ownershipEpoch: uint(f.ownership_epoch, 64, `${name}.ownership_epoch`),
      grossAtomic: uint(f.gross_atomic, 64, `${name}.gross_atomic`),
      quoteCommitment: commitment(f.quote_commitment, `${name}.quote_commitment`),
    };
  } else if (name === 'MarketListingSettledV8') {
    fields = {
      listingId: objectId(f.listing_id, `${name}.listing_id`),
      registryId: objectId(f.registry_id, `${name}.registry_id`),
      lane: eventLane(f.lane, `${name}.lane`),
      assetId: objectId(f.asset_id, `${name}.asset_id`),
      seller: address(f.seller, `${name}.seller`, { allowZero: false }),
      buyer: address(f.buyer, `${name}.buyer`, { allowZero: false }),
      grossAtomic: uint(f.gross_atomic, 64, `${name}.gross_atomic`),
      protocolAtomic: uint(f.protocol_atomic, 64, `${name}.protocol_atomic`),
      creatorAtomic: uint(f.creator_atomic, 64, `${name}.creator_atomic`),
      sourceAtomic: uint(f.source_atomic, 64, `${name}.source_atomic`),
      sellerAtomic: uint(f.seller_atomic, 64, `${name}.seller_atomic`),
    };
    if (fields.protocolAtomic + fields.creatorAtomic + fields.sourceAtomic + fields.sellerAtomic !== fields.grossAtomic) {
      fail(MarketV8ParseError, 'MARKET_V8_EVENT_AMOUNT_INVALID', `${name}.gross_atomic`, 'Settled event allocations must sum exactly to gross.');
    }
  } else {
    fields = {
      listingId: objectId(f.listing_id, `${name}.listing_id`),
      registryId: objectId(f.registry_id, `${name}.registry_id`),
      lane: eventLane(f.lane, `${name}.lane`),
      assetId: objectId(f.asset_id, `${name}.asset_id`),
      seller: address(f.seller, `${name}.seller`, { allowZero: false }),
      recovered: bool(f.recovered, `${name}.recovered`),
    };
  }
  return freezeRecord({ kind: name, network, type: actualType, fields: freezeRecord(fields) });
}

function same(value, expected, code, field, message) {
  if (value !== expected) fail(MarketV8EligibilityError, code, field, message, { actual: value, expected });
}

export function assertMarketPairV8(registryInput, treasuryInput) {
  const registry = assertRegistry(registryInput);
  const treasury = assertTreasury(treasuryInput);
  same(registry.network, treasury.network, 'MARKET_V8_MARKET_NETWORK_MISMATCH', 'treasury.network', 'Registry and treasury came from different networks.');
  same(registry.fields.treasuryId, treasury.objectId, 'MARKET_V8_TREASURY_BINDING_MISMATCH', 'registry.treasuryId', 'Registry binds a different treasury.');
  for (const field of ['catalogId', 'packageConfigId', 'rootId', 'makerVersion', 'rootContentCommitment']) {
    same(registry.fields[field], treasury.fields[field], 'MARKET_V8_MARKET_BINDING_MISMATCH', field, `Registry and treasury disagree on ${field}.`);
  }
  if (!registry.fields.sealed) {
    fail(MarketV8EligibilityError, 'MARKET_V8_REGISTRY_NOT_SEALED', 'registry.sealed', 'Market registry must be sealed.');
  }
  return freezeRecord({ registry, treasury });
}

function listingIdentity(listing) {
  if (listing.kind === 'MakerListingV8') return listing.fields;
  return listing.fields.custody;
}

function listingSeller(listing) {
  return listing.kind === 'MakerListingV8' ? listing.fields.seller : listing.fields.custody.holder ?? listing.fields.custody.seller;
}

function quoteKindForListing(listing) {
  if (listing.kind === 'MakerListingV8') return MARKET_V8_QUOTE_KINDS.MAKER_RESALE;
  if (listing.kind === 'SoulListingV8') return MARKET_V8_QUOTE_KINDS.SOUL_RESALE;
  return MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE;
}

function exactExpectedCommitment(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) {
    fail(MarketV8EligibilityError, 'MARKET_V8_EXPECTATION_INVALID', field, `${field} must be an exact 32-byte lowercase hex commitment.`);
  }
  return value;
}

function assertSnapshot(listing, registry, expectation) {
  assertExactKeys(
    expectation,
    ['listingRevision', 'quoteCommitment', 'registryRevision'],
    'expectation',
    MarketV8EligibilityError,
  );
  same(
    listing.fields.revision,
    uint(expectation.listingRevision, 64, 'expectation.listingRevision', MarketV8EligibilityError),
    'MARKET_V8_STALE_LISTING_REVISION',
    'expectation.listingRevision',
    'Listing revision is stale.',
  );
  same(
    registry.fields.revision,
    uint(expectation.registryRevision, 64, 'expectation.registryRevision', MarketV8EligibilityError),
    'MARKET_V8_STALE_REGISTRY_REVISION',
    'expectation.registryRevision',
    'Market registry revision is stale.',
  );
  same(
    listing.fields.quoteCommitment,
    exactExpectedCommitment(expectation.quoteCommitment, 'expectation.quoteCommitment'),
    'MARKET_V8_STALE_QUOTE_COMMITMENT',
    'expectation.quoteCommitment',
    'Listing quote commitment is stale.',
  );
}

function assertListingBinding(listing, registry, treasury) {
  same(listing.fields.registryId, registry.objectId, 'MARKET_V8_LISTING_REGISTRY_MISMATCH', 'listing.registryId', 'Listing binds another registry.');
  same(listing.fields.treasuryId, treasury.objectId, 'MARKET_V8_LISTING_TREASURY_MISMATCH', 'listing.treasuryId', 'Listing binds another treasury.');
  same(listing.fields.packageConfigId, registry.fields.packageConfigId, 'MARKET_V8_LISTING_CONFIG_MISMATCH', 'listing.packageConfigId', 'Listing binds another package config.');
  const identity = listingIdentity(listing);
  for (const field of ['rootId', 'makerVersion', 'rootContentCommitment']) {
    same(identity[field], registry.fields[field], 'MARKET_V8_LISTING_ROOT_MISMATCH', `listing.${field}`, `Listing has stale ${field}.`);
  }
  if (listing.kind !== 'MakerListingV8') {
    same(identity.marketRegistryId, registry.objectId, 'MARKET_V8_CUSTODY_REGISTRY_MISMATCH', 'listing.custody.marketRegistryId', 'Custody binds another registry.');
    same(identity.marketTreasuryId, treasury.objectId, 'MARKET_V8_CUSTODY_TREASURY_MISMATCH', 'listing.custody.marketTreasuryId', 'Custody binds another treasury.');
  }
  if (listing.kind === 'PhysicalListingV8') {
    same(identity.catalogId, registry.fields.catalogId, 'MARKET_V8_CUSTODY_CATALOG_MISMATCH', 'listing.custody.catalogId', 'Physical custody binds another catalog.');
    same(identity.productBindingCommitment, registry.fields.productBindingCommitment, 'MARKET_V8_CUSTODY_PRODUCT_MISMATCH', 'listing.custody.productBindingCommitment', 'Physical custody has stale product binding.');
    same(identity.callCapSetCommitment, registry.fields.callCapSetCommitment, 'MARKET_V8_CUSTODY_CALL_CAP_MISMATCH', 'listing.custody.callCapSetCommitment', 'Physical custody has stale call-cap binding.');
  }
}

function assertOpenListing(listing) {
  if (listing.fields.status !== MARKET_V8_LISTING_STATUS.OPEN) {
    fail(MarketV8EligibilityError, 'MARKET_V8_LISTING_NOT_OPEN', 'listing.status', 'Listing is no longer open.');
  }
  if (listing.fields.terminalRecipient !== ZERO_ADDRESS) {
    fail(MarketV8EligibilityError, 'MARKET_V8_LISTING_TERMINAL', 'listing.terminalRecipient', 'Open listing cannot have a terminal recipient.');
  }
}

function assertLane(listing, lane) {
  if (lane === MARKET_V8_LANES.MAKER && listing.kind !== 'MakerListingV8') {
    fail(MarketV8EligibilityError, 'MARKET_V8_CROSS_LANE', 'lane', 'Maker action requires MakerListingV8.');
  }
  if (lane === MARKET_V8_LANES.SOUL && listing.kind !== 'SoulListingV8') {
    fail(MarketV8EligibilityError, 'MARKET_V8_CROSS_LANE', 'lane', 'Soul action requires SoulListingV8.');
  }
  if ([MARKET_V8_LANES.PHYSICAL_BASE, MARKET_V8_LANES.PHYSICAL_PACK].includes(lane)) {
    if (listing.kind !== 'PhysicalListingV8') {
      fail(MarketV8EligibilityError, 'MARKET_V8_CROSS_LANE', 'lane', 'Physical action requires PhysicalListingV8.');
    }
    const expectedSource = lane === MARKET_V8_LANES.PHYSICAL_BASE
      ? MARKET_V8_PHYSICAL_SOURCES.BASE
      : MARKET_V8_PHYSICAL_SOURCES.PACK;
    same(listing.fields.custody.sourceKind, expectedSource, 'MARKET_V8_CROSS_SOURCE', 'listing.custody.sourceKind', 'Physical listing belongs to the other static source lane.');
  }
}

function quoteMatchesListing(listing, registry) {
  const quote = quoteMarketResaleV8(registry, quoteKindForListing(listing), listing.fields.grossAtomic);
  for (const field of ['grossAtomic', 'protocolAtomic', 'creatorAtomic', 'sourceAtomic', 'sellerAtomic', 'quoteCommitment']) {
    const quoteField = field === 'quoteCommitment' ? 'commitment' : field;
    same(listing.fields[field], quote[quoteField], 'MARKET_V8_STALE_QUOTE', `listing.${field}`, `Listing ${field} does not match the current exact quote.`);
  }
  return quote;
}

function inspect(check) {
  try {
    const value = check();
    return freezeRecord({ eligible: true, issues: Object.freeze([]), value });
  } catch (error) {
    if (!(error instanceof MarketV8Error)) throw error;
    return freezeRecord({
      eligible: false,
      issues: Object.freeze([freezeRecord({ code: error.code, field: error.field, message: error.message })]),
      value: null,
    });
  }
}

export function assertMarketPurchaseEligibilityV8({
  listing: listingInput,
  registry: registryInput,
  treasury: treasuryInput,
  lane,
  buyer,
  expectation,
}) {
  const listing = assertListing(listingInput, ['MakerListingV8', 'SoulListingV8', 'PhysicalListingV8']);
  const { registry, treasury } = assertMarketPairV8(registryInput, treasuryInput);
  assertOpenListing(listing);
  assertLane(listing, lane);
  assertListingBinding(listing, registry, treasury);
  assertSnapshot(listing, registry, expectation);
  const normalizedBuyer = address(buyer, 'buyer', { allowZero: false });
  same(normalizedBuyer === listingSeller(listing), false, 'MARKET_V8_SELLER_SELF_BUY', 'buyer', 'Seller cannot buy their own listing.');
  return freezeRecord({ listing, registry, treasury, buyer: normalizedBuyer, quote: quoteMatchesListing(listing, registry) });
}

export function inspectMarketPurchaseEligibilityV8(input) {
  return inspect(() => assertMarketPurchaseEligibilityV8(input));
}

export function assertMarketCancelEligibilityV8({
  listing: listingInput,
  registry: registryInput,
  treasury: treasuryInput,
  lane,
  seller,
  expectation,
}) {
  const listing = assertListing(listingInput, ['MakerListingV8', 'SoulListingV8', 'PhysicalListingV8']);
  const { registry, treasury } = assertMarketPairV8(registryInput, treasuryInput);
  assertOpenListing(listing);
  assertLane(listing, lane);
  assertListingBinding(listing, registry, treasury);
  assertSnapshot(listing, registry, expectation);
  const normalizedSeller = address(seller, 'seller', { allowZero: false });
  same(normalizedSeller, listingSeller(listing), 'MARKET_V8_NOT_SELLER', 'seller', 'Only the stored seller can cancel.');
  return freezeRecord({ listing, registry, treasury, seller: normalizedSeller });
}

export function inspectMarketCancelEligibilityV8(input) {
  return inspect(() => assertMarketCancelEligibilityV8(input));
}

function protocolDegraded(registry, protocolState) {
  assertExactKeys(protocolState, ['commitment', 'enabled', 'revision'], 'protocolState', MarketV8EligibilityError);
  if (typeof protocolState.enabled !== 'boolean') {
    fail(MarketV8EligibilityError, 'MARKET_V8_PROTOCOL_STATE_INVALID', 'protocolState.enabled', 'Protocol enabled must be boolean.');
  }
  const revision = uint(protocolState.revision, 64, 'protocolState.revision', MarketV8EligibilityError);
  const commitmentValue = exactExpectedCommitment(protocolState.commitment, 'protocolState.commitment');
  return !protocolState.enabled
    || revision !== registry.fields.protocolConfigRevision
    || commitmentValue !== registry.fields.protocolConfigCommitment;
}

export function assertMarketRecoveryEligibilityV8({
  listing: listingInput,
  registry: registryInput,
  treasury: treasuryInput,
  lane,
  lifecycle,
  protocolState,
  expectation,
}) {
  const listing = assertListing(listingInput, ['MakerListingV8', 'SoulListingV8', 'PhysicalListingV8']);
  const { registry, treasury } = assertMarketPairV8(registryInput, treasuryInput);
  assertOpenListing(listing);
  assertLane(listing, lane);
  assertListingBinding(listing, registry, treasury);
  assertSnapshot(listing, registry, expectation);
  const lifecycleValue = Number(uint(lifecycle, 8, 'lifecycle', MarketV8EligibilityError));
  const degraded = protocolDegraded(registry, protocolState);
  const recoverable = lane === MARKET_V8_LANES.MAKER
    ? lifecycleValue === MARKET_V8_LIFECYCLES.ARCHIVED || degraded
    : [MARKET_V8_LIFECYCLES.PAUSED, MARKET_V8_LIFECYCLES.ARCHIVED].includes(lifecycleValue) || degraded;
  if (!recoverable) {
    fail(MarketV8EligibilityError, 'MARKET_V8_NOT_RECOVERABLE', 'lifecycle', 'Listing is not recoverable in the supplied live state.');
  }
  return freezeRecord({ listing, registry, treasury, degraded, lifecycle: lifecycleValue });
}

export function inspectMarketRecoveryEligibilityV8(input) {
  return inspect(() => assertMarketRecoveryEligibilityV8(input));
}

export const MARKET_V8_ACTION_ABI = Object.freeze({
  listMakerControl: Object.freeze({ function: 'list_maker_control_v8', arguments: Object.freeze(['registry', 'treasury', 'root', 'admin', 'makerTreasury', 'protocolConfig', 'catalog', 'config', 'grossAtomic']) }),
  purchaseMakerControl: Object.freeze({ function: 'purchase_maker_control_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'root', 'protocolConfig', 'protocolTreasury', 'catalog', 'config', 'adminReceiving', 'payment']) }),
  cancelMakerControl: Object.freeze({ function: 'cancel_maker_control_listing_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'root', 'catalog', 'config', 'adminReceiving']) }),
  recoverMakerControl: Object.freeze({ function: 'recover_maker_control_listing_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'root', 'protocolConfig', 'catalog', 'config', 'adminReceiving']) }),
  listSoulBundle: Object.freeze({ function: 'list_soul_bundle_v8', arguments: Object.freeze(['registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'protocolConfig', 'catalog', 'config', 'outputAsset', 'receipt', 'soul', 'grossAtomic']) }),
  purchaseSoulBundle: Object.freeze({ function: 'purchase_soul_bundle_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'makerTreasury', 'protocolConfig', 'protocolTreasury', 'catalog', 'config', 'outputReceiving', 'receiptReceiving', 'soulReceiving', 'payment']) }),
  cancelSoulListing: Object.freeze({ function: 'cancel_soul_listing_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'catalog', 'config', 'outputReceiving', 'receiptReceiving', 'soulReceiving']) }),
  recoverSoulListing: Object.freeze({ function: 'recover_soul_listing_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'outputRegistry', 'soulRegistry', 'root', 'protocolConfig', 'catalog', 'config', 'outputReceiving', 'receiptReceiving', 'soulReceiving']) }),
  listBasePhysical: Object.freeze({ function: 'list_base_physical_v8', arguments: Object.freeze(['registry', 'treasury', 'physicalRegistry', 'root', 'makerTreasury', 'protocolConfig', 'catalog', 'physicalConfig', 'config', 'asset', 'grossAtomic']) }),
  listPackPhysical: Object.freeze({ function: 'list_pack_physical_v8', arguments: Object.freeze(['registry', 'treasury', 'physicalRegistry', 'root', 'packTreasury', 'protocolConfig', 'catalog', 'physicalConfig', 'config', 'asset', 'grossAtomic']) }),
  purchaseBasePhysical: Object.freeze({ function: 'purchase_base_physical_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'makerTreasury', 'protocolConfig', 'protocolTreasury', 'catalog', 'physicalConfig', 'config', 'receiving', 'payment']) }),
  purchasePackPhysical: Object.freeze({ function: 'purchase_pack_physical_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'packRelease', 'packTreasury', 'protocolConfig', 'protocolTreasury', 'catalog', 'physicalConfig', 'config', 'receiving', 'payment']) }),
  cancelPhysicalListing: Object.freeze({ function: 'cancel_physical_listing_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'catalog', 'config', 'receiving']) }),
  recoverPhysicalListing: Object.freeze({ function: 'recover_physical_listing_v8', arguments: Object.freeze(['listing', 'registry', 'treasury', 'physicalRegistry', 'root', 'protocolConfig', 'catalog', 'config', 'receiving']) }),
});

function buildId(value, field) {
  const candidate = typeof value === 'object' && value !== null ? value.objectId : value;
  if (typeof candidate !== 'string') {
    fail(MarketV8BuildError, 'MARKET_V8_OBJECT_INPUT_INVALID', field, `${field} must include objectId and type.`);
  }
  try {
    const normalized = normalizeSuiObjectId(candidate);
    if (normalized === ZERO_ADDRESS) throw new TypeError('zero');
    return normalized;
  } catch {
    fail(MarketV8BuildError, 'MARKET_V8_OBJECT_INPUT_INVALID', field, `${field}.objectId must be a non-zero Sui ID.`);
  }
}

function buildAddress(value, field) {
  if (typeof value !== 'string') {
    fail(MarketV8BuildError, 'MARKET_V8_SENDER_INVALID', field, `${field} must be a non-zero Sui address.`);
  }
  try {
    const normalized = normalizeSuiAddress(value);
    if (normalized === ZERO_ADDRESS) throw new TypeError('zero');
    return normalized;
  } catch {
    fail(MarketV8BuildError, 'MARKET_V8_SENDER_INVALID', field, `${field} must be a non-zero Sui address.`);
  }
}

function typedObject(value, expectedType, field, { expectedId } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(MarketV8BuildError, 'MARKET_V8_OBJECT_INPUT_INVALID', field, `${field} must include objectId and type.`);
  }
  const id = buildId(value, field);
  const network = networkName(value.network, `${field}.network`);
  const actualType = canonicalStructType(value.type, `${field}.type`, MarketV8BuildError);
  const expected = normalizeStructTag(expectedType);
  if (actualType !== expected) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_OBJECT_TYPE_MISMATCH',
      `${field}.type`,
      `${field} has the wrong stable TypeOrigin or type argument.`,
      { actual: actualType, expected },
    );
  }
  if (expectedId !== undefined && id !== expectedId) {
    fail(MarketV8BuildError, 'MARKET_V8_OBJECT_REF_MISMATCH', `${field}.objectId`, `${field} is not the exact bound object.`, { actual: id, expected: expectedId });
  }
  return freezeRecord({ objectId: id, network, type: actualType, source: value });
}

function exactRef(value, expectedType, field, expectedId, { paymentAtomic } = {}) {
  const checked = typedObject(value, expectedType, field, { expectedId });
  const version = uint(value.version, 64, `${field}.version`, MarketV8BuildError);
  const digest = digestValue(value.digest, `${field}.digest`);
  let balanceAtomic;
  if (paymentAtomic !== undefined) {
    if (Array.isArray(value) || !hasOwn(value, 'balanceAtomic')) {
      fail(MarketV8BuildError, 'MARKET_V8_EXACT_PAYMENT_REQUIRED', field, 'Exactly one payment coin with an observed balance is required.');
    }
    balanceAtomic = uint(value.balanceAtomic, 64, `${field}.balanceAtomic`, MarketV8BuildError);
    if (balanceAtomic !== paymentAtomic) {
      fail(
        MarketV8BuildError,
        'MARKET_V8_PAYMENT_AMOUNT_MISMATCH',
        `${field}.balanceAtomic`,
        'Payment coin balance must equal the listing gross exactly; underpayment and overpayment are forbidden.',
        { actual: balanceAtomic.toString(), expected: paymentAtomic.toString() },
      );
    }
  }
  return freezeRecord({ ...checked, version, digest, balanceAtomic });
}

function sourceKind(value, field) {
  let source = value?.sourceKind;
  if (source === undefined && plainRecord(value?.fields)) source = value.fields.source_kind ?? value.fields.sourceKind;
  return Number(uint(source, 8, `${field}.sourceKind`, MarketV8BuildError));
}

function expectedSourceTreasury(value, field) {
  let source = value?.sourceTreasuryId;
  if (source === undefined && plainRecord(value?.fields)) source = value.fields.source_treasury_id ?? value.fields.sourceTreasuryId;
  if (source === undefined) {
    fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_REQUIRED', `${field}.sourceTreasuryId`, 'Physical asset source treasury identity is required.');
  }
  return buildId(source, `${field}.sourceTreasuryId`);
}

function requireSource(value, expectedKind, treasuryId, field) {
  const actualKind = sourceKind(value, field);
  if (actualKind !== expectedKind) {
    fail(MarketV8BuildError, 'MARKET_V8_CROSS_SOURCE', `${field}.sourceKind`, 'Physical asset belongs to the other static source lane.');
  }
  const actualTreasury = expectedSourceTreasury(value, field);
  if (actualTreasury !== treasuryId) {
    fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_MISMATCH', `${field}.sourceTreasuryId`, 'Physical source treasury does not match the selected lane treasury.');
  }
}

function argObject(name, checked) {
  return freezeRecord({ kind: 'object', name, ...checked });
}

function argReceiving(name, checked) {
  return freezeRecord({ kind: 'receiving', name, ...checked });
}

function argPayment(name, checked) {
  return freezeRecord({ kind: 'payment', name, ...checked });
}

function argU64(name, value) {
  return freezeRecord({ kind: 'u64', name, value });
}

function compileAction(runtimeInput, action, lane, walletInput, args, expectation = undefined) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const abi = MARKET_V8_ACTION_ABI[action];
  if (!abi) fail(MarketV8BuildError, 'MARKET_V8_ACTION_UNKNOWN', 'action', 'Market action is unknown.');
  const wallet = assertMarketV8WalletContext(runtime, walletInput);
  const sender = wallet.address;
  if (args.length !== abi.arguments.length || args.some((arg, index) => arg.name !== abi.arguments[index])) {
    fail(MarketV8BuildError, 'MARKET_V8_ARGUMENT_ORDER_INVALID', 'arguments', 'Builder argument order diverges from the checked Move ABI.');
  }
  for (const arg of args.filter((entry) => entry.kind !== 'u64')) {
    if (arg.network !== wallet.network) {
      fail(
        MarketV8BuildError,
        'MARKET_V8_OBJECT_NETWORK_MISMATCH',
        `${arg.name}.network`,
        `${arg.name} came from a different network than the connected wallet.`,
        { actual: arg.network, expected: wallet.network },
      );
    }
  }
  const transaction = new Transaction();
  transaction.setSender(sender);
  const transactionArguments = args.map((arg) => {
    if (arg.kind === 'u64') return transaction.pure.u64(arg.value);
    if (arg.kind === 'receiving') {
      return transaction.receivingRef({ objectId: arg.objectId, version: arg.version.toString(), digest: arg.digest });
    }
    if (arg.kind === 'payment') {
      return transaction.objectRef({ objectId: arg.objectId, version: arg.version.toString(), digest: arg.digest });
    }
    return transaction.object(arg.objectId);
  });
  const target = `${runtime.callablePackageId}::market_v8::${abi.function}`;
  transaction.moveCall({ target, typeArguments: [runtime.paymentCoinType], arguments: transactionArguments });
  const descriptorArgs = Object.freeze(args.map((arg) => freezeRecord({
    kind: arg.kind,
    name: arg.name,
    ...(arg.objectId ? { objectId: arg.objectId, type: arg.type } : {}),
    ...(arg.version !== undefined ? { version: arg.version.toString(), digest: arg.digest } : {}),
    ...(arg.balanceAtomic !== undefined ? { balanceAtomic: arg.balanceAtomic.toString() } : {}),
    ...(arg.value !== undefined ? { value: arg.value.toString() } : {}),
  })));
  const descriptor = freezeRecord({
    schema: MARKET_V8_ACTION_SCHEMA,
    action,
    lane,
    target,
    typeArguments: Object.freeze([runtime.paymentCoinType]),
    sender,
    network: wallet.network,
    arguments: descriptorArgs,
    ...(expectation ? { expectation: freezeRecord({
      listingRevision: String(expectation.listingRevision),
      registryRevision: String(expectation.registryRevision),
      quoteCommitment: expectation.quoteCommitment,
    }) } : {}),
  });
  return freezeRecord({ descriptor, transaction });
}

function marketArgs(types, registry, treasury) {
  return {
    registry: typedObject(registry, types.marketRegistry, 'registry'),
    treasury: typedObject(treasury, types.marketTreasury, 'treasury'),
  };
}

function commonBoundObjects(types, registry, input) {
  return {
    root: typedObject(input.root, types.makerRoot, 'root', { expectedId: registry.fields.rootId }),
    catalog: typedObject(input.catalog, types.catalog, 'catalog', { expectedId: registry.fields.catalogId }),
    config: typedObject(input.config, types.marketConfig, 'config', { expectedId: registry.fields.packageConfigId }),
  };
}

function protocolObject(types, registry, value) {
  return typedObject(value, types.protocolConfig, 'protocolConfig', { expectedId: registry.fields.protocolConfigId });
}

function assertRegistryExpectation(registry, expected) {
  const checked = uint(expected, 64, 'expectedRegistryRevision', MarketV8EligibilityError);
  same(registry.fields.revision, checked, 'MARKET_V8_STALE_REGISTRY_REVISION', 'expectedRegistryRevision', 'Market registry revision is stale.');
}

export function assertMarketListEligibilityV8({ registry: registryInput, treasury: treasuryInput, lane, lifecycle, grossAtomic, expectedRegistryRevision }) {
  const { registry, treasury } = assertMarketPairV8(registryInput, treasuryInput);
  assertRegistryExpectation(registry, expectedRegistryRevision);
  const lifecycleValue = Number(uint(lifecycle, 8, 'lifecycle', MarketV8EligibilityError));
  const expectedLifecycle = lane === MARKET_V8_LANES.MAKER ? MARKET_V8_LIFECYCLES.PAUSED : MARKET_V8_LIFECYCLES.ACTIVE;
  if (lifecycleValue !== expectedLifecycle) {
    fail(MarketV8EligibilityError, 'MARKET_V8_LIFECYCLE_INELIGIBLE', 'lifecycle', `This listing lane requires lifecycle ${expectedLifecycle}.`);
  }
  const quoteKind = lane === MARKET_V8_LANES.MAKER
    ? MARKET_V8_QUOTE_KINDS.MAKER_RESALE
    : lane === MARKET_V8_LANES.SOUL
      ? MARKET_V8_QUOTE_KINDS.SOUL_RESALE
      : MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE;
  return freezeRecord({ registry, treasury, quote: quoteMarketResaleV8(registry, quoteKind, grossAtomic), lifecycle: lifecycleValue });
}

export function inspectMarketListEligibilityV8(input) {
  return inspect(() => assertMarketListEligibilityV8(input));
}

function parsedListingObject(types, listing, field = 'listing') {
  const expectedType = listing.kind === 'MakerListingV8'
    ? types.makerListing
    : listing.kind === 'SoulListingV8'
      ? types.soulListing
      : types.physicalListing;
  return typedObject(listing, expectedType, field, { expectedId: listing.objectId });
}

function purchaseSetup(runtimeInput, input, lane) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const types = marketV8Types(runtime);
  const wallet = assertMarketV8WalletContext(runtime, input.wallet);
  const eligible = assertMarketPurchaseEligibilityV8({
    listing: input.listing,
    registry: input.registry,
    treasury: input.treasury,
    lane,
    buyer: wallet.address,
    expectation: input.expectation,
  });
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(types, eligible.registry, input);
  return { runtime, types, wallet, eligible, market, common, listing: parsedListingObject(types, eligible.listing) };
}

function cancelSetup(runtimeInput, input, lane) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const types = marketV8Types(runtime);
  const wallet = assertMarketV8WalletContext(runtime, input.wallet);
  const eligible = assertMarketCancelEligibilityV8({
    listing: input.listing,
    registry: input.registry,
    treasury: input.treasury,
    lane,
    seller: wallet.address,
    expectation: input.expectation,
  });
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(types, eligible.registry, input);
  return { runtime, types, wallet, eligible, market, common, listing: parsedListingObject(types, eligible.listing) };
}

function recoverySetup(runtimeInput, input, lane) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const types = marketV8Types(runtime);
  const wallet = assertMarketV8WalletContext(runtime, input.wallet);
  const eligible = assertMarketRecoveryEligibilityV8({
    listing: input.listing,
    registry: input.registry,
    treasury: input.treasury,
    lane,
    lifecycle: input.lifecycle,
    protocolState: input.protocolState,
    expectation: input.expectation,
  });
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(types, eligible.registry, input);
  return { runtime, types, wallet, eligible, market, common, listing: parsedListingObject(types, eligible.listing) };
}

export function buildListMakerControlV8(runtimeInput, input) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const types = marketV8Types(runtime);
  const wallet = assertMarketV8WalletContext(runtime, input.wallet);
  const eligible = assertMarketListEligibilityV8({
    registry: input.registry,
    treasury: input.treasury,
    lane: MARKET_V8_LANES.MAKER,
    lifecycle: input.lifecycle,
    grossAtomic: input.grossAtomic,
    expectedRegistryRevision: input.expectedRegistryRevision,
  });
  const makerTreasuryBalance = uint(input.makerTreasuryBalanceAtomic, 64, 'makerTreasuryBalanceAtomic', MarketV8EligibilityError);
  if (makerTreasuryBalance !== 0n) {
    fail(MarketV8EligibilityError, 'MARKET_V8_MAKER_TREASURY_NOT_EMPTY', 'makerTreasuryBalanceAtomic', 'Maker control listing requires an empty Maker treasury.');
  }
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(types, eligible.registry, input);
  const admin = typedObject(input.admin, types.makerAdmin, 'admin');
  const makerTreasury = typedObject(input.makerTreasury, types.makerTreasury, 'makerTreasury');
  const protocolConfig = protocolObject(types, eligible.registry, input.protocolConfig);
  return compileAction(runtime, 'listMakerControl', MARKET_V8_LANES.MAKER, wallet, [
    argObject('registry', market.registry),
    argObject('treasury', market.treasury),
    argObject('root', common.root),
    argObject('admin', admin),
    argObject('makerTreasury', makerTreasury),
    argObject('protocolConfig', protocolConfig),
    argObject('catalog', common.catalog),
    argObject('config', common.config),
    argU64('grossAtomic', eligible.quote.grossAtomic),
  ]);
}

export function buildPurchaseMakerControlV8(runtimeInput, input) {
  const setup = purchaseSetup(runtimeInput, input, MARKET_V8_LANES.MAKER);
  const protocolConfig = protocolObject(setup.types, setup.eligible.registry, input.protocolConfig);
  const protocolTreasury = typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury');
  const receiving = exactRef(input.adminReceiving, setup.types.makerAdmin, 'adminReceiving', setup.eligible.listing.fields.adminCapId);
  const payment = exactRef(input.payment, setup.types.paymentCoin, 'payment', undefined, { paymentAtomic: setup.eligible.quote.grossAtomic });
  return compileAction(setup.runtime, 'purchaseMakerControl', MARKET_V8_LANES.MAKER, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('root', setup.common.root),
    argObject('protocolConfig', protocolConfig),
    argObject('protocolTreasury', protocolTreasury),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('adminReceiving', receiving),
    argPayment('payment', payment),
  ], input.expectation);
}

export function buildCancelMakerControlV8(runtimeInput, input) {
  const setup = cancelSetup(runtimeInput, input, MARKET_V8_LANES.MAKER);
  const receiving = exactRef(input.adminReceiving, setup.types.makerAdmin, 'adminReceiving', setup.eligible.listing.fields.adminCapId);
  return compileAction(setup.runtime, 'cancelMakerControl', MARKET_V8_LANES.MAKER, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('root', setup.common.root),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('adminReceiving', receiving),
  ], input.expectation);
}

export function buildRecoverMakerControlV8(runtimeInput, input) {
  const setup = recoverySetup(runtimeInput, input, MARKET_V8_LANES.MAKER);
  const protocolConfig = protocolObject(setup.types, setup.eligible.registry, input.protocolConfig);
  const receiving = exactRef(input.adminReceiving, setup.types.makerAdmin, 'adminReceiving', setup.eligible.listing.fields.adminCapId);
  return compileAction(setup.runtime, 'recoverMakerControl', MARKET_V8_LANES.MAKER, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('root', setup.common.root),
    argObject('protocolConfig', protocolConfig),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('adminReceiving', receiving),
  ], input.expectation);
}

export function buildListSoulBundleV8(runtimeInput, input) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const types = marketV8Types(runtime);
  const wallet = assertMarketV8WalletContext(runtime, input.wallet);
  const eligible = assertMarketListEligibilityV8({
    registry: input.registry,
    treasury: input.treasury,
    lane: MARKET_V8_LANES.SOUL,
    lifecycle: input.lifecycle,
    grossAtomic: input.grossAtomic,
    expectedRegistryRevision: input.expectedRegistryRevision,
  });
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(types, eligible.registry, input);
  const protocolConfig = protocolObject(types, eligible.registry, input.protocolConfig);
  return compileAction(runtime, 'listSoulBundle', MARKET_V8_LANES.SOUL, wallet, [
    argObject('registry', market.registry),
    argObject('treasury', market.treasury),
    argObject('outputRegistry', typedObject(input.outputRegistry, types.outputRegistry, 'outputRegistry')),
    argObject('soulRegistry', typedObject(input.soulRegistry, types.soulRegistry, 'soulRegistry')),
    argObject('root', common.root),
    argObject('protocolConfig', protocolConfig),
    argObject('catalog', common.catalog),
    argObject('config', common.config),
    argObject('outputAsset', typedObject(input.outputAsset, types.completeOutput, 'outputAsset')),
    argObject('receipt', typedObject(input.receipt, types.completeReceipt, 'receipt')),
    argObject('soul', typedObject(input.soul, types.canonicalSoul, 'soul')),
    argU64('grossAtomic', eligible.quote.grossAtomic),
  ]);
}

function soulObjects(setup, input) {
  const custody = setup.eligible.listing.fields.custody;
  return {
    outputRegistry: typedObject(input.outputRegistry, setup.types.outputRegistry, 'outputRegistry', { expectedId: custody.outputRegistryId }),
    soulRegistry: typedObject(input.soulRegistry, setup.types.soulRegistry, 'soulRegistry', { expectedId: custody.soulRegistryId }),
    outputReceiving: exactRef(input.outputReceiving, setup.types.completeOutput, 'outputReceiving', custody.outputId),
    receiptReceiving: exactRef(input.receiptReceiving, setup.types.completeReceipt, 'receiptReceiving', custody.receiptId),
    soulReceiving: exactRef(input.soulReceiving, setup.types.canonicalSoul, 'soulReceiving', custody.soulId),
  };
}

export function buildPurchaseSoulBundleV8(runtimeInput, input) {
  const setup = purchaseSetup(runtimeInput, input, MARKET_V8_LANES.SOUL);
  const soul = soulObjects(setup, input);
  const protocolConfig = protocolObject(setup.types, setup.eligible.registry, input.protocolConfig);
  const payment = exactRef(input.payment, setup.types.paymentCoin, 'payment', undefined, { paymentAtomic: setup.eligible.quote.grossAtomic });
  return compileAction(setup.runtime, 'purchaseSoulBundle', MARKET_V8_LANES.SOUL, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('outputRegistry', soul.outputRegistry),
    argObject('soulRegistry', soul.soulRegistry),
    argObject('root', setup.common.root),
    argObject('makerTreasury', typedObject(input.makerTreasury, setup.types.makerTreasury, 'makerTreasury')),
    argObject('protocolConfig', protocolConfig),
    argObject('protocolTreasury', typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury')),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('outputReceiving', soul.outputReceiving),
    argReceiving('receiptReceiving', soul.receiptReceiving),
    argReceiving('soulReceiving', soul.soulReceiving),
    argPayment('payment', payment),
  ], input.expectation);
}

export function buildCancelSoulListingV8(runtimeInput, input) {
  const setup = cancelSetup(runtimeInput, input, MARKET_V8_LANES.SOUL);
  const soul = soulObjects(setup, input);
  return compileAction(setup.runtime, 'cancelSoulListing', MARKET_V8_LANES.SOUL, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('outputRegistry', soul.outputRegistry),
    argObject('soulRegistry', soul.soulRegistry),
    argObject('root', setup.common.root),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('outputReceiving', soul.outputReceiving),
    argReceiving('receiptReceiving', soul.receiptReceiving),
    argReceiving('soulReceiving', soul.soulReceiving),
  ], input.expectation);
}

export function buildRecoverSoulListingV8(runtimeInput, input) {
  const setup = recoverySetup(runtimeInput, input, MARKET_V8_LANES.SOUL);
  const soul = soulObjects(setup, input);
  const protocolConfig = protocolObject(setup.types, setup.eligible.registry, input.protocolConfig);
  return compileAction(setup.runtime, 'recoverSoulListing', MARKET_V8_LANES.SOUL, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('outputRegistry', soul.outputRegistry),
    argObject('soulRegistry', soul.soulRegistry),
    argObject('root', setup.common.root),
    argObject('protocolConfig', protocolConfig),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('outputReceiving', soul.outputReceiving),
    argReceiving('receiptReceiving', soul.receiptReceiving),
    argReceiving('soulReceiving', soul.soulReceiving),
  ], input.expectation);
}

function listPhysical(runtimeInput, input, lane) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const types = marketV8Types(runtime);
  const wallet = assertMarketV8WalletContext(runtime, input.wallet);
  const eligible = assertMarketListEligibilityV8({
    registry: input.registry,
    treasury: input.treasury,
    lane,
    lifecycle: input.lifecycle,
    grossAtomic: input.grossAtomic,
    expectedRegistryRevision: input.expectedRegistryRevision,
  });
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(types, eligible.registry, input);
  const sourceTreasuryType = lane === MARKET_V8_LANES.PHYSICAL_BASE ? types.makerTreasury : types.packTreasury;
  const sourceTreasuryName = lane === MARKET_V8_LANES.PHYSICAL_BASE ? 'makerTreasury' : 'packTreasury';
  const sourceTreasury = typedObject(input[sourceTreasuryName], sourceTreasuryType, sourceTreasuryName);
  const asset = typedObject(input.asset, types.physicalAsset, 'asset');
  requireSource(input.asset, lane === MARKET_V8_LANES.PHYSICAL_BASE ? MARKET_V8_PHYSICAL_SOURCES.BASE : MARKET_V8_PHYSICAL_SOURCES.PACK, sourceTreasury.objectId, 'asset');
  const action = lane === MARKET_V8_LANES.PHYSICAL_BASE ? 'listBasePhysical' : 'listPackPhysical';
  return compileAction(runtime, action, lane, wallet, [
    argObject('registry', market.registry),
    argObject('treasury', market.treasury),
    argObject('physicalRegistry', typedObject(input.physicalRegistry, types.physicalRegistry, 'physicalRegistry')),
    argObject('root', common.root),
    argObject(sourceTreasuryName, sourceTreasury),
    argObject('protocolConfig', protocolObject(types, eligible.registry, input.protocolConfig)),
    argObject('catalog', common.catalog),
    argObject('physicalConfig', typedObject(input.physicalConfig, types.physicalConfig, 'physicalConfig')),
    argObject('config', common.config),
    argObject('asset', asset),
    argU64('grossAtomic', eligible.quote.grossAtomic),
  ]);
}

export function buildListBasePhysicalV8(runtime, input) {
  return listPhysical(runtime, input, MARKET_V8_LANES.PHYSICAL_BASE);
}

export function buildListPackPhysicalV8(runtime, input) {
  return listPhysical(runtime, input, MARKET_V8_LANES.PHYSICAL_PACK);
}

function physicalObjects(setup, input) {
  const custody = setup.eligible.listing.fields.custody;
  return {
    physicalRegistry: typedObject(input.physicalRegistry, setup.types.physicalRegistry, 'physicalRegistry', { expectedId: custody.physicalRegistryId }),
    physicalConfig: typedObject(input.physicalConfig, setup.types.physicalConfig, 'physicalConfig', { expectedId: custody.physicalPackageConfigId }),
    receiving: exactRef(input.receiving, setup.types.physicalAsset, 'receiving', custody.assetId),
  };
}

function purchasePhysical(runtimeInput, input, lane) {
  const setup = purchaseSetup(runtimeInput, input, lane);
  const physical = physicalObjects(setup, input);
  const custody = setup.eligible.listing.fields.custody;
  const payment = exactRef(input.payment, setup.types.paymentCoin, 'payment', undefined, { paymentAtomic: setup.eligible.quote.grossAtomic });
  const protocolConfig = protocolObject(setup.types, setup.eligible.registry, input.protocolConfig);
  const prefix = [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('physicalRegistry', physical.physicalRegistry),
    argObject('root', setup.common.root),
  ];
  let args;
  let action;
  if (lane === MARKET_V8_LANES.PHYSICAL_BASE) {
    action = 'purchaseBasePhysical';
    const makerTreasury = typedObject(input.makerTreasury, setup.types.makerTreasury, 'makerTreasury', { expectedId: custody.sourceTreasuryId });
    args = [
      ...prefix,
      argObject('makerTreasury', makerTreasury),
      argObject('protocolConfig', protocolConfig),
      argObject('protocolTreasury', typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury')),
      argObject('catalog', setup.common.catalog),
      argObject('physicalConfig', physical.physicalConfig),
      argObject('config', setup.common.config),
      argReceiving('receiving', physical.receiving),
      argPayment('payment', payment),
    ];
  } else {
    action = 'purchasePackPhysical';
    const packTreasury = typedObject(input.packTreasury, setup.types.packTreasury, 'packTreasury', { expectedId: custody.sourceTreasuryId });
    args = [
      ...prefix,
      argObject('packRelease', typedObject(input.packRelease, setup.types.packRelease, 'packRelease', { expectedId: custody.sourceId })),
      argObject('packTreasury', packTreasury),
      argObject('protocolConfig', protocolConfig),
      argObject('protocolTreasury', typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury')),
      argObject('catalog', setup.common.catalog),
      argObject('physicalConfig', physical.physicalConfig),
      argObject('config', setup.common.config),
      argReceiving('receiving', physical.receiving),
      argPayment('payment', payment),
    ];
  }
  return compileAction(setup.runtime, action, lane, setup.wallet, args, input.expectation);
}

export function buildPurchaseBasePhysicalV8(runtime, input) {
  return purchasePhysical(runtime, input, MARKET_V8_LANES.PHYSICAL_BASE);
}

export function buildPurchasePackPhysicalV8(runtime, input) {
  return purchasePhysical(runtime, input, MARKET_V8_LANES.PHYSICAL_PACK);
}

export function buildCancelPhysicalListingV8(runtimeInput, input) {
  const listing = assertListing(input.listing, ['PhysicalListingV8']);
  const lane = listing.fields.custody.sourceKind === MARKET_V8_PHYSICAL_SOURCES.BASE
    ? MARKET_V8_LANES.PHYSICAL_BASE
    : MARKET_V8_LANES.PHYSICAL_PACK;
  const setup = cancelSetup(runtimeInput, input, lane);
  const physical = physicalObjects(setup, input);
  return compileAction(setup.runtime, 'cancelPhysicalListing', lane, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('physicalRegistry', physical.physicalRegistry),
    argObject('root', setup.common.root),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('receiving', physical.receiving),
  ], input.expectation);
}

export function buildRecoverPhysicalListingV8(runtimeInput, input) {
  const listing = assertListing(input.listing, ['PhysicalListingV8']);
  const lane = listing.fields.custody.sourceKind === MARKET_V8_PHYSICAL_SOURCES.BASE
    ? MARKET_V8_LANES.PHYSICAL_BASE
    : MARKET_V8_LANES.PHYSICAL_PACK;
  const setup = recoverySetup(runtimeInput, input, lane);
  const physical = physicalObjects(setup, input);
  return compileAction(setup.runtime, 'recoverPhysicalListing', lane, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('physicalRegistry', physical.physicalRegistry),
    argObject('root', setup.common.root),
    argObject('protocolConfig', protocolObject(setup.types, setup.eligible.registry, input.protocolConfig)),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('receiving', physical.receiving),
  ], input.expectation);
}

export function createMarketV8Client(runtimeInput, options) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  assertExactKeys(options, ['network'], 'options', MarketV8RuntimeError);
  const network = networkName(options.network, 'options.network', MarketV8RuntimeError);
  const types = marketV8Types(runtime);
  return freezeRecord({
    runtime,
    network,
    types,
    parseRegistry: (input) => parseMarketRegistryV8(input, runtime, network),
    parseTreasury: (input) => parseMarketTreasuryV8(input, runtime, network),
    parseMakerListing: (input) => parseMakerListingV8(input, runtime, network),
    parseSoulListing: (input) => parseSoulListingV8(input, runtime, network),
    parsePhysicalListing: (input) => parsePhysicalListingV8(input, runtime, network),
    parseEvent: (input) => parseMarketEventV8(input, runtime, network),
    quoteMakerResale: (registry, grossAtomic) => quoteMakerResaleV8(registry, grossAtomic),
    quoteSoulResale: (registry, grossAtomic) => quoteSoulResaleV8(registry, grossAtomic),
    quotePhysicalResale: (registry, grossAtomic) => quotePhysicalResaleV8(registry, grossAtomic),
    buildListMakerControl: (input) => buildListMakerControlV8(runtime, input),
    buildPurchaseMakerControl: (input) => buildPurchaseMakerControlV8(runtime, input),
    buildCancelMakerControl: (input) => buildCancelMakerControlV8(runtime, input),
    buildRecoverMakerControl: (input) => buildRecoverMakerControlV8(runtime, input),
    buildListSoulBundle: (input) => buildListSoulBundleV8(runtime, input),
    buildPurchaseSoulBundle: (input) => buildPurchaseSoulBundleV8(runtime, input),
    buildCancelSoulListing: (input) => buildCancelSoulListingV8(runtime, input),
    buildRecoverSoulListing: (input) => buildRecoverSoulListingV8(runtime, input),
    buildListBasePhysical: (input) => buildListBasePhysicalV8(runtime, input),
    buildListPackPhysical: (input) => buildListPackPhysicalV8(runtime, input),
    buildPurchaseBasePhysical: (input) => buildPurchaseBasePhysicalV8(runtime, input),
    buildPurchasePackPhysical: (input) => buildPurchasePackPhysicalV8(runtime, input),
    buildCancelPhysicalListing: (input) => buildCancelPhysicalListingV8(runtime, input),
    buildRecoverPhysicalListing: (input) => buildRecoverPhysicalListingV8(runtime, input),
  });
}
