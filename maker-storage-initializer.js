/**
 * One-time cleanup for the first deployment of the stable Maker workspace.
 *
 * Do not bump this epoch for ordinary application deployments. A new value is
 * an explicit instruction to clear the listed legacy Maker draft data again.
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
    || typeof storage.removeItem !== 'function'
  ) {
    throw new Error('Persistent localStorage is required to initialize Maker draft storage.');
  }
  return storage;
}

function requireIndexedDb(factory) {
  if (!factory || typeof factory.open !== 'function' || typeof factory.deleteDatabase !== 'function') {
    throw new Error('IndexedDB is required to initialize Maker draft storage.');
  }
  return factory;
}

function requestError(request, fallback) {
  return request?.error instanceof Error ? request.error : new Error(fallback);
}

function deleteDatabase(factory, databaseName) {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(requestError(request, `Could not delete legacy Maker database "${databaseName}".`));
    request.onblocked = () => reject(new Error(
      `Could not initialize Maker storage because "${databaseName}" is open in another Animacraft tab.`,
    ));
  });
}

function openDatabase(factory, databaseName) {
  return new Promise((resolve, reject) => {
    let created = false;
    const request = factory.open(databaseName);
    request.onupgradeneeded = (event) => {
      created = Number(event?.oldVersion || 0) === 0;
    };
    request.onsuccess = () => resolve({ database: request.result, created });
    request.onerror = () => reject(requestError(request, `Could not open legacy Maker database "${databaseName}".`));
    request.onblocked = () => reject(new Error(
      `Could not initialize Maker storage because "${databaseName}" is blocked by another Animacraft tab.`,
    ));
  });
}

function transactionComplete(transaction, databaseName) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error || new Error(`Clearing legacy Maker data in "${databaseName}" was aborted.`),
    );
    transaction.onerror = () => reject(
      transaction.error || new Error(`Clearing legacy Maker data in "${databaseName}" failed.`),
    );
  });
}

async function clearDatabaseStores(factory, databaseName, requestedStoreNames) {
  const { database, created } = await openDatabase(factory, databaseName);
  if (created) {
    database.close();
    await deleteDatabase(factory, databaseName);
    return [];
  }

  const storeNames = requestedStoreNames.filter((name) => database.objectStoreNames.contains(name));
  if (!storeNames.length) {
    database.close();
    return [];
  }

  try {
    const transaction = database.transaction(storeNames, 'readwrite');
    storeNames.forEach((name) => transaction.objectStore(name).clear());
    await transactionComplete(transaction, databaseName);
    return storeNames;
  } finally {
    database.close();
  }
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
  return matches;
}

async function runInitialization({
  indexedDb,
  storage,
  epoch,
}) {
  const clearedDatabases = [];
  for (const databaseName of LEGACY_MAKER_DATABASES) {
    await deleteDatabase(indexedDb, databaseName);
    clearedDatabases.push(databaseName);
  }

  const clearedWorkspaceStores = await clearDatabaseStores(
    indexedDb,
    LEGACY_WORKSPACE_DATABASE,
    LEGACY_WORKSPACE_MAKER_STORES,
  );

  const removedLocalStorageKeys = matchingLegacyLocalStorageKeys(storage);
  removedLocalStorageKeys.forEach((key) => storage.removeItem(key));

  // This is deliberately the final write. A partial/failed cleanup must retry
  // on the next startup instead of being mistaken for a completed migration.
  storage.setItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY, epoch);

  return {
    performed: true,
    epoch,
    clearedDatabases,
    clearedWorkspaceStores,
    removedLocalStorageKeys,
  };
}

/**
 * Clears only the explicitly listed legacy Maker draft data once per schema
 * epoch. Callers must await this before loading or writing any Maker workspace.
 */
export async function initializeMakerDraftStorage(options = {}) {
  const storage = requireStorage(options.localStorage ?? globalThis.localStorage);
  const indexedDb = requireIndexedDb(options.indexedDB ?? globalThis.indexedDB);
  const epoch = String(options.epoch || MAKER_DRAFT_SCHEMA_EPOCH).trim();
  if (!epoch) throw new Error('A Maker draft schema epoch is required.');

  if (storage.getItem(MAKER_DRAFT_SCHEMA_EPOCH_KEY) === epoch) {
    return {
      performed: false,
      epoch,
      clearedDatabases: [],
      clearedWorkspaceStores: [],
      removedLocalStorageKeys: [],
    };
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
