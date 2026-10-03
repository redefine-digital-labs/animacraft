import { validateMakerV8Rule, MAKER_V8_RULE_FIELDS, MAKER_V8_RULE_SELECTOR_FIELDS } from './maker-v8-rules.js';
import { isMakerV8SourceAssetHash, isMakerV8SourceAssetField } from './maker-v8-source-asset.js';
import { validateMakerV8Visibility, evaluateMakerV8Visibility } from './maker-v8-visibility.js';
import { MAKER_V8_BLEND_MODES } from './maker-v8-render-core.js';
import { createDefaultMakerV8LivingContentV8, assertMakerV8LivingContentShapeV8 } from './maker-v8-living-content.js';
export { MAKER_V8_LIVING_CONTENT_SCHEMA, MAKER_V8_LIVING_CONTENT_KEYS } from './maker-v8-living-content.js';
import {
  collectMakerV8CommerceIssues,
  createMakerV8Commerce,
} from './maker-commerce-v8.js';

export const MAKER_V8_DOCUMENT_SCHEMA = 'animacraft.maker.v8';
export const MAKER_V8_DOCUMENT_VERSION = 8;

export const MAKER_V8_PART_KINDS = Object.freeze({
  STANDARD: 'STANDARD',
  LEFT_RIGHT_PAIR: 'LEFT_RIGHT_PAIR',
  LAST_BASTION: 'LAST_BASTION',
});

export const MAKER_V8_COMPOSITION_MODES = Object.freeze({
  FIXED: 'FIXED',
  COMPOSABLE: 'COMPOSABLE',
});

export const MAKER_V8_THIRD_PARTY_ADMISSION_MODES = Object.freeze({
  DISABLED: 'DISABLED',
  CERTIFIED: 'CERTIFIED',
  OPEN: 'OPEN',
});

export const MAKER_V8_WARDROBE_MODES = Object.freeze({
  FIXED: 'FIXED',
  SLOT: 'SLOT',
});

export const MAKER_V8_RULE_KINDS = Object.freeze({
  REQUIRE: 'REQUIRE',
  EXCLUDE: 'EXCLUDE',
});

export const MAKER_V8_OUTPUT_PACK_POLICIES = Object.freeze({
  ALL_ADMITTED: 'ALL_ADMITTED',
  ALLOWLIST: 'ALLOWLIST',
});

export const MAKER_V8_PHYSICAL_ISSUANCE = Object.freeze({
  FREE_CLAIM: 'FREE_CLAIM',
  PAID_PURCHASE: 'PAID_PURCHASE',
  PROOF_MATERIALIZE: 'PROOF_MATERIALIZE',
});

export const MAKER_V8_PHYSICAL_PROOFS = Object.freeze({
  NONE: 'NONE',
  CANONICAL_SOUL: 'CANONICAL_SOUL',
});

const SAFE_KEY = /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ATOMIC = /^(?:0|[1-9][0-9]{0,19})$/;
const RGBA = /^#[0-9a-fA-F]{8}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,127}$/i;
const U64_MAX = (1n << 64n) - 1n;
const MAX_DEPTH = 64;
// Canonical byte/count budgets remain the primary memory bound; this ceiling
// only rejects hostile JSON graph expansion.
const MAX_NODES = 1_000_000;

// Protocol ordering is the ECMAScript UTF-16 code-unit order used by JSON
// member sorting. It is deliberately independent of locale and ICU data.
export function compareMakerV8ProtocolText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const LIMITS = Object.freeze({
  tracks: 256,
  parts: 750,
  totalPartCapacity: 500,
  items: 5_000,
  // Schema2 seal visits Part, Style and Item index/row children, referenced Color
  // channels, and referenced Assets. Its current metered module is pinned by
  // runtime attestation; private author-only rows do not enter this transaction.
  styles: 500,
  authorStyles: 25_000,
  styleSealObjectRuntimeUnits: 1_000,
  colors: 5_000,
  rules: 1_000,
  outputs: 256,
  assets: 4_999,
  packIdsPerOutput: 64,
  totalPackEdges: 64,
});

const FIELDS = Object.freeze({
  document: ['schemaVersion', 'protocolVersion', 'lineage', 'metadata', 'canvas', 'composition', 'tracks', 'colors', 'parts', 'rules', 'defaultRecipe', 'outputs', 'commerce', 'assets', 'livingContent'],
  lineage: [
    'makerKey', 'version', 'previousRootId', 'previousVersionCommitment', 'changelog',
  ],
  metadata: ['name', 'summary', 'license', 'coverAssetId'],
  license: ['kind', 'note'],
  canvas: ['width', 'height', 'pixelMode'],
  composition: ['mode', 'thirdPartyAdmission', 'itemAssetization'],
  track: ['key', 'label', 'renderOrder', 'locked'],
  color: ['key', 'label', 'defaultSwatchKey', 'swatches'],
  swatch: ['key', 'label', 'rgba', 'stops'],
  stop: ['offset', 'rgba'],
  part: ['key', 'label', 'kind', 'renderOrder', 'menuOrder', 'visible', 'required', 'wardrobeMode', 'capacity', 'items', 'payload'],
  item: ['key', 'label', 'status', 'displayOrder', 'defaultStyleKey', 'styles', 'payload'],
  style: ['key', 'label', 'displayOrder', 'trackKey', 'colorChannelKey', 'defaultSwatchKey', 'assetId', 'protected', 'transform', 'opacity', 'blendMode', 'physical', 'payload'],
  transform: ['x', 'y', 'scale', 'rotation'],
  physical: ['material', 'issuance', 'proof', 'priceAtomic', 'maxSupply', 'transferable'],
  rule: MAKER_V8_RULE_FIELDS,
  ruleRef: MAKER_V8_RULE_SELECTOR_FIELDS,
  recipe: ['selections', 'colors'],
  selection: ['partKey', 'itemKey', 'styleKey'],
  recipeColor: ['channelKey', 'swatchKey'],
  output: ['key', 'label', 'protected', 'allowedPackPolicy', 'payload'],
  packPolicy: ['kind', 'packIds'],
  asset: ['id', 'kind', 'mediaType', 'byteLength'],
  commerce: ['schemaVersion', 'rightsOrigin', 'rightsOriginConfirmed', 'rightsEvidence', 'makerAccess', 'baseCompletion', 'soulCreatorRoyaltyBps', 'makerSourceRoyaltyBps', 'makerResaleRoyaltyBps'],
  rightsEvidence: ['licensor', 'evidenceAssetId'],
  makerAccess: ['mode', 'purchasePriceAtomic'],
  completionPolicy: ['mode', 'freeQuotaPerWallet', 'priceAtomic', 'totalCap'],
});

const COMPILER_OWNED_KEYS = new Set([
  'chainid', 'network', 'creator', 'owner', 'sender', 'signer', 'wallet',
  'walletaddress', 'package', 'packageid', 'callablepackageid', 'typeorigin',
  'typeoriginid', 'objectid', 'rootid', 'makerrootid', 'catalogid', 'configid',
  'registryid', 'treasuryid', 'admincapid', 'releaseid', 'listingid', 'soulid',
  'outputid', 'receiptid', 'physicalassetid', 'blobid', 'manifestblobid',
  'assetblobid', 'sha256', 'commitment', 'digest', 'signature', 'signedbytes',
  'transactiondigest', 'receiving', 'receivingref', 'predecessorid',
]);

function normalizeOwnedKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isCompilerOwnedKey(key) {
  const normalized = normalizeOwnedKey(key);
  return COMPILER_OWNED_KEYS.has(normalized)
    || normalized.endsWith('commitment')
    || normalized.endsWith('sha256')
    || normalized.endsWith('digest')
    || normalized.endsWith('blobid')
    || normalized.includes('transactionbytes')
    || normalized.includes('packageid')
    || normalized.includes('typeorigin')
    || normalized.includes('receivingref');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function issue(issues, path, code, message, details = undefined) {
  issues.push(Object.freeze(details === undefined ? { path, code, message } : { path, code, message, details: Object.freeze({ ...details }) }));
}

function inspectJsonTree(root, issues) {
  const stack = [{ value: root, path: '', depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_NODES || current.depth > MAX_DEPTH) {
      issue(issues, current.path, 'MAKER_V8_DOCUMENT_LIMIT', 'Document exceeds the bounded JSON tree limit.');
      return null;
    }
    const value = current.value;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) issue(issues, current.path, 'MAKER_V8_JSON_NUMBER_INVALID', 'Document numbers must be finite.');
      continue;
    }
    if (!value || typeof value !== 'object' || typeof value === 'bigint') {
      issue(issues, current.path, 'MAKER_V8_JSON_VALUE_INVALID', 'Document must contain plain JSON values only.');
      continue;
    }
    if (seen.has(value)) {
      issue(issues, current.path, 'MAKER_V8_JSON_GRAPH_INVALID', 'Document cannot contain cycles or shared object references.');
      continue;
    }
    seen.add(value);
    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      issue(issues, current.path, 'MAKER_V8_JSON_UNREADABLE', 'Document could not be inspected safely.');
      continue;
    }
    const array = Array.isArray(value);
    if ((array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)
      || keys.some((key) => typeof key !== 'string')) {
      issue(issues, current.path, 'MAKER_V8_JSON_RECORD_INVALID', 'Document requires standard JSON objects and arrays.');
      continue;
    }
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      const allowed = new Set(['length']);
      for (let index = 0; index < length; index += 1) allowed.add(String(index));
      if (!Number.isSafeInteger(length) || length < 0
        || keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
        issue(issues, current.path, 'MAKER_V8_JSON_ARRAY_INVALID', 'Arrays must be dense and cannot contain extra properties.');
        continue;
      }
    }
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const path = array ? `${current.path}[${key}]` : current.path ? `${current.path}.${key}` : key;
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        issue(issues, path, 'MAKER_V8_JSON_PROPERTY_INVALID', 'Document accepts enumerable data properties only.');
        continue;
      }
      const certifiedLineageField = path === 'lineage.previousRootId'
        || path === 'lineage.previousVersionCommitment';
      // Maker Info's bounded display name never supplies a signing identity.
      const displayCreatorField = path === 'metadata.creator';
      if (key === 'animacraftSourceAsset' && !isMakerV8SourceAssetField(path, descriptor.value)) {
        issue(issues, path, 'MAKER_V8_SOURCE_ASSET_MISMATCH', 'Reserved source metadata requires the exact Style payload schema.');
      }
      if (!array && isCompilerOwnedKey(key) && !certifiedLineageField && !displayCreatorField
        && !isMakerV8SourceAssetHash(path, value)) {
        issue(issues, path, 'MAKER_V8_COMPILER_FIELD_FORBIDDEN', `${path} is compiler-owned and cannot be authored.`);
      }
      stack.push({ value: descriptor.value, path, depth: current.depth + 1 });
    }
  }
  if (issues.length) return null;
  try {
    return structuredClone(root);
  } catch {
    issue(issues, '', 'MAKER_V8_JSON_UNREADABLE', 'Document could not be snapshotted safely.');
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactRecord(value, fields, path, issues, optionalFields = []) {
  if (!isRecord(value)) {
    issue(issues, path, 'MAKER_V8_RECORD_INVALID', `${path || 'document'} must be a plain object.`);
    return false;
  }
  const expected = new Set([...fields, ...optionalFields]);
  Object.keys(value).forEach((key) => {
    if (!expected.has(key)) issue(issues, path ? `${path}.${key}` : key, 'MAKER_V8_FIELD_UNKNOWN', `${key} is not part of the exact v8 schema.`);
  });
  fields.forEach((key) => {
    if (!Object.hasOwn(value, key)) issue(issues, path ? `${path}.${key}` : key, 'MAKER_V8_FIELD_REQUIRED', `${key} is required by the exact v8 schema.`);
  });
  return true;
}

function validateKey(value, path, issues) {
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) {
    issue(issues, path, 'MAKER_V8_KEY_INVALID', `${path} must be a safe semantic key, never a Sui object ID.`);
    return false;
  }
  return true;
}

function validateText(value, path, issues, { required = true, maximum = 1024 } = {}) {
  if (typeof value !== 'string' || (required && !value.trim()) || new TextEncoder().encode(value).length > maximum) {
    issue(issues, path, 'MAKER_V8_TEXT_INVALID', `${path} is not valid bounded text.`);
    return false;
  }
  return true;
}

function validateAtomic(value, path, issues, { positive = false } = {}) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : String(value ?? '');
  if (!ATOMIC.test(text)) {
    issue(issues, path, 'MAKER_V8_U64_INVALID', `${path} must be a canonical decimal u64.`);
    return false;
  }
  const amount = BigInt(text);
  if (amount > U64_MAX || (positive && amount === 0n)) {
    issue(issues, path, 'MAKER_V8_U64_INVALID', `${path} is outside its allowed u64 range.`);
    return false;
  }
  return true;
}

function uniqueKeys(rows, path, issues) {
  if (!Array.isArray(rows)) {
    issue(issues, path, 'MAKER_V8_ARRAY_INVALID', `${path} must be an array.`);
    return new Set();
  }
  const seen = new Set();
  rows.forEach((row, index) => {
    const key = row?.key;
    if (validateKey(key, `${path}[${index}].key`, issues)) {
      if (seen.has(key)) issue(issues, `${path}[${index}].key`, 'MAKER_V8_KEY_DUPLICATE', `${path} contains duplicate key ${key}.`);
      seen.add(key);
    }
  });
  return seen;
}

function defaultOutput() {
  return {
    key: 'default-png',
    label: 'Default PNG',
    protected: false,
    allowedPackPolicy: { kind: MAKER_V8_OUTPUT_PACK_POLICIES.ALL_ADMITTED, packIds: [] },
    payload: {},
  };
}

/** Explicit author-storage/import boundary only; never called by validation. */
export function upgradeAuthorMakerV8LivingContentV8(value) {
  const issues = [];
  inspectJsonTree(value, issues);
  if (issues.length) throw new MakerV8DocumentError(issues);
  const next = structuredClone(value);
  if (isRecord(next) && !Object.hasOwn(next, 'livingContent')) {
    next.livingContent = createDefaultMakerV8LivingContentV8(next.metadata);
  }
  assertMakerV8Document(next, { mode: 'draft' });
  return deepFreeze(next);
}

export function createMakerV8Document(options = {}) {
  if (!isRecord(options)) options = {};
  const makerKey = SAFE_KEY.test(String(options.makerKey || 'untitled-maker'))
    ? String(options.makerKey || 'untitled-maker') : 'untitled-maker';
  return deepFreeze({
    schemaVersion: MAKER_V8_DOCUMENT_SCHEMA,
    protocolVersion: MAKER_V8_DOCUMENT_VERSION,
    lineage: {
      makerKey,
      version: 1,
      previousRootId: null,
      previousVersionCommitment: null,
      changelog: '',
    },
    metadata: {
      name: String(options.name || 'Untitled Maker'),
      summary: '',
      license: { kind: 'personal-use', note: '' },
      coverAssetId: null,
    },
    canvas: {
      width: Number.isSafeInteger(options.width) ? options.width : 1024,
      height: Number.isSafeInteger(options.height) ? options.height : 1024,
      pixelMode: options.pixelMode === 'pixelated' ? 'pixelated' : 'smooth',
    },
    composition: {
      mode: MAKER_V8_COMPOSITION_MODES.FIXED,
      thirdPartyAdmission: MAKER_V8_THIRD_PARTY_ADMISSION_MODES.DISABLED,
      itemAssetization: false,
    },
    tracks: [],
    colors: [],
    parts: [],
    rules: [],
    defaultRecipe: { selections: [], colors: [] },
    outputs: [defaultOutput()],
    commerce: structuredClone(createMakerV8Commerce({ rightsOriginConfirmed: true })),
    assets: [],
    livingContent: Object.hasOwn(options, 'livingContent')
      ? structuredClone(assertMakerV8LivingContentShapeV8(options.livingContent))
      : createDefaultMakerV8LivingContentV8({ name: String(options.name || 'Untitled Maker'), summary: '' }),
  });
}

/** Minimal complete schema sample for compiler/render fixtures, not New Maker's authoring template. */
export function createCharacterMakerV8Starter(options = {}) {
  const document = structuredClone(createMakerV8Document(options));
  document.tracks.push({ key: 'base-track', label: 'Base', renderOrder: 0, locked: true });
  document.parts.push({
    key: 'base', label: 'Base', kind: MAKER_V8_PART_KINDS.LAST_BASTION,
    renderOrder: 0, menuOrder: 0, visible: true, required: true,
    wardrobeMode: MAKER_V8_WARDROBE_MODES.FIXED, capacity: 1,
    payload: {},
    items: [{
      key: 'default', label: 'Default', status: 'PUBLIC', displayOrder: 0,
      defaultStyleKey: 'default', payload: {},
      styles: [{
        key: 'default', label: 'Default', displayOrder: 0,
        trackKey: 'base-track', colorChannelKey: null, defaultSwatchKey: null,
        assetId: 'base-default', protected: false,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1, blendMode: 'normal', physical: null, payload: {},
      }],
    }],
  });
  document.defaultRecipe.selections.push({ partKey: 'base', itemKey: 'default', styleKey: 'default' });
  document.assets.push({ id: 'base-default', kind: 'layer', mediaType: 'image/png', byteLength: 1 });
  return deepFreeze(document);
}

function validateShape(document, issues) {
  if (!exactRecord(document, FIELDS.document, '', issues)) return;
  try { assertMakerV8LivingContentShapeV8(document.livingContent); } catch {
    issue(issues, 'livingContent', 'MAKER_V8_LIVING_CONTENT_INVALID', 'Living Content requires its exact schema, three Markdown strings and three boolean customized flags.');
  }
  exactRecord(document.lineage, FIELDS.lineage, 'lineage', issues);
  exactRecord(document.metadata, FIELDS.metadata, 'metadata', issues, ['creator', 'style']);
  exactRecord(document.metadata?.license, FIELDS.license, 'metadata.license', issues);
  exactRecord(document.canvas, FIELDS.canvas, 'canvas', issues);
  exactRecord(document.composition, FIELDS.composition, 'composition', issues);
  document.tracks?.forEach((row, index) => exactRecord(row, FIELDS.track, `tracks[${index}]`, issues));
  document.colors?.forEach((row, index) => {
    exactRecord(row, FIELDS.color, `colors[${index}]`, issues);
    row?.swatches?.forEach((swatch, swatchIndex) => {
      exactRecord(swatch, FIELDS.swatch, `colors[${index}].swatches[${swatchIndex}]`, issues);
      swatch?.stops?.forEach((stop, stopIndex) => exactRecord(stop, FIELDS.stop, `colors[${index}].swatches[${swatchIndex}].stops[${stopIndex}]`, issues));
    });
  });
  document.parts?.forEach((part, partIndex) => {
    exactRecord(part, FIELDS.part, `parts[${partIndex}]`, issues, ['exportBackground']);
    if (part && Object.hasOwn(part, 'exportBackground') && typeof part.exportBackground !== 'boolean') {
      issue(issues, `parts[${partIndex}].exportBackground`, 'MAKER_V8_EXPORT_BACKGROUND_INVALID', 'Export background must be boolean.');
    }
    part?.items?.forEach((item, itemIndex) => {
      exactRecord(item, FIELDS.item, `parts[${partIndex}].items[${itemIndex}]`, issues);
      item?.styles?.forEach((style, styleIndex) => {
        const path = `parts[${partIndex}].items[${itemIndex}].styles[${styleIndex}]`;
        exactRecord(style, FIELDS.style, path, issues, ['visibleWhen']);
        exactRecord(style?.transform, FIELDS.transform, `${path}.transform`, issues);
        if (style?.physical !== null) exactRecord(style?.physical, FIELDS.physical, `${path}.physical`, issues);
      });
    });
  });
  document.rules?.forEach((row, index) => {
    exactRecord(row, FIELDS.rule, `rules[${index}]`, issues);
    exactRecord(row?.trigger, FIELDS.ruleRef, `rules[${index}].trigger`, issues);
    if (Array.isArray(row?.targets)) row.targets.forEach((target, targetIndex) => exactRecord(target, FIELDS.ruleRef, `rules[${index}].targets[${targetIndex}]`, issues));
  });
  exactRecord(document.defaultRecipe, FIELDS.recipe, 'defaultRecipe', issues);
  document.defaultRecipe?.selections?.forEach((row, index) => exactRecord(row, FIELDS.selection, `defaultRecipe.selections[${index}]`, issues));
  document.defaultRecipe?.colors?.forEach((row, index) => exactRecord(row, FIELDS.recipeColor, `defaultRecipe.colors[${index}]`, issues));
  document.outputs?.forEach((row, index) => {
    exactRecord(row, FIELDS.output, `outputs[${index}]`, issues);
    exactRecord(row?.allowedPackPolicy, FIELDS.packPolicy, `outputs[${index}].allowedPackPolicy`, issues);
  });
  exactRecord(document.commerce, FIELDS.commerce, 'commerce', issues);
  if (document.commerce?.rightsEvidence !== null) exactRecord(document.commerce?.rightsEvidence, FIELDS.rightsEvidence, 'commerce.rightsEvidence', issues);
  exactRecord(document.commerce?.makerAccess, FIELDS.makerAccess, 'commerce.makerAccess', issues);
  exactRecord(document.commerce?.baseCompletion, FIELDS.completionPolicy, 'commerce.baseCompletion', issues);
  document.assets?.forEach((row, index) => exactRecord(row, FIELDS.asset, `assets[${index}]`, issues));
}

function collectSemanticIssues(document, issues, { mode }) {
  if (document.schemaVersion !== MAKER_V8_DOCUMENT_SCHEMA || document.protocolVersion !== 8) {
    issue(issues, 'schemaVersion', 'MAKER_V8_SCHEMA_INVALID', 'Only fresh Maker v8 documents are accepted.');
  }
  validateKey(document.lineage?.makerKey, 'lineage.makerKey', issues);
  if (!Number.isSafeInteger(document.lineage?.version) || document.lineage.version < 1) issue(issues, 'lineage.version', 'MAKER_V8_VERSION_INVALID', 'Maker version must be a positive safe integer.');
  const previousRootId = document.lineage?.previousRootId;
  const previousVersionCommitment = document.lineage?.previousVersionCommitment;
  const exactPreviousId = typeof previousRootId === 'string'
    && /^0x[0-9a-f]{64}$/.test(previousRootId);
  const exactPreviousCommitment = typeof previousVersionCommitment === 'string'
    && /^[0-9a-f]{64}$/.test(previousVersionCommitment);
  if (document.lineage?.version === 1) {
    if (previousRootId !== null || previousVersionCommitment !== null) {
      issue(issues, 'lineage', 'MAKER_V8_INITIAL_LINEAGE_INVALID', 'Maker version 1 cannot name a predecessor.');
    }
  } else if (!exactPreviousId || !exactPreviousCommitment) {
    issue(issues, 'lineage', 'MAKER_V8_SUCCESSOR_LINEAGE_INVALID', 'Maker version N+1 requires one exact predecessor Root and version commitment.');
  }
  validateText(document.metadata?.name, 'metadata.name', issues, { maximum: 256 });
  validateText(document.metadata?.summary, 'metadata.summary', issues, { required: false, maximum: 4096 });
  for (const field of ['creator', 'style']) {
    if (Object.hasOwn(document.metadata ?? {}, field)) {
      validateText(document.metadata[field], `metadata.${field}`, issues, { required: false, maximum: 128 });
    }
  }
  validateText(document.metadata?.license?.kind, 'metadata.license.kind', issues, { maximum: 128 });
  validateText(document.metadata?.license?.note, 'metadata.license.note', issues, { required: false, maximum: 2048 });
  if (!Number.isSafeInteger(document.canvas?.width) || !Number.isSafeInteger(document.canvas?.height)
    || document.canvas.width < 1 || document.canvas.height < 1
    || document.canvas.width > 8192 || document.canvas.height > 8192) {
    issue(issues, 'canvas', 'MAKER_V8_CANVAS_INVALID', 'Canvas dimensions must be safe integers from 1 to 8192.');
  }
  if (!['smooth', 'pixelated'].includes(document.canvas?.pixelMode)) issue(issues, 'canvas.pixelMode', 'MAKER_V8_PIXEL_MODE_INVALID', 'Pixel mode must be smooth or pixelated.');
  if (!Object.values(MAKER_V8_COMPOSITION_MODES).includes(document.composition?.mode)
    || !Object.values(MAKER_V8_THIRD_PARTY_ADMISSION_MODES).includes(document.composition?.thirdPartyAdmission)
    || typeof document.composition?.itemAssetization !== 'boolean') {
    issue(issues, 'composition', 'MAKER_V8_COMPOSITION_INVALID', 'Composition must use the exact fresh-v8 policy vocabulary.');
  }
  if (document.composition?.itemAssetization === true
    && document.composition?.mode !== MAKER_V8_COMPOSITION_MODES.COMPOSABLE) {
    issue(issues, 'composition.itemAssetization', 'MAKER_V8_ITEM_ASSETIZATION_REQUIRES_COMPOSABLE', 'Owned Base Items require a COMPOSABLE Maker.');
  }

  const tracks = uniqueKeys(document.tracks, 'tracks', issues);
  const colors = uniqueKeys(document.colors, 'colors', issues);
  const parts = uniqueKeys(document.parts, 'parts', issues);
  const assets = new Map();
  uniqueKeys(document.assets?.map((asset) => ({ key: asset.id })), 'assets', issues);
  if (Array.isArray(document.assets) && document.assets.length > LIMITS.assets) {
    issue(issues, 'assets', 'MAKER_V8_ASSET_LIMIT', 'Author assets exceed the bounded client publication limit.', {
      observedAssets: document.assets.length,
      maximumAssets: LIMITS.assets,
    });
  }
  document.assets?.forEach((asset, index) => {
    const path = `assets[${index}]`;
    validateKey(asset.id, `${path}.id`, issues);
    validateText(asset.kind, `${path}.kind`, issues, { maximum: 64 });
    if (!MEDIA_TYPE.test(String(asset.mediaType || ''))) issue(issues, `${path}.mediaType`, 'MAKER_V8_MEDIA_TYPE_INVALID', 'Asset media type is invalid.');
    validateAtomic(asset.byteLength, `${path}.byteLength`, issues, { positive: mode === 'compile' });
    assets.set(asset.id, asset);
  });
  if (document.metadata?.coverAssetId !== null && !assets.has(document.metadata.coverAssetId)) issue(issues, 'metadata.coverAssetId', 'MAKER_V8_COVER_ASSET_UNKNOWN', 'Cover asset does not exist.');

  let itemCount = 0;
  let styleCount = 0;
  let publishedStyleCount = 0;
  let colorRowCount = 0;
  let totalPartCapacity = 0;
  const referencedStyleColorChannels = new Set();
  const referencedStyleAssets = new Set();
  const publicItems = new Set();
  const publicStyles = new Set();
  document.tracks?.forEach((track, index) => {
    validateText(track.label, `tracks[${index}].label`, issues, { maximum: 256 });
    if (!Number.isSafeInteger(track.renderOrder) || typeof track.locked !== 'boolean') issue(issues, `tracks[${index}]`, 'MAKER_V8_TRACK_INVALID', 'Track order and lock state are invalid.');
  });
  document.colors?.forEach((channel, channelIndex) => {
    const path = `colors[${channelIndex}]`;
    validateText(channel.label, `${path}.label`, issues, { maximum: 256 });
    const swatches = uniqueKeys(channel.swatches, `${path}.swatches`, issues);
    if (Array.isArray(channel.swatches)) colorRowCount += channel.swatches.length;
    if (!swatches.has(channel.defaultSwatchKey)) issue(issues, `${path}.defaultSwatchKey`, 'MAKER_V8_DEFAULT_SWATCH_UNKNOWN', 'Default swatch does not exist.');
    channel.swatches?.forEach((swatch, swatchIndex) => {
      const swatchPath = `${path}.swatches[${swatchIndex}]`;
      if (!RGBA.test(swatch.rgba)) issue(issues, `${swatchPath}.rgba`, 'MAKER_V8_RGBA_INVALID', 'RGBA must be #RRGGBBAA.');
      if (!Array.isArray(swatch.stops)) issue(issues, `${swatchPath}.stops`, 'MAKER_V8_STOPS_INVALID', 'Gradient stops must be an array.');
      swatch.stops?.forEach((stop, stopIndex) => {
        if (typeof stop.offset !== 'number' || stop.offset < 0 || stop.offset > 1 || !RGBA.test(stop.rgba)) issue(issues, `${swatchPath}.stops[${stopIndex}]`, 'MAKER_V8_STOP_INVALID', 'Gradient stop is invalid.');
      });
    });
  });
  if (colorRowCount > LIMITS.colors) {
    issue(issues, 'colors', 'MAKER_V8_COLOR_LIMIT', 'Published Color rows exceed the bounded client and Move registry limit.', {
      observedColorRows: colorRowCount,
      maximumColorRows: LIMITS.colors,
    });
  }
  document.parts?.forEach((part, partIndex) => {
    const partPath = `parts[${partIndex}]`;
    validateText(part.label, `${partPath}.label`, issues, { maximum: 256 });
    if (!Object.values(MAKER_V8_PART_KINDS).includes(part.kind)
      || !Object.values(MAKER_V8_WARDROBE_MODES).includes(part.wardrobeMode)
      || !Number.isSafeInteger(part.renderOrder) || !Number.isSafeInteger(part.menuOrder)
      || typeof part.visible !== 'boolean' || typeof part.required !== 'boolean'
      || !Number.isSafeInteger(part.capacity) || part.capacity < 1 || part.capacity > 64) {
      issue(issues, partPath, 'MAKER_V8_PART_INVALID', 'Part policy is invalid.');
    }
    if (part.wardrobeMode === 'SLOT' && document.composition?.mode !== 'COMPOSABLE') issue(issues, `${partPath}.wardrobeMode`, 'MAKER_V8_SLOT_REQUIRES_COMPOSABLE', 'SLOT requires COMPOSABLE mode.');
    if (part.kind === MAKER_V8_PART_KINDS.LAST_BASTION && part.required !== true) {
      issue(issues, `${partPath}.required`, 'MAKER_V8_LAST_BASTION_REQUIRED', 'LAST_BASTION Parts must remain required.');
    }
    if (Number.isSafeInteger(part.capacity) && part.capacity > 0) {
      totalPartCapacity += part.capacity;
    }
    const itemKeys = uniqueKeys(part.items, `${partPath}.items`, issues);
    itemCount += part.items?.length || 0;
    part.items?.forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      validateText(item.label, `${itemPath}.label`, issues, { maximum: 256 });
      if (!['PUBLIC', 'PRIVATE'].includes(item.status) || !Number.isSafeInteger(item.displayOrder)) issue(issues, itemPath, 'MAKER_V8_ITEM_INVALID', 'Item status/order is invalid.');
      const styleKeys = uniqueKeys(item.styles, `${itemPath}.styles`, issues);
      styleCount += item.styles?.length || 0;
      if (item.status === 'PUBLIC') publishedStyleCount += item.styles?.length || 0;
      const emptyDraftItem = mode === 'draft' && item.styles.length === 0 && item.defaultStyleKey === null;
      if (!emptyDraftItem && !styleKeys.has(item.defaultStyleKey)) issue(issues, `${itemPath}.defaultStyleKey`, 'MAKER_V8_DEFAULT_STYLE_UNKNOWN', 'Default Style does not exist.');
      if (item.status === 'PUBLIC') publicItems.add(`${part.key}/${item.key}`);
      item.styles?.forEach((style, styleIndex) => {
        const stylePath = `${itemPath}.styles[${styleIndex}]`;
        for (const entry of validateMakerV8Visibility(style.visibleWhen, {
          parts: document.parts, subject: { partKey: part.key, itemKey: item.key, styleKey: style.key },
        })) issue(issues, `${stylePath}.visibleWhen${entry.path ? `.${entry.path}` : ''}`, entry.code, entry.message);
        validateText(style.label, `${stylePath}.label`, issues, { maximum: 256 });
        if (!(mode === 'draft' && style.trackKey === null) && !tracks.has(style.trackKey)) issue(issues, `${stylePath}.trackKey`, 'MAKER_V8_TRACK_UNKNOWN', 'Style Track does not exist.');
        if (style.colorChannelKey === null) {
          if (style.defaultSwatchKey !== null) issue(issues, `${stylePath}.defaultSwatchKey`, 'MAKER_V8_COLOR_PAIR_INVALID', 'Color channel and default swatch are an exact pair.');
        } else if (!colors.has(style.colorChannelKey)) {
          issue(issues, `${stylePath}.colorChannelKey`, 'MAKER_V8_COLOR_UNKNOWN', 'Style Color channel does not exist.');
        } else {
          const channel = document.colors.find((entry) => entry.key === style.colorChannelKey);
          if (!channel?.swatches?.some((entry) => entry.key === style.defaultSwatchKey)) {
            issue(issues, `${stylePath}.defaultSwatchKey`, 'MAKER_V8_SWATCH_UNKNOWN', 'Style default swatch must exist in its exact Color channel.');
          } else if (item.status === 'PUBLIC') {
            referencedStyleColorChannels.add(style.colorChannelKey);
          }
        }
        // A newly authored Style can await its first PNG in a saved draft only.
        if (!(mode === 'draft' && style.assetId === null) && !assets.has(style.assetId)) issue(issues, `${stylePath}.assetId`, 'MAKER_V8_STYLE_ASSET_UNKNOWN', 'Style asset does not exist.');
        else if (style.assetId !== null && item.status === 'PUBLIC') referencedStyleAssets.add(style.assetId);
        if (style.protected === true && style.assetId !== null && style.assetId === document.metadata.coverAssetId) {
          issue(issues, 'metadata.coverAssetId', 'MAKER_V8_COVER_ASSET_PROTECTED', 'A public Maker cover cannot reference protected Style artwork.');
        }
        const transform = style.transform;
        if (!transform || !Number.isFinite(transform.x) || !Number.isFinite(transform.y)
          || Math.abs(transform.x) > 8192 || Math.abs(transform.y) > 8192
          || !Number.isFinite(transform.scale) || transform.scale <= 0 || transform.scale > 100
          || !Number.isFinite(transform.rotation) || Math.abs(transform.rotation) > 360) {
          issue(issues, `${stylePath}.transform`, 'MAKER_V8_STYLE_TRANSFORM_INVALID', 'Style transform exceeds the deterministic renderer bounds.');
        }
        if (typeof style.protected !== 'boolean' || !Number.isSafeInteger(style.displayOrder)
          || typeof style.opacity !== 'number' || style.opacity < 0 || style.opacity > 1
          || !MAKER_V8_BLEND_MODES.includes(style.blendMode)) issue(issues, stylePath, 'MAKER_V8_STYLE_INVALID', 'Style render policy is invalid.');
        if (item.status === 'PUBLIC') publicStyles.add(`${part.key}/${item.key}/${style.key}`);
        if (style.physical !== null) {
          const policy = style.physical;
          validateText(policy.material, `${stylePath}.physical.material`, issues, { maximum: 256 });
          if (!Object.values(MAKER_V8_PHYSICAL_ISSUANCE).includes(policy.issuance)
            || !Object.values(MAKER_V8_PHYSICAL_PROOFS).includes(policy.proof)
            || typeof policy.transferable !== 'boolean') issue(issues, `${stylePath}.physical`, 'MAKER_V8_PHYSICAL_POLICY_INVALID', 'Physical policy vocabulary is invalid.');
          validateAtomic(policy.priceAtomic, `${stylePath}.physical.priceAtomic`, issues);
          validateAtomic(policy.maxSupply, `${stylePath}.physical.maxSupply`, issues, { positive: true });
          if (policy.issuance === 'FREE_CLAIM' && String(policy.priceAtomic) !== '0') issue(issues, `${stylePath}.physical.priceAtomic`, 'MAKER_V8_PHYSICAL_PRICE_INVALID', 'FREE_CLAIM price must be zero.');
          if (policy.issuance === 'PAID_PURCHASE' && String(policy.priceAtomic) === '0') issue(issues, `${stylePath}.physical.priceAtomic`, 'MAKER_V8_PHYSICAL_PRICE_INVALID', 'PAID_PURCHASE price must be positive.');
          if (policy.issuance === 'PROOF_MATERIALIZE' && policy.proof !== 'CANONICAL_SOUL') issue(issues, `${stylePath}.physical.proof`, 'MAKER_V8_PHYSICAL_PROOF_INVALID', 'PROOF_MATERIALIZE requires CANONICAL_SOUL.');
        }
      });
    });
    if (mode === 'compile' && part.required && !itemKeys.size) issue(issues, `${partPath}.items`, 'MAKER_V8_PART_EMPTY', 'A required Part needs at least one Item.');
  });
  if (totalPartCapacity > LIMITS.totalPartCapacity) {
    issue(issues, 'parts', 'MAKER_V8_TOTAL_CAPACITY_LIMIT', 'Combined Part slot capacity exceeds the bounded Runtime loadout limit.', {
      observedCapacity: totalPartCapacity,
      maximumCapacity: LIMITS.totalPartCapacity,
    });
  }
  if (mode === 'compile' && !parts.size) issue(issues, 'parts', 'MAKER_V8_PART_REQUIRED', 'Publication requires at least one Part.');
  if (document.tracks?.length > LIMITS.tracks || document.parts?.length > LIMITS.parts
    || itemCount > LIMITS.items) issue(issues, 'parts', 'MAKER_V8_DEFINITION_LIMIT', 'Base definition limit exceeded.');
  if (styleCount > LIMITS.authorStyles) issue(issues, 'parts', 'MAKER_V8_AUTHOR_STYLE_LIMIT', 'Author Style arrays exceed the bounded document budget.', { observedStyles: styleCount, maximumStyles: LIMITS.authorStyles });
  const measuredStyleUnits = (2 * parts.size) + (2 * publishedStyleCount) + (2 * publicItems.size)
    + referencedStyleColorChannels.size + referencedStyleAssets.size;
  if (publishedStyleCount > LIMITS.styles || measuredStyleUnits > LIMITS.styleSealObjectRuntimeUnits) {
    issue(issues, 'parts', 'MAKER_V8_STYLE_SEAL_LIMIT', 'Published definitions exceed the current Core seal object-runtime budget.', {
      observedPublishedStyles: publishedStyleCount,
      observedPublishedItems: publicItems.size,
      observedParts: parts.size,
      observedDistinctColorChannels: referencedStyleColorChannels.size,
      observedDistinctReferencedAssets: referencedStyleAssets.size,
      observedUnits: measuredStyleUnits,
      maximumPublishedStyles: LIMITS.styles,
      maximumUnits: LIMITS.styleSealObjectRuntimeUnits,
    });
  }

  const ruleKeys = uniqueKeys(document.rules, 'rules', issues);
  document.rules?.forEach((rule, index) => {
    const path = `rules[${index}]`;
    for (const entry of validateMakerV8Rule(rule, { parts: document.parts })) issue(issues, entry.path ? `${path}.${entry.path}` : path, entry.code, entry.message);
  });
  if (ruleKeys.size > LIMITS.rules) issue(issues, 'rules', 'MAKER_V8_RULE_LIMIT', 'Rule limit exceeded.');

  if (!Array.isArray(document.defaultRecipe?.selections) || !Array.isArray(document.defaultRecipe?.colors)) issue(issues, 'defaultRecipe', 'MAKER_V8_RECIPE_INVALID', 'Default Recipe arrays are required.');
  const selectedPartCounts = new Map();
  const selectedOwnedBaseItems = new Set();
  document.defaultRecipe?.selections?.forEach((selection, index) => {
    const path = `defaultRecipe.selections[${index}]`;
    const itemKey = `${selection.partKey}/${selection.itemKey}`;
    const styleKey = `${itemKey}/${selection.styleKey}`;
    if (!publicItems.has(itemKey) || !publicStyles.has(styleKey)) issue(issues, path, 'MAKER_V8_RECIPE_TARGET_UNKNOWN', 'Default Recipe must select public exact definitions.');
    if (document.composition.itemAssetization === true
      && selectedOwnedBaseItems.has(itemKey)) {
      issue(issues, path, 'MAKER_V8_RECIPE_OWNED_ITEM_REUSED', 'One owned Base Item instance can occupy only one default loadout slot.');
    }
    selectedOwnedBaseItems.add(itemKey);
    const part = document.parts?.find((entry) => entry.key === selection.partKey);
    const selectedStyle = part?.items?.find(item => item.key === selection.itemKey)?.styles?.find(style => style.key === selection.styleKey);
    if (mode !== 'draft' && selectedStyle && !validateMakerV8Visibility(selectedStyle.visibleWhen).length
      && !evaluateMakerV8Visibility(selectedStyle.visibleWhen, document.defaultRecipe.selections)) {
      issue(issues, path, 'MAKER_V8_RECIPE_STYLE_NOT_VISIBLE', 'Default Recipe selects a Style whose visibility condition is false.');
    }
    const nextCount = (selectedPartCounts.get(selection.partKey) || 0) + 1;
    selectedPartCounts.set(selection.partKey, nextCount);
    if (part && nextCount > part.capacity) issue(issues, `${path}.partKey`, 'MAKER_V8_RECIPE_PART_CAPACITY_EXCEEDED', 'Default Recipe selections exceed this Part capacity.');
  });
  document.parts?.filter((part) => part.required).forEach((part) => {
    const emptyDraftPart = mode === 'draft' && !part.items.some(item => item.status === 'PUBLIC' && item.styles.length > 0);
    if (!emptyDraftPart && !selectedPartCounts.has(part.key)) issue(issues, 'defaultRecipe.selections', 'MAKER_V8_REQUIRED_PART_MISSING', `Required Part ${part.key} is not selected.`);
  });
  const selectedChannels = new Set();
  document.defaultRecipe?.colors?.forEach((selection, index) => {
    const path = `defaultRecipe.colors[${index}]`;
    const channel = document.colors?.find((entry) => entry.key === selection.channelKey);
    if (!channel || !channel.swatches?.some((entry) => entry.key === selection.swatchKey)) {
      issue(issues, path, 'MAKER_V8_RECIPE_COLOR_UNKNOWN', 'Default Recipe Color must reference one exact channel swatch.');
    }
    if (selectedChannels.has(selection.channelKey)) {
      issue(issues, `${path}.channelKey`, 'MAKER_V8_RECIPE_COLOR_DUPLICATE', 'Default Recipe selects each Color channel at most once.');
    }
    selectedChannels.add(selection.channelKey);
  });

  if (mode === 'compile') {
    document.parts?.forEach((part, index) => {
      if (part.required && !part.items?.some((item) => item.status === 'PUBLIC')) {
        issue(issues, `parts[${index}].items`, 'MAKER_V8_PUBLIC_PART_EMPTY', 'A required published Part needs at least one public Item.');
      }
    });
  }

  const outputKeys = uniqueKeys(document.outputs, 'outputs', issues);
  let packEdges = 0;
  document.outputs?.forEach((output, index) => {
    const path = `outputs[${index}]`;
    validateText(output.label, `${path}.label`, issues, { maximum: 256 });
    if (typeof output.protected !== 'boolean' || !Object.values(MAKER_V8_OUTPUT_PACK_POLICIES).includes(output.allowedPackPolicy?.kind)
      || !Array.isArray(output.allowedPackPolicy?.packIds)) issue(issues, path, 'MAKER_V8_OUTPUT_INVALID', 'Output policy is invalid.');
    const sorted = [...(output.allowedPackPolicy?.packIds || [])].sort(compareMakerV8ProtocolText);
    sorted.forEach((packId, packIndex) => validateKey(packId, `${path}.allowedPackPolicy.packIds[${packIndex}]`, issues));
    if (new Set(sorted).size !== sorted.length || sorted.some((entry, entryIndex) => entry !== output.allowedPackPolicy.packIds[entryIndex])) issue(issues, `${path}.allowedPackPolicy.packIds`, 'MAKER_V8_PACK_ALLOWLIST_INVALID', 'Pack allowlist must be strictly sorted and duplicate-free.');
    if (output.allowedPackPolicy?.kind === 'ALL_ADMITTED' && sorted.length) issue(issues, `${path}.allowedPackPolicy.packIds`, 'MAKER_V8_PACK_ALLOWLIST_INVALID', 'ALL_ADMITTED has no allowlist.');
    packEdges += sorted.length;
  });
  if (mode === 'compile' && !outputKeys.size) issue(issues, 'outputs', 'MAKER_V8_OUTPUT_REQUIRED', 'Publication requires an Output policy.');
  if (outputKeys.size > LIMITS.outputs || packEdges > LIMITS.totalPackEdges
    || document.outputs?.some((output) => output.allowedPackPolicy?.packIds?.length > LIMITS.packIdsPerOutput)) issue(issues, 'outputs', 'MAKER_V8_OUTPUT_LIMIT', 'Output or Pack edge limit exceeded.');

  collectMakerV8CommerceIssues(document.commerce, { publish: mode === 'compile' }).forEach((entry) => {
    issue(issues, `commerce.${entry.path || ''}`.replace(/\.$/, ''), entry.code, entry.message);
  });
  if (document.commerce?.rightsEvidence?.evidenceAssetId
    && !assets.has(document.commerce.rightsEvidence.evidenceAssetId)) issue(issues, 'commerce.rightsEvidence.evidenceAssetId', 'MAKER_V8_RIGHTS_ASSET_UNKNOWN', 'Rights evidence asset does not exist.');
}

export function collectMakerV8DocumentIssues(value, options = {}) {
  const issues = [];
  const snapshot = inspectJsonTree(value, issues);
  if (!snapshot) return Object.freeze(issues);
  const allowedOptions = new Set(['mode']);
  if (!isRecord(options) || Object.keys(options).some((key) => !allowedOptions.has(key))) {
    issue(issues, 'options', 'MAKER_V8_OPTIONS_INVALID', 'Document options accept only mode.');
    return Object.freeze(issues);
  }
  const mode = options.mode ?? 'draft';
  if (!['draft', 'compile'].includes(mode)) {
    issue(issues, 'options.mode', 'MAKER_V8_MODE_INVALID', 'Mode must be draft or compile.');
    return Object.freeze(issues);
  }
  validateShape(snapshot, issues);
  if (!issues.length) collectSemanticIssues(snapshot, issues, { mode });
  return Object.freeze(issues);
}

export class MakerV8DocumentError extends Error {
  constructor(issues) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join('\n'));
    this.name = 'MakerV8DocumentError';
    this.code = issues[0]?.code || 'MAKER_V8_DOCUMENT_INVALID';
    this.issues = Object.freeze([...issues]);
  }
}

export function assertMakerV8Document(value, options) {
  const issues = collectMakerV8DocumentIssues(value, options);
  if (issues.length) throw new MakerV8DocumentError(issues);
  return value;
}

export function isMakerV8Document(value) {
  return collectMakerV8DocumentIssues(value).length === 0;
}

export function projectPublicMakerV8Document(value) {
  assertMakerV8Document(value, { mode: 'compile' });
  const projected = structuredClone(value);
  projected.parts = projected.parts.map((part) => ({
    ...part,
    items: part.items.filter((item) => item.status === 'PUBLIC'),
  }));
  const publicAssetIds = new Set();
  if (projected.metadata.coverAssetId !== null) publicAssetIds.add(projected.metadata.coverAssetId);
  for (const part of projected.parts) for (const item of part.items) {
    for (const style of item.styles) publicAssetIds.add(style.assetId);
  }
  if (projected.commerce.rightsOrigin === 'LICENSE_WRAPPED'
    && projected.commerce.rightsEvidence?.evidenceAssetId) {
    publicAssetIds.add(projected.commerce.rightsEvidence.evidenceAssetId);
  }
  projected.assets = projected.assets.filter((asset) => publicAssetIds.has(asset.id));
  assertMakerV8Document(projected, { mode: 'compile' });
  return deepFreeze(projected);
}

export const MAKER_V8_DOCUMENT_LIMITS = LIMITS;
