import { fromBase64 } from '@mysten/sui/utils';
import { createCharacterMakerV8Starter } from '../../maker-v8-document.js';

// Explicit one-layer artwork fixture for rendering, asset integrity and history
// tests. The user-facing New Maker starter has eight pending-PNG Parts instead.
export const MAKER_V8_DEFAULT_ASSET_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function minimalArtworkDocument({ draftId, name, width = 1024, height = 1024 } = {}) {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: draftId, name, width, height }));
  document.assets[0].byteLength = fromBase64(MAKER_V8_DEFAULT_ASSET_BASE64).length;
  return document;
}

export async function seedMinimalArtworkDraft(drafts, options) {
  const document = minimalArtworkDocument(options);
  const bundle = await drafts.createBundle({
    draftId: options.draftId, document,
    createdAt: options.createdAt ?? Date.now(),
    assets: document.assets.map(asset => ({
      assetId: asset.id, kind: asset.kind, mediaType: asset.mediaType,
      bytesBase64: MAKER_V8_DEFAULT_ASSET_BASE64,
    })),
  });
  return bundle.draft;
}
