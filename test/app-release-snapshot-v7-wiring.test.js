import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function section(from, to) {
  const start = app.indexOf(from);
  const end = app.indexOf(to, start + from.length);
  assert.notEqual(start, -1, `missing ${from}`);
  assert.notEqual(end, -1, `missing ${to}`);
  return app.slice(start, end);
}

test('one detached sealed wardrobe snapshot is the v4 release source', () => {
  const snapshot = section(
    'function currentMakerReleaseSnapshotV7',
    '\nfunction currentMakerReleaseDocumentV7',
  );
  assert.match(snapshot, /makerV4DocumentForRelease\(\{ sourceDocument \}\)/);
  assert.match(snapshot, /makerWardrobeV7ReleaseSourceIdentity\(source, options\)/);
  assert.match(snapshot, /createMakerWardrobeV7ReleaseSnapshot\(source, options\)/);
  assert.match(snapshot, /state\.makerReleaseSnapshotV7 = Object\.freeze/);

  const prepare = section(
    'async function prepareMakerUpload',
    '\nasync function registerMakerUpload',
  );
  assert.match(prepare, /currentMakerReleaseDocumentV7\(\)/);
  assert.doesNotMatch(prepare, /makerV4DocumentForRelease\(\)/);
});

test('v6 companion consumes the exact retained release snapshot', () => {
  const prepareV6 = section(
    'async function prepareCurrentMakerComposableV6Publication',
    '\nasync function advanceCurrentMakerComposableV6Publication',
  );
  assert.match(prepareV6, /const document = currentMakerReleaseDocumentV7\(\)/);
  assert.match(prepareV6, /state\.pendingMakerV4Bundle\?\.manifest/);
  assert.doesNotMatch(prepareV6, /currentMakerV4Source\(\)|state\.makerDocumentV4/);

  const prepareV7 = section(
    'async function prepareCurrentMakerPhysicalV7Publication',
    '\nasync function advanceCurrentMakerPhysicalV7Publication',
  );
  assert.match(prepareV7, /const document = currentMakerReleaseDocumentV7\(\)/);
  assert.match(prepareV7, /baseManifest/);
  assert.match(prepareV7, /baseManifestBlobId/);
  assert.doesNotMatch(prepareV7, /currentMakerV4Source\(\)|state\.makerDocumentV4/);
});

test('upload recovery persists and verifies the exact release snapshot', () => {
  const verification = section(
    'async function saveVerifiedUploadRecovery',
    '\nfunction captureMakerUploadPersistenceContext',
  );
  assert.match(verification, /verified\.releaseSnapshotV7/);
  assert.match(verification, /record\.releaseSnapshotV7/);

  const capture = section(
    'function captureMakerUploadPersistenceContext',
    '\nfunction makerUploadContextWithPublicationIntent',
  );
  assert.match(capture, /releaseSnapshotV7: state\.makerReleaseSnapshotV7/);

  const restore = section(
    'async function restoreMakerUploadRecovery',
    '\nasync function restoreOcUploadRecovery',
  );
  assert.match(restore, /const persistedReleaseSnapshot = recovery\.releaseSnapshotV7/);
  assert.match(restore, /persistedReleaseSnapshot\.sourceIdentity !== expectedSourceIdentity/);
  assert.match(restore, /const recoveredDocumentV4 = structuredClone\(persistedReleaseSnapshot\.document\)/);
  assert.match(restore, /releaseDocument: recoveredDocumentV4/);
});

test('draft mutation invalidates release snapshot and downstream publication plans', () => {
  const invalidation = section(
    'function invalidateMakerUpload',
    '\nfunction normalizedMakerPublicationIntent',
  );
  assert.match(invalidation, /state\.makerReleaseSnapshotV7 = null/);
  assert.match(invalidation, /makerComposableV6Publication = null/);
  assert.match(invalidation, /makerPhysicalV7Publication = null/);

  const workspaceCallbacks = section(
    'makerWorkspace = createMakerWorkspace',
    '\nfunction activatePublishedMakerForPlayer',
  );
  assert.match(
    workspaceCallbacks,
    /onDocumentChange\(payload\)[\s\S]*state\.makerReleaseSnapshotV7[\s\S]*invalidateMakerUpload/,
  );
});
