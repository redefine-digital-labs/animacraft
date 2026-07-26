import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { synchronizeDefaultRecipe } from '../maker-document-ops.js';
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

class FakeEventNode {
  constructor({ width = 1024, height = 1024 } = {}) {
    this.dataset = {};
    this.style = {};
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.captureCount = 0;
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
    this.rect = { left: 0, top: 0, width, height };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    const next = {
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      preventDefault() {},
      ...event,
    };
    [...(this.listeners.get(type) || [])].forEach((listener) => listener(next));
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setPointerCapture() {
    this.captureCount += 1;
  }
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
  const { playable = false, prepareDocument = null, ...workspaceOptions } = options;
  const workspace = createMakerWorkspace(workspaceOptions);
  try {
    const document = createCharacterMakerV5Starter({ makerId: `qa-${Math.random()}`, name: 'QA Maker' });
    if (playable) {
      document.parts.forEach((part, index) => {
        const item = part.items[0];
        const selectedStyle = item.styles[0];
        selectedStyle.layerTrackId = document.layerTracks[index].id;
        selectedStyle.assetId = `${part.id}-art`;
        selectedStyle.positionConfirmed = true;
        item.status = 'public';
        document.assets.push({
          id: selectedStyle.assetId,
          identifier: `${selectedStyle.assetId}.png`,
          kind: 'layer',
          mediaType: 'image/png',
          width: 1024,
          height: 1024,
          url: `memory://${selectedStyle.assetId}`,
        });
      });
      synchronizeDefaultRecipe(document);
    }
    if (typeof prepareDocument === 'function') {
      prepareDocument(document);
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
    assert.match(creatorRoot.innerHTML, /data-action="style-x"/);
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
    assert.match(creatorRoot.innerHTML, /data-action="style-x" readonly aria-readonly="true"/);
    await workspace.handleCreatorChange({ target: { dataset: { action: 'style-x' }, value: '99', type: 'number' } });
    assert.equal(workspace.selectedCreatorRecords().style.transform.x, 18.5);
  }, { creatorRoot });
});

test('Canvas drag only moves a Style while its explicit position editor is open', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const canvas = new FakeEventNode();
    creatorRoot.selectors['#makerV4CreatorCanvas'] = canvas;
    workspace.attachCanvasDrag();

    const before = structuredClone(workspace.selectedCreatorRecords().style.transform);
    canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    assert.equal(canvas.captureCount, 0, 'confirmed position must reject direct Canvas dragging');

    delete creatorRoot.selectors['#makerV4CreatorCanvas'];
    creatorClick(workspace, 'edit-position');
    creatorRoot.selectors['#makerV4CreatorCanvas'] = canvas;
    canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    assert.equal(canvas.captureCount, 1, 'Adjust position explicitly enables direct Canvas dragging');
    canvas.dispatch('pointermove', { clientX: 125, clientY: 135 });
    canvas.dispatch('pointerup', { clientX: 125, clientY: 135 });
    assert.notDeepEqual(workspace.selectedCreatorRecords().style.transform, before);

    delete creatorRoot.selectors['#makerV4CreatorCanvas'];
    creatorClick(workspace, 'confirm-position');
    creatorRoot.selectors['#makerV4CreatorCanvas'] = canvas;
    canvas.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    assert.equal(canvas.captureCount, 1, 'Confirm position closes Canvas dragging again');
  }, { creatorRoot, playable: true });
});

test('uploading a full-canvas PNG still enters Adjust position until confirmed', async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  await withWorkspace(async (workspace) => {
    const makeCanvas = () => ({
      width: 0,
      height: 0,
      getContext() {
        return {
          clearRect() {},
          drawImage() {},
          getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
        };
      },
      toBlob(callback) { callback(new Blob(['thumbnail'], { type: 'image/png' })); },
    });
    globalThis.document = { createElement: () => makeCanvas() };
    globalThis.OffscreenCanvas = undefined;
    globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
    const file = new Blob(['full-canvas'], { type: 'image/png' });
    Object.defineProperty(file, 'name', { value: 'full-canvas.png' });
    const { part, item, style } = workspace.selectedCreatorRecords();
    workspace.editingPositionStyleKey = '';
    workspace.executeDocument('Confirm fixture position', ({ document }) => {
      const target = document.parts.find((entry) => entry.id === part.id)
        .items.find((entry) => entry.id === item.id)
        .styles.find((entry) => entry.id === style.id);
      target.positionConfirmed = true;
    });
    workspace.flushCompletedAssetOperation = async () => true;

    try {
      await workspace.replaceStyleAsset(file, { partId: part.id, itemId: item.id, styleId: style.id });
      const uploadedStyle = workspace.selectedCreatorRecords().style;
      assert.deepEqual(uploadedStyle.transform, { x: 0, y: 0, scale: 1, rotation: 0 });
      assert.equal(uploadedStyle.positionConfirmed, false);
      assert.equal(workspace.editingPositionStyleKey, `${part.id}/${item.id}/${style.id}`);
    } finally {
      globalThis.document = previousDocument;
      globalThis.createImageBitmap = previousBitmap;
      globalThis.OffscreenCanvas = previousOffscreenCanvas;
    }
  });
});

test('Creator Canvas wheel zoom and viewport pan never mutate Style coordinates', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const canvas = new FakeEventNode();
    const viewport = new FakeEventNode({ width: 500, height: 500 });
    const slider = { value: '100' };
    creatorRoot.selectors['#makerV4CreatorCanvas'] = canvas;
    creatorRoot.selectors['.v4-canvas-viewport'] = viewport;
    creatorRoot.selectors['[data-action="canvas-zoom"]'] = slider;
    const transformBefore = structuredClone(workspace.selectedCreatorRecords().style.transform);

    workspace.attachCanvasDrag();
    viewport.dispatch('wheel', { deltaY: -1, clientX: 250, clientY: 250 });
    assert.equal(workspace.creatorZoom, 1.1);
    assert.equal(canvas.style.width, '110%');
    assert.equal(slider.value, '110');

    const panStart = { left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.dispatch('pointerdown', { button: 1, clientX: 100, clientY: 100 });
    viewport.dispatch('pointermove', { button: 1, clientX: 75, clientY: 65 });
    viewport.dispatch('pointerup', { button: 1, clientX: 75, clientY: 65 });
    assert.equal(viewport.scrollLeft, panStart.left + 25);
    assert.equal(viewport.scrollTop, panStart.top + 35);

    workspace.boundCreatorKeydown({
      code: 'Space',
      key: ' ',
      target: { matches: () => false },
      preventDefault() {},
    });
    const spacePanStart = { left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.dispatch('pointerdown', { button: 0, clientX: 90, clientY: 90 });
    viewport.dispatch('pointermove', { button: 0, clientX: 80, clientY: 70 });
    viewport.dispatch('pointerup', { button: 0, clientX: 80, clientY: 70 });
    workspace.boundCreatorKeyup({ code: 'Space' });
    assert.equal(viewport.scrollLeft, spacePanStart.left + 10);
    assert.equal(viewport.scrollTop, spacePanStart.top + 20);
    assert.deepEqual(workspace.selectedCreatorRecords().style.transform, transformBefore);
  }, { creatorRoot, playable: true });
});

test('pixel mode exposes a grid and snaps edited coordinates to integers', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'toggle-pixel');
    assert.equal(workspace.getDocument().canvas.pixelMode, 'pixelated');
    assert.match(creatorRoot.innerHTML, /v4-canvas-viewport pixelated/);
    assert.match(creatorRoot.innerHTML, /data-action="style-x"[^>]*step="1"|step="1"[^>]*data-action="style-x"/);

    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-x' }, value: '18.6', type: 'number' },
    });
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-y' }, value: '-7.6', type: 'number' },
    });
    assert.equal(workspace.selectedCreatorRecords().style.transform.x, 19);
    assert.equal(workspace.selectedCreatorRecords().style.transform.y, -8);
  }, { creatorRoot });
});

test('Item batch import targets the empty default Style and one inherited Layer Track', async () => {
  await withWorkspace(async (workspace) => {
    const { part, item, style } = workspace.selectedCreatorRecords();
    await workspace.handleCreatorChange({
      target: {
        dataset: { action: 'batch-import' },
        files: [
          { name: 'black.png', type: 'image/png' },
          { name: 'blue-streak.png', type: 'image/png' },
        ],
      },
    });

    assert.equal(workspace.pendingImport.partId, part.id);
    assert.equal(workspace.pendingImport.itemId, item.id);
    assert.equal(workspace.pendingImport.defaultStyleId, style.id);
    assert.deepEqual(
      workspace.pendingImport.mapping.map((entry) => entry.trackId),
      [style.layerTrackId, style.layerTrackId],
    );
  });
});

test('Creator structure keeps Layer Tracks global and exposes a current Style breadcrumb', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const inheritedTrackId = workspace.selectedCreatorRecords().style.layerTrackId;
    creatorClick(workspace, 'add-style');

    assert.equal(workspace.selectedCreatorRecords().style.layerTrackId, inheritedTrackId);
    assert.match(creatorRoot.innerHTML, /data-action="style-x"/);
    assert.match(creatorRoot.innerHTML, /data-action="style-y"/);
    assert.match(creatorRoot.innerHTML, /data-action="style-scale"/);
    assert.match(creatorRoot.innerHTML, /data-action="style-rotation"/);
    assert.match(creatorRoot.innerHTML, /v4-inspector-context/);
    assert.match(creatorRoot.innerHTML, / › /);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="part-parent"/);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="item-import-key"/);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="item-status"/);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="generate-item-thumbnail"/);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="style-track"/);
  }, { creatorRoot });
});

test('Creator preview modes are mutually exclusive and fall back to Show all with fewer than two layers', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-style');

    assert.equal(workspace.creatorPreviewMode, 'all');
    assert.match(creatorRoot.innerHTML, /data-action="set-preview-mode" data-preview-mode="all" aria-pressed="true"/);
    assert.match(creatorRoot.innerHTML, /data-preview-mode="dim" aria-pressed="false" disabled/);
    assert.match(creatorRoot.innerHTML, /data-preview-mode="solo" aria-pressed="false" disabled/);

    creatorClick(workspace, 'set-preview-mode', { previewMode: 'dim' });
    assert.equal(workspace.creatorPreviewMode, 'all');
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="toggle-solo"/);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="toggle-dim"/);
  }, { creatorRoot });

  await withWorkspace(async (workspace) => {
    workspace.executeDocument('Make preview fixtures available', ({ document }) => {
      document.assets.forEach((asset) => { asset.url = `memory://${asset.id}`; });
    });
    creatorClick(workspace, 'set-preview-mode', { previewMode: 'dim' });
    assert.equal(workspace.creatorPreviewMode, 'dim');
    creatorClick(workspace, 'set-preview-mode', { previewMode: 'solo' });
    assert.equal(workspace.creatorPreviewMode, 'solo');
    creatorClick(workspace, 'set-preview-mode', { previewMode: 'all' });
    assert.equal(workspace.creatorPreviewMode, 'all');
  }, { playable: true });
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
    const copiedStyle = workspace.selectedCreatorRecords().style;
    assert.notEqual(copiedStyle.id, firstStyle.id);

    await workspace.handleCreatorChange({ target: { dataset: { action: 'style-x' }, value: '37', type: 'number' } });
    let document = workspace.getDocument();
    assert.equal(document.parts[0].items.find((item) => item.id === copiedItem.id).styles.find((style) => style.id === copiedStyle.id).transform.x, 37);
    assert.ok(document.parts[0].items.find((item) => item.id === firstItem.id).styles.every((style) => style.transform.x === 0));
    assert.ok(document.parts[1].items.find((item) => item.id === otherItem.id).styles.every((style) => style.transform.x === 0));

    creatorClick(workspace, 'confirm-position');
    document = workspace.getDocument();
    assert.equal(document.parts[0].items.find((item) => item.id === copiedItem.id).styles.find((style) => style.id === copiedStyle.id).positionConfirmed, true);
    assert.ok(document.parts[0].items.find((item) => item.id === firstItem.id).styles.every((style) => style.positionConfirmed === false));

    creatorClick(workspace, 'select-part', { partId: otherPart.id });
    creatorClick(workspace, 'select-item', { itemId: otherItem.id });
    creatorClick(workspace, 'select-style', { styleId: otherStyle.id });
    assert.equal(workspace.selectedCreatorRecords().style.id, otherStyle.id);
    await workspace.handleCreatorChange({ target: { dataset: { action: 'style-y' }, value: '-42', type: 'number' } });

    document = workspace.getDocument();
    assert.equal(document.parts[1].items.find((item) => item.id === otherItem.id).styles.find((style) => style.id === otherStyle.id).transform.y, -42);
    assert.ok(document.parts[0].items.find((item) => item.id === copiedItem.id).styles.every((style) => style.transform.y === 0));
    assert.ok(document.parts[0].items.find((item) => item.id === firstItem.id).styles.every((style) => style.transform.y === 0));
  });
});

test('returning to a Part restores the Item and Style selected in the Creator recipe', async () => {
  await withWorkspace(async (workspace) => {
    const firstPartId = workspace.getDocument().parts[0].id;
    const otherPartId = workspace.getDocument().parts[1].id;

    creatorClick(workspace, 'select-part', { partId: firstPartId });
    creatorClick(workspace, 'add-item');
    const chosenItem = workspace.selectedCreatorRecords().item;
    const chosenStyle = workspace.selectedCreatorRecords().style;
    const recipeSelection = workspace.creatorRecipe.selections.find((entry) => entry.partId === firstPartId);
    assert.equal(recipeSelection.itemId, chosenItem.id);
    assert.equal(recipeSelection.styleId, chosenStyle.id);

    creatorClick(workspace, 'select-part', { partId: otherPartId });
    creatorClick(workspace, 'select-part', { partId: firstPartId });
    assert.equal(workspace.selectedCreatorRecords().item.id, chosenItem.id);
    assert.equal(workspace.selectedCreatorRecords().style.id, chosenStyle.id);
    const restoredRecipeSelection = workspace.creatorRecipe.selections.find((entry) => entry.partId === firstPartId);
    assert.equal(restoredRecipeSelection.itemId, chosenItem.id);
    assert.equal(restoredRecipeSelection.styleId, chosenStyle.id);
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
    assert.equal(workspace.getDocument().layerTracks.find((track) => track.id === unusedTrack).locked, false);
    creatorClick(workspace, 'toggle-track-lock', { trackId: unusedTrack });
    creatorClick(workspace, 'delete-track', { trackId: unusedTrack });
    assert.equal(workspace.getDocument().layerTracks.length, trackCount + 1, 'a locked Layer Track cannot be deleted');
    creatorClick(workspace, 'toggle-track-lock', { trackId: unusedTrack });
    assert.equal(workspace.getDocument().layerTracks.find((track) => track.id === unusedTrack).locked, false);
    creatorClick(workspace, 'delete-track', { trackId: unusedTrack });
    assert.equal(workspace.getDocument().layerTracks.length, trackCount);
  });
});

test('Layer Track page assigns only the current Style and new Tracks start unlocked', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    assert.ok(workspace.getDocument().layerTracks.every((track) => track.locked === false));
    const { style } = workspace.selectedCreatorRecords();
    const originalTransform = structuredClone(style.transform);
    const targetTrack = workspace.getDocument().layerTracks.find((track) => track.id !== style.layerTrackId);

    workspace.creatorTab = 'layers';
    workspace.render();
    assert.match(creatorRoot.innerHTML, /data-action="assign-style-track"/);
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'assign-style-track' }, value: targetTrack.id, type: 'select-one' },
    });
    assert.equal(workspace.selectedCreatorRecords().style.layerTrackId, targetTrack.id);
    assert.deepEqual(workspace.selectedCreatorRecords().style.transform, originalTransform);

    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-locked' }, checked: true, type: 'checkbox' },
    });
    workspace.render();
    assert.match(creatorRoot.innerHTML, /data-action="assign-style-track" disabled/);
    const lockedTrackId = workspace.selectedCreatorRecords().style.layerTrackId;
    await workspace.handleCreatorChange({
      target: {
        dataset: { action: 'assign-style-track' },
        value: workspace.getDocument().layerTracks.find((track) => track.id !== lockedTrackId).id,
        type: 'select-one',
      },
    });
    assert.equal(workspace.selectedCreatorRecords().style.layerTrackId, lockedTrackId);
  }, { creatorRoot, playable: true });
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

test('advanced rule builder persists canonical ANY groups, ALL targets, and rejects cross-Part ANY', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    let document = workspace.getDocument();
    const owner = document.parts[0];
    const targetPart = document.parts[1];
    const otherPart = document.parts[2];
    const firstTargetItem = targetPart.items[0];
    workspace.executeDocument('Add advanced rule fixture', ({ document: next }) => {
      const target = next.parts.find((part) => part.id === targetPart.id);
      const alternate = structuredClone(target.items[0]);
      alternate.id = 'alternate-rule-target';
      alternate.name = 'Alternate rule target';
      alternate.importKey = alternate.id;
      alternate.displayOrder = 1;
      target.items.push(alternate);
    });
    document = workspace.getDocument();
    const alternateTargetItem = document.parts[1].items[1];
    creatorRoot.selectors = {
      '#v4RuleOwnerDefinition': { value: owner.id },
      '#v4RuleType': { value: 'requires' },
      '#v4RuleMatchMode': { value: 'any' },
      '#v4RuleTargetDefinitions': {
        selectedOptions: [
          { value: `${targetPart.id}::${alternateTargetItem.id}` },
          { value: `${targetPart.id}::${firstTargetItem.id}` },
        ],
      },
    };

    workspace.addRuleFromBuilder();
    assert.deepEqual(workspace.getDocument().parts[0].requires, [{
      partId: targetPart.id,
      itemIds: [alternateTargetItem.id, firstTargetItem.id].sort(),
    }]);

    creatorRoot.selectors['#v4RuleTargetDefinitions'].selectedOptions.reverse();
    workspace.addRuleFromBuilder();
    assert.equal(workspace.getDocument().parts[0].requires.length, 1, 'ANY identity is order independent');

    creatorRoot.selectors['#v4RuleTargetDefinitions'].selectedOptions = [
      { value: `${targetPart.id}::${firstTargetItem.id}` },
      { value: `${otherPart.id}::${otherPart.items[0].id}` },
    ];
    workspace.addRuleFromBuilder();
    assert.equal(workspace.getDocument().parts[0].requires.length, 1);
    assert.equal(workspace.ruleBuilderError, workspace.tr('ruleAnySamePartError'));

    creatorRoot.selectors['#v4RuleMatchMode'].value = 'all';
    workspace.addRuleFromBuilder();
    assert.equal(workspace.getDocument().parts[0].requires.length, 3);
    assert.equal(workspace.ruleBuilderError, '');

    workspace.creatorTab = 'rules';
    workspace.render();
    assert.match(creatorRoot.innerHTML, /<b>ALL required<\/b>/);
    assert.match(creatorRoot.innerHTML, /<em>ANY<\/em>/);
    assert.match(creatorRoot.innerHTML, /Alternate rule target/);
  }, { creatorRoot, playable: true });
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

test('a color channel referenced by a fully locked Style cannot be edited indirectly', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-channel');
    creatorClick(workspace, 'add-swatch');
    const channelId = workspace.selectedChannelId;
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-channel' }, value: channelId, type: 'select-one' },
    });
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-locked' }, checked: true, type: 'checkbox' },
    });
    workspace.creatorTab = 'colors';
    workspace.render();

    assert.match(creatorRoot.innerHTML, /data-action="channel-name" disabled/);
    assert.match(creatorRoot.innerHTML, /data-action="add-swatch" disabled/);
    const before = structuredClone(workspace.getDocument().colorChannels.find((channel) => channel.id === channelId));
    const alternateSwatch = before.swatches.find((swatch) => swatch.id !== before.defaultSwatchId) || before.swatches[0];

    await workspace.handleCreatorChange({
      target: { dataset: { action: 'channel-name' }, value: 'Must not change', type: 'text' },
    });
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'channel-default-swatch' }, value: alternateSwatch.id, type: 'radio' },
    });
    await workspace.handleCreatorChange({
      target: {
        dataset: { action: 'swatch-hint', swatchId: before.swatches[0].id },
        value: '#000000',
        type: 'color',
      },
    });
    creatorClick(workspace, 'add-swatch');
    creatorClick(workspace, 'delete-swatch', { swatchId: before.swatches[0].id });
    creatorClick(workspace, 'delete-channel');

    assert.deepEqual(
      workspace.getDocument().colorChannels.find((channel) => channel.id === channelId),
      before,
    );
  }, { creatorRoot, playable: true });
});

test('player controls select, undo, redo, clear, randomize, edit profile and complete an OC', async () => {
  const completed = [];
  await withWorkspace(async (workspace) => {
    const part = workspace.getDocument().parts.find((candidate) => !candidate.required);
    workspace.selectedPartId = part.id;
    workspace.ensureCreatorSelection(workspace.getDocument());
    creatorClick(workspace, 'add-item');
    creatorClick(workspace, 'add-style');
    const nextItem = workspace.selectedCreatorRecords().item;
    const playableStyleId = workspace.selectedCreatorRecords().style.id;
    workspace.executeDocument('Make the new Item playable', ({ document }) => {
      const targetPart = document.parts.find((candidate) => candidate.id === part.id);
      const targetItem = targetPart.items.find((candidate) => candidate.id === nextItem.id);
      const targetStyle = targetItem.styles.find((candidate) => candidate.id === playableStyleId);
      targetStyle.assetId = `${part.id}-art`;
      targetStyle.layerTrackId = document.layerTracks.find((track) => track.id === targetPart.items[0].styles[0].layerTrackId)?.id
        || document.layerTracks[0].id;
      targetStyle.positionConfirmed = true;
    });

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

test('Player hides empty Styles, chooses a drawable alternative, and blocks incompatible clicks', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const part = document.parts.find((candidate) => !candidate.required);
    const conflictingPart = document.parts.find((candidate) => candidate.id !== part.id);
    const conflictingSelection = workspace.playerRecipe.selections.find((selection) => selection.partId === conflictingPart.id);
    const sourceItem = part.items[0];
    const sourceStyle = sourceItem.styles[0];
    workspace.executeDocument('Add Player option fixtures', ({ document: next }) => {
      const targetPart = next.parts.find((candidate) => candidate.id === part.id);
      const alternativeItem = structuredClone(sourceItem);
      alternativeItem.id = 'alternative-item';
      alternativeItem.name = 'Alternative item';
      alternativeItem.defaultStyleId = 'empty-default';
      alternativeItem.styles = [
        {
          ...structuredClone(sourceStyle),
          id: 'empty-default',
          name: 'Empty default',
          assetId: null,
        },
        {
          ...structuredClone(sourceStyle),
          id: 'drawable-style',
          name: 'Drawable style',
        },
      ];
      const blockedItem = structuredClone(sourceItem);
      blockedItem.id = 'blocked-item';
      blockedItem.name = 'Blocked item';
      blockedItem.defaultStyleId = 'blocked-style';
      blockedItem.styles[0].id = 'blocked-style';
      blockedItem.excludes = [{
        partId: conflictingPart.id,
        itemId: conflictingSelection.itemId,
      }];
      targetPart.items.push(alternativeItem, blockedItem);
    });

    workspace.playerPartId = part.id;
    workspace.renderPlayer();
    assert.doesNotMatch(playerRoot.innerHTML, />Empty default</);
    assert.match(playerRoot.innerHTML, /data-item-id="blocked-item" disabled/);

    playerClick(workspace, 'player-item', { itemId: 'alternative-item' });
    const selected = workspace.playerRecipe.selections.find((selection) => selection.partId === part.id);
    assert.equal(selected.itemId, 'alternative-item');
    assert.equal(selected.styleId, 'drawable-style');

    const beforeBlockedClick = structuredClone(workspace.playerRecipe);
    playerClick(workspace, 'player-item', { itemId: 'blocked-item' });
    assert.deepEqual(workspace.playerRecipe, beforeBlockedClick);
  }, { playable: true, playerRoot });
});

test('Player disables individual and global removal when an optional Part is required', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const requiredPart = document.parts.find((part) => part.required);
    const optionalPart = document.parts.find((part) => !part.required);
    const requiredSelection = workspace.playerRecipe.selections
      .find((selection) => selection.partId === requiredPart.id);
    const optionalSelection = workspace.playerRecipe.selections
      .find((selection) => selection.partId === optionalPart.id);
    workspace.executeDocument('Require optional Player Part', ({ document: next }) => {
      const item = next.parts.find((part) => part.id === requiredPart.id).items
        .find((candidate) => candidate.id === requiredSelection.itemId);
      item.requires = [{
        partId: optionalPart.id,
        itemId: optionalSelection.itemId,
        styleId: optionalSelection.styleId,
      }];
    });
    workspace.playerPartId = optionalPart.id;
    workspace.renderPlayer();

    assert.match(playerRoot.innerHTML, /data-action="player-none"[^>]*disabled/);
    assert.match(playerRoot.innerHTML, /data-action="player-clear"[^>]*disabled/);
    assert.match(playerRoot.innerHTML, /Requires/);

    const before = structuredClone(workspace.playerRecipe);
    playerClick(workspace, 'player-none');
    assert.deepEqual(workspace.playerRecipe, before);
    playerClick(workspace, 'player-clear');
    assert.deepEqual(workspace.playerRecipe, before);
  }, { playable: true, playerRoot });
});

test('Player entry, reset, and random replace an empty default Style with playable artwork', async () => {
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const requiredPart = document.parts.find((part) => part.required);
    const item = requiredPart.items[0];
    const playableStyle = item.styles.find((style) => style.id === 'playable-alternative');

    assert.equal(
      workspace.playerRecipe.selections.find((selection) => selection.partId === requiredPart.id).styleId,
      playableStyle.id,
      'initial Player entry repairs the empty default Style',
    );

    workspace.playerRecipe = structuredClone(document.defaultRecipe);
    playerClick(workspace, 'player-reset');
    assert.equal(
      workspace.playerRecipe.selections.find((selection) => selection.partId === requiredPart.id).styleId,
      playableStyle.id,
      'Reset repairs the empty default Style',
    );

    for (let iteration = 0; iteration < 10; iteration += 1) {
      playerClick(workspace, 'player-random');
      workspace.playerRecipe.selections.forEach((selection) => {
        const selectedPart = document.parts.find((part) => part.id === selection.partId);
        const selectedItem = selectedPart.items.find((candidate) => candidate.id === selection.itemId);
        const selectedStyle = selectedItem.styles.find((candidate) => candidate.id === selection.styleId);
        assert.ok(selectedStyle.assetId, `${selection.partId} random selection must own a PNG`);
      });
    }
  }, {
    playable: true,
    prepareDocument(document) {
      const requiredPart = document.parts.find((part) => part.required);
      const item = requiredPart.items[0];
      const defaultStyle = item.styles.find((style) => style.id === item.defaultStyleId);
      const playableStyle = structuredClone(defaultStyle);
      playableStyle.id = 'playable-alternative';
      playableStyle.name = 'Playable alternative';
      item.styles.push(playableStyle);
      defaultStyle.assetId = null;
    },
  });
});

test('Creator preview availability resets for the same Maker before real Player use', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const part = document.parts[0];
    const source = part.items[0];
    workspace.executeDocument('Add preview-only Item', ({ document: next }) => {
      const targetPart = next.parts.find((candidate) => candidate.id === part.id);
      const previewOnly = structuredClone(source);
      previewOnly.id = 'preview-only';
      previewOnly.name = 'Preview only';
      previewOnly.status = 'private';
      targetPart.items.push(previewOnly);
    });

    workspace.setPlayerCreatorPreview(true);
    workspace.renderPlayer();
    assert.match(playerRoot.innerHTML, /Preview only/);

    await workspace.setContext({
      makerKey: workspace.makerKey,
      isPublished: true,
      creatorPreview: false,
    });
    assert.equal(workspace.playerCreatorPreview, false);
    assert.doesNotMatch(playerRoot.innerHTML, /Preview only/);
  }, { playable: true, playerRoot });
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
