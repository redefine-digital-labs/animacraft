import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { fromBase64 } from '@mysten/sui/utils';
import { createMakerV8ComposableArtworkStore, validateComposableProductSettings } from '../maker-v8-composable-artwork-store.js';
import { MAKER_V8_DEFAULT_ASSET_BASE64 } from './fixtures/maker-v8-minimal-artwork.js';

test('external artwork cold reopen preserves exact bytes, target isolation and atomic replacement', async () => {
  const idb = new IDBFactory();
  const binding = { address: `0x${'1'.repeat(64)}`, rootId: `0x${'2'.repeat(64)}`, makerVersion: '1', contentCommitment: '3'.repeat(64), partKey: 'accessory' };
  const bytes = fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64);
  let store = createMakerV8ComposableArtworkStore(idb);
  assert.equal(await store.load(binding), null);
  const first = await store.save({ binding, expectedRevision: 0, bytes });
  store.close(); store = createMakerV8ComposableArtworkStore(idb);
  try {
    assert.deepEqual(await store.load(binding), first);
    for (const delta of [{ address: `0x${'4'.repeat(64)}` }, { partKey: 'hat' }, { contentCommitment: '5'.repeat(64) }]) {
      assert.equal(await store.load({ ...binding, ...delta }), null);
    }
    const outcomes = await Promise.allSettled([1, 2].map(() => store.save({ binding, expectedRevision: 1, bytes })));
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(row => row.status === 'rejected').reason.code, 'COMPOSABLE_ARTWORK_CONFLICT');
    await assert.rejects(store.save({ binding, expectedRevision: 2, bytes: new Uint8Array([1]) }));
    assert.equal((await store.load(binding)).revision, 2);
    const target = { rootId: binding.rootId, makerVersion: '1', contentCommitment: binding.contentCommitment,
      parts: [{ key: binding.partKey }], tracks: [{ key: 'front' }], colors: [{ key: 'tone', swatches: [{ key: 'blue' }] }] };
    const settings = { itemKey: 'hat', styleKey: 'blue', layerTrackKey: 'front', colorChannelKey: 'tone', defaultSwatchKey: 'blue', transferable: true };
    const configured = await store.saveSettings({ binding, expectedRevision: 2, settings, target });
    assert.deepEqual((await store.load(binding)).settings, settings);
    assert.deepEqual(configured.bytes, bytes);
    for (const delta of [{ layerTrackKey: 'invented' }, { defaultSwatchKey: 'missing' }, { colorChannelKey: null }, { itemKey: '' }, { transferable: 'true' }]) {
      assert.throws(() => validateComposableProductSettings({ ...settings, ...delta }, target));
    }
    await assert.rejects(store.saveSettings({ binding, expectedRevision: 3, settings, target: { ...target, rootId: `0x${'9'.repeat(64)}` } }));
    assert.equal((await store.load(binding)).revision, 3);
    await store.rememberUpload({ binding, expectedRevision: 3, uploadId: `walrus-${'a'.repeat(64)}`, sha256: configured.sha256 });
    store.close(); store = createMakerV8ComposableArtworkStore(idb);
    const references = await store.listUploadReferences(binding.address);
    assert.equal(references.length, 1);
    assert.equal(references[0].artworkRevision, 3);
    assert.deepEqual(references[0].binding, binding);
    assert.equal('bytes' in references[0], false);
    assert.deepEqual(await store.listUploadReferences(`0x${'4'.repeat(64)}`), []);
  } finally { store.close(); }
});
