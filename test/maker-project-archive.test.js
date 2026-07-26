import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMakerProjectArchive,
  MAKER_PROJECT_ARCHIVE_SCHEMA,
  readMakerProjectArchive,
} from '../maker-project-archive.js';

test('round-trips a portable Maker project with source and thumbnail blobs', async () => {
  const document = {
    schemaVersion: 'animacraft.maker.v5',
    metadata: { id: 'portable-maker' },
    assets: [{
      id: 'body-art',
      identifier: 'layers/body.png',
      kind: 'layer',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
    }],
  };
  const source = new Blob(['source-png'], { type: 'image/png' });
  const thumbnail = new Blob(['thumb-png'], { type: 'image/png' });
  const archive = await createMakerProjectArchive(document, new Map([['body-art', {
    assetId: 'body-art',
    fileName: 'Body Art.png',
    width: 1024,
    height: 1024,
    blob: source,
    thumbnailBlob: thumbnail,
  }]]));
  assert.equal(archive.type, 'application/zip');
  const restored = await readMakerProjectArchive(archive);
  assert.deepEqual(restored.document, document);
  assert.equal(restored.assets[0].assetId, 'body-art');
  assert.equal(await restored.assets[0].blob.text(), 'source-png');
  assert.equal(await restored.assets[0].thumbnailBlob.text(), 'thumb-png');
});

test('rejects arbitrary ZIP payloads without the project schema', async () => {
  await assert.rejects(
    () => readMakerProjectArchive(new Blob(['not-a-zip'])),
    /not a readable Animacraft Maker project ZIP/,
  );
  assert.equal(MAKER_PROJECT_ARCHIVE_SCHEMA, 'animacraft.maker-project.v1');
});
