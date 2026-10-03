import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { creatorStyleEditorState, exactCreatorTransform, prepareCreatorStyleChange } from '../maker-v8-creator-style.js';
import { MAKER_V8_BLEND_MODES } from '../maker-v8-render-core.js';

const make = () => structuredClone(createCharacterMakerV8Starter({ makerKey: 'styles', name: 'Styles', width: 800, height: 800 }));
const style = document => document.parts[0].items[0].styles[0];
const edit = (document, action, value, transform) => prepareCreatorStyleChange({ document, action, value, transform,
  partKey: 'base', itemKey: 'default', styleKey: 'default' }).document;

test('Style values retain exact supported precision, unrelated geometry, bytes and payload', () => {
  let document = make(); style(document).payload = { untouched: { exact: 'yes' } };
  const original = structuredClone(document);
  for (const [action, value] of [['style-x', '12.125'], ['style-y', '-30.5'], ['style-scale', '0.123456'], ['style-rotation', '45.125'], ['style-opacity', '12.3456']]) {
    document = edit(document, action, value);
  }
  assert.deepEqual(style(document).transform, { x: 12.125, y: -30.5, scale: 0.123456, rotation: 45.125 });
  assert.equal(style(document).opacity, 0.123456);
  assert.equal(creatorStyleEditorState(style(document)).positionConfirmed, false);
  assert.deepEqual(style(document).payload.untouched, original.parts[0].items[0].styles[0].payload.untouched);
  assert.deepEqual(document.assets, original.assets); assert.deepEqual(document.defaultRecipe, original.defaultRecipe);
  for (const mode of MAKER_V8_BLEND_MODES) assert.equal(style(edit(document, 'style-blend', mode)).blendMode, mode);
});

test('Style transform bounds and precision reject without silently rounding', () => {
  const document = make(), before = structuredClone(document);
  for (const [action, value] of [['style-x', ''], ['style-x', 'NaN'], ['style-x', '8193'], ['style-x', '0.0001'],
    ['style-y', '-8193'], ['style-scale', '0'], ['style-scale', '101'], ['style-scale', '0.1234567'],
    ['style-rotation', '361'], ['style-opacity', 'Infinity'], ['style-opacity', '-1'], ['style-opacity', '100.0001'],
    ['style-blend', 'add'], ['style-scale-preview', '401']]) {
    assert.throws(() => edit(document, action, value), undefined, `${action}: ${value}`);
  }
  assert.throws(() => exactCreatorTransform({ ...style(document).transform, anything: 1 }));
  assert.deepEqual(document, before);
});

test('persisted Style locks and confirmation preserve originals and allow explicit unlock', () => {
  let document = make();
  document = edit(document, 'style-x', 1);
  document = edit(document, 'confirm-position');
  assert.equal(creatorStyleEditorState(style(document)).positionConfirmed, true);
  document = edit(document, 'style-position-locked', true);
  for (const action of ['style-x', 'style-scale', 'style-rotation', 'style-scale-preview', 'confirm-position']) {
    assert.throws(() => edit(document, action, 2), /unlocked|Unlock/);
  }
  document = edit(document, 'style-opacity', '30');
  document = edit(document, 'style-locked', true);
  for (const action of ['style-opacity', 'style-blend', 'style-position-locked']) assert.throws(() => edit(document, action, 1), /Unlock/);
  document = edit(document, 'style-locked', false);
  assert.equal(creatorStyleEditorState(style(document)).positionLocked, true, 'whole unlock retains explicit position lock');
  document = edit(document, 'style-position-locked', false);
  assert.equal(style(edit(document, 'style-x', 8)).transform.x, 8);
  for (const value of [null, [], 'unknown', { styleLocked: 'yes' }]) {
    const conflict = make(); style(conflict).payload.animacraftEditor = value;
    const before = structuredClone(conflict);
    assert.throws(() => edit(conflict, 'style-x', 8)); assert.deepEqual(conflict, before);
  }
});

test('pixel mode quantizes only the coordinate being edited, never collateral scale/rotation coordinates', () => {
  const document = make(); document.canvas.pixelMode = 'pixelated';
  style(document).transform.x = 0.125; style(document).transform.y = -1.25;
  for (const action of ['style-scale', 'style-rotation', 'style-scale-preview']) {
    const next = style(edit(document, action, action === 'style-scale-preview' ? 150 : 1.5));
    assert.equal(next.transform.x, 0.125); assert.equal(next.transform.y, -1.25);
  }
  const next = style(edit(document, 'style-x', 1.5));
  assert.equal(next.transform.x, 2); assert.equal(next.transform.y, -1.25);
});
