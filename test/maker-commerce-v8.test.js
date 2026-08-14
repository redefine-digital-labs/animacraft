import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MAKER_COMMERCE_V8_SCHEMA,
  MAKER_PACK_COMMERCE_V8_SCHEMA,
  MAKER_V8_ACCESS_MODES,
  MAKER_V8_COMPLETE_MODES,
  MAKER_V8_LIFECYCLES,
  MAKER_V8_PACK_ACCESS_MODES,
  MAKER_V8_PACK_ENTITLEMENTS,
  MAKER_V8_RIGHTS_ORIGINS,
  MakerV8CommerceValidationError,
  assertMakerV8Commerce,
  assertMakerV8PackPolicy,
  canTransitionMakerV8Lifecycle,
  canonicalMakerV8Commerce,
  canonicalMakerV8PackPolicy,
  collectMakerV8CommerceIssues,
  collectMakerV8PackPolicyIssues,
  createMakerV8Commerce,
  createMakerV8PackPolicy,
  quoteMakerV8Access,
  quoteMakerV8Complete,
  quoteMakerV8Pack,
} from '../maker-commerce-v8.js';

const PROTOCOL_10_PERCENT = Object.freeze({
  primaryContentFeeBps: 1_000,
  fixedCompleteFeeAtomic: 100,
});

function makerCommerce(overrides = {}) {
  return createMakerV8Commerce({
    rightsOriginConfirmed: true,
    ...overrides,
  });
}

function paidComplete(priceAtomic, overrides = {}) {
  return {
    mode: MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME,
    freeQuotaPerWallet: 0,
    priceAtomic,
    totalCap: null,
    ...overrides,
  };
}

function packPolicy(packId, priceAtomic, overrides = {}) {
  return createMakerV8PackPolicy(packId, {
    accessMode: MAKER_V8_PACK_ACCESS_MODES.FREE,
    completion: paidComplete(priceAtomic),
    ...overrides,
  });
}

function packLine(policy, treasuryIdentity, overrides = {}) {
  return {
    packId: policy.packId,
    policy,
    entitlement: {
      kind: MAKER_V8_PACK_ENTITLEMENTS.PACK_ACCESS,
      verified: true,
    },
    lifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
    packTreasuryIdentity: treasuryIdentity,
    walletCompleteCount: 0,
    totalCompleteCount: 0,
    ...overrides,
  };
}

function completeInput(overrides = {}) {
  return {
    ownsMakerAccess: false,
    makerLifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
    makerTreasuryIdentity: 'maker-treasury',
    walletBaseCount: 0,
    totalBaseCount: 0,
    usedPackLines: [],
    ...overrides,
  };
}

function issueCodes(issues) {
  return issues.map((entry) => entry.code);
}

test('Base Maker commerce is an exact immutable record and never embeds Pack policy', () => {
  const commerce = makerCommerce();
  assert.equal(commerce.schemaVersion, MAKER_COMMERCE_V8_SCHEMA);
  assert.equal(commerce.rightsEvidence, null);
  assert.equal(Object.hasOwn(commerce, 'packPolicies'), false);
  assert.equal(Object.isFrozen(commerce), true);
  assert.equal(Object.isFrozen(commerce.makerAccess), true);
  assert.equal(collectMakerV8CommerceIssues(commerce, { publish: true }).length, 0);

  const embeddedPack = structuredClone(commerce);
  embeddedPack.packPolicies = [];
  assert.ok(issueCodes(collectMakerV8CommerceIssues(embeddedPack)).includes(
    'MAKER_V8_COMMERCE_FIELD_UNKNOWN',
  ));
  assert.throws(
    () => createMakerV8Commerce({ packPolicies: [] }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_INPUT_FIELD_UNKNOWN',
  );

  const legacy = { ...commerce, schemaVersion: 'animacraft.maker-commerce.v5' };
  assert.throws(
    () => assertMakerV8Commerce(legacy),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_COMMERCE_SCHEMA_INVALID',
  );
  assert.throws(
    () => assertMakerV8Commerce(commerce, { packIds: [] }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_OPTIONS_FIELD_UNKNOWN',
  );
});

test('rights evidence is semantic-only and exact for both rights modes', () => {
  const wrapped = makerCommerce({
    rightsOrigin: MAKER_V8_RIGHTS_ORIGINS.LICENSE_WRAPPED,
    rightsEvidence: {
      licensor: 'Example Licensor Ltd.',
      evidenceAssetId: 'rights-license-2026',
    },
  });
  assert.deepEqual(wrapped.rightsEvidence, {
    licensor: 'Example Licensor Ltd.',
    evidenceAssetId: 'rights-license-2026',
  });

  const missingLicensor = structuredClone(wrapped);
  missingLicensor.rightsEvidence.licensor = '   ';
  assert.ok(issueCodes(collectMakerV8CommerceIssues(missingLicensor)).includes(
    'MAKER_V8_RIGHTS_LICENSOR_REQUIRED',
  ));

  const compilerEvidence = structuredClone(wrapped);
  compilerEvidence.rightsEvidence.blobId = 'walrus-blob';
  compilerEvidence.rightsEvidence.sha256 = 'deadbeef';
  compilerEvidence.rightsEvidence.termsCommitment = 'commitment';
  assert.deepEqual(
    issueCodes(collectMakerV8CommerceIssues(compilerEvidence)).filter((code) => (
      code === 'MAKER_V8_RIGHTS_EVIDENCE_FIELD_UNKNOWN'
    )),
    [
      'MAKER_V8_RIGHTS_EVIDENCE_FIELD_UNKNOWN',
      'MAKER_V8_RIGHTS_EVIDENCE_FIELD_UNKNOWN',
      'MAKER_V8_RIGHTS_EVIDENCE_FIELD_UNKNOWN',
    ],
  );

  const nativeWithEvidence = structuredClone(makerCommerce());
  nativeWithEvidence.rightsEvidence = {
    licensor: 'Nobody',
    evidenceAssetId: 'unexpected',
  };
  assert.ok(issueCodes(collectMakerV8CommerceIssues(nativeWithEvidence)).includes(
    'MAKER_V8_NATIVE_RIGHTS_EVIDENCE_FORBIDDEN',
  ));
  assert.throws(
    () => makerCommerce({ rightsOrigin: MAKER_V8_RIGHTS_ORIGINS.LICENSE_WRAPPED }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_RIGHTS_EVIDENCE_RECORD_INVALID',
  );
});

test('malformed records, accessors, unknown keys, and throwing proxies fail with stable issues', () => {
  const commerce = makerCommerce();
  const classRecord = Object.assign(new (class Commerce {})(), commerce);
  assert.equal(
    collectMakerV8CommerceIssues(classRecord)[0].code,
    'MAKER_V8_COMMERCE_RECORD_INVALID',
  );

  const accessorRecord = { ...commerce };
  Object.defineProperty(accessorRecord, 'rightsOrigin', {
    enumerable: true,
    get() { throw new Error('must not escape'); },
  });
  assert.equal(
    collectMakerV8CommerceIssues(accessorRecord)[0].code,
    'MAKER_V8_COMMERCE_RECORD_INVALID',
  );

  const throwingProxy = new Proxy({}, {
    getPrototypeOf() { throw new Error('must not escape'); },
  });
  assert.equal(
    collectMakerV8CommerceIssues(throwingProxy)[0].code,
    'MAKER_V8_COMMERCE_RECORD_INVALID',
  );
  assert.throws(
    () => quoteMakerV8Access(commerce, throwingProxy),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_QUOTE_RECORD_INVALID',
  );

  const dynamicPublish = new Proxy({ publish: true }, {
    get(target, property, receiver) {
      if (property === 'publish') return false;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(
    collectMakerV8CommerceIssues(commerce, dynamicPublish)[0].code,
    'MAKER_V8_OPTIONS_UNREADABLE',
  );
});

test('independent Pack commerce has its own exact schema and all three access modes', () => {
  const free = createMakerV8PackPolicy('free-pack');
  const paid = createMakerV8PackPolicy('paid-pack', {
    accessMode: MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID,
    purchasePriceAtomic: 20_000,
  });
  const included = createMakerV8PackPolicy('included-pack', {
    accessMode: MAKER_V8_PACK_ACCESS_MODES.INCLUDED_WITH_MAKER,
  });

  assert.equal(free.schemaVersion, MAKER_PACK_COMMERCE_V8_SCHEMA);
  assert.equal(free.schemaVersion, 'animacraft.expansion-pack-commerce.v8');
  assert.equal(paid.purchasePriceAtomic, 20_000);
  assert.equal(included.purchasePriceAtomic, 0);
  assert.equal(collectMakerV8PackPolicyIssues(paid).length, 0);
  assert.equal(assertMakerV8PackPolicy(paid), paid);
  assert.equal(Object.isFrozen(canonicalMakerV8PackPolicy(paid)), true);

  const unknown = structuredClone(paid);
  unknown.makerCommerce = makerCommerce();
  assert.ok(issueCodes(collectMakerV8PackPolicyIssues(unknown)).includes(
    'MAKER_V8_PACK_POLICY_FIELD_UNKNOWN',
  ));

  assert.deepEqual(quoteMakerV8Pack(free, { lifecycle: MAKER_V8_LIFECYCLES.ACTIVE }), {
    valid: true,
    reason: 'FREE_CLAIM',
    packId: 'free-pack',
    grossAtomic: '0',
    protocolAtomic: '0',
    packTreasuryAtomic: '0',
    allocations: [],
  });
  assert.equal(quoteMakerV8Pack(included, {
    lifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
  }).reason, 'MAKER_ACCESS_REQUIRED');
  assert.equal(quoteMakerV8Pack(included, {
    hasMakerAccess: true,
    lifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
  }).valid, true);

  assert.throws(
    () => createMakerV8PackPolicy(`0x${'a'.repeat(64)}`),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_PACK_ID_INVALID',
  );
});

test('independent Pack Complete policy supports all four exact modes', () => {
  const policies = [
    createMakerV8PackPolicy('unlimited', {
      completion: {
        mode: MAKER_V8_COMPLETE_MODES.UNLIMITED_FREE,
        freeQuotaPerWallet: 0,
        priceAtomic: 0,
        totalCap: null,
      },
    }),
    createMakerV8PackPolicy('quota-paid', {
      completion: {
        mode: MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID,
        freeQuotaPerWallet: 2,
        priceAtomic: 100,
        totalCap: 20,
      },
    }),
    createMakerV8PackPolicy('always-paid', {
      completion: {
        mode: MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME,
        freeQuotaPerWallet: 0,
        priceAtomic: 100,
        totalCap: 20,
      },
    }),
    createMakerV8PackPolicy('quota-block', {
      completion: {
        mode: MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_BLOCK,
        freeQuotaPerWallet: 2,
        priceAtomic: 0,
        totalCap: 20,
      },
    }),
  ];
  assert.deepEqual(policies.map((policy) => policy.completion.mode), Object.values(
    MAKER_V8_COMPLETE_MODES,
  ));
  assert.equal(policies.every((policy) => collectMakerV8PackPolicyIssues(policy).length === 0), true);
});

test('atomic, BPS, and counter inputs require supported safe integers and exact protocol shape', () => {
  const commerce = makerCommerce();
  const stringAmount = structuredClone(commerce);
  stringAmount.makerAccess = {
    mode: MAKER_V8_ACCESS_MODES.ONE_TIME_PAID,
    purchasePriceAtomic: '100',
  };
  assert.ok(issueCodes(collectMakerV8CommerceIssues(stringAmount)).includes(
    'MAKER_V8_ACCESS_PRICE_INVALID',
  ));

  const unsafeAmount = structuredClone(commerce);
  unsafeAmount.baseCompletion = {
    mode: MAKER_V8_COMPLETE_MODES.PAID_EVERY_TIME,
    freeQuotaPerWallet: 0,
    priceAtomic: Number.MAX_SAFE_INTEGER,
    totalCap: null,
  };
  assert.ok(issueCodes(collectMakerV8CommerceIssues(unsafeAmount)).includes(
    'MAKER_V8_COMPLETION_PRICE_INVALID',
  ));

  assert.throws(
    () => quoteMakerV8Complete(commerce, completeInput({
      walletBaseCount: 1.5,
    })),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_COMPLETE_COUNT_INVALID'),
  );
  assert.throws(
    () => quoteMakerV8Access(commerce, {
      lifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
      protocol: {
        primaryContentFeeBps: 1_000,
        fixedCompleteFeeAtomic: 0,
        makerMarketFeeBps: 250,
      },
    }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_PROTOCOL_FIELD_UNKNOWN'),
  );
});

test('completion cap is null or positive and cannot be lower than its free quota', () => {
  const unbounded = makerCommerce({
    baseCompletion: {
      mode: MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 3,
      priceAtomic: 500,
      totalCap: null,
    },
  });
  assert.equal(unbounded.baseCompletion.totalCap, null);

  const belowQuota = structuredClone(unbounded);
  belowQuota.baseCompletion.totalCap = 2;
  assert.ok(issueCodes(collectMakerV8CommerceIssues(belowQuota)).includes(
    'MAKER_V8_COMPLETION_CAP_BELOW_QUOTA',
  ));

  const zeroCap = structuredClone(unbounded);
  zeroCap.baseCompletion.totalCap = 0;
  assert.ok(issueCodes(collectMakerV8CommerceIssues(zeroCap)).includes(
    'MAKER_V8_COMPLETION_CAP_INVALID',
  ));

  const capped = makerCommerce({
    baseCompletion: {
      mode: MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_BLOCK,
      freeQuotaPerWallet: 1,
      priceAtomic: 0,
      totalCap: 1,
    },
  });
  const quote = quoteMakerV8Complete(capped, completeInput({
    totalBaseCount: 1,
  }));
  assert.equal(quote.valid, false);
  assert.equal(quote.reason, 'TOTAL_CAP_REACHED');
  assert.equal(quote.grossAtomic, '0');
});

test('Maker access uses BigInt fee multiplication beyond MAX_SAFE and decimal-string output', () => {
  const commerce = makerCommerce({
    makerAccess: {
      mode: MAKER_V8_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 1_000_000_000_000,
    },
  });
  const quote = quoteMakerV8Access(commerce, {
    lifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
    makerTreasuryIdentity: 'maker-treasury',
    protocol: {
      primaryContentFeeBps: 9_999,
      fixedCompleteFeeAtomic: 0,
    },
  });
  assert.deepEqual(quote, {
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    grossAtomic: '1000000000000',
    protocolAtomic: '999900000000',
    makerTreasuryAtomic: '100000000',
    allocations: [
      { destination: 'Protocol', amountAtomic: '999900000000' },
      {
        destination: 'MakerTreasury',
        treasuryIdentity: 'maker-treasury',
        amountAtomic: '100000000',
      },
    ],
  });
  assert.equal(typeof quote.grossAtomic, 'string');
  assert.equal(typeof quote.protocolAtomic, 'string');
});

test('Pack purchase routes only its residual to the proven Pack Treasury', () => {
  const policy = createMakerV8PackPolicy('paid-pack', {
    accessMode: MAKER_V8_PACK_ACCESS_MODES.ONE_TIME_PAID,
    purchasePriceAtomic: 20_000,
  });
  const quote = quoteMakerV8Pack(policy, {
    lifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
    packTreasuryIdentity: 'pack-treasury-paid',
    protocol: PROTOCOL_10_PERCENT,
  });
  assert.deepEqual(quote, {
    valid: true,
    reason: 'PURCHASE_REQUIRED',
    packId: 'paid-pack',
    grossAtomic: '20000',
    protocolAtomic: '2000',
    packTreasuryAtomic: '18000',
    allocations: [
      { destination: 'Protocol', amountAtomic: '2000' },
      {
        destination: 'PackTreasury',
        packId: 'paid-pack',
        treasuryIdentity: 'pack-treasury-paid',
        amountAtomic: '18000',
      },
    ],
  });
});

test('non-zero BPS that rounds a positive line share to zero fails closed', () => {
  const access = makerCommerce({
    makerAccess: {
      mode: MAKER_V8_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 1,
    },
  });
  const accessQuote = quoteMakerV8Access(access, {
    lifecycle: MAKER_V8_LIFECYCLES.ACTIVE,
    makerTreasuryIdentity: 'maker-treasury',
    protocol: { primaryContentFeeBps: 1, fixedCompleteFeeAtomic: 0 },
  });
  assert.equal(accessQuote.valid, false);
  assert.equal(accessQuote.reason, 'PROTOCOL_SHARE_ROUNDS_TO_ZERO');
  assert.equal(accessQuote.grossAtomic, '0');
  assert.deepEqual(accessQuote.allocations, []);

  const tinyPack = packPolicy('tiny-pack', 1);
  const completeQuote = quoteMakerV8Complete(makerCommerce(), completeInput({
    usedPackLines: [packLine(tinyPack, 'tiny-pack-treasury')],
    protocol: { primaryContentFeeBps: 1, fixedCompleteFeeAtomic: 0 },
  }));
  assert.equal(completeQuote.valid, false);
  assert.equal(completeQuote.reason, 'PROTOCOL_SHARE_ROUNDS_TO_ZERO');
  assert.equal(completeQuote.contentAtomic, '0');
  assert.deepEqual(completeQuote.allocations, []);
});

test('Complete preserves used Pack order and settles each line to its own Treasury', () => {
  const commerce = makerCommerce({ baseCompletion: paidComplete(10_000) });
  const orbit = packPolicy('quiet-orbit', 20_000);
  const sky = packPolicy('neon-sky', 30_000);
  const quote = quoteMakerV8Complete(commerce, completeInput({
    usedPackLines: [
      packLine(sky, 'sky-treasury'),
      packLine(orbit, 'orbit-treasury'),
    ],
    protocol: PROTOCOL_10_PERCENT,
  }));

  assert.equal(quote.valid, true);
  assert.deepEqual(quote.usedPackIds, ['neon-sky', 'quiet-orbit']);
  assert.deepEqual(quote.lineItems.map((line) => line.scope === 'base' ? 'base' : line.packId), [
    'base',
    'neon-sky',
    'quiet-orbit',
  ]);
  assert.deepEqual(quote.lineItems.map((line) => ({
    protocolAtomic: line.protocolAtomic,
    treasuryAtomic: line.treasuryAtomic,
  })), [
    { protocolAtomic: '1000', treasuryAtomic: '9000' },
    { protocolAtomic: '3000', treasuryAtomic: '27000' },
    { protocolAtomic: '2000', treasuryAtomic: '18000' },
  ]);
  assert.equal(quote.contentAtomic, '60000');
  assert.equal(quote.fixedProtocolAtomic, '100');
  assert.equal(quote.protocolContentAtomic, '6000');
  assert.equal(quote.protocolAtomic, '6100');
  assert.equal(quote.makerTreasuryAtomic, '9000');
  assert.equal(quote.packTreasuryAtomic, '45000');
  assert.equal(quote.grossAtomic, '60100');
  assert.deepEqual(quote.allocations, [
    { destination: 'Protocol', amountAtomic: '6100' },
    {
      destination: 'MakerTreasury',
      treasuryIdentity: 'maker-treasury',
      amountAtomic: '9000',
    },
    {
      destination: 'PackTreasury',
      packId: 'neon-sky',
      treasuryIdentity: 'sky-treasury',
      amountAtomic: '27000',
    },
    {
      destination: 'PackTreasury',
      packId: 'quiet-orbit',
      treasuryIdentity: 'orbit-treasury',
      amountAtomic: '18000',
    },
  ]);
});

test('Complete rejects duplicate, mismatched, inactive, unknown, or incomplete Pack lines', () => {
  const commerce = makerCommerce();
  const orbit = packPolicy('quiet-orbit', 20_000);
  const line = packLine(orbit, 'orbit-treasury');
  const baseInput = completeInput();

  assert.throws(
    () => quoteMakerV8Complete(commerce, {
      ...baseInput,
      usedPackLines: [line, structuredClone(line)],
    }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_COMPLETE_PACK_DUPLICATE'),
  );

  const unknown = structuredClone(line);
  unknown.releaseObjectId = 'compiler-owned';
  assert.throws(
    () => quoteMakerV8Complete(commerce, { ...baseInput, usedPackLines: [unknown] }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_COMPLETE_PACK_LINE_FIELD_UNKNOWN',
  );

  const mismatch = { ...line, packId: 'other-pack' };
  assert.throws(
    () => quoteMakerV8Complete(commerce, { ...baseInput, usedPackLines: [mismatch] }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_COMPLETE_PACK_ID_MISMATCH'),
  );

  const inactive = { ...line, lifecycle: MAKER_V8_LIFECYCLES.PAUSED };
  assert.throws(
    () => quoteMakerV8Complete(commerce, { ...baseInput, usedPackLines: [inactive] }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_COMPLETE_PACK_NOT_ACTIVE'),
  );

  const unknownProofField = structuredClone(line);
  unknownProofField.entitlement.objectId = 'compiler-owned';
  assert.throws(
    () => quoteMakerV8Complete(commerce, {
      ...baseInput,
      usedPackLines: [unknownProofField],
    }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_PACK_ENTITLEMENT_FIELD_UNKNOWN'),
  );

  const noTreasury = structuredClone(line);
  noTreasury.packTreasuryIdentity = '';
  assert.throws(
    () => quoteMakerV8Complete(commerce, { ...baseInput, usedPackLines: [noTreasury] }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_TREASURY_IDENTITY_REQUIRED'),
  );
});

test('live quote state and dense ordered Pack lines are mandatory and cannot be hidden', () => {
  const commerce = makerCommerce({
    baseCompletion: {
      mode: MAKER_V8_COMPLETE_MODES.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 1,
      priceAtomic: 500,
      totalCap: 1,
    },
  });
  assert.throws(
    () => quoteMakerV8Complete(commerce, {
      makerTreasuryIdentity: 'maker-treasury',
      usedPackLines: [],
    }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_LIFECYCLE_INVALID')
      && error.issues.filter((entry) => entry.code === 'MAKER_V8_COMPLETE_COUNT_INVALID').length === 2,
  );
  assert.throws(
    () => quoteMakerV8Complete(commerce, {
      ...completeInput(),
      usedPackLines: undefined,
    }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_COMPLETE_PACK_LINES_INVALID'),
  );
  assert.throws(
    () => quoteMakerV8Complete(commerce, completeInput({ usedPackLines: new Array(1) })),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_QUOTE_ARRAY_INVALID'),
  );

  const paidPack = packPolicy('visible-pack', 10_000);
  const realLines = [packLine(paidPack, 'visible-pack-treasury')];
  const lengthHidingProxy = new Proxy(realLines, {
    get(target, property, receiver) {
      if (property === 'length') return 0;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(
    () => quoteMakerV8Complete(makerCommerce(), completeInput({
      usedPackLines: lengthHidingProxy,
      protocol: PROTOCOL_10_PERCENT,
    })),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_QUOTE_UNREADABLE',
  );

  const treasuryTarget = packLine(paidPack, 'proven-treasury');
  const redirectingLine = new Proxy(treasuryTarget, {
    get(target, property, receiver) {
      if (property === 'packTreasuryIdentity') return 'attacker-treasury';
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(
    () => quoteMakerV8Complete(makerCommerce(), completeInput({
      usedPackLines: [redirectingLine],
      protocol: PROTOCOL_10_PERCENT,
    })),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_QUOTE_UNREADABLE',
  );

  assert.throws(
    () => quoteMakerV8Access(makerCommerce()),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_LIFECYCLE_INVALID',
  );
  assert.throws(
    () => quoteMakerV8Pack(createMakerV8PackPolicy('fresh-pack')),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_LIFECYCLE_INVALID',
  );
});

test('Complete validates entitlement proof semantics and fails closed without access', () => {
  const included = createMakerV8PackPolicy('included-pack', {
    accessMode: MAKER_V8_PACK_ACCESS_MODES.INCLUDED_WITH_MAKER,
    completion: paidComplete(5_000),
  });
  const includedLine = packLine(included, 'included-treasury', {
    entitlement: {
      kind: MAKER_V8_PACK_ENTITLEMENTS.MAKER_ACCESS,
      verified: true,
    },
  });
  const ready = quoteMakerV8Complete(makerCommerce(), completeInput({
    usedPackLines: [includedLine],
    protocol: PROTOCOL_10_PERCENT,
  }));
  assert.equal(ready.valid, true);
  assert.equal(ready.packTreasuryAtomic, '4500');

  const missingLine = packLine(included, 'included-treasury', {
    entitlement: {
      kind: MAKER_V8_PACK_ENTITLEMENTS.NONE,
      verified: false,
    },
  });
  const missing = quoteMakerV8Complete(makerCommerce(), completeInput({
    usedPackLines: [missingLine],
  }));
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, 'PACK_ACCESS_REQUIRED');
  assert.deepEqual(missing.missingEntitlements, ['included-pack']);
  assert.equal(missing.grossAtomic, '0');
});

test('canonical Base commerce remains Pack-free and activation requires confirmation', () => {
  const draft = createMakerV8Commerce();
  assert.throws(
    () => canonicalMakerV8Commerce(draft, { publish: true }),
    (error) => error instanceof MakerV8CommerceValidationError
      && error.code === 'MAKER_V8_RIGHTS_CONFIRMATION_REQUIRED',
  );
  const canonical = canonicalMakerV8Commerce(makerCommerce(), { publish: true });
  assert.equal(Object.hasOwn(canonical, 'packPolicies'), false);
  assert.equal(Object.isFrozen(canonical), true);
});

test('quote paths contain no float conversion or Math rounding', async () => {
  const source = await readFile(new URL('../maker-commerce-v8.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bMath\s*\./);
  assert.doesNotMatch(source, /\bNumber\s*\(/);
});

test('Maker v8 lifecycle helper keeps only DRAFT, ACTIVE, PAUSED, and ARCHIVED', () => {
  assert.deepEqual(Object.values(MAKER_V8_LIFECYCLES), [
    'DRAFT',
    'ACTIVE',
    'PAUSED',
    'ARCHIVED',
  ]);
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
  assert.equal(canTransitionMakerV8Lifecycle('UNKNOWN', 'UNKNOWN'), false);
});
