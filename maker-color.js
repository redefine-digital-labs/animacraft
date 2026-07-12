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

function normalizeStops(channel) {
  const raw = channel?.valueDefinition?.stops || channel?.swatch?.stops || [];
  if (Array.isArray(raw) && raw.length >= 2) {
    return raw
      .map((stop) => ({ offset: Math.min(1, Math.max(0, Number(stop.offset))), rgba: parseHex(stop.color) }))
      .sort((left, right) => left.offset - right.offset);
  }
  const color = channel?.valueDefinition?.hintColor || channel?.value || '#7b5cff';
  const [red, green, blue, alpha] = parseHex(color);
  return [
    { offset: 0, rgba: [Math.round(red * 0.18), Math.round(green * 0.18), Math.round(blue * 0.18), alpha] },
    { offset: 0.5, rgba: [red, green, blue, alpha] },
    { offset: 1, rgba: [Math.round(red + ((255 - red) * 0.78)), Math.round(green + ((255 - green) * 0.78)), Math.round(blue + ((255 - blue) * 0.78)), alpha] },
  ];
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

export function createGradientColorProcessor() {
  const cache = new WeakMap();
  return async function applyColorChannel({ source, channel }) {
    if (String(channel?.mode || '').toLowerCase() !== 'gradient-map') return source;
    const stops = normalizeStops(channel);
    const cacheKey = JSON.stringify(stops);
    if (source && typeof source === 'object') {
      const sourceCache = cache.get(source);
      if (sourceCache?.has(cacheKey)) return sourceCache.get(cacheKey);
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
      sourceCache.set(cacheKey, canvas);
      cache.set(source, sourceCache);
    }
    return canvas;
  };
}
