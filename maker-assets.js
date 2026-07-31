const MAX_MAKER_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_MAKER_ASSET_EDGE = 8_192;
const MAX_MAKER_ASSET_PIXELS = 16 * 1024 * 1024;
const MAX_MAKER_ASSET_CACHE_PIXELS = 32 * 1024 * 1024;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

function makerAssetLimitError(message) {
  const error = new Error(message);
  error.code = 'MAKER_ASSET_LIMIT_EXCEEDED';
  return error;
}

function makerAssetAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException === 'function') return new DOMException('Maker asset loading was aborted.', 'AbortError');
  const error = new Error('Maker asset loading was aborted.');
  error.name = 'AbortError';
  return error;
}

function makerAssetLabel(value) {
  const label = String(value || '').trim();
  return label || 'Maker asset';
}

function declaredResponseBytes(response) {
  const raw = response?.headers?.get?.('content-length');
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) return null;
  const bytes = Number(normalized);
  return Number.isSafeInteger(bytes) ? bytes : Number.POSITIVE_INFINITY;
}

async function responseBlobWithinMakerAssetLimit(response, {
  controller,
  label,
  maxBytes = MAX_MAKER_ASSET_BYTES,
} = {}) {
  const assetLabel = makerAssetLabel(label);
  const declaredBytes = declaredResponseBytes(response);
  if (declaredBytes !== null && declaredBytes > maxBytes) {
    controller?.abort?.();
    throw makerAssetLimitError(`${assetLabel} is larger than 20 MB.`);
  }

  const contentType = String(response?.headers?.get?.('content-type') || 'image/png');
  const reader = response?.body?.getReader?.();
  if (!reader) {
    controller?.abort?.();
    const error = new Error(`${assetLabel} cannot be safely streamed.`);
    error.code = 'MAKER_ASSET_STREAM_UNAVAILABLE';
    throw error;
  }

  const chunks = [];
  let bytesRead = 0;
  try {
    while (true) {
      if (controller?.signal?.aborted) throw makerAssetAbortError(controller.signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      bytesRead += chunk.byteLength;
      if (bytesRead > maxBytes) {
        const error = makerAssetLimitError(`${assetLabel} is larger than 20 MB.`);
        try {
          await reader.cancel(error);
        } catch {
          // The size error below is authoritative even if stream cancellation fails.
        }
        controller?.abort?.(error);
        throw error;
      }
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original read, limit, or abort failure.
    }
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  return new Blob(chunks, { type: contentType });
}

export async function fetchMakerAssetBlob(url, {
  signal,
  label,
  maxBytes = MAX_MAKER_ASSET_BYTES,
} = {}) {
  if (typeof fetch !== 'function') throw new Error('Remote Maker assets require browser fetch support.');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener?.('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${makerAssetLabel(label)} returned ${response.status}.`);
    return await responseBlobWithinMakerAssetLimit(response, {
      controller,
      label,
      maxBytes,
    });
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    signal?.removeEventListener?.('abort', forwardAbort);
  }
}

export function assertMakerAssetDimensions(source, label) {
  const width = Number(source?.width ?? source?.naturalWidth ?? source?.videoWidth ?? 0);
  const height = Number(source?.height ?? source?.naturalHeight ?? source?.videoHeight ?? 0);
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || width > MAX_MAKER_ASSET_EDGE
    || height > MAX_MAKER_ASSET_EDGE
    || width * height > MAX_MAKER_ASSET_PIXELS
  ) {
    throw makerAssetLimitError(`${makerAssetLabel(label)} has unsupported dimensions.`);
  }
  return { width, height };
}

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
 * Part × Item × Style.
 *
 * Recommended layout:
 *   part/item/style.png
 *
 * A Style is one renderable PNG. Its global Layer Track is selected in the
 * import confirmation UI rather than represented by another child level.
 */
export function buildProjectAssetImportMapping(files, document) {
  const tracks = document?.layerTracks || [];
  const parts = document?.parts || [];
  return [...files].map((file) => {
    const relativePath = String(file.webkitRelativePath || file.name || '');
    const pathToken = normalizedToken(relativePath);
    const pathSegments = relativePath.split(/[\\/]/).map(normalizedToken).filter(Boolean);
    const part = bestPathMatch(pathToken, pathSegments, parts, ['id', 'name']).entry;
    const item = bestPathMatch(pathToken, pathSegments, part?.items || [], ['importKey', 'id', 'name']).entry;
    const style = bestPathMatch(pathToken, pathSegments, item?.styles || [], ['id', 'name']).entry
      || (item?.styles?.length === 1 ? item.styles[0] : null);
    const track = bestPathMatch(pathToken, pathSegments, tracks, ['id', 'name']).entry;
    const requiredMatches = [part, item, style].filter(Boolean).length;
    return {
      file,
      fileName: relativePath || String(file.name || ''),
      targetDefinition: part && item && style ? `${part.id}::${item.id}::${style.id}` : '',
      trackId: track?.id || '',
      confidence: requiredMatches === 3 ? 'matched' : requiredMatches >= 2 ? 'review' : 'unmapped',
      suggestedTrackName: track?.name || '',
    };
  });
}

export function createAssetId(prefix = 'asset') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${normalizedToken(prefix).replace(/\s+/g, '-') || 'asset'}-${id}`;
}

export function initialPngTransform(widthValue, heightValue, makerCanvas = {}) {
  const width = Math.max(1, Number(widthValue || 0));
  const height = Math.max(1, Number(heightValue || 0));
  const canvasWidth = Math.max(1, Number(makerCanvas.width || 0));
  const canvasHeight = Math.max(1, Number(makerCanvas.height || 0));
  const fullCanvas = width === canvasWidth && height === canvasHeight;
  const scale = fullCanvas ? 1 : Math.min(1, canvasWidth / width, canvasHeight / height);
  return {
    x: fullCanvas ? 0 : Math.round((canvasWidth - (width * scale)) / 2),
    y: fullCanvas ? 0 : Math.round((canvasHeight - (height * scale)) / 2),
    scale,
    rotation: 0,
  };
}

async function hasPngSignature(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  const headerSource = typeof file.slice === 'function' ? file.slice(0, PNG_SIGNATURE.length) : file;
  const bytes = new Uint8Array(await headerSource.arrayBuffer());
  return bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export async function inspectPngAsset(file, makerCanvas) {
  if (!file || (!String(file.type || '').includes('image/png') && !String(file.name || '').toLowerCase().endsWith('.png'))) {
    throw new Error('Maker artwork must be a PNG file with transparency support.');
  }
  if (Number(file.size || 0) > MAX_MAKER_ASSET_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);
  if (await hasPngSignature(file) === false) {
    throw new Error(`${file.name || 'Maker artwork'} is not a real PNG file.`);
  }
  const bitmap = await createImageBitmap(file);
  let dimensions;
  try {
    dimensions = assertMakerAssetDimensions(bitmap, file.name || 'Maker artwork');
  } catch (error) {
    bitmap.close?.();
    throw error;
  }
  const { width, height } = dimensions;
  let alphaBounds = null;
  let alphaAnalyzed = false;
  let visiblePixelCount = 0;
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
      alphaAnalyzed = true;
      let minX = analysisWidth;
      let minY = analysisHeight;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < analysisHeight; y += 1) {
        for (let x = 0; x < analysisWidth; x += 1) {
          if (pixels[((y * analysisWidth) + x) * 4 + 3] < 8) continue;
          visiblePixelCount += 1;
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
  const canvasWidth = Number(makerCanvas?.width || 0);
  const canvasHeight = Number(makerCanvas?.height || 0);
  const fullCanvas = width === canvasWidth && height === canvasHeight;
  return {
    width,
    height,
    fullCanvas,
    alphaBounds,
    alphaAnalyzed,
    hasVisiblePixels: alphaAnalyzed ? visiblePixelCount > 0 : null,
    // Use the complete source PNG for predictable import placement. Alpha
    // bounds remain thumbnail and alignment-diagnostic metadata only.
    initialTransform: initialPngTransform(width, height, makerCanvas),
    warning: fullCanvas ? '' : 'Cropped artwork: confirm its position before publishing.',
  };
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the image preview.')), type, quality);
  });
}

export async function createAlphaCroppedThumbnail(blob, size = 256) {
  if (Number(blob?.size || 0) > MAX_MAKER_ASSET_BYTES) {
    throw makerAssetLimitError('Maker thumbnail source is larger than 20 MB.');
  }
  const bitmap = await createImageBitmap(blob);
  let readCanvas;
  let readContext;
  try {
    const dimensions = assertMakerAssetDimensions(bitmap, 'Maker thumbnail source');
    readCanvas = document.createElement('canvas');
    readCanvas.width = dimensions.width;
    readCanvas.height = dimensions.height;
    readContext = readCanvas.getContext('2d', { willReadFrequently: true });
    readContext.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close?.();
  }
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

export function runtimeAssetRecord({
  assetId,
  blob,
  fileName,
  width,
  height,
  alphaBounds = null,
  alphaAnalyzed = false,
  hasVisiblePixels = null,
  thumbnailBlob = null,
  source = 'local',
}) {
  return {
    assetId,
    blob,
    fileName: String(fileName || `${assetId}.png`),
    width: Number(width || 0),
    height: Number(height || 0),
    alphaBounds,
    alphaAnalyzed: alphaAnalyzed === true,
    hasVisiblePixels: hasVisiblePixels === null ? null : hasVisiblePixels === true,
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
    .forEach((item) => (item.styles || []).forEach((style) => {
      const bounds = recordFor(style.assetId)?.alphaBounds;
      if (!bounds) return;
      const entries = groups.get(style.layerTrackId) || [];
      entries.push({ part, item, style, bounds });
      groups.set(style.layerTrackId, entries);
    })));
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
  const revived = runtimeAssetRecord({
    ...record,
    blob: record?.blob,
    thumbnailBlob: record?.thumbnailBlob,
  });
  const remoteUrl = String(record?.url || '');
  const remoteThumbnailUrl = String(record?.thumbnailUrl || '');
  if (!revived.url && remoteUrl && !remoteUrl.startsWith('blob:')) revived.url = remoteUrl;
  if (
    !revived.thumbnailUrl
    && remoteThumbnailUrl
    && !remoteThumbnailUrl.startsWith('blob:')
  ) revived.thumbnailUrl = remoteThumbnailUrl;
  return revived;
}

export function revokeRuntimeAsset(record) {
  if (record?.url?.startsWith('blob:')) URL.revokeObjectURL(record.url);
  if (record?.thumbnailUrl?.startsWith('blob:')) URL.revokeObjectURL(record.thumbnailUrl);
}

export function createCachedAssetResolver(assetMap) {
  const bitmapCache = new Map();
  const pending = new Map();
  let decodedPixelTotal = 0;
  let generation = 0;
  const resolveRecord = (assetId) => assetMap instanceof Map ? assetMap.get(assetId) : assetMap?.[assetId];
  const cachedBitmap = (assetId) => {
    const entry = bitmapCache.get(assetId);
    if (!entry) return null;
    // Map insertion order doubles as a deterministic least-recently-used queue.
    bitmapCache.delete(assetId);
    bitmapCache.set(assetId, entry);
    return entry.bitmap;
  };
  const cacheBitmap = (assetId, bitmap, pixels) => {
    bitmapCache.set(assetId, { bitmap, pixels });
    decodedPixelTotal += pixels;
    while (decodedPixelTotal > MAX_MAKER_ASSET_CACHE_PIXELS && bitmapCache.size > 1) {
      const [oldestAssetId, oldest] = bitmapCache.entries().next().value;
      bitmapCache.delete(oldestAssetId);
      decodedPixelTotal -= oldest.pixels;
      oldest.bitmap?.close?.();
    }
  };
  return {
    async resolve(assetId) {
      const cached = cachedBitmap(assetId);
      if (cached) return cached;
      if (pending.has(assetId)) return pending.get(assetId).promise;
      const record = resolveRecord(assetId);
      if (!record) throw new Error(`Missing Maker asset: ${assetId}`);
      const controller = new AbortController();
      const taskGeneration = generation;
      const task = (async () => {
        let source;
        if (record.protection) {
          if (typeof record.resolveBlob !== 'function') {
            const error = new Error(
              `Maker asset ${assetId} is protected and has no authorized decryptor.`,
            );
            error.code = 'MAKER_ASSET_PROTECTED';
            throw error;
          }
          source = await record.resolveBlob({
            assetId,
            record,
            signal: controller.signal,
          });
        } else {
          source = record.blob || record.file || record.url;
        }
        if (!source) throw new Error(`Maker asset ${assetId} has no readable source.`);
        let bitmap = null;
        try {
          let bitmapSource = source;
          if (typeof source === 'string') {
            bitmapSource = await fetchMakerAssetBlob(source, {
              signal: controller.signal,
              label: `Maker asset ${assetId}`,
            });
          } else if (typeof Blob !== 'undefined' && source instanceof Blob && source.size > MAX_MAKER_ASSET_BYTES) {
            throw makerAssetLimitError(`Maker asset ${assetId} is larger than 20 MB.`);
          }
          bitmap = await createImageBitmap(bitmapSource);
          const dimensions = assertMakerAssetDimensions(bitmap, `Maker asset ${assetId}`);
          if (controller.signal.aborted || taskGeneration !== generation) {
            throw makerAssetAbortError(controller.signal);
          }
          cacheBitmap(assetId, bitmap, dimensions.width * dimensions.height);
          return bitmap;
        } catch (error) {
          bitmap?.close?.();
          throw error;
        }
      })().finally(() => {
        if (pending.get(assetId)?.promise === task) pending.delete(assetId);
      });
      pending.set(assetId, { promise: task, controller });
      return task;
    },
    prefetch(assetIds) {
      return Promise.allSettled([...new Set(assetIds)].map((assetId) => this.resolve(assetId)));
    },
    clear() {
      generation += 1;
      pending.forEach((entry) => entry.controller.abort());
      bitmapCache.forEach((entry) => entry.bitmap?.close?.());
      bitmapCache.clear();
      decodedPixelTotal = 0;
      pending.clear();
    },
  };
}

export {
  MAX_MAKER_ASSET_BYTES,
  MAX_MAKER_ASSET_CACHE_PIXELS,
  MAX_MAKER_ASSET_EDGE,
  MAX_MAKER_ASSET_PIXELS,
};
