const DATABASE_NAME = 'animacraft-maker-workspace-v4';
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = 'maker-documents';
const ASSET_STORE = 'maker-assets';
const PLAYER_SESSION_STORE = 'player-sessions';

function requireKey(value, label) {
  const key = String(value || '').trim();
  if (!key) throw new Error(`${label} is required.`);
  return key;
}

export function workspaceAssetRecordId(makerKey, assetId) {
  return `${requireKey(makerKey, 'Maker key')}::${requireKey(assetId, 'Asset id')}`;
}

function openWorkspaceDatabase() {
  if (!globalThis.indexedDB) throw new Error('This browser does not support local Maker workspace storage.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: 'makerKey' });
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        const store = database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
        store.createIndex('makerKey', 'makerKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(PLAYER_SESSION_STORE)) {
        database.createObjectStore(PLAYER_SESSION_STORE, { keyPath: 'sessionKey' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error('Close other Animacraft tabs once so the Maker workspace can be upgraded.'));
    request.onerror = () => reject(request.error || new Error('Could not open the Maker workspace store.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('The Maker workspace operation failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('The Maker workspace transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('The Maker workspace transaction failed.'));
  });
}

export async function saveMakerWorkspaceDocument(makerKey, document, metadata = {}) {
  const key = requireKey(makerKey, 'Maker key');
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(DOCUMENT_STORE, 'readwrite');
    transaction.objectStore(DOCUMENT_STORE).put({
      makerKey: key,
      document,
      metadata,
      savedAt: Date.now(),
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadMakerWorkspaceDocument(makerKey) {
  const key = String(makerKey || '').trim();
  if (!key) return null;
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(DOCUMENT_STORE, 'readonly');
    const record = await requestResult(transaction.objectStore(DOCUMENT_STORE).get(key));
    await transactionComplete(transaction);
    return record || null;
  } finally {
    database.close();
  }
}

export async function deleteMakerWorkspaceDocument(makerKey) {
  const key = String(makerKey || '').trim();
  if (!key) return;
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(DOCUMENT_STORE, 'readwrite');
    transaction.objectStore(DOCUMENT_STORE).delete(key);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function upsertMakerWorkspaceAssets(makerKey, records) {
  const key = requireKey(makerKey, 'Maker key');
  if (!Array.isArray(records) || !records.length) return;
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    const store = transaction.objectStore(ASSET_STORE);
    records.forEach((record) => {
      const assetId = requireKey(record?.assetId, 'Asset id');
      store.put({
        ...record,
        id: workspaceAssetRecordId(key, assetId),
        makerKey: key,
        assetId,
        savedAt: Date.now(),
      });
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function deleteMakerWorkspaceAssets(makerKey, assetIds = null) {
  const key = String(makerKey || '').trim();
  if (!key) return;
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    const store = transaction.objectStore(ASSET_STORE);
    if (Array.isArray(assetIds)) {
      assetIds.forEach((assetId) => store.delete(workspaceAssetRecordId(key, assetId)));
    } else {
      const keys = await requestResult(store.index('makerKey').getAllKeys(key));
      keys.forEach((recordKey) => store.delete(recordKey));
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadMakerWorkspaceAssets(makerKey) {
  const key = String(makerKey || '').trim();
  if (!key) return [];
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const records = await requestResult(transaction.objectStore(ASSET_STORE).index('makerKey').getAll(key));
    await transactionComplete(transaction);
    return records || [];
  } finally {
    database.close();
  }
}

export async function savePlayerWorkspaceSession(sessionKey, session) {
  const key = requireKey(sessionKey, 'Player session key');
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(PLAYER_SESSION_STORE, 'readwrite');
    transaction.objectStore(PLAYER_SESSION_STORE).put({
      sessionKey: key,
      session,
      savedAt: Date.now(),
    });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadPlayerWorkspaceSession(sessionKey) {
  const key = String(sessionKey || '').trim();
  if (!key) return null;
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(PLAYER_SESSION_STORE, 'readonly');
    const record = await requestResult(transaction.objectStore(PLAYER_SESSION_STORE).get(key));
    await transactionComplete(transaction);
    return record || null;
  } finally {
    database.close();
  }
}

export async function deletePlayerWorkspaceSession(sessionKey) {
  const key = String(sessionKey || '').trim();
  if (!key) return;
  const database = await openWorkspaceDatabase();
  try {
    const transaction = database.transaction(PLAYER_SESSION_STORE, 'readwrite');
    transaction.objectStore(PLAYER_SESSION_STORE).delete(key);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}
