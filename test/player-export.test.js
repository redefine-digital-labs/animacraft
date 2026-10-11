import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLAYER_ORIGINAL_EXPORT_MAX_PIXELS,
  calculatePlayerExportSize,
  isPlayerOriginalExportSafe,
  safePngFilename,
  buildPlayerShareUrl,
} from '../player-export.js';

test('standard export fits the longest edge to 1024 without upscaling', () => {
  assert.deepEqual(
    calculatePlayerExportSize({ width: 2_048, height: 1_024 }),
    { mode: 'standard', width: 1_024, height: 512, scale: 0.5 },
  );
  assert.deepEqual(
    calculatePlayerExportSize({ width: 800, height: 1_200 }),
    {
      mode: 'standard',
      width: 683,
      height: 1_024,
      scale: 1_024 / 1_200,
    },
  );
  assert.deepEqual(
    calculatePlayerExportSize({ width: 512, height: 256 }),
    { mode: 'standard', width: 512, height: 256, scale: 1 },
  );
});

test('original export preserves safe Maker dimensions and rejects unsafe allocations in Player UI', () => {
  assert.deepEqual(
    calculatePlayerExportSize({ width: 4_096, height: 2_048 }, { mode: 'original' }),
    { mode: 'original', width: 4_096, height: 2_048, scale: 1 },
  );
  assert.equal(isPlayerOriginalExportSafe({ width: 4_096, height: 2_048 }), true);
  assert.equal(isPlayerOriginalExportSafe({ width: 4_096, height: 4_096 }), false);
  assert.equal(isPlayerOriginalExportSafe({ width: 8_192, height: 8_192 }), false);
  assert.equal(PLAYER_ORIGINAL_EXPORT_MAX_PIXELS, 8_388_608);
  assert.throws(
    () => calculatePlayerExportSize({ width: 0, height: 1_024 }),
    /canvas\.width must be a positive integer/,
  );
  assert.throws(
    () => calculatePlayerExportSize({ width: 1_024, height: 1_024 }, { mode: 'hd' }),
    /mode must be standard or original/,
  );
});

test('PNG filenames remain readable while blocking paths, controls and reserved names', () => {
  assert.equal(safePngFilename('星夜信使 Mira.png'), '星夜信使 Mira.png');
  assert.equal(safePngFilename('../../Mira:*?\\portrait.PNG'), 'Mira-portrait.png');
  assert.equal(safePngFilename('CON'), '_CON.png');
  assert.equal(safePngFilename('\u0000  '), 'animacraft-oc.png');
  assert.equal(safePngFilename('Mira', { maxBaseBytes: 3 }), 'Mir.png');
});

test('Maker sharing uses the real public route and never serializes private Player data', () => {
  const privateText = 'NEVER-SHARE-THIS-MEMORY';
  const url = buildPlayerShareUrl({
    baseUrl: 'https://animacraft.soulidity.ai/',
    makerId: '0x047b7924be3cf1ce0dcab6d5c3a88268',
    versionId: 'ignored-version',
    recipe: { profile: privateText, soulMd: privateText },
    profile: { name: privateText },
    livingContent: { memoryMd: privateText },
  });

  assert.equal(
    url,
    'https://animacraft.soulidity.ai/maker/0x047b7924be3cf1ce0dcab6d5c3a88268',
  );
  assert.equal(url.includes(privateText), false);
  assert.equal(new URL(url).search, '');
});

test('Maker sharing rejects unsafe routes and embedded credentials', () => {
  assert.throws(
    () => buildPlayerShareUrl({
      baseUrl: 'https://animacraft.soulidity.ai',
      makerId: '../maker',
    }),
    /makerId must be a URL-safe Animacraft ID/,
  );
  assert.throws(
    () => buildPlayerShareUrl({
      baseUrl: 'https://user:password@animacraft.soulidity.ai',
      makerId: 'safe-maker',
    }),
    /without embedded credentials/,
  );
});
