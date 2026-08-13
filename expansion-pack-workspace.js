/**
 * Standalone Expansion Pack authoring workspace.
 *
 * This module deliberately owns no router, modal, viewport height or nested
 * scrolling. A host can mount it in a route or dialog and remain the single
 * scroll owner. The controller is UI-independent and uses the v8 Pack draft
 * store as its only persistence boundary.
 */

import {
  EXPANSION_PACK_PART_MODES,
  addExpansionPackColorChannel,
  addExpansionPackColorSwatch,
  addExpansionPackItem,
  addExpansionPackLayerTrack,
  addExpansionPackOptionalPart,
  addExpansionPackRule,
  addExpansionPackStyle,
  createExpansionPackProject,
  preflightExpansionPackProject,
  rehydrateExpansionPackProject,
  moveExpansionPackLayerTrack,
  removeExpansionPackColorChannel,
  removeExpansionPackColorSwatch,
  removeExpansionPackItem,
  removeExpansionPackLayerTrack,
  removeExpansionPackPart,
  removeExpansionPackRule,
  removeExpansionPackStyle,
  renameExpansionPack,
  renameExpansionPackItem,
  renameExpansionPackPart,
  renameExpansionPackStyle,
  renameExpansionPackLayerTrack,
  setExpansionPackLayerTrackLocked,
  setExpansionPackPartMode,
  updateExpansionPackColorChannel,
  updateExpansionPackColorSwatch,
  updateExpansionPackItemRules,
  updateExpansionPackPartRules,
  updateExpansionPackRule,
  updateExpansionPackStyle,
  updateExpansionPackStyleRules,
} from './expansion-pack-project.js';
import {
  createExpansionPackDraftStore,
  expansionPackDraftKey,
} from './expansion-pack-draft-store.js';
import { BLEND_MODES } from './maker-renderer.js';
import {
  MAKER_DEFINITION_EDITOR_SECTION_IDS,
  MAKER_DEFINITION_EDITOR_SECTIONS,
  createMakerPartListModel,
  normalizeMakerDefinitionEditorSection,
  renderMakerPartList,
} from './maker-definition-editor.js';
import { renderMakerEditorShell } from './maker-editor-shell.js';
import { renderDefinitionCombinationRuleControl } from './maker-definition-rule-control.js';

export const EXPANSION_PACK_WORKSPACE_SAVE_PHASES = Object.freeze({
  NEW: 'new',
  DIRTY: 'dirty',
  SAVING: 'saving',
  SAVED: 'saved',
  CONFLICT: 'conflict',
  FAILED: 'failed',
});

export const EXPANSION_PACK_WORKSPACE_LAYOUT = Object.freeze({
  scrollOwner: 'host',
  nestedScroll: false,
  mountModes: Object.freeze(['route', 'modal']),
});

export class ExpansionPackWorkspaceError extends Error {
  constructor(message, code = 'expansion-pack-workspace-error', details = {}) {
    super(message);
    this.name = 'ExpansionPackWorkspaceError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value) {
  return String(value ?? '').trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function idOf(value) {
  return text(value?.id ?? value?.key);
}

function itemTargetId(item) {
  return text(item?.extendsItemId ?? item?.targetItemId);
}

function partTargetId(part) {
  return text(part?.extendsPartId ?? part?.targetPartId);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function projectIdentity(project) {
  return {
    walletAddress: text(project?.ownerWalletAddress).toLowerCase(),
    parentRootId: text(project?.parentBinding?.rootMakerId),
    parentVersion: text(project?.parentBinding?.versionNumber),
    parentBindingKind: text(project?.parentBinding?.kind),
    parentVersionId: text(project?.parentBinding?.versionId),
    parentReleaseId: text(project?.parentBinding?.releaseId),
    parentManifestBlobId: text(project?.parentBinding?.manifestBlobId),
    parentManifestHash: text(project?.parentBinding?.manifestHash).replace(/^0x/i, '').toLowerCase(),
    packId: text(project?.packId),
  };
}

function assertProjectIdentity(expected, project, context = 'Expansion Pack project') {
  const actual = projectIdentity(project);
  const mismatches = Object.keys(expected).filter((field) => expected[field] !== actual[field]);
  if (mismatches.length) {
    throw new ExpansionPackWorkspaceError(
      `${context} does not match this workspace key.`,
      'expansion-pack-workspace-identity-mismatch',
      { expected, actual, mismatches },
    );
  }
  return project;
}

function countMaker(maker) {
  const parts = list(maker?.parts);
  return {
    parts: parts.length,
    items: parts.reduce((total, part) => total + list(part?.items).length, 0),
    styles: parts.reduce((total, part) => (
      total + list(part?.items).reduce((itemTotal, item) => itemTotal + list(item?.styles).length, 0)
    ), 0),
    assets: list(maker?.assets).length,
  };
}

export function createExpansionPackParentInfo(projectValue) {
  const project = rehydrateExpansionPackProject(projectValue);
  const maker = project.parentSnapshot;
  const binding = project.parentBinding || {};
  const inheritance = project.inheritance || {};
  const parts = list(maker.parts).map((part) => ({
    id: idOf(part),
    name: text(part?.name) || idOf(part),
    required: part?.required === true,
    items: list(part?.items).map((item) => ({
      id: idOf(item),
      name: text(item?.name) || idOf(item),
      styles: list(item?.styles).map((style) => ({
        id: idOf(style),
        name: text(style?.name) || idOf(style),
      })),
    })),
  }));
  return deepFreeze({
    readonly: true,
    rootMakerId: text(project.parentBinding?.rootMakerId),
    versionNumber: text(project.parentBinding?.versionNumber),
    versionId: text(project.parentBinding?.versionId),
    manifestHash: text(project.parentBinding?.manifestHash),
    bindingKind: text(binding.kind),
    publishable: binding.publishable === true,
    releaseId: text(binding.releaseId),
    manifestBlobId: text(binding.manifestBlobId),
    bindingIdentity: text(binding.identity),
    binding: {
      kind: text(binding.kind),
      publishable: binding.publishable === true,
      releaseId: text(binding.releaseId),
      versionId: text(binding.versionId),
      versionNumber: text(binding.versionNumber),
      manifestBlobId: text(binding.manifestBlobId),
      manifestHash: text(binding.manifestHash),
      identity: text(binding.identity),
    },
    inheritance: {
      schemaVersion: text(inheritance.schemaVersion),
      mode: text(inheritance.mode),
      contracts: [
        { id: 'documentSchema', mode: text(inheritance.documentSchema) },
        { id: 'parentMetadata', mode: text(inheritance.parentMetadata) },
        { id: 'canvas', mode: text(inheritance.canvas) },
        { id: 'renderer', mode: text(inheritance.renderer) },
        { id: 'layerTracks', mode: text(inheritance.layerTracks) },
        { id: 'baseDefinitions', mode: text(inheritance.baseDefinitions) },
        { id: 'baseAssets', mode: text(inheritance.baseAssets) },
        { id: 'selectionRules', mode: text(inheritance.selectionRules) },
        { id: 'smartColorChannels', mode: text(inheritance.smartColorChannels) },
        { id: 'defaultRecipe', mode: text(inheritance.defaultRecipe) },
        { id: 'livingContent', mode: text(inheritance.livingContent) },
        { id: 'wardrobeCompatibility', mode: text(inheritance.wardrobeCompatibility) },
        { id: 'parentCommerce', mode: text(inheritance.parentCommerce) },
        { id: 'license', mode: text(inheritance.license) },
      ],
    },
    name: text(maker?.metadata?.name) || text(maker?.name) || 'Parent Maker',
    creator: text(maker?.metadata?.creator),
    canvas: {
      width: Number(maker?.canvas?.width || 0),
      height: Number(maker?.canvas?.height || 0),
    },
    counts: countMaker(maker),
    layerTracks: clone(list(maker.layerTracks)),
    colorChannels: clone(list(maker.colorChannels ?? maker.palettes)),
    rules: clone(list(maker.rules)),
    parts,
  });
}

export function createExpansionPackWorkspaceTree(projectValue) {
  const project = rehydrateExpansionPackProject(projectValue);
  const parentComposable = project.parentSnapshot?.extensions?.composableV6;
  const supportsComposableV6 = Boolean(
    parentComposable
    && typeof parentComposable === 'object'
    && !Array.isArray(parentComposable)
    && text(parentComposable.profile?.mode).toUpperCase() === 'COMPOSABLE'
    && parentComposable.compatibility
    && typeof parentComposable.compatibility === 'object'
    && !Array.isArray(parentComposable.compatibility)
  );
  const parentPartMap = new Map(list(project.parentSnapshot?.parts).map((part) => [idOf(part), part]));
  const parts = list(project.pack?.parts).map((part) => {
    const targetPartId = partTargetId(part);
    const localPartId = idOf(part);
    const parentPart = targetPartId ? parentPartMap.get(targetPartId) : null;
    return {
      id: localPartId || targetPartId,
      kind: targetPartId ? 'parent-extension' : 'optional-part',
      readonlyName: Boolean(targetPartId),
      name: targetPartId
        ? text(parentPart?.name) || targetPartId
        : text(part?.name) || localPartId,
      required: false,
      allowRemove: true,
      rules: {
        requires: clone(list(part.requires)),
        excludes: clone(list(part.excludes)),
        visibleWhen: clone(part.visibleWhen ?? null),
      },
      wardrobeMode: text(project.pack?.wardrobe?.partModes?.[localPartId]) || EXPANSION_PACK_PART_MODES.FIXED,
      items: list(part?.items).map((item) => {
        const targetItemId = itemTargetId(item);
        const localItemId = idOf(item);
        const parentItem = targetItemId
          ? list(parentPart?.items).find((candidate) => idOf(candidate) === targetItemId)
          : null;
        return {
          id: localItemId || targetItemId,
          kind: targetItemId ? 'parent-item-extension' : 'pack-item',
          readonlyName: Boolean(targetItemId),
          name: targetItemId
            ? text(parentItem?.name) || targetItemId
            : text(item?.name) || localItemId,
          rules: {
            requires: clone(list(item.requires)),
            excludes: clone(list(item.excludes)),
            visibleWhen: clone(item.visibleWhen ?? null),
          },
          styles: list(item?.styles).map((style) => ({
            id: idOf(style),
            name: text(style?.name) || idOf(style),
            assetId: text(style?.assetId),
            layerTrackId: text(style?.layerTrackId),
            transform: {
              x: Number(style?.transform?.x || 0),
              y: Number(style?.transform?.y || 0),
              scale: Number(style?.transform?.scale ?? 1),
              rotation: Number(style?.transform?.rotation || 0),
            },
            opacity: Number(style?.opacity ?? 1),
            blendMode: text(style?.blendMode) || 'normal',
            colorChannelId: text(style?.colorChannelId ?? style?.paletteId),
            rules: {
              requires: clone(list(style.requires)),
              excludes: clone(list(style.excludes)),
              visibleWhen: clone(style.visibleWhen ?? null),
            },
          })),
        };
      }),
    };
  });
  return deepFreeze({
    packId: text(project.packId),
    namespace: text(project.namespace),
    name: text(project.name),
    version: text(project.version),
    commerce: clone(project.pack?.commerce || {}),
    layerTracks: clone(list(project.pack?.layerTracks)),
    colorChannels: clone(list(project.pack?.colorChannels ?? project.pack?.palettes)),
    rules: clone(list(project.pack?.rules)),
    supportsComposableV6,
    parts,
  });
}

export function createExpansionPackPreviewModel(projectValue) {
  const project = rehydrateExpansionPackProject(projectValue);
  const preflight = preflightExpansionPackProject(project);
  const merged = preflight.compatibility?.merged || preflight.preview || null;
  const parentCounts = countMaker(project.parentSnapshot);
  const mergedCounts = merged ? countMaker(merged) : null;
  const packTree = createExpansionPackWorkspaceTree(project);
  const additions = {
    optionalParts: packTree.parts.filter((part) => part.kind === 'optional-part').length,
    items: packTree.parts.reduce((total, part) => (
      total + part.items.filter((item) => item.kind === 'pack-item').length
    ), 0),
    styles: packTree.parts.reduce((total, part) => (
      total + part.items.reduce((itemTotal, item) => itemTotal + item.styles.length, 0)
    ), 0),
  };
  const localParent = project.parentBinding?.kind === 'local-draft';
  const exactPublishedParent = project.parentBinding?.kind === 'published-release'
    && project.parentBinding?.publishable === true;
  const contentReady = Boolean(merged && preflight.valid);
  const publishable = preflight.publishable === true;
  return deepFreeze({
    status: !merged
      ? 'blocked'
      : !preflight.valid
        ? 'ready-with-issues'
        : publishable
          ? 'publishable'
          : 'content-ready-local-parent',
    contentReady,
    publishable,
    parentBinding: {
      kind: text(project.parentBinding?.kind),
      localParent,
      exactPublishedParent,
      releaseId: text(project.parentBinding?.releaseId),
      manifestBlobId: text(project.parentBinding?.manifestBlobId),
      manifestHash: text(project.parentBinding?.manifestHash),
    },
    issues: clone(preflight.issues),
    additions,
    parentCounts,
    mergedCounts,
    maker: merged ? clone(merged) : null,
  });
}

function saveLabel(save) {
  switch (save.phase) {
    case EXPANSION_PACK_WORKSPACE_SAVE_PHASES.NEW: return 'Not saved yet';
    case EXPANSION_PACK_WORKSPACE_SAVE_PHASES.DIRTY: return 'Unsaved changes';
    case EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING: return 'Saving…';
    case EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED:
      return save.savedAt ? `Saved · ${new Date(save.savedAt).toLocaleTimeString()}` : 'Saved';
    case EXPANSION_PACK_WORKSPACE_SAVE_PHASES.CONFLICT: return 'Newer draft found · reload required';
    case EXPANSION_PACK_WORKSPACE_SAVE_PHASES.FAILED: return 'Save failed · retry';
    default: return 'Unknown save state';
  }
}

function ensureStore(store) {
  if (!store || typeof store !== 'object') {
    throw new ExpansionPackWorkspaceError('Expansion Pack draft store is required.', 'missing-draft-store');
  }
  ['load', 'save'].forEach((method) => {
    if (typeof store[method] !== 'function') {
      throw new ExpansionPackWorkspaceError(
        `Expansion Pack draft store must implement ${method}().`,
        'invalid-draft-store',
        { method },
      );
    }
  });
  return store;
}

function publicProject(project) {
  return rehydrateExpansionPackProject(project);
}

/**
 * Create or resume one independent Expansion Pack workspace.
 *
 * New projects require parentMaker + walletAddress + packId. Pass resume:false
 * to force an empty local project for a new unique Pack id.
 */
export async function createExpansionPackWorkspace(options = {}) {
  const store = ensureStore(options.store || createExpansionPackDraftStore({
    indexedDB: options.indexedDB ?? globalThis.indexedDB,
    clock: options.clock,
  }));
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  let project = options.project ? rehydrateExpansionPackProject(options.project) : null;
  if (!project) {
    project = createExpansionPackProject(options.parentMaker, {
      ...(options.projectOptions || {}),
      packId: options.packId ?? options.projectOptions?.packId,
      namespace: options.namespace ?? options.projectOptions?.namespace,
      name: options.name ?? options.projectOptions?.name,
      version: options.version ?? options.projectOptions?.version,
      walletAddress: options.walletAddress ?? options.projectOptions?.walletAddress,
      ...(Object.hasOwn(options, 'parentRelease')
        ? { parentRelease: options.parentRelease }
        : {}),
      now: Number(clock()),
    });
  }
  const identity = projectIdentity(project);
  let persistedRevision = null;
  let savedAt = null;
  let resumed = false;
  if (options.resume !== false) {
    const record = await store.load(identity);
    if (record) {
      project = assertProjectIdentity(
        identity,
        rehydrateExpansionPackProject(record.project),
        'Persisted Expansion Pack draft',
      );
      persistedRevision = Number.isSafeInteger(record.revision) ? record.revision : null;
      savedAt = Number.isFinite(record.savedAt) ? record.savedAt : null;
      resumed = true;
    }
  }

  let dirty = !resumed;
  let mutationRevision = 0;
  let saveState = {
    phase: resumed
      ? EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED
      : EXPANSION_PACK_WORKSPACE_SAVE_PHASES.NEW,
    savedAt,
    persistedRevision,
    remoteRevision: null,
    savingRevision: null,
    error: '',
  };
  let preview = createExpansionPackPreviewModel(project);
  let parentInfo = createExpansionPackParentInfo(project);
  let tree = createExpansionPackWorkspaceTree(project);
  let destroyed = false;
  let saveTail = Promise.resolve();
  const listeners = new Set();

  const snapshot = () => deepFreeze({
    identity: clone(identity),
    mutationRevision,
    project: publicProject(project),
    parent: parentInfo,
    tree,
    preview,
    revision: persistedRevision,
    dirty,
    save: {
      ...clone(saveState),
      label: saveLabel(saveState),
    },
    layout: EXPANSION_PACK_WORKSPACE_LAYOUT,
  });

  const notify = (reason) => {
    if (destroyed) return;
    const state = snapshot();
    listeners.forEach((listener) => listener(state, reason));
  };

  const rebuildModels = () => {
    parentInfo = createExpansionPackParentInfo(project);
    tree = createExpansionPackWorkspaceTree(project);
    preview = createExpansionPackPreviewModel(project);
  };

  const change = (nextProject, reason) => {
    if (destroyed) throw new ExpansionPackWorkspaceError('Expansion Pack workspace is destroyed.');
    project = rehydrateExpansionPackProject(nextProject);
    mutationRevision += 1;
    dirty = true;
    saveState = {
      ...saveState,
      phase: saveState.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING
        ? EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING
        : EXPANSION_PACK_WORKSPACE_SAVE_PHASES.DIRTY,
      error: '',
    };
    rebuildModels();
    notify(reason);
    return snapshot();
  };

  const api = {
    getState: snapshot,
    getPreviewModel() {
      return createExpansionPackPreviewModel(project);
    },
    getParentInfo() {
      return createExpansionPackParentInfo(project);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Workspace listener must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addOptionalPart(input) {
      return change(addExpansionPackOptionalPart(project, input, { now: Number(clock()) }), 'add-part');
    },
    addItem(input) {
      return change(addExpansionPackItem(project, input, { now: Number(clock()) }), 'add-item');
    },
    addStyle(input) {
      return change(addExpansionPackStyle(project, input, { now: Number(clock()) }), 'add-style');
    },
    addLayerTrack(track) {
      return change(addExpansionPackLayerTrack(project, track, { now: Number(clock()) }), 'add-layer-track');
    },
    renameLayerTrack(trackId, name) {
      return change(renameExpansionPackLayerTrack(project, trackId, name, { now: Number(clock()) }), 'rename-layer-track');
    },
    setLayerTrackLocked(trackId, locked) {
      return change(setExpansionPackLayerTrackLocked(project, trackId, locked, { now: Number(clock()) }), 'lock-layer-track');
    },
    moveLayerTrack(trackId, targetIndex) {
      return change(moveExpansionPackLayerTrack(project, trackId, targetIndex, { now: Number(clock()) }), 'move-layer-track');
    },
    removeLayerTrack(trackId) {
      return change(removeExpansionPackLayerTrack(project, trackId, { now: Number(clock()) }), 'remove-layer-track');
    },
    addColorChannel(channel) {
      return change(addExpansionPackColorChannel(project, channel, { now: Number(clock()) }), 'add-color-channel');
    },
    updateColorChannel(channelId, patch) {
      return change(updateExpansionPackColorChannel(project, channelId, patch, { now: Number(clock()) }), 'update-color-channel');
    },
    removeColorChannel(channelId) {
      return change(removeExpansionPackColorChannel(project, channelId, { now: Number(clock()) }), 'remove-color-channel');
    },
    addColorSwatch(channelId, swatch) {
      return change(addExpansionPackColorSwatch(project, channelId, swatch, { now: Number(clock()) }), 'add-color-swatch');
    },
    updateColorSwatch(channelId, swatchId, patch) {
      return change(updateExpansionPackColorSwatch(project, channelId, swatchId, patch, { now: Number(clock()) }), 'update-color-swatch');
    },
    removeColorSwatch(channelId, swatchId) {
      return change(removeExpansionPackColorSwatch(project, channelId, swatchId, { now: Number(clock()) }), 'remove-color-swatch');
    },
    addRule(rule) {
      return change(addExpansionPackRule(project, rule, { now: Number(clock()) }), 'add-rule');
    },
    updateRule(ruleId, patch) {
      return change(updateExpansionPackRule(project, ruleId, patch, { now: Number(clock()) }), 'update-rule');
    },
    removeRule(ruleId) {
      return change(removeExpansionPackRule(project, ruleId, { now: Number(clock()) }), 'remove-rule');
    },
    updatePartRules(partId, patch) {
      return change(updateExpansionPackPartRules(project, partId, patch, { now: Number(clock()) }), 'update-part-rules');
    },
    updateItemRules(partId, itemId, patch) {
      return change(updateExpansionPackItemRules(project, partId, itemId, patch, { now: Number(clock()) }), 'update-item-rules');
    },
    updateStyleRules(partId, itemId, styleId, patch) {
      return change(updateExpansionPackStyleRules(project, partId, itemId, styleId, patch, { now: Number(clock()) }), 'update-style-rules');
    },
    setPartMode(partId, mode) {
      return change(setExpansionPackPartMode(project, partId, mode, { now: Number(clock()) }), 'set-part-mode');
    },
    renamePack(name) {
      return change(renameExpansionPack(project, name, { now: Number(clock()) }), 'rename-pack');
    },
    renamePart(partId, name) {
      return change(renameExpansionPackPart(project, partId, name, { now: Number(clock()) }), 'rename-part');
    },
    renameItem(partId, itemId, name) {
      return change(
        renameExpansionPackItem(project, partId, itemId, name, { now: Number(clock()) }),
        'rename-item',
      );
    },
    renameStyle(partId, itemId, styleId, name) {
      return change(
        renameExpansionPackStyle(project, partId, itemId, styleId, name, { now: Number(clock()) }),
        'rename-style',
      );
    },
    removePart(partId) {
      return change(removeExpansionPackPart(project, partId, { now: Number(clock()) }), 'remove-part');
    },
    removeItem(partId, itemId) {
      return change(
        removeExpansionPackItem(project, partId, itemId, { now: Number(clock()) }),
        'remove-item',
      );
    },
    removeStyle(partId, itemId, styleId) {
      return change(
        removeExpansionPackStyle(project, partId, itemId, styleId, { now: Number(clock()) }),
        'remove-style',
      );
    },
    updateStyle(partId, itemId, styleId, patch, definitions = {}) {
      return change(
        updateExpansionPackStyle(project, partId, itemId, styleId, patch, {
          ...definitions,
          now: Number(clock()),
        }),
        'update-style',
      );
    },
    save() {
      const operation = saveTail.then(async () => {
        if (destroyed) throw new ExpansionPackWorkspaceError('Expansion Pack workspace is destroyed.');
        if (!dirty && persistedRevision !== null) {
          return {
            saved: false,
            skipped: true,
            conflict: false,
            persistedRevision,
            key: expansionPackDraftKey(identity),
          };
        }
        const capturedProject = publicProject(project);
        const capturedMutationRevision = mutationRevision;
        const expectedRevision = persistedRevision;
        const requestedRevision = expectedRevision === null ? 1 : expectedRevision + 1;
        saveState = {
          ...saveState,
          phase: EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING,
          savingRevision: requestedRevision,
          error: '',
        };
        notify('save-started');
        try {
          const result = await store.save(identity, capturedProject, {
            expectedRevision,
            revision: requestedRevision,
          });
          if (result?.saved) {
            persistedRevision = result.persistedRevision;
            savedAt = result.savedAt ?? Number(clock());
            const changedWhileSaving = mutationRevision !== capturedMutationRevision;
            dirty = changedWhileSaving;
            saveState = {
              phase: changedWhileSaving
                ? EXPANSION_PACK_WORKSPACE_SAVE_PHASES.DIRTY
                : EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED,
              savedAt,
              persistedRevision,
              remoteRevision: null,
              savingRevision: null,
              error: '',
            };
          } else if (result?.conflict) {
            dirty = true;
            saveState = {
              ...saveState,
              phase: EXPANSION_PACK_WORKSPACE_SAVE_PHASES.CONFLICT,
              persistedRevision,
              remoteRevision: Number.isSafeInteger(result.persistedRevision)
                ? result.persistedRevision
                : null,
              savingRevision: null,
              error: 'A newer Expansion Pack draft already exists.',
            };
          } else {
            throw new ExpansionPackWorkspaceError(
              'Expansion Pack draft store returned an unconfirmed save.',
              'unconfirmed-expansion-pack-save',
            );
          }
          notify('save-finished');
          return result;
        } catch (error) {
          dirty = true;
          saveState = {
            ...saveState,
            phase: EXPANSION_PACK_WORKSPACE_SAVE_PHASES.FAILED,
            savingRevision: null,
            error: error?.message || String(error),
          };
          notify('save-failed');
          throw error;
        }
      });
      saveTail = operation.catch(() => undefined);
      return operation;
    },
    async flush() {
      if (destroyed) throw new ExpansionPackWorkspaceError('Expansion Pack workspace is destroyed.');
      const flushIdentity = clone(identity);
      let attempts = 0;

      // A save may already be running when pagehide/visibilitychange fires.
      // Wait for it first, then persist any mutation that landed while that
      // snapshot was in flight. The controller identity is immutable, so this
      // queue can never drift to a Pack opened later by the host workspace.
      await saveTail;
      while (dirty) {
        attempts += 1;
        if (attempts > 10) {
          throw new ExpansionPackWorkspaceError(
            'Expansion Pack kept changing while the save queue was being flushed.',
            'expansion-pack-flush-did-not-quiesce',
            { identity: flushIdentity },
          );
        }
        const result = await api.save();
        if (result?.conflict) {
          return {
            saved: false,
            conflict: true,
            identity: flushIdentity,
            persistedRevision,
            remoteRevision: saveState.remoteRevision,
          };
        }
        await saveTail;
      }

      return {
        saved: true,
        conflict: false,
        identity: flushIdentity,
        persistedRevision,
        savedAt,
      };
    },
    async reload({ force = false } = {}) {
      await saveTail;
      if (dirty && !force) {
        throw new ExpansionPackWorkspaceError(
          'Save or explicitly discard unsaved Pack changes before reloading.',
          'unsaved-expansion-pack-changes',
        );
      }
      const record = await store.load(identity);
      if (!record) {
        throw new ExpansionPackWorkspaceError(
          'No persisted Expansion Pack draft was found.',
          'expansion-pack-draft-not-found',
        );
      }
      project = assertProjectIdentity(
        identity,
        rehydrateExpansionPackProject(record.project),
        'Persisted Expansion Pack draft',
      );
      persistedRevision = record.revision;
      savedAt = record.savedAt ?? null;
      dirty = false;
      mutationRevision += 1;
      saveState = {
        phase: EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED,
        savedAt,
        persistedRevision,
        remoteRevision: null,
        savingRevision: null,
        error: '',
      };
      rebuildModels();
      notify('reloaded');
      return snapshot();
    },
    destroy() {
      destroyed = true;
      listeners.clear();
    },
  };
  return api;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function copyValue(copy, key, fallback) {
  return String(copy?.[key] || fallback);
}

function localizedSaveLabel(save, copy) {
  if (save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.NEW) return copyValue(copy, 'notSaved', save.label || 'Not saved yet');
  if (save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.DIRTY) return copyValue(copy, 'unsaved', save.label || 'Unsaved changes');
  if (save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING) return copyValue(copy, 'saving', save.label || 'Saving…');
  if (save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.CONFLICT) return copyValue(copy, 'conflict', save.label || 'Newer draft found');
  if (save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.FAILED) return copyValue(copy, 'failed', save.label || 'Save failed');
  if (save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVED) {
    const saved = copyValue(copy, 'saved', 'Saved');
    return save.savedAt ? `${saved} · ${new Date(save.savedAt).toLocaleTimeString()}` : saved;
  }
  return save.label || '';
}

function styleControlAttributes(part, item, style, field) {
  return `data-style-field="${escapeHtml(field)}" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}"`;
}

function parentPartDelta(tree, partId) {
  return list(tree.parts).find((part) => part.kind === 'parent-extension' && part.id === partId) || null;
}

function combinedPartRows(parent, tree) {
  const inherited = list(parent.parts).map((part) => {
    const delta = parentPartDelta(tree, part.id);
    const packItems = list(delta?.items);
    return {
      id: part.id,
      name: part.name,
      kind: 'inherited',
      inherited: true,
      readonly: true,
      required: part.required === true,
      parentItemCount: list(part.items).length,
      packItemCount: packItems.filter((item) => item.kind === 'pack-item').length,
      packStyleCount: packItems.reduce((total, item) => total + list(item.styles).length, 0),
    };
  });
  const owned = list(tree.parts)
    .filter((part) => part.kind === 'optional-part')
    .map((part) => ({
      id: part.id,
      name: part.name,
      kind: 'pack',
      inherited: false,
      readonly: false,
      required: false,
      parentItemCount: 0,
      packItemCount: list(part.items).length,
      packStyleCount: list(part.items).reduce((total, item) => total + list(item.styles).length, 0),
    }));
  return [...inherited, ...owned];
}

function findSelectedPart(parent, tree, partId) {
  const id = text(partId);
  const parentPart = list(parent.parts).find((part) => part.id === id) || null;
  const delta = list(tree.parts).find((part) => part.id === id) || null;
  if (parentPart) return { parent: parentPart, delta, owned: false };
  if (delta?.kind === 'optional-part') return { parent: null, delta, owned: true };
  const firstOwned = list(tree.parts).find((part) => part.kind === 'optional-part') || null;
  if (firstOwned) return { parent: null, delta: firstOwned, owned: true };
  const firstParent = list(parent.parts)[0] || null;
  if (firstParent) return {
    parent: firstParent,
    delta: parentPartDelta(tree, firstParent.id),
    owned: false,
  };
  return { parent: null, delta: null, owned: false };
}

function combinedItems(selection) {
  const inherited = list(selection.parent?.items).map((item) => {
    const delta = list(selection.delta?.items).find((entry) => entry.kind === 'parent-item-extension' && entry.id === item.id);
    return {
      ...item,
      kind: 'inherited',
      inherited: true,
      readonly: true,
      packStyles: list(delta?.styles),
    };
  });
  const owned = list(selection.delta?.items)
    .filter((item) => item.kind === 'pack-item')
    .map((item) => ({ ...item, inherited: false, readonly: false, packStyles: list(item.styles) }));
  return [...inherited, ...owned];
}

function findSelectedItem(selection, itemId) {
  const items = combinedItems(selection);
  return items.find((item) => item.id === text(itemId))
    || items.find((item) => !item.inherited)
    || items[0]
    || null;
}

function combinedStyles(item) {
  const inherited = item?.inherited
    ? list(item.styles).map((style) => ({ ...style, inherited: true, readonly: true }))
    : [];
  return [
    ...inherited,
    ...list(item?.packStyles).map((style) => ({ ...style, inherited: false, readonly: false })),
  ];
}

function findSelectedStyle(item, styleId) {
  const styles = combinedStyles(item);
  return styles.find((style) => style.id === text(styleId))
    || styles.find((style) => !style.inherited)
    || styles[0]
    || null;
}

function renderPackPartBrowser(parent, tree, selectedPartId, copy, publicationLocked) {
  const selected = findSelectedPart(parent, tree, selectedPartId);
  const selectedId = selected.parent?.id || selected.delta?.id || '';
  const records = combinedPartRows(parent, tree).map((part) => ({
    id: part.id,
    name: part.name,
    thumbnailText: part.name.slice(0, 2).toUpperCase(),
    itemCount: part.parentItemCount + part.packItemCount,
    required: part.required,
    trackLabel: part.inherited
      ? copyValue(copy, 'inherited', 'Inherited · read only')
      : copyValue(copy, 'packOwned', 'Pack owned · editable'),
    trackMode: part.inherited ? 'linked' : 'custom',
    selected: part.id === selectedId,
    readonly: part.inherited,
    draggable: false,
    capabilities: {
      select: true,
      preview: false,
      moveUp: false,
      moveDown: false,
      duplicate: false,
      delete: !part.inherited && !publicationLocked,
    },
    actions: {
      select: 'select-pack-part',
      preview: '',
      slot: '',
      move: '',
      duplicate: '',
      delete: part.inherited ? '' : 'delete-pack-part',
    },
  }));
  const model = createMakerPartListModel(records, {
    selectedId,
    listLabel: copyValue(copy, 'parts', 'Parts'),
    actionBarLabel: copyValue(copy, 'packPartActions', 'Pack Part actions'),
    emptyLabel: copyValue(copy, 'emptyPack', 'No Parts yet.'),
  });
  return `
      <div class="v4-panel-head" data-shared-maker-part-browser><div><span>${escapeHtml(copyValue(copy, 'parts', 'Parts'))}</span><strong>${escapeHtml(copyValue(copy, 'parentAndPackParts', 'Parent + Pack'))}</strong><small>${escapeHtml(copyValue(copy, 'packPartBrowserCopy', 'Inherited definitions stay read only; Pack definitions are additive.'))}</small></div><button type="button" data-action="request-add-part" aria-label="${escapeHtml(copyValue(copy, 'addPart', 'Add optional Part'))}" ${publicationLocked ? 'disabled' : ''}>＋</button></div>
      ${renderMakerPartList(model, {
        itemCount: copyValue(copy, 'itemCount', '{count} Item(s)'),
        required: copyValue(copy, 'required', 'Required'),
        optional: copyValue(copy, 'optional', 'Optional'),
        inherited: copyValue(copy, 'inherited', 'Inherited'),
        readonly: copyValue(copy, 'readonly', 'Read only'),
        moveUp: copyValue(copy, 'moveUp', 'Move up'),
        moveDown: copyValue(copy, 'moveDown', 'Move down'),
        duplicate: copyValue(copy, 'duplicate', 'Duplicate'),
        delete: copyValue(copy, 'deletePart', 'Delete'),
      })}`;
}

function editorSections(copy) {
  const fallbackLabels = {
    partsItems: 'Structure',
    layerTracks: 'Layers',
    smartColor: 'Smart Color',
    rules: 'Rules',
    composableItems: 'Wardrobe',
  };
  return MAKER_DEFINITION_EDITOR_SECTIONS.map((section) => ({
    ...section,
    label: copyValue(copy, section.labelKey, fallbackLabels[section.labelKey] || section.labelKey),
  }));
}

function readonlyDefinitionList(values, kind, copy) {
  return `<section class="expansion-pack-definition-group expansion-pack-definition-readonly">
    <header><div><span>${escapeHtml(copyValue(copy, 'inherited', 'Inherited'))}</span><h4>${escapeHtml(copyValue(copy, 'parentDefinitionsReadonly', 'Parent definitions · read only'))}</h4></div></header>
    <div class="expansion-pack-definition-list">${list(values).map((value) => `<div class="expansion-pack-readonly-row" data-parent-${escapeHtml(kind)}-id="${escapeHtml(idOf(value))}"><strong>${escapeHtml(text(value.name) || idOf(value))}</strong><code>${escapeHtml(idOf(value))}</code><span class="expansion-pack-readonly-badge">${escapeHtml(copyValue(copy, 'inherited', 'Inherited'))}</span></div>`).join('') || `<p class="expansion-pack-empty">—</p>`}</div>
  </section>`;
}

function renderLayersEditor(parent, tree, copy) {
  return `${readonlyDefinitionList(parent.layerTracks, 'track', copy)}
    <section class="expansion-pack-definition-group">
      <header><div><span>${escapeHtml(copyValue(copy, 'packOwned', 'Pack owned'))}</span><h4>${escapeHtml(copyValue(copy, 'layerTracks', 'Layer Tracks'))}</h4></div><button type="button" data-action="add-layer-track">${escapeHtml(copyValue(copy, 'addLayerTrack', '＋ Layer Track'))}</button></header>
      <div class="expansion-pack-definition-list">${list(tree.layerTracks).map((track, index, tracks) => `<article class="expansion-pack-track-row" data-track-id="${escapeHtml(idOf(track))}">
        <label><span>${escapeHtml(copyValue(copy, 'trackName', 'Track name'))}</span><input type="text" value="${escapeHtml(text(track.name))}" data-track-field="name" data-track-id="${escapeHtml(idOf(track))}" ${track.locked ? 'disabled' : ''}></label>
        <code>${escapeHtml(idOf(track))}</code>
        <div class="expansion-pack-row-actions">
          <button type="button" data-action="move-layer-track" data-track-id="${escapeHtml(idOf(track))}" data-target-index="${index - 1}" aria-label="${escapeHtml(copyValue(copy, 'moveUp', 'Move up'))}" ${index === 0 || track.locked || tracks[index - 1]?.locked ? 'disabled' : ''}>↑</button>
          <button type="button" data-action="move-layer-track" data-track-id="${escapeHtml(idOf(track))}" data-target-index="${index + 1}" aria-label="${escapeHtml(copyValue(copy, 'moveDown', 'Move down'))}" ${index === tracks.length - 1 || track.locked || tracks[index + 1]?.locked ? 'disabled' : ''}>↓</button>
          <button type="button" data-action="toggle-layer-track" data-track-id="${escapeHtml(idOf(track))}" data-locked="${track.locked === true}" aria-pressed="${track.locked === true}">${escapeHtml(copyValue(copy, track.locked ? 'unlockTrack' : 'lockTrack', track.locked ? 'Unlock' : 'Lock'))}</button>
          <button type="button" data-action="delete-layer-track" data-track-id="${escapeHtml(idOf(track))}" ${track.locked ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'deleteTrack', 'Delete'))}</button>
        </div>
      </article>`).join('') || `<p class="expansion-pack-empty">${escapeHtml(copyValue(copy, 'noPackTracks', 'No Pack Layer Tracks yet.'))}</p>`}</div>
    </section>`;
}

function renderColorsEditor(parent, tree, copy) {
  return `${readonlyDefinitionList(parent.colorChannels, 'color-channel', copy)}
    <section class="expansion-pack-definition-group">
      <header><div><span>${escapeHtml(copyValue(copy, 'packOwned', 'Pack owned'))}</span><h4>${escapeHtml(copyValue(copy, 'smartColor', 'Smart Color'))}</h4></div><button type="button" data-action="add-color-channel">${escapeHtml(copyValue(copy, 'addColorChannel', '＋ Color Channel'))}</button></header>
      <div class="expansion-pack-definition-list">${list(tree.colorChannels).map((channel) => `<article class="expansion-pack-color-channel" data-channel-id="${escapeHtml(idOf(channel))}">
        <header><label><span>${escapeHtml(copyValue(copy, 'colorChannelName', 'Channel name'))}</span><input value="${escapeHtml(text(channel.name))}" data-channel-field="name" data-channel-id="${escapeHtml(idOf(channel))}"></label><code>${escapeHtml(idOf(channel))}</code><button type="button" data-action="delete-color-channel" data-channel-id="${escapeHtml(idOf(channel))}">${escapeHtml(copyValue(copy, 'deleteColorChannel', 'Delete channel'))}</button></header>
        <label><span>${escapeHtml(copyValue(copy, 'defaultSwatch', 'Default swatch'))}</span><select data-channel-field="defaultSwatchId" data-channel-id="${escapeHtml(idOf(channel))}">${list(channel.swatches).map((swatch) => `<option value="${escapeHtml(idOf(swatch))}" ${idOf(swatch) === channel.defaultSwatchId ? 'selected' : ''}>${escapeHtml(text(swatch.name) || idOf(swatch))}</option>`).join('')}</select></label>
        <div class="expansion-pack-swatch-list">${list(channel.swatches).map((swatch) => `<div class="expansion-pack-swatch-row" data-swatch-id="${escapeHtml(idOf(swatch))}">
          <span class="expansion-pack-swatch-chip" style="--swatch-color:${escapeHtml(swatch.hintColor)}" aria-hidden="true"></span>
          <label><span>${escapeHtml(copyValue(copy, 'swatchName', 'Swatch name'))}</span><input value="${escapeHtml(text(swatch.name))}" data-swatch-field="name" data-channel-id="${escapeHtml(idOf(channel))}" data-swatch-id="${escapeHtml(idOf(swatch))}"></label>
          <label><span>${escapeHtml(copyValue(copy, 'hintColor', 'Hint'))}</span><input type="color" value="${escapeHtml(swatch.hintColor)}" data-swatch-field="hintColor" data-channel-id="${escapeHtml(idOf(channel))}" data-swatch-id="${escapeHtml(idOf(swatch))}"></label>
          <label><span>${escapeHtml(copyValue(copy, 'startColor', 'Start'))}</span><input type="color" value="${escapeHtml(swatch.stops?.[0]?.color || '#000000')}" data-swatch-field="startColor" data-channel-id="${escapeHtml(idOf(channel))}" data-swatch-id="${escapeHtml(idOf(swatch))}"></label>
          <label><span>${escapeHtml(copyValue(copy, 'endColor', 'End'))}</span><input type="color" value="${escapeHtml(swatch.stops?.at(-1)?.color || '#ffffff')}" data-swatch-field="endColor" data-channel-id="${escapeHtml(idOf(channel))}" data-swatch-id="${escapeHtml(idOf(swatch))}"></label>
          <button type="button" data-action="delete-color-swatch" data-channel-id="${escapeHtml(idOf(channel))}" data-swatch-id="${escapeHtml(idOf(swatch))}" ${channel.swatches.length <= 1 ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'deleteSwatch', 'Delete'))}</button>
        </div>`).join('')}</div>
        <button type="button" data-action="add-color-swatch" data-channel-id="${escapeHtml(idOf(channel))}">${escapeHtml(copyValue(copy, 'addSwatch', '＋ Swatch'))}</button>
      </article>`).join('') || `<p class="expansion-pack-empty">${escapeHtml(copyValue(copy, 'noPackColors', 'No Pack Smart Color channels yet.'))}</p>`}</div>
    </section>`;
}

function selectorEntries(parent, tree, copy) {
  const entries = [];
  list(parent.parts).forEach((part) => {
    entries.push({ value: `base|${part.id}||`, label: `${copyValue(copy, 'inherited', 'Inherited')} · ${part.name}` });
    list(part.items).forEach((item) => {
      entries.push({ value: `base|${part.id}|${item.id}|`, label: `${copyValue(copy, 'inherited', 'Inherited')} · ${part.name} / ${item.name}` });
      list(item.styles).forEach((style) => entries.push({ value: `base|${part.id}|${item.id}|${style.id}`, label: `${copyValue(copy, 'inherited', 'Inherited')} · ${part.name} / ${item.name} / ${style.name}` }));
    });
  });
  list(tree.parts).forEach((part) => list(part.items).forEach((item) => {
    if (item.kind === 'pack-item') entries.push({ value: `pack|${part.id}|${item.id}|`, label: `${copyValue(copy, 'packOwned', 'Pack owned')} · ${part.name} / ${item.name}` });
    list(item.styles).forEach((style) => entries.push({ value: `pack|${part.id}|${item.id}|${style.id}`, label: `${copyValue(copy, 'packOwned', 'Pack owned')} · ${part.name} / ${item.name} / ${style.name}` }));
  }));
  return entries;
}

function selectorValue(selector) {
  if (!selector) return '';
  return `${selector.scope === 'base' ? 'base' : 'pack'}|${text(selector.partId)}|${text(selector.itemId)}|${text(selector.styleId)}`;
}

function selectorSelect(entries, selected, attributes, copy, packOnly = false) {
  return `<select ${attributes}><option value="">${escapeHtml(copyValue(copy, 'none', 'None'))}</option>${entries.filter((entry) => !packOnly || entry.value.startsWith('pack|')).map((entry) => `<option value="${escapeHtml(entry.value)}" ${entry.value === selected ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`).join('')}</select>`;
}

function selectorMultiSelect(entries, selectedValues, attributes, packOnly = false) {
  const selected = new Set(list(selectedValues));
  return `<select multiple ${attributes}>${entries.filter((entry) => !packOnly || entry.value.startsWith('pack|')).map((entry) => `<option value="${escapeHtml(entry.value)}" ${selected.has(entry.value) ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`).join('')}</select>`;
}

function editableVisibilityModel(condition) {
  if (condition == null) return { editable: true, op: 'always', selectors: [] };
  if (condition?.op === 'selected') {
    return { editable: true, op: 'selected', selectors: [condition] };
  }
  if (condition?.op === 'not' && condition.condition?.op === 'selected') {
    return { editable: true, op: 'not', selectors: [condition.condition] };
  }
  if (
    (condition?.op === 'all' || condition?.op === 'any')
    && list(condition.conditions).length > 0
    && list(condition.conditions).every((entry) => entry?.op === 'selected')
  ) {
    return { editable: true, op: condition.op, selectors: condition.conditions };
  }
  return { editable: false, op: 'advanced', selectors: [] };
}

function definitionRuleCount(owner) {
  const rules = owner?.rules || {};
  return list(rules.requires).length
    + list(rules.excludes).length
    + (rules.visibleWhen ? 1 : 0);
}

function compactDefinitionRuleControl(ownerKind, part, item, style, copy, options = {}) {
  const owner = style || item || part;
  const definition = [part?.id, item?.id, style?.id].filter(Boolean).join('::');
  const count = definitionRuleCount(owner);
  return renderDefinitionCombinationRuleControl({
    definition,
    ownerType: ownerKind,
    count,
    title: copyValue(copy, 'combinationRules', 'Combination Rules'),
    countLabel: copyValue(copy, 'combinationRuleCount', '{count} rule(s)')
      .replace('{count}', String(count)),
    actionLabel: copyValue(
      copy,
      count ? 'editCombinationRules' : 'addCombinationRule',
      count ? 'Edit Rules' : 'Add Rule',
    ),
    action: 'edit-pack-selection-rules',
    disabled: options.disabled === true,
    readonly: options.readonly === true,
  });
}

function packDefinitionRuleGroups(parent, tree, copy) {
  const groups = [];
  const addOwner = (ownerType, part, item, style) => {
    const owner = style || item || part;
    const rules = owner?.rules || {};
    const rows = [
      ...list(rules.requires).map((target) => ({ type: 'requires', target })),
      ...list(rules.excludes).map((target) => ({ type: 'excludes', target })),
      ...(rules.visibleWhen ? [{ type: 'visible', target: rules.visibleWhen }] : []),
    ];
    if (!rows.length) return;
    groups.push({
      ownerType,
      part,
      item,
      style,
      ownerName: [part?.name, item?.name, style?.name].filter(Boolean).join(' / '),
      rows,
    });
  };
  list(tree.parts).forEach((part) => {
    if (part.kind === 'optional-part') addOwner('part', part);
    list(part.items).forEach((item) => {
      if (item.kind === 'pack-item') addOwner('item', part, item);
      list(item.styles).forEach((style) => addOwner('style', part, item, style));
    });
  });
  const selectorLabel = (selector) => {
    if (selector?.op && selector.op !== 'selected') {
      return copyValue(copy, 'advancedCondition', 'Advanced condition · read only');
    }
    const entries = selectorEntries(parent, tree, copy);
    return entries.find((entry) => entry.value === selectorValue(selector))?.label
      || selectorValue(selector)
      || copyValue(copy, 'advancedCondition', 'Advanced condition');
  };
  return groups.map((group) => `
    <article class="v4-rule-group" data-pack-rule-owner="${escapeHtml([
      group.part?.id,
      group.item?.id,
      group.style?.id,
    ].filter(Boolean).join('::'))}">
      <header><div><span>${escapeHtml(copyValue(copy, 'packOwned', 'Pack owned'))}</span><strong>${escapeHtml(group.ownerName)}</strong></div><b>${escapeHtml(copyValue(copy, 'combinationRules', 'Combination Rules'))}</b></header>
      <div class="v4-rule-targets">
        ${group.rows.map((row) => `<span><em>${escapeHtml(copyValue(copy, row.type, row.type))}</em><strong>${escapeHtml(selectorLabel(row.target))}</strong></span>`).join('')}
      </div>
    </article>`).join('');
}

function renderRulesEditor(parent, tree, copy) {
  const entries = selectorEntries(parent, tree, copy);
  const firstPack = entries.find((entry) => entry.value.startsWith('pack|'))?.value || '';
  const firstTarget = entries.find((entry) => entry.value.startsWith('base|') && entry.value !== firstPack)?.value
    || entries.find((entry) => entry.value !== firstPack)?.value
    || '';
  const ownerGroups = packDefinitionRuleGroups(parent, tree, copy);
  return `${readonlyDefinitionList(parent.rules, 'rule', copy)}
    <section class="v4-pack-rule-section" data-shared-rule-editor>
      <header class="v4-panel-head"><div><span>${escapeHtml(copyValue(copy, 'packOwned', 'Pack owned'))}</span><strong>${escapeHtml(copyValue(copy, 'rules', 'Rules'))}</strong></div>${tree.rules.length ? `<button type="button" data-action="add-pack-rule" data-default-selector="${escapeHtml(firstPack)}" data-default-target="${escapeHtml(firstTarget)}" ${firstPack && firstTarget ? '' : 'disabled'}>${escapeHtml(copyValue(copy, 'addRule', 'Add Rule'))}</button>` : ''}</header>
      <div class="v4-rule-list">${list(tree.rules).map((rule) => `<article class="v4-rule-group" data-rule-id="${escapeHtml(idOf(rule))}"><header><div><span>${escapeHtml(copyValue(copy, 'packOwned', 'Pack owned'))}</span><strong>${escapeHtml(idOf(rule))}</strong></div><b>${escapeHtml(copyValue(copy, rule.type, rule.type))}</b></header><div class="v4-pack-rule-fields">
        <label><span>${escapeHtml(copyValue(copy, 'ruleType', 'Rule type'))}</span><select data-rule-field="type" data-rule-id="${escapeHtml(idOf(rule))}"><option value="requires" ${rule.type === 'requires' ? 'selected' : ''}>${escapeHtml(copyValue(copy, 'requires', 'Requires'))}</option><option value="excludes" ${rule.type === 'excludes' ? 'selected' : ''}>${escapeHtml(copyValue(copy, 'excludes', 'Excludes'))}</option></select></label>
        <label><span>${escapeHtml(copyValue(copy, 'triggerPart', 'Trigger'))}</span>${selectorSelect(entries, selectorValue(rule.trigger), `data-rule-field="trigger" data-rule-id="${escapeHtml(idOf(rule))}"`, copy, rule.type === 'requires')}</label>
        <label><span>${escapeHtml(copyValue(copy, 'targetPart', 'Target'))}</span>${selectorMultiSelect(entries, list(rule.targets).map(selectorValue), `data-rule-field="targets" data-rule-id="${escapeHtml(idOf(rule))}"`)}</label>
        <button type="button" data-action="delete-pack-rule" data-rule-id="${escapeHtml(idOf(rule))}">${escapeHtml(copyValue(copy, 'deleteRule', 'Delete rule'))}</button>
      </div></article>`).join('') || `<div class="v4-inline-empty v4-pack-rule-empty"><span>${escapeHtml(copyValue(copy, 'noPackRules', 'No Pack rules yet.'))}</span><button type="button" data-action="add-pack-rule" data-default-selector="${escapeHtml(firstPack)}" data-default-target="${escapeHtml(firstTarget)}" ${firstPack && firstTarget ? '' : 'disabled'}>${escapeHtml(copyValue(copy, 'addRule', 'Add Rule'))}</button></div>`}</div>
    </section>
    <section class="v4-pack-rule-section"><header class="v4-panel-head"><div><span>${escapeHtml(copyValue(copy, 'definitionRules', 'Part / Item / Style rules'))}</span><strong>${escapeHtml(copyValue(copy, 'combinationRules', 'Combination Rules'))}</strong></div></header>
      <div class="v4-rule-list">${ownerGroups || `<div class="v4-inline-empty v4-pack-rule-empty"><span>${escapeHtml(copyValue(copy, 'noPackContent', 'No Pack definition rules yet.'))}</span></div>`}</div>
    </section>`;
}

function renderWardrobeEditor(parent, tree, copy) {
  const slotDisabled = !tree.supportsComposableV6;
  return `${readonlyDefinitionList(parent.parts, 'wardrobe-part', copy)}
    <section class="expansion-pack-definition-group"><header><div><span>${escapeHtml(copyValue(copy, 'packOwned', 'Pack owned'))}</span><h4>${escapeHtml(copyValue(copy, 'composableItems', 'Wardrobe'))}</h4></div></header>
      ${slotDisabled ? `<p class="expansion-pack-capability-note" role="status">${escapeHtml(copyValue(copy, 'wardrobeSlotRequiresComposable', 'Wardrobe Slot requires a parent Maker with Composable v6 compatibility.'))}</p>` : ''}
      <div class="expansion-pack-definition-list">${list(tree.parts).filter((part) => part.kind === 'optional-part').map((part) => `<article class="expansion-pack-wardrobe-row" data-part-id="${escapeHtml(part.id)}"><div><strong>${escapeHtml(part.name)}</strong><code>${escapeHtml(part.id)}</code></div><div role="group" aria-label="${escapeHtml(`${copyValue(copy, 'wardrobeMode', 'Wardrobe mode')}: ${part.name}`)}"><button type="button" data-action="set-pack-part-mode" data-part-id="${escapeHtml(part.id)}" data-mode="FIXED" aria-pressed="${part.wardrobeMode !== 'SLOT'}">${escapeHtml(copyValue(copy, 'wardrobeFixed', 'Fixed'))}</button><button type="button" data-action="set-pack-part-mode" data-part-id="${escapeHtml(part.id)}" data-mode="SLOT" aria-pressed="${part.wardrobeMode === 'SLOT'}" ${slotDisabled ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'wardrobeSlot', 'Slot'))}</button></div></article>`).join('') || `<p class="expansion-pack-empty">${escapeHtml(copyValue(copy, 'noPackContent', 'Add an optional Pack Part to configure wardrobe behavior.'))}</p>`}</div>
    </section>`;
}

function packSelectionModel(parent, tree, ui = {}) {
  const part = findSelectedPart(parent, tree, ui.selectedPartId);
  const item = findSelectedItem(part, ui.selectedItemId);
  const style = findSelectedStyle(item, ui.selectedStyleId);
  return {
    part,
    partId: part.parent?.id || part.delta?.id || '',
    item,
    style,
  };
}

function renderPackItemDock(selection, copy, publicationLocked) {
  const { part, partId, item } = selection;
  const items = combinedItems(part);
  const itemRows = items.map((candidate) => `
    <article class="v4-record-entry v4-item-entry" data-pack-definition-origin="${candidate.inherited ? 'inherited' : 'pack'}">
      <button class="v4-item-card ${candidate.id === item?.id ? 'active' : ''}" type="button" data-action="select-pack-item" data-item-id="${escapeHtml(candidate.id)}">
        <span class="v4-item-thumb"><i>${candidate.inherited ? '↳' : 'PNG'}</i></span>
        <strong>${escapeHtml(candidate.name)}</strong>
        <small>${escapeHtml(copyValue(copy, candidate.inherited ? 'inherited' : 'packOwned', candidate.inherited ? 'Inherited · read only' : 'Pack owned'))}</small>
      </button>
      ${candidate.inherited ? '' : `<div class="v4-record-actions"><button type="button" class="danger" data-action="delete-pack-item" data-part-id="${escapeHtml(partId)}" data-item-id="${escapeHtml(candidate.id)}" ${publicationLocked ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'deleteItem', 'Delete Item'))}</button></div>`}
    </article>`).join('');
  const styles = combinedStyles(item);
  const styleRows = styles.map((candidate) => `
    <article class="v4-record-entry v4-style-entry" data-pack-definition-origin="${candidate.inherited ? 'inherited' : 'pack'}">
      <button class="v4-style-chip ${candidate.id === selection.style?.id ? 'active' : ''}" type="button" data-action="select-pack-style" data-style-id="${escapeHtml(candidate.id)}">
        <span class="v4-style-chip-thumb"><i>${candidate.assetId ? 'PNG' : '—'}</i></span>
        <span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(copyValue(copy, candidate.inherited ? 'inherited' : 'packOwned', candidate.inherited ? 'Inherited' : 'Pack owned'))}</small></span>
      </button>
      ${candidate.inherited ? '' : `<div class="v4-record-actions"><button type="button" class="danger" data-action="delete-pack-style" data-part-id="${escapeHtml(partId)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(candidate.id)}" ${publicationLocked ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'deleteStyle', 'Delete Style'))}</button></div>`}
    </article>`).join('');
  return `
    <div class="v4-items-dock" data-shared-maker-item-dock>
      <div class="v4-panel-head"><div><span>${escapeHtml(copyValue(copy, 'items', 'Items'))}</span><strong>${escapeHtml(part.parent?.name || part.delta?.name || copyValue(copy, 'selectPart', 'Select a Part'))}</strong></div><div><button type="button" data-action="request-add-item" data-part-id="${escapeHtml(partId)}" ${partId && !publicationLocked ? '' : 'disabled'}>${escapeHtml(copyValue(copy, 'addItem', 'Add Item'))}</button></div></div>
      <div class="v4-item-grid">${itemRows || `<div class="v4-inline-empty"><span>${escapeHtml(copyValue(copy, 'noPackContent', 'No Items yet.'))}</span></div>`}</div>
      ${item ? `<div class="v4-style-row"><span>${escapeHtml(copyValue(copy, 'styles', 'Styles'))}</span>${styleRows}<button type="button" data-action="request-add-style" data-part-id="${escapeHtml(partId)}" data-item-id="${escapeHtml(item.id)}" ${publicationLocked ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'addStyle', 'Add Style'))}</button></div>` : ''}
    </div>`;
}

function renderPackStyleInspector(selection, parent, tree, copy, publicationLocked) {
  const { part, partId, item, style } = selection;
  if (!partId) return `<div class="v4-inline-empty"><span>${escapeHtml(copyValue(copy, 'selectPart', 'Select a Part'))}</span></div>`;
  const inheritedPart = Boolean(part.parent);
  const inheritedItem = Boolean(item?.inherited);
  const inheritedStyle = Boolean(style?.inherited);
  const ownerPart = part.delta || part.parent;
  const stylePart = { id: partId, name: part.parent?.name || part.delta?.name || partId };
  const disabled = publicationLocked;
  const ruleControl = (ownerKind, owner, ownerItem = null, ownerStyle = null, readonly = false) => (
    owner ? compactDefinitionRuleControl(
      ownerKind,
      stylePart,
      ownerItem,
      ownerStyle,
      copy,
      { readonly, disabled },
    ) : ''
  );
  const styleTracks = [...list(parent.layerTracks), ...list(tree.layerTracks)];
  const colorChannels = [...list(parent.colorChannels), ...list(tree.colorChannels)];
  return `
    <div class="v4-inspector-section" data-pack-inspector-owner="part">
      <span class="v4-inspector-label">${escapeHtml(copyValue(copy, 'part', 'Part'))} · ${escapeHtml(copyValue(copy, inheritedPart ? 'inherited' : 'packOwned', inheritedPart ? 'Inherited' : 'Pack owned'))}</span>
      ${inheritedPart
        ? `<label>${escapeHtml(copyValue(copy, 'name', 'Name'))}<input value="${escapeHtml(part.parent.name)}" readonly aria-readonly="true"></label>`
        : `<label>${escapeHtml(copyValue(copy, 'name', 'Name'))}<input value="${escapeHtml(part.delta?.name || '')}" data-rename-kind="part" data-part-id="${escapeHtml(partId)}" ${disabled ? 'disabled' : ''}></label>`}
      ${ruleControl('part', ownerPart, null, null, inheritedPart)}
    </div>
    ${item ? `<div class="v4-inspector-section" data-pack-inspector-owner="item">
      <span class="v4-inspector-label">${escapeHtml(copyValue(copy, 'item', 'Item'))} · ${escapeHtml(copyValue(copy, inheritedItem ? 'inherited' : 'packOwned', inheritedItem ? 'Inherited' : 'Pack owned'))}</span>
      ${inheritedItem
        ? `<label>${escapeHtml(copyValue(copy, 'name', 'Name'))}<input value="${escapeHtml(item.name)}" readonly aria-readonly="true"></label>`
        : `<label>${escapeHtml(copyValue(copy, 'name', 'Name'))}<input value="${escapeHtml(item.name)}" data-rename-kind="item" data-part-id="${escapeHtml(partId)}" data-item-id="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}></label>`}
      ${ruleControl('item', item, item, null, inheritedItem)}
    </div>` : ''}
    ${style ? `<div class="v4-inspector-section" data-pack-inspector-owner="style">
      <span class="v4-inspector-label">${escapeHtml(copyValue(copy, 'style', 'Style'))} · ${escapeHtml(copyValue(copy, inheritedStyle ? 'inherited' : 'packOwned', inheritedStyle ? 'Inherited' : 'Pack owned'))}</span>
      ${inheritedStyle
        ? `<label>${escapeHtml(copyValue(copy, 'name', 'Name'))}<input value="${escapeHtml(style.name)}" readonly aria-readonly="true"></label>`
        : `<label>${escapeHtml(copyValue(copy, 'name', 'Name'))}<input value="${escapeHtml(style.name)}" data-rename-kind="style" data-part-id="${escapeHtml(partId)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}" ${disabled ? 'disabled' : ''}></label>
          <label class="v4-file-button wide ${disabled ? 'disabled' : ''}">${escapeHtml(copyValue(copy, style.assetId ? 'replaceStylePng' : 'uploadPng', style.assetId ? 'Replace Style PNG' : 'Upload PNG'))}<input type="file" accept="image/png,.png" data-asset-request="true" data-part-id="${escapeHtml(partId)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}" ${disabled ? 'disabled' : ''}></label>
          <div class="v4-number-grid">
            <label>X<input type="number" step="1" value="${escapeHtml(style.transform?.x ?? 0)}" ${styleControlAttributes(stylePart, item, style, 'transform.x')} ${disabled ? 'disabled' : ''}></label>
            <label>Y<input type="number" step="1" value="${escapeHtml(style.transform?.y ?? 0)}" ${styleControlAttributes(stylePart, item, style, 'transform.y')} ${disabled ? 'disabled' : ''}></label>
            <label>${escapeHtml(copyValue(copy, 'scale', 'Scale'))}<input type="number" min="0.01" step="0.01" value="${escapeHtml(style.transform?.scale ?? 1)}" ${styleControlAttributes(stylePart, item, style, 'transform.scale')} ${disabled ? 'disabled' : ''}></label>
            <label>${escapeHtml(copyValue(copy, 'rotation', 'Rotation'))}<input type="number" step="1" value="${escapeHtml(style.transform?.rotation ?? 0)}" ${styleControlAttributes(stylePart, item, style, 'transform.rotation')} ${disabled ? 'disabled' : ''}></label>
          </div>
          <label>${escapeHtml(copyValue(copy, 'opacity', 'Opacity'))}<input type="range" min="0" max="1" step="0.01" value="${escapeHtml(style.opacity ?? 1)}" ${styleControlAttributes(stylePart, item, style, 'opacity')} ${disabled ? 'disabled' : ''}></label>
          <label>${escapeHtml(copyValue(copy, 'blend', 'Blend'))}<select ${styleControlAttributes(stylePart, item, style, 'blendMode')} ${disabled ? 'disabled' : ''}>${Object.keys(BLEND_MODES).map((mode) => `<option value="${escapeHtml(mode)}" ${mode === style.blendMode ? 'selected' : ''}>${escapeHtml(mode)}</option>`).join('')}</select></label>
          <label>${escapeHtml(copyValue(copy, 'layerTracks', 'Layer Track'))}<select ${styleControlAttributes(stylePart, item, style, 'layerTrackId')} ${disabled ? 'disabled' : ''}>${styleTracks.map((track) => `<option value="${escapeHtml(idOf(track))}" ${idOf(track) === style.layerTrackId ? 'selected' : ''}>${escapeHtml(text(track.name) || idOf(track))}</option>`).join('')}</select></label>
          <label>${escapeHtml(copyValue(copy, 'smartColor', 'Smart Color'))}<select ${styleControlAttributes(stylePart, item, style, 'colorChannelId')} ${disabled ? 'disabled' : ''}><option value="">${escapeHtml(copyValue(copy, 'none', 'None'))}</option>${colorChannels.map((channel) => `<option value="${escapeHtml(idOf(channel))}" ${idOf(channel) === style.colorChannelId ? 'selected' : ''}>${escapeHtml(text(channel.name) || idOf(channel))}</option>`).join('')}</select></label>`}
      ${ruleControl('style', style, item, style, inheritedStyle)}
    </div>` : ''}`;
}

function renderEditorPanel(section, parent, tree, copy) {
  if (section === 'layers') return renderLayersEditor(parent, tree, copy);
  if (section === 'colors') return renderColorsEditor(parent, tree, copy);
  if (section === 'rules') return renderRulesEditor(parent, tree, copy);
  if (section === 'wardrobe') return renderWardrobeEditor(parent, tree, copy);
  return '';
}

/** Pure markup renderer. It intentionally contains no overflow container. */
export function renderExpansionPackWorkspaceHtml(model, copy = {}, ui = {}) {
  const state = model || {};
  const parent = state.parent || {};
  const tree = state.tree || { parts: [] };
  const preview = state.preview || {};
  const save = state.save || {};
  const activeSection = normalizeMakerDefinitionEditorSection(ui.activeSection);
  const selection = packSelectionModel(parent, tree, ui);
  const previewLabel = preview.status === 'publishable'
    ? copyValue(copy, 'previewPublishable', 'Content ready · exact parent release bound')
    : preview.status === 'content-ready-local-parent'
      ? copyValue(copy, 'previewLocalReady', 'Content ready · local parent only')
    : preview.status === 'ready-with-issues'
      ? copyValue(copy, 'previewIssues', 'Ready with issues')
      : copyValue(copy, 'previewBlocked', 'Blocked');
  const previewBoundary = preview.status === 'content-ready-local-parent'
    ? copyValue(
      copy,
      'previewLocalBoundary',
      'Preview is available, but publication requires rebinding to the exact published parent release.',
    )
    : preview.status === 'publishable'
      ? copyValue(
        copy,
        'previewPublishedBoundary',
        'The parent release id, manifest Blob/Quilt and SHA-256 are bound exactly.',
      )
      : '';
  const parentBindingLabel = parent.bindingKind === 'published-release'
    ? copyValue(copy, 'publishedParentBinding', 'Exact published release')
    : copyValue(copy, 'localParentBinding', 'Local draft parent');
  const additions = copyValue(copy, 'additions', '{parts} Part(s) · {items} Item(s) · {styles} Style(s)')
    .replace('{parts}', String(preview.additions?.optionalParts || 0))
    .replace('{items}', String(preview.additions?.items || 0))
    .replace('{styles}', String(preview.additions?.styles || 0));
  const publication = copy?.publicationState && typeof copy.publicationState === 'object'
    ? copy.publicationState
    : {};
  const publicationActions = publication.actions && typeof publication.actions === 'object'
    ? publication.actions
    : {};
  const publicationStep = Math.max(1, Math.min(4, Number(publication.step || 1)));
  const publicationStarted = Boolean(
    publication.started
    || publication.busy
    || publication.receipt
    || publication.stage && !['', 'idle'].includes(publication.stage),
  );
  const publicationLocked = publication.locked === true || publicationStarted;
  const publicationSteps = [
    copyValue(copy, 'packReleasePrepareStep', 'Prepare Pack Quilt'),
    copyValue(copy, 'packReleaseUploadStep', 'Register & upload'),
    copyValue(copy, 'packReleaseCertifyStep', 'Certify Walrus'),
    copyValue(copy, 'packReleasePublishStep', 'Publish on Sui'),
  ];
  const publicationStepCards = publicationSteps.map((label, index) => {
    const step = index + 1;
    const completed = Array.isArray(publication.completedSteps)
      ? publication.completedSteps.includes(step)
      : step < publicationStep;
    const current = !publication.receipt && step === publicationStep;
    const stateLabel = completed
      ? copyValue(copy, 'packReleaseCompleted', 'Completed')
      : current
        ? copyValue(copy, 'packReleaseCurrentStep', 'Current step')
        : copyValue(copy, 'packReleaseNotStarted', 'Not started');
    return `<li class="expansion-pack-release-step${completed ? ' completed' : ''}${current ? ' current' : ''}">
      <span>${step}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(stateLabel)}</small></div>
    </li>`;
  }).join('');
  const actionButton = (action, label, primary = false) => publicationActions[action]
    ? `<button type="button" ${primary ? 'class="primary"' : ''} data-action="pack-publication-action" data-pack-publication-action="${escapeHtml(action)}" ${publication.busy ? 'disabled' : ''}>${escapeHtml(label)}</button>`
    : '';
  const releasePanel = preview.publishable ? `
    <details class="v4-pack-publication-preflight" data-publication-preflight-only data-pack-release-stage="${escapeHtml(publication.stage || 'idle')}" ${publicationStarted ? 'open' : ''}>
      <summary><strong>${escapeHtml(copyValue(copy, 'publishExpansionPack', 'Publication preflight'))}</strong><span>${escapeHtml(parentBindingLabel)}</span></summary>
      <section class="expansion-pack-release-panel" aria-live="polite">
      <header>
        <div><span>${escapeHtml(copyValue(copy, 'packReleaseEyebrow', 'WALRUS + SUI RELEASE'))}</span><h3>${escapeHtml(copyValue(copy, 'publishExpansionPack', 'Publish Expansion Pack'))}</h3></div>
        ${publication.recoverable ? `<strong>${escapeHtml(copyValue(copy, 'packReleaseRecoverable', 'Recoverable checkpoint'))}</strong>` : ''}
      </header>
      <ol class="expansion-pack-release-steps">${publicationStepCards}</ol>
      ${publication.status ? `<p class="expansion-pack-release-status">${escapeHtml(publication.status)}</p>` : ''}
      ${publication.error ? `<div class="expansion-pack-release-error" role="alert"><strong>${escapeHtml(publication.error.title || copyValue(copy, 'packReleaseFailed', 'Expansion Pack release failed'))}</strong><p>${escapeHtml(publication.error.message || publication.error)}</p></div>` : ''}
      ${publication.receipt ? `<div class="expansion-pack-release-receipt">
        <strong>${escapeHtml(copyValue(copy, 'packReleaseSuccess', 'Expansion Pack published'))}</strong>
        ${publication.receipt.packObjectId ? `<small>${escapeHtml(copyValue(copy, 'packReleaseObjectId', 'Pack object'))}: <code>${escapeHtml(publication.receipt.packObjectId)}</code></small>` : ''}
        ${publication.receipt.digest ? `<small>${escapeHtml(copyValue(copy, 'packReleaseTransaction', 'Transaction'))}: <code>${escapeHtml(publication.receipt.digest)}</code></small>` : ''}
      </div>` : ''}
      <div class="expansion-pack-release-actions">
        ${actionButton('prepare', copyValue(copy, 'packReleasePrepareAction', '1. Prepare Pack Quilt'), true)}
        ${actionButton('register', copyValue(copy, 'packReleaseUploadAction', '2. Register & upload'), true)}
        ${actionButton('certify', copyValue(copy, 'packReleaseCertifyAction', '3. Certify Walrus'), true)}
        ${actionButton('publish', copyValue(copy, 'packReleasePublishAction', '4. Publish Pack'), true)}
        ${actionButton('resume', copyValue(copy, 'packReleaseResumeAction', 'Resume release'))}
        ${actionButton('review', copyValue(copy, 'packReleaseReviewAction', 'Check chain status'))}
        ${actionButton('export', copyValue(copy, 'packExportPublicationCandidate', 'Export diagnostic candidate'))}
      </div>
      ${publication.available === false && !publicationStarted ? `<small role="status">${escapeHtml(publication.unavailableReason || copyValue(copy, 'packReleaseUnavailable', 'Expansion Pack v8 publication is not enabled in this deployment.'))}</small>` : ''}
      </section>
    </details>` : '';
  const savePhase = save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.FAILED
    || save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.CONFLICT
    ? 'error'
    : save.phase;
  const packBadges = `
    <span class="v4-version-badge" data-pack-identity-badge>${escapeHtml(tree.namespace || '')}</span>
    <span class="v4-version-badge" data-pack-version-badge>${escapeHtml(tree.version || '')}</span>
    <span class="v4-version-badge" data-pack-inheritance-badge>${escapeHtml(copyValue(copy, 'inherited', 'Inherited'))} + ${escapeHtml(copyValue(copy, 'packOwned', 'Pack owned'))}</span>
    <span class="v4-version-badge" data-pack-parent-binding-badge title="${escapeHtml([
      parent.releaseId,
      parent.manifestBlobId,
      parent.manifestHash,
    ].filter(Boolean).join(' · '))}">${escapeHtml(parentBindingLabel)}</span>`;
  const previewSummary = `${previewLabel} · ${additions} · ${copyValue(copy, 'preflightIssues', '{count} preflight issue(s)').replace('{count}', String(list(preview.issues).length))}`;
  const leftHtml = renderPackPartBrowser(parent, tree, selection.partId, copy, publicationLocked);
  const centerHtml = `
        <div class="v4-canvas-toolbar">
          <div><strong>${escapeHtml(copyValue(copy, 'preview', 'Merged preview'))}</strong><span id="expansionPackRenderStatus">${escapeHtml(previewSummary)}</span></div>
          <div class="v4-canvas-tools"><span class="v4-version-badge">${escapeHtml(parent.canvas?.width || 0)}×${escapeHtml(parent.canvas?.height || 0)}</span></div>
        </div>
        <div class="v4-canvas-viewport ${state.project?.parentSnapshot?.canvas?.pixelMode === 'pixelated' ? 'pixelated' : ''}">
          <div class="v4-canvas-ruler"><span>0,0</span><span>${escapeHtml(parent.canvas?.width || 0)},${escapeHtml(parent.canvas?.height || 0)}</span></div>
          <canvas class="v4-runtime-canvas" data-expansion-pack-preview-canvas aria-label="${escapeHtml(copyValue(copy, 'preview', 'Merged preview'))}"></canvas>
          ${preview.maker ? '' : `<div class="v4-canvas-empty"><strong>${escapeHtml(previewLabel)}</strong><span>${escapeHtml(previewBoundary)}</span></div>`}
        </div>
        ${renderPackItemDock(selection, copy, publicationLocked)}`;
  const rightHtml = `
        <div class="v4-panel-head v4-inspector-context"><div><span>${escapeHtml(copyValue(copy, 'currentStyle', 'Current Style'))}</span><strong>${escapeHtml([
          selection.part.parent?.name || selection.part.delta?.name || '—',
          selection.item?.name || '—',
          selection.style?.name || '—',
        ].join(' › '))}</strong></div></div>
        ${renderPackStyleInspector(selection, parent, tree, copy, publicationLocked)}`;
  const activeStructure = activeSection === MAKER_DEFINITION_EDITOR_SECTION_IDS.STRUCTURE;
  const advancedPanel = activeStructure ? '' : `
    <div class="v4-tool-modal-backdrop" data-pack-tool-overlay>
      <section id="expansionPackToolDialog" class="v4-advanced-panel primary-tool" role="dialog" aria-modal="true" aria-labelledby="expansionPackToolTitle" tabindex="-1">
        <header class="v4-tool-context"><div><span>${escapeHtml(editorSections(copy).find((section) => section.id === activeSection)?.label || activeSection)}</span><strong id="expansionPackToolTitle">${escapeHtml(tree.name || '')}</strong></div><button type="button" data-action="select-pack-section" data-section="structure" aria-label="${escapeHtml(copyValue(copy, 'close', 'Close'))}">×</button></header>
        <div class="v4-tool-body"><section class="v4-pack-definition-workspace" role="tabpanel" id="expansionPackPanel-${escapeHtml(activeSection)}" data-active-section="${escapeHtml(activeSection)}" ${publicationLocked ? 'inert aria-disabled="true"' : ''}>${renderEditorPanel(activeSection, parent, tree, copy)}</section></div>
      </section>
    </div>`;
  return renderMakerEditorShell({
    instanceId: 'expansion-pack',
    idPrefix: 'expansionPack',
    workspaceId: 'expansionPackToolPanel',
    className: 'expansion-pack-workspace',
    shellAttributes: `data-expansion-pack-workspace data-scroll-owner="host" data-nested-scroll="false" data-publication-locked="${publicationLocked}"`,
    workspaceAttributes: 'data-shared-maker-editor-shell',
    activeTab: activeSection,
    tabDataKey: 'section',
    tabsLabel: copyValue(copy, 'definitionTabsLabel', 'Pack definition editor'),
    tabs: editorSections(copy).map((section) => ({
      id: section.id,
      label: section.label,
      action: 'select-pack-section',
      value: section.id,
      controls: activeStructure && section.id === activeSection ? 'expansionPackToolPanel' : `expansionPackPanel-${section.id}`,
    })),
    title: {
      eyebrow: copyValue(copy, 'studio', 'Expansion Pack Studio'),
      contentHtml: `<input class="v4-pack-title-input" type="text" value="${escapeHtml(tree.name || '')}" data-rename-kind="pack" aria-label="${escapeHtml(copyValue(copy, 'packName', 'Expansion Pack name'))}" ${publicationLocked ? 'disabled' : ''}>${packBadges}`,
    },
    save: {
      phase: savePhase,
      dataPhase: save.phase,
      label: localizedSaveLabel(save, copy),
    },
    actionsHtml: `<button type="button" data-action="request-back-to-maker" ${publicationLocked ? 'disabled' : ''}>← ${escapeHtml(copyValue(copy, 'backToMaker', 'Back to Maker'))}</button><button type="button" data-action="request-commerce-rights" ${publicationLocked ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'openCommerceRights', 'Commerce & Rights'))}</button><button type="button" data-action="save-pack" ${publicationLocked || save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'save', 'Save'))}</button>`,
    noticesHtml: `${publicationLocked ? `<div class="v4-version-history-notice" role="status" aria-live="polite">${escapeHtml(publication.status || copyValue(copy, 'publicationLocked', 'Publication in progress. Editing and navigation are locked.'))}</div>` : ''}${previewBoundary ? `<div class="v4-pack-boundary-note" role="status">${escapeHtml(previewBoundary)}</div>` : ''}`,
    leftLabel: copyValue(copy, 'parts', 'Parts'),
    leftHtml,
    centerHtml,
    rightLabel: copyValue(copy, 'currentStyle', 'Current Style'),
    rightHtml,
    overlayHtml: advancedPanel,
    footerHtml: releasePanel,
  });
}

/**
 * Mount the standalone view into a host-owned route or modal body.
 * Creation dialogs remain a host concern via onRequestAdd, keeping this view
 * reusable without window.prompt() or a second modal stack.
 */
export function mountExpansionPackWorkspace(root, workspace, options = {}) {
  if (!root || typeof root !== 'object' || !('innerHTML' in root)) {
    throw new ExpansionPackWorkspaceError('A mount root with innerHTML is required.', 'missing-mount-root');
  }
  if (!workspace || typeof workspace.getState !== 'function' || typeof workspace.subscribe !== 'function') {
    throw new ExpansionPackWorkspaceError('Expansion Pack workspace controller is required.', 'missing-workspace');
  }
  let activeSection = normalizeMakerDefinitionEditorSection(options.activeSection);
  const initialState = workspace.getState();
  let initialSelection = packSelectionModel(initialState.parent, initialState.tree, options);
  let selectedPartId = initialSelection.partId;
  let selectedItemId = initialSelection.item?.id || '';
  let selectedStyleId = initialSelection.style?.id || '';
  let mounted = true;
  const currentCopy = () => (typeof options.copy === 'function' ? options.copy() : options.copy || {});
  const publicationLocked = () => {
    const publication = currentCopy().publicationState || {};
    return publication.locked === true || Boolean(
      publication.started
      || publication.busy
      || publication.receipt
      || publication.stage && !['', 'idle'].includes(publication.stage),
    );
  };
  const render = () => {
    const copy = typeof options.copy === 'function' ? options.copy() : options.copy || {};
    const state = workspace.getState();
    const selection = packSelectionModel(state.parent, state.tree, {
      selectedPartId,
      selectedItemId,
      selectedStyleId,
    });
    selectedPartId = selection.partId;
    selectedItemId = selection.item?.id || '';
    selectedStyleId = selection.style?.id || '';
    root.innerHTML = renderExpansionPackWorkspaceHtml(state, copy, {
      activeSection,
      selectedPartId,
      selectedItemId,
      selectedStyleId,
    });
    options.onRendered?.(workspace.getPreviewModel());
  };
  const reportError = (error) => {
    if (typeof options.onError === 'function') options.onError(error);
  };
  const onChange = (event) => {
    const target = event?.target;
    if (typeof target?.closest === 'function') {
      if (!target.closest('[data-expansion-pack-workspace]')) return;
      event.stopPropagation?.();
    }
    if (publicationLocked() && (
      target?.dataset?.renameKind
      || target?.dataset?.styleField
      || target?.dataset?.trackField
      || target?.dataset?.channelField
      || target?.dataset?.swatchField
      || target?.dataset?.ruleField
      || target?.dataset?.definitionRuleField
      || target?.dataset?.assetRequest === 'true'
    )) return;
    if (target?.dataset?.assetRequest === 'true') {
      const file = target.files?.[0];
      if (!file || typeof options.onRequestAsset !== 'function') return;
      const partId = text(target.dataset.partId);
      const itemId = text(target.dataset.itemId);
      const styleId = text(target.dataset.styleId);
      const requestedState = workspace.getState();
      const requestedIdentity = JSON.stringify(requestedState.identity);
      const requestedMutationRevision = requestedState.mutationRevision;
      const request = {
        file,
        partId,
        itemId,
        styleId,
        workspace,
      };
      Promise.resolve(options.onRequestAsset(request)).then((result) => {
        if (!result) return;
        const asset = result.asset || result.descriptor || (result.id ? result : null);
        const assetId = text(result.assetId ?? asset?.id);
        const currentState = workspace.getState();
        const styleExists = list(currentState.tree.parts).some((part) => (
          idOf(part) === partId
          && list(part.items).some((item) => (
            idOf(item) === itemId
            && list(item.styles).some((style) => idOf(style) === styleId)
          ))
        ));
        const canCommit = Boolean(
          assetId
          && result.cancelled !== true
          && result.canceled !== true
          && mounted
          && !publicationLocked()
          && JSON.stringify(currentState.identity) === requestedIdentity
          && currentState.mutationRevision === requestedMutationRevision
          && styleExists
        );
        if (!canCommit) {
          options.onAssetDiscarded?.({ ...request, result, asset, assetId });
          return;
        }
        try {
          workspace.updateStyle(partId, itemId, styleId, { assetId }, asset ? { assets: [asset] } : {});
        } catch (error) {
          options.onAssetDiscarded?.({ ...request, result, asset, assetId, error });
          throw error;
        }
        options.onAssetCommitted?.({ ...request, result, asset, assetId });
      }).catch(reportError).finally(() => {
        try { target.value = ''; } catch { /* A synthetic test target may be read-only. */ }
      });
      return;
    }
    const kind = target?.dataset?.renameKind;
    try {
      if (kind === 'pack') workspace.renamePack(target.value);
      else if (kind === 'part') workspace.renamePart(target.dataset.partId, target.value);
      else if (kind === 'item') workspace.renameItem(target.dataset.partId, target.dataset.itemId, target.value);
      else if (kind === 'style') {
        workspace.renameStyle(
          target.dataset.partId,
          target.dataset.itemId,
          target.dataset.styleId,
          target.value,
        );
      } else if (target?.dataset?.styleField) {
        const field = target.dataset.styleField;
        const value = ['blendMode', 'colorChannelId', 'layerTrackId'].includes(field) ? target.value : Number(target.value);
        const patch = field.startsWith('transform.')
          ? { transform: { [field.slice('transform.'.length)]: value } }
          : { [field]: value };
        workspace.updateStyle(
          target.dataset.partId,
          target.dataset.itemId,
          target.dataset.styleId,
          patch,
        );
      } else if (target?.dataset?.trackField === 'name') {
        workspace.renameLayerTrack(target.dataset.trackId, target.value);
      } else if (target?.dataset?.channelField) {
        workspace.updateColorChannel(target.dataset.channelId, { [target.dataset.channelField]: target.value });
      } else if (target?.dataset?.swatchField) {
        const { channelId, swatchId, swatchField } = target.dataset;
        if (swatchField === 'startColor' || swatchField === 'endColor') {
          const channel = list(workspace.getState().tree.colorChannels).find((candidate) => idOf(candidate) === channelId);
          const swatch = list(channel?.swatches).find((candidate) => idOf(candidate) === swatchId);
          const stops = clone(list(swatch?.stops));
          if (swatchField === 'startColor') stops[0] = { ...(stops[0] || { offset: 0 }), offset: 0, color: target.value };
          else stops[stops.length - 1] = { ...(stops.at(-1) || { offset: 1 }), offset: 1, color: target.value };
          workspace.updateColorSwatch(channelId, swatchId, { stops });
        } else {
          workspace.updateColorSwatch(channelId, swatchId, { [swatchField]: target.value });
        }
      } else if (target?.dataset?.ruleField) {
        const rule = list(workspace.getState().tree.rules).find((candidate) => idOf(candidate) === target.dataset.ruleId);
        if (!rule) return;
        const field = target.dataset.ruleField;
        const patch = field === 'type'
          ? { type: target.value }
          : field === 'targets'
            ? { targets: selectedControlValues(target).map(selectorFromControl) }
            : { trigger: selectorFromControl(target.value) };
        if (field === 'targets' && patch.targets.length === 0) return;
        workspace.updateRule(target.dataset.ruleId, patch);
      } else if (target?.dataset?.definitionRuleField) {
        const field = target.dataset.definitionRuleField;
        const owner = definitionRuleOwner(workspace.getState(), target.dataset);
        if (!owner) return;
        let patch;
        if (field === 'visibleWhenOp' || field === 'visibleWhenTargets') {
          const current = editableVisibilityModel(owner.rules?.visibleWhen);
          if (!current.editable) return;
          const editor = target.closest?.('[data-visible-when-editor]');
          const opControl = editor?.querySelector?.('[data-definition-rule-field="visibleWhenOp"]');
          const targetsControl = editor?.querySelector?.('[data-definition-rule-field="visibleWhenTargets"]');
          const op = field === 'visibleWhenOp'
            ? target.value
            : opControl?.value || target.dataset.visibleWhenOp;
          const selectors = field === 'visibleWhenTargets'
            ? selectedControlValues(target).map(selectorFromControl)
            : targetsControl
              ? selectedControlValues(targetsControl).map(selectorFromControl)
              : current.selectors;
          const visibleWhen = visibilityConditionFromControls(op, selectors);
          if (visibleWhen === undefined) return;
          patch = { visibleWhen };
        } else {
          patch = { [field]: selectedControlValues(target).map(selectorFromControl) };
        }
        if (target.dataset.definitionKind === 'part') workspace.updatePartRules(target.dataset.partId, patch);
        else if (target.dataset.definitionKind === 'item') workspace.updateItemRules(target.dataset.partId, target.dataset.itemId, patch);
        else workspace.updateStyleRules(target.dataset.partId, target.dataset.itemId, target.dataset.styleId, patch);
      }
    } catch (error) {
      reportError(error);
    }
  };
  const onClick = (event) => {
    const eventTarget = event?.target;
    const syntheticTarget = typeof eventTarget?.closest !== 'function';
    const workspaceBoundary = syntheticTarget
      ? eventTarget
      : eventTarget?.closest?.('[data-expansion-pack-workspace]');
    if (!workspaceBoundary) return;
    event.stopPropagation?.();
    const target = eventTarget?.dataset?.action
      ? eventTarget
      : eventTarget?.closest?.('[data-action]');
    const action = target?.dataset?.action;
    if (!action) return;
    if (!syntheticTarget && target.closest?.('[data-expansion-pack-workspace]') !== workspaceBoundary) return;
    if (action === 'pack-publication-action') {
      Promise.resolve(options.onPublicationAction?.(
        text(target.dataset.packPublicationAction),
        workspace.getState(),
      ))
        .catch(reportError);
      return;
    }
    if (publicationLocked()) return;
    if (action === 'select-pack-section') {
      activeSection = normalizeMakerDefinitionEditorSection(target.dataset.section, activeSection);
      render();
      root.querySelector?.(`[data-action="select-pack-section"][data-section="${activeSection}"]`)?.focus?.();
      options.onSectionChange?.(activeSection);
      return;
    }
    if (action === 'select-pack-part') {
      selectedPartId = text(target.dataset.partId);
      selectedItemId = '';
      selectedStyleId = '';
      render();
      options.onSelectionChange?.({ selectedPartId, selectedItemId, selectedStyleId });
      return;
    }
    if (action === 'select-pack-item') {
      selectedItemId = text(target.dataset.itemId);
      selectedStyleId = '';
      render();
      options.onSelectionChange?.({ selectedPartId, selectedItemId, selectedStyleId });
      return;
    }
    if (action === 'select-pack-style') {
      selectedStyleId = text(target.dataset.styleId);
      render();
      options.onSelectionChange?.({ selectedPartId, selectedItemId, selectedStyleId });
      return;
    }
    if (action === 'edit-pack-selection-rules') {
      activeSection = MAKER_DEFINITION_EDITOR_SECTION_IDS.RULES;
      render();
      options.onSectionChange?.(activeSection, {
        owner: text(target.dataset.ruleOwner),
        ownerType: text(target.dataset.ruleOwnerType),
      });
      return;
    }
    if (action === 'save-pack') {
      workspace.save().catch(reportError);
      return;
    }
    if (action === 'request-back-to-maker') {
      Promise.resolve(options.onRequestBackToMaker?.(workspace.getState()))
        .catch(reportError);
      return;
    }
    if (action === 'request-commerce-rights') {
      Promise.resolve(options.onRequestCommerceRights?.(workspace.getState()))
        .catch(reportError);
      return;
    }
    try {
      if (action === 'delete-pack-part') {
        workspace.removePart(target.dataset.partId);
        return;
      }
      if (action === 'delete-pack-item') {
        workspace.removeItem(target.dataset.partId, target.dataset.itemId);
        return;
      }
      if (action === 'delete-pack-style') {
        workspace.removeStyle(target.dataset.partId, target.dataset.itemId, target.dataset.styleId);
        return;
      }
      const state = workspace.getState();
      if (action === 'add-layer-track') {
        const id = nextLocalId(state.tree.layerTracks, 'track');
        workspace.addLayerTrack({ id, name: `${copyValue(currentCopy(), 'layerTracks', 'Layer Track')} ${state.tree.layerTracks.length + 1}` });
        return;
      }
      if (action === 'delete-layer-track') { workspace.removeLayerTrack(target.dataset.trackId); return; }
      if (action === 'toggle-layer-track') { workspace.setLayerTrackLocked(target.dataset.trackId, target.dataset.locked !== 'true'); return; }
      if (action === 'move-layer-track') { workspace.moveLayerTrack(target.dataset.trackId, Number(target.dataset.targetIndex)); return; }
      if (action === 'add-color-channel') {
        const id = nextLocalId(state.tree.colorChannels, 'color');
        workspace.addColorChannel({ id, name: `${copyValue(currentCopy(), 'smartColor', 'Smart Color')} ${state.tree.colorChannels.length + 1}`, swatches: [{ id: 'default', name: copyValue(currentCopy(), 'defaultSwatch', 'Default swatch'), hintColor: '#808080', stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }] });
        return;
      }
      if (action === 'delete-color-channel') { workspace.removeColorChannel(target.dataset.channelId); return; }
      if (action === 'add-color-swatch') {
        const channel = list(state.tree.colorChannels).find((candidate) => idOf(candidate) === target.dataset.channelId);
        const id = nextLocalId(channel?.swatches, 'swatch');
        workspace.addColorSwatch(target.dataset.channelId, { id, name: `${copyValue(currentCopy(), 'swatchName', 'Swatch')} ${list(channel?.swatches).length + 1}`, hintColor: '#808080', stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] });
        return;
      }
      if (action === 'delete-color-swatch') { workspace.removeColorSwatch(target.dataset.channelId, target.dataset.swatchId); return; }
      if (action === 'add-pack-rule') {
        const selector = selectorFromControl(target.dataset.defaultSelector);
        const defaultTarget = selectorFromControl(target.dataset.defaultTarget);
        const id = nextLocalId(state.tree.rules, 'rule');
        workspace.addRule({ id, type: 'excludes', trigger: selector, targets: [defaultTarget] });
        return;
      }
      if (action === 'delete-pack-rule') { workspace.removeRule(target.dataset.ruleId); return; }
      if (action === 'set-pack-part-mode') {
        if (target.dataset.mode === 'SLOT' && state.tree.supportsComposableV6 !== true) return;
        workspace.setPartMode(target.dataset.partId, target.dataset.mode);
        return;
      }
    } catch (error) {
      reportError(error);
      return;
    }
    if (action.startsWith('request-add-')) {
      options.onRequestAdd?.({
        kind: action.replace('request-add-', ''),
        partId: text(target.dataset.partId),
        itemId: text(target.dataset.itemId),
        workspace,
      });
    }
  };
  const onKeydown = (event) => {
    const target = event?.target;
    if (typeof target?.closest === 'function') {
      if (!target.closest('[data-expansion-pack-workspace]')) return;
      event.stopPropagation?.();
    }
    if (publicationLocked()) return;
    if (!event?.target?.dataset?.section || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const sections = editorSections(currentCopy());
    const index = sections.findIndex((section) => section.id === activeSection);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
    activeSection = sections[nextIndex].id;
    event.preventDefault?.();
    render();
    root.querySelector?.(`[data-action="select-pack-section"][data-section="${activeSection}"]`)?.focus?.();
    options.onSectionChange?.(activeSection);
  };
  root.addEventListener?.('change', onChange);
  root.addEventListener?.('click', onClick);
  root.addEventListener?.('keydown', onKeydown);
  const unsubscribe = workspace.subscribe(render);
  render();
  return {
    render,
    unmount() {
      mounted = false;
      unsubscribe();
      root.removeEventListener?.('change', onChange);
      root.removeEventListener?.('click', onClick);
      root.removeEventListener?.('keydown', onKeydown);
      root.innerHTML = '';
    },
  };
}

function nextLocalId(values, prefix) {
  const used = new Set(list(values).map(idOf));
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function selectorFromControl(value) {
  const [scope, partId, itemId, styleId] = String(value || '').split('|');
  return {
    ...(scope === 'base' ? { scope: 'base' } : { scope: 'pack' }),
    partId,
    ...(itemId ? { itemId } : {}),
    ...(styleId ? { styleId } : {}),
  };
}

function selectedControlValues(control) {
  if (control?.selectedOptions) {
    return Array.from(control.selectedOptions, (option) => String(option.value || '')).filter(Boolean);
  }
  if (control?.options) {
    return Array.from(control.options)
      .filter((option) => option.selected)
      .map((option) => String(option.value || ''))
      .filter(Boolean);
  }
  return control?.value ? [String(control.value)] : [];
}

function visibilityConditionFromControls(op, selectors) {
  const selected = list(selectors).filter((selector) => selector?.partId);
  if (op === 'always') return null;
  if (op === 'selected') return selected.length === 1 ? { ...selected[0], op: 'selected' } : undefined;
  if (op === 'not') return selected.length === 1
    ? { op: 'not', condition: { ...selected[0], op: 'selected' } }
    : undefined;
  if ((op === 'all' || op === 'any') && selected.length) {
    return { op, conditions: selected.map((selector) => ({ ...selector, op: 'selected' })) };
  }
  return undefined;
}

function definitionRuleOwner(state, dataset) {
  const part = list(state?.tree?.parts).find((candidate) => idOf(candidate) === dataset.partId);
  if (dataset.definitionKind === 'part') return part;
  const item = list(part?.items).find((candidate) => idOf(candidate) === dataset.itemId);
  if (dataset.definitionKind === 'item') return item;
  return list(item?.styles).find((candidate) => idOf(candidate) === dataset.styleId);
}
