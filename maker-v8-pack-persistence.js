import {
  assertMakerV8PackDraftV8,
  canonicalMakerV8PackJson,
} from './maker-v8-pack-controller.js';
import { fromBase64, toBase64 } from '@mysten/sui/utils';

export const MAKER_V8_PACK_PERSISTENCE_SCHEMA =
  'animacraft.maker-v8-pack-persistence.v1';
export const MAKER_V8_PACK_DATABASE = 'animacraft-maker-v8-pack-drafts-v1';
export const MAKER_V8_PACK_ASSET_SCHEMA = 'animacraft.maker-v8-pack-asset.v1';

const DATABASE_VERSION = 1;
const DRAFT_STORE = 'packDrafts';
const ASSET_STORE = 'packAssets';
const SAFE_DRAFT_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MEDIA_TYPE = /^(?:image\/png|image\/webp)$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export class MakerV8PackPersistenceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MakerV8PackPersistenceError';
    this.code = code;
    if (details !== undefined) this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new MakerV8PackPersistenceError(code, message, details);
}

function exactDraftId(value) {
  if (typeof value !== 'string' || !SAFE_DRAFT_ID.test(value)) {
    fail('MAKER_V8_PACK_DRAFT_ID_INVALID', 'Pack draftId must be one safe lowercase identifier.');
  }
  return value;
}

function exactRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('MAKER_V8_PACK_REVISION_INVALID', `${label} must be a positive safe integer.`);
  }
  return value;
}

function cloneDraft(value) {
  return assertMakerV8PackDraftV8(structuredClone(value));
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

function strictTransaction(database, stores, mode) {
  if (mode !== 'readwrite') return database.transaction(stores, mode);
  try {
    return database.transaction(stores, mode, { durability: 'strict' });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return database.transaction(stores, mode);
  }
}

function sameDraft(left, right) {
  return canonicalMakerV8PackJson(left) === canonicalMakerV8PackJson(right);
}

function exactAssetId(value) {
  if (typeof value !== 'string' || !SAFE_ASSET_ID.test(value)) {
    fail('MAKER_V8_PACK_ASSET_ID_INVALID', 'Pack assetId must be one safe bounded key.');
  }
  return value;
}

function canonicalAssetBytes(value) {
  try {
    if (typeof value !== 'string') throw new Error('shape');
    const bytes = fromBase64(value);
    if (bytes.length < 1 || bytes.length > MAX_ASSET_BYTES || toBase64(bytes) !== value) {
      throw new Error('canonical');
    }
    return bytes;
  } catch {
    fail('MAKER_V8_PACK_ASSET_BYTES_INVALID', 'Pack asset bytes must be canonical Base64 from 1 byte to 8 MiB.');
  }
}

async function sha256(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cloneAsset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('MAKER_V8_PACK_ASSET_INVALID', 'Pack asset record must be a plain record.');
  }
  const fields = [
    'schemaVersion', 'draftId', 'assetId', 'revision', 'createdAt', 'updatedAt',
    'mediaType', 'bytesBase64', 'byteLength', 'sha256',
  ];
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])
    || value.schemaVersion !== MAKER_V8_PACK_ASSET_SCHEMA) {
    fail('MAKER_V8_PACK_ASSET_INVALID', 'Pack asset record has fields outside its exact Fresh-v8 schema.');
  }
  exactDraftId(value.draftId);
  exactAssetId(value.assetId);
  exactRevision(value.revision, 'asset.revision');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt
    || !MEDIA_TYPE.test(value.mediaType)
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || value.byteLength > MAX_ASSET_BYTES || !HASH.test(value.sha256)) {
    fail('MAKER_V8_PACK_ASSET_INVALID', 'Pack asset record metadata is invalid.');
  }
  const bytes = canonicalAssetBytes(value.bytesBase64);
  if (bytes.length !== value.byteLength) {
    fail('MAKER_V8_PACK_ASSET_INVALID', 'Pack asset byte length differs from its exact bytes.');
  }
  const result = structuredClone(value);
  Object.values(result).forEach((entry) => {
    if (entry && typeof entry === 'object') Object.freeze(entry);
  });
  return Object.freeze(result);
}

export function createMakerV8PackPersistenceV8(
  indexedDB = globalThis.indexedDB,
  { databaseName = MAKER_V8_PACK_DATABASE } = {},
) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    fail('MAKER_V8_PACK_INDEXEDDB_REQUIRED', 'Pack Studio requires IndexedDB.');
  }
  if (typeof databaseName !== 'string' || !databaseName || databaseName.length > 256) {
    fail('MAKER_V8_PACK_DATABASE_NAME_INVALID', 'Pack databaseName is invalid.');
  }
  let databasePromise = null;
  let closed = false;

  const open = () => {
    if (databasePromise && !closed) return databasePromise;
    closed = false;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DRAFT_STORE)) {
          const store = request.result.createObjectStore(DRAFT_STORE, { keyPath: 'draftId' });
          store.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
        }
        if (!request.result.objectStoreNames.contains(ASSET_STORE)) {
          const assets = request.result.createObjectStore(ASSET_STORE, { keyPath: ['draftId', 'assetId'] });
          assets.createIndex('byDraft', 'draftId', { unique: false });
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
      request.onerror = () => reject(request.error || new Error('Pack database failed to open.'));
      request.onblocked = () => reject(new MakerV8PackPersistenceError(
        'MAKER_V8_PACK_DATABASE_BLOCKED',
        'Another tab is blocking the Pack Studio database.',
      ));
    });
    return databasePromise;
  };

  const transact = async (stores, mode, operation) => {
    const database = await open();
    const transaction = strictTransaction(database, stores, mode);
    const done = transactionDone(transaction);
    let result;
    try {
      result = await operation(transaction);
      if (mode === 'readwrite') await done;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
    return result;
  };

  return Object.freeze({
    schemaVersion: MAKER_V8_PACK_PERSISTENCE_SCHEMA,
    capabilities: Object.freeze({ durable: true, atomicCas: true }),

    async create(value) {
      const draft = cloneDraft(value);
      return transact([DRAFT_STORE], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(DRAFT_STORE);
        if (await requestResult(store.get(draft.draftId))) {
          fail('MAKER_V8_PACK_DRAFT_EXISTS', `Pack draft ${draft.draftId} already exists.`);
        }
        store.add(structuredClone(draft));
        return cloneDraft(draft);
      });
    },

    async load(draftId) {
      const value = await transact([DRAFT_STORE], 'readonly', (transaction) => (
        requestResult(transaction.objectStore(DRAFT_STORE).get(exactDraftId(draftId)))
      ));
      return value ? cloneDraft(value) : null;
    },

    async list() {
      const values = await transact([DRAFT_STORE], 'readonly', (transaction) => (
        requestResult(transaction.objectStore(DRAFT_STORE).getAll())
      ));
      return Object.freeze(values.map(cloneDraft).sort((left, right) => (
        right.updatedAt - left.updatedAt || left.draftId.localeCompare(right.draftId)
      )));
    },

    async compareAndSwap({ draftId, expectedRevision, next } = {}) {
      const checkedId = exactDraftId(draftId);
      const checkedRevision = exactRevision(expectedRevision, 'expectedRevision');
      const successor = cloneDraft(next);
      if (successor.draftId !== checkedId || successor.revision !== checkedRevision + 1) {
        fail('MAKER_V8_PACK_DRAFT_CAS_INVALID', 'Pack CAS successor identity or revision is invalid.');
      }
      return transact([DRAFT_STORE], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(DRAFT_STORE);
        const current = await requestResult(store.get(checkedId));
        if (!current) fail('MAKER_V8_PACK_DRAFT_NOT_FOUND', `Pack draft ${checkedId} was not found.`);
        const checkedCurrent = cloneDraft(current);
        if (checkedCurrent.revision !== checkedRevision) {
          fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed in another tab.', {
            expectedRevision: checkedRevision,
            actualRevision: checkedCurrent.revision,
          });
        }
        if (successor.createdAt !== checkedCurrent.createdAt
          || successor.updatedAt < checkedCurrent.updatedAt) {
          fail('MAKER_V8_PACK_DRAFT_CAS_INVALID', 'Pack CAS changed immutable creation time or moved updatedAt backwards.');
        }
        store.put(structuredClone(successor));
        return cloneDraft(successor);
      });
    },

    async delete({ draftId, expectedRevision } = {}) {
      const checkedId = exactDraftId(draftId);
      const checkedRevision = exactRevision(expectedRevision, 'expectedRevision');
      return transact([DRAFT_STORE, ASSET_STORE], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(DRAFT_STORE);
        const current = await requestResult(store.get(checkedId));
        if (!current) return false;
        const draft = cloneDraft(current);
        if (draft.revision !== checkedRevision) {
          fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed before deletion.', {
            expectedRevision: checkedRevision,
            actualRevision: draft.revision,
          });
        }
        if (draft.publication.status !== 'UNPREPARED') {
          fail('MAKER_V8_PACK_DRAFT_DELETE_FORBIDDEN', 'A Pack with durable publication evidence cannot be deleted.');
        }
        store.delete(checkedId);
        const assetStore = transaction.objectStore(ASSET_STORE);
        const index = assetStore.index('byDraft');
        const keys = await requestResult(index.getAllKeys(checkedId));
        for (const key of keys) assetStore.delete(key);
        return true;
      });
    },

    async loadAsset(draftId, assetId) {
      const key = [exactDraftId(draftId), exactAssetId(assetId)];
      const value = await transact([ASSET_STORE], 'readonly', (transaction) => (
        requestResult(transaction.objectStore(ASSET_STORE).get(key))
      ));
      if (!value) return null;
      const asset = cloneAsset(value);
      if (await sha256(canonicalAssetBytes(asset.bytesBase64)) !== asset.sha256) {
        fail('MAKER_V8_PACK_ASSET_HASH_MISMATCH', 'Persisted Pack asset SHA-256 is invalid.');
      }
      return asset;
    },

    async listAssets(draftId) {
      const checkedId = exactDraftId(draftId);
      const values = await transact([ASSET_STORE], 'readonly', (transaction) => (
        requestResult(transaction.objectStore(ASSET_STORE).index('byDraft').getAll(checkedId))
      ));
      const assets = [];
      for (const value of values) {
        const asset = cloneAsset(value);
        if (await sha256(canonicalAssetBytes(asset.bytesBase64)) !== asset.sha256) {
          fail('MAKER_V8_PACK_ASSET_HASH_MISMATCH', `Persisted Pack asset ${asset.assetId} SHA-256 is invalid.`);
        }
        assets.push(asset);
      }
      assets.sort((left, right) => left.assetId.localeCompare(right.assetId));
      return Object.freeze(assets);
    },

    async upsertAsset({
      draftId,
      expectedRevision,
      next,
      assetId,
      mediaType,
      bytesBase64,
      expectedAssetRevision = null,
      updatedAt,
    } = {}) {
      const checkedId = exactDraftId(draftId);
      const checkedAssetId = exactAssetId(assetId);
      const checkedRevision = exactRevision(expectedRevision, 'expectedRevision');
      const successor = cloneDraft(next);
      if (successor.draftId !== checkedId || successor.revision !== checkedRevision + 1
        || !Number.isSafeInteger(updatedAt) || updatedAt < successor.createdAt
        || successor.updatedAt !== updatedAt || !MEDIA_TYPE.test(mediaType)) {
        fail('MAKER_V8_PACK_ASSET_CAS_INVALID', 'Pack asset successor or metadata is invalid.');
      }
      if (expectedAssetRevision !== null) exactRevision(expectedAssetRevision, 'expectedAssetRevision');
      const bytes = canonicalAssetBytes(bytesBase64);
      const hash = await sha256(bytes);
      const descriptors = successor.document.styles
        .filter((style) => style.asset.assetId === checkedAssetId)
        .map((style) => style.asset);
      if (descriptors.length !== 1
        || descriptors[0].mediaType !== mediaType
        || descriptors[0].byteLength !== bytes.length
        || descriptors[0].sha256 !== hash
        || descriptors[0].contentCommitment !== hash) {
        fail('MAKER_V8_PACK_ASSET_DESCRIPTOR_DRIFT', 'Pack document asset descriptor differs from the exact persisted bytes.');
      }
      return transact([DRAFT_STORE, ASSET_STORE], 'readwrite', async (transaction) => {
        const draftStore = transaction.objectStore(DRAFT_STORE);
        const assetStore = transaction.objectStore(ASSET_STORE);
        const currentRaw = await requestResult(draftStore.get(checkedId));
        if (!currentRaw) fail('MAKER_V8_PACK_DRAFT_NOT_FOUND', `Pack draft ${checkedId} was not found.`);
        const current = cloneDraft(currentRaw);
        if (current.revision !== checkedRevision) {
          fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack draft changed before asset persistence.', {
            expectedRevision: checkedRevision,
            actualRevision: current.revision,
          });
        }
        const priorRaw = await requestResult(assetStore.get([checkedId, checkedAssetId]));
        const prior = priorRaw ? cloneAsset(priorRaw) : null;
        if ((prior === null) !== (expectedAssetRevision === null)
          || (prior && prior.revision !== expectedAssetRevision)) {
          fail('MAKER_V8_PACK_ASSET_CAS_MISMATCH', 'Pack asset changed in another tab.');
        }
        const asset = cloneAsset({
          schemaVersion: MAKER_V8_PACK_ASSET_SCHEMA,
          draftId: checkedId,
          assetId: checkedAssetId,
          revision: (prior?.revision ?? 0) + 1,
          createdAt: prior?.createdAt ?? updatedAt,
          updatedAt,
          mediaType,
          bytesBase64,
          byteLength: bytes.length,
          sha256: hash,
        });
        draftStore.put(structuredClone(successor));
        assetStore.put(structuredClone(asset));
        return Object.freeze({ draft: cloneDraft(successor), asset });
      });
    },

    async copyAssets({ draftId, expectedRevision, next, copies } = {}) {
      const checkedId = exactDraftId(draftId);
      const checkedRevision = exactRevision(expectedRevision, 'expectedRevision');
      const successor = cloneDraft(next);
      if (successor.draftId !== checkedId || successor.revision !== checkedRevision + 1
        || !Array.isArray(copies) || !copies.length || copies.length > successor.document.styles.length) {
        fail('MAKER_V8_PACK_ASSET_CAS_INVALID', 'Invalid Pack copy successor.');
      }
      const prepared = [];
      const ids = new Set();
      for (const copy of copies) {
        const assetId = exactAssetId(copy.assetId);
        if (ids.has(assetId)) fail('MAKER_V8_PACK_ASSET_CAS_INVALID', 'Duplicate copied asset.');
        ids.add(assetId);
        const source = await this.loadAsset(checkedId, exactAssetId(copy.sourceAssetId));
        const descriptor = successor.document.styles.find(row => row.asset.assetId === assetId)?.asset;
        if (!source || !descriptor || descriptor.sha256 !== source.sha256
          || descriptor.contentCommitment !== source.sha256 || descriptor.byteLength !== source.byteLength
          || descriptor.mediaType !== source.mediaType) fail('MAKER_V8_PACK_ASSET_DESCRIPTOR_DRIFT', 'Copied asset does not match source bytes.');
        prepared.push({ source, asset: cloneAsset({ ...source, assetId, revision: 1,
          createdAt: successor.updatedAt, updatedAt: successor.updatedAt }) });
      }
      return transact([DRAFT_STORE, ASSET_STORE], 'readwrite', async transaction => {
        const drafts = transaction.objectStore(DRAFT_STORE), assets = transaction.objectStore(ASSET_STORE);
        const current = await requestResult(drafts.get(checkedId));
        if (!current || current.revision !== checkedRevision) fail('MAKER_V8_PACK_DRAFT_CAS_MISMATCH', 'Pack changed before copying.');
        for (const { source, asset } of prepared) {
          const actual = await requestResult(assets.get([checkedId, source.assetId]));
          if (!actual || actual.revision !== source.revision || actual.sha256 !== source.sha256 || actual.bytesBase64 !== source.bytesBase64
            || await requestResult(assets.get([checkedId, asset.assetId]))) {
            fail('MAKER_V8_PACK_ASSET_CAS_MISMATCH', 'Pack artwork changed before copying.');
          }
        }
        for (const { asset } of prepared) assets.put(structuredClone(asset));
        drafts.put(structuredClone(successor));
        return cloneDraft(successor);
      });
    },

    async verify(draftId) {
      const first = await this.load(draftId);
      if (!first) return null;
      const second = await this.load(draftId);
      if (!second || !sameDraft(first, second)) {
        fail('MAKER_V8_PACK_DURABLE_REREAD_FAILED', 'Pack draft changed across two cold reads.');
      }
      return first;
    },

    close() {
      if (!databasePromise || closed) return;
      databasePromise.then((database) => database.close()).catch(() => {});
      closed = true;
      databasePromise = null;
    },
  });
}
