import { makerV8RuleSelectorMatches } from './maker-v8-rules.js';
const selectionFields = ['source', 'partKey', 'itemKey', 'styleKey', 'trackKey',
  'colorChannelKey', 'defaultSwatchKey', 'releaseId', 'semanticPackId', 'externalProductId', 'ownedExternalItemId'];

/** Resolve only from the exact certified Root or the selected Release context.
 * Same-named tracks in another Pack must never supply render order. */
export function makerV8PlayerTrack(player, selection) {
  return resolveDefinition(player, selection, 'track', 'tracks', selection.trackKey)?.definition ?? null;
}

export function makerV8PlayerPart(player, selection) {
  return resolveDefinition(player, selection, 'part', 'parts', selection.partKey);
}

export function makerV8PlayerColor(player, selection) {
  if (selection.colorChannelKey === null) return null;
  return resolveDefinition(player, selection, 'color', 'colors', selection.colorChannelKey);
}

/** Presentation/event identity only; never serialize this as a recipe partKey. */
export function makerV8PlayerPartUiKey(player, selection) {
  const part = makerV8PlayerPart(player, selection);
  if (!part) return null;
  return part.sourceId === player.rootId ? part.definition.key
    : `pack:${part.sourceId}:${part.definition.key}`;
}

/** Runtime selector semantics shared by rule checks and PNG visibility. */
export function makerV8PlayerSelectorMatcher(player, localReleaseId = null) {
  const packs = localReleaseId === null ? [] : (player.definitionContext?.packs ?? [])
    .filter(pack => pack.releaseId === localReleaseId);
  if (packs.length > 1) throw new TypeError('Ambiguous Pack selector definition context.');
  const ownKeys = new Set((packs[0]?.ownedParts ?? []).map(part => part.key));
  return (selector, selection) => {
    const sourceId = ownKeys.has(selector.partKey) ? localReleaseId : player.rootId;
    if (makerV8PlayerPart(player, selection)?.sourceId !== sourceId) return false;
    const local = localReleaseId !== null && selector.source === 'BASE'
      && selection.source === 'PACK' && selection.releaseId === localReleaseId;
    return makerV8RuleSelectorMatches(selector, local ? { ...selection, source: 'BASE' } : selection);
  };
}

function resolveDefinition(player, selection, term, collection, key) {
  const base = () => {
    const definition = player.document[collection].find(row => row.key === key);
    return definition ? { sourceId: player.rootId, definition } : null;
  };
  if (selection.source !== 'PACK') return base();
  const choices = player.contextualChoices?.packStyles;
  if (!choices) return base();
  const matches = choices.filter(row => selectionFields.every(key => row[key] === selection[key]));
  if (matches.length !== 1) return null;
  const choice = matches[0], scope = choice.definitionScope?.[term];
  if (!scope) return base();
  if (scope.key !== key || Object.keys(scope).sort().join(',') !== 'key,source,sourceId') return null;
  if (scope.source === 'BASE') return scope.sourceId === player.rootId ? base() : null;
  const context = player.definitionContext;
  if (scope.source !== 'PACK' || scope.sourceId !== selection.releaseId
    || context?.rootId !== player.rootId || context.address !== player.contextualChoices.address
    || !/^[0-9a-f]{64}$/.test(choice.definitionCommitment) || !Array.isArray(context.packs)) return null;
  const packs = context.packs.filter(pack => pack.releaseId === selection.releaseId
    && pack.semanticPackId === selection.semanticPackId && pack.definitionCommitment === choice.definitionCommitment);
  if (packs.length !== 1) return null;
  const refs = packs[0].styleReferences.filter(row => row.part.key === selection.partKey
    && row.itemKey === selection.itemKey && row.styleKey === selection.styleKey);
  if (refs.length !== 1 || refs[0][term]?.scope !== 'PACK_SELF' || refs[0][term]?.key !== scope.key) return null;
  const rows = (packs[0].document[collection] ?? []).filter(row => row.key === scope.key);
  return rows.length === 1 ? { sourceId: selection.releaseId, definition: rows[0] } : null;
}
