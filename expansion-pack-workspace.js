/**
 * Standalone Expansion Pack authoring workspace.
 *
 * This module deliberately owns no router, modal, viewport height or nested
 * scrolling. A host can mount it in a route or dialog and remain the single
 * scroll owner. The controller is UI-independent and uses the v8 Pack draft
 * store as its only persistence boundary.
 */

import {
  addExpansionPackItem,
  addExpansionPackOptionalPart,
  addExpansionPackStyle,
  createExpansionPackProject,
  preflightExpansionPackProject,
  rehydrateExpansionPackProject,
  removeExpansionPackItem,
  removeExpansionPackPart,
  removeExpansionPackStyle,
  renameExpansionPack,
  renameExpansionPackItem,
  renameExpansionPackPart,
  renameExpansionPackStyle,
  updateExpansionPackStyle,
} from './expansion-pack-project.js';
import {
  createExpansionPackDraftStore,
  expansionPackDraftKey,
} from './expansion-pack-draft-store.js';
import { BLEND_MODES } from './maker-renderer.js';

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
    parts,
  });
}

export function createExpansionPackWorkspaceTree(projectValue) {
  const project = rehydrateExpansionPackProject(projectValue);
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

function renderParentPart(part, copy) {
  return `
    <details class="expansion-pack-parent-part">
      <summary><strong>${escapeHtml(part.name)}</strong><span>${escapeHtml(copyValue(copy, 'itemCount', `${part.items.length} Item(s)`).replace('{count}', String(part.items.length)))}</span></summary>
      <div class="expansion-pack-parent-items">
        ${part.items.map((item) => `
          <div class="expansion-pack-parent-item">
            <span>${escapeHtml(item.name)} · ${escapeHtml(copyValue(copy, 'styleCount', `${item.styles.length} Style(s)`).replace('{count}', String(item.styles.length)))}</span>
            <button type="button" data-action="request-add-style" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}">${escapeHtml(copyValue(copy, 'addStyle', '＋ Style'))}</button>
          </div>`).join('')}
        <button type="button" data-action="request-add-item" data-part-id="${escapeHtml(part.id)}">${escapeHtml(copyValue(copy, 'addItem', '＋ Item'))}</button>
      </div>
    </details>`;
}

function renderPackItem(part, item, copy) {
  const nameControl = item.readonlyName
    ? `<strong>${escapeHtml(item.name)}</strong><span class="expansion-pack-readonly-badge">${escapeHtml(copyValue(copy, 'parentItem', 'Parent Item'))}</span>`
    : `<input type="text" value="${escapeHtml(item.name)}" data-rename-kind="item" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(copyValue(copy, 'itemName', 'Item name'))}" />`;
  return `
    <article class="expansion-pack-item" data-item-id="${escapeHtml(item.id)}">
      <header>
        ${nameControl}<code>${escapeHtml(item.id)}</code>
        ${item.readonlyName ? '' : `<button type="button" data-action="delete-item" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(copyValue(copy, 'deleteItem', 'Delete Item'))}">${escapeHtml(copyValue(copy, 'deleteItem', 'Delete Item'))}</button>`}
      </header>
      <div class="expansion-pack-styles">
        ${item.styles.map((style) => renderPackStyle(part, item, style, copy)).join('') || `<p class="expansion-pack-empty">${escapeHtml(copyValue(copy, 'noPackStyle', 'No Pack Style yet.'))}</p>`}
      </div>
      <button type="button" data-action="request-add-style" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}">${escapeHtml(copyValue(copy, 'addStyle', '＋ Style'))}</button>
    </article>`;
}

function styleControlAttributes(part, item, style, field) {
  return `data-style-field="${escapeHtml(field)}" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}"`;
}

function renderPackStyle(part, item, style, copy) {
  const transform = style.transform || {};
  return `
    <article class="expansion-pack-style" data-style-id="${escapeHtml(style.id)}">
      <header>
        <label><span>${escapeHtml(copyValue(copy, 'styleName', 'Style name'))}</span><input type="text" value="${escapeHtml(style.name)}" data-rename-kind="style" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}" aria-label="${escapeHtml(copyValue(copy, 'styleName', 'Style name'))}" /></label>
        <code>${escapeHtml(style.id)}</code>
        <button type="button" data-action="delete-style" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}" aria-label="${escapeHtml(copyValue(copy, 'deleteStyle', 'Delete Style'))}">${escapeHtml(copyValue(copy, 'deleteStyle', 'Delete Style'))}</button>
      </header>
      <div class="expansion-pack-style-asset">
        <strong>${escapeHtml(style.assetId || copyValue(copy, 'pngRequired', 'PNG required'))}</strong>
        <label class="expansion-pack-file-button">${escapeHtml(copyValue(copy, 'uploadPng', 'Upload PNG'))}
          <input type="file" accept="image/png,.png" data-asset-request="true" data-part-id="${escapeHtml(part.id)}" data-item-id="${escapeHtml(item.id)}" data-style-id="${escapeHtml(style.id)}" />
        </label>
      </div>
      <div class="expansion-pack-style-controls">
        <label><span>X</span><input type="number" step="1" value="${escapeHtml(transform.x ?? 0)}" ${styleControlAttributes(part, item, style, 'transform.x')} /></label>
        <label><span>Y</span><input type="number" step="1" value="${escapeHtml(transform.y ?? 0)}" ${styleControlAttributes(part, item, style, 'transform.y')} /></label>
        <label><span>${escapeHtml(copyValue(copy, 'scale', 'Scale'))}</span><input type="number" min="0.01" step="0.01" value="${escapeHtml(transform.scale ?? 1)}" ${styleControlAttributes(part, item, style, 'transform.scale')} /></label>
        <label><span>${escapeHtml(copyValue(copy, 'rotation', 'Rotation'))}</span><input type="number" step="1" value="${escapeHtml(transform.rotation ?? 0)}" ${styleControlAttributes(part, item, style, 'transform.rotation')} /></label>
        <label><span>${escapeHtml(copyValue(copy, 'opacity', 'Opacity'))}</span><input type="number" min="0" max="1" step="0.01" value="${escapeHtml(style.opacity ?? 1)}" ${styleControlAttributes(part, item, style, 'opacity')} /></label>
        <label><span>${escapeHtml(copyValue(copy, 'blend', 'Blend'))}</span><select ${styleControlAttributes(part, item, style, 'blendMode')}>
          ${Object.keys(BLEND_MODES).map((mode) => `<option value="${escapeHtml(mode)}" ${mode === style.blendMode ? 'selected' : ''}>${escapeHtml(mode)}</option>`).join('')}
        </select></label>
      </div>
    </article>`;
}

function renderPackPart(part, copy) {
  const nameControl = part.readonlyName
    ? `<strong>${escapeHtml(part.name)}</strong><span class="expansion-pack-readonly-badge">${escapeHtml(copyValue(copy, 'parentPart', 'Parent Part'))}</span>`
    : `<input type="text" value="${escapeHtml(part.name)}" data-rename-kind="part" data-part-id="${escapeHtml(part.id)}" aria-label="${escapeHtml(copyValue(copy, 'partName', 'Part name'))}" />`;
  return `
    <section class="expansion-pack-part" data-part-id="${escapeHtml(part.id)}">
      <header>
        ${nameControl}<code>${escapeHtml(part.id)}</code>
        ${part.readonlyName ? '' : `<button type="button" data-action="delete-part" data-part-id="${escapeHtml(part.id)}" aria-label="${escapeHtml(copyValue(copy, 'deletePart', 'Delete Part'))}">${escapeHtml(copyValue(copy, 'deletePart', 'Delete Part'))}</button>`}
      </header>
      <div class="expansion-pack-items">
        ${part.items.map((item) => renderPackItem(part, item, copy)).join('') || `<p class="expansion-pack-empty">${escapeHtml(copyValue(copy, 'noPackContent', 'No Pack content in this Part yet.'))}</p>`}
      </div>
      <button type="button" data-action="request-add-item" data-part-id="${escapeHtml(part.id)}">${escapeHtml(copyValue(copy, 'addItem', '＋ Item'))}</button>
    </section>`;
}

function inheritanceContractLabel(id, copy) {
  const labels = {
    documentSchema: copyValue(copy, 'inheritDocumentSchema', 'Document schema'),
    parentMetadata: copyValue(copy, 'inheritMetadata', 'Maker metadata'),
    canvas: copyValue(copy, 'inheritCanvas', 'Canvas'),
    renderer: copyValue(copy, 'inheritRenderer', 'Renderer'),
    layerTracks: copyValue(copy, 'inheritLayerTracks', 'Layer Tracks'),
    baseDefinitions: copyValue(copy, 'inheritBaseDefinitions', 'Base definitions'),
    baseAssets: copyValue(copy, 'inheritBaseAssets', 'Base assets'),
    selectionRules: copyValue(copy, 'inheritRules', 'Rules'),
    smartColorChannels: copyValue(copy, 'inheritColors', 'Smart Color'),
    defaultRecipe: copyValue(copy, 'inheritDefaultRecipe', 'Default Recipe'),
    livingContent: copyValue(copy, 'inheritSoul', 'Soul / Living Content'),
    wardrobeCompatibility: copyValue(copy, 'inheritWardrobe', 'Wardrobe compatibility'),
    parentCommerce: copyValue(copy, 'inheritParentCommerce', 'Parent commerce prerequisite'),
    license: copyValue(copy, 'inheritLicense', 'License'),
  };
  return labels[id] || id;
}

/** Pure markup renderer. It intentionally contains no overflow container. */
export function renderExpansionPackWorkspaceHtml(model, copy = {}) {
  const state = model || {};
  const parent = state.parent || {};
  const tree = state.tree || { parts: [] };
  const preview = state.preview || {};
  const save = state.save || {};
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
  return `
    <section class="expansion-pack-workspace" data-expansion-pack-workspace data-scroll-owner="host" data-nested-scroll="false">
      <header class="expansion-pack-workspace-header">
        <div>
          <span>${escapeHtml(copyValue(copy, 'studio', 'Expansion Pack Studio'))}</span>
          <input type="text" value="${escapeHtml(tree.name || '')}" data-rename-kind="pack" aria-label="${escapeHtml(copyValue(copy, 'packName', 'Expansion Pack name'))}" />
          <small>${escapeHtml(tree.namespace || '')} · ${escapeHtml(tree.version || '')}</small>
        </div>
        <div class="expansion-pack-save-state" data-save-phase="${escapeHtml(save.phase || '')}" aria-live="polite">${escapeHtml(localizedSaveLabel(save, copy))}</div>
        <button type="button" data-action="save-pack" ${save.phase === EXPANSION_PACK_WORKSPACE_SAVE_PHASES.SAVING ? 'disabled' : ''}>${escapeHtml(copyValue(copy, 'save', 'Save Pack'))}</button>
      </header>

      <div class="expansion-pack-workspace-layout">
        <aside class="expansion-pack-parent-panel" aria-label="${escapeHtml(copyValue(copy, 'parentReadonly', 'Read-only parent Maker'))}">
          <span>${escapeHtml(copyValue(copy, 'parentReadonly', 'Read-only parent Maker'))}</span>
          <h3>${escapeHtml(parent.name || '')}</h3>
          <p class="expansion-pack-inheritance-summary">${escapeHtml(copyValue(copy, 'inheritanceSummary', 'Canvas, Renderer, Layer Tracks, rules and compatibility are inherited read-only.'))}</p>
          <p><strong>${escapeHtml(parentBindingLabel)}</strong></p>
          <dl>
            <div><dt>${escapeHtml(copyValue(copy, 'root', 'Root Maker'))}</dt><dd>${escapeHtml(parent.rootMakerId || '')}</dd></div>
            <div><dt>${escapeHtml(copyValue(copy, 'versionLabel', 'Version'))}</dt><dd>${escapeHtml(parent.versionNumber || '')}</dd></div>
            <div><dt>${escapeHtml(copyValue(copy, 'canvas', 'Canvas'))}</dt><dd>${escapeHtml(parent.canvas?.width || 0)} × ${escapeHtml(parent.canvas?.height || 0)}</dd></div>
            <div><dt>${escapeHtml(copyValue(copy, 'bindingKind', 'Binding'))}</dt><dd>${escapeHtml(parent.bindingKind || '')}</dd></div>
            <div><dt>${escapeHtml(copyValue(copy, 'releaseId', 'Release id'))}</dt><dd><code>${escapeHtml(parent.releaseId || '—')}</code></dd></div>
            <div><dt>${escapeHtml(copyValue(copy, 'manifestBlobId', 'Manifest Blob / Quilt'))}</dt><dd><code>${escapeHtml(parent.manifestBlobId || '—')}</code></dd></div>
            <div><dt>${escapeHtml(copyValue(copy, 'manifestHash', 'Manifest SHA-256'))}</dt><dd><code>${escapeHtml(parent.manifestHash || '—')}</code></dd></div>
          </dl>
          <div class="expansion-pack-inheritance-contracts">
            <strong>${escapeHtml(copyValue(copy, 'inheritanceContract', 'Inherited contract'))}</strong>
            <ul>
              ${list(parent.inheritance?.contracts).map((contract) => `<li><span>${escapeHtml(inheritanceContractLabel(contract.id, copy))}</span> · <code>${escapeHtml(contract.mode || '')}</code></li>`).join('')}
            </ul>
          </div>
          <div class="expansion-pack-parent-parts">
            ${list(parent.parts).map((part) => renderParentPart(part, copy)).join('')}
          </div>
        </aside>

        <main class="expansion-pack-authoring-panel">
          <header>
            <div><span>${escapeHtml(copyValue(copy, 'overlay', 'Pack overlay'))}</span><h3>${escapeHtml(copyValue(copy, 'additiveOnly', 'Additive content only'))}</h3></div>
            <button type="button" data-action="request-add-part">${escapeHtml(copyValue(copy, 'addPart', '＋ Optional Part'))}</button>
          </header>
          <div class="expansion-pack-tree">
            ${list(tree.parts).map((part) => renderPackPart(part, copy)).join('') || `
              <div class="expansion-pack-empty-state">
                <strong>${escapeHtml(copyValue(copy, 'emptyPack', 'This Pack is empty.'))}</strong>
                <p>${escapeHtml(copyValue(copy, 'emptyPackCopy', 'Add an Item or Style to a parent definition, or create an optional Part.'))}</p>
              </div>`}
          </div>
        </main>

        <aside class="expansion-pack-preview-panel" aria-label="${escapeHtml(copyValue(copy, 'preview', 'Merged preview'))}">
          <span>${escapeHtml(copyValue(copy, 'preview', 'Merged preview'))}</span>
          <h3>${escapeHtml(previewLabel)}</h3>
          ${previewBoundary ? `<p>${escapeHtml(previewBoundary)}</p>` : ''}
          <p>${escapeHtml(additions)}</p>
          <p>${escapeHtml(copyValue(copy, 'preflightIssues', '{count} preflight issue(s)').replace('{count}', String(list(preview.issues).length)))}</p>
          <canvas data-expansion-pack-preview-canvas aria-label="${escapeHtml(copyValue(copy, 'preview', 'Merged preview'))}"></canvas>
          <div class="expansion-pack-preview-actions">
            <button type="button" data-action="open-preview" ${preview.maker ? '' : 'disabled'}>${escapeHtml(copyValue(copy, 'openPreview', 'Refresh merged preview'))}</button>
            ${preview.parentBinding?.localParent ? `<button type="button" data-action="request-rebind-parent" ${copy?.canRebindParent === true ? '' : `disabled title="${escapeHtml(copyValue(copy, 'rebindUnavailable', 'Publish and verify this parent version before binding the Pack.'))}"`}>${escapeHtml(copyValue(copy, 'rebindParent', 'Bind published parent release'))}</button>${copy?.canRebindParent === true ? '' : `<small role="status">${escapeHtml(copyValue(copy, 'rebindUnavailable', 'Publish and verify this parent version before binding the Pack.'))}</small>`}` : ''}
            ${preview.publishable ? `<button type="button" data-action="request-publication-candidate">${escapeHtml(copyValue(copy, 'preparePublicationCandidate', 'Prepare publication candidate'))}</button><small>${escapeHtml(copyValue(copy, 'publicationCandidateOnly', 'Candidate only · Walrus upload and Sui registration have not started.'))}</small>` : ''}
          </div>
        </aside>
      </div>
    </section>`;
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
  const render = () => {
    root.innerHTML = renderExpansionPackWorkspaceHtml(workspace.getState(), options.copy || {});
    options.onRendered?.(workspace.getPreviewModel());
  };
  const reportError = (error) => {
    if (typeof options.onError === 'function') options.onError(error);
  };
  const onChange = (event) => {
    const target = event?.target;
    if (target?.closest?.('[data-expansion-pack-workspace]')) event.stopPropagation?.();
    if (target?.dataset?.assetRequest === 'true') {
      const file = target.files?.[0];
      if (!file || typeof options.onRequestAsset !== 'function') return;
      Promise.resolve(options.onRequestAsset({
        file,
        partId: text(target.dataset.partId),
        itemId: text(target.dataset.itemId),
        styleId: text(target.dataset.styleId),
        workspace,
      })).then((result) => {
        if (!result) return;
        const asset = result.asset || result.descriptor || (result.id ? result : null);
        const assetId = text(result.assetId ?? asset?.id);
        if (!assetId) return;
        workspace.updateStyle(
          target.dataset.partId,
          target.dataset.itemId,
          target.dataset.styleId,
          { assetId },
          asset ? { assets: [asset] } : {},
        );
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
        const value = field === 'blendMode' ? target.value : Number(target.value);
        const patch = field.startsWith('transform.')
          ? { transform: { [field.slice('transform.'.length)]: value } }
          : { [field]: value };
        workspace.updateStyle(
          target.dataset.partId,
          target.dataset.itemId,
          target.dataset.styleId,
          patch,
        );
      }
    } catch (error) {
      reportError(error);
    }
  };
  const onClick = (event) => {
    const target = event?.target;
    const action = target?.dataset?.action;
    if (!action) return;
    event.stopPropagation?.();
    if (action === 'save-pack') {
      workspace.save().catch(reportError);
      return;
    }
    if (action === 'open-preview') {
      options.onPreview?.(workspace.getPreviewModel());
      return;
    }
    if (action === 'request-rebind-parent') {
      Promise.resolve(options.onRequestRebindParent?.(workspace.getState()))
        .catch(reportError);
      return;
    }
    if (action === 'request-publication-candidate') {
      Promise.resolve(options.onRequestPublicationCandidate?.(workspace.getState()))
        .catch(reportError);
      return;
    }
    try {
      if (action === 'delete-part') {
        workspace.removePart(target.dataset.partId);
        return;
      }
      if (action === 'delete-item') {
        workspace.removeItem(target.dataset.partId, target.dataset.itemId);
        return;
      }
      if (action === 'delete-style') {
        workspace.removeStyle(target.dataset.partId, target.dataset.itemId, target.dataset.styleId);
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
  root.addEventListener?.('change', onChange);
  root.addEventListener?.('click', onClick);
  const unsubscribe = workspace.subscribe(render);
  render();
  return {
    render,
    unmount() {
      unsubscribe();
      root.removeEventListener?.('change', onChange);
      root.removeEventListener?.('click', onClick);
      root.innerHTML = '';
    },
  };
}
