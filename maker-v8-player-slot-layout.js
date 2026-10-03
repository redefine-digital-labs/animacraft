import { makerV8PlayerPart } from './maker-v8-player-definition-resolution.js';
const ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function fail() {
  throw Object.assign(new TypeError('Player slot layout requires exact ordered definition identities and capacities.'),
    { code: 'MAKER_V8_PLAYER_SLOT_LAYOUT_INVALID' });
}

/** Pure projection of certified definitions, not a chain authenticator.
 * Root Parts use canonical menu order; Pack profiles keep attachment/row order,
 * including attachments with no Parts. Never sort Packs by display name/ID or
 * derive the layout from only currently selected artwork. */
export function makerV8PlayerSlotLayout({ rootId, parts, packDefinitionLayout = { bindings: [], profiles: [] }, pendingPacks = [] }) {
  if (typeof rootId !== 'string' || !ID.test(rootId) || !Array.isArray(parts) || !packDefinitionLayout
    || !Array.isArray(packDefinitionLayout.bindings) || !Array.isArray(packDefinitionLayout.profiles)
    || packDefinitionLayout.bindings.length > 500 || !Array.isArray(pendingPacks)) fail();
  const rows = [], seen = new Set();
  let nextSlot = 0;
  const append = (sourceId, partKey, capacity) => {
    const identity = JSON.stringify([sourceId, partKey]);
    if (typeof partKey !== 'string' || !KEY.test(partKey) || seen.has(identity) || !Number.isSafeInteger(capacity)
      || capacity < 1 || capacity > 64 || nextSlot + capacity > 500) fail();
    seen.add(identity);
    rows.push(Object.freeze({ sourceId, partKey, capacity, start: nextSlot }));
    nextSlot += capacity;
  };
  if (parts.some(part => !part || !Number.isSafeInteger(part.menuOrder))) fail();
  for (const part of [...parts].sort((a, b) => a.menuOrder - b.menuOrder
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) append(rootId, part.key, part.capacity);
  const bindings = new Map();
  for (const [index, binding] of packDefinitionLayout.bindings.entries()) {
    if (!binding || !ID.test(binding.releaseId) || binding.releaseId === rootId
      || !HASH.test(binding.definitionCommitment) || bindings.has(binding.releaseId)) fail();
    bindings.set(binding.releaseId, index);
  }
  let priorBinding = -1;
  for (const profile of packDefinitionLayout.profiles) {
    const binding = bindings.get(profile?.releaseId);
    if (binding === undefined || binding < priorBinding || !HASH.test(profile.profileCommitment)
      || typeof profile.capacity !== 'string' || !/^[1-9][0-9]*$/.test(profile.capacity)) fail();
    priorBinding = binding;
    append(profile.releaseId, profile.partKey, Number(profile.capacity));
  }
  for (const pack of pendingPacks) {
    if (!pack || !ID.test(pack.releaseId) || pack.releaseId === rootId || bindings.has(pack.releaseId)
      || !HASH.test(pack.definitionCommitment) || !Array.isArray(pack.ownedParts) || bindings.size >= 500) fail();
    bindings.set(pack.releaseId, bindings.size);
    for (const part of pack.ownedParts) append(pack.releaseId, part.key, part.capacity);
  }
  return Object.freeze(rows);
}

export function makerV8PackAttachmentOrder(left, right) {
  const text = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return text(left.semanticPackId, right.semanticPackId) || text(left.releaseId, right.releaseId);
}

/** Allocate from existing immutable slots followed by canonically ordered NEW
 * attachments. Both recipe normalization and transaction planning use this order. */
export function makerV8PlayerRecipeLayout(player, selections) {
  const current = player.definitionContext?.currentLoadout?.layout ?? { bindings: [], profiles: [] };
  const attached = new Set(current.bindings.map(row => row.releaseId));
  const selected = new Set(selections.filter(row => row.source === 'PACK').map(row => row.releaseId));
  const pending = (player.definitionContext?.packs ?? []).filter(pack => selected.has(pack.releaseId) && !attached.has(pack.releaseId))
    .sort(makerV8PackAttachmentOrder);
  const rows = makerV8PlayerSlotLayout({ rootId: player.rootId, parts: player.document.parts,
    packDefinitionLayout: current, pendingPacks: pending });
  const byKey = new Map(rows.map(row => [JSON.stringify([row.sourceId, row.partKey]), row]));
  const scopeKey = selection => {
    const resolved = makerV8PlayerPart(player, selection);
    if (!resolved) fail();
    return JSON.stringify([resolved.sourceId, selection.partKey]);
  };
  const slot = selection => {
    const row = byKey.get(scopeKey(selection));
    if (!row) fail();
    return row;
  };
  return Object.freeze({ rows, scopeKey, slot });
}
