import { assertMakerV8Document, compareMakerV8ProtocolText } from './maker-v8-document.js';
import { makerV8LocalRecipeTransitionIssue } from './maker-v8-recipe-constraints.js';
import { sha256 } from '@noble/hashes/sha2.js';

const HISTORY_LIMIT = 100;
const PROFILE_LIMITS = Object.freeze({ name: 128, world: 128, description: 2000, tags: 1000 });
const SOUL_KEYS = ['soulMd', 'memoryMd', 'skillMd'];
const CHECKPOINT_SCHEMA = 'animacraft.maker-v8-local-player-checkpoint.v1';
const CHECKPOINT_MAX_BYTES = 16 * 1024 * 1024;
const canonical = (value) => JSON.stringify((function ordered(item) {
  if (Array.isArray(item)) return item.map(ordered);
  if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])]));
  return item;
})(value));
const snapshots = new WeakMap();
export function assertMakerV8LocalPlayerSnapshot(value) {
  const validate = value && typeof value === 'object' ? snapshots.get(value) : null;
  if (!validate) fail('MAKER_V8_LOCAL_PLAYER_SNAPSHOT_INVALID', 'Expected an actual local Player session snapshot.');
  validate();
  return value;
}
const DRAFT_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function fail(code, message) {
  throw Object.assign(new Error(message), { name: 'MakerV8LocalPlayerError', code });
}
function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== fields.length
    || fields.some((key) => !Object.hasOwn(value, key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    fail('MAKER_V8_LOCAL_PLAYER_INPUT_INVALID', `${label} must contain exactly its local data fields.`);
  }
}

/** Independent, in-memory Player Test. No Root, wallet, persistence or chain API. */
export function createMakerV8LocalPlayer(input = {}) {
  exactFields(input, ['draftId', 'draftRevision', 'document'], 'Local draft');
  const { draftId, draftRevision, document } = input;
  if (typeof draftId !== 'string' || !DRAFT_ID.test(draftId)
    || !Number.isSafeInteger(draftRevision) || draftRevision < 1) {
    fail('MAKER_V8_LOCAL_PLAYER_DRAFT_INVALID', 'Local Player requires an exact durable draft ID/revision.');
  }
  assertMakerV8Document(document, { mode: 'draft' });
  const source = freeze(structuredClone(document));
  const documentHash = [...sha256(new TextEncoder().encode(canonical(source)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  let disposed = false;
  let revision = 0;
  let undo = [];
  let redo = [];
  const normalize = (input, previousSelections) => {
    exactFields(input, ['selections', 'colors', 'outputKey'], 'Local Recipe');
    if (!Array.isArray(input.selections) || !Array.isArray(input.colors)
      || !source.outputs.some((output) => output.key === input.outputKey)) {
      fail('MAKER_V8_LOCAL_PLAYER_RECIPE_INVALID', 'Local Recipe requires selections, Colors and an existing Output.');
    }
    for (const [rows, limit] of [
      [input.selections, source.parts.reduce((sum, part) => sum + part.capacity, 0)],
      [input.colors, source.colors.length],
    ]) {
      if (rows.length > limit || Reflect.ownKeys(rows).length !== rows.length + 1
        || Array.from({ length: rows.length }, (_, index) => index).some((index) => (
          !Object.hasOwn(rows, index)
          || !Object.hasOwn(Object.getOwnPropertyDescriptor(rows, index), 'value')
        ))) {
        fail('MAKER_V8_LOCAL_PLAYER_RECIPE_INVALID', 'Local Recipe arrays must be dense bounded data.');
      }
    }
    input.selections.forEach((row) => exactFields(row, ['partKey', 'itemKey', 'styleKey'], 'Local selection'));
    input.colors.forEach((row) => exactFields(row, ['channelKey', 'swatchKey'], 'Local Color'));
    const candidate = structuredClone(source);
    candidate.defaultRecipe = {
      selections: input.selections.map(({ partKey, itemKey, styleKey }) => ({ partKey, itemKey, styleKey })),
      colors: input.colors.map(({ channelKey, swatchKey }) => ({ channelKey, swatchKey })),
    };
    // Reuse the exact document authority for public references, capacity,
    // item-assetization duplication and Color membership. Never coerce inputs.
    assertMakerV8Document(candidate, { mode: 'draft' });
    const issue = makerV8LocalRecipeTransitionIssue(source, candidate.defaultRecipe.selections, previousSelections);
    if (issue) fail(issue.code, issue.message);
    const parts = [...source.parts].sort((a, b) => a.menuOrder - b.menuOrder
      || compareMakerV8ProtocolText(a.key, b.key));
    const order = new Map(parts.map((part, index) => [part.key, index]));
    candidate.defaultRecipe.selections.sort((a, b) => order.get(a.partKey) - order.get(b.partKey));
    candidate.defaultRecipe.colors.sort((a, b) => compareMakerV8ProtocolText(a.channelKey, b.channelKey));
    return freeze({ ...candidate.defaultRecipe, outputKey: input.outputKey });
  };
  const normalizePersonalization = (input) => {
    exactFields(input, ['profile', 'soulDocuments'], 'Local personalization');
    exactFields(input.profile, Object.keys(PROFILE_LIMITS), 'Local profile');
    exactFields(input.soulDocuments, SOUL_KEYS, 'Local Soul documents');
    const profile = {};
    const soulDocuments = {};
    for (const [key, limit] of Object.entries(PROFILE_LIMITS)) {
      const value = input.profile[key];
      if (typeof value !== 'string' || value.length > limit) {
        fail('MAKER_V8_LOCAL_PLAYER_PROFILE_INVALID', `Local profile ${key} exceeds its text limit.`);
      }
      profile[key] = value;
    }
    for (const key of SOUL_KEYS) {
      const value = input.soulDocuments[key];
      if (typeof value !== 'string' || new TextEncoder().encode(value).length > 65_536) {
        fail('MAKER_V8_LOCAL_PLAYER_SOUL_INVALID', `Local Soul document ${key} exceeds its UTF-8 limit.`);
      }
      soulDocuments[key] = value;
    }
    return { profile, soulDocuments };
  };
  const initial = freeze({
    recipe: normalize({ ...source.defaultRecipe, outputKey: source.outputs[0]?.key }, source.defaultRecipe.selections),
    profile: { name: '', world: '', description: '', tags: '' },
    soulDocuments: Object.fromEntries(SOUL_KEYS.map(key => [key, source.livingContent[key]])),
  });
  let content = initial;
  const check = () => {
    if (disposed) fail('MAKER_V8_LOCAL_PLAYER_DISPOSED', 'Local Player session is closed.');
  };
  const checkRevision = (expectedRevision) => {
    check();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== revision) {
      fail('MAKER_V8_LOCAL_PLAYER_CAS_MISMATCH', 'Local Player changed before this edit.');
    }
  };
  const snapshot = () => {
    check();
    const value = freeze({
      mode: 'LOCAL_DRAFT', draftId, draftRevision, revision,
      document: source, ...content, undoDepth: undo.length, redoDepth: redo.length,
    });
    snapshots.set(value, () => checkRevision(value.revision));
    return value;
  };
  const change = (next, expectedRevision) => {
    checkRevision(expectedRevision);
    if (JSON.stringify(next) === JSON.stringify(content)) return snapshot();
    if (revision === Number.MAX_SAFE_INTEGER) fail('MAKER_V8_LOCAL_PLAYER_REVISION_OVERFLOW', 'Local revision exhausted.');
    undo = [...undo, content].slice(-HISTORY_LIMIT);
    redo = [];
    content = freeze(next);
    revision += 1;
    return snapshot();
  };
  const moveHistory = (direction, expectedRevision) => {
    checkRevision(expectedRevision);
    const from = direction === 'undo' ? undo : redo;
    if (!from.length) return snapshot();
    if (revision === Number.MAX_SAFE_INTEGER) fail('MAKER_V8_LOCAL_PLAYER_REVISION_OVERFLOW', 'Local revision exhausted.');
    const next = from.at(-1);
    if (direction === 'undo') { undo = undo.slice(0, -1); redo = [...redo, content].slice(-HISTORY_LIMIT); }
    else { redo = redo.slice(0, -1); undo = [...undo, content].slice(-HISTORY_LIMIT); }
    content = next;
    revision += 1;
    return snapshot();
  };
  return Object.freeze({
    getSnapshot: snapshot,
    setRecipe(input, expectedRevision) {
      checkRevision(expectedRevision);
      return change({ ...content, recipe: normalize(input, content.recipe.selections) }, expectedRevision);
    },
    setPersonalization(input, expectedRevision) {
      checkRevision(expectedRevision);
      return change({ recipe: content.recipe, ...normalizePersonalization(input) }, expectedRevision);
    },
    exportCheckpoint() {
      check();
      const serialized = canonical({ schemaVersion: CHECKPOINT_SCHEMA, draftId, draftRevision, documentHash, ...content });
      if (new TextEncoder().encode(serialized).length > CHECKPOINT_MAX_BYTES) fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local checkpoint exceeds its byte limit.');
      return serialized;
    },
    restoreCheckpoint(serialized, expectedRevision) {
      checkRevision(expectedRevision);
      if (typeof serialized !== 'string' || serialized.length > CHECKPOINT_MAX_BYTES
        || new TextEncoder().encode(serialized).length > CHECKPOINT_MAX_BYTES) {
        fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local checkpoint must be bounded canonical JSON.');
      }
      let value;
      try { value = JSON.parse(serialized); } catch { fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local checkpoint JSON is invalid.'); }
      exactFields(value, ['schemaVersion', 'draftId', 'draftRevision', 'documentHash', 'recipe', 'profile', 'soulDocuments'], 'Local checkpoint');
      if (value.schemaVersion !== CHECKPOINT_SCHEMA || value.draftId !== draftId
        || value.draftRevision !== draftRevision || value.documentHash !== documentHash
        || canonical(value) !== serialized) {
        fail('MAKER_V8_LOCAL_PLAYER_CHECKPOINT_INVALID', 'Local checkpoint does not match this exact draft.');
      }
      // Normalize every field before the single mutation/history commit.
      // A restored local checkpoint may retain only the draft's initial visibility
      // failures, just as Reset/Undo can. It never gains publication authority.
      const recipe = normalize(value.recipe, initial.recipe.selections);
      const personalization = normalizePersonalization({ profile: value.profile, soulDocuments: value.soulDocuments });
      return change({ recipe, ...personalization }, expectedRevision);
    },
    reset: (expectedRevision) => change(initial, expectedRevision),
    undo: (expectedRevision) => moveHistory('undo', expectedRevision),
    redo: (expectedRevision) => moveHistory('redo', expectedRevision),
    dispose() { disposed = true; undo = []; redo = []; },
  });
}
