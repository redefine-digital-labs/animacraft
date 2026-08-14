import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_COMMERCE_V8_SCHEMA,
  MAKER_V8_ACCESS_MODES,
  MAKER_V8_COMPLETE_MODES,
  MAKER_V8_LIFECYCLES,
  MAKER_V8_PACK_ACCESS_MODES,
  MakerV8CommerceValidationError,
  assertMakerV8Commerce,
  canTransitionMakerV8Lifecycle,
  canonicalMakerV8Commerce,
  collectMakerV8CommerceIssues,
  createMakerV8Commerce,
  quoteMakerV8Access,
  quoteMakerV8Complete,
  quoteMakerV8Pack,
} from '../maker-commerce-v8.js';

test('fresh commerce v8 is exact, immutable, and never accepts v5 input', () => {
  const commerce = createMakerV8Commerce({ rightsOriginConfirmed: true });
  assert.equal(commerce.schemaVersion, MAKER_COMMERCE_V8_SCHEMA);
  assert.equal(Object.isFrozen(commerce), true);
  assert.equal(Object.isFrozen(commerce.makerAccess), true);
  assert.equal(collectMakerV8CommerceIssues(commerce, { publish: true }).length, 0);

  const legacy = { ...commerce, schemaVersion: 'animacraft.maker-commerce.v5' };
  assert.throws(
    () => assertMakerV8Commerce(legacy, { publish: true }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_COMMERCE_SCHEMA_INVALID',
  );
});

test('activation requires explicit rights confirmation and one exact policy per Pack', () => {
  const draft = createMakerV8Commerce({
    packPolicies: [{
      packId: 'quiet-orbit',
      accessMode: MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 2_000_000,
    }],
  });
  const issues = collectMakerV8CommerceIssues(draft, {
    packIds: ['quiet-orbit', 'neon-sky'],
    publish: true,
  });
  assert.deepEqual(
    issues.map((entry) => entry.code),
    ['MAKER_V8_RIGHTS_CONFIRMATION_REQUIRED', 'MAKER_V8_PACK_POLICY_REQUIRED'],
  );

  const canonical = canonicalMakerV8Commerce(createMakerV8Commerce({
    rightsOriginConfirmed: true,
    packPolicies: [
      { packId: 'neon-sky', accessMode: MAKER_V8_PACK_ACCESS_MODES.FREE },
      { packId: 'quiet-orbit', accessMode: MAKER_V8_PACK_ACCESS_MODES.INCLUDED_WITH_MAKER },
    ],
  }), {
    packIds: ['quiet-orbit', 'neon-sky'],
    publish: true,
  });
  assert.deepEqual(canonical.packPolicies.map((entry) => entry.packId), [
    'neon-sky',
    'quiet-orbit',
  ]);
});

test('Maker, Pack, and Complete quotes use the same native v8 commerce record', () => {
  const commerce = createMakerV8Commerce({
    rightsOriginConfirmed: true,
    makerAccess: {
      mode: MAKER_V8_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 10_000,
    },
    baseCompletion: {
      mode: MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 1,
      priceAtomic: 5_000,
    },
    packPolicies: [{
      packId: 'quiet-orbit',
      accessMode: MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 20_000,
      completion: {
        mode: MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME,
        priceAtomic: 7_000,
      },
    }],
  });
  const protocol = { primaryContentFeeBps: 1_000, fixedCompleteFeeAtomic: 100 };

  assert.deepEqual(quoteMakerV8Access(commerce, { protocol }), {
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    grossAtomic: 10_000,
    protocolAtomic: 1_000,
    makerAtomic: 9_000,
  });
  assert.deepEqual(quoteMakerV8Pack(commerce, 'quiet-orbit', { protocol }), {
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    grossAtomic: 20_000,
    protocolAtomic: 2_000,
    makerAtomic: 18_000,
  });

  const blocked = quoteMakerV8Complete(commerce, {
    usedPackIds: ['quiet-orbit'],
    walletBaseCount: 1,
    protocol,
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.reason, 'MAKER_ACCESS_REQUIRED');
  assert.deepEqual(blocked.missingEntitlements, ['quiet-orbit']);

  const ready = quoteMakerV8Complete(commerce, {
    usedPackIds: ['quiet-orbit'],
    ownsMakerAccess: true,
    ownedPackIds: ['quiet-orbit'],
    walletBaseCount: 1,
    protocol,
  });
  assert.equal(ready.valid, true);
  assert.equal(ready.contentAtomic, 12_000);
  assert.equal(ready.protocolAtomic, 1_300);
  assert.equal(ready.makerAtomic, 10_800);
  assert.equal(ready.grossAtomic, 12_100);
});

test('Maker v8 lifecycle has no legacy sale or archive restore state', () => {
  assert.equal(canTransitionMakerV8Lifecycle(
    MAKER_V8_LIFECYCLES.DRAFT,
    MAKER_V8_LIFECYCLES.ACTIVE,
  ), true);
  assert.equal(canTransitionMakerV8Lifecycle(
    MAKER_V8_LIFECYCLES.ACTIVE,
    MAKER_V8_LIFECYCLES.PAUSED,
  ), true);
  assert.equal(canTransitionMakerV8Lifecycle(
    MAKER_V8_LIFECYCLES.PAUSED,
    MAKER_V8_LIFECYCLES.ACTIVE,
  ), true);
  assert.equal(canTransitionMakerV8Lifecycle(
    MAKER_V8_LIFECYCLES.ARCHIVED,
    MAKER_V8_LIFECYCLES.ACTIVE,
  ), false);
  assert.equal('SALE_PENDING' in MAKER_V8_LIFECYCLES, false);
});
