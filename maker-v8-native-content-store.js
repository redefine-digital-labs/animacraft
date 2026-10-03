// Browser-private native content recovery. Neither plaintext nor raw DEKs are
// written into the public Walrus/Player journals. A non-extractable browser key
// wraps each record; same-origin script access remains a browser trust boundary.
const DATABASE = 'animacraft-native-content-v1';
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const request = value => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error);
});
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = tx.onerror = () => reject(new Error('Native content storage transaction failed.'));
});
function fail(code) { throw Object.assign(new Error(code), { code }); }
function key(value) {
  if (typeof value !== 'string' || !/^[a-z0-9:/._-]{1,400}$/.test(value)) fail('MAKER_V8_NATIVE_STORE_KEY_INVALID');
  return value;
}

export function createMakerV8NativeContentStoreV8({ indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto, requirePersistentStorage } = {}) {
  let database;
  async function db() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!indexedDB?.open || !crypto?.subtle) return reject(new Error('Native content recovery storage is unavailable.'));
      const opening = indexedDB.open(DATABASE, 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('keys');
        opening.result.createObjectStore('records');
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    return database;
  }
  async function master() {
    const database = await db();
    const read = database.transaction('keys', 'readonly');
    const finished = done(read);
    const prior = await request(read.objectStore('keys').get('wrapping'));
    await finished;
    if (prior) return prior;
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const write = database.transaction('keys', 'readwrite', { durability: 'strict' });
    const persisted = done(write);
    const winner = await request(write.objectStore('keys').get('wrapping'));
    if (!winner) write.objectStore('keys').put(candidate, 'wrapping');
    await persisted;
    return winner ?? candidate;
  }
  async function unwrap(recordKey, value) {
    if (value == null) return null;
    const masterKey = await master();
    let plaintext;
    try {
      plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM',
        iv: value.iv, additionalData: enc.encode(`${recordKey}:${value.revision}`) }, masterKey, value.ciphertext));
      return { revision: value.revision, data: JSON.parse(dec.decode(plaintext)) };
    } catch { fail('MAKER_V8_NATIVE_STORE_INTEGRITY_FAILED'); }
    finally { plaintext?.fill(0); }
  }
  async function load(recordKey) {
    key(recordKey);
    const database = await db();
    const tx = database.transaction('records', 'readonly');
    const finished = done(tx);
    const record = await request(tx.objectStore('records').get(recordKey));
    await finished;
    return unwrap(recordKey, record);
  }
  async function write(recordKey, expectedRevision, data) {
    key(recordKey);
    if (typeof requirePersistentStorage !== 'function') fail('MAKER_V8_NATIVE_STORE_PERSISTENCE_REQUIRED');
    const serialized = JSON.stringify(data);
    if (typeof serialized !== 'string' || enc.encode(serialized).length > 2 * 1024 * 1024
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('MAKER_V8_NATIVE_STORE_RECORD_INVALID');
    await requirePersistentStorage();
    const masterKey = await master();
    const revision = expectedRevision + 1;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = enc.encode(serialized);
    let ciphertext;
    try { ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: enc.encode(`${recordKey}:${revision}`) }, masterKey, plaintext); }
    finally { plaintext.fill(0); }
    const database = await db();
    const tx = database.transaction('records', 'readwrite', { durability: 'strict' });
    const finished = done(tx);
    const records = tx.objectStore('records');
    const existing = await request(records.get(recordKey));
    if ((existing?.revision ?? 0) !== expectedRevision) {
      await finished;
      fail('MAKER_V8_NATIVE_STORE_CONFLICT');
    }
    records.put({ revision, iv, ciphertext }, recordKey);
    await finished;
    const persisted = await load(recordKey);
    if (persisted?.revision !== revision || JSON.stringify(persisted.data) !== serialized) fail('MAKER_V8_NATIVE_STORE_REREAD_FAILED');
    return persisted;
  }
  return Object.freeze({ load, create: (recordKey, data) => write(recordKey, 0, data),
    compareAndSwap: write, async close() { (await database)?.close(); database = null; } });
}
