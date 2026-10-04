import { bcs } from '@mysten/sui/bcs';
import { RuntimeEmpty, RuntimeProfile } from './maker-v8-profile-wire.js';
import { SemanticSelector, RuleRow } from './maker-v8-rule-wire.js';
import { isMakerV8SourceAssetHash, isMakerV8SourceAssetField, assertMakerV8PublishedSources } from './maker-v8-source-asset.js';
import { deriveMakerV8ProtocolConfigCommitment } from './maker-v8-protocol-commitment.js';
import { deriveMakerV8SealKeyServerSetCommitment, deriveMakerV8SealPolicyCommitment } from './maker-v8-seal-policy-commitments.js';
import { MAKER_V8_SEAL_ID_BCS_V2 as SealIdInput, MAKER_V8_SEAL_CERTIFICATION_BCS_V2 as CipherInput, MAKER_V8_SEAL_READBACK_FIELDS_V2, deriveMakerV8SealStorageV2 } from './maker-v8-seal-compiler.js';
import { compileMakerV8LivingContentV8, deriveMakerV8LivingContentBindingV8 } from './maker-v8-living-content-compiler.js';
import { validateMakerV8ActivationAuthorityV8 } from './maker-v8-activation-authority.js';
import { assertMakerV8WalrusExecutionV1, MAKER_V8_WALRUS_MINIMUM_DEPENDENCY } from './maker-v8-walrus-execution.js';
import { compileMakerV8BaseRowsV2, appendMakerV8BaseRowCommandsV2, MAKER_V8_BASE_ROW_BCS_V2 } from './maker-v8-base-rows.js';
import { deriveMakerV8BaseAuthorCommitmentV2, deriveMakerV8BaseStorageCommitmentsV2, MAKER_V8_BASE_CATEGORIES_V2 } from './maker-v8-base-commitments.js';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase58, toBase58, fromBase64 } from '@mysten/sui/utils';
import {
  MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
} from './maker-v8-chain.js';
import { MAKER_V8_PAYMENT_COIN_TYPE } from './maker-v8-runtime.js';
import { MAKER_V8_RULE_FIELDS, MAKER_V8_RULE_SELECTOR_FIELDS, validateMakerV8Rule } from './maker-v8-rules.js';
import {
  assertMakerV8Document,
  compareMakerV8ProtocolText,
  MAKER_V8_DOCUMENT_LIMITS,
  projectPublicMakerV8Document,
} from './maker-v8-document.js';

export const MAKER_V8_COMPILER_SCHEMA = 'animacraft.maker-v8-compiler.v2';
export const MAKER_V8_TRUSTED_CONTEXT_SCHEMA = 'animacraft.maker-v8-trusted-context.v1';
export const MAKER_V8_SUCCESSOR_PREDECESSOR_SCHEMA =
  'animacraft.maker-v8-successor-predecessor.v1';
export const MAKER_V8_SCAFFOLD_READBACK_SCHEMA = 'animacraft.maker-v8-scaffold-readback.v1';
export const MAKER_V8_BASE_READBACK_SCHEMA = 'animacraft.maker-v8-base-readback.v1';
export const MAKER_V8_COMPANION_READBACK_SCHEMA = 'animacraft.maker-v8-companion-readback.v1';
export const MAKER_V8_BASE_CHUNK_READBACK_SCHEMA = 'animacraft.maker-v8-base-chunk-readback.v1';
export const MAKER_V8_ACTIVATION_CHUNK_READBACK_SCHEMA = 'animacraft.maker-v8-activation-chunk-readback.v1';
export const MAKER_V8_ACTIVATION_READBACK_SCHEMA = 'animacraft.maker-v8-activation-readback.v1';
export const MAKER_V8_COMMITMENT_FIXTURE_SCHEMA = 'animacraft.maker-v8-compiler-fixture.v2';
export const MAKER_V8_ROLE_ORDER = Object.freeze(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']);
export const MAKER_V8_REQUIRED_CAPABILITIES = 127n;
export const MAKER_V8_ROOT_CATEGORIES = Object.freeze({ TRACK: 0, COLOR: 1, PART: 2, ITEM: 3, STYLE: 4, RULE: 5, ASSET: 6, AGGREGATE: 255 });
// The command/input/kind ceilings are compiler budgets. The pure-input limit
// matches the pinned protocol-137 evidence's max_pure_argument_size.
export const MAKER_V8_TRANSACTION_LIMITS = Object.freeze({ maxKindBytes: 96 * 1024, maxCommands: 64, maxInputs: 256, maxRowsPerChunk: 16, maxPureArgumentBytes: 16 * 1024 });
export const MAKER_V8_BYTE_BUDGETS = Object.freeze({ maxDocumentUtf8Bytes: 8 * 1024 * 1024, maxManifestBytes: 12 * 1024 * 1024, maxAssetBytes: 8 * 1024 * 1024, maxTotalAssetBytes: 32 * 1024 * 1024, maxTransportBase64Chars: 48 * 1024 * 1024, maxTransactionDataBytes: 128 * 1024 });
export const MAKER_V8_PUBLICATION_TOPOLOGY = Object.freeze({
  scaffold: Object.freeze({
    kind: 'SCAFFOLD', phase: 'SCAFFOLD', lane: 'SCAFFOLD', action: 'CREATE',
    checkpointSchema: 'animacraft.maker-v8-scaffold-checkpoint.v1',
  }),
  base: Object.freeze({
    kind: 'BASE_CHUNK', lane: 'BASE', checkpointSchema: 'animacraft.maker-v8-base-checkpoint.v1',
    phases: Object.freeze(['BASE_APPEND', 'BASE_SEAL']),
  }),
  companion: Object.freeze({
    kind: 'COMPANION_OBJECTS', phase: 'COMPANION_OBJECTS', lane: 'COMPANION', action: 'CREATE',
    checkpointSchema: 'animacraft.maker-v8-companion-checkpoint.v1',
  }),
  activation: Object.freeze({
    kind: 'ACTIVATION_CHUNK', checkpointSchema: 'animacraft.maker-v8-activation-checkpoint.v1',
    phases: Object.freeze([
      'ACTIVATION_SEAL_APPEND', 'ACTIVATION_SEAL_SEAL',
      'ACTIVATION_RUNTIME_APPEND', 'ACTIVATION_RUNTIME_SEAL',
      'ACTIVATION_OUTPUT_APPEND', 'ACTIVATION_OUTPUT_SEAL',
      'ACTIVATION_PHYSICAL_APPEND', 'ACTIVATION_PHYSICAL_SEAL',
      'ACTIVATION_FINALIZE',
    ]),
  }),
});
export const MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE = Object.freeze({
  protocolVersion: '137',
  objectRuntimeMaxNumCachedObjects: '1000',
  objectRuntimeMaxNumStoreEntries: '1000',
});
export const MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE_COMMITMENT = 'bf6c019eae80bac3824e07fad65b2f983f5e74e69d0b6c46779078c752738fa7';

const VERSION = 8n;
const U64_MAX = (1n << 64n) - 1n;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^0x[0-9a-fA-F]{1,64}$/;
const KEY = /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const encoder = new TextEncoder();
const trustedSet = new WeakSet();
const predecessorSet = new WeakSet();
const compiledSet = new WeakSet();
const scaffoldSet = new WeakSet();
const baseSet = new WeakSet();
const companionSet = new WeakSet();
const activationSet = new WeakSet();
const publicationProgress = new WeakMap();
const scaffoldProgress = new WeakMap();
const baseChunkBuilds = new WeakMap();
const baseChunkCertificates = new WeakMap();
const activationChunkBuilds = new WeakMap();
const activationChunkCertificates = new WeakMap();

const MARKERS = Object.freeze({
  core: ['protocol_config_v8', 'CorePackageMarkerV8', 'CorePackageMarkerV8'],
  seal: ['seal_v8', 'SealOriginalMarkerV8', 'SealCallableMarkerV8'],
  runtime: ['runtime_v8', 'RuntimeOriginalMarkerV8', 'RuntimeCallableMarkerV8'],
  output: ['output_v8', 'OutputOriginalMarkerV8', 'OutputCallableMarkerV8'],
  physical: ['physical_v8', 'PhysicalOriginalMarkerV8', 'PhysicalCallableMarkerV8'],
  market: ['market_v8', 'MarketOriginalMarkerV8', 'MarketCallableMarkerV8'],
  release: ['release_v8', 'ReleaseOriginalMarkerV8', 'ReleaseCallableMarkerV8'],
});
export const MAKER_V8_PUBLICATION_COMPILER_ABI = Object.freeze({
  core: Object.freeze([
    'base_registry_v8::append_track_v2', 'base_registry_v8::append_part_v2',
    'base_registry_v8::append_item_v2', 'base_registry_v8::append_style_v2',
    'base_registry_v8::append_color_v2', 'base_registry_v8::append_asset_v2', 'base_registry_v8::append_rule_v2',
    'base_registry_v8::new_track_row_v2', 'base_registry_v8::new_color_channel_row_v2',
    'base_registry_v8::new_part_row_v2', 'base_registry_v8::new_item_row_v2',
    'base_registry_v8::new_style_row_v2', 'base_registry_v8::new_asset_row_v2',
    'base_registry_v8::new_color_stop_v2', 'base_registry_v8::new_color_swatch_v2',
    'base_registry_v8::new_signed_milli_v1', 'base_registry_v8::new_transform_fixed_v1',
    'base_registry_v8::new_physical_policy_v1',
    'base_registry_v8::new_semantic_selector_v2', 'base_registry_v8::new_visibility_program_v1', 'base_registry_v8::new_rule_row_v2',
    'base_registry_v8::new_base_definition_counts_v8',
    'base_registry_v8::seal_base_definition_registry_v8',
    'maker_v8::issue_successor_authority_v8',
    'core_v8::new_initial_maker_draft_v8', 'core_v8::new_successor_maker_draft_v8',
    'core_v8::share_maker_draft_v8',
    'core_v8::new_living_content_binding_v8', 'core_v8::certify_walrus_living_content_v1',
    'core_v8::finish_maker_companion_binding_v2', 'core_v8::freeze_certified_living_content_v1',
    'maker_v8::new_economics_snapshot_v8', 'maker_v8::new_onchain_native_rights_snapshot_v8',
  ]),
  seal: Object.freeze([
    'seal_v8::append_protected_asset_v8', 'seal_v8::new_seal_registry_v8',
    'seal_v8::seal_registry_v8', 'seal_v8::share_seal_registry_v8',
  ]),
  runtime: Object.freeze([
    'runtime_v8::append_part_profile_v8', 'runtime_v8::new_runtime_registries_v8',
    'runtime_v8::seal_runtime_definitions_v8',
    'runtime_v8::share_pack_registry_v8', 'runtime_v8::share_runtime_definition_registry_v8',
    'runtime_v8::transfer_pack_admission_authority_v8',
  ]),
  output: Object.freeze([
    'output_v8::append_output_policy_v8',
    'output_v8::new_output_registries_v8', 'output_v8::seal_output_registry_v8',
    'output_v8::share_output_registries_v8',
  ]),
  physical: Object.freeze([
    'physical_v8::append_base_style_policy_v8',
    'physical_v8::new_physical_registry_v8', 'physical_v8::seal_physical_registry_v8',
    'physical_v8::share_physical_registry_v8',
  ]),
  market: Object.freeze([
    'market_v8::bind_maker_market_companion_v2', 'market_v8::new_market_objects_v8',
    'market_v8::seal_market_registry_v8', 'market_v8::share_market_registry_v8',
    'market_v8::share_market_treasury_v8',
  ]),
  release: Object.freeze([
    'release_v8::certify_base_ciphertext_v8', 'release_v8::finalize_product_release_binding_v8',
    'release_v8::new_license_wrapped_rights_snapshot_v8', 'release_v8::seal_and_activate_maker_v8',
    'release_v8::prepare_maker_companion_binding_v2',
  ]),
});
const FIELDS = Object.freeze({
  document: ['schemaVersion', 'protocolVersion', 'lineage', 'metadata', 'canvas', 'composition', 'tracks', 'colors', 'parts', 'rules', 'defaultRecipe', 'outputs', 'commerce', 'assets', 'livingContent'],
  lineage: ['makerKey', 'version', 'previousRootId', 'previousVersionCommitment', 'changelog'], metadata: ['name', 'summary', 'license', 'coverAssetId'], license: ['kind', 'note'], canvas: ['width', 'height', 'pixelMode'], composition: ['mode', 'thirdPartyAdmission', 'itemAssetization'],
  track: ['key', 'label', 'renderOrder', 'locked'], color: ['key', 'label', 'defaultSwatchKey', 'swatches'], swatch: ['key', 'label', 'rgba', 'stops'], stop: ['offset', 'rgba'],
  part: ['key', 'label', 'kind', 'renderOrder', 'menuOrder', 'visible', 'required', 'wardrobeMode', 'capacity', 'items', 'payload'], item: ['key', 'label', 'status', 'displayOrder', 'defaultStyleKey', 'styles', 'payload'],
  style: ['key', 'label', 'displayOrder', 'trackKey', 'colorChannelKey', 'defaultSwatchKey', 'assetId', 'protected', 'transform', 'opacity', 'blendMode', 'physical', 'payload'], transform: ['x', 'y', 'scale', 'rotation'], physical: ['material', 'issuance', 'proof', 'priceAtomic', 'maxSupply', 'transferable'],
  rule: MAKER_V8_RULE_FIELDS, ruleRef: MAKER_V8_RULE_SELECTOR_FIELDS, recipe: ['selections', 'colors'], selection: ['partKey', 'itemKey', 'styleKey'], recipeColor: ['channelKey', 'swatchKey'],
  output: ['key', 'label', 'protected', 'allowedPackPolicy', 'payload'], packPolicy: ['kind', 'packIds'], asset: ['id', 'kind', 'mediaType', 'byteLength'],
  commerce: ['schemaVersion', 'rightsOrigin', 'rightsOriginConfirmed', 'rightsEvidence', 'makerAccess', 'baseCompletion', 'soulCreatorRoyaltyBps', 'makerSourceRoyaltyBps', 'makerResaleRoyaltyBps'], rightsEvidence: ['licensor', 'evidenceAssetId'], makerAccess: ['mode', 'purchasePriceAtomic'], completion: ['mode', 'freeQuotaPerWallet', 'priceAtomic', 'totalCap'],
});

const BV = bcs.byteVector();
const OBytes = bcs.option(BV);
const OId = bcs.option(bcs.Address);
const OString = bcs.option(bcs.string());
export const MAKER_V8_RULE_ROW_BCS_V2 = RuleRow;
const SelectorCommitment = bcs.struct('SemanticSelectorCommitmentInputV2', { domain: bcs.string(), schema_revision: bcs.u64(), selector: SemanticSelector });
const RuleCommitment = bcs.struct('RuleRowCommitmentInputV2', { domain: bcs.string(), schema_revision: bcs.u64(), definition_source: bcs.u8(), definition_source_key: OString, sequence: bcs.u64(), key: bcs.string(), kind: bcs.u8(), trigger_selector_commitment: BV, target_mode: bcs.u8(), ordered_target_selector_commitments: bcs.vector(BV), payload_commitment: BV });
const Rows = Object.freeze({ ...MAKER_V8_BASE_ROW_BCS_V2, rule: RuleRow });
const EconomicsInput = bcs.struct('EconomicsCommitmentInputV8', { domain: BV, version: bcs.u64(), protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), protocol_config_commitment: BV, protocol_treasury_id: bcs.Address, payment_coin_type: bcs.string(), maker_access: bcs.u8(), maker_price_atomic: bcs.u64(), complete_mode: bcs.u8(), complete_price_atomic: bcs.u64(), complete_per_wallet_quota: bcs.u64(), complete_total_cap: bcs.u64(), primary_content_fee_bps: bcs.u16(), fixed_complete_fee_atomic: bcs.u64(), maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16() });
const RightsInput = bcs.struct('RightsCommitmentInputV8', { domain: BV, version: bcs.u64(), origin: bcs.u8(), creator: bcs.Address, creator_confirmed: bcs.bool(), evidence_certified: bcs.bool(), certification_catalog_id: OId, certification_binding_commitment: OBytes, evidence_locator: bcs.string(), evidence_blob_id: bcs.string(), evidence_sha256: BV, terms_commitment: BV, soul_creator_royalty_bps: bcs.u16(), maker_source_royalty_bps: bcs.u16(), maker_resale_royalty_bps: bcs.u16() });
const VersionInput = bcs.struct('VersionCommitmentInputV8', { domain: BV, version: bcs.u64(), core_original_package_id: bcs.Address, protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), protocol_config_commitment: BV, maker_key: bcs.string(), maker_version: bcs.u64(), previous_root_id: OId, previous_version_commitment: OBytes, maker_document_commitment: BV, creator_defaults_commitment: BV, living_content_binding_commitment: BV, renderer_commitment: BV, manifest_blob_id: bcs.string(), manifest_sha256: BV, content_commitment: BV, expected_base_definition_count: bcs.u64(), expected_base_registry_commitment: BV, expected_pack_admission_policy_commitment: BV, economics_commitment: BV, rights_commitment: BV });
const ReleaseHeader = { domain: bcs.string(), schema_revision: bcs.u64() };
const ExactInput = bcs.struct('ExactPackageBindingInputV2', { ...ReleaseHeader, role: bcs.u8(), original_package_id: bcs.Address, callable_package_id: bcs.Address, source_commitment: BV, package_commitment: BV, abi_commitment: BV });
const ProductInput = bcs.struct('PackageTupleInputV2', { ...ReleaseHeader, catalog_id: bcs.Address, native_capability_mask: bcs.u64(), call_cap_set_commitment: BV, ...Object.fromEntries(MAKER_V8_ROLE_ORDER.map(role => [`${role}_binding`, BV])) });
const CapInput = bcs.struct('PackageCallCapSetCommitmentInputV2', { ...ReleaseHeader, catalog_id: bcs.Address, ...Object.fromEntries(MAKER_V8_ROLE_ORDER.map(role => [`${role}_binding_commitment`, BV])), ...Object.fromEntries(MAKER_V8_ROLE_ORDER.slice(1).map(role => [`${role}_authority_id`, bcs.Address])) });
const RuntimePolicy = bcs.struct('RuntimePolicyCommitmentInputV8', { domain: BV, version: bcs.u64(), root_content_commitment: BV, profile_count: bcs.u64(), profile_commitment: BV, admission_ceiling: bcs.u8(), item_assetization: bcs.bool() });
const OutputEmpty = bcs.struct('OutputRegistryEmptyCommitmentInputV8', { domain: BV, version: bcs.u64(), root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, renderer_commitment: BV });
const OutputRowInput = bcs.struct('OutputPolicyRowCommitmentInputV8', { domain: BV, version: bcs.u64(), root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, renderer_commitment: BV, economics_commitment: BV, sequence: bcs.u64(), output_key: bcs.string(), protected_output: bcs.bool(), complete_scope_key: bcs.string(), allowed_pack_policy: bcs.u8(), allowed_semantic_pack_ids: bcs.vector(bcs.string()), renderer_schema_commitment: BV });
const OutputAdvance = bcs.struct('OutputRegistryAdvanceCommitmentInputV8', { domain: BV, version: bcs.u64(), root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, sequence: bcs.u64(), prior_commitment: BV, row_commitment: BV });
const StyleIdentity = bcs.struct('BaseStyleIdentityInputV8', { domain: BV, version: bcs.u64(), root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, base_registry_id: bcs.Address, part_key: bcs.string(), item_key: bcs.string(), style_key: bcs.string(), layer_track_key: bcs.string(), color_channel_key: OString, default_swatch_key: OString, asset_blob_id: bcs.string(), asset_sha256: BV, protected: bcs.bool(), payload_commitment: BV });
const PhysicalEmpty = bcs.struct('EmptyBasePolicyCommitmentInputV8', { domain: BV, version: bcs.u64(), product_binding_commitment: BV, root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, base_registry_id: bcs.Address });
const PhysicalRowInput = bcs.struct('BasePolicyRowCommitmentInputV8', { domain: BV, version: bcs.u64(), product_binding_commitment: BV, root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, base_registry_id: bcs.Address, sequence: bcs.u64(), style_identity_commitment: BV, material_policy_commitment: BV, issuance_kind: bcs.u8(), proof_kind: bcs.u8(), price_atomic: bcs.u64(), max_supply: bcs.u64(), transferable: bcs.bool() });
const PhysicalAdvance = bcs.struct('BasePolicyAdvanceCommitmentInputV8', { domain: BV, version: bcs.u64(), root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, sequence: bcs.u64(), prior_commitment: BV, row_commitment: BV });
const MarketZero = bcs.struct('MarketZeroStateCommitmentInputV8', { domain: BV, version: bcs.u64(), catalog_id: bcs.Address, package_config_id: bcs.Address, product_binding_commitment: BV, call_cap_set_commitment: BV, root_id: bcs.Address, maker_version: bcs.u64(), root_content_commitment: BV, protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), protocol_config_commitment: BV, economics_commitment: BV, rights_commitment: BV, maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16(), soul_creator_royalty_bps: bcs.u16(), maker_source_royalty_bps: bcs.u16(), maker_resale_royalty_bps: bcs.u16(), treasury_id: bcs.Address });

export class MakerV8CompilerError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'MakerV8CompilerError'; this.code = code; this.details = Object.freeze({ ...details }); }
}
function fail(code, message, details) { throw new MakerV8CompilerError(code, message, details); }
function plain(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const p = Object.getPrototypeOf(value); return p === Object.prototype || p === null; }
function exact(value, fields, path, optionalFields = []) { if (!plain(value)) fail('MAKER_V8_RECORD_INVALID', `${path} must be a plain record.`); const allowed = new Set([...fields, ...optionalFields]); const unknown = Object.keys(value).filter((key) => !allowed.has(key)); const missing = fields.filter((key) => !Object.hasOwn(value, key)); if (unknown.length || missing.length) fail('MAKER_V8_FIELDS_INVALID', `${path} has an invalid exact shape.`, { path, unknown, missing }); }
function snapshot(value, label) { const seen = new WeakSet(); const stack = [{ value, path: label, depth: 0 }]; let nodes = 0; while (stack.length) { const current = stack.pop(); nodes += 1; if (nodes > 1_000_000 || current.depth > 64) fail('MAKER_V8_INPUT_LIMIT', `${label} exceeds the JSON limit.`); const item = current.value; if (item === null || typeof item === 'string' || typeof item === 'boolean') continue; if (typeof item === 'number') { if (!Number.isFinite(item)) fail('MAKER_V8_NUMBER_INVALID', `${current.path} must be finite.`); continue; } if (!item || typeof item !== 'object' || typeof item === 'bigint') fail('MAKER_V8_JSON_INVALID', `${current.path} is not JSON.`); if (seen.has(item)) fail('MAKER_V8_JSON_GRAPH_INVALID', `${label} must be a tree.`); seen.add(item); const array = Array.isArray(item); const proto = Object.getPrototypeOf(item); if ((array && proto !== Array.prototype) || (!array && proto !== Object.prototype && proto !== null)) fail('MAKER_V8_JSON_PROTOTYPE_INVALID', `${current.path} has a non-JSON prototype.`); const keys = Reflect.ownKeys(item); if (keys.some((key) => typeof key !== 'string')) fail('MAKER_V8_JSON_SYMBOL_INVALID', `${current.path} has symbol keys.`); if (array) { const allowed = new Set(['length']); for (let i = 0; i < item.length; i += 1) allowed.add(String(i)); if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) fail('MAKER_V8_ARRAY_INVALID', `${current.path} must be dense.`); } for (const key of keys) { if (array && key === 'length') continue; const d = Object.getOwnPropertyDescriptor(item, key); if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('MAKER_V8_PROPERTY_INVALID', `${current.path}.${key} is not a data property.`); stack.push({ value: d.value, path: array ? `${current.path}[${key}]` : `${current.path}.${key}`, depth: current.depth + 1 }); } } try { return structuredClone(value); } catch { fail('MAKER_V8_INPUT_UNREADABLE', `${label} could not be snapshotted.`); } }
function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
function normId(value, label = 'ID') { if (typeof value !== 'string' || !ID.test(value)) fail('MAKER_V8_SUI_ID_INVALID', `${label} is not a Sui ID.`); return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`; }
function normType(value, label = 'type') { if (typeof value !== 'string' || !value.includes('::')) fail('MAKER_V8_MOVE_TYPE_INVALID', `${label} is invalid.`); return value.replace(/0x[0-9a-fA-F]{1,64}/g, (id) => normId(id)); }
function hashHex(value, label = 'hash') { const result = typeof value === 'string' ? value.replace(/^0x/, '').toLowerCase() : ''; if (!HASH.test(result)) fail('MAKER_V8_HASH_INVALID', `${label} must be 32 bytes.`); return result; }
function suiDigest(value, label = 'digest') { let bytes; try { if (typeof value !== 'string') throw new Error('shape'); bytes = fromBase58(value); if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('canonical'); } catch { fail('MAKER_V8_CORE_ARTIFACT_UNMEASURED', `${label} must be one canonical 32-byte Sui digest.`); } return value; }
function fromHex(value, label) { const text = hashHex(value, label); return Object.freeze(Array.from({ length: 32 }, (_, i) => Number.parseInt(text.slice(i * 2, i * 2 + 2), 16))); }
function toHex(bytes) { return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function u64(value, label = 'u64') { const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : String(value ?? ''); if (!/^(?:0|[1-9][0-9]*)$/.test(text)) fail('MAKER_V8_U64_INVALID', `${label} is not canonical u64.`); const n = BigInt(text); if (n > U64_MAX) fail('MAKER_V8_U64_INVALID', `${label} exceeds u64.`); return n; }
function u16(value, label = 'u16') { const n = u64(value, label); if (n > 65535n) fail('MAKER_V8_U16_INVALID', `${label} exceeds u16.`); return Number(n); }
function domain(value) { return encoder.encode(value); }
async function sha(bytes) { return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)); }
async function hashBcs(type, value) { return toHex(await sha(type.serialize(value).toBytes())); }
function canonical(value) { if (value === null || typeof value === 'string' || typeof value === 'boolean') return value; if (typeof value === 'number') return Object.is(value, -0) ? 0 : value; if (Array.isArray(value)) return value.map(canonical); if (!plain(value)) fail('MAKER_V8_CANONICAL_INVALID', 'Canonical JSON accepts plain records.'); return Object.fromEntries(Object.keys(value).sort(compareMakerV8ProtocolText).map((key) => [key, canonical(value[key])])); }
export function canonicalMakerV8Json(value) { return JSON.stringify(canonical(snapshot(value, 'canonicalValue'))); }
async function hashJson(value) { return toHex(await sha(encoder.encode(canonicalMakerV8Json(value)))); }
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encodeBase64(bytes) {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset]; const hasB = offset + 1 < bytes.length; const hasC = offset + 2 < bytes.length; const b = hasB ? bytes[offset + 1] : 0; const c = hasC ? bytes[offset + 2] : 0;
    result += BASE64_ALPHABET[a >> 2]; result += BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)]; result += hasB ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)] : '='; result += hasC ? BASE64_ALPHABET[c & 63] : '=';
  }
  return result;
}
function bytes64(value, label) { if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) fail('MAKER_V8_BASE64_INVALID', `${label} is invalid.`); let raw; try { raw = atob(value); } catch { fail('MAKER_V8_BASE64_INVALID', `${label} is invalid.`); } const result = Uint8Array.from(raw, (char) => char.charCodeAt(0)); if (encodeBase64(result) !== value) fail('MAKER_V8_BASE64_INVALID', `${label} is not canonical.`); return result; }
function same(actual, expected, code, label) { if (actual !== expected) fail(code, `${label} does not match verified readback.`, { actual, expected }); }

const AUTHORITY_KEYS = new Set(['chainid', 'network', 'creator', 'owner', 'sender', 'signer', 'wallet', 'walletaddress', 'package', 'packageid', 'callablepackageid', 'typeorigin', 'objectid', 'rootid', 'makerrootid', 'catalogid', 'configid', 'registryid', 'treasuryid', 'admincapid', 'releaseid', 'listingid', 'soulid', 'outputid', 'receiptid', 'physicalassetid', 'blobid', 'manifestblobid', 'sha256', 'commitment', 'digest', 'signature', 'signedbytes', 'transactiondigest', 'receiving', 'receivingref', 'predecessorid']);
function inspectAuthorAuthority(value, path = '') {
  if (Array.isArray(value)) return value.forEach((entry, index) => inspectAuthorAuthority(entry, `${path}[${index}]`));
  if (!plain(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const nextPath = path ? `${path}.${key}` : key;
    if (key === 'animacraftSourceAsset' && !isMakerV8SourceAssetField(nextPath, entry)) fail('MAKER_V8_SOURCE_ASSET_MISMATCH', 'Invalid reserved Style source metadata.');
    const certifiedLineageField = nextPath === 'lineage.previousRootId'
      || nextPath === 'lineage.previousVersionCommitment';
    const displayCreatorField = nextPath === 'metadata.creator' || isMakerV8SourceAssetHash(nextPath, value);
    if (!certifiedLineageField && !displayCreatorField && (AUTHORITY_KEYS.has(normalized) || normalized.endsWith('commitment') || normalized.endsWith('sha256') || normalized.endsWith('digest') || normalized.endsWith('blobid') || normalized.includes('transactionbytes') || normalized.includes('packageid') || normalized.includes('typeorigin') || normalized.includes('receivingref'))) fail('MAKER_V8_AUTHOR_AUTHORITY_FORBIDDEN', `${nextPath} is compiler-owned authority.`);
    inspectAuthorAuthority(entry, nextPath);
  }
}
function exactDocumentShape(d) {
  exact(d, FIELDS.document, 'document'); exact(d.lineage, FIELDS.lineage, 'lineage'); exact(d.metadata, FIELDS.metadata, 'metadata', ['creator', 'style']); exact(d.metadata.license, FIELDS.license, 'metadata.license'); exact(d.canvas, FIELDS.canvas, 'canvas'); exact(d.composition, FIELDS.composition, 'composition');
  d.tracks.forEach((row, i) => exact(row, FIELDS.track, `tracks[${i}]`));
  d.colors.forEach((row, i) => { exact(row, FIELDS.color, `colors[${i}]`); row.swatches.forEach((swatch, j) => { exact(swatch, FIELDS.swatch, `colors[${i}].swatches[${j}]`); swatch.stops.forEach((stop, k) => exact(stop, FIELDS.stop, `colors[${i}].swatches[${j}].stops[${k}]`)); }); });
  d.parts.forEach((part, i) => { exact(part, FIELDS.part, `parts[${i}]`, ['exportBackground']); if (Object.hasOwn(part, 'exportBackground') && typeof part.exportBackground !== 'boolean') fail('MAKER_V8_EXPORT_BACKGROUND_INVALID', 'Export background must be boolean.'); part.items.forEach((item, j) => { exact(item, FIELDS.item, `parts[${i}].items[${j}]`); item.styles.forEach((style, k) => { exact(style, FIELDS.style, `parts[${i}].items[${j}].styles[${k}]`, ['visibleWhen']); exact(style.transform, FIELDS.transform, 'style.transform'); if (style.physical !== null) exact(style.physical, FIELDS.physical, 'style.physical'); }); }); });
  d.rules.forEach((row, i) => { exact(row, FIELDS.rule, `rules[${i}]`); exact(row.trigger, FIELDS.ruleRef, `rules[${i}].trigger`); if (!Array.isArray(row.targets)) fail('MAKER_V8_RULE_REFERENCE_INVALID', 'Rule targets must be an array.'); row.targets.forEach((selector, j) => exact(selector, FIELDS.ruleRef, `rules[${i}].targets[${j}]`)); }); exact(d.defaultRecipe, FIELDS.recipe, 'defaultRecipe'); d.defaultRecipe.selections.forEach((row) => exact(row, FIELDS.selection, 'selection')); d.defaultRecipe.colors.forEach((row) => exact(row, FIELDS.recipeColor, 'recipeColor'));
  d.outputs.forEach((row, i) => { exact(row, FIELDS.output, `outputs[${i}]`); exact(row.allowedPackPolicy, FIELDS.packPolicy, `outputs[${i}].allowedPackPolicy`); }); exact(d.commerce, FIELDS.commerce, 'commerce'); if (d.commerce.rightsEvidence !== null) exact(d.commerce.rightsEvidence, FIELDS.rightsEvidence, 'commerce.rightsEvidence'); exact(d.commerce.makerAccess, FIELDS.makerAccess, 'commerce.makerAccess'); exact(d.commerce.baseCompletion, FIELDS.completion, 'commerce.baseCompletion'); d.assets.forEach((row, i) => exact(row, FIELDS.asset, `assets[${i}]`));
}
function validateDocument(d) {
  exactDocumentShape(d); inspectAuthorAuthority(d);
  if (d.schemaVersion !== 'animacraft.maker.v8' || d.protocolVersion !== 8
    || !Number.isSafeInteger(d.lineage.version) || d.lineage.version < 1) {
    fail('MAKER_V8_DOCUMENT_VERSION_INVALID', 'Maker document version must be one positive safe integer.');
  }
  if (!KEY.test(d.lineage.makerKey)) fail('MAKER_V8_MAKER_KEY_INVALID', 'Maker key is invalid.');
  if (!['FIXED', 'COMPOSABLE'].includes(d.composition.mode) || !['DISABLED', 'CERTIFIED', 'OPEN'].includes(d.composition.thirdPartyAdmission)) fail('MAKER_V8_COMPOSITION_INVALID', 'Composition policy is invalid.');
  if (d.composition.itemAssetization === true && d.composition.mode !== 'COMPOSABLE') fail('MAKER_V8_ITEM_ASSETIZATION_REQUIRES_COMPOSABLE', 'Owned Base Items require a COMPOSABLE Maker.');
  if (!d.tracks.length || !d.parts.length || !d.outputs.length) fail('MAKER_V8_DOCUMENT_EMPTY', 'Tracks, Parts, and Outputs are required.');
  const unique = (rows, label, field = 'key') => { const set = new Set(); for (const row of rows) { if (!KEY.test(row[field]) || set.has(row[field])) fail('MAKER_V8_KEY_INVALID', `${label} contains an invalid or duplicate key.`); set.add(row[field]); } return set; };
  const boundedLabel = (value, label) => { if (typeof value !== 'string' || !value || encoder.encode(value).length > 256) fail('MAKER_V8_ABI_LABEL_INVALID', `${label} is empty or exceeds the Core v8 label bound.`); }; const tracks = unique(d.tracks, 'tracks'); const assets = unique(d.assets, 'assets', 'id'); const colors = unique(d.colors, 'colors'); unique(d.parts, 'parts'); unique(d.outputs, 'outputs'); unique(d.rules, 'rules'); const publicItemCount = d.parts.reduce((sum, part) => sum + part.items.filter((item) => item.status === 'PUBLIC').length, 0); const publicStyleCount = d.parts.reduce((sum, part) => sum + part.items.filter((item) => item.status === 'PUBLIC').reduce((inner, item) => inner + item.styles.length, 0), 0); const swatchCount = d.colors.reduce((sum, color) => sum + color.swatches.length, 0); if (d.tracks.length > MAKER_V8_DOCUMENT_LIMITS.tracks || d.parts.length > MAKER_V8_DOCUMENT_LIMITS.parts || publicItemCount > MAKER_V8_DOCUMENT_LIMITS.items || publicStyleCount > MAKER_V8_DOCUMENT_LIMITS.styles || swatchCount > MAKER_V8_DOCUMENT_LIMITS.colors || d.rules.length > MAKER_V8_DOCUMENT_LIMITS.rules || d.outputs.length > MAKER_V8_DOCUMENT_LIMITS.outputs) fail('MAKER_V8_ABI_COUNT_UNSUPPORTED', 'Document counts exceed a v8 registry bound.'); if (d.metadata.coverAssetId !== null && !assets.has(d.metadata.coverAssetId)) fail('MAKER_V8_COVER_REFERENCE_INVALID', 'Cover asset is unknown.'); d.tracks.forEach((track) => boundedLabel(track.label, `Track ${track.key}`));
  for (const color of d.colors) { boundedLabel(color.label, `Color ${color.key}`); const swatches = unique(color.swatches, `${color.key}.swatches`); if (!swatches.has(color.defaultSwatchKey)) fail('MAKER_V8_COLOR_DEFAULT_INVALID', `Color ${color.key} has an unknown default swatch.`); for (const swatch of color.swatches) { boundedLabel(swatch.label, `Swatch ${color.key}/${swatch.key}`); rgba(swatch.rgba); for (const stop of swatch.stops) { if (typeof stop.offset !== 'number' || !Number.isFinite(stop.offset) || stop.offset < 0 || stop.offset > 1) fail('MAKER_V8_COLOR_STOP_INVALID', `Color ${color.key}/${swatch.key} has an invalid stop.`); rgba(stop.rgba); } } }
  const publicItems = new Set(); const publicStyles = new Set();
  for (const part of d.parts) {
    boundedLabel(part.label, `Part ${part.key}`);
    if (!['STANDARD', 'LEFT_RIGHT_PAIR', 'LAST_BASTION'].includes(part.kind) || !['FIXED', 'SLOT'].includes(part.wardrobeMode)) fail('MAKER_V8_PART_POLICY_INVALID', `Part ${part.key} policy is invalid.`);
    if (part.kind === 'LAST_BASTION' && part.required !== true) fail('MAKER_V8_LAST_BASTION_REQUIRED', `Part ${part.key} is LAST_BASTION and must remain required.`);
    if (!Number.isSafeInteger(part.capacity) || part.capacity < 1 || part.capacity > 64) fail('MAKER_V8_PART_CAPACITY_INVALID', `Part ${part.key} capacity is outside the executable Runtime range.`);
    if (part.wardrobeMode === 'SLOT' && d.composition.mode !== 'COMPOSABLE') fail('MAKER_V8_SLOT_REQUIRES_COMPOSABLE', `Part ${part.key} SLOT requires COMPOSABLE.`);
    unique(part.items, `${part.key}.items`); if (!part.items.length) fail('MAKER_V8_PART_EMPTY', `Part ${part.key} is empty.`);
    for (const item of part.items) {
      boundedLabel(item.label, `Item ${part.key}/${item.key}`); const styles = unique(item.styles, `${part.key}/${item.key}.styles`); if (!['PUBLIC', 'PRIVATE'].includes(item.status)) fail('MAKER_V8_ITEM_STATUS_INVALID', 'Item status must be PUBLIC or PRIVATE.'); if (!styles.has(item.defaultStyleKey)) fail('MAKER_V8_ITEM_DEFAULT_STYLE_INVALID', `Item ${part.key}/${item.key} has an unknown default Style.`);
      if (item.status === 'PUBLIC') { publicItems.add(`${part.key}/${item.key}`); item.styles.forEach((style) => publicStyles.add(`${part.key}/${item.key}/${style.key}`)); }
      for (const style of item.styles) { boundedLabel(style.label, `Style ${part.key}/${item.key}/${style.key}`); if (!tracks.has(style.trackKey) || !assets.has(style.assetId)) fail('MAKER_V8_STYLE_REFERENCE_INVALID', `Style ${part.key}/${item.key}/${style.key} has an unknown Track or asset.`); if ((style.colorChannelKey === null) !== (style.defaultSwatchKey === null)) fail('MAKER_V8_STYLE_COLOR_PAIR_INVALID', 'Color channel/default swatch are an exact pair.'); if (style.colorChannelKey !== null) { const channel = d.colors.find((entry) => entry.key === style.colorChannelKey); if (!channel || !channel.swatches.some((swatch) => swatch.key === style.defaultSwatchKey)) fail('MAKER_V8_STYLE_COLOR_INVALID', 'Style Color channel/default swatch is unknown.'); } if (typeof style.protected !== 'boolean') fail('MAKER_V8_STYLE_PROTECTION_INVALID', 'Style protection must be boolean content, never an authority claim.'); }
    }
    if (!part.items.some((item) => item.status === 'PUBLIC')) fail('MAKER_V8_PUBLIC_PART_EMPTY', `Part ${part.key} has no public Item.`);
  }
  for (const selected of d.defaultRecipe.selections) if (!publicStyles.has(`${selected.partKey}/${selected.itemKey}/${selected.styleKey}`)) fail('MAKER_V8_RECIPE_PRIVATE_REFERENCE', 'Default Recipe does not survive public projection.');
  for (const rule of d.rules) if (validateMakerV8Rule(rule, { parts: d.parts }).length) fail('MAKER_V8_RULE_REFERENCE_INVALID', `Rule ${rule.key} does not survive public projection.`);
  for (const output of d.outputs) { const policy = output.allowedPackPolicy; if (!['ALL_ADMITTED', 'ALLOWLIST'].includes(policy.kind) || policy.packIds.length > 64 || (policy.kind === 'ALL_ADMITTED' && policy.packIds.length) || (policy.kind === 'ALLOWLIST' && !policy.packIds.length) || (output.protected && encoder.encode(`complete/${output.key}`).length > 128)) fail('MAKER_V8_OUTPUT_PACK_POLICY_INVALID', `Output ${output.key} has an ABI-invalid Pack or protected-scope policy.`); const sortedIds = [...policy.packIds].sort(compareMakerV8ProtocolText); if (policy.packIds.some((id, index) => !KEY.test(id) || id !== sortedIds[index] || (index && id === policy.packIds[index - 1]))) fail('MAKER_V8_OUTPUT_PACK_POLICY_INVALID', `Output ${output.key} Pack IDs must be unique and lexicographically sorted.`); }
  if (d.commerce.rightsOrigin === 'ONCHAIN_NATIVE' ? d.commerce.rightsEvidence !== null : d.commerce.rightsOrigin !== 'LICENSE_WRAPPED' || d.commerce.rightsEvidence === null || !assets.has(d.commerce.rightsEvidence.evidenceAssetId)) fail('MAKER_V8_RIGHTS_EVIDENCE_INVALID', 'Rights evidence does not match its origin.');
  if (d.commerce.rightsOriginConfirmed !== true) fail('MAKER_V8_RIGHTS_CONFIRMATION_REQUIRED', 'Rights origin must be confirmed.');
}

function validateRef(object, label) {
  exact(object, ['type', 'reference', 'fields'], label); const ref = object.reference;
  if (!plain(ref) || !['shared', 'owned', 'immutable'].includes(ref.kind)) fail('MAKER_V8_OBJECT_REFERENCE_INVALID', `${label}.reference is invalid.`);
  if (ref.kind === 'shared') { exact(ref, ['kind', 'objectId', 'initialSharedVersion'], `${label}.reference`); u64(ref.initialSharedVersion); }
  else { exact(ref, ['kind', 'objectId', 'version', 'digest'], `${label}.reference`); u64(ref.version); if (typeof ref.digest !== 'string' || !ref.digest) fail('MAKER_V8_OBJECT_DIGEST_INVALID', `${label}.digest is invalid.`); }
  ref.objectId = normId(ref.objectId); object.type = normType(object.type); return object;
}
function requireReferenceKind(object, expected, label) { if (object.reference.kind !== expected) fail('MAKER_V8_OBJECT_OWNER_KIND_INVALID', `${label} must have ${expected} ownership.`, { label, expected, actual: object.reference.kind }); return object; }
const oid = (object) => object.reference.objectId;
function stableType(context, role, module, struct, generic = '') { return normType(`${context.catalog.fields.roles[role].originalPackageId}::${module}::${struct}${generic}`); }
function requireType(object, expected, label) { same(object.type, expected, 'MAKER_V8_TYPE_ORIGIN_MISMATCH', `${label} stable TypeOrigin`); }
function target(publication, role, module, fn) {
  if (!MAKER_V8_PUBLICATION_COMPILER_ABI[role]?.includes(`${module}::${fn}`)) {
    fail('MAKER_V8_TARGET_INVALID', 'Compiler target is outside the exact fresh-v8 role/module/function allowlist.', { role, module, fn });
  }
  return `${publication.context.catalog.fields.roles[role].callablePackageId}::${module}::${fn}`;
}

export async function deriveMakerV8ReleaseCommitments(value) {
  const input = snapshot(value, 'releaseReadback');
  exact(input, ['catalogId', 'roles', 'authorities'], 'releaseReadback'); input.catalogId = normId(input.catalogId); exact(input.roles, MAKER_V8_ROLE_ORDER, 'roles'); exact(input.authorities, ['seal', 'runtime', 'output', 'physical', 'market', 'release'], 'authorities');
  if (/^0x0+$/.test(input.catalogId)) fail('MAKER_V8_SUI_ID_INVALID', 'Catalog ID cannot be zero.');
  const bindings = {}; const identities = [];
  for (const [roleIndex, role] of MAKER_V8_ROLE_ORDER.entries()) {
    const row = input.roles[role]; exact(row, ['originalPackageId', 'callablePackageId', 'sourceCommitment', 'packageCommitment', 'abiCommitment', 'bindingCommitment', 'originalMarkerType', 'callableMarkerType'], `roles.${role}`);
    row.originalPackageId = normId(row.originalPackageId); row.callablePackageId = normId(row.callablePackageId); identities.push([role, row.originalPackageId, row.callablePackageId]);
    row.sourceCommitment = hashHex(row.sourceCommitment); row.packageCommitment = hashHex(row.packageCommitment); row.abiCommitment = hashHex(row.abiCommitment);
    if ([row.originalPackageId, row.callablePackageId].some(id => /^0x0+$/.test(id)) || [row.sourceCommitment, row.packageCommitment, row.abiCommitment].some(hash => /^0+$/.test(hash))) fail('MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH', `${role} has a zero package identity or commitment.`);
    const [module, originalMarker, callableMarker] = MARKERS[role]; same(normType(row.originalMarkerType), normType(`${row.originalPackageId}::${module}::${originalMarker}`), 'MAKER_V8_TYPE_ORIGIN_MISMATCH', `${role} original marker`); same(normType(row.callableMarkerType), normType(`${row.callablePackageId}::${module}::${callableMarker}`), 'MAKER_V8_CALLABLE_MARKER_MISMATCH', `${role} callable marker`);
    const commitment = await hashBcs(ExactInput, { domain: 'animacraft-fresh-v8/package/exact-binding/v2', schema_revision: 2, role: roleIndex, original_package_id: row.originalPackageId, callable_package_id: row.callablePackageId, source_commitment: fromHex(row.sourceCommitment), package_commitment: fromHex(row.packageCommitment), abi_commitment: fromHex(row.abiCommitment) }); same(hashHex(row.bindingCommitment), commitment, 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH', `${role} binding`); row.bindingCommitment = commitment;
    bindings[role] = fromHex(commitment);
  }
  for (let i = 0; i < identities.length; i += 1) for (let j = i + 1; j < identities.length; j += 1) if (identities[i].slice(1).some((id) => identities[j].slice(1).includes(id))) fail('MAKER_V8_PACKAGE_ROLE_COLLISION', `${identities[i][0]} and ${identities[j][0]} collide.`);
  Object.keys(input.authorities).forEach((role) => { input.authorities[role] = normId(input.authorities[role]); });
  if (new Set(Object.values(input.authorities)).size !== 6 || Object.values(input.authorities).some(id => /^0x0+$/.test(id))) fail('MAKER_V8_CONFIG_AUTHORITY_MISMATCH', 'Release authorities must be nonzero and distinct.');
  const callCapSetCommitment = await hashBcs(CapInput, { domain: 'animacraft-fresh-v8/package/call-cap-set/v2', schema_revision: 2, catalog_id: input.catalogId, ...Object.fromEntries(Object.entries(bindings).map(([role, bytes]) => [`${role}_binding_commitment`, bytes])), ...Object.fromEntries(Object.entries(input.authorities).map(([role, id]) => [`${role}_authority_id`, id])) });
  const productBindingCommitment = await hashBcs(ProductInput, { domain: 'animacraft-fresh-v8/package/product-tuple/v2', schema_revision: 2, catalog_id: input.catalogId, native_capability_mask: 127n, call_cap_set_commitment: fromHex(callCapSetCommitment), ...Object.fromEntries(Object.entries(bindings).map(([role, bytes]) => [`${role}_binding`, bytes])) });
  return deepFreezeResult({ roles: input.roles, authorities: input.authorities, productBindingCommitment, callCapSetCommitment });
}
function deepFreezeResult(value) { return freeze(value); }

export async function certifyMakerV8TrustedContext(value) {
  const c = snapshot(value, 'trustedContext'); exact(c, ['schemaVersion', 'chainIdentifier', 'signerAddress', 'paymentCoinType', 'protocolProfile', 'coreArtifact', 'clock', 'protocolConfig', 'protocolTreasury', 'catalog', 'configs', 'activationAuthority', 'transport'], 'trustedContext');
  if (c.schemaVersion !== MAKER_V8_TRUSTED_CONTEXT_SCHEMA) fail('MAKER_V8_TRUSTED_SCHEMA_INVALID', 'Trusted context schema is invalid.'); if (c.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) fail('MAKER_V8_CHAIN_IDENTIFIER_MISMATCH', 'Trusted compiler context must come from exact Sui Mainnet.', { expected: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, actual: c.chainIdentifier }); c.signerAddress = normId(c.signerAddress); c.paymentCoinType = normType(c.paymentCoinType); if (c.paymentCoinType !== normType(MAKER_V8_PAYMENT_COIN_TYPE)) fail('MAKER_V8_PAYMENT_TYPE_MISMATCH', 'Trusted compiler context must use native Sui Mainnet USDC.', { expected: normType(MAKER_V8_PAYMENT_COIN_TYPE), actual: c.paymentCoinType });
  exact(c.protocolProfile, ['protocolVersion', 'objectRuntimeMaxNumCachedObjects', 'objectRuntimeMaxNumStoreEntries'], 'protocolProfile');
  if (Object.values(c.protocolProfile).some((amount) => typeof amount !== 'string')) fail('MAKER_V8_SUI_PROTOCOL_PROFILE_INVALID', 'Trusted Sui protocol profile values must be exact RPC u64 strings.');
  c.protocolProfile = Object.fromEntries(Object.entries(c.protocolProfile).map(([key, amount]) => [key, u64(amount, `protocolProfile.${key}`).toString()]));
  if (canonicalMakerV8Json(c.protocolProfile) !== canonicalMakerV8Json(MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE)) fail('MAKER_V8_SUI_PROTOCOL_PROFILE_UNMEASURED', 'The live Sui protocol profile has not been approved by the Maker v8 seal-cap harness.', { expected: MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE, actual: c.protocolProfile });
  const protocolProfileCommitment = await hashJson({ schemaVersion: 'animacraft.maker-v8-sui-protocol-profile.v1', ...c.protocolProfile });
  same(protocolProfileCommitment, MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE_COMMITMENT, 'MAKER_V8_SUI_PROTOCOL_PROFILE_COMMITMENT_MISMATCH', 'Approved Sui protocol profile');
  exact(c.coreArtifact, ['callablePackageId', 'packageDigest', 'baseRegistryModuleSha256'], 'coreArtifact'); c.coreArtifact.callablePackageId = normId(c.coreArtifact.callablePackageId); c.coreArtifact.packageDigest = suiDigest(c.coreArtifact.packageDigest, 'coreArtifact.packageDigest'); c.coreArtifact.baseRegistryModuleSha256 = hashHex(c.coreArtifact.baseRegistryModuleSha256, 'coreArtifact.baseRegistryModuleSha256');
  for (const key of ['clock', 'protocolConfig', 'protocolTreasury', 'catalog']) requireReferenceKind(validateRef(c[key], key), 'shared', key);
  const cf = c.catalog.fields; exact(cf, ['version', 'protocolConfigId', 'protocolConfigRevision', 'protocolConfigCommitment', 'nativeCapabilityMask', 'productBindingCommitment', 'callCapSetCommitment', 'roles', 'authorities'], 'catalog.fields'); if (cf.version !== 8 || u64(cf.nativeCapabilityMask) !== 127n) fail('MAKER_V8_CATALOG_VERSION_INVALID', 'Catalog is not the complete v8 tuple.');
  const release = await deriveMakerV8ReleaseCommitments({ catalogId: oid(c.catalog), roles: cf.roles, authorities: cf.authorities }); cf.roles = release.roles; cf.authorities = release.authorities; cf.protocolConfigId = normId(cf.protocolConfigId); cf.protocolConfigCommitment = hashHex(cf.protocolConfigCommitment); cf.productBindingCommitment = hashHex(cf.productBindingCommitment); cf.callCapSetCommitment = hashHex(cf.callCapSetCommitment); same(cf.productBindingCommitment, release.productBindingCommitment, 'MAKER_V8_PRODUCT_BINDING_COMMITMENT_MISMATCH', 'Product binding'); same(cf.callCapSetCommitment, release.callCapSetCommitment, 'MAKER_V8_CALL_CAP_SET_MISMATCH', 'Call-cap set');
  if (c.coreArtifact.callablePackageId !== cf.roles.core.callablePackageId || c.coreArtifact.baseRegistryModuleSha256 !== MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256) fail('MAKER_V8_CORE_ARTIFACT_UNMEASURED', 'Core callable package is not the exact artifact measured by the seal-cap harness.', { expectedCallablePackageId: cf.roles.core.callablePackageId, actualCallablePackageId: c.coreArtifact.callablePackageId, expectedModuleSha256: MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256, actualModuleSha256: c.coreArtifact.baseRegistryModuleSha256 });
  const coreArtifactCommitment = await hashJson({ schemaVersion: 'animacraft.maker-v8-core-artifact.v1', ...c.coreArtifact });
  const pf = c.protocolConfig.fields; exact(pf, ['version', 'revision', 'enabled', 'coreOriginalPackageId', 'coreCallablePackageId', 'treasuryId', 'paymentCoinType', 'primaryContentFeeBps', 'fixedCompleteFeeAtomic', 'makerMarketFeeBps', 'soulMarketFeeBps', 'commitment'], 'protocolConfig.fields'); if (pf.version !== 8 || pf.enabled !== true) fail('MAKER_V8_PROTOCOL_DISABLED', 'ProtocolConfig must be enabled v8.'); pf.coreOriginalPackageId = normId(pf.coreOriginalPackageId); pf.coreCallablePackageId = normId(pf.coreCallablePackageId); pf.treasuryId = normId(pf.treasuryId); pf.paymentCoinType = normType(pf.paymentCoinType); pf.commitment = hashHex(pf.commitment);
  same(pf.coreOriginalPackageId, cf.roles.core.originalPackageId, 'MAKER_V8_CORE_BINDING_MISMATCH', 'Core original'); same(pf.coreCallablePackageId, cf.roles.core.callablePackageId, 'MAKER_V8_CORE_BINDING_MISMATCH', 'Core callable'); same(pf.treasuryId, oid(c.protocolTreasury), 'MAKER_V8_TREASURY_MISMATCH', 'Protocol treasury'); same(pf.paymentCoinType, c.paymentCoinType, 'MAKER_V8_PAYMENT_TYPE_MISMATCH', 'Payment coin'); same(cf.protocolConfigId, oid(c.protocolConfig), 'MAKER_V8_CATALOG_PROTOCOL_MISMATCH', 'Catalog config'); same(String(cf.protocolConfigRevision), String(pf.revision), 'MAKER_V8_CATALOG_PROTOCOL_MISMATCH', 'Catalog revision'); same(cf.protocolConfigCommitment, pf.commitment, 'MAKER_V8_CATALOG_PROTOCOL_MISMATCH', 'Catalog config commitment');
  const protocolCommitment = await deriveMakerV8ProtocolConfigCommitment({ configId: oid(c.protocolConfig), coreOriginalPackageId: pf.coreOriginalPackageId, coreCallablePackageId: pf.coreCallablePackageId, revision: u64(pf.revision), treasuryId: pf.treasuryId, paymentCoinType: pf.paymentCoinType, primaryContentFeeBps: u16(pf.primaryContentFeeBps), fixedCompleteFeeAtomic: u64(pf.fixedCompleteFeeAtomic), makerMarketFeeBps: u16(pf.makerMarketFeeBps), soulMarketFeeBps: u16(pf.soulMarketFeeBps), enabled: pf.enabled }); same(pf.commitment, protocolCommitment, 'MAKER_V8_PROTOCOL_COMMITMENT_MISMATCH', 'ProtocolConfig commitment');
  requireType(c.protocolConfig, stableType(c, 'core', 'protocol_config_v8', 'ProtocolConfigV8'), 'ProtocolConfig'); requireType(c.protocolTreasury, stableType(c, 'core', 'protocol_config_v8', 'ProtocolTreasuryV8', `<${c.paymentCoinType}>`), 'ProtocolTreasury'); requireType(c.catalog, stableType(c, 'core', 'package_binding_v8', 'ProductReleaseCatalogV8'), 'Catalog'); requireType(c.clock, normType('0x2::clock::Clock'), 'Clock'); same(oid(c.clock), normId('0x6'), 'MAKER_V8_CLOCK_MISMATCH', 'Clock ID');
  exact(c.protocolTreasury.fields, ['version', 'configId'], 'protocolTreasury.fields'); if (c.protocolTreasury.fields.version !== 8) fail('MAKER_V8_TREASURY_VERSION_INVALID', 'Treasury is not v8.'); same(normId(c.protocolTreasury.fields.configId), oid(c.protocolConfig), 'MAKER_V8_TREASURY_MISMATCH', 'Treasury config');
  exact(c.configs, ['seal', 'runtime', 'output', 'physical', 'market', 'release'], 'configs');
  const configTypes = { seal: ['seal', 'seal_v8', 'SealPolicyConfigV8'], runtime: ['runtime', 'runtime_binding_v8', 'RuntimePackageConfigV8'], output: ['output', 'output_v8', 'OutputPackageConfigV8'], physical: ['physical', 'physical_v8', 'PhysicalPackageConfigV8'], market: ['market', 'market_v8', 'MarketPackageConfigV8'], release: ['release', 'release_v8', 'ReleasePackageConfigV8'] };
  for (const [name, [role, module, struct]] of Object.entries(configTypes)) {
    requireReferenceKind(validateRef(c.configs[name], `configs.${name}`), 'shared', `configs.${name}`); requireType(c.configs[name], stableType(c, role, module, struct), `configs.${name}`); const f = c.configs[name].fields; exact(f, name === 'seal' ? ['version', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment', 'authorityId', 'commitment', 'keyServerIds', 'weights', 'threshold', 'keyServerSetCommitment', 'encryptionPolicyCommitment'] : ['version', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment', 'authorityId'], `configs.${name}.fields`); if (f.version !== 8) fail('MAKER_V8_CONFIG_VERSION_INVALID', `${name} config is not v8.`); f.catalogId = normId(f.catalogId); f.productBindingCommitment = hashHex(f.productBindingCommitment); f.callCapSetCommitment = hashHex(f.callCapSetCommitment); f.authorityId = normId(f.authorityId); same(f.catalogId, oid(c.catalog), 'MAKER_V8_CONFIG_CATALOG_MISMATCH', `${name} catalog`); same(f.productBindingCommitment, release.productBindingCommitment, 'MAKER_V8_CONFIG_BINDING_MISMATCH', `${name} product`); same(f.callCapSetCommitment, release.callCapSetCommitment, 'MAKER_V8_CONFIG_CALL_CAP_MISMATCH', `${name} call caps`); same(f.authorityId, cf.authorities[name], 'MAKER_V8_CONFIG_AUTHORITY_MISMATCH', `${name} authority`);
  }
  const sf = c.configs.seal.fields; sf.commitment = hashHex(sf.commitment); sf.keyServerSetCommitment = hashHex(sf.keyServerSetCommitment); sf.encryptionPolicyCommitment = hashHex(sf.encryptionPolicyCommitment); if (!Array.isArray(sf.keyServerIds) || !Array.isArray(sf.weights) || !sf.keyServerIds.length || sf.keyServerIds.length !== sf.weights.length) fail('MAKER_V8_SEAL_SERVERS_INVALID', 'Seal key-server readback is invalid.'); sf.keyServerIds = sf.keyServerIds.map(normId); sf.weights = sf.weights.map((weight) => u16(weight)); sf.threshold = u16(sf.threshold);
  const totalKeyShares = sf.weights.reduce((total, weight) => total + weight, 0);
  if (sf.keyServerIds.length > 64 || sf.weights.some(weight => weight === 0) || totalKeyShares >= 255 || sf.threshold === 0 || sf.threshold > totalKeyShares || sf.keyServerIds.some((id, i) => /^0x0+$/.test(id) || (i > 0 && id <= sf.keyServerIds[i - 1]))) fail('MAKER_V8_SEAL_SERVERS_INVALID', 'Seal key-server committee is not canonical.');
  let keyServerSetCommitment;
  try { keyServerSetCommitment = deriveMakerV8SealKeyServerSetCommitment({
    keyServers: sf.keyServerIds.map((objectId, i) => ({ objectId, weight: sf.weights[i] })), threshold: sf.threshold }); }
  catch (cause) { fail('MAKER_V8_SEAL_SERVERS_INVALID', cause.message); }
  same(sf.keyServerSetCommitment, keyServerSetCommitment, 'MAKER_V8_SEAL_SERVERS_INVALID', 'Seal key-server commitment');
  let sealPolicyCommitment;
  try { sealPolicyCommitment = deriveMakerV8SealPolicyCommitment({ policyId: oid(c.configs.seal), catalogId: oid(c.catalog),
    packageTupleCommitment: release.productBindingCommitment, callCapSetCommitment: release.callCapSetCommitment,
    keyServerSetCommitment: sf.keyServerSetCommitment, encryptionPolicyCommitment: sf.encryptionPolicyCommitment }); }
  catch (cause) { fail('MAKER_V8_SEAL_POLICY_COMMITMENT_MISMATCH', cause.message); }
  same(sf.commitment, sealPolicyCommitment, 'MAKER_V8_SEAL_POLICY_COMMITMENT_MISMATCH', 'Seal policy');
  exact(c.transport, ['manifest', 'assets', 'livingContent'], 'transport');
  exact(c.transport.livingContent, ['blobId', 'blobObjectId', 'bytesBase64'], 'transport.livingContent');
  const livingTransport = c.transport.livingContent;
  livingTransport.blobObjectId = normId(livingTransport.blobObjectId);
  if (typeof livingTransport.blobId !== 'string' || !livingTransport.blobId || encoder.encode(livingTransport.blobId).length > 512 || typeof livingTransport.bytesBase64 !== 'string' || livingTransport.bytesBase64.length > 512 * 1024) fail('MAKER_V8_LIVING_TRANSPORT_INVALID', 'Independent Living Content transport requires its exact bounded blob and bytes.');
  const livingBytes = bytes64(livingTransport.bytesBase64, 'Living Content bytes');
  if (!livingBytes.length) fail('MAKER_V8_LIVING_TRANSPORT_INVALID', 'Living Content bundle bytes cannot be empty.');
  const livingSha256 = toHex(await sha(livingBytes));
  c.activationAuthority = await validateMakerV8ActivationAuthorityV8(c.activationAuthority, {
    catalogId: oid(c.catalog), productBindingCommitment: release.productBindingCommitment,
    callCapSetCommitment: release.callCapSetCommitment, roles: cf.roles,
    configIds: Object.fromEntries(Object.entries(c.configs).map(([role, config]) => [role, oid(config)])),
    livingBlobId: livingTransport.blobId, livingBlobObjectId: livingTransport.blobObjectId,
    livingByteLength: livingBytes.length, livingBytes, signerAddress: c.signerAddress,
  });
   exact(c.transport.manifest, ['blobId', 'bytesBase64'], 'transport.manifest'); if (typeof c.transport.manifest.blobId !== 'string' || !c.transport.manifest.blobId || encoder.encode(c.transport.manifest.blobId).length > 512) fail('MAKER_V8_MANIFEST_BLOB_INVALID', 'Manifest Blob ID is required and bounded by the Core ABI.'); if (typeof c.transport.manifest.bytesBase64 !== 'string' || c.transport.manifest.bytesBase64.length > Math.ceil(MAKER_V8_BYTE_BUDGETS.maxManifestBytes / 3) * 4) fail('MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED', 'Certified manifest exceeds the byte budget.'); const manifestBytes = bytes64(c.transport.manifest.bytesBase64, 'manifest bytes'); if (manifestBytes.length > MAKER_V8_BYTE_BUDGETS.maxManifestBytes) fail('MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED', 'Certified manifest exceeds the byte budget.', { byteLength: manifestBytes.length, maximum: MAKER_V8_BYTE_BUDGETS.maxManifestBytes }); if (!Array.isArray(c.transport.assets)) fail('MAKER_V8_TRANSPORT_ASSETS_INVALID', 'Transport assets must be an array.'); const assetMap = new Map(); let totalAssetBytes = 0; let totalBase64Chars = c.transport.manifest.bytesBase64.length + livingTransport.bytesBase64.length;
  for (const [i, asset] of c.transport.assets.entries()) { exact(asset, ['assetId', 'blobId', 'mediaType', 'bytesBase64'], `transport.assets[${i}]`); if (!KEY.test(asset.assetId) || assetMap.has(asset.assetId) || typeof asset.blobId !== 'string' || !asset.blobId || encoder.encode(asset.blobId).length > 512 || typeof asset.mediaType !== 'string' || !asset.mediaType) fail('MAKER_V8_TRANSPORT_ASSET_INVALID', `Transport asset ${i} is invalid.`); if (typeof asset.bytesBase64 !== 'string' || asset.bytesBase64.length > Math.ceil(MAKER_V8_BYTE_BUDGETS.maxAssetBytes / 3) * 4) fail('MAKER_V8_ASSET_BYTE_BUDGET_EXCEEDED', `Certified asset ${i} exceeds the byte budget.`, { index: i, maximum: MAKER_V8_BYTE_BUDGETS.maxAssetBytes }); totalBase64Chars += asset.bytesBase64.length; if (totalBase64Chars > MAKER_V8_BYTE_BUDGETS.maxTransportBase64Chars) fail('MAKER_V8_TRANSPORT_BYTE_BUDGET_EXCEEDED', 'Certified transport exceeds its aggregate byte budget.', { maximumBase64Chars: MAKER_V8_BYTE_BUDGETS.maxTransportBase64Chars }); const bytes = bytes64(asset.bytesBase64, `asset ${asset.assetId}`); if (bytes.length > MAKER_V8_BYTE_BUDGETS.maxAssetBytes) fail('MAKER_V8_ASSET_BYTE_BUDGET_EXCEEDED', `Certified asset ${i} exceeds the byte budget.`, { index: i, byteLength: bytes.length, maximum: MAKER_V8_BYTE_BUDGETS.maxAssetBytes }); totalAssetBytes += bytes.length; if (totalAssetBytes > MAKER_V8_BYTE_BUDGETS.maxTotalAssetBytes) fail('MAKER_V8_TRANSPORT_BYTE_BUDGET_EXCEEDED', 'Certified asset bytes exceed the aggregate byte budget.', { byteLength: totalAssetBytes, maximum: MAKER_V8_BYTE_BUDGETS.maxTotalAssetBytes }); assetMap.set(asset.assetId, Object.freeze({ assetId: asset.assetId, blobId: asset.blobId, mediaType: asset.mediaType, byteLength: bytes.length, sha256: toHex(await sha(bytes)) })); }
  const manifestSha256 = toHex(await sha(manifestBytes)); c.transport = { livingContent: { ...livingTransport }, manifest: { blobId: c.transport.manifest.blobId }, assets: [...assetMap.values()] }; c._derived = { productBindingCommitment: release.productBindingCommitment, callCapSetCommitment: release.callCapSetCommitment, sealPolicyCommitment, protocolProfileCommitment, coreArtifactCommitment, manifestByteLength: manifestBytes.length, manifestSha256, livingByteLength: livingBytes.length, livingSha256, assets: Object.fromEntries(assetMap) }; freeze(c); trustedSet.add(c); return c;
}

export function certifyMakerV8SuccessorPredecessorV8(trustedContext, value) {
  if (!trustedSet.has(trustedContext)) {
    fail('MAKER_V8_TRUSTED_CONTEXT_REQUIRED', 'Successor certification requires one trusted compiler context.');
  }
  const predecessor = snapshot(value, 'successorPredecessor');
  exact(predecessor, ['schemaVersion', 'root', 'adminCap'], 'successorPredecessor');
  if (predecessor.schemaVersion !== MAKER_V8_SUCCESSOR_PREDECESSOR_SCHEMA) {
    fail('MAKER_V8_SUCCESSOR_PREDECESSOR_SCHEMA_INVALID', 'Successor predecessor schema is invalid.');
  }
  requireReferenceKind(validateRef(predecessor.root, 'successorPredecessor.root'), 'shared', 'successorPredecessor.root');
  requireReferenceKind(validateRef(predecessor.adminCap, 'successorPredecessor.adminCap'), 'owned', 'successorPredecessor.adminCap');
  requireType(
    predecessor.root,
    stableType(trustedContext, 'core', 'maker_v8', 'MakerRootV8', `<${trustedContext.paymentCoinType}>`),
    'Successor predecessor Root',
  );
  requireType(
    predecessor.adminCap,
    stableType(trustedContext, 'core', 'maker_v8', 'MakerAdminCapV8'),
    'Successor predecessor AdminCap',
  );
  const root = predecessor.root.fields;
  exact(root, [
    'version', 'owner', 'adminCapId', 'controlEpoch', 'lifecycle', 'makerKey',
    'makerVersion', 'versionCommitment', 'successorAuthorityId', 'successorRootId',
  ], 'successorPredecessor.root.fields');
  const admin = predecessor.adminCap.fields;
  exact(admin, ['version', 'rootId', 'owner', 'controlEpoch'], 'successorPredecessor.adminCap.fields');
  root.owner = normId(root.owner);
  root.adminCapId = normId(root.adminCapId);
  root.versionCommitment = hashHex(root.versionCommitment);
  if (root.version !== 8 || root.lifecycle !== 3 || !KEY.test(root.makerKey)
    || !Number.isSafeInteger(root.makerVersion) || root.makerVersion < 1
    || root.successorAuthorityId !== null || root.successorRootId !== null
    || root.owner !== trustedContext.signerAddress
    || root.adminCapId !== oid(predecessor.adminCap)) {
    fail('MAKER_V8_SUCCESSOR_PREDECESSOR_INVALID', 'Predecessor must be one exact archived, unbranched Maker owned by the signer.');
  }
  admin.rootId = normId(admin.rootId);
  admin.owner = normId(admin.owner);
  if (admin.version !== 8 || admin.rootId !== oid(predecessor.root)
    || admin.owner !== trustedContext.signerAddress
    || u64(admin.controlEpoch) !== u64(root.controlEpoch)) {
    fail('MAKER_V8_SUCCESSOR_ADMIN_INVALID', 'Predecessor AdminCap does not match the archived Root and signer.');
  }
  root.controlEpoch = u64(root.controlEpoch).toString();
  admin.controlEpoch = u64(admin.controlEpoch).toString();
  freeze(predecessor);
  predecessorSet.add(predecessor);
  return predecessor;
}

const byOrder = (field) => (a, b) => Number(a[field]) - Number(b[field]) || compareMakerV8ProtocolText(a.key, b.key);
const sorted = (rows, compare) => [...rows].sort(compare);
const mapAccess = (mode) => ({ FREE: 0, ONE_TIME_PAID: 1 })[mode] ?? fail('MAKER_V8_ACCESS_MODE_INVALID', `Unsupported access ${mode}.`);
const mapComplete = (mode) => ({ UNLIMITED_FREE: 0, FREE_QUOTA_THEN_PAID: 1, PAID_EVERY_TIME: 2, FREE_QUOTA_THEN_BLOCK: 3 })[mode] ?? fail('MAKER_V8_COMPLETE_MODE_INVALID', `Unsupported Complete ${mode}.`);
const mapAdmission = (mode) => ({ DISABLED: 0, CERTIFIED: 1, OPEN: 2 })[mode];
const mapIssuance = (mode) => ({ FREE_CLAIM: 0, PAID_PURCHASE: 1, PROOF_MATERIALIZE: 2 })[mode] ?? fail('MAKER_V8_PHYSICAL_ISSUANCE_INVALID', `Unsupported issuance ${mode}.`);
const mapProof = (mode) => ({ NONE: 0, CANONICAL_SOUL: 2 })[mode] ?? fail('MAKER_V8_PHYSICAL_PROOF_INVALID', `Unsupported proof ${mode}.`);
function rgba(value) { if (typeof value !== 'string' || !/^#[0-9a-fA-F]{8}$/.test(value)) fail('MAKER_V8_RGBA_INVALID', `Invalid RGBA ${value}.`); return Number.parseInt(value.slice(1), 16); }

/** Exact Core RuleRowV2 only. Other Base rows and registry rolling remain separate migration work. */
export async function compileMakerV8RuleRows(rules) {
  if (!Array.isArray(rules)) fail('MAKER_V8_RULE_REFERENCE_INVALID', 'Rules must be an array.');
  const inputs = snapshot(rules, 'rules');
  const keys = new Set();
  for (const rule of inputs) {
    if (validateMakerV8Rule(rule).length || rule.targets.length > 32 || keys.has(rule.key)) {
      fail('MAKER_V8_RULE_REFERENCE_INVALID', 'Rules must be canonical, unique and within the Core target bound.');
    }
    keys.add(rule.key);
  }
  const selector = value => ({ source: { ANY: 0, BASE: 1, PACK: 2, EXTERNAL: 3 }[value.source], source_key: value.sourceKey, part_key: value.partKey, item_key: value.itemKey, style_key: value.styleKey });
  return Promise.all(sorted(inputs, (a, b) => compareMakerV8ProtocolText(a.key, b.key)).map(async (rule, index) => {
    const row = { sequence: BigInt(index), key: rule.key, kind: rule.kind === 'REQUIRE' ? 0 : 1, trigger: selector(rule.trigger), target_mode: rule.targetMode === 'ALL' ? 0 : 1, targets: rule.targets.map(selector), payload_commitment: [...fromHex(await hashJson({ schemaVersion: 'animacraft.maker-v8-rule-payload.v2', payload: rule.payload }))] };
    const selectorHash = value => hashBcs(SelectorCommitment, { domain: 'animacraft-fresh-v8/core/semantic-selector/v2', schema_revision: VERSION, selector: value });
    const commitment = await hashBcs(RuleCommitment, {
      domain: 'animacraft-fresh-v8/core/rule-row/v2', schema_revision: VERSION,
      definition_source: 1, definition_source_key: null, sequence: row.sequence,
      key: row.key, kind: row.kind, trigger_selector_commitment: fromHex(await selectorHash(row.trigger)),
      target_mode: row.target_mode, ordered_target_selector_commitments: await Promise.all(row.targets.map(async value => fromHex(await selectorHash(value)))),
      payload_commitment: row.payload_commitment,
    });
    return freeze({ row, bytes: [...RuleRow.serialize(row).toBytes()], commitment });
  }));
}

/** Emit constructor results as real Move arguments, never BCS bytes masquerading as a struct. */
export function buildMakerV8RuleRowCommands(tx, { corePackageId, coreOriginalPackageId, row }) {
  const module = `${normId(corePackageId)}::base_registry_v8`;
  const selector = value => tx.moveCall({ target: `${module}::new_semantic_selector_v2`, arguments: [tx.pure.u8(value.source), tx.pure.option('string', value.source_key), tx.pure.string(value.part_key), tx.pure.option('string', value.item_key), tx.pure.option('string', value.style_key)] });
  const trigger = selector(row.trigger);
  const targets = tx.makeMoveVec({ type: `${normId(coreOriginalPackageId)}::base_registry_v8::SemanticSelectorV2`, elements: row.targets.map(selector) });
  return tx.moveCall({ target: `${module}::new_rule_row_v2`, arguments: [tx.pure.u64(row.sequence), tx.pure.string(row.key), tx.pure.u8(row.kind), trigger, tx.pure.u8(row.target_mode), targets, pureBytes(tx, row.payload_commitment)] });
}

export function appendMakerV8RuleRowCommands(tx, { corePackageId, coreOriginalPackageId, paymentCoinType, registry, root, admin, row }) {
  const rule = buildMakerV8RuleRowCommands(tx, { corePackageId, coreOriginalPackageId, row });
  const module = `${normId(corePackageId)}::base_registry_v8`;
  return tx.moveCall({ target: `${module}::append_rule_v2`, typeArguments: [paymentCoinType], arguments: [registry, root, admin, rule] });
}

async function compileRows(document, context) {
  const compiled = await compileMakerV8BaseRowsV2(document, context._derived.assets);
  const rules = await compileMakerV8RuleRows(document.rules);
  compiled.rows.rule = rules.map(entry => entry.row);
  const ruleEntries = new Map(rules.map(entry => [entry.row, entry]));
  const flatRows = MAKER_V8_BASE_CATEGORIES_V2.flatMap(([kind]) => compiled.rows[kind].map(row => ({
    kind, row, bytes: [...Rows[kind].serialize(row).toBytes()],
    ...(kind === 'rule' ? { commitment: ruleEntries.get(row).commitment } : {}),
  })));
  return { ...compiled, flatRows, total: BigInt(flatRows.length) };
}

async function storageProgress(publication, scaffold) {
  const author = publicationProgress.get(publication);
  const storage = await deriveMakerV8BaseStorageCommitmentsV2({
    registryId: oid(scaffold.baseRegistry), rootId: oid(scaffold.root),
    makerVersion: publication.document.lineage.version, entries: author.flatRows,
  });
  let colorSwatchCount = 0n; let totalCapacity = 0n; let ruleSelectorCount = 0n; let visibilityLeafCount = 0n;
  const checkpoints = storage.checkpoints.map((checkpoint, index) => {
    const entry = author.flatRows[index - 1];
    if (entry?.kind === 'color') colorSwatchCount += BigInt(entry.row.swatches.length);
    if (entry?.kind === 'part') totalCapacity += entry.row.capacity;
    if (entry?.kind === 'rule') ruleSelectorCount += BigInt(1 + entry.row.targets.length);
    if (entry?.row.visibility_tokens) visibilityLeafCount += BigInt(entry.row.visibility_tokens.filter(token => token.opcode === 0).length);
    return Object.freeze({ ...checkpoint, initialCommitments: storage.initialCommitments,
      sealedCommitments: null, authorRowsRollingCommitment: author.author.checkpoints[index],
      colorSwatchCount, totalCapacity, ruleSelectorCount, visibilityLeafCount });
  });
  return Object.freeze({ publication, ...storage, flatRows: author.flatRows, checkpoints });
}
function requireBaseProgress(publication, scaffold) {
  const progress = scaffoldProgress.get(scaffold);
  if (!progress || progress.publication !== publication) fail('MAKER_V8_COMPILER_PROGRESS_MISSING', 'Exact scaffold-bound Base progress is unavailable.');
  return progress;
}
async function runtimeCommitments(document, parts, content, partRows) {
  const admission = mapAdmission(document.composition.thirdPartyAdmission); let rolling = await hashBcs(RuntimeEmpty, { domain: domain('animacraft-v8/runtime/part-profiles-empty'), version: VERSION, root_content_commitment: fromHex(content) }); const profiles = [];
  for (let i = 0; i < parts.length; i += 1) { const part = parts[i]; const profile = { sequence: BigInt(i), partKey: part.key, wardrobeMode: part.wardrobeMode === 'FIXED' ? 0 : 1, behavior: part.wardrobeMode === 'FIXED' ? 0 : admission === 0 ? 1 : 3, capacity: BigInt(part.capacity), required: part.required, corePartPayloadCommitment: toHex(partRows[i].payload_commitment) }; rolling = await hashBcs(RuntimeProfile, { domain: domain('animacraft-v8/runtime/part-profile'), version: VERSION, root_content_commitment: fromHex(content), sequence: profile.sequence, previous: fromHex(rolling), part_key: profile.partKey, core_part_payload_commitment: fromHex(profile.corePartPayloadCommitment), required: profile.required, wardrobe_mode: profile.wardrobeMode, behavior: profile.behavior, capacity: profile.capacity, admission_ceiling: admission }); profile.rollingProfileCommitment = rolling; profiles.push(profile); }
  const itemAssetization = document.composition.itemAssetization === true;
  const policyCommitment = await hashBcs(RuntimePolicy, { domain: domain('animacraft-v8/runtime/admission-policy'), version: VERSION, root_content_commitment: fromHex(content), profile_count: BigInt(profiles.length), profile_commitment: fromHex(rolling), admission_ceiling: admission, item_assetization: itemAssetization }); return { admission, itemAssetization, profiles, profileCommitment: rolling, policyCommitment };
}
async function policyCommitments(document, context) {
  const commerce = document.commerce; const pf = context.protocolConfig.fields; const access = mapAccess(commerce.makerAccess.mode); const complete = mapComplete(commerce.baseCompletion.mode); const makerPrice = u64(commerce.makerAccess.purchasePriceAtomic); const completePrice = u64(commerce.baseCompletion.priceAtomic); const quota = u64(commerce.baseCompletion.freeQuotaPerWallet); const totalCap = commerce.baseCompletion.totalCap === null ? 0n : u64(commerce.baseCompletion.totalCap); const validAccess = (access === 0 && makerPrice === 0n) || (access === 1 && makerPrice > 0n && makerPrice <= 1_000_000_000_000n); const validComplete = completePrice <= 1_000_000_000_000n && quota <= 1_000_000_000n && totalCap <= 1_000_000_000n && (totalCap === 0n || quota <= totalCap) && ((complete === 0 && completePrice === 0n && quota === 0n) || (complete === 1 && completePrice > 0n && quota > 0n) || (complete === 2 && completePrice > 0n && quota === 0n) || (complete === 3 && completePrice === 0n && quota > 0n)); if (!validAccess || !validComplete) fail('MAKER_V8_ECONOMICS_ABI_INVALID', 'Commerce policy would abort the Core v8 constructor.'); const royalties = [commerce.soulCreatorRoyaltyBps, commerce.makerSourceRoyaltyBps, commerce.makerResaleRoyaltyBps].map((value) => u16(value)); if (royalties.some((value) => value > 1000 || value % 50) || royalties[0] + royalties[1] > 1000) fail('MAKER_V8_RIGHTS_ROYALTY_INVALID', 'Royalty policy would abort the Core v8 constructor.');
  const economics = await hashBcs(EconomicsInput, { domain: domain('animacraft-v8/economics-snapshot'), version: VERSION, protocol_config_id: oid(context.protocolConfig), protocol_config_revision: u64(pf.revision), protocol_config_commitment: fromHex(pf.commitment), protocol_treasury_id: oid(context.protocolTreasury), payment_coin_type: context.paymentCoinType, maker_access: access, maker_price_atomic: makerPrice, complete_mode: complete, complete_price_atomic: completePrice, complete_per_wallet_quota: quota, complete_total_cap: totalCap, primary_content_fee_bps: u16(pf.primaryContentFeeBps), fixed_complete_fee_atomic: u64(pf.fixedCompleteFeeAtomic), maker_market_fee_bps: u16(pf.makerMarketFeeBps), soul_market_fee_bps: u16(pf.soulMarketFeeBps) });
  let rights;
  if (commerce.rightsOrigin === 'ONCHAIN_NATIVE') { if (commerce.rightsEvidence !== null) fail('MAKER_V8_NATIVE_RIGHTS_EVIDENCE_FORBIDDEN', 'Native rights cannot include evidence.'); rights = { origin: 0, certified: false, catalogId: null, binding: null, locator: '', blobId: '', sha256: Object.freeze([]), terms: Object.freeze([]) }; }
  else if (commerce.rightsOrigin === 'LICENSE_WRAPPED') { const evidence = context._derived.assets[commerce.rightsEvidence?.evidenceAssetId]; if (!evidence) fail('MAKER_V8_RIGHTS_EVIDENCE_MISSING', 'License evidence lacks certified bytes.'); const terms = await hashJson({ schemaVersion: 'animacraft.maker-v8-license-terms.v1', licensor: commerce.rightsEvidence.licensor, evidenceAssetId: commerce.rightsEvidence.evidenceAssetId, evidenceSha256: evidence.sha256, license: document.metadata.license }); rights = { origin: 1, certified: true, catalogId: oid(context.catalog), binding: fromHex(context._derived.productBindingCommitment), locator: `walrus://${evidence.blobId}`, blobId: evidence.blobId, sha256: fromHex(evidence.sha256), terms: fromHex(terms) }; }
  else fail('MAKER_V8_RIGHTS_ORIGIN_INVALID', 'Rights origin is invalid.');
  const rightsCommitment = await hashBcs(RightsInput, { domain: domain('animacraft-v8/rights-snapshot'), version: VERSION, origin: rights.origin, creator: context.signerAddress, creator_confirmed: true, evidence_certified: rights.certified, certification_catalog_id: rights.catalogId, certification_binding_commitment: rights.binding, evidence_locator: rights.locator, evidence_blob_id: rights.blobId, evidence_sha256: rights.sha256, terms_commitment: rights.terms, soul_creator_royalty_bps: u16(commerce.soulCreatorRoyaltyBps), maker_source_royalty_bps: u16(commerce.makerSourceRoyaltyBps), maker_resale_royalty_bps: u16(commerce.makerResaleRoyaltyBps) });
  return { economics: { commitment: economics, access, complete, totalCap }, rights: { commitment: rightsCommitment, ...rights } };
}

export async function compileMakerV8Publication(documentValue, trustedContext, predecessor = null) {
  if (!trustedSet.has(trustedContext)) fail('MAKER_V8_TRUSTED_CONTEXT_REQUIRED', 'Use certifyMakerV8TrustedContext() first.'); assertMakerV8Document(documentValue, { mode: 'compile' }); const document = snapshot(documentValue, 'document'); validateDocument(document); const documentByteLength = encoder.encode(canonicalMakerV8Json(document)).length; if (documentByteLength > MAKER_V8_BYTE_BUDGETS.maxDocumentUtf8Bytes) fail('MAKER_V8_DOCUMENT_BYTE_BUDGET_EXCEEDED', 'Maker document exceeds the canonical UTF-8 byte budget.', { byteLength: documentByteLength, maximum: MAKER_V8_BYTE_BUDGETS.maxDocumentUtf8Bytes });
  const makerVersion = document.lineage.version;
  if (makerVersion === 1) {
    if (predecessor !== null) fail('MAKER_V8_INITIAL_PREDECESSOR_FORBIDDEN', 'Maker version 1 cannot consume a predecessor.');
  } else {
    if (!predecessorSet.has(predecessor)) fail('MAKER_V8_SUCCESSOR_PREDECESSOR_REQUIRED', 'Use certifyMakerV8SuccessorPredecessorV8() for Maker version N+1.');
    const prior = predecessor.root.fields;
    if (makerVersion !== prior.makerVersion + 1
      || document.lineage.makerKey !== prior.makerKey
      || document.lineage.previousRootId !== oid(predecessor.root)
      || document.lineage.previousVersionCommitment !== prior.versionCommitment) {
      fail('MAKER_V8_SUCCESSOR_LINEAGE_MISMATCH', 'Document lineage is not the exact N+1 continuation of its archived predecessor.');
    }
  }
  const projection = projectPublicMakerV8Document(document);
  const assetProtection = new Map(projection.assets.map((asset) => [asset.id, {
    protected: false,
    references: 0,
  }]));
  for (const part of projection.parts) for (const item of part.items) for (const style of item.styles) {
    const state = assetProtection.get(style.assetId);
    if (state === undefined) {
      fail('MAKER_V8_CERTIFIED_ASSET_SET_MISMATCH', `Style asset ${style.assetId} is absent from the document asset set.`);
    }
    if (style.protected === true && state.references !== 0
      || style.protected !== true && state.protected) {
      fail('MAKER_V8_PROTECTED_ASSET_IDENTITY_AMBIGUOUS', `Protected asset ${style.assetId} must belong to exactly one protected Style and cannot be shared.`);
    }
    state.protected ||= style.protected === true;
    state.references += 1;
  }
  if (projection.assets.length !== trustedContext.transport.assets.length) fail('MAKER_V8_CERTIFIED_ASSET_SET_MISMATCH', 'Every public document asset must have exactly one certified byte transport.'); for (const asset of projection.assets) { const certified = trustedContext._derived.assets[asset.id]; const protectedAsset = assetProtection.get(asset.id).protected; if (!certified || !protectedAsset && (String(asset.byteLength) !== String(certified.byteLength) || asset.mediaType !== certified.mediaType) || protectedAsset && certified.mediaType !== 'application/vnd.animacraft.seal-ciphertext') fail('MAKER_V8_CERTIFIED_ASSET_METADATA_MISMATCH', `Certified bytes for ${asset.id} do not match its public/protected transport semantics.`); }
  const certifiedAssets = trustedContext.transport.assets.map((asset) => { const item = trustedContext._derived.assets[asset.assetId]; return { assetId: asset.assetId, blobId: asset.blobId, mediaType: asset.mediaType, byteLength: item.byteLength, sha256: item.sha256 }; }).sort((a, b) => compareMakerV8ProtocolText(a.assetId, b.assetId));
  assertMakerV8PublishedSources(projection, certifiedAssets);
  const manifestJson = canonicalMakerV8Json({ schemaVersion: 'animacraft.maker-v8-manifest.v2', protocolVersion: 8, document: projection, certifiedAssets }); const manifestBytes = encoder.encode(manifestJson); if (manifestBytes.length > MAKER_V8_BYTE_BUDGETS.maxManifestBytes) fail('MAKER_V8_MANIFEST_BYTE_BUDGET_EXCEEDED', 'Canonical Maker manifest exceeds its byte budget.', { byteLength: manifestBytes.length, maximum: MAKER_V8_BYTE_BUDGETS.maxManifestBytes }); const manifestSha256 = toHex(await sha(manifestBytes)); if (manifestBytes.length !== trustedContext._derived.manifestByteLength || manifestSha256 !== trustedContext._derived.manifestSha256) fail('MAKER_V8_MANIFEST_BYTES_MISMATCH', 'Certified manifest bytes are not canonical.', { certifiedByteLength: trustedContext._derived.manifestByteLength, canonicalByteLength: manifestBytes.length, certifiedSha256: trustedContext._derived.manifestSha256, canonicalSha256: manifestSha256 });
  const content = await hashJson({ schemaVersion: 'animacraft.maker-v8-public-content.v1', document: projection }); const renderer = await hashJson({ schemaVersion: 'animacraft.maker-v8-renderer.v2', canvas: document.canvas, tracks: document.tracks.map(({ key, renderOrder }) => ({ key, renderOrder })), outputs: document.outputs.map(({ key, payload }) => ({ key, payload })) });
  const living = await compileMakerV8LivingContentV8(document);
  if (living.byteLength !== trustedContext._derived.livingByteLength || living.sha256 !== trustedContext._derived.livingSha256 || encodeBase64(Uint8Array.from(living.bytes)) !== trustedContext.transport.livingContent.bytesBase64) fail('MAKER_V8_LIVING_TRANSPORT_MISMATCH', 'Certified Living Content bytes differ from the actual three authored Markdown documents and defaults.');
  const livingContentBinding = await deriveMakerV8LivingContentBindingV8({ creatorDefaultsCommitment: living.creatorDefaultsCommitment, blobId: trustedContext.transport.livingContent.blobId, sha256: living.sha256, byteLength: living.byteLength, bundleCommitment: living.bundleCommitment });
  const compiled = await compileRows(document, trustedContext); const author = await deriveMakerV8BaseAuthorCommitmentV2(compiled.flatRows); const runtime = await runtimeCommitments(document, compiled.parts, content, compiled.rows.part); const policy = await policyCommitments(document, trustedContext);
  const counts = author.counts;
  const version = await hashBcs(VersionInput, { domain: domain('animacraft-v8/maker-version'), version: VERSION, core_original_package_id: trustedContext.catalog.fields.roles.core.originalPackageId, protocol_config_id: oid(trustedContext.protocolConfig), protocol_config_revision: u64(trustedContext.protocolConfig.fields.revision), protocol_config_commitment: fromHex(trustedContext.protocolConfig.fields.commitment), maker_key: document.lineage.makerKey, maker_version: BigInt(makerVersion), previous_root_id: document.lineage.previousRootId, previous_version_commitment: document.lineage.previousVersionCommitment === null ? null : fromHex(document.lineage.previousVersionCommitment), maker_document_commitment: fromHex(living.makerDocumentCommitment), creator_defaults_commitment: fromHex(living.creatorDefaultsCommitment), living_content_binding_commitment: fromHex(livingContentBinding), renderer_commitment: fromHex(renderer), manifest_blob_id: trustedContext.transport.manifest.blobId, manifest_sha256: fromHex(manifestSha256), content_commitment: fromHex(content), expected_base_definition_count: compiled.total, expected_base_registry_commitment: fromHex(author.commitment), expected_pack_admission_policy_commitment: fromHex(runtime.policyCommitment), economics_commitment: fromHex(policy.economics.commitment), rights_commitment: fromHex(policy.rights.commitment) });
  const result = { schemaVersion: MAKER_V8_COMPILER_SCHEMA, context: trustedContext, predecessor, document, manifest: { json: manifestJson, blobId: trustedContext.transport.manifest.blobId, sha256: manifestSha256 }, livingContent: { ...living, blobId: trustedContext.transport.livingContent.blobId }, commitments: { makerDocument: living.makerDocumentCommitment, creatorDefaults: living.creatorDefaultsCommitment, livingContentBinding, content, renderer, version, economics: policy.economics.commitment, rights: policy.rights.commitment, baseAuthorRows: author.commitment, packAdmissionPolicy: runtime.policyCommitment }, counts, rows: compiled.rows, parts: compiled.parts, runtime, policy };
  await assertSingleBaseRowBudgets(result, compiled.flatRows);
  freeze(result); compiledSet.add(result); publicationProgress.set(result, Object.freeze({ author, flatRows: compiled.flatRows })); return result;
}

function requireCompiled(value) { if (!compiledSet.has(value)) fail('MAKER_V8_COMPILED_PUBLICATION_REQUIRED', 'A compiler-produced publication is required.'); }
function objectArg(tx, object, mutable) { const ref = object.reference; return ref.kind === 'shared' ? tx.sharedObjectRef({ objectId: ref.objectId, initialSharedVersion: ref.initialSharedVersion, mutable }) : tx.objectRef({ objectId: ref.objectId, version: ref.version, digest: ref.digest }); }
function pureBytes(tx, value) { return tx.pure.vector('u8', [...(typeof value === 'string' ? fromHex(value) : value)]); }
function call(tx, publication, role, module, fn, args, typeArguments = []) { return tx.moveCall({ target: target(publication, role, module, fn), typeArguments, arguments: args }); }
const coinType = (publication) => [publication.context.paymentCoinType];

export function buildMakerV8ScaffoldTransaction(publication) {
  requireCompiled(publication); const tx = new Transaction(); const c = publication.context; tx.setSender(c.signerAddress); const coin = coinType(publication); const protocol = objectArg(tx, c.protocolConfig, false); const catalog = objectArg(tx, c.catalog, false); const releaseConfig = objectArg(tx, c.configs.release, false); const commerce = publication.document.commerce;
  const economics = call(tx, publication, 'core', 'maker_v8', 'new_economics_snapshot_v8', [protocol, tx.pure.u8(publication.policy.economics.access), tx.pure.u64(String(commerce.makerAccess.purchasePriceAtomic)), tx.pure.u8(publication.policy.economics.complete), tx.pure.u64(String(commerce.baseCompletion.priceAtomic)), tx.pure.u64(String(commerce.baseCompletion.freeQuotaPerWallet)), tx.pure.u64(publication.policy.economics.totalCap)], coin);
  let rights;
  if (commerce.rightsOrigin === 'ONCHAIN_NATIVE') rights = call(tx, publication, 'core', 'maker_v8', 'new_onchain_native_rights_snapshot_v8', [tx.pure.u16(commerce.soulCreatorRoyaltyBps), tx.pure.u16(commerce.makerSourceRoyaltyBps), tx.pure.u16(commerce.makerResaleRoyaltyBps)]);
  else rights = call(tx, publication, 'release', 'release_v8', 'new_license_wrapped_rights_snapshot_v8', [protocol, catalog, objectArg(tx, c.activationAuthority.replacement, false), releaseConfig, tx.pure.string(publication.policy.rights.locator), tx.pure.string(publication.policy.rights.blobId), pureBytes(tx, publication.policy.rights.sha256), pureBytes(tx, publication.policy.rights.terms), tx.pure.u16(commerce.soulCreatorRoyaltyBps), tx.pure.u16(commerce.makerSourceRoyaltyBps), tx.pure.u16(commerce.makerResaleRoyaltyBps)]);
  const counts = call(tx, publication, 'core', 'base_registry_v8', 'new_base_definition_counts_v8', MAKER_V8_BASE_CATEGORIES_V2.map(([, key]) => tx.pure.u64(publication.counts[key])));
  let root; let base; let treasury; let admin;
  if (publication.document.lineage.version === 1) {
    [root, base, treasury, admin] = call(tx, publication, 'core', 'core_v8', 'new_initial_maker_draft_v8', [protocol, tx.pure.string(publication.document.lineage.makerKey), pureBytes(tx, publication.commitments.makerDocument), pureBytes(tx, publication.commitments.creatorDefaults), pureBytes(tx, publication.commitments.livingContentBinding), pureBytes(tx, publication.commitments.renderer), tx.pure.string(publication.manifest.blobId), pureBytes(tx, publication.manifest.sha256), pureBytes(tx, publication.commitments.content), counts, pureBytes(tx, publication.commitments.baseAuthorRows), pureBytes(tx, publication.commitments.packAdmissionPolicy), economics, rights, objectArg(tx, c.clock, false)], coin);
  } else {
    if (!predecessorSet.has(publication.predecessor)) fail('MAKER_V8_SUCCESSOR_PREDECESSOR_REQUIRED', 'Successor scaffold requires its exact certified predecessor.');
    const previous = objectArg(tx, publication.predecessor.root, true);
    const previousAdmin = objectArg(tx, publication.predecessor.adminCap, false);
    const expectedEpoch = publication.predecessor.root.fields.controlEpoch;
    const authority = call(tx, publication, 'core', 'maker_v8', 'issue_successor_authority_v8', [previous, previousAdmin, tx.pure.u64(expectedEpoch)], coin);
    [root, base, treasury, admin] = call(tx, publication, 'core', 'core_v8', 'new_successor_maker_draft_v8', [protocol, previous, previousAdmin, authority, tx.pure.u64(expectedEpoch), pureBytes(tx, publication.commitments.renderer), tx.pure.string(publication.manifest.blobId), pureBytes(tx, publication.manifest.sha256), pureBytes(tx, publication.commitments.content), counts, pureBytes(tx, publication.commitments.baseAuthorRows), pureBytes(tx, publication.commitments.packAdmissionPolicy), pureBytes(tx, publication.commitments.makerDocument), pureBytes(tx, publication.commitments.creatorDefaults), pureBytes(tx, publication.commitments.livingContentBinding), economics, rights, objectArg(tx, c.clock, false)], coin);
  }
  call(tx, publication, 'release', 'release_v8', 'finalize_product_release_binding_v8', [root, admin, protocol, catalog, releaseConfig], coin);
  call(tx, publication, 'core', 'core_v8', 'share_maker_draft_v8', [root, base, treasury, admin], coin); return tx;
}

function countsRecord(value, label) { exact(value, ['tracks', 'colors', 'parts', 'items', 'styles', 'rules', 'assets'], label); return Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, String(u64(amount))])); }
function commitmentsRecord(value, label) { exact(value, ['tracks', 'colors', 'parts', 'items', 'styles', 'rules', 'assets', 'aggregate'], label); return Object.fromEntries(Object.entries(value).map(([key, digest]) => [key, hashHex(digest)])); }
function verifyRootReadback(publication, value) {
  const successor = publication.document.lineage.version > 1;
  exact(value, [
    'schemaVersion', 'source', 'transactionDigest', 'transactionKindBytesBase64',
    'transactionKindSha256', 'root', 'baseRegistry', 'makerTreasury', 'adminCap',
    ...(successor ? ['previousRoot'] : []),
  ], 'scaffoldReadback');
  for (const key of ['root', 'baseRegistry', 'makerTreasury']) requireReferenceKind(validateRef(value[key], key), 'shared', key);
  requireReferenceKind(validateRef(value.adminCap, 'adminCap'), 'owned', 'adminCap'); const c = publication.context;
  requireType(value.root, stableType(c, 'core', 'maker_v8', 'MakerRootV8', `<${c.paymentCoinType}>`), 'Root'); requireType(value.baseRegistry, stableType(c, 'core', 'base_registry_v8', 'BaseDefinitionRegistryV8'), 'Base registry'); requireType(value.makerTreasury, stableType(c, 'core', 'treasury_v8', 'MakerTreasuryV8', `<${c.paymentCoinType}>`), 'Maker treasury'); requireType(value.adminCap, stableType(c, 'core', 'maker_v8', 'MakerAdminCapV8'), 'AdminCap');
  const f = value.root.fields; exact(f, ['version', 'creator', 'owner', 'adminCapId', 'controlEpoch', 'lifecycle', 'makerKey', 'makerVersion', 'previousRootId', 'previousVersionCommitment', 'versionCommitment', 'rendererCommitment', 'manifestBlobId', 'manifestSha256', 'contentCommitment', 'protocolConfigId', 'protocolConfigRevision', 'protocolConfigCommitment', 'baseRegistryId', 'makerTreasuryId', 'expectedBaseDefinitionCount', 'expectedBaseRegistryCommitment', 'expectedPackAdmissionPolicyCommitment', 'economicsCommitment', 'rightsCommitment', 'catalogId', 'productBindingCommitment', 'callCapSetCommitment', 'sealedBaseRegistryCommitment', 'makerDocumentCommitment', 'creatorDefaultsCommitment', 'livingContentBindingCommitment'], 'root.fields');
  if (f.version !== 8 || f.lifecycle !== 0 || String(f.controlEpoch) !== '0' || f.makerVersion !== publication.document.lineage.version) fail('MAKER_V8_ROOT_READBACK_INVALID', 'Root is not exact DRAFT v8.');
  const expected = { makerDocumentCommitment: publication.commitments.makerDocument, creatorDefaultsCommitment: publication.commitments.creatorDefaults, livingContentBindingCommitment: publication.commitments.livingContentBinding, sealedBaseRegistryCommitment: null, creator: c.signerAddress, owner: c.signerAddress, adminCapId: oid(value.adminCap), makerKey: publication.document.lineage.makerKey, previousRootId: publication.document.lineage.previousRootId, previousVersionCommitment: publication.document.lineage.previousVersionCommitment, versionCommitment: publication.commitments.version, rendererCommitment: publication.commitments.renderer, manifestBlobId: publication.manifest.blobId, manifestSha256: publication.manifest.sha256, contentCommitment: publication.commitments.content, protocolConfigId: oid(c.protocolConfig), protocolConfigRevision: String(c.protocolConfig.fields.revision), protocolConfigCommitment: c.protocolConfig.fields.commitment, baseRegistryId: oid(value.baseRegistry), makerTreasuryId: oid(value.makerTreasury), expectedBaseDefinitionCount: String(Object.values(publication.counts).reduce((a, b) => a + b, 0n)), expectedBaseRegistryCommitment: publication.commitments.baseAuthorRows, expectedPackAdmissionPolicyCommitment: publication.commitments.packAdmissionPolicy, economicsCommitment: publication.commitments.economics, rightsCommitment: publication.commitments.rights, catalogId: oid(c.catalog), productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment };
  const ids = new Set(['creator', 'owner', 'adminCapId', 'previousRootId', 'protocolConfigId', 'baseRegistryId', 'makerTreasuryId', 'catalogId']); const hashes = new Set(['previousVersionCommitment']); for (const [key, expectedValue] of Object.entries(expected)) same(expectedValue === null ? f[key] : ids.has(key) ? normId(f[key]) : hashes.has(key) ? hashHex(f[key]) : String(f[key]), expectedValue === null ? null : String(expectedValue), 'MAKER_V8_ROOT_READBACK_MISMATCH', `Root ${key}`);
  const admin = value.adminCap.fields; exact(admin, ['version', 'rootId', 'owner', 'controlEpoch'], 'adminCap.fields'); if (admin.version !== 8 || String(admin.controlEpoch) !== '0') fail('MAKER_V8_ADMIN_READBACK_INVALID', 'AdminCap state is invalid.'); same(normId(admin.rootId), oid(value.root), 'MAKER_V8_ADMIN_READBACK_INVALID', 'Admin root'); same(normId(admin.owner), c.signerAddress, 'MAKER_V8_ADMIN_READBACK_INVALID', 'Admin owner');
  const treasury = value.makerTreasury.fields; exact(treasury, ['version', 'rootId', 'makerVersion', 'rootContentCommitment'], 'makerTreasury.fields'); if (treasury.version !== 8 || treasury.makerVersion !== publication.document.lineage.version) fail('MAKER_V8_MAKER_TREASURY_READBACK_INVALID', 'Maker treasury is invalid.'); same(normId(treasury.rootId), oid(value.root), 'MAKER_V8_MAKER_TREASURY_READBACK_INVALID', 'Treasury root'); same(hashHex(treasury.rootContentCommitment), publication.commitments.content, 'MAKER_V8_MAKER_TREASURY_READBACK_INVALID', 'Treasury content');
  if (successor) {
    requireReferenceKind(validateRef(value.previousRoot, 'previousRoot'), 'shared', 'previousRoot');
    requireType(value.previousRoot, publication.predecessor.root.type, 'Previous Root');
    same(oid(value.previousRoot), oid(publication.predecessor.root), 'MAKER_V8_SUCCESSOR_PREDECESSOR_READBACK_MISMATCH', 'Previous Root ID');
    const previous = value.previousRoot.fields;
    exact(previous, [
      'version', 'owner', 'adminCapId', 'controlEpoch', 'lifecycle', 'makerKey',
      'makerVersion', 'versionCommitment', 'successorAuthorityId', 'successorRootId',
    ], 'previousRoot.fields');
    const certified = publication.predecessor.root.fields;
    if (previous.version !== 8 || previous.lifecycle !== 3
      || previous.successorAuthorityId !== null
      || normId(previous.successorRootId) !== oid(value.root)) {
      fail('MAKER_V8_SUCCESSOR_PREDECESSOR_READBACK_MISMATCH', 'Finalized predecessor does not point to the exact successor Root.');
    }
    for (const [field, expectedValue] of Object.entries({
      owner: certified.owner,
      adminCapId: certified.adminCapId,
      controlEpoch: certified.controlEpoch,
      makerKey: certified.makerKey,
      makerVersion: certified.makerVersion,
      versionCommitment: certified.versionCommitment,
    })) {
      const actual = field === 'owner' || field === 'adminCapId'
        ? normId(previous[field])
        : field === 'versionCommitment'
          ? hashHex(previous[field])
          : String(previous[field]);
      same(actual, String(expectedValue), 'MAKER_V8_SUCCESSOR_PREDECESSOR_READBACK_MISMATCH', `Previous Root ${field}`);
    }
  }
}

export async function certifyMakerV8ScaffoldReadback(publication, readback) {
  requireCompiled(publication);
  const value = snapshot(readback, 'scaffoldReadback');
  if (value.schemaVersion !== MAKER_V8_SCAFFOLD_READBACK_SCHEMA || value.source !== 'FINALIZED_RPC' || typeof value.transactionDigest !== 'string' || !value.transactionDigest) fail('MAKER_V8_SCAFFOLD_SCHEMA_INVALID', 'Scaffold readback must come from an exact finalized RPC transaction.');
  verifyRootReadback(publication, value);
  const transactionKind = await verifyFinalizedTransactionKind({ transaction: buildMakerV8ScaffoldTransaction(publication) }, value, 'Scaffold');
  const progress = await storageProgress(publication, value);
  verifyBaseChunkState(publication, value, value.baseRegistry, progress.checkpoints[0]);
  value.transactionKind = transactionKind; delete value.transactionKindBytesBase64;
  freeze(value); scaffoldSet.add(value); scaffoldProgress.set(value, progress); return value;
}

function appendBaseRow(tx, publication, registry, root, admin, entry) {
  const args = { corePackageId: publication.context.catalog.fields.roles.core.callablePackageId,
    coreOriginalPackageId: publication.context.catalog.fields.roles.core.originalPackageId,
    paymentCoinType: publication.context.paymentCoinType, registry, root, admin, ...entry };
  return entry.kind === 'rule' ? appendMakerV8RuleRowCommands(tx, args) : appendMakerV8BaseRowCommandsV2(tx, args);
}

function historicalAdminCap(publication, anchor, proof) {
  exact(proof, ['type', 'reference', 'fields', 'owner'], 'AdminCap historical proof');
  exact(proof.owner, ['kind', 'value'], 'AdminCap historical owner');
  same(proof.owner.kind, 'AddressOwner', 'MAKER_V8_ADMIN_CAP_OWNER_MISMATCH', 'AdminCap owner kind');
  same(proof.owner.value, publication.context.signerAddress, 'MAKER_V8_ADMIN_CAP_OWNER_MISMATCH', 'AdminCap owner');
  const object = { type: proof.type, reference: proof.reference, fields: proof.fields };
  requireReferenceKind(validateRef(object, 'AdminCap'), 'owned', 'AdminCap');
  requireType(object, anchor.type, 'AdminCap');
  same(oid(object), oid(anchor), 'MAKER_V8_ADMIN_CAP_ID_MISMATCH', 'AdminCap ID');
  same(canonicalMakerV8Json(object.fields), canonicalMakerV8Json(anchor.fields), 'MAKER_V8_ADMIN_CAP_FIELDS_MISMATCH', 'AdminCap fields');
  if (BigInt(object.reference.version) < BigInt(anchor.reference.version)) fail('MAKER_V8_ADMIN_CAP_VERSION_MISMATCH', 'AdminCap historical version precedes its certified anchor.');
  return object;
}

function verifyAdminCapProgress(publication, anchor, value, expectedInput = null) {
  const input = historicalAdminCap(publication, anchor, value.inputAdminCap);
  const output = historicalAdminCap(publication, anchor, value.adminCap);
  if (expectedInput) same(canonicalMakerV8Json(input), canonicalMakerV8Json(expectedInput), 'MAKER_V8_ADMIN_CAP_INPUT_MISMATCH', 'AdminCap exact input');
  if (BigInt(output.reference.version) <= BigInt(input.reference.version)) fail('MAKER_V8_ADMIN_CAP_VERSION_MISMATCH', 'AdminCap output must advance its input version.');
  return output;
}

function makeBaseChunkTransaction(publication, scaffold, entries, seal, adminCap = scaffold.adminCap) {
  const tx = new Transaction(); tx.setSender(publication.context.signerAddress); const registry = objectArg(tx, scaffold.baseRegistry, true); const root = objectArg(tx, scaffold.root, seal); const admin = objectArg(tx, adminCap, false); entries.forEach((entry) => appendBaseRow(tx, publication, registry, root, admin, entry)); if (seal) call(tx, publication, 'core', 'base_registry_v8', 'seal_base_definition_registry_v8', [registry, root, admin], coinType(publication)); return tx;
}

async function transactionMetrics(transaction) {
  const kindBytes = await transaction.build({ onlyTransactionKind: true });
  const data = transaction.getData();
  const maxPureArgumentBytes = data.inputs.reduce((maximum, input) => Math.max(maximum,
    input.Pure ? fromBase64(input.Pure.bytes).length : 0), 0);
  return Object.freeze({ kindBytes: kindBytes.length, commands: data.commands.length, inputs: data.inputs.length, maxPureArgumentBytes });
}

async function assertSingleBaseRowBudgets(publication, entries) {
  // Fixed-width references model only TransactionKind size. These local objects
  // are never certified, returned, stored or used to build a signing transaction.
  const shared = objectId => ({ reference: { kind: 'shared', objectId, initialSharedVersion: '1' } });
  const shape = { baseRegistry: shared('0x1'), root: shared('0x2'),
    adminCap: { reference: { kind: 'owned', objectId: '0x3', version: '1', digest: '11111111111111111111111111111111' } } };
  for (const [index, entry] of entries.entries()) {
    const metrics = await transactionMetrics(makeBaseChunkTransaction(publication, shape, [entry], false));
    if (!transactionFits(metrics)) fail('MAKER_V8_TRANSACTION_LIMIT_UNSATISFIABLE',
      'A single Base row exceeds compiler transaction budgets before scaffold creation.',
      { phase: 'BASE_PREFLIGHT', kind: entry.kind, startSequence: String(index), metrics });
  }
}
async function verifyFinalizedTransactionKind(build, value, label) {
  const observed = bytes64(value.transactionKindBytesBase64, `${label} TransactionKind`); if (observed.length > MAKER_V8_TRANSACTION_LIMITS.maxKindBytes) fail('MAKER_V8_TRANSACTION_KIND_BYTE_BUDGET_EXCEEDED', `${label} TransactionKind exceeds the compiler budget.`, { byteLength: observed.length, maximum: MAKER_V8_TRANSACTION_LIMITS.maxKindBytes }); const observedSha256 = toHex(await sha(observed)); same(hashHex(value.transactionKindSha256), observedSha256, 'MAKER_V8_TRANSACTION_KIND_HASH_MISMATCH', `${label} TransactionKind SHA-256`); const expected = await build.transaction.build({ onlyTransactionKind: true }); if (expected.length !== observed.length) fail('MAKER_V8_TRANSACTION_KIND_MISMATCH', `${label} finalized TransactionKind length differs from the compiler build.`, { expectedByteLength: expected.length, observedByteLength: observed.length }); for (let index = 0; index < expected.length; index += 1) if (expected[index] !== observed[index]) fail('MAKER_V8_TRANSACTION_KIND_MISMATCH', `${label} finalized TransactionKind bytes differ from the compiler build.`, { byteIndex: index, expectedSha256: toHex(await sha(expected)), observedSha256 }); return Object.freeze({ byteLength: observed.length, sha256: observedSha256 });
}
function transactionFits(metrics) { return metrics.kindBytes <= MAKER_V8_TRANSACTION_LIMITS.maxKindBytes && metrics.commands <= MAKER_V8_TRANSACTION_LIMITS.maxCommands && metrics.inputs <= MAKER_V8_TRANSACTION_LIMITS.maxInputs && metrics.maxPureArgumentBytes <= MAKER_V8_TRANSACTION_LIMITS.maxPureArgumentBytes; }
function publicBaseCheckpoint(index, phase, start, end, expected, final, metrics) {
  return Object.freeze({ schemaVersion: MAKER_V8_PUBLICATION_TOPOLOGY.base.checkpointSchema,
    phase, lane: 'BASE', index, startSequence: String(start), endSequence: String(end), final,
    expected: Object.freeze({
      observedCounts: Object.freeze(Object.fromEntries(Object.entries(expected.observedCounts).map(([key, value]) => [key, String(value)]))),
      initialCommitments: expected.initialCommitments, rollingCommitments: expected.rollingCommitments,
      sealedCommitments: expected.sealedCommitments, authorRowsRollingCommitment: expected.authorRowsRollingCommitment,
      nextSequence: String(expected.nextSequence), protectedStyleCount: String(expected.protectedStyleCount),
      colorSwatchCount: String(expected.colorSwatchCount), totalCapacity: String(expected.totalCapacity),
      ruleSelectorCount: String(expected.ruleSelectorCount), visibilityLeafCount: String(expected.visibilityLeafCount),
      sealed: expected.sealed,
    }), metrics });
}

async function buildBaseChunkAt(publication, scaffold, { start, index, phase, adminCap = scaffold.adminCap }) {
  const progress = requireBaseProgress(publication, scaffold);
  const total = progress.flatRows.length; if (!Number.isSafeInteger(start) || start < 0 || start > total || !Number.isSafeInteger(index) || index < 0 || !MAKER_V8_PUBLICATION_TOPOLOGY.base.phases.includes(phase) || (phase === 'BASE_SEAL' && start !== total)) fail('MAKER_V8_BASE_PROGRESS_INVALID', 'Base checkpoint cursor is invalid.'); let end = phase === 'BASE_SEAL' ? total : Math.min(total, start + MAKER_V8_TRANSACTION_LIMITS.maxRowsPerChunk); let transaction; let metrics;
  do { transaction = makeBaseChunkTransaction(publication, scaffold, phase === 'BASE_SEAL' ? [] : progress.flatRows.slice(start, end), phase === 'BASE_SEAL', adminCap); metrics = await transactionMetrics(transaction); if (transactionFits(metrics)) break; end -= 1; } while (phase === 'BASE_APPEND' && end > start);
  if (!transactionFits(metrics)) fail('MAKER_V8_TRANSACTION_LIMIT_UNSATISFIABLE', 'A Base checkpoint exceeds compiler transaction budgets.', { phase, startSequence: String(start), metrics });
  const rowState = progress.checkpoints[end]; const final = phase === 'BASE_SEAL'; const expected = final ? Object.freeze({ ...rowState, sealed: true, sealedCommitments: progress.sealedCommitments }) : rowState; const nextPhase = final ? null : end === total ? 'BASE_SEAL' : 'BASE_APPEND'; const checkpoint = publicBaseCheckpoint(index, phase, start, end, expected, final, metrics); const result = Object.freeze({ transaction, checkpoint }); baseChunkBuilds.set(result, Object.freeze({ publication, scaffold, adminCap, index, phase, start, end, final, nextPhase, expected })); return result;
}

export async function buildMakerV8BaseChunkTransaction(publication, scaffold, priorCertificate = null) {
  requireCompiled(publication); if (!scaffoldSet.has(scaffold)) fail('MAKER_V8_SCAFFOLD_CONTEXT_REQUIRED', 'Verified scaffold readback is required.'); const progress = requireBaseProgress(publication, scaffold);
  let start = 0; let index = 0; let phase = progress.flatRows.length ? 'BASE_APPEND' : 'BASE_SEAL';
  if (priorCertificate !== null) { const priorMetadata = baseChunkCertificates.get(priorCertificate); if (!priorMetadata || priorMetadata.publication !== publication || priorMetadata.scaffold !== scaffold) fail('MAKER_V8_BASE_CHUNK_CERTIFICATE_REQUIRED', 'The exact prior finalized Base chunk certificate is required.'); if (priorMetadata.final) fail('MAKER_V8_BASE_ALREADY_COMPLETE', 'The Base registry is already sealed.'); start = priorMetadata.end; index = priorMetadata.index + 1; phase = priorMetadata.nextPhase; }
  return buildBaseChunkAt(publication, scaffold, { start, index, phase, adminCap: priorCertificate?.adminCap ?? scaffold.adminCap });
}

export function certifyMakerV8BaseReadback(publication, scaffold, readback) {
  requireCompiled(publication);
  if (!scaffoldSet.has(scaffold)) fail('MAKER_V8_SCAFFOLD_CONTEXT_REQUIRED', 'Verified scaffold readback is required.');
  const value = snapshot(readback, 'baseReadback');
  exact(value, ['schemaVersion', 'root', 'baseRegistry', 'inputAdminCap', 'adminCap'], 'baseReadback');
  const adminCap = verifyAdminCapProgress(publication, scaffold.adminCap, value);
  if (value.schemaVersion !== MAKER_V8_BASE_READBACK_SCHEMA) fail('MAKER_V8_BASE_SCHEMA_INVALID', 'Base schema is invalid.');
  const progress = requireBaseProgress(publication, scaffold);
  verifyBaseChunkState(publication, scaffold, value.baseRegistry, { ...progress.checkpoints.at(-1), sealed: true, sealedCommitments: progress.sealedCommitments });
  requireReferenceKind(validateRef(value.root, 'sealed Root'), 'shared', 'sealed Root');
  requireType(value.root, scaffold.root.type, 'sealed Root');
  same(oid(value.root), oid(scaffold.root), 'MAKER_V8_BASE_ROOT_MISMATCH', 'sealed Root');
  exact(value.root.fields, Object.keys(scaffold.root.fields), 'sealed Root.fields');
  for (const [key, original] of Object.entries(scaffold.root.fields)) {
    const expected = key === 'sealedBaseRegistryCommitment' ? progress.sealedCommitments.aggregate : original;
    same(canonicalMakerV8Json(value.root.fields[key]), canonicalMakerV8Json(expected), 'MAKER_V8_BASE_ROOT_MISMATCH', key);
  }
  const result = { schemaVersion: MAKER_V8_BASE_READBACK_SCHEMA, root: value.root, baseRegistry: value.baseRegistry, makerTreasury: scaffold.makerTreasury, adminCap };
  freeze(result); baseSet.add(result); return result;
}

function verifyBaseChunkState(publication, scaffold, baseRegistry, expected) {
  requireReferenceKind(validateRef(baseRegistry, 'baseRegistry'), 'shared', 'baseRegistry');
  same(oid(baseRegistry), oid(scaffold.baseRegistry), 'MAKER_V8_BASE_OBJECT_MISMATCH', 'Base ID');
  requireType(baseRegistry, scaffold.baseRegistry.type, 'Base registry');
  const f = baseRegistry.fields;
  exact(f, ['version', 'rootId', 'makerVersion', 'rootContentCommitment', 'expectedCounts', 'observedCounts',
    'initialCommitments', 'rollingCommitments', 'sealedCommitments', 'nextSequence', 'expectedSequenceCount',
    'protectedStyleCount', 'colorSwatchCount', 'totalCapacity', 'ruleSelectorCount', 'visibilityLeafCount',
    'authorRowsRollingCommitment', 'sealed'], 'baseRegistry.fields');
  if (f.version !== 8 || f.makerVersion !== publication.document.lineage.version || f.sealed !== expected.sealed) fail('MAKER_V8_BASE_CHUNK_STATE_MISMATCH', 'Base sealed state does not match its compiler checkpoint.');
  same(normId(f.rootId), oid(scaffold.root), 'MAKER_V8_BASE_ROOT_MISMATCH', 'Base root');
  same(hashHex(f.rootContentCommitment), publication.commitments.content, 'MAKER_V8_BASE_CONTENT_MISMATCH', 'Base content');
  for (const [field, wanted] of [['expectedCounts', publication.counts], ['observedCounts', expected.observedCounts]]) {
    const observed = countsRecord(f[field], field);
    for (const [key, amount] of Object.entries(wanted)) same(observed[key], String(amount), 'MAKER_V8_BASE_COUNT_MISMATCH', key);
  }
  for (const field of ['initialCommitments', 'rollingCommitments', 'sealedCommitments']) {
    if (expected[field] === null) same(f[field], null, 'MAKER_V8_BASE_COMMITMENT_MISMATCH', field);
    else {
      const observed = commitmentsRecord(f[field], field);
      for (const [key, digest] of Object.entries(expected[field])) same(observed[key], digest, 'MAKER_V8_BASE_COMMITMENT_MISMATCH', key);
    }
  }
  same(hashHex(f.authorRowsRollingCommitment), expected.authorRowsRollingCommitment, 'MAKER_V8_BASE_AUTHOR_COMMITMENT_MISMATCH', 'author row progress');
  same(String(f.expectedSequenceCount), String(publicationProgress.get(publication).author.total), 'MAKER_V8_BASE_SEQUENCE_MISMATCH', 'expected sequence');
  for (const key of ['nextSequence', 'protectedStyleCount', 'colorSwatchCount', 'totalCapacity', 'ruleSelectorCount', 'visibilityLeafCount']) {
    same(String(u64(f[key])), String(expected[key]), 'MAKER_V8_BASE_SEQUENCE_MISMATCH', key);
  }
}

export async function certifyMakerV8BaseChunkReadback(publication, scaffold, build, readback) {
  requireCompiled(publication); if (!scaffoldSet.has(scaffold)) fail('MAKER_V8_SCAFFOLD_CONTEXT_REQUIRED', 'Verified scaffold readback is required.'); const metadata = baseChunkBuilds.get(build); if (!metadata || metadata.publication !== publication || metadata.scaffold !== scaffold) fail('MAKER_V8_BASE_CHUNK_BUILD_REQUIRED', 'A compiler-produced Base chunk build is required.'); const value = snapshot(readback, 'baseChunkReadback'); exact(value, ['schemaVersion', 'source', 'transactionDigest', 'transactionKindBytesBase64', 'transactionKindSha256', 'root', 'baseRegistry', 'inputAdminCap', 'adminCap'], 'baseChunkReadback'); if (value.schemaVersion !== MAKER_V8_BASE_CHUNK_READBACK_SCHEMA || value.source !== 'FINALIZED_RPC' || typeof value.transactionDigest !== 'string' || !value.transactionDigest) fail('MAKER_V8_BASE_CHUNK_READBACK_INVALID', 'Base chunk readback must come from an exact finalized RPC transaction.'); const transactionKind = await verifyFinalizedTransactionKind(build, value, 'Base chunk'); verifyBaseChunkState(publication, scaffold, value.baseRegistry, metadata.expected); const adminCap = verifyAdminCapProgress(publication, scaffold.adminCap, value, metadata.adminCap);
  let base = null; if (metadata.final) base = certifyMakerV8BaseReadback(publication, scaffold, { schemaVersion: MAKER_V8_BASE_READBACK_SCHEMA, root: value.root, baseRegistry: value.baseRegistry, inputAdminCap: value.inputAdminCap, adminCap: value.adminCap }); else same(value.root, null, 'MAKER_V8_BASE_ROOT_MISMATCH', 'append Root must be an explicit unchanged null'); const result = { schemaVersion: MAKER_V8_BASE_CHUNK_READBACK_SCHEMA, source: value.source, transactionDigest: value.transactionDigest, transactionKind, checkpoint: build.checkpoint, base, adminCap }; freeze(result); baseChunkCertificates.set(result, Object.freeze({ publication, scaffold, index: metadata.index, phase: metadata.phase, start: metadata.start, end: metadata.end, final: metadata.final, nextPhase: metadata.nextPhase, digest: value.transactionDigest, transactionKind })); return result;
}

export async function rehydrateMakerV8BaseChunkCertificateV8(publication, scaffold, durable) {
  requireCompiled(publication); if (!scaffoldSet.has(scaffold)) fail('MAKER_V8_SCAFFOLD_CONTEXT_REQUIRED', 'Verified scaffold readback is required.'); const value = snapshot(durable, 'durableBaseCertificate'); exact(value, ['checkpoint', 'readback'], 'durableBaseCertificate'); const checkpoint = value.checkpoint; if (!plain(checkpoint) || checkpoint.schemaVersion !== MAKER_V8_PUBLICATION_TOPOLOGY.base.checkpointSchema) fail('MAKER_V8_BASE_PROGRESS_INVALID', 'Durable Base checkpoint schema is invalid.'); const build = await buildBaseChunkAt(publication, scaffold, { start: Number(u64(checkpoint.startSequence, 'Base startSequence')), index: Number(u64(checkpoint.index, 'Base index')), phase: checkpoint.phase, adminCap: historicalAdminCap(publication, scaffold.adminCap, value.readback.inputAdminCap) }); if (canonicalMakerV8Json(build.checkpoint) !== canonicalMakerV8Json(checkpoint)) fail('MAKER_V8_BASE_PROGRESS_INVALID', 'Durable Base checkpoint differs from deterministic compiler output.'); return certifyMakerV8BaseChunkReadback(publication, scaffold, build, value.readback);
}

async function companionCommitments(publication, base) {
  const c = publication.context; const rootId = oid(base.root); const baseId = oid(base.baseRegistry); const content = publication.commitments.content;
  const sealRows = [];
  for (const style of publication.rows.style.filter((row) => row.protected)) {
    const sequence = BigInt(sealRows.length); const scopeKey = 'maker/base'; const assetKey = `${style.part_key}/${style.item_key}/${style.style_key}`; const ciphertextBlobCommitment = await hashJson({ schemaVersion: 'animacraft.maker-v8-ciphertext-transport.v1', blobId: style.asset_blob_id, sha256: toHex(style.asset_sha256), byteLength: style.source.transport.byteLength, mediaType: style.source.transport.mediaType });
    const certificationCommitment = await hashBcs(CipherInput, { domain: 'animacraft-fresh-v8/seal/ciphertext-certification/v2', schema_revision: 2n, catalog_id: oid(c.catalog), product_binding_commitment: fromHex(c._derived.productBindingCommitment), policy_commitment: fromHex(c._derived.sealPolicyCommitment), root_content_commitment: fromHex(content), maker_version: BigInt(publication.document.lineage.version), scope_kind: 0, scope_key: scopeKey, scope_commitment: fromHex(content), asset_key: assetKey, asset_content_commitment: style.payload_commitment, ciphertext_blob_id: style.asset_blob_id, ciphertext_sha256: style.asset_sha256, ciphertext_blob_commitment: fromHex(ciphertextBlobCommitment) });
    const sealId = await hashBcs(SealIdInput, { domain: 'animacraft-fresh-v8/seal/ciphertext-id/v2', schema_revision: 2n, product_binding_commitment: fromHex(c._derived.productBindingCommitment), policy_commitment: fromHex(c._derived.sealPolicyCommitment), root_content_commitment: fromHex(content), maker_version: BigInt(publication.document.lineage.version), scope_kind: 0, scope_key: scopeKey, asset_key: assetKey });
    const row = { scope_kind: 0, scope_key: scopeKey, scope_commitment: fromHex(content), asset_key: assetKey, asset_content_commitment: style.payload_commitment, ciphertext_blob_id: style.asset_blob_id, ciphertext_sha256: style.asset_sha256, ciphertext_blob_commitment: fromHex(ciphertextBlobCommitment), certification_commitment: fromHex(certificationCommitment), seal_id: fromHex(sealId) };
    sealRows.push({ sequence, ...row, certificationCommitment, sealId, ciphertextBlobCommitment });
  }
  let outputCommitment = await hashBcs(OutputEmpty, { domain: domain('animacraft-v8/output/registry-empty'), version: VERSION, root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), renderer_commitment: fromHex(publication.commitments.renderer) }); const outputRows = [];
  for (const [index, output] of sorted(publication.document.outputs, (a, b) => compareMakerV8ProtocolText(a.key, b.key)).entries()) {
    const sequence = BigInt(index); const scopeKey = output.protected ? `complete/${output.key}` : ''; const rendererSchemaCommitment = await hashJson({ schemaVersion: 'animacraft.maker-v8-output-renderer.v1', key: output.key, label: output.label, payload: output.payload, canvas: publication.document.canvas }); const policyKind = output.allowedPackPolicy.kind === 'ALL_ADMITTED' ? 0 : 1;
    const rowCommitment = await hashBcs(OutputRowInput, { domain: domain('animacraft-v8/output/policy-row'), version: VERSION, root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), renderer_commitment: fromHex(publication.commitments.renderer), economics_commitment: fromHex(publication.commitments.economics), sequence, output_key: output.key, protected_output: output.protected, complete_scope_key: scopeKey, allowed_pack_policy: policyKind, allowed_semantic_pack_ids: output.allowedPackPolicy.packIds, renderer_schema_commitment: fromHex(rendererSchemaCommitment) }); outputCommitment = await hashBcs(OutputAdvance, { domain: domain('animacraft-v8/output/registry-row'), version: VERSION, root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), sequence, prior_commitment: fromHex(outputCommitment), row_commitment: fromHex(rowCommitment) }); outputRows.push({ sequence, outputKey: output.key, protected: output.protected, scopeKey, rendererSchemaCommitment, policyKind, packIds: output.allowedPackPolicy.packIds, rowCommitment, rollingCommitment: outputCommitment });
  }
  let physicalCommitment = await hashBcs(PhysicalEmpty, { domain: domain('animacraft-v8/physical/base-empty'), version: VERSION, product_binding_commitment: fromHex(c._derived.productBindingCommitment), root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), base_registry_id: baseId }); const physicalRows = [];
  for (const style of publication.rows.style.filter((row) => row.source.style.physical !== null)) {
    const policy = style.source.style.physical; const sequence = BigInt(physicalRows.length); const materialCommitment = await hashJson({ schemaVersion: 'animacraft.maker-v8-physical-material.v1', material: policy.material }); const styleIdentityCommitment = await hashBcs(StyleIdentity, { domain: domain('animacraft-v8/physical/base-style'), version: VERSION, root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), base_registry_id: baseId, part_key: style.part_key, item_key: style.item_key, style_key: style.style_key, layer_track_key: style.track_key, color_channel_key: style.color_channel_key, default_swatch_key: style.default_swatch_key, asset_blob_id: style.asset_blob_id, asset_sha256: style.asset_sha256, protected: style.protected, payload_commitment: style.payload_commitment }); const issuance = mapIssuance(policy.issuance); const proof = mapProof(policy.proof); const price = u64(policy.priceAtomic); const maxSupply = u64(policy.maxSupply); if (maxSupply === 0n || maxSupply > 1_000_000_000n || (issuance === 0 && (price !== 0n || proof !== 0)) || (issuance === 1 && (price === 0n || proof !== 0)) || (issuance === 2 && (price !== 0n || proof !== 2))) fail('MAKER_V8_PHYSICAL_POLICY_ABI_INVALID', `Physical policy ${style.part_key}/${style.item_key}/${style.style_key} would abort the v8 constructor.`);
    const rowCommitment = await hashBcs(PhysicalRowInput, { domain: domain('animacraft-v8/physical/base-policy'), version: VERSION, product_binding_commitment: fromHex(c._derived.productBindingCommitment), root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), base_registry_id: baseId, sequence, style_identity_commitment: fromHex(styleIdentityCommitment), material_policy_commitment: fromHex(materialCommitment), issuance_kind: issuance, proof_kind: proof, price_atomic: price, max_supply: maxSupply, transferable: policy.transferable }); physicalCommitment = await hashBcs(PhysicalAdvance, { domain: domain('animacraft-v8/physical/base-row'), version: VERSION, root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), sequence, prior_commitment: fromHex(physicalCommitment), row_commitment: fromHex(rowCommitment) }); physicalRows.push({ sequence, partKey: style.part_key, itemKey: style.item_key, styleKey: style.style_key, materialCommitment, issuance, proof, price, maxSupply, transferable: policy.transferable, rowCommitment, rollingCommitment: physicalCommitment });
  }
  return freeze({ seal: { rows: sealRows }, output: { rows: outputRows, commitment: outputCommitment }, physical: { rows: physicalRows, commitment: physicalCommitment } });
}

export async function buildMakerV8CompanionObjectsTransaction(publication, base) {
  requireCompiled(publication); if (!baseSet.has(base)) fail('MAKER_V8_BASE_CONTEXT_REQUIRED', 'Verified Base readback is required.'); const expected = await companionCommitments(publication, base); const tx = new Transaction(); const c = publication.context; tx.setSender(c.signerAddress); const coin = coinType(publication); const root = objectArg(tx, base.root, false); const admin = objectArg(tx, base.adminCap, false); const baseRegistry = objectArg(tx, base.baseRegistry, false); const catalog = objectArg(tx, c.catalog, false);
  const sealRegistry = call(tx, publication, 'seal', 'seal_v8', 'new_seal_registry_v8', [root, admin, objectArg(tx, c.configs.seal, false), tx.pure.u64(BigInt(expected.seal.rows.length)), tx.pure.u64(0n), tx.pure.u64(0n)], coin); call(tx, publication, 'seal', 'seal_v8', 'share_seal_registry_v8', [sealRegistry]);
  const [definitions, packs, authority] = call(tx, publication, 'runtime', 'runtime_v8', 'new_runtime_registries_v8', [root, admin, baseRegistry, tx.pure.u64(BigInt(publication.runtime.profiles.length)), pureBytes(tx, publication.runtime.profileCommitment), tx.pure.u8(publication.runtime.admission), tx.pure.bool(publication.runtime.itemAssetization)], coin); call(tx, publication, 'runtime', 'runtime_v8', 'share_runtime_definition_registry_v8', [definitions]); call(tx, publication, 'runtime', 'runtime_v8', 'share_pack_registry_v8', [packs]); call(tx, publication, 'runtime', 'runtime_v8', 'transfer_pack_admission_authority_v8', [authority, tx.pure.address(c.signerAddress)]);
  const [output, souls] = call(tx, publication, 'output', 'output_v8', 'new_output_registries_v8', [root, admin, tx.pure.u64(BigInt(expected.output.rows.length)), pureBytes(tx, expected.output.commitment)], coin); call(tx, publication, 'output', 'output_v8', 'share_output_registries_v8', [output, souls]);
  const physical = call(tx, publication, 'physical', 'physical_v8', 'new_physical_registry_v8', [root, admin, baseRegistry, catalog, objectArg(tx, c.configs.physical, false), tx.pure.u64(BigInt(expected.physical.rows.length)), pureBytes(tx, expected.physical.commitment)], coin); call(tx, publication, 'physical', 'physical_v8', 'share_physical_registry_v8', [physical]);
  const [market, marketTreasury] = call(tx, publication, 'market', 'market_v8', 'new_market_objects_v8', [root, admin, objectArg(tx, c.protocolConfig, false), catalog, objectArg(tx, c.activationAuthority.replacement, false), objectArg(tx, c.configs.market, false)], coin); call(tx, publication, 'market', 'market_v8', 'share_market_registry_v8', [market], coin); call(tx, publication, 'market', 'market_v8', 'share_market_treasury_v8', [marketTreasury], coin);
  return Object.freeze({ transaction: tx, expected });
}

function exactFreshObject(value, keys, label, versioned = true) {
  validateRef(value, label); exact(value.fields, keys, `${label}.fields`); if (versioned && value.fields.version !== 8) fail('MAKER_V8_COMPANION_VERSION_INVALID', `${label} is not v8.`); return value.fields;
}

export async function certifyMakerV8CompanionReadback(publication, base, readback) {
  requireCompiled(publication); if (!baseSet.has(base)) fail('MAKER_V8_BASE_CONTEXT_REQUIRED', 'Verified Base readback is required.'); const value = snapshot(readback, 'companionReadback');
  exact(value, ['schemaVersion', 'source', 'transactionDigest', 'transactionKindBytesBase64', 'transactionKindSha256', 'sealRegistry', 'runtimeDefinitions', 'packRegistry', 'admissionAuthority', 'outputRegistry', 'soulRegistry', 'physicalRegistry', 'marketRegistry', 'marketTreasury', 'inputAdminCap', 'adminCap'], 'companionReadback'); if (value.schemaVersion !== MAKER_V8_COMPANION_READBACK_SCHEMA || value.source !== 'FINALIZED_RPC' || typeof value.transactionDigest !== 'string' || !value.transactionDigest) fail('MAKER_V8_COMPANION_SCHEMA_INVALID', 'Companion readback must come from an exact finalized RPC transaction.');
  const adminCap = verifyAdminCapProgress(publication, base.adminCap, value, base.adminCap);
  const built = await buildMakerV8CompanionObjectsTransaction(publication, base); const transactionKind = await verifyFinalizedTransactionKind(built, value, 'Companion objects'); const c = publication.context; const rootId = oid(base.root); const content = publication.commitments.content; const expected = built.expected;
  const types = {
    sealRegistry: stableType(c, 'seal', 'seal_v8', 'SealRegistryV8'), runtimeDefinitions: stableType(c, 'runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'), packRegistry: stableType(c, 'runtime', 'runtime_v8', 'PackRegistryV8'), admissionAuthority: stableType(c, 'runtime', 'runtime_v8', 'PackAdmissionAuthorityV8'), outputRegistry: stableType(c, 'output', 'output_v8', 'OutputRegistryV8'), soulRegistry: stableType(c, 'output', 'output_v8', 'SoulRegistryV8'), physicalRegistry: stableType(c, 'physical', 'physical_v8', 'PhysicalRegistryV8'), marketRegistry: stableType(c, 'market', 'market_v8', 'MarketRegistryV8', `<${c.paymentCoinType}>`), marketTreasury: stableType(c, 'market', 'market_v8', 'MarketTreasuryV8', `<${c.paymentCoinType}>`),
  }; Object.entries(types).forEach(([key, type]) => { requireReferenceKind(validateRef(value[key], key), key === 'admissionAuthority' ? 'owned' : 'shared', key); requireType(value[key], type, key); });
  const sf = exactFreshObject(value.sealRegistry, MAKER_V8_SEAL_READBACK_FIELDS_V2, 'sealRegistry');
  const sealStorage = await deriveMakerV8SealStorageV2({ registryId: oid(value.sealRegistry), rootId, makerVersion: publication.document.lineage.version, rootContentCommitment: content, policyId: oid(c.configs.seal), rows: expected.seal.rows });
  const protectedCount = BigInt(expected.seal.rows.length); const sealPairs = { rootId, makerVersion: BigInt(publication.document.lineage.version), rootContentCommitment: content, catalogId: oid(c.catalog), productBindingCommitment: c._derived.productBindingCommitment, policyConfigId: oid(c.configs.seal), policyCommitment: c._derived.sealPolicyCommitment, expectedBaseCount: protectedCount, expectedPackCount: 0n, expectedCompleteCount: 0n, ...sealStorage.checkpoints[0] };
  for (const [key, want] of Object.entries(sealPairs)) same(String(sf[key]), String(want), 'MAKER_V8_SEAL_READBACK_MISMATCH', `Seal ${key}`);
  const rf = exactFreshObject(value.runtimeDefinitions, ['version', 'rootId', 'rootVersion', 'rootContentCommitment', 'baseRegistryId', 'expectedProfileCount', 'observedProfileCount', 'expectedProfileCommitment', 'rollingProfileCommitment', 'admissionCeiling', 'itemAssetization', 'sealed'], 'runtimeDefinitions'); const runtimeEmpty = await hashBcs(RuntimeEmpty, { domain: domain('animacraft-v8/runtime/part-profiles-empty'), version: VERSION, root_content_commitment: fromHex(content) }); const runtimePairs = { rootId, rootVersion: 1n, rootContentCommitment: content, baseRegistryId: oid(base.baseRegistry), expectedProfileCount: BigInt(publication.runtime.profiles.length), observedProfileCount: 0n, expectedProfileCommitment: publication.runtime.profileCommitment, rollingProfileCommitment: runtimeEmpty, admissionCeiling: publication.runtime.admission, itemAssetization: publication.runtime.itemAssetization, sealed: false }; for (const [key, want] of Object.entries(runtimePairs)) same(String(rf[key]), String(want), 'MAKER_V8_RUNTIME_READBACK_MISMATCH', `Runtime ${key}`);
  const pf = exactFreshObject(value.packRegistry, ['version', 'rootId', 'rootVersion', 'rootContentCommitment', 'definitionRegistryId', 'admissionAuthorityId', 'admissionPolicyCommitment', 'revision', 'releaseCount', 'externalAdmissionCount', 'wardrobeRevision', 'baseItemCount'], 'packRegistry'); const af = exactFreshObject(value.admissionAuthority, ['version', 'rootId', 'rootVersion', 'rootContentCommitment'], 'admissionAuthority');
  const packPairs = { rootId, rootVersion: 1n, rootContentCommitment: content, definitionRegistryId: oid(value.runtimeDefinitions), admissionAuthorityId: oid(value.admissionAuthority), admissionPolicyCommitment: publication.commitments.packAdmissionPolicy, revision: 0n, releaseCount: 0n, externalAdmissionCount: 0n, wardrobeRevision: 0n, baseItemCount: 0n }; for (const [key, want] of Object.entries(packPairs)) same(String(pf[key]), String(want), 'MAKER_V8_PACK_READBACK_MISMATCH', `Pack ${key}`); for (const [key, want] of Object.entries({ rootId, rootVersion: 1n, rootContentCommitment: content })) same(String(af[key]), String(want), 'MAKER_V8_AUTHORITY_READBACK_MISMATCH', `Authority ${key}`);
  const of = exactFreshObject(value.outputRegistry, ['version', 'rootId', 'makerVersion', 'rootContentCommitment', 'rendererCommitment', 'soulRegistryId', 'expectedOutputCount', 'observedOutputCount', 'expectedPolicyCommitment', 'rollingPolicyCommitment', 'sealed'], 'outputRegistry'); const outputEmpty = await hashBcs(OutputEmpty, { domain: domain('animacraft-v8/output/registry-empty'), version: VERSION, root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), renderer_commitment: fromHex(publication.commitments.renderer) }); const outputPairs = { rootId, makerVersion: BigInt(publication.document.lineage.version), rootContentCommitment: content, rendererCommitment: publication.commitments.renderer, soulRegistryId: oid(value.soulRegistry), expectedOutputCount: BigInt(expected.output.rows.length), observedOutputCount: 0n, expectedPolicyCommitment: expected.output.commitment, rollingPolicyCommitment: outputEmpty, sealed: false }; for (const [key, want] of Object.entries(outputPairs)) same(String(of[key]), String(want), 'MAKER_V8_OUTPUT_READBACK_MISMATCH', `Output ${key}`);
  const sof = exactFreshObject(value.soulRegistry, ['version', 'rootId', 'makerVersion', 'rootContentCommitment', 'outputRegistryId', 'soulCount'], 'soulRegistry'); for (const [key, want] of Object.entries({ rootId, makerVersion: BigInt(publication.document.lineage.version), rootContentCommitment: content, outputRegistryId: oid(value.outputRegistry), soulCount: 0n })) same(String(sof[key]), String(want), 'MAKER_V8_SOUL_READBACK_MISMATCH', `Soul ${key}`);
  const phf = exactFreshObject(value.physicalRegistry, ['version', 'catalogId', 'packageConfigId', 'productBindingCommitment', 'callCapSetCommitment', 'rootId', 'makerVersion', 'rootContentCommitment', 'baseRegistryId', 'expectedBasePolicyCount', 'observedBasePolicyCount', 'expectedBasePolicyCommitment', 'rollingBasePolicyCommitment', 'baseSealed', 'revision', 'packPolicyCount'], 'physicalRegistry'); const physicalEmpty = await hashBcs(PhysicalEmpty, { domain: domain('animacraft-v8/physical/base-empty'), version: VERSION, product_binding_commitment: fromHex(c._derived.productBindingCommitment), root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), base_registry_id: oid(base.baseRegistry) }); const physicalPairs = { catalogId: oid(c.catalog), packageConfigId: oid(c.configs.physical), productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment, rootId, makerVersion: BigInt(publication.document.lineage.version), rootContentCommitment: content, baseRegistryId: oid(base.baseRegistry), expectedBasePolicyCount: BigInt(expected.physical.rows.length), observedBasePolicyCount: 0n, expectedBasePolicyCommitment: expected.physical.commitment, rollingBasePolicyCommitment: physicalEmpty, baseSealed: false, revision: 0n, packPolicyCount: 0n }; for (const [key, want] of Object.entries(physicalPairs)) same(String(phf[key]), String(want), 'MAKER_V8_PHYSICAL_READBACK_MISMATCH', `Physical ${key}`);
  const mtf = exactFreshObject(value.marketTreasury, ['version', 'catalogId', 'packageConfigId', 'rootId', 'makerVersion', 'rootContentCommitment', 'balanceAtomic', 'grossEscrowedAtomic', 'grossReleasedAtomic'], 'marketTreasury'); for (const [key, want] of Object.entries({ catalogId: oid(c.catalog), packageConfigId: oid(c.configs.market), rootId, makerVersion: BigInt(publication.document.lineage.version), rootContentCommitment: content, balanceAtomic: 0n, grossEscrowedAtomic: 0n, grossReleasedAtomic: 0n })) same(String(mtf[key]), String(want), 'MAKER_V8_MARKET_TREASURY_READBACK_MISMATCH', `Market treasury ${key}`);
  const mf = exactFreshObject(value.marketRegistry, ['catalogId', 'packageConfigId', 'productBindingCommitment', 'callCapSetCommitment', 'rootId', 'makerVersion', 'rootContentCommitment', 'protocolConfigId', 'protocolConfigRevision', 'protocolConfigCommitment', 'economicsCommitment', 'rightsCommitment', 'makerMarketFeeBps', 'soulMarketFeeBps', 'soulCreatorRoyaltyBps', 'makerSourceRoyaltyBps', 'makerResaleRoyaltyBps', 'treasuryId', 'sealed', 'revision', 'listingCount', 'escrowCount', 'completedSaleCount', 'canceledSaleCount', 'recoveredSaleCount', 'grossVolumeAtomic', 'protocolPaidAtomic', 'creatorPaidAtomic', 'sourcePaidAtomic', 'sellerPaidAtomic', 'zeroStateCommitment'], 'marketRegistry', false);
  const marketPairs = { catalogId: oid(c.catalog), packageConfigId: oid(c.configs.market), productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment, rootId, makerVersion: BigInt(publication.document.lineage.version), rootContentCommitment: content, protocolConfigId: oid(c.protocolConfig), protocolConfigRevision: c.protocolConfig.fields.revision, protocolConfigCommitment: c.protocolConfig.fields.commitment, economicsCommitment: publication.commitments.economics, rightsCommitment: publication.commitments.rights, makerMarketFeeBps: c.protocolConfig.fields.makerMarketFeeBps, soulMarketFeeBps: c.protocolConfig.fields.soulMarketFeeBps, soulCreatorRoyaltyBps: publication.document.commerce.soulCreatorRoyaltyBps, makerSourceRoyaltyBps: publication.document.commerce.makerSourceRoyaltyBps, makerResaleRoyaltyBps: publication.document.commerce.makerResaleRoyaltyBps, treasuryId: oid(value.marketTreasury), sealed: false, revision: 0n, listingCount: 0n, escrowCount: 0n, completedSaleCount: 0n, canceledSaleCount: 0n, recoveredSaleCount: 0n, grossVolumeAtomic: 0n, protocolPaidAtomic: 0n, creatorPaidAtomic: 0n, sourcePaidAtomic: 0n, sellerPaidAtomic: 0n };
  for (const [key, want] of Object.entries(marketPairs)) same(String(mf[key]), String(want), 'MAKER_V8_MARKET_READBACK_MISMATCH', `Market ${key}`); const zeroStateCommitment = await hashBcs(MarketZero, { domain: domain('animacraft-v8/market/zero-state'), version: VERSION, catalog_id: oid(c.catalog), package_config_id: oid(c.configs.market), product_binding_commitment: fromHex(c._derived.productBindingCommitment), call_cap_set_commitment: fromHex(c._derived.callCapSetCommitment), root_id: rootId, maker_version: BigInt(publication.document.lineage.version), root_content_commitment: fromHex(content), protocol_config_id: oid(c.protocolConfig), protocol_config_revision: u64(c.protocolConfig.fields.revision), protocol_config_commitment: fromHex(c.protocolConfig.fields.commitment), economics_commitment: fromHex(publication.commitments.economics), rights_commitment: fromHex(publication.commitments.rights), maker_market_fee_bps: u16(c.protocolConfig.fields.makerMarketFeeBps), soul_market_fee_bps: u16(c.protocolConfig.fields.soulMarketFeeBps), soul_creator_royalty_bps: u16(publication.document.commerce.soulCreatorRoyaltyBps), maker_source_royalty_bps: u16(publication.document.commerce.makerSourceRoyaltyBps), maker_resale_royalty_bps: u16(publication.document.commerce.makerResaleRoyaltyBps), treasury_id: oid(value.marketTreasury) }); same(hashHex(mf.zeroStateCommitment), zeroStateCommitment, 'MAKER_V8_MARKET_ZERO_COMMITMENT_MISMATCH', 'Market zero state');
  value.adminCap = adminCap; delete value.inputAdminCap;
  value.expected = freeze({ ...expected, seal: { ...expected.seal, storage: sealStorage } }); value.transactionKind = transactionKind; delete value.transactionKindBytesBase64; freeze(value); companionSet.add(value); return value;
}

const ACTIVATION_PHASES = Object.freeze(MAKER_V8_PUBLICATION_TOPOLOGY.activation.phases.map((phase) => phase.replace(/^ACTIVATION_/, '')));
function activationRows(publication, companion, lane) { if (lane === 'SEAL') return companion.expected.seal.rows; if (lane === 'RUNTIME') return publication.runtime.profiles; if (lane === 'OUTPUT') return companion.expected.output.rows; if (lane === 'PHYSICAL') return companion.expected.physical.rows; return []; }
function makeActivationPhaseTransaction(publication, base, companion, phase, rows, sealPhase, adminCap) {
  const tx = new Transaction(); const c = publication.context; tx.setSender(c.signerAddress); const coin = coinType(publication); const root = objectArg(tx, base.root, phase === 'FINALIZE'); const admin = objectArg(tx, adminCap, false); const baseRegistry = objectArg(tx, base.baseRegistry, false); const catalog = objectArg(tx, c.catalog, false);
  if (phase === 'SEAL') { const registry = objectArg(tx, companion.sealRegistry, true); const policy = objectArg(tx, c.configs.seal, false); const protocol = objectArg(tx, c.protocolConfig, false); const releaseConfig = objectArg(tx, c.configs.release, false); for (const row of rows) { const certification = call(tx, publication, 'release', 'release_v8', 'certify_base_ciphertext_v8', [protocol, catalog, releaseConfig, policy, root, tx.pure.string(row.scope_key), pureBytes(tx, row.scope_commitment), tx.pure.string(row.asset_key), pureBytes(tx, row.asset_content_commitment), tx.pure.string(row.ciphertext_blob_id), pureBytes(tx, row.ciphertext_sha256), pureBytes(tx, row.ciphertext_blob_commitment)], coin); call(tx, publication, 'seal', 'seal_v8', 'append_protected_asset_v8', [registry, root, admin, policy, tx.pure.u64(row.sequence), certification], coin); } if (sealPhase) call(tx, publication, 'seal', 'seal_v8', 'seal_registry_v8', [registry, root, admin, policy], coin); }
  if (phase === 'RUNTIME') { const definitions = objectArg(tx, companion.runtimeDefinitions, true); for (const profile of rows) call(tx, publication, 'runtime', 'runtime_v8', 'append_part_profile_v8', [definitions, root, admin, baseRegistry, tx.pure.u64(profile.sequence), tx.pure.string(profile.partKey), tx.pure.u8(profile.wardrobeMode), tx.pure.u8(profile.behavior), tx.pure.u64(profile.capacity)], coin); if (sealPhase) call(tx, publication, 'runtime', 'runtime_v8', 'seal_runtime_definitions_v8', [definitions, root, admin, baseRegistry], coin); }
  if (phase === 'OUTPUT') { const output = objectArg(tx, companion.outputRegistry, true); for (const row of rows) call(tx, publication, 'output', 'output_v8', 'append_output_policy_v8', [output, root, admin, tx.pure.u64(row.sequence), tx.pure.string(row.outputKey), tx.pure.bool(row.protected), tx.pure.string(row.scopeKey), pureBytes(tx, row.rendererSchemaCommitment), tx.pure.u8(row.policyKind), tx.pure.vector('string', row.packIds), pureBytes(tx, row.rowCommitment)], coin); if (sealPhase) call(tx, publication, 'output', 'output_v8', 'seal_output_registry_v8', [output, root, admin], coin); }
  if (phase === 'PHYSICAL') { const physical = objectArg(tx, companion.physicalRegistry, true); const physicalConfig = objectArg(tx, c.configs.physical, false); for (const row of rows) call(tx, publication, 'physical', 'physical_v8', 'append_base_style_policy_v8', [physical, root, admin, baseRegistry, catalog, physicalConfig, tx.pure.u64(row.sequence), tx.pure.string(row.partKey), tx.pure.string(row.itemKey), tx.pure.string(row.styleKey), pureBytes(tx, row.materialCommitment), tx.pure.u8(row.issuance), tx.pure.u8(row.proof), tx.pure.u64(row.price), tx.pure.u64(row.maxSupply), tx.pure.bool(row.transferable), pureBytes(tx, row.rowCommitment)], coin); if (sealPhase) call(tx, publication, 'physical', 'physical_v8', 'seal_physical_registry_v8', [physical, root, admin, baseRegistry, catalog, physicalConfig], coin); }
  if (phase === 'FINALIZE') {
    const protocol = objectArg(tx, c.protocolConfig, false);
    const releaseConfig = objectArg(tx, c.configs.release, false);
    const sealPolicy = objectArg(tx, c.configs.seal, false);
    const outputConfig = objectArg(tx, c.configs.output, false);
    const physicalConfig = objectArg(tx, c.configs.physical, false);
    const marketConfig = objectArg(tx, c.configs.market, false);
    const sealRegistry = objectArg(tx, companion.sealRegistry, false);
    const definitions = objectArg(tx, companion.runtimeDefinitions, false);
    const packs = objectArg(tx, companion.packRegistry, false);
    const admission = objectArg(tx, companion.admissionAuthority, false);
    const output = objectArg(tx, companion.outputRegistry, false);
    const souls = objectArg(tx, companion.soulRegistry, false);
    const physical = objectArg(tx, companion.physicalRegistry, false);
    const market = objectArg(tx, companion.marketRegistry, true);
    const marketTreasury = objectArg(tx, companion.marketTreasury, false);
    const authority = c.activationAuthority;
    const replacement = objectArg(tx, authority.replacement, false);
    const bootstrap = objectArg(tx, authority.bootstrapCertificate, false);
    const walrusPolicy = objectArg(tx, authority.walrusPolicy, true);
    const walrusSystem = objectArg(tx, authority.walrusSystem, false);
    const livingBlob = objectArg(tx, authority.livingBlob, false);
    const living = publication.livingContent;
    call(tx, publication, 'market', 'market_v8', 'seal_market_registry_v8',
      [market, marketTreasury, root, admin, protocol, catalog, replacement, marketConfig], coin);
    const binding = call(tx, publication, 'core', 'core_v8', 'new_living_content_binding_v8',
      [pureBytes(tx, publication.commitments.creatorDefaults), tx.pure.string(living.blobId),
        pureBytes(tx, living.sha256), tx.pure.u64(living.byteLength), pureBytes(tx, living.bundleCommitment)]);
    // The author's same PTB obtains storage proof from the real Walrus objects.
    // No platform signature, author-supplied attestation, or retained role cap.
    const certificate = call(tx, publication, 'core', 'core_v8', 'certify_walrus_living_content_v1',
      [protocol, catalog, walrusPolicy, root, admin, binding, livingBlob, walrusSystem], coin);
    const partial = call(tx, publication, 'release', 'release_v8', 'prepare_maker_companion_binding_v2',
      [root, admin, protocol, catalog, replacement, baseRegistry, walrusPolicy, certificate, walrusSystem,
        definitions, packs, admission, sealPolicy, sealRegistry, outputConfig, output, souls,
        physicalConfig, physical], coin);
    const complete = call(tx, publication, 'market', 'market_v8', 'bind_maker_market_companion_v2',
      [partial, root, admin, protocol, catalog, replacement, marketConfig, market, marketTreasury], coin);
    call(tx, publication, 'core', 'core_v8', 'finish_maker_companion_binding_v2',
      [complete, root, admin, protocol, catalog, replacement, baseRegistry, walrusPolicy, certificate, walrusSystem], coin);
    call(tx, publication, 'release', 'release_v8', 'seal_and_activate_maker_v8',
      [root, admin, protocol, catalog, replacement, bootstrap, walrusPolicy, certificate, walrusSystem,
        baseRegistry, releaseConfig], coin);
    call(tx, publication, 'core', 'core_v8', 'freeze_certified_living_content_v1', [certificate]);
    // Protocol 137 unified linkage lifts every public call's Walrus dependency
    // to this separately certified execution package, retaining the static v2
    // package evidence. The genuine System version check still runs in Move.
    const walrusExecution = assertMakerV8WalrusExecutionV1(authority.walrusExecution,
      { minimumDependency: MAKER_V8_WALRUS_MINIMUM_DEPENDENCY });
    tx.moveCall({ target: `${walrusExecution.packageId}::system::epoch`, arguments: [walrusSystem] });
  }
  return tx;
}

function activationExpected(companion, publication, phase, end, sealed) {
  if (phase === 'SEAL') { const fields = sealed ? companion.expected.seal.storage.sealed : companion.expected.seal.storage.checkpoints[end]; return Object.freeze({ objectKey: 'sealRegistry', observedCount: String(end), rollingCommitment: fields.commitment, sealed, fields }); }
  if (phase === 'RUNTIME') return Object.freeze({ objectKey: 'runtimeDefinitions', observedCount: String(end), rollingCommitment: end ? publication.runtime.profiles[end - 1].rollingProfileCommitment : companion.runtimeDefinitions.fields.rollingProfileCommitment, sealed });
  if (phase === 'OUTPUT') return Object.freeze({ objectKey: 'outputRegistry', observedCount: String(end), rollingCommitment: end ? companion.expected.output.rows[end - 1].rollingCommitment : companion.outputRegistry.fields.rollingPolicyCommitment, sealed });
  if (phase === 'PHYSICAL') return Object.freeze({ objectKey: 'physicalRegistry', observedCount: String(end), rollingCommitment: end ? companion.expected.physical.rows[end - 1].rollingCommitment : companion.physicalRegistry.fields.rollingBasePolicyCommitment, sealed });
  return Object.freeze({ objectKey: 'root', lifecycle: 'ACTIVE' });
}

async function buildActivationChunkAt(publication, base, companion, { phaseIndex, start, index, adminCap = companion.adminCap }) {
  while (ACTIVATION_PHASES[phaseIndex]?.endsWith('_APPEND')) { const lane = ACTIVATION_PHASES[phaseIndex].split('_')[0]; if (activationRows(publication, companion, lane).length) break; phaseIndex += 1; start = 0; }
  const phase = ACTIVATION_PHASES[phaseIndex]; if (!phase) fail('MAKER_V8_ACTIVATION_PROGRESS_INVALID', 'Activation progress is invalid.'); const final = phase === 'FINALIZE'; const [lane, action = 'FINALIZE'] = final ? ['FINALIZE', 'FINALIZE'] : phase.split('_'); const allRows = activationRows(publication, companion, lane); const sealPhase = action === 'SEAL'; let end = final ? 0 : sealPhase ? allRows.length : Math.min(allRows.length, start + MAKER_V8_TRANSACTION_LIMITS.maxRowsPerChunk); let transaction; let metrics;
  do { transaction = makeActivationPhaseTransaction(publication, base, companion, lane, sealPhase ? [] : allRows.slice(start, end), sealPhase, adminCap); metrics = await transactionMetrics(transaction); if (transactionFits(metrics)) break; end -= 1; } while (action === 'APPEND' && end > start);
  if (!transactionFits(metrics)) fail('MAKER_V8_TRANSACTION_LIMIT_UNSATISFIABLE', 'An Activation checkpoint exceeds the pinned Sui transaction limits.', { phase, startSequence: String(start), metrics }); const appendComplete = action === 'APPEND' && end === allRows.length; const nextPhaseIndex = final ? ACTIVATION_PHASES.length : sealPhase || appendComplete ? phaseIndex + 1 : phaseIndex; const nextStart = final || sealPhase ? 0 : end; const expected = activationExpected(companion, publication, lane, end, sealPhase); const checkpoint = Object.freeze({ schemaVersion: MAKER_V8_PUBLICATION_TOPOLOGY.activation.checkpointSchema, phase: `ACTIVATION_${phase}`, lane, action, index, startSequence: String(start), endSequence: String(end), final, expected, metrics }); const result = Object.freeze({ transaction, checkpoint }); activationChunkBuilds.set(result, Object.freeze({ publication, base, companion, adminCap, phase, lane, action, phaseIndex, index, start, end, final, nextPhaseIndex, nextStart, expected })); return result;
}

export async function buildMakerV8ActivationChunkTransaction(publication, base, companion, priorCertificate = null) {
  requireCompiled(publication); if (!baseSet.has(base)) fail('MAKER_V8_BASE_CONTEXT_REQUIRED', 'Verified Base readback is required.'); if (!companionSet.has(companion)) fail('MAKER_V8_COMPANION_CONTEXT_REQUIRED', 'Verified companion readback is required.'); let phaseIndex = 0; let start = 0; let index = 0;
  if (priorCertificate !== null) { const prior = activationChunkCertificates.get(priorCertificate); if (!prior || prior.publication !== publication || prior.base !== base || prior.companion !== companion) fail('MAKER_V8_ACTIVATION_CHUNK_CERTIFICATE_REQUIRED', 'The exact prior finalized Activation chunk certificate is required.'); if (prior.final) fail('MAKER_V8_ACTIVATION_ALREADY_COMPLETE', 'Activation is already certified.'); phaseIndex = prior.nextPhaseIndex; start = prior.nextStart; index = prior.index + 1; }
  return buildActivationChunkAt(publication, base, companion, { phaseIndex, start, index, adminCap: priorCertificate?.adminCap ?? companion.adminCap });
}

function verifyActivationChunkObject(publication, base, companion, metadata, object) {
  const { phase, lane, expected } = metadata; const expectedObject = companion[expected.objectKey]; requireReferenceKind(validateRef(object, expected.objectKey), 'shared', expected.objectKey); same(oid(object), oid(expectedObject), 'MAKER_V8_ACTIVATION_OBJECT_MISMATCH', `${phase} object ID`); requireType(object, expectedObject.type, `${phase} object`); const f = object.fields;
  if (lane === 'SEAL') { exact(f, MAKER_V8_SEAL_READBACK_FIELDS_V2, 'sealRegistry.fields'); const wanted = { ...companion.sealRegistry.fields, ...expected.fields }; for (const [key, value] of Object.entries(wanted)) same(String(f[key]), String(value), 'MAKER_V8_ACTIVATION_SEAL_MISMATCH', `Seal ${key}`); }
  if (lane === 'RUNTIME') { exact(f, ['version', 'rootId', 'rootVersion', 'rootContentCommitment', 'baseRegistryId', 'expectedProfileCount', 'observedProfileCount', 'expectedProfileCommitment', 'rollingProfileCommitment', 'admissionCeiling', 'itemAssetization', 'sealed'], 'runtimeDefinitions.fields'); same(String(f.observedProfileCount), expected.observedCount, 'MAKER_V8_ACTIVATION_COUNT_MISMATCH', 'Runtime observed count'); same(f.itemAssetization, publication.runtime.itemAssetization, 'MAKER_V8_ACTIVATION_POLICY_MISMATCH', 'Runtime Item assetization'); }
  if (lane === 'OUTPUT') { exact(f, ['version', 'rootId', 'makerVersion', 'rootContentCommitment', 'rendererCommitment', 'soulRegistryId', 'expectedOutputCount', 'observedOutputCount', 'expectedPolicyCommitment', 'rollingPolicyCommitment', 'sealed'], 'outputRegistry.fields'); same(String(f.observedOutputCount), expected.observedCount, 'MAKER_V8_ACTIVATION_COUNT_MISMATCH', 'Output observed count'); }
  if (lane === 'PHYSICAL') { exact(f, ['version', 'catalogId', 'packageConfigId', 'productBindingCommitment', 'callCapSetCommitment', 'rootId', 'makerVersion', 'rootContentCommitment', 'baseRegistryId', 'expectedBasePolicyCount', 'observedBasePolicyCount', 'expectedBasePolicyCommitment', 'rollingBasePolicyCommitment', 'baseSealed', 'revision', 'packPolicyCount'], 'physicalRegistry.fields'); same(String(f.observedBasePolicyCount), expected.observedCount, 'MAKER_V8_ACTIVATION_COUNT_MISMATCH', 'Physical observed count'); }
  if (f.version !== 8) fail('MAKER_V8_ACTIVATION_VERSION_MISMATCH', 'Activation registry is not v8.'); same(normId(f.rootId), oid(base.root), 'MAKER_V8_ACTIVATION_ROOT_MISMATCH', `${phase} root`); same(hashHex(f.rootContentCommitment), publication.commitments.content, 'MAKER_V8_ACTIVATION_CONTENT_MISMATCH', `${phase} content`); const rollingField = lane === 'SEAL' ? 'commitment' : lane === 'RUNTIME' ? 'rollingProfileCommitment' : lane === 'OUTPUT' ? 'rollingPolicyCommitment' : 'rollingBasePolicyCommitment'; const sealedField = lane === 'PHYSICAL' ? 'baseSealed' : 'sealed'; same(hashHex(f[rollingField]), expected.rollingCommitment, 'MAKER_V8_ACTIVATION_ROLLING_MISMATCH', `${phase} rolling commitment`); same(f[sealedField], expected.sealed, 'MAKER_V8_ACTIVATION_SEALED_MISMATCH', `${phase} sealed state`);
}

export async function certifyMakerV8ActivationReadback(publication, base, companion, build, readback) {
  requireCompiled(publication); const metadata = activationChunkBuilds.get(build); if (!metadata || metadata.publication !== publication || metadata.base !== base || metadata.companion !== companion || metadata.phase !== 'FINALIZE') fail('MAKER_V8_ACTIVATION_BUILD_REQUIRED', 'The exact compiler-produced final Activation build is required.'); const value = snapshot(readback, 'activationReadback'); exact(value, ['schemaVersion', 'source', 'transactionDigest', 'transactionKindBytesBase64', 'transactionKindSha256', 'rootId', 'makerVersion', 'lifecycle', 'makerKey', 'versionCommitment', 'manifestSha256', 'contentCommitment', 'protocolConfigCommitment', 'productBindingCommitment', 'callCapSetCommitment', 'inputAdminCap', 'adminCap'], 'activationReadback'); if (value.schemaVersion !== MAKER_V8_ACTIVATION_READBACK_SCHEMA || value.source !== 'FINALIZED_RPC' || typeof value.transactionDigest !== 'string' || !value.transactionDigest || value.lifecycle !== 'ACTIVE' || value.makerVersion !== publication.document.lineage.version) fail('MAKER_V8_ACTIVATION_READBACK_INVALID', 'Activation readback must be exact finalized ACTIVE v8 state.'); const transactionKind = await verifyFinalizedTransactionKind(build, value, 'Activation'); const expected = { rootId: oid(base.root), makerKey: publication.document.lineage.makerKey, versionCommitment: publication.commitments.version, manifestSha256: publication.manifest.sha256, contentCommitment: publication.commitments.content, protocolConfigCommitment: publication.context.protocolConfig.fields.commitment, productBindingCommitment: publication.context._derived.productBindingCommitment, callCapSetCommitment: publication.context._derived.callCapSetCommitment }; for (const [key, wanted] of Object.entries(expected)) same(key === 'rootId' ? normId(value[key]) : key.endsWith('Commitment') || key.endsWith('Sha256') ? hashHex(value[key]) : String(value[key]), wanted, 'MAKER_V8_ACTIVATION_READBACK_MISMATCH', `Activation ${key}`); value.adminCap = verifyAdminCapProgress(publication, base.adminCap, value, metadata.adminCap); delete value.inputAdminCap; value.transactionKind = transactionKind; delete value.transactionKindBytesBase64; freeze(value); activationSet.add(value); return value;
}

export async function certifyMakerV8ActivationChunkReadback(publication, base, companion, build, readback) {
  const metadata = activationChunkBuilds.get(build); if (!metadata || metadata.publication !== publication || metadata.base !== base || metadata.companion !== companion) fail('MAKER_V8_ACTIVATION_CHUNK_BUILD_REQUIRED', 'A compiler-produced Activation chunk build is required.'); if (metadata.final) { const activation = await certifyMakerV8ActivationReadback(publication, base, companion, build, readback); activationChunkCertificates.set(activation, Object.freeze({ publication, base, companion, index: metadata.index, final: true, nextPhaseIndex: ACTIVATION_PHASES.length, nextStart: 0, digest: activation.transactionDigest, transactionKind: activation.transactionKind })); return activation; } const value = snapshot(readback, 'activationChunkReadback'); exact(value, ['schemaVersion', 'source', 'transactionDigest', 'transactionKindBytesBase64', 'transactionKindSha256', 'phase', 'object', 'inputAdminCap', 'adminCap'], 'activationChunkReadback'); if (value.schemaVersion !== MAKER_V8_ACTIVATION_CHUNK_READBACK_SCHEMA || value.source !== 'FINALIZED_RPC' || value.phase !== metadata.phase || typeof value.transactionDigest !== 'string' || !value.transactionDigest) fail('MAKER_V8_ACTIVATION_CHUNK_READBACK_INVALID', 'Activation chunk readback must match its exact finalized phase.'); const transactionKind = await verifyFinalizedTransactionKind(build, value, 'Activation chunk'); verifyActivationChunkObject(publication, base, companion, metadata, value.object); const adminCap = verifyAdminCapProgress(publication, base.adminCap, value, metadata.adminCap); const result = { schemaVersion: MAKER_V8_ACTIVATION_CHUNK_READBACK_SCHEMA, source: value.source, transactionDigest: value.transactionDigest, transactionKind, checkpoint: build.checkpoint, adminCap }; freeze(result); activationChunkCertificates.set(result, Object.freeze({ publication, base, companion, index: metadata.index, final: false, nextPhaseIndex: metadata.nextPhaseIndex, nextStart: metadata.nextStart, digest: value.transactionDigest, transactionKind })); return result;
}

export async function rehydrateMakerV8ActivationChunkCertificateV8(publication, base, companion, durable) {
  requireCompiled(publication); if (!baseSet.has(base)) fail('MAKER_V8_BASE_CONTEXT_REQUIRED', 'Verified Base readback is required.'); if (!companionSet.has(companion)) fail('MAKER_V8_COMPANION_CONTEXT_REQUIRED', 'Verified companion readback is required.'); const value = snapshot(durable, 'durableActivationCertificate'); exact(value, ['checkpoint', 'readback'], 'durableActivationCertificate'); const checkpoint = value.checkpoint; if (!plain(checkpoint) || checkpoint.schemaVersion !== MAKER_V8_PUBLICATION_TOPOLOGY.activation.checkpointSchema || typeof checkpoint.phase !== 'string') fail('MAKER_V8_ACTIVATION_PROGRESS_INVALID', 'Durable Activation checkpoint schema is invalid.'); const phaseName = checkpoint.phase.replace(/^ACTIVATION_/, ''); const phaseIndex = ACTIVATION_PHASES.indexOf(phaseName); if (phaseIndex < 0) fail('MAKER_V8_ACTIVATION_PROGRESS_INVALID', 'Durable Activation phase is invalid.'); const build = await buildActivationChunkAt(publication, base, companion, { phaseIndex, start: Number(u64(checkpoint.startSequence, 'Activation startSequence')), index: Number(u64(checkpoint.index, 'Activation index')), adminCap: historicalAdminCap(publication, base.adminCap, value.readback.inputAdminCap) }); if (canonicalMakerV8Json(build.checkpoint) !== canonicalMakerV8Json(checkpoint)) fail('MAKER_V8_ACTIVATION_PROGRESS_INVALID', 'Durable Activation checkpoint differs from deterministic compiler output.'); return certifyMakerV8ActivationChunkReadback(publication, base, companion, build, value.readback);
}

export function exactMakerV8TransactionTargets(transaction) {
  if (!(transaction instanceof Transaction)) fail('MAKER_V8_TRANSACTION_REQUIRED', 'A Sui Transaction is required.'); return Object.freeze(transaction.getData().commands.filter((command) => command.$kind === 'MoveCall').map((command) => `${command.MoveCall.package}::${command.MoveCall.module}::${command.MoveCall.function}`));
}
