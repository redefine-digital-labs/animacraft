import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMERCE_V5_ACCESS,
  COMMERCE_V5_COMPLETE_POLICY,
  COMMERCE_V5_RIGHTS,
  COMMERCE_V5_STYLE_ROW,
} from '../chain-commerce-v5.js';
import { buildMakerCommerceV5DeploymentPlan } from '../maker-commerce-chain-v5.js';

function projection() {
  return {
    commerce: {
      rightsOrigin: 'LICENSE_WRAPPED',
      rightsOriginConfirmed: true,
      logicalAuxiliaryBlobId: 'canonical-logical-blob',
      makerAccess: {
        mode: 'ONE_TIME_PAID',
        purchasePriceAtomic: 5_000_000,
      },
      baseCompletion: {
        mode: 'FREE_QUOTA_THEN_PAID',
        freeQuotaPerWallet: 2,
        priceAtomic: 1_000_000,
        totalCap: 100,
      },
      packPolicies: [{
        packId: 'premium',
        label: 'Premium wardrobe',
        accessMode: 'ONE_TIME_PAID',
        purchasePriceAtomic: 6_000_000,
        completion: {
          mode: 'UNLIMITED_FREE',
          freeQuotaPerWallet: 0,
          priceAtomic: 0,
          totalCap: null,
        },
      }],
      royalties: { soulCreatorBps: 250, makerResaleBps: 500 },
      styleProducts: [
        {
          partKey: 'body',
          itemKey: 'base',
          styleKey: 'default',
          packId: null,
          rowKind: 'VISUAL',
        },
        {
          partKey: 'hair',
          itemKey: 'long',
          styleKey: 'blue',
          packId: 'premium',
          rowKind: 'VISUAL',
        },
      ],
      counts: { packs: 1, styles: 2 },
    },
  };
}

test('converts an immutable commerce projection into exact v5 chain arguments', () => {
  const plan = buildMakerCommerceV5DeploymentPlan(projection());
  assert.equal(plan.rightsOrigin, COMMERCE_V5_RIGHTS.LICENSE_WRAPPED);
  assert.equal(plan.logicalAuxiliaryBlobId, 'canonical-logical-blob');
  assert.deepEqual(plan.migration, {
    rightsOrigin: COMMERCE_V5_RIGHTS.LICENSE_WRAPPED,
    baseCompletePolicy: {
      mode: COMMERCE_V5_COMPLETE_POLICY.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 2n,
      priceAtomic: 1_000_000n,
      totalCap: 100n,
    },
    soulCreatorRoyaltyBps: 250,
    makerResaleRoyaltyBps: 500,
  });
  assert.equal(plan.configuration.baseAccess.kind, COMMERCE_V5_ACCESS.PAID_ONCE);
  assert.equal(plan.configuration.baseAccess.purchasePriceAtomic, 5_000_000n);
  assert.equal(plan.configuration.packs[0].access.kind, COMMERCE_V5_ACCESS.PAID_ONCE);
  assert.equal(plan.configuration.packs[0].completePolicy.totalCap, 0n);
  assert.deepEqual(plan.configuration.styleBindings[1], {
    partKey: 'hair',
    itemKey: 'long',
    styleKey: 'blue',
    rowKind: COMMERCE_V5_STYLE_ROW.VISUAL,
    packKey: 'premium',
  });
  assert.equal(plan.configuration.sealStyleRegistry, true);
  assert.equal(plan.configuration.activate, true);
});

test('requires an explicit rights-origin acknowledgement before the first v5 migration', () => {
  const missing = projection();
  delete missing.commerce.rightsOriginConfirmed;
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(missing),
    (error) => error?.code === 'COMMERCE_V5_RIGHTS_CONFIRMATION_REQUIRED',
  );

  const unconfirmed = projection();
  unconfirmed.commerce.rightsOriginConfirmed = false;
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(unconfirmed),
    (error) => error?.code === 'COMMERCE_V5_RIGHTS_CONFIRMATION_REQUIRED',
  );
});

test('rejects an ambiguous or incomplete projected Style registry', () => {
  const value = projection();
  value.commerce.styleProducts.push({
    partKey: 'hair',
    itemKey: 'long',
    styleKey: 'blue',
    packId: null,
    rowKind: 'VISUAL',
  });
  value.commerce.counts.styles += 1;
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(value),
    (error) => error?.code === 'COMMERCE_V5_INVALID_STYLE_PROJECTION',
  );
});

test('rejects a caller-shaped logical row or missing canonical auxiliary Blob', () => {
  const missingAuxiliary = projection();
  delete missingAuxiliary.commerce.logicalAuxiliaryBlobId;
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(missingAuxiliary),
    (error) => error?.code === 'COMMERCE_V5_LOGICAL_AUXILIARY_MISSING',
  );

  const disguisedVisual = projection();
  disguisedVisual.commerce.styleProducts[0] = {
    ...disguisedVisual.commerce.styleProducts[0],
    styleKey: '__animacraft_none__',
    rowKind: 'VISUAL',
  };
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(disguisedVisual),
    (error) => error?.code === 'COMMERCE_V5_INVALID_STYLE_ROW_IDENTITY',
  );

  const logicalPack = projection();
  logicalPack.commerce.styleProducts[1] = {
    ...logicalPack.commerce.styleProducts[1],
    styleKey: '__animacraft_color__:blue',
    rowKind: 'LOGICAL_COLOR',
  };
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(logicalPack),
    (error) => error?.code === 'COMMERCE_V5_INVALID_STYLE_ROW_IDENTITY',
  );
});

test('rejects projection count drift before any wallet signature', () => {
  const value = projection();
  value.commerce.counts.styles = 99;
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(value),
    (error) => error?.code === 'COMMERCE_V5_PROJECTION_COUNT_MISMATCH',
  );
});

test('rejects access, Complete, and royalty values that Move would abort', () => {
  const freeWithPrice = projection();
  freeWithPrice.commerce.makerAccess = {
    mode: 'FREE',
    purchasePriceAtomic: 1,
  };
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(freeWithPrice),
    (error) => error?.code === 'COMMERCE_V5_INVALID_ACCESS_POLICY',
  );

  const invalidComplete = projection();
  invalidComplete.commerce.baseCompletion = {
    mode: 'PAID_EVERY_TIME',
    freeQuotaPerWallet: 1,
    priceAtomic: 1_000_000,
    totalCap: null,
  };
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(invalidComplete),
    (error) => error?.code === 'COMMERCE_V5_INVALID_COMPLETE_POLICY',
  );

  const invalidRoyalty = projection();
  invalidRoyalty.commerce.royalties.makerResaleBps = 425;
  assert.throws(
    () => buildMakerCommerceV5DeploymentPlan(invalidRoyalty),
    (error) => error?.code === 'COMMERCE_V5_INVALID_MAKER_ROYALTY',
  );
});
