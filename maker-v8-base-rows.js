import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { assertMakerV8Document, compareMakerV8ProtocolText } from './maker-v8-document.js';
import { MAKER_V8_BLEND_CODES } from './maker-v8-render-core.js';
import { makerV8VisibilityTokens } from './maker-v8-visibility.js';

const bytes = bcs.vector(bcs.u8());
const textOption = bcs.option(bcs.string());
const Selector = bcs.struct('SemanticSelectorV2', { source: bcs.u8(), source_key: textOption, part_key: bcs.string(), item_key: textOption, style_key: textOption });
const Visibility = bcs.struct('VisibilityTokenV1', { opcode: bcs.u8(), selector: bcs.option(Selector), arity: bcs.u16() });
export const MAKER_V8_VISIBILITY_TOKEN_BCS_V1 = Visibility;
const Signed = bcs.struct('SignedMilliV1', { negative: bcs.bool(), magnitude: bcs.u64() });
const Transform = bcs.struct('TransformFixedV1', { x_milli: Signed, y_milli: Signed, scale_ppm: bcs.u64(), rotation_millidegrees: Signed });
const Physical = bcs.struct('PhysicalPolicyV1', { material: bcs.string(), issuance: bcs.u8(), proof: bcs.u8(), price_atomic: bcs.u64(), max_supply: bcs.u64(), transferable: bcs.bool() });
const Stop = bcs.struct('ColorStopV2', { offset_ppm: bcs.u64(), rgba: bcs.u32() });
const Swatch = bcs.struct('ColorSwatchV2', { key: bcs.string(), label: bcs.string(), rgba: bcs.u32(), stops: bcs.vector(Stop) });
export const MAKER_V8_COLOR_SWATCH_BCS_V2 = Swatch;
const visibilityFields = { visibility_tokens: bcs.vector(Visibility), visibility_commitment: bytes, payload_commitment: bytes };

/** Exact stored Core schema2 layouts; source metadata is not serialized. */
export const MAKER_V8_BASE_ROW_BCS_V2 = Object.freeze({
  track: bcs.struct('TrackRowV2', { sequence: bcs.u64(), key: bcs.string(), label: bcs.string(), render_order: bcs.u64(), locked: bcs.bool() }),
  color: bcs.struct('ColorChannelRowV2', { sequence: bcs.u64(), key: bcs.string(), label: bcs.string(), default_swatch_key: bcs.string(), swatches: bcs.vector(Swatch) }),
  part: bcs.struct('PartRowV2', { sequence: bcs.u64(), key: bcs.string(), label: bcs.string(), kind: bcs.u8(), render_order: bcs.u64(), menu_order: bcs.u64(), visible: bcs.bool(), required: bcs.bool(), slot_mode: bcs.u8(), capacity: bcs.u64(), track_keys: bcs.vector(bcs.string()), ...visibilityFields }),
  item: bcs.struct('ItemRowV2', { sequence: bcs.u64(), part_key: bcs.string(), item_key: bcs.string(), label: bcs.string(), status: bcs.u8(), display_order: bcs.u64(), default_style_key: bcs.string(), ...visibilityFields }),
  style: bcs.struct('StyleRowV2', { sequence: bcs.u64(), part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string(), label: bcs.string(), display_order: bcs.u64(), track_key: bcs.string(), color_channel_key: textOption, default_swatch_key: textOption, asset_id: bcs.string(), asset_blob_id: bcs.string(), asset_sha256: bytes, protected: bcs.bool(), transform: Transform, opacity_ppm: bcs.u64(), blend_mode: bcs.u8(), physical: bcs.option(Physical), ...visibilityFields }),
  asset: bcs.struct('AssetRowV2', { sequence: bcs.u64(), asset_id: bcs.string(), kind: bcs.string(), media_type: bcs.string(), byte_length: bcs.u64(), sha256: bytes }),
});
export const MAKER_V8_BASE_CATEGORIES_V2 = Object.freeze({ track: 0, color: 1, part: 2, item: 3, style: 4, rule: 5, asset: 6 });
const VisibilityInput = bcs.struct('VisibilityProgramCommitmentInputV1', { domain: bcs.string(), schema_revision: bcs.u64(), definition_source: bcs.u8(), definition_source_key: textOption, subject_level: bcs.u8(), part_key: bcs.string(), item_key: textOption, style_key: textOption, tokens: bcs.vector(Visibility) });
const encoder = new TextEncoder();
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compareMakerV8ProtocolText).map(key => [key, canonical(value[key])]));
  return Object.is(value, -0) ? 0 : value;
}
async function sha(value) { return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', value))]; }
async function payload(value) { return sha(encoder.encode(JSON.stringify(canonical(value)))); }
const hex = value => value.map(byte => byte.toString(16).padStart(2, '0')).join('');
function hashBytes(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('MAKER_V8_BASE_ASSET_HASH_INVALID', `${label} must be a certified 32-byte lowercase SHA-256.`);
  return value.match(/../g).map(byte => parseInt(byte, 16));
}
function u64(value, label) {
  if (!(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    && !(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) fail('MAKER_V8_BASE_INTEGER_INVALID', `${label} must be an unsigned integer.`);
  const result = BigInt(value);
  if (result > 0xffffffffffffffffn) fail('MAKER_V8_BASE_INTEGER_INVALID', `${label} exceeds u64.`);
  return result;
}
function fixed(value, multiplier, maximum, label) {
  const scaled = Math.round(value * multiplier);
  if (!Number.isFinite(value) || value < 0 || value > maximum || !Number.isSafeInteger(scaled) || scaled / multiplier !== value) {
    fail('MAKER_V8_BASE_FIXED_PRECISION_UNSUPPORTED', `${label} is not exactly representable by the current fixed-point schema.`);
  }
  return BigInt(scaled);
}
function signed(value, maximum, label) {
  const magnitude = fixed(Math.abs(value), 1000, maximum, label);
  return { negative: magnitude !== 0n && value < 0, magnitude };
}
const order = field => (a, b) => a[field] - b[field] || compareMakerV8ProtocolText(a.key, b.key);
const sorted = (values, compare) => [...values].sort(compare);
const rgba = value => parseInt(value.slice(1), 16);
async function visibility(level, partKey, itemKey = null, styleKey = null, condition = null, definitionSource = 1, definitionSourceKey = null) {
  const tokens = makerV8VisibilityTokens(condition).map(token => ({ ...token, selector: token.selector === null ? null : {
    source: { ANY: 0, BASE: 1, PACK: 2, EXTERNAL: 3 }[token.selector.source],
    source_key: token.selector.sourceKey, part_key: token.selector.partKey,
    item_key: token.selector.itemKey, style_key: token.selector.styleKey,
  } }));
  return { visibility_tokens: tokens, visibility_commitment: await sha(VisibilityInput.serialize({ domain: 'animacraft-fresh-v8/core/visibility-program/v1', schema_revision: 1, definition_source: definitionSource, definition_source_key: definitionSourceKey, subject_level: level, part_key: partKey, item_key: itemKey, style_key: styleKey, tokens }).toBytes()) };
}
export const compileMakerV8VisibilityV1 = visibility;

const publicParts = document => sorted(document.parts, order('menuOrder')).map(part => ({ ...part, items: sorted(part.items.filter(item => item.status === 'PUBLIC'), order('displayOrder')).map(item => ({ ...item, styles: sorted(item.styles, order('displayOrder')) })) }));

/** Core definition values only: author drafts require no media transport certification. */
export async function compileMakerV8CoreDefinitionRowsV2(document, { definitionSource = 1, definitionSourceKey = null } = {}) {
  assertMakerV8Document(document, { mode: 'draft' });
  if (!((definitionSource === 1 && definitionSourceKey === null)
    || (definitionSource === 2 && typeof definitionSourceKey === 'string'
      && /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(definitionSourceKey)))) {
    fail('MAKER_V8_DEFINITION_SOURCE_INVALID', 'Definition source must be Base/null or Pack with a safe semantic Pack key.');
  }
  return compileCoreDefinitions(document, publicParts(document), definitionSource, definitionSourceKey);
}

async function compileCoreDefinitions(document, parts, definitionSource = 1, definitionSourceKey = null) {
  const rows = { track: [], color: [], part: [] };
  const tracks = sorted(document.tracks, order('renderOrder'));
  for (const track of tracks) rows.track.push({ sequence: BigInt(rows.track.length), key: track.key, label: track.label, render_order: u64(track.renderOrder, 'Track.renderOrder'), locked: track.locked });
  for (const channel of sorted(document.colors, (a, b) => compareMakerV8ProtocolText(a.key, b.key))) {
    const swatches = sorted(channel.swatches, (a, b) => compareMakerV8ProtocolText(a.key, b.key)).map(swatch => {
      // Match the renderer's stable offset ordering, retaining every equal-offset node.
      const stops = [...swatch.stops].sort((a, b) => a.offset - b.offset)
        .map(stop => ({ offset_ppm: fixed(stop.offset, 1e6, 1, 'ColorStop.offset'), rgba: rgba(stop.rgba) }));
      return { key: swatch.key, label: swatch.label, rgba: rgba(swatch.rgba), stops };
    });
    rows.color.push({ sequence: BigInt(rows.color.length), key: channel.key, label: channel.label, default_swatch_key: channel.defaultSwatchKey, swatches });
  }
  for (const part of parts) {
    const usedTracks = new Set(part.items.flatMap(item => item.styles.map(style => style.trackKey)));
    const trackKeys = tracks.filter(track => usedTracks.has(track.key)).map(track => track.key);
    rows.part.push({ sequence: BigInt(rows.part.length), key: part.key, label: part.label, kind: { STANDARD: 0, LEFT_RIGHT_PAIR: 1, LAST_BASTION: 2 }[part.kind], render_order: u64(part.renderOrder, 'Part.renderOrder'), menu_order: u64(part.menuOrder, 'Part.menuOrder'), visible: part.visible, required: part.required, slot_mode: part.wardrobeMode === 'FIXED' ? 0 : 1, capacity: u64(part.capacity, 'Part.capacity'), track_keys: trackKeys, ...await visibility(0, part.key, null, null, null, definitionSource, definitionSourceKey), payload_commitment: await payload({ schemaVersion: 'animacraft.maker-v8-part-payload.v2', menuOrder: part.menuOrder, wardrobeMode: part.wardrobeMode, capacity: part.capacity, payload: part.payload }) });
  }
  return rows;
}

/** Pure projection of a validated author document plus already-certified transport facts.
 * Certification belongs to the caller; this function never manufactures transport evidence.
 * Rules remain separately compiled. Counts here count channels, not individual swatches.
 */
export async function compileMakerV8BaseRowsV2(document, certifiedAssets) {
  assertMakerV8Document(document, { mode: 'compile' });
  const parts = publicParts(document);
  const rows = { ...await compileCoreDefinitions(document, parts), item: [], style: [], asset: [] };
  const referencedAssets = new Set();
  for (const part of parts) {
    for (const item of part.items) {
      rows.item.push({ sequence: BigInt(rows.item.length), part_key: part.key, item_key: item.key, label: item.label, status: 0, display_order: u64(item.displayOrder, 'Item.displayOrder'), default_style_key: item.defaultStyleKey, ...await visibility(1, part.key, item.key), payload_commitment: await payload({ schemaVersion: 'animacraft.maker-v8-item-payload.v2', displayOrder: item.displayOrder, defaultStyleKey: item.defaultStyleKey, payload: item.payload }) });
      for (const style of item.styles) {
        const asset = document.assets.find(entry => entry.id === style.assetId);
        const transport = certifiedAssets?.[style.assetId];
        if (!transport) fail('MAKER_V8_CERTIFIED_ASSET_MISSING', `Certified bytes are missing for ${style.assetId}.`);
        if ((!style.protected && (String(asset.byteLength) !== String(transport.byteLength) || asset.mediaType !== transport.mediaType)) || (style.protected && transport.mediaType !== 'application/vnd.animacraft.seal-ciphertext')) fail('MAKER_V8_CERTIFIED_ASSET_METADATA_MISMATCH', `Asset ${style.assetId} has mismatched public/protected transport metadata.`);
        if (typeof transport.blobId !== 'string' || !transport.blobId || encoder.encode(transport.blobId).length > 512) fail('MAKER_V8_BASE_ASSET_BLOB_INVALID', 'Asset requires its real bounded certified blob ID.');
        referencedAssets.add(style.assetId);
        const policy = style.physical;
        const physical = policy === null ? null : { material: policy.material, issuance: { FREE_CLAIM: 0, PAID_PURCHASE: 1, PROOF_MATERIALIZE: 2 }[policy.issuance], proof: { NONE: 0, CANONICAL_SOUL: 1 }[policy.proof], price_atomic: u64(policy.priceAtomic, 'Physical.priceAtomic'), max_supply: u64(policy.maxSupply, 'Physical.maxSupply'), transferable: policy.transferable };
        const stylePayload = await payload({ schemaVersion: 'animacraft.maker-v8-style-payload.v2', assetId: style.assetId, assetKind: asset.kind, transform: style.transform, opacity: style.opacity, blendMode: style.blendMode, physical: style.physical, payload: style.payload });
        rows.style.push({ sequence: BigInt(rows.style.length), part_key: part.key, item_key: item.key, style_key: style.key, label: style.label, display_order: u64(style.displayOrder, 'Style.displayOrder'), track_key: style.trackKey, color_channel_key: style.colorChannelKey, default_swatch_key: style.defaultSwatchKey, asset_id: style.assetId, asset_blob_id: transport.blobId, asset_sha256: hashBytes(transport.sha256, 'Style asset'), protected: style.protected, transform: { x_milli: signed(style.transform.x, 8192, 'Transform.x'), y_milli: signed(style.transform.y, 8192, 'Transform.y'), scale_ppm: fixed(style.transform.scale, 1e6, 100, 'Transform.scale'), rotation_millidegrees: signed(style.transform.rotation, 360, 'Transform.rotation') }, opacity_ppm: fixed(style.opacity, 1e6, 1, 'Style.opacity'), blend_mode: MAKER_V8_BLEND_CODES[style.blendMode], physical, ...await visibility(2, part.key, item.key, style.key, style.visibleWhen), payload_commitment: stylePayload, source: { style, transport, payload: hex(stylePayload) } });
      }
    }
  }
  if (document.commerce.rightsOrigin === 'LICENSE_WRAPPED' && document.commerce.rightsEvidence?.evidenceAssetId) referencedAssets.add(document.commerce.rightsEvidence.evidenceAssetId);
  for (const asset of sorted(document.assets.filter(asset => referencedAssets.has(asset.id)), (a, b) => compareMakerV8ProtocolText(a.id, b.id))) {
    const transport = certifiedAssets?.[asset.id];
    if (!transport) fail('MAKER_V8_CERTIFIED_ASSET_MISSING', `Certified bytes are missing for ${asset.id}.`);
    const byteLength = u64(transport.byteLength, 'Asset.byteLength');
    if (byteLength === 0n || byteLength > 8n * 1024n * 1024n) fail('MAKER_V8_BASE_ASSET_SIZE_INVALID', 'Asset transport exceeds the Core byte bound.');
    rows.asset.push({ sequence: BigInt(rows.asset.length), asset_id: asset.id, kind: asset.kind, media_type: transport.mediaType, byte_length: byteLength, sha256: hashBytes(transport.sha256, 'Asset') });
  }
  const counts = Object.fromEntries(Object.entries(rows).map(([kind, values]) => [`${kind}s`, BigInt(values.length)]));
  return { parts, rows, counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0n) };
}

/** Build actual nested Move values; no serialized struct is passed as a pure blob. */
export function buildMakerV8VisibilityProgramCommandsV1(tx, { corePackageId, tokens }) {
  const selectors = tokens.filter(token => token.opcode === 0).map(token => token.selector);
  return tx.moveCall({ target: `${normalizeSuiAddress(corePackageId)}::base_registry_v8::new_visibility_program_v1`, arguments: [
    tx.pure.vector('u8', tokens.map(token => token.opcode)),
    tx.pure.vector('u16', tokens.map(token => token.arity)),
    tx.pure.vector('u8', selectors.map(selector => selector.source)),
    tx.pure(bcs.vector(textOption).serialize(selectors.map(selector => selector.source_key))),
    tx.pure.vector('string', selectors.map(selector => selector.part_key)),
    tx.pure(bcs.vector(textOption).serialize(selectors.map(selector => selector.item_key))),
    tx.pure(bcs.vector(textOption).serialize(selectors.map(selector => selector.style_key))),
  ] });
}

export function buildMakerV8CoreRowCommandsV2(tx, { corePackageId, coreOriginalPackageId, kind, row }) {
  if (!Object.hasOwn(MAKER_V8_BASE_ROW_BCS_V2, kind)) fail('MAKER_V8_BASE_CATEGORY_INVALID', `Unsupported Base row category ${kind}.`);
  const module = `${normalizeSuiAddress(corePackageId)}::base_registry_v8`;
  const type = name => `${normalizeSuiAddress(coreOriginalPackageId)}::base_registry_v8::${name}`;
  const call = (name, args) => tx.moveCall({ target: `${module}::${name}`, arguments: args });
  const s = value => tx.pure.string(value);
  const u = value => tx.pure.u64(value);
  const v = value => tx.pure.vector('u8', value);
  const o = value => tx.pure.option('string', value);
  const vec = (name, elements) => tx.makeMoveVec({ type: type(name), elements });
  const signedValue = value => call('new_signed_milli_v1', [tx.pure.bool(value.negative), u(value.magnitude)]);
  const visibilityArgs = () => {
    const program = buildMakerV8VisibilityProgramCommandsV1(tx, { corePackageId, tokens: row.visibility_tokens });
    return [program, v(row.visibility_commitment), v(row.payload_commitment)];
  };
  let args;
  if (kind === 'track') args = [u(row.sequence), s(row.key), s(row.label), u(row.render_order), tx.pure.bool(row.locked)];
  if (kind === 'color') {
    const swatches = row.swatches.map(swatch => call('new_color_swatch_v2', [s(swatch.key), s(swatch.label), tx.pure.u32(swatch.rgba), vec('ColorStopV2', swatch.stops.map(stop => call('new_color_stop_v2', [u(stop.offset_ppm), tx.pure.u32(stop.rgba)])))]));
    args = [u(row.sequence), s(row.key), s(row.label), s(row.default_swatch_key), vec('ColorSwatchV2', swatches)];
  }
  if (kind === 'part') args = [u(row.sequence), s(row.key), s(row.label), tx.pure.u8(row.kind), u(row.render_order), u(row.menu_order), tx.pure.bool(row.visible), tx.pure.bool(row.required), tx.pure.u8(row.slot_mode), u(row.capacity), tx.pure.vector('string', row.track_keys), ...visibilityArgs()];
  if (kind === 'item') args = [u(row.sequence), s(row.part_key), s(row.item_key), s(row.label), tx.pure.u8(row.status), u(row.display_order), s(row.default_style_key), ...visibilityArgs()];
  if (kind === 'style') {
    const t = row.transform;
    const transform = call('new_transform_fixed_v1', [signedValue(t.x_milli), signedValue(t.y_milli), u(t.scale_ppm), signedValue(t.rotation_millidegrees)]);
    const p = row.physical;
    const physical = tx.moveCall({ target: `0x1::option::${p === null ? 'none' : 'some'}`, typeArguments: [type('PhysicalPolicyV1')], arguments: p === null ? [] : [call('new_physical_policy_v1', [s(p.material), tx.pure.u8(p.issuance), tx.pure.u8(p.proof), u(p.price_atomic), u(p.max_supply), tx.pure.bool(p.transferable)])] });
    args = [u(row.sequence), s(row.part_key), s(row.item_key), s(row.style_key), s(row.label), u(row.display_order), s(row.track_key), o(row.color_channel_key), o(row.default_swatch_key), s(row.asset_id), s(row.asset_blob_id), v(row.asset_sha256), tx.pure.bool(row.protected), transform, u(row.opacity_ppm), tx.pure.u8(row.blend_mode), physical, ...visibilityArgs()];
  }
  if (kind === 'asset') args = [u(row.sequence), s(row.asset_id), s(row.kind), s(row.media_type), u(row.byte_length), v(row.sha256)];
  const name = kind === 'color' ? 'color_channel' : kind;
  return call(`new_${name}_row_v2`, args);
}

export function appendMakerV8BaseRowCommandsV2(tx, { corePackageId, coreOriginalPackageId, paymentCoinType, registry, root, admin, kind, row }) {
  const result = buildMakerV8CoreRowCommandsV2(tx, { corePackageId, coreOriginalPackageId, kind, row });
  const module = `${normalizeSuiAddress(corePackageId)}::base_registry_v8`;
  return tx.moveCall({ target: `${module}::append_${kind}_v2`, typeArguments: [paymentCoinType], arguments: [registry, root, admin, result] });
}
