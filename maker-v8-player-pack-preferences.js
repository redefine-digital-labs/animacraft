import { MAKER_V8_CATALOG_DIAGNOSTIC_SCHEMA } from './maker-v8-catalog-adapter.js';

// Local catalog visibility only. These IDs are never proof of a PackPass and
// never contribute to transaction usedPacks unless its Styles are selected.
const ID = /^0x[0-9a-f]{64}$/;
export const MAKER_V8_PACK_MANIFEST_UNAVAILABLE = 'MAKER_V8_PRODUCT_PACK_MANIFEST_UNAVAILABLE';

export function makerV8UnavailablePackManifestIds(choices) {
  if (!Array.isArray(choices?.diagnostics)) return [];
  return choices.diagnostics.filter(row => row?.schemaVersion === MAKER_V8_CATALOG_DIAGNOSTIC_SCHEMA
    && row.code === MAKER_V8_PACK_MANIFEST_UNAVAILABLE && row.severity === 'WARNING' && row.layer === 'MANIFEST'
    && row.rootId === choices.rootId && typeof row.details?.releaseId === 'string'
    && ID.test(row.details.releaseId)).map(row => row.details.releaseId);
}

export function hasOnlyUnavailablePackDiagnostics(choices) {
  const unavailable = new Set(makerV8UnavailablePackManifestIds(choices));
  return Array.isArray(choices?.diagnostics) && choices.diagnostics.length === unavailable.size
    && Array.isArray(choices.packStyles) && !choices.packStyles.some(row => unavailable.has(row?.releaseId));
}

export function assertMakerV8EnabledPackReleaseIds(value, recipe = null) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw new TypeError('Enabled Pack releases must be a dense array of exact IDs.');
  }
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (!Object.hasOwn(value, index) || typeof id !== 'string' || !ID.test(id)
      || (index > 0 && value[index - 1] >= id)) {
      throw new TypeError('Enabled Pack releases must be unique, sorted exact IDs.');
    }
  }
  if (recipe?.selections?.some(selection => selection.source === 'PACK'
    && !value.includes(selection.releaseId))) {
    throw new TypeError('A selected Pack Style must belong to an enabled Pack.');
  }
  return value;
}
