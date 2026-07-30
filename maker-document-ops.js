import { gradientStopsForColor } from './maker-color.js';

function slug(value, fallback = 'item') {
  const result = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return result || fallback;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedTransform(value = {}) {
  return {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    scale: Math.max(0.01, finite(value.scale ?? value.scaleX, 1)),
    rotation: finite(value.rotation, 0),
  };
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
    id: uniqueDocumentId(name, [document.layerTracks || []], 'layer'),
    name,
    order: document.layerTracks?.length || 0,
    locked: false,
    referenceAssetId: null,
  };
}

export function createPart(document, name = 'New Part') {
  return {
    id: uniqueDocumentId(name, [document.parts || []], 'part'),
    name,
    menuOrder: document.parts?.length || 0,
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

/**
 * A Style is the smallest and only renderable unit in a Maker v5 document.
 * It owns exactly one asset/track placement and never contains bindings.
 */
export function createStyle(item, name = 'New Style') {
  return {
    id: uniqueDocumentId(name, [item?.styles || []], 'style'),
    name,
    displayOrder: item?.styles?.length || 0,
    assetId: null,
    layerTrackId: null,
    colorChannelId: null,
    transform: {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    },
    positionConfirmed: false,
    positionLocked: false,
    styleLocked: false,
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: null,
    requires: [],
    excludes: [],
  };
}

/**
 * Every Item owns at least one Style from the moment it is created. The
 * initial default Style is intentionally asset-free so creators can upload its
 * PNG later without introducing another structural layer below Style.
 */
export function createItem(part, name = 'New Item') {
  const item = {
    id: uniqueDocumentId(name, [part.items || []], 'item'),
    name,
    displayOrder: part.items?.length || 0,
    importKey: '',
    // Item-level release status is no longer exposed in Creator Studio.
    // New Items must therefore be publishable without a hidden field.
    status: 'public',
    thumbnailAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    defaultStyleId: null,
    styles: [],
  };
  item.importKey = item.id;
  const defaultStyle = createStyle(item, 'Default Style');
  item.styles.push(defaultStyle);
  item.defaultStyleId = defaultStyle.id;
  return item;
}

export function createGradientColorChannel(document, name = 'New Color') {
  const channelId = uniqueDocumentId(name, [document.colorChannels || []], 'color');
  const primaryColor = '#7b5cff';
  return {
    id: channelId,
    name,
    order: document.colorChannels?.length || 0,
    mode: 'gradient-map',
    defaultSwatchId: 'default',
    swatches: [{
      id: 'default',
      name: 'Default',
      hintColor: primaryColor,
      stops: gradientStopsForColor(primaryColor),
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
  return document?.parts?.find((part) => part.id === partId) || null;
}

export function findItem(document, partId, itemId) {
  return findPart(document, partId)?.items?.find((item) => item.id === itemId) || null;
}

export function findStyle(document, partId, itemId, styleId) {
  return findItem(document, partId, itemId)?.styles?.find((style) => style.id === styleId) || null;
}

/**
 * Normalize ordering and scalar editor fields only. Legacy Variant documents
 * are deliberately rejected instead of being silently reinterpreted as v5.
 */
export function normalizeDocumentOrders(document) {
  if (!document || document.schemaVersion !== 'animacraft.maker.v5') {
    throw new TypeError('normalizeDocumentOrders expects an animacraft.maker.v5 document.');
  }

  document.layerTracks ||= [];
  document.parts ||= [];
  document.colorChannels ||= [];

  document.layerTracks.forEach((track, index) => {
    track.order = index;
    delete track.transform;
    if (typeof track.locked !== 'boolean') track.locked = false;
    track.referenceAssetId ??= null;
  });

  document.parts.forEach((part, partIndex) => {
    part.menuOrder = partIndex;
    part.items ||= [];
    part.items.forEach((item, itemIndex) => {
      if (Object.hasOwn(item, 'variants') || Object.hasOwn(item, 'defaultVariantId')) {
        throw new TypeError('Legacy Item variants are not compatible with Maker v5.');
      }
      item.displayOrder = itemIndex;
      item.importKey ||= item.id;
      item.status ||= 'public';
      item.styles ||= [];
      if (!item.styles.length) {
        const defaultStyle = createStyle(item, 'Default Style');
        item.styles.push(defaultStyle);
        item.defaultStyleId = defaultStyle.id;
      }
      item.styles.forEach((style, styleIndex) => {
        if (Object.hasOwn(style, 'layerBindings') || Object.hasOwn(style, 'assetsBySwatch')) {
          throw new TypeError('Legacy nested or multi-asset fields are not compatible with one-PNG Maker v5 Styles.');
        }
        style.displayOrder = styleIndex;
        style.assetId ??= null;
        style.layerTrackId ??= null;
        style.colorChannelId ??= null;
        style.transform = normalizedTransform(style.transform);
        if (typeof style.positionConfirmed !== 'boolean') style.positionConfirmed = false;
        if (typeof style.positionLocked !== 'boolean') style.positionLocked = false;
        if (typeof style.styleLocked !== 'boolean') style.styleLocked = false;
        style.opacity = Math.max(0, Math.min(1, finite(style.opacity, 1)));
        style.blendMode ||= 'normal';
        style.visibleWhen ??= null;
        style.requires = Array.isArray(style.requires) ? style.requires : [];
        style.excludes = Array.isArray(style.excludes) ? style.excludes : [];
      });
      if (!item.styles.some((style) => style.id === item.defaultStyleId)) {
        item.defaultStyleId = item.styles[0]?.id || null;
      }
    });
  });
  document.colorChannels.forEach((channel, index) => { channel.order = index; });
  return document;
}

export function effectiveStyleTransform(_document, style) {
  return normalizedTransform(style?.transform);
}

export function moveArrayEntry(entries, fromIndex, toIndex) {
  if (!Array.isArray(entries) || fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= entries.length || toIndex >= entries.length) return entries;
  const [entry] = entries.splice(fromIndex, 1);
  entries.splice(toIndex, 0, entry);
  return entries;
}

export function partLayerTrackIds(part) {
  return [...new Set((part?.items || []).flatMap((item) => (
    (item.styles || []).map((style) => String(style.layerTrackId || '')).filter(Boolean)
  )))];
}

export function partTrackLinkage(document, partId) {
  const part = findPart(document, partId);
  if (!part) return { mode: 'missing', partId: String(partId || ''), trackIds: [], trackId: null };
  const declaredTrackIds = new Set((document.layerTracks || []).map((track) => String(track.id)));
  const styles = (part.items || []).flatMap((item) => item.styles || []);
  const trackIds = partLayerTrackIds(part);
  const unassignedStyleCount = styles.filter((style) => !String(style.layerTrackId || '')).length;
  if (!styles.length || unassignedStyleCount === styles.length) {
    return { mode: 'unassigned', partId: part.id, trackIds, trackId: null };
  }
  if (unassignedStyleCount) {
    return {
      mode: 'custom',
      partId: part.id,
      trackIds,
      trackId: null,
      reason: 'partially-unassigned',
      unassignedStyleCount,
    };
  }
  const validTrackIds = trackIds.filter((trackId) => declaredTrackIds.has(trackId));
  if (validTrackIds.length !== trackIds.length) {
    return { mode: 'custom', partId: part.id, trackIds, trackId: null, reason: 'missing-track' };
  }
  if (trackIds.length !== 1) {
    return { mode: 'custom', partId: part.id, trackIds, trackId: null, reason: 'multiple-tracks' };
  }
  const [trackId] = trackIds;
  const ownerPartIds = (document.parts || [])
    .filter((candidate) => partLayerTrackIds(candidate).includes(trackId))
    .map((candidate) => candidate.id);
  if (ownerPartIds.length !== 1 || ownerPartIds[0] !== part.id) {
    return {
      mode: 'custom',
      partId: part.id,
      trackIds,
      trackId: null,
      reason: 'shared-track',
      ownerPartIds,
    };
  }
  return { mode: 'linked', partId: part.id, trackIds, trackId };
}

export function linkedPartTrackPairs(document) {
  return (document.parts || []).flatMap((part) => {
    const linkage = partTrackLinkage(document, part.id);
    return linkage.mode === 'linked' ? [{ partId: part.id, trackId: linkage.trackId }] : [];
  });
}

export function linkedPartTrackOrderMatches(document) {
  const pairs = linkedPartTrackPairs(document);
  const linkedTrackIds = new Set(pairs.map((pair) => pair.trackId));
  const trackOrder = (document.layerTracks || [])
    .map((track) => track.id)
    .filter((trackId) => linkedTrackIds.has(trackId));
  return pairs.every((pair, index) => pair.trackId === trackOrder[index]);
}

function reorderMemberSlots(entries, memberIds, orderedIds) {
  const slots = [];
  const records = new Map();
  entries.forEach((entry, index) => {
    if (!memberIds.has(entry.id)) return;
    slots.push(index);
    records.set(entry.id, entry);
  });
  if (slots.length !== orderedIds.length || orderedIds.some((id) => !records.has(id))) return false;
  const before = slots.map((index) => entries[index]?.id);
  slots.forEach((index, slotIndex) => {
    entries[index] = records.get(orderedIds[slotIndex]);
  });
  return before.some((id, index) => id !== orderedIds[index]);
}

/**
 * Standard Parts have one exclusive Layer Track. Reordering the Player menu
 * atomically reorders only those standard Track slots; custom/shared Tracks
 * keep their explicit positions.
 */
export function synchronizeLinkedTrackOrderFromParts(document) {
  const pairs = linkedPartTrackPairs(document);
  const memberIds = new Set(pairs.map((pair) => pair.trackId));
  return reorderMemberSlots(
    document.layerTracks || [],
    memberIds,
    pairs.map((pair) => pair.trackId),
  );
}

/**
 * The inverse of synchronizeLinkedTrackOrderFromParts: moving a standard
 * Layer Track also updates the associated Player menu Part order.
 */
export function synchronizeLinkedPartOrderFromTracks(document) {
  const pairs = linkedPartTrackPairs(document);
  const pairByTrackId = new Map(pairs.map((pair) => [pair.trackId, pair]));
  const orderedPartIds = (document.layerTracks || [])
    .map((track) => pairByTrackId.get(track.id)?.partId)
    .filter(Boolean);
  return reorderMemberSlots(
    document.parts || [],
    new Set(pairs.map((pair) => pair.partId)),
    orderedPartIds,
  );
}

function collectReferencedAssets(document) {
  const ids = new Set();
  if (document.metadata?.coverAssetId) ids.add(document.metadata.coverAssetId);
  (document.layerTracks || []).forEach((track) => {
    if (track.referenceAssetId) ids.add(track.referenceAssetId);
  });
  (document.parts || []).forEach((part) => {
    if (part.iconAssetId) ids.add(part.iconAssetId);
    (part.items || []).forEach((item) => {
      if (item.thumbnailAssetId) ids.add(item.thumbnailAssetId);
      (item.styles || []).forEach((style) => {
        if (style.assetId) ids.add(style.assetId);
      });
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
  (document.parts || []).forEach((part) => {
    const previous = previousSelections.get(part.id);
    const item = (part.items || []).find((candidate) => candidate.id === previous?.itemId)
      || (part.items || []).find((candidate) => candidate.id === part.defaultItemId)
      || part.items?.[0];
    if (!item) {
      part.defaultItemId = null;
      return;
    }
    if (!part.items.some((candidate) => candidate.id === part.defaultItemId)) part.defaultItemId = item.id;
    const style = (item.styles || []).find((candidate) => candidate.id === previous?.styleId)
      || (item.styles || []).find((candidate) => candidate.id === item.defaultStyleId)
      || item.styles?.[0];
    if (!style) {
      item.defaultStyleId = null;
      return;
    }
    if (!item.styles.some((candidate) => candidate.id === item.defaultStyleId)) item.defaultStyleId = style.id;
    selections.push({ partId: part.id, itemId: item.id, styleId: style.id });
  });

  const previousColors = new Map((document.defaultRecipe?.colors || []).map((color) => [color.channelId, color]));
  const colors = (document.colorChannels || []).flatMap((channel) => {
    const previousSwatchId = previousColors.get(channel.id)?.swatchId;
    const swatchId = channel.swatches?.some((swatch) => swatch.id === previousSwatchId)
      ? previousSwatchId
      : channel.swatches?.some((swatch) => swatch.id === channel.defaultSwatchId)
        ? channel.defaultSwatchId
        : channel.swatches?.[0]?.id;
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

  const itemIdMap = new Map();
  const styleIdMap = new Map();
  const usedItemIds = new Set();

  (source.items || []).forEach((sourceItem, itemIndex) => {
    const copiedItem = duplicate.items[itemIndex];
    const copiedItemId = uniqueDocumentId(
      `${sourceItem.id}-copy`,
      [[...usedItemIds]],
      'item-copy',
    );
    usedItemIds.add(copiedItemId);
    itemIdMap.set(sourceItem.id, copiedItemId);
    copiedItem.id = copiedItemId;
    // Import keys are record identities, not visual parameters. Re-key them
    // with the copied Item so future matrix imports cannot target the source.
    copiedItem.importKey = copiedItemId;

    const usedStyleIds = new Set();
    (sourceItem.styles || []).forEach((sourceStyle, styleIndex) => {
      const copiedStyle = copiedItem.styles[styleIndex];
      const copiedStyleId = uniqueDocumentId(
        `${sourceStyle.id}-copy`,
        [[...usedStyleIds]],
        'style-copy',
      );
      usedStyleIds.add(copiedStyleId);
      styleIdMap.set(`${sourceItem.id}\u0000${sourceStyle.id}`, copiedStyleId);
      copiedStyle.id = copiedStyleId;
    });
  });

  const rewriteTarget = (target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target) || target.partId !== source.id) return target;
    const sourceItemId = target.itemId
      || (Array.isArray(target.itemIds) && target.itemIds.length === 1
        ? target.itemIds[0]
        : '');
    const sourceStyleId = target.styleId;
    const sourceItemIds = Array.isArray(target.itemIds) ? target.itemIds : null;
    const sourceStyleIds = Array.isArray(target.styleIds) ? target.styleIds : null;
    return {
      ...target,
      partId: duplicate.id,
      ...(sourceItemId
        ? { itemId: itemIdMap.get(sourceItemId) || sourceItemId }
        : {}),
      ...(sourceItemIds
        ? { itemIds: sourceItemIds.map((itemId) => itemIdMap.get(itemId) || itemId) }
        : {}),
      ...(sourceStyleId
        ? { styleId: styleIdMap.get(`${sourceItemId}\u0000${sourceStyleId}`) || sourceStyleId }
        : {}),
      ...(sourceStyleIds && sourceItemId
        ? { styleIds: sourceStyleIds.map((styleId) => styleIdMap.get(`${sourceItemId}\u0000${styleId}`) || styleId) }
        : {}),
    };
  };

  const rewriteCondition = (condition) => {
    if (Array.isArray(condition)) return condition.map(rewriteCondition);
    if (!condition || typeof condition !== 'object') return condition;
    const rewritten = rewriteTarget(condition);
    const result = { ...rewritten };
    ['condition', 'conditions', 'all', 'any', 'and', 'or', 'not', 'requires', 'excludes'].forEach((field) => {
      if (result[field] !== undefined) result[field] = rewriteCondition(result[field]);
    });
    return result;
  };

  const rewriteOwnerReferences = (owner) => {
    owner.requires = (owner.requires || []).map(rewriteTarget);
    owner.excludes = (owner.excludes || []).map(rewriteTarget);
    owner.visibleWhen = rewriteCondition(owner.visibleWhen);
  };

  duplicate.defaultItemId = source.defaultItemId
    ? itemIdMap.get(source.defaultItemId) || null
    : null;
  rewriteOwnerReferences(duplicate);
  (source.items || []).forEach((sourceItem, itemIndex) => {
    const copiedItem = duplicate.items[itemIndex];
    copiedItem.defaultStyleId = sourceItem.defaultStyleId
      ? styleIdMap.get(`${sourceItem.id}\u0000${sourceItem.defaultStyleId}`) || null
      : null;
    rewriteOwnerReferences(copiedItem);
    copiedItem.styles.forEach(rewriteOwnerReferences);
  });

  // A copied Part must be structurally independent. Clone every Track used by
  // its Styles and rewrite the copied bindings instead of silently sharing
  // visual z-order state with the source Part.
  const copiedTracks = [];
  const trackIdMap = new Map();
  partLayerTrackIds(source).forEach((sourceTrackId) => {
    const sourceTrack = (document.layerTracks || []).find((track) => track.id === sourceTrackId);
    if (!sourceTrack) return;
    const copiedTrack = structuredClone(sourceTrack);
    copiedTrack.id = uniqueDocumentId(
      `${sourceTrack.id}-copy`,
      [document.layerTracks || [], copiedTracks],
      'layer-copy',
    );
    copiedTrack.name = `${sourceTrack.name} Copy`;
    copiedTrack.order = (document.layerTracks?.length || 0) + copiedTracks.length;
    copiedTracks.push(copiedTrack);
    trackIdMap.set(sourceTrackId, copiedTrack.id);
  });
  duplicate.items.forEach((copiedItem) => copiedItem.styles.forEach((copiedStyle) => {
    if (trackIdMap.has(copiedStyle.layerTrackId)) {
      copiedStyle.layerTrackId = trackIdMap.get(copiedStyle.layerTrackId);
    }
  }));
  document.layerTracks.push(...copiedTracks);
  document.parts.push(duplicate);
  normalizeDocumentOrders(document);
  return duplicate;
}

function rewriteCopiedOwnerReferences(owner, rewriteTarget) {
  const rewriteCondition = (condition) => {
    if (Array.isArray(condition)) return condition.map(rewriteCondition);
    if (!condition || typeof condition !== 'object') return condition;
    const result = { ...rewriteTarget(condition) };
    [
      'condition',
      'conditions',
      'all',
      'any',
      'and',
      'or',
      'not',
      'requires',
      'excludes',
    ].forEach((field) => {
      if (result[field] !== undefined) result[field] = rewriteCondition(result[field]);
    });
    return result;
  };
  owner.requires = (owner.requires || []).map(rewriteTarget);
  owner.excludes = (owner.excludes || []).map(rewriteTarget);
  owner.visibleWhen = rewriteCondition(owner.visibleWhen);
}

/** Deep-copy one Item and re-key every copied Style and self-reference. */
export function duplicateItem(document, partId, itemId) {
  const part = findPart(document, partId);
  const source = findItem(document, partId, itemId);
  if (!part || !source) return null;
  const duplicate = structuredClone(source);
  duplicate.id = uniqueDocumentId(`${source.id}-copy`, [part.items], 'item-copy');
  duplicate.name = `${source.name} Copy`;
  duplicate.importKey = duplicate.id;

  const styleIdMap = new Map();
  const usedStyleIds = new Set();
  (source.styles || []).forEach((sourceStyle, index) => {
    const copiedStyle = duplicate.styles[index];
    const copiedStyleId = uniqueDocumentId(`${sourceStyle.id}-copy`, [[...usedStyleIds]], 'style-copy');
    usedStyleIds.add(copiedStyleId);
    styleIdMap.set(sourceStyle.id, copiedStyleId);
    copiedStyle.id = copiedStyleId;
  });
  duplicate.defaultStyleId = source.defaultStyleId
    ? styleIdMap.get(source.defaultStyleId) || null
    : null;

  const rewriteTarget = (target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)
      || target.partId !== partId) return target;
    const targetsSourceItem = target.itemId === source.id
      || (Array.isArray(target.itemIds) && target.itemIds.includes(source.id));
    if (!targetsSourceItem) return target;
    const styleScopeIsSource = target.itemId === source.id
      || (!target.itemId && Array.isArray(target.itemIds)
        && target.itemIds.length === 1
        && target.itemIds[0] === source.id);
    return {
      ...target,
      ...(target.itemId === source.id ? { itemId: duplicate.id } : {}),
      ...(Array.isArray(target.itemIds)
        ? {
            itemIds: target.itemIds.map((targetItemId) => (
              targetItemId === source.id ? duplicate.id : targetItemId
            )),
          }
        : {}),
      ...(styleScopeIsSource && target.styleId
        ? { styleId: styleIdMap.get(target.styleId) || target.styleId }
        : {}),
      ...(styleScopeIsSource && Array.isArray(target.styleIds)
        ? {
            styleIds: target.styleIds.map((targetStyleId) => (
              styleIdMap.get(targetStyleId) || targetStyleId
            )),
          }
        : {}),
    };
  };
  rewriteCopiedOwnerReferences(duplicate, rewriteTarget);
  duplicate.styles.forEach((style) => rewriteCopiedOwnerReferences(style, rewriteTarget));
  part.items.push(duplicate);
  normalizeDocumentOrders(document);
  return duplicate;
}

/** Deep-copy one Style and re-key Style-specific self-references. */
export function duplicateStyle(document, partId, itemId, styleId) {
  const item = findItem(document, partId, itemId);
  const source = findStyle(document, partId, itemId, styleId);
  if (!item || !source) return null;
  const duplicate = structuredClone(source);
  duplicate.id = uniqueDocumentId(`${source.id}-copy`, [item.styles], 'style-copy');
  duplicate.name = `${source.name} Copy`;
  const rewriteTarget = (target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)
      || target.partId !== partId) return target;
    const targetsItem = target.itemId === itemId
      || (Array.isArray(target.itemIds)
        && target.itemIds.length === 1
        && target.itemIds[0] === itemId);
    if (!targetsItem) return target;
    if (target.styleId === source.id) return { ...target, styleId: duplicate.id };
    if (Array.isArray(target.styleIds) && target.styleIds.includes(source.id)) {
      return {
        ...target,
        styleIds: target.styleIds.map((targetStyleId) => (
          targetStyleId === source.id ? duplicate.id : targetStyleId
        )),
      };
    }
    return target;
  };
  rewriteCopiedOwnerReferences(duplicate, rewriteTarget);
  item.styles.push(duplicate);
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
  const canonical = {
    partId: selection.partId,
    itemId: selection.itemId,
    ...(selection.styleId ? { styleId: selection.styleId } : {}),
  };
  if (index >= 0) recipe.selections[index] = canonical;
  else recipe.selections.push(canonical);
  return recipe;
}
