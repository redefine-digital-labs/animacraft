import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR,
  EXPANSION_PACK_LIFECYCLE_CONTROLLER_STATUS,
  createExpansionPackLifecycleController,
} from '../expansion-pack-lifecycle-controller.js';
import { expansionPackLifecycleRecoveryIdentity } from '../expansion-pack-lifecycle-recovery-store.js';

const ORIGIN = '0xa';
const CALLABLE = '0xb';
const COMMERCE = '0xc';
const PAYMENT = '0xe::usdc::USDC';
const id = (value) => `0x${value}`;
const bytes = (value) => Array(32).fill(value);
const runtime = Object.freeze({
  expansionPackV8TypeOriginPackageId: ORIGIN,
  expansionPackV8CallablePackageId: CALLABLE,
  commerceV5TypeOriginPackageId: COMMERCE,
  paymentCoinType: PAYMENT,
  expansionPackV8ReleaseEnabled: true,
});

function table(value) { return { id: { id: { bytes: value } } }; }
function releaseObject(lifecycle = 3, overrides = {}) {
  return {
    objectId: id(3),
    type: `${ORIGIN}::expansion_pack_v8::ExpansionPackReleaseV8`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '8', parent_root_id: id(1), parent_legacy_maker_id: id(2),
      parent_version: '1', parent_manifest_blob_id: 'parent',
      parent_manifest_sha256: bytes(17), pack_id: 'pack', namespace: 'maker.pack',
      pack_version: '1.0.0', creator: id(9), manifest_bound: true,
      manifest_blob_id: 'pack', manifest_sha256: bytes(34),
      content_commitment: bytes(51), style_registry_commitment: bytes(68),
      seal_policy_id: { vec: [] }, seal_package_id: { vec: [] },
      seal_release_commitment: [], access_kind: 0, purchase_price_atomic: '0',
      lifecycle, admin_cap_id: id(4), treasury_id: id(5), admitted_by: id(9),
      admitted_parent_ownership_epoch: '7', styles: table(id(81)),
      seal_assets: table(id(82)), entitlements: table(id(83)), style_count: '1',
      entitlement_count: '0', ...overrides,
    } },
  };
}

function capObject(owner = id(9)) {
  return {
    objectId: id(4), type: `${ORIGIN}::expansion_pack_v8::ExpansionPackAdminCapV8`,
    owner: { AddressOwner: owner },
    json: { fields: { version: '8', release_id: id(3), creator: id(9) } },
  };
}

function treasuryObject() {
  return {
    objectId: id(5),
    type: `${ORIGIN}::expansion_pack_v8::ExpansionPackTreasuryV8<${PAYMENT}>`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '8', release_id: id(3), revenue: { fields: { value: '0' } },
      total_collected: '0', total_withdrawn: '0',
    } },
  };
}

function parentObject() {
  return {
    objectId: id(1), type: `${COMMERCE}::commerce_v5::MakerRootV5`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      current_owner: id(9), ownership_epoch: '7', lifecycle: 1,
      protocol_config_id: id(6),
    } },
  };
}

function configObject() {
  return {
    objectId: id(6), type: `${COMMERCE}::commerce_v5::CommerceProtocolConfigV5`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: { version: '5', enabled: true } },
  };
}

function chainFixture(initialLifecycle = 3) {
  let lifecycle = initialLifecycle;
  const calls = [];
  return {
    calls,
    get lifecycle() { return lifecycle; },
    set lifecycle(value) { lifecycle = value; },
    client: {
      async getObjects({ objectIds }) {
        calls.push({ method: 'getObjects', lifecycle, objectIds: [...objectIds] });
        const objects = [releaseObject(lifecycle), capObject(), treasuryObject(), parentObject(), configObject()];
        return { objects: objectIds.map((requested) => objects.find(
          (entry) => BigInt(entry.objectId) === BigInt(requested),
        )).filter(Boolean) };
      },
    },
  };
}

function successSubmission(digest, fromLifecycle = 3, toLifecycle = 4) {
  return {
    digest,
    indexed: {
      effects: { status: { status: 'success' } },
      events: [{
        type: `${ORIGIN}::expansion_pack_v8::ExpansionPackLifecycleChangedV8`,
        parsedJson: {
          release_id: id(3), previous_lifecycle: fromLifecycle, lifecycle: toLifecycle,
        },
      }],
    },
  };
}

function clone(value) { return value == null ? value : structuredClone(value); }

function memoryRecoveryStore() {
  const pending = new Map();
  const receipts = new Map();
  const failures = new Map();
  const calls = [];
  const identity = (value) => expansionPackLifecycleRecoveryIdentity(value);
  const key = (value) => identity(value).key;
  const api = {
    calls, pending, receipts, failures,
    async loadPending(value) {
      calls.push('loadPending');
      return clone(pending.get(key(value)) || null);
    },
    async loadVerifiedReceipt(value) {
      calls.push('loadVerifiedReceipt');
      return clone(receipts.get(key(value)) || null);
    },
    async loadFinalizedFailure(value, digest) {
      calls.push('loadFinalizedFailure');
      const result = failures.get(key(value));
      return result && result.transactionDigest === digest ? clone(result) : null;
    },
    async persistSignedTransaction(value, signed, options) {
      calls.push('persistSignedTransaction');
      const exact = identity(value);
      const record = {
        ...exact, revision: 1, sessionId: options.sessionId, state: 'SIGNED',
        attemptCount: 0, lastErrorCode: '', signed: clone(signed),
      };
      pending.set(exact.key, record);
      return { saved: true, verified: true, idempotent: false, record: clone(record) };
    },
    async checkpointPending(value, patch, options) {
      calls.push(`checkpointPending:${patch.state}`);
      const exact = identity(value);
      const record = pending.get(exact.key);
      assert.equal(record.revision, options.expectedRevision);
      assert.equal(record.sessionId, options.sessionId);
      const next = {
        ...record, revision: record.revision + 1, state: patch.state,
        lastErrorCode: patch.lastErrorCode || '',
        attemptCount: record.attemptCount + (patch.state === 'BROADCASTING' ? 1 : 0),
      };
      pending.set(exact.key, next);
      return clone(next);
    },
    async storeVerifiedReceipt(value, receipt, options) {
      calls.push('storeVerifiedReceipt');
      const exact = identity(value);
      const record = pending.get(exact.key);
      assert.equal(record.revision, options.expectedRevision);
      assert.equal(record.sessionId, options.sessionId);
      const stored = {
        ...exact, transactionDigest: receipt.transactionDigest,
        executionStatus: 'SUCCESS', verifiedReadback: true,
        previousLifecycle: exact.fromLifecycle, lifecycle: exact.toLifecycle,
      };
      receipts.set(exact.key, stored);
      pending.delete(exact.key);
      return clone(stored);
    },
    async storeFinalizedFailure(value, failure, options) {
      calls.push('storeFinalizedFailure');
      const exact = identity(value);
      const record = pending.get(exact.key);
      assert.equal(record.revision, options.expectedRevision);
      assert.equal(record.sessionId, options.sessionId);
      const stored = {
        ...exact, transactionDigest: failure.transactionDigest, finalized: true,
        executionStatus: 'FAILURE', executionError: clone(failure.executionError),
      };
      failures.set(exact.key, stored);
      pending.delete(exact.key);
      return clone(stored);
    },
  };
  return api;
}

function setup({
  lifecycle = 3,
  execute,
  sign,
  recoveryStore = memoryRecoveryStore(),
} = {}) {
  const chain = chainFixture(lifecycle);
  let signCalls = 0;
  let executeCalls = 0;
  const controller = createExpansionPackLifecycleController({
    runtime,
    suiClient: chain.client,
    recoveryStore,
    sessionIdFactory: () => 'lifecycle-session-0001',
    signTransactionForRecovery: async (...args) => {
      signCalls += 1;
      return sign ? sign(...args) : {
        bytes: 'AQID', signature: 'signature-1', digest: 'digest-1',
      };
    },
    executeSignedTransactionAndWait: async (...args) => {
      executeCalls += 1;
      if (execute) return execute(chain, ...args);
      await args[1].assertBeforeExecute();
      chain.lifecycle = 4;
      return successSubmission(args[0].digest);
    },
  });
  return {
    chain, recoveryStore, controller,
    get signCalls() { return signCalls; },
    get executeCalls() { return executeCalls; },
  };
}

const pauseInput = () => ({ kind: 'pause', walletAddress: id(9), releaseId: id(3) });
const pauseIdentity = () => ({
  walletAddress: id(9), releaseId: id(3), adminCapId: id(4), parentRootId: id(1),
  action: 'pause', fromLifecycle: 3, toLifecycle: 4,
});

test('success persists before broadcast, verifies exact readback and returns no signed bytes', async () => {
  let observedPersisted = false;
  const fixture = setup({
    execute: async (chain, signed, { assertBeforeExecute }) => {
      observedPersisted = fixture.recoveryStore.calls.includes('persistSignedTransaction');
      await assertBeforeExecute();
      chain.lifecycle = 4;
      return successSubmission(signed.digest);
    },
  });
  const result = await fixture.controller.execute(pauseInput());
  assert.equal(result.status, EXPANSION_PACK_LIFECYCLE_CONTROLLER_STATUS.VERIFIED);
  assert.equal(result.transactionDigest, 'digest-1');
  assert.equal(result.previousLifecycle, 3);
  assert.equal(result.lifecycle, 4);
  assert.equal(result.readbackVerified, true);
  assert.equal(observedPersisted, true);
  assert.equal(fixture.signCalls, 1);
  assert.equal(fixture.executeCalls, 1);
  assert.equal(Object.hasOwn(result, 'signed'), false);
  assert.equal(JSON.stringify(result).includes('AQID'), false);
  assert.deepEqual(fixture.recoveryStore.calls.filter((entry) => (
    entry === 'persistSignedTransaction' || entry === 'storeVerifiedReceipt'
  )), ['persistSignedTransaction', 'storeVerifiedReceipt']);
});

test('pending replay uses exact persisted signature and never signs again', async () => {
  const recoveryStore = memoryRecoveryStore();
  const exact = expansionPackLifecycleRecoveryIdentity(pauseIdentity());
  recoveryStore.pending.set(exact.key, {
    ...exact, revision: 7, sessionId: 'existing-session-0001', state: 'OUTCOME_PENDING',
    attemptCount: 1, lastErrorCode: 'TIMEOUT',
    signed: { bytes: 'BAUG', signature: 'existing-signature', digest: 'digest-existing' },
  });
  let executedSigned;
  const fixture = setup({
    recoveryStore,
    execute: async (chain, signed, { assertBeforeExecute }) => {
      executedSigned = clone(signed);
      await assertBeforeExecute();
      chain.lifecycle = 4;
      return successSubmission(signed.digest);
    },
  });
  const result = await fixture.controller.execute(pauseInput());
  assert.equal(result.status, 'VERIFIED');
  assert.equal(fixture.signCalls, 0);
  assert.equal(fixture.executeCalls, 1);
  assert.equal(executedSigned.digest, 'digest-existing');
  assert.equal(executedSigned.bytes, 'BAUG');
});

test('wrong context after signing preserves signed checkpoint and blocks broadcast', async () => {
  const fixture = setup();
  let assertions = 0;
  await assert.rejects(fixture.controller.execute({
    ...pauseInput(),
    assertActive() {
      assertions += 1;
      return assertions < 3;
    },
  }), { code: EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.CONTEXT_CHANGED });
  assert.equal(fixture.signCalls, 1);
  assert.equal(fixture.executeCalls, 0);
  const pending = await fixture.recoveryStore.loadPending(pauseIdentity());
  assert.ok(pending);
  assert.equal(pending.state, 'SIGNED');
  assert.equal(pending.signed.digest, 'digest-1');
});

test('definitive finalized failure is terminal and never signs a replacement', async () => {
  const failure = Object.assign(new Error('Move abort'), {
    code: 'TRANSACTION_FINALIZED_FAILURE',
    finalizedFailure: {
      finalized: true, transactionDigest: 'digest-1', executionStatus: 'FAILURE',
      executionError: { kind: 'MoveAbort', message: 'EInvalidLifecycle' },
    },
  });
  const fixture = setup({
    execute: async (_chain, _signed, { assertBeforeExecute }) => {
      await assertBeforeExecute();
      throw failure;
    },
  });
  const first = await fixture.controller.execute(pauseInput());
  assert.equal(first.status, 'FINALIZED_FAILURE');
  assert.equal(first.error.kind, 'MoveAbort');
  assert.equal(fixture.signCalls, 1);
  assert.equal(await fixture.recoveryStore.loadPending(pauseIdentity()), null);

  const restarted = setup({ recoveryStore: fixture.recoveryStore });
  const second = await restarted.controller.recover({
    identity: pauseIdentity(), transactionDigest: 'digest-1',
  });
  assert.deepEqual(second, first);
  assert.equal(fixture.signCalls, 1);
  assert.equal(fixture.executeCalls, 1);
  assert.equal(restarted.signCalls, 0);
  assert.equal(restarted.executeCalls, 0);
});

test('ambiguous failure checkpoints outcome pending and recover retries exact bytes', async () => {
  let attempt = 0;
  const fixture = setup({
    execute: async (chain, signed, { assertBeforeExecute }) => {
      attempt += 1;
      await assertBeforeExecute();
      if (attempt === 1) {
        const error = new Error('timeout');
        error.code = 'TRANSACTION_OUTCOME_PENDING';
        throw error;
      }
      chain.lifecycle = 4;
      return successSubmission(signed.digest);
    },
  });
  const pending = await fixture.controller.execute(pauseInput());
  assert.equal(pending.status, 'OUTCOME_PENDING');
  assert.equal(pending.transactionDigest, 'digest-1');
  assert.equal(Object.hasOwn(pending, 'bytes'), false);
  assert.equal((await fixture.recoveryStore.loadPending(pauseIdentity())).state, 'OUTCOME_PENDING');

  const recovered = await fixture.controller.recover({ identity: pauseIdentity() });
  assert.equal(recovered.status, 'VERIFIED');
  assert.equal(recovered.transactionDigest, 'digest-1');
  assert.equal(fixture.signCalls, 1);
  assert.equal(fixture.executeCalls, 2);
});

test('transition drift before signing fails closed without signing', async () => {
  const fixture = setup();
  let assertions = 0;
  await assert.rejects(fixture.controller.execute({
    ...pauseInput(),
    assertActive() {
      assertions += 1;
      if (assertions === 1) fixture.chain.lifecycle = 4;
      return true;
    },
  }), { code: EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT });
  assert.equal(fixture.signCalls, 0);
  assert.equal(fixture.executeCalls, 0);
  assert.equal(await fixture.recoveryStore.loadPending(pauseIdentity()), null);
});

test('transition drift at the broadcast boundary preserves signed bytes and does not execute', async () => {
  const fixture = setup();
  let assertions = 0;
  let reachedNetwork = false;
  const drifting = setup({
    recoveryStore: fixture.recoveryStore,
    execute: async (_chain, _signed, { assertBeforeExecute }) => {
      await assertBeforeExecute();
      reachedNetwork = true;
      return successSubmission('digest-1');
    },
  });
  await assert.rejects(drifting.controller.execute({
    ...pauseInput(),
    assertActive() {
      assertions += 1;
      if (assertions === 4) drifting.chain.lifecycle = 2;
      return true;
    },
  }), { code: EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT });
  assert.equal(reachedNetwork, false);
  assert.equal(drifting.signCalls, 1);
  const pending = await drifting.recoveryStore.loadPending(pauseIdentity());
  assert.equal(pending.state, 'SIGNED');
  assert.equal(pending.signed.digest, 'digest-1');
});
