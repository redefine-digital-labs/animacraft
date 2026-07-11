import { validateLivingContent } from './living-content.js';

const LIMITS = Object.freeze({
  maxParts: 750,
  maxItems: 5_000,
  maxRules: 1_000,
  maxItemsPerPart: 100,
  maxLayersPerPart: 32,
  maxColorsPerPart: 32,
  maxAssets: 4_999,
  maxAssetCells: 5_000,
  maxKeyBytes: 128,
  maxDescriptionBytes: 2_000,
  maxIdentifierBytes: 512,
  minCanvas: 256,
  maxCanvas: 8_192,
});
const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

export function validateRemoteMakerManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('The Maker manifest is not a JSON object.');
  if (manifest.schemaVersion !== 'animacraft.creator-template.v3') {
    throw new Error('The Maker manifest uses an unsupported schema version.');
  }

  const width = Number(manifest.template?.canvas?.width || 0);
  const height = Number(manifest.template?.canvas?.height || 0);
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < LIMITS.minCanvas || height < LIMITS.minCanvas
    || width > LIMITS.maxCanvas || height > LIMITS.maxCanvas) {
    throw new Error('The Maker manifest has an invalid canvas size.');
  }
  if (!manifest.template?.name || utf8Length(manifest.template.name) > LIMITS.maxKeyBytes
    || utf8Length(manifest.template.summary || '') > LIMITS.maxDescriptionBytes
    || utf8Length(manifest.template.creator || '') > LIMITS.maxKeyBytes
    || utf8Length(manifest.template.style || '') > LIMITS.maxKeyBytes
    || !String(manifest.template.licenseNote || '').trim()
    || utf8Length(manifest.template.licenseNote || '') > LIMITS.maxDescriptionBytes
    || !['personal-use', 'free-remix', 'paid-commercial', 'exclusive-commission'].includes(manifest.template.license || 'personal-use')
    || ![0, 100, 200, 300, 400, 500].includes(Number(manifest.template.royaltyBps || 0))) {
    throw new Error('The Maker manifest has invalid public metadata.');
  }
  const mintingEnabled = manifest.template.mintingEnabled !== false;
  const mintFeeEnabled = Boolean(manifest.template.mintFeeEnabled);
  const mintPriceAtomic = Number(manifest.template.mintPriceAtomic || 0);
  if ((!mintingEnabled && mintFeeEnabled)
    || !Number.isSafeInteger(mintPriceAtomic)
    || mintPriceAtomic < 0
    || (mintFeeEnabled && mintPriceAtomic === 0)
    || (!mintFeeEnabled && mintPriceAtomic !== 0)
    || (mintFeeEnabled && !/^0x[0-9a-f]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/i.test(String(manifest.template.paymentCoinType || '')))) {
    throw new Error('The Maker manifest has invalid mint economics.');
  }

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  if (assets.length > LIMITS.maxAssets) throw new Error('The Maker manifest has an invalid asset index.');
  const assetIdentifiers = assets.map((asset) => String(asset?.identifier || '')).filter(Boolean);
  if (assetIdentifiers.length !== assets.length || new Set(assetIdentifiers).size !== assetIdentifiers.length) {
    throw new Error('The Maker manifest contains invalid or duplicate asset identifiers.');
  }
  if (assetIdentifiers.some((identifier) => utf8Length(identifier) > LIMITS.maxIdentifierBytes)) {
    throw new Error('The Maker manifest contains an oversized asset identifier.');
  }
  const assetIdentifierSet = new Set(assetIdentifiers);

  const remoteParts = Array.isArray(manifest.parts) ? manifest.parts : [];
  if (!remoteParts.length || remoteParts.length > LIMITS.maxParts) throw new Error('The Maker manifest has an invalid Part count.');
  if (new Set(remoteParts.map((part) => String(part?.key || ''))).size !== remoteParts.length) {
    throw new Error('The Maker manifest contains duplicate Part keys.');
  }
  const partByKey = new Map(remoteParts.map((part) => [String(part.key || ''), part]));
  let itemCount = 0;
  let assetCellCount = 0;
  const renderOrders = [];
  let visiblePartCount = 0;

  remoteParts.forEach((part) => {
    const key = String(part?.key || '');
    const label = String(part?.label || '');
    const items = Array.isArray(part?.items) ? part.items : [];
    const layers = Array.isArray(part?.layers) ? part.layers : [];
    const colors = Array.isArray(part?.colors) ? part.colors : [];
    if (!KEY_PATTERN.test(key) || !label || utf8Length(key) > LIMITS.maxKeyBytes || utf8Length(label) > LIMITS.maxKeyBytes) {
      throw new Error('The Maker manifest contains an invalid Part key or label.');
    }
    if (!['standard', 'left-right-pair', 'last-bastion'].includes(part.kind)) throw new Error(`${label} has an invalid Part type.`);
    if (typeof part.menuVisible !== 'boolean' || typeof part.allowRemove !== 'boolean') throw new Error(`${label} has invalid Part behavior flags.`);
    if (part.kind === 'last-bastion' && part.allowRemove !== false) throw new Error(`${label} must be a required fallback Part.`);
    if (part.menuVisible) visiblePartCount += 1;
    if (!items.length || items.length > LIMITS.maxItemsPerPart) throw new Error(`${label} has an invalid Item count.`);
    if (!layers.length || layers.length > LIMITS.maxLayersPerPart) throw new Error(`${label} has an invalid Layer count.`);
    if (!colors.length || colors.length > LIMITS.maxColorsPerPart) throw new Error(`${label} has an invalid Color count.`);
    if (new Set(items.map((item) => String(item?.id || ''))).size !== items.length) throw new Error(`${label} contains duplicate Item IDs.`);
    if (new Set(layers.map((layer) => String(layer?.id || ''))).size !== layers.length) throw new Error(`${label} contains duplicate Layer IDs.`);
    if (new Set(colors.map((color) => String(color?.id || ''))).size !== colors.length) throw new Error(`${label} contains duplicate Color IDs.`);
    if (new Set(colors.map((color) => String(color?.value || '').toLowerCase())).size !== colors.length) throw new Error(`${label} contains duplicate Color values.`);
    if (!items.some((item) => item.id === part.defaultItemId)) throw new Error(`${label} has an invalid default Item.`);

    const layerIds = new Set(layers.map((layer) => String(layer.id || '')));
    const colorIds = new Set(colors.map((color) => String(color.id || '')));
    layers.forEach((layer) => {
      if (!KEY_PATTERN.test(String(layer?.id || '')) || !String(layer?.name || '').trim()
        || utf8Length(layer.id) > LIMITS.maxKeyBytes || utf8Length(layer.name || '') > LIMITS.maxKeyBytes) {
        throw new Error(`${label} contains an invalid Layer.`);
      }
      if (!Number.isFinite(Number(layer.x)) || !Number.isFinite(Number(layer.y))
        || Math.abs(Number(layer.x)) > width || Math.abs(Number(layer.y)) > height) {
        throw new Error(`${label} contains out-of-range Layer coordinates.`);
      }
      if (!Number.isFinite(Number(layer.opacity)) || Number(layer.opacity) < 0 || Number(layer.opacity) > 100) {
        throw new Error(`${label} contains invalid Layer opacity.`);
      }
      if (!['normal', 'multiply', 'screen', 'overlay'].includes(layer.blendMode || 'normal')) {
        throw new Error(`${label} contains an unsupported blend mode.`);
      }
      if (!Number.isInteger(Number(layer.renderOrder)) || Number(layer.renderOrder) < 0) {
        throw new Error(`${label} contains an invalid global Layer order.`);
      }
      renderOrders.push(Number(layer.renderOrder));
    });
    colors.forEach((color) => {
      if (!KEY_PATTERN.test(String(color?.id || '')) || !String(color?.name || '').trim()
        || utf8Length(color.id) > LIMITS.maxKeyBytes || utf8Length(color.name || '') > LIMITS.maxKeyBytes
        || !/^#[0-9a-f]{6}$/i.test(String(color.value || ''))) {
        throw new Error(`${label} contains an invalid Color.`);
      }
    });
    if (part.iconIdentifier && !assetIdentifierSet.has(String(part.iconIdentifier))) throw new Error(`${label} references a missing Part icon.`);

    itemCount += items.length;
    items.forEach((item) => {
      if (!KEY_PATTERN.test(String(item?.id || '')) || !String(item?.label || '').trim()
        || utf8Length(item.id) > LIMITS.maxKeyBytes || utf8Length(item.label || '') > LIMITS.maxKeyBytes) {
        throw new Error(`${label} contains an invalid Item.`);
      }
      if (item.visibility !== 'public' || !Number.isInteger(Number(item.displayOrder)) || Number(item.displayOrder) < 1) {
        throw new Error(`${label} contains invalid published Item settings.`);
      }
      const images = Array.isArray(item.images) ? item.images : [];
      const imageCells = images.map((image) => `${image?.layerId || ''}:${image?.colorId || ''}`);
      if (images.length !== layers.length * colors.length || new Set(imageCells).size !== imageCells.length) {
        throw new Error(`${label} / ${item.label || item.id} has an incomplete image matrix.`);
      }
      assetCellCount += images.length;
      images.forEach((image) => {
        if (!image?.identifier || utf8Length(image.identifier) > LIMITS.maxIdentifierBytes) {
          throw new Error(`${label} contains an invalid Walrus image identifier.`);
        }
        if (!layerIds.has(String(image.layerId || '')) || !colorIds.has(String(image.colorId || ''))) {
          throw new Error(`${label} contains an image for an unknown Layer or Color.`);
        }
        if (!assetIdentifierSet.has(String(image.identifier))) throw new Error(`${label} references an image missing from the asset index.`);
      });
      if (item.iconIdentifier && !assetIdentifierSet.has(String(item.iconIdentifier))) throw new Error(`${label} references a missing Item icon.`);
    });
  });

  if (!visiblePartCount) throw new Error('The Maker manifest needs at least one visible Part.');
  if (new Set(renderOrders).size !== renderOrders.length
    || renderOrders.some((order) => order >= renderOrders.length)) {
    throw new Error('The Maker manifest has an invalid global Layer order.');
  }
  if (itemCount > LIMITS.maxItems || assetCellCount > LIMITS.maxAssetCells) throw new Error('The Maker manifest exceeds launch asset limits.');
  if (!Array.isArray(manifest.rules) || manifest.rules.length > LIMITS.maxRules) throw new Error('The Maker manifest has an invalid rule list.');
  if (!Array.isArray(manifest.paletteLinks) || manifest.paletteLinks.length > LIMITS.maxRules) throw new Error('The Maker manifest has an invalid palette link list.');

  const selectionRuleKeys = new Set();
  manifest.rules.forEach((rule) => {
    const left = partByKey.get(String(rule?.leftPartKey || ''));
    const right = partByKey.get(String(rule?.rightPartKey || ''));
    if (!left || !right || left === right || left.kind === 'last-bastion' || right.kind === 'last-bastion') {
      throw new Error('The Maker manifest contains an invalid selection rule.');
    }
    if (rule.leftItemKey && !left.items.some((item) => item.id === rule.leftItemKey)) throw new Error('A selection rule references a missing Item.');
    if (rule.rightItemKey && !right.items.some((item) => item.id === rule.rightItemKey)) throw new Error('A selection rule references a missing Item.');
    const sides = [
      `${rule.leftPartKey}:${rule.leftItemKey || ''}`,
      `${rule.rightPartKey}:${rule.rightItemKey || ''}`,
    ].sort();
    const ruleKey = JSON.stringify(sides);
    if (selectionRuleKeys.has(ruleKey)) throw new Error('The Maker manifest contains a duplicate selection rule.');
    selectionRuleKeys.add(ruleKey);
  });
  const paletteLinkKeys = new Set();
  manifest.paletteLinks.forEach((link) => {
    const primary = partByKey.get(String(link?.primaryPartKey || ''));
    const linked = partByKey.get(String(link?.linkedPartKey || ''));
    if (!primary || !linked
      || link.primaryPartKey === link.linkedPartKey) {
      throw new Error('The Maker manifest contains an invalid palette link.');
    }
    const primaryColors = primary.colors.map((color) => String(color.value).toLowerCase()).sort();
    const linkedColors = linked.colors.map((color) => String(color.value).toLowerCase()).sort();
    if (JSON.stringify(primaryColors) !== JSON.stringify(linkedColors)) {
      throw new Error('Linked Parts must publish the same exact color set.');
    }
    const linkKey = JSON.stringify([String(link.primaryPartKey), String(link.linkedPartKey)].sort());
    if (paletteLinkKeys.has(linkKey)) throw new Error('The Maker manifest contains a duplicate palette link.');
    paletteLinkKeys.add(linkKey);
  });
  if (manifest.template.coverIdentifier && !assetIdentifierSet.has(String(manifest.template.coverIdentifier))) {
    throw new Error('The Maker cover is missing from the asset index.');
  }
  if (manifest.livingContent) validateLivingContent(manifest.livingContent);
  return manifest;
}

export { LIMITS as MANIFEST_LIMITS };
