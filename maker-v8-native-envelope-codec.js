// Cross-site wire: Soulidity web/lib/soulidity/content-envelope.ts is authoritative.
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, fromHex, toHex, normalizeSuiAddress } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { EncryptedObject } from '@mysten/seal';

export const CONTENT_ENVELOPE_SCHEMA = 'soulidity.content-envelope.v1';
const utf8 = new TextEncoder();
const check = value => { if (!value) throw new Error('CONTENT_ENVELOPE_INVALID'); };
const id = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
const keys = (value, expected) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)));
const validBase64 = value => {
  if (typeof value !== 'string' || !value.length) return false;
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(padded);
};
const Key = bcs.struct('ContentEnvelopeKeyV1', { content: bcs.Address, kind: bcs.u32(), name: bcs.string(), version: bcs.u64() });
function slot(value) {
  check(id(value.contentObjectId) && id(value.blobObjectId) && Number.isInteger(value.kind)
    && value.kind >= 0 && value.kind <= 0xffffffff && typeof value.name === 'string' && value.name.length > 0
    && new TextDecoder('utf-8', { fatal: true }).decode(utf8.encode(value.name)) === value.name
    && typeof value.versionIndex === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value.versionIndex)
    && BigInt(value.versionIndex) <= 0xffffffffffffffffn);
  return { contentObjectId: value.contentObjectId, kind: value.kind, name: value.name,
    versionIndex: value.versionIndex, blobObjectId: value.blobObjectId };
}
export function contentEnvelopeKey(input) {
  const value = slot(input);
  return 'content_seal_envelope_v1:' + toHex(sha256(Key.serialize({
    content: value.contentObjectId, kind: value.kind, name: value.name, version: value.versionIndex,
  }).toBytes()));
}
export function encodeContentEnvelope(input, originalPackageId) {
  keys(input, ['schema', 'contentObjectId', 'kind', 'name', 'versionIndex', 'blobObjectId', 'sidecar']);
  check(input.schema === CONTENT_ENVELOPE_SCHEMA && id(originalPackageId));
  const identity = slot(input); const s = input.sidecar;
  keys(s, ['version', 'mode', 'sealPackageId', 'documentId', 'encryptedDek', 'iv', 'cipher', 'mimeType', 'fileName', 'contentHash']);
  check(s.version === 1 && s.mode === 'seal-envelope' && s.cipher === 'AES-GCM-256'
    && typeof s.mimeType === 'string' && s.mimeType.length && typeof s.fileName === 'string' && s.fileName.length
    && typeof s.contentHash === 'string' && /^[0-9a-fA-F]{64}$/.test(s.contentHash)
    && typeof s.encryptedDek === 'string' && s.encryptedDek.length > 0 && s.encryptedDek.length <= 16 * 1024
    && validBase64(s.encryptedDek) && validBase64(s.iv) && fromBase64(s.iv).length === 12
    && typeof s.documentId === 'string' && /^(0x)?(?:[0-9a-fA-F]{2})+$/.test(s.documentId));
  const name = utf8.encode(identity.name); const document = fromHex(s.documentId);
  const expected = new Uint8Array(75 + name.length); expected.set(utf8.encode('soul-content:')); expected[13] = 1;
  new DataView(expected.buffer).setUint32(14, identity.kind, false);
  expected.set(fromHex(identity.contentObjectId), 18); expected.set(name, 50);
  new DataView(expected.buffer).setBigUint64(51 + name.length, BigInt(identity.versionIndex), false);
  check(document.length === expected.length && expected.slice(0, -16).every((byte, index) => document[index] === byte));
  const encrypted = EncryptedObject.parse(fromBase64(s.encryptedDek));
  check(normalizeSuiAddress(s.sealPackageId) === originalPackageId
    && normalizeSuiAddress(encrypted.packageId) === originalPackageId
    && toHex(fromHex(encrypted.id)) === toHex(document));
  const sidecar = { version: 1, mode: 'seal-envelope', sealPackageId: originalPackageId,
    documentId: s.documentId, encryptedDek: s.encryptedDek, iv: s.iv, cipher: 'AES-GCM-256',
    mimeType: s.mimeType, fileName: s.fileName, contentHash: s.contentHash.toLowerCase() };
  const value = JSON.stringify({ schema: CONTENT_ENVELOPE_SCHEMA, ...identity, sidecar });
  check(utf8.encode(value).length <= 64 * 1024); return value;
}
export function decodeContentEnvelope(text, expected, originalPackageId) {
  check(typeof text === 'string' && utf8.encode(text).length <= 64 * 1024);
  const value = JSON.parse(text);
  check(encodeContentEnvelope(value, originalPackageId) === text && JSON.stringify(slot(value)) === JSON.stringify(slot(expected)));
  return value;
}
