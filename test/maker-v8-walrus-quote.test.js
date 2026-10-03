import assert from 'node:assert/strict';
import test from 'node:test';
import { WalrusClient, MAINNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { bcs } from '@mysten/sui/bcs';
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64, normalizeStructTag } from '@mysten/sui/utils';
import { makerV8WalrusTransactionQuote, createMakerV8WalrusPublisherV8 } from '../maker-v8-walrus.js';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';
import { makerV8PublicationExpiration } from '../maker-v8-publication-expiration.js';

// Synthetic prices/accounts exercise the actual pinned SDK builder, not live
// Mainnet prices or simulated acceptance. No network, wallet, or broadcasts.
const OWNER = `0x${'11'.repeat(32)}`, RELAY = `0x${'22'.repeat(32)}`;
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
