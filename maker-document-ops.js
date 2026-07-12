function slug(value, fallback = 'item') {
  const result = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return result || fallback;
}

export function uniqueDocumentId(preferred, collections = [], fallback = 'item') {
  const used = new Set(collections.flat().map((entry) => String(entry?.id || entry)).filter(Boolean));
  const base = slug(preferred, fallback);
  let id = base;
  let index = 2;
  while (used.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

export function createLayerTrack(document, name = 'New Layer') {
  return {
    id: uniqueDocumentId(name, [document.layerTracks], 'layer'),
    name,
    order: document.layerTracks.length,
  };
}

export function createPart(document, name = 'New Part') {
  return {
    id: uniqueDocumentId(name, [document.parts], 'part'),
    name,
    menuOrder: document.parts.length,
    menuVisible: true,
    required: false,
    defaultItemId: null,
    parentPartId: null,
    iconAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    items: [],
  };
}

export function createVariant(item, name = 'Default') {
  return {
    id: uniqueDocumentId(name, [item.variants || []], 'variant'),
    name,
    displayOrder: item.variants?.length || 0,
    visibleWhen: null,
    requires: [],
    excludes: [],
    layerBindings: [],
  };
}

export function createItem(part, name = 'New Item') {
  const item = {
    id: uniqueDocumentId(name, [part.items || []], 'item'),
    name,
    displayOrder: part.items?.length || 0,
    thumbnailAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    defaultVariantId: null,
    variants: [],
  };
  const variant = createVariant(item, 'Default');
  item.variants.push(variant);
  item.defaultVariantId = variant.id;
  return item;
}

export function createLayerBinding(variant, layerTrackId, assetId, transform = {}) {
  return {
    id: uniqueDocumentId(`binding-${layerTrackId}`, [variant.layerBindings || []], 'binding'),
    layerTrackId,
    assetId,
    colorChannelId: null,
    assetsBySwatch: [],
    transform: {
      x: Number(transform.x || 0),
      y: Number(transform.y || 0),
      scale: Math.max(0.01, Number(transform.scale ?? transform.scaleX ?? 1)),
      rotation: Number(transform.rotation || 0),
    },
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: null,
  };
}

export function createGradientColorChannel(document, name = 'New Color') {
  const channelId = uniqueDocumentId(name, [document.colorChannels || []], 'color');
  return {
    id: channelId,
    name,
    order: document.colorChannels?.length || 0,
    mode: 'gradient-map',
    defaultSwatchId: 'default',
    swatches: [{
      id: 'default',
      name: 'Default',
      hintColor: '#7b5cff',
      stops: [
        { offset: 0, color: '#211343' },
        { offset: 0.5, color: '#7b5cff' },
        { offset: 1, color: '#f0eaff' },
      ],
    }],
  };
}

export function addDocumentAsset(document, asset) {
  const metadata = {
    id: String(asset.assetId),
    identifier: String(asset.identifier || `${slug(asset.fileName || asset.assetId)}.png`),
    kind: String(asset.kind || 'layer'),
    mediaType: String(asset.mediaType || asset.blob?.type || 'image/png'),
    width: Number(asset.width || 0) || null,
    height: Number(asset.height || 0) || null,
  };
  const index = document.assets.findIndex((candidate) => candidate.id === metadata.id);
  if (index >= 0) document.assets[index] = metadata;
  else document.assets.push(metadata);
  return metadata;
}

export function findPart(document, partId) {
  return document.parts.find((part) => part.id === partId) || null;
}

export function findItem(document, partId, itemId) {
  return findPart(document, partId)?.items.find((item) => item.id === itemId) || null;
}

export function findVariant(document, partId, itemId, variantId) {
  return findItem(document, partId, itemId)?.variants.find((variant) => variant.id === variantId) || null;
}

export function findBinding(document, partId, itemId, variantId, bindingId) {
  return findVariant(document, partId, itemId, variantId)?.layerBindings.find((binding) => binding.id === bindingId) || null;
}

export function normalizeDocumentOrders(document) {
  document.parts.forEach((part, partIndex) => {
    part.menuOrder = partIndex;
    part.items.forEach((item, itemIndex) => {
      item.displayOrder = itemIndex;
      item.variants.forEach((variant, variantIndex) => { variant.displayOrder = variantIndex; });
    });
  });
  document.layerTracks.forEach((track, index) => { track.order = index; });
  document.colorChannels.forEach((channel, index) => { channel.order = index; });
  return document;
}

export function moveArrayEntry(entries, fromIndex, toIndex) {
  if (!Array.isArray(entries) || fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= entries.length || toIndex >= entries.length) return entries;
  const [entry] = entries.splice(fromIndex, 1);
  entries.splice(toIndex, 0, entry);
  return entries;
}

function collectReferencedAssets(document) {
  const ids = new Set();
  if (document.metadata?.coverAssetId) ids.add(document.metadata.coverAssetId);
  document.parts.forEach((part) => {
    if (part.iconAssetId) ids.add(part.iconAssetId);
    part.items.forEach((item) => {
      if (item.thumbnailAssetId) ids.add(item.thumbnailAssetId);
      item.variants.forEach((variant) => variant.layerBindings.forEach((binding) => {
        if (binding.assetId) ids.add(binding.assetId);
        (binding.assetsBySwatch || []).forEach((mapping) => mapping.assetId && ids.add(mapping.assetId));
      }));
    });
  });
  return ids;
}

export function removeUnreferencedAssetMetadata(document) {
  const referenced = collectReferencedAssets(document);
  const removed = document.assets.filter((asset) => !referenced.has(asset.id)).map((asset) => asset.id);
  document.assets = document.assets.filter((asset) => referenced.has(asset.id));
  return removed;
}

export function synchronizeDefaultRecipe(document) {
  const previousSelections = new Map((document.defaultRecipe?.selections || []).map((selection) => [selection.partId, selection]));
  const selections = [];
  document.parts.forEach((part) => {
    const previous = previousSelections.get(part.id);
    const item = part.items.find((candidate) => candidate.id === previous?.itemId)
      || part.items.find((candidate) => candidate.id === part.defaultItemId)
      || part.items[0];
    if (!item) {
      part.defaultItemId = null;
      return;
    }
    if (!part.items.some((candidate) => candidate.id === part.defaultItemId)) part.defaultItemId = item.id;
    const variant = item.variants.find((candidate) => candidate.id === previous?.variantId)
      || item.variants.find((candidate) => candidate.id === item.defaultVariantId)
      || item.variants[0];
    if (!variant) return;
    if (!item.variants.some((candidate) => candidate.id === item.defaultVariantId)) item.defaultVariantId = variant.id;
    selections.push({ partId: part.id, itemId: item.id, variantId: variant.id });
  });
  const previousColors = new Map((document.defaultRecipe?.colors || []).map((color) => [color.channelId, color]));
  const colors = document.colorChannels.flatMap((channel) => {
    const previousSwatchId = previousColors.get(channel.id)?.swatchId;
    const swatchId = channel.swatches.some((swatch) => swatch.id === previousSwatchId)
      ? previousSwatchId
      : channel.swatches.some((swatch) => swatch.id === channel.defaultSwatchId)
        ? channel.defaultSwatchId
        : channel.swatches[0]?.id;
    if (!swatchId) return [];
    if (!channel.swatches.some((swatch) => swatch.id === channel.defaultSwatchId)) channel.defaultSwatchId = swatchId;
    return [{ channelId: channel.id, swatchId }];
  });
  document.defaultRecipe = { selections, colors };
  return document.defaultRecipe;
}

export function duplicatePart(document, partId) {
  const source = findPart(document, partId);
  if (!source) return null;
  const duplicate = structuredClone(source);
  duplicate.id = uniqueDocumentId(`${source.id}-copy`, [document.parts], 'part-copy');
  duplicate.name = `${source.name} Copy`;
  duplicate.parentPartId = null;
  duplicate.items.forEach((item) => {
    item.id = uniqueDocumentId(item.id, [duplicate.items.filter((candidate) => candidate !== item)], 'item');
    item.variants.forEach((variant) => {
      variant.layerBindings.forEach((binding) => { binding.id = uniqueDocumentId(binding.id, [variant.layerBindings.filter((candidate) => candidate !== binding)], 'binding'); });
    });
  });
  document.parts.push(duplicate);
  normalizeDocumentOrders(document);
  return duplicate;
}

export function recipeSelectionMap(recipe) {
  return new Map((recipe?.selections || recipe || []).map((selection) => [selection.partId, selection]));
}

export function replaceRecipeSelection(recipe, selection) {
  recipe.selections ||= [];
  const index = recipe.selections.findIndex((candidate) => candidate.partId === selection.partId);
  if (!selection.itemId) {
    if (index >= 0) recipe.selections.splice(index, 1);
    return recipe;
  }
  if (index >= 0) recipe.selections[index] = selection;
  else recipe.selections.push(selection);
  return recipe;
}
