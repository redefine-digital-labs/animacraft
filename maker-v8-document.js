import {
  collectMakerV8CommerceIssues,
  createMakerV8Commerce,
} from './maker-commerce-v8.js';

export const MAKER_V8_DOCUMENT_SCHEMA = 'animacraft.maker.v8';
export const MAKER_V8_DOCUMENT_VERSION = 8;

export const MAKER_V8_CAPABILITIES = Object.freeze([
  'commerce',
  'composition',
  'expansionPacks',
  'complete',
  'seal',
  'physical',
  'canonicalSoul',
]);

export const MAKER_V8_REGISTRIES = Object.freeze([
  'core',
  'composition',
  'packs',
  'complete',
  'seal',
  'physical',
]);

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SUI_ID = /^0x[0-9a-f]{64}$/;
const HEX_32 = /^(?:0x)?[0-9a-f]{64}$/;
const PIXEL_MODES = new Set(['smooth', 'pixelated']);
const WARDROBE_MODES = new Set(['FIXED', 'SLOT']);
const ASSET_KINDS = new Set(['image', 'json', 'font', 'audio']);
const MAX_CANVAS = 8_192;
const MAX_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 2_000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}

function safeId(value, fallback) {
  const normalized = String(value || fallback || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return normalized || fallback;
}

function issue(issues, path, code, message) {
  issues.push(Object.freeze({ path, code, message }));
}

function exactIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || ''))
    .filter(Boolean))].sort();
}

function defaultCapabilities(overrides = {}) {
  return Object.fromEntries(MAKER_V8_CAPABILITIES.map((name) => [
    name,
    Object.hasOwn(overrides, name) ? overrides[name] === true : true,
  ]));
}

function defaultLineage(rootMakerKey, overrides = {}) {
  const number = Number.isSafeInteger(overrides.number) && overrides.number > 0
    ? overrides.number
    : 1;
  return {
    rootMakerKey,
    versionKey: safeId(overrides.versionKey, `${rootMakerKey}-v${number}`),
    number,
    previousRootId: number === 1 ? null : String(overrides.previousRootId || '').toLowerCase(),
    previousContentCommitment: number === 1
      ? null
      : String(overrides.previousContentCommitment || '').toLowerCase(),
    createdAt: overrides.createdAt || null,
    changelog: String(overrides.changelog || ''),
  };
}

export function createMakerV8Document({
  makerId = 'untitled-maker',
  name = 'Untitled Maker',
  creator = '',
  width = 1024,
  height = 1024,
  pixelMode = 'smooth',
  lineage = {},
  capabilities = {},
  commerce = {},
} = {}) {
  const rootMakerKey = safeId(lineage.rootMakerKey || makerId, 'untitled-maker');
  return deepFreeze({
    schemaVersion: MAKER_V8_DOCUMENT_SCHEMA,
    protocolVersion: MAKER_V8_DOCUMENT_VERSION,
    lineage: defaultLineage(rootMakerKey, lineage),
    metadata: {
      id: safeId(makerId, rootMakerKey),
      name: String(name || 'Untitled Maker'),
      summary: '',
      creator: String(creator || ''),
      style: '',
      license: { kind: 'personal-use', note: '' },
      coverAssetId: null,
    },
    canvas: {
      width: Number.isSafeInteger(width) ? width : 1024,
      height: Number.isSafeInteger(height) ? height : 1024,
      pixelMode: PIXEL_MODES.has(pixelMode) ? pixelMode : 'smooth',
    },
    capabilities: defaultCapabilities(capabilities),
    layerTracks: [],
    colorChannels: [],
    parts: [],
    rules: [],
    defaultRecipe: { selections: [], colors: [] },
    packs: [],
    commerce: createMakerV8Commerce(commerce),
    assets: [],
  });
}

export function isMakerV8Document(value) {
  return isRecord(value)
    && value.schemaVersion === MAKER_V8_DOCUMENT_SCHEMA
    && value.protocolVersion === MAKER_V8_DOCUMENT_VERSION;
}

function validateId(value, path, issues) {
  if (!SAFE_ID.test(String(value || ''))) {
    issue(issues, path, 'MAKER_V8_ID_INVALID', 'Identifier must contain only letters, numbers, underscore, or hyphen.');
    return false;
  }
  return true;
}

function validateName(value, path, issues, { required = true, max = MAX_NAME_BYTES } = {}) {
  const text = String(value ?? '');
  if ((required && !text.trim()) || utf8Length(text) > max) {
    issue(issues, path, 'MAKER_V8_TEXT_INVALID', `Text must be ${required ? 'non-empty and ' : ''}at most ${max} UTF-8 bytes.`);
  }
}

function validateContiguousOrder(records, path, issues) {
  if (!Array.isArray(records)) return;
  records.forEach((record, index) => {
    if (record?.order !== index) {
      issue(issues, `${path}[${index}].order`, 'MAKER_V8_ORDER_INVALID', 'Order must be contiguous and match array position.');
    }
  });
}

function validateUniqueIds(records, path, issues) {
  const seen = new Set();
  (Array.isArray(records) ? records : []).forEach((record, index) => {
    const id = String(record?.id || '');
    if (!validateId(id, `${path}[${index}].id`, issues)) return;
    if (seen.has(id)) {
      issue(issues, `${path}[${index}].id`, 'MAKER_V8_ID_DUPLICATE', 'Identifier must be unique in this collection.');
    }
    seen.add(id);
  });
  return seen;
}

function validateRules(records, known, path, issues) {
  const ids = validateUniqueIds(records, path, issues);
  (Array.isArray(records) ? records : []).forEach((rule, index) => {
    const rulePath = `${path}[${index}]`;
    if (rule?.type !== 'requires' && rule?.type !== 'excludes') {
      issue(issues, `${rulePath}.type`, 'MAKER_V8_RULE_TYPE_INVALID', 'Rule type must be requires or excludes.');
    }
    const validateTarget = (target, targetPath) => {
      const partId = String(target?.partId || '');
      if (!known.parts.has(partId)) {
        issue(issues, `${targetPath}.partId`, 'MAKER_V8_RULE_PART_UNKNOWN', 'Rule references an unknown Part.');
        return;
      }
      if (target?.itemId && !known.items.get(partId)?.has(String(target.itemId))) {
        issue(issues, `${targetPath}.itemId`, 'MAKER_V8_RULE_ITEM_UNKNOWN', 'Rule references an unknown Item.');
      }
      if (target?.styleId && !known.styles.get(`${partId}:${target.itemId || ''}`)?.has(String(target.styleId))) {
        issue(issues, `${targetPath}.styleId`, 'MAKER_V8_RULE_STYLE_UNKNOWN', 'Rule references an unknown Style.');
      }
    };
    validateTarget(rule?.trigger, `${rulePath}.trigger`);
    if (!Array.isArray(rule?.targets) || rule.targets.length === 0) {
      issue(issues, `${rulePath}.targets`, 'MAKER_V8_RULE_TARGET_REQUIRED', 'Rule needs at least one target.');
    } else {
      rule.targets.forEach((target, targetIndex) => (
        validateTarget(target, `${rulePath}.targets[${targetIndex}]`)
      ));
    }
  });
  return ids;
}

export function makerV8Inventory(document) {
  const parts = Array.isArray(document?.parts) ? document.parts : [];
  const packs = Array.isArray(document?.packs) ? document.packs : [];
  const assets = Array.isArray(document?.assets) ? document.assets : [];
  let itemCount = 0;
  let styleCount = 0;
  let slotCount = 0;
  let protectedStyleCount = 0;
  let physicalStyleCount = 0;
  parts.forEach((part) => {
    if (part?.wardrobeMode === 'SLOT') slotCount += 1;
    (Array.isArray(part?.items) ? part.items : []).forEach((item) => {
      itemCount += 1;
      (Array.isArray(item?.styles) ? item.styles : []).forEach((style) => {
        styleCount += 1;
        if (style?.seal?.protected === true) protectedStyleCount += 1;
        if (style?.physical?.enabled === true) physicalStyleCount += 1;
      });
    });
  });
  return deepFreeze({
    tracks: Array.isArray(document?.layerTracks) ? document.layerTracks.length : 0,
    parts: parts.length,
    items: itemCount,
    styles: styleCount,
    colorChannels: Array.isArray(document?.colorChannels) ? document.colorChannels.length : 0,
    rules: Array.isArray(document?.rules) ? document.rules.length : 0,
    packs: packs.length,
    assets: assets.length,
    compositionSlots: slotCount,
    protectedStyles: protectedStyleCount,
    physicalStyles: physicalStyleCount,
  });
}

export function collectMakerV8DocumentIssues(document, { mode = 'draft' } = {}) {
  const issues = [];
  const compile = mode === 'compile' || mode === 'activate';
  if (!isRecord(document)) {
    issue(issues, '', 'MAKER_V8_DOCUMENT_REQUIRED', 'Maker v8 document is required.');
    return Object.freeze(issues);
  }
  if (document.schemaVersion !== MAKER_V8_DOCUMENT_SCHEMA) {
    issue(issues, 'schemaVersion', 'MAKER_V8_DOCUMENT_SCHEMA_INVALID', 'Document schema must be animacraft.maker.v8.');
  }
  if (document.protocolVersion !== MAKER_V8_DOCUMENT_VERSION) {
    issue(issues, 'protocolVersion', 'MAKER_V8_PROTOCOL_VERSION_INVALID', 'Protocol version must equal 8.');
  }
  if (!isRecord(document.lineage)) {
    issue(issues, 'lineage', 'MAKER_V8_LINEAGE_REQUIRED', 'v8 lineage is required.');
  } else {
    validateId(document.lineage.rootMakerKey, 'lineage.rootMakerKey', issues);
    validateId(document.lineage.versionKey, 'lineage.versionKey', issues);
    if (!Number.isSafeInteger(document.lineage.number) || document.lineage.number <= 0) {
      issue(issues, 'lineage.number', 'MAKER_V8_LINEAGE_NUMBER_INVALID', 'Version number must be positive.');
    }
    if (document.lineage.number === 1) {
      if (document.lineage.previousRootId !== null || document.lineage.previousContentCommitment !== null) {
        issue(issues, 'lineage', 'MAKER_V8_INITIAL_LINEAGE_INVALID', 'Initial v8 has no previous Root or commitment.');
      }
    } else {
      if (!SUI_ID.test(String(document.lineage.previousRootId || '').toLowerCase())) {
        issue(issues, 'lineage.previousRootId', 'MAKER_V8_PREVIOUS_ROOT_INVALID', 'Successor v8 requires an exact previous Root ID.');
      }
      if (!HEX_32.test(String(document.lineage.previousContentCommitment || '').toLowerCase())) {
        issue(issues, 'lineage.previousContentCommitment', 'MAKER_V8_PREVIOUS_COMMITMENT_INVALID', 'Successor v8 requires the previous content commitment.');
      }
    }
  }

  if (!isRecord(document.metadata)) {
    issue(issues, 'metadata', 'MAKER_V8_METADATA_REQUIRED', 'Metadata is required.');
  } else {
    validateId(document.metadata.id, 'metadata.id', issues);
    validateName(document.metadata.name, 'metadata.name', issues);
    validateName(document.metadata.summary, 'metadata.summary', issues, { required: false, max: MAX_DESCRIPTION_BYTES });
    if (compile) validateName(document.metadata.creator, 'metadata.creator', issues);
  }
  if (!isRecord(document.canvas)
    || !Number.isSafeInteger(document.canvas.width)
    || !Number.isSafeInteger(document.canvas.height)
    || document.canvas.width < 64
    || document.canvas.height < 64
    || document.canvas.width > MAX_CANVAS
    || document.canvas.height > MAX_CANVAS
    || !PIXEL_MODES.has(document.canvas.pixelMode)) {
    issue(issues, 'canvas', 'MAKER_V8_CANVAS_INVALID', 'Canvas must be 64–8192 pixels with a supported pixel mode.');
  }
  if (!isRecord(document.capabilities)) {
    issue(issues, 'capabilities', 'MAKER_V8_CAPABILITIES_REQUIRED', 'Every v8 capability must be explicit.');
  } else {
    MAKER_V8_CAPABILITIES.forEach((name) => {
      if (typeof document.capabilities[name] !== 'boolean') {
        issue(issues, `capabilities.${name}`, 'MAKER_V8_CAPABILITY_INVALID', 'Capability must be an explicit boolean.');
      }
    });
  }

  if (!Array.isArray(document.assets)) {
    issue(issues, 'assets', 'MAKER_V8_ASSETS_INVALID', 'Assets must be an array.');
  }
  const assetIds = validateUniqueIds(document.assets, 'assets', issues);
  const assets = new Map((Array.isArray(document.assets) ? document.assets : [])
    .map((asset) => [String(asset?.id || ''), asset]));
  (Array.isArray(document.assets) ? document.assets : []).forEach((asset, index) => {
    if (!ASSET_KINDS.has(asset?.kind)) {
      issue(issues, `assets[${index}].kind`, 'MAKER_V8_ASSET_KIND_INVALID', 'Asset kind is unsupported.');
    }
    if (compile && !HEX_32.test(String(asset?.sha256 || '').toLowerCase())) {
      issue(issues, `assets[${index}].sha256`, 'MAKER_V8_ASSET_HASH_INVALID', 'Compiled assets need an exact SHA-256.');
    }
    if (compile && (!Number.isSafeInteger(asset?.byteLength) || asset.byteLength <= 0)) {
      issue(issues, `assets[${index}].byteLength`, 'MAKER_V8_ASSET_LENGTH_INVALID', 'Compiled assets need a positive byte length.');
    }
  });
  if (compile) {
    const coverId = String(document.metadata?.coverAssetId || '');
    if (!assetIds.has(coverId) || assets.get(coverId)?.kind !== 'image') {
      issue(issues, 'metadata.coverAssetId', 'MAKER_V8_COVER_REQUIRED', 'Cover must reference an existing image asset.');
    }
  }

  if (!Array.isArray(document.layerTracks)) {
    issue(issues, 'layerTracks', 'MAKER_V8_TRACKS_INVALID', 'Layer Tracks must be an array.');
  }
  const trackIds = validateUniqueIds(document.layerTracks, 'layerTracks', issues);
  validateContiguousOrder(document.layerTracks, 'layerTracks', issues);
  (Array.isArray(document.layerTracks) ? document.layerTracks : []).forEach((track, index) => {
    validateName(track?.name, `layerTracks[${index}].name`, issues);
  });

  if (!Array.isArray(document.colorChannels)) {
    issue(issues, 'colorChannels', 'MAKER_V8_COLORS_INVALID', 'Color channels must be an array.');
  }
  const colorIds = validateUniqueIds(document.colorChannels, 'colorChannels', issues);
  (Array.isArray(document.colorChannels) ? document.colorChannels : []).forEach((channel, index) => {
    validateName(channel?.name, `colorChannels[${index}].name`, issues);
    if (!Array.isArray(channel?.swatches) || channel.swatches.length === 0) {
      issue(issues, `colorChannels[${index}].swatches`, 'MAKER_V8_SWATCH_REQUIRED', 'Color channel needs at least one swatch.');
    } else {
      const swatches = validateUniqueIds(channel.swatches, `colorChannels[${index}].swatches`, issues);
      if (!swatches.has(String(channel.defaultSwatchId || ''))) {
        issue(issues, `colorChannels[${index}].defaultSwatchId`, 'MAKER_V8_DEFAULT_SWATCH_INVALID', 'Default swatch must exist in its channel.');
      }
    }
  });

  if (!Array.isArray(document.parts)) {
    issue(issues, 'parts', 'MAKER_V8_PARTS_INVALID', 'Parts must be an array.');
  }
  const partIds = validateUniqueIds(document.parts, 'parts', issues);
  validateContiguousOrder(document.parts, 'parts', issues);
  const known = { parts: partIds, items: new Map(), styles: new Map() };
  (Array.isArray(document.parts) ? document.parts : []).forEach((part, partIndex) => {
    const partPath = `parts[${partIndex}]`;
    validateName(part?.name, `${partPath}.name`, issues);
    if (!trackIds.has(String(part?.layerTrackId || ''))) {
      issue(issues, `${partPath}.layerTrackId`, 'MAKER_V8_PART_TRACK_UNKNOWN', 'Part must reference a known Layer Track.');
    }
    if (!WARDROBE_MODES.has(part?.wardrobeMode)) {
      issue(issues, `${partPath}.wardrobeMode`, 'MAKER_V8_WARDROBE_MODE_INVALID', 'Part wardrobe mode must be FIXED or SLOT.');
    }
    if (!Array.isArray(part?.items) || (compile && part.items.length === 0)) {
      issue(issues, `${partPath}.items`, 'MAKER_V8_PART_ITEMS_INVALID', 'Published Parts need at least one Item.');
      return;
    }
    const itemIds = validateUniqueIds(part.items, `${partPath}.items`, issues);
    known.items.set(String(part.id || ''), itemIds);
    part.items.forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      validateName(item?.name, `${itemPath}.name`, issues);
      if (!Array.isArray(item?.styles) || (compile && item.styles.length === 0)) {
        issue(issues, `${itemPath}.styles`, 'MAKER_V8_ITEM_STYLES_INVALID', 'Published Items need at least one Style.');
        return;
      }
      const styleIds = validateUniqueIds(item.styles, `${itemPath}.styles`, issues);
      known.styles.set(`${part.id}:${item.id}`, styleIds);
      item.styles.forEach((style, styleIndex) => {
        const stylePath = `${itemPath}.styles[${styleIndex}]`;
        validateName(style?.name, `${stylePath}.name`, issues);
        if (!trackIds.has(String(style?.layerTrackId || part.layerTrackId || ''))) {
          issue(issues, `${stylePath}.layerTrackId`, 'MAKER_V8_STYLE_TRACK_UNKNOWN', 'Style must reference a known Layer Track.');
        }
        if (style?.colorChannelId && !colorIds.has(String(style.colorChannelId))) {
          issue(issues, `${stylePath}.colorChannelId`, 'MAKER_V8_STYLE_COLOR_UNKNOWN', 'Style references an unknown color channel.');
        }
        if (compile && (!assetIds.has(String(style?.assetId || ''))
          || assets.get(String(style.assetId))?.kind !== 'image')) {
          issue(issues, `${stylePath}.assetId`, 'MAKER_V8_STYLE_ASSET_INVALID', 'Published Style must reference an image asset.');
        }
        if (style?.seal?.protected === true && document.capabilities?.seal !== true) {
          issue(issues, `${stylePath}.seal`, 'MAKER_V8_SEAL_CAPABILITY_REQUIRED', 'Protected Style requires the v8 Seal capability.');
        }
        if (style?.physical?.enabled === true && document.capabilities?.physical !== true) {
          issue(issues, `${stylePath}.physical`, 'MAKER_V8_PHYSICAL_CAPABILITY_REQUIRED', 'Physical Style requires the v8 Physical capability.');
        }
      });
    });
  });
  if (Array.from(known.items.values()).some((ids) => ids.size) && document.capabilities?.composition !== true) {
    issue(issues, 'capabilities.composition', 'MAKER_V8_COMPOSITION_CAPABILITY_REQUIRED', 'Parts and Items require the v8 Composition capability.');
  }
  validateRules(document.rules, known, 'rules', issues);

  if (!Array.isArray(document.packs)) {
    issue(issues, 'packs', 'MAKER_V8_PACKS_INVALID', 'Packs must be an array.');
  }
  const packIds = validateUniqueIds(document.packs, 'packs', issues);
  if (packIds.size && document.capabilities?.expansionPacks !== true) {
    issue(issues, 'capabilities.expansionPacks', 'MAKER_V8_PACK_CAPABILITY_REQUIRED', 'Declared Packs require the v8 Expansion Pack capability.');
  }
  (Array.isArray(document.packs) ? document.packs : []).forEach((pack, index) => {
    validateName(pack?.name, `packs[${index}].name`, issues);
    if (compile && !HEX_32.test(String(pack?.contentCommitment || '').toLowerCase())) {
      issue(issues, `packs[${index}].contentCommitment`, 'MAKER_V8_PACK_COMMITMENT_INVALID', 'Published Pack needs an exact content commitment.');
    }
  });

  collectMakerV8CommerceIssues(document.commerce, {
    packIds: [...packIds],
    publish: compile,
  }).forEach((entry) => issues.push(entry));

  if (!isRecord(document.defaultRecipe)
    || !Array.isArray(document.defaultRecipe.selections)
    || !Array.isArray(document.defaultRecipe.colors)) {
    issue(issues, 'defaultRecipe', 'MAKER_V8_DEFAULT_RECIPE_INVALID', 'Default Recipe needs selection and color arrays.');
  }
  return Object.freeze(issues);
}

export class MakerV8DocumentValidationError extends Error {
  constructor(issues) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join('\n'));
    this.name = 'MakerV8DocumentValidationError';
    this.code = issues[0]?.code || 'MAKER_V8_DOCUMENT_INVALID';
    this.issues = Object.freeze([...issues]);
  }
}

export function assertMakerV8Document(document, options) {
  const issues = collectMakerV8DocumentIssues(document, options);
  if (issues.length) throw new MakerV8DocumentValidationError(issues);
  return document;
}

function exactCommitment(value, field) {
  const normalized = String(value || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be an exact 32-byte hex commitment.`);
  }
  return normalized;
}

/**
 * Binds compiler/Walrus output to the exact v8 authoring document. It accepts
 * no old Maker object, migration ID, compatibility gate, or inferred registry.
 */
export function createMakerV8ActivationIntent(document, {
  manifestBlobId,
  manifestSha256,
  contentCommitment,
  registryCommitments,
  physicalWitnessType = '',
} = {}) {
  assertMakerV8Document(document, { mode: 'compile' });
  const blobId = String(manifestBlobId || '');
  if (!blobId) throw new TypeError('Maker v8 manifest Blob ID is required.');
  if (!isRecord(registryCommitments)) {
    throw new TypeError('Maker v8 registry commitments are required.');
  }
  const inventory = makerV8Inventory(document);
  const commitments = {};
  MAKER_V8_REGISTRIES.forEach((registry) => {
    const record = registryCommitments[registry];
    if (!isRecord(record)) throw new TypeError(`${registry} registry commitment is required.`);
    const expectedCount = Number(record.expectedCount);
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new TypeError(`${registry} registry count is invalid.`);
    }
    commitments[registry] = {
      expectedCount,
      expectedCommitment: exactCommitment(record.expectedCommitment, `${registry}.expectedCommitment`),
    };
  });
  const expected = {
    core: inventory.tracks
      + inventory.parts
      + inventory.items
      + inventory.styles
      + inventory.colorChannels
      + inventory.rules,
    composition: inventory.compositionSlots,
    packs: inventory.packs,
    complete: document.capabilities.complete ? 1 : 0,
    seal: inventory.protectedStyles,
    physical: inventory.physicalStyles,
  };
  MAKER_V8_REGISTRIES.forEach((registry) => {
    if (commitments[registry].expectedCount !== expected[registry]) {
      throw new TypeError(`${registry} registry count does not match the v8 document.`);
    }
  });
  if (document.capabilities.physical && !String(physicalWitnessType || '')) {
    throw new TypeError('Physical-enabled Maker v8 needs an exact Physical witness type.');
  }
  return deepFreeze({
    schemaVersion: 'animacraft.maker-v8-activation-intent.v1',
    makerDocumentSchema: MAKER_V8_DOCUMENT_SCHEMA,
    makerKey: document.metadata.id,
    versionKey: document.lineage.versionKey,
    versionNumber: document.lineage.number,
    manifestBlobId: blobId,
    manifestSha256: exactCommitment(manifestSha256, 'manifestSha256'),
    contentCommitment: exactCommitment(contentCommitment, 'contentCommitment'),
    capabilities: clone(document.capabilities),
    inventory,
    registries: commitments,
    physicalWitnessType: String(physicalWitnessType || ''),
  });
}
