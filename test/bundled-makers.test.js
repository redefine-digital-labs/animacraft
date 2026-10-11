import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { validateRemoteMakerManifest } from '../manifest-validation.js';
import { validateMakerV5Document } from '../maker-v4.js';

const ROOT = new URL('../public/makers/', import.meta.url);
const MAKERS = ['astral-courier', 'hanamori-spirit'];

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

for (const makerId of MAKERS) {
  test(`bundled ${makerId} is a complete runtime Maker`, async () => {
    const makerRoot = new URL(`${makerId}/`, ROOT);
    const manifest = JSON.parse(await readFile(new URL('animacraft-manifest.json', makerRoot), 'utf8'));
    validateRemoteMakerManifest(manifest);

    assert.equal(manifest.parts.length, 6);
    assert.equal(manifest.parts.reduce((total, part) => total + part.items.length, 0), 25);
    assert.equal(manifest.parts.reduce((total, part) => total * part.items.length, 1), 5_120);
    assert.equal(manifest.disclosure.aiAssisted, true);
    assert.equal(
      manifest.template.mintingEnabled,
      false,
      'AI-assisted stress fixtures must stay non-mintable until human visual sign-off',
    );
    assert.match(manifest.template.summary, /stress fixture/i);
    const accessory = manifest.parts.find((part) => part.key === 'accessory');
    assert.equal(accessory.allowRemove, false, 'the explicit None Item must be the only remove choice');
    assert.equal(accessory.items.filter((item) => item.id === 'none').length, 1);

    await Promise.all(manifest.assets.map(async (asset) => {
      const fileUrl = new URL(asset.identifier, makerRoot);
      assert.ok(fileUrl.href.startsWith(makerRoot.href), `${asset.identifier} escapes its Maker directory`);
      const [file, metadata] = await Promise.all([readFile(fileUrl), stat(fileUrl)]);
      assert.equal(metadata.size, asset.size, `${asset.identifier} size drifted from the manifest`);
      assert.equal(asset.type, 'image/png');
      const dimensions = pngDimensions(file);
      assert.deepEqual([dimensions.width, dimensions.height], [1024, 1024], asset.identifier);
      assert.equal(dimensions.colorType, 6, `${asset.identifier} must be RGBA PNG`);
    }));
  });

  test(`bundled ${makerId} has a playable, non-publishable v5 stress fixture`, async () => {
    const makerRoot = new URL(`${makerId}/`, ROOT);
    const manifest = JSON.parse(await readFile(new URL('animacraft-maker-v5.json', makerRoot), 'utf8'));
    validateMakerV5Document(manifest, { mode: 'publish' });

    assert.equal(manifest.extensions.stressTest.doNotPublish, true);
    assert.equal(manifest.extensions.stressTest.doNotUseAsVisualGold, true);
    assert.equal(manifest.publication.mintingEnabled, false);
    assert.equal(manifest.parts.length, 6);
    assert.equal(manifest.parts.reduce((total, part) => total + part.items.length, 0), 25);
    assert.equal(manifest.parts.reduce(
      (total, part) => total + part.items.reduce((itemTotal, item) => itemTotal + item.styles.length, 0),
      0,
    ), 25);

    await Promise.all(manifest.assets.map(async (asset) => {
      const fileUrl = new URL(asset.identifier, makerRoot);
      assert.ok(fileUrl.href.startsWith(makerRoot.href), `${asset.identifier} escapes its Maker directory`);
      const file = await readFile(fileUrl);
      assert.equal(file.length, asset.byteLength, `${asset.identifier} byte length drifted`);
      assert.equal(createHash('sha256').update(file).digest('hex'), asset.sha256, `${asset.identifier} hash drifted`);
    }));
  });
}
