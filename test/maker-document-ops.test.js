import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDocumentAsset,
  createGradientColorChannel,
  createItem,
  createLayerTrack,
  createPart,
  createStyle,
  duplicateItem,
  duplicatePart,
  duplicateStyle,
  effectiveStyleTransform,
  findItem,
  findPart,
  findStyle,
  moveArrayEntry,
  normalizeDocumentOrders,
  recipeSelectionMap,
  removeUnreferencedAssetMetadata,
  replaceRecipeSelection,
  synchronizeDefaultRecipe,
  uniqueDocumentId,
} from '../maker-document-ops.js';
import { createMakerV5Document } from '../maker-v4.js';

function emptyDocument() {
  return createMakerV5Document({ makerId: 'ops-maker', name: 'Ops Maker' });
}

function playableDocument() {
  const document = emptyDocument();
  const track = createLayerTrack(document, 'Body Layer');
  document.layerTracks.push(track);
  const part = createPart(document, 'Body');
  const item = createItem(part, 'Default Body');
  const selectedStyle = item.styles[0];
  selectedStyle.layerTrackId = track.id;
  selectedStyle.assetId = 'body-art';
  part.items.push(item);
  part.defaultItemId = item.id;
  document.parts.push(part);
  document.assets.push({ id: 'body-art', identifier: 'body.png' });
  synchronizeDefaultRecipe(document);
  return document;
}

test('creates URL-safe ids and gives every new Item one empty default Style', () => {
  assert.equal(uniqueDocumentId('Café Hair!', [{ id: 'cafe-hair' }]), 'cafe-hair-2');
  const document = emptyDocument();
  document.layerTracks.push(createLayerTrack(document, 'Hair Back'));
  document.layerTracks.push(createLayerTrack(document, 'Hair Back'));
  document.parts.push(createPart(document, 'Hair'));
  document.parts.push(createPart(document, 'Hair'));
  assert.deepEqual(document.layerTracks.map((track) => track.id), ['hair-back', 'hair-back-2']);
  assert.ok(document.layerTracks.every((track) => !Object.hasOwn(track, 'transform')));
  assert.ok(document.layerTracks.every((track) => track.locked === false));
  assert.deepEqual(document.parts.map((part) => part.id), ['hair', 'hair-2']);

  const item = createItem(document.parts[0], 'Long Hair');
  assert.equal(item.styles.length, 1);
  assert.equal(item.defaultStyleId, item.styles[0].id);
  assert.equal(item.styles[0].name, 'Default Style');
  assert.equal(item.styles[0].assetId, null);
  assert.equal(item.styles[0].layerTrackId, null);
  assert.equal(item.status, 'public');

  const selectedStyle = createStyle(item, 'Pure Black');
  assert.equal(item.styles.length, 1, 'creating an additional Style does not mutate the Item until it is added');
  assert.notEqual(selectedStyle, item.styles[0]);
  assert.notEqual(selectedStyle.transform, item.styles[0].transform);
  assert.notEqual(selectedStyle.requires, item.styles[0].requires);
  assert.equal(selectedStyle.displayOrder, 1);
  assert.equal(selectedStyle.assetId, null);
  assert.equal(selectedStyle.layerTrackId, null);
  assert.deepEqual(selectedStyle.transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.equal(selectedStyle.positionLocked, false);
  assert.equal(selectedStyle.styleLocked, false);
});

test('creates gradient channels with a usable default swatch', () => {
  const channel = createGradientColorChannel(emptyDocument(), 'Hair Color');
  assert.equal(channel.mode, 'gradient-map');
  assert.equal(channel.defaultSwatchId, 'default');
  assert.deepEqual(channel.swatches[0].stops.map((stop) => stop.offset), [0, 0.5, 1]);
});

test('keeps every Style transform independent even when Styles share one Layer Track', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const firstStyle = part.items[0].styles[0];
  firstStyle.transform = { x: 24, y: -12, scale: 1.2, rotation: 3 };

  const second = createItem(part, 'Alternate Body');
  const secondStyle = second.styles[0];
  secondStyle.layerTrackId = document.layerTracks[0].id;
  secondStyle.assetId = 'alternate-art';
  secondStyle.transform = { x: 400, y: 500, scale: 2, rotation: 0 };
  part.items.push(second);

  assert.deepEqual(part.items.map((item) => effectiveStyleTransform(document, item.styles[0])), [
    { x: 24, y: -12, scale: 1.2, rotation: 3 },
    { x: 400, y: 500, scale: 2, rotation: 0 },
  ]);
  firstStyle.transform.x = 99;
  assert.equal(secondStyle.transform.x, 400);
});

test('Style render settings are isolated between sibling Styles', () => {
  const document = playableDocument();
  const item = document.parts[0].items[0];
  const second = createStyle(item, 'Blue');
  second.assetId = 'blue-art';
  second.layerTrackId = item.styles[0].layerTrackId;
  item.styles.push(second);
  normalizeDocumentOrders(document);

  item.styles[0].transform.x = -120;
  item.styles[0].opacity = 0.25;
  item.styles[0].requires.push({ partId: 'other' });

  assert.deepEqual(item.styles[1].transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.equal(item.styles[1].opacity, 1);
  assert.deepEqual(item.styles[1].requires, []);
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

test('normalizes every independent Part, Item, Style, Track and color order', () => {
  const document = playableDocument();
  const secondPart = createPart(document, 'Hair');
  const firstItem = createItem(secondPart, 'B');
  const firstStyle = firstItem.styles[0];
  firstStyle.name = 'First';
  const secondStyle = createStyle(firstItem, 'Second');
  firstItem.styles.push(secondStyle);
  secondPart.items.push(firstItem, createItem(secondPart, 'A'));
  document.parts.unshift(secondPart);
  document.layerTracks.unshift(createLayerTrack(document, 'Front'));
  delete document.layerTracks[0].locked;
  document.colorChannels.push(createGradientColorChannel(document, 'One'), createGradientColorChannel(document, 'Two'));
  normalizeDocumentOrders(document);
  assert.deepEqual(document.parts.map((part) => part.menuOrder), [0, 1]);
  assert.deepEqual(secondPart.items.map((item) => item.displayOrder), [0, 1]);
  assert.deepEqual(firstItem.styles.map((entry) => entry.displayOrder), [0, 1]);
  assert.deepEqual(document.layerTracks.map((track) => track.order), [0, 1]);
  assert.equal(document.layerTracks[0].locked, false);
  assert.deepEqual(document.colorChannels.map((channel) => channel.order), [0, 1]);
});

test('normalization rejects obsolete nested render graphs', () => {
  const document = playableDocument();
  const obsoleteField = ['layer', 'Bindings'].join('');
  document.parts[0].items[0].styles[0][obsoleteField] = [];
  assert.throws(() => normalizeDocumentOrders(document), /not compatible with .*Maker v5/);
});

test('normalization removes accidental Track placement and preserves Style placement', () => {
  const document = playableDocument();
  const selectedStyle = document.parts[0].items[0].styles[0];
  selectedStyle.transform = { x: -40, y: 22, scale: 1.5, rotation: 6 };
  document.layerTracks[0].transform = { x: 999, y: 999, scale: 0.1, rotation: 90 };
  normalizeDocumentOrders(document);
  assert.equal(Object.hasOwn(document.layerTracks[0], 'transform'), false);
  assert.deepEqual(selectedStyle.transform, { x: -40, y: 22, scale: 1.5, rotation: 6 });
});

test('moves valid array entries in place and ignores unsafe indexes', () => {
  const entries = ['a', 'b', 'c'];
  assert.equal(moveArrayEntry(entries, 0, 2), entries);
  assert.deepEqual(entries, ['b', 'c', 'a']);
  moveArrayEntry(entries, -1, 1);
  moveArrayEntry(entries, 0, 3);
  assert.deepEqual(entries, ['b', 'c', 'a']);
});

test('find helpers resolve the exact Part, Item and Style', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const item = part.items[0];
  const selectedStyle = item.styles[0];
  assert.equal(findPart(document, part.id), part);
  assert.equal(findItem(document, part.id, item.id), item);
  assert.equal(findStyle(document, part.id, item.id, selectedStyle.id), selectedStyle);
  assert.equal(findStyle(document, part.id, item.id, 'missing'), null);
});

test('keeps every referenced asset kind and prunes only unreachable metadata', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const item = part.items[0];
  document.metadata.coverAssetId = 'cover';
  part.iconAssetId = 'part-icon';
  item.thumbnailAssetId = 'thumbnail';
  document.assets.push(
    { id: 'cover' },
    { id: 'part-icon' },
    { id: 'thumbnail' },
    { id: 'orphan' },
  );
  assert.deepEqual(removeUnreferencedAssetMetadata(document), ['orphan']);
  assert.deepEqual(new Set(document.assets.map((asset) => asset.id)), new Set(['body-art', 'cover', 'part-icon', 'thumbnail']));
});

test('synchronizes valid defaults while retaining existing playable choices', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const alternate = createItem(part, 'Alternate');
  const alternateStyle = alternate.styles[0];
  alternateStyle.assetId = 'alternate-art';
  alternateStyle.layerTrackId = document.layerTracks[0].id;
  part.items.push(alternate);
  const channel = createGradientColorChannel(document, 'Skin');
  channel.swatches.push({ id: 'cool', name: 'Cool', hintColor: '#ffffff', stops: [] });
  document.colorChannels.push(channel);
  document.defaultRecipe = {
    selections: [{ partId: part.id, itemId: alternate.id, styleId: alternate.defaultStyleId }],
    colors: [{ channelId: channel.id, swatchId: 'cool' }],
  };
  const recipe = synchronizeDefaultRecipe(document);
  assert.deepEqual(recipe.selections[0], {
    partId: part.id,
    itemId: alternate.id,
    styleId: alternateStyle.id,
  });
  assert.equal(recipe.colors[0].swatchId, 'cool');
});

test('repairs stale default ids to the fallback records it selected', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const item = part.items[0];
  const channel = createGradientColorChannel(document, 'Skin');
  document.colorChannels.push(channel);
  part.defaultItemId = 'deleted-item';
  item.defaultStyleId = 'deleted-style';
  channel.defaultSwatchId = 'deleted-swatch';
  document.defaultRecipe = {
    selections: [{ partId: part.id, itemId: 'also-deleted', styleId: 'also-deleted' }],
    colors: [{ channelId: channel.id, swatchId: 'also-deleted' }],
  };
  synchronizeDefaultRecipe(document);
  assert.equal(part.defaultItemId, item.id);
  assert.equal(item.defaultStyleId, item.styles[0].id);
  assert.equal(channel.defaultSwatchId, channel.swatches[0].id);
});

test('duplicates a Part deeply and re-keys all nested editor identities', () => {
  const document = playableDocument();
  const source = document.parts[0];
  source.parentPartId = 'parent';
  source.items[0].styles[0].requires.push({ partId: 'external' });
  const duplicate = duplicatePart(document, source.id);

  assert.notEqual(duplicate, source);
  assert.notEqual(duplicate.id, source.id);
  assert.equal(duplicate.parentPartId, source.parentPartId);
  assert.notEqual(duplicate.items[0].id, source.items[0].id);
  assert.notEqual(duplicate.items[0].styles[0].id, source.items[0].styles[0].id);
  assert.equal(duplicate.defaultItemId, duplicate.items[0].id);
  assert.equal(duplicate.items[0].defaultStyleId, duplicate.items[0].styles[0].id);

  duplicate.items[0].styles[0].transform.x = 77;
  duplicate.items[0].styles[0].requires[0].partId = 'copy-external';
  assert.equal(source.items[0].styles[0].transform.x, 0);
  assert.equal(source.items[0].styles[0].requires[0].partId, 'external');
});

test('duplicates an Item with deep Style copies and rewritten internal self references', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const source = part.items[0];
  const sourceStyle = source.styles[0];
  source.requires = [{ partId: part.id, itemId: source.id, styleId: sourceStyle.id }];
  sourceStyle.visibleWhen = {
    op: 'selected',
    partId: part.id,
    itemId: source.id,
    styleId: sourceStyle.id,
  };
  sourceStyle.transform = { x: -18, y: 24, scale: 1.4, rotation: 3 };

  const duplicate = duplicateItem(document, part.id, source.id);
  const copiedStyle = duplicate.styles[0];
  assert.notEqual(duplicate.id, source.id);
  assert.notEqual(copiedStyle.id, sourceStyle.id);
  assert.equal(duplicate.defaultStyleId, copiedStyle.id);
  assert.deepEqual(duplicate.requires, [{
    partId: part.id,
    itemId: duplicate.id,
    styleId: copiedStyle.id,
  }]);
  assert.equal(copiedStyle.visibleWhen.itemId, duplicate.id);
  assert.equal(copiedStyle.visibleWhen.styleId, copiedStyle.id);
  assert.deepEqual(copiedStyle.transform, sourceStyle.transform);
  assert.notEqual(copiedStyle.transform, sourceStyle.transform);
  copiedStyle.transform.x = 400;
  assert.equal(sourceStyle.transform.x, -18);
});

test('duplicates a Style with identical parameters, a new ID and rewritten self rules', () => {
  const document = playableDocument();
  const part = document.parts[0];
  const item = part.items[0];
  const source = item.styles[0];
  source.requires = [{ partId: part.id, itemId: item.id, styleId: source.id }];

  const duplicate = duplicateStyle(document, part.id, item.id, source.id);
  assert.notEqual(duplicate.id, source.id);
  assert.equal(duplicate.requires[0].styleId, duplicate.id);
  assert.deepEqual(duplicate.transform, source.transform);
  assert.notEqual(duplicate.transform, source.transform);
  assert.notEqual(duplicate.requires, source.requires);
  duplicate.requires[0].partId = 'copy-part';
  assert.equal(source.requires[0].partId, part.id);
});

test('updates and removes recipe selections without introducing duplicate Parts', () => {
  const recipe = { selections: [{ partId: 'body', itemId: 'one', styleId: 'default' }], colors: [] };
  replaceRecipeSelection(recipe, { partId: 'body', itemId: 'two', styleId: 'blue' });
  replaceRecipeSelection(recipe, { partId: 'hair', itemId: 'long', styleId: 'black' });
  assert.deepEqual(recipeSelectionMap(recipe).get('body'), { partId: 'body', itemId: 'two', styleId: 'blue' });
  assert.equal(recipe.selections.length, 2);
  replaceRecipeSelection(recipe, { partId: 'body', itemId: '' });
  assert.deepEqual(recipe.selections, [{ partId: 'hair', itemId: 'long', styleId: 'black' }]);
});
