import assert from 'node:assert/strict';
import test from 'node:test';
import { createMakerV8Document, assertMakerV8Document } from '../maker-v8-document.js';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { creatorColorState, creatorColorStops, prepareCreatorColorChange } from '../maker-v8-creator-colors.js';
import { mapMakerV8SmartColorPixelsV8 } from '../maker-v8-render-core.js';

const edit = (document, action, input = {}) => prepareCreatorColorChange({ document, action, ...input });
const styles = document => document.parts.flatMap(part => part.items.flatMap(item => item.styles));
const selectedStyle = (document, index = 0) => ({ partKey: document.parts[index].key,
  itemKey: document.parts[index].items[0].key, styleKey: document.parts[index].items[0].styles[0].key });
function fixture() {
  const document = createCreatorCharacterStarter({ makerKey: 'colors', name: 'Color test' });
  return edit(document, 'add-channel').document;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function pixels(swatch) {
  return mapMakerV8SmartColorPixelsV8({ width: 3, height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255, 127, 127, 127, 255, 255, 255, 255, 255]) }, swatch);
}

test('adds the original gradient channel/preset and an exact default recipe without mutating source', () => {
  const doc = freeze(createMakerV8Document({ makerKey: 'blank', name: 'Blank' }));
  const result = edit(doc, 'add-channel');
  assert.equal(result.changed, true);
  assert.equal(result.selectedColorKey, 'color-1');
  const channel = result.document.colors[0];
  assert.deepEqual(channel, { key: 'color-1', label: 'Color 1', defaultSwatchKey: 'default', swatches: [
    { key: 'default', label: 'Default', rgba: '#7b5cffff', stops: [
      { offset: 0, rgba: '#16112eff' }, { offset: 0.5, rgba: '#7b5cffff' }, { offset: 1, rgba: '#e2dbffff' },
    ] },
  ] });
  assert.deepEqual(result.document.defaultRecipe.colors, [{ channelKey: 'color-1', swatchKey: 'default' }]);
  for (const field of Object.keys(doc).filter(key => !['colors', 'defaultRecipe'].includes(key))) {
    assert.deepEqual(result.document[field], doc[field], field);
  }
  assertMakerV8Document(result.document, { mode: 'draft' });
});

test('channel and preset IDs remain unique with sparse existing keys and preserve separate defaults', () => {
  let doc = fixture();
  doc.colors[0].key = 'color-2'; doc.defaultRecipe.colors[0].channelKey = 'color-2';
  const result = edit(doc, 'add-channel', { value: '  Hair  ' });
  assert.equal(result.selectedColorKey, 'color-3');
  assert.equal(result.document.colors[1].label, 'Hair');
  doc = edit(result.document, 'add-swatch', { channelKey: 'color-2' }).document;
  doc.colors[0].swatches[1].key = 'color-3';
  const added = edit(doc, 'add-swatch', { channelKey: 'color-2' }).document;
  assert.equal(added.colors[0].swatches[2].key, 'color-4');
  assert.equal(added.colors[0].swatches[2].rgba, '#f06f8fff');
  assert.equal(added.colors[0].defaultSwatchKey, 'default');
  assert.deepEqual(added.defaultRecipe, doc.defaultRecipe);
});

test('assign/unassign sets the exact channel/default pair and preserves all other Style fields', () => {
  const doc = fixture(); const before = structuredClone(doc);
  const input = selectedStyle(doc);
  const assigned = edit(doc, 'assign-style-color', { ...input, value: 'color-1' });
  assert.equal(assigned.selectedColorKey, 'color-1');
  assert.deepEqual(styles(assigned.document)[0], { ...styles(doc)[0], colorChannelKey: 'color-1', defaultSwatchKey: 'default' });
  assert.deepEqual(doc, before);
  const removed = edit(assigned.document, 'assign-style-color', { ...input, value: '' });
  assert.deepEqual(removed.document, before);
  assert.throws(() => edit(doc, 'assign-style-color', { ...input, value: 'missing' }), /existing Color/);
  assert.throws(() => edit(doc, 'assign-style-color', { ...input, styleKey: 'missing', value: '' }), /no longer exists/);
});

test('channel default updates recipe while retaining an explicit Style default and other selections', () => {
  let doc = fixture();
  doc = edit(doc, 'assign-style-color', { ...selectedStyle(doc), value: 'color-1' }).document;
  doc = edit(doc, 'add-swatch', { channelKey: 'color-1' }).document;
  doc = edit(doc, 'add-channel').document;
  const result = edit(doc, 'channel-default-swatch', { channelKey: 'color-1', value: 'color-2' });
  assert.equal(result.document.colors[0].defaultSwatchKey, 'color-2');
  assert.equal(styles(result.document)[0].defaultSwatchKey, 'default');
  assert.deepEqual(result.document.defaultRecipe.colors, [
    { channelKey: 'color-1', swatchKey: 'color-2' }, { channelKey: 'color-2', swatchKey: 'default' },
  ]);
  const noOp = edit(result.document, 'assign-style-color', { ...selectedStyle(doc), value: 'color-1' });
  assert.equal(noOp.changed, false, 'same channel must not reset explicit Style default');
  assert.equal(noOp.document, result.document);
  const withoutRecipe = structuredClone(doc); withoutRecipe.defaultRecipe.colors = [];
  const inserted = edit(withoutRecipe, 'channel-default-swatch', { channelKey: 'color-1', value: 'default' });
  assert.deepEqual(inserted.document.defaultRecipe.colors, [{ channelKey: 'color-1', swatchKey: 'default' }]);
});

test('preset deletion repairs every linked Style and recipe reference without touching other channels', () => {
  let doc = fixture();
  doc = edit(doc, 'add-swatch', { channelKey: 'color-1' }).document;
  doc = edit(doc, 'add-channel').document;
  styles(doc)[0].colorChannelKey = 'color-1'; styles(doc)[0].defaultSwatchKey = 'default';
  styles(doc)[1].colorChannelKey = 'color-1'; styles(doc)[1].defaultSwatchKey = 'color-2';
  styles(doc)[2].colorChannelKey = 'color-2'; styles(doc)[2].defaultSwatchKey = 'default';
  const before = structuredClone(doc);
  const result = edit(freeze(doc), 'delete-swatch', { channelKey: 'color-1', swatchKey: 'default' });
  assert.equal(result.document.colors[0].defaultSwatchKey, 'color-2');
  assert.equal(styles(result.document)[0].defaultSwatchKey, 'color-2');
  assert.equal(styles(result.document)[1].defaultSwatchKey, 'color-2');
  assert.deepEqual(styles(result.document)[2], styles(before)[2]);
  assert.deepEqual(result.document.defaultRecipe.colors, [
    { channelKey: 'color-1', swatchKey: 'color-2' }, { channelKey: 'color-2', swatchKey: 'default' },
  ]);
  assert.deepEqual(doc, before);
  assertMakerV8Document(result.document, { mode: 'draft' });
  assert.throws(() => edit(result.document, 'delete-swatch', { channelKey: 'color-1', swatchKey: 'color-2' }), /at least one/);
});

test('deleting a nondefault preset repairs explicit selections to channel default', () => {
  let doc = edit(fixture(), 'add-swatch', { channelKey: 'color-1' }).document;
  styles(doc)[0].colorChannelKey = 'color-1'; styles(doc)[0].defaultSwatchKey = 'color-2';
  doc.defaultRecipe.colors[0].swatchKey = 'color-2';
  const result = edit(doc, 'delete-swatch', { channelKey: 'color-1', swatchKey: 'color-2' });
  assert.equal(styles(result.document)[0].defaultSwatchKey, 'default');
  assert.equal(result.document.defaultRecipe.colors[0].swatchKey, 'default');
});

test('channel deletion atomically clears Style pairs and recipe references and selects the neighbor', () => {
  let doc = edit(fixture(), 'add-channel').document;
  for (const style of styles(doc).slice(0, 2)) { style.colorChannelKey = 'color-1'; style.defaultSwatchKey = 'default'; }
  const result = edit(doc, 'delete-channel', { channelKey: 'color-1' });
  assert.equal(result.selectedColorKey, 'color-2');
  for (const style of styles(result.document).slice(0, 2)) {
    assert.equal(style.colorChannelKey, null); assert.equal(style.defaultSwatchKey, null);
  }
  assert.deepEqual(result.document.defaultRecipe.colors, [{ channelKey: 'color-2', swatchKey: 'default' }]);
  assert.deepEqual(result.document.defaultRecipe.selections, doc.defaultRecipe.selections);
  const last = edit(result.document, 'delete-channel', { channelKey: 'color-2' });
  assert.equal(last.selectedColorKey, null);
  assert.deepEqual(last.document.colors, []); assert.deepEqual(last.document.defaultRecipe.colors, []);
});

test('all shared channel mutations respect linked whole-Style lock; position/Track locks do not lock color', () => {
  const doc = edit(fixture(), 'add-swatch', { channelKey: 'color-1' }).document;
  const style = styles(doc)[0]; style.colorChannelKey = 'color-1'; style.defaultSwatchKey = 'default';
  style.payload.animacraftEditor = { styleLocked: true };
  assert.equal(creatorColorState(doc, 'color-1').locked, true);
  assert.equal(creatorColorState(doc, 'color-1').canDeleteSwatch, false);
  for (const [action, extra] of [
    ['delete-channel', {}], ['channel-name', { value: 'Renamed' }], ['add-swatch', {}],
    ['delete-swatch', {}], ['channel-default-swatch', { value: 'color-2' }],
    ['swatch-name', { value: 'Renamed' }], ['swatch-hint', { value: '#000000' }],
    ['swatch-mid', { value: '#000000' }], ['swatch-stop', { value: '#000000', stopIndex: 0 }],
  ]) assert.throws(() => edit(doc, action, { channelKey: 'color-1', swatchKey: 'default', ...extra }), /Unlock/, action);
  assert.throws(() => edit(doc, 'assign-style-color', { ...selectedStyle(doc), value: '' }), /Unlock/);
  assert.equal(edit(doc, 'add-channel').changed, true, 'unrelated channel remains editable');
  style.payload.animacraftEditor = { positionLocked: true };
  doc.tracks[0].locked = true;
  assert.equal(edit(doc, 'swatch-mid', { channelKey: 'color-1', swatchKey: 'default', value: '#000000' }).changed, true);
  assert.equal(creatorColorState(doc, 'color-1').canDeleteSwatch, true);
  assert.deepEqual(creatorColorState(doc, 'missing'), { bindings: [], locked: false, canDeleteSwatch: false });
});

test('identical edits return original document even with a whole-Style lock', () => {
  const doc = fixture(); const style = styles(doc)[0];
  style.colorChannelKey = 'color-1'; style.defaultSwatchKey = 'default'; style.payload.animacraftEditor = { styleLocked: true };
  for (const [action, extra] of [
    ['channel-name', { value: ' Color 1 ' }], ['swatch-name', { value: 'Default' }],
    ['channel-default-swatch', { value: 'default' }], ['swatch-hint', { value: '#7b5cff' }],
    ['swatch-mid', { value: '#7b5cff' }], ['swatch-stop', { value: '#16112e', stopIndex: '0' }],
    ['assign-style-color', { ...selectedStyle(doc), value: 'color-1' }],
  ]) {
    const result = edit(doc, action, { channelKey: 'color-1', swatchKey: 'default', ...extra });
    assert.equal(result.changed, false, action); assert.equal(result.document, doc, action);
  }
});

test('primary regenerates the existing gradient, RGB edits preserve alpha, and midpoint also sets the chip', () => {
  const doc = fixture(); doc.colors[0].swatches[0].rgba = '#7b5cff80';
  let result = edit(doc, 'swatch-hint', { channelKey: 'color-1', swatchKey: 'default', value: '#ff0000' });
  assert.deepEqual(result.document.colors[0].swatches[0].stops, [
    { offset: 0, rgba: '#2e000080' }, { offset: 0.5, rgba: '#ff000080' }, { offset: 1, rgba: '#ffc7c780' },
  ]);
  result = edit(result.document, 'swatch-mid', { channelKey: 'color-1', swatchKey: 'default', value: '#00FF00' });
  const swatch = result.document.colors[0].swatches[0];
  assert.equal(swatch.rgba, '#00ff0080'); assert.equal(swatch.stops[1].rgba, '#00ff0080');
  const stopped = edit(result.document, 'swatch-stop', { channelKey: 'color-1', swatchKey: 'default', value: '#123456aa', stopIndex: '2' });
  assert.equal(stopped.document.colors[0].swatches[0].stops[2].rgba, '#123456aa');
  assert.equal(stopped.document.colors[0].swatches[0].rgba, '#00ff0080');
});

test('short stored gradients materialize renderer-effective stops without changing other endpoint colors', () => {
  for (const stops of [[], [{ offset: 0.3, rgba: '#001122ff' }]]) {
    const doc = fixture(); const swatch = doc.colors[0].swatches[0]; swatch.stops = stops;
    const effective = creatorColorStops(swatch);
    assert.deepEqual(pixels(swatch), pixels({ ...swatch, stops: effective }));
    const result = edit(doc, 'swatch-stop', { channelKey: 'color-1', swatchKey: 'default', value: '#ffffff', stopIndex: 2 });
    assert.deepEqual(result.document.colors[0].swatches[0].stops, [effective[0], effective[1], { offset: 1, rgba: '#ffffffff' }]);
    const mid = edit(doc, 'swatch-mid', { channelKey: 'color-1', swatchKey: 'default', value: '#000000' });
    assert.deepEqual(mid.document.colors[0].swatches[0].stops, [effective[0], { offset: 0.5, rgba: '#000000ff' }, effective[2]]);
  }
});

test('two-stop midpoint insertion and longer custom gradients preserve all unrelated stops and offsets', () => {
  const doc = fixture(); const swatch = doc.colors[0].swatches[0];
  swatch.stops = [{ offset: 0, rgba: '#000000ff' }, { offset: 1, rgba: '#ffffffff' }];
  const result = edit(doc, 'swatch-mid', { channelKey: 'color-1', swatchKey: 'default', value: '#123456' });
  assert.deepEqual(result.document.colors[0].swatches[0].stops, [swatch.stops[0], { offset: 0.5, rgba: '#123456ff' }, swatch.stops[1]]);
  swatch.stops = [0, 0.25, 0.5, 0.75, 1].map(offset => ({ offset, rgba: '#123456ff' }));
  const longer = edit(doc, 'swatch-mid', { channelKey: 'color-1', swatchKey: 'default', value: '#abcdef' });
  assert.deepEqual(longer.document.colors[0].swatches[0].stops, swatch.stops.map((stop, index) => index === 2 ? { ...stop, rgba: '#abcdefff' } : stop));
  const viewStops = creatorColorStops(swatch); viewStops[0].rgba = '#ffffffff';
  assert.equal(swatch.stops[0].rgba, '#123456ff', 'view receives detached stop objects');
});

test('strict names, colors, indices, missing identities, and malformed documents fail without source edits', () => {
  const doc = freeze(fixture()); const before = structuredClone(doc);
  for (const value of ['', '  ', 42, null, '界'.repeat(86)]) {
    for (const action of ['channel-name', 'swatch-name']) {
      assert.throws(() => edit(doc, action, { channelKey: 'color-1', swatchKey: 'default', value }), /name/);
    }
  }
  for (const value of ['', '#fff', '#123456z', '#123456789', 'red', 42, null]) {
    assert.throws(() => edit(doc, 'swatch-hint', { channelKey: 'color-1', swatchKey: 'default', value }), /color must/);
  }
  for (const stopIndex of [-1, 3, 0.5, NaN, Infinity, '', ' 0', '1e0', null]) {
    assert.throws(() => edit(doc, 'swatch-stop', { channelKey: 'color-1', swatchKey: 'default', value: '#ffffff', stopIndex }), /gradient stop/);
  }
  assert.throws(() => edit(doc, 'channel-name', { channelKey: 'missing', value: 'Name' }), /no longer exists/);
  assert.throws(() => edit(doc, 'swatch-name', { channelKey: 'color-1', swatchKey: 'missing', value: 'Name' }), /no longer exists/);
  assert.throws(() => edit(doc, 'channel-default-swatch', { channelKey: 'color-1', value: 'missing' }), /existing Color preset/);
  assert.throws(() => edit(doc, 'unknown', { channelKey: 'color-1', swatchKey: 'default' }), /Unknown/);
  const invalid = structuredClone(doc); invalid.colors[0].swatches[0].stops[0].offset = NaN;
  assert.throws(() => edit(invalid, 'add-channel'), /finite/);
  invalid.colors[0].swatches[0].stops[0].offset = 0; invalid.colors[0].swatches[0].label = '';
  assert.throws(() => edit(invalid, 'add-channel'), /name/);
  const extra = structuredClone(doc); extra.colors[0].swatches[0].stops[0].unexpected = true;
  assert.throws(() => edit(extra, 'add-channel'));
  assert.deepEqual(doc, before);
});
