import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
} from '../maker-composable-v6.js';
import {
  MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS,
  MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS,
  MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS,
  MakerComposablePlayerV6Error,
  beginMakerComposableV6PlayerAction,
  buildMakerComposableV6AppearancePlan,
  buildMakerComposableV6ItemEntitlementPlan,
  buildMakerComposableV6OwnedLockPlan,
  buildMakerComposableV6PlayerActionPlan,
  confirmMakerComposableV6PlayerAction,
  createMakerComposableV6PlayerCheckpoint,
  hashMakerComposableV6LoadoutSelections,
  hydrateMakerComposableV6PlayerCheckpoint,
  markMakerComposableV6PlayerSubmitted,
  nextMakerComposableV6PlayerAction,
  serializeMakerComposableV6PlayerCheckpoint,
} from '../maker-composable-player-v6.js';

const IDS = Object.freeze({
  animacraft: '0xa1',
  compositionOrigin: '0xa2',
  compositionConfig: '0xa3',
  compositionTreasury: '0xa4',
  compositionRegistry: '0xa5',
  commerceConfig: '0xa6',
  soulidity: '0xb1',
  soulidityOrigin: '0xb2',
  wallet: '0xc1',
  root: '0xc2',
  profile: '0xc3',
  product: '0xc4',
  soulState: '0xc5',
  ownedItem: '0xc6',
  payment: '0xc7',
  appearance: '0xc8',
  soul: '0xc9',
});

function runtime(overrides = {}) {
  return {
    network: 'mainnet',
    callablePackageId: IDS.animacraft,
    compositionV6TypeOriginPackageId: IDS.compositionOrigin,
    compositionProtocolConfigV6Id: IDS.compositionConfig,
    compositionProtocolTreasuryV6Id: IDS.compositionTreasury,
    compositionRegistryV6Id: IDS.compositionRegistry,
    commerceProtocolConfigV5Id: IDS.commerceConfig,
    paymentCoinType: '0xd1::usdc::USDC',
    soulidityPackageId: IDS.soulidity,
    soulidityTypeOriginPackageId: IDS.soulidityOrigin,
    compositionV6SoulOwnerProofType:
      `${IDS.soulidityOrigin}::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6`,
    compositionV6ReleaseEnabled: false,
    commerceV5ReleaseEnabled: false,
    canonicalSoulMintEnabled: false,
    ...overrides,
  };
}

function activeRuntime(overrides = {}) {
  return runtime({
    compositionV6ReleaseEnabled: true,
    commerceV5ReleaseEnabled: true,
    canonicalSoulMintEnabled: true,
    ...overrides,
  });
}

function context(overrides = {}) {
  return {
    wallet: IDS.wallet,
    makerRootId: IDS.root,
    profileId: IDS.profile,
    productId: IDS.product,
    soulStateId: IDS.soulState,
    ownedItemId: IDS.ownedItem,
    paymentCoinId: IDS.payment,
    appearanceStateId: IDS.appearance,
    soulId: IDS.soul,
    ...overrides,
  };
}

function product(mode, binding, priceAtomic = '0') {
  return {
    onchainProductId: IDS.product,
    access: { mode, binding, priceAtomic },
  };
}

const HASH_A = '11'.repeat(32);

async function checkpoint(plan) {
  return createMakerComposableV6PlayerCheckpoint({
    plan,
    nonce: 'player-action-nonce-0001',
    createdAt: '2026-07-31T00:00:00.000Z',
  });
}

test('free Account claim is a direct Animacraft action and the disabled gate blocks resolution', async () => {
  const plan = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context(),
    product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.ACCOUNT),
  });
  assert.equal(plan.operation, MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.CLAIM_ACCOUNT_ITEM);
  assert.equal(plan.action.calls.length, 1);
  assert.match(plan.action.calls[0].target, /::composition_v6::claim_free_wallet_item_v6$/);
  assert.equal(plan.action.calls[0].typeArguments.length, 0);
  assert.equal(plan.action.expectedReadback.ownedInstanceRequired, false);

  const saved = await checkpoint(plan);
  await assert.rejects(
    nextMakerComposableV6PlayerAction({ checkpoint: saved, plan, runtime: runtime() }),
    (failure) => failure instanceof MakerComposablePlayerV6Error
      && failure.code === 'COMPOSABLE_PLAYER_V6_RELEASE_DISABLED',
  );
});

test('paid Soul-bound purchase uses the Soulidity proof wrapper and preserves exact u64 price', async () => {
  const exactPrice = '9007199254740993000';
  const plan = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context(),
    product: product(ITEM_ACCESS_MODES.PAID_ONCE, ITEM_BINDING_MODES.SOUL_BOUND, exactPrice),
  });
  assert.equal(plan.operation, MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.PURCHASE_SOUL_ITEM);
  assert.match(
    plan.action.calls[0].target,
    /::animacraft_appearance_adapter_v6::purchase_soul_item_v6$/,
  );
  assert.equal(plan.action.calls[0].typeArguments.length, 1);
  assert.deepEqual(plan.action.calls[0].inputOrder, [
    'registry', 'compositionConfig', 'treasury', 'profile', 'product', 'root',
    'commerceConfig', 'state', 'payment', 'clock',
  ]);
  assert.equal(plan.action.expectedReadback.paidAtomic, exactPrice);
  assert.equal(plan.action.policy.proofPath, 'SOULIDITY_OWNER_PROOF_WRAPPER');
  assert.equal(plan.action.calls[0].inputs.state.objectId, IDS.soulState);
  assert.equal(plan.action.calls[0].inputs.payment.objectId, IDS.payment);
});

test('unsafe JS numbers, zero paid prices and non-zero free prices fail closed', async () => {
  await assert.rejects(
    buildMakerComposableV6ItemEntitlementPlan({
      runtime: runtime(),
      context: context(),
      product: product(
        ITEM_ACCESS_MODES.PAID_ONCE,
        ITEM_BINDING_MODES.ACCOUNT,
        Number.MAX_SAFE_INTEGER + 1,
      ),
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_UNSAFE_INTEGER',
  );
  await assert.rejects(
    buildMakerComposableV6ItemEntitlementPlan({
      runtime: runtime(),
      context: context(),
      product: product(ITEM_ACCESS_MODES.PAID_ONCE, ITEM_BINDING_MODES.ACCOUNT, '0'),
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_UNSAFE_INTEGER',
  );
  await assert.rejects(
    buildMakerComposableV6ItemEntitlementPlan({
      runtime: runtime(),
      context: context(),
      product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.ACCOUNT, '1'),
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_FREE_PRICE_MISMATCH',
  );
});

test('Owned free claim is wallet-bound and requires an OwnedItem readback', async () => {
  const plan = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context(),
    product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.OWNED),
  });
  assert.equal(plan.operation, MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.CLAIM_OWNED_ITEM);
  assert.match(plan.action.calls[0].target, /::composition_v6::claim_free_wallet_item_v6$/);
  assert.deepEqual(plan.action.calls[0].outputs, []);
  assert.equal(plan.action.expectedReadback.ownedInstanceRequired, true);
});

test('Embedded and unknown future access semantics are never converted into a Player write', async () => {
  await assert.rejects(
    buildMakerComposableV6ItemEntitlementPlan({
      runtime: runtime(),
      context: context(),
      product: product(ITEM_ACCESS_MODES.EMBEDDED, ITEM_BINDING_MODES.EMBEDDED),
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_INVALID_ACCESS_MODE',
  );
  await assert.rejects(
    buildMakerComposableV6ItemEntitlementPlan({
      runtime: runtime(),
      context: context(),
      product: product('RENTAL', ITEM_BINDING_MODES.ACCOUNT),
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_INVALID_ACCESS_MODE',
  );
});

test('the generic builder rejects a requested operation that contradicts Product policy', async () => {
  await assert.rejects(
    buildMakerComposableV6PlayerActionPlan({
      operation: MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.PURCHASE_ACCOUNT_ITEM,
      runtime: runtime(),
      context: context(),
      product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.ACCOUNT),
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_OPERATION_MISMATCH',
  );
});

test('Owned lock and unlock both route through Soulidity current-owner proof wrappers', async () => {
  const lock = await buildMakerComposableV6OwnedLockPlan({
    runtime: runtime(),
    context: context(),
    locked: true,
  });
  const unlock = await buildMakerComposableV6OwnedLockPlan({
    runtime: runtime(),
    context: context(),
    locked: false,
  });
  assert.equal(lock.operation, MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.LOCK_OWNED_ITEM);
  assert.equal(unlock.operation, MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.UNLOCK_OWNED_ITEM);
  assert.match(lock.action.calls[0].target, /::lock_owned_item_to_soul_v6$/);
  assert.match(unlock.action.calls[0].target, /::unlock_owned_item_from_soul_v6$/);
  assert.equal(lock.action.calls[0].inputs.item.mutability, 'MUTABLE_OWNED');
  assert.equal(lock.action.policy.ownedCustodyPreserved, true);
});

test('Soul actions reject any proof type other than Soulidity exact TypeOrigin', async () => {
  await assert.rejects(
    buildMakerComposableV6OwnedLockPlan({
      runtime: runtime({
        compositionV6SoulOwnerProofType:
          '0xb3::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6',
      }),
      context: context(),
      locked: true,
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_PROOF_TYPE_MISMATCH',
  );
});

test('initial appearance creates selections, authorizes and consumes in one atomic PTB', async () => {
  const selections = [
    {
      productId: '0xe1',
      slotKey: 'body',
      bindingMode: ITEM_BINDING_MODES.EMBEDDED,
    },
    {
      productId: '0xe2',
      slotKey: 'hair',
      bindingMode: ITEM_BINDING_MODES.OWNED,
      ownedInstanceId: '0xe3',
    },
  ];
  const plan = await buildMakerComposableV6AppearancePlan({
    runtime: runtime(),
    context: context(),
    kind: 'INITIAL',
    clientNonce: HASH_A,
    selections,
  });
  assert.equal(
    plan.operation,
    MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_INITIAL_APPEARANCE,
  );
  assert.equal(plan.action.atomic, true);
  assert.equal(plan.action.calls.length, 4);
  assert.match(plan.action.calls[0].target, /::composition_v6::new_loadout_selection_v6$/);
  assert.match(plan.action.calls[2].target, /::authorize_initial_appearance_v6$/);
  assert.match(plan.action.calls[3].target, /::bind_initial_appearance_v6$/);
  assert.deepEqual(
    plan.action.calls[3].inputs.authorization,
    { kind: 'RESULT', callId: 'appearance.authorize-initial', output: 0 },
  );
  assert.equal(plan.action.policy.authorizationLifetime, 'SAME_PTB_ONLY');
  assert.equal(plan.action.policy.walletBoundCount, 1);
  assert.equal(plan.binding.selections[1].ownedInstanceId, '0xe3');
  assert.equal(plan.context.loadoutHash, await hashMakerComposableV6LoadoutSelections(selections));
});

test('appearance planning rejects a caller-supplied hash that differs from exact BCS selections', async () => {
  await assert.rejects(
    buildMakerComposableV6AppearancePlan({
      runtime: runtime(),
      context: context(),
      kind: 'INITIAL',
      clientNonce: HASH_A,
      loadoutHash: 'ff'.repeat(32),
      selections: [
        { productId: '0xe1', slotKey: 'body', bindingMode: ITEM_BINDING_MODES.EMBEDDED },
      ],
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_LOADOUT_HASH_MISMATCH',
  );
});

test('appearance selection validation rejects duplicate slots and Owned without an instance', async () => {
  await assert.rejects(
    buildMakerComposableV6AppearancePlan({
      runtime: runtime(),
      context: context(),
      kind: 'INITIAL',
      clientNonce: HASH_A,
      selections: [
        { productId: '0xe1', slotKey: 'body', bindingMode: ITEM_BINDING_MODES.ACCOUNT },
        { productId: '0xe2', slotKey: 'body', bindingMode: ITEM_BINDING_MODES.SOUL_BOUND },
      ],
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_DUPLICATE_SLOT',
  );
  await assert.rejects(
    buildMakerComposableV6AppearancePlan({
      runtime: runtime(),
      context: context(),
      kind: 'INITIAL',
      clientNonce: HASH_A,
      selections: [
        { productId: '0xe1', slotKey: 'body', bindingMode: ITEM_BINDING_MODES.OWNED },
      ],
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_INVALID_OBJECT_ID',
  );
});

test('appearance update locks exact revision and expects protocol-computed +1 readback', async () => {
  const plan = await buildMakerComposableV6AppearancePlan({
    runtime: runtime(),
    context: context({ expectedRevision: '9007199254740993' }),
    kind: 'UPDATE',
    clientNonce: HASH_A,
    selections: [
      { productId: '0xe1', slotKey: 'body', bindingMode: ITEM_BINDING_MODES.SOUL_BOUND },
    ],
  });
  assert.equal(
    plan.operation,
    MAKER_COMPOSABLE_PLAYER_V6_OPERATIONS.AUTHORIZE_APPEARANCE_UPDATE,
  );
  assert.match(plan.action.calls[1].target, /::authorize_appearance_update_v6$/);
  assert.match(plan.action.calls[2].target, /::apply_authorized_appearance_update_v6$/);
  assert.equal(plan.action.expectedReadback.previousRevision, '9007199254740993');
  assert.equal(plan.action.expectedReadback.revision, '9007199254740994');
});

test('checkpoint is plan-bound, serializable and only resolves under the complete active tuple', async () => {
  const plan = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context(),
    product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.ACCOUNT),
  });
  let saved = await checkpoint(plan);
  const restored = await hydrateMakerComposableV6PlayerCheckpoint(
    JSON.parse(serializeMakerComposableV6PlayerCheckpoint(saved)),
    { plan },
  );
  assert.equal(restored.status, MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.PENDING);

  await assert.rejects(
    nextMakerComposableV6PlayerAction({
      checkpoint: saved,
      plan,
      runtime: activeRuntime({ compositionRegistryV6Id: '0xff' }),
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_RUNTIME_SCOPE_MISMATCH',
  );
  saved = await beginMakerComposableV6PlayerAction({
    checkpoint: saved,
    plan,
    runtime: activeRuntime(),
    now: '2026-07-31T00:00:01.000Z',
  });
  assert.equal(saved.status, MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.INTENT);
  const action = await nextMakerComposableV6PlayerAction({
    checkpoint: saved,
    plan,
    runtime: activeRuntime(),
  });
  assert.equal(action.authority.signer, IDS.wallet);
  assert.equal(action.intentKey, saved.intentKey);

  saved = await markMakerComposableV6PlayerSubmitted({
    checkpoint: saved,
    plan,
    submission: { transactionDigest: 'digest-1' },
    now: '2026-07-31T00:00:02.000Z',
  });
  saved = await confirmMakerComposableV6PlayerAction({
    checkpoint: saved,
    plan,
    confirmation: {
      transactionDigest: 'digest-1',
      readbackVerified: true,
      entitlementExists: true,
      profileId: IDS.profile,
      productId: IDS.product,
      subjectId: IDS.wallet,
      paidAtomic: '0',
    },
    now: '2026-07-31T00:00:03.000Z',
  });
  assert.equal(saved.status, MAKER_COMPOSABLE_PLAYER_V6_ACTION_STATUS.CONFIRMED);
  assert.equal(saved.completed, true);
  assert.equal(await nextMakerComposableV6PlayerAction({
    checkpoint: saved,
    plan,
    runtime: activeRuntime(),
  }), null);
});

test('Owned, lock and appearance confirmations require operation-specific readback', async () => {
  const ownedPlan = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context(),
    product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.OWNED),
  });
  let saved = await checkpoint(ownedPlan);
  saved = await beginMakerComposableV6PlayerAction({
    checkpoint: saved,
    plan: ownedPlan,
    runtime: activeRuntime(),
  });
  await assert.rejects(
    confirmMakerComposableV6PlayerAction({
      checkpoint: saved,
      plan: ownedPlan,
      confirmation: {
        transactionDigest: 'digest-owned',
        readbackVerified: true,
        entitlementExists: true,
        profileId: IDS.profile,
        productId: IDS.product,
        subjectId: IDS.wallet,
        paidAtomic: '0',
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_OWNED_INSTANCE_REQUIRED',
  );

  const lockPlan = await buildMakerComposableV6OwnedLockPlan({
    runtime: runtime(),
    context: context(),
    locked: true,
  });
  saved = await checkpoint(lockPlan);
  saved = await beginMakerComposableV6PlayerAction({
    checkpoint: saved,
    plan: lockPlan,
    runtime: activeRuntime(),
  });
  await assert.rejects(
    confirmMakerComposableV6PlayerAction({
      checkpoint: saved,
      plan: lockPlan,
      confirmation: {
        transactionDigest: 'digest-lock',
        readbackVerified: true,
        locked: false,
        lockReadbackVerified: true,
        ownedItemId: IDS.ownedItem,
        soulId: IDS.soul,
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_LOCK_READBACK_REQUIRED',
  );
});

test('a checkpoint cannot be restored against a changed wallet or Product plan', async () => {
  const first = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context(),
    product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.ACCOUNT),
  });
  const second = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context({ productId: '0xee' }),
    product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.ACCOUNT),
  });
  const saved = await checkpoint(first);
  await assert.rejects(
    hydrateMakerComposableV6PlayerCheckpoint(saved, { plan: second }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_CHECKPOINT_SCOPE_MISMATCH',
  );
});

test('plan target tampering and confirmation digest substitution are rejected', async () => {
  const plan = await buildMakerComposableV6ItemEntitlementPlan({
    runtime: runtime(),
    context: context(),
    product: product(ITEM_ACCESS_MODES.FREE_CLAIM, ITEM_BINDING_MODES.ACCOUNT),
  });
  let saved = await checkpoint(plan);
  const tampered = structuredClone(plan);
  tampered.action.calls[0].target = '0xff::malicious::claim';
  await assert.rejects(
    hydrateMakerComposableV6PlayerCheckpoint(saved, { plan: tampered }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_PLAN_IDENTITY_MISMATCH',
  );

  saved = await beginMakerComposableV6PlayerAction({
    checkpoint: saved,
    plan,
    runtime: activeRuntime(),
  });
  saved = await markMakerComposableV6PlayerSubmitted({
    checkpoint: saved,
    plan,
    submission: { transactionDigest: 'exact-digest' },
  });
  await assert.rejects(
    confirmMakerComposableV6PlayerAction({
      checkpoint: saved,
      plan,
      confirmation: {
        transactionDigest: 'substituted-digest',
        readbackVerified: true,
        entitlementExists: true,
        profileId: IDS.profile,
        productId: IDS.product,
        subjectId: IDS.wallet,
        paidAtomic: '0',
      },
    }),
    (failure) => failure.code === 'COMPOSABLE_PLAYER_V6_TRANSACTION_DIGEST_MISMATCH',
  );
});

test('every Player target name exists on a repository-local audited Move interface', async () => {
  const animacraft = await readFile(
    new URL('../move/animacraft/sources/composition_v6.move', import.meta.url),
    'utf8',
  );
  const soulidityInterface = JSON.parse(
    await readFile(
      new URL('./fixtures/soulidity-composable-v6-interface.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    soulidityInterface.schema,
    'animacraft.soulidity-composable-v6-interface.v1',
  );
  assert.equal(soulidityInterface.contractVersion, 1);
  assert.equal(soulidityInterface.repository, 'redefine-digital-labs/soulidity');
  assert.match(soulidityInterface.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(
    soulidityInterface.sourcePath,
    'move/soulidity/sources/animacraft_appearance_adapter_v6.move',
  );
  assert.equal(soulidityInterface.module, 'animacraft_appearance_adapter_v6');
  const direct = [
    MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.CLAIM_FREE_WALLET_ITEM,
    MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.PURCHASE_WALLET_ITEM,
    MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS.NEW_LOADOUT_SELECTION,
  ];
  const wrapped = Object.values(MAKER_COMPOSABLE_PLAYER_V6_MOVE_FUNCTIONS)
    .filter((name) => !direct.includes(name));
  direct.forEach((name) => assert.match(animacraft, new RegExp(`public fun ${name}(?:<|\\()`)));
  assert.equal(
    new Set(soulidityInterface.requiredPlayerFunctions).size,
    soulidityInterface.requiredPlayerFunctions.length,
  );
  assert.deepEqual(
    [...soulidityInterface.requiredPlayerFunctions].sort(),
    [...wrapped].sort(),
  );
});
