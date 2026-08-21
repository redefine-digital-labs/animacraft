import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  MARKET_V8_ACTIONS,
  WEB_V8_READBACK_SCHEMA,
  assertFinalizedMarketReadbackV8,
  marketRuntimeFromMakerRuntime,
} from '../app.js';
import { assertMakerV8Runtime } from '../maker-v8-runtime.js';

const defaultModulePath = new URL('../maker-v8-market.js', import.meta.url).pathname;
const modulePath = process.env.MAKER_V8_MARKET_MODULE || defaultModulePath;
let marketModule = null;
try {
  await access(modulePath);
  marketModule = await import(pathToFileURL(modulePath));
} catch {
  // The Web branch predates the independently integrated Market module. The
  // integration runner supplies MAKER_V8_MARKET_MODULE until both land together.
}

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const packageId = (digit) => `0x${digit.repeat(64)}`;
const bytes32 = (value) => Array(32).fill(value);
const digest = '11111111111111111111111111111111';

function makerRuntime() {
  const rolePackages = {
    core: packageId('1'), seal: packageId('6'), runtime: packageId('4'), output: packageId('2'), physical: packageId('3'), market: packageId('5'), release: packageId('7'),
  };
  return assertMakerV8Runtime({
    schemaVersion: 'animacraft.maker-v8-runtime.v8',
    protocolVersion: 8,
    enabled: true,
    catalogId: id(900),
    protocolConfigId: id(901),
    protocolTreasuryId: id(902),
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    clockObjectId: `0x${'0'.repeat(63)}6`,
    roles: Object.fromEntries(Object.entries(rolePackages).map(([role, packageValue]) => [role, {
      typeOriginPackageId: packageValue,
      callablePackageId: packageValue,
    }])),
    roleConfigIds: {
      seal: id(910), runtime: id(911), output: id(912), physical: id(913), market: id(914), release: id(915),
    },
    makerBindings: [],
  });
}

function moveObject(type, objectId, fields) {
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
    },
  };
}

test('web fixture is the exact MakerV8Activated and fourteen-action surface', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/web-v8-chain.json', import.meta.url), 'utf8'));
  assert.equal(fixture.activationEvent.module, 'release_v8');
  assert.equal(fixture.activationEvent.name, 'MakerV8Activated');
  assert.ok(fixture.activationEvent.fields.includes('market_registry_id'));
  assert.ok(fixture.activationEvent.fields.includes('market_treasury_id'));
  assert.deepEqual(fixture.actions, MARKET_V8_ACTIONS.map((action) => action.id));
  assert.deepEqual(fixture.listingTypes, ['MakerListingV8', 'SoulListingV8', 'PhysicalListingV8']);
});

test('web runtime bridge invokes the real Market Transaction builder', {
  skip: marketModule ? false : `Set MAKER_V8_MARKET_MODULE to the integrated maker-v8-market.js (looked for ${modulePath}).`,
}, () => {
  const runtime = marketRuntimeFromMakerRuntime(makerRuntime(), 'mainnet');
  const client = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  assert.deepEqual(Object.keys(marketModule.MARKET_V8_ACTION_ABI), MARKET_V8_ACTIONS.map((action) => action.id));
  for (const action of MARKET_V8_ACTIONS) assert.equal(typeof client[action.builder], 'function', action.id);
  assert.equal(typeof client.buildQuoteInspection, 'function');
  assert.equal(typeof client.inspectQuoteOnChain, 'function');

  const IDs = {
    registry: id(100), treasury: id(101), catalog: runtime.catalogId, config: id(103), root: id(104),
    protocolConfig: runtime.protocolConfigId, admin: id(107), makerTreasury: id(108), seller: id(200),
  };
  const registryResponse = moveObject(client.types.marketRegistry, IDs.registry, {
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
    listing_count: '0',
    escrow_count: '0',
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
  const treasuryResponse = moveObject(client.types.marketTreasury, IDs.treasury, {
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
  const registry = client.parseRegistry(registryResponse);
  const treasury = client.parseTreasury(treasuryResponse);
  const object = (objectId, type, fields = {}) => ({
    schemaVersion: 'animacraft.maker-v8-chain.v8',
    objectId,
    version: '7',
    digest,
    network: 'mainnet',
    type,
    ...fields,
  });
  const compiled = client.buildListMakerControl({
    registry,
    treasury,
    root: object(IDs.root, client.types.makerRoot, {
      binding: Object.freeze({ makerTreasuryId: IDs.makerTreasury }),
      lifecycleCode: marketModule.MARKET_V8_LIFECYCLES.PAUSED,
    }),
    catalog: object(IDs.catalog, client.types.catalog),
    config: object(IDs.config, client.types.marketConfig),
    protocolConfig: object(IDs.protocolConfig, client.types.protocolConfig, {
      enabled: true,
      revision: registry.fields.protocolConfigRevision,
      commitment: registry.fields.protocolConfigCommitment,
    }),
    wallet: { address: IDs.seller, network: 'mainnet' },
    admin: object(IDs.admin, client.types.makerAdmin),
    makerTreasury: object(IDs.makerTreasury, client.types.makerTreasury, { balanceAtomic: '0' }),
    grossAtomic: '1000000',
    expectedRegistryRevision: registry.fields.revision,
  });
  assert.equal(compiled.descriptor.action, 'listMakerControl');
  assert.equal(compiled.descriptor.lane, marketModule.MARKET_V8_LANES.MAKER);
  assert.equal(compiled.descriptor.target, `${runtime.roles.market.callablePackageId}::market_v8::list_maker_control_v8`);
  assert.equal(compiled.descriptor.arguments.at(-1).value, '1000000');
  assert.equal(typeof compiled.transaction.getData, 'function');

  const listingId = id(109);
  const finalizedDigest = digest;
  const identity = {
    action: 'listMakerControl',
    root: { id: IDs.root },
    listing: { id: IDs.admin },
    registry: { id: IDs.registry },
    treasury: { id: IDs.treasury },
  };
  const event = {
    id: { txDigest: finalizedDigest, eventSeq: '0' },
    type: `${runtime.roles.market.typeOriginPackageId}::market_v8::MarketListingOpenedV8`,
    parsedJson: {
      listing_id: listingId,
      registry_id: IDs.registry,
      lane: String(marketModule.MARKET_V8_LANES.MAKER),
      root_id: IDs.root,
      asset_id: IDs.admin,
      seller: IDs.seller,
      ownership_epoch: '0',
      gross_atomic: '1000000',
      quote_commitment: client.quoteMakerResale(registry, '1000000').commitment,
    },
  };
  const objectEvidence = (role, objectId, type, change) => ({
    role, objectId, version: '8', digest, type, change,
  });
  const readback = {
    schemaVersion: WEB_V8_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    digest: finalizedDigest,
    checkpoint: '9',
    identity,
    event,
    objectReadback: {
      operation: 'listMakerControl',
      objects: [
        objectEvidence('ROOT', IDs.root, client.types.makerRoot, 'READBACK'),
        objectEvidence('REGISTRY', IDs.registry, client.types.marketRegistry, 'MUTATED'),
        objectEvidence('TREASURY', IDs.treasury, client.types.marketTreasury, 'READBACK'),
        objectEvidence('LISTING', listingId, client.types.makerListing, 'CREATED'),
      ],
    },
  };
  const verified = assertFinalizedMarketReadbackV8(
    readback,
    { digest: finalizedDigest, outcome: { checkpoint: '9' }, identity },
    client,
    marketModule,
  );
  assert.equal(verified.verified, true);
  assert.equal(verified.evidence.event.kind, 'MarketListingOpenedV8');
  assert.throws(
    () => assertFinalizedMarketReadbackV8(
      { ...readback, verified: true },
      { digest: finalizedDigest, outcome: { checkpoint: '9' }, identity },
      client,
      marketModule,
    ),
    { code: 'WEB_V8_FIELDS_INVALID' },
  );
});

test('real Market quote rejects an unparsed caller record before creating a Transaction', {
  skip: marketModule ? false : 'Market module is integrated in the parent worktree.',
}, () => {
  const runtime = marketRuntimeFromMakerRuntime(makerRuntime(), 'mainnet');
  const client = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  assert.throws(
    () => client.quoteMakerResale({}, 1_000_000),
    (error) => typeof error.code === 'string' && error.code.startsWith('MARKET_V8_'),
  );
});
