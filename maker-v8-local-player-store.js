import { sha256 } from '@noble/hashes/sha2.js';

const DATABASE = 'animacraft-maker-v8-local-player-checkpoints';
const STORE = 'checkpoints';
const SCHEMA = 'animacraft.maker-v8-local-player-checkpoint-record.v1';
const HASH = /^[0-9a-f]{64}$/;
const BINDING_KEYS = ['draftId', 'draftRevision', 'documentHash', 'assetHash'];
const MAX_BYTES = 32 * 1024 * 1024 + 1024;
const encoder = new TextEncoder();
const canonical = (value) => JSON.stringify((function ordered(item) {
  if (Array.isArray(item)) return item.map(ordered);
  if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])]));
  return item;
})(value));
const hash = (text) => [...sha256(encoder.encode(text))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
function fail(code, message) { throw Object.assign(new Error(message), { code, layer: 'DRAFT' }); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    fail('LOCAL_PLAYER_STORE_INVALID', 'Expected exact local checkpoint fields.');
  }
}
function bindingKey(binding) {
  exact(binding, BINDING_KEYS);
  if (typeof binding.draftId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(binding.draftId)
    || !Number.isSafeInteger(binding.draftRevision) || binding.draftRevision < 1
    || typeof binding.documentHash !== 'string' || !HASH.test(binding.documentHash)
    || typeof binding.assetHash !== 'string' || !HASH.test(binding.assetHash)) {
    fail('LOCAL_PLAYER_STORE_INVALID', 'Local checkpoint source binding is invalid.');
  }
  return hash(JSON.stringify(BINDING_KEYS.map((key) => binding[key])));
}
function payloadBinding(checkpoint) {
  if (typeof checkpoint !== 'string' || checkpoint.length > MAX_BYTES || encoder.encode(checkpoint).length > MAX_BYTES) {
    fail('LOCAL_PLAYER_STORE_INVALID', 'Local checkpoint exceeds its byte limit.');
  }
  let outer;
  let inner;
  try { outer = JSON.parse(checkpoint); inner = JSON.parse(outer.checkpoint); } catch {
    fail('LOCAL_PLAYER_STORE_INVALID', 'Local checkpoint JSON is invalid.');
  }
  exact(outer, ['schemaVersion', 'assetHash', 'checkpoint']);
  exact(inner, ['schemaVersion', 'draftId', 'draftRevision', 'documentHash', 'recipe', 'profile', 'soulDocuments',
    ...(inner && Object.hasOwn(inner, 'imageExport') ? ['imageExport'] : [])]);
  if (outer.schemaVersion !== 'animacraft.maker-v8-local-player-bundle-checkpoint.v1'
    || inner.schemaVersion !== 'animacraft.maker-v8-local-player-checkpoint.v1'
    || typeof outer.checkpoint !== 'string' || encoder.encode(outer.checkpoint).length > 16 * 1024 * 1024
    || canonical(outer) !== checkpoint || canonical(inner) !== outer.checkpoint) {
    fail('LOCAL_PLAYER_STORE_INVALID', 'Only local bundle checkpoints may be stored.');
  }
  if (Object.hasOwn(inner, 'imageExport')) {
    exact(inner.imageExport, ['sizeMode', 'transparent']);
    if (!['standard', 'original'].includes(inner.imageExport.sizeMode) || typeof inner.imageExport.transparent !== 'boolean') {
      fail('LOCAL_PLAYER_STORE_INVALID', 'Invalid local image export preference.');
    }
  }
  return { draftId: inner.draftId, draftRevision: inner.draftRevision,
    documentHash: inner.documentHash, assetHash: outer.assetHash };
}
function checkedRow(value, key) {
  exact(value, ['schemaVersion', 'key', 'revision', 'contentHash', 'checkpoint']);
  const payloadKey = bindingKey(payloadBinding(value.checkpoint));
  if (value.schemaVersion !== SCHEMA || value.key !== key
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.contentHash !== 'string' || !HASH.test(value.contentHash) || hash(value.checkpoint) !== value.contentHash
    || payloadKey !== key) {
    fail('LOCAL_PLAYER_STORE_CORRUPT', 'Stored local checkpoint failed integrity validation.');
  }
  return Object.freeze(structuredClone(value));
}

/** Separate local draft checkpoint storage. Semantic restoration stays in the
 * source/asset-checked bridge; storage records never constitute chain authority.
 */
export function createMakerV8LocalPlayerStore(indexedDB, { databaseName = DATABASE } = {}) {
  if (typeof indexedDB?.open !== 'function') throw new TypeError('Local checkpoint storage requires IndexedDB.');
  let closed = false;
  let connection = null;
  let opening = null;
  const check = () => { if (closed) fail('LOCAL_PLAYER_STORE_CLOSED', 'Local checkpoint storage is closed.'); };
  const database = async () => {
    check();
    if (connection) return connection;
    if (!opening) opening = new Promise((resolve, reject) => {
      let rejected = false;
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'key' }); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { rejected = true; reject(new Error('Local checkpoint database is blocked.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (closed || rejected) { db.close(); reject(new Error('Local checkpoint database opening was cancelled.')); return; }
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) { connection = null; opening = null; } };
        resolve(db);
      };
    }).catch((error) => { opening = null; throw error; });
    return opening;
  };
  const transaction = async (mode, key, operation) => {
    const db = await database();
    check();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      let failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('Local checkpoint transaction aborted.'));
      tx.onerror = () => {};
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          check();
          const current = request.result === undefined ? null : checkedRow(request.result, key);
          result = operation(current, store);
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  };
  return Object.freeze({
    async load(binding) {
      check();
      const key = bindingKey(binding);
      return transaction('readonly', key, (current) => current);
    },
    async save(input = {}) {
      check();
      exact(input, ['binding', 'checkpoint', 'expected']);
      const { binding, checkpoint, expected } = input;
      const key = bindingKey(binding);
      if (bindingKey(payloadBinding(checkpoint)) !== key) fail('LOCAL_PLAYER_STORE_INVALID', 'Checkpoint belongs to a different local source.');
      const contentHash = hash(checkpoint);
      let expectedRevision = null;
      let expectedHash = null;
      if (expected !== null) {
        exact(expected, ['revision', 'contentHash']);
        if (!Number.isSafeInteger(expected.revision) || expected.revision < 1 || typeof expected.contentHash !== 'string' || !HASH.test(expected.contentHash)) fail('LOCAL_PLAYER_STORE_INVALID', 'Expected checkpoint revision is invalid.');
        expectedRevision = expected.revision;
        expectedHash = expected.contentHash;
      }
      return transaction('readwrite', key, (current, store) => {
        if ((current?.revision ?? null) !== expectedRevision || (current?.contentHash ?? null) !== expectedHash) {
          fail('LOCAL_PLAYER_STORE_CAS_CONFLICT', 'Another local Player saved a different checkpoint.');
        }
        if (current?.checkpoint === checkpoint) return current;
        const revision = (current?.revision ?? 0) + 1;
        if (!Number.isSafeInteger(revision)) fail('LOCAL_PLAYER_STORE_INVALID', 'Local checkpoint revision exhausted.');
        const next = Object.freeze({ schemaVersion: SCHEMA, key, revision, contentHash, checkpoint });
        store.put(next);
        return next;
      });
    },
    close() { closed = true; connection?.close(); connection = null; },
  });
}
