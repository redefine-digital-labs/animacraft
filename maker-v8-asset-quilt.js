import { encodeQuilt } from '@mysten/walrus';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { makerV8WalrusUploadIdV8 } from './maker-v8-walrus.js';

const SCHEMA = 'animacraft.maker-v8-asset-quilt.v1';
export const MAKER_V8_QUILT_MEDIA_TYPE = 'application/vnd.walrus.quilt';
const hash = bytes => [...sha256(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const utf8 = value => new TextEncoder().encode(value);
const url64 = bytes => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function check(value, message) {
  if (!value) throw Object.assign(new Error(message), { code: 'MAKER_V8_ASSET_QUILT_INVALID' });
}
function idBytes(value, size) {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), 'Invalid Walrus identity');
  const bytes = fromBase64(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  check(bytes.length === size && url64(bytes) === value, 'Noncanonical Walrus identity');
  return bytes;
}

// SDK QuiltPatchId: 32-byte quilt ID, version u8, start/end u16 LE.
export function makerV8QuiltPatchIdV8(blobId, startIndex, endIndex) {
  const bytes = new Uint8Array(37);
  bytes.set(idBytes(blobId, 32));
  check(Number.isInteger(startIndex) && Number.isInteger(endIndex)
    && startIndex > 0 && endIndex > startIndex && endIndex <= 65535, 'Invalid quilt patch range');
  const view = new DataView(bytes.buffer);
  view.setUint8(32, 1); view.setUint16(33, startIndex, true); view.setUint16(35, endIndex, true);
  return url64(bytes);
}

export function makerV8WalrusAssetPathV8(value) {
  if (typeof value === 'string' && value.length === 50) {
    const bytes = idBytes(value, 37); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    check(view.getUint8(32) === 1 && view.getUint16(33, true) > 0
      && view.getUint16(35, true) > view.getUint16(33, true), 'Invalid quilt patch identity');
    return `/v1/blobs/by-quilt-patch-id/${value}`;
  }
  idBytes(value, 32);
  return `/v1/blobs/${value}`;
}

/** One durable upload for a sorted group of exact public or already-encrypted assets.
 * Pin encoding parameters before preparing any signable transaction. Recovery never
 * uses a new committee layout or fresh randomized ciphertext for the same group.
 */
export function createMakerV8AssetQuiltV8({ publisher }) {
  return Object.freeze({
    async selectMembers({ owner, assets }) {
      if (assets.length < 2) return [];
      const schemaVersion = 'animacraft.maker-v8-asset-layout.v1';
      const source = assets.map(asset => ({ assetId: asset.assetId, uploadId: asset.uploadId,
        mediaType: asset.mediaType, sha256: hash(fromBase64(asset.bytesBase64)) }));
      const sourceSha256 = hash(utf8(JSON.stringify({ schemaVersion, owner, source })));
      const key = `${schemaVersion}:${sourceSha256}`;
      const binding = await publisher.bindAssetLayout(key, { schemaVersion, owner, sourceSha256, source });
      check(binding?.schemaVersion === schemaVersion && binding.key === key && binding.revision === 1
        && binding.owner === owner && binding.sourceSha256 === sourceSha256
        && Array.isArray(binding.members) && binding.members.length !== 1
        && new Set(binding.members).size === binding.members.length
        && binding.members.every(id => source.some(asset => asset.assetId === id))
        && JSON.stringify(binding.members) === JSON.stringify(source.filter(asset => binding.members.includes(asset.assetId)).map(asset => asset.assetId))
        && binding.layoutSha256 === hash(utf8(JSON.stringify({ sourceSha256, members: binding.members }))),
      'Durable asset layout drift');
      return Object.freeze([...binding.members]);
    },
    async prepare({ owner, assets }) {
      check(/^0x[0-9a-f]{64}$/.test(owner) && !/^0x0+$/.test(owner), 'Invalid quilt owner');
      check(Array.isArray(assets) && assets.length > 1, 'A quilt requires multiple assets');
      const seen = new Set();
      const sorted = [...assets].sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
      const blobs = sorted.map(asset => {
        check(typeof asset.assetId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(asset.assetId)
          && !seen.has(asset.assetId), 'Invalid or duplicate quilt asset');
        seen.add(asset.assetId);
        const contents = fromBase64(asset.bytesBase64);
        check(contents.length > 0 && toBase64(contents) === asset.bytesBase64
          && typeof asset.mediaType === 'string' && asset.mediaType.length > 0, 'Invalid quilt asset bytes');
        return { identifier: asset.assetId, contents };
      });
      const source = sorted.map((asset, i) => ({ assetId: asset.assetId, mediaType: asset.mediaType,
        byteLength: blobs[i].contents.length, sha256: hash(blobs[i].contents) }));
      const sourceSha256 = hash(utf8(JSON.stringify({ schemaVersion: SCHEMA, owner, epochs: 3, source })));
      const uploadId = makerV8WalrusUploadIdV8({ owner, purpose: 'asset-quilt', contentSha256: sourceSha256 });
      const key = `${SCHEMA}:${uploadId}`;
      let binding = await publisher.loadPublicationBinding(key);
      if (!binding) {
        const numShards = await publisher.getNumShards();
        check(Number.isSafeInteger(numShards) && numShards > 3 && numShards <= 65535, 'Invalid Walrus shard count');
        const { quilt } = encodeQuilt({ blobs, numShards });
        const proposed = { schemaVersion: SCHEMA, owner, sourceSha256, numShards, quiltSha256: hash(quilt) };
        try { await publisher.savePublicationBinding(key, null, proposed); }
        catch (error) { if (error?.code !== 'MAKER_V8_WALRUS_CAS_MISMATCH') throw error; }
        binding = await publisher.loadPublicationBinding(key);
      }
      check(binding?.schemaVersion === SCHEMA && binding.key === key && binding.revision === 1
        && binding.owner === owner && binding.sourceSha256 === sourceSha256
        && Number.isSafeInteger(binding.numShards) && binding.numShards > 3 && binding.numShards <= 65535,
      'Durable quilt binding drift');
      const { quilt, index } = encodeQuilt({ blobs, numShards: binding.numShards });
      check(hash(quilt) === binding.quiltSha256, 'Durable quilt bytes drift');
      let upload = await publisher.load(uploadId);
      if (!upload) {
        try {
          await publisher.prepare({ uploadId, owner, mediaType: MAKER_V8_QUILT_MEDIA_TYPE,
            bytesBase64: toBase64(quilt), epochs: 3 });
        } catch (error) { if (error?.code !== 'MAKER_V8_WALRUS_UPLOAD_EXISTS') throw error; }
        upload = await publisher.load(uploadId);
      }
      const content = await publisher.loadContent(uploadId);
      check(upload?.uploadId === uploadId && upload.byteSha256 === binding.quiltSha256
        && content?.owner === owner && content.mediaType === MAKER_V8_QUILT_MEDIA_TYPE
        && content.byteSha256 === binding.quiltSha256 && content.bytesBase64 === toBase64(quilt),
      'Durable quilt upload drift');
      const transports = sorted.map((asset, i) => {
        const patch = index.patches[i];
        check(patch.identifier === asset.assetId, 'Quilt asset index drift');
        return Object.freeze({ ...asset,
          blobId: makerV8QuiltPatchIdV8(upload.blobId, patch.startIndex, patch.endIndex) });
      });
      return Object.freeze({ upload, assets: Object.freeze(transports) });
    },
  });
}
