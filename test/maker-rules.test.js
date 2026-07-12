import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MakerRuleError,
  createMakerRuleIndex,
  evaluateRecipe,
  evaluateVisibleWhen,
  generateValidRecipe,
  isLayerVisible,
  normalizeRecipe,
} from '../maker-rules.js';

function variant(id, rules = {}) {
  return { id, name: id, requires: rules.requires || [], excludes: rules.excludes || [], layerBindings: [] };
}

function item(id, rules = {}, variantIds = ['default']) {
  return {
    id,
    name: id,
    visibility: 'public',
    defaultVariantId: variantIds[0],
    requires: rules.requires || [],
    excludes: rules.excludes || [],
    variants: variantIds.map((variantId) => variant(variantId, rules.variants?.[variantId])),
  };
}

function ruleMaker() {
  return {
    id: 'rule-maker',
    defaultRecipe: {
      selections: [
        { partId: 'body', itemId: 'base', variantId: 'default' },
        { partId: 'outfit', itemId: 'casual', variantId: 'default' },
      ],
      colors: [],
    },
    parts: [
      {
        id: 'body',
        name: 'Body',
        menuOrder: 0,
        required: true,
        defaultItemId: 'base',
        parentPartId: null,
        requires: [],
        excludes: [],
        items: [item('base')],
      },
      {
        id: 'outfit',
        name: 'Outfit',
        menuOrder: 1,
        required: false,
        defaultItemId: 'casual',
        parentPartId: 'body',
        requires: [],
        excludes: [],
        items: [
          item('casual'),
          item('armor', { requires: [{ partId: 'accessory', itemId: 'sword' }] }, ['light', 'heavy']),
        ],
      },
      {
        id: 'accessory',
        name: 'Accessory',
        menuOrder: 2,
        required: false,
        defaultItemId: 'ring',
        parentPartId: 'body',
        requires: [],
        excludes: [],
        items: [item('ring'), item('sword')],
      },
      {
        id: 'hat',
        name: 'Hat',
        menuOrder: 3,
        required: false,
        defaultItemId: 'cap',
        parentPartId: 'outfit',
        parentItemIds: ['casual'],
        requires: [],
        excludes: [],
        items: [item('cap', { excludes: [{ partId: 'accessory', itemId: 'ring' }] })],
      },
    ],
    rules: [{
      id: 'heavy-no-hat',
      type: 'excludes',
      trigger: { partId: 'outfit', itemId: 'armor', variantId: 'heavy' },
      targets: [{ partId: 'hat' }],
    }],
  };
}

test('evaluates requires and excludes without mutating the supplied recipe', () => {
  const maker = ruleMaker();
  const input = [
    { partId: 'body', itemId: 'base' },
    { partId: 'outfit', itemId: 'armor', variantId: 'heavy' },
    { partId: 'accessory', itemId: 'ring' },
    { partId: 'hat', itemId: 'cap' },
  ];
  const snapshot = structuredClone(input);
  const result = evaluateRecipe(maker, input);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((issue) => issue.code === 'requires-rule'));
  assert.ok(result.violations.some((issue) => issue.code === 'inactive-child-part'));
  assert.deepEqual(input, snapshot);
});

test('normalizes a recipe through the full requires closure', () => {
  const result = normalizeRecipe(ruleMaker(), [
    { partId: 'body', itemId: 'base' },
    { partId: 'outfit', itemId: 'armor', variantId: 'light' },
    { partId: 'accessory', itemId: 'ring' },
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.selection.outfit.itemId, 'armor');
  assert.equal(result.selection.accessory.itemId, 'sword');
  assert.equal(evaluateRecipe(ruleMaker(), result.recipe).valid, true);
  assert.ok(result.changes.some((change) => change.partId === 'accessory'));
});

test('can lock the player\'s latest click while repairing earlier dependent Parts', () => {
  const maker = ruleMaker();
  const accessory = maker.parts.splice(2, 1)[0];
  accessory.menuOrder = 1;
  maker.parts[1].menuOrder = 2;
  maker.parts.splice(1, 0, accessory);
  const result = normalizeRecipe(maker, {
    body: 'base',
    accessory: 'ring',
    outfit: { itemId: 'armor', variantId: 'light' },
  }, { preferPartId: 'outfit' });
  assert.equal(result.valid, true);
  assert.equal(result.selection.outfit.itemId, 'armor');
  assert.equal(result.selection.accessory.itemId, 'sword');
});

test('removes a child selection when its parent selection does not activate it', () => {
  const result = normalizeRecipe(ruleMaker(), [
    { partId: 'body', itemId: 'base' },
    { partId: 'outfit', itemId: 'armor', variantId: 'light' },
    { partId: 'accessory', itemId: 'sword' },
    { partId: 'hat', itemId: 'cap' },
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.selection.hat, undefined);
});

test('supports legacy symmetric incompatibility records', () => {
  const maker = ruleMaker();
  maker.rules = [{ leftPartKey: 'outfit', leftItemKey: 'casual', rightPartKey: 'accessory', rightItemKey: 'ring' }];
  const result = evaluateRecipe(maker, {
    body: 'base',
    outfit: 'casual',
    accessory: 'ring',
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((issue) => issue.code === 'excludes-rule'));
});

test('evaluates Maker v4 selected/all/any/not visibleWhen conditions', () => {
  const recipe = normalizeRecipe(ruleMaker(), {
    body: 'base',
    outfit: 'casual',
    accessory: 'sword',
  });
  const condition = {
    op: 'all',
    conditions: [
      { op: 'selected', partId: 'outfit', itemId: 'casual' },
      { op: 'not', condition: { op: 'selected', partId: 'accessory', itemId: 'ring' } },
      {
        op: 'any',
        conditions: [
          { op: 'selected', partId: 'accessory', itemId: 'sword' },
          { op: 'selected', partId: 'hat', itemId: 'cap' },
        ],
      },
    ],
  };
  assert.equal(evaluateVisibleWhen(condition, recipe), true);
  assert.equal(isLayerVisible({ partId: 'outfit', itemId: 'casual', visibleWhen: condition }, recipe), true);
  assert.equal(isLayerVisible({ partId: 'outfit', itemId: 'armor', visibleWhen: condition }, recipe), false);
  assert.equal(isLayerVisible({ hidden: true, visibleWhen: condition }, recipe), false);
});

test('normalizes v4 ColorChannel selections into a renderer-ready document recipe', () => {
  const maker = ruleMaker();
  maker.colorChannels = [{
    id: 'hair-color',
    defaultSwatchId: 'violet',
    swatches: [{ id: 'violet' }, { id: 'silver' }],
  }];
  maker.defaultRecipe.colors = [{ channelId: 'hair-color', swatchId: 'violet' }];
  const result = normalizeRecipe(maker, {
    selections: maker.defaultRecipe.selections,
    colors: [{ channelId: 'hair-color', swatchId: 'silver' }],
  });
  assert.deepEqual(result.colors, [{ channelId: 'hair-color', swatchId: 'silver' }]);
  assert.deepEqual(result.documentRecipe.colors, result.colors);
  assert.equal(evaluateRecipe(maker, result.documentRecipe).valid, true);
});

test('rejects a selected Item whose availability condition is false', () => {
  const maker = ruleMaker();
  maker.parts[1].items[0].visibleWhen = { op: 'selected', partId: 'accessory', itemId: 'sword' };
  const result = evaluateRecipe(maker, {
    body: 'base',
    outfit: 'casual',
    accessory: 'ring',
  });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((issue) => issue.code === 'hidden-item-or-variant-selected'));
});

test('constraint-safe random never emits an invalid combination', () => {
  const maker = ruleMaker();
  let seed = 0xdecafbad;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const generated = generateValidRecipe(maker, { random });
    assert.equal(generated.valid, true);
    assert.equal(evaluateRecipe(maker, generated.recipe).valid, true);
  }
});

test('detects parent cycles before recipe solving', () => {
  const maker = ruleMaker();
  maker.parts[0].parentPartId = 'hat';
  assert.throws(() => createMakerRuleIndex(maker), (error) => error instanceof MakerRuleError && error.code === 'part-hierarchy-cycle');
});

test('reports an unsatisfiable Maker instead of returning an unsafe recipe', () => {
  const maker = ruleMaker();
  maker.parts[0].requires = [{ partId: 'accessory', itemId: 'ring' }];
  maker.parts[0].excludes = [{ partId: 'accessory', itemId: 'ring' }];
  const result = normalizeRecipe(maker, {}, { maxNodes: 10_000 });
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((issue) => issue.code === 'unsatisfiable-maker'));
  assert.throws(() => normalizeRecipe(maker, {}, { strict: true }), /do not admit a valid recipe/);
});
