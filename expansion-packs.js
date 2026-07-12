/**
 * Immutable Maker expansion and update-compatibility utilities.
 *
 * Expansion Packs are runtime overlays. They may add optional Parts, Items,
 * Variants, LayerTracks, palettes, assets and rules, but never replace a base
 * definition. Every pack-owned id is namespaced with `namespace__localId`.
 */

import { collectMakerRules, createMakerRuleIndex, normalizeRuleSelector } from './maker-rules.js';

const PACK_SCHEMA = 'animacraft.expansion-pack.v1';
const SAFE_NAMESPACE = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const SAFE_LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class ExpansionPackError extends Error {
  constructor(message, code = 'invalid-expansion-pack', details = {}) {
    super(message);
    this.name = 'ExpansionPackError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function partIdOf(part) {
  return String(part?.id ?? part?.key ?? '');
}

function itemIdOf(item) {
  return String(item?.id ?? item?.key ?? '');
}

function variantIdOf(variant) {
  return String(variant?.id ?? variant?.key ?? '');
}

function trackIdOf(track) {
  return String(track?.id ?? track?.key ?? '');
}

function paletteIdOf(palette) {
  return String(palette?.id ?? palette?.key ?? '');
}

function makerIdOf(maker) {
  return String(maker?.version?.rootMakerId ?? maker?.makerId ?? maker?.rootMakerId ?? maker?.metadata?.id ?? maker?.id ?? maker?.template?.id ?? '');
}

function makerVersionOf(maker) {
  const version = maker?.version;
  if (version && typeof version === 'object') return String(version.number ?? version.versionId ?? '');
  return String(version ?? maker?.makerVersion ?? maker?.template?.version ?? '');
}

function makerHashOf(maker) {
  return String(maker?.manifestHash ?? maker?.contentHash ?? maker?.template?.manifestHash ?? '');
}

function packIdOf(pack) {
  return String(pack?.packId ?? pack?.id ?? '');
}

function packNamespaceOf(pack) {
  return String(pack?.namespace ?? '');
}

function partsOf(maker) {
  return Array.isArray(maker?.parts) ? maker.parts : [];
}

function packParts(pack) {
  return [...partsOf(pack), ...asArray(pack?.partExtensions)];
}

function itemsOf(part) {
  return Array.isArray(part?.items) ? part.items : [];
}

function variantsOf(item) {
  if (Array.isArray(item?.variants)) return item.variants;
  if (Array.isArray(item?.styles)) return item.styles;
  return [];
}

function bindingsOf(owner) {
  if (Array.isArray(owner?.layerBindings)) return owner.layerBindings;
  if (Array.isArray(owner?.bindings)) return owner.bindings;
  if (Array.isArray(owner?.layers)) return owner.layers;
  return [];
}

function colorsOf(part) {
  return Array.isArray(part?.colors) ? part.colors : [];
}

function isRequired(part) {
  return part?.required === true || part?.allowRemove === false || part?.kind === 'last-bastion';
}

function annotate(value, pack) {
  return {
    ...value,
    expansionPackId: packIdOf(pack),
    expansionNamespace: packNamespaceOf(pack),
  };
}

export function namespaceId(namespace, localId) {
  const ns = String(namespace || '');
  const id = String(localId || '');
  if (!SAFE_NAMESPACE.test(ns)) throw new ExpansionPackError(`Invalid Expansion Pack namespace: ${ns || '(empty)'}.`, 'invalid-pack-namespace');
  if (id.startsWith(`${ns}__`)) return id;
  if (!SAFE_LOCAL_ID.test(id) || id.includes('__')) {
    throw new ExpansionPackError(`Invalid local Expansion Pack id: ${id || '(empty)'}.`, 'invalid-pack-local-id', { namespace: ns, localId: id });
  }
  return `${ns}__${id}`;
}

function parseSemver(version) {
  const match = String(version || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
    prerelease: match[4] || '',
  };
}

export function compareVersions(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return String(left || '').localeCompare(String(right || ''));
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function comparatorMatches(version, comparator) {
  const match = comparator.trim().match(/^(>=|<=|>|<|=)?\s*(v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)$/);
  if (!match) return false;
  const comparison = compareVersions(version, match[2]);
  switch (match[1] || '=') {
    case '>': return comparison > 0;
    case '>=': return comparison >= 0;
    case '<': return comparison < 0;
    case '<=': return comparison <= 0;
    default: return comparison === 0;
  }
}

/** Small, dependency-free semver range evaluator for Pack base constraints. */
export function versionSatisfies(version, range) {
  const value = String(range || '').trim();
  if (!value || value === '*') return true;
  if (!parseSemver(version)) return String(version) === value;
  if (value.includes('||')) return value.split('||').some((entry) => versionSatisfies(version, entry));
  if (value.startsWith('^')) {
    const base = parseSemver(value.slice(1));
    if (!base) return false;
    const upper = base.major > 0 ? `${base.major + 1}.0.0` : base.minor > 0 ? `0.${base.minor + 1}.0` : `0.0.${base.patch + 1}`;
    return compareVersions(version, value.slice(1)) >= 0 && compareVersions(version, upper) < 0;
  }
  if (value.startsWith('~')) {
    const base = parseSemver(value.slice(1));
    if (!base) return false;
    return compareVersions(version, value.slice(1)) >= 0 && compareVersions(version, `${base.major}.${base.minor + 1}.0`) < 0;
  }
  const hyphen = value.match(/^(.+?)\s+-\s+(.+)$/);
  if (hyphen) return compareVersions(version, hyphen[1]) >= 0 && compareVersions(version, hyphen[2]) <= 0;
  const comparators = value.split(/[ ,]+/).filter(Boolean);
  if (comparators.some((entry) => /^(?:>=|<=|>|<|=)/.test(entry))) {
    return comparators.every((entry) => comparatorMatches(version, entry));
  }
  return compareVersions(version, value) === 0;
}

function duplicateIds(values, idOf) {
  const seen = new Set();
  return values.map(idOf).filter((id) => {
    if (!id || seen.has(id)) return true;
    seen.add(id);
    return false;
  });
}

function rewriteSelectorValue(value, maps) {
  if (typeof value === 'string') {
    const selector = normalizeRuleSelector(value);
    return rewriteSelectorValue(selector, maps);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const selector = normalizeRuleSelector(value);
  let partId = selector.partId;
  if (value.scope !== 'base' && maps.part.has(partId)) partId = maps.part.get(partId);
  const itemMap = maps.items.get(partId) || maps.items.get(selector.partId);
  const variantMapForItem = (itemId) => maps.variants.get(`${partId}/${itemMap?.get(itemId) || itemId}`)
    || maps.variants.get(`${selector.partId}/${itemId}`);
  const rewriteItem = (itemId) => value.scope === 'base' ? itemId : itemMap?.get(itemId) || itemId;
  const itemId = selector.itemId ? rewriteItem(selector.itemId) : '';
  const itemIds = (selector.itemIds || []).map(rewriteItem);
  const variantMap = selector.itemId ? variantMapForItem(selector.itemId) : null;
  const variantId = selector.variantId && value.scope !== 'base' ? variantMap?.get(selector.variantId) || selector.variantId : selector.variantId;
  const variantIds = (selector.variantIds || []).map((id) => value.scope === 'base' ? id : variantMap?.get(id) || id);
  return {
    partId,
    ...(itemId ? { itemId } : {}),
    ...(itemIds.length ? { itemIds } : {}),
    ...(variantId ? { variantId } : {}),
    ...(variantIds.length ? { variantIds } : {}),
  };
}

function rewriteCondition(value, maps) {
  if (Array.isArray(value)) return value.map((entry) => rewriteCondition(entry, maps));
  if (!value || typeof value !== 'object') return value;
  if (value.op === 'selected') return { ...rewriteSelectorValue(value, maps), op: 'selected' };
  if (value.op === 'not') return { ...value, condition: rewriteCondition(value.condition, maps) };
  if (value.op === 'all' || value.op === 'any') {
    return { ...value, conditions: asArray(value.conditions).map((entry) => rewriteCondition(entry, maps)) };
  }
  if (value.partId || value.partKey || value.part) return rewriteSelectorValue(value, maps);
  const result = { ...value };
  ['all', 'any', 'not', 'requires', 'excludes'].forEach((key) => {
    if (key in result) result[key] = asArray(result[key]).map((entry) => rewriteCondition(entry, maps));
  });
  return result;
}

function rewriteEmbeddedRules(owner, maps) {
  const copy = { ...owner };
  ['requires', 'excludes'].forEach((type) => {
    if (copy[type]) copy[type] = asArray(copy[type]).map((target) => rewriteSelectorValue(target, maps));
  });
  if (copy.rules) {
    copy.rules = { ...copy.rules };
    ['requires', 'excludes'].forEach((type) => {
      if (copy.rules[type]) copy.rules[type] = asArray(copy.rules[type]).map((target) => rewriteSelectorValue(target, maps));
    });
  }
  if (copy.visibleWhen) copy.visibleWhen = rewriteCondition(copy.visibleWhen, maps);
  return copy;
}

function createPackMaps(base, pack, errors) {
  const namespace = packNamespaceOf(pack);
  const part = new Map();
  const tracks = new Map();
  const palettes = new Map();
  const assets = new Map();
  const items = new Map();
  const variants = new Map();
  const addDefinitionMap = (values, idOf, map, kind) => {
    const duplicates = duplicateIds(values, idOf);
    duplicates.forEach((id) => errors.push({ code: `duplicate-pack-${kind}`, id }));
    values.forEach((value) => {
      const localId = idOf(value);
      if (!localId) return;
      try { map.set(localId, namespaceId(namespace, localId)); } catch (error) { errors.push({ code: error.code, id: localId, message: error.message }); }
    });
  };
  const newParts = packParts(pack).filter((entry) => !(entry.extendsPartId || entry.extendsPartKey || entry.targetPartId));
  addDefinitionMap(newParts, partIdOf, part, 'part');
  addDefinitionMap(asArray(pack.layerTracks), trackIdOf, tracks, 'layer-track');
  addDefinitionMap(asArray(pack.palettes ?? pack.colorChannels), paletteIdOf, palettes, 'palette');
  addDefinitionMap(asArray(pack.assets).filter((asset) => asset?.id), (asset) => String(asset.id || ''), assets, 'asset');

  packParts(pack).forEach((packPart) => {
    const localPartId = partIdOf(packPart);
    const targetPartId = String(packPart.extendsPartId ?? packPart.extendsPartKey ?? packPart.targetPartId ?? part.get(localPartId) ?? '');
    if (!targetPartId) return;
    const itemMap = new Map();
    const newItems = itemsOf(packPart).filter((item) => !(item.extendsItemId || item.extendsItemKey || item.targetItemId));
    addDefinitionMap(newItems, itemIdOf, itemMap, `item-${targetPartId}`);
    items.set(targetPartId, itemMap);
    itemsOf(packPart).forEach((item) => {
      const targetItemId = String(item.extendsItemId ?? item.extendsItemKey ?? item.targetItemId ?? itemMap.get(itemIdOf(item)) ?? '');
      if (!targetItemId) return;
      const variantMap = new Map();
      addDefinitionMap(variantsOf(item), variantIdOf, variantMap, `variant-${targetPartId}-${targetItemId}`);
      variants.set(`${targetPartId}/${targetItemId}`, variantMap);
    });
  });
  return { part, tracks, palettes, assets, items, variants };
}

function rewriteBinding(binding, maps, pack) {
  let copy = rewriteEmbeddedRules(clone(binding), maps);
  const localId = String(copy.id ?? copy.key ?? '');
  if (localId) copy.id = namespaceId(packNamespaceOf(pack), localId);
  const trackId = String(copy.layerTrackId ?? copy.trackId ?? '');
  if (trackId && maps.tracks.has(trackId)) copy.layerTrackId = maps.tracks.get(trackId);
  const paletteId = String(copy.paletteId ?? copy.colorChannelId ?? '');
  if (paletteId && maps.palettes.has(paletteId)) {
    if ('colorChannelId' in copy) copy.colorChannelId = maps.palettes.get(paletteId);
    else copy.paletteId = maps.palettes.get(paletteId);
  }
  const assetId = String(copy.assetId ?? '');
  if (assetId && maps.assets.has(assetId)) copy.assetId = maps.assets.get(assetId);
  if (Array.isArray(copy.assetsBySwatch)) {
    copy.assetsBySwatch = copy.assetsBySwatch.map((mapping) => ({
      ...mapping,
      assetId: maps.assets.get(String(mapping.assetId || '')) || mapping.assetId,
    }));
  }
  if (copy.visibilityCondition) copy.visibilityCondition = rewriteCondition(copy.visibilityCondition, maps);
  return annotate(copy, pack);
}

function rewriteVariant(variant, targetPartId, targetItemId, maps, pack) {
  const localId = variantIdOf(variant);
  const variantMap = maps.variants.get(`${targetPartId}/${targetItemId}`);
  let copy = rewriteEmbeddedRules(clone(variant), maps);
  copy.id = variantMap?.get(localId) || namespaceId(packNamespaceOf(pack), localId);
  if ('key' in copy) delete copy.key;
  if (Array.isArray(copy.bindings)) copy.bindings = copy.bindings.map((binding) => rewriteBinding(binding, maps, pack));
  if (Array.isArray(copy.layers)) copy.layers = copy.layers.map((binding) => rewriteBinding(binding, maps, pack));
  if (Array.isArray(copy.layerBindings)) copy.layerBindings = copy.layerBindings.map((binding) => rewriteBinding(binding, maps, pack));
  return annotate(copy, pack);
}

function rewriteItem(item, targetPartId, maps, pack) {
  const itemMap = maps.items.get(targetPartId);
  const localId = itemIdOf(item);
  const targetItemId = itemMap?.get(localId) || namespaceId(packNamespaceOf(pack), localId);
  let copy = rewriteEmbeddedRules(clone(item), maps);
  copy.id = targetItemId;
  if ('key' in copy) delete copy.key;
  if (Array.isArray(copy.variants)) copy.variants = copy.variants.map((variant) => rewriteVariant(variant, targetPartId, targetItemId, maps, pack));
  if (Array.isArray(copy.styles)) copy.styles = copy.styles.map((variant) => rewriteVariant(variant, targetPartId, targetItemId, maps, pack));
  if (Array.isArray(copy.bindings)) copy.bindings = copy.bindings.map((binding) => rewriteBinding(binding, maps, pack));
  if (Array.isArray(copy.layers)) copy.layers = copy.layers.map((binding) => rewriteBinding(binding, maps, pack));
  if (Array.isArray(copy.layerBindings)) copy.layerBindings = copy.layerBindings.map((binding) => rewriteBinding(binding, maps, pack));
  if (copy.thumbnailAssetId && maps.assets.has(copy.thumbnailAssetId)) copy.thumbnailAssetId = maps.assets.get(copy.thumbnailAssetId);
  const defaultVariantId = String(copy.defaultVariantId ?? copy.defaultStyleId ?? '');
  const variantMap = maps.variants.get(`${targetPartId}/${targetItemId}`);
  if (defaultVariantId && variantMap?.has(defaultVariantId)) copy.defaultVariantId = variantMap.get(defaultVariantId);
  return annotate(copy, pack);
}

function rewritePart(packPart, maps, pack) {
  const localId = partIdOf(packPart);
  const targetPartId = maps.part.get(localId);
  let copy = rewriteEmbeddedRules(clone(packPart), maps);
  copy.id = targetPartId;
  if ('key' in copy) delete copy.key;
  const parentId = String(copy.parentPartId ?? copy.parentPartKey ?? '');
  if (parentId && maps.part.has(parentId)) copy.parentPartId = maps.part.get(parentId);
  copy.items = itemsOf(packPart).map((item) => rewriteItem(item, targetPartId, maps, pack));
  const defaultItemId = String(copy.defaultItemId ?? copy.defaultItemKey ?? '');
  if (defaultItemId && maps.items.get(targetPartId)?.has(defaultItemId)) copy.defaultItemId = maps.items.get(targetPartId).get(defaultItemId);
  copy.required = false;
  copy.allowRemove = true;
  if (copy.iconAssetId && maps.assets.has(copy.iconAssetId)) copy.iconAssetId = maps.assets.get(copy.iconAssetId);
  return annotate(copy, pack);
}

function normalizePackRule(rule, index, maps, pack) {
  let type;
  let trigger;
  let targets;
  if (rule?.leftPartKey || rule?.rightPartKey) {
    type = 'excludes';
    trigger = { partId: rule.leftPartKey, itemId: rule.leftItemKey };
    targets = [{ partId: rule.rightPartKey, itemId: rule.rightItemKey }];
  } else {
    type = String(rule?.type ?? rule?.kind ?? (rule?.requires ? 'requires' : 'excludes'));
    trigger = rule?.trigger ?? rule?.when ?? rule?.if ?? rule?.source ?? rule?.left;
    targets = rule?.targets ?? rule?.[type] ?? rule?.target ?? rule?.right;
  }
  return annotate({
    id: namespaceId(packNamespaceOf(pack), String(rule?.id || `rule-${index + 1}`)),
    type,
    trigger: rewriteSelectorValue(trigger, maps),
    targets: asArray(targets).map((target) => rewriteSelectorValue(target, maps)),
  }, pack);
}

function preparePack(base, pack, errors, warnings) {
  const maps = createPackMaps(base, pack, errors);
  if (errors.length) return { maps };
  const tracks = asArray(pack.layerTracks).map((track) => annotate({
    ...clone(track),
    id: maps.tracks.get(trackIdOf(track)),
  }, pack));
  const palettes = asArray(pack.palettes ?? pack.colorChannels).map((palette) => annotate({
    ...clone(palette),
    id: maps.palettes.get(paletteIdOf(palette)),
  }, pack));
  const assets = asArray(pack.assets).map((asset) => annotate({
    ...clone(asset),
    ...(asset?.id ? { id: maps.assets.get(String(asset.id)) } : {}),
  }, pack));
  const newParts = packParts(pack)
    .filter((entry) => !(entry.extendsPartId || entry.extendsPartKey || entry.targetPartId))
    .map((part) => rewritePart(part, maps, pack));
  const extensions = packParts(pack)
    .filter((entry) => entry.extendsPartId || entry.extendsPartKey || entry.targetPartId)
    .map((entry) => {
      const targetPartId = String(entry.extendsPartId ?? entry.extendsPartKey ?? entry.targetPartId);
      return {
        targetPartId,
        items: itemsOf(entry)
          .filter((item) => !(item.extendsItemId || item.extendsItemKey || item.targetItemId))
          .map((item) => rewriteItem(item, targetPartId, maps, pack)),
        variantExtensions: itemsOf(entry)
          .filter((item) => item.extendsItemId || item.extendsItemKey || item.targetItemId)
          .map((item) => {
            const targetItemId = String(item.extendsItemId ?? item.extendsItemKey ?? item.targetItemId);
            return {
              targetItemId,
              variants: variantsOf(item).map((variant) => rewriteVariant(variant, targetPartId, targetItemId, maps, pack)),
            };
          }),
      };
    });
  const rules = asArray(pack.rules).map((rule, index) => normalizePackRule(rule, index, maps, pack));
  if (pack.defaultRecipe) warnings.push({ code: 'pack-default-recipe-ignored', message: 'Expansion Packs cannot replace the base default recipe.' });
  return { maps, tracks, palettes, assets, newParts, extensions, rules };
}

function selectorUsesNamespace(selector, namespace) {
  const prefix = `${namespace}__`;
  return selector.partId?.startsWith(prefix)
    || selector.itemId?.startsWith(prefix)
    || selector.itemIds?.some((id) => id.startsWith(prefix))
    || selector.variantId?.startsWith(prefix)
    || selector.variantIds?.some((id) => id.startsWith(prefix));
}

function validateAddedRules(base, merged, pack, errors) {
  const namespace = packNamespaceOf(pack);
  const packRules = collectMakerRules(merged).filter((rule) => String(rule.id || '').startsWith(namespace)
    || rule.trigger.partId?.startsWith(`${namespace}__`)
    || rule.targets.some((target) => selectorUsesNamespace(target, namespace)));
  packRules.forEach((rule) => {
    const triggerIsNew = selectorUsesNamespace(rule.trigger, namespace);
    const targetHasNew = rule.targets.some((target) => selectorUsesNamespace(target, namespace));
    if (rule.type === 'requires' && !triggerIsNew) {
      errors.push({ code: 'pack-rule-breaks-base-recipe', ruleId: rule.id, message: 'A Pack requires-rule may only trigger from Pack-owned content.' });
    }
    if (rule.type === 'excludes' && !triggerIsNew && !targetHasNew) {
      errors.push({ code: 'pack-rule-breaks-base-recipe', ruleId: rule.id, message: 'A Pack excludes-rule must involve Pack-owned content.' });
    }
  });
}

function mergePrepared(base, pack, prepared) {
  const merged = clone(base);
  merged.parts = partsOf(merged);
  merged.layerTracks = asArray(merged.layerTracks);
  const usesColorChannels = Array.isArray(merged.colorChannels) && !Array.isArray(merged.palettes);
  if (usesColorChannels) merged.colorChannels = asArray(merged.colorChannels);
  else if (Array.isArray(merged.palettes) || prepared.palettes.length) merged.palettes = asArray(merged.palettes);
  merged.assets = asArray(merged.assets);
  merged.rules = asArray(merged.rules);

  const maxTrackOrder = merged.layerTracks.reduce((max, track) => Math.max(max, Number(track.order ?? track.renderOrder ?? -1)), -1);
  prepared.tracks.forEach((track, index) => {
    track.order = maxTrackOrder + index + 1;
    merged.layerTracks.push(track);
  });
  if (usesColorChannels) {
    const maxChannelOrder = merged.colorChannels.reduce((max, channel) => Math.max(max, Number(channel.order ?? -1)), -1);
    prepared.palettes.forEach((channel, index) => {
      channel.order = maxChannelOrder + index + 1;
      merged.colorChannels.push(channel);
    });
  } else if (Array.isArray(merged.palettes)) merged.palettes.push(...prepared.palettes);
  merged.assets.push(...prepared.assets);

  prepared.extensions.forEach((extension) => {
    const target = merged.parts.find((part) => partIdOf(part) === extension.targetPartId);
    if (!target) return;
    target.items = itemsOf(target);
    const maxOrder = target.items.reduce((max, item) => Math.max(max, Number(item.displayOrder ?? -1)), -1);
    extension.items.forEach((item, index) => {
      item.displayOrder = maxOrder + index + 1;
      target.items.push(item);
    });
    extension.variantExtensions.forEach((itemExtension) => {
      const targetItem = target.items.find((item) => itemIdOf(item) === itemExtension.targetItemId);
      if (!targetItem) return;
      const field = Array.isArray(targetItem.styles) && !Array.isArray(targetItem.variants) ? 'styles' : 'variants';
      targetItem[field] = variantsOf(targetItem);
      const maxVariantOrder = targetItem[field].reduce((max, variant) => Math.max(max, Number(variant.displayOrder ?? -1)), -1);
      itemExtension.variants.forEach((variant, index) => {
        variant.displayOrder = maxVariantOrder + index + 1;
        targetItem[field].push(variant);
      });
    });
  });
  const maxMenuOrder = merged.parts.reduce((max, part) => Math.max(max, Number(part.menuOrder ?? part.displayOrder ?? -1)), -1);
  prepared.newParts.forEach((part, index) => {
    part.menuOrder = maxMenuOrder + index + 1;
    merged.parts.push(part);
  });
  merged.rules.push(...prepared.rules);
  merged.installedExpansionPacks = asArray(merged.installedExpansionPacks);
  merged.installedExpansionPacks.push({
    packId: packIdOf(pack),
    namespace: packNamespaceOf(pack),
    version: String(pack.version || ''),
    baseMakerId: String(pack.baseMakerId || ''),
    baseVersion: makerVersionOf(base),
    manifestHash: String(pack.manifestHash || pack.contentHash || ''),
  });
  return merged;
}

/** Validate identity, version, additive-only semantics and all rewritten refs. */
export function checkExpansionPackCompatibility(base, pack) {
  const errors = [];
  const warnings = [];
  const packId = packIdOf(pack);
  const namespace = packNamespaceOf(pack);
  if (!base || typeof base !== 'object') errors.push({ code: 'missing-base-maker' });
  if (!pack || typeof pack !== 'object') return { compatible: false, errors: [{ code: 'missing-expansion-pack' }], warnings };
  if (pack.schemaVersion !== PACK_SCHEMA) errors.push({ code: 'unsupported-pack-schema', expected: PACK_SCHEMA, actual: pack.schemaVersion });
  if (!packId) errors.push({ code: 'missing-pack-id' });
  if (!SAFE_NAMESPACE.test(namespace)) errors.push({ code: 'invalid-pack-namespace', namespace });
  const baseMakerId = makerIdOf(base);
  if (!pack.baseMakerId || String(pack.baseMakerId) !== baseMakerId) {
    errors.push({ code: 'base-maker-mismatch', expected: baseMakerId, actual: String(pack.baseMakerId || '') });
  }
  const baseVersion = makerVersionOf(base);
  const versionRange = String(pack.baseVersionRange ?? pack.compatibility?.baseVersionRange ?? '');
  const exactVersion = String(pack.baseVersion ?? pack.baseMakerVersion ?? pack.compatibility?.baseVersion ?? '');
  if (!versionRange && !exactVersion) errors.push({ code: 'missing-base-version-constraint' });
  else if (versionRange && !versionSatisfies(baseVersion, versionRange)) errors.push({ code: 'base-version-out-of-range', version: baseVersion, range: versionRange });
  else if (exactVersion && compareVersions(baseVersion, exactVersion) !== 0) errors.push({ code: 'base-version-mismatch', expected: exactVersion, actual: baseVersion });
  const requiredHash = String(pack.baseManifestHash ?? pack.compatibility?.baseManifestHash ?? '');
  if (requiredHash && requiredHash !== makerHashOf(base)) errors.push({ code: 'base-manifest-hash-mismatch', expected: requiredHash, actual: makerHashOf(base) });
  const installed = asArray(base?.installedExpansionPacks);
  if (installed.some((entry) => String(entry.packId) === packId)) errors.push({ code: 'pack-already-installed', packId });
  if (installed.some((entry) => String(entry.namespace) === namespace)) errors.push({ code: 'pack-namespace-collision', namespace });
  asArray(pack.requiresPacks).forEach((requiredPackId) => {
    if (!installed.some((entry) => String(entry.packId) === String(requiredPackId))) errors.push({ code: 'missing-pack-dependency', packId: requiredPackId });
  });
  asArray(pack.incompatiblePacks).forEach((blockedPackId) => {
    if (installed.some((entry) => String(entry.packId) === String(blockedPackId))) errors.push({ code: 'incompatible-installed-pack', packId: blockedPackId });
  });

  const basePartIds = new Set(partsOf(base).map(partIdOf));
  packParts(pack).forEach((part) => {
    const extensionTarget = String(part.extendsPartId ?? part.extendsPartKey ?? part.targetPartId ?? '');
    if (extensionTarget && !basePartIds.has(extensionTarget)) errors.push({ code: 'missing-extension-target-part', partId: extensionTarget });
    if (!extensionTarget && isRequired(part)) errors.push({ code: 'pack-cannot-add-required-part', partId: partIdOf(part) });
    if (extensionTarget) {
      const forbidden = ['required', 'allowRemove', 'kind', 'parentPartId', 'parentPartKey', 'defaultItemId', 'defaultItemKey'];
      forbidden.filter((key) => Object.hasOwn(part, key)).forEach((key) => errors.push({ code: 'pack-modifies-base-part', partId: extensionTarget, field: key }));
      const basePart = partsOf(base).find((candidate) => partIdOf(candidate) === extensionTarget);
      itemsOf(part).forEach((item) => {
        const targetItemId = String(item.extendsItemId ?? item.extendsItemKey ?? item.targetItemId ?? '');
        if (!targetItemId) return;
        const targetItem = itemsOf(basePart).find((candidate) => itemIdOf(candidate) === targetItemId);
        if (!targetItem) {
          errors.push({ code: 'missing-extension-target-item', partId: extensionTarget, itemId: targetItemId });
          return;
        }
        const itemForbidden = ['id', 'key', 'name', 'label', 'defaultVariantId', 'defaultStyleId', 'thumbnailAssetId', 'visibleWhen', 'requires', 'excludes'];
        itemForbidden.filter((key) => Object.hasOwn(item, key)).forEach((key) => errors.push({
          code: 'pack-modifies-base-item',
          partId: extensionTarget,
          itemId: targetItemId,
          field: key,
        }));
      });
    } else if (itemsOf(part).some((item) => item.extendsItemId || item.extendsItemKey || item.targetItemId)) {
      errors.push({ code: 'item-extension-needs-base-part', partId: partIdOf(part) });
    }
  });
  const prepared = preparePack(base, pack, errors, warnings);
  let merged = null;
  if (!errors.length) {
    merged = mergePrepared(base, pack, prepared);
    validateAddedRules(base, merged, pack, errors);
    try {
      createMakerRuleIndex(merged);
    } catch (error) {
      errors.push({ code: error.code || 'invalid-pack-rule-model', message: error.message, details: error.details });
    }
  }
  return { compatible: errors.length === 0, errors, warnings, prepared, merged: errors.length ? null : merged };
}

export function mergeExpansionPack(base, pack, options = {}) {
  const result = checkExpansionPackCompatibility(base, pack);
  if (!result.compatible) {
    if (options.returnResult) return result;
    throw new ExpansionPackError('Expansion Pack is not compatible with this Maker.', 'incompatible-expansion-pack', { errors: result.errors });
  }
  return options.returnResult ? result : result.merged;
}

export function mergeExpansionPacks(base, packs, options = {}) {
  let merged = clone(base);
  const results = [];
  for (const pack of asArray(packs)) {
    const result = mergeExpansionPack(merged, pack, { returnResult: true });
    results.push(result);
    if (!result.compatible) {
      if (options.returnResult) return { compatible: false, maker: merged, results, errors: result.errors };
      throw new ExpansionPackError('An Expansion Pack is not compatible with this Maker.', 'incompatible-expansion-pack', { errors: result.errors });
    }
    merged = result.merged;
  }
  return options.returnResult ? { compatible: true, maker: merged, results, errors: [] } : merged;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => !['expansionPackId', 'expansionNamespace'].includes(key)).map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function mapBy(values, idOf) {
  return new Map(asArray(values).map((value) => [idOf(value), value]).filter(([id]) => id));
}

function ruleKey(rule) {
  return stableJson({ type: rule.type, trigger: rule.trigger, targets: rule.targets });
}

function normalizedRules(maker) {
  try {
    return collectMakerRules(maker).map((rule) => ({ type: rule.type, trigger: rule.trigger, targets: rule.targets }));
  } catch {
    return [];
  }
}

function selectorExistsInOldMaker(selector, oldIndex) {
  if (!oldIndex.parts.has(selector.partId)) return false;
  if (selector.itemId && !oldIndex.items.has(`${selector.partId}/${selector.itemId}`)) return false;
  if (selector.itemIds?.some((itemId) => !oldIndex.items.has(`${selector.partId}/${itemId}`))) return false;
  if (selector.variantId) {
    const itemId = selector.itemId || selector.itemIds?.[0];
    if (!oldIndex.variants.has(`${selector.partId}/${itemId}/${selector.variantId}`)) return false;
  }
  return true;
}

function definitionIndex(maker) {
  const parts = new Set();
  const items = new Set();
  const variants = new Set();
  partsOf(maker).forEach((part) => {
    const partId = partIdOf(part);
    parts.add(partId);
    itemsOf(part).forEach((item) => {
      const itemId = itemIdOf(item);
      items.add(`${partId}/${itemId}`);
      variantsOf(item).forEach((variant) => variants.add(`${partId}/${itemId}/${variantIdOf(variant)}`));
    });
  });
  return { parts, items, variants };
}

function renderSignature(owner) {
  const bindings = bindingsOf(owner);
  const images = Array.isArray(owner?.images) ? owner.images : [];
  return stableJson({ bindings, images, visibleWhen: owner?.visibleWhen ?? null });
}

/**
 * Compare two immutable Maker releases and explain whether old recipes and
 * rendered appearances can safely opt into the new version.
 */
export function compareMakerCompatibility(previous, next) {
  const breaking = [];
  const warnings = [];
  const additions = [];
  const addBreaking = (code, path, message, kind = 'recipe') => breaking.push({ code, path, message, kind });
  const addWarning = (code, path, message) => warnings.push({ code, path, message });
  const addAddition = (code, path, message) => additions.push({ code, path, message });

  if (makerIdOf(previous) !== makerIdOf(next)) addBreaking('maker-identity-changed', 'makerId', 'The releases belong to different Maker roots.');
  const previousVersion = makerVersionOf(previous);
  const nextVersion = makerVersionOf(next);
  if (previousVersion && nextVersion && compareVersions(nextVersion, previousVersion) <= 0) {
    addBreaking('version-not-increased', 'version', 'A new immutable release must increase the Maker version.', 'metadata');
  } else if (!previousVersion || !nextVersion) {
    addWarning('missing-version', 'version', 'Both releases should publish explicit semantic versions.');
  }

  const previousCanvas = previous?.canvas ?? previous?.template?.canvas ?? {};
  const nextCanvas = next?.canvas ?? next?.template?.canvas ?? {};
  if (stableJson(previousCanvas) !== stableJson(nextCanvas)) addBreaking('canvas-changed', 'canvas', 'Canvas dimensions or display mode changed.', 'render');
  if (stableJson(previous?.defaultRecipe ?? null) !== stableJson(next?.defaultRecipe ?? null)) {
    addWarning('default-recipe-changed', 'defaultRecipe', 'Existing OCs remain pinned, but the initial player preview will change.');
  }

  const previousTracks = mapBy(previous?.layerTracks, trackIdOf);
  const nextTracks = mapBy(next?.layerTracks, trackIdOf);
  previousTracks.forEach((track, trackId) => {
    const replacement = nextTracks.get(trackId);
    if (!replacement) addBreaking('layer-track-removed', `layerTracks.${trackId}`, 'An existing LayerTrack was removed.', 'render');
    else if (Number(track.order ?? track.renderOrder) !== Number(replacement.order ?? replacement.renderOrder)) {
      addBreaking('layer-track-order-changed', `layerTracks.${trackId}.order`, 'Existing layer order changed.', 'render');
    }
  });
  nextTracks.forEach((_, trackId) => {
    if (!previousTracks.has(trackId)) addAddition('layer-track-added', `layerTracks.${trackId}`, 'A LayerTrack was added.');
  });

  const previousParts = mapBy(partsOf(previous), partIdOf);
  const nextParts = mapBy(partsOf(next), partIdOf);
  previousParts.forEach((part, partId) => {
    const replacement = nextParts.get(partId);
    if (!replacement) {
      addBreaking('part-removed', `parts.${partId}`, 'An existing Part was removed.');
      return;
    }
    if (!isRequired(part) && isRequired(replacement)) addBreaking('part-became-required', `parts.${partId}.required`, 'An optional Part became required.');
    if (stableJson(part.visibleWhen ?? null) !== stableJson(replacement.visibleWhen ?? null)) {
      addBreaking('part-visibility-changed', `parts.${partId}.visibleWhen`, 'An existing Part availability condition changed.');
    }
    if (String(part.parentPartId ?? part.parentPartKey ?? '') !== String(replacement.parentPartId ?? replacement.parentPartKey ?? '')) {
      addBreaking('part-hierarchy-changed', `parts.${partId}.parentPartId`, 'An existing Part moved in the hierarchy.');
    }
    if (String(part.kind || '') !== String(replacement.kind || '')) addBreaking('part-kind-changed', `parts.${partId}.kind`, 'An existing Part kind changed.');
    if (String(part.defaultItemId ?? part.defaultItemKey ?? '') !== String(replacement.defaultItemId ?? replacement.defaultItemKey ?? '')) {
      addWarning('default-item-changed', `parts.${partId}.defaultItemId`, 'Existing recipes remain valid, but new default OCs will change.');
    }
    if (Number(part.menuOrder ?? part.displayOrder) !== Number(replacement.menuOrder ?? replacement.displayOrder)) {
      addWarning('part-menu-order-changed', `parts.${partId}.menuOrder`, 'Player menu order changed.');
    }
    const previousItems = mapBy(itemsOf(part), itemIdOf);
    const nextItems = mapBy(itemsOf(replacement), itemIdOf);
    previousItems.forEach((item, itemId) => {
      const nextItem = nextItems.get(itemId);
      if (!nextItem) {
        addBreaking('item-removed', `parts.${partId}.items.${itemId}`, 'An Item referenced by old recipes was removed.');
        return;
      }
      if (stableJson(item.visibleWhen ?? null) !== stableJson(nextItem.visibleWhen ?? null)) {
        addBreaking('item-visibility-changed', `parts.${partId}.items.${itemId}.visibleWhen`, 'An existing Item availability condition changed.');
      }
      const previousVariants = mapBy(variantsOf(item), variantIdOf);
      const nextVariants = mapBy(variantsOf(nextItem), variantIdOf);
      if (!previousVariants.size && nextVariants.size) {
        addBreaking('variants-introduced', `parts.${partId}.items.${itemId}.variants`, 'The old Item had no Variant id, so its old recipe is ambiguous.');
      }
      previousVariants.forEach((variant, variantId) => {
        const nextVariant = nextVariants.get(variantId);
        if (!nextVariant) addBreaking('variant-removed', `parts.${partId}.items.${itemId}.variants.${variantId}`, 'A Variant referenced by old recipes was removed.');
        else if (renderSignature(variant) !== renderSignature(nextVariant)) {
          addBreaking('variant-rendering-changed', `parts.${partId}.items.${itemId}.variants.${variantId}`, 'Layer bindings or images changed.', 'render');
        }
      });
      nextVariants.forEach((_, variantId) => {
        if (!previousVariants.has(variantId)) addAddition('variant-added', `parts.${partId}.items.${itemId}.variants.${variantId}`, 'A Variant was added.');
      });
      if (!previousVariants.size && !nextVariants.size && renderSignature(item) !== renderSignature(nextItem)) {
        addBreaking('item-rendering-changed', `parts.${partId}.items.${itemId}`, 'Layer bindings or images changed.', 'render');
      }
    });
    nextItems.forEach((_, itemId) => {
      if (!previousItems.has(itemId)) addAddition('item-added', `parts.${partId}.items.${itemId}`, 'An Item was added.');
    });

    const previousColors = mapBy(colorsOf(part), (color) => String(color?.id ?? color?.key ?? ''));
    const nextColors = mapBy(colorsOf(replacement), (color) => String(color?.id ?? color?.key ?? ''));
    previousColors.forEach((color, colorId) => {
      const nextColor = nextColors.get(colorId);
      if (!nextColor) addBreaking('color-removed', `parts.${partId}.colors.${colorId}`, 'A Color referenced by old recipes was removed.');
      else if (String(color.value || '').toLowerCase() !== String(nextColor.value || '').toLowerCase()) {
        addBreaking('color-value-changed', `parts.${partId}.colors.${colorId}`, 'An existing Color id now resolves to another value.', 'render');
      }
    });
  });
  nextParts.forEach((part, partId) => {
    if (!previousParts.has(partId)) {
      if (isRequired(part)) addBreaking('required-part-added', `parts.${partId}`, 'A new required Part invalidates old recipes.');
      else addAddition('optional-part-added', `parts.${partId}`, 'An optional Part was added.');
    }
  });

  const previousChannels = mapBy(previous?.colorChannels ?? previous?.palettes, paletteIdOf);
  const nextChannels = mapBy(next?.colorChannels ?? next?.palettes, paletteIdOf);
  previousChannels.forEach((channel, channelId) => {
    const replacement = nextChannels.get(channelId);
    if (!replacement) {
      addBreaking('color-channel-removed', `colorChannels.${channelId}`, 'A ColorChannel referenced by old recipes was removed.');
      return;
    }
    if (stableJson({ mode: channel.mode, swatches: channel.swatches })
      !== stableJson({ mode: replacement.mode, swatches: replacement.swatches })) {
      addBreaking('color-channel-changed', `colorChannels.${channelId}`, 'Existing swatches or gradient mapping changed.', 'render');
    }
  });
  nextChannels.forEach((_, channelId) => {
    if (!previousChannels.has(channelId)) addAddition('color-channel-added', `colorChannels.${channelId}`, 'A ColorChannel was added.');
  });

  const previousAssets = mapBy(previous?.assets, (asset) => String(asset?.id ?? asset?.identifier ?? ''));
  const nextAssets = mapBy(next?.assets, (asset) => String(asset?.id ?? asset?.identifier ?? ''));
  previousAssets.forEach((asset, assetId) => {
    const nextAsset = nextAssets.get(assetId);
    if (!nextAsset) addBreaking('asset-removed', `assets.${assetId}`, 'A runtime asset was removed.', 'render');
    else {
      const previousLocator = String(asset.contentHash ?? asset.digest ?? asset.blobId ?? asset.identifier ?? '');
      const nextLocator = String(nextAsset.contentHash ?? nextAsset.digest ?? nextAsset.blobId ?? nextAsset.identifier ?? '');
      if (previousLocator !== nextLocator) addBreaking('asset-content-changed', `assets.${assetId}`, 'An existing asset id now resolves to different bytes.', 'render');
    }
  });

  const previousRules = normalizedRules(previous);
  const nextRules = normalizedRules(next);
  const previousRuleKeys = new Set(previousRules.map(ruleKey));
  const nextRuleKeys = new Set(nextRules.map(ruleKey));
  const oldDefinitions = definitionIndex(previous);
  nextRules.forEach((rule) => {
    if (previousRuleKeys.has(ruleKey(rule))) return;
    const triggerWasOld = selectorExistsInOldMaker(rule.trigger, oldDefinitions);
    const allTargetsWereOld = rule.targets.every((target) => selectorExistsInOldMaker(target, oldDefinitions));
    if (triggerWasOld && (rule.type === 'requires' || allTargetsWereOld)) {
      addBreaking('constraint-added-for-old-content', 'rules', 'A new constraint can reject a previously valid recipe.');
    } else {
      addAddition('constraint-for-new-content-added', 'rules', 'A constraint involving only new content was added.');
    }
  });
  previousRules.forEach((rule) => {
    if (!nextRuleKeys.has(ruleKey(rule))) addWarning('constraint-removed', 'rules', 'A constraint was removed; old recipes remain valid but Random behavior may widen.');
  });

  const declaredCompatibility = String(next?.version?.compatibility ?? '');
  if (breaking.length && declaredCompatibility && declaredCompatibility !== 'breaking') {
    addBreaking('compatibility-declaration-mismatch', 'version.compatibility', 'This release declares compatibility despite detected breaking changes.', 'metadata');
  } else if (!breaking.length && declaredCompatibility === 'breaking') {
    addWarning('unnecessary-breaking-declaration', 'version.compatibility', 'No structural break was detected, but the release is declared breaking.');
  }

  const recipeCompatible = !breaking.some((issue) => issue.kind !== 'render' && issue.kind !== 'metadata');
  const renderCompatible = !breaking.some((issue) => issue.kind === 'render');
  const compatible = breaking.length === 0;
  return {
    compatible,
    level: compatible ? (warnings.length ? 'compatible-with-warnings' : 'compatible') : 'breaking',
    recipeCompatible,
    renderCompatible,
    requiresPinnedVersion: !compatible,
    recommendedVersionBump: breaking.length ? 'major' : additions.length ? 'minor' : 'patch',
    previousVersion,
    nextVersion,
    breaking,
    warnings,
    additions,
    summary: compatible
      ? `${additions.length} additive change(s), ${warnings.length} warning(s), no breaking changes.`
      : `${breaking.length} breaking change(s); existing OCs must stay pinned to ${previousVersion || 'the previous version'}.`,
  };
}

export { PACK_SCHEMA as EXPANSION_PACK_SCHEMA };
