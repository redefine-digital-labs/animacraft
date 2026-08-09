export const CURRENT_MAKER_DATA_EPOCH = 'animacraft-maker-data-v7';

export function makerDataEpoch(document) {
  return String(document?.extensions?.dataEpoch || '').trim();
}

export function isCurrentMakerDataEpoch(document) {
  return makerDataEpoch(document) === CURRENT_MAKER_DATA_EPOCH;
}

export function stampCurrentMakerDataEpoch(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('A Maker document is required to stamp the current data epoch.');
  }
  document.extensions = {
    ...(document.extensions && typeof document.extensions === 'object'
      ? document.extensions
      : {}),
    dataEpoch: CURRENT_MAKER_DATA_EPOCH,
  };
  return document;
}
