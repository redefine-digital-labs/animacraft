import assert from 'node:assert/strict';
import test from 'node:test';
import { createMakerV8Document, assertMakerV8Document } from '../maker-v8-document.js';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { minimalArtworkDocument } from './fixtures/maker-v8-minimal-artwork.js';
import { creatorTrackState, creatorLinkedTrackSyncState, creatorPartMoveAllowed,
  prepareCreatorTrackChange } from '../maker-v8-creator-tracks.js';

const starter = () => createCreatorCharacterStarter({ makerKey: 'tracks', name: 'Track test' });
const keys = rows => rows.map(row => row.key);
const styles = doc => doc.parts.flatMap(part => part.items.flatMap(item => item.styles));
const edit = (document, action, input = {}) => prepareCreatorTrackChange({ document, action, ...input });
const selection = (doc, index = 0) => ({ partKey: doc.parts[index].key,
  itemKey: doc.parts[index].items[0].key, styleKey: doc.parts[index].items[0].styles[0].key });
const orders = doc => Object.fromEntries(doc.parts.map(part => [part.key, part.renderOrder]));
function unchangedConfiguration(before, after) {
  for (const field of ['assets', 'metadata', 'canvas', 'lineage', 'colors', 'rules', 'commerce', 'outputs', 'livingContent', 'defaultRecipe']) {
    assert.deepEqual(after[field], before[field], field);
  }
  assert.deepEqual(orders(after), orders(before), 'Part renderOrder is not menu order');
  for (const part of before.parts) assert.deepEqual(after.parts.find(row => row.key === part.key).items, part.items);
}

test('linked state requires every Style on one exclusive Track, including alternative Items', () => {
  const doc = starter();
  const before = structuredClone(doc);
  const state = creatorTrackState(doc, 'background-track');
  assert.equal(state.linked, true);
  assert.deepEqual(state.bindings, [{ part: doc.parts[0], item: doc.parts[0].items[0], style: doc.parts[0].items[0].styles[0] }]);
  assert.equal(state.canMoveBack, false);
  assert.equal(state.canMoveFront, true);
  assert.equal(state.canDelete, false);
  assert.equal(state.canRename, true);
  assert.deepEqual(creatorLinkedTrackSyncState(doc), { matches: true, blocked: false });
  assert.deepEqual(doc, before);
  const alternate = structuredClone(doc.parts[0].items[0]);
  alternate.key = 'alternate'; alternate.displayOrder = 1;
  doc.parts[0].items.push(alternate);
  assert.equal(creatorTrackState(doc, 'background-track').linked, true);
  alternate.styles[0].trackKey = 'outfit-track';
  assert.equal(creatorTrackState(doc, 'background-track').linked, false, 'multi-track Part');
  assert.equal(creatorTrackState(doc, 'outfit-track').linked, false, 'shared with another Part');
  alternate.styles[0].trackKey = null;
  assert.equal(creatorTrackState(doc, 'background-track').linked, false, 'partially unbound Part');
  assert.equal(creatorTrackState(doc, 'outfit-track').linked, true);
  assert.deepEqual(creatorTrackState(doc, 'missing'), { bindings: [], linked: false, orderLocked: false,
    canMoveBack: false, canMoveFront: false, canDelete: false, canRename: false });
});

test('Part menu moves synchronize only linked Track slots while preserving custom and shared definitions', () => {
  const doc = starter();
  // Background and Back Hair share a Track; both lose automatic linkage.
  doc.parts[1].items[0].styles[0].trackKey = 'background-track';
  const before = structuredClone(doc);
  const result = edit(doc, 'move-part', { partKey: 'eyes', targetKey: 'skin-base' });
  assert.equal(result.changed, true);
  assert.deepEqual(keys(result.document.parts), ['background', 'back-hair', 'eyes', 'skin-base', 'outfit', 'mouth', 'front-hair', 'accessory']);
  assert.deepEqual(keys(result.document.tracks), ['background-track', 'back-hair-track', 'eyes-track', 'skin-base-track', 'outfit-track', 'mouth-track', 'front-hair-track', 'accessory-track']);
  assert.deepEqual(result.document.parts.map(part => part.menuOrder), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(result.document.tracks.map(track => track.renderOrder), [0, 1, 2, 3, 4, 5, 6, 7]);
  unchangedConfiguration(before, result.document);
  assert.deepEqual(doc, before);
  assert.equal(creatorPartMoveAllowed(doc, 'eyes', { targetKey: 'skin-base' }), true);
  const customMove = edit(doc, 'move-part', { partKey: 'background', targetKey: 'outfit' });
  assert.deepEqual(customMove.document.tracks, doc.tracks, 'custom menu movement changes no visual order');
});

test('Track movement synchronizes linked Part menu slots without moving custom/shared menu slots', () => {
  const doc = starter();
  doc.parts[1].items[0].styles[0].trackKey = 'background-track';
  const before = structuredClone(doc);
  const result = edit(doc, 'move-track', { trackKey: 'eyes-track', targetKey: 'skin-base-track' });
  assert.equal(result.selectedTrackKey, 'eyes-track');
  assert.deepEqual(keys(result.document.parts), ['background', 'back-hair', 'eyes', 'skin-base', 'outfit', 'mouth', 'front-hair', 'accessory']);
  unchangedConfiguration(before, result.document);
  assert.deepEqual(doc, before);
  const custom = edit(doc, 'move-track', { trackKey: 'background-track', targetKey: 'outfit-track' });
  assert.deepEqual(custom.document.parts, doc.parts);
  assert.equal(creatorLinkedTrackSyncState(result.document).matches, true);
});

test('visual and menu movement use stored orders, not stale array positions', () => {
  const doc = starter();
  doc.parts.reverse(); doc.tracks.reverse();
  const before = structuredClone(doc);
  const result = edit(doc, 'move-part', { partKey: 'skin-base', direction: 'up' });
  assert.deepEqual(keys(result.document.parts).slice(0, 3), ['background', 'skin-base', 'back-hair']);
  assert.deepEqual(keys(result.document.tracks).slice(0, 3), ['background-track', 'skin-base-track', 'back-hair-track']);
  unchangedConfiguration(before, result.document);
  assert.deepEqual(doc, before);
});

test('equal order values use the same key tie-break as the view for movement, linkage and lock boundaries', () => {
  const doc = starter();
  doc.parts.reverse();
  doc.parts.forEach(part => { part.menuOrder = 0; });
  doc.tracks.forEach(track => { track.renderOrder = 0; });
  const before = structuredClone(doc);
  const expected = ['accessory', 'back-hair', 'background', 'front-hair', 'eyes', 'mouth', 'outfit', 'skin-base'];
  assert.deepEqual(creatorLinkedTrackSyncState(doc), { matches: true, blocked: false });
  assert.equal(edit(doc, 'sync-linked-track-order').changed, false);
  const partMove = edit(doc, 'move-part', { partKey: 'front-hair', direction: 'up' });
  assert.deepEqual(keys(partMove.document.parts), expected);
  assert.deepEqual(keys(partMove.document.tracks), expected.map(key => `${key}-track`));
  const trackMove = edit(doc, 'move-track', { trackKey: 'front-hair-track', direction: 'up' });
  assert.deepEqual(trackMove.document, partMove.document);
  unchangedConfiguration(before, partMove.document);
  assert.deepEqual(doc, before);
  doc.tracks.find(track => track.key === 'back-hair-track').locked = true;
  assert.equal(creatorTrackState(doc, 'accessory-track').canMoveFront, false);
  assert.equal(creatorTrackState(doc, 'background-track').canMoveBack, false);
  assert.equal(creatorPartMoveAllowed(doc, 'accessory', { direction: 'down' }), false);
  assert.throws(() => edit(doc, 'move-track', { trackKey: 'accessory-track', direction: 'down' }), /locked/);
  assert.throws(() => edit(doc, 'move-part', { partKey: 'accessory', targetKey: 'background' }), /locked/);
});

test('Track and whole-Style locks block direct movement, crossed ranges, Part linkage and explicit sync', () => {
  for (const lock of ['track', 'style']) {
    const doc = starter();
    if (lock === 'track') doc.tracks[2].locked = true;
    else doc.parts[2].items[0].styles[0].payload.animacraftEditor.styleLocked = true;
    const before = structuredClone(doc);
    const locked = creatorTrackState(doc, 'skin-base-track');
    assert.equal(locked.orderLocked, true);
    assert.equal(locked.canMoveBack, false);
    assert.equal(locked.canMoveFront, false);
    assert.equal(creatorTrackState(doc, 'back-hair-track').canMoveFront, false);
    assert.equal(creatorTrackState(doc, 'outfit-track').canMoveBack, false);
    assert.equal(creatorPartMoveAllowed(doc, 'accessory', { targetKey: 'background' }), false);
    for (const [action, input] of [
      ['move-track', { trackKey: 'skin-base-track', direction: 'up' }],
      ['move-track', { trackKey: 'accessory-track', targetKey: 'background-track' }],
      ['move-track', { trackKey: 'background-track', targetKey: 'accessory-track' }],
      ['move-part', { partKey: 'accessory', targetKey: 'background' }],
    ]) assert.throws(() => edit(doc, action, input), /locked|Unlock/);
    assert.deepEqual(doc, before);
    // A mismatched menu would force a linked Track across the locked barrier.
    doc.parts[0].menuOrder = 7; doc.parts[7].menuOrder = 0;
    assert.deepEqual(creatorLinkedTrackSyncState(doc), { matches: false, blocked: true });
    assert.throws(() => edit(doc, 'sync-linked-track-order'), /Unlock/);
  }
});

test('an unmoving custom locked Track remains a visual barrier while custom-only menu moves remain possible', () => {
  const doc = starter();
  doc.parts[1].items[0].styles[0].trackKey = 'background-track';
  doc.tracks[1].locked = true; // Empty custom slot, not a linked Part.
  assert.equal(creatorTrackState(doc, 'back-hair-track').linked, false);
  assert.throws(() => edit(doc, 'move-track', { trackKey: 'eyes-track', targetKey: 'background-track' }), /locked/);
  // A separate empty slot is crossed by linked tracks during Part sync.
  const withBarrier = starter();
  withBarrier.tracks.splice(1, 0, { key: 'barrier', label: 'Barrier', renderOrder: 0.5, locked: true });
  withBarrier.tracks.forEach((track, index) => { track.renderOrder = index; });
  assert.equal(creatorPartMoveAllowed(withBarrier, 'skin-base', { targetKey: 'background' }), false);
  assert.throws(() => edit(withBarrier, 'move-part', { partKey: 'skin-base', targetKey: 'background' }), /locked/);
  withBarrier.parts[0].menuOrder = 2; withBarrier.parts[2].menuOrder = 0;
  assert.deepEqual(creatorLinkedTrackSyncState(withBarrier), { matches: false, blocked: true });
  assert.throws(() => edit(withBarrier, 'sync-linked-track-order'), /Unlock/);
  const customMove = edit(doc, 'move-part', { partKey: 'background', targetKey: 'accessory' });
  assert.equal(customMove.changed, true);
  assert.deepEqual(customMove.document.tracks, doc.tracks);
});

test('Sync respects custom slots, repairs linked mismatch and leaves matching/no-op requests untouched', () => {
  const doc = starter();
  // The unbound Back Hair Track stays in its original slot during Sync.
  doc.parts[1].items[0].styles[0].trackKey = 'background-track';
  doc.parts[2].menuOrder = 4; doc.parts[4].menuOrder = 2;
  const before = structuredClone(doc);
  assert.deepEqual(creatorLinkedTrackSyncState(doc), { matches: false, blocked: false });
  const synced = edit(doc, 'sync-linked-track-order');
  assert.deepEqual(keys(synced.document.tracks), ['background-track', 'back-hair-track', 'eyes-track', 'outfit-track', 'skin-base-track', 'mouth-track', 'front-hair-track', 'accessory-track']);
  assert.deepEqual(synced.document.parts, doc.parts);
  unchangedConfiguration(before, synced.document);
  assert.equal(edit(synced.document, 'sync-linked-track-order').changed, false);
  for (const input of [
    { action: 'move-part', partKey: 'background', direction: 'up' },
    { action: 'move-part', partKey: 'background', targetKey: 'background' },
    { action: 'move-track', trackKey: 'background-track', direction: 'up' },
    { action: 'move-track', trackKey: 'background-track', targetKey: 'background-track' },
  ]) {
    const noOp = prepareCreatorTrackChange({ document: doc, ...input });
    assert.equal(noOp.changed, false, 'a no-op move never implicitly repairs an unrelated mismatch');
    assert.equal(noOp.document, doc);
  }
});

test('Add, rename, toggle and delete affect only unused unlocked Track records', () => {
  const original = starter();
  const added = edit(original, 'add-track');
  assert.equal(added.document.tracks.length, 9);
  assert.equal(added.document.tracks.at(-1).label, 'Layer 9');
  assert.equal(added.selectedTrackKey, 'track-9');
  unchangedConfiguration(original, added.document);
  const renamed = edit(added.document, 'track-name', { trackKey: added.selectedTrackKey, value: '  Glow  ' });
  assert.equal(renamed.document.tracks.at(-1).label, 'Glow');
  for (const value of ['Glow', '   ']) assert.equal(edit(renamed.document, 'track-name', { trackKey: 'track-9', value }).changed, false);
  const locked = edit(renamed.document, 'toggle-track-lock', { trackKey: 'track-9' }).document;
  assert.equal(creatorTrackState(locked, 'track-9').canDelete, false);
  assert.equal(creatorTrackState(locked, 'track-9').canRename, false);
  assert.throws(() => edit(locked, 'track-name', { trackKey: 'track-9', value: 'Rename' }), /Unlock/);
  assert.throws(() => edit(locked, 'delete-track', { trackKey: 'track-9' }), /unused, unlocked/);
  const unlocked = edit(locked, 'toggle-track-lock', { trackKey: 'track-9' }).document;
  const deleted = edit(unlocked, 'delete-track', { trackKey: 'track-9' });
  assert.deepEqual(deleted.document, original);
  assert.equal(deleted.selectedTrackKey, 'accessory-track');
  assert.throws(() => edit(original, 'delete-track', { trackKey: 'eyes-track' }), /unused, unlocked/);
  const blank = createMakerV8Document({ makerKey: 'blank' });
  const single = edit(blank, 'add-track', { value: 'Only track' });
  assert.equal(edit(single.document, 'delete-track', { trackKey: single.selectedTrackKey }).selectedTrackKey, null);
  assert.equal(edit(added.document, 'add-track').selectedTrackKey, 'track-10');
  const sparse = structuredClone(createMakerV8Document({ makerKey: 'sparse' }));
  sparse.tracks = [{ key: 'track-2', label: 'Existing', renderOrder: 19, locked: false }];
  const fresh = edit(sparse, 'add-track');
  assert.deepEqual(fresh.document.tracks.at(-1), { key: 'track-3', label: 'Layer 2', renderOrder: 20, locked: false });
});

test('binding and unbinding preserve complete artwork and accept locked Track targets but refuse whole-Style locks', () => {
  const doc = minimalArtworkDocument({ draftId: 'binding', name: 'Binding' });
  const added = edit(doc, 'add-track').document;
  added.tracks[1].locked = true;
  const before = structuredClone(added);
  const selected = selection(added);
  const rebound = edit(added, 'assign-style-track', { ...selected, value: added.tracks[1].key });
  assert.equal(rebound.selectedTrackKey, added.tracks[1].key);
  const originalStyle = styles(before)[0];
  assert.deepEqual(styles(rebound.document)[0], { ...originalStyle, trackKey: added.tracks[1].key });
  assert.deepEqual(rebound.document.assets, before.assets);
  assert.deepEqual(added, before);
  const unbound = edit(rebound.document, 'assign-style-track', { ...selected, value: '' });
  assert.equal(styles(unbound.document)[0].trackKey, null);
  assert.equal(unbound.selectedTrackKey, undefined);
  assertMakerV8Document(unbound.document, { mode: 'draft' });
  assert.throws(() => assertMakerV8Document(unbound.document, { mode: 'compile' }));
  assert.equal(edit(unbound.document, 'assign-style-track', { ...selected, value: '' }).changed, false);
  assert.equal(creatorTrackState(unbound.document, 'base-track').linked, false);
  for (const value of ['missing', '  ', null, 3]) assert.throws(() => edit(added, 'assign-style-track', { ...selected, value }), /existing Layer Track/);
  styles(added)[0].payload.animacraftEditor = { positionLocked: true, styleLocked: false };
  assert.equal(edit(added, 'assign-style-track', { ...selected, value: '' }).changed, true, 'position lock is not a whole-Style lock');
  styles(added)[0].payload.animacraftEditor.styleLocked = true;
  assert.throws(() => edit(added, 'assign-style-track', { ...selected, value: '' }), /whole Style/);
});

test('invalid operations fail explicitly without mutating document or accepting stale reorder targets', () => {
  const doc = starter();
  const before = structuredClone(doc);
  for (const input of [
    { action: 'unknown', trackKey: 'background-track' },
    { action: 'track-name', trackKey: 'missing', value: 'Name' },
    { action: 'track-name', trackKey: 'background-track', value: 4 },
    { action: 'track-name', trackKey: 'background-track', value: 'x'.repeat(257) },
    { action: 'add-track', value: '' },
    { action: 'move-track', trackKey: 'background-track', direction: 'sideways' },
    { action: 'move-track', trackKey: 'background-track', targetKey: 'missing' },
    { action: 'move-track', trackKey: 'background-track', targetKey: 'eyes-track', direction: 'down' },
    { action: 'move-part', partKey: 'missing', direction: 'up' },
    { action: 'assign-style-track', partKey: 'background', itemKey: 'missing', styleKey: 'default-style', value: '' },
  ]) {
    assert.throws(() => prepareCreatorTrackChange({ document: doc, ...input }));
    assert.deepEqual(doc, before);
  }
  assert.equal(creatorPartMoveAllowed(doc, 'background', { direction: 'up' }), false);
  assert.equal(creatorPartMoveAllowed(doc, 'eyes', { targetKey: 'missing' }), false);
});
