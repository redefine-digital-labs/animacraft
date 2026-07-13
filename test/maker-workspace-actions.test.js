import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCharacterMakerV4Starter } from '../maker-v4.js';
import { createMakerWorkspace } from '../maker-workspace.js';

class FakeRoot {
  constructor(selectors = {}) {
    this.innerHTML = '';
    this.selectors = selectors;
  }

  addEventListener() {}
  removeEventListener() {}
  contains() { return false; }
  querySelector(selector) { return this.selectors[selector] || null; }
}

function actionTarget(action, dataset = {}, textContent = '') {
  const target = {
    dataset: { action, ...dataset },
    textContent,
    matches: () => false,
  };
  target.closest = () => target;
  return target;
}

function creatorClick(workspace, action, dataset = {}, textContent = '') {
  workspace.handleCreatorClick({ target: actionTarget(action, dataset, textContent) });
}

function playerClick(workspace, action, dataset = {}, textContent = '') {
  workspace.handlePlayerClick({ target: actionTarget(action, dataset, textContent) });
}

async function withWorkspace(run, options = {}) {
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  const workspace = createMakerWorkspace(options);
  try {
    const document = createCharacterMakerV4Starter({ makerId: `qa-${Math.random()}`, name: 'QA Maker' });
    await workspace.setContext({ makerKey: `wallet:${document.version.rootMakerId}`, walletAddress: '', document, assets: [] });
    await run(workspace);
  } finally {
    workspace.destroy();
    globalThis.requestAnimationFrame = previousAnimationFrame;
  }
}

test('position confirmation collapses the position editor and explicit adjustment reopens it', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    assert.match(creatorRoot.innerHTML, /data-action="binding-x"/);
    assert.match(creatorRoot.innerHTML, /data-action="confirm-position"/);

    creatorClick(workspace, 'confirm-position');
    assert.equal(workspace.selectedCreatorRecords().binding.positionConfirmed, true);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="binding-x"/);
    assert.match(creatorRoot.innerHTML, /data-action="edit-position"/);

    creatorClick(workspace, 'edit-position');
    assert.match(creatorRoot.innerHTML, /data-action="binding-x"/);

    await workspace.handleCreatorChange({ target: { dataset: { action: 'binding-x' }, value: '18.5', type: 'number' } });
    assert.equal(workspace.selectedCreatorRecords().binding.transform.x, 18.5);
    assert.equal(workspace.selectedCreatorRecords().binding.positionConfirmed, false);
    assert.match(creatorRoot.innerHTML, /data-action="confirm-position"/);
  }, { creatorRoot });
});

test('Creator rerenders preserve panel scroll, focus and input selection', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const parts = { scrollTop: 184, scrollLeft: 7 };
  const inspector = { scrollTop: 390, scrollLeft: 0 };
  const active = {
    id: 'qaMakerName',
    dataset: { action: 'part-name', partId: 'part-1' },
    selectionStart: 2,
    selectionEnd: 5,
  };
  const replacement = {
    focused: false,
    selection: null,
    focus(options) { this.focused = options?.preventScroll === true; },
    setSelectionRange(start, end) { this.selection = [start, end]; },
  };
  const nodes = {
    '.v4-parts-list': parts,
    '.v4-inspector': inspector,
    '#qaMakerName': replacement,
  };
  const root = {
    addEventListener() {},
    removeEventListener() {},
    querySelector: (selector) => nodes[selector] || null,
    contains: (node) => node === active,
  };
  globalThis.document = { activeElement: active };
  const restoredPage = [];
  globalThis.window = { scrollX: 12, scrollY: 640, scrollTo: (left, top) => restoredPage.push([left, top]) };
  try {
    const workspace = createMakerWorkspace({ creatorRoot: root });
    const viewState = workspace.captureCreatorViewState();
    parts.scrollTop = 0;
    parts.scrollLeft = 0;
    inspector.scrollTop = 0;
    workspace.restoreCreatorViewState(viewState);
    assert.deepEqual([parts.scrollTop, parts.scrollLeft], [184, 7]);
    assert.equal(inspector.scrollTop, 390);
    assert.equal(replacement.focused, true);
    assert.deepEqual(replacement.selection, [2, 5]);
    assert.deepEqual(restoredPage, [[12, 640]]);
    workspace.destroy();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('creator structure controls mutate the v4 document and remain undoable', async () => {
  await withWorkspace(async (workspace) => {
    const initial = workspace.getDocument();
    const firstPart = initial.parts[0];
    creatorClick(workspace, 'select-part', { partId: firstPart.id });

    const itemCount = workspace.getDocument().parts[0].items.length;
    creatorClick(workspace, 'add-item');
    assert.equal(workspace.getDocument().parts[0].items.length, itemCount + 1);
    creatorClick(workspace, 'copy-item');
    assert.equal(workspace.getDocument().parts[0].items.length, itemCount + 2);

    const selectedItem = workspace.selectedCreatorRecords().item;
    const variantCount = selectedItem.variants.length;
    creatorClick(workspace, 'add-variant');
    creatorClick(workspace, 'copy-variant');
    assert.equal(workspace.selectedCreatorRecords().item.variants.length, variantCount + 2);

    const bindingCount = workspace.selectedCreatorRecords().variant.layerBindings.length;
    creatorClick(workspace, 'add-empty-binding');
    assert.equal(workspace.selectedCreatorRecords().variant.layerBindings.length, bindingCount + 1);
    creatorClick(workspace, 'delete-binding');
    assert.equal(workspace.selectedCreatorRecords().variant.layerBindings.length, bindingCount);

    const partCount = workspace.getDocument().parts.length;
    creatorClick(workspace, 'add-part');
    assert.equal(workspace.getDocument().parts.length, partCount + 1);
    creatorClick(workspace, 'undo');
    assert.equal(workspace.getDocument().parts.length, partCount);
    creatorClick(workspace, 'redo');
    assert.equal(workspace.getDocument().parts.length, partCount + 1);

    const previousPixelMode = workspace.getDocument().canvas.pixelMode;
    creatorClick(workspace, 'toggle-pixel');
    assert.notEqual(workspace.getDocument().canvas.pixelMode, previousPixelMode);

    const trackCount = workspace.getDocument().layerTracks.length;
    creatorClick(workspace, 'add-track');
    const unusedTrack = workspace.selectedTrackId;
    assert.equal(workspace.getDocument().layerTracks.length, trackCount + 1);
    creatorClick(workspace, 'delete-track', { trackId: unusedTrack });
    assert.equal(workspace.getDocument().layerTracks.length, trackCount);
  });
});

test('color, rule, and Expansion Pack controls perform real document operations', async () => {
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-channel');
    let document = workspace.getDocument();
    assert.equal(document.colorChannels.length, 1);
    const channelId = document.colorChannels[0].id;
    const originalSwatchCount = document.colorChannels[0].swatches.length;

    creatorClick(workspace, 'add-swatch');
    document = workspace.getDocument();
    assert.equal(document.colorChannels[0].swatches.length, originalSwatchCount + 1);
    const addedSwatch = document.colorChannels[0].swatches.at(-1);
    await workspace.handleCreatorChange({ target: { dataset: { action: 'channel-default-swatch' }, value: addedSwatch.id, type: 'radio' } });
    assert.equal(workspace.getDocument().colorChannels[0].defaultSwatchId, addedSwatch.id);
    creatorClick(workspace, 'delete-swatch', { swatchId: addedSwatch.id });
    assert.equal(workspace.getDocument().colorChannels[0].swatches.length, originalSwatchCount);

    await workspace.handleCreatorChange({ target: { dataset: { action: 'channel-mode' }, value: 'asset-map', type: 'select-one' } });
    assert.equal(workspace.getDocument().colorChannels[0].mode, 'asset-map');

    document = workspace.getDocument();
    const owner = document.parts[0];
    const target = document.parts[1];
    workspace.selectedPartId = owner.id;
    workspace.selectedItemId = owner.items[0].id;
    workspace.selectedVariantId = owner.items[0].variants[0].id;
    workspace.creatorRoot = new FakeRoot({
      '#v4RuleOwnerPart': { value: owner.id },
      '#v4RuleOwnerScope': { value: 'part' },
      '#v4RuleType': { value: 'excludes' },
      '#v4RuleTargetDefinition': { value: target.id },
    });
    workspace.addRuleFromBuilder();
    assert.equal(workspace.getDocument().parts[0].excludes.length, 1);
    const ruleId = `part:${owner.id}:excludes:0`;
    workspace.deleteRule(ruleId);
    assert.equal(workspace.getDocument().parts[0].excludes.length, 0);

    creatorClick(workspace, 'add-expansion');
    document = workspace.getDocument();
    assert.equal(document.extensions.expansionDrafts.length, 1);
    const packId = document.extensions.expansionDrafts[0].packId;
    creatorClick(workspace, 'add-selected-to-expansion', { packId });
    assert.equal(workspace.getDocument().extensions.expansionDrafts[0].parts[0].items.length, 1);
    creatorClick(workspace, 'toggle-expansion', { packId });
    assert.equal(workspace.enabledExpansionIds.has(packId), true);
    creatorClick(workspace, 'delete-expansion', { packId });
    assert.equal(workspace.getDocument().extensions.expansionDrafts.length, 0);

    workspace.selectedChannelId = channelId;
    creatorClick(workspace, 'delete-channel');
    assert.equal(workspace.getDocument().colorChannels.length, 0);
  });
});

test('player controls select, undo, redo, clear, randomize, edit profile and complete an OC', async () => {
  const completed = [];
  await withWorkspace(async (workspace) => {
    const part = workspace.getDocument().parts.find((candidate) => !candidate.required);
    workspace.selectedPartId = part.id;
    workspace.ensureCreatorSelection(workspace.getDocument());
    creatorClick(workspace, 'add-item');
    const nextItem = workspace.selectedCreatorRecords().item;

    workspace.playerPartId = part.id;
    playerClick(workspace, 'player-item', { itemId: nextItem.id });
    assert.equal(workspace.playerRecipe.selections.find((selection) => selection.partId === part.id).itemId, nextItem.id);
    playerClick(workspace, 'player-undo');
    assert.notEqual(workspace.playerRecipe.selections.find((selection) => selection.partId === part.id)?.itemId, nextItem.id);
    playerClick(workspace, 'player-redo');
    assert.equal(workspace.playerRecipe.selections.find((selection) => selection.partId === part.id).itemId, nextItem.id);

    playerClick(workspace, 'player-none');
    assert.equal(workspace.playerRecipe.selections.some((selection) => selection.partId === part.id), false);
    playerClick(workspace, 'player-reset');
    assert.deepEqual(workspace.playerRecipe.selections, workspace.runtimeDocument().defaultRecipe.selections);
    playerClick(workspace, 'player-random');
    assert.equal(workspace.playerRecipe.selections.length > 0, true);
    playerClick(workspace, 'player-clear');
    assert.equal(workspace.playerRecipe.selections.every((selection) => workspace.runtimeDocument().parts.find((candidate) => candidate.id === selection.partId)?.required), true);

    workspace.handlePlayerChange({ target: { dataset: { action: 'player-profile-name' }, value: 'Test OC' } });
    workspace.handlePlayerChange({ target: { dataset: { action: 'player-profile-world' }, value: 'Test World' } });
    assert.equal(workspace.playerProfile.name, 'Test OC');
    assert.equal(workspace.playerProfile.world, 'Test World');

    playerClick(workspace, 'player-info');
    assert.equal(workspace.playerIntroOpen, true);
    playerClick(workspace, 'close-player-info');
    assert.equal(workspace.playerIntroOpen, false);
    playerClick(workspace, 'player-complete');
    assert.equal(completed.length, 1);
  }, { callbacks: { onCompleteOc: (payload) => completed.push(payload) } });
});

test('every rendered Maker Studio data-action is backed by a handler or an intentional passive form value', async () => {
  const source = await readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8');
  const actions = [...new Set([...source.matchAll(/data-action="([^"$]+)"/g)].map((match) => match[1]))].sort();
  const passive = new Set(['rule-owner-part']);
  assert.ok(actions.length >= 100, 'the complete Creator and Player action surface must be audited');

  actions.forEach((action) => {
    if (passive.has(action)) return;
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentions = source.match(new RegExp(`['"]${escaped}['"]`, 'g')) || [];
    assert.ok(mentions.length >= 2, `${action} is rendered but is not referenced by an event handler`);
  });
});
