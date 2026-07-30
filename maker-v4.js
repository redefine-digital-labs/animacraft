const SCHEMA_VERSION = 'animacraft.maker.v5';

const LIMITS = Object.freeze({
  minCanvas: 64,
  maxCanvas: 8_192,
  maxKeyBytes: 128,
  maxNameBytes: 128,
  maxDescriptionBytes: 2_000,
  maxIdentifierBytes: 512,
  maxParts: 750,
  maxItems: 5_000,
  maxItemsPerPart: 100,
  maxStyles: 10_000,
  maxStylesPerItem: 64,
  maxLayerTracks: 2_048,
  maxColorChannels: 750,
  maxSwatchesPerChannel: 32,
  // A Walrus quilt also contains the manifest, so one of the 5,000 files
  // remains reserved for it.
  maxAssets: 4_999,
  maxExpansionPacks: 256,
  maxRuleTargets: 1_000,
  maxConditionDepth: 12,
});

const PIXEL_MODES = Object.freeze(['smooth', 'pixelated']);
const BLEND_MODES = Object.freeze([
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
const COLOR_CHANNEL_MODES = Object.freeze(['gradient-map']);
const ITEM_STATUSES = Object.freeze(['draft', 'private', 'public']);
const VERSION_COMPATIBILITY = Object.freeze(['initial', 'compatible', 'breaking']);
const LICENSE_KINDS = Object.freeze(['personal-use', 'free-remix', 'paid-commercial', 'exclusive-commission']);
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

function utf8Length(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function safeId(value, fallback = 'item') {
  const normalized = String(value || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return normalized || fallback;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function cloneTargets(value) {
  return Array.isArray(value) ? value.filter(isObject).map((target) => ({
    partId: String(target.partId || target.partKey || ''),
    ...(target.itemId || target.itemKey ? { itemId: String(target.itemId || target.itemKey) } : {}),
    ...(Array.isArray(target.itemIds || target.itemKeys)
      ? { itemIds: [...new Set((target.itemIds || target.itemKeys).map(String).filter(Boolean))].sort() }
      : {}),
    ...(target.styleId || target.styleKey ? { styleId: String(target.styleId || target.styleKey) } : {}),
    ...(Array.isArray(target.styleIds || target.styleKeys)
      ? { styleIds: [...new Set((target.styleIds || target.styleKeys).map(String).filter(Boolean))].sort() }
      : {}),
  })) : [];
}

function normalizeCondition(value) {
  if (!isObject(value)) return null;
  if (value.op === 'selected') {
    return {
      op: 'selected',
      partId: String(value.partId || value.partKey || ''),
      ...(value.itemId || value.itemKey ? { itemId: String(value.itemId || value.itemKey) } : {}),
      ...(Array.isArray(value.itemIds || value.itemKeys)
        ? { itemIds: [...new Set((value.itemIds || value.itemKeys).map(String).filter(Boolean))].sort() }
        : {}),
      ...(value.styleId || value.styleKey ? { styleId: String(value.styleId || value.styleKey) } : {}),
      ...(Array.isArray(value.styleIds || value.styleKeys)
        ? { styleIds: [...new Set((value.styleIds || value.styleKeys).map(String).filter(Boolean))].sort() }
        : {}),
    };
  }
  if (value.op === 'not') return { op: 'not', condition: normalizeCondition(value.condition) };
  if (value.op === 'all' || value.op === 'any') {
    return {
      op: value.op,
      conditions: Array.isArray(value.conditions) ? value.conditions.map(normalizeCondition) : [],
    };
  }
  return clone(value);
}

function defaultVersion(rootMakerId, options = {}) {
  const number = Math.max(1, integer(options.versionNumber, 1));
  const compatibility = options.compatibility || (number === 1 ? 'initial' : 'compatible');
  return {
    rootMakerId,
    versionId: safeId(options.versionId || `${rootMakerId}-v${number}`),
    number,
    parentVersionId: number === 1 ? null : safeId(options.parentVersionId || `${rootMakerId}-v${number - 1}`),
    compatibility,
    compatibleFrom: Math.max(1, integer(options.compatibleFrom, compatibility === 'breaking' ? number : 1)),
    createdAt: options.createdAt || null,
    changelog: String(options.changelog || ''),
  };
}

/**
 * Creates an empty Maker v5 editor document. It is structurally valid in
 * `draft` mode; publication intentionally requires finished public content.
 */
export function createMakerV5Document({
  makerId = 'untitled-maker',
  name = 'Untitled Maker',
  creator = '',
  width = 1024,
  height = 1024,
  pixelMode = 'smooth',
  version = {},
} = {}) {
  const rootMakerId = safeId(version.rootMakerId || makerId, 'untitled-maker');
  return {
    schemaVersion: SCHEMA_VERSION,
    version: defaultVersion(rootMakerId, version),
    metadata: {
      id: safeId(makerId, rootMakerId),
      name: String(name || 'Untitled Maker'),
      summary: '',
      creator: String(creator || ''),
      style: '',
      license: { kind: 'personal-use', note: '' },
      coverAssetId: null,
    },
    canvas: {
      width: integer(width, 1024),
      height: integer(height, 1024),
      pixelMode: PIXEL_MODES.includes(pixelMode) ? pixelMode : 'smooth',
    },
    layerTracks: [],
    colorChannels: [],
    parts: [],
    defaultRecipe: { selections: [], colors: [] },
    expansionPacks: [],
    assets: [],
    publication: {
      royaltyBps: 0,
      mintingEnabled: true,
      mintFeeEnabled: false,
      mintPriceAtomic: 0,
      paymentCoinType: '',
      paymentCoinSymbol: '',
      storage: 'walrus',
      chain: 'sui',
    },
    runtime: {},
    livingContent: null,
    extensions: {},
  };
}

/**
 * Creates the standard Character Maker Part/Item/Style skeleton. Every Item
 * starts with one asset-free default Style linked to its Part's Layer Track;
 * creators upload the PNG directly to that Style in Creator Studio.
 */
export function createCharacterMakerV5Starter(options = {}) {
  const document = createMakerV5Document(options);
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
        }],
      }],
    });
  });
  return document;
}

export class MakerV5ValidationError extends Error {
  constructor(issues) {
    super(`Maker v5 validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}: ${issues[0]?.message || 'Invalid document.'}`);
    this.name = 'MakerV5ValidationError';
    this.issues = issues;
  }
}

function validateSafeId(value, path, issue) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value) || utf8Length(value) > LIMITS.maxKeyBytes) {
    issue(path, 'must be a URL-safe ID no longer than 128 UTF-8 bytes', 'invalid_id');
    return false;
  }
  return true;
}

function validateName(value, path, issue, { required = true, max = LIMITS.maxNameBytes } = {}) {
  if (typeof value !== 'string' || (required && !value.trim()) || utf8Length(value) > max) {
    issue(path, `${required ? 'must be a non-empty string' : 'must be a string'} no longer than ${max} UTF-8 bytes`, 'invalid_text');
    return false;
  }
  return true;
}

function validateContiguousOrder(entries, path, field, issue) {
  const values = entries.map((entry) => entry?.[field]);
  if (values.some((value) => !Number.isInteger(value) || value < 0)
    || new Set(values).size !== values.length
    || values.some((value) => value >= values.length)) {
    issue(path, `${field} values must be unique and contiguous from 0`, 'invalid_order');
  }
}

function selectionTargetKey(target) {
  const itemIds = [...new Set([
    ...(target?.itemId ? [String(target.itemId)] : []),
    ...(Array.isArray(target?.itemIds) ? target.itemIds.map(String) : []),
  ])].sort();
  const styleIds = [...new Set([
    ...(target?.styleId ? [String(target.styleId)] : []),
    ...(Array.isArray(target?.styleIds) ? target.styleIds.map(String) : []),
  ])].sort();
  return JSON.stringify([String(target?.partId || ''), itemIds, styleIds]);
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Returns all validation issues without throwing. Every Item must contain a
 * default Style. Draft mode permits that Style to have no PNG/track yet;
 * publish mode requires every public Style to be fully renderable.
 */
export function collectMakerV5ValidationIssues(document, { mode = 'publish' } = {}) {
  if (!['draft', 'publish'].includes(mode)) throw new TypeError('Maker v5 validation mode must be "draft" or "publish".');
  const publish = mode === 'publish';
  const issues = [];
  const issue = (path, message, code = 'invalid') => issues.push({ path, message: `${path} ${message}.`, code });

  if (!isObject(document)) {
    issue('$', 'must be a JSON object', 'invalid_document');
    return issues;
  }
  if (document.schemaVersion !== SCHEMA_VERSION) issue('schemaVersion', `must equal ${SCHEMA_VERSION}`, 'unsupported_schema');

  const version = isObject(document.version) ? document.version : {};
  if (!isObject(document.version)) issue('version', 'must be an object', 'invalid_version');
  validateSafeId(version.rootMakerId, 'version.rootMakerId', issue);
  validateSafeId(version.versionId, 'version.versionId', issue);
  if (!Number.isInteger(version.number) || version.number < 1) issue('version.number', 'must be a positive integer', 'invalid_version');
  if (!VERSION_COMPATIBILITY.includes(version.compatibility)) issue('version.compatibility', 'uses an unsupported compatibility value', 'invalid_version');
  if (!Number.isInteger(version.compatibleFrom) || version.compatibleFrom < 1 || version.compatibleFrom > version.number) {
    issue('version.compatibleFrom', 'must be between 1 and the current version number', 'invalid_version');
  }
  if (version.number === 1) {
    if (version.parentVersionId !== null) issue('version.parentVersionId', 'must be null for version 1', 'invalid_version');
    if (version.compatibility !== 'initial') issue('version.compatibility', 'must be initial for version 1', 'invalid_version');
  } else {
    validateSafeId(version.parentVersionId, 'version.parentVersionId', issue);
    if (version.compatibility === 'initial') issue('version.compatibility', 'cannot be initial after version 1', 'invalid_version');
  }
  if (version.compatibility === 'breaking' && version.compatibleFrom !== version.number) {
    issue('version.compatibleFrom', 'must equal the current version for a breaking update', 'invalid_version');
  }
  if (version.createdAt !== null && (typeof version.createdAt !== 'string' || Number.isNaN(Date.parse(version.createdAt)))) {
    issue('version.createdAt', 'must be null or an ISO-compatible timestamp', 'invalid_version');
  }
  validateName(version.changelog, 'version.changelog', issue, { required: false, max: LIMITS.maxDescriptionBytes });

  const metadata = isObject(document.metadata) ? document.metadata : {};
  if (!isObject(document.metadata)) issue('metadata', 'must be an object', 'invalid_metadata');
  validateSafeId(metadata.id, 'metadata.id', issue);
  validateName(metadata.name, 'metadata.name', issue);
  validateName(metadata.summary, 'metadata.summary', issue, { required: false, max: LIMITS.maxDescriptionBytes });
  validateName(metadata.creator, 'metadata.creator', issue, { required: publish });
  validateName(metadata.style, 'metadata.style', issue, { required: false });
  if (!isObject(metadata.license) || !LICENSE_KINDS.includes(metadata.license?.kind)) {
    issue('metadata.license', 'must contain a supported license kind', 'invalid_license');
  }
  validateName(metadata.license?.note, 'metadata.license.note', issue, { required: publish, max: LIMITS.maxDescriptionBytes });

  const canvas = isObject(document.canvas) ? document.canvas : {};
  if (!isObject(document.canvas)) issue('canvas', 'must be an object', 'invalid_canvas');
  if (!Number.isInteger(canvas.width) || canvas.width < LIMITS.minCanvas || canvas.width > LIMITS.maxCanvas
    || !Number.isInteger(canvas.height) || canvas.height < LIMITS.minCanvas || canvas.height > LIMITS.maxCanvas) {
    issue('canvas', `width and height must be integers from ${LIMITS.minCanvas} to ${LIMITS.maxCanvas}`, 'invalid_canvas');
  }
  if (!PIXEL_MODES.includes(canvas.pixelMode)) issue('canvas.pixelMode', 'must be smooth or pixelated', 'invalid_pixel_mode');

  const assets = Array.isArray(document.assets) ? document.assets : [];
  if (!Array.isArray(document.assets)) issue('assets', 'must be an array', 'invalid_collection');
  if (assets.length > LIMITS.maxAssets) issue('assets', `cannot contain more than ${LIMITS.maxAssets} entries`, 'limit');
  const assetById = new Map();
  const identifiers = new Set();
  assets.forEach((asset, index) => {
    const path = `assets[${index}]`;
    if (!isObject(asset)) {
      issue(path, 'must be an object', 'invalid_asset');
      return;
    }
    if (validateSafeId(asset.id, `${path}.id`, issue)) {
      if (assetById.has(asset.id)) issue(`${path}.id`, 'duplicates another Asset ID', 'duplicate');
      else assetById.set(asset.id, asset);
    }
    if (asset.identifier === null || asset.identifier === undefined || asset.identifier === '') {
      if (publish) issue(`${path}.identifier`, 'is required for publication', 'missing_asset_identifier');
    } else if (typeof asset.identifier !== 'string' || utf8Length(asset.identifier) > LIMITS.maxIdentifierBytes) {
      issue(`${path}.identifier`, 'must be a string no longer than 512 UTF-8 bytes', 'invalid_asset_identifier');
    } else if (identifiers.has(asset.identifier)) {
      issue(`${path}.identifier`, 'duplicates another published identifier', 'duplicate');
    } else {
      identifiers.add(asset.identifier);
    }
    if (typeof asset.kind !== 'string' || !asset.kind) issue(`${path}.kind`, 'must be a non-empty string', 'invalid_asset');
    if (typeof asset.mediaType !== 'string' || !asset.mediaType) issue(`${path}.mediaType`, 'must be a non-empty string', 'invalid_asset');
    ['width', 'height'].forEach((field) => {
      if (asset[field] !== null && asset[field] !== undefined && (!Number.isInteger(asset[field]) || asset[field] <= 0)) {
        issue(`${path}.${field}`, 'must be null or a positive integer', 'invalid_asset');
      }
    });
  });
  if (metadata.coverAssetId !== null && metadata.coverAssetId !== undefined) {
    const coverAsset = assetById.get(metadata.coverAssetId);
    if (!coverAsset) {
      issue('metadata.coverAssetId', 'references a missing Asset', 'missing_reference');
    } else {
      if (coverAsset.kind !== 'maker-cover') {
        issue('metadata.coverAssetId', 'must reference a dedicated maker-cover Asset', 'invalid_cover_asset');
      }
      if (!String(coverAsset.mediaType || '').toLowerCase().startsWith('image/')) {
        issue('metadata.coverAssetId', 'must reference an image Asset', 'invalid_cover_asset');
      }
    }
  }
  if (publish && !metadata.coverAssetId) issue('metadata.coverAssetId', 'is required for publication', 'missing_reference');

  const tracks = Array.isArray(document.layerTracks) ? document.layerTracks : [];
  if (!Array.isArray(document.layerTracks)) issue('layerTracks', 'must be an array', 'invalid_collection');
  if (tracks.length > LIMITS.maxLayerTracks) issue('layerTracks', `cannot contain more than ${LIMITS.maxLayerTracks} entries`, 'limit');
  const trackById = new Map();
  tracks.forEach((track, index) => {
    const path = `layerTracks[${index}]`;
    if (!isObject(track)) {
      issue(path, 'must be an object', 'invalid_layer_track');
      return;
    }
    if (validateSafeId(track.id, `${path}.id`, issue)) {
      if (trackById.has(track.id)) issue(`${path}.id`, 'duplicates another LayerTrack ID', 'duplicate');
      else trackById.set(track.id, track);
    }
    validateName(track.name, `${path}.name`, issue);
    if (hasOwn(track, 'transform')) {
      issue(`${path}.transform`, 'is obsolete; Style.transform is the only coordinate source in Maker v5', 'unsupported_schema');
    }
    if (track.locked !== undefined && typeof track.locked !== 'boolean') issue(`${path}.locked`, 'must be boolean', 'invalid_layer_track');
    if (track.referenceAssetId !== null && track.referenceAssetId !== undefined && !assetById.has(track.referenceAssetId)) {
      issue(`${path}.referenceAssetId`, 'references a missing Asset', 'missing_reference');
    }
  });
  validateContiguousOrder(tracks, 'layerTracks', 'order', issue);

  const channels = Array.isArray(document.colorChannels) ? document.colorChannels : [];
  if (!Array.isArray(document.colorChannels)) issue('colorChannels', 'must be an array', 'invalid_collection');
  if (channels.length > LIMITS.maxColorChannels) issue('colorChannels', `cannot contain more than ${LIMITS.maxColorChannels} entries`, 'limit');
  const channelById = new Map();
  channels.forEach((channel, channelIndex) => {
    const path = `colorChannels[${channelIndex}]`;
    if (!isObject(channel)) {
      issue(path, 'must be an object', 'invalid_color_channel');
      return;
    }
    if (validateSafeId(channel.id, `${path}.id`, issue)) {
      if (channelById.has(channel.id)) issue(`${path}.id`, 'duplicates another ColorChannel ID', 'duplicate');
      else channelById.set(channel.id, channel);
    }
    validateName(channel.name, `${path}.name`, issue);
    if (!COLOR_CHANNEL_MODES.includes(channel.mode)) issue(`${path}.mode`, 'must be gradient-map', 'invalid_color_channel');
    const swatches = Array.isArray(channel.swatches) ? channel.swatches : [];
    if (!Array.isArray(channel.swatches)) issue(`${path}.swatches`, 'must be an array', 'invalid_collection');
    if ((publish && !swatches.length) || swatches.length > LIMITS.maxSwatchesPerChannel) {
      issue(`${path}.swatches`, `must contain ${publish ? '1 to ' : 'at most '}${LIMITS.maxSwatchesPerChannel} entries`, 'invalid_color_channel');
    }
    const swatchIds = new Set();
    swatches.forEach((swatch, swatchIndex) => {
      const swatchPath = `${path}.swatches[${swatchIndex}]`;
      if (!isObject(swatch)) {
        issue(swatchPath, 'must be an object', 'invalid_swatch');
        return;
      }
      if (validateSafeId(swatch.id, `${swatchPath}.id`, issue)) {
        if (swatchIds.has(swatch.id)) issue(`${swatchPath}.id`, 'duplicates another swatch ID in this channel', 'duplicate');
        swatchIds.add(swatch.id);
      }
      validateName(swatch.name, `${swatchPath}.name`, issue);
      if (!HEX_COLOR_PATTERN.test(String(swatch.hintColor || ''))) issue(`${swatchPath}.hintColor`, 'must be a six- or eight-digit hex color', 'invalid_color');
      const stops = Array.isArray(swatch.stops) ? swatch.stops : [];
      if (stops.length < 2) issue(`${swatchPath}.stops`, 'needs at least two stops for gradient mapping', 'invalid_gradient');
      const offsets = stops.map((stop) => stop?.offset);
      stops.forEach((stop, stopIndex) => {
        if (!isObject(stop) || typeof stop.offset !== 'number' || stop.offset < 0 || stop.offset > 1
          || !HEX_COLOR_PATTERN.test(String(stop.color || ''))) {
          issue(`${swatchPath}.stops[${stopIndex}]`, 'must contain an offset from 0 to 1 and a hex color', 'invalid_gradient');
        }
      });
      if (offsets.some((offset, index) => index > 0 && offset <= offsets[index - 1]) || offsets[0] !== 0 || offsets.at(-1) !== 1) {
        issue(`${swatchPath}.stops`, 'must be strictly ordered and span offsets 0 through 1', 'invalid_gradient');
      }
    });
    if (channel.defaultSwatchId !== null && !swatchIds.has(channel.defaultSwatchId)) {
      issue(`${path}.defaultSwatchId`, 'references a missing swatch', 'missing_reference');
    }
    if (publish && !channel.defaultSwatchId) issue(`${path}.defaultSwatchId`, 'is required for publication', 'missing_reference');
  });
  validateContiguousOrder(channels, 'colorChannels', 'order', issue);

  const parts = Array.isArray(document.parts) ? document.parts : [];
  if (!Array.isArray(document.parts)) issue('parts', 'must be an array', 'invalid_collection');
  if ((publish && !parts.length) || parts.length > LIMITS.maxParts) {
    issue('parts', `must contain ${publish ? '1 to ' : 'at most '}${LIMITS.maxParts} entries`, 'invalid_parts');
  }
  const partById = new Map();
  const itemByPart = new Map();
  const styleByPartItem = new Map();
  let totalItems = 0;
  let totalStyles = 0;

  parts.forEach((part, partIndex) => {
    const path = `parts[${partIndex}]`;
    if (!isObject(part)) {
      issue(path, 'must be an object', 'invalid_part');
      return;
    }
    if (validateSafeId(part.id, `${path}.id`, issue)) {
      if (partById.has(part.id)) issue(`${path}.id`, 'duplicates another Part ID', 'duplicate');
      else partById.set(part.id, part);
    }
    validateName(part.name, `${path}.name`, issue);
    if (typeof part.required !== 'boolean') issue(`${path}.required`, 'must be boolean', 'invalid_part');
    if (typeof part.menuVisible !== 'boolean') issue(`${path}.menuVisible`, 'must be boolean', 'invalid_part');
    if (part.parentPartId !== null && part.parentPartId !== undefined && typeof part.parentPartId !== 'string') {
      issue(`${path}.parentPartId`, 'must be null or a Part ID', 'invalid_part');
    }
    if (!Array.isArray(part.requires) || !Array.isArray(part.excludes)) issue(path, 'must contain requires and excludes arrays', 'invalid_rules');
    const items = Array.isArray(part.items) ? part.items : [];
    if (!Array.isArray(part.items)) issue(`${path}.items`, 'must be an array', 'invalid_collection');
    const publicItems = items.filter((item) => item?.status === 'public');
    if ((publish && !publicItems.length) || items.length > LIMITS.maxItemsPerPart) {
      issue(`${path}.items`, `must contain ${publish ? '1 to ' : 'at most '}${LIMITS.maxItemsPerPart} entries`, 'invalid_items');
    }
    totalItems += items.length;
    const itemsById = new Map();
    itemByPart.set(part.id, itemsById);

    items.forEach((item, itemIndex) => {
      const itemPath = `${path}.items[${itemIndex}]`;
      if (!isObject(item)) {
        issue(itemPath, 'must be an object', 'invalid_item');
        return;
      }
      if (hasOwn(item, 'variants') || hasOwn(item, 'defaultVariantId')) {
        issue(itemPath, 'uses obsolete Variant fields; Maker v5 requires styles/defaultStyleId', 'unsupported_schema');
      }
      if (validateSafeId(item.id, `${itemPath}.id`, issue)) {
        if (itemsById.has(item.id)) issue(`${itemPath}.id`, 'duplicates another Item ID in this Part', 'duplicate');
        else itemsById.set(item.id, item);
      }
      validateName(item.name, `${itemPath}.name`, issue);
      if (!ITEM_STATUSES.includes(item.status)) issue(`${itemPath}.status`, 'must be draft, private or public', 'invalid_item');
      if (item.importKey !== undefined) validateSafeId(item.importKey, `${itemPath}.importKey`, issue);
      const publishItem = item.status === 'public';
      if (!Array.isArray(item.requires) || !Array.isArray(item.excludes)) issue(itemPath, 'must contain requires and excludes arrays', 'invalid_rules');
      if (item.thumbnailAssetId !== null && item.thumbnailAssetId !== undefined && !assetById.has(item.thumbnailAssetId)) {
        issue(`${itemPath}.thumbnailAssetId`, 'references a missing Asset', 'missing_reference');
      }
      if (!hasOwn(item, 'defaultStyleId')
        || (item.defaultStyleId !== null && typeof item.defaultStyleId !== 'string')) {
        issue(`${itemPath}.defaultStyleId`, 'must be null or a Style ID', 'invalid_item');
      }

      const styles = Array.isArray(item.styles) ? item.styles : [];
      if (!Array.isArray(item.styles)) issue(`${itemPath}.styles`, 'must be an array', 'invalid_collection');
      if (!styles.length || styles.length > LIMITS.maxStylesPerItem) {
        issue(`${itemPath}.styles`, `must contain 1 to ${LIMITS.maxStylesPerItem} entries`, 'invalid_styles');
      }
      totalStyles += styles.length;
      const stylesById = new Map();
      styleByPartItem.set(`${part.id}\u0000${item.id}`, stylesById);

      styles.forEach((style, styleIndex) => {
        const stylePath = `${itemPath}.styles[${styleIndex}]`;
        if (!isObject(style)) {
          issue(stylePath, 'must be an object', 'invalid_style');
          return;
        }
        if (hasOwn(style, 'layerBindings') || hasOwn(style, 'bindingId') || hasOwn(style, 'inheritTrackTransform')
          || hasOwn(style, 'assetsBySwatch')) {
          issue(stylePath, 'uses obsolete nested/multi-asset fields; a v5 Style is one PNG and is itself the render unit', 'unsupported_schema');
        }
        ['visible', 'hidden', 'enabled', 'visibilityCondition', 'rules'].forEach((field) => {
          if (hasOwn(style, field)) {
            issue(
              `${stylePath}.${field}`,
              'is an obsolete Style visibility switch; Maker v5 uses visibleWhen only',
              'unsupported_schema',
            );
          }
        });
        if (validateSafeId(style.id, `${stylePath}.id`, issue)) {
          if (stylesById.has(style.id)) issue(`${stylePath}.id`, 'duplicates another Style ID in this Item', 'duplicate');
          else stylesById.set(style.id, style);
        }
        validateName(style.name, `${stylePath}.name`, issue);
        if (!Array.isArray(style.requires) || !Array.isArray(style.excludes)) issue(stylePath, 'must contain requires and excludes arrays', 'invalid_rules');

        if (!hasOwn(style, 'layerTrackId')
          || (style.layerTrackId !== null && typeof style.layerTrackId !== 'string')) {
          issue(`${stylePath}.layerTrackId`, 'must be null or a LayerTrack ID', 'invalid_style');
        }
        if (style.layerTrackId === null || style.layerTrackId === undefined || style.layerTrackId === '') {
          if (publish && publishItem) issue(`${stylePath}.layerTrackId`, 'is required for a public Style', 'missing_reference');
        } else if (!trackById.has(style.layerTrackId)) {
          issue(`${stylePath}.layerTrackId`, 'references a missing LayerTrack', 'missing_reference');
        }
        if (!hasOwn(style, 'assetId') || (style.assetId !== null && typeof style.assetId !== 'string')) {
          issue(`${stylePath}.assetId`, 'must be null or an Asset ID', 'invalid_style');
        }
        if (style.assetId === null || style.assetId === undefined || style.assetId === '') {
          if (publish && publishItem) issue(`${stylePath}.assetId`, 'is required for a public Style', 'missing_reference');
        } else if (!assetById.has(style.assetId)) {
          issue(`${stylePath}.assetId`, 'references a missing Asset', 'missing_reference');
        } else if (assetById.get(style.assetId)?.mediaType !== 'image/png') {
          issue(`${stylePath}.assetId`, 'must reference exactly one PNG Asset', 'invalid_style_asset');
        }
        if (!hasOwn(style, 'colorChannelId')
          || (style.colorChannelId !== null && typeof style.colorChannelId !== 'string')) {
          issue(`${stylePath}.colorChannelId`, 'must be null or a ColorChannel ID', 'invalid_style');
        }

        const transform = style.transform;
        if (!isObject(transform) || !Number.isFinite(transform.x) || !Number.isFinite(transform.y)
          || !Number.isFinite(transform.scale) || transform.scale <= 0 || transform.scale > 100
          || !Number.isFinite(transform.rotation)) {
          issue(`${stylePath}.transform`, 'must contain finite x, y, rotation and a scale greater than 0 and at most 100', 'invalid_transform');
        }
        ['positionConfirmed', 'positionLocked', 'styleLocked'].forEach((field) => {
          if (typeof style[field] !== 'boolean') issue(`${stylePath}.${field}`, 'must be boolean', 'invalid_style');
        });
        if (typeof style.opacity !== 'number' || style.opacity < 0 || style.opacity > 1) {
          issue(`${stylePath}.opacity`, 'must be a number from 0 to 1', 'invalid_opacity');
        }
        if (!BLEND_MODES.includes(style.blendMode)) issue(`${stylePath}.blendMode`, 'uses an unsupported blend mode', 'invalid_blend_mode');

        if (style.colorChannelId !== null && style.colorChannelId !== undefined
          && !channelById.has(style.colorChannelId)) {
          issue(`${stylePath}.colorChannelId`, 'references a missing ColorChannel', 'missing_reference');
        }
      });

      validateContiguousOrder(styles, `${itemPath}.styles`, 'displayOrder', issue);
      if (!item.defaultStyleId) {
        issue(`${itemPath}.defaultStyleId`, 'is required and must reference a Style', 'missing_reference');
      } else if (!stylesById.has(item.defaultStyleId)) {
        issue(`${itemPath}.defaultStyleId`, 'references a missing Style', 'missing_reference');
      }
    });

    validateContiguousOrder(items, `${path}.items`, 'displayOrder', issue);
    if (part.defaultItemId !== null && !itemsById.has(part.defaultItemId)) {
      issue(`${path}.defaultItemId`, 'references a missing Item', 'missing_reference');
    }
    if (publish && part.required && !part.defaultItemId) issue(`${path}.defaultItemId`, 'is required for this Part', 'missing_reference');
    if (publish && part.defaultItemId && itemsById.get(part.defaultItemId)?.status !== 'public') {
      issue(`${path}.defaultItemId`, 'must reference a public Item for publication', 'invalid_default');
    }
    if (part.iconAssetId !== null && part.iconAssetId !== undefined && !assetById.has(part.iconAssetId)) {
      issue(`${path}.iconAssetId`, 'references a missing Asset', 'missing_reference');
    }
  });

  validateContiguousOrder(parts, 'parts', 'menuOrder', issue);
  if (totalItems > LIMITS.maxItems) issue('parts', `contains more than ${LIMITS.maxItems} Items`, 'limit');
  if (totalStyles > LIMITS.maxStyles) issue('parts', `contains more than ${LIMITS.maxStyles} Styles`, 'limit');
  if (publish && !parts.some((part) => part?.menuVisible === true)) issue('parts', 'must contain at least one player-visible Part', 'invalid_parts');

  parts.forEach((part, partIndex) => {
    if (!isObject(part)) return;
    const path = `parts[${partIndex}]`;
    if (part.parentPartId !== null && part.parentPartId !== undefined) {
      if (!partById.has(part.parentPartId)) issue(`${path}.parentPartId`, 'references a missing Part', 'missing_reference');
      if (part.parentPartId === part.id) issue(`${path}.parentPartId`, 'cannot reference itself', 'cycle');
    }
  });
  parts.forEach((part, partIndex) => {
    const visited = new Set();
    let cursor = part;
    while (cursor?.parentPartId) {
      if (visited.has(cursor.id)) {
        issue(`parts[${partIndex}].parentPartId`, 'creates a parent Part cycle', 'cycle');
        break;
      }
      visited.add(cursor.id);
      cursor = partById.get(cursor.parentPartId);
    }
  });

  function validateTarget(target, path, { requirePublic = false } = {}) {
    if (!isObject(target)) {
      issue(path, 'must be a selection target object', 'invalid_rule_target');
      return;
    }
    if (hasOwn(target, 'variantId') || hasOwn(target, 'variantKey')) {
      issue(path, 'uses obsolete variantId; Maker v5 targets use styleId', 'unsupported_schema');
    }
    const part = partById.get(target.partId);
    if (!part) {
      issue(`${path}.partId`, 'references a missing Part', 'missing_reference');
      return;
    }

    const validateIdList = (value, field) => {
      if (!Array.isArray(value) || !value.length) {
        issue(`${path}.${field}`, 'must be a non-empty array of IDs', 'invalid_rule_target');
        return [];
      }
      if (value.length > LIMITS.maxRuleTargets) {
        issue(`${path}.${field}`, `cannot contain more than ${LIMITS.maxRuleTargets} IDs`, 'limit');
      }
      const seen = new Set();
      return value.flatMap((id, index) => {
        if (typeof id !== 'string' || !id) {
          issue(`${path}.${field}[${index}]`, 'must be a non-empty ID string', 'invalid_rule_target');
          return [];
        }
        if (seen.has(id)) issue(`${path}.${field}[${index}]`, 'duplicates another ID', 'duplicate');
        seen.add(id);
        return [id];
      });
    };

    const hasItemId = hasOwn(target, 'itemId');
    const hasItemIds = hasOwn(target, 'itemIds');
    if (hasItemId && hasItemIds) {
      issue(path, 'cannot use itemId and itemIds together', 'invalid_rule_target');
    }
    const directItemIds = hasItemId && typeof target.itemId === 'string' && target.itemId
      ? [target.itemId]
      : [];
    const groupedItemIds = hasItemIds ? validateIdList(target.itemIds, 'itemIds') : [];
    const itemIds = [...directItemIds, ...groupedItemIds];
    if (hasItemId && (typeof target.itemId !== 'string' || !target.itemId)) {
      issue(`${path}.itemId`, 'must be a non-empty ID string', 'invalid_rule_target');
    }
    directItemIds.forEach((itemId) => {
      const targetItem = itemByPart.get(target.partId)?.get(itemId);
      if (!targetItem) {
        issue(`${path}.itemId`, 'references a missing Item in the target Part', 'missing_reference');
      } else if (requirePublic && targetItem.status !== 'public') {
        issue(`${path}.itemId`, 'must reference a public Item for publication', 'unpublished_rule_target');
      }
    });
    groupedItemIds.forEach((itemId, index) => {
      const targetItem = itemByPart.get(target.partId)?.get(itemId);
      if (!targetItem) {
        issue(`${path}.itemIds[${index}]`, 'references a missing Item in the target Part', 'missing_reference');
      } else if (requirePublic && targetItem.status !== 'public') {
        issue(`${path}.itemIds[${index}]`, 'must reference a public Item for publication', 'unpublished_rule_target');
      }
    });

    const hasStyleId = hasOwn(target, 'styleId');
    const hasStyleIds = hasOwn(target, 'styleIds');
    if (hasStyleId && hasStyleIds) {
      issue(path, 'cannot use styleId and styleIds together', 'invalid_rule_target');
    }
    const directStyleIds = hasStyleId && typeof target.styleId === 'string' && target.styleId
      ? [target.styleId]
      : [];
    const groupedStyleIds = hasStyleIds ? validateIdList(target.styleIds, 'styleIds') : [];
    const styleIds = [...directStyleIds, ...groupedStyleIds];
    if (hasStyleId && (typeof target.styleId !== 'string' || !target.styleId)) {
      issue(`${path}.styleId`, 'must be a non-empty ID string', 'invalid_rule_target');
    }
    if ((hasStyleId || hasStyleIds) && new Set(itemIds).size !== 1) {
      issue(
        `${path}.${hasStyleIds ? 'styleIds' : 'styleId'}`,
        'requires exactly one Item target',
        'invalid_rule_target',
      );
      return;
    }
    if (styleIds.length) {
      const itemId = itemIds[0];
      const styles = styleByPartItem.get(`${target.partId}\u0000${itemId}`);
      directStyleIds.forEach((styleId) => {
        if (!styles?.has(styleId)) {
          issue(`${path}.styleId`, 'references a missing Style in the target Item', 'missing_reference');
        }
      });
      groupedStyleIds.forEach((styleId, index) => {
        if (!styles?.has(styleId)) {
          issue(`${path}.styleIds[${index}]`, 'references a missing Style in the target Item', 'missing_reference');
        }
      });
    }
  }

  function validateRuleLists(owner, path, { publishable = true } = {}) {
    ['requires', 'excludes'].forEach((field) => {
      const targets = Array.isArray(owner?.[field]) ? owner[field] : [];
      if (targets.length > LIMITS.maxRuleTargets) issue(`${path}.${field}`, `cannot contain more than ${LIMITS.maxRuleTargets} targets`, 'limit');
      const keys = new Set();
      targets.forEach((target, index) => {
        validateTarget(target, `${path}.${field}[${index}]`, {
          requirePublic: publish && publishable,
        });
        const key = selectionTargetKey(target);
        if (keys.has(key)) issue(`${path}.${field}[${index}]`, 'duplicates another target', 'duplicate');
        keys.add(key);
      });
    });
    const required = new Set((owner?.requires || []).map(selectionTargetKey));
    (owner?.excludes || []).forEach((target, index) => {
      if (required.has(selectionTargetKey(target))) issue(`${path}.excludes[${index}]`, 'cannot also be required by the same object', 'contradictory_rule');
    });
  }

  function validateCondition(condition, path, depth = 0, { publishable = true } = {}) {
    if (condition === null || condition === undefined) return;
    if (depth > LIMITS.maxConditionDepth) {
      issue(path, `exceeds the maximum nesting depth of ${LIMITS.maxConditionDepth}`, 'condition_depth');
      return;
    }
    if (!isObject(condition)) {
      issue(path, 'must be null or a condition object', 'invalid_condition');
      return;
    }
    if (condition.op === 'selected') {
      validateTarget(condition, path, {
        requirePublic: publish && publishable,
      });
      return;
    }
    if (condition.op === 'not') {
      if (!condition.condition) issue(`${path}.condition`, 'is required for a not condition', 'invalid_condition');
      validateCondition(condition.condition, `${path}.condition`, depth + 1, { publishable });
      return;
    }
    if (condition.op === 'all' || condition.op === 'any') {
      if (!Array.isArray(condition.conditions) || !condition.conditions.length) {
        issue(`${path}.conditions`, 'must be a non-empty array', 'invalid_condition');
        return;
      }
      condition.conditions.forEach((child, index) => (
        validateCondition(child, `${path}.conditions[${index}]`, depth + 1, { publishable })
      ));
      return;
    }
    issue(`${path}.op`, 'must be selected, not, all, or any', 'invalid_condition');
  }

  parts.forEach((part, partIndex) => {
    if (!isObject(part)) return;
    const partPath = `parts[${partIndex}]`;
    validateRuleLists(part, partPath, { publishable: true });
    validateCondition(part.visibleWhen, `${partPath}.visibleWhen`, 0, { publishable: true });
    (part.items || []).forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      const publishable = item?.status === 'public';
      validateRuleLists(item, itemPath, { publishable });
      validateCondition(item.visibleWhen, `${itemPath}.visibleWhen`, 0, { publishable });
      (item.styles || []).forEach((style, styleIndex) => {
        const stylePath = `${itemPath}.styles[${styleIndex}]`;
        validateRuleLists(style, stylePath, { publishable });
        validateCondition(style.visibleWhen, `${stylePath}.visibleWhen`, 0, { publishable });
      });
    });
  });

  const recipe = isObject(document.defaultRecipe) ? document.defaultRecipe : {};
  if (!isObject(document.defaultRecipe)) issue('defaultRecipe', 'must be an object', 'invalid_recipe');
  const selections = Array.isArray(recipe.selections) ? recipe.selections : [];
  const recipeColors = Array.isArray(recipe.colors) ? recipe.colors : [];
  if (!Array.isArray(recipe.selections)) issue('defaultRecipe.selections', 'must be an array', 'invalid_recipe');
  if (!Array.isArray(recipe.colors)) issue('defaultRecipe.colors', 'must be an array', 'invalid_recipe');
  const selectionParts = new Set();
  selections.forEach((selection, index) => {
    const path = `defaultRecipe.selections[${index}]`;
    if (!isObject(selection)) {
      issue(path, 'must be an object', 'invalid_recipe');
      return;
    }
    if (selectionParts.has(selection.partId)) issue(`${path}.partId`, 'duplicates another default Part selection', 'duplicate');
    selectionParts.add(selection.partId);
    validateTarget(selection, path, { requirePublic: publish });
    if (!selection.itemId) issue(`${path}.itemId`, 'is required in a Recipe selection', 'missing_reference');
    if (!selection.styleId) issue(`${path}.styleId`, 'is required in a Recipe selection', 'missing_reference');
    const part = partById.get(selection.partId);
    const item = itemByPart.get(selection.partId)?.get(selection.itemId);
    if (part?.defaultItemId && selection.itemId !== part.defaultItemId) issue(`${path}.itemId`, 'must match the Part defaultItemId', 'invalid_default');
    if (item?.defaultStyleId && selection.styleId !== item.defaultStyleId) issue(`${path}.styleId`, 'must match the Item defaultStyleId', 'invalid_default');
  });
  if (publish) {
    parts.forEach((part, partIndex) => {
      if ((part?.required || part?.defaultItemId) && !selectionParts.has(part.id)) {
        issue('defaultRecipe.selections', `is missing the default selection for parts[${partIndex}]`, 'missing_default');
      }
    });
  }

  const selectedChannels = new Set();
  recipeColors.forEach((selection, index) => {
    const path = `defaultRecipe.colors[${index}]`;
    if (!isObject(selection)) {
      issue(path, 'must be an object', 'invalid_recipe');
      return;
    }
    const channel = channelById.get(selection.channelId);
    if (!channel) issue(`${path}.channelId`, 'references a missing ColorChannel', 'missing_reference');
    if (selectedChannels.has(selection.channelId)) issue(`${path}.channelId`, 'duplicates another default ColorChannel selection', 'duplicate');
    selectedChannels.add(selection.channelId);
    if (channel && !channel.swatches.some((swatch) => swatch.id === selection.swatchId)) issue(`${path}.swatchId`, 'references a missing swatch', 'missing_reference');
    if (channel?.defaultSwatchId && selection.swatchId !== channel.defaultSwatchId) issue(`${path}.swatchId`, 'must match the ColorChannel defaultSwatchId', 'invalid_default');
  });
  if (publish) {
    channels.forEach((channel, channelIndex) => {
      if (channel?.defaultSwatchId && !selectedChannels.has(channel.id)) {
        issue('defaultRecipe.colors', `is missing the default swatch for colorChannels[${channelIndex}]`, 'missing_default');
      }
    });
  }

  const packs = Array.isArray(document.expansionPacks) ? document.expansionPacks : [];
  if (!Array.isArray(document.expansionPacks)) issue('expansionPacks', 'must be an array', 'invalid_collection');
  if (packs.length > LIMITS.maxExpansionPacks) issue('expansionPacks', `cannot contain more than ${LIMITS.maxExpansionPacks} entries`, 'limit');
  const packIds = new Set();
  packs.forEach((pack, index) => {
    const path = `expansionPacks[${index}]`;
    if (!isObject(pack)) {
      issue(path, 'must be an object', 'invalid_expansion_pack');
      return;
    }
    if (validateSafeId(pack.id, `${path}.id`, issue)) {
      if (packIds.has(pack.id)) issue(`${path}.id`, 'duplicates another ExpansionPack ID', 'duplicate');
      packIds.add(pack.id);
    }
    validateName(pack.name, `${path}.name`, issue);
    if (!Number.isInteger(pack.version) || pack.version < 1) issue(`${path}.version`, 'must be a positive integer', 'invalid_expansion_pack');
    if (pack.baseMakerId !== version.rootMakerId) issue(`${path}.baseMakerId`, 'must match version.rootMakerId', 'invalid_expansion_pack');
    if (!Number.isInteger(pack.baseMakerVersion) || pack.baseMakerVersion < 1 || pack.baseMakerVersion > version.number) {
      issue(`${path}.baseMakerVersion`, 'must reference an existing version of this Maker', 'invalid_expansion_pack');
    }
    if (typeof pack.manifestIdentifier !== 'string' || !pack.manifestIdentifier || utf8Length(pack.manifestIdentifier) > LIMITS.maxIdentifierBytes) {
      issue(`${path}.manifestIdentifier`, 'must be a non-empty identifier no longer than 512 UTF-8 bytes', 'invalid_expansion_pack');
    }
    if (typeof pack.required !== 'boolean') issue(`${path}.required`, 'must be boolean', 'invalid_expansion_pack');
  });

  const publication = isObject(document.publication) ? document.publication : {};
  if (!isObject(document.publication)) issue('publication', 'must be an object', 'invalid_publication');
  if (![0, 100, 200, 300, 400, 500].includes(publication.royaltyBps)) {
    issue('publication.royaltyBps', 'must be 0 or one of the supported 1% through 5% tiers', 'invalid_publication');
  }
  if (typeof publication.mintingEnabled !== 'boolean' || typeof publication.mintFeeEnabled !== 'boolean') {
    issue('publication', 'must contain boolean mintingEnabled and mintFeeEnabled flags', 'invalid_publication');
  }
  if (!Number.isSafeInteger(publication.mintPriceAtomic) || publication.mintPriceAtomic < 0
    || (!publication.mintingEnabled && publication.mintFeeEnabled)
    || (publication.mintFeeEnabled && publication.mintPriceAtomic === 0)
    || (!publication.mintFeeEnabled && publication.mintPriceAtomic !== 0)) {
    issue('publication.mintPriceAtomic', 'is inconsistent with the minting and fee flags', 'invalid_publication');
  }
  if (publication.mintFeeEnabled
    && !/^0x[0-9a-f]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/i.test(String(publication.paymentCoinType || ''))) {
    issue('publication.paymentCoinType', 'must be a canonical Sui coin type for paid minting', 'invalid_publication');
  }
  if (!isObject(document.runtime)) issue('runtime', 'must be an object', 'invalid_runtime');
  if (document.livingContent !== null && !isObject(document.livingContent)) issue('livingContent', 'must be null or an object', 'invalid_living_content');
  if (!isObject(document.extensions)) {
    issue('extensions', 'must be an object', 'invalid_extensions');
  } else if (document.extensions.playerExport !== undefined) {
    const playerExport = document.extensions.playerExport;
    if (!isObject(playerExport)) {
      issue('extensions.playerExport', 'must be an object', 'invalid_extensions');
    } else if (!Array.isArray(playerExport.backgroundPartIds)) {
      issue(
        'extensions.playerExport.backgroundPartIds',
        'must be an array of Part IDs',
        'invalid_extensions',
      );
    } else {
      const backgroundPartIds = new Set();
      playerExport.backgroundPartIds.forEach((partId, index) => {
        const path = `extensions.playerExport.backgroundPartIds[${index}]`;
        if (!validateSafeId(partId, path, issue)) return;
        if (backgroundPartIds.has(partId)) issue(path, 'duplicates another background Part ID', 'duplicate');
        else if (!partById.has(partId)) issue(path, 'references a missing Part', 'missing_reference');
        backgroundPartIds.add(partId);
      });
    }
  }

  return issues;
}

export function validateMakerV5Document(document, options) {
  const issues = collectMakerV5ValidationIssues(document, options);
  if (issues.length) throw new MakerV5ValidationError(issues);
  return document;
}

export function isMakerV5Document(value) {
  return isObject(value) && value.schemaVersion === SCHEMA_VERSION;
}

/**
 * Legacy v3/v4 graphs cannot be mapped losslessly because v5 removes both
 * Variants and multi-binding render units. The retained name is an API alias,
 * not a migration promise.
 */
export function migrateMakerV3ToV5(source, options = {}) {
  if (!isMakerV5Document(source)) {
    throw new TypeError('Legacy Maker v3/v4 documents are incompatible with animacraft.maker.v5; create a new Maker v5 document.');
  }
  const copied = clone(source);
  if (options.validate) validateMakerV5Document(copied, { mode: options.validate === true ? 'publish' : options.validate });
  return copied;
}

// Temporary v4 export aliases keep existing import sites loadable while all
// returned/accepted documents use the canonical v5 schema and Style vocabulary.
export const createMakerV4Document = createMakerV5Document;
export const createCharacterMakerV4Starter = createCharacterMakerV5Starter;
export const collectMakerV4ValidationIssues = collectMakerV5ValidationIssues;
export const validateMakerV4Document = validateMakerV5Document;
export const migrateMakerV3ToV4 = migrateMakerV3ToV5;
export const isMakerV4Document = isMakerV5Document;
export { MakerV5ValidationError as MakerV4ValidationError };

export {
  BLEND_MODES as MAKER_V5_BLEND_MODES,
  COLOR_CHANNEL_MODES as MAKER_V5_COLOR_CHANNEL_MODES,
  LIMITS as MAKER_V5_LIMITS,
  PIXEL_MODES as MAKER_V5_PIXEL_MODES,
  SCHEMA_VERSION as MAKER_V5_SCHEMA_VERSION,
  VERSION_COMPATIBILITY as MAKER_V5_VERSION_COMPATIBILITY,
  BLEND_MODES as MAKER_V4_BLEND_MODES,
  COLOR_CHANNEL_MODES as MAKER_V4_COLOR_CHANNEL_MODES,
  LIMITS as MAKER_V4_LIMITS,
  PIXEL_MODES as MAKER_V4_PIXEL_MODES,
  SCHEMA_VERSION as MAKER_V4_SCHEMA_VERSION,
  VERSION_COMPATIBILITY as MAKER_V4_VERSION_COMPATIBILITY,
};
