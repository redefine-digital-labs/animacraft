import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { IDBFactory } from 'fake-indexeddb';
import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import { fromBase64, toBase58, toBase64 } from '@mysten/sui/utils';

import { MAKER_V8_PUBLICATION_COMPILER_ABI } from '../maker-v8-compiler.js';
import { MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256 } from '../maker-v8-chain.js';
import {
  MAKER_V8_PUBLICATION_CONTROLLER_SCHEMA,
  createMakerV8PublicationControllerV8,
} from '../maker-v8-publication-controller.js';
import {
  MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
  createMakerV8PublicationPersistenceV8,
  makerV8Base64BlobV8,
  makerV8BlobRefV8,
  makerV8PublicationAttemptIdV8,
  makerV8PublicationBlobRefsCommitmentV8,
  makerV8PublicationCompilerAuthorityV8,
  makerV8PublicationPlanIdV8,
  makerV8PublicationScopeKeyV8,
  makerV8Utf8BlobV8,
} from '../maker-v8-publication-store.js';

const CHAIN = '35834a8a';
const COIN = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const ROLES = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const id = (byte) => `0x${byte.repeat(32)}`;
const hash = (byte) => byte.repeat(32);
const clone = (value) => structuredClone(value);
const GAS_DIGEST = toBase58(new Uint8Array(32).fill(3));
const PERSISTENT_STORAGE = Object.freeze({
  async persisted() { return true; },
  async persist() { return true; },
});

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonical(value[key])}`
  )).join(',')}}`;
}

function canonicalSha256(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

async function compilerAuthority() {
  const packageTuple = ROLES.map((role, index) => ({
    role,
    originalPackageId: id(`${index + 1}${index + 1}`),
    callablePackageId: id(`${index + 1}${index + 1}`),
    packageDigest: String(index + 2).repeat(44),
    sourceCommitment: hash('1a'),
    packageCommitment: hash('2a'),
    abiCommitment: hash('3a'),
    bindingCommitment: hash('4a'),
  }));
  const configs = Object.fromEntries(
    ['seal', 'runtime', 'output', 'physical', 'market', 'release'].map((role, index) => {
      const fields = {
        version: 8,
        catalogId: id('80'),
        productBindingCommitment: hash('5d'),
        callCapSetCommitment: hash('6d'),
        authorityId: id(`${index + 1}a`),
      };
      if (role === 'seal') Object.assign(fields, {
        commitment: hash('7d'),
        keyServerIds: [id('a1')],
        weights: [1],
        threshold: 1,
        keyServerSetCommitment: hash('8d'),
        encryptionPolicyCommitment: hash('9d'),
      });
      return [role, { objectId: id(`${index + 1}b`), fields }];
    }),
  );
  return makerV8PublicationCompilerAuthorityV8({
    schemaVersion: 'animacraft.maker-v8-publication-authority.v1',
    protocolProfile: {
      protocolVersion: '137',
      objectRuntimeMaxNumCachedObjects: '1000',
      objectRuntimeMaxNumStoreEntries: '1000',
    },
    coreArtifact: {
      callablePackageId: packageTuple[0].callablePackageId,
      packageDigest: packageTuple[0].packageDigest,
      baseRegistryModuleSha256: MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
    },
    packageTuple,
    protocolConfig: { objectId: id('81'), revision: '3', commitment: hash('4d') },
    catalog: {
      objectId: id('80'),
      protocolConfigId: id('81'),
      protocolConfigRevision: '3',
      protocolConfigCommitment: hash('4d'),
      productBindingCommitment: hash('5d'),
      callCapSetCommitment: hash('6d'),
    },
    configs,
    sealPolicyCommitment: hash('7d'),
    compilerAbi: Object.fromEntries(ROLES.map((role, index) => [
      role,
      MAKER_V8_PUBLICATION_COMPILER_ABI[role].map(
        (suffix) => `${packageTuple[index].callablePackageId}::${suffix}`,
      ),
    ])),
  });
}

async function transactionFixture(keypair, salt = 0, signer = keypair.toSuiAddress()) {
  const transaction = new Transaction();
  transaction.setSender(signer);
  transaction.moveCall({
    target: `${id('11')}::core_v8::new_initial_maker_draft_v8`,
    arguments: [transaction.pure.u8(salt)],
  });
  transaction.setGasOwner(signer);
  transaction.setGasBudget(10_000_000);
  transaction.setGasPrice(1_000);
  transaction.setGasPayment([{
    objectId: id('22'),
    version: '1',
    digest: GAS_DIGEST,
  }]);
  const kindBytes = await transaction.build({ onlyTransactionKind: true });
  const fullBytes = await transaction.build();
  const signed = await keypair.signTransaction(fullBytes);
  return Object.freeze({
    transaction,
    kindBytes: toBase64(kindBytes),
    fullBytes: toBase64(fullBytes),
    digest: TransactionDataBuilder.getDigestFromBytes(fullBytes),
    signature: signed.signature,
    signer,
  });
}

async function publicationFixture(keypair, nonce = 'controller:1') {
  const transaction = await transactionFixture(keypair);
  const [documentBlob, metadataBlob, contextBlob, kindBlob] = await Promise.all([
    makerV8Utf8BlobV8('{"schemaVersion":"animacraft.maker.v8"}'),
    makerV8Utf8BlobV8('{"schemaVersion":"animacraft.maker-v8-author-transport-metadata.v1","assets":[]}'),
    makerV8Utf8BlobV8('{"schemaVersion":"animacraft.maker-v8-compiler-context-snapshot.v1"}'),
    makerV8Base64BlobV8(transaction.kindBytes),
  ]);
  const blobRefs = {
    document: makerV8BlobRefV8(documentBlob),
    transportMetadata: makerV8BlobRefV8(metadataBlob),
    compilerContext: makerV8BlobRefV8(contextBlob),
    assets: [],
  };
  const authority = await compilerAuthority();
  const immutable = {
    chainIdentifier: CHAIN,
    paymentCoinType: COIN,
    signerAddress: transaction.signer,
    makerKey: 'controller-maker',
    manifestSha256: hash('aa'),
    contentCommitment: hash('cc'),
    protocolProfileCommitment: 'bf6c019eae80bac3824e07fad65b2f983f5e74e69d0b6c46779078c752738fa7',
    coreArtifactCommitment: canonicalSha256({
      schemaVersion: 'animacraft.maker-v8-core-artifact.v1',
      callablePackageId: authority.coreArtifact.callablePackageId,
      packageDigest: authority.coreArtifact.packageDigest,
      baseRegistryModuleSha256: authority.coreArtifact.baseRegistryModuleSha256,
    }),
    blobRefsCommitment: await makerV8PublicationBlobRefsCommitmentV8(blobRefs),
    compilerAuthority: authority,
  };
  const scopeKey = await makerV8PublicationScopeKeyV8(immutable);
  const planId = await makerV8PublicationPlanIdV8(immutable);
  const attemptId = await makerV8PublicationAttemptIdV8({
    planId,
    scopeKey,
    attemptNonce: nonce,
  });
  const current = {
    ordinal: 0,
    kind: 'SCAFFOLD',
    phase: 'SCAFFOLD',
    lane: 'SCAFFOLD',
    action: 'CREATE',
    startSequence: '0',
    endSequence: '0',
    rowCommitments: [],
    preState: { contentCommitment: hash('cc') },
    postState: { contentCommitment: hash('cc'), nextSequence: '0' },
    compilerCheckpoint: {
      schemaVersion: 'animacraft.maker-v8-scaffold-checkpoint.v1',
      phase: 'SCAFFOLD',
      lane: 'SCAFFOLD',
      action: 'CREATE',
      index: 0,
      startSequence: '0',
      endSequence: '0',
      final: true,
    },
    transactionKindRef: makerV8BlobRefV8(kindBlob),
    transactionKindSha256: kindBlob.sha256,
    commandCount: 1,
    targets: [`${id('11')}::core_v8::new_initial_maker_draft_v8`],
    fullTransactionRef: null,
    signatureRef: null,
    outcome: { status: 'READY' },
  };
  const plan = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    attemptId,
    attemptNonce: nonce,
    planId,
    scopeKey,
    status: 'ACTIVE',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    immutable,
    blobRefs,
    head: null,
    current,
    nextPreparation: null,
    terminal: null,
    attemptHistory: {
      totalEvents: 0,
      excessEvents: 0,
      globalAttemptHeadSha256: null,
    },
  };
  return {
    plan,
    transaction,
    blobs: [documentBlob, metadataBlob, contextBlob, kindBlob],
  };
}

function finalized(status, digest) {
  return {
    status,
    digest,
    epoch: '7',
    effectsFingerprint: hash(status === 'FINALIZED_SUCCESS' ? 'e1' : 'e2'),
    eventsDigest: null,
    error: status === 'FINALIZED_FAILURE' ? { message: 'Move abort' } : null,
    absence: null,
  };
}

function notFound(digest) {
  return {
    status: 'NOT_FOUND',
    digest,
    epoch: null,
    effectsFingerprint: null,
    eventsDigest: null,
    error: null,
    absence: {
      schemaVersion: 'animacraft.sui-transaction-absence.v1',
      chainIdentifier: CHAIN,
      watermarkEpoch: '8',
    },
  };
}

async function harness(name = 'default') {
  const keypair = new Ed25519Keypair();
  const fixture = await publicationFixture(keypair, `${name}:nonce`);
  const store = createMakerV8PublicationPersistenceV8(new IDBFactory(), {
    databaseName: `publication-controller-${name}`,
    storageManager: PERSISTENT_STORAGE,
  });
  const order = [];
  const calls = {
    prepare: 0,
    rehydrate: [],
    certify: 0,
    query: 0,
    broadcast: [],
    loadPlan: 0,
    getBlob: 0,
  };
  const controls = {
    queryResults: [],
    freshAuthorityError: null,
    rehydrateKindBytes: null,
    verifySignature: true,
    buildOverride: null,
    failBroadcastAfterSend: 0,
    failNextCas: null,
    tamperBlobSha256: null,
  };
  const persistence = Object.freeze({
    requirePersistentStorage: (...args) => store.requirePersistentStorage(...args),
    preflightQuota: (...args) => store.preflightQuota(...args),
    createAttempt: (...args) => store.createAttempt(...args),
    async loadPlan(...args) { calls.loadPlan += 1; return store.loadPlan(...args); },
    loadHead: (...args) => store.loadHead(...args),
    loadAttemptHead: (...args) => store.loadAttemptHead(...args),
    async getBlob(sha256) {
      calls.getBlob += 1;
      const blob = await store.getBlob(sha256);
      if (blob && controls.tamperBlobSha256 === sha256) {
        return { ...blob, data: blob.data.endsWith('A') ? `${blob.data.slice(0, -1)}B` : `${blob.data.slice(0, -1)}A` };
      }
      return blob;
    },
    async compareAndSwap(...args) {
      if (controls.failNextCas) {
        const error = controls.failNextCas;
        controls.failNextCas = null;
        throw error;
      }
      return store.compareAndSwap(...args);
    },
    deleteUnsigned: (...args) => store.deleteUnsigned(...args),
  });
  const authority = Object.freeze({
    schemaVersion: 'animacraft.maker-v8-controller-test-authority.v1',
  });
  const attestation = (plan, kindBytes) => ({
    authority,
    signerAddress: plan.immutable.signerAddress,
    transactionKindBytes: controls.rehydrateKindBytes ?? kindBytes,
    descriptor: clone(plan.current),
  });
  const compiler = Object.freeze({
    authority,
    async prepare() {
      calls.prepare += 1;
      return {
        plan: clone(fixture.plan),
        blobs: clone(fixture.blobs),
        attested: attestation(fixture.plan, fixture.transaction.kindBytes),
      };
    },
    async rehydrate({ plan, transactionKindBytes, requireFreshAuthority }) {
      calls.rehydrate.push(requireFreshAuthority);
      order.push(requireFreshAuthority ? 'compiler:fresh' : 'compiler:old');
      if (requireFreshAuthority && controls.freshAuthorityError) {
        throw controls.freshAuthorityError;
      }
      return attestation(plan, transactionKindBytes);
    },
    async certifyFinalized({ plan, query, artifacts }) {
      calls.certify += 1;
      order.push('compiler:certify');
      return {
        schemaVersion: 'animacraft.maker-v8-controller-test-certificate.v1',
        digest: query.digest,
        kindSha256: plan.current.transactionKindSha256,
        transactionDataSha256: createHash('sha256')
          .update(fromBase64(artifacts.bytes)).digest('hex'),
      };
    },
    async prepareSuccessor() {
      throw Object.assign(new Error('not used by focused controller tests'), {
        code: 'TEST_SUCCESSOR_NOT_CONFIGURED',
      });
    },
  });
  const boundary = Object.freeze({
    async buildExactTransaction() {
      return controls.buildOverride ?? {
        bytes: fixture.transaction.fullBytes,
        digest: fixture.transaction.digest,
      };
    },
    async dryRunExactTransaction() { return { status: 'SUCCESS' }; },
    async broadcastExactTransaction(request) {
      order.push('broadcast');
      calls.broadcast.push(clone(request));
      if (controls.failBroadcastAfterSend > 0) {
        controls.failBroadcastAfterSend -= 1;
        throw Object.assign(new Error('transport response lost after send'), {
          code: 'TEST_BROADCAST_RESPONSE_LOST',
        });
      }
      return { accepted: true, digest: request.digest };
    },
  });
  const wallet = Object.freeze({
    async signExactTransaction() {
      return {
        bytes: fixture.transaction.fullBytes,
        signature: fixture.transaction.signature,
        digest: fixture.transaction.digest,
        signer: fixture.transaction.signer,
      };
    },
    async verifyExactSignature({ bytes, signature, digest, signer }) {
      if (!controls.verifySignature) return false;
      const valid = TransactionDataBuilder.getDigestFromBytes(fromBase64(bytes)) === digest
        && await isValidTransactionSignature(fromBase64(bytes), signature, { address: signer });
      return valid ? { verified: true, bytes, digest, signer } : false;
    },
  });
  const rpc = Object.freeze({
    async queryTransaction({ digest }) {
      calls.query += 1;
      order.push('rpc:query');
      const result = controls.queryResults.shift();
      if (result instanceof Error) throw result;
      return result ?? notFound(digest);
    },
  });
  let time = 10;
  const controller = createMakerV8PublicationControllerV8({
    persistence,
    compiler,
    boundary,
    wallet,
    rpc,
    execution: { allowWalletSignature: true, allowBroadcast: true },
    now: () => time++,
  });
  return {
    controller,
    persistence,
    store,
    compiler,
    controls,
    calls,
    order,
    fixture,
    keypair,
  };
}

async function preparedAndSigned(value) {
  const prepared = await value.controller.prepare({});
  const signed = await value.controller.requestSignature(prepared.attemptId);
  return { prepared, signed };
}

test('review builds exact bytes before wallet and sign consumes one unchanged digest', async () => {
  const value = await harness('review');
  const plan = await value.controller.prepare({});
  const review = await value.controller.prepareReview(plan.attemptId);
  assert.ok(review.digest);
  assert.match(review.gasBudgetMist, /^\d+$/);
  const signed = await value.controller.signReviewed(plan.attemptId, review);
  assert.equal(signed.current.outcome.digest, review.digest);
  assert.equal(signed.current.outcome.status, 'SIGNED');
  await assert.rejects(value.controller.signReviewed(plan.attemptId, review), { code: 'MAKER_V8_PUBLICATION_REVIEW_STALE' });
});

test('prepare is idempotent after a strict create committed but the caller lost its response', async () => {
  const value = await harness('prepare-idempotent');
  const first = await value.controller.prepare({});
  const second = await value.controller.prepare({});
  assert.equal(second.attemptId, first.attemptId);
  assert.equal(second.planId, first.planId);
  assert.equal(second.revision, 1);
  assert.equal((await value.store.listAttemptsByScope(first.scopeKey)).length, 1);
});

test('requestSignature cold-rereads a SIGNED WAL before any query or broadcast', async () => {
  const value = await harness('signed-wal');
  const { signed } = await preparedAndSigned(value);
  assert.equal(signed.current.outcome.status, 'SIGNED');
  assert.equal(signed.current.outcome.digest, value.fixture.transaction.digest);
  assert.equal(value.calls.query, 0);
  assert.equal(value.calls.broadcast.length, 0);
  const attempt = await value.store.loadAttemptHead(signed.attemptId, 0);
  assert.equal(attempt.status, 'SIGNED');
  assert.equal(attempt.digest, value.fixture.transaction.digest);
  assert.equal(
    await value.store.getBlob(signed.current.fullTransactionRef.sha256).then((blob) => blob.data),
    value.fixture.transaction.fullBytes,
  );
  assert.equal(
    await value.store.getBlob(signed.current.signatureRef.sha256).then((blob) => blob.data),
    value.fixture.transaction.signature,
  );
});

test('a crash after finality query but before checkpoint CAS resumes the same digest', async () => {
  const value = await harness('checkpoint-crash');
  const { signed } = await preparedAndSigned(value);
  value.controls.queryResults.push(
    finalized('FINALIZED_SUCCESS', signed.current.outcome.digest),
    finalized('FINALIZED_SUCCESS', signed.current.outcome.digest),
  );
  const originalCertify = value.compiler.certifyFinalized;
  let crash = true;
  const compiler = Object.freeze({
    ...value.compiler,
    async certifyFinalized(input) {
      if (crash) {
        crash = false;
        throw Object.assign(new Error('crash before checkpoint CAS'), { code: 'TEST_CRASH' });
      }
      return originalCertify(input);
    },
  });
  const controller = createMakerV8PublicationControllerV8({
    persistence: value.persistence,
    compiler,
    boundary: {
      buildExactTransaction: async () => ({}),
      dryRunExactTransaction: async () => ({ status: 'SUCCESS' }),
      broadcastExactTransaction: async () => ({ accepted: true }),
    },
    wallet: {
      signExactTransaction: async () => ({}),
      verifyExactSignature: async (request) => value.controller
        && isValidTransactionSignature(fromBase64(request.bytes), request.signature, {
          address: request.signer,
        }).then((valid) => (valid ? { verified: true, ...request } : false)),
    },
    rpc: {
      queryTransaction: async ({ digest }) => {
        value.calls.query += 1;
        return value.controls.queryResults.shift() ?? notFound(digest);
      },
    },
    execution: { allowWalletSignature: true, allowBroadcast: true },
    now: (() => { let time = 40; return () => time++; })(),
  });
  await assert.rejects(controller.recoverOutcome(signed.attemptId), { code: 'TEST_CRASH' });
  const pending = await value.store.loadPlan(signed.attemptId);
  assert.equal(pending.current.outcome.status, 'OUTCOME_PENDING');
  assert.equal(pending.head, null);
  const finalizedPlan = await controller.recoverOutcome(signed.attemptId);
  assert.equal(finalizedPlan.current, null);
  assert.equal(finalizedPlan.nextPreparation.status, 'REQUIRED');
  await assert.rejects(controller.inspect(signed.attemptId), { code: 'TEST_SUCCESSOR_NOT_CONFIGURED' },
    'read-only review must request the next deterministic compiler cursor after finality');
  const head = await value.store.loadHead(signed.attemptId);
  assert.equal(head.digest, signed.current.outcome.digest);
  assert.equal(head.transactionKindSha256, signed.current.transactionKindSha256);
});

test('replayExact is query-first and resends byte-identical WAL artifacts after a lost response', async () => {
  const value = await harness('same-byte-replay');
  const { signed } = await preparedAndSigned(value);
  value.order.length = 0;
  value.controls.failBroadcastAfterSend = 1;
  value.controls.queryResults.push(
    notFound(signed.current.outcome.digest),
    notFound(signed.current.outcome.digest),
    finalized('FINALIZED_SUCCESS', signed.current.outcome.digest),
  );
  await assert.rejects(value.controller.replayExact(signed.attemptId), {
    code: 'TEST_BROADCAST_RESPONSE_LOST',
  });
  let pending = await value.store.loadPlan(signed.attemptId);
  assert.equal(pending.current.outcome.status, 'OUTCOME_PENDING');
  assert.equal(pending.current.outcome.broadcastAt, null);
  const recovered = await value.controller.replayExact(signed.attemptId);
  assert.equal(recovered.current, null);
  assert.equal(value.calls.broadcast.length, 2);
  for (const replay of value.calls.broadcast) {
    assert.equal(replay.bytes, value.fixture.transaction.fullBytes);
    assert.equal(replay.signature, value.fixture.transaction.signature);
    assert.equal(replay.digest, value.fixture.transaction.digest);
    assert.equal(replay.signer, value.fixture.transaction.signer);
  }
  const firstFresh = value.order.indexOf('compiler:fresh');
  assert.ok(value.order.indexOf('rpc:query') >= 0);
  assert.ok(value.order.indexOf('rpc:query') < firstFresh, value.order.join(' -> '));
  pending = await value.store.loadPlan(signed.attemptId);
  assert.equal(pending.head.digest, signed.current.outcome.digest);
});

test('authority drift is checked only after the old signed digest query and blocks broadcast', async () => {
  const value = await harness('authority-query-first');
  const { signed } = await preparedAndSigned(value);
  value.order.length = 0;
  value.controls.queryResults.push(notFound(signed.current.outcome.digest));
  value.controls.freshAuthorityError = Object.assign(new Error('authority drift'), {
    code: 'MAKER_V8_COMPILER_CONTEXT_DRIFT',
  });
  await assert.rejects(value.controller.replayExact(signed.attemptId), {
    code: 'MAKER_V8_COMPILER_CONTEXT_DRIFT',
  });
  assert.equal(value.calls.broadcast.length, 0);
  assert.equal(value.order[0], 'rpc:query');
  assert.equal(value.order[1], 'compiler:fresh');
});

test('finalized old digest recovery does not depend on current authority freshness', async () => {
  const value = await harness('old-finality-authority');
  const { signed } = await preparedAndSigned(value);
  value.order.length = 0;
  value.controls.freshAuthorityError = Object.assign(new Error('authority drift'), {
    code: 'MAKER_V8_COMPILER_CONTEXT_DRIFT',
  });
  value.controls.queryResults.push(finalized('FINALIZED_SUCCESS', signed.current.outcome.digest));
  const plan = await value.controller.recoverOutcome(signed.attemptId);
  assert.equal(plan.head.digest, signed.current.outcome.digest);
  assert.deepEqual(value.order.slice(0, 3), [
    'rpc:query', 'compiler:old', 'compiler:certify',
  ]);
  assert.equal(value.order.includes('compiler:fresh'), false);
});

test('compiler TransactionKind tamper is rejected during O(1) cold rehydrate', async () => {
  const value = await harness('kind-tamper');
  const plan = await value.controller.prepare({});
  const alternate = await transactionFixture(value.keypair, 1);
  value.controls.rehydrateKindBytes = alternate.kindBytes;
  value.calls.rehydrate.length = 0;
  value.calls.loadPlan = 0;
  value.calls.getBlob = 0;
  await assert.rejects(value.controller.resume(plan.attemptId), {
    code: 'MAKER_V8_PUBLICATION_COMPILER_REHYDRATION_DRIFT',
  });
  assert.equal(value.calls.rehydrate.length, 1);
  assert.equal(value.calls.loadPlan, 2);
  assert.equal(value.calls.getBlob, 1);
});

test('TransactionData sender, kind, digest, and signature tamper fail before WAL signing', async (t) => {
  await t.test('wrong sender', async () => {
    const value = await harness('wrong-sender');
    const plan = await value.controller.prepare({});
    const wrongKey = new Ed25519Keypair();
    const wrong = await transactionFixture(wrongKey, 0, wrongKey.toSuiAddress());
    value.controls.buildOverride = { bytes: wrong.fullBytes, digest: wrong.digest };
    await assert.rejects(value.controller.requestSignature(plan.attemptId), {
      code: 'MAKER_V8_PUBLICATION_TRANSACTION_DATA_DRIFT',
    });
    assert.equal((await value.store.loadPlan(plan.attemptId)).current.outcome.status, 'READY');
  });

  await t.test('different TransactionKind', async () => {
    const value = await harness('wrong-full-kind');
    const plan = await value.controller.prepare({});
    const wrong = await transactionFixture(value.keypair, 1);
    value.controls.buildOverride = { bytes: wrong.fullBytes, digest: wrong.digest };
    await assert.rejects(value.controller.requestSignature(plan.attemptId), {
      code: 'MAKER_V8_PUBLICATION_TRANSACTION_DATA_DRIFT',
    });
    assert.equal((await value.store.loadPlan(plan.attemptId)).current.outcome.status, 'READY');
  });

  await t.test('claimed digest', async () => {
    const value = await harness('wrong-digest');
    const plan = await value.controller.prepare({});
    value.controls.buildOverride = {
      bytes: value.fixture.transaction.fullBytes,
      digest: toBase58(new Uint8Array(32).fill(9)),
    };
    await assert.rejects(value.controller.requestSignature(plan.attemptId), {
      code: 'MAKER_V8_PUBLICATION_TRANSACTION_DATA_DRIFT',
    });
    assert.equal((await value.store.loadPlan(plan.attemptId)).current.outcome.status, 'READY');
  });

  await t.test('invalid signature', async () => {
    const value = await harness('wrong-signature');
    const plan = await value.controller.prepare({});
    value.controls.verifySignature = false;
    await assert.rejects(value.controller.requestSignature(plan.attemptId), {
      code: 'MAKER_V8_PUBLICATION_SIGNATURE_INVALID',
    });
    assert.equal((await value.store.loadPlan(plan.attemptId)).current.outcome.status, 'READY');
  });
});

test('tampered durable signed bytes are queried first but never replayed', async () => {
  const value = await harness('durable-tamper');
  const { signed } = await preparedAndSigned(value);
  value.controls.tamperBlobSha256 = signed.current.fullTransactionRef.sha256;
  value.controls.queryResults.push(notFound(signed.current.outcome.digest));
  await assert.rejects(value.controller.replayExact(signed.attemptId), {
    code: 'MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH',
  });
  assert.equal(value.calls.query, 1);
  assert.equal(value.calls.broadcast.length, 0);
});

test('CAS loss after wallet return cannot trigger query or broadcast', async () => {
  const value = await harness('cas-race');
  const plan = await value.controller.prepare({});
  value.controls.failNextCas = Object.assign(new Error('another tab won'), {
    code: 'MAKER_V8_PUBLICATION_CAS_MISMATCH',
  });
  await assert.rejects(value.controller.requestSignature(plan.attemptId), {
    code: 'MAKER_V8_PUBLICATION_CAS_MISMATCH',
  });
  const reread = await value.store.loadPlan(plan.attemptId);
  assert.equal(reread.current.outcome.status, 'READY');
  assert.equal(value.calls.query, 0);
  assert.equal(value.calls.broadcast.length, 0);
});

test('subscribe reports durable READY/discard transitions and unsigned discard cold-rereads absence', async () => {
  const value = await harness('subscribe-discard');
  const events = [];
  const unsubscribe = value.controller.subscribe((event) => events.push(event));
  const plan = await value.controller.prepare({});
  assert.equal(await value.controller.discardUnsigned(plan.attemptId), true);
  unsubscribe();
  assert.equal(await value.store.loadPlan(plan.attemptId), null);
  assert.deepEqual(events.map((event) => event.reason), ['READY', 'DISCARDED_UNSIGNED']);
  assert.equal(events[0].schemaVersion, MAKER_V8_PUBLICATION_CONTROLLER_SCHEMA);
  assert.equal(events[1].plan, null);
});

test('constructor rejects a signing-only deployment and incomplete publication adapters', async () => {
  assert.throws(() => createMakerV8PublicationControllerV8({}), {
    code: 'MAKER_V8_PUBLICATION_CONTROLLER_DEPENDENCY_INVALID',
  });
  const value = await harness('gate');
  assert.throws(() => createMakerV8PublicationControllerV8({
    persistence: value.persistence,
    compiler: value.compiler,
    boundary: {
      buildExactTransaction: async () => ({}),
      dryRunExactTransaction: async () => ({}),
      broadcastExactTransaction: async () => ({}),
    },
    wallet: {
      signExactTransaction: async () => ({}),
      verifyExactSignature: async () => true,
    },
    rpc: { queryTransaction: async () => ({}) },
    execution: { allowWalletSignature: true, allowBroadcast: false },
  }), { code: 'MAKER_V8_PUBLICATION_EXECUTION_GATE_INVALID' });
});

test('canonical TransactionData proof used by the fixture embeds the exact durable kind', async () => {
  const keypair = new Ed25519Keypair();
  const fixture = await transactionFixture(keypair);
  const parsed = bcs.TransactionData.parse(fromBase64(fixture.fullBytes));
  assert.equal(parsed.$kind, 'V1');
  assert.equal(
    toBase64(bcs.TransactionKind.serialize(parsed.V1.kind).toBytes()),
    fixture.kindBytes,
  );
  assert.equal(parsed.V1.sender, fixture.signer);
  assert.equal(parsed.V1.gasData.owner, fixture.signer);
});
