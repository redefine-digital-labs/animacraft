import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MARKET_V8_ACTION_ABI,
  MARKET_V8_LANES,
  MARKET_V8_LIFECYCLES,
  MARKET_V8_LISTING_STATUS,
  MARKET_V8_PHYSICAL_SOURCES,
  MarketV8BuildError,
  MarketV8EligibilityError,
  MarketV8ParseError,
  MarketV8RuntimeError,
  assertMarketV8Runtime,
  createMarketV8Client,
  deriveMarketQuoteCommitmentV8,
  marketQuoteCommitmentBcsV8,
} from '../maker-v8-market.js';

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
  callablePackageId: packageId('9'),
  paymentCoinType: '0x2::sui::SUI',
  typeOrigins: Object.freeze({
    corePackageId: packageId('1'),
    outputPackageId: packageId('2'),
    physicalPackageId: packageId('3'),
    runtimePackageId: packageId('4'),
    marketPackageId: packageId('5'),
  }),
});
const client = createMarketV8Client(runtimeInput, { network: NETWORK });
const { types } = client;

const IDs = Object.freeze({
  registry: id(100),
  treasury: id(101),
  catalog: id(102),
  config: id(103),
  root: id(104),
  protocolConfig: id(105),
  protocolTreasury: id(106),
  admin: id(107),
  makerTreasury: id(108),
  outputRegistry: id(109),
  soulRegistry: id(110),
  output: id(111),
  receipt: id(112),
  soul: id(113),
  physicalRegistry: id(114),
  physicalConfig: id(115),
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

const common = Object.freeze({
  registry,
  treasury,
  root: object(IDs.root, types.makerRoot),
  catalog: object(IDs.catalog, types.catalog),
  config: object(IDs.config, types.marketConfig),
  protocolConfig: object(IDs.protocolConfig, types.protocolConfig),
});
const makerTreasury = object(IDs.makerTreasury, types.makerTreasury);
const protocolTreasury = object(IDs.protocolTreasury, types.protocolTreasury);
const outputRegistry = object(IDs.outputRegistry, types.outputRegistry);
const soulRegistry = object(IDs.soulRegistry, types.soulRegistry);
const physicalRegistry = object(IDs.physicalRegistry, types.physicalRegistry);
const physicalConfig = object(IDs.physicalConfig, types.physicalConfig);
const packTreasury = object(IDs.packTreasury, types.packTreasury);
const packRelease = object(IDs.packRelease, types.packRelease);
const degraded = Object.freeze({
  enabled: false,
  revision: registry.fields.protocolConfigRevision,
  commitment: registry.fields.protocolConfigCommitment,
});

function makerExisting(listing = makerListing, sender = IDs.buyer) {
  return {
    ...common,
    listing,
    wallet: wallet(sender),
    expectation: expectation(listing),
    adminReceiving: receiving(IDs.admin, types.makerAdmin),
  };
}

function soulExisting(listing = soulListing, sender = IDs.buyer) {
  return {
    ...common,
    listing,
    wallet: wallet(sender),
    expectation: expectation(listing),
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
      admin: object(IDs.admin, types.makerAdmin),
      makerTreasury,
      makerTreasuryBalanceAtomic: 0n,
      lifecycle: BigInt(MARKET_V8_LIFECYCLES.PAUSED),
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }),
    purchaseMakerControl: client.buildPurchaseMakerControl({
      ...makerExisting(),
      protocolTreasury,
      payment: payment(IDs.paymentMaker),
    }),
    cancelMakerControl: client.buildCancelMakerControl(makerExisting(makerListing, IDs.seller)),
    recoverMakerControl: client.buildRecoverMakerControl({
      ...makerExisting(makerListing, IDs.recoveryCaller),
      lifecycle: BigInt(MARKET_V8_LIFECYCLES.ACTIVE),
      protocolState: degraded,
    }),
    listSoulBundle: client.buildListSoulBundle({
      ...common,
      wallet: wallet(IDs.seller),
      outputRegistry,
      soulRegistry,
      outputAsset: object(IDs.output, types.completeOutput),
      receipt: object(IDs.receipt, types.completeReceipt),
      soul: object(IDs.soul, types.canonicalSoul),
      lifecycle: BigInt(MARKET_V8_LIFECYCLES.ACTIVE),
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }),
    purchaseSoulBundle: client.buildPurchaseSoulBundle({
      ...soulExisting(),
      makerTreasury,
      protocolTreasury,
      payment: payment(IDs.paymentSoul),
    }),
    cancelSoulListing: client.buildCancelSoulListing(soulExisting(soulListing, IDs.seller)),
    recoverSoulListing: client.buildRecoverSoulListing({
      ...soulExisting(soulListing, IDs.recoveryCaller),
      lifecycle: BigInt(MARKET_V8_LIFECYCLES.ACTIVE),
      protocolState: degraded,
    }),
    listBasePhysical: client.buildListBasePhysical({
      ...common,
      wallet: wallet(IDs.seller),
      physicalRegistry,
      physicalConfig,
      makerTreasury,
      asset: object(IDs.baseAsset, types.physicalAsset, {
        sourceKind: '0',
        sourceTreasuryId: IDs.makerTreasury,
      }),
      lifecycle: BigInt(MARKET_V8_LIFECYCLES.ACTIVE),
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
      }),
      lifecycle: BigInt(MARKET_V8_LIFECYCLES.ACTIVE),
      grossAtomic: 1_000_000n,
      expectedRegistryRevision: registry.fields.revision,
    }),
    purchaseBasePhysical: client.buildPurchaseBasePhysical({
      ...physicalExisting(baseListing),
      makerTreasury,
      protocolTreasury,
      payment: payment(IDs.paymentBase),
    }),
    purchasePackPhysical: client.buildPurchasePackPhysical({
      ...physicalExisting(packListing),
      packRelease,
      packTreasury,
      protocolTreasury,
      payment: payment(IDs.paymentPack),
    }),
    cancelPhysicalListing: client.buildCancelPhysicalListing(physicalExisting(baseListing, IDs.seller)),
    recoverPhysicalListing: client.buildRecoverPhysicalListing({
      ...physicalExisting(packListing, IDs.recoveryCaller),
      lifecycle: BigInt(MARKET_V8_LIFECYCLES.ACTIVE),
      protocolState: degraded,
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
  const call = data.commands[0]?.MoveCall;
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
  if (argument.kind === 'receiving' || argument.kind === 'payment') {
    return {
      kind: argument.kind,
      objectId: argument.objectId,
      version: argument.version,
      digest: argument.digest,
    };
  }
  return { kind: 'pure', bytes: u64Base64(argument.value) };
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
  assert.equal(client.types.marketRegistry.startsWith(`${packageId('5')}::market_v8::`), true);
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

test('all 14 builders snapshot real Transaction data with exact targets, types, argument order, and Receiving lanes', () => {
  const actions = allActions();
  assert.deepEqual(Object.keys(actions), Object.keys(fixture.actions));
  for (const [action, result] of Object.entries(actions)) {
    const expected = fixture.actions[action];
    const snapshot = transactionSnapshot(result);
    assert.deepEqual(snapshot, {
      version: 2,
      sender: result.descriptor.sender,
      expiration: null,
      gasData: { budget: null, price: null, owner: null, payment: null },
      package: runtimeInput.callablePackageId,
      module: 'market_v8',
      function: expected.function,
      typeArguments: [client.runtime.paymentCoinType],
      inputs: result.descriptor.arguments.map(expectedInput),
      arguments: expected.clientArguments.map((name, index) => ({
        Input: index,
        type: expectedInputKind(name) === 'pure' ? 'pure' : 'object',
        '$kind': 'Input',
      })),
      commandCount: 1,
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
    assert.equal(result.transaction.getData().inputs.filter((input) => input.Object?.ImmOrOwnedObject).length, 1);
    assert.equal(result.descriptor.arguments.filter((argument) => argument.kind === 'payment').length, 1);
    assert.equal(result.descriptor.arguments.find((argument) => argument.kind === 'payment').balanceAtomic, '1000000');
  }
});

test('runtime, object, listing, and event parsers reject wrong types, origins, fields, and bindings', () => {
  assert.throws(() => assertMarketV8Runtime({
    ...runtimeInput,
    unexpected: true,
  }), (error) => error instanceof MarketV8RuntimeError && error.code === 'MARKET_V8_FIELDS_INVALID');
  assert.throws(() => assertMarketV8Runtime({
    ...runtimeInput,
    callablePackageId: packageId('A'),
  }), (error) => error instanceof MarketV8RuntimeError && error.code === 'MARKET_V8_PACKAGE_ID_INVALID');
  assert.throws(() => createMarketV8Client(runtimeInput, { network: 'testnet' }), (error) => (
    error instanceof MarketV8RuntimeError && error.code === 'MARKET_V8_NETWORK_INVALID'
  ));

  const upgradedCallableOrigin = structuredClone(registryResponse);
  upgradedCallableOrigin.data.content.type = upgradedCallableOrigin.data.content.type.replace(packageId('5'), packageId('9'));
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
    type: `${runtimeInput.typeOrigins.marketPackageId}::market_v8::MarketListingOpenedV8`,
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
    type: `${runtimeInput.typeOrigins.marketPackageId}::market_v8::MarketRegistrySealedV8`,
    parsedJson: {
      root_id: IDs.root,
      registry_id: IDs.registry,
      treasury_id: IDs.treasury,
      zero_state_commitment: bytes32(3),
    },
  }).fields.zeroStateCommitment, bytesHex(3));
  assert.equal(client.parseEvent({
    type: `${runtimeInput.typeOrigins.marketPackageId}::market_v8::MarketListingSettledV8`,
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
    type: `${runtimeInput.typeOrigins.marketPackageId}::market_v8::MarketListingClosedV8`,
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
    type: opened.type.replace(packageId('5'), packageId('9')),
  }), (error) => error instanceof MarketV8ParseError && error.code === 'MARKET_V8_EVENT_TYPE_ORIGIN_MISMATCH');
});

test('builders reject wrong imported types and exact Receiving refs for 1/3/1 custody', () => {
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    wallet: { address: IDs.buyer, network: 'testnet' },
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_NETWORK_INVALID');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    root: { ...common.root, network: 'testnet' },
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_NETWORK_INVALID');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    root: object(IDs.root, types.completeOutput),
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_TYPE_MISMATCH');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    adminReceiving: receiving(IDs.receipt, types.makerAdmin),
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_REF_MISMATCH');
  assert.throws(() => client.buildPurchaseSoulBundle({
    ...soulExisting(),
    makerTreasury,
    protocolTreasury,
    receiptReceiving: receiving(IDs.output, types.completeReceipt),
    payment: payment(IDs.paymentSoul),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_REF_MISMATCH');
  assert.throws(() => client.buildPurchaseBasePhysical({
    ...physicalExisting(baseListing),
    makerTreasury,
    protocolTreasury,
    receiving: receiving(IDs.packAsset, types.physicalAsset),
    payment: payment(IDs.paymentBase),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_REF_MISMATCH');
});

test('eligibility rejects terminal status, stale revisions and quote commitment, and seller self-buy', () => {
  const settled = client.parseMakerListing(makerListingResponse({ status: '1', terminal_recipient: IDs.buyer }));
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(settled),
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_LISTING_NOT_OPEN');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    expectation: { ...expectation(makerListing), listingRevision: 1n },
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_STALE_LISTING_REVISION');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(),
    expectation: { ...expectation(makerListing), registryRevision: 3n },
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_STALE_REGISTRY_REVISION');
  const staleQuote = client.parseMakerListing(makerListingResponse({ quote_commitment: bytes32(9) }));
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(staleQuote),
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_STALE_QUOTE');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...makerExisting(makerListing, IDs.seller),
    protocolTreasury,
    payment: payment(IDs.paymentMaker),
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_SELLER_SELF_BUY');
});

test('Base and Pack builders are statically distinct and reject cross-lane/source substitution', () => {
  assert.throws(() => client.buildPurchaseBasePhysical({
    ...physicalExisting(packListing),
    makerTreasury,
    protocolTreasury,
    payment: payment(IDs.paymentBase),
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_CROSS_SOURCE');
  assert.throws(() => client.buildPurchasePackPhysical({
    ...physicalExisting(baseListing),
    packRelease,
    packTreasury,
    protocolTreasury,
    payment: payment(IDs.paymentPack),
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_CROSS_SOURCE');
  assert.throws(() => client.buildListBasePhysical({
    ...common,
    wallet: wallet(IDs.seller),
    physicalRegistry,
    physicalConfig,
    makerTreasury,
    asset: object(IDs.packAsset, types.physicalAsset, { sourceKind: '1', sourceTreasuryId: IDs.makerTreasury }),
    lifecycle: 1n,
    grossAtomic: 1_000_000n,
    expectedRegistryRevision: 4n,
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_CROSS_SOURCE');
  const actions = allActions();
  assert.equal(actions.listBasePhysical.descriptor.target.endsWith('::list_base_physical_v8'), true);
  assert.equal(actions.listPackPhysical.descriptor.target.endsWith('::list_pack_physical_v8'), true);
  assert.equal(actions.purchaseBasePhysical.descriptor.arguments[5].type, types.makerTreasury);
  assert.equal(actions.purchasePackPhysical.descriptor.arguments[5].type, types.packRelease);
  assert.equal(actions.purchasePackPhysical.descriptor.arguments[6].type, types.packTreasury);
});

test('purchase takes exactly one exact-value coin and rejects Number coercion, underpayment, and overpayment', () => {
  const base = { ...makerExisting(), protocolTreasury };
  for (const balance of ['999999', '1000001']) {
    assert.throws(() => client.buildPurchaseMakerControl({
      ...base,
      payment: payment(IDs.paymentMaker, balance),
    }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_PAYMENT_AMOUNT_MISMATCH');
  }
  assert.throws(() => client.buildPurchaseMakerControl({
    ...base,
    payment: payment(IDs.paymentMaker, 1_000_000),
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_INTEGER_INVALID');
  assert.throws(() => client.buildPurchaseMakerControl({
    ...base,
    payment: [payment(IDs.paymentMaker)],
  }), (error) => error instanceof MarketV8BuildError && error.code === 'MARKET_V8_OBJECT_INPUT_INVALID');
  assert.throws(() => client.buildListSoulBundle({
    ...common,
    wallet: wallet(IDs.seller),
    outputRegistry,
    soulRegistry,
    outputAsset: object(IDs.output, types.completeOutput),
    receipt: object(IDs.receipt, types.completeReceipt),
    soul: object(IDs.soul, types.canonicalSoul),
    lifecycle: 1n,
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
  const currentProtocol = {
    enabled: true,
    revision: registry.fields.protocolConfigRevision,
    commitment: registry.fields.protocolConfigCommitment,
  };
  assert.throws(() => client.buildRecoverMakerControl({
    ...makerExisting(makerListing, IDs.recoveryCaller),
    lifecycle: 2n,
    protocolState: currentProtocol,
  }), (error) => error instanceof MarketV8EligibilityError && error.code === 'MARKET_V8_NOT_RECOVERABLE');
  assert.doesNotThrow(() => client.buildRecoverSoulListing({
    ...soulExisting(soulListing, IDs.recoveryCaller),
    lifecycle: 2n,
    protocolState: currentProtocol,
  }));
});
