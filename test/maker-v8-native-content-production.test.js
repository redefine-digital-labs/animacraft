import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { ObjectError } from '@mysten/sui/client';
import { deriveDynamicFieldID, fromBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { nativeIntegrationFixture } from './fixtures/maker-v8-native-integration.js';
import { MAKER_V8_RUNTIME_SCHEMA, MAKER_V8_PAYMENT_COIN_TYPE, MAKER_V8_CLOCK_OBJECT_ID } from '../maker-v8-runtime.js';
import { createProductionMakerV8NativeContentV8 } from '../maker-v8-native-content-production.js';
import { encryptedObjectFixture, nativeInitialEvidenceFixture, nativeMintDigest } from './fixtures/native-initial-content.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const signer = id(900); const rootId = id(200);
const project = () => ({ schemaVersion: 'animacraft.local-player-project.v8', profile: { name: 'Nova', description: '', tags: '' },
  imageExport: { sizeMode: 'standard', transparent: false },
  soul: { defaults: { soulMd: '# 身份\n', memoryMd: '# Memory\n', skillMd: '---\nname: nova\n---\n# Skill\n' }, documents: {} }, recipe: {}, render: {} });
const runtime = () => ({ schemaVersion: MAKER_V8_RUNTIME_SCHEMA, protocolVersion: 8, enabled: true,
  catalogId: id(20), protocolConfigId: id(21), protocolTreasuryId: id(22), paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
  clockObjectId: MAKER_V8_CLOCK_OBJECT_ID, makerBindings: [],
  roles: Object.fromEntries(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'].map((role, index) => [role,
    { typeOriginPackageId: id(index * 2 + 1), callablePackageId: id(index * 2 + 1) }])),
  roleConfigIds: { seal: id(23), runtime: id(24), output: id(25), physical: id(26), market: id(27), release: id(28) } });

function setup() {
  const f = nativeIntegrationFixture(runtime()); const calls = []; const uploads = new Map();
  const state = { account: { address: signer, network: 'mainnet' }, unavailableMint: false, namespaceVersion: '1', badServers: false };
  const getObject = f.rpc.getObject; const getDynamicField = f.rpc.getDynamicField;
  f.rpc.getObject = input => {
    calls.push(['object', input.id]);
    if (state.unavailableMint && [81, 82, 90, 91, 92, 93].map(id).includes(input.id)) throw new Error('issuance unavailable');
    return getObject(input);
  };
  f.rpc.getDynamicField = input => {
    if (input.parentId !== id(92)) return getDynamicField(input);
    calls.push(['kiosk']);
    throw new ObjectError('NOT_FOUND', 'absent', { reason: 'notFound',
      objectId: deriveDynamicFieldID(input.parentId, input.name.type, fromBase64(input.name.bcsBase64)) });
  };
  f.rpc.core = { async getObject(input) { calls.push(['namespace', input.objectId]);
    return { object: { objectId: input.objectId, version: state.namespaceVersion } }; } };
  const receiver = { open(scope) { calls.push(['open', scope]); }, async preflight() { calls.push(['receive-preflight']); return { ready: true }; },
    async sync(input) { calls.push(['sync', input]); return { status: 'COMPLETE', soulId: id(40), transactionDigest: nativeMintDigest }; }, dispose() {} };
  const options = { runtime: f.config, client: f.rpc, wallet: { async getCurrentAccount() { return state.account; } },
    indexedDB: new IDBFactory(), win: { crypto, navigator: { locks: { async request(key, options, callback) { return callback({ name: key }); } } } },
    receiver, walrus: { persistence: { async requirePersistentStorage() { calls.push(['persist']); return true; } }, publisher: {
      async prepare(input) { calls.push(['upload', input]); uploads.set(input.uploadId, { ...input,
        byteSha256: Buffer.from(sha256(fromBase64(input.bytesBase64))).toString('hex'), blobObjectId: id(500 + uploads.size) }); },
      async load(uploadId) { const row = uploads.get(uploadId); return row ? { status: 'COMPLETE', blobObjectId: row.blobObjectId } : null; },
      async loadContent(uploadId) { return uploads.get(uploadId); },
      async resume() { assert.fail('no uncertain fixture upload'); }, async requestSignature() { assert.fail('fixture never signs'); },
    } },
    createSealClient(options) { calls.push(['seal-options', options]); return {
      async getKeyServers() { return state.badServers ? new Map() : new Map(options.serverConfigs.map(row => [row.objectId, { objectId: row.objectId }])); },
      async encrypt(input) { calls.push(['seal-encrypt', input]); return encryptedObjectFixture(input); },
    }; },
  };
  return { ...f, options, state, calls, receiver, provider: createProductionMakerV8NativeContentV8(options) };
}

test('configured Native service is synchronous, dependency-derived and false after disposal', async () => {
  const f = setup();
  assert.equal(f.provider.isConfigured(), true);
  assert.deepEqual(f.calls, []);
  for (const mutate of [
    o => { o.wallet = {}; }, o => { o.client = {}; }, o => { o.indexedDB = null; },
    o => { o.walrus = {}; }, o => { o.receiver = {}; }, o => { o.win = {}; },
    o => { o.win = { ...o.win, crypto: {} }; },
    o => { o.createSealClient = null; },
  ]) {
    const options = { ...f.options }; mutate(options);
    assert.equal(createProductionMakerV8NativeContentV8(options).isConfigured(), false);
  }
  assert.deepEqual(f.calls, []);
  await f.provider.dispose();
  assert.equal(f.provider.isConfigured(), false);
});

test('production factory is lazy and scopes a synchronous popup without opening Creator network services', async () => {
  const f = setup(); assert.deepEqual(f.calls, []);
  f.provider.open({ rootId, signer });
  assert.deepEqual(f.calls, [['open', { rootId, signer }]]);
  await f.provider.dispose();
  await assert.rejects(f.provider.loadCompletion({ rootId, signer }), { code: 'MAKER_V8_NATIVE_CONTENT_DISPOSED' });
  const absent = createProductionMakerV8NativeContentV8({ runtime: runtime() });
  assert.equal(absent.isConfigured(), false);
  assert.throws(() => absent.open({ rootId, signer }), { code: 'MAKER_V8_NATIVE_INTEGRATION_REQUIRED' });
});

test('actual factory composes chain attestations, policy-selected Seal, private store and recovery without new issuance reads', async () => {
  const f = setup(); const input = { rootId, signer, project: project() };
  assert.deepEqual(await f.provider.preflight(input), { ready: true });
  const sealOptions = f.calls.find(row => row[0] === 'seal-options')[1];
  assert.deepEqual(sealOptions.serverConfigs, [{ objectId: id(90), weight: 1 }]);
  assert.equal(sealOptions.verifyKeyServers, true); assert.equal(sealOptions.suiClient, f.rpc);
  assert.equal(f.calls.some(row => row[0] === 'upload'), false);
  const ready = await f.provider.prepare(input);
  assert.equal(ready.status, 'READY'); assert.equal(ready.nativeSoul.currentKioskId, null);
  assert.equal(ready.nativeSoul.currentKioskCapOnChainId, null); assert.equal(ready.nativeSoul.initialContent.length, 3);
  await f.provider.saveCompletion({ ...input, actionId: 'minted' });
  await f.provider.dispose();
  f.state.unavailableMint = true; f.calls.length = 0;
  const cold = createProductionMakerV8NativeContentV8(f.options);
  assert.equal((await cold.loadCompletion(input)).actionId, 'minted');
  assert.equal(f.calls.some(row => row[0] === 'object'), false, 'Saved pointer loads before live issuance checks');
  const proof = nativeInitialEvidenceFixture({ input: ready.nativeSoul, originalPackageId: id(71), soulId: id(40), stateId: id(41), signer });
  const action = { actionId: 'minted', action: 'completeOutput', status: 'FINALIZED_SUCCESS', transactionDigest: nativeMintDigest, certificate: {
    status: 'CERTIFIED', actionId: 'minted', transactionDigest: nativeMintDigest, evidence: {
      effectsBcsSha256: proof.effectsSha256, nativeContentEvidence: proof.evidence,
      certifiedEvent: { fields: { root_id: rootId, original_holder: signer, soul_id: id(40), soul_state_id: id(41) } },
      objects: [{ objectId: id(41), type: `${id(71)}::soul::SoulState`, fields: { soulId: id(40), contentId: ready.nativeSoul.expectedContentObjectId } }],
    } } };
  assert.equal((await cold.finalize({ ...input, action })).status, 'COMPLETE');
  assert.equal(f.calls.filter(row => row[0] === 'seal-encrypt').length, 0);
  assert.equal(f.calls.some(row => row[0] === 'kiosk' || row[0] === 'upload'), false);
  assert.equal(f.calls.find(row => row[0] === 'sync')[1].contentSidecars.length, 3);
  // Once sidecars exist, even cold query recovery must not depend on Seal
  // network availability or encrypt another DEK envelope.
  await cold.dispose(); f.calls.length = 0;
  const noSeal = createProductionMakerV8NativeContentV8({ ...f.options,
    createSealClient() { assert.fail('Saved-envelope query must not contact Seal'); } });
  assert.equal((await noSeal.finalize({ ...input, action, mode: 'query' })).status, 'COMPLETE');
  assert.equal(f.calls.some(row => row[0] === 'seal-encrypt' || row[0] === 'seal-options'), false);
  await noSeal.clearCompletion({ ...input, actionId: 'minted' });
  assert.equal(await noSeal.loadCompletion(input), null);
  await noSeal.dispose();
});

test('production preflight refuses namespace, Seal and wallet drift before any upload', async t => {
  for (const [label, mutate] of Object.entries({
    namespace: f => { f.state.namespaceVersion = '2'; },
    keyServers: f => { f.state.badServers = true; },
    wrongWallet: f => { f.state.account.address = id(999); },
    wrongNetwork: f => { f.state.account.network = 'testnet'; },
    midReadWalletChange: f => { const get = f.rpc.core.getObject; f.rpc.core.getObject = async input => {
      const result = await get(input); f.state.account.address = id(999); return result;
    }; },
  })) await t.test(label, async () => {
    const f = setup(); mutate(f);
    await assert.rejects(f.provider.preflight({ rootId, signer, project: project() }));
    assert.equal(f.calls.some(row => row[0] === 'upload'), false);
    await f.provider.dispose();
  });
});

test('production preparation rechecks the wallet around each final signature guard', async () => {
  const f = setup();
  let signatureRequests = 0;
  f.options.walrus.publisher.requestSignature = async () => { signatureRequests++; assert.fail('Changed wallet must not reach signing'); };
  const load = f.options.walrus.publisher.load;
  f.options.walrus.publisher.load = async key => (await load(key)) ? { status: 'SIGNATURE_REQUIRED' } : null;
  await assert.rejects(f.provider.prepare({ rootId, signer, project: project(),
    assertBeforeSignature: async () => { f.state.account.address = id(999); },
  }), { code: 'MAKER_V8_NATIVE_CONTENT_WALLET_CHANGED' });
  // Publisher.prepare only persists ciphertext. All three are now prepared
  // before the first guard, while a changed wallet still cannot sign any.
  assert.equal(f.calls.filter(row => row[0] === 'upload').length, 3);
  assert.equal(signatureRequests, 0);
  await f.provider.dispose();
});

test('production wrapper preserves deferred preparation and never invokes a final signature guard', async () => {
  const f = setup();
  const prepared = await f.provider.prepare({ rootId, signer, project: project(), deferStorage: true,
    assertBeforeSignature: async () => assert.fail('Deferred production preparation must not request a signature') });
  assert.equal(prepared.status, 'STORAGE_PREPARED');
  assert.equal(prepared.uploads.length, 3);
  assert.equal(f.calls.filter(row => row[0] === 'upload').length, 3);
  assert.ok(prepared.uploads.every(row => row.owner === signer && row.mediaType === 'application/octet-stream'));
  await f.provider.dispose();
});

test('wallet change after Seal encrypt erases returned key before propagating failure and no upload', async () => {
  const f = setup(); const key = new Uint8Array(32).fill(7); const create = f.options.createSealClient;
  const cold = createProductionMakerV8NativeContentV8({ ...f.options, createSealClient(options) {
    const client = create(options);
    return { ...client, async encrypt(input) {
      const result = await client.encrypt(input); f.state.account.address = id(999); return { ...result, key };
    } };
  } });
  await assert.rejects(cold.prepare({ rootId, signer, project: project() }), { code: 'MAKER_V8_NATIVE_CONTENT_CRYPTO_INVALID' });
  assert.ok(key.every(byte => byte === 0)); assert.equal(f.calls.some(row => row[0] === 'upload'), false);
  await cold.dispose(); await f.provider.dispose();
});
