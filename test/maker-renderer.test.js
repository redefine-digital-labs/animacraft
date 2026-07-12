import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLEND_MODES,
  evaluateVisibleWhen,
  renderMakerToCanvas,
  resolveMakerScene,
} from '../maker-renderer.js';

function makerFixture() {
  return {
    schemaVersion: 'animacraft.maker-document.v4',
    canvas: { width: 800, height: 600, pixelMode: 'nearest' },
    layerTracks: [
      { id: 'fx', order: 30 },
      { id: 'front', order: 20 },
      { id: 'back', order: 10 },
      { id: 'same-b', order: 25 },
      { id: 'same-a', order: 25 },
    ],
    colorChannels: [{
      id: 'hair-color',
      name: 'Hair',
      defaultValueId: 'black',
      values: [
        { id: 'black', value: '#111111' },
        { id: 'blue', value: '#3366ff' },
      ],
    }],
    assets: [
      { id: 'body', width: 800, height: 600 },
      { id: 'hair-back-black', width: 400, height: 300 },
      { id: 'hair-back-blue', width: 400, height: 300 },
      { id: 'hair-front', width: 800, height: 600 },
      { id: 'sparkle', width: 100, height: 100 },
      { id: 'hidden', width: 100, height: 100 },
      { id: 'a', width: 10, height: 10 },
      { id: 'b', width: 10, height: 10 },
    ],
    parts: [
      {
        id: 'hair',
        menuOrder: 2,
        colorChannelId: 'hair-color',
        items: [{
          id: 'long',
          variants: [{
            id: 'swept',
            bindings: [
              {
                id: 'back',
                layerTrackId: 'back',
                sourceAssetIdsByColor: { black: 'hair-back-black', blue: 'hair-back-blue' },
                transform: { x: 12, y: 8, scale: 1.25, rotation: 5, originX: 200, originY: 150 },
                opacity: 80,
                blendMode: 'multiply',
              },
              { id: 'front', layerTrackId: 'front', sourceAssetId: 'hair-front', blendMode: 'screen' },
              {
                id: 'sparkle',
                layerTrackId: 'fx',
                sourceAssetId: 'sparkle',
                blendMode: 'linear-dodge',
                visibleWhen: { partId: 'body', itemId: 'base' },
              },
              {
                id: 'not-rendered',
                layerTrackId: 'fx',
                sourceAssetId: 'hidden',
                visibleWhen: { excludes: [{ partId: 'body', itemId: 'base' }] },
              },
              { id: 'same-b', layerTrackId: 'same-b', sourceAssetId: 'b' },
              { id: 'same-a', layerTrackId: 'same-a', sourceAssetId: 'a' },
            ],
          }],
        }],
      },
      {
        id: 'body',
        menuOrder: 1,
        items: [{ id: 'base', bindings: [{ id: 'body', layerTrackId: 'back', sourceAssetId: 'body', order: -1 }] }],
      },
    ],
  };
}

function recipeFixture(reverse = false) {
  const selections = [
    { partId: 'hair', itemId: 'long', variantId: 'swept' },
    { partId: 'body', itemId: 'base' },
  ];
  return {
    selections: reverse ? selections.reverse() : selections,
    colorChannels: { 'hair-color': 'blue' },
  };
}

test('resolves a recipe to a deterministic back-to-front layer list', () => {
  const first = resolveMakerScene(makerFixture(), recipeFixture());
  const reversed = resolveMakerScene(makerFixture(), recipeFixture(true));

  assert.deepEqual(
    first.layers.map((layer) => layer.key),
    [
      'body/base/default/body',
      'hair/long/swept/back',
      'hair/long/swept/front',
      'hair/long/swept/same-a',
      'hair/long/swept/same-b',
      'hair/long/swept/sparkle',
    ],
  );
  assert.deepEqual(
    first.layers.map((layer) => layer.key),
    reversed.layers.map((layer) => layer.key),
    'recipe array order must never become render order',
  );

  const back = first.layers.find((layer) => layer.bindingId === 'back');
  assert.equal(back.assetId, 'hair-back-blue');
  assert.deepEqual(back.colorChannel && {
    id: back.colorChannel.id,
    valueId: back.colorChannel.valueId,
    value: back.colorChannel.value,
  }, { id: 'hair-color', valueId: 'blue', value: '#3366ff' });
  assert.deepEqual(back.transform, {
    x: 12,
    y: 8,
    width: 400,
    height: 300,
    scaleX: 1.25,
    scaleY: 1.25,
    rotation: 5,
    originX: 200,
    originY: 150,
  });
  assert.equal(back.opacity, 0.8);
  assert.equal(back.compositeOperation, BLEND_MODES.multiply);
  assert.equal(first.layers.at(-1).blendMode, 'add');
  assert.equal(first.layers.at(-1).compositeOperation, 'lighter');
  assert.equal(first.pixelMode, 'nearest');
  assert.deepEqual(first.issues, []);
});

test('evaluates requires, excludes, parent selections and color conditions', () => {
  const context = {
    selections: new Map([
      ['face', { itemId: 'smile', variantId: 'open' }],
      ['hat', { itemId: '' }],
    ]),
    colorChannels: new Map([['eyes', { valueId: 'violet', value: '#7755ff' }]]),
  };

  assert.equal(evaluateVisibleWhen({ all: [
    { partId: 'face', itemId: 'smile', variantId: 'open' },
    { colorChannelId: 'eyes', in: ['violet', 'green'] },
  ] }, context), true);
  assert.equal(evaluateVisibleWhen({ partId: 'hat', selected: false }, context), true);
  assert.equal(evaluateVisibleWhen({
    requires: [{ partId: 'face', itemIds: ['smile'] }],
    excludes: [{ colorChannelId: 'eyes', equals: '#7755ff' }],
  }, context), false);
  assert.equal(evaluateVisibleWhen({
    op: 'all',
    conditions: [
      { op: 'selected', partId: 'face', itemId: 'smile' },
      { op: 'not', condition: { op: 'selected', partId: 'hat' } },
    ],
  }, context), true);
});

test('does not silently replace an explicit None or missing Item', () => {
  const maker = makerFixture();
  maker.parts[0].defaultItemId = 'long';
  maker.parts[0].required = true;

  const none = resolveMakerScene(maker, { selections: [{ partId: 'hair', itemId: '' }] });
  assert.deepEqual(none.layers, []);

  const missing = resolveMakerScene(maker, { selections: [{ partId: 'hair', itemId: 'missing' }] });
  assert.deepEqual(missing.layers, []);
  assert.equal(missing.issues[0].code, 'unknown-item');
  assert.throws(
    () => resolveMakerScene(maker, { selections: [{ partId: 'hair', itemId: 'missing' }] }, { strict: true }),
    (error) => error.name === 'MakerSceneResolutionError' && error.issues[0].code === 'unknown-item',
  );
});

test('can opt into required defaults without overriding an explicit None', () => {
  const maker = makerFixture();
  maker.parts[1].required = true;
  maker.parts[1].defaultItemId = 'base';

  const omitted = resolveMakerScene(maker, { selections: [] }, { useRequiredDefaults: true });
  assert.deepEqual(omitted.layers.map((layer) => layer.key), ['body/base/default/body']);

  const explicitNone = resolveMakerScene(maker, { selections: [{ partId: 'body', itemId: '' }] }, { useRequiredDefaults: true });
  assert.deepEqual(explicitNone.layers, []);
});

test('adapts the published v3 layer and image matrix into the shared scene', () => {
  const maker = {
    schemaVersion: 'animacraft.creator-template.v3',
    template: { canvas: { width: 1024, height: 1024 } },
    assets: [{ identifier: 'hair-blue.png', width: 1024, height: 1024 }],
    parts: [{
      key: 'hair',
      colorChannelId: 'hair',
      colors: [{ id: 'black', value: '#111111' }, { id: 'blue', value: '#3366ff' }],
      layers: [{ id: 'front', renderOrder: 4, x: 7, y: 9, opacity: 50, blendMode: 'screen' }],
      items: [{
        id: 'bob',
        images: [{ layerId: 'front', colorId: 'blue', identifier: 'hair-blue.png' }],
      }],
    }],
  };
  const scene = resolveMakerScene(maker, [{ slot: 'hair', part: 'bob', color: '#3366ff' }]);
  assert.equal(scene.layers.length, 1);
  assert.equal(scene.layers[0].trackId, 'hair:front');
  assert.equal(scene.layers[0].assetId, 'hair-blue.png');
  assert.equal(scene.layers[0].transform.x, 7);
  assert.equal(scene.layers[0].opacity, 0.5);
  assert.equal(scene.layers[0].compositeOperation, 'screen');
});

test('uses v4 swatches and assetsBySwatch without a Part-level color channel', () => {
  const maker = {
    schemaVersion: 'animacraft.maker.v4',
    canvas: { width: 512, height: 512, pixelMode: 'pixelated' },
    layerTracks: [{ id: 'eyes', name: 'Eyes', order: 0 }],
    colorChannels: [{
      id: 'eye-color',
      name: 'Eye color',
      order: 0,
      mode: 'gradient-map',
      defaultSwatchId: 'violet',
      swatches: [{
        id: 'violet',
        name: 'Violet',
        hintColor: '#7755ff',
        stops: [{ offset: 0, color: '#110022' }, { offset: 1, color: '#ddaaff' }],
      }, {
        id: 'green',
        name: 'Green',
        hintColor: '#33aa66',
        stops: [{ offset: 0, color: '#001108' }, { offset: 1, color: '#aaffcc' }],
      }],
    }],
    assets: [{ id: 'eye-base' }, { id: 'eye-violet' }, { id: 'eye-green' }],
    parts: [{
      id: 'expression',
      items: [{
        id: 'calm',
        defaultVariantId: 'front',
        variants: [{
          id: 'front',
          layerBindings: [{
            id: 'eyes',
            layerTrackId: 'eyes',
            assetId: 'eye-base',
            colorChannelId: 'eye-color',
            assetsBySwatch: [
              { swatchId: 'violet', assetId: 'eye-violet' },
              { swatchId: 'green', assetId: 'eye-green' },
            ],
            transform: { x: 0, y: 0, scale: 1, rotation: 0 },
            opacity: 1,
            blendMode: 'overlay',
          }],
        }],
      }],
    }],
  };
  const scene = resolveMakerScene(maker, {
    selections: [{ partId: 'expression', itemId: 'calm', variantId: 'front' }],
    colors: [{ channelId: 'eye-color', swatchId: 'green' }],
  });
  assert.equal(scene.layers[0].assetId, 'eye-green');
  assert.equal(scene.layers[0].colorChannel.swatchId, 'green');
  assert.equal(scene.layers[0].colorChannel.value, '#33aa66');
  assert.equal(scene.layers[0].colorChannel.valueDefinition.stops.length, 2);
  assert.equal(scene.layers[0].compositeOperation, 'overlay');
  assert.equal(scene.layers[0].pixelMode, 'nearest');
});

function fakeCanvas() {
  const operations = [];
  const context = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    save() { operations.push(['save']); },
    restore() { operations.push(['restore']); },
    setTransform(...args) { operations.push(['setTransform', ...args]); },
    clearRect(...args) { operations.push(['clearRect', ...args]); },
    fillRect(...args) { operations.push(['fillRect', ...args]); },
    translate(...args) { operations.push(['translate', ...args]); },
    rotate(...args) { operations.push(['rotate', ...args]); },
    scale(...args) { operations.push(['scale', ...args]); },
    drawImage(source, ...args) {
      operations.push([
        'drawImage',
        source.name,
        this.globalAlpha,
        this.globalCompositeOperation,
        this.imageSmoothingEnabled,
        ...args,
      ]);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(type) { return type === '2d' ? context : null; },
  };
  context.canvas = canvas;
  return { canvas, operations };
}

test('Canvas renderer applies transforms, blend, pixel mode and color hook', async () => {
  const maker = makerFixture();
  maker.parts = [maker.parts[0]];
  maker.parts[0].items[0].variants[0].bindings = [maker.parts[0].items[0].variants[0].bindings[0]];
  const { canvas, operations } = fakeCanvas();
  const colors = [];

  const result = await renderMakerToCanvas(maker, recipeFixture(), canvas, {
    resolveAsset(assetId) {
      return { width: 400, height: 300, name: assetId };
    },
    applyColorChannel({ source, channel }) {
      colors.push({ id: channel.id, valueId: channel.valueId });
      return { width: source.width, height: source.height, name: `${source.name}:colored` };
    },
  });

  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  assert.equal(result.drawn, 1);
  assert.deepEqual(colors, [{ id: 'hair-color', valueId: 'blue' }]);
  assert.ok(operations.some((operation) => operation[0] === 'translate' && operation[1] === 212 && operation[2] === 158));
  assert.ok(operations.some((operation) => operation[0] === 'rotate' && Math.abs(operation[1] - (5 * Math.PI / 180)) < 1e-12));
  assert.ok(operations.some((operation) => operation[0] === 'scale' && operation[1] === 1.25 && operation[2] === 1.25));
  assert.deepEqual(
    operations.find((operation) => operation[0] === 'drawImage'),
    ['drawImage', 'hair-back-blue:colored', 0.8, 'multiply', false, 0, 0, 400, 300],
  );
});
