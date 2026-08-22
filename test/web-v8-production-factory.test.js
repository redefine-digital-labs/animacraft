import assert from 'node:assert/strict';
import test from 'node:test';

import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import {
  SUI_MAINNET_CHAIN,
  StandardConnect,
  StandardEvents,
  SuiSignTransaction,
} from '@mysten/wallet-standard';

import {
  WEB_V8_EXECUTION_SCHEMA,
  createFreshV8Controller,
  parseFreshV8Route,
  renderFreshV8App,
} from '../app.js';
import { createProductionMakerV8BrowserAdapters } from '../maker-v8-browser.js';
import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
  makerV8ChainTypes,
} from '../maker-v8-chain.js';
import * as marketModule from '../maker-v8-market.js';
import * as recoveryModule from '../maker-v8-recovery.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import { runtimeAttestationRpc } from './fixtures/maker-v8-runtime-attestation.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const packageId = (digit) => `0x${digit.repeat(64)}`;
const bytes32 = (value) => Array(32).fill(value);
const objectDigest = '11111111111111111111111111111111';
const transactionDigest = '2'.repeat(44);

const execution = Object.freeze({
  schemaVersion: WEB_V8_EXECUTION_SCHEMA,
  network: 'mainnet',
  chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  allowWalletSignature: false,
  allowBroadcast: false,
});

function runtimeFixture() {
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: id(100),
    protocolConfigId: id(101),
    protocolTreasuryId: id(102),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles: {
      core: { typeOriginPackageId: packageId('1'), callablePackageId: packageId('1') },
      seal: { typeOriginPackageId: packageId('6'), callablePackageId: packageId('6') },
      runtime: { typeOriginPackageId: packageId('4'), callablePackageId: packageId('4') },
      output: { typeOriginPackageId: packageId('2'), callablePackageId: packageId('2') },
      physical: { typeOriginPackageId: packageId('3'), callablePackageId: packageId('3') },
      market: { typeOriginPackageId: packageId('5'), callablePackageId: packageId('5') },
      release: { typeOriginPackageId: packageId('7'), callablePackageId: packageId('7') },
    },
    roleConfigIds: {
      seal: id(110),
      runtime: id(111),
      output: id(112),
      physical: id(113),
      market: id(114),
      release: id(115),
    },
    makerBindings: [],
  };
}

const binding = Object.freeze({
  rootId: id(300),
  baseRegistryId: id(301),
  makerTreasuryId: id(302),
  sealRegistryId: id(303),
  runtimeDefinitionRegistryId: id(304),
  packRegistryId: id(305),
  packAdmissionAuthorityId: id(306),
  outputRegistryId: id(307),
  soulRegistryId: id(308),
  physicalRegistryId: id(309),
  marketRegistryId: id(310),
  marketTreasuryId: id(311),
});

const IDs = Object.freeze({
  ...binding,
  adminCapId: id(312),
  baseListingId: id(400),
  packListingId: id(401),
  baseListingAssetId: id(410),
  packListingAssetId: id(411),
  packListingTreasuryId: id(412),
  packListingReleaseId: id(413),
  seller: id(900),
  creator: id(901),
  gas: id(999),
});

function moveObject(type, objectId, fields = {}, {
  owner = { Shared: { initial_shared_version: '1' } },
  version = '7',
} = {}) {
  return {
    data: {
      objectId,
      version,
      digest: objectDigest,
      type,
      owner,
      content: {
        dataType: 'moveObject',
        type,
        fields: { id: { id: objectId }, ...fields },
      },
    },
  };
}

function activationEvent(runtime) {
  return {
    id: { txDigest: transactionDigest, eventSeq: '0' },
    type: makerV8ChainTypes(runtime).activationEvent,
    parsedJson: {
      root_id: IDs.rootId,
      version: '8',
      owner: IDs.seller,
      control_epoch: '5',
      admin_cap_id: IDs.adminCapId,
      maker_key: 'offline-production-maker',
      maker_version: '42',
      version_commitment: bytes32(1),
      content_commitment: bytes32(0xaa),
      renderer_commitment: bytes32(3),
      protocol_config_id: runtime.protocolConfigId,
      protocol_config_revision: '7',
      protocol_config_commitment: bytes32(0xdd),
      protocol_treasury_id: runtime.protocolTreasuryId,
      maker_treasury_id: IDs.makerTreasuryId,
      catalog_id: runtime.catalogId,
      product_binding_commitment: bytes32(60),
      call_cap_set_commitment: bytes32(61),
      native_capability_mask: '127',
      capability_binding_commitment: bytes32(7),
      base_registry_id: IDs.baseRegistryId,
      seal_policy_config_id: runtime.roleConfigIds.seal,
      seal_registry_id: IDs.sealRegistryId,
      runtime_definition_registry_id: IDs.runtimeDefinitionRegistryId,
      pack_registry_id: IDs.packRegistryId,
      admission_authority_id: IDs.packAdmissionAuthorityId,
      output_registry_id: IDs.outputRegistryId,
      soul_registry_id: IDs.soulRegistryId,
      physical_registry_id: IDs.physicalRegistryId,
      market_registry_id: IDs.marketRegistryId,
      market_treasury_id: IDs.marketTreasuryId,
    },
  };
}

function capabilityFields(runtime) {
  return {
    native_capability_mask: '127',
    catalog_id: runtime.catalogId,
    call_cap_set: {},
    protocol_config_id: runtime.protocolConfigId,
    base_registry_id: IDs.baseRegistryId,
    maker_treasury_id: IDs.makerTreasuryId,
    protocol_treasury_id: runtime.protocolTreasuryId,
    seal_policy_config_id: runtime.roleConfigIds.seal,
    seal_registry_id: IDs.sealRegistryId,
    runtime_definition_registry_id: IDs.runtimeDefinitionRegistryId,
    pack_registry_id: IDs.packRegistryId,
    admission_authority_id: IDs.packAdmissionAuthorityId,
    output_registry_id: IDs.outputRegistryId,
    soul_registry_id: IDs.soulRegistryId,
    physical_registry_id: IDs.physicalRegistryId,
    market_registry_id: IDs.marketRegistryId,
    market_treasury_id: IDs.marketTreasuryId,
    seal_readiness_commitment: bytes32(8),
    runtime_readiness_commitment: bytes32(9),
    output_readiness_commitment: bytes32(10),
    physical_readiness_commitment: bytes32(11),
    market_readiness_commitment: bytes32(12),
    commitment: bytes32(7),
  };
}

function rootResponse(runtime, lifecycleCode) {
  return moveObject(
    makerV8ChainTypes(runtime).root,
    IDs.rootId,
    {
      version: '8',
      core_original_package_id: runtime.roles.core.typeOriginPackageId,
      core_callable_package_id: runtime.roles.core.callablePackageId,
      creator: IDs.creator,
      owner: IDs.seller,
      admin_cap_id: IDs.adminCapId,
      control_epoch: '5',
      lifecycle: String(lifecycleCode),
      maker_key: 'offline-production-maker',
      maker_version: '42',
      version_commitment: bytes32(1),
      previous_root_id: [],
      previous_version_commitment: [],
      successor_authority_id: [],
      successor_root_id: [],
      renderer_commitment: bytes32(3),
      manifest_blob_id: 'offline-manifest',
      manifest_sha256: bytes32(13),
      content_commitment: bytes32(0xaa),
      base_registry_id: [IDs.baseRegistryId],
      maker_treasury_id: [IDs.makerTreasuryId],
      expected_base_definition_count: '2',
      expected_base_registry_commitment: bytes32(14),
      expected_pack_admission_policy_commitment: bytes32(15),
      economics: {
        protocol_config_id: runtime.protocolConfigId,
        protocol_config_revision: '7',
        protocol_config_commitment: bytes32(4),
      },
      rights: {},
      product_release_binding: [{}],
      pack_admission_binding: [{}],
      capability_registry_binding: [{ fields: capabilityFields(runtime) }],
      created_at_ms: '1',
    },
  );
}

function protocolConfigResponse(runtime) {
  return moveObject(makerV8ChainTypes(runtime).protocolConfig, runtime.protocolConfigId, {
    version: '8',
    core_original_package_id: runtime.roles.core.typeOriginPackageId,
    core_callable_package_id: runtime.roles.core.callablePackageId,
    revision: '7',
    treasury_id: [runtime.protocolTreasuryId],
    payment_coin_type: runtime.paymentCoinType,
    enabled: true,
    commitment: bytes32(0xdd),
  });
}

function makerTreasuryResponse(runtime) {
  return moveObject(makerV8ChainTypes(runtime).makerTreasury, IDs.makerTreasuryId, {
    version: '8',
    root_id: IDs.rootId,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    revenue: { fields: { value: '0' } },
    total_collected: '0',
    total_withdrawn: '0',
  });
}

function quoteBytes(quote) {
  const u64 = (value) => {
    const result = [];
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      result.push(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
    return result;
  };
  const hex = (value) => value.slice(2).match(/.{2}/g)
    .map((pair) => Number.parseInt(pair, 16));
  const vector32 = (value) => [32, ...hex(value)];
  return Uint8Array.from([
    quote.quoteKind,
    ...hex(quote.rootId),
    ...u64(quote.makerVersion),
    ...vector32(quote.rootContentCommitment),
    ...vector32(quote.economicsCommitment),
    ...vector32(quote.rightsCommitment),
    ...u64(quote.grossAtomic),
    ...u64(quote.protocolAtomic),
    ...u64(quote.creatorAtomic),
    ...u64(quote.sourceAtomic),
    ...u64(quote.sellerAtomic),
    ...vector32(quote.commitment),
  ]);
}

function soulBundle(types, base, ownershipEpoch) {
  const outputId = id(base);
  const receiptId = id(base + 1);
  const soulId = id(base + 2);
  const common = {
    root_id: IDs.rootId,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    output_key: `offline-${base}`,
    holder: IDs.seller,
  };
  const owner = { AddressOwner: IDs.seller };
  return {
    ids: [outputId, receiptId, soulId],
    output: moveObject(types.completeOutput, outputId, {
      ...common,
      version: '8',
      output_registry_id: IDs.outputRegistryId,
      output_commitment: bytes32(20 + ownershipEpoch),
    }, { owner }),
    receipt: moveObject(types.completeReceipt, receiptId, {
      ...common,
      version: '8',
      output_id: outputId,
      receipt_commitment: bytes32(30 + ownershipEpoch),
    }, { owner }),
    soul: moveObject(types.canonicalSoul, soulId, {
      ...common,
      version: '8',
      soul_registry_id: IDs.soulRegistryId,
      ownership_epoch: String(ownershipEpoch),
      output_id: outputId,
      receipt_id: receiptId,
      soul_commitment: bytes32(40 + ownershipEpoch),
    }, { owner }),
  };
}

function physicalAsset(types, {
  objectId,
  sourceKind,
  sourceId,
  sourceTreasuryId = null,
  ownershipEpoch,
}) {
  return moveObject(types.physicalAsset, objectId, {
    version: '8',
    registry_id: IDs.physicalRegistryId,
    root_id: IDs.rootId,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    source: { fields: {
      source_kind: String(sourceKind),
      source_id: sourceId,
      source_semantic_id: sourceKind === 0 ? `base-${ownershipEpoch}` : `pack-${ownershipEpoch}`,
      source_content_commitment: bytes32(60 + ownershipEpoch),
      source_treasury_id: sourceTreasuryId ? [sourceTreasuryId] : [],
      pack_registry_id: sourceKind === 1 ? [IDs.packRegistryId] : [],
      pack_registry_revision: '0',
      registered_pack_owner: [],
      registered_pack_control_epoch: '0',
      registered_pack_admin_cap_id: [],
    } },
    style: { fields: {
      part_key: 'body', item_key: 'shirt', style_key: 'default', layer_track_key: 'body',
      color_channel_key: [], default_swatch_key: [], style_asset_blob_id: 'asset',
      style_asset_sha256: bytes32(49 + ownershipEpoch), style_protected: false,
    } },
    asset_content_commitment: bytes32(50 + ownershipEpoch),
    holder: IDs.seller,
    ownership_epoch: String(ownershipEpoch),
    transferable: true,
    provenance_commitment: bytes32(70 + ownershipEpoch),
  }, { owner: { AddressOwner: IDs.seller } });
}

function renderRoot() {
  return {
    innerHTML: '',
    addEventListener() {},
    querySelector() { return null; },
  };
}

function walletRegistry({ connectMode = 'mainnet', provider = true } = {}) {
  const mainnetAccount = {
    address: IDs.seller,
    chains: [SUI_MAINNET_CHAIN],
    features: [SuiSignTransaction],
  };
  const testnetAccount = {
    ...mainnetAccount,
    chains: ['sui:testnet'],
  };
  let signCalls = 0;
  let currentMode = connectMode;
  const wallet = {
    id: `offline-${connectMode}`,
    name: `Offline ${connectMode}`,
    version: '1.0.0',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    chains: [SUI_MAINNET_CHAIN],
    accounts: [],
    features: {
      [StandardConnect]: {
        version: '1.0.0',
        async connect() {
          if (currentMode === 'rejected') throw new Error('offline reconnect rejected');
          return { accounts: currentMode === 'wrong-chain' ? [testnetAccount] : [mainnetAccount] };
        },
      },
      [StandardEvents]: {
        version: '1.0.0',
        on() { return () => {}; },
      },
      [SuiSignTransaction]: {
        version: '2.0.0',
        async signTransaction() {
          signCalls += 1;
          throw new Error('offline test must never reach Wallet Standard signing');
        },
      },
    },
  };
  return {
    registry: {
      get: () => (provider ? [wallet] : []),
      on: () => () => {},
    },
    setConnectMode(value) { currentMode = value; },
    get signCalls() { return signCalls; },
  };
}

async function productionFixture() {
  const rawRuntime = runtimeFixture();
  const attestation = runtimeAttestationRpc(rawRuntime);
  const objects = new Map();
  const ownedByType = new Map();
  const reads = new Map();
  const quoteInspectionFunctions = [];
  const actionDryRunFunctions = [];
  let forbidQuoteInspection = false;
  let broadcastCalls = 0;
  let runtime;
  let market;
  let registry;

  const client = {
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getObject(request) {
      reads.set(request.id, (reads.get(request.id) || 0) + 1);
      return objects.get(request.id) ?? attestation.getObject(request);
    },
    async queryEvents({ query }) {
      if (query.MoveEventType === makerV8ChainTypes(rawRuntime).activationEvent) {
        return { data: [activationEvent(rawRuntime)], hasNextPage: false, nextCursor: null };
      }
      return { data: [], hasNextPage: false, nextCursor: null };
    },
    async getOwnedObjects({ filter }) {
      return {
        data: ownedByType.get(filter.StructType) || [],
        hasNextPage: false,
        nextCursor: null,
      };
    },
    async simulateTransaction({ transaction }) {
      const call = transaction.getData().commands.find((command) => command.MoveCall)?.MoveCall;
      quoteInspectionFunctions.push(call?.function ?? 'missing');
      if (forbidQuoteInspection) {
        throw new Error('frozen cancel/recover must not build a quote-inspection PTB');
      }
      const quote = call?.function === 'quote_soul_resale_v8'
        ? market.quoteSoulResale(registry, '1000000')
        : market.quotePhysicalResale(registry, '1000000');
      return {
        $kind: 'Transaction',
        commandResults: [{ returnValues: [{ bcs: quoteBytes(quote) }] }],
      };
    },
    async dryRunTransactionBlock({ transactionBlock }) {
      const snapshot = TransactionDataBuilder.fromBytes(fromBase64(transactionBlock)).snapshot();
      const calls = snapshot.commands.filter((command) => command.MoveCall);
      assert.equal(calls.length, 1, 'cancel/recover dry-run must contain one Market action');
      actionDryRunFunctions.push(calls[0].MoveCall.function);
      return { effects: { status: { status: 'success' } } };
    },
    async executeTransactionBlock() {
      broadcastCalls += 1;
      throw new Error('offline test must never broadcast');
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '100' } }; },
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
            budget: '10000000',
            price: '1000',
            owner: transactionData.sender,
            payment: [{ objectId: IDs.gas, version: '1', digest: objectDigest }],
          };
          await next();
        };
      },
    },
  };

  runtime = (await attestMakerV8Runtime(client, rawRuntime)).runtime;
  market = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  const chainTypes = makerV8ChainTypes(runtime);

  const registryResponse = moveObject(market.types.marketRegistry, IDs.marketRegistryId, {
    catalog_id: runtime.catalogId,
    package_config_id: runtime.roleConfigIds.market,
    product_binding_commitment: bytes32(60),
    call_cap_set_commitment: bytes32(61),
    root_id: IDs.rootId,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    protocol_config_id: runtime.protocolConfigId,
    protocol_config_revision: '7',
    protocol_config_commitment: bytes32(0xdd),
    economics_commitment: bytes32(0xbb),
    rights_commitment: bytes32(0xcc),
    maker_market_fee_bps: '250',
    soul_market_fee_bps: '300',
    soul_creator_royalty_bps: '500',
    maker_source_royalty_bps: '200',
    maker_resale_royalty_bps: '400',
    treasury_id: IDs.marketTreasuryId,
    sealed: true,
    revision: '4',
    listing_count: '2',
    escrow_count: '2',
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
  const treasuryResponse = moveObject(market.types.marketTreasury, IDs.marketTreasuryId, {
    version: '8',
    catalog_id: runtime.catalogId,
    package_config_id: runtime.roleConfigIds.market,
    root_id: IDs.rootId,
    maker_version: '42',
    root_content_commitment: bytes32(0xaa),
    escrow: { value: '0' },
    gross_escrowed_atomic: '0',
    gross_released_atomic: '0',
  });
  registry = market.parseRegistry(registryResponse);
  const physicalQuote = market.quotePhysicalResale(registry, '1000000');
  const listingAmounts = {
    gross_atomic: physicalQuote.grossAtomic.toString(),
    protocol_atomic: physicalQuote.protocolAtomic.toString(),
    creator_atomic: physicalQuote.creatorAtomic.toString(),
    source_atomic: physicalQuote.sourceAtomic.toString(),
    seller_atomic: physicalQuote.sellerAtomic.toString(),
    quote_commitment: physicalQuote.commitment,
    status: String(marketModule.MARKET_V8_LISTING_STATUS.OPEN),
    revision: '0',
    terminal_recipient: '0x0',
  };
  const physicalListing = ({ sourceKind, listingId, assetId, sourceId, sourceTreasuryId }) => (
    moveObject(market.types.physicalListing, listingId, {
      version: '8',
      registry_id: IDs.marketRegistryId,
      treasury_id: IDs.marketTreasuryId,
      package_config_id: runtime.roleConfigIds.market,
      custody: {
        version: '8',
        catalog_id: runtime.catalogId,
        product_binding_commitment: bytes32(60),
        call_cap_set_commitment: bytes32(61),
        market_authority_id: runtime.roleConfigIds.market,
        market_registry_id: IDs.marketRegistryId,
        market_treasury_id: IDs.marketTreasuryId,
        listing_id: listingId,
        physical_package_config_id: runtime.roleConfigIds.physical,
        physical_registry_id: IDs.physicalRegistryId,
        root_id: IDs.rootId,
        maker_version: '42',
        root_content_commitment: bytes32(0xaa),
        asset_id: assetId,
        asset_content_commitment: bytes32(sourceKind === 0 ? 20 : 21),
        source_kind: String(sourceKind),
        source_id: sourceId,
        source_semantic_id: sourceKind === 0 ? 'base-listing' : 'pack-listing',
        source_content_commitment: bytes32(sourceKind === 0 ? 22 : 23),
        source_treasury_id: sourceTreasuryId,
        holder: IDs.seller,
        ownership_epoch: '5',
        transferable: true,
        provenance_commitment: bytes32(24),
      },
      ...listingAmounts,
    })
  );

  objects.set(IDs.rootId, rootResponse(runtime, marketModule.MARKET_V8_LIFECYCLES.ACTIVE));
  objects.set(runtime.protocolConfigId, protocolConfigResponse(runtime));
  objects.set(IDs.makerTreasuryId, makerTreasuryResponse(runtime));
  objects.set(IDs.marketRegistryId, registryResponse);
  objects.set(IDs.marketTreasuryId, treasuryResponse);
  objects.set(IDs.outputRegistryId, moveObject(market.types.outputRegistry, IDs.outputRegistryId));
  objects.set(IDs.soulRegistryId, moveObject(market.types.soulRegistry, IDs.soulRegistryId));
  objects.set(IDs.physicalRegistryId, moveObject(market.types.physicalRegistry, IDs.physicalRegistryId));
  objects.set(IDs.baseListingId, physicalListing({
    sourceKind: marketModule.MARKET_V8_PHYSICAL_SOURCES.BASE,
    listingId: IDs.baseListingId,
    assetId: IDs.baseListingAssetId,
    sourceId: IDs.baseRegistryId,
    sourceTreasuryId: IDs.makerTreasuryId,
  }));
  objects.set(IDs.packListingId, physicalListing({
    sourceKind: marketModule.MARKET_V8_PHYSICAL_SOURCES.PACK,
    listingId: IDs.packListingId,
    assetId: IDs.packListingAssetId,
    sourceId: IDs.packListingReleaseId,
    sourceTreasuryId: IDs.packListingTreasuryId,
  }));
  objects.set(IDs.baseListingAssetId, moveObject(
    market.types.physicalAsset,
    IDs.baseListingAssetId,
    {},
    { owner: { ObjectOwner: IDs.baseListingId }, version: '9' },
  ));
  objects.set(IDs.packListingAssetId, moveObject(
    market.types.physicalAsset,
    IDs.packListingAssetId,
    {},
    { owner: { ObjectOwner: IDs.packListingId }, version: '10' },
  ));

  const soulHigh = soulBundle(chainTypes, 630, 6);
  const soulLow = soulBundle(chainTypes, 600, 5);
  ownedByType.set(chainTypes.adminCap, []);
  ownedByType.set(chainTypes.completeOutput, [soulHigh.output, soulLow.output]);
  ownedByType.set(chainTypes.completeReceipt, [soulHigh.receipt, soulLow.receipt]);
  ownedByType.set(chainTypes.canonicalSoul, [soulHigh.soul, soulLow.soul]);

  const baseHigh = {
    id: id(650), sourceId: id(750),
    response: physicalAsset(chainTypes, {
      objectId: id(650), sourceKind: 0, sourceId: id(750), ownershipEpoch: 8,
    }),
  };
  const baseLow = {
    id: id(640), sourceId: id(740),
    response: physicalAsset(chainTypes, {
      objectId: id(640), sourceKind: 0, sourceId: id(740), ownershipEpoch: 7,
    }),
  };
  const packHigh = {
    id: id(670), sourceId: id(770), treasuryId: id(870),
    response: physicalAsset(chainTypes, {
      objectId: id(670), sourceKind: 1, sourceId: id(770),
      sourceTreasuryId: id(870), ownershipEpoch: 10,
    }),
  };
  const packLow = {
    id: id(660), sourceId: id(760), treasuryId: id(860),
    response: physicalAsset(chainTypes, {
      objectId: id(660), sourceKind: 1, sourceId: id(760),
      sourceTreasuryId: id(860), ownershipEpoch: 9,
    }),
  };
  ownedByType.set(chainTypes.physicalAsset, [
    packHigh.response,
    baseHigh.response,
    packLow.response,
    baseLow.response,
  ]);
  for (const pack of [packHigh, packLow]) {
    objects.set(pack.treasuryId, moveObject(market.types.packTreasury, pack.treasuryId));
  }

  return {
    client,
    runtime,
    inventory: {
      souls: [soulLow.ids, soulHigh.ids],
      bases: [baseLow, baseHigh],
      packs: [packLow, packHigh],
    },
    setLifecycle(lifecycleCode) {
      objects.set(IDs.rootId, rootResponse(runtime, lifecycleCode));
    },
    forbidQuoteInspection(value = true) { forbidQuoteInspection = value; },
    readCount(objectId) { return reads.get(objectId) || 0; },
    get quoteInspectionFunctions() { return [...quoteInspectionFunctions]; },
    get actionDryRunFunctions() { return [...actionDryRunFunctions]; },
    get broadcastCalls() { return broadcastCalls; },
  };
}

function productionAdapters(fixture, wallet) {
  return createProductionMakerV8BrowserAdapters({
    runtime: fixture.runtime,
    execution,
    client: fixture.client,
    walletRegistry: wallet.registry,
    persistence: recoveryModule.createMakerV8RecoveryMemoryAdapter(),
  });
}

function controllerFor(route, fixture, wallet) {
  return createFreshV8Controller({
    route: parseFreshV8Route(route),
    runtime: fixture.runtime,
    execution,
    adapters: productionAdapters(fixture, wallet),
    marketModule,
    recoveryModule,
  });
}

test('default production factory stays browseable without a wallet and enumerates exact live inventory after reconnect', async () => {
  const fixture = await productionFixture();

  fixture.setLifecycle(marketModule.MARKET_V8_LIFECYCLES.PAUSED);
  const noProvider = walletRegistry({ provider: false });
  const listing = controllerFor(`/market/${IDs.baseListingId}`, fixture, noProvider);
  const listingRoot = renderRoot();
  renderFreshV8App(listingRoot, listing);
  await listing.refresh();
  assert.equal(listing.snapshot().account, null);
  assert.equal(listing.snapshot().status, 'READY');
  assert.equal(listing.snapshot().view.listingKind, 'PhysicalListingV8');
  assert.equal(listing.snapshot().view.listingStatus, 'OPEN');
  assert.match(listingRoot.innerHTML, /Typed Market custody/);
  await assert.rejects(() => listing.reconnect(), {
    code: 'MAKER_V8_BROWSER_WALLET_UNAVAILABLE',
  });
  assert.equal(listing.snapshot().issue.layer, 'WALLET');
  assert.match(listingRoot.innerHTML, /No compatible Sui Wallet Standard wallet is registered/);

  fixture.setLifecycle(marketModule.MARKET_V8_LIFECYCLES.ACTIVE);
  const disconnectedProvider = walletRegistry();
  const maker = controllerFor(`/maker/${IDs.rootId}`, fixture, disconnectedProvider);
  await maker.refresh();
  assert.equal(maker.snapshot().account, null);
  assert.equal(maker.snapshot().status, 'READY');
  assert.equal(maker.snapshot().view.title, 'offline-production-maker');
  assert.deepEqual(maker.snapshot().availableActions, [
    'listSoulBundle', 'listBasePhysical', 'listPackPhysical',
  ]);

  await maker.reconnect();
  assert.equal(maker.snapshot().account.address, IDs.seller);
  await maker.selectAction('listSoulBundle');
  assert.deepEqual(
    maker.snapshot().inventoryChoices.map((choice) => choice.objectIds),
    fixture.inventory.souls,
    'two live Soul bundles must be sorted by their exact Output IDs',
  );
  assert.equal(maker.snapshot().selectedInventoryId, null);
  await maker.selectInventory(fixture.inventory.souls[1][0]);
  assert.equal(maker.snapshot().selectedInventoryId, fixture.inventory.souls[1][0]);
  assert.equal(
    maker.snapshot().context.builderInput.outputAsset.objectId,
    fixture.inventory.souls[1][0],
  );

  await maker.selectAction('listBasePhysical');
  assert.deepEqual(
    maker.snapshot().inventoryChoices.map((choice) => choice.id),
    fixture.inventory.bases.map((entry) => entry.id),
    'two Base assets must be stable-sorted instead of selecting the first RPC row',
  );
  await maker.selectInventory(fixture.inventory.bases[1].id);
  assert.equal(maker.snapshot().selectedInventoryId, fixture.inventory.bases[1].id);
  assert.equal(maker.snapshot().context.builderInput.asset.objectId, fixture.inventory.bases[1].id);

  await maker.selectAction('listPackPhysical');
  assert.deepEqual(
    maker.snapshot().inventoryChoices.map((choice) => choice.id),
    fixture.inventory.packs.map((entry) => entry.id),
    'two Pack assets must be stable-sorted independently from Base inventory',
  );
  await maker.selectInventory(fixture.inventory.packs[1].id);
  assert.equal(maker.snapshot().selectedInventoryId, fixture.inventory.packs[1].id);
  assert.equal(maker.snapshot().context.builderInput.asset.objectId, fixture.inventory.packs[1].id);
  assert.equal(
    maker.snapshot().context.builderInput.packTreasury.objectId,
    fixture.inventory.packs[1].treasuryId,
  );

  const wrongChainWallet = walletRegistry({ connectMode: 'wrong-chain' });
  const wrongChain = controllerFor(`/maker/${IDs.rootId}`, fixture, wrongChainWallet);
  const wrongChainRoot = renderRoot();
  renderFreshV8App(wrongChainRoot, wrongChain);
  await wrongChain.refresh();
  await assert.rejects(() => wrongChain.reconnect(), {
    code: 'MAKER_V8_BROWSER_WALLET_NETWORK_DRIFT',
  });
  assert.equal(wrongChain.snapshot().issue.layer, 'WALLET');
  assert.match(wrongChainRoot.innerHTML, /Wallet did not authorize a Sui Mainnet account/);
  assert.equal(disconnectedProvider.signCalls, 0);
  assert.equal(wrongChainWallet.signCalls, 0);
  assert.equal(fixture.broadcastCalls, 0);
});

test('default production factory keeps frozen Base/Pack cancel and recovery quote-free through pre-sign refetch', async (t) => {
  const fixture = await productionFixture();
  fixture.setLifecycle(marketModule.MARKET_V8_LIFECYCLES.PAUSED);
  fixture.forbidQuoteInspection();

  const cases = [
    {
      name: 'Base cancel',
      listingId: IDs.baseListingId,
      assetId: IDs.baseListingAssetId,
      action: 'cancelPhysicalListing',
      lane: 'PHYSICAL_BASE',
      laneCode: marketModule.MARKET_V8_LANES.PHYSICAL_BASE,
      functionName: 'cancel_physical_listing_v8',
      authority: 'PHYSICAL_CANCEL',
    },
    {
      name: 'Pack cancel',
      listingId: IDs.packListingId,
      assetId: IDs.packListingAssetId,
      action: 'cancelPhysicalListing',
      lane: 'PHYSICAL_PACK',
      laneCode: marketModule.MARKET_V8_LANES.PHYSICAL_PACK,
      functionName: 'cancel_physical_listing_v8',
      authority: 'PHYSICAL_CANCEL',
    },
    {
      name: 'Base recover',
      listingId: IDs.baseListingId,
      assetId: IDs.baseListingAssetId,
      action: 'recoverPhysicalListing',
      lane: 'PHYSICAL_BASE',
      laneCode: marketModule.MARKET_V8_LANES.PHYSICAL_BASE,
      functionName: 'recover_physical_listing_v8',
      authority: 'PHYSICAL_RECOVER',
    },
    {
      name: 'Pack recover',
      listingId: IDs.packListingId,
      assetId: IDs.packListingAssetId,
      action: 'recoverPhysicalListing',
      lane: 'PHYSICAL_PACK',
      laneCode: marketModule.MARKET_V8_LANES.PHYSICAL_PACK,
      functionName: 'recover_physical_listing_v8',
      authority: 'PHYSICAL_RECOVER',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const wallet = walletRegistry();
      const controller = controllerFor(`/market/${entry.listingId}`, fixture, wallet);
      await controller.refresh();
      assert.equal(controller.snapshot().account, null, 'listing detail must load before reconnect');
      await controller.reconnect();

      const quoteCalls = fixture.quoteInspectionFunctions.length;
      const dryRuns = fixture.actionDryRunFunctions.length;
      await controller.selectAction(entry.action);
      assert.equal(controller.snapshot().context.builderInput.listing.objectId, entry.listingId);
      assert.equal(controller.snapshot().context.builderInput.receiving.objectId, entry.assetId);

      const reviewed = await controller.reviewQuote();
      assert.equal(reviewed.evidence.source, 'live-listing');
      const prepared = await controller.prepare();
      assert.equal(prepared.descriptor.action, entry.action);
      assert.equal(prepared.descriptor.lane, entry.laneCode);
      assert.deepEqual(prepared.descriptor.preState.assetIds, [entry.assetId]);
      assert.equal(
        prepared.descriptor.arguments.find((argument) => argument.name === 'receiving').objectId,
        entry.assetId,
      );
      assert.equal(prepared.identity.lane, entry.lane);
      assert.equal(prepared.identity.listing.id, entry.listingId);
      assert.equal(prepared.identity.authority.kind, entry.authority);
      assert.deepEqual(prepared.identity.authority.refs.map((ref) => ref.id), [entry.assetId]);

      const listingReads = fixture.readCount(entry.listingId);
      const assetReads = fixture.readCount(entry.assetId);
      await assert.rejects(
        () => controller.requestSignature('SIGN EXACT TRANSACTION'),
        (error) => error.code === 'MAKER_V8_RECOVERY_SIGNING_FAILED'
          && error.cause?.code === 'WEB_V8_SIGNING_DISABLED',
      );
      assert.ok(
        fixture.readCount(entry.listingId) > listingReads,
        'pre-sign must refetch the exact typed listing',
      );
      assert.ok(
        fixture.readCount(entry.assetId) > assetReads,
        'pre-sign must refetch the exact Receiving child ref',
      );
      assert.equal(
        fixture.quoteInspectionFunctions.length,
        quoteCalls,
        'frozen cancel/recover must never build a quote-inspection PTB',
      );
      assert.deepEqual(
        fixture.actionDryRunFunctions.slice(dryRuns),
        [entry.functionName, entry.functionName],
        'prepare and pre-sign must each simulate the exact action, never a quote helper',
      );
      assert.equal(wallet.signCalls, 0);
      assert.equal(fixture.broadcastCalls, 0);
    });
  }
});
