import { projectMakerV8LocalPlayerView } from './maker-player-v8-view.js';
import { createMakerV8LocalPlayerPersistence } from './maker-v8-local-player-persistence.js';
import { exactMakerV8ExportOptions, makerV8ExportSizes } from './maker-v8-render-core.js';

const ACTIONS = new Set([
  'player-part', 'player-item', 'player-style', 'player-none', 'player-color', 'player-output',
  'player-palette', 'player-close-palette', 'player-info', 'close-player-info',
  'close-player-info-backdrop', 'player-reset', 'player-undo', 'player-redo', 'player-clear',
  'player-profile-name', 'player-profile-world', 'player-profile-description',
  'player-profile-tags', 'player-soul-document', 'player-reset-soul-document', 'player-reset-all-soul',
]);
const EXPORT_ACTIONS = new Set([
  'player-preview-export', 'player-export-retry', 'close-player-export',
  'close-player-export-backdrop', 'player-download-png',
  'player-export-size', 'player-export-background',
]);
const clone = (value) => structuredClone(value);
function fail(code, message) {
  throw Object.assign(new Error(message), { code, layer: 'DRAFT' });
}

/** Local-only action orchestration. The owner supplies the approved mount/draw.
 * No DOM listeners, storage, wallet, transaction, remote transport or mint API.
 */
export function createMakerV8LocalPlayerControls({
  session, locale = 'en', assetUrls = {}, onChange = () => {}, pngExport = null, recipeExport = null,
} = {}) {
  for (const method of ['getSnapshot', 'setRecipe', 'setPersonalization', 'setImageExport', 'reset', 'undo', 'redo', 'renderPreview', 'dispose']) {
    if (typeof session?.[method] !== 'function') throw new TypeError(`Local Player requires ${method}.`);
  }
  let disposed = false;
  let renderTicket = 0;
  let rendered = null;
  let renderedRevision = null;
  let pendingPreviewRevision = null;
  let exportTicket = 0;
  let exportRecord = null;
  let exportRevision = null;
  const exportEnabled = ['createUrl', 'revokeUrl', 'download'].every((key) => typeof pngExport?.[key] === 'function');
  const recipeExportEnabled = typeof session.exportCheckpoint === 'function' && typeof recipeExport === 'function';
  const state = {
    locale, assetUrls: { ...assetUrls }, selectedPartKey: '', pickerPanel: 'parts',
    introOpen: true, render: { state: 'pending' }, playerTest: { state: 'idle', message: '' },
    export: { open: false, state: 'idle', previewUrl: '' },
  };
  const persistence = ['loadCheckpoint', 'restoreCheckpoint', 'captureCheckpointSave'].every((key) => typeof session[key] === 'function')
    ? createMakerV8LocalPlayerPersistence(session, (status) => {
      state.localSave = status;
      if (!disposed) emit();
    }) : null;
  const clearExport = () => {
    exportTicket += 1;
    const url = state.export.previewUrl;
    state.export = { open: false, state: 'idle', previewUrl: '' };
    exportRecord = null;
    exportRevision = null;
    if (url) pngExport.revokeUrl(url);
  };
  const current = () => {
    if (disposed) fail('MAKER_V8_LOCAL_PLAYER_CONTROLS_CLOSED', 'Local Player controls are closed.');
    return session.getSnapshot();
  };
  const view = () => {
    const snapshot = current();
    const controls = Object.fromEntries([...ACTIONS].map((action) => [action, true]));
    if (exportEnabled) for (const action of EXPORT_ACTIONS) controls[action] = true;
    if (recipeExportEnabled) for (const action of ['player-export', 'player-export-recipe']) controls[action] = true;
    if (persistence) controls['player-retry-save'] = persistence.isReady();
    if (persistence && !persistence.isReady()) for (const action of Object.keys(controls)) controls[action] = false;
    controls['player-none'] = false;
    for (const part of snapshot.document.parts) controls[`player-none:${part.key}`] = !part.required;
    return projectMakerV8LocalPlayerView(snapshot, { ...state,
      export: { ...state.export, ...snapshot.imageExport },
    }, { default: false, controls });
  };
  const emit = () => {
    const next = view();
    // Rendering observers cannot turn a completed local edit into a failed CAS.
    try { onChange(next); } catch {}
    return next;
  };
  const refresh = async () => {
    const revision = current().revision;
    clearExport();
    const ticket = ++renderTicket;
    pendingPreviewRevision = revision;
    rendered = null;
    renderedRevision = null;
    state.render = { state: 'pending' };
    state.playerTest = { state: 'idle', message: '' };
    emit();
    try {
      const png = await session.renderPreview();
      if (disposed || ticket !== renderTicket || current().revision !== revision) return null;
      rendered = png;
      renderedRevision = revision;
      state.render = { state: 'ready', message: 'Preview ready.' };
      emit();
      return png;
    } catch (error) {
      if (disposed || ticket !== renderTicket) return null;
      state.render = { state: 'error', message: String(error?.message || error) };
      state.playerTest = { state: 'error', message: state.render.message };
      emit();
      throw error;
    } finally {
      if (ticket === renderTicket) pendingPreviewRevision = null;
    }
  };
  const openExport = async (settings = current().imageExport) => {
    if (persistence && !persistence.isReady()) fail('LOCAL_PLAYER_NOT_RECOVERED', 'Wait for local checkpoint recovery.');
    const before = current();
    const options = exactMakerV8ExportOptions(before.document.canvas, settings);
    const snapshot = session.setImageExport(options, before.revision);
    // Preference-only edits do not change the already rendered editing pixels.
    if (renderedRevision === before.revision) renderedRevision = snapshot.revision;
    // Capture durable intent before starting rendering. Closing/disposal and
    // render failure must not cancel this save; errors remain retryable in UI.
    if (snapshot.revision !== before.revision) {
      persistence?.save().catch(() => {});
      // A still-running preview belongs to the old revision. Replace it, rather
      // than accepting stale pixels or leaving the editing canvas pending.
      if (pendingPreviewRevision !== null) refresh().catch(() => {});
    }
    const sizes = makerV8ExportSizes(snapshot.document.canvas);
    clearExport();
    const ticket = exportTicket;
    state.export = { ...sizes, ...options, open: true, state: 'rendering', previewUrl: '' };
    emit();
    try {
      const png = await session.renderPreview(options);
      if (disposed || ticket !== exportTicket || current().revision !== snapshot.revision) return null;
      const dimensions = sizes[options.sizeMode];
      if (!png || png.width !== dimensions.width || png.height !== dimensions.height) {
        fail('MAKER_V8_LOCAL_PLAYER_EXPORT_SIZE_MISMATCH', 'Rendered export dimensions differ from the requested size.');
      }
      const url = pngExport.createUrl(png);
      if (disposed || ticket !== exportTicket || current().revision !== snapshot.revision) {
        pngExport.revokeUrl(url);
        return null;
      }
      exportRecord = png;
      exportRevision = snapshot.revision;
      state.export = {
        ...sizes, ...options, open: true, state: 'ready', previewUrl: url,
      };
      emit();
      return png;
    } catch (error) {
      if (disposed || ticket !== exportTicket) return null;
      state.export = { ...sizes, ...options, open: true, state: 'error', previewUrl: '', error: String(error?.message || error) };
      emit();
      throw error;
    }
  };
  const edit = async (mutate) => {
    if (persistence && !persistence.isReady()) fail('LOCAL_PLAYER_NOT_RECOVERED', 'Wait for local checkpoint recovery.');
    const before = current();
    try {
      mutate(before);
    } catch (error) {
      state.playerTest = { state: 'error', message: String(error?.message || error) };
      emit();
      throw error;
    }
    state.playerTest = { state: 'idle', message: '' };
    if (current().revision === before.revision) return emit();
    const results = await Promise.allSettled([refresh(), persistence?.save()]);
    if (results[0].status === 'rejected') throw results[0].reason;
    return view();
  };
  const select = (before, choiceId) => {
    const choice = view().parts.flatMap((part) => part.choices).find((row) => row.id === choiceId);
    if (!choice) fail('MAKER_V8_LOCAL_PLAYER_CHOICE_INVALID', 'Local choice does not exist.');
    const part = before.document.parts.find((row) => row.key === choice.partKey);
    const recipe = clone(before.recipe);
    const indexes = recipe.selections.flatMap((row, index) => row.partKey === part.key ? [index] : []);
    const exact = recipe.selections.findIndex((row) => row.partKey === part.key
      && row.itemKey === choice.itemKey && row.styleKey === choice.styleKey);
    if (exact >= 0) {
      if (part.required && indexes.length === 1) return;
      recipe.selections.splice(exact, 1);
    } else {
      const next = { partKey: part.key, itemKey: choice.itemKey, styleKey: choice.styleKey };
      const item = recipe.selections.findIndex((row) => row.partKey === part.key && row.itemKey === choice.itemKey);
      if (item >= 0) recipe.selections[item] = next;
      else if (indexes.length < part.capacity) recipe.selections.push(next);
      else if (part.capacity === 1) recipe.selections[indexes[0]] = next;
      else fail('MAKER_V8_LOCAL_PLAYER_CAPACITY_EXCEEDED', 'This Part has no empty local slot.');
    }
    session.setRecipe(recipe, before.revision);
  };
  // Validate the actual branded local snapshot before exposing any controller.
  view();
  return Object.freeze({
    getView: view,
    getRenderRecord() {
      const snapshot = current();
      return snapshot.revision === renderedRevision ? rendered : null;
    },
    refresh,
    async initialize() { if (persistence) await persistence.initialize(); return disposed ? null : view(); },
    flush: () => persistence ? persistence.flush() : Promise.resolve(null),
    hasUnsavedChanges: () => persistence?.hasUnsavedChanges() || false,
    setLocale(next) { current(); state.locale = next; return emit(); },
    async dispatch(action, data = {}) {
      current();
      if (action === 'player-retry-save' && persistence) { await persistence.save(); return view(); }
      if (recipeExportEnabled && ['player-export', 'player-export-recipe'].includes(action)) {
        const revision = current().revision;
        try {
          const serialized = await session.exportCheckpoint();
          if (disposed || current().revision !== revision) return null;
          return await recipeExport(serialized);
        } catch (error) {
          if (!disposed && current().revision === revision) {
            state.playerTest = { state: 'error', message: String(error?.message || error) };
            emit();
          }
          throw error;
        }
      }
      if (!ACTIONS.has(action) && !(exportEnabled && EXPORT_ACTIONS.has(action))) fail('MAKER_V8_LOCAL_PLAYER_ACTION_UNAVAILABLE', 'This action is not a local Player operation.');
      if (action === 'player-reset-soul-document' || action === 'player-reset-all-soul') return edit((before) => {
        const soulDocuments = clone(before.soulDocuments);
        const keys = action === 'player-reset-all-soul' ? Object.keys(soulDocuments) : [data.soulKey];
        for (const key of keys) {
          if (!Object.hasOwn(soulDocuments, key)) fail('MAKER_V8_LOCAL_PLAYER_SOUL_INVALID', 'Unknown local Soul document.');
          soulDocuments[key] = before.document.livingContent[key];
        }
        session.setPersonalization({ profile: clone(before.profile), soulDocuments }, before.revision);
      });
      if (action.startsWith('player-profile-') || action === 'player-soul-document') return edit((before) => {
        const profile = clone(before.profile);
        const soulDocuments = clone(before.soulDocuments);
        if (action === 'player-soul-document') {
          if (!Object.hasOwn(soulDocuments, data.soulKey)) fail('MAKER_V8_LOCAL_PLAYER_SOUL_INVALID', 'Unknown local Soul document.');
          soulDocuments[data.soulKey] = data.value;
        } else profile[action.slice('player-profile-'.length)] = data.value;
        session.setPersonalization({ profile, soulDocuments }, before.revision);
      });
      if (action === 'player-preview-export' || action === 'player-export-retry') return openExport();
      if (action === 'player-export-size' || action === 'player-export-background') {
        if (!state.export.open) fail('MAKER_V8_LOCAL_PLAYER_EXPORT_NOT_READY', 'Open the export preview before changing its options.');
        if (action === 'player-export-background' && !['true', 'false'].includes(data.transparent)) {
          fail('MAKER_V8_LOCAL_PLAYER_EXPORT_OPTIONS_INVALID', 'Export background must be true or false.');
        }
        return openExport({ ...current().imageExport, ...(action === 'player-export-size'
          ? { sizeMode: data.sizeMode } : { transparent: data.transparent === 'true' }) });
      }
      if (action === 'close-player-export' || action === 'close-player-export-backdrop') { clearExport(); return emit(); }
      if (action === 'player-download-png') {
        if (!exportRecord || exportRevision !== current().revision
          || state.export.state !== 'ready' || !state.export.previewUrl) {
          fail('MAKER_V8_LOCAL_PLAYER_EXPORT_NOT_READY', 'Render the current local recipe before downloading.');
        }
        const ticket = exportTicket;
        try {
          return await pngExport.download(state.export.previewUrl, exportRecord);
        } catch (error) {
          if (!disposed && ticket === exportTicket) {
            const options = { ...state.export };
            clearExport();
            state.export = { ...options, open: true, state: 'error', previewUrl: '', error: String(error?.message || error) };
            emit();
          }
          throw error;
        }
      }
      if (action === 'player-item' || action === 'player-style') return edit((before) => select(before, data.choiceId));
      if (['player-reset', 'player-undo', 'player-redo'].includes(action)) {
        return edit((before) => session[action.slice('player-'.length)](before.revision));
      }
      if (action === 'player-none' || action === 'player-clear') return edit((before) => {
        const recipe = clone(before.recipe);
        const target = before.document.parts.find((part) => part.key === data.partId);
        if (action === 'player-none' && (!target || target.required)) fail('MAKER_V8_LOCAL_PLAYER_REQUIRED_PART', 'This Part cannot be cleared.');
        recipe.selections = recipe.selections.filter((row) => action === 'player-none'
          ? row.partKey !== target.key
          : before.document.parts.find((part) => part.key === row.partKey).required);
        session.setRecipe(recipe, before.revision);
      });
      if (action === 'player-output') return edit((before) => {
        session.setRecipe({ ...clone(before.recipe), outputKey: data.outputKey }, before.revision);
      });
      if (action === 'player-color') return edit((before) => {
        const recipe = clone(before.recipe);
        const entry = { channelKey: data.channelId, swatchKey: data.swatchId };
        recipe.colors = [...recipe.colors.filter((row) => row.channelKey !== entry.channelKey), entry];
        session.setRecipe(recipe, before.revision);
      });
      if (action === 'player-part') {
        if (!view().parts.some((part) => part.key === data.partId)) fail('MAKER_V8_LOCAL_PLAYER_PART_INVALID', 'This Part is not visible in Player.');
        state.selectedPartKey = data.partId;
        state.pickerPanel = 'parts';
      }
      if (action === 'player-palette') state.pickerPanel = 'colors';
      if (action === 'player-close-palette') state.pickerPanel = 'parts';
      if (action === 'player-info') state.introOpen = true;
      if (action === 'close-player-info' || action === 'close-player-info-backdrop') state.introOpen = false;
      return emit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const draining = persistence?.dispose();
      renderTicket += 1;
      clearExport();
      rendered = null;
      session.dispose();
      return draining;
    },
  });
}
