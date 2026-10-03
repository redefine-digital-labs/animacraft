import { assertMakerV8Document } from './maker-v8-document.js';
import { creatorStyleEditorState } from './maker-v8-creator-style.js';

const ordered = (rows, field) => [...rows].sort((a, b) => a[field] - b[field] || a.key.localeCompare(b.key));
const sameOrder = (left, right) => left.every((row, index) => row.key === right[index]?.key);
const stylesIn = part => part.items.flatMap(item => item.styles);

function topology(document) {
  const tracks = ordered(document.tracks, 'renderOrder');
  const parts = ordered(document.parts, 'menuOrder');
  const bindings = new Map(tracks.map(track => [track.key, []]));
  for (const part of parts) for (const item of part.items) for (const style of item.styles) {
    bindings.get(style.trackKey)?.push({ part, item, style });
  }
  const pairs = parts.flatMap(part => {
    const styles = stylesIn(part);
    const key = styles[0]?.trackKey;
    return key && bindings.has(key) && styles.every(style => style.trackKey === key)
      && bindings.get(key).every(binding => binding.part.key === part.key)
      ? [{ partKey: part.key, trackKey: key }] : [];
  });
  const locked = new Set(tracks.filter(track => track.locked
    || bindings.get(track.key).some(({ style }) => creatorStyleEditorState(style).styleLocked)).map(track => track.key));
  return { tracks, parts, bindings, pairs, locked };
}

function reorderSlots(rows, keys) {
  const members = new Set(keys);
  const records = new Map(rows.map(row => [row.key, row]));
  let index = 0;
  return rows.map(row => members.has(row.key) ? records.get(keys[index++]) : row);
}

function tracksFromParts(state, parts = state.parts) {
  const byPart = new Map(state.pairs.map(pair => [pair.partKey, pair.trackKey]));
  return reorderSlots(state.tracks, parts.map(part => byPart.get(part.key)).filter(Boolean));
}

function partsFromTracks(state, tracks) {
  const byTrack = new Map(state.pairs.map(pair => [pair.trackKey, pair.partKey]));
  return reorderSlots(state.parts, tracks.map(track => byTrack.get(track.key)).filter(Boolean));
}

function crossesLock(state, nextTracks) {
  const nextIndex = new Map(nextTracks.map((track, index) => [track.key, index]));
  return state.tracks.some((track, index) => {
    const to = nextIndex.get(track.key);
    return to !== index && state.tracks.slice(Math.min(index, to), Math.max(index, to) + 1)
      .some(candidate => state.locked.has(candidate.key));
  });
}

function moved(rows, key, { direction, targetKey } = {}) {
  const from = rows.findIndex(row => row.key === key);
  if (from < 0) throw new TypeError('The selected Part or Layer Track no longer exists.');
  let to;
  if (targetKey !== undefined) {
    if (direction !== undefined || typeof targetKey !== 'string') throw new TypeError('Choose one move direction or target.');
    to = rows.findIndex(row => row.key === targetKey);
    if (to < 0) throw new TypeError('The reorder target no longer exists.');
  } else {
    if (!['up', 'down'].includes(direction)) throw new TypeError('Move direction must be up or down.');
    to = from + (direction === 'up' ? -1 : 1);
  }
  if (to < 0 || to >= rows.length || from === to) return rows;
  const next = [...rows];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

function installOrder(document, field, rows, orderField) {
  document[field] = rows;
  rows.forEach((row, index) => { row[orderField] = index; });
}

/** Direction is menu/visual order: up = earlier/back, down = later/front.
 * A targetKey inserts at that target's current slot; intervening rows shift. */
export function creatorPartMoveAllowed(document, partKey, move = {}) {
  const state = topology(document);
  try {
    const parts = moved(state.parts, partKey, move);
    return !sameOrder(state.parts, parts) && !crossesLock(state, tracksFromParts(state, parts));
  } catch { return false; }
}

export function creatorLinkedTrackSyncState(document) {
  const state = topology(document);
  const tracks = tracksFromParts(state);
  return { matches: sameOrder(state.tracks, tracks), blocked: crossesLock(state, tracks) };
}

export function creatorTrackState(document, trackKey) {
  const state = topology(document);
  const track = state.tracks.find(row => row.key === trackKey);
  const bindings = state.bindings.get(trackKey) || [];
  const canMove = direction => {
    if (!track) return false;
    const tracks = moved(state.tracks, trackKey, { direction });
    return !sameOrder(state.tracks, tracks) && !crossesLock(state, tracks);
  };
  return {
    bindings,
    linked: state.pairs.some(pair => pair.trackKey === trackKey),
    orderLocked: Boolean(track && state.locked.has(trackKey)),
    canMoveBack: canMove('up'), canMoveFront: canMove('down'),
    canDelete: Boolean(track && !track.locked && !bindings.length),
    canRename: Boolean(track && !track.locked),
  };
}

/** Pure local author edit. Only explicit Part-menu and Track-visual order move;
 * Part.renderOrder, assets, recipe selections and Style configuration survive. */
export function prepareCreatorTrackChange({ document, action, trackKey, partKey, itemKey, styleKey,
  value, direction, targetKey } = {}) {
  assertMakerV8Document(document, { mode: 'draft' });
  const next = structuredClone(document);
  const state = topology(next);
  let selectedTrackKey;
  if (action === 'add-track') {
    let suffix = state.tracks.length + 1;
    while (state.tracks.some(track => track.key === `track-${suffix}`)) suffix += 1;
    const order = Math.max(-1, ...state.tracks.map(track => track.renderOrder)) + 1;
    if (!Number.isSafeInteger(order)) throw new TypeError('No Layer Track order is available.');
    const label = value === undefined ? `Layer ${state.tracks.length + 1}` : value;
    if (typeof label !== 'string' || !label.trim()) throw new TypeError('A Layer Track name is required.');
    const track = { key: `track-${suffix}`, label: label.trim(), renderOrder: order, locked: false };
    next.tracks = [...state.tracks, track];
    selectedTrackKey = track.key;
  } else if (action === 'assign-style-track') {
    const style = next.parts.find(part => part.key === partKey)?.items.find(item => item.key === itemKey)
      ?.styles.find(row => row.key === styleKey);
    if (!style) throw new TypeError('The selected Maker Style no longer exists.');
    if (creatorStyleEditorState(style).styleLocked) throw new TypeError('Unlock the whole Style before changing its Layer Track.');
    if (typeof value !== 'string' || value && !state.bindings.has(value)) throw new TypeError('Choose an existing Layer Track or No Layer Track.');
    style.trackKey = value || null;
    if (value) selectedTrackKey = value;
  } else if (action === 'sync-linked-track-order') {
    const tracks = tracksFromParts(state);
    if (crossesLock(state, tracks)) throw new TypeError('Unlock the affected Layer Track or whole Style before synchronizing.');
    if (!sameOrder(state.tracks, tracks)) installOrder(next, 'tracks', tracks, 'renderOrder');
  } else if (action === 'move-part') {
    const parts = moved(state.parts, partKey, { direction, targetKey });
    if (sameOrder(state.parts, parts)) return { document, changed: false };
    const tracks = tracksFromParts(state, parts);
    if (crossesLock(state, tracks)) throw new TypeError('Part order cannot move or cross a locked Layer Track or whole Style.');
    if (!sameOrder(state.parts, parts)) installOrder(next, 'parts', parts, 'menuOrder');
    if (!sameOrder(state.tracks, tracks)) installOrder(next, 'tracks', tracks, 'renderOrder');
  } else {
    const track = next.tracks.find(row => row.key === trackKey);
    if (!track) throw new TypeError('The selected Layer Track no longer exists.');
    if (action === 'move-track') {
      const tracks = moved(state.tracks, trackKey, { direction, targetKey });
      if (sameOrder(state.tracks, tracks)) return { document, changed: false, selectedTrackKey: trackKey };
      if (crossesLock(state, tracks)) throw new TypeError('Layer Track order cannot move or cross a locked Track or whole Style.');
      const parts = partsFromTracks(state, tracks);
      if (!sameOrder(state.tracks, tracks)) installOrder(next, 'tracks', tracks, 'renderOrder');
      if (!sameOrder(state.parts, parts)) installOrder(next, 'parts', parts, 'menuOrder');
      selectedTrackKey = trackKey;
    } else if (action === 'toggle-track-lock') {
      track.locked = !track.locked;
    } else if (action === 'track-name') {
      if (track.locked) throw new TypeError('Unlock this Layer Track before renaming it.');
      if (typeof value !== 'string') throw new TypeError('A Layer Track name must be text.');
      track.label = value.trim() || track.label;
    } else if (action === 'delete-track') {
      if (track.locked || state.bindings.get(trackKey).length) throw new TypeError('Only an unused, unlocked Layer Track can be deleted.');
      const index = state.tracks.findIndex(row => row.key === trackKey);
      const tracks = state.tracks.filter(row => row.key !== trackKey);
      installOrder(next, 'tracks', tracks, 'renderOrder');
      selectedTrackKey = tracks[Math.min(index, tracks.length - 1)]?.key ?? null;
    } else throw new TypeError('Unknown Layer Track edit.');
  }
  assertMakerV8Document(next, { mode: 'draft' });
  const changed = JSON.stringify(next) !== JSON.stringify(document);
  return { document: changed ? next : document, changed,
    ...(selectedTrackKey === undefined ? {} : { selectedTrackKey }) };
}
