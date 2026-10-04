import assert from 'node:assert/strict';
import test from 'node:test';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TestTransport } from '@protobuf-ts/runtime-rpc';

import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import { IDBFactory } from 'fake-indexeddb';

import { makerV8TransactionEventsDigestV8 } from '../maker-v8-browser.js';
import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_CHAIN_SCHEMA,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  MAKER_V8_MAINNET_GENESIS_DIGEST,
  makerV8ChainTypes,
  makerV8AttestedReplacement,
  parseMakerAdminCapV8,
  parseMakerRootV8,
} from '../maker-v8-chain.js';
import {
  MAKER_V8_LIFECYCLE_ADAPTERS_SCHEMA,
  MAKER_V8_LIFECYCLE_RECOVERY_STATUS,
  createMakerV8LifecycleBoundaryAdapterV8,
  createMakerV8LifecyclePersistenceV8,
  createMakerV8LifecycleReadbackAdapterV8,
  createMakerV8LifecycleRecoveryAdapterV8,
  createProductionMakerV8LifecycleAdaptersV8,
} from '../maker-v8-lifecycle-adapters.js';
import {
  MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
  MAKER_V8_LIFECYCLE_STATES,
  buildPauseMakerV8,
  buildWithdrawMakerRevenueV8,
  certifyMakerV8LifecycleReadbackV8,
  createMakerV8LifecycleControllerV8,
} from '../maker-v8-lifecycle.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import { attestFixtureRuntime } from './fixtures/maker-v8-runtime-attestation.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = (fill) => toBase58(new Uint8Array(32).fill(fill));
const owner = id(8_000);
const gasId = id(8_001);
const preDigest = digest(1);
const postDigest = digest(2);
const gasDigest = digest(3);
const commitment = (fill) => fill.repeat(64);
const commitmentBytes = (value) => Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
const lifecycleEventBcs = bcs.struct('MakerV8LifecycleChangedTest', {
  root_id: bcs.Address,
  catalog_id: bcs.Address,
  maker_version: bcs.u64(),
  content_commitment: bcs.vector(bcs.u8()),
  owner: bcs.Address,
  control_epoch: bcs.u64(),
  from: bcs.u8(),
  to: bcs.u8(),
  registry_ids: bcs.struct('MakerRuntimeCompanionRegistryIdsV2', Object.fromEntries([
    'runtime_definition_registry_id', 'pack_registry_id', 'admission_authority_id', 'seal_registry_id',
    'output_registry_id', 'soul_registry_id', 'physical_registry_id', 'market_registry_id',
  ].map(key => [key, bcs.Address]))),
});
const withdrawEventBcs = bcs.struct('MakerRevenueV8WithdrawnTest', {
  root_id: bcs.Address,
  treasury_id: bcs.Address,
  operator: bcs.Address,
  recipient: bcs.Address,
  amount: bcs.u64(),
});

function serializeLifecycleEvent(fields) {
  return lifecycleEventBcs.serialize({
    ...fields,
    content_commitment: commitmentBytes(fields.content_commitment),
  }).toBytes();
}

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
      seal: id(210), runtime: id(211), output: id(212), physical: id(213),
      market: id(214), release: id(215),
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
const activation = Object.freeze({
  network: MAKER_V8_CHAIN_NETWORK,
  type: types.activationEvent,
  catalogId: runtime.catalogId,
  binding,
  makerKey: 'fresh-lifecycle-maker',
  makerVersion: 1n,
  contentCommitment: commitment('2'),
  versionCommitment: commitment('4'),
  rendererCommitment: commitment('5'),
  protocolConfigRevision: 7n,
  protocolConfigCommitment: commitment('6'),
  productBindingCommitment: Buffer.from(makerV8AttestedReplacement(runtime).fields.package_tuple_commitment).toString('hex'),
  callCapSetCommitment: Buffer.from(makerV8AttestedReplacement(runtime).fields.call_cap_set_commitment).toString('hex'),
});

function rootFields(lifecycle = MAKER_V8_LIFECYCLE_STATES.ACTIVE) {
  return {
    id: binding.rootId,
    version: '8',
    core_original_package_id: runtime.roles.core.typeOriginPackageId,
    core_callable_package_id: runtime.roles.core.callablePackageId,
    maker_version: '1',
    maker_key: activation.makerKey,
    content: { content_commitment: activation.contentCommitment, renderer_commitment: activation.rendererCommitment,
      manifest_blob_id: 'fixture-manifest', manifest_sha256: activation.contentCommitment },
    maker_document_commitment: commitment('1'), creator_defaults_commitment: commitment('1'), living_content_binding_commitment: commitment('1'),
    expected_base_definition_count: '1', expected_base_registry_commitment: commitment('1'), expected_pack_admission_policy_commitment: commitment('1'),
    rights: {}, created_at_ms: '1', base_registry_id: binding.baseRegistryId, maker_treasury_id: binding.makerTreasuryId,
    version_commitment: activation.versionCommitment,
    previous_root_id: null,
    previous_version_commitment: null,
    successor_authority_id: null,
    successor_root_id: null,
    lifecycle,
    owner,
    creator: owner,
    admin_cap_id: id(320),
    control_epoch: '4',
    economics: { protocol_config_id: runtime.protocolConfigId, protocol_treasury_id: runtime.protocolTreasuryId,
      protocol_config_revision: '7', protocol_config_commitment: activation.protocolConfigCommitment },
    publication: { catalog_id: runtime.catalogId, sealed_base_registry_commitment: commitment('2'), release_commitments: {
      product_binding_commitment: activation.productBindingCommitment, call_cap_set_commitment: activation.callCapSetCommitment,
    }, registry_ids: {
      seal_registry_id: binding.sealRegistryId,
      runtime_definition_registry_id: binding.runtimeDefinitionRegistryId,
      pack_registry_id: binding.packRegistryId,
      admission_authority_id: binding.packAdmissionAuthorityId,
      output_registry_id: binding.outputRegistryId,
      soul_registry_id: binding.soulRegistryId,
      physical_registry_id: binding.physicalRegistryId,
      market_registry_id: binding.marketRegistryId,
    } },
  };
}

function rootResponse({
  version = '9',
  objectDigest = preDigest,
  lifecycle = MAKER_V8_LIFECYCLE_STATES.ACTIVE,
} = {}) {
  return {
    data: {
      objectId: binding.rootId,
      version,
      digest: objectDigest,
      type: types.root,
      owner: { Shared: { initial_shared_version: '1' } },
      content: { dataType: 'moveObject', type: types.root, fields: rootFields(lifecycle) },
    },
  };
}

function adminResponse() {
  return {
    data: {
      objectId: id(320),
      version: '7',
      digest: preDigest,
      type: types.adminCap,
      owner: { AddressOwner: owner },
      content: {
        dataType: 'moveObject',
        type: types.adminCap,
        fields: {
          id: id(320), version: '8', owner, root_id: binding.rootId, control_epoch: '4',
        },
      },
    },
  };
}

const parsedRoot = parseMakerRootV8(rootResponse(), runtime, activation);
const parsedAdmin = parseMakerAdminCapV8(adminResponse(), runtime, owner, parsedRoot);

function parsedShared(objectId, type) {
  return {
    schemaVersion: MAKER_V8_CHAIN_SCHEMA,
    network: MAKER_V8_CHAIN_NETWORK,
    objectId,
    version: 5n,
    digest: preDigest,
    type,
    owner: { kind: 'shared', initialSharedVersion: 1n },
    fields: {},
    objectRef: { objectId, version: '5', digest: preDigest },
  };
}

function actionInput() {
  return {
    wallet: { address: owner, network: MAKER_V8_CHAIN_NETWORK },
    root: parsedRoot,
    admin: parsedAdmin,
    protocolConfig: parsedShared(runtime.protocolConfigId, types.protocolConfig),
    catalog: parsedShared(runtime.catalogId, types.productReleaseCatalog),
    releaseConfig: parsedShared(runtime.roleConfigIds.release, types.releaseConfig),
  };
}

function fullTransactionFromKind(kindBytes, epoch = '101', sender = owner) {
  const transaction = Transaction.fromKind(kindBytes);
  transaction.setSender(sender);
  transaction.setGasOwner(sender);
  transaction.setGasBudget(1_000_000);
  transaction.setGasPrice(1);
  transaction.setGasPayment([{ objectId: gasId, version: '1', digest: gasDigest }]);
  transaction.setExpiration({ Epoch: epoch });
  return transaction;
}

function exactBoundary(log = []) {
  return {
    async buildExactTransaction({ transaction, sender }) {
      log.push('build');
      transaction.setExpiration({ Epoch: '101' });
      transaction.setGasOwner(sender);
      transaction.setGasBudget(1_000_000);
      transaction.setGasPrice(1);
      transaction.setGasPayment([{ objectId: gasId, version: '1', digest: gasDigest }]);
      const bytes = await transaction.build();
      return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) };
    },
    async dryRunExactTransaction({ bytes, digest: transactionDigest }) {
      log.push('dry-run');
      return { status: 'SUCCESS', bytes, digest: transactionDigest };
    },
  };
}

function storageManager() {
  return {
    async persisted() { return true; },
    async persist() { return true; },
    async estimate() { return { quota: 100_000_000, usage: 0 }; },
  };
}

function absence(transactionDigest) {
  return {
    status: 'NOT_FOUND',
    digest: transactionDigest,
    epoch: null,
    effectsFingerprint: null,
    eventsDigest: null,
    error: null,
    absence: {
      schemaVersion: 'animacraft.sui-transaction-absence.v8',
      kind: 'SUI_GRPC_TRANSACTION_NOT_FOUND',
      grpcCode: 'NOT_FOUND',
      grpcService: 'sui.rpc.v2.LedgerService',
      grpcMethod: 'GetTransaction',
      requestedDigest: transactionDigest,
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      watermarkEpoch: '100',
      watermarkCheckpointSequence: '900',
      watermarkCheckpointDigest: digest(9),
    },
  };
}

function finalizedQuery(transactionDigest) {
  return {
    status: 'FINALIZED_SUCCESS',
    digest: transactionDigest,
    epoch: '100',
    effectsFingerprint: `0x${'a'.repeat(64)}`,
    eventsDigest: digest(8),
    error: null,
    absence: null,
  };
}

function readbackFor(transactionDigest, pre = parsedRoot, sender = owner) {
  const post = {
    ...pre,
    version: 10n,
    lifecycleCode: MAKER_V8_LIFECYCLE_STATES.PAUSED,
    lifecycle: 'PAUSED',
    digest: postDigest,
    objectRef: { objectId: binding.rootId, version: '10', digest: postDigest },
  };
  return {
    async readFinalizedTransaction({ expectedEventTypes }) {
      return {
        digest: transactionDigest(),
        sender,
        events: [{ eventType: expectedEventTypes[0] }],
      };
    },
    async readRoot() { return post; },
    async readMakerTreasury() { throw new Error('unexpected treasury read'); },
  };
}

test('cold recovery is query-first, replays only durable bytes, and later certifies final readback', async () => {
  const keypair = new Ed25519Keypair();
  const signer = keypair.toSuiAddress();
  // Use the real key address while retaining all exact fixture objects.
  const root = { ...parsedRoot, ownerAddress: signer };
  const admin = {
    ...parsedAdmin,
    owner: { kind: 'address', address: signer },
    holder: signer,
  };
  const input = {
    ...actionInput(),
    wallet: { address: signer, network: 'mainnet' },
    root,
    admin,
  };
  let clock = 1_000;
  const persistence = createMakerV8LifecyclePersistenceV8(new IDBFactory(), {
    databaseName: 'lifecycle-query-first-cold',
    storageManager: storageManager(),
    now: () => ++clock,
  });
  const log = [];
  let queryMode = 'NOT_FOUND';
  let durableDigest = null;
  const wallet = {
    signCount: 0,
    async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
    async signExactTransaction({ bytes, digest: transactionDigest, signer: expected }) {
      log.push('sign');
      this.signCount += 1;
      const signed = await keypair.signTransaction(fromBase64(bytes));
      return { bytes, digest: transactionDigest, signature: signed.signature, signer: expected };
    },
    async verifyExactSignature({ bytes, digest: transactionDigest, signature, signer: expected }) {
      const verified = await isValidTransactionSignature(fromBase64(bytes), signature, { address: expected });
      return verified ? { verified: true, bytes, digest: transactionDigest, signer: expected } : false;
    },
  };
  let currentRootResponse = structuredClone(rootResponse());
  currentRootResponse.data.content.fields.owner = signer;
  const currentAdminResponse = structuredClone(adminResponse());
  currentAdminResponse.data.owner.AddressOwner = signer;
  currentAdminResponse.data.content.fields.owner = signer;
  const client = {
    async getChainIdentifier() { log.push('pin'); return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    async getObject({ id: objectId }) {
      log.push(objectId === binding.rootId ? 'fresh-root' : 'fresh-admin');
      return objectId === binding.rootId ? currentRootResponse : currentAdminResponse;
    },
    core: {
      async executeTransaction({ transaction }) {
        log.push('execute');
        const observed = TransactionDataBuilder.getDigestFromBytes(transaction);
        assert.equal(observed, durableDigest);
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: observed,
            effects: { transactionDigest: observed, status: { success: true } },
          },
        };
      },
    },
  };
  const rpc = {
    async queryTransaction({ digest: transactionDigest }) {
      log.push('query');
      return queryMode === 'NOT_FOUND' ? absence(transactionDigest) : finalizedQuery(transactionDigest);
    },
  };
  const recoveryOptions = {
    client,
    runtime,
    rpc,
    wallet,
    persistence,
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true, allowBroadcast: true,
    },
    loadRuntimeAttestation: async () => ({ runtime }),
    now: () => ++clock,
    assertTransport(value) { assert.equal(value, client); },
  };
  const firstRecovery = createMakerV8LifecycleRecoveryAdapterV8(recoveryOptions);
  let resultDigest = null;
  const controller = createMakerV8LifecycleControllerV8({
    runtime,
    boundary: exactBoundary(log),
    wallet,
    recovery: firstRecovery,
    readback: readbackFor(() => resultDigest, root, signer),
    execution: { allowWalletSignature: true, allowBroadcast: true },
  });
  const built = controller.build({ action: 'PAUSE', ...input });
  const replacement = makerV8AttestedReplacement(runtime);
  const replacementArgument = built.descriptor.arguments.find((argument) => argument.name === 'replacement');
  assert.equal(replacementArgument.kind, 'immutable');
  assert.equal(replacementArgument.version, String(replacement.objectRef.version));
  assert.equal(replacementArgument.digest, replacement.objectRef.digest);
  assert.equal(replacementArgument.objectId, replacement.objectId);
  const prepared = await controller.prepare(built);
  durableDigest = prepared.digest;
  resultDigest = prepared.digest;
  const ticket = await controller.requestSignature(prepared);
  assert.ok(ticket.recoveryId.startsWith('lifecycle:'));
  assert.ok(log.indexOf('sign') > log.indexOf('dry-run'));

  const secondRecovery = createMakerV8LifecycleRecoveryAdapterV8(recoveryOptions);
  const restarted = createMakerV8LifecycleControllerV8({
    runtime,
    boundary: exactBoundary([]),
    wallet,
    recovery: secondRecovery,
    readback: readbackFor(() => resultDigest, root, signer),
    execution: { allowWalletSignature: true, allowBroadcast: true },
  });
  const stableRecovery = { action: 'PAUSE', rootId: binding.rootId, signer };
  const unknown = await restarted.recoverByRoot(stableRecovery);
  assert.equal(unknown.status, 'OUTCOME_UNKNOWN');
  assert.equal(log.indexOf('query') < log.indexOf('fresh-root'), true);
  assert.equal(log.indexOf('query') < log.indexOf('execute'), true);
  let stored = await persistence.load(ticket.recoveryId);
  assert.equal(stored.status, MAKER_V8_LIFECYCLE_RECOVERY_STATUS.OUTCOME_PENDING);
  assert.equal(stored.broadcastCount, 1);

  queryMode = 'FINALIZED_SUCCESS';
  currentRootResponse = structuredClone(rootResponse({
    version: '10',
    objectDigest: postDigest,
    lifecycle: MAKER_V8_LIFECYCLE_STATES.PAUSED,
  }));
  currentRootResponse.data.content.fields.owner = signer;
  const finalized = await restarted.recoverByRoot(stableRecovery);
  assert.equal(finalized.status, 'FINALIZED_SUCCESS');
  assert.equal(finalized.readback.root.lifecycleCode, MAKER_V8_LIFECYCLE_STATES.PAUSED);
  stored = await persistence.load(ticket.recoveryId);
  assert.equal(stored.status, MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_SUCCESS);

  const duplicate = controller.build({ action: 'PAUSE', ...input });
  const duplicatePrepared = await controller.prepare(duplicate);
  const signCount = wallet.signCount;
  await assert.rejects(
    controller.requestSignature(duplicatePrepared),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_SIGNED_ARTIFACT_CONFLICT',
  );
  assert.equal(wallet.signCount, signCount, 'durable intent conflict is detected before another wallet prompt');
});

test('semantic scope ignores inert input junk and blocks replacement TransactionData', async () => {
  const built = buildPauseMakerV8(runtime, actionInput());
  const kind = await built.transaction.build({ onlyTransactionKind: true });
  const forgedDigest = digest(24);
  const forgedRoot = {
    ...parsedRoot,
    version: 777n,
    digest: forgedDigest,
    objectRef: { objectId: parsedRoot.objectId, version: '777', digest: forgedDigest },
  };
  const forgedActionInput = { ...actionInput(), root: forgedRoot };
  const forgedBuilt = buildPauseMakerV8(runtime, forgedActionInput);
  const forgedKind = await forgedBuilt.transaction.build({ onlyTransactionKind: true });
  assert.equal(toBase64(forgedKind), toBase64(kind), 'shared current ref is absent from TransactionKind');
  const firstTransaction = fullTransactionFromKind(kind, '101');
  const secondTransaction = fullTransactionFromKind(forgedKind, '102');
  const firstBytes = await firstTransaction.build();
  const secondBytes = await secondTransaction.build();
  const persistence = createMakerV8LifecyclePersistenceV8(new IDBFactory(), {
    databaseName: 'lifecycle-semantic-scope',
    storageManager: storageManager(),
  });
  const base = {
    schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
    action: 'PAUSE',
    descriptor: built.descriptor,
    signer: owner,
  };
  await persistence.reserveSignatureIntent({
    ...base,
    input: {
      action: 'PAUSE',
      ...actionInput(),
      root: { ...parsedRoot, __inertNonce: 'a' },
    },
    bytes: toBase64(firstBytes),
    digest: TransactionDataBuilder.getDigestFromBytes(firstBytes),
  });
  await assert.rejects(
    persistence.reserveSignatureIntent({
      ...base,
      descriptor: forgedBuilt.descriptor,
      input: {
        action: 'PAUSE',
        ...forgedActionInput,
        root: { ...forgedRoot, __inertNonce: 'b' },
      },
      bytes: toBase64(secondBytes),
      digest: TransactionDataBuilder.getDigestFromBytes(secondBytes),
    }),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_SIGNED_ARTIFACT_CONFLICT',
  );
});

test('definitive wallet rejection releases only the unsigned session and a fresh proof can retry', async () => {
  const keypair = new Ed25519Keypair();
  const signer = keypair.toSuiAddress();
  const root = { ...parsedRoot, ownerAddress: signer };
  const admin = {
    ...parsedAdmin,
    owner: { kind: 'address', address: signer },
    holder: signer,
  };
  const input = {
    ...actionInput(),
    wallet: { address: signer, network: 'mainnet' },
    root,
    admin,
  };
  let clock = 7_000;
  const persistence = createMakerV8LifecyclePersistenceV8(new IDBFactory(), {
    databaseName: 'lifecycle-definitive-rejection',
    storageManager: storageManager(),
    now: () => ++clock,
  });
  let prompts = 0;
  const wallet = {
    async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
    async signExactTransaction({ bytes, digest: transactionDigest, signer: expectedSigner }) {
      prompts += 1;
      if (prompts === 1) {
        const error = new Error('Wallet Standard request rejected');
        error.definitiveRejection = true;
        error.signedArtifactCreated = false;
        throw error;
      }
      const signed = await keypair.signTransaction(fromBase64(bytes));
      return { bytes, digest: transactionDigest, signature: signed.signature, signer: expectedSigner };
    },
    async verifyExactSignature(artifact) {
      const verified = await isValidTransactionSignature(
        fromBase64(artifact.bytes), artifact.signature, { address: artifact.signer },
      );
      return verified ? {
        verified: true,
        bytes: artifact.bytes,
        digest: artifact.digest,
        signer: artifact.signer,
      } : false;
    },
  };
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    core: {},
  };
  const recovery = createMakerV8LifecycleRecoveryAdapterV8({
    client,
    runtime,
    rpc: { async queryTransaction() { throw new Error('not called'); } },
    wallet,
    persistence,
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true, allowBroadcast: true,
    },
    loadRuntimeAttestation: async () => ({ runtime }),
    now: () => ++clock,
    assertTransport(value) { assert.equal(value, client); },
  });
  const controller = createMakerV8LifecycleControllerV8({
    runtime,
    boundary: exactBoundary([]),
    wallet,
    recovery,
    readback: readbackFor(() => null, root, signer),
    execution: { allowWalletSignature: true, allowBroadcast: true },
  });
  const first = controller.build({ action: 'PAUSE', ...input });
  await assert.rejects(
    controller.requestSignature(await controller.prepare(first)),
    /Wallet Standard request rejected/,
  );
  assert.equal(await persistence.loadActiveScope({
    action: first.action,
    rootId: first.descriptor.preState.root.objectId,
    signer,
  }), null);
  const retry = controller.build({ action: 'PAUSE', ...input });
  const ticket = await controller.requestSignature(await controller.prepare(retry));
  assert.ok(ticket.recoveryId.startsWith('lifecycle:'));
  assert.equal(prompts, 2);
});

test('unknown unsigned outcome remains locked until lease and exact external no-artifact confirmation', async () => {
  const built = buildPauseMakerV8(runtime, actionInput());
  const transaction = fullTransactionFromKind(
    await built.transaction.build({ onlyTransactionKind: true }),
    '101',
  );
  const bytes = await transaction.build();
  let clock = 1_000;
  const persistence = createMakerV8LifecyclePersistenceV8(new IDBFactory(), {
    databaseName: 'lifecycle-unsigned-lease',
    storageManager: storageManager(),
    signatureLeaseMs: 1_000,
    now: () => clock,
  });
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    core: {},
  };
  const recovery = createMakerV8LifecycleRecoveryAdapterV8({
    client,
    runtime,
    rpc: { async queryTransaction() { throw new Error('not called'); } },
    wallet: {
      async getCurrentAccount() { return { address: owner, network: 'mainnet' }; },
      async verifyExactSignature() { return false; },
    },
    persistence,
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true, allowBroadcast: true,
    },
    confirmNoSignedArtifact: async (request) => ({
      confirmed: true,
      recoveryId: request.recoveryId,
      sessionId: request.sessionId,
      checkedAt: request.checkedAt,
    }),
    loadRuntimeAttestation: async () => ({ runtime }),
    now: () => clock,
    assertTransport(value) { assert.equal(value, client); },
  });
  const unsigned = {
    schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
    action: built.action,
    descriptor: built.descriptor,
    input: { action: 'PAUSE', ...actionInput() },
    bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes),
    signer: owner,
  };
  const reserved = await recovery.reserveSignatureIntent(unsigned);
  await recovery.handleSignatureFailure({
    recoveryId: reserved.recoveryId,
    digest: reserved.digest,
    definitiveRejection: false,
    signedArtifactCreated: null,
  });
  await assert.rejects(
    recovery.reclaimSignatureIntent({ recoveryId: reserved.recoveryId }),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_SIGNATURE_LEASE_ACTIVE',
  );
  clock = 2_001;
  await recovery.reclaimSignatureIntent({ recoveryId: reserved.recoveryId });
  assert.equal(await persistence.loadActiveScope({
    action: built.action,
    rootId: built.descriptor.preState.root.objectId,
    signer: owner,
  }), null);
  await assert.doesNotReject(() => recovery.reserveSignatureIntent(unsigned));
});

test('production boundary accepts official gRPC address-balance gas resolution and rejects unsafe envelopes', async t => {
  // Exercise the installed official gRPC resolver, including protobuf response
  // handling, rather than pre-populating Transaction gas fields in the test.
  function addressGasResolver({ mutate = () => {} } = {}) {
    const calls = [];
    const fallback = new TestTransport();
    const transport = {
      mergeOptions: options => fallback.mergeOptions(options),
      unary(method, input, options) {
        assert.equal(method.service.typeName, 'sui.rpc.v2.TransactionExecutionService');
        assert.equal(method.name, 'SimulateTransaction');
        assert.equal(input.doGasSelection, true);
        assert.equal(input.transaction.gasPayment.budget, undefined);
        assert.equal(input.transaction.expiration.epoch > 0n, true);
        calls.push(input);
        const transaction = { ...input.transaction,
          gasPayment: { owner: input.transaction.sender, budget: 340448n, price: 100n, objects: [] } };
        mutate(transaction);
        const response = method.O.create({ transaction: {
          transaction, effects: { status: { success: true }, epoch: 41n },
        } });
        return new TestTransport({ response }).unary(method, input, options);
      },
      serverStreaming() { throw Error('Unexpected stream'); },
      clientStreaming() { throw Error('Unexpected stream'); },
      duplex() { throw Error('Unexpected stream'); },
    };
    const grpc = new SuiGrpcClient({ network: 'mainnet', transport });
    return { calls, plugin: () => grpc.core.resolveTransactionPlugin() };
  }
  for (const mode of ['address-balance', 'owner', 'sender', 'budget', 'expiry', 'nonarray', 'reference']) await t.test(mode, async () => {
    const built = buildPauseMakerV8(runtime, actionInput());
    const kind = toBase64(await built.transaction.build({ onlyTransactionKind: true }));
    const resolver = addressGasResolver({ mutate: tx => {
      if (mode === 'owner') tx.gasPayment.owner = id(9999);
      if (mode === 'sender') tx.sender = tx.gasPayment.owner = id(9999);
      if (mode === 'budget') tx.gasPayment.budget = 500000001n;
      if (mode === 'expiry') tx.expiration.epoch = 0n;
      if (mode === 'nonarray') tx.gasPayment.objects = {};
      if (mode === 'reference') tx.gasPayment.objects = [{ objectId: gasId, version: 0n, digest: gasDigest }];
    } });
    let simulations = 0;
    const client = { getChainIdentifier: async () => ({ chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }), core: {
      resolveTransactionPlugin: resolver.plugin,
      getCurrentSystemState: async () => ({ systemState: { epoch: '41' } }),
      simulateTransaction: async ({ transaction: bytes }) => {
        simulations++;
        return { $kind: 'Transaction', Transaction: { digest: TransactionDataBuilder.getDigestFromBytes(bytes), bcs: bytes,
          status: { success: true }, effects: { transactionDigest: digest(6), status: { success: true } } } };
      },
      executeTransaction: () => assert.fail('must never broadcast'),
    } };
    const boundary = createMakerV8LifecycleBoundaryAdapterV8({ client, runtime,
      execution: { network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, allowWalletSignature: false, allowBroadcast: false },
      loadRuntimeAttestation: async () => ({ runtime }), assertTransport() {} });
    const build = () => boundary.buildExactTransaction({ transaction: built.transaction, sender: owner,
      descriptor: built.descriptor, expectedKindBytes: kind });
    if (mode === 'expiry') {
      const result = await build();
      const data = TransactionDataBuilder.fromBytes(fromBase64(result.bytes));
      assert.equal(data.snapshot().expiration.Epoch, 42, 'SDK preserves the explicitly bounded expiry over resolver data');
      data.expiration = { Epoch: 0, $kind: 'Epoch' };
      const bytes = data.build();
      await assert.rejects(boundary.dryRunExactTransaction({ bytes: toBase64(bytes),
        digest: TransactionDataBuilder.getDigestFromBytes(bytes), signer: owner,
        descriptor: built.descriptor, expectedKindBytes: kind }), { code: 'MAKER_V8_LIFECYCLE_TRANSACTION_ENVELOPE_INVALID' });
      assert.equal(simulations, 0);
      return;
    }
    if (mode !== 'address-balance') {
      await assert.rejects(build);
      assert.equal(simulations, 0);
      return;
    }
    const result = await build();
    assert.equal(resolver.calls.length, 1);
    const snapshot = TransactionDataBuilder.fromBytes(fromBase64(result.bytes)).snapshot();
    assert.deepEqual(snapshot.gasData.payment, []);
    assert.equal(snapshot.expiration.Epoch, 42);
    assert.equal((await boundary.dryRunExactTransaction({ ...result, signer: owner,
      descriptor: built.descriptor, expectedKindBytes: kind })).status, 'SUCCESS');
    assert.equal(simulations, 1);
  });
});

test('production boundary binds descriptor kind and accepts an independent simulation effects digest', async () => {
  const built = buildPauseMakerV8(runtime, actionInput());
  const kindBytes = await built.transaction.build({ onlyTransactionKind: true });
  const transaction = fullTransactionFromKind(kindBytes, '20');
  const simulationDigest = digest(6);
  let executions = 0;
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '19' } }; },
      async simulateTransaction({ transaction: bytes }) {
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: TransactionDataBuilder.getDigestFromBytes(bytes),
            bcs: bytes,
            status: { success: true },
            effects: { transactionDigest: simulationDigest, status: { success: true } },
          },
        };
      },
      async executeTransaction() { executions += 1; },
    },
  };
  const boundary = createMakerV8LifecycleBoundaryAdapterV8({
    client,
    runtime,
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true, allowBroadcast: true,
    },
    loadRuntimeAttestation: async () => ({ runtime }),
    assertTransport(value) { assert.equal(value, client); },
  });
  const expectedKindBytes = toBase64(kindBytes);
  const envelope = await boundary.buildExactTransaction({
    transaction,
    sender: owner,
    descriptor: built.descriptor,
    expectedKindBytes,
  });
  const simulated = await boundary.dryRunExactTransaction({
    bytes: envelope.bytes,
    digest: envelope.digest,
    signer: owner,
    descriptor: built.descriptor,
    expectedKindBytes,
  });
  assert.equal(simulated.status, 'SUCCESS');
  assert.equal(executions, 0, 'build and simulation never broadcast');

  const malicious = { ...built.descriptor, target: `${runtime.roles.release.callablePackageId}::release_v8::archive_maker_v8` };
  await assert.rejects(
    boundary.buildExactTransaction({
      transaction: fullTransactionFromKind(kindBytes),
      sender: owner,
      descriptor: malicious,
      expectedKindBytes,
    }),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_TRANSACTION_KIND_DRIFT',
  );
});

test('finalized failure and authoritative post-expiration absence are durable terminal states', async () => {
  for (const [scenario, paymentMode] of ['FAILURE', 'EXPIRED'].flatMap(scenario =>
    ['coin', 'address-balance'].map(mode => [scenario, mode]))) {
    const keypair = new Ed25519Keypair();
    const signer = keypair.toSuiAddress();
    const root = { ...parsedRoot, ownerAddress: signer };
    const admin = {
      ...parsedAdmin,
      owner: { kind: 'address', address: signer },
      holder: signer,
    };
    const input = {
      action: 'PAUSE',
      ...actionInput(),
      wallet: { address: signer, network: 'mainnet' },
      root,
      admin,
    };
    const built = buildPauseMakerV8(runtime, {
      ...actionInput(),
      wallet: input.wallet,
      root,
      admin,
    });
    const transaction = fullTransactionFromKind(
      await built.transaction.build({ onlyTransactionKind: true }),
      '101',
      signer,
    );
    if (paymentMode === 'address-balance') transaction.setGasPayment([]);
    const bytes = await transaction.build();
    const transactionDigest = TransactionDataBuilder.getDigestFromBytes(bytes);
    const signed = await keypair.signTransaction(bytes);
    let clock = 3_000;
    const persistence = createMakerV8LifecyclePersistenceV8(new IDBFactory(), {
      databaseName: `lifecycle-terminal-${scenario.toLowerCase()}`,
      storageManager: storageManager(),
      now: () => ++clock,
    });
    let executeCount = 0;
    let forgeAbsence = scenario === 'EXPIRED';
    const wallet = {
      async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
      async verifyExactSignature(artifact) {
        const verified = await isValidTransactionSignature(
          fromBase64(artifact.bytes), artifact.signature, { address: artifact.signer },
        );
        return verified ? {
          verified: true,
          bytes: artifact.bytes,
          digest: artifact.digest,
          signer: artifact.signer,
        } : false;
      },
    };
    const client = {
      async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST }; },
      core: { async executeTransaction() { executeCount += 1; } },
    };
    const rpc = {
      async queryTransaction() {
        if (scenario === 'EXPIRED') {
          const result = absence(transactionDigest);
          result.absence.watermarkEpoch = '102';
          if (forgeAbsence) result.absence.grpcCode = 'INTERNAL';
          return result;
        }
        return {
          status: 'FINALIZED_FAILURE',
          digest: transactionDigest,
          epoch: '100',
          effectsFingerprint: `0x${'b'.repeat(64)}`,
          eventsDigest: null,
          error: { message: 'Move abort' },
          absence: null,
        };
      },
    };
    const recovery = createMakerV8LifecycleRecoveryAdapterV8({
      client,
      runtime,
      rpc,
      wallet,
      persistence,
      execution: {
        network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        allowWalletSignature: true, allowBroadcast: true,
      },
      loadRuntimeAttestation: async () => ({ runtime }),
      now: () => ++clock,
      assertTransport(value) { assert.equal(value, client); },
    });
    const unsigned = {
      schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
      action: 'PAUSE',
      descriptor: built.descriptor,
      input,
      bytes: toBase64(bytes),
      digest: transactionDigest,
      signer,
    };
    const reservation = await recovery.reserveSignatureIntent(unsigned);
    await recovery.persistSignedArtifact({ ...unsigned, signature: signed.signature });
    if (scenario === 'EXPIRED') {
      await assert.rejects(
        recovery.recoverExactTransaction({
          recoveryId: reservation.recoveryId,
          digest: transactionDigest,
          signer,
          descriptor: built.descriptor,
        }),
        (error) => error.code === 'MAKER_V8_LIFECYCLE_ABSENCE_INVALID',
      );
      assert.equal((await persistence.load(reservation.recoveryId)).status,
        MAKER_V8_LIFECYCLE_RECOVERY_STATUS.SIGNED_DURABLE);
      forgeAbsence = false;
    }
    await assert.rejects(
      recovery.recoverExactTransaction({
        recoveryId: reservation.recoveryId,
        digest: transactionDigest,
        signer,
        descriptor: built.descriptor,
      }),
      (error) => error.code === (scenario === 'FAILURE'
        ? 'MAKER_V8_LIFECYCLE_FINALIZED_FAILURE'
        : 'MAKER_V8_LIFECYCLE_TRANSACTION_EXPIRED'),
    );
    const record = await persistence.load(reservation.recoveryId);
    assert.equal(record.status, scenario === 'FAILURE'
      ? MAKER_V8_LIFECYCLE_RECOVERY_STATUS.FINALIZED_FAILURE
      : MAKER_V8_LIFECYCLE_RECOVERY_STATUS.EXPIRED_NOT_FOUND);
    assert.equal(executeCount, 0);

    const retryTransaction = fullTransactionFromKind(
      await built.transaction.build({ onlyTransactionKind: true }),
      '104',
      signer,
    );
    const retryBytes = await retryTransaction.build();
    const retryDigest = TransactionDataBuilder.getDigestFromBytes(retryBytes);
    const retryReservation = await recovery.reserveSignatureIntent({
      ...unsigned,
      bytes: toBase64(retryBytes),
      digest: retryDigest,
    });
    assert.notEqual(retryReservation.recoveryId, reservation.recoveryId);
  }
});

async function durableReadbackFixture({ registryIds = rootFields().publication.registry_ids } = {}) {
  let clock = 2_000;
  const indexedDB = new IDBFactory();
  const databaseName = `lifecycle-readback-${Math.random()}`;
  const persistence = createMakerV8LifecyclePersistenceV8(indexedDB, {
    databaseName,
    storageManager: storageManager(),
    now: () => ++clock,
  });
  const input = { action: 'PAUSE', ...actionInput() };
  const built = buildPauseMakerV8(runtime, actionInput());
  const kindBytes = await built.transaction.build({ onlyTransactionKind: true });
  const transaction = fullTransactionFromKind(kindBytes, '101');
  const transactionBytes = await transaction.build();
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  const signature = toBase64(Uint8Array.of(1));
  const intent = {
    schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
    action: built.action,
    descriptor: built.descriptor,
    input,
    bytes: toBase64(transactionBytes),
    digest: transactionDigest,
    signer: owner,
  };
  await persistence.reserveSignatureIntent(intent);
  const stored = await persistence.putSignedArtifact({ ...intent, signature }, '101');

  const lifecycleEventJson = {
    root_id: binding.rootId,
    catalog_id: runtime.catalogId,
    maker_version: '1',
    content_commitment: activation.contentCommitment,
    owner,
    control_epoch: '4',
    from: 1,
    to: 2,
    registry_ids: registryIds,
  };
  const event = {
    packageId: runtime.roles.release.callablePackageId,
    module: 'release_v8',
    sender: owner,
    eventType: built.descriptor.expectedEventType,
    bcs: serializeLifecycleEvent(lifecycleEventJson),
    json: lifecycleEventJson,
  };
  const eventDigest = makerV8TransactionEventsDigestV8([event]);
  const effectsValue = {
    V2: {
      status: { Success: true },
      executedEpoch: '100',
      gasUsed: {
        computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0',
      },
      transactionDigest,
      gasObjectIndex: null,
      eventsDigest: eventDigest.digest,
      dependencies: [],
      lamportVersion: '10',
      changedObjects: [[binding.rootId, {
        inputState: { Exist: [['9', preDigest], { Shared: { initialSharedVersion: '1' } }] },
        outputState: { ObjectWrite: [postDigest, { Shared: { initialSharedVersion: '1' } }] },
        idOperation: { None: true },
      }]],
      unchangedConsensusObjects: [],
      auxDataDigest: null,
    },
  };
  const effectsBytes = bcs.TransactionEffects.serialize(effectsValue).toBytes();
  const controls = {
    eventTo: 2,
    eventBcs: event.bcs,
    historicalDigest: postDigest,
    pinCalls: 0,
    driftAt: Number.POSITIVE_INFINITY,
  };
  const client = {
    async getChainIdentifier() {
      controls.pinCalls += 1;
      return {
        chainIdentifier: controls.pinCalls >= controls.driftAt
          ? digest(31) : MAKER_V8_MAINNET_GENESIS_DIGEST,
      };
    },
    async getFinalizedTransactionEvidence() {
      return {
        digest: transactionDigest,
        checkpoint: '900',
        epoch: '100',
        transactionBcs: transactionBytes,
        transactionBcsBase64: toBase64(transactionBytes),
        signatures: [signature],
        effectsBcs: effectsBytes,
        effectsBcsBase64: toBase64(effectsBytes),
        effectsStatus: { success: true, error: null },
        eventsDigest: eventDigest.digest,
        transactionEvents: { eventCount: 1 },
      };
    },
    core: {
      async getTransaction() {
        const data = transaction.getData();
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: transactionDigest,
            epoch: '100',
            status: { success: true },
            transaction: { sender: owner, commands: data.commands, inputs: data.inputs },
            bcs: transactionBytes,
            effects: {
              transactionDigest,
              status: { success: true },
              eventsDigest: eventDigest.digest,
              bcs: effectsBytes,
              changedObjects: [{
                objectId: binding.rootId,
                inputState: 'Exists',
                inputVersion: '9',
                inputDigest: preDigest,
                inputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
                outputState: 'ObjectWrite',
                outputVersion: '10',
                outputDigest: postDigest,
                outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
                idOperation: 'None',
              }],
              unchangedConsensusObjects: [],
            },
            events: [{
              ...event,
              bcs: controls.eventBcs,
              json: { ...event.json, to: controls.eventTo },
            }],
            objectTypes: { [binding.rootId]: types.root },
          },
        };
      },
    },
    async getHistoricalObject({ objectId, version }) {
      assert.equal(objectId, binding.rootId);
      assert.equal(version, 10n);
      return {
        objectId,
        version: '10',
        digest: controls.historicalDigest,
        type: types.root,
        owner: { Shared: { initial_shared_version: '1' } },
        previousTransaction: transactionDigest,
        parsed: rootFields(MAKER_V8_LIFECYCLE_STATES.PAUSED),
        contentBcs: Uint8Array.of(1),
        objectBcs: Uint8Array.of(2),
      };
    },
  };
  return {
    persistence, stored, built, transactionDigest, client, controls, indexedDB, databaseName,
  };
}

test('readback rejects a ledger-consistent event with the wrong eighth companion ID', async () => {
  const value = await durableReadbackFixture({ registryIds: {
    ...rootFields().publication.registry_ids, market_registry_id: id(9999),
  } });
  const readback = createMakerV8LifecycleReadbackAdapterV8({
    client: value.client, runtime, persistence: value.persistence,
    assertTransport(client) { assert.equal(client, value.client); },
  });
  await assert.rejects(readback.readFinalizedTransaction({
    digest: value.transactionDigest, expectedSender: owner,
    expectedEventTypes: [value.built.descriptor.expectedEventType],
  }), (error) => error.code === 'MAKER_V8_LIFECYCLE_EVENT_DRIFT');
});

test('readback binds durable bytes/signature, lifecycle event fields, raw effects, and exact historical Root', async () => {
  const value = await durableReadbackFixture();
  const readback = createMakerV8LifecycleReadbackAdapterV8({
    client: value.client,
    runtime,
    persistence: value.persistence,
    assertTransport(client) { assert.equal(client, value.client); },
  });
  const finalized = await readback.readFinalizedTransaction({
    digest: value.transactionDigest,
    expectedSender: owner,
    expectedEventTypes: [value.built.descriptor.expectedEventType],
  });
  const root = await readback.readRoot({
    rootId: binding.rootId,
    built: value.built,
    finalized,
  });
  assert.equal(root.lifecycleCode, MAKER_V8_LIFECYCLE_STATES.PAUSED);
  assert.equal(root.objectRef.digest, postDigest);

  value.controls.eventTo = 3;
  await assert.rejects(
    readback.readFinalizedTransaction({
      digest: value.transactionDigest,
      expectedSender: owner,
      expectedEventTypes: [value.built.descriptor.expectedEventType],
    }),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_EVENT_JSON_BCS_DRIFT',
  );
  value.controls.eventTo = 2;
  value.controls.eventBcs = Uint8Array.from(value.controls.eventBcs);
  value.controls.eventBcs[0] ^= 1;
  await assert.rejects(
    readback.readFinalizedTransaction({
      digest: value.transactionDigest,
      expectedSender: owner,
      expectedEventTypes: [value.built.descriptor.expectedEventType],
    }),
    (error) => error.code === 'MAKER_V8_COMPILER_EVENTS_DRIFT',
  );
  value.controls.eventBcs = serializeLifecycleEvent({
    root_id: binding.rootId,
    catalog_id: runtime.catalogId,
    maker_version: '1',
    content_commitment: activation.contentCommitment,
    owner,
    control_epoch: '4',
    from: 1,
    to: 2,
    registry_ids: rootFields().publication.registry_ids,
  });
  value.controls.driftAt = value.controls.pinCalls + 2;
  await assert.rejects(
    readback.readFinalizedTransaction({
      digest: value.transactionDigest,
      expectedSender: owner,
      expectedEventTypes: [value.built.descriptor.expectedEventType],
    }),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_NETWORK_DRIFT',
  );
  value.controls.driftAt = Number.POSITIVE_INFINITY;
  const freshFinalized = await readback.readFinalizedTransaction({
    digest: value.transactionDigest,
    expectedSender: owner,
    expectedEventTypes: [value.built.descriptor.expectedEventType],
  });
  value.controls.historicalDigest = digest(7);
  await assert.rejects(
    readback.readRoot({ rootId: binding.rootId, built: value.built, finalized: freshFinalized }),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_OBJECT_REF_DRIFT',
  );

  const database = await new Promise((resolve, reject) => {
    const request = value.indexedDB.open(value.databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction('recoveries', 'readwrite');
  const store = transaction.objectStore('recoveries');
  const raw = await new Promise((resolve, reject) => {
    const request = store.get(value.stored.recoveryId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const request = store.put({ ...raw, signature: toBase64(Uint8Array.of(2)) });
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  await assert.rejects(
    value.persistence.load(value.stored.recoveryId),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_RECOVERY_RECORD_INVALID',
  );
});

test('withdraw readback binds read-only Root, written Treasury, exact event, and historical arithmetic', async () => {
  const treasury = {
    schemaVersion: MAKER_V8_CHAIN_SCHEMA,
    network: MAKER_V8_CHAIN_NETWORK,
    objectId: binding.makerTreasuryId,
    version: 6n,
    digest: preDigest,
    type: types.makerTreasury,
    owner: { kind: 'shared', initialSharedVersion: 1n },
    fields: {
      id: binding.makerTreasuryId,
      version: '8',
      root_id: binding.rootId,
      maker_version: '1',
      root_content_commitment: activation.contentCommitment,
      revenue: { value: '500' },
      total_collected: '700',
      total_withdrawn: '200',
    },
    objectRef: { objectId: binding.makerTreasuryId, version: '6', digest: preDigest },
    rootId: binding.rootId,
    balanceAtomic: 500n,
    totalCollectedAtomic: 700n,
    totalWithdrawnAtomic: 200n,
  };
  const action = {
    wallet: { address: owner, network: 'mainnet' },
    root: parsedRoot,
    admin: parsedAdmin,
    makerTreasury: treasury,
    amountAtomic: '125',
    recipient: id(8_100),
  };
  const built = buildWithdrawMakerRevenueV8(runtime, action);
  const durableInput = { action: 'WITHDRAW_MAKER_REVENUE', ...action };
  const transaction = fullTransactionFromKind(
    await built.transaction.build({ onlyTransactionKind: true }),
    '101',
  );
  const transactionBytes = await transaction.build();
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  const signature = toBase64(Uint8Array.of(9));
  let clock = 4_000;
  const persistence = createMakerV8LifecyclePersistenceV8(new IDBFactory(), {
    databaseName: 'lifecycle-withdraw-readback',
    storageManager: storageManager(),
    now: () => ++clock,
  });
  const unsigned = {
    schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
    action: built.action,
    descriptor: built.descriptor,
    input: durableInput,
    bytes: toBase64(transactionBytes),
    digest: transactionDigest,
    signer: owner,
  };
  await persistence.reserveSignatureIntent(unsigned);
  await persistence.putSignedArtifact({ ...unsigned, signature }, '101');

  const withdrawEventJson = {
    root_id: binding.rootId,
    treasury_id: binding.makerTreasuryId,
    operator: owner,
    recipient: action.recipient,
    amount: '125',
  };
  const event = {
    packageId: runtime.roles.core.callablePackageId,
    module: 'treasury_v8',
    sender: owner,
    eventType: built.descriptor.expectedEventType,
    bcs: withdrawEventBcs.serialize(withdrawEventJson).toBytes(),
    json: withdrawEventJson,
  };
  const eventDigest = makerV8TransactionEventsDigestV8([event]);
  const effectsBytes = bcs.TransactionEffects.serialize({
    V2: {
      status: { Success: true },
      executedEpoch: '100',
      gasUsed: {
        computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0',
      },
      transactionDigest,
      gasObjectIndex: null,
      eventsDigest: eventDigest.digest,
      dependencies: [],
      lamportVersion: '10',
      changedObjects: [[binding.makerTreasuryId, {
        inputState: { Exist: [['6', preDigest], { Shared: { initialSharedVersion: '1' } }] },
        outputState: { ObjectWrite: [postDigest, { Shared: { initialSharedVersion: '1' } }] },
        idOperation: { None: true },
      }]],
      unchangedConsensusObjects: [[binding.rootId, { ReadOnlyRoot: ['9', preDigest] }]],
      auxDataDigest: null,
    },
  }).toBytes();
  const client = {
    async getChainIdentifier() {
      return { chainIdentifier: MAKER_V8_MAINNET_GENESIS_DIGEST };
    },
    async getFinalizedTransactionEvidence() {
      return {
        digest: transactionDigest,
        checkpoint: '901',
        epoch: '100',
        transactionBcs: transactionBytes,
        transactionBcsBase64: toBase64(transactionBytes),
        signatures: [signature],
        effectsBcs: effectsBytes,
        effectsBcsBase64: toBase64(effectsBytes),
        effectsStatus: { success: true, error: null },
        eventsDigest: eventDigest.digest,
        transactionEvents: { eventCount: 1 },
      };
    },
    core: {
      async getTransaction() {
        const data = transaction.getData();
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: transactionDigest,
            epoch: '100',
            status: { success: true },
            transaction: { sender: owner, commands: data.commands, inputs: data.inputs },
            bcs: transactionBytes,
            effects: {
              transactionDigest,
              status: { success: true },
              eventsDigest: eventDigest.digest,
              bcs: effectsBytes,
              changedObjects: [{
                objectId: binding.makerTreasuryId,
                inputState: 'Exists',
                inputVersion: '6',
                inputDigest: preDigest,
                inputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
                outputState: 'ObjectWrite',
                outputVersion: '10',
                outputDigest: postDigest,
                outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
                idOperation: 'None',
              }],
              unchangedConsensusObjects: [{
                kind: 'ReadOnlyRoot', objectId: binding.rootId, version: '9', digest: preDigest,
              }],
            },
            events: [event],
            objectTypes: { [binding.makerTreasuryId]: types.makerTreasury },
          },
        };
      },
    },
    async getHistoricalObject({ objectId, version }) {
      if (objectId === binding.rootId) {
        assert.equal(version, 9n);
        return {
          objectId, version: '9', digest: preDigest, type: types.root,
          owner: { Shared: { initial_shared_version: '1' } },
          previousTransaction: digest(5),
          parsed: rootFields(MAKER_V8_LIFECYCLE_STATES.ACTIVE),
          contentBcs: Uint8Array.of(1), objectBcs: Uint8Array.of(2),
        };
      }
      assert.equal(objectId, binding.makerTreasuryId);
      assert.equal(version, 10n);
      return {
        objectId, version: '10', digest: postDigest, type: types.makerTreasury,
        owner: { Shared: { initial_shared_version: '1' } },
        previousTransaction: transactionDigest,
        parsed: {
          ...treasury.fields,
          revenue: { value: '375' },
          total_withdrawn: '325',
        },
        contentBcs: Uint8Array.of(3), objectBcs: Uint8Array.of(4),
      };
    },
  };
  const adapter = createMakerV8LifecycleReadbackAdapterV8({
    client,
    runtime,
    persistence,
    assertTransport(value) { assert.equal(value, client); },
  });
  const finalized = await adapter.readFinalizedTransaction({
    digest: transactionDigest,
    expectedSender: owner,
    expectedEventTypes: [built.descriptor.expectedEventType],
  });
  const root = await adapter.readRoot({ rootId: binding.rootId, built, finalized });
  const makerTreasury = await adapter.readMakerTreasury({
    treasuryId: binding.makerTreasuryId,
    root,
    built,
    finalized,
  });
  const certified = certifyMakerV8LifecycleReadbackV8(built, {
    finalized,
    root,
    makerTreasury,
  });
  assert.equal(certified.root.lifecycleCode, MAKER_V8_LIFECYCLE_STATES.ACTIVE);
  assert.equal(certified.makerTreasury.balanceAtomic, '375');
  assert.equal(certified.makerTreasury.totalWithdrawnAtomic, '325');
});

test('production factory returns one directly injectable controller and exact shared execution projection', async () => {
  let factoryClock = 1_000;
  const persistence = createMakerV8LifecyclePersistenceV8(new IDBFactory(), {
    databaseName: 'lifecycle-production-factory',
    storageManager: storageManager(),
    signatureLeaseMs: 1_000,
    now: () => factoryClock,
  });
  const walletRegistry = {
    get() { return []; },
    on() { return () => {}; },
  };
  const client = {
    async getChainIdentifier() { return { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER }; },
    core: {},
  };
  const result = await createProductionMakerV8LifecycleAdaptersV8({
    client,
    runtime,
    persistence,
    walletRegistry,
    now: () => factoryClock,
    confirmNoSignedArtifact: async (request) => ({
      confirmed: true,
      recoveryId: request.recoveryId,
      sessionId: request.sessionId,
      checkedAt: request.checkedAt,
    }),
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: false, allowBroadcast: false,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  assert.equal(result.schemaVersion, MAKER_V8_LIFECYCLE_ADAPTERS_SCHEMA);
  assert.equal(result.controller.runtime, runtime);
  assert.equal(result.controller.execution.allowBroadcast, result.execution.allowBroadcast);
  assert.equal(typeof result.controller.recoverById, 'function');
  assert.equal(typeof result.controller.recoverActive, 'function');
  assert.equal(typeof result.controller.recoverByRoot, 'function');
  assert.equal(typeof result.controller.reclaimActive, 'function');
  assert.equal(result.controller.successorCapability.available, true);
  assert.equal(result.controller.successorCapability.status, 'ATOMIC_COMPILER');
  const built = buildPauseMakerV8(runtime, actionInput());
  const transaction = fullTransactionFromKind(
    await built.transaction.build({ onlyTransactionKind: true }),
    '101',
  );
  const bytes = await transaction.build();
  const reserved = await result.recovery.reserveSignatureIntent({
    schemaVersion: MAKER_V8_LIFECYCLE_CONTROLLER_SCHEMA,
    action: built.action,
    descriptor: built.descriptor,
    input: { action: 'PAUSE', ...actionInput() },
    bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes),
    signer: owner,
  });
  factoryClock = 2_001;
  await assert.doesNotReject(() => result.controller.reclaimActive({
    action: built.action,
    rootId: built.descriptor.preState.root.objectId,
    signer: owner,
  }));
  await assert.rejects(
    createProductionMakerV8LifecycleAdaptersV8({
      client,
      runtime,
      persistence,
      walletRegistry,
      browserAdapters: { rpc: {}, wallet: {} },
      execution: {
        network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
        allowWalletSignature: false, allowBroadcast: false,
      },
      assertTransport(value) { assert.equal(value, client); },
    }),
    (error) => error.code === 'MAKER_V8_LIFECYCLE_BROWSER_PROVENANCE_INVALID',
  );
});
