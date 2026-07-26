import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { createStyle, synchronizeDefaultRecipe } from '../maker-document-ops.js';
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
  const { playable = false, ...workspaceOptions } = options;
  const workspace = createMakerWorkspace(workspaceOptions);
  try {
    const document = createCharacterMakerV5Starter({ makerId: `qa-${Math.random()}`, name: 'QA Maker' });
    if (playable) {
      document.parts.forEach((part, index) => {
        const item = part.items[0];
        const selectedStyle = createStyle(item, 'Default');
        selectedStyle.layerTrackId = document.layerTracks[index].id;
        selectedStyle.assetId = `${part.id}-art`;
        selectedStyle.positionConfirmed = true;
        item.styles.push(selectedStyle);
        item.defaultStyleId = selectedStyle.id;
        item.status = 'public';
        document.assets.push({
          id: selectedStyle.assetId,
          identifier: `${selectedStyle.assetId}.png`,
          kind: 'layer',
          mediaType: 'image/png',
          width: 1024,
          height: 1024,
        });
      });
      synchronizeDefaultRecipe(document);
    }
    await workspace.setContext({ makerKey: `wallet:${document.version.rootMakerId}`, walletAddress: '', document, assets: [] });
    await run(workspace);
  } finally {
    workspace.destroy();
    globalThis.requestAnimationFrame = previousAnimationFrame;
  }
}

test('position confirmation is separate from the real position lock', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-style');
    assert.match(creatorRoot.innerHTML, /data-action="style-x"/);
    assert.match(creatorRoot.innerHTML, /data-action="confirm-position"/);

    creatorClick(workspace, 'confirm-position');
    assert.equal(workspace.selectedCreatorRecords().style.positionConfirmed, true);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="style-x"/);
    assert.match(creatorRoot.innerHTML, /data-action="edit-position"/);
    creatorClick(workspace, 'edit-position');
    assert.match(creatorRoot.innerHTML, /data-action="style-x"/);

    await workspace.handleCreatorChange({ target: { dataset: { action: 'style-x' }, value: '18.5', type: 'number' } });
    assert.equal(workspace.selectedCreatorRecords().style.transform.x, 18.5);
    assert.equal(workspace.selectedCreatorRecords().style.positionConfirmed, false);

    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-position-locked' }, checked: true, type: 'checkbox' },
    });
    assert.equal(workspace.selectedCreatorRecords().style.positionLocked, true);
    await workspace.handleCreatorChange({ target: { dataset: { action: 'style-x' }, value: '99', type: 'number' } });
    assert.equal(workspace.selectedCreatorRecords().style.transform.x, 18.5);
  }, { creatorRoot });
});

test('editing one Style never changes another Item or Part', async () => {
  await withWorkspace(async (workspace) => {
    let initial = workspace.getDocument();
    const firstPart = initial.parts[0];
    const firstItem = firstPart.items[0];
    const otherPart = initial.parts[1];
    const otherItem = otherPart.items[0];

    creatorClick(workspace, 'select-part', { partId: firstPart.id });
    creatorClick(workspace, 'select-item', { itemId: firstItem.id });
    creatorClick(workspace, 'add-style');
    const firstStyle = workspace.selectedCreatorRecords().style;

    creatorClick(workspace, 'select-part', { partId: otherPart.id });
    creatorClick(workspace, 'select-item', { itemId: otherItem.id });
    creatorClick(workspace, 'add-style');
    const otherStyle = workspace.selectedCreatorRecords().style;

    creatorClick(workspace, 'select-part', { partId: firstPart.id });
    creatorClick(workspace, 'select-item', { itemId: firstItem.id });
    creatorClick(workspace, 'select-style', { styleId: firstStyle.id });
    creatorClick(workspace, 'copy-item');
    const copiedItem = workspace.selectedCreatorRecords().item;
    const copiedStyle = copiedItem.styles[0];
    assert.notEqual(copiedStyle.id, firstStyle.id);

    await workspace.handleCreatorChange({ target: { dataset: { action: 'style-x' }, value: '37', type: 'number' } });
    let document = workspace.getDocument();
    assert.equal(document.parts[0].items.find((item) => item.id === copiedItem.id).styles[0].transform.x, 37);
    assert.equal(document.parts[0].items.find((item) => item.id === firstItem.id).styles[0].transform.x, 0);
    assert.equal(document.parts[1].items.find((item) => item.id === otherItem.id).styles[0].transform.x, 0);

    creatorClick(workspace, 'confirm-position');
    document = workspace.getDocument();
    assert.equal(document.parts[0].items.find((item) => item.id === copiedItem.id).styles[0].positionConfirmed, true);
    assert.equal(document.parts[0].items.find((item) => item.id === firstItem.id).styles[0].positionConfirmed, false);

    creatorClick(workspace, 'select-part', { partId: otherPart.id });
    creatorClick(workspace, 'select-item', { itemId: otherItem.id });
    creatorClick(workspace, 'select-style', { styleId: otherStyle.id });
    assert.equal(workspace.selectedCreatorRecords().style.id, otherStyle.id);
    await workspace.handleCreatorChange({ target: { dataset: { action: 'style-y' }, value: '-42', type: 'number' } });

    document = workspace.getDocument();
    assert.equal(document.parts[1].items.find((item) => item.id === otherItem.id).styles[0].transform.y, -42);
    assert.equal(document.parts[0].items.find((item) => item.id === copiedItem.id).styles[0].transform.y, 0);
    assert.equal(document.parts[0].items.find((item) => item.id === firstItem.id).styles[0].transform.y, 0);
  });
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

test('creator structure controls mutate the v5 document and remain undoable', async () => {
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
    const styleCount = selectedItem.styles.length;
    creatorClick(workspace, 'add-style');
    creatorClick(workspace, 'copy-style');
    assert.equal(workspace.selectedCreatorRecords().item.styles.length, styleCount + 2);

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
    assert.equal(workspace.getDocument().layerTracks.length, trackCount + 1, 'a locked Layer Track cannot be deleted');
    creatorClick(workspace, 'toggle-track-lock', { trackId: unusedTrack });
    assert.equal(workspace.getDocument().layerTracks.find((track) => track.id === unusedTrack).locked, false);
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

    const styleBeforeColorLink = workspace.selectedCreatorRecords().style;
    const originalStyleAssetId = styleBeforeColorLink.assetId;
    assert.equal(document.colorChannels[0].mode, 'gradient-map');
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-channel' }, value: channelId, type: 'select-one' },
    });
    const styleAfterColorLink = workspace.selectedCreatorRecords().style;
    assert.equal(styleAfterColorLink.colorChannelId, channelId);
    assert.equal(styleAfterColorLink.assetId, originalStyleAssetId, 'Smart Color recolors the Style single PNG');
    assert.equal(Object.hasOwn(styleAfterColorLink, 'assetsBySwatch'), false);

    document = workspace.getDocument();
    const owner = document.parts[0];
    const target = document.parts[1];
    workspace.selectedPartId = owner.id;
    workspace.selectedItemId = owner.items[0].id;
    workspace.selectedStyleId = owner.items[0].styles[0]?.id || '';
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
  }, { playable: true });
});

test('whole Style lock blocks indirect rule, color-channel, and ordering mutations', async () => {
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-channel');
    let document = workspace.getDocument();
    const channelId = document.colorChannels[0].id;
    const part = document.parts[0];
    const item = part.items[0];
    const sourceStyleId = item.styles[0].id;
    const targetPartId = document.parts[1].id;

    creatorClick(workspace, 'select-part', { partId: part.id });
    creatorClick(workspace, 'select-item', { itemId: item.id });
    creatorClick(workspace, 'select-style', { styleId: sourceStyleId });
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-channel' }, value: channelId, type: 'select-one' },
    });
    creatorClick(workspace, 'copy-style');
    const copiedStyleId = workspace.selectedCreatorRecords().style.id;

    creatorClick(workspace, 'select-style', { styleId: sourceStyleId });
    workspace.creatorRoot = new FakeRoot({
      '#v4RuleOwnerDefinition': { value: `${part.id}::${item.id}::${sourceStyleId}` },
      '#v4RuleType': { value: 'excludes' },
      '#v4RuleTargetDefinition': { value: targetPartId },
    });
    workspace.addRuleFromBuilder();
    assert.equal(workspace.selectedCreatorRecords().style.excludes.length, 1);

    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-locked' }, checked: true, type: 'checkbox' },
    });
    workspace.deleteRule(`style:${part.id}:${item.id}:${sourceStyleId}:excludes:0`);
    assert.equal(workspace.selectedCreatorRecords().style.excludes.length, 1, 'locked Style rule cannot be deleted');

    workspace.creatorRoot.selectors['#v4RuleType'].value = 'requires';
    workspace.addRuleFromBuilder();
    assert.equal(workspace.selectedCreatorRecords().style.requires.length, 0, 'locked Style rule cannot be added');

    workspace.selectedChannelId = channelId;
    creatorClick(workspace, 'delete-channel');
    document = workspace.getDocument();
    assert.equal(document.colorChannels.some((channel) => channel.id === channelId), true);
    assert.equal(document.parts[0].items[0].styles[0].colorChannelId, channelId);

    const originalStyleOrder = document.parts[0].items[0].styles.map((style) => style.id);
    workspace.dragSort = {
      kind: 'style',
      id: copiedStyleId,
      parentId: `${part.id}/${item.id}`,
    };
    const dropTarget = {
      dataset: {
        dragKind: 'style',
        dragId: sourceStyleId,
        parentId: `${part.id}/${item.id}`,
      },
    };
    dropTarget.closest = () => dropTarget;
    workspace.handleDrop({ target: dropTarget, preventDefault() {} });
    assert.deepEqual(workspace.getDocument().parts[0].items[0].styles.map((style) => style.id), originalStyleOrder);

    let prevented = false;
    workspace.handleDragStart({
      target: dropTarget,
      preventDefault() { prevented = true; },
      dataTransfer: {
        setData() {},
        set effectAllowed(_) {},
      },
    });
    assert.equal(prevented, true);
    assert.equal(workspace.dragSort, null);
  }, { playable: true });
});

test('player controls select, undo, redo, clear, randomize, edit profile and complete an OC', async () => {
  const completed = [];
  await withWorkspace(async (workspace) => {
    const part = workspace.getDocument().parts.find((candidate) => !candidate.required);
    workspace.selectedPartId = part.id;
    workspace.ensureCreatorSelection(workspace.getDocument());
    creatorClick(workspace, 'add-item');
    creatorClick(workspace, 'add-style');
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'item-status' }, value: 'public', type: 'select-one' },
    });
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
    workspace.playerCompletionIssues = () => [];
    playerClick(workspace, 'player-complete');
    assert.equal(completed.length, 1);
  }, { playable: true, callbacks: { onCompleteOc: (payload) => completed.push(payload) } });
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
