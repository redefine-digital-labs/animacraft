import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addExpansionPackItem,
  createExpansionPackProject,
  rebindExpansionPackProjectToPublishedRelease,
} from '../expansion-pack-project.js';
import {
  EXPANSION_PACK_MANIFEST_IDENTIFIER,
  EXPANSION_PACK_MANIFEST_SCHEMA,
  EXPANSION_PACK_PUBLICATION_CANDIDATE_SCHEMA,
  buildExpansionPackPublicationCandidate,
  canonicalExpansionPackJson,
  hashExpansionPackContent,
} from '../expansion-pack-publication.js';

const PARENT_HASH = '11'.repeat(32);
const ASSET_HASH = '22'.repeat(32);

function parentMaker() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: 'maker-root', versionId: 'maker-root-v7', number: 7 },
    metadata: {
      id: 'maker-root',
      name: 'Parent Maker',
      license: { kind: 'personal-use', note: 'Parent terms are inherited.' },
    },
    canvas: { width: 1024, height: 1024, pixelMode: 'smooth' },
    layerTracks: [{ id: 'body-track', name: 'Body', order: 0 }],
    colorChannels: [],
    assets: [{
      id: 'body-art',
      identifier: 'parent/body.png',
      mediaType: 'image/png',
      sha256: '33'.repeat(32),
    }],
    parts: [{
      id: 'body',
      name: 'Body',
      required: true,
      allowRemove: false,
      defaultItemId: 'default',
      items: [{
        id: 'default',
        name: 'Default',
        defaultStyleId: 'default',
        styles: [{
          id: 'default',
          assetId: 'body-art',
          layerTrackId: 'body-track',
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
        }],
      }],
    }],
    defaultRecipe: {
      selections: [{ partId: 'body', itemId: 'default', styleId: 'default' }],
      colors: [],
    },
    rules: [],
  };
}

function project({ published = true, assetHash = ASSET_HASH } = {}) {
  const created = createExpansionPackProject(parentMaker(), {
    packId: 'moon-pack',
    namespace: 'moon',
    name: 'Moon Pack',
    version: '1.0.0',
    walletAddress: '0xABCD',
    ...(published ? {
      parentRelease: {
        identityVerified: true,
        releaseId: '0xmaker-release-v7',
        versionId: 'maker-root-v7',
        versionNumber: '7',
        manifestBlobId: 'walrus-parent-quilt-v7',
        manifestHash: PARENT_HASH,
      },
    } : {}),
  });
  return addExpansionPackItem(created, {
    partId: 'body',
    item: {
      id: 'moon-armor',
      name: 'Moon Armor',
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default',
        assetId: 'moon-armor-art',
        layerTrackId: 'body-track',
      }],
    },
    assets: [{
      id: 'moon-armor-art',
      identifier: 'assets/moon-armor.png',
      kind: 'layer',
      mediaType: 'image/png',
      sha256: assetHash,
      byteLength: 1234,
      width: 1024,
      height: 1024,
    }],
  });
}

test('builds one deterministic canonical child manifest without claiming chain publication', async () => {
  const source = project();
  const first = await buildExpansionPackPublicationCandidate(source);
  const second = await buildExpansionPackPublicationCandidate(structuredClone(source));

  assert.equal(first.schemaVersion, EXPANSION_PACK_PUBLICATION_CANDIDATE_SCHEMA);
  assert.equal(first.manifest.schemaVersion, EXPANSION_PACK_MANIFEST_SCHEMA);
  assert.equal(first.manifestIdentifier, EXPANSION_PACK_MANIFEST_IDENTIFIER);
  assert.equal(first.manifestJson, canonicalExpansionPackJson(first.manifest));
  assert.equal(first.manifestSha256, await hashExpansionPackContent(first.manifestJson));
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.contentCommitment, second.contentCommitment);
  assert.equal(first.candidateCommitment, second.candidateCommitment);

  assert.deepEqual(first.manifest.parent, {
    schemaVersion: 'animacraft.expansion-pack-parent-binding.v2',
    kind: 'published-release',
    rootMakerId: 'maker-root',
    releaseId: '0xmaker-release-v7',
    versionId: 'maker-root-v7',
    versionNumber: '7',
    manifestBlobId: 'walrus-parent-quilt-v7',
    manifestSha256: PARENT_HASH,
    identity: source.parentBinding.identity,
  });
  assert.deepEqual(first.manifest.inheritance, source.inheritance);
  assert.equal(Object.hasOwn(first.manifest, 'parentSnapshot'), false);
  assert.equal(first.manifest.overlay.assets[0].sha256, ASSET_HASH);
  assert.deepEqual(first.manifest.assetReferences.pack, ['moon-armor-art']);
  assert.deepEqual(first.manifest.assetReferences.parent, []);
  assert.equal(first.manifest.commerce.projectionState, 'not-built');
  assert.equal(first.manifest.rights.projectionState, 'not-built');
  assert.match(first.manifest.rights.parentLicenseCommitment, /^[0-9a-f]{64}$/);
  assert.equal(first.manifest.lifecycle.state, 'DRAFT');
  assert.equal(first.manifest.lifecycle.chainState, 'UNPUBLISHED');
  assert.equal(first.manifest.publicationBoundary.walrus, 'not-uploaded');
  assert.equal(first.manifest.publicationBoundary.sui, 'not-registered');
  assert.equal(first.published, false);
  assert.equal(first.chainConnected, false);
  assert.equal(first.verification.parentChainReadback, 'required');
  assert.equal(first.verification.walrusUpload, 'not-started');
  assert.equal(first.files[0].identifier, EXPANSION_PACK_MANIFEST_IDENTIFIER);
  assert.equal(first.files[0].sha256, first.manifestSha256);
  assert.equal(first.files[1].identifier, 'assets/moon-armor.png');
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.manifest));
});

test('content and candidate commitments change when exact Pack content changes', async () => {
  const original = await buildExpansionPackPublicationCandidate(project());
  const changedProject = project({ assetHash: '44'.repeat(32) });
  const changed = await buildExpansionPackPublicationCandidate(changedProject);

  assert.notEqual(changed.contentCommitment, original.contentCommitment);
  assert.notEqual(changed.manifestSha256, original.manifestSha256);
  assert.notEqual(changed.candidateCommitment, original.candidateCommitment);
});

test('a local Pack becomes a publication candidate only after exact non-destructive parent rebind', async () => {
  const local = project({ published: false });
  const localBefore = structuredClone(local);
  const publishedParent = parentMaker();
  const rebound = rebindExpansionPackProjectToPublishedRelease(local, publishedParent, {
    identityVerified: true,
    releaseId: '0xmaker-release-v7',
    versionId: 'maker-root-v7',
    versionNumber: '7',
    manifestBlobId: 'walrus-parent-quilt-v7',
    manifestHash: PARENT_HASH,
  });

  assert.deepEqual(local, localBefore);
  assert.equal(rebound.parentBinding.kind, 'published-release');
  assert.equal(rebound.publication.publishable, true);
  const candidate = await buildExpansionPackPublicationCandidate(rebound);
  assert.equal(candidate.readyForTransport, true);
  assert.equal(candidate.manifest.parent.manifestSha256, PARENT_HASH);
  assert.equal(candidate.manifest.parent.releaseId, '0xmaker-release-v7');
});

test('fails closed for local parents, incomplete published evidence and unhashed Pack assets', async () => {
  await assert.rejects(
    buildExpansionPackPublicationCandidate(project({ published: false })),
    (error) => error?.code === 'expansion-pack-parent-release-not-publishable',
  );
  assert.throws(() => createExpansionPackProject(parentMaker(), {
    packId: 'bad-parent',
    namespace: 'bad-parent',
    name: 'Bad parent',
    walletAddress: '0xabcd',
    parentRelease: {
      identityVerified: true,
      releaseId: '0xmaker-release-v7',
      versionId: 'maker-root-v7',
      manifestHash: PARENT_HASH,
    },
  }), (error) => error?.code === 'incomplete-published-parent-release');
  await assert.rejects(
    buildExpansionPackPublicationCandidate(project({ assetHash: 'not-a-sha256' })),
    (error) => error?.code === 'invalid-expansion-pack-content-hash',
  );
});
