const DATABASE_NAME = 'animacraft-creator-drafts';
const DATABASE_VERSION = 3;
const ASSET_STORE = 'maker-assets';
const UPLOAD_STORE = 'maker-uploads';
const DRAFT_STORE = 'maker-drafts';

function openDraftDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        const store = database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
        store.createIndex('makerKey', 'makerKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(UPLOAD_STORE)) {
        database.createObjectStore(UPLOAD_STORE, { keyPath: 'makerKey' });
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: 'makerKey' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error('Close other Animacraft tabs once so the local draft store can be upgraded.'));
    request.onerror = () => reject(request.error || new Error('Could not open the local creator asset store.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('The local creator asset operation failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('The local creator asset transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('The local creator asset transaction failed.'));
  });
}

function uploadRecoveryRevision(recovery) {
  const revision = Number(recovery?.recoveryRevision ?? 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function uploadRecoverySessionId(recovery) {
  const explicit = String(recovery?.uploadSessionId || '').trim();
  if (explicit) return explicit;
  const owner = String(recovery?.owner || 'unknown-owner').trim().toLowerCase();
  const blobId = String(
    recovery?.quiltBlobId
      || recovery?.checkpoint?.blobId
      || recovery?.checkpoint?.blobObjectId
      || 'unknown-quilt',
  ).trim();
  return `legacy:${owner}:${blobId}`;
}

function expectedUploadRecoveryRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('The expected upload recovery revision must be a non-negative safe integer.');
  }
  return revision;
}

function uploadRecoveryConflict(makerKey, expectedRevision, actualRevision, uploadSessionId, actualSessionId) {
  const error = new Error(
    `The Walrus upload recovery for ${makerKey} changed in another operation. Reload its latest checkpoint before saving again.`,
  );
  error.code = 'UPLOAD_RECOVERY_CONFLICT';
  error.expectedRevision = expectedRevision;
  error.actualRevision = actualRevision;
  error.uploadSessionId = uploadSessionId;
  error.actualSessionId = actualSessionId;
  return error;
}

export async function replaceMakerAssets(makerKey, records) {
  if (!makerKey) throw new Error('A Maker key is required to save local assets.');
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    const store = transaction.objectStore(ASSET_STORE);
    const existingKeys = await requestResult(store.index('makerKey').getAllKeys(makerKey));
    existingKeys.forEach((key) => store.delete(key));
    records.forEach((record) => store.put({
      ...record,
      id: `${makerKey}:${record.assetKey}`,
      makerKey,
      savedAt: Date.now(),
    }));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadMakerAssets(makerKey) {
  if (!makerKey) return [];
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const records = await requestResult(transaction.objectStore(ASSET_STORE).index('makerKey').getAll(makerKey));
    await transactionComplete(transaction);
    return records;
  } finally {
    database.close();
  }
}

export async function deleteMakerAssets(makerKey) {
  if (!makerKey) return;
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    const store = transaction.objectStore(ASSET_STORE);
    const keys = await requestResult(store.index('makerKey').getAllKeys(makerKey));
    keys.forEach((key) => store.delete(key));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function saveMakerDraftRecord(makerKey, draft) {
  if (!makerKey) throw new Error('A Maker key is required to save draft metadata.');
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, 'readwrite');
    transaction.objectStore(DRAFT_STORE).put({ makerKey, draft, savedAt: Date.now() });
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadMakerDraftRecord(makerKey) {
  if (!makerKey) return null;
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, 'readonly');
    const record = await requestResult(transaction.objectStore(DRAFT_STORE).get(makerKey));
    await transactionComplete(transaction);
    return record?.draft || null;
  } finally {
    database.close();
  }
}

export async function deleteMakerDraftRecord(makerKey) {
  if (!makerKey) return;
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, 'readwrite');
    transaction.objectStore(DRAFT_STORE).delete(makerKey);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function saveMakerUploadRecovery(makerKey, recovery, { expectedRevision } = {}) {
  if (!makerKey) throw new Error('A Maker key is required to save upload recovery.');
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(UPLOAD_STORE, 'readwrite');
    const store = transaction.objectStore(UPLOAD_STORE);
    const current = await requestResult(store.get(makerKey));
    const currentRevision = uploadRecoveryRevision(current);
    const incomingSessionId = uploadRecoverySessionId(recovery);
    const currentSessionId = current ? uploadRecoverySessionId(current) : '';
    const hasExpectedRevision = expectedRevision !== undefined;
    const requestedRevision = hasExpectedRevision
      ? expectedUploadRecoveryRevision(expectedRevision)
      : currentRevision;

    if (
      hasExpectedRevision
      && (
        requestedRevision !== currentRevision
        || (current && incomingSessionId !== currentSessionId)
      )
    ) {
      await transactionComplete(transaction);
      throw uploadRecoveryConflict(
        makerKey,
        requestedRevision,
        currentRevision,
        incomingSessionId,
        currentSessionId,
      );
    }

    const stored = {
      ...recovery,
      makerKey,
      uploadSessionId: incomingSessionId,
      recoveryRevision: requestedRevision + 1,
      savedAt: Date.now(),
    };
    store.put(stored);
    await transactionComplete(transaction);
    return stored;
  } finally {
    database.close();
  }
}

export async function loadMakerUploadRecovery(makerKey) {
  if (!makerKey) return null;
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(UPLOAD_STORE, 'readonly');
    const recovery = await requestResult(transaction.objectStore(UPLOAD_STORE).get(makerKey));
    await transactionComplete(transaction);
    return recovery || null;
  } finally {
    database.close();
  }
}

export async function deleteMakerUploadRecovery(
  makerKey,
  { expectedRevision, uploadSessionId } = {},
) {
  if (!makerKey) return false;
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(UPLOAD_STORE, 'readwrite');
    const store = transaction.objectStore(UPLOAD_STORE);
    const current = await requestResult(store.get(makerKey));
    if (!current) {
      await transactionComplete(transaction);
      return false;
    }

    const revisionMatches = expectedRevision === undefined
      || expectedUploadRecoveryRevision(expectedRevision) === uploadRecoveryRevision(current);
    const sessionMatches = uploadSessionId === undefined
      || String(uploadSessionId) === uploadRecoverySessionId(current);
    if (!revisionMatches || !sessionMatches) {
      await transactionComplete(transaction);
      return false;
    }

    store.delete(makerKey);
    await transactionComplete(transaction);
    return true;
  } finally {
    database.close();
  }
}
