function parseHex(color) {
  const value = String(color || '').replace(/^#/, '');
  const normalized = value.length === 3
    ? value.split('').map((part) => `${part}${part}`).join('')
    : value;
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(normalized)) return [127, 127, 127, 255];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    normalized.length === 8 ? Number.parseInt(normalized.slice(6, 8), 16) : 255,
  ];
}

function byteToHex(value) {
  return Math.min(255, Math.max(0, Math.round(Number(value) || 0)))
    .toString(16)
    .padStart(2, '0');
}

function rgbToHex(red, green, blue) {
  return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}`;
}

/**
 * Build a luminance-preserving gradient map from one creator-facing primary
 * color. Keeping this derivation shared prevents the palette preview and the
 * rendered PNG from drifting apart.
 */
export function gradientStopsForColor(color) {
  const [red, green, blue] = parseHex(color);
  const normalized = rgbToHex(red, green, blue);
  return [
    {
      offset: 0,
      color: rgbToHex(red * 0.18, green * 0.18, blue * 0.18),
    },
    { offset: 0.5, color: normalized },
    {
      offset: 1,
      color: rgbToHex(
        red + ((255 - red) * 0.78),
        green + ((255 - green) * 0.78),
        blue + ((255 - blue) * 0.78),
      ),
    },
  ];
}

function normalizeStops(channel) {
  const raw = channel?.valueDefinition?.stops || channel?.swatch?.stops || [];
  if (Array.isArray(raw) && raw.length >= 2) {
    return raw
      .map((stop) => ({ offset: Math.min(1, Math.max(0, Number(stop.offset))), rgba: parseHex(stop.color) }))
      .sort((left, right) => left.offset - right.offset);
  }
  const color = channel?.valueDefinition?.hintColor || channel?.value || '#7b5cff';
  return gradientStopsForColor(color).map((stop) => ({
    offset: stop.offset,
    rgba: parseHex(stop.color),
  }));
}

function sampleStops(stops, value) {
  const rightIndex = stops.findIndex((stop) => stop.offset >= value);
  if (rightIndex <= 0) return stops[0].rgba;
  if (rightIndex < 0) return stops.at(-1).rgba;
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  const span = Math.max(0.000001, right.offset - left.offset);
  const mix = (value - left.offset) / span;
  return left.rgba.map((channel, index) => Math.round(channel + ((right.rgba[index] - channel) * mix)));
}

function sourceSize(source) {
  return {
    width: Number(source?.width || source?.naturalWidth || source?.videoWidth || 0),
    height: Number(source?.height || source?.naturalHeight || source?.videoHeight || 0),
  };
}

const MAX_GRADIENT_COLOR_CACHE_PIXELS = 16 * 1024 * 1024;

export function gradientMapPixels(imageData, stops) {
  const result = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = result.data;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (!alpha) continue;
    const luminance = ((data[index] * 0.2126) + (data[index + 1] * 0.7152) + (data[index + 2] * 0.0722)) / 255;
    const mapped = sampleStops(stops, luminance);
    data[index] = mapped[0];
    data[index + 1] = mapped[1];
    data[index + 2] = mapped[2];
    data[index + 3] = Math.round(alpha * (mapped[3] / 255));
  }
  return result;
}

export function createGradientColorProcessor({
  maxCachePixels = MAX_GRADIENT_COLOR_CACHE_PIXELS,
} = {}) {
  const cache = new WeakMap();
  const lru = new Set();
  const pixelBudget = Math.max(1, Number(maxCachePixels) || MAX_GRADIENT_COLOR_CACHE_PIXELS);
  let cachedPixels = 0;

  const touch = (entry) => {
    lru.delete(entry);
    lru.add(entry);
  };
  const releaseCanvas = (entry) => {
    if (entry.released || entry.users > 0) return;
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.released = true;
  };
  const evict = (entry) => {
    if (!entry || entry.evicted) return;
    entry.evicted = true;
    entry.sourceCache.delete(entry.cacheKey);
    lru.delete(entry);
    cachedPixels -= entry.pixels;
    releaseCanvas(entry);
  };
  const trim = () => {
    while (cachedPixels > pixelBudget && lru.size > 1) {
      evict(lru.values().next().value);
    }
  };
  const acquire = (entry) => {
    entry.users += 1;
    touch(entry);
    let disposed = false;
    return {
      source: entry.canvas,
      dispose() {
        if (disposed) return;
        disposed = true;
        entry.users = Math.max(0, entry.users - 1);
        if (entry.evicted) releaseCanvas(entry);
      },
    };
  };

  const applyColorChannel = async function applyColorChannel({ source, channel }) {
    if (String(channel?.mode || '').toLowerCase() !== 'gradient-map') return source;
    const stops = normalizeStops(channel);
    const cacheKey = JSON.stringify(stops);
    if (source && typeof source === 'object') {
      const sourceCache = cache.get(source);
      const entry = sourceCache?.get(cacheKey);
      if (entry && !entry.evicted) return acquire(entry);
    }
    const { width, height } = sourceSize(source);
    if (!width || !height) return source;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    context.putImageData(gradientMapPixels(pixels, stops), 0, 0);
    if (source && typeof source === 'object') {
      const sourceCache = cache.get(source) || new Map();
      const entry = {
        cacheKey,
        canvas,
        evicted: false,
        pixels: width * height,
        released: false,
        sourceCache,
        users: 0,
      };
      sourceCache.set(cacheKey, entry);
      cache.set(source, sourceCache);
      cachedPixels += entry.pixels;
      touch(entry);
      trim();
      return acquire(entry);
    }
    return canvas;
  };
  applyColorChannel.clear = () => {
    [...lru].forEach(evict);
    lru.clear();
    cachedPixels = 0;
  };
  return applyColorChannel;
}

export { MAX_GRADIENT_COLOR_CACHE_PIXELS };
