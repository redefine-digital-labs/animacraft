import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { WalrusClient, MAINNET_WALRUS_PACKAGE_CONFIG, blobIdFromInt } from '@mysten/walrus';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64, fromBase64, normalizeStructTag } from '@mysten/sui/utils';
import { makerV8WalrusTransactionQuote, createMakerV8WalrusPublisherV8, createMakerV8WalrusPersistenceV8 } from '../maker-v8-walrus.js';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';
import { MakerV8DAppKitWalletError } from '../maker-v8-dapp-kit-wallet.js';
import { MakerV8WalrusBlobBcs as Blob, MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID as ORIGINAL } from '../maker-v8-walrus-execution.js';
import { walrusExecutionObjectFixture as objectProof } from './fixtures/walrus-execution-fixture.js';
import { makerV8PublicationExpiration } from '../maker-v8-publication-expiration.js';

// Synthetic prices/accounts exercise the actual pinned SDK builder, not live
// Mainnet prices or simulated acceptance. No network, wallet, or broadcasts.
const testSigner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(19));
const OWNER = testSigner.toSuiAddress(), RELAY = `0x${'22'.repeat(32)}`;
const PACKAGE = `0x${'33'.repeat(32)}`, COIN = `0x${'44'.repeat(32)}`;
const WAL = `${'0x' + '55'.repeat(32)}::wal::WAL`;
const SYSTEM = MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId;
const DIGEST = toBase58(new Uint8Array(32).fill(6));
const system = { id: SYSTEM, package_id: PACKAGE };
const QUOTED_AT = '2026-10-03T00:00:00.000Z';

async function sdkTransaction(addressBalance, { tip = 257n } = {}) {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' });
  client.core.getObjects = async ({ objectIds }) => ({ objects: objectIds.map(objectId => ({ objectId,
    type: `${PACKAGE}::system::System`, version: '1', digest: DIGEST })) });
  client.core.getMoveFunction = async () => ({ function: { parameters: [null, { body: { $kind: 'datatype', datatype: {
    typeParameters: [{ $kind: 'datatype', datatype: { typeName: WAL } }],
  } } }] } });
  client.core.getBalance = async () => ({ balance: { addressBalance: addressBalance ? '999999999999' : '0',
    coinBalance: addressBalance ? '0' : '999999999999', balance: '999999999999' } });
  client.core.listCoins = async () => ({ objects: addressBalance ? [] : [{ objectId: COIN, version: '1',
    digest: DIGEST, balance: '999999999999' }], hasNextPage: false, cursor: null });
  const walrus = new WalrusClient({ network: 'mainnet', suiClient: client,
    uploadRelay: { host: 'https://relay.invalid', sendTip: { kind: { const: tip }, address: RELAY } } });
  walrus.systemObject = async () => system;
  walrus.systemState = async () => ({ committee: { n_shards: 1000 }, storage_price_per_unit_size: '11', write_price_per_unit_size: '7' });
  walrus.computeBlobMetadata = async ({ bytes }) => ({ blobId: 'A'.repeat(43), rootHash: new Uint8Array(32),
    nonce: new Uint8Array(32), blobDigest: new Uint8Array(32), metadata: { unencodedLength: BigInt(bytes.length) } });
  const flow = walrus.writeBlobFlow({ blob: new Uint8Array(1031) });
  await flow.encode();
  const tx = flow.register({ epochs: 3, deletable: false, owner: OWNER,
    attributes: { contentType: 'image/png', sha256: 'aa'.repeat(32) } });
  const configure = tx => {
    tx.setGasOwner(OWNER); tx.setGasBudget(1234567); tx.setGasPrice(1000);
    tx.setGasPayment(addressBalance ? [] : [{ objectId: `0x${'66'.repeat(32)}`, version: '1', digest: DIGEST }]);
    tx.setExpiration(makerV8PublicationExpiration('10'));
    tx.addBuildPlugin(async (data, _options, next) => {
    for (let i = 0; i < data.inputs.length; i++) if (data.inputs[i].UnresolvedObject) {
      assert.equal(data.inputs[i].UnresolvedObject.objectId, SYSTEM);
      data.inputs[i] = Inputs.SharedObjectRef({ objectId: SYSTEM, initialSharedVersion: '1', mutable: true });
    }
      await next();
    });
    return tx;
  };
  configure(tx);
  const bytes = await tx.build({ client });
  return { bytes, expected: await walrus.storageCost(1031, 3), walrus, tip, client, configure };
}

const quote = (bytes, patch = {}) => makerV8WalrusTransactionQuote({ bytesBase64: toBase64(bytes),
  stage: 'REGISTER', authority: { system, walCoinType: WAL, relayAddress: RELAY },
  owner: OWNER, epochs: 3, byteLength: 1031, quotedAt: QUOTED_AT, ...patch });

for (const addressBalance of [false, true]) test(`real SDK exact payment quote with ${addressBalance ? 'address-balance' : 'coin-object'} funding`, async () => {
  const value = await sdkTransaction(addressBalance);
  assert.deepEqual(quote(value.bytes), { quotedAt: QUOTED_AT, walrusStorageCostFrost: value.expected.storageCost.toString(),
    walrusWriteCostFrost: value.expected.writeCost.toString(), walrusTotalCostFrost: value.expected.totalCost.toString(),
    relayTipMist: value.tip.toString(), verified: true });
  const digest = TransactionDataBuilder.getDigestFromBytes(value.bytes);
  value.walrus.storageCost = async () => ({ storageCost: 1n, writeCost: 2n, totalCost: 3n });
  assert.equal(quote(value.bytes).walrusTotalCostFrost, value.expected.totalCost.toString(), 'later prices never replace frozen payments');
  assert.equal(TransactionDataBuilder.getDigestFromBytes(value.bytes), digest);
  const data = bcs.TransactionData.parse(value.bytes);
  if (addressBalance) {
    const withdrawals = data.V1.kind.ProgrammableTransaction.inputs.filter(input => input.FundsWithdrawal);
    assert.ok(withdrawals.length >= 2);
    for (const input of withdrawals) input.FundsWithdrawal.reservation.MaxAmountU64 = '999999999999999';
    assert.deepEqual(quote(bcs.TransactionData.serialize(data).toBytes()), quote(value.bytes), 'withdrawal maxima are not quoted as fees');
  }
});

test('payment quote refuses wrong system, WAL currency, recipient, amount provenance and extra charges', async () => {
  const { bytes } = await sdkTransaction(true);
  for (const patch of [
    { authority: { system: { ...system, package_id: OWNER }, walCoinType: WAL, relayAddress: RELAY } },
    { authority: { system, walCoinType: normalizeStructTag('0x2::sui::SUI'), relayAddress: RELAY } },
    { authority: { system, walCoinType: WAL, relayAddress: OWNER } },
    { epochs: 9 }, { byteLength: 1024 },
  ]) assert.equal(quote(bytes, patch).verified, false);
  for (const change of ['input-payment', 'reuse-payment', 'extra-transfer', 'unknown-command']) {
    const data = bcs.TransactionData.parse(bytes);
    const pt = data.V1.kind.ProgrammableTransaction;
    const storage = pt.commands.find(command => command.MoveCall?.function === 'reserve_space').MoveCall;
    const register = pt.commands.find(command => command.MoveCall?.function === 'register_blob').MoveCall;
    if (change === 'input-payment') storage.arguments[3] = { Input: 0 };
    if (change === 'reuse-payment') register.arguments[7] = storage.arguments[3];
    if (change === 'extra-transfer') pt.commands.push(structuredClone(pt.commands.find(command => command.TransferObjects)));
    if (change === 'unknown-command') pt.commands.push({ MoveCall: { package: PACKAGE, module: 'unknown', function: 'charge', typeArguments: [], arguments: [] } });
    const result = quote(bcs.TransactionData.serialize(data).toBytes());
    assert.equal(result.verified, false, change);
    assert.equal(result.walrusTotalCostFrost, null, change);
    assert.equal(result.relayTipMist, null, change);
  }
});

for (const addressBalance of [false, true]) test(`four raw Blobs share one SDK registration with exact aggregate payments (${addressBalance ? 'balance' : 'coin'})`, async () => {
  const value = await sdkTransaction(addressBalance);
  const members = [1031, 2057, 3179, 4111].map((byteLength, i) => ({
    byteLength, epochs: 3, blobId: blobIdFromInt(BigInt(i + 1)), rootHash: toBase64(new Uint8Array(32).fill(i + 1)),
  }));
  const transaction = value.configure(new Transaction()); transaction.setSender(OWNER);
  for (const member of members) {
    transaction.add(value.walrus.sendUploadRelayTip({ size: member.byteLength,
      blobDigest: new Uint8Array(32), nonce: new Uint8Array(32) }));
    assert.equal(value.walrus.registerBlobTransaction({ transaction, size: member.byteLength, epochs: member.epochs,
      blobId: member.blobId, rootHash: Uint8Array.from(Buffer.from(member.rootHash, 'base64')), deletable: false,
      owner: OWNER, attributes: { contentType: 'application/octet-stream', sha256: 'ab'.repeat(32) } }), transaction);
  }
  const bytes = await transaction.build({ client: value.client });
  const costs = await Promise.all(members.map(member => value.walrus.storageCost(member.byteLength, member.epochs)));
  const check = (data, expected = members) => quote(data, { members: expected });
  assert.deepEqual(check(bytes), { quotedAt: QUOTED_AT,
    walrusStorageCostFrost: costs.reduce((sum, cost) => sum + cost.storageCost, 0n).toString(),
    walrusWriteCostFrost: costs.reduce((sum, cost) => sum + cost.writeCost, 0n).toString(),
    walrusTotalCostFrost: costs.reduce((sum, cost) => sum + cost.totalCost, 0n).toString(),
    relayTipMist: (value.tip * 4n).toString(), verified: true });
  for (const patch of ['missing', 'reorder', 'byteLength', 'epochs', 'blobId', 'rootHash']) {
    const drifted = structuredClone(members);
    if (patch === 'missing') drifted.pop();
    else if (patch === 'reorder') drifted.reverse();
    else drifted[1][patch] = patch === 'blobId' ? drifted[0].blobId : patch === 'rootHash' ? drifted[0].rootHash : 99;
    assert.equal(check(bytes, drifted).verified, false, patch);
  }
  const duplicateTransfer = bcs.TransactionData.parse(bytes);
  const commands = duplicateTransfer.V1.kind.ProgrammableTransaction.commands;
  const blobTransfers = commands.filter(command => command.TransferObjects?.objects[0]?.Result !== undefined);
  assert.equal(blobTransfers.length, 4);
  blobTransfers[1].TransferObjects.objects = structuredClone(blobTransfers[0].TransferObjects.objects);
  assert.equal(check(bcs.TransactionData.serialize(duplicateTransfer).toBytes()).verified, false);
});

test('certification is zero business payment only when the entire frozen transaction proves no extra payment', async () => {
  const blobObjectId = `0x${'77'.repeat(32)}`;
  const tx = new Transaction(); tx.setSender(OWNER); tx.setGasOwner(OWNER);
  tx.setGasBudget(777); tx.setGasPrice(1000); tx.setGasPayment([]);
  tx.setExpiration(makerV8PublicationExpiration('10'));
  tx.moveCall({ target: `${PACKAGE}::system::certify_blob`, arguments: [
    tx.sharedObjectRef({ objectId: SYSTEM, initialSharedVersion: '1', mutable: true }),
    tx.objectRef({ objectId: blobObjectId, version: '1', digest: DIGEST }),
    tx.pure.vector('u8', []), tx.pure.vector('u8', []), tx.pure.vector('u8', []),
  ] });
  const bytes = await tx.build();
  assert.deepEqual(quote(bytes, { stage: 'CERTIFY', blobObjectId }), { quotedAt: QUOTED_AT,
    walrusStorageCostFrost: '0', walrusWriteCostFrost: '0', walrusTotalCostFrost: '0', relayTipMist: '0', verified: true });
  tx.transferObjects([tx.splitCoins(tx.gas, [tx.pure.u64(9)])[0]], RELAY);
  assert.equal(quote(await tx.build(), { stage: 'CERTIFY', blobObjectId }).verified, false);
});

test('four certifications share the real SDK transaction and quote zero business payment only for the fixed objects', async () => {
  const value = await sdkTransaction(true);
  value.walrus.systemState = async () => ({ committee: { members: [] } });
  const transaction = new Transaction(); transaction.setSender(OWNER); transaction.setGasOwner(OWNER);
  transaction.setGasBudget(1234567); transaction.setGasPrice(1000); transaction.setGasPayment([]);
  transaction.setExpiration(makerV8PublicationExpiration('1272'));
  const members = [0, 1, 2, 3].map(i => ({ blobId: blobIdFromInt(BigInt(i + 1)), blobObjectId: `0x${String(77 + i).repeat(32)}` }));
  transaction.addBuildPlugin(async (data, _options, next) => {
    for (let i = 0; i < data.inputs.length; i++) if (data.inputs[i].UnresolvedObject) {
      const objectId = data.inputs[i].UnresolvedObject.objectId;
      data.inputs[i] = objectId === SYSTEM
        ? Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: true })
        : Inputs.ObjectRef({ objectId, version: '11', digest: DIGEST });
    }
    await next();
  });
  for (const member of members) assert.equal(value.walrus.certifyBlobTransaction({ transaction, ...member,
    deletable: false, certificate: { signature: new Uint8Array(48), signers: [], serializedMessage: new Uint8Array(0) } }), transaction);
  const bytes = await transaction.build({ client: value.client });
  assert.deepEqual(quote(bytes, { stage: 'CERTIFY', members }), { quotedAt: QUOTED_AT,
    walrusStorageCostFrost: '0', walrusWriteCostFrost: '0', walrusTotalCostFrost: '0', relayTipMist: '0', verified: true });
  assert.equal(quote(bytes, { stage: 'CERTIFY', members: members.slice(0, 3) }).verified, false);
  assert.equal(quote(bytes, { stage: 'CERTIFY', members: [...members].reverse() }).verified, false);
  const tampered = bcs.TransactionData.parse(bytes);
  tampered.V1.kind.ProgrammableTransaction.commands.push({ TransferObjects: { objects: [{ GasCoin: true }], address: { Input: 0 } } });
  assert.equal(quote(bcs.TransactionData.serialize(tampered).toBytes(), { stage: 'CERTIFY', members }).verified, false);
});

test('publisher compiles the four claimed members through the real shared-transaction SDK before any wallet request', async () => {
  const value = await sdkTransaction(true);
  value.walrus.computeBlobMetadata = async ({ bytes, nonce = new Uint8Array(32).fill(7) }) => ({
    blobId: blobIdFromInt(BigInt(bytes.length)), rootHash: new Uint8Array(32).fill(bytes.length % 256),
    nonce, blobDigest: new Uint8Array(32), metadata: { unencodedLength: BigInt(bytes.length) },
  });
  const originalRegister = value.walrus.registerBlobTransaction.bind(value.walrus);
  value.walrus.registerBlobTransaction = input => value.configure(originalRegister(input));
  value.client.core.getCurrentSystemState = async () => ({ systemState: { epoch: '1272' } });
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  let walletRequests = 0;
  const publisher = createMakerV8WalrusPublisherV8({ walrusClient: value.walrus, buildClient: value.client, persistence,
    rpc: { async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
      async queryTransaction() { assert.fail('Preparation must not query or broadcast a payment'); },
      async getSuiClient() { assert.fail('Preparation must not execute'); } },
    wallet: { async getCurrentAccount() { walletRequests++; return { address: OWNER, network: 'mainnet' }; },
      async signExactTransaction() { walletRequests++; assert.fail('Preparation must not sign'); },
      async verifyExactSignature() { walletRequests++; assert.fail('Preparation must not sign'); } },
    execution: { network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, allowWalletSignature: true, allowBroadcast: true },
    quoteAuthority: async () => ({ system, walCoinType: WAL, relayAddress: RELAY }), now: () => 123,
  });
  const uploadIds = ['render', 'soul', 'memory', 'skill'];
  for (const [i, uploadId] of uploadIds.entries()) await publisher.prepare({ uploadId, owner: OWNER,
    mediaType: i ? 'application/octet-stream' : 'image/png', bytesBase64: toBase64(new Uint8Array(1031 + i)) });
  const batch = await publisher.prepareBatch({ owner: OWNER, rootId: PACKAGE, uploadIds });
  const review = await publisher.prepareBatchReview(batch.key);
  assert.equal(review.stage, 'REGISTER'); assert.equal(review.quote.verified, true);
  assert.deepEqual(review.memberIds, uploadIds); assert.equal(review.relayTipMist, (value.tip * 4n).toString());
  assert.equal(walletRequests, 0);
  const prepared = await publisher.prepareBatch({ owner: OWNER, rootId: PACKAGE, uploadIds });
  assert.equal(prepared.key, batch.key); assert.deepEqual(prepared.members, batch.members);
  assert.equal(prepared.status, 'REGISTER_PREPARED'); assert.equal(prepared.revision, 2);
  assert.equal(prepared.transaction.digest, review.digest); assert.equal(prepared.transaction.signature, null);
  assert.deepEqual(await publisher.prepareBatchReview(batch.key), review, 'Repeated review keeps exact persisted bytes and quote.');
  assert.deepEqual(await persistence.loadPublicationBinding(batch.key), prepared);
  await assert.rejects(publisher.prepareBatch({ owner: OWNER, rootId: COIN, uploadIds }), { code: 'MAKER_V8_WALRUS_BATCH_INVALID' });
  await persistence.close();
});

test('publisher review binds detailed SDK quote to the exact digest signed without requoting or broadcasting', async () => {
  const value = await sdkTransaction(true);
  const originalFlow = value.walrus.writeBlobFlow.bind(value.walrus);
  value.walrus.writeBlobFlow = input => {
    const flow = originalFlow(input);
    return { ...flow, register: options => value.configure(flow.register(options)) };
  };
  value.client.core.getCurrentSystemState = async () => ({ systemState: { epoch: '10' } });
  const rows = new Map(), signed = [], writes = [];
  const publisher = createMakerV8WalrusPublisherV8({ walrusClient: value.walrus, buildClient: value.client,
    persistence: {
      async requirePersistentStorage() {}, async create(record) { rows.set(record.uploadId, structuredClone(record)); return structuredClone(record); },
      async load(id) { return structuredClone(rows.get(id)); }, async compareAndSwap(current, next) {
        assert.equal(rows.get(current.uploadId).revision, current.revision); rows.set(next.uploadId, structuredClone(next)); return structuredClone(next);
      },
    }, rpc: { async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
      async queryTransaction() { writes.push('query'); throw new Error('sign-only'); }, async getSuiClient() { writes.push('broadcast'); throw new Error('sign-only'); } },
    wallet: { async getCurrentAccount() { return { address: OWNER, network: 'mainnet' }; },
      async signExactTransaction(input) { signed.push(input); return { ...input, signature: toBase64(new Uint8Array(97).fill(8)) }; },
      async verifyExactSignature() { return { verified: true }; } },
    execution: { network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, allowWalletSignature: true, allowBroadcast: true },
    quoteAuthority: async () => ({ system, walCoinType: WAL, relayAddress: RELAY }), now: () => 123,
  });
  await publisher.prepare({ uploadId: 'frozen-sdk-quote', owner: OWNER, mediaType: 'image/png', bytesBase64: toBase64(new Uint8Array(1031)) });
  const review = await publisher.prepareReview('frozen-sdk-quote');
  assert.equal(review.quote.verified, true);
  assert.equal(review.quote.walrusTotalCostFrost, value.expected.totalCost.toString());
  assert.equal(review.gasBudgetMist, '1234567');
  assert.ok(Object.isFrozen(review.quote));
  await assert.rejects(publisher.signReviewed('frozen-sdk-quote', { ...review,
    quote: { ...review.quote, walrusTotalCostFrost: '0' } }), { code: 'MAKER_V8_WALRUS_REVIEW_STALE' });
  value.walrus.storageCost = async () => { throw new Error('must not reprice frozen transaction'); };
  await publisher.signReviewed('frozen-sdk-quote', review);
  assert.equal(signed.length, 1); assert.equal(signed[0].digest, review.digest);
  assert.equal(quote(Buffer.from(signed[0].bytes, 'base64')).walrusTotalCostFrost, review.quote.walrusTotalCostFrost);
  assert.deepEqual(writes, []);
});


// Synthetic network/relay responses and a deterministic test-only Ed25519 key
// around real signature verification, SDK builders and
// real IndexedDB. This proves recovery boundaries, not real Mainnet acceptance.
async function batchRuntime() {
  const sdk = await sdkTransaction(true);
  const persistence = createMakerV8WalrusPersistenceV8(new IDBFactory(), { storageManager: {
    persisted: async () => true, persist: async () => true,
  } });
  const calls = [], receipts = new Map(), inputs = new Map();
  const controls = { epoch: '1272', signError: null, uploadFailure: null, readbackFailure: false,
    broadcastUnknown: false, finalizedSignature: false, signWait: null };
  const objectId = i => `0x${(80 + i).toString(16).padStart(64, '0')}`;
  const signatures = new Map();
  const certificate = bcs.struct('Certificate', { signers: bcs.vector(bcs.u16()),
    serializedMessage: bcs.byteVector(), signature: bcs.byteVector() }).serialize({
      signers: [], serializedMessage: [], signature: new Uint8Array(48),
    }).toBase64();
  sdk.client.core.getCurrentSystemState = async () => ({ systemState: { epoch: controls.epoch } });
  sdk.walrus.computeBlobMetadata = async ({ bytes, nonce = new Uint8Array(32).fill(7) }) => ({
    blobId: blobIdFromInt(BigInt(bytes.length)), rootHash: new Uint8Array(32).fill(bytes.length % 256),
    nonce, blobDigest: new Uint8Array(32), metadata: { unencodedLength: BigInt(bytes.length) },
  });
  sdk.walrus.systemState = async () => ({ committee: { n_shards: 1000, members: [] },
    storage_price_per_unit_size: '11', write_price_per_unit_size: '7' });
  const configure = transaction => {
    transaction.setGasOwner(OWNER); transaction.setGasBudget(1234567); transaction.setGasPrice(1000);
    transaction.setGasPayment([]);
    transaction.addBuildPlugin(async (data, _options, next) => {
      for (let i = 0; i < data.inputs.length; i++) if (data.inputs[i].UnresolvedObject) {
        const id = data.inputs[i].UnresolvedObject.objectId;
        data.inputs[i] = id === SYSTEM ? Inputs.SharedObjectRef({ objectId: id, initialSharedVersion: '1', mutable: true })
          : Inputs.ObjectRef({ objectId: id, version: '11', digest: DIGEST });
      }
      await next();
    });
    return transaction;
  };
  for (const method of ['registerBlobTransaction', 'certifyBlobTransaction']) {
    const original = sdk.walrus[method].bind(sdk.walrus);
    sdk.walrus[method] = input => configure(original(input));
  }
  sdk.walrus.writeBlobFlow = ({ blob, resume }) => ({
    async encode() {}, async upload({ digest }) {
      const member = [...inputs.values()].find(input => input.bytes.length === blob.length);
      calls.push(['upload', member.uploadId, resume.blobObjectId, digest]);
      assert.equal(resume.blobObjectId, member.objectId, 'Never let the SDK choose the first created object in a shared digest.');
      if (controls.uploadFailure === member.uploadId) throw new Error('relay unavailable');
      return { blobId: member.blobId, blobObjectId: member.objectId, certificate };
    },
  });
  sdk.walrus.getBlobObject = async id => {
    const member = [...inputs.values()].find(input => input.objectId === id);
    return { id, blob_id: String(member.bytes.length), size: String(member.bytes.length),
      deletable: false, certified_epoch: 43, storage: { end_epoch: 46 } };
  };
  sdk.walrus.getVerifiedBlobStatus = async () => ({ type: 'permanent', isCertified: true });
  const finalized = (digest, bytes) => {
    const data = bcs.TransactionData.parse(fromBase64(bytes)).V1;
    const registering = data.kind.ProgrammableTransaction.commands.some(c => c.MoveCall?.function === 'register_blob');
    const objects = registering ? [...inputs.values()].map((input, i) => objectProof({ data: { Move: {
      type: { Other: TypeTagSerializer.parseFromStr(`${ORIGINAL}::blob::Blob`, true).struct }, version: '11',
      hasPublicTransfer: true, contents: Blob.serialize({ id: input.objectId, registered_epoch: 43,
        blob_id: String(input.bytes.length), size: String(input.bytes.length), encoding_type: 1, certified_epoch: null,
        storage: { id: objectId(i + 10), start_epoch: 43, end_epoch: 46, storage_size: '66000000' }, deletable: false }).toBytes(),
    } }, owner: { AddressOwner: OWNER }, previousTransaction: digest, storageRebate: '0' })) : [];
    const effects = { V2: { status: { Success: true }, executedEpoch: '1272',
      gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '11',
      changedObjects: objects.slice().reverse().map(object => [object.reference.objectId, { inputState: { NotExist: true },
        outputState: { ObjectWrite: [object.reference.digest, { AddressOwner: OWNER }] }, idOperation: { Created: true } }]),
      unchangedConsensusObjects: [], auxDataDigest: null } };
    receipts.set(digest, { digest, effectsStatus: { success: true }, checkpoint: '331071794',
      transactionBcsBase64: bytes, effectsBcsBase64: bcs.TransactionEffects.serialize(effects).toBase64(), signatures: [signatures.get(digest)], objects });
  };
  const transport = { core: { async executeTransaction({ transaction, signatures }) {
    const digest = TransactionDataBuilder.getDigestFromBytes(transaction);
    assert.equal(await isValidTransactionSignature(transaction, signatures[0], OWNER), true); calls.push(['broadcast', digest, toBase64(transaction)]);
    finalized(digest, toBase64(transaction));
    if (controls.broadcastUnknown) throw new Error('response lost');
    return { $kind: 'Transaction', Transaction: { digest } };
  } }, async getFinalizedTransactionEvidence({ digest }) { return structuredClone(receipts.get(digest)); },
    async getHistoricalObject({ objectId, version }) {
      const object = [...receipts.values()].flatMap(r => r.objects).find(o => o.reference.objectId === objectId);
      assert.equal(version, 11n);
      return { objectId, version: '11', digest: object.reference.digest, objectBcs: fromBase64(object.objectBcsBase64) };
    } };
  const rpc = { async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async queryTransaction({ digest }) { calls.push(['query', digest]); return receipts.has(digest)
      ? { digest, status: 'FINALIZED_SUCCESS' } : { digest, status: 'NOT_FOUND', absence: { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER } }; },
    async getSuiClient() { return transport; } };
  const wallet = { async getCurrentAccount() { return { address: OWNER, network: 'mainnet' }; },
    async signExactTransaction(input) {
      calls.push(['sign', input.digest, input.bytes]);
      if (controls.signWait) await controls.signWait;
      const { signature } = await testSigner.signTransaction(fromBase64(input.bytes));
      signatures.set(input.digest, signature);
      if (controls.finalizedSignature) finalized(input.digest, input.bytes);
      if (controls.signError) throw controls.signError;
      return { ...input, signature };
    }, async verifyExactSignature(input) {
      assert.equal(input.signer, OWNER);
      assert.equal(await isValidTransactionSignature(fromBase64(input.bytes), input.signature, input.signer), true);
      assert.equal(TransactionDataBuilder.getDigestFromBytes(fromBase64(input.bytes)), input.digest);
      return { ...input, verified: true };
    } };
  let held = false;
  const locks = { async request(_name, options, fn) {
    assert.equal(options.ifAvailable, true);
    if (held) return fn(null);
    held = true; try { return await fn({}); } finally { held = false; }
  } };
  const options = { walrusClient: sdk.walrus, buildClient: sdk.client, persistence, rpc, wallet, locks,
    execution: { network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, allowWalletSignature: true, allowBroadcast: true },
    quoteAuthority: async () => ({ system, walCoinType: WAL, relayAddress: RELAY }), now: () => 123,
    fetcher: async url => {
      if (controls.readbackFailure) return { ok: false };
      const member = [...inputs.values()].find(input => url.endsWith(input.blobId));
      return { ok: true, arrayBuffer: async () => member.bytes.buffer };
    } };
  const publisher = createMakerV8WalrusPublisherV8(options);
  const uploadIds = ['render', 'soul', 'memory', 'skill'];
  for (const [i, uploadId] of uploadIds.entries()) {
    const bytes = new Uint8Array(1031 + i).fill(i);
    inputs.set(uploadId, { uploadId, bytes, blobId: blobIdFromInt(BigInt(bytes.length)), objectId: objectId(i) });
    await publisher.prepare({ uploadId, owner: OWNER, mediaType: 'application/octet-stream', bytesBase64: toBase64(bytes) });
  }
  const batch = await publisher.prepareBatch({ owner: OWNER, rootId: PACKAGE, uploadIds });
  return { publisher, persistence, batch, controls, calls, inputs,
    cold: () => createMakerV8WalrusPublisherV8(options) };
}

const signBatch = async h => {
  const review = await h.publisher.prepareBatchReview(h.batch.key);
  await h.publisher.signBatchReviewed(h.batch.key, review, async () => {});
  return review;
};
const finalizeRegister = async h => {
  await signBatch(h); await h.publisher.resumeBatch(h.batch.key); return h.publisher.resumeBatch(h.batch.key);
};

test('four-member SDK batch completes with two signatures, correct per-member relay IDs and atomic cold checkpoints', async () => {
  const h = await batchRuntime();
  assert.equal((await finalizeRegister(h)).status, 'SIGNATURE_REQUIRED');
  const before = await h.persistence.loadPublicationBinding(h.batch.key);
  assert.equal(before.status, 'UPLOADED');
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 1);
  assert.deepEqual(h.calls.filter(c => c[0] === 'upload').map(c => c[2]), [...h.inputs.values()].map(v => v.objectId));
  await signBatch(h); await h.publisher.resumeBatch(h.batch.key);
  assert.equal((await h.cold().resumeBatch(h.batch.key)).status, 'COMPLETE');
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 2);
  for (const member of h.inputs.values()) {
    const record = await h.persistence.load(member.uploadId);
    assert.equal(record.status, 'COMPLETE'); assert.equal(record.upload.blobObjectId, member.objectId);
    assert.equal(record.transaction.stage, 'CERTIFY');
    assert.equal(record.readback.sha256, record.byteSha256);
  }
  for (const call of h.calls.filter(c => c[0] === 'broadcast')) {
    assert.ok(h.calls.slice(0, h.calls.indexOf(call)).some(c => c[0] === 'query' && c[1] === call[1]));
  }
  await h.persistence.close();
});

test('expired unsigned batch gets a fresh visible review; a signed envelope is never rebuilt', async () => {
  const h = await batchRuntime();
  const original = await h.publisher.prepareBatchReview(h.batch.key);
  assert.deepEqual(await h.cold().prepareBatchReview(h.batch.key), original);
  h.controls.epoch = '1274';
  await assert.rejects(h.publisher.signBatchReviewed(h.batch.key, original, async () => {}), { code: 'MAKER_V8_WALRUS_REVIEW_EXPIRED' });
  const fresh = await h.publisher.prepareBatchReview(h.batch.key);
  assert.notEqual(fresh.digest, original.digest);
  await assert.rejects(h.publisher.signBatchReviewed(h.batch.key, original, async () => {}), { code: 'MAKER_V8_WALRUS_REVIEW_STALE' });
  await h.publisher.signBatchReviewed(h.batch.key, fresh, async () => {});
  h.controls.epoch = '1276';
  assert.equal(await h.cold().prepareBatchReview(h.batch.key), null);
  assert.equal((await h.persistence.loadPublicationBinding(h.batch.key)).transaction.digest, fresh.digest);
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 1);
  await h.persistence.close();
});

for (const definitive of [true, false]) test(`batch signature ${definitive ? 'definitive cancellation' : 'unknown outcome'} preserves bytes and prevents duplicate payment`, async () => {
  const h = await batchRuntime();
  const review = await h.publisher.prepareBatchReview(h.batch.key);
  h.controls.signError = definitive ? Object.assign(new MakerV8DAppKitWalletError('MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED', 'cancel'),
    { definitiveRejection: true, signedArtifactCreated: false }) : new Error('wallet response lost');
  await assert.rejects(h.publisher.signBatchReviewed(h.batch.key, review, async () => {}));
  const saved = await h.persistence.loadPublicationBinding(h.batch.key);
  assert.equal(saved.status, definitive ? 'REGISTER_PREPARED' : 'REGISTER_SIGNING');
  assert.equal(saved.transaction.digest, review.digest);
  if (definitive) {
    const retry = await h.cold().prepareBatchReview(h.batch.key);
    assert.equal(retry.digest, review.digest);
  } else {
    assert.equal(await h.cold().prepareBatchReview(h.batch.key), null);
    assert.equal((await h.cold().resumeBatch(h.batch.key)).reason, 'SIGNATURE_OUTCOME_UNKNOWN');
  }
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'broadcast').length, 0);
  await h.persistence.close();
});

test('unknown wallet result recovers the original finalized signature without another prompt', async () => {
  const h = await batchRuntime(); h.controls.finalizedSignature = true; h.controls.signError = new Error('response lost');
  const review = await h.publisher.prepareBatchReview(h.batch.key);
  await assert.rejects(h.publisher.signBatchReviewed(h.batch.key, review, async () => {}));
  assert.equal((await h.cold().resumeBatch(h.batch.key)).status, 'SIGNATURE_REQUIRED');
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'broadcast').length, 0);
  await h.persistence.close();
});

test('unknown broadcast and partial relay failure resume exact signed bytes and skip completed members', async () => {
  const h = await batchRuntime(); h.controls.broadcastUnknown = true;
  const review = await signBatch(h);
  await assert.rejects(h.publisher.resumeBatch(h.batch.key), /response lost/);
  h.controls.uploadFailure = 'memory';
  await assert.rejects(h.cold().resumeBatch(h.batch.key), /relay unavailable/);
  assert.equal((await h.persistence.loadPublicationBinding(h.batch.key)).transaction.digest, review.digest);
  h.controls.uploadFailure = null;
  assert.equal((await h.cold().resumeBatch(h.batch.key)).status, 'SIGNATURE_REQUIRED');
  assert.equal(h.calls.filter(c => c[0] === 'upload' && c[1] === 'render').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'upload' && c[1] === 'soul').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'broadcast').length, 1);
  await h.persistence.close();
});

test('certified readback failure retries the same digest; failed final checkpoint rolls back all four member projections', async () => {
  const h = await batchRuntime(); await finalizeRegister(h); const review = await signBatch(h);
  await h.publisher.resumeBatch(h.batch.key);
  h.controls.readbackFailure = true;
  await assert.rejects(h.cold().resumeBatch(h.batch.key), { code: 'MAKER_V8_WALRUS_READBACK_UNAVAILABLE' });
  h.controls.readbackFailure = false;
  const before = await Promise.all([...h.inputs.keys()].map(id => h.persistence.load(id)));
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'publication-bindings' && args[0].status === 'COMPLETE') throw new Error('checkpoint disk full');
    return original.apply(this, args);
  };
  try { await assert.rejects(h.cold().resumeBatch(h.batch.key), /checkpoint disk full/); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await Promise.all([...h.inputs.keys()].map(id => h.persistence.load(id))), before);
  assert.equal((await h.cold().resumeBatch(h.batch.key)).status, 'COMPLETE');
  assert.equal((await h.persistence.loadPublicationBinding(h.batch.key)).transaction.digest, review.digest);
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 2);
  await h.persistence.close();
});

test('batch lock rejects a second tab before it can request another signature', async () => {
  const h = await batchRuntime(); const review = await h.publisher.prepareBatchReview(h.batch.key);
  let release; h.controls.signWait = new Promise(resolve => { release = resolve; });
  const flight = h.publisher.signBatchReviewed(h.batch.key, review, async () => {});
  while (!h.calls.some(c => c[0] === 'sign')) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.cold().signBatchReviewed(h.batch.key, review, async () => {}), { code: 'MAKER_V8_WALRUS_BATCH_BUSY' });
  release(); await flight;
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 1);
  await h.persistence.close();
});


test('batch persistence rejects stage skipping, signed-byte replacement, member certificate drift and terminal reopening', async () => {
  const h = await batchRuntime();
  const start = await h.persistence.loadPublicationBinding(h.batch.key);
  await assert.rejects(h.persistence.compareAndSwapBlobBatch(start, { ...start, revision: start.revision + 1,
    status: 'UPLOADED' }), { code: 'MAKER_V8_WALRUS_BATCH_INVALID' });
  await signBatch(h);
  const signed = await h.persistence.loadPublicationBinding(h.batch.key);
  const data = bcs.TransactionData.parse(fromBase64(signed.transaction.bytes)); data.V1.gasData.budget = '999999';
  const bytes = bcs.TransactionData.serialize(data).toBase64();
  await assert.rejects(h.persistence.compareAndSwapBlobBatch(signed, { ...signed, revision: signed.revision + 1,
    transaction: { ...signed.transaction, bytes } }));
  assert.deepEqual(await h.persistence.loadPublicationBinding(h.batch.key), signed);
  await h.publisher.resumeBatch(h.batch.key); await h.publisher.resumeBatch(h.batch.key);
  const uploaded = await h.persistence.loadPublicationBinding(h.batch.key);
  await assert.rejects(h.persistence.compareAndSwapBlobBatch(uploaded, { ...uploaded, revision: uploaded.revision + 1,
    uploads: { ...uploaded.uploads, render: { ...uploaded.uploads.render, blobObjectId: uploaded.uploads.soul.blobObjectId } } }),
    { code: 'MAKER_V8_WALRUS_BATCH_INVALID' });
  await signBatch(h); await h.publisher.resumeBatch(h.batch.key); await h.publisher.resumeBatch(h.batch.key);
  const done = await h.persistence.loadPublicationBinding(h.batch.key);
  await assert.rejects(h.persistence.compareAndSwapBlobBatch(done, { ...done, revision: done.revision + 1 }),
    { code: 'MAKER_V8_WALRUS_BATCH_INVALID' });
  await h.persistence.close();
});

test('claimed native Blobs cannot be repurposed as a Creator Quilt layout', async () => {
  const h = await batchRuntime();
  const source = await Promise.all([...h.inputs.keys()].map(async uploadId => {
    const record = await h.persistence.load(uploadId);
    return { assetId: uploadId, uploadId, mediaType: record.mediaType, sha256: record.byteSha256 };
  }));
  const { createHash } = await import('node:crypto');
  const schemaVersion = 'animacraft.maker-v8-asset-layout.v1';
  const sourceSha256 = createHash('sha256').update(JSON.stringify({ schemaVersion, owner: OWNER, source })).digest('hex');
  await assert.rejects(h.publisher.bindAssetLayout(`${schemaVersion}:${sourceSha256}`, { schemaVersion, owner: OWNER, sourceSha256, source }),
    { code: 'MAKER_V8_WALRUS_BATCH_REQUIRED' });
  assert.equal((await h.persistence.loadPublicationBinding(h.batch.key)).status, 'ENCODED');
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 0);
  await h.persistence.close();
});


test('another completion reuses a certified render while batching only three new native files', async () => {
  const h = await batchRuntime(); await finalizeRegister(h); await signBatch(h);
  await h.publisher.resumeBatch(h.batch.key); await h.publisher.resumeBatch(h.batch.key);
  const render = await h.persistence.load('render');
  const oldBatch = await h.persistence.loadPublicationBinding(h.batch.key);
  h.inputs.clear();
  const uploadIds = ['render'];
  for (const [i, kind] of ['soul', 'memory', 'skill'].entries()) {
    const uploadId = `${kind}-next`, bytes = new Uint8Array(1042 + i).fill(20 + i);
    h.inputs.set(uploadId, { uploadId, bytes, blobId: blobIdFromInt(BigInt(bytes.length)),
      objectId: `0x${(200 + i).toString(16).padStart(64, '0')}` });
    await h.publisher.prepare({ uploadId, owner: OWNER, mediaType: 'application/octet-stream', bytesBase64: toBase64(bytes) });
    uploadIds.push(uploadId);
  }
  h.batch = await h.publisher.prepareBatch({ owner: OWNER, rootId: PACKAGE, uploadIds });
  assert.deepEqual(h.batch.members.map(member => member.uploadId), uploadIds.slice(1));
  await finalizeRegister(h); await signBatch(h); await h.publisher.resumeBatch(h.batch.key);
  assert.equal((await h.cold().resumeBatch(h.batch.key)).status, 'COMPLETE');
  assert.deepEqual(await h.persistence.load('render'), render, 'Already-paid render is never re-signed, re-uploaded or re-projected.');
  assert.deepEqual(await h.persistence.loadPublicationBinding(oldBatch.key), oldBatch);
  assert.equal(h.calls.filter(c => c[0] === 'sign').length, 4, 'Two signatures per new storage batch.');
  assert.equal(h.calls.filter(c => c[0] === 'upload' && c[1] === 'render').length, 1);
  await h.persistence.close();
});
