/**
 * Pure, UI-independent recipe constraint runtime.
 *
 * The runtime deliberately accepts both the legacy manifest vocabulary
 * (`key`, `partKey`, `itemKey`, `styles`) and the new MakerDocument vocabulary
 * (`id`, `partId`, `itemId`, `variants`). Its canonical recipe output is an
 * ordered array of `{ partId, itemId, variantId?, colorId?, colorHex? }` slots.
 */

const RULE_TYPES = new Set(['requires', 'excludes']);

export class MakerRuleError extends Error {
  constructor(message, code = 'invalid-maker-rules', details = {}) {
    super(message);
    this.name = 'MakerRuleError';
    this.code = code;
    this.details = details;
  }
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

function makerParts(maker) {
  return Array.isArray(maker?.parts) ? maker.parts : [];
}

function partItems(part) {
  return Array.isArray(part?.items) ? part.items : [];
}

function itemVariants(item) {
  if (Array.isArray(item?.variants)) return item.variants;
  if (Array.isArray(item?.styles)) return item.styles;
  return [];
}

function isPublishedItem(item) {
  return item?.enabled !== false && !['private', 'draft', 'disabled'].includes(String(item?.visibility || '').toLowerCase());
}

function isRequiredPart(part) {
  return part?.required === true || part?.allowRemove === false || part?.kind === 'last-bastion';
}

function normalizeIdList(value) {
  return [...new Set(asArray(value).map((entry) => String(entry || '')).filter(Boolean))];
}

/** Normalize a rule selector without looking it up in a particular Maker. */
export function normalizeRuleSelector(input, context = {}) {
  if (typeof input === 'string') {
    const separator = input.includes('/') ? '/' : input.includes(':') ? ':' : '';
    if (!separator) return { partId: input };
    const [partId, itemId, variantId] = input.split(separator);
    return {
      partId: String(partId || context.partId || ''),
      ...(itemId ? { itemId: String(itemId) } : {}),
      ...(variantId ? { variantId: String(variantId) } : {}),
    };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { partId: String(context.partId || '') };
  }
  const partId = String(input.partId ?? input.partKey ?? input.part ?? context.partId ?? '');
  // Context supplies only the owning Part for shorthand targets such as
  // `{ itemId: 'long' }`. Inheriting the owner's Item/Variant would turn an
  // explicit `{ partId: 'body' }` target into `body/<owner item>` by accident.
  const itemId = String(input.itemId ?? input.itemKey ?? input.item ?? '');
  const variantId = String(input.variantId ?? input.variantKey ?? input.styleId ?? input.styleKey ?? '');
  const itemIds = normalizeIdList(input.itemIds ?? input.itemKeys);
  const variantIds = normalizeIdList(input.variantIds ?? input.variantKeys ?? input.styleIds);
  return {
    partId,
    ...(itemId ? { itemId } : {}),
    ...(itemIds.length ? { itemIds } : {}),
    ...(variantId ? { variantId } : {}),
    ...(variantIds.length ? { variantIds } : {}),
  };
}

function normalizeRuleTargetList(value, context) {
  return asArray(value).map((target) => normalizeRuleSelector(target, context));
}

function embeddedRules(owner, trigger, prefix) {
  const result = [];
  RULE_TYPES.forEach((type) => {
    const targets = owner?.rules?.[type] ?? owner?.[type];
    normalizeRuleTargetList(targets, trigger).forEach((target, index) => {
      result.push({ id: `${prefix}:${type}:${index}`, type, trigger, targets: [target], source: owner });
    });
  });
  return result;
}

function normalizeGlobalRule(rule, index) {
  if (rule?.leftPartKey || rule?.rightPartKey) {
    return {
      id: String(rule.id || `legacy-excludes:${index}`),
      type: 'excludes',
      trigger: normalizeRuleSelector({ partId: rule.leftPartKey, itemId: rule.leftItemKey }),
      targets: [normalizeRuleSelector({ partId: rule.rightPartKey, itemId: rule.rightItemKey })],
      legacy: true,
      source: rule,
    };
  }
  const type = String(rule?.type ?? rule?.kind ?? (rule?.requires ? 'requires' : rule?.excludes ? 'excludes' : ''));
  const triggerInput = rule?.trigger ?? rule?.when ?? rule?.if ?? rule?.source ?? rule?.left;
  const targetsInput = type === 'requires'
    ? rule?.targets ?? rule?.requires ?? rule?.target ?? rule?.required ?? rule?.right
    : rule?.targets ?? rule?.excludes ?? rule?.target ?? rule?.excluded ?? rule?.right;
  return {
    id: String(rule?.id || `${type || 'invalid'}:${index}`),
    type,
    trigger: normalizeRuleSelector(triggerInput),
    targets: normalizeRuleTargetList(targetsInput),
    source: rule,
  };
}

/** Collect global and embedded Part / Item / Variant rules into one form. */
export function collectMakerRules(maker) {
  const result = asArray(maker?.rules).map(normalizeGlobalRule);
  makerParts(maker).forEach((part) => {
    const partId = partIdOf(part);
    result.push(...embeddedRules(part, { partId }, `part:${partId}`));
    partItems(part).forEach((item) => {
      const itemId = itemIdOf(item);
      result.push(...embeddedRules(item, { partId, itemId }, `item:${partId}:${itemId}`));
      itemVariants(item).forEach((variant) => {
        const variantId = variantIdOf(variant);
        result.push(...embeddedRules(variant, { partId, itemId, variantId }, `variant:${partId}:${itemId}:${variantId}`));
      });
    });
  });
  return result;
}

function assertSelector(index, selector, ruleId) {
  const part = index.partById.get(selector.partId);
  if (!part) throw new MakerRuleError(`Rule ${ruleId} references missing Part ${selector.partId}.`, 'missing-rule-part', { ruleId, selector });
  if (selector.itemId && !index.itemByPart.get(selector.partId)?.has(selector.itemId)) {
    throw new MakerRuleError(`Rule ${ruleId} references missing Item ${selector.partId}/${selector.itemId}.`, 'missing-rule-item', { ruleId, selector });
  }
  for (const itemId of selector.itemIds || []) {
    if (!index.itemByPart.get(selector.partId)?.has(itemId)) {
      throw new MakerRuleError(`Rule ${ruleId} references missing Item ${selector.partId}/${itemId}.`, 'missing-rule-item', { ruleId, selector });
    }
  }
  const variantIds = [...(selector.variantIds || []), ...(selector.variantId ? [selector.variantId] : [])];
  if (variantIds.length) {
    const selectedItems = selector.itemId ? [selector.itemId] : selector.itemIds || [];
    if (selectedItems.length !== 1) {
      throw new MakerRuleError(`Rule ${ruleId} must name one Item before naming a Variant.`, 'ambiguous-rule-variant', { ruleId, selector });
    }
    const variants = index.variantByItem.get(`${selector.partId}/${selectedItems[0]}`);
    variantIds.forEach((variantId) => {
      if (!variants?.has(variantId)) {
        throw new MakerRuleError(`Rule ${ruleId} references missing Variant ${variantId}.`, 'missing-rule-variant', { ruleId, selector });
      }
    });
  }
}

function topologicalParts(parts, partById) {
  const sourceOrder = new Map(parts.map((part, index) => [partIdOf(part), index]));
  const children = new Map(parts.map((part) => [partIdOf(part), []]));
  const indegree = new Map(parts.map((part) => [partIdOf(part), 0]));
  parts.forEach((part) => {
    const id = partIdOf(part);
    const parentId = String(part?.parentPartId ?? part?.parentPartKey ?? '');
    if (!parentId) return;
    if (!partById.has(parentId)) {
      throw new MakerRuleError(`Part ${id} references missing parent Part ${parentId}.`, 'missing-parent-part', { partId: id, parentPartId: parentId });
    }
    children.get(parentId).push(id);
    indegree.set(id, indegree.get(id) + 1);
  });
  const sortIds = (ids) => ids.sort((left, right) => {
    const leftPart = partById.get(left);
    const rightPart = partById.get(right);
    const leftOrder = Number(leftPart?.menuOrder ?? leftPart?.displayOrder ?? sourceOrder.get(left));
    const rightOrder = Number(rightPart?.menuOrder ?? rightPart?.displayOrder ?? sourceOrder.get(right));
    return leftOrder - rightOrder || sourceOrder.get(left) - sourceOrder.get(right);
  });
  const queue = sortIds([...indegree].filter(([, count]) => count === 0).map(([id]) => id));
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(partById.get(id));
    (children.get(id) || []).forEach((childId) => {
      indegree.set(childId, indegree.get(childId) - 1);
      if (indegree.get(childId) === 0) queue.push(childId);
    });
    sortIds(queue);
  }
  if (ordered.length !== parts.length) {
    const cycle = [...indegree].filter(([, count]) => count > 0).map(([id]) => id);
    throw new MakerRuleError(`Part hierarchy contains a cycle: ${cycle.join(', ')}.`, 'part-hierarchy-cycle', { parts: cycle });
  }
  return ordered;
}

/** Build and validate the lookup structure shared by all rule operations. */
export function createMakerRuleIndex(maker) {
  const parts = makerParts(maker);
  const partById = new Map();
  const itemByPart = new Map();
  const variantByItem = new Map();
  parts.forEach((part) => {
    const partId = partIdOf(part);
    if (!partId || partById.has(partId)) {
      throw new MakerRuleError(`Maker has an empty or duplicate Part id: ${partId || '(empty)'}.`, 'duplicate-part-id', { partId });
    }
    partById.set(partId, part);
    const itemMap = new Map();
    partItems(part).forEach((item) => {
      const itemId = itemIdOf(item);
      if (!itemId || itemMap.has(itemId)) {
        throw new MakerRuleError(`Part ${partId} has an empty or duplicate Item id: ${itemId || '(empty)'}.`, 'duplicate-item-id', { partId, itemId });
      }
      itemMap.set(itemId, item);
      const variants = new Map();
      itemVariants(item).forEach((variant) => {
        const variantId = variantIdOf(variant);
        if (!variantId || variants.has(variantId)) {
          throw new MakerRuleError(`Item ${partId}/${itemId} has an empty or duplicate Variant id.`, 'duplicate-variant-id', { partId, itemId, variantId });
        }
        variants.set(variantId, variant);
      });
      variantByItem.set(`${partId}/${itemId}`, variants);
    });
    itemByPart.set(partId, itemMap);
    const defaultItemId = String(part?.defaultItemId ?? part?.defaultItemKey ?? '');
    if (defaultItemId && !itemMap.has(defaultItemId)) {
      throw new MakerRuleError(`Part ${partId} references missing default Item ${defaultItemId}.`, 'missing-default-item', { partId, itemId: defaultItemId });
    }
  });
  const orderedParts = topologicalParts(parts, partById);
  const index = { maker, parts: orderedParts, partById, itemByPart, variantByItem, rules: [] };
  index.rules = collectMakerRules(maker);
  index.rules.forEach((rule) => {
    if (!RULE_TYPES.has(rule.type) || !rule.trigger.partId || !rule.targets.length) {
      throw new MakerRuleError(`Maker contains malformed rule ${rule.id}.`, 'malformed-rule', { rule });
    }
    assertSelector(index, rule.trigger, rule.id);
    rule.targets.forEach((target) => assertSelector(index, target, rule.id));
  });
  return index;
}

function canonicalInputSelection(partId, value) {
  if (value == null || value === false || value === '') return null;
  if (typeof value === 'string') return { partId, itemId: value };
  if (typeof value !== 'object') return null;
  const resolvedPartId = String(value.partId ?? value.partKey ?? partId ?? '');
  const itemId = String(value.itemId ?? value.itemKey ?? value.id ?? '');
  if (!itemId) return null;
  const variantId = String(value.variantId ?? value.variantKey ?? value.styleId ?? value.styleKey ?? '');
  const colorId = String(value.colorId ?? value.colorKey ?? '');
  const colorHex = String(value.colorHex ?? value.colorValue ?? (String(value.color || '').startsWith('#') ? value.color : '') ?? '');
  return {
    partId: resolvedPartId,
    itemId,
    ...(variantId ? { variantId } : {}),
    ...(colorId ? { colorId } : {}),
    ...(colorHex ? { colorHex: colorHex.toLowerCase() } : {}),
  };
}

function parseRecipeInput(recipe) {
  const raw = recipe?.recipe ?? recipe?.selections ?? recipe;
  const selection = new Map();
  const issues = [];
  if (Array.isArray(raw)) {
    raw.forEach((slot, index) => {
      const partId = String(slot?.partId ?? slot?.partKey ?? '');
      if (!partId) {
        issues.push({ code: 'missing-recipe-part', index });
        return;
      }
      if (selection.has(partId)) issues.push({ code: 'duplicate-recipe-part', partId });
      selection.set(partId, canonicalInputSelection(partId, slot));
    });
  } else if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([partId, value]) => {
      if (['palette', 'colors', 'metadata'].includes(partId)) return;
      selection.set(partId, canonicalInputSelection(partId, value));
    });
  }
  return { selection, issues };
}

function parseRecipeColors(recipe) {
  const source = recipe?.colors ?? recipe?.colorChannels ?? recipe?.palettes;
  const result = new Map();
  if (Array.isArray(source)) {
    source.forEach((entry) => {
      const channelId = String(entry?.channelId ?? entry?.colorChannelId ?? entry?.paletteId ?? '');
      const swatchId = String(entry?.swatchId ?? entry?.valueId ?? entry?.colorId ?? entry?.id ?? '');
      if (channelId) result.set(channelId, swatchId);
    });
  } else if (source && typeof source === 'object') {
    Object.entries(source).forEach(([channelId, value]) => {
      result.set(channelId, String(value?.swatchId ?? value?.valueId ?? value?.id ?? value ?? ''));
    });
  }
  return result;
}

function makerColorChannels(maker) {
  if (Array.isArray(maker?.colorChannels)) return maker.colorChannels;
  if (Array.isArray(maker?.palettes)) return maker.palettes;
  return [];
}

function channelValues(channel) {
  if (Array.isArray(channel?.swatches)) return channel.swatches;
  if (Array.isArray(channel?.values)) return channel.values;
  if (Array.isArray(channel?.colors)) return channel.colors;
  return [];
}

function normalizeRecipeColors(maker, recipe, { random = null, exact = false } = {}) {
  const explicit = parseRecipeColors(recipe);
  const defaults = parseRecipeColors(maker?.defaultRecipe ?? maker?.template?.defaultRecipe ?? {});
  const colors = [];
  const issues = [];
  const channelIds = new Set(makerColorChannels(maker).map((channel) => String(channel?.id ?? channel?.key ?? '')));
  explicit.forEach((_, channelId) => {
    if (!channelIds.has(channelId)) issues.push({ code: 'unknown-color-channel', channelId });
  });
  makerColorChannels(maker).forEach((channel) => {
    const channelId = String(channel?.id ?? channel?.key ?? '');
    const values = channelValues(channel);
    const requestedId = explicit.get(channelId) ?? (random ? '' : defaults.get(channelId)) ?? '';
    let selected = values.find((entry) => String(entry?.id ?? entry?.key ?? '') === requestedId);
    if (!selected && requestedId) issues.push({ code: 'unknown-color-swatch', channelId, swatchId: requestedId });
    if (!selected && random && values.length) selected = values[Math.min(values.length - 1, Math.floor(random() * values.length))];
    const defaultId = String(channel?.defaultSwatchId ?? channel?.defaultValueId ?? '');
    selected ||= values.find((entry) => String(entry?.id ?? entry?.key ?? '') === defaultId) || values[0];
    const swatchId = String(selected?.id ?? selected?.key ?? '');
    if (swatchId) colors.push({ channelId, swatchId });
    else if (exact || channel?.required) issues.push({ code: 'missing-color-selection', channelId });
  });
  return { colors, issues };
}

function itemDefaultVariantId(item) {
  return String(item?.defaultVariantId ?? item?.defaultStyleId ?? itemVariants(item)[0]?.id ?? itemVariants(item)[0]?.key ?? '');
}

function normalizeColor(part, desired, random) {
  const colors = Array.isArray(part?.colors) ? part.colors : [];
  if (!colors.length) {
    return {
      ...(desired?.colorId ? { colorId: desired.colorId } : {}),
      ...(desired?.colorHex ? { colorHex: desired.colorHex.toLowerCase() } : {}),
    };
  }
  let color = colors.find((entry) => String(entry?.id ?? entry?.key ?? '') === desired?.colorId)
    || colors.find((entry) => String(entry?.value || '').toLowerCase() === String(desired?.colorHex || '').toLowerCase());
  if (!color && random) color = colors[Math.min(colors.length - 1, Math.floor(random() * colors.length))];
  color ||= colors.find((entry) => entry?.default) || colors[0];
  const colorId = String(color?.id ?? color?.key ?? '');
  const colorHex = String(color?.value || '').toLowerCase();
  return { ...(colorId ? { colorId } : {}), ...(colorHex ? { colorHex } : {}) };
}

function selectionCandidates(index, part, desired, random) {
  const partId = partIdOf(part);
  const candidates = [];
  index.itemByPart.get(partId).forEach((item, itemId) => {
    if (!isPublishedItem(item)) return;
    const variants = [...index.variantByItem.get(`${partId}/${itemId}`).values()];
    if (!variants.length) {
      candidates.push({ partId, itemId, ...normalizeColor(part, desired?.itemId === itemId ? desired : null, random) });
      return;
    }
    variants.forEach((variant) => candidates.push({
      partId,
      itemId,
      variantId: variantIdOf(variant),
      ...normalizeColor(part, desired?.itemId === itemId ? desired : null, random),
    }));
  });
  const defaultItemId = String(part?.defaultItemId ?? part?.defaultItemKey ?? '');
  const desiredKey = desired ? `${desired.itemId}/${desired.variantId || ''}` : '';
  const defaultItem = index.itemByPart.get(partId).get(defaultItemId);
  const defaultKey = defaultItemId ? `${defaultItemId}/${itemDefaultVariantId(defaultItem)}` : '';
  const score = (candidate) => {
    const key = `${candidate.itemId}/${candidate.variantId || ''}`;
    if (desiredKey && key === desiredKey) return 0;
    if (desired?.itemId && candidate.itemId === desired.itemId && !desired.variantId) return 1;
    if (defaultKey && key === defaultKey) return 2;
    if (defaultItemId && candidate.itemId === defaultItemId) return 3;
    return 4;
  };
  candidates.sort((left, right) => score(left) - score(right));
  return candidates;
}

function selectorState(selector, assignments) {
  if (!assignments.has(selector.partId)) return 'unknown';
  const selected = assignments.get(selector.partId);
  if (!selected) return 'miss';
  if (selector.itemId && selected.itemId !== selector.itemId) return 'miss';
  if (selector.itemIds?.length && !selector.itemIds.includes(selected.itemId)) return 'miss';
  if (selector.variantId && selected.variantId !== selector.variantId) return 'miss';
  if (selector.variantIds?.length && !selector.variantIds.includes(selected.variantId)) return 'miss';
  return 'match';
}

function conditionState(condition, assignments) {
  if (condition == null) return 'match';
  if (typeof condition === 'boolean') return condition ? 'match' : 'miss';
  if (Array.isArray(condition)) {
    const states = condition.map((entry) => conditionState(entry, assignments));
    if (states.includes('miss')) return 'miss';
    return states.includes('unknown') ? 'unknown' : 'match';
  }
  if (condition?.op === 'selected') return selectorState(normalizeRuleSelector(condition), assignments);
  if (condition?.op === 'not') {
    const state = conditionState(condition.condition, assignments);
    return state === 'unknown' ? 'unknown' : state === 'match' ? 'miss' : 'match';
  }
  if (condition?.op === 'all') return conditionState(asArray(condition.conditions), assignments);
  if (condition?.op === 'any') {
    const states = asArray(condition.conditions).map((entry) => conditionState(entry, assignments));
    if (states.includes('match')) return 'match';
    return states.includes('unknown') ? 'unknown' : 'miss';
  }
  if (typeof condition === 'string' || condition?.partId || condition?.partKey || condition?.part) {
    return selectorState(normalizeRuleSelector(condition), assignments);
  }
  if (condition && typeof condition === 'object') {
    const all = asArray(condition.all ?? condition.requires);
    const any = asArray(condition.any);
    const not = asArray(condition.not ?? condition.excludes);
    const allStates = all.map((entry) => conditionState(entry, assignments));
    if (allStates.includes('miss')) return 'miss';
    const anyStates = any.map((entry) => conditionState(entry, assignments));
    if (any.length && anyStates.every((state) => state === 'miss')) return 'miss';
    const notStates = not.map((entry) => conditionState(entry, assignments));
    if (notStates.includes('match')) return 'miss';
    if (allStates.includes('unknown') || anyStates.includes('unknown') || notStates.includes('unknown')) return 'unknown';
    return 'match';
  }
  return 'miss';
}

function parentActiveState(part, assignments) {
  const parentPartId = String(part?.parentPartId ?? part?.parentPartKey ?? '');
  if (!parentPartId) return 'match';
  const selector = {
    partId: parentPartId,
    ...(normalizeIdList(part?.parentItemIds ?? part?.parentItemKeys).length
      ? { itemIds: normalizeIdList(part?.parentItemIds ?? part?.parentItemKeys) }
      : {}),
  };
  return selectorState(selector, assignments);
}

function partialRulesValid(index, assignments) {
  return index.rules.every((rule) => {
    const trigger = selectorState(rule.trigger, assignments);
    if (trigger !== 'match') return true;
    return rule.targets.every((target) => {
      const targetState = selectorState(target, assignments);
      if (rule.type === 'requires') return targetState !== 'miss';
      return targetState !== 'match';
    });
  });
}

function selectedDefinitionVisibleState(index, selection, assignments) {
  if (!selection) return 'match';
  const item = index.itemByPart.get(selection.partId)?.get(selection.itemId);
  const itemState = conditionState(item?.visibleWhen, assignments);
  if (itemState === 'miss') return 'miss';
  const variant = selection.variantId
    ? index.variantByItem.get(`${selection.partId}/${selection.itemId}`)?.get(selection.variantId)
    : null;
  const variantState = conditionState(variant?.visibleWhen, assignments);
  if (variantState === 'miss') return 'miss';
  return itemState === 'unknown' || variantState === 'unknown' ? 'unknown' : 'match';
}

function partialVisibilityValid(index, assignments) {
  return index.parts.every((part) => {
    const partId = partIdOf(part);
    if (!assignments.has(partId)) return true;
    const selected = assignments.get(partId);
    if (!selected) return true;
    if (conditionState(part?.visibleWhen, assignments) === 'miss') return false;
    return selectedDefinitionVisibleState(index, selected, assignments) !== 'miss';
  });
}

function evaluateAssignments(index, assignments, initialIssues = []) {
  const violations = [...initialIssues];
  index.parts.forEach((part) => {
    const partId = partIdOf(part);
    const hierarchyActive = parentActiveState(part, assignments) === 'match';
    const visible = conditionState(part?.visibleWhen, assignments) === 'match';
    const active = hierarchyActive && visible;
    const selected = assignments.get(partId) || null;
    if (!hierarchyActive && selected) violations.push({ code: 'inactive-child-part', partId, parentPartId: part.parentPartId ?? part.parentPartKey });
    else if (!visible && selected) violations.push({ code: 'hidden-part-selected', partId });
    if (active && isRequiredPart(part) && !selected) violations.push({ code: 'required-part-missing', partId });
    if (selected && selectedDefinitionVisibleState(index, selected, assignments) !== 'match') {
      violations.push({ code: 'hidden-item-or-variant-selected', partId, itemId: selected.itemId, variantId: selected.variantId });
    }
  });
  index.rules.forEach((rule) => {
    if (selectorState(rule.trigger, assignments) !== 'match') return;
    rule.targets.forEach((target) => {
      const targetMatches = selectorState(target, assignments) === 'match';
      if (rule.type === 'requires' && !targetMatches) violations.push({ code: 'requires-rule', ruleId: rule.id, trigger: rule.trigger, target });
      if (rule.type === 'excludes' && targetMatches) violations.push({ code: 'excludes-rule', ruleId: rule.id, trigger: rule.trigger, target });
    });
  });
  return violations;
}

function sanitizedAssignments(index, parsed) {
  const assignments = new Map();
  const issues = [...parsed.issues];
  parsed.selection.forEach((selection, partId) => {
    const part = index.partById.get(partId);
    if (!part) {
      issues.push({ code: 'unknown-part', partId });
      return;
    }
    if (!selection) {
      assignments.set(partId, null);
      return;
    }
    const item = index.itemByPart.get(partId).get(selection.itemId);
    if (!item || !isPublishedItem(item)) {
      issues.push({ code: 'unknown-item', partId, itemId: selection.itemId });
      assignments.set(partId, null);
      return;
    }
    const variants = index.variantByItem.get(`${partId}/${selection.itemId}`);
    let variantId = selection.variantId;
    if (variants.size) {
      if (variantId && !variants.has(variantId)) issues.push({ code: 'unknown-variant', partId, itemId: selection.itemId, variantId });
      if (!variants.has(variantId)) variantId = itemDefaultVariantId(item);
    } else {
      variantId = '';
    }
    assignments.set(partId, {
      partId,
      itemId: selection.itemId,
      ...(variantId ? { variantId } : {}),
      ...normalizeColor(part, selection),
    });
  });
  return { assignments, issues };
}

function canonicalRecipe(index, assignments) {
  return index.parts.flatMap((part) => {
    const selected = assignments.get(partIdOf(part));
    return selected ? [{ ...selected }] : [];
  });
}

function selectionRecord(assignments) {
  return Object.fromEntries([...assignments].filter(([, value]) => value).map(([key, value]) => [key, { ...value }]));
}

function sameSelection(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function shuffle(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function solve(index, desired, options = {}) {
  const assignments = new Map();
  const random = typeof options.random === 'function' ? options.random : null;
  const lockedPartIds = new Set([
    ...asArray(options.lockedPartIds),
    ...(options.preferPartId ? [options.preferPartId] : []),
  ].map(String));
  const maxNodes = Number.isSafeInteger(options.maxNodes) ? options.maxNodes : 100_000;
  let visitedNodes = 0;

  function visit(partIndex) {
    if (visitedNodes >= maxNodes) return null;
    visitedNodes += 1;
    if (partIndex >= index.parts.length) {
      return evaluateAssignments(index, assignments).length ? null : new Map(assignments);
    }
    const part = index.parts[partIndex];
    const partId = partIdOf(part);
    const activeState = parentActiveState(part, assignments);
    if (activeState === 'unknown') return null;
    let candidates;
    if (activeState === 'miss') {
      candidates = [null];
    } else {
      const desiredSelection = desired.get(partId) || null;
      candidates = selectionCandidates(index, part, desiredSelection, random);
      const locked = lockedPartIds.has(partId) && desired.has(partId);
      if (locked) {
        if (!desiredSelection) candidates = [null];
        else candidates = candidates.filter((candidate) => (
          candidate.itemId === desiredSelection.itemId
          && (!desiredSelection.variantId || candidate.variantId === desiredSelection.variantId)
        ));
      }
      const optional = !isRequiredPart(part) || part.visibleWhen != null;
      if (random && !locked) {
        candidates = shuffle(candidates, random);
        if (optional) {
          const selectionProbability = Number.isFinite(Number(options.optionalSelectionProbability))
            ? Math.max(0, Math.min(1, Number(options.optionalSelectionProbability)))
            : 0.85;
          if (random() < selectionProbability) candidates.push(null);
          else candidates.unshift(null);
        }
      } else if (!locked && optional && desired.has(partId) && !desiredSelection) {
        candidates.unshift(null);
      } else if (!locked && optional && !desired.has(partId)) {
        candidates.unshift(null);
      } else if (!locked && optional) {
        candidates.push(null);
      }
    }
    for (const candidate of candidates) {
      assignments.set(partId, candidate);
      if (partialRulesValid(index, assignments) && partialVisibilityValid(index, assignments)) {
        const result = visit(partIndex + 1);
        if (result) return result;
      }
    }
    assignments.delete(partId);
    return null;
  }

  return { assignments: visit(0), visitedNodes, exhausted: visitedNodes >= maxNodes };
}

function inputWithMakerDefaults(maker, input) {
  const defaults = parseRecipeInput(maker?.defaultRecipe ?? maker?.template?.defaultRecipe ?? []);
  input.selection.forEach((value, partId) => defaults.selection.set(partId, value));
  defaults.issues.push(...input.issues);
  return defaults;
}

/**
 * Repair an arbitrary input into the closest deterministic valid recipe.
 * Returns diagnostics instead of silently changing invalid input.
 */
export function normalizeRecipe(maker, recipe, options = {}) {
  const index = options.index || createMakerRuleIndex(maker);
  const explicit = parseRecipeInput(recipe);
  const desired = inputWithMakerDefaults(maker, explicit);
  const sanitized = sanitizedAssignments(index, desired);
  const solved = solve(index, sanitized.assignments, options);
  const normalizedColors = normalizeRecipeColors(maker, recipe);
  if (!solved.assignments) {
    const violations = [
      ...evaluateAssignments(index, sanitized.assignments, sanitized.issues),
      { code: solved.exhausted ? 'constraint-search-limit' : 'unsatisfiable-maker' },
    ];
    if (options.strict) throw new MakerRuleError('Maker constraints do not admit a valid recipe.', 'unsatisfiable-maker', { violations });
    return {
      valid: false,
      recipe: canonicalRecipe(index, sanitized.assignments),
      selection: selectionRecord(sanitized.assignments),
      changes: [],
      colors: normalizedColors.colors,
      documentRecipe: { selections: canonicalRecipe(index, sanitized.assignments), colors: normalizedColors.colors },
      inputViolations: [...sanitized.issues, ...normalizedColors.issues],
      violations,
      visitedNodes: solved.visitedNodes,
    };
  }
  const changes = [...sanitized.issues.map((issue) => ({ ...issue, reason: 'discarded-invalid-input' }))];
  index.parts.forEach((part) => {
    const partId = partIdOf(part);
    const before = explicit.selection.has(partId) ? explicit.selection.get(partId) : null;
    const after = solved.assignments.get(partId) || null;
    if (!sameSelection(before, after)) changes.push({ code: 'selection-normalized', partId, before, after });
  });
  return {
    valid: true,
    recipe: canonicalRecipe(index, solved.assignments),
    colors: normalizedColors.colors,
    documentRecipe: { selections: canonicalRecipe(index, solved.assignments), colors: normalizedColors.colors },
    selection: selectionRecord(solved.assignments),
    changes,
    inputViolations: [...sanitized.issues, ...normalizedColors.issues],
    violations: [],
    visitedNodes: solved.visitedNodes,
  };
}

/** Validate a recipe exactly as supplied; this function never repairs it. */
export function evaluateRecipe(maker, recipe, options = {}) {
  const index = options.index || createMakerRuleIndex(maker);
  const sanitized = sanitizedAssignments(index, parseRecipeInput(recipe));
  index.parts.forEach((part) => {
    if (!sanitized.assignments.has(partIdOf(part))) sanitized.assignments.set(partIdOf(part), null);
  });
  const normalizedColors = normalizeRecipeColors(maker, recipe, { exact: true });
  const violations = evaluateAssignments(index, sanitized.assignments, [...sanitized.issues, ...normalizedColors.issues]);
  return {
    valid: violations.length === 0,
    recipe: canonicalRecipe(index, sanitized.assignments),
    colors: normalizedColors.colors,
    documentRecipe: { selections: canonicalRecipe(index, sanitized.assignments), colors: normalizedColors.colors },
    selection: selectionRecord(sanitized.assignments),
    violations,
  };
}

/** Generate a random recipe while solving constraints, rather than repairing after randomization. */
export function generateValidRecipe(maker, options = {}) {
  const index = options.index || createMakerRuleIndex(maker);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const solved = solve(index, new Map(), { ...options, random });
  if (!solved.assignments) {
    throw new MakerRuleError(
      solved.exhausted ? 'Random recipe search reached its safety limit.' : 'Maker has no valid random recipe.',
      solved.exhausted ? 'constraint-search-limit' : 'unsatisfiable-maker',
      { visitedNodes: solved.visitedNodes },
    );
  }
  const normalizedColors = normalizeRecipeColors(maker, {}, { random });
  return {
    valid: true,
    recipe: canonicalRecipe(index, solved.assignments),
    colors: normalizedColors.colors,
    documentRecipe: { selections: canonicalRecipe(index, solved.assignments), colors: normalizedColors.colors },
    selection: selectionRecord(solved.assignments),
    violations: [],
    visitedNodes: solved.visitedNodes,
  };
}

/** Evaluate the shared all/any/not (or requires/excludes) condition language. */
export function evaluateVisibleWhen(condition, recipe) {
  const assignments = recipe?.selection
    ? new Map(Object.entries(recipe.selection))
    : parseRecipeInput(recipe).selection;
  return conditionState(condition, assignments) === 'match';
}

/** Determine whether a LayerBinding should render for the current recipe. */
export function isLayerVisible(binding, recipe) {
  if (!binding || binding.hidden === true || binding.enabled === false) return false;
  const assignments = recipe?.selection
    ? new Map(Object.entries(recipe.selection))
    : parseRecipeInput(recipe).selection;
  const ownerSelector = normalizeRuleSelector({
    partId: binding.partId ?? binding.partKey,
    itemId: binding.itemId ?? binding.itemKey,
    variantId: binding.variantId ?? binding.variantKey ?? binding.styleId,
  });
  if (ownerSelector.partId && selectorState(ownerSelector, assignments) !== 'match') return false;
  const condition = binding.visibleWhen ?? binding.visibilityCondition ?? binding.rules?.visibleWhen;
  return conditionState(condition, assignments) === 'match';
}
