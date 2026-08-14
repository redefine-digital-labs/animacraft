import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { toBase58, toBase64 } from '@mysten/bcs';
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';

import {
  EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR,
  EXPANSION_PACK_LIFECYCLE_CONTROLLER_STATUS,
  createExpansionPackLifecycleController,
  validateExpansionPackLifecycleSignedTransaction,
} from '../expansion-pack-lifecycle-controller.js';
import { expansionPackLifecycleRecoveryIdentity } from '../expansion-pack-lifecycle-recovery-store.js';

const ORIGIN = '0xa';
const CALLABLE = '0xb';
const COMMERCE = '0xc';
const PAYMENT = '0xe::usdc::USDC';
const AUTHORITY = '0xf';
const PROTOCOL_ADMIN = '0x10';
const RETIRED_CONTROL_CAP = '0x11';
const id = (value) => `0x${value}`;
const bytes = (value) => Array(32).fill(value);
const runtime = Object.freeze({
  expansionPackV8TypeOriginPackageId: ORIGIN,
  expansionPackV8CallablePackageId: CALLABLE,
  commerceV5TypeOriginPackageId: COMMERCE,
  independentExtensionV5TypeOriginPackageId: COMMERCE,
  paymentCoinType: PAYMENT,
  independentExtensionAuthorityV5Id: AUTHORITY,
  expansionPackV8ReleaseEnabled: true,
});

function table(value) { return { id: { id: { bytes: value } } }; }
function releaseObject(lifecycle = 3, overrides = {}, objectVersion = 13) {
  return {
    objectId: id(3),
    version: String(objectVersion),
    digest: `release-digest-${objectVersion}`,
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
      version: '5', legacy_maker_id: id(2), legacy_treasury_id: id(21),
      control_vault_id: id(22), treasury_id: id(23), protocol_config_id: id(6),
      payment_coin_type: PAYMENT, logical_auxiliary_blob_id: 'protocol-logical',
      original_creator: id(9), current_owner: id(9), rights_origin: 0,
      ownership_epoch: '7', lifecycle: 1,
      current_control_cap_id: { vec: [RETIRED_CONTROL_CAP] },
      active_listing_id: { vec: [] }, soul_creator_royalty_bps: 250,
      maker_resale_royalty_bps: 500, base_access_kind: 0,
      base_purchase_price_atomic: '0', base_policy: { fields: {
        mode: 0, free_quota_per_wallet: '0', price_atomic: '0', total_cap: '0',
      } }, packs: table(id(24)), pack_keys: [], style_registry: table(id(25)),
      complete_outputs: table(id(26)), release: { fields: {
        pack_count: '0', paid_pack_count: '0', style_count: '26',
        style_registry_sealed: true, protected_style_count: '0',
        seal_policy_id: { vec: [] }, seal_release_commitment: [],
        complete_output_count: '0', total_completes: '0',
      } },
    } },
  };
}

function configObject() {
  return {
    objectId: id(6), type: `${COMMERCE}::commerce_v5::CommerceProtocolConfigV5`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '5', legacy_config_id: id(27), legacy_admin_cap_id: PROTOCOL_ADMIN,
      treasury_id: id(28), payment_coin_type: PAYMENT,
      primary_protocol_fee_bps: 1000, fixed_complete_fee_atomic: '0',
      maker_market_fee_bps: 250, logical_auxiliary_blob_id: { vec: ['protocol-logical'] },
      soul_binding_proof_type: { vec: [`${id(29)}::soul::BindingProof`] }, enabled: true,
    } },
  };
}

function independentExtensionLockBytes() {
  const suiId = bcs.struct('ID', { bytes: bcs.Address });
  return bcs.struct('IndependentExtensionLockStateV5', {
    authority_id: suiId, legacy_maker_id: suiId, protocol_config_id: suiId,
    protocol_admin_cap_id: suiId, owner: bcs.Address, retired_control_cap_id: suiId,
    retired_control_cap_epoch: bcs.u64(), locked_ownership_epoch: bcs.u64(),
    audit_hash: bcs.byteVector(), finalized: bcs.bool(),
  }).serialize({
    authority_id: { bytes: AUTHORITY }, legacy_maker_id: { bytes: id(2) },
    protocol_config_id: { bytes: id(6) }, protocol_admin_cap_id: { bytes: PROTOCOL_ADMIN },
    owner: id(9), retired_control_cap_id: { bytes: RETIRED_CONTROL_CAP },
    retired_control_cap_epoch: '6', locked_ownership_epoch: '7',
    audit_hash: bytes(102), finalized: true,
  }).toBytes();
}

function chainFixture(initialLifecycle = 3, { lock = true, objectVersion = 13 } = {}) {
  let lifecycle = initialLifecycle;
  const calls = [];
  return {
    calls,
    get lifecycle() { return lifecycle; },
    set lifecycle(value) { lifecycle = value; objectVersion += 1; },
    client: {
      async getObjects({ objectIds }) {
        calls.push({ method: 'getObjects', lifecycle, objectIds: [...objectIds] });
        const objects = [releaseObject(lifecycle, {}, objectVersion), capObject(), treasuryObject(), parentObject(), configObject()];
        return { objects: objectIds.map((requested) => objects.find(
          (entry) => BigInt(entry.objectId) === BigInt(requested),
        )).filter(Boolean) };
      },
      async getDynamicField() {
        if (!lock) throw new Error('dynamic field not found');
        return { dynamicField: { value: {
          type: `${COMMERCE}::commerce_v5::IndependentExtensionLockStateV5`,
          bcs: independentExtensionLockBytes(),
        } } };
      },
    },
  };
}

function successSubmission(
  digest,
  fromLifecycle = 3,
  toLifecycle = 4,
  inputVersion = 13,
) {
  return {
    digest,
    indexed: {
      effects: {
        status: { status: 'success' },
        changedObjects: [{
          objectId: id(3),
          inputState: 'Exists',
          inputVersion: String(inputVersion),
          inputDigest: `release-digest-${inputVersion}`,
          outputState: 'ObjectWrite',
          outputVersion: String(inputVersion + 100),
          idOperation: 'None',
        }],
      },
      objectTypes: {
        [id(3)]: `${ORIGIN}::expansion_pack_v8::ExpansionPackReleaseV8`,
      },
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
    async listPendingForRelease({ walletAddress, releaseId }) {
      calls.push('listPendingForRelease');
      return [...pending.values()].filter((record) => (
        record.walletAddress === walletAddress && record.releaseId === releaseId
      )).map(clone);
    },
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
      return result && (!digest || result.transactionDigest === digest) ? clone(result) : null;
    },
    async listFinalizedFailuresForRelease({ walletAddress, releaseId }) {
      calls.push('listFinalizedFailuresForRelease');
      return [...failures.values()].filter((record) => (
        record.walletAddress === walletAddress && record.releaseId === releaseId
      )).map(clone);
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
  lock = true,
  objectVersion = 13,
  execute,
  sign,
  recoveryStore = memoryRecoveryStore(),
  withExclusiveReleaseLock = async (_key, operation) => operation(),
  controllerFactory = createExpansionPackLifecycleController,
} = {}) {
  const chain = chainFixture(lifecycle, { lock, objectVersion });
  let signCalls = 0;
  let executeCalls = 0;
  const controller = controllerFactory({
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
    withExclusiveReleaseLock,
    validateSignedTransaction: async () => true,
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
  releaseObjectVersion: '13', releaseObjectDigest: 'release-digest-13',
  action: 'pause', fromLifecycle: 3, toLifecycle: 4,
});

function resolvedLifecycleSigned({
  action = 'pause',
  packageId = CALLABLE,
  releaseId = id(3),
  adminCapId = id(4),
  parentRootId = id(1),
  configId = id(6),
  sender = id(9),
} = {}) {
  const objectRef = (objectId, version, fill) => Inputs.ObjectRef({
    objectId,
    version: String(version),
    digest: toBase58(new Uint8Array(32).fill(fill)),
  });
  const inputs = [
    Inputs.SharedObjectRef({ objectId: releaseId, initialSharedVersion: '1', mutable: true }),
    objectRef(adminCapId, 8, 4),
  ];
  if (action === 'resume') inputs.push(
    Inputs.SharedObjectRef({ objectId: parentRootId, initialSharedVersion: '1', mutable: false }),
    Inputs.SharedObjectRef({ objectId: configId, initialSharedVersion: '1', mutable: false }),
  );
  const data = TransactionDataBuilder.restore({
    version: 2,
    sender,
    expiration: null,
    gasData: { budget: '1000000', price: '100', owner: sender, payment: [] },
    inputs,
    commands: [{
      MoveCall: {
        package: packageId,
        module: 'expansion_pack_v8',
        function: `${action}_expansion_pack_v8`,
        typeArguments: [],
        arguments: inputs.map((_, Input) => ({ Input, $kind: 'Input' })),
      },
      $kind: 'MoveCall',
    }],
  });
  const bytes = data.build();
  return {
    bytes: toBase64(bytes),
    signature: 'test-signature',
    digest: TransactionDataBuilder.getDigestFromBytes(bytes),
  };
}

test('wallet-returned bytes are one exact lifecycle Move call bound to the recovery identity', async () => {
  const exactRuntime = { ...runtime, commerceProtocolConfigV5Id: id(6) };
  let verifiedAddress = '';
  const validate = (signed, identity = pauseIdentity()) => (
    validateExpansionPackLifecycleSignedTransaction({
      signed,
      identity,
      runtime: exactRuntime,
      verifySignature: async (_bytes, _signature, options) => {
        verifiedAddress = options.address;
        return true;
      },
    })
  );
  const pause = resolvedLifecycleSigned();
  const proof = await validate(pause);
  assert.equal(proof.digest, pause.digest);
  assert.equal(proof.action, 'pause');
  assert.equal(verifiedAddress, normalizeSuiAddress(id(9)));

  const resumeIdentity = {
    ...pauseIdentity(), action: 'resume', fromLifecycle: 4, toLifecycle: 3,
  };
  await validate(resolvedLifecycleSigned({ action: 'resume' }), resumeIdentity);
  for (const signed of [
    resolvedLifecycleSigned({ packageId: id(99) }),
    resolvedLifecycleSigned({ releaseId: id(30) }),
    resolvedLifecycleSigned({ adminCapId: id(40) }),
    resolvedLifecycleSigned({ sender: id(10) }),
    resolvedLifecycleSigned({ action: 'archive' }),
  ]) {
    await assert.rejects(validate(signed), {
      code: EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SIGNED_TRANSACTION_MISMATCH,
    });
  }
  await assert.rejects(validate({ ...pause, digest: 'wrong-digest' }), {
    code: EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SIGNED_TRANSACTION_MISMATCH,
  });
  await assert.rejects(validateExpansionPackLifecycleSignedTransaction({
    signed: pause,
    identity: pauseIdentity(),
    runtime: exactRuntime,
    verifySignature: async () => { throw new Error('invalid signature'); },
  }), {
    code: EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SIGNED_TRANSACTION_MISMATCH,
  });
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

test('execute queries a release pending digest before fresh lifecycle reads and never signs replacement bytes', async () => {
  const recoveryStore = memoryRecoveryStore();
  const exact = expansionPackLifecycleRecoveryIdentity(pauseIdentity());
  recoveryStore.pending.set(exact.key, {
    ...exact, revision: 8, sessionId: 'existing-session-0001', state: 'OUTCOME_PENDING',
    attemptCount: 2, lastErrorCode: 'TIMEOUT',
    signed: { bytes: 'BAUG', signature: 'existing-signature', digest: 'digest-existing' },
  });
  const fixture = setup({
    lifecycle: 5,
    recoveryStore,
    execute: async (_chain, signed) => ({
      ...successSubmission(signed.digest), alreadySubmitted: true,
    }),
  });
  const recovered = await fixture.controller.execute(pauseInput());
  assert.equal(recovered.status, 'VERIFIED');
  assert.equal(recovered.transactionDigest, 'digest-existing');
  assert.equal(fixture.chain.calls.length, 0);
  assert.equal(fixture.signCalls, 0);
  assert.equal(fixture.executeCalls, 1);
});

test('recover queries a persisted digest before any fresh descriptor gate and accepts exact historical effects', async () => {
  const recoveryStore = memoryRecoveryStore();
  const exact = expansionPackLifecycleRecoveryIdentity(pauseIdentity());
  recoveryStore.pending.set(exact.key, {
    ...exact, revision: 7, sessionId: 'existing-session-0001', state: 'OUTCOME_PENDING',
    attemptCount: 1, lastErrorCode: 'TIMEOUT',
    signed: { bytes: 'BAUG', signature: 'existing-signature', digest: 'digest-existing' },
  });
  const events = [];
  const fixture = setup({
    lifecycle: 5,
    recoveryStore,
    execute: async (_chain, signed, { assertBeforeExecute }) => {
      events.push(`query:${signed.digest}`);
      assert.equal(typeof assertBeforeExecute, 'function');
      return { ...successSubmission(signed.digest), alreadySubmitted: true };
    },
  });
  const recovered = await fixture.controller.recover({ identity: pauseIdentity() });
  assert.equal(recovered.status, 'VERIFIED');
  assert.equal(recovered.transactionDigest, 'digest-existing');
  assert.deepEqual(events, ['query:digest-existing']);
  assert.equal(fixture.chain.calls.length, 0);
  assert.equal(fixture.signCalls, 0);
  assert.equal(fixture.executeCalls, 1);
  assert.equal(await recoveryStore.loadPending(pauseIdentity()), null);
});

test('exclusive Release lock serializes recover across controller instances without replacement signing', async () => {
  const recoveryStore = memoryRecoveryStore();
  const exact = expansionPackLifecycleRecoveryIdentity(pauseIdentity());
  recoveryStore.pending.set(exact.key, {
    ...exact, revision: 4, sessionId: 'existing-session-0001', state: 'OUTCOME_PENDING',
    attemptCount: 1, lastErrorCode: 'TIMEOUT',
    signed: { bytes: 'BAUG', signature: 'existing-signature', digest: 'digest-existing' },
  });
  const tails = new Map();
  let lockCalls = 0;
  let active = 0;
  let maximumActive = 0;
  const mutex = async (key, operation) => {
    lockCalls += 1;
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    tails.set(key, current);
    await previous;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try { return await operation(); } finally {
      active -= 1;
      release();
      if (tails.get(key) === current) tails.delete(key);
    }
  };
  let networkCalls = 0;
  const execute = async (_chain, signed) => {
    networkCalls += 1;
    await Promise.resolve();
    return { ...successSubmission(signed.digest), alreadySubmitted: true };
  };
  const firstModule = await import('../expansion-pack-lifecycle-controller.js?tab=first');
  const secondModule = await import('../expansion-pack-lifecycle-controller.js?tab=second');
  const first = setup({ recoveryStore, execute, withExclusiveReleaseLock: mutex,
    controllerFactory: firstModule.createExpansionPackLifecycleController });
  const second = setup({ recoveryStore, execute, withExclusiveReleaseLock: mutex,
    controllerFactory: secondModule.createExpansionPackLifecycleController });
  const [left, right] = await Promise.all([
    first.controller.recover({ identity: pauseIdentity() }),
    second.controller.recover({ identity: pauseIdentity() }),
  ]);
  assert.equal(left.status, 'VERIFIED');
  assert.deepEqual(right, left);
  assert.equal(lockCalls, 2);
  assert.equal(maximumActive, 1);
  assert.equal(networkCalls, 1);
  assert.equal(first.signCalls + second.signCalls, 0);
});

test('legacy paused parent without an irreversible lock cannot open Resume signing', async () => {
  const fixture = setup({ lifecycle: 4, lock: false });
  const descriptor = await fixture.controller.freshRead({
    walletAddress: id(9), releaseId: id(3),
  });
  assert.equal(descriptor.allowedActions.includes('resume'), false);
  await assert.rejects(fixture.controller.execute({
    kind: 'resume', walletAddress: id(9), releaseId: id(3),
  }), { code: 'EXPANSION_PACK_V8_LIFECYCLE_ACTION_NOT_ALLOWED' });
  assert.equal(fixture.signCalls, 0);
  assert.equal(fixture.executeCalls, 0);
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
  assert.equal(fixture.executeCalls, 1);
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

test('pause, resume, then pause again uses three distinct Release-version identities', async () => {
  const recoveryStore = memoryRecoveryStore();
  let signature = 0;
  const fixture = setup({
    recoveryStore,
    sign: async () => {
      signature += 1;
      return {
        bytes: `signed-bytes-${signature}`,
        signature: `signature-${signature}`,
        digest: `digest-${signature}`,
      };
    },
    execute: async (chain, signed, { assertBeforeExecute }) => {
      await assertBeforeExecute();
      const fromLifecycle = chain.lifecycle;
      const toLifecycle = fromLifecycle === 3 ? 4 : 3;
      chain.lifecycle = toLifecycle;
      return successSubmission(signed.digest, fromLifecycle, toLifecycle, 13 + signature - 1);
    },
  });
  const firstPause = await fixture.controller.execute(pauseInput());
  const resume = await fixture.controller.execute({
    kind: 'resume', walletAddress: id(9), releaseId: id(3),
  });
  const secondPause = await fixture.controller.execute(pauseInput());
  assert.deepEqual(
    [firstPause.status, resume.status, secondPause.status],
    ['VERIFIED', 'VERIFIED', 'VERIFIED'],
  );
  assert.equal(fixture.signCalls, 3);
  assert.deepEqual(
    [...recoveryStore.receipts.values()].map((receipt) => receipt.releaseObjectVersion),
    ['13', '14', '15'],
  );
  assert.equal(new Set(recoveryStore.receipts.keys()).size, 3);
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

test('historical recovery requires exact Release input effects from the persisted object version', async () => {
  const recoveryStore = memoryRecoveryStore();
  const exact = expansionPackLifecycleRecoveryIdentity(pauseIdentity());
  recoveryStore.pending.set(exact.key, {
    ...exact, revision: 7, sessionId: 'existing-session-0001', state: 'OUTCOME_PENDING',
    attemptCount: 1, lastErrorCode: 'TIMEOUT',
    signed: { bytes: 'BAUG', signature: 'existing-signature', digest: 'digest-existing' },
  });
  for (const mutate of [
    (indexed) => { indexed.effects.changedObjects[0].inputVersion = '12'; },
    (indexed) => { indexed.effects.changedObjects[0].inputDigest = 'another-digest'; },
    (indexed) => { indexed.effects.changedObjects[0].outputState = 'DoesNotExist'; },
    (indexed) => { indexed.objectTypes[id(3)] = `${ORIGIN}::expansion_pack_v8::ExpansionPackPassV8`; },
  ]) {
    const fixture = setup({
      recoveryStore,
      execute: async (_chain, signed) => {
        const submission = successSubmission(signed.digest);
        mutate(submission.indexed);
        return { ...submission, alreadySubmitted: true };
      },
    });
    const result = await fixture.controller.recover({ identity: pauseIdentity() });
    assert.equal(result.status, 'OUTCOME_PENDING');
    assert.equal(fixture.signCalls, 0);
    const pending = await recoveryStore.loadPending(pauseIdentity());
    pending.revision = 7;
    pending.state = 'OUTCOME_PENDING';
    recoveryStore.pending.set(exact.key, pending);
  }
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
      if (assertions === 3) drifting.chain.lifecycle = 2;
      return true;
    },
  }), { code: EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT });
  assert.equal(reachedNetwork, false);
  assert.equal(drifting.signCalls, 1);
  const pending = await drifting.recoveryStore.loadPending(pauseIdentity());
  assert.equal(pending.state, 'SIGNED');
  assert.equal(pending.signed.digest, 'digest-1');
});
