import { makerV8PlayerColor } from './maker-v8-player-definition-resolution.js';

// A Root preset and a Pack-owned preset are distinct recipe variants, not
// alternate runtime versions. Raw channel/swatch protocol keys never change.
export function makerV8PlayerColorFields(entry) {
  return Object.hasOwn(entry ?? {}, 'releaseId')
    ? ['channelKey', 'swatchKey', 'releaseId'] : ['channelKey', 'swatchKey'];
}

export function makerV8PlayerColorKey(entry) {
  return JSON.stringify([entry.releaseId ?? null, entry.channelKey]);
}

export function makerV8PlayerColorControlKey(entry) {
  return `${entry.releaseId ? `pack:${entry.releaseId}:` : ''}${entry.channelKey}:${entry.swatchKey}`;
}

export function makerV8PlayerColorEntry(player, selection, swatchKey) {
  const resolved = makerV8PlayerColor(player, selection);
  if (!resolved) throw new TypeError('Color has no exact certified definition.');
  return { channelKey: selection.colorChannelKey, swatchKey,
    ...(resolved.sourceId === player.rootId ? {} : { releaseId: resolved.sourceId }) };
}

export function makerV8PlayerColorDefinition(player, entry) {
  if (!Object.hasOwn(entry, 'releaseId')) {
    const rows = player.document.colors.filter(row => row.key === entry.channelKey);
    return rows.length === 1 ? rows[0] : null;
  }
  if (!/^0x[0-9a-f]{64}$/.test(entry.releaseId) || entry.releaseId === player.rootId) return null;
  const choices = (player.contextualChoices?.packStyles ?? []).filter(choice => choice.releaseId === entry.releaseId
    && choice.colorChannelKey === entry.channelKey);
  for (const choice of choices) {
    const resolved = makerV8PlayerColor(player, choice);
    if (resolved?.sourceId === entry.releaseId) return resolved.definition;
  }
  return null;
}

export function makerV8PlayerColorMap(player, entries) {
  const colors = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== makerV8PlayerColorFields(entry).sort().join(',')
      || typeof entry.channelKey !== 'string' || !entry.channelKey
      || typeof entry.swatchKey !== 'string' || !entry.swatchKey) throw new TypeError('Invalid recipe Color record.');
    const key = makerV8PlayerColorKey(entry);
    const channel = makerV8PlayerColorDefinition(player, entry);
    if (colors.has(key) || !channel?.swatches.some(row => row.key === entry.swatchKey)) {
      throw new TypeError('Recipe Color is unknown or duplicated in its exact definition scope.');
    }
    colors.set(key, entry.swatchKey);
  }
  return colors;
}

export function makerV8PlayerSwatchKey(player, colors, selection) {
  if (selection.colorChannelKey === null) return null;
  const entry = makerV8PlayerColorEntry(player, selection, selection.defaultSwatchKey);
  return colors.get(makerV8PlayerColorKey(entry)) ?? selection.defaultSwatchKey;
}
