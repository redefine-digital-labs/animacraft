import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB, IDBFactory } from 'fake-indexeddb';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import { blobIdToInt } from '@mysten/walrus';

import {
  createMakerV8WalrusPersistenceV8,
  createMakerV8WalrusPublisherV8,
  makerV8WalrusUploadIdV8,
} from '../maker-v8-walrus.js';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';
import { MAKER_V8_SUI_MAINNET_GENESIS_DIGEST } from '../maker-v8-sui-grpc.js';
import { MakerV8DAppKitWalletError } from '../maker-v8-dapp-kit-wallet.js';

const OWNER = `0x${'11'.repeat(32)}`;
const OBJECT = `0x${'22'.repeat(32)}`;
const PACKAGE = `0x${'33'.repeat(32)}`;
const GAS = `0x${'44'.repeat(32)}`;
const GAS_DIGEST = toBase58(new Uint8Array(32).fill(5));
const ROOT_HASH = new Uint8Array(32).fill(7);
const NONCE = new Uint8Array(32).fill(8);
const BLOB_ID = 'cXS9BhbUGvvS9F8_gn8mU4Yq8AhXzd1yLoiZIkb2Pq0';
const SIGNATURE = toBase64(new Uint8Array(97).fill(9));

function tx(label) {
  const transaction = new Transaction();
  transaction.setSender(OWNER);
  transaction.moveCall({
    target: `${PACKAGE}::walrus_probe::${label}`,
    arguments: [transaction.pure.u8(8)],
  });
  transaction.setGasOwner(OWNER);
  transaction.setGasBudget(10_000_000);
  transaction.setGasPrice(1_000);
  transaction.setGasPayment([{ objectId: GAS, version: '1', digest: GAS_DIGEST }]);
  return transaction;
}

function memoryPersistence() {
  const values = new Map();
  return {
    async requirePersistentStorage() { return true; },
    async create(record) {
      if (values.has(record.uploadId)) throw new Error('exists');
      values.set(record.uploadId, structuredClone(record));
      return structuredClone(record);
    },
    async load(uploadId) {
      return values.has(uploadId) ? structuredClone(values.get(uploadId)) : null;
    },
    async compareAndSwap(current, next) {
      const stored = values.get(current.uploadId);
      assert.equal(stored.revision, current.revision);
      values.set(current.uploadId, structuredClone(next));
      return structuredClone(next);
    },
  };
}

function harness(persistence = memoryPersistence(), clockStart = 100, {
  readOwnedPublicBlobs, fetcher,
} = {}) {
  const bytes = new TextEncoder().encode('fresh-v8-manifest');
  const calls = [];
  const queries = [];
  const walrusClient = {
    async computeBlobMetadata({ bytes: actual, nonce = NONCE }) {
      assert.deepEqual(actual, bytes);
      return {
        blobId: BLOB_ID,
        rootHash: ROOT_HASH,
        nonce,
        metadata: { unencodedLength: BigInt(actual.length), encodingType: 'RS2' },
      };
    },
    writeBlobFlow({ blob, resume }) {
      assert.deepEqual(blob, bytes);
      return {
        async encode() { return resume; },
        register() { return tx('register_blob_v8'); },
        async upload({ digest }) {
          calls.push(['upload', digest]);
          return {
            step: 'uploaded', blobId: BLOB_ID, blobObjectId: OBJECT,
            txDigest: digest, certificate: toBase64(new Uint8Array(80).fill(6)),
          };
        },
      };
    },
    certifyBlobTransaction() { return tx('certify_blob_v8'); },
    async getBlobObject() {
      return {
        id: OBJECT,
        blob_id: bcs.u256().parse(bcs.u256().serialize(blobIdToInt(BLOB_ID)).toBytes()),
        size: String(bytes.length),
        deletable: false,
        certified_epoch: 10n,
        storage: { end_epoch: 13n },
      };
    },
    async getVerifiedBlobStatus() {
      return { type: 'permanent', isCertified: true, initialCertifiedEpoch: 10 };
    },
  };
  const transport = {
    core: {
      async executeTransaction({ transaction }) {
        const digest = TransactionDataBuilder.getDigestFromBytes(transaction);
        calls.push(['broadcast', digest]);
        return {
          $kind: 'Transaction',
          Transaction: { digest, status: { success: true }, effects: { transactionDigest: digest } },
        };
      },
    },
  };
  const rpc = {
    async getChainIdentifier() { calls.push(['chain']); return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getSuiClient() { return transport; },
    async queryTransaction({ digest }) {
      calls.push(['query', digest]);
      const status = queries.shift() ?? 'NOT_FOUND';
      if (status instanceof Error) throw status;
      if (typeof status === 'object') return status;
      return status === 'NOT_FOUND'
        ? { status, digest, absence: { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER } }
        : { status, digest, absence: null, error: null };
    },
  };
  const wallet = {
    async getCurrentAccount() { return { address: OWNER, network: 'mainnet' }; },
    async signExactTransaction({ bytes: transactionBytes, digest, signer }) {
      const expiration = Transaction.from(Buffer.from(transactionBytes, 'base64')).getData().expiration.ValidDuring;
      assert.equal(expiration.minEpoch, '10');
      assert.equal(expiration.maxEpoch, '11');
      assert.equal(expiration.chain, MAKER_V8_SUI_MAINNET_GENESIS_DIGEST);
      assert.ok(Number.isInteger(expiration.nonce) && expiration.nonce >= 0 && expiration.nonce <= 0xffff_ffff);
      calls.push(['sign', digest]);
      return { bytes: transactionBytes, digest, signer, signature: SIGNATURE };
    },
    async verifyExactSignature({ bytes: transactionBytes, digest, signer }) {
      assert.equal(TransactionDataBuilder.getDigestFromBytes(Buffer.from(transactionBytes, 'base64')), digest);
      return { verified: true, bytes: transactionBytes, digest, signer };
    },
  };
  const buildClient = { core: { async getCurrentSystemState() { return { systemState: { epoch: '10' } }; } } };
  const publisher = createMakerV8WalrusPublisherV8({
    walrusClient,
    buildClient,
    rpc,
    wallet,
    persistence,
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true, allowBroadcast: true,
    },
    readOwnedPublicBlobs,
    fetcher: fetcher ?? (async () => ({ ok: true, async arrayBuffer() { return bytes.buffer.slice(0); } })),
    now: (() => { let value = clockStart; return () => value++; })(),
  });
  return { publisher, bytes, calls, queries, walrusClient, buildClient, wallet, transport };
}

function ownedPublicBlob(bytes, {
  endEpoch = 123, certifiedEpoch = 120, deletable = false,
} = {}) {
  return { id: OBJECT, blob_id: blobIdToInt(BLOB_ID).toString(), size: bytes.length,
    certified_epoch: certifiedEpoch, storage: { end_epoch: endEpoch }, deletable };
}

test('a certified public asset reuses the existing Blob with sufficient Walrus retention and no signature', async () => {
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  let statusReads = 0;
  let terms = { endEpoch: 122 };
  const h = harness(persistence, 100, {
    async readOwnedPublicBlobs({ owner, blobId }) {
      assert.equal(blobId, BLOB_ID);
      assert.equal(owner, OWNER);
      statusReads++;
      return { epoch: 120, blobs: [ownedPublicBlob(h.bytes, terms)] };
    },
    async fetcher(url) {
      assert.equal(url, `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/by-object-id/${OBJECT}?strict_consistency_check=true`);
      return new Response(h.bytes);
    },
  });
  const uploadId = 'pack-public-reuse';
  await h.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(h.bytes) });
  const review = await h.publisher.prepareReview(uploadId);
  assert.equal(await h.publisher.reuseCertifiedPublicAsset(uploadId), null);
  assert.equal((await h.publisher.load(uploadId)).revision, review.revision);
  terms = { deletable: true };
  assert.equal(await h.publisher.reuseCertifiedPublicAsset(uploadId), null);
  terms = { certifiedEpoch: null };
  await assert.rejects(h.publisher.reuseCertifiedPublicAsset(uploadId), { code: 'MAKER_V8_WALRUS_PUBLIC_CERTIFICATION_PENDING' });
  assert.equal((await h.publisher.load(uploadId)).revision, review.revision);
  terms = {};
  const completed = await h.publisher.reuseCertifiedPublicAsset(uploadId);
  assert.equal(completed.status, 'COMPLETE');
  assert.equal(completed.reusedCertification, true);
  assert.equal(completed.blobId, BLOB_ID);
  assert.equal(completed.blobObjectId, OBJECT);
  assert.equal(completed.transactionDigest, null);
  assert.equal((await persistence.load(uploadId)).readback.endEpoch, '123');
  assert.deepEqual(await harness(persistence).publisher.load(uploadId), completed);
  await assert.rejects(h.publisher.signReviewed(uploadId, review), { code: 'MAKER_V8_WALRUS_REVIEW_STALE' });
  assert.equal(statusReads, 4);
  assert.deepEqual(h.calls.filter(([step]) => ['sign', 'broadcast', 'upload'].includes(step)), []);
  await persistence.close();
});

test('public reuse rejects altered readback bytes and a winning original signature keeps its digest', async () => {
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  let wrongBytes = true;
  let signalLookup;
  let resumeLookup;
  const started = new Promise(resolve => { signalLookup = resolve; });
  const gate = new Promise(resolve => { resumeLookup = resolve; });
  const h = harness(persistence, 100, {
    async readOwnedPublicBlobs() {
      if (!wrongBytes) { signalLookup(); await gate; }
      return { epoch: 120, blobs: [ownedPublicBlob(h.bytes)] };
    },
    async fetcher() {
      return new Response(wrongBytes ? h.bytes.map(byte => byte ^ 1) : h.bytes);
    },
  });
  const uploadId = 'pack-public-race';
  await h.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(h.bytes) });
  const review = await h.publisher.prepareReview(uploadId);
  await assert.rejects(h.publisher.reuseCertifiedPublicAsset(uploadId), { code: 'MAKER_V8_WALRUS_READBACK_DRIFT' });
  wrongBytes = false;
  const reuse = h.publisher.reuseCertifiedPublicAsset(uploadId);
  await started;
  await h.publisher.signReviewed(uploadId, review);
  resumeLookup();
  await assert.rejects(reuse, { code: 'MAKER_V8_WALRUS_CAS_MISMATCH' });
  assert.equal(await h.publisher.reuseCertifiedPublicAsset(uploadId), null);
  const pending = await h.publisher.load(uploadId);
  assert.equal(pending.status, 'RECOVERY_REQUIRED');
  assert.equal(pending.transactionDigest, review.digest);
  assert.deepEqual(h.calls.filter(([step]) => ['sign', 'broadcast', 'upload'].includes(step)), [['sign', review.digest]]);
  await persistence.close();
});

async function preparedBatch(h, persistence) {
  const ids = ['batch-render', 'batch-soul', 'batch-memory', 'batch-skill'];
  for (const uploadId of ids) await h.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'application/octet-stream', bytesBase64: toBase64(h.bytes) });
  return { owner: OWNER, rootId: PACKAGE, members: await Promise.all(ids.map(async uploadId => {
    const row = await persistence.load(uploadId);
    return { uploadId, byteSha256: row.byteSha256, epochs: row.epochs, blobId: row.encoded.blobId,
      rootHash: row.encoded.rootHash, nonce: row.encoded.nonce };
  })) };
}

test('four-member batch adoption atomically invalidates standalone reviews and survives cold concurrent claims', async () => {
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  const h = harness(persistence); const proposal = await preparedBatch(h, persistence);
  const review = await h.publisher.prepareReview('batch-render');
  const [first, second] = await Promise.all([persistence.claimBlobBatch(proposal), persistence.claimBlobBatch(proposal)]);
  assert.deepEqual(first, second); assert.equal(first.status, 'ENCODED');
  await assert.rejects(h.publisher.signReviewed('batch-render', review), { code: 'MAKER_V8_WALRUS_BATCH_REQUIRED' });
  await assert.rejects(h.publisher.requestSignature('batch-memory'), { code: 'MAKER_V8_WALRUS_BATCH_REQUIRED' });
  assert.equal(h.calls.some(call => call[0] === 'sign'), false);
  for (const member of proposal.members) assert.equal((await persistence.load(member.uploadId)).batchKey, first.key);
  const cold = harness(persistence);
  assert.deepEqual(await persistence.claimBlobBatch(proposal), first);
  await assert.rejects(cold.publisher.requestSignature('batch-soul'), { code: 'MAKER_V8_WALRUS_BATCH_REQUIRED' });
  await assert.rejects(persistence.claimBlobBatch({ ...proposal, rootId: OBJECT }), { code: 'MAKER_V8_WALRUS_BATCH_INVALID' });
  await persistence.close();
});

test('a standalone signature that wins batch adoption keeps exact bytes and permanently selects serial recovery', async () => {
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  const h = harness(persistence); const proposal = await preparedBatch(h, persistence);
  const review = await h.publisher.prepareReview('batch-render');
  await h.publisher.signReviewed('batch-render', review);
  const signed = await persistence.load('batch-render');
  const legacy = await persistence.claimBlobBatch(proposal);
  assert.equal(legacy.status, 'LEGACY');
  assert.deepEqual(await persistence.load('batch-render'), signed);
  assert.equal((await persistence.load('batch-memory')).batchKey, undefined);
  assert.deepEqual(await persistence.claimBlobBatch(proposal), legacy);
  assert.equal(h.calls.filter(call => call[0] === 'sign').length, 1);
  await persistence.close();
});

test('batch membership drift aborts without consuming any standalone upload or review', async () => {
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  const h = harness(persistence); const proposal = await preparedBatch(h, persistence);
  const before = await Promise.all(proposal.members.map(member => persistence.load(member.uploadId)));
  for (const patch of [{ owner: OBJECT }, { rootId: OWNER, members: proposal.members.slice(0, 1) },
    { members: proposal.members.map((member, i) => i === 1 ? { ...member, byteSha256: 'ff'.repeat(32) } : member) }]) {
    await assert.rejects(persistence.claimBlobBatch({ ...proposal, ...patch }), { code: 'MAKER_V8_WALRUS_BATCH_INVALID' });
  }
  assert.deepEqual(await Promise.all(proposal.members.map(member => persistence.load(member.uploadId))), before);
  assert.equal(h.calls.some(call => call[0] === 'sign'), false);
  await persistence.close();
});

test('failure writing a batch claim rolls back all four member claims and retained standalone reviews', async () => {
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  const h = harness(persistence); const proposal = await preparedBatch(h, persistence);
  const before = await Promise.all(proposal.members.map(member => persistence.load(member.uploadId)));
  const { IDBObjectStore } = await import('fake-indexeddb'); const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'publication-bindings') throw new Error('batch claim disk failure');
    return original.apply(this, args);
  };
  try { await assert.rejects(persistence.claimBlobBatch(proposal), /batch claim disk failure/); }
  finally { IDBObjectStore.prototype.add = original; }
  assert.deepEqual(await Promise.all(proposal.members.map(member => persistence.load(member.uploadId))), before);
  const claimed = await persistence.claimBlobBatch(proposal); assert.equal(claimed.status, 'ENCODED');
  assert.equal(h.calls.some(call => call[0] === 'sign'), false);
  await persistence.close();
});

test('cold certified checkpoint validates SDK u256 identity and recovers without another payment', async () => {
  const persistence = memoryPersistence(), setup = harness(persistence);
  const uploadId = 'certified-readback';
  await setup.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'application/json', bytesBase64: toBase64(setup.bytes) });
  await setup.publisher.requestSignature(uploadId);
  setup.queries.push('FINALIZED_SUCCESS');
  await setup.publisher.resume(uploadId);
  await setup.publisher.requestSignature(uploadId);
  const checkpoint = await persistence.load(uploadId);
  const cold = harness(persistence, 1000);
  const exactBlob = await cold.walrusClient.getBlobObject();
  assert.equal(exactBlob.blob_id, '78361367043362699497441434551893230522866857218300878006731490088621860287601');
  for (const blob_id of ['1', '-1', (1n << 256n).toString(), 'not-an-integer', BLOB_ID, null]) {
    cold.walrusClient.getBlobObject = async () => ({ ...exactBlob, blob_id });
    cold.queries.push('FINALIZED_SUCCESS');
    await assert.rejects(cold.publisher.resume(uploadId), { code: 'MAKER_V8_WALRUS_CERTIFICATION_INVALID' });
    assert.deepEqual(await persistence.load(uploadId), checkpoint);
  }
  for (const patch of [{ id: OWNER }, { size: '1' }, { deletable: true }, { certified_epoch: null }]) {
    cold.walrusClient.getBlobObject = async () => ({ ...exactBlob, ...patch });
    cold.queries.push('FINALIZED_SUCCESS');
    await assert.rejects(cold.publisher.resume(uploadId), { code: 'MAKER_V8_WALRUS_CERTIFICATION_INVALID' });
    assert.deepEqual(await persistence.load(uploadId), checkpoint);
  }
  cold.walrusClient.getBlobObject = async () => exactBlob;
  cold.walrusClient.getVerifiedBlobStatus = async () => ({ type: 'permanent', isCertified: false });
  cold.queries.push('FINALIZED_SUCCESS');
  await assert.rejects(cold.publisher.resume(uploadId), { code: 'MAKER_V8_WALRUS_CERTIFICATION_INVALID' });
  cold.walrusClient.getVerifiedBlobStatus = async () => ({ type: 'permanent', isCertified: true });
  cold.queries.push('FINALIZED_SUCCESS');
  assert.equal((await cold.publisher.resume(uploadId)).status, 'COMPLETE');
  assert.deepEqual(cold.calls.filter(([name]) => ['sign', 'broadcast', 'upload'].includes(name)), []);
});

test('publication review freezes one transaction; signing alone never broadcasts and rejects consumed review', async () => {
  const value = harness();
  const uploadId = 'review-upload';
  await value.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'application/json', bytesBase64: toBase64(value.bytes) });
  const review = await value.publisher.prepareReview(uploadId);
  assert.equal(review.gasBudgetMist, '10000000');
  assert.equal(review.gasPriceMist, '1000');
  assert.equal(review.storageCostAtomic, null);
  assert.deepEqual(review.quote, { quotedAt: '1970-01-01T00:00:00.101Z', walrusStorageCostFrost: null,
    walrusWriteCostFrost: null, walrusTotalCostFrost: null, relayTipMist: null, verified: false });
  await assert.rejects(value.publisher.signReviewed(uploadId, { ...review,
    quote: { ...review.quote, relayTipMist: '0', verified: true } }), { code: 'MAKER_V8_WALRUS_REVIEW_STALE' });
  assert.equal(value.calls.some(([name]) => ['sign', 'broadcast', 'upload'].includes(name)), false);
  const signed = await value.publisher.signReviewed(uploadId, review);
  assert.equal(signed.status, 'RECOVERY_REQUIRED');
  assert.deepEqual(value.calls.filter(([name]) => ['sign', 'broadcast', 'upload'].includes(name)), [['sign', review.digest]]);
  await assert.rejects(value.publisher.signReviewed(uploadId, review), { code: 'MAKER_V8_WALRUS_REVIEW_STALE' });
});

test('a rejected Walrus wallet request keeps its reviewed digest until the exact envelope expires', async () => {
  const value = harness();
  const uploadId = 'rejected-reviewed-pack-upload';
  const { publisher, wallet, buildClient } = value;
  await publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(value.bytes) });
  const review = await publisher.prepareReview(uploadId);
  const before = await publisher.load(uploadId);
  const rejection = Object.assign(new MakerV8DAppKitWalletError('MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED', 'Wallet rejected'), {
    definitiveRejection: true, signedArtifactCreated: false,
  });
  const sign = wallet.signExactTransaction;
  wallet.signExactTransaction = async ({ digest }) => {
    value.calls.push(['decline', digest]);
    throw rejection;
  };
  let guards = 0;
  await assert.rejects(publisher.signReviewed(uploadId, review, async () => { guards++; }), error => error === rejection);
  assert.equal(guards, 1, 'the Pack storage pin must not be claimed twice');
  const after = await publisher.load(uploadId);
  assert.equal(after.revision, before.revision + 2);
  assert.deepEqual(after, { ...before, revision: after.revision });
  const retained = await publisher.prepareReview(uploadId);
  assert.deepEqual(retained, { ...review, revision: after.revision });
  assert.deepEqual(value.calls.filter(([step]) => ['decline', 'query', 'broadcast'].includes(step)), [['decline', review.digest]]);

  buildClient.core.getCurrentSystemState = async () => ({ systemState: { epoch: '12' } });
  wallet.signExactTransaction = sign;
  await assert.rejects(publisher.signReviewed(uploadId, retained), { code: 'MAKER_V8_WALRUS_REVIEW_EXPIRED' });
  const next = await publisher.prepareReview(uploadId);
  assert.notEqual(next.digest, review.digest);
  await assert.rejects(publisher.signReviewed(uploadId, review), { code: 'MAKER_V8_WALRUS_REVIEW_STALE' });
  assert.equal(value.calls.some(([step]) => ['sign', 'query', 'broadcast'].includes(step)), false);
});

function typedAbsence(transactionDigest, watermarkEpoch, overrides = {}) {
  return { status: 'NOT_FOUND', digest: transactionDigest, absence: {
    schemaVersion: 'animacraft.sui-transaction-absence.v8', kind: 'SUI_GRPC_TRANSACTION_NOT_FOUND',
    grpcCode: 'NOT_FOUND', grpcService: 'sui.rpc.v2.LedgerService', grpcMethod: 'GetTransaction',
    requestedDigest: transactionDigest, chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    watermarkEpoch, watermarkCheckpointSequence: '100', watermarkCheckpointDigest: GAS_DIGEST, ...overrides,
  } };
}

test('cold single-blob recovery checks the exact signing intent and restores a finalized registration from Ledger', async () => {
  const storageManager = { persisted: async () => true, persist: async () => true };
  const database = new IDBFactory();
  const originalStore = createMakerV8WalrusPersistenceV8(database, { storageManager });
  const first = harness(originalStore);
  const uploadId = 'lost-wallet-response';
  await first.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(first.bytes) });
  const review = await first.publisher.prepareReview(uploadId);
  first.wallet.signExactTransaction = async input => {
    const intent = await originalStore.load(uploadId);
    assert.equal(intent.status, 'REGISTER_SIGNING');
    assert.equal(intent.transaction.digest, review.digest);
    assert.equal(intent.transaction.bytes, input.bytes);
    assert.equal(intent.transaction.signature, null);
    throw new Error('Wallet response lost');
  };
  await assert.rejects(first.publisher.signReviewed(uploadId, review), /response lost/);
  const intent = await originalStore.load(uploadId);
  await originalStore.close();
  const coldStore = createMakerV8WalrusPersistenceV8(database, { storageManager });
  try {
    const cold = harness(coldStore, 200);
    assert.equal(await cold.publisher.prepareReview(uploadId), null);
    const awaiting = await cold.publisher.load(uploadId);
    assert.equal(awaiting.status, 'RECOVERY_REQUIRED');
    assert.equal(awaiting.transactionDigest, review.digest);
    cold.queries.push(typedAbsence(review.digest, '11'));
    assert.deepEqual(await cold.publisher.resume(uploadId, awaiting), awaiting);
    cold.queries.push('FINALIZED_SUCCESS', 'FINALIZED_SUCCESS');
    let bytes = toBase64(new Uint8Array([1]));
    cold.transport.getFinalizedTransactionEvidence = async ({ digest }) => {
      assert.equal(digest, review.digest);
      return { digest, checkpoint: '101', transactionBcsBase64: bytes, effectsStatus: { success: true },
        signatures: [SIGNATURE] };
    };
    await assert.rejects(cold.publisher.resume(uploadId, awaiting), { code: 'MAKER_V8_WALRUS_TRANSACTION_DRIFT' });
    assert.deepEqual(await cold.publisher.load(uploadId), awaiting);
    bytes = intent.transaction.bytes;
    const result = await cold.publisher.resume(uploadId, awaiting);
    assert.equal(result.status, 'SIGNATURE_REQUIRED');
    assert.equal(result.stage, 'CERTIFY');
    assert.equal((await coldStore.load(uploadId)).upload.registrationDigest, review.digest);
    assert.equal(cold.calls.some(([name]) => ['sign', 'broadcast'].includes(name)), false);
    assert.deepEqual(cold.calls.filter(([name]) => ['query', 'upload'].includes(name)), [
      ['query', review.digest], ['query', review.digest], ['query', review.digest], ['upload', review.digest],
    ]);
  } finally { await coldStore.close(); }
});

test('a lost single-blob response permits a fresh review only after exact finalized absence past expiry', async () => {
  const store = memoryPersistence();
  const first = harness(store);
  const uploadId = 'lost-wallet-expired';
  await first.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(first.bytes) });
  const review = await first.publisher.prepareReview(uploadId);
  first.wallet.signExactTransaction = async () => { throw new Error('Wallet response lost'); };
  await assert.rejects(first.publisher.signReviewed(uploadId, review), /response lost/);
  const cold = harness(store, 200);
  cold.buildClient.core.getCurrentSystemState = async () => ({ systemState: { epoch: '12' } });
  cold.queries.push(typedAbsence(review.digest, '12', { requestedDigest: GAS_DIGEST }), typedAbsence(review.digest, '12'));
  const awaiting = await cold.publisher.load(uploadId);
  assert.equal(awaiting.status, 'RECOVERY_REQUIRED');
  assert.equal(await cold.publisher.prepareReview(uploadId), null);
  await assert.rejects(cold.publisher.resume(uploadId, awaiting), { code: 'MAKER_V8_WALRUS_ABSENCE_INVALID' });
  const ready = await cold.publisher.resume(uploadId, awaiting);
  assert.equal(ready.status, 'SIGNATURE_REQUIRED');
  assert.equal(ready.error.digest, review.digest);
  assert.notEqual((await cold.publisher.prepareReview(uploadId)).digest, review.digest);
  assert.deepEqual(cold.calls.filter(([name]) => ['query', 'sign', 'broadcast'].includes(name)), [
    ['query', review.digest], ['query', review.digest],
  ]);
});

test('an active single-blob signing intent prevents another tab from opening the wallet for that upload', async () => {
  const database = new IDBFactory();
  const storageManager = { persisted: async () => true, persist: async () => true };
  const firstStore = createMakerV8WalrusPersistenceV8(database, { storageManager });
  const secondStore = createMakerV8WalrusPersistenceV8(database, { storageManager });
  const first = harness(firstStore), second = harness(secondStore, 200);
  const uploadId = 'two-tabs-single-blob';
  let signed;
  const release = Promise.withResolvers();
  const entered = Promise.withResolvers();
  try {
    await first.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(first.bytes) });
    const [firstReview, secondReview] = await Promise.all([
      first.publisher.prepareReview(uploadId), second.publisher.prepareReview(uploadId),
    ]);
    const sign = first.wallet.signExactTransaction;
    first.wallet.signExactTransaction = async input => {
      entered.resolve();
      await release.promise;
      return sign(input);
    };
    signed = first.publisher.signReviewed(uploadId, firstReview);
    await Promise.race([entered.promise, signed]);
    await assert.rejects(second.publisher.signReviewed(uploadId, secondReview), { code: 'MAKER_V8_WALRUS_CONTEXT_CHANGED' });
    assert.equal((await second.publisher.load(uploadId)).transactionDigest, firstReview.digest);
    assert.equal(second.calls.some(([name]) => ['sign', 'broadcast'].includes(name)), false);
    release.resolve();
    assert.equal((await signed).transactionDigest, firstReview.digest);
  } finally {
    release.resolve();
    await signed?.catch(() => {});
    await firstStore.close();
    await secondStore.close();
  }
});

test('a signed Walrus registration keeps its digest through unknown and terminal failure across cold opens', async () => {
  const store = memoryPersistence();
  const first = harness(store);
  const uploadId = 'signed-pack-upload';
  await first.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(first.bytes) });
  const review = await first.publisher.prepareReview(uploadId);
  await first.publisher.signReviewed(uploadId, review);
  const cold = harness(store, 200);
  cold.queries.push(new Error('transport unavailable'), 'FINALIZED_FAILURE');
  await assert.rejects(cold.publisher.resume(uploadId), /transport unavailable/);
  assert.equal((await cold.publisher.load(uploadId)).transactionDigest, review.digest);
  const failed = await cold.publisher.resume(uploadId);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.transactionDigest, review.digest);
  assert.equal(await cold.publisher.prepareReview(uploadId), null);
  assert.deepEqual(await cold.publisher.resume(uploadId), failed);
  assert.deepEqual(cold.calls, [['query', review.digest], ['query', review.digest]]);
});

test('existing signed v1 uploads survive binding-store upgrade; blocked older tabs fail visibly and retry', async () => {
  const memory = memoryPersistence(), value = harness(memory);
  await value.publisher.prepare({ uploadId: 'old-signed', owner: OWNER,
    mediaType: 'application/json', bytesBase64: toBase64(value.bytes) });
  await value.publisher.signReviewed('old-signed', await value.publisher.prepareReview('old-signed'));
  const signed = await memory.load('old-signed');
  const indexedDB = new IDBFactory();
  const old = await new Promise((resolve, reject) => {
    const request = indexedDB.open('animacraft-maker-v8-walrus-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('uploads', { keyPath: 'uploadId' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = old.transaction('uploads', 'readwrite'); tx.objectStore('uploads').put(signed);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  const store = createMakerV8WalrusPersistenceV8(indexedDB, {
    storageManager: { async persisted() { return true; }, async persist() { return true; } },
  });
  await assert.rejects(store.load('old-signed'), { code: 'MAKER_V8_WALRUS_DATABASE_BLOCKED' });
  old.close();
  assert.deepEqual(await store.load('old-signed'), signed);
  const binding = await store.savePublicationBinding('draft-scope', null, { started: true, input: { marker: 'exact' } });
  assert.equal(binding.revision, 1);
  await assert.rejects(store.savePublicationBinding('draft-scope', null, { started: false }), { code: 'MAKER_V8_WALRUS_CAS_MISMATCH' });
  assert.deepEqual(await store.loadPublicationBinding('draft-scope'), binding);
  await store.close();
});

test('Mainnet Walrus upload is two-signature, durable, query-first, and byte-certified', async () => {
  const value = harness();
  const bytesBase64 = toBase64(value.bytes);
  const uploadId = makerV8WalrusUploadIdV8({
    owner: OWNER,
    purpose: 'manifest',
    contentSha256: 'ab'.repeat(32),
  });
  let view = await value.publisher.prepare({
    uploadId, owner: OWNER, mediaType: 'application/json', bytesBase64,
  });
  assert.equal(view.status, 'ENCODED');
  assert.equal(view.stage, 'REGISTER');
  assert.equal(view.epochs, 3);
  assert.equal(view.deletable, false);
  assert.deepEqual(await value.publisher.loadContent(uploadId), {
    schemaVersion: 'animacraft.maker-v8-walrus-upload.v1',
    uploadId,
    owner: OWNER,
    mediaType: 'application/json',
    bytesBase64,
    byteLength: value.bytes.length,
    byteSha256: view.byteSha256,
  });
  value.queries.push('NOT_FOUND');
  const registerExpected = { revision: view.revision, stage: 'REGISTER', status: 'SIGNATURE_REQUIRED' };
  await assert.rejects(value.publisher.requestSignature(uploadId, { ...registerExpected, stage: 'CERTIFY' }), { code: 'MAKER_V8_WALRUS_CONTEXT_CHANGED' });
  assert.equal(value.calls.filter(([name]) => name === 'sign').length, 0);
  view = await value.publisher.requestSignature(uploadId, registerExpected);
  assert.equal(view.status, 'RECOVERY_REQUIRED');
  assert.equal(view.stage, 'REGISTER');
  assert.ok(view.transactionDigest);
  assert.deepEqual(
    value.calls.filter(([name]) => ['sign', 'query', 'broadcast'].includes(name)).map(([name]) => name),
    ['sign', 'query', 'broadcast'],
    'signed WAL is cold-read and queried before its first broadcast',
  );
  value.queries.push('FINALIZED_SUCCESS');
  await assert.rejects(value.publisher.resume(uploadId, registerExpected), { code: 'MAKER_V8_WALRUS_CONTEXT_CHANGED' });
  view = await value.publisher.resume(uploadId, { revision: view.revision, stage: view.stage, status: view.status });
  assert.equal(view.status, 'SIGNATURE_REQUIRED');
  assert.equal(view.stage, 'CERTIFY');
  assert.equal(view.blobObjectId, OBJECT);
  value.queries.push('NOT_FOUND');
  view = await value.publisher.requestSignature(uploadId);
  assert.equal(view.status, 'RECOVERY_REQUIRED');
  value.queries.push('FINALIZED_SUCCESS');
  view = await value.publisher.resume(uploadId);
  assert.equal(view.status, 'COMPLETE');
  assert.equal(view.blobId, BLOB_ID);
  assert.equal(value.calls.filter(([name]) => name === 'sign').length, 2);
});

test('fresh v8 Walrus IndexedDB is strict CAS and never opens a legacy database', async () => {
  const store = createMakerV8WalrusPersistenceV8(indexedDB, {
    storageManager: { async persisted() { return true; }, async persist() { return true; } },
  });
  const value = harness(store);
  const uploadId = makerV8WalrusUploadIdV8({
    owner: OWNER, purpose: 'asset', contentSha256: 'cd'.repeat(32),
  });
  const prepared = await value.publisher.prepare({
    uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(value.bytes),
  });
  const source = await store.load(uploadId);
  assert.equal(source.revision, prepared.revision);
  assert.equal(source.status, 'ENCODED');
  assert.equal(source.byteSha256, prepared.byteSha256);
  assert.equal(store.capabilities.legacy, false);
  await store.close();
});

async function layoutFixture() {
  const store = createMakerV8WalrusPersistenceV8(new IDBFactory(), {
    storageManager: { async persisted() { return true; }, async persist() { return true; } },
  });
  const value = harness(store);
  for (const uploadId of ['layout-a', 'layout-b', 'layout-c']) {
    await value.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(value.bytes) });
  }
  const a = await store.load('layout-a');
  const schemaVersion = 'animacraft.maker-v8-asset-layout.v1';
  const source = ['a', 'b', 'c'].map(assetId => ({ assetId, uploadId: `layout-${assetId}`, mediaType: 'image/png', sha256: a.byteSha256 }));
  const { createHash } = await import('node:crypto');
  const sourceSha256 = createHash('sha256').update(JSON.stringify({ schemaVersion, owner: OWNER, source })).digest('hex');
  return { store, value, binding: { schemaVersion, owner: OWNER, sourceSha256, source }, key: `${schemaVersion}:${sourceSha256}` };
}

test('BUG-014: real WAL atomic layout invalidates held reviews once and survives concurrent cold adoption', async () => {
  const { store, value, binding, key } = await layoutFixture();
  const oldReview = await value.publisher.prepareReview('layout-a');
  const results = await Promise.all([value.publisher.bindAssetLayout(key, binding), value.publisher.bindAssetLayout(key, binding)]);
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0].members, ['a', 'b', 'c']);
  assert.equal((await store.load('layout-a')).revision, oldReview.revision + 1);
  await assert.rejects(value.publisher.signReviewed('layout-a', oldReview), { code: 'MAKER_V8_WALRUS_CONTEXT_CHANGED' });
  assert.equal(value.calls.filter(([name]) => name === 'sign').length, 0);
  const freshReview = await value.publisher.prepareReview('layout-a');
  await store.close();
  assert.deepEqual(await value.publisher.bindAssetLayout(key, binding), results[0]);
  assert.equal((await store.load('layout-a')).revision, freshReview.revision);
  await value.publisher.signReviewed('layout-a', freshReview);
  assert.equal(value.calls.filter(([name]) => name === 'sign').length, 1, 'later intentional standalone review stays usable');
  assert.deepEqual((await value.publisher.bindAssetLayout(key, binding)).members, ['a', 'b', 'c']);
  await store.close();
});

test('layout adoption honors a standalone signature that won before the atomic decision', async () => {
  const { store, value, binding, key } = await layoutFixture();
  const review = await value.publisher.prepareReview('layout-a');
  await value.publisher.signReviewed('layout-a', review);
  const signed = await store.load('layout-a');
  const chosen = await value.publisher.bindAssetLayout(key, binding);
  assert.deepEqual(chosen.members, ['b', 'c']);
  assert.deepEqual(await store.load('layout-a'), signed);
  await store.close();
});

test('layout binding write failure rolls back every review invalidation', async () => {
  const { store, value, binding, key } = await layoutFixture();
  const before = await store.load('layout-a');
  const { IDBObjectStore } = await import('fake-indexeddb');
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'publication-bindings') throw new Error('injected binding write failure');
    return original.apply(this, args);
  };
  try { await assert.rejects(value.publisher.bindAssetLayout(key, binding), /injected binding/); }
  finally { IDBObjectStore.prototype.add = original; }
  assert.deepEqual(await store.load('layout-a'), before);
  assert.equal(await store.loadPublicationBinding(key), null);
  const chosen = await value.publisher.bindAssetLayout(key, binding);
  assert.deepEqual(chosen.members, ['a', 'b', 'c']);
  assert.equal((await store.load('layout-a')).revision, before.revision + 1);
  await store.close();
});
