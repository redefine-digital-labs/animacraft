import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Transaction } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { createMakerV8NativeContentProviderV8 } from '../maker-v8-native-content-provider.js';
import { createMakerV8NativeContentStoreV8 } from '../maker-v8-native-content-store.js';
import { createMakerV8WalrusPublisherV8, createMakerV8WalrusPersistenceV8 } from '../maker-v8-walrus.js';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';
import { encryptedObjectFixture, nativeInitialEvidenceFixture, nativeMintDigest } from './fixtures/native-initial-content.js';
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const signer = id(1); const rootId = id(2); const packageId = id(3);
const project = () => ({ schemaVersion: 'animacraft.local-player-project.v8', profile: { name: 'Nova', description: '', tags: 'OC, nova, OC' },
  imageExport: { sizeMode: 'standard', transparent: false },
  soul: { defaults: { soulMd: '# 身份\n', memoryMd: '# Memory\n', skillMd: '---\nname: nova\n---\n# Skill\n' }, documents: {} }, recipe: {}, render: {} });

function harness() {
  const indexedDB = new IDBFactory(); const calls = [];
  const store = createMakerV8NativeContentStoreV8({ indexedDB, requirePersistentStorage: async () => true });
  const persistence = createMakerV8WalrusPersistenceV8(indexedDB, { storageManager: { persisted: async () => true, persist: async () => true } });
  const blobs = new Map(); const byObject = new Map();
  function metadata(bytes, nonce = new Uint8Array(32).fill(5)) {
    const rootHash = sha256(bytes); const blobId = toBase64(rootHash).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    blobs.set(blobId, new Uint8Array(bytes));
    return { blobId, rootHash, nonce, metadata: { unencodedLength: BigInt(bytes.length) } };
  }
  function transaction(label) {
    const tx = new Transaction(); tx.setSender(signer); tx.setGasOwner(signer); tx.setGasBudget(1000000); tx.setGasPrice(1);
    tx.setGasPayment([{ objectId: id(9), version: '1', digest: toBase58(new Uint8Array(32).fill(9)) }]);
    tx.moveCall({ target: `${packageId}::fixture::${label}`, arguments: [] }); return tx;
  }
  const publisher = createMakerV8WalrusPublisherV8({ persistence,
    walrusClient: {
      async computeBlobMetadata({ bytes, nonce }) { return metadata(bytes, nonce); },
      writeBlobFlow({ blob, resume }) {
        const info = metadata(blob); const objectId = `0x${Buffer.from(info.rootHash).toString('hex')}`;
        byObject.set(objectId, info.blobId);
        return { async encode() { return resume; }, register() { return transaction('register'); },
          async upload() { calls.push('upload'); return { blobId: info.blobId, blobObjectId: objectId, certificate: toBase64(new Uint8Array(80)) }; } };
      },
      certifyBlobTransaction() { return transaction('certify'); },
      async getBlobObject(objectId) { const blobId = byObject.get(objectId); return { id: objectId, blob_id: blobId,
        size: String(blobs.get(blobId).length), deletable: false, certified_epoch: 10n, storage: { end_epoch: 13n } }; },
      async getVerifiedBlobStatus() { return { type: 'permanent', isCertified: true, initialCertifiedEpoch: 10 }; },
    },
    buildClient: { core: { async getCurrentSystemState() { return { systemState: { epoch: '10' } }; } } },
    rpc: { async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; }, async getSuiClient() { return {}; },
      async queryTransaction({ digest }) { return { status: 'FINALIZED_SUCCESS', digest }; } },
    wallet: { async getCurrentAccount() { return { address: signer, network: 'mainnet' }; },
      async signExactTransaction({ bytes, digest, signer }) { calls.push('sign'); return { bytes, digest, signer, signature: toBase64(new Uint8Array(97).fill(9)) }; },
      async verifyExactSignature() { return { verified: true }; } },
    execution: { network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, allowWalletSignature: true, allowBroadcast: true },
    fetcher: async url => ({ ok: true, async arrayBuffer() { return blobs.get(decodeURIComponent(url.split('/').at(-1))).slice().buffer; } }),
  });
  const receiver = { ready: true, requests: [], complete: false,
    async preflight() { return { ready: this.ready }; },
    async sync(request) { this.requests.push(request); return this.complete ? { status: 'COMPLETE', soulId: id(40), transactionDigest: nativeMintDigest } : { status: 'RECOVERY_REQUIRED' }; } };
  const held = new Set();
  const locks = { async request(key, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held.has(key)) return callback(null);
    held.add(key);
    try { return await callback({ name: key }); } finally { held.delete(key); }
  } };
  const envelopes = { async persist(input, options) {
    calls.push('envelopes');
    assert.equal(input.slots.length, 3);
    const record = await options.load() ?? { status: 'fixture-complete', soulId: id(40) };
    assert.deepEqual(await options.write(record), record);
    assert.deepEqual(await options.load(), record);
    return { status: 'COMPLETE' };
  } };
  const dependencies = { store, walrus: { publisher, persistence }, receiver, locks, envelopes,
    resolveCompletionAuthority: async () => ({ runtime: { nativeSoulIntegration: { soulidityOriginalPackageId: packageId, kioskRegistryId: id(4) } },
      threshold: 1, sealClient: { async encrypt(input) { calls.push('seal'); return encryptedObjectFixture(input); } } }),
    resolveAuthority: async () => ({ runtime: { nativeSoulIntegration: { soulidityOriginalPackageId: packageId, kioskRegistryId: id(4) } },
      currentKioskId: null, currentKioskCapOnChainId: null, threshold: 1,
      sealClient: { async encrypt(input) { calls.push('seal'); return encryptedObjectFixture(input); } } }) };
  return { dependencies, provider: createMakerV8NativeContentProviderV8(dependencies), receiver, calls, store, indexedDB };
}

function completed(input, actionId = 'action-one') {
  const proof = nativeInitialEvidenceFixture({ input, originalPackageId: packageId, soulId: id(40), stateId: id(41), signer });
  return { actionId, action: 'completeOutput', status: 'FINALIZED_SUCCESS', transactionDigest: nativeMintDigest, certificate: {
    status: 'CERTIFIED', actionId, transactionDigest: nativeMintDigest, evidence: {
      effectsBcsSha256: proof.effectsSha256, nativeContentEvidence: proof.evidence,
      certifiedEvent: { fields: { root_id: rootId, original_holder: signer, soul_id: id(40), soul_state_id: id(41) } },
      objects: [{ objectId: id(41), type: `${packageId}::soul::SoulState`, fields: { soulId: id(40), contentId: input.expectedContentObjectId } }],
    } } };
}

test('real crypto/private IDB/actual Walrus state machine survives retry and never publishes raw material', async () => {
  const h = harness(); const args = { rootId, signer, project: project(), assertBeforeSignature: async () => { h.calls.push('guard'); } };
  await h.provider.preflight(args);
  const ready = await h.provider.prepare(args);
  assert.equal(ready.status, 'READY'); assert.equal(ready.nativeSoul.initialContent.length, 3);
  assert.deepEqual(ready.nativeSoul.initialStateConfig, [{ key: 'soul_public_preview_v1',
    valueUtf8: JSON.stringify({ schema: 'soulidity.soul-public-preview.v1', tags: ['oc', 'nova'], previewImages: [] }) }]);
  assert.equal(h.calls.filter(c => c === 'sign').length, 6);
  assert.equal(h.calls.filter(c => c === 'guard').length, 6);
  assert.equal(h.calls.slice(0, h.calls.indexOf('guard')).filter(c => c === 'seal').length, 3);
  const privateRow = await h.store.load(`native-content/${rootId}/${signer}`);
  assert.equal(privateRow.data.mintNonce, ready.nativeSoul.mintNonce);
  assert.equal(privateRow.data.expectedContentObjectId, ready.nativeSoul.expectedContentObjectId);
  assert.ok(privateRow.data.files.every(file => file.sidecar));
  assert.equal(JSON.stringify(ready).includes('dek'), false);
  const cold = createMakerV8NativeContentProviderV8(h.dependencies);
  assert.deepEqual(await cold.prepare(args), ready);
  assert.equal(h.calls.filter(c => c === 'sign').length, 6);
  await cold.saveCompletion({ ...args, actionId: 'action-one' });
  const retirement = { rootId, signer, actionId: 'action-one', soulId: id(40), transactionDigest: nativeMintDigest };
  await assert.rejects(cold.retireFinalizedCompletion(retirement), { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT' });
  await assert.rejects(cold.saveCompletion({ ...args, actionId: 'action-two' }), { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT' });
  await assert.rejects(cold.clearCompletion({ rootId, signer, actionId: 'other' }));
  const changed = project(); changed.profile.name = 'Changed';
  await assert.rejects(cold.prepare({ ...args, project: changed }), { code: 'MAKER_V8_NATIVE_CONTENT_PENDING_COMPLETION' });
  const action = completed(ready.nativeSoul);
  assert.equal((await cold.finalize({ ...args, action })).status, 'RECOVERY_REQUIRED');
  await assert.rejects(cold.retireFinalizedCompletion(retirement), { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT' });
  assert.equal(h.calls.filter(c => c === 'seal').length, 3);
  const drifted = structuredClone(action);
  drifted.certificate.evidence.objects[0].fields.contentId = id(99);
  await assert.rejects(cold.finalize({ ...args, action: drifted }), { code: 'MAKER_V8_NATIVE_CONTENT_CERTIFICATE_DRIFT' });
  h.receiver.complete = true;
  assert.equal((await cold.finalize({ ...args, action })).status, 'COMPLETE');
  assert.equal(h.calls.filter(c => c === 'seal').length, 3);
  assert.equal(JSON.stringify(h.receiver.requests).includes('"material"'), false);
  assert.equal(JSON.stringify(h.receiver.requests).includes('bytesBase64'), false);
  assert.equal((await cold.loadCompletion({ rootId, signer })).actionId, 'action-one');
  for (const changed of [{ actionId: 'other' }, { soulId: id(90) }, { transactionDigest: 'other' },
    { rootId: id(90) }, { signer: id(90) }]) {
    await assert.rejects(cold.retireFinalizedCompletion({ ...retirement, ...changed }),
      { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT' });
    assert.equal((await cold.loadCompletion({ rootId, signer })).actionId, 'action-one');
  }
  assert.deepEqual(await cold.retireFinalizedCompletion(retirement), {
    status: 'RETIRED', actionId: 'action-one', soulId: id(40), transactionDigest: nativeMintDigest,
  });
  await assert.rejects(cold.retireFinalizedCompletion(retirement), { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT' });
  const next = await cold.prepare(args);
  assert.notDeepEqual(next.nativeSoul.initialContent.map(f => f.blobObjectId), ready.nativeSoul.initialContent.map(f => f.blobObjectId));
  assert.equal(h.calls.filter(c => c === 'sign').length, 12);
  await cold.saveCompletion({ ...args, actionId: 'action-two' });
  await assert.rejects(cold.retireFinalizedCompletion(retirement), { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_CONFLICT' });
  assert.equal((await cold.loadCompletion({ rootId, signer })).actionId, 'action-two');
  await h.store.close();
});

test('cold recovery verifies atomic content evidence before receiver without another signature', async () => {
  const h = harness(); const args = { rootId, signer, project: project(), assertBeforeSignature: async () => {} };
  const ready = await h.provider.prepare(args); await h.provider.saveCompletion({ ...args, actionId: 'minted' });
  const action = completed(ready.nativeSoul, 'minted');
  const missing = structuredClone(action); delete missing.certificate.evidence.nativeContentEvidence;
  await assert.rejects(h.provider.finalize({ ...args, action: missing }), { code: 'MAKER_V8_NATIVE_CONTENT_EVIDENCE_INVALID' });
  assert.equal(h.receiver.requests.length, 0);
  assert.equal((await h.store.load(`native-content/${rootId}/${signer}`)).data.finalizing, undefined);
  const calls = [...h.calls]; const cold = createMakerV8NativeContentProviderV8(h.dependencies);
  h.dependencies.envelopes.persist = async () => assert.fail('Initial envelopes are already in mint');
  await cold.finalize({ ...args, action, mode: 'query', assertBeforeSignature: () => assert.fail('Query never signs') });
  assert.deepEqual(h.calls, calls); assert.equal(h.receiver.requests.length, 1);
  const forged = structuredClone(action); forged.certificate.evidence.nativeContentEvidence.objects.pop();
  await assert.rejects(cold.finalize({ ...args, action: forged }), { code: 'MAKER_V8_NATIVE_CONTENT_EVIDENCE_INVALID' });
  assert.equal(h.receiver.requests.length, 1); assert.equal((await cold.loadCompletion(args)).actionId, 'minted');
  await h.store.close();
});

test('cross-instance locks reject concurrent signing without a timeout takeover', async () => {
  const h = harness();
  const second = createMakerV8NativeContentProviderV8(h.dependencies);
  let reached; const started = new Promise(resolve => { reached = resolve; });
  let release; const paused = new Promise(resolve => { release = resolve; });
  const args = { rootId, signer, project: project(), assertBeforeSignature: async () => { reached(); await paused; } };
  const first = h.provider.prepare(args);
  await started;
  await assert.rejects(second.prepare({ ...args, assertBeforeSignature: async () => {} }), { code: 'MAKER_V8_NATIVE_CONTENT_BUSY' });
  await assert.rejects(second.retireFinalizedCompletion({ rootId, signer, actionId: 'prior', soulId: id(40), transactionDigest: 'prior-digest' }),
    { code: 'MAKER_V8_NATIVE_CONTENT_BUSY' });
  assert.equal(h.calls.includes('sign'), false);
  release(); await first;
  assert.equal(h.calls.filter(c => c === 'sign').length, 6);
  const missingLocks = createMakerV8NativeContentProviderV8({ ...h.dependencies, locks: null });
  await assert.rejects(missingLocks.preflight(args), { code: 'MAKER_V8_NATIVE_CONTENT_LOCKS_REQUIRED' });
  await h.store.close();
});

test('missing receiver readiness and signature guard fail before costs; unknown upload never re-registers', async () => {
  const h = harness(); const args = { rootId, signer, project: project() };
  h.receiver.ready = false;
  await assert.rejects(h.provider.preflight(args), { code: 'MAKER_V8_NATIVE_CONTENT_RECEIVER_UNAVAILABLE' });
  assert.equal(h.calls.length, 0);
  h.receiver.ready = true;
  const noRecovery = createMakerV8NativeContentProviderV8({ ...h.dependencies, resolveCompletionAuthority: undefined });
  await assert.rejects(noRecovery.preflight(args), { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_AUTHORITY_REQUIRED' });
  await assert.rejects(noRecovery.prepare(args), { code: 'MAKER_V8_NATIVE_CONTENT_COMPLETION_AUTHORITY_REQUIRED' });
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.provider.prepare(args), { code: 'MAKER_V8_NATIVE_CONTENT_SIGNATURE_GUARD_REQUIRED' });
  assert.equal(h.calls.includes('sign'), false);
  const failing = { ...h.dependencies, walrus: { ...h.dependencies.walrus, publisher: {
    ...h.dependencies.walrus.publisher, async load() { return { status: 'UNKNOWN' }; },
  } } };
  await assert.rejects(createMakerV8NativeContentProviderV8(failing).prepare({ ...args, assertBeforeSignature: async () => {} }), { code: 'MAKER_V8_NATIVE_CONTENT_UPLOAD_STATE_INVALID' });
  assert.equal(h.calls.includes('sign'), false);
  let prepares = 0;
  const missing = { ...h.dependencies, walrus: { ...h.dependencies.walrus, publisher: {
    ...h.dependencies.walrus.publisher, async load() { return null; }, async prepare() { prepares++; },
  } } };
  await assert.rejects(createMakerV8NativeContentProviderV8(missing).prepare({ ...args, assertBeforeSignature: async () => {} }), { code: 'MAKER_V8_NATIVE_CONTENT_UPLOAD_JOURNAL_MISSING' });
  assert.equal(prepares, 0);
  await h.store.close();
});

test('finalized content recovery does not require issuance permission, Walrus availability or Kiosk discovery', async () => {
  const h = harness(); const args = { rootId, signer, project: project() };
  const ready = await h.provider.prepare({ ...args, assertBeforeSignature: async () => {} });
  await h.provider.saveCompletion({ ...args, actionId: 'minted' });
  let issuanceReads = 0; let recoveryReads = 0;
  const recoveryDependencies = { ...h.dependencies,
    resolveAuthority: async () => { issuanceReads++; throw new Error('PRIMARY_DISABLED'); },
    resolveCompletionAuthority: async input => {
      assert.deepEqual(input, { rootId, signer }); recoveryReads++;
      return h.dependencies.resolveCompletionAuthority(input); // No Kiosk fields or new-issuance policy.
    },
  };
  const disabled = createMakerV8NativeContentProviderV8(recoveryDependencies);
  await assert.rejects(disabled.prepare(args), /PRIMARY_DISABLED/);
  const recovery = createMakerV8NativeContentProviderV8({ ...recoveryDependencies, walrus: null });
  const action = completed(ready.nativeSoul, 'minted');
  const wrong = structuredClone(action); wrong.certificate.evidence.certifiedEvent.fields.original_holder = id(90);
  await assert.rejects(recovery.finalize({ ...args, action: wrong }), { code: 'MAKER_V8_NATIVE_CONTENT_CERTIFICATE_INVALID' });
  assert.equal(h.calls.filter(c => c === 'seal').length, 3);
  h.receiver.complete = true;
  assert.equal((await recovery.finalize({ ...args, action })).status, 'COMPLETE');
  assert.equal(issuanceReads, 1); assert.equal(recoveryReads, 2);
  assert.equal(h.calls.filter(c => c === 'sign').length, 6);
  assert.equal(h.calls.filter(c => c === 'seal').length, 3);
  await h.store.close();
});
