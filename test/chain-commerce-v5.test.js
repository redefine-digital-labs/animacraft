import assert from 'node:assert/strict';
import { fromBase64 } from '@mysten/bcs';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import test from 'node:test';
import {
  COMMERCE_V5_ACCESS,
  COMMERCE_V5_COMPLETE_POLICY,
  COMMERCE_V5_LIFECYCLE,
  COMMERCE_V5_RIGHTS,
  COMMERCE_V5_STYLE_ROW,
  appendCompleteAuthorizationV5,
  buildActivateMakerV5,
  buildArchiveMakerV5,
  buildBuyMakerV5,
  buildCancelMakerListingV5,
  buildClaimFreePackV5,
  buildConfigureDisabledCommerceProtocolV5,
  buildBindCommerceProtocolDependenciesV5,
  buildConfigureMakerV5,
  buildInitializeCommerceProtocolV5,
  buildListMakerForSaleV5,
  buildMigrateLegacyMakerV5,
  buildPauseMakerV5,
  buildPurchaseMakerAccessV5,
  buildPurchasePackV5,
  buildQuoteCompleteV5,
  buildRestoreMakerV5,
  buildWithdrawMakerRevenueV5,
  hashCompleteSelectionV5,
  normalizeStyleSelectionsV5,
  parseCommerceProtocolConfigV5,
  parseCommerceProtocolTreasuryV5,
  parseCommerceV5Event,
  parseMakerAccessPassV5,
  parseMakerControlCapV5,
  parseMakerListingV5,
  parseMakerRootV5,
  parseMakerTreasuryV5,
  parsePackPassV5,
  parseCompleteOutputRecordV5Bcs,
  parsePackRecordV5Bcs,
  parseStyleBindingV5Bcs,
  queryCommerceV5Objects,
  queryOwnedCommerceV5State,
  queryCompleteOutputRecordV5,
  queryCompleteOutputRecordsV5,
  queryPackRecordsV5,
  queryStyleBindingsV5,
  simulateCompleteQuoteV5,
  styleSelectionV5Bcs,
  walletHasMakerAccessV5,
  walletHasPackAccessV5,
} from '../chain-commerce-v5.js';

const id = (value) => normalizeSuiAddress(`0x${value}`);
const PACKAGE = id('a');
const PAYMENT = `${id('2')}::sui::SUI`;
const runtime = Object.freeze({
  callablePackageId: PACKAGE,
  commerceTypePackageId: PACKAGE,
  paymentCoinType: PAYMENT,
  commerceV5ReleaseEnabled: true,
});

const IDS = Object.freeze({
  protocol: id('11'),
  protocolTreasury: id('12'),
  protocolAdmin: id('13'),
  legacyProtocol: id('14'),
  root: id('21'),
  makerTreasury: id('22'),
  legacyMaker: id('23'),
  legacyTreasury: id('24'),
  vault: id('25'),
  controlCap: id('26'),
  packsTable: id('27'),
  stylesTable: id('28'),
  completeOutputsTable: id('2b'),
  listing: id('29'),
  sealPolicy: id('2a'),
  owner: id('31'),
  buyer: id('32'),
  creator: id('33'),
  accessPass: id('34'),
  packPass: id('35'),
  soul: id('36'),
});

const freePolicy = Object.freeze({
  mode: COMMERCE_V5_COMPLETE_POLICY.UNLIMITED_FREE,
  freeQuotaPerWallet: 0n,
  priceAtomic: 0n,
  totalCap: 0n,
});
const paidPolicy = Object.freeze({
  mode: COMMERCE_V5_COMPLETE_POLICY.PAID_EVERY_TIME,
  freeQuotaPerWallet: 0n,
  priceAtomic: 3_000_000n,
  totalCap: 100n,
});

function object(structName, objectId, fields, { generic = false } = {}) {
  return {
    objectId,
    type: `${PACKAGE}::commerce_v5::${structName}${generic ? `<${PAYMENT}>` : ''}`,
    json: { fields },
  };
}

function protocolObject(overrides = {}) {
  return object('CommerceProtocolConfigV5', IDS.protocol, {
    version: '5',
    legacy_config_id: IDS.legacyProtocol,
    legacy_admin_cap_id: IDS.protocolAdmin,
    treasury_id: IDS.protocolTreasury,
    payment_coin_type: PAYMENT,
    primary_protocol_fee_bps: 1_000,
    fixed_complete_fee_atomic: '100000',
    maker_market_fee_bps: 250,
    logical_auxiliary_blob_id: { vec: ['canonical-logical-blob'] },
    soul_binding_proof_type: {
      vec: [`${id('b')}::animacraft_binding::AnimacraftSoulBindingProofV5`],
    },
    enabled: true,
    ...overrides,
  });
}

function protocolTreasuryObject(overrides = {}) {
  return object('CommerceProtocolTreasuryV5', IDS.protocolTreasury, {
    version: '5',
    config_id: IDS.protocol,
    revenue: { fields: { value: '9007199254740993' } },
    total_primary_collected: '100',
    total_fixed_collected: '200',
    total_market_collected: '300',
    total_withdrawn: '400',
    ...overrides,
  }, { generic: true });
}

function rootObject(overrides = {}) {
  const releaseFieldNames = new Set([
    'pack_count',
    'paid_pack_count',
    'style_count',
    'style_registry_sealed',
    'protected_style_count',
    'seal_policy_id',
    'seal_release_commitment',
    'complete_output_count',
    'total_completes',
  ]);
  const rootOverrides = {};
  const releaseOverrides = {};
  for (const [key, value] of Object.entries(overrides)) {
    (releaseFieldNames.has(key) ? releaseOverrides : rootOverrides)[key] = value;
  }
  return object('MakerRootV5', IDS.root, {
    version: '5',
    legacy_maker_id: IDS.legacyMaker,
    legacy_treasury_id: IDS.legacyTreasury,
    control_vault_id: IDS.vault,
    treasury_id: IDS.makerTreasury,
    protocol_config_id: IDS.protocol,
    payment_coin_type: PAYMENT,
    logical_auxiliary_blob_id: 'canonical-logical-blob',
    original_creator: IDS.creator,
    current_owner: IDS.owner,
    rights_origin: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
    lifecycle: COMMERCE_V5_LIFECYCLE.ACTIVE,
    ownership_epoch: '7',
    current_control_cap_id: { vec: [IDS.controlCap] },
    active_listing_id: { vec: [] },
    soul_creator_royalty_bps: 250,
    maker_resale_royalty_bps: 500,
    base_access_kind: COMMERCE_V5_ACCESS.PAID_ONCE,
    base_purchase_price_atomic: '10000000',
    base_policy: {
      fields: {
        mode: freePolicy.mode,
        free_quota_per_wallet: '0',
        price_atomic: '0',
        total_cap: '0',
      },
    },
    packs: { fields: { id: { id: { bytes: IDS.packsTable } }, size: '1' } },
    pack_keys: ['pack-1'],
    style_registry: { fields: { id: { id: { bytes: IDS.stylesTable } }, size: '2' } },
    complete_outputs: {
      fields: {
        id: { id: { bytes: IDS.completeOutputsTable } },
        size: '3',
      },
    },
    release: {
      fields: {
        pack_count: '1',
        paid_pack_count: '1',
        style_count: '2',
        style_registry_sealed: true,
        protected_style_count: '2',
        seal_policy_id: { vec: [IDS.sealPolicy] },
        seal_release_commitment: Array(32).fill(5),
        complete_output_count: '3',
        total_completes: '3',
        ...releaseOverrides,
      },
    },
    ...rootOverrides,
  });
}

function makerTreasuryObject(overrides = {}) {
  return object('MakerTreasuryV5', IDS.makerTreasury, {
    version: '5',
    root_id: IDS.root,
    revenue: { fields: { value: '7000000' } },
    total_pack_collected: '1000000',
    total_complete_collected: '6000000',
    total_withdrawn: '0',
    ...overrides,
  }, { generic: true });
}

function controlCapObject(overrides = {}) {
  return object('MakerControlCapV5', IDS.controlCap, {
    version: '5',
    root_id: IDS.root,
    ownership_epoch: '7',
    ...overrides,
  });
}

function listingObject(overrides = {}) {
  return object('MakerListingV5', IDS.listing, {
    version: '5',
    root_id: IDS.root,
    seller: IDS.owner,
    price_atomic: '25000000',
    ownership_epoch: '7',
    protocol_fee_bps: 250,
    maker_resale_royalty_bps: 500,
    active: true,
    ...overrides,
  });
}

function accessPassObject(overrides = {}) {
  return object('MakerAccessPassV5', IDS.accessPass, {
    version: '5',
    root_id: IDS.root,
    holder: IDS.owner,
    issued_at_ms: '1234',
    ownership_epoch: '7',
    ...overrides,
  });
}

function packPassObject(overrides = {}) {
  return object('PackPassV5', IDS.packPass, {
    version: '5',
    root_id: IDS.root,
    pack_key: 'pack-1',
    holder: IDS.owner,
    issued_at_ms: '1234',
    ownership_epoch: '7',
    ...overrides,
  });
}

function states({
  rootOverrides,
  protocolOverrides,
  treasuryOverrides,
  listingOverrides,
} = {}) {
  return {
    protocol: parseCommerceProtocolConfigV5(protocolObject(protocolOverrides)),
    protocolTreasury: parseCommerceProtocolTreasuryV5(protocolTreasuryObject()),
    root: parseMakerRootV5(rootObject(rootOverrides)),
    makerTreasury: parseMakerTreasuryV5(makerTreasuryObject(treasuryOverrides)),
    controlCap: parseMakerControlCapV5(controlCapObject()),
    listing: parseMakerListingV5(listingObject(listingOverrides)),
  };
}

function functions(transaction) {
  return transaction.getData().commands.map((command) => command.MoveCall?.function).filter(Boolean);
}

function moveCall(transaction, index = 0) {
  return transaction.getData().commands[index].MoveCall;
}

function pureBytesForArgument(transaction, commandIndex, argumentIndex) {
  const data = transaction.getData();
  const argument = data.commands[commandIndex].MoveCall.arguments[argumentIndex];
  return fromBase64(data.inputs[argument.Input].Pure.bytes);
}

const recipe = Object.freeze([
  { partKey: 'body', itemKey: 'base', colorHex: '#ffffff', renderOrder: 0 },
  { partKey: 'hair', itemKey: 'long', colorHex: '#000000', renderOrder: 1 },
]);
const styleSelections = Object.freeze([
  { partKey: 'body', itemKey: 'base', styleKey: 'default' },
  { partKey: 'hair', itemKey: 'long', styleKey: 'blue' },
]);
const outputSealId = new Uint8Array(32).fill(0x11);
const outputNonce = new Uint8Array(32).fill(0x22);
const outputDigest = new Uint8Array(32).fill(0x33);

test('v5 object parsers preserve every u64 as BigInt and reject an unexpected layout', () => {
  const parsed = states();
  assert.equal(parsed.protocol.fixedCompleteFeeAtomic, 100_000n);
  assert.equal(parsed.protocolTreasury.balanceAtomic, 9_007_199_254_740_993n);
  assert.equal(parsed.root.baseAccess.purchasePriceAtomic, 10_000_000n);
  assert.equal(parsed.root.basePolicy.totalCap, 0n);
  assert.equal(parsed.root.ownershipEpoch, 7n);
  assert.equal(parsed.root.soulCreatorRoyaltyBps, 250);
  assert.equal(parsed.root.paidPackCount, 1n);
  assert.equal(parsed.root.protectedStyleCount, 2n);
  assert.equal(parsed.root.sealPolicyId, IDS.sealPolicy);
  assert.equal(parsed.root.sealReleaseCommitment, `0x${'05'.repeat(32)}`);
  assert.equal(
    parsed.root.completeOutputsTableId,
    IDS.completeOutputsTable,
  );
  assert.equal(parsed.root.completeOutputCount, 3n);
  assert.equal(parsed.makerTreasury.balanceAtomic, 7_000_000n);
  assert.equal(parsed.controlCap.ownershipEpoch, 7n);
  assert.equal(parsed.listing.priceAtomic, 25_000_000n);
  assert.throws(
    () => parseMakerRootV5({ ...rootObject(), type: `${PACKAGE}::animacraft::OCMaker` }),
    { code: 'COMMERCE_V5_OBJECT_TYPE_MISMATCH' },
  );
  assert.throws(
    () => parseCommerceProtocolConfigV5(protocolObject({ version: '4' })),
    { code: 'COMMERCE_V5_VERSION_MISMATCH' },
  );
});

test('MakerRootV5 parser preserves the public shape across flat diagnostics and Mainnet-safe nesting', () => {
  const nestedObject = rootObject();
  const flatObject = structuredClone(nestedObject);
  Object.assign(flatObject.json.fields, flatObject.json.fields.release.fields);
  delete flatObject.json.fields.release;

  const nested = parseMakerRootV5(nestedObject);
  const flat = parseMakerRootV5(flatObject);
  assert.deepEqual(flat, nested);
  assert.equal(nested.packCount, 1n);
  assert.equal(nested.styleCount, 2n);
  assert.equal(nested.totalCompletes, 3n);
});

test('access and Pack passes are parsed as wallet-bound v5 receipts', () => {
  const access = parseMakerAccessPassV5(accessPassObject());
  const pack = parsePackPassV5(packPassObject());
  assert.equal(access.rootId, IDS.root);
  assert.equal(access.holder, IDS.owner);
  assert.equal(pack.packKey, 'pack-1');
  assert.equal(pack.ownershipEpoch, 7n);
});

test('protocol initialization always starts through the disabled Move initializer', () => {
  const transaction = buildInitializeCommerceProtocolV5({
    runtime,
    legacyProtocolConfigId: IDS.legacyProtocol,
    legacyProtocolAdminCapId: IDS.protocolAdmin,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(transaction), ['initialize_commerce_protocol_v5']);
  assert.equal(moveCall(transaction).module, 'commerce_v5');
  assert.deepEqual(moveCall(transaction).typeArguments, [PAYMENT]);
});

test('protocol configuration first disables the gate and rejects a mismatched AdminCap', () => {
  const { protocol } = states();
  const transaction = buildConfigureDisabledCommerceProtocolV5({
    runtime,
    protocol,
    legacyProtocolAdminCapId: IDS.protocolAdmin,
    fixedCompleteFeeAtomic: 150_000n,
    makerMarketFeeBps: 250,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(transaction), [
    'update_protocol_enabled_v5',
    'update_fixed_complete_fee_v5',
    'update_maker_market_fee_bps_v5',
  ]);
  const disabledBytes = pureBytesForArgument(transaction, 0, 2);
  assert.equal(bcs.bool().parse(disabledBytes), false);
  assert.throws(
    () => buildConfigureDisabledCommerceProtocolV5({
      runtime,
      protocol,
      legacyProtocolAdminCapId: id('99'),
      fixedCompleteFeeAtomic: 0,
      makerMarketFeeBps: 250,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_PROTOCOL_ADMIN_MISMATCH' },
  );
});

test('protocol dependencies bind once before Commerce v5 can be enabled', () => {
  const protocol = parseCommerceProtocolConfigV5(protocolObject({
    enabled: false,
    logical_auxiliary_blob_id: { vec: [] },
    soul_binding_proof_type: { vec: [] },
  }));
  const proofType =
    `${id('b')}::animacraft_binding::AnimacraftSoulBindingProofV5`;
  const transaction = buildBindCommerceProtocolDependenciesV5({
    runtime,
    protocol,
    legacyProtocolAdminCapId: IDS.protocolAdmin,
    logicalAuxiliaryBlobId: 'canonical-logical-blob',
    soulBindingProofType: proofType,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(transaction), [
    'bind_logical_auxiliary_blob_v5',
    'bind_soul_binding_proof_type_v5',
  ]);
  assert.deepEqual(moveCall(transaction, 1).typeArguments, [proofType]);
  assert.throws(
    () => buildBindCommerceProtocolDependenciesV5({
      runtime,
      protocol: parseCommerceProtocolConfigV5(protocolObject({
        enabled: false,
      })),
      legacyProtocolAdminCapId: IDS.protocolAdmin,
      logicalAuxiliaryBlobId: 'replacement',
      soulBindingProofType: proofType,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_PROTOCOL_DEPENDENCY_ALREADY_BOUND' },
  );
});

test('the production release gate blocks player commerce but not protocol administration', () => {
  const disabledRuntime = {
    ...runtime,
    commerceV5ReleaseEnabled: false,
  };
  const root = parseMakerRootV5(rootObject());
  const protocol = parseCommerceProtocolConfigV5(protocolObject());

  assert.throws(
    () => buildPurchaseMakerAccessV5({
      runtime: disabledRuntime,
      root,
      makerTreasury: parseMakerTreasuryV5(makerTreasuryObject()),
      protocol,
      protocolTreasury: parseCommerceProtocolTreasuryV5(protocolTreasuryObject()),
      walletState: {
        makerAccessPasses: [],
        packPasses: [],
      },
      sender: IDS.buyer,
    }),
    (error) => error?.code === 'COMMERCE_V5_RELEASE_DISABLED',
  );

  assert.doesNotThrow(() => buildInitializeCommerceProtocolV5({
    runtime: disabledRuntime,
    legacyProtocolConfigId: IDS.legacyProtocol,
    legacyProtocolAdminCapId: IDS.protocolAdmin,
    sender: IDS.owner,
  }));
});

test('v4 to v5 migration is paused, cap-bound, u64-safe, and requires an empty legacy treasury', () => {
  const { protocol } = states();
  const transaction = buildMigrateLegacyMakerV5({
    runtime,
    protocol,
    legacyMakerId: IDS.legacyMaker,
    legacyMakerTreasuryId: IDS.legacyTreasury,
    legacyMakerTreasuryBalanceAtomic: 0n,
    legacyMakerAdminCapId: id('40'),
    rightsOrigin: COMMERCE_V5_RIGHTS.LICENSE_WRAPPED,
    baseCompletePolicy: paidPolicy,
    soulCreatorRoyaltyBps: 250,
    makerResaleRoyaltyBps: 500,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(transaction), ['new_completion_policy_with_cap', 'migrate_legacy_maker_v5']);
  assert.equal(moveCall(transaction, 1).typeArguments[0], PAYMENT);
  assert.throws(
    () => buildMigrateLegacyMakerV5({
      runtime,
      protocol,
      legacyMakerId: IDS.legacyMaker,
      legacyMakerTreasuryId: IDS.legacyTreasury,
      legacyMakerTreasuryBalanceAtomic: 1n,
      legacyMakerAdminCapId: id('40'),
      rightsOrigin: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
      baseCompletePolicy: freePolicy,
      soulCreatorRoyaltyBps: 250,
      makerResaleRoyaltyBps: 0,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_LEGACY_TREASURY_NOT_EMPTY' },
  );
  assert.throws(
    () => buildMigrateLegacyMakerV5({
      runtime,
      protocol,
      legacyMakerId: IDS.legacyMaker,
      legacyMakerTreasuryId: IDS.legacyTreasury,
      legacyMakerTreasuryBalanceAtomic: 0n,
      legacyMakerAdminCapId: id('40'),
      rightsOrigin: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
      baseCompletePolicy: freePolicy,
      soulCreatorRoyaltyBps: 250,
      makerResaleRoyaltyBps: 501,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_INVALID_U16' },
  );
  assert.throws(
    () => buildMigrateLegacyMakerV5({
      runtime,
      protocol,
      legacyMakerId: IDS.legacyMaker,
      legacyMakerTreasuryId: IDS.legacyTreasury,
      legacyMakerTreasuryBalanceAtomic: 0n,
      legacyMakerAdminCapId: id('40'),
      rightsOrigin: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
      baseCompletePolicy: freePolicy,
      soulCreatorRoyaltyBps: 250,
      makerResaleRoyaltyBps: 425,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_INVALID_ROYALTY' },
  );
  assert.throws(
    () => parseMakerRootV5(rootObject({ maker_resale_royalty_bps: 425 })),
    { code: 'COMMERCE_V5_INVALID_ROYALTY' },
  );
});

test('Maker configuration registers exact Base/Pack Styles, seals, then activates', () => {
  const { root, controlCap } = states({
    rootOverrides: {
      lifecycle: COMMERCE_V5_LIFECYCLE.PAUSED,
      style_registry_sealed: false,
      style_count: '0',
    },
  });
  const transaction = buildConfigureMakerV5({
    runtime,
    root,
    controlCap,
    sender: IDS.owner,
    baseAccess: { kind: COMMERCE_V5_ACCESS.FREE, purchasePriceAtomic: 0n },
    baseCompletePolicy: freePolicy,
    makerResaleRoyaltyBps: 500,
    packs: [{
      key: 'pack-1',
      label: 'Premium Hair',
      access: { kind: COMMERCE_V5_ACCESS.PAID_ONCE, purchasePriceAtomic: 6_000_000n },
      completePolicy: freePolicy,
      active: true,
    }, {
      key: 'pack-2',
      label: 'Premium Outfit',
      access: { kind: COMMERCE_V5_ACCESS.FREE, purchasePriceAtomic: 0n },
      completePolicy: paidPolicy,
      active: true,
    }],
    styleBindings: [{
      partKey: 'body',
      itemKey: 'base',
      styleKey: 'default',
      rowKind: COMMERCE_V5_STYLE_ROW.VISUAL,
    }, {
      partKey: 'hair',
      itemKey: 'long',
      styleKey: 'blue',
      packKey: 'pack-1',
      rowKind: COMMERCE_V5_STYLE_ROW.VISUAL,
    }, {
      partKey: '__color__:hair',
      itemKey: 'hair-blue',
      styleKey: '__animacraft_color__:hair-blue',
      rowKind: COMMERCE_V5_STYLE_ROW.LOGICAL_COLOR,
    }],
    sealStyleRegistry: true,
    activate: true,
  });
  assert.deepEqual(functions(transaction), [
    'update_base_access_v5',
    'new_completion_policy_with_cap',
    'update_base_policy_v5',
    'update_maker_resale_royalty_v5',
    'new_completion_policy_with_cap',
    'update_pack_v5',
    'new_completion_policy_with_cap',
    'add_pack_v5',
    'register_base_style_v5',
    'register_pack_style_v5',
    'register_base_logical_style_v5',
    'seal_style_registry_v5',
    'activate_maker_v5',
  ]);
  assert.throws(
    () => buildConfigureMakerV5({
      runtime,
      root: { ...root, styleRegistrySealed: true },
      controlCap,
      sender: IDS.owner,
      baseAccess: { kind: COMMERCE_V5_ACCESS.FREE, purchasePriceAtomic: 0 },
      baseCompletePolicy: freePolicy,
      makerResaleRoyaltyBps: 0,
      styleBindings: [{ partKey: 'body', itemKey: 'base', styleKey: 'late' }],
    }),
    { code: 'COMMERCE_V5_STYLE_REGISTRY_SEALED' },
  );
});

test('a sealed release freezes the original-creator Maker resale royalty', () => {
  const { root, controlCap } = states({
    rootOverrides: {
      lifecycle: COMMERCE_V5_LIFECYCLE.PAUSED,
      style_registry_sealed: true,
      style_count: '2',
      maker_resale_royalty_bps: 500,
    },
  });
  const unchanged = buildConfigureMakerV5({
    runtime,
    root,
    controlCap,
    sender: IDS.owner,
    baseAccess: { kind: COMMERCE_V5_ACCESS.FREE, purchasePriceAtomic: 0 },
    baseCompletePolicy: freePolicy,
    makerResaleRoyaltyBps: 500,
  });
  assert.doesNotMatch(
    functions(unchanged).join(','),
    /update_maker_resale_royalty_v5/,
  );
  assert.throws(
    () => buildConfigureMakerV5({
      runtime,
      root,
      controlCap,
      sender: IDS.owner,
      baseAccess: { kind: COMMERCE_V5_ACCESS.FREE, purchasePriceAtomic: 0 },
      baseCompletePolicy: freePolicy,
      makerResaleRoyaltyBps: 0,
    }),
    { code: 'COMMERCE_V5_MAKER_ROYALTY_IMMUTABLE' },
  );
});

test('lifecycle builders accept only the four on-chain states and a current ControlCap', () => {
  const active = states();
  assert.deepEqual(functions(buildPauseMakerV5({
    runtime,
    root: active.root,
    controlCap: active.controlCap,
    sender: IDS.owner,
  })), ['pause_maker_v5']);
  assert.deepEqual(functions(buildArchiveMakerV5({
    runtime,
    root: active.root,
    controlCap: active.controlCap,
    sender: IDS.owner,
  })), ['archive_maker_v5']);

  const paused = states({ rootOverrides: { lifecycle: COMMERCE_V5_LIFECYCLE.PAUSED } });
  assert.deepEqual(functions(buildActivateMakerV5({
    runtime,
    root: paused.root,
    controlCap: paused.controlCap,
    sender: IDS.owner,
  })), ['activate_maker_v5']);

  const archived = states({ rootOverrides: { lifecycle: COMMERCE_V5_LIFECYCLE.ARCHIVED } });
  assert.deepEqual(functions(buildRestoreMakerV5({
    runtime,
    root: archived.root,
    controlCap: archived.controlCap,
    sender: IDS.owner,
  })), ['activate_maker_v5']);

  assert.throws(
    () => buildPauseMakerV5({
      runtime,
      root: active.root,
      controlCap: { ...active.controlCap, ownershipEpoch: 6n },
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_CONTROL_CAP_MISMATCH' },
  );
});

test('whole-Maker and Pack access builders use exact one-time prices and verified entitlement state', () => {
  const state = states();
  const walletState = { ownsMakerAccess: false, ownedPackKeys: [] };
  const makerAccess = buildPurchaseMakerAccessV5({
    runtime,
    ...state,
    walletState,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(makerAccess), ['purchase_base_access_v5']);

  const ownedWallet = { ownsMakerAccess: true, ownedPackKeys: [] };
  const paidPack = {
    key: 'pack-1',
    accessKind: COMMERCE_V5_ACCESS.PAID_ONCE,
    purchasePriceAtomic: 6_000_000n,
    active: true,
  };
  const purchase = buildPurchasePackV5({
    runtime,
    ...state,
    pack: paidPack,
    walletState: ownedWallet,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(purchase), ['purchase_pack_v5']);

  const freePack = { ...paidPack, key: 'free-pack', accessKind: COMMERCE_V5_ACCESS.FREE, purchasePriceAtomic: 0n };
  const claim = buildClaimFreePackV5({
    runtime,
    ...state,
    pack: freePack,
    walletState: ownedWallet,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(claim), ['claim_free_pack_v5']);

  assert.throws(
    () => buildPurchasePackV5({
      runtime,
      ...state,
      pack: paidPack,
      walletState: { ownsMakerAccess: true, ownedPackKeys: ['pack-1'] },
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_ENTITLEMENT_EXISTS' },
  );
  assert.throws(
    () => buildPurchaseMakerAccessV5({
      runtime,
      ...state,
      walletState: null,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_CONFIG_MISSING' },
  );
});

test('StyleSelectionV5 must align one-for-one with Recipe and changes the canonical hash', async () => {
  assert.deepEqual(normalizeStyleSelectionsV5(recipe, styleSelections).styleSelections, styleSelections);
  assert.throws(
    () => normalizeStyleSelectionsV5(recipe, styleSelections.slice(0, 1)),
    { code: 'COMMERCE_V5_STYLE_SELECTION_MISMATCH' },
  );
  assert.throws(
    () => normalizeStyleSelectionsV5(recipe, [
      styleSelections[1],
      styleSelections[0],
    ]),
    { code: 'COMMERCE_V5_STYLE_SELECTION_MISMATCH' },
  );
  const first = await hashCompleteSelectionV5(recipe, styleSelections);
  const second = await hashCompleteSelectionV5(recipe, [
    styleSelections[0],
    { ...styleSelections[1], styleKey: 'red' },
  ]);
  assert.equal(first.length, 32);
  assert.notDeepEqual(first, second);
});

test('quote transaction serializes exact StyleSelectionV5 and simulation parses u64-safe output', async () => {
  const { root, protocol } = states();
  const built = await buildQuoteCompleteV5({
    runtime,
    root,
    protocol,
    recipe,
    styleSelections,
    wallet: IDS.owner,
  });
  assert.deepEqual(functions(built.transaction), ['quote_complete_v5']);
  const styleBytes = pureBytesForArgument(built.transaction, 0, 4);
  const decoded = bcs.vector(styleSelectionV5Bcs).parse(styleBytes);
  assert.deepEqual(decoded, [
    { part_key: 'body', item_key: 'base', style_key: 'default' },
    { part_key: 'hair', item_key: 'long', style_key: 'blue' },
  ]);

  const quoteBcs = bcs.struct('CompleteQuoteV5', {
    creator_charge_atomic: bcs.u64(),
    protocol_percentage_atomic: bcs.u64(),
    fixed_protocol_fee_atomic: bcs.u64(),
    maker_receives_atomic: bcs.u64(),
    total_due_atomic: bcs.u64(),
    used_pack_count: bcs.u64(),
  }).serialize({
    creator_charge_atomic: 3_000_000n,
    protocol_percentage_atomic: 300_000n,
    fixed_protocol_fee_atomic: 100_000n,
    maker_receives_atomic: 2_700_000n,
    total_due_atomic: 3_100_000n,
    used_pack_count: 1n,
  }).toBytes();
  const quote = await simulateCompleteQuoteV5({
    async simulateTransaction({ transaction, include }) {
      assert.ok(transaction instanceof Transaction);
      assert.deepEqual(include, { commandResults: true });
      return {
        $kind: 'Transaction',
        commandResults: [{ returnValues: [{ bcs: quoteBcs }], mutatedReferences: [] }],
      };
    },
  }, {
    runtime,
    root,
    protocol,
    recipe,
    styleSelections,
    wallet: IDS.owner,
  });
  assert.equal(quote.totalDueAtomic, 3_100_000n);
  assert.equal(quote.usedPackCount, 1n);
  assert.equal(quote.recipeHash.length, 32);
});

test('Complete authorization uses a verified exact-selection quote and returns a Soulidity-consumable result', async () => {
  const state = states();
  const recipeHash = await hashCompleteSelectionV5(recipe, styleSelections);
  const freeProtocol = Object.freeze({
    ...state.protocol,
    fixedCompleteFeeAtomic: 0n,
  });
  const freeQuote = Object.freeze({
    rootId: IDS.root,
    rootOwnershipEpoch: state.root.ownershipEpoch,
    protocolConfigId: IDS.protocol,
    protocolFixedCompleteFeeAtomic: 0n,
    wallet: IDS.owner,
    recipeHash,
    creatorChargeAtomic: 0n,
    protocolPercentageAtomic: 0n,
    fixedProtocolFeeAtomic: 0n,
    makerReceivesAtomic: 0n,
    totalDueAtomic: 0n,
  });
  const freeTransaction = new Transaction();
  freeTransaction.setSender(IDS.owner);
  const free = await appendCompleteAuthorizationV5(freeTransaction, {
    runtime,
    ...state,
    protocol: freeProtocol,
    quote: freeQuote,
    wallet: IDS.owner,
    name: 'Mira',
    profileBlobId: 'profile-blob',
    imageBlobId: 'image-blob',
    imageUrl: 'https://aggregator.example/image',
    outputSealId,
    outputNonce,
    outputDigest,
    recipe,
    styleSelections,
  });
  assert.equal(free.paid, false);
  assert.equal(free.authorization.$kind, 'Result');
  assert.equal(free.completeOutput.ciphertextBlobId, 'image-blob');
  assert.equal(
    free.completeOutput.publicPreviewUrl,
    'https://aggregator.example/image',
  );
  assert.equal(free.completeOutput.sealId, `0x${'11'.repeat(32)}`);
  assert.equal(free.completeOutput.soulBindingRequired, true);
  assert.equal(free.completeOutput.soulBound, false);
  assert.deepEqual(functions(freeTransaction), ['authorize_complete_free_v5']);

  const paidQuote = Object.freeze({
    ...freeQuote,
    protocolFixedCompleteFeeAtomic: state.protocol.fixedCompleteFeeAtomic,
    creatorChargeAtomic: 3_000_000n,
    protocolPercentageAtomic: 300_000n,
    fixedProtocolFeeAtomic: 100_000n,
    makerReceivesAtomic: 2_700_000n,
    totalDueAtomic: 3_100_000n,
  });
  const paidTransaction = new Transaction();
  paidTransaction.setSender(IDS.owner);
  const paid = await appendCompleteAuthorizationV5(paidTransaction, {
    runtime,
    ...state,
    quote: paidQuote,
    wallet: IDS.owner,
    name: 'Mira',
    profileBlobId: 'profile-blob',
    imageBlobId: 'image-blob',
    imageUrl: 'https://aggregator.example/image',
    outputSealId,
    outputNonce,
    outputDigest,
    recipe,
    styleSelections,
  });
  assert.equal(paid.paid, true);
  assert.equal(paid.totalDueAtomic, 3_100_000n);
  assert.deepEqual(functions(paidTransaction), ['authorize_complete_paid_v5']);

  await assert.rejects(
    appendCompleteAuthorizationV5(new Transaction(), {
      runtime,
      ...state,
      quote: paidQuote,
      wallet: IDS.owner,
      name: 'Mira',
      profileBlobId: 'profile-blob',
      imageBlobId: 'image-blob',
      imageUrl: 'https://aggregator.example/image',
      outputSealId,
      outputNonce,
      outputDigest,
      recipe,
      styleSelections: [
        styleSelections[0],
        { ...styleSelections[1], styleKey: 'changed-after-quote' },
      ],
    }),
    { code: 'COMMERCE_V5_STALE_QUOTE' },
  );
});

test('Maker treasury withdrawal is cap-bound and validates amount before wallet signing', () => {
  const state = states();
  const transaction = buildWithdrawMakerRevenueV5({
    runtime,
    ...state,
    amountAtomic: 7_000_000n,
    recipient: IDS.owner,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(transaction), ['withdraw_maker_revenue_v5']);
  assert.throws(
    () => buildWithdrawMakerRevenueV5({
      runtime,
      ...state,
      amountAtomic: 7_000_001n,
      recipient: IDS.owner,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_INSUFFICIENT_REVENUE' },
  );
});

test('Maker sale enforces pause + zero treasury and supports list, cancel, and exact-price buy', () => {
  const paused = states({
    rootOverrides: { lifecycle: COMMERCE_V5_LIFECYCLE.PAUSED },
    treasuryOverrides: { revenue: { fields: { value: '0' } } },
  });
  const list = buildListMakerForSaleV5({
    runtime,
    ...paused,
    priceAtomic: 25_000_000n,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(list), ['list_maker_for_sale_v5']);

  assert.throws(
    () => buildListMakerForSaleV5({
      runtime,
      ...states({ rootOverrides: { lifecycle: COMMERCE_V5_LIFECYCLE.PAUSED } }),
      priceAtomic: 25_000_000n,
      sender: IDS.owner,
    }),
    { code: 'COMMERCE_V5_TREASURY_NOT_EMPTY' },
  );

  const pending = states({
    rootOverrides: {
      lifecycle: COMMERCE_V5_LIFECYCLE.SALE_PENDING,
      active_listing_id: { vec: [IDS.listing] },
    },
    treasuryOverrides: { revenue: { fields: { value: '0' } } },
  });
  const cancel = buildCancelMakerListingV5({
    runtime,
    ...pending,
    sender: IDS.owner,
  });
  assert.deepEqual(functions(cancel), ['cancel_maker_listing_v5']);
  const buy = buildBuyMakerV5({
    runtime,
    ...pending,
    sender: IDS.buyer,
  });
  assert.deepEqual(functions(buy), ['buy_maker_v5']);
});

test('Pack table and wallet state queries fail closed and return linked receipts only', async () => {
  const state = states();
  const PackRecord = bcs.struct('PackRecordV5', {
    key: bcs.string(),
    label: bcs.string(),
    access_kind: bcs.u8(),
    purchase_price_atomic: bcs.u64(),
    complete_policy: bcs.struct('CompletionPolicyV5', {
      mode: bcs.u8(),
      free_quota_per_wallet: bcs.u64(),
      price_atomic: bcs.u64(),
      total_cap: bcs.u64(),
    }),
    active: bcs.bool(),
    entitlement_count: bcs.u64(),
    complete_count: bcs.u64(),
    style_count: bcs.u64(),
    protected_style_count: bcs.u64(),
  });
  const packBytes = PackRecord.serialize({
    key: 'pack-1',
    label: 'Pack 1',
    access_kind: COMMERCE_V5_ACCESS.PAID_ONCE,
    purchase_price_atomic: 6_000_000n,
    complete_policy: {
      mode: freePolicy.mode,
      free_quota_per_wallet: 0n,
      price_atomic: 0n,
      total_cap: 0n,
    },
    active: true,
    entitlement_count: 2n,
    complete_count: 3n,
    style_count: 1n,
    protected_style_count: 1n,
  }).toBytes();
  assert.equal(parsePackRecordV5Bcs(packBytes).purchasePriceAtomic, 6_000_000n);
  const packs = await queryPackRecordsV5({
    async listDynamicFields({ parentId, include }) {
      assert.equal(parentId, IDS.packsTable);
      assert.deepEqual(include, { value: true });
      return {
        dynamicFields: [{ value: { bcs: packBytes } }],
        hasNextPage: false,
        cursor: null,
      };
    },
  }, state.root);
  assert.equal(packs[0].key, 'pack-1');

  const StyleKey = bcs.struct('StyleBindingKeyV5', {
    part_key: bcs.string(),
    item_key: bcs.string(),
    style_key: bcs.string(),
  });
  const StyleProduct = bcs.struct('StyleProductRecordV5', {
    pack_key: bcs.option(bcs.string()),
    asset_blob_id: bcs.string(),
    row_kind: bcs.u8(),
    seal_protected: bcs.bool(),
  });
  const styleFields = [
    {
      name: StyleKey.serialize({
        part_key: 'body',
        item_key: 'base',
        style_key: 'default',
      }).toBytes(),
      value: StyleProduct.serialize({
        pack_key: null,
        asset_blob_id: 'base-style-blob',
        row_kind: COMMERCE_V5_STYLE_ROW.VISUAL,
        seal_protected: true,
      }).toBytes(),
    },
    {
      name: StyleKey.serialize({
        part_key: 'hair',
        item_key: 'long',
        style_key: 'blue',
      }).toBytes(),
      value: StyleProduct.serialize({
        pack_key: 'pack-1',
        asset_blob_id: 'paid-style-ciphertext-blob',
        row_kind: COMMERCE_V5_STYLE_ROW.VISUAL,
        seal_protected: true,
      }).toBytes(),
    },
  ];
  assert.deepEqual(
    parseStyleBindingV5Bcs(styleFields[1].name, styleFields[1].value),
    {
      partKey: 'hair',
      itemKey: 'long',
      styleKey: 'blue',
      packKey: 'pack-1',
      assetBlobId: 'paid-style-ciphertext-blob',
      rowKind: COMMERCE_V5_STYLE_ROW.VISUAL,
      sealProtected: true,
    },
  );
  const styles = await queryStyleBindingsV5({
    async listDynamicFields({ parentId, include }) {
      assert.equal(parentId, IDS.stylesTable);
      assert.deepEqual(include, { value: true });
      return {
        dynamicFields: styleFields.map((field) => ({
          name: { bcs: field.name },
          value: { bcs: field.value },
        })),
        hasNextPage: false,
        cursor: null,
      };
    },
  }, state.root);
  assert.equal(styles.length, 2);
  assert.equal(styles[0].packKey, '');
  assert.equal(styles[1].packKey, 'pack-1');

  const owned = await queryOwnedCommerceV5State({
    async listOwnedObjects({ type }) {
      if (type.includes('MakerAccessPassV5')) return { objects: [accessPassObject()], hasNextPage: false };
      if (type.includes('PackPassV5')) return { objects: [packPassObject()], hasNextPage: false };
      if (type.includes('MakerControlCapV5')) return { objects: [controlCapObject()], hasNextPage: false };
      return { objects: [], hasNextPage: false };
    },
  }, {
    runtime,
    owner: IDS.owner,
    rootId: IDS.root,
    root: state.root,
  });
  assert.equal(owned.ownsMakerAccess, true);
  assert.deepEqual(owned.ownedPackKeys, ['pack-1']);
  assert.equal(owned.controlCaps[0].objectId, IDS.controlCap);
  assert.equal(owned.currentControlCap.objectId, IDS.controlCap);
  assert.equal(walletHasMakerAccessV5(state.root, owned), true);
  assert.equal(walletHasPackAccessV5(state.root, {
    key: 'free-pack',
    accessKind: COMMERCE_V5_ACCESS.FREE,
    active: true,
  }, owned), true);
});

test('Complete output readback binds one exact payer, recipe, digest, and ciphertext Blob', async () => {
  const CompleteOutputRecord = bcs.struct('CompleteOutputRecordV5', {
    seal_id: bcs.byteVector(),
    payer: bcs.Address,
    recipe_hash: bcs.byteVector(),
    output_nonce: bcs.byteVector(),
    output_digest: bcs.byteVector(),
    ciphertext_blob_id: bcs.string(),
    bound_soul_id: bcs.option(bcs.Address),
  });
  const recordBytes = CompleteOutputRecord.serialize({
    seal_id: outputSealId,
    payer: IDS.owner,
    recipe_hash: new Uint8Array(32).fill(0x44),
    output_nonce: outputNonce,
    output_digest: outputDigest,
    ciphertext_blob_id: 'sealed-final-oc-walrus-patch',
    bound_soul_id: null,
  }).toBytes();
  const parsed = parseCompleteOutputRecordV5Bcs(recordBytes);
  assert.deepEqual(parsed, {
    sealId: `0x${'11'.repeat(32)}`,
    payer: IDS.owner,
    recipeHash: `0x${'44'.repeat(32)}`,
    outputNonce: `0x${'22'.repeat(32)}`,
    outputDigest: `0x${'33'.repeat(32)}`,
    ciphertextBlobId: 'sealed-final-oc-walrus-patch',
    boundSoulId: '',
    soulBound: false,
  });
  const boundRecordBytes = CompleteOutputRecord.serialize({
    seal_id: outputSealId,
    payer: IDS.owner,
    recipe_hash: new Uint8Array(32).fill(0x44),
    output_nonce: outputNonce,
    output_digest: outputDigest,
    ciphertext_blob_id: 'sealed-final-oc-walrus-patch',
    bound_soul_id: IDS.soul,
  }).toBytes();
  const bound = parseCompleteOutputRecordV5Bcs(boundRecordBytes);
  assert.equal(bound.boundSoulId, IDS.soul);
  assert.equal(bound.soulBound, true);
  const root = parseMakerRootV5(rootObject({
    complete_output_count: '1',
  }));
  const client = {
    async listDynamicFields({ parentId, include }) {
      assert.equal(parentId, IDS.completeOutputsTable);
      assert.deepEqual(include, { value: true });
      return {
        dynamicFields: [{ value: { bcs: recordBytes } }],
        hasNextPage: false,
        cursor: null,
      };
    },
    async getDynamicField({ parentId, name }) {
      assert.equal(parentId, IDS.completeOutputsTable);
      assert.equal(name.type, 'vector<u8>');
      const requested = bcs.byteVector().parse(name.bcs);
      if (
        Buffer.from(requested).toString('hex')
        !== Buffer.from(outputSealId).toString('hex')
      ) {
        throw new Error('dynamic field not found');
      }
      return {
        dynamicField: {
          value: { bcs: recordBytes },
        },
      };
    },
  };
  const records = await queryCompleteOutputRecordsV5(client, root);
  assert.equal(records.length, 1);
  assert.equal(records[0].rootId, IDS.root);
  assert.equal(records[0].ciphertextBlobId, 'sealed-final-oc-walrus-patch');
  assert.equal(
    (await queryCompleteOutputRecordV5(client, root, outputSealId)).payer,
    IDS.owner,
  );
  await assert.rejects(
    queryCompleteOutputRecordV5(
      client,
      root,
      new Uint8Array(32).fill(0xff),
    ),
    { code: 'COMMERCE_V5_COMPLETE_OUTPUT_NOT_FOUND' },
  );
});

test('batched state query rejects a missing protocol object instead of falling back to local defaults', async () => {
  const objects = [
    protocolObject(),
    protocolTreasuryObject(),
    rootObject({
      lifecycle: COMMERCE_V5_LIFECYCLE.SALE_PENDING,
      active_listing_id: { vec: [IDS.listing] },
    }),
    makerTreasuryObject(),
    listingObject(),
  ];
  const state = await queryCommerceV5Objects({
    async getObjects({ objectIds, include }) {
      assert.deepEqual(include, { json: true });
      return { objects: objects.filter((entry) => objectIds.includes(entry.objectId)) };
    },
  }, {
    protocolConfigId: IDS.protocol,
    protocolTreasuryId: IDS.protocolTreasury,
    makerRootId: IDS.root,
    makerTreasuryId: IDS.makerTreasury,
    listingId: IDS.listing,
  });
  assert.equal(state.root.objectId, IDS.root);
  assert.equal(state.listing.objectId, IDS.listing);

  await assert.rejects(
    queryCommerceV5Objects({
      async getObjects() {
        return { objects: objects.filter((entry) => entry.objectId !== IDS.protocol) };
      },
    }, {
      protocolConfigId: IDS.protocol,
      protocolTreasuryId: IDS.protocolTreasury,
      makerRootId: IDS.root,
      makerTreasuryId: IDS.makerTreasury,
    }),
    { code: 'COMMERCE_V5_OBJECT_UNAVAILABLE' },
  );
});

test('commerce v5 event parser exposes IDs and exact atomic amounts without Number coercion', () => {
  const parsed = parseCommerceV5Event({
    type: `${PACKAGE}::commerce_v5::MakerPurchasedV5`,
    transaction: { digest: 'digest-1' },
    contents: {
      json: {
        root_id: IDS.root,
        listing_id: IDS.listing,
        seller: IDS.owner,
        buyer: IDS.buyer,
        price_atomic: '9007199254740993',
        protocol_fee_atomic: '100',
        original_creator_royalty_atomic: '200',
        ownership_epoch: '8',
        control_cap_id: IDS.controlCap,
      },
    },
  });
  assert.equal(parsed.name, 'MakerPurchasedV5');
  assert.equal(parsed.priceAtomic, 9_007_199_254_740_993n);
  assert.equal(parsed.buyer, IDS.buyer);
  assert.equal(parsed.transactionDigest, 'digest-1');
  const complete = parseCommerceV5Event({
    type: `${PACKAGE}::commerce_v5::CompleteAuthorizedV5`,
    contents: {
      json: {
        root_id: IDS.root,
        legacy_maker_id: IDS.legacyMaker,
        payer: IDS.owner,
        creator_charge_atomic: '0',
        protocol_percentage_atomic: '0',
        fixed_protocol_fee_atomic: '0',
        total_paid_atomic: '0',
        ownership_epoch: '7',
        output_seal_id: [...outputSealId],
        output_nonce: [...outputNonce],
        output_digest: [...outputDigest],
        ciphertext_blob_id: 'sealed-final-oc-walrus-patch',
      },
    },
  });
  assert.equal(complete.outputSealId, `0x${'11'.repeat(32)}`);
  assert.equal(complete.outputNonce, `0x${'22'.repeat(32)}`);
  assert.equal(complete.outputDigest, `0x${'33'.repeat(32)}`);
  assert.equal(
    complete.ciphertextBlobId,
    'sealed-final-oc-walrus-patch',
  );
  const bound = parseCommerceV5Event({
    type: `${PACKAGE}::commerce_v5::CompleteOutputBoundToSoulV5`,
    contents: {
      json: {
        root_id: IDS.root,
        seal_id: [...outputSealId],
        soul_id: IDS.soul,
        payer: IDS.owner,
      },
    },
  });
  assert.equal(bound.rootId, IDS.root);
  assert.equal(bound.soulId, IDS.soul);
  assert.equal(bound.payer, IDS.owner);
  assert.equal(bound.sealId, `0x${'11'.repeat(32)}`);
  assert.equal(parseCommerceV5Event({ type: `${PACKAGE}::animacraft::OCMakerPublished` }), null);
});
