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

test('the exact Walrus manifest bytes are hashed for an Expansion Pack parent release', () => {
  const hydration = section('async function hydrateChainMaker', '\nasync function reconcileOwnedMakerSuccessors');
  assert.match(hydration, /const manifestSha256 = await sha256BytesHex\(manifestBytes/);
  assert.match(hydration, /manifestSha256,/);

  const publication = section('async function finalizeMakerPublication', '\nasync function recoverMakerPublicationIntent');
  assert.match(publication, /sha256Utf8Hex\(state\.pendingMakerManifestJson/);
  assert.match(publication, /manifestSha256: publishedManifestSha256/);
});

test('the local Maker index preserves the immutable parent release identity', () => {
  const persist = section('function persistLocalMakerIndex', '\nfunction loadLocalMakerIndex');
  assert.match(persist, /quiltId: safeDraftText\(template\.quiltId/);
  assert.match(persist, /manifestSha256: normalizedSha256Hex\(template\.manifestSha256\)/);

  const load = section('function loadLocalMakerIndex', '\nfunction currentDraftRecoveryRecord');
  assert.match(load, /quiltId: safeDraftText\(record\.quiltId/);
  assert.match(load, /manifestSha256: normalizedSha256Hex\(record\.manifestSha256\)/);
});

test('only the matching published document receives publishable Pack release evidence', () => {
  const evidence = section(
    'function expansionPackParentReleaseForDocument',
    '\nasync function syncMakerWorkspaceContext',
  );
  assert.match(evidence, /state\.publishedMakerDocumentV4/);
  assert.match(evidence, /document\.version\?\.rootMakerId/);
  assert.match(evidence, /document\.version\?\.versionId/);
  assert.match(evidence, /document\.version\?\.number/);
  assert.match(evidence, /manifestIdentityVerified !== true\) return null/);
  assert.match(evidence, /if \(!releaseId \|\| !manifestBlobId \|\| !manifestHash\) return null/);
  assert.match(evidence, /published: true/);

  const context = section('async function syncMakerWorkspaceContext', '\nfunction renderAll');
  assert.match(context, /const expansionPackParentRelease = expansionPackParentReleaseForDocument\(document\)/);
  assert.match(context, /\n    expansionPackParentRelease,/);
});
