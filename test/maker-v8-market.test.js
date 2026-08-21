import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { normalizeStructTag, toBase64 } from '@mysten/sui/utils';

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
      outputAsset: object(IDs.output, types.completeOutput),
      receipt: object(IDs.receipt, types.completeReceipt),
      soul: object(IDs.soul, types.canonicalSoul, { ownershipEpoch: 5n }),
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
    outputAsset: object(IDs.output, types.completeOutput),
    receipt: object(IDs.receipt, types.completeReceipt),
    soul: object(IDs.soul, types.canonicalSoul),
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
