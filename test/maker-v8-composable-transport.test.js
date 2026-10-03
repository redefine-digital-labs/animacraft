import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { fromBase64 } from '@mysten/sui/utils';
import { createMakerV8ComposableArtworkStore } from '../maker-v8-composable-artwork-store.js';
import { createMakerV8ComposableTransport } from '../maker-v8-composable-transport.js';
import { MAKER_V8_DEFAULT_ASSET_BASE64 } from './fixtures/maker-v8-minimal-artwork.js';

test('external storage preparation reuses exact durable bytes and never signs or uploads', async () => {
  const store = createMakerV8ComposableArtworkStore(new IDBFactory());
  const binding = { address: `0x${'1'.repeat(64)}`, rootId: `0x${'2'.repeat(64)}`, makerVersion: '1', contentCommitment: '3'.repeat(64), partKey: 'hat' };
  const target = { ...binding, parts: [{ key: 'hat' }], tracks: [{ key: 'front' }], colors: [] };
  const settings = { itemKey: 'hat', styleKey: 'blue', layerTrackKey: 'front', colorChannelKey: null, defaultSwatchKey: null, transferable: false };
  const bytes = fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64);
  await store.save({ binding, expectedRevision: 0, bytes });
  const saved = await store.saveSettings({ binding, expectedRevision: 1, settings, target });
  let upload, content, prepares = 0, account = binding.address, duringPrepare = async () => {};
  const publisher = {
    async load() { return upload || null; },
    async loadContent() { return content; },
    async prepare(input) {
      prepares++;
      content = { ...input, byteLength: bytes.length, byteSha256: saved.sha256 };
      upload = { ...content, status: 'SIGNATURE_REQUIRED', blobId: 'encoded-not-certified' };
      await duringPrepare(); return upload;
    },
    requestSignature() { assert.fail('must not sign'); }, resume() { assert.fail('must not upload'); },
  };
  const transport = createMakerV8ComposableTransport({ publisher, artworkStore: store, wallet: { getCurrentAccount: async () => ({ address: account }) } });
  try {
    const input = { binding, expectedRevision: 2 };
    const first = await transport.prepare(input);
    assert.equal(first.status, 'SIGNATURE_REQUIRED');
    assert.deepEqual(await transport.prepare(input), first); assert.equal(prepares, 1);
    assert.equal((await store.load(binding)).uploads.length, 1, 'repeat preparation keeps one durable recovery reference');
    content = { ...content, bytesBase64: 'AQ==' };
    await assert.rejects(transport.prepare(input), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
    account = `0x${'4'.repeat(64)}`;
    await assert.rejects(transport.prepare(input), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
    account = binding.address; upload = null;
    duringPrepare = () => store.save({ binding, expectedRevision: 2, bytes });
    await assert.rejects(transport.prepare(input), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
    assert.equal((await store.load(binding)).uploads[0].uploadId, first.uploadId);
    const history = await transport.history();
    assert.equal(history.address, binding.address);
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].uploadId, first.uploadId);
    assert.equal(history.rows[0].artworkRevision, 2, 'history keeps old revision after source advances');
    assert.equal(history.rows[0].status, 'SIGNATURE_REQUIRED');
    assert.equal(prepares, 2, 'history never prepares another upload');
    upload = { ...upload, revision: 4, stage: 'REGISTER' };
    const advance = { uploadId: first.uploadId, uploadRevision: 4, stage: 'REGISTER', status: 'SIGNATURE_REQUIRED', action: 'SIGN' };
    await assert.rejects(transport.advance({ ...advance, uploadRevision: 3 }), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
    await assert.rejects(transport.advance({ ...advance, action: 'RECOVER' }), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
    publisher.requestSignature = async (id, expected) => {
      assert.equal(id, first.uploadId);
      assert.deepEqual(expected, { revision: 4, stage: 'REGISTER', status: 'SIGNATURE_REQUIRED' });
      return { status: 'RECOVERY_REQUIRED' };
    };
    assert.equal((await transport.advance(advance)).status, 'RECOVERY_REQUIRED');
    await assert.rejects(transport.productSource({ uploadId: first.uploadId }), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
    upload = { ...upload, status: 'COMPLETE', stage: 'COMPLETE', deletable: false, blobObjectId: `0x${'5'.repeat(64)}` };
    const source = await transport.productSource({ uploadId: first.uploadId });
    assert.equal(source.artworkRevision, 2, 'uses retained settings, not current source');
    assert.equal(source.payload.assetContentCommitment, saved.sha256);
    assert.equal(source.payload.assetBlobId, upload.blobId);
    assert.equal(source.payload.assetByteLength, String(bytes.length));
    assert.equal(source.payload.itemKey, settings.itemKey);
    const validContent = content;
    content = { ...content, bytesBase64: 'AQ==' };
    await assert.rejects(transport.productSource({ uploadId: first.uploadId }), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
    content = validContent;
    account = `0x${'4'.repeat(64)}`;
    assert.deepEqual((await transport.history()).rows, [], 'history is wallet isolated');
    account = binding.address; upload = null;
    assert.equal((await transport.history()).rows[0].status, 'ERROR', 'missing WAL remains visible, not empty');
    publisher.load = async () => { account = `0x${'4'.repeat(64)}`; return null; };
    await assert.rejects(transport.history(), { code: 'COMPOSABLE_TRANSPORT_DRIFT' });
  } finally { store.close(); }
});
