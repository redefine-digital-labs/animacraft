import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bcs } from '@mysten/sui/bcs';
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils';

import {
  makerV8TransactionEventsDigestV8,
  readFinalizedMakerV8EnvelopeV8,
} from '../maker-v8-browser.js';
import { assertFinalizedMarketReadbackV8 } from '../maker-v8-finalized.js';

import {
  MARKET_V8_ACTION_ABI,
  MARKET_V8_LANES,
  MARKET_V8_LIFECYCLES,
  MARKET_V8_LISTING_STATUS,
  MARKET_V8_PHYSICAL_SOURCES,
  MARKET_V8_QUOTE_KINDS,
  MarketV8BuildError,
  MarketV8EligibilityError,
  MarketV8ParseError,
  MarketV8RuntimeError,
  assertMarketV8Runtime,
  buildMarketQuoteInspectionV8,
  createMarketV8RecoveryEvidenceV8,
  consumeMarketV8RecoveryEvidenceV8,
  createMarketV8Client,
  deriveMarketQuoteCommitmentV8,
  inspectMarketQuoteOnChainV8,
  inspectMarketActionOnChainV8,
  assertMarketV8RecoveryEvidenceV8,
  marketQuoteCommitmentBcsV8,
  parseMarketQuoteV8Bcs,
} from '../maker-v8-market.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
} from '../maker-v8-chain.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/market-v8-abi.json', import.meta.url),
  'utf8',
));
const moveSource = await readFile(
  new URL('../move/animacraft_v8_market/sources/market_v8.move', import.meta.url),
  'utf8',
);

const packageId = (digit) => `0x${digit.repeat(64)}`;
const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const bytes32 = (value) => Array(32).fill(value);
const bytesHex = (value) => `0x${value.toString(16).padStart(2, '0').repeat(32)}`;
const digest = '11111111111111111111111111111111';
const NETWORK = 'mainnet';

const runtimeInput = Object.freeze({
  schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
  protocolVersion: 8,
  enabled: true,
  catalogId: id(800),
  protocolConfigId: id(801),
  protocolTreasuryId: id(802),
  paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
  clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
  roles: Object.freeze({
    core: { typeOriginPackageId: packageId('1'), callablePackageId: packageId('1') },
    seal: { typeOriginPackageId: packageId('6'), callablePackageId: packageId('6') },
    runtime: { typeOriginPackageId: packageId('4'), callablePackageId: packageId('4') },
    output: { typeOriginPackageId: packageId('2'), callablePackageId: packageId('2') },
    physical: { typeOriginPackageId: packageId('3'), callablePackageId: packageId('3') },
    market: { typeOriginPackageId: packageId('9'), callablePackageId: packageId('9') },
    release: { typeOriginPackageId: packageId('7'), callablePackageId: packageId('7') },
  }),
  roleConfigIds: Object.freeze({
    seal: id(803), runtime: id(804), output: id(805), physical: id(806),
    market: id(807), release: id(808),
  }),
  makerBindings: Object.freeze([]),
});

function runtimeAttestationRpc(runtime) {
  const runtimeRoles = Object.keys(runtime.roles);
  const roles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const authority = Object.fromEntries(roles.map((role, index) => [role, id(900 + index)]));
  const roleCommitment = Object.fromEntries(Object.keys(runtime.roles).map((role, index) => [role, bytes32(40 + index)]));
  const productCommitment = bytes32(60);
  const callSetCommitment = bytes32(61);
  const objectResponse = (type, objectId, fields) => ({
    data: {
      objectId,
      version: '1',
      digest,
      type,
      owner: { Shared: { initial_shared_version: '1' } },
      content: { dataType: 'moveObject', type, fields: { id: { id: objectId }, ...fields } },
    },
  });
  const binding = Object.fromEntries(Object.entries(runtime.roles).map(([role, identity], index) => [role, { fields: {
    original_package_id: identity.typeOriginPackageId,
    callable_package_id: identity.callablePackageId,
    source_commitment: bytes32(10 + index),
    package_commitment: bytes32(20 + index),
    abi_commitment: bytes32(30 + index),
    commitment: roleCommitment[role],
  } }]));
  const catalog = objectResponse(
    `${runtime.roles.core.typeOriginPackageId}::package_binding_v8::ProductReleaseCatalogV8`,
    runtime.catalogId,
    {
      version: '8', protocol_config_id: runtime.protocolConfigId,
      protocol_config_revision: '7', protocol_config_commitment: bytes32(4),
      binding: { fields: { version: '8', native_capability_mask: '127', ...binding, commitment: productCommitment } },
      call_cap_set: { fields: {
        version: '8', catalog_id: runtime.catalogId, product_binding_commitment: productCommitment,
        ...Object.fromEntries(roles.map((role) => [`${role}_authority_id`, authority[role]])),
        commitment: callSetCommitment,
      } },
      ...Object.fromEntries(roles.map((role) => [`${role}_call_cap`, []])),
    },
  );
  const typeNames = {
    seal: ['seal_v8', 'SealPolicyConfigV8'], runtime: ['runtime_binding_v8', 'RuntimePackageConfigV8'],
    output: ['output_v8', 'OutputPackageConfigV8'], physical: ['physical_v8', 'PhysicalPackageConfigV8'],
    market: ['market_v8', 'MarketPackageConfigV8'], release: ['release_v8', 'ReleasePackageConfigV8'],
  };
  const configs = Object.fromEntries(roles.map((role) => {
    const [moduleName, typeName] = typeNames[role];
    return [role, objectResponse(`${runtime.roles[role].typeOriginPackageId}::${moduleName}::${typeName}`, runtime.roleConfigIds[role], {
      version: '8', catalog_id: runtime.catalogId, product_binding_commitment: productCommitment,
      call_cap_set_commitment: callSetCommitment,
      [`${role}_call_cap`]: { fields: {
        version: '8', authority_id: authority[role], catalog_id: runtime.catalogId,
        product_binding_commitment: productCommitment, role_binding_commitment: roleCommitment[role],
        call_cap_set_commitment: callSetCommitment,
      } },
    })];
  }));
  return {
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getObject({ id: objectId }) {
      if (objectId === runtime.catalogId) return catalog;
      const packageIndex = runtimeRoles.findIndex((role) => runtime.roles[role].callablePackageId === objectId);
      if (packageIndex >= 0) return {
        data: {
          objectId,
          version: '1',
          digest: String(packageIndex + 2).repeat(32),
          owner: { Immutable: true },
          bcs: { dataType: 'package', id: objectId, version: '1', moduleMap: {} },
        },
      };
      const role = roles.find((candidate) => runtime.roleConfigIds[candidate] === objectId);
      return configs[role];
    },
  };
}

const attestedRuntime = (await attestMakerV8Runtime(runtimeAttestationRpc(runtimeInput), runtimeInput)).runtime;
const client = createMarketV8Client(attestedRuntime, { network: NETWORK });
assert.equal(client.runtime.sourceRuntime, attestedRuntime, 'Market client must preserve the private runtime-attestation identity');
const { types } = client;

const IDs = Object.freeze({
  registry: id(100),
  treasury: id(101),
  catalog: id(800),
  config: id(807),
  root: id(104),
  protocolConfig: id(801),
  protocolTreasury: id(802),
  admin: id(107),
  makerTreasury: id(108),
  outputRegistry: id(109),
  soulRegistry: id(110),
  output: id(111),
  receipt: id(112),
  soul: id(113),
  physicalRegistry: id(114),
  physicalConfig: id(806),
  baseAsset: id(116),
  packAsset: id(117),
  packTreasury: id(118),
  packRelease: id(119),
  makerListing: id(120),
  soulListing: id(121),
  baseListing: id(122),
  packListing: id(123),
  baseSource: id(124),
  paymentMaker: id(130),
  paymentSoul: id(131),
  paymentBase: id(132),
  paymentPack: id(133),
  seller: id(200),
  buyer: id(201),
  recoveryCaller: id(202),
});

function moveObject(type, objectId, fields, overrides = {}) {
  return {
    data: {
      objectId,
      version: '7',
      digest,
      content: {
        dataType: 'moveObject',
        type,
        hasPublicTransfer: false,
        fields: { id: { id: objectId }, ...fields },
      },
      ...overrides,
    },
  };
}

const registryFields = Object.freeze({
  version: '8',
  catalog_id: IDs.catalog,
  package_config_id: IDs.config,
  product_binding_commitment: bytes32(1),
  call_cap_set_commitment: bytes32(2),
  root_id: IDs.root,
  maker_version: '42',
  root_content_commitment: bytes32(0xaa),
  protocol_config_id: IDs.protocolConfig,
  protocol_config_revision: '7',
  protocol_config_commitment: bytes32(0xdd),
  economics_commitment: bytes32(0xbb),
  rights_commitment: bytes32(0xcc),
  maker_market_fee_bps: '250',
  soul_market_fee_bps: '300',
  soul_creator_royalty_bps: '500',
  maker_source_royalty_bps: '200',
  maker_resale_royalty_bps: '400',
  treasury_id: IDs.treasury,
  sealed: true,
  revision: '4',
  listing_count: '4',
  escrow_count: '4',
  completed_sale_count: '0',
  canceled_sale_count: '0',
  recovered_sale_count: '0',
  gross_volume_atomic: '0',
  protocol_paid_atomic: '0',
  creator_paid_atomic: '0',
  source_paid_atomic: '0',
  seller_paid_atomic: '0',
  zero_state_commitment: bytes32(3),
});

const treasuryFields = Object.freeze({
  version: '8',
  catalog_id: IDs.catalog,
  package_config_id: IDs.config,
  root_id: IDs.root,
  maker_version: '42',
  root_content_commitment: bytes32(0xaa),
  escrow: { value: '0' },
  gross_escrowed_atomic: '0',
  gross_released_atomic: '0',
});

const registryResponse = moveObject(types.marketRegistry, IDs.registry, registryFields);
const treasuryResponse = moveObject(types.marketTreasury, IDs.treasury, treasuryFields);
const registry = client.parseRegistry(registryResponse);
const treasury = client.parseTreasury(treasuryResponse);
const makerQuote = client.quoteMakerResale(registry, 1_000_000n);
const soulQuote = client.quoteSoulResale(registry, 1_000_000n);
const assetQuote = client.quotePhysicalResale(registry, 1_000_000n);

function listingAmounts(quote) {
  return {
    gross_atomic: quote.grossAtomic.toString(),
    protocol_atomic: quote.protocolAtomic.toString(),
    creator_atomic: quote.creatorAtomic.toString(),
    source_atomic: quote.sourceAtomic.toString(),
    seller_atomic: quote.sellerAtomic.toString(),
    quote_commitment: quote.commitment,
    status: String(MARKET_V8_LISTING_STATUS.OPEN),
    revision: '0',
    terminal_recipient: '0x0',
  };
}

function makerListingResponse(overrides = {}) {
  const fields = {
    version: '8',
    registry_id: IDs.registry,
    treasury_id: IDs.treasury,
    package_config_id: IDs.config,
    root_id: IDs.root,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    admin_cap_id: IDs.admin,
    seller: IDs.seller,
    expected_control_epoch: '9',
    ...listingAmounts(makerQuote),
    ...overrides,
  };
  delete fields.source_atomic;
  return moveObject(types.makerListing, IDs.makerListing, fields);
}

function soulListingResponse(overrides = {}) {
  return moveObject(types.soulListing, IDs.soulListing, {
    version: '8',
    registry_id: IDs.registry,
    treasury_id: IDs.treasury,
    package_config_id: IDs.config,
    custody: {
      listing_id: IDs.soulListing,
      output_registry_id: IDs.outputRegistry,
      soul_registry_id: IDs.soulRegistry,
      market_registry_id: IDs.registry,
      market_treasury_id: IDs.treasury,
      root_id: IDs.root,
      maker_version: '42',
      root_content_commitment: bytes32(0xaa),
      output_id: IDs.output,
      receipt_id: IDs.receipt,
      soul_id: IDs.soul,
      output_commitment: bytes32(10),
      receipt_commitment: bytes32(11),
      soul_commitment: bytes32(12),
      seller: IDs.seller,
      expected_soul_ownership_epoch: '3',
    },
    ...listingAmounts(soulQuote),
    ...overrides,
  });
}

function physicalListingResponse(sourceKind, overrides = {}) {
  const pack = sourceKind === MARKET_V8_PHYSICAL_SOURCES.PACK;
  const listingId = pack ? IDs.packListing : IDs.baseListing;
  return moveObject(types.physicalListing, listingId, {
    version: '8',
    registry_id: IDs.registry,
    treasury_id: IDs.treasury,
    package_config_id: IDs.config,
    custody: {
      version: '8',
      catalog_id: IDs.catalog,
      product_binding_commitment: bytes32(1),
      call_cap_set_commitment: bytes32(2),
      market_authority_id: IDs.config,
      market_registry_id: IDs.registry,
      market_treasury_id: IDs.treasury,
      listing_id: listingId,
      physical_package_config_id: IDs.physicalConfig,
      physical_registry_id: IDs.physicalRegistry,
      root_id: IDs.root,
      maker_version: '42',
      root_content_commitment: bytes32(0xaa),
      asset_id: pack ? IDs.packAsset : IDs.baseAsset,
      asset_content_commitment: bytes32(pack ? 21 : 20),
      source_kind: String(sourceKind),
      source_id: pack ? IDs.packRelease : IDs.baseSource,
      source_semantic_id: pack ? 'pack-style' : 'base-style',
      source_content_commitment: bytes32(pack ? 23 : 22),
      source_treasury_id: pack ? IDs.packTreasury : IDs.makerTreasury,
      holder: IDs.seller,
      ownership_epoch: '5',
      transferable: true,
      provenance_commitment: bytes32(24),
    },
    ...listingAmounts(assetQuote),
    ...overrides,
  });
}

const makerListing = client.parseMakerListing(makerListingResponse());
const soulListing = client.parseSoulListing(soulListingResponse());
const baseListing = client.parsePhysicalListing(physicalListingResponse(MARKET_V8_PHYSICAL_SOURCES.BASE));
const packListing = client.parsePhysicalListing(physicalListingResponse(MARKET_V8_PHYSICAL_SOURCES.PACK));

const object = (objectId, type, extra = {}) => ({ objectId, network: NETWORK, type, ...extra });
const receiving = (objectId, type) => ({ objectId, network: NETWORK, type, version: '6', digest });
const payment = (objectId, balanceAtomic = '1000000') => ({
  objectId,
  network: NETWORK,
  type: types.paymentCoin,
  version: '6',
  digest,
  balanceAtomic,
});
const wallet = (address) => ({ address, network: NETWORK });
const expectation = (listing) => ({
  listingRevision: listing.fields.revision,
  registryRevision: registry.fields.revision,
  quoteCommitment: listing.fields.quoteCommitment,
});

const rootAt = (lifecycleCode) => object(IDs.root, types.makerRoot, {
  adminCapId: IDs.admin,
  ownerAddress: IDs.seller,
  creatorAddress: id(203),
  controlEpoch: 5n,
  binding: Object.freeze({
    makerTreasuryId: IDs.makerTreasury,
    marketRegistryId: IDs.registry,
    marketTreasuryId: IDs.treasury,
    outputRegistryId: IDs.outputRegistry,
    soulRegistryId: IDs.soulRegistry,
    physicalRegistryId: IDs.physicalRegistry,
  }),
  lifecycleCode,
});
const protocolAt = (enabled) => object(IDs.protocolConfig, types.protocolConfig, {
  enabled,
  revision: registry.fields.protocolConfigRevision,
  commitment: registry.fields.protocolConfigCommitment,
});
const currentProtocol = protocolAt(true);
const degraded = protocolAt(false);

const common = Object.freeze({
  registry,
  treasury,
  root: rootAt(MARKET_V8_LIFECYCLES.ACTIVE),
  catalog: object(IDs.catalog, types.catalog),
  config: object(IDs.config, types.marketConfig),
  protocolConfig: currentProtocol,
});
const makerTreasury = object(IDs.makerTreasury, types.makerTreasury, { balanceAtomic: 0n });
const protocolTreasury = object(IDs.protocolTreasury, types.protocolTreasury, { balanceAtomic: 0n });
const outputRegistry = object(IDs.outputRegistry, types.outputRegistry);
const soulRegistry = object(IDs.soulRegistry, types.soulRegistry);
const physicalRegistry = object(IDs.physicalRegistry, types.physicalRegistry);
const physicalConfig = object(IDs.physicalConfig, types.physicalConfig);
const packTreasury = object(IDs.packTreasury, types.packTreasury, { balanceAtomic: 0n });
const packRelease = object(IDs.packRelease, types.packRelease);

function makerExisting(listing = makerListing, sender = IDs.buyer) {
  return {
    ...common,
    listing,
    wallet: wallet(sender),
    expectation: expectation(listing),
    chainQuote: makerChainQuote,
    adminReceiving: receiving(IDs.admin, types.makerAdmin),
  };
}

function soulExisting(listing = soulListing, sender = IDs.buyer) {
  return {
    ...common,
    listing,
    wallet: wallet(sender),
    expectation: expectation(listing),
    chainQuote: soulChainQuote,
    outputRegistry,
    soulRegistry,
    outputReceiving: receiving(IDs.output, types.completeOutput),
    receiptReceiving: receiving(IDs.receipt, types.completeReceipt),
    soulReceiving: receiving(IDs.soul, types.canonicalSoul),
  };
}

function physicalExisting(listing = baseListing, sender = IDs.buyer) {
  return {
    ...common,
    listing,
    wallet: wallet(sender),
    expectation: expectation(listing),
    chainQuote: physicalChainQuote,
    physicalRegistry,
    physicalConfig,
    receiving: receiving(listing.fields.custody.assetId, types.physicalAsset),
  };
}

function allActions() {
  return {
    listMakerControl: client.buildListMakerControl({
      ...common,
      wallet: wallet(IDs.seller),
      root: rootAt(MARKET_V8_LIFECYCLES.PAUSED),
      admin: object(IDs.admin, types.makerAdmin),
      makerTreasury,
      chainQuote: makerChainQuote,
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }),
    purchaseMakerControl: client.buildPurchaseMakerControl({
      ...makerExisting(),
      protocolTreasury,
    }),
    cancelMakerControl: client.buildCancelMakerControl(makerExisting(makerListing, IDs.seller)),
    recoverMakerControl: client.buildRecoverMakerControl({
      ...makerExisting(makerListing, IDs.recoveryCaller),
      protocolConfig: degraded,
    }),
    listSoulBundle: client.buildListSoulBundle({
      ...common,
      wallet: wallet(IDs.seller),
      outputRegistry,
      soulRegistry,
      outputAsset: object(IDs.output, types.completeOutput, { outputCommitment: bytes32(10) }),
      receipt: object(IDs.receipt, types.completeReceipt, { receiptCommitment: bytes32(11) }),
      soul: object(IDs.soul, types.canonicalSoul, { ownershipEpoch: 5n, soulCommitment: bytes32(12) }),
      chainQuote: soulChainQuote,
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }),
    purchaseSoulBundle: client.buildPurchaseSoulBundle({
      ...soulExisting(),
      makerTreasury,
      protocolTreasury,
    }),
    cancelSoulListing: client.buildCancelSoulListing(soulExisting(soulListing, IDs.seller)),
    recoverSoulListing: client.buildRecoverSoulListing({
      ...soulExisting(soulListing, IDs.recoveryCaller),
      protocolConfig: degraded,
    }),
    listBasePhysical: client.buildListBasePhysical({
      ...common,
      wallet: wallet(IDs.seller),
      physicalRegistry,
      physicalConfig,
      makerTreasury,
      asset: object(IDs.baseAsset, types.physicalAsset, {
        sourceKind: '0',
        sourceTreasuryId: null,
        sourceId: IDs.baseSource,
        sourceSemanticId: 'base-style',
        assetContentCommitment: bytes32(20),
        sourceContentCommitment: bytes32(22),
        provenanceCommitment: bytes32(24),
        transferable: true,
        ownershipEpoch: 5n,
      }),
      chainQuote: physicalChainQuote,
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }),
    listPackPhysical: client.buildListPackPhysical({
      ...common,
      wallet: wallet(IDs.seller),
      physicalRegistry,
      physicalConfig,
      packTreasury,
      asset: object(IDs.packAsset, types.physicalAsset, {
        sourceKind: '1',
        sourceTreasuryId: IDs.packTreasury,
        sourceId: IDs.packRelease,
        sourceSemanticId: 'pack-style',
        assetContentCommitment: bytes32(21),
        sourceContentCommitment: bytes32(23),
        provenanceCommitment: bytes32(24),
        transferable: true,
        ownershipEpoch: 5n,
      }),
      chainQuote: physicalChainQuote,
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }),
    purchaseBasePhysical: client.buildPurchaseBasePhysical({
      ...physicalExisting(baseListing),
      makerTreasury,
      protocolTreasury,
    }),
    purchasePackPhysical: client.buildPurchasePackPhysical({
      ...physicalExisting(packListing),
      packRelease,
      packTreasury,
      protocolTreasury,
    }),
    cancelPhysicalListing: client.buildCancelPhysicalListing(physicalExisting(baseListing, IDs.seller)),
    recoverPhysicalListing: client.buildRecoverPhysicalListing({
      ...physicalExisting(packListing, IDs.recoveryCaller),
      protocolConfig: degraded,
    }),
  };
}

function sourceParameters(functionName) {
  const pattern = new RegExp(
    `public fun ${functionName}<PaymentCoin>\\(([\\s\\S]*?)\\n\\)(?:\\s*:\\s*[^\\{]+)?\\s*\\{`,
  );
  const match = moveSource.match(pattern);
  assert.ok(match, `missing source signature for ${functionName}`);
  return match[1].split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const withoutComma = line.replace(/,$/, '');
    const separator = withoutComma.indexOf(':');
    return [withoutComma.slice(0, separator), withoutComma.slice(separator + 1).trim()];
  });
}

function sourceStructFields(name) {
  const start = moveSource.indexOf(`public struct ${name}`);
  assert.notEqual(start, -1, `missing struct ${name}`);
  const open = moveSource.indexOf('{', start);
  const close = moveSource.indexOf('\n}', open);
  return moveSource.slice(open + 1, close).split('\n').map((line) => line.trim())
    .map((line) => line.match(/^(\w+):/)?.[1]).filter(Boolean);
}

function inputKind(input) {
  if (input.UnresolvedObject) return 'object';
  if (input.Object?.Receiving) return 'receiving';
  if (input.Object?.ImmOrOwnedObject) return 'payment';
  if (input.Pure) return 'pure';
  return 'unknown';
}

function transactionSnapshot(result) {
  const data = result.transaction.getData();
  const call = data.commands.find((command) => command.MoveCall)?.MoveCall;
  const paymentIntent = data.commands.find((command) => command.$Intent?.name === 'CoinWithBalance')?.$Intent?.data ?? null;
  return {
    version: data.version,
    sender: data.sender,
    expiration: data.expiration,
    gasData: data.gasData,
    package: call.package,
    module: call.module,
    function: call.function,
    typeArguments: call.typeArguments,
    inputs: data.inputs.map((input) => {
      if (input.UnresolvedObject) return { kind: 'object', ...input.UnresolvedObject };
      if (input.Object?.Receiving) return { kind: 'receiving', ...input.Object.Receiving };
      if (input.Object?.ImmOrOwnedObject) return { kind: 'payment', ...input.Object.ImmOrOwnedObject };
      if (input.Pure) return { kind: 'pure', ...input.Pure };
      return { kind: inputKind(input) };
    }),
    arguments: call.arguments,
    paymentIntent,
    commandCount: data.commands.length,
  };
}

function expectedInputKind(name) {
  if (name === 'grossAtomic') return 'pure';
  if (name === 'payment') return 'payment';
  if (name === 'receiving' || name.endsWith('Receiving')) return 'receiving';
  return 'object';
}

function u64Base64(value) {
  const bytes = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return Buffer.from(bytes).toString('base64');
}

function expectedInput(argument) {
  if (argument.kind === 'object') return { kind: 'object', objectId: argument.objectId };
  if (argument.kind === 'receiving') {
    return {
      kind: argument.kind,
      objectId: argument.objectId,
      version: argument.version,
      digest: argument.digest,
    };
  }
  return { kind: 'pure', bytes: u64Base64(argument.value) };
}

function fullListTransactionBytes(result, { functionName, firstObjectId, extraCommand = null } = {}) {
  const descriptor = result.descriptor;
  const [packageIdValue, moduleName, defaultFunction] = descriptor.target.split('::');
  const inputs = descriptor.arguments.map((argument, index) => {
    if (argument.kind === 'u64') return Inputs.Pure(bcs.u64().serialize(BigInt(argument.value)));
    if (argument.kind === 'receiving') return Inputs.ReceivingRef({
      objectId: argument.objectId,
      version: argument.version,
      digest: argument.digest,
    });
    return Inputs.SharedObjectRef({
      objectId: index === 0 && firstObjectId ? firstObjectId : argument.objectId,
      initialSharedVersion: '1',
      mutable: true,
    });
  });
  const commands = [{
    MoveCall: {
      package: packageIdValue,
      module: moduleName,
      function: functionName || defaultFunction,
      typeArguments: [...descriptor.typeArguments],
      arguments: inputs.map((_, Input) => ({ Input, $kind: 'Input' })),
    },
    $kind: 'MoveCall',
  }];
  if (extraCommand) commands.push(extraCommand);
  const data = TransactionDataBuilder.restore({
    version: 2,
    sender: descriptor.sender,
    expiration: null,
    gasData: {
      budget: '10000000',
      price: '1000',
      owner: descriptor.sender,
      payment: [{ objectId: id(999), version: '1', digest }],
    },
    inputs,
    commands,
  });
  return toBase64(data.build());
}

function canonicalSigningClient({
  onDryRun,
  gasBudget = '10000000',
  gasPayment = [{ objectId: id(999), version: '1', digest }],
  gasAddressBalance = '20000000',
  mutateResolved,
} = {}) {
  const ownedObjectIds = new Set([
    IDs.admin, IDs.output, IDs.receipt, IDs.soul, IDs.baseAsset, IDs.packAsset,
  ]);
  return {
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async dryRunTransactionBlock({ transactionBlock }) {
      onDryRun?.(transactionBlock);
      return { effects: { status: { status: 'success' } } };
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '100' } }; },
      async getBalance({ coinType }) {
        if (coinType === normalizeStructTag('0x2::sui::SUI')) {
          return { balance: { balance: gasAddressBalance, coinBalance: '0', addressBalance: gasAddressBalance, coinType } };
        }
        return { balance: { balance: '1000000', coinBalance: '800000', addressBalance: '200000', coinType } };
      },
      async listCoins({ coinType }) {
        return {
          objects: Array.from({ length: 20 }, (_, index) => ({
            objectId: id(900 + index), version: '1', digest, balance: '40000', coinType,
          })),
          hasNextPage: false,
          cursor: null,
        };
      },
      resolveTransactionPlugin() {
        return async (transactionData, _options, next) => {
          transactionData.inputs = transactionData.inputs.map((input) => {
            if (!input.UnresolvedObject) return input;
            if (ownedObjectIds.has(input.UnresolvedObject.objectId)) {
              return Inputs.ObjectRef({
                objectId: input.UnresolvedObject.objectId,
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
            budget: gasBudget,
            price: '1000',
            owner: transactionData.sender,
            payment: gasPayment,
          };
          mutateResolved?.(transactionData);
          await next();
        };
      },
    },
  };
}

test('checked ABI fixture and client action table match all 14 exact Move signatures', () => {
  assert.equal(Object.keys(fixture.actions).length, 14);
  assert.deepEqual(Object.keys(MARKET_V8_ACTION_ABI), Object.keys(fixture.actions));
  for (const [action, expected] of Object.entries(fixture.actions)) {
    assert.equal(MARKET_V8_ACTION_ABI[action].function, expected.function);
    assert.deepEqual(MARKET_V8_ACTION_ABI[action].arguments, expected.clientArguments);
    assert.deepEqual(sourceParameters(expected.function), expected.parameters);
  }
  for (const [name, fields] of Object.entries(fixture.structFields)) {
    assert.deepEqual(sourceStructFields(name), fields);
  }
  for (const [name, fields] of Object.entries(fixture.eventFields)) {
    assert.deepEqual(sourceStructFields(name), fields);
  }
});

test('runtime and parsers pin every stable TypeOrigin and preserve u64/u128 as bigint', () => {
  assert.equal(client.runtime.callablePackageId, packageId('9'));
  assert.equal(client.types.marketRegistry.startsWith(`${packageId('9')}::market_v8::`), true);
  assert.equal(client.types.makerRoot.startsWith(`${packageId('1')}::maker_v8::`), true);
  assert.equal(client.types.completeOutput.startsWith(`${packageId('2')}::output_v8::`), true);
  assert.equal(client.types.physicalAsset.startsWith(`${packageId('3')}::physical_v8::`), true);
  assert.equal(client.types.packTreasury.startsWith(`${packageId('4')}::runtime_v8::`), true);
  assert.equal(typeof registry.fields.revision, 'bigint');
  assert.equal(typeof registry.fields.grossVolumeAtomic, 'bigint');
  assert.equal(typeof treasury.fields.grossEscrowedAtomic, 'bigint');
  assert.equal(makerListing.fields.sourceAtomic, 0n);
  assert.equal(soulListing.fields.custody.outputId, IDs.output);
  assert.equal(baseListing.fields.custody.sourceKind, MARKET_V8_PHYSICAL_SOURCES.BASE);
  assert.equal(packListing.fields.custody.sourceKind, MARKET_V8_PHYSICAL_SOURCES.PACK);

  const maxRegistry = structuredClone(registryResponse);
  maxRegistry.data.content.fields.gross_volume_atomic = ((1n << 128n) - 1n).toString();
  assert.equal(client.parseRegistry(maxRegistry).fields.grossVolumeAtomic, (1n << 128n) - 1n);
  maxRegistry.data.content.fields.gross_volume_atomic = (1n << 128n).toString();
  assert.throws(() => client.parseRegistry(maxRegistry), (error) => (
    error instanceof MarketV8ParseError && error.code === 'MARKET_V8_INTEGER_RANGE'
  ));
});

test('every action fails closed unless Market payment escrow is exactly zero and fully released', () => {
  for (const [field, value, code] of [
    ['escrow.value', '1', 'MARKET_V8_ESCROW_NOT_ZERO'],
    ['gross_released_atomic', '1', 'MARKET_V8_ESCROW_COUNTER_DRIFT'],
  ]) {
    const response = structuredClone(treasuryResponse);
    if (field === 'escrow.value') response.data.content.fields.escrow.value = value;
    else response.data.content.fields[field] = value;
    const invalidTreasury = client.parseTreasury(response);
    assert.throws(() => client.buildListMakerControl({
      ...common,
      treasury: invalidTreasury,
      wallet: wallet(IDs.seller),
      root: rootAt(MARKET_V8_LIFECYCLES.PAUSED),
      admin: object(IDs.admin, types.makerAdmin),
      makerTreasury,
      chainQuote: makerChainQuote,
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }), (error) => error instanceof MarketV8EligibilityError && error.code === code);
  }
});

test('quote mirror uses exact bigint shares and exact Move BCS commitment bytes', () => {
  assert.deepEqual(makerQuote, {
    version: 8n,
    quoteKind: 0,
    rootId: IDs.root,
    makerVersion: 42n,
    rootContentCommitment: bytesHex(0xaa),
    economicsCommitment: bytesHex(0xbb),
    rightsCommitment: bytesHex(0xcc),
    grossAtomic: 1_000_000n,
    protocolAtomic: 25_000n,
    creatorAtomic: 40_000n,
    sourceAtomic: 0n,
    sellerAtomic: 935_000n,
    commitment: makerQuote.commitment,
  });
  assert.deepEqual(assetQuote, {
    ...makerQuote,
    quoteKind: 2,
    protocolAtomic: 30_000n,
    creatorAtomic: 50_000n,
    sourceAtomic: 20_000n,
    sellerAtomic: 900_000n,
    commitment: assetQuote.commitment,
  });
  const commitmentInput = {
    version: 8n,
    quoteKind: 2n,
    rootId: IDs.root,
    makerVersion: 42n,
    rootContentCommitment: bytesHex(0xaa),
    economicsCommitment: bytesHex(0xbb),
    rightsCommitment: bytesHex(0xcc),
    grossAtomic: 1_000_000n,
    protocolAtomic: 30_000n,
    creatorAtomic: 50_000n,
    sourceAtomic: 20_000n,
    sellerAtomic: 900_000n,
  };
  const bcsHex = [...marketQuoteCommitmentBcsV8(commitmentInput)]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  assert.equal(bcsHex, fixture.quoteCommitment.bcsHex);
  assert.equal(deriveMarketQuoteCommitmentV8(commitmentInput), fixture.quoteCommitment.sha256);
  assert.throws(() => client.quoteMakerResale(registry, 1_000_000), (error) => (
    error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_INTEGER_INVALID'
  ));
  assert.throws(() => client.quoteMakerResale(registry, 1n), (error) => (
    error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_SHARE_ROUNDS_TO_ZERO'
  ));
  assert.doesNotThrow(() => client.quotePhysicalResale(registry, (1n << 64n) - 1n));
});

const quoteBcs = bcs.struct('MarketQuoteV8', {
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

const hexVector = (value) => Uint8Array.from(value.slice(2).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
function quoteBytes(quote) {
  return quoteBcs.serialize({
    quote_kind: quote.quoteKind,
    root_id: quote.rootId,
    maker_version: quote.makerVersion,
    root_content_commitment: hexVector(quote.rootContentCommitment),
    economics_commitment: hexVector(quote.economicsCommitment),
    rights_commitment: hexVector(quote.rightsCommitment),
    gross_atomic: quote.grossAtomic,
    protocol_atomic: quote.protocolAtomic,
    creator_atomic: quote.creatorAtomic,
    source_atomic: quote.sourceAtomic,
    seller_atomic: quote.sellerAtomic,
    commitment: hexVector(quote.commitment),
  }).toBytes();
}

async function inspectedProof(quoteKind, quote, sender = IDs.buyer) {
  return client.inspectQuoteOnChain({
    async simulateTransaction() {
      return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(quote) }] }] };
    },
  }, {
    registry,
    treasury,
    root: common.root,
    wallet: wallet(sender),
    quoteKind,
    grossAtomic: 1_000_000n,
  });
}

const makerChainQuote = await inspectedProof(MARKET_V8_QUOTE_KINDS.MAKER_RESALE, makerQuote);
const soulChainQuote = await inspectedProof(MARKET_V8_QUOTE_KINDS.SOUL_RESALE, soulQuote);
const physicalChainQuote = await inspectedProof(MARKET_V8_QUOTE_KINDS.PHYSICAL_RESALE, assetQuote);

test('quote review runs a real Market PTB dry-run, decodes BCS, and rejects drift', async () => {
  const input = {
    registry,
    treasury,
    root: common.root,
    wallet: wallet(IDs.buyer),
    quoteKind: MARKET_V8_QUOTE_KINDS.MAKER_RESALE,
    grossAtomic: 1_000_000n,
  };
  const built = buildMarketQuoteInspectionV8(runtimeInput, input);
  const data = built.transaction.getData();
  assert.equal(data.sender, IDs.buyer);
  assert.equal(data.commands[0].MoveCall.function, 'quote_maker_resale_v8');
  assert.equal(data.commands[0].MoveCall.package, runtimeInput.roles.market.callablePackageId);
  assert.equal(data.commands[0].MoveCall.typeArguments[0], runtimeInput.paymentCoinType);
  assert.deepEqual(parseMarketQuoteV8Bcs(quoteBytes(makerQuote)), makerQuote);

  const inspected = await inspectMarketQuoteOnChainV8({
    async simulateTransaction({ transaction, include }) {
      assert.equal(transaction.getData().commands[0].MoveCall.function, 'quote_maker_resale_v8');
      assert.deepEqual(include, { commandResults: true });
      return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(makerQuote) }] }] };
    },
  }, runtimeInput, input);
  assert.equal(inspected.commitment, makerQuote.commitment);
  assert.equal(inspected.evidence.source, 'chain-dry-run');

  const driftFields = {
    ...makerQuote,
    creatorAtomic: makerQuote.creatorAtomic + 1n,
    sellerAtomic: makerQuote.sellerAtomic - 1n,
  };
  const drift = { ...driftFields, commitment: deriveMarketQuoteCommitmentV8(driftFields) };
  await assert.rejects(() => client.inspectQuoteOnChain({
    async devInspectTransactionBlock() {
      return { effects: { status: { status: 'success' } }, results: [{ returnValues: [[[...quoteBytes(drift)], '0x0::market::MarketQuoteV8']] }] };
    },
  }, input), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_QUOTE_DRIFT');
});

test('all 14 builders snapshot real Transaction data with exact targets, types, argument order, and Receiving lanes', () => {
  const actions = allActions();
  assert.deepEqual(Object.keys(actions), Object.keys(fixture.actions));
  for (const [action, result] of Object.entries(actions)) {
    const expected = fixture.actions[action];
    const snapshot = transactionSnapshot(result);
    let inputIndex = 0;
    const expectedArguments = result.descriptor.arguments.map((argument) => {
      if (argument.kind === 'payment') return { Result: 0, '$kind': 'Result' };
      const current = inputIndex;
      inputIndex += 1;
      return { Input: current, type: argument.kind === 'u64' ? 'pure' : 'object', '$kind': 'Input' };
    });
    const paymentArgument = result.descriptor.arguments.find((argument) => argument.kind === 'payment');
    assert.deepEqual(snapshot, {
      version: 2,
      sender: result.descriptor.sender,
      expiration: null,
      gasData: { budget: null, price: null, owner: null, payment: null },
      package: runtimeInput.roles.market.callablePackageId,
      module: 'market_v8',
      function: expected.function,
      typeArguments: [client.runtime.paymentCoinType],
      inputs: result.descriptor.arguments.filter((argument) => argument.kind !== 'payment').map(expectedInput),
      arguments: expectedArguments,
      paymentIntent: paymentArgument ? {
        type: client.runtime.paymentCoinType,
        balance: 1_000_000n,
        outputKind: 'coin',
      } : null,
      commandCount: paymentArgument ? 2 : 1,
    }, action);
    assert.deepEqual(result.descriptor.arguments.map(({ name, kind }) => ({ name, kind })),
      expected.clientArguments.map((name) => ({ name, kind: expectedInputKind(name) === 'payment' ? 'payment' : expectedInputKind(name) === 'pure' ? 'u64' : expectedInputKind(name) })));
  }
  const receivingCounts = Object.fromEntries(Object.entries(actions).map(([action, result]) => [
    action,
    result.transaction.getData().inputs.filter((input) => input.Object?.Receiving).length,
  ]));
  assert.deepEqual(receivingCounts, {
    listMakerControl: 0,
    purchaseMakerControl: 1,
    cancelMakerControl: 1,
    recoverMakerControl: 1,
    listSoulBundle: 0,
    purchaseSoulBundle: 3,
    cancelSoulListing: 3,
    recoverSoulListing: 3,
    listBasePhysical: 0,
    listPackPhysical: 0,
    purchaseBasePhysical: 1,
    purchasePackPhysical: 1,
    cancelPhysicalListing: 1,
    recoverPhysicalListing: 1,
  });
  for (const result of Object.values(actions).filter(({ descriptor }) => descriptor.action.startsWith('purchase'))) {
    assert.equal(result.transaction.getData().inputs.filter((input) => input.Object?.ImmOrOwnedObject).length, 0);
    assert.equal(result.transaction.getData().commands.filter((command) => command.$Intent?.name === 'CoinWithBalance').length, 1);
    assert.equal(result.descriptor.arguments.filter((argument) => argument.kind === 'payment').length, 1);
    assert.equal(result.descriptor.arguments.find((argument) => argument.kind === 'payment').balanceAtomic, '1000000');
  }
});

test('signing evidence binds branded builder output, Mainnet dry run, and decoded full TransactionData bytes', async () => {
  const built = allActions().listMakerControl;
  built.transaction.moveCall({ target: `${packageId('e')}::evil::steal`, arguments: [] });
  let simulatedBytes;
  const dryRunProof = await inspectMarketActionOnChainV8(canonicalSigningClient({
    onDryRun(bytes) { simulatedBytes = bytes; },
  }), built);
  const evidence = createMarketV8RecoveryEvidenceV8(built, dryRunProof);
  assert.equal(simulatedBytes, evidence.transactionBytes);
  const signedSnapshot = TransactionDataBuilder.fromBytes(Buffer.from(evidence.transactionBytes, 'base64')).snapshot();
  assert.equal(signedSnapshot.commands.some((command) => command.MoveCall?.module === 'evil'), false);
  assert.equal(assertMarketV8RecoveryEvidenceV8(evidence), evidence);
  assert.equal(evidence.descriptor.action, 'listMakerControl');
  assert.equal(evidence.runtime, attestedRuntime);
  assert.equal(evidence.transactionDigest, TransactionDataBuilder.getDigestFromBytes(Buffer.from(evidence.transactionBytes, 'base64')));
  assert.equal(Number.isSafeInteger(evidence.dryRunAtMs), true);
  assert.deepEqual(evidence.epochWindow, { start: '100', end: '101' });
  assert.deepEqual(evidence.expiration, { kind: 'Epoch', epoch: '101' });
  assert.deepEqual(evidence.gasData, {
    owner: IDs.seller,
    budget: '10000000',
    price: '1000',
    payment: [{ objectId: id(999), version: '1', digest }],
    funding: { kind: 'OBJECT_REFS' },
  });
  assert.match(evidence.sourceFingerprint, /^0x[0-9a-f]{64}$/);
  assert.throws(
    () => createMarketV8RecoveryEvidenceV8(built, dryRunProof),
    (error) => error.code === 'MARKET_V8_ACTION_DRY_RUN_PROOF_REQUIRED',
  );

  assert.throws(
    () => createMarketV8RecoveryEvidenceV8({ ...built }, dryRunProof),
    (error) => error.code === 'MARKET_V8_BUILT_ACTION_REQUIRED',
  );
  assert.throws(
    () => createMarketV8RecoveryEvidenceV8(built, evidence.transactionBytes, dryRunProof),
    (error) => error.code === 'MARKET_V8_CALLER_TRANSACTION_BYTES_FORBIDDEN',
  );
  assert.throws(
    () => assertMarketV8RecoveryEvidenceV8({ ...evidence }),
    (error) => error.code === 'MARKET_V8_RECOVERY_EVIDENCE_REQUIRED',
  );
  assert.throws(
    () => createMarketV8RecoveryEvidenceV8(built, { ...dryRunProof }),
    (error) => error.code === 'MARKET_V8_ACTION_DRY_RUN_PROOF_REQUIRED',
  );
  assert.equal(consumeMarketV8RecoveryEvidenceV8(evidence), evidence);
  assert.throws(
    () => consumeMarketV8RecoveryEvidenceV8(evidence),
    (error) => error.code === 'MARKET_V8_RECOVERY_EVIDENCE_REQUIRED',
  );
});

test('all 14 actions build final pinned-SDK bytes internally; purchase CoinWithBalance uses exact private dataflow', async () => {
  for (const [action, built] of Object.entries(allActions())) {
    const proof = await inspectMarketActionOnChainV8(canonicalSigningClient(), built);
    const evidence = createMarketV8RecoveryEvidenceV8(built, proof);
    const snapshot = TransactionDataBuilder.fromBytes(Buffer.from(evidence.transactionBytes, 'base64')).snapshot();
    const marketCalls = snapshot.commands.filter((command) => command.MoveCall?.package === runtimeInput.roles.market.callablePackageId);
    assert.equal(marketCalls.length, 1, action);
    assert.equal(marketCalls[0].MoveCall.function, fixture.actions[action].function, action);
    assert.deepEqual(snapshot.expiration, { Epoch: 101, '$kind': 'Epoch' }, action);
    assert.equal(snapshot.sender, built.descriptor.sender, action);
    assert.equal(snapshot.gasData.owner, built.descriptor.sender, action);
    if (action.startsWith('purchase')) {
      assert.equal(snapshot.commands.some((command) => command.MergeCoins), true, action);
      assert.equal(snapshot.commands.some((command) => command.SplitCoins), true, action);
      const sendFunds = snapshot.commands.find((command) => command.MoveCall?.module === 'coin'
        && command.MoveCall?.function === 'send_funds');
      assert.ok(sendFunds, action);
      const recipient = snapshot.inputs[sendFunds.MoveCall.arguments[1].Input]?.Pure?.bytes;
      assert.equal(recipient, toBase64(bcs.Address.serialize(built.descriptor.sender).toBytes()), action);
      assert.ok(evidence.transactionBytes.length > 2_048, `${action} should exercise a recovery payload above the legacy text bound`);
    } else {
      assert.equal(snapshot.commands.length, 1, action);
    }
  }
});

test('caller-authored final bytes have no signing-evidence ingress, including formerly allowed command shapes', async () => {
  const built = allActions().listMakerControl;
  const variants = [
    fullListTransactionBytes(built, { functionName: 'recover_maker_control_listing_v8' }),
    fullListTransactionBytes(built, { firstObjectId: id(998) }),
    fullListTransactionBytes(built, { extraCommand: { SplitCoins: { coin: { GasCoin: true, '$kind': 'GasCoin' }, amounts: [{ Input: 8, '$kind': 'Input' }] }, '$kind': 'SplitCoins' } }),
    fullListTransactionBytes(built, { extraCommand: { TransferObjects: { objects: [{ GasCoin: true, '$kind': 'GasCoin' }], address: { Input: 8, '$kind': 'Input' } }, '$kind': 'TransferObjects' } }),
  ];
  for (const bytes of variants) {
    await assert.rejects(
      () => inspectMarketActionOnChainV8(canonicalSigningClient(), built, bytes),
      (error) => error.code === 'MARKET_V8_CALLER_TRANSACTION_BYTES_FORBIDDEN',
    );
  }
});

test('canonical signing rejects excessive gas, wrong gas owner, and resolver expiration drift before dry-run', async () => {
  const built = allActions().listMakerControl;
  await assert.rejects(
    () => inspectMarketActionOnChainV8(canonicalSigningClient({ gasBudget: '500000001' }), built),
    (error) => error.code === 'MARKET_V8_TRANSACTION_GAS_INVALID',
  );
  await assert.rejects(
    () => inspectMarketActionOnChainV8(canonicalSigningClient({
      mutateResolved(transactionData) { transactionData.gasData.owner = IDs.buyer; },
    }), built),
    (error) => error.code === 'MARKET_V8_TRANSACTION_SENDER_MISMATCH',
  );
  await assert.rejects(
    () => inspectMarketActionOnChainV8(canonicalSigningClient({
      mutateResolved(transactionData) { transactionData.expiration = { Epoch: '102', '$kind': 'Epoch' }; },
    }), built),
    (error) => error.code === 'MARKET_V8_TRANSACTION_EXPIRATION_MISMATCH',
  );
});

test('pinned SDK empty gas payment is accepted only with sufficient live SUI address balance', async () => {
  const built = allActions().listMakerControl;
  const proof = await inspectMarketActionOnChainV8(canonicalSigningClient({ gasPayment: [] }), built);
  const evidence = createMarketV8RecoveryEvidenceV8(built, proof);
  assert.deepEqual(evidence.gasData, {
    owner: IDs.seller,
    budget: '10000000',
    price: '1000',
    payment: [],
    funding: {
      kind: 'ADDRESS_BALANCE',
      addressBalance: '20000000',
      coinType: normalizeStructTag('0x2::sui::SUI'),
    },
  });
  await assert.rejects(
    () => inspectMarketActionOnChainV8(canonicalSigningClient({
      gasPayment: [],
      gasAddressBalance: '9999999',
    }), built),
    (error) => error.code === 'MARKET_V8_ADDRESS_GAS_INSUFFICIENT',
  );
});

test('parsed Market values and chain quote proofs cannot be forged by object spread', () => {
  const registryClone = { ...registry, fields: { ...registry.fields, revision: 999n } };
  assert.throws(() => client.quoteMakerResale(registryClone, 1_000_000n), (error) => (
    error.code === 'MARKET_V8_PARSED_REGISTRY_REQUIRED'
  ));
  const quoteClone = { ...makerChainQuote, grossAtomic: 2_000_000n };
  assert.throws(() => client.buildListMakerControl({
    ...common,
    wallet: wallet(IDs.seller),
    root: rootAt(MARKET_V8_LIFECYCLES.PAUSED),
    admin: object(IDs.admin, types.makerAdmin),
    makerTreasury,
    grossAtomic: 1_000_000n,
    expectedRegistryRevision: registry.fields.revision,
    chainQuote: quoteClone,
  }), (error) => error.code === 'MARKET_V8_CHAIN_QUOTE_REQUIRED');
});

test('runtime, object, listing, and event parsers reject wrong types, origins, fields, and bindings', () => {
  assert.throws(() => assertMarketV8Runtime({
    ...runtimeInput,
    unexpected: true,
  }), (error) => error instanceof MarketV8RuntimeError && error.code === 'MAKER_V8_UNKNOWN_FIELD');
  assert.throws(() => assertMarketV8Runtime({
    ...runtimeInput,
    roles: { ...runtimeInput.roles, market: { ...runtimeInput.roles.market, callablePackageId: packageId('A') } },
  }), (error) => error instanceof MarketV8RuntimeError);
  assert.throws(() => createMarketV8Client(runtimeInput, { network: 'testnet' }), (error) => (
    error instanceof MarketV8RuntimeError && error.code === 'MARKET_V8_NETWORK_INVALID'
  ));

  const upgradedCallableOrigin = structuredClone(registryResponse);
  upgradedCallableOrigin.data.content.type = upgradedCallableOrigin.data.content.type.replace(packageId('9'), packageId('5'));
  assert.throws(() => client.parseRegistry(upgradedCallableOrigin), (error) => (
    error instanceof MarketV8ParseError && error.code === 'MARKET_V8_TYPE_ORIGIN_MISMATCH'
  ));
  const wrongCoin = structuredClone(registryResponse);
  wrongCoin.data.content.type = wrongCoin.data.content.type.replace(client.runtime.paymentCoinType, `${packageId('6')}::coin::WRONG`);
  assert.throws(() => client.parseRegistry(wrongCoin), (error) => (
    error instanceof MarketV8ParseError && error.code === 'MARKET_V8_TYPE_ORIGIN_MISMATCH'
  ));
  const unknownField = structuredClone(registryResponse);
  unknownField.data.content.fields.shadow_admin = IDs.buyer;
  assert.throws(() => client.parseRegistry(unknownField), (error) => (
    error instanceof MarketV8ParseError && error.code === 'MARKET_V8_FIELDS_INVALID'
  ));
  const wrongUid = structuredClone(soulListingResponse());
  wrongUid.data.content.fields.custody.listing_id = IDs.makerListing;
  assert.throws(() => client.parseSoulListing(wrongUid), (error) => (
    error instanceof MarketV8ParseError && error.code === 'MARKET_V8_LISTING_BINDING_INVALID'
  ));

  const opened = {
    type: `${runtimeInput.roles.market.typeOriginPackageId}::market_v8::MarketListingOpenedV8`,
    parsedJson: {
      listing_id: IDs.soulListing,
      registry_id: IDs.registry,
      lane: '1',
      root_id: IDs.root,
      asset_id: IDs.soul,
      seller: IDs.seller,
      ownership_epoch: '3',
      gross_atomic: '1000000',
      quote_commitment: assetQuote.commitment,
    },
  };
  assert.equal(client.parseEvent(opened).fields.lane, MARKET_V8_LANES.SOUL);
  assert.equal(client.parseEvent({
    type: `${runtimeInput.roles.market.typeOriginPackageId}::market_v8::MarketRegistrySealedV8`,
    parsedJson: {
      root_id: IDs.root,
      registry_id: IDs.registry,
      treasury_id: IDs.treasury,
      zero_state_commitment: bytes32(3),
    },
  }).fields.zeroStateCommitment, bytesHex(3));
  assert.equal(client.parseEvent({
    type: `${runtimeInput.roles.market.typeOriginPackageId}::market_v8::MarketListingSettledV8`,
    parsedJson: {
      listing_id: IDs.baseListing,
      registry_id: IDs.registry,
      lane: '2',
      asset_id: IDs.baseAsset,
      seller: IDs.seller,
      buyer: IDs.buyer,
      gross_atomic: '1000000',
      protocol_atomic: '30000',
      creator_atomic: '50000',
      source_atomic: '20000',
      seller_atomic: '900000',
    },
  }).fields.buyer, IDs.buyer);
  assert.equal(client.parseEvent({
    type: `${runtimeInput.roles.market.typeOriginPackageId}::market_v8::MarketListingClosedV8`,
    parsedJson: {
      listing_id: IDs.packListing,
      registry_id: IDs.registry,
      lane: '3',
      asset_id: IDs.packAsset,
      seller: IDs.seller,
      recovered: true,
    },
  }).fields.recovered, true);
  assert.throws(() => client.parseEvent({
    ...opened,
    type: opened.type.replace(packageId('9'), packageId('5')),
  }), (error) => error instanceof MarketV8ParseError && error.code === 'MARKET_V8_EVENT_TYPE_ORIGIN_MISMATCH');
});

test('builders reject wrong imported types and exact Receiving refs for 1/3/1 custody', () => {
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    wallet: { address: IDs.buyer, network: 'testnet' },
    protocolTreasury,
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_NETWORK_INVALID');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    root: { ...common.root, network: 'testnet' },
    protocolTreasury,
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_NETWORK_INVALID');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    root: object(IDs.root, types.completeOutput),
    protocolTreasury,
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_TYPE_MISMATCH');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    adminReceiving: receiving(IDs.receipt, types.makerAdmin),
    protocolTreasury,
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_REF_MISMATCH');
  assert.throws(() => client.buildPurchaseSoulBundle({
    ...soulExisting(),
    makerTreasury,
    protocolTreasury,
    receiptReceiving: receiving(IDs.output, types.completeReceipt),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_REF_MISMATCH');
  assert.throws(() => client.buildPurchaseBasePhysical({
    ...physicalExisting(baseListing),
    makerTreasury,
    protocolTreasury,
    receiving: receiving(IDs.packAsset, types.physicalAsset),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_REF_MISMATCH');
});

test('eligibility rejects terminal status, stale revisions and quote commitment, and seller self-buy', () => {
  const settled = client.parseMakerListing(makerListingResponse({ status: '1', terminal_recipient: IDs.buyer }));
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(settled),
    protocolTreasury,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_LISTING_NOT_OPEN');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    expectation: { ...expectation(makerListing), listingRevision: 1n },
    protocolTreasury,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_STALE_LISTING_REVISION');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    expectation: { ...expectation(makerListing), registryRevision: 3n },
    protocolTreasury,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_STALE_REGISTRY_REVISION');
  const staleQuote = client.parseMakerListing(makerListingResponse({ quote_commitment: bytes32(9) }));
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(staleQuote),
    protocolTreasury,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_STALE_QUOTE');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(makerListing, IDs.seller),
    protocolTreasury,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_SELLER_SELF_BUY');
});

test('Base and Pack builders are statically distinct and reject cross-lane/source substitution', () => {
  assert.throws(() => client.buildPurchaseBasePhysical({
    ...physicalExisting(packListing),
    makerTreasury,
    protocolTreasury,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_CROSS_SOURCE');
  assert.throws(() => client.buildPurchasePackPhysical({
    ...physicalExisting(baseListing),
    packRelease,
    packTreasury,
    protocolTreasury,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_CROSS_SOURCE');
  assert.throws(() => client.buildListBasePhysical({
    ...common,
    wallet: wallet(IDs.seller),
    physicalRegistry,
    physicalConfig,
    makerTreasury,
    chainQuote: physicalChainQuote,
    asset: object(IDs.packAsset, types.physicalAsset, { sourceKind: '1', sourceTreasuryId: IDs.makerTreasury }),
    grossAtomic: 1_000_000n,
    expectedRegistryRevision: 4n,
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_CROSS_SOURCE');
  assert.throws(() => client.buildListBasePhysical({
    ...common,
    wallet: wallet(IDs.seller),
    physicalRegistry,
    physicalConfig,
    makerTreasury,
    chainQuote: physicalChainQuote,
    asset: object(IDs.baseAsset, types.physicalAsset, { sourceKind: '0', sourceTreasuryId: IDs.makerTreasury }),
    grossAtomic: 1_000_000n,
    expectedRegistryRevision: 4n,
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_SOURCE_TREASURY_MISMATCH');
  const actions = allActions();
  assert.equal(actions.listBasePhysical.descriptor.target.endsWith('::list_base_physical_v8'), true);
  assert.equal(actions.listPackPhysical.descriptor.target.endsWith('::list_pack_physical_v8'), true);
  assert.equal(actions.purchaseBasePhysical.descriptor.arguments[5].type, types.makerTreasury);
  assert.equal(actions.purchasePackPhysical.descriptor.arguments[5].type, types.packRelease);
  assert.equal(actions.purchasePackPhysical.descriptor.arguments[6].type, types.packTreasury);
});

test('purchase derives one exact-value CoinWithBalance and forbids caller-authored payment objects', () => {
  const base = { ...makerExisting(), protocolTreasury };
  const built = client.buildPurchaseMakerControl(base);
  const intent = built.transaction.getData().commands.find((command) => command.$Intent?.name === 'CoinWithBalance');
  assert.deepEqual(intent.$Intent.data, {
    type: runtimeInput.paymentCoinType,
    balance: 1_000_000n,
    outputKind: 'coin',
  });
  for (const supplied of [
    payment(IDs.paymentMaker, '999999'),
    payment(IDs.paymentMaker, '1000000'),
    payment(IDs.paymentMaker, '1000001'),
    [payment(IDs.paymentMaker)],
  ]) {
    assert.throws(() => client.buildPurchaseMakerControl({
      ...base,
      payment: supplied,
    }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_CALLER_PAYMENT_FORBIDDEN');
  }
  assert.throws(() => client.buildListSoulBundle({
    ...common,
    wallet: wallet(IDs.seller),
    outputRegistry,
    soulRegistry,
    outputAsset: object(IDs.output, types.completeOutput, { outputCommitment: bytes32(10) }),
    receipt: object(IDs.receipt, types.completeReceipt, { receiptCommitment: bytes32(11) }),
    soul: object(IDs.soul, types.canonicalSoul, { soulCommitment: bytes32(12) }),
    grossAtomic: 1_000_000,
    expectedRegistryRevision: 4n,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_INTEGER_INVALID');
});

test('cancel remains available across quote drift while recovery mirrors Maker versus asset lifecycle rules', () => {
  const driftedResponse = structuredClone(registryResponse);
  driftedResponse.data.content.fields.economics_commitment = bytes32(0xee);
  const driftedRegistry = client.parseRegistry(driftedResponse);
  const canceled = client.buildCancelMakerControl({
    ...makerExisting(makerListing, IDs.seller),
    registry: driftedRegistry,
    expectation: {
      listingRevision: 0n,
      registryRevision: 4n,
      quoteCommitment: makerListing.fields.quoteCommitment,
    },
  });
  assert.equal(canceled.descriptor.action, 'cancelMakerControl');
  assert.throws(() => client.buildRecoverMakerControl({
    ...makerExisting(makerListing, IDs.recoveryCaller),
    root: rootAt(MARKET_V8_LIFECYCLES.PAUSED),
    protocolConfig: currentProtocol,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_NOT_RECOVERABLE');
  assert.doesNotThrow(() => client.buildRecoverSoulListing({
    ...soulExisting(soulListing, IDs.recoveryCaller),
    root: rootAt(MARKET_V8_LIFECYCLES.PAUSED),
    protocolConfig: currentProtocol,
  }));
});

const FINALIZED_EVENT_BCS = Object.freeze({
  MarketListingOpenedV8: bcs.struct('MarketListingOpenedV8Production', {
    listing_id: bcs.Address, registry_id: bcs.Address, lane: bcs.u8(), root_id: bcs.Address,
    asset_id: bcs.Address, seller: bcs.Address, ownership_epoch: bcs.u64(),
    gross_atomic: bcs.u64(), quote_commitment: bcs.vector(bcs.u8()),
  }),
  MarketListingSettledV8: bcs.struct('MarketListingSettledV8Production', {
    listing_id: bcs.Address, registry_id: bcs.Address, lane: bcs.u8(), asset_id: bcs.Address,
    seller: bcs.Address, buyer: bcs.Address, gross_atomic: bcs.u64(), protocol_atomic: bcs.u64(),
    creator_atomic: bcs.u64(), source_atomic: bcs.u64(), seller_atomic: bcs.u64(),
  }),
  MarketListingClosedV8: bcs.struct('MarketListingClosedV8Production', {
    listing_id: bcs.Address, registry_id: bcs.Address, lane: bcs.u8(), asset_id: bcs.Address,
    seller: bcs.Address, recovered: bcs.bool(),
  }),
  MakerControlTransferredV8: bcs.struct('MakerControlTransferredV8Production', {
    root_id: bcs.Address, previous_owner: bcs.Address, new_owner: bcs.Address,
    previous_control_epoch: bcs.u64(), new_control_epoch: bcs.u64(), new_admin_cap_id: bcs.Address,
  }),
  PhysicalMarketCustodyTransitionV8: bcs.struct('PhysicalMarketCustodyTransitionV8Production', {
    action: bcs.u8(), listing_id: bcs.Address, asset_id: bcs.Address, source_kind: bcs.u8(),
    source_treasury_id: bcs.Address, previous_holder: bcs.Address, holder: bcs.Address,
    previous_ownership_epoch: bcs.u64(), ownership_epoch: bcs.u64(),
    provenance_commitment: bcs.vector(bcs.u8()),
  }),
});

const FINALIZED_SOUL_COMMITMENT_INPUT_BCS = bcs.struct('SoulCommitmentInputV8Production', {
  domain: bcs.vector(bcs.u8()),
  version: bcs.u64(),
  soul_registry_id: bcs.Address,
  root_id: bcs.Address,
  maker_version: bcs.u64(),
  root_content_commitment: bcs.vector(bcs.u8()),
  output_key: bcs.string(),
  output_policy_commitment: bcs.vector(bcs.u8()),
  holder: bcs.Address,
  ownership_epoch: bcs.u64(),
  output_id: bcs.Address,
  receipt_id: bcs.Address,
  recipe_commitment: bcs.vector(bcs.u8()),
  render_commitment: bcs.vector(bcs.u8()),
  output_commitment: bcs.vector(bcs.u8()),
  receipt_commitment: bcs.vector(bcs.u8()),
  soul_creator_royalty_bps: bcs.u16(),
  maker_source_royalty_bps: bcs.u16(),
});
const FINALIZED_SOUL_COMMITMENT_DOMAIN = new TextEncoder()
  .encode('animacraft-v8/output/canonical-soul');

const finalizedSharedOwner = Object.freeze({ $kind: 'Shared', Shared: { initialSharedVersion: '1' } });
const finalizedCreatedSharedOwner = Object.freeze({ $kind: 'Shared', Shared: { initialSharedVersion: '8' } });
const finalizedAddressOwner = (owner) => ({ $kind: 'AddressOwner', AddressOwner: owner });
const finalizedObjectOwner = (owner) => ({ $kind: 'ObjectOwner', ObjectOwner: owner });
const finalizedHexBytes = (value) => Uint8Array.from(value.slice(2).match(/.{2}/g), (pair) => Number.parseInt(pair, 16));

function finalizedSoulCommitment(fields) {
  const encoded = FINALIZED_SOUL_COMMITMENT_INPUT_BCS.serialize({
    domain: FINALIZED_SOUL_COMMITMENT_DOMAIN,
    version: fields.version,
    soul_registry_id: fields.soul_registry_id,
    root_id: fields.root_id,
    maker_version: fields.maker_version,
    root_content_commitment: finalizedHexBytes(fields.root_content_commitment),
    output_key: fields.output_key,
    output_policy_commitment: finalizedHexBytes(fields.output_policy_commitment),
    holder: fields.holder,
    ownership_epoch: fields.ownership_epoch,
    output_id: fields.output_id,
    receipt_id: fields.receipt_id,
    recipe_commitment: finalizedHexBytes(fields.recipe_commitment),
    render_commitment: finalizedHexBytes(fields.render_commitment),
    output_commitment: finalizedHexBytes(fields.output_commitment),
    receipt_commitment: finalizedHexBytes(fields.receipt_commitment),
    soul_creator_royalty_bps: Number(fields.soul_creator_royalty_bps),
    maker_source_royalty_bps: Number(fields.maker_source_royalty_bps),
  }).toBytes();
  return `0x${[...sha256(encoded)].map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
}

function finalizedStableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(finalizedStableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${finalizedStableJson(value[key])}`).join(',')}}`;
}

function finalizedHash(value) {
  return `0x${[...sha256(new TextEncoder().encode(finalizedStableJson(value)))]
    .map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
}

function finalizedActionKind(action) {
  if (action.startsWith('list')) return 'LIST';
  if (action.startsWith('purchase')) return 'PURCHASE';
  if (action.startsWith('cancel')) return 'CANCEL';
  return 'RECOVER';
}

function finalizedRegistryAfter(before, kind, quote) {
  const after = { ...before, revision: (BigInt(before.revision) + 1n).toString() };
  if (kind === 'LIST') {
    after.listing_count = (BigInt(before.listing_count) + 1n).toString();
    after.escrow_count = (BigInt(before.escrow_count) + 1n).toString();
  } else if (kind === 'PURCHASE') {
    after.escrow_count = (BigInt(before.escrow_count) - 1n).toString();
    after.completed_sale_count = (BigInt(before.completed_sale_count) + 1n).toString();
    for (const [field, amount] of [
      ['gross_volume_atomic', quote.grossAtomic], ['protocol_paid_atomic', quote.protocolAtomic],
      ['creator_paid_atomic', quote.creatorAtomic], ['source_paid_atomic', quote.sourceAtomic],
      ['seller_paid_atomic', quote.sellerAtomic],
    ]) after[field] = (BigInt(before[field]) + BigInt(amount)).toString();
  } else {
    after.escrow_count = (BigInt(before.escrow_count) - 1n).toString();
    const field = kind === 'CANCEL' ? 'canceled_sale_count' : 'recovered_sale_count';
    after[field] = (BigInt(before[field]) + 1n).toString();
  }
  return after;
}

function finalizedListingFields(descriptor, listingId, status, revision, terminalRecipient) {
  const { preState } = descriptor;
  const commonFields = {
    version: '8',
    registry_id: descriptor.registryId,
    treasury_id: descriptor.treasuryId,
    package_config_id: descriptor.roleConfigIds.market,
    gross_atomic: preState.quote.grossAtomic,
    protocol_atomic: preState.quote.protocolAtomic,
    creator_atomic: preState.quote.creatorAtomic,
    seller_atomic: preState.quote.sellerAtomic,
    quote_commitment: preState.quote.commitment,
    status: String(status),
    revision: String(revision),
    terminal_recipient: terminalRecipient,
  };
  if (descriptor.lane === MARKET_V8_LANES.MAKER) return {
    ...commonFields,
    root_id: descriptor.rootId,
    maker_version: '42',
    root_content_commitment: descriptor.rootContentCommitment,
    admin_cap_id: preState.assetIds[0],
    seller: preState.seller,
    expected_control_epoch: preState.ownershipEpoch,
  };
  if (descriptor.lane === MARKET_V8_LANES.SOUL) return {
    ...commonFields,
    source_atomic: preState.quote.sourceAtomic,
    custody: {
      listing_id: listingId,
      output_registry_id: preState.soul.outputRegistryId,
      soul_registry_id: preState.soul.soulRegistryId,
      market_registry_id: descriptor.registryId,
      market_treasury_id: descriptor.treasuryId,
      root_id: descriptor.rootId,
      maker_version: '42',
      root_content_commitment: descriptor.rootContentCommitment,
      output_id: preState.assetIds[0],
      receipt_id: preState.assetIds[1],
      soul_id: preState.assetIds[2],
      output_commitment: preState.soul.outputCommitment,
      receipt_commitment: preState.soul.receiptCommitment,
      soul_commitment: preState.soul.soulCommitment,
      seller: preState.seller,
      expected_soul_ownership_epoch: preState.ownershipEpoch,
    },
  };
  return {
    ...commonFields,
    source_atomic: preState.quote.sourceAtomic,
    custody: {
      version: '8',
      catalog_id: descriptor.catalogId,
      product_binding_commitment: bytesHex(41),
      call_cap_set_commitment: bytesHex(42),
      market_authority_id: id(850),
      market_registry_id: descriptor.registryId,
      market_treasury_id: descriptor.treasuryId,
      listing_id: listingId,
      physical_package_config_id: descriptor.roleConfigIds.physical,
      physical_registry_id: descriptor.arguments.find((entry) => entry.name === 'physicalRegistry').objectId,
      root_id: descriptor.rootId,
      maker_version: '42',
      root_content_commitment: descriptor.rootContentCommitment,
      asset_id: preState.assetIds[0],
      source_kind: preState.physical.sourceKind,
      source_treasury_id: preState.physical.sourceTreasuryId,
      source_id: preState.physical.sourceId,
      source_semantic_id: preState.physical.sourceSemanticId,
      asset_content_commitment: preState.physical.assetContentCommitment,
      source_content_commitment: preState.physical.sourceContentCommitment,
      provenance_commitment: preState.physical.provenanceCommitment,
      transferable: preState.physical.transferable,
      holder: preState.seller,
      ownership_epoch: preState.ownershipEpoch,
    },
  };
}

function finalizedRawEvents(descriptor, listingId, newAdminId) {
  const kind = finalizedActionKind(descriptor.action);
  const { preState } = descriptor;
  const eventName = kind === 'LIST' ? 'MarketListingOpenedV8'
    : kind === 'PURCHASE' ? 'MarketListingSettledV8' : 'MarketListingClosedV8';
  const terminalJson = kind === 'LIST' ? {
    listing_id: listingId, registry_id: descriptor.registryId, lane: descriptor.lane,
    root_id: descriptor.rootId, asset_id: preState.assetIds.at(-1), seller: preState.seller,
    ownership_epoch: preState.ownershipEpoch, gross_atomic: preState.quote.grossAtomic,
    quote_commitment: preState.quote.commitment,
  } : kind === 'PURCHASE' ? {
    listing_id: listingId, registry_id: descriptor.registryId, lane: descriptor.lane,
    asset_id: preState.assetIds.at(-1), seller: preState.seller, buyer: descriptor.sender,
    gross_atomic: preState.quote.grossAtomic, protocol_atomic: preState.quote.protocolAtomic,
    creator_atomic: preState.quote.creatorAtomic, source_atomic: preState.quote.sourceAtomic,
    seller_atomic: preState.quote.sellerAtomic,
  } : {
    listing_id: listingId, registry_id: descriptor.registryId, lane: descriptor.lane,
    asset_id: preState.assetIds.at(-1), seller: preState.seller, recovered: kind === 'RECOVER',
  };
  const terminalBcs = { ...terminalJson };
  if (terminalBcs.quote_commitment) terminalBcs.quote_commitment = finalizedHexBytes(terminalBcs.quote_commitment);
  const marketCallablePackageId = descriptor.target.split('::')[0];
  const events = [{
    packageId: marketCallablePackageId,
    module: 'market_v8',
    sender: descriptor.sender,
    eventType: `${runtimeInput.roles.market.typeOriginPackageId}::market_v8::${eventName}`,
    bcs: FINALIZED_EVENT_BCS[eventName].serialize(terminalBcs).toBytes(),
    json: terminalJson,
  }];
  if (descriptor.action === 'purchaseMakerControl') {
    const json = {
      root_id: descriptor.rootId, previous_owner: preState.root.owner, new_owner: descriptor.sender,
      previous_control_epoch: preState.root.controlEpoch,
      new_control_epoch: (BigInt(preState.root.controlEpoch) + 1n).toString(),
      new_admin_cap_id: newAdminId,
    };
    events.push({
      packageId: marketCallablePackageId,
      module: 'market_v8', sender: descriptor.sender,
      eventType: `${runtimeInput.roles.core.typeOriginPackageId}::maker_v8::MakerControlTransferredV8`,
      bcs: FINALIZED_EVENT_BCS.MakerControlTransferredV8.serialize(json).toBytes(), json,
    });
  }
  if ([MARKET_V8_LANES.PHYSICAL_BASE, MARKET_V8_LANES.PHYSICAL_PACK].includes(descriptor.lane)) {
    const json = {
      action: kind === 'LIST' ? 0 : kind === 'PURCHASE' ? 2 : 1,
      listing_id: listingId, asset_id: preState.assetIds[0], source_kind: Number(preState.physical.sourceKind),
      source_treasury_id: preState.physical.sourceTreasuryId, previous_holder: preState.seller,
      holder: kind === 'PURCHASE' ? descriptor.sender : preState.seller,
      previous_ownership_epoch: preState.ownershipEpoch,
      ownership_epoch: kind === 'PURCHASE'
        ? (BigInt(preState.ownershipEpoch) + 1n).toString() : preState.ownershipEpoch,
      provenance_commitment: preState.physical.provenanceCommitment,
    };
    events.push({
      packageId: marketCallablePackageId,
      module: 'market_v8', sender: descriptor.sender,
      eventType: `${runtimeInput.roles.physical.typeOriginPackageId}::physical_v8::PhysicalMarketCustodyTransitionV8`,
      bcs: FINALIZED_EVENT_BCS.PhysicalMarketCustodyTransitionV8.serialize({
        ...json, provenance_commitment: finalizedHexBytes(json.provenance_commitment),
      }).toBytes(),
      json,
    });
  }
  return events;
}

function finalizedCoreFixture(built, evidence, index) {
  const descriptor = built.descriptor;
  const { preState } = descriptor;
  const kind = finalizedActionKind(descriptor.action);
  const listingId = kind === 'LIST' ? id(2_000 + index) : preState.listing.objectId;
  const newAdminId = id(3_000 + index);
  const payoutBase = 4_000 + index * 4;
  const dynamicBase = 5_000 + index * 4;
  const effectsBytes = Uint8Array.of(8, index + 1, 14);
  const effectsFingerprint = `0x${[...sha256(effectsBytes)]
    .map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
  const transactionBytes = fromBase64(evidence.transactionBytes);
  const transactionDigest = evidence.transactionDigest;
  const transaction = TransactionDataBuilder.fromBytes(transactionBytes).snapshot();
  const changedObjects = [];
  const unchangedConsensusObjects = [];
  const objectTypes = {};
  const past = new Map();
  const historicalOwner = (owner) => {
    if (owner?.$kind === 'Shared') return {
      Shared: { initial_shared_version: owner.Shared.initialSharedVersion },
    };
    if (owner?.$kind === 'AddressOwner') return { AddressOwner: owner.AddressOwner };
    if (owner?.$kind === 'ObjectOwner') return { ObjectOwner: owner.ObjectOwner };
    return owner;
  };

  const remember = (objectId, version, type, owner, fields, previousTransaction = 'prior-transaction') => {
    objectTypes[objectId] = type;
    past.set(`${objectId}:${version}`, {
      status: 'VersionFound',
      details: {
        objectId, version, digest, type, owner: historicalOwner(owner), previousTransaction,
        content: { dataType: 'moveObject', type, fields },
      },
    });
  };
  const readonly = (objectId, type, fields) => {
    unchangedConsensusObjects.push({ kind: 'ReadOnlyRoot', objectId, version: '7', digest });
    remember(objectId, '7', type, finalizedSharedOwner, fields);
  };
  const changed = (objectId, type, before, after, beforeOwner, afterOwner, idOperation = 'None') => {
    changedObjects.push({
      objectId,
      inputState: before === null ? 'DoesNotExist' : 'Exists',
      inputVersion: before === null ? null : '7',
      inputDigest: before === null ? null : digest,
      inputOwner: before === null ? null : beforeOwner,
      outputState: after === null ? 'DoesNotExist' : 'ObjectWrite',
      outputVersion: after === null ? null : '8',
      outputDigest: after === null ? null : digest,
      outputOwner: after === null ? null : afterOwner,
      idOperation,
    });
    objectTypes[objectId] = type;
    if (before !== null) remember(objectId, '7', type, beforeOwner, before);
    if (after !== null) remember(objectId, '8', type, afterOwner, after, transactionDigest);
  };

  const rootBefore = {
    owner: preState.root.owner, creator: preState.root.creator,
    admin_cap_id: preState.root.adminCapId, control_epoch: preState.root.controlEpoch,
    content_commitment: descriptor.rootContentCommitment,
  };
  if (descriptor.lane !== MARKET_V8_LANES.MAKER) Object.assign(rootBefore, {
    owner: id(9_000 + index),
    admin_cap_id: id(9_100 + index),
    control_epoch: (BigInt(preState.root.controlEpoch) + 100n).toString(),
  });
  if (descriptor.action === 'purchaseMakerControl') changed(
    descriptor.rootId, types.makerRoot, rootBefore,
    { ...rootBefore, owner: descriptor.sender, admin_cap_id: newAdminId, control_epoch: (BigInt(preState.root.controlEpoch) + 1n).toString() },
    finalizedSharedOwner, finalizedSharedOwner,
  ); else readonly(descriptor.rootId, types.makerRoot, rootBefore);

  const registryBefore = Object.fromEntries(Object.entries(preState.registry).map(([field, value]) => [
    field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value,
  ]));
  Object.assign(registryBefore, {
    version: '8', catalog_id: descriptor.catalogId,
    package_config_id: descriptor.roleConfigIds.market,
    product_binding_commitment: bytesHex(43), call_cap_set_commitment: bytesHex(44),
    root_id: descriptor.rootId, maker_version: '42',
    root_content_commitment: descriptor.rootContentCommitment,
    protocol_config_id: descriptor.protocolConfigId,
    protocol_config_revision: descriptor.protocolRevision,
    protocol_config_commitment: bytesHex(45), economics_commitment: bytesHex(46),
    rights_commitment: bytesHex(47), maker_market_fee_bps: '250',
    soul_market_fee_bps: '300', soul_creator_royalty_bps: '0',
    maker_source_royalty_bps: '200', maker_resale_royalty_bps: '500',
    treasury_id: descriptor.treasuryId, sealed: true,
    zero_state_commitment: bytesHex(48),
  });
  changed(descriptor.registryId, types.marketRegistry, registryBefore,
    finalizedRegistryAfter(registryBefore, kind, preState.quote), finalizedSharedOwner, finalizedSharedOwner);

  const treasuryBefore = {
    version: '8', catalog_id: descriptor.catalogId,
    package_config_id: descriptor.roleConfigIds.market,
    root_id: descriptor.rootId, maker_version: '42',
    root_content_commitment: descriptor.rootContentCommitment,
    escrow: { value: preState.treasury.escrowAtomic },
    gross_escrowed_atomic: preState.treasury.grossEscrowedAtomic,
    gross_released_atomic: preState.treasury.grossReleasedAtomic,
  };
  const treasuryAfter = kind === 'PURCHASE' ? {
    ...treasuryBefore,
    gross_escrowed_atomic: (BigInt(treasuryBefore.gross_escrowed_atomic) + BigInt(preState.quote.grossAtomic)).toString(),
    gross_released_atomic: (BigInt(treasuryBefore.gross_released_atomic) + BigInt(preState.quote.grossAtomic)).toString(),
  } : treasuryBefore;
  if (kind === 'PURCHASE') changed(descriptor.treasuryId, types.marketTreasury, treasuryBefore, treasuryAfter,
    finalizedSharedOwner, finalizedSharedOwner);
  else readonly(descriptor.treasuryId, types.marketTreasury, treasuryBefore);

  const listingType = descriptor.lane === MARKET_V8_LANES.MAKER ? types.makerListing
    : descriptor.lane === MARKET_V8_LANES.SOUL ? types.soulListing : types.physicalListing;
  const listingBefore = kind === 'LIST' ? null
    : finalizedListingFields(descriptor, listingId, 0, preState.listing.revision, id(0));
  const terminalRecipient = kind === 'LIST' ? id(0) : kind === 'PURCHASE' ? descriptor.sender : preState.seller;
  const listingAfter = finalizedListingFields(
    descriptor, listingId,
    kind === 'LIST' ? 0 : kind === 'PURCHASE' ? 1 : kind === 'CANCEL' ? 2 : 3,
    kind === 'LIST' ? 0 : BigInt(preState.listing.revision) + 1n,
    terminalRecipient,
  );
  changed(listingId, listingType, listingBefore, listingAfter, finalizedSharedOwner,
    kind === 'LIST' ? finalizedCreatedSharedOwner : finalizedSharedOwner,
    kind === 'LIST' ? 'Created' : 'None');

  const revenueFields = (balance, collected = balance) => ({
    revenue: { value: String(balance) }, total_collected: String(collected), total_withdrawn: '0',
  });
  const addRevenue = (argumentName, type, delta) => {
    const argument = descriptor.arguments.find((entry) => entry.name === argumentName);
    if (!argument) return;
    const key = argumentName === 'protocolTreasury' ? 'protocolTreasury'
      : argumentName === 'makerTreasury' ? 'makerTreasury' : 'packTreasury';
    const balance = preState.revenueObjects[key]?.balanceAtomic ?? '0';
    const before = revenueFields(balance);
    if (kind === 'PURCHASE') {
      const next = (BigInt(balance) + BigInt(delta)).toString();
      changed(argument.objectId, type, before, revenueFields(next), finalizedSharedOwner, finalizedSharedOwner);
    } else readonly(argument.objectId, type, before);
  };
  addRevenue('protocolTreasury', types.protocolTreasury, preState.quote.protocolAtomic);
  addRevenue('makerTreasury', types.makerTreasury, preState.quote.sourceAtomic);
  addRevenue('packTreasury', types.packTreasury, preState.quote.sourceAtomic);

  if (descriptor.lane === MARKET_V8_LANES.MAKER) {
    const adminId = preState.assetIds[0];
    const adminBefore = { root_id: descriptor.rootId, owner: preState.seller, control_epoch: preState.root.controlEpoch };
    if (kind === 'PURCHASE') {
      changed(adminId, types.makerAdmin, adminBefore, null, finalizedObjectOwner(listingId), null, 'Deleted');
      changed(newAdminId, types.makerAdmin, null, {
        root_id: descriptor.rootId, owner: descriptor.sender,
        control_epoch: (BigInt(preState.root.controlEpoch) + 1n).toString(),
      }, null, finalizedAddressOwner(descriptor.sender), 'Created');
    } else {
      const beforeOwner = kind === 'LIST' ? finalizedAddressOwner(preState.seller) : finalizedObjectOwner(listingId);
      const afterOwner = kind === 'LIST' ? finalizedObjectOwner(listingId) : finalizedAddressOwner(preState.seller);
      changed(adminId, types.makerAdmin, adminBefore, adminBefore, beforeOwner, afterOwner);
    }
  }

  if (descriptor.lane === MARKET_V8_LANES.SOUL) {
    const outputTable = id(dynamicBase + 2);
    const soulTable = id(dynamicBase + 3);
    readonly(preState.soul.outputRegistryId, types.outputRegistry, { outputs: { id: { id: outputTable } } });
    readonly(preState.soul.soulRegistryId, types.soulRegistry, { souls: { id: { id: soulTable } } });
    const targetOwner = kind === 'LIST' ? finalizedObjectOwner(listingId)
      : finalizedAddressOwner(kind === 'PURCHASE' ? descriptor.sender : preState.seller);
    const beforeOwner = kind === 'LIST' ? finalizedAddressOwner(preState.seller) : finalizedObjectOwner(listingId);
    const holder = kind === 'LIST' ? preState.seller : kind === 'PURCHASE' ? descriptor.sender : preState.seller;
    const epoch = kind === 'PURCHASE' ? (BigInt(preState.ownershipEpoch) + 1n).toString() : preState.ownershipEpoch;
    const soulBefore = {
      version: '8', soul_registry_id: preState.soul.soulRegistryId,
      root_id: descriptor.rootId, maker_version: '42',
      root_content_commitment: descriptor.rootContentCommitment,
      output_key: 'primary', output_policy_commitment: bytesHex(31),
      holder: preState.seller, ownership_epoch: preState.ownershipEpoch,
      output_id: preState.assetIds[0], receipt_id: preState.assetIds[1],
      recipe_commitment: bytesHex(32), render_commitment: bytesHex(33),
      output_commitment: preState.soul.outputCommitment,
      receipt_commitment: preState.soul.receiptCommitment,
      soul_creator_royalty_bps: '0', maker_source_royalty_bps: '200',
      soul_commitment: preState.soul.soulCommitment,
    };
    const soulAfter = { ...soulBefore, holder, ownership_epoch: epoch };
    if (kind === 'PURCHASE') soulAfter.soul_commitment = finalizedSoulCommitment(soulAfter);
    const rows = [
      [preState.assetIds[0], types.completeOutput, { holder: preState.seller, output_commitment: preState.soul.outputCommitment },
        { holder, output_commitment: preState.soul.outputCommitment }],
      [preState.assetIds[1], types.completeReceipt, { holder: preState.seller, output_id: preState.assetIds[0], receipt_commitment: preState.soul.receiptCommitment },
        { holder, output_id: preState.assetIds[0], receipt_commitment: preState.soul.receiptCommitment }],
      [preState.assetIds[2], types.canonicalSoul, soulBefore, soulAfter],
    ];
    for (const [objectId, type, before, after] of rows) changed(objectId, type, before, after, beforeOwner, targetOwner);
    if (kind === 'PURCHASE') {
      const baseRecord = (recordHolder) => ({
        holder: recordHolder, output_id: preState.assetIds[0], receipt_id: preState.assetIds[1], soul_id: preState.assetIds[2],
      });
      const outputRecordType = normalizeStructTag(`0x2::dynamic_field::Field<0x2::object::ID,${runtimeInput.roles.output.typeOriginPackageId}::output_v8::OutputRecordV8>`);
      const soulRecordType = normalizeStructTag(`0x2::dynamic_field::Field<0x2::object::ID,${runtimeInput.roles.output.typeOriginPackageId}::output_v8::SoulRecordV8>`);
      changed(id(dynamicBase), outputRecordType,
        { name: preState.assetIds[0], value: { ...baseRecord(preState.seller), output_commitment: preState.soul.outputCommitment, receipt_commitment: preState.soul.receiptCommitment } },
        { name: preState.assetIds[0], value: { ...baseRecord(descriptor.sender), output_commitment: preState.soul.outputCommitment, receipt_commitment: preState.soul.receiptCommitment } },
        finalizedObjectOwner(outputTable), finalizedObjectOwner(outputTable));
      changed(id(dynamicBase + 1), soulRecordType,
        { name: preState.assetIds[2], value: { ...baseRecord(preState.seller), ownership_epoch: preState.ownershipEpoch, soul_commitment: preState.soul.soulCommitment } },
        { name: preState.assetIds[2], value: { ...baseRecord(descriptor.sender), ownership_epoch: epoch, soul_commitment: soulAfter.soul_commitment } },
        finalizedObjectOwner(soulTable), finalizedObjectOwner(soulTable));
    }
  }

  if ([MARKET_V8_LANES.PHYSICAL_BASE, MARKET_V8_LANES.PHYSICAL_PACK].includes(descriptor.lane)) {
    const physicalRegistry = descriptor.arguments.find((entry) => entry.name === 'physicalRegistry');
    readonly(physicalRegistry.objectId, types.physicalRegistry, { revision: '1' });
    const treasuryOption = descriptor.lane === MARKET_V8_LANES.PHYSICAL_BASE
      ? [] : [preState.physical.sourceTreasuryId];
    const before = {
      holder: preState.seller, ownership_epoch: preState.ownershipEpoch,
      source_kind: preState.physical.sourceKind, source_treasury_id: treasuryOption,
      source_id: preState.physical.sourceId, source_semantic_id: preState.physical.sourceSemanticId,
      asset_content_commitment: preState.physical.assetContentCommitment,
      source_content_commitment: preState.physical.sourceContentCommitment,
      provenance_commitment: preState.physical.provenanceCommitment,
      transferable: preState.physical.transferable,
    };
    const after = {
      ...before,
      holder: kind === 'LIST' ? preState.seller : kind === 'PURCHASE' ? descriptor.sender : preState.seller,
      ownership_epoch: kind === 'PURCHASE'
        ? (BigInt(preState.ownershipEpoch) + 1n).toString() : preState.ownershipEpoch,
    };
    changed(preState.assetIds[0], types.physicalAsset, before, after,
      kind === 'LIST' ? finalizedAddressOwner(preState.seller) : finalizedObjectOwner(listingId),
      kind === 'LIST' ? finalizedObjectOwner(listingId)
        : finalizedAddressOwner(kind === 'PURCHASE' ? descriptor.sender : preState.seller));
  }

  if (kind === 'PURCHASE') {
    const paymentType = types.paymentCoin;
    for (const [offset, owner, amount] of [
      [0, preState.root.creator, preState.quote.creatorAtomic],
      [1, preState.seller, preState.quote.sellerAtomic],
    ]) {
      if (amount === '0') continue;
      changed(id(payoutBase + offset), paymentType, null, { balance: amount }, null,
        finalizedAddressOwner(owner), 'Created');
    }
  }

  const rawEvents = finalizedRawEvents(descriptor, listingId, newAdminId);
  const transactionEvents = makerV8TransactionEventsDigestV8(rawEvents);
  const planBase = {
    transactionBytes: evidence.transactionBytes,
    transactionDigest,
    stage: `MARKET_${kind}`,
    sequence: descriptor.expectation?.listingRevision ?? '0',
    signer: descriptor.sender,
    epochWindow: evidence.epochWindow,
    gas: evidence.gasData,
    expiration: evidence.expiration,
    sourceSnapshot: {
      schema: 'animacraft.market-source-snapshot.v8',
      fingerprint: evidence.sourceFingerprint,
      descriptor,
    },
    market: { schema: evidence.schema, descriptor, runtime: {} },
  };
  const planHash = finalizedHash(planBase);
  const plan = { ...planBase, fingerprint: planHash };
  const request = {
    digest: transactionDigest,
    planHash,
    identity: {
      action: descriptor.action.toUpperCase(), wallet: descriptor.sender,
      root: { id: descriptor.rootId }, listing: { id: listingId },
      registry: { id: descriptor.registryId }, treasury: { id: descriptor.treasuryId },
    },
    plan,
    outcome: { epoch: '100', effectsFingerprint, eventsDigest: transactionEvents.digest },
  };
  const rpc = {
    core: {
      async getTransaction(input) {
        assert.equal(input.digest, transactionDigest);
        assert.deepEqual(input.include, {
          transaction: true, bcs: true, effects: true, events: true, objectTypes: true,
        });
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: transactionDigest, epoch: '100', status: { success: true, error: null },
            transaction,
            effects: {
              status: { success: true, error: null }, transactionDigest,
              eventsDigest: transactionEvents.digest, bcs: effectsBytes,
              changedObjects, unchangedConsensusObjects,
            },
            events: rawEvents, objectTypes, bcs: transactionBytes,
          },
        };
      },
    },
    async tryGetPastObject({ id: objectId, version, options }) {
      assert.equal(Number.isSafeInteger(version), true);
      assert.equal(options.showPreviousTransaction, true);
      return past.get(`${objectId}:${version}`) ?? { status: 'VersionNotFound' };
    },
  };
  return { rpc, request, descriptor, listingId, rawEvents, transactionEvents };
}

async function finalizedProductionActions() {
  const actions = allActions();
  const sameOwnerRoot = object(IDs.root, types.makerRoot, {
    adminCapId: IDs.admin, ownerAddress: IDs.seller, creatorAddress: IDs.seller, controlEpoch: 5n,
    binding: common.root.binding, lifecycleCode: MARKET_V8_LIFECYCLES.ACTIVE,
  });
  actions.purchaseMakerControl = client.buildPurchaseMakerControl({
    ...makerExisting(), root: sameOwnerRoot, protocolTreasury,
  });

  const zeroCreatorRegistryResponse = structuredClone(registryResponse);
  zeroCreatorRegistryResponse.data.content.fields.soul_creator_royalty_bps = '0';
  const zeroCreatorRegistry = client.parseRegistry(zeroCreatorRegistryResponse);
  const zeroCreatorQuote = client.quoteSoulResale(zeroCreatorRegistry, 1_000_000n);
  const zeroCreatorListingResponse = structuredClone(soulListingResponse());
  Object.assign(zeroCreatorListingResponse.data.content.fields, listingAmounts(zeroCreatorQuote));
  const zeroCreatorListing = client.parseSoulListing(zeroCreatorListingResponse);
  const zeroCreatorChainQuote = await client.inspectQuoteOnChain({
    async simulateTransaction() {
      return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(zeroCreatorQuote) }] }] };
    },
  }, {
    registry: zeroCreatorRegistry, treasury, root: common.root, wallet: wallet(IDs.buyer),
    quoteKind: MARKET_V8_QUOTE_KINDS.SOUL_RESALE, grossAtomic: 1_000_000n,
  });
  actions.purchaseSoulBundle = client.buildPurchaseSoulBundle({
    ...common,
    registry: zeroCreatorRegistry,
    listing: zeroCreatorListing,
    wallet: wallet(IDs.buyer),
    expectation: {
      listingRevision: zeroCreatorListing.fields.revision,
      registryRevision: zeroCreatorRegistry.fields.revision,
      quoteCommitment: zeroCreatorListing.fields.quoteCommitment,
    },
    chainQuote: zeroCreatorChainQuote,
    outputRegistry, soulRegistry,
    outputReceiving: receiving(IDs.output, types.completeOutput),
    receiptReceiving: receiving(IDs.receipt, types.completeReceipt),
    soulReceiving: receiving(IDs.soul, types.canonicalSoul),
    makerTreasury, protocolTreasury,
  });
  return actions;
}

test('all 14 production builders normalize exact Core V2 history/events and verify finalized readback', async () => {
  const actions = await finalizedProductionActions();
  assert.deepEqual(Object.keys(actions), Object.keys(MARKET_V8_ACTION_ABI));
  const verifiedActions = [];
  const envelopes = new Map();
  const requests = new Map();
  const finalizedMarketModule = await import('../maker-v8-market.js');
  for (const [index, [action, built]] of Object.entries(actions).entries()) {
    assert.equal(built.descriptor.action, action);
    const proof = await inspectMarketActionOnChainV8(canonicalSigningClient(), built);
    const evidence = createMarketV8RecoveryEvidenceV8(built, proof);
    assert.equal(evidence.descriptor, built.descriptor, `${action} descriptor must come from the branded builder`);
    assert.equal(
      TransactionDataBuilder.getDigestFromBytes(fromBase64(evidence.transactionBytes)),
      evidence.transactionDigest,
      `${action} TransactionData digest`,
    );
    const fixtureValue = finalizedCoreFixture(built, evidence, index);
    const envelope = await readFinalizedMakerV8EnvelopeV8({
      client: fixtureValue.rpc, market: client, request: fixtureValue.request,
    });
    const verified = assertFinalizedMarketReadbackV8(
      envelope, fixtureValue.request, client, finalizedMarketModule,
    );
    assert.equal(verified.verified, true, action);
    assert.equal(verified.evidence.source, 'FINALIZED_CORE_V2', action);
    assert.equal(envelope.effects.transactionBcs, evidence.transactionBytes, action);
    assert.equal(envelope.effects.eventsBcs, fixtureValue.transactionEvents.bcs, action);
    assert.equal(envelope.eventsDigest, fixtureValue.transactionEvents.digest, action);
    assert.equal(envelope.effects.objects.some((entry) => entry.role === 'LISTING'), true, action);
    envelopes.set(action, envelope);
    requests.set(action, fixtureValue.request);
    verifiedActions.push(action);
  }
  assert.deepEqual(verifiedActions, Object.keys(MARKET_V8_ACTION_ABI));

  const rewriteOwner = (envelope, role, sides, owner) => {
    const object = envelope.effects.objects.find((entry) => entry.role === role);
    assert.ok(object, `${role} evidence`);
    const change = envelope.effects.changedObjects.find((entry) => entry.objectId === object.objectId);
    for (const side of sides) {
      const snapshot = object[side];
      if (!snapshot) continue;
      snapshot.owner = structuredClone(owner);
      snapshot.ownerKind = owner.kind;
      snapshot.ref.owner = structuredClone(owner);
      if (change) change[side === 'before' ? 'input' : 'output'].owner = structuredClone(owner);
    }
    object.ownerKind = (object.after ?? object.before).ownerKind;
  };
  const rejectsOwnerDrift = (action, envelope, label) => assert.throws(
    () => assertFinalizedMarketReadbackV8(
      envelope, requests.get(action), client, finalizedMarketModule,
    ),
    (failure) => failure?.code === 'WEB_V8_FINALIZED_OWNER_INVALID'
      || failure?.code === 'WEB_V8_FINALIZED_HISTORY_OWNER_MISMATCH',
    `${action}: ${label}`,
  );
  for (const [action, source] of envelopes) {
    const listing = source.effects.objects.find((entry) => entry.role === 'LISTING');
    const listingAddressOwner = { kind: 'AddressOwner', value: listing.objectId };
    const listingTamper = structuredClone(source);
    rewriteOwner(listingTamper, 'LISTING', ['before', 'after'], listingAddressOwner);
    rejectsOwnerDrift(action, listingTamper, 'LISTING cannot masquerade as AddressOwner');

    const registryTamper = structuredClone(source);
    const registry = registryTamper.effects.objects.find((entry) => entry.role === 'REGISTRY');
    rewriteOwner(registryTamper, 'REGISTRY', ['before', 'after'], {
      kind: 'AddressOwner', value: registry.objectId,
    });
    rejectsOwnerDrift(action, registryTamper, 'changed registry must derive Shared owner from TransactionData');

    const descriptor = actions[action].descriptor;
    const custodyRole = descriptor.lane === MARKET_V8_LANES.MAKER ? 'ADMIN'
      : descriptor.lane === MARKET_V8_LANES.SOUL ? 'OUTPUT' : 'ASSET';
    const custodyTamper = structuredClone(source);
    const custody = custodyTamper.effects.objects.find((entry) => entry.role === custodyRole);
    const objectSide = custody.before?.owner.kind === 'ObjectOwner' ? 'before' : 'after';
    const custodyOwner = custody[objectSide].owner.value;
    rewriteOwner(custodyTamper, custodyRole, [objectSide], {
      kind: 'AddressOwner', value: custodyOwner,
    });
    rejectsOwnerDrift(action, custodyTamper, `${custodyRole} custody requires ObjectOwner(listing)`);

    if (finalizedActionKind(action) === 'LIST') {
      const versionTamper = structuredClone(source);
      const created = versionTamper.effects.objects.find((entry) => entry.role === 'LISTING');
      const badOwner = { kind: 'Shared', value: { initialSharedVersion: '7' } };
      rewriteOwner(versionTamper, 'LISTING', ['after'], badOwner);
      rejectsOwnerDrift(action, versionTamper, 'created Shared initial version must equal output version');
    }
    if (finalizedActionKind(action) === 'PURCHASE') {
      const payoutTamper = structuredClone(source);
      const payout = payoutTamper.effects.objects.find((entry) => entry.role === 'SELLER_COIN');
      rewriteOwner(payoutTamper, 'SELLER_COIN', ['after'], {
        kind: 'ObjectOwner', value: payout.after.owner.value,
      });
      rejectsOwnerDrift(action, payoutTamper, 'wallet payout must be AddressOwner');
    }
  }

  for (const role of ['OUTPUT_RECORD', 'SOUL_RECORD']) {
    const dynamicTamper = structuredClone(envelopes.get('purchaseSoulBundle'));
    const record = dynamicTamper.effects.objects.find((entry) => entry.role === role);
    rewriteOwner(dynamicTamper, role, ['before', 'after'], {
      kind: 'AddressOwner', value: record.before.owner.value,
    });
    rejectsOwnerDrift('purchaseSoulBundle', dynamicTamper, `${role} must remain ObjectOwner(registry table)`);
  }

  const makerPurchase = actions.purchaseMakerControl.descriptor;
  assert.equal(makerPurchase.preState.root.creator, makerPurchase.preState.seller);
  const soulPurchase = actions.purchaseSoulBundle.descriptor;
  assert.equal(soulPurchase.preState.quote.creatorAtomic, '0');
  assert.equal(soulPurchase.preState.quote.sourceAtomic !== '0', true);

  const roles = (action) => new Map(envelopes.get(action).effects.objects.map((entry) => [entry.role, entry]));
  const makerPurchaseRoles = roles('purchaseMakerControl');
  assert.equal(makerPurchaseRoles.get('ADMIN').change, 'DELETED');
  assert.equal(makerPurchaseRoles.get('ADMIN_NEW').change, 'CREATED');
  assert.equal(makerPurchaseRoles.get('CREATOR_COIN').after.owner.value, makerPurchase.preState.seller);
  assert.equal(makerPurchaseRoles.get('SELLER_COIN').after.owner.value, makerPurchase.preState.seller);
  assert.equal(envelopes.get('purchaseMakerControl').events.some(
    (event) => event.type.endsWith('::maker_v8::MakerControlTransferredV8'),
  ), true);

  for (const envelope of envelopes.values()) for (const event of envelope.events) {
    assert.equal(event.packageId, runtimeInput.roles.market.callablePackageId);
    assert.equal(event.transactionModule, 'market_v8');
  }

  const postPrepareRoot = roles('purchaseSoulBundle').get('ROOT');
  assert.notEqual(postPrepareRoot.before.parsed.owner, soulPurchase.preState.root.owner);
  assert.deepEqual(postPrepareRoot.before.parsed, postPrepareRoot.after.parsed);

  const soulPurchaseRoles = roles('purchaseSoulBundle');
  assert.equal(soulPurchaseRoles.has('OUTPUT_RECORD'), true);
  assert.equal(soulPurchaseRoles.has('SOUL_RECORD'), true);
  assert.equal(soulPurchaseRoles.has('CREATOR_COIN'), false);
  assert.equal(soulPurchaseRoles.has('SELLER_COIN'), true);

  const baseAsset = roles('listBasePhysical').get('ASSET');
  const packAsset = roles('listPackPhysical').get('ASSET');
  assert.deepEqual(baseAsset.before.parsed.source_treasury_id, []);
  assert.deepEqual(packAsset.before.parsed.source_treasury_id, [
    actions.listPackPhysical.descriptor.preState.physical.sourceTreasuryId,
  ]);
  assert.equal(actions.cancelPhysicalListing.descriptor.lane, MARKET_V8_LANES.PHYSICAL_BASE);
  assert.equal(actions.recoverPhysicalListing.descriptor.lane, MARKET_V8_LANES.PHYSICAL_PACK);
  for (const action of [
    'listBasePhysical', 'listPackPhysical', 'purchaseBasePhysical', 'purchasePackPhysical',
    'cancelPhysicalListing', 'recoverPhysicalListing',
  ]) assert.equal(envelopes.get(action).events.some(
    (event) => event.type.endsWith('::physical_v8::PhysicalMarketCustodyTransitionV8'),
  ), true, `${action} Physical companion event`);
});
