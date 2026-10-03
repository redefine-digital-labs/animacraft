import { createMakerV8Document, createCharacterMakerV8Starter, assertMakerV8Document } from '../maker-v8-document.js';

// Local acceptance data only. Original 800px canvas and identity transforms.
export function makeTinyDraft(gender, layers) {
  const draft = structuredClone(createMakerV8Document({ makerKey: `tiny-${gender}`, name: `TINY ${gender}`, width: 800, height: 800 }));
  const assets = [];
  const template = createCharacterMakerV8Starter().parts[0];
  for (const [order, layer] of layers.entries()) {
    draft.tracks.push({ key: layer.key, label: layer.key, renderOrder: order, locked: false });
    const part = structuredClone(template);
    Object.assign(part, { key: layer.key, label: layer.key, kind: 'STANDARD', required: false, menuOrder: order, renderOrder: order, items: [] });
    for (const [index, entry] of layer.entries.entries()) {
      const item = structuredClone(template.items[0]);
      const key = `${layer.key}-${index}`;
      Object.assign(item, { key, label: entry.name, displayOrder: index });
      Object.assign(item.styles[0], { assetId: key, trackKey: layer.key });
      part.items.push(item);
      draft.assets.push({ id: key, kind: 'layer', mediaType: 'image/png', byteLength: entry.byteLength });
      assets.push({ assetId: key, kind: 'layer', mediaType: 'image/png', bytesBase64: entry.bytesBase64 });
    }
    draft.parts.push(part);
    const initial = Math.max(0, layer.entries.findIndex(e => e.name.includes('*')));
    draft.defaultRecipe.selections.push({ partKey: layer.key, itemKey: `${layer.key}-${initial}`, styleKey: 'default' });
  }
  assertMakerV8Document(draft, { mode: 'draft' });
  return { draft, assets };
}
