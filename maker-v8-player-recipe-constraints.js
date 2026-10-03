import { makerV8RecipeConstraintIssue } from './maker-v8-recipe-constraints.js';
import { makerV8RuleIssue } from './maker-v8-rules.js';
import { makerV8PlayerPart, makerV8PlayerSelectorMatcher } from './maker-v8-player-definition-resolution.js';

/** Certified Player counterpart to Runtime's scoped_pack_selector_contains.
 * It consumes certified context; local author testing keeps its original model. */
export function makerV8PlayerRecipeConstraintIssue(player, selections) {
  const resolved = new Map(), counts = new Map();
  for (const selection of selections) {
    const part = makerV8PlayerPart(player, selection);
    if (!part) return { code: 'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID', message: 'Selection lacks its exact Part definition.' };
    const key = JSON.stringify([part.sourceId, selection.partKey]);
    const count = (counts.get(key) ?? 0) + 1;
    if (count > part.definition.capacity) return { code: 'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID', message: 'Scoped Part capacity is exceeded.' };
    counts.set(key, count); resolved.set(selection, part);
  }
  // Root required Parts, Rules and visibility only inspect Root slot ranges.
  const rootIssue = makerV8RecipeConstraintIssue(player.document,
    selections.filter(selection => resolved.get(selection).sourceId === player.rootId));
  if (rootIssue) return rootIssue;
  const context = player.definitionContext;
  if (!context) return null;
  const active = new Set(context.currentLoadout?.layout.bindings.map(row => row.releaseId) ?? []);
  for (const selection of selections) if (selection.source === 'PACK') active.add(selection.releaseId);
  for (const releaseId of active) {
    const packs = context.packs.filter(pack => pack.releaseId === releaseId);
    // Plain Packs have no authored rule bundle. A retained attachment always does.
    if (!packs.length && !context.currentLoadout?.layout.bindings.some(row => row.releaseId === releaseId)
      && !player.contextualChoices?.packStyles.some(row => row.releaseId === releaseId && row.definitionCommitment)) continue;
    if (packs.length !== 1 || !Array.isArray(packs[0].ownedParts) || !Array.isArray(packs[0].rules)) {
      return { code: 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID', message: 'Attached or selected Pack rule definitions are unavailable.' };
    }
    const pack = packs[0];
    const attachment = context.currentLoadout?.layout.bindings.find(row => row.releaseId === releaseId);
    if (attachment && attachment.definitionCommitment !== pack.definitionCommitment
      || player.contextualChoices?.packStyles.some(row => row.releaseId === releaseId
        && row.definitionCommitment && row.definitionCommitment !== pack.definitionCommitment)) {
      return { code: 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID', message: 'Pack rules differ from the exact attachment or choice commitment.' };
    }
    const issue = makerV8RuleIssue(pack.rules, selections, makerV8PlayerSelectorMatcher(player, releaseId));
    if (issue) return issue;
  }
  return null;
}
