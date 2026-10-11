import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlayerOptions,
  buildPlayerPartOptions,
  evaluatePlayerClearOptionalOption,
  evaluatePlayerItemOption,
  evaluatePlayerRemovePartOption,
  evaluatePlayerStyleOption,
  generatePlayablePlayerRecipe,
  normalizePlayablePlayerRecipe,
} from '../maker-player-options.js';
import { normalizeRecipe } from '../maker-rules.js';

function style(id, assetId, rules = {}) {
  return {
    id,
    name: rules.name || id,
    assetId,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: rules.visibleWhen || null,
    requires: rules.requires || [],
    excludes: rules.excludes || [],
  };
}

function item(id, styles, rules = {}) {
  return {
    id,
    name: rules.name || id,
    status: 'public',
    defaultStyleId: rules.defaultStyleId || styles[0]?.id || '',
    visibleWhen: rules.visibleWhen || null,
    requires: rules.requires || [],
    excludes: rules.excludes || [],
    styles,
  };
}

function part(id, items, rules = {}) {
  return {
    id,
    name: rules.name || id,
    menuOrder: rules.menuOrder || 0,
    menuVisible: true,
    required: rules.required || false,
    defaultItemId: rules.defaultItemId || items[0]?.id || '',
    requires: [],
    excludes: [],
    items,
  };
}

function png(id) {
  return {
    id,
    identifier: `${id}.png`,
    kind: 'layer',
    mediaType: 'image/png',
    width: 1024,
    height: 1024,
  };
}

function optionMaker() {
  return {
    id: 'player-options',
    assets: [
      png('body-art'),
      png('casual-art'),
      png('armor-art'),
      png('armor-heavy-art'),
      png('ring-art'),
      png('sword-art'),
      png('cap-art'),
    ],
    defaultRecipe: {
      selections: [
        { partId: 'body', itemId: 'body', styleId: 'default' },
        { partId: 'outfit', itemId: 'casual', styleId: 'default' },
        { partId: 'accessory', itemId: 'ring', styleId: 'default' },
      ],
      colors: [],
    },
    parts: [
      part('body', [
        item('body', [style('default', 'body-art')]),
      ], { required: true, defaultItemId: 'body' }),
      part('outfit', [
        item('casual', [style('default', 'casual-art')]),
        item('armor', [
          style('default', 'armor-art'),
          style('heavy', 'armor-heavy-art'),
        ], {
          requires: [{ partId: 'accessory', itemId: 'sword' }],
        }),
      ], { menuOrder: 1, defaultItemId: 'casual' }),
      part('accessory', [
        item('ring', [style('default', 'ring-art')]),
        item('sword', [style('default', 'sword-art')]),
      ], { menuOrder: 2, defaultItemId: 'ring' }),
      part('hat', [
        item('cap', [style('default', 'cap-art')], {
          excludes: [{ partId: 'accessory', itemId: 'ring' }],
        }),
      ], { menuOrder: 3, defaultItemId: 'cap' }),
    ],
    rules: [],
  };
}

test('an empty default Style is hidden while a valid alternative keeps its Item playable', () => {
  const maker = optionMaker();
  const hair = part('hair', [
    item('long', [
      style('default', null, { name: 'Empty default' }),
      style('blue', 'blue-hair-art', { name: 'Blue' }),
    ], { defaultStyleId: 'default' }),
  ]);
  maker.parts.push(hair);
  maker.assets.push(png('blue-hair-art'));
  const recipe = structuredClone(maker.defaultRecipe);
  const makerBefore = structuredClone(maker);
  const recipeBefore = structuredClone(recipe);

  const result = evaluatePlayerItemOption(maker, recipe, {
    partId: 'hair',
    itemId: 'long',
  });

  assert.equal(result.visible, true);
  assert.equal(result.selectable, true);
  assert.equal(result.preferredStyleId, 'blue');
  assert.equal(result.styles[0].visible, false);
  assert.equal(result.styles[0].selectable, false);
  assert.equal(result.styles[0].reasonCode, 'missing-style-png');
  assert.equal(result.styles[1].visible, true);
  assert.equal(result.styles[1].selectable, true);
  assert.equal(result.nextRecipe.selections.find((entry) => entry.partId === 'hair').styleId, 'blue');
  assert.deepEqual(maker, makerBefore);
  assert.deepEqual(recipe, recipeBefore);
});

test('Style visibility controls Player availability while another visible Style keeps the Item playable', () => {
  const maker = optionMaker();
  const casual = maker.parts.find((part) => part.id === 'outfit')
    .items.find((candidate) => candidate.id === 'casual');
  casual.styles[0].visibleWhen = {
    op: 'selected',
    partId: 'accessory',
    itemId: 'sword',
  };
  casual.styles.push(style('alternate', 'casual-alternate-art'));
  maker.assets.push(png('casual-alternate-art'));

  const hidden = evaluatePlayerStyleOption(maker, maker.defaultRecipe, {
    partId: 'outfit',
    itemId: 'casual',
    styleId: 'default',
  });
  assert.equal(hidden.visible, false);
  assert.equal(hidden.selectable, false);

  const itemOption = evaluatePlayerItemOption(maker, maker.defaultRecipe, {
    partId: 'outfit',
    itemId: 'casual',
  });
  assert.equal(itemOption.visible, true);
  assert.equal(itemOption.selectable, true);
  assert.equal(itemOption.preferredStyleId, 'alternate');

  const swordRecipe = structuredClone(maker.defaultRecipe);
  swordRecipe.selections = swordRecipe.selections.map((selection) => (
    selection.partId === 'accessory'
      ? { partId: 'accessory', itemId: 'sword', styleId: 'default' }
      : selection
  ));
  const visible = evaluatePlayerStyleOption(maker, swordRecipe, {
    partId: 'outfit',
    itemId: 'casual',
    styleId: 'default',
  });
  assert.equal(visible.visible, true);
  assert.equal(visible.selectable, true);
});

test('requires disables a candidate instead of replacing another selected Part', () => {
  const maker = optionMaker();
  const recipe = structuredClone(maker.defaultRecipe);
  const recipeBefore = structuredClone(recipe);

  const ordinaryNormalization = normalizeRecipe(maker, {
    ...recipe,
    selections: recipe.selections.map((selection) => (
      selection.partId === 'outfit'
        ? { partId: 'outfit', itemId: 'armor', styleId: 'default' }
        : selection
    )),
  }, { preferPartId: 'outfit' });
  assert.equal(ordinaryNormalization.selection.accessory.itemId, 'sword',
    'the general solver is able to repair this click by changing Accessory');

  const result = evaluatePlayerStyleOption(maker, recipe, {
    partId: 'outfit',
    itemId: 'armor',
    styleId: 'default',
  });

  assert.equal(result.visible, true);
  assert.equal(result.selectable, false);
  assert.equal(result.disabled, true);
  assert.equal(result.reasonCode, 'requires-rule');
  assert.match(result.reasonText, /Requires accessory › sword/i);
  assert.equal(result.nextRecipe, null);
  assert.deepEqual(recipe, recipeBefore);
  assert.equal(recipe.selections.find((entry) => entry.partId === 'accessory').itemId, 'ring');
});

test('requires becomes selectable when the required existing choice is already present', () => {
  const maker = optionMaker();
  const recipe = structuredClone(maker.defaultRecipe);
  recipe.selections = recipe.selections.map((selection) => (
    selection.partId === 'accessory'
      ? { partId: 'accessory', itemId: 'sword', styleId: 'default' }
      : selection
  ));

  const result = evaluatePlayerItemOption(maker, recipe, {
    partId: 'outfit',
    itemId: 'armor',
  });

  assert.equal(result.visible, true);
  assert.equal(result.selectable, true);
  assert.equal(result.reason, null);
  assert.equal(result.nextRecipe.selections.find((entry) => entry.partId === 'accessory').itemId, 'sword');
});

test('excludes leaves an incompatible Item visible but disabled with a readable reason', () => {
  const maker = optionMaker();
  const result = evaluatePlayerItemOption(maker, maker.defaultRecipe, {
    partId: 'hat',
    itemId: 'cap',
  });

  assert.equal(result.visible, true);
  assert.equal(result.selectable, false);
  assert.equal(result.reasonCode, 'excludes-rule');
  assert.match(result.reasonText, /Cannot be combined with accessory › ring/i);
});

test('a selectable candidate preserves every other Part exactly in nextRecipe', () => {
  const maker = optionMaker();
  const recipe = structuredClone(maker.defaultRecipe);
  const beforeOthers = recipe.selections.filter((selection) => selection.partId !== 'outfit');

  const result = evaluatePlayerStyleOption(maker, recipe, {
    partId: 'outfit',
    itemId: 'casual',
    styleId: 'default',
  });

  assert.equal(result.selectable, true);
  assert.deepEqual(
    result.nextRecipe.selections.filter((selection) => selection.partId !== 'outfit'),
    beforeOthers,
  );
  result.nextRecipe.selections[0].itemId = 'mutated-result';
  assert.notEqual(recipe.selections[0].itemId, 'mutated-result');
});

test('part and complete builders expose every Item and Style state without source references', () => {
  const maker = optionMaker();
  maker.parts[1].items[0].styles.push(style('empty', null));

  const outfit = buildPlayerPartOptions(maker, maker.defaultRecipe, 'outfit');
  const all = buildPlayerOptions(maker, maker.defaultRecipe);

  assert.deepEqual(outfit.items.map((entry) => entry.itemId), ['casual', 'armor']);
  assert.equal(outfit.items[0].styles.find((entry) => entry.styleId === 'empty').visible, false);
  assert.equal(all.parts.find((entry) => entry.partId === 'hat').items[0].reasonCode, 'excludes-rule');
  all.parts[0].items[0].name = 'changed output';
  assert.equal(maker.parts[0].items[0].name, 'body');
});

test('removing a required dependency is disabled instead of creating an invalid recipe', () => {
  const maker = optionMaker();
  const recipe = {
    selections: [
      { partId: 'body', itemId: 'body', styleId: 'default' },
      { partId: 'outfit', itemId: 'armor', styleId: 'default' },
      { partId: 'accessory', itemId: 'sword', styleId: 'default' },
    ],
    colors: [],
  };
  const before = structuredClone(recipe);

  const removal = evaluatePlayerRemovePartOption(maker, recipe, 'accessory');

  assert.equal(removal.visible, true);
  assert.equal(removal.selectable, false);
  assert.equal(removal.reasonCode, 'requires-rule');
  assert.match(removal.reasonText, /Requires accessory › sword/i);
  assert.equal(removal.nextRecipe, null);
  assert.deepEqual(recipe, before);
});

test('global Remove optional is disabled when a required Part depends on an optional Part', () => {
  const maker = optionMaker();
  maker.parts[0].items[0].requires = [{ partId: 'accessory', itemId: 'sword' }];
  const recipe = {
    selections: [
      { partId: 'body', itemId: 'body', styleId: 'default' },
      { partId: 'accessory', itemId: 'sword', styleId: 'default' },
    ],
    colors: [],
  };

  const removal = evaluatePlayerClearOptionalOption(maker, recipe);

  assert.equal(removal.selectable, false);
  assert.equal(removal.reasonCode, 'requires-rule');
  assert.equal(removal.nextRecipe, null);
});

test('playable normalization replaces an empty selected default Style', () => {
  const maker = optionMaker();
  maker.parts.push(part('hair', [
    item('long', [
      style('default', null),
      style('blue', 'blue-hair-art'),
    ], { defaultStyleId: 'default' }),
  ]));
  maker.assets.push(png('blue-hair-art'));
  maker.defaultRecipe.selections.push({
    partId: 'hair',
    itemId: 'long',
    styleId: 'default',
  });

  const normalized = normalizePlayablePlayerRecipe(maker, maker.defaultRecipe);

  assert.equal(normalized.valid, true);
  assert.equal(
    normalized.documentRecipe.selections.find((selection) => selection.partId === 'hair').styleId,
    'blue',
  );
  assert.ok(normalized.changes.some((change) => change.partId === 'hair'));
});

test('playable normalization never leaves an empty PNG Style selected when no replacement exists', () => {
  const maker = {
    id: 'empty-required',
    assets: [],
    defaultRecipe: {
      selections: [{ partId: 'body', itemId: 'base', styleId: 'default' }],
      colors: [],
    },
    parts: [
      part('body', [
        item('base', [style('default', null)]),
      ], { required: true }),
    ],
    rules: [],
  };

  const normalized = normalizePlayablePlayerRecipe(maker, maker.defaultRecipe);

  assert.equal(normalized.valid, false);
  assert.deepEqual(normalized.documentRecipe.selections, []);
  assert.ok(normalized.violations.some((violation) => violation.code === 'missing-style-png'));
  assert.ok(normalized.violations.some((violation) => violation.code === 'required-part-missing'));
});

test('playable random generation never returns an empty PNG Style', () => {
  const maker = {
    id: 'random-playable',
    assets: [png('blue-hair-art')],
    defaultRecipe: {
      selections: [{ partId: 'hair', itemId: 'long', styleId: 'default' }],
      colors: [],
    },
    parts: [
      part('hair', [
        item('long', [
          style('default', null),
          style('blue', 'blue-hair-art'),
        ], { defaultStyleId: 'default' }),
      ], { required: true }),
    ],
    rules: [],
  };

  for (let index = 0; index < 20; index += 1) {
    const generated = generatePlayablePlayerRecipe(maker);
    assert.equal(generated.valid, true);
    assert.equal(generated.documentRecipe.selections[0].styleId, 'blue');
  }
});

test('reverse excludes explains the already-selected trigger instead of the candidate itself', () => {
  const maker = optionMaker();
  maker.parts[3].items[0].excludes = [];
  maker.rules = [{
    id: 'ring-blocks-cap',
    type: 'excludes',
    trigger: { partId: 'accessory', itemId: 'ring' },
    targets: [{ partId: 'hat', itemId: 'cap' }],
  }];

  const option = evaluatePlayerItemOption(maker, maker.defaultRecipe, {
    partId: 'hat',
    itemId: 'cap',
  });

  assert.equal(option.selectable, false);
  assert.equal(option.reasonCode, 'excludes-rule');
  assert.match(option.reasonText, /accessory › ring/i);
  assert.doesNotMatch(option.reasonText, /hat › cap/i);
});
