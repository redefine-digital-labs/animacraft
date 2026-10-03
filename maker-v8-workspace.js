import { canonicalMakerV8Json } from './maker-v8-compiler.js';
import {
  assertMakerV8Document,
  collectMakerV8DocumentIssues,
  projectPublicMakerV8Document,
} from './maker-v8-document.js';

export const MAKER_V8_WORKSPACE_SCHEMA = 'animacraft.maker-v8-workspace.v1';
export const MAKER_V8_PROJECT_EXPORT_SCHEMA = 'animacraft.maker-v8-project-export.v1';

const COLLECTIONS = Object.freeze({
  'track.upsert': 'tracks',
  'color.upsert': 'colors',
  'part.upsert': 'parts',
  'rule.upsert': 'rules',
  'output.upsert': 'outputs',
  'asset.upsert': 'assets',
});
const REMOVALS = Object.freeze({
  'track.remove': 'tracks',
  'color.remove': 'colors',
  'part.remove': 'parts',
  'rule.remove': 'rules',
  'output.remove': 'outputs',
  'asset.remove': 'assets',
});
const SAFE_KEY = /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class MakerV8WorkspaceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MakerV8WorkspaceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new MakerV8WorkspaceError(code, message, details);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, fields, label, optionalFields = []) {
  if (!plain(value)) fail('MAKER_V8_WORKSPACE_COMMAND_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields, ...optionalFields.filter((field) => Object.hasOwn(value, field))].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('MAKER_V8_WORKSPACE_COMMAND_INVALID', `${label} has unexpected fields.`, { actual, expected });
  }
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function documentSnapshot(value) {
  assertMakerV8Document(value, { mode: 'draft' });
  return freeze(structuredClone(value));
}

function key(value, label) {
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) {
    fail('MAKER_V8_WORKSPACE_KEY_INVALID', `${label} is not a safe author key.`);
  }
  return value;
}

function collectionRowKey(collection, row) {
  return collection === 'assets' ? row?.id : row?.key;
}

function upsert(document, collection, row) {
  if (!plain(row)) fail('MAKER_V8_WORKSPACE_ROW_INVALID', `${collection} row must be a plain record.`);
  const rowKey = key(collectionRowKey(collection, row), `${collection} key`);
  const index = document[collection].findIndex((candidate) => collectionRowKey(collection, candidate) === rowKey);
  if (index < 0) document[collection].push(structuredClone(row));
  else document[collection][index] = structuredClone(row);
}

function remove(document, collection, rowKeyInput) {
  const rowKey = key(rowKeyInput, `${collection} key`);
  const index = document[collection].findIndex((candidate) => collectionRowKey(collection, candidate) === rowKey);
  if (index < 0) fail('MAKER_V8_WORKSPACE_ROW_NOT_FOUND', `${collection} row ${rowKey} does not exist.`);
  document[collection].splice(index, 1);
}

export function applyMakerV8WorkspaceCommand(documentInput, command) {
  const document = structuredClone(documentSnapshot(documentInput));
  if (!plain(command) || typeof command.type !== 'string') {
    fail('MAKER_V8_WORKSPACE_COMMAND_INVALID', 'Workspace command requires an exact type.');
  }

  if (command.type === 'metadata.set') {
    exactKeys(command, ['type', 'metadata'], 'metadata.set');
    exactKeys(command.metadata, ['name', 'summary', 'license', 'coverAssetId'], 'metadata', ['creator', 'style']);
    document.metadata = structuredClone(command.metadata);
  } else if (command.type === 'livingContent.set') {
    exactKeys(command, ['type', 'livingContent'], 'livingContent.set');
    document.livingContent = structuredClone(command.livingContent);
  } else if (command.type === 'canvas.set') {
    exactKeys(command, ['type', 'canvas'], 'canvas.set');
    exactKeys(command.canvas, ['width', 'height', 'pixelMode'], 'canvas');
    document.canvas = structuredClone(command.canvas);
  } else if (command.type === 'composition.set') {
    exactKeys(command, ['type', 'composition'], 'composition.set');
    exactKeys(command.composition, ['mode', 'thirdPartyAdmission', 'itemAssetization'], 'composition');
    document.composition = structuredClone(command.composition);
  } else if (command.type === 'commerce.set') {
    exactKeys(command, ['type', 'commerce'], 'commerce.set');
    document.commerce = structuredClone(command.commerce);
  } else if (command.type === 'recipe.set') {
    exactKeys(command, ['type', 'recipe'], 'recipe.set');
    exactKeys(command.recipe, ['selections', 'colors'], 'recipe');
    document.defaultRecipe = structuredClone(command.recipe);
  } else if (Object.hasOwn(COLLECTIONS, command.type)) {
    exactKeys(command, ['type', 'row'], command.type);
    upsert(document, COLLECTIONS[command.type], command.row);
  } else if (Object.hasOwn(REMOVALS, command.type)) {
    exactKeys(command, ['type', 'key'], command.type);
    remove(document, REMOVALS[command.type], command.key);
  } else {
    fail('MAKER_V8_WORKSPACE_COMMAND_UNKNOWN', `Unknown workspace command ${String(command.type)}.`);
  }

  return documentSnapshot(document);
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function exportMakerV8Project(documentInput) {
  const document = documentSnapshot(documentInput);
  const canonical = canonicalMakerV8Json(document);
  return freeze({
    schemaVersion: MAKER_V8_PROJECT_EXPORT_SCHEMA,
    document,
    documentSha256: await sha256(canonical),
  });
}

export function createMakerV8Workspace({ document, historyLimit = 100 } = {}) {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 1_000) {
    fail('MAKER_V8_WORKSPACE_HISTORY_INVALID', 'historyLimit must be between 1 and 1000.');
  }
  let current = documentSnapshot(document);
  let undoStack = [];
  let redoStack = [];
  const listeners = new Set();

  const state = () => freeze({
    schemaVersion: MAKER_V8_WORKSPACE_SCHEMA,
    document: current,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    issues: collectMakerV8DocumentIssues(current, { mode: 'draft' }),
    compileIssues: collectMakerV8DocumentIssues(current, { mode: 'compile' }),
  });
  const publish = () => {
    const value = state();
    listeners.forEach((listener) => listener(value));
    return value;
  };

  return freeze({
    getState: state,
    subscribe(listener) {
      if (typeof listener !== 'function') fail('MAKER_V8_WORKSPACE_LISTENER_INVALID', 'Listener must be a function.');
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    dispatch(command) {
      const next = applyMakerV8WorkspaceCommand(current, command);
      undoStack = [...undoStack, current].slice(-historyLimit);
      redoStack = [];
      current = next;
      return publish();
    },
    undo() {
      if (!undoStack.length) return state();
      redoStack = [current, ...redoStack].slice(0, historyLimit);
      current = undoStack.at(-1);
      undoStack = undoStack.slice(0, -1);
      return publish();
    },
    redo() {
      if (!redoStack.length) return state();
      undoStack = [...undoStack, current].slice(-historyLimit);
      current = redoStack[0];
      redoStack = redoStack.slice(1);
      return publish();
    },
    preview() {
      return projectPublicMakerV8Document(current);
    },
    exportProject() {
      return exportMakerV8Project(current);
    },
  });
}
