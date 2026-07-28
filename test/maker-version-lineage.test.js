import assert from 'node:assert/strict';
import test from 'node:test';

import { findMakerVersionDraftConflict } from '../maker-version-lineage.js';

function documentVersion(versionId, number, parentVersionId = null) {
  return {
    version: {
      versionId,
      number,
      parentVersionId,
    },
  };
}

test('a competing on-chain object blocks a local draft even when both use the same deterministic version ID', () => {
  const publishedDocument = documentVersion('maker-v1', 1);
  const workingDocument = documentVersion('maker-v2', 2, 'maker-v1');
  const externalV2 = {
    versionId: 'maker-v2',
    parentVersionId: 'maker-v1',
    versionNumber: 2,
    makerObjectId: '0xexternal-v2',
  };

  const conflict = findMakerVersionDraftConflict({
    workingDocument,
    publishedDocument,
    currentMakerObjectId: '0xpublished-v1',
    publishedVersions: [
      {
        versionId: 'maker-v1',
        parentVersionId: '',
        versionNumber: 1,
        makerObjectId: '0xpublished-v1',
      },
      externalV2,
    ],
  });

  assert.deepEqual(conflict, externalV2);
});

test('the currently published object is not mistaken for a competing draft', () => {
  const publishedDocument = documentVersion('maker-v1', 1);
  const workingDocument = documentVersion('maker-v2', 2, 'maker-v1');

  assert.equal(findMakerVersionDraftConflict({
    workingDocument,
    publishedDocument,
    currentMakerObjectId: '0xpublished-v1',
    publishedVersions: [{
      versionId: 'maker-v1',
      parentVersionId: '',
      versionNumber: 1,
      makerObjectId: '0xpublished-v1',
    }],
  }), null);
});

test('a later descendant also makes an older local successor draft stale', () => {
  const descendant = {
    versionId: 'maker-v3',
    parentVersionId: 'maker-v2',
    versionNumber: 3,
    makerObjectId: '0xexternal-v3',
  };
  const conflict = findMakerVersionDraftConflict({
    workingDocument: documentVersion('maker-v2', 2, 'maker-v1'),
    publishedDocument: documentVersion('maker-v1', 1),
    currentMakerObjectId: '0xpublished-v1',
    publishedVersions: [descendant],
  });

  assert.deepEqual(conflict, descendant);
});

test('a CreatorProfile-listed successor still conflicts after its AdminCap was transferred', () => {
  const profileListedWithoutCap = {
    versionId: 'maker-v2',
    parentVersionId: 'maker-v1',
    versionNumber: 2,
    makerObjectId: '0xprofile-listed-v2',
    makerAdminCapObjectId: '',
    profilePublished: true,
  };

  assert.deepEqual(findMakerVersionDraftConflict({
    workingDocument: documentVersion('maker-v2', 2, 'maker-v1'),
    publishedDocument: documentVersion('maker-v1', 1),
    currentMakerObjectId: '0xowned-v1',
    publishedVersions: [profileListedWithoutCap],
  }), profileListedWithoutCap);
});
