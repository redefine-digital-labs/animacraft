import {
  createMakerRuleIndex,
  evaluateRecipe,
  evaluateVisibleWhen,
  generateValidRecipe,
  normalizeRecipe,
} from './maker-rules.js';

/**
 * Pure Player Editor option evaluation.
 *
 * The rule solver is allowed to repair arbitrary recipes, but a player's click
 * must never silently rewrite another Part. Therefore an option is selectable
 * only when the exact candidate recipe is valid. `normalizeRecipe` is still
 * run for invalid candidates to expose whether the solver could only make the
 * click valid by changing another Part.
 */

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function stringId(value) {
  return String(value ?? '');
}

function makerParts(maker) {
  return Array.isArray(maker?.parts) ? maker.parts : [];
}

function partItems(part) {
  return Array.isArray(part?.items) ? part.items : [];
}

function itemStyles(item) {
  return Array.isArray(item?.styles) ? item.styles : [];
}

function partIdOf(part) {
  return stringId(part?.id ?? part?.key);
}

function itemIdOf(item) {
  return stringId(item?.id ?? item?.key);
}

function styleIdOf(style) {
  return stringId(style?.id ?? style?.key);
}

function findPart(maker, partId) {
  return makerParts(maker).find((part) => partIdOf(part) === stringId(partId)) || null;
}

function findItem(part, itemId) {
  return partItems(part).find((item) => itemIdOf(item) === stringId(itemId)) || null;
}

function findStyle(item, styleId) {
  return itemStyles(item).find((style) => styleIdOf(style) === stringId(styleId)) || null;
}

function selectionMap(recipe) {
  return new Map((recipe?.selections || []).map((selection) => [
    stringId(selection?.partId ?? selection?.partKey),
    clone(selection),
  ]));
}

function sameSelection(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function recipeWithCandidate(context, candidate) {
  const selections = selectionMap(context.currentRecipe);
  selections.set(candidate.partId, clone(candidate));
  return {
    selections: makerParts(context.maker).flatMap((part) => {
      const selection = selections.get(partIdOf(part));
      return selection ? [selection] : [];
    }),
    colors: clone(context.currentRecipe.colors || []),
  };
}

function selectorMatchesCandidate(selector, candidate) {
  if (!selector || stringId(selector.partId) !== candidate.partId) return false;
  if (selector.itemId && stringId(selector.itemId) !== candidate.itemId) return false;
  if (Array.isArray(selector.itemIds) && selector.itemIds.length
    && !selector.itemIds.map(stringId).includes(candidate.itemId)) return false;
  if (selector.styleId && stringId(selector.styleId) !== candidate.styleId) return false;
  if (Array.isArray(selector.styleIds) && selector.styleIds.length
    && !selector.styleIds.map(stringId).includes(candidate.styleId)) return false;
  return true;
}

function violationSignature(violation) {
  return JSON.stringify({
    code: violation?.code,
    partId: violation?.partId,
    itemId: violation?.itemId,
    styleId: violation?.styleId,
    ruleId: violation?.ruleId,
    trigger: violation?.trigger,
    target: violation?.target,
  });
}

function violationRelevance(violation, candidate) {
  if (stringId(violation?.partId) === candidate.partId) return 0;
  if (selectorMatchesCandidate(violation?.trigger, candidate)) return 0;
  if (selectorMatchesCandidate(violation?.target, candidate)) return 0;
  if (violation?.code === 'requires-rule' || violation?.code === 'excludes-rule') return 1;
  return 2;
}

function firstCandidateViolation(context, evaluation, candidate) {
  const baseline = new Set(context.currentEvaluation.violations.map(violationSignature));
  const newViolations = evaluation.violations.filter((entry) => !baseline.has(violationSignature(entry)));
  const candidates = newViolations.length ? newViolations : evaluation.violations;
  return candidates
    .map((entry, order) => ({ entry, order, relevance: violationRelevance(entry, candidate) }))
    .sort((left, right) => left.relevance - right.relevance || left.order - right.order)[0]?.entry || null;
}

function selectorLabel(maker, selector) {
  const part = findPart(maker, selector?.partId);
  const item = part && (selector?.itemId
    ? findItem(part, selector.itemId)
    : Array.isArray(selector?.itemIds) && selector.itemIds.length === 1
      ? findItem(part, selector.itemIds[0])
      : null);
  const style = item && (selector?.styleId
    ? findStyle(item, selector.styleId)
    : Array.isArray(selector?.styleIds) && selector.styleIds.length === 1
      ? findStyle(item, selector.styleIds[0])
      : null);
  const labels = [
    part?.name || selector?.partId,
    item?.name || selector?.itemId,
    style?.name || selector?.styleId,
  ].filter(Boolean);
  return labels.join(' › ') || 'the required option';
}

/**
 * Convert a rule-engine violation into stable UI-facing code and readable
 * English fallback copy. Callers may translate by `code`.
 */
export function formatPlayerOptionReason(maker, violation, candidate = null) {
  const code = stringId(violation?.code || 'invalid-combination');
  const displayTarget = candidate
    && selectorMatchesCandidate(violation?.target, candidate)
    && !selectorMatchesCandidate(violation?.trigger, candidate)
    ? violation.trigger
    : violation?.target;
  let message;
  if (code === 'requires-rule') {
    message = `Requires ${selectorLabel(maker, displayTarget)}.`;
  } else if (code === 'excludes-rule') {
    message = `Cannot be combined with ${selectorLabel(maker, displayTarget)}.`;
  } else if (code === 'inactive-child-part') {
    const parent = findPart(maker, violation.parentPartId);
    message = `Choose a compatible ${parent?.name || violation.parentPartId || 'parent Part'} first.`;
  } else if (code === 'hidden-item-or-style-selected' || code === 'hidden-part-selected') {
    message = 'This option is unavailable with the current choices.';
  } else if (code === 'required-part-missing') {
    const part = findPart(maker, violation.partId);
    message = `${part?.name || violation.partId || 'A required Part'} must be selected.`;
  } else if (code === 'unknown-item' || code === 'unknown-style' || code === 'missing-style') {
    message = 'This option no longer exists in this Maker version.';
  } else if (code === 'unsatisfiable-maker' || code === 'constraint-search-limit') {
    message = 'This option cannot form a valid combination.';
  } else {
    message = 'This option is unavailable with the current choices.';
  }
  return {
    code,
    message,
    ...(violation?.ruleId ? { ruleId: stringId(violation.ruleId) } : {}),
    details: clone({
      ...(violation || {}),
      ...(displayTarget ? { displayTarget } : {}),
    }),
  };
}

function localReason(code, message, details = {}) {
  return { code, message, details: clone(details) };
}

function optionResult(base, { visible, selectable, reason = null, nextRecipe = null, diagnostics = null }) {
  return {
    ...base,
    visible: Boolean(visible),
    selectable: Boolean(selectable),
    disabled: !selectable,
    selected: Boolean(base.selected),
    reason,
    reasonCode: reason?.code || null,
    reasonText: reason?.message || '',
    nextRecipe: nextRecipe ? clone(nextRecipe) : null,
    ...(diagnostics ? { diagnostics: clone(diagnostics) } : {}),
  };
}

function isPublishedItem(item, options) {
  if (item?.enabled === false) return false;
  if (options.includeNonPublicItems === true) return true;
  return stringId(item?.status ?? item?.visibility ?? 'public').toLowerCase() === 'public';
}

function assetDescriptor(maker, assetId) {
  return (Array.isArray(maker?.assets) ? maker.assets : [])
    .find((asset) => stringId(asset?.id ?? asset?.assetId) === assetId) || null;
}

function stylePngStatus(maker, style, options) {
  const assetId = stringId(style?.assetId).trim();
  if (!assetId) {
    return {
      valid: false,
      reason: localReason('missing-style-png', 'This style has no PNG artwork.', {
        styleId: styleIdOf(style),
      }),
    };
  }
  if (typeof options.isAssetAvailable === 'function') {
    const available = options.isAssetAvailable(assetId, style, maker);
    if (available === false) {
      return {
        valid: false,
        reason: localReason('missing-style-png', 'This style’s PNG artwork is unavailable.', {
          styleId: styleIdOf(style),
          assetId,
        }),
      };
    }
    if (available === true) return { valid: true, assetId };
  }
  const descriptor = assetDescriptor(maker, assetId);
  if (!descriptor) {
    if (options.acceptUnresolvedAssetIds === true) return { valid: true, assetId };
    return {
      valid: false,
      reason: localReason('missing-style-png', 'This style’s PNG artwork is unavailable.', {
        styleId: styleIdOf(style),
        assetId,
      }),
    };
  }
  const mediaType = stringId(descriptor.mediaType ?? descriptor.type).toLowerCase();
  if (mediaType && mediaType !== 'image/png') {
    return {
      valid: false,
      reason: localReason('invalid-style-png', 'This style does not reference a PNG asset.', {
        styleId: styleIdOf(style),
        assetId,
        mediaType,
      }),
    };
  }
  return { valid: true, assetId };
}

function buildContext(maker, recipe, options) {
  const effectiveMaker = options.includeNonPublicItems === true
    ? (() => {
        const draft = clone(maker);
        makerParts(draft).forEach((part) => partItems(part).forEach((item) => {
          if (item?.enabled !== false) item.status = 'public';
        }));
        return draft;
      })()
    : maker;
  const index = options.index || createMakerRuleIndex(effectiveMaker);
  const currentEvaluation = evaluateRecipe(effectiveMaker, recipe, { index });
  return {
    maker: effectiveMaker,
    options,
    index,
    currentEvaluation,
    currentRecipe: clone(currentEvaluation.documentRecipe),
    currentSelections: selectionMap(currentEvaluation.documentRecipe),
  };
}

function repairDiagnostics(context, candidateRecipe, candidate) {
  const lockedPartIds = [...new Set([
    candidate.partId,
    ...context.currentSelections.keys(),
  ])];
  const normalized = normalizeRecipe(context.maker, candidateRecipe, {
    index: context.index,
    preferPartId: candidate.partId,
    lockedPartIds,
  });
  const normalizedSelections = selectionMap(normalized.documentRecipe);
  const changedOtherPartIds = makerParts(context.maker)
    .map(partIdOf)
    .filter((partId) => partId !== candidate.partId)
    .filter((partId) => !sameSelection(
      context.currentSelections.get(partId),
      normalizedSelections.get(partId),
    ));
  return {
    normalizationValid: normalized.valid,
    wouldChangeOtherPartIds: changedOtherPartIds,
  };
}

function evaluateStyleWithContext(context, ids) {
  const partId = stringId(ids?.partId);
  const itemId = stringId(ids?.itemId);
  const styleId = stringId(ids?.styleId);
  const part = findPart(context.maker, partId);
  const item = part && findItem(part, itemId);
  const style = item && findStyle(item, styleId);
  const selected = context.currentSelections.get(partId);
  const base = {
    kind: 'style',
    partId,
    itemId,
    styleId,
    name: stringId(style?.name || styleId),
    selected: Boolean(selected?.itemId === itemId && selected?.styleId === styleId),
  };

  if (!part) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('unknown-part', 'This Part no longer exists.', { partId }),
    });
  }
  if (!item) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('unknown-item', 'This item no longer exists.', { partId, itemId }),
    });
  }
  if (!style) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('unknown-style', 'This style no longer exists.', { partId, itemId, styleId }),
    });
  }
  if (!isPublishedItem(item, context.options)) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('unpublished-item', 'This item is not available to players.', { partId, itemId }),
    });
  }

  const png = stylePngStatus(context.maker, style, context.options);
  if (!png.valid) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: png.reason,
    });
  }

  const candidate = { partId, itemId, styleId };
  const candidateRecipe = recipeWithCandidate(context, candidate);
  const itemVisible = evaluateVisibleWhen(item.visibleWhen, candidateRecipe);
  const styleVisible = evaluateVisibleWhen(style.visibleWhen, candidateRecipe);
  if (!itemVisible || !styleVisible) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('hidden-item-or-style-selected', 'This option is unavailable with the current choices.', {
        partId,
        itemId,
        styleId,
        owner: itemVisible ? 'style' : 'item',
      }),
    });
  }

  const evaluation = evaluateRecipe(context.maker, candidateRecipe, { index: context.index });
  if (evaluation.valid) {
    return optionResult(base, {
      visible: true,
      selectable: true,
      nextRecipe: evaluation.documentRecipe,
    });
  }

  const violation = firstCandidateViolation(context, evaluation, candidate);
  return optionResult(base, {
    visible: true,
    selectable: false,
    reason: formatPlayerOptionReason(context.maker, violation, candidate),
    diagnostics: repairDiagnostics(context, candidateRecipe, candidate),
  });
}

/**
 * Evaluate one Style click without mutating the Maker or current recipe.
 */
export function evaluatePlayerStyleOption(maker, recipe, candidate, options = {}) {
  return evaluateStyleWithContext(buildContext(maker, recipe, options), candidate);
}

function evaluateItemWithContext(context, ids) {
  const partId = stringId(ids?.partId);
  const itemId = stringId(ids?.itemId);
  const part = findPart(context.maker, partId);
  const item = part && findItem(part, itemId);
  const selected = context.currentSelections.get(partId);
  const base = {
    kind: 'item',
    partId,
    itemId,
    name: stringId(item?.name || itemId),
    selected: Boolean(selected?.itemId === itemId),
  };
  if (!part) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('unknown-part', 'This Part no longer exists.', { partId }),
    });
  }
  if (!item) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('unknown-item', 'This item no longer exists.', { partId, itemId }),
    });
  }
  if (!isPublishedItem(item, context.options)) {
    return {
      ...optionResult(base, {
        visible: false,
        selectable: false,
        reason: localReason('unpublished-item', 'This item is not available to players.', { partId, itemId }),
      }),
      styles: itemStyles(item).map((style) => evaluateStyleWithContext(context, {
        partId,
        itemId,
        styleId: styleIdOf(style),
      })),
      preferredStyleId: null,
    };
  }

  const styles = itemStyles(item).map((style) => evaluateStyleWithContext(context, {
    partId,
    itemId,
    styleId: styleIdOf(style),
  }));
  const visibleStyles = styles.filter((style) => style.visible);
  const selectableStyles = visibleStyles.filter((style) => style.selectable);
  const preferred = selectableStyles.find((style) => style.styleId === selected?.styleId)
    || selectableStyles.find((style) => style.styleId === stringId(item.defaultStyleId))
    || selectableStyles[0]
    || null;
  const firstVisible = visibleStyles[0] || null;
  const reason = preferred
    ? null
    : firstVisible?.reason
      || styles[0]?.reason
      || localReason('missing-style-png', 'This item has no playable PNG styles.', { partId, itemId });
  return {
    ...optionResult(base, {
      visible: visibleStyles.length > 0,
      selectable: Boolean(preferred),
      reason,
      nextRecipe: preferred?.nextRecipe || null,
    }),
    styles,
    preferredStyleId: preferred?.styleId || null,
  };
}

/**
 * Evaluate one Item and all of its Style options. An empty default Style does
 * not hide a valid alternative Style; the first selectable alternative becomes
 * `preferredStyleId`.
 */
export function evaluatePlayerItemOption(maker, recipe, candidate, options = {}) {
  return evaluateItemWithContext(buildContext(maker, recipe, options), candidate);
}

/**
 * Compute all Item/Style option states for one Part.
 */
export function buildPlayerPartOptions(maker, recipe, partId, options = {}) {
  const context = buildContext(maker, recipe, options);
  const part = findPart(maker, partId);
  if (!part) {
    return {
      partId: stringId(partId),
      name: stringId(partId),
      visible: false,
      items: [],
      reason: localReason('unknown-part', 'This Part no longer exists.', { partId: stringId(partId) }),
    };
  }
  const current = context.currentSelections.get(partIdOf(part));
  const parentSelection = part.parentPartId
    ? context.currentSelections.get(stringId(part.parentPartId))
    : null;
  const parentItemIds = Array.isArray(part.parentItemIds)
    ? part.parentItemIds.map(stringId)
    : Array.isArray(part.parentItemKeys)
      ? part.parentItemKeys.map(stringId)
      : [];
  const parentActive = !part.parentPartId
    || Boolean(parentSelection && (!parentItemIds.length || parentItemIds.includes(parentSelection.itemId)));
  const partVisible = part.menuVisible !== false
    && parentActive
    && evaluateVisibleWhen(part.visibleWhen, context.currentRecipe);
  return {
    partId: partIdOf(part),
    name: stringId(part.name || partIdOf(part)),
    visible: partVisible,
    selectedItemId: current?.itemId || null,
    items: partItems(part).map((item) => evaluateItemWithContext(context, {
      partId: partIdOf(part),
      itemId: itemIdOf(item),
    })),
    reason: partVisible
      ? null
      : localReason('hidden-part-selected', 'This Part is unavailable with the current choices.', {
        partId: partIdOf(part),
      }),
  };
}

/**
 * Compute the complete Player Editor option model.
 */
export function buildPlayerOptions(maker, recipe, options = {}) {
  const context = buildContext(maker, recipe, options);
  return {
    recipe: clone(context.currentRecipe),
    valid: context.currentEvaluation.valid,
    violations: clone(context.currentEvaluation.violations),
    parts: makerParts(maker).map((part) => {
      const partId = partIdOf(part);
      const current = context.currentSelections.get(partId);
      const parentSelection = part.parentPartId
        ? context.currentSelections.get(stringId(part.parentPartId))
        : null;
      const parentItemIds = Array.isArray(part.parentItemIds)
        ? part.parentItemIds.map(stringId)
        : Array.isArray(part.parentItemKeys)
          ? part.parentItemKeys.map(stringId)
          : [];
      const parentActive = !part.parentPartId
        || Boolean(parentSelection && (!parentItemIds.length || parentItemIds.includes(parentSelection.itemId)));
      const visible = part.menuVisible !== false
        && parentActive
        && evaluateVisibleWhen(part.visibleWhen, context.currentRecipe);
      return {
        partId,
        name: stringId(part.name || partId),
        visible,
        selectedItemId: current?.itemId || null,
        items: partItems(part).map((item) => evaluateItemWithContext(context, {
          partId,
          itemId: itemIdOf(item),
        })),
        reason: visible
          ? null
          : localReason('hidden-part-selected', 'This Part is unavailable with the current choices.', { partId }),
      };
    }),
  };
}

function isRequiredPart(part) {
  return part?.required === true || part?.allowRemove === false || part?.kind === 'last-bastion';
}

function firstTransitionViolation(context, evaluation) {
  const baseline = new Set(context.currentEvaluation.violations.map(violationSignature));
  return evaluation.violations.find((entry) => !baseline.has(violationSignature(entry)))
    || evaluation.violations[0]
    || null;
}

function exactTransitionResult(context, base, nextRecipe) {
  const evaluation = evaluateRecipe(context.maker, nextRecipe, { index: context.index });
  if (evaluation.valid) {
    return optionResult(base, {
      visible: true,
      selectable: true,
      nextRecipe: evaluation.documentRecipe,
    });
  }
  return optionResult(base, {
    visible: true,
    selectable: false,
    reason: formatPlayerOptionReason(
      context.maker,
      firstTransitionViolation(context, evaluation),
    ),
  });
}

/**
 * Evaluate the "None / Remove" action for one optional Part. Descendant Parts
 * are removed with their parent, exactly as the Player UI presents the action.
 */
export function evaluatePlayerRemovePartOption(maker, recipe, partId, options = {}) {
  const context = buildContext(maker, recipe, options);
  const resolvedPartId = stringId(partId);
  const part = findPart(context.maker, resolvedPartId);
  const base = {
    kind: 'remove-part',
    partId: resolvedPartId,
    selected: context.currentSelections.has(resolvedPartId),
  };
  if (!part) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('unknown-part', 'This Part no longer exists.', { partId: resolvedPartId }),
    });
  }
  if (isRequiredPart(part)) {
    return optionResult(base, {
      visible: false,
      selectable: false,
      reason: localReason('required-part', 'This required Part cannot be removed.', { partId: resolvedPartId }),
    });
  }
  if (!context.currentSelections.has(resolvedPartId)) {
    return optionResult(base, {
      visible: true,
      selectable: false,
      reason: localReason('nothing-to-remove', 'This Part is already empty.', { partId: resolvedPartId }),
    });
  }

  const removeIds = new Set([resolvedPartId]);
  let changed = true;
  while (changed) {
    changed = false;
    makerParts(context.maker).forEach((candidate) => {
      const candidateId = partIdOf(candidate);
      const parentId = stringId(candidate?.parentPartId ?? candidate?.parentPartKey);
      if (parentId && removeIds.has(parentId) && !removeIds.has(candidateId)) {
        removeIds.add(candidateId);
        changed = true;
      }
    });
  }
  const nextRecipe = {
    selections: context.currentRecipe.selections.filter((selection) => !removeIds.has(selection.partId)),
    colors: clone(context.currentRecipe.colors || []),
  };
  return exactTransitionResult(context, base, nextRecipe);
}

/**
 * Evaluate the global "Remove optional" action without solver repair. If a
 * required selection depends on an optional Part, the action is disabled.
 */
export function evaluatePlayerClearOptionalOption(maker, recipe, options = {}) {
  const context = buildContext(maker, recipe, options);
  const requiredPartIds = new Set(makerParts(context.maker)
    .filter(isRequiredPart)
    .map(partIdOf));
  const hasOptionalSelection = context.currentRecipe.selections
    .some((selection) => !requiredPartIds.has(selection.partId));
  const base = {
    kind: 'clear-optional',
    selected: false,
  };
  if (!hasOptionalSelection) {
    return optionResult(base, {
      visible: true,
      selectable: false,
      reason: localReason('nothing-to-remove', 'No optional Parts are selected.'),
    });
  }
  const nextRecipe = {
    selections: context.currentRecipe.selections
      .filter((selection) => requiredPartIds.has(selection.partId)),
    colors: clone(context.currentRecipe.colors || []),
  };
  return exactTransitionResult(context, base, nextRecipe);
}

function selectedStyleRecord(maker, selection) {
  const part = findPart(maker, selection?.partId);
  const item = part && findItem(part, selection?.itemId);
  return item && findStyle(item, selection?.styleId);
}

function selectedStyleHasPlayablePng(maker, selection, options) {
  const style = selectedStyleRecord(maker, selection);
  return Boolean(style && stylePngStatus(maker, style, options).valid);
}

/**
 * Repair a rule-valid recipe so every selected Part points at a visible,
 * selectable PNG Style. Existing Item choices are preferred, then another
 * playable Item, then removal of an optional Part.
 */
export function normalizePlayablePlayerRecipe(maker, recipe, options = {}) {
  const effectiveContext = buildContext(maker, recipe, options);
  const ruleNormalized = effectiveContext.currentEvaluation.valid
    ? {
        valid: true,
        documentRecipe: effectiveContext.currentRecipe,
        violations: [],
      }
    : normalizeRecipe(effectiveContext.maker, recipe, { index: effectiveContext.index });
  if (!ruleNormalized.valid) {
    const unplayable = (ruleNormalized.documentRecipe?.selections || []).filter((selection) => (
      !selectedStyleHasPlayablePng(effectiveContext.maker, selection, options)
    ));
    const unplayablePartIds = new Set(unplayable.map((selection) => selection.partId));
    const documentRecipe = {
      selections: (ruleNormalized.documentRecipe?.selections || [])
        .filter((selection) => !unplayablePartIds.has(selection.partId)),
      colors: clone(ruleNormalized.documentRecipe?.colors || []),
    };
    return {
      valid: false,
      documentRecipe: clone(documentRecipe),
      recipe: clone(documentRecipe),
      violations: clone([
        ...(ruleNormalized.violations || []),
        ...unplayable.map((selection) => ({
          code: 'missing-style-png',
          partId: selection.partId,
          itemId: selection.itemId,
          styleId: selection.styleId,
        })),
      ]),
      changes: [],
    };
  }

  let workingRecipe = clone(ruleNormalized.documentRecipe);
  const changes = [];
  const maxPasses = Math.max(1, makerParts(effectiveContext.maker).length * 2);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    const selections = [...(workingRecipe.selections || [])];
    for (const selection of selections) {
      if (selectedStyleHasPlayablePng(effectiveContext.maker, selection, options)) continue;
      const part = findPart(effectiveContext.maker, selection.partId);
      const selectedItem = part && findItem(part, selection.itemId);
      const itemCandidates = [
        ...(selectedItem ? [selectedItem] : []),
        ...partItems(part).filter((item) => item !== selectedItem),
      ];
      let replacement = null;
      for (const item of itemCandidates) {
        const option = evaluatePlayerItemOption(
          effectiveContext.maker,
          workingRecipe,
          { partId: selection.partId, itemId: itemIdOf(item) },
          options,
        );
        if (option.selectable && option.nextRecipe) {
          replacement = option;
          break;
        }
      }
      if (!replacement && part && !isRequiredPart(part)) {
        const removal = evaluatePlayerRemovePartOption(
          effectiveContext.maker,
          workingRecipe,
          selection.partId,
          options,
        );
        if (removal.selectable && removal.nextRecipe) replacement = removal;
      }
      if (!replacement?.nextRecipe) continue;
      const before = clone(selection);
      workingRecipe = clone(replacement.nextRecipe);
      changes.push({
        code: 'playable-selection-normalized',
        partId: selection.partId,
        before,
        after: clone(selectionMap(workingRecipe).get(selection.partId) || null),
      });
      changed = true;
    }
    if (!changed) break;
  }

  const exact = evaluateRecipe(effectiveContext.maker, workingRecipe, {
    index: effectiveContext.index,
  });
  const unplayable = exact.documentRecipe.selections.filter((selection) => (
    !selectedStyleHasPlayablePng(effectiveContext.maker, selection, options)
  ));
  const unplayableKeys = new Set(unplayable.map((selection) => selection.partId));
  const playableDocumentRecipe = unplayable.length
    ? {
        selections: exact.documentRecipe.selections
          .filter((selection) => !unplayableKeys.has(selection.partId)),
        colors: clone(exact.documentRecipe.colors || []),
      }
    : exact.documentRecipe;
  const playableEvaluation = unplayable.length
    ? evaluateRecipe(effectiveContext.maker, playableDocumentRecipe, {
        index: effectiveContext.index,
      })
    : exact;
  const violations = [
    ...playableEvaluation.violations,
    ...unplayable.map((selection) => ({
      code: 'missing-style-png',
      partId: selection.partId,
      itemId: selection.itemId,
      styleId: selection.styleId,
    })),
  ];
  return {
    valid: playableEvaluation.valid && unplayable.length === 0,
    documentRecipe: clone(playableDocumentRecipe),
    recipe: clone(playableDocumentRecipe),
    violations: clone(violations),
    changes,
  };
}

/**
 * Generate a rule-valid recipe and reject/repair any result that selects an
 * empty PNG Style.
 */
export function generatePlayablePlayerRecipe(maker, options = {}) {
  const attempts = Math.max(1, Number(options.maxAttempts || 64));
  const effectiveMaker = buildContext(
    maker,
    maker?.defaultRecipe || { selections: [], colors: [] },
    options,
  ).maker;
  let lastResult = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const generated = generateValidRecipe(effectiveMaker, options);
    lastResult = normalizePlayablePlayerRecipe(
      effectiveMaker,
      generated.documentRecipe,
      options,
    );
    if (lastResult.valid) return { ...lastResult, attempts: attempt + 1 };
  }
  return {
    ...(lastResult || {
      valid: false,
      documentRecipe: { selections: [], colors: [] },
      recipe: { selections: [], colors: [] },
      violations: [],
      changes: [],
    }),
    attempts,
  };
}
