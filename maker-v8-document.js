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
const ASSET_KINDS = new Set([
  'maker-cover',
  'layer',
  'reference',
  'image',
  'json',
  'font',
  'audio',
]);
const ITEM_STATUSES = new Set(['draft', 'private', 'public']);
const BLEND_MODES = new Set([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'linear-dodge',
]);
const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const MAX_CANVAS = 8_192;
const MAX_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 2_000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
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

/**
 * The v8 protocol reuses the established Creator editor document semantics;
 * it does not introduce a second Pack-only or chain-version-specific editor.
 */
export function createCharacterMakerV8Starter(options = {}) {
  const document = structuredClone(createMakerV8Document(options));
  const definitions = [
    ['background', 'Background', false],
    ['back-hair', 'Back Hair', false],
    ['skin-base', 'Skin & Base', true],
    ['outfit', 'Outfit', false],
    ['eyes', 'Eyes', true],
    ['mouth', 'Mouth', false],
    ['front-hair', 'Front Hair', false],
    ['accessory', 'Accessory', false],
  ];
  definitions.forEach(([id, name, required], order) => {
    const itemId = `${id}-default`;
    const styleId = 'default-style';
    const trackId = `${id}-track`;
    document.layerTracks.push({
      id: trackId,
      name,
      order,
      locked: false,
      referenceAssetId: null,
    });
    document.parts.push({
      id,
      name,
      menuOrder: order,
      menuVisible: true,
      required,
      wardrobeMode: 'FIXED',
      defaultItemId: itemId,
      parentPartId: null,
      iconAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      items: [{
        id: itemId,
        name: 'Default',
        displayOrder: 0,
        importKey: itemId,
        status: 'public',
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [],
        excludes: [],
        defaultStyleId: styleId,
        styles: [{
          id: styleId,
          name: 'Default Style',
          displayOrder: 0,
          assetId: null,
          layerTrackId: trackId,
          colorChannelId: null,
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          positionConfirmed: false,
          positionLocked: false,
          styleLocked: false,
          opacity: 1,
          blendMode: 'normal',
          visibleWhen: null,
          requires: [],
          excludes: [],
          seal: { protected: false, scopeId: '' },
          physical: { enabled: false },
        }],
      }],
    });
  });
  document.defaultRecipe = {
    selections: document.parts.map((part) => ({
      partId: part.id,
      itemId: part.defaultItemId,
      styleId: part.items[0].defaultStyleId,
    })),
    colors: [],
  };
  return deepFreeze(document);
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

function validateSelectionTarget(target, path, known, issues) {
  if (!isRecord(target)) {
    issue(issues, path, 'MAKER_V8_RULE_TARGET_INVALID', 'Rule target must be an object.');
    return;
  }
  const partId = String(target.partId || '');
  if (!known.parts.has(partId)) {
    issue(issues, `${path}.partId`, 'MAKER_V8_RULE_PART_UNKNOWN', 'Rule references an unknown Part.');
    return;
  }
  const itemIds = exactIds([
    ...(target.itemId ? [target.itemId] : []),
    ...(Array.isArray(target.itemIds) ? target.itemIds : []),
  ]);
  itemIds.forEach((itemId) => {
    if (!known.items.get(partId)?.has(itemId)) {
      issue(issues, `${path}.itemId`, 'MAKER_V8_RULE_ITEM_UNKNOWN', 'Rule references an unknown Item.');
    }
  });
  const styleIds = exactIds([
    ...(target.styleId ? [target.styleId] : []),
    ...(Array.isArray(target.styleIds) ? target.styleIds : []),
  ]);
  if (styleIds.length && itemIds.length !== 1) {
    issue(issues, `${path}.styleId`, 'MAKER_V8_RULE_STYLE_SCOPE_INVALID', 'Style targets require exactly one Item.');
  } else {
    styleIds.forEach((styleId) => {
      if (!known.styles.get(`${partId}:${itemIds[0] || ''}`)?.has(styleId)) {
        issue(issues, `${path}.styleId`, 'MAKER_V8_RULE_STYLE_UNKNOWN', 'Rule references an unknown Style.');
      }
    });
  }
}

function selectionTargetKey(target) {
  return JSON.stringify([
    String(target?.partId || ''),
    exactIds([
      ...(target?.itemId ? [target.itemId] : []),
      ...(Array.isArray(target?.itemIds) ? target.itemIds : []),
    ]),
    exactIds([
      ...(target?.styleId ? [target.styleId] : []),
      ...(Array.isArray(target?.styleIds) ? target.styleIds : []),
    ]),
  ]);
}

function validateCondition(condition, path, known, issues, depth = 0) {
  if (condition === null || condition === undefined) return;
  if (depth > 12 || !isRecord(condition)) {
    issue(issues, path, 'MAKER_V8_CONDITION_INVALID', 'Visibility condition is malformed or too deeply nested.');
    return;
  }
  if (condition.op === 'selected') {
    validateSelectionTarget(condition, path, known, issues);
    return;
  }
  if (condition.op === 'not') {
    validateCondition(condition.condition, `${path}.condition`, known, issues, depth + 1);
    return;
  }
  if (condition.op === 'all' || condition.op === 'any') {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
      issue(issues, `${path}.conditions`, 'MAKER_V8_CONDITION_CHILDREN_REQUIRED', 'Grouped condition needs at least one child.');
      return;
    }
    condition.conditions.forEach((child, index) => (
      validateCondition(child, `${path}.conditions[${index}]`, known, issues, depth + 1)
    ));
    return;
  }
  issue(issues, `${path}.op`, 'MAKER_V8_CONDITION_OPERATOR_INVALID', 'Condition operator must be selected, not, all, or any.');
}

function validateEmbeddedRules(owner, path, known, issues) {
  for (const field of ['requires', 'excludes']) {
    if (!Array.isArray(owner?.[field])) {
      issue(issues, `${path}.${field}`, 'MAKER_V8_RULE_LIST_INVALID', 'Embedded rule targets must be an array.');
      continue;
    }
    const seen = new Set();
    owner[field].forEach((target, index) => {
      validateSelectionTarget(target, `${path}.${field}[${index}]`, known, issues);
      const key = selectionTargetKey(target);
      if (seen.has(key)) {
        issue(issues, `${path}.${field}[${index}]`, 'MAKER_V8_RULE_TARGET_DUPLICATE', 'Embedded rule target is duplicated.');
      }
      seen.add(key);
    });
  }
  const required = new Set((Array.isArray(owner?.requires) ? owner.requires : []).map(selectionTargetKey));
  (Array.isArray(owner?.excludes) ? owner.excludes : []).forEach((target, index) => {
    if (required.has(selectionTargetKey(target))) {
      issue(issues, `${path}.excludes[${index}]`, 'MAKER_V8_RULE_TARGET_CONTRADICTORY', 'The same target cannot be both required and excluded.');
    }
  });
  validateCondition(owner?.visibleWhen, `${path}.visibleWhen`, known, issues);
}

function validateRules(records, known, path, issues) {
  if (!Array.isArray(records)) {
    issue(issues, path, 'MAKER_V8_RULES_INVALID', 'Global rules must be an array.');
    return new Set();
  }
  const ids = validateUniqueIds(records, path, issues);
  records.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`;
    if (rule?.type !== 'requires' && rule?.type !== 'excludes') {
      issue(issues, `${rulePath}.type`, 'MAKER_V8_RULE_TYPE_INVALID', 'Rule type must be requires or excludes.');
    }
    validateSelectionTarget(rule?.trigger, `${rulePath}.trigger`, known, issues);
    if (!Array.isArray(rule?.targets) || rule.targets.length === 0) {
      issue(issues, `${rulePath}.targets`, 'MAKER_V8_RULE_TARGET_REQUIRED', 'Rule needs at least one target.');
    } else {
      rule.targets.forEach((target, targetIndex) => (
        validateSelectionTarget(target, `${rulePath}.targets[${targetIndex}]`, known, issues)
      ));
    }
  });
  return ids;
}

function validateDefaultRecipe(document, known, channels, compile, issues) {
  const recipe = document?.defaultRecipe;
  if (!isRecord(recipe)
    || !Array.isArray(recipe.selections)
    || !Array.isArray(recipe.colors)) {
    issue(issues, 'defaultRecipe', 'MAKER_V8_DEFAULT_RECIPE_INVALID', 'Default Recipe needs selection and color arrays.');
    return;
  }

  const selectedParts = new Set();
  recipe.selections.forEach((selection, index) => {
    const path = `defaultRecipe.selections[${index}]`;
    validateSelectionTarget(selection, path, known, issues);
    const partId = String(selection?.partId || '');
    const itemId = String(selection?.itemId || '');
    const styleId = String(selection?.styleId || '');
    if (selectedParts.has(partId)) {
      issue(issues, `${path}.partId`, 'MAKER_V8_DEFAULT_PART_DUPLICATE', 'Default Recipe can select each Part only once.');
    }
    selectedParts.add(partId);
    if (!itemId || !styleId || hasOwn(selection, 'itemIds') || hasOwn(selection, 'styleIds')) {
      issue(issues, path, 'MAKER_V8_DEFAULT_SELECTION_INVALID', 'Default selection needs exactly one Item and one Style.');
      return;
    }
    const part = known.partRecords.get(partId);
    const item = known.itemRecords.get(`${partId}:${itemId}`);
    if (part?.defaultItemId && itemId !== part.defaultItemId) {
      issue(issues, `${path}.itemId`, 'MAKER_V8_DEFAULT_ITEM_MISMATCH', 'Default Recipe Item must match Part.defaultItemId.');
    }
    if (item?.defaultStyleId && styleId !== item.defaultStyleId) {
      issue(issues, `${path}.styleId`, 'MAKER_V8_DEFAULT_STYLE_MISMATCH', 'Default Recipe Style must match Item.defaultStyleId.');
    }
  });
  if (compile) {
    known.partRecords.forEach((part, partId) => {
      if ((part.required || part.defaultItemId) && !selectedParts.has(partId)) {
        issue(issues, 'defaultRecipe.selections', 'MAKER_V8_DEFAULT_SELECTION_MISSING', `Default Recipe is missing Part ${partId}.`);
      }
    });
  }

  const selectedChannels = new Set();
  recipe.colors.forEach((selection, index) => {
    const path = `defaultRecipe.colors[${index}]`;
    if (!isRecord(selection)) {
      issue(issues, path, 'MAKER_V8_DEFAULT_COLOR_INVALID', 'Default color selection must be an object.');
      return;
    }
    const channelId = String(selection.channelId || '');
    const swatchId = String(selection.swatchId || '');
    const channel = channels.get(channelId);
    if (!channel) {
      issue(issues, `${path}.channelId`, 'MAKER_V8_DEFAULT_COLOR_CHANNEL_UNKNOWN', 'Default color references an unknown channel.');
    }
    if (selectedChannels.has(channelId)) {
      issue(issues, `${path}.channelId`, 'MAKER_V8_DEFAULT_COLOR_DUPLICATE', 'Default Recipe can select each color channel only once.');
    }
    selectedChannels.add(channelId);
    if (channel && !(channel.swatches || []).some((swatch) => swatch?.id === swatchId)) {
      issue(issues, `${path}.swatchId`, 'MAKER_V8_DEFAULT_SWATCH_UNKNOWN', 'Default color references an unknown swatch.');
    }
    if (channel?.defaultSwatchId && swatchId !== channel.defaultSwatchId) {
      issue(issues, `${path}.swatchId`, 'MAKER_V8_DEFAULT_SWATCH_MISMATCH', 'Default Recipe swatch must match ColorChannel.defaultSwatchId.');
    }
  });
  if (compile) {
    channels.forEach((channel, channelId) => {
      if (channel.defaultSwatchId && !selectedChannels.has(channelId)) {
        issue(issues, 'defaultRecipe.colors', 'MAKER_V8_DEFAULT_COLOR_MISSING', `Default Recipe is missing color channel ${channelId}.`);
      }
    });
  }
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
  let colorCount = 0;
  (Array.isArray(document?.colorChannels) ? document.colorChannels : [])
    .forEach((channel) => {
      colorCount += Array.isArray(channel?.swatches) ? channel.swatches.length : 0;
    });
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
    colors: colorCount,
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
    if (compile && (typeof asset?.mediaType !== 'string' || !asset.mediaType)) {
      issue(issues, `assets[${index}].mediaType`, 'MAKER_V8_ASSET_MEDIA_TYPE_INVALID', 'Compiled assets need an exact media type.');
    }
  });
  if (compile) {
    const coverId = String(document.metadata?.coverAssetId || '');
    const cover = assets.get(coverId);
    if (!assetIds.has(coverId)
      || cover?.kind !== 'maker-cover'
      || !String(cover?.mediaType || '').toLowerCase().startsWith('image/')) {
      issue(issues, 'metadata.coverAssetId', 'MAKER_V8_COVER_REQUIRED', 'Cover must reference an existing dedicated maker-cover image asset.');
    }
  }

  if (!Array.isArray(document.layerTracks)) {
    issue(issues, 'layerTracks', 'MAKER_V8_TRACKS_INVALID', 'Layer Tracks must be an array.');
  }
  const trackIds = validateUniqueIds(document.layerTracks, 'layerTracks', issues);
  validateContiguousOrder(document.layerTracks, 'layerTracks', issues);
  (Array.isArray(document.layerTracks) ? document.layerTracks : []).forEach((track, index) => {
    const trackPath = `layerTracks[${index}]`;
    validateName(track?.name, `${trackPath}.name`, issues);
    if (track?.locked !== undefined && typeof track.locked !== 'boolean') {
      issue(issues, `${trackPath}.locked`, 'MAKER_V8_TRACK_LOCK_INVALID', 'Layer Track locked state must be boolean.');
    }
    if (track?.referenceAssetId !== null
      && track?.referenceAssetId !== undefined
      && !assetIds.has(String(track.referenceAssetId))) {
      issue(issues, `${trackPath}.referenceAssetId`, 'MAKER_V8_TRACK_REFERENCE_UNKNOWN', 'Layer Track references an unknown Asset.');
    }
  });

  if (!Array.isArray(document.colorChannels)) {
    issue(issues, 'colorChannels', 'MAKER_V8_COLORS_INVALID', 'Color channels must be an array.');
  }
  const colorIds = validateUniqueIds(document.colorChannels, 'colorChannels', issues);
  validateContiguousOrder(document.colorChannels, 'colorChannels', issues);
  (Array.isArray(document.colorChannels) ? document.colorChannels : []).forEach((channel, index) => {
    validateName(channel?.name, `colorChannels[${index}].name`, issues);
    if (channel?.mode !== 'gradient-map') {
      issue(issues, `colorChannels[${index}].mode`, 'MAKER_V8_COLOR_MODE_INVALID', 'Color channel mode must be gradient-map.');
    }
    if (!Array.isArray(channel?.swatches)) {
      issue(issues, `colorChannels[${index}].swatches`, 'MAKER_V8_SWATCHES_INVALID', 'Color channel swatches must be an array.');
    } else if (compile && channel.swatches.length === 0) {
      issue(issues, `colorChannels[${index}].swatches`, 'MAKER_V8_SWATCH_REQUIRED', 'Published color channel needs at least one swatch.');
    } else {
      const swatches = validateUniqueIds(channel.swatches, `colorChannels[${index}].swatches`, issues);
      if (channel.defaultSwatchId !== null
        && channel.defaultSwatchId !== undefined
        && !swatches.has(String(channel.defaultSwatchId))) {
        issue(issues, `colorChannels[${index}].defaultSwatchId`, 'MAKER_V8_DEFAULT_SWATCH_INVALID', 'Default swatch must exist in its channel.');
      }
      if (compile && !channel.defaultSwatchId) {
        issue(issues, `colorChannels[${index}].defaultSwatchId`, 'MAKER_V8_DEFAULT_SWATCH_REQUIRED', 'Published color channel needs a default swatch.');
      }
      channel.swatches.forEach((swatch, swatchIndex) => {
        const swatchPath = `colorChannels[${index}].swatches[${swatchIndex}]`;
        validateName(swatch?.name, `${swatchPath}.name`, issues);
        if (!HEX_COLOR.test(String(swatch?.hintColor || ''))) {
          issue(issues, `${swatchPath}.hintColor`, 'MAKER_V8_SWATCH_COLOR_INVALID', 'Swatch hint color must be six- or eight-digit hex.');
        }
        const stops = Array.isArray(swatch?.stops) ? swatch.stops : [];
        if (stops.length < 2) {
          issue(issues, `${swatchPath}.stops`, 'MAKER_V8_SWATCH_STOPS_INVALID', 'Gradient swatch needs at least two stops.');
        }
        stops.forEach((stop, stopIndex) => {
          if (!isRecord(stop)
            || typeof stop.offset !== 'number'
            || stop.offset < 0
            || stop.offset > 1
            || !HEX_COLOR.test(String(stop.color || ''))) {
            issue(issues, `${swatchPath}.stops[${stopIndex}]`, 'MAKER_V8_SWATCH_STOP_INVALID', 'Gradient stop needs an offset from 0 to 1 and a hex color.');
          }
        });
        if (stops.length >= 2 && (
          stops[0]?.offset !== 0
          || stops.at(-1)?.offset !== 1
          || stops.some((stop, stopIndex) => (
            stopIndex > 0 && stop?.offset <= stops[stopIndex - 1]?.offset
          ))
        )) {
          issue(issues, `${swatchPath}.stops`, 'MAKER_V8_SWATCH_ORDER_INVALID', 'Gradient stops must be strictly ordered from 0 through 1.');
        }
      });
    }
  });

  if (!Array.isArray(document.parts)) {
    issue(issues, 'parts', 'MAKER_V8_PARTS_INVALID', 'Parts must be an array.');
  }
  const partIds = validateUniqueIds(document.parts, 'parts', issues);
  validateContiguousOrder(
    (Array.isArray(document.parts) ? document.parts : [])
      .map((part) => ({ ...part, order: part?.menuOrder })),
    'parts',
    issues,
  );
  if (compile && partIds.size === 0) {
    issue(issues, 'parts', 'MAKER_V8_PART_REQUIRED', 'Published Maker v8 needs at least one Part.');
  }
  const known = {
    parts: partIds,
    items: new Map(),
    styles: new Map(),
    partRecords: new Map(),
    itemRecords: new Map(),
    styleRecords: new Map(),
  };
  (Array.isArray(document.parts) ? document.parts : []).forEach((part, partIndex) => {
    const partPath = `parts[${partIndex}]`;
    known.partRecords.set(String(part?.id || ''), part);
    validateName(part?.name, `${partPath}.name`, issues);
    if (typeof part?.required !== 'boolean' || typeof part?.menuVisible !== 'boolean') {
      issue(issues, partPath, 'MAKER_V8_PART_STATE_INVALID', 'Part required and menuVisible states must be explicit booleans.');
    }
    if (!WARDROBE_MODES.has(part?.wardrobeMode)) {
      issue(issues, `${partPath}.wardrobeMode`, 'MAKER_V8_WARDROBE_MODE_INVALID', 'Part wardrobe mode must be FIXED or SLOT.');
    }
    if (part?.parentPartId !== null
      && part?.parentPartId !== undefined
      && typeof part.parentPartId !== 'string') {
      issue(issues, `${partPath}.parentPartId`, 'MAKER_V8_PARENT_PART_INVALID', 'Parent Part must be null or a Part ID.');
    }
    if (part?.iconAssetId !== null
      && part?.iconAssetId !== undefined
      && !assetIds.has(String(part.iconAssetId))) {
      issue(issues, `${partPath}.iconAssetId`, 'MAKER_V8_PART_ICON_UNKNOWN', 'Part icon references an unknown Asset.');
    }
    if (!Array.isArray(part?.items) || (compile && part.items.length === 0)) {
      issue(issues, `${partPath}.items`, 'MAKER_V8_PART_ITEMS_INVALID', 'Published Parts need at least one Item.');
      return;
    }
    const itemIds = validateUniqueIds(part.items, `${partPath}.items`, issues);
    known.items.set(String(part.id || ''), itemIds);
    validateContiguousOrder(
      part.items.map((item) => ({ ...item, order: item?.displayOrder })),
      `${partPath}.items`,
      issues,
    );
    part.items.forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      known.itemRecords.set(`${part.id}:${item.id}`, item);
      validateName(item?.name, `${itemPath}.name`, issues);
      if (item?.importKey !== undefined) validateId(item.importKey, `${itemPath}.importKey`, issues);
      if (item?.thumbnailAssetId !== null
        && item?.thumbnailAssetId !== undefined
        && !assetIds.has(String(item.thumbnailAssetId))) {
        issue(issues, `${itemPath}.thumbnailAssetId`, 'MAKER_V8_ITEM_THUMBNAIL_UNKNOWN', 'Item thumbnail references an unknown Asset.');
      }
      if (!ITEM_STATUSES.has(item?.status)) {
        issue(issues, `${itemPath}.status`, 'MAKER_V8_ITEM_STATUS_INVALID', 'Item status must be draft, private, or public.');
      } else if (compile && item.status !== 'public') {
        issue(issues, `${itemPath}.status`, 'MAKER_V8_ITEM_NOT_PUBLIC', 'Compiled Maker v8 can contain only public Items.');
      }
      if (!Array.isArray(item?.styles) || (compile && item.styles.length === 0)) {
        issue(issues, `${itemPath}.styles`, 'MAKER_V8_ITEM_STYLES_INVALID', 'Published Items need at least one Style.');
        return;
      }
      const styleIds = validateUniqueIds(item.styles, `${itemPath}.styles`, issues);
      known.styles.set(`${part.id}:${item.id}`, styleIds);
      validateContiguousOrder(
        item.styles.map((style) => ({ ...style, order: style?.displayOrder })),
        `${itemPath}.styles`,
        issues,
      );
      item.styles.forEach((style, styleIndex) => {
        const stylePath = `${itemPath}.styles[${styleIndex}]`;
        known.styleRecords.set(`${part.id}:${item.id}:${style.id}`, style);
        validateName(style?.name, `${stylePath}.name`, issues);
        if (!trackIds.has(String(style?.layerTrackId || ''))) {
          issue(issues, `${stylePath}.layerTrackId`, 'MAKER_V8_STYLE_TRACK_UNKNOWN', 'Style must reference a known Layer Track.');
        }
        if (style?.colorChannelId && !colorIds.has(String(style.colorChannelId))) {
          issue(issues, `${stylePath}.colorChannelId`, 'MAKER_V8_STYLE_COLOR_UNKNOWN', 'Style references an unknown color channel.');
        }
        const styleAssetId = String(style?.assetId || '');
        if (style?.assetId !== null
          && style?.assetId !== undefined
          && style?.assetId !== ''
          && !assetIds.has(styleAssetId)) {
          issue(issues, `${stylePath}.assetId`, 'MAKER_V8_STYLE_ASSET_UNKNOWN', 'Style references an unknown Asset.');
        }
        if (compile && (!assetIds.has(styleAssetId)
          || String(assets.get(styleAssetId)?.mediaType || '').toLowerCase() !== 'image/png')) {
          issue(issues, `${stylePath}.assetId`, 'MAKER_V8_STYLE_ASSET_INVALID', 'Published Style must reference exactly one PNG Asset.');
        }
        const transform = style?.transform;
        if (!isRecord(transform)
          || !['x', 'y', 'scale', 'rotation'].every((field) => Number.isFinite(transform[field]))
          || transform.scale <= 0
          || transform.scale > 100) {
          issue(issues, `${stylePath}.transform`, 'MAKER_V8_STYLE_TRANSFORM_INVALID', 'Style transform needs finite x/y/rotation and a scale from 0 through 100.');
        }
        for (const field of ['positionConfirmed', 'positionLocked', 'styleLocked']) {
          if (typeof style?.[field] !== 'boolean') {
            issue(issues, `${stylePath}.${field}`, 'MAKER_V8_STYLE_STATE_INVALID', 'Style editing states must be explicit booleans.');
          }
        }
        if (typeof style?.opacity !== 'number' || style.opacity < 0 || style.opacity > 1) {
          issue(issues, `${stylePath}.opacity`, 'MAKER_V8_STYLE_OPACITY_INVALID', 'Style opacity must be from 0 through 1.');
        }
        if (!BLEND_MODES.has(style?.blendMode)) {
          issue(issues, `${stylePath}.blendMode`, 'MAKER_V8_STYLE_BLEND_INVALID', 'Style blend mode is unsupported.');
        }
        if (style?.seal?.protected === true && document.capabilities?.seal !== true) {
          issue(issues, `${stylePath}.seal`, 'MAKER_V8_SEAL_CAPABILITY_REQUIRED', 'Protected Style requires the v8 Seal capability.');
        }
        if (style?.physical?.enabled === true && document.capabilities?.physical !== true) {
          issue(issues, `${stylePath}.physical`, 'MAKER_V8_PHYSICAL_CAPABILITY_REQUIRED', 'Physical Style requires the v8 Physical capability.');
        }
      });
      if (!styleIds.has(String(item?.defaultStyleId || ''))) {
        issue(issues, `${itemPath}.defaultStyleId`, 'MAKER_V8_DEFAULT_STYLE_INVALID', 'Item defaultStyleId must reference one of its Styles.');
      }
    });
    if (part?.defaultItemId !== null
      && part?.defaultItemId !== undefined
      && !itemIds.has(String(part.defaultItemId))) {
      issue(issues, `${partPath}.defaultItemId`, 'MAKER_V8_DEFAULT_ITEM_INVALID', 'Part defaultItemId must reference one of its Items.');
    }
    if (compile && part?.required && !part?.defaultItemId) {
      issue(issues, `${partPath}.defaultItemId`, 'MAKER_V8_DEFAULT_ITEM_REQUIRED', 'Required published Part needs a default Item.');
    }
  });
  if (compile && !(Array.isArray(document.parts) ? document.parts : []).some((part) => part?.menuVisible === true)) {
    issue(issues, 'parts', 'MAKER_V8_PLAYER_PART_REQUIRED', 'Published Maker v8 needs at least one Player-visible Part.');
  }

  const parts = Array.isArray(document.parts) ? document.parts : [];
  parts.forEach((part, index) => {
    const parentId = part?.parentPartId;
    if (!parentId) return;
    if (!known.partRecords.has(parentId)) {
      issue(issues, `parts[${index}].parentPartId`, 'MAKER_V8_PARENT_PART_UNKNOWN', 'Parent Part does not exist.');
    } else if (parentId === part.id) {
      issue(issues, `parts[${index}].parentPartId`, 'MAKER_V8_PARENT_PART_SELF', 'Part cannot be its own parent.');
    }
  });
  parts.forEach((part, index) => {
    const visited = new Set();
    let cursor = part;
    while (cursor?.parentPartId && known.partRecords.has(cursor.parentPartId)) {
      if (visited.has(cursor.id)) {
        issue(issues, `parts[${index}].parentPartId`, 'MAKER_V8_PARENT_PART_CYCLE', 'Part hierarchy contains a cycle.');
        break;
      }
      visited.add(cursor.id);
      cursor = known.partRecords.get(cursor.parentPartId);
    }
  });

  parts.forEach((part, partIndex) => {
    const partPath = `parts[${partIndex}]`;
    validateEmbeddedRules(part, partPath, known, issues);
    (Array.isArray(part?.items) ? part.items : []).forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      validateEmbeddedRules(item, itemPath, known, issues);
      (Array.isArray(item?.styles) ? item.styles : []).forEach((style, styleIndex) => {
        validateEmbeddedRules(style, `${itemPath}.styles[${styleIndex}]`, known, issues);
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

  const channels = new Map((Array.isArray(document.colorChannels) ? document.colorChannels : [])
    .map((channel) => [String(channel?.id || ''), channel]));
  validateDefaultRecipe(document, known, channels, compile, issues);
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
      + inventory.colors
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
