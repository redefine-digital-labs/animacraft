import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCharacterMakerV5Starter } from '../maker-v4.js';
import { synchronizeDefaultRecipe } from '../maker-document-ops.js';
import { createMakerProjectArchive } from '../maker-project-archive.js';
import { resolveMakerScene } from '../maker-renderer.js';
import {
  createMakerWorkspace,
  enabledExpansionIdsForDocument,
} from '../maker-workspace.js';

class FakeRoot {
  constructor(selectors = {}) {
    this.innerHTML = '';
    this.selectors = selectors;
    this.addedListeners = [];
    this.removedListeners = [];
  }

  addEventListener(type, listener) {
    this.addedListeners.push([type, listener]);
  }

  removeEventListener(type, listener) {
    this.removedListeners.push([type, listener]);
  }

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

async function completePlayerThroughFinalPreview(workspace) {
  workspace.renderRecipeToBlob = async () => new Blob(['final-png'], { type: 'image/png' });
  playerClick(workspace, 'player-complete');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workspace.playerExportOpen, true);
  assert.equal(workspace.playerExportState, 'ready');
  playerClick(workspace, 'player-confirm-complete');
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
    const file = new Blob([
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      'full-canvas',
    ], { type: 'image/png' });
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
    assert.match(creatorRoot.innerHTML, /data-action="toggle-pixel" aria-pressed="true"/);
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
    const trackCountBeforePart = workspace.getDocument().layerTracks.length;
    creatorClick(workspace, 'add-part');
    let documentAfterPart = workspace.getDocument();
    assert.equal(documentAfterPart.parts.length, partCount + 1);
    const createdPart = documentAfterPart.parts.at(-1);
    assert.equal(createdPart.items.length, 1);
    assert.equal(createdPart.items[0].styles.length, 1);
    assert.ok(
      documentAfterPart.layerTracks.some(
        (track) => track.id === createdPart.items[0].styles[0].layerTrackId,
      ),
      'a new Part starts with its own linked Layer Track and default Item/Style',
    );
    assert.equal(documentAfterPart.layerTracks.length, trackCountBeforePart + 1);
    creatorClick(workspace, 'undo');
    assert.equal(workspace.getDocument().parts.length, partCount);
    assert.equal(workspace.getDocument().layerTracks.length, trackCountBeforePart);
    creatorClick(workspace, 'redo');
    documentAfterPart = workspace.getDocument();
    assert.equal(documentAfterPart.parts.length, partCount + 1);
    assert.equal(documentAfterPart.layerTracks.length, trackCountBeforePart + 1);

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

test('Maker Info tab edits the public Maker metadata used by Player and publication', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'creator-tab', { tab: 'info' });
    assert.equal(workspace.creatorTab, 'info');
    assert.match(creatorRoot.innerHTML, /Basic Maker information/);
    assert.match(creatorRoot.innerHTML, /data-action="maker-cover"/);
    assert.match(creatorRoot.innerHTML, /data-action="maker-name"/);
    assert.match(creatorRoot.innerHTML, /data-action="maker-creator"/);
    assert.match(creatorRoot.innerHTML, /data-action="maker-summary"/);
    assert.match(creatorRoot.innerHTML, /data-action="maker-style"/);
    assert.match(creatorRoot.innerHTML, /data-action="maker-license-kind"/);
    assert.match(creatorRoot.innerHTML, /data-action="maker-license-note"/);
    assert.match(creatorRoot.innerHTML, /Maker ID/);
    assert.match(creatorRoot.innerHTML, /1024 × 1024/);

    const textEdits = [
      ['maker-name', 'Moon Courier Maker'],
      ['maker-creator', 'Soul Atelier'],
      ['maker-summary', 'Build a courier from layered moonlit artwork.'],
      ['maker-style', 'Celestial night'],
      ['maker-license-note', 'Personal projects and credited sharing.'],
    ];
    textEdits.forEach(([action, value]) => {
      assert.equal(workspace.captureCreatorText({ dataset: { action }, value }), true);
      assert.equal(workspace.flushPendingCreatorText(), true);
    });
    await workspace.handleCreatorChange({
      target: {
        dataset: { action: 'maker-license-kind' },
        value: 'free-remix',
        type: 'select-one',
      },
    });

    const document = workspace.getDocument();
    assert.equal(document.metadata.name, 'Moon Courier Maker');
    assert.equal(document.metadata.creator, 'Soul Atelier');
    assert.equal(document.metadata.summary, 'Build a courier from layered moonlit artwork.');
    assert.equal(document.metadata.style, 'Celestial night');
    assert.equal(document.metadata.license.kind, 'free-remix');
    assert.equal(document.metadata.license.note, 'Personal projects and credited sharing.');
    assert.equal(workspace.store.getState().canUndo, true);

    workspace.render();
    assert.match(creatorRoot.innerHTML, /value="Moon Courier Maker"/);
    assert.match(creatorRoot.innerHTML, /value="Soul Atelier"/);
    assert.match(creatorRoot.innerHTML, /Build a courier from layered moonlit artwork\./);
    assert.match(creatorRoot.innerHTML, /<option value="free-remix" selected>/);
  }, { creatorRoot });
});

test('Maker Info reports UTF-8 byte overflow inline and Preflight opens the invalid metadata field', async () => {
  const creatorRoot = new FakeRoot();
  const statusClass = new Set();
  const statusOutput = {
    textContent: '',
    classList: {
      toggle(name, enabled) {
        if (enabled) statusClass.add(name);
        else statusClass.delete(name);
      },
    },
  };
  let focused = 0;
  creatorRoot.selectors['#makerInfoBytes-maker-name'] = statusOutput;
  creatorRoot.selectors['[data-action="maker-name"]'] = {
    focus() {
      focused += 1;
    },
  };

  await withWorkspace(async (workspace) => {
    workspace.setLocale('zh', { render: false });
    creatorClick(workspace, 'creator-tab', { tab: 'info' });

    const oversizedName = '界'.repeat(43);
    const attributes = new Map();
    const input = {
      dataset: { action: 'maker-name' },
      value: oversizedName,
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    };
    workspace.handleCreatorInput({ target: input });

    assert.equal(attributes.get('aria-invalid'), 'true');
    assert.equal(attributes.get('aria-describedby'), 'makerInfoBytes-maker-name');
    assert.equal(statusOutput.textContent, '129 / 128 UTF-8 字节 · 超过发布上限 1 字节');
    assert.equal(statusClass.has('invalid'), true);
    assert.equal(workspace.flushPendingCreatorText(), true);

    workspace.render();
    assert.match(
      creatorRoot.innerHTML,
      /data-action="maker-name"[^>]*aria-invalid="true"/,
    );
    assert.match(
      creatorRoot.innerHTML,
      /data-maker-byte-status="maker-name" class="v4-maker-info-byte-status invalid">129 \/ 128 UTF-8 字节 · 超过发布上限 1 字节<\/small>/,
    );

    creatorClick(workspace, 'creator-tab', { tab: 'validate' });
    assert.match(
      creatorRoot.innerHTML,
      /data-action="focus-issue" data-issue-path="metadata\.name"/,
      'metadata validation failures must provide a direct route back to Maker Info',
    );

    creatorClick(workspace, 'focus-issue', { issuePath: 'metadata.name' });
    assert.equal(workspace.creatorTab, 'info');
    assert.equal(focused, 1, 'the invalid Maker name control must receive focus');
  }, { creatorRoot });
});

test('Creator and Player Maker Info dialogs expose labels, trap focus, close on Escape, and restore focus', async () => {
  class FocusNode {
    constructor(name, active, children = []) {
      this.name = name;
      this.active = active;
      this.children = children;
      this.hidden = false;
      this.focusCount = 0;
    }

    focus() {
      this.focusCount += 1;
      this.active.current = this;
    }

    querySelectorAll() {
      return this.children;
    }

    contains(node) {
      return node === this || this.children.includes(node);
    }

    getAttribute() {
      return null;
    }
  }

  const previousDocument = globalThis.document;
  const active = { current: null };
  const creatorRoot = new FakeRoot();
  const playerRoot = new FakeRoot();
  const creatorClose = new FocusNode('creator-info-close', active);
  const creatorLastField = new FocusNode('creator-info-last-field', active);
  const creatorDialog = new FocusNode(
    'creator-info-dialog',
    active,
    [creatorClose, creatorLastField],
  );
  const creatorReturnTab = new FocusNode('creator-structure-tab', active);
  creatorRoot.selectors['#makerV4ToolDialog'] = creatorDialog;
  creatorRoot.selectors['.v4-tool-modal-backdrop [data-action="close-tool"]'] = creatorClose;
  creatorRoot.selectors['[data-action="creator-tab"][data-tab="structure"]'] = creatorReturnTab;

  const playerStart = new FocusNode('player-info-start', active);
  const playerDialog = new FocusNode('player-info-dialog', active, [playerStart]);
  const playerReturnButton = new FocusNode('player-info-return', active);
  playerRoot.selectors['#makerPlayerInfoDialog'] = playerDialog;
  playerRoot.selectors['[data-action="player-info"]'] = playerReturnButton;

  try {
    await withWorkspace(async (workspace) => {
      globalThis.document = {
        get activeElement() {
          return active.current;
        },
      };
      workspace.playerIntroOpen = false;

      creatorClick(workspace, 'creator-tab', { tab: 'info' });
      assert.equal(workspace.creatorTab, 'info');
      assert.match(
        creatorRoot.innerHTML,
        /id="makerV4ToolDialog"[^>]*role="dialog" aria-modal="true" aria-labelledby="makerV4ToolTitle" tabindex="-1"/,
      );
      assert.match(creatorRoot.innerHTML, /id="makerV4ToolTitle">QA Maker<\/strong>/);
      assert.match(creatorRoot.innerHTML, /Basic Maker information/);
      assert.equal(active.current, creatorClose, 'opening Maker Info must focus its close control');

      active.current = creatorLastField;
      let prevented = false;
      workspace.boundCreatorKeydown({
        key: 'Tab',
        shiftKey: false,
        preventDefault: () => { prevented = true; },
      });
      assert.equal(prevented, true);
      assert.equal(active.current, creatorClose, 'Tab must wrap to the first Creator dialog control');

      active.current = creatorClose;
      workspace.boundCreatorKeydown({
        key: 'Tab',
        shiftKey: true,
        preventDefault() {},
      });
      assert.equal(active.current, creatorLastField, 'Shift+Tab must wrap to the last Creator dialog control');

      workspace.boundCreatorKeydown({
        key: 'Escape',
        preventDefault() {},
      });
      assert.equal(workspace.creatorTab, 'structure');
      assert.equal(active.current, creatorReturnTab, 'Escape must return focus to the Creator tools tab');

      playerClick(workspace, 'player-info');
      assert.equal(workspace.playerIntroOpen, true);
      assert.match(
        playerRoot.innerHTML,
        /id="makerPlayerInfoDialog"[^>]*role="dialog" aria-modal="true" aria-labelledby="makerPlayerInfoTitle" tabindex="-1"/,
      );
      assert.match(playerRoot.innerHTML, /<h2 id="makerPlayerInfoTitle">QA Maker<\/h2>/);
      assert.equal(active.current, playerDialog, 'opening Player Maker Info must focus the dialog');

      active.current = playerDialog;
      prevented = false;
      workspace.boundPlayerKeydown({
        key: 'Tab',
        shiftKey: true,
        preventDefault: () => { prevented = true; },
      });
      assert.equal(prevented, true);
      assert.equal(
        active.current,
        playerStart,
        'Shift+Tab from the initially focused Player dialog container must wrap to its last control',
      );

      active.current = playerStart;
      prevented = false;
      workspace.boundPlayerKeydown({
        key: 'Tab',
        shiftKey: false,
        preventDefault: () => { prevented = true; },
      });
      assert.equal(prevented, true);
      assert.equal(active.current, playerStart, 'the single Player dialog action must retain focus');

      workspace.boundPlayerKeydown({
        key: 'Escape',
        preventDefault() {},
      });
      assert.equal(workspace.playerIntroOpen, false);
      assert.equal(
        active.current,
        playerReturnButton,
        'Escape must return focus to the Player Maker Info trigger',
      );
    }, {
      creatorRoot,
      playerRoot,
      playable: true,
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('Maker cover import rejects executable or unsupported image formats before decoding', async () => {
  await withWorkspace(async (workspace) => {
    await assert.rejects(
      workspace.importDisplayAsset(
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }),
        'maker-cover',
        workspace.captureMakerOperation(),
      ),
      /PNG or JPEG/,
    );
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

test('Layer Track page exposes exact Part › Item › Style bindings and moves back/front in visual order', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.creatorTab = 'layers';
    workspace.render();
    const document = workspace.getDocument();
    const targetPart = document.parts[1];
    const targetItem = targetPart.items[0];
    const targetStyle = targetItem.styles[0];
    assert.match(creatorRoot.innerHTML, /Styles drawn on this track/);
    assert.match(
      creatorRoot.innerHTML,
      new RegExp(`${targetPart.name} › ${targetItem.name} › ${targetStyle.name}`),
    );

    creatorClick(workspace, 'select-style-binding', {
      partId: targetPart.id,
      itemId: targetItem.id,
      styleId: targetStyle.id,
    });
    assert.equal(workspace.selectedPartId, targetPart.id);
    assert.equal(workspace.selectedItemId, targetItem.id);
    assert.equal(workspace.selectedStyleId, targetStyle.id);
    assert.equal(workspace.selectedTrackId, targetStyle.layerTrackId);

    const originalOrder = workspace.getDocument().layerTracks.map((track) => track.id);
    const originalPartOrder = workspace.getDocument().parts.map((part) => part.id);
    const movingTrackId = originalOrder[1];
    const movingPartId = workspace.getDocument().parts.find((part) => (
      part.items.some((item) => item.styles.some((style) => style.layerTrackId === movingTrackId))
    )).id;
    creatorClick(workspace, 'move-track', { trackId: movingTrackId, direction: 'up' });
    assert.equal(workspace.getDocument().layerTracks[0].id, movingTrackId, 'up moves toward the back/top of the back-to-front list');
    assert.equal(workspace.getDocument().parts[0].id, movingPartId, 'a standard linked Track also moves its Player menu Part');
    creatorClick(workspace, 'move-track', { trackId: movingTrackId, direction: 'down' });
    assert.deepEqual(workspace.getDocument().layerTracks.map((track) => track.id), originalOrder);
    assert.deepEqual(workspace.getDocument().parts.map((part) => part.id), originalPartOrder);
  }, { creatorRoot, playable: true });
});

test('Player menu reordering moves standard Tracks atomically but preserves custom stacking', async () => {
  await withWorkspace(async (workspace) => {
    const original = workspace.getDocument();
    const movingPart = original.parts[1];
    const movingTrackId = movingPart.items[0].styles[0].layerTrackId;
    const originalTrackOrder = original.layerTracks.map((track) => track.id);

    creatorClick(workspace, 'move-part', { partId: movingPart.id, direction: 'up' });
    let document = workspace.getDocument();
    assert.equal(document.parts[0].id, movingPart.id);
    assert.equal(document.layerTracks[0].id, movingTrackId);

    creatorClick(workspace, 'undo');
    document = workspace.getDocument();
    assert.deepEqual(document.layerTracks.map((track) => track.id), originalTrackOrder);

    const lockedTrackId = document.parts[0].items[0].styles[0].layerTrackId;
    creatorClick(workspace, 'toggle-track-lock', { trackId: lockedTrackId });
    const blockedPartId = document.parts[1].id;
    creatorClick(workspace, 'move-part', { partId: blockedPartId, direction: 'up' });
    assert.deepEqual(
      workspace.getDocument().parts.map((part) => part.id),
      document.parts.map((part) => part.id),
      'crossing a locked linked Track cannot leave Part and Track order half-synchronized',
    );

    creatorClick(workspace, 'toggle-track-lock', { trackId: lockedTrackId });
    workspace.executeDocument('Insert locked custom Track divider', ({ document: next }) => {
      next.layerTracks.splice(1, 0, {
        id: 'locked-custom-divider',
        name: 'Locked custom divider',
        order: 1,
        locked: true,
        referenceAssetId: null,
      });
    });
    const dividedPartOrder = workspace.getDocument().parts.map((part) => part.id);
    creatorClick(workspace, 'move-part', { partId: blockedPartId, direction: 'up' });
    assert.deepEqual(
      workspace.getDocument().parts.map((part) => part.id),
      dividedPartOrder,
      'a linked Track also cannot cross a locked custom Track',
    );
  }, { playable: true });

  await withWorkspace(async (workspace) => {
    const before = workspace.getDocument();
    const sharedTrackId = before.parts[0].items[0].styles[0].layerTrackId;
    const customPartId = before.parts[1].id;
    workspace.executeDocument('Create explicit shared custom stacking', ({ document }) => {
      document.parts[1].items[0].styles[0].layerTrackId = sharedTrackId;
    });
    const customTrackOrder = workspace.getDocument().layerTracks.map((track) => track.id);
    creatorClick(workspace, 'move-part', { partId: customPartId, direction: 'up' });
    assert.equal(workspace.getDocument().parts[0].id, customPartId);
    assert.deepEqual(
      workspace.getDocument().layerTracks.map((track) => track.id),
      customTrackOrder,
      'shared/custom Tracks keep their explicit visual order',
    );
  }, { playable: true });
});

test('a fully locked Style protects its Track z-order across buttons, drag, sync, and linked Part reordering', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const initial = workspace.getDocument();
    const lockedPart = initial.parts[0];
    const lockedStyle = lockedPart.items[0].styles[0];
    const lockedTrackId = lockedStyle.layerTrackId;
    const movingPartId = initial.parts[1].id;
    const movingTrackId = initial.parts[1].items[0].styles[0].layerTrackId;
    const initialPartOrder = initial.parts.map((part) => part.id);
    const initialTrackOrder = initial.layerTracks.map((track) => track.id);

    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-locked' }, checked: true, type: 'checkbox' },
    });
    assert.equal(
      workspace.getDocument().layerTracks.find((track) => track.id === lockedTrackId).locked,
      false,
      'Style visual locking must not mutate the independent Track lock',
    );

    workspace.creatorTab = 'layers';
    workspace.render();
    assert.match(creatorRoot.innerHTML, /Contains a locked Style · visual order is protected/);
    assert.match(
      creatorRoot.innerHTML,
      new RegExp(`v4-track-row[^>]*draggable="false"[^>]*data-drag-id="${lockedTrackId}"`),
    );

    creatorClick(workspace, 'move-track', { trackId: movingTrackId, direction: 'up' });
    creatorClick(workspace, 'move-part', { partId: movingPartId, direction: 'up' });
    assert.deepEqual(workspace.getDocument().layerTracks.map((track) => track.id), initialTrackOrder);
    assert.deepEqual(workspace.getDocument().parts.map((part) => part.id), initialPartOrder);

    let dragPrevented = false;
    const lockedTrackTarget = {
      dataset: { dragKind: 'track', dragId: lockedTrackId },
      closest() { return this; },
    };
    workspace.handleDragStart({
      target: lockedTrackTarget,
      preventDefault() { dragPrevented = true; },
      dataTransfer: {
        setData() {},
        set effectAllowed(_) {},
      },
    });
    assert.equal(dragPrevented, true);
    assert.equal(workspace.dragSort, null);

    workspace.dragSort = { kind: 'track', id: movingTrackId, parentId: '' };
    workspace.handleDrop({ target: lockedTrackTarget, preventDefault() {} });
    assert.deepEqual(workspace.getDocument().layerTracks.map((track) => track.id), initialTrackOrder);

    creatorClick(workspace, 'toggle-track-lock', { trackId: lockedTrackId });
    assert.equal(workspace.getDocument().layerTracks.find((track) => track.id === lockedTrackId).locked, true);
    creatorClick(workspace, 'toggle-track-lock', { trackId: lockedTrackId });
    assert.equal(workspace.getDocument().layerTracks.find((track) => track.id === lockedTrackId).locked, false);

    workspace.executeDocument('Create linked order mismatch fixture', ({ document }) => {
      const [movedPart] = document.parts.splice(1, 1);
      document.parts.splice(0, 0, movedPart);
    });
    creatorClick(workspace, 'sync-linked-track-order');
    assert.deepEqual(
      workspace.getDocument().layerTracks.map((track) => track.id),
      initialTrackOrder,
      'sync cannot move or cross the Track that owns a fully locked Style',
    );
  }, { creatorRoot, playable: true });
});

test('direct Part, Item, and Style selection keeps the Layer Track context on the selected Style', async () => {
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const firstPart = document.parts[0];
    const targetPart = document.parts[1];
    const targetItem = targetPart.items[0];
    const targetStyle = targetItem.styles[0];
    assert.notEqual(firstPart.items[0].styles[0].layerTrackId, targetStyle.layerTrackId);

    workspace.selectedTrackId = firstPart.items[0].styles[0].layerTrackId;
    creatorClick(workspace, 'select-part', { partId: targetPart.id });
    assert.equal(workspace.selectedTrackId, targetStyle.layerTrackId);

    workspace.selectedTrackId = firstPart.items[0].styles[0].layerTrackId;
    creatorClick(workspace, 'select-item', { itemId: targetItem.id });
    assert.equal(workspace.selectedTrackId, targetStyle.layerTrackId);

    workspace.selectedTrackId = firstPart.items[0].styles[0].layerTrackId;
    creatorClick(workspace, 'select-style', { styleId: targetStyle.id });
    assert.equal(workspace.selectedTrackId, targetStyle.layerTrackId);
  }, { playable: true });
});

test('whole Style lock cannot be bypassed by deleting its parent Item or Part', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const { part, item } = workspace.selectedCreatorRecords();
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-locked' }, checked: true, type: 'checkbox' },
    });
    const partCount = workspace.getDocument().parts.length;
    const itemCount = workspace.selectedCreatorRecords().part.items.length;
    workspace.render();
    assert.match(creatorRoot.innerHTML, /data-action="delete-part" class="danger" disabled/);
    assert.match(creatorRoot.innerHTML, /data-action="delete-item" disabled/);

    creatorClick(workspace, 'delete-item');
    assert.equal(workspace.selectedCreatorRecords().part.items.length, itemCount);
    creatorClick(workspace, 'delete-part');
    assert.equal(workspace.getDocument().parts.length, partCount);
    assert.equal(workspace.selectedCreatorRecords().part.id, part.id);
    assert.equal(workspace.selectedCreatorRecords().item.id, item.id);
  }, { creatorRoot, playable: true });
});

test('workspace restore preserves legacy nested shorthand rules with the owner Part context', async () => {
  await withWorkspace(async (workspace) => {
    const part = workspace.getDocument().parts[0];
    const owner = part.items[0];
    const target = part.items[1];

    assert.deepEqual(owner.requires, [{
      partId: part.id,
      itemId: target.id,
      styleId: target.styles[0].id,
    }]);
    assert.equal(Object.hasOwn(owner, 'rules'), false);
  }, {
    prepareDocument(document) {
      const part = document.parts[0];
      const owner = part.items[0];
      const target = structuredClone(owner);
      target.id = `${part.id}-legacy-target`;
      target.name = 'Legacy target';
      target.importKey = target.id;
      target.styles[0].id = `${target.id}-style`;
      target.defaultStyleId = target.styles[0].id;
      part.items.push(target);
      owner.rules = {
        requires: [{ itemId: target.id, styleId: target.styles[0].id }],
      };
    },
  });
});

test('the Style visibility editor preserves imported advanced conditions until an explicit replacement or clear', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const { part, item, style } = workspace.selectedCreatorRecords();
    const condition = {
      op: 'any',
      conditions: [
        { op: 'selected', partId: workspace.getDocument().parts[1].id },
        { op: 'selected', partId: workspace.getDocument().parts[2].id },
      ],
    };
    workspace.executeDocument('Import advanced visibility', ({ document }) => {
      document.parts.find((candidate) => candidate.id === part.id)
        .items.find((candidate) => candidate.id === item.id)
        .styles.find((candidate) => candidate.id === style.id)
        .visibleWhen = structuredClone(condition);
    });
    workspace.render();
    assert.match(creatorRoot.innerHTML, /Advanced visibility condition/);
    assert.match(creatorRoot.innerHTML, /data-action="edit-style-visibility"/);
    assert.match(creatorRoot.innerHTML, /data-action="clear-style-visibility"/);
    assert.doesNotMatch(creatorRoot.innerHTML, /data-action="style-visible-when"/);

    await workspace.handleCreatorChange({
      target: {
        dataset: { action: 'style-visible-when' },
        value: workspace.getDocument().parts[3].id,
        type: 'select-one',
      },
    });
    assert.deepEqual(workspace.selectedCreatorRecords().style.visibleWhen, condition);

    creatorClick(workspace, 'edit-style-visibility');
    assert.equal(workspace.creatorTab, 'rules');
    assert.equal(workspace.rulesEditorIntent, 'visibility');
    assert.match(creatorRoot.innerHTML, /This existing complex condition stays unchanged/);
    assert.deepEqual(workspace.selectedCreatorRecords().style.visibleWhen, condition);

    creatorClick(workspace, 'clear-style-visibility');
    assert.equal(workspace.selectedCreatorRecords().style.visibleWhen, null);
  }, { creatorRoot, playable: true });
});

test('Style visibility can target an exact Item and rejects ambiguous or impossible conditions without losing the draft', async () => {
  const creatorRoot = new FakeRoot();
  creatorRoot.querySelectorAll = (selector) => (
    selector === '[data-visibility-target]:checked'
      ? creatorRoot.visibilityTargets || []
      : []
  );
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const { part, item, style } = workspace.selectedCreatorRecords();
    const targetPart = document.parts.find((candidate) => candidate.id !== part.id && !candidate.required);
    const targetItem = targetPart.items[0];
    const definition = `${targetPart.id}::${targetItem.id}`;
    creatorRoot.visibilityTargets = [{ value: definition }];
    creatorRoot.selectors = {
      '#v4VisibilityMatchMode': { value: 'all' },
      '#v4VisibilityPolarity': { value: 'selected' },
    };

    workspace.applySelectedStyleVisibility();
    assert.deepEqual(workspace.selectedCreatorRecords().style.visibleWhen, {
      op: 'selected',
      partId: targetPart.id,
      itemId: targetItem.id,
    });

    creatorRoot.visibilityTargets = [
      { value: `${targetPart.id}::${targetPart.items[0].id}` },
      { value: `${targetPart.id}::${targetPart.items[1]?.id || targetPart.items[0].id}::${targetPart.items[0].styles[0].id}` },
    ];
    creatorRoot.selectors['#v4VisibilityMatchMode'].value = 'any';
    creatorRoot.selectors['#v4VisibilityPolarity'].value = 'not-selected';
    workspace.applySelectedStyleVisibility();
    assert.equal(workspace.visibilityBuilderError, workspace.tr('visibilityAnyNotSelectedError'));
    assert.equal(workspace.visibilityBuilderDraft.definitions.length, 2);
    assert.deepEqual(
      workspace.getDocument().parts.find((candidate) => candidate.id === part.id)
        .items.find((candidate) => candidate.id === item.id)
        .styles.find((candidate) => candidate.id === style.id)
        .visibleWhen,
      { op: 'selected', partId: targetPart.id, itemId: targetItem.id },
    );
  }, {
    creatorRoot,
    playable: true,
    prepareDocument(document) {
      const targetPart = document.parts.filter((candidate) => !candidate.required)[1];
      const alternate = structuredClone(targetPart.items[0]);
      alternate.id = `${targetPart.id}-alternate`;
      alternate.name = 'Alternate';
      alternate.styles[0].id = `${targetPart.id}-alternate-style`;
      targetPart.items.push(alternate);
    },
  });
});

test('Style visibility preview updates immediately and a locked Style disables the whole builder', async () => {
  const preview = { textContent: '' };
  const creatorRoot = new FakeRoot({
    '.v4-visibility-preview strong': preview,
  });
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const { part, item, style } = workspace.selectedCreatorRecords();
    const targetPart = document.parts.find((candidate) => candidate.id !== part.id && !candidate.required);
    const targetItem = targetPart.items[0];
    const definition = `${targetPart.id}::${targetItem.id}`;
    workspace.visibilityBuilderDraft = {
      styleKey: `${part.id}/${item.id}/${style.id}`,
      logic: 'all',
      polarity: 'selected',
      definitions: [],
    };

    await workspace.handleCreatorChange({
      target: {
        dataset: { action: 'visibility-target-choice' },
        value: definition,
        checked: true,
      },
    });
    assert.match(preview.textContent, new RegExp(targetPart.name));
    assert.match(preview.textContent, new RegExp(targetItem.name));

    await workspace.handleCreatorChange({
      target: {
        dataset: { action: 'visibility-polarity-choice' },
        value: 'not-selected',
      },
    });
    assert.match(preview.textContent, /not selected|none (?:of|are)/i);

    workspace.executeDocument('Lock Style', ({ document: next }) => {
      next.parts.find((candidate) => candidate.id === part.id)
        .items.find((candidate) => candidate.id === item.id)
        .styles.find((candidate) => candidate.id === style.id)
        .styleLocked = true;
    });
    workspace.creatorTab = 'rules';
    workspace.rulesEditorIntent = 'visibility';
    workspace.render();
    assert.match(creatorRoot.innerHTML, /id="v4VisibilityLockedHint"/);
    assert.match(
      creatorRoot.innerHTML,
      /<fieldset class="v4-visibility-builder" disabled aria-describedby="v4VisibilityLockedHint">/,
    );
  }, { creatorRoot, playable: true });
});

test('unresolved legacy rules are visible in Rules and lead directly to publication preflight', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.creatorTab = 'rules';
    workspace.render();
    assert.match(creatorRoot.innerHTML, /Legacy rules need repair/);
    assert.match(creatorRoot.innerHTML, /Found 2 legacy rule/);
    assert.match(creatorRoot.innerHTML, /data-action="review-rule-preflight"/);
    assert.equal(
      workspace.getDocument().extensions.unresolvedLegacyRules.rules.length,
      2,
    );
    assert.equal(
      workspace.getDocument().extensions.unresolvedLegacyRules.issues.length,
      2,
    );

    creatorClick(workspace, 'review-rule-preflight');
    assert.equal(workspace.creatorTab, 'validate');
    assert.ok(workspace.blockingPublicationIssues().some(
      (issue) => issue.code === 'release_unresolved-legacy-maker-rules',
    ));
    assert.match(creatorRoot.innerHTML, /Preflight/);
  }, {
    creatorRoot,
    playable: true,
    prepareDocument(document) {
      document.extensions.unresolvedLegacyRules = {
        rules: [{
          id: 'stored-ambiguous-legacy-rule',
          type: 'excludes',
          trigger: { itemId: 'stored-missing-owner-part' },
          targets: [{ partId: document.parts[2].id }],
        }],
        issues: [],
      };
      document.rules = [{
        id: 'ambiguous-legacy-rule',
        type: 'requires',
        trigger: { itemId: 'missing-owner-part' },
        targets: [{ partId: document.parts[1].id }],
      }];
    },
  });
});

test('draft owners may prepare draft-target rules while public owners remain publication-safe', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const ownerPart = document.parts.find((part) => !part.required);
    const targetPart = document.parts.find((part) => part.id !== ownerPart.id && !part.required);
    const ownerItem = ownerPart.items[0];
    const ownerStyle = ownerItem.styles[0];
    const targetItem = targetPart.items[0];
    const ownerDefinition = `${ownerPart.id}::${ownerItem.id}::${ownerStyle.id}`;
    const targetDefinition = `${targetPart.id}::${targetItem.id}`;
    creatorRoot.selectors = {
      '#v4RuleOwnerDefinition': { value: ownerDefinition },
      '#v4RuleType': { value: 'requires' },
      '#v4RuleMatchMode': { value: 'all' },
      '#v4RuleTargetDefinitions': {
        selectedOptions: [{ value: targetDefinition }],
      },
    };

    workspace.executeDocument('Prepare draft relationship', ({ document: next }) => {
      next.parts.find((part) => part.id === ownerPart.id)
        .items.find((item) => item.id === ownerItem.id).status = 'draft';
      next.parts.find((part) => part.id === targetPart.id)
        .items.find((item) => item.id === targetItem.id).status = 'draft';
    });
    workspace.addRuleFromBuilder();
    assert.deepEqual(
      workspace.getDocument().parts.find((part) => part.id === ownerPart.id)
        .items.find((item) => item.id === ownerItem.id)
        .styles.find((style) => style.id === ownerStyle.id).requires,
      [{ partId: targetPart.id, itemId: targetItem.id }],
    );

    workspace.executeDocument('Publish owner only', ({ document: next }) => {
      const owner = next.parts.find((part) => part.id === ownerPart.id)
        .items.find((item) => item.id === ownerItem.id);
      owner.status = 'public';
      owner.styles.find((style) => style.id === ownerStyle.id).requires = [];
    });
    workspace.addRuleFromBuilder();
    assert.equal(workspace.ruleBuilderError, workspace.tr('ruleUnpublishedTargetError'));
    assert.equal(
      workspace.getDocument().parts.find((part) => part.id === ownerPart.id)
        .items.find((item) => item.id === ownerItem.id)
        .styles.find((style) => style.id === ownerStyle.id).requires.length,
      0,
    );
  }, { creatorRoot, playable: true });
});

test('Combination Rules keep a failed builder draft and block empty, same-Part, always-true, and impossible targets', async () => {
  const creatorRoot = new FakeRoot();
  creatorRoot.querySelectorAll = (selector) => (
    selector === '[data-rule-target]:checked'
      ? creatorRoot.ruleTargets || []
      : []
  );
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const ownerPart = document.parts.find((part) => !part.required);
    const ownerItem = ownerPart.items[0];
    const ownerStyle = ownerItem.styles[0];
    const ownerDefinition = `${ownerPart.id}::${ownerItem.id}::${ownerStyle.id}`;
    creatorRoot.selectors = {
      '#v4RuleOwnerDefinition': { value: ownerDefinition },
      'input[name="v4-rule-type"]:checked': { value: 'requires' },
      '#v4RuleMatchMode': { value: 'all' },
    };

    creatorRoot.ruleTargets = [];
    workspace.addRuleFromBuilder();
    assert.equal(workspace.ruleBuilderError, workspace.tr('ruleChooseTargetError'));

    creatorRoot.ruleTargets = [{ value: `${ownerPart.id}::${ownerItem.id}` }];
    workspace.addRuleFromBuilder();
    assert.equal(workspace.ruleBuilderError, workspace.tr('ruleSamePartError'));
    assert.deepEqual(workspace.ruleBuilderDraft.definitions, [`${ownerPart.id}::${ownerItem.id}`]);

    const requiredPart = document.parts.find((part) => part.required);
    creatorRoot.ruleTargets = [{ value: requiredPart.id }];
    workspace.addRuleFromBuilder();
    assert.equal(workspace.ruleBuilderError, workspace.tr('ruleRequiredPartTargetError'));

    const targetPart = document.parts.find((part) => part.id !== ownerPart.id && !part.required);
    creatorRoot.ruleTargets = targetPart.items.slice(0, 2).map((targetItem) => ({
      value: `${targetPart.id}::${targetItem.id}`,
    }));
    workspace.addRuleFromBuilder();
    assert.equal(workspace.ruleBuilderError, workspace.tr('ruleImpossibleAllError'));
    assert.equal(workspace.ruleBuilderDraft.definitions.length, 2);
    assert.equal(workspace.selectedCreatorRecords().style.requires.length, 0);

    workspace.creatorTab = 'rules';
    workspace.render();
    assert.match(creatorRoot.innerHTML, /data-action="rule-owner-choice"/);
    assert.match(creatorRoot.innerHTML, /data-action="rule-target-choice"/);
    assert.match(creatorRoot.innerHTML, /disabled/);
  }, {
    creatorRoot,
    playable: true,
    prepareDocument(document) {
      const targetPart = document.parts.filter((part) => !part.required)[1];
      const alternate = structuredClone(targetPart.items[0]);
      alternate.id = `${targetPart.id}-rule-alternate`;
      alternate.name = 'Rule Alternate';
      alternate.styles[0].id = `${targetPart.id}-rule-alternate-style`;
      targetPart.items.push(alternate);
    },
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
    assert.deepEqual(
      workspace.getDocument().defaultRecipe.colors.find((entry) => entry.channelId === channelId),
      { channelId, swatchId: addedSwatch.id },
    );
    assert.deepEqual(
      workspace.store.getState().recipe.colors.find((entry) => entry.channelId === channelId),
      { channelId, swatchId: addedSwatch.id },
    );
    assert.deepEqual(
      workspace.getCreatorRecipe().colors.find((entry) => entry.channelId === channelId),
      { channelId, swatchId: addedSwatch.id },
    );
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
    assert.equal(document.expansionPacks[0].manifestIdentifier, 'animacraft-manifest.json');
    assert.deepEqual(document.expansionPacks[0].content, {
      kind: 'embedded',
      runtime: 'embedded-v1',
      container: 'extensions.expansionDrafts',
      packId,
    });
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

test('Creator primary color edits update the rendered gradient without an autosave rerender race', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-channel');
    workspace.creatorTab = 'colors';
    workspace.render();

    const channel = workspace.getDocument().colorChannels[0];
    const swatch = channel.swatches[0];
    const originalHint = swatch.hintColor;
    const target = {
      dataset: {
        action: 'swatch-hint',
        channelId: channel.id,
        swatchId: swatch.id,
      },
      value: '#22aa66',
      type: 'color',
    };

    workspace.handleCreatorInput({ target });
    assert.equal(
      workspace.getDocument().colorChannels[0].swatches[0].hintColor,
      originalHint,
      'native picker input remains a preview until the interaction commits',
    );
    assert.deepEqual(workspace.pendingSmartColorEdit, {
      action: 'swatch-hint',
      channelId: channel.id,
      swatchId: swatch.id,
      stopIndex: '',
      value: '#22aa66',
    });

    const markupBeforeAutosave = creatorRoot.innerHTML;
    workspace.store.setSaveState('saving', 'Saving…');
    assert.equal(
      creatorRoot.innerHTML,
      markupBeforeAutosave,
      'save-state notifications must not replace the open native color picker',
    );

    await workspace.handleCreatorChange({ target });
    const updated = workspace.getDocument().colorChannels[0].swatches[0];
    assert.equal(updated.hintColor, '#22aa66');
    assert.deepEqual(updated.stops, [
      { offset: 0, color: '#061f12' },
      { offset: 0.5, color: '#22aa66' },
      { offset: 1, color: '#ceecdd' },
    ]);
    assert.equal(workspace.pendingSmartColorEdit, null);
    assert.match(
      creatorRoot.innerHTML,
      /value="#22aa66"[^>]*data-action="swatch-hint"/,
      'the committed primary color stays visible after the Creator rerender',
    );
  }, { creatorRoot, playable: true });
});

test('deleting Smart Color definitions repairs Creator, stored, and Player Recipes', async () => {
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-channel');
    creatorClick(workspace, 'add-swatch');
    const channel = workspace.getDocument().colorChannels[0];
    const removedSwatch = channel.swatches.at(-1);
    const fallbackSwatch = channel.swatches[0];
    const colorSelection = { channelId: channel.id, swatchId: removedSwatch.id };
    workspace.creatorRecipe.colors = [structuredClone(colorSelection)];
    workspace.playerRecipe.colors = [structuredClone(colorSelection)];
    workspace.store.execute('Choose temporary color', (next) => {
      next.recipe.colors = [structuredClone(colorSelection)];
    });

    creatorClick(workspace, 'delete-swatch', { swatchId: removedSwatch.id });
    assert.deepEqual(workspace.creatorRecipe.colors, [{
      channelId: channel.id,
      swatchId: fallbackSwatch.id,
    }]);
    assert.deepEqual(workspace.store.getState().recipe.colors, [{
      channelId: channel.id,
      swatchId: fallbackSwatch.id,
    }]);
    assert.deepEqual(workspace.playerRecipe.colors, [{
      channelId: channel.id,
      swatchId: fallbackSwatch.id,
    }]);

    creatorClick(workspace, 'delete-channel');
    assert.deepEqual(workspace.creatorRecipe.colors, []);
    assert.deepEqual(workspace.store.getState().recipe.colors, []);
    assert.deepEqual(workspace.playerRecipe.colors, []);
  }, { playable: true });
});

test('Expansion Item copies rewrite Item self references instead of pointing back to base content', async () => {
  await withWorkspace(async (workspace) => {
    const { part, item, style } = workspace.selectedCreatorRecords();
    workspace.executeDocument('Add self-referencing Item fixture', ({ document }) => {
      const target = document.parts.find((candidate) => candidate.id === part.id)
        .items.find((candidate) => candidate.id === item.id);
      target.requires = [{ partId: part.id, itemId: item.id }];
      target.styles.find((candidate) => candidate.id === style.id).visibleWhen = {
        op: 'selected',
        partId: part.id,
        itemId: item.id,
        styleId: style.id,
      };
    });
    creatorClick(workspace, 'add-expansion');
    const packId = workspace.getDocument().extensions.expansionDrafts[0].packId;
    creatorClick(workspace, 'add-selected-to-expansion', { packId });

    const copy = workspace.getDocument().extensions.expansionDrafts[0].parts[0].items[0];
    assert.notEqual(copy.id, item.id);
    assert.equal(copy.importKey, copy.id);
    assert.equal(copy.requires[0].itemId, copy.id);
    assert.equal(copy.styles[0].visibleWhen.itemId, copy.id);
    assert.equal(copy.styles[0].visibleWhen.styleId, style.id);
  }, { playable: true });
});

test('deleting a Style prunes embedded visibility/rules and global rules that target it', async () => {
  await withWorkspace(async (workspace) => {
    const document = workspace.getDocument();
    const ownerPart = document.parts[0];
    const targetPart = document.parts[1];
    const targetItem = targetPart.items[0];
    const targetStyle = targetItem.styles[0];
    const selector = {
      partId: targetPart.id,
      itemId: targetItem.id,
      styleId: targetStyle.id,
    };
    workspace.executeDocument('Add deletion reference fixtures', ({ document: next }) => {
      const owner = next.parts.find((part) => part.id === ownerPart.id);
      owner.requires = [structuredClone(selector)];
      owner.visibleWhen = { op: 'selected', ...structuredClone(selector) };
      next.rules = [{
        id: 'global-target-rule',
        type: 'requires',
        trigger: { partId: owner.id },
        targets: [structuredClone(selector)],
      }];
    });

    creatorClick(workspace, 'select-part', { partId: targetPart.id });
    creatorClick(workspace, 'select-item', { itemId: targetItem.id });
    creatorClick(workspace, 'select-style', { styleId: targetStyle.id });
    creatorClick(workspace, 'delete-style');

    const nextOwner = workspace.getDocument().parts.find((part) => part.id === ownerPart.id);
    assert.deepEqual(nextOwner.requires, []);
    assert.equal(nextOwner.visibleWhen, null);
    assert.deepEqual(workspace.getDocument().rules, []);
  }, { playable: true });
});

test('locked project-import targets are rejected before Blob records enter the save repository', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const { part, item, style } = workspace.selectedCreatorRecords();
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-locked' }, checked: true, type: 'checkbox' },
    });
    workspace.pendingImport = {
      mode: 'project',
      mapping: [{
        file: { name: 'locked.png', type: 'image/png' },
        fileName: 'locked.png',
        targetDefinition: `${part.id}::${item.id}::${style.id}`,
        trackId: style.layerTrackId,
        suggestedTrackName: 'Locked',
      }],
    };
    workspace.render();
    assert.match(
      creatorRoot.innerHTML,
      new RegExp(`value="${part.id}::${item.id}::${style.id}" selected disabled`),
    );
    const assetCount = workspace.assets.size;
    const assetId = style.assetId;
    await workspace.confirmBatchImport();
    assert.equal(workspace.assets.size, assetCount);
    assert.equal(workspace.selectedCreatorRecords().style.assetId, assetId);
    assert.equal(workspace.store.getState().saveState, 'error');
  }, { creatorRoot, playable: true });
});

test('Maker ZIP import re-inspects Style PNG pixels and blocks fully transparent artwork', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  try {
    await withWorkspace(async (workspace) => {
      class TransparentCanvas {
        constructor(width, height) {
          this.width = width;
          this.height = height;
        }

        getContext() {
          return {
            drawImage() {},
            getImageData: () => ({
              data: new Uint8ClampedArray(this.width * this.height * 4),
            }),
          };
        }
      }
      globalThis.OffscreenCanvas = TransparentCanvas;
      globalThis.createImageBitmap = async () => ({
        width: 2,
        height: 2,
        close() {},
      });
      workspace.flushCompletedAssetOperation = async () => true;

      creatorClick(workspace, 'add-expansion');
      const packId = workspace.getDocument().extensions.expansionDrafts[0].packId;
      creatorClick(workspace, 'add-selected-to-expansion', { packId });
      const document = workspace.getDocument();
      const pack = document.extensions.expansionDrafts[0];
      const style = pack.parts[0].items[0].styles[0];
      const assetId = 'transparent-zip-style';
      style.assetId = assetId;
      style.positionConfirmed = true;
      pack.assets = [{
        id: assetId,
        identifier: `${assetId}.png`,
        kind: 'layer',
        mediaType: 'image/png',
        width: 2,
        height: 2,
      }];
      const blob = new Blob([
        Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
        'not-real-pixels-in-test',
      ], { type: 'image/png' });
      const archive = await createMakerProjectArchive(document, new Map([[
        assetId,
        {
          assetId,
          blob,
          fileName: `${assetId}.png`,
          width: 999,
          height: 999,
          // Forged metadata must never bypass the import-time pixel inspection.
          alphaAnalyzed: false,
          hasVisiblePixels: true,
        },
      ]]));

      await workspace.importProjectArchive(archive);
      const imported = workspace.runtimeAsset(assetId);
      assert.equal(imported.width, 2);
      assert.equal(imported.height, 2);
      assert.equal(imported.alphaAnalyzed, true);
      assert.equal(imported.hasVisiblePixels, false);
      assert.ok(workspace.publicationIssues().some((issue) => (
        issue.code === 'transparent_public_style'
        && issue.path === `extensions.expansionDrafts.${packId}/${pack.parts[0].id}/${pack.parts[0].items[0].id}/${style.id}`
      )));
    }, { playable: true });
  } finally {
    globalThis.createImageBitmap = previousBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('Run Preflight invalidates cached rule analysis and blocking issues render as errors', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.executeDocument('Create blocking position fixture', ({ document: next }) => {
      next.parts[0].items[0].styles[0].positionConfirmed = false;
    });
    const document = workspace.store.getState().document;
    workspace.rulePreflightCache.set(document, [{
      code: 'cached-fake-blocker',
      path: 'rules',
      message: 'stale',
    }]);
    creatorClick(workspace, 'run-preflight');
    const refreshed = workspace.rulePreflightCache.get(document);
    assert.equal(refreshed.some((issue) => issue.code === 'cached-fake-blocker'), false);
    assert.match(creatorRoot.innerHTML, /v4-preflight-list/);
    assert.match(creatorRoot.innerHTML, /<li class="error">/);
  }, { creatorRoot, playable: true });
});

test('Preflight compiles the final Walrus manifest and Sui projection before upload', async () => {
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-channel');
    const channelId = workspace.getDocument().colorChannels[0].id;
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-channel' }, value: channelId, type: 'select-one' },
    });
    workspace.executeDocument('Create reserved release identifier conflict', ({ document }) => {
      document.metadata.creator = 'QA Creator';
      document.metadata.license.note = 'Personal use QA release.';
      const assetId = document.parts[0].items[0].styles[0].assetId;
      document.assets.find((asset) => asset.id === assetId).identifier = 'animacraft-chain-auxiliary.png';
    });
    const issue = workspace.publicationIssues().find((candidate) => (
      candidate.code === 'release_reserved-projection-auxiliary-identifier'
    ));
    assert.ok(issue, 'the Creator Preflight must catch a final Sui projection failure before Walrus upload');
    assert.equal(issue.path, 'publication.release');
  }, { playable: true });
});

test('Preflight validates the final Quilt bundle before Step 1', async () => {
  await withWorkspace(async (workspace) => {
    workspace.executeDocument('Prepare release metadata', ({ document }) => {
      document.metadata.creator = 'QA Creator';
      document.metadata.license.note = 'Personal use QA release.';
    });
    assert.equal(
      workspace.publicationIssues().some((issue) => issue.code.startsWith('release_')),
      false,
      'a complete playable Maker must pass the same bundle compiler used by Step 1',
    );

    workspace.executeDocument('Create reserved manifest identifier conflict', ({ document }) => {
      const assetId = document.parts[0].items[0].styles[0].assetId;
      document.assets.find((asset) => asset.id === assetId).identifier = 'animacraft-manifest.json';
    });
    assert.ok(
      workspace.publicationIssues().some((issue) => (
        issue.code === 'release_reserved-manifest-identifier'
        && issue.path === 'publication.release'
      )),
      'Preflight must reject the reserved manifest identifier before Step 1',
    );
  }, { playable: true });

  await withWorkspace(async (workspace) => {
    workspace.executeDocument('Add missing Part icon Blob fixture', ({ document }) => {
      document.metadata.creator = 'QA Creator';
      document.metadata.license.note = 'Personal use QA release.';
      const iconAssetId = 'part-icon-without-runtime';
      document.assets.push({
        id: iconAssetId,
        identifier: `${iconAssetId}.png`,
        kind: 'part-icon',
        mediaType: 'image/png',
        width: 64,
        height: 64,
      });
      document.parts[0].iconAssetId = iconAssetId;
    });
    assert.ok(
      workspace.publicationIssues().some((issue) => (
        issue.code === 'release_missing-runtime-asset'
        && issue.path === 'publication.release'
      )),
      'non-Style assets must have a real local Blob/File or a reloadable remote URL',
    );
  }, { playable: true });

  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-expansion');
    workspace.executeDocument('Fill the exact Walrus Quilt boundary', ({ document }) => {
      document.metadata.creator = 'QA Creator';
      document.metadata.license.note = 'Personal use QA release.';
      const pack = document.extensions.expansionDrafts[0];
      // Leave exactly 4,999 render assets after the generated cover. Because
      // this Maker has optional Parts, its required v2 auxiliary PNG plus the
      // manifest must make the real Quilt count 5,001 and fail Preflight.
      const expansionAssetCount = 4_999 - document.assets.length - 1;
      pack.assets = Array.from({ length: expansionAssetCount }, (_, index) => ({
        id: `quilt-boundary-${index}`,
        identifier: `quilt-boundary-${index}.png`,
        kind: 'expansion-asset',
        mediaType: 'image/png',
        width: 1,
        height: 1,
        url: `memory://quilt-boundary-${index}`,
      }));
    });
    assert.ok(
      workspace.publicationIssues().some((issue) => (
        issue.code === 'release_walrus-quilt-file-limit'
        && issue.path === 'publication.release'
      )),
      'Preflight must count the v2 auxiliary PNG and manifest in the 5,000-file Quilt limit',
    );
  }, { playable: true });
});

test('negative stress fixtures remain publication-blocked with localized guidance', async () => {
  const creatorRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const issue = workspace.publicationIssues()
      .find((candidate) => candidate.code === 'fixture_do_not_publish');
    assert.ok(issue, 'the stress-fixture marker must create a blocking publication issue');
    assert.equal(issue.path, 'extensions.stressTest.doNotPublish');

    const localizedMessages = new Set();
    for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
      workspace.setLocale(locale, { render: false });
      const message = workspace.issueText(issue);
      assert.ok(message.length >= 20, `${locale} must explain why publication is blocked`);
      localizedMessages.add(message);
    }
    assert.equal(localizedMessages.size, 5, 'every supported language must provide its own guidance');

    workspace.setLocale('zh');
    creatorClick(workspace, 'creator-tab', { tab: 'validate' });
    assert.match(creatorRoot.innerHTML, /负向压力测试模板/);
    assert.match(creatorRoot.innerHTML, /<li class="error">/);
  }, {
    creatorRoot,
    playable: true,
    prepareDocument(document) {
      document.extensions = {
        ...document.extensions,
        stressTest: {
          doNotPublish: true,
          reason: 'Negative editor fixture',
        },
      };
    },
  });
});

test('duplicate Player input/change events do not create duplicate save revisions', async () => {
  await withWorkspace(async (workspace) => {
    const initialRevision = workspace.playerSessionRevision;
    const changed = {
      target: {
        dataset: { action: 'player-profile-world' },
        value: 'New World',
      },
    };
    workspace.handlePlayerChange(changed);
    assert.equal(workspace.playerSessionRevision, initialRevision + 1);
    workspace.handlePlayerChange(changed);
    assert.equal(workspace.playerSessionRevision, initialRevision + 1);
  }, { playable: true });
});

test('Player Expansion Pack toggles clear undo entries from the previous runtime graph', async () => {
  await withWorkspace(async (workspace) => {
    creatorClick(workspace, 'add-expansion');
    const packId = workspace.getDocument().extensions.expansionDrafts[0].packId;
    creatorClick(workspace, 'add-selected-to-expansion', { packId });
    workspace.playerUndo = [{ label: 'Old graph', recipe: structuredClone(workspace.playerRecipe) }];
    workspace.playerRedo = [{ label: 'Old graph redo', recipe: structuredClone(workspace.playerRecipe) }];

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-expansion' },
        value: packId,
        checked: true,
      },
    });
    assert.equal(workspace.enabledExpansionIds.has(packId), true);
    assert.deepEqual(workspace.playerUndo, []);
    assert.deepEqual(workspace.playerRedo, []);
  }, { playable: true });
});

test('Player Smart Color follows the selected Part while a shared choice recolors every linked visible Style', async () => {
  const playerRoot = new FakeRoot();
  let html = '';
  let replacePickerNodes = false;
  const replacementRail = { scrollLeft: 0, scrollTop: 0 };
  const replacementPicker = {
    dataset: { playerPickerContext: '' },
    scrollLeft: 0,
    scrollTop: 0,
  };
  Object.defineProperty(playerRoot, 'innerHTML', {
    configurable: true,
    get() {
      return html;
    },
    set(value) {
      html = value;
      if (replacePickerNodes) {
        playerRoot.selectors['.v4-player-part-rail'] = replacementRail;
        playerRoot.selectors['.v4-player-picker'] = replacementPicker;
      }
    },
  });
  const changes = [];
  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.playerPartId = workspace.getDocument().parts[0].id;
    workspace.renderPlayer();

    assert.match(playerRoot.innerHTML, /data-action="player-palette"/);
    assert.match(playerRoot.innerHTML, /role="tab"[^>]*aria-selected="false"/);
    assert.match(playerRoot.innerHTML, /v4-player-palette-tab available/);
    assert.match(playerRoot.innerHTML, /aria-disabled="false"/);
    assert.doesNotMatch(playerRoot.innerHTML, /data-channel-id="unused-tone"/);

    playerClick(workspace, 'player-palette');
    assert.equal(workspace.playerPickerPanel, 'colors');
    assert.match(playerRoot.innerHTML, /Background colors/);
    assert.match(playerRoot.innerHTML, /data-channel-id="background-tone"/);
    assert.doesNotMatch(playerRoot.innerHTML, /data-channel-id="skin-tone"/);
    assert.doesNotMatch(playerRoot.innerHTML, /2 visible linked layer\(s\)/);
    assert.match(playerRoot.innerHTML, /class="v4-player-colors" role="radiogroup"/);
    assert.match(playerRoot.innerHTML, /role="radio"[^>]*data-player-radio-group="color-0"/);
    assert.match(playerRoot.innerHTML, /aria-checked="true" tabindex="0"/);
    assert.doesNotMatch(playerRoot.innerHTML, /data-channel-id="unused-tone"/);

    playerClick(workspace, 'player-palette');
    const skinPartId = workspace.runtimeDocument().parts[2].id;
    playerClick(workspace, 'player-part', { partId: skinPartId });
    playerClick(workspace, 'player-palette');
    assert.equal(workspace.playerPickerPanel, 'colors');
    assert.match(playerRoot.innerHTML, /data-channel-id="skin-tone"/);
    assert.doesNotMatch(playerRoot.innerHTML, /data-channel-id="background-tone"/);
    assert.match(playerRoot.innerHTML, /2 visible linked layer\(s\)/);

    const initialRevision = workspace.playerSessionRevision;
    const initialRenderKey = workspace.playerRenderKey(workspace.runtimeDocument(), workspace.playerRecipe);
    const skinPaletteContext = playerRoot.innerHTML
      .match(/data-player-picker-context="(colors:[^"]+)"/)?.[1];
    assert.ok(skinPaletteContext);
    replacementPicker.dataset.playerPickerContext = skinPaletteContext;
    playerRoot.selectors['.v4-player-part-rail'] = { scrollLeft: 246, scrollTop: 0 };
    playerRoot.selectors['.v4-player-picker'] = {
      dataset: { playerPickerContext: skinPaletteContext },
      scrollLeft: 9,
      scrollTop: 716,
    };
    replacePickerNodes = true;
    playerClick(workspace, 'player-color', {
      channelId: 'skin-tone',
      swatchId: 'alternate',
    });

    assert.deepEqual(
      workspace.playerRecipe.colors.find((entry) => entry.channelId === 'skin-tone'),
      { channelId: 'skin-tone', swatchId: 'alternate' },
    );
    assert.equal(workspace.playerPickerPanel, 'colors');
    assert.equal(workspace.playerUndo.length, 1);
    assert.equal(workspace.playerSessionRevision, initialRevision + 1);
    assert.equal(changes.at(-1).recipe.colors.find((entry) => entry.channelId === 'skin-tone')?.swatchId, 'alternate');
    assert.notEqual(workspace.playerRenderKey(workspace.runtimeDocument(), workspace.playerRecipe), initialRenderKey);
    assert.deepEqual(
      [replacementRail.scrollLeft, replacementPicker.scrollLeft, replacementPicker.scrollTop],
      [246, 9, 716],
      'a long palette and Part rail keep their scroll position after a swatch rerender',
    );

    const scene = resolveMakerScene(workspace.runtimeDocument(), workspace.playerRecipe);
    const linkedLayers = scene.layers.filter((layer) => layer.colorChannel?.id === 'skin-tone');
    assert.equal(linkedLayers.length, 2);
    assert.deepEqual(linkedLayers.map((layer) => layer.colorChannel.valueId), ['alternate', 'alternate']);

    playerClick(workspace, 'player-undo');
    assert.equal(
      workspace.playerRecipe.colors.find((entry) => entry.channelId === 'skin-tone')?.swatchId,
      'default',
    );
    playerClick(workspace, 'player-redo');
    assert.equal(
      workspace.playerRecipe.colors.find((entry) => entry.channelId === 'skin-tone')?.swatchId,
      'alternate',
    );

    const undoCount = workspace.playerUndo.length;
    const revision = workspace.playerSessionRevision;
    playerClick(workspace, 'player-color', {
      channelId: 'skin-tone',
      swatchId: 'alternate',
    });
    assert.equal(workspace.playerUndo.length, undoCount);
    assert.equal(workspace.playerSessionRevision, revision);

    const originalPartId = workspace.playerPartId;
    playerClick(workspace, 'player-part', { partId: workspace.runtimeDocument().parts[4].id });
    assert.equal(workspace.playerPickerPanel, 'parts');
    assert.notEqual(workspace.playerPartId, originalPartId);
    assert.match(playerRoot.innerHTML, /v4-player-palette-tab unavailable/);
    assert.match(playerRoot.innerHTML, /aria-disabled="true"/);
    assert.match(playerRoot.innerHTML, /data-count="0"/);
    assert.match(playerRoot.innerHTML, /No adjustable colors/);
    assert.equal(workspace.setPlayerPickerPanel('colors'), false);
    assert.equal(
      workspace.playerRecipe.colors.find((entry) => entry.channelId === 'skin-tone')?.swatchId,
      'alternate',
    );
    playerClick(workspace, 'player-color', {
      channelId: 'skin-tone',
      swatchId: 'default',
    });
    assert.equal(
      workspace.playerRecipe.colors.find((entry) => entry.channelId === 'skin-tone')?.swatchId,
      'alternate',
      'a stale color event from another Part must not change the Recipe',
    );
    assert.equal(workspace.playerSessionRevision, revision);
    assert.equal(workspace.playerUndo.length, undoCount);
  }, {
    playable: true,
    playerRoot,
    callbacks: {
      onPlayerRecipeChange: (payload) => changes.push(structuredClone(payload)),
    },
    prepareDocument(document) {
      const channel = (id, name, color) => ({
        id,
        name,
        order: document.colorChannels.length,
        mode: 'gradient-map',
        defaultSwatchId: 'default',
        swatches: [
          {
            id: 'default',
            name: 'Default',
            hintColor: color,
            stops: [
              { offset: 0, color },
              { offset: 1, color: '#ffffff' },
            ],
          },
          {
            id: 'alternate',
            name: 'Alternate',
            hintColor: '#f06f8f',
            stops: [
              { offset: 0, color: '#3d101c' },
              { offset: 1, color: '#ffe8ef' },
            ],
          },
        ],
      });
      document.colorChannels.push(
        channel('background-tone', 'Background tone', '#221144'),
        channel('skin-tone', 'Skin tone', '#a86f50'),
        channel('unused-tone', 'Unused tone', '#00ff00'),
      );
      document.parts[0].items[0].styles[0].colorChannelId = 'background-tone';
      document.parts[2].items[0].styles[0].colorChannelId = 'skin-tone';
      document.parts[3].items[0].styles[0].colorChannelId = 'skin-tone';
    },
  });
});

test('Player Palette lights only for the selected Item and Style with a usable Smart Color channel', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.renderPlayer();
    const document = workspace.runtimeDocument();
    const part = document.parts[0];
    const linkedItem = part.items[0];
    const linkedStyle = linkedItem.styles[0];

    assert.match(playerRoot.innerHTML, /v4-player-palette-tab available/);
    assert.match(playerRoot.innerHTML, /aria-disabled="false"/);

    playerClick(workspace, 'player-style', { styleId: 'unlinked-style' });
    assert.equal(
      workspace.playerRecipe.selections.find((selection) => selection.partId === part.id)?.styleId,
      'unlinked-style',
    );
    assert.match(playerRoot.innerHTML, /v4-player-palette-tab unavailable/);
    assert.match(playerRoot.innerHTML, /aria-disabled="true"/);
    assert.equal(workspace.setPlayerPickerPanel('colors'), false);

    playerClick(workspace, 'player-style', { styleId: linkedStyle.id });
    assert.match(playerRoot.innerHTML, /v4-player-palette-tab available/);

    playerClick(workspace, 'player-item', { itemId: 'unlinked-item' });
    assert.equal(
      workspace.playerRecipe.selections.find((selection) => selection.partId === part.id)?.itemId,
      'unlinked-item',
    );
    assert.match(playerRoot.innerHTML, /v4-player-palette-tab unavailable/);
    assert.match(playerRoot.innerHTML, /No adjustable colors/);

    const beforeRecipe = structuredClone(workspace.playerRecipe);
    const beforeRevision = workspace.playerSessionRevision;
    const beforeUndo = workspace.playerUndo.length;
    playerClick(workspace, 'player-palette');
    playerClick(workspace, 'player-color', {
      channelId: 'valid-tone',
      swatchId: 'alternate',
    });
    assert.equal(workspace.playerPickerPanel, 'parts');
    assert.deepEqual(workspace.playerRecipe, beforeRecipe);
    assert.equal(workspace.playerSessionRevision, beforeRevision);
    assert.equal(workspace.playerUndo.length, beforeUndo);

    playerClick(workspace, 'player-item', { itemId: linkedItem.id });
    assert.match(playerRoot.innerHTML, /v4-player-palette-tab available/);
    playerClick(workspace, 'player-palette');
    assert.match(playerRoot.innerHTML, /data-channel-id="valid-tone"/);
    playerClick(workspace, 'player-palette');
    const closedRecipe = structuredClone(workspace.playerRecipe);
    const closedRevision = workspace.playerSessionRevision;
    const closedUndo = workspace.playerUndo.length;
    playerClick(workspace, 'player-color', {
      channelId: 'valid-tone',
      swatchId: 'alternate',
    });
    assert.equal(workspace.playerPickerPanel, 'parts');
    assert.deepEqual(workspace.playerRecipe, closedRecipe);
    assert.equal(workspace.playerSessionRevision, closedRevision);
    assert.equal(workspace.playerUndo.length, closedUndo);
  }, {
    playable: true,
    playerRoot,
    prepareDocument(document) {
      const part = document.parts[0];
      const linkedItem = part.items[0];
      const linkedStyle = linkedItem.styles[0];
      const baseAsset = document.assets.find((asset) => asset.id === linkedStyle.assetId);
      const addAsset = (id) => {
        document.assets.push({
          ...structuredClone(baseAsset),
          id,
          identifier: `${id}.png`,
          url: `memory://${id}`,
        });
      };
      document.colorChannels.push({
        id: 'valid-tone',
        name: 'Valid tone',
        order: 0,
        mode: 'gradient-map',
        defaultSwatchId: 'default',
        swatches: [
          {
            id: 'default',
            name: 'Default',
            hintColor: '#335577',
            stops: [{ offset: 0, color: '#112233' }, { offset: 1, color: '#ddeeff' }],
          },
          {
            id: 'alternate',
            name: 'Alternate',
            hintColor: '#aa4466',
            stops: [{ offset: 0, color: '#331122' }, { offset: 1, color: '#ffe0eb' }],
          },
        ],
      });
      linkedStyle.colorChannelId = 'valid-tone';

      const unlinkedStyle = structuredClone(linkedStyle);
      unlinkedStyle.id = 'unlinked-style';
      unlinkedStyle.name = 'Unlinked style';
      unlinkedStyle.assetId = 'unlinked-style-art';
      unlinkedStyle.colorChannelId = '';
      addAsset(unlinkedStyle.assetId);
      linkedItem.styles.push(unlinkedStyle);

      const createItemFixture = (id, channelId) => {
        const item = structuredClone(linkedItem);
        item.id = id;
        item.name = id;
        item.status = 'public';
        item.styles = [structuredClone(linkedStyle)];
        item.styles[0].id = `${id}-style`;
        item.styles[0].name = `${id} style`;
        item.styles[0].assetId = `${id}-art`;
        item.styles[0].colorChannelId = channelId;
        item.defaultStyleId = item.styles[0].id;
        addAsset(item.styles[0].assetId);
        return item;
      };
      part.items.push(createItemFixture('unlinked-item', ''));
      document.parts[1].items[0].styles[0].colorChannelId = 'valid-tone';
    },
  });
});

test('Player Palette stays disabled for missing, non-gradient, and empty Smart Color channels', async () => {
  const scenarios = [
    {
      name: 'missing',
      prepare(document, style) {
        style.colorChannelId = 'missing-tone';
      },
    },
    {
      name: 'non-gradient',
      prepare(document, style) {
        document.colorChannels.push({
          id: 'flat-tone',
          name: 'Flat tone',
          order: 0,
          mode: 'flat',
          defaultSwatchId: 'default',
          swatches: [{ id: 'default', name: 'Default', hintColor: '#335577', stops: [] }],
        });
        style.colorChannelId = 'flat-tone';
      },
    },
    {
      name: 'empty',
      prepare(document, style) {
        document.colorChannels.push({
          id: 'empty-tone',
          name: 'Empty tone',
          order: 0,
          mode: 'gradient-map',
          defaultSwatchId: '',
          swatches: [],
        });
        style.colorChannelId = 'empty-tone';
      },
    },
  ];

  for (const scenario of scenarios) {
    const playerRoot = new FakeRoot();
    await withWorkspace(async (workspace) => {
      workspace.playerIntroOpen = false;
      workspace.renderPlayer();
      assert.match(
        playerRoot.innerHTML,
        /v4-player-palette-tab unavailable/,
        `${scenario.name} channel must not light the Palette`,
      );
      assert.match(playerRoot.innerHTML, /aria-disabled="true"/);
      assert.match(playerRoot.innerHTML, /data-count="0"/);
      assert.equal(workspace.setPlayerPickerPanel('colors'), false);
    }, {
      playable: true,
      playerRoot,
      prepareDocument(document) {
        scenario.prepare(document, document.parts[0].items[0].styles[0]);
      },
    });
  }
});

test('Player Palette does not fall back to a legacy Part channel when the selected Style channel exists but is unusable', async () => {
  for (const invalidMode of ['flat', 'empty']) {
    const playerRoot = new FakeRoot();
    await withWorkspace(async (workspace) => {
      workspace.playerIntroOpen = false;
      workspace.renderPlayer();
      assert.match(playerRoot.innerHTML, /v4-player-palette-tab unavailable/);
      assert.match(playerRoot.innerHTML, /aria-disabled="true"/);
      assert.doesNotMatch(playerRoot.innerHTML, /data-channel-id="legacy-tone"/);
      assert.equal(workspace.setPlayerPickerPanel('colors'), false);
    }, {
      playable: true,
      playerRoot,
      prepareDocument(document) {
        const swatch = {
          id: 'default',
          name: 'Default',
          hintColor: '#335577',
          stops: [{ offset: 0, color: '#112233' }, { offset: 1, color: '#ddeeff' }],
        };
        document.colorChannels.push(
          {
            id: 'legacy-tone',
            name: 'Legacy Part tone',
            order: 0,
            mode: 'gradient-map',
            defaultSwatchId: 'default',
            swatches: [swatch],
          },
          {
            id: 'invalid-style-tone',
            name: 'Invalid Style tone',
            order: 1,
            mode: invalidMode === 'flat' ? 'flat' : 'gradient-map',
            defaultSwatchId: invalidMode === 'flat' ? 'default' : '',
            swatches: invalidMode === 'flat' ? [structuredClone(swatch)] : [],
          },
        );
        const part = document.parts[0];
        part.colorChannelId = 'legacy-tone';
        part.items[0].styles[0].colorChannelId = 'invalid-style-tone';
      },
    });
  }
});

test('Player Palette can reveal a selected Style whose visibility depends on its Smart Color', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.renderPlayer();
    const before = resolveMakerScene(workspace.runtimeDocument(), workspace.playerRecipe, { strict: false });
    assert.equal(before.layers.some((layer) => layer.partId === workspace.playerPartId), false);
    assert.match(playerRoot.innerHTML, /v4-player-palette-tab available/);

    playerClick(workspace, 'player-palette');
    playerClick(workspace, 'player-color', {
      channelId: 'visibility-tone',
      swatchId: 'show',
    });

    const after = resolveMakerScene(workspace.runtimeDocument(), workspace.playerRecipe, { strict: false });
    assert.equal(after.layers.some((layer) => (
      layer.partId === workspace.playerPartId
      && layer.colorChannel?.valueId === 'show'
    )), true);
  }, {
    playable: true,
    playerRoot,
    prepareDocument(document) {
      document.colorChannels.push({
        id: 'visibility-tone',
        name: 'Visibility tone',
        order: 0,
        mode: 'gradient-map',
        defaultSwatchId: 'hide',
        swatches: [
          {
            id: 'hide',
            name: 'Hide',
            hintColor: '#111111',
            stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#222222' }],
          },
          {
            id: 'show',
            name: 'Show',
            hintColor: '#f5b942',
            stops: [{ offset: 0, color: '#5a3500' }, { offset: 1, color: '#fff0bd' }],
          },
        ],
      });
      const style = document.parts[0].items[0].styles[0];
      style.colorChannelId = 'visibility-tone';
      style.visibleWhen = { colorChannelId: 'visibility-tone', equals: 'show' };
    },
  });
});

test('Player Palette exposes every creator preset instead of decorative or truncated colors', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.renderPlayer();

    assert.match(
      playerRoot.innerHTML,
      /class="v4-player-palette-icon" data-count="4"/,
    );
    assert.match(playerRoot.innerHTML, /1 color group\(s\) · 4 color\(s\)/);

    playerClick(workspace, 'player-palette');
    const presetButtons = playerRoot.innerHTML.match(/data-action="player-color"/g) || [];
    assert.equal(presetButtons.length, 4);
    ['#dd3344', '#22aa66', '#3366dd', '#f2b134'].forEach((color) => {
      assert.match(playerRoot.innerHTML, new RegExp(`--swatch:${color}`));
    });
  }, {
    playable: true,
    playerRoot,
    prepareDocument(document) {
      document.colorChannels.push({
        id: 'four-presets',
        name: 'Four presets',
        order: 0,
        mode: 'gradient-map',
        defaultSwatchId: 'preset-1',
        swatches: ['#dd3344', '#22aa66', '#3366dd', '#f2b134'].map((color, index) => ({
          id: `preset-${index + 1}`,
          name: `Preset ${index + 1}`,
          hintColor: color,
          stops: [
            { offset: 0, color: '#111111' },
            { offset: 0.5, color },
            { offset: 1, color: '#ffffff' },
          ],
        })),
      });
      document.parts[0].items[0].styles[0].colorChannelId = 'four-presets';
    },
  });
});

test('Player Palette toggles, Back, and Escape restore Part and Palette scroll without changing the OC', async () => {
  const playerRoot = new FakeRoot();
  const rail = { scrollLeft: 0, scrollTop: 0 };
  const pickerNodes = new Map();
  let html = '';
  Object.defineProperty(playerRoot, 'innerHTML', {
    configurable: true,
    get() {
      return html;
    },
    set(value) {
      html = value;
      playerRoot.selectors['.v4-player-part-rail'] = rail;
      const context = value.match(/data-player-picker-context="([^"]*)"/)?.[1] || '';
      if (!context) return;
      if (!pickerNodes.has(context)) {
        pickerNodes.set(context, {
          dataset: { playerPickerContext: context },
          scrollLeft: 0,
          scrollTop: 0,
        });
      }
      playerRoot.selectors['.v4-player-picker'] = pickerNodes.get(context);
    },
  });

  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.renderPlayer();
    const partId = workspace.playerPartId;
    const partPicker = pickerNodes.get(partId);
    assert.ok(partPicker);
    partPicker.scrollLeft = 17;
    partPicker.scrollTop = 420;
    rail.scrollLeft = 240;

    const revision = workspace.playerSessionRevision;
    const undoCount = workspace.playerUndo.length;
    playerClick(workspace, 'player-palette');
    assert.equal(workspace.playerPickerPanel, 'colors');
    assert.match(playerRoot.innerHTML, /data-action="player-close-palette"/);
    const paletteContext = playerRoot.innerHTML
      .match(/data-player-picker-context="(colors:[^"]+)"/)?.[1];
    assert.ok(paletteContext);
    const palettePicker = pickerNodes.get(paletteContext);
    assert.ok(palettePicker);
    palettePicker.scrollLeft = 13;
    palettePicker.scrollTop = 700;

    playerClick(workspace, 'player-palette');
    assert.equal(workspace.playerPickerPanel, 'parts');
    assert.deepEqual(
      [partPicker.scrollLeft, partPicker.scrollTop, rail.scrollLeft],
      [17, 420, 240],
      'clicking the active Palette tab returns to the exact previous Part view',
    );

    playerClick(workspace, 'player-palette');
    assert.deepEqual(
      [palettePicker.scrollLeft, palettePicker.scrollTop, rail.scrollLeft],
      [13, 700, 240],
      'reopening Palette restores its independent scroll position',
    );
    let prevented = false;
    workspace.boundPlayerKeydown({
      key: 'Escape',
      target: {},
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true);
    assert.equal(workspace.playerPickerPanel, 'parts');
    assert.deepEqual([partPicker.scrollLeft, partPicker.scrollTop], [17, 420]);

    playerClick(workspace, 'player-palette');
    playerClick(workspace, 'player-close-palette');
    assert.equal(workspace.playerPickerPanel, 'parts');
    assert.deepEqual([partPicker.scrollLeft, partPicker.scrollTop], [17, 420]);
    assert.equal(workspace.playerSessionRevision, revision);
    assert.equal(workspace.playerUndo.length, undoCount);
  }, {
    playable: true,
    playerRoot,
    prepareDocument(document) {
      document.colorChannels.push({
        id: 'tone',
        name: 'Tone',
        order: 0,
        mode: 'gradient-map',
        defaultSwatchId: 'default',
        swatches: [{
          id: 'default',
          name: 'Default',
          hintColor: '#2255aa',
          stops: [
            { offset: 0, color: '#102040' },
            { offset: 1, color: '#dce8ff' },
          ],
        }],
      });
      document.parts[0].items[0].styles[0].colorChannelId = 'tone';
    },
  });
});

test('Player exposes editable Maker Soul defaults as the resolved OC identity card', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.playerProfile = {
      name: 'Mira',
      world: 'Astral Courier',
      description: 'A calm courier between worlds.',
      tags: 'starlight, courier',
    };
    workspace.renderPlayer();

    assert.match(playerRoot.innerHTML, /Soul Configuration/);
    assert.match(playerRoot.innerHTML, /Personality &amp; identity/);
    assert.match(playerRoot.innerHTML, /soul\.md/);
    assert.match(playerRoot.innerHTML, /memory\.md/);
    assert.match(playerRoot.innerHTML, /SKILL\.md/);
    assert.match(playerRoot.innerHTML, /Maker default · Valid/);
    assert.match(
      playerRoot.innerHTML,
      /<textarea id="v4PlayerSoul-soulMd" data-action="player-soul-document" data-soul-key="soulMd"[^>]*aria-invalid="false"[^>]*aria-describedby="v4PlayerSoul-soulMd-status"/,
    );
    assert.match(
      playerRoot.innerHTML,
      /<label for="v4PlayerSoul-memoryMd">Edit memory\.md for this OC<\/label>/,
    );
    assert.match(
      playerRoot.innerHTML,
      /id="v4PlayerSoul-skillMd-status" role="status" aria-live="polite"/,
    );
    assert.match(playerRoot.innerHTML, /data-action="player-reset-soul-document"/);
    assert.match(playerRoot.innerHTML, /data-action="player-reset-all-soul"/);
    assert.doesNotMatch(playerRoot.innerHTML, /<pre data-player-soul-document=/);
    assert.match(playerRoot.innerHTML, /Mira/);
    assert.match(playerRoot.innerHTML, /Astral Courier/);
    assert.doesNotMatch(playerRoot.innerHTML, /\{\{OC_NAME\}\}/);

    const resolved = workspace.resolvedPlayerLivingContent();
    assert.match(resolved.content.soulMd, /Mira/);
    assert.match(resolved.content.soulMd, /Astral Courier/);
    assert.match(resolved.content.soulMd, /A calm courier between worlds\./);
    assert.equal(resolved.validation.valid, true);
  }, { playable: true, playerRoot });
});

test('Player Soul edits are independent, autosaved, profile-aware, and reset to Maker defaults', async () => {
  const playerRoot = new FakeRoot();
  const sessionWrites = [];
  const playerChanges = [];
  await withWorkspace(async (workspace) => {
    workspace.context.walletAddress = '0xplayer';
    workspace.playerIntroOpen = false;
    workspace.playerProfile = {
      name: 'Mira',
      world: 'Astral Courier',
      description: 'A calm courier between worlds.',
      tags: 'starlight, courier',
    };
    workspace.playerLivingContent = workspace.normalizePlayerLivingContent(
      null,
      workspace.runtimeDocument(),
    );
    const makerLivingContent = structuredClone(workspace.getDocument().livingContent);
    const initialRevision = workspace.playerSessionRevision;
    const customMemory = '# Private founding memory\n\nMira chose the moon route.';

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-soul-document', soulKey: 'memoryMd' },
        value: customMemory,
      },
    });
    assert.equal(workspace.playerSessionRevision, initialRevision + 1);
    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-soul-document', soulKey: 'memoryMd' },
        value: customMemory,
      },
    });
    assert.equal(
      workspace.playerSessionRevision,
      initialRevision + 1,
      'duplicate input/change delivery must not create another save revision',
    );
    assert.equal(workspace.playerLivingContentDraft().memoryMd, customMemory);
    assert.equal(workspace.playerLivingContentDraft().customized.memoryMd, true);
    assert.equal(workspace.playerLivingContentDraft().customized.soulMd, false);
    assert.deepEqual(
      workspace.getDocument().livingContent,
      makerLivingContent,
      'Player edits must never mutate the Maker defaults',
    );
    assert.equal(playerChanges.at(-1).livingContent.memoryMd, customMemory);

    workspace.handlePlayerChange({
      target: { dataset: { action: 'player-profile-name' }, value: 'Nova' },
    });
    assert.match(workspace.playerLivingContentDraft().soulMd, /Name: Nova/);
    assert.equal(
      workspace.playerLivingContentDraft().memoryMd,
      customMemory,
      'a customized Player document must not be regenerated by profile changes',
    );

    playerClick(workspace, 'player-reset-soul-document', { soulKey: 'memoryMd' });
    const resetMemory = workspace.playerLivingContentDraft();
    assert.equal(resetMemory.customized.memoryMd, false);
    assert.match(resetMemory.memoryMd, /Nova was composed from QA Maker/);

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-soul-document', soulKey: 'soulMd' },
        value: '# Nova identity',
      },
    });
    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-soul-document', soulKey: 'skillMd' },
        value: '---\nname: nova-guide\n---\n# Nova guide',
      },
    });
    assert.equal(workspace.playerLivingContentDraft().customized.soulMd, true);
    assert.equal(workspace.playerLivingContentDraft().customized.skillMd, true);
    playerClick(workspace, 'player-reset-all-soul');
    const resetAll = workspace.playerLivingContentDraft();
    assert.deepEqual(resetAll.customized, {
      soulMd: false,
      memoryMd: false,
      skillMd: false,
    });
    assert.match(resetAll.soulMd, /Name: Nova/);

    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-soul-document', soulKey: 'memoryMd' },
        value: customMemory,
      },
    });
    await workspace.sessionAutosave.flush();
    assert.equal(workspace.playerSaveState, 'saved');
    assert.equal(sessionWrites.length, 1);
    assert.equal(sessionWrites[0].memoryMd, customMemory);
    assert.equal(sessionWrites[0].customized.memoryMd, true);
    assert.deepEqual(workspace.getDocument().livingContent, makerLivingContent);
  }, {
    playable: true,
    playerRoot,
    callbacks: {
      onPlayerRecipeChange: (payload) => playerChanges.push(structuredClone(payload)),
    },
    async savePlayerSessionRecord(_key, session) {
      sessionWrites.push(structuredClone(session.livingContent));
    },
  });
});

test('invalid Player Soul Markdown is accessible and blocks Complete OC', async () => {
  const playerRoot = new FakeRoot();
  const errors = [];
  const completed = [];
  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.handlePlayerChange({
      target: {
        dataset: { action: 'player-soul-document', soulKey: 'memoryMd' },
        value: '',
      },
    });
    workspace.renderPlayer();

    assert.match(
      playerRoot.innerHTML,
      /data-action="player-soul-document" data-soul-key="memoryMd"[^>]*aria-invalid="true"/,
    );
    assert.match(
      playerRoot.innerHTML,
      /data-player-soul-error="memoryMd"[^>]*>This document cannot be empty\.<\/span>/,
    );
    assert.match(playerRoot.innerHTML, /data-player-soul-card-status>Needs attention<\/em>/);
    assert.match(
      workspace.playerCompletionIssues(workspace.runtimeDocument(), workspace.playerRecipe).join(' '),
      /This document cannot be empty/,
    );
    assert.match(
      playerRoot.innerHTML,
      /data-action="player-complete" disabled>Complete OC<\/button>/,
    );

    playerClick(workspace, 'player-complete');
    assert.equal(completed.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /This document cannot be empty/);
    assert.deepEqual(
      workspace.getDocument().livingContent,
      null,
      'invalid Player drafts must not be written into the Maker document',
    );
  }, {
    playable: true,
    playerRoot,
    callbacks: {
      onCompleteOc: (payload) => completed.push(payload),
      onPlayerError: (error) => errors.push(error),
    },
  });
});

test('connected Player must save and resolve every recovery branch before Complete OC', async () => {
  const playerRoot = new FakeRoot();
  const errors = [];
  const completed = [];
  await withWorkspace(async (workspace) => {
    workspace.playerIntroOpen = false;
    workspace.context = {
      ...workspace.context,
      walletAddress: '0xconnected',
    };
    assert.equal(workspace.context.walletAddress, '0xconnected');
    const document = workspace.runtimeDocument();
    workspace.playerRenderState = {
      key: workspace.playerRenderKey(document, workspace.playerRecipe),
      status: 'ready',
      error: '',
    };

    const assertBlocked = ({
      saveState,
      errorCode = '',
      branches = [],
      message,
    }) => {
      workspace.playerSaveState = saveState;
      workspace.playerSaveErrorCode = errorCode;
      workspace.playerRecoveryBranches = branches;
      workspace.renderPlayer();
      assert.match(
        workspace.playerCompletionIssues(document, workspace.playerRecipe).join(' '),
        message,
      );
      assert.match(
        playerRoot.innerHTML,
        /data-action="player-complete" disabled>Complete OC<\/button>/,
      );
      const previousErrors = errors.length;
      playerClick(workspace, 'player-complete');
      assert.equal(completed.length, 0);
      assert.equal(errors.length, previousErrors + 1);
      assert.match(errors.at(-1).message, message);
    };

    assertBlocked({
      saveState: 'dirty',
      message: /finish saving before completing/,
    });
    assertBlocked({
      saveState: 'error',
      errorCode: 'PLAYER_SESSION_CONFLICT',
      message: /Resolve every local recovery copy/,
    });
    assertBlocked({
      saveState: 'saved',
      branches: [{
        writerId: 'other-tab',
        revision: 2,
        baseRevision: 1,
        session: {},
      }],
      message: /Resolve every local recovery copy/,
    });

    workspace.playerSaveState = 'saved';
    workspace.playerSaveErrorCode = '';
    workspace.playerRecoveryBranches = [];
    workspace.renderPlayer();
    assert.equal(
      workspace.playerCompletionIssues(document, workspace.playerRecipe).length,
      0,
    );
    assert.match(
      playerRoot.innerHTML,
      /data-action="player-complete" >Complete OC<\/button>/,
    );
    await completePlayerThroughFinalPreview(workspace);
    assert.equal(completed.length, 1);
    assert.equal(errors.length, 3);
  }, {
    playable: true,
    playerRoot,
    callbacks: {
      onCompleteOc: (payload) => completed.push(payload),
      onPlayerError: (error) => errors.push(error),
    },
  });
});

test('Maker metadata refreshes uncustomized Soul defaults inside the MakerDocument only', async () => {
  await withWorkspace(async (workspace) => {
    const before = workspace.getDocument();
    const normalizedLivingContent = workspace.resolvedPlayerLivingContent(before).validation.content;
    const customSoul = '# Custom Soul\n\nKeep this creator-authored identity.';
    workspace.updateMakerSettings({
      livingContent: {
        ...normalizedLivingContent,
        soulMd: customSoul,
        customized: {
          ...normalizedLivingContent.customized,
          soulMd: true,
        },
      },
    });
    workspace.updateMakerSettings({
      name: 'Renamed Moon Maker',
      summary: 'A newly described world.',
      creator: 'New Creator',
      style: 'Silver night',
    });

    const document = workspace.getDocument();
    assert.equal(document.livingContent.soulMd, customSoul);
    assert.equal(document.livingContent.customized.soulMd, true);
    assert.match(document.livingContent.memoryMd, /Renamed Moon Maker/);
    assert.match(document.livingContent.skillMd, /name: renamed-moon-maker-companion/);
    assert.equal(document.livingContent.customized.memoryMd, false);
    assert.equal(document.livingContent.customized.skillMd, false);

    workspace.playerProfile = {
      name: 'Mira',
      world: 'Silver night',
      description: 'A newly described character.',
      tags: '',
    };
    const resolved = workspace.resolvedPlayerLivingContent();
    assert.equal(resolved.content.soulMd, customSoul);
    assert.match(resolved.content.memoryMd, /Renamed Moon Maker/);
  }, { playable: true });
});

test('enabled Expansion Pack ids are scoped to packs declared by the current Maker', () => {
  const document = {
    extensions: {
      expansionDrafts: [
        { packId: 'pack-b' },
        { packId: 'pack-a' },
      ],
    },
  };
  assert.deepEqual(
    enabledExpansionIdsForDocument(document, new Set(['pack-a', 'foreign-pack', 'pack-b'])),
    ['pack-b', 'pack-a'],
  );
  assert.deepEqual(enabledExpansionIdsForDocument(document, 'pack-a'), []);
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
    workspace.handlePlayerChange({ target: { dataset: { action: 'player-profile-description' }, value: 'A production-ready character.' } });
    workspace.handlePlayerChange({ target: { dataset: { action: 'player-profile-tags' }, value: 'space, courier' } });
    assert.equal(workspace.playerProfile.name, 'Test OC');
    assert.equal(workspace.playerProfile.world, 'Test World');
    assert.equal(workspace.playerProfile.description, 'A production-ready character.');
    assert.equal(workspace.playerProfile.tags, 'space, courier');
    assert.equal(workspace.playerSaveState, 'dirty');

    playerClick(workspace, 'player-info');
    assert.equal(workspace.playerIntroOpen, true);
    playerClick(workspace, 'close-player-info');
    assert.equal(workspace.playerIntroOpen, false);
    workspace.playerCompletionIssues = () => [];
    await completePlayerThroughFinalPreview(workspace);
    assert.equal(completed.length, 1);
    assert.match(completed[0].livingContent.soulMd, /Test OC/);
    assert.match(completed[0].livingContent.soulMd, /Test World/);
    assert.match(completed[0].livingContent.memoryMd, /A production-ready character/);
  }, { playable: true, callbacks: { onCompleteOc: (payload) => completed.push(payload) } });
});

test('Player image-first controls expose one current Part and strong Item, Style, and color selection state', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const document = workspace.runtimeDocument();
    const part = document.parts[0];
    const item = part.items[0];
    const firstStyle = item.styles[0];
    workspace.assets.set(firstStyle.assetId, {
      assetId: firstStyle.assetId,
      url: 'https://assets.example/first-style.png',
      thumbnailUrl: 'https://assets.example/first-style-thumb.png',
    });
    workspace.executeDocument('Add Player style variant', ({ document: next }) => {
      const targetItem = next.parts[0].items[0];
      const variant = structuredClone(targetItem.styles[0]);
      variant.id = 'player-style-variant';
      variant.name = 'Player style variant';
      variant.assetId = 'player-style-variant-art';
      targetItem.styles.push(variant);
      next.assets.push({
        id: variant.assetId,
        identifier: `${variant.assetId}.png`,
        kind: 'layer',
        mediaType: 'image/png',
        width: 1024,
        height: 1024,
        url: 'https://assets.example/player-style-variant.png',
      });
    });
    workspace.assets.set('player-style-variant-art', {
      assetId: 'player-style-variant-art',
      url: 'https://assets.example/player-style-variant.png',
      thumbnailUrl: 'https://assets.example/player-style-variant-thumb.png',
    });
    workspace.renderPlayer();

    assert.equal((playerRoot.innerHTML.match(/role="tab"[\s\S]*?aria-selected="true"/g) || []).length, 1);
    assert.match(playerRoot.innerHTML, /v4-player-part active has-selection/);
    assert.match(playerRoot.innerHTML, /first-style-thumb\.png/);
    assert.match(playerRoot.innerHTML, /class="v4-player-item-grid" role="radiogroup"/);
    assert.match(playerRoot.innerHTML, /role="radio" class="v4-player-item active[^>]*aria-checked="true" tabindex="0"/);
    assert.match(playerRoot.innerHTML, /class="v4-player-style-picker" role="radiogroup"/);
    assert.match(playerRoot.innerHTML, /role="radio" class="v4-player-style-option active[^>]*aria-checked="true" tabindex="0"/);
    assert.match(playerRoot.innerHTML, /player-style-variant-thumb\.png/);
    assert.match(playerRoot.innerHTML, /v4-player-selected-mark" aria-hidden="true"/);
  }, { playable: true, playerRoot });
});

test('Player radio groups use roving focus and arrow keys without activating unavailable options', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    let activatedIndex = -1;
    let focusedIndex = -1;
    const group = {
      querySelectorAll: () => radios,
    };
    const createRadio = (index, { disabled = false } = {}) => {
      const attributes = new Map([
        ['tabindex', index === 0 ? '0' : '-1'],
        ['aria-disabled', disabled ? 'true' : 'false'],
      ]);
      return {
        dataset: {
          playerRadioGroup: 'item',
          playerRadioIndex: String(index),
        },
        hidden: false,
        closest(selector) {
          if (selector === '[role="radio"][data-player-radio-group]') return this;
          if (selector === '[role="radiogroup"]') return group;
          return null;
        },
        getAttribute(name) {
          return attributes.get(name) || null;
        },
        setAttribute(name, value) {
          attributes.set(name, String(value));
        },
        focus() {
          focusedIndex = index;
        },
        click() {
          activatedIndex = index;
        },
      };
    };
    const radios = [
      createRadio(0),
      createRadio(1),
      createRadio(2, { disabled: true }),
    ];
    playerRoot.selectors['[role="radio"][data-player-radio-group="item"][data-player-radio-index="1"]'] = radios[1];
    let prevented = false;

    assert.equal(workspace.handlePlayerRadioKeydown({
      key: 'ArrowRight',
      target: radios[0],
      preventDefault() {
        prevented = true;
      },
    }), true);
    assert.equal(prevented, true);
    assert.equal(focusedIndex, 1);
    assert.equal(activatedIndex, 1);
    assert.equal(radios[0].getAttribute('tabindex'), '-1');
    assert.equal(radios[1].getAttribute('tabindex'), '0');

    assert.equal(workspace.handlePlayerRadioKeydown({
      key: 'ArrowRight',
      target: radios[1],
      preventDefault() {},
    }), true);
    assert.equal(focusedIndex, 2, 'disabled choices remain focusable so their reason can be discovered');
    assert.equal(activatedIndex, 1, 'disabled choices are never activated');
    assert.equal(radios[2].getAttribute('tabindex'), '0');
  }, { playable: true, playerRoot });
});

test('Player palette and Part tabs support arrow, Home, and End keyboard navigation', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    let activatedIndex = -1;
    let focusedIndex = -1;
    const tablist = {
      querySelectorAll: () => tabs,
    };
    const createTab = (index, action, partId = '') => ({
      dataset: { action, partId },
      hidden: false,
      disabled: false,
      closest(selector) {
        if (selector === '[role="tab"][data-action]') return this;
        if (selector === '[role="tablist"]') return tablist;
        return null;
      },
      click() {
        activatedIndex = index;
      },
      focus() {
        focusedIndex = index;
      },
    });
    const tabs = [
      createTab(0, 'player-palette'),
      createTab(1, 'player-part', 'part-one'),
      createTab(2, 'player-part', 'part-two'),
    ];
    playerRoot.querySelectorAll = (selector) => (
      selector === '[data-action="player-palette"]'
        ? [tabs[0]]
        : selector === '[data-action="player-part"]'
          ? tabs.slice(1)
          : []
    );
    let prevented = false;

    assert.equal(workspace.handlePlayerTabKeydown({
      key: 'ArrowRight',
      target: tabs[0],
      preventDefault() {
        prevented = true;
      },
    }), true);
    assert.equal(prevented, true);
    assert.equal(activatedIndex, 1);
    assert.equal(focusedIndex, 1);

    workspace.handlePlayerTabKeydown({
      key: 'End',
      target: tabs[1],
      preventDefault() {},
    });
    assert.equal(activatedIndex, 2);
    assert.equal(focusedIndex, 2);

    workspace.handlePlayerTabKeydown({
      key: 'Home',
      target: tabs[2],
      preventDefault() {},
    });
    assert.equal(activatedIndex, 0);
    assert.equal(focusedIndex, 0);

    tabs[0].disabled = true;
    activatedIndex = -1;
    focusedIndex = -1;
    workspace.handlePlayerTabKeydown({
      key: 'Home',
      target: tabs[2],
      preventDefault() {},
    });
    assert.equal(activatedIndex, 1, 'an unavailable Palette is skipped by tab navigation');
    assert.equal(focusedIndex, 1);

    assert.equal(workspace.handlePlayerTabKeydown({
      key: 'ArrowDown',
      target: tabs[1],
      preventDefault() {
        assert.fail('a horizontal tablist must not block vertical page scrolling');
      },
    }), false);
  }, { playable: true, playerRoot });
});

test('reselecting the current Player option is a no-op and does not create phantom Undo history', async () => {
  await withWorkspace(async (workspace) => {
    const current = workspace.playerRecipe.selections[0];
    workspace.playerPartId = current.partId;
    const undoCount = workspace.playerUndo.length;
    const revision = workspace.playerSessionRevision;

    playerClick(workspace, 'player-item', { itemId: current.itemId });
    playerClick(workspace, 'player-style', { styleId: current.styleId }, 'Current style');

    assert.equal(workspace.playerUndo.length, undoCount);
    assert.equal(workspace.playerSessionRevision, revision);
  }, { playable: true });
});

test('final preview freezes the exact OC snapshot used by completion and supports size/background rerenders', async () => {
  const completed = [];
  const renders = [];
  const renderedBlobs = [];
  await withWorkspace(async (workspace) => {
    workspace.playerCompletionIssues = () => [];
    workspace.playerProfile.name = 'Frozen OC';
    workspace.playerProfile.description = 'Frozen description';
    workspace.renderRecipeToBlob = async (recipe, options) => {
      renders.push({ recipe: structuredClone(recipe), options: { ...options } });
      const blob = new Blob([`render-${renders.length}`], { type: 'image/png' });
      renderedBlobs.push(blob);
      return blob;
    };
    playerClick(workspace, 'player-palette');
    playerClick(workspace, 'player-color', {
      channelId: 'export-tone',
      swatchId: 'alternate',
    });

    playerClick(workspace, 'player-complete');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(workspace.playerExportState, 'ready');
    assert.equal(workspace.playerExportDimensions.width, 1024);
    assert.match(workspace.playerRoot?.innerHTML || '', /Final OC preview|OC 最终成品预览/);
    assert.match(
      workspace.playerRoot?.innerHTML || '',
      /id="makerPlayerShareStatus" role="status" aria-live="polite" aria-atomic="true"/,
    );
    assert.match(
      workspace.playerRoot?.innerHTML || '',
      /data-action="player-copy-maker-link" disabled aria-describedby="makerPlayerShareStatus"/,
    );
    assert.doesNotMatch(
      workspace.playerRoot?.innerHTML || '',
      /v4-player-export-placeholder" role="status"/,
    );

    playerClick(workspace, 'player-export-size', { sizeMode: 'original' });
    await new Promise((resolve) => setImmediate(resolve));
    playerClick(workspace, 'player-export-background', { transparent: 'true' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders.at(-1).options.sizeMode, 'original');
    assert.equal(renders.at(-1).options.transparentBackground, true);

    workspace.playerProfile.name = 'Changed behind modal';
    workspace.playerRecipe.selections = [];
    workspace.playerRecipe.colors = [{
      channelId: 'export-tone',
      swatchId: 'default',
    }];
    playerClick(workspace, 'player-confirm-complete');

    assert.equal(completed.length, 1);
    assert.equal(completed[0].profile.name, 'Frozen OC');
    assert.equal(completed[0].profile.description, 'Frozen description');
    assert.equal(
      renders[0].recipe.colors.find((entry) => entry.channelId === 'export-tone')?.swatchId,
      'alternate',
    );
    assert.equal(
      completed[0].recipe.colors.find((entry) => entry.channelId === 'export-tone')?.swatchId,
      'alternate',
    );
    assert.deepEqual(completed[0].recipe, renders[0].recipe);
    assert.equal(completed[0].imageBlob, renderedBlobs.at(-1));
    assert.equal(workspace.playerPublishOpen, true, 'a real Player completion continues to publication');
    assert.deepEqual(completed[0].imageExport, {
      sizeMode: 'original',
      transparentBackground: true,
      width: 1024,
      height: 1024,
      mediaType: 'image/png',
    });
  }, {
    playable: true,
    playerRoot: new FakeRoot(),
    callbacks: { onCompleteOc: (payload) => completed.push(payload) },
    prepareDocument(document) {
      document.colorChannels.push({
        id: 'export-tone',
        name: 'Export tone',
        order: 0,
        mode: 'gradient-map',
        defaultSwatchId: 'default',
        swatches: [
          {
            id: 'default',
            name: 'Default',
            hintColor: '#553355',
            stops: [
              { offset: 0, color: '#110811' },
              { offset: 1, color: '#fff0ff' },
            ],
          },
          {
            id: 'alternate',
            name: 'Alternate',
            hintColor: '#336699',
            stops: [
              { offset: 0, color: '#081122' },
              { offset: 1, color: '#eef8ff' },
            ],
          },
        ],
      });
      document.parts[0].items[0].styles[0].colorChannelId = 'export-tone';
    },
  });
});

test('Creator Player preview completion returns to Creator without opening or focusing publication', async () => {
  const playerRoot = new FakeRoot();
  let publishFocusCount = 0;
  playerRoot.selectors['#makerPlayerPublishDialog'] = {
    focus() {
      publishFocusCount += 1;
    },
  };
  const completed = [];
  await withWorkspace(async (workspace) => {
    workspace.playerCreatorPreview = true;
    workspace.playerCompletionIssues = () => [];
    workspace.playerExportOpen = true;
    workspace.playerExportSnapshot = workspace.createPlayerExportSnapshot();
    workspace.playerExportPreviewBlob = new Blob(['creator-preview'], { type: 'image/png' });
    workspace.playerExportState = 'ready';
    workspace.playerExportDimensions = { width: 1024, height: 1024 };
    workspace.playerPublishOpen = true;

    workspace.completePlayerExport();

    assert.equal(completed.length, 1);
    assert.equal(workspace.playerExportOpen, false);
    assert.equal(workspace.playerPublishOpen, false);
    assert.equal(publishFocusCount, 0);
  }, {
    playable: true,
    playerRoot,
    callbacks: { onCompleteOc: (payload) => completed.push(payload) },
  });
});

test('Player export rerenders preserve modal scroll position', async () => {
  const playerRoot = new FakeRoot();
  let html = '';
  let replaceExportBody = false;
  const replacementBody = { scrollLeft: 0, scrollTop: 0 };
  Object.defineProperty(playerRoot, 'innerHTML', {
    configurable: true,
    get() {
      return html;
    },
    set(value) {
      html = value;
      if (replaceExportBody && value.includes('v4-player-export-body')) {
        playerRoot.selectors['.v4-player-export-body'] = replacementBody;
      }
    },
  });

  await withWorkspace(async (workspace) => {
    playerRoot.selectors['.v4-player-export-body'] = {
      scrollLeft: 17,
      scrollTop: 432,
    };
    workspace.playerExportOpen = true;
    workspace.playerExportSnapshot = workspace.createPlayerExportSnapshot();
    workspace.playerExportState = 'rendering';
    replaceExportBody = true;

    workspace.renderPlayer();

    assert.equal(replacementBody.scrollLeft, 17);
    assert.equal(replacementBody.scrollTop, 432);
  }, { playable: true, playerRoot });
});

test('Player export aborts a pending render when the modal closes and serializes option changes', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    let capturedSignal = null;
    workspace.playerExportOpen = true;
    workspace.playerExportSnapshot = workspace.createPlayerExportSnapshot();
    workspace.playerExportState = 'idle';
    workspace.renderRecipeToBlob = async (_recipe, options) => {
      capturedSignal = options.signal;
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    };

    const renderPromise = workspace.preparePlayerExportPreview();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(workspace.playerExportState, 'rendering');
    assert.equal(capturedSignal.aborted, false);
    assert.match(
      playerRoot.innerHTML,
      /data-action="player-export-background" data-transparent="true"[^>]*disabled/,
    );

    const originalMode = workspace.playerExportSizeMode;
    const originalTransparency = workspace.playerExportTransparent;
    playerClick(workspace, 'player-export-size', { sizeMode: 'original' });
    playerClick(workspace, 'player-export-background', { transparent: 'true' });
    assert.equal(workspace.playerExportSizeMode, originalMode);
    assert.equal(workspace.playerExportTransparent, originalTransparency);

    workspace.closePlayerExport();
    await renderPromise;
    assert.equal(capturedSignal.aborted, true);
    assert.equal(workspace.playerExportOpen, false);
  }, { playable: true, playerRoot });
});

test('disabled Player share controls never invoke the share action', async () => {
  await withWorkspace(async (workspace) => {
    let shareCalls = 0;
    workspace.sharePlayerMaker = () => {
      shareCalls += 1;
    };
    const blockedShare = actionTarget('player-copy-maker-link');
    blockedShare.disabled = true;

    workspace.handlePlayerClick({ target: blockedShare });

    assert.equal(shareCalls, 0);
  }, { playable: true });
});

test('Player completion stays blocked until the exact current scene has rendered without missing PNGs', async () => {
  await withWorkspace(async (workspace) => {
    const document = workspace.runtimeDocument();
    const renderKey = workspace.playerRenderKey(document, workspace.playerRecipe);

    workspace.playerRenderState = { key: renderKey, status: 'pending', error: '' };
    assert.match(
      workspace.playerCompletionIssues(document, workspace.playerRecipe).join(' '),
      /Verifying every selected PNG/,
    );

    workspace.playerRenderState = { key: renderKey, status: 'error', error: 'PNG decode failed' };
    assert.match(
      workspace.playerCompletionIssues(document, workspace.playerRecipe).join(' '),
      /PNG decode failed/,
    );

    workspace.playerRenderState = { key: renderKey, status: 'ready', error: '' };
    assert.equal(
      workspace.playerCompletionIssues(document, workspace.playerRecipe).some((issue) => (
        issue.includes('Verifying every selected PNG') || issue.includes('PNG decode failed')
      )),
      false,
    );
  }, { playable: true });
});

test('Creator and Player publication states share one isolated quote and error contract', async () => {
  await withWorkspace(async (workspace) => {
    const expectedKeys = [
      'actions',
      'busy',
      'digest',
      'error',
      'relayTipMist',
      'relayTipQuotedAt',
      'stage',
      'status',
      'walrusStorageCostFrost',
      'walrusTotalCostFrost',
      'walrusWriteCostFrost',
    ].sort();
    assert.deepEqual(Object.keys(workspace.creatorPublishState).sort(), expectedKeys);
    assert.deepEqual(Object.keys(workspace.playerPublishState).sort(), expectedKeys);

    workspace.setCreatorPublishState({
      stage: 'encoded',
      relayTipMist: '9007199254740993',
      walrusStorageCostFrost: '2000000001',
      walrusWriteCostFrost: '3000000002',
      walrusTotalCostFrost: '5000000003',
      error: { code: 'UPLOAD_QUOTE_CHANGED', action: 'prepare', diagnostic: 'old quote' },
      actions: { prepare: true, register: false },
    });
    assert.equal(workspace.playerPublishState.stage, 'idle');
    assert.equal(workspace.playerPublishState.relayTipMist, null);

    workspace.setCreatorPublishState({
      error: null,
      relayTipMist: null,
      walrusStorageCostFrost: null,
      walrusWriteCostFrost: null,
      walrusTotalCostFrost: null,
      actions: { prepare: false, register: true },
    });
    assert.equal(workspace.creatorPublishState.stage, 'encoded', 'unmentioned state survives an incremental update');
    assert.equal(workspace.creatorPublishState.error, null);
    assert.equal(workspace.creatorPublishState.relayTipMist, null);
    assert.equal(workspace.creatorPublishState.actions.prepare, false);
    assert.equal(workspace.creatorPublishState.actions.register, true);
  }, { playable: true });
});

test('Creator and Player render the same guarded four-step fee modal with exact BigInt quotes', async () => {
  const creatorRoot = new FakeRoot();
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    const quote = {
      stage: 'encoded',
      status: 'Quote ready',
      busy: false,
      relayTipMist: '9007199254740993',
      relayTipQuotedAt: '2026-07-27T12:34:00.000Z',
      walrusStorageCostFrost: '2000000001',
      walrusWriteCostFrost: '3000000002',
      walrusTotalCostFrost: '5000000003',
      error: null,
      actions: { register: true },
    };
    workspace.creatorPublishOpen = true;
    workspace.playerPublishOpen = true;
    workspace.setCreatorPublishState(quote);
    workspace.setPlayerPublishState(quote);
    workspace.render();

    [
      ['creator', creatorRoot, 'makerCreatorPublishDialog'],
      ['player', playerRoot, 'makerPlayerPublishDialog'],
    ].forEach(([kind, root, dialogId]) => {
      assert.match(root.innerHTML, new RegExp(`data-action="close-${kind}-publish-backdrop"`));
      assert.match(root.innerHTML, new RegExp(`id="${dialogId}"[^>]*role="dialog" aria-modal="true"`));
      assert.equal(
        (root.innerHTML.match(new RegExp(`class="v4-chain-flow ${kind}"`, 'g')) || []).length,
        1,
        `${kind} must render exactly one shared publication flow and no legacy inline panel`,
      );
      assert.ok(
        root.innerHTML.indexOf('class="v4-modal-backdrop v4-chain-flow-backdrop"')
          < root.innerHTML.indexOf(`id="${dialogId}"`),
        `${kind} publication flow must live inside its modal backdrop`,
      );
      assert.match(root.innerHTML, /9,007,199,254,740,993 MIST/);
      assert.match(root.innerHTML, /datetime="2026-07-27T12:34:00\.000Z"/);
      assert.match(root.innerHTML, /9007199\.254740993 SUI/);
      assert.match(root.innerHTML, /2,000,000,001 FROST/);
      assert.match(root.innerHTML, /2\.000000001 WAL/);
      assert.match(root.innerHTML, /3,000,000,002 FROST/);
      assert.match(root.innerHTML, /3\.000000002 WAL/);
      assert.match(root.innerHTML, /5,000,000,003 FROST/);
      assert.match(root.innerHTML, /5\.000000003 WAL/);
      assert.match(root.innerHTML, /not a complete Sui gas estimate/);
      assert.match(root.innerHTML, /Confirm this quote/);
    });

    workspace.setCreatorPublishState({
      relayTipMist: 'invalid',
      walrusStorageCostFrost: null,
      walrusWriteCostFrost: null,
      walrusTotalCostFrost: null,
    });
    assert.doesNotMatch(creatorRoot.innerHTML, /class="v4-chain-fee"/);
    assert.match(creatorRoot.innerHTML, />2\. Register &amp; upload</);
  }, {
    creatorRoot,
    playerRoot,
    playable: true,
  });
});

test('publication quotes preserve exact grouping in all five supported locales', async () => {
  await withWorkspace(async (workspace) => {
    const amount = 9007199254740993n;
    const localeMap = {
      en: 'en-US',
      zh: 'zh-CN',
      ja: 'ja-JP',
      ko: 'ko-KR',
      vi: 'vi-VN',
    };
    workspace.creatorPublishOpen = true;
    workspace.setCreatorPublishState({
      stage: 'encoded',
      relayTipMist: String(amount),
      walrusStorageCostFrost: '1',
      walrusWriteCostFrost: '2',
      walrusTotalCostFrost: '3',
      actions: { register: true },
    });
    Object.entries(localeMap).forEach(([locale, numberLocale]) => {
      workspace.setLocale(locale, { render: false });
      const html = workspace.renderPublicationFlow('creator');
      assert.ok(
        html.includes(`${new Intl.NumberFormat(numberLocale).format(amount)} MIST`),
        `${locale} must format the full BigInt without precision loss`,
      );
    });
  }, { playable: true });
});

test('Creator and Player map every pending publication stage to one of four visible steps', async () => {
  await withWorkspace(async (workspace) => {
    const cases = [
      ['idle', 0, 1, 3],
      ['encoded', 1, 1, 2],
      ['register-pending', 1, 1, 2],
      ['registered', 1, 1, 2],
      ['uploaded', 2, 1, 1],
      ['certify-pending', 2, 1, 1],
      ['certified', 3, 1, 0],
      ['publish-pending', 3, 1, 0],
    ];
    for (const kind of ['creator', 'player']) {
      workspace[`${kind}PublishOpen`] = true;
      for (const [stage, completed, current, pending] of cases) {
        workspace[`${kind}PublishState`] = {
          ...workspace[`${kind}PublishState`],
          stage,
          digest: '',
          error: null,
        };
        const html = workspace.renderPublicationFlow(kind);
        assert.equal((html.match(/class="completed"/g) || []).length, completed, `${kind} ${stage} completed`);
        assert.equal((html.match(/class="current"/g) || []).length, current, `${kind} ${stage} current`);
        assert.equal((html.match(/class="pending"/g) || []).length, pending, `${kind} ${stage} pending`);
      }
      workspace[`${kind}PublishState`].stage = 'idle';
      workspace[`${kind}PublishState`].digest = '0xdone';
      const completedHtml = workspace.renderPublicationFlow(kind);
      assert.equal((completedHtml.match(/class="completed"/g) || []).length, 4);
      assert.doesNotMatch(completedHtml, /aria-current="step"/);
    }
  }, { playable: true });
});

test('Creator and Player classify quote/pending errors and never duplicate a review action', async () => {
  const creatorRoot = new FakeRoot();
  const playerRoot = new FakeRoot();
  const actions = { creator: [], player: [] };
  await withWorkspace(async (workspace) => {
    for (const kind of ['creator', 'player']) {
      workspace[`${kind}PublishOpen`] = true;
      workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`]({
        stage: 'register-pending',
        busy: false,
        error: {
          code: 'TRANSACTION_OUTCOME_PENDING',
          action: 'review',
          diagnostic: 'The signed transaction may already be on-chain.',
        },
        actions: { review: true },
      });
      const root = kind === 'creator' ? creatorRoot : playerRoot;
      assert.match(root.innerHTML, /The transaction outcome is still being confirmed/);
      assert.equal((root.innerHTML.match(new RegExp(`data-action="${kind}-publish-review"`, 'g')) || []).length, 1);
      assert.doesNotMatch(root.innerHTML, new RegExp(`data-action="${kind}-publish-retry"`));
      assert.doesNotMatch(root.innerHTML, new RegExp(`data-action="${kind}-publish-recover"`));
      (kind === 'creator' ? creatorClick : playerClick)(workspace, `${kind}-publish-review`);
      assert.deepEqual(actions[kind], ['review']);

      workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`]({
        error: {
          code: 'TRANSACTION_OUTCOME_PENDING',
          action: 'register',
          diagnostic: 'The signed registration is being checked.',
        },
        actions: { register: true, review: false },
      });
      assert.doesNotMatch(root.innerHTML, new RegExp(`data-action="${kind}-publish-retry"`));
      assert.match(root.innerHTML, new RegExp(`data-action="${kind}-publish-recover" data-publish-action="register"`));
      assert.match(root.innerHTML, /Check transaction status/);
      (kind === 'creator' ? creatorClick : playerClick)(
        workspace,
        `${kind}-publish-recover`,
        { publishAction: 'register' },
      );
      assert.deepEqual(actions[kind], ['review', 'register']);

      workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`]({
        error: {
          code: kind === 'creator' ? 'INSUFFICIENT_WAL_BALANCE' : 'INSUFFICIENT_SUI_BALANCE',
          action: 'prepare',
          diagnostic: 'Balance preflight failed.',
        },
        actions: { prepare: true, register: false },
      });
      assert.match(
        root.innerHTML,
        kind === 'creator'
          ? /The wallet does not have enough WAL/
          : /The wallet does not have enough SUI/,
      );

      workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`]({
        error: {
          code: 'UPLOAD_QUOTE_CHANGED',
          action: 'prepare',
          diagnostic: 'Walrus price changed.',
        },
        actions: { prepare: true, review: false },
      });
      assert.match(root.innerHTML, /The upload quote changed/);
      assert.match(root.innerHTML, new RegExp(`data-action="${kind}-publish-retry" data-publish-action="prepare"`));
      assert.match(root.innerHTML, /Prepare a new quote/);

      workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`]({
        stage: 'uploaded',
        error: {
          code: 'WALRUS_CERTIFICATION_NOT_VISIBLE',
          action: 'certify',
          diagnostic: 'The certification transaction is confirmed.',
        },
        actions: { certify: true, prepare: false, review: false },
      });
      assert.match(root.innerHTML, /Walrus certification succeeded; the Blob state is still syncing/);
      assert.match(root.innerHTML, /No new signature or fee is needed/);
      assert.match(root.innerHTML, /class="v4-chain-error is-syncing" role="status" aria-live="polite"/);
      assert.match(root.innerHTML, new RegExp(`data-action="${kind}-publish-retry" data-publish-action="certify"`));
      assert.match(root.innerHTML, /Check certification status again/);
      (kind === 'creator' ? creatorClick : playerClick)(
        workspace,
        `${kind}-publish-retry`,
        { publishAction: 'certify' },
      );
      assert.deepEqual(actions[kind], ['review', 'register', 'certify']);

      workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`]({
        error: {
          code: 'UPLOAD_RECOVERY_MISMATCH',
          action: 'resume',
          diagnostic: 'The saved upload no longer matches.',
        },
        actions: { resume: true, discard: true, prepare: false },
      });
      assert.match(root.innerHTML, /saved upload belongs to an earlier edit/);
      assert.match(root.innerHTML, new RegExp(`data-action="${kind}-publish-discard"`));
      (kind === 'creator' ? creatorClick : playerClick)(workspace, `${kind}-publish-discard`);
      assert.deepEqual(actions[kind], ['review', 'register', 'certify', 'discard']);
    }
  }, {
    creatorRoot,
    playerRoot,
    playable: true,
    callbacks: {
      onCreatorPublishAction: (action) => actions.creator.push(action),
      onPlayerPublishAction: (action) => actions.player.push(action),
    },
  });
});

test('busy Creator and Player close confirmation settles automatically without closing the modal', async () => {
  const creatorRoot = new FakeRoot();
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    for (const kind of ['creator', 'player']) {
      const root = kind === 'creator' ? creatorRoot : playerRoot;
      const click = kind === 'creator' ? creatorClick : playerClick;
      const setState = workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`].bind(workspace);
      workspace[`${kind}PublishOpen`] = true;
      setState({ busy: true, status: 'Signing', error: null });
      click(workspace, `close-${kind}-publish`);
      assert.equal(workspace[`${kind}PublishOpen`], true);
      assert.equal(workspace[`${kind}PublishCloseConfirm`], true);
      assert.match(root.innerHTML, /A release step is still running/);
      assert.match(root.innerHTML, /class="v4-chain-flow-content" inert aria-hidden="true"/);

      setState({ busy: true, status: 'Still signing' });
      assert.equal(workspace[`${kind}PublishCloseConfirm`], true);
      setState({
        busy: false,
        status: 'Finished',
        ...(kind === 'player' ? { error: { code: 'NETWORK_UNAVAILABLE', diagnostic: 'settled' } } : {}),
      });
      assert.equal(workspace[`${kind}PublishOpen`], true);
      assert.equal(workspace[`${kind}PublishCloseConfirm`], false);
      assert.doesNotMatch(root.innerHTML, /A release step is still running/);
    }
  }, {
    creatorRoot,
    playerRoot,
    playable: true,
  });
});

test('a busy Player release cannot be force-closed to edit behind its reviewed snapshot', async () => {
  const playerRoot = new FakeRoot();
  await withWorkspace(async (workspace) => {
    workspace.playerPublishOpen = true;
    workspace.setPlayerPublishState({ busy: true, status: 'Preparing the reviewed OC' });
    playerClick(workspace, 'close-player-publish');

    assert.equal(workspace.playerPublishCloseConfirm, true);
    assert.doesNotMatch(playerRoot.innerHTML, /data-action="force-close-player-publish"/);

    workspace.requestClosePlayerPublish({ force: true });
    assert.equal(workspace.playerPublishOpen, true);
    assert.equal(workspace.playerPublishCloseConfirm, true);
  }, { playerRoot, playable: true });
});

test('publication close confirmation owns focus, Escape restores the close button, and listeners clean up', async () => {
  class FocusNode {
    constructor(name, active, children = []) {
      this.name = name;
      this.active = active;
      this.children = children;
      this.hidden = false;
      this.focusCount = 0;
    }

    focus() {
      this.focusCount += 1;
      this.active.current = this;
    }

    querySelectorAll() {
      return this.children;
    }

    contains(node) {
      return node === this || this.children.includes(node);
    }

    getAttribute() {
      return null;
    }
  }

  const previousDocument = globalThis.document;
  const active = { current: null };
  const roots = {};
  for (const kind of ['creator', 'player']) {
    const root = new FakeRoot();
    const keep = new FocusNode(`${kind}-keep`, active);
    const force = new FocusNode(`${kind}-force`, active);
    const close = new FocusNode(`${kind}-close`, active);
    const normalAction = new FocusNode(`${kind}-action`, active);
    const dialog = new FocusNode(`${kind}-dialog`, active, [close, normalAction]);
    const confirm = new FocusNode(`${kind}-confirm`, active, [keep, force]);
    const cap = kind[0].toUpperCase() + kind.slice(1);
    root.selectors[`#maker${cap}PublishDialog`] = dialog;
    root.selectors[`#maker${cap}PublishCloseConfirm`] = confirm;
    root.selectors[`[data-action="keep-${kind}-publish-open"]`] = keep;
    root.selectors[`[data-action="close-${kind}-publish"]`] = close;
    root.selectors[kind === 'creator' ? '[data-action="publish"]' : '[data-action="player-complete"]'] = normalAction;
    roots[kind] = { root, keep, force, close, normalAction };
  }

  try {
    await withWorkspace(async (workspace) => {
      globalThis.document = {
        get activeElement() {
          return active.current;
        },
      };
      for (const kind of ['creator', 'player']) {
        const { keep, force, close, normalAction } = roots[kind];
        const setState = workspace[`set${kind[0].toUpperCase()}${kind.slice(1)}PublishState`].bind(workspace);
        workspace[`${kind}PublishOpen`] = true;
        setState({ busy: true });
        workspace.requestClosePublication(kind);
        assert.equal(active.current, keep);

        active.current = normalAction;
        let prevented = false;
        workspace.handlePublishDialogKeydown(kind, {
          key: 'Tab',
          shiftKey: false,
          preventDefault: () => { prevented = true; },
        });
        assert.equal(prevented, true);
        assert.equal(active.current, keep, `${kind} Tab enters the exclusive confirmation`);

        active.current = keep;
        workspace.handlePublishDialogKeydown(kind, {
          key: 'Tab',
          shiftKey: true,
          preventDefault() {},
        });
        assert.equal(active.current, force, `${kind} Shift+Tab wraps inside confirmation`);

        workspace.handlePublishDialogKeydown(kind, { key: 'Escape', preventDefault() {} });
        assert.equal(workspace[`${kind}PublishCloseConfirm`], false);
        assert.equal(workspace[`${kind}PublishOpen`], true);
        assert.equal(active.current, close);
      }
    }, {
      creatorRoot: roots.creator.root,
      playerRoot: roots.player.root,
      playable: true,
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.ok(roots.player.root.addedListeners.some(([type]) => type === 'keydown'));
  assert.ok(roots.player.root.removedListeners.some(([type]) => type === 'keydown'));
});

test('Player session writes stay ordered and only the newest snapshot may report saved', async () => {
  const writes = [];
  const releases = [];
  await withWorkspace(async (workspace) => {
    workspace.context.walletAddress = '0xplayer';
    workspace.playerProfile.name = 'First';
    workspace.markPlayerSessionDirty();
    const first = workspace.savePlayerSession();
    workspace.playerProfile.name = 'Second';
    workspace.markPlayerSessionDirty();
    const second = workspace.savePlayerSession();

    await Promise.resolve();
    assert.equal(writes.length, 1, 'the second write waits for the first');
    assert.equal(writes[0].profile.name, 'First');
    releases.shift()();
    await first;
    assert.notEqual(workspace.playerSaveState, 'saved', 'an older snapshot cannot mark the newer revision saved');

    await Promise.resolve();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].profile.name, 'Second');
    releases.shift()();
    await second;
    assert.equal(workspace.playerSaveState, 'saved');
  }, {
    playable: true,
    async savePlayerSessionRecord(_key, session) {
      writes.push(structuredClone(session));
      await new Promise((resolve) => releases.push(resolve));
    },
  });
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
    assert.match(playerRoot.innerHTML, /data-item-id="blocked-item"[^>]*aria-disabled="true"/);
    assert.match(playerRoot.innerHTML, /v4-player-item-reason-blocked-item/);

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

    assert.match(
      playerRoot.innerHTML,
      /data-action="player-none"[^>]*aria-disabled="true" aria-describedby="v4PlayerRemovePartReason"/,
    );
    assert.match(
      playerRoot.innerHTML,
      /id="v4PlayerRemovePartReason" class="v4-player-disabled-reason"/,
    );
    assert.match(
      playerRoot.innerHTML,
      /data-action="player-clear"[^>]*aria-disabled="true" aria-describedby="v4PlayerClearOptionalReason"/,
    );
    assert.match(
      playerRoot.innerHTML,
      /id="v4PlayerClearOptionalReason" class="v4-player-disabled-reason"/,
    );
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

test('an unresolved on-chain publication makes the Creator document read-only until recovery is cleared', async () => {
  const creatorRoot = new FakeRoot();
  let publicationPending = true;
  await withWorkspace(async (workspace) => {
    const before = workspace.getDocument();
    const { part, item, style } = workspace.selectedCreatorRecords();
    const originalStyleCount = item.styles.length;
    const originalX = style.transform.x;

    assert.match(creatorRoot.innerHTML, /Publication recovery is pending/);
    assert.equal(workspace.executeDocument('Unsafe edit', ({ document }) => {
      document.metadata.name = 'Must not be committed';
    }), false);
    creatorClick(workspace, 'add-style');
    await workspace.handleCreatorChange({
      target: { dataset: { action: 'style-x' }, value: '999', type: 'number' },
    });

    const lockedDocument = workspace.getDocument();
    const lockedPart = lockedDocument.parts.find((candidate) => candidate.id === part.id);
    const lockedItem = lockedPart.items.find((candidate) => candidate.id === item.id);
    const lockedStyle = lockedItem.styles.find((candidate) => candidate.id === style.id);
    assert.equal(lockedDocument.metadata.name, before.metadata.name);
    assert.equal(lockedItem.styles.length, originalStyleCount);
    assert.equal(lockedStyle.transform.x, originalX);
    assert.equal(workspace.store.getState().dirty, false);

    publicationPending = false;
    creatorClick(workspace, 'add-style');
    assert.equal(workspace.selectedCreatorRecords().item.styles.length, originalStyleCount + 1);
  }, {
    creatorRoot,
    callbacks: {
      canMutateDocument: () => !publicationPending,
      documentMutationBlockedMessage: () => 'Publication recovery is pending',
    },
  });
});

test('Creator lifecycle management delegates to the shell and can reopen publication without publishing', async () => {
  const releaseDialog = {
    focusCount: 0,
    focus() {
      this.focusCount += 1;
    },
  };
  const creatorRoot = new FakeRoot({
    '#makerCreatorPublishDialog': releaseDialog,
  });
  let lifecycleCalls = 0;
  let publishCalls = 0;
  let publishActionCalls = 0;

  await withWorkspace(async (workspace) => {
    await workspace.setContext({
      makerKey: workspace.makerKey,
      lifecycle: {
        label: 'Version draft',
        manageLabel: 'Manage Maker lifecycle',
        badgeClass: 'version-draft',
      },
    });

    assert.match(
      creatorRoot.innerHTML,
      /class="maker-lifecycle-badge version-draft" data-action="manage-lifecycle" aria-label="Manage Maker lifecycle">Version draft<\/button>/,
    );
    creatorClick(workspace, 'manage-lifecycle');
    assert.equal(lifecycleCalls, 1);
    assert.equal(workspace.creatorPublishOpen, false);
    assert.equal(publishCalls, 0);
    assert.equal(publishActionCalls, 0);

    assert.equal(workspace.openCreatorReleaseManager(), true);
    assert.equal(workspace.creatorPublishOpen, true);
    assert.equal(releaseDialog.focusCount, 1);
    assert.equal(publishCalls, 0);
    assert.equal(publishActionCalls, 0);
  }, {
    creatorRoot,
    callbacks: {
      onManageLifecycle() {
        lifecycleCalls += 1;
      },
      onPublish() {
        publishCalls += 1;
      },
      onCreatorPublishAction() {
        publishActionCalls += 1;
      },
    },
  });
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
