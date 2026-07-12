import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ANGIE_FIXTURE_CLASSIFICATION,
  AngieImportError,
  buildAngieV4StressFixture,
  resolveDefaultAngieReleaseRoot,
} from '../scripts/import-angie-v4.mjs';
import { validateMakerV4Document } from '../maker-v4.js';

const ANGIE_ROOT = resolveDefaultAngieReleaseRoot(fileURLToPath(new URL('../', import.meta.url)));
const ANGIE_AVAILABLE = existsSync(resolve(ANGIE_ROOT, 'animacraft-manifest.json'));

test('imports Astral Courier as a marked v4 negative stress fixture', { skip: !ANGIE_AVAILABLE }, async () => {
  const { manifest, report } = await buildAngieV4StressFixture({
    sourceRoot: ANGIE_ROOT,
    attachLocalPaths: false,
  });

  assert.equal(validateMakerV4Document(manifest), manifest);
  assert.equal(manifest.schemaVersion, 'animacraft.maker.v4');
  assert.equal(manifest.extensions.stressTest.classification, ANGIE_FIXTURE_CLASSIFICATION);
  assert.equal(manifest.extensions.stressTest.doNotPublish, true);
  assert.equal(manifest.extensions.stressTest.doNotUseAsVisualGold, true);
  assert.equal(manifest.publication.mintingEnabled, false);
  assert.match(manifest.metadata.name, /^\[Stress Fixture\]/);
  assert.equal(report.summary.partCount, 6);
  assert.equal(report.summary.itemCount, 25);
  assert.equal(report.summary.assetCount, 26);
  assert.equal(report.summary.errorCount, 0);
  assert.ok(manifest.assets.every((asset) => !asset.localPath && !asset.url));

  const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));
  assert.ok(codes.has('empty-alpha-placeholder'));
  assert.ok(codes.has('internal-alignment-spread'));
  assert.ok(codes.has('single-composite-layer'));
  assert.ok(codes.has('cover-provenance-unverified'));
  const baseDrift = report.diagnostics.find((diagnostic) => diagnostic.code === 'internal-alignment-spread' && diagnostic.partId === 'base');
  assert.equal(baseDrift.spreadX, 34.5);
  assert.equal(baseDrift.spreadY, 30);
  assert.ok(report.assetMetrics.every((asset) => asset.width === 1024 && asset.height === 1024 && asset.sha256.length === 64));
});

test('rejects a v3 asset identifier that escapes the release directory', async (t) => {
  const releaseRoot = await mkdtemp(resolve(tmpdir(), 'angie-import-'));
  t.after(() => rm(releaseRoot, { recursive: true, force: true }));
  const manifest = {
    schemaVersion: 'animacraft.creator-template.v3',
    template: {
      id: 'unsafe-maker',
      name: 'Unsafe Maker',
      summary: 'Traversal fixture.',
      creator: 'Test',
      style: 'Test',
      license: 'personal-use',
      licenseNote: 'Test only.',
      canvas: { width: 1024, height: 1024 },
      coverIdentifier: '../escape.png',
    },
    runtime: {},
    parts: [{
      key: 'base',
      label: 'Base',
      kind: 'last-bastion',
      menuVisible: true,
      allowRemove: false,
      defaultItemId: 'normal',
      iconIdentifier: '',
      layers: [{ id: 'normal', name: 'Normal', renderOrder: 0, x: 0, y: 0, opacity: 100, blendMode: 'normal' }],
      colors: [{ id: 'original', name: 'Original', value: '#7b5cff' }],
      items: [{
        id: 'normal',
        label: 'Normal',
        displayOrder: 1,
        visibility: 'public',
        iconIdentifier: '',
        images: [{ layerId: 'normal', colorId: 'original', identifier: '../escape.png' }],
      }],
    }],
    rules: [],
    paletteLinks: [],
    assets: [{ identifier: '../escape.png', type: 'image/png' }],
  };
  await writeFile(resolve(releaseRoot, 'animacraft-manifest.json'), `${JSON.stringify(manifest)}\n`);

  await assert.rejects(
    () => buildAngieV4StressFixture({ sourceRoot: releaseRoot }),
    (error) => error instanceof AngieImportError && error.code === 'unsafe-asset-identifier',
  );
});
