export const OC_OUTPUT_PREVIEW_V5_SCHEMA =
  'animacraft.complete-output-preview.v1';
export const OC_OUTPUT_PREVIEW_MAX_EDGE = 512;

export function fitOcOutputPreviewDimensionsV5(
  width,
  height,
  maximumEdge = OC_OUTPUT_PREVIEW_MAX_EDGE,
) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  const limit = Number(maximumEdge);
  if (
    !Number.isSafeInteger(sourceWidth)
    || !Number.isSafeInteger(sourceHeight)
    || sourceWidth < 1
    || sourceHeight < 1
    || !Number.isSafeInteger(limit)
    || limit < 64
    || limit > 2_048
  ) {
    throw new TypeError('OC preview dimensions are invalid.');
  }
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  return Object.freeze({
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  });
}

function canvasBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('PNG preview encoding failed.')),
      'image/png',
    );
  });
}

/**
 * Create a deliberately non-final public image for galleries and Soul cards.
 * The exact reviewed PNG is never drawn at its original dimensions when it is
 * larger than the preview ceiling, and the visible badge prevents this Blob
 * from being mistaken for the paid final export.
 */
export async function createOcOutputPreviewBlobV5(
  sourceBlob,
  {
    maximumEdge = OC_OUTPUT_PREVIEW_MAX_EDGE,
    label = 'ANIMACRAFT · OC PREVIEW',
  } = {},
) {
  if (
    !sourceBlob
    || typeof sourceBlob.arrayBuffer !== 'function'
    || sourceBlob.type !== 'image/png'
    || sourceBlob.size < 1
  ) {
    throw new TypeError('The exact completed PNG is required for its public preview.');
  }
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw new Error('This browser cannot create the protected OC preview.');
  }
  const bitmap = await globalThis.createImageBitmap(sourceBlob);
  try {
    const dimensions = fitOcOutputPreviewDimensionsV5(
      bitmap.width,
      bitmap.height,
      maximumEdge,
    );
    const canvas = globalThis.document?.createElement?.('canvas');
    if (!canvas) throw new Error('This browser cannot create the OC preview canvas.');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('This browser cannot render the OC preview.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

    const fontSize = Math.max(11, Math.round(Math.min(dimensions.width, dimensions.height) * 0.032));
    const paddingX = Math.max(8, Math.round(fontSize * 0.7));
    const paddingY = Math.max(6, Math.round(fontSize * 0.45));
    context.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = 'middle';
    const badgeWidth = Math.min(
      dimensions.width,
      Math.ceil(context.measureText(label).width + paddingX * 2),
    );
    const badgeHeight = Math.ceil(fontSize + paddingY * 2);
    const badgeX = Math.max(0, dimensions.width - badgeWidth);
    const badgeY = Math.max(0, dimensions.height - badgeHeight);
    context.fillStyle = 'rgba(23, 20, 34, 0.78)';
    context.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
    context.fillStyle = '#ffffff';
    context.fillText(
      label,
      badgeX + paddingX,
      badgeY + badgeHeight / 2,
      Math.max(1, badgeWidth - paddingX * 2),
    );

    const preview = await canvasBlob(canvas);
    if (!preview || preview.type !== 'image/png' || preview.size < 1) {
      throw new Error('The public OC preview is empty.');
    }
    return preview;
  } finally {
    bitmap.close?.();
  }
}
