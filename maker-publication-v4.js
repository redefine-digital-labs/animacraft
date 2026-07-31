/**
 * Pure bridge between the full Animacraft Maker v5 document and the existing
 * Walrus + Sui publication interfaces.
 *
 * Walrus remains authoritative for the full versioned Maker/recipe. Projection
 * v2 compiles that graph into an equivalent Sui authorization/color model or
 * fails closed; the older lossy projection remains only for compatibility.
 * The file/API names remain temporary aliases for existing callers.
 */

import { compareMakerCompatibility, mergeExpansionPacks } from './expansion-packs.js';
import {
  collectMakerRules,
  evaluateRecipe,
  migrateLegacyMakerRules,
  normalizeRuleSelector,
} from './maker-rules.js';
import { MAKER_V4_SCHEMA_VERSION, validateMakerV4Document } from './maker-v4.js';
import {
  DEFAULT_PROTOCOL_COMMERCE_V5,
  MAKER_COMMERCE_V5_SCHEMA,
  MAKER_ACCESS_MODES,
  PACK_ACCESS_MODES,
  collectMakerCommerceV5Issues,
  normalizeMakerCommerceV5,
} from './maker-commerce-v5.js';

export const MAKER_V4_MANIFEST_IDENTIFIER = 'animacraft-manifest.json';
export const MAKER_V4_RELEASE_SCHEMA = 'animacraft.maker-release.v1';
export const MAKER_V4_MOVE_PROJECTION_SCHEMA = 'animacraft.move-summary.v1';
export const MAKER_V4_OC_PACKAGE_SCHEMA = 'animacraft.oc-package.v2';
export const MAKER_V4_ITEM_KEY_ENCODING = 'item-style-key.v1';
export const MAKER_V4_NEUTRAL_COLOR = '#000000';
export const MAKER_V4_MOVE_PROJECTION_V2_SCHEMA = 'animacraft.move-summary.v2';
export const MAKER_V4_ITEM_KEY_ENCODING_V2 = 'item-style-none-smart-color.v2';
export const MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER = 'animacraft-chain-auxiliary.png';
export const MAKER_V4_MAX_SINGLE_PUBLISH_RECORDS = 450;
export const MAKER_V4_EMBEDDED_EXPANSION_RUNTIME = 'embedded-v1';
export const MAKER_V4_EMBEDDED_EXPANSION_CONTAINER = 'extensions.expansionDrafts';
export const MAKER_V4_COMMERCE_PROJECTION_V5_SCHEMA = 'animacraft.move-commerce-projection.v5';
export const MAKER_V4_NONE_STYLE_KEY_V5 = '__animacraft_none__';
export const MAKER_V4_COLOR_STYLE_KEY_PREFIX_V5 = '__animacraft_color__:';
export const MAKER_V4_COMMERCE_STYLE_ROW_V5 = Object.freeze({
  VISUAL: 'VISUAL',
  LOGICAL_NONE: 'LOGICAL_NONE',
  LOGICAL_COLOR: 'LOGICAL_COLOR',
});

const MOVE_MAX_KEY_BYTES = 128;
const MOVE_MAX_PARTS = 750;
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

function assertNoUnresolvedLegacyRuleRecovery(document) {
  const recovery = document?.extensions?.unresolvedLegacyRules;
  const rules = asArray(recovery?.rules);
  if (!rules.length) return;
  const issues = asArray(recovery?.issues);
  throw new MakerV4PublicationError(
    'Legacy Maker rules could not be mapped to one Part, Item, or Style owner.',
    'unresolved-legacy-maker-rules',
    {
      rules: issues.length
        ? issues
        : rules.map((rule, index) => ({
          path: `extensions.unresolvedLegacyRules.rules[${index}]`,
          reason: 'unresolved-recovery-rule',
          id: String(rule?.id || ''),
        })),
    },
  );
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
  return [...asArray(part?.items)]
    .filter((item) => (item?.status || 'public') === 'public')
    .sort((left, right) => compareOrder(left, right, 'displayOrder'));
}

function orderedStyles(item) {
  return [...asArray(item?.styles)].sort((left, right) => compareOrder(left, right, 'displayOrder'));
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

function tupleKey(partId, itemId, styleId) {
  return `${partId}\u0000${itemId}\u0000${styleId}`;
}

function buildItemProjection(document) {
  const byTuple = new Map();
  const records = [];
  orderedParts(document).forEach((part) => {
    const used = new Set();
    const descriptors = orderedItems(part).flatMap((item) => {
      const styles = orderedStyles(item);
      return styles.map((style) => ({ part, item, style, isDefault: style.id === item.defaultStyleId }));
    });

    // Preserve every Item id for its default Style before allocating compound
    // keys. This prevents an Item named `shirt--red` from being displaced by a
    // red Style belonging to another Item.
    descriptors.filter((entry) => entry.isDefault || orderedStyles(entry.item).length === 1).forEach((entry) => {
      const identity = tupleKey(part.id, entry.item.id, entry.style.id);
      const key = compactMoveKey(entry.item.id, identity, used);
      const record = { ...entry, key };
      byTuple.set(identity, record);
      records.push(record);
    });
    descriptors.filter((entry) => !byTuple.has(tupleKey(part.id, entry.item.id, entry.style.id))).forEach((entry) => {
      const identity = tupleKey(part.id, entry.item.id, entry.style.id);
      const key = compactMoveKey(`${entry.item.id}--${entry.style.id}`, identity, used);
      const record = { ...entry, key };
      byTuple.set(identity, record);
      records.push(record);
    });
  });
  return { byTuple, records };
}

function setIntersection(left, right) {
  return new Set([...left].filter((value) => right.has(value)));
}

function setDifference(left, right) {
  return new Set([...left].filter((value) => !right.has(value)));
}

function sortedSet(value) {
  return [...value].sort(compareText);
}

function assetFingerprint(asset) {
  return String(asset?.contentHash || asset?.digest || '').toLowerCase();
}

/** Collapse immutable Asset aliases created when embedded Packs reuse a PNG. */
export function collapseMakerV4ProjectionAssetAliases(document) {
  const result = clone(document);
  const canonicalByIdentifier = new Map();
  const aliases = new Map();
  asArray(result?.assets).forEach((asset) => {
    const identifier = String(asset?.identifier || '');
    const assetId = String(asset?.id || '');
    if (!identifier || !assetId) return;
    if (!canonicalByIdentifier.has(identifier)) {
      canonicalByIdentifier.set(identifier, asset);
      return;
    }
    const canonical = canonicalByIdentifier.get(identifier);
    if (String(canonical.id) === assetId) return;
    const canonicalFingerprint = assetFingerprint(canonical);
    const aliasFingerprint = assetFingerprint(asset);
    if (canonicalFingerprint && aliasFingerprint && canonicalFingerprint !== aliasFingerprint) {
      throw new MakerV4PublicationError(
        `Assets "${canonical.id}" and "${assetId}" reuse one identifier with different content hashes.`,
        'duplicate-asset-identifier-content-conflict',
        { identifier, assetIds: [String(canonical.id), assetId] },
      );
    }
    aliases.set(assetId, String(canonical.id));
  });
  if (!aliases.size) return result;
  const resolve = (assetId) => aliases.get(String(assetId || '')) || assetId;
  if (result.metadata) result.metadata.coverAssetId = resolve(result.metadata.coverAssetId);
  asArray(result.layerTracks).forEach((track) => {
    track.referenceAssetId = resolve(track.referenceAssetId);
  });
  asArray(result.parts).forEach((part) => {
    part.iconAssetId = resolve(part.iconAssetId);
    asArray(part.items).forEach((item) => {
      item.thumbnailAssetId = resolve(item.thumbnailAssetId);
      asArray(item.styles).forEach((style) => {
        style.assetId = resolve(style.assetId);
      });
    });
  });
  result.assets = asArray(result.assets).filter((asset) => !aliases.has(String(asset?.id || '')));
  return result;
}

/**
 * Build the one immutable chain-definition graph: base Maker plus every
 * embedded ExpansionPack, independent of which Packs one Player enables.
 */
export function prepareMakerV4ProjectionV2Document(document, options = {}) {
  const base = clone(document);
  assertNoUnresolvedLegacyRuleRecovery(base);
  const legacyRuleMigration = migrateLegacyMakerRules(base);
  if (legacyRuleMigration.unresolved.length) {
    throw new MakerV4PublicationError(
      'Legacy Maker rules could not be mapped to one Part, Item, or Style owner.',
      'unresolved-legacy-maker-rules',
      { rules: legacyRuleMigration.unresolved },
    );
  }
  const packs = options.expansionPacks === undefined
    ? asArray(base?.extensions?.expansionDrafts)
    : asArray(options.expansionPacks);
  base.assets ||= [];
  const baseAssets = new Map(base.assets.map((asset) => [String(asset?.id || ''), asset]));
  packs.forEach((pack) => asArray(pack?.assets).forEach((asset) => {
    const assetId = String(asset?.id || '');
    if (!assetId) return;
    const existing = baseAssets.get(assetId);
    if (!existing) {
      const copy = clone(asset);
      base.assets.push(copy);
      baseAssets.set(assetId, copy);
      return;
    }
    const identifiersMatch = String(existing.identifier || '') === String(asset.identifier || '');
    const existingFingerprint = assetFingerprint(existing);
    const packFingerprint = assetFingerprint(asset);
    if (!identifiersMatch
      || (existingFingerprint && packFingerprint && existingFingerprint !== packFingerprint)) {
      throw new MakerV4PublicationError(
        `ExpansionPack Asset "${assetId}" conflicts with another immutable Asset identity.`,
        'expansion-asset-id-conflict',
        {
          assetId,
          identifiers: [String(existing.identifier || ''), String(asset.identifier || '')],
        },
      );
    }
  }));
  let merged = base;
  if (packs.length) {
    const result = mergeExpansionPacks(base, packs, { returnResult: true });
    if (!result.compatible) {
      throw new MakerV4PublicationError(
        'Embedded ExpansionPacks are not compatible with this Maker release.',
        'incompatible-expansion-pack-projection',
        { errors: clone(result.errors), results: clone(result.results) },
      );
    }
    merged = result.maker;
  }

  merged.defaultRecipe ||= { selections: [], colors: [] };
  merged.defaultRecipe.selections ||= [];
  merged.defaultRecipe.colors ||= [];
  const defaultParts = new Set(merged.defaultRecipe.selections
    .map((selection) => String(selection?.partId || ''))
    .filter(Boolean));
  // Pack-added Parts are optional by compatibility contract. Their picker
  // default is not an instruction to enable the Pack in the base recipe.
  asArray(merged.parts).forEach((part) => {
    if (part?.expansionPackId && part.required !== true && !defaultParts.has(String(part.id))) {
      part.defaultItemId = null;
    }
  });
  const defaultChannels = new Set(merged.defaultRecipe.colors
    .map((selection) => String(selection?.channelId || ''))
    .filter(Boolean));
  asArray(merged.colorChannels).forEach((channel) => {
    if (!defaultChannels.has(String(channel.id)) && channel.defaultSwatchId) {
      merged.defaultRecipe.colors.push({
        channelId: String(channel.id),
        swatchId: String(channel.defaultSwatchId),
      });
    }
  });
  return collapseMakerV4ProjectionAssetAliases(merged);
}

function partMayBeInactive(part, sourceParts, visiting = new Set()) {
  if (!part) return false;
  if (part.visibleWhen != null) return true;
  const parentPartId = String(part.parentPartId || '');
  if (!parentPartId) return false;
  if (visiting.has(String(part.id))) return true;
  const nextVisiting = new Set(visiting).add(String(part.id));
  const parent = sourceParts.get(parentPartId);
  return parent?.required !== true || partMayBeInactive(parent, sourceParts, nextVisiting);
}

function nullableProjectionPart(part, sourceParts) {
  return part?.required !== true || partMayBeInactive(part, sourceParts);
}

function projectionV2Index(document) {
  const itemProjection = buildItemProjection(document);
  const sourceParts = new Map(orderedParts(document).map((part) => [String(part.id), part]));
  const usedPartKeys = new Set(sourceParts.keys());
  const partRecords = [];
  const partBySourceId = new Map();
  const itemByTuple = new Map();
  const realKeysByPart = new Map();
  const domainKeysByPart = new Map();
  const noneByPart = new Map();
  const items = [];
  const styleMappings = [];
  const noneMappings = [];
  const colorMappings = [];

  orderedParts(document).forEach((part) => {
    const partKey = String(part.id);
    const sourceRecords = itemProjection.records
      .filter((record) => String(record.part.id) === partKey)
      .sort((left, right) => (
        compareOrder(left.item, right.item, 'displayOrder')
        || compareOrder(left.style, right.style, 'displayOrder')
        || compareText(left.key, right.key)
      ));
    const usedItemKeys = new Set(sourceRecords.map((record) => record.key));
    const realKeys = new Set(sourceRecords.map((record) => record.key));
    const nullable = nullableProjectionPart(part, sourceParts);
    const record = {
      key: partKey,
      label: String(part.name || part.id),
      kind: 'standard',
      renderOrder: partRecords.length,
      menuVisible: part.menuVisible !== false,
      required: true,
      colors: [MAKER_V4_NEUTRAL_COLOR],
      projectionKind: 'part',
      sourcePartId: String(part.id),
      nullable,
      source: part,
    };
    partRecords.push(record);
    partBySourceId.set(String(part.id), record);

    sourceRecords.forEach((sourceRecord) => {
      const styles = orderedStyles(sourceRecord.item);
      const label = styles.length === 1 || sourceRecord.isDefault
        ? String(sourceRecord.item.name || sourceRecord.item.id)
        : `${sourceRecord.item.name || sourceRecord.item.id} · ${sourceRecord.style.name || sourceRecord.style.id}`;
      const item = {
        partKey,
        itemKey: sourceRecord.key,
        label: truncateUtf8(label),
        gateKind: 0,
        projectionKind: 'style',
        sourcePartId: String(part.id),
        sourceItemId: String(sourceRecord.item.id),
        sourceStyleId: String(sourceRecord.style.id),
        sourceAssetId: String(sourceRecord.style.assetId || ''),
        sourceThumbnailAssetId: sourceRecord.item.thumbnailAssetId
          ? String(sourceRecord.item.thumbnailAssetId)
          : null,
        assetRef: {
          kind: 'maker-style-png',
          assetId: String(sourceRecord.style.assetId || ''),
        },
        iconAssetRef: sourceRecord.item.thumbnailAssetId
          ? {
            kind: 'maker-item-thumbnail',
            assetId: String(sourceRecord.item.thumbnailAssetId),
          }
          : null,
        renderAsset: true,
      };
      items.push(item);
      itemByTuple.set(tupleKey(part.id, sourceRecord.item.id, sourceRecord.style.id), item);
      styleMappings.push({
        partId: String(part.id),
        itemId: String(sourceRecord.item.id),
        styleId: String(sourceRecord.style.id),
        partKey,
        itemKey: sourceRecord.key,
      });
    });

    if (nullable) {
      const itemKey = compactMoveKey('__ac_none', `none\u0000${part.id}`, usedItemKeys);
      const none = {
        partKey,
        itemKey,
        label: 'None',
        gateKind: 0,
        projectionKind: 'none',
        sourcePartId: String(part.id),
        sourceItemId: null,
        sourceStyleId: null,
        sourceAssetId: null,
        sourceThumbnailAssetId: null,
        assetRef: {
          kind: 'projection-auxiliary',
          identifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
        },
        iconAssetRef: null,
        renderAsset: false,
      };
      items.push(none);
      noneByPart.set(String(part.id), none);
      noneMappings.push({ partId: String(part.id), partKey, itemKey });
    }
    realKeysByPart.set(partKey, realKeys);
    domainKeysByPart.set(partKey, new Set([
      ...realKeys,
      ...(noneByPart.has(String(part.id)) ? [noneByPart.get(String(part.id)).itemKey] : []),
    ]));
  });

  orderedChannels(document).forEach((channel) => {
    const partKey = compactMoveKey(
      `__ac_color_${channel.id}`,
      `color-channel\u0000${channel.id}`,
      usedPartKeys,
    );
    const part = {
      key: partKey,
      label: String(channel.name || channel.id),
      kind: 'standard',
      renderOrder: partRecords.length,
      menuVisible: false,
      required: true,
      colors: [MAKER_V4_NEUTRAL_COLOR],
      projectionKind: 'color-channel',
      sourceChannelId: String(channel.id),
      nullable: false,
      source: channel,
    };
    partRecords.push(part);
    const usedItemKeys = new Set();
    const swatches = asArray(channel.swatches).map((swatch) => {
      const itemKey = compactMoveKey(
        String(swatch.id),
        `color-swatch\u0000${channel.id}\u0000${swatch.id}`,
        usedItemKeys,
      );
      items.push({
        partKey,
        itemKey,
        label: truncateUtf8(String(swatch.name || swatch.id)),
        gateKind: 0,
        projectionKind: 'color-swatch',
        sourceChannelId: String(channel.id),
        sourceSwatchId: String(swatch.id),
        sourceAssetId: null,
        sourceThumbnailAssetId: null,
        assetRef: {
          kind: 'projection-auxiliary',
          identifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
        },
        iconAssetRef: null,
        renderAsset: false,
      });
      return {
        swatchId: String(swatch.id),
        itemKey,
      };
    });
    const keys = new Set(swatches.map((swatch) => swatch.itemKey));
    realKeysByPart.set(partKey, keys);
    domainKeysByPart.set(partKey, new Set(keys));
    colorMappings.push({
      channelId: String(channel.id),
      partKey,
      swatches,
    });
  });

  return {
    parts: partRecords,
    partBySourceId,
    items,
    itemByTuple,
    realKeysByPart,
    domainKeysByPart,
    noneByPart,
    mappings: {
      styles: styleMappings,
      none: noneMappings,
      colorChannels: colorMappings,
    },
  };
}

function selectorProjectionKeys(selectorInput, index) {
  const selector = normalizeRuleSelector(selectorInput);
  const part = index.partBySourceId.get(selector.partId);
  if (!part) {
    throw new MakerV4PublicationError(
      `The projection selector references missing Part "${selector.partId}".`,
      'rule-projection-failed',
      { selector },
    );
  }
  const itemIds = new Set([
    ...(selector.itemId ? [selector.itemId] : []),
    ...asArray(selector.itemIds),
  ]);
  const styleIds = new Set([
    ...(selector.styleId ? [selector.styleId] : []),
    ...asArray(selector.styleIds),
  ]);
  const matches = index.mappings.styles.filter((mapping) => (
    mapping.partId === selector.partId
    && (!itemIds.size || itemIds.has(mapping.itemId))
    && (!styleIds.size || styleIds.has(mapping.styleId))
  ));
  return new Set(matches.map((mapping) => mapping.itemKey));
}

function conditionPartIds(condition) {
  if (condition == null || typeof condition === 'boolean') return new Set();
  if (Array.isArray(condition)) {
    return new Set(condition.flatMap((entry) => [...conditionPartIds(entry)]));
  }
  if (condition?.op === 'selected'
    || typeof condition === 'string'
    || condition?.partId
    || condition?.partKey
    || condition?.part) {
    const selector = normalizeRuleSelector(condition);
    return new Set(selector.partId ? [selector.partId] : []);
  }
  if (condition?.op === 'not') return conditionPartIds(condition.condition);
  if (condition?.op === 'all' || condition?.op === 'any') {
    return new Set(asArray(condition.conditions).flatMap((entry) => [...conditionPartIds(entry)]));
  }
  if (condition && typeof condition === 'object') {
    return new Set([
      ...asArray(condition.all ?? condition.requires).flatMap((entry) => [...conditionPartIds(entry)]),
      ...asArray(condition.any).flatMap((entry) => [...conditionPartIds(entry)]),
      ...asArray(condition.not ?? condition.excludes).flatMap((entry) => [...conditionPartIds(entry)]),
    ]);
  }
  return new Set();
}

function conditionMatchesProjectionKey(condition, partId, itemKey, index) {
  if (condition == null) return true;
  if (typeof condition === 'boolean') return condition;
  if (Array.isArray(condition)) {
    return condition.every((entry) => conditionMatchesProjectionKey(entry, partId, itemKey, index));
  }
  if (condition?.op === 'selected'
    || typeof condition === 'string'
    || condition?.partId
    || condition?.partKey
    || condition?.part) {
    const selector = normalizeRuleSelector(condition);
    if (selector.partId !== partId) return false;
    return selectorProjectionKeys(selector, index).has(itemKey);
  }
  if (condition?.op === 'not') {
    return !conditionMatchesProjectionKey(condition.condition, partId, itemKey, index);
  }
  if (condition?.op === 'all') {
    return asArray(condition.conditions)
      .every((entry) => conditionMatchesProjectionKey(entry, partId, itemKey, index));
  }
  if (condition?.op === 'any') {
    return asArray(condition.conditions)
      .some((entry) => conditionMatchesProjectionKey(entry, partId, itemKey, index));
  }
  return false;
}

function conditionAllowedKeysForPart(condition, partId, index, negated = false) {
  const part = index.partBySourceId.get(partId);
  if (!part) {
    throw new MakerV4PublicationError(
      `The visibility condition references missing Part "${partId}".`,
      'condition-projection-failed',
      { partId },
    );
  }
  const domain = index.domainKeysByPart.get(part.key) || new Set();
  return new Set([...domain].filter((itemKey) => (
    conditionMatchesProjectionKey(condition, partId, itemKey, index) !== negated
  )));
}

function mergeConditionClauses(clauses) {
  const byPart = new Map();
  clauses.forEach((clause) => {
    if (!byPart.has(clause.partId)) {
      byPart.set(clause.partId, { ...clause, allowed: new Set(clause.allowed) });
      return;
    }
    const existing = byPart.get(clause.partId);
    existing.allowed = setIntersection(existing.allowed, clause.allowed);
  });
  return [...byPart.values()].sort((left, right) => compareText(left.partId, right.partId));
}

function unrepresentableCondition(path, condition, reason) {
  throw new MakerV4PublicationError(
    `The condition at ${path} cannot be represented by pairwise Move exclusions.`,
    'unrepresentable-projection-condition',
    { path, reason, condition: clone(condition) },
  );
}

function conditionProjectionClauses(condition, index, path, negated = false) {
  if (condition == null) return negated
    ? unrepresentableCondition(path, condition, 'negated-always-visible-condition')
    : [];
  const partIds = conditionPartIds(condition);
  if (partIds.size === 1) {
    const [partId] = partIds;
    return [{
      partId,
      allowed: conditionAllowedKeysForPart(condition, partId, index, negated),
      path,
    }];
  }
  if (!partIds.size) {
    unrepresentableCondition(path, condition, 'condition-has-no-selection');
  }
  if (condition?.op === 'not') {
    return conditionProjectionClauses(condition.condition, index, `${path}.condition`, !negated);
  }
  if (condition?.op === 'all' || condition?.op === 'any') {
    const effectiveOperator = negated
      ? (condition.op === 'all' ? 'any' : 'all')
      : condition.op;
    if (effectiveOperator === 'any') {
      unrepresentableCondition(path, condition, negated ? 'cross-part-not-all' : 'cross-part-any');
    }
    return mergeConditionClauses(asArray(condition.conditions).flatMap((entry, childIndex) => (
      conditionProjectionClauses(
        entry,
        index,
        `${path}.conditions[${childIndex}]`,
        negated,
      )
    )));
  }
  unrepresentableCondition(path, condition, 'nested-cross-part-condition');
}

function ownerProjectionKeys(owner, index) {
  if (owner.style) {
    const item = index.itemByTuple.get(tupleKey(owner.part.id, owner.item.id, owner.style.id));
    return new Set(item ? [item.itemKey] : []);
  }
  if (owner.item) {
    return new Set(index.mappings.styles
      .filter((mapping) => mapping.partId === owner.part.id && mapping.itemId === owner.item.id)
      .map((mapping) => mapping.itemKey));
  }
  return new Set(index.realKeysByPart.get(String(owner.part.id)) || []);
}

function projectionOwnerPath(part, item = null, style = null) {
  let path = `parts.${part.id}`;
  if (item) path += `.items.${item.id}`;
  if (style) path += `.styles.${style.id}`;
  return path;
}

function addProjectionRule(state, leftPartKey, leftItemKey, rightPartKey, rightItemKey, source) {
  if (!leftItemKey || !rightItemKey) {
    throw new MakerV4PublicationError(
      'Projection rules must enumerate exact Item keys.',
      'wildcard-projection-rule',
      { leftPartKey, leftItemKey, rightPartKey, rightItemKey, source },
    );
  }
  const sides = [
    { partKey: String(leftPartKey), itemKey: String(leftItemKey) },
    { partKey: String(rightPartKey), itemKey: String(rightItemKey) },
  ].sort((left, right) => (
    compareText(left.partKey, right.partKey)
    || compareText(left.itemKey, right.itemKey)
  ));
  const key = `${sides[0].partKey}\u0000${sides[0].itemKey}\u0001${sides[1].partKey}\u0000${sides[1].itemKey}`;
  if (state.seen.has(key)) return;
  state.seen.add(key);
  state.rules.push({
    leftPartKey: sides[0].partKey,
    leftItemKey: sides[0].itemKey,
    rightPartKey: sides[1].partKey,
    rightItemKey: sides[1].itemKey,
  });
  if (state.rules.length > MOVE_MAX_RULES) {
    throw new MakerV4PublicationError(
      `The Move projection expands to more than ${MOVE_MAX_RULES} rules.`,
      'move-rule-limit',
      { count: state.rules.length, source },
    );
  }
}

function addProjectionRuleProduct(state, ownerPart, ownerKeys, targetPart, targetKeys, source) {
  ownerKeys.forEach((ownerKey) => targetKeys.forEach((targetKey) => {
    addProjectionRule(state, ownerPart, ownerKey, targetPart, targetKey, source);
  }));
}

function projectVisibilityCondition(state, owner, condition, index, path) {
  if (condition == null) return [];
  const ownerPartKey = String(owner.part.id);
  const ownerKeys = ownerProjectionKeys(owner, index);
  const clauses = conditionProjectionClauses(condition, index, path);
  clauses.forEach((clause) => {
    const targetPart = index.partBySourceId.get(clause.partId);
    const targetDomain = index.domainKeysByPart.get(targetPart.key) || new Set();
    if (targetPart.key === ownerPartKey) {
      if (![...ownerKeys].every((key) => clause.allowed.has(key))) {
        throw new MakerV4PublicationError(
          `The visibility condition at ${path} invalidates choices in its own Part.`,
          'unrepresentable-same-part-constraint',
          { path, partId: owner.part.id, condition: clone(condition) },
        );
      }
      return;
    }
    addProjectionRuleProduct(
      state,
      ownerPartKey,
      ownerKeys,
      targetPart.key,
      setDifference(targetDomain, clause.allowed),
      { kind: 'visibleWhen', path },
    );
  });
  return clauses;
}

function projectParentActivation(state, part, index, path) {
  if (!part.parentPartId) return null;
  const parent = index.partBySourceId.get(String(part.parentPartId));
  const ownerKeys = index.realKeysByPart.get(String(part.id)) || new Set();
  const allowed = index.realKeysByPart.get(parent.key) || new Set();
  const domain = index.domainKeysByPart.get(parent.key) || new Set();
  addProjectionRuleProduct(
    state,
    String(part.id),
    ownerKeys,
    parent.key,
    setDifference(domain, allowed),
    { kind: 'parentPart', path },
  );
  return { partId: String(part.parentPartId), allowed, path };
}

function projectRequiredConditionalSentinel(state, part, index, activationClauses, path) {
  if (part.required !== true || !index.noneByPart.has(String(part.id))) return;
  const merged = mergeConditionClauses(activationClauses);
  const noneKey = index.noneByPart.get(String(part.id)).itemKey;
  const selfClause = merged.find((clause) => clause.partId === String(part.id));
  // If the visibility expression is false while None occupies this Part, the
  // Part is inactive by definition and None needs no cross-Part restriction.
  if (selfClause && !selfClause.allowed.has(noneKey)) return;
  if (merged.some((clause) => clause.allowed.size === 0)) return;
  const externalClauses = merged
    .filter((clause) => clause.partId !== String(part.id))
    .filter((clause) => {
      const target = index.partBySourceId.get(clause.partId);
      const domain = index.domainKeysByPart.get(target.key) || new Set();
      return clause.allowed.size !== domain.size;
    });
  if (!externalClauses.length) {
    throw new MakerV4PublicationError(
      `Required conditional Part "${part.id}" is active while its None sentinel is selected.`,
      'unrepresentable-required-visibility',
      {
        path,
        partId: String(part.id),
        activationParts: [],
        reason: 'unconditionally-active-sentinel',
      },
    );
  }
  if (externalClauses.length > 1) {
    throw new MakerV4PublicationError(
      `Required conditional Part "${part.id}" needs a ternary activation constraint.`,
      'unrepresentable-required-visibility',
      {
        path,
        partId: String(part.id),
        activationParts: externalClauses.map((clause) => clause.partId),
      },
    );
  }
  const clause = externalClauses[0];
  const targetPart = index.partBySourceId.get(clause.partId);
  addProjectionRuleProduct(
    state,
    String(part.id),
    new Set([noneKey]),
    targetPart.key,
    clause.allowed,
    { kind: 'required-conditional-sentinel', path },
  );
}

function projectEmbeddedRules(state, document, index) {
  collectMakerRules(document).forEach((rule) => {
    if (rule.type !== 'requires' && rule.type !== 'excludes') {
      throw new MakerV4PublicationError(
        `Rule "${rule.id}" has unsupported type "${rule.type}".`,
        'rule-projection-failed',
        { ruleId: String(rule.id), type: String(rule.type) },
      );
    }
    const trigger = normalizeRuleSelector(rule.trigger);
    const triggerPart = index.partBySourceId.get(trigger.partId);
    if (!triggerPart) {
      throw new MakerV4PublicationError(
        `Rule "${rule.id}" has no projected trigger Part.`,
        'rule-projection-failed',
        { ruleId: rule.id, trigger },
      );
    }
    const triggerKeys = selectorProjectionKeys(trigger, index);
    if (!triggerKeys.size) return;
    asArray(rule.targets).forEach((targetInput) => {
      const target = normalizeRuleSelector(targetInput);
      const targetPart = index.partBySourceId.get(target.partId);
      const targetKeys = selectorProjectionKeys(target, index);
      if (triggerPart.key === targetPart.key) {
        const invalidKeys = rule.type === 'requires'
          ? setDifference(triggerKeys, targetKeys)
          : setIntersection(triggerKeys, targetKeys);
        if (invalidKeys.size) {
          throw new MakerV4PublicationError(
            `Rule "${rule.id}" invalidates choices within one Part and cannot be represented pairwise.`,
            'unrepresentable-same-part-constraint',
            {
              ruleId: String(rule.id),
              type: String(rule.type),
              partId: trigger.partId,
              itemKeys: sortedSet(invalidKeys),
            },
          );
        }
        return;
      }
      const forbidden = rule.type === 'requires'
        ? setDifference(index.domainKeysByPart.get(targetPart.key) || new Set(), targetKeys)
        : targetKeys;
      addProjectionRuleProduct(
        state,
        triggerPart.key,
        triggerKeys,
        targetPart.key,
        forbidden,
        { kind: String(rule.type), ruleId: String(rule.id) },
      );
    });
  });
}

function projectionRuleSort(left, right) {
  return compareText(left.leftPartKey, right.leftPartKey)
    || compareText(left.leftItemKey, right.leftItemKey)
    || compareText(left.rightPartKey, right.rightPartKey)
    || compareText(left.rightItemKey, right.rightItemKey);
}

/**
 * Compile Maker v5 into a lossless authorization/color projection for the
 * current pairwise-exclusion Move model. This compiler is intentionally pure:
 * it contains no Walrus locations and either returns complete coverage or
 * throws before producing a partial summary.
 */
function compilePreparedMakerV4MoveProjectionV2(document) {
  validateMakerV4Document(document, { mode: 'publish' });
  const embeddedExpansion = normalizeEmbeddedExpansionPublication(
    document,
    document?.extensions,
    embeddedContainerManifestIdentifier(document),
  );
  const index = projectionV2Index(document);
  if (index.parts.length > MOVE_MAX_PARTS) {
    throw new MakerV4PublicationError(
      `The Move projection contains more than ${MOVE_MAX_PARTS} Parts.`,
      'move-part-limit',
      { count: index.parts.length },
    );
  }
  if (index.items.length > MOVE_MAX_ITEMS) {
    throw new MakerV4PublicationError(
      `The Move projection contains more than ${MOVE_MAX_ITEMS} Items.`,
      'move-item-limit',
      { count: index.items.length },
    );
  }

  const state = { rules: [], seen: new Set() };
  orderedParts(document).forEach((part) => {
    const path = projectionOwnerPath(part);
    const activationClauses = [];
    const parentClause = projectParentActivation(state, part, index, `${path}.parentPartId`);
    if (parentClause) activationClauses.push(parentClause);
    activationClauses.push(...projectVisibilityCondition(
      state,
      { part },
      part.visibleWhen,
      index,
      `${path}.visibleWhen`,
    ));
    projectRequiredConditionalSentinel(state, part, index, activationClauses, path);

    orderedItems(part).forEach((item) => {
      const itemPath = projectionOwnerPath(part, item);
      projectVisibilityCondition(
        state,
        { part, item },
        item.visibleWhen,
        index,
        `${itemPath}.visibleWhen`,
      );
      orderedStyles(item).forEach((style) => {
        const stylePath = projectionOwnerPath(part, item, style);
        projectVisibilityCondition(
          state,
          { part, item, style },
          style.visibleWhen,
          index,
          `${stylePath}.visibleWhen`,
        );
      });
    });
  });
  projectEmbeddedRules(state, document, index);
  state.rules.sort(projectionRuleSort);

  const commerceProjection = compileMakerCommerceProjectionV5(
    document,
    embeddedExpansion.descriptors,
    index.items,
  );
  const projectionItems = commerceProjection.items;
  const requiresAuxiliary = projectionItems.some((item) => item.renderAsset === false);
  const singlePublishRecords = (index.parts.length * 2) + index.items.length + state.rules.length;
  const auxiliaryIdentifierConflict = requiresAuxiliary
    ? asArray(document?.assets).find((asset) => (
      String(asset?.identifier || '') === MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER
    ))
    : null;
  if (auxiliaryIdentifierConflict) {
    throw new MakerV4PublicationError(
      'A normal Maker Asset uses the reserved projection auxiliary identifier.',
      'reserved-projection-auxiliary-identifier',
      {
        assetId: String(auxiliaryIdentifierConflict.id || ''),
        identifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
      },
    );
  }
  const mappings = clone(index.mappings);
  if (commerceProjection.commerce) {
    mappings.packBindings = clone(commerceProjection.bindings);
  }
  return {
    schemaVersion: MAKER_V4_MOVE_PROJECTION_V2_SCHEMA,
    itemKeyEncoding: MAKER_V4_ITEM_KEY_ENCODING_V2,
    recipeEncoding: 'sui.recipe-slot.v1',
    renderOrderSemantics: 'canonical-recipe-order.v1',
    neutralColor: MAKER_V4_NEUTRAL_COLOR,
    authorizationCoverage: 'complete',
    colorCoverage: 'complete',
    expansionRuntime: embeddedExpansion.descriptors.length
      ? {
        kind: 'embedded',
        runtime: MAKER_V4_EMBEDDED_EXPANSION_RUNTIME,
        container: MAKER_V4_EMBEDDED_EXPANSION_CONTAINER,
        coverage: 'complete',
      }
      : null,
    expansionPacks: embeddedExpansion.descriptors.map((pack) => sanitizeExpansionPack(
      pack,
      embeddedContainerManifestIdentifier(document),
    )),
    ...(commerceProjection.commerce
      ? { commerce: clone(commerceProjection.commerce) }
      : {}),
    auxiliary: {
      identifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
      kind: 'chain-auxiliary',
      mediaType: 'image/png',
      projectionOnly: true,
      renderAsset: false,
      required: requiresAuxiliary,
    },
    parts: index.parts.map(({ source, ...part }) => clone(part)),
    items: projectionItems,
    rules: clone(state.rules),
    paletteLinks: [],
    mappings,
    counts: {
      parts: index.parts.length,
      items: index.items.length,
      rules: state.rules.length,
      recipeSlots: index.parts.length,
      singlePublishRecords,
      ...(commerceProjection.commerce
        ? {
          commercePacks: commerceProjection.commerce.counts.packs,
          commerceItemPackBindings:
            commerceProjection.commerce.counts.itemPackBindings,
          commerceStyles: commerceProjection.commerce.counts.styles,
        }
        : {}),
    },
  };
}

export function compileMakerV4MoveProjectionV2(document, options = {}) {
  const projection = compilePreparedMakerV4MoveProjectionV2(
    prepareMakerV4ProjectionV2Document(document),
  );
  const logicalAuxiliaryBlobId = String(
    options.logicalAuxiliaryBlobId
      ?? document?.moveProjectionV2?.commerce?.logicalAuxiliaryBlobId
      ?? '',
  ).trim();
  if (projection.commerce && logicalAuxiliaryBlobId) {
    projection.commerce.logicalAuxiliaryBlobId = logicalAuxiliaryBlobId;
  }
  return projection;
}

/** Enforce the current one-PTB publication record budget before Walrus spend. */
export function assertMakerV4ProjectionV2SinglePublishBudget(
  projection,
  maximum = MAKER_V4_MAX_SINGLE_PUBLISH_RECORDS,
) {
  const limit = Number(maximum);
  const parts = Number(projection?.counts?.parts || 0);
  const items = Number(projection?.counts?.items || 0);
  const rules = Number(projection?.counts?.rules || 0);
  const paletteLinks = Number(asArray(projection?.paletteLinks).length);
  const totalRecords = (parts * 2) + items + rules + paletteLinks;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new MakerV4PublicationError(
      'The single-publication record budget is invalid.',
      'invalid-single-publish-record-limit',
      { maximum },
    );
  }
  if (totalRecords > limit) {
    throw new MakerV4PublicationError(
      `The Maker needs ${totalRecords} on-chain records, above the single-transaction limit of ${limit}.`,
      'single-publish-record-limit',
      {
        count: totalRecords,
        maximum: limit,
        parts,
        colors: parts,
        items,
        rules,
        paletteLinks,
      },
    );
  }
  return totalRecords;
}

/**
 * Mark the single reusable transparent PNG used by projection-only None and
 * ColorChannel Items. It is never a normal Maker render asset.
 */
export function createMakerV4ProjectionV2AuxiliaryEntry(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new MakerV4PublicationError(
      'The projection auxiliary PNG Blob/File is missing.',
      'missing-projection-auxiliary',
    );
  }
  if (String(blob.type || '').toLowerCase() !== 'image/png') {
    throw new MakerV4PublicationError(
      'The projection auxiliary asset must have MIME type image/png.',
      'invalid-projection-auxiliary',
      { mediaType: String(blob.type || '') },
    );
  }
  return {
    blob,
    identifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
    kind: 'chain-auxiliary',
    assetId: null,
    projectionOnly: true,
    renderAsset: false,
  };
}

function assetById(document) {
  const result = new Map(asArray(document?.assets).map((asset) => [String(asset?.id || ''), asset]));
  asArray(document?.extensions?.expansionDrafts).forEach((pack) => {
    asArray(pack?.assets).forEach((asset) => {
      const assetId = String(asset?.id || '');
      if (assetId && !result.has(assetId)) result.set(assetId, asset);
    });
  });
  return result;
}

/** Return every asset referenced by the immutable Maker graph. */
export function collectReferencedMakerV4AssetIds(document) {
  const ids = new Set();
  if (document?.metadata?.coverAssetId) ids.add(String(document.metadata.coverAssetId));
  orderedTracks(document).forEach((track) => {
    if (track.referenceAssetId) ids.add(String(track.referenceAssetId));
  });
  orderedParts(document).forEach((part) => {
    if (part.iconAssetId) ids.add(String(part.iconAssetId));
    orderedItems(part).forEach((item) => {
      if (item.thumbnailAssetId) ids.add(String(item.thumbnailAssetId));
      orderedStyles(item).forEach((style) => {
        if (style.assetId) ids.add(String(style.assetId));
      });
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
  const source = String(asset.source || '');
  const provenance = asset.kind === 'maker-cover'
    ? (
        ['generated-release', 'generated-release-preflight'].includes(source)
          ? 'generated'
          : 'creator-upload'
      )
    : '';
  return {
    id: String(asset.id || ''),
    identifier: String(asset.identifier || ''),
    kind: String(asset.kind || ''),
    mediaType: String(asset.mediaType || ''),
    width: asset.width ?? null,
    height: asset.height ?? null,
    ...(provenance ? { provenance } : {}),
    ...(asset.contentHash ? { contentHash: String(asset.contentHash) } : {}),
    ...(asset.digest ? { digest: String(asset.digest) } : {}),
  };
}

function sanitizeStyle(style) {
  return {
    id: String(style.id || ''),
    name: String(style.name || ''),
    displayOrder: Number(style.displayOrder),
    assetId: String(style.assetId || ''),
    layerTrackId: String(style.layerTrackId || ''),
    colorChannelId: style.colorChannelId ?? null,
    transform: {
      x: Number(style.transform?.x || 0),
      y: Number(style.transform?.y || 0),
      scale: Number(style.transform?.scale ?? 1),
      rotation: Number(style.transform?.rotation || 0),
    },
    positionConfirmed: style.positionConfirmed === true,
    positionLocked: style.positionLocked === true,
    styleLocked: style.styleLocked === true,
    opacity: Number(style.opacity),
    blendMode: String(style.blendMode || 'normal'),
    visibleWhen: clone(style.visibleWhen ?? null),
    requires: clone(asArray(style.requires)),
    excludes: clone(asArray(style.excludes)),
  };
}

function sanitizeItem(item) {
  return {
    id: String(item.id || ''),
    name: String(item.name || ''),
    displayOrder: Number(item.displayOrder),
    importKey: String(item.importKey || item.id || ''),
    status: 'public',
    thumbnailAssetId: item.thumbnailAssetId ?? null,
    visibleWhen: clone(item.visibleWhen ?? null),
    requires: clone(asArray(item.requires)),
    excludes: clone(asArray(item.excludes)),
    defaultStyleId: item.defaultStyleId ?? null,
    styles: orderedStyles(item).map(sanitizeStyle),
  };
}

function sanitizePart(part) {
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
    items: orderedItems(part).map(sanitizeItem),
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

function expansionPackId(pack) {
  return String(pack?.packId || pack?.id || '');
}

function sanitizeEmbeddedExpansionDraft(pack) {
  const copy = clone(pack) || {};
  const packId = expansionPackId(copy);
  delete copy.id;
  delete copy.manifestIdentifier;
  delete copy.runtime;
  delete copy.assetsById;
  copy.packId = packId;
  copy.assets = asArray(copy.assets).map(sanitizeAsset)
    .sort((left, right) => compareText(left.identifier, right.identifier) || compareText(left.id, right.id));
  copy.layerTracks = asArray(copy.layerTracks).map((track) => {
    const sanitized = clone(track) || {};
    delete sanitized.transform;
    return sanitized;
  });
  return copy;
}

function sanitizePlayerExportPublicationExtension(document) {
  const backgroundPartIds = document?.extensions?.playerExport?.backgroundPartIds;
  if (!Array.isArray(backgroundPartIds)) return null;
  return {
    backgroundPartIds: [...backgroundPartIds],
  };
}

function normalizeEmbeddedExpansionPublication(document, publicExtensions, manifestIdentifier) {
  const suppliedExtensions = jsonObject(publicExtensions);
  const documentDrafts = asArray(document?.extensions?.expansionDrafts);
  const drafts = (Array.isArray(document?.extensions?.expansionDrafts)
    ? documentDrafts
    : asArray(suppliedExtensions.expansionDrafts))
    .map(sanitizeEmbeddedExpansionDraft);
  const seen = new Set();
  drafts.forEach((pack) => {
    if (!pack.packId) {
      throw new MakerV4PublicationError(
        'Every embedded ExpansionPack needs a stable packId.',
        'missing-embedded-expansion-pack-id',
      );
    }
    if (seen.has(pack.packId)) {
      throw new MakerV4PublicationError(
        `Embedded ExpansionPack "${pack.packId}" is declared more than once.`,
        'duplicate-embedded-expansion-pack',
        { packId: pack.packId },
      );
    }
    seen.add(pack.packId);
  });

  const metadata = new Map(asArray(document?.expansionPacks)
    .map((pack) => [expansionPackId(pack), pack])
    .filter(([id]) => Boolean(id)));
  const dangling = [...metadata.keys()].filter((id) => !seen.has(id));
  if (dangling.length) {
    throw new MakerV4PublicationError(
      `ExpansionPack metadata has no embedded content: ${dangling.join(', ')}.`,
      'missing-embedded-expansion-draft',
      { packIds: dangling },
    );
  }

  const descriptors = drafts.map((draft) => {
    const pack = metadata.get(draft.packId) || {};
    const numericVersion = Number(pack.version);
    const baseVersion = Number(pack.baseMakerVersion ?? draft.baseMakerVersion ?? draft.baseVersion);
    return {
      id: draft.packId,
      name: String(pack.name || draft.name || draft.packId),
      namespace: String(draft.namespace || ''),
      version: Number.isInteger(numericVersion) && numericVersion > 0 ? numericVersion : 1,
      // Backwards-compatible field, now pointing at the real containing
      // manifest rather than a non-existent expansions/<pack>.json file.
      manifestIdentifier,
      content: {
        kind: 'embedded',
        runtime: MAKER_V4_EMBEDDED_EXPANSION_RUNTIME,
        container: MAKER_V4_EMBEDDED_EXPANSION_CONTAINER,
        packId: draft.packId,
      },
      baseMakerId: String(pack.baseMakerId || draft.baseMakerId || document?.version?.rootMakerId || ''),
      baseMakerVersion: Number.isInteger(baseVersion) && baseVersion > 0
        ? baseVersion
        : Number(document?.version?.number || 0),
      required: Boolean(pack.required),
    };
  });

  // Publication extensions are an explicit allowlist. In particular, never
  // copy arbitrary editor/private extension data from either the document or
  // caller-supplied options into the immutable Walrus manifest.
  const extensions = {};
  const playerExport = sanitizePlayerExportPublicationExtension(document);
  if (playerExport) extensions.playerExport = playerExport;
  if (drafts.length) {
    extensions.expansionRuntime = MAKER_V4_EMBEDDED_EXPANSION_RUNTIME;
    extensions.expansionContainer = MAKER_V4_EMBEDDED_EXPANSION_CONTAINER;
    extensions.expansionDrafts = drafts;
  }
  return { descriptors, drafts, extensions };
}

function embeddedContainerManifestIdentifier(document) {
  const descriptor = asArray(document?.expansionPacks).find((pack) => (
    pack?.content?.kind === 'embedded'
    && pack?.manifestIdentifier
  ));
  return String(descriptor?.manifestIdentifier || MAKER_V4_MANIFEST_IDENTIFIER);
}

function sanitizeExpansionPack(pack, manifestIdentifier = MAKER_V4_MANIFEST_IDENTIFIER) {
  return {
    id: String(pack.id || ''),
    name: String(pack.name || ''),
    namespace: String(pack.namespace || ''),
    version: Number(pack.version),
    manifestIdentifier: String(manifestIdentifier),
    content: {
      kind: 'embedded',
      runtime: MAKER_V4_EMBEDDED_EXPANSION_RUNTIME,
      container: MAKER_V4_EMBEDDED_EXPANSION_CONTAINER,
      packId: String(pack.id || ''),
    },
    baseMakerId: String(pack.baseMakerId || ''),
    baseMakerVersion: Number(pack.baseMakerVersion),
    required: Boolean(pack.required),
  };
}

function packProvenanceId(value) {
  return String(value?.expansionPackId ?? value?.packId ?? '');
}

function sanitizeCompletionPolicyV5(policy = {}) {
  return {
    mode: String(policy.mode || ''),
    freeQuotaPerWallet: Number(policy.freeQuotaPerWallet || 0),
    priceAtomic: Number(policy.priceAtomic || 0),
    totalCap: policy.totalCap === null ? null : Number(policy.totalCap),
  };
}

function immutableProtocolCommerceV5() {
  return {
    enabled: Boolean(DEFAULT_PROTOCOL_COMMERCE_V5.enabled),
    primaryContentFeeBps: Number(
      DEFAULT_PROTOCOL_COMMERCE_V5.primaryContentFeeBps,
    ),
    fixedCompleteFeeAtomic: Number(
      DEFAULT_PROTOCOL_COMMERCE_V5.fixedCompleteFeeAtomic,
    ),
    makerMarketFeeBps: Number(
      DEFAULT_PROTOCOL_COMMERCE_V5.makerMarketFeeBps,
    ),
    soulMarketFeeBps: Number(
      DEFAULT_PROTOCOL_COMMERCE_V5.soulMarketFeeBps,
    ),
  };
}

function sanitizeMakerCommerceV5(
  commerce,
  packIds,
  { licenseSnapshotRoyaltyBps = null } = {},
) {
  if (commerce === undefined || commerce === null) return null;
  const declaredPackIds = [...new Set(asArray(packIds).map(String).filter(Boolean))]
    .sort(compareText);
  const sourceIssues = collectMakerCommerceV5Issues(commerce, {
    packIds: declaredPackIds,
    publish: false,
  });
  if (sourceIssues.length) {
    throw new MakerV4PublicationError(
      'The Maker Commerce & Rights declaration is not publishable.',
      'invalid-maker-commerce-v5',
      { issues: clone(sourceIssues) },
    );
  }
  const normalized = normalizeMakerCommerceV5(commerce, {
    packIds: declaredPackIds,
  });
  const normalizedIssues = collectMakerCommerceV5Issues(normalized, {
    packIds: declaredPackIds,
    // A v4 Manifest may be prepared while Commerce v5 is release-gated.
    // Preserve the acknowledgement bit in the immutable projection and let
    // the Commerce v5 deployment preflight require it before migration.
    publish: false,
  });
  if (normalizedIssues.length) {
    throw new MakerV4PublicationError(
      'The normalized Maker Commerce & Rights declaration is not publishable.',
      'invalid-maker-commerce-v5',
      { issues: clone(normalizedIssues) },
    );
  }
  if (licenseSnapshotRoyaltyBps !== null
    && Number(normalized.makerSourceRoyaltyBps || 0) !== Number(licenseSnapshotRoyaltyBps || 0)) {
    throw new MakerV4PublicationError(
      'The Maker-source resale royalty must match the immutable license snapshot royalty.',
      'maker-source-royalty-mismatch',
      {
        makerSourceRoyaltyBps: Number(normalized.makerSourceRoyaltyBps || 0),
        licenseSnapshotRoyaltyBps: Number(licenseSnapshotRoyaltyBps || 0),
      },
    );
  }
  return {
    schemaVersion: MAKER_COMMERCE_V5_SCHEMA,
    rightsOrigin: String(normalized.rightsOrigin),
    rightsOriginConfirmed: normalized.rightsOriginConfirmed === true,
    makerAccess: {
      mode: String(normalized.makerAccess.mode),
      purchasePriceAtomic: Number(normalized.makerAccess.purchasePriceAtomic || 0),
    },
    baseCompletion: sanitizeCompletionPolicyV5(normalized.baseCompletion),
    packPolicies: [...normalized.packPolicies]
      .map((policy) => ({
        packId: String(policy.packId),
        accessMode: String(policy.accessMode),
        purchasePriceAtomic: Number(policy.purchasePriceAtomic || 0),
        completion: sanitizeCompletionPolicyV5(policy.completion),
      }))
      .sort((left, right) => compareText(left.packId, right.packId)),
    soulCreatorRoyaltyBps: Number(normalized.soulCreatorRoyaltyBps || 0),
    makerSourceRoyaltyBps: Number(normalized.makerSourceRoyaltyBps || 0),
    makerResaleRoyaltyBps: Number(normalized.makerResaleRoyaltyBps || 0),
    protocol: immutableProtocolCommerceV5(),
  };
}

function stylePackProvenanceByTuple(document) {
  const result = new Map();
  orderedParts(document).forEach((part) => {
    const partPackId = packProvenanceId(part);
    orderedItems(part).forEach((item) => {
      const itemPackId = packProvenanceId(item) || partPackId;
      orderedStyles(item).forEach((style) => {
        const stylePackId = packProvenanceId(style);
        const requiredPackIds = [...new Set([
          itemPackId,
          stylePackId,
        ].filter(Boolean))].sort(compareText);
        result.set(tupleKey(part.id, item.id, style.id), {
          sourcePartPackId: partPackId || null,
          sourceItemPackId: itemPackId || null,
          sourceStylePackId: stylePackId || null,
          selectedStylePackId: stylePackId || itemPackId || null,
          requiredPackIds,
        });
      });
    });
  });
  return result;
}

function compileMakerCommerceProjectionV5(document, descriptors, projectionItems) {
  if (document?.commerce === undefined || document?.commerce === null) {
    return {
      commerce: null,
      items: projectionItems.map(clone),
      bindings: [],
    };
  }
  const orderedDescriptors = [...asArray(descriptors)]
    .map((descriptor) => sanitizeExpansionPack(
      descriptor,
      embeddedContainerManifestIdentifier(document),
    ))
    .sort((left, right) => compareText(left.id, right.id));
  const packIds = orderedDescriptors.map((descriptor) => descriptor.id);
  const commerce = sanitizeMakerCommerceV5(document.commerce, packIds);
  const policies = new Map(commerce.packPolicies.map((policy) => [policy.packId, policy]));
  const provenance = stylePackProvenanceByTuple(document);
  const bindings = [];
  const items = projectionItems.map((item) => {
    if (item.projectionKind !== 'style') return clone(item);
    const record = provenance.get(tupleKey(
      item.sourcePartId,
      item.sourceItemId,
      item.sourceStyleId,
    )) || {
      sourcePartPackId: null,
      sourceItemPackId: null,
      sourceStylePackId: null,
      selectedStylePackId: null,
      requiredPackIds: [],
    };
    const unknownPackIds = record.requiredPackIds.filter((packId) => !policies.has(packId));
    if (unknownPackIds.length) {
      throw new MakerV4PublicationError(
        'Projected Maker content references an undeclared Expansion Pack commerce policy.',
        'missing-projected-pack-commerce-policy',
        {
          partId: item.sourcePartId,
          itemId: item.sourceItemId,
          styleId: item.sourceStyleId,
          packIds: unknownPackIds,
        },
      );
    }
    if (record.requiredPackIds.length > 1) {
      throw new MakerV4PublicationError(
        'One projected Style cannot belong to more than one Expansion Pack.',
        'ambiguous-style-pack-provenance',
        {
          partId: item.sourcePartId,
          itemId: item.sourceItemId,
          styleId: item.sourceStyleId,
          packIds: record.requiredPackIds,
        },
      );
    }
    record.requiredPackIds.forEach((packId) => {
      const sources = [
        record.sourcePartPackId === packId ? 'part' : '',
        record.sourceItemPackId === packId ? 'item' : '',
        record.sourceStylePackId === packId ? 'style' : '',
      ].filter(Boolean);
      bindings.push({
        packId,
        partKey: String(item.partKey),
        itemKey: String(item.itemKey),
        sourcePartId: String(item.sourcePartId),
        sourceItemId: String(item.sourceItemId),
        sourceStyleId: String(item.sourceStyleId),
        sources,
      });
    });
    const paidAddon = record.requiredPackIds.some((packId) => (
      policies.get(packId)?.accessMode === PACK_ACCESS_MODES.ONE_TIME_PAID
    ));
    return {
      ...clone(item),
      gateKind: paidAddon ? 1 : 0,
      ...record,
    };
  });
  bindings.sort((left, right) => (
    compareText(left.packId, right.packId)
    || compareText(left.partKey, right.partKey)
    || compareText(left.itemKey, right.itemKey)
    || compareText(left.sourceStyleId, right.sourceStyleId)
  ));
  const styleProducts = items.map((item) => {
    let styleKey;
    let rowKind;
    if (item.projectionKind === 'style') {
      styleKey = String(item.sourceStyleId || '');
      rowKind = MAKER_V4_COMMERCE_STYLE_ROW_V5.VISUAL;
    } else if (item.projectionKind === 'none') {
      styleKey = MAKER_V4_NONE_STYLE_KEY_V5;
      rowKind = MAKER_V4_COMMERCE_STYLE_ROW_V5.LOGICAL_NONE;
    } else if (item.projectionKind === 'color-swatch') {
      styleKey = `${MAKER_V4_COLOR_STYLE_KEY_PREFIX_V5}${String(item.sourceSwatchId || '')}`;
      rowKind = MAKER_V4_COMMERCE_STYLE_ROW_V5.LOGICAL_COLOR;
    } else {
      throw new MakerV4PublicationError(
        'The Commerce v5 Style registry found an unsupported projected Item.',
        'unsupported-commerce-style-product',
        { item: clone(item) },
      );
    }
    if (!styleKey) {
      throw new MakerV4PublicationError(
        'Every Commerce v5 projected Item must have a deterministic Style key.',
        'missing-commerce-style-key',
        { item: clone(item) },
      );
    }
    return {
      partKey: String(item.partKey),
      itemKey: String(item.itemKey),
      styleKey,
      packId: item.projectionKind === 'style'
        ? String(item.selectedStylePackId || '') || null
        : null,
      // Move derives Seal protection from the verified row kind plus the
      // immutable Base/Pack access policy. Publication never supplies a
      // caller-controlled protection boolean.
      rowKind,
    };
  }).sort((left, right) => (
    compareText(left.partKey, right.partKey)
    || compareText(left.itemKey, right.itemKey)
    || compareText(left.styleKey, right.styleKey)
  ));
  const descriptorById = new Map(orderedDescriptors.map((descriptor) => [
    descriptor.id,
    descriptor,
  ]));
  return {
    commerce: {
      schemaVersion: MAKER_V4_COMMERCE_PROJECTION_V5_SCHEMA,
      sourceSchemaVersion: commerce.schemaVersion,
      rightsOrigin: commerce.rightsOrigin,
      rightsOriginConfirmed: commerce.rightsOriginConfirmed === true,
      makerAccess: clone(commerce.makerAccess),
      baseCompletion: clone(commerce.baseCompletion),
      packPolicies: commerce.packPolicies.map((policy) => ({
        ...clone(policy),
        label: String(descriptorById.get(policy.packId)?.name || policy.packId),
      })),
      royalties: {
        soulCreatorBps: commerce.soulCreatorRoyaltyBps,
        makerSourceBps: commerce.makerSourceRoyaltyBps,
        makerResaleBps: commerce.makerResaleRoyaltyBps,
      },
      protocol: clone(commerce.protocol),
      itemPackBindings: clone(bindings),
      styleProducts: clone(styleProducts),
      counts: {
        packs: commerce.packPolicies.length,
        itemPackBindings: bindings.length,
        styles: styleProducts.length,
      },
    },
    items,
    bindings,
    styleProducts,
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
    const styles = defaultItem ? orderedStyles(defaultItem) : [];
    const defaultStyle = styles.find((style) => style.id === defaultItem?.defaultStyleId) || styles[0];
    const orderedOwners = [
      ...(defaultStyle ? [defaultStyle] : []),
      ...orderedItems(part).flatMap((item) => orderedStyles(item)).filter((style) => style !== defaultStyle),
    ];
    const allColorChannelIds = [...new Set(orderedOwners
      .map((style) => String(style.colorChannelId || ''))
      .filter((channelId) => channelById.has(channelId)))];
    const primaryStyle = orderedOwners
      .find((style) => style.colorChannelId && channelById.has(String(style.colorChannelId)));
    const primaryColorChannelId = primaryStyle ? String(primaryStyle.colorChannelId) : null;
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
      `The Move summary contains more than ${MOVE_MAX_ITEMS} Item/Style records.`,
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
        styleId: String(record.style.id),
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
  document = clone(document);
  assertNoUnresolvedLegacyRuleRecovery(document);
  const legacyRuleMigration = migrateLegacyMakerRules(document);
  if (legacyRuleMigration.unresolved.length) {
    throw new MakerV4PublicationError(
      'Legacy Maker rules could not be mapped to one Part, Item, or Style owner.',
      'unresolved-legacy-maker-rules',
      { rules: legacyRuleMigration.unresolved },
    );
  }
  validateMakerV4Document(document, { mode: 'publish' });
  const manifestIdentifier = String(options.manifestIdentifier || MAKER_V4_MANIFEST_IDENTIFIER);
  const embeddedExpansion = normalizeEmbeddedExpansionPublication(
    document,
    options.publicExtensions,
    manifestIdentifier,
  );
  const commerce = sanitizeMakerCommerceV5(
    document.commerce,
    embeddedExpansion.descriptors.map((pack) => pack.id),
    {
      licenseSnapshotRoyaltyBps: document.publication?.royaltyBps,
    },
  );
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
  const immutableAssets = assetById(document);
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
    layerTracks: tracks.map((track) => ({
      id: String(track.id),
      name: String(track.name),
      order: Number(track.order),
      locked: track.locked !== false,
      referenceAssetId: track.referenceAssetId ?? null,
    })),
    colorChannels: colors.map(sanitizeChannel),
    parts: orderedParts(document).map(sanitizePart),
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
    expansionPacks: embeddedExpansion.descriptors.map((pack) => sanitizeExpansionPack(pack, manifestIdentifier)),
    assets: [...referenced].map((assetId) => immutableAssets.get(assetId)).filter(Boolean).map(sanitizeAsset)
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
    ...(commerce ? { commerce } : {}),
    // These containers are required by the v4 schema. They intentionally do
    // not inherit editor endpoints, local recovery data or Blob/Object URLs.
    runtime: {},
    livingContent: clone(document.livingContent ?? null),
    release,
    legacyMoveProjection: releaseProjection(document),
    extensions: embeddedExpansion.extensions,
  };
  manifest.moveProjectionV2 = compileMakerV4MoveProjectionV2(manifest, {
    logicalAuxiliaryBlobId: options.logicalAuxiliaryBlobId,
  });
  assertMakerV4ProjectionV2SinglePublishBudget(manifest.moveProjectionV2);
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
  const renderAssetEntries = collectMakerV4UploadEntries(document, runtimeAssets, { ...options, manifestIdentifier });
  const auxiliaryEntry = manifest.moveProjectionV2?.auxiliary?.required
    ? createMakerV4ProjectionV2AuxiliaryEntry(options.projectionAuxiliaryBlob)
    : null;
  const assetEntries = [
    ...renderAssetEntries,
    ...(auxiliaryEntry ? [auxiliaryEntry] : []),
  ];
  const projectedFileCount = assetEntries.length + 1;
  if (projectedFileCount > 5_000) {
    throw new MakerV4PublicationError(
      'The Maker, v2 auxiliary PNG, and Manifest exceed the 5,000-file Walrus quilt limit.',
      'walrus-quilt-file-limit',
      { count: projectedFileCount, maximum: 5_000 },
    );
  }
  const manifestBlob = new Blob([manifestJson], { type: 'application/json' });
  return {
    manifest,
    manifestJson,
    manifestIdentifier,
    assetEntries,
    renderAssetEntries,
    auxiliaryEntry,
    entries: [
      ...assetEntries,
      { blob: manifestBlob, identifier: manifestIdentifier, kind: 'maker-manifest', assetId: null },
    ],
    release: manifest.release,
    projection: manifest.moveProjectionV2,
    legacyProjection: manifest.legacyMoveProjection,
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

function primaryStyleAssetId(record) {
  return String(record.style.assetId || '');
}

function selectorSummaryKeys(selector, index) {
  const partId = String(selector?.partId || '');
  if (!selector?.itemId) return [''];
  const matches = index.items.records.filter((record) => (
    record.part.id === partId
    && record.item.id === selector.itemId
    && (!selector.styleId || record.style.id === selector.styleId)
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
      orderedStyles(item).forEach((style) => {
        if (style.visibleWhen) unrepresentedRules.push({ code: 'visible-when-retained-on-walrus', path: `parts.${part.id}.items.${item.id}.styles.${style.id}.visibleWhen` });
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

function quiltPatchLocationValue(locations, assetId) {
  const record = locations instanceof Map ? locations.get(assetId) : jsonObject(locations)[assetId];
  if (typeof record === 'string') return record;
  return String(record?.patchId || record?.quiltPatchId || record?.walrusPatchId || record?.id || '');
}

function directQuiltPatchLocationValue(record) {
  if (typeof record === 'string') return record;
  return String(record?.patchId || record?.quiltPatchId || record?.walrusPatchId || record?.id || '');
}

function assertStoredMoveProjectionV2(document, projection) {
  if (!document?.moveProjectionV2
    || JSON.stringify(document.moveProjectionV2) === JSON.stringify(projection)) return;
  throw new MakerV4PublicationError(
    'The immutable Manifest v2 projection does not match the recomputed Maker graph.',
    'move-projection-v2-manifest-mismatch',
    {
      storedSchema: String(document.moveProjectionV2.schemaVersion || ''),
      computedSchema: projection.schemaVersion,
    },
  );
}

/**
 * Resolve the pure v2 projection to the existing `publishMaker()` arguments.
 * Every Item receives a certified Walrus quilt-patch id. None and Smart Color
 * Items deliberately reuse one transparent projection-only patch.
 */
export function buildMakerV4MoveSummaryV2(document, options = {}) {
  const projection = compileMakerV4MoveProjectionV2(document, options);
  assertStoredMoveProjectionV2(document, projection);
  const totalRecords = assertMakerV4ProjectionV2SinglePublishBudget(
    projection,
    options.maxSinglePublishRecords ?? MAKER_V4_MAX_SINGLE_PUBLISH_RECORDS,
  );
  const auxiliaryRecord = options.auxiliaryLocation;
  if (auxiliaryRecord && typeof auxiliaryRecord === 'object') {
    if (auxiliaryRecord.identifier
      && String(auxiliaryRecord.identifier) !== MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER) {
      throw new MakerV4PublicationError(
        'The Walrus auxiliary location belongs to a different quilt identifier.',
        'invalid-projection-auxiliary-location',
        {
          expectedIdentifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
          identifier: String(auxiliaryRecord.identifier),
        },
      );
    }
    if (auxiliaryRecord.renderAsset === true || auxiliaryRecord.projectionOnly === false) {
      throw new MakerV4PublicationError(
        'The Walrus auxiliary location is not marked as projection-only.',
        'invalid-projection-auxiliary-location',
      );
    }
  }
  const auxiliaryPatchId = directQuiltPatchLocationValue(auxiliaryRecord);
  if (projection.auxiliary.required && !auxiliaryPatchId) {
    throw new MakerV4PublicationError(
      'The certified Walrus quilt-patch location for the projection auxiliary PNG is missing.',
      'missing-projection-auxiliary-location',
      { identifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER },
    );
  }
  const logicalAuxiliaryBlobId = String(
    options.logicalAuxiliaryBlobId
      ?? projection?.commerce?.logicalAuxiliaryBlobId
      ?? '',
  ).trim();
  if (projection.commerce && !logicalAuxiliaryBlobId) {
    throw new MakerV4PublicationError(
      'Commerce v5 requires the protocol-bound canonical logical auxiliary Walrus Blob ID.',
      'missing-commerce-v5-logical-auxiliary-blob',
    );
  }
  if (
    projection.commerce
    && auxiliaryPatchId
    && logicalAuxiliaryBlobId === auxiliaryPatchId
  ) {
    throw new MakerV4PublicationError(
      'Commerce v5 logical rows must use the independent protocol Blob, not this Maker Quilt auxiliary patch.',
      'commerce-v5-logical-auxiliary-is-quilt-patch',
    );
  }

  const missingLocations = new Set();
  const items = projection.items.map((item) => {
    let blobId = '';
    if (item.assetRef?.kind === 'maker-style-png') {
      blobId = quiltPatchLocationValue(options.assetLocations, String(item.assetRef.assetId || ''));
      if (!blobId) missingLocations.add(String(item.assetRef.assetId || ''));
    } else if (item.assetRef?.kind === 'projection-auxiliary') {
      blobId = projection.commerce
        ? logicalAuxiliaryBlobId
        : auxiliaryPatchId;
    } else {
      throw new MakerV4PublicationError(
        'A v2 projection Item has an unknown asset reference.',
        'invalid-projection-item-asset',
        { partKey: item.partKey, itemKey: item.itemKey, assetRef: clone(item.assetRef) },
      );
    }
    let iconBlobId = '';
    if (item.iconAssetRef?.assetId) {
      iconBlobId = quiltPatchLocationValue(options.assetLocations, String(item.iconAssetRef.assetId));
      if (!iconBlobId) missingLocations.add(String(item.iconAssetRef.assetId));
    }
    return {
      partKey: item.partKey,
      itemKey: item.itemKey,
      label: item.label,
      blobId,
      iconBlobId,
      gateKind: Number(item.gateKind || 0),
      projectionKind: item.projectionKind,
      sourcePartId: item.sourcePartId ?? null,
      sourceItemId: item.sourceItemId ?? null,
      sourceStyleId: item.sourceStyleId ?? null,
      sourceChannelId: item.sourceChannelId ?? null,
      sourceSwatchId: item.sourceSwatchId ?? null,
      sourceAssetId: item.sourceAssetId ?? null,
      renderAsset: item.renderAsset === true,
      ...(Array.isArray(item.requiredPackIds)
        ? {
          sourcePartPackId: item.sourcePartPackId ?? null,
          sourceItemPackId: item.sourceItemPackId ?? null,
          sourceStylePackId: item.sourceStylePackId ?? null,
          selectedStylePackId: item.selectedStylePackId ?? null,
          requiredPackIds: [...item.requiredPackIds],
        }
        : {}),
    };
  });
  if (missingLocations.size) {
    throw new MakerV4PublicationError(
      `Certified Walrus quilt-patch locations are missing for ${sortedSet(missingLocations).join(', ')}.`,
      'missing-walrus-asset-location',
      { assetIds: sortedSet(missingLocations) },
    );
  }
  if (items.some((item) => !item.blobId)) {
    throw new MakerV4PublicationError(
      'Every v2 projection Item must resolve to one certified Walrus quilt-patch id.',
      'missing-projection-item-location',
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
    parts: projection.parts.map((part) => ({
      key: part.key,
      label: part.label,
      kind: part.kind,
      renderOrder: part.renderOrder,
      menuVisible: part.menuVisible,
      required: true,
      colors: [MAKER_V4_NEUTRAL_COLOR],
      projectionKind: part.projectionKind,
      sourcePartId: part.sourcePartId ?? null,
      sourceChannelId: part.sourceChannelId ?? null,
    })),
    items,
    rules: clone(projection.rules),
    paletteLinks: [],
    authorizationCoverage: 'complete',
    colorCoverage: 'complete',
    singlePublishRecords: totalRecords,
    auxiliary: {
      ...clone(projection.auxiliary),
      patchId: auxiliaryPatchId,
      canonicalBlobId: logicalAuxiliaryBlobId || null,
    },
    ...(projection.commerce
      ? {
        commerce: clone(projection.commerce),
        packBindings: clone(projection.mappings.packBindings || []),
      }
      : {}),
    projection,
    release: buildMakerV4VersionMetadata(document, options.previousDocument || null),
  };
}

/**
 * Flatten Maker v5 definitions to the existing `publishMaker()` arguments.
 * Style ids are encoded into unique legacy Item keys; the full mapping stays
 * in the Walrus manifest.
 */
export function buildMakerV4MoveSummary(document, options = {}) {
  validateMakerV4Document(document, { mode: 'publish' });
  const index = projectionIndex(document);
  if (index.items.records.length > MOVE_MAX_ITEMS) {
    throw new MakerV4PublicationError(`The Move summary contains more than ${MOVE_MAX_ITEMS} Item/Style records.`, 'move-item-limit');
  }
  const missingLocations = [];
  const items = index.items.records.map((record) => {
    const assetId = primaryStyleAssetId(record);
    const blobId = locationValue(options.assetLocations, assetId);
    if (!blobId && options.requireAssetLocations !== false) missingLocations.push(assetId);
    const iconBlobId = record.item.thumbnailAssetId
      ? locationValue(options.assetLocations, String(record.item.thumbnailAssetId))
      : '';
    const styles = orderedStyles(record.item);
    const label = styles.length === 1 || record.isDefault
      ? String(record.item.name)
      : `${record.item.name} · ${record.style.name}`;
    return {
      partKey: String(record.part.id),
      itemKey: record.key,
      label: truncateUtf8(label),
      blobId,
      iconBlobId,
      gateKind: 0,
      sourceItemId: String(record.item.id),
      sourceStyleId: String(record.style.id),
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

function recipeWithExpansionColorDefaults(document, recipe) {
  const result = Array.isArray(recipe)
    ? { selections: clone(recipe), colors: [] }
    : clone(recipe || {});
  const source = result.colors ?? result.colorChannels ?? result.palettes;
  let colors;
  if (Array.isArray(source)) {
    colors = source.map(clone);
  } else {
    colors = Object.entries(jsonObject(source)).map(([channelId, value]) => ({
      channelId,
      swatchId: String(value?.swatchId ?? value?.valueId ?? value?.id ?? value ?? ''),
    }));
  }
  const supplied = new Set(colors
    .map((entry) => String(entry?.channelId || entry?.colorChannelId || entry?.paletteId || ''))
    .filter(Boolean));
  orderedChannels(document).forEach((channel) => {
    if (!channel?.expansionPackId || supplied.has(String(channel.id)) || !channel.defaultSwatchId) return;
    colors.push({ channelId: String(channel.id), swatchId: String(channel.defaultSwatchId) });
    supplied.add(String(channel.id));
  });
  result.colors = colors;
  delete result.colorChannels;
  delete result.palettes;
  return result;
}

function commerceUsageForProjectedRecipe(projection, recipe) {
  if (!projection?.commerce) {
    return { usedPackIds: [], packBindings: [] };
  }
  const mappingByTuple = new Map(asArray(projection?.mappings?.styles).map((mapping) => [
    tupleKey(mapping.partId, mapping.itemId, mapping.styleId),
    mapping,
  ]));
  const selectedProjectionKeys = new Set(asArray(recipe?.selections).flatMap((selection) => {
    const mapping = mappingByTuple.get(tupleKey(
      String(selection?.partId || ''),
      String(selection?.itemId || ''),
      String(selection?.styleId || ''),
    ));
    return mapping ? [`${mapping.partKey}\u0000${mapping.itemKey}`] : [];
  }));
  const packBindings = asArray(projection?.mappings?.packBindings)
    .filter((binding) => selectedProjectionKeys.has(
      `${binding.partKey}\u0000${binding.itemKey}`,
    ))
    .map(clone);
  return {
    usedPackIds: [...new Set(packBindings.map((binding) => String(binding.packId)))]
      .sort(compareText),
    packBindings,
  };
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
  const missingStyles = explicitSelections.flatMap((selection) => {
    const partId = String(selection?.partId || selection?.partKey || '');
    const itemId = String(selection?.itemId || selection?.itemKey || '');
    if (!partId || !itemId) return [];
    const item = orderedItems(partMap.get(partId)).find((candidate) => candidate.id === itemId);
    return item && orderedStyles(item).length && !String(selection?.styleId || selection?.styleKey || '')
      ? [{ partId, itemId }]
      : [];
  });
  if (missingStyles.length) {
    throw new MakerV4PublicationError('Every selected Item must name its Style.', 'missing-recipe-style', { selections: missingStyles });
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
    const item = index.items.byTuple.get(tupleKey(selection.partId, selection.itemId, selection.styleId));
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

/**
 * Flatten a valid full recipe into exactly one neutral Move slot per v2
 * projection Part. Optional/inactive Parts use their private None sentinel;
 * every ColorChannel uses its hidden synthetic swatch Part.
 */
export function flattenMakerV4RecipeV2(document, recipe, options = {}) {
  const projectionDocument = prepareMakerV4ProjectionV2Document(document);
  validateMakerV4Document(projectionDocument, { mode: 'publish' });
  const projectionRecipe = options.fillExpansionColorDefaults === false
    ? recipe
    : recipeWithExpansionColorDefaults(projectionDocument, recipe);
  const explicitSelections = rawRecipeSelections(projectionRecipe);
  const duplicateParts = explicitSelections
    .map((selection) => String(selection?.partId || selection?.partKey || ''))
    .filter((partId, position, values) => partId && values.indexOf(partId) !== position);
  if (duplicateParts.length) {
    throw new MakerV4PublicationError(
      'The recipe selects the same Part more than once.',
      'duplicate-recipe-part',
      { partIds: [...new Set(duplicateParts)] },
    );
  }
  const partMap = new Map(orderedParts(projectionDocument).map((part) => [String(part.id), part]));
  const missingStyles = explicitSelections.flatMap((selection) => {
    const partId = String(selection?.partId || selection?.partKey || '');
    const itemId = String(selection?.itemId || selection?.itemKey || '');
    if (!partId || !itemId) return [];
    const item = orderedItems(partMap.get(partId)).find((candidate) => String(candidate.id) === itemId);
    return item && orderedStyles(item).length && !String(selection?.styleId || selection?.styleKey || '')
      ? [{ partId, itemId }]
      : [];
  });
  if (missingStyles.length) {
    throw new MakerV4PublicationError(
      'Every selected Item must name its Style.',
      'missing-recipe-style',
      { selections: missingStyles },
    );
  }
  const explicitColorEntries = Array.isArray(
    projectionRecipe?.colors ?? projectionRecipe?.colorChannels ?? projectionRecipe?.palettes,
  )
    ? (projectionRecipe.colors ?? projectionRecipe.colorChannels ?? projectionRecipe.palettes)
    : [];
  const duplicateColorChannels = explicitColorEntries
    .map((entry) => String(entry?.channelId || entry?.colorChannelId || entry?.paletteId || ''))
    .filter((channelId, position, values) => channelId && values.indexOf(channelId) !== position);
  if (duplicateColorChannels.length) {
    throw new MakerV4PublicationError(
      'The recipe selects the same ColorChannel more than once.',
      'duplicate-recipe-color-channel',
      { channelIds: [...new Set(duplicateColorChannels)] },
    );
  }
  if (options.requireExplicitColors !== false) {
    const supplied = new Set(rawRecipeColors(projectionRecipe));
    const missingChannels = orderedChannels(projectionDocument)
      .map((channel) => String(channel.id))
      .filter((channelId) => !supplied.has(channelId));
    if (missingChannels.length) {
      throw new MakerV4PublicationError(
        'The recipe is missing explicit ColorChannel selections.',
        'missing-recipe-colors',
        { channelIds: missingChannels },
      );
    }
  }

  const evaluated = evaluateRecipe(projectionDocument, projectionRecipe);
  if (!evaluated.valid) {
    throw new MakerV4PublicationError(
      'The Maker recipe violates Maker constraints.',
      'invalid-maker-recipe',
      { violations: evaluated.violations },
    );
  }
  const projection = compilePreparedMakerV4MoveProjectionV2(projectionDocument);
  assertStoredMoveProjectionV2(document, projection);
  const selections = new Map(asArray(evaluated.documentRecipe.selections)
    .map((selection) => [String(selection.partId), selection]));
  const colors = new Map(asArray(evaluated.documentRecipe.colors)
    .map((color) => [String(color.channelId), String(color.swatchId)]));
  const styleMapping = new Map(projection.mappings.styles.map((mapping) => [
    tupleKey(mapping.partId, mapping.itemId, mapping.styleId),
    mapping,
  ]));
  const noneMapping = new Map(projection.mappings.none.map((mapping) => [mapping.partId, mapping]));
  const channelMapping = new Map(projection.mappings.colorChannels.map((mapping) => [mapping.channelId, mapping]));

  const suiRecipe = projection.parts.map((part) => {
    if (part.projectionKind === 'color-channel') {
      const mapping = channelMapping.get(String(part.sourceChannelId));
      const swatchId = colors.get(String(part.sourceChannelId));
      const swatch = mapping?.swatches.find((candidate) => candidate.swatchId === swatchId);
      if (!swatch) {
        throw new MakerV4PublicationError(
          'A recipe ColorChannel selection is absent from the Move projection.',
          'recipe-color-projection-failed',
          { channelId: part.sourceChannelId, swatchId },
        );
      }
      return {
        partKey: part.key,
        itemKey: swatch.itemKey,
        colorHex: MAKER_V4_NEUTRAL_COLOR,
        renderOrder: part.renderOrder,
      };
    }

    const selection = selections.get(String(part.sourcePartId));
    const mapping = selection
      ? styleMapping.get(tupleKey(selection.partId, selection.itemId, selection.styleId))
      : noneMapping.get(String(part.sourcePartId));
    if (!mapping) {
      throw new MakerV4PublicationError(
        'A recipe Part selection is absent from the Move projection.',
        'recipe-projection-failed',
        { partId: part.sourcePartId, selection: clone(selection || null) },
      );
    }
    return {
      partKey: part.key,
      itemKey: mapping.itemKey,
      colorHex: MAKER_V4_NEUTRAL_COLOR,
      renderOrder: part.renderOrder,
    };
  }).sort((left, right) => left.renderOrder - right.renderOrder || compareText(left.partKey, right.partKey));

  if (suiRecipe.length !== projection.counts.recipeSlots
    || suiRecipe.some((slot, index) => slot.renderOrder !== index)) {
    throw new MakerV4PublicationError(
      'The v2 Move recipe is not a complete contiguous projection.',
      'recipe-projection-incomplete',
      { expected: projection.counts.recipeSlots, actual: suiRecipe.length },
    );
  }
  const commerceUsage = commerceUsageForProjectedRecipe(
    projection,
    evaluated.documentRecipe,
  );
  const styleProductByItem = new Map(asArray(projection?.commerce?.styleProducts).map((entry) => [
    `${entry.partKey}\u0000${entry.itemKey}`,
    entry,
  ]));
  const styleSelections = projection.commerce
    ? suiRecipe.map((slot) => {
      const product = styleProductByItem.get(`${slot.partKey}\u0000${slot.itemKey}`);
      if (!product) {
        throw new MakerV4PublicationError(
          'The Commerce v5 recipe is missing an exact Style registry row.',
          'missing-commerce-style-selection',
          { partKey: slot.partKey, itemKey: slot.itemKey },
        );
      }
      return {
        partKey: String(product.partKey),
        itemKey: String(product.itemKey),
        styleKey: String(product.styleKey),
      };
    })
    : [];
  return {
    fullRecipe: clone(evaluated.documentRecipe),
    fullRecipeJson: JSON.stringify(evaluated.documentRecipe),
    suiRecipe,
    projection,
    usedPackIds: commerceUsage.usedPackIds,
    packBindings: commerceUsage.packBindings,
    styleSelections,
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
  const flattened = flattenMakerV4RecipeV2(document, recipe, { previousDocument });
  const commerce = flattened.projection.commerce
    ? {
      schemaVersion: flattened.projection.commerce.sourceSchemaVersion,
      rightsOrigin: flattened.projection.commerce.rightsOrigin,
      makerAccess: clone(flattened.projection.commerce.makerAccess),
      baseCompletion: clone(flattened.projection.commerce.baseCompletion),
      packPolicies: clone(flattened.projection.commerce.packPolicies)
        .filter((policy) => flattened.usedPackIds.includes(String(policy.packId))),
      royalties: clone(flattened.projection.commerce.royalties),
      protocol: clone(flattened.projection.commerce.protocol),
      usedPackIds: [...flattened.usedPackIds],
      packBindings: clone(flattened.packBindings),
    }
    : null;
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
    ...(commerce ? { commerce } : {}),
    suiSummary: {
      recipeEncoding: 'BCS vector<RecipeSlot>',
      projectionSchema: MAKER_V4_MOVE_PROJECTION_V2_SCHEMA,
      itemKeyEncoding: MAKER_V4_ITEM_KEY_ENCODING_V2,
      recipe: flattened.suiRecipe,
      ...(commerce ? { usedPackIds: [...flattened.usedPackIds] } : {}),
      ...(commerce ? { styleSelections: clone(flattened.styleSelections) } : {}),
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
    usedPackIds: [...flattened.usedPackIds],
    packBindings: clone(flattened.packBindings),
    styleSelections: clone(flattened.styleSelections),
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
    throw new MakerV4PublicationError('A Maker v5 OC package is required.', 'invalid-oc-package');
  }
  const imageIdentifier = options.imageIdentifier || 'animacraft-oc.png';
  const profileIdentifier = options.profileIdentifier || 'animacraft-oc.json';
  const profileBlob = new Blob([JSON.stringify(packageValue)], { type: 'application/json' });
  return [
    { blob: imageBlob, identifier: imageIdentifier, kind: 'oc-image' },
    { blob: profileBlob, identifier: profileIdentifier, kind: 'oc-profile' },
  ];
}
