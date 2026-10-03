import assert from 'node:assert/strict';
import test from 'node:test';

import { MAKER_V8_RIGHTS_ORIGINS } from '../maker-commerce-v8.js';
import {
  MAKER_V8_COMPOSITION_MODES,
  MAKER_V8_DOCUMENT_LIMITS,
  MAKER_V8_DOCUMENT_SCHEMA,
  MAKER_V8_OUTPUT_PACK_POLICIES,
  MAKER_V8_PART_KINDS,
  MAKER_V8_PHYSICAL_ISSUANCE,
  MAKER_V8_PHYSICAL_PROOFS,
  MAKER_V8_THIRD_PARTY_ADMISSION_MODES,
  MAKER_V8_WARDROBE_MODES,
  MakerV8DocumentError,
  assertMakerV8Document,
  collectMakerV8DocumentIssues,
  createCharacterMakerV8Starter,
  createMakerV8Document,
  isMakerV8Document,
  projectPublicMakerV8Document,
} from '../maker-v8-document.js';

function mutableStarter() {
  return structuredClone(createCharacterMakerV8Starter({
    makerKey: 'fresh-maker',
    name: 'Fresh Maker',
  }));
}

test('Style visibility is canonical author data with draft-only invalid-default tolerance', () => {
  const document = mutableStarter();
  const target = structuredClone(document.parts[0]);
  target.key = 'target'; target.required = false; target.kind = 'STANDARD';
  target.renderOrder = 1; target.menuOrder = 1;
  document.parts.push(target);
  const style = document.parts[0].items[0].styles[0];
  const condition = { op: 'selected', source: 'BASE', sourceKey: null, partKey: 'target', itemKey: 'default', styleKey: 'default' };
  style.visibleWhen = condition;
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'draft' }));
  assert.ok(collectMakerV8DocumentIssues(document, { mode: 'compile' }).some(row => row.code === 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE'));
  document.defaultRecipe.selections.push({ partKey: 'target', itemKey: 'default', styleKey: 'default' });
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'compile' }));
  assert.deepEqual(projectPublicMakerV8Document(document).parts[0].items[0].styles[0].visibleWhen, condition);
  for (const invalid of [true, { op: 'selected', partId: 'target' }, { ...condition, ignored: true },
    { ...condition, itemKey: 'missing' }, { ...condition, partKey: 'base' }]) {
    style.visibleWhen = invalid;
    assert.ok(collectMakerV8DocumentIssues(document, { mode: 'draft' }).some(row => row.code.startsWith('MAKER_V8_VISIBILITY_')));
  }
  style.visibleWhen = null;
  assert.doesNotThrow(() => assertMakerV8Document(document));
  style.visibleWhen = condition;
  target.items[0].status = 'PRIVATE';
  document.defaultRecipe.selections.pop();
  assert.ok(collectMakerV8DocumentIssues(document, { mode: 'draft' }).some(row => row.code === 'MAKER_V8_VISIBILITY_TARGET_PRIVATE'));
  document.parts[0].items[0].status = 'PRIVATE';
  document.defaultRecipe.selections = [];
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'draft' }));
});

test('Maker Info display fields are optional bounded text, never author authority', () => {
  const document = mutableStarter();
  const original = structuredClone(document);
  assert.equal(Object.hasOwn(document.metadata, 'creator'), false);
  assert.equal(Object.hasOwn(document.metadata, 'style'), false);
  assertMakerV8Document(document);
  assert.deepEqual(document, original);
  for (const field of ['creator', 'style']) {
    for (const value of ['', '🌍'.repeat(32), '界'.repeat(42) + 'ab']) {
      document.metadata[field] = value;
      assertMakerV8Document(document);
      assert.equal(projectPublicMakerV8Document(document).metadata[field], value);
    }
    for (const value of [null, 1, {}, [], 'a'.repeat(129), '界'.repeat(43)]) {
      document.metadata[field] = value;
      assert.throws(() => assertMakerV8Document(document), MakerV8DocumentError);
    }
    delete document.metadata[field];
  }
  for (const [target, key] of [[document.metadata, 'creatorName'], [document.metadata, 'signer'],
    [document.parts[0].payload, 'creator'], [document.parts[0].payload, 'owner']]) {
    target[key] = 'Pretend author';
    assert.throws(() => assertMakerV8Document(document), MakerV8DocumentError);
    delete target[key];
  }
  document.metadata.creator = { creator: 'Nested identity' };
  assert.throws(() => assertMakerV8Document(document), MakerV8DocumentError);
});

test('public projection keeps independent cover bytes and rejects protected artwork as a cover', () => {
  const document = mutableStarter();
  const cover = { id: 'public-cover', kind: 'cover', mediaType: 'image/jpeg', byteLength: 20 };
  document.assets.push(cover, { id: 'unused-art', kind: 'layer', mediaType: 'image/png', byteLength: 30 });
  document.metadata.coverAssetId = cover.id;
  assert.deepEqual(projectPublicMakerV8Document(document).assets, [document.assets[0], cover]);
  assert.equal(document.assets.length, 3);
  document.metadata.coverAssetId = document.parts[0].items[0].styles[0].assetId;
  document.parts[0].items[0].styles[0].protected = true;
  for (const status of ['PUBLIC', 'PRIVATE']) {
    document.parts[0].items[0].status = status;
    assert.equal(collectMakerV8DocumentIssues(document, { mode: 'draft' })
      .some((entry) => entry.code === 'MAKER_V8_COVER_ASSET_PROTECTED'), true);
    assert.throws(() => projectPublicMakerV8Document(document), MakerV8DocumentError);
  }
});

test('unassigned Track is explicit draft-only state, never a missing-reference fallback', () => {
  const document = mutableStarter(), style = document.parts[0].items[0].styles[0];
  style.trackKey = null;
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'draft' }));
  assert.throws(() => assertMakerV8Document(document, { mode: 'compile' }), MakerV8DocumentError);
  assert.throws(() => projectPublicMakerV8Document(document), MakerV8DocumentError);
  for (const value of ['', 'missing-track', undefined]) {
    style.trackKey = value;
    assert.throws(() => assertMakerV8Document(document, { mode: 'draft' }), MakerV8DocumentError);
  }
});

test('all original Creator blend modes survive document validation and public projection', () => {
  for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity', 'linear-dodge']) {
    const document = mutableStarter();
    document.parts[0].items[0].styles[0].blendMode = blendMode;
    assertMakerV8Document(document);
    assert.equal(projectPublicMakerV8Document(document).parts[0].items[0].styles[0].blendMode, blendMode);
  }
  for (const blendMode of ['add', 'lighter', 'linear_dodge', 'constructor', 'unknown', 17]) {
    const document = mutableStarter();
    document.parts[0].items[0].styles[0].blendMode = blendMode;
    assert.throws(() => assertMakerV8Document(document), MakerV8DocumentError);
  }
});

test('empty authoring structures remain drafts, never publishable definitions', () => {
  const document = mutableStarter();
  const part = document.parts[0];
  part.required = true;
  part.items[0].styles = [];
  part.items[0].defaultStyleKey = null;
  document.defaultRecipe.selections = [];
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'draft' }));
  assert.ok(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some(row => row.code === 'MAKER_V8_DEFAULT_STYLE_UNKNOWN'));
  assert.throws(() => projectPublicMakerV8Document(document));
  part.items[0].defaultStyleKey = 'missing';
  assert.throws(() => assertMakerV8Document(document, { mode: 'draft' }));
  part.items = [];
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'draft' }));
  assert.ok(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some(row => row.code === 'MAKER_V8_REQUIRED_PART_MISSING'));
  const selectable = mutableStarter();
  selectable.defaultRecipe.selections = [];
  assert.throws(() => assertMakerV8Document(selectable, { mode: 'draft' }), /Required Part/);
});

function addColor(document) {
  document.colors.push({
    key: 'skin',
    label: 'Skin',
    defaultSwatchKey: 'warm',
    swatches: [
      {
        key: 'warm',
        label: 'Warm',
        rgba: '#f0c0a0ff',
        stops: [{ offset: 0, rgba: '#402010ff' }, { offset: 1, rgba: '#f0c0a0ff' }],
      },
      { key: 'cool', label: 'Cool', rgba: '#b0d0ffff', stops: [] },
    ],
  });
  const style = document.parts[0].items[0].styles[0];
  style.colorChannelKey = 'skin';
  style.defaultSwatchKey = 'warm';
  document.defaultRecipe.colors.push({ channelKey: 'skin', swatchKey: 'warm' });
}

test('factory creates an immutable chain-free fresh-v8 document and nothing older', () => {
  const document = createMakerV8Document({ makerKey: 'alpha', name: 'Alpha' });
  assert.equal(document.schemaVersion, MAKER_V8_DOCUMENT_SCHEMA);
  assert.equal(document.protocolVersion, 8);
  assert.equal(Object.isFrozen(document), true);
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'draft' }), []);
  assert.equal(Object.hasOwn(document, 'capabilities'), false);
  assert.equal(Object.hasOwn(document, 'packs'), false);
  assert.equal(JSON.stringify(document).includes('packageId'), false);

  for (const schemaVersion of ['animacraft.maker.v4', 'animacraft.maker.v5', 'animacraft.maker.v6', 'animacraft.maker.v7']) {
    assert.equal(isMakerV8Document({ ...document, schemaVersion }), false);
  }
});

test('starter compiles with the exact Track-Part-Item-Style vocabulary', () => {
  const document = createCharacterMakerV8Starter({ makerKey: 'starter' });
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  assert.deepEqual(document.composition, {
    mode: MAKER_V8_COMPOSITION_MODES.FIXED,
    thirdPartyAdmission: MAKER_V8_THIRD_PARTY_ADMISSION_MODES.DISABLED,
    itemAssetization: false,
  });
  assert.equal(document.parts[0].kind, MAKER_V8_PART_KINDS.LAST_BASTION);
  assert.equal(document.parts[0].wardrobeMode, MAKER_V8_WARDROBE_MODES.FIXED);
  assert.equal(document.parts[0].items[0].status, 'PUBLIC');
  assert.deepEqual(document.outputs[0].allowedPackPolicy, {
    kind: MAKER_V8_OUTPUT_PACK_POLICIES.ALL_ADMITTED,
    packIds: [],
  });
});

test('Base Item assetization is available only for a composable Maker', () => {
  const fixed = mutableStarter();
  fixed.composition.itemAssetization = true;
  assert.equal(collectMakerV8DocumentIssues(fixed, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_ITEM_ASSETIZATION_REQUIRES_COMPOSABLE'), true);

  fixed.composition.mode = MAKER_V8_COMPOSITION_MODES.COMPOSABLE;
  fixed.parts[0].wardrobeMode = MAKER_V8_WARDROBE_MODES.SLOT;
  assert.equal(collectMakerV8DocumentIssues(fixed, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_ITEM_ASSETIZATION_REQUIRES_COMPOSABLE'), false);
});

test('measured seal cap counts only published Styles while author arrays remain bounded', () => {
  const document = mutableStarter();
  const template = document.parts[0].items[0].styles[0];
  document.parts[0].items.push({
    ...structuredClone(document.parts[0].items[0]),
    key: 'private-library',
    label: 'Private library',
    status: 'PRIVATE',
    defaultStyleKey: 'private-0',
    styles: Array.from({ length: 600 }, (_, index) => ({
      ...structuredClone(template),
      key: `private-${index}`,
      label: `Private ${index}`,
      displayOrder: index,
    })),
  });
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'compile' }));
  assert.equal(projectPublicMakerV8Document(document).parts[0].items.length, 1);

  document.parts[0].items[0].styles = Array.from({ length: 501 }, (_, index) => ({
    ...structuredClone(template), key: `public-${index}`, label: `Public ${index}`, displayOrder: index,
  }));
  document.parts[0].items[0].defaultStyleKey = 'public-0';
  document.defaultRecipe.selections[0].styleKey = 'public-0';
  assert.throws(
    () => assertMakerV8Document(document, { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_STYLE_SEAL_LIMIT'
      && entry.details.observedPublishedStyles === 501
      && entry.details.maximumPublishedStyles === 500),
  );
});

function sealBoundaryDocument(count, { uniqueItems = false, uniqueAssets = false, colors = false } = {}) {
  const document = mutableStarter(), part = document.parts[0], item = part.items[0];
  const style = item.styles[0], asset = document.assets[0];
  const styles = Array.from({ length: count }, (_, index) => ({ ...structuredClone(style),
    key: `style-${index}`, label: `Style ${index}`, displayOrder: index,
    assetId: uniqueAssets ? `asset-${index}` : style.assetId,
    colorChannelKey: colors ? `color-${index}` : null,
    defaultSwatchKey: colors ? 'swatch' : null }));
  part.items = uniqueItems ? styles.map((style, index) => ({ ...structuredClone(item),
    key: `item-${index}`, label: `Item ${index}`, defaultStyleKey: style.key, styles: [style] }))
    : [{ ...item, styles, defaultStyleKey: styles[0].key }];
  document.defaultRecipe.selections[0].itemKey = part.items[0].key;
  document.defaultRecipe.selections[0].styleKey = styles[0].key;
  document.defaultRecipe.colors = [];
  if (uniqueAssets) {
    document.assets = styles.map((style, index) => ({ ...structuredClone(asset), id: style.assetId }));
    document.metadata.coverAssetId = document.assets[0].id;
  }
  document.colors = colors ? styles.map((style, index) => ({ key: style.colorChannelKey,
    label: `Color ${index}`, defaultSwatchKey: 'swatch', swatches: [
      { key: 'swatch', label: 'Swatch', rgba: '#ffffffff', stops: [] } ] })) : [];
  return document;
}
for (const [label, accepted, rejected, options, rejectedUnits] of [
  ['shared Item/Asset colorless', 497, 498, {}, 1001],
  ['distinct color channels', 331, 332, { colors: true }, 1001],
  ['distinct Items and Assets', 199, 200, { uniqueItems: true, uniqueAssets: true }, 1002],
  ['distinct Items with shared Asset', 249, 250, { uniqueItems: true }, 1003],
  ['distinct Assets with shared Item', 332, 333, { uniqueAssets: true }, 1003],
]) test(`schema2 seal budget: ${label}`, () => {
  assert.doesNotThrow(() => assertMakerV8Document(sealBoundaryDocument(accepted, options), { mode: 'compile' }));
  assert.throws(() => assertMakerV8Document(sealBoundaryDocument(rejected, options), { mode: 'compile' }),
    error => error.issues.some(issue => issue.code === 'MAKER_V8_STYLE_SEAL_LIMIT'
      && issue.details.observedUnits === rejectedUnits));
});
test('seal counts every Part index and row even when it has no public Items', () => {
  const document = sealBoundaryDocument(497);
  document.parts.push({ ...structuredClone(document.parts[0]), key: 'empty-part',
    label: 'Empty Part', required: false, items: [] });
  assert.throws(() => assertMakerV8Document(document, { mode: 'compile' }),
    error => error.issues.some(issue => issue.code === 'MAKER_V8_STYLE_SEAL_LIMIT'
      && issue.details.observedParts === 2 && issue.details.observedUnits === 1001));
});

test('seal counts Color channels once, not swatches, and ignores unused assets/channels', () => {
  const document = sealBoundaryDocument(497);
  const styles = document.parts[0].items[0].styles;
  document.colors = [{ key: 'shared', label: 'Shared', defaultSwatchKey: 'swatch-0',
    swatches: styles.map((style, index) => ({ key: `swatch-${index}`, label: `Swatch ${index}`,
      rgba: '#ffffffff', stops: [] })) }];
  styles.forEach((style, index) => { style.colorChannelKey = 'shared'; style.defaultSwatchKey = `swatch-${index}`; });
  document.assets.push(...Array.from({ length: 20 }, (_, index) => ({ ...document.assets[0], id: `unused-${index}` })));
  document.colors.push({ ...structuredClone(document.colors[0]), key: 'unused-color' });
  assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'compile' }));
});

test('document limits count every published Color row and every author asset', () => {
  const colorDocument = mutableStarter();
  colorDocument.colors = [{
    key: 'bounded-colors',
    label: 'Bounded colors',
    defaultSwatchKey: 'swatch-0000',
    swatches: Array.from({ length: MAKER_V8_DOCUMENT_LIMITS.colors }, (_, index) => ({
      key: `swatch-${String(index).padStart(4, '0')}`,
      label: `Swatch ${index}`,
      rgba: '#010203ff',
      stops: [],
    })),
  }];
  assert.doesNotThrow(() => assertMakerV8Document(colorDocument, { mode: 'compile' }));
  colorDocument.colors[0].swatches.push({
    key: 'swatch-over-limit', label: 'Over limit', rgba: '#010203ff', stops: [],
  });
  assert.throws(
    () => assertMakerV8Document(colorDocument, { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_COLOR_LIMIT'
      && entry.details.observedColorRows === MAKER_V8_DOCUMENT_LIMITS.colors + 1
      && entry.details.maximumColorRows === MAKER_V8_DOCUMENT_LIMITS.colors),
  );

  const assetDocument = mutableStarter();
  const template = assetDocument.assets[0];
  assetDocument.assets = [
    template,
    ...Array.from({ length: MAKER_V8_DOCUMENT_LIMITS.assets - 1 }, (_, index) => ({
      ...template,
      id: `bounded-asset-${String(index).padStart(4, '0')}`,
    })),
  ];
  assert.doesNotThrow(() => assertMakerV8Document(assetDocument, { mode: 'compile' }));
  assetDocument.assets.push({ ...template, id: 'bounded-asset-over-limit' });
  assert.throws(
    () => assertMakerV8Document(assetDocument, { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_ASSET_LIMIT'
      && entry.details.observedAssets === MAKER_V8_DOCUMENT_LIMITS.assets + 1
      && entry.details.maximumAssets === MAKER_V8_DOCUMENT_LIMITS.assets),
  );
});

test('every schema boundary is exact and arbitrary payload cannot smuggle authority', () => {
  const forbidden = [
    ['rootId', '0xdead'],
    ['catalogId', '0xdead'],
    ['paymentCommitment', '11'.repeat(32)],
    ['assetSha256', '22'.repeat(32)],
    ['ciphertextBlobId', 'blob'],
    ['receivingRef', { objectId: 'x' }],
    ['transactionDigest', 'digest'],
  ];
  for (const [key, value] of forbidden) {
    const document = mutableStarter();
    document.parts[0].payload[key] = value;
    const issues = collectMakerV8DocumentIssues(document, { mode: 'compile' });
    assert.equal(issues.some((entry) => entry.code === 'MAKER_V8_COMPILER_FIELD_FORBIDDEN'), true, key);
  }

  const document = mutableStarter();
  document.parts[0].invented = true;
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_FIELD_UNKNOWN'), true);
});

test('non-JSON graphs, accessors, sparse arrays, symbols, bigint, and non-finite numbers fail closed', () => {
  const cases = [];
  const cycle = mutableStarter();
  cycle.parts[0].payload.self = cycle.parts[0].payload;
  cases.push(cycle);
  const accessor = mutableStarter();
  Object.defineProperty(accessor.metadata, 'name', { enumerable: true, get: () => 'trap' });
  cases.push(accessor);
  const sparse = mutableStarter();
  sparse.outputs = new Array(2);
  cases.push(sparse);
  const symbol = mutableStarter();
  symbol.metadata[Symbol('hidden')] = true;
  cases.push(symbol);
  const bigint = mutableStarter();
  bigint.parts[0].payload.amount = 1n;
  cases.push(bigint);
  const infinite = mutableStarter();
  infinite.canvas.width = Infinity;
  cases.push(infinite);
  cases.forEach((value) => assert.notDeepEqual(collectMakerV8DocumentIssues(value), []));
});

test('public projection removes private Items and revalidates all references', () => {
  const document = mutableStarter();
  const privateItem = structuredClone(document.parts[0].items[0]);
  privateItem.key = 'next-version';
  privateItem.status = 'PRIVATE';
  privateItem.styles[0].key = 'next-style';
  privateItem.defaultStyleKey = 'next-style';
  document.parts[0].items.push(privateItem);
  const projected = projectPublicMakerV8Document(document);
  assert.deepEqual(projected.parts[0].items.map((entry) => entry.key), ['default']);
  assert.equal(Object.isFrozen(projected), true);

  document.defaultRecipe.selections[0] = {
    partKey: 'base', itemKey: 'next-version', styleKey: 'next-style',
  };
  assert.throws(
    () => projectPublicMakerV8Document(document),
    (error) => error instanceof MakerV8DocumentError
      && error.issues.some((entry) => entry.code === 'MAKER_V8_RECIPE_TARGET_UNKNOWN'),
  );
});

test('optional published slots can be empty without exposing private author Items', () => {
  const document = mutableStarter();
  document.parts[0].kind = 'STANDARD';
  document.parts[0].required = false;
  document.parts[0].items[0].status = 'PRIVATE';
  document.defaultRecipe.selections = [];
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  const projected = projectPublicMakerV8Document(document);
  assert.equal(projected.parts[0].items.length, 0);
  assert.equal(projected.parts[0].key, document.parts[0].key);
  assert.equal(projected.assets.length, 0);
  document.parts[0].items = [];
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.parts[0].required = true;
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_PUBLIC_PART_EMPTY'), true);
  document.parts[0].required = false;
  document.defaultRecipe.selections = [{ partKey: document.parts[0].key, itemKey: 'missing', styleKey: 'missing' }];
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_RECIPE_TARGET_UNKNOWN'), true);
});

test('Color/Swatch references are exact in Styles and the default Recipe', () => {
  const document = mutableStarter();
  addColor(document);
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);

  document.parts[0].items[0].styles[0].defaultSwatchKey = 'missing';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_SWATCH_UNKNOWN'), true);
  document.parts[0].items[0].styles[0].defaultSwatchKey = 'warm';
  document.defaultRecipe.colors[0].swatchKey = 'missing';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_RECIPE_COLOR_UNKNOWN'), true);
});

test('Composition, Pack allowlist, and rule semantics reject downgrade-shaped inputs', () => {
  const document = mutableStarter();
  document.composition.mode = MAKER_V8_COMPOSITION_MODES.COMPOSABLE;
  document.composition.thirdPartyAdmission = MAKER_V8_THIRD_PARTY_ADMISSION_MODES.CERTIFIED;
  document.parts[0].wardrobeMode = MAKER_V8_WARDROBE_MODES.SLOT;
  document.outputs[0].allowedPackPolicy = {
    kind: MAKER_V8_OUTPUT_PACK_POLICIES.ALLOWLIST,
    packIds: ['alpha-pack', 'zeta-pack'],
  };
  document.rules.push({
    key: 'requires-base',
    kind: 'REQUIRE',
    trigger: { source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null },
    targetMode: 'ALL',
    targets: [{ source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null }],
    payload: {},
  });
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.outputs[0].allowedPackPolicy.packIds.reverse();
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_PACK_ALLOWLIST_INVALID'), true);
});

test('LAST_BASTION cannot be downgraded into an optional Part', () => {
  const document = mutableStarter();
  document.parts[0].required = false;
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_LAST_BASTION_REQUIRED'), true);
});

test('default Recipe may fill a Part up to its exact multi-slot capacity', () => {
  const document = mutableStarter();
  document.parts[0].capacity = 2;
  document.defaultRecipe.selections.push(structuredClone(document.defaultRecipe.selections[0]));
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.defaultRecipe.selections.push(structuredClone(document.defaultRecipe.selections[0]));
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_RECIPE_PART_CAPACITY_EXCEEDED'), true);
});

test('Physical policy uses exact issuance/proof/price/supply semantics', () => {
  const document = mutableStarter();
  const style = document.parts[0].items[0].styles[0];
  style.physical = {
    material: 'archival cotton',
    issuance: MAKER_V8_PHYSICAL_ISSUANCE.PAID_PURCHASE,
    proof: MAKER_V8_PHYSICAL_PROOFS.NONE,
    priceAtomic: '1200000',
    maxSupply: '100',
    transferable: true,
  };
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  style.physical.issuance = MAKER_V8_PHYSICAL_ISSUANCE.PROOF_MATERIALIZE;
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_PHYSICAL_PROOF_INVALID'), true);
});

test('Style transforms stay inside deterministic renderer bounds', () => {
  const document = mutableStarter();
  const style = document.parts[0].items[0].styles[0];
  style.transform = { x: -8192, y: 8192, scale: 100, rotation: -360 };
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  for (const [field, value] of [['x', 8193], ['y', -8193], ['scale', 0], ['scale', 101], ['rotation', 361]]) {
    const candidate = structuredClone(document);
    candidate.parts[0].items[0].styles[0].transform[field] = value;
    assert.equal(collectMakerV8DocumentIssues(candidate, { mode: 'compile' })
      .some((entry) => entry.code === 'MAKER_V8_STYLE_TRANSFORM_INVALID'), true, `${field}=${value}`);
  }
});

test('license-wrapped rights require one semantic evidence asset, never a Blob or hash', () => {
  const document = mutableStarter();
  document.commerce.rightsOrigin = MAKER_V8_RIGHTS_ORIGINS.LICENSE_WRAPPED;
  document.commerce.rightsEvidence = {
    licensor: 'Example Licensor', evidenceAssetId: 'rights-evidence',
  };
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_RIGHTS_ASSET_UNKNOWN'), true);
  document.assets.push({
    id: 'rights-evidence', kind: 'rights-evidence', mediaType: 'application/pdf', byteLength: 5,
  });
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.commerce.rightsEvidence.evidenceBlobId = 'forbidden';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_COMPILER_FIELD_FORBIDDEN'), true);
});

test('atomic values are canonical u64 strings and bounded at both ends', () => {
  const document = mutableStarter();
  document.assets[0].byteLength = '18446744073709551615';
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  document.assets[0].byteLength = '18446744073709551616';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_U64_INVALID'), true);
  document.assets[0].byteLength = '01';
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_U64_INVALID'), true);
});

test('assertion reports layered immutable issues and never mutates author input', () => {
  const document = mutableStarter();
  document.lineage.makerKey = `0x${'11'.repeat(32)}`;
  const before = structuredClone(document);
  assert.throws(
    () => assertMakerV8Document(document, { mode: 'compile' }),
    (error) => error instanceof MakerV8DocumentError
      && error.code === 'MAKER_V8_KEY_INVALID'
      && Object.isFrozen(error.issues),
  );
  assert.deepEqual(document, before);
});
