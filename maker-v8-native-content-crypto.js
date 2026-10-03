import { fromBase64, toBase64 } from '@mysten/sui/utils';

const encoder = new TextEncoder();
const HASH = /^[0-9a-f]{64}$/;
const ID = /^0x[0-9a-f]{64}$/;
function fail(message) {
  const error = new Error(message);
  error.code = 'MAKER_V8_NATIVE_CONTENT_CRYPTO_INVALID';
  throw error;
}
function crypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) fail('Web Crypto is required.');
  return globalThis.crypto;
}
function bytes(value, label, length = null) {
  if (!(value instanceof Uint8Array) || length !== null && value.length !== length) fail(`${label} has invalid bytes.`);
  return new Uint8Array(value);
}
function decode(value, length) {
  let decoded;
  try { decoded = fromBase64(value); } catch { fail('Invalid private material encoding.'); }
  if (typeof value !== 'string' || decoded.length !== length || toBase64(decoded) !== value) fail('Invalid private material encoding.');
  return decoded;
}
function metadata(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required.`);
  return value;
}
function materialSnapshot(value) {
  const keys = ['version', 'dek', 'iv', 'contentHash', 'mimeType', 'fileName'];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || value.version !== 1 || typeof value.contentHash !== 'string' || !HASH.test(value.contentHash)) fail('Invalid private recovery material.');
  const result = Object.fromEntries(keys.map(key => [key, value[key]]));
  metadata(result.mimeType, 'mimeType'); metadata(result.fileName, 'fileName');
  const key = decode(result.dek, 32); key.fill(0);
  decode(result.iv, 12);
  return Object.freeze(result);
}
function hex(value) { return [...value].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

/**
 * AES-GCM-256, exactly the native Soulidity envelope cipher (128-bit tag, no AAD).
 * material contains a PRIVATE DEK. Store only in protected local recovery state;
 * never put it in a public receipt, sidecar, transport request or log.
 */
export async function encryptMakerV8NativeContentV8({ plaintext, mimeType, fileName, material = null } = {}) {
  const plain = bytes(plaintext, 'plaintext');
  const mime = metadata(mimeType, 'mimeType'); const name = metadata(fileName, 'fileName');
  const existing = material === null ? null : materialSnapshot(material);
  const webCrypto = crypto();
  let dek;
  try {
    // Check before key import/encrypt: the same key/IV is never reused on changed input.
    const contentHash = hex(new Uint8Array(await webCrypto.subtle.digest('SHA-256', plain)));
    if (existing && (existing.contentHash !== contentHash || existing.mimeType !== mime || existing.fileName !== name)) {
      fail('Recovery material does not match the unchanged plaintext and file metadata.');
    }
    dek = existing ? decode(existing.dek, 32) : webCrypto.getRandomValues(new Uint8Array(32));
    const iv = existing ? decode(existing.iv, 12) : webCrypto.getRandomValues(new Uint8Array(12));
    const key = await webCrypto.subtle.importKey('raw', dek, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ciphertext = new Uint8Array(await webCrypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plain));
    return Object.freeze({ ciphertext, material: existing ?? Object.freeze({
      version: 1, dek: toBase64(dek), iv: toBase64(iv), contentHash, mimeType: mime, fileName: name,
    }) });
  } finally {
    plain.fill(0);
    dek?.fill(0);
  }
}

function documentId({ contentObjectId, kind, name, versionIndex, nonce }) {
  if (typeof contentObjectId !== 'string' || !ID.test(contentObjectId) || /^0x0+$/.test(contentObjectId)) fail('contentObjectId must be canonical and nonzero.');
  if (!Number.isInteger(kind) || kind < 0 || kind > 0xffffffff) fail('kind must be u32.');
  if (typeof name !== 'string') fail('Content name must be a string.');
  if (typeof versionIndex === 'number' && !Number.isSafeInteger(versionIndex)) fail('versionIndex must be exact u64.');
  if (!['number', 'bigint', 'string'].includes(typeof versionIndex)
    || typeof versionIndex === 'string' && !/^(0|[1-9][0-9]*)$/.test(versionIndex)) fail('versionIndex must be exact u64.');
  const version = BigInt(versionIndex);
  if (version < 0n || version > 0xffffffffffffffffn) fail('versionIndex must be exact u64.');
  const nameBytes = encoder.encode(name);
  const out = new Uint8Array(75 + nameBytes.length);
  out.set(encoder.encode('soul-content:')); out[13] = 1;
  const view = new DataView(out.buffer);
  view.setUint32(14, kind, false);
  out.set(Uint8Array.from(contentObjectId.slice(2).match(/../g), pair => Number.parseInt(pair, 16)), 18);
  out.set(nameBytes, 50);
  view.setBigUint64(51 + nameBytes.length, version, false);
  out.set(nonce, 59 + nameBytes.length);
  return `0x${hex(out)}`;
}

/** Existing Soulidity SealEnvelopeSidecar; no raw key is returned in this object. */
export async function createMakerV8NativeContentSidecarV8({ sealClient, threshold, sealPackageId,
  contentObjectId, kind, name, versionIndex, material, nonce } = {}) {
  const saved = materialSnapshot(material);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold >= 255) fail('Seal threshold must be in 1..254.');
  if (typeof sealPackageId !== 'string' || !ID.test(sealPackageId) || /^0x0+$/.test(sealPackageId)) fail('Explicit canonical Seal package is required.');
  if (typeof sealClient?.encrypt !== 'function') fail('An explicit Seal encrypt client is required.');
  const encrypt = sealClient.encrypt.bind(sealClient);
  const randomNonce = nonce === undefined ? crypto().getRandomValues(new Uint8Array(16)) : bytes(nonce, 'nonce', 16);
  const id = documentId({ contentObjectId, kind, name, versionIndex, nonce: randomNonce });
  const dek = decode(saved.dek, 32);
  const keyMaterial = new Uint8Array(64);
  keyMaterial.set(dek);
  keyMaterial.set(Uint8Array.from(saved.contentHash.match(/../g), pair => Number.parseInt(pair, 16)), 32);
  let result;
  try {
    try { result = await encrypt({ threshold, packageId: sealPackageId, id, data: keyMaterial }); }
    catch { fail('Seal envelope encryption failed. Private recovery material was not exposed.'); }
    const encrypted = bytes(result?.encryptedObject, 'Seal encryptedObject');
    if (!encrypted.length) fail('Seal returned an empty encrypted envelope.');
    return Object.freeze({ version: 1, mode: 'seal-envelope', sealPackageId, documentId: id,
      encryptedDek: toBase64(encrypted), iv: saved.iv, cipher: 'AES-GCM-256',
      mimeType: saved.mimeType, fileName: saved.fileName, contentHash: saved.contentHash });
  } finally {
    if (result?.key instanceof Uint8Array) result.key.fill(0);
    keyMaterial.fill(0); dek.fill(0);
  }
}
