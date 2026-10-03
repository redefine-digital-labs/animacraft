import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { GrpcTypes, SuiGrpcClient } from '@mysten/sui/grpc';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { ObjectError } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { EncryptedObject } from '@mysten/seal';
import { fromBase64, fromHex, toBase64, toBase58, toHex, deriveDynamicFieldID } from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { nativeIntegrationFixture } from './fixtures/maker-v8-native-integration.js';
import { moveModuleIdentityBytesFixture } from './fixtures/walrus-execution-fixture.js';
import { MAKER_V8_RUNTIME_SCHEMA, MAKER_V8_PAYMENT_COIN_TYPE, MAKER_V8_CLOCK_OBJECT_ID } from '../maker-v8-runtime.js';
import { createMakerV8SuiGrpcTransport, MAKER_V8_SUI_MAINNET_GENESIS_DIGEST } from '../maker-v8-sui-grpc.js';
import { MakerV8DAppKitWalletError } from '../maker-v8-dapp-kit-wallet.js';
import { createMakerV8NativeEnvelopeOperationV8 } from '../maker-v8-native-envelope-operation.js';
import { contentEnvelopeKey, encodeContentEnvelope, decodeContentEnvelope, CONTENT_ENVELOPE_SCHEMA } from '../maker-v8-native-envelope-codec.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const hash = n => toBase58(new Uint8Array(32).fill(n));
const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(91));
const signer = keypair.toSuiAddress(); const rootId = id(200); const soulId = id(300); const stateId = id(301); const contentId = id(302);
const enc = new TextEncoder();
const runtime = () => ({ schemaVersion: MAKER_V8_RUNTIME_SCHEMA, protocolVersion: 8, enabled: true,
  catalogId: id(20), protocolConfigId: id(21), protocolTreasuryId: id(22), paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
  clockObjectId: MAKER_V8_CLOCK_OBJECT_ID, makerBindings: [],
  roles: Object.fromEntries(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'].map((role, index) => [role,
    { typeOriginPackageId: id(index * 2 + 1), callablePackageId: id(index * 2 + 1) }])),
  roleConfigIds: { seal: id(23), runtime: id(24), output: id(25), physical: id(26), market: id(27), release: id(28) } });
const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
const State = bcs.struct('State', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address, creator: bcs.Address,
  creator_royalty_bps: bcs.u16(), current_owner: bcs.Address, current_kiosk_id: bcs.Address, ownership_epoch: bcs.u64(),
  grant_capacity: bcs.u64(), active_grants: table, active_grant_ids: table, active_grant_count: bcs.u64(),
  content_id: bcs.option(bcs.Address), config_ext: table, collection_id: bcs.option(bcs.Address), access_list_id: bcs.option(bcs.Address), is_listed: bcs.bool() });
const Content = bcs.struct('Content', { id: bcs.Address, version: bcs.u64(), soul_id: bcs.Address, items: table, count_by_kind: table, active: table });
const Key = bcs.struct('Key', { kind: bcs.u32(), name: bcs.string() });
const Slot = bcs.struct('Slot', { version: bcs.u64(), kind: bcs.u32(), blob_object_id: bcs.Address, is_public: bcs.bool(),
  deleted: bcs.bool(), purged: bcs.bool(), download_policy: bcs.u8(), grant_scope_mask: bcs.u64(), read_mode_mask: bcs.u64(),
  op_mask: bcs.u64(), seal_encrypted: bcs.bool(), created_at_ms: bcs.u64() });
const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.string(), value: bcs.vector(bcs.u8()) });
function sidecar(slot, packageId) {
  const name = enc.encode(slot.name); const document = new Uint8Array(75 + name.length);
  document.set(enc.encode('soul-content:')); document[13] = 1; new DataView(document.buffer).setUint32(14, slot.kind, false);
  document.set(fromHex(slot.contentObjectId), 18); document.set(name, 50);
  new DataView(document.buffer).setBigUint64(51 + name.length, BigInt(slot.versionIndex), false);
  const documentId = `0x${toHex(document)}`;
  const encrypted = EncryptedObject.serialize({ version: 0, packageId, id: documentId, services: [[id(90), 1]], threshold: 1,
    encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96), encryptedShares: [new Uint8Array(32)], encryptedRandomness: new Uint8Array(32) } },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(16), aad: new Uint8Array() } } }).toBytes();
  return { version: 1, mode: 'seal-envelope', sealPackageId: packageId, documentId, encryptedDek: toBase64(encrypted),
    iv: toBase64(new Uint8Array(12)), cipher: 'AES-GCM-256', mimeType: 'text/markdown', fileName: 'soul.md', contentHash: 'ab'.repeat(32) };
}
function setup(options = {}) {
  const f = nativeIntegrationFixture(runtime()); const calls = []; const objects = new Map(); let saved = null; let finalized = null;
  const state = { owner: signer, primary: true, matched: false, account: signer, unknown: false, writeFail: null, ...options };
  const grpc = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io' });
  // No network: official Ledger response messages exercise the actual wrapper.
  grpc.ledgerService.getServiceInfo = async () => ({ response: GrpcTypes.GetServiceInfoResponse.create({
    chainId: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST, chain: 'mainnet', epoch: 100n,
    checkpointHeight: 100n, lowestAvailableCheckpoint: 0n, lowestAvailableCheckpointObjects: 0n,
  }) });
  const ledger = createMakerV8SuiGrpcTransport({ grpcClient: grpc, graphqlClient: { network: 'mainnet', query() { throw new Error('unexpected GraphQL'); } } });
  for (const [moduleName, datatypeName] of [['soul', 'SoulState'], ['content', 'SoulContent'], ['content', 'ContentKey'], ['content', 'ContentSlot']]) {
    f.objects.get(f.pin.soulidityCallablePackageId).data.bcs.typeOriginTable.push({ moduleName, datatypeName, packageId: f.pin.soulidityOriginalPackageId });
    f.objects.get(f.pin.soulidityCallablePackageId).data.bcs.moduleMap[moduleName] = toBase64(moveModuleIdentityBytesFixture(moduleName, f.pin.soulidityOriginalPackageId));
  }
  const slot = { contentObjectId: contentId, kind: 0, name: 'soul', versionIndex: '0', blobObjectId: id(400) };
  const input = { rootId, signer, action: { actionId: 'complete-1', action: 'completeOutput', status: 'FINALIZED_SUCCESS', transactionDigest: hash(19),
    certificate: { actionId: 'complete-1', status: 'CERTIFIED', transactionDigest: hash(19), evidence: {
      certifiedEvent: { fields: { root_id: rootId, original_holder: signer, soul_id: soulId, soul_state_id: stateId } },
      objects: [{ objectId: stateId, type: `${f.pin.soulidityOriginalPackageId}::soul::SoulState`, fields: { soulId, contentId } }],
    } } }, slots: [slot], contentSidecars: [{ kind: 0, name: 'soul', versionIndex: 0, sidecar: sidecar(slot, f.pin.soulidityOriginalPackageId) }] };
  const key = contentEnvelopeKey(slot);
  const value = encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...slot, sidecar: input.contentSidecars[0].sidecar }, f.pin.soulidityOriginalPackageId);
  const make = (objectId, type, codec, data, owner = { Shared: { initial_shared_version: '2' } }) => ({ data: {
    objectId, type, version: '3', digest: hash(7), owner, bcs: { dataType: 'moveObject', type, bcsBytes: toBase64(codec.serialize(data).toBytes()) },
  } });
  const stateValue = () => ({ id: stateId, version: '1', soul_id: soulId, creator: signer, creator_royalty_bps: 0, current_owner: state.owner,
    current_kiosk_id: id(303), ownership_epoch: '0', grant_capacity: '1', active_grants: { id: id(500), size: '0' },
    active_grant_ids: { id: id(501), size: '0' }, active_grant_count: '0', content_id: contentId, config_ext: { id: id(502), size: state.matched ? '1' : '0' },
    collection_id: null, access_list_id: null, is_listed: false });
  const contentValue = { id: contentId, version: '1', soul_id: soulId, items: { id: id(503), size: '1' }, count_by_kind: { id: id(504), size: '1' }, active: { id: id(505), size: '0' } };
  objects.set(contentId, make(contentId, `${f.pin.soulidityOriginalPackageId}::content::SoulContent`, Content, contentValue));
  const fieldId = deriveDynamicFieldID(id(503), `${f.pin.soulidityOriginalPackageId}::content::ContentKey`, Key.serialize({ kind: 0, name: 'soul' }).toBytes());
  objects.set(fieldId, make(fieldId, `0x2::dynamic_field::Field<${f.pin.soulidityOriginalPackageId}::content::ContentKey,vector<${f.pin.soulidityOriginalPackageId}::content::ContentSlot>>`,
    bcs.struct('Field', { id: bcs.Address, name: Key, value: bcs.vector(Slot) }), { id: fieldId, name: { kind: 0, name: 'soul' },
      value: [{ version: '1', kind: 0, blob_object_id: slot.blobObjectId, is_public: true, deleted: false, purged: false,
        download_policy: 0, grant_scope_mask: '1', read_mode_mask: '3', op_mask: '15', seal_encrypted: true, created_at_ms: '1' }] }, { ObjectOwner: id(503) }));
  const extId = deriveDynamicFieldID(id(502), '0x1::string::String', bcs.string().serialize(key).toBytes());
  objects.set(id(600), make(id(600), '0x2::coin::Coin<0x2::sui::SUI>', bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() }), { id: id(600), balance: '999999999' }, { AddressOwner: signer }));
  const client = { ...f.rpc,
    async getObject(input) {
      let value;
      if (input.id === stateId) value = make(stateId, `${f.pin.soulidityOriginalPackageId}::soul::SoulState`, State, stateValue());
      else if (input.id === extId) {
        if (!state.matched) throw new ObjectError('notExists', 'absent', { reason: 'notFound', objectId: extId });
        value = make(extId, '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>', Field,
          { id: extId, name: key, value: [...enc.encode(state.conflict ? 'wrong' : valueText)] }, { ObjectOwner: id(502) });
      } else if (objects.has(input.id)) value = structuredClone(objects.get(input.id));
      else value = structuredClone(await f.rpc.getObject(input));
      if (input.id === id(600)) {
        value.data.version = state.gasVersion ?? '3'; value.data.digest = state.gasDigest ?? hash(7);
        value.data.bcs.bcsBytes = toBase64(bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
          .serialize({ id: id(600), balance: state.gasBalance ?? '999999999' }).toBytes());
      }
      if (input.id === f.pin.marketConfigV2Id && !state.primary) { const raw = fromBase64(value.data.bcs.bcsBytes); raw[raw.length - 2] = 0; value.data.bcs.bcsBytes = toBase64(raw); }
      options.mutateRead?.(input.id, value); return value;
    },
    core: { async getReferenceGasPrice() { return { referenceGasPrice: state.gasPrice ?? '100' }; } },
    async getLatestSuiSystemState() { return { epoch: state.epoch ?? '100' }; },
    async getCoins() { calls.push('gas'); return { data: [{ coinObjectId: id(600), version: state.gasVersion ?? '3',
      digest: state.gasDigest ?? hash(7), balance: state.gasBalance ?? '999999999' }] }; },
    async simulateTransaction({ transaction, checksEnabled }) {
      calls.push('simulate'); assert.equal(checksEnabled, true);
      const digest = TransactionDataBuilder.getDigestFromBytes(transaction);
      grpc.simulateTransaction = async input => ({ $kind: state.simulationFailed ? 'FailedTransaction' : 'Transaction',
        [state.simulationFailed ? 'FailedTransaction' : 'Transaction']: { digest, epoch: '100', bcs: input.transaction,
          status: { success: !state.simulationFailed }, effects: { transactionDigest: digest, status: { success: !state.simulationFailed } } } });
      return ledger.simulateTransaction({ transaction, checksEnabled });
    },
    async executeTransaction({ transaction, signatures }) {
      calls.push('broadcast'); assert.equal(saved.status, 'SIGNED'); assert.equal(saved.bytes, toBase64(transaction)); assert.equal(saved.signature, signatures[0]);
      if (state.unknown) throw new Error('timeout');
      finalized = { transaction, signatures, failed: state.executionFailed === true }; state.matched = !finalized.failed;
      state.gasVersion = String(BigInt(state.gasVersion ?? '3') + 1n); state.gasDigest = hash(Number(state.gasVersion));
      state.gasBalance = String(BigInt(state.gasBalance ?? '999999999') - 10n);
    },
    async getFinalizedTransactionEvidence({ digest }) {
      calls.push(`query:${digest}`);
      if (!finalized) {
        if (!state.notFound) throw new Error('unavailable');
        grpc.ledgerService.getTransaction = async request => {
          assert.equal(request.digest, digest); const error = new RpcError('not found', 'NOT_FOUND');
          error.serviceName = 'sui.rpc.v2.LedgerService'; error.methodName = 'GetTransaction'; throw error;
        };
        return ledger.getFinalizedTransactionEvidence({ digest });
      }
      const effects = bcs.TransactionEffects.serialize({ V2: { status: finalized.failed
        ? { Failure: { error: { InsufficientGas: true }, command: null } } : { Success: true }, executedEpoch: '100',
        gasUsed: { computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0' },
        transactionDigest: digest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '5',
        changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes();
      const raw = GrpcTypes.ExecutedTransaction.create({ digest, checkpoint: 10n,
        transaction: { digest, bcs: { name: 'TransactionData', value: finalized.transaction } },
        signatures: finalized.signatures.map(s => ({ bcs: { name: 'UserSignatureBytes', value: fromBase64(s) } })),
        effects: { bcs: { name: 'TransactionEffects', value: effects }, digest: toBase58(blake2b(new Uint8Array([...enc.encode('TransactionEffects::'), ...effects]), { dkLen: 32 })),
          version: 2, status: finalized.failed ? { success: false, error: { description: 'Insufficient gas' } } : { success: true }, epoch: 100n, transactionDigest: digest } });
      options.mutateFinality?.(raw);
      grpc.ledgerService.getTransaction = async request => { assert.equal(request.digest, digest);
        return { response: GrpcTypes.GetTransactionResponse.create({ transaction: raw }) }; };
      return ledger.getFinalizedTransactionEvidence({ digest });
    },
  };
  const valueText = value;
  const wallet = { async getCurrentAccount() { return { address: state.account, network: 'mainnet' }; },
    async signExactTransaction(input) { calls.push('sign'); assert.equal(saved.status, 'SIGNING'); assert.equal(saved.bytes, input.bytes);
      if (state.signError) throw state.signError;
      if (state.signPromise) return state.signPromise(input);
      const result = await keypair.signTransaction(fromBase64(input.bytes)); options.afterSign?.(state);
      return { ...input, signature: result.signature }; },
    async verifyExactSignature(input) { return await keypair.getPublicKey().verifyTransaction(fromBase64(input.bytes), input.signature)
      ? { verified: true, bytes: input.bytes, digest: input.digest, signer: input.signer } : false; },
  };
  const callbacks = { async assertBeforeSignature(step) { calls.push('confirm'); assert.equal(step.kind, 'NATIVE_ENVELOPES');
    assert.equal(step.transactionDigest, saved.digest); options.confirm?.(state); },
    async load() { return structuredClone(saved); }, async write(record) {
    calls.push(`save:${record.status}`); if (state.writeFail === record.status) throw new Error('storage failed');
    saved = structuredClone(record); return structuredClone(saved);
  } };
  const createOperation = () => createMakerV8NativeEnvelopeOperationV8({ runtime: f.config, client, wallet,
    locks: { request: async (_key, task) => task() }, execution: { allowWalletSignature: true, allowBroadcast: true }, ...options.factory });
  const operation = createOperation();
  return { ...f, input, slot, key, value, calls, state, client, wallet, objects, extId, fieldId,
    make, contentValue, operation, createOperation,
    callbacks, run: mode => operation.persist(input, { ...callbacks, mode }), get saved() { return saved; },
    set saved(value) { saved = value; }, finalizeUnknown() { finalized = { transaction: fromBase64(saved.bytes), signatures: [saved.signature] }; state.matched = true; } };
}

test('actual runtime attestation, full chain BCS, exact real signed bytes, raw effects and readback complete', async () => {
  const f = setup(); const result = await f.run('resume');
  if (result.status !== 'COMPLETE') await f.client.getFinalizedTransactionEvidence({ digest: f.saved.digest });
  assert.deepEqual(result, { status: 'COMPLETE' });
  assert.deepEqual(f.calls.slice(0, 8), ['gas', 'save:PREPARED', 'simulate', 'confirm', 'save:SIGNING', 'sign', 'save:SIGNED', 'broadcast']);
  const data = Transaction.from(fromBase64(f.saved.bytes)).getData();
  assert.equal(data.commands.length, 1); assert.equal(data.commands[0].MoveCall.function, 'set_state_config_v2');
  assert.equal(data.commands[0].MoveCall.package, f.pin.soulidityCallablePackageId);
  assert.equal(data.gasData.owner, signer); assert.equal(data.gasData.budget, '50000000');
  assert.equal(f.saved.status, 'FINALIZED_SUCCESS');
});
test('canonical encrypted wire roundtrip rejects secret keys, wrong namespaces and changed tuple', () => {
  const f = setup(); const decoded = decodeContentEnvelope(f.value, f.slot, f.pin.soulidityOriginalPackageId);
  assert.equal(encodeContentEnvelope(decoded, f.pin.soulidityOriginalPackageId), f.value);
  for (const edit of [v => { v.sidecar.dek = 'private'; }, v => { v.sidecar.sealPackageId = id(77); },
    v => { v.name = 'other'; }, v => { v.versionIndex = '1'; }, v => { v.sidecar.encryptedDek = 'CQgH'; }]) {
    const value = structuredClone(decoded); edit(value); assert.throws(() => encodeContentEnvelope(value, f.pin.soulidityOriginalPackageId));
  }
});
test('already exact on-chain values are read-only without storage, wallet, gas or signing', async () => {
  const f = setup({ matched: true, account: id(999), primary: false });
  assert.deepEqual(await f.run('resume'), { status: 'COMPLETE' }); assert.deepEqual(f.calls, []);
});
for (const [name, state, reason] of [['query', {}, 'SIGNATURE_REQUIRED'], ['owner', { owner: id(9) }, 'CURRENT_OWNER_CHANGED'],
  ['pause', { primary: false }, 'PRIMARY_PAUSED'], ['gate', { factory: { execution: {} } }, 'EXECUTION_DISABLED']]) {
  test(`${name} remains pending without signing`, async () => {
    const f = setup(state); assert.equal((await f.run(name === 'query' ? 'query' : 'resume')).reason, reason); assert.deepEqual(f.calls, []);
  });
}
test('unknown outcome queries the exact signed digest; no gas, signing, or new mint even if chain values match', async () => {
  const f = setup({ unknown: true }); assert.equal((await f.run('resume')).reason, 'OUTCOME_UNKNOWN'); const saved = structuredClone(f.saved);
  f.calls.length = 0; f.state.matched = true; assert.equal((await f.run('resume')).reason, 'OUTCOME_UNKNOWN');
  assert.deepEqual(f.calls, [`query:${saved.digest}`]); assert.deepEqual(f.saved, saved);
  f.finalizeUnknown(); f.calls.length = 0; assert.equal((await f.run('query')).status, 'COMPLETE');
  assert.equal(f.calls[0], `query:${saved.digest}`); assert.equal(f.calls.includes('sign'), false);
});
test('prepared persistence failure prevents signature; signed persistence failure exports exact verified recovery', async () => {
  const before = setup({ writeFail: 'PREPARED' }); await assert.rejects(before.run('resume')); assert.equal(before.calls.includes('sign'), false);
  const after = setup({ writeFail: 'SIGNED' }); await assert.rejects(after.run('resume'), error => error.recoveryRecord?.status === 'SIGNED');
  assert.equal(after.calls.includes('broadcast'), false);
});
test('wallet switch after signature preserves it and refuses broadcast', async () => {
  const f = setup({ afterSign: state => { state.account = id(8); } }); await assert.rejects(f.run('resume'), /WALLET_CHANGED/);
  assert.equal(f.saved.status, 'SIGNED'); assert.equal(f.calls.includes('broadcast'), false);
});
for (const [name, mutateRead] of [
  ['state parent', (objectId, row) => { if (objectId === stateId) row.data.owner = { ObjectOwner: soulId }; }],
  ['content type', (objectId, row) => { if (objectId === contentId) row.data.type = `${id(8)}::content::SoulContent`; }],
  ['BCS suffix', (objectId, row) => { if (objectId === stateId) row.data.bcs.bcsBytes = toBase64(new Uint8Array([...fromBase64(row.data.bcs.bcsBytes), 1])); }],
]) test(`${name} fails before signing`, async () => { const f = setup({ mutateRead }); await assert.rejects(f.run('resume')); assert.equal(f.calls.includes('sign'), false); });
test('conflicting envelope is not overwritten', async () => { const f = setup({ matched: true, conflict: true }); await assert.rejects(f.run('resume'), /ENVELOPE_VALUE_CONFLICT/); assert.deepEqual(f.calls, []); });

test('missing explicit confirmation keeps exact prepared bytes without signing', async () => {
  const f = setup(); delete f.callbacks.assertBeforeSignature;
  assert.equal((await f.run('resume')).reason, 'SIGNATURE_CONFIRMATION_REQUIRED');
  assert.equal(f.saved.status, 'PREPARED'); assert.equal(f.calls.includes('sign'), false);
});
for (const [name, edit, reason] of [
  ['owner', state => { state.owner = id(9); }, 'CURRENT_OWNER_CHANGED'],
  ['primary', state => { state.primary = false; }, 'PRIMARY_PAUSED'],
]) test(`${name} changes during confirmation refuse the signature`, async () => {
  const f = setup({ confirm: edit }); assert.equal((await f.run('resume')).reason, reason);
  assert.equal(f.saved.status, 'PREPARED'); assert.equal(f.calls.includes('sign'), false);
});
for (const [name, edit, reason] of [
  ['owner', state => { state.owner = id(9); }, 'CURRENT_OWNER_CHANGED'],
  ['primary', state => { state.primary = false; }, 'PRIMARY_PAUSED'],
]) test(`${name} changes during wallet prompt preserve signature and refuse broadcast`, async () => {
  const f = setup({ afterSign: edit }); assert.equal((await f.run('resume')).reason, reason);
  assert.equal(f.saved.status, 'SIGNED'); assert.equal(f.calls.includes('broadcast'), false);
});
test('unknown signing is query-only even with authoritative NOT_FOUND', async () => {
  const f = setup({ signError: new Error('wallet disconnected'), notFound: true });
  assert.equal((await f.run('resume')).reason, 'SIGNATURE_OUTCOME_UNKNOWN'); assert.equal(f.saved.status, 'SIGNING');
  const prior = structuredClone(f.saved); f.calls.length = 0; f.state.signError = null;
  assert.equal((await f.run('resume')).reason, 'SIGNATURE_OUTCOME_UNKNOWN');
  assert.deepEqual(f.saved, prior); assert.deepEqual(f.calls, [`query:${prior.digest}`]);
});
test('unknown signing can recover its exact on-chain signature and finality without signing again', async () => {
  const f = setup({ signError: new Error('wallet disconnected') }); await f.run('resume');
  const signature = (await keypair.signTransaction(fromBase64(f.saved.bytes))).signature;
  f.finalizeUnknown();
  // The local SIGNING record has no signature; the Ledger discovers it.
  const original = f.client.getFinalizedTransactionEvidence;
  f.client.getFinalizedTransactionEvidence = async request => {
    const local = f.saved; f.saved = { ...local, signature }; f.finalizeUnknown(); f.saved = local;
    return original(request);
  };
  f.calls.length = 0; assert.equal((await f.run('query')).status, 'COMPLETE');
  assert.equal(f.saved.signature, signature); assert.equal(f.calls.includes('sign'), false);
});
test('exact definitive Wallet Standard rejection allows only the original bytes on explicit resume', async () => {
  const rejected = new MakerV8DAppKitWalletError('MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED', 'Rejected', 'SIGNING');
  rejected.definitiveRejection = true; rejected.signedArtifactCreated = false;
  const f = setup({ signError: rejected }); assert.equal((await f.run('resume')).reason, 'SIGNATURE_REJECTED');
  const original = f.saved.bytes; assert.equal(f.saved.status, 'PREPARED'); f.state.signError = null;
  assert.equal((await f.run('resume')).status, 'COMPLETE'); assert.equal(f.saved.bytes, original);
  assert.equal(f.calls.filter(call => call === 'gas').length, 1);
});
test('lookalike rejection metadata cannot authorize another signature', async () => {
  const f = setup({ signError: Object.assign(new Error('not authoritative'), {
    code: 'MAKER_V8_DAPP_KIT_WALLET_REQUEST_REJECTED', definitiveRejection: true, signedArtifactCreated: false,
  }) }); assert.equal((await f.run('resume')).reason, 'SIGNATURE_OUTCOME_UNKNOWN'); assert.equal(f.saved.status, 'SIGNING');
});
test('authoritative NOT_FOUND permits only exact same signed rebroadcast; query never broadcasts', async () => {
  const f = setup({ unknown: true, notFound: true }); await f.run('resume'); const original = structuredClone(f.saved);
  f.calls.length = 0; assert.equal((await f.run('query')).reason, 'OUTCOME_PENDING'); assert.deepEqual(f.calls, [`query:${original.digest}`]);
  f.state.unknown = false; f.calls.length = 0; assert.equal((await f.run('resume')).status, 'COMPLETE');
  assert.equal(f.calls[0], `query:${original.digest}`); assert.equal(f.calls.includes('sign'), false); assert.equal(f.calls.includes('gas'), false);
  assert.equal(f.saved.bytes, original.bytes); assert.equal(f.saved.signature, original.signature);
});
test('signed but not found cannot report complete merely because matching values are visible', async () => {
  const f = setup({ unknown: true, notFound: true }); await f.run('resume'); f.state.matched = true; f.calls.length = 0;
  assert.equal((await f.run('resume')).reason, 'OUTCOME_PENDING'); assert.equal(f.calls.length, 1);
});
test('late signature after deadline never causes a write or broadcast; unknown remains recoverable', async () => {
  let resolve; let input;
  const f = setup({ factory: { timeoutMs: 100 }, signPromise: value => { input = value; return new Promise(done => { resolve = done; }); } });
  assert.equal((await f.run('resume')).reason, 'SIGNATURE_OUTCOME_UNKNOWN'); const calls = [...f.calls];
  resolve({ ...input, signature: (await keypair.signTransaction(fromBase64(input.bytes))).signature });
  await new Promise(done => setTimeout(done, 10)); assert.deepEqual(f.calls, calls); assert.equal(f.saved.status, 'SIGNING');
});
for (const [name, edit] of [
  ['sender', data => { data.sender = id(999); }],
  ['gas owner', data => { data.gasData.owner = id(999); }],
  ['gas budget', data => { data.gasData.budget = '50000001'; }],
  ['gas payment', data => { data.gasData.payment.push({ ...data.gasData.payment[0], objectId: id(999) }); }],
  ['command target', data => { data.commands[0].MoveCall.package = id(999); }],
  ['command name', data => { data.commands[0].MoveCall.function = 'delete_state_config_v2'; }],
  ['extra command', data => { data.commands.push(structuredClone(data.commands[0])); }],
  ['command argument', data => { data.commands[0].MoveCall.arguments.reverse(); }],
  ['value bytes', data => { data.inputs[3].Pure.bytes = toBase64(bcs.vector(bcs.u8()).serialize([...enc.encode('wrong')]).toBytes()); }],
  ['none expiration', data => { data.expiration = { None: true, $kind: 'None' }; }],
]) test(`tampered prepared ${name} cannot reach confirmation or signature`, async () => {
  const f = setup(); const confirm = f.callbacks.assertBeforeSignature; delete f.callbacks.assertBeforeSignature; await f.run('resume');
  const data = Transaction.from(fromBase64(f.saved.bytes)).getData(); edit(data);
  const changed = TransactionDataBuilder.restore(data).build(); f.saved = { ...f.saved, bytes: toBase64(changed), digest: TransactionDataBuilder.getDigestFromBytes(changed) };
  f.callbacks.assertBeforeSignature = confirm; f.calls.length = 0; await assert.rejects(f.run('resume'));
  assert.equal(f.calls.includes('confirm'), false); assert.equal(f.calls.includes('sign'), false);
});
test('coordinated forged shared birth in journal and bytes is checked against fresh chain authority', async () => {
  const f = setup(); const confirm = f.callbacks.assertBeforeSignature; delete f.callbacks.assertBeforeSignature; await f.run('resume');
  const data = Transaction.from(fromBase64(f.saved.bytes)).getData(); data.inputs[1].Object.SharedObject.initialSharedVersion = '99';
  const changed = TransactionDataBuilder.restore(data).build(); f.saved.snapshot.state.data.owner.Shared.initial_shared_version = '99';
  f.saved = { ...f.saved, bytes: toBase64(changed), digest: TransactionDataBuilder.getDigestFromBytes(changed) };
  f.callbacks.assertBeforeSignature = confirm; f.calls.length = 0; await assert.rejects(f.run('resume'), /SHARED_BIRTH_DRIFT/);
  assert.equal(f.calls.includes('sign'), false);
});
test('prepared expiration is query-only and never replaces already persisted bytes', async () => {
  const f = setup(); delete f.callbacks.assertBeforeSignature; await f.run('resume'); const prior = structuredClone(f.saved);
  f.state.epoch = '102'; assert.equal((await f.run('resume')).reason, 'EXPIRED_QUERY_ONLY'); assert.deepEqual(f.saved, prior);
});
test('mutating public arguments during storage load cannot change the signed content or namespace', async () => {
  const f = setup(); const load = f.callbacks.load; let first = true;
  f.callbacks.load = async () => { if (first) { first = false; f.input.slots[0].name = 'changed'; f.input.contentSidecars[0].sidecar.sealPackageId = id(8); } return load(); };
  assert.equal((await f.run('resume')).status, 'COMPLETE'); assert.equal(f.saved.intent.entries[0].slot.name, 'soul');
});
test('false persistence readback is never accepted before signing', async () => {
  const f = setup(); const write = f.callbacks.write; f.callbacks.write = async record => ({ ...(await write(record)), digest: hash(88) });
  await assert.rejects(f.run('resume'), /PERSISTENCE_FAILED/); assert.equal(f.calls.includes('sign'), false);
});
test('tampered raw effects never become finalized success', async () => {
  const f = setup({ mutateFinality: raw => { raw.effects.bcs.value[1] ^= 1; } });
  assert.equal((await f.run('resume')).reason, 'OUTCOME_UNKNOWN'); assert.equal(f.saved.status, 'SIGNED');
});
test('failed exact simulation cannot open confirmation or request signature', async () => {
  const f = setup({ simulationFailed: true }); assert.equal((await f.run('resume')).reason, 'SIMULATION_FAILED');
  assert.equal(f.calls.includes('confirm'), false); assert.equal(f.calls.includes('sign'), false); assert.equal(f.saved.status, 'PREPARED');
});
test('simulation returning changed transaction bytes fails closed before confirmation', async () => {
  const f = setup(); const original = f.client.simulateTransaction;
  f.client.simulateTransaction = async input => { const result = await original(input);
    return { ...result, Transaction: { ...result.Transaction, bcs: new Uint8Array([1]) } }; };
  await assert.rejects(f.run('resume'), /SIMULATION_DRIFT/); assert.equal(f.calls.includes('confirm'), false);
});
for (const alreadyMatched of [0, 1, 2]) test(`three-file completion writes only ${3 - alreadyMatched} missing exact envelopes in one transaction`, async () => {
  const f = setup({ matched: alreadyMatched > 0 }); const extras = new Map(); let published = false;
  for (const [kind, name] of [[1, 'default'], [2, 'nova']]) {
    const slot = { contentObjectId: contentId, kind, name, versionIndex: '0', blobObjectId: id(400 + kind) };
    const s = sidecar(slot, f.pin.soulidityOriginalPackageId); f.input.slots.push(slot);
    f.input.contentSidecars.push({ kind, name, versionIndex: 0, sidecar: s });
    const key = { kind, name }; const fieldId = deriveDynamicFieldID(id(503), `${f.pin.soulidityOriginalPackageId}::content::ContentKey`, Key.serialize(key).toBytes());
    const codec = bcs.struct('Field', { id: bcs.Address, name: Key, value: bcs.vector(Slot) });
    const base = codec.parse(fromBase64(f.objects.get(f.fieldId).data.bcs.bcsBytes));
    base.id = fieldId; base.name = key; base.value[0].kind = kind; base.value[0].blob_object_id = slot.blobObjectId;
    f.objects.set(fieldId, f.make(fieldId, f.objects.get(f.fieldId).data.type, codec, base, { ObjectOwner: id(503) }));
    const envelopeKey = contentEnvelopeKey(slot); const extId = deriveDynamicFieldID(id(502), '0x1::string::String', bcs.string().serialize(envelopeKey).toBytes());
    extras.set(extId, f.make(extId, '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>', Field, {
      id: extId, name: envelopeKey, value: [...enc.encode(encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...slot, sidecar: s }, f.pin.soulidityOriginalPackageId))],
    }, { ObjectOwner: id(502) }));
  }
  const before = f.client.getObject; f.client.getObject = async request => {
    if (extras.has(request.id)) {
      const index = [...extras.keys()].indexOf(request.id);
      if (!published && index >= alreadyMatched - 1) throw new ObjectError('notExists', 'absent', { reason: 'notFound', objectId: request.id });
      return structuredClone(extras.get(request.id));
    }
    return before(request);
  };
  const execute = f.client.executeTransaction; f.client.executeTransaction = async request => { await execute(request); published = true; };
  assert.equal((await f.run('resume')).status, 'COMPLETE');
  const tx = Transaction.from(fromBase64(f.saved.bytes)).getData(); assert.equal(tx.commands.length, 3 - alreadyMatched);
  assert.equal(new Set(f.saved.keys).size, 3 - alreadyMatched); assert.equal(f.calls.filter(call => call === 'sign').length, 1);
});

for (const [label, change] of [['expired', state => { state.epoch = '102'; }], ['gas-price', state => { state.gasPrice = '101'; }]]) {
  test(`explicit reprepare archives only the never-signed ${label} bytes before new confirmation`, async () => {
    const f = setup(); const confirm = f.callbacks.assertBeforeSignature; delete f.callbacks.assertBeforeSignature; await f.run('resume');
    const original = structuredClone(f.saved); change(f.state); f.callbacks.reprepare = true;
    f.callbacks.assertBeforeSignature = async step => { assert.equal(f.saved.history.length, 1);
      assert.equal(f.saved.history[0].bytes, original.bytes); assert.equal(f.saved.history[0].signature, null); await confirm(step); };
    assert.equal((await f.run('resume')).status, 'COMPLETE'); assert.notEqual(f.saved.digest, original.digest);
    assert.equal(f.saved.history[0].status, 'PREPARED'); assert.equal(f.saved.history[0].finality, null);
  });
}
test('query ignores reprepare and preserves an expired never-signed preparation', async () => {
  const f = setup(); delete f.callbacks.assertBeforeSignature; await f.run('resume'); const original = structuredClone(f.saved);
  f.state.epoch = '102'; f.callbacks.reprepare = true; f.calls.length = 0;
  assert.equal((await f.run('query')).reason, 'OUTCOME_PENDING'); assert.deepEqual(f.saved, original); assert.deepEqual(f.calls, []);
});
test('gas-price change during new preparation is pending; reprepare never loops within one invocation', async () => {
  const f = setup({ confirm: state => { state.gasPrice = '101'; } }); f.callbacks.reprepare = true;
  assert.equal((await f.run('resume')).reason, 'GAS_PRICE_CHANGED'); assert.equal(f.saved.history.length, 0);
  assert.equal(f.calls.filter(call => call === 'gas').length, 1); assert.equal(f.calls.includes('sign'), false);
});
test('definitively failed transaction keeps raw failure proof and requires explicit reprepare for replacement', async () => {
  const f = setup({ executionFailed: true }); assert.equal((await f.run('resume')).reason, 'TRANSACTION_FAILED');
  const old = structuredClone(f.saved); assert.equal(old.status, 'FINALIZED_FAILURE'); assert.equal(old.finality.success, false);
  f.calls.length = 0; assert.equal((await f.run('resume')).reason, 'TRANSACTION_FAILED');
  assert.equal(f.calls.includes('gas'), false); assert.equal(f.calls.includes('sign'), false);
  f.state.executionFailed = false; f.callbacks.reprepare = true; f.calls.length = 0;
  assert.equal((await f.run('resume')).status, 'COMPLETE'); assert.equal(f.calls[0], `query:${old.digest}`);
  assert.notEqual(f.saved.digest, old.digest); assert.equal(f.saved.history.length, 1);
  assert.equal(f.saved.history[0].bytes, old.bytes); assert.equal(f.saved.history[0].signature, old.signature);
  assert.deepEqual(f.saved.history[0].finality, old.finality);
  f.calls.length = 0; assert.equal((await f.run('query')).status, 'COMPLETE'); assert.equal(f.calls.includes('sign'), false);
});
test('query cannot replace a proven failed transaction even with reprepare=true', async () => {
  const f = setup({ executionFailed: true }); await f.run('resume'); const old = structuredClone(f.saved);
  f.callbacks.reprepare = true; f.calls.length = 0;
  assert.equal((await f.run('query')).reason, 'TRANSACTION_FAILED'); assert.deepEqual(f.saved, old); assert.equal(f.calls.includes('gas'), false);
});
for (const signing of [false, true]) test(`reprepare cannot replace ${signing ? 'SIGNING' : 'SIGNED'} unknown at expired epoch`, async () => {
  const f = setup({ unknown: true, notFound: true, ...(signing ? { signError: new Error('unknown sign') } : {}) });
  await f.run('resume'); const old = structuredClone(f.saved); f.state.epoch = '102'; f.callbacks.reprepare = true; f.calls.length = 0;
  assert.equal((await f.run('resume')).reason, signing ? 'SIGNATURE_OUTCOME_UNKNOWN' : 'EXPIRED_QUERY_ONLY');
  assert.deepEqual(f.saved, old); assert.equal(f.calls.includes('gas'), false); assert.equal(f.calls.includes('sign'), false);
});
test('failed replacement persistence preserves prior failed signature and proof without requesting another signature', async () => {
  const f = setup({ executionFailed: true }); await f.run('resume'); const old = structuredClone(f.saved);
  f.state.writeFail = 'PREPARED'; f.callbacks.reprepare = true; f.calls.length = 0;
  await assert.rejects(f.run('resume'), /storage failed/); assert.deepEqual(f.saved, old); assert.equal(f.calls.includes('sign'), false);
});
test('archived failure-proof tampering is rejected on cold recovery', async () => {
  const f = setup({ executionFailed: true }); await f.run('resume'); f.state.executionFailed = false; f.callbacks.reprepare = true; await f.run('resume');
  const altered = fromBase64(f.saved.history[0].finality.effectsBcsBase64); altered[1] ^= 1;
  f.saved.history[0].finality.effectsBcsBase64 = toBase64(altered); f.calls.length = 0;
  await assert.rejects(f.run('query')); assert.equal(f.calls.includes('sign'), false);
});
test('signature verifier must bind its affirmative result to the exact bytes, digest and signer', async () => {
  const f = setup(); f.wallet.verifyExactSignature = async () => ({ verified: true });
  await assert.rejects(f.run('resume'), /SIGNATURE_DRIFT/); assert.equal(f.calls.includes('broadcast'), false);
});
const recoveryScope = { rootId, signer, actionId: 'complete-1' };
async function failedSave() {
  const f = setup({ writeFail: 'SIGNED', notFound: true }); let error;
  try { await f.run('resume'); } catch (caught) { error = caught; }
  assert.equal(f.saved.status, 'SIGNING'); assert.equal(error.recoveryRecord.status, 'SIGNED');
  assert.equal(error.recoveryJson, f.operation.exportRecovery(recoveryScope));
  return { f, json: error.recoveryJson };
}
test('same-page rescue survives error strings and retries durable exact signature before digest query', async () => {
  const { f, json } = await failedSave(); const saved = JSON.parse(json);
  assert.equal(saved.schema, 'animacraft.native-envelope-operation.v1');
  assert.equal(json.includes('"material"'), false); assert.equal(json.includes('"project"'), false); assert.equal(json.includes('"dek"'), false);
  f.state.writeFail = null; f.calls.length = 0; assert.equal((await f.run('query')).reason, 'OUTCOME_PENDING');
  assert.deepEqual(f.calls, ['save:SIGNED', `query:${saved.digest}`]); assert.equal(f.saved.signature, saved.signature);
  assert.equal(f.operation.exportRecovery(recoveryScope), null);
});
test('failed rescue persistence never clears or weakens the verified in-memory signature', async () => {
  const { f, json } = await failedSave(); f.calls.length = 0;
  await assert.rejects(f.run('query'), error => error.recoveryJson === json);
  assert.equal(f.operation.exportRecovery(recoveryScope), json); assert.deepEqual(f.calls, ['save:SIGNED']);
});
test('cold explicit import validates and persists same-digest signature; query never signs or broadcasts', async () => {
  const { f, json } = await failedSave(); f.state.writeFail = null; f.calls.length = 0;
  const fresh = f.createOperation(); assert.equal(fresh.exportRecovery(recoveryScope), null);
  const result = await fresh.persist(f.input, { ...f.callbacks, mode: 'query', recoveryJson: json });
  assert.equal(result.reason, 'OUTCOME_PENDING'); assert.equal(f.saved.status, 'SIGNED');
  assert.deepEqual(f.calls, ['save:SIGNED', `query:${f.saved.digest}`]); assert.equal(fresh.exportRecovery(recoveryScope), null);
});
test('finalized persistence failure retains stronger proof and same-page retry does not broadcast twice', async () => {
  const f = setup({ writeFail: 'FINALIZED_SUCCESS' }); let json;
  await assert.rejects(f.run('resume'), error => { json = error.recoveryJson; return JSON.parse(json).status === 'FINALIZED_SUCCESS'; });
  assert.equal(f.saved.status, 'SIGNED'); assert.equal(f.operation.exportRecovery(recoveryScope), json);
  f.state.writeFail = null; f.calls.length = 0; assert.equal((await f.run('query')).status, 'COMPLETE');
  assert.equal(f.calls[0], 'save:FINALIZED_SUCCESS'); assert.equal(f.calls.includes('broadcast'), false);
  assert.equal(f.operation.exportRecovery(recoveryScope), null);
});
for (const [name, edit] of [
  ['secret property', record => { record.dek = 'PRIVATE'; }],
  ['snapshot property', record => { record.snapshot.state.data.dek = 'PRIVATE'; }],
  ['intent', record => { record.intent.rootId = id(999); }],
  ['signature', record => { record.signature = toBase64(new Uint8Array(97)); }],
  ['weaker state', record => { record.status = 'SIGNING'; record.signature = null; }],
]) test(`import rejects ${name} without disk mutation or wallet action`, async () => {
  const { f, json } = await failedSave(); const value = JSON.parse(json); edit(value); const disk = structuredClone(f.saved);
  f.state.writeFail = null; f.calls.length = 0;
  await assert.rejects(f.createOperation().persist(f.input, { ...f.callbacks, mode: 'query', recoveryJson: JSON.stringify(value) }));
  assert.deepEqual(f.saved, disk); assert.equal(f.calls.includes('sign'), false); assert.equal(f.calls.includes('broadcast'), false);
});
test('import cannot overwrite another digest or a missing operation record', async () => {
  const { f, json } = await failedSave(); f.state.writeFail = null;
  const old = structuredClone(f.saved); f.saved = null;
  await assert.rejects(f.createOperation().persist(f.input, { ...f.callbacks, mode: 'query', recoveryJson: json }), /RECOVERY_DISK_STATE_INVALID/);
  assert.equal(f.saved, null); f.saved = old;
  const data = Transaction.from(fromBase64(f.saved.bytes)).getData(); data.expiration.Epoch++;
  const changed = TransactionDataBuilder.restore(data).build(); f.saved.bytes = toBase64(changed); f.saved.digest = TransactionDataBuilder.getDigestFromBytes(changed);
  const disk = structuredClone(f.saved);
  await assert.rejects(f.createOperation().persist(f.input, { ...f.callbacks, mode: 'query', recoveryJson: json }), /RECOVERY_DISK_CONFLICT/);
  assert.deepEqual(f.saved, disk);
});
test('malformed or oversized import fails before storage, while export is scope-isolated and detached', async () => {
  const { f, json } = await failedSave(); f.calls.length = 0;
  for (const recoveryJson of ['{}', json + '\n', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    await assert.rejects(f.createOperation().persist(f.input, { ...f.callbacks, mode: 'query', recoveryJson }));
  }
  assert.equal(f.operation.exportRecovery({ ...recoveryScope, rootId: id(999) }), null);
  const copy = JSON.parse(f.operation.exportRecovery(recoveryScope)); copy.signature = 'changed';
  assert.equal(f.operation.exportRecovery(recoveryScope), json); assert.equal(f.calls.includes('sign'), false);
});
test('cold import cannot replace durable finality with conflicting same-rank proof during query outage', async () => {
  const f = setup(); await f.run('resume'); const disk = structuredClone(f.saved);
  const imported = structuredClone(disk); imported.finality.checkpoint = String(BigInt(imported.finality.checkpoint) + 1n);
  f.client.getFinalizedTransactionEvidence = async () => { throw new Error('unavailable'); }; f.calls.length = 0;
  const fresh = f.createOperation();
  await assert.rejects(fresh.persist(f.input, { ...f.callbacks, mode: 'query', recoveryJson: JSON.stringify(imported) }), /RECOVERY_DISK_CONFLICT/);
  assert.deepEqual(f.saved, disk); assert.deepEqual(f.calls, []); assert.equal(fresh.exportRecovery(recoveryScope), null);
});
test('cold identical finalized import is idempotent and weaker signed import cannot downgrade disk finality', async () => {
  const f = setup(); await f.run('resume'); const disk = structuredClone(f.saved);
  f.client.getFinalizedTransactionEvidence = async () => { throw new Error('unavailable'); };
  for (const imported of [disk, { ...disk, status: 'SIGNED', finality: null }]) {
    f.calls.length = 0;
    const result = await f.createOperation().persist(f.input, { ...f.callbacks, mode: 'query', recoveryJson: JSON.stringify(imported) });
    assert.equal(result.reason, 'OUTCOME_UNKNOWN'); assert.deepEqual(f.saved, disk);
    assert.deepEqual(f.calls, ['save:FINALIZED_SUCCESS']);
  }
});
