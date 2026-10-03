import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  createMakerV8WalrusPersistenceV8,
  createMakerV8WalrusPublisherV8,
  makerV8WalrusUploadIdV8,
} from '../maker-v8-walrus.js';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';

const OWNER = `0x${'11'.repeat(32)}`;
const OBJECT = `0x${'22'.repeat(32)}`;
const PACKAGE = `0x${'33'.repeat(32)}`;
const GAS = `0x${'44'.repeat(32)}`;
const GAS_DIGEST = toBase58(new Uint8Array(32).fill(5));
const ROOT_HASH = new Uint8Array(32).fill(7);
const NONCE = new Uint8Array(32).fill(8);
const BLOB_ID = 'A'.repeat(43);
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

function harness(persistence = memoryPersistence()) {
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
        blob_id: BLOB_ID,
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
      return status === 'NOT_FOUND'
        ? { status, digest, absence: { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER } }
        : { status, digest, absence: null, error: null };
    },
  };
  const wallet = {
    async getCurrentAccount() { return { address: OWNER, network: 'mainnet' }; },
    async signExactTransaction({ bytes: transactionBytes, digest, signer }) {
      calls.push(['sign', digest]);
      return { bytes: transactionBytes, digest, signer, signature: SIGNATURE };
    },
    async verifyExactSignature({ bytes: transactionBytes, digest, signer }) {
      assert.equal(TransactionDataBuilder.getDigestFromBytes(Buffer.from(transactionBytes, 'base64')), digest);
      return { verified: true, bytes: transactionBytes, digest, signer };
    },
  };
  const publisher = createMakerV8WalrusPublisherV8({
    walrusClient,
    buildClient: { core: { async getCurrentSystemState() { return { systemState: { epoch: '10' } }; } } },
    rpc,
    wallet,
    persistence,
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true, allowBroadcast: true,
    },
    fetcher: async () => ({ ok: true, async arrayBuffer() { return bytes.buffer.slice(0); } }),
    now: (() => { let value = 100; return () => value++; })(),
  });
  return { publisher, bytes, calls, queries };
}

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
