import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPANSION_PACK_SCHEMA,
  checkExpansionPackCompatibility,
  compareMakerCompatibility,
  mergeExpansionPack,
  namespaceId,
  versionSatisfies,
} from '../expansion-packs.js';
import { createMakerRuleIndex, evaluateRecipe } from '../maker-rules.js';

function baseMaker() {
  return {
    schemaVersion: 'animacraft.maker.v4',
    version: {
      rootMakerId: 'astral-maker',
      versionId: 'astral-maker-v2',
      number: 2,
      parentVersionId: 'astral-maker-v1',
      compatibility: 'compatible',
      compatibleFrom: 1,
    },
    metadata: { id: 'astral-maker', name: 'Astral Maker' },
    canvas: { width: 1024, height: 1024, pixelMode: 'smooth' },
    layerTracks: [{ id: 'body-track', name: 'Body', order: 0 }],
    colorChannels: [],
    assets: [{ id: 'body-art', identifier: 'body-v2.png', contentHash: 'body-hash' }],
    parts: [{
      id: 'body',
      name: 'Body',
      menuOrder: 0,
      menuVisible: true,
      required: true,
      defaultItemId: 'body-default',
      parentPartId: null,
      requires: [],
      excludes: [],
      items: [{
        id: 'body-default',
        name: 'Default Body',
        displayOrder: 0,
        defaultVariantId: 'default',
        requires: [],
        excludes: [],
        variants: [{
          id: 'default',
          name: 'Default',
          displayOrder: 0,
          requires: [],
          excludes: [],
          layerBindings: [{
            id: 'body-binding',
            layerTrackId: 'body-track',
            assetId: 'body-art',
            colorChannelId: null,
            assetsBySwatch: [],
            transform: { x: 0, y: 0, scale: 1, rotation: 0 },
            opacity: 1,
            blendMode: 'normal',
            visibleWhen: null,
          }],
        }],
      }],
    }],
    defaultRecipe: {
      selections: [{ partId: 'body', itemId: 'body-default', variantId: 'default' }],
      colors: [],
    },
    rules: [],
    expansionPacks: [],
    assetsById: {},
  };
}

function moonPack() {
  return {
    schemaVersion: EXPANSION_PACK_SCHEMA,
    id: 'moon-pack',
    namespace: 'moon',
    version: '1.0.0',
    baseMakerId: 'astral-maker',
    baseMakerVersion: 2,
    assets: [
      { id: 'hat-art', identifier: 'moon/hat.png', contentHash: 'hat-hash' },
      { id: 'armor-art', identifier: 'moon/armor.png', contentHash: 'armor-hash' },
    ],
    layerTracks: [{ id: 'hat-track', name: 'Hat', order: 0 }],
    colorChannels: [],
    parts: [
      {
        extendsPartId: 'body',
        items: [{
          id: 'armored-body',
          name: 'Armored Body',
          displayOrder: 0,
          defaultVariantId: 'default',
          requires: [],
          excludes: [],
          variants: [{
            id: 'default',
            name: 'Default',
            displayOrder: 0,
            requires: [],
            excludes: [],
            layerBindings: [{
              id: 'armor-binding',
              layerTrackId: 'body-track',
              assetId: 'armor-art',
              colorChannelId: null,
              assetsBySwatch: [],
              transform: { x: 0, y: 0, scale: 1, rotation: 0 },
              opacity: 1,
              blendMode: 'normal',
              visibleWhen: null,
            }],
          }],
        }],
      },
      {
        id: 'hat',
        name: 'Hat',
        menuOrder: 0,
        menuVisible: true,
        required: false,
        defaultItemId: 'halo',
        parentPartId: 'body',
        requires: [],
        excludes: [],
        items: [{
          id: 'halo',
          name: 'Moon Halo',
          displayOrder: 0,
          defaultVariantId: 'default',
          requires: [{ scope: 'base', partId: 'body' }],
          excludes: [],
          variants: [{
            id: 'default',
            name: 'Default',
            displayOrder: 0,
            requires: [],
            excludes: [],
            layerBindings: [{
              id: 'halo-binding',
              layerTrackId: 'hat-track',
              assetId: 'hat-art',
              colorChannelId: null,
              assetsBySwatch: [],
              transform: { x: 0, y: 0, scale: 1, rotation: 0 },
              opacity: 1,
              blendMode: 'screen',
              visibleWhen: { op: 'selected', scope: 'base', partId: 'body', itemId: 'body-default' },
            }],
          }],
        }],
      },
    ],
    rules: [],
  };
}

test('supports exact, caret, tilde and comparator base version constraints', () => {
  assert.equal(versionSatisfies('2.4.1', '2.4.1'), true);
  assert.equal(versionSatisfies('2.4.1', '^2.0.0'), true);
  assert.equal(versionSatisfies('3.0.0', '^2.0.0'), false);
  assert.equal(versionSatisfies('2.4.1', '~2.4.0'), true);
  assert.equal(versionSatisfies('2.5.0', '~2.4.0'), false);
  assert.equal(versionSatisfies('2.4.1', '>=2.0.0 <3.0.0'), true);
});

test('namespaces pack definitions without mutating the base Maker', () => {
  const base = baseMaker();
  const snapshot = structuredClone(base);
  const result = checkExpansionPackCompatibility(base, moonPack());
  assert.equal(result.compatible, true, JSON.stringify(result.errors));
  const merged = result.merged;
  assert.deepEqual(base, snapshot);
  assert.equal(namespaceId('moon', 'hat'), 'moon__hat');
  assert.ok(merged.layerTracks.some((track) => track.id === 'moon__hat-track' && track.order === 1));
  assert.ok(merged.assets.some((asset) => asset.id === 'moon__hat-art'));
  assert.ok(merged.parts.some((part) => part.id === 'moon__hat' && part.parentPartId === 'body'));
  assert.ok(merged.parts.find((part) => part.id === 'body').items.some((item) => item.id === 'moon__armored-body'));
  const halo = merged.parts.find((part) => part.id === 'moon__hat').items[0];
  const binding = halo.variants[0].layerBindings[0];
  assert.equal(halo.id, 'moon__halo');
  assert.equal(halo.variants[0].id, 'moon__default');
  assert.equal(binding.layerTrackId, 'moon__hat-track');
  assert.equal(binding.assetId, 'moon__hat-art');
  assert.equal(binding.visibleWhen.partId, 'body');
  assert.equal(merged.installedExpansionPacks[0].packId, 'moon-pack');
  assert.doesNotThrow(() => createMakerRuleIndex(merged));
  assert.equal(evaluateRecipe(merged, merged.defaultRecipe).valid, true);
});

test('mergeExpansionPack returns the same additive runtime view as compatibility preflight', () => {
  const merged = mergeExpansionPack(baseMaker(), moonPack());
  assert.equal(merged.parts.length, 2);
  assert.equal(merged.parts[0].items.length, 2);
  assert.equal(merged.defaultRecipe.selections.length, 1);
});

test('can add a namespaced Variant to an existing base Item without replacing its default', () => {
  const pack = moonPack();
  pack.parts[0].items.push({
    extendsItemId: 'body-default',
    variants: [{
      id: 'moonlit',
      name: 'Moonlit',
      displayOrder: 0,
      requires: [],
      excludes: [],
      layerBindings: [{
        id: 'moonlit-binding',
        layerTrackId: 'body-track',
        assetId: 'armor-art',
        colorChannelId: null,
        assetsBySwatch: [],
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'screen',
        visibleWhen: null,
      }],
    }],
  });
  const merged = mergeExpansionPack(baseMaker(), pack);
  const item = merged.parts[0].items.find((candidate) => candidate.id === 'body-default');
  assert.equal(item.defaultVariantId, 'default');
  assert.deepEqual(item.variants.map((variant) => variant.id), ['default', 'moon__moonlit']);
  assert.equal(item.variants[1].layerBindings[0].assetId, 'moon__armor-art');
});

test('rejects wrong Maker identity, base version and required Pack Parts', () => {
  const wrongMaker = moonPack();
  wrongMaker.baseMakerId = 'other-maker';
  assert.ok(checkExpansionPackCompatibility(baseMaker(), wrongMaker).errors.some((issue) => issue.code === 'base-maker-mismatch'));

  const wrongVersion = moonPack();
  wrongVersion.baseMakerVersion = 3;
  assert.ok(checkExpansionPackCompatibility(baseMaker(), wrongVersion).errors.some((issue) => issue.code === 'base-version-mismatch'));

  const requiredPart = moonPack();
  requiredPart.parts[1].required = true;
  assert.ok(checkExpansionPackCompatibility(baseMaker(), requiredPart).errors.some((issue) => issue.code === 'pack-cannot-add-required-part'));
});

test('rejects an extension that attempts to modify base Part behavior', () => {
  const pack = moonPack();
  pack.parts[0].required = false;
  const result = checkExpansionPackCompatibility(baseMaker(), pack);
  assert.equal(result.compatible, false);
  assert.ok(result.errors.some((issue) => issue.code === 'pack-modifies-base-part' && issue.field === 'required'));
});

test('rejects a Pack requires-rule that would make an old base recipe depend on Pack content', () => {
  const pack = moonPack();
  pack.rules.push({
    id: 'base-needs-hat',
    type: 'requires',
    trigger: { scope: 'base', partId: 'body', itemId: 'body-default' },
    targets: [{ scope: 'pack', partId: 'hat', itemId: 'halo' }],
  });
  const result = checkExpansionPackCompatibility(baseMaker(), pack);
  assert.equal(result.compatible, false);
  assert.ok(result.errors.some((issue) => issue.code === 'pack-rule-breaks-base-recipe'));
});

test('reports an additive Maker update as compatible', () => {
  const previous = baseMaker();
  const next = structuredClone(previous);
  next.version = { ...next.version, versionId: 'astral-maker-v3', number: 3, parentVersionId: 'astral-maker-v2' };
  next.assets.push({ id: 'body-alt-art', identifier: 'body-alt.png', contentHash: 'alt-hash' });
  next.parts[0].items.push({
    id: 'body-alt',
    name: 'Alternate Body',
    displayOrder: 1,
    defaultVariantId: 'default',
    requires: [],
    excludes: [],
    variants: [{
      id: 'default',
      name: 'Default',
      displayOrder: 0,
      requires: [],
      excludes: [],
      layerBindings: [{
        id: 'body-alt-binding',
        layerTrackId: 'body-track',
        assetId: 'body-alt-art',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'normal',
      }],
    }],
  });
  const result = compareMakerCompatibility(previous, next);
  assert.equal(result.compatible, true, JSON.stringify(result.breaking));
  assert.equal(result.recommendedVersionBump, 'minor');
  assert.ok(result.additions.some((change) => change.code === 'item-added'));
});

test('reports removed recipe ids and rendering changes as pinned-version breaks', () => {
  const previous = baseMaker();
  const next = structuredClone(previous);
  next.version = { ...next.version, versionId: 'astral-maker-v3', number: 3, parentVersionId: 'astral-maker-v2' };
  next.parts[0].items[0].variants[0].layerBindings[0].transform.x = 12;
  next.assets[0].contentHash = 'new-body-hash';
  const result = compareMakerCompatibility(previous, next);
  assert.equal(result.compatible, false);
  assert.equal(result.requiresPinnedVersion, true);
  assert.equal(result.renderCompatible, false);
  assert.ok(result.breaking.some((change) => change.code === 'variant-rendering-changed'));
  assert.ok(result.breaking.some((change) => change.code === 'asset-content-changed'));
});

test('reports constraints added to old content as recipe-breaking', () => {
  const previous = baseMaker();
  const next = structuredClone(previous);
  next.version = { ...next.version, versionId: 'astral-maker-v3', number: 3, parentVersionId: 'astral-maker-v2' };
  next.parts[0].items[0].excludes.push({ partId: 'body', itemId: 'body-default' });
  const result = compareMakerCompatibility(previous, next);
  assert.equal(result.recipeCompatible, false);
  assert.ok(result.breaking.some((change) => change.code === 'constraint-added-for-old-content'));
});
