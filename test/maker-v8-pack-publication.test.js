import assert from 'node:assert/strict';
import test from 'node:test';

import { Transaction } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
  MAKER_V8_PACK_PUBLICATION_SCHEMA,
  createMakerV8PackPublicationControllerV8,
  createMakerV8PackPublicationMemoryPersistenceV8,
} from '../maker-v8-pack-publication.js';
import { MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA } from '../maker-v8-pack-controller.js';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { packPublicationAuthoringContent } from '../maker-v8-pack-authoring.js';
import { compileMakerV8PackDefinitionRowsV8, planMakerV8PackDefinitionRegistrationV8,
  buildMakerV8PackDefinitionStepV8 } from '../maker-v8-pack-definitions-compiler.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = (value) => toBase58(new Uint8Array(32).fill(value));
const SIGNER = id(9);
const PACKAGE = id(77);
const CHAIN = '35834a8a';

function notFound(transactionDigest, checkpoint = 1) {
  return {
    status: 'NOT_FOUND', digest: transactionDigest,
    epoch: null, effectsFingerprint: null, eventsDigest: null, error: null,
    absence: {
      schemaVersion: 'animacraft.sui-transaction-absence.v8',
      kind: 'SUI_GRPC_TRANSACTION_NOT_FOUND',
      grpcCode: 'NOT_FOUND',
      grpcService: 'sui.rpc.v2.LedgerService',
      grpcMethod: 'GetTransaction',
      requestedDigest: transactionDigest,
      chainIdentifier: CHAIN,
      watermarkEpoch: '1',
      watermarkCheckpointSequence: String(checkpoint),
      watermarkCheckpointDigest: digest(checkpoint + 20),
    },
  };
}

async function descriptor(stage, ordinal, definitionTransaction = null) {
  const transaction = definitionTransaction ?? new Transaction();
  transaction.setSender(SIGNER);
  if (!definitionTransaction) transaction.moveCall({
    target: `${PACKAGE}::runtime_v8::${stage.toLowerCase()}_pack_publication_v8`,
    arguments: [],
  });
  const raw = await transaction.build({ onlyTransactionKind: true });
  const kindBytes = toBase64(raw);
  const kindSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    transaction,
    value: {
      schemaVersion: MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
      ordinal,
      stage,
      startStyle: stage === 'APPEND' ? 0 : stage === 'FINALIZE' ? 1 : 0,
      endStyle: stage === 'APPEND' ? 1 : stage === 'FINALIZE' ? 1 : 0,
      signer: SIGNER,
      kindBytes,
      kindSha256,
      targets: transaction.getData().commands.filter(command => command.MoveCall)
        .map(({ MoveCall: call }) => `${call.package}::${call.module}::${call.function}`),
      checkpoint: { stage, ordinal },
    },
  };
}

async function fullTransaction(kindBytes) {
  const transaction = Transaction.fromKind(kindBytes);
  transaction.setSender(SIGNER);
  transaction.setGasPrice(1);
  transaction.setGasBudget(10_000_000);
  transaction.setGasPayment([{ objectId: id(500), version: '1', digest: digest(5) }]);
  transaction.setExpiration({ Epoch: 99 });
  return toBase64(await transaction.build());
}

async function harness({ durable = true, execution = true,
  stages = ['INIT', 'APPEND', 'FINALIZE'], buildDescriptor = descriptor, certify = null } = {}) {
  const persistence = createMakerV8PackPublicationMemoryPersistenceV8({ durable });
  const authority = {};
  const order = [];
  const compiler = {
    authority,
    async prepare() {
      const built = await buildDescriptor('INIT', 0);
      return { authority, attemptId: 'pack-attempt-1', descriptor: built.value, transaction: built.transaction };
    },
    async rehydrate({ plan, purpose }) {
      order.push(`rehydrate:${purpose}`);
      const built = await buildDescriptor(plan.current.descriptor.stage, plan.current.descriptor.ordinal);
      return { authority, descriptor: built.value, transaction: built.transaction };
    },
    async prepareSuccessor({ head }) {
      const nextOrdinal = head.ordinal + 1;
      const stage = stages[nextOrdinal];
      const built = await buildDescriptor(stage, nextOrdinal);
      return { authority, descriptor: built.value, transaction: built.transaction };
    },
    async certifyFinalized({ plan, artifact }) {
      if (certify) await certify(plan, artifact);
      const stage = plan.current.descriptor.stage;
      return {
        authority,
        checkpoint: {
          ordinal: plan.current.descriptor.ordinal,
          stage,
          digest: artifact.digest,
          kindSha256: plan.current.descriptor.kindSha256,
        },
        complete: stage === 'FINALIZE',
        chain: stage === 'FINALIZE' ? { schemaVersion: 'animacraft.pack-chain.v1', releaseId: id(100) } : null,
      };
    },
  };
  const boundary = {
    async buildExactTransaction({ descriptor: value }) {
      order.push(`build:${value.stage}`);
      const bytes = await fullTransaction(value.kindBytes);
      const { TransactionDataBuilder } = await import('@mysten/sui/transactions');
      return { bytes, digest: TransactionDataBuilder.getDigestFromBytes((await import('@mysten/sui/utils')).fromBase64(bytes)) };
    },
    async dryRunExactTransaction({ descriptor: value }) {
      order.push(`dry-run:${value.stage}`);
      return { status: 'SUCCESS' };
    },
    async broadcastExactTransaction({ digest: transactionDigest }) {
      order.push(`broadcast:${transactionDigest}`);
      return { accepted: true, digest: transactionDigest };
    },
  };
  const wallet = {
    async signExactTransaction(input) {
      order.push(`sign:${input.digest}`);
      return { ...input, signature: toBase64(Uint8Array.from([1, 2, 3])) };
    },
    async verifyExactSignature() { return { verified: true }; },
  };
  const responses = [];
  const rpc = {
    async queryTransaction({ digest: transactionDigest }) {
      const current = await persistence.load('pack-attempt-1');
      order.push(`query:${current.current.outcome.status}`);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? notFound(transactionDigest);
    },
  };
  let time = 100;
  const reboot = () => createMakerV8PackPublicationControllerV8({
    persistence, compiler, boundary, wallet, rpc,
    execution: { allowWalletSignature: execution, allowBroadcast: execution },
    now: () => time++,
  });
  return { controller: reboot(), reboot, persistence, responses, order };
}

const request = {
  schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
  kind: 'PACK',
  draftId: 'moon-pack',
  draftRevision: 3,
  documentSha256: 'a'.repeat(64),
  publicationInput: {
    schemaVersion: 'animacraft.pack-compiled.v1', signer: SIGNER, chainIdentifier: CHAIN,
  },
};

test('dedicated Pack WAL is query-first and advances INIT, APPEND, FINALIZE without Maker topology', async () => {
  const { controller, persistence, responses, order } = await harness();
  assert.equal(controller.schemaVersion, MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA);
  let plan = await controller.prepare(request);
  assert.equal(plan.schemaVersion, MAKER_V8_PACK_PUBLICATION_SCHEMA);
  assert.equal(plan.current.descriptor.stage, 'INIT');

  plan = await controller.requestSignature(plan.attemptId);
  assert.equal(plan.current.outcome.status, 'SIGNED');
  plan = await controller.recoverOutcome(plan.attemptId);
  assert.equal(plan.current.outcome.status, 'OUTCOME_PENDING');
  assert.ok(order.includes('query:OUTCOME_PENDING'), 'query occurs only after pending WAL cold-read');

  responses.push(notFound(plan.current.outcome.digest, 2));
  responses.push({
    status: 'FINALIZED_SUCCESS', digest: plan.current.outcome.digest,
    epoch: '1', effectsFingerprint: `0x${'1'.repeat(64)}`, eventsDigest: digest(8), error: null, absence: null,
  });
  plan = await controller.replayExact(plan.attemptId);
  assert.equal(plan.current, null);
  assert.equal(plan.nextPreparation.ordinal, 1);
  assert.ok(order.some((entry) => entry.startsWith('broadcast:')));

  for (const expected of ['APPEND', 'FINALIZE']) {
    plan = await controller.resume(plan.attemptId);
    assert.equal(plan.current.descriptor.stage, expected);
    plan = await controller.requestSignature(plan.attemptId);
    responses.push({
      status: 'FINALIZED_SUCCESS', digest: plan.current.outcome.digest,
      epoch: '1', effectsFingerprint: `0x${'2'.repeat(64)}`, eventsDigest: digest(9), error: null, absence: null,
    });
    plan = await controller.recoverOutcome(plan.attemptId);
  }
  assert.equal(plan.status, 'COMPLETE');
  assert.equal(plan.terminal.chain.releaseId, id(100));
  assert.equal((await persistence.listEvents(plan.attemptId)).length, 13);
});

test('Pack publication gates, compiler kind drift, and non-durable persistence fail closed', async () => {
  const disabled = await harness({ execution: false });
  const prepared = await disabled.controller.prepare(request);
  await assert.rejects(
    disabled.controller.requestSignature(prepared.attemptId),
    (error) => error.code === 'MAKER_V8_PACK_PUBLICATION_EXECUTION_DISABLED',
  );

  const volatile = await harness({ durable: false });
  await assert.rejects(
    volatile.controller.prepare(request),
    (error) => error.code === 'MAKER_V8_PACK_PUBLICATION_PERSISTENCE_REQUIRED',
  );

  const drift = await harness();
  const driftPlan = await drift.controller.prepare(request);
  const raw = structuredClone(await drift.persistence.load(driftPlan.attemptId));
  raw.current.descriptor.kindSha256 = 'f'.repeat(64);
  await assert.rejects(
    drift.persistence.compareAndSwap(raw.attemptId, raw.revision, { ...raw, revision: raw.revision + 1 }),
    (error) => error.code === 'MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_INVALID',
  );
});

test('existing WAL cold-recovers real definition PTBs without resending accepted batches or treating definition finalization as publication completion', async () => {
  const parent = createCreatorCharacterStarter();
  parent.assets.push({ id: 'base-image', kind: 'layer', mediaType: 'image/png', byteLength: 3 });
  for (const part of parent.parts) part.items[0].styles[0].assetId = 'base-image';
  const document = structuredClone(parent);
  document.tracks.push({ key: 'overlay', label: 'Overlay', renderOrder: 99, locked: false });
  const source = packPublicationAuthoringContent({ styles: [], authoring: document,
    bindings: { kind: 'LOCAL_DRAFT', parent: { draft: { document: parent }, assets: [
      { assetId: 'base-image', kind: 'layer', mediaType: 'image/png', byteLength: 3, sha256: '11'.repeat(32) },
    ] } } });
  const opts = { corePackageId: id(1), coreOriginalPackageId: id(1), runtimePackageId: PACKAGE,
    signer: SIGNER, paymentCoinType: '0x2::sui::SUI', releaseRef: { objectId: id(100), initialSharedVersion: '1' },
    adminCapRef: { objectId: id(101), version: '1', digest: digest(6) },
    baseRegistryRef: { objectId: id(102), initialSharedVersion: '1' }, releaseContentCommitment: 'aa'.repeat(32) };
  // Recompile/replan on every rehydration: no in-memory plan proof survives a restart.
  const buildDescriptor = async (stage, ordinal) => {
    if (!stage.startsWith('DEFINITIONS_')) return descriptor(stage, ordinal);
    const value = await compileMakerV8PackDefinitionRowsV8(source.content,
      { expectedParent: source.content.parent, semanticPackId: 'extras' });
    const plan = await planMakerV8PackDefinitionRegistrationV8(value, opts);
    const built = await buildMakerV8PackDefinitionStepV8(value, plan, ordinal - 1, opts);
    assert.equal(stage, `DEFINITIONS_${built.step.stage}`);
    return descriptor(stage, ordinal, built.transaction);
  };
  let badReadback = false;
  const stages = ['INIT', 'DEFINITIONS_BEGIN', 'DEFINITIONS_APPEND', 'DEFINITIONS_FINALIZE', 'APPEND', 'FINALIZE'];
  const h = await harness({ stages, buildDescriptor, certify() {
    if (badReadback) throw new Error('historical definition prefix mismatch');
  } });
  let controller = h.controller, plan = await controller.prepare(request);
  const success = () => ({ status: 'FINALIZED_SUCCESS', digest: plan.current.outcome.digest,
    epoch: '1', effectsFingerprint: `0x${'2'.repeat(64)}`, eventsDigest: digest(9), error: null, absence: null });
  for (const stage of stages) {
    controller = h.reboot();
    plan = await controller.resume(plan.attemptId);
    assert.equal(plan.current.descriptor.stage, stage);
    if (stage === 'DEFINITIONS_APPEND') {
      for (const patch of [{ stage: 'APPEND' }, { endStyle: 1 }]) {
        const changed = structuredClone(plan);
        Object.assign(changed.current.descriptor, patch); changed.revision++;
        await assert.rejects(h.persistence.compareAndSwap(plan.attemptId, plan.revision, changed));
      }
      const transfer = Transaction.fromKind(plan.current.descriptor.kindBytes);
      transfer.transferObjects([transfer.objectRef(opts.adminCapRef)], SIGNER);
      const changed = structuredClone(plan);
      changed.current.descriptor = (await descriptor(stage, plan.current.descriptor.ordinal, transfer)).value;
      changed.revision++;
      await assert.rejects(h.persistence.compareAndSwap(plan.attemptId, plan.revision, changed),
        { code: 'MAKER_V8_PACK_PUBLICATION_KIND_INVALID' });
      assert.deepEqual(await h.persistence.load(plan.attemptId), plan);
    }
    plan = await controller.requestSignature(plan.attemptId);
    const signedDigest = plan.current.outcome.digest;
    if (stage === 'DEFINITIONS_APPEND') {
      h.responses.push(new Error('offline'));
      plan = await h.reboot().resume(plan.attemptId);
      assert.equal(plan.current.outcome.status, 'OUTCOME_UNKNOWN');
      assert.equal(plan.current.outcome.digest, signedDigest);
      assert.equal(plan.head.stage, 'DEFINITIONS_BEGIN');
      badReadback = true;
      h.responses.push(success());
      await assert.rejects(h.reboot().resume(plan.attemptId), /historical definition prefix mismatch/);
      plan = await h.persistence.load(plan.attemptId);
      assert.equal(plan.head.stage, 'DEFINITIONS_BEGIN');
      assert.equal(plan.current.outcome.digest, signedDigest);
      badReadback = false;
    }
    const signs = h.order.filter(entry => entry.startsWith('sign:')).length;
    h.responses.push(success());
    plan = await h.reboot().resume(plan.attemptId);
    assert.equal(plan.head.stage, stage);
    assert.equal(plan.head.digest, signedDigest);
    assert.equal(h.order.filter(entry => entry.startsWith('sign:')).length, signs);
    assert.equal(h.order.filter(entry => entry.startsWith('broadcast:')).length, 0,
      'already finalized signed bytes are queried, never rebroadcast');
    if (stage === 'DEFINITIONS_FINALIZE') {
      assert.equal(plan.status, 'ACTIVE'); assert.equal(plan.terminal, null);
      assert.equal(plan.nextPreparation.ordinal, 4);
    }
  }
  assert.equal(plan.status, 'COMPLETE');
  assert.equal(h.order.filter(entry => entry.startsWith('sign:')).length, stages.length);
});
