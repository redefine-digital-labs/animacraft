/**
 * Shared, side-effect-free scene resolution and Canvas 2D rendering for a
 * Maker document. Creator preview, player preview, cover export and final OC
 * export should all call this module so that a recipe has exactly one visual
 * interpretation.
 */

import {
  MAX_MAKER_ASSET_BYTES,
  assertMakerAssetDimensions,
  fetchMakerAssetBlob,
} from './maker-assets.js';

export const MAKER_SCENE_VERSION = 'animacraft.resolved-scene.v2';

export const BLEND_MODES = Object.freeze({
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  add: 'lighter',
});

export const PIXEL_MODES = Object.freeze({
  nearest: false,
  linear: true,
});

const EMPTY_ARRAY = Object.freeze([]);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : EMPTY_ARRAY;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function idOf(value, fallback = '') {
  if (typeof value === 'string') return value;
  return String(firstDefined(value?.id, value?.key, fallback) ?? '');
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNumber(left, right) {
  return finite(left, Number.MAX_SAFE_INTEGER) - finite(right, Number.MAX_SAFE_INTEGER);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeOpacity(value) {
  const opacity = finite(value, 1);
  return clamp(opacity > 1 ? opacity / 100 : opacity, 0, 1);
}

export function normalizeBlendMode(value) {
  const mode = String(value || 'normal').toLowerCase();
  if (mode === 'linear-dodge' || mode === 'linear_dodge' || mode === 'lighter') return 'add';
  return Object.hasOwn(BLEND_MODES, mode) ? mode : 'normal';
}

export function normalizePixelMode(value) {
  const mode = String(value || 'linear').toLowerCase();
  return mode === 'nearest' || mode === 'pixel' || mode === 'pixelated' ? 'nearest' : 'linear';
}

function selectionsFrom(value) {
  if (value instanceof Map) return value;
  const map = new Map();
  if (Array.isArray(value)) {
    value.forEach((selection) => {
      const partId = String(firstDefined(selection?.partId, selection?.partKey, selection?.slot, selection?.key) || '');
      if (partId) map.set(partId, selection);
    });
    return map;
  }
  Object.entries(object(value)).forEach(([partId, selection]) => {
    map.set(partId, typeof selection === 'string' ? { partId, itemId: selection } : { partId, ...object(selection) });
  });
  return map;
}

function channelValuesFrom(value) {
  if (value instanceof Map) return value;
  return new Map(Object.entries(object(value)));
}

function selectedPartMatches(condition, context) {
  const partId = String(firstDefined(condition.partId, condition.partKey, condition.slot, '') || '');
  const selection = selectionsFrom(context.selections).get(partId);
  const selected = Boolean(selection && firstDefined(selection.itemId, selection.itemKey, selection.part, '') !== '');
  if (condition.selected !== undefined && selected !== Boolean(condition.selected)) return false;
  if (condition.selected === false) return true;
  if (!selected) return false;

  const itemId = String(firstDefined(selection.itemId, selection.itemKey, selection.part, '') || '');
  const styleId = String(firstDefined(selection.styleId, selection.styleKey, '') || '');
  const expectedItem = firstDefined(condition.itemId, condition.itemKey);
  const expectedItems = firstDefined(condition.itemIds, condition.itemKeys);
  const expectedStyle = firstDefined(condition.styleId, condition.styleKey);
  const expectedStyles = firstDefined(condition.styleIds, condition.styleKeys);
  if (expectedItem !== undefined && itemId !== String(expectedItem)) return false;
  if (Array.isArray(expectedItems) && !expectedItems.map(String).includes(itemId)) return false;
  if (expectedStyle !== undefined && styleId !== String(expectedStyle)) return false;
  if (Array.isArray(expectedStyles) && !expectedStyles.map(String).includes(styleId)) return false;
  return true;
}

function selectedColorMatches(condition, context) {
  const channelId = String(firstDefined(condition.colorChannelId, condition.channelId, condition.paletteId, '') || '');
  const selected = channelValuesFrom(context.colorChannels).get(channelId);
  if (condition.selected !== undefined && Boolean(selected) !== Boolean(condition.selected)) return false;
  if (selected === undefined || selected === null || selected === '') return false;
  const selectedId = String(firstDefined(selected?.valueId, selected?.id, selected));
  const selectedValue = String(firstDefined(selected?.value, selected));
  const expected = firstDefined(condition.equals, condition.valueId, condition.colorId, condition.value);
  const allowed = firstDefined(condition.in, condition.valueIds, condition.values);
  if (expected !== undefined && selectedId !== String(expected) && selectedValue !== String(expected)) return false;
  if (Array.isArray(allowed) && !allowed.map(String).includes(selectedId) && !allowed.map(String).includes(selectedValue)) return false;
  return true;
}

/**
 * Evaluate the small declarative condition language used by Parts, Items and
 * Styles.
 *
 * Supported forms:
 *   { partId, itemId?, itemIds?, styleId?, styleIds?, selected? }
 *   { colorChannelId, equals? | in?, selected? }
 *   { all: [...] }, { any: [...] }, { not: condition }
 *   { requires: [...], excludes: [...] }
 */
export function evaluateVisibleWhen(condition, context = {}) {
  if (condition === undefined || condition === null || condition === true) return true;
  if (condition === false) return false;
  if (Array.isArray(condition)) return condition.every((entry) => evaluateVisibleWhen(entry, context));
  if (typeof condition !== 'object') return Boolean(condition);

  if (condition.op === 'selected') return selectedPartMatches(condition, context);
  if (condition.op === 'not') return !evaluateVisibleWhen(condition.condition, context);
  if (condition.op === 'all') return array(condition.conditions).every((entry) => evaluateVisibleWhen(entry, context));
  if (condition.op === 'any') return array(condition.conditions).some((entry) => evaluateVisibleWhen(entry, context));

  if (Array.isArray(condition.all) && !condition.all.every((entry) => evaluateVisibleWhen(entry, context))) return false;
  if (Array.isArray(condition.and) && !condition.and.every((entry) => evaluateVisibleWhen(entry, context))) return false;
  if (Array.isArray(condition.any) && !condition.any.some((entry) => evaluateVisibleWhen(entry, context))) return false;
  if (Array.isArray(condition.or) && !condition.or.some((entry) => evaluateVisibleWhen(entry, context))) return false;
  if (condition.not !== undefined && evaluateVisibleWhen(condition.not, context)) return false;
  if (Array.isArray(condition.requires) && !condition.requires.every((entry) => evaluateVisibleWhen(entry, context))) return false;
  if (Array.isArray(condition.excludes) && condition.excludes.some((entry) => evaluateVisibleWhen(entry, context))) return false;

  if (firstDefined(condition.partId, condition.partKey, condition.slot) !== undefined
    && !selectedPartMatches(condition, context)) return false;
  if (firstDefined(condition.colorChannelId, condition.channelId, condition.paletteId) !== undefined
    && !selectedColorMatches(condition, context)) return false;
  if (condition.flag !== undefined) {
    const actual = object(context.flags)[condition.flag];
    if (condition.equals !== undefined ? actual !== condition.equals : !actual) return false;
  }
  return true;
}

function recipeSelectionArray(recipe) {
  if (Array.isArray(recipe)) return recipe;
  const source = object(recipe);
  const selections = firstDefined(source.selections, source.parts, source.slots);
  if (Array.isArray(selections)) return selections;
  if (selections && typeof selections === 'object') {
    return Object.entries(selections).map(([partId, selection]) => (
      typeof selection === 'string'
        ? { partId, itemId: selection }
        : { partId, ...object(selection) }
    ));
  }
  return EMPTY_ARRAY;
}

function normalizeSelection(raw) {
  return {
    partId: String(firstDefined(raw?.partId, raw?.partKey, raw?.slot, raw?.key, '') || ''),
    itemId: String(firstDefined(raw?.itemId, raw?.itemKey, raw?.part, '') || ''),
    styleId: String(firstDefined(raw?.styleId, raw?.styleKey, '') || ''),
    color: firstDefined(raw?.color, raw?.colorId, raw?.colorHex),
    colorChannels: object(firstDefined(raw?.colorChannels, raw?.colors, raw?.palettes)),
  };
}

function normalizeRecipe(recipe) {
  const selections = new Map();
  const duplicates = [];
  recipeSelectionArray(recipe).map(normalizeSelection).forEach((selection) => {
    if (!selection.partId) return;
    if (selections.has(selection.partId)) duplicates.push(selection.partId);
    else selections.set(selection.partId, selection);
  });
  const source = object(recipe);
  const rawColors = firstDefined(source.colorChannels, source.colors, source.palettes);
  const colorChannels = new Map();
  if (Array.isArray(rawColors)) {
    rawColors.forEach((color) => {
      const channelId = String(firstDefined(color?.channelId, color?.colorChannelId, color?.paletteId, '') || '');
      if (channelId && !colorChannels.has(channelId)) {
        colorChannels.set(channelId, firstDefined(color?.swatchId, color?.valueId, color?.colorId, color?.value, color?.color));
      }
    });
  } else {
    Object.entries(object(rawColors)).forEach(([channelId, value]) => colorChannels.set(channelId, value));
  }
  selections.forEach((selection) => {
    Object.entries(selection.colorChannels).forEach(([channelId, value]) => colorChannels.set(channelId, value));
  });
  return { selections, colorChannels, duplicates };
}

function makerParts(maker) {
  return array(firstDefined(maker?.parts, maker?.document?.parts));
}

function makerCanvas(maker) {
  const canvas = object(firstDefined(maker?.canvas, maker?.document?.canvas, maker?.template?.canvas));
  return {
    width: positive(canvas.width, 1024),
    height: positive(canvas.height, 1024),
    pixelMode: normalizePixelMode(firstDefined(canvas.pixelMode, maker?.pixelMode)),
    background: firstDefined(canvas.background, canvas.backgroundColor, null),
  };
}

function normalizeTrack(track, index) {
  return {
    id: idOf(track, `track-${index + 1}`),
    name: String(firstDefined(track?.name, track?.label, idOf(track, `Track ${index + 1}`))),
    order: finite(firstDefined(track?.order, track?.renderOrder), Number.MAX_SAFE_INTEGER),
    visible: track?.visible !== false,
    locked: track?.locked !== false,
  };
}

function makerTracks(maker) {
  const declared = array(firstDefined(maker?.layerTracks, maker?.document?.layerTracks, maker?.tracks));
  const tracks = declared.map(normalizeTrack);
  return tracks.sort((left, right) => (
    compareNumber(left.order, right.order)
    || compareText(left.id, right.id)
  ));
}

function makerAssets(maker) {
  const index = new Map();
  const assets = firstDefined(maker?.assets, maker?.document?.assets, maker?.assetIndex);
  if (Array.isArray(assets)) {
    assets.forEach((asset, assetIndex) => {
      const id = String(firstDefined(asset?.id, asset?.assetId, asset?.identifier, `asset-${assetIndex + 1}`));
      index.set(id, asset);
    });
  } else {
    Object.entries(object(assets)).forEach(([id, asset]) => index.set(id, asset));
  }
  return index;
}

function normalizeChannel(channel, index) {
  const values = array(firstDefined(channel?.values, channel?.colors, channel?.entries, channel?.swatches)).map((value, valueIndex) => ({
    id: idOf(value, `value-${valueIndex + 1}`),
    value: String(firstDefined(value?.value, value?.hex, value?.color, value?.hintColor, idOf(value, '')) || ''),
    source: value,
  }));
  return {
    id: idOf(channel, `channel-${index + 1}`),
    name: String(firstDefined(channel?.name, channel?.label, idOf(channel, `Channel ${index + 1}`))),
    mode: String(firstDefined(channel?.mode, channel?.type, 'gradient-map')),
    defaultValueId: String(firstDefined(channel?.defaultSwatchId, channel?.defaultValueId, channel?.defaultColorId, values[0]?.id, '') || ''),
    values,
    source: channel,
  };
}

function makerChannels(maker, parts) {
  const declared = array(firstDefined(maker?.colorChannels, maker?.document?.colorChannels, maker?.palettes));
  const channels = declared.map(normalizeChannel);
  const ids = new Set(channels.map((channel) => channel.id));
  parts.forEach((part, index) => {
    const colors = array(part?.colors);
    if (!colors.length) return;
    const id = String(firstDefined(part?.colorChannelId, part?.paletteId, idOf(part, `part-${index + 1}`)));
    if (!ids.has(id)) {
      channels.push(normalizeChannel({ id, name: `${firstDefined(part?.name, part?.label, id)} color`, values: colors }, channels.length));
      ids.add(id);
    }
  });
  return channels;
}

function selectedChannel(channel, rawSelection) {
  const rawId = String(firstDefined(rawSelection?.valueId, rawSelection?.colorId, rawSelection?.id, rawSelection, '') || '');
  const rawValue = String(firstDefined(rawSelection?.value, rawSelection?.hex, rawSelection, '') || '');
  const match = channel.values.find((value) => value.id === rawId || value.value.toLowerCase() === rawValue.toLowerCase());
  const fallback = channel.values.find((value) => value.id === channel.defaultValueId) || channel.values[0];
  const value = match || fallback;
  return {
    id: channel.id,
    name: channel.name,
    mode: channel.mode,
    valueId: value?.id || rawId,
    swatchId: value?.id || rawId,
    value: value?.value || rawValue,
    definition: channel.source,
    valueDefinition: value?.source,
    matched: Boolean(match || (!rawId && !rawValue && fallback)),
  };
}

function normalizeTransform(style, asset, canvas) {
  const transform = object(style?.transform);
  const baseScale = finite(firstDefined(transform.scale, style?.scale), 1);
  const flipX = firstDefined(transform.flipX, style?.flipX) ? -1 : 1;
  const flipY = firstDefined(transform.flipY, style?.flipY) ? -1 : 1;
  const width = positive(firstDefined(transform.width, style?.width, asset?.width), canvas.width);
  const height = positive(firstDefined(transform.height, style?.height, asset?.height), canvas.height);
  return {
    x: finite(firstDefined(transform.x, style?.x), 0),
    y: finite(firstDefined(transform.y, style?.y), 0),
    width,
    height,
    scaleX: finite(firstDefined(transform.scaleX, style?.scaleX), baseScale) * flipX,
    scaleY: finite(firstDefined(transform.scaleY, style?.scaleY), baseScale) * flipY,
    rotation: finite(firstDefined(transform.rotation, transform.rotationDegrees, style?.rotation), 0),
    originX: finite(firstDefined(transform.originX, transform.anchorX, style?.originX), width / 2),
    originY: finite(firstDefined(transform.originY, transform.anchorY, style?.originY), height / 2),
  };
}

function stylesFor(item) {
  return array(item?.styles);
}

function selectedStyle(item, selection, issues, path) {
  const styles = stylesFor(item);
  if (!styles.length) {
    issues.push({ code: 'missing-styles', path, message: `Item "${selection.itemId}" has no Styles.` });
    return null;
  }
  const requested = selection.styleId;
  if (requested) {
    const style = styles.find((candidate) => idOf(candidate) === requested);
    if (!style) issues.push({ code: 'unknown-style', path, message: `Recipe selects missing Style "${requested}".` });
    return style || null;
  }
  const defaultId = String(item?.defaultStyleId || '');
  if (defaultId) {
    const style = styles.find((candidate) => idOf(candidate) === defaultId);
    if (!style) issues.push({ code: 'unknown-default-style', path, message: `Item has missing default Style "${defaultId}".` });
    return style || null;
  }
  if (styles.length === 1) return styles[0];
  issues.push({ code: 'style-required', path, message: 'Recipe must select a Style for this Item.' });
  return null;
}

function styleAssetId(style) {
  return String(firstDefined(style?.assetId, style?.sourceAssetId, style?.identifier, style?.source?.assetId, style?.source?.id, '') || '');
}

function trackIdFor(style, trackById) {
  const requested = String(firstDefined(style?.layerTrackId, style?.trackId, '') || '');
  if (trackById.has(requested)) return requested;
  return requested;
}

function selectedItem(part, selection, issues, path) {
  const items = array(part?.items);
  const item = items.find((candidate) => idOf(candidate) === selection.itemId);
  if (!item) issues.push({ code: 'unknown-item', path, message: `Recipe selects missing Item "${selection.itemId}".` });
  return item || null;
}

function partChannel(part, selection, channelById, recipeChannels) {
  const channelId = String(firstDefined(part?.colorChannelId, part?.paletteId, idOf(part)) || '');
  const channel = channelById.get(channelId);
  if (!channel) return null;
  const raw = firstDefined(selection.colorChannels[channelId], selection.color, recipeChannels.get(channelId));
  return selectedChannel(channel, raw);
}

function styleChannel(style, inherited, channelById, recipeChannels, selection) {
  const channelId = String(firstDefined(style?.colorChannelId, style?.paletteId, inherited?.id, '') || '');
  const channel = channelById.get(channelId);
  if (!channel) return inherited || null;
  const raw = firstDefined(selection.colorChannels[channelId], recipeChannels.get(channelId), inherited?.valueId);
  return selectedChannel(channel, raw);
}

function sortLayers(left, right) {
  return compareNumber(left.trackOrder, right.trackOrder)
    || compareText(left.trackId, right.trackId)
    || compareNumber(left.order, right.order)
    || compareText(left.partId, right.partId)
    || compareText(left.itemId, right.itemId)
    || compareText(left.styleId, right.styleId);
}

function resolutionError(issues) {
  const error = new Error(issues.map((issue) => issue.message).join(' '));
  error.name = 'MakerSceneResolutionError';
  error.issues = issues;
  return error;
}

/**
 * Resolve an Animacraft Maker document and recipe into a stable, serializable
 * back-to-front layer list. Recipe order never controls z-order.
 *
 * A v5 Style is the only renderable unit: one selected Style produces exactly
 * one resolved scene layer. Older multi-binding document graphs are not
 * interpreted here.
 */
export function resolveMakerScene(maker, recipe, options = {}) {
  if (!maker || typeof maker !== 'object') throw new TypeError('A Maker document is required.');
  const canvas = makerCanvas(maker);
  const parts = makerParts(maker);
  const tracks = makerTracks(maker);
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const assets = makerAssets(maker);
  const channels = makerChannels(maker, parts);
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const effectiveRecipe = recipe === undefined || recipe === null
    ? firstDefined(maker.defaultRecipe, maker.document?.defaultRecipe, { selections: [] })
    : recipe;
  const normalizedRecipe = normalizeRecipe(effectiveRecipe);
  const issues = normalizedRecipe.duplicates.map((partId) => ({
    code: 'duplicate-selection',
    path: `recipe.${partId}`,
    message: `Recipe selects Part "${partId}" more than once.`,
  }));

  if (options.useRequiredDefaults) {
    parts.forEach((part) => {
      const partId = idOf(part);
      if (!normalizedRecipe.selections.has(partId) && (part.required === true || part.allowRemove === false)) {
        const defaultItemId = String(firstDefined(part.defaultItemId, '') || '');
        const defaultItem = array(part?.items).find((item) => idOf(item) === defaultItemId);
        const defaultStyleId = String(firstDefined(defaultItem?.defaultStyleId, stylesFor(defaultItem)[0]?.id, '') || '');
        if (defaultItemId) normalizedRecipe.selections.set(partId, normalizeSelection({ partId, itemId: defaultItemId, styleId: defaultStyleId }));
      }
    });
  }

  // Resolve omitted Style ids before evaluating any visibility condition so
  // cross-Part Style selectors have the same result regardless of Part order.
  normalizedRecipe.selections.forEach((selection, partId) => {
    if (!selection.itemId || selection.styleId) return;
    const part = parts.find((candidate) => idOf(candidate) === partId);
    const item = array(part?.items).find((candidate) => idOf(candidate) === selection.itemId);
    const styles = stylesFor(item);
    const defaultStyleId = String(item?.defaultStyleId || '');
    const defaultStyle = styles.find((style) => idOf(style) === defaultStyleId);
    if (defaultStyle || styles.length === 1) selection.styleId = idOf(defaultStyle || styles[0]);
  });

  const conditionContext = {
    selections: normalizedRecipe.selections,
    colorChannels: normalizedRecipe.colorChannels,
    flags: options.flags,
    maker,
    recipe: effectiveRecipe,
  };
  const layers = [];

  parts.forEach((part, partIndex) => {
    const partId = idOf(part, `part-${partIndex + 1}`);
    const selection = normalizedRecipe.selections.get(partId);
    if (!selection || !selection.itemId) return;
    const path = `parts.${partId}`;
    const parentPartId = String(firstDefined(part?.parentPartId, part?.parentId, '') || '');
    if (parentPartId && !normalizedRecipe.selections.get(parentPartId)?.itemId) return;
    if (!evaluateVisibleWhen(part.visibleWhen, conditionContext)) return;

    const item = selectedItem(part, selection, issues, path);
    if (!item || !evaluateVisibleWhen(item.visibleWhen, conditionContext)) return;
    const style = selectedStyle(item, selection, issues, `${partId}/${selection.itemId}`);
    if (!style || !evaluateVisibleWhen(style.visibleWhen, conditionContext)) return;
    const styleId = idOf(style);
    const inheritedChannel = partChannel(part, selection, channelById, normalizedRecipe.colorChannels);
    const trackId = trackIdFor(style, trackById);
    const track = trackById.get(trackId);
    const stylePath = `${partId}/${selection.itemId}/${styleId}`;
    if (!track) {
      issues.push({ code: 'unknown-layer-track', path: stylePath, message: `Style references missing LayerTrack "${trackId}".` });
      return;
    }
    if (!track.visible) return;
    const colorChannel = styleChannel(style, inheritedChannel, channelById, normalizedRecipe.colorChannels, selection);
    const assetId = styleAssetId(style);
    if (!assetId) {
      issues.push({ code: 'missing-asset-reference', path: stylePath, message: `Style "${styleId}" has no Asset.` });
      return;
    }
    const asset = assets.get(assetId) || null;
    if (!asset && assets.size && options.allowUnindexedAssets !== true) {
      issues.push({ code: 'unknown-asset', path: stylePath, message: `Style references missing Asset "${assetId}".` });
      return;
    }
    const blendMode = normalizeBlendMode(style.blendMode);
    layers.push({
      key: stylePath,
      partId,
      itemId: selection.itemId,
      styleId,
      trackId,
      trackOrder: track.order,
      order: finite(firstDefined(style.order, style.renderOrder, style.displayOrder), 0),
      partOrder: finite(firstDefined(part.menuOrder, part.order), partIndex),
      assetId,
      asset,
      transform: normalizeTransform(style, asset, canvas),
      transformSource: 'style',
      opacity: normalizeOpacity(firstDefined(style.opacity, 1)),
      blendMode,
      compositeOperation: BLEND_MODES[blendMode],
      pixelMode: normalizePixelMode(firstDefined(style.pixelMode, canvas.pixelMode)),
      colorChannel,
    });
  });

  layers.sort(sortLayers);
  const scene = {
    schemaVersion: MAKER_SCENE_VERSION,
    width: canvas.width,
    height: canvas.height,
    pixelMode: canvas.pixelMode,
    background: canvas.background,
    layers,
    issues,
  };
  if (options.strict && issues.length) throw resolutionError(issues);
  return scene;
}

function drawable(value) {
  return value && typeof value === 'object'
    && (typeof value.width === 'number' || typeof value.naturalWidth === 'number' || typeof value.videoWidth === 'number');
}

function canvasContext(target) {
  if (target && typeof target.getContext === 'function') {
    const context = target.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    return { canvas: target, context };
  }
  if (target && target.canvas) return { canvas: target.canvas, context: target };
  throw new TypeError('A Canvas element or CanvasRenderingContext2D is required.');
}

async function loadUrl(url, signal) {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') {
    throw new Error('URL assets require browser fetch and createImageBitmap support.');
  }
  const blob = await fetchMakerAssetBlob(url, { signal, label: 'Maker asset' });
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
    assertMakerAssetDimensions(bitmap, 'Maker asset');
    if (signal?.aborted) {
      if (signal.reason instanceof Error) throw signal.reason;
      if (typeof DOMException === 'function') throw new DOMException('Maker asset loading was aborted.', 'AbortError');
      const error = new Error('Maker asset loading was aborted.');
      error.name = 'AbortError';
      throw error;
    }
    return { source: bitmap, dispose: () => bitmap.close?.() };
  } catch (error) {
    bitmap?.close?.();
    throw error;
  }
}

async function defaultAssetSource(layer, signal) {
  const descriptor = layer.asset;
  const candidate = firstDefined(
    descriptor?.image,
    descriptor?.bitmap,
    descriptor?.element,
    descriptor?.blob,
    descriptor?.file,
    descriptor?.url,
    descriptor?.legacy?.url,
    drawable(descriptor?.source) ? descriptor.source : undefined,
    descriptor,
  );
  if (drawable(candidate)) {
    assertMakerAssetDimensions(candidate, `Asset "${layer.assetId}"`);
    return { source: candidate, dispose: null };
  }
  if (typeof Blob !== 'undefined' && candidate instanceof Blob) {
    if (typeof createImageBitmap !== 'function') throw new Error('Blob assets require createImageBitmap support.');
    if (candidate.size > MAX_MAKER_ASSET_BYTES) {
      const error = new Error(`Asset "${layer.assetId}" is larger than 20 MB.`);
      error.code = 'MAKER_ASSET_LIMIT_EXCEEDED';
      throw error;
    }
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(candidate);
      assertMakerAssetDimensions(bitmap, `Asset "${layer.assetId}"`);
      if (signal?.aborted) {
        if (signal.reason instanceof Error) throw signal.reason;
        if (typeof DOMException === 'function') throw new DOMException('Maker asset loading was aborted.', 'AbortError');
        const error = new Error('Maker asset loading was aborted.');
        error.name = 'AbortError';
        throw error;
      }
      return { source: bitmap, dispose: () => bitmap.close?.() };
    } catch (error) {
      bitmap?.close?.();
      throw error;
    }
  }
  if (typeof candidate === 'string') return loadUrl(candidate, signal);
  throw new Error(`Asset "${layer.assetId}" has no drawable source.`);
}

function normalizedSource(result) {
  if (drawable(result)) return { source: result, dispose: null };
  if (result && drawable(result.source)) return { source: result.source, dispose: result.dispose || result.release || null };
  return null;
}

async function sourceForLayer(layer, scene, options) {
  const custom = options.resolveAsset
    ? normalizedSource(await options.resolveAsset(layer.assetId, layer.asset, layer, scene))
    : null;
  const loaded = custom || await defaultAssetSource(layer, options.signal);
  if (!options.applyColorChannel || !layer.colorChannel) return loaded;
  const colored = normalizedSource(await options.applyColorChannel({
    source: loaded.source,
    channel: layer.colorChannel,
    layer,
    scene,
    signal: options.signal,
  }));
  if (!colored) throw new Error(`Color channel processor returned no drawable source for "${layer.assetId}".`);
  return {
    source: colored.source,
    dispose: () => {
      colored.dispose?.();
      loaded.dispose?.();
    },
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw new DOMException('The render was aborted.', 'AbortError');
}

/** Render a previously resolved scene into a Canvas 2D target. */
export async function renderResolvedScene(scene, target, options = {}) {
  if (!scene || scene.schemaVersion !== MAKER_SCENE_VERSION) throw new TypeError('A resolved Maker scene is required.');
  const { canvas, context } = canvasContext(target);
  if (options.resize !== false) {
    canvas.width = scene.width;
    canvas.height = scene.height;
  }

  if (options.clear !== false) {
    context.save();
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (scene.background) {
      context.fillStyle = scene.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.restore();
  }

  let drawn = 0;
  const skipped = [];
  for (const layer of scene.layers) {
    throwIfAborted(options.signal);
    let loaded;
    try {
      loaded = await sourceForLayer(layer, scene, options);
    } catch (error) {
      if (!options.skipMissingAssets) throw error;
      skipped.push({ layer, error });
      continue;
    }
    const transform = layer.transform;
    try {
      context.save();
      context.imageSmoothingEnabled = PIXEL_MODES[layer.pixelMode];
      if (layer.pixelMode === 'linear' && 'imageSmoothingQuality' in context) context.imageSmoothingQuality = options.imageSmoothingQuality || 'high';
      context.globalAlpha = layer.opacity;
      context.globalCompositeOperation = layer.compositeOperation;
      // x/y remain the PNG's top-left at rotation 0. The rotation pivot is
      // expressed in unscaled PNG coordinates, so move to its scaled canvas
      // position before applying rotation and scale.
      context.translate(
        transform.x + Math.abs(transform.scaleX) * transform.originX,
        transform.y + Math.abs(transform.scaleY) * transform.originY,
      );
      context.rotate(transform.rotation * Math.PI / 180);
      context.scale(transform.scaleX, transform.scaleY);
      context.translate(-transform.originX, -transform.originY);
      context.drawImage(loaded.source, 0, 0, transform.width, transform.height);
      drawn += 1;
    } finally {
      context.restore();
      loaded.dispose?.();
    }
  }
  return { scene, drawn, skipped };
}

/** Resolve and render with one call. */
export async function renderMakerToCanvas(maker, recipe, target, options = {}) {
  const scene = resolveMakerScene(maker, recipe, options);
  return renderResolvedScene(scene, target, options);
}
