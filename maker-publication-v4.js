/**
 * Pure bridge between the full Animacraft Maker v4 document and the existing
 * Walrus + Sui publication interfaces.
 *
 * Walrus remains authoritative for the full versioned Maker/recipe. The Sui
 * OCMaker stores a deliberately smaller compatibility projection. Every loss
 * in that projection is reported instead of being silently treated as a full
 * representation of Maker v4.
 */

import { compareMakerCompatibility } from './expansion-packs.js';
import { collectMakerRules, evaluateRecipe } from './maker-rules.js';
import { MAKER_V4_SCHEMA_VERSION, validateMakerV4Document } from './maker-v4.js';

export const MAKER_V4_MANIFEST_IDENTIFIER = 'animacraft-manifest.json';
export const MAKER_V4_RELEASE_SCHEMA = 'animacraft.maker-release.v1';
export const MAKER_V4_MOVE_PROJECTION_SCHEMA = 'animacraft.move-summary.v1';
export const MAKER_V4_OC_PACKAGE_SCHEMA = 'animacraft.oc-package.v2';
export const MAKER_V4_ITEM_KEY_ENCODING = 'item-variant-key.v1';
export const MAKER_V4_NEUTRAL_COLOR = '#000000';

const MOVE_MAX_KEY_BYTES = 128;
const MOVE_MAX_ITEMS = 5_000;
const MOVE_MAX_RULES = 1_000;
const MOVE_PART_KINDS = new Set(['standard', 'left-right-pair', 'last-bastion']);

export class MakerV4PublicationError extends Error {
  constructor(message, code = 'maker-v4-publication-error', details = {}) {
    super(message);
    this.name = 'MakerV4PublicationError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compareText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOrder(left, right, field) {
  const a = Number(left?.[field]);
  const b = Number(right?.[field]);
  return (Number.isFinite(a) ? a : Number.MAX_SAFE_INTEGER)
    - (Number.isFinite(b) ? b : Number.MAX_SAFE_INTEGER)
    || compareText(left?.id, right?.id);
}

function orderedTracks(document) {
  return [...asArray(document?.layerTracks)].sort((left, right) => compareOrder(left, right, 'order'));
}

function orderedChannels(document) {
  return [...asArray(document?.colorChannels)].sort((left, right) => compareOrder(left, right, 'order'));
}

function orderedParts(document) {
  return [...asArray(document?.parts)].sort((left, right) => compareOrder(left, right, 'menuOrder'));
}

function orderedItems(part) {
  return [...asArray(part?.items)].sort((left, right) => compareOrder(left, right, 'displayOrder'));
}

function orderedVariants(item) {
  return [...asArray(item?.variants)].sort((left, right) => compareOrder(left, right, 'displayOrder'));
}

function orderedBindings(variant, trackOrder) {
  return [...asArray(variant?.layerBindings)].sort((left, right) => (
    (trackOrder.get(String(left?.layerTrackId || '')) ?? Number.MAX_SAFE_INTEGER)
      - (trackOrder.get(String(right?.layerTrackId || '')) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left?.layerTrackId, right?.layerTrackId)
    || compareText(left?.id, right?.id)
  ));
}

function jsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function truncateUtf8(value, maximum = MOVE_MAX_KEY_BYTES) {
  const input = String(value || '');
  if (byteLength(input) <= maximum) return input;
  let output = '';
  for (const character of input) {
    if (byteLength(output + character) > maximum) break;
    output += character;
  }
  return output;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

function compactMoveKey(candidate, identity, used) {
  const source = String(candidate || 'item');
  if (byteLength(source) <= MOVE_MAX_KEY_BYTES && !used.has(source)) {
    used.add(source);
    return source;
  }
  const suffix = `-${fnv1a(identity)}`;
  let result = `${truncateUtf8(source, MOVE_MAX_KEY_BYTES - byteLength(suffix))}${suffix}`;
  let collision = 2;
  while (used.has(result)) {
    const extra = `-${collision}`;
    result = `${truncateUtf8(source, MOVE_MAX_KEY_BYTES - byteLength(suffix) - byteLength(extra))}${suffix}${extra}`;
    collision += 1;
  }
  used.add(result);
  return result;
}

function tupleKey(partId, itemId, variantId) {
  return `${partId}\u0000${itemId}\u0000${variantId}`;
}

function buildItemProjection(document) {
  const byTuple = new Map();
  const records = [];
  orderedParts(document).forEach((part) => {
    const used = new Set();
    const descriptors = orderedItems(part).flatMap((item) => {
      const variants = orderedVariants(item);
      return variants.map((variant) => ({ part, item, variant, isDefault: variant.id === item.defaultVariantId }));
    });

    // Preserve every Item id for its default Variant before allocating compound
    // keys. This prevents an Item named `shirt--red` from being displaced by a
    // red Variant belonging to another Item.
    descriptors.filter((entry) => entry.isDefault || orderedVariants(entry.item).length === 1).forEach((entry) => {
      const identity = tupleKey(part.id, entry.item.id, entry.variant.id);
      const key = compactMoveKey(entry.item.id, identity, used);
      const record = { ...entry, key };
      byTuple.set(identity, record);
      records.push(record);
    });
    descriptors.filter((entry) => !byTuple.has(tupleKey(part.id, entry.item.id, entry.variant.id))).forEach((entry) => {
      const identity = tupleKey(part.id, entry.item.id, entry.variant.id);
      const key = compactMoveKey(`${entry.item.id}--${entry.variant.id}`, identity, used);
      const record = { ...entry, key };
      byTuple.set(identity, record);
      records.push(record);
    });
  });
  return { byTuple, records };
}

function assetById(document) {
  return new Map(asArray(document?.assets).map((asset) => [String(asset?.id || ''), asset]));
}

/** Return every asset referenced by the immutable Maker graph. */
export function collectReferencedMakerV4AssetIds(document) {
  const ids = new Set();
  if (document?.metadata?.coverAssetId) ids.add(String(document.metadata.coverAssetId));
  orderedParts(document).forEach((part) => {
    if (part.iconAssetId) ids.add(String(part.iconAssetId));
    orderedItems(part).forEach((item) => {
      if (item.thumbnailAssetId) ids.add(String(item.thumbnailAssetId));
      orderedVariants(item).forEach((variant) => asArray(variant.layerBindings).forEach((binding) => {
        if (binding.assetId) ids.add(String(binding.assetId));
        asArray(binding.assetsBySwatch).forEach((mapping) => {
          if (mapping?.assetId) ids.add(String(mapping.assetId));
        });
      }));
    });
  });
  asArray(document?.extensions?.expansionDrafts).forEach((pack) => {
    asArray(pack?.assets).forEach((asset) => {
      if (asset?.id) ids.add(String(asset.id));
    });
  });
  const assets = assetById(document);
  const missing = [...ids].filter((id) => !assets.has(id));
  if (missing.length) {
    throw new MakerV4PublicationError(
      `The Maker references missing Asset metadata: ${missing.join(', ')}.`,
      'missing-asset-metadata',
      { assetIds: missing },
    );
  }
  return [...ids].sort((left, right) => {
    const identifierOrder = compareText(assets.get(left)?.identifier, assets.get(right)?.identifier);
    return identifierOrder || compareText(left, right);
  });
}

function sanitizeVersion(version = {}) {
  return {
    rootMakerId: String(version.rootMakerId || ''),
    versionId: String(version.versionId || ''),
    number: Number(version.number || 0),
    parentVersionId: version.parentVersionId === null ? null : String(version.parentVersionId || ''),
    compatibility: String(version.compatibility || ''),
    compatibleFrom: Number(version.compatibleFrom || 0),
    createdAt: version.createdAt ?? null,
    changelog: String(version.changelog || ''),
  };
}

function sanitizeAsset(asset) {
  return {
    id: String(asset.id || ''),
    identifier: String(asset.identifier || ''),
    kind: String(asset.kind || ''),
    mediaType: String(asset.mediaType || ''),
    width: asset.width ?? null,
    height: asset.height ?? null,
    ...(asset.contentHash ? { contentHash: String(asset.contentHash) } : {}),
    ...(asset.digest ? { digest: String(asset.digest) } : {}),
  };
}

function sanitizeBinding(binding) {
  return {
    id: String(binding.id || ''),
    layerTrackId: String(binding.layerTrackId || ''),
    assetId: String(binding.assetId || ''),
    colorChannelId: binding.colorChannelId ?? null,
    assetsBySwatch: asArray(binding.assetsBySwatch).map((mapping) => ({
      swatchId: String(mapping.swatchId || ''),
      assetId: String(mapping.assetId || ''),
    })),
    transform: {
      x: Number(binding.transform?.x || 0),
      y: Number(binding.transform?.y || 0),
      scale: Number(binding.transform?.scale ?? 1),
      rotation: Number(binding.transform?.rotation || 0),
    },
    opacity: Number(binding.opacity),
    blendMode: String(binding.blendMode || 'normal'),
    visibleWhen: clone(binding.visibleWhen ?? null),
  };
}

function sanitizeVariant(variant, trackOrder) {
  return {
    id: String(variant.id || ''),
    name: String(variant.name || ''),
    displayOrder: Number(variant.displayOrder),
    visibleWhen: clone(variant.visibleWhen ?? null),
    requires: clone(asArray(variant.requires)),
    excludes: clone(asArray(variant.excludes)),
    layerBindings: orderedBindings(variant, trackOrder).map(sanitizeBinding),
  };
}

function sanitizeItem(item, trackOrder) {
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    displayOrder: Number(item.displayOrder),
    thumbnailAssetId: item.thumbnailAssetId ?? null,
    visibleWhen: clone(item.visibleWhen ?? null),
    requires: clone(asArray(item.requires)),
    excludes: clone(asArray(item.excludes)),
    defaultVariantId: item.defaultVariantId ?? null,
    variants: orderedVariants(item).map((variant) => sanitizeVariant(variant, trackOrder)),
  };
}

function sanitizePart(part, trackOrder) {
  return {
    id: String(part.id || ''),
    name: String(part.name || ''),
    menuOrder: Number(part.menuOrder),
    menuVisible: part.menuVisible !== false,
    required: Boolean(part.required),
    defaultItemId: part.defaultItemId ?? null,
    parentPartId: part.parentPartId ?? null,
    iconAssetId: part.iconAssetId ?? null,
    visibleWhen: clone(part.visibleWhen ?? null),
    requires: clone(asArray(part.requires)),
    excludes: clone(asArray(part.excludes)),
    items: orderedItems(part).map((item) => sanitizeItem(item, trackOrder)),
  };
}

function sanitizeChannel(channel) {
  return {
    id: String(channel.id || ''),
    name: String(channel.name || ''),
    order: Number(channel.order),
    mode: String(channel.mode || ''),
    defaultSwatchId: channel.defaultSwatchId ?? null,
    swatches: asArray(channel.swatches).map((swatch) => ({
      id: String(swatch.id || ''),
      name: String(swatch.name || ''),
      hintColor: String(swatch.hintColor || '').toLowerCase(),
      stops: asArray(swatch.stops).map((stop) => ({ offset: Number(stop.offset), color: String(stop.color || '').toLowerCase() })),
    })),
  };
}

function sanitizeExpansionPack(pack) {
  return {
    id: String(pack.id || ''),
    name: String(pack.name || ''),
    version: Number(pack.version),
    manifestIdentifier: String(pack.manifestIdentifier || ''),
    baseMakerId: String(pack.baseMakerId || ''),
    baseMakerVersion: Number(pack.baseMakerVersion),
    required: Boolean(pack.required),
  };
}

/** Build immutable version/update metadata for display and OC provenance. */
export function buildMakerV4VersionMetadata(document, previousDocument = null) {
  const version = sanitizeVersion(document?.version);
  if (!version.rootMakerId || !version.versionId || !Number.isInteger(version.number) || version.number < 1) {
    throw new MakerV4PublicationError('The Maker has incomplete version metadata.', 'invalid-version-metadata');
  }
  if (previousDocument) {
    const previousRoot = String(previousDocument?.version?.rootMakerId || '');
    if (previousRoot !== version.rootMakerId) {
      throw new MakerV4PublicationError('The previous document belongs to another root Maker.', 'root-maker-mismatch', {
        previousRootMakerId: previousRoot,
        rootMakerId: version.rootMakerId,
      });
    }
  }
  const comparison = previousDocument ? compareMakerCompatibility(previousDocument, document) : null;
  return {
    schemaVersion: MAKER_V4_RELEASE_SCHEMA,
    rootMakerId: version.rootMakerId,
    versionId: version.versionId,
    versionNumber: version.number,
    parentVersionId: version.parentVersionId,
    declaredCompatibility: version.compatibility,
    compatibleFrom: version.compatibleFrom,
    changelog: version.changelog,
    createdAt: version.createdAt,
    update: comparison ? {
      level: comparison.level,
      recipeCompatible: comparison.recipeCompatible,
      renderCompatible: comparison.renderCompatible,
      requiresPinnedVersion: comparison.requiresPinnedVersion,
      recommendedVersionBump: comparison.recommendedVersionBump,
      previousVersion: comparison.previousVersion,
      nextVersion: comparison.nextVersion,
      breaking: clone(comparison.breaking),
      warnings: clone(comparison.warnings),
      additions: clone(comparison.additions),
      summary: comparison.summary,
    } : {
      level: 'initial',
      recipeCompatible: true,
      renderCompatible: true,
      requiresPinnedVersion: false,
      recommendedVersionBump: 'initial',
      previousVersion: '',
      nextVersion: version.versionId,
      breaking: [],
      warnings: [],
      additions: [],
      summary: 'Initial immutable Maker version.',
    },
  };
}

function projectionIndex(document) {
  const tracks = orderedTracks(document);
  const trackOrder = new Map(tracks.map((track) => [String(track.id), Number(track.order)]));
  const channels = orderedChannels(document);
  const channelById = new Map(channels.map((channel) => [String(channel.id), channel]));
  const items = buildItemProjection(document);
  const parts = orderedParts(document).map((part) => {
    const defaultItem = orderedItems(part).find((item) => item.id === part.defaultItemId) || orderedItems(part)[0];
    const variants = defaultItem ? orderedVariants(defaultItem) : [];
    const defaultVariant = variants.find((variant) => variant.id === defaultItem?.defaultVariantId) || variants[0];
    const orderedOwners = [
      ...(defaultVariant ? [defaultVariant] : []),
      ...orderedItems(part).flatMap((item) => orderedVariants(item)).filter((variant) => variant !== defaultVariant),
    ];
    const orderedPartBindings = orderedOwners.flatMap((variant) => orderedBindings(variant, trackOrder));
    const allColorChannelIds = [...new Set(orderedPartBindings
      .map((binding) => String(binding.colorChannelId || ''))
      .filter((channelId) => channelById.has(channelId)))];
    const primaryBinding = orderedPartBindings
      .find((binding) => binding.colorChannelId && channelById.has(String(binding.colorChannelId)));
    const primaryColorChannelId = primaryBinding ? String(primaryBinding.colorChannelId) : null;
    const channel = primaryColorChannelId ? channelById.get(primaryColorChannelId) : null;
    const colors = channel
      ? [...new Set(asArray(channel.swatches).map((swatch) => moveColor(swatch.hintColor)))]
      : [MAKER_V4_NEUTRAL_COLOR];
    const legacyKind = document?.extensions?.legacyV3?.partKinds?.[part.id];
    const requestedKind = String(part.kind || legacyKind || 'standard');
    return {
      source: part,
      id: String(part.id),
      renderOrder: Number(part.menuOrder),
      primaryColorChannelId,
      allColorChannelIds,
      colors: colors.length ? colors : [MAKER_V4_NEUTRAL_COLOR],
      kind: MOVE_PART_KINDS.has(requestedKind) ? requestedKind : 'standard',
    };
  });
  return { tracks, trackOrder, channels, channelById, items, parts, partById: new Map(parts.map((part) => [part.id, part])) };
}

function moveColor(value) {
  const color = String(value || '').toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(color)) return color.slice(0, 7);
  return /^#[0-9a-f]{6}$/.test(color) ? color : MAKER_V4_NEUTRAL_COLOR;
}

function releaseProjection(document) {
  const index = projectionIndex(document);
  if (index.items.records.length > MOVE_MAX_ITEMS) {
    throw new MakerV4PublicationError(
      `The Move summary contains more than ${MOVE_MAX_ITEMS} Item/Variant records.`,
      'move-item-limit',
      { count: index.items.records.length },
    );
  }
  const ruleProjection = flattenMoveRules(document, index);
  const unrepresentedColorChannels = index.parts.flatMap((part) => part.allColorChannelIds
    .filter((channelId) => channelId !== part.primaryColorChannelId)
    .map((channelId) => ({ partId: part.id, channelId })));
  return {
    schemaVersion: MAKER_V4_MOVE_PROJECTION_SCHEMA,
    itemKeyEncoding: MAKER_V4_ITEM_KEY_ENCODING,
    neutralColor: MAKER_V4_NEUTRAL_COLOR,
    authorizationCoverage: ruleProjection.unrepresentedRules.length ? 'partial' : 'complete',
    projectedRuleCount: ruleProjection.rules.length,
    unrepresentedRules: clone(ruleProjection.unrepresentedRules),
    colorCoverage: unrepresentedColorChannels.length ? 'primary-channel-only' : 'complete',
    unrepresentedColorChannels,
    parts: index.parts.map((part) => ({
      partId: part.id,
      renderOrder: part.renderOrder,
      primaryColorChannelId: part.primaryColorChannelId,
      colors: [...part.colors],
      items: index.items.records.filter((record) => record.part.id === part.id).map((record) => ({
        itemId: String(record.item.id),
        variantId: String(record.variant.id),
        summaryItemKey: record.key,
      })),
    })),
  };
}

/**
 * Produce the JSON document stored on Walrus. Runtime endpoints, Blob/File
 * handles, object URLs, editor selection, command history and legacy recovery
 * fields are omitted by construction.
 */
export function buildMakerV4PublicationManifest(document, options = {}) {
  validateMakerV4Document(document, { mode: 'publish' });
  const release = buildMakerV4VersionMetadata(document, options.previousDocument || null);
  if (!options.allowCompatibilityMismatch
    && release.update.breaking.some((issue) => issue.code === 'compatibility-declaration-mismatch')) {
    throw new MakerV4PublicationError(
      'The declared Maker compatibility does not match the detected update.',
      'compatibility-declaration-mismatch',
      { update: release.update },
    );
  }
  const tracks = orderedTracks(document);
  const trackOrder = new Map(tracks.map((track) => [String(track.id), Number(track.order)]));
  const referenced = new Set(collectReferencedMakerV4AssetIds(document));
  const colors = orderedChannels(document);
  const partOrder = new Map(orderedParts(document).map((part) => [String(part.id), Number(part.menuOrder)]));
  const colorOrder = new Map(colors.map((channel) => [String(channel.id), Number(channel.order)]));
  const manifest = {
    schemaVersion: MAKER_V4_SCHEMA_VERSION,
    version: sanitizeVersion(document.version),
    metadata: {
      id: String(document.metadata.id || ''),
      name: String(document.metadata.name || ''),
      summary: String(document.metadata.summary || ''),
      creator: String(document.metadata.creator || ''),
      style: String(document.metadata.style || ''),
      license: {
        kind: String(document.metadata.license?.kind || ''),
        note: String(document.metadata.license?.note || ''),
      },
      coverAssetId: document.metadata.coverAssetId ?? null,
    },
    canvas: {
      width: Number(document.canvas.width),
      height: Number(document.canvas.height),
      pixelMode: String(document.canvas.pixelMode),
    },
    layerTracks: tracks.map((track) => ({ id: String(track.id), name: String(track.name), order: Number(track.order) })),
    colorChannels: colors.map(sanitizeChannel),
    parts: orderedParts(document).map((part) => sanitizePart(part, trackOrder)),
    defaultRecipe: {
      selections: [...asArray(document.defaultRecipe?.selections)].map(clone).sort((left, right) => (
        (partOrder.get(String(left?.partId || '')) ?? Number.MAX_SAFE_INTEGER)
          - (partOrder.get(String(right?.partId || '')) ?? Number.MAX_SAFE_INTEGER)
        || compareText(left?.partId, right?.partId)
      )),
      colors: [...asArray(document.defaultRecipe?.colors)].map(clone).sort((left, right) => (
        (colorOrder.get(String(left?.channelId || '')) ?? Number.MAX_SAFE_INTEGER)
          - (colorOrder.get(String(right?.channelId || '')) ?? Number.MAX_SAFE_INTEGER)
        || compareText(left?.channelId, right?.channelId)
      )),
    },
    expansionPacks: asArray(document.expansionPacks).map(sanitizeExpansionPack).sort((left, right) => compareText(left.id, right.id)),
    assets: asArray(document.assets).filter((asset) => referenced.has(String(asset.id))).map(sanitizeAsset)
      .sort((left, right) => compareText(left.identifier, right.identifier) || compareText(left.id, right.id)),
    publication: {
      royaltyBps: Number(document.publication.royaltyBps),
      mintingEnabled: Boolean(document.publication.mintingEnabled),
      mintFeeEnabled: Boolean(document.publication.mintFeeEnabled),
      mintPriceAtomic: Number(document.publication.mintPriceAtomic || 0),
      paymentCoinType: String(document.publication.paymentCoinType || ''),
      paymentCoinSymbol: String(document.publication.paymentCoinSymbol || ''),
      storage: String(document.publication.storage || 'walrus'),
      chain: String(document.publication.chain || 'sui'),
    },
    // These containers are required by the v4 schema. They intentionally do
    // not inherit editor endpoints, local recovery data or Blob/Object URLs.
    runtime: {},
    livingContent: clone(document.livingContent ?? null),
    release,
    legacyMoveProjection: releaseProjection(document),
    extensions: options.publicExtensions ? clone(options.publicExtensions) : {},
  };
  if (options.requireCompleteRuleProjection && manifest.legacyMoveProjection.authorizationCoverage !== 'complete') {
    throw new MakerV4PublicationError(
      'This Maker uses rules the current Move summary cannot enforce.',
      'partial-move-rule-projection',
      { unrepresentedRules: manifest.legacyMoveProjection.unrepresentedRules },
    );
  }
  validateMakerV4Document(manifest, { mode: 'publish' });
  return manifest;
}

function runtimeRecord(runtimeAssets, assetId) {
  if (runtimeAssets instanceof Map) return runtimeAssets.get(assetId);
  return jsonObject(runtimeAssets)[assetId];
}

function blobFromRecord(record) {
  if (record && typeof record.arrayBuffer === 'function') return record;
  for (const candidate of [record?.blob, record?.file]) {
    if (candidate && typeof candidate.arrayBuffer === 'function') return candidate;
  }
  return null;
}

/** Collect referenced local assets in deterministic quilt order. */
export function collectMakerV4UploadEntries(document, runtimeAssets, options = {}) {
  const assets = assetById(document);
  const entries = collectReferencedMakerV4AssetIds(document).map((assetId) => {
    const asset = assets.get(assetId);
    const record = runtimeRecord(runtimeAssets, assetId);
    const blob = blobFromRecord(record);
    if (!blob && options.requireBlob !== false) {
      throw new MakerV4PublicationError(
        `Asset "${assetId}" has no runtime Blob/File.`,
        'missing-runtime-asset',
        { assetId, identifier: asset.identifier },
      );
    }
    return {
      blob,
      identifier: String(asset.identifier || ''),
      kind: String(asset.kind || 'layer'),
      assetId,
    };
  });
  const identifiers = entries.map((entry) => entry.identifier);
  if (identifiers.some((identifier) => !identifier)) {
    throw new MakerV4PublicationError('Every uploaded Asset needs an immutable identifier.', 'missing-asset-identifier');
  }
  if (new Set(identifiers).size !== identifiers.length) {
    throw new MakerV4PublicationError('Uploaded Asset identifiers must be unique.', 'duplicate-asset-identifier');
  }
  if (identifiers.includes(options.manifestIdentifier || MAKER_V4_MANIFEST_IDENTIFIER)) {
    throw new MakerV4PublicationError('An Asset uses the reserved Maker manifest identifier.', 'reserved-manifest-identifier');
  }
  return entries;
}

/** Build the complete, stable Walrus quilt payload (manifest is always last). */
export function buildMakerV4PublicationBundle(document, runtimeAssets, options = {}) {
  const manifestIdentifier = options.manifestIdentifier || MAKER_V4_MANIFEST_IDENTIFIER;
  const manifest = buildMakerV4PublicationManifest(document, options);
  const manifestJson = JSON.stringify(manifest);
  const assetEntries = collectMakerV4UploadEntries(document, runtimeAssets, { ...options, manifestIdentifier });
  const manifestBlob = new Blob([manifestJson], { type: 'application/json' });
  return {
    manifest,
    manifestJson,
    manifestIdentifier,
    assetEntries,
    entries: [
      ...assetEntries,
      { blob: manifestBlob, identifier: manifestIdentifier, kind: 'maker-manifest', assetId: null },
    ],
    release: manifest.release,
    projection: manifest.legacyMoveProjection,
  };
}

/** Map Walrus quilt results back to v4 Asset ids without relying on UI state. */
export function indexMakerV4UploadResults(entries, files) {
  if (!Array.isArray(entries) || !Array.isArray(files) || entries.length !== files.length) {
    throw new MakerV4PublicationError('Walrus returned an unexpected Maker quilt result.', 'walrus-result-length');
  }
  const result = new Map();
  entries.forEach((entry, index) => {
    if (entry.assetId) result.set(entry.assetId, files[index]);
  });
  return result;
}

function locationValue(locations, assetId) {
  const record = locations instanceof Map ? locations.get(assetId) : jsonObject(locations)[assetId];
  if (typeof record === 'string') return record;
  return String(record?.patchId || record?.quiltPatchId || record?.walrusPatchId || record?.id || record?.blobId || '');
}

function primaryVariantAssetId(index, record) {
  const bindings = orderedBindings(record.variant, index.trackOrder);
  for (const binding of bindings) {
    const channel = binding.colorChannelId ? index.channelById.get(String(binding.colorChannelId)) : null;
    if (channel?.defaultSwatchId) {
      const mapped = asArray(binding.assetsBySwatch).find((entry) => entry.swatchId === channel.defaultSwatchId);
      if (mapped?.assetId) return String(mapped.assetId);
    }
    if (binding.assetId) return String(binding.assetId);
  }
  return '';
}

function selectorSummaryKeys(selector, index) {
  const partId = String(selector?.partId || '');
  if (!selector?.itemId) return [''];
  const matches = index.items.records.filter((record) => (
    record.part.id === partId
    && record.item.id === selector.itemId
    && (!selector.variantId || record.variant.id === selector.variantId)
  ));
  return matches.map((record) => record.key);
}

function ruleDiagnostic(rule) {
  return {
    id: String(rule?.id || ''),
    type: String(rule?.type || ''),
    trigger: clone(rule?.trigger || {}),
    targets: clone(asArray(rule?.targets)),
  };
}

function flattenMoveRules(document, index) {
  const rules = [];
  const unrepresentedRules = [];
  const seen = new Set();
  collectMakerRules(document).forEach((rule) => {
    if (rule.type !== 'excludes') {
      unrepresentedRules.push({ code: 'requires-not-supported-by-move-summary', ruleId: rule.id, rule: ruleDiagnostic(rule) });
      return;
    }
    rule.targets.forEach((target) => {
      if (rule.trigger.partId === target.partId) {
        unrepresentedRules.push({ code: 'same-part-rule-not-supported-by-move-summary', ruleId: rule.id, rule: ruleDiagnostic(rule) });
        return;
      }
      const leftPart = index.partById.get(rule.trigger.partId);
      const rightPart = index.partById.get(target.partId);
      if (!leftPart || !rightPart || leftPart.kind === 'last-bastion' || rightPart.kind === 'last-bastion') {
        unrepresentedRules.push({ code: 'part-kind-rule-not-supported-by-move-summary', ruleId: rule.id, rule: ruleDiagnostic(rule) });
        return;
      }
      const leftKeys = selectorSummaryKeys(rule.trigger, index);
      const rightKeys = selectorSummaryKeys(target, index);
      if (!leftKeys.length || !rightKeys.length) {
        throw new MakerV4PublicationError('A v4 exclusion could not be projected to published Items.', 'rule-projection-failed', { rule });
      }
      leftKeys.forEach((leftItemKey) => rightKeys.forEach((rightItemKey) => {
        const sides = [
          `${rule.trigger.partId}\u0000${leftItemKey}`,
          `${target.partId}\u0000${rightItemKey}`,
        ].sort(compareText);
        const key = sides.join('\u0001');
        if (seen.has(key)) return;
        seen.add(key);
        rules.push({
          leftPartKey: String(rule.trigger.partId),
          leftItemKey,
          rightPartKey: String(target.partId),
          rightItemKey,
        });
      }));
    });
  });
  if (rules.length > MOVE_MAX_RULES) {
    throw new MakerV4PublicationError(`The Move summary expands to more than ${MOVE_MAX_RULES} rules.`, 'move-rule-limit', { count: rules.length });
  }

  orderedParts(document).forEach((part) => {
    if (part.parentPartId) unrepresentedRules.push({ code: 'parent-hierarchy-retained-on-walrus', partId: part.id, parentPartId: part.parentPartId });
    if (part.visibleWhen) unrepresentedRules.push({ code: 'visible-when-retained-on-walrus', path: `parts.${part.id}.visibleWhen` });
    orderedItems(part).forEach((item) => {
      if (item.visibleWhen) unrepresentedRules.push({ code: 'visible-when-retained-on-walrus', path: `parts.${part.id}.items.${item.id}.visibleWhen` });
      orderedVariants(item).forEach((variant) => {
        if (variant.visibleWhen) unrepresentedRules.push({ code: 'visible-when-retained-on-walrus', path: `parts.${part.id}.items.${item.id}.variants.${variant.id}.visibleWhen` });
        asArray(variant.layerBindings).forEach((binding) => {
          if (binding.visibleWhen) unrepresentedRules.push({ code: 'layer-visible-when-retained-on-walrus', path: `parts.${part.id}.items.${item.id}.variants.${variant.id}.bindings.${binding.id}.visibleWhen` });
        });
      });
    });
  });
  return { rules, unrepresentedRules };
}

function paletteLinks(index) {
  const groups = new Map();
  index.parts.forEach((part) => {
    if (!part.primaryColorChannelId) return;
    if (!groups.has(part.primaryColorChannelId)) groups.set(part.primaryColorChannelId, []);
    groups.get(part.primaryColorChannelId).push(part);
  });
  return [...groups.values()].flatMap((parts) => {
    if (parts.length < 2) return [];
    const [primary, ...linked] = parts;
    return linked.flatMap((part) => (
      JSON.stringify(primary.colors) === JSON.stringify(part.colors)
        ? [{ primaryPartKey: primary.id, linkedPartKey: part.id }]
        : []
    ));
  });
}

/**
 * Flatten Maker v4 definitions to the existing `publishMaker()` arguments.
 * Variant ids are encoded into unique legacy Item keys; the full mapping stays
 * in the Walrus manifest.
 */
export function buildMakerV4MoveSummary(document, options = {}) {
  validateMakerV4Document(document, { mode: 'publish' });
  const index = projectionIndex(document);
  if (index.items.records.length > MOVE_MAX_ITEMS) {
    throw new MakerV4PublicationError(`The Move summary contains more than ${MOVE_MAX_ITEMS} Item/Variant records.`, 'move-item-limit');
  }
  const missingLocations = [];
  const items = index.items.records.map((record) => {
    const assetId = primaryVariantAssetId(index, record);
    const blobId = locationValue(options.assetLocations, assetId);
    if (!blobId && options.requireAssetLocations !== false) missingLocations.push(assetId);
    const iconBlobId = record.item.thumbnailAssetId
      ? locationValue(options.assetLocations, String(record.item.thumbnailAssetId))
      : '';
    const variants = orderedVariants(record.item);
    const label = variants.length === 1 || record.isDefault
      ? String(record.item.name)
      : `${record.item.name} · ${record.variant.name}`;
    return {
      partKey: String(record.part.id),
      itemKey: record.key,
      label: truncateUtf8(label),
      blobId,
      iconBlobId,
      gateKind: 0,
      sourceItemId: String(record.item.id),
      sourceVariantId: String(record.variant.id),
      sourceAssetId: assetId,
    };
  });
  if (missingLocations.length) {
    throw new MakerV4PublicationError(
      `Walrus locations are missing for ${[...new Set(missingLocations)].join(', ')}.`,
      'missing-walrus-asset-location',
      { assetIds: [...new Set(missingLocations)] },
    );
  }
  const flattenedRules = flattenMoveRules(document, index);
  if (options.requireCompleteRuleProjection && flattenedRules.unrepresentedRules.length) {
    throw new MakerV4PublicationError(
      'This Maker uses rules the current Move summary cannot enforce.',
      'partial-move-rule-projection',
      { unrepresentedRules: flattenedRules.unrepresentedRules },
    );
  }
  return {
    maker: {
      name: String(document.metadata.name || ''),
      description: String(document.metadata.summary || ''),
      coverUrl: String(options.coverUrl || ''),
      license: String(document.metadata.license?.kind || 'personal-use'),
      royaltyBps: Number(document.publication.royaltyBps || 0),
      mintingEnabled: document.publication.mintingEnabled !== false,
      mintFeeEnabled: Boolean(document.publication.mintFeeEnabled),
      mintPriceAtomic: Number(document.publication.mintFeeEnabled ? document.publication.mintPriceAtomic : 0),
    },
    parts: index.parts.map((part) => ({
      key: part.id,
      label: String(part.source.name || part.id),
      kind: part.kind,
      renderOrder: part.renderOrder,
      menuVisible: part.source.menuVisible !== false,
      required: Boolean(part.source.required),
      colors: [...part.colors],
    })),
    items,
    rules: flattenedRules.rules,
    paletteLinks: paletteLinks(index),
    unrepresentedRules: flattenedRules.unrepresentedRules,
    authorizationCoverage: flattenedRules.unrepresentedRules.length ? 'partial' : 'complete',
    projection: releaseProjection(document),
    release: buildMakerV4VersionMetadata(document, options.previousDocument || null),
  };
}

function rawRecipeSelections(recipe) {
  if (Array.isArray(recipe)) return recipe;
  const source = recipe?.selections ?? recipe?.recipe ?? recipe;
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];
  return Object.entries(source).filter(([partId]) => !['colors', 'colorChannels', 'palettes', 'metadata'].includes(partId))
    .map(([partId, selection]) => {
      if (typeof selection === 'string') return { partId, itemId: selection };
      if (!selection || typeof selection !== 'object') return { partId, itemId: '' };
      return { partId, ...selection };
    });
}

function rawRecipeColors(recipe) {
  const source = recipe?.colors ?? recipe?.colorChannels ?? recipe?.palettes;
  if (Array.isArray(source)) return source.map((entry) => String(entry?.channelId || entry?.colorChannelId || entry?.paletteId || '')).filter(Boolean);
  return Object.keys(jsonObject(source));
}

/**
 * Validate without repair, retain the full v4 recipe for Walrus, and produce
 * the exact existing `{ partKey, itemKey, colorHex, renderOrder }` Sui recipe.
 */
export function flattenMakerV4Recipe(document, recipe, options = {}) {
  validateMakerV4Document(document, { mode: 'publish' });
  const explicitSelections = rawRecipeSelections(recipe);
  const duplicateParts = explicitSelections.map((selection) => String(selection?.partId || selection?.partKey || ''))
    .filter((partId, index, values) => partId && values.indexOf(partId) !== index);
  if (duplicateParts.length) {
    throw new MakerV4PublicationError('The recipe selects the same Part more than once.', 'duplicate-recipe-part', { partIds: [...new Set(duplicateParts)] });
  }
  const partMap = new Map(orderedParts(document).map((part) => [String(part.id), part]));
  const missingVariants = explicitSelections.flatMap((selection) => {
    const partId = String(selection?.partId || selection?.partKey || '');
    const itemId = String(selection?.itemId || selection?.itemKey || '');
    if (!partId || !itemId) return [];
    const item = orderedItems(partMap.get(partId)).find((candidate) => candidate.id === itemId);
    return item && orderedVariants(item).length && !String(selection?.variantId || selection?.variantKey || selection?.styleId || '')
      ? [{ partId, itemId }]
      : [];
  });
  if (missingVariants.length) {
    throw new MakerV4PublicationError('Every selected v4 Item must name its Variant.', 'missing-recipe-variant', { selections: missingVariants });
  }
  if (options.requireExplicitColors !== false) {
    const supplied = new Set(rawRecipeColors(recipe));
    const missingChannels = orderedChannels(document).map((channel) => String(channel.id)).filter((channelId) => !supplied.has(channelId));
    if (missingChannels.length) {
      throw new MakerV4PublicationError('The recipe is missing explicit ColorChannel selections.', 'missing-recipe-colors', { channelIds: missingChannels });
    }
  }
  const evaluated = evaluateRecipe(document, recipe);
  if (!evaluated.valid) {
    throw new MakerV4PublicationError('The v4 recipe violates Maker constraints.', 'invalid-maker-recipe', { violations: evaluated.violations });
  }
  const index = projectionIndex(document);
  const colorSelections = new Map(asArray(evaluated.documentRecipe.colors).map((color) => [String(color.channelId), String(color.swatchId)]));
  const suiRecipe = evaluated.documentRecipe.selections.map((selection) => {
    const part = index.partById.get(String(selection.partId));
    const item = index.items.byTuple.get(tupleKey(selection.partId, selection.itemId, selection.variantId));
    if (!part || !item) {
      throw new MakerV4PublicationError('A recipe selection is absent from the Move projection.', 'recipe-projection-failed', { selection });
    }
    let colorHex = MAKER_V4_NEUTRAL_COLOR;
    if (part.primaryColorChannelId) {
      const channel = index.channelById.get(part.primaryColorChannelId);
      const swatchId = colorSelections.get(part.primaryColorChannelId);
      const swatch = asArray(channel?.swatches).find((candidate) => candidate.id === swatchId);
      if (!swatch) {
        throw new MakerV4PublicationError('A recipe color is absent from the Move projection.', 'recipe-color-projection-failed', {
          partId: part.id,
          channelId: part.primaryColorChannelId,
          swatchId,
        });
      }
      colorHex = moveColor(swatch.hintColor);
    }
    return {
      partKey: String(selection.partId),
      itemKey: item.key,
      colorHex,
      renderOrder: part.renderOrder,
    };
  }).sort((left, right) => left.renderOrder - right.renderOrder || compareText(left.partKey, right.partKey));
  return {
    fullRecipe: clone(evaluated.documentRecipe),
    fullRecipeJson: JSON.stringify(evaluated.documentRecipe),
    suiRecipe,
    projection: releaseProjection(document),
    release: buildMakerV4VersionMetadata(document, options.previousDocument || null),
  };
}

/** Build the full OC provenance file uploaded to Walrus. */
export function buildMakerV4OcPackage({
  document,
  recipe,
  profile = {},
  livingContent = null,
  makerObjectId = '',
  manifestBlobId = '',
  createdAt = null,
  previousDocument = null,
  integrity = null,
} = {}) {
  const flattened = flattenMakerV4Recipe(document, recipe, { previousDocument });
  const packageValue = {
    schemaVersion: MAKER_V4_OC_PACKAGE_SCHEMA,
    createdAt,
    maker: {
      rootMakerId: String(document.version.rootMakerId),
      versionId: String(document.version.versionId),
      versionNumber: Number(document.version.number),
      makerObjectId: String(makerObjectId || ''),
      manifestBlobId: String(manifestBlobId || ''),
      name: String(document.metadata.name || ''),
      creator: String(document.metadata.creator || ''),
      license: clone(document.metadata.license),
      royaltyBps: Number(document.publication.royaltyBps || 0),
    },
    profile: clone(profile),
    livingContent: clone(livingContent),
    recipe: flattened.fullRecipe,
    suiSummary: {
      recipeEncoding: 'BCS vector<RecipeSlot>',
      itemKeyEncoding: MAKER_V4_ITEM_KEY_ENCODING,
      recipe: flattened.suiRecipe,
    },
    release: flattened.release,
    ...(integrity ? { integrity: clone(integrity) } : {}),
  };
  return {
    package: packageValue,
    packageJson: JSON.stringify(packageValue),
    fullRecipe: flattened.fullRecipe,
    fullRecipeJson: flattened.fullRecipeJson,
    suiRecipe: flattened.suiRecipe,
    release: flattened.release,
  };
}

/** Match the existing OC quilt convention: rendered image first, profile JSON second. */
export function buildMakerV4OcUploadEntries(imageBlob, ocPackage, options = {}) {
  if (!imageBlob || typeof imageBlob.arrayBuffer !== 'function') {
    throw new MakerV4PublicationError('The rendered OC image Blob is missing.', 'missing-oc-image');
  }
  const packageValue = ocPackage?.package || ocPackage;
  if (!packageValue || packageValue.schemaVersion !== MAKER_V4_OC_PACKAGE_SCHEMA) {
    throw new MakerV4PublicationError('A Maker v4 OC package is required.', 'invalid-oc-package');
  }
  const imageIdentifier = options.imageIdentifier || 'animacraft-oc.png';
  const profileIdentifier = options.profileIdentifier || 'animacraft-oc.json';
  const profileBlob = new Blob([JSON.stringify(packageValue)], { type: 'application/json' });
  return [
    { blob: imageBlob, identifier: imageIdentifier, kind: 'oc-image' },
    { blob: profileBlob, identifier: profileIdentifier, kind: 'oc-profile' },
  ];
}
