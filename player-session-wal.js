export const PLAYER_SESSION_WAL_PREFIX = 'animacraft-player-session-wal-v1:';

function normalizedSessionKey(value) {
  return String(value || '').trim();
}

function normalizedWriterId(value) {
  return String(value || '').trim();
}

function storageKey(sessionKeyValue, writerIdValue = '') {
  const sessionKey = normalizedSessionKey(sessionKeyValue);
  if (!sessionKey) throw new Error('Player session key is required.');
  const base = `${PLAYER_SESSION_WAL_PREFIX}${encodeURIComponent(sessionKey)}`;
  const writerId = normalizedWriterId(writerIdValue);
  return writerId ? `${base}:${encodeURIComponent(writerId)}` : base;
}

function usableStorage(storage) {
  return storage
    && typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function';
}

function validRevision(value, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  return Number.isSafeInteger(value) && value >= 0;
}

function parseRecord(raw, expectedSessionKey, recordStorageKey) {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (
      record?.schemaVersion !== 1
      || record.sessionKey !== expectedSessionKey
      || !validRevision(record.revision)
      || !validRevision(record.baseRevision ?? null, { nullable: true })
      || !record.session
      || typeof record.session !== 'object'
      || !String(record.session.makerVersionId || '').trim()
      || !Number.isFinite(record.updatedAt)
    ) return null;
    return {
      ...record,
      writerId: normalizedWriterId(record.writerId),
      baseRevision: record.baseRevision ?? null,
      storageKey: recordStorageKey,
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

export function playerSessionWalSnapshotsEqual(left, right) {
  if (!left?.session || !right?.session) return false;
  try {
    return JSON.stringify(left.session) === JSON.stringify(right.session);
  } catch {
    return false;
  }
}

/**
 * Player recipes, profile fields and Soul Markdown are JSON-only. Each browser
 * tab owns an independent WAL branch so concurrent tabs can never overwrite
 * one another before the IndexedDB compare-and-swap boundary runs.
 */
export function writePlayerSessionWal(storage, sessionKeyValue, snapshot, metadata = {}) {
  if (!usableStorage(storage)) return false;
  const sessionKey = normalizedSessionKey(sessionKeyValue);
  if (
    !sessionKey
    || !validRevision(snapshot?.revision)
    || !validRevision(snapshot?.baseRevision ?? null, { nullable: true })
    || !snapshot?.session
    || !String(snapshot.session.makerVersionId || '').trim()
  ) {
    throw new Error('A valid Player session snapshot is required.');
  }
  const record = {
    schemaVersion: 1,
    sessionKey,
    writerId: normalizedWriterId(metadata.writerId),
    revision: snapshot.revision,
    baseRevision: snapshot.baseRevision ?? null,
    session: snapshot.session,
    updatedAt: Number.isFinite(metadata.updatedAt) ? metadata.updatedAt : Date.now(),
  };
  storage.setItem(storageKey(sessionKey, record.writerId), JSON.stringify(record));
  return true;
}

export function listPlayerSessionWals(storage, sessionKeyValue) {
  if (!usableStorage(storage)) return [];
  const sessionKey = normalizedSessionKey(sessionKeyValue);
  if (!sessionKey) return [];
  const baseKey = storageKey(sessionKey);
  const prefix = `${baseKey}:`;
  const keys = new Set([baseKey]);
  storageKeys(storage)
    .filter((key) => key === baseKey || key.startsWith(prefix))
    .forEach((key) => keys.add(key));
  return [...keys]
    .map((recordStorageKey) => parseRecord(
      storage.getItem(recordStorageKey),
      sessionKey,
      recordStorageKey,
    ))
    .filter(Boolean)
    .sort((left, right) => (
      right.revision - left.revision
      || Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
      || right.writerId.localeCompare(left.writerId)
    ));
}

export function loadPlayerSessionWal(storage, sessionKeyValue, { writerId = '' } = {}) {
  if (!usableStorage(storage)) return null;
  const sessionKey = normalizedSessionKey(sessionKeyValue);
  if (!sessionKey) return null;
  const requestedWriterId = normalizedWriterId(writerId);
  if (requestedWriterId) {
    const exactKey = storageKey(sessionKey, requestedWriterId);
    const exact = parseRecord(storage.getItem(exactKey), sessionKey, exactKey);
    if (exact) return exact;
  }
  return listPlayerSessionWals(storage, sessionKey)[0] || null;
}

export function clearPlayerSessionWal(storage, sessionKeyValue, {
  writerId = '',
  expectedWriterId = '',
  throughRevision = null,
  expectedSession = null,
} = {}) {
  if (!usableStorage(storage)) return false;
  const sessionKey = normalizedSessionKey(sessionKeyValue);
  if (!sessionKey) return false;
  const targetWriterId = normalizedWriterId(writerId || expectedWriterId);
  const key = storageKey(sessionKey, targetWriterId);
  const current = parseRecord(storage.getItem(key), sessionKey, key);
  if (!current) return false;
  if (
    normalizedWriterId(expectedWriterId)
    && current.writerId !== normalizedWriterId(expectedWriterId)
  ) return false;
  if (validRevision(throughRevision) && current.revision > throughRevision) return false;
  if (
    expectedSession
    && !playerSessionWalSnapshotsEqual(current, { session: expectedSession })
  ) return false;
  storage.removeItem(key);
  return true;
}

export function playerSessionWalStorageKey(sessionKeyValue, writerIdValue = '') {
  return storageKey(sessionKeyValue, writerIdValue);
}
