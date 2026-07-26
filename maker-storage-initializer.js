/**
 * Non-destructive legacy Maker storage inspection.
 *
 * The epoch is retained for compatibility with deployments that already wrote
 * it. It is an inspection marker only: changing or removing it must never be
 * interpreted as permission to delete a database, clear an object store, or
 * remove a localStorage draft key.
 */
export const MAKER_DRAFT_SCHEMA_EPOCH = 'maker-v5-stable-storage-1';
export const MAKER_DRAFT_SCHEMA_EPOCH_KEY = 'animacraft-maker-draft-schema-epoch';

export const LEGACY_MAKER_DATABASES = Object.freeze([
  'animacraft-creator-drafts',
]);

export const LEGACY_WORKSPACE_DATABASE = 'animacraft-maker-workspace-v4';
export const LEGACY_WORKSPACE_MAKER_STORES = Object.freeze([
  'maker-documents',
  'maker-assets',
]);

export const LEGACY_MAKER_LOCAL_STORAGE_KEYS = Object.freeze([
  'animacraft-maker-draft-v1',
]);

export const LEGACY_MAKER_LOCAL_STORAGE_PREFIXES = Object.freeze([
  'animacraft-maker-draft-v2:',
  'animacraft-local-makers-v1:',
]);

const activeInitializations = new WeakMap();

function requireStorage(storage) {
  if (
    !storage
    || typeof storage.getItem !== 'function'
    || typeof storage.setItem !== 'function'
    || typeof storage.key !== 'function'
    || typeof storage.length !== 'number'
  ) {
    throw new Error('Persistent localStorage is required to initialize Maker draft storage.');
  }
  return storage;
}

function requireIndexedDb(factory) {
  if (!factory || (typeof factory !== 'object' && typeof factory !== 'function')) {
    throw new Error('IndexedDB is required to initialize Maker draft storage.');
  }
  return factory;
}

function matchingLegacyLocalStorageKeys(storage) {
  const matches = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key === MAKER_DRAFT_SCHEMA_EPOCH_KEY) continue;
    if (
      LEGACY_MAKER_LOCAL_STORAGE_KEYS.includes(key)
      || LEGACY_MAKER_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      matches.push(key);
    }
  }
  return matches.sort();
}

async function inspectLegacyDatabases(factory) {
  if (typeof factory.databases !== 'function') {
    return {
      databaseListing: 'unsupported',
      preservedDatabaseNames: [],
      legacyWorkspacePresent: null,
    };
  }

  try {
    const entries = await factory.databases();
    const databaseNames = new Set(
      (Array.isArray(entries) ? entries : [])
        .map((entry) => String(entry?.name || '').trim())
        .filter(Boolean),
    );
    const legacyWorkspacePresent = databaseNames.has(LEGACY_WORKSPACE_DATABASE);
    return {
      databaseListing: 'complete',
      preservedDatabaseNames: [
        ...LEGACY_MAKER_DATABASES.filter((name) => databaseNames.has(name)),
        ...(legacyWorkspacePresent ? [LEGACY_WORKSPACE_DATABASE] : []),
      ],
      legacyWorkspacePresent,
    };
  } catch (error) {
    // Database listing is optional browser metadata. An unavailable inspection
    // must not tempt callers to open/create, clear, or delete a legacy database.
    return {
      databaseListing: 'failed',
      preservedDatabaseNames: [],
      legacyWorkspacePresent: null,
      inspectionError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectPreservedLegacyStorage(indexedDb, storage) {
  const databaseInspection = await inspectLegacyDatabases(indexedDb);
  return {
    ...databaseInspection,
    preservedLocalStorageKeys: matchingLegacyLocalStorageKeys(storage),
  };
}

function resultFor({
  performed,
  epoch,
  inspection,
}) {
  return {
    performed,
    epoch,
    inspection,

    // Kept as explicit, backwards-compatible proof that initialization did not
    // mutate any legacy storage.
    clearedDatabases: [],
    clearedWorkspaceStores: [],
    removedLocalStorageKeys: [],
  };
}

async function runInitialization({
  indexedDb,
  storage,
  epoch,
}) {
  const inspection = await inspectPreservedLegacyStorage(indexedDb, storage);

  // This marker records that the non-destructive inspection ran. It grants no
  // cleanup authority and is the only persistent write made by this module.
  storage.setItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY, epoch);

  return resultFor({
    performed: true,
    epoch,
    inspection,
  });
}

/**
 * Inspects known legacy Maker storage without modifying it.
 *
 * This function never opens, deletes, or clears an IndexedDB database/store and
 * never removes a localStorage key. The v6 workspace is neither opened nor
 * otherwise touched.
 */
export async function initializeMakerDraftStorage(options = {}) {
  const storage = requireStorage(options.localStorage ?? globalThis.localStorage);
  const indexedDb = requireIndexedDb(options.indexedDB ?? globalThis.indexedDB);
  const epoch = String(options.epoch || MAKER_DRAFT_SCHEMA_EPOCH).trim();
  if (!epoch) throw new Error('A Maker draft schema epoch is required.');

  if (storage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY) === epoch) {
    const inspection = await inspectPreservedLegacyStorage(indexedDb, storage);
    return resultFor({
      performed: false,
      epoch,
      inspection,
    });
  }

  let storageInitializations = activeInitializations.get(storage);
  if (!storageInitializations) {
    storageInitializations = new Map();
    activeInitializations.set(storage, storageInitializations);
  }

  const existing = storageInitializations.get(epoch);
  if (existing) return existing;

  const initialization = runInitialization({ indexedDb, storage, epoch });
  storageInitializations.set(epoch, initialization);
  try {
    return await initialization;
  } finally {
    storageInitializations.delete(epoch);
  }
}
