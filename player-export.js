export const PLAYER_STANDARD_EXPORT_MAX_EDGE = 1_024;
export const PLAYER_ORIGINAL_EXPORT_MAX_PIXELS = 8_388_608;

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_BYTES = 128;
const MAX_FILENAME_BASE_BYTES = 180;
const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function utf8Length(value) {
  return new TextEncoder().encode(String(value)).length;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return number;
}

function safeId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!SAFE_ID_PATTERN.test(normalized) || utf8Length(normalized) > MAX_ID_BYTES) {
    throw new TypeError(`${label} must be a URL-safe Animacraft ID.`);
  }
  return normalized;
}

function httpUrl(value) {
  const url = new URL(String(value ?? ''));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Player share URLs must use HTTP(S) without embedded credentials.');
  }
  return url;
}

function truncateUtf8(value, maxBytes) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8Length(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function filenameBase(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\.png$/i, '')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
}

/**
 * Returns the exact pixel dimensions the Player renderer should target.
 * Standard export fits inside maxEdge and never enlarges the Maker canvas.
 */
export function calculatePlayerExportSize(
  canvas,
  { mode = 'standard', maxEdge = PLAYER_STANDARD_EXPORT_MAX_EDGE } = {},
) {
  const sourceWidth = positiveInteger(canvas?.width, 'canvas.width');
  const sourceHeight = positiveInteger(canvas?.height, 'canvas.height');
  if (!['standard', 'original'].includes(mode)) {
    throw new TypeError('mode must be standard or original.');
  }
  if (mode === 'original') {
    return { mode, width: sourceWidth, height: sourceHeight, scale: 1 };
  }

  const normalizedMaxEdge = positiveInteger(maxEdge, 'maxEdge');
  const scale = Math.min(1, normalizedMaxEdge / Math.max(sourceWidth, sourceHeight));
  return {
    mode,
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

/**
 * Original-size export is optional for very large, untrusted on-chain Makers.
 * The limit bounds one RGBA buffer to 32 MiB before encoding overhead.
 */
export function isPlayerOriginalExportSafe(
  canvas,
  { maxPixels = PLAYER_ORIGINAL_EXPORT_MAX_PIXELS } = {},
) {
  const width = positiveInteger(canvas?.width, 'canvas.width');
  const height = positiveInteger(canvas?.height, 'canvas.height');
  const normalizedMaxPixels = positiveInteger(maxPixels, 'maxPixels');
  return (width * height) <= normalizedMaxPixels;
}

/**
 * Keeps readable Unicode names while removing path/control characters and
 * platform-reserved basenames. The result always has exactly one .png suffix.
 */
export function safePngFilename(
  preferredName,
  { fallback = 'animacraft-oc', maxBaseBytes = MAX_FILENAME_BASE_BYTES } = {},
) {
  const normalizedMaxBytes = positiveInteger(maxBaseBytes, 'maxBaseBytes');
  const safeFallback = filenameBase(fallback) || 'animacraft-oc';
  let base = filenameBase(preferredName) || safeFallback;
  base = truncateUtf8(base, normalizedMaxBytes).replace(/[.\s-]+$/g, '') || safeFallback;
  if (WINDOWS_RESERVED_FILENAME.test(base)) base = `_${base}`;
  return `${base}.png`;
}

/**
 * Shares the public Maker route that the application actually resolves.
 * It intentionally contains no OC recipe, profile, Soul, wallet or draft data.
 * The route follows the Maker object's current published version.
 */
export function buildPlayerShareUrl({ baseUrl, makerId } = {}) {
  const url = httpUrl(baseUrl);
  const normalizedMakerId = safeId(makerId, 'makerId');
  const basePath = url.pathname.replace(/\/+$/g, '');

  url.pathname = `${basePath}/maker/${normalizedMakerId}`;
  url.search = '';
  url.hash = '';
  return url.href;
}
