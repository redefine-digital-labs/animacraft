import assert from 'node:assert/strict';
import test from 'node:test';

import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8ChainTypes,
} from '../maker-v8-chain.js';
import {
  MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
} from '../maker-v8-pack-controller.js';
import {
  buildMakerV8PackLifecycleRequestV8,
  createMakerV8PackLifecycleAuthorityLoaderV8,
  createMakerV8PackLifecycleControllerV8,
  createMakerV8PackLifecycleReadbackV8,
} from '../maker-v8-pack-lifecycle.js';
import { createMakerV8PackPublicationMemoryPersistenceV8 } from '../maker-v8-pack-publication.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import { attestFixtureRuntime } from './fixtures/maker-v8-runtime-attestation.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const suiDigest = (value) => toBase58(new Uint8Array(32).fill(value));
const signer = id(900);
const gas = id(901);

function rawRuntime() {
  const roles = {};
  ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .forEach((role, index) => {
      roles[role] = {
        typeOriginPackageId: id(10 + index * 2),
        callablePackageId: id(11 + index * 2),
      };
    });
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: id(40),
    protocolConfigId: id(41),
    protocolTreasuryId: id(42),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: {
      seal: id(50), runtime: id(51), output: id(52), physical: id(53),
      market: id(54), release: id(55),
    },
    makerBindings: [],
  };
}

const runtime = await attestFixtureRuntime(rawRuntime());
const types = makerV8ChainTypes(runtime);

function ref(value) {
  return { objectId: id(value), version: String(value), digest: suiDigest(value) };
}

function request(action = 'PAUSE') {
  const releaseId = id(100);
  const adminCapId = id(101);
  const treasuryId = id(102);
  const registryId = id(103);
  const rootId = id(104);
  const sourceLifecycle = action === 'RESUME' ? 'PAUSED'
    : action === 'WITHDRAW_PACK_REVENUE' ? 'ARCHIVED' : 'ACTIVE';
  return buildMakerV8PackLifecycleRequestV8({
    draftId: 'pack-draft-1',
    draftRevision: 7,
    action,
    signer,
    pack: {
      rootId,
      packRegistryId: registryId,
      semanticPackId: 'moon_pack',
      packRegistryRevision: '12',
      sourceLifecycle,
      releaseId,
      adminCapId,
      treasuryId,
    },
    inputs: {
      release: {
        objectRef: ref(100), type: types.packRelease,
        owner: { kind: 'SHARED', initialSharedVersion: '2' },
        fields: {
          id: releaseId, root_id: rootId, admin_cap_id: adminCapId,
          treasury_id: treasuryId, semantic_pack_id: 'moon_pack', owner: signer,
          control_epoch: '0', lifecycle: sourceLifecycle === 'ACTIVE' ? '2'
            : sourceLifecycle === 'PAUSED' ? '3' : '4',
        },
      },
      adminCap: {
        objectRef: ref(101), type: types.packAdminCap,
        owner: { kind: 'ADDRESS', address: signer },
        fields: { id: adminCapId, release_id: releaseId, owner: signer, control_epoch: '0' },
      },
      treasury: {
        objectRef: ref(102), type: types.packTreasury,
        owner: { kind: 'SHARED', initialSharedVersion: '4' },
        fields: {
          id: treasuryId, release_id: releaseId, revenue: { fields: { value: '500' } },
          total_collected: '500', total_withdrawn: '0',
        },
      },
      packRegistry: {
        objectRef: ref(103), type: types.packRegistry,
        owner: { kind: 'SHARED', initialSharedVersion: '5' },
        fields: { id: registryId, root_id: rootId, revision: '12' },
      },
      admissionAuthority: null,
      definitionRegistry: null,
      root: null,
      makerAdmin: null,
      amountAtomic: action === 'WITHDRAW_PACK_REVENUE' ? '125' : null,
      recipient: ['WITHDRAW_PACK_REVENUE', 'TRANSFER_CONTROL'].includes(action) ? id(105) : null,
    },
  });
}

function revokeRequest() {
  const base = request('PAUSE');
  const makerAdminId = id(107);
  const definitionsId = id(108);
  const admissionId = id(109);
  const packRegistry = structuredClone(base.inputs.packRegistry);
  packRegistry.fields.definition_registry_id = definitionsId;
  packRegistry.fields.admission_authority_id = admissionId;
  return buildMakerV8PackLifecycleRequestV8({
    draftId: base.draftId,
    draftRevision: base.draftRevision,
    action: 'REVOKE_ADMISSION',
    signer,
    pack: base.pack,
    inputs: {
      ...structuredClone(base.inputs),
      packRegistry,
      root: {
        objectRef: ref(104), type: types.root,
        owner: { kind: 'SHARED', initialSharedVersion: '1' },
        fields: { id: base.pack.rootId, owner: signer, admin_cap_id: makerAdminId, control_epoch: '0' },
      },
      makerAdmin: {
        objectRef: ref(107), type: types.adminCap,
        owner: { kind: 'ADDRESS', address: signer },
        fields: { id: makerAdminId, root_id: base.pack.rootId, owner: signer, control_epoch: '0' },
      },
      definitionRegistry: {
        objectRef: ref(108), type: types.runtimeDefinitions,
        owner: { kind: 'SHARED', initialSharedVersion: '3' },
        fields: { id: definitionsId, root_id: base.pack.rootId },
      },
      admissionAuthority: {
        objectRef: ref(109), type: types.packAdmissionAuthority,
        owner: { kind: 'SHARED', initialSharedVersion: '4' },
        fields: { id: admissionId, root_id: base.pack.rootId },
      },
      amountAtomic: null,
      recipient: null,
    },
  });
}

function absence(transactionDigest, checkpoint = '9') {
  return {
    schemaVersion: 'animacraft.sui-transaction-absence.v8',
    kind: 'SUI_GRPC_TRANSACTION_NOT_FOUND',
    grpcCode: 'NOT_FOUND',
    grpcService: 'sui.rpc.v2.LedgerService',
    grpcMethod: 'GetTransaction',
    requestedDigest: transactionDigest,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    watermarkEpoch: '1',
    watermarkCheckpointSequence: checkpoint,
    watermarkCheckpointDigest: suiDigest(Number(checkpoint)),
  };
}

function harness({
  action = 'PAUSE', unknown = false, finalizedFailure = false, requestOverride = null,
} = {}) {
  const order = [];
  const targets = [];
  const durableRequest = requestOverride ?? request(action);
  const persistence = createMakerV8PackPublicationMemoryPersistenceV8();
  let queryCount = 0;
  const lifecycle = createMakerV8PackLifecycleControllerV8({
    runtime,
    loadRequest: async () => durableRequest,
    persistence,
    boundary: {
      async buildExactTransaction({ transaction, descriptor }) {
        order.push('build');
        targets.push(...descriptor.targets);
        transaction.setExpiration({ Epoch: '2' });
        transaction.setGasPrice(1n);
        transaction.setGasBudget(1_000_000n);
        transaction.setGasPayment([{ objectId: gas, version: '1', digest: suiDigest(7) }]);
        const bytes = await transaction.build();
        return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) };
      },
      async dryRunExactTransaction() {
        order.push('dry-run');
        return { status: 'SUCCESS' };
      },
      async broadcastExactTransaction({ digest: transactionDigest }) {
        order.push('broadcast');
        return { accepted: true, digest: transactionDigest };
      },
    },
    wallet: {
      async signExactTransaction({ bytes, digest: transactionDigest, signer: address }) {
        order.push('sign');
        return { bytes, digest: transactionDigest, signer: address, signature: toBase64(Uint8Array.of(1, 2, 3)) };
      },
      async verifyExactSignature() {
        order.push('verify');
        return true;
      },
    },
    rpc: {
      async queryTransaction({ digest: transactionDigest }) {
        order.push('query');
        queryCount += 1;
        if (unknown) throw Object.assign(new Error('transport unavailable'), { code: 'UNAVAILABLE' });
        if (finalizedFailure) {
          return {
            status: 'FINALIZED_FAILURE', digest: transactionDigest, epoch: '2',
            effectsFingerprint: 'cc'.repeat(32), eventsDigest: null,
            error: { code: 'MOVE_ABORT', message: 'pack lifecycle rejected' }, absence: null,
          };
        }
        if (queryCount <= 2) {
          return {
            status: 'NOT_FOUND', digest: transactionDigest, epoch: null,
            effectsFingerprint: null, eventsDigest: null, error: null,
            absence: absence(transactionDigest, String(8 + queryCount)),
          };
        }
        return {
          status: 'FINALIZED_SUCCESS', digest: transactionDigest, epoch: '2',
          effectsFingerprint: 'aa'.repeat(32), eventsDigest: 'bb'.repeat(32),
          error: null, absence: null,
        };
      },
    },
    certifyFinalized: async ({ request: checked, artifact }) => ({
      schemaVersion: 'animacraft.maker-v8-pack-chain-readback.v1',
      rootId: checked.pack.rootId,
      packRegistryId: checked.pack.packRegistryId,
      semanticPackId: checked.pack.semanticPackId,
      release: {
        objectRef: { ...checked.inputs.release.objectRef, version: '200', digest: suiDigest(20) },
        owner: checked.signer,
        controlEpoch: '0',
      },
      adminCap: {
        objectRef: checked.inputs.adminCap.objectRef,
        releaseId: checked.pack.releaseId,
        owner: checked.signer,
        controlEpoch: '0',
      },
      treasury: { objectRef: checked.inputs.treasury.objectRef, releaseId: checked.pack.releaseId },
      lifecycle: action === 'PAUSE' ? 'PAUSED' : action === 'RESUME' ? 'ACTIVE'
        : action === 'ARCHIVE' ? 'ARCHIVED' : checked.pack.sourceLifecycle,
      packRegistryRevision: checked.pack.packRegistryRevision,
      finalizedDigest: artifact.digest,
    }),
    execution: { allowWalletSignature: true, allowBroadcast: true },
    now: (() => { let value = 100; return () => value += 1; })(),
  });
  return { lifecycle, durableRequest, order, targets, get queryCount() { return queryCount; } };
}

test('independent Pack lifecycle compiles exact Runtime target and performs durable query-first replay', async () => {
  const fixture = harness();
  const ticket = await fixture.lifecycle.prepare(fixture.lifecycle.build({}));
  assert.equal(ticket.schemaVersion, MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA);
  const result = await fixture.lifecycle.recover(ticket);
  assert.equal(result.status, 'FINALIZED_SUCCESS');
  assert.equal(result.readback.lifecycle, 'PAUSED');
  assert.equal(fixture.queryCount, 3, 'recovery proves two typed absences before exact-byte replay');
  assert.deepEqual(fixture.order, [
    'build', 'dry-run', 'sign', 'verify',
    'query', 'query', 'verify', 'broadcast', 'query', 'verify',
  ]);
});

test('Pack lifecycle unknown outcome never fabricates finalized readback or rebroadcasts', async () => {
  const fixture = harness({ unknown: true });
  const ticket = await fixture.lifecycle.prepare(fixture.lifecycle.build({}));
  const result = await fixture.lifecycle.recover(ticket);
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(result.readback, null);
  assert.equal(fixture.order.includes('broadcast'), false);
  assert.equal(fixture.queryCount, 1);
});

test('Pack lifecycle finalized failure is terminal and never fabricates readback or rebroadcasts', async () => {
  const fixture = harness({ finalizedFailure: true });
  const ticket = await fixture.lifecycle.prepare(fixture.lifecycle.build({}));
  const result = await fixture.lifecycle.recover(ticket);
  assert.equal(result.status, 'FINALIZED_FAILURE');
  assert.equal(result.readback, null);
  assert.equal(fixture.order.includes('broadcast'), false);
  assert.equal(fixture.queryCount, 1);
});

test('Pack lifecycle supports resume, archive, control transfer, revenue withdrawal and admission revocation exact targets', async () => {
  for (const action of ['RESUME', 'ARCHIVE', 'TRANSFER_CONTROL', 'WITHDRAW_PACK_REVENUE']) {
    const fixture = harness({ action, unknown: true });
    const ticket = await fixture.lifecycle.prepare(fixture.lifecycle.build({}));
    assert.equal(typeof ticket.digest, 'string');
    assert.equal(fixture.order.slice(0, 4).join(','), 'build,dry-run,sign,verify');
    assert.equal(fixture.targets[0].endsWith(`::${action === 'TRANSFER_CONTROL'
      ? 'transfer_pack_control_v8' : action === 'WITHDRAW_PACK_REVENUE'
        ? 'withdraw_pack_revenue_v8' : action === 'RESUME'
          ? 'resume_pack_release_v8' : 'archive_pack_release_v8'}`), true);
  }
  const revoked = harness({
    action: 'REVOKE_ADMISSION', unknown: true, requestOverride: revokeRequest(),
  });
  await revoked.lifecycle.prepare(revoked.lifecycle.build({}));
  assert.equal(revoked.targets[0].endsWith('::revoke_pack_admission_v8'), true);
});

test('Pack lifecycle request rejects invalid source transitions and cross-bound object mutation', () => {
  const active = request('PAUSE');
  assert.throws(
    () => buildMakerV8PackLifecycleRequestV8({
      draftId: active.draftId,
      draftRevision: active.draftRevision,
      action: 'RESUME',
      signer: active.signer,
      pack: { ...active.pack, sourceLifecycle: 'ACTIVE' },
      inputs: active.inputs,
    }),
    { code: 'MAKER_V8_PACK_LIFECYCLE_TRANSITION_INVALID' },
  );
  assert.throws(
    () => buildMakerV8PackLifecycleRequestV8({
      draftId: active.draftId,
      draftRevision: active.draftRevision,
      action: active.action,
      signer: active.signer,
      pack: active.pack,
      inputs: { ...active.inputs, adminCap: { ...active.inputs.adminCap, owner: { kind: 'ADDRESS', address: id(999) } } },
    }),
    { code: 'MAKER_V8_PACK_LIFECYCLE_AUTHORITY_DRIFT' },
  );
});

function rpcOwner(input) {
  return input.owner.kind === 'SHARED'
    ? { Shared: { initial_shared_version: input.owner.initialSharedVersion } }
    : { AddressOwner: input.owner.address };
}

function currentResponse(input) {
  return {
    data: {
      objectId: input.objectRef.objectId,
      version: input.objectRef.version,
      digest: input.objectRef.digest,
      type: input.type,
      owner: rpcOwner(input),
      content: { dataType: 'moveObject', type: input.type, fields: structuredClone(input.fields) },
    },
  };
}

function historicalValue(input, parsed = input.fields, transactionDigest = suiDigest(31)) {
  return {
    objectId: input.objectRef.objectId,
    version: input.objectRef.version,
    digest: input.objectRef.digest,
    type: input.type,
    previousTransaction: transactionDigest,
    parsed: structuredClone(parsed),
    contentBcs: Uint8Array.of(1),
    objectBcs: Uint8Array.of(2),
  };
}

function authorityBuildInput(checked) {
  return {
    action: checked.action,
    draftRevision: checked.draftRevision,
    amountAtomic: checked.inputs.amountAtomic,
    recipient: checked.inputs.recipient,
    pack: {
      draftId: checked.draftId,
      rootId: checked.pack.rootId,
      packRegistryId: checked.pack.packRegistryId,
      semanticPackId: checked.pack.semanticPackId,
      chain: {
        release: { objectRef: checked.inputs.release.objectRef },
        adminCap: { objectRef: checked.inputs.adminCap.objectRef },
        treasury: { objectRef: checked.inputs.treasury.objectRef },
        lifecycle: checked.pack.sourceLifecycle,
        packRegistryRevision: checked.pack.packRegistryRevision,
      },
    },
  };
}

test('production Pack lifecycle authority cold-reads exact refs and rejects current BCS/JSON drift', async () => {
  const checked = request('PAUSE');
  const inputs = Object.fromEntries(['release', 'adminCap', 'treasury', 'packRegistry']
    .map((name) => [checked.inputs[name].objectRef.objectId, checked.inputs[name]]));
  let drift = false;
  const client = {
    async getObject({ id: objectId }) { return currentResponse(inputs[objectId]); },
    async getHistoricalObject({ objectId }) {
      const input = inputs[objectId];
      const parsed = structuredClone(input.fields);
      if (drift && objectId === checked.pack.packRegistryId) parsed.revision = '13';
      return historicalValue(input, parsed);
    },
  };
  const load = createMakerV8PackLifecycleAuthorityLoaderV8({
    client,
    runtime,
    wallet: { async getCurrentAccount() { return { address: signer }; } },
    assertTransport: () => {},
  });
  const observed = await load(authorityBuildInput(checked));
  assert.equal(observed.documentSha256, checked.documentSha256);
  drift = true;
  await assert.rejects(
    load(authorityBuildInput(checked)),
    { code: 'MAKER_V8_PACK_LIFECYCLE_CURRENT_BCS_DRIFT' },
  );
});

test('Pack admission revocation cold-loads the exact Maker governance tuple', async () => {
  const checked = revokeRequest();
  const names = [
    'release', 'adminCap', 'treasury', 'packRegistry',
    'admissionAuthority', 'definitionRegistry', 'root', 'makerAdmin',
  ];
  const inputs = Object.fromEntries(names.map((name) => [
    checked.inputs[name].objectRef.objectId,
    checked.inputs[name],
  ]));
  const client = {
    async getObject({ id: objectId }) { return currentResponse(inputs[objectId]); },
    async getHistoricalObject({ objectId }) { return historicalValue(inputs[objectId]); },
  };
  const load = createMakerV8PackLifecycleAuthorityLoaderV8({
    client, runtime,
    wallet: { async getCurrentAccount() { return { address: signer }; } },
    assertTransport: () => {},
  });
  const observed = await load(checked);
  assert.equal(observed.action, 'REVOKE_ADMISSION');
  assert.equal(observed.inputs.root.objectRef.objectId, checked.pack.rootId);
  assert.equal(observed.inputs.makerAdmin.owner.address, signer);
  assert.equal(observed.documentSha256, checked.documentSha256);
});

function transitionReadbackFixture({ eventJsonLifecycle = 3 } = {}) {
  const checked = request('PAUSE');
  const transactionDigest = suiDigest(32);
  const postRelease = structuredClone(checked.inputs.release.fields);
  postRelease.lifecycle = '3';
  const outputRef = { objectId: checked.pack.releaseId, version: '200', digest: suiDigest(20) };
  const eventBytes = bcs.struct('PackLifecycleChangedV8', {
    release_id: bcs.Address,
    previous_lifecycle: bcs.u8(),
    lifecycle: bcs.u8(),
  }).serialize({ release_id: checked.pack.releaseId, previous_lifecycle: 2, lifecycle: 3 }).toBytes();
  const response = {
    compilerTransactionKindProof: { transactionKindSha256: 'a'.repeat(64) },
    objectChanges: [{
      type: 'mutated', objectId: outputRef.objectId, version: outputRef.version,
      digest: outputRef.digest, objectType: types.packRelease,
    }],
    compilerEffectsOutputRefs: [{ ...outputRef, owner: { kind: 'Shared', value: '2' } }],
    events: [{
      type: `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackLifecycleChangedV8`,
      sender: signer,
      bcs: toBase64(eventBytes),
      parsedJson: {
        release_id: checked.pack.releaseId,
        previous_lifecycle: '2',
        lifecycle: String(eventJsonLifecycle),
      },
    }],
  };
  const client = {
    async getHistoricalObject({ objectId }) {
      assert.equal(objectId, checked.pack.releaseId);
      return {
        objectId: outputRef.objectId, version: outputRef.version, digest: outputRef.digest,
        previousTransaction: transactionDigest, type: types.packRelease,
        parsed: postRelease, contentBcs: Uint8Array.of(3), objectBcs: Uint8Array.of(4),
      };
    },
  };
  return { checked, transactionDigest, response, client };
}

test('Pack lifecycle transition readback binds raw event BCS, Core effects and historical state', async () => {
  const fixture = transitionReadbackFixture();
  const certify = createMakerV8PackLifecycleReadbackV8({
    client: fixture.client,
    runtime,
    readFinalized: async () => fixture.response,
    assertTransport: () => {},
  });
  const readback = await certify({
    request: fixture.checked,
    artifact: { digest: fixture.transactionDigest },
    transaction: {},
    descriptor: { kindSha256: 'a'.repeat(64) },
  });
  assert.equal(readback.lifecycle, 'PAUSED');
  assert.equal(readback.release.objectRef.version, '200');

  const drift = transitionReadbackFixture({ eventJsonLifecycle: 4 });
  const rejectDrift = createMakerV8PackLifecycleReadbackV8({
    client: drift.client,
    runtime,
    readFinalized: async () => drift.response,
    assertTransport: () => {},
  });
  await assert.rejects(
    rejectDrift({
      request: drift.checked,
      artifact: { digest: drift.transactionDigest },
      transaction: {},
      descriptor: { kindSha256: 'a'.repeat(64) },
    }),
    { code: 'MAKER_V8_PACK_LIFECYCLE_EVENT_DRIFT' },
  );
});

test('Pack revenue withdrawal readback proves exact treasury arithmetic and recipient Coin', async () => {
  const checked = request('WITHDRAW_PACK_REVENUE');
  const transactionDigest = suiDigest(33);
  const treasuryRef = { objectId: checked.pack.treasuryId, version: '201', digest: suiDigest(21) };
  const coinRef = { objectId: id(106), version: '201', digest: suiDigest(22) };
  const coinType = `0x2::coin::Coin<${runtime.paymentCoinType}>`;
  const postTreasury = structuredClone(checked.inputs.treasury.fields);
  postTreasury.revenue.fields.value = '375';
  postTreasury.total_withdrawn = '125';
  const response = {
    compilerTransactionKindProof: { transactionKindSha256: 'b'.repeat(64) },
    objectChanges: [
      { type: 'mutated', objectId: treasuryRef.objectId, version: treasuryRef.version, digest: treasuryRef.digest, objectType: types.packTreasury },
      { type: 'created', objectId: coinRef.objectId, version: coinRef.version, digest: coinRef.digest, objectType: coinType },
    ],
    compilerEffectsOutputRefs: [
      { ...treasuryRef, owner: { kind: 'Shared', value: '4' } },
      { ...coinRef, owner: { kind: 'AddressOwner', value: checked.inputs.recipient } },
    ],
    events: [],
  };
  let coinValue = '125';
  const client = {
    async getHistoricalObject({ objectId }) {
      if (objectId === treasuryRef.objectId) {
        return {
          ...treasuryRef, previousTransaction: transactionDigest, type: types.packTreasury,
          parsed: postTreasury, contentBcs: Uint8Array.of(5), objectBcs: Uint8Array.of(6),
        };
      }
      return {
        ...coinRef, previousTransaction: transactionDigest, type: coinType,
        parsed: { id: coinRef.objectId, balance: { fields: { value: coinValue } } },
        contentBcs: Uint8Array.of(7), objectBcs: Uint8Array.of(8),
      };
    },
  };
  const certify = createMakerV8PackLifecycleReadbackV8({
    client, runtime, readFinalized: async () => response, assertTransport: () => {},
  });
  const input = {
    request: checked,
    artifact: { digest: transactionDigest },
    transaction: {},
    descriptor: { kindSha256: 'b'.repeat(64) },
  };
  const readback = await certify(input);
  assert.equal(readback.treasury.objectRef.version, '201');
  assert.equal(readback.lifecycle, 'ARCHIVED');
  coinValue = '124';
  await assert.rejects(certify(input), { code: 'MAKER_V8_PACK_LIFECYCLE_RECIPIENT_DRIFT' });
});

test('Pack control transfer readback proves the exact new owner and shared control epoch', async () => {
  const checked = request('TRANSFER_CONTROL');
  const transactionDigest = suiDigest(34);
  const nextEpoch = '1';
  const releaseRef = { objectId: checked.pack.releaseId, version: '202', digest: suiDigest(23) };
  const capRef = { objectId: checked.pack.adminCapId, version: '202', digest: suiDigest(24) };
  const postRelease = structuredClone(checked.inputs.release.fields);
  postRelease.owner = checked.inputs.recipient;
  postRelease.control_epoch = nextEpoch;
  const postCap = structuredClone(checked.inputs.adminCap.fields);
  postCap.owner = checked.inputs.recipient;
  postCap.control_epoch = nextEpoch;
  let capOwner = checked.inputs.recipient;
  const response = {
    compilerTransactionKindProof: { transactionKindSha256: 'd'.repeat(64) },
    objectChanges: [
      { type: 'mutated', objectId: releaseRef.objectId, version: releaseRef.version, digest: releaseRef.digest, objectType: types.packRelease },
      { type: 'mutated', objectId: capRef.objectId, version: capRef.version, digest: capRef.digest, objectType: types.packAdminCap },
    ],
    compilerEffectsOutputRefs: [
      { ...releaseRef, owner: { kind: 'Shared', value: '2' } },
      { ...capRef, owner: { kind: 'AddressOwner', value: checked.inputs.recipient } },
    ],
    events: [],
  };
  const client = {
    async getHistoricalObject({ objectId }) {
      const cap = objectId === capRef.objectId;
      const parsed = structuredClone(cap ? postCap : postRelease);
      if (cap) parsed.owner = capOwner;
      return {
        ...(cap ? capRef : releaseRef), previousTransaction: transactionDigest,
        type: cap ? types.packAdminCap : types.packRelease,
        parsed, contentBcs: Uint8Array.of(9), objectBcs: Uint8Array.of(10),
      };
    },
  };
  const certify = createMakerV8PackLifecycleReadbackV8({
    client, runtime, readFinalized: async () => response, assertTransport: () => {},
  });
  const input = {
    request: checked, artifact: { digest: transactionDigest }, transaction: {},
    descriptor: { kindSha256: 'd'.repeat(64) },
  };
  const readback = await certify(input);
  assert.equal(readback.release.owner, checked.inputs.recipient);
  assert.equal(readback.adminCap.owner, checked.inputs.recipient);
  assert.equal(readback.release.controlEpoch, nextEpoch);
  capOwner = signer;
  await assert.rejects(certify(input), { code: 'MAKER_V8_PACK_LIFECYCLE_CONTROL_DRIFT' });
});

test('Pack admission revocation readback binds registry CAS and raw event BCS', async () => {
  const checked = revokeRequest();
  const transactionDigest = suiDigest(35);
  const registryRef = { objectId: checked.pack.packRegistryId, version: '203', digest: suiDigest(25) };
  const postRegistry = structuredClone(checked.inputs.packRegistry.fields);
  postRegistry.revision = '13';
  const eventSchema = bcs.struct('PackRegistryRevisionAdvancedV8', {
    root_id: bcs.Address,
    previous_revision: bcs.u64(),
    revision: bcs.u64(),
    subject_id: bcs.Address,
    operation: bcs.u8(),
  });
  const eventBytes = eventSchema.serialize({
    root_id: checked.pack.rootId,
    previous_revision: 12n,
    revision: 13n,
    subject_id: checked.pack.releaseId,
    operation: 1,
  }).toBytes();
  let displayedOperation = '1';
  const response = {
    compilerTransactionKindProof: { transactionKindSha256: 'e'.repeat(64) },
    objectChanges: [{
      type: 'mutated', objectId: registryRef.objectId, version: registryRef.version,
      digest: registryRef.digest, objectType: types.packRegistry,
    }],
    compilerEffectsOutputRefs: [{ ...registryRef, owner: { kind: 'Shared', value: '5' } }],
    get events() {
      return [{
        type: `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackRegistryRevisionAdvancedV8`,
        sender: signer,
        bcs: toBase64(eventBytes),
        parsedJson: {
          root_id: checked.pack.rootId,
          previous_revision: '12',
          revision: '13',
          subject_id: checked.pack.releaseId,
          operation: displayedOperation,
        },
      }];
    },
  };
  const client = {
    async getHistoricalObject() {
      return {
        ...registryRef, previousTransaction: transactionDigest, type: types.packRegistry,
        parsed: postRegistry, contentBcs: Uint8Array.of(11), objectBcs: Uint8Array.of(12),
      };
    },
  };
  const certify = createMakerV8PackLifecycleReadbackV8({
    client, runtime, readFinalized: async () => response, assertTransport: () => {},
  });
  const input = {
    request: checked, artifact: { digest: transactionDigest }, transaction: {},
    descriptor: { kindSha256: 'e'.repeat(64) },
  };
  const readback = await certify(input);
  assert.equal(readback.packRegistryRevision, '13');
  assert.equal(readback.lifecycle, 'ACTIVE');
  displayedOperation = '0';
  await assert.rejects(certify(input), { code: 'MAKER_V8_PACK_LIFECYCLE_EVENT_DRIFT' });
});
