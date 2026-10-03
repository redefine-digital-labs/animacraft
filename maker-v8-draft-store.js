import { canonicalMakerV8Json } from './maker-v8-compiler.js';
import { assertMakerV8Document, collectMakerV8DocumentIssues, upgradeAuthorMakerV8LivingContentV8 } from './maker-v8-document.js';
import { upgradeAuthorMakerV8RulesV8 } from './maker-v8-rules.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';

export const MAKER_V8_DRAFT_DATABASE = 'animacraft-maker-v8-drafts-v2';
export const MAKER_V8_DRAFT_RECORD_SCHEMA = 'animacraft.maker-v8-draft-record.v1';
export const MAKER_V8_DRAFT_EXPORT_SCHEMA = 'animacraft.maker-v8-draft-export.v1';
export const MAKER_V8_DRAFT_ASSET_SCHEMA = 'animacraft.maker-v8-draft-asset.v1';

const DATABASE_VERSION = 4;
const DRAFT_STORE = 'drafts';
const ASSET_STORE = 'assets';
const HISTORY_STORE = 'versions';
const ASSET_HISTORY_STORE = 'assetVersions';
const ASSET_BLOB_STORE = 'assetBlobs';
const DRAFT_IDENTITY_STORE = 'draftIdentities';
const ASSET_BLOB_SCHEMA = 'animacraft.maker-v8-draft-asset-blob.v1';
const ASSET_VERSION_SCHEMA = 'animacraft.maker-v8-draft-asset-version-ref.v1';
const MAX_HISTORY = 100;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const authorUpgrades = new WeakMap();

/** Provenance of an exact author-only read projection; copies cannot forge it. */
export function makerV8DraftAuthorUpgrade(record) {
  return authorUpgrades.get(record) ?? null;
}

export class MakerV8DraftStoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MakerV8DraftStoreError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new MakerV8DraftStoreError(code, message, details);
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, fields, label) {
  if (!record(value)) fail('MAKER_V8_DRAFT_RECORD_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_DRAFT_FIELDS_INVALID', `${label} has unexpected fields.`, { actual, expected });
  }
}

function safeId(value, label = 'draftId') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    fail('MAKER_V8_DRAFT_ID_INVALID', `${label} must be a safe lowercase identifier.`);
  }
  return value;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('MAKER_V8_DRAFT_TIME_INVALID', `${label} must be a non-negative safe integer.`);
  }
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('MAKER_V8_DRAFT_REVISION_INVALID', 'Draft revision must be a positive safe integer.');
  }
  return value;
}

function revisionOrNull(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('MAKER_V8_DRAFT_REVISION_INVALID', `${label} must be null or a positive safe integer.`);
  }
  return value;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function snapshotDocument(value) {
  // Author storage only: retain the raw historical record, project exact old
  // rule rows into the current schema before full document validation.
  const issues = collectMakerV8DocumentIssues(value, { mode: 'draft' });
  if (issues.some(entry => entry.code.startsWith('MAKER_V8_JSON_') || entry.code === 'MAKER_V8_DOCUMENT_LIMIT' || entry.code === 'MAKER_V8_COMPILER_FIELD_FORBIDDEN')) assertMakerV8Document(value, { mode: 'draft' });
  const next = structuredClone(value);
  if (Array.isArray(next?.rules)) next.rules = next.rules.map(rule => {
    const fields = ['key', 'kind', 'left', 'right', 'payload'];
    if (record(rule) && Object.keys(rule).length === fields.length && fields.every(field => Object.hasOwn(rule, field))) {
      return upgradeAuthorMakerV8RulesV8([rule])[0];
    }
    return rule;
  });
  return structuredClone(upgradeAuthorMakerV8LivingContentV8(next));
}

export function assertMakerV8DraftRecord(value) {
  exactKeys(value, ['schemaVersion', 'draftId', 'revision', 'createdAt', 'updatedAt', 'document'], 'draft');
  if (value.schemaVersion !== MAKER_V8_DRAFT_RECORD_SCHEMA) {
    fail('MAKER_V8_DRAFT_SCHEMA_INVALID', 'Draft record schema is not Maker v8.');
  }
  safeId(value.draftId);
  revision(value.revision);
  timestamp(value.createdAt, 'createdAt');
  timestamp(value.updatedAt, 'updatedAt');
  if (value.updatedAt < value.createdAt) fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt precedes createdAt.');
  snapshotDocument(value.document);
  return value;
}

function publicDraft(value) {
  if (!value) return null;
  assertMakerV8DraftRecord(value);
  const next = freeze({ ...structuredClone(value), document: snapshotDocument(value.document) });
  const sourceDocumentJson = canonicalMakerV8Json(value.document);
  const targetDocumentJson = canonicalMakerV8Json(next.document);
  if (sourceDocumentJson !== targetDocumentJson) {
    authorUpgrades.set(next, Object.freeze({ sourceDocumentJson, targetDocumentJson }));
  }
  return next;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => {};
  });
}

async function sha256(text) {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalBase64(value, label) {
  try {
    if (typeof value !== 'string') throw new Error('shape');
    const bytes = fromBase64(value);
    if (toBase64(bytes) !== value || bytes.length < 1 || bytes.length > MAX_ASSET_BYTES) {
      throw new Error('bounds');
    }
    return bytes;
  } catch {
    fail('MAKER_V8_DRAFT_ASSET_BYTES_INVALID', `${label} must be canonical Base64 within 12 MiB.`);
  }
}

function publicAsset(value) {
  if (!value) return null;
  exactKeys(value, [
    'schemaVersion', 'draftId', 'assetId', 'revision', 'createdAt', 'updatedAt',
    'kind', 'mediaType', 'bytesBase64', 'byteLength', 'sha256',
  ], 'draft asset');
  if (value.schemaVersion !== MAKER_V8_DRAFT_ASSET_SCHEMA) {
    fail('MAKER_V8_DRAFT_ASSET_SCHEMA_INVALID', 'Draft asset schema is not fresh v8.');
  }
  safeId(value.draftId);
  safeId(value.assetId, 'assetId');
  revision(value.revision);
  timestamp(value.createdAt, 'asset.createdAt');
  timestamp(value.updatedAt, 'asset.updatedAt');
  const bytes = canonicalBase64(value.bytesBase64, 'draft asset bytes');
  if (value.updatedAt < value.createdAt || value.byteLength !== bytes.length
    || !HASH.test(value.sha256) || typeof value.kind !== 'string' || !value.kind
    || typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType)) {
    fail('MAKER_V8_DRAFT_ASSET_INVALID', 'Draft asset metadata or evidence is invalid.');
  }
  return freeze(structuredClone(value));
}

function publicAssetVersion(value) {
  exactKeys(value, [
    'schemaVersion', 'draftId', 'draftRevision', 'assetId', 'revision', 'createdAt', 'updatedAt',
    'kind', 'mediaType', 'byteLength', 'sha256', 'blobId',
  ], 'draft asset version');
  if (value.schemaVersion !== ASSET_VERSION_SCHEMA) {
    fail('MAKER_V8_DRAFT_ASSET_SCHEMA_INVALID', 'Draft asset version schema is not fresh v8.');
  }
  safeId(value.draftId);
  safeId(value.assetId, 'assetId');
  revision(value.draftRevision);
  revision(value.revision);
  timestamp(value.createdAt, 'asset version.createdAt');
  timestamp(value.updatedAt, 'asset version.updatedAt');
  if (value.updatedAt < value.createdAt
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || value.byteLength > MAX_ASSET_BYTES || !HASH.test(value.sha256)
    || typeof value.blobId !== 'string' || value.blobId.length < 64 || value.blobId.length > 512
    || typeof value.kind !== 'string' || !value.kind
    || typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType)) {
    fail('MAKER_V8_DRAFT_ASSET_INVALID', 'Draft asset version metadata is invalid.');
  }
  return freeze(structuredClone(value));
}

function assetVersion(asset, draftRevision, blobId) {
  const checked = publicAsset(asset);
  const { bytesBase64: _bytesBase64, schemaVersion: _schemaVersion, ...metadata } = structuredClone(checked);
  return publicAssetVersion({
    schemaVersion: ASSET_VERSION_SCHEMA,
    ...metadata,
    draftRevision: revision(draftRevision),
    blobId,
  });
}

function publicAssetBlob(value) {
  exactKeys(value, ['schemaVersion', 'blobId', 'sha256', 'bytesBase64', 'byteLength'], 'draft asset blob');
  if (value.schemaVersion !== ASSET_BLOB_SCHEMA || !HASH.test(value.sha256)) {
    fail('MAKER_V8_DRAFT_ASSET_BLOB_INVALID', 'Draft asset blob schema or SHA-256 is invalid.');
  }
  const bytes = canonicalBase64(value.bytesBase64, 'draft asset blob bytes');
  if (typeof value.blobId !== 'string' || value.blobId.length < 64 || value.blobId.length > 512
    || value.byteLength !== bytes.length) {
    fail('MAKER_V8_DRAFT_ASSET_BLOB_INVALID', 'Draft asset blob length is invalid.');
  }
  return freeze(structuredClone(value));
}

function assetBlob(value, blobId = value.sha256) {
  const checked = publicAsset(value);
  return publicAssetBlob({
    schemaVersion: ASSET_BLOB_SCHEMA,
    blobId,
    sha256: checked.sha256,
    bytesBase64: checked.bytesBase64,
    byteLength: checked.byteLength,
  });
}

function assetFromVersion(value, blob) {
  const checked = publicAssetVersion(value);
  const checkedBlob = publicAssetBlob(blob);
  if (checkedBlob.blobId !== checked.blobId || checkedBlob.sha256 !== checked.sha256
    || checkedBlob.byteLength !== checked.byteLength) {
    fail(
      'MAKER_V8_DRAFT_VERSION_ASSET_SNAPSHOT_MISSING',
      'Historical asset metadata does not match its content-addressed bytes.',
    );
  }
  const {
    draftRevision: _draftRevision,
    blobId: _blobId,
    schemaVersion: _schemaVersion,
    ...asset
  } = structuredClone(checked);
  return publicAsset({
    schemaVersion: MAKER_V8_DRAFT_ASSET_SCHEMA,
    ...asset,
    bytesBase64: checkedBlob.bytesBase64,
  });
}

function orderedAssets(rows) {
  return rows.map(publicAsset)
    .sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
}

function orderedAssetVersions(rows) {
  return rows.map(publicAssetVersion)
    .sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
}

function assertExactDocumentAssets(document, rows, code, message) {
  const descriptors = [...document.assets]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const assets = orderedAssets(rows);
  if (descriptors.length !== assets.length || descriptors.some((descriptor, index) => {
    const asset = assets[index];
    return descriptor.id !== asset.assetId
      || descriptor.kind !== asset.kind
      || descriptor.mediaType !== asset.mediaType
      || descriptor.byteLength !== asset.byteLength;
  })) {
    fail(code, message);
  }
  return assets;
}

function latestAssetTime(rows) {
  return rows.reduce((latest, asset) => Math.max(latest, publicAsset(asset).updatedAt), 0);
}

function assertDraftAssetTimeline(draft, rows) {
  const checkedDraft = publicDraft(draft);
  for (const row of rows) {
    const asset = publicAsset(row);
    if (asset.draftId !== checkedDraft.draftId
      || asset.revision > checkedDraft.revision
      || asset.createdAt < checkedDraft.createdAt
      || asset.updatedAt > checkedDraft.updatedAt) {
      fail(
        'MAKER_V8_DRAFT_ASSET_TIMELINE_INVALID',
        'Draft asset identity, revision, or time is outside its durable draft revision.',
      );
    }
  }
  return rows;
}

export async function validatedDraftExportBundle(bundle) {
  exactKeys(bundle, ['schemaVersion', 'draft', 'assets', 'draftSha256'], 'draft export');
  if (bundle.schemaVersion !== MAKER_V8_DRAFT_EXPORT_SCHEMA || !HASH.test(bundle.draftSha256)) {
    fail('MAKER_V8_DRAFT_EXPORT_INVALID', 'Imported project is not an exact fresh-v8 draft export.');
  }
  // Authenticate the exported historical bytes before author-only projection.
  // Projecting rules first would invalidate an otherwise genuine old export.
  assertMakerV8DraftRecord(bundle.draft);
  const draft = structuredClone(bundle.draft);
  if (!Array.isArray(bundle.assets)) {
    fail('MAKER_V8_DRAFT_EXPORT_INVALID', 'Imported project assets must be an exact array.');
  }
  const assets = bundle.assets.map(publicAsset)
    .sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
  assertDraftAssetTimeline(draft, assets);
  const expectedIds = draft.document.assets.map((asset) => asset.id).sort();
  const observedIds = assets.map((asset) => asset.assetId);
  if (new Set(observedIds).size !== observedIds.length
    || canonicalMakerV8Json(expectedIds) !== canonicalMakerV8Json(observedIds)) {
    fail('MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE', 'Imported project must contain exact bytes for every document asset.');
  }
  for (const asset of assets) {
    const descriptor = draft.document.assets.find((entry) => entry.id === asset.assetId);
    if (asset.draftId !== draft.draftId || descriptor?.kind !== asset.kind
      || descriptor?.mediaType !== asset.mediaType || descriptor?.byteLength !== asset.byteLength
      || await sha256(fromBase64(asset.bytesBase64)) !== asset.sha256) {
      fail('MAKER_V8_DRAFT_ASSET_DOCUMENT_DRIFT', 'Imported asset evidence does not match the exact Maker document.');
    }
  }
  const expectedHash = await sha256(canonicalMakerV8Json({ draft, assets }));
  if (expectedHash !== bundle.draftSha256) {
    fail('MAKER_V8_DRAFT_EXPORT_HASH_MISMATCH', 'Imported project hash does not match its canonical fresh-v8 contents.');
  }
  return { draft: publicDraft(draft), assets };
}

function strictTransaction(database, stores, mode) {
  if (mode !== 'readwrite') return database.transaction(stores, mode);
  try {
    return database.transaction(stores, mode, { durability: 'strict' });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return database.transaction(stores, mode);
  }
}

export function createMakerV8DraftPersistence(
  indexedDB = globalThis.indexedDB,
  { databaseName = MAKER_V8_DRAFT_DATABASE, now = () => Date.now() } = {},
) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    fail('MAKER_V8_DRAFT_INDEXEDDB_REQUIRED', 'IndexedDB is required for Maker v8 drafts.');
  }
  let databasePromise;
  let closed = false;
  const open = () => {
    if (databasePromise && !closed) return databasePromise;
    closed = false;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        if (!request.result.objectStoreNames.contains(DRAFT_STORE)) {
          const drafts = request.result.createObjectStore(DRAFT_STORE, { keyPath: 'draftId' });
          drafts.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
        }
        if (!request.result.objectStoreNames.contains(ASSET_STORE)) {
          const assets = request.result.createObjectStore(ASSET_STORE, { keyPath: ['draftId', 'assetId'] });
          assets.createIndex('byDraft', 'draftId', { unique: false });
        }
        if (!request.result.objectStoreNames.contains(HISTORY_STORE)) {
          const history = request.result.createObjectStore(HISTORY_STORE, { keyPath: ['draftId', 'revision'] });
          history.createIndex('byDraft', 'draftId', { unique: false });
          if (request.result.objectStoreNames.contains(DRAFT_STORE)) {
            request.transaction.objectStore(DRAFT_STORE).openCursor().onsuccess = (event) => {
              const cursor = event.target.result;
              if (!cursor) return;
              history.put(structuredClone(cursor.value));
              cursor.continue();
            };
          }
        }
        let assetHistory;
        if (!request.result.objectStoreNames.contains(ASSET_HISTORY_STORE)) {
          assetHistory = request.result.createObjectStore(ASSET_HISTORY_STORE, {
            keyPath: ['draftId', 'draftRevision', 'assetId'],
          });
          assetHistory.createIndex('byDraft', 'draftId', { unique: false });
          assetHistory.createIndex('byDraftRevision', ['draftId', 'draftRevision'], { unique: false });
          assetHistory.createIndex('byBlobId', 'blobId', { unique: false });
        } else {
          assetHistory = request.transaction.objectStore(ASSET_HISTORY_STORE);
          if (!assetHistory.indexNames.contains('byBlobId')) {
            assetHistory.createIndex('byBlobId', 'blobId', { unique: false });
          }
        }
        let assetBlobs;
        if (request.result.objectStoreNames.contains(ASSET_BLOB_STORE)) {
          assetBlobs = request.transaction.objectStore(ASSET_BLOB_STORE);
        } else {
          assetBlobs = request.result.createObjectStore(ASSET_BLOB_STORE, { keyPath: 'blobId' });
          assetBlobs.createIndex('bySha256', 'sha256', { unique: false });
        }
        const draftIdentities = request.result.objectStoreNames.contains(DRAFT_IDENTITY_STORE)
          ? request.transaction.objectStore(DRAFT_IDENTITY_STORE)
          : request.result.createObjectStore(DRAFT_IDENTITY_STORE, { keyPath: 'draftId' });
        const migratedBlobContents = new Map();
        const migrateInlineAssetVersion = (row, draftRevision) => {
          const bytesBase64 = row.bytesBase64;
          let blobId = row.sha256;
          const prior = migratedBlobContents.get(blobId);
          if (prior !== undefined && prior !== bytesBase64) {
            blobId = `${row.sha256}:${row.draftId}:${draftRevision}:${row.assetId}`;
          }
          if (!migratedBlobContents.has(blobId)) {
            migratedBlobContents.set(blobId, bytesBase64);
            assetBlobs.add({
              schemaVersion: ASSET_BLOB_SCHEMA,
              blobId,
              sha256: row.sha256,
              bytesBase64,
              byteLength: row.byteLength,
            });
          }
          const {
            bytesBase64: _bytesBase64,
            schemaVersion: _schemaVersion,
            draftRevision: _oldDraftRevision,
            blobId: _oldBlobId,
            ...metadata
          } = structuredClone(row);
          return {
            schemaVersion: ASSET_VERSION_SCHEMA,
            ...metadata,
            draftRevision,
            blobId,
          };
        };
        if (event.oldVersion > 0 && event.oldVersion < 3
          && request.result.objectStoreNames.contains(DRAFT_STORE)
          && request.result.objectStoreNames.contains(ASSET_STORE)) {
          const drafts = request.transaction.objectStore(DRAFT_STORE);
          const assets = request.transaction.objectStore(ASSET_STORE);
          drafts.openCursor().onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            const current = cursor.value;
            const rowsRequest = assets.index('byDraft').getAll(current.draftId);
            rowsRequest.onsuccess = () => {
              for (const row of rowsRequest.result) {
                assetHistory.add(migrateInlineAssetVersion(row, current.revision));
              }
              cursor.continue();
            };
          };
        }
        if (event.oldVersion > 0 && event.oldVersion < 4) {
          const drafts = request.transaction.objectStore(DRAFT_STORE);
          drafts.openKeyCursor().onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            draftIdentities.put({ draftId: cursor.primaryKey });
            cursor.continue();
          };
        }
        if (event.oldVersion === 3) {
          assetHistory.openCursor().onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            const row = structuredClone(cursor.value);
            if (Object.hasOwn(row, 'bytesBase64')) {
              try {
                const bytes = fromBase64(row.bytesBase64);
                if (toBase64(bytes) === row.bytesBase64 && bytes.length === row.byteLength
                  && bytes.length >= 1 && bytes.length <= MAX_ASSET_BYTES && HASH.test(row.sha256)) {
                  cursor.update(migrateInlineAssetVersion(row, row.draftRevision));
                } else {
                  cursor.delete();
                }
              } catch {
                cursor.delete();
              }
            }
            cursor.continue();
          };
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          closed = true;
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('Maker v8 draft database failed to open.'));
      request.onblocked = () => reject(new MakerV8DraftStoreError(
        'MAKER_V8_DRAFT_DATABASE_BLOCKED',
        'Another tab is blocking the Maker v8 draft database.',
      ));
    });
    return databasePromise;
  };

  async function transact(mode, operation) {
    const database = await open();
    const transaction = strictTransaction(database, [DRAFT_STORE, HISTORY_STORE], mode);
    const done = transactionDone(transaction);
    let result;
    try {
      result = await operation(
        transaction.objectStore(DRAFT_STORE),
        transaction.objectStore(HISTORY_STORE),
      );
      if (mode === 'readwrite') await done;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
    return result;
  }

  async function transactAsset(mode, operation) {
    const database = await open();
    const transaction = strictTransaction(
      database,
      [
        DRAFT_STORE, ASSET_STORE, HISTORY_STORE, ASSET_HISTORY_STORE,
        ASSET_BLOB_STORE, DRAFT_IDENTITY_STORE,
      ],
      mode,
    );
    const done = transactionDone(transaction);
    let result;
    try {
      result = await operation(
        transaction.objectStore(DRAFT_STORE),
        transaction.objectStore(ASSET_STORE),
        transaction.objectStore(HISTORY_STORE),
        transaction.objectStore(ASSET_HISTORY_STORE),
        transaction.objectStore(ASSET_BLOB_STORE),
        transaction.objectStore(DRAFT_IDENTITY_STORE),
      );
      if (mode === 'readwrite') await done;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
    return result;
  }

  async function putAssetVersions(assetVersions, assetBlobs, draftRevision, rows) {
    const checkedRows = orderedAssets(rows);
    const candidateRequests = checkedRows.map((row) => (
      assetBlobs.index('bySha256').getAll(row.sha256)
    ));
    const durableCandidates = await Promise.all(candidateRequests.map(requestResult));
    const localCandidates = new Map();
    checkedRows.forEach((row, index) => {
      const candidates = durableCandidates[index].map(publicAssetBlob)
        .concat(localCandidates.get(row.sha256) ?? []);
      const matching = candidates.find((candidate) => (
        candidate.byteLength === row.byteLength && candidate.bytesBase64 === row.bytesBase64
      ));
      const blobId = matching?.blobId
        ?? (candidates.length === 0
          ? row.sha256
          : `${row.sha256}:${row.draftId}:${draftRevision}:${row.assetId}`);
      if (!matching) {
        const nextBlob = assetBlob(row, blobId);
        assetBlobs.add(structuredClone(nextBlob));
        const local = localCandidates.get(row.sha256) ?? [];
        local.push(nextBlob);
        localCandidates.set(row.sha256, local);
      }
      assetVersions.add(structuredClone(assetVersion(row, draftRevision, blobId)));
    });
  }

  async function deleteUnreferencedAssetBlobs(assetVersions, assetBlobs, blobIds) {
    const unique = [...new Set(blobIds)];
    const requests = unique.map((blobId) => [blobId, assetVersions.index('byBlobId').count(blobId)]);
    const counts = await Promise.all(requests.map(([, request]) => requestResult(request)));
    counts.forEach((count, index) => {
      if (count === 0) assetBlobs.delete(requests[index][0]);
    });
  }

  async function pruneHistoryRevision(history, assetVersions, assetBlobs, draftId, draftRevision) {
    history.delete([draftId, draftRevision]);
    const index = assetVersions.index('byDraftRevision');
    const keyRequest = index.getAllKeys([draftId, draftRevision]);
    const rowRequest = index.getAll([draftId, draftRevision]);
    const [keys, rows] = await Promise.all([requestResult(keyRequest), requestResult(rowRequest)]);
    for (const key of keys) assetVersions.delete(key);
    await deleteUnreferencedAssetBlobs(assetVersions, assetBlobs, rows.map((row) => row.blobId));
  }

  async function verifiedAssetSnapshot(draftId) {
    const snapshot = await transactAsset('readonly', async (drafts, assets) => {
      const draft = publicDraft(await requestResult(drafts.get(draftId)));
      if (!draft) fail('MAKER_V8_DRAFT_NOT_FOUND', `Draft ${draftId} does not exist.`);
      const rows = orderedAssets(await requestResult(assets.index('byDraft').getAll(draftId)));
      assertDraftAssetTimeline(draft, rows);
      return freeze({
        draft,
        assets: freeze(rows),
      });
    });
    for (const asset of snapshot.assets) {
      if (await sha256(fromBase64(asset.bytesBase64)) !== asset.sha256) {
        fail(
          'MAKER_V8_DRAFT_ASSET_HASH_MISMATCH',
          'Draft asset bytes do not match their durable SHA-256.',
        );
      }
    }
    return freeze({
      ...snapshot,
      draftJson: canonicalMakerV8Json(snapshot.draft),
      assetsJson: canonicalMakerV8Json(snapshot.assets),
    });
  }

  async function hydratedAssetVersionSnapshot(assetVersions, assetBlobs, draftId, draftRevision) {
    const versions = orderedAssetVersions(await requestResult(
      assetVersions.index('byDraftRevision').getAll([draftId, draftRevision]),
    ));
    const blobRequests = versions.map((value) => assetBlobs.get(value.blobId));
    const blobRows = await Promise.all(blobRequests.map(requestResult));
    if (blobRows.some((value) => !value)) {
      fail(
        'MAKER_V8_DRAFT_VERSION_ASSET_SNAPSHOT_MISSING',
        'This draft version is missing content-addressed historical asset bytes.',
      );
    }
    const blobs = blobRows.map(publicAssetBlob);
    return freeze({
      versions: freeze(versions),
      blobs: freeze(blobs),
      assets: freeze(versions.map((value, index) => assetFromVersion(value, blobs[index]))),
    });
  }

  function assertVerifiedSnapshot(draft, rows, snapshot) {
    if (canonicalMakerV8Json(publicDraft(draft)) !== snapshot.draftJson
      || canonicalMakerV8Json(orderedAssets(rows)) !== snapshot.assetsJson) {
      fail(
        'MAKER_V8_DRAFT_CHANGED',
        'Draft or asset evidence changed while the strict transaction was being prepared.',
      );
    }
  }

  return freeze({
    async createBundle({ draftId, document, assets, createdAt = now() }) {
      const id = safeId(draftId);
      const at = timestamp(createdAt, 'createdAt');
      const next = {
        schemaVersion: MAKER_V8_DRAFT_RECORD_SCHEMA,
        draftId: id,
        revision: 1,
        createdAt: at,
        updatedAt: at,
        document: snapshotDocument(document),
      };
      assertMakerV8DraftRecord(next);
      if (!Array.isArray(assets)) {
        fail('MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE', 'A new Maker bundle requires exact asset bytes.');
      }
      const rows = await Promise.all(assets.map(async (entry) => {
        exactKeys(entry, ['assetId', 'kind', 'mediaType', 'bytesBase64'], 'new draft asset');
        const assetId = safeId(entry.assetId, 'assetId');
        const bytes = canonicalBase64(entry.bytesBase64, 'new draft asset bytes');
        if (typeof entry.kind !== 'string' || !entry.kind
          || typeof entry.mediaType !== 'string' || !MEDIA_TYPE.test(entry.mediaType)) {
          fail('MAKER_V8_DRAFT_ASSET_INVALID', 'Draft asset kind and media type are required.');
        }
        return publicAsset({
          schemaVersion: MAKER_V8_DRAFT_ASSET_SCHEMA,
          draftId: id,
          assetId,
          revision: 1,
          createdAt: at,
          updatedAt: at,
          kind: entry.kind,
          mediaType: entry.mediaType,
          bytesBase64: entry.bytesBase64,
          byteLength: bytes.length,
          sha256: await sha256(bytes),
        });
      }));
      const checkedRows = assertExactDocumentAssets(
        next.document,
        rows,
        'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE',
        'A new Maker bundle requires exact bytes for every document asset and no orphan bytes.',
      );
      return transactAsset('readwrite', async (
        draftStore, assetStore, history, assetVersions, assetBlobs, draftIdentities,
      ) => {
        if (await requestResult(draftStore.get(id))) {
          fail('MAKER_V8_DRAFT_EXISTS', `Draft ${id} already exists.`);
        }
        if (await requestResult(draftIdentities.get(id))) {
          fail('MAKER_V8_DRAFT_ID_RETIRED', `Draft ID ${id} has already been used and cannot be recreated.`);
        }
        draftIdentities.add({ draftId: id });
        draftStore.add(structuredClone(next));
        history.add(structuredClone(next));
        for (const asset of checkedRows) assetStore.add(structuredClone(asset));
        await putAssetVersions(assetVersions, assetBlobs, next.revision, checkedRows);
        return freeze({ draft: publicDraft(next), assets: freeze(checkedRows) });
      });
    },

    async createSuccessor({
      sourceDraftId, sourceExpectedRevision, draftId, document, createdAt = now(),
    }) {
      const sourceId = safeId(sourceDraftId, 'sourceDraftId');
      const expected = revision(sourceExpectedRevision);
      const targetId = safeId(draftId);
      if (sourceId === targetId) fail('MAKER_V8_DRAFT_SUCCESSOR_ID_INVALID', 'A successor draft requires a new local draft ID.');
      const at = timestamp(createdAt, 'createdAt');
      const nextDocument = snapshotDocument(document);
      if (nextDocument.lineage.version < 2
        || nextDocument.lineage.previousRootId === null
        || nextDocument.lineage.previousVersionCommitment === null) {
        fail('MAKER_V8_DRAFT_SUCCESSOR_LINEAGE_INVALID', 'A successor draft requires exact N+1 lineage evidence.');
      }
      const sourceSnapshot = await verifiedAssetSnapshot(sourceId);
      if (sourceSnapshot.draft.revision !== expected) {
        fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Source draft changed in another tab.');
      }
      if (at < sourceSnapshot.draft.updatedAt || at < latestAssetTime(sourceSnapshot.assets)) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'Successor creation time moved backwards.');
      }
      assertExactDocumentAssets(
        nextDocument,
        sourceSnapshot.assets,
        'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE',
        'Successor publication requires the exact local bytes for every inherited asset.',
      );
      return transactAsset('readwrite', async (
        drafts, assets, history, assetVersions, assetBlobs, draftIdentities,
      ) => {
        const source = await requestResult(drafts.get(sourceId));
        if (!source) fail('MAKER_V8_DRAFT_NOT_FOUND', `Draft ${sourceId} does not exist.`);
        assertMakerV8DraftRecord(source);
        if (source.revision !== expected) fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Source draft changed in another tab.');
        if (source.document.lineage.makerKey !== nextDocument.lineage.makerKey) {
          fail('MAKER_V8_DRAFT_SUCCESSOR_LINEAGE_INVALID', 'Successor Maker key differs from the source project.');
        }
        if (await requestResult(drafts.get(targetId))) {
          fail('MAKER_V8_DRAFT_EXISTS', `Draft ${targetId} already exists.`);
        }
        if (await requestResult(draftIdentities.get(targetId))) {
          fail('MAKER_V8_DRAFT_ID_RETIRED', `Draft ID ${targetId} has already been used and cannot be recreated.`);
        }
        const sourceAssets = await requestResult(assets.index('byDraft').getAll(sourceId));
        assertVerifiedSnapshot(source, sourceAssets, sourceSnapshot);
        const descriptors = [...nextDocument.assets]
          .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
        const observed = sourceAssets.map(publicAsset)
          .sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
        if (descriptors.length !== observed.length || descriptors.some((descriptor, index) => {
          const asset = observed[index];
          return descriptor.id !== asset.assetId || descriptor.kind !== asset.kind
            || descriptor.mediaType !== asset.mediaType || descriptor.byteLength !== asset.byteLength;
        })) {
          fail('MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE', 'Successor publication requires the exact local bytes for every inherited asset.');
        }
        const next = {
          schemaVersion: MAKER_V8_DRAFT_RECORD_SCHEMA,
          draftId: targetId,
          revision: 1,
          createdAt: at,
          updatedAt: at,
          document: nextDocument,
        };
        assertMakerV8DraftRecord(next);
        draftIdentities.add({ draftId: targetId });
        drafts.add(structuredClone(next));
        history.add(structuredClone(next));
        const copiedAssets = observed.map((asset) => {
          const copied = publicAsset({
            ...structuredClone(asset),
            draftId: targetId,
            revision: 1,
            createdAt: at,
            updatedAt: at,
          });
          assets.add(structuredClone(copied));
          return copied;
        });
        await putAssetVersions(assetVersions, assetBlobs, next.revision, copiedAssets);
        return freeze({ draft: publicDraft(next), assets: freeze(copiedAssets) });
      });
    },

    async load(draftId) {
      const id = safeId(draftId);
      return transact('readonly', async (store) => publicDraft(await requestResult(store.get(id))));
    },

    async list() {
      return transact('readonly', async (store) => {
        const rows = await requestResult(store.getAll());
        rows.sort((left, right) => right.updatedAt - left.updatedAt || left.draftId.localeCompare(right.draftId));
        return freeze(rows.map(publicDraft));
      });
    },

    async compareAndSwap({ draftId, expectedRevision, document, updatedAt = now() }) {
      const id = safeId(draftId);
      const expected = revision(expectedRevision);
      const at = timestamp(updatedAt, 'updatedAt');
      const nextDocument = snapshotDocument(document);
      const snapshot = await verifiedAssetSnapshot(id);
      if (snapshot.draft.revision !== expected) {
        fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.', {
          expectedRevision: expected,
          actualRevision: snapshot.draft.revision,
        });
      }
      if (at < snapshot.draft.updatedAt) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
      }
      if (at < latestAssetTime(snapshot.assets)) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt precedes durable asset evidence.');
      }
      assertExactDocumentAssets(
        nextDocument,
        snapshot.assets,
        'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE',
        'A document-only save requires exact durable bytes for every Maker asset.',
      );
      return transactAsset('readwrite', async (store, assets, history, assetVersions, assetBlobs) => {
        const current = await requestResult(store.get(id));
        if (!current) fail('MAKER_V8_DRAFT_NOT_FOUND', `Draft ${id} does not exist.`);
        assertMakerV8DraftRecord(current);
        if (current.revision !== expected) {
          fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.', {
            expectedRevision: expected,
            actualRevision: current.revision,
          });
        }
        if (at < current.updatedAt) fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
        const currentRows = await requestResult(assets.index('byDraft').getAll(id));
        assertVerifiedSnapshot(current, currentRows, snapshot);
        const next = {
          ...current,
          revision: current.revision + 1,
          updatedAt: at,
          document: nextDocument,
        };
        assertMakerV8DraftRecord(next);
        const assetRows = assertExactDocumentAssets(
          next.document,
          currentRows,
          'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE',
          'A document-only save requires exact durable bytes for every Maker asset.',
        );
        store.put(next);
        history.put(structuredClone(next));
        await putAssetVersions(assetVersions, assetBlobs, next.revision, assetRows);
        if (next.revision > MAX_HISTORY) {
          await pruneHistoryRevision(history, assetVersions, assetBlobs, id, next.revision - MAX_HISTORY);
        }
        return publicDraft(next);
      });
    },

    async compareAndSwapBundle({
      draftId,
      expectedRevision,
      document,
      assetUpserts = [],
      assetDeletes = [],
      updatedAt = now(),
    }) {
      const id = safeId(draftId);
      const expected = revision(expectedRevision);
      const at = timestamp(updatedAt, 'updatedAt');
      const nextDocument = snapshotDocument(document);
      if (!Array.isArray(assetUpserts) || !Array.isArray(assetDeletes)) {
        fail('MAKER_V8_DRAFT_ASSET_MUTATION_INVALID', 'Asset mutations must be exact arrays.');
      }
      const seenAssetIds = new Set();
      const checkedUpserts = await Promise.all(assetUpserts.map(async (entry) => {
        exactKeys(
          entry,
          ['assetId', 'expectedRevision', 'kind', 'mediaType', 'bytesBase64'],
          'asset upsert',
        );
        const assetId = safeId(entry.assetId, 'assetId');
        if (seenAssetIds.has(assetId)) {
          fail('MAKER_V8_DRAFT_ASSET_MUTATION_INVALID', 'An asset may be mutated only once per draft transaction.');
        }
        seenAssetIds.add(assetId);
        const expectedAssetRevision = revisionOrNull(entry.expectedRevision, 'asset expectedRevision');
        const bytes = canonicalBase64(entry.bytesBase64, 'draft asset bytes');
        if (typeof entry.kind !== 'string' || !entry.kind
          || typeof entry.mediaType !== 'string' || !MEDIA_TYPE.test(entry.mediaType)) {
          fail('MAKER_V8_DRAFT_ASSET_INVALID', 'Draft asset kind and media type are required.');
        }
        return {
          assetId,
          expectedRevision: expectedAssetRevision,
          kind: entry.kind,
          mediaType: entry.mediaType,
          bytesBase64: entry.bytesBase64,
          bytes,
          sha256: await sha256(bytes),
        };
      }));
      const checkedDeletes = assetDeletes.map((entry) => {
        exactKeys(entry, ['assetId', 'expectedRevision'], 'asset delete');
        const assetId = safeId(entry.assetId, 'assetId');
        if (seenAssetIds.has(assetId)) {
          fail('MAKER_V8_DRAFT_ASSET_MUTATION_INVALID', 'An asset may be mutated only once per draft transaction.');
        }
        seenAssetIds.add(assetId);
        return {
          assetId,
          expectedRevision: revision(entry.expectedRevision),
        };
      });
      const snapshot = await verifiedAssetSnapshot(id);
      if (snapshot.draft.revision !== expected) {
        fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.', {
          expectedRevision: expected,
          actualRevision: snapshot.draft.revision,
        });
      }
      if (at < snapshot.draft.updatedAt) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
      }
      if (at < latestAssetTime(snapshot.assets)) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt precedes durable asset evidence.');
      }

      return transactAsset('readwrite', async (drafts, assets, history, assetVersions, assetBlobs) => {
        const currentDraft = await requestResult(drafts.get(id));
        if (!currentDraft) fail('MAKER_V8_DRAFT_NOT_FOUND', `Draft ${id} does not exist.`);
        assertMakerV8DraftRecord(currentDraft);
        if (currentDraft.revision !== expected) {
          fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.', {
            expectedRevision: expected,
            actualRevision: currentDraft.revision,
          });
        }
        if (at < currentDraft.updatedAt) fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');

        const currentRows = await requestResult(assets.index('byDraft').getAll(id));
        assertVerifiedSnapshot(currentDraft, currentRows, snapshot);
        const nextAssets = new Map(currentRows.map((row) => {
          const checked = publicAsset(row);
          return [checked.assetId, checked];
        }));

        for (const mutation of checkedDeletes) {
          const current = nextAssets.get(mutation.assetId);
          if (!current || current.revision !== mutation.expectedRevision) {
            fail('MAKER_V8_DRAFT_ASSET_CAS_MISMATCH', 'Draft asset changed in another tab.');
          }
          nextAssets.delete(mutation.assetId);
        }

        for (const mutation of checkedUpserts) {
          const current = nextAssets.get(mutation.assetId) ?? null;
          if ((current?.revision ?? null) !== mutation.expectedRevision) {
            fail('MAKER_V8_DRAFT_ASSET_CAS_MISMATCH', 'Draft asset changed in another tab.');
          }
          nextAssets.set(mutation.assetId, publicAsset({
            schemaVersion: MAKER_V8_DRAFT_ASSET_SCHEMA,
            draftId: id,
            assetId: mutation.assetId,
            revision: current ? current.revision + 1 : currentDraft.revision + 1,
            createdAt: current?.createdAt ?? at,
            updatedAt: at,
            kind: mutation.kind,
            mediaType: mutation.mediaType,
            bytesBase64: mutation.bytesBase64,
            byteLength: mutation.bytes.length,
            sha256: mutation.sha256,
          }));
        }

        const descriptors = [...nextDocument.assets]
          .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
        const rows = [...nextAssets.values()]
          .sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
        if (descriptors.length !== rows.length || descriptors.some((descriptor, index) => {
          const asset = rows[index];
          return descriptor.id !== asset.assetId
            || descriptor.kind !== asset.kind
            || descriptor.mediaType !== asset.mediaType
            || descriptor.byteLength !== asset.byteLength;
        })) {
          fail(
            'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE',
            'One atomic draft transaction must leave exact bytes for every document asset and no orphan bytes.',
          );
        }

        const nextDraft = {
          ...currentDraft,
          revision: currentDraft.revision + 1,
          updatedAt: at,
          document: nextDocument,
        };
        assertMakerV8DraftRecord(nextDraft);
        assertDraftAssetTimeline(nextDraft, rows);
        drafts.put(nextDraft);
        for (const mutation of checkedDeletes) assets.delete([id, mutation.assetId]);
        for (const mutation of checkedUpserts) {
          assets.put(structuredClone(nextAssets.get(mutation.assetId)));
        }
        history.put(structuredClone(nextDraft));
        await putAssetVersions(assetVersions, assetBlobs, nextDraft.revision, rows);
        if (nextDraft.revision > MAX_HISTORY) {
          await pruneHistoryRevision(history, assetVersions, assetBlobs, id, nextDraft.revision - MAX_HISTORY);
        }
        return freeze({ draft: publicDraft(nextDraft), assets: freeze(rows) });
      });
    },

    async listVersions(draftId) {
      const id = safeId(draftId);
      return transact('readonly', async (_drafts, history) => {
        const rows = await requestResult(history.index('byDraft').getAll(id));
        rows.sort((left, right) => right.revision - left.revision);
        return freeze(rows.map(publicDraft));
      });
    },

    async restoreVersion({ draftId, expectedRevision, revision: targetRevision, updatedAt = now() }) {
      const id = safeId(draftId);
      const expected = revision(expectedRevision);
      const target = revision(targetRevision);
      const at = timestamp(updatedAt, 'updatedAt');
      const preflight = await transactAsset(
        'readonly',
        async (drafts, assets, history, assetVersions, assetBlobs) => {
          const current = publicDraft(await requestResult(drafts.get(id)));
          const historical = publicDraft(await requestResult(history.get([id, target])));
          if (!current || !historical) {
            fail('MAKER_V8_DRAFT_VERSION_NOT_FOUND', 'Draft version was not found.');
          }
          if (current.revision !== expected) {
            fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.');
          }
          if (at < current.updatedAt) {
            fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
          }
          const currentRows = orderedAssets(await requestResult(assets.index('byDraft').getAll(id)));
          assertDraftAssetTimeline(current, currentRows);
          const snapshot = await hydratedAssetVersionSnapshot(
            assetVersions,
            assetBlobs,
            id,
            target,
          );
          return freeze({
            current,
            historical,
            currentRows: freeze(currentRows),
            ...snapshot,
          });
        },
      );
      const restoredAssets = assertExactDocumentAssets(
        preflight.historical.document,
        preflight.assets,
        'MAKER_V8_DRAFT_VERSION_ASSET_SNAPSHOT_MISSING',
        'This draft version does not have the exact historical bytes for every Maker asset.',
      );
      assertDraftAssetTimeline(preflight.historical, restoredAssets);
      for (const asset of preflight.currentRows) {
        if (await sha256(fromBase64(asset.bytesBase64)) !== asset.sha256) {
          fail(
            'MAKER_V8_DRAFT_ASSET_HASH_MISMATCH',
            'Current draft asset bytes do not match their durable SHA-256.',
          );
        }
      }
      for (const asset of restoredAssets) {
        if (await sha256(fromBase64(asset.bytesBase64)) !== asset.sha256) {
          fail(
            'MAKER_V8_DRAFT_VERSION_ASSET_HASH_MISMATCH',
            'Historical asset bytes do not match their durable SHA-256.',
          );
        }
        if (asset.createdAt > at) {
          fail('MAKER_V8_DRAFT_TIME_INVALID', 'Historical asset creation time is after the restore time.');
        }
      }
      const checkedVersionJson = canonicalMakerV8Json(preflight.versions);
      const checkedBlobJson = canonicalMakerV8Json(preflight.blobs);
      const checkedCurrentRowsJson = canonicalMakerV8Json(preflight.currentRows);
      const checkedHistoricalJson = canonicalMakerV8Json(preflight.historical);

      return transactAsset('readwrite', async (drafts, assets, history, assetVersions, assetBlobs) => {
        const current = await requestResult(drafts.get(id));
        const historical = await requestResult(history.get([id, target]));
        if (!current || !historical) {
          fail('MAKER_V8_DRAFT_VERSION_NOT_FOUND', 'Draft version was not found.');
        }
        assertMakerV8DraftRecord(current);
        assertMakerV8DraftRecord(historical);
        if (current.revision !== expected) {
          fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.');
        }
        if (at < current.updatedAt) {
          fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
        }
        const durableSnapshot = await hydratedAssetVersionSnapshot(
          assetVersions,
          assetBlobs,
          id,
          target,
        );
        if (canonicalMakerV8Json(durableSnapshot.versions) !== checkedVersionJson
          || canonicalMakerV8Json(durableSnapshot.blobs) !== checkedBlobJson
          || canonicalMakerV8Json(publicDraft(historical)) !== checkedHistoricalJson) {
          fail(
            'MAKER_V8_DRAFT_VERSION_CHANGED',
            'Draft version evidence changed while the restore was being prepared.',
          );
        }
        const currentRows = orderedAssets(await requestResult(assets.index('byDraft').getAll(id)));
        assertDraftAssetTimeline(current, currentRows);
        if (canonicalMakerV8Json(currentRows) !== checkedCurrentRowsJson) {
          fail(
            'MAKER_V8_DRAFT_CHANGED',
            'Current draft assets changed while the restore was being prepared.',
          );
        }
        if (currentRows.some((asset) => asset.updatedAt > at)) {
          fail('MAKER_V8_DRAFT_TIME_INVALID', 'Asset updatedAt moved backwards.');
        }
        const currentById = new Map(currentRows.map((asset) => [asset.assetId, asset]));
        const nextRows = restoredAssets.map((asset) => {
          const currentAsset = currentById.get(asset.assetId) ?? null;
          return publicAsset({
            ...structuredClone(asset),
            revision: currentAsset ? currentAsset.revision + 1 : current.revision + 1,
            createdAt: currentAsset?.createdAt ?? asset.createdAt,
            updatedAt: at,
          });
        });
        assertExactDocumentAssets(
          historical.document,
          nextRows,
          'MAKER_V8_DRAFT_VERSION_ASSET_SNAPSHOT_DRIFT',
          'Historical asset evidence does not match its Maker document.',
        );
        const next = {
          ...current,
          revision: current.revision + 1,
          updatedAt: at,
          document: snapshotDocument(historical.document),
        };
        assertMakerV8DraftRecord(next);
        assertDraftAssetTimeline(next, nextRows);
        for (const key of await requestResult(assets.index('byDraft').getAllKeys(id))) {
          assets.delete(key);
        }
        for (const asset of nextRows) assets.add(structuredClone(asset));
        drafts.put(next);
        history.put(structuredClone(next));
        await putAssetVersions(assetVersions, assetBlobs, next.revision, nextRows);
        if (next.revision > MAX_HISTORY) {
          await pruneHistoryRevision(history, assetVersions, assetBlobs, id, next.revision - MAX_HISTORY);
        }
        return publicDraft(next);
      });
    },

    async delete({ draftId, expectedRevision }) {
      const id = safeId(draftId);
      const expected = revision(expectedRevision);
      return transactAsset('readwrite', async (drafts, assets, history, assetVersions, assetBlobs) => {
        const current = await requestResult(drafts.get(id));
        if (!current) return false;
        assertMakerV8DraftRecord(current);
        if (current.revision !== expected) fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.');
        for (const key of await requestResult(assets.index('byDraft').getAllKeys(id))) assets.delete(key);
        for (const key of await requestResult(history.index('byDraft').getAllKeys(id))) history.delete(key);
        const versionIndex = assetVersions.index('byDraft');
        const keyRequest = versionIndex.getAllKeys(id);
        const rowRequest = versionIndex.getAll(id);
        const [versionKeys, versionRows] = await Promise.all([
          requestResult(keyRequest), requestResult(rowRequest),
        ]);
        for (const key of versionKeys) {
          assetVersions.delete(key);
        }
        await deleteUnreferencedAssetBlobs(
          assetVersions,
          assetBlobs,
          versionRows.map((row) => row.blobId),
        );
        drafts.delete(id);
        return true;
      });
    },

    async export(draftId) {
      const id = safeId(draftId);
      const snapshot = await verifiedAssetSnapshot(id);
      const assetRows = assertExactDocumentAssets(
        snapshot.draft.document,
        snapshot.assets,
        'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE',
        'Draft export requires exact bytes and matching descriptors for every document asset.',
      );
      assertDraftAssetTimeline(snapshot.draft, assetRows);
      const content = { draft: snapshot.draft, assets: assetRows };
      const draftSha256 = await sha256(canonicalMakerV8Json(content));
      return freeze({
        schemaVersion: MAKER_V8_DRAFT_EXPORT_SCHEMA,
        draft: snapshot.draft,
        assets: assetRows,
        draftSha256,
      });
    },

    async importBundle(bundle) {
      const { draft, assets } = await validatedDraftExportBundle(bundle);
      return transactAsset('readwrite', async (
        draftStore, assetStore, historyStore, assetVersions, assetBlobs, draftIdentities,
      ) => {
        if (await requestResult(draftStore.get(draft.draftId))) {
          fail('MAKER_V8_DRAFT_EXISTS', `Draft ${draft.draftId} already exists.`);
        }
        if (await requestResult(draftIdentities.get(draft.draftId))) {
          fail(
            'MAKER_V8_DRAFT_ID_RETIRED',
            `Draft ID ${draft.draftId} has already been used and cannot be imported again.`,
          );
        }
        draftIdentities.add({ draftId: draft.draftId });
        draftStore.add(structuredClone(draft));
        historyStore.add(structuredClone(draft));
        for (const asset of assets) assetStore.add(structuredClone(asset));
        await putAssetVersions(assetVersions, assetBlobs, draft.revision, assets);
        return freeze({ draft, assets: freeze([...assets]) });
      });
    },

    async replaceBundle({ draftId, expectedRevision, bundle, updatedAt = now() }) {
      const targetId = safeId(draftId);
      const expected = revision(expectedRevision);
      const at = timestamp(updatedAt, 'updatedAt');
      const imported = await validatedDraftExportBundle(bundle);
      const snapshot = await verifiedAssetSnapshot(targetId);
      if (snapshot.draft.revision !== expected) {
        fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.');
      }
      if (at < snapshot.draft.updatedAt || at < latestAssetTime(snapshot.assets)) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt precedes durable draft evidence.');
      }
      return transactAsset('readwrite', async (
        draftStore, assetStore, historyStore, assetVersions, assetBlobs,
      ) => {
        const current = await requestResult(draftStore.get(targetId));
        if (!current) fail('MAKER_V8_DRAFT_NOT_FOUND', `Draft ${targetId} does not exist.`);
        assertMakerV8DraftRecord(current);
        if (current.revision !== expected) {
          fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.');
        }
        if (at < current.updatedAt) fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
        const currentRows = await requestResult(assetStore.index('byDraft').getAll(targetId));
        assertVerifiedSnapshot(current, currentRows, snapshot);
        const currentAssets = new Map(orderedAssets(currentRows)
          .map((asset) => [asset.assetId, asset]));
        const reboundAssets = imported.assets.map((asset) => {
          const previous = currentAssets.get(asset.assetId) ?? null;
          return publicAsset({
            ...structuredClone(asset),
            draftId: targetId,
            revision: previous ? previous.revision + 1 : current.revision + 1,
            createdAt: previous?.createdAt ?? at,
            updatedAt: at,
          });
        });
        const next = {
          ...current,
          revision: current.revision + 1,
          updatedAt: at,
          document: snapshotDocument(imported.draft.document),
        };
        assertMakerV8DraftRecord(next);
        assertDraftAssetTimeline(next, reboundAssets);
        for (const key of await requestResult(assetStore.index('byDraft').getAllKeys(targetId))) {
          assetStore.delete(key);
        }
        for (const asset of reboundAssets) assetStore.add(structuredClone(asset));
        draftStore.put(next);
        historyStore.put(structuredClone(next));
        await putAssetVersions(assetVersions, assetBlobs, next.revision, reboundAssets);
        if (next.revision > MAX_HISTORY) {
          await pruneHistoryRevision(
            historyStore,
            assetVersions,
            assetBlobs,
            targetId,
            next.revision - MAX_HISTORY,
          );
        }
        return freeze({ draft: publicDraft(next), assets: freeze(reboundAssets) });
      });
    },

    async upsertAsset({
      draftId, expectedDraftRevision, assetId, kind, mediaType, bytesBase64,
      expectedAssetRevision = null, updatedAt = now(),
    }) {
      const checkedDraftId = safeId(draftId);
      const checkedAssetId = safeId(assetId, 'assetId');
      const expectedDraft = revision(expectedDraftRevision);
      const at = timestamp(updatedAt, 'asset.updatedAt');
      const bytes = canonicalBase64(bytesBase64, 'draft asset bytes');
      const assetSha256 = await sha256(bytes);
      if (typeof kind !== 'string' || !kind || typeof mediaType !== 'string' || !MEDIA_TYPE.test(mediaType)) {
        fail('MAKER_V8_DRAFT_ASSET_INVALID', 'Draft asset kind and media type are required.');
      }
      const snapshot = await verifiedAssetSnapshot(checkedDraftId);
      if (snapshot.draft.revision !== expectedDraft) {
        fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.');
      }
      if (at < snapshot.draft.updatedAt) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
      }
      if (at < latestAssetTime(snapshot.assets)) {
        fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt precedes durable asset evidence.');
      }
      return transactAsset('readwrite', async (drafts, assets, history, assetVersions, assetBlobs) => {
        const currentDraft = await requestResult(drafts.get(checkedDraftId));
        if (!currentDraft) fail('MAKER_V8_DRAFT_NOT_FOUND', `Draft ${checkedDraftId} does not exist.`);
        assertMakerV8DraftRecord(currentDraft);
        if (currentDraft.revision !== expectedDraft) {
          fail('MAKER_V8_DRAFT_CAS_MISMATCH', 'Draft changed in another tab.');
        }
        if (at < currentDraft.updatedAt) fail('MAKER_V8_DRAFT_TIME_INVALID', 'updatedAt moved backwards.');
        const durableRows = await requestResult(assets.index('byDraft').getAll(checkedDraftId));
        assertVerifiedSnapshot(currentDraft, durableRows, snapshot);
        const document = snapshotDocument(currentDraft.document);
        const descriptor = { id: checkedAssetId, kind, mediaType, byteLength: bytes.length };
        const descriptorIndex = document.assets.findIndex((asset) => asset.id === checkedAssetId);
        if (descriptorIndex < 0) document.assets.push(descriptor);
        else document.assets[descriptorIndex] = descriptor;
        assertMakerV8Document(document, { mode: 'draft' });

        const currentAsset = await requestResult(assets.get([checkedDraftId, checkedAssetId]));
        if (currentAsset) publicAsset(currentAsset);
        if ((currentAsset?.revision ?? null) !== expectedAssetRevision) {
          fail('MAKER_V8_DRAFT_ASSET_CAS_MISMATCH', 'Draft asset changed in another tab.');
        }
        const nextDraft = {
          ...currentDraft,
          revision: currentDraft.revision + 1,
          updatedAt: at,
          document,
        };
        const nextAsset = {
          schemaVersion: MAKER_V8_DRAFT_ASSET_SCHEMA,
          draftId: checkedDraftId,
          assetId: checkedAssetId,
          revision: currentAsset ? currentAsset.revision + 1 : currentDraft.revision + 1,
          createdAt: currentAsset?.createdAt ?? at,
          updatedAt: at,
          kind,
          mediaType,
          bytesBase64,
          byteLength: bytes.length,
          sha256: assetSha256,
        };
        assertMakerV8DraftRecord(nextDraft);
        const checkedAsset = publicAsset(nextAsset);
        const currentRows = orderedAssets(durableRows);
        const nextRows = currentRows
          .filter((asset) => asset.assetId !== checkedAsset.assetId)
          .concat([checkedAsset]);
        assertExactDocumentAssets(
          nextDraft.document,
          nextRows,
          'MAKER_V8_DRAFT_ASSET_SET_INCOMPLETE',
          'An asset save must leave exact durable bytes for every Maker asset.',
        );
        assertDraftAssetTimeline(nextDraft, nextRows);
        drafts.put(nextDraft);
        assets.put(structuredClone(checkedAsset));
        history.put(structuredClone(nextDraft));
        await putAssetVersions(assetVersions, assetBlobs, nextDraft.revision, nextRows);
        if (nextDraft.revision > MAX_HISTORY) {
          await pruneHistoryRevision(
            history,
            assetVersions,
            assetBlobs,
            checkedDraftId,
            nextDraft.revision - MAX_HISTORY,
          );
        }
        return freeze({ draft: publicDraft(nextDraft), asset: checkedAsset });
      });
    },

    async loadAsset(draftId, assetId) {
      const key = [safeId(draftId), safeId(assetId, 'assetId')];
      return transactAsset('readonly', async (_drafts, assets) => (
        publicAsset(await requestResult(assets.get(key)))
      ));
    },

    async listAssets(draftId) {
      const checkedDraftId = safeId(draftId);
      return transactAsset('readonly', async (_drafts, assets) => {
        const values = await requestResult(assets.index('byDraft').getAll(checkedDraftId));
        values.sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
        return freeze(values.map(publicAsset));
      });
    },

    close() {
      databasePromise?.then((database) => database.close()).catch(() => {});
      closed = true;
      databasePromise = null;
    },
  });
}
