/** Pure selection constraints shared by local testing and certified Player.
 * Callers must first validate their exact document and selection references.
 * This module grants no asset, ownership, publication or transaction authority.
 */
import { makerV8RuleIssue } from './maker-v8-rules.js';
import { evaluateMakerV8Visibility } from './maker-v8-visibility.js';

/** Only BASE Styles belong to this document. Contextual sources keep their own authority. */
export function makerV8InvisibleSelections(document, selections) {
  return selections.filter(selection => {
    if (selection.source && selection.source !== 'BASE') return false;
    const style = document.parts.find(part => part.key === selection.partKey)
      ?.items.find(item => item.key === selection.itemKey)
      ?.styles.find(style => style.key === selection.styleKey);
    return style && !evaluateMakerV8Visibility(style.visibleWhen, selections);
  });
}
const identity = selection => JSON.stringify([selection.partKey, selection.itemKey, selection.styleKey]);

export function makerV8RecipeConstraintIssue(document, selections) {
  return constraintIssue(document, selections, null);
}

/** Local author testing alone may repair an already-invalid default in steps.
 * No newly invisible selected Style is allowed; certified recipes remain strict.
 */
export function makerV8LocalRecipeTransitionIssue(document, selections, previousSelections) {
  return constraintIssue(document, selections,
    new Set(makerV8InvisibleSelections(document, previousSelections).map(identity)));
}

function constraintIssue(document, selections, repairable) {
  const counts = new Map();
  const parts = new Map(document.parts.map((part) => [part.key, part]));
  for (const selection of selections) {
    const count = (counts.get(selection.partKey) || 0) + 1;
    const part = parts.get(selection.partKey);
    if (!part || count > part.capacity) {
      return {
        code: 'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID',
        message: 'Selection Part is unknown or the Part capacity is exceeded.',
      };
    }
    counts.set(selection.partKey, count);
  }
  for (const part of document.parts) {
    if (part.required && !counts.has(part.key)) {
      return {
        code: 'MAKER_V8_PLAYER_REQUIRED_PART_MISSING',
        message: `Required Part ${part.key} is not selected.`,
      };
    }
  }
  const ruleIssue = makerV8RuleIssue(document.rules, selections);
  if (ruleIssue) return ruleIssue;
  const invisible = makerV8InvisibleSelections(document, selections)
    .find(selection => !repairable?.has(identity(selection)));
  return invisible ? {
    code: 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE',
    message: `Selected Style ${invisible.partKey}/${invisible.itemKey}/${invisible.styleKey} does not satisfy its visibility condition.`,
  } : null;
}
