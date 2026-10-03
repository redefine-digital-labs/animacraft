import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeMakerV8ProjectZip,
  encodeMakerV8ProjectZip,
  MAKER_V8_PROJECT_ZIP_ENTRY,
} from '../maker-v8-project-zip.js';

test('Fresh-v8 project ZIP roundtrips one exact project entry', () => {
  const bundle = { schemaVersion: 'animacraft.maker-v8-draft-export.v1', draft: { draftId: 'moon' }, assets: [] };
  const archive = encodeMakerV8ProjectZip(bundle);
  assert.equal(new TextDecoder().decode(archive.subarray(30, 30 + MAKER_V8_PROJECT_ZIP_ENTRY.length)), MAKER_V8_PROJECT_ZIP_ENTRY);
  assert.deepEqual(decodeMakerV8ProjectZip(archive), bundle);
});

test('Fresh-v8 project ZIP rejects corruption and appended content', () => {
  const archive = encodeMakerV8ProjectZip({ fresh: 'v8' });
  const corrupt = new Uint8Array(archive);
  corrupt[30 + MAKER_V8_PROJECT_ZIP_ENTRY.length] ^= 1;
  assert.throws(() => decodeMakerV8ProjectZip(corrupt), (error) => error.code === 'MAKER_V8_PROJECT_ZIP_CRC_MISMATCH');
  const appended = new Uint8Array(archive.length + 1);
  appended.set(archive);
  assert.throws(() => decodeMakerV8ProjectZip(appended), (error) => error.code === 'MAKER_V8_PROJECT_ZIP_INVALID');
});
