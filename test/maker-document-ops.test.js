import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDocumentAsset,
  createGradientColorChannel,
  createItem,
  createLayerBinding,
  createLayerTrack,
  createPart,
  duplicatePart,
  findBinding,
  findItem,
  findPart,
  findVariant,
  moveArrayEntry,
  normalizeDocumentOrders,
  recipeSelectionMap,
  removeUnreferencedAssetMetadata,
  replaceRecipeSelection,
  synchronizeDefaultRecipe,
  uniqueDocumentId,
} from '../maker-document-ops.js';

function emptyDocument() {
  return {
    metadata: { coverAssetId: null },
    layerTracks: [],
    colorChannels: [],
    parts: [],
    assets: [],
    defaultRecipe: { selections: [], colors: [] },
  };
}

function playableDocument() {
  const document = emptyDocument();
  const track = createLayerTrack(document, 'Body Layer');
  document.layerTracks.push(track);
  const part = createPart(document, 'Body');
  const item = createItem(part, 'Default Body');
  const binding = createLayerBinding(item.variants[0], track.id, 'body-art');
  item.variants[0].layerBindings.push(binding);
  part.items.push(item);
  part.defaultItemId = item.id;
  document.parts.push(part);
  document.assets.push({ id: 'body-art', identifier: 'body.png' });
  synchronizeDefaultRecipe(document);
  return document;
}

test('creates URL-safe unique ids and complete editor records', () => {
  assert.equal(uniqueDocumentId('Café Hair!', [{ id: 'cafe-hair' }]), 'cafe-hair-2');
  const document = emptyDocument();
  document.layerTracks.push(createLayerTrack(document, 'Hair Back'));
  document.layerTracks.push(createLayerTrack(document, 'Hair Back'));
  document.parts.push(createPart(document, 'Hair'));
  document.parts.push(createPart(document, 'Hair'));
  assert.deepEqual(document.layerTracks.map((track) => track.id), ['hair-back', 'hair-back-2']);
  assert.deepEqual(document.parts.map((part) => part.id), ['hair', 'hair-2']);
  const item = createItem(document.parts[0], 'Long Hair');
  assert.equal(item.defaultVariantId, 'default');
  assert.equal(item.variants.length, 1);
  assert.deepEqual(item.variants[0].requires, []);
});
test('creates finite uniform layer bindings and gradient channels', () => {
  const document = emptyDocument();
  const channel = createGradientColorChannel(document, 'Hair Color');
  assert.equal(channel.mode, 'gradient-map');
  assert.deepEqual(channel.swatches[0].stops.map((stop) => stop.offset), [0, 0.5, 1]);
  const binding = createLayerBinding({ layerBindings: [] }, 'hair-front', 'hair-art', {
    x: 12,
    y: -8,
    scaleX: 1.25,
    rotation: 5,
  });
  assert.deepEqual(binding.transform, { x: 12, y: -8, scale: 1.25, rotation: 5 });
  assert.equal(binding.opacity, 1);
  assert.equal(binding.blendMode, 'normal');
});

test('adds and replaces public asset metadata by stable asset id', () => {
  const document = emptyDocument();
  const blob = new Blob(['png'], { type: 'image/png' });
  const first = addDocumentAsset(document, { assetId: 'hair-art', fileName: 'Hair Art.PNG', blob, width: 512, height: 768 });
  assert.deepEqual(first, {
    id: 'hair-art',
    identifier: 'hair-art-png.png',
    kind: 'layer',
    mediaType: 'image/png',
    width: 512,
    height: 768,
  });
  addDocumentAsset(document, { assetId: 'hair-art', identifier: 'walrus/hair.png', kind: 'thumbnail', mediaType: 'image/webp' });
  assert.equal(document.assets.length, 1);
  assert.equal(document.assets[0].identifier, 'walrus/hair.png');
  assert.equal(document.assets[0].kind, 'thumbnail');
});

test('normalizes every independent menu, item, variant, track and color order', () => {
  const document = playableDocument();
  const secondPart = createPart(document, 'Hair');
  secondPart.items.push(createItem(secondPart, 'B'), createItem(secondPart, 'A'));
  secondPart.items[0].variants.push({ ...secondPart.items[0].variants[0], id: 'second' });
  document.parts.unshift(secondPart);
  document.layerTracks.unshift(createLayerTrack(document, 'Front'));
  document.colorChannels.push(createGradientColorChannel(document, 'One'), createGradientColorChannel(document, 'Two'));
  normalizeDocumentOrders(document);
  assert.deepEqual(document.parts.map((part) => part.menuOrder), [0, 1]);
  assert.deepEqual(secondPart.items.map((item) => item.displayOrder), [0, 1]);
  assert.deepEqual(secondPart.items[0].variants.map((variant) => variant.displayOrder), [0, 1]);
  assert.deepEqual(document.layerTracks.map((track) => track.order), [0, 1]);
  assert.deepEqual(document.colorChannels.map((channel) => channel.order), [0, 1]);
});

test('moves valid array entries in place and ignores unsafe indexes', () => {
  const entries = ['a', 'b', 'c'];
  assert.equal(moveArrayEntry(entries, 0, 2), entries);
  assert.deepEqual(entries, ['b', 'c', 'a']);
  moveArrayEntry(entries, -1, 1);
  moveArrayEntry(entries, 0, 3);
  assert.deepEqual(entries, ['b', 'c', 'a']);
});

test('find helpers resolve the exact nested editor record', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const item = part.items[0];
  const variant = item.variants[0];
  const binding = variant.layerBindings[0];
  assert.equal(findPart(document, part.id), part);
  assert.equal(findItem(document, part.id, item.id), item);
  assert.equal(findVariant(document, part.id, item.id, variant.id), variant);
  assert.equal(findBinding(document, part.id, item.id, variant.id, binding.id), binding);
  assert.equal(findBinding(document, part.id, item.id, variant.id, 'missing'), null);
});

test('keeps every referenced asset kind and prunes only unreachable metadata', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const item = part.items[0];
  const binding = item.variants[0].layerBindings[0];
  document.metadata.coverAssetId = 'cover';
  part.iconAssetId = 'part-icon';
  item.thumbnailAssetId = 'thumbnail';
  binding.assetsBySwatch = [{ swatchId: 'dark', assetId: 'dark-art' }];
  document.assets.push(
    { id: 'cover' },
    { id: 'part-icon' },
    { id: 'thumbnail' },
    { id: 'dark-art' },
    { id: 'orphan' },
  );
  assert.deepEqual(removeUnreferencedAssetMetadata(document), ['orphan']);
  assert.deepEqual(new Set(document.assets.map((asset) => asset.id)), new Set(['body-art', 'cover', 'part-icon', 'thumbnail', 'dark-art']));
});

test('synchronizes valid defaults while retaining existing playable choices', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const alternate = createItem(part, 'Alternate');
  part.items.push(alternate);
  const channel = createGradientColorChannel(document, 'Skin');
  channel.swatches.push({ id: 'cool', name: 'Cool', hintColor: '#ffffff', stops: [] });
  document.colorChannels.push(channel);
  document.defaultRecipe = {
    selections: [{ partId: part.id, itemId: alternate.id, variantId: alternate.defaultVariantId }],
    colors: [{ channelId: channel.id, swatchId: 'cool' }],
  };
  const recipe = synchronizeDefaultRecipe(document);
  assert.equal(recipe.selections[0].itemId, alternate.id);
  assert.equal(recipe.colors[0].swatchId, 'cool');
});

test('repairs stale default ids to the fallback records it selected', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const item = part.items[0];
  const channel = createGradientColorChannel(document, 'Skin');
  document.colorChannels.push(channel);
  part.defaultItemId = 'deleted-item';
  item.defaultVariantId = 'deleted-variant';
  channel.defaultSwatchId = 'deleted-swatch';
  document.defaultRecipe = {
    selections: [{ partId: part.id, itemId: 'also-deleted', variantId: 'also-deleted' }],
    colors: [{ channelId: channel.id, swatchId: 'also-deleted' }],
  };
  synchronizeDefaultRecipe(document);
  assert.equal(part.defaultItemId, item.id);
  assert.equal(item.defaultVariantId, item.variants[0].id);
  assert.equal(channel.defaultSwatchId, channel.swatches[0].id);
});

test('duplicates a Part deeply, resets hierarchy and preserves valid internal defaults', () => {
  const document = playableDocument();
  const source = document.parts[0];
  source.parentPartId = 'parent';
  const duplicate = duplicatePart(document, source.id);
  assert.notEqual(duplicate, source);
  assert.equal(duplicate.id, 'body-copy');
  assert.equal(duplicate.parentPartId, null);
  assert.equal(duplicate.defaultItemId, duplicate.items[0].id);
  assert.equal(duplicate.items[0].defaultVariantId, duplicate.items[0].variants[0].id);
  duplicate.items[0].name = 'Changed copy';
  assert.notEqual(source.items[0].name, duplicate.items[0].name);
  assert.deepEqual(document.parts.map((part) => part.menuOrder), [0, 1]);
});

test('updates and removes recipe selections without introducing duplicate Parts', () => {
  const recipe = { selections: [{ partId: 'body', itemId: 'one' }], colors: [] };
  replaceRecipeSelection(recipe, { partId: 'body', itemId: 'two', variantId: 'default' });
  replaceRecipeSelection(recipe, { partId: 'hair', itemId: 'long' });
  assert.equal(recipeSelectionMap(recipe).get('body').itemId, 'two');
  assert.equal(recipe.selections.length, 2);
  replaceRecipeSelection(recipe, { partId: 'body', itemId: '' });
  assert.deepEqual(recipe.selections, [{ partId: 'hair', itemId: 'long' }]);
});
