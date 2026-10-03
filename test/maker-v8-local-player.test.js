import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { createMakerV8LocalPlayer } from '../maker-v8-local-player.js';
import { makerV8RecipeConstraintIssue } from '../maker-v8-recipe-constraints.js';
import { projectMakerV8PlayerView, renderApprovedMakerV8Player } from '../maker-player-v8-view.js';
import { createMakerV8LocalPlayerControls } from '../maker-v8-local-player-controls.js';

const clone = (value) => structuredClone(value);
function source() {
  const document = clone(createCharacterMakerV8Starter({ makerKey: 'local-test', name: 'Local Test' }));
  const optional = clone(document.parts[0]);
  Object.assign(optional, { key: 'hat', label: 'Hat', kind: 'STANDARD', required: false, menuOrder: 1, renderOrder: 1 });
  document.parts.push(optional);
  return document;
}
const hat = () => ({ partKey: 'hat', itemKey: 'default', styleKey: 'default' });
const canonical = value => JSON.stringify((function ordered(item) {
  if (Array.isArray(item)) return item.map(ordered);
  if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])]));
  return item;
})(value));
const open = (document = source()) => createMakerV8LocalPlayer({ draftId: 'local-test', draftRevision: 3, document });
const withHat = (session) => {
  const recipe = clone(session.getSnapshot().recipe);
  recipe.selections.push(hat());
  return recipe;
};

test('image export is one validated CAS/history field and omitted canonical checkpoints default without losing content', () => {
  const model = open();
  const defaults = model.getSnapshot();
  const selected = { sizeMode: 'original', transparent: true };
  model.setImageExport(selected, 0);
  assert.throws(() => model.setImageExport(selected, 0), { code: 'MAKER_V8_LOCAL_PLAYER_CAS_MISMATCH' });
  assert.deepEqual(model.undo(1).imageExport, defaults.imageExport);
  assert.deepEqual(model.redo(2).imageExport, selected);
  const before = model.getSnapshot();
  model.setPersonalization({ profile: { ...before.profile, name: 'Retained' }, soulDocuments: before.soulDocuments }, before.revision);
  assert.deepEqual(model.getSnapshot().imageExport, selected);
  model.setRecipe(withHat(model), model.getSnapshot().revision);
  const serialized = model.exportCheckpoint();
  const cold = open(); cold.restoreCheckpoint(serialized, 0);
  assert.equal(cold.exportCheckpoint(), serialized);
  const omitted = JSON.parse(serialized); delete omitted.imageExport;
  const old = canonical(omitted);
  cold.restoreCheckpoint(old, cold.getSnapshot().revision);
  assert.deepEqual(cold.getSnapshot().imageExport, defaults.imageExport);
  assert.equal(cold.getSnapshot().profile.name, 'Retained');
  assert.deepEqual(cold.getSnapshot().recipe, model.getSnapshot().recipe);
  for (const imageExport of [null, {}, { sizeMode: 'original' }, { sizeMode: 'giant', transparent: false },
    { sizeMode: 'original', transparent: 'true' }, { ...selected, unknown: 1 }]) {
    const state = cold.getSnapshot();
    assert.throws(() => cold.setImageExport(imageExport, state.revision));
    assert.throws(() => cold.restoreCheckpoint(canonical({ ...omitted, imageExport }), state.revision));
    assert.deepEqual(cold.getSnapshot(), state);
  }
  assert.throws(() => cold.restoreCheckpoint(` ${old}`, cold.getSnapshot().revision));
  assert.deepEqual(model.reset(model.getSnapshot().revision).imageExport, defaults.imageExport);
});

test('visibility-invalid draft opens, repairs in steps, and preserves local history without weakening strict recipes', async () => {
  const document = source();
  const condition = partKey => ({ op: 'selected', source: 'BASE', sourceKey: null, partKey, itemKey: 'default', styleKey: 'default' });
  for (const key of ['cape', 'badge']) {
    const part = clone(document.parts[1]);
    Object.assign(part, { key, label: key, menuOrder: document.parts.length, renderOrder: document.parts.length });
    document.parts.push(part);
  }
  const base = document.parts[0].items[0].styles[0];
  base.visibleWhen = condition('hat');
  document.parts[2].items[0].styles[0].visibleWhen = condition('badge');
  document.parts[0].items[0].styles.push({ ...clone(base), key: 'alternate' });
  document.defaultRecipe.selections.push({ partKey: 'cape', itemKey: 'default', styleKey: 'default' });
  const original = clone(document);
  const session = open(document);
  const controller = createMakerV8LocalPlayerControls({ session: { ...session,
    async renderPreview() { return { revision: session.getSnapshot().revision }; },
  } });
  await controller.refresh();
  assert.equal(controller.getView().recipeValid, false);
  assert.equal(controller.getView().completeReady, false);
  assert.equal(makerV8RecipeConstraintIssue(document, session.getSnapshot().recipe.selections).code, 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE');
  const wrong = clone(session.getSnapshot().recipe);
  wrong.selections[0].styleKey = 'alternate';
  assert.throws(() => session.setRecipe(wrong, 0), { code: 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE' });
  assert.equal(session.getSnapshot().revision, 0);
  await controller.dispatch('player-item', { choiceId: 'base:hat:default:default' });
  assert.equal(session.getSnapshot().recipe.selections.length, 3);
  assert.equal(controller.getView().recipeValid, false, 'One remaining failure does not trap multi-step repair.');
  const partialCheckpoint = session.exportCheckpoint();
  const reopened = open(document);
  reopened.restoreCheckpoint(partialCheckpoint, 0);
  assert.deepEqual(reopened.getSnapshot().recipe, session.getSnapshot().recipe);
  await controller.dispatch('player-item', { choiceId: 'base:badge:default:default' });
  assert.equal(controller.getView().recipeValid, true);
  assert.equal(makerV8RecipeConstraintIssue(document, session.getSnapshot().recipe.selections), null);
  assert.equal(controller.getView().capabilities.entries['player-none:hat'].enabled, false);
  const valid = session.getSnapshot();
  await assert.rejects(controller.dispatch('player-none', { partId: 'hat' }));
  assert.deepEqual(session.getSnapshot(), valid);
  session.undo(valid.revision);
  assert.equal(makerV8RecipeConstraintIssue(document, session.getSnapshot().recipe.selections).code, 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE');
  session.redo(session.getSnapshot().revision);
  assert.equal(makerV8RecipeConstraintIssue(document, session.getSnapshot().recipe.selections), null);
  session.reset(session.getSnapshot().revision);
  assert.deepEqual(session.getSnapshot().recipe.selections, original.defaultRecipe.selections);
  assert.deepEqual(document, original);
  controller.dispose(); reopened.dispose();
});

test('visibility constraints preserve exact contextual sources and never resolve remote namesakes as local Styles', () => {
  const document = source();
  document.parts[0].items[0].styles[0].visibleWhen = {
    op: 'selected', source: 'PACK', sourceKey: 'sample-pack', partKey: 'hat', itemKey: 'default', styleKey: 'default',
  };
  const base = document.defaultRecipe.selections[0];
  assert.equal(makerV8RecipeConstraintIssue(document, [base, hat()]).code, 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE');
  const pack = { ...hat(), source: 'PACK', semanticPackId: 'sample-pack' };
  assert.equal(makerV8RecipeConstraintIssue(document, [base, pack]), null);
  assert.equal(makerV8RecipeConstraintIssue(document, [base, { ...pack, semanticPackId: 'wrong-pack' }]).code, 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE');
  assert.equal(makerV8RecipeConstraintIssue(document, [{ ...base, source: 'EXTERNAL' }]), null,
    'A contextual Style is not subject to a local same-named Style condition.');
});

test('optional empty Part remains a real local slot through picker, no-op clear and checkpoint recovery', async () => {
  const document = source(); document.parts[1].items = [];
  const session = open(document);
  const controller = createMakerV8LocalPlayerControls({ session: { ...session,
    async renderPreview() { return { revision: session.getSnapshot().revision }; },
  } });
  await controller.refresh();
  await controller.dispatch('player-part', { partId: 'hat' });
  const view = controller.getView();
  const part = view.parts.find(part => part.key === 'hat');
  assert.deepEqual(part.choices, []);
  assert.deepEqual(part.selections, []);
  assert.equal(view.selectedPartKey, 'hat');
  assert.match(renderApprovedMakerV8Player(view), /v4-inline-empty/);
  const initial = session.getSnapshot();
  await controller.dispatch('player-none', { partId: 'hat' });
  await controller.dispatch('player-clear');
  assert.equal(session.getSnapshot().revision, initial.revision);
  await assert.rejects(controller.dispatch('player-item', { choiceId: 'base:hat:default:default' }));
  assert.deepEqual(session.getSnapshot(), initial);
  await controller.dispatch('player-profile-name', { value: 'Empty slot retained' });
  const reopened = open(document);
  reopened.restoreCheckpoint(session.exportCheckpoint(), 0);
  assert.deepEqual(reopened.getSnapshot().document.parts[1].items, []);
  assert.deepEqual(reopened.getSnapshot().recipe, initial.recipe);
  assert.equal(reopened.getSnapshot().profile.name, 'Empty slot retained');
  assert.equal(view.completeReady, false);
  controller.dispose(); reopened.dispose();
});

test('Player inherits exact author Soul documents, preserves personalization on recovery, and resets to author defaults', async () => {
  const document = source();
  document.livingContent.soulMd = '  # 作者原文\r\n{{OC_NAME}}\n';
  document.livingContent.memoryMd = '';
  const session = open(document);
  const initial = session.getSnapshot();
  assert.equal(initial.soulDocuments.soulMd, document.livingContent.soulMd);
  assert.equal(initial.soulDocuments.memoryMd, '');
  session.setPersonalization({ profile: initial.profile, soulDocuments: { ...initial.soulDocuments, soulMd: '# User character' } }, 0);
  const checkpoint = await session.exportCheckpoint();
  const recovered = open(document);
  await recovered.restoreCheckpoint(checkpoint, 0);
  assert.equal(recovered.getSnapshot().soulDocuments.soulMd, '# User character');
  recovered.reset(recovered.getSnapshot().revision);
  assert.deepEqual(recovered.getSnapshot().soulDocuments, initial.soulDocuments);
  assert.equal(document.livingContent.soulMd, '  # 作者原文\r\n{{OC_NAME}}\n');
});

test('local Player has only draft identity and cannot impersonate a certified Player session', () => {
  const document = source();
  const original = clone(document);
  const session = open(document);
  const initial = session.getSnapshot();
  assert.equal(initial.mode, 'LOCAL_DRAFT');
  assert.equal(initial.draftId, 'local-test');
  assert.equal(initial.draftRevision, 3);
  assert.equal(initial.revision, 0);
  for (const key of ['rootId', 'player', 'loadout', 'execution', 'wallet', 'evidence']) {
    assert.equal(Object.hasOwn(initial, key), false);
  }
  assert.deepEqual(Object.keys(session).sort(), ['dispose', 'exportCheckpoint', 'getSnapshot', 'redo', 'reset', 'restoreCheckpoint', 'setImageExport', 'setPersonalization', 'setRecipe', 'undo']);
  assert.throws(() => projectMakerV8PlayerView(initial), /READY/);
  document.metadata.name = 'mutated caller';
  assert.equal(session.getSnapshot().document.metadata.name, original.metadata.name);
  assert.throws(() => { initial.document.metadata.name = 'mutated snapshot'; }, TypeError);
  const recipe = withHat(session);
  session.setRecipe(recipe, 0);
  recipe.selections.length = 0;
  assert.equal(session.getSnapshot().recipe.selections.length, 2);
  assert.deepEqual(session.getSnapshot().document, original);
  assert.equal(initial.recipe.selections.length, 1);
});

test('local editing requires revision CAS, rejects failed edits atomically, and supports undo/redo/reset', () => {
  const session = open();
  const initial = session.getSnapshot();
  assert.throws(() => session.setRecipe(withHat(session)), { code: 'MAKER_V8_LOCAL_PLAYER_CAS_MISMATCH' });
  const reordered = { ...clone(initial.recipe), selections: initial.recipe.selections.map(({ partKey, itemKey, styleKey }) => ({ styleKey, itemKey, partKey })) };
  assert.equal(session.setRecipe(reordered, 0).revision, 0, 'Field insertion order is not a new edit.');
  const edited = session.setRecipe(withHat(session), 0);
  assert.equal(edited.revision, 1);
  assert.equal(edited.undoDepth, 1);
  for (const method of ['reset', 'undo', 'redo']) {
    assert.throws(() => session[method](0), { code: 'MAKER_V8_LOCAL_PLAYER_CAS_MISMATCH' });
  }
  const invalid = clone(edited.recipe);
  invalid.outputKey = 'absent';
  assert.throws(() => session.setRecipe(invalid, 1));
  assert.deepEqual(session.getSnapshot(), edited);
  assert.deepEqual(session.undo(1).recipe, initial.recipe);
  assert.deepEqual(session.redo(2).recipe, edited.recipe);
  assert.deepEqual(session.reset(3).recipe, initial.recipe);
  assert.equal(session.reset(4).revision, 4, 'No-op reset does not fabricate an edit.');
  session.undo(4);
  session.setRecipe(initial.recipe, 5);
  assert.equal(session.getSnapshot().redoDepth, 0);
});

test('local Player rejects arbitrary authority fields, malformed arrays, missing references and required parts', () => {
  const session = open();
  const initial = session.getSnapshot();
  const variants = [
    { ...clone(initial.recipe), rootId: `0x${'12'.repeat(32)}` },
    { ...clone(initial.recipe), selections: [] },
    { ...clone(initial.recipe), selections: new Array(1) },
    { ...clone(initial.recipe), colors: new Array(1) },
    { ...clone(initial.recipe), colors: [{ channelKey: 'missing', swatchKey: 'missing' }] },
    { ...clone(initial.recipe), selections: [{ ...initial.recipe.selections[0], source: 'PACK' }] },
    { ...clone(initial.recipe), selections: [{ ...initial.recipe.selections[0], styleKey: 'missing' }] },
    { ...clone(initial.recipe), selections: [initial.recipe.selections[0], initial.recipe.selections[0]] },
  ];
  for (const recipe of variants) {
    assert.throws(() => session.setRecipe(recipe, 0));
    assert.deepEqual(session.getSnapshot(), initial);
  }
  let accessed = false;
  const accessor = clone(initial.recipe);
  Object.defineProperty(accessor, 'outputKey', { get() { accessed = true; return 'x'; } });
  assert.throws(() => session.setRecipe(accessor, 0));
  assert.equal(accessed, false);
  assert.throws(() => createMakerV8LocalPlayer({ draftId: `0x${'12'.repeat(32)}`, draftRevision: 0, document: source() }));
  assert.throws(() => createMakerV8LocalPlayer({ draftId: 'local-test', draftRevision: 1, document: source(), rootId: 'fake' }));
});

test('local and certified selection constraints share REQUIRE, EXCLUDE, capacity and required-Part outcomes', () => {
  for (const kind of ['REQUIRE', 'EXCLUDE']) {
    const document = source();
    document.rules.push({ key: 'pair', kind,
      trigger: { source: 'BASE', sourceKey: null, partKey: 'base', itemKey: 'default', styleKey: null },
      targetMode: kind === 'EXCLUDE' ? 'ANY' : 'ALL',
      targets: [{ source: 'BASE', sourceKey: null, partKey: 'hat', itemKey: 'default', styleKey: null }],
      payload: {} });
    if (kind === 'REQUIRE') document.defaultRecipe.selections.push(hat());
    const session = open(document);
    const invalid = clone(session.getSnapshot().recipe);
    if (kind === 'REQUIRE') invalid.selections.pop();
    else invalid.selections.push(hat());
    const expected = `MAKER_V8_PLAYER_RULE_${kind}_FAILED`;
    assert.equal(makerV8RecipeConstraintIssue(document, invalid.selections).code, expected);
    assert.throws(() => session.setRecipe(invalid, 0), { code: expected });
    assert.equal(session.getSnapshot().revision, 0);
  }
  const document = source();
  assert.equal(makerV8RecipeConstraintIssue(document, []).code, 'MAKER_V8_PLAYER_REQUIRED_PART_MISSING');
  assert.equal(makerV8RecipeConstraintIssue(document, [...document.defaultRecipe.selections, ...document.defaultRecipe.selections]).code,
    'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID');
});

test('local recipes retain multi-capacity order, validate Colors and reject private or duplicated assetized Items', () => {
  const document = source();
  document.parts[1].capacity = 2;
  const item = document.parts[1].items[0];
  item.styles.push({ ...clone(item.styles[0]), key: 'alternate', displayOrder: 1 });
  document.colors = [{ key: 'primary', label: 'Primary', defaultSwatchKey: 'red', swatches: [
    { key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] },
    { key: 'blue', label: 'Blue', rgba: '#0000ffff', stops: [] },
  ] }];
  const session = open(document);
  const recipe = clone(session.getSnapshot().recipe);
  recipe.selections.unshift({ ...hat(), styleKey: 'alternate' }, hat());
  recipe.colors.push({ channelKey: 'primary', swatchKey: 'blue' });
  const edited = session.setRecipe(recipe, 0);
  assert.deepEqual(edited.recipe.selections.map(({ partKey, styleKey }) => `${partKey}/${styleKey}`),
    ['base/default', 'hat/alternate', 'hat/default']);
  assert.deepEqual(edited.recipe.colors, recipe.colors);
  for (const colors of [
    [{ channelKey: 'primary', swatchKey: 'absent' }],
    [recipe.colors[0], recipe.colors[0]],
  ]) assert.throws(() => session.setRecipe({ ...recipe, colors }, 1));
  assert.equal(session.getSnapshot().revision, 1);
  const privateDocument = clone(document);
  privateDocument.parts[1].items[0].status = 'PRIVATE';
  const privateSession = open(privateDocument);
  assert.throws(() => privateSession.setRecipe(recipe, 0));
  const assetized = clone(document);
  assetized.composition.mode = 'COMPOSABLE';
  assetized.composition.itemAssetization = true;
  const assetizedSession = open(assetized);
  assert.throws(() => assetizedSession.setRecipe(recipe, 0), { code: 'MAKER_V8_RECIPE_OWNED_ITEM_REUSED' });
});

test('local history is bounded and disposal invalidates all session access', () => {
  const session = open();
  const base = session.getSnapshot().recipe;
  const expanded = withHat(session);
  for (let index = 0; index < 120; index += 1) session.setRecipe(index % 2 ? base : expanded, index);
  assert.equal(session.getSnapshot().undoDepth, 100);
  session.dispose();
  session.dispose();
  for (const method of ['getSnapshot', 'reset', 'undo', 'redo']) {
    assert.throws(() => session[method](120), { code: 'MAKER_V8_LOCAL_PLAYER_DISPOSED' });
  }
  assert.throws(() => session.setRecipe(base, 120), { code: 'MAKER_V8_LOCAL_PLAYER_DISPOSED' });
});

test('local profile and Soul documents use exact CAS and share recipe undo/redo/reset history', () => {
  const session = open();
  const initial = session.getSnapshot();
  const input = { profile: { ...initial.profile, name: '星辰', description: '<script>local text</script>' },
    soulDocuments: { ...initial.soulDocuments, soulMd: '# Local Soul' } };
  assert.throws(() => session.setPersonalization(input), { code: 'MAKER_V8_LOCAL_PLAYER_CAS_MISMATCH' });
  const first = session.setPersonalization(input, 0);
  assert.equal(first.revision, 1);
  input.profile.name = 'Caller mutation';
  assert.equal(session.getSnapshot().profile.name, '星辰');
  assert.throws(() => { first.soulDocuments.soulMd = 'mutated'; }, TypeError);
  session.setRecipe(withHat(session), 1);
  assert.equal(session.undo(2).profile.name, '星辰');
  assert.equal(session.undo(3).profile.name, '');
  assert.equal(session.redo(4).soulDocuments.soulMd, '# Local Soul');
  const reset = session.reset(5);
  assert.deepEqual(reset.profile, initial.profile);
  assert.deepEqual(reset.soulDocuments, initial.soulDocuments);
  assert.deepEqual(reset.document, initial.document);
  session.dispose();
  assert.throws(() => session.setPersonalization(input, 6), { code: 'MAKER_V8_LOCAL_PLAYER_DISPOSED' });
});

test('local personalization rejects authority, coercion and accessors without partial mutation', () => {
  const session = open();
  const initial = session.getSnapshot();
  const input = { profile: clone(initial.profile), soulDocuments: clone(initial.soulDocuments) };
  for (const invalid of [
    { ...input, wallet: 'fake' },
    { ...input, profile: { ...input.profile, name: 1 } },
    { ...input, profile: { ...input.profile, name: 'x'.repeat(129) } },
    { ...input, profile: { ...input.profile, world: 'x'.repeat(129) } },
    { ...input, profile: { ...input.profile, description: 'x'.repeat(2001) } },
    { ...input, profile: { ...input.profile, tags: 'x'.repeat(1001) } },
    { ...input, soulDocuments: { ...input.soulDocuments, soulMd: null } },
    { ...input, soulDocuments: { ...input.soulDocuments, validation: { valid: true } } },
    { ...input, soulDocuments: { ...input.soulDocuments, defaults: {} } },
  ]) {
    assert.throws(() => session.setPersonalization(invalid, 0));
    assert.deepEqual(session.getSnapshot(), initial);
  }
  let accessed = false;
  const profile = clone(input.profile);
  Object.defineProperty(profile, 'name', { get() { accessed = true; return 'forged'; } });
  assert.throws(() => session.setPersonalization({ ...input, profile }, 0));
  assert.equal(accessed, false);
});

test('Soul limits use UTF-8 bytes and canonical field ordering keeps personalization no-ops stable', () => {
  const session = open();
  const initial = session.getSnapshot();
  const profile = { tags: 'x'.repeat(1000), description: 'x'.repeat(2000), world: '界'.repeat(128), name: '星'.repeat(128) };
  const soulDocuments = { skillMd: '', memoryMd: '', soulMd: '界'.repeat(21845) + 'x' };
  assert.equal(new TextEncoder().encode(soulDocuments.soulMd).length, 65536);
  const accepted = session.setPersonalization({ profile, soulDocuments }, 0);
  assert.equal(accepted.revision, 1);
  assert.equal(session.setPersonalization({ profile: clone(accepted.profile), soulDocuments: clone(accepted.soulDocuments) }, 1).revision, 1);
  assert.throws(() => session.setPersonalization({ profile, soulDocuments: { ...soulDocuments, soulMd: `${soulDocuments.soulMd}x` } }, 1),
    { code: 'MAKER_V8_LOCAL_PLAYER_SOUL_INVALID' });
  assert.deepEqual(session.getSnapshot(), accepted);
  const incomplete = session.setPersonalization({ profile: initial.profile, soulDocuments: { soulMd: '', memoryMd: '', skillMd: '' } }, 1);
  assert.equal(incomplete.soulDocuments.soulMd, '', 'Incomplete local text can be edited, not certified.');
});

test('exact local checkpoint cold-restores all content in one undoable CAS step', () => {
  const session = open();
  const before = session.getSnapshot();
  session.setRecipe(withHat(session), 0);
  session.setPersonalization({ profile: { ...before.profile, name: 'Cold Moon' }, soulDocuments: { ...before.soulDocuments, soulMd: '# Moon' } }, 1);
  const serialized = session.exportCheckpoint();
  const checkpoint = JSON.parse(serialized);
  assert.match(checkpoint.documentHash, /^[0-9a-f]{64}$/);
  assert.equal(checkpoint.schemaVersion, 'animacraft.maker-v8-local-player-checkpoint.v1');
  const fresh = open();
  assert.throws(() => fresh.restoreCheckpoint(serialized), { code: 'MAKER_V8_LOCAL_PLAYER_CAS_MISMATCH' });
  const restored = fresh.restoreCheckpoint(serialized, 0);
  assert.deepEqual(restored.recipe, session.getSnapshot().recipe);
  assert.equal(restored.profile.name, 'Cold Moon');
  assert.equal(restored.soulDocuments.soulMd, '# Moon');
  assert.equal(restored.revision, 1);
  assert.equal(restored.undoDepth, 1);
  assert.equal(fresh.restoreCheckpoint(serialized, 1).revision, 1);
  assert.deepEqual(fresh.undo(1).profile, before.profile);
  assert.equal(fresh.redo(2).profile.name, 'Cold Moon');
  assert.equal(fresh.exportCheckpoint(), serialized);
});

test('checkpoint validation rejects foreign source, noncanonical JSON and invalid text atomically', () => {
  const sourceSession = open();
  sourceSession.setRecipe(withHat(sourceSession), 0);
  const serialized = sourceSession.exportCheckpoint();
  const target = open();
  const before = target.getSnapshot();
  for (const invalid of [
    null, '{', ` ${serialized}`, JSON.stringify(JSON.parse(serialized), null, 2),
    serialized.replace('"draftRevision":3', '"draftRevision":4'),
    serialized.replace('"draftId":"local-test"', '"draftId":"foreign"'),
    serialized.replace('"name":""', '"name":1'),
    serialized.replace(JSON.stringify(sourceSession.getSnapshot().soulDocuments.soulMd), JSON.stringify('x'.repeat(65537))),
    serialized.replace('"outputKey":"', '"outputKey":"missing-'),
    serialized.replace('{', '{"rootId":"fake",'),
    serialized.replace('{', '{"draftId":"discarded-duplicate",'),
    'x'.repeat(16 * 1024 * 1024 + 1),
  ]) {
    assert.throws(() => target.restoreCheckpoint(invalid, 0));
    assert.deepEqual(target.getSnapshot(), before);
  }
  const changed = source();
  changed.metadata.name = 'same identity, changed content';
  assert.throws(() => open(changed).restoreCheckpoint(serialized, 0), { code: 'MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID' });
  const reordered = Object.fromEntries(Object.entries(source()).reverse());
  assert.equal(open(reordered).restoreCheckpoint(serialized, 0).recipe.selections.length, 2);
  target.dispose();
  assert.throws(() => target.exportCheckpoint(), { code: 'MAKER_V8_LOCAL_PLAYER_DISPOSED' });
});
