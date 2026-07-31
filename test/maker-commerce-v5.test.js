import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETION_MODES,
  DEFAULT_PROTOCOL_COMMERCE_V5,
  MAKER_ACCESS_MODES,
  ONCHAIN_MAKER_STATES,
  PACK_ACCESS_MODES,
  RIGHTS_ORIGINS,
  canTransitionMakerStateV5,
  collectMakerCommerceV5Issues,
  createDefaultMakerCommerceV5,
  createPackCommercePolicyV5,
  makerCommerceV5RequiresRelease,
  normalizeMakerCommerceV5,
  quoteCompleteV5,
  quoteMakerPurchaseV5,
  quotePackPurchaseV5,
  recipeUsedPackIds,
} from '../maker-commerce-v5.js';

function makerWithPacks() {
  return {
    expansionPacks: [
      { id: 'wardrobe-plus' },
      { id: 'moon-effects' },
    ],
    extensions: {
      expansionDrafts: [
        { packId: 'wardrobe-plus' },
        { packId: 'moon-effects' },
      ],
    },
    parts: [{
      id: 'outfit',
      items: [
        { id: 'base-shirt' },
        { id: 'pack-coat', expansionPackId: 'wardrobe-plus' },
      ],
    }, {
      id: 'effect',
      items: [
        { id: 'moon-one', expansionPackId: 'moon-effects' },
        { id: 'moon-two', expansionPackId: 'moon-effects' },
      ],
    }],
  };
}

test('missing rights metadata defaults to license-wrapped and remains unconfirmed', () => {
  const commerce = createDefaultMakerCommerceV5();
  assert.equal(commerce.rightsOrigin, RIGHTS_ORIGINS.LICENSE_WRAPPED);
  assert.equal(commerce.rightsOriginConfirmed, false);
  assert.equal(commerce.makerAccess.mode, MAKER_ACCESS_MODES.FREE);
  assert.equal(commerce.baseCompletion.mode, COMPLETION_MODES.UNLIMITED_FREE);
  assert.equal(commerce.baseCompletion.priceAtomic, 0);
  assert.equal(commerce.soulCreatorRoyaltyBps, 250);
  assert.equal(commerce.makerSourceRoyaltyBps, 250);
  assert.equal(commerce.makerResaleRoyaltyBps, 500);
});

test('release requirement distinguishes untouched legacy defaults from v5 commerce', () => {
  assert.equal(makerCommerceV5RequiresRelease(createDefaultMakerCommerceV5()), false);
  assert.equal(makerCommerceV5RequiresRelease(createDefaultMakerCommerceV5({
    rightsOriginConfirmed: true,
  })), true);
  assert.equal(makerCommerceV5RequiresRelease(createDefaultMakerCommerceV5({
    makerAccess: {
      mode: MAKER_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 1_000_000,
    },
  })), true);
  assert.equal(makerCommerceV5RequiresRelease(createDefaultMakerCommerceV5({
    baseCompletion: {
      mode: COMPLETION_MODES.FREE_QUOTA_THEN_BLOCK,
      freeQuotaPerWallet: 2,
    },
  })), true);
  assert.equal(makerCommerceV5RequiresRelease(createDefaultMakerCommerceV5(), {
    packIds: ['paid-hair'],
  }), true);
  assert.equal(makerCommerceV5RequiresRelease(createDefaultMakerCommerceV5({
    makerSourceRoyaltyBps: 0,
  })), true);
});

test('first Commerce v5 publication requires an explicit rights-origin confirmation', () => {
  const commerce = normalizeMakerCommerceV5({});
  assert.equal(
    collectMakerCommerceV5Issues(commerce, { publish: false })
      .some((issue) => issue.code === 'rights_origin_confirmation_required'),
    false,
  );
  assert.equal(
    collectMakerCommerceV5Issues(commerce, { publish: true })
      .some((issue) => issue.code === 'rights_origin_confirmation_required'),
    true,
  );

  commerce.rightsOrigin = RIGHTS_ORIGINS.ONCHAIN_NATIVE;
  commerce.rightsOriginConfirmed = true;
  assert.equal(
    collectMakerCommerceV5Issues(commerce, { publish: true })
      .some((issue) => issue.code === 'rights_origin_confirmation_required'),
    false,
  );

  commerce.rightsOriginConfirmed = 'yes';
  assert.equal(
    collectMakerCommerceV5Issues(commerce, { publish: false })
      .some((issue) => issue.code === 'invalid_rights_origin_confirmation'),
    true,
  );
  commerce.rightsOriginConfirmed = true;
});

test('a paid Maker access pass is one-time and split 90/10', () => {
  const commerce = createDefaultMakerCommerceV5({
    makerAccess: {
      mode: MAKER_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 10_000_000,
    },
  });
  assert.deepEqual(quoteMakerPurchaseV5(commerce), {
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    grossAtomic: 10_000_000,
    protocolAtomic: 1_000_000,
    makerAtomic: 9_000_000,
  });
  assert.equal(quoteMakerPurchaseV5(commerce, {
    ownsMakerAccess: true,
  }).reason, 'ALREADY_OWNED');
});

test('normalization creates one independent policy for every declared Pack', () => {
  const normalized = normalizeMakerCommerceV5({
    rightsOrigin: RIGHTS_ORIGINS.LICENSE_WRAPPED,
    packPolicies: [{
      packId: 'wardrobe-plus',
      accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 6_000_000,
      completion: { mode: COMPLETION_MODES.UNLIMITED_FREE },
    }],
  }, {
    packIds: ['wardrobe-plus', 'moon-effects'],
  });
  assert.equal(normalized.rightsOrigin, RIGHTS_ORIGINS.LICENSE_WRAPPED);
  assert.deepEqual(normalized.packPolicies.map((entry) => entry.packId), [
    'wardrobe-plus',
    'moon-effects',
  ]);
  assert.equal(normalized.packPolicies[0].purchasePriceAtomic, 6_000_000);
  assert.equal(normalized.packPolicies[1].accessMode, PACK_ACCESS_MODES.FREE);
  normalized.packPolicies[1].completion.mode = COMPLETION_MODES.PAID_EVERY_TIME;
  assert.equal(normalized.packPolicies[0].completion.mode, COMPLETION_MODES.UNLIMITED_FREE);
});

test('publication requires an exact on-chain policy for every Pack', () => {
  const commerce = createDefaultMakerCommerceV5();
  const issues = collectMakerCommerceV5Issues(commerce, {
    packIds: ['wardrobe-plus'],
    publish: true,
  });
  assert.ok(issues.some((issue) => issue.code === 'missing_pack_policy'));
});

test('invalid paid and quota policy combinations fail closed', () => {
  const commerce = createDefaultMakerCommerceV5({
    baseCompletion: {
      mode: COMPLETION_MODES.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 2,
      priceAtomic: 2_000_000,
    },
  });
  commerce.baseCompletion.priceAtomic = 0;
  assert.ok(collectMakerCommerceV5Issues(commerce)
    .some((issue) => issue.code === 'invalid_complete_price'));
  commerce.baseCompletion.priceAtomic = 2_000_000;
  commerce.baseCompletion.freeQuotaPerWallet = 0;
  assert.ok(collectMakerCommerceV5Issues(commerce)
    .some((issue) => issue.code === 'invalid_complete_quota'));
});

test('a one-time Pack purchase splits creator price 90/10 and never charges an owned Pack twice', () => {
  const commerce = createDefaultMakerCommerceV5();
  commerce.packPolicies = [createPackCommercePolicyV5('wardrobe-plus', {
    accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
    purchasePriceAtomic: 6_000_000,
  })];
  assert.deepEqual(
    quotePackPurchaseV5(commerce, 'wardrobe-plus'),
    {
      valid: true,
      reason: 'PURCHASE_REQUIRED',
      grossAtomic: 6_000_000,
      protocolAtomic: 600_000,
      makerAtomic: 5_400_000,
    },
  );
  assert.equal(
    quotePackPurchaseV5(commerce, 'wardrobe-plus', {
      ownedPackIds: ['wardrobe-plus'],
    }).reason,
    'ALREADY_OWNED',
  );
});

test('recipe derives unique Pack usage from selected Items instead of trusting caller input', () => {
  const maker = makerWithPacks();
  const recipe = {
    selections: [
      { partId: 'outfit', itemId: 'pack-coat' },
      { partId: 'effect', itemId: 'moon-two' },
    ],
  };
  assert.deepEqual(recipeUsedPackIds(maker, recipe), [
    'moon-effects',
    'wardrobe-plus',
  ]);
});

test('recipe derives Pack usage from a Pack Style added to a Base Item', () => {
  const maker = makerWithPacks();
  maker.parts[0].items[0].styles = [
    { id: 'base-style' },
    { id: 'pack-style', expansionPackId: 'wardrobe-plus' },
  ];
  assert.deepEqual(recipeUsedPackIds(maker, {
    selections: [{
      partId: 'outfit',
      itemId: 'base-shirt',
      styleId: 'pack-style',
    }],
  }), ['wardrobe-plus']);
});

test('recipe retains both Item and selected Style Pack provenance', () => {
  const maker = makerWithPacks();
  maker.parts[0].items[1].styles = [{
    id: 'moon-trim',
    expansionPackId: 'moon-effects',
  }];
  assert.deepEqual(recipeUsedPackIds(maker, {
    selections: [{
      partId: 'outfit',
      itemId: 'pack-coat',
      styleId: 'moon-trim',
    }],
  }), [
    'moon-effects',
    'wardrobe-plus',
  ]);
});

test('Complete fails closed when the whole Maker requires an unowned access pass', () => {
  const maker = makerWithPacks();
  maker.commerce = createDefaultMakerCommerceV5({
    makerAccess: {
      mode: MAKER_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 10_000_000,
    },
  });
  maker.commerce.packPolicies = [
    createPackCommercePolicyV5('wardrobe-plus'),
    createPackCommercePolicyV5('moon-effects'),
  ];
  const blocked = quoteCompleteV5(maker, { selections: [] });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.reason, 'MAKER_ACCESS_REQUIRED');
  assert.equal(quoteCompleteV5(maker, { selections: [] }, {
    ownsMakerAccess: true,
  }).valid, true);
});

test('Complete charges Base and each used Pack at most once plus one fixed protocol fee', () => {
  const maker = makerWithPacks();
  maker.commerce = createDefaultMakerCommerceV5({
    baseCompletion: {
      mode: COMPLETION_MODES.PAID_EVERY_TIME,
      priceAtomic: 1_000_000,
    },
  });
  maker.commerce.packPolicies = [
    createPackCommercePolicyV5('wardrobe-plus', {
      accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 6_000_000,
      completion: {
        mode: COMPLETION_MODES.PAID_EVERY_TIME,
        priceAtomic: 2_000_000,
      },
    }),
    createPackCommercePolicyV5('moon-effects', {
      accessMode: PACK_ACCESS_MODES.FREE,
      completion: {
        mode: COMPLETION_MODES.PAID_EVERY_TIME,
        priceAtomic: 3_000_000,
      },
    }),
  ];
  const quote = quoteCompleteV5(maker, {
    selections: [
      { partId: 'outfit', itemId: 'pack-coat' },
      { partId: 'effect', itemId: 'moon-two' },
    ],
  }, {
    ownedPackIds: ['wardrobe-plus'],
    protocol: {
      ...DEFAULT_PROTOCOL_COMMERCE_V5,
      enabled: true,
      fixedCompleteFeeAtomic: 100_000,
    },
  });
  assert.equal(quote.valid, true);
  assert.equal(quote.contentAtomic, 6_000_000);
  assert.equal(quote.fixedProtocolAtomic, 100_000);
  assert.equal(quote.protocolContentAtomic, 600_000);
  assert.equal(quote.protocolAtomic, 700_000);
  assert.equal(quote.makerAtomic, 5_400_000);
  assert.equal(quote.grossAtomic, 6_100_000);
  assert.equal(quote.lineItems.filter((line) => line.scope === 'pack').length, 2);
});

test('Complete blocks paid Pack content without wallet entitlement', () => {
  const maker = makerWithPacks();
  maker.commerce = createDefaultMakerCommerceV5();
  maker.commerce.packPolicies = [
    createPackCommercePolicyV5('wardrobe-plus', {
      accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 6_000_000,
    }),
    createPackCommercePolicyV5('moon-effects'),
  ];
  const quote = quoteCompleteV5(maker, {
    selections: [{ partId: 'outfit', itemId: 'pack-coat' }],
  });
  assert.equal(quote.valid, false);
  assert.equal(quote.reason, 'PACK_ACCESS_REQUIRED');
  assert.deepEqual(quote.missingEntitlements, ['wardrobe-plus']);
});

test('free quota counts per wallet, then charges or blocks according to the selected policy', () => {
  const maker = makerWithPacks();
  maker.commerce = createDefaultMakerCommerceV5({
    baseCompletion: {
      mode: COMPLETION_MODES.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 2,
      priceAtomic: 1_500_000,
    },
  });
  maker.commerce.packPolicies = [
    createPackCommercePolicyV5('wardrobe-plus'),
    createPackCommercePolicyV5('moon-effects'),
  ];
  const free = quoteCompleteV5(maker, { selections: [] }, { walletBaseCount: 1 });
  const paid = quoteCompleteV5(maker, { selections: [] }, { walletBaseCount: 2 });
  assert.equal(free.contentAtomic, 0);
  assert.equal(paid.contentAtomic, 1_500_000);

  maker.commerce.baseCompletion = {
    mode: COMPLETION_MODES.FREE_QUOTA_THEN_BLOCK,
    freeQuotaPerWallet: 1,
    priceAtomic: 0,
    totalCap: null,
  };
  const blocked = quoteCompleteV5(maker, { selections: [] }, { walletBaseCount: 1 });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.reason, 'FREE_QUOTA_EXHAUSTED');
});

test('Maker sale state machine allows only reversible reviewed transitions', () => {
  assert.equal(
    canTransitionMakerStateV5(ONCHAIN_MAKER_STATES.ACTIVE, ONCHAIN_MAKER_STATES.PAUSED),
    true,
  );
  assert.equal(
    canTransitionMakerStateV5(ONCHAIN_MAKER_STATES.ACTIVE, ONCHAIN_MAKER_STATES.SALE_PENDING),
    false,
  );
  assert.equal(
    canTransitionMakerStateV5(ONCHAIN_MAKER_STATES.PAUSED, ONCHAIN_MAKER_STATES.SALE_PENDING),
    true,
  );
  assert.equal(
    canTransitionMakerStateV5(ONCHAIN_MAKER_STATES.SALE_PENDING, ONCHAIN_MAKER_STATES.ACTIVE),
    false,
  );
  assert.equal(
    canTransitionMakerStateV5(ONCHAIN_MAKER_STATES.ARCHIVED, ONCHAIN_MAKER_STATES.PAUSED),
    true,
  );
});
