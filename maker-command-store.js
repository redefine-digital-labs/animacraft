function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

export function createMakerCommandStore(initialDocument, initialRecipe, options = {}) {
  const historyLimit = Math.max(10, Number(options.historyLimit || 100));
  const listeners = new Set();
  let document = clone(initialDocument);
  let recipe = clone(initialRecipe);
  let undoStack = [];
  let redoStack = [];
  let revision = 0;
  let savedRevision = 0;
  let persistedRevision = null;
  let saveState = 'saved';
  let saveMessage = '';

  const snapshot = () => ({ document: clone(document), recipe: clone(recipe) });
  const notify = (reason, label = '') => {
    const state = api.getState();
    listeners.forEach((listener) => listener(state, { reason, label }));
  };
  const commitSnapshot = (next, label) => {
    const before = snapshot();
    document = clone(next.document);
    recipe = clone(next.recipe);
    undoStack.push({ label, before, after: snapshot(), at: nowIso() });
    if (undoStack.length > historyLimit) undoStack.shift();
    redoStack = [];
    revision += 1;
    saveState = 'dirty';
    saveMessage = 'Unsaved changes';
    notify('execute', label);
  };

  const api = {
    getState() {
      return {
        document,
        recipe,
        revision,
        savedRevision,
        persistedRevision,
        dirty: revision !== savedRevision,
        saveState,
        saveMessage,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undoLabel: undoStack.at(-1)?.label || '',
        redoLabel: redoStack.at(-1)?.label || '',
      };
    },
    execute(label, mutator) {
      if (typeof mutator !== 'function') throw new Error('A Maker command mutator is required.');
      const next = snapshot();
      mutator(next);
      commitSnapshot(next, String(label || 'Edit Maker'));
      return api.getState();
    },
    replace(nextDocument, nextRecipe, {
      clearHistory = true,
      markSaved = true,
      persistedRevision: nextPersistedRevision = null,
    } = {}) {
      document = clone(nextDocument);
      recipe = clone(nextRecipe);
      revision = Number.isSafeInteger(nextPersistedRevision) && nextPersistedRevision >= 0
        ? Math.max(revision, nextPersistedRevision)
        : revision + 1;
      if (Number.isSafeInteger(nextPersistedRevision) && nextPersistedRevision >= 0) {
        persistedRevision = nextPersistedRevision;
      }
      if (clearHistory) {
        undoStack = [];
        redoStack = [];
      }
      if (markSaved) savedRevision = revision;
      saveState = markSaved ? 'saved' : 'dirty';
      saveMessage = markSaved ? 'Loaded' : 'Unsaved changes';
      notify('replace');
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return false;
      document = clone(command.before.document);
      recipe = clone(command.before.recipe);
      redoStack.push(command);
      revision += 1;
      saveState = 'dirty';
      saveMessage = `Undid ${command.label}`;
      notify('undo', command.label);
      return true;
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return false;
      document = clone(command.after.document);
      recipe = clone(command.after.recipe);
      undoStack.push(command);
      revision += 1;
      saveState = 'dirty';
      saveMessage = `Redid ${command.label}`;
      notify('redo', command.label);
      return true;
    },
    setSaveState(nextState, message = '', options = {}) {
      const hasPersistedAcknowledgement = Number.isInteger(options.revision);
      const acknowledgedRevision = hasPersistedAcknowledgement
        ? Math.min(options.revision, revision)
        : revision;
      if (nextState === 'saved') {
        savedRevision = Math.max(savedRevision, acknowledgedRevision);
        if (hasPersistedAcknowledgement) {
          persistedRevision = persistedRevision === null
            ? acknowledgedRevision
            : Math.max(persistedRevision, acknowledgedRevision);
        }
        saveState = savedRevision === revision ? 'saved' : 'dirty';
        saveMessage = saveState === 'saved'
          ? String(message || '')
          : String(options.pendingMessage || 'Unsaved changes');
      } else {
        saveState = nextState;
        saveMessage = String(message || '');
      }
      notify('save-state');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    exportJournal() {
      return undoStack.map(({ label, at }) => ({ label, at }));
    },
    snapshotForSave() {
      return {
        ...snapshot(),
        revision,
        baseRevision: persistedRevision,
        journal: api.exportJournal(),
      };
    },
  };

  return api;
}
