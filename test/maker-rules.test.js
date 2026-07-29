import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MakerRuleError,
  collectMakerRules,
  composeRuleTargets,
  createMakerRuleIndex,
  evaluateRecipe,
  evaluateVisibleWhen,
  generateValidRecipe,
  isStyleVisible,
  migrateLegacyMakerRules,
  normalizeRecipe,
  ruleSelectorKey,
} from '../maker-rules.js';

function style(id, rules = {}) {
  return {
    id,
    name: id,
    displayOrder: 0,
    assetId: `${id}-asset`,
    layerTrackId: `${id}-track`,
    colorChannelId: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    positionConfirmed: false,
    positionLocked: false,
    styleLocked: false,
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: rules.visibleWhen || null,
    requires: rules.requires || [],
    excludes: rules.excludes || [],
  };
}

function item(id, rules = {}, styleIds = ['default']) {
  return {
    id,
    name: id,
    status: 'public',
    defaultStyleId: styleIds[0],
    requires: rules.requires || [],
    excludes: rules.excludes || [],
    styles: styleIds.map((styleId) => style(styleId, rules.styles?.[styleId])),
  };
}

function ruleMaker() {
  return {
    id: 'rule-maker',
    defaultRecipe: {
      selections: [
        { partId: 'body', itemId: 'base', styleId: 'default' },
        { partId: 'outfit', itemId: 'casual', styleId: 'default' },
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
      trigger: { partId: 'outfit', itemId: 'armor', styleId: 'heavy' },
      targets: [{ partId: 'hat' }],
    }],
  };
}

test('composes canonical ALL and same-Part ANY targets with stable set identity', () => {
  assert.deepEqual(composeRuleTargets([
    { partId: 'outfit', itemId: 'casual' },
    { partId: 'accessory', itemId: 'ring' },
  ], 'all'), [
    { partId: 'outfit', itemId: 'casual' },
    { partId: 'accessory', itemId: 'ring' },
  ]);
  assert.deepEqual(composeRuleTargets([
    { partId: 'accessory', itemId: 'ring' },
    { partId: 'accessory', itemId: 'sword' },
  ], 'any'), [{
    partId: 'accessory',
    itemIds: ['ring', 'sword'],
  }]);
  assert.deepEqual(composeRuleTargets([
    { partId: 'outfit', itemId: 'armor', styleId: 'light' },
    { partId: 'outfit', itemId: 'armor', styleId: 'heavy' },
  ], 'any'), [{
    partId: 'outfit',
    itemId: 'armor',
    styleIds: ['heavy', 'light'],
  }]);
  assert.equal(
    ruleSelectorKey({ partId: 'accessory', itemIds: ['ring', 'sword'] }),
    ruleSelectorKey({ partId: 'accessory', itemIds: ['sword', 'ring'] }),
  );
  assert.throws(
    () => composeRuleTargets([
      { partId: 'outfit', itemId: 'casual' },
      { partId: 'accessory', itemId: 'ring' },
    ], 'any'),
    (error) => error instanceof MakerRuleError && error.code === 'cross-part-any-rule',
  );
});

test('migrates resolvable legacy global and nested rules without silently dropping ambiguous rules', () => {
  const maker = ruleMaker();
  const casual = maker.parts[1].items[0];
  casual.rules = {
    requires: [{ partId: 'accessory', itemId: 'ring' }],
  };
  maker.rules.push({
    id: 'ambiguous-owner',
    type: 'requires',
    trigger: { partId: 'accessory', itemIds: ['ring', 'sword'] },
    targets: [{ partId: 'body', itemId: 'base' }],
  });

  const result = migrateLegacyMakerRules(maker);
  const heavy = maker.parts[1].items[1].styles.find((entry) => entry.id === 'heavy');

  assert.equal(result.migrated, 2);
  assert.deepEqual(casual.requires, [{ partId: 'accessory', itemId: 'ring' }]);
  assert.equal(Object.hasOwn(casual, 'rules'), false);
  assert.deepEqual(heavy.excludes, [{ partId: 'hat' }]);
  assert.equal(maker.rules.length, 1);
  assert.equal(maker.rules[0].id, 'ambiguous-owner');
  assert.deepEqual(result.unresolved, [{
    path: 'rules[1]',
    reason: 'ambiguous-or-missing-trigger',
  }]);

  const secondPass = migrateLegacyMakerRules(maker);
  assert.equal(secondPass.migrated, 0);
  assert.equal(secondPass.unresolved.length, 1);
});

test('legacy nested shorthand targets inherit only their owner Part during migration', () => {
  const maker = ruleMaker();
  maker.rules = [];
  const outfit = maker.parts.find((part) => part.id === 'outfit');
  const casual = outfit.items.find((item) => item.id === 'casual');
  casual.rules = {
    requires: [{ itemId: 'armor', styleId: 'light' }],
    excludes: [{ itemId: 'armor', styleId: 'heavy' }],
  };

  const before = collectMakerRules(maker)
    .filter((rule) => rule.trigger.partId === 'outfit' && rule.trigger.itemId === 'casual')
    .map(({ type, targets }) => ({ type, targets }));
  const result = migrateLegacyMakerRules(maker);
  const after = collectMakerRules(maker)
    .filter((rule) => rule.trigger.partId === 'outfit' && rule.trigger.itemId === 'casual')
    .map(({ type, targets }) => ({ type, targets }));

  assert.equal(result.migrated, 2);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(after, before);
  assert.deepEqual(casual.requires, [{
    partId: 'outfit',
    itemId: 'armor',
    styleId: 'light',
  }]);
  assert.deepEqual(casual.excludes, [{
    partId: 'outfit',
    itemId: 'armor',
    styleId: 'heavy',
  }]);
  assert.equal(Object.hasOwn(casual, 'rules'), false);
});

test('runtime treats itemIds groups as ANY while requires lists remain ALL and excludes express NOT', () => {
  const maker = ruleMaker();
  const casual = maker.parts.find((part) => part.id === 'outfit').items.find((entry) => entry.id === 'casual');
  casual.requires = [{ partId: 'accessory', itemIds: ['ring', 'sword'] }];
  assert.equal(evaluateRecipe(maker, [
    { partId: 'body', itemId: 'base', styleId: 'default' },
    { partId: 'outfit', itemId: 'casual', styleId: 'default' },
    { partId: 'accessory', itemId: 'ring', styleId: 'default' },
  ]).valid, true);
  assert.equal(evaluateRecipe(maker, [
    { partId: 'body', itemId: 'base', styleId: 'default' },
    { partId: 'outfit', itemId: 'casual', styleId: 'default' },
  ]).valid, false);

  casual.requires = [];
  casual.excludes = [{ partId: 'accessory', itemIds: ['ring', 'sword'] }];
  const excluded = evaluateRecipe(maker, [
    { partId: 'body', itemId: 'base', styleId: 'default' },
    { partId: 'outfit', itemId: 'casual', styleId: 'default' },
    { partId: 'accessory', itemId: 'sword', styleId: 'default' },
  ]);
  assert.equal(excluded.valid, false);
  assert.ok(excluded.violations.some((issue) => issue.code === 'excludes-rule'));
});

test('evaluates requires and excludes without mutating the supplied recipe', () => {
  const maker = ruleMaker();
  const input = [
    { partId: 'body', itemId: 'base' },
    { partId: 'outfit', itemId: 'armor', styleId: 'heavy' },
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
    { partId: 'outfit', itemId: 'armor', styleId: 'light' },
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
    outfit: { itemId: 'armor', styleId: 'light' },
  }, { preferPartId: 'outfit' });
  assert.equal(result.valid, true);
  assert.equal(result.selection.outfit.itemId, 'armor');
  assert.equal(result.selection.accessory.itemId, 'sword');
});

test('removes a child selection when its parent selection does not activate it', () => {
  const result = normalizeRecipe(ruleMaker(), [
    { partId: 'body', itemId: 'base' },
    { partId: 'outfit', itemId: 'armor', styleId: 'light' },
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

test('evaluates Style-aware selected/all/any/not visibleWhen conditions', () => {
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
  assert.equal(isStyleVisible({ partId: 'outfit', itemId: 'casual', styleId: 'default', visibleWhen: condition }, recipe), true);
  assert.equal(isStyleVisible({ partId: 'outfit', itemId: 'armor', styleId: 'light', visibleWhen: condition }, recipe), false);
});

test('final visibility treats an omitted optional Part as explicitly not selected', () => {
  const condition = {
    op: 'not',
    condition: { op: 'selected', partId: 'hat', itemId: 'cap' },
  };
  assert.equal(evaluateVisibleWhen(condition, { selections: [] }), true);
  assert.equal(evaluateVisibleWhen(condition, {
    selections: [{ partId: 'hat', itemId: 'cap', styleId: 'default' }],
  }), false);
  assert.equal(evaluateVisibleWhen(condition, {
    selections: [{ partId: 'hat', itemId: 'beanie', styleId: 'default' }],
  }), true);
});

test('isStyleVisible ignores obsolete hidden, enabled and visibilityCondition aliases', () => {
  const recipe = normalizeRecipe(ruleMaker(), {
    body: 'base',
    outfit: 'casual',
    accessory: 'sword',
  });
  const owner = {
    partId: 'outfit',
    itemId: 'casual',
    styleId: 'default',
  };
  const falseCondition = { op: 'selected', partId: 'accessory', itemId: 'ring' };
  assert.equal(isStyleVisible({ ...owner, hidden: true }, recipe), true);
  assert.equal(isStyleVisible({ ...owner, enabled: false }, recipe), true);
  assert.equal(isStyleVisible({ ...owner, visibilityCondition: falseCondition }, recipe), true);
});

test('normalizes ColorChannel selections into a renderer-ready v5 recipe', () => {
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
  assert.ok(result.violations.some((issue) => issue.code === 'hidden-item-or-style-selected'));
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
