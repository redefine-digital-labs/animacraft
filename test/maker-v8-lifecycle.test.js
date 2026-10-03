import assert from 'node:assert/strict';
import test from 'node:test';

import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_CHAIN_SCHEMA,
  makerV8ChainTypes,
  makerV8AttestedReplacement,
} from '../maker-v8-chain.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MAKER_V8_LIFECYCLE_ACTIONS,
  MAKER_V8_LIFECYCLE_STATES,
  assertMakerV8LifecycleReadbackV8,
  buildArchiveMakerV8,
  buildMakerV8LifecycleActionV8,
  buildPauseMakerV8,
  buildResumeMakerV8,
  buildWithdrawMakerRevenueV8,
  certifyMakerV8LifecycleReadbackV8,
  createMakerV8LifecycleControllerV8,
  makerV8LifecycleTargetsV8,
  makerV8SuccessorPublicationCapabilityV8,
} from '../maker-v8-lifecycle.js';
import { attestFixtureRuntime } from './fixtures/maker-v8-runtime-attestation.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = '11111111111111111111111111111111';
const walletAddress = id(8000);
const gasId = id(8999);

function rawRuntime() {
  const roles = {};
  ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .forEach((role, index) => {
      roles[role] = {
        typeOriginPackageId: id(100 + index * 2),
        callablePackageId: id(101 + index * 2),
      };
    });
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: id(200),
    protocolConfigId: id(201),
    protocolTreasuryId: id(202),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: {
      seal: id(210),
      runtime: id(211),
      output: id(212),
      physical: id(213),
      market: id(214),
      release: id(215),
    },
    makerBindings: [],
  };
}

const runtime = await attestFixtureRuntime(rawRuntime());
const types = makerV8ChainTypes(runtime);
const binding = Object.freeze({
  rootId: id(300),
  baseRegistryId: id(301),
  makerTreasuryId: id(302),
  sealRegistryId: id(303),
  runtimeDefinitionRegistryId: id(304),
  packRegistryId: id(305),
  packAdmissionAuthorityId: id(306),
  outputRegistryId: id(307),
  soulRegistryId: id(308),
  physicalRegistryId: id(309),
  marketRegistryId: id(310),
  marketTreasuryId: id(311),
});

function parsedObject({
  objectId,
  type,
  owner,
  version = '9',
  fields = {},
  extra = {},
}) {
  return {
    schemaVersion: MAKER_V8_CHAIN_SCHEMA,
    network: MAKER_V8_CHAIN_NETWORK,
    objectId,
    version: BigInt(version),
    digest,
    type,
    owner,
    fields,
    objectRef: { objectId, version, digest },
    ...extra,
  };
}

function root(lifecycleCode = MAKER_V8_LIFECYCLE_STATES.ACTIVE, overrides = {}) {
  return parsedObject({
    objectId: binding.rootId,
    type: types.root,
    owner: { kind: 'shared', initialSharedVersion: 1n },
    fields: {},
    extra: {
      binding,
      ownerAddress: walletAddress,
      creatorAddress: walletAddress,
      adminCapId: id(320),
      controlEpoch: 4n,
      lifecycleCode,
      lifecycle: Object.keys(MAKER_V8_LIFECYCLE_STATES)
        .find((key) => MAKER_V8_LIFECYCLE_STATES[key] === lifecycleCode),
      makerKey: 'fresh-maker',
      makerVersion: 1n,
      contentCommitment: '22'.repeat(32),
      productBindingCommitment: Buffer.from(makerV8AttestedReplacement(runtime).fields.package_tuple_commitment).toString('hex'),
      callCapSetCommitment: Buffer.from(makerV8AttestedReplacement(runtime).fields.call_cap_set_commitment).toString('hex'),
      ...overrides,
    },
  });
}

function admin(rootInput = root(), overrides = {}) {
  return parsedObject({
    objectId: rootInput.adminCapId,
    type: types.adminCap,
    owner: { kind: 'address', address: walletAddress },
    extra: {
      rootId: rootInput.objectId,
      holder: walletAddress,
      controlEpoch: rootInput.controlEpoch,
      ...overrides,
    },
  });
}

function shared(objectId, type, extra = {}) {
  return parsedObject({
    objectId,
    type,
    owner: { kind: 'shared', initialSharedVersion: 1n },
    extra,
  });
}

function catalog() {
  return shared(runtime.catalogId, types.productReleaseCatalog);
}

function releaseConfig() {
  return shared(runtime.roleConfigIds.release, types.releaseConfig);
}

function protocolConfig(enabled = true) {
  return shared(runtime.protocolConfigId, types.protocolConfig, {
    enabled,
    revision: 7n,
    commitment: `0x${'44'.repeat(32)}`,
  });
}

function makerTreasury(rootInput = root(), overrides = {}) {
  return shared(binding.makerTreasuryId, types.makerTreasury, {
    rootId: rootInput.objectId,
    balanceAtomic: 500n,
    totalCollectedAtomic: 700n,
    totalWithdrawnAtomic: 200n,
    ...overrides,
  });
}

const wallet = () => ({ address: walletAddress, network: 'mainnet' });

function pauseInput(rootInput = root()) {
  return {
    wallet: wallet(),
    root: rootInput,
    admin: admin(rootInput),
    protocolConfig: protocolConfig(),
    catalog: catalog(),
    releaseConfig: releaseConfig(),
  };
}

function postRoot(pre, lifecycleCode, overrides = {}) {
  return {
    ...pre,
    version: pre.version + 1n,
    objectRef: {
      ...pre.objectRef,
      version: (BigInt(pre.objectRef.version) + 1n).toString(),
      digest: '2'.repeat(44),
    },
    lifecycleCode,
    lifecycle: Object.keys(MAKER_V8_LIFECYCLE_STATES)
      .find((key) => MAKER_V8_LIFECYCLE_STATES[key] === lifecycleCode),
    ...overrides,
  };
}

function finalizedFor(built, transactionDigest = digest) {
  return {
    digest: transactionDigest,
    sender: walletAddress,
    events: [{ eventType: built.descriptor.expectedEventType }],
  };
}

test('targets use callable package identities and successor publication is atomic', () => {
  const targets = makerV8LifecycleTargetsV8(runtime);
  assert.equal(
    targets.PAUSE,
    `${runtime.roles.release.callablePackageId}::release_v8::pause_maker_v8`,
  );
  assert.notEqual(runtime.roles.release.callablePackageId, runtime.roles.release.typeOriginPackageId);
  assert.equal(
    targets.WITHDRAW_MAKER_REVENUE,
    `${runtime.roles.core.callablePackageId}::treasury_v8::withdraw_maker_revenue_v8`,
  );
  const successor = makerV8SuccessorPublicationCapabilityV8(runtime);
  assert.deepEqual(
    { available: successor.available, status: successor.status, code: successor.code },
    {
      available: true,
      status: 'ATOMIC_COMPILER',
      code: 'MAKER_V8_SUCCESSOR_PUBLICATION_AVAILABLE',
    },
  );
  assert.match(successor.issueAuthorityTarget, new RegExp(`^${runtime.roles.core.callablePackageId}`));
  assert.match(successor.reason, /atomically/);
});

test('lifecycle rejects missing or malformed release hashes and mismatched attested tuple', () => {
  for (const key of ['productBindingCommitment', 'callCapSetCommitment']) {
    for (const value of [undefined, 'undefined', 'aa']) {
      const invalidRoot = { ...root(undefined, { [key]: value }) };
      if (value === undefined) delete invalidRoot[key];
      assert.throws(() => buildPauseMakerV8(runtime, pauseInput(invalidRoot)),
        (error) => error.code === 'MAKER_V8_LIFECYCLE_RELEASE_COMMITMENT_INVALID');
    }
    assert.throws(() => buildPauseMakerV8(runtime, pauseInput(root(undefined, { [key]: 'ff'.repeat(32) }))),
      (error) => error.code === 'MAKER_V8_LIFECYCLE_REPLACEMENT_INVALID');
  }
});

test('pause builder emits one exact callable Move call with parsed shared and owned refs', () => {
  const built = buildPauseMakerV8(runtime, pauseInput());
  assert.equal(built.action, MAKER_V8_LIFECYCLE_ACTIONS.PAUSE);
  assert.equal(built.descriptor.target, makerV8LifecycleTargetsV8(runtime).PAUSE);
  assert.equal(built.descriptor.arguments.length, 6);
  assert.deepEqual(
    built.descriptor.arguments.map(({ kind, name, mutable }) => ({ kind, name, mutable })),
    [
      { kind: 'shared', name: 'root', mutable: true },
      { kind: 'owned', name: 'admin', mutable: undefined },
      { kind: 'shared', name: 'protocolConfig', mutable: false },
      { kind: 'shared', name: 'catalog', mutable: false },
      { kind: 'immutable', name: 'replacement', mutable: undefined },
      { kind: 'shared', name: 'releaseConfig', mutable: false },
    ],
  );
  const command = built.transaction.getData().commands[0].MoveCall;
  assert.equal(
    `${command.package}::${command.module}::${command.function}`,
    built.descriptor.target,
  );
  assert.equal(built.transaction.getData().commands.length, 1);
  assert.deepEqual(command.typeArguments, [runtime.paymentCoinType]);
});

test('all Release lifecycle ABIs use protocol and attested immutable replacement in exact order', () => {
  const replacement = makerV8AttestedReplacement(runtime);
  for (const [build, state] of [
    [buildPauseMakerV8, MAKER_V8_LIFECYCLE_STATES.ACTIVE],
    [buildResumeMakerV8, MAKER_V8_LIFECYCLE_STATES.PAUSED],
    [buildArchiveMakerV8, MAKER_V8_LIFECYCLE_STATES.ACTIVE],
  ]) {
    const input = pauseInput(root(state));
    const built = build(runtime, input);
    assert.deepEqual(built.descriptor.arguments.map(row => row.name), ['root', 'admin', 'protocolConfig', 'catalog', 'replacement', 'releaseConfig']);
    assert.deepEqual(built.descriptor.arguments[4], { kind: 'immutable', name: 'replacement', objectId: replacement.objectId,
      type: replacement.type, version: replacement.objectRef.version, digest: replacement.objectRef.digest });
    const transaction = built.transaction.getData();
    const call = transaction.commands[0].MoveCall;
    assert.equal(call.arguments.length, 6);
    assert.deepEqual(transaction.inputs[call.arguments[4].Input].Object.ImmOrOwnedObject, replacement.objectRef);
    for (const extra of [{ replacement }, { replacementId: id(999) }]) {
      assert.throws(() => build(runtime, { ...input, ...extra }), { code: 'MAKER_V8_LIFECYCLE_FIELDS_INVALID' });
    }
    assert.throws(() => build(rawRuntime(), input));
  }
});

test('builders reject unknown fields, implicit refs, wrong owner, stale cap, and wrong type origin', () => {
  assert.throws(
    () => buildPauseMakerV8(runtime, { ...pauseInput(), restore: true }),
    { code: 'MAKER_V8_LIFECYCLE_FIELDS_INVALID' },
  );
  assert.throws(
    () => buildMakerV8LifecycleActionV8(runtime, {
      action: 'RESTORE',
      wallet: wallet(),
    }),
    { code: 'MAKER_V8_LIFECYCLE_ACTION_INVALID' },
  );
  const noRef = root();
  delete noRef.objectRef;
  assert.throws(
    () => buildPauseMakerV8(runtime, pauseInput(noRef)),
    { code: 'MAKER_V8_LIFECYCLE_RECORD_INVALID' },
  );
  const wrongOwnerRoot = root();
  assert.throws(
    () => buildPauseMakerV8(runtime, {
      ...pauseInput(wrongOwnerRoot),
      admin: admin(wrongOwnerRoot, { holder: id(9001) }),
    }),
    { code: 'MAKER_V8_LIFECYCLE_ADMIN_MISMATCH' },
  );
  const staleRoot = root();
  assert.throws(
    () => buildPauseMakerV8(runtime, {
      ...pauseInput(staleRoot),
      admin: admin(staleRoot, { controlEpoch: staleRoot.controlEpoch + 1n }),
    }),
    { code: 'MAKER_V8_LIFECYCLE_ADMIN_MISMATCH' },
  );
  const wrongTypeRoot = root();
  wrongTypeRoot.type = `${runtime.roles.release.typeOriginPackageId}::maker_v8::MakerRootV8<${runtime.paymentCoinType}>`;
  assert.throws(
    () => buildPauseMakerV8(runtime, pauseInput(wrongTypeRoot)),
    { code: 'MAKER_V8_LIFECYCLE_TYPE_MISMATCH' },
  );
});

test('resume is PAUSED -> ACTIVE only and requires exact enabled protocol state', () => {
  const paused = root(MAKER_V8_LIFECYCLE_STATES.PAUSED);
  const built = buildResumeMakerV8(runtime, {
    ...pauseInput(paused),
    protocolConfig: protocolConfig(true),
  });
  assert.equal(built.descriptor.target, makerV8LifecycleTargetsV8(runtime).RESUME);
  assert.deepEqual(
    built.descriptor.arguments.map((argument) => argument.name),
    ['root', 'admin', 'protocolConfig', 'catalog', 'replacement', 'releaseConfig'],
  );
  assert.throws(
    () => buildResumeMakerV8(runtime, {
      ...pauseInput(root(MAKER_V8_LIFECYCLE_STATES.ACTIVE)),
      protocolConfig: protocolConfig(true),
    }),
    { code: 'MAKER_V8_LIFECYCLE_TRANSITION_INVALID' },
  );
  assert.throws(
    () => buildResumeMakerV8(runtime, {
      ...pauseInput(paused),
      protocolConfig: protocolConfig(false),
    }),
    { code: 'MAKER_V8_LIFECYCLE_RESUME_DISABLED' },
  );
});

test('stopping builders retain exact authority with a disabled newer protocol revision', () => {
  const disabled = { ...protocolConfig(false), revision: 8n };
  for (const build of [buildPauseMakerV8, buildArchiveMakerV8]) {
    const result = build(runtime, { ...pauseInput(), protocolConfig: disabled });
    assert.deepEqual(result.descriptor.arguments.map(argument => argument.name),
      ['root', 'admin', 'protocolConfig', 'catalog', 'replacement', 'releaseConfig']);
    assert.equal(result.descriptor.arguments.length, 6);
  }
  assert.throws(() => buildResumeMakerV8(runtime, {
    ...pauseInput(root(MAKER_V8_LIFECYCLE_STATES.PAUSED)), protocolConfig: disabled,
  }), { code: 'MAKER_V8_LIFECYCLE_RESUME_DISABLED' });
});

test('ARCHIVED is terminal while withdrawal remains available and exact', () => {
  const active = root();
  const archivedAction = buildArchiveMakerV8(runtime, pauseInput(active));
  assert.equal(archivedAction.descriptor.target, makerV8LifecycleTargetsV8(runtime).ARCHIVE);
  const archived = root(MAKER_V8_LIFECYCLE_STATES.ARCHIVED);
  assert.throws(
    () => buildPauseMakerV8(runtime, pauseInput(archived)),
    { code: 'MAKER_V8_LIFECYCLE_TRANSITION_INVALID' },
  );
  assert.throws(
    () => buildResumeMakerV8(runtime, {
      ...pauseInput(archived),
      protocolConfig: protocolConfig(true),
    }),
    { code: 'MAKER_V8_LIFECYCLE_TRANSITION_INVALID' },
  );
  assert.throws(
    () => buildArchiveMakerV8(runtime, pauseInput(archived)),
    { code: 'MAKER_V8_LIFECYCLE_ARCHIVE_INVALID' },
  );
  const treasury = makerTreasury(archived);
  const withdrawal = buildWithdrawMakerRevenueV8(runtime, {
    wallet: wallet(),
    root: archived,
    admin: admin(archived),
    makerTreasury: treasury,
    amountAtomic: '125',
    recipient: id(8100),
  });
  assert.equal(withdrawal.descriptor.arguments[0].mutable, false);
  assert.deepEqual(
    withdrawal.descriptor.arguments.slice(-2),
    [
      { kind: 'u64', name: 'amountAtomic', value: '125' },
      { kind: 'address', name: 'recipient', value: id(8100) },
    ],
  );
  assert.throws(
    () => buildWithdrawMakerRevenueV8(runtime, {
      wallet: wallet(), root: archived, admin: admin(archived), makerTreasury: treasury,
      amountAtomic: 1, recipient: id(8100),
    }),
    { code: 'MAKER_V8_LIFECYCLE_INTEGER_INVALID' },
  );
  assert.throws(
    () => buildWithdrawMakerRevenueV8(runtime, {
      wallet: wallet(), root: archived, admin: admin(archived), makerTreasury: treasury,
      amountAtomic: '501', recipient: id(8100),
    }),
    { code: 'MAKER_V8_LIFECYCLE_WITHDRAW_BALANCE' },
  );
});

function exactBoundary(order, mutate = null) {
  return {
    async buildExactTransaction({ transaction }) {
      order.push('build');
      if (mutate) mutate(transaction);
      transaction.setExpiration({ Epoch: '101' });
      transaction.setGasPrice(1n);
      transaction.setGasBudget(1_000_000n);
      transaction.setGasPayment([{ objectId: gasId, version: '1', digest }]);
      const bytes = await transaction.build();
      return {
        bytes: toBase64(bytes),
        digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      };
    },
    async dryRunExactTransaction({ bytes, digest: transactionDigest }) {
      order.push('dry-run');
      return { status: 'SUCCESS', bytes, digest: transactionDigest };
    },
  };
}

function controllerFor(built, post, {
  order = [],
  execution = { allowWalletSignature: true, allowBroadcast: true },
  recoveryStatus = 'FINALIZED_SUCCESS',
  boundary = exactBoundary(order),
  finalized = finalizedFor(built),
  postTreasury = null,
} = {}) {
  let durableDigest;
  return {
    order,
    controller: createMakerV8LifecycleControllerV8({
      runtime,
      execution,
      boundary,
      wallet: {
        async signExactTransaction({ bytes, digest: transactionDigest, signer }) {
          order.push('sign');
          return {
            bytes,
            digest: transactionDigest,
            signer,
            signature: toBase64(Uint8Array.of(1, 2, 3)),
          };
        },
        async verifyExactSignature() {
          order.push('verify-signature');
          return true;
        },
      },
      recovery: {
        async reserveSignatureIntent(artifact) {
          order.push('reserve-signature-intent');
          durableDigest = artifact.digest;
          return { recoveryId: 'lifecycle-wal-1', digest: artifact.digest };
        },
        async handleSignatureFailure() {
          order.push('signature-failure');
          return { status: 'SIGNATURE_OUTCOME_UNKNOWN' };
        },
        async persistSignedArtifact(artifact) {
          order.push('persist-signed');
          durableDigest = artifact.digest;
          return { recoveryId: 'lifecycle-wal-1', digest: artifact.digest };
        },
        async loadSignedArtifact() {
          throw new Error('not used by this in-memory controller fixture');
        },
        async resolveActiveRecovery() {
          return { recoveryId: 'lifecycle-wal-1', digest: durableDigest };
        },
        async resolveActiveRecoveryByRoot() {
          return { recoveryId: 'lifecycle-wal-1', digest: durableDigest };
        },
        async reclaimActiveSignatureIntent() {
          return {
            status: 'UNSIGNED_INTENT_RELEASED',
            recoveryId: 'lifecycle-wal-1',
            digest: durableDigest,
          };
        },
        async recoverExactTransaction({ digest: transactionDigest, recoveryId }) {
          order.push('query-first-recovery');
          assert.equal(transactionDigest, durableDigest, 'only the durable digest reaches recovery');
          return { status: recoveryStatus, digest: transactionDigest, recoveryId };
        },
      },
      readback: {
        async readFinalizedTransaction({ digest: transactionDigest, expectedEventTypes }) {
          order.push('finality');
          return {
            ...finalized,
            digest: transactionDigest,
            events: finalized.events ?? [{ eventType: expectedEventTypes[0] }],
          };
        },
        async readRoot() {
          order.push('root-readback');
          return post;
        },
        async readMakerTreasury() {
          order.push('treasury-readback');
          if (!postTreasury) throw new Error('unexpected MakerTreasury readback');
          return postTreasury;
        },
      },
    }),
  };
}

test('controller orders exact build, dry-run, signature, durable WAL, query-first recovery, and fail-closed readback', async () => {
  const pre = root();
  const built = buildPauseMakerV8(runtime, pauseInput(pre));
  const { controller, order } = controllerFor(
    built,
    postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
  );
  const result = await controller.execute(built);
  assert.equal(result.status, 'FINALIZED_SUCCESS');
  assert.equal(result.readback.root.lifecycleCode, MAKER_V8_LIFECYCLE_STATES.PAUSED);
  assertMakerV8LifecycleReadbackV8(result.readback);
  assert.deepEqual(order, [
    'build',
    'dry-run',
    'reserve-signature-intent',
    'sign',
    'verify-signature',
    'persist-signed',
    'query-first-recovery',
    'finality',
    'root-readback',
  ]);
});

test('controller ignores caller mutation but rejects boundary TransactionKind injection', async () => {
  const pre = root();
  const built = buildPauseMakerV8(runtime, pauseInput(pre));
  built.transaction.moveCall({
    target: `${runtime.roles.release.callablePackageId}::release_v8::archive_maker_v8`,
    typeArguments: [runtime.paymentCoinType],
    arguments: [],
  });
  const safe = controllerFor(
    built,
    postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
  );
  await assert.doesNotReject(() => safe.controller.prepare(built));

  const attackedOrder = [];
  const attacked = controllerFor(
    built,
    postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
    {
      order: attackedOrder,
      boundary: exactBoundary(attackedOrder, (transaction) => {
        transaction.moveCall({
          target: `${runtime.roles.release.callablePackageId}::release_v8::archive_maker_v8`,
          typeArguments: [runtime.paymentCoinType],
          arguments: [],
        });
      }),
    },
  );
  await assert.rejects(
    () => attacked.controller.prepare(built),
    { code: 'MAKER_V8_LIFECYCLE_TRANSACTION_KIND_DRIFT' },
  );

  const senderOrder = [];
  const senderAttack = controllerFor(
    built,
    postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
    {
      order: senderOrder,
      boundary: exactBoundary(senderOrder, (transaction) => transaction.setSender(id(9998))),
    },
  );
  await assert.rejects(
    () => senderAttack.controller.prepare(built),
    { code: 'MAKER_V8_LIFECYCLE_TRANSACTION_ENVELOPE_DRIFT' },
  );
});

test('execution gates are coupled and disabled deployments cannot sign or recover', async () => {
  const pre = root();
  const built = buildPauseMakerV8(runtime, pauseInput(pre));
  assert.throws(
    () => controllerFor(built, postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED), {
      execution: { allowWalletSignature: true, allowBroadcast: false },
    }),
    { code: 'MAKER_V8_LIFECYCLE_EXECUTION_GATE_INVALID' },
  );
  const { controller } = controllerFor(
    built,
    postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
    { execution: { allowWalletSignature: false, allowBroadcast: false } },
  );
  const prepared = await controller.prepare(built);
  await assert.rejects(
    () => controller.requestSignature(prepared),
    { code: 'MAKER_V8_LIFECYCLE_EXECUTION_DISABLED' },
  );
});

test('one dry-run proof can authorize at most one wallet signature request', async () => {
  const pre = root();
  const built = buildPauseMakerV8(runtime, pauseInput(pre));
  const { controller } = controllerFor(
    built,
    postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
  );
  const prepared = await controller.prepare(built);
  await controller.requestSignature(prepared);
  await assert.rejects(
    () => controller.requestSignature(prepared),
    { code: 'MAKER_V8_LIFECYCLE_PREPARED_REQUIRED' },
  );
});

test('OUTCOME_UNKNOWN remains recoverable and never fabricates final readback', async () => {
  const pre = root();
  const built = buildPauseMakerV8(runtime, pauseInput(pre));
  const { controller, order } = controllerFor(
    built,
    postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
    { recoveryStatus: 'OUTCOME_UNKNOWN' },
  );
  const result = await controller.execute(built);
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(result.readback, null);
  assert.equal(order.includes('finality'), false);
  assert.equal(order.at(-1), 'query-first-recovery');
});

test('final lifecycle readback rejects missing event, wrong terminal state, and unrelated Root drift', () => {
  const pre = root();
  const built = buildArchiveMakerV8(runtime, pauseInput(pre));
  const archived = postRoot(pre, MAKER_V8_LIFECYCLE_STATES.ARCHIVED);
  assert.throws(
    () => certifyMakerV8LifecycleReadbackV8(built, {
      finalized: { ...finalizedFor(built), events: [] },
      root: archived,
    }),
    { code: 'MAKER_V8_LIFECYCLE_FINALITY_INVALID' },
  );
  assert.throws(
    () => certifyMakerV8LifecycleReadbackV8(built, {
      finalized: finalizedFor(built),
      root: postRoot(pre, MAKER_V8_LIFECYCLE_STATES.PAUSED),
    }),
    { code: 'MAKER_V8_LIFECYCLE_POST_STATE_MISMATCH' },
  );
  assert.throws(
    () => certifyMakerV8LifecycleReadbackV8(built, {
      finalized: finalizedFor(built),
      root: postRoot(pre, MAKER_V8_LIFECYCLE_STATES.ARCHIVED, { controlEpoch: 5n }),
    }),
    { code: 'MAKER_V8_LIFECYCLE_ROOT_DRIFT' },
  );
});

test('withdrawal readback proves exact balance and total-withdrawn arithmetic', () => {
  const archived = root(MAKER_V8_LIFECYCLE_STATES.ARCHIVED);
  const treasury = makerTreasury(archived);
  const built = buildWithdrawMakerRevenueV8(runtime, {
    wallet: wallet(),
    root: archived,
    admin: admin(archived),
    makerTreasury: treasury,
    amountAtomic: '125',
    recipient: id(8100),
  });
  const postTreasury = {
    ...treasury,
    version: treasury.version + 1n,
    objectRef: {
      ...treasury.objectRef,
      version: '10',
      digest: '2'.repeat(44),
    },
    balanceAtomic: 375n,
    totalCollectedAtomic: 700n,
    totalWithdrawnAtomic: 325n,
  };
  const evidence = certifyMakerV8LifecycleReadbackV8(built, {
    finalized: finalizedFor(built),
    root: archived,
    makerTreasury: postTreasury,
  });
  assert.equal(evidence.root.lifecycleCode, MAKER_V8_LIFECYCLE_STATES.ARCHIVED);
  assert.equal(evidence.makerTreasury.balanceAtomic, '375');
  assert.throws(
    () => certifyMakerV8LifecycleReadbackV8(built, {
      finalized: finalizedFor(built),
      root: archived,
      makerTreasury: { ...postTreasury, totalWithdrawnAtomic: 324n },
    }),
    { code: 'MAKER_V8_LIFECYCLE_TREASURY_READBACK_MISMATCH' },
  );
});
