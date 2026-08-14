import {
  MAKER_V8_RIGHTS_ORIGINS,
  collectMakerV8CommerceIssues,
  createMakerV8Commerce,
} from './maker-commerce-v8.js';
import {
  createMakerRuleIndex,
  evaluateRecipe,
  normalizeRecipe,
} from './maker-rules.js';
import {
  COMPOSABLE_PROFILE_MODES,
  THIRD_PARTY_ADMISSION_MODES,
} from './maker-composable-v6.js';

export const MAKER_V8_DOCUMENT_SCHEMA = 'animacraft.maker.v8';
export const MAKER_V8_DOCUMENT_VERSION = 8;

export const MAKER_V8_CAPABILITIES = Object.freeze([
  'composition',
  'expansionPacks',
  'complete',
  'seal',
  'physical',
  'canonicalSoul',
  'market',
]);
export const MAKER_V8_REQUIRED_CAPABILITIES = MAKER_V8_CAPABILITIES;

export const MAKER_V8_COMPOSITION_MODES = COMPOSABLE_PROFILE_MODES;
export const MAKER_V8_THIRD_PARTY_ADMISSION_MODES = THIRD_PARTY_ADMISSION_MODES;
export const MAKER_V8_COMPLETE_PACK_POLICY_MODES = Object.freeze({
  ALL_ADMITTED: 'ALL_ADMITTED',
  ALLOWLIST: 'ALLOWLIST',
});

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_SEMANTIC_PACK_ID = /^(?!0x[0-9a-fA-F]{64}$)[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const PIXEL_MODES = new Set(['smooth', 'pixelated']);
const WARDROBE_MODES = new Set(['FIXED', 'SLOT']);
const COMPOSITION_MODES = new Set(Object.values(COMPOSABLE_PROFILE_MODES));
const THIRD_PARTY_ADMISSION = new Set(Object.values(THIRD_PARTY_ADMISSION_MODES));
const COMPLETE_PACK_POLICY_MODES = new Set(
  Object.values(MAKER_V8_COMPLETE_PACK_POLICY_MODES),
);
const ASSET_KINDS = new Set([
  'maker-cover',
  'rights-evidence',
  'layer',
  'reference',
  'image',
  'json',
  'font',
  'audio',
]);
const ITEM_STATUSES = new Set(['draft', 'private', 'public']);
const BLEND_MODES = new Set([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'linear-dodge',
]);
const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const LICENSE_KINDS = new Set([
  'personal-use',
  'free-remix',
  'paid-commercial',
  'exclusive-commission',
]);
const MAX_CANVAS = 8_192;
const MAX_ASSET_DIMENSION = 32_768;
const MAX_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 2_000;
const MAX_AUTHOR_JSON_DEPTH = 64;
const MAX_AUTHOR_JSON_NODES = 1_500_000;
const VALIDATION_MODES = new Set(['draft', 'compile', 'activate']);
const LIMITS = Object.freeze({
  assets: 4_999,
  tracks: 256,
  colorChannels: 750,
  colors: 5_000,
  swatchesPerChannel: 32,
  parts: 750,
  items: 5_000,
  itemsPerPart: 100,
  styles: 10_000,
  stylesPerItem: 64,
  gradientStopsPerSwatch: 64,
  gradientStops: 160_000,
  completeOutputs: 256,
  completePackIds: 1_000,
  completePackEdges: 1_000,
  ruleTargets: 1_000,
  conditionNodes: 1_000,
  expandedRuleEdges: 1_000,
});

const AUTHOR_FIELDS = Object.freeze({
  document: new Set([
    'schemaVersion', 'protocolVersion', 'lineage', 'metadata', 'canvas',
    'capabilities', 'composition', 'layerTracks', 'colorChannels', 'parts',
    'rules', 'defaultRecipe', 'complete', 'commerce', 'assets',
  ]),
  lineage: new Set(['rootMakerKey', 'versionKey', 'number', 'createdAt', 'changelog']),
  metadata: new Set(['id', 'name', 'summary', 'style', 'license', 'coverAssetId']),
  license: new Set(['kind', 'note']),
  canvas: new Set(['width', 'height', 'pixelMode']),
  capabilities: new Set(MAKER_V8_CAPABILITIES),
  composition: new Set(['mode', 'thirdPartyAdmission', 'itemAssetization']),
  layerTrack: new Set(['id', 'name', 'order', 'locked', 'referenceAssetId']),
  colorChannel: new Set(['id', 'name', 'order', 'mode', 'defaultSwatchId', 'swatches']),
  swatch: new Set(['id', 'name', 'hintColor', 'stops']),
  gradientStop: new Set(['offset', 'color']),
  part: new Set([
    'id', 'name', 'menuOrder', 'menuVisible', 'required', 'wardrobeMode',
    'defaultItemId', 'parentPartId', 'iconAssetId', 'visibleWhen', 'requires',
    'excludes', 'items',
  ]),
  item: new Set([
    'id', 'name', 'displayOrder', 'importKey', 'status', 'thumbnailAssetId',
    'visibleWhen', 'requires', 'excludes', 'defaultStyleId', 'styles',
  ]),
  style: new Set([
    'id', 'name', 'displayOrder', 'assetId', 'layerTrackId', 'colorChannelId',
    'transform', 'positionConfirmed', 'positionLocked', 'styleLocked', 'opacity',
    'blendMode', 'visibleWhen', 'requires', 'excludes', 'seal', 'physical',
  ]),
  transform: new Set(['x', 'y', 'scale', 'rotation']),
  seal: new Set(['protected']),
  physical: new Set(['enabled']),
  selectionTarget: new Set(['partId', 'itemId', 'itemIds', 'styleId', 'styleIds']),
  selectedCondition: new Set(['op', 'partId', 'itemId', 'itemIds', 'styleId', 'styleIds']),
  notCondition: new Set(['op', 'condition']),
  groupCondition: new Set(['op', 'conditions']),
  rule: new Set(['id', 'type', 'trigger', 'targets']),
  defaultRecipe: new Set(['selections', 'colors']),
  defaultSelection: new Set(['partId', 'itemId', 'styleId']),
  defaultColor: new Set(['channelId', 'swatchId']),
  complete: new Set(['outputs']),
  completeOutput: new Set(['id', 'name', 'protected', 'allowedPackPolicy']),
  allowedPackPolicy: new Set(['mode', 'packIds']),
  commerce: new Set([
    'schemaVersion', 'rightsOrigin', 'rightsOriginConfirmed', 'rightsEvidence', 'makerAccess',
    'baseCompletion', 'soulCreatorRoyaltyBps', 'makerSourceRoyaltyBps',
    'makerResaleRoyaltyBps',
  ]),
  rightsEvidence: new Set(['licensor', 'evidenceAssetId']),
  makerAccess: new Set(['mode', 'purchasePriceAtomic']),
  completionPolicy: new Set(['mode', 'freeQuotaPerWallet', 'priceAtomic', 'totalCap']),
  asset: new Set([
    'id', 'identifier', 'kind', 'mediaType', 'width', 'height', 'byteLength',
  ]),
});

const COMPILER_OWNED_AUTHOR_FIELDS = new Set([
  'chainid',
  'creator',
  'owner',
  'sender',
  'signer',
  'walletaddress',
  'previousrootid',
  'previousversioncommitment',
  'rootid',
  'makerrootid',
  'sealid',
  'releaseid',
  'admincapid',
  'treasuryid',
  'registryid',
  'objectid',
  'packageid',
  'typeoriginid',
  'blobid',
  'manifestblobid',
  'assetblobid',
  'transactiondigest',
  'checkpoint',
  'ownershipepoch',
  'requiredpackselections',
  'packselections',
  'selectedpackids',
  'equippedpackselections',
]);

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function jsonChildPath(path, key, array = false) {
  return array ? `${path}[${key}]` : path ? `${path}.${key}` : String(key);
}

/**
 * Rejects values which JSON text cannot faithfully represent before any
 * semantic walker reads a property. This is iterative so cyclic or adversarial
 * depth cannot overflow the validation stack. Shared object references are
 * rejected as well: the author contract is a tree, not an in-memory graph.
 */
function validateAuthorJsonTree(root, issues) {
  const stack = [{ value: root, path: '', depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;

  while (stack.length) {
    const { value, path, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_AUTHOR_JSON_NODES) {
      issue(
        issues,
        path,
        'MAKER_V8_AUTHOR_JSON_NODE_LIMIT',
        `Maker v8 author JSON cannot exceed ${MAX_AUTHOR_JSON_NODES} nodes.`,
      );
      return false;
    }
    if (depth > MAX_AUTHOR_JSON_DEPTH) {
      issue(
        issues,
        path,
        'MAKER_V8_AUTHOR_JSON_DEPTH_LIMIT',
        `Maker v8 author JSON cannot exceed ${MAX_AUTHOR_JSON_DEPTH} levels.`,
      );
      return false;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        issue(issues, path, 'MAKER_V8_AUTHOR_JSON_SCALAR_INVALID', 'JSON numbers must be finite.');
        return false;
      }
      continue;
    }
    if (!value || typeof value !== 'object') {
      issue(
        issues,
        path,
        'MAKER_V8_AUTHOR_JSON_SCALAR_INVALID',
        'Maker v8 author values must be JSON null, strings, booleans, finite numbers, arrays, or plain objects.',
      );
      return false;
    }
    if (seen.has(value)) {
      issue(
        issues,
        path,
        'MAKER_V8_AUTHOR_JSON_GRAPH_INVALID',
        'Maker v8 author JSON cannot contain cycles or shared object references.',
      );
      return false;
    }
    seen.add(value);

    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      issue(issues, path, 'MAKER_V8_AUTHOR_JSON_REFLECTION_FAILED', 'Maker v8 author JSON could not be inspected safely.');
      return false;
    }

    const array = Array.isArray(value);
    if ((array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)) {
      issue(
        issues,
        path,
        'MAKER_V8_AUTHOR_OBJECT_INVALID',
        'Maker v8 author object boundaries accept only standard JSON arrays and plain objects.',
      );
      return false;
    }
    if (keys.some((key) => typeof key === 'symbol')) {
      issue(issues, path, 'MAKER_V8_AUTHOR_JSON_SYMBOL_INVALID', 'Maker v8 author JSON cannot contain symbol keys.');
      return false;
    }

    if (array) {
      let lengthDescriptor;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      } catch {
        issue(issues, path, 'MAKER_V8_AUTHOR_JSON_REFLECTION_FAILED', 'Maker v8 author array length could not be inspected safely.');
        return false;
      }
      if (!lengthDescriptor
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0) {
        issue(issues, path, 'MAKER_V8_AUTHOR_JSON_ARRAY_INVALID', 'Maker v8 author arrays need an exact JSON length.');
        return false;
      }
      const allowed = new Set(['length']);
      for (let index = 0; index < lengthDescriptor.value; index += 1) allowed.add(String(index));
      if (keys.some((key) => !allowed.has(key)) || keys.length !== allowed.size) {
        issue(issues, path, 'MAKER_V8_AUTHOR_JSON_ARRAY_INVALID', 'Maker v8 author arrays must be dense and cannot contain extra properties.');
        return false;
      }
    }

    for (const key of keys) {
      if (array && key === 'length') continue;
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        issue(issues, path, 'MAKER_V8_AUTHOR_JSON_REFLECTION_FAILED', 'Maker v8 author JSON descriptor could not be inspected safely.');
        return false;
      }
      const childPath = jsonChildPath(path, key, array);
      if (!descriptor
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || descriptor.enumerable !== true) {
        issue(
          issues,
          childPath,
          'MAKER_V8_AUTHOR_JSON_DESCRIPTOR_INVALID',
          'Maker v8 author JSON accepts only enumerable data properties; accessors and hidden fields are forbidden.',
        );
        return false;
      }
      stack.push({ value: descriptor.value, path: childPath, depth: depth + 1 });
    }
  }
  return true;
}

/**
 * Converts an already descriptor-validated author tree into a trusted plain
 * snapshot before any semantic read. Native structured cloning deliberately
 * rejects Proxy objects; that closes the gap where a Proxy could present one
 * key/descriptor set to the shape walk and a different set to later readers.
 * The clone is validated again so the semantic validator only ever consumes
 * the same dense, enumerable data tree that passed the JSON boundary.
 */
function snapshotAuthorJsonTree(root, issues) {
  if (!validateAuthorJsonTree(root, issues)) return null;
  let snapshot;
  try {
    snapshot = structuredClone(root);
  } catch {
    issue(
      issues,
      '',
      'MAKER_V8_AUTHOR_JSON_INSPECTION_FAILED',
      'Maker v8 author JSON could not be snapshotted safely; Proxy and other non-cloneable values are forbidden.',
    );
    return null;
  }
  if (!validateAuthorJsonTree(snapshot, issues)) return null;
  return snapshot;
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}

function safeId(value, fallback) {
  const normalized = String(value || fallback || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return normalized || fallback;
}

function issue(issues, path, code, message) {
  issues.push(Object.freeze({ path, code, message }));
}

function exactIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || ''))
    .filter(Boolean))].sort();
}

function defaultCapabilities() {
  return Object.fromEntries(MAKER_V8_CAPABILITIES.map((name) => [name, true]));
}

function defaultLineage(rootMakerKey, overrides = {}) {
  const source = isRecord(overrides) ? overrides : {};
  const number = Number.isSafeInteger(source.number) && source.number > 0
    ? source.number
    : 1;
  return {
    rootMakerKey,
    versionKey: safeId(source.versionKey, `${rootMakerKey}-v${number}`),
    number,
    createdAt: source.createdAt || null,
    changelog: String(source.changelog || ''),
  };
}

function defaultComposition(overrides = {}) {
  const source = isRecord(overrides) ? overrides : {};
  const mode = COMPOSITION_MODES.has(source.mode)
    ? source.mode
    : COMPOSABLE_PROFILE_MODES.FIXED;
  const fixed = mode === COMPOSABLE_PROFILE_MODES.FIXED;
  return {
    mode,
    thirdPartyAdmission: fixed
      ? THIRD_PARTY_ADMISSION_MODES.DISABLED
      : THIRD_PARTY_ADMISSION.has(source.thirdPartyAdmission)
        ? source.thirdPartyAdmission
        : THIRD_PARTY_ADMISSION_MODES.DISABLED,
    itemAssetization: fixed ? false : source.itemAssetization === true,
  };
}

function sortedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value)
  )].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function defaultAllowedPackPolicy(overrides = {}) {
  const source = isRecord(overrides) ? overrides : {};
  const mode = COMPLETE_PACK_POLICY_MODES.has(source.mode)
    ? source.mode
    : MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALL_ADMITTED;
  return {
    mode,
    packIds: mode === MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALLOWLIST
      ? sortedStrings(source.packIds)
      : [],
  };
}

function defaultComplete(overrides = {}) {
  const source = isRecord(overrides) ? overrides : {};
  const requested = Array.isArray(source.outputs) ? source.outputs : null;
  const outputs = requested || [{
    id: 'default-png',
    name: 'Default PNG',
    protected: false,
    allowedPackPolicy: defaultAllowedPackPolicy(),
  }];
  return {
    outputs: outputs.map((output, index) => {
      const entry = isRecord(output) ? output : {};
      return {
        id: safeId(entry.id, index === 0 ? 'default-png' : `output-${index + 1}`),
        name: String(entry.name || (index === 0 ? 'Default PNG' : `Output ${index + 1}`)),
        protected: entry.protected === true,
        allowedPackPolicy: defaultAllowedPackPolicy(entry.allowedPackPolicy),
      };
    }),
  };
}

function defaultMakerCommerce(overrides = {}) {
  return structuredClone(createMakerV8Commerce(overrides));
}

export function createMakerV8Document(options = {}) {
  const source = isRecord(options) ? options : {};
  const {
    makerId = 'untitled-maker',
    name = 'Untitled Maker',
    width = 1024,
    height = 1024,
    pixelMode = 'smooth',
    lineage = {},
    composition = {},
    complete = {},
    commerce = {},
  } = source;
  const lineageSource = isRecord(lineage) ? lineage : {};
  const rootMakerKey = safeId(lineageSource.rootMakerKey || makerId, 'untitled-maker');
  return deepFreeze({
    schemaVersion: MAKER_V8_DOCUMENT_SCHEMA,
    protocolVersion: MAKER_V8_DOCUMENT_VERSION,
    lineage: defaultLineage(rootMakerKey, lineageSource),
    metadata: {
      id: safeId(makerId, rootMakerKey),
      name: String(name || 'Untitled Maker'),
      summary: '',
      style: '',
      license: { kind: 'personal-use', note: '' },
      coverAssetId: null,
    },
    canvas: {
      width: Number.isSafeInteger(width) ? width : 1024,
      height: Number.isSafeInteger(height) ? height : 1024,
      pixelMode: PIXEL_MODES.has(pixelMode) ? pixelMode : 'smooth',
    },
    capabilities: defaultCapabilities(),
    composition: defaultComposition(composition),
    layerTracks: [],
    colorChannels: [],
    parts: [],
    rules: [],
    defaultRecipe: { selections: [], colors: [] },
    complete: defaultComplete(complete),
    commerce: defaultMakerCommerce(isRecord(commerce) ? commerce : {}),
    assets: [],
  });
}

/**
 * The v8 protocol reuses the established Creator editor document semantics;
 * it does not introduce a second Pack-only or chain-version-specific editor.
 */
export function createCharacterMakerV8Starter(options = {}) {
  const document = structuredClone(createMakerV8Document(options));
  const definitions = [
    ['background', 'Background', false],
    ['back-hair', 'Back Hair', false],
    ['skin-base', 'Skin & Base', true],
    ['outfit', 'Outfit', false],
    ['eyes', 'Eyes', true],
    ['mouth', 'Mouth', false],
    ['front-hair', 'Front Hair', false],
    ['accessory', 'Accessory', false],
  ];
  definitions.forEach(([id, name, required], order) => {
    const itemId = `${id}-default`;
    const styleId = 'default-style';
    const trackId = `${id}-track`;
    document.layerTracks.push({
      id: trackId,
      name,
      order,
      locked: false,
      referenceAssetId: null,
    });
    document.parts.push({
      id,
      name,
      menuOrder: order,
      menuVisible: true,
      required,
      wardrobeMode: 'FIXED',
      defaultItemId: itemId,
      parentPartId: null,
      iconAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      items: [{
        id: itemId,
        name: 'Default',
        displayOrder: 0,
        importKey: itemId,
        status: 'public',
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [],
        excludes: [],
        defaultStyleId: styleId,
        styles: [{
          id: styleId,
          name: 'Default Style',
          displayOrder: 0,
          assetId: null,
          layerTrackId: trackId,
          colorChannelId: null,
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          positionConfirmed: false,
          positionLocked: false,
          styleLocked: false,
          opacity: 1,
          blendMode: 'normal',
          visibleWhen: null,
          requires: [],
          excludes: [],
          seal: { protected: false },
          physical: { enabled: false },
        }],
      }],
    });
  });
  document.defaultRecipe = {
    selections: document.parts.map((part) => ({
      partId: part.id,
      itemId: part.defaultItemId,
      styleId: part.items[0].defaultStyleId,
    })),
    colors: [],
  };
  return deepFreeze(document);
}

export function isMakerV8Document(value) {
  try {
    const issues = [];
    const snapshot = snapshotAuthorJsonTree(value, issues);
    return issues.length === 0
      && isRecord(snapshot)
      && snapshot.schemaVersion === MAKER_V8_DOCUMENT_SCHEMA
      && snapshot.protocolVersion === MAKER_V8_DOCUMENT_VERSION;
  } catch {
    return false;
  }
}

function validateId(value, path, issues) {
  const text = String(value || '');
  if (!SAFE_ID.test(text) || utf8Length(text) > MAX_NAME_BYTES) {
    issue(issues, path, 'MAKER_V8_ID_INVALID', 'Identifier must be a safe ID no longer than 128 UTF-8 bytes.');
    return false;
  }
  return true;
}

function validateName(value, path, issues, { required = true, max = MAX_NAME_BYTES } = {}) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string') {
    issue(issues, path, 'MAKER_V8_TEXT_INVALID', 'Text fields must contain JSON strings.');
    return;
  }
  const text = value;
  if ((required && !text.trim()) || utf8Length(text) > max) {
    issue(issues, path, 'MAKER_V8_TEXT_INVALID', `Text must be ${required ? 'non-empty and ' : ''}at most ${max} UTF-8 bytes.`);
  }
}

function isCompilerOwnedAuthorField(key) {
  const normalized = String(key || '').toLowerCase();
  return COMPILER_OWNED_AUTHOR_FIELDS.has(normalized)
    || normalized.endsWith('commitment')
    || normalized.endsWith('hash')
    || normalized.endsWith('sha256');
}

function allowAuthorFields(value, allowed, path, issues) {
  if (!isRecord(value)) {
    if (value !== null && value !== undefined) {
      issue(
        issues,
        path,
        'MAKER_V8_AUTHOR_OBJECT_INVALID',
        'Maker v8 author object boundaries accept only plain JSON objects.',
      );
    }
    return;
  }
  Object.keys(value).forEach((key) => {
    if (allowed.has(key)) return;
    const fieldPath = path ? `${path}.${key}` : key;
    if (!path && key === 'packs') {
      issue(
        issues,
        fieldPath,
        'MAKER_V8_EMBEDDED_PACKS_FORBIDDEN',
        'Pack Releases are independent post-activation products admitted through the revision-CAS Pack registry, not frozen Maker author fields.',
      );
    } else if (path === 'commerce' && key === 'packPolicies') {
      issue(
        issues,
        fieldPath,
        'MAKER_V8_EMBEDDED_PACK_POLICY_FORBIDDEN',
        'Independent Pack Releases own access, Complete, and Treasury policy; base Maker commerce cannot embed Pack policies.',
      );
    } else if (isCompilerOwnedAuthorField(key)) {
      issue(
        issues,
        fieldPath,
        'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN',
        'Chain identities, hashes, commitments, Seal IDs, runtime selections, and transport evidence are compiler-owned.',
      );
    } else {
      issue(
        issues,
        fieldPath,
        'MAKER_V8_AUTHOR_FIELD_UNKNOWN',
        'This field is not part of the exact Maker v8 author document contract.',
      );
    }
  });
}

function walkSelectionTargetShape(value, path, issues, allowed = AUTHOR_FIELDS.selectionTarget) {
  allowAuthorFields(value, allowed, path, issues);
}

function walkConditionShape(value, path, issues) {
  if (value === null || value === undefined) return;
  if (!isRecord(value)) {
    allowAuthorFields(value, new Set(), path, issues);
    return;
  }
  if (value.op === 'selected') {
    walkSelectionTargetShape(value, path, issues, AUTHOR_FIELDS.selectedCondition);
    return;
  }
  if (value.op === 'not') {
    allowAuthorFields(value, AUTHOR_FIELDS.notCondition, path, issues);
    walkConditionShape(value.condition, `${path}.condition`, issues);
    return;
  }
  if (value.op === 'all' || value.op === 'any') {
    allowAuthorFields(value, AUTHOR_FIELDS.groupCondition, path, issues);
    (Array.isArray(value.conditions) ? value.conditions : []).forEach((condition, index) => {
      walkConditionShape(condition, `${path}.conditions[${index}]`, issues);
    });
    return;
  }
  allowAuthorFields(value, new Set(['op']), path, issues);
}

function walkRuleOwnerShape(value, path, issues) {
  if (!isRecord(value)) return;
  (Array.isArray(value.requires) ? value.requires : []).forEach((target, index) => {
    walkSelectionTargetShape(target, `${path}.requires[${index}]`, issues);
  });
  (Array.isArray(value.excludes) ? value.excludes : []).forEach((target, index) => {
    walkSelectionTargetShape(target, `${path}.excludes[${index}]`, issues);
  });
  walkConditionShape(value.visibleWhen, `${path}.visibleWhen`, issues);
}

function collectMakerV8AuthorShapeIssuesInto(document, issues) {
  if (!isRecord(document)) {
    issue(
      issues,
      '',
      'MAKER_V8_AUTHOR_OBJECT_INVALID',
      'Maker v8 author documents must be plain JSON objects.',
    );
    return;
  }
  allowAuthorFields(document, AUTHOR_FIELDS.document, '', issues);
  allowAuthorFields(document.lineage, AUTHOR_FIELDS.lineage, 'lineage', issues);
  allowAuthorFields(document.metadata, AUTHOR_FIELDS.metadata, 'metadata', issues);
  allowAuthorFields(document.metadata?.license, AUTHOR_FIELDS.license, 'metadata.license', issues);
  allowAuthorFields(document.canvas, AUTHOR_FIELDS.canvas, 'canvas', issues);
  allowAuthorFields(document.capabilities, AUTHOR_FIELDS.capabilities, 'capabilities', issues);
  allowAuthorFields(document.composition, AUTHOR_FIELDS.composition, 'composition', issues);

  (Array.isArray(document.layerTracks) ? document.layerTracks : []).forEach((track, index) => {
    allowAuthorFields(track, AUTHOR_FIELDS.layerTrack, `layerTracks[${index}]`, issues);
  });
  (Array.isArray(document.colorChannels) ? document.colorChannels : []).forEach((channel, index) => {
    const path = `colorChannels[${index}]`;
    allowAuthorFields(channel, AUTHOR_FIELDS.colorChannel, path, issues);
    (Array.isArray(channel?.swatches) ? channel.swatches : []).forEach((swatch, swatchIndex) => {
      const swatchPath = `${path}.swatches[${swatchIndex}]`;
      allowAuthorFields(swatch, AUTHOR_FIELDS.swatch, swatchPath, issues);
      (Array.isArray(swatch?.stops) ? swatch.stops : []).forEach((stop, stopIndex) => {
        allowAuthorFields(
          stop,
          AUTHOR_FIELDS.gradientStop,
          `${swatchPath}.stops[${stopIndex}]`,
          issues,
        );
      });
    });
  });
  (Array.isArray(document.parts) ? document.parts : []).forEach((part, partIndex) => {
    const partPath = `parts[${partIndex}]`;
    allowAuthorFields(part, AUTHOR_FIELDS.part, partPath, issues);
    walkRuleOwnerShape(part, partPath, issues);
    (Array.isArray(part?.items) ? part.items : []).forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      allowAuthorFields(item, AUTHOR_FIELDS.item, itemPath, issues);
      walkRuleOwnerShape(item, itemPath, issues);
      (Array.isArray(item?.styles) ? item.styles : []).forEach((style, styleIndex) => {
        const stylePath = `${itemPath}.styles[${styleIndex}]`;
        allowAuthorFields(style, AUTHOR_FIELDS.style, stylePath, issues);
        allowAuthorFields(style?.transform, AUTHOR_FIELDS.transform, `${stylePath}.transform`, issues);
        allowAuthorFields(style?.seal, AUTHOR_FIELDS.seal, `${stylePath}.seal`, issues);
        allowAuthorFields(style?.physical, AUTHOR_FIELDS.physical, `${stylePath}.physical`, issues);
        walkRuleOwnerShape(style, stylePath, issues);
      });
    });
  });
  (Array.isArray(document.rules) ? document.rules : []).forEach((rule, index) => {
    const path = `rules[${index}]`;
    allowAuthorFields(rule, AUTHOR_FIELDS.rule, path, issues);
    walkSelectionTargetShape(rule?.trigger, `${path}.trigger`, issues);
    (Array.isArray(rule?.targets) ? rule.targets : []).forEach((target, targetIndex) => {
      walkSelectionTargetShape(target, `${path}.targets[${targetIndex}]`, issues);
    });
  });
  allowAuthorFields(document.defaultRecipe, AUTHOR_FIELDS.defaultRecipe, 'defaultRecipe', issues);
  (Array.isArray(document.defaultRecipe?.selections)
    ? document.defaultRecipe.selections
    : []).forEach((selection, index) => {
    allowAuthorFields(
      selection,
      AUTHOR_FIELDS.defaultSelection,
      `defaultRecipe.selections[${index}]`,
      issues,
    );
  });
  (Array.isArray(document.defaultRecipe?.colors)
    ? document.defaultRecipe.colors
    : []).forEach((color, index) => {
    allowAuthorFields(color, AUTHOR_FIELDS.defaultColor, `defaultRecipe.colors[${index}]`, issues);
  });

  allowAuthorFields(document.complete, AUTHOR_FIELDS.complete, 'complete', issues);
  (Array.isArray(document.complete?.outputs) ? document.complete.outputs : [])
    .forEach((output, index) => {
      const path = `complete.outputs[${index}]`;
      allowAuthorFields(output, AUTHOR_FIELDS.completeOutput, path, issues);
      allowAuthorFields(
        output?.allowedPackPolicy,
        AUTHOR_FIELDS.allowedPackPolicy,
        `${path}.allowedPackPolicy`,
        issues,
      );
    });

  allowAuthorFields(document.commerce, AUTHOR_FIELDS.commerce, 'commerce', issues);
  allowAuthorFields(
    document.commerce?.rightsEvidence,
    AUTHOR_FIELDS.rightsEvidence,
    'commerce.rightsEvidence',
    issues,
  );
  allowAuthorFields(
    document.commerce?.makerAccess,
    AUTHOR_FIELDS.makerAccess,
    'commerce.makerAccess',
    issues,
  );
  allowAuthorFields(
    document.commerce?.baseCompletion,
    AUTHOR_FIELDS.completionPolicy,
    'commerce.baseCompletion',
    issues,
  );
  (Array.isArray(document.assets) ? document.assets : []).forEach((asset, index) => {
    allowAuthorFields(asset, AUTHOR_FIELDS.asset, `assets[${index}]`, issues);
  });
}

export function collectMakerV8AuthorShapeIssues(document) {
  const issues = [];
  try {
    const snapshot = snapshotAuthorJsonTree(document, issues);
    if (!snapshot) return Object.freeze(issues);
    collectMakerV8AuthorShapeIssuesInto(snapshot, issues);
  } catch {
    issue(
      issues,
      '',
      'MAKER_V8_AUTHOR_JSON_INSPECTION_FAILED',
      'Maker v8 author JSON could not be inspected safely.',
    );
  }
  return Object.freeze(issues);
}

function validateContiguousOrder(records, path, issues) {
  if (!Array.isArray(records)) return;
  records.forEach((record, index) => {
    if (record?.order !== index) {
      issue(issues, `${path}[${index}].order`, 'MAKER_V8_ORDER_INVALID', 'Order must be contiguous and match array position.');
    }
  });
}

function validateUniqueIds(records, path, issues) {
  const seen = new Set();
  (Array.isArray(records) ? records : []).forEach((record, index) => {
    const id = String(record?.id || '');
    if (!validateId(id, `${path}[${index}].id`, issues)) return;
    if (seen.has(id)) {
      issue(issues, `${path}[${index}].id`, 'MAKER_V8_ID_DUPLICATE', 'Identifier must be unique in this collection.');
    }
    seen.add(id);
  });
  return seen;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateSortedUniqueStrings(values, path, issues, {
  limit,
  pattern = SAFE_ID,
  maxBytes = MAX_NAME_BYTES,
  invalidCode = 'MAKER_V8_ID_INVALID',
  limitCode = 'MAKER_V8_COLLECTION_LIMIT',
} = {}) {
  if (!Array.isArray(values)) {
    issue(issues, path, invalidCode, 'Value must be an ordered array of semantic identifiers.');
    return [];
  }
  if (Number.isSafeInteger(limit) && values.length > limit) {
    issue(issues, path, limitCode, `Collection cannot exceed ${limit} entries.`);
  }
  const seen = new Set();
  let previous = null;
  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof value !== 'string'
      || !pattern.test(value)
      || utf8Length(value) > maxBytes) {
      issue(issues, itemPath, invalidCode, 'Value must be a non-empty safe semantic identifier.');
      return;
    }
    if (seen.has(value)) {
      issue(issues, itemPath, 'MAKER_V8_CANONICAL_LIST_DUPLICATE', 'Canonical lists cannot contain duplicates.');
    }
    if (previous !== null && compareStrings(previous, value) >= 0) {
      issue(issues, itemPath, 'MAKER_V8_CANONICAL_LIST_ORDER_INVALID', 'Canonical lists must be strictly sorted by code point.');
    }
    seen.add(value);
    previous = value;
  });
  return values.filter((value) => typeof value === 'string');
}

function createRuleBudget() {
  return {
    targetRecords: 0,
    conditionNodes: 0,
    expandedEdges: 0,
    targetLimitReported: false,
    conditionLimitReported: false,
    expandedLimitReported: false,
  };
}

function addRuleTargetRecords(budget, amount, path, issues) {
  budget.targetRecords += amount;
  if (budget.targetRecords > LIMITS.ruleTargets && !budget.targetLimitReported) {
    budget.targetLimitReported = true;
    issue(
      issues,
      path,
      'MAKER_V8_RULE_TARGET_TOTAL_LIMIT',
      `Maker v8 cannot exceed ${LIMITS.ruleTargets} Rule target records across all global and embedded rules.`,
    );
  }
}

function addConditionNode(budget, path, issues) {
  budget.conditionNodes += 1;
  if (budget.conditionNodes > LIMITS.conditionNodes && !budget.conditionLimitReported) {
    budget.conditionLimitReported = true;
    issue(
      issues,
      path,
      'MAKER_V8_CONDITION_NODE_LIMIT',
      `Maker v8 cannot exceed ${LIMITS.conditionNodes} nested visibility-condition nodes.`,
    );
  }
}

function selectionTargetWidth(target) {
  if (!isRecord(target)) return 1;
  const itemCount = target.itemId
    ? 1
    : Array.isArray(target.itemIds)
      ? Math.max(1, target.itemIds.length)
      : 1;
  const styleCount = target.styleId
    ? 1
    : Array.isArray(target.styleIds)
      ? Math.max(1, target.styleIds.length)
      : 0;
  return styleCount || itemCount;
}

function addExpandedRuleEdges(budget, amount, path, issues) {
  budget.expandedEdges += Math.min(amount, LIMITS.expandedRuleEdges + 1);
  if (budget.expandedEdges > LIMITS.expandedRuleEdges && !budget.expandedLimitReported) {
    budget.expandedLimitReported = true;
    issue(
      issues,
      path,
      'MAKER_V8_RULE_EXPANDED_EDGE_LIMIT',
      `Canonical Rule expansion cannot exceed ${LIMITS.expandedRuleEdges} concrete edges.`,
    );
  }
}

function validateSelectionTarget(target, path, known, issues) {
  if (!isRecord(target)) {
    issue(issues, path, 'MAKER_V8_RULE_TARGET_INVALID', 'Rule target must be an object.');
    return;
  }
  const partId = String(target.partId || '');
  if (!known.parts.has(partId)) {
    issue(issues, `${path}.partId`, 'MAKER_V8_RULE_PART_UNKNOWN', 'Rule references an unknown Part.');
    return;
  }
  if (hasOwn(target, 'itemId') && hasOwn(target, 'itemIds')) {
    issue(issues, path, 'MAKER_V8_RULE_ITEM_SCOPE_AMBIGUOUS', 'Rule targets cannot use itemId and itemIds together.');
  }
  if (hasOwn(target, 'styleId') && hasOwn(target, 'styleIds')) {
    issue(issues, path, 'MAKER_V8_RULE_STYLE_SCOPE_AMBIGUOUS', 'Rule targets cannot use styleId and styleIds together.');
  }
  if (hasOwn(target, 'itemId') && (typeof target.itemId !== 'string' || !target.itemId)) {
    issue(issues, `${path}.itemId`, 'MAKER_V8_RULE_ITEM_INVALID', 'Rule Item ID must be a non-empty string.');
  }
  if (hasOwn(target, 'styleId') && (typeof target.styleId !== 'string' || !target.styleId)) {
    issue(issues, `${path}.styleId`, 'MAKER_V8_RULE_STYLE_INVALID', 'Rule Style ID must be a non-empty string.');
  }
  if (hasOwn(target, 'itemIds')) {
    validateSortedUniqueStrings(target.itemIds, `${path}.itemIds`, issues, {
      limit: LIMITS.ruleTargets,
      invalidCode: 'MAKER_V8_RULE_ITEM_INVALID',
      limitCode: 'MAKER_V8_RULE_TARGET_LIMIT',
    });
    if (Array.isArray(target.itemIds) && target.itemIds.length === 0) {
      issue(issues, `${path}.itemIds`, 'MAKER_V8_RULE_ITEM_INVALID', 'Grouped Item targets cannot be empty.');
    }
  }
  if (hasOwn(target, 'styleIds')) {
    validateSortedUniqueStrings(target.styleIds, `${path}.styleIds`, issues, {
      limit: LIMITS.ruleTargets,
      invalidCode: 'MAKER_V8_RULE_STYLE_INVALID',
      limitCode: 'MAKER_V8_RULE_TARGET_LIMIT',
    });
    if (Array.isArray(target.styleIds) && target.styleIds.length === 0) {
      issue(issues, `${path}.styleIds`, 'MAKER_V8_RULE_STYLE_INVALID', 'Grouped Style targets cannot be empty.');
    }
  }
  const itemIds = exactIds([
    ...(target.itemId ? [target.itemId] : []),
    ...(Array.isArray(target.itemIds) ? target.itemIds : []),
  ]);
  itemIds.forEach((itemId) => {
    if (!known.items.get(partId)?.has(itemId)) {
      issue(issues, `${path}.itemId`, 'MAKER_V8_RULE_ITEM_UNKNOWN', 'Rule references an unknown Item.');
    }
  });
  const styleIds = exactIds([
    ...(target.styleId ? [target.styleId] : []),
    ...(Array.isArray(target.styleIds) ? target.styleIds : []),
  ]);
  if (styleIds.length && itemIds.length !== 1) {
    issue(issues, `${path}.styleId`, 'MAKER_V8_RULE_STYLE_SCOPE_INVALID', 'Style targets require exactly one Item.');
  } else {
    styleIds.forEach((styleId) => {
      if (!known.styles.get(`${partId}:${itemIds[0] || ''}`)?.has(styleId)) {
        issue(issues, `${path}.styleId`, 'MAKER_V8_RULE_STYLE_UNKNOWN', 'Rule references an unknown Style.');
      }
    });
  }
}

function selectionTargetKey(target) {
  return JSON.stringify([
    String(target?.partId || ''),
    exactIds([
      ...(target?.itemId ? [target.itemId] : []),
      ...(Array.isArray(target?.itemIds) ? target.itemIds : []),
    ]),
    exactIds([
      ...(target?.styleId ? [target.styleId] : []),
      ...(Array.isArray(target?.styleIds) ? target.styleIds : []),
    ]),
  ]);
}

function validateCondition(condition, path, known, issues, budget, depth = 0) {
  if (condition === null || condition === undefined) return;
  if (depth > 12 || !isRecord(condition)) {
    issue(issues, path, 'MAKER_V8_CONDITION_INVALID', 'Visibility condition is malformed or too deeply nested.');
    return;
  }
  addConditionNode(budget, path, issues);
  if (condition.op === 'selected') {
    validateSelectionTarget(condition, path, known, issues);
    addExpandedRuleEdges(budget, selectionTargetWidth(condition), path, issues);
    return;
  }
  if (condition.op === 'not') {
    validateCondition(condition.condition, `${path}.condition`, known, issues, budget, depth + 1);
    return;
  }
  if (condition.op === 'all' || condition.op === 'any') {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
      issue(issues, `${path}.conditions`, 'MAKER_V8_CONDITION_CHILDREN_REQUIRED', 'Grouped condition needs at least one child.');
      return;
    }
    if (condition.conditions.length > LIMITS.ruleTargets) {
      issue(issues, `${path}.conditions`, 'MAKER_V8_CONDITION_CHILD_LIMIT', `Condition groups cannot exceed ${LIMITS.ruleTargets} children.`);
    }
    condition.conditions.forEach((child, index) => (
      validateCondition(child, `${path}.conditions[${index}]`, known, issues, budget, depth + 1)
    ));
    return;
  }
  issue(issues, `${path}.op`, 'MAKER_V8_CONDITION_OPERATOR_INVALID', 'Condition operator must be selected, not, all, or any.');
}

function validateEmbeddedRules(owner, path, known, issues, budget) {
  for (const field of ['requires', 'excludes']) {
    if (!Array.isArray(owner?.[field])) {
      issue(issues, `${path}.${field}`, 'MAKER_V8_RULE_LIST_INVALID', 'Embedded rule targets must be an array.');
      continue;
    }
    if (owner[field].length > LIMITS.ruleTargets) {
      issue(issues, `${path}.${field}`, 'MAKER_V8_RULE_TARGET_LIMIT', `Embedded Rule lists cannot exceed ${LIMITS.ruleTargets} targets.`);
    }
    addRuleTargetRecords(budget, owner[field].length, `${path}.${field}`, issues);
    const seen = new Set();
    owner[field].forEach((target, index) => {
      validateSelectionTarget(target, `${path}.${field}[${index}]`, known, issues);
      addExpandedRuleEdges(
        budget,
        selectionTargetWidth(target),
        `${path}.${field}[${index}]`,
        issues,
      );
      const key = selectionTargetKey(target);
      if (seen.has(key)) {
        issue(issues, `${path}.${field}[${index}]`, 'MAKER_V8_RULE_TARGET_DUPLICATE', 'Embedded rule target is duplicated.');
      }
      seen.add(key);
    });
  }
  const required = new Set((Array.isArray(owner?.requires) ? owner.requires : []).map(selectionTargetKey));
  (Array.isArray(owner?.excludes) ? owner.excludes : []).forEach((target, index) => {
    if (required.has(selectionTargetKey(target))) {
      issue(issues, `${path}.excludes[${index}]`, 'MAKER_V8_RULE_TARGET_CONTRADICTORY', 'The same target cannot be both required and excluded.');
    }
  });
  validateCondition(owner?.visibleWhen, `${path}.visibleWhen`, known, issues, budget);
}

function validateRules(records, known, path, issues, budget) {
  if (!Array.isArray(records)) {
    issue(issues, path, 'MAKER_V8_RULES_INVALID', 'Global rules must be an array.');
    return new Set();
  }
  const ids = validateUniqueIds(records, path, issues);
  if (records.length > LIMITS.ruleTargets) {
    issue(issues, path, 'MAKER_V8_RULE_LIMIT', `Global rules cannot exceed ${LIMITS.ruleTargets} entries.`);
  }
  records.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`;
    if (rule?.type !== 'requires' && rule?.type !== 'excludes') {
      issue(issues, `${rulePath}.type`, 'MAKER_V8_RULE_TYPE_INVALID', 'Rule type must be requires or excludes.');
    }
    validateSelectionTarget(rule?.trigger, `${rulePath}.trigger`, known, issues);
    addRuleTargetRecords(budget, 1, `${rulePath}.trigger`, issues);
    if (!Array.isArray(rule?.targets) || rule.targets.length === 0) {
      issue(issues, `${rulePath}.targets`, 'MAKER_V8_RULE_TARGET_REQUIRED', 'Rule needs at least one target.');
    } else {
      addRuleTargetRecords(budget, rule.targets.length, `${rulePath}.targets`, issues);
      if (rule.targets.length > LIMITS.ruleTargets) {
        issue(issues, `${rulePath}.targets`, 'MAKER_V8_RULE_TARGET_LIMIT', `Rule targets cannot exceed ${LIMITS.ruleTargets} entries.`);
      }
      rule.targets.forEach((target, targetIndex) => (
        validateSelectionTarget(target, `${rulePath}.targets[${targetIndex}]`, known, issues)
      ));
      const triggerWidth = selectionTargetWidth(rule?.trigger);
      const targetWidth = rule.targets.reduce((total, target) => (
        total + selectionTargetWidth(target)
      ), 0);
      const expanded = triggerWidth > LIMITS.expandedRuleEdges
        || targetWidth > LIMITS.expandedRuleEdges
        || triggerWidth * targetWidth > LIMITS.expandedRuleEdges
        ? LIMITS.expandedRuleEdges + 1
        : triggerWidth * targetWidth;
      addExpandedRuleEdges(budget, expanded, rulePath, issues);
    }
  });
  return ids;
}

function recipeContainsSelection(recipe, expected) {
  return (recipe?.selections || []).some((entry) => (
    entry.partId === expected.partId
    && entry.itemId === expected.itemId
    && entry.styleId === expected.styleId
  ));
}

function ruleViolationCodes(result) {
  return [...new Set((result?.violations || [])
    .map((entry) => String(entry?.code || ''))
    .filter(Boolean))];
}

/**
 * Executes the same rule engine used by the established Creator and Player.
 * Structural similarity is insufficient: v8 activation must prove that the
 * default Recipe and every public Style are actually playable.
 */
function validateExecutableRuleGraph(document, issues) {
  try {
    const index = createMakerRuleIndex(document);
    const defaultResult = evaluateRecipe(document, document.defaultRecipe, { index });
    if (!defaultResult.valid) {
      issue(
        issues,
        'defaultRecipe',
        'MAKER_V8_DEFAULT_RECIPE_RULE_VIOLATION',
        `Default Recipe violates shared Maker rules${ruleViolationCodes(defaultResult).length ? ` (${ruleViolationCodes(defaultResult).join(', ')})` : ''}.`,
      );
    }
    const graph = normalizeRecipe(
      document,
      { selections: [], colors: document.defaultRecipe?.colors || [] },
      { index },
    );
    if (!graph.valid) {
      issue(
        issues,
        'rules',
        ruleViolationCodes(graph).includes('constraint-search-limit')
          ? 'MAKER_V8_RULE_SEARCH_LIMIT'
          : 'MAKER_V8_RULE_GRAPH_UNSATISFIABLE',
        'No playable public Recipe satisfies the shared Maker rule graph.',
      );
      return;
    }
    let reachable = 0;
    document.parts.forEach((part) => {
      (part.items || []).filter((item) => item?.status === 'public').forEach((item) => {
        (item.styles || []).forEach((style) => {
          const expected = { partId: part.id, itemId: item.id, styleId: style.id };
          const candidate = normalizeRecipe(
            document,
            { selections: [expected], colors: document.defaultRecipe?.colors || [] },
            { index, lockedPartIds: [part.id] },
          );
          if (candidate.valid && recipeContainsSelection(candidate.documentRecipe, expected)) {
            reachable += 1;
          } else {
            issue(
              issues,
              `parts.${part.id}.items.${item.id}.styles.${style.id}`,
              ruleViolationCodes(candidate).includes('constraint-search-limit')
                ? 'MAKER_V8_RULE_SEARCH_LIMIT'
                : 'MAKER_V8_PUBLIC_STYLE_UNREACHABLE',
              'Public Style cannot appear in any valid Player Recipe.',
            );
          }
        });
      });
    });
    if (reachable === 0) {
      issue(issues, 'rules', 'MAKER_V8_RULE_GRAPH_UNSATISFIABLE', 'No public Style can appear in a playable Recipe.');
    }
  } catch (error) {
    issue(issues, 'rules', 'MAKER_V8_RULE_EVALUATION_FAILED', error?.message || 'Shared Maker rules could not be evaluated.');
  }
}

function validateDefaultRecipe(document, known, channels, compile, issues) {
  const recipe = document?.defaultRecipe;
  if (!isRecord(recipe)
    || !Array.isArray(recipe.selections)
    || !Array.isArray(recipe.colors)) {
    issue(issues, 'defaultRecipe', 'MAKER_V8_DEFAULT_RECIPE_INVALID', 'Default Recipe needs selection and color arrays.');
    return;
  }
  if (recipe.selections.length > LIMITS.parts) {
    issue(issues, 'defaultRecipe.selections', 'MAKER_V8_DEFAULT_SELECTION_LIMIT', `Default Recipe cannot exceed ${LIMITS.parts} Part selections.`);
  }
  if (recipe.colors.length > LIMITS.colorChannels) {
    issue(issues, 'defaultRecipe.colors', 'MAKER_V8_DEFAULT_COLOR_LIMIT', `Default Recipe cannot exceed ${LIMITS.colorChannels} color selections.`);
  }

  const selectedParts = new Set();
  recipe.selections.forEach((selection, index) => {
    const path = `defaultRecipe.selections[${index}]`;
    validateSelectionTarget(selection, path, known, issues);
    const partId = String(selection?.partId || '');
    const itemId = String(selection?.itemId || '');
    const styleId = String(selection?.styleId || '');
    if (selectedParts.has(partId)) {
      issue(issues, `${path}.partId`, 'MAKER_V8_DEFAULT_PART_DUPLICATE', 'Default Recipe can select each Part only once.');
    }
    selectedParts.add(partId);
    if (!itemId || !styleId || hasOwn(selection, 'itemIds') || hasOwn(selection, 'styleIds')) {
      issue(issues, path, 'MAKER_V8_DEFAULT_SELECTION_INVALID', 'Default selection needs exactly one Item and one Style.');
      return;
    }
    const part = known.partRecords.get(partId);
    const item = known.itemRecords.get(`${partId}:${itemId}`);
    if (part?.defaultItemId && itemId !== part.defaultItemId) {
      issue(issues, `${path}.itemId`, 'MAKER_V8_DEFAULT_ITEM_MISMATCH', 'Default Recipe Item must match Part.defaultItemId.');
    }
    if (item?.defaultStyleId && styleId !== item.defaultStyleId) {
      issue(issues, `${path}.styleId`, 'MAKER_V8_DEFAULT_STYLE_MISMATCH', 'Default Recipe Style must match Item.defaultStyleId.');
    }
  });
  if (compile) {
    known.partRecords.forEach((part, partId) => {
      if ((part.required || part.defaultItemId) && !selectedParts.has(partId)) {
        issue(issues, 'defaultRecipe.selections', 'MAKER_V8_DEFAULT_SELECTION_MISSING', `Default Recipe is missing Part ${partId}.`);
      }
    });
  }

  const selectedChannels = new Set();
  recipe.colors.forEach((selection, index) => {
    const path = `defaultRecipe.colors[${index}]`;
    if (!isRecord(selection)) {
      issue(issues, path, 'MAKER_V8_DEFAULT_COLOR_INVALID', 'Default color selection must be an object.');
      return;
    }
    const channelId = String(selection.channelId || '');
    const swatchId = String(selection.swatchId || '');
    const channel = channels.get(channelId);
    if (!channel) {
      issue(issues, `${path}.channelId`, 'MAKER_V8_DEFAULT_COLOR_CHANNEL_UNKNOWN', 'Default color references an unknown channel.');
    }
    if (selectedChannels.has(channelId)) {
      issue(issues, `${path}.channelId`, 'MAKER_V8_DEFAULT_COLOR_DUPLICATE', 'Default Recipe can select each color channel only once.');
    }
    selectedChannels.add(channelId);
    if (channel && !(channel.swatches || []).some((swatch) => swatch?.id === swatchId)) {
      issue(issues, `${path}.swatchId`, 'MAKER_V8_DEFAULT_SWATCH_UNKNOWN', 'Default color references an unknown swatch.');
    }
    if (channel?.defaultSwatchId && swatchId !== channel.defaultSwatchId) {
      issue(issues, `${path}.swatchId`, 'MAKER_V8_DEFAULT_SWATCH_MISMATCH', 'Default Recipe swatch must match ColorChannel.defaultSwatchId.');
    }
  });
  if (compile) {
    channels.forEach((channel, channelId) => {
      if (channel.defaultSwatchId && !selectedChannels.has(channelId)) {
        issue(issues, 'defaultRecipe.colors', 'MAKER_V8_DEFAULT_COLOR_MISSING', `Default Recipe is missing color channel ${channelId}.`);
      }
    });
  }
}

function validateCompleteDefinitions(document, compile, issues) {
  if (!isRecord(document?.complete)) {
    issue(issues, 'complete', 'MAKER_V8_COMPLETE_REQUIRED', 'Complete author policy is required.');
    return;
  }
  if (!Array.isArray(document.complete.outputs)) {
    issue(issues, 'complete.outputs', 'MAKER_V8_COMPLETE_OUTPUTS_INVALID', 'Complete outputs must be an array.');
    return;
  }
  if (document.complete.outputs.length > LIMITS.completeOutputs) {
    issue(issues, 'complete.outputs', 'MAKER_V8_COMPLETE_OUTPUT_LIMIT', `Complete cannot exceed ${LIMITS.completeOutputs} outputs.`);
  }
  const outputIds = validateUniqueIds(document.complete.outputs, 'complete.outputs', issues);
  if (compile && outputIds.size === 0) {
    issue(issues, 'complete.outputs', 'MAKER_V8_COMPLETE_OUTPUT_REQUIRED', 'Published Maker v8 needs at least one Complete output.');
  }
  let expandedPackEdges = 0;
  let edgeLimitReported = false;
  document.complete.outputs.forEach((output, index) => {
    const path = `complete.outputs[${index}]`;
    validateName(output?.name, `${path}.name`, issues);
    if (typeof output?.protected !== 'boolean') {
      issue(issues, `${path}.protected`, 'MAKER_V8_COMPLETE_PROTECTION_INVALID', 'Complete protection must be an explicit boolean.');
    }
    const policy = output?.allowedPackPolicy;
    if (!isRecord(policy)) {
      issue(issues, `${path}.allowedPackPolicy`, 'MAKER_V8_COMPLETE_PACK_POLICY_REQUIRED', 'Complete needs an explicit runtime-admitted Pack policy.');
      return;
    }
    if (!COMPLETE_PACK_POLICY_MODES.has(policy.mode)) {
      issue(issues, `${path}.allowedPackPolicy.mode`, 'MAKER_V8_COMPLETE_PACK_POLICY_MODE_INVALID', 'Pack policy mode must be ALL_ADMITTED or ALLOWLIST.');
    }
    const packIds = validateSortedUniqueStrings(
      policy.packIds,
      `${path}.allowedPackPolicy.packIds`,
      issues,
      {
        limit: LIMITS.completePackIds,
        pattern: SAFE_SEMANTIC_PACK_ID,
        invalidCode: 'MAKER_V8_COMPLETE_PACK_ID_INVALID',
        limitCode: 'MAKER_V8_COMPLETE_PACK_ID_LIMIT',
      },
    );
    if (policy.mode === MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALL_ADMITTED
      && packIds.length) {
      issue(
        issues,
        `${path}.allowedPackPolicy`,
        'MAKER_V8_COMPLETE_PACK_POLICY_REDUNDANT',
        'ALL_ADMITTED derives the current admitted Pack set at runtime and cannot carry a frozen allowlist.',
      );
    }
    if (policy.mode === MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALLOWLIST
      && packIds.length === 0) {
      issue(
        issues,
        `${path}.allowedPackPolicy`,
        'MAKER_V8_COMPLETE_PACK_ALLOWLIST_EMPTY',
        'ALLOWLIST needs at least one semantic Pack ID.',
      );
    }
    expandedPackEdges += packIds.length;
    if (expandedPackEdges > LIMITS.completePackEdges && !edgeLimitReported) {
      edgeLimitReported = true;
      issue(
        issues,
        `${path}.allowedPackPolicy`,
        'MAKER_V8_COMPLETE_PACK_EDGE_LIMIT',
        `Complete Pack policies cannot expand beyond ${LIMITS.completePackEdges} Pack-ID edges across all outputs.`,
      );
    }
  });
}

export function makerV8Inventory(document) {
  const parts = Array.isArray(document?.parts) ? document.parts : [];
  const assets = Array.isArray(document?.assets) ? document.assets : [];
  let itemCount = 0;
  let styleCount = 0;
  let slotCount = 0;
  let protectedStyleCount = 0;
  let physicalStyleCount = 0;
  let colorCount = 0;
  (Array.isArray(document?.colorChannels) ? document.colorChannels : [])
    .forEach((channel) => {
      colorCount += Array.isArray(channel?.swatches) ? channel.swatches.length : 0;
    });
  parts.forEach((part) => {
    if (part?.wardrobeMode === 'SLOT') slotCount += 1;
    (Array.isArray(part?.items) ? part.items : []).forEach((item) => {
      itemCount += 1;
      (Array.isArray(item?.styles) ? item.styles : []).forEach((style) => {
        styleCount += 1;
        if (style?.seal?.protected === true) protectedStyleCount += 1;
        if (style?.physical?.enabled === true) physicalStyleCount += 1;
      });
    });
  });
  return deepFreeze({
    tracks: Array.isArray(document?.layerTracks) ? document.layerTracks.length : 0,
    parts: parts.length,
    items: itemCount,
    styles: styleCount,
    colorChannels: Array.isArray(document?.colorChannels) ? document.colorChannels.length : 0,
    colors: colorCount,
    rules: Array.isArray(document?.rules) ? document.rules.length : 0,
    packs: 0,
    assets: assets.length,
    compositionSlots: slotCount,
    protectedStyles: protectedStyleCount,
    physicalStyles: physicalStyleCount,
    completeOutputs: Array.isArray(document?.complete?.outputs)
      ? document.complete.outputs.length
      : 0,
  });
}

function collectMakerV8DocumentIssuesUnsafe(document, { mode = 'draft' } = {}) {
  const issues = [];
  if (!VALIDATION_MODES.has(mode)) {
    issue(issues, 'mode', 'MAKER_V8_VALIDATION_MODE_INVALID', 'Validation mode must be draft, compile, or activate.');
  }
  const compile = mode === 'compile' || mode === 'activate';
  if (!isRecord(document)) {
    issue(issues, '', 'MAKER_V8_DOCUMENT_REQUIRED', 'Maker v8 document is required.');
    return Object.freeze(issues);
  }
  document = snapshotAuthorJsonTree(document, issues);
  if (!document) return Object.freeze(issues);
  collectMakerV8AuthorShapeIssuesInto(document, issues);
  if (document.schemaVersion !== MAKER_V8_DOCUMENT_SCHEMA) {
    issue(issues, 'schemaVersion', 'MAKER_V8_DOCUMENT_SCHEMA_INVALID', 'Document schema must be animacraft.maker.v8.');
  }
  if (document.protocolVersion !== MAKER_V8_DOCUMENT_VERSION) {
    issue(issues, 'protocolVersion', 'MAKER_V8_PROTOCOL_VERSION_INVALID', 'Protocol version must equal 8.');
  }
  if (!isRecord(document.lineage)) {
    issue(issues, 'lineage', 'MAKER_V8_LINEAGE_REQUIRED', 'v8 lineage is required.');
  } else {
    validateId(document.lineage.rootMakerKey, 'lineage.rootMakerKey', issues);
    validateId(document.lineage.versionKey, 'lineage.versionKey', issues);
    if (!Number.isSafeInteger(document.lineage.number) || document.lineage.number <= 0) {
      issue(issues, 'lineage.number', 'MAKER_V8_LINEAGE_NUMBER_INVALID', 'Version number must be positive.');
    }
    if (document.lineage.createdAt !== null && typeof document.lineage.createdAt !== 'string') {
      issue(issues, 'lineage.createdAt', 'MAKER_V8_LINEAGE_TIME_INVALID', 'Creation time must be null or an authoring timestamp string.');
    }
    validateName(document.lineage.changelog, 'lineage.changelog', issues, { required: false, max: MAX_DESCRIPTION_BYTES });
  }

  if (!isRecord(document.metadata)) {
    issue(issues, 'metadata', 'MAKER_V8_METADATA_REQUIRED', 'Metadata is required.');
  } else {
    validateId(document.metadata.id, 'metadata.id', issues);
    validateName(document.metadata.name, 'metadata.name', issues);
    validateName(document.metadata.summary, 'metadata.summary', issues, { required: false, max: MAX_DESCRIPTION_BYTES });
    validateName(document.metadata.style, 'metadata.style', issues, { required: false });
    if (document.metadata.coverAssetId !== null
      && document.metadata.coverAssetId !== undefined
      && (typeof document.metadata.coverAssetId !== 'string'
        || !SAFE_ID.test(document.metadata.coverAssetId)
        || utf8Length(document.metadata.coverAssetId) > MAX_NAME_BYTES)) {
      issue(issues, 'metadata.coverAssetId', 'MAKER_V8_COVER_ID_INVALID', 'Cover Asset ID must be null or a safe semantic Asset ID.');
    }
    if (!isRecord(document.metadata.license)
      || !LICENSE_KINDS.has(document.metadata.license.kind)) {
      issue(issues, 'metadata.license', 'MAKER_V8_LICENSE_INVALID', 'Metadata needs an exact supported Creator license kind.');
    } else {
      validateName(document.metadata.license.note, 'metadata.license.note', issues, {
        required: false,
        max: MAX_DESCRIPTION_BYTES,
      });
    }
  }
  if (!isRecord(document.canvas)
    || !Number.isSafeInteger(document.canvas.width)
    || !Number.isSafeInteger(document.canvas.height)
    || document.canvas.width < 64
    || document.canvas.height < 64
    || document.canvas.width > MAX_CANVAS
    || document.canvas.height > MAX_CANVAS
    || !PIXEL_MODES.has(document.canvas.pixelMode)) {
    issue(issues, 'canvas', 'MAKER_V8_CANVAS_INVALID', 'Canvas must be 64–8192 pixels with a supported pixel mode.');
  }
  if (!isRecord(document.capabilities)) {
    issue(issues, 'capabilities', 'MAKER_V8_CAPABILITIES_REQUIRED', 'The derived complete v8 capability set is required.');
  } else {
    MAKER_V8_CAPABILITIES.forEach((name) => {
      if (document.capabilities[name] !== true) {
        issue(issues, `capabilities.${name}`, 'MAKER_V8_REQUIRED_CAPABILITY_DISABLED', 'Fresh Maker v8 always derives every native capability as true, including empty registries.');
      }
    });
    Object.keys(document.capabilities).forEach((name) => {
      if (!MAKER_V8_CAPABILITIES.includes(name)) {
        issue(issues, `capabilities.${name}`, 'MAKER_V8_CAPABILITY_UNKNOWN', 'Unknown or legacy capability flags are not part of unified Maker v8.');
      }
    });
  }

  if (!isRecord(document.composition)) {
    issue(issues, 'composition', 'MAKER_V8_COMPOSITION_PROFILE_REQUIRED', 'Maker-wide composition authoring profile is required.');
  } else {
    if (!COMPOSITION_MODES.has(document.composition.mode)) {
      issue(issues, 'composition.mode', 'MAKER_V8_COMPOSITION_MODE_INVALID', 'Composition mode must be FIXED or COMPOSABLE.');
    }
    if (!THIRD_PARTY_ADMISSION.has(document.composition.thirdPartyAdmission)) {
      issue(issues, 'composition.thirdPartyAdmission', 'MAKER_V8_THIRD_PARTY_ADMISSION_INVALID', 'Third-party admission must be DISABLED, CERTIFIED, or OPEN.');
    }
    if (typeof document.composition.itemAssetization !== 'boolean') {
      issue(issues, 'composition.itemAssetization', 'MAKER_V8_ITEM_ASSETIZATION_INVALID', 'Item assetization must be an explicit boolean.');
    }
    if (document.composition.mode === COMPOSABLE_PROFILE_MODES.FIXED) {
      if (document.composition.thirdPartyAdmission !== THIRD_PARTY_ADMISSION_MODES.DISABLED) {
        issue(issues, 'composition.thirdPartyAdmission', 'MAKER_V8_FIXED_THIRD_PARTY_INVALID', 'FIXED blocks third-party gear but still permits Player choice among base and admitted official Pack Styles.');
      }
      if (document.composition.itemAssetization !== false) {
        issue(issues, 'composition.itemAssetization', 'MAKER_V8_FIXED_ASSETIZATION_INVALID', 'FIXED does not mint independently owned third-party Item products.');
      }
    }
  }

  if (!Array.isArray(document.assets)) {
    issue(issues, 'assets', 'MAKER_V8_ASSETS_INVALID', 'Assets must be an array.');
  }
  if (Array.isArray(document.assets) && document.assets.length > LIMITS.assets) {
    issue(issues, 'assets', 'MAKER_V8_ASSET_LIMIT', `Assets cannot exceed ${LIMITS.assets} entries.`);
  }
  const assetIds = validateUniqueIds(document.assets, 'assets', issues);
  const assets = new Map((Array.isArray(document.assets) ? document.assets : [])
    .map((asset) => [String(asset?.id || ''), asset]));
  (Array.isArray(document.assets) ? document.assets : []).forEach((asset, index) => {
    const assetPath = `assets[${index}]`;
    if (!ASSET_KINDS.has(asset?.kind)) {
      issue(issues, `${assetPath}.kind`, 'MAKER_V8_ASSET_KIND_INVALID', 'Asset kind is unsupported.');
    }
    if (asset?.identifier !== undefined
      && (typeof asset.identifier !== 'string'
        || !asset.identifier
        || utf8Length(asset.identifier) > 512)) {
      issue(issues, `${assetPath}.identifier`, 'MAKER_V8_ASSET_IDENTIFIER_INVALID', 'Asset identifier must be a non-empty string no longer than 512 UTF-8 bytes.');
    }
    for (const field of ['width', 'height']) {
      if (asset?.[field] !== undefined && (
        !Number.isSafeInteger(asset[field])
        || asset[field] <= 0
        || asset[field] > MAX_ASSET_DIMENSION
      )) {
        issue(issues, `${assetPath}.${field}`, 'MAKER_V8_ASSET_DIMENSION_INVALID', `Asset dimensions must be positive integers no greater than ${MAX_ASSET_DIMENSION}.`);
      }
    }
    if (asset?.byteLength !== undefined && (
      !Number.isSafeInteger(asset.byteLength)
      || asset.byteLength <= 0
    )) {
      issue(issues, `${assetPath}.byteLength`, 'MAKER_V8_ASSET_LENGTH_INVALID', 'Asset byte length must be a positive integer when present.');
    }
    if (asset?.mediaType !== undefined
      && (typeof asset.mediaType !== 'string' || !asset.mediaType)) {
      issue(issues, `${assetPath}.mediaType`, 'MAKER_V8_ASSET_MEDIA_TYPE_INVALID', 'Asset media type must be a non-empty string when present.');
    }
    if (compile && asset?.byteLength === undefined) {
      issue(issues, `${assetPath}.byteLength`, 'MAKER_V8_ASSET_LENGTH_INVALID', 'Compiled assets need a positive byte length.');
    }
    if (compile && asset?.mediaType === undefined) {
      issue(issues, `${assetPath}.mediaType`, 'MAKER_V8_ASSET_MEDIA_TYPE_INVALID', 'Compiled assets need an exact media type.');
    }
  });
  if (document.commerce?.rightsOrigin === MAKER_V8_RIGHTS_ORIGINS.LICENSE_WRAPPED) {
    const evidenceAssetId = document.commerce?.rightsEvidence?.evidenceAssetId;
    const evidenceAsset = typeof evidenceAssetId === 'string'
      ? assets.get(evidenceAssetId)
      : null;
    if (!evidenceAsset || evidenceAsset.kind !== 'rights-evidence') {
      issue(
        issues,
        'commerce.rightsEvidence.evidenceAssetId',
        'MAKER_V8_RIGHTS_EVIDENCE_ASSET_INVALID',
        'Wrapped-license evidence must reference an existing dedicated rights-evidence Asset.',
      );
    }
  }
  if (compile) {
    const coverId = String(document.metadata?.coverAssetId || '');
    const cover = assets.get(coverId);
    if (!assetIds.has(coverId)
      || cover?.kind !== 'maker-cover'
      || !String(cover?.mediaType || '').toLowerCase().startsWith('image/')) {
      issue(issues, 'metadata.coverAssetId', 'MAKER_V8_COVER_REQUIRED', 'Cover must reference an existing dedicated maker-cover image asset.');
    }
  }

  if (!Array.isArray(document.layerTracks)) {
    issue(issues, 'layerTracks', 'MAKER_V8_TRACKS_INVALID', 'Layer Tracks must be an array.');
  }
  if (Array.isArray(document.layerTracks) && document.layerTracks.length > LIMITS.tracks) {
    issue(issues, 'layerTracks', 'MAKER_V8_TRACK_LIMIT', `Layer Tracks cannot exceed ${LIMITS.tracks} entries.`);
  }
  const trackIds = validateUniqueIds(document.layerTracks, 'layerTracks', issues);
  validateContiguousOrder(document.layerTracks, 'layerTracks', issues);
  (Array.isArray(document.layerTracks) ? document.layerTracks : []).forEach((track, index) => {
    const trackPath = `layerTracks[${index}]`;
    validateName(track?.name, `${trackPath}.name`, issues);
    if (track?.locked !== undefined && typeof track.locked !== 'boolean') {
      issue(issues, `${trackPath}.locked`, 'MAKER_V8_TRACK_LOCK_INVALID', 'Layer Track locked state must be boolean.');
    }
    if (track?.referenceAssetId !== null
      && track?.referenceAssetId !== undefined
      && !assetIds.has(String(track.referenceAssetId))) {
      issue(issues, `${trackPath}.referenceAssetId`, 'MAKER_V8_TRACK_REFERENCE_UNKNOWN', 'Layer Track references an unknown Asset.');
    }
  });

  if (!Array.isArray(document.colorChannels)) {
    issue(issues, 'colorChannels', 'MAKER_V8_COLORS_INVALID', 'Color channels must be an array.');
  }
  if (Array.isArray(document.colorChannels) && document.colorChannels.length > LIMITS.colorChannels) {
    issue(issues, 'colorChannels', 'MAKER_V8_COLOR_CHANNEL_LIMIT', `Color channels cannot exceed ${LIMITS.colorChannels} entries.`);
  }
  const colorIds = validateUniqueIds(document.colorChannels, 'colorChannels', issues);
  validateContiguousOrder(document.colorChannels, 'colorChannels', issues);
  let totalColors = 0;
  let totalGradientStops = 0;
  (Array.isArray(document.colorChannels) ? document.colorChannels : []).forEach((channel, index) => {
    validateName(channel?.name, `colorChannels[${index}].name`, issues);
    if (channel?.mode !== 'gradient-map') {
      issue(issues, `colorChannels[${index}].mode`, 'MAKER_V8_COLOR_MODE_INVALID', 'Color channel mode must be gradient-map.');
    }
    if (!Array.isArray(channel?.swatches)) {
      issue(issues, `colorChannels[${index}].swatches`, 'MAKER_V8_SWATCHES_INVALID', 'Color channel swatches must be an array.');
    } else if (compile && channel.swatches.length === 0) {
      issue(issues, `colorChannels[${index}].swatches`, 'MAKER_V8_SWATCH_REQUIRED', 'Published color channel needs at least one swatch.');
    } else {
      totalColors += channel.swatches.length;
      if (channel.swatches.length > LIMITS.swatchesPerChannel) {
        issue(issues, `colorChannels[${index}].swatches`, 'MAKER_V8_SWATCH_LIMIT', `Color channel cannot exceed ${LIMITS.swatchesPerChannel} swatches.`);
      }
      const swatches = validateUniqueIds(channel.swatches, `colorChannels[${index}].swatches`, issues);
      if (channel.defaultSwatchId !== null
        && channel.defaultSwatchId !== undefined
        && !swatches.has(String(channel.defaultSwatchId))) {
        issue(issues, `colorChannels[${index}].defaultSwatchId`, 'MAKER_V8_DEFAULT_SWATCH_INVALID', 'Default swatch must exist in its channel.');
      }
      if (compile && !channel.defaultSwatchId) {
        issue(issues, `colorChannels[${index}].defaultSwatchId`, 'MAKER_V8_DEFAULT_SWATCH_REQUIRED', 'Published color channel needs a default swatch.');
      }
      channel.swatches.forEach((swatch, swatchIndex) => {
        const swatchPath = `colorChannels[${index}].swatches[${swatchIndex}]`;
        validateName(swatch?.name, `${swatchPath}.name`, issues);
        if (!HEX_COLOR.test(String(swatch?.hintColor || ''))) {
          issue(issues, `${swatchPath}.hintColor`, 'MAKER_V8_SWATCH_COLOR_INVALID', 'Swatch hint color must be six- or eight-digit hex.');
        }
        const stops = Array.isArray(swatch?.stops) ? swatch.stops : [];
        totalGradientStops += stops.length;
        if (stops.length < 2) {
          issue(issues, `${swatchPath}.stops`, 'MAKER_V8_SWATCH_STOPS_INVALID', 'Gradient swatch needs at least two stops.');
        }
        if (stops.length > LIMITS.gradientStopsPerSwatch) {
          issue(issues, `${swatchPath}.stops`, 'MAKER_V8_SWATCH_STOP_LIMIT', `Gradient swatch cannot exceed ${LIMITS.gradientStopsPerSwatch} stops.`);
        }
        stops.forEach((stop, stopIndex) => {
          if (!isRecord(stop)
            || typeof stop.offset !== 'number'
            || stop.offset < 0
            || stop.offset > 1
            || !HEX_COLOR.test(String(stop.color || ''))) {
            issue(issues, `${swatchPath}.stops[${stopIndex}]`, 'MAKER_V8_SWATCH_STOP_INVALID', 'Gradient stop needs an offset from 0 to 1 and a hex color.');
          }
        });
        if (stops.length >= 2 && (
          stops[0]?.offset !== 0
          || stops.at(-1)?.offset !== 1
          || stops.some((stop, stopIndex) => (
            stopIndex > 0 && stop?.offset <= stops[stopIndex - 1]?.offset
          ))
        )) {
          issue(issues, `${swatchPath}.stops`, 'MAKER_V8_SWATCH_ORDER_INVALID', 'Gradient stops must be strictly ordered from 0 through 1.');
        }
      });
    }
  });
  if (totalColors > LIMITS.colors) {
    issue(issues, 'colorChannels', 'MAKER_V8_COLOR_LIMIT', `Maker v8 cannot exceed ${LIMITS.colors} Color swatches.`);
  }
  if (totalGradientStops > LIMITS.gradientStops) {
    issue(issues, 'colorChannels', 'MAKER_V8_GRADIENT_STOP_LIMIT', `Maker v8 cannot exceed ${LIMITS.gradientStops} Gradient stops.`);
  }

  if (!Array.isArray(document.parts)) {
    issue(issues, 'parts', 'MAKER_V8_PARTS_INVALID', 'Parts must be an array.');
  }
  if (Array.isArray(document.parts) && document.parts.length > LIMITS.parts) {
    issue(issues, 'parts', 'MAKER_V8_PART_LIMIT', `Parts cannot exceed ${LIMITS.parts} entries.`);
  }
  const partIds = validateUniqueIds(document.parts, 'parts', issues);
  validateContiguousOrder(
    (Array.isArray(document.parts) ? document.parts : [])
      .map((part) => ({ ...part, order: part?.menuOrder })),
    'parts',
    issues,
  );
  if (compile && partIds.size === 0) {
    issue(issues, 'parts', 'MAKER_V8_PART_REQUIRED', 'Published Maker v8 needs at least one Part.');
  }
  const known = {
    parts: partIds,
    items: new Map(),
    styles: new Map(),
    partRecords: new Map(),
    itemRecords: new Map(),
    styleRecords: new Map(),
  };
  let totalItems = 0;
  let totalStyles = 0;
  (Array.isArray(document.parts) ? document.parts : []).forEach((part, partIndex) => {
    const partPath = `parts[${partIndex}]`;
    known.partRecords.set(String(part?.id || ''), part);
    validateName(part?.name, `${partPath}.name`, issues);
    if (typeof part?.required !== 'boolean' || typeof part?.menuVisible !== 'boolean') {
      issue(issues, partPath, 'MAKER_V8_PART_STATE_INVALID', 'Part required and menuVisible states must be explicit booleans.');
    }
    if (!WARDROBE_MODES.has(part?.wardrobeMode)) {
      issue(issues, `${partPath}.wardrobeMode`, 'MAKER_V8_WARDROBE_MODE_INVALID', 'Part wardrobe mode must be FIXED or SLOT.');
    }
    if (part?.parentPartId !== null
      && part?.parentPartId !== undefined
      && typeof part.parentPartId !== 'string') {
      issue(issues, `${partPath}.parentPartId`, 'MAKER_V8_PARENT_PART_INVALID', 'Parent Part must be null or a Part ID.');
    }
    if (part?.iconAssetId !== null
      && part?.iconAssetId !== undefined
      && !assetIds.has(String(part.iconAssetId))) {
      issue(issues, `${partPath}.iconAssetId`, 'MAKER_V8_PART_ICON_UNKNOWN', 'Part icon references an unknown Asset.');
    }
    if (!Array.isArray(part?.items) || (compile && part.items.length === 0)) {
      issue(issues, `${partPath}.items`, 'MAKER_V8_PART_ITEMS_INVALID', 'Published Parts need at least one Item.');
      return;
    }
    totalItems += part.items.length;
    if (part.items.length > LIMITS.itemsPerPart) {
      issue(issues, `${partPath}.items`, 'MAKER_V8_ITEMS_PER_PART_LIMIT', `Part cannot exceed ${LIMITS.itemsPerPart} Items.`);
    }
    const itemIds = validateUniqueIds(part.items, `${partPath}.items`, issues);
    known.items.set(String(part.id || ''), itemIds);
    validateContiguousOrder(
      part.items.map((item) => ({ ...item, order: item?.displayOrder })),
      `${partPath}.items`,
      issues,
    );
    part.items.forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      known.itemRecords.set(`${part.id}:${item.id}`, item);
      validateName(item?.name, `${itemPath}.name`, issues);
      if (item?.importKey !== undefined) validateId(item.importKey, `${itemPath}.importKey`, issues);
      if (item?.thumbnailAssetId !== null
        && item?.thumbnailAssetId !== undefined
        && !assetIds.has(String(item.thumbnailAssetId))) {
        issue(issues, `${itemPath}.thumbnailAssetId`, 'MAKER_V8_ITEM_THUMBNAIL_UNKNOWN', 'Item thumbnail references an unknown Asset.');
      }
      if (!ITEM_STATUSES.has(item?.status)) {
        issue(issues, `${itemPath}.status`, 'MAKER_V8_ITEM_STATUS_INVALID', 'Item status must be draft, private, or public.');
      }
      if (!Array.isArray(item?.styles) || (compile && item.styles.length === 0)) {
        issue(issues, `${itemPath}.styles`, 'MAKER_V8_ITEM_STYLES_INVALID', 'Published Items need at least one Style.');
        return;
      }
      totalStyles += item.styles.length;
      if (item.styles.length > LIMITS.stylesPerItem) {
        issue(issues, `${itemPath}.styles`, 'MAKER_V8_STYLES_PER_ITEM_LIMIT', `Item cannot exceed ${LIMITS.stylesPerItem} Styles.`);
      }
      const styleIds = validateUniqueIds(item.styles, `${itemPath}.styles`, issues);
      known.styles.set(`${part.id}:${item.id}`, styleIds);
      validateContiguousOrder(
        item.styles.map((style) => ({ ...style, order: style?.displayOrder })),
        `${itemPath}.styles`,
        issues,
      );
      item.styles.forEach((style, styleIndex) => {
        const stylePath = `${itemPath}.styles[${styleIndex}]`;
        known.styleRecords.set(`${part.id}:${item.id}:${style.id}`, style);
        validateName(style?.name, `${stylePath}.name`, issues);
        if (!trackIds.has(String(style?.layerTrackId || ''))) {
          issue(issues, `${stylePath}.layerTrackId`, 'MAKER_V8_STYLE_TRACK_UNKNOWN', 'Style must reference a known Layer Track.');
        }
        if (style?.colorChannelId && !colorIds.has(String(style.colorChannelId))) {
          issue(issues, `${stylePath}.colorChannelId`, 'MAKER_V8_STYLE_COLOR_UNKNOWN', 'Style references an unknown color channel.');
        }
        const styleAssetId = String(style?.assetId || '');
        if (style?.assetId !== null
          && style?.assetId !== undefined
          && style?.assetId !== ''
          && !assetIds.has(styleAssetId)) {
          issue(issues, `${stylePath}.assetId`, 'MAKER_V8_STYLE_ASSET_UNKNOWN', 'Style references an unknown Asset.');
        }
        if (compile && (!assetIds.has(styleAssetId)
          || String(assets.get(styleAssetId)?.mediaType || '').toLowerCase() !== 'image/png')) {
          issue(issues, `${stylePath}.assetId`, 'MAKER_V8_STYLE_ASSET_INVALID', 'Published Style must reference exactly one PNG Asset.');
        }
        const transform = style?.transform;
        if (!isRecord(transform)
          || !['x', 'y', 'scale', 'rotation'].every((field) => Number.isFinite(transform[field]))
          || transform.scale <= 0
          || transform.scale > 100) {
          issue(issues, `${stylePath}.transform`, 'MAKER_V8_STYLE_TRANSFORM_INVALID', 'Style transform needs finite x/y/rotation and a scale from 0 through 100.');
        }
        for (const field of ['positionConfirmed', 'positionLocked', 'styleLocked']) {
          if (typeof style?.[field] !== 'boolean') {
            issue(issues, `${stylePath}.${field}`, 'MAKER_V8_STYLE_STATE_INVALID', 'Style editing states must be explicit booleans.');
          }
        }
        if (typeof style?.opacity !== 'number' || style.opacity < 0 || style.opacity > 1) {
          issue(issues, `${stylePath}.opacity`, 'MAKER_V8_STYLE_OPACITY_INVALID', 'Style opacity must be from 0 through 1.');
        }
        if (!BLEND_MODES.has(style?.blendMode)) {
          issue(issues, `${stylePath}.blendMode`, 'MAKER_V8_STYLE_BLEND_INVALID', 'Style blend mode is unsupported.');
        }
        if (!isRecord(style?.seal) || typeof style.seal.protected !== 'boolean') {
          issue(issues, `${stylePath}.seal`, 'MAKER_V8_STYLE_SEAL_INVALID', 'Style Seal authoring declares exactly one protected boolean.');
        }
        if (!isRecord(style?.physical) || typeof style.physical.enabled !== 'boolean') {
          issue(issues, `${stylePath}.physical`, 'MAKER_V8_STYLE_PHYSICAL_INVALID', 'Style Physical authoring declares exactly one enabled boolean.');
        }
      });
      if (!styleIds.has(String(item?.defaultStyleId || ''))) {
        issue(issues, `${itemPath}.defaultStyleId`, 'MAKER_V8_DEFAULT_STYLE_INVALID', 'Item defaultStyleId must reference one of its Styles.');
      }
    });
    if (part?.defaultItemId !== null
      && part?.defaultItemId !== undefined
      && !itemIds.has(String(part.defaultItemId))) {
      issue(issues, `${partPath}.defaultItemId`, 'MAKER_V8_DEFAULT_ITEM_INVALID', 'Part defaultItemId must reference one of its Items.');
    }
    if (compile && part?.required && !part?.defaultItemId) {
      issue(issues, `${partPath}.defaultItemId`, 'MAKER_V8_DEFAULT_ITEM_REQUIRED', 'Required published Part needs a default Item.');
    }
  });
  if (totalItems > LIMITS.items) {
    issue(issues, 'parts', 'MAKER_V8_ITEM_LIMIT', `Maker v8 cannot exceed ${LIMITS.items} Items.`);
  }
  if (totalStyles > LIMITS.styles) {
    issue(issues, 'parts', 'MAKER_V8_STYLE_LIMIT', `Maker v8 cannot exceed ${LIMITS.styles} Styles.`);
  }
  if (compile && !(Array.isArray(document.parts) ? document.parts : []).some((part) => part?.menuVisible === true)) {
    issue(issues, 'parts', 'MAKER_V8_PLAYER_PART_REQUIRED', 'Published Maker v8 needs at least one Player-visible Part.');
  }

  const parts = Array.isArray(document.parts) ? document.parts : [];
  parts.forEach((part, index) => {
    const parentId = part?.parentPartId;
    if (!parentId) return;
    if (!known.partRecords.has(parentId)) {
      issue(issues, `parts[${index}].parentPartId`, 'MAKER_V8_PARENT_PART_UNKNOWN', 'Parent Part does not exist.');
    } else if (parentId === part.id) {
      issue(issues, `parts[${index}].parentPartId`, 'MAKER_V8_PARENT_PART_SELF', 'Part cannot be its own parent.');
    }
  });
  parts.forEach((part, index) => {
    const visited = new Set();
    let cursor = part;
    while (cursor?.parentPartId && known.partRecords.has(cursor.parentPartId)) {
      if (visited.has(cursor.id)) {
        issue(issues, `parts[${index}].parentPartId`, 'MAKER_V8_PARENT_PART_CYCLE', 'Part hierarchy contains a cycle.');
        break;
      }
      visited.add(cursor.id);
      cursor = known.partRecords.get(cursor.parentPartId);
    }
  });

  const ruleBudget = createRuleBudget();
  parts.forEach((part, partIndex) => {
    const partPath = `parts[${partIndex}]`;
    validateEmbeddedRules(part, partPath, known, issues, ruleBudget);
    (Array.isArray(part?.items) ? part.items : []).forEach((item, itemIndex) => {
      const itemPath = `${partPath}.items[${itemIndex}]`;
      validateEmbeddedRules(item, itemPath, known, issues, ruleBudget);
      (Array.isArray(item?.styles) ? item.styles : []).forEach((style, styleIndex) => {
        validateEmbeddedRules(
          style,
          `${itemPath}.styles[${styleIndex}]`,
          known,
          issues,
          ruleBudget,
        );
      });
    });
  });
  if (Array.from(known.items.values()).some((ids) => ids.size) && document.capabilities?.composition !== true) {
    issue(issues, 'capabilities.composition', 'MAKER_V8_COMPOSITION_CAPABILITY_REQUIRED', 'Parts and Items require the v8 Composition capability.');
  }
  validateRules(document.rules, known, 'rules', issues, ruleBudget);

  collectMakerV8CommerceIssues(document.commerce, {
    publish: compile,
  }).forEach((entry) => issues.push(entry));

  const channels = new Map((Array.isArray(document.colorChannels) ? document.colorChannels : [])
    .map((channel) => [String(channel?.id || ''), channel]));
  validateDefaultRecipe(document, known, channels, compile, issues);
  validateCompleteDefinitions(document, compile, issues);
  if (compile && issues.length === 0) validateExecutableRuleGraph(document, issues);
  return Object.freeze(issues);
}

export function collectMakerV8DocumentIssues(document, options = {}) {
  try {
    const optionIssues = [];
    const optionSnapshot = snapshotAuthorJsonTree(options, optionIssues);
    if (!isRecord(optionSnapshot)) {
      if (optionIssues.length === 0) {
        issue(
          optionIssues,
          'options',
          'MAKER_V8_VALIDATION_OPTIONS_INVALID',
          'Maker v8 validation options must be a plain JSON object.',
        );
      }
      return Object.freeze(optionIssues);
    }
    const unknownOptions = Object.keys(optionSnapshot).filter((key) => key !== 'mode');
    unknownOptions.forEach((key) => issue(
      optionIssues,
      `options.${key}`,
      'MAKER_V8_VALIDATION_OPTION_UNKNOWN',
      'Unknown Maker v8 validation options are forbidden.',
    ));
    if (optionIssues.length) return Object.freeze(optionIssues);
    return collectMakerV8DocumentIssuesUnsafe(document, optionSnapshot);
  } catch {
    return Object.freeze([
      Object.freeze({
        path: '',
        code: 'MAKER_V8_AUTHOR_JSON_INSPECTION_FAILED',
        message: 'Maker v8 author JSON could not be inspected safely.',
      }),
    ]);
  }
}

export class MakerV8DocumentValidationError extends Error {
  constructor(issues) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join('\n'));
    this.name = 'MakerV8DocumentValidationError';
    this.code = issues[0]?.code || 'MAKER_V8_DOCUMENT_INVALID';
    this.issues = Object.freeze([...issues]);
  }
}

export function assertMakerV8Document(document, options) {
  const issues = collectMakerV8DocumentIssues(document, options);
  if (issues.length) throw new MakerV8DocumentValidationError(issues);
  return document;
}
