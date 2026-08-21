import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58,
  fromBase64,
  isValidStructTag,
  normalizeStructTag,
  normalizeSuiAddress,
  normalizeSuiObjectId,
  toBase64,
} from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';
import {
  assertMakerV8MainnetRpc,
  isMakerV8RuntimeAttested,
} from './maker-v8-chain.js';

export const MARKET_V8_VERSION = 8n;
export const MARKET_V8_ACTION_SCHEMA = 'animacraft.market-action.v8';
export const MARKET_V8_QUOTE_DOMAIN = 'animacraft-v8/market/quote';
export const MARKET_V8_MAX_TRANSACTION_BYTES = 128 * 1024;
export const MARKET_V8_MAX_GAS_BUDGET = 500_000_000n;

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
const PARSED_MARKET_VALUES = new WeakSet();

const ORIGIN_KEYS = Object.freeze([
  'corePackageId',
  'marketPackageId',
  'outputPackageId',
  'physicalPackageId',
  'runtimePackageId',
]);
const MARKET_V8_NETWORK = 'mainnet';
const CHECKED_MARKET_RUNTIMES = new WeakSet();
const CHAIN_QUOTE_PROOFS = new WeakSet();
const BUILT_MARKET_ACTIONS = new WeakSet();
const MARKET_RECOVERY_EVIDENCE = new WeakSet();
const MARKET_ACTION_DRY_RUN_PROOFS = new WeakSet();

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
  if (CHECKED_MARKET_RUNTIMES.has(runtime)) return runtime;
  let checked;
  try {
    // Runtime attestation is an object-identity trust anchor.  Re-normalizing an
    // attested runtime would silently drop its private chain-readback brand.
    checked = isMakerV8RuntimeAttested(runtime) ? runtime : assertMakerV8Runtime(runtime);
  } catch (error) {
    fail(
      MarketV8RuntimeError,
      error?.code || 'MARKET_V8_RUNTIME_INVALID',
      error?.issues?.[0]?.field || 'runtime',
      error?.message || 'The strict seven-role Maker v8 runtime is invalid.',
      { cause: error },
    );
  }
  const origins = freezeRecord({
    corePackageId: exactPackageId(checked.roles.core.typeOriginPackageId, 'runtime.roles.core.typeOriginPackageId'),
    marketPackageId: exactPackageId(checked.roles.market.typeOriginPackageId, 'runtime.roles.market.typeOriginPackageId'),
    outputPackageId: exactPackageId(checked.roles.output.typeOriginPackageId, 'runtime.roles.output.typeOriginPackageId'),
    physicalPackageId: exactPackageId(checked.roles.physical.typeOriginPackageId, 'runtime.roles.physical.typeOriginPackageId'),
    runtimePackageId: exactPackageId(checked.roles.runtime.typeOriginPackageId, 'runtime.roles.runtime.typeOriginPackageId'),
  });
  const normalized = freezeRecord({
    callablePackageId: exactPackageId(checked.roles.market.callablePackageId, 'runtime.roles.market.callablePackageId'),
    paymentCoinType: canonicalStructType(checked.paymentCoinType, 'runtime.paymentCoinType'),
    typeOrigins: origins,
    sourceRuntime: checked,
  });
  CHECKED_MARKET_RUNTIMES.add(normalized);
  return normalized;
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
  const parsed = Object.freeze({
    kind,
    network,
    objectId: base.objectId,
    type: base.type,
    objectVersion: base.objectVersion,
    digest: base.digest,
    fields: freezeRecord(fields),
  });
  PARSED_MARKET_VALUES.add(parsed);
  return parsed;
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
  const checkedRuntime = assertMarketV8Runtime(runtime);
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
  const pinned = checkedRuntime.sourceRuntime;
  for (const [field, observed, expected] of [
    ['catalog_id', fields.catalogId, pinned.catalogId],
    ['package_config_id', fields.packageConfigId, pinned.roleConfigIds.market],
    ['protocol_config_id', fields.protocolConfigId, pinned.protocolConfigId],
  ]) {
    if (observed !== expected) {
      fail(
        MarketV8ParseError,
        'MARKET_V8_RUNTIME_BINDING_MISMATCH',
        `MarketRegistryV8.${field}`,
        `${field} does not match the catalog/config identity pinned by the attested seven-role runtime.`,
        { observed, expected },
      );
    }
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
  const checkedRuntime = assertMarketV8Runtime(runtime);
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
  if (fields.catalogId !== checkedRuntime.sourceRuntime.catalogId
    || fields.packageConfigId !== checkedRuntime.sourceRuntime.roleConfigIds.market) {
    fail(
      MarketV8ParseError,
      'MARKET_V8_RUNTIME_BINDING_MISMATCH',
      'MarketTreasuryV8',
      'Market treasury does not match the catalog and Market config pinned by the attested runtime.',
    );
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

const MARKET_QUOTE_BCS = bcs.struct('MarketQuoteV8', {
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
  commitment: bcs.vector(bcs.u8()),
});

function assertRegistry(value) {
  if (!value || !PARSED_MARKET_VALUES.has(value) || value.kind !== 'MarketRegistryV8') {
    fail(MarketV8ParseError, 'MARKET_V8_PARSED_REGISTRY_REQUIRED', 'registry', 'A parsed MarketRegistryV8 is required.');
  }
  return value;
}

function assertTreasury(value) {
  if (!value || !PARSED_MARKET_VALUES.has(value) || value.kind !== 'MarketTreasuryV8') {
    fail(MarketV8ParseError, 'MARKET_V8_PARSED_TREASURY_REQUIRED', 'treasury', 'A parsed MarketTreasuryV8 is required.');
  }
  return value;
}

function assertListing(value, kinds) {
  if (!value || !PARSED_MARKET_VALUES.has(value) || !kinds.includes(value.kind)) {
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

export function parseMarketQuoteV8Bcs(input) {
  let raw;
  if (input instanceof Uint8Array) raw = input;
  else if (Array.isArray(input) && input.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    raw = Uint8Array.from(input);
  } else if (typeof input === 'string') {
    try {
      raw = fromBase64(input);
    } catch {
      fail(MarketV8ParseError, 'MARKET_V8_QUOTE_BCS_INVALID', 'quoteBcs', 'Market quote BCS must be bytes or canonical base64.');
    }
  } else {
    fail(MarketV8ParseError, 'MARKET_V8_QUOTE_BCS_INVALID', 'quoteBcs', 'Market quote BCS must be bytes or canonical base64.');
  }
  let parsed;
  try {
    parsed = MARKET_QUOTE_BCS.parse(raw);
  } catch (cause) {
    fail(MarketV8ParseError, 'MARKET_V8_QUOTE_BCS_INVALID', 'quoteBcs', 'MarketQuoteV8 BCS could not be decoded.', { cause });
  }
  const quote = freezeRecord({
    version: MARKET_V8_VERSION,
    quoteKind: Number(enumUint(parsed.quote_kind, 8, 'quote.quoteKind')),
    rootId: objectId(parsed.root_id, 'quote.rootId'),
    makerVersion: uint(parsed.maker_version, 64, 'quote.makerVersion'),
    rootContentCommitment: commitment(bytesToHex(parsed.root_content_commitment), 'quote.rootContentCommitment'),
    economicsCommitment: commitment(bytesToHex(parsed.economics_commitment), 'quote.economicsCommitment'),
    rightsCommitment: commitment(bytesToHex(parsed.rights_commitment), 'quote.rightsCommitment'),
    grossAtomic: uint(parsed.gross_atomic, 64, 'quote.grossAtomic'),
    protocolAtomic: uint(parsed.protocol_atomic, 64, 'quote.protocolAtomic'),
    creatorAtomic: uint(parsed.creator_atomic, 64, 'quote.creatorAtomic'),
    sourceAtomic: uint(parsed.source_atomic, 64, 'quote.sourceAtomic'),
    sellerAtomic: uint(parsed.seller_atomic, 64, 'quote.sellerAtomic'),
    commitment: commitment(bytesToHex(parsed.commitment), 'quote.commitment'),
  });
  if (!Object.values(MARKET_V8_QUOTE_KINDS).includes(quote.quoteKind)) {
    fail(MarketV8ParseError, 'MARKET_V8_QUOTE_KIND_INVALID', 'quote.quoteKind', 'Quote kind is unknown.');
  }
  if (deriveMarketQuoteCommitmentV8(quote) !== quote.commitment) {
    fail(MarketV8ParseError, 'MARKET_V8_QUOTE_COMMITMENT_MISMATCH', 'quote.commitment', 'On-chain quote commitment does not match its exact BCS fields.');
  }
  return quote;
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

function observedRootLifecycle(root) {
  if (!root || typeof root !== 'object' || !hasOwn(root, 'lifecycleCode')) {
    fail(MarketV8EligibilityError, 'MARKET_V8_VERIFIED_ROOT_REQUIRED', 'root.lifecycleCode', 'A lifecycle from verified Root readback is required.');
  }
  if (Number.isInteger(root.lifecycleCode) && root.lifecycleCode >= 0 && root.lifecycleCode <= 255) {
    return root.lifecycleCode;
  }
  return Number(uint(root.lifecycleCode, 8, 'root.lifecycleCode', MarketV8EligibilityError));
}

function protocolDegraded(registry, protocolConfig) {
  if (!protocolConfig || typeof protocolConfig !== 'object'
    || !hasOwn(protocolConfig, 'enabled') || !hasOwn(protocolConfig, 'revision')
    || !hasOwn(protocolConfig, 'commitment')) {
    fail(MarketV8EligibilityError, 'MARKET_V8_VERIFIED_PROTOCOL_REQUIRED', 'protocolConfig', 'Verified ProtocolConfig readback state is required.');
  }
  if (typeof protocolConfig.enabled !== 'boolean') {
    fail(MarketV8EligibilityError, 'MARKET_V8_PROTOCOL_STATE_INVALID', 'protocolConfig.enabled', 'Protocol enabled must be boolean.');
  }
  const revision = uint(protocolConfig.revision, 64, 'protocolConfig.revision', MarketV8EligibilityError);
  const commitmentValue = exactExpectedCommitment(protocolConfig.commitment, 'protocolConfig.commitment');
  return !protocolConfig.enabled
    || revision !== registry.fields.protocolConfigRevision
    || commitmentValue !== registry.fields.protocolConfigCommitment;
}

export function assertMarketRecoveryEligibilityV8({
  listing: listingInput,
  registry: registryInput,
  treasury: treasuryInput,
  lane,
  root,
  protocolConfig,
  expectation,
}) {
  const listing = assertListing(listingInput, ['MakerListingV8', 'SoulListingV8', 'PhysicalListingV8']);
  const { registry, treasury } = assertMarketPairV8(registryInput, treasuryInput);
  assertOpenListing(listing);
  assertLane(listing, lane);
  assertListingBinding(listing, registry, treasury);
  assertSnapshot(listing, registry, expectation);
  const lifecycleValue = observedRootLifecycle(root);
  const degraded = protocolDegraded(registry, protocolConfig);
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

function exactRef(value, expectedType, field, expectedId) {
  const checked = typedObject(value, expectedType, field, { expectedId });
  const version = uint(value.version, 64, `${field}.version`, MarketV8BuildError);
  const digest = digestValue(value.digest, `${field}.digest`);
  return freezeRecord({ ...checked, version, digest });
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
  if (source === null || (Array.isArray(source) && source.length === 0)
    || (plainRecord(source) && Array.isArray(source.vec) && source.vec.length === 0)) return null;
  if (Array.isArray(source)) {
    if (source.length !== 1) fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_INVALID', `${field}.sourceTreasuryId`, 'Physical source treasury Option is malformed.');
    [source] = source;
  } else if (plainRecord(source) && Array.isArray(source.vec)) {
    if (source.vec.length !== 1) fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_INVALID', `${field}.sourceTreasuryId`, 'Physical source treasury Option is malformed.');
    [source] = source.vec;
  }
  return buildId(source, `${field}.sourceTreasuryId`);
}

function requireSource(value, expectedKind, treasuryId, rootInput, field) {
  const actualKind = sourceKind(value, field);
  if (actualKind !== expectedKind) {
    fail(MarketV8BuildError, 'MARKET_V8_CROSS_SOURCE', `${field}.sourceKind`, 'Physical asset belongs to the other static source lane.');
  }
  const actualTreasury = expectedSourceTreasury(value, field);
  if (expectedKind === MARKET_V8_PHYSICAL_SOURCES.BASE) {
    if (actualTreasury !== null) {
      fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_MISMATCH', `${field}.sourceTreasuryId`, 'Base Physical provenance must have no source treasury.');
    }
    const boundMakerTreasury = rootInput?.binding?.makerTreasuryId;
    if (typeof boundMakerTreasury !== 'string') {
      fail(MarketV8BuildError, 'MARKET_V8_VERIFIED_ROOT_BINDING_REQUIRED', 'root.binding.makerTreasuryId', 'Base Physical listing requires the MakerTreasury ID from a verified Root readback.');
    }
    if (buildId(boundMakerTreasury, 'root.binding.makerTreasuryId') !== treasuryId) {
      fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_MISMATCH', 'makerTreasury.objectId', 'Selected MakerTreasury does not match the verified Root binding.');
    }
  } else if (actualTreasury !== treasuryId) {
    fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_MISMATCH', `${field}.sourceTreasuryId`, 'Physical source treasury does not match the selected lane treasury.');
  }
}

function argObject(name, checked) {
  return freezeRecord({ kind: 'object', name, ...checked });
}

function argReceiving(name, checked) {
  return freezeRecord({ kind: 'receiving', name, ...checked });
}

function argPayment(name, type, network, balanceAtomic) {
  return freezeRecord({ kind: 'payment', name, type, network, balanceAtomic });
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
    if (arg.kind === 'payment') return transaction.coin({ type: arg.type, balance: arg.balanceAtomic });
    return transaction.object(arg.objectId);
  });
  const target = `${runtime.callablePackageId}::market_v8::${abi.function}`;
  transaction.moveCall({ target, typeArguments: [runtime.paymentCoinType], arguments: transactionArguments });
  const registryArgument = args.find((argument) => argument.name === 'registry');
  const treasuryArgument = args.find((argument) => argument.name === 'treasury');
  const rootArgument = args.find((argument) => argument.name === 'root');
  const descriptorArgs = Object.freeze(args.map((arg) => freezeRecord({
    kind: arg.kind,
    name: arg.name,
    ...(arg.objectId ? { objectId: arg.objectId, type: arg.type } : {}),
    ...(!arg.objectId && arg.type ? { type: arg.type } : {}),
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
    catalogId: runtime.sourceRuntime.catalogId,
    protocolConfigId: runtime.sourceRuntime.protocolConfigId,
    protocolTreasuryId: runtime.sourceRuntime.protocolTreasuryId,
    rootId: rootArgument?.objectId,
    registryId: registryArgument?.objectId,
    treasuryId: treasuryArgument?.objectId,
    rootContentCommitment: registryArgument?.source?.fields?.rootContentCommitment,
    protocolRevision: registryArgument?.source?.fields?.protocolConfigRevision?.toString(),
    roleConfigIds: freezeRecord({ ...runtime.sourceRuntime.roleConfigIds }),
    packageTuple: Object.freeze(Object.entries(runtime.sourceRuntime.roles).map(([role, identity]) => freezeRecord({
      role,
      originalPackageId: identity.typeOriginPackageId,
      callablePackageId: identity.callablePackageId,
    }))),
    arguments: descriptorArgs,
    ...(expectation ? { expectation: freezeRecord({
      listingRevision: String(expectation.listingRevision),
      registryRevision: String(expectation.registryRevision),
      quoteCommitment: expectation.quoteCommitment,
    }) } : {}),
  });
  const built = freezeRecord({ descriptor, transaction, runtime: runtime.sourceRuntime });
  BUILT_MARKET_ACTIONS.add(built);
  return built;
}

export function assertMarketV8BuiltActionV8(value) {
  if (!value || !BUILT_MARKET_ACTIONS.has(value)) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_BUILT_ACTION_REQUIRED',
      'builtAction',
      'Only an action produced by the strict Market v8 Transaction builder may enter signing recovery.',
    );
  }
  return value;
}

function canonicalTransactionFromDescriptor(builtAction) {
  const descriptor = builtAction.descriptor;
  const transaction = new Transaction();
  transaction.setSender(descriptor.sender);
  const args = descriptor.arguments.map((argument) => {
    if (argument.kind === 'u64') return transaction.pure.u64(BigInt(argument.value));
    if (argument.kind === 'receiving') {
      return transaction.receivingRef({
        objectId: argument.objectId,
        version: argument.version,
        digest: argument.digest,
      });
    }
    if (argument.kind === 'payment') {
      return transaction.coin({ type: argument.type, balance: BigInt(argument.balanceAtomic) });
    }
    return transaction.object(argument.objectId);
  });
  transaction.moveCall({
    target: descriptor.target,
    typeArguments: [...descriptor.typeArguments],
    arguments: args,
  });
  return transaction;
}

function transactionObjectIdentity(input, field) {
  const object = input?.Object;
  const value = object?.ImmOrOwnedObject ?? object?.SharedObject ?? object?.Receiving;
  if (!value || typeof value.objectId !== 'string') {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_OBJECT_INVALID', field, `${field} is not an exact TransactionData object input.`);
  }
  return {
    objectId: buildId(value.objectId, `${field}.objectId`),
    kind: object?.$kind,
    version: value.version === undefined ? null : String(value.version),
    digest: value.digest ?? null,
  };
}

function u64PureBytes(value) {
  let remaining = uint(value, 64, 'transaction.u64', MarketV8BuildError);
  const raw = new Uint8Array(8);
  for (let index = 0; index < raw.length; index += 1) {
    raw[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return toBase64(raw);
}

function inputArgumentIndex(argument, field) {
  if (argument?.$kind !== 'Input' || !Number.isInteger(argument.Input) || argument.Input < 0) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_ARGUMENT_INVALID', field, `${field} must reference the exact declared TransactionData input.`);
  }
  return argument.Input;
}

function assertEncodedMarketArgument(snapshot, command, descriptor, index) {
  const expected = descriptor.arguments[index];
  const argument = command.arguments[index];
  const field = `transaction.arguments.${expected.name}`;
  if (expected.kind === 'payment') {
    if (argument?.$kind !== 'NestedResult' || !Array.isArray(argument.NestedResult)) {
      fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_PAYMENT_INVALID', field, 'Exact payment must be the result of the SDK CoinWithBalance split.');
    }
    const [commandIndex, resultIndex] = argument.NestedResult;
    const split = snapshot.commands[commandIndex]?.SplitCoins;
    if (!split || !Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex >= split.amounts.length) {
      fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_PAYMENT_INVALID', field, 'Exact payment does not reference a valid CoinWithBalance split result.');
    }
    const amountInput = snapshot.inputs[inputArgumentIndex(split.amounts[resultIndex], `${field}.amount`)];
    if (amountInput?.Pure?.bytes !== u64PureBytes(expected.balanceAtomic)) {
      fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_PAYMENT_AMOUNT_MISMATCH', field, 'Encoded payment split is not the reviewed exact gross amount.');
    }
    return;
  }
  const input = snapshot.inputs[inputArgumentIndex(argument, field)];
  if (expected.kind === 'u64') {
    if (input?.Pure?.bytes !== u64PureBytes(expected.value)) {
      fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_PURE_MISMATCH', field, 'Encoded u64 differs from the verified builder descriptor.');
    }
    return;
  }
  const observed = transactionObjectIdentity(input, field);
  if (observed.objectId !== expected.objectId) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_OBJECT_MISMATCH', field, 'Encoded object ID differs from the verified builder descriptor.');
  }
  if (expected.kind === 'receiving') {
    if (observed.kind !== 'Receiving'
      || observed.version !== expected.version
      || observed.digest !== expected.digest) {
      fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_RECEIVING_MISMATCH', field, 'Encoded Receiving reference differs from the verified child object ref.');
    }
  } else if (observed.kind === 'Receiving') {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_OBJECT_KIND_MISMATCH', field, 'A normal object argument was replaced with Receiving.');
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('canonical JSON contains a non-integer number');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON contains an unsupported value');
}

function fingerprint(value) {
  return bytesToHex(sha256(UTF8.encode(canonicalJson(value))));
}

async function currentMainnetEpoch(client) {
  let response;
  if (typeof client?.core?.getCurrentSystemState === 'function') {
    response = await client.core.getCurrentSystemState();
    response = response?.systemState?.epoch;
  } else if (typeof client?.getLatestSuiSystemState === 'function') {
    response = (await client.getLatestSuiSystemState())?.epoch;
  } else if (typeof client?.getCurrentEpoch === 'function') {
    response = (await client.getCurrentEpoch())?.epoch;
  } else {
    fail(
      MarketV8BuildError,
      'MARKET_V8_CURRENT_EPOCH_UNAVAILABLE',
      'client',
      'A Mainnet current-epoch read is required to bind Transaction expiration immediately before signing.',
    );
  }
  const epoch = uint(String(response ?? ''), 64, 'currentEpoch', MarketV8BuildError);
  if (epoch === ((1n << 64n) - 1n)) {
    fail(MarketV8BuildError, 'MARKET_V8_CURRENT_EPOCH_INVALID', 'currentEpoch', 'Current epoch cannot produce a bounded signing expiration.');
  }
  return epoch;
}

function canonicalGasData(snapshot, descriptor) {
  const budget = uint(String(snapshot.gasData?.budget ?? ''), 64, 'transaction.gasData.budget', MarketV8BuildError);
  const price = uint(String(snapshot.gasData?.price ?? ''), 64, 'transaction.gasData.price', MarketV8BuildError);
  if (budget === 0n || budget > MARKET_V8_MAX_GAS_BUDGET || price === 0n) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_TRANSACTION_GAS_INVALID',
      'transaction.gasData',
      `Gas budget must be positive and no greater than ${MARKET_V8_MAX_GAS_BUDGET}; gas price must be positive.`,
    );
  }
  const owner = buildAddress(snapshot.gasData?.owner, 'transaction.gasData.owner');
  if (owner !== descriptor.sender) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_SENDER_MISMATCH', 'transaction.gasData.owner', 'Gas owner differs from the verified wallet account.');
  }
  if (!Array.isArray(snapshot.gasData?.payment) || snapshot.gasData.payment.length === 0) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_GAS_INVALID', 'transaction.gasData.payment', 'At least one resolved gas object ref is required.');
  }
  const seen = new Set();
  const payment = Object.freeze(snapshot.gasData.payment.map((entry, index) => {
    const objectIdValue = buildId(entry?.objectId, `transaction.gasData.payment[${index}].objectId`);
    if (seen.has(objectIdValue)) {
      fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_GAS_INVALID', `transaction.gasData.payment[${index}]`, 'Gas payment refs must be unique.');
    }
    seen.add(objectIdValue);
    return freezeRecord({
      objectId: objectIdValue,
      version: uint(String(entry?.version ?? ''), 64, `transaction.gasData.payment[${index}].version`, MarketV8BuildError).toString(),
      digest: digestValue(entry?.digest, `transaction.gasData.payment[${index}].digest`, MarketV8BuildError),
    });
  }));
  return freezeRecord({ owner, budget: budget.toString(), price: price.toString(), payment });
}

function validateCanonicalMarketV8TransactionBytes(builtActionInput, transactionBytesInput, expectedEpoch) {
  const builtAction = assertMarketV8BuiltActionV8(builtActionInput);
  if (!isMakerV8RuntimeAttested(builtAction.runtime)) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_RUNTIME_ATTESTATION_REQUIRED',
      'runtime',
      'Signing recovery requires the Mainnet ProductReleaseCatalog and all six companion configs to be read back and attested.',
    );
  }
  if (typeof transactionBytesInput !== 'string' || transactionBytesInput.length < 8) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_BYTES_INVALID', 'transactionBytes', 'Built TransactionData bytes must be canonical base64.');
  }
  let bytes;
  let snapshot;
  try {
    bytes = fromBase64(transactionBytesInput);
    if (toBase64(bytes) !== transactionBytesInput) throw new TypeError('non-canonical base64');
    if (bytes.length > MARKET_V8_MAX_TRANSACTION_BYTES) throw new TypeError('transaction exceeds the bounded signing payload size');
    snapshot = TransactionDataBuilder.fromBytes(bytes).snapshot();
  } catch (error) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_TRANSACTION_BYTES_INVALID',
      'transactionBytes',
      'Built TransactionData bytes are not a canonical programmable Sui transaction.',
      { cause: String(error?.message || error) },
    );
  }
  const descriptor = builtAction.descriptor;
  if (snapshot.sender !== descriptor.sender) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_SENDER_MISMATCH', 'transaction.sender', 'Transaction sender differs from the verified wallet account.');
  }
  const expirationEpoch = uint(String(snapshot.expiration?.Epoch ?? ''), 64, 'transaction.expiration.Epoch', MarketV8BuildError);
  if (expirationEpoch !== expectedEpoch + 1n) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_EXPIRATION_MISMATCH', 'transaction.expiration', 'Transaction must expire exactly one epoch after the freshly read Mainnet epoch.');
  }
  const gasData = canonicalGasData(snapshot, descriptor);
  const [expectedPackage, expectedModule, expectedFunction] = descriptor.target.split('::');
  const marketCalls = snapshot.commands.filter((entry) => entry?.MoveCall
    && entry.MoveCall.package === expectedPackage
    && entry.MoveCall.module === expectedModule
    && entry.MoveCall.function === expectedFunction);
  if (marketCalls.length !== 1) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_TARGET_MISMATCH', 'transaction.commands', 'Transaction must contain exactly one verified Market action call.');
  }
  const marketCall = marketCalls[0].MoveCall;
  if (marketCall.typeArguments.length !== descriptor.typeArguments.length
    || marketCall.typeArguments.some((type, index) => type !== descriptor.typeArguments[index])
    || marketCall.arguments.length !== descriptor.arguments.length) {
    fail(MarketV8BuildError, 'MARKET_V8_TRANSACTION_ABI_MISMATCH', 'transaction.moveCall', 'Transaction type arguments or argument count differ from the checked Market ABI.');
  }
  marketCall.arguments.forEach((_, index) => assertEncodedMarketArgument(snapshot, marketCall, descriptor, index));
  // There is intentionally no caller-facing command whitelist here. These
  // bytes come only from the private copy of the typed Transaction and the
  // pinned SDK's CoinWithBalance resolver. A caller can no longer submit an
  // alternative Merge/Split/helper graph for shape-based approval.
  const expiration = freezeRecord({ kind: 'Epoch', epoch: expirationEpoch.toString() });
  const sourceFingerprint = fingerprint({ descriptor, inputs: snapshot.inputs });
  const evidence = freezeRecord({
    schema: 'animacraft.market-recovery-evidence.v8',
    transactionBytes: transactionBytesInput,
    transactionDigest: TransactionDataBuilder.getDigestFromBytes(bytes),
    descriptor,
    runtime: builtAction.runtime,
    gasData,
    expiration,
    epochWindow: freezeRecord({ start: expectedEpoch.toString(), end: expirationEpoch.toString() }),
    sourceFingerprint,
  });
  return evidence;
}

export async function inspectMarketActionOnChainV8(client, builtActionInput) {
  if (arguments.length !== 2) {
    fail(MarketV8BuildError, 'MARKET_V8_CALLER_TRANSACTION_BYTES_FORBIDDEN', 'transactionBytes', 'Final signing bytes are built only from the private typed Market Transaction with the pinned SDK resolver.');
  }
  await assertMakerV8MainnetRpc(client);
  const builtAction = assertMarketV8BuiltActionV8(builtActionInput);
  const currentEpoch = await currentMainnetEpoch(client);
  // Reconstruct from the privately branded, deeply frozen descriptor. Never
  // clone the public Transaction instance, which callers may have mutated.
  const canonical = canonicalTransactionFromDescriptor(builtAction);
  canonical.setExpiration({ Epoch: (currentEpoch + 1n).toString() });
  let transactionBytes;
  try {
    transactionBytes = toBase64(await canonical.build({ client }));
  } catch (error) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_CANONICAL_TRANSACTION_BUILD_FAILED',
      'transaction',
      'The pinned SDK could not resolve the private typed Market Transaction against live Mainnet inputs.',
      { cause: String(error?.message || error) },
    );
  }
  const checked = validateCanonicalMarketV8TransactionBytes(builtAction, transactionBytes, currentEpoch);
  let result;
  if (typeof client?.dryRunTransactionBlock === 'function') {
    result = await client.dryRunTransactionBlock({ transactionBlock: checked.transactionBytes });
  } else if (typeof client?.core?.simulateTransaction === 'function') {
    result = await client.core.simulateTransaction({
      transaction: checked.transactionBytes,
      include: { effects: true, events: true, commandResults: true },
    });
  } else if (typeof client?.simulateTransaction === 'function') {
    result = await client.simulateTransaction({
      transaction: checked.transactionBytes,
      include: { effects: true, events: true, commandResults: true },
    });
  } else {
    fail(MarketV8BuildError, 'MARKET_V8_ACTION_DRY_RUN_CLIENT_MISSING', 'client', 'A Mainnet Sui client with transaction simulation is required immediately before signing.');
  }
  const status = result?.effects?.status?.status
    ?? result?.effects?.status
    ?? (result?.$kind === 'FailedTransaction' || result?.FailedTransaction ? 'failure' : 'success');
  if (status !== 'success' && status !== 'SUCCESS') {
    fail(
      MarketV8EligibilityError,
      'MARKET_V8_ACTION_DRY_RUN_FAILED',
      'transaction',
      result?.effects?.status?.error
        ?? result?.FailedTransaction?.status?.error?.message
        ?? result?.error
        ?? 'The exact Market Transaction failed Mainnet simulation.',
    );
  }
  const proof = freezeRecord({
    schema: 'animacraft.market-action-dry-run.v8',
    source: 'mainnet-transaction-simulation',
    transactionDigest: checked.transactionDigest,
    descriptor: checked.descriptor,
    runtime: checked.runtime,
    transactionBytes: checked.transactionBytes,
    gasData: checked.gasData,
    expiration: checked.expiration,
    epochWindow: checked.epochWindow,
    sourceFingerprint: checked.sourceFingerprint,
    dryRunAtMs: Date.now(),
  });
  MARKET_ACTION_DRY_RUN_PROOFS.add(proof);
  return proof;
}

export function createMarketV8RecoveryEvidenceV8(builtActionInput, dryRunProof) {
  if (arguments.length !== 2) {
    fail(MarketV8BuildError, 'MARKET_V8_CALLER_TRANSACTION_BYTES_FORBIDDEN', 'transactionBytes', 'Recovery evidence accepts only the private result of a fresh Mainnet simulation.');
  }
  const builtAction = assertMarketV8BuiltActionV8(builtActionInput);
  if (!dryRunProof || !MARKET_ACTION_DRY_RUN_PROOFS.has(dryRunProof)
    || dryRunProof.descriptor !== builtAction.descriptor
    || dryRunProof.runtime !== builtAction.runtime) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_ACTION_DRY_RUN_PROOF_REQUIRED',
      'dryRunProof',
      'Signing recovery requires a fresh private proof that these exact TransactionData bytes succeeded in Mainnet simulation.',
    );
  }
  MARKET_ACTION_DRY_RUN_PROOFS.delete(dryRunProof);
  const evidence = freezeRecord({
    schema: 'animacraft.market-recovery-evidence.v8',
    transactionBytes: dryRunProof.transactionBytes,
    transactionDigest: dryRunProof.transactionDigest,
    descriptor: dryRunProof.descriptor,
    runtime: dryRunProof.runtime,
    gasData: dryRunProof.gasData,
    expiration: dryRunProof.expiration,
    epochWindow: dryRunProof.epochWindow,
    sourceFingerprint: dryRunProof.sourceFingerprint,
    dryRunAtMs: dryRunProof.dryRunAtMs,
  });
  MARKET_RECOVERY_EVIDENCE.add(evidence);
  return evidence;
}

export function assertMarketV8RecoveryEvidenceV8(value) {
  if (!value || !MARKET_RECOVERY_EVIDENCE.has(value)) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_RECOVERY_EVIDENCE_REQUIRED',
      'recoveryEvidence',
      'Signing requires freshly revalidated Market builder evidence for the exact TransactionData bytes.',
    );
  }
  return value;
}

export function consumeMarketV8RecoveryEvidenceV8(value) {
  const checked = assertMarketV8RecoveryEvidenceV8(value);
  MARKET_RECOVERY_EVIDENCE.delete(checked);
  return checked;
}

function marketArgs(types, registry, treasury) {
  return {
    registry: typedObject(registry, types.marketRegistry, 'registry'),
    treasury: typedObject(treasury, types.marketTreasury, 'treasury'),
  };
}

function verifiedBindingId(root, field) {
  const value = root?.binding?.[field];
  if (typeof value !== 'string') {
    fail(
      MarketV8BuildError,
      'MARKET_V8_VERIFIED_ROOT_BINDING_REQUIRED',
      `root.binding.${field}`,
      `A verified Root readback must provide ${field}.`,
    );
  }
  return buildId(value, `root.binding.${field}`);
}

function commonBoundObjects(runtime, types, registry, input) {
  const root = typedObject(input.root, types.makerRoot, 'root', { expectedId: registry.fields.rootId });
  const pinned = runtime.sourceRuntime;
  const registryId = verifiedBindingId(input.root, 'marketRegistryId');
  const treasuryId = verifiedBindingId(input.root, 'marketTreasuryId');
  if (registryId !== registry.objectId || treasuryId !== registry.fields.treasuryId) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_ROOT_MARKET_BINDING_MISMATCH',
      'root.binding',
      'Market Registry/Treasury do not match the verified Root capability binding.',
    );
  }
  return {
    root,
    catalog: typedObject(input.catalog, types.catalog, 'catalog', { expectedId: pinned.catalogId }),
    config: typedObject(input.config, types.marketConfig, 'config', { expectedId: pinned.roleConfigIds.market }),
  };
}

function protocolObject(types, registry, value) {
  return typedObject(value, types.protocolConfig, 'protocolConfig', { expectedId: registry.fields.protocolConfigId });
}

function listExpectation(eligible) {
  return freezeRecord({
    listingRevision: 0n,
    registryRevision: eligible.registry.fields.revision,
    quoteCommitment: eligible.quote.commitment,
  });
}

const MARKET_QUOTE_FUNCTIONS = Object.freeze({
  [MARKET_V8_QUOTE_KINDS.MAKER_RESALE]: 'quote_maker_resale_v8',
  [MARKET_V8_QUOTE_KINDS.SOUL_RESALE]: 'quote_soul_resale_v8',
  [MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE]: 'quote_physical_resale_v8',
});

export function buildMarketQuoteInspectionV8(runtimeInput, input) {
  const runtime = assertMarketV8Runtime(runtimeInput);
  const types = marketV8Types(runtime);
  const wallet = assertMarketV8WalletContext(runtime, input.wallet);
  const { registry, treasury } = assertMarketPairV8(input.registry, input.treasury);
  if (registry.network !== wallet.network) {
    fail(MarketV8BuildError, 'MARKET_V8_OBJECT_NETWORK_MISMATCH', 'registry.network', 'Market quote objects came from a different network than the connected wallet.');
  }
  const quoteKind = Number(enumUint(input.quoteKind, 8, 'quoteKind', MarketV8BuildError));
  const functionName = MARKET_QUOTE_FUNCTIONS[quoteKind];
  if (!functionName) fail(MarketV8BuildError, 'MARKET_V8_QUOTE_KIND_INVALID', 'quoteKind', 'Quote kind is unknown.');
  const grossAtomic = uint(input.grossAtomic, 64, 'grossAtomic', MarketV8BuildError);
  const market = marketArgs(types, registry, treasury);
  const root = typedObject(input.root, types.makerRoot, 'root', { expectedId: registry.fields.rootId });
  if (verifiedBindingId(input.root, 'marketRegistryId') !== registry.objectId
    || verifiedBindingId(input.root, 'marketTreasuryId') !== treasury.objectId) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_ROOT_MARKET_BINDING_MISMATCH',
      'root.binding',
      'Quote inspection objects do not match the verified Root Market binding.',
    );
  }
  for (const object of [market.registry, market.treasury, root]) {
    if (object.network !== wallet.network) {
      fail(MarketV8BuildError, 'MARKET_V8_OBJECT_NETWORK_MISMATCH', 'quote.network', 'Market quote objects came from a different network than the connected wallet.');
    }
  }
  const localQuote = quoteMarketResaleV8(registry, quoteKind, grossAtomic);
  const transaction = new Transaction();
  transaction.setSender(wallet.address);
  const target = `${runtime.callablePackageId}::market_v8::${functionName}`;
  transaction.moveCall({
    target,
    typeArguments: [runtime.paymentCoinType],
    arguments: [
      transaction.object(market.registry.objectId),
      transaction.object(market.treasury.objectId),
      transaction.object(root.objectId),
      transaction.pure.u64(grossAtomic),
    ],
  });
  return freezeRecord({
    transaction,
    commandIndex: 0,
    descriptor: freezeRecord({
      schema: MARKET_V8_ACTION_SCHEMA,
      action: 'inspectQuote',
      quoteKind,
      target,
      typeArguments: Object.freeze([runtime.paymentCoinType]),
      sender: wallet.address,
      network: wallet.network,
      registryId: registry.objectId,
      treasuryId: treasury.objectId,
      rootId: root.objectId,
      grossAtomic: grossAtomic.toString(),
    }),
    localQuote,
  });
}

function marketQuoteReturnBytes(result, commandIndex) {
  const simulated = result?.commandResults?.[commandIndex]?.returnValues?.[0]?.bcs;
  if (simulated instanceof Uint8Array || Array.isArray(simulated) || typeof simulated === 'string') return simulated;
  const inspected = result?.results?.[commandIndex]?.returnValues?.[0]?.[0];
  if (inspected instanceof Uint8Array || Array.isArray(inspected) || typeof inspected === 'string') return inspected;
  fail(MarketV8ParseError, 'MARKET_V8_QUOTE_RETURN_MISSING', 'quoteReturn', 'Dry-run did not return a readable MarketQuoteV8.');
}

function assertChainQuoteMatches(localQuote, chainQuote) {
  for (const field of [
    'quoteKind', 'rootId', 'makerVersion', 'rootContentCommitment', 'economicsCommitment',
    'rightsCommitment', 'grossAtomic', 'protocolAtomic', 'creatorAtomic', 'sourceAtomic',
    'sellerAtomic', 'commitment',
  ]) {
    if (chainQuote[field] !== localQuote[field]) {
      fail(
        MarketV8EligibilityError,
        'MARKET_V8_QUOTE_DRIFT',
        `quote.${field}`,
        'The chain-authoritative quote changed; refresh and review the exact split again before signing.',
        { actual: String(chainQuote[field]), expected: String(localQuote[field]) },
      );
    }
  }
}

export async function inspectMarketQuoteOnChainV8(client, runtimeInput, input) {
  const built = buildMarketQuoteInspectionV8(runtimeInput, input);
  let result;
  if (typeof client?.simulateTransaction === 'function') {
    result = await client.simulateTransaction({
      transaction: built.transaction,
      include: { commandResults: true },
    });
  } else if (typeof client?.core?.simulateTransaction === 'function') {
    result = await client.core.simulateTransaction({
      transaction: built.transaction,
      include: { commandResults: true },
    });
  } else if (typeof client?.devInspectTransactionBlock === 'function') {
    result = await client.devInspectTransactionBlock({
      sender: built.descriptor.sender,
      transactionBlock: built.transaction,
    });
  } else {
    fail(MarketV8BuildError, 'MARKET_V8_QUOTE_CLIENT_MISSING', 'client', 'A Sui client with simulateTransaction or devInspectTransactionBlock is required.');
  }
  const failed = result?.$kind === 'FailedTransaction'
    || Boolean(result?.FailedTransaction)
    || result?.effects?.status?.status === 'failure'
    || result?.error !== undefined;
  if (failed) {
    fail(
      MarketV8EligibilityError,
      'MARKET_V8_QUOTE_DRY_RUN_FAILED',
      'quote',
      result?.FailedTransaction?.status?.error?.message
        || result?.effects?.status?.error
        || result?.error
        || 'Chain-authoritative Market quote dry-run failed.',
    );
  }
  const quote = parseMarketQuoteV8Bcs(marketQuoteReturnBytes(result, built.commandIndex));
  assertChainQuoteMatches(built.localQuote, quote);
  const proof = freezeRecord({
    ...quote,
    evidence: freezeRecord({
      source: 'chain-dry-run',
      network: built.descriptor.network,
      target: built.descriptor.target,
      rootId: built.descriptor.rootId,
      registryId: built.descriptor.registryId,
      treasuryId: built.descriptor.treasuryId,
      registryRevision: built.localQuote.registryRevision ?? input.registry.fields.revision,
      quoteKind: built.descriptor.quoteKind,
      grossAtomic: built.descriptor.grossAtomic,
    }),
  });
  CHAIN_QUOTE_PROOFS.add(proof);
  return proof;
}

function requireChainQuoteProof(runtime, registry, treasury, quoteKind, grossAtomic, proof) {
  if (!proof || !CHAIN_QUOTE_PROOFS.has(proof)) {
    fail(
      MarketV8EligibilityError,
      'MARKET_V8_CHAIN_QUOTE_REQUIRED',
      'chainQuote',
      'Inspect and review a fresh chain-authoritative quote before constructing this signing action.',
    );
  }
  const local = quoteMarketResaleV8(registry, quoteKind, grossAtomic);
  assertChainQuoteMatches(local, proof);
  const expectedTarget = `${runtime.callablePackageId}::market_v8::${MARKET_QUOTE_FUNCTIONS[quoteKind]}`;
  const checks = [
    ['network', proof.evidence.network, registry.network],
    ['target', proof.evidence.target, expectedTarget],
    ['rootId', proof.evidence.rootId, registry.fields.rootId],
    ['registryId', proof.evidence.registryId, registry.objectId],
    ['treasuryId', proof.evidence.treasuryId, treasury.objectId],
    ['registryRevision', proof.evidence.registryRevision, registry.fields.revision],
    ['quoteKind', proof.evidence.quoteKind, quoteKind],
    ['grossAtomic', proof.evidence.grossAtomic, local.grossAtomic.toString()],
  ];
  for (const [field, observed, expected] of checks) {
    if (observed !== expected) {
      fail(
        MarketV8EligibilityError,
        'MARKET_V8_CHAIN_QUOTE_CONTEXT_DRIFT',
        `chainQuote.evidence.${field}`,
        'The verified quote belongs to a different or stale Market context; re-read and review again.',
        { observed: String(observed), expected: String(expected) },
      );
    }
  }
  return proof;
}

function assertRegistryExpectation(registry, expected) {
  const checked = uint(expected, 64, 'expectedRegistryRevision', MarketV8EligibilityError);
  same(registry.fields.revision, checked, 'MARKET_V8_STALE_REGISTRY_REVISION', 'expectedRegistryRevision', 'Market registry revision is stale.');
}

export function assertMarketListEligibilityV8({ registry: registryInput, treasury: treasuryInput, lane, root, grossAtomic, expectedRegistryRevision }) {
  const { registry, treasury } = assertMarketPairV8(registryInput, treasuryInput);
  assertRegistryExpectation(registry, expectedRegistryRevision);
  const lifecycleValue = observedRootLifecycle(root);
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
  requireChainQuoteProof(
    runtime,
    eligible.registry,
    eligible.treasury,
    quoteKindForListing(eligible.listing),
    eligible.listing.fields.grossAtomic,
    input.chainQuote,
  );
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(runtime, types, eligible.registry, input);
  if (hasOwn(input, 'payment')) {
    fail(MarketV8BuildError, 'MARKET_V8_CALLER_PAYMENT_FORBIDDEN', 'payment', 'Payment Coin IDs and amounts are derived by the exact-balance transaction intent, not supplied by the caller.');
  }
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
  const common = commonBoundObjects(runtime, types, eligible.registry, input);
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
    root: input.root,
    protocolConfig: input.protocolConfig,
    expectation: input.expectation,
  });
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(runtime, types, eligible.registry, input);
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
    root: input.root,
    grossAtomic: input.grossAtomic,
    expectedRegistryRevision: input.expectedRegistryRevision,
  });
  requireChainQuoteProof(
    runtime,
    eligible.registry,
    eligible.treasury,
    MARKET_V8_QUOTE_KINDS.MAKER_RESALE,
    eligible.quote.grossAtomic,
    input.chainQuote,
  );
  if (!input.makerTreasury || !hasOwn(input.makerTreasury, 'balanceAtomic')) {
    fail(MarketV8EligibilityError, 'MARKET_V8_VERIFIED_MAKER_TREASURY_REQUIRED', 'makerTreasury.balanceAtomic', 'Maker control listing requires a verified MakerTreasury readback.');
  }
  const makerTreasuryBalance = uint(input.makerTreasury.balanceAtomic, 64, 'makerTreasury.balanceAtomic', MarketV8EligibilityError);
  if (makerTreasuryBalance !== 0n) {
    fail(MarketV8EligibilityError, 'MARKET_V8_MAKER_TREASURY_NOT_EMPTY', 'makerTreasury.balanceAtomic', 'Maker control listing requires an empty Maker treasury.');
  }
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(runtime, types, eligible.registry, input);
  const admin = typedObject(input.admin, types.makerAdmin, 'admin', { expectedId: buildId(input.root.adminCapId, 'root.adminCapId') });
  const makerTreasury = typedObject(input.makerTreasury, types.makerTreasury, 'makerTreasury', {
    expectedId: verifiedBindingId(input.root, 'makerTreasuryId'),
  });
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
  ], listExpectation(eligible));
}

export function buildPurchaseMakerControlV8(runtimeInput, input) {
  const setup = purchaseSetup(runtimeInput, input, MARKET_V8_LANES.MAKER);
  const protocolConfig = protocolObject(setup.types, setup.eligible.registry, input.protocolConfig);
  const protocolTreasury = typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury', {
    expectedId: setup.runtime.sourceRuntime.protocolTreasuryId,
  });
  const receiving = exactRef(input.adminReceiving, setup.types.makerAdmin, 'adminReceiving', setup.eligible.listing.fields.adminCapId);
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
    argPayment('payment', setup.runtime.paymentCoinType, setup.wallet.network, setup.eligible.quote.grossAtomic),
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
    root: input.root,
    grossAtomic: input.grossAtomic,
    expectedRegistryRevision: input.expectedRegistryRevision,
  });
  requireChainQuoteProof(
    runtime,
    eligible.registry,
    eligible.treasury,
    MARKET_V8_QUOTE_KINDS.SOUL_RESALE,
    eligible.quote.grossAtomic,
    input.chainQuote,
  );
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(runtime, types, eligible.registry, input);
  const protocolConfig = protocolObject(types, eligible.registry, input.protocolConfig);
  return compileAction(runtime, 'listSoulBundle', MARKET_V8_LANES.SOUL, wallet, [
    argObject('registry', market.registry),
    argObject('treasury', market.treasury),
    argObject('outputRegistry', typedObject(input.outputRegistry, types.outputRegistry, 'outputRegistry', {
      expectedId: verifiedBindingId(input.root, 'outputRegistryId'),
    })),
    argObject('soulRegistry', typedObject(input.soulRegistry, types.soulRegistry, 'soulRegistry', {
      expectedId: verifiedBindingId(input.root, 'soulRegistryId'),
    })),
    argObject('root', common.root),
    argObject('protocolConfig', protocolConfig),
    argObject('catalog', common.catalog),
    argObject('config', common.config),
    argObject('outputAsset', typedObject(input.outputAsset, types.completeOutput, 'outputAsset')),
    argObject('receipt', typedObject(input.receipt, types.completeReceipt, 'receipt')),
    argObject('soul', typedObject(input.soul, types.canonicalSoul, 'soul')),
    argU64('grossAtomic', eligible.quote.grossAtomic),
  ], listExpectation(eligible));
}

function soulObjects(setup, input) {
  const custody = setup.eligible.listing.fields.custody;
  if (custody.outputRegistryId !== verifiedBindingId(input.root, 'outputRegistryId')
    || custody.soulRegistryId !== verifiedBindingId(input.root, 'soulRegistryId')) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_SOUL_ROOT_BINDING_MISMATCH',
      'listing.custody',
      'Soul custody registries do not match the verified Root capability binding.',
    );
  }
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
  return compileAction(setup.runtime, 'purchaseSoulBundle', MARKET_V8_LANES.SOUL, setup.wallet, [
    argObject('listing', setup.listing),
    argObject('registry', setup.market.registry),
    argObject('treasury', setup.market.treasury),
    argObject('outputRegistry', soul.outputRegistry),
    argObject('soulRegistry', soul.soulRegistry),
    argObject('root', setup.common.root),
    argObject('makerTreasury', typedObject(input.makerTreasury, setup.types.makerTreasury, 'makerTreasury', {
      expectedId: verifiedBindingId(input.root, 'makerTreasuryId'),
    })),
    argObject('protocolConfig', protocolConfig),
    argObject('protocolTreasury', typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury', {
      expectedId: setup.runtime.sourceRuntime.protocolTreasuryId,
    })),
    argObject('catalog', setup.common.catalog),
    argObject('config', setup.common.config),
    argReceiving('outputReceiving', soul.outputReceiving),
    argReceiving('receiptReceiving', soul.receiptReceiving),
    argReceiving('soulReceiving', soul.soulReceiving),
    argPayment('payment', setup.runtime.paymentCoinType, setup.wallet.network, setup.eligible.quote.grossAtomic),
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
    root: input.root,
    grossAtomic: input.grossAtomic,
    expectedRegistryRevision: input.expectedRegistryRevision,
  });
  requireChainQuoteProof(
    runtime,
    eligible.registry,
    eligible.treasury,
    MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE,
    eligible.quote.grossAtomic,
    input.chainQuote,
  );
  const market = marketArgs(types, eligible.registry, eligible.treasury);
  const common = commonBoundObjects(runtime, types, eligible.registry, input);
  const sourceTreasuryType = lane === MARKET_V8_LANES.PHYSICAL_BASE ? types.makerTreasury : types.packTreasury;
  const sourceTreasuryName = lane === MARKET_V8_LANES.PHYSICAL_BASE ? 'makerTreasury' : 'packTreasury';
  const sourceTreasury = typedObject(input[sourceTreasuryName], sourceTreasuryType, sourceTreasuryName);
  const asset = typedObject(input.asset, types.physicalAsset, 'asset');
  requireSource(input.asset, lane === MARKET_V8_LANES.PHYSICAL_BASE ? MARKET_V8_PHYSICAL_SOURCES.BASE : MARKET_V8_PHYSICAL_SOURCES.PACK, sourceTreasury.objectId, input.root, 'asset');
  const action = lane === MARKET_V8_LANES.PHYSICAL_BASE ? 'listBasePhysical' : 'listPackPhysical';
  return compileAction(runtime, action, lane, wallet, [
    argObject('registry', market.registry),
    argObject('treasury', market.treasury),
    argObject('physicalRegistry', typedObject(input.physicalRegistry, types.physicalRegistry, 'physicalRegistry', {
      expectedId: verifiedBindingId(input.root, 'physicalRegistryId'),
    })),
    argObject('root', common.root),
    argObject(sourceTreasuryName, sourceTreasury),
    argObject('protocolConfig', protocolObject(types, eligible.registry, input.protocolConfig)),
    argObject('catalog', common.catalog),
    argObject('physicalConfig', typedObject(input.physicalConfig, types.physicalConfig, 'physicalConfig', {
      expectedId: runtime.sourceRuntime.roleConfigIds.physical,
    })),
    argObject('config', common.config),
    argObject('asset', asset),
    argU64('grossAtomic', eligible.quote.grossAtomic),
  ], listExpectation(eligible));
}

export function buildListBasePhysicalV8(runtime, input) {
  return listPhysical(runtime, input, MARKET_V8_LANES.PHYSICAL_BASE);
}

export function buildListPackPhysicalV8(runtime, input) {
  return listPhysical(runtime, input, MARKET_V8_LANES.PHYSICAL_PACK);
}

function physicalObjects(setup, input) {
  const custody = setup.eligible.listing.fields.custody;
  const boundRegistry = verifiedBindingId(input.root, 'physicalRegistryId');
  if (custody.physicalRegistryId !== boundRegistry
    || custody.physicalPackageConfigId !== setup.runtime.sourceRuntime.roleConfigIds.physical) {
    fail(
      MarketV8BuildError,
      'MARKET_V8_PHYSICAL_ROOT_BINDING_MISMATCH',
      'listing.custody',
      'Physical custody does not match the verified Root registry and pinned Physical config.',
    );
  }
  return {
    physicalRegistry: typedObject(input.physicalRegistry, setup.types.physicalRegistry, 'physicalRegistry', { expectedId: boundRegistry }),
    physicalConfig: typedObject(input.physicalConfig, setup.types.physicalConfig, 'physicalConfig', { expectedId: setup.runtime.sourceRuntime.roleConfigIds.physical }),
    receiving: exactRef(input.receiving, setup.types.physicalAsset, 'receiving', custody.assetId),
  };
}

function purchasePhysical(runtimeInput, input, lane) {
  const setup = purchaseSetup(runtimeInput, input, lane);
  const physical = physicalObjects(setup, input);
  const custody = setup.eligible.listing.fields.custody;
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
    const boundMakerTreasury = verifiedBindingId(input.root, 'makerTreasuryId');
    if (custody.sourceTreasuryId !== boundMakerTreasury) {
      fail(MarketV8BuildError, 'MARKET_V8_SOURCE_TREASURY_MISMATCH', 'listing.custody.sourceTreasuryId', 'Base Physical custody does not bind the verified MakerTreasury.');
    }
    const makerTreasury = typedObject(input.makerTreasury, setup.types.makerTreasury, 'makerTreasury', { expectedId: boundMakerTreasury });
    args = [
      ...prefix,
      argObject('makerTreasury', makerTreasury),
      argObject('protocolConfig', protocolConfig),
      argObject('protocolTreasury', typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury', {
        expectedId: setup.runtime.sourceRuntime.protocolTreasuryId,
      })),
      argObject('catalog', setup.common.catalog),
      argObject('physicalConfig', physical.physicalConfig),
      argObject('config', setup.common.config),
      argReceiving('receiving', physical.receiving),
      argPayment('payment', setup.runtime.paymentCoinType, setup.wallet.network, setup.eligible.quote.grossAtomic),
    ];
  } else {
    action = 'purchasePackPhysical';
    const packTreasury = typedObject(input.packTreasury, setup.types.packTreasury, 'packTreasury', { expectedId: custody.sourceTreasuryId });
    args = [
      ...prefix,
      argObject('packRelease', typedObject(input.packRelease, setup.types.packRelease, 'packRelease', { expectedId: custody.sourceId })),
      argObject('packTreasury', packTreasury),
      argObject('protocolConfig', protocolConfig),
      argObject('protocolTreasury', typedObject(input.protocolTreasury, setup.types.protocolTreasury, 'protocolTreasury', {
        expectedId: setup.runtime.sourceRuntime.protocolTreasuryId,
      })),
      argObject('catalog', setup.common.catalog),
      argObject('physicalConfig', physical.physicalConfig),
      argObject('config', setup.common.config),
      argReceiving('receiving', physical.receiving),
      argPayment('payment', setup.runtime.paymentCoinType, setup.wallet.network, setup.eligible.quote.grossAtomic),
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
    buildQuoteInspection: (input) => buildMarketQuoteInspectionV8(runtime, input),
    inspectQuoteOnChain: (suiClient, input) => inspectMarketQuoteOnChainV8(suiClient, runtime, input),
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
