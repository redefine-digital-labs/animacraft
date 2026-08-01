import assert from 'node:assert/strict';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import test from 'node:test';
import {
  COMMERCE_V5_ACCESS,
  COMMERCE_V5_COMPLETE_POLICY,
  COMMERCE_V5_LIFECYCLE,
  COMMERCE_V5_RIGHTS,
  COMMERCE_V5_STYLE_ROW,
} from '../chain-commerce-v5.js';
import {
  MAKER_COMMERCE_PUBLICATION_V5_ACTIONS,
  MAKER_COMMERCE_PUBLICATION_V5_STAGES,
  advanceMakerCommerceV5Publication,
  createMakerCommerceV5PublicationCheckpoint,
  hydrateMakerCommerceV5PublicationCheckpoint,
  resolveMakerSealCallablePackageV5,
  reconcileMakerCommerceV5Publication,
  serializeMakerCommerceV5PublicationCheckpoint,
} from '../maker-commerce-publication-v5.js';

const id = (value) => normalizeSuiAddress(`0x${value}`);
const IDS = Object.freeze({
  package: id('a'),
  sealPackage: id('b'),
  owner: id('11'),
  otherOwner: id('12'),
  protocol: id('21'),
  protocolTreasury: id('22'),
  legacyMaker: id('31'),
  legacyTreasury: id('32'),
  legacyCap: id('33'),
  root: id('41'),
  makerTreasury: id('42'),
  controlCap: id('43'),
  vault: id('44'),
  stylesTable: id('45'),
  packsTable: id('46'),
});

test('keeps Seal publication targets on the frozen v5 package after a v6 upgrade', () => {
  assert.equal(resolveMakerSealCallablePackageV5({
    callablePackageId: IDS.package,
    sealV5CallablePackageId: IDS.sealPackage,
    sealV5TypeOriginPackageId: IDS.sealPackage,
  }), IDS.sealPackage);
  assert.equal(resolveMakerSealCallablePackageV5({
    callablePackageId: IDS.package,
    sealV5PackageId: IDS.sealPackage,
  }), IDS.sealPackage);
});

const PAYMENT = `${id('2')}::sui::SUI`;
const runtime = Object.freeze({
  network: 'mainnet',
  callablePackageId: IDS.package,
  commerceV5TypeOriginPackageId: IDS.package,
  paymentCoinType: PAYMENT,
  commerceV5ReleaseEnabled: false,
});

const freePolicy = Object.freeze({
  mode: COMMERCE_V5_COMPLETE_POLICY.UNLIMITED_FREE,
  freeQuotaPerWallet: 0n,
  priceAtomic: 0n,
  totalCap: 0n,
});

const plan = Object.freeze({
  rightsOrigin: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
  logicalAuxiliaryBlobId: 'canonical-logical-blob',
  migration: Object.freeze({
    rightsOrigin: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
    baseCompletePolicy: freePolicy,
    soulCreatorRoyaltyBps: 250,
    makerResaleRoyaltyBps: 500,
  }),
  configuration: Object.freeze({
    baseAccess: Object.freeze({
      kind: COMMERCE_V5_ACCESS.FREE,
      purchasePriceAtomic: 0n,
    }),
    baseCompletePolicy: freePolicy,
    soulCreatorRoyaltyBps: 250,
    makerResaleRoyaltyBps: 500,
    packs: Object.freeze([Object.freeze({
      key: 'premium',
      label: 'Premium',
      access: Object.freeze({
        kind: COMMERCE_V5_ACCESS.PAID_ONCE,
        purchasePriceAtomic: 6_000_000n,
      }),
      completePolicy: freePolicy,
      active: true,
    })]),
    styleBindings: Object.freeze([
      Object.freeze({
        partKey: 'body',
        itemKey: 'base',
        styleKey: 'default',
        rowKind: COMMERCE_V5_STYLE_ROW.VISUAL,
      }),
      Object.freeze({
        partKey: 'hair',
        itemKey: 'long',
        styleKey: 'blue',
        packKey: 'premium',
        rowKind: COMMERCE_V5_STYLE_ROW.VISUAL,
      }),
      Object.freeze({
        partKey: 'hair',
        itemKey: 'short',
        styleKey: 'black',
        packKey: 'premium',
        rowKind: COMMERCE_V5_STYLE_ROW.VISUAL,
      }),
    ]),
    sealStyleRegistry: true,
    activate: true,
  }),
});

const context = Object.freeze({
  makerKey: `${IDS.owner}:maker-local`,
  owner: IDS.owner,
  legacyMakerId: IDS.legacyMaker,
  legacyMakerTreasuryId: IDS.legacyTreasury,
  legacyMakerAdminCapId: IDS.legacyCap,
  legacyMakerTreasuryBalanceAtomic: 0n,
  protocolConfigId: IDS.protocol,
  protocolTreasuryId: IDS.protocolTreasury,
  v4PublicationDigest: 'v4-digest',
  manifestBlobId: 'walrus-manifest',
});

function protocol() {
  return Object.freeze({
    objectId: IDS.protocol,
    version: 5,
    legacyAdminCapId: id('99'),
    treasuryId: IDS.protocolTreasury,
    paymentCoinType: PAYMENT,
    primaryProtocolFeeBps: 1_000,
    logicalAuxiliaryBlobId: 'canonical-logical-blob',
    soulBindingProofType:
      `${IDS.package}::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5`,
    enabled: false,
  });
}

function createHarness({
  initialChain = null,
  signer,
  getContext,
} = {}) {
  let stored = null;
  let chain = initialChain;
  let digestCounter = 0;
  const calls = [];

  const makeMigratedChain = () => ({
    protocol: protocol(),
    root: {
      objectId: IDS.root,
      version: 5,
      legacyMakerId: IDS.legacyMaker,
      legacyTreasuryId: IDS.legacyTreasury,
      controlVaultId: IDS.vault,
      treasuryId: IDS.makerTreasury,
      protocolConfigId: IDS.protocol,
      paymentCoinType: PAYMENT,
      originalCreator: IDS.owner,
      currentOwner: IDS.owner,
      rightsOrigin: COMMERCE_V5_RIGHTS.ONCHAIN_NATIVE,
      lifecycle: COMMERCE_V5_LIFECYCLE.PAUSED,
      ownershipEpoch: 0n,
      currentControlCapId: IDS.controlCap,
      logicalAuxiliaryBlobId: 'canonical-logical-blob',
      activeListingId: '',
      soulCreatorRoyaltyBps: 250,
      makerResaleRoyaltyBps: 500,
      baseAccess: {
        kind: COMMERCE_V5_ACCESS.FREE,
        purchasePriceAtomic: 0n,
      },
      basePolicy: freePolicy,
      packsTableId: IDS.packsTable,
      styleRegistryTableId: IDS.stylesTable,
      styleRegistrySealed: false,
      packKeys: [],
      packCount: 0n,
      styleCount: 0n,
      totalCompletes: 0n,
    },
    makerTreasury: {
      objectId: IDS.makerTreasury,
      rootId: IDS.root,
      balanceAtomic: 0n,
    },
    controlCap: {
      objectId: IDS.controlCap,
      rootId: IDS.root,
      ownershipEpoch: 0n,
    },
    packs: [],
    styleBindings: [],
    transactionStatuses: {},
  });

  const defaultSigner = async (_transaction, options) => {
    calls.push(options.action);
    digestCounter += 1;
    const digest = `${options.action}-${digestCounter}`;
    if (options.action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE) {
      chain = makeMigratedChain();
      return {
        digest,
        indexed: {
          events: [{
            contents: {
              json: {
                root_id: IDS.root,
                legacy_maker_id: IDS.legacyMaker,
                treasury_id: IDS.makerTreasury,
                control_cap_id: IDS.controlCap,
                vault_id: IDS.vault,
                owner: IDS.owner,
              },
            },
          }],
        },
      };
    }
    if (options.action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY) {
      chain.root.baseAccess = { ...plan.configuration.baseAccess };
      chain.root.basePolicy = { ...plan.configuration.baseCompletePolicy };
      chain.root.soulCreatorRoyaltyBps = plan.configuration.soulCreatorRoyaltyBps;
      chain.root.makerResaleRoyaltyBps = plan.configuration.makerResaleRoyaltyBps;
      chain.root.packKeys = plan.configuration.packs.map((pack) => pack.key);
      chain.root.packCount = BigInt(plan.configuration.packs.length);
      chain.packs = plan.configuration.packs.map((pack) => ({
        key: pack.key,
        label: pack.label,
        accessKind: pack.access.kind,
        purchasePriceAtomic: pack.access.purchasePriceAtomic,
        completePolicy: pack.completePolicy,
        active: true,
      }));
      return { digest };
    }
    if (options.action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_STYLES) {
      const identities = new Set(options.checkpoint.intent.styleBindingIdentities);
      const additions = plan.configuration.styleBindings.filter((binding) => (
        identities.has([binding.partKey, binding.itemKey, binding.styleKey].join('\u0000'))
      )).map((binding) => ({
        ...binding,
        assetBlobId: `walrus-${binding.partKey}-${binding.itemKey}-${binding.styleKey}`,
        sealProtected: Boolean(binding.packKey),
      }));
      chain.styleBindings.push(...additions);
      chain.root.styleCount = BigInt(chain.styleBindings.length);
      return { digest };
    }
    if (options.action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.SEAL) {
      chain.root.styleRegistrySealed = true;
      return { digest };
    }
    if (options.action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.ACTIVATE) {
      chain.root.lifecycle = COMMERCE_V5_LIFECYCLE.ACTIVE;
      return { digest };
    }
    throw new Error(`Unexpected action ${options.action}`);
  };

  return {
    calls,
    get chain() {
      return chain;
    },
    set chain(value) {
      chain = value;
    },
    get stored() {
      return stored;
    },
    dependencies: {
      client: {},
      now: () => '2026-07-31T00:00:00.000Z',
      getContext: getContext || (() => context),
      query: async () => chain || {
        protocol: protocol(),
        root: null,
        transactionStatuses: {},
      },
      persist: async (checkpoint, { expectedSequence }) => {
        const actual = stored?.sequence ?? 0;
        if (actual !== expectedSequence) {
          const error = new Error('checkpoint CAS conflict');
          error.code = 'CHECKPOINT_CONFLICT';
          throw error;
        }
        stored = JSON.parse(JSON.stringify(checkpoint));
        return stored;
      },
      signAndExecute: signer || defaultSigner,
    },
    makeMigratedChain,
  };
}

function makeActiveReadback(harness, targetPlan = plan) {
  const chain = harness.makeMigratedChain();
  chain.root.baseAccess = { ...targetPlan.configuration.baseAccess };
  chain.root.basePolicy = { ...targetPlan.configuration.baseCompletePolicy };
  chain.root.soulCreatorRoyaltyBps =
    targetPlan.configuration.soulCreatorRoyaltyBps;
  chain.root.makerResaleRoyaltyBps =
    targetPlan.configuration.makerResaleRoyaltyBps;
  chain.root.packKeys = targetPlan.configuration.packs.map((pack) => pack.key);
  chain.root.packCount = BigInt(targetPlan.configuration.packs.length);
  chain.packs = targetPlan.configuration.packs.map((pack) => ({
    key: pack.key,
    label: pack.label,
    accessKind: pack.access.kind,
    purchasePriceAtomic: pack.access.purchasePriceAtomic,
    completePolicy: pack.completePolicy,
    active: true,
  }));
  chain.styleBindings = targetPlan.configuration.styleBindings.map((binding) => {
    const pack = targetPlan.configuration.packs
      .find((candidate) => candidate.key === binding.packKey);
    const sealProtected =
      binding.rowKind === COMMERCE_V5_STYLE_ROW.VISUAL
      && (
        pack?.access?.kind === COMMERCE_V5_ACCESS.PAID_ONCE
        || (!binding.packKey
          && targetPlan.configuration.baseAccess.kind
            === COMMERCE_V5_ACCESS.PAID_ONCE)
      );
    return {
      ...binding,
      assetBlobId:
        `walrus-${binding.partKey}-${binding.itemKey}-${binding.styleKey}`,
      sealProtected,
    };
  });
  chain.root.styleCount = BigInt(chain.styleBindings.length);
  chain.root.styleRegistrySealed = true;
  chain.root.lifecycle = COMMERCE_V5_LIFECYCLE.ACTIVE;
  harness.chain = chain;
  return chain;
}

test('publishes through migration, policy, bounded Style batches, seal and readback-confirmed activation', async () => {
  const harness = createHarness();
  let checkpoint = createMakerCommerceV5PublicationCheckpoint({
    context,
    runtime,
    plan,
    createdAt: '2026-07-31T00:00:00.000Z',
  });
  const expectedStableStages = [
    MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED,
    MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_CONFIGURED,
    MAKER_COMMERCE_PUBLICATION_V5_STAGES.STYLES_CONFIGURING,
    MAKER_COMMERCE_PUBLICATION_V5_STAGES.CONFIGURED,
    MAKER_COMMERCE_PUBLICATION_V5_STAGES.SEALED,
    MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE,
  ];
  for (const expectedStage of expectedStableStages) {
    const result = await advanceMakerCommerceV5Publication({
      checkpoint,
      context,
      runtime,
      plan,
      protocol: protocol(),
      dependencies: harness.dependencies,
      styleBatchSize: 2,
    });
    checkpoint = result.checkpoint;
    assert.equal(checkpoint.stage, expectedStage);
  }
  assert.deepEqual(harness.calls, [
    'migrate',
    'configure-policy',
    'configure-styles',
    'configure-styles',
    'seal',
    'activate',
  ]);
  assert.equal(checkpoint.completed, true);
  assert.equal(checkpoint.readbackVerified, true);
  assert.equal(checkpoint.confirmedStyleCount, 3);
  assert.equal(checkpoint.digests.styleBatches.length, 2);
  assert.equal(checkpoint.objects.rootId, IDS.root);
  assert.equal(harness.chain.root.lifecycle, COMMERCE_V5_LIFECYCLE.ACTIVE);
});

test('migration is never repeated when policy configuration fails safely and is retried', async () => {
  let failPolicy = true;
  const harness = createHarness();
  const healthySigner = harness.dependencies.signAndExecute;
  harness.dependencies.signAndExecute = async (transaction, options) => {
    if (
      options.action === MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY
      && failPolicy
    ) {
      const error = new Error('wallet rejected policy transaction');
      error.code = 'WALLET_REJECTED';
      error.submitted = false;
      throw error;
    }
    return healthySigner(transaction, options);
  };
  let checkpoint = createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  checkpoint = (await advanceMakerCommerceV5Publication({
    checkpoint,
    context,
    runtime,
    plan,
    protocol: protocol(),
    dependencies: harness.dependencies,
  })).checkpoint;
  assert.equal(checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED);

  await assert.rejects(
    async () => {
      await advanceMakerCommerceV5Publication({
        checkpoint,
        context,
        runtime,
        plan,
        protocol: protocol(),
        dependencies: harness.dependencies,
      });
    },
    (error) => {
      checkpoint = error.checkpoint;
      return error.code === 'WALLET_REJECTED';
    },
  );
  assert.equal(checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED);
  assert.equal(checkpoint.digests.migration, 'migrate-1');
  failPolicy = false;
  checkpoint = (await advanceMakerCommerceV5Publication({
    checkpoint,
    context,
    runtime,
    plan,
    protocol: protocol(),
    dependencies: harness.dependencies,
  })).checkpoint;
  assert.equal(checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.POLICY_CONFIGURED);
  assert.equal(harness.calls.filter((action) => action === 'migrate').length, 1);
});

test('refresh recovers a migration that landed after the durable intent but before digest persistence', async () => {
  const harness = createHarness();
  const initial = createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  const intent = hydrateMakerCommerceV5PublicationCheckpoint({
    ...initial,
    sequence: 1,
    stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATION_INTENT,
    action: MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE,
    intent: {
      action: MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE,
      createdAt: '2026-07-31T00:00:00.000Z',
      styleBindingIdentities: [],
    },
  }, { context, runtime, plan });
  harness.dependencies.persist = async (checkpoint, { expectedSequence }) => {
    assert.equal(expectedSequence, 1);
    return checkpoint;
  };
  harness.chain = harness.makeMigratedChain();
  const recovered = await reconcileMakerCommerceV5Publication({
    checkpoint: JSON.parse(serializeMakerCommerceV5PublicationCheckpoint(intent)),
    context,
    runtime,
    plan,
    dependencies: harness.dependencies,
  });
  assert.equal(recovered.pending, false);
  assert.equal(recovered.checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED);
  assert.equal(recovered.checkpoint.objects.rootId, IDS.root);
  assert.equal(recovered.nextAction, MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.CONFIGURE_POLICY);
  assert.deepEqual(harness.calls, []);
});

test('an unresolved durable intent blocks duplicate migration submission', async () => {
  const harness = createHarness();
  const initial = createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  const intent = hydrateMakerCommerceV5PublicationCheckpoint({
    ...initial,
    stage: MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATION_INTENT,
    sequence: 1,
    action: MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE,
    intent: {
      action: MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE,
      createdAt: '2026-07-31T00:00:00.000Z',
      styleBindingIdentities: [],
    },
  }, { context, runtime, plan });
  const result = await advanceMakerCommerceV5Publication({
    checkpoint: intent,
    context,
    runtime,
    plan,
    protocol: protocol(),
    dependencies: harness.dependencies,
  });
  assert.equal(result.pending, true);
  assert.equal(result.pendingAction, MAKER_COMMERCE_PUBLICATION_V5_ACTIONS.MIGRATE);
  assert.deepEqual(harness.calls, []);
});

test('checkpoint compare-and-swap allows only one concurrent migration signer', async () => {
  const harness = createHarness();
  const checkpoint = createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  const attempts = await Promise.allSettled([
    advanceMakerCommerceV5Publication({
      checkpoint,
      context,
      runtime,
      plan,
      protocol: protocol(),
      dependencies: harness.dependencies,
    }),
    advanceMakerCommerceV5Publication({
      checkpoint,
      context,
      runtime,
      plan,
      protocol: protocol(),
      dependencies: harness.dependencies,
    }),
  ]);
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(harness.calls.filter((action) => action === 'migrate').length, 1);
});

test('temporary readback loss never rolls a confirmed migration backward or resubmits it', async () => {
  const harness = createHarness();
  let checkpoint = createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  checkpoint = (await advanceMakerCommerceV5Publication({
    checkpoint,
    context,
    runtime,
    plan,
    protocol: protocol(),
    dependencies: harness.dependencies,
  })).checkpoint;
  assert.equal(checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED);
  harness.chain = null;
  const result = await advanceMakerCommerceV5Publication({
    checkpoint,
    context,
    runtime,
    plan,
    protocol: protocol(),
    dependencies: harness.dependencies,
  });
  assert.equal(result.readbackPending, true);
  assert.equal(result.checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATED);
  assert.deepEqual(harness.calls, ['migrate']);
});

test('wallet or Maker context drift is caught after the intent checkpoint and before signing', async () => {
  let reads = 0;
  const harness = createHarness({
    getContext: () => {
      reads += 1;
      return reads >= 3 ? { ...context, owner: IDS.otherOwner } : context;
    },
  });
  const checkpoint = createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  await assert.rejects(
    () => advanceMakerCommerceV5Publication({
      checkpoint,
      context,
      runtime,
      plan,
      protocol: protocol(),
      dependencies: harness.dependencies,
    }),
    (error) => {
      assert.equal(
        error.checkpoint.stage,
        MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATION_INTENT,
      );
      return error.code === 'COMMERCE_V5_PUBLICATION_CONTEXT_CHANGED';
    },
  );
  assert.deepEqual(harness.calls, []);
  assert.equal(
    harness.stored.stage,
    MAKER_COMMERCE_PUBLICATION_V5_STAGES.MIGRATION_INTENT,
  );
});

test('an activation digest never marks publication complete until Active is read back', async () => {
  const harness = createHarness();
  harness.chain = harness.makeMigratedChain();
  harness.chain.root.baseAccess = { ...plan.configuration.baseAccess };
  harness.chain.root.packKeys = ['premium'];
  harness.chain.root.packCount = 1n;
  harness.chain.packs = plan.configuration.packs.map((pack) => ({
    key: pack.key,
    label: pack.label,
    accessKind: pack.access.kind,
    purchasePriceAtomic: pack.access.purchasePriceAtomic,
    completePolicy: pack.completePolicy,
    active: true,
  }));
  harness.chain.styleBindings = plan.configuration.styleBindings.map((binding) => ({
    ...binding,
    assetBlobId: `walrus-${binding.partKey}-${binding.itemKey}-${binding.styleKey}`,
    sealProtected: Boolean(binding.packKey),
  }));
  harness.chain.root.styleCount = 3n;
  harness.chain.root.styleRegistrySealed = true;

  harness.dependencies.signAndExecute = async (_transaction, options) => {
    harness.calls.push(options.action);
    return { digest: 'activate-landed-but-not-visible' };
  };
  let checkpoint = createMakerCommerceV5PublicationCheckpoint({ context, runtime, plan });
  const result = await advanceMakerCommerceV5Publication({
    checkpoint,
    context,
    runtime,
    plan,
    protocol: protocol(),
    dependencies: harness.dependencies,
  });
  checkpoint = result.checkpoint;
  assert.equal(checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVATE_SUBMITTED);
  assert.equal(checkpoint.completed, false);
  assert.equal(result.pending, true);

  harness.chain.root.lifecycle = COMMERCE_V5_LIFECYCLE.ACTIVE;
  const recovered = await reconcileMakerCommerceV5Publication({
    checkpoint,
    context,
    runtime,
    plan,
    dependencies: harness.dependencies,
  });
  assert.equal(recovered.checkpoint.stage, MAKER_COMMERCE_PUBLICATION_V5_STAGES.ACTIVE);
  assert.equal(recovered.checkpoint.completed, true);
  assert.equal(recovered.checkpoint.readbackVerified, true);
});

test('readback rejects every visual, logical-none, or logical-color row-kind drift before Active', async () => {
  const logicalPlan = {
    ...plan,
    configuration: {
      ...plan.configuration,
      styleBindings: [
        ...plan.configuration.styleBindings,
        {
          partKey: 'accessory',
          itemKey: 'optional',
          styleKey: '__none__',
          rowKind: COMMERCE_V5_STYLE_ROW.LOGICAL_NONE,
        },
        {
          partKey: '__smart_color__',
          itemKey: 'skin',
          styleKey: '__color__:warm',
          rowKind: COMMERCE_V5_STYLE_ROW.LOGICAL_COLOR,
        },
      ],
    },
  };
  const cases = [
    [0, COMMERCE_V5_STYLE_ROW.LOGICAL_NONE],
    [3, COMMERCE_V5_STYLE_ROW.LOGICAL_COLOR],
    [4, COMMERCE_V5_STYLE_ROW.LOGICAL_NONE],
  ];
  for (const [bindingIndex, driftedRowKind] of cases) {
    const harness = createHarness();
    const chain = makeActiveReadback(harness, logicalPlan);
    chain.styleBindings[bindingIndex] = {
      ...chain.styleBindings[bindingIndex],
      rowKind: driftedRowKind,
      sealProtected: false,
    };
    const checkpoint = createMakerCommerceV5PublicationCheckpoint({
      context,
      runtime,
      plan: logicalPlan,
    });
    await assert.rejects(
      () => reconcileMakerCommerceV5Publication({
        checkpoint,
        context,
        runtime,
        plan: logicalPlan,
        dependencies: harness.dependencies,
      }),
      (error) => error.code === 'COMMERCE_V5_PUBLICATION_STYLE_DRIFT',
    );
  }
});

test('readback derives paid Base protection instead of trusting a caller flag', async () => {
  const paidBasePlan = {
    ...plan,
    configuration: {
      ...plan.configuration,
      baseAccess: {
        kind: COMMERCE_V5_ACCESS.PAID_ONCE,
        purchasePriceAtomic: 2_000_000n,
      },
    },
  };
  const harness = createHarness();
  const chain = makeActiveReadback(harness, paidBasePlan);
  chain.styleBindings[0] = {
    ...chain.styleBindings[0],
    sealProtected: false,
  };
  const checkpoint = createMakerCommerceV5PublicationCheckpoint({
    context,
    runtime,
    plan: paidBasePlan,
  });
  await assert.rejects(
    () => reconcileMakerCommerceV5Publication({
      checkpoint,
      context,
      runtime,
      plan: paidBasePlan,
      dependencies: harness.dependencies,
    }),
    (error) => error.code === 'COMMERCE_V5_PUBLICATION_STYLE_DRIFT',
  );
});

test('readback rejects a MakerRoot bound to a different logical auxiliary Blob', async () => {
  const harness = createHarness();
  const chain = makeActiveReadback(harness);
  chain.root.logicalAuxiliaryBlobId = 'different-logical-blob';
  const checkpoint = createMakerCommerceV5PublicationCheckpoint({
    context,
    runtime,
    plan,
  });
  await assert.rejects(
    () => reconcileMakerCommerceV5Publication({
      checkpoint,
      context,
      runtime,
      plan,
      dependencies: harness.dependencies,
    }),
    (error) => (
      error.code === 'COMMERCE_V5_PUBLICATION_LOGICAL_AUXILIARY_DRIFT'
    ),
  );
});

test('readback rejects a protocol object bound to a different logical auxiliary Blob', async () => {
  const harness = createHarness();
  const chain = makeActiveReadback(harness);
  chain.protocol = {
    ...chain.protocol,
    logicalAuxiliaryBlobId: 'different-protocol-logical-blob',
  };
  const checkpoint = createMakerCommerceV5PublicationCheckpoint({
    context,
    runtime,
    plan,
  });
  await assert.rejects(
    () => reconcileMakerCommerceV5Publication({
      checkpoint,
      context,
      runtime,
      plan,
      dependencies: harness.dependencies,
    }),
    (error) => (
      error.code === 'COMMERCE_V5_PUBLICATION_PROTOCOL_LOGICAL_AUXILIARY_DRIFT'
    ),
  );
});
