export const MAKER_DRAFT_DATABASE_NAME = 'animacraft-maker-workspace-v6';
export const MAKER_DRAFT_DATABASE_VERSION = 2;
export const MAKER_DRAFT_PROJECT_STORE = 'maker-projects';
export const MAKER_DRAFT_ASSET_STORE = 'maker-assets';
export const MAKER_DRAFT_CHECKPOINT_STORE = 'maker-checkpoints';
export const MAKER_DRAFT_CHECKPOINT_LIMIT = 20;
export const MAKER_DRAFT_REVISION_FIELD = 'draftRevision';
export const MAKER_DRAFT_BASE_REVISION_FIELD = 'draftBaseRevision';
export const MAKER_DRAFT_DELETED_FIELD = 'draftDeleted';

function requireKey(value, label) {
  const key = String(value || '').trim();
  if (!key) throw new Error(`${label} is required.`);
  return key;
}

export function makerDraftAssetRecordId(makerKey, assetId) {
  return `${requireKey(makerKey, 'Maker key')}::${requireKey(assetId, 'Asset id')}`;
}

export function makerDraftCheckpointRecordId(makerKey, revision) {
  const normalizedRevision = Number(revision);
  if (!Number.isSafeInteger(normalizedRevision) || normalizedRevision < 0) {
    throw new Error('Checkpoint revision must be a non-negative safe integer.');
  }
  return `${requireKey(makerKey, 'Maker key')}::${normalizedRevision}`;
}

function openDatabase() {
  if (!globalThis.indexedDB) throw new Error('This browser does not support persistent Maker draft storage.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MAKER_DRAFT_DATABASE_NAME, MAKER_DRAFT_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MAKER_DRAFT_PROJECT_STORE)) {
        database.createObjectStore(MAKER_DRAFT_PROJECT_STORE, { keyPath: 'makerKey' });
      }
      if (!database.objectStoreNames.contains(MAKER_DRAFT_ASSET_STORE)) {
        const store = database.createObjectStore(MAKER_DRAFT_ASSET_STORE, { keyPath: 'id' });
        store.createIndex('makerKey', 'makerKey', { unique: false });
      }
      if (!database.objectStoreNames.contains(MAKER_DRAFT_CHECKPOINT_STORE)) {
        const store = database.createObjectStore(MAKER_DRAFT_CHECKPOINT_STORE, { keyPath: 'id' });
        store.createIndex('makerKey', 'makerKey', { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error(
      'Close other Animacraft tabs once so persistent Maker draft storage can be upgraded.',
    ));
    request.onerror = () => reject(request.error || new Error('Could not open persistent Maker draft storage.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('The Maker draft storage request failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('The Maker draft transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('The Maker draft transaction failed.'));
  });
}

function projectRecord(makerKey, document, metadata) {
  const savedAt = Number.isFinite(metadata?.draftCommittedAt)
    ? metadata.draftCommittedAt
    : Date.now();
  return {
    makerKey,
    document,
    metadata,
    savedAt,
  };
}

function projectRevision(record) {
  const revision = record?.metadata?.[MAKER_DRAFT_REVISION_FIELD];
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function requestedBaseRevision(metadata) {
  const revision = metadata?.[MAKER_DRAFT_BASE_REVISION_FIELD];
  if (revision === null) return null;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('A Maker draft base revision must be null or a non-negative safe integer.');
  }
  return revision;
}

function expectedBaseRevision(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('An expected Maker draft revision must be null or a non-negative safe integer.');
  }
  return value;
}

function checkpointRecord(record) {
  const revision = projectRevision(record);
  if (revision === null) throw new Error('A checkpoint requires a persisted Maker draft revision.');
  const metadata = structuredClone(record.metadata || {});
  return {
    id: makerDraftCheckpointRecordId(record.makerKey, revision),
    makerKey: record.makerKey,
    revision,
    document: structuredClone(record.document),
    recipe: metadata.recipe === undefined ? undefined : structuredClone(metadata.recipe),
    metadata,
    savedAt: record.savedAt,
  };
}

function pruneCheckpoints(store, makerKey, transaction, onError) {
  const request = store.index('makerKey').getAll(makerKey);
  request.onsuccess = () => {
    try {
      const records = request.result || [];
      records
        .sort((left, right) => (
          Number(right.revision || 0) - Number(left.revision || 0)
          || Number(right.savedAt || 0) - Number(left.savedAt || 0)
        ))
        .slice(MAKER_DRAFT_CHECKPOINT_LIMIT)
        .forEach((record) => store.delete(record.id));
    } catch (error) {
      onError(error);
      transaction.abort();
    }
  };
  request.onerror = () => {
    onError(request.error || new Error('Maker draft checkpoints could not be pruned.'));
  };
}

function putAssets(store, makerKey, records, savedAt) {
  records.forEach((record) => {
    const assetId = requireKey(record?.assetId, 'Asset id');
    store.put({
      ...record,
      id: makerDraftAssetRecordId(makerKey, assetId),
      makerKey,
      assetId,
      savedAt,
    });
  });
}

export async function saveMakerDraftDocument(makerKeyValue, document, metadata = {}) {
  return commitMakerDraftSnapshot(makerKeyValue, document, metadata);
}

export async function loadMakerDraftDocument(makerKeyValue) {
  const makerKey = String(makerKeyValue || '').trim();
  if (!makerKey) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MAKER_DRAFT_PROJECT_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const record = await requestResult(transaction.objectStore(MAKER_DRAFT_PROJECT_STORE).get(makerKey));
    await completion;
    return record || null;
  } finally {
    database.close();
  }
}

export async function listMakerDraftProjects({ walletAddress = '' } = {}) {
  const requestedWallet = String(walletAddress || '').trim();
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MAKER_DRAFT_PROJECT_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const records = await requestResult(transaction.objectStore(MAKER_DRAFT_PROJECT_STORE).getAll());
    await completion;
    return (records || [])
      .filter((record) => record?.metadata?.[MAKER_DRAFT_DELETED_FIELD] !== true)
      .filter((record) => (
        !requestedWallet
        || String(record?.metadata?.walletAddress || '').trim() === requestedWallet
      ))
      .sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0));
  } finally {
    database.close();
  }
}

export async function listMakerDraftCheckpoints(makerKeyValue) {
  const makerKey = String(makerKeyValue || '').trim();
  if (!makerKey) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MAKER_DRAFT_CHECKPOINT_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const records = await requestResult(
      transaction.objectStore(MAKER_DRAFT_CHECKPOINT_STORE).index('makerKey').getAll(makerKey),
    );
    await completion;
    return (records || []).sort((left, right) => (
      Number(right.revision || 0) - Number(left.revision || 0)
      || Number(right.savedAt || 0) - Number(left.savedAt || 0)
    ));
  } finally {
    database.close();
  }
}

export async function loadMakerDraftCheckpoint(makerKeyValue, revisionValue) {
  const makerKey = String(makerKeyValue || '').trim();
  if (!makerKey) return null;
  const id = makerDraftCheckpointRecordId(makerKey, revisionValue);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MAKER_DRAFT_CHECKPOINT_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const record = await requestResult(
      transaction.objectStore(MAKER_DRAFT_CHECKPOINT_STORE).get(id),
    );
    await completion;
    return record || null;
  } finally {
    database.close();
  }
}

export async function deleteMakerDraftProject(
  makerKeyValue,
  { expectedBaseRevision: expectedBaseRevisionValue } = {},
) {
  const makerKey = String(makerKeyValue || '').trim();
  if (!makerKey) return { deleted: false, persistedRevision: null, conflict: false };
  const expectedRevision = expectedBaseRevision(expectedBaseRevisionValue);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [
        MAKER_DRAFT_PROJECT_STORE,
        MAKER_DRAFT_ASSET_STORE,
        MAKER_DRAFT_CHECKPOINT_STORE,
      ],
      'readwrite',
    );
    const completion = transactionComplete(transaction);
    const projectStore = transaction.objectStore(MAKER_DRAFT_PROJECT_STORE);
    const assetStore = transaction.objectStore(MAKER_DRAFT_ASSET_STORE);
    let callbackError = null;
    const checkpointStore = transaction.objectStore(MAKER_DRAFT_CHECKPOINT_STORE);
    let outcome = null;
    const projectRequest = projectStore.get(makerKey);
    projectRequest.onsuccess = () => {
      try {
        const existing = projectRequest.result;
        const persistedRevision = projectRevision(existing);
        const baseMatches = expectedRevision === null
          ? !existing
          : Boolean(existing) && persistedRevision === expectedRevision;
        if (!baseMatches) {
          outcome = {
            deleted: false,
            persistedRevision,
            savedAt: existing?.savedAt ?? null,
            conflict: true,
          };
          return;
        }
        if ((persistedRevision ?? -1) >= Number.MAX_SAFE_INTEGER) {
          throw new Error('The Maker draft revision limit has been reached.');
        }
        const deletedRevision = (persistedRevision ?? -1) + 1;
        const savedAt = Date.now();
        projectStore.put({
          makerKey,
          document: null,
          metadata: {
            ...structuredClone(existing?.metadata || {}),
            [MAKER_DRAFT_REVISION_FIELD]: deletedRevision,
            [MAKER_DRAFT_BASE_REVISION_FIELD]: persistedRevision,
            [MAKER_DRAFT_DELETED_FIELD]: true,
            draftCommittedAt: savedAt,
          },
          savedAt,
        });

        const assetRequest = assetStore.index('makerKey').getAllKeys(makerKey);
        assetRequest.onsuccess = () => {
          (assetRequest.result || []).forEach((key) => assetStore.delete(key));
        };
        assetRequest.onerror = () => {
          callbackError = assetRequest.error
            || new Error('The Maker draft assets could not be enumerated for deletion.');
        };
        const checkpointRequest = checkpointStore.index('makerKey').getAllKeys(makerKey);
        checkpointRequest.onsuccess = () => {
          (checkpointRequest.result || []).forEach((key) => checkpointStore.delete(key));
        };
        checkpointRequest.onerror = () => {
          callbackError = checkpointRequest.error
            || new Error('The Maker draft checkpoints could not be enumerated for deletion.');
        };
        outcome = {
          deleted: true,
          persistedRevision: deletedRevision,
          savedAt,
          conflict: false,
        };
      } catch (error) {
        callbackError = error;
        transaction.abort();
      }
    };
    projectRequest.onerror = () => {
      callbackError = projectRequest.error
        || new Error('The current Maker draft revision could not be read for deletion.');
    };
    try {
      await completion;
    } catch (error) {
      throw callbackError || error;
    }
    if (!outcome) throw callbackError || new Error('The Maker draft deletion did not complete.');
    return outcome;
  } finally {
    database.close();
  }
}

export async function upsertMakerDraftAssets(makerKeyValue, records) {
  const makerKey = requireKey(makerKeyValue, 'Maker key');
  if (!Array.isArray(records) || !records.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MAKER_DRAFT_ASSET_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    putAssets(transaction.objectStore(MAKER_DRAFT_ASSET_STORE), makerKey, records, Date.now());
    await completion;
  } finally {
    database.close();
  }
}

export async function loadMakerDraftAssets(makerKeyValue) {
  const makerKey = String(makerKeyValue || '').trim();
  if (!makerKey) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MAKER_DRAFT_ASSET_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const records = await requestResult(
      transaction.objectStore(MAKER_DRAFT_ASSET_STORE).index('makerKey').getAll(makerKey),
    );
    await completion;
    return records || [];
  } finally {
    database.close();
  }
}

/**
 * Restores a historical checkpoint as a brand-new atomic revision.
 *
 * The read of the current revision and the write of the restored document
 * share one IndexedDB transaction, so another tab cannot claim the same next
 * revision between those operations. Blob records remain in maker-assets and
 * are referenced by the restored document rather than copied.
 */
export async function restoreMakerDraftCheckpoint(
  makerKeyValue,
  checkpointRevisionValue,
  {
    minimumRevision = -1,
    draftCommittedAt = Date.now(),
    expectedBaseRevision: expectedBaseRevisionValue,
  } = {},
) {
  const makerKey = requireKey(makerKeyValue, 'Maker key');
  const checkpointRevision = Number(checkpointRevisionValue);
  if (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 0) {
    throw new Error('Checkpoint revision must be a non-negative safe integer.');
  }
  const normalizedMinimum = Number(minimumRevision);
  if (!Number.isSafeInteger(normalizedMinimum) || normalizedMinimum < -1) {
    throw new Error('Minimum Maker draft revision must be a safe integer of at least -1.');
  }
  const expectedRevision = expectedBaseRevision(expectedBaseRevisionValue);
  const savedAt = Number.isFinite(draftCommittedAt) ? draftCommittedAt : Date.now();
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [MAKER_DRAFT_PROJECT_STORE, MAKER_DRAFT_CHECKPOINT_STORE],
      'readwrite',
    );
    const completion = transactionComplete(transaction);
    const projectStore = transaction.objectStore(MAKER_DRAFT_PROJECT_STORE);
    const checkpointStore = transaction.objectStore(MAKER_DRAFT_CHECKPOINT_STORE);
    const checkpointRequest = checkpointStore.get(
      makerDraftCheckpointRecordId(makerKey, checkpointRevision),
    );
    let callbackError = null;
    let outcome = null;

    checkpointRequest.onsuccess = () => {
      const historical = checkpointRequest.result;
      if (!historical) {
        callbackError = new Error(`Maker checkpoint revision ${checkpointRevision} was not found.`);
        return;
      }
      const projectRequest = projectStore.get(makerKey);
      projectRequest.onsuccess = () => {
        try {
          const currentRevision = projectRevision(projectRequest.result);
          const baseMatches = expectedRevision === null
            ? !projectRequest.result
            : Boolean(projectRequest.result) && currentRevision === expectedRevision;
          if (!baseMatches) {
            outcome = {
              committed: false,
              persistedRevision: currentRevision,
              restoredFromRevision: checkpointRevision,
              savedAt: projectRequest.result?.savedAt ?? null,
              conflict: true,
            };
            return;
          }
          const revisionFloor = Math.max(
            currentRevision === null ? -1 : currentRevision,
            normalizedMinimum,
          );
          if (revisionFloor >= Number.MAX_SAFE_INTEGER) {
            throw new Error('The Maker draft revision limit has been reached.');
          }
          const restoredRevision = revisionFloor + 1;
          const metadata = {
            ...structuredClone(historical.metadata || {}),
            [MAKER_DRAFT_REVISION_FIELD]: restoredRevision,
            [MAKER_DRAFT_BASE_REVISION_FIELD]: currentRevision,
            draftCommittedAt: savedAt,
            restoredFromRevision: checkpointRevision,
          };
          if (historical.recipe === undefined) {
            delete metadata.recipe;
          } else {
            metadata.recipe = structuredClone(historical.recipe);
          }
          const record = projectRecord(
            makerKey,
            structuredClone(historical.document),
            metadata,
          );
          projectStore.put(record);
          checkpointStore.add(checkpointRecord(record));
          pruneCheckpoints(checkpointStore, makerKey, transaction, (error) => {
            callbackError = error;
          });
          outcome = {
            committed: true,
            persistedRevision: restoredRevision,
            restoredFromRevision: checkpointRevision,
            savedAt,
            record: structuredClone(record),
            conflict: false,
          };
        } catch (error) {
          callbackError = error;
          transaction.abort();
        }
      };
      projectRequest.onerror = () => {
        callbackError = projectRequest.error
          || new Error('The current Maker draft revision could not be read for restoration.');
      };
    };
    checkpointRequest.onerror = () => {
      callbackError = checkpointRequest.error || new Error('The Maker draft checkpoint could not be read.');
    };
    try {
      await completion;
    } catch (error) {
      throw callbackError || error;
    }
    if (!outcome) throw callbackError || new Error('The Maker checkpoint restoration did not complete.');
    return outcome;
  } finally {
    database.close();
  }
}

/**
 * Atomically publishes the document revision and every newly referenced Blob.
 * Existing unreferenced assets are retained for undo/history recovery.
 */
export async function commitMakerDraftSnapshot(makerKeyValue, document, metadata = {}, assets = []) {
  const makerKey = requireKey(makerKeyValue, 'Maker key');
  if (!Array.isArray(assets)) throw new Error('Maker draft assets must be an array.');
  const incomingRevision = projectRevision({ metadata });
  if (incomingRevision === null) {
    throw new Error('A non-negative Maker draft revision is required for an atomic commit.');
  }
  const baseRevision = requestedBaseRevision(metadata);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [
        MAKER_DRAFT_PROJECT_STORE,
        MAKER_DRAFT_ASSET_STORE,
        MAKER_DRAFT_CHECKPOINT_STORE,
      ],
      'readwrite',
    );
    const projectStore = transaction.objectStore(MAKER_DRAFT_PROJECT_STORE);
    const checkpointStore = transaction.objectStore(MAKER_DRAFT_CHECKPOINT_STORE);
    const completion = transactionComplete(transaction);
    const request = projectStore.get(makerKey);
    let callbackError = null;
    let outcome = null;
    request.onsuccess = () => {
      const existing = request.result;
      const persistedRevision = projectRevision(existing);
      const baseMatches = baseRevision === null
        ? !existing
        : Boolean(existing) && persistedRevision === baseRevision;
      if (!baseMatches) {
        outcome = {
          committed: false,
          persistedRevision,
          savedAt: existing?.savedAt ?? null,
          conflict: true,
        };
        return;
      }
      if (persistedRevision !== null && incomingRevision <= persistedRevision) {
        outcome = {
          committed: false,
          persistedRevision,
          savedAt: existing.savedAt ?? null,
          conflict: true,
        };
        return;
      }

      const record = projectRecord(makerKey, document, metadata);
      try {
        if (assets.length) {
          putAssets(
            transaction.objectStore(MAKER_DRAFT_ASSET_STORE),
            makerKey,
            assets,
            record.savedAt,
          );
        }
        projectStore.put(record);
        checkpointStore.add(checkpointRecord(record));
        pruneCheckpoints(checkpointStore, makerKey, transaction, (error) => {
          callbackError = error;
        });
        outcome = {
          committed: true,
          persistedRevision: incomingRevision,
          savedAt: record.savedAt,
          conflict: false,
        };
      } catch (error) {
        callbackError = error;
        transaction.abort();
      }
    };
    request.onerror = () => {
      callbackError = request.error || new Error('The existing Maker draft revision could not be read.');
    };
    try {
      await completion;
    } catch (error) {
      throw callbackError || error;
    }
    if (!outcome) throw callbackError || new Error('The Maker draft commit did not complete.');
    return outcome;
  } finally {
    database.close();
  }
}
