import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';

// Kept in the standalone shared renderer so both products validate the exact
// same plaintext identity shape without a checkout-relative module dependency.
export function isMakerV8SourceAsset(value) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || !keys.every(key => ['sha256', 'mediaType', 'byteLength'].includes(key))) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) return false;
  return typeof fields.sha256.value === 'string' && /^[0-9a-f]{64}$/.test(fields.sha256.value)
    && typeof fields.mediaType.value === 'string' && fields.mediaType.value.length > 0
    && fields.mediaType.value.length <= 256
    && Number.isSafeInteger(fields.byteLength.value) && fields.byteLength.value > 0;
}

// Final-image settings. Main preview and equipment rendering omit them;
// completion binds the chosen settings and exact PNG without changing recipe.
export const MAKER_V8_STANDARD_EXPORT_MAX_EDGE = 1024;
export const MAKER_V8_ORIGINAL_EXPORT_MAX_PIXELS = 8_388_608;

export function makerV8ExportSizes(canvas) {
  const { width, height } = canvas ?? {};
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192)) {
    throw new TypeError('Export requires exact Maker canvas dimensions.');
  }
  const scale = Math.min(1, MAKER_V8_STANDARD_EXPORT_MAX_EDGE / Math.max(width, height));
  return Object.freeze({
    original: Object.freeze({ width, height }),
    standard: Object.freeze({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }),
    originalSafe: width * height <= MAKER_V8_ORIGINAL_EXPORT_MAX_PIXELS,
  });
}

export function exactMakerV8ExportOptions(canvas, options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype
    || Reflect.ownKeys(options).some(key => !['sizeMode', 'transparent'].includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(options)).some(field => !Object.hasOwn(field, 'value') || !field.enumerable)
    || !Object.hasOwn(options, 'sizeMode')
    || !['standard', 'original'].includes(options.sizeMode)
    || (Object.hasOwn(options, 'transparent') && typeof options.transparent !== 'boolean')) {
    throw new TypeError('Export requires standard/original size and a boolean background option.');
  }
  const sizes = makerV8ExportSizes(canvas);
  if (options.sizeMode === 'original' && !sizes.originalSafe) {
    throw new RangeError('Original export exceeds the safe pixel limit.');
  }
  return Object.freeze({ sizeMode: options.sizeMode, transparent: options.transparent === true });
}

// Protocol u8 codes follow the original Creator menu order. Keep codes 0..3 stable.
export const MAKER_V8_BLEND_MODES = Object.freeze([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'linear-dodge',
]);
export const MAKER_V8_BLEND_CODES = Object.freeze(Object.fromEntries(
  MAKER_V8_BLEND_MODES.map((mode, code) => [mode, code]),
));
export const MAKER_V8_CANVAS_BLEND_MODES = Object.freeze(Object.fromEntries(
  MAKER_V8_BLEND_MODES.map(mode => [mode, mode === 'normal' ? 'source-over' : mode === 'linear-dodge' ? 'lighter' : mode]),
));

// Pure drawing only. Callers establish document, selection, asset and decrypt authority.
const HASH = /^[0-9a-f]{64}$/;
const RGBA = /^#[0-9a-fA-F]{8}$/;
// Same accepted document canvas/transform, total-capacity and certified-byte bounds.
const MAX_DIMENSION = 8192;
const MAX_LAYERS = 500;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BASE64 = Math.ceil(MAX_ASSET_BYTES / 3) * 4;
const encoder = new TextEncoder();

export class MakerV8PlayerJourneyError extends Error {
  constructor(code, message, layer = 'PLAYER_JOURNEY', details = {}) {
    super(message);
    this.name = 'MakerV8PlayerJourneyError';
    this.code = code;
    this.layer = layer;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, layer, details) {
  throw new MakerV8PlayerJourneyError(code, message, layer, details);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function compareProtocolText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canvasFactoryDefault() {
  const canvas = globalThis.document?.createElement?.('canvas');
  if (!canvas) {
    fail('MAKER_V8_PLAYER_JOURNEY_CANVAS_UNAVAILABLE', 'Browser Canvas 2D is required for character completion.', 'RENDER');
  }
  return canvas;
}

function rgbaBytes(value, label) {
  if (typeof value !== 'string' || !RGBA.test(value)) {
    fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_INVALID', `${label} is not exact #RRGGBBAA content.`, 'RENDER');
  }
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    Number.parseInt(value.slice(7, 9), 16),
  ];
}

function smartColorStops(swatch) {
  if (!plain(swatch) || typeof swatch.key !== 'string' || !Array.isArray(swatch.stops)) {
    fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_INVALID', 'The selected Smart Color swatch is invalid.', 'RENDER');
  }
  if (swatch.stops.length >= 2) {
    return swatch.stops.map((stop, index) => {
      if (!plain(stop) || typeof stop.offset !== 'number' || !Number.isFinite(stop.offset)
        || stop.offset < 0 || stop.offset > 1) {
        fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_INVALID', `Smart Color stop ${index} is invalid.`, 'RENDER');
      }
      return { offset: stop.offset, rgba: rgbaBytes(stop.rgba, `Smart Color stop ${index}`) };
    }).sort((left, right) => left.offset - right.offset);
  }
  const [red, green, blue, alpha] = rgbaBytes(swatch.rgba, 'Smart Color swatch');
  return [
    {
      offset: 0,
      rgba: [
        Math.round(red * 0.18),
        Math.round(green * 0.18),
        Math.round(blue * 0.18),
        alpha,
      ],
    },
    { offset: 0.5, rgba: [red, green, blue, alpha] },
    {
      offset: 1,
      rgba: [
        Math.round(red + ((255 - red) * 0.78)),
        Math.round(green + ((255 - green) * 0.78)),
        Math.round(blue + ((255 - blue) * 0.78)),
        alpha,
      ],
    },
  ];
}

function sampleStops(stops, value) {
  const rightIndex = stops.findIndex((stop) => stop.offset >= value);
  if (rightIndex <= 0) return stops[0].rgba;
  if (rightIndex < 0) return stops.at(-1).rgba;
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  const span = Math.max(Number.EPSILON, right.offset - left.offset);
  const mix = (value - left.offset) / span;
  return left.rgba.map((channel, index) => (
    Math.round(channel + ((right.rgba[index] - channel) * mix))
  ));
}

/** Deterministic Fresh-v8 gradient mapping over exact decoded RGBA pixels. */
export function mapMakerV8SmartColorPixelsV8(imageData, swatch) {
  if (!plain(imageData) || !Number.isSafeInteger(imageData.width) || imageData.width <= 0
    || !Number.isSafeInteger(imageData.height) || imageData.height <= 0
    || !(imageData.data instanceof Uint8ClampedArray)
    || imageData.data.length !== imageData.width * imageData.height * 4) {
    fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_PIXELS_INVALID', 'Smart Color requires exact RGBA pixels.', 'RENDER');
  }
  const stops = smartColorStops(swatch);
  const data = new Uint8ClampedArray(imageData.data);
  for (let index = 0; index < data.length; index += 4) {
    const sourceAlpha = data[index + 3];
    if (sourceAlpha === 0) continue;
    const luminance = (
      (data[index] * 0.2126)
      + (data[index + 1] * 0.7152)
      + (data[index + 2] * 0.0722)
    ) / 255;
    const mapped = sampleStops(stops, luminance);
    data[index] = mapped[0];
    data[index + 1] = mapped[1];
    data[index + 2] = mapped[2];
    data[index + 3] = Math.round(sourceAlpha * (mapped[3] / 255));
  }
  return { width: imageData.width, height: imageData.height, data };
}

function imageSize(source) {
  return {
    width: source?.naturalWidth ?? source?.videoWidth ?? source?.width ?? 0,
    height: source?.naturalHeight ?? source?.videoHeight ?? source?.height ?? 0,
  };
}

export async function colorizeMakerV8ImageSourceV8({
  source,
  swatch,
  canvasFactory = canvasFactoryDefault,
} = {}) {
  const { width, height } = imageSize(source);
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_SOURCE_INVALID', 'Smart Color source dimensions are unavailable.', 'RENDER');
  }
  const canvas = canvasFactory();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext?.('2d', { willReadFrequently: true });
  if (!context || typeof context.getImageData !== 'function'
    || typeof context.putImageData !== 'function') {
    fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_CANVAS_INVALID', 'Smart Color Canvas pixels are unavailable.', 'RENDER');
  }
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const mapped = mapMakerV8SmartColorPixelsV8({
    width: pixels.width,
    height: pixels.height,
    data: pixels.data,
  }, swatch);
  pixels.data.set(mapped.data);
  context.putImageData(pixels, 0, 0);
  return { source: canvas, close() {} };
}

async function decodeImageDefault(bytes, mediaType) {
  if (typeof globalThis.createImageBitmap !== 'function' || typeof globalThis.Blob !== 'function') {
    fail('MAKER_V8_PLAYER_JOURNEY_IMAGE_DECODER_UNAVAILABLE', 'Browser image decoding is unavailable.', 'RENDER');
  }
  const bitmap = await globalThis.createImageBitmap(new Blob([bytes], { type: mediaType }));
  return { source: bitmap, close: () => bitmap.close?.() };
}

async function pngBytes(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  }
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('PNG encoder returned no bytes.')),
      'image/png',
    ));
    return new Uint8Array(await blob.arrayBuffer());
  }
  fail('MAKER_V8_PLAYER_JOURNEY_PNG_ENCODER_UNAVAILABLE', 'Browser PNG encoding is unavailable.', 'RENDER');
}

function exactRenderableLayer(layer, index) {
  const transform = layer?.transform;
  if (!plain(layer) || !plain(layer.selection) || !plain(layer.asset)
    || !Number.isSafeInteger(layer.selectionIndex) || layer.selectionIndex < 0 || layer.selectionIndex >= MAX_LAYERS
    || !['BASE', 'PACK', 'EXTERNAL'].includes(layer.selection.source)
    || ![layer.selection.partKey, layer.selection.itemKey, layer.selection.styleKey].every(renderKey)
    || !renderKey(layer.asset.assetId) || !HASH.test(layer.asset.sha256 ?? '')
    || typeof layer.asset.mediaType !== 'string' || layer.asset.mediaType.length === 0 || layer.asset.mediaType.length > 256
    || !Number.isSafeInteger(layer.asset.byteLength) || layer.asset.byteLength < 0 || layer.asset.byteLength > MAX_ASSET_BYTES
    || (Object.hasOwn(layer.asset, 'blobId') && (typeof layer.asset.blobId !== 'string'
      || layer.asset.blobId.length === 0 || encoder.encode(layer.asset.blobId).length > 512))
    || !Number.isSafeInteger(layer.trackOrder)
    || !Number.isSafeInteger(layer.displayOrder)
    || !plain(transform)
    || !Number.isFinite(transform.x) || !Number.isFinite(transform.y)
    || Math.abs(transform.x) > MAX_DIMENSION || Math.abs(transform.y) > MAX_DIMENSION
    || !Number.isFinite(transform.scale) || transform.scale <= 0 || transform.scale > 100
    || !Number.isFinite(transform.rotation) || Math.abs(transform.rotation) > 360
    || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1
    || typeof layer.protected !== 'boolean' || (layer.swatch !== null && !plain(layer.swatch))
    || !MAKER_V8_BLEND_MODES.includes(layer.blendMode)) {
    fail(
      'MAKER_V8_PLAYER_JOURNEY_RENDER_LAYER_INVALID',
      'The Recipe contains an invalid deterministic render layer.',
      'RENDER',
      { index },
    );
  }
  if (layer.swatch !== null) smartColorStops(layer.swatch);
  if (layer.protected && (layer.selection.source === 'BASE' || layer.sourceAsset != null) && !isMakerV8SourceAsset(layer.sourceAsset)) {
    fail('MAKER_V8_PLAYER_PROTECTED_SOURCE_INVALID', 'Protected Base rendering requires its certified source identity.', 'PROTECTION');
  }
  return layer;
}

function renderKey(value) {
  return typeof value === 'string' && value.length > 0 && encoder.encode(value).length <= 128 && !/[\0/]/.test(value);
}

/**
 * @typedef {object} ResolvedMakerV8Layer
 * @property {number} selectionIndex Original slot index, including gaps; never a compacted array index.
 * @property {{source: 'BASE'|'PACK'|'EXTERNAL', partKey: string, itemKey: string, styleKey: string}} selection
 * @property {{assetId: string, blobId?: string, sha256: string, byteLength: number, mediaType: string}} asset
 * @property {{x: number, y: number, scale: number, rotation: number}} transform Original author coordinates/degrees.
 * @property {'normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'hard-light'|'soft-light'|'difference'|'exclusion'|'hue'|'saturation'|'color'|'luminosity'|'linear-dodge'} blendMode
 * @property {number} opacity
 * @property {number} displayOrder
 * @property {number} trackOrder
 * @property {null|{key: string, rgba: string, stops: Array<{offset: number, rgba: string}>}} swatch Exact per-slot swatch.
 * @property {boolean} protected True requires caller-supplied authorized decryption.
 */

/**
 * One renderer core for both certified Player recipes and local Creator
 * drafts and native equipment. Callers resolve authority and bytes; this function owns exact
 * layer ordering, transforms, opacity, blend, Smart Color, drawing and PNG
 * canonicalization.
 * `document` needs only its exact `{canvas:{width,height,pixelMode}}`.
 * `layers` is a dense array of resolved nonempty slots, each retaining its
 * original selectionIndex. A global channel/color map is deliberately absent.
 * loadAsset returns exact descriptor + canonical bytesBase64; protected decrypt
 * receives the same ciphertext and original slot and must return that slot and
 * canonical plaintext bytes/length. Neither adapter's success grants authority.
 */
export async function renderResolvedMakerV8RecipePngV8({
  document,
  layers,
  loadAsset,
  exportSizeMode = null,
  canvasFactory = canvasFactoryDefault,
  decodeImage = decodeImageDefault,
  colorizeImage = colorizeMakerV8ImageSourceV8,
  decryptProtectedSelection = null,
} = {}) {
  if (!plain(document) || !plain(document.canvas)
    || ![document.canvas.width, document.canvas.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION)
    || !['smooth', 'pixelated'].includes(document.canvas.pixelMode)
    || !Array.isArray(layers) || layers.length > MAX_LAYERS || typeof loadAsset !== 'function') {
    fail('MAKER_V8_PLAYER_JOURNEY_RENDER_INPUT_INVALID', 'An exact Maker document, layers and asset loader are required.', 'RENDER');
  }
  const indexes = new Set();
  // Snapshot before the first asynchronous byte read so later caller changes
  // cannot change transforms, per-slot colors, identity or decryption indices.
  document = { canvas: { ...document.canvas } };
  const exportOptions = exportSizeMode === null ? null
    : exactMakerV8ExportOptions(document.canvas, { sizeMode: exportSizeMode });
  const target = exportOptions ? makerV8ExportSizes(document.canvas)[exportOptions.sizeMode] : document.canvas;
  const ordered = Array.from(layers, (layer, index) => {
    exactRenderableLayer(layer, index);
    if (indexes.has(layer.selectionIndex)) {
      fail('MAKER_V8_PLAYER_JOURNEY_RENDER_LAYER_INVALID', 'Resolved render slots must be unique.', 'RENDER', { index });
    }
    indexes.add(layer.selectionIndex);
    return freeze({ ...layer, selection: { ...layer.selection }, asset: { ...layer.asset }, transform: { ...layer.transform },
      sourceAsset: layer.sourceAsset == null ? null : { ...layer.sourceAsset },
      swatch: layer.swatch === null ? null : { ...layer.swatch, stops: layer.swatch.stops.map(stop => ({ ...stop })) } });
  }).sort((left, right) => (
    left.trackOrder - right.trackOrder
    || left.displayOrder - right.displayOrder
    || compareProtocolText(left.selection.partKey, right.selection.partKey)
    || compareProtocolText(left.selection.itemKey, right.selection.itemKey)
    || compareProtocolText(left.selection.styleKey, right.selection.styleKey)
    || compareProtocolText(left.selection.source, right.selection.source)
    || left.selectionIndex - right.selectionIndex
  ));
  const canvas = canvasFactory();
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext?.('2d');
  if (!context) fail('MAKER_V8_PLAYER_JOURNEY_CANVAS_UNAVAILABLE', 'Canvas 2D is unavailable.', 'RENDER');
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const layer of ordered) {
    const loaded = await loadAsset(layer.asset);
    if (!plain(loaded) || loaded.assetId !== layer.asset.assetId
      || (Object.hasOwn(layer.asset, 'blobId') && loaded.blobId !== layer.asset.blobId)
      || loaded.sha256 !== layer.asset.sha256
      || loaded.byteLength !== layer.asset.byteLength
      || loaded.mediaType !== layer.asset.mediaType
      || !HASH.test(loaded.sha256 ?? '')
      || typeof loaded.bytesBase64 !== 'string' || loaded.bytesBase64.length > MAX_ASSET_BASE64) {
      fail('MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_DRIFT', 'Render bytes differ from their exact asset evidence.', 'RENDER');
    }
    let bytes;
    try {
      bytes = fromBase64(loaded.bytesBase64);
    } catch {
      fail('MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_DRIFT', 'Render bytes are not canonical Base64.', 'RENDER');
    }
    if (toBase64(bytes) !== loaded.bytesBase64 || bytes.length !== loaded.byteLength
      || hex(sha256(bytes)) !== loaded.sha256) {
      fail('MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_DRIFT', 'Render bytes differ from their exact SHA-256 evidence.', 'RENDER');
    }
    if (layer.protected) {
      if (typeof decryptProtectedSelection !== 'function') {
        fail(
          'MAKER_V8_PLAYER_PROTECTED_SELECTION_BLOCKED',
          'Protected Base/Pack rendering requires the exact Seal decrypt adapter.',
          'BLOCKED_EXTERNAL_SECRET',
        );
      }
      const decrypted = await decryptProtectedSelection({
        selectionIndex: layer.selectionIndex,
        ciphertext: loaded,
      });
      if (!plain(decrypted) || decrypted.selectionIndex !== layer.selectionIndex
        || typeof decrypted.bytesBase64 !== 'string'
        || !Number.isSafeInteger(decrypted.byteLength) || decrypted.byteLength < 0 || decrypted.byteLength > MAX_ASSET_BYTES
        || decrypted.bytesBase64.length > MAX_ASSET_BASE64) {
        fail('MAKER_V8_PLAYER_PROTECTED_PLAINTEXT_INVALID', 'Seal returned another protected selection.', 'PROTECTION');
      }
      try {
        bytes = fromBase64(decrypted.bytesBase64);
      } catch {
        fail('MAKER_V8_PLAYER_PROTECTED_PLAINTEXT_INVALID', 'Seal plaintext is noncanonical.', 'PROTECTION');
      }
      if (toBase64(bytes) !== decrypted.bytesBase64 || bytes.length !== decrypted.byteLength) {
        fail('MAKER_V8_PLAYER_PROTECTED_PLAINTEXT_INVALID', 'Seal plaintext is noncanonical.', 'PROTECTION');
      }
      if (layer.sourceAsset != null && (bytes.length !== layer.sourceAsset.byteLength
        || hex(sha256(bytes)) !== layer.sourceAsset.sha256)) {
        bytes.fill(0);
        fail('MAKER_V8_PLAYER_PROTECTED_SOURCE_MISMATCH', 'Decrypted bytes differ from the published original artwork.', 'PROTECTION');
      }
    }
    const image = await decodeImage(bytes, layer.protected && layer.sourceAsset != null
      ? layer.sourceAsset.mediaType : loaded.mediaType);
    let colored = null;
    let saved = false;
    try {
      const { width, height } = imageSize(image?.source);
      if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION)
        || width * height > 32 * 1024 * 1024) {
        fail('MAKER_V8_PLAYER_JOURNEY_IMAGE_SOURCE_INVALID', 'Decoded image dimensions are unavailable or outside the source bounds.', 'RENDER');
      }
      if (layer.swatch !== null) {
        if (typeof colorizeImage !== 'function') {
          fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_PROCESSOR_INVALID', 'Smart Color renderer is unavailable.', 'RENDER');
        }
        colored = await colorizeImage({
          source: image.source,
          swatch: layer.swatch,
          canvasFactory,
        });
        const coloredSize = imageSize(colored?.source);
        if (!colored?.source || coloredSize.width !== width || coloredSize.height !== height) {
          fail('MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_PROCESSOR_INVALID', 'Smart Color renderer returned no exact source.', 'RENDER');
        }
      }
      context.save();
      saved = true;
      context.imageSmoothingEnabled = document.canvas.pixelMode !== 'pixelated';
      context.globalAlpha = layer.opacity;
      context.globalCompositeOperation = MAKER_V8_CANVAS_BLEND_MODES[layer.blendMode];
      // Keep authored coordinates and image extent; scale the whole scene,
      // including translations, before applying the original layer transform.
      if (canvas.width !== document.canvas.width || canvas.height !== document.canvas.height) {
        context.scale(canvas.width / document.canvas.width, canvas.height / document.canvas.height);
      }
      context.translate(layer.transform.x + width * layer.transform.scale / 2,
        layer.transform.y + height * layer.transform.scale / 2);
      context.rotate(layer.transform.rotation * Math.PI / 180);
      context.scale(layer.transform.scale, layer.transform.scale);
      context.translate(-width / 2, -height / 2);
      context.drawImage(colored?.source ?? image.source, 0, 0, width, height);
    } finally {
      if (saved) context.restore();
      colored?.close?.();
      image?.close?.();
    }
  }
  const bytes = await pngBytes(canvas);
  if (!bytes.length) fail('MAKER_V8_PLAYER_JOURNEY_RENDER_EMPTY', 'The completed PNG is empty.', 'RENDER');
  return freeze({
    schemaVersion: 'animacraft.maker-v8-player-render.v1',
    mediaType: 'image/png',
    width: canvas.width,
    height: canvas.height,
    bytesBase64: toBase64(bytes),
    byteLength: bytes.length,
    sha256: hex(sha256(bytes)),
  });
}
