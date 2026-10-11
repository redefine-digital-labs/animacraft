export const MAKER_DRAFT_WAL_PREFIX = 'animacraft-maker-wal-v1:';

function requireMakerKey(value) {
  const makerKey = String(value || '').trim();
  if (!makerKey) throw new Error('Maker key is required.');
  return makerKey;
}

function normalizedWriterId(value) {
  return String(value || '').trim();
}

function walKey(makerKeyValue, writerIdValue = '') {
  const base = `${MAKER_DRAFT_WAL_PREFIX}${encodeURIComponent(requireMakerKey(makerKeyValue))}`;
  const writerId = normalizedWriterId(writerIdValue);
  return writerId ? `${base}:${encodeURIComponent(writerId)}` : base;
}

function usableStorage(storage) {
  return storage
    && typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function';
}

function isBinaryValue(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true;
  return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value);
}

function jsonWithoutBinary(value) {
  return JSON.stringify(value, (key, entry) => {
    if (isBinaryValue(entry)) return undefined;
    if (['blob', 'file', 'thumbnailBlob'].includes(key)) return undefined;
    if (
      ['url', 'thumbnailUrl'].includes(key)
      && typeof entry === 'string'
      && entry.startsWith('blob:')
    ) return '';
    return entry;
  });
}

function validRevision(value, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  return Number.isSafeInteger(value) && value >= 0;
}

function parseWalRecord(raw, makerKey, storageKey) {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (
      record?.schemaVersion !== 1
      || record.makerKey !== makerKey
      || !record.document
      || !validRevision(record.revision)
      || !validRevision(record.baseRevision, { nullable: true })
    ) {
      return null;
    }
    return {
      ...record,
      writerId: normalizedWriterId(record.writerId),
      storageKey,
    };
  } catch {
    return null;
  }
}

function storageKeys(storage) {
  if (!Number.isSafeInteger(storage?.length) || typeof storage?.key !== 'function') return [];
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key === 'string') keys.push(key);
  }
  return keys;
}

export function makerDraftWalSnapshotsEqual(left, right) {
  if (!left?.document || !right?.document) return false;
  try {
    return JSON.stringify({
      document: left.document,
      recipe: left.recipe,
    }) === JSON.stringify({
      document: right.document,
      recipe: right.recipe,
    });
  } catch {
    return false;
  }
}

/**
 * Synchronously records the latest JSON-only Maker state before its debounced
 * IndexedDB snapshot starts. PNG/File/Blob bytes deliberately remain in the
 * atomic v6 asset store and are never copied into localStorage.
 */
export function writeMakerDraftWal(storage, makerKeyValue, snapshot, metadata = {}) {
  if (!usableStorage(storage)) return false;
  const makerKey = requireMakerKey(makerKeyValue);
  if (
    !snapshot?.document
    || !validRevision(snapshot.revision)
    || !validRevision(snapshot.baseRevision, { nullable: true })
  ) {
    throw new Error('A valid Maker snapshot is required for write-ahead recovery.');
  }
  const record = {
    schemaVersion: 1,
    makerKey,
    writerId: normalizedWriterId(metadata.writerId),
    walletAddress: String(metadata.walletAddress || ''),
    rootMakerId: String(
      metadata.rootMakerId
      || snapshot.document.version?.rootMakerId
      || '',
    ),
    revision: snapshot.revision,
    baseRevision: snapshot.baseRevision,
    document: snapshot.document,
    recipe: snapshot.recipe,
    journal: snapshot.journal || [],
    updatedAt: Number.isFinite(metadata.updatedAt) ? metadata.updatedAt : Date.now(),
  };
  storage.setItem(walKey(makerKey, record.writerId), jsonWithoutBinary(record));
  return true;
}

export function listMakerDraftWals(storage, makerKeyValue) {
  if (!usableStorage(storage)) return [];
  const makerKey = requireMakerKey(makerKeyValue);
  const keyPrefix = `${walKey(makerKey)}:`;
  const keys = new Set([walKey(makerKey)]);
  storageKeys(storage)
    .filter((key) => key === walKey(makerKey) || key.startsWith(keyPrefix))
    .forEach((key) => keys.add(key));
  return [...keys]
    .map((storageKey) => parseWalRecord(storage.getItem(storageKey), makerKey, storageKey))
    .filter(Boolean)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

export function loadMakerDraftWal(storage, makerKeyValue, { writerId = '' } = {}) {
  if (!usableStorage(storage)) return null;
  const makerKey = requireMakerKey(makerKeyValue);
  const requestedWriterId = normalizedWriterId(writerId);
  if (requestedWriterId) {
    const exactKey = walKey(makerKey, requestedWriterId);
    const exact = parseWalRecord(storage.getItem(exactKey), makerKey, exactKey);
    if (exact) return exact;
  }
  return listMakerDraftWals(storage, makerKey)?.[0] || null;
}

export function clearMakerDraftWal(storage, makerKeyValue, {
  writerId = '',
  throughRevision = null,
  expectedSnapshot = null,
} = {}) {
  if (!usableStorage(storage)) return false;
  const makerKey = requireMakerKey(makerKeyValue);
  const storageKey = walKey(makerKey, normalizedWriterId(writerId));
  const current = parseWalRecord(storage.getItem(storageKey), makerKey, storageKey);
  if (!current) return false;
  if (expectedSnapshot && !makerDraftWalSnapshotsEqual(current, expectedSnapshot)) return false;
  if (Number.isSafeInteger(throughRevision) && throughRevision >= 0) {
    if (current.revision > throughRevision) return false;
  }
  storage.removeItem(storageKey);
  return true;
}

export function makerDraftWalStorageKey(makerKeyValue, writerIdValue = '') {
  return walKey(makerKeyValue, writerIdValue);
}
