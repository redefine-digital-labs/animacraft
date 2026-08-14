import { bcs } from '@mysten/sui/bcs';

import {
  assertMakerV8Document,
} from './maker-v8-document.js';

/**
 * Exact off-chain parity for the immutable Maker v8 publication ABI.
 *
 * The exported empty/advance/serialize functions intentionally mirror Move's
 * pure helpers and accept already-resolved preimage fields; they are useful
 * for fixtures and parity checks, but are not a certification boundary. The
 * publication entry point below only consumes a validated Maker document and
 * currently fails closed. The bounded Root compiler is the one implemented
 * compiler stage: it derives every content/payload hash and certified Style
 * asset field instead of accepting caller-provided commitment values.
 */

export const MAKER_V8_COMPILER_SCHEMA = 'animacraft.maker-v8-compiler.v1';
export const MAKER_V8_COMMITMENT_FIXTURE_SCHEMA =
  'animacraft.maker-v8-commitment-fixture.v1';

export const MAKER_V8_ROOT_CATEGORIES = Object.freeze({
  TRACK: 0,
  PART: 1,
  ITEM: 2,
  STYLE: 3,
  COLOR: 4,
  RULE: 5,
  AGGREGATE: 255,
});

export const MAKER_V8_CAPABILITY_BITS = Object.freeze({
  composition: 1n,
  expansionPacks: 2n,
  complete: 4n,
  seal: 8n,
  physical: 16n,
  canonicalSoul: 32n,
  market: 64n,
});

export const MAKER_V8_REQUIRED_CAPABILITIES = 127n;

export const MAKER_V8_COMPOSITION_BEHAVIORS = Object.freeze({
  FIXED: 0,
  SOUL_LOCAL: 1,
  OPEN: 2,
  HYBRID: 3,
});

export const MAKER_V8_COMPOSITION_SOURCES = Object.freeze({
  OFFICIAL: 0,
  CERTIFIED: 1,
  OPEN: 2,
});

export const MAKER_V8_COMPOSITION_RULE_KINDS = Object.freeze({
  REQUIRE: 0,
  EXCLUDE: 1,
});

export const MAKER_V8_PACK_ACCESS_KINDS = Object.freeze({
  FREE: 0,
  PAID: 1,
  INCLUDED_WITH_MAKER: 2,
});

export const MAKER_V8_SEAL_SCOPE_KINDS = Object.freeze({
  MAKER_STYLE: 0,
  PACK_STYLE: 1,
  COMPLETE: 2,
});

export const MAKER_V8_PHYSICAL_SOURCE_KINDS = Object.freeze({
  MAKER_STYLE: 0,
  PACK_STYLE: 1,
});

const VERSION = 8n;
const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = (1n << 32n) - 1n;
const U16_MAX = (1n << 16n) - 1n;
const TEXT_ENCODER = new TextEncoder();
const HEX_32 = /^(?:0x)?[0-9a-fA-F]{64}$/;
const SUI_ID = /^0x[0-9a-fA-F]{64}$/;
const MAX_COMPILER_INPUT_DEPTH = 64;
const MAX_COMPILER_INPUT_NODES = 100_000;

const ByteVector = bcs.byteVector();
const OptionByteVector = bcs.option(ByteVector);
const OptionString = bcs.option(bcs.string());
const OptionId = bcs.option(bcs.Address);

const RollingCommitmentInputV8Bcs = bcs.struct('RollingCommitmentInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  category: bcs.u8(),
  previous: ByteVector,
  sequence: bcs.u64(),
  row_bytes: ByteVector,
});

const VersionCommitmentInputV8Bcs = bcs.struct('VersionCommitmentInputV8', {
  version: bcs.u64(),
  package_id: bcs.Address,
  maker_key: bcs.string(),
  maker_version: bcs.string(),
  previous_root_id: OptionId,
  previous_version_commitment: OptionByteVector,
  renderer_commitment: ByteVector,
  manifest_blob_id: bcs.string(),
  manifest_sha256: ByteVector,
  content_commitment: ByteVector,
});

const EconomicsCommitmentInputV8Bcs = bcs.struct('EconomicsCommitmentInputV8', {
  maker_access: bcs.u8(),
  maker_price_atomic: bcs.u64(),
  complete_mode: bcs.u8(),
  complete_price_atomic: bcs.u64(),
  complete_per_wallet_quota: bcs.u64(),
  complete_total_cap: bcs.u64(),
  protocol_fee_bps: bcs.u16(),
});

const RightsCommitmentInputV8Bcs = bcs.struct('RightsCommitmentInputV8', {
  origin: bcs.u8(),
  creator_confirmed: bcs.bool(),
  soul_creator_royalty_bps: bcs.u16(),
  maker_source_royalty_bps: bcs.u16(),
  maker_resale_royalty_bps: bcs.u16(),
});

const RowCountsV8Bcs = bcs.struct('RowCountsV8', {
  tracks: bcs.u64(),
  parts: bcs.u64(),
  items: bcs.u64(),
  styles: bcs.u64(),
  colors: bcs.u64(),
  rules: bcs.u64(),
  slots: bcs.u64(),
  pack_releases: bcs.u64(),
  protected_assets: bcs.u64(),
});

const RegistryCommitmentsV8Bcs = bcs.struct('RegistryCommitmentsV8', {
  tracks: ByteVector,
  parts: ByteVector,
  items: ByteVector,
  styles: ByteVector,
  colors: ByteVector,
  rules: ByteVector,
  aggregate: ByteVector,
});

const CapabilityCommitmentsV8Bcs = bcs.struct('CapabilityCommitmentsV8', {
  composition: ByteVector,
  pack: ByteVector,
  complete: ByteVector,
  seal: ByteVector,
  soul: ByteVector,
  physical: OptionByteVector,
});

const EconomicsV8Bcs = bcs.struct('EconomicsV8', {
  maker_access: bcs.u8(),
  maker_price_atomic: bcs.u64(),
  complete_mode: bcs.u8(),
  complete_price_atomic: bcs.u64(),
  complete_per_wallet_quota: bcs.u64(),
  complete_total_cap: bcs.u64(),
  protocol_fee_bps: bcs.u16(),
  commitment: ByteVector,
});

const RightsV8Bcs = bcs.struct('RightsV8', {
  origin: bcs.u8(),
  creator_confirmed: bcs.bool(),
  soul_creator_royalty_bps: bcs.u16(),
  maker_source_royalty_bps: bcs.u16(),
  maker_resale_royalty_bps: bcs.u16(),
  commitment: ByteVector,
});

const TrackRowV8Bcs = bcs.struct('TrackRowV8', {
  sequence: bcs.u64(),
  key: bcs.string(),
  label: bcs.string(),
  render_order: bcs.u64(),
  payload_commitment: ByteVector,
});

const PartRowV8Bcs = bcs.struct('PartRowV8', {
  sequence: bcs.u64(),
  key: bcs.string(),
  label: bcs.string(),
  kind: bcs.u8(),
  render_order: bcs.u64(),
  required: bcs.bool(),
  visible: bcs.bool(),
  payload_commitment: ByteVector,
});

const ItemRowV8Bcs = bcs.struct('ItemRowV8', {
  sequence: bcs.u64(),
  part_key: bcs.string(),
  item_key: bcs.string(),
  label: bcs.string(),
  gate_kind: bcs.u8(),
  payload_commitment: ByteVector,
});

const StyleRowV8Bcs = bcs.struct('StyleRowV8', {
  sequence: bcs.u64(),
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  layer_track_key: bcs.string(),
  color_channel_key: OptionString,
  default_swatch_key: OptionString,
  label: bcs.string(),
  asset_blob_id: bcs.string(),
  asset_sha256: ByteVector,
  protected: bcs.bool(),
  payload_commitment: ByteVector,
});

const ColorRowV8Bcs = bcs.struct('ColorRowV8', {
  sequence: bcs.u64(),
  channel_key: bcs.string(),
  swatch_key: bcs.string(),
  label: bcs.string(),
  rgba: bcs.u32(),
  payload_commitment: ByteVector,
});

const RuleRowV8Bcs = bcs.struct('RuleRowV8', {
  sequence: bcs.u64(),
  key: bcs.string(),
  kind: bcs.u8(),
  left_ref: bcs.string(),
  right_ref: bcs.string(),
  payload_commitment: ByteVector,
});

const CompositionEmptyHashInputV8Bcs = bcs.struct('CompositionEmptyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
});

const CompositionSlotHashInputV8Bcs = bcs.struct('CompositionSlotHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  slot_key: bcs.string(),
  behavior: bcs.u8(),
  capacity: bcs.u64(),
  required: bcs.bool(),
  slot_commitment: ByteVector,
});

const CompositionItemHashInputV8Bcs = bcs.struct('CompositionItemHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  slot_key: bcs.string(),
  item_key: bcs.string(),
  source_kind: bcs.u8(),
  transferable: bcs.bool(),
  definition_commitment: ByteVector,
  asset_commitment: ByteVector,
});

const CompositionRuleHashInputV8Bcs = bcs.struct('CompositionRuleHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  rule_kind: bcs.u8(),
  left_slot_key: bcs.string(),
  left_item_key: bcs.string(),
  right_slot_key: bcs.string(),
  right_item_key: bcs.string(),
  rule_commitment: ByteVector,
});

const SealEmptyHashInputV8Bcs = bcs.struct('SealEmptyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
});

const SealIdInputV8Bcs = bcs.struct('SealIdInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  scope_kind: bcs.u8(),
  scope_key: bcs.string(),
  scope_commitment: ByteVector,
  asset_key: bcs.string(),
  asset_commitment: ByteVector,
});

const SealRowHashInputV8Bcs = bcs.struct('SealRowHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  scope_kind: bcs.u8(),
  scope_key: bcs.string(),
  scope_commitment: ByteVector,
  asset_key: bcs.string(),
  asset_commitment: ByteVector,
  seal_id: ByteVector,
});

const PackRegistryEmptyHashInputV8Bcs = bcs.struct('PackRegistryEmptyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
});

const PackStyleEmptyHashInputV8Bcs = bcs.struct('PackStyleEmptyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  namespace: bcs.string(),
  pack_key: bcs.string(),
  manifest_commitment: ByteVector,
  release_content_commitment: ByteVector,
});

const PackStyleHashInputV8Bcs = bcs.struct('PackStyleHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  namespace: bcs.string(),
  pack_key: bcs.string(),
  manifest_commitment: ByteVector,
  release_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  asset_blob_id: bcs.string(),
  asset_commitment: ByteVector,
  protected: bcs.bool(),
  seal_id: ByteVector,
});

const PackRegistryRowHashInputV8Bcs = bcs.struct('PackRegistryRowHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  namespace: bcs.string(),
  pack_key: bcs.string(),
  manifest_commitment: ByteVector,
  release_content_commitment: ByteVector,
  style_registry_commitment: ByteVector,
  access_kind: bcs.u8(),
  purchase_price_atomic: bcs.u64(),
  complete_mode: bcs.u8(),
  complete_price_atomic: bcs.u64(),
  complete_free_quota_per_wallet: bcs.u64(),
  complete_total_cap: bcs.u64(),
  protected_style_count: bcs.u64(),
  seal_registry_commitment: ByteVector,
});

const CompleteEmptyHashInputV8Bcs = bcs.struct('CompleteEmptyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
});

const CompleteOutputHashInputV8Bcs = bcs.struct('CompleteOutputHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  output_key: bcs.string(),
  recipe_policy_commitment: ByteVector,
  renderer_schema_commitment: ByteVector,
  protected: bcs.bool(),
  seal_id: ByteVector,
  required_pack_selection_count: bcs.u64(),
  required_pack_selection_commitment: ByteVector,
});

const CompletePackPolicyHashInputV8Bcs = bcs.struct('CompletePackPolicyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  pack_scope_key: bcs.string(),
  release_content_commitment: ByteVector,
  mode: bcs.u8(),
  price_atomic: bcs.u64(),
  free_quota_per_wallet: bcs.u64(),
  total_cap: bcs.u64(),
});

const StablePackSelectionEmptyHashInputV8Bcs = bcs.struct(
  'StablePackSelectionEmptyHashInputV8',
  {
    domain: ByteVector,
    version: bcs.u64(),
    root_content_commitment: ByteVector,
  },
);

const StablePackSelectionHashInputV8Bcs = bcs.struct('StablePackSelectionHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  pack_scope_key: bcs.string(),
  release_content_commitment: ByteVector,
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  asset_commitment: ByteVector,
  protected: bcs.bool(),
  seal_id: ByteVector,
});

const PhysicalEmptyHashInputV8Bcs = bcs.struct('PhysicalEmptyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
});

const PhysicalPolicyHashInputV8Bcs = bcs.struct('PhysicalPolicyHashInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
  sequence: bcs.u64(),
  prior_commitment: ByteVector,
  source_kind: bcs.u8(),
  scope_key: bcs.string(),
  scope_commitment: ByteVector,
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
  style_content_commitment: ByteVector,
  material_commitment: ByteVector,
  max_supply: bcs.u64(),
  transferable: bcs.bool(),
});

const SoulRegistryCommitmentInputV8Bcs = bcs.struct('SoulRegistryCommitmentInputV8', {
  domain: ByteVector,
  version: bcs.u64(),
  root_content_commitment: ByteVector,
});

const ROOT_ROW_BCS = Object.freeze({
  track: TrackRowV8Bcs,
  part: PartRowV8Bcs,
  item: ItemRowV8Bcs,
  style: StyleRowV8Bcs,
  color: ColorRowV8Bcs,
  rule: RuleRowV8Bcs,
});

const ROOT_CATEGORY_SPECS = Object.freeze([
  Object.freeze({ plural: 'tracks', kind: 'track', category: MAKER_V8_ROOT_CATEGORIES.TRACK }),
  Object.freeze({ plural: 'parts', kind: 'part', category: MAKER_V8_ROOT_CATEGORIES.PART }),
  Object.freeze({ plural: 'items', kind: 'item', category: MAKER_V8_ROOT_CATEGORIES.ITEM }),
  Object.freeze({ plural: 'styles', kind: 'style', category: MAKER_V8_ROOT_CATEGORIES.STYLE }),
  Object.freeze({ plural: 'colors', kind: 'color', category: MAKER_V8_ROOT_CATEGORIES.COLOR }),
  Object.freeze({ plural: 'rules', kind: 'rule', category: MAKER_V8_ROOT_CATEGORIES.RULE }),
]);

const ROOT_ROW_SOURCE_FIELDS = Object.freeze({
  track: Object.freeze(['key', 'label', 'renderOrder', 'payloadProjection']),
  part: Object.freeze([
    'key', 'label', 'kind', 'renderOrder', 'required', 'visible', 'payloadProjection',
  ]),
  item: Object.freeze(['partKey', 'itemKey', 'label', 'gateKind', 'payloadProjection']),
  style: Object.freeze([
    'partKey', 'itemKey', 'styleKey', 'layerTrackKey', 'colorChannelKey',
    'defaultSwatchKey', 'label', 'protected', 'assetCertification', 'payloadProjection',
  ]),
  color: Object.freeze(['channelKey', 'swatchKey', 'label', 'rgba', 'payloadProjection']),
  rule: Object.freeze(['key', 'kind', 'leftRef', 'rightRef', 'payloadProjection']),
});

const ROW_COUNT_LIMITS = Object.freeze({
  tracks: Object.freeze({ minimum: 1n, maximum: 256n }),
  parts: Object.freeze({ minimum: 1n, maximum: 750n }),
  items: Object.freeze({ minimum: 1n, maximum: 5_000n }),
  styles: Object.freeze({ minimum: 1n, maximum: 10_000n }),
  colors: Object.freeze({ minimum: 0n, maximum: 5_000n }),
  rules: Object.freeze({ minimum: 0n, maximum: 1_000n }),
  slots: Object.freeze({ minimum: 0n, maximum: 1_000n }),
  packReleases: Object.freeze({ minimum: 0n, maximum: 1_000n }),
  protectedAssets: Object.freeze({ minimum: 0n, maximum: 10_000n }),
});

export class MakerV8CompilerError extends Error {
  constructor(message, code = 'MAKER_V8_COMPILER_INVALID', details = {}) {
    super(message);
    this.name = 'MakerV8CompilerError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new MakerV8CompilerError(message, code, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function inspectCompilerDataTree(root, rootPath) {
  const stack = [{ value: root, path: rootPath, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_COMPILER_INPUT_NODES || current.depth > MAX_COMPILER_INPUT_DEPTH) {
      fail(
        'MAKER_V8_COMPILER_INPUT_LIMIT',
        `${rootPath} exceeds the bounded compiler input limit.`,
        { path: current.path },
      );
    }
    const value = current.value;
    if (value === null
      || typeof value === 'string'
      || typeof value === 'boolean'
      || typeof value === 'bigint') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        fail(
          'MAKER_V8_COMPILER_INPUT_SCALAR_INVALID',
          `${current.path} must be finite compiler data.`,
          { path: current.path },
        );
      }
      continue;
    }
    if (!value || typeof value !== 'object') {
      fail(
        'MAKER_V8_COMPILER_INPUT_SCALAR_INVALID',
        `${current.path} must be plain compiler data.`,
        { path: current.path },
      );
    }
    let binary;
    try {
      binary = ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
    } catch {
      fail(
        'MAKER_V8_COMPILER_INPUT_UNREADABLE',
        `${rootPath} could not be inspected safely.`,
        { path: current.path },
      );
    }
    if (binary) {
      fail(
        'MAKER_V8_CANONICAL_BINARY_UNSUPPORTED',
        `${current.path} must project binary data explicitly.`,
        { path: current.path },
      );
    }
    if (seen.has(value)) {
      fail(
        'MAKER_V8_COMPILER_INPUT_GRAPH_INVALID',
        `${rootPath} must be a tree without cycles or shared references.`,
        { path: current.path },
      );
    }
    seen.add(value);

    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      fail(
        'MAKER_V8_COMPILER_INPUT_UNREADABLE',
        `${rootPath} could not be inspected safely.`,
        { path: current.path },
      );
    }
    const array = Array.isArray(value);
    if ((array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)) {
      fail(
        'MAKER_V8_CANONICAL_OBJECT_UNSUPPORTED',
        `${current.path} must use a standard JSON object or array prototype.`,
        { path: current.path },
      );
    }
    if (keys.some((key) => typeof key !== 'string')) {
      fail(
        'MAKER_V8_COMPILER_INPUT_SYMBOL_INVALID',
        `${rootPath} cannot contain symbol keys.`,
        { path: current.path },
      );
    }
    if (array) {
      let lengthDescriptor;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      } catch {
        fail(
          'MAKER_V8_COMPILER_INPUT_UNREADABLE',
          `${current.path} array length could not be inspected safely.`,
          { path: current.path },
        );
      }
      const length = lengthDescriptor?.value;
      const allowed = new Set(['length']);
      if (Number.isSafeInteger(length) && length >= 0) {
        for (let index = 0; index < length; index += 1) allowed.add(String(index));
      }
      if (!Number.isSafeInteger(length)
        || length < 0
        || keys.length !== allowed.size
        || keys.some((key) => !allowed.has(key))) {
        fail(
          'MAKER_V8_COMPILER_INPUT_ARRAY_INVALID',
          `${current.path} must be a dense ordered array without extra properties.`,
          { path: current.path },
        );
      }
    }
    for (const key of keys) {
      if (array && key === 'length') continue;
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        fail(
          'MAKER_V8_COMPILER_INPUT_UNREADABLE',
          `${rootPath} property descriptors could not be inspected safely.`,
          { path: current.path },
        );
      }
      const childPath = array ? `${current.path}[${key}]` : `${current.path}.${key}`;
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        fail(
          'MAKER_V8_COMPILER_INPUT_DESCRIPTOR_INVALID',
          `${rootPath} accepts only enumerable data properties.`,
          { path: childPath },
        );
      }
      stack.push({ value: descriptor.value, path: childPath, depth: current.depth + 1 });
    }
  }
}

function snapshotCompilerData(root, path) {
  inspectCompilerDataTree(root, path);
  let snapshot;
  try {
    snapshot = structuredClone(root);
  } catch {
    fail(
      'MAKER_V8_COMPILER_INPUT_UNREADABLE',
      `${path} could not be snapshotted safely; Proxy and non-cloneable values are forbidden.`,
      { path },
    );
  }
  inspectCompilerDataTree(snapshot, path);
  return snapshot;
}

function canonicalValue(value, path = '$', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      fail(
        'MAKER_V8_CANONICAL_NUMBER_INVALID',
        `${path} must be a finite JSON number without integer precision loss.`,
        { path },
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    fail('MAKER_V8_CANONICAL_VALUE_UNSUPPORTED', `${path} is not canonical JSON data.`, { path });
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    fail('MAKER_V8_CANONICAL_BINARY_UNSUPPORTED', `${path} must project binary data explicitly.`, { path });
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    fail('MAKER_V8_CANONICAL_OBJECT_UNSUPPORTED', `${path} must be a plain JSON object.`, { path });
  }
  if (seen.has(value)) {
    fail('MAKER_V8_CANONICAL_CYCLE', `${path} contains a cyclic value.`, { path });
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`, seen));
  } else {
    result = Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalValue(value[key], `${path}.${key}`, seen),
    ]));
  }
  seen.delete(value);
  return result;
}

/**
 * Canonical JSON for compiler-owned semantic and payload projections.
 * Object keys are sorted, array order is preserved, strings are not Unicode
 * normalized, and BigInt values are emitted as base-10 strings.
 */
export function canonicalMakerV8Json(value) {
  return JSON.stringify(canonicalValue(snapshotCompilerData(value, '$')));
}

export function canonicalMakerV8Utf8(value) {
  return TEXT_ENCODER.encode(canonicalMakerV8Json(value));
}

function bytesFrom(value, label, expectedLength = null) {
  let bytes = null;
  if (value instanceof Uint8Array) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (Array.isArray(value)
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    bytes = Uint8Array.from(value);
  } else if (typeof value === 'string' && /^(?:0x)?(?:[0-9a-fA-F]{2})*$/.test(value)) {
    const hex = value.replace(/^0x/i, '');
    bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) => (
      Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    ));
  }
  if (!bytes || (expectedLength !== null && bytes.length !== expectedLength)) {
    fail(
      'MAKER_V8_BYTES_INVALID',
      `${label} must contain${expectedLength === null ? '' : ` exactly ${expectedLength}`} bytes.`,
      { label, expectedLength, actualLength: bytes?.length ?? null },
    );
  }
  return new Uint8Array(bytes);
}

function digestBytes(value, label) {
  return bytesFrom(value, label, 32);
}

function hexFromBytes(value) {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedDigest(value, label) {
  if (!HEX_32.test(String(value || ''))) {
    fail('MAKER_V8_DIGEST_INVALID', `${label} must be an exact 32-byte hexadecimal digest.`, { label });
  }
  return String(value).replace(/^0x/i, '').toLowerCase();
}

function normalizedId(value, label) {
  const text = String(value || '').toLowerCase();
  if (!SUI_ID.test(text)) {
    fail('MAKER_V8_ID_INVALID', `${label} must be a 32-byte 0x-prefixed Sui ID.`, { label });
  }
  return text;
}

function integer(value, label, maximum) {
  let result;
  if (typeof value === 'bigint') {
    result = value;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    result = BigInt(value);
  } else if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    result = BigInt(value);
  } else {
    fail('MAKER_V8_INTEGER_INVALID', `${label} must be a safe integer, bigint, or canonical decimal string.`, { label });
  }
  if (result < 0n || result > maximum) {
    fail('MAKER_V8_INTEGER_RANGE', `${label} is outside its unsigned integer range.`, {
      label,
      maximum: maximum.toString(),
      actual: result.toString(),
    });
  }
  return result;
}

function u64(value, label) {
  return integer(value, label, U64_MAX);
}

function u32(value, label) {
  return Number(integer(value, label, U32_MAX));
}

function u16(value, label) {
  return Number(integer(value, label, U16_MAX));
}

function u8(value, label) {
  return Number(integer(value, label, 255n));
}

function boolean(value, label) {
  if (typeof value !== 'boolean') {
    fail('MAKER_V8_BOOLEAN_INVALID', `${label} must be a boolean.`, { label });
  }
  return value;
}

function textValue(value, label, maximumBytes, { allowEmpty = false, rejectNul = false } = {}) {
  if (typeof value !== 'string') {
    fail('MAKER_V8_STRING_INVALID', `${label} must be a string.`, { label });
  }
  const length = TEXT_ENCODER.encode(value).length;
  if ((!allowEmpty && length === 0) || length > maximumBytes || (rejectNul && value.includes('\u0000'))) {
    fail('MAKER_V8_STRING_INVALID', `${label} has an invalid UTF-8 length or separator byte.`, {
      label,
      length,
      maximumBytes,
    });
  }
  return value;
}

function identifier(value, label) {
  return textValue(value, label, 128, { rejectNul: true });
}

function scopeKey(value, label) {
  // Stable Pack scope keys intentionally contain one NUL separator. Move's
  // assert_scope_key helpers bound the UTF-8 byte length but do not reject it.
  return textValue(value, label, 512);
}

function locator(value, label) {
  return textValue(value, label, 512);
}

function domain(value) {
  return TEXT_ENCODER.encode(value);
}

async function sha256(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    fail('MAKER_V8_SHA256_UNAVAILABLE', 'SHA-256 is unavailable in this runtime.');
  }
  return new Uint8Array(await subtle.digest('SHA-256', value));
}

export async function sha256MakerV8Bytes(value) {
  const bytes = bytesFrom(value, 'SHA-256 input');
  return hexFromBytes(await sha256(bytes));
}

async function serializeAndHash(type, value) {
  const bcsBytes = type.serialize(value).toBytes();
  const commitmentBytes = await sha256(bcsBytes);
  return {
    bcsBytes,
    bcsHex: hexFromBytes(bcsBytes),
    commitmentBytes,
    commitment: hexFromBytes(commitmentBytes),
  };
}

function serialized(type, value) {
  const bytes = type.serialize(value).toBytes();
  return Object.freeze({ bytes, hex: hexFromBytes(bytes) });
}

function hashResult(result) {
  return deepFreeze({
    bcsHex: result.bcsHex,
    commitment: result.commitment,
  });
}

function emptyCommitmentInput(rootContentCommitment, domainValue, type) {
  return serializeAndHash(type, {
    domain: domain(domainValue),
    version: VERSION,
    root_content_commitment: digestBytes(rootContentCommitment, 'Root content commitment'),
  });
}

function assertCompletePolicy(modeValue, priceValue, quotaValue, capValue) {
  const mode = u8(modeValue, 'Complete mode');
  const price = u64(priceValue, 'Complete price');
  const quota = u64(quotaValue, 'Complete free quota');
  const totalCap = u64(capValue, 'Complete total cap');
  const valid = (mode === 0 && price === 0n && quota === 0n)
    || (mode === 1 && price > 0n && quota > 0n)
    || (mode === 2 && price > 0n && quota === 0n)
    || (mode === 3 && price === 0n && quota > 0n);
  if (!valid || price > 1_000_000_000_000n || quota > 1_000_000_000n || totalCap > 1_000_000_000n) {
    fail('MAKER_V8_COMPLETE_POLICY_INVALID', 'Complete policy fields do not form a valid v8 policy.');
  }
  return { mode, price, quota, totalCap };
}

export function serializeMakerV8RootRow(kind, value) {
  const type = ROOT_ROW_BCS[kind];
  if (!type) {
    fail('MAKER_V8_ROOT_ROW_KIND_INVALID', `Unknown Maker v8 Root row kind "${kind}".`, { kind });
  }
  const normalized = normalizeRootRow(kind, value);
  const result = serialized(type, normalized);
  return deepFreeze({ kind, bcsHex: result.hex });
}

function normalizeRootRow(kind, value = {}) {
  const sequence = u64(value.sequence, `${kind}.sequence`);
  const payload = digestBytes(value.payloadCommitment, `${kind}.payloadCommitment`);
  if (kind === 'track') {
    return {
      sequence,
      key: identifier(value.key, 'Track key'),
      label: textValue(value.label, 'Track label', 256),
      render_order: u64(value.renderOrder, 'Track render order'),
      payload_commitment: payload,
    };
  }
  if (kind === 'part') {
    return {
      sequence,
      key: identifier(value.key, 'Part key'),
      label: textValue(value.label, 'Part label', 256),
      kind: u8(value.kind, 'Part kind'),
      render_order: u64(value.renderOrder, 'Part render order'),
      required: boolean(value.required, 'Part required'),
      visible: boolean(value.visible, 'Part visible'),
      payload_commitment: payload,
    };
  }
  if (kind === 'item') {
    return {
      sequence,
      part_key: identifier(value.partKey, 'Item Part key'),
      item_key: identifier(value.itemKey, 'Item key'),
      label: textValue(value.label, 'Item label', 256),
      gate_kind: u8(value.gateKind, 'Item gate kind'),
      payload_commitment: payload,
    };
  }
  if (kind === 'style') {
    const colorChannelKey = value.colorChannelKey === null ? null : identifier(
      value.colorChannelKey,
      'Style Color channel key',
    );
    const defaultSwatchKey = value.defaultSwatchKey === null ? null : identifier(
      value.defaultSwatchKey,
      'Style default swatch key',
    );
    if ((colorChannelKey === null) !== (defaultSwatchKey === null)) {
      fail('MAKER_V8_STYLE_COLOR_PAIR_INVALID', 'Style Color channel and default swatch must both be present or absent.');
    }
    return {
      sequence,
      part_key: identifier(value.partKey, 'Style Part key'),
      item_key: identifier(value.itemKey, 'Style Item key'),
      style_key: identifier(value.styleKey, 'Style key'),
      layer_track_key: identifier(value.layerTrackKey, 'Style Layer Track key'),
      color_channel_key: colorChannelKey,
      default_swatch_key: defaultSwatchKey,
      label: textValue(value.label, 'Style label', 256),
      asset_blob_id: locator(value.assetBlobId, 'Style asset Blob ID'),
      asset_sha256: digestBytes(value.assetSha256, 'Style asset SHA-256'),
      protected: boolean(value.protected, 'Style protected'),
      payload_commitment: payload,
    };
  }
  if (kind === 'color') {
    return {
      sequence,
      channel_key: identifier(value.channelKey, 'Color channel key'),
      swatch_key: identifier(value.swatchKey, 'Color swatch key'),
      label: textValue(value.label, 'Color label', 256),
      rgba: u32(value.rgba, 'Color RGBA'),
      payload_commitment: payload,
    };
  }
  return {
    sequence,
    key: identifier(value.key, 'Rule key'),
    kind: u8(value.kind, 'Rule kind'),
    left_ref: textValue(value.leftRef, 'Rule left reference', 512),
    right_ref: textValue(value.rightRef, 'Rule right reference', 512),
    payload_commitment: payload,
  };
}

async function canonicalProjectionCommitment(projection) {
  const json = canonicalMakerV8Json(projection);
  const bytes = TEXT_ENCODER.encode(json);
  const commitment = hexFromBytes(await sha256(bytes));
  return deepFreeze({ projection: canonicalValue(projection), json, utf8Hex: hexFromBytes(bytes), commitment });
}

export async function makerV8SemanticCommitment(projection) {
  return canonicalProjectionCommitment(projection);
}

export async function makerV8PayloadCommitment(projection) {
  return canonicalProjectionCommitment(projection);
}

export async function emptyMakerV8CategoryCommitment(rootContentCommitment, category) {
  const exactCategory = u8(category, 'Root category');
  if (!Object.values(MAKER_V8_ROOT_CATEGORIES).includes(exactCategory)) {
    fail('MAKER_V8_ROOT_CATEGORY_INVALID', 'Root category is not defined by Maker v8.', { category });
  }
  return hashResult(await serializeAndHash(RollingCommitmentInputV8Bcs, {
    domain: domain('animacraft-v8/empty-registry'),
    version: VERSION,
    root_content_commitment: digestBytes(rootContentCommitment, 'Root content commitment'),
    category: exactCategory,
    previous: new Uint8Array(),
    sequence: 0n,
    row_bytes: new Uint8Array(),
  }));
}

export async function advanceMakerV8CategoryCommitment({
  rootContentCommitment,
  category,
  previousCommitment,
  sequence,
  rowBytes,
} = {}) {
  const exactCategory = u8(category, 'Root category');
  if (!Object.values(MAKER_V8_ROOT_CATEGORIES).includes(exactCategory)) {
    fail('MAKER_V8_ROOT_CATEGORY_INVALID', 'Root category is not defined by Maker v8.', { category });
  }
  const exactRowBytes = bytesFrom(rowBytes, 'Root row BCS bytes');
  if (exactRowBytes.length === 0) {
    fail('MAKER_V8_ROOT_ROW_EMPTY', 'Root row BCS bytes cannot be empty.');
  }
  return hashResult(await serializeAndHash(RollingCommitmentInputV8Bcs, {
    domain: domain('animacraft-v8/append-row'),
    version: VERSION,
    root_content_commitment: digestBytes(rootContentCommitment, 'Root content commitment'),
    category: exactCategory,
    previous: digestBytes(previousCommitment, 'Previous Root category commitment'),
    sequence: u64(sequence, 'Root sequence'),
    row_bytes: exactRowBytes,
  }));
}

/**
 * Compiles the six ordered Root registries and the aggregate registry from
 * compiler-owned JSON projections. The content and payload commitments,
 * global sequences, Style asset Blob IDs, and Style asset SHA-256 values are
 * all derived here; supplying any of those computed row fields is rejected.
 */
export async function compileMakerV8RootCommitments({
  semanticProjection,
  tracks = [],
  parts = [],
  items = [],
  styles = [],
  colors = [],
  rules = [],
  ...unknown
} = {}) {
  if (Object.keys(unknown).length) {
    fail(
      'MAKER_V8_ROOT_INPUT_UNKNOWN',
      `Unknown Root compiler field${Object.keys(unknown).length === 1 ? '' : 's'}: ${Object.keys(unknown).join(', ')}.`,
      { fields: Object.keys(unknown) },
    );
  }

  const sourceByPlural = { tracks, parts, items, styles, colors, rules };
  for (const spec of ROOT_CATEGORY_SPECS) {
    if (!Array.isArray(sourceByPlural[spec.plural])) {
      fail('MAKER_V8_ROOT_ROWS_INVALID', `${spec.plural} must be an ordered array.`, {
        category: spec.plural,
      });
    }
  }
  normalizeMakerV8RowCounts({
    tracks: tracks.length,
    parts: parts.length,
    items: items.length,
    styles: styles.length,
    colors: colors.length,
    rules: rules.length,
    slots: 0,
    packReleases: 0,
    protectedAssets: styles.filter((style) => style?.protected === true).length,
  });

  const semantic = await makerV8SemanticCommitment(semanticProjection);
  const rootContentCommitment = semantic.commitment;
  const categoryCommitments = {};
  const initialCategoryCommitments = {};
  for (const spec of ROOT_CATEGORY_SPECS) {
    const initial = await emptyMakerV8CategoryCommitment(rootContentCommitment, spec.category);
    categoryCommitments[spec.plural] = initial.commitment;
    initialCategoryCommitments[spec.plural] = initial.commitment;
  }
  const initialAggregate = await emptyMakerV8CategoryCommitment(
    rootContentCommitment,
    MAKER_V8_ROOT_CATEGORIES.AGGREGATE,
  );
  let aggregateCommitment = initialAggregate.commitment;
  let sequence = 0n;
  const compiledRows = [];

  for (const spec of ROOT_CATEGORY_SPECS) {
    for (const [index, source] of sourceByPlural[spec.plural].entries()) {
      if (!isPlainObject(source)) {
        fail('MAKER_V8_ROOT_ROW_INVALID', `${spec.kind} row ${index} must be a plain object.`, {
          kind: spec.kind,
          index,
        });
      }
      if (!Object.hasOwn(source, 'payloadProjection')) {
        fail(
          'MAKER_V8_PAYLOAD_PROJECTION_REQUIRED',
          `${spec.kind} row ${index} needs its exact payload projection.`,
          { kind: spec.kind, index },
        );
      }
      const forbidden = ['sequence', 'payloadCommitment', 'rootContentCommitment']
        .filter((field) => Object.hasOwn(source, field));
      if (spec.kind === 'style') {
        for (const field of ['assetBlobId', 'assetSha256']) {
          if (Object.hasOwn(source, field)) forbidden.push(field);
        }
      }
      if (forbidden.length) {
        fail(
          'MAKER_V8_CALLER_COMMITMENT_FORBIDDEN',
          `${spec.kind} row ${index} supplies compiler-owned fields.`,
          { kind: spec.kind, index, fields: forbidden },
        );
      }
      const supported = new Set(ROOT_ROW_SOURCE_FIELDS[spec.kind]);
      const unsupported = Object.keys(source).filter((field) => !supported.has(field));
      if (unsupported.length) {
        fail(
          'MAKER_V8_ROOT_ROW_FIELDS_UNKNOWN',
          `${spec.kind} row ${index} has fields the compiler does not project.`,
          { kind: spec.kind, index, fields: unsupported },
        );
      }

      const payload = await makerV8PayloadCommitment(source.payloadProjection);
      const call = { ...source, sequence, payloadCommitment: payload.commitment };
      delete call.payloadProjection;
      if (spec.kind === 'style') {
        if (!Object.hasOwn(source, 'assetCertification')) {
          fail(
            'MAKER_V8_ASSET_CERTIFICATION_REQUIRED',
            `style row ${index} needs exact certified asset bytes.`,
            { kind: spec.kind, index },
          );
        }
        const certification = await verifyMakerV8Certification(source.assetCertification, {
          label: `Style asset ${source.partKey || '?'}\u0000${source.itemKey || '?'}\u0000${source.styleKey || '?'}`,
        });
        call.assetBlobId = certification.blobId;
        call.assetSha256 = certification.sha256;
        delete call.assetCertification;
      }

      const row = serializeMakerV8RootRow(spec.kind, call);
      const category = await advanceMakerV8CategoryCommitment({
        rootContentCommitment,
        category: spec.category,
        previousCommitment: categoryCommitments[spec.plural],
        sequence,
        rowBytes: row.bcsHex,
      });
      const aggregate = await advanceMakerV8CategoryCommitment({
        rootContentCommitment,
        category: MAKER_V8_ROOT_CATEGORIES.AGGREGATE,
        previousCommitment: aggregateCommitment,
        sequence,
        rowBytes: row.bcsHex,
      });
      categoryCommitments[spec.plural] = category.commitment;
      aggregateCommitment = aggregate.commitment;
      compiledRows.push(deepFreeze({
        kind: spec.kind,
        category: spec.category,
        sequence,
        call: deepFreeze(call),
        payload,
        rowBcsHex: row.bcsHex,
        categoryCommitment: category.commitment,
        aggregateCommitment,
      }));
      sequence += 1n;
    }
  }

  const commitments = deepFreeze({
    ...categoryCommitments,
    aggregate: aggregateCommitment,
  });
  return deepFreeze({
    schemaVersion: MAKER_V8_COMPILER_SCHEMA,
    semantic,
    rootContentCommitment,
    counts: Object.freeze(Object.fromEntries(ROOT_CATEGORY_SPECS.map((spec) => [
      spec.plural,
      BigInt(sourceByPlural[spec.plural].length),
    ]))),
    totalRows: sequence,
    initialCommitments: deepFreeze({
      ...initialCategoryCommitments,
      aggregate: initialAggregate.commitment,
    }),
    commitments,
    registryCommitmentsBcsHex: serializeMakerV8RegistryCommitments(commitments).bcsHex,
    rows: Object.freeze(compiledRows),
  });
}

export async function makerV8EconomicsCommitment(value = {}) {
  const policy = assertCompletePolicy(
    value.completeMode,
    value.completePriceAtomic,
    value.completePerWalletQuota,
    value.completeTotalCap,
  );
  const makerAccess = u8(value.makerAccess, 'Maker access');
  const makerPrice = u64(value.makerPriceAtomic, 'Maker price');
  if (!((makerAccess === 0 && makerPrice === 0n)
    || (makerAccess === 1 && makerPrice > 0n && makerPrice <= 1_000_000_000_000n))) {
    fail('MAKER_V8_MAKER_ACCESS_INVALID', 'Maker access and price do not form a valid v8 policy.');
  }
  const input = {
    maker_access: makerAccess,
    maker_price_atomic: makerPrice,
    complete_mode: policy.mode,
    complete_price_atomic: policy.price,
    complete_per_wallet_quota: policy.quota,
    complete_total_cap: policy.totalCap,
    protocol_fee_bps: u16(value.protocolFeeBps, 'Protocol fee BPS'),
  };
  if (input.protocol_fee_bps > 10_000) {
    fail('MAKER_V8_PROTOCOL_FEE_INVALID', 'Protocol fee BPS cannot exceed 10,000.');
  }
  const result = await serializeAndHash(EconomicsCommitmentInputV8Bcs, input);
  const struct = serialized(EconomicsV8Bcs, { ...input, commitment: result.commitmentBytes });
  return deepFreeze({
    fields: {
      makerAccess,
      makerPriceAtomic: makerPrice,
      completeMode: policy.mode,
      completePriceAtomic: policy.price,
      completePerWalletQuota: policy.quota,
      completeTotalCap: policy.totalCap,
      protocolFeeBps: input.protocol_fee_bps,
    },
    inputBcsHex: result.bcsHex,
    commitment: result.commitment,
    structBcsHex: struct.hex,
  });
}

export async function makerV8RightsCommitment(value = {}) {
  const input = {
    origin: u8(value.origin, 'Rights origin'),
    creator_confirmed: boolean(value.creatorConfirmed, 'Rights creator confirmation'),
    soul_creator_royalty_bps: u16(value.soulCreatorRoyaltyBps, 'Soul creator royalty BPS'),
    maker_source_royalty_bps: u16(value.makerSourceRoyaltyBps, 'Maker source royalty BPS'),
    maker_resale_royalty_bps: u16(value.makerResaleRoyaltyBps, 'Maker resale royalty BPS'),
  };
  if (![0, 1].includes(input.origin) || input.creator_confirmed !== true) {
    fail('MAKER_V8_RIGHTS_INVALID', 'Rights origin must be supported and explicitly confirmed.');
  }
  for (const amount of [
    input.soul_creator_royalty_bps,
    input.maker_source_royalty_bps,
    input.maker_resale_royalty_bps,
  ]) {
    if (amount > 1_000 || amount % 50 !== 0) {
      fail('MAKER_V8_RIGHTS_INVALID', 'Royalties must be 0..1,000 BPS in 50-BPS steps.');
    }
  }
  if (input.soul_creator_royalty_bps + input.maker_source_royalty_bps > 1_000) {
    fail('MAKER_V8_RIGHTS_INVALID', 'Soul creator plus Maker source royalty cannot exceed 1,000 BPS.');
  }
  const result = await serializeAndHash(RightsCommitmentInputV8Bcs, input);
  const struct = serialized(RightsV8Bcs, { ...input, commitment: result.commitmentBytes });
  return deepFreeze({
    fields: {
      origin: input.origin,
      creatorConfirmed: input.creator_confirmed,
      soulCreatorRoyaltyBps: input.soul_creator_royalty_bps,
      makerSourceRoyaltyBps: input.maker_source_royalty_bps,
      makerResaleRoyaltyBps: input.maker_resale_royalty_bps,
    },
    inputBcsHex: result.bcsHex,
    commitment: result.commitment,
    structBcsHex: struct.hex,
  });
}

export async function makerV8VersionCommitment(value = {}) {
  const previousRootId = value.previousRootId === null
    ? null
    : normalizedId(value.previousRootId, 'Previous Root ID');
  const previousVersionCommitment = value.previousVersionCommitment === null
    ? null
    : digestBytes(value.previousVersionCommitment, 'Previous version commitment');
  if ((previousRootId === null) !== (previousVersionCommitment === null)) {
    fail('MAKER_V8_LINEAGE_PAIR_INVALID', 'Previous Root ID and version commitment must both be present or absent.');
  }
  const result = await serializeAndHash(VersionCommitmentInputV8Bcs, {
    version: VERSION,
    package_id: normalizedId(value.packageId, 'Maker v8 package ID'),
    maker_key: identifier(value.makerKey, 'Maker key'),
    maker_version: identifier(value.makerVersion, 'Maker version'),
    previous_root_id: previousRootId,
    previous_version_commitment: previousVersionCommitment,
    renderer_commitment: digestBytes(value.rendererCommitment, 'Renderer commitment'),
    manifest_blob_id: locator(value.manifestBlobId, 'Manifest Blob ID'),
    manifest_sha256: digestBytes(value.manifestSha256, 'Manifest SHA-256'),
    content_commitment: digestBytes(value.contentCommitment, 'Root content commitment'),
  });
  return hashResult(result);
}

function normalizeMakerV8RowCounts(value = {}) {
  const normalized = {
    tracks: u64(value.tracks, 'Track count'),
    parts: u64(value.parts, 'Part count'),
    items: u64(value.items, 'Item count'),
    styles: u64(value.styles, 'Style count'),
    colors: u64(value.colors, 'Color count'),
    rules: u64(value.rules, 'Rule count'),
    slots: u64(value.slots, 'Composition Slot count'),
    pack_releases: u64(value.packReleases, 'Pack Release count'),
    protected_assets: u64(value.protectedAssets, 'Protected Asset count'),
  };
  const keyed = {
    tracks: normalized.tracks,
    parts: normalized.parts,
    items: normalized.items,
    styles: normalized.styles,
    colors: normalized.colors,
    rules: normalized.rules,
    slots: normalized.slots,
    packReleases: normalized.pack_releases,
    protectedAssets: normalized.protected_assets,
  };
  for (const [field, limits] of Object.entries(ROW_COUNT_LIMITS)) {
    if (keyed[field] < limits.minimum || keyed[field] > limits.maximum) {
      fail('MAKER_V8_ROW_COUNT_INVALID', `${field} is outside the Maker v8 bounds.`, {
        field,
        minimum: limits.minimum.toString(),
        maximum: limits.maximum.toString(),
        actual: keyed[field].toString(),
      });
    }
  }
  return normalized;
}

export function serializeMakerV8RowCounts(value = {}) {
  const normalized = normalizeMakerV8RowCounts(value);
  const result = serialized(RowCountsV8Bcs, normalized);
  return deepFreeze({ fields: normalized, bcsHex: result.hex });
}

export function serializeMakerV8RegistryCommitments(value = {}) {
  const normalized = {
    tracks: digestBytes(value.tracks, 'Track registry commitment'),
    parts: digestBytes(value.parts, 'Part registry commitment'),
    items: digestBytes(value.items, 'Item registry commitment'),
    styles: digestBytes(value.styles, 'Style registry commitment'),
    colors: digestBytes(value.colors, 'Color registry commitment'),
    rules: digestBytes(value.rules, 'Rule registry commitment'),
    aggregate: digestBytes(value.aggregate, 'Aggregate registry commitment'),
  };
  const result = serialized(RegistryCommitmentsV8Bcs, normalized);
  return deepFreeze({ bcsHex: result.hex });
}

export function serializeMakerV8CapabilityCommitments(value = {}) {
  const normalized = {
    composition: digestBytes(value.composition, 'Composition commitment'),
    pack: digestBytes(value.pack, 'Pack commitment'),
    complete: digestBytes(value.complete, 'Complete commitment'),
    seal: digestBytes(value.seal, 'Seal commitment'),
    soul: digestBytes(value.soul, 'Soul commitment'),
    physical: value.physical === null
      ? null
      : digestBytes(value.physical, 'Physical commitment'),
  };
  const result = serialized(CapabilityCommitmentsV8Bcs, normalized);
  return deepFreeze({ bcsHex: result.hex });
}

export function serializeMakerV8Options({
  previousRootId = null,
  previousVersionCommitment = null,
  physicalCommitment = null,
} = {}) {
  const root = serialized(OptionId, previousRootId === null
    ? null
    : normalizedId(previousRootId, 'Previous Root ID'));
  const previous = serialized(OptionByteVector, previousVersionCommitment === null
    ? null
    : digestBytes(previousVersionCommitment, 'Previous version commitment'));
  const physical = serialized(OptionByteVector, physicalCommitment === null
    ? null
    : digestBytes(physicalCommitment, 'Physical commitment'));
  return deepFreeze({
    previousRootIdBcsHex: root.hex,
    previousVersionCommitmentBcsHex: previous.hex,
    physicalCommitmentBcsHex: physical.hex,
  });
}

export async function emptyMakerV8CompositionCommitment(rootContentCommitment) {
  return hashResult(await emptyCommitmentInput(
    rootContentCommitment,
    'animacraft.v8/composition/empty',
    CompositionEmptyHashInputV8Bcs,
  ));
}

export async function advanceMakerV8CompositionSlotCommitment(value = {}) {
  const behavior = u8(value.behavior, 'Composition Slot behavior');
  const capacity = u64(value.capacity, 'Composition Slot capacity');
  if (behavior > 3 || capacity === 0n || capacity > 16n) {
    fail('MAKER_V8_COMPOSITION_SLOT_INVALID', 'Composition Slot behavior or capacity is invalid.');
  }
  return hashResult(await serializeAndHash(CompositionSlotHashInputV8Bcs, {
    domain: domain('animacraft.v8/composition/slot'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Composition sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Composition commitment'),
    slot_key: identifier(value.slotKey, 'Composition Slot key'),
    behavior,
    capacity,
    required: boolean(value.required, 'Composition Slot required'),
    slot_commitment: digestBytes(value.slotCommitment, 'Composition Slot commitment'),
  }));
}

export async function advanceMakerV8CompositionItemCommitment(value = {}) {
  const sourceKind = u8(value.sourceKind, 'Composition Item source kind');
  if (sourceKind > 2) {
    fail('MAKER_V8_COMPOSITION_ITEM_INVALID', 'Composition Item source kind is invalid.');
  }
  return hashResult(await serializeAndHash(CompositionItemHashInputV8Bcs, {
    domain: domain('animacraft.v8/composition/item'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Composition sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Composition commitment'),
    slot_key: identifier(value.slotKey, 'Composition Slot key'),
    item_key: identifier(value.itemKey, 'Composition Item key'),
    source_kind: sourceKind,
    transferable: boolean(value.transferable, 'Composition Item transferable'),
    definition_commitment: digestBytes(value.definitionCommitment, 'Composition definition commitment'),
    asset_commitment: digestBytes(value.assetCommitment, 'Composition asset commitment'),
  }));
}

export async function advanceMakerV8CompositionRuleCommitment(value = {}) {
  const ruleKind = u8(value.ruleKind, 'Composition Rule kind');
  if (![0, 1].includes(ruleKind)) {
    fail('MAKER_V8_COMPOSITION_RULE_INVALID', 'Composition Rule kind is invalid.');
  }
  return hashResult(await serializeAndHash(CompositionRuleHashInputV8Bcs, {
    domain: domain('animacraft.v8/composition/rule'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Composition sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Composition commitment'),
    rule_kind: ruleKind,
    left_slot_key: identifier(value.leftSlotKey, 'Composition left Slot key'),
    left_item_key: identifier(value.leftItemKey, 'Composition left Item key'),
    right_slot_key: identifier(value.rightSlotKey, 'Composition right Slot key'),
    right_item_key: identifier(value.rightItemKey, 'Composition right Item key'),
    rule_commitment: digestBytes(value.ruleCommitment, 'Composition Rule commitment'),
  }));
}

export function makerV8StyleAssetKey(partKey, itemKey, styleKey) {
  const parts = [
    identifier(partKey, 'Style asset Part key'),
    identifier(itemKey, 'Style asset Item key'),
    identifier(styleKey, 'Style asset Style key'),
  ];
  return parts.join('\u0000');
}

export function makerV8PackScopeKey(namespace, packKey) {
  return `${identifier(namespace, 'Pack namespace')}\u0000${identifier(packKey, 'Pack key')}`;
}

export function makerV8MakerStyleSealScope(rootContentCommitment) {
  return deepFreeze({
    scopeKind: MAKER_V8_SEAL_SCOPE_KINDS.MAKER_STYLE,
    scopeKey: 'maker',
    scopeCommitment: normalizedDigest(rootContentCommitment, 'Root content commitment'),
  });
}

export function makerV8PackStyleSealScope(namespace, packKey, releaseContentCommitment) {
  return deepFreeze({
    scopeKind: MAKER_V8_SEAL_SCOPE_KINDS.PACK_STYLE,
    scopeKey: makerV8PackScopeKey(namespace, packKey),
    scopeCommitment: normalizedDigest(releaseContentCommitment, 'Pack content commitment'),
  });
}

export function makerV8CompleteSealScope(outputKey, recipePolicyCommitment) {
  return deepFreeze({
    scopeKind: MAKER_V8_SEAL_SCOPE_KINDS.COMPLETE,
    scopeKey: textValue(outputKey, 'Complete output key', 256),
    scopeCommitment: normalizedDigest(recipePolicyCommitment, 'Recipe policy commitment'),
  });
}

export async function emptyMakerV8SealCommitment(rootContentCommitment) {
  return hashResult(await emptyCommitmentInput(
    rootContentCommitment,
    'animacraft.v8/seal/empty',
    SealEmptyHashInputV8Bcs,
  ));
}

export async function deriveMakerV8SealId(value = {}) {
  const scopeKind = u8(value.scopeKind, 'Seal scope kind');
  if (scopeKind > 2) fail('MAKER_V8_SEAL_SCOPE_INVALID', 'Seal scope kind is invalid.');
  return hashResult(await serializeAndHash(SealIdInputV8Bcs, {
    domain: domain('animacraft.v8/seal/id'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    scope_kind: scopeKind,
    scope_key: scopeKey(value.scopeKey, 'Seal scope key'),
    scope_commitment: digestBytes(value.scopeCommitment, 'Seal scope commitment'),
    asset_key: textValue(value.assetKey, 'Seal asset key', 512, { rejectNul: false }),
    asset_commitment: digestBytes(value.assetCommitment, 'Seal asset commitment'),
  }));
}

export async function advanceMakerV8SealCommitment(value = {}) {
  const seal = await deriveMakerV8SealId(value);
  const scopeKind = u8(value.scopeKind, 'Seal scope kind');
  const result = await serializeAndHash(SealRowHashInputV8Bcs, {
    domain: domain('animacraft.v8/seal/row'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Seal sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Seal commitment'),
    scope_kind: scopeKind,
    scope_key: scopeKey(value.scopeKey, 'Seal scope key'),
    scope_commitment: digestBytes(value.scopeCommitment, 'Seal scope commitment'),
    asset_key: textValue(value.assetKey, 'Seal asset key', 512, { rejectNul: false }),
    asset_commitment: digestBytes(value.assetCommitment, 'Seal asset commitment'),
    seal_id: digestBytes(seal.commitment, 'Derived Seal ID'),
  });
  return deepFreeze({ bcsHex: result.bcsHex, sealId: seal.commitment, commitment: result.commitment });
}

export async function emptyMakerV8PackRegistryCommitment(rootContentCommitment) {
  return hashResult(await emptyCommitmentInput(
    rootContentCommitment,
    'animacraft.v8/pack/registry/empty',
    PackRegistryEmptyHashInputV8Bcs,
  ));
}

export async function emptyMakerV8PackStyleCommitment(value = {}) {
  return hashResult(await serializeAndHash(PackStyleEmptyHashInputV8Bcs, {
    domain: domain('animacraft.v8/pack/style/empty'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    namespace: identifier(value.namespace, 'Pack namespace'),
    pack_key: identifier(value.packKey, 'Pack key'),
    manifest_commitment: digestBytes(value.manifestCommitment, 'Pack manifest commitment'),
    release_content_commitment: digestBytes(value.releaseContentCommitment, 'Pack content commitment'),
  }));
}

function exactSealId(protectedValue, sealId, label) {
  const protectedFlag = boolean(protectedValue, `${label} protected`);
  const bytes = protectedFlag
    ? digestBytes(sealId, `${label} Seal ID`)
    : bytesFrom(sealId ?? new Uint8Array(), `${label} empty Seal ID`, 0);
  return { protectedFlag, sealId: bytes };
}

export async function advanceMakerV8PackStyleCommitment(value = {}) {
  const seal = exactSealId(value.protected, value.sealId, 'Pack Style');
  return hashResult(await serializeAndHash(PackStyleHashInputV8Bcs, {
    domain: domain('animacraft.v8/pack/style'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    namespace: identifier(value.namespace, 'Pack namespace'),
    pack_key: identifier(value.packKey, 'Pack key'),
    manifest_commitment: digestBytes(value.manifestCommitment, 'Pack manifest commitment'),
    release_content_commitment: digestBytes(value.releaseContentCommitment, 'Pack content commitment'),
    sequence: u64(value.sequence, 'Pack Style sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Pack Style commitment'),
    part_key: identifier(value.partKey, 'Pack Style Part key'),
    item_key: identifier(value.itemKey, 'Pack Style Item key'),
    style_key: identifier(value.styleKey, 'Pack Style key'),
    asset_blob_id: locator(value.assetBlobId, 'Pack Style asset Blob ID'),
    asset_commitment: digestBytes(value.assetCommitment, 'Pack Style asset commitment'),
    protected: seal.protectedFlag,
    seal_id: seal.sealId,
  }));
}

export async function advanceMakerV8PackReleaseCommitment(value = {}) {
  const accessKind = u8(value.accessKind, 'Pack access kind');
  const purchasePrice = u64(value.purchasePriceAtomic, 'Pack purchase price');
  if (!((accessKind === 0 && purchasePrice === 0n)
    || (accessKind === 1 && purchasePrice > 0n && purchasePrice <= 1_000_000_000_000n)
    || (accessKind === 2 && purchasePrice === 0n))) {
    fail('MAKER_V8_PACK_ACCESS_INVALID', 'Pack access kind and price are invalid.');
  }
  const policy = assertCompletePolicy(
    value.completeMode,
    value.completePriceAtomic,
    value.completeFreeQuotaPerWallet,
    value.completeTotalCap,
  );
  return hashResult(await serializeAndHash(PackRegistryRowHashInputV8Bcs, {
    domain: domain('animacraft.v8/pack/release'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Pack Release sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Pack registry commitment'),
    namespace: identifier(value.namespace, 'Pack namespace'),
    pack_key: identifier(value.packKey, 'Pack key'),
    manifest_commitment: digestBytes(value.manifestCommitment, 'Pack manifest commitment'),
    release_content_commitment: digestBytes(value.releaseContentCommitment, 'Pack content commitment'),
    style_registry_commitment: digestBytes(value.styleRegistryCommitment, 'Pack Style registry commitment'),
    access_kind: accessKind,
    purchase_price_atomic: purchasePrice,
    complete_mode: policy.mode,
    complete_price_atomic: policy.price,
    complete_free_quota_per_wallet: policy.quota,
    complete_total_cap: policy.totalCap,
    protected_style_count: u64(value.protectedStyleCount, 'Pack protected Style count'),
    seal_registry_commitment: digestBytes(value.sealRegistryCommitment, 'Seal registry commitment'),
  }));
}

export async function emptyMakerV8CompleteCommitment(rootContentCommitment) {
  return hashResult(await emptyCommitmentInput(
    rootContentCommitment,
    'animacraft.v8/complete/empty',
    CompleteEmptyHashInputV8Bcs,
  ));
}

export async function advanceMakerV8CompleteOutputCommitment(value = {}) {
  const seal = exactSealId(value.protected, value.sealId, 'Complete output');
  const requiredCount = u64(value.requiredPackSelectionCount, 'Required Pack selection count');
  if (requiredCount > 64n) {
    fail('MAKER_V8_COMPLETE_SELECTION_LIMIT', 'Complete output cannot require more than 64 Pack selections.');
  }
  return hashResult(await serializeAndHash(CompleteOutputHashInputV8Bcs, {
    domain: domain('animacraft.v8/complete/output'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Complete sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Complete commitment'),
    output_key: textValue(value.outputKey, 'Complete output key', 256),
    recipe_policy_commitment: digestBytes(value.recipePolicyCommitment, 'Recipe policy commitment'),
    renderer_schema_commitment: digestBytes(value.rendererSchemaCommitment, 'Renderer schema commitment'),
    protected: seal.protectedFlag,
    seal_id: seal.sealId,
    required_pack_selection_count: requiredCount,
    required_pack_selection_commitment: digestBytes(
      value.requiredPackSelectionCommitment,
      'Required Pack selection commitment',
    ),
  }));
}

export async function advanceMakerV8CompletePackPolicyCommitment(value = {}) {
  const policy = assertCompletePolicy(
    value.mode,
    value.priceAtomic,
    value.freeQuotaPerWallet,
    value.totalCap,
  );
  return hashResult(await serializeAndHash(CompletePackPolicyHashInputV8Bcs, {
    domain: domain('animacraft.v8/complete/pack-policy'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Complete sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Complete commitment'),
    pack_scope_key: scopeKey(value.packScopeKey, 'Pack scope key'),
    release_content_commitment: digestBytes(value.releaseContentCommitment, 'Pack content commitment'),
    mode: policy.mode,
    price_atomic: policy.price,
    free_quota_per_wallet: policy.quota,
    total_cap: policy.totalCap,
  }));
}

export async function emptyMakerV8RequiredPackSelectionCommitment(rootContentCommitment) {
  return hashResult(await emptyCommitmentInput(
    rootContentCommitment,
    'animacraft.v8/complete/pack-selection/empty',
    StablePackSelectionEmptyHashInputV8Bcs,
  ));
}

export async function advanceMakerV8RequiredPackSelectionCommitment(value = {}) {
  const seal = exactSealId(value.protected, value.sealId, 'Required Pack selection');
  return hashResult(await serializeAndHash(StablePackSelectionHashInputV8Bcs, {
    domain: domain('animacraft.v8/complete/pack-selection'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Required Pack selection sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior required Pack selection commitment'),
    pack_scope_key: scopeKey(value.packScopeKey, 'Pack scope key'),
    release_content_commitment: digestBytes(value.releaseContentCommitment, 'Pack content commitment'),
    part_key: textValue(value.partKey, 'Pack selection Part key', 256),
    item_key: textValue(value.itemKey, 'Pack selection Item key', 256),
    style_key: textValue(value.styleKey, 'Pack selection Style key', 256),
    asset_commitment: digestBytes(value.assetCommitment, 'Pack selection asset commitment'),
    protected: seal.protectedFlag,
    seal_id: seal.sealId,
  }));
}

export async function emptyMakerV8PhysicalCommitment(rootContentCommitment) {
  return hashResult(await emptyCommitmentInput(
    rootContentCommitment,
    'animacraft.v8/physical/empty',
    PhysicalEmptyHashInputV8Bcs,
  ));
}

export async function advanceMakerV8PhysicalCommitment(value = {}) {
  const sourceKind = u8(value.sourceKind, 'Physical source kind');
  const maxSupply = u64(value.maxSupply, 'Physical maximum supply');
  if (sourceKind > 1 || maxSupply === 0n || maxSupply > 1_000_000_000n) {
    fail('MAKER_V8_PHYSICAL_POLICY_INVALID', 'Physical source kind or maximum supply is invalid.');
  }
  return hashResult(await serializeAndHash(PhysicalPolicyHashInputV8Bcs, {
    domain: domain('animacraft.v8/physical/policy'),
    version: VERSION,
    root_content_commitment: digestBytes(value.rootContentCommitment, 'Root content commitment'),
    sequence: u64(value.sequence, 'Physical sequence'),
    prior_commitment: digestBytes(value.priorCommitment, 'Prior Physical commitment'),
    source_kind: sourceKind,
    scope_key: scopeKey(value.scopeKey, 'Physical scope key'),
    scope_commitment: digestBytes(value.scopeCommitment, 'Physical scope commitment'),
    part_key: identifier(value.partKey, 'Physical Part key'),
    item_key: identifier(value.itemKey, 'Physical Item key'),
    style_key: identifier(value.styleKey, 'Physical Style key'),
    style_content_commitment: digestBytes(value.styleContentCommitment, 'Physical Style content commitment'),
    material_commitment: digestBytes(value.materialCommitment, 'Physical material commitment'),
    max_supply: maxSupply,
    transferable: boolean(value.transferable, 'Physical transferable'),
  }));
}

export async function makerV8SoulCommitment(rootContentCommitment) {
  return hashResult(await emptyCommitmentInput(
    rootContentCommitment,
    'animacraft.v8/soul/registry',
    SoulRegistryCommitmentInputV8Bcs,
  ));
}

function orderedRows(value, label) {
  if (!Array.isArray(value)) {
    fail('MAKER_V8_CALL_PLAN_ROWS_INVALID', `${label} must be an ordered array.`, { label });
  }
  return value;
}

function rowProtected(value, label) {
  if (!isPlainObject(value)) {
    fail('MAKER_V8_CALL_PLAN_ROW_INVALID', `${label} must be a plain object.`, { label });
  }
  const protectedValue = value.call?.protected ?? value.protected;
  return boolean(protectedValue, `${label} protected`);
}

/**
 * Produces the one canonical topological call order and all exact counter
 * snapshots. Entries are logical calls, not an assertion that every entry can
 * share a PTB; newly shared Pack objects are intentionally consumed later.
 */
export function planMakerV8PublicationCalls(input = {}) {
  const snapshot = snapshotCompilerData(input, 'callPlan');
  const {
    root = {},
    composition = {},
    packs = [],
    completeOutputs = [],
    physicalPolicies = null,
    ...unknown
  } = snapshot;
  if (Object.keys(unknown).length) {
    fail('MAKER_V8_CALL_PLAN_UNKNOWN', 'The call-plan shape contains unknown fields.', {
      fields: Object.keys(unknown),
    });
  }
  if (!isPlainObject(root) || !isPlainObject(composition)) {
    fail('MAKER_V8_CALL_PLAN_INVALID', 'Root and Composition call-plan groups must be objects.');
  }
  const rootRows = Object.fromEntries(ROOT_CATEGORY_SPECS.map((spec) => [
    spec.plural,
    orderedRows(root[spec.plural] ?? [], `Root ${spec.plural}`),
  ]));
  const compositionRows = {
    slots: orderedRows(composition.slots ?? [], 'Composition Slots'),
    items: orderedRows(composition.items ?? [], 'Composition Items'),
    rules: orderedRows(composition.rules ?? [], 'Composition Rules'),
  };
  const exactPacks = orderedRows(packs, 'Pack Releases');
  const outputs = orderedRows(completeOutputs, 'Complete outputs');
  // Unified v8 always binds every native capability. An author with no
  // Physical rows still publishes and seals an explicit empty Physical
  // registry; absence is never represented by a partial capability mask.
  const physicalDeclared = true;
  const policies = orderedRows(physicalPolicies ?? [], 'Physical policies');
  if (policies.length > 10_000) {
    fail('MAKER_V8_PHYSICAL_POLICY_LIMIT', 'Physical cannot exceed 10,000 policy rows.', {
      actual: policies.length,
    });
  }

  const protectedMakerStyles = rootRows.styles
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => rowProtected(row, `Root Style ${index}`));
  const protectedPackStyles = [];
  exactPacks.forEach((pack, packIndex) => {
    if (!isPlainObject(pack)) {
      fail('MAKER_V8_CALL_PLAN_PACK_INVALID', `Pack Release ${packIndex} must be an object.`);
    }
    identifier(pack.namespace, `Pack Release ${packIndex} namespace`);
    identifier(pack.packKey, `Pack Release ${packIndex} key`);
    orderedRows(pack.styles, `Pack Release ${packIndex} Styles`).forEach((style, styleIndex) => {
      if (rowProtected(style, `Pack Release ${packIndex} Style ${styleIndex}`)) {
        protectedPackStyles.push({ pack, packIndex, style, styleIndex });
      }
    });
  });
  const protectedOutputs = outputs
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => rowProtected(row, `Complete output ${index}`));

  const expectedCounts = {
    tracks: rootRows.tracks.length,
    parts: rootRows.parts.length,
    items: rootRows.items.length,
    styles: rootRows.styles.length,
    colors: rootRows.colors.length,
    rules: rootRows.rules.length,
    slots: compositionRows.slots.length,
    packReleases: exactPacks.length,
    protectedAssets: protectedMakerStyles.length
      + protectedPackStyles.length
      + protectedOutputs.length,
  };
  const rowCounts = serializeMakerV8RowCounts(expectedCounts);

  const calls = [];
  const push = (phase, target, details = {}) => {
    calls.push(deepFreeze({ index: BigInt(calls.length), phase, target, ...details }));
  };
  push('begin', 'maker_v8::new_row_counts_v8');
  push('begin', 'maker_v8::new_registry_commitments_v8');
  push('begin', 'maker_v8::new_capability_commitments_v8');
  push('begin', 'maker_v8::new_economics_v8');
  push('begin', 'maker_v8::new_rights_v8');
  push('begin', 'publication_v8::begin_maker_v8');

  let rootSequence = 0n;
  for (const spec of ROOT_CATEGORY_SPECS) {
    rootRows[spec.plural].forEach((_row, index) => {
      push('root', `maker_v8::append_${spec.kind}_v8`, {
        category: spec.category,
        rowIndex: BigInt(index),
        sequence: rootSequence,
      });
      rootSequence += 1n;
    });
  }

  let compositionSequence = 0n;
  const compositionTargets = [
    ['slots', 'composition_v8::append_wardrobe_slot_v8'],
    ['items', 'composition_v8::append_composition_item_v8'],
    ['rules', 'composition_v8::append_loadout_rule_v8'],
  ];
  for (const [group, target] of compositionTargets) {
    compositionRows[group].forEach((_row, index) => {
      push('composition', target, { rowIndex: BigInt(index), sequence: compositionSequence });
      compositionSequence += 1n;
    });
  }

  exactPacks.forEach((pack, packIndex) => push(
    'pack-create',
    'expansion_pack_v8::create_expansion_pack_release_v8',
    { packIndex: BigInt(packIndex), namespace: pack.namespace, packKey: pack.packKey },
  ));

  let sealSequence = 0n;
  const pushSeal = (scopeKind, details) => {
    push('seal-rows', 'seal_v8::append_protected_asset_v8', {
      scopeKind,
      sequence: sealSequence,
      ...details,
    });
    sealSequence += 1n;
  };
  protectedMakerStyles.forEach(({ index }) => pushSeal(
    MAKER_V8_SEAL_SCOPE_KINDS.MAKER_STYLE,
    { rowIndex: BigInt(index) },
  ));
  protectedPackStyles.forEach(({ packIndex, styleIndex }) => pushSeal(
    MAKER_V8_SEAL_SCOPE_KINDS.PACK_STYLE,
    { packIndex: BigInt(packIndex), rowIndex: BigInt(styleIndex) },
  ));
  protectedOutputs.forEach(({ index }) => pushSeal(
    MAKER_V8_SEAL_SCOPE_KINDS.COMPLETE,
    { rowIndex: BigInt(index) },
  ));
  push('seal-registry', 'seal_v8::seal_registry_v8');

  exactPacks.forEach((pack, packIndex) => {
    pack.styles.forEach((_style, styleIndex) => push(
      'pack-styles',
      'expansion_pack_v8::append_expansion_pack_style_v8',
      {
        packIndex: BigInt(packIndex),
        rowIndex: BigInt(styleIndex),
        sequence: BigInt(styleIndex),
      },
    ));
    push('pack-release-seal', 'expansion_pack_v8::seal_expansion_pack_release_v8', {
      packIndex: BigInt(packIndex),
    });
    push('pack-register', 'expansion_pack_v8::append_release_to_registry_v8', {
      packIndex: BigInt(packIndex),
      sequence: BigInt(packIndex),
    });
  });

  let completeSequence = 0n;
  outputs.forEach((_output, index) => {
    push('complete-outputs', 'complete_v8::append_complete_output_v8', {
      rowIndex: BigInt(index),
      sequence: completeSequence,
    });
    completeSequence += 1n;
  });
  exactPacks.forEach((_pack, packIndex) => {
    push('complete-pack-policies', 'complete_v8::append_complete_pack_policy_v8', {
      packIndex: BigInt(packIndex),
      sequence: completeSequence,
    });
    completeSequence += 1n;
  });

  policies.forEach((policy, index) => {
    if (!isPlainObject(policy)) {
      fail('MAKER_V8_CALL_PLAN_PHYSICAL_INVALID', `Physical policy ${index} must be an object.`);
    }
    const sourceKind = u8(policy.sourceKind, `Physical policy ${index} source kind`);
    if (![MAKER_V8_PHYSICAL_SOURCE_KINDS.MAKER_STYLE, MAKER_V8_PHYSICAL_SOURCE_KINDS.PACK_STYLE]
      .includes(sourceKind)) {
      fail('MAKER_V8_PHYSICAL_POLICY_INVALID', `Physical policy ${index} has an invalid source kind.`);
    }
    push(
      'physical',
      sourceKind === MAKER_V8_PHYSICAL_SOURCE_KINDS.MAKER_STYLE
        ? 'physical_v8::append_maker_style_policy_v8'
        : 'physical_v8::append_pack_style_policy_v8',
      { rowIndex: BigInt(index), sequence: BigInt(index), sourceKind },
    );
  });

  push('registry-seals', 'composition_v8::seal_composition_registry_v8');
  push('registry-seals', 'expansion_pack_v8::seal_expansion_pack_registry_v8');
  push('registry-seals', 'complete_v8::seal_complete_registry_v8');
  push('registry-seals', 'physical_v8::seal_physical_registry_v8');
  push('activation', 'publication_v8::seal_and_activate_physical_maker_v8');

  return deepFreeze({
    rowCounts: rowCounts.fields,
    rowCountsBcsHex: rowCounts.bcsHex,
    declaredCapabilities: MAKER_V8_REQUIRED_CAPABILITIES,
    expectedCompositionItemCount: BigInt(compositionRows.items.length),
    expectedCompositionRuleCount: BigInt(compositionRows.rules.length),
    expectedCompleteOutputCount: BigInt(outputs.length),
    expectedCompletePackPolicyCount: BigInt(exactPacks.length),
    expectedPhysicalPolicyCount: BigInt(policies.length),
    packReleaseCounts: Object.freeze(exactPacks.map((pack) => Object.freeze({
      namespace: pack.namespace,
      packKey: pack.packKey,
      expectedStyleCount: BigInt(pack.styles.length),
      expectedProtectedStyleCount: BigInt(pack.styles.filter((style) => (
        style.call?.protected ?? style.protected
      ) === true).length),
    }))),
    physicalDeclared,
    rootSequence,
    compositionSequence,
    sealSequence,
    completeSequence,
    calls: Object.freeze(calls),
  });
}

function documentCompilerGaps(document) {
  const gaps = [];
  const add = (path, code, message) => gaps.push(Object.freeze({ path, code, message }));

  (document.parts || []).forEach((part, partIndex) => {
    add(
      `parts[${partIndex}].kind`,
      'MAKER_V8_COMPILER_PART_KIND_UNSPECIFIED',
      'The Maker v8 document schema does not define the Root Part.kind u8.',
    );
    if (part.wardrobeMode === 'SLOT') {
      add(
        `parts[${partIndex}]`,
        'MAKER_V8_COMPILER_COMPOSITION_SLOT_UNSPECIFIED',
        'SLOT Parts need explicit behavior, capacity, admitted Item source, transfer, and commitment projections.',
      );
    }
    (part.items || []).forEach((item, itemIndex) => {
      add(
        `parts[${partIndex}].items[${itemIndex}].gateKind`,
        'MAKER_V8_COMPILER_ITEM_GATE_UNSPECIFIED',
        'The Maker v8 document schema does not define the Root Item.gate_kind u8.',
      );
      (item.styles || []).forEach((style, styleIndex) => {
        if (style.seal?.protected === true) {
          add(
            `parts[${partIndex}].items[${itemIndex}].styles[${styleIndex}].seal`,
            'MAKER_V8_COMPILER_PROTECTED_TRANSPORT_UNSPECIFIED',
            'Protected Style plaintext/ciphertext certification semantics are not defined by the document.',
          );
        }
        if (style.physical?.enabled === true) {
          add(
            `parts[${partIndex}].items[${itemIndex}].styles[${styleIndex}].physical`,
            'MAKER_V8_COMPILER_PHYSICAL_POLICY_UNSPECIFIED',
            'Physical Style material, supply, and transfer policy fields are missing.',
          );
        }
      });
    });
  });

  (document.colorChannels || []).forEach((channel, channelIndex) => {
    (channel.swatches || []).forEach((_swatch, swatchIndex) => add(
      `colorChannels[${channelIndex}].swatches[${swatchIndex}].rgba`,
      'MAKER_V8_COMPILER_RGBA_UNSPECIFIED',
      'The document has hintColor but does not specify the canonical on-chain rgba u32 mapping.',
    ));
  });

  (document.rules || []).forEach((_rule, index) => add(
    `rules[${index}]`,
    'MAKER_V8_COMPILER_ROOT_RULE_ENCODING_UNSPECIFIED',
    'Root Rule.kind and left_ref/right_ref encodings are not defined by the document schema.',
  ));

  add(
    'publication.composition',
    'MAKER_V8_COMPILER_COMPOSITION_ROWS_UNSPECIFIED',
    'The document does not explicitly define ordered Composition Slot, admitted Item, and binary REQUIRE/EXCLUDE rows; richer Creator rules cannot be reinterpreted as them.',
  );

  (document.assets || []).forEach((asset, index) => add(
    `assets[${index}].certification`,
    'MAKER_V8_COMPILER_ASSET_CERTIFICATION_REQUIRED',
    `Asset "${asset.id}" needs exact bytes, certified Blob ID, recomputed SHA-256, byte length, media type, and visible certification evidence.`,
  ));

  (document.packs || []).forEach((pack, index) => {
    add(
      `packs[${index}]`,
      'MAKER_V8_COMPILER_PACK_RELEASE_UNSPECIFIED',
      `Pack "${pack.id}" lacks its namespace, certified manifest bytes, ordered Styles, and raw semantic inputs; contentCommitment is not accepted as authority.`,
    );
  });

  add(
    'publication.renderer',
    'MAKER_V8_COMPILER_RENDERER_PROJECTION_UNSPECIFIED',
    'The document schema does not define the exact renderer commitment projection.',
  );
  add(
    'publication.manifest',
    'MAKER_V8_COMPILER_MANIFEST_CERTIFICATION_REQUIRED',
    'Exact certified manifest bytes, Blob ID, SHA-256, and per-asset certified Blob mappings are required.',
  );
  add(
    'publication.completeOutputs',
    'MAKER_V8_COMPILER_COMPLETE_OUTPUTS_UNSPECIFIED',
    'The document schema does not define Complete output policy rows.',
  );
  add(
    'publication.completeOutputs[].requiredPackSelections',
    'MAKER_V8_COMPILER_COMPLETE_SELECTIONS_UNSPECIFIED',
    'Complete requires ordered concrete Pack Style selections with release, asset, protection, and Seal inputs; Pack IDs or min/max summaries are insufficient.',
  );

  return Object.freeze(gaps);
}

export function collectMakerV8CompilerIssues(document) {
  assertMakerV8Document(document, { mode: 'compile' });
  return documentCompilerGaps(document);
}

/**
 * Document-level entry point. It deliberately refuses to emit a transaction
 * plan until the authoring schema owns every semantic input required by Move.
 * The exact low-level serializers and commitment helpers above are usable for
 * cross-language parity and for the future expanded document adapter.
 */
export async function compileMakerV8Publication(document) {
  const issues = collectMakerV8CompilerIssues(document);
  if (issues.length) {
    fail(
      'MAKER_V8_DOCUMENT_SCHEMA_INCOMPLETE',
      `Maker v8 publication is blocked by ${issues.length} compiler schema gap${issues.length === 1 ? '' : 's'}.`,
      { issues },
    );
  }
  fail(
    'MAKER_V8_DOCUMENT_SCHEMA_INCOMPLETE',
    'Maker v8 publication cannot proceed without the canonical publication fields.',
  );
}

/**
 * Validates a caller-supplied certified byte record without accepting its
 * digest as authority. The SHA-256 is always recomputed from the exact bytes.
 */
export async function verifyMakerV8Certification(value = {}, {
  label = 'Certified file',
  expectedSha256 = null,
  expectedByteLength = null,
  expectedMediaType = null,
} = {}) {
  if (!isPlainObject(value)) {
    fail('MAKER_V8_CERTIFICATION_INVALID', `${label} certification must be a plain object.`, { label });
  }
  const certificationFields = new Set([
    'certified',
    'certificationVisible',
    'blobId',
    'bytes',
    'sha256',
    'byteLength',
    'mediaType',
  ]);
  const unknownFields = Object.keys(value).filter((field) => !certificationFields.has(field));
  if (unknownFields.length) {
    fail('MAKER_V8_CERTIFICATION_FIELDS_UNKNOWN', `${label} certification contains unknown fields.`, {
      label,
      fields: unknownFields,
    });
  }
  if (value.certified !== true || value.certificationVisible !== true) {
    fail('MAKER_V8_CERTIFICATION_REQUIRED', `${label} must be visibly certified.`, { label });
  }
  const blobId = locator(value.blobId, `${label} Blob ID`);
  const bytes = bytesFrom(value.bytes, `${label} bytes`);
  if (bytes.length === 0) {
    fail('MAKER_V8_CERTIFICATION_BYTES_EMPTY', `${label} bytes cannot be empty.`, { label });
  }
  const observedSha256 = hexFromBytes(await sha256(bytes));
  const declaredSha256 = normalizedDigest(value.sha256, `${label} declared SHA-256`);
  if (observedSha256 !== declaredSha256) {
    fail('MAKER_V8_CERTIFICATION_HASH_MISMATCH', `${label} bytes do not match the declared SHA-256.`, {
      label,
      expected: declaredSha256,
      actual: observedSha256,
    });
  }
  if (expectedSha256 !== null
    && observedSha256 !== normalizedDigest(expectedSha256, `${label} expected SHA-256`)) {
    fail('MAKER_V8_CERTIFICATION_HASH_MISMATCH', `${label} does not match its document SHA-256.`, { label });
  }
  const byteLength = u64(value.byteLength, `${label} byte length`);
  if (byteLength !== BigInt(bytes.length)
    || (expectedByteLength !== null && byteLength !== u64(expectedByteLength, `${label} expected byte length`))) {
    fail('MAKER_V8_CERTIFICATION_LENGTH_MISMATCH', `${label} byte length does not match its bytes.`, { label });
  }
  const mediaType = textValue(value.mediaType, `${label} media type`, 256);
  if (expectedMediaType !== null && mediaType !== expectedMediaType) {
    fail('MAKER_V8_CERTIFICATION_MEDIA_TYPE_MISMATCH', `${label} media type does not match the document.`, { label });
  }
  return deepFreeze({
    blobId,
    sha256: observedSha256,
    byteLength,
    mediaType,
    bytesHex: hexFromBytes(bytes),
  });
}

export const MAKER_V8_BCS_LAYOUTS = Object.freeze({
  rootRows: Object.freeze([
    'TrackRowV8(sequence,key,label,render_order,payload_commitment)',
    'PartRowV8(sequence,key,label,kind,render_order,required,visible,payload_commitment)',
    'ItemRowV8(sequence,part_key,item_key,label,gate_kind,payload_commitment)',
    'StyleRowV8(sequence,part_key,item_key,style_key,layer_track_key,color_channel_key,default_swatch_key,label,asset_blob_id,asset_sha256,protected,payload_commitment)',
    'ColorRowV8(sequence,channel_key,swatch_key,label,rgba,payload_commitment)',
    'RuleRowV8(sequence,key,kind,left_ref,right_ref,payload_commitment)',
  ]),
  callOrder: Object.freeze([
    'maker_v8 constructors',
    'publication_v8::begin_maker_v8',
    'Root Track -> Part -> Item -> Style -> Color -> Rule rows',
    'Composition Slot -> Item -> Rule rows',
    'create Pack Releases while Seal is unsealed',
    'Seal rows -> seal Seal registry',
    'Pack Styles -> seal Releases -> register Releases',
    'Complete Outputs -> Pack policies',
    'Physical policies after referenced Pack Releases are registered',
    'seal Composition -> Pack -> Complete -> optional Physical registries',
    'publication_v8 activation overload',
  ]),
});
