import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createMakerV8NativeContentStoreV8 } from '../maker-v8-native-content-store.js';

const request = value => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});
function setup(indexedDB = new IDBFactory()) {
  return { indexedDB, store: createMakerV8NativeContentStoreV8({ indexedDB,
    requirePersistentStorage: async () => true }) };
}

test('private native content survives a fresh store without plaintext/DEK in database record bytes', async () => {
  const { indexedDB, store } = setup();
  const data = { text: '私密 Soul 内容', material: { dek: 'SENSITIVE_SECRET_KEY' } };
  assert.equal(await store.load('scope/test'), null);
  const saved = await store.create('scope/test', data);
  assert.deepEqual(saved, { revision: 1, data });
  const database = await request(indexedDB.open('animacraft-native-content-v1', 1));
  const raw = await request(database.transaction('records').objectStore('records').get('scope/test'));
  assert.deepEqual(Object.keys(raw).sort(), ['ciphertext', 'iv', 'revision']);
  assert.equal(new TextDecoder().decode(raw.ciphertext).includes(data.material.dek), false);
  const wrappingKey = await request(database.transaction('keys').objectStore('keys').get('wrapping'));
  assert.equal(wrappingKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', wrappingKey));
  await store.close();
  const reopened = setup(indexedDB).store;
  assert.deepEqual(await reopened.load('scope/test'), saved);
  await reopened.compareAndSwap('scope/test', 1, { ...data, actionId: 'exact-action' });
  assert.equal((await reopened.load('scope/test')).revision, 2);
  await reopened.close(); database.close();
});

test('concurrent creates/CAS choose one encrypted recovery record and reject overwrite', async () => {
  const { indexedDB, store } = setup();
  const other = setup(indexedDB).store;
  const results = await Promise.allSettled([
    store.create('scope/race', { value: 'first' }), other.create('scope/race', { value: 'second' }),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'MAKER_V8_NATIVE_STORE_CONFLICT');
  assert.deepEqual(await other.load('scope/race'), await store.load('scope/race'));
  await store.compareAndSwap('scope/race', 1, { value: 'next' });
  await assert.rejects(other.compareAndSwap('scope/race', 1, { value: 'stale' }), { code: 'MAKER_V8_NATIVE_STORE_CONFLICT' });
  await store.close(); await other.close();
});

test('encrypted recovery binds record key and revision; missing persistence prevents any private write', async () => {
  const { indexedDB, store } = setup();
  await store.create('scope/original', { secret: 'private' });
  const database = await request(indexedDB.open('animacraft-native-content-v1', 1));
  const raw = await request(database.transaction('records').objectStore('records').get('scope/original'));
  await request(database.transaction('records', 'readwrite').objectStore('records').put(raw, 'scope/swapped'));
  await assert.rejects(store.load('scope/swapped'), { code: 'MAKER_V8_NATIVE_STORE_INTEGRITY_FAILED' });
  raw.revision++;
  await request(database.transaction('records', 'readwrite').objectStore('records').put(raw, 'scope/original'));
  await assert.rejects(store.load('scope/original'), { code: 'MAKER_V8_NATIVE_STORE_INTEGRITY_FAILED' });
  const unavailable = createMakerV8NativeContentStoreV8({ indexedDB });
  await assert.rejects(unavailable.create('scope/no-persistence', {}), { code: 'MAKER_V8_NATIVE_STORE_PERSISTENCE_REQUIRED' });
  assert.equal(await unavailable.load('scope/no-persistence'), null);
  await unavailable.close(); await store.close(); database.close();
});
