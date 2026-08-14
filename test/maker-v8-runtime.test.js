import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_LEGACY_GATES,
  MakerV8RuntimeError,
  assertMakerV8Runtime,
  inspectMakerV8Runtime,
  makerV8StableType,
} from '../maker-v8-runtime.js';

const CORE = `0x${'1'.repeat(64)}`;
const CONFIG = `0x${'2'.repeat(64)}`;
const TREASURY = `0x${'3'.repeat(64)}`;
const PHYSICAL = `0x${'5'.repeat(64)}`;

function runtime(overrides = {}) {
  return {
    makerV8ReleaseEnabled: true,
    makerV8CallablePackageId: CORE,
    makerV8TypeOriginPackageId: CORE,
    makerV8ProtocolConfigId: CONFIG,
    makerV8ProtocolTreasuryId: TREASURY,
    makerV8PaymentCoinType: `0x${'6'.repeat(64)}::usdc::USDC`,
    makerV8SealPackageId: CORE,
    makerV8SoulProofType: `0x${'7'.repeat(64)}::soul::OwnerProof`,
    makerV8PhysicalCallablePackageId: PHYSICAL,
    makerV8PhysicalTypeOriginPackageId: PHYSICAL,
    ...Object.fromEntries(MAKER_V8_LEGACY_GATES.map((field) => [field, false])),
    ...overrides,
  };
}

test('unified v8 requires one complete fresh tuple and disables every old gate', () => {
  const inspected = inspectMakerV8Runtime(runtime(), { requireEnabled: true });
  assert.equal(inspected.valid, true);
  assert.equal(inspected.enabled, true);
  assert.equal(inspected.runtime.makerV8CallablePackageId, CORE);
  assert.equal(makerV8StableType(runtime(), 'maker_v8', 'MakerRootV8'), `${CORE}::maker_v8::MakerRootV8`);
});

test('a missing, true, or non-boolean old gate fails the one-way cutover', () => {
  for (const field of MAKER_V8_LEGACY_GATES) {
    const missing = runtime();
    delete missing[field];
    assert.equal(inspectMakerV8Runtime(missing, { requireEnabled: true }).valid, false, field);
    assert.equal(
      inspectMakerV8Runtime(runtime({ [field]: true }), { requireEnabled: true })
        .issues.some((entry) => entry.code === 'MAKER_V8_DUAL_PRODUCT_GATE' && entry.field === field),
      true,
      field,
    );
  }
});

test('fresh v8 rejects zero, malformed, or upgraded TypeOrigin identities', () => {
  for (const [field, value] of [
    ['makerV8ProtocolConfigId', `0x${'0'.repeat(64)}`],
    ['makerV8SealPackageId', '0x1234'],
    ['makerV8PaymentCoinType', 'USDC'],
  ]) {
    assert.equal(inspectMakerV8Runtime(runtime({ [field]: value })).valid, false, field);
  }
  const drift = inspectMakerV8Runtime(runtime({
    makerV8CallablePackageId: `0x${'8'.repeat(64)}`,
  }), { requireFreshTypeOrigin: true });
  assert.equal(drift.issues.some((entry) => entry.code === 'MAKER_V8_FRESH_TYPE_ORIGIN_REQUIRED'), true);
});

test('later v8 callables may upgrade while stable TypeOrigins and Seal remain pinned', () => {
  const upgraded = inspectMakerV8Runtime(runtime({
    makerV8CallablePackageId: `0x${'8'.repeat(64)}`,
    makerV8PhysicalCallablePackageId: `0x${'9'.repeat(64)}`,
  }), { requireEnabled: true });
  assert.equal(upgraded.valid, true);

  const sealDrift = inspectMakerV8Runtime(runtime({
    makerV8SealPackageId: `0x${'8'.repeat(64)}`,
  }));
  assert.equal(
    sealDrift.issues.some((entry) => entry.code === 'MAKER_V8_SEAL_TYPE_ORIGIN_MISMATCH'),
    true,
  );
});

test('a disabled pre-deployment config may stay empty but strict v8 cannot', () => {
  assert.equal(inspectMakerV8Runtime({ makerV8ReleaseEnabled: false }).valid, true);
  const strict = inspectMakerV8Runtime({ makerV8ReleaseEnabled: false }, { requireEnabled: true });
  assert.equal(strict.valid, false);
  assert.equal(strict.issues.some((entry) => entry.code === 'MAKER_V8_GATE_DISABLED'), true);
  assert.throws(
    () => assertMakerV8Runtime({ makerV8ReleaseEnabled: false }, { requireEnabled: true }),
    MakerV8RuntimeError,
  );
});
