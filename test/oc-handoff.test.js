import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLivingContent, soulidityContentManifest } from '../living-content.js';
import { synchronizeDefaultRecipe } from '../maker-document-ops.js';
import {
  buildMakerV4OcPackage,
  buildMakerV4OcUploadEntries,
} from '../maker-publication-v4.js';
import { createCharacterMakerV5Starter } from '../maker-v4.js';
import {
  canonicalOcPackageFingerprint,
  certifiedLivingContentSource,
  createPlayerCompletionSnapshot,
} from '../oc-handoff.js';

function playableMaker() {
  const document = createCharacterMakerV5Starter({
    makerId: 'handoff-maker',
    name: 'Handoff Maker',
    creator: 'Soul Atelier',
  });
  Object.assign(document.metadata, {
    summary: 'A production handoff fixture.',
    coverAssetId: 'cover',
  });
  document.metadata.license.note = 'Personal use.';
  document.assets.push({
    id: 'cover',
    identifier: 'cover.png',
    kind: 'maker-cover',
    mediaType: 'image/png',
    width: document.canvas.width,
    height: document.canvas.height,
    url: 'memory://cover',
  });
  document.parts.forEach((part, index) => {
    const item = part.items[0];
    const style = item.styles[0];
    style.assetId = `art-${index}`;
    style.layerTrackId = document.layerTracks[index].id;
    style.positionConfirmed = true;
    item.status = 'public';
    document.assets.push({
      id: style.assetId,
      identifier: `${style.assetId}.png`,
      kind: 'layer',
      mediaType: 'image/png',
      width: document.canvas.width,
      height: document.canvas.height,
      url: `memory://${style.assetId}`,
    });
  });
  synchronizeDefaultRecipe(document);
  return document;
}

test('Player completion snapshot becomes the exact Walrus OC profile and certified handoff source', async () => {
  const document = playableMaker();
  const profile = {
    name: 'Mira',
    world: 'Astral Courier',
    description: 'A calm courier between worlds.',
    tags: ['starlight', 'courier'],
  };
  const resolvedLivingContent = resolveLivingContent(document.livingContent, {
    maker: document.metadata,
    profile,
  });
  const completion = createPlayerCompletionSnapshot({
    document,
    recipe: document.defaultRecipe,
    profile,
    livingContent: resolvedLivingContent,
  });
  assert.equal(Object.isFrozen(completion), true);
  assert.equal(Object.isFrozen(completion.recipe), true);
  assert.equal(Object.isFrozen(completion.profile), true);
  assert.equal(Object.isFrozen(completion.livingContent), true);
  assert.equal(Object.isFrozen(completion.livingContent.content), true);
  const livingContent = soulidityContentManifest(completion.livingContent, {
    maker: document.metadata,
    makerId: '0x123',
    profile: completion.profile,
  });
  const bridge = buildMakerV4OcPackage({
    document,
    recipe: completion.recipe,
    profile: completion.profile,
    livingContent,
    makerObjectId: '0x123',
    manifestBlobId: 'certified-maker-quilt',
    createdAt: '2026-07-27T12:00:00.000Z',
    integrity: {
      recipeEncoding: 'BCS vector<RecipeSlot>',
      recipeHashAlgorithm: 'SHA-256',
      recipeHash: 'ab'.repeat(32),
    },
  });
  const entries = buildMakerV4OcUploadEntries(
    new Blob(['png'], { type: 'image/png' }),
    bridge,
  );
  const uploadedProfile = JSON.parse(await entries[1].blob.text());

  assert.deepEqual(uploadedProfile.recipe, bridge.fullRecipe);
  assert.deepEqual(uploadedProfile.profile, completion.profile);
  assert.deepEqual(
    certifiedLivingContentSource(uploadedProfile),
    completion.livingContent,
  );
  assert.match(uploadedProfile.livingContent.content.soulMd, /Mira/);
  assert.match(uploadedProfile.livingContent.content.memoryMd, /calm courier between worlds/);
  assert.equal(uploadedProfile.maker.manifestBlobId, 'certified-maker-quilt');
});

test('canonical OC fingerprint covers provenance, integrity and every Living Content document', () => {
  const base = {
    schemaVersion: 'animacraft.oc-package.v2',
    maker: {
      versionId: 'maker-v1',
      manifestBlobId: 'quilt-v1',
    },
    profile: { name: 'Mira' },
    livingContent: {
      content: {
        soulMd: '# Soul',
        memoryMd: '# Memory',
        skillMd: '---\nname: mira\n---\n# Skill',
      },
    },
    recipe: { selections: [], colors: [] },
    suiSummary: { recipe: [] },
    integrity: { recipeHash: '11'.repeat(32) },
  };
  const fingerprint = canonicalOcPackageFingerprint(base);
  const reordered = {
    integrity: base.integrity,
    suiSummary: base.suiSummary,
    recipe: base.recipe,
    livingContent: base.livingContent,
    profile: base.profile,
    maker: base.maker,
    schemaVersion: base.schemaVersion,
  };
  assert.equal(canonicalOcPackageFingerprint(reordered), fingerprint);

  for (const mutate of [
    (value) => { value.maker.versionId = 'maker-v2'; },
    (value) => { value.maker.manifestBlobId = 'quilt-v2'; },
    (value) => { value.integrity.recipeHash = '22'.repeat(32); },
    (value) => { value.livingContent.content.soulMd = '# Changed Soul'; },
    (value) => { value.livingContent.content.memoryMd = '# Changed Memory'; },
    (value) => { value.livingContent.content.skillMd = '---\nname: changed\n---\n# Skill'; },
  ]) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.notEqual(canonicalOcPackageFingerprint(changed), fingerprint);
  }
});

test('certified handoff rejects an OC package without all three resolved documents', () => {
  assert.throws(
    () => certifiedLivingContentSource({
      livingContent: { content: { soulMd: '# Soul', memoryMd: '# Memory' } },
    }),
    /skillMd/,
  );
});
