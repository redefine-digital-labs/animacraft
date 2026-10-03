import { sha256 } from '@noble/hashes/sha2.js';
import { pngDimensions } from './maker-v8-creator-image.js';

const digest = bytes => Array.from(sha256(bytes), n => n.toString(16).padStart(2, '0')).join('');
const fail = (message, code = 'COMPOSABLE_ARTWORK_INVALID') => { throw Object.assign(new Error(message), { code }); };
export function validateComposableProductSettings(settings, target) {
  const fields = ['itemKey', 'styleKey', 'layerTrackKey', 'colorChannelKey', 'defaultSwatchKey', 'transferable'];
  const validKey = value => typeof value === 'string' && /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  if (!settings || Object.keys(settings).length !== fields.length || fields.some(key => !Object.hasOwn(settings, key))
    || !validKey(settings.itemKey) || !validKey(settings.styleKey) || !validKey(settings.layerTrackKey)
    || typeof settings.transferable !== 'boolean'
    || (settings.colorChannelKey === null) !== (settings.defaultSwatchKey === null)
    || settings.colorChannelKey !== null && (!validKey(settings.colorChannelKey) || !validKey(settings.defaultSwatchKey))) {
    fail('Product keys, color pair or transfer policy are invalid.');
  }
  if (target && (!target.tracks?.some(track => track.key === settings.layerTrackKey)
    || settings.colorChannelKey !== null && !target.colors?.some(channel => channel.key === settings.colorChannelKey
      && channel.swatches.some(swatch => swatch.key === settings.defaultSwatchKey)))) {
    fail('Choose a Track and color from the exact published Maker.');
  }
  return structuredClone(settings);
}
function keyFor(binding) {
  const keys = ['address', 'rootId', 'makerVersion', 'contentCommitment', 'partKey'];
  if (!binding || Object.keys(binding).length !== keys.length
    || keys.some(key => typeof binding[key] !== 'string')
    || !/^0x[0-9a-f]{64}$/.test(binding.address) || !/^0x[0-9a-f]{64}$/.test(binding.rootId)
    || !/^[1-9][0-9]*$/.test(binding.makerVersion) || !/^[0-9a-f]{64}$/.test(binding.contentCommitment)
    || !/^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(binding.partKey)) fail('Artwork target binding is invalid.');
  return JSON.stringify(keys.map(key => binding[key]));
}
function check(record, key) {
  if (!record) return null;
  if (record.key !== key || keyFor(record.binding) !== key || !Number.isSafeInteger(record.revision)
    || record.revision < 1 || !(record.bytes instanceof Uint8Array)
    || digest(record.bytes) !== record.sha256) fail('Saved external artwork integrity differs.');
  pngDimensions(record.bytes);
  if (record.settings) validateComposableProductSettings(record.settings);
  if (record.uploads !== undefined) {
    if (!Array.isArray(record.uploads)) fail('Upload recovery references are invalid.');
    const ids = new Set();
    for (const reference of record.uploads) {
      if (!/^walrus-[0-9a-f]{64}$/.test(reference?.uploadId) || ids.has(reference.uploadId)
        || !Number.isSafeInteger(reference.artworkRevision) || reference.artworkRevision < 1
        || reference.artworkRevision > record.revision || !/^[0-9a-f]{64}$/.test(reference.sha256)) fail('Upload recovery reference is invalid.');
      validateComposableProductSettings(reference.settings); ids.add(reference.uploadId);
    }
  }
  return record;
}

// Local author-owned source only. Saving here is never a Walrus certificate or
// an external Product issuance. Wallet + immutable target + Part isolate drafts.
export function createMakerV8ComposableArtworkStore(indexedDB) {
  let connection, opening, closed = false;
  const open = () => opening ||= new Promise((resolve, reject) => {
    if (closed) { reject(new Error('External artwork storage is closed.')); return; }
    if (!indexedDB?.open) { reject(new Error('Local external artwork storage is unavailable.')); return; }
    let rejected = false;
    const request = indexedDB.open('animacraft-maker-v8-composable-artwork', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('artwork', { keyPath: 'key' });
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { rejected = true; opening = null; reject(new Error('External artwork storage is blocked by another tab.')); };
    request.onsuccess = () => {
      if (rejected || closed) { request.result.close(); reject(new Error('External artwork storage is closed.')); return; }
      connection = request.result;
      connection.onversionchange = () => { connection.close(); connection = null; opening = null; };
      resolve(connection);
    };
  });
  const transaction = async (binding, mode, update) => {
    const key = keyFor(binding), database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('artwork', mode), store = tx.objectStore('artwork');
      let result, error;
      tx.oncomplete = () => resolve(structuredClone(result));
      tx.onabort = () => reject(error || tx.error || new Error('External artwork save aborted.'));
      tx.onerror = () => {};
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const prior = check(request.result, key);
          result = update ? update(prior, key) : prior;
          if (update) store.put(result);
        } catch (caught) { error = caught; tx.abort(); }
      };
    });
  };
  return Object.freeze({
    async listUploadReferences(address) {
      if (!/^0x[0-9a-f]{64}$/.test(address)) fail('Wallet address is invalid.');
      const database = await open();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('artwork', 'readonly'), rows = [];
        let error;
        tx.oncomplete = () => resolve(rows);
        tx.onabort = () => reject(error || tx.error || new Error('Upload history read aborted.'));
        tx.onerror = () => {};
        const request = tx.objectStore('artwork').openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          try {
            if (cursor.value.binding?.address === address) {
              const record = check(cursor.value, cursor.key);
              for (const reference of record.uploads || []) rows.push({ binding: structuredClone(record.binding), ...structuredClone(reference) });
            }
            cursor.continue();
          } catch (caught) { error = caught; tx.abort(); }
        };
      });
    },
    load: binding => transaction(binding, 'readonly'),
    async save({ binding, expectedRevision, bytes }) {
      const copy = new Uint8Array(bytes);
      pngDimensions(copy);
      const hash = digest(copy), savedBinding = structuredClone(binding);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('Expected artwork revision is invalid.');
      return transaction(savedBinding, 'readwrite', (prior, key) => {
        if ((prior?.revision || 0) !== expectedRevision) fail('External artwork changed in another tab. Reload before replacing it.', 'COMPOSABLE_ARTWORK_CONFLICT');
        return { key, binding: savedBinding, revision: expectedRevision + 1, sha256: hash, bytes: copy, settings: prior?.settings || null, uploads: prior?.uploads || [] };
      });
    },
    async rememberUpload({ binding, expectedRevision, uploadId, sha256 }) {
      if (!/^walrus-[0-9a-f]{64}$/.test(uploadId) || !/^[0-9a-f]{64}$/.test(sha256)) fail('Upload recovery identity is invalid.');
      return transaction(binding, 'readwrite', prior => {
        if (!prior || prior.revision !== expectedRevision || prior.sha256 !== sha256 || !prior.settings) {
          fail('Artwork changed before upload recovery was saved.', 'COMPOSABLE_ARTWORK_CONFLICT');
        }
        const reference = { uploadId, artworkRevision: expectedRevision, sha256, settings: prior.settings };
        const existing = (prior.uploads || []).find(row => row.uploadId === uploadId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(reference)) fail('Upload recovery identity conflicts.');
        return { ...prior, uploads: existing ? prior.uploads : [...(prior.uploads || []), reference] };
      });
    },
    async saveSettings({ binding, expectedRevision, settings, target }) {
      const checked = validateComposableProductSettings(settings, target);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
        || target?.rootId !== binding.rootId || target.contentCommitment !== binding.contentCommitment
        || target.makerVersion !== binding.makerVersion || !target.parts?.some(part => part.key === binding.partKey)) {
        fail('Product settings require the exact saved artwork target.');
      }
      return transaction(binding, 'readwrite', prior => {
        if (!prior || prior.revision !== expectedRevision) fail('External artwork changed. Reload before saving product settings.', 'COMPOSABLE_ARTWORK_CONFLICT');
        return { ...prior, revision: prior.revision + 1, settings: checked };
      });
    },
    close() { closed = true; connection?.close(); connection = null; opening = null; },
  });
}
