// Reserved author-content metadata, not chain authority. Derive from plaintext
// before computing any publication identity; never from ciphertext metadata.
import { isMakerV8SourceAsset } from './maker-v8-render-core.js';
export { isMakerV8SourceAsset } from './maker-v8-render-core.js';
export const MAKER_V8_SOURCE_ASSET_KEY = 'animacraftSourceAsset';
const SOURCE_PATH = /^parts\[\d+\]\.items\[\d+\]\.styles\[\d+\]\.payload\.animacraftSourceAsset$/;

export function isMakerV8SourceAssetHash(path, parent) {
  return path.endsWith('.sha256') && SOURCE_PATH.test(path.slice(0, -7)) && isMakerV8SourceAsset(parent);
}

export function isMakerV8SourceAssetField(path, value) {
  return SOURCE_PATH.test(path) && isMakerV8SourceAsset(value);
}

function fail() {
  const error = new Error('Style source identity differs from its exact plaintext asset.');
  error.code = 'MAKER_V8_SOURCE_ASSET_MISMATCH';
  throw error;
}

/** Certified ciphertext and committed plaintext remain separate identities. */
export function assertMakerV8PublishedSources(document, certifiedAssets) {
  const descriptors = new Map(document.assets.map(row => [row.id, row]));
  const certified = new Map(certifiedAssets.map(row => [row.assetId, row]));
  for (const part of document.parts) for (const item of part.items) {
    if (item.status !== 'PUBLIC') continue;
    for (const style of item.styles) {
      const source = style.payload[MAKER_V8_SOURCE_ASSET_KEY];
      if (source === undefined && !style.protected) continue;
      const descriptor = descriptors.get(style.assetId);
      const transport = certified.get(style.assetId);
      if (!isMakerV8SourceAsset(source) || !descriptor || !transport
        || source.mediaType !== descriptor.mediaType || String(source.byteLength) !== String(descriptor.byteLength)
        || (!style.protected && source.sha256 !== transport.sha256)) fail();
    }
  }
}

/** Entries must be derived from actual bytes. Private author data is untouched. */
export function bindMakerV8SourceAssets(document, entries, { requireExisting = false } = {}) {
  const result = structuredClone(document);
  const assets = new Map(entries.map(row => [row.assetId, row]));
  const descriptors = new Map(result.assets.map(row => [row.id, row]));
  if (assets.size !== entries.length) fail();
  for (const part of result.parts) for (const item of part.items) {
    if (item.status !== 'PUBLIC') continue;
    for (const style of item.styles) {
      const asset = assets.get(style.assetId);
      const descriptor = descriptors.get(style.assetId);
      if (!asset || !descriptor || asset.mediaType !== descriptor.mediaType
        || String(asset.byteLength) !== String(descriptor.byteLength)) fail();
      const source = { sha256: asset.sha256, mediaType: asset.mediaType, byteLength: asset.byteLength };
      if (!isMakerV8SourceAsset(source)) fail();
      const current = style.payload[MAKER_V8_SOURCE_ASSET_KEY];
      if (current !== undefined || requireExisting) {
        if (!isMakerV8SourceAsset(current) || Object.keys(source).some(key => source[key] !== current[key])) fail();
      }
      style.payload[MAKER_V8_SOURCE_ASSET_KEY] = source;
    }
  }
  return result;
}
