const SCHEMA_VERSION = 'animacraft.maker.v4';

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
  maxVariants: 10_000,
  maxVariantsPerItem: 64,
  maxLayerTracks: 2_048,
  maxBindings: 20_000,
  maxColorChannels: 750,
  maxSwatchesPerChannel: 32,
  // A Walrus quilt also contains the v4 manifest, so one of the 5,000 files
  // remains reserved for it, matching the existing v3 publication boundary.
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
const COLOR_CHANNEL_MODES = Object.freeze(['asset-map', 'gradient-map']);
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

function uniqueId(preferred, used) {
  const base = safeId(preferred);
  let result = base;
  let suffix = 2;
  while (used.has(result)) {
    result = `${base.slice(0, 88)}-${suffix}`;
    suffix += 1;
  }
  used.add(result);
  return result;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizedOpacity(value) {
  const number = finiteNumber(value, 100);
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function normalizedBlendMode(value) {
  return BLEND_MODES.includes(value) ? value : 'normal';
}

function normalizeHex(value, fallback = '#7b5cff') {
  return HEX_COLOR_PATTERN.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

function cloneTargets(value) {
  return Array.isArray(value) ? value.filter(isObject).map((target) => ({
    partId: String(target.partId || target.partKey || ''),
    ...(target.itemId || target.itemKey ? { itemId: String(target.itemId || target.itemKey) } : {}),
    ...(target.variantId ? { variantId: String(target.variantId) } : {}),
  })) : [];
}

function normalizeCondition(value) {
  if (!isObject(value)) return null;
  if (value.op === 'selected') {
    return {
      op: 'selected',
      partId: String(value.partId || value.partKey || ''),
      ...(value.itemId || value.itemKey ? { itemId: String(value.itemId || value.itemKey) } : {}),
      ...(value.variantId ? { variantId: String(value.variantId) } : {}),
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
 * Creates an empty editor document. It is structurally valid in `draft` mode;
 * publication validation intentionally fails until playable Parts and assets exist.
 */
export function createMakerV4Document({
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

export class MakerV4ValidationError extends Error {
  constructor(issues) {
    super(`Maker v4 validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}: ${issues[0]?.message || 'Invalid document.'}`);
    this.name = 'MakerV4ValidationError';
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
  return `${target?.partId || ''}\u0000${target?.itemId || ''}\u0000${target?.variantId || ''}`;
}

/**
 * Returns every validation issue without throwing. `publish` is the strict
 * release gate; `draft` still validates types/references but permits incomplete
 * work and local assets without immutable identifiers.
 */
export function collectMakerV4ValidationIssues(document, { mode = 'publish' } = {}) {
  if (!['draft', 'publish'].includes(mode)) throw new TypeError('Maker v4 validation mode must be "draft" or "publish".');
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
  if (metadata.coverAssetId !== null && metadata.coverAssetId !== undefined && !assetById.has(metadata.coverAssetId)) {
    issue('metadata.coverAssetId', 'references a missing Asset', 'missing_reference');
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
    if (!COLOR_CHANNEL_MODES.includes(channel.mode)) issue(`${path}.mode`, 'must be asset-map or gradient-map', 'invalid_color_channel');
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
      if (channel.mode === 'gradient-map') {
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
      } else if (stops.length) {
        issue(`${swatchPath}.stops`, 'must be empty for an asset-map channel', 'invalid_color_channel');
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
  const variantByPartItem = new Map();
  let totalItems = 0;
  let totalVariants = 0;
  let totalBindings = 0;

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
    if ((publish && !items.length) || items.length > LIMITS.maxItemsPerPart) {
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
      if (validateSafeId(item.id, `${itemPath}.id`, issue)) {
        if (itemsById.has(item.id)) issue(`${itemPath}.id`, 'duplicates another Item ID in this Part', 'duplicate');
        else itemsById.set(item.id, item);
      }
      validateName(item.name, `${itemPath}.name`, issue);
      if (!Array.isArray(item.requires) || !Array.isArray(item.excludes)) issue(itemPath, 'must contain requires and excludes arrays', 'invalid_rules');
      if (item.thumbnailAssetId !== null && item.thumbnailAssetId !== undefined && !assetById.has(item.thumbnailAssetId)) {
        issue(`${itemPath}.thumbnailAssetId`, 'references a missing Asset', 'missing_reference');
      }
      const variants = Array.isArray(item.variants) ? item.variants : [];
      if (!Array.isArray(item.variants)) issue(`${itemPath}.variants`, 'must be an array', 'invalid_collection');
      if ((publish && !variants.length) || variants.length > LIMITS.maxVariantsPerItem) {
        issue(`${itemPath}.variants`, `must contain ${publish ? '1 to ' : 'at most '}${LIMITS.maxVariantsPerItem} entries`, 'invalid_variants');
      }
      totalVariants += variants.length;
      const variantsById = new Map();
      variantByPartItem.set(`${part.id}\u0000${item.id}`, variantsById);
      variants.forEach((variant, variantIndex) => {
        const variantPath = `${itemPath}.variants[${variantIndex}]`;
        if (!isObject(variant)) {
          issue(variantPath, 'must be an object', 'invalid_variant');
          return;
        }
        if (validateSafeId(variant.id, `${variantPath}.id`, issue)) {
          if (variantsById.has(variant.id)) issue(`${variantPath}.id`, 'duplicates another Variant ID in this Item', 'duplicate');
          else variantsById.set(variant.id, variant);
        }
        validateName(variant.name, `${variantPath}.name`, issue);
        if (!Array.isArray(variant.requires) || !Array.isArray(variant.excludes)) issue(variantPath, 'must contain requires and excludes arrays', 'invalid_rules');
        const bindings = Array.isArray(variant.layerBindings) ? variant.layerBindings : [];
        if (!Array.isArray(variant.layerBindings)) issue(`${variantPath}.layerBindings`, 'must be an array', 'invalid_collection');
        if (publish && !bindings.length) issue(`${variantPath}.layerBindings`, 'must contain at least one LayerBinding', 'invalid_bindings');
        totalBindings += bindings.length;
        const bindingIds = new Set();
        bindings.forEach((binding, bindingIndex) => {
          const bindingPath = `${variantPath}.layerBindings[${bindingIndex}]`;
          if (!isObject(binding)) {
            issue(bindingPath, 'must be an object', 'invalid_binding');
            return;
          }
          if (validateSafeId(binding.id, `${bindingPath}.id`, issue)) {
            if (bindingIds.has(binding.id)) issue(`${bindingPath}.id`, 'duplicates another LayerBinding ID in this Variant', 'duplicate');
            bindingIds.add(binding.id);
          }
          if (!trackById.has(binding.layerTrackId)) issue(`${bindingPath}.layerTrackId`, 'references a missing LayerTrack', 'missing_reference');
          if (!assetById.has(binding.assetId)) issue(`${bindingPath}.assetId`, 'references a missing Asset', 'missing_reference');
          const transform = binding.transform;
          if (!isObject(transform) || !Number.isFinite(transform.x) || !Number.isFinite(transform.y)
            || !Number.isFinite(transform.scale) || transform.scale <= 0 || transform.scale > 100
            || !Number.isFinite(transform.rotation)) {
            issue(`${bindingPath}.transform`, 'must contain finite x, y, rotation and a scale greater than 0 and at most 100', 'invalid_transform');
          }
          if (typeof binding.opacity !== 'number' || binding.opacity < 0 || binding.opacity > 1) {
            issue(`${bindingPath}.opacity`, 'must be a number from 0 to 1', 'invalid_opacity');
          }
          if (!BLEND_MODES.includes(binding.blendMode)) issue(`${bindingPath}.blendMode`, 'uses an unsupported blend mode', 'invalid_blend_mode');
          const mappedAssets = Array.isArray(binding.assetsBySwatch) ? binding.assetsBySwatch : [];
          if (!Array.isArray(binding.assetsBySwatch)) issue(`${bindingPath}.assetsBySwatch`, 'must be an array', 'invalid_collection');
          if (binding.colorChannelId === null || binding.colorChannelId === undefined) {
            if (mappedAssets.length) issue(`${bindingPath}.assetsBySwatch`, 'must be empty without a ColorChannel', 'invalid_color_mapping');
          } else {
            const channel = channelById.get(binding.colorChannelId);
            if (!channel) {
              issue(`${bindingPath}.colorChannelId`, 'references a missing ColorChannel', 'missing_reference');
            } else if (channel.mode === 'asset-map') {
              if (publish) {
                const mappedSwatches = mappedAssets.map((mapping) => mapping?.swatchId);
                const expectedSwatches = channel.swatches.map((swatch) => swatch.id);
                if (mappedSwatches.length !== expectedSwatches.length
                  || new Set(mappedSwatches).size !== mappedSwatches.length
                  || expectedSwatches.some((swatchId) => !mappedSwatches.includes(swatchId))) {
                  issue(`${bindingPath}.assetsBySwatch`, 'must map every swatch exactly once for an asset-map channel', 'invalid_color_mapping');
                }
              }
            } else if (mappedAssets.length) {
              issue(`${bindingPath}.assetsBySwatch`, 'must be empty for a gradient-map channel', 'invalid_color_mapping');
            }
          }
          mappedAssets.forEach((mapping, mappingIndex) => {
            if (!isObject(mapping) || !assetById.has(mapping.assetId)) {
              issue(`${bindingPath}.assetsBySwatch[${mappingIndex}].assetId`, 'references a missing Asset', 'missing_reference');
            }
            const channel = channelById.get(binding.colorChannelId);
            if (channel && !channel.swatches.some((swatch) => swatch.id === mapping?.swatchId)) {
              issue(`${bindingPath}.assetsBySwatch[${mappingIndex}].swatchId`, 'references a missing swatch', 'missing_reference');
            }
          });
        });
      });
      validateContiguousOrder(variants, `${itemPath}.variants`, 'displayOrder', issue);
      if (item.defaultVariantId !== null && !variantsById.has(item.defaultVariantId)) {
        issue(`${itemPath}.defaultVariantId`, 'references a missing Variant', 'missing_reference');
      }
      if (publish && !item.defaultVariantId) issue(`${itemPath}.defaultVariantId`, 'is required for publication', 'missing_reference');
    });
    validateContiguousOrder(items, `${path}.items`, 'displayOrder', issue);
    if (part.defaultItemId !== null && !itemsById.has(part.defaultItemId)) {
      issue(`${path}.defaultItemId`, 'references a missing Item', 'missing_reference');
    }
    if (publish && part.required && !part.defaultItemId) issue(`${path}.defaultItemId`, 'is required for this Part', 'missing_reference');
    if (part.iconAssetId !== null && part.iconAssetId !== undefined && !assetById.has(part.iconAssetId)) {
      issue(`${path}.iconAssetId`, 'references a missing Asset', 'missing_reference');
    }
  });
  validateContiguousOrder(parts, 'parts', 'menuOrder', issue);
  if (totalItems > LIMITS.maxItems) issue('parts', `contains more than ${LIMITS.maxItems} Items`, 'limit');
  if (totalVariants > LIMITS.maxVariants) issue('parts', `contains more than ${LIMITS.maxVariants} Variants`, 'limit');
  if (totalBindings > LIMITS.maxBindings) issue('parts', `contains more than ${LIMITS.maxBindings} LayerBindings`, 'limit');
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

  function validateTarget(target, path) {
    if (!isObject(target)) {
      issue(path, 'must be a selection target object', 'invalid_rule_target');
      return;
    }
    const part = partById.get(target.partId);
    if (!part) {
      issue(`${path}.partId`, 'references a missing Part', 'missing_reference');
      return;
    }
    if (target.itemId !== undefined) {
      const item = itemByPart.get(target.partId)?.get(target.itemId);
      if (!item) {
        issue(`${path}.itemId`, 'references a missing Item in the target Part', 'missing_reference');
        return;
      }
      if (target.variantId !== undefined && !variantByPartItem.get(`${target.partId}\u0000${target.itemId}`)?.has(target.variantId)) {
        issue(`${path}.variantId`, 'references a missing Variant in the target Item', 'missing_reference');
      }
    } else if (target.variantId !== undefined) {
      issue(`${path}.variantId`, 'cannot be used without itemId', 'invalid_rule_target');
    }
  }

  function validateRuleLists(owner, path) {
    ['requires', 'excludes'].forEach((field) => {
      const targets = Array.isArray(owner?.[field]) ? owner[field] : [];
      if (targets.length > LIMITS.maxRuleTargets) issue(`${path}.${field}`, `cannot contain more than ${LIMITS.maxRuleTargets} targets`, 'limit');
      const keys = new Set();
      targets.forEach((target, index) => {
        validateTarget(target, `${path}.${field}[${index}]`);
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

  function validateCondition(condition, path, depth = 0) {
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
      validateTarget(condition, path);
      return;
    }
    if (condition.op === 'not') {
      if (!condition.condition) issue(`${path}.condition`, 'is required for a not condition', 'invalid_condition');
      validateCondition(condition.condition, `${path}.condition`, depth + 1);
      return;
    }
    if (condition.op === 'all' || condition.op === 'any') {
      if (!Array.isArray(condition.conditions) || !condition.conditions.length) {
        issue(`${path}.conditions`, 'must be a non-empty array', 'invalid_condition');
        return;
      }
      condition.conditions.forEach((child, index) => validateCondition(child, `${path}.conditions[${index}]`, depth + 1));
      return;
    }
    issue(`${path}.op`, 'must be selected, not, all, or any', 'invalid_condition');
  }

  parts.forEach((part, partIndex) => {
    if (!isObject(part)) return;
    const partPath = `parts[${partIndex}]`;
    validateRuleLists(part, partPath);
    validateCondition(part.visibleWhen, `${partPath}.visibleWhen`);
    (part.items || []).forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      validateRuleLists(item, itemPath);
      validateCondition(item.visibleWhen, `${itemPath}.visibleWhen`);
      (item.variants || []).forEach((variant, variantIndex) => {
        const variantPath = `${itemPath}.variants[${variantIndex}]`;
        validateRuleLists(variant, variantPath);
        validateCondition(variant.visibleWhen, `${variantPath}.visibleWhen`);
        (variant.layerBindings || []).forEach((binding, bindingIndex) => {
          validateCondition(binding.visibleWhen, `${variantPath}.layerBindings[${bindingIndex}].visibleWhen`);
        });
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
    validateTarget(selection, path);
    const part = partById.get(selection.partId);
    const item = itemByPart.get(selection.partId)?.get(selection.itemId);
    if (part?.defaultItemId && selection.itemId !== part.defaultItemId) issue(`${path}.itemId`, 'must match the Part defaultItemId', 'invalid_default');
    if (item?.defaultVariantId && selection.variantId !== item.defaultVariantId) issue(`${path}.variantId`, 'must match the Item defaultVariantId', 'invalid_default');
  });
  parts.forEach((part, partIndex) => {
    if ((part?.required || part?.defaultItemId) && !selectionParts.has(part.id)) {
      issue('defaultRecipe.selections', `is missing the default selection for parts[${partIndex}]`, 'missing_default');
    }
  });
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
  channels.forEach((channel, channelIndex) => {
    if (channel?.defaultSwatchId && !selectedChannels.has(channel.id)) {
      issue('defaultRecipe.colors', `is missing the default swatch for colorChannels[${channelIndex}]`, 'missing_default');
    }
  });

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
  if (!isObject(document.extensions)) issue('extensions', 'must be an object', 'invalid_extensions');

  return issues;
}

export function validateMakerV4Document(document, options) {
  const issues = collectMakerV4ValidationIssues(document, options);
  if (issues.length) throw new MakerV4ValidationError(issues);
  return document;
}

class AssetRegistry {
  constructor(sourceAssets = []) {
    this.assets = [];
    this.usedIds = new Set();
    this.byIdentifier = new Map();
    sourceAssets.forEach((asset, index) => this.register(asset, `asset-${index + 1}`, asset?.kind || 'other'));
  }

  register(source, hint, kind = 'layer') {
    const raw = typeof source === 'string' ? { identifier: source } : isObject(source) ? source : {};
    const identifier = String(raw.identifier || '').trim() || null;
    if (identifier && this.byIdentifier.has(identifier)) return this.byIdentifier.get(identifier);
    const id = uniqueId(raw.id || hint || identifier || `asset-${this.assets.length + 1}`, this.usedIds);
    const asset = {
      id,
      identifier,
      kind: String(kind || raw.kind || 'other'),
      mediaType: String(raw.mediaType || raw.type || 'image/png'),
      width: Number.isInteger(Number(raw.width)) && Number(raw.width) > 0 ? Number(raw.width) : null,
      height: Number.isInteger(Number(raw.height)) && Number(raw.height) > 0 ? Number(raw.height) : null,
      source: identifier ? 'published' : raw.url ? 'remote-draft' : 'local-draft',
      legacy: Object.fromEntries([
        ['name', raw.name],
        ['size', raw.size],
        ['blobId', raw.blobId],
        ['patchId', raw.patchId],
        ['url', raw.url],
        ['slot', raw.slot],
        ['partId', raw.partId],
        ['itemId', raw.itemId],
        ['layerId', raw.layerId],
        ['colorId', raw.colorId],
      ].filter(([, value]) => value !== undefined && value !== '')),
    };
    this.assets.push(asset);
    if (identifier) this.byIdentifier.set(identifier, id);
    return id;
  }
}

function v3SourceAdapter(source) {
  if (source?.manifest?.schemaVersion === 'animacraft.creator-template.v3') {
    const manifest = v3SourceAdapter(source.manifest);
    return {
      ...manifest,
      kind: 'saved-draft',
      visual: isObject(source.visual) ? source.visual : manifest.visual,
      rules: Array.isArray(source.rules) ? source.rules : manifest.rules,
      paletteLinks: Array.isArray(source.paletteLinks) ? source.paletteLinks : manifest.paletteLinks,
      original: source,
    };
  }
  if (source?.schemaVersion === 'animacraft.creator-template.v3') {
    return {
      kind: 'manifest',
      schemaVersion: source.schemaVersion,
      template: isObject(source.template) ? source.template : {},
      runtime: isObject(source.runtime) ? source.runtime : {},
      livingContent: source.livingContent ?? null,
      parts: Array.isArray(source.parts) ? source.parts.map((part) => ({
        ...part,
        id: part.key,
        name: part.label,
        required: part.allowRemove === false || part.kind === 'last-bastion',
        menuVisible: part.menuVisible !== false,
        layers: Array.isArray(part.layers) ? part.layers : [],
        colors: Array.isArray(part.colors) ? part.colors : [],
        items: Array.isArray(part.items) ? part.items : [],
        icon: part.iconIdentifier || null,
      })) : [],
      partOrder: Array.isArray(source.parts) ? source.parts.map((part) => String(part.key || '')) : [],
      layerOrder: Array.isArray(source.parts) ? source.parts.flatMap((part) => (part.layers || []).map((layer) => ({
        key: `${part.key}:${layer.id}`,
        order: integer(layer.renderOrder, 0),
      }))).sort((left, right) => left.order - right.order).map((entry) => entry.key) : [],
      visual: null,
      rules: Array.isArray(source.rules) ? source.rules : [],
      paletteLinks: Array.isArray(source.paletteLinks) ? source.paletteLinks : [],
      expansionPacks: Array.isArray(source.expansionPacks) ? source.expansionPacks : [],
      assets: Array.isArray(source.assets) ? source.assets : [],
      original: source,
    };
  }
  if (isObject(source) && Array.isArray(source.slots) && isObject(source.parts)) {
    const slots = source.slots.map((slot) => ({
      ...slot,
      id: slot.key,
      name: slot.label,
      required: slot.allowRemove === false || slot.kind === 'last-bastion',
      menuVisible: slot.menuVisible !== false,
      layers: Array.isArray(slot.layers) ? slot.layers : [],
      colors: Array.isArray(slot.colors) ? slot.colors : [],
      items: Array.isArray(source.parts[slot.key]) ? source.parts[slot.key] : [],
      icon: slot.iconAsset || null,
    }));
    return {
      kind: 'current-model',
      schemaVersion: 'animacraft.current-maker-model.v3',
      template: isObject(source.template) ? source.template : isObject(source.metadata) ? source.metadata : {},
      runtime: isObject(source.runtime) ? source.runtime : {},
      livingContent: source.livingContent ?? null,
      parts: slots,
      partOrder: Array.isArray(source.slotOrder) ? source.slotOrder : slots.map((slot) => slot.key),
      layerOrder: Array.isArray(source.layerOrder) ? source.layerOrder : [],
      visual: isObject(source.visual) ? source.visual : null,
      rules: Array.isArray(source.rules) ? source.rules : [],
      paletteLinks: Array.isArray(source.paletteLinks) ? source.paletteLinks : [],
      expansionPacks: Array.isArray(source.expansionPacks) ? source.expansionPacks : [],
      assets: Array.isArray(source.assets) ? source.assets : [],
      original: source,
    };
  }
  throw new TypeError('Expected an animacraft.creator-template.v3 manifest or the current v3 Maker model.');
}

function unionFind(ids, links) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    if (!parent.has(id)) return null;
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  };
  links.forEach((link) => {
    const left = String(link.primaryPartKey || link.primaryPartId || '');
    const right = String(link.linkedPartKey || link.linkedPartId || '');
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot && rightRoot && leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  });
  const groups = new Map();
  ids.forEach((id) => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  });
  return { find, groups };
}

function imageFor(item, layerId, colorId) {
  if (Array.isArray(item.images)) {
    return item.images.find((image) => String(image?.layerId || '') === layerId && String(image?.colorId || '') === colorId) || null;
  }
  if (isObject(item.images)) return item.images[`${layerId}:${colorId}`] || null;
  return null;
}

function normalizeExpansionPack(pack, version, index) {
  return {
    id: safeId(pack?.id || `expansion-${index + 1}`),
    name: String(pack?.name || pack?.label || `Expansion ${index + 1}`),
    version: Math.max(1, integer(pack?.version, 1)),
    manifestIdentifier: String(pack?.manifestIdentifier || pack?.manifestBlobId || ''),
    baseMakerId: String(pack?.baseMakerId || version.rootMakerId),
    baseMakerVersion: Math.max(1, integer(pack?.baseMakerVersion, version.number)),
    required: Boolean(pack?.required),
  };
}

/**
 * Migrates either a published creator-template.v3 manifest or the current
 * in-memory `{ slots, parts, ... }` model. The input is never mutated. Unknown
 * v3 data remains available under `extensions.legacyV3` for audit/recovery.
 */
export function migrateMakerV3ToV4(source, options = {}) {
  if (source?.schemaVersion === SCHEMA_VERSION) {
    const copied = clone(source);
    if (options.validate) validateMakerV4Document(copied, { mode: options.validate === true ? 'publish' : options.validate });
    return copied;
  }
  const snapshot = clone(source);
  const adapter = v3SourceAdapter(snapshot);
  const template = adapter.template;
  const metadataInput = { ...template, ...(options.metadata || {}) };
  const makerId = safeId(options.makerId || metadataInput.id || metadataInput.name || 'migrated-maker', 'migrated-maker');
  const document = createMakerV4Document({
    makerId,
    name: metadataInput.name || 'Migrated Maker',
    creator: metadataInput.creator || '',
    width: adapter.original.canvas?.width || template.canvas?.width || 1024,
    height: adapter.original.canvas?.height || template.canvas?.height || 1024,
    pixelMode: options.pixelMode || adapter.original.canvas?.pixelMode || template.canvas?.pixelMode || 'smooth',
    version: { rootMakerId: options.rootMakerId || makerId, ...options },
  });
  document.metadata.summary = String(metadataInput.summary || '');
  document.metadata.style = String(metadataInput.style || '');
  document.metadata.license = {
    kind: LICENSE_KINDS.includes(metadataInput.license) ? metadataInput.license : 'personal-use',
    note: String(metadataInput.licenseNote || ''),
  };
  document.publication = {
    royaltyBps: integer(metadataInput.royaltyBps, 0),
    mintingEnabled: metadataInput.mintingEnabled !== false,
    mintFeeEnabled: Boolean(metadataInput.mintFeeEnabled),
    mintPriceAtomic: Math.max(0, integer(metadataInput.mintPriceAtomic, 0)),
    paymentCoinType: String(metadataInput.paymentCoinType || ''),
    paymentCoinSymbol: String(metadataInput.paymentCoinSymbol || ''),
    storage: String(metadataInput.storage || 'walrus'),
    chain: String(metadataInput.chain || 'sui'),
  };
  document.runtime = clone(adapter.runtime);
  document.livingContent = clone(adapter.livingContent);

  const registry = new AssetRegistry(adapter.assets);
  const usedPartIds = new Set();
  const orderedParts = adapter.parts.slice().sort((left, right) => {
    const leftIndex = adapter.partOrder.indexOf(left.id);
    const rightIndex = adapter.partOrder.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  orderedParts.forEach((part) => { part.v4Id = uniqueId(part.id || part.name, usedPartIds); });
  const oldToNewPartId = new Map(orderedParts.map((part) => [String(part.id || ''), part.v4Id]));

  const linked = unionFind(orderedParts.map((part) => String(part.id || '')), adapter.paletteLinks);
  const partByOldId = new Map(orderedParts.map((part) => [String(part.id || ''), part]));
  const colorChannelForPart = new Map();
  const swatchForPartColor = new Map();
  const usedChannelIds = new Set();
  let channelOrder = 0;
  linked.groups.forEach((memberIds) => {
    const canonicalPart = partByOldId.get(memberIds[0]);
    const canonicalColors = canonicalPart?.colors?.length ? canonicalPart.colors : [{ id: 'default', name: 'Default', value: '#7b5cff' }];
    const channelId = uniqueId(`color-${canonicalPart?.v4Id || memberIds[0]}`, usedChannelIds);
    const swatchIds = new Set();
    const swatches = canonicalColors.map((color, index) => ({
      id: uniqueId(color.id || `color-${index + 1}`, swatchIds),
      name: String(color.name || color.id || `Color ${index + 1}`),
      hintColor: normalizeHex(color.value),
      stops: [],
    }));
    memberIds.forEach((memberId) => {
      colorChannelForPart.set(memberId, channelId);
      const colors = partByOldId.get(memberId)?.colors?.length
        ? partByOldId.get(memberId).colors
        : [{ id: 'default', name: 'Default', value: '#7b5cff' }];
      colors.forEach((color, index) => {
        const swatch = swatches.find((candidate) => candidate.hintColor === normalizeHex(color.value)) || swatches[index] || swatches[0];
        swatchForPartColor.set(`${memberId}\u0000${color.id}`, swatch.id);
      });
    });
    const paletteValue = memberIds.map((memberId) => adapter.visual?.palette?.[partByOldId.get(memberId)?.colorKey || memberId]).find(Boolean);
    const defaultSwatch = swatches.find((swatch) => swatch.hintColor === String(paletteValue || '').toLowerCase()) || swatches[0];
    document.colorChannels.push({
      id: channelId,
      name: memberIds.length > 1
        ? memberIds.map((memberId) => partByOldId.get(memberId)?.name || memberId).join(' + ')
        : `${canonicalPart?.name || memberIds[0]} Color`,
      order: channelOrder,
      mode: 'asset-map',
      defaultSwatchId: defaultSwatch?.id || null,
      swatches,
    });
    channelOrder += 1;
  });

  const allLayers = orderedParts.flatMap((part) => (part.layers || []).map((layer, layerIndex) => ({
    part,
    layer,
    oldKey: `${part.id}:${layer.id}`,
    fallbackOrder: integer(layer.renderOrder, layerIndex),
  })));
  allLayers.sort((left, right) => {
    const leftIndex = adapter.layerOrder.indexOf(left.oldKey);
    const rightIndex = adapter.layerOrder.indexOf(right.oldKey);
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    return left.fallbackOrder - right.fallbackOrder;
  });
  const usedTrackIds = new Set();
  const trackForLayer = new Map();
  allLayers.forEach(({ part, layer, oldKey }, index) => {
    const id = uniqueId(`track-${part.v4Id}-${layer.id || index + 1}`, usedTrackIds);
    trackForLayer.set(oldKey, id);
    document.layerTracks.push({
      id,
      name: String(layer.name || `${part.name} Layer`),
      order: index,
    });
  });

  const remapTarget = (target) => ({
    partId: oldToNewPartId.get(String(target.partId || target.partKey || '')) || String(target.partId || target.partKey || ''),
    ...(target.itemId || target.itemKey ? { itemId: String(target.itemId || target.itemKey) } : {}),
    ...(target.variantId ? { variantId: String(target.variantId) } : {}),
  });
  const remapCondition = (condition) => {
    const normalized = normalizeCondition(condition);
    if (!normalized) return null;
    if (normalized.op === 'selected') return { op: 'selected', ...remapTarget(normalized) };
    if (normalized.op === 'not') return { op: 'not', condition: remapCondition(normalized.condition) };
    if (normalized.op === 'all' || normalized.op === 'any') return { op: normalized.op, conditions: normalized.conditions.map(remapCondition) };
    return normalized;
  };

  orderedParts.forEach((sourcePart, partIndex) => {
    const colors = sourcePart.colors?.length ? sourcePart.colors : [{ id: 'default', name: 'Default', value: '#7b5cff' }];
    const items = (sourcePart.items || []).slice().sort((left, right) => integer(left.displayOrder, 1) - integer(right.displayOrder, 1));
    const part = {
      id: sourcePart.v4Id,
      name: String(sourcePart.name || sourcePart.id || `Part ${partIndex + 1}`),
      menuOrder: partIndex,
      menuVisible: sourcePart.menuVisible !== false,
      required: Boolean(sourcePart.required),
      defaultItemId: sourcePart.defaultItemId ? String(sourcePart.defaultItemId) : items[0]?.id ? String(items[0].id) : null,
      parentPartId: sourcePart.parentPartId ? oldToNewPartId.get(String(sourcePart.parentPartId)) || String(sourcePart.parentPartId) : null,
      iconAssetId: sourcePart.icon ? registry.register(sourcePart.icon, `${sourcePart.v4Id}-part-icon`, 'part-icon') : null,
      visibleWhen: remapCondition(sourcePart.visibleWhen),
      requires: cloneTargets(sourcePart.requires).map(remapTarget),
      excludes: cloneTargets(sourcePart.excludes).map(remapTarget),
      items: [],
    };
    const usedItemIds = new Set();
    items.forEach((sourceItem, itemIndex) => {
      const itemId = uniqueId(sourceItem.id || sourceItem.label || `item-${itemIndex + 1}`, usedItemIds);
      if (part.defaultItemId === sourceItem.id) part.defaultItemId = itemId;
      const bindings = [];
      (sourcePart.layers || []).forEach((layer, layerIndex) => {
        const mappedAssets = [];
        colors.forEach((color, colorIndex) => {
          const image = imageFor(sourceItem, String(layer.id || ''), String(color.id || ''));
          if (!image) return;
          const rawAsset = typeof image === 'string' ? image : image.identifier ? image : image;
          const assetId = registry.register(rawAsset, `${sourcePart.v4Id}-${itemId}-${layer.id}-${color.id}`, 'layer');
          mappedAssets.push({
            swatchId: swatchForPartColor.get(`${sourcePart.id}\u0000${color.id}`) || document.colorChannels.find((channel) => channel.id === colorChannelForPart.get(String(sourcePart.id)))?.swatches[colorIndex]?.id,
            assetId,
          });
        });
        if (!mappedAssets.length) return;
        const channelId = colorChannelForPart.get(String(sourcePart.id));
        const channel = document.colorChannels.find((candidate) => candidate.id === channelId);
        const defaultAsset = mappedAssets.find((mapping) => mapping.swatchId === channel?.defaultSwatchId) || mappedAssets[0];
        bindings.push({
          id: safeId(`binding-${sourcePart.v4Id}-${itemId}-${layer.id || layerIndex + 1}`),
          layerTrackId: trackForLayer.get(`${sourcePart.id}:${layer.id}`),
          assetId: defaultAsset.assetId,
          colorChannelId: channelId || null,
          assetsBySwatch: mappedAssets,
          transform: {
            x: finiteNumber(layer.x, 0),
            y: finiteNumber(layer.y, 0),
            scale: Math.max(0.01, finiteNumber(layer.scale, 1)),
            rotation: finiteNumber(layer.rotation, 0),
          },
          opacity: normalizedOpacity(layer.opacity),
          blendMode: normalizedBlendMode(layer.blendMode),
          visibleWhen: remapCondition(layer.visibleWhen),
        });
      });
      const thumbnailSource = sourceItem.iconIdentifier || sourceItem.iconAsset || null;
      part.items.push({
        id: itemId,
        name: String(sourceItem.label || sourceItem.name || sourceItem.id || `Item ${itemIndex + 1}`),
        displayOrder: itemIndex,
        thumbnailAssetId: thumbnailSource ? registry.register(thumbnailSource, `${sourcePart.v4Id}-${itemId}-thumbnail`, 'thumbnail') : null,
        visibleWhen: remapCondition(sourceItem.visibleWhen),
        requires: cloneTargets(sourceItem.requires).map(remapTarget),
        excludes: cloneTargets(sourceItem.excludes).map(remapTarget),
        defaultVariantId: 'default',
        variants: [{
          id: 'default',
          name: 'Default',
          displayOrder: 0,
          visibleWhen: null,
          requires: [],
          excludes: [],
          layerBindings: bindings,
        }],
      });
    });
    if (part.defaultItemId && !part.items.some((item) => item.id === part.defaultItemId)) part.defaultItemId = part.items[0]?.id || null;
    document.parts.push(part);
  });

  adapter.rules.forEach((rule) => {
    const left = remapTarget({ partId: rule.leftPartKey, itemId: rule.leftItemKey || undefined });
    const right = remapTarget({ partId: rule.rightPartKey, itemId: rule.rightItemKey || undefined });
    const addExclude = (ownerTarget, excludedTarget) => {
      const ownerPart = document.parts.find((part) => part.id === ownerTarget.partId);
      const owner = ownerTarget.itemId ? ownerPart?.items.find((item) => item.id === ownerTarget.itemId) : ownerPart;
      if (owner && !owner.excludes.some((target) => selectionTargetKey(target) === selectionTargetKey(excludedTarget))) owner.excludes.push(excludedTarget);
    };
    addExclude(left, right);
    addExclude(right, left);
  });

  document.defaultRecipe.selections = document.parts.flatMap((part) => {
    const visualItemId = adapter.visual?.[part.id];
    const item = part.items.find((candidate) => candidate.id === visualItemId)
      || part.items.find((candidate) => candidate.id === part.defaultItemId)
      || null;
    if (!item) return [];
    part.defaultItemId = item.id;
    return [{ partId: part.id, itemId: item.id, variantId: item.defaultVariantId }];
  });
  document.defaultRecipe.colors = document.colorChannels.filter((channel) => channel.defaultSwatchId).map((channel) => ({
    channelId: channel.id,
    swatchId: channel.defaultSwatchId,
  }));
  document.expansionPacks = adapter.expansionPacks.map((pack, index) => normalizeExpansionPack(pack, document.version, index));

  const coverSource = template.coverIdentifier || adapter.original.coverAsset || null;
  document.metadata.coverAssetId = coverSource ? registry.register(coverSource, 'maker-cover', 'cover') : null;
  document.assets = registry.assets;
  document.extensions = {
    legacyV3: {
      sourceKind: adapter.kind,
      sourceSchemaVersion: adapter.schemaVersion,
      rules: clone(adapter.rules),
      paletteLinks: clone(adapter.paletteLinks),
      partKinds: Object.fromEntries(orderedParts.map((part) => [part.v4Id, String(part.kind || 'standard')])),
      unmappedTopLevel: Object.fromEntries(Object.entries(adapter.original).filter(([key]) => ![
        'schemaVersion', 'manifest', 'template', 'runtime', 'parts', 'slots', 'slotOrder', 'layerOrder', 'visual', 'rules', 'paletteLinks', 'livingContent', 'assets', 'canvas', 'expansionPacks',
      ].includes(key)).map(([key, value]) => [key, clone(value)])),
    },
  };

  if (options.validate) validateMakerV4Document(document, { mode: options.validate === true ? 'publish' : options.validate });
  return document;
}

export function isMakerV4Document(value) {
  return isObject(value) && value.schemaVersion === SCHEMA_VERSION;
}

export {
  BLEND_MODES as MAKER_V4_BLEND_MODES,
  COLOR_CHANNEL_MODES as MAKER_V4_COLOR_CHANNEL_MODES,
  LIMITS as MAKER_V4_LIMITS,
  PIXEL_MODES as MAKER_V4_PIXEL_MODES,
  SCHEMA_VERSION as MAKER_V4_SCHEMA_VERSION,
  VERSION_COMPATIBILITY as MAKER_V4_VERSION_COMPATIBILITY,
};
