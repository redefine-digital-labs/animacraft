import { assertMakerV8Document } from './maker-v8-document.js';
import { creatorStyleEditorState } from './maker-v8-creator-style.js';

const encoder = new TextEncoder();
const stylesIn = document => document.parts.flatMap(part => part.items.flatMap(item =>
  item.styles.map(style => ({ part, item, style }))));

function label(value) {
  if (typeof value !== 'string' || !value.trim() || encoder.encode(value.trim()).length > 256) {
    throw new TypeError('A Color Channel or preset name must contain 1–256 UTF-8 bytes.');
  }
  return value.trim();
}

function rgba(value, previous = '#000000ff') {
  if (typeof value !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) {
    throw new TypeError('A color must be #RRGGBB or #RRGGBBAA.');
  }
  // The original color input edits RGB; preserve the current v8 alpha channel.
  return (value.length === 7 ? value + previous.slice(7) : value).toLowerCase();
}

/** The same luminance map used by the current renderer for a plain swatch. */
function gradient(value) {
  const color = rgba(value);
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
  const toColor = values => `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}${color.slice(7)}`;
  return [
    { offset: 0, rgba: toColor(rgb.map(value => value * 0.18)) },
    { offset: 0.5, rgba: color },
    { offset: 1, rgba: toColor(rgb.map(value => value + (255 - value) * 0.78)) },
  ];
}

export function creatorColorStops(swatch) {
  return swatch.stops.length >= 2 ? swatch.stops.map(stop => ({ ...stop })) : gradient(swatch.rgba);
}

function validate(document) {
  assertMakerV8Document(document, { mode: 'draft' });
  // Match the compiler's swatch label bound at the author edit boundary too.
  for (const channel of document.colors) for (const swatch of channel.swatches) {
    label(swatch.label);
  }
}

function uniqueKey(rows, initial) {
  let suffix = initial;
  while (rows.some(row => row.key === `color-${suffix}`)) suffix += 1;
  return `color-${suffix}`;
}

function setRecipeColor(document, channelKey, swatchKey) {
  const selection = document.defaultRecipe.colors.find(row => row.channelKey === channelKey);
  if (selection) selection.swatchKey = swatchKey;
  else document.defaultRecipe.colors.push({ channelKey, swatchKey });
}

export function creatorColorState(document, channelKey) {
  const channel = document.colors.find(row => row.key === channelKey);
  const bindings = channel ? stylesIn(document).filter(({ style }) => style.colorChannelKey === channelKey) : [];
  const locked = bindings.some(({ style }) => creatorStyleEditorState(style).styleLocked);
  return { bindings, locked, canDeleteSwatch: Boolean(channel && !locked && channel.swatches.length > 1) };
}

/** Immutable author edits for the existing Smart Color controls. A channel is
 * shared by every linked Style, so any whole-Style lock protects all its edits.
 * Explicit per-Style defaults survive a channel default change; deleted defaults
 * are repaired to the surviving channel default in the same document change. */
export function prepareCreatorColorChange({ document, action, channelKey, swatchKey,
  partKey, itemKey, styleKey, value, stopIndex } = {}) {
  validate(document);
  const next = structuredClone(document);
  let selectedColorKey;
  let locked = false;
  if (action === 'add-channel') {
    const key = uniqueKey(next.colors, next.colors.length + 1);
    next.colors.push({ key, label: label(value === undefined ? `Color ${next.colors.length + 1}` : value),
      defaultSwatchKey: 'default', swatches: [
        { key: 'default', label: 'Default', rgba: '#7b5cffff', stops: gradient('#7b5cffff') },
      ] });
    setRecipeColor(next, key, 'default');
    selectedColorKey = key;
  } else if (action === 'assign-style-color') {
    const style = next.parts.find(part => part.key === partKey)?.items.find(item => item.key === itemKey)
      ?.styles.find(row => row.key === styleKey);
    if (!style) throw new TypeError('The selected Maker Style no longer exists.');
    if (typeof value !== 'string' || value && !next.colors.some(row => row.key === value)) {
      throw new TypeError('Choose an existing Color Channel or No Smart Color.');
    }
    locked = creatorStyleEditorState(style).styleLocked;
    if (style.colorChannelKey !== (value || null)) {
      style.colorChannelKey = value || null;
      style.defaultSwatchKey = next.colors.find(row => row.key === value)?.defaultSwatchKey ?? null;
    }
    if (value) selectedColorKey = value;
  } else {
    const channel = next.colors.find(row => row.key === channelKey);
    if (!channel) throw new TypeError('The selected Color Channel no longer exists.');
    locked = creatorColorState(next, channelKey).locked;
    selectedColorKey = channelKey;
    if (action === 'delete-channel') {
      const index = next.colors.indexOf(channel);
      next.colors.splice(index, 1);
      for (const { style } of stylesIn(next)) if (style.colorChannelKey === channelKey) {
        style.colorChannelKey = null;
        style.defaultSwatchKey = null;
      }
      next.defaultRecipe.colors = next.defaultRecipe.colors.filter(row => row.channelKey !== channelKey);
      selectedColorKey = next.colors[Math.min(index, next.colors.length - 1)]?.key ?? null;
    } else if (action === 'channel-name') channel.label = label(value);
    else if (action === 'add-swatch') {
      channel.swatches.push({ key: uniqueKey(channel.swatches, channel.swatches.length + 1),
        label: label(value === undefined ? `Color ${channel.swatches.length + 1}` : value),
        rgba: '#f06f8fff', stops: gradient('#f06f8fff') });
    } else if (action === 'channel-default-swatch') {
      if (typeof value !== 'string' || !channel.swatches.some(row => row.key === value)) {
        throw new TypeError('Choose an existing Color preset.');
      }
      channel.defaultSwatchKey = value;
      setRecipeColor(next, channelKey, value);
    } else {
      const swatch = channel.swatches.find(row => row.key === swatchKey);
      if (!swatch) throw new TypeError('The selected Color preset no longer exists.');
      if (action === 'delete-swatch') {
        if (channel.swatches.length <= 1) throw new TypeError('Keep at least one Color preset in this channel.');
        channel.swatches = channel.swatches.filter(row => row.key !== swatchKey);
        if (channel.defaultSwatchKey === swatchKey) channel.defaultSwatchKey = channel.swatches[0].key;
        for (const { style } of stylesIn(next)) {
          if (style.colorChannelKey === channelKey && style.defaultSwatchKey === swatchKey) {
            style.defaultSwatchKey = channel.defaultSwatchKey;
          }
        }
        for (const selection of next.defaultRecipe.colors) {
          if (selection.channelKey === channelKey && selection.swatchKey === swatchKey) {
            selection.swatchKey = channel.defaultSwatchKey;
          }
        }
      } else if (action === 'swatch-name') swatch.label = label(value);
      else if (action === 'swatch-hint') {
        swatch.rgba = rgba(value, swatch.rgba);
        swatch.stops = gradient(swatch.rgba);
      } else if (action === 'swatch-mid') {
        const middle = Math.floor((swatch.stops.length - 1) / 2);
        const color = rgba(value, swatch.stops.length >= 3 ? swatch.stops[middle].rgba : swatch.rgba);
        if (swatch.stops.length < 2) swatch.stops = gradient(swatch.rgba);
        if (swatch.stops.length === 2) swatch.stops.splice(1, 0, { offset: 0.5, rgba: color });
        else swatch.stops[Math.floor((swatch.stops.length - 1) / 2)].rgba = color;
        swatch.rgba = color;
      } else if (action === 'swatch-stop') {
        const index = typeof stopIndex === 'string' && /^(0|[1-9]\d*)$/.test(stopIndex) ? Number(stopIndex) : stopIndex;
        const count = swatch.stops.length;
        if (!Number.isSafeInteger(index) || index < 0 || index >= (count < 2 ? 3 : count)) {
          throw new TypeError('Choose an existing gradient stop.');
        }
        // Zero/one stored stops render as the derived three-stop gradient.
        if (count < 2) swatch.stops = gradient(swatch.rgba);
        swatch.stops[index].rgba = rgba(value, swatch.stops[index].rgba);
      } else throw new TypeError('Unknown Smart Color edit.');
    }
  }
  validate(next);
  const changed = JSON.stringify(next) !== JSON.stringify(document);
  if (changed && locked) throw new TypeError('Unlock every linked whole Style before editing its Smart Color.');
  return { document: changed ? next : document, changed,
    ...(selectedColorKey === undefined ? {} : { selectedColorKey }) };
}
