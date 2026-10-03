import assert from 'node:assert/strict';
import test from 'node:test';
import { createMakerV8Document, createCharacterMakerV8Starter, assertMakerV8Document, projectPublicMakerV8Document } from '../maker-v8-document.js';
import { createMakerV8Workspace, exportMakerV8Project } from '../maker-v8-workspace.js';
import { createCreatorCharacterStarter, prepareCreatorStructure } from '../maker-v8-creator-structure.js';
import { creatorStyleEditorState } from '../maker-v8-creator-style.js';
import { indexedDB } from 'fake-indexeddb';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';

function visibilityFixture() {
  const document = createCreatorCharacterStarter();
  const subject = document.parts.find(part => part.key === 'eyes').items[0].styles[0];
  subject.visibleWhen = { op: 'any', conditions: [
    { op: 'not', condition: { op: 'selected', source: 'BASE', sourceKey: null, partKey: 'background', itemKey: 'background-default', styleKey: 'default-style' } },
    { op: 'selected', source: 'PACK', sourceKey: 'pack-one', partKey: 'background', itemKey: 'background-default', styleKey: 'default-style' },
    { op: 'selected', source: 'ANY', sourceKey: null, partKey: 'outfit', itemKey: null, styleKey: null },
  ] };
  return { document, subject };
}

test('export background markers copy with their Part and disappear with deletion without extra references', () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  document.parts[0].exportBackground = true;
  const copied = prepareCreatorStructure({ document, action: 'copy-part', partKey: 'base' }).document;
  const duplicate = copied.parts.find(part => part.key !== 'base');
  assert.equal(duplicate.exportBackground, true);
  const removed = prepareCreatorStructure({ document: copied, action: 'delete-part', partKey: duplicate.key }).document;
  assert.deepEqual(removed.parts, document.parts);
  assert.deepEqual(removed.defaultRecipe, document.defaultRecipe);
  assert.equal(removed.parts.some(part => part.key === duplicate.key), false);
  assertMakerV8Document(removed, { mode: 'draft' });
  for (const invalid of [null, 0, 'true', [], {}]) {
    const bad = structuredClone(document); bad.parts[0].exportBackground = invalid;
    assert.throws(() => assertMakerV8Document(bad, { mode: 'draft' }));
  }
  assert.equal(projectPublicMakerV8Document(document).parts[0].exportBackground, true);
});

test('visibility copies retain authored external references without mutating originals', () => {
  const { document, subject } = visibilityFixture();
  const before = structuredClone(document);
  for (const action of ['copy-part', 'copy-item', 'copy-style']) {
    const result = prepareCreatorStructure({ document, action, partKey: 'eyes', itemKey: 'eyes-default', styleKey: 'default-style' });
    const selected = result.document.parts.find(part => part.key === result.selection.partKey)
      .items.find(item => item.key === result.selection.itemKey).styles.find(style => style.key === result.selection.styleKey);
    assert.deepEqual(selected.visibleWhen, subject.visibleWhen);
    assert.notEqual(selected.visibleWhen, subject.visibleWhen);
    assert.deepEqual(document, before);
    assert.doesNotThrow(() => assertMakerV8Document(result.document, { mode: 'draft' }));
  }
});

test('deleting definitions prunes exact visibility leaves and keeps foreign source identities', () => {
  const { document } = visibilityFixture();
  const before = structuredClone(document);
  const result = prepareCreatorStructure({ document, action: 'delete-style', partKey: 'background', itemKey: 'background-default', styleKey: 'default-style' }).document;
  const condition = result.parts.find(part => part.key === 'eyes').items[0].styles[0].visibleWhen;
  assert.equal(condition.conditions.length, 2);
  assert.equal(condition.conditions[0].source, 'PACK');
  assert.equal(condition.conditions[1].partKey, 'outfit');
  assert.deepEqual(document, before);
  const withoutPart = prepareCreatorStructure({ document, action: 'delete-part', partKey: 'background' }).document;
  assert.equal(withoutPart.parts.find(part => part.key === 'eyes').items[0].styles[0].visibleWhen.conditions.length, 1);
  const empty = prepareCreatorStructure({ document: withoutPart, action: 'delete-part', partKey: 'outfit' }).document;
  assert.equal(empty.parts.find(part => part.key === 'eyes').items[0].styles[0].visibleWhen, null);
  assert.doesNotThrow(() => assertMakerV8Document(empty, { mode: 'draft' }));
});

test('visibility reference repair cannot silently edit a locked surviving Style', () => {
  for (const stored of [false, true]) {
    const { document, subject } = visibilityFixture();
    if (stored) subject.payload.animacraftEditor.styleLocked = true;
    const before = structuredClone(document);
    assert.throws(() => prepareCreatorStructure({ document, action: 'delete-item', partKey: 'background', itemKey: 'background-default',
      styleLockedKeys: stored ? [] : ['eyes/eyes-default/default-style'] }), error => error.code === 'MAKER_V8_CREATOR_STYLE_LOCKED');
    assert.deepEqual(document, before);
  }
});

test('copying a Part retains explicitly unassigned Styles and original assets', () => {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'copy-null', name: 'Copy null' }));
  document.parts[0].items[0].styles[0].trackKey = null;
  const result = prepareCreatorStructure({ document, action: 'copy-part', partKey: 'base' }).document;
  assert.equal(result.parts[1].items[0].styles[0].trackKey, null);
  assert.deepEqual(result.assets, document.assets);
  assert.deepEqual(result.tracks, document.tracks);
  assert.doesNotThrow(() => assertMakerV8Document(result, { mode: 'draft' }));
});

test('New Maker authoring starter preserves the original eight-Part skeleton without fabricated artwork', () => {
  const definitions = [
    ['background', 'Background', false], ['back-hair', 'Back Hair', false],
    ['skin-base', 'Skin & Base', true], ['outfit', 'Outfit', false],
    ['eyes', 'Eyes', true], ['mouth', 'Mouth', false],
    ['front-hair', 'Front Hair', false], ['accessory', 'Accessory', false],
  ];
  for (const [width, height] of [[1024, 1024], [1080, 1920]]) {
    const options = { makerKey: 'author-character', name: 'Author character', width, height };
    const document = createCreatorCharacterStarter(options);
    const blank = createMakerV8Document(options);
    for (const key of ['metadata', 'canvas', 'composition', 'colors', 'rules', 'outputs', 'commerce', 'assets', 'livingContent', 'lineage']) {
      assert.deepEqual(document[key], blank[key], key);
    }
    assert.equal(document.parts.length, 8);
    assert.equal(document.tracks.length, 8);
    assert.equal(document.defaultRecipe.selections.length, 8);
    definitions.forEach(([key, label, required], order) => {
      const part = document.parts[order];
      const item = part.items[0];
      const style = item.styles[0];
      assert.deepEqual({ ...part, items: [] }, {
        key, label, required, visible: true, kind: required ? 'LAST_BASTION' : 'STANDARD',
        renderOrder: order, menuOrder: order, wardrobeMode: 'FIXED', capacity: 1, payload: {}, items: [],
      });
      assert.deepEqual(document.tracks[order], { key: `${key}-track`, label, renderOrder: order, locked: false });
      assert.equal(part.items.length, 1);
      assert.equal(item.styles.length, 1);
      assert.equal(item.key, `${key}-default`);
      assert.equal(item.label, 'Default');
      assert.equal(item.status, 'PUBLIC');
      assert.equal(item.defaultStyleKey, 'default-style');
      assert.equal(style.key, 'default-style');
      assert.equal(style.label, 'Default Style');
      assert.equal(style.trackKey, `${key}-track`);
      assert.equal(style.assetId, null);
      assert.equal(style.opacity, 1);
      assert.equal(style.blendMode, 'normal');
      assert.deepEqual(style.transform, { x: 0, y: 0, scale: 1, rotation: 0 });
      assert.deepEqual(creatorStyleEditorState(style), { positionConfirmed: false, positionLocked: false, styleLocked: false });
      assert.deepEqual(document.defaultRecipe.selections[order], { partKey: key, itemKey: item.key, styleKey: style.key });
    });
    assert.doesNotThrow(() => assertMakerV8Document(document, { mode: 'draft' }));
    assert.throws(() => assertMakerV8Document(document, { mode: 'compile' }));
    assert.throws(() => projectPublicMakerV8Document(document));
    const edited = prepareCreatorStructure({ document, action: 'add-item', partKey: 'eyes' }).document;
    assert.equal(edited.parts[4].items.length, 2);
    assert.deepEqual(edited.defaultRecipe, document.defaultRecipe);
    assert.equal(document.parts[4].items.length, 1, 'independent snapshots');
  }
});

for (const starter of [createMakerV8Document, createCharacterMakerV8Starter]) {
  test(`${starter.name}: new Part has independent Track and empty Default Item/Style`, async () => {
    const document = starter({ makerKey: 'structure-test', name: 'Structure Test' });
    const before = structuredClone(document);
    const result = prepareCreatorStructure({ document, action: 'add-part' });
    const part = result.document.parts.at(-1);
    const item = part.items[0];
    const style = item.styles[0];
    assert.deepEqual(result.selection, { partKey: part.key, itemKey: item.key, styleKey: style.key });
    assert.equal(part.required, false);
    assert.equal(part.kind, 'STANDARD');
    assert.equal(item.label, 'Default');
    assert.equal(item.status, 'PUBLIC');
    assert.equal(item.defaultStyleKey, style.key);
    assert.equal(style.label, 'Default Style');
    assert.equal(style.assetId, null);
    assert.equal(result.document.tracks.at(-1).key, style.trackKey);
    assert.equal(result.document.tracks.at(-1).locked, false);
    assert.equal(result.document.tracks.length, before.tracks.length + 1);
    assert.ok(!before.tracks.some((row) => row.key === style.trackKey));
    assert.deepEqual(result.document.assets, before.assets);
    assert.deepEqual(result.document.parts.slice(0, -1), before.parts);
    assert.deepEqual(result.document.defaultRecipe.selections.slice(0, -1), before.defaultRecipe.selections);
    assert.deepEqual(document, before);
    assert.doesNotThrow(() => assertMakerV8Document(result.document, { mode: 'draft' }));
    assert.equal(createMakerV8Workspace({ document: result.document }).getState().issues.length, 0);
    assert.deepEqual((await exportMakerV8Project(result.document)).document, result.document);
    assert.throws(() => assertMakerV8Document(result.document, { mode: 'compile' }));
    assert.throws(() => projectPublicMakerV8Document(result.document));
  });
}

test('repeated additions append safe unique keys and orders without changing configuration or defaults', () => {
  let document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'repeat' }));
  document.tracks[0].renderOrder = 14;
  document.parts[0].renderOrder = 22;
  document.parts[0].menuOrder = 17;
  document.parts[0].items[0].displayOrder = 30;
  document.parts[0].items[0].styles[0].displayOrder = 19;
  const before = structuredClone(document);
  for (let i = 0; i < 4; i += 1) {
    document = prepareCreatorStructure({ document, action: 'add-part' }).document;
    document = prepareCreatorStructure({ document, action: 'add-item', partKey: 'base' }).document;
    document = prepareCreatorStructure({ document, action: 'add-style', partKey: 'base', itemKey: 'default' }).document;
  }
  const allCollections = [document.parts, document.tracks, document.parts[0].items, document.parts[0].items[0].styles];
  for (const rows of allCollections) {
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
    assert.ok(rows.every((row) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.key)));
  }
  assert.equal(document.parts[1].renderOrder, 23);
  assert.equal(document.parts[1].menuOrder, 18);
  assert.equal(document.tracks[1].renderOrder, 15);
  assert.equal(document.parts[0].items[1].displayOrder, 31);
  assert.equal(document.parts[0].items[0].styles[1].displayOrder, 20);
  assert.equal(document.parts[0].items[0].defaultStyleKey, 'default');
  assert.deepEqual(document.defaultRecipe.selections[0], before.defaultRecipe.selections[0]);
  for (const key of ['metadata', 'canvas', 'composition', 'colors', 'rules', 'outputs', 'commerce', 'assets', 'livingContent']) {
    assert.deepEqual(document[key], before[key]);
  }
});

test('Item inherits Part default Item track; Style inherits its own default Style track', () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  document.tracks.push({ key: 'other-track', label: 'Other', locked: false, renderOrder: 1 });
  const other = structuredClone(document.parts[0].items[0]);
  other.key = 'other';
  other.styles[0].trackKey = 'other-track';
  document.parts[0].items.push(other);
  document.defaultRecipe.selections[0].itemKey = 'other';
  let result = prepareCreatorStructure({ document, action: 'add-item', partKey: 'base' });
  assert.equal(result.document.parts[0].items.at(-1).styles[0].trackKey, 'other-track');
  assert.deepEqual(result.document.defaultRecipe, document.defaultRecipe);
  result = prepareCreatorStructure({ document, action: 'add-style', partKey: 'base', itemKey: 'default' });
  assert.equal(result.document.parts[0].items[0].styles.at(-1).trackKey, 'base-track');
  assert.equal(result.document.tracks.length, 2);
});

test('unselected Part inherits first Item track without selecting a new default', () => {
  const document = prepareCreatorStructure({ document: createMakerV8Document(), action: 'add-part' }).document;
  document.defaultRecipe.selections = [];
  const result = prepareCreatorStructure({ document, action: 'add-item', partKey: document.parts[0].key });
  assert.equal(result.document.parts[0].items.at(-1).styles[0].trackKey, document.tracks[0].key);
  assert.deepEqual(result.document.defaultRecipe.selections, []);
});

test('empty Part creates a new track and initial default, including long key collisions', () => {
  const document = prepareCreatorStructure({ document: createMakerV8Document(), action: 'add-part' }).document;
  const part = document.parts[0];
  part.key = 'p'.repeat(128);
  part.items = [];
  document.defaultRecipe.selections = [];
  document.tracks[0].key = part.key;
  const result = prepareCreatorStructure({ document, action: 'add-item', partKey: part.key });
  assert.equal(result.document.tracks.length, 2);
  assert.equal(result.document.tracks[1].key.length, 128);
  assert.notEqual(result.document.tracks[1].key, part.key);
  assert.deepEqual(result.document.defaultRecipe.selections, [result.selection]);
});

test('missing selections, invalid actions, invalid documents and order overflow leave input untouched', () => {
  const document = structuredClone(createCharacterMakerV8Starter());
  const before = structuredClone(document);
  for (const input of [{ action: 'add-item' }, { action: 'add-style', partKey: 'missing' },
    { action: 'add-style', partKey: 'base', itemKey: 'missing' }, { action: 'remove-part' }]) {
    assert.throws(() => prepareCreatorStructure({ document, ...input }));
  }
  assert.deepEqual(document, before);
  document.tracks[0].renderOrder = Number.MAX_SAFE_INTEGER;
  assert.throws(() => prepareCreatorStructure({ document, action: 'add-part' }), { code: 'MAKER_V8_CREATOR_ORDER_INVALID' });
  document.parts[0].items[0].styles[0].assetId = 'missing';
  assert.throws(() => prepareCreatorStructure({ document, action: 'add-part' }));
});

test('only exact null is accepted as an unfinished PNG; nonnull bad IDs still fail draft validation', () => {
  const document = prepareCreatorStructure({ document: createMakerV8Document(), action: 'add-part' }).document;
  for (const assetId of ['', 'missing', false, 0, {}, undefined]) {
    const next = structuredClone(document);
    next.parts[0].items[0].styles[0].assetId = assetId;
    assert.throws(() => assertMakerV8Document(next, { mode: 'draft' }));
  }
});

test('unfinished Style persists, reopens and exports without generating or borrowing an asset', async () => {
  const databaseName = `creator-structure-${crypto.randomUUID()}`;
  const document = prepareCreatorStructure({ document: createMakerV8Document(), action: 'add-part' }).document;
  const persistence = createMakerV8DraftPersistence(indexedDB, { databaseName });
  await persistence.createBundle({ draftId: 'unfinished', document, assets: [], createdAt: 100 });
  persistence.close();
  const reopened = createMakerV8DraftPersistence(indexedDB, { databaseName });
  try {
    assert.deepEqual((await reopened.load('unfinished')).document, document);
    const bundle = await reopened.export('unfinished');
    assert.deepEqual(bundle.assets, []);
    assert.deepEqual(bundle.draft.document, document);
    assert.throws(() => projectPublicMakerV8Document(bundle.draft.document));
  } finally { reopened.close(); }
});

const selector = (partKey, itemKey = null, styleKey = null, source = 'BASE', sourceKey = null) => ({ source, sourceKey, partKey, itemKey, styleKey });
const rule = (key, trigger, targets) => ({ key, kind: 'REQUIRE', trigger, targetMode: 'ALL', targets, payload: {} });

function richDocument() {
  let document = structuredClone(createCharacterMakerV8Starter());
  document = prepareCreatorStructure({ document, action: 'add-part' }).document;
  document = prepareCreatorStructure({ document, action: 'add-style', partKey: 'base', itemKey: 'default' }).document;
  document.parts[0].items[0].styles[1].assetId = 'base-default';
  document.rules.push(
    rule('owned', selector('base', 'default'), [selector('base', 'default', 'style-2'), selector('part-2')]),
    rule('style-owned', selector('base', 'default', 'default'), [selector('part-2')]),
    rule('incoming', selector('part-2'), [selector('base', 'default')]),
    rule('foreign', selector('base', 'pack-item', 'pack-style', 'PACK', 'pack-one'), [selector('part-2')]),
  );
  assertMakerV8Document(document, { mode: 'draft' });
  return document;
}

test('copy Part rekeys nested definitions, shared tracks, defaults and owned rules without touching external owners', () => {
  const document = richDocument();
  const before = structuredClone(document);
  const result = prepareCreatorStructure({ document, action: 'copy-part', partKey: 'base' });
  const copy = result.document.parts.at(-1);
  assert.equal(copy.key, 'base-copy');
  assert.equal(copy.items[0].key, 'default-copy');
  assert.equal(copy.items[0].defaultStyleKey, 'default-copy');
  assert.deepEqual(copy.items[0].styles.map((s) => s.key), ['default-copy', 'style-2-copy']);
  assert.deepEqual(copy.items[0].styles.map((s) => s.trackKey), ['base-track-copy', 'base-track-copy']);
  assert.equal(result.document.tracks.at(-1).locked, true);
  assert.deepEqual(result.document.assets, before.assets);
  assert.ok(copy.items[0].styles.every((s) => s.assetId === 'base-default'));
  assert.deepEqual(result.document.defaultRecipe.selections.at(-1), result.selection);
  const copiedRule = result.document.rules.find((r) => r.key === 'owned-copy');
  assert.deepEqual(copiedRule.trigger, selector('base-copy', 'default-copy'));
  assert.deepEqual(copiedRule.targets, [selector('base-copy', 'default-copy', 'style-2-copy'), selector('part-2')]);
  assert.deepEqual(result.document.rules.find((r) => r.key === 'foreign-copy').trigger,
    selector('base-copy', 'pack-item', 'pack-style', 'PACK', 'pack-one'));
  assert.ok(!result.document.rules.some((r) => r.key === 'incoming-copy'));
  assert.deepEqual(result.document.rules.slice(0, before.rules.length), before.rules);
  copy.items[0].styles[0].transform.x = 99;
  assert.deepEqual(document, before);
});

test('copy Item/Style rekeys self references, preserves authored defaults, tracks, and unrelated source scopes', () => {
  const document = richDocument();
  const copiedItem = prepareCreatorStructure({ document, action: 'copy-item', partKey: 'base', itemKey: 'default' });
  const item = copiedItem.document.parts[0].items.at(-1);
  assert.equal(item.key, 'default-copy');
  assert.equal(item.defaultStyleKey, 'default-copy');
  assert.deepEqual(copiedItem.document.rules.find((r) => r.key === 'owned-copy').targets,
    [selector('base', 'default-copy', 'style-2-copy'), selector('part-2')]);
  assert.ok(!copiedItem.document.rules.some((r) => r.key === 'foreign-copy'));
  const copiedStyle = prepareCreatorStructure({ document, action: 'copy-style', partKey: 'base', itemKey: 'default', styleKey: 'default' });
  assert.deepEqual(copiedStyle.selection, { partKey: 'base', itemKey: 'default', styleKey: 'default-copy' });
  assert.equal(copiedStyle.document.parts[0].items[0].defaultStyleKey, 'default');
  assert.equal(copiedStyle.document.rules.length, document.rules.length + 1);
  assert.deepEqual(copiedStyle.document.rules.at(-1).trigger, selector('base', 'default', 'default-copy'));
  for (const result of [copiedItem, copiedStyle]) {
    assert.deepEqual(result.document.tracks, document.tracks);
    assert.deepEqual(result.document.defaultRecipe, document.defaultRecipe);
    assert.deepEqual(result.document.assets, document.assets);
  }
});

test('repeated copies with maximum-length keys and labels remain unique and valid', () => {
  let document = structuredClone(createCharacterMakerV8Starter());
  const item = document.parts[0].items[0];
  item.styles[0].key = 's'.repeat(128);
  item.styles[0].label = 'L'.repeat(256);
  item.defaultStyleKey = item.styles[0].key;
  document.defaultRecipe.selections[0].styleKey = item.defaultStyleKey;
  for (let index = 0; index < 3; index += 1) {
    document = prepareCreatorStructure({ document, action: 'copy-style', partKey: 'base', itemKey: 'default', styleKey: item.defaultStyleKey }).document;
  }
  const styles = document.parts[0].items[0].styles;
  assert.equal(new Set(styles.map((s) => s.key)).size, 4);
  assert.ok(styles.every((s) => s.key.length <= 128 && s.label.length <= 256));
});

test('deletion rejects all locked descendants but a locked track does not lock a Style', () => {
  const document = richDocument();
  const before = structuredClone(document);
  for (const action of ['delete-part', 'delete-item', 'delete-style']) {
    assert.throws(() => prepareCreatorStructure({ document, action, partKey: 'base', itemKey: 'default', styleKey: 'style-2',
      styleLockedKeys: ['base/default/style-2'] }), { code: 'MAKER_V8_CREATOR_STYLE_LOCKED' });
  }
  assert.deepEqual(document, before);
  assert.doesNotThrow(() => prepareCreatorStructure({ document, action: 'delete-style', partKey: 'base', itemKey: 'default', styleKey: 'style-2' }));
});

test('deleting a Style repairs its default, prunes rules and preserves current unrelated selection', () => {
  const document = richDocument();
  document.rules.push(rule('only-deleted-target', selector('part-2'), [selector('base', 'default', 'default')]));
  const selection = { partKey: 'part-2', itemKey: 'default', styleKey: 'default-style' };
  const result = prepareCreatorStructure({ document, action: 'delete-style', partKey: 'base', itemKey: 'default', styleKey: 'default', selection });
  assert.deepEqual(result.selection, selection);
  assert.equal(result.document.parts[0].items[0].defaultStyleKey, 'style-2');
  assert.deepEqual(result.document.defaultRecipe.selections[0], { partKey: 'base', itemKey: 'default', styleKey: 'style-2' });
  assert.deepEqual(result.document.rules.map((r) => r.key), ['owned', 'incoming', 'foreign']);
  assert.deepEqual(result.document.assets, document.assets);
});

test('delete Item selects valid required fallback without changing another capacity slot', () => {
  let document = richDocument();
  document = prepareCreatorStructure({ document, action: 'copy-item', partKey: 'base', itemKey: 'default' }).document;
  document.parts[0].capacity = 2;
  document.defaultRecipe.selections.push({ partKey: 'base', itemKey: 'default-copy', styleKey: 'style-2-copy' });
  const result = prepareCreatorStructure({ document, action: 'delete-item', partKey: 'base', itemKey: 'default' });
  assert.deepEqual(result.document.defaultRecipe.selections.filter((r) => r.partKey === 'base'),
    [{ partKey: 'base', itemKey: 'default-copy', styleKey: 'style-2-copy' }]);
  assert.deepEqual(result.selection, { partKey: 'base', itemKey: 'default-copy', styleKey: 'default-copy' });
  assert.ok(result.document.rules.some((r) => r.key === 'foreign'));
  assert.ok(!result.document.rules.some((r) => r.key === 'owned' || r.key === 'incoming'));
});

test('deletion prunes unused unlocked affected tracks and assets while preserving shared/cover/rights/payload references', () => {
  let document = richDocument();
  document.tracks[0].locked = false;
  const source = document.parts[0].items[0].styles;
  source[1].trackKey = 'part-2-track';
  for (const id of ['cover', 'evidence', 'payload-ref', 'unreferenced']) document.assets.push({ id, kind: 'layer', mediaType: 'image/png', byteLength: 1 });
  document.metadata.coverAssetId = 'cover';
  document.commerce.rightsOrigin = 'LICENSE_WRAPPED';
  document.commerce.rightsEvidence = { licensor: 'Artist', evidenceAssetId: 'evidence' };
  document.parts[1].payload = { nested: { refs: ['payload-ref'] } };
  document.tracks.push({ key: 'unrelated-empty', label: 'Unrelated', renderOrder: 8, locked: false });
  const before = structuredClone(document);
  const result = prepareCreatorStructure({ document, action: 'delete-part', partKey: 'base' });
  assert.deepEqual(result.document.tracks.map((r) => r.key), ['part-2-track', 'unrelated-empty']);
  assert.deepEqual(result.document.assets.map((r) => r.id), ['cover', 'evidence', 'payload-ref']);
  assert.deepEqual(result.document.rules, []);
  assert.deepEqual(document, before);
  document.tracks[0].locked = true;
  assert.ok(prepareCreatorStructure({ document, action: 'delete-part', partKey: 'base' }).document.tracks.some((r) => r.key === 'base-track'));
});

test('last Style and Item may be removed as empty drafts; adding again restores defaults and compile stays closed', () => {
  const document = createCharacterMakerV8Starter();
  const styleResult = prepareCreatorStructure({ document, action: 'delete-style', partKey: 'base', itemKey: 'default', styleKey: 'default' });
  assert.deepEqual(styleResult.document.parts[0].items[0].styles, []);
  assert.equal(styleResult.document.parts[0].items[0].defaultStyleKey, null);
  assert.deepEqual(styleResult.document.defaultRecipe.selections, []);
  assert.deepEqual(styleResult.selection, { partKey: 'base', itemKey: 'default', styleKey: '' });
  const itemResult = prepareCreatorStructure({ document, action: 'delete-item', partKey: 'base', itemKey: 'default' });
  assert.deepEqual(itemResult.document.parts[0].items, []);
  assert.deepEqual(itemResult.selection, { partKey: 'base', itemKey: '', styleKey: '' });
  for (const result of [styleResult, itemResult]) {
    assert.doesNotThrow(() => assertMakerV8Document(result.document, { mode: 'draft' }));
    assert.throws(() => assertMakerV8Document(result.document, { mode: 'compile' }));
  }
  const restoredStyle = prepareCreatorStructure({ document: styleResult.document, action: 'add-style', partKey: 'base', itemKey: 'default' });
  assert.deepEqual(restoredStyle.document.defaultRecipe.selections, [restoredStyle.selection]);
  const alternativeItem = prepareCreatorStructure({ document: styleResult.document, action: 'add-item', partKey: 'base' });
  assert.deepEqual(alternativeItem.document.defaultRecipe.selections, [alternativeItem.selection]);
  const restoredItem = prepareCreatorStructure({ document: itemResult.document, action: 'add-item', partKey: 'base' });
  assert.deepEqual(restoredItem.document.defaultRecipe.selections, [restoredItem.selection]);
  const empty = prepareCreatorStructure({ document, action: 'delete-part', partKey: 'base' });
  assert.deepEqual(empty.selection, { partKey: '', itemKey: '', styleKey: '' });
  assert.deepEqual(empty.document.parts, []);
});

test('copy empty Item/Part remains editable and deletion keeps assets referenced by other styles', () => {
  const document = createCharacterMakerV8Starter();
  const emptyItem = prepareCreatorStructure({ document, action: 'delete-style', partKey: 'base', itemKey: 'default', styleKey: 'default' }).document;
  const copiedEmptyItem = prepareCreatorStructure({ document: emptyItem, action: 'copy-item', partKey: 'base', itemKey: 'default' });
  assert.deepEqual(copiedEmptyItem.selection, { partKey: 'base', itemKey: 'default-copy', styleKey: '' });
  const copiedEmptyPart = prepareCreatorStructure({ document: emptyItem, action: 'copy-part', partKey: 'base' });
  assert.deepEqual(copiedEmptyPart.selection, { partKey: 'base-copy', itemKey: 'default-copy', styleKey: '' });
  const copy = prepareCreatorStructure({ document, action: 'copy-part', partKey: 'base' }).document;
  const removed = prepareCreatorStructure({ document: copy, action: 'delete-part', partKey: 'base' }).document;
  assert.deepEqual(removed.assets, document.assets);
  assert.equal(removed.parts[0].items[0].styles[0].assetId, 'base-default');
});

test('deletion filters a dangling target without losing surviving local and external targets', () => {
  const document = richDocument();
  document.rules.push(rule('mixed', selector('part-2'), [selector('base', 'default', 'style-2'),
    selector('base', 'default', 'default'), selector('base', 'default', 'style-2', 'EXTERNAL', `0x${'1'.repeat(64)}`)]));
  const result = prepareCreatorStructure({ document, action: 'delete-style', partKey: 'base', itemKey: 'default', styleKey: 'style-2' });
  assert.deepEqual(result.document.rules.find((row) => row.key === 'mixed').targets,
    [selector('base', 'default', 'default'), selector('base', 'default', 'style-2', 'EXTERNAL', `0x${'1'.repeat(64)}`)]);
});
