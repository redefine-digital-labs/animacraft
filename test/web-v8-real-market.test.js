import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bcs } from '@mysten/sui/bcs';
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';

import {
  MARKET_V8_ACTIONS,
  WEB_V8_READBACK_SCHEMA,
  assertFinalizedMarketReadbackV8,
  marketRuntimeFromMakerRuntime,
} from '../app.js';
import { assertMakerV8Runtime } from '../maker-v8-runtime.js';
import { attestFixtureRuntime } from './fixtures/maker-v8-runtime-attestation.js';

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

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

const hexHash = (value) => `0x${[...sha256(new TextEncoder().encode(stableJson(value)))]
  .map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
const addressOwner = (value) => ({ kind: 'AddressOwner', value });
const sharedOwner = Object.freeze({ kind: 'Shared', value: { initialSharedVersion: '1' } });

function coreRef(objectId, version, owner) {
  return { objectId, version, digest, owner };
}

function history(objectId, type, ref, parsed, previousTransaction) {
  return {
    objectId,
    type,
    ownerKind: ref.owner.kind,
    ref,
    owner: ref.owner,
    previousTransaction,
    parsed,
  };
}

function snakeCounters(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([field, value]) => [
    field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value,
  ]));
}

function quoteBytes(quote) {
  const schema = bcs.struct('MarketQuoteV8', {
    quote_kind: bcs.u8(), root_id: bcs.Address, maker_version: bcs.u64(),
    root_content_commitment: bcs.vector(bcs.u8()), economics_commitment: bcs.vector(bcs.u8()),
    rights_commitment: bcs.vector(bcs.u8()), gross_atomic: bcs.u64(), protocol_atomic: bcs.u64(),
    creator_atomic: bcs.u64(), source_atomic: bcs.u64(), seller_atomic: bcs.u64(),
    commitment: bcs.vector(bcs.u8()),
  });
  const vector = (value) => Uint8Array.from(value.slice(2).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
  return schema.serialize({
    quote_kind: quote.quoteKind, root_id: quote.rootId, maker_version: quote.makerVersion,
    root_content_commitment: vector(quote.rootContentCommitment), economics_commitment: vector(quote.economicsCommitment),
    rights_commitment: vector(quote.rightsCommitment), gross_atomic: quote.grossAtomic,
    protocol_atomic: quote.protocolAtomic, creator_atomic: quote.creatorAtomic,
    source_atomic: quote.sourceAtomic, seller_atomic: quote.sellerAtomic, commitment: vector(quote.commitment),
  }).toBytes();
}

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
}, async () => {
  const runtime = marketRuntimeFromMakerRuntime(
    await attestFixtureRuntime(makerRuntime()),
    'mainnet',
  );
  const client = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  assert.deepEqual(Object.keys(marketModule.MARKET_V8_ACTION_ABI), MARKET_V8_ACTIONS.map((action) => action.id));
  for (const action of MARKET_V8_ACTIONS) assert.equal(typeof client[action.builder], 'function', action.id);
  assert.equal(typeof client.buildQuoteInspection, 'function');
  assert.equal(typeof client.inspectQuoteOnChain, 'function');

  const IDs = {
    registry: id(100), treasury: id(101), catalog: runtime.catalogId, config: runtime.roleConfigIds.market, root: id(104),
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
  const root = object(IDs.root, client.types.makerRoot, {
    adminCapId: IDs.admin,
    ownerAddress: IDs.seller,
    creatorAddress: id(203),
    controlEpoch: '5',
    binding: Object.freeze({
      makerTreasuryId: IDs.makerTreasury,
      marketRegistryId: IDs.registry,
      marketTreasuryId: IDs.treasury,
    }),
    lifecycleCode: marketModule.MARKET_V8_LIFECYCLES.PAUSED,
  });
  const localQuote = client.quoteMakerResale(registry, 1_000_000n);
  const chainQuote = await client.inspectQuoteOnChain({
    async simulateTransaction() {
      return { $kind: 'Transaction', commandResults: [{ returnValues: [{ bcs: quoteBytes(localQuote) }] }] };
    },
  }, {
    registry, treasury, root, wallet: { address: IDs.seller, network: 'mainnet' },
    quoteKind: marketModule.MARKET_V8_QUOTE_KINDS.MAKER_RESALE, grossAtomic: 1_000_000n,
  });
  const compiled = client.buildListMakerControl({
    registry,
    treasury,
    root,
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
    chainQuote,
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
    wallet: IDs.seller,
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
      ownership_epoch: '5',
      gross_atomic: '1000000',
      quote_commitment: client.quoteMakerResale(registry, '1000000').commitment,
    },
  };
  const preState = compiled.descriptor.preState;
  const readback = {
    schemaVersion: WEB_V8_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    digest: finalizedDigest,
    checkpoint: '9',
    identity,
    transaction: {
      sender: IDs.seller,
      status: 'SUCCESS',
      target: compiled.descriptor.target,
      typeArguments: compiled.descriptor.typeArguments,
    },
    event,
    postState: {
      registry: {
        ...preState.registry,
        revision: '5',
        listingCount: '1',
        escrowCount: '1',
      },
      treasury: { ...preState.treasury },
      listing: {
        objectId: listingId,
        type: client.types.makerListing,
        change: 'CREATED',
        status: '0',
        revision: '0',
        terminalRecipient: id(0),
        seller: IDs.seller,
        ownershipEpoch: '5',
        assetIds: [IDs.admin],
        grossAtomic: preState.quote.grossAtomic,
        quoteCommitment: preState.quote.commitment,
      },
      root: {
        objectId: IDs.root,
        owner: IDs.seller,
        adminCapId: IDs.admin,
        controlEpoch: '5',
        change: 'READBACK',
      },
      assets: [{
        role: 'ADMIN',
        objectId: IDs.admin,
        type: client.types.makerAdmin,
        change: 'MUTATED',
        owner: listingId,
        holder: IDs.seller,
        ownershipEpoch: '5',
      }],
      revenue: { balances: [], coinOutputs: [] },
    },
  };
  assert.throws(
    () => assertFinalizedMarketReadbackV8(
      readback,
      {
        digest: finalizedDigest,
        outcome: { checkpoint: '9' },
        identity,
        planHash: `0x${'f1'.repeat(32)}`,
        plan: {
          fingerprint: `0x${'f1'.repeat(32)}`,
          sourceSnapshot: { descriptor: compiled.descriptor },
        },
      },
      client,
      marketModule,
    ),
    { code: 'WEB_V8_FINALIZED_FIELDS_INVALID' },
  );

  const [targetPackage, targetModule, targetFunction] = compiled.descriptor.target.split('::');
  const sharedInput = (objectId) => Inputs.SharedObjectRef({
    objectId,
    initialSharedVersion: '1',
    mutable: false,
  });
  const transactionRaw = TransactionDataBuilder.restore({
    version: 2,
    sender: IDs.seller,
    expiration: { Epoch: '8' },
    gasData: { budget: '1000', price: '1', owner: IDs.seller, payment: [] },
    inputs: [sharedInput(IDs.root), sharedInput(IDs.treasury), sharedInput(IDs.makerTreasury)],
    commands: [{
      $kind: 'MoveCall',
      MoveCall: {
        package: targetPackage,
        module: targetModule,
        function: targetFunction,
        typeArguments: compiled.descriptor.typeArguments,
        arguments: [],
      },
    }],
  }).build();
  const transactionBytes = toBase64(transactionRaw);
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionRaw);
  const planBase = {
    transactionBytes,
    transactionDigest,
    stage: 'MARKET_LIST',
    sequence: '0',
    signer: IDs.seller,
    epochWindow: { start: '7', end: '8' },
    gas: { owner: IDs.seller, budget: '1000', price: '1', payment: [] },
    expiration: { kind: 'Epoch', epoch: '8' },
    sourceSnapshot: {
      schema: 'animacraft.market-source-snapshot.v8',
      fingerprint: `0x${'12'.repeat(32)}`,
      descriptor: compiled.descriptor,
    },
    market: { schema: 'animacraft.market-recovery-evidence.v8', descriptor: compiled.descriptor, runtime: {} },
  };
  const finalizedPlanHash = hexHash(planBase);
  const plan = { ...planBase, fingerprint: finalizedPlanHash };
  const pre = compiled.descriptor.preState;
  const registryBefore = snakeCounters(pre.registry);
  const registryAfter = {
    ...registryBefore,
    revision: String(BigInt(registryBefore.revision) + 1n),
    listing_count: String(BigInt(registryBefore.listing_count) + 1n),
    escrow_count: String(BigInt(registryBefore.escrow_count) + 1n),
  };
  const treasuryParsed = {
    escrow: { value: '0' },
    gross_escrowed_atomic: pre.treasury.grossEscrowedAtomic,
    gross_released_atomic: pre.treasury.grossReleasedAtomic,
  };
  const rootParsed = {
    owner: IDs.seller,
    creator: pre.root.creator,
    admin_cap_id: IDs.admin,
    control_epoch: pre.root.controlEpoch,
    content_commitment: compiled.descriptor.rootContentCommitment,
  };
  const adminParsed = {
    root_id: IDs.root,
    owner: IDs.seller,
    control_epoch: pre.root.controlEpoch,
  };
  const listingParsed = {
    registry_id: IDs.registry,
    treasury_id: IDs.treasury,
    root_id: IDs.root,
    admin_cap_id: IDs.admin,
    seller: IDs.seller,
    expected_control_epoch: pre.ownershipEpoch,
    gross_atomic: pre.quote.grossAtomic,
    quote_commitment: pre.quote.commitment,
    status: '0',
    revision: '0',
    terminal_recipient: id(0),
  };
  const makerRevenue = { revenue: { value: '0' }, total_collected: '0', total_withdrawn: '0' };
  const unchangedRef = (objectId) => ({ ...coreRef(objectId, '7', sharedOwner), kind: 'ReadOnlyRoot' });
  const rootRef = unchangedRef(IDs.root);
  const treasuryRef = unchangedRef(IDs.treasury);
  const makerTreasuryRef = unchangedRef(IDs.makerTreasury);
  const registryInput = coreRef(IDs.registry, '7', sharedOwner);
  const registryOutput = coreRef(IDs.registry, '8', sharedOwner);
  const adminInput = coreRef(IDs.admin, '7', addressOwner(IDs.seller));
  const adminOutput = coreRef(IDs.admin, '8', addressOwner(listingId));
  const listingOutput = coreRef(listingId, '8', sharedOwner);
  const objectEvidence = (role, objectId, type, change, idOperation, before, after, revenue = { before: null, after: null }) => ({
    role, objectId, type, ownerKind: (after ?? before).ownerKind,
    change, idOperation, before, after, revenue,
  });
  const effectsBytes = new Uint8Array([1, 2, 3]);
  const effectsFingerprint = `0x${[...sha256(effectsBytes)].map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
  const coreEvent = {
    id: { txDigest: transactionDigest, eventSeq: '0' },
    packageId: runtime.roles.market.typeOriginPackageId,
    transactionModule: 'market_v8',
    sender: IDs.seller,
    type: `${runtime.roles.market.typeOriginPackageId}::market_v8::MarketListingOpenedV8`,
    parsedJson: {
      listing_id: listingId,
      registry_id: IDs.registry,
      lane: String(marketModule.MARKET_V8_LANES.MAKER),
      root_id: IDs.root,
      asset_id: IDs.admin,
      seller: IDs.seller,
      ownership_epoch: pre.ownershipEpoch,
      gross_atomic: pre.quote.grossAtomic,
      quote_commitment: pre.quote.commitment,
    },
    bcs: toBase64(new Uint8Array([9])),
    eventsDigest: digest,
  };
  const coreV2 = {
    schemaVersion: WEB_V8_READBACK_SCHEMA,
    source: 'FINALIZED_CORE_V2',
    digest: transactionDigest,
    epoch: '7',
    effectsFingerprint,
    eventsDigest: digest,
    planHash: finalizedPlanHash,
    identity,
    transaction: {
      sender: IDs.seller,
      status: 'SUCCESS',
      target: compiled.descriptor.target,
      typeArguments: compiled.descriptor.typeArguments,
    },
    event: coreEvent,
    events: [coreEvent],
    effects: {
      transactionDigest,
      epoch: '7',
      eventsDigest: digest,
      transactionBcs: transactionBytes,
      eventsBcs: toBase64(new Uint8Array([8, 9])),
      bcs: toBase64(effectsBytes),
      changedObjects: [
        { objectId: IDs.registry, inputState: 'Exists', input: registryInput, outputState: 'ObjectWrite', output: registryOutput, idOperation: 'None' },
        { objectId: IDs.admin, inputState: 'Exists', input: adminInput, outputState: 'ObjectWrite', output: adminOutput, idOperation: 'None' },
        { objectId: listingId, inputState: 'DoesNotExist', input: null, outputState: 'ObjectWrite', output: listingOutput, idOperation: 'Created' },
      ],
      unchangedConsensusObjects: [
        { objectId: IDs.root, version: '7', digest, owner: sharedOwner, kind: 'ReadOnlyRoot' },
        { objectId: IDs.treasury, version: '7', digest, owner: sharedOwner, kind: 'ReadOnlyRoot' },
        { objectId: IDs.makerTreasury, version: '7', digest, owner: sharedOwner, kind: 'ReadOnlyRoot' },
      ],
      objects: [
        objectEvidence('ROOT', IDs.root, client.types.makerRoot, 'READBACK', 'None',
          history(IDs.root, client.types.makerRoot, rootRef, rootParsed, 'prior'),
          history(IDs.root, client.types.makerRoot, rootRef, rootParsed, 'prior')),
        objectEvidence('REGISTRY', IDs.registry, client.types.marketRegistry, 'CHANGED', 'None',
          history(IDs.registry, client.types.marketRegistry, registryInput, registryBefore, 'prior'),
          history(IDs.registry, client.types.marketRegistry, registryOutput, registryAfter, transactionDigest)),
        objectEvidence('TREASURY', IDs.treasury, client.types.marketTreasury, 'READBACK', 'None',
          history(IDs.treasury, client.types.marketTreasury, treasuryRef, treasuryParsed, 'prior'),
          history(IDs.treasury, client.types.marketTreasury, treasuryRef, treasuryParsed, 'prior')),
        objectEvidence('LISTING', listingId, client.types.makerListing, 'CREATED', 'Created', null,
          history(listingId, client.types.makerListing, listingOutput, listingParsed, transactionDigest)),
        objectEvidence('ADMIN', IDs.admin, client.types.makerAdmin, 'CHANGED', 'None',
          history(IDs.admin, client.types.makerAdmin, adminInput, adminParsed, 'prior'),
          history(IDs.admin, client.types.makerAdmin, adminOutput, adminParsed, transactionDigest)),
        objectEvidence('MAKER_TREASURY', IDs.makerTreasury, client.types.makerTreasury, 'READBACK', 'None',
          history(IDs.makerTreasury, client.types.makerTreasury, makerTreasuryRef, makerRevenue, 'prior'),
          history(IDs.makerTreasury, client.types.makerTreasury, makerTreasuryRef, makerRevenue, 'prior'),
          {
            before: { balance: '0', totalCollected: '0', totalWithdrawn: '0', integerWidth: 128 },
            after: { balance: '0', totalCollected: '0', totalWithdrawn: '0', integerWidth: 128 },
          }),
      ],
    },
  };
  const verified = assertFinalizedMarketReadbackV8(coreV2, {
    digest: transactionDigest,
    identity,
    plan,
    planHash: finalizedPlanHash,
    outcome: { epoch: '7', effectsFingerprint, eventsDigest: digest },
  }, client, marketModule);
  assert.equal(verified.verified, true);
  assert.equal(verified.epoch, '7');
  assert.equal(Object.hasOwn(verified, 'checkpoint'), false);
  assert.equal(verified.evidence.source, 'FINALIZED_CORE_V2');
  const finalizedRequest = {
    digest: transactionDigest,
    identity,
    plan,
    planHash: finalizedPlanHash,
    outcome: { epoch: '7', effectsFingerprint, eventsDigest: digest },
  };
  const tamperMatrix = [
    ['source', (value) => { value.source = 'FINALIZED_RPC'; }],
    ['plan hash', (value) => { value.planHash = `0x${'ff'.repeat(32)}`; }],
    ['epoch', (value) => { value.epoch = '8'; }],
    ['effects fingerprint', (value) => { value.effectsFingerprint = `0x${'ee'.repeat(32)}`; }],
    ['events digest', (value) => { value.eventsDigest = '22222222222222222222222222222222'; }],
    ['sender', (value) => { value.transaction.sender = id(999); }],
    ['target', (value) => { value.transaction.target = `${id(999)}::market_v8::list_maker_control_v8`; }],
    ['transaction BCS', (value) => { value.effects.transactionBcs = toBase64(new Uint8Array([1, 2])); }],
    ['effects BCS', (value) => { value.effects.bcs = toBase64(new Uint8Array([4, 5])); }],
    ['event BCS', (value) => { value.events[0].bcs = ''; value.event.bcs = ''; }],
    ['events BCS', (value) => { value.effects.eventsBcs = ''; }],
    ['terminal event', (value) => { value.events[0].parsedJson.asset_id = id(999); value.event.parsedJson.asset_id = id(999); }],
    ['changed ref', (value) => { value.effects.changedObjects[0].output = { ...value.effects.changedObjects[0].output, version: '9' }; }],
    ['historical owner', (value) => { value.effects.objects[4].after.owner = addressOwner(id(999)); }],
    ['registry delta', (value) => { value.effects.objects[1].after.parsed.listing_count = '9'; }],
    ['treasury escrow', (value) => { value.effects.objects[2].after.parsed.escrow.value = '1'; }],
    ['listing status', (value) => { value.effects.objects[3].after.parsed.status = '1'; }],
    ['Root owner', (value) => { value.effects.objects[0].after.parsed.owner = id(999); }],
    ['Admin holder', (value) => { value.effects.objects[4].after.parsed.owner = id(999); }],
    ['role omission', (value) => { value.effects.objects.pop(); }],
    ['legacy postState injection', (value) => { value.postState = {}; }],
  ];
  for (const [label, mutate] of tamperMatrix) {
    const changedEnvelope = structuredClone(coreV2);
    mutate(changedEnvelope);
    assert.throws(
      () => assertFinalizedMarketReadbackV8(changedEnvelope, finalizedRequest, client, marketModule),
      (failure) => failure?.code?.startsWith('WEB_V8_FINALIZED_'),
      label,
    );
  }
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

function finalizedFixture(action, client, runtime, index) {
  const IDs = {
    root: id(300), registry: id(301), treasury: id(302), listing: id(400 + index),
    seller: id(303), buyer: id(304), creator: id(305), admin: id(306), newAdmin: id(500 + index),
    output: id(307), receipt: id(308), soul: id(309), physical: id(310),
    protocolTreasury: id(311), makerTreasury: id(312), packTreasury: id(313),
  };
  const lane = action.lane === 'MAKER' ? marketModule.MARKET_V8_LANES.MAKER
    : action.lane === 'SOUL' ? marketModule.MARKET_V8_LANES.SOUL
      : action.lane === 'PHYSICAL_PACK' ? marketModule.MARKET_V8_LANES.PHYSICAL_PACK
        : marketModule.MARKET_V8_LANES.PHYSICAL_BASE;
  const kind = action.kind;
  const sender = kind === 'PURCHASE' || kind === 'RECOVER' ? IDs.buyer : IDs.seller;
  const assetIds = action.lane === 'MAKER' ? [IDs.admin]
    : action.lane === 'SOUL' ? [IDs.output, IDs.receipt, IDs.soul] : [IDs.physical];
  const quote = action.lane === 'MAKER'
    ? {
        grossAtomic: '1000', protocolAtomic: '100', creatorAtomic: '100',
        sourceAtomic: '0', sellerAtomic: '800', commitment: `0x${'a1'.repeat(32)}`,
      }
    : {
        grossAtomic: '1000', protocolAtomic: '100', creatorAtomic: '100',
        sourceAtomic: '100', sellerAtomic: '700', commitment: `0x${'a2'.repeat(32)}`,
      };
  const registry = {
    revision: '10', listingCount: '5', escrowCount: '2', completedSaleCount: '3',
    canceledSaleCount: '4', recoveredSaleCount: '6', grossVolumeAtomic: '7000',
    protocolPaidAtomic: '700', creatorPaidAtomic: '700', sourcePaidAtomic: '600',
    sellerPaidAtomic: '5000',
  };
  const treasury = { escrowAtomic: '0', grossEscrowedAtomic: '9000', grossReleasedAtomic: '9000' };
  const listingBefore = kind === 'LIST' ? null : {
    objectId: IDs.listing,
    kind: action.lane === 'MAKER' ? 'MakerListingV8' : action.lane === 'SOUL' ? 'SoulListingV8' : 'PhysicalListingV8',
    status: '0', revision: '7', terminalRecipient: id(0), seller: IDs.seller,
    ownershipEpoch: '5', assetIds,
  };
  const revenueObjects = {
    protocolTreasury: kind === 'PURCHASE' ? { objectId: IDs.protocolTreasury, balanceAtomic: '1000' } : null,
    makerTreasury: kind === 'PURCHASE' && ['SOUL', 'PHYSICAL_BASE'].includes(action.lane)
      ? { objectId: IDs.makerTreasury, balanceAtomic: '2000' } : null,
    packTreasury: kind === 'PURCHASE' && action.lane === 'PHYSICAL_PACK'
      ? { objectId: IDs.packTreasury, balanceAtomic: '3000' } : null,
  };
  const typedArgument = (name, type) => ({ name, type });
  const argumentsForLane = action.lane === 'MAKER'
    ? [typedArgument(kind === 'LIST' ? 'admin' : 'adminReceiving', client.types.makerAdmin)]
    : action.lane === 'SOUL'
      ? [
          typedArgument(kind === 'LIST' ? 'outputAsset' : 'outputReceiving', client.types.completeOutput),
          typedArgument(kind === 'LIST' ? 'receipt' : 'receiptReceiving', client.types.completeReceipt),
          typedArgument(kind === 'LIST' ? 'soul' : 'soulReceiving', client.types.canonicalSoul),
        ]
      : [typedArgument(kind === 'LIST' ? 'asset' : 'receiving', client.types.physicalAsset)];
  const descriptor = {
    action: action.id,
    lane,
    sender,
    rootId: IDs.root,
    registryId: IDs.registry,
    treasuryId: IDs.treasury,
    target: `${runtime.roles.market.callablePackageId}::market_v8::${marketModule.MARKET_V8_ACTION_ABI[action.id].function}`,
    typeArguments: [runtime.paymentCoinType],
    arguments: argumentsForLane,
    preState: {
      schema: 'animacraft.market-action-prestate.v8',
      action: action.id,
      lane,
      sender,
      seller: IDs.seller,
      ownershipEpoch: '5',
      assetIds,
      registry,
      treasury,
      listing: listingBefore,
      root: {
        objectId: IDs.root, owner: IDs.seller, creator: IDs.creator,
        adminCapId: IDs.admin, controlEpoch: '5', lifecycleCode: '1',
      },
      quote,
      revenueObjects,
    },
  };
  const identity = {
    action: action.id.toUpperCase(),
    wallet: sender,
    root: { id: IDs.root },
    listing: { id: kind === 'LIST' ? assetIds.at(-1) : IDs.listing },
    registry: { id: IDs.registry },
    treasury: { id: IDs.treasury },
  };
  const eventName = kind === 'LIST' ? 'MarketListingOpenedV8'
    : kind === 'PURCHASE' ? 'MarketListingSettledV8' : 'MarketListingClosedV8';
  const eventFields = kind === 'LIST' ? {
    listing_id: IDs.listing,
    registry_id: IDs.registry,
    lane: String(lane),
    root_id: IDs.root,
    asset_id: assetIds.at(-1),
    seller: IDs.seller,
    ownership_epoch: '5',
    gross_atomic: quote.grossAtomic,
    quote_commitment: quote.commitment,
  } : kind === 'PURCHASE' ? {
    listing_id: IDs.listing,
    registry_id: IDs.registry,
    lane: String(lane),
    asset_id: assetIds.at(-1),
    seller: IDs.seller,
    buyer: IDs.buyer,
    gross_atomic: quote.grossAtomic,
    protocol_atomic: quote.protocolAtomic,
    creator_atomic: quote.creatorAtomic,
    source_atomic: quote.sourceAtomic,
    seller_atomic: quote.sellerAtomic,
  } : {
    listing_id: IDs.listing,
    registry_id: IDs.registry,
    lane: String(lane),
    asset_id: assetIds.at(-1),
    seller: IDs.seller,
    recovered: kind === 'RECOVER',
  };
  const registryAfter = { ...registry, revision: '11' };
  if (kind === 'LIST') {
    registryAfter.listingCount = '6';
    registryAfter.escrowCount = '3';
  } else if (kind === 'PURCHASE') {
    registryAfter.escrowCount = '1';
    registryAfter.completedSaleCount = '4';
    registryAfter.grossVolumeAtomic = '8000';
    registryAfter.protocolPaidAtomic = '800';
    registryAfter.creatorPaidAtomic = '800';
    registryAfter.sourcePaidAtomic = String(600 + Number(quote.sourceAtomic));
    registryAfter.sellerPaidAtomic = String(5000 + Number(quote.sellerAtomic));
  } else {
    registryAfter.escrowCount = '1';
    if (kind === 'CANCEL') registryAfter.canceledSaleCount = '5';
    else registryAfter.recoveredSaleCount = '7';
  }
  const treasuryAfter = { ...treasury };
  if (kind === 'PURCHASE') {
    treasuryAfter.grossEscrowedAtomic = '10000';
    treasuryAfter.grossReleasedAtomic = '10000';
  }
  const listing = {
    objectId: IDs.listing,
    type: action.lane === 'MAKER' ? client.types.makerListing
      : action.lane === 'SOUL' ? client.types.soulListing : client.types.physicalListing,
    change: kind === 'LIST' ? 'CREATED' : 'MUTATED',
    status: String(kind === 'LIST' ? 0 : kind === 'PURCHASE' ? 1 : kind === 'CANCEL' ? 2 : 3),
    revision: kind === 'LIST' ? '0' : '8',
    terminalRecipient: kind === 'LIST' ? id(0) : kind === 'PURCHASE' ? IDs.buyer : IDs.seller,
    seller: IDs.seller,
    ownershipEpoch: '5',
    assetIds,
    grossAtomic: quote.grossAtomic,
    quoteCommitment: quote.commitment,
  };
  const root = {
    objectId: IDs.root,
    owner: action.id === 'purchaseMakerControl' ? IDs.buyer : IDs.seller,
    adminCapId: action.id === 'purchaseMakerControl' ? IDs.newAdmin : IDs.admin,
    controlEpoch: action.id === 'purchaseMakerControl' ? '6' : '5',
    change: ['purchaseMakerControl', 'cancelMakerControl', 'recoverMakerControl'].includes(action.id) ? 'MUTATED' : 'READBACK',
  };
  const targetOwner = kind === 'LIST' ? IDs.listing : kind === 'PURCHASE' ? IDs.buyer : IDs.seller;
  let assets;
  if (action.lane === 'MAKER' && kind === 'PURCHASE') {
    assets = [{
      role: 'ADMIN_PREVIOUS', objectId: IDs.admin, type: client.types.makerAdmin,
      change: 'DELETED', owner: null, holder: null, ownershipEpoch: null,
    }, {
      role: 'ADMIN', objectId: IDs.newAdmin, type: client.types.makerAdmin,
      change: 'CREATED', owner: IDs.buyer, holder: IDs.buyer, ownershipEpoch: '6',
    }];
  } else if (action.lane === 'MAKER') {
    assets = [{
      role: 'ADMIN', objectId: IDs.admin, type: client.types.makerAdmin,
      change: 'MUTATED', owner: targetOwner, holder: IDs.seller, ownershipEpoch: '5',
    }];
  } else if (action.lane === 'SOUL') {
    assets = [
      ['OUTPUT', IDs.output, client.types.completeOutput, null],
      ['RECEIPT', IDs.receipt, client.types.completeReceipt, null],
      ['SOUL', IDs.soul, client.types.canonicalSoul, kind === 'PURCHASE' ? '6' : '5'],
    ].map(([role, objectId, type, ownershipEpoch]) => ({
      role, objectId, type, change: 'MUTATED', owner: targetOwner,
      holder: kind === 'LIST' ? IDs.seller : targetOwner, ownershipEpoch,
    }));
  } else {
    assets = [{
      role: 'ASSET', objectId: IDs.physical, type: client.types.physicalAsset,
      change: 'MUTATED', owner: targetOwner, holder: kind === 'LIST' ? IDs.seller : targetOwner,
      ownershipEpoch: kind === 'PURCHASE' ? '6' : '5',
    }];
  }
  const balances = [];
  const coinOutputs = [];
  if (kind === 'PURCHASE') {
    balances.push({
      role: 'PROTOCOL', objectId: IDs.protocolTreasury, beforeAtomic: '1000',
      afterAtomic: '1100', deltaAtomic: '100',
    });
    if (revenueObjects.makerTreasury) balances.push({
      role: 'SOURCE_MAKER', objectId: IDs.makerTreasury, beforeAtomic: '2000',
      afterAtomic: '2100', deltaAtomic: '100',
    });
    if (revenueObjects.packTreasury) balances.push({
      role: 'SOURCE_PACK', objectId: IDs.packTreasury, beforeAtomic: '3000',
      afterAtomic: '3100', deltaAtomic: '100',
    });
    coinOutputs.push({
      role: 'CREATOR', objectId: id(600 + index * 2), owner: IDs.creator,
      type: client.types.paymentCoin, amountAtomic: quote.creatorAtomic, change: 'CREATED',
    }, {
      role: 'SELLER', objectId: id(601 + index * 2), owner: IDs.seller,
      type: client.types.paymentCoin, amountAtomic: quote.sellerAtomic, change: 'CREATED',
    });
  }
  const digestValue = `fixture-digest-${index}`;
  const value = {
    schemaVersion: WEB_V8_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    digest: digestValue,
    checkpoint: '42',
    identity,
    transaction: { sender, status: 'SUCCESS', target: descriptor.target, typeArguments: descriptor.typeArguments },
    event: {
      id: { txDigest: digestValue, eventSeq: '0' },
      type: `${runtime.roles.market.typeOriginPackageId}::market_v8::${eventName}`,
      parsedJson: eventFields,
    },
    postState: {
      registry: registryAfter,
      treasury: treasuryAfter,
      listing,
      root,
      assets,
      revenue: { balances, coinOutputs },
    },
  };
  const request = {
    digest: digestValue,
    outcome: { checkpoint: '42' },
    identity,
    planHash: `0x${(128 + index).toString(16).padStart(2, '0').repeat(32)}`,
    plan: {
      fingerprint: `0x${(128 + index).toString(16).padStart(2, '0').repeat(32)}`,
      sourceSnapshot: { descriptor },
    },
  };
  return { value, request };
}

test('legacy FINALIZED_RPC/postState readback is rejected for all fourteen typed actions', {
  skip: marketModule ? false : 'Market module is integrated in the parent worktree.',
}, () => {
  const runtime = marketRuntimeFromMakerRuntime(makerRuntime(), 'mainnet');
  const client = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  for (const [index, action] of MARKET_V8_ACTIONS.entries()) {
    const fixture = finalizedFixture(action, client, runtime, index);
    assert.throws(
      () => assertFinalizedMarketReadbackV8(fixture.value, fixture.request, client, marketModule),
      { code: 'WEB_V8_FINALIZED_FIELDS_INVALID' },
      `${action.id} legacy schema`,
    );
  }
});

test('finalized verification rejects sender, event, counters, custody, Root, treasury, and revenue drift', {
  skip: marketModule ? false : 'Market module is integrated in the parent worktree.',
}, () => {
  const runtime = marketRuntimeFromMakerRuntime(makerRuntime(), 'mainnet');
  const client = marketModule.createMarketV8Client(runtime, { network: 'mainnet' });
  const purchase = finalizedFixture(MARKET_V8_ACTIONS.find((action) => action.id === 'purchaseSoulBundle'), client, runtime, 20);
  const mutations = [
    (value) => { value.transaction.sender = id(999); },
    (value) => { value.event.parsedJson.asset_id = id(999); },
    (value) => { value.event.parsedJson.lane = '3'; },
    (value) => { value.event.parsedJson.seller_atomic = '701'; },
    (value) => { value.postState.registry.completedSaleCount = '99'; },
    (value) => { value.postState.treasury.grossReleasedAtomic = '9999'; },
    (value) => { value.postState.listing.terminalRecipient = id(999); },
    (value) => { value.postState.root.owner = id(999); },
    (value) => { value.postState.assets[2].ownershipEpoch = '5'; },
    (value) => { value.postState.revenue.balances[0].deltaAtomic = '99'; },
    (value) => { value.postState.revenue.coinOutputs[0].owner = id(999); },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(purchase.value);
    mutate(value);
    assert.throws(
      () => assertFinalizedMarketReadbackV8(value, purchase.request, client, marketModule),
      (error) => typeof error.code === 'string'
        && (error.code.startsWith('WEB_V8_') || error.code.startsWith('MARKET_V8_')),
    );
  }
});
