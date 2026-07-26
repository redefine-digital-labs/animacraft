import {
  LIVING_CONTENT_MAX_FILE_BYTES,
  LIVING_CONTENT_MAX_TOTAL_BYTES,
  createDefaultLivingContent,
  normalizeLivingContent,
  validateLivingContent,
} from './living-content.js';

export const SOUL_CONFIG_DOCUMENT_KEYS = Object.freeze([
  'soulMd',
  'memoryMd',
  'skillMd',
]);

export const SOUL_CONFIG_DOCUMENTS = Object.freeze([
  Object.freeze({
    key: 'soulMd',
    filename: 'soul.md',
    kind: 'personality_identity',
  }),
  Object.freeze({
    key: 'memoryMd',
    filename: 'memory.md',
    kind: 'memory',
  }),
  Object.freeze({
    key: 'skillMd',
    filename: 'SKILL.md',
    kind: 'skill',
  }),
]);

const documentKeySet = new Set(SOUL_CONFIG_DOCUMENT_KEYS);
const encoder = new TextEncoder();

function makerMetadata(value = {}) {
  if (value && typeof value === 'object' && value.metadata && typeof value.metadata === 'object') {
    return value.metadata;
  }
  return value && typeof value === 'object' ? value : {};
}

function assertDocumentKey(key) {
  if (!documentKeySet.has(key)) {
    throw new TypeError(`Unknown Soul configuration document: ${String(key)}`);
  }
}

function validateOneDocument(content, key, maker) {
  const defaults = createDefaultLivingContent(maker);
  const candidate = {
    ...defaults,
    [key]: content[key],
    customized: {
      ...defaults.customized,
      [key]: content.customized[key],
    },
  };

  try {
    validateLivingContent(candidate);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Returns the complete three-document shape expected by
 * `MakerDocument.livingContent`. Missing documents are restored from the
 * Maker metadata, while existing empty strings remain empty so the editor can
 * autosave an unfinished draft.
 */
export function normalizeSoulConfig(value, maker = {}) {
  return normalizeLivingContent(value, makerMetadata(maker));
}

/**
 * Updates exactly one Soul document without mutating the previous value.
 * Invalid/unfinished Markdown is deliberately retained for draft persistence;
 * call `validateSoulConfig` to produce UI or publication status.
 */
export function updateSoulConfig(value, key, markdown, maker = {}) {
  assertDocumentKey(key);
  const content = normalizeSoulConfig(value, maker);
  return {
    ...content,
    [key]: String(markdown ?? ''),
    customized: {
      ...content.customized,
      [key]: true,
    },
  };
}

/**
 * Restores one document to its Maker-derived default. Omitting `key` restores
 * all three documents.
 */
export function resetSoulConfig(value, key, maker = {}) {
  const metadata = makerMetadata(maker);
  if (key === undefined || key === null) return createDefaultLivingContent(metadata);
  assertDocumentKey(key);
  const content = normalizeSoulConfig(value, metadata);
  const defaults = createDefaultLivingContent(metadata);
  return {
    ...content,
    [key]: defaults[key],
    customized: {
      ...content.customized,
      [key]: false,
    },
  };
}

/**
 * Produces non-throwing validation state for the whole configuration and for
 * each editable Markdown document. `content` is the normalized value that may
 * be placed directly at `MakerDocument.livingContent`.
 */
export function validateSoulConfig(value, maker = {}) {
  const metadata = makerMetadata(maker);
  const content = normalizeSoulConfig(value, metadata);
  const documents = {};
  let totalBytes = 0;

  SOUL_CONFIG_DOCUMENT_KEYS.forEach((key) => {
    const bytes = encoder.encode(content[key]).length;
    totalBytes += bytes;
    const error = validateOneDocument(content, key, metadata);
    documents[key] = Object.freeze({
      valid: error === null,
      error,
      bytes,
      maxBytes: LIVING_CONTENT_MAX_FILE_BYTES,
      customized: content.customized[key],
    });
  });

  let error = null;
  try {
    validateLivingContent(content);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return Object.freeze({
    valid: error === null,
    error,
    content,
    documents: Object.freeze(documents),
    totalBytes,
    maxTotalBytes: LIVING_CONTENT_MAX_TOTAL_BYTES,
  });
}

/**
 * Returns a new Maker document with a normalized `livingContent` field. It
 * never validates or rejects an unfinished draft, so autosave can persist
 * every keystroke and publication can validate separately.
 */
export function applySoulConfigToMakerDocument(document, value = document?.livingContent) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('A Maker document object is required.');
  }
  return {
    ...document,
    livingContent: normalizeSoulConfig(value, document),
  };
}
