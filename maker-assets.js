const MAX_MAKER_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_MAKER_ASSET_EDGE = 8_192;

function normalizedToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .trim();
}

function tokenScore(fileToken, track) {
  const id = normalizedToken(track?.id);
  const name = normalizedToken(track?.name);
  if (!fileToken) return 0;
  if (id && fileToken === id) return 100;
  if (name && fileToken === name) return 95;
  if (id && fileToken.includes(id)) return 80 + Math.min(10, id.length);
  if (name && fileToken.includes(name)) return 75 + Math.min(10, name.length);
  const aliases = {
    back: ['back', 'rear', 'behind', '后', '後'],
    front: ['front', 'fore', '前'],
    base: ['base', 'body', 'skin', '素体', '身体', '身體'],
    background: ['background', 'backdrop', 'bg', '背景'],
    highlight: ['highlight', 'light', '高光'],
    shadow: ['shadow', 'shade', '阴影', '陰影'],
  };
  for (const [kind, words] of Object.entries(aliases)) {
    const fileMatches = words.some((word) => fileToken.includes(word));
    const trackMatches = words.some((word) => id.includes(word) || name.includes(word));
    if (fileMatches && trackMatches) return 65 + kind.length;
  }
  return 0;
}

export function buildAssetImportMapping(files, layerTracks = []) {
  const remainingTracks = new Set(layerTracks.map((track) => String(track.id)));
  return [...files].map((file, index) => {
    const token = normalizedToken(file?.name);
    const ranked = layerTracks
      .filter((track) => remainingTracks.has(String(track.id)))
      .map((track) => ({ track, score: tokenScore(token, track) }))
      .sort((left, right) => right.score - left.score);
    let track = ranked[0]?.score > 0 ? ranked[0].track : null;
    if (!track && files.length === layerTracks.length) {
      const orderedTrack = layerTracks[index];
      track = orderedTrack && remainingTracks.has(String(orderedTrack.id))
        ? orderedTrack
        : layerTracks.find((candidate) => remainingTracks.has(String(candidate.id))) || null;
    }
    if (track) remainingTracks.delete(String(track.id));
    return {
      file,
      fileName: String(file?.name || `asset-${index + 1}.png`),
      trackId: track?.id || '',
      confidence: ranked[0]?.score > 0 ? 'matched' : track ? 'ordered' : 'new-track',
      suggestedTrackName: track?.name || String(file?.name || `Layer ${index + 1}`).replace(/\.[^.]+$/, ''),
    };
  });
}

function bestPathMatch(pathToken, pathSegments, entries, fields) {
  let best = null;
  let bestScore = 0;
  entries.forEach((entry) => {
    fields.map((field) => normalizedToken(entry?.[field])).filter(Boolean).forEach((token) => {
      let score = 0;
      if (pathSegments.includes(token)) score = 100 + token.length;
      else if (pathToken.includes(token)) score = 70 + token.length;
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    });
  });
  return { entry: best, score: bestScore };
}

/**
 * Maps a folder or filename matrix to
 * Part × Item × Style × Layer Track × Color.
 *
 * Recommended layout:
 *   part/item/style/track@swatch.png
 */
export function buildProjectAssetImportMapping(files, document) {
  const tracks = document?.layerTracks || [];
  const parts = document?.parts || [];
  const channels = document?.colorChannels || [];
  return [...files].map((file) => {
    const relativePath = String(file.webkitRelativePath || file.name || '');
    const pathToken = normalizedToken(relativePath);
    const pathSegments = relativePath.split(/[\\/]/).map(normalizedToken).filter(Boolean);
    const part = bestPathMatch(pathToken, pathSegments, parts, ['id', 'name']).entry;
    const item = bestPathMatch(pathToken, pathSegments, part?.items || [], ['importKey', 'id', 'name']).entry;
    const variant = bestPathMatch(pathToken, pathSegments, item?.variants || [], ['id', 'name']).entry
      || (item?.variants?.length === 1 ? item.variants[0] : null);
    const track = bestPathMatch(pathToken, pathSegments, tracks, ['id', 'name']).entry;
    const colorEntries = channels.flatMap((channel) => (channel.swatches || []).map((swatch) => ({
      ...swatch,
      channelId: channel.id,
    })));
    const color = bestPathMatch(pathToken, pathSegments, colorEntries, ['id', 'name']).entry;
    const requiredMatches = [part, item, variant, track].filter(Boolean).length;
    return {
      file,
      fileName: relativePath || String(file.name || ''),
      targetDefinition: part && item && variant ? `${part.id}::${item.id}::${variant.id}` : '',
      trackId: track?.id || '',
      colorDefinition: color ? `${color.channelId}::${color.id}` : '',
      confidence: requiredMatches === 4 ? 'matched' : requiredMatches >= 2 ? 'review' : 'unmapped',
      suggestedTrackName: String(file.name || 'Layer').replace(/\.[^.]+$/, '').split('@')[0],
    };
  });
}

export function createAssetId(prefix = 'asset') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${normalizedToken(prefix).replace(/\s+/g, '-') || 'asset'}-${id}`;
}

export async function inspectPngAsset(file, makerCanvas) {
  if (!file || (!String(file.type || '').includes('image/png') && !String(file.name || '').toLowerCase().endsWith('.png'))) {
    throw new Error('Maker artwork must be a PNG file with transparency support.');
  }
  if (Number(file.size || 0) > MAX_MAKER_ASSET_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  let alphaBounds = null;
  try {
    const maximumEdge = 1024;
    const analysisScale = Math.min(1, maximumEdge / Math.max(width, height));
    const analysisWidth = Math.max(1, Math.round(width * analysisScale));
    const analysisHeight = Math.max(1, Math.round(height * analysisScale));
    const analysisCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(analysisWidth, analysisHeight)
      : globalThis.document?.createElement?.('canvas');
    if (analysisCanvas) {
      analysisCanvas.width = analysisWidth;
      analysisCanvas.height = analysisHeight;
      const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, analysisWidth, analysisHeight);
      const pixels = context.getImageData(0, 0, analysisWidth, analysisHeight).data;
      let minX = analysisWidth;
      let minY = analysisHeight;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < analysisHeight; y += 1) {
        for (let x = 0; x < analysisWidth; x += 1) {
          if (pixels[((y * analysisWidth) + x) * 4 + 3] < 8) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (maxX >= minX && maxY >= minY) {
        const inverse = 1 / analysisScale;
        const left = minX * inverse;
        const top = minY * inverse;
        const right = (maxX + 1) * inverse;
        const bottom = (maxY + 1) * inverse;
        alphaBounds = {
          x: Math.round(left * 10) / 10,
          y: Math.round(top * 10) / 10,
          width: Math.round((right - left) * 10) / 10,
          height: Math.round((bottom - top) * 10) / 10,
          centerX: Math.round(((left + right) / 2) * 10) / 10,
          centerY: Math.round(((top + bottom) / 2) * 10) / 10,
        };
      }
    }
  } catch {
    alphaBounds = null;
  }
  bitmap.close();
  if (!width || !height || width > MAX_MAKER_ASSET_EDGE || height > MAX_MAKER_ASSET_EDGE) {
    throw new Error(`${file.name} has unsupported dimensions.`);
  }
  const canvasWidth = Number(makerCanvas?.width || 0);
  const canvasHeight = Number(makerCanvas?.height || 0);
  const fullCanvas = width === canvasWidth && height === canvasHeight;
  const initialScale = fullCanvas ? 1 : Math.min(1, canvasWidth / width, canvasHeight / height);
  return {
    width,
    height,
    fullCanvas,
    alphaBounds,
    initialTransform: {
      x: fullCanvas ? 0 : Math.round((canvasWidth - (width * initialScale)) / 2),
      y: fullCanvas ? 0 : Math.round((canvasHeight - (height * initialScale)) / 2),
      scaleX: initialScale,
      scaleY: initialScale,
      rotation: 0,
    },
    warning: fullCanvas ? '' : 'Cropped artwork: confirm its position before publishing.',
  };
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the image preview.')), type, quality);
  });
}

export async function createAlphaCroppedThumbnail(blob, size = 256) {
  const bitmap = await createImageBitmap(blob);
  const readCanvas = document.createElement('canvas');
  readCanvas.width = bitmap.width;
  readCanvas.height = bitmap.height;
  const readContext = readCanvas.getContext('2d', { willReadFrequently: true });
  readContext.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = readContext.getImageData(0, 0, readCanvas.width, readCanvas.height);
  let minX = readCanvas.width;
  let minY = readCanvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < readCanvas.height; y += 1) {
    for (let x = 0; x < readCanvas.width; x += 1) {
      if (pixels.data[((y * readCanvas.width) + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    minX = 0;
    minY = 0;
    maxX = readCanvas.width - 1;
    maxY = readCanvas.height - 1;
  }
  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);
  const padding = Math.round(size * 0.08);
  const available = Math.max(1, size - (padding * 2));
  const scale = Math.min(available / cropWidth, available / cropHeight);
  const drawWidth = Math.max(1, Math.round(cropWidth * scale));
  const drawHeight = Math.max(1, Math.round(cropHeight * scale));
  const output = document.createElement('canvas');
  output.width = size;
  output.height = size;
  const outputContext = output.getContext('2d');
  outputContext.clearRect(0, 0, size, size);
  outputContext.drawImage(
    readCanvas,
    minX,
    minY,
    cropWidth,
    cropHeight,
    Math.round((size - drawWidth) / 2),
    Math.round((size - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
  return canvasToBlob(output);
}

export function runtimeAssetRecord({ assetId, blob, fileName, width, height, alphaBounds = null, thumbnailBlob = null, source = 'local' }) {
  return {
    assetId,
    blob,
    fileName: String(fileName || `${assetId}.png`),
    width: Number(width || 0),
    height: Number(height || 0),
    alphaBounds,
    thumbnailBlob,
    source,
    url: blob ? URL.createObjectURL(blob) : '',
    thumbnailUrl: thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : '',
    updatedAt: Date.now(),
  };
}

export function collectTrackAlignmentWarnings(document, runtimeAssets, options = {}) {
  const centerTolerance = Number(options.centerTolerance || Math.max(document?.canvas?.width || 0, document?.canvas?.height || 0) * 0.035);
  const sizeRatioLimit = Number(options.sizeRatioLimit || 1.45);
  const recordFor = (assetId) => runtimeAssets instanceof Map ? runtimeAssets.get(assetId) : runtimeAssets?.[assetId];
  const groups = new Map();
  (document?.parts || []).forEach((part) => (part.items || [])
    .filter((item) => (item.status || 'public') === 'public')
    .forEach((item) => (item.variants || []).forEach((variant) => (variant.layerBindings || []).forEach((binding) => {
      const bounds = recordFor(binding.assetId)?.alphaBounds;
      if (!bounds) return;
      const entries = groups.get(binding.layerTrackId) || [];
      entries.push({ part, item, variant, binding, bounds });
      groups.set(binding.layerTrackId, entries);
    }))));
  const warnings = [];
  groups.forEach((entries, trackId) => {
    if (entries.length < 2) return;
    const track = document.layerTracks?.find((candidate) => candidate.id === trackId);
    if (track?.alignmentApproved === true) return;
    const centersX = entries.map((entry) => entry.bounds.centerX).sort((a, b) => a - b);
    const centersY = entries.map((entry) => entry.bounds.centerY).sort((a, b) => a - b);
    const widths = entries.map((entry) => entry.bounds.width).filter((value) => value > 0).sort((a, b) => a - b);
    const heights = entries.map((entry) => entry.bounds.height).filter((value) => value > 0).sort((a, b) => a - b);
    const spreadX = centersX.at(-1) - centersX[0];
    const spreadY = centersY.at(-1) - centersY[0];
    const widthRatio = widths[0] ? widths.at(-1) / widths[0] : 1;
    const heightRatio = heights[0] ? heights.at(-1) / heights[0] : 1;
    if (spreadX <= centerTolerance && spreadY <= centerTolerance && widthRatio <= sizeRatioLimit && heightRatio <= sizeRatioLimit) return;
    warnings.push({
      code: 'track_alignment_drift',
      severity: 'warning',
      path: `layerTracks.${trackId}`,
      trackId,
      message: `${track?.name || trackId} has suspicious transparent-bound variation across ${entries.length} public layers (center spread ${spreadX.toFixed(1)}×${spreadY.toFixed(1)} px; size ratio ${widthRatio.toFixed(2)}×${heightRatio.toFixed(2)}). Compare the layers or explicitly approve the exception.`,
    });
  });
  return warnings;
}

export function reviveRuntimeAssetRecord(record) {
  return runtimeAssetRecord({
    ...record,
    blob: record?.blob,
    thumbnailBlob: record?.thumbnailBlob,
  });
}

export function revokeRuntimeAsset(record) {
  if (record?.url?.startsWith('blob:')) URL.revokeObjectURL(record.url);
  if (record?.thumbnailUrl?.startsWith('blob:')) URL.revokeObjectURL(record.thumbnailUrl);
}

export function createCachedAssetResolver(assetMap) {
  const bitmapCache = new Map();
  const pending = new Map();
  const resolveRecord = (assetId) => assetMap instanceof Map ? assetMap.get(assetId) : assetMap?.[assetId];
  return {
    async resolve(assetId) {
      if (bitmapCache.has(assetId)) return bitmapCache.get(assetId);
      if (pending.has(assetId)) return pending.get(assetId);
      const record = resolveRecord(assetId);
      if (!record) throw new Error(`Missing Maker asset: ${assetId}`);
      const task = (async () => {
        const source = record.blob || record.file || record.url;
        if (!source) throw new Error(`Maker asset ${assetId} has no readable source.`);
        let bitmap;
        if (typeof source === 'string') {
          const response = await fetch(source);
          if (!response.ok) throw new Error(`Maker asset ${assetId} returned ${response.status}.`);
          bitmap = await createImageBitmap(await response.blob());
        } else {
          bitmap = await createImageBitmap(source);
        }
        bitmapCache.set(assetId, bitmap);
        return bitmap;
      })().finally(() => pending.delete(assetId));
      pending.set(assetId, task);
      return task;
    },
    prefetch(assetIds) {
      return Promise.allSettled([...new Set(assetIds)].map((assetId) => this.resolve(assetId)));
    },
    clear() {
      bitmapCache.forEach((bitmap) => bitmap?.close?.());
      bitmapCache.clear();
      pending.clear();
    },
  };
}

export { MAX_MAKER_ASSET_BYTES, MAX_MAKER_ASSET_EDGE };
