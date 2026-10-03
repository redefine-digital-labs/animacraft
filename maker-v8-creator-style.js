import { assertMakerV8Document } from './maker-v8-document.js';

export const CREATOR_STYLE_VALUE_ACTIONS = Object.freeze([
  'style-x', 'style-y', 'style-scale', 'style-rotation', 'style-scale-preview',
  'style-opacity', 'style-blend', 'style-position-locked', 'style-locked',
]);

export function creatorStyleEditorState(style) {
  const editor = style?.payload?.animacraftEditor;
  return {
    styleLocked: editor?.styleLocked === true,
    positionLocked: editor?.positionLocked === true || editor?.styleLocked === true,
    positionConfirmed: editor?.positionConfirmed !== false,
  };
}

function editorPayload(style) {
  const current = style.payload.animacraftEditor;
  if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) {
    throw new TypeError('The existing Style editor metadata cannot be overwritten.');
  }
  for (const key of ['styleLocked', 'positionLocked', 'positionConfirmed']) {
    if (current?.[key] !== undefined && typeof current[key] !== 'boolean') {
      throw new TypeError(`Style editor ${key} must be a boolean.`);
    }
  }
  return style.payload.animacraftEditor = { ...current };
}

function exactNumber(raw, field, multiplier, minimum, maximum) {
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) {
    throw new TypeError(`${field} needs a number.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum
    || Math.round(value * multiplier) / multiplier !== value) {
    throw new TypeError(`${field} must be between ${minimum} and ${maximum}, with at most ${Math.log10(multiplier)} decimal places.`);
  }
  return value;
}

export function exactCreatorTransform(transform) {
  if (!transform || typeof transform !== 'object' || Array.isArray(transform)
    || Object.keys(transform).sort().join(',') !== 'rotation,scale,x,y') {
    throw new TypeError('A Style preview requires one exact transform.');
  }
  return {
    x: exactNumber(transform.x, 'X', 1000, -8192, 8192),
    y: exactNumber(transform.y, 'Y', 1000, -8192, 8192),
    scale: exactNumber(transform.scale, 'Scale', 1e6, 0.000001, 100),
    rotation: exactNumber(transform.rotation, 'Rotate', 1000, -360, 360),
  };
}

/** Local author edits. The payload flags are editor state, never ownership rights. */
export function prepareCreatorStyleChange({ document, partKey, itemKey, styleKey, action, value, transform }) {
  assertMakerV8Document(document, { mode: 'draft' });
  const next = structuredClone(document);
  const style = next.parts.find(part => part.key === partKey)?.items.find(item => item.key === itemKey)
    ?.styles.find(row => row.key === styleKey);
  if (!style) throw new TypeError('The selected Maker Style no longer exists.');
  const before = JSON.stringify(style);
  const locks = creatorStyleEditorState(style);
  if (action !== 'style-locked' && locks.styleLocked) throw new TypeError('Unlock the whole Style before editing it.');
  if (['style-locked', 'style-position-locked', 'confirm-position'].includes(action)) {
    if (action === 'confirm-position') {
      if (locks.positionLocked || !style.assetId) throw new TypeError('An unlocked PNG Style is required to confirm position.');
      editorPayload(style).positionConfirmed = true;
    } else {
      if (typeof value !== 'boolean') throw new TypeError('Style lock must be a boolean.');
      editorPayload(style)[action === 'style-locked' ? 'styleLocked' : 'positionLocked'] = value;
    }
  } else if (action === 'style-opacity') {
    style.opacity = exactNumber(value, 'Opacity (%)', 10000, 0, 100) / 100;
    // Division may introduce binary noise; preserve the supported millionth value.
    style.opacity = Math.round(style.opacity * 1e6) / 1e6;
  } else if (action === 'style-blend') {
    style.blendMode = value;
  } else if (['style-x', 'style-y', 'style-scale', 'style-rotation', 'style-scale-preview', 'style-drag'].includes(action)) {
    if (locks.positionLocked) throw new TypeError('Unlock the position before moving this Style.');
    let candidate = { ...style.transform };
    if (action === 'style-drag') candidate = transform;
    else if (action === 'style-scale-preview') candidate.scale = exactNumber(value, 'Scale on Canvas (%)', 1, 5, 400) / 100;
    else {
      const field = action.slice('style-'.length);
      candidate[field] = value;
    }
    style.transform = exactCreatorTransform(candidate);
    if (next.canvas.pixelMode === 'pixelated') {
      for (const field of ['x', 'y']) {
        if (action === 'style-drag' || action === `style-${field}`) style.transform[field] = Math.round(style.transform[field]);
      }
    }
    editorPayload(style).positionConfirmed = false;
  } else throw new TypeError('Unknown Style edit.');
  assertMakerV8Document(next, { mode: 'draft' });
  return { document: next, changed: before !== JSON.stringify(style) };
}
