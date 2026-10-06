import { MAKER_V8_SUI_MAINNET_GENESIS_DIGEST } from './maker-v8-sui-grpc.js';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8ChainTypes,
} from './maker-v8-chain.js';
import { MAKER_V8_PLAYER_VIEW_SCHEMA } from './maker-v8-catalog-adapter.js';
import {
  assertMakerV8Document,
  compareMakerV8ProtocolText,
  projectPublicMakerV8Document,
} from './maker-v8-document.js';
import {
  isDefinitiveWalletStandardRejectionV8,
} from './maker-v8-browser.js';
import {
  MAKER_V8_PRODUCT_RUNTIME_SCHEMA,
} from './maker-v8-product-runtime.js';
import { MAKER_V8_CLOCK_OBJECT_ID, assertMakerV8Runtime } from './maker-v8-runtime.js';
import { makerV8PlayerRecipeConstraintIssue } from './maker-v8-player-recipe-constraints.js';
import { assertMakerV8NativeCompletionInputV8 } from './maker-v8-native-completion.js';
import { assertMakerV8NativeContentEvidenceV8 } from './maker-v8-native-content-evidence.js';
import { makerV8PlayerSlotLayout, makerV8PlayerRecipeLayout } from './maker-v8-player-slot-layout.js';
import { makerV8PlayerTrack, makerV8PlayerPart, makerV8PlayerColor } from './maker-v8-player-definition-resolution.js';
import { makerV8PlayerColorMap, makerV8PlayerColorKey, makerV8PlayerSwatchKey } from './maker-v8-player-colors.js';

export const MAKER_V8_PLAYER_CONTROLLER_SCHEMA =
  'animacraft.maker-v8-player-controller.v1';
export const MAKER_V8_PLAYER_RECIPE_SCHEMA =
  'animacraft.maker-v8-player-recipe.v2';
export const MAKER_V8_PLAYER_LOADOUT_SCHEMA =
  'animacraft.maker-v8-player-loadout.v2';
export const MAKER_V8_PLAYER_CONTEXT_SCHEMA =
  'animacraft.maker-v8-player-context.v1';
export const MAKER_V8_PLAYER_PLAN_SCHEMA =
  'animacraft.maker-v8-player-plan.v1';
export const MAKER_V8_PLAYER_ACTION_RECORD_SCHEMA =
  'animacraft.maker-v8-player-action-record.v1';
export const MAKER_V8_PLAYER_READBACK_SCHEMA =
  'animacraft.maker-v8-player-readback.v1';
export const MAKER_V8_PROTECTED_RENDER_IDENTITY_SCHEMA =
  'animacraft.maker-v8-protected-render-identity.v1';

export const MAKER_V8_PLAYER_ACTIONS = Object.freeze({
  ACQUIRE_MAKER_ACCESS: 'acquireMakerAccess',
  ACQUIRE_BASE_ITEM: 'acquireBaseItem',
  ACQUIRE_PACK_ACCESS: 'acquirePackAccess',
  COMMIT_LOADOUT: 'commitLoadout',
  COMPLETE_OUTPUT: 'completeOutput',
  MATERIALIZE_PHYSICAL: 'materializePhysical',
});

const ACTION_VALUES = new Set(Object.values(MAKER_V8_PLAYER_ACTIONS));
const ACTION_STATUSES = new Set([
  'PREPARED', 'SIGNING', 'SIGNING_UNKNOWN', 'SIGNED', 'BROADCAST_ACCEPTED',
  'OUTCOME_UNKNOWN', 'FINALIZED_UNCERTIFIED', 'FINALIZED_SUCCESS',
  'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND', 'CANCELLED_UNSIGNED',
]);
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const SAFE_KEY = /^(?!0x[0-9a-fA-F]{64}$)[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const encoder = new TextEncoder();

const PLAYER_FIELDS = Object.freeze([
  'schemaVersion', 'id', 'rootId', 'makerKey', 'makerVersion', 'title',
  'summary', 'creatorAddress', 'ownerAddress', 'lifecycle', 'coverAsset',
  'document', 'certifiedAssets', 'evidence', 'creatorName', 'style', 'composableBinding',
]);
const PLAYER_EVIDENCE_FIELDS = Object.freeze([
  'activationEventType', 'activationTransactionDigest', 'rootId', 'rootVersion',
  'rootDigest', 'makerVersion', 'lifecycle', 'contentCommitment',
  'manifestBlobId', 'manifestSha256', 'manifestByteLength', 'rendererCommitment',
]);
const RECIPE_FIELDS = Object.freeze([
  'schemaVersion', 'rootId', 'makerVersion', 'rootContentCommitment',
  'selections', 'colors', 'outputKey',
]);
const SELECTION_FIELDS = Object.freeze([
  'source', 'partKey', 'itemKey', 'styleKey', 'trackKey', 'colorChannelKey',
  'defaultSwatchKey', 'releaseId', 'semanticPackId', 'externalProductId',
  'ownedExternalItemId',
]);
const PROTECTED_RENDER_IDENTITY_FIELDS = Object.freeze([
  'schemaVersion', 'rootId', 'makerVersion', 'rootContentCommitment', 'signer',
  'outputKey', 'scopeKey', 'assetKey', 'releasePackageId',
  'productBindingCommitment', 'policyCommitment', 'sealPolicyConfigId',
  'sealRegistryId', 'sealRuntimeRevision',
]);

const ACTION_TARGETS = Object.freeze({
  [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS]: new Set([
    'core::treasury_v8::claim_free_maker_access_v8',
    'core::treasury_v8::purchase_maker_access_v8',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS]: new Set([
    'runtime::runtime_v8::issue_free_pack_pass_v8',
    'runtime::runtime_v8::purchase_pack_pass_v8',
    'runtime::runtime_v8::issue_included_pack_pass_v8',
    'runtime::runtime_v8::transfer_pack_pass_to_holder_v8',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM]: new Set([
    'runtime::runtime_v8::claim_owned_base_item_v8',
    'runtime::runtime_v8::transfer_new_owned_base_item_to_holder_v8',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT]: new Set([
    'runtime::runtime_v8::attach_pack_definitions_v8',
    'runtime::runtime_v8::create_maker_loadout_v8',
    'runtime::runtime_v8::transfer_maker_loadout_to_holder_v8',
    'runtime::runtime_v8::select_base_style_v8',
    'runtime::runtime_v8::equip_owned_base_style_v8',
    'runtime::runtime_v8::unequip_owned_base_style_v8',
    'runtime::runtime_v8::equip_external_style_v8',
    'runtime::runtime_v8::unequip_external_style_v8',
    'runtime::runtime_v8::select_pack_style_v8',
    'runtime::runtime_v8::clear_non_external_selection_v8',
    'runtime::runtime_seal_v8::select_protected_base_style_v8',
    'runtime::runtime_seal_v8::equip_protected_owned_base_style_v8',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT]: new Set([
    'runtime::runtime_v8::prove_attached_pack_definitions_v8',
    'runtime::runtime_v8::prove_base_selection_v8',
    'runtime::runtime_v8::prove_owned_base_selection_v8',
    'runtime::runtime_v8::prove_pack_selection_v8',
    'runtime::runtime_v8::prove_external_selection_v8',
    'runtime::runtime_v8::seal_ordered_selection_proofs_v8',
    'runtime::runtime_seal_v8::prove_protected_base_selection_v8',
    'runtime::runtime_seal_v8::prove_protected_owned_base_selection_v8',
    'runtime::runtime_seal_v8::prove_protected_pack_selection_v8',
    'output::output_v8::begin_complete_v8',
    'output::output_v8::append_paid_pack_complete_v8',
    'output::output_v8::append_free_pack_complete_v8',
    'nativeSoul::market::mint_animacraft_v8_in_personal_kiosk',
    'nativeSoul::market::ensure_personal_kiosk_registered_v2',
    'nativeSoul::market::new_initial_content_entry',
    'nativeSoul::market::new_state_config_entry',
    'nativeSoul::market::finalize_soul_state',
    'nativeKiosk::personal_kiosk::new',
    'nativeKiosk::personal_kiosk::transfer_to_sender',
    'framework::kiosk::new',
    'framework::coin::zero',
    'framework::transfer::public_share_object',
    'release::release_v8::finish_unprotected_complete_v8',
    'release::release_v8::finish_protected_complete_v8',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]: new Set([
    'runtime::runtime_v8::prove_base_selection_v8',
    'runtime::runtime_v8::prove_owned_base_selection_v8',
    'runtime::runtime_v8::prove_pack_selection_v8',
    'runtime::runtime_seal_v8::prove_protected_base_selection_v8',
    'runtime::runtime_seal_v8::prove_protected_owned_base_selection_v8',
    'runtime::runtime_seal_v8::prove_protected_pack_selection_v8',
    'runtime::runtime_v8::certify_physical_selection_v8',
    'output::output_v8::new_physical_materialization_witness_v8',
    'physical::physical_v8::claim_free_base_style_v8',
    'physical::physical_v8::claim_free_pack_style_v8',
    'physical::physical_v8::purchase_base_style_v8',
    'physical::physical_v8::purchase_pack_style_v8',
    'physical::physical_v8::materialize_base_style_v8',
    'physical::physical_v8::materialize_pack_style_v8',
    'physical::physical_v8::transfer_new_physical_asset_to_holder_v8',
  ]),
});

const ACTION_INPUT_FIELDS = Object.freeze({
  [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS]: Object.freeze([]),
  [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM]: Object.freeze([
    'partKey', 'itemKey',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS]: Object.freeze([
    'releaseId', 'semanticPackId',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT]: Object.freeze([]),
  [MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT]: Object.freeze([
    'render', 'nativeSoul',
  ]),
  [MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL]: Object.freeze([
    'selectionIndex', 'soulId', 'materializationKey',
  ]),
});
const RENDER_INPUT_FIELDS = Object.freeze([
  'blobId', 'sha256', 'blobCommitment', 'byteLength',
]);
const ACTION_RECORD_FIELDS = Object.freeze([
  'schemaVersion', 'actionId', 'scopeKey', 'revision', 'status', 'action',
  'createdAt', 'updatedAt', 'playerIdentity', 'recipe', 'loadout', 'input',
  'plan', 'transaction', 'signatureIntent', 'signature', 'broadcast', 'query',
  'certificate', 'error',
]);
const SIGNATURE_INTENT_FIELDS = Object.freeze([
  'sessionId', 'leaseExpiresAt',
]);
const DURABLE_ERROR_FIELDS = Object.freeze([
  'code', 'layer', 'message', 'retryable', 'details',
]);
const TYPED_ABSENCE_FIELDS = Object.freeze([
  'schemaVersion', 'kind', 'grpcCode', 'grpcService', 'grpcMethod', 'requestedDigest',
  'chainIdentifier', 'watermarkEpoch', 'watermarkCheckpointSequence',
  'watermarkCheckpointDigest',
]);
const TRANSACTION_ABSENCE_SCHEMA = 'animacraft.sui-transaction-absence.v8';
const SIGNATURE_SESSION = /^[0-9a-f]{32}$/;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function clone(value) {
  return structuredClone(value);
}

export class MakerV8PlayerControllerError extends Error {
  constructor(code, message, layer = 'VALIDATION', details = {}, retryable = false) {
    super(message);
    this.name = 'MakerV8PlayerControllerError';
    this.code = code;
    this.layer = layer;
    this.details = freeze({ ...details });
    this.retryable = retryable === true;
  }
}

function fail(code, message, layer = 'VALIDATION', details = {}, retryable = false) {
  throw new MakerV8PlayerControllerError(code, message, layer, details, retryable);
}

function exactRecord(value, fields, label, code = 'MAKER_V8_PLAYER_RECORD_INVALID') {
  if (!plain(value)) fail(code, `${label} must be a plain exact-shape record.`);
  const expected = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !expected.has(field));
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (unknown.length || missing.length) {
    fail(code, `${label} does not have the exact Player v8 shape.`, 'VALIDATION', {
      label, unknown, missing,
    });
  }
  return value;
}

function exactId(value, label) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!EXACT_ID.test(normalized) || /^0x0+$/.test(normalized)) {
    fail('MAKER_V8_PLAYER_ID_INVALID', `${label} must be an exact non-zero Sui ID.`);
  }
  return normalized;
}

function exactHash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail('MAKER_V8_PLAYER_HASH_INVALID', `${label} must be one lowercase 32-byte hash.`);
  }
  return value;
}

function exactKey(value, label) {
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) {
    fail('MAKER_V8_PLAYER_KEY_INVALID', `${label} must be a safe semantic v8 key.`);
  }
  return value;
}

function assertProtectedRenderIdentity(value, player, recipe, account) {
  exactRecord(
    value,
    PROTECTED_RENDER_IDENTITY_FIELDS,
    'protected render identity',
    'MAKER_V8_PLAYER_PROTECTED_IDENTITY_INVALID',
  );
  const checked = freeze({
    schemaVersion: value.schemaVersion,
    rootId: exactId(value.rootId, 'protectedIdentity.rootId'),
    makerVersion: exactDecimal(value.makerVersion, 'protectedIdentity.makerVersion', { positive: true }),
    rootContentCommitment: exactHash(value.rootContentCommitment, 'protectedIdentity.rootContentCommitment'),
    signer: exactId(value.signer, 'protectedIdentity.signer'),
    outputKey: exactKey(value.outputKey, 'protectedIdentity.outputKey'),
    scopeKey: exactKey(value.scopeKey, 'protectedIdentity.scopeKey'),
    assetKey: exactKey(value.assetKey, 'protectedIdentity.assetKey'),
    releasePackageId: exactId(value.releasePackageId, 'protectedIdentity.releasePackageId'),
    productBindingCommitment: exactHash(value.productBindingCommitment, 'protectedIdentity.productBindingCommitment'),
    policyCommitment: exactHash(value.policyCommitment, 'protectedIdentity.policyCommitment'),
    sealPolicyConfigId: exactId(value.sealPolicyConfigId, 'protectedIdentity.sealPolicyConfigId'),
    sealRegistryId: exactId(value.sealRegistryId, 'protectedIdentity.sealRegistryId'),
    sealRuntimeRevision: exactDecimal(value.sealRuntimeRevision, 'protectedIdentity.sealRuntimeRevision'),
  });
  const expectedScope = `complete/${recipe.outputKey}`;
  const expectedAssetPrefix = `receipt-${account.address.slice(2)}-`;
  if (checked.schemaVersion !== MAKER_V8_PROTECTED_RENDER_IDENTITY_SCHEMA
    || checked.rootId !== player.rootId
    || checked.makerVersion !== player.makerVersion
    || checked.rootContentCommitment !== player.evidence.contentCommitment
    || checked.signer !== account.address
    || checked.outputKey !== recipe.outputKey
    || checked.scopeKey !== expectedScope
    || !checked.assetKey.startsWith(expectedAssetPrefix)) {
    fail(
      'MAKER_V8_PLAYER_PROTECTED_IDENTITY_DRIFT',
      'Protected Output identity differs from the exact live Player/Recipe/wallet binding.',
      'CUSTODY',
    );
  }
  return checked;
}

function exactDecimal(value, label, { positive = false } = {}) {
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)
    || (positive && normalized === '0')) {
    fail('MAKER_V8_PLAYER_INTEGER_INVALID', `${label} must be a canonical integer.`);
  }
  return normalized;
}

function assertJson(value, label = 'value') {
  const seen = new WeakSet();
  const walk = (entry, path) => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) fail('MAKER_V8_PLAYER_JSON_INVALID', `${path} is not finite.`);
      return;
    }
    if (!entry || typeof entry !== 'object' || typeof entry === 'bigint') {
      fail('MAKER_V8_PLAYER_JSON_INVALID', `${path} is not plain JSON.`);
    }
    if (seen.has(entry)) fail('MAKER_V8_PLAYER_JSON_INVALID', `${path} contains a repeated reference.`);
    seen.add(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (Array.isArray(entry)) {
      if (prototype !== Array.prototype) fail('MAKER_V8_PLAYER_JSON_INVALID', `${path} is not a standard array.`);
      entry.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (![Object.prototype, null].includes(prototype)) {
      fail('MAKER_V8_PLAYER_JSON_INVALID', `${path} is not a plain record.`);
    }
    for (const key of Object.keys(entry)) {
      if (entry[key] === undefined) fail('MAKER_V8_PLAYER_JSON_INVALID', `${path}.${key} is undefined.`);
      walk(entry[key], `${path}.${key}`);
    }
  };
  walk(value, label);
  return value;
}

function canonicalValue(value) {
  assertJson(value);
  if (value === null || typeof value !== 'object') return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(Object.keys(value).sort(compareMakerV8ProtocolText)
    .map((key) => [key, canonicalValue(value[key])]));
}

function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

function hashValue(value) {
  return [...sha256(encoder.encode(canonical(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function makerV8PlayerRecipeCommitmentV8(recipe) {
  return hashValue(recipe);
}

function canonicalPlayerClock(clock) {
  const u64 = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
    && BigInt(value) <= 18446744073709551615n;
  return plain(clock) && clock.objectId === MAKER_V8_CLOCK_OBJECT_ID
    && clock.type === `0x${'0'.repeat(63)}2::clock::Clock`
    && clock.owner?.kind === 'SHARED' && u64(clock.owner.initialSharedVersion)
    && BigInt(clock.owner.initialSharedVersion) > 0n
    && u64(clock.version) && u64(clock.fields?.timestamp_ms);
}

export function makerV8PlayerContextCommitmentV8(context) {
  const clock = context?.builderInput?.objects?.clock;
  if (context?.schemaVersion !== MAKER_V8_PLAYER_CONTEXT_SCHEMA || !canonicalPlayerClock(clock)) return hashValue(context);
  // Clock's transaction authority is its identity and initial shared version.
  // Its observed version/digest/time advance independently of the user's plan.
  const { version, digest, ...identity } = clock;
  const { timestamp_ms, ...fields } = clock.fields;
  return hashValue({ ...context, builderInput: { ...context.builderInput,
    objects: { ...context.builderInput.objects, clock: { ...identity, fields } } } });
}

export function makerV8PlayerContextsMatchAfterClockProgressV8(fresh, previous) {
  if (sameCanonical(fresh, previous)) return true;
  const before = previous?.builderInput?.objects?.clock, after = fresh?.builderInput?.objects?.clock;
  if (!canonicalPlayerClock(before) || !canonicalPlayerClock(after)
    || !sameCanonical(before.owner, after.owner) || BigInt(after.version) <= BigInt(before.version)
    || BigInt(after.fields.timestamp_ms) < BigInt(before.fields.timestamp_ms)) return false;
  const comparableClock = { ...after, version: before.version, digest: before.digest,
    fields: { ...after.fields, timestamp_ms: before.fields.timestamp_ms } };
  return sameCanonical(previous, { ...fresh, builderInput: { ...fresh.builderInput,
    objects: { ...fresh.builderInput.objects, clock: comparableClock } } });
}

function sameCanonical(left, right) {
  return canonical(left) === canonical(right);
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail(
      'MAKER_V8_PLAYER_DEPENDENCY_INVALID',
      `${label}.${method} is required for enabled Player writes.`,
      'CONFIGURATION',
    );
  }
}

function asPlayerError(cause, code, message, layer, retryable = false, details = {}) {
  if (cause instanceof MakerV8PlayerControllerError) return cause;
  return new MakerV8PlayerControllerError(code, message, layer, {
    ...details,
    causeCode: typeof cause?.code === 'string' ? cause.code : null,
    causeLayer: typeof cause?.layer === 'string' ? cause.layer : null,
    cause: String(cause?.message ?? cause ?? 'unknown'),
  }, retryable);
}

function diagnostic(error, defaultLayer = 'READ') {
  return freeze({
    schemaVersion: 'animacraft.maker-v8-player-diagnostic.v1',
    severity: 'ERROR',
    code: typeof error?.code === 'string' ? error.code : 'MAKER_V8_PLAYER_READ_FAILED',
    layer: typeof error?.layer === 'string' ? error.layer : defaultLayer,
    message: String(error?.message ?? 'Player data could not be read.'),
    retryable: error?.retryable === true,
    details: freeze({ ...(plain(error?.details) ? error.details : {}) }),
  });
}

function assertCertifiedAssets(document, certifiedAssets) {
  if (!Array.isArray(certifiedAssets) || certifiedAssets.length !== document.assets.length) {
    fail(
      'MAKER_V8_PLAYER_ASSET_SET_MISMATCH',
      'Player certified assets must exactly cover the public document.',
      'READ',
    );
  }
  const documented = new Map(document.assets.map((asset) => [asset.id, asset]));
  const seen = new Set();
  for (const [index, asset] of certifiedAssets.entries()) {
    exactRecord(
      asset,
      ['assetId', 'blobId', 'mediaType', 'byteLength', 'sha256'],
      `player.certifiedAssets[${index}]`,
      'MAKER_V8_PLAYER_ASSET_INVALID',
    );
    exactKey(asset.assetId, `player.certifiedAssets[${index}].assetId`);
    exactHash(asset.sha256, `player.certifiedAssets[${index}].sha256`);
    const source = documented.get(asset.assetId);
    if (seen.has(asset.assetId) || !source
      || source.mediaType !== asset.mediaType
      || source.byteLength !== asset.byteLength
      || typeof asset.blobId !== 'string' || !asset.blobId) {
      fail(
        'MAKER_V8_PLAYER_ASSET_SET_MISMATCH',
        'Player certified asset metadata differs from the public document.',
        'READ',
        { assetId: asset.assetId },
      );
    }
    seen.add(asset.assetId);
  }
}

function assertExactPlayer(read, runtime, requestedRootId) {
  if (!plain(read) || read.status !== 'READY' || !plain(read.player)
    || !Array.isArray(read.diagnostics) || read.diagnostics.length !== 0) {
    const first = Array.isArray(read?.diagnostics) ? read.diagnostics[0] : null;
    fail(
      first?.code ?? 'MAKER_V8_PLAYER_READ_NOT_READY',
      first?.message ?? 'Catalog did not return one exact READY Player.',
      first?.layer ?? 'READ',
      { diagnostics: Array.isArray(read?.diagnostics) ? clone(read.diagnostics) : [] },
      first?.retryable === true,
    );
  }
  const player = read.player;
  exactRecord(player, PLAYER_FIELDS, 'player', 'MAKER_V8_PLAYER_VIEW_INVALID');
  exactRecord(player.evidence, PLAYER_EVIDENCE_FIELDS, 'player.evidence', 'MAKER_V8_PLAYER_EVIDENCE_INVALID');
  if (player.schemaVersion !== MAKER_V8_PLAYER_VIEW_SCHEMA
    || player.title !== player.document?.metadata?.name
    || player.summary !== player.document?.metadata?.summary
    || player.creatorName !== (player.document?.metadata?.creator ?? '')
    || player.style !== (player.document?.metadata?.style ?? '')) {
    fail('MAKER_V8_PLAYER_VIEW_INVALID', 'Player view metadata differs from its exact Manifest.', 'READ');
  }
  const rootId = exactId(player.rootId, 'player.rootId');
  const bindingFields = ['definitionRegistryId', 'baseRegistryId', 'packRegistryId', 'admissionAuthorityId'];
  exactRecord(player.composableBinding, bindingFields, 'player.composableBinding', 'MAKER_V8_PLAYER_VIEW_INVALID');
  for (const key of bindingFields) exactId(player.composableBinding[key], `player.composableBinding.${key}`);
  if (exactId(player.id, 'player.id') !== rootId
    || rootId !== exactId(requestedRootId, 'requestedRootId')
    || exactId(player.evidence.rootId, 'player.evidence.rootId') !== rootId
    || player.lifecycle !== 'ACTIVE'
    || player.evidence.lifecycle !== 'ACTIVE') {
    fail('MAKER_V8_PLAYER_ROOT_MISMATCH', 'Player is not the exact requested ACTIVE Root.', 'READ');
  }
  const document = player.document;
  try {
    assertMakerV8Document(document, { mode: 'compile' });
  } catch (cause) {
    throw asPlayerError(
      cause,
      'MAKER_V8_PLAYER_DOCUMENT_INVALID',
      'Player Manifest does not contain an exact compilable Maker v8 document.',
      'READ',
    );
  }
  if (document.parts.some((part) => part.items.some((item) => item.status !== 'PUBLIC'))
    || !sameCanonical(projectPublicMakerV8Document(document), document)) {
    fail(
      'MAKER_V8_PLAYER_PRIVATE_DEFINITION_FORBIDDEN',
      'Player Manifest contains an author-only Item.',
      'READ',
    );
  }
  exactId(player.creatorAddress, 'player.creatorAddress');
  exactId(player.ownerAddress, 'player.ownerAddress');
  const makerVersion = exactDecimal(player.makerVersion, 'player.makerVersion', { positive: true });
  if (makerVersion !== String(document.lineage.version)
    || makerVersion !== exactDecimal(player.evidence.makerVersion, 'player.evidence.makerVersion', { positive: true })
    || player.makerKey !== document.lineage.makerKey) {
    fail('MAKER_V8_PLAYER_LINEAGE_MISMATCH', 'Player lineage differs from its exact Manifest.', 'READ');
  }
  const contentCommitment = exactHash(
    player.evidence.contentCommitment,
    'player.evidence.contentCommitment',
  );
  exactHash(player.evidence.rendererCommitment, 'player.evidence.rendererCommitment');
  if (contentCommitment !== hashValue({ schemaVersion: 'animacraft.maker-v8-public-content.v1', document })
    || exactHash(player.evidence.manifestSha256, 'player.evidence.manifestSha256')
      !== hashValue({ schemaVersion: 'animacraft.maker-v8-manifest.v2', protocolVersion: 8,
        document, certifiedAssets: player.certifiedAssets })
    || !Number.isSafeInteger(player.evidence.manifestByteLength)
    || player.evidence.manifestByteLength <= 0) {
    fail('MAKER_V8_PLAYER_MANIFEST_EVIDENCE_INVALID', 'Player Manifest evidence is not exact.', 'READ');
  }
  const expectedEvent = makerV8ChainTypes(runtime).activationEvent;
  if (player.evidence.activationEventType !== expectedEvent) {
    fail(
      'MAKER_V8_PLAYER_ACTIVATION_TYPE_MISMATCH',
      'Player discovery did not use the certified MakerV8Activated TypeOrigin.',
      'READ',
      { expectedEvent, observedEvent: player.evidence.activationEventType },
    );
  }
  assertCertifiedAssets(document, player.certifiedAssets);
  const expectedCover = document.metadata.coverAssetId === null
    ? null
    : player.certifiedAssets.find((asset) => asset.assetId === document.metadata.coverAssetId);
  if (!sameCanonical(player.coverAsset, expectedCover ?? null)) {
    fail('MAKER_V8_PLAYER_COVER_ASSET_MISMATCH', 'Player cover differs from the certified Manifest asset.', 'READ');
  }
  return freeze(clone(player));
}

function partOrder(document) {
  return [...document.parts].sort((left, right) => (
    left.menuOrder - right.menuOrder
    || compareMakerV8ProtocolText(left.key, right.key)
  ));
}

function styleFor(document, selection) {
  const part = document.parts.find((entry) => entry.key === selection.partKey);
  const item = part?.items.find((entry) => entry.key === selection.itemKey);
  const style = item?.styles.find((entry) => entry.key === selection.styleKey);
  return { part, item, style };
}

function baseSelection(document, selection) {
  const { part, item, style } = styleFor(document, selection);
  if (!part || !item || item.status !== 'PUBLIC' || !style) {
    fail(
      'MAKER_V8_PLAYER_RECIPE_REFERENCE_INVALID',
      'Recipe selects a missing or private base definition.',
    );
  }
  return {
    source: 'BASE',
    partKey: part.key,
    itemKey: item.key,
    styleKey: style.key,
    trackKey: style.trackKey,
    colorChannelKey: style.colorChannelKey,
    defaultSwatchKey: style.defaultSwatchKey,
    releaseId: null,
    semanticPackId: null,
    externalProductId: null,
    ownedExternalItemId: null,
  };
}

function initialRecipe(player) {
  const document = player.document;
  return normalizeRecipe(document, {
    schemaVersion: MAKER_V8_PLAYER_RECIPE_SCHEMA,
    rootId: player.rootId,
    makerVersion: player.makerVersion,
    rootContentCommitment: player.evidence.contentCommitment,
    selections: document.defaultRecipe.selections.map((selection) => (
      baseSelection(document, selection)
    )),
    colors: clone(document.defaultRecipe.colors),
    outputKey: document.outputs[0].key,
  }, player);
}

function normalizeRecipe(document, input, player) {
  exactRecord(input, RECIPE_FIELDS, 'recipe', 'MAKER_V8_PLAYER_RECIPE_INVALID');
  if (input.schemaVersion !== MAKER_V8_PLAYER_RECIPE_SCHEMA
    || exactId(input.rootId, 'recipe.rootId') !== player.rootId
    || exactDecimal(input.makerVersion, 'recipe.makerVersion', { positive: true }) !== player.makerVersion
    || exactHash(input.rootContentCommitment, 'recipe.rootContentCommitment')
      !== player.evidence.contentCommitment
    || !Array.isArray(input.selections) || !Array.isArray(input.colors)) {
    fail(
      'MAKER_V8_PLAYER_RECIPE_BINDING_INVALID',
      'Recipe does not bind the exact active Maker Root/version/content.',
    );
  }
  const selectedPartCounts = new Map();
  const equippedOwnedBaseItems = new Set();
  const packBindings = new Map();
  const selections = input.selections.map((selection, index) => {
    exactRecord(
      selection,
      SELECTION_FIELDS,
      `recipe.selections[${index}]`,
      'MAKER_V8_PLAYER_SELECTION_INVALID',
    );
    if (!['BASE', 'PACK', 'EXTERNAL'].includes(selection.source)) {
      fail('MAKER_V8_PLAYER_SELECTION_SOURCE_INVALID', 'Player accepts only BASE, admitted PACK, or holder-owned EXTERNAL selections.');
    }
    const partKey = exactKey(selection.partKey, `recipe.selections[${index}].partKey`);
    const itemKey = exactKey(selection.itemKey, `recipe.selections[${index}].itemKey`);
    const styleKey = exactKey(selection.styleKey, `recipe.selections[${index}].styleKey`);
    const trackKey = exactKey(selection.trackKey, `recipe.selections[${index}].trackKey`);
    const resolvedPart = makerV8PlayerPart(player, selection);
    const part = resolvedPart?.definition;
    const scopedPartKey = JSON.stringify([resolvedPart?.sourceId, partKey]);
    const nextPartCount = (selectedPartCounts.get(scopedPartKey) || 0) + 1;
    if (!part || !makerV8PlayerTrack(player, selection) || nextPartCount > part.capacity) {
      fail(
        'MAKER_V8_PLAYER_SELECTION_REFERENCE_INVALID',
        'Selection Part/Track is unknown or the Part capacity is exceeded.',
        'VALIDATION',
        { index, partKey, trackKey },
      );
    }
    selectedPartCounts.set(scopedPartKey, nextPartCount);
    let colorChannelKey = selection.colorChannelKey;
    let defaultSwatchKey = selection.defaultSwatchKey;
    if ((colorChannelKey === null) !== (defaultSwatchKey === null)) {
      fail('MAKER_V8_PLAYER_SELECTION_COLOR_INVALID', 'Selection Color channel and swatch are an exact pair.');
    }
    if (colorChannelKey !== null) {
      colorChannelKey = exactKey(colorChannelKey, `recipe.selections[${index}].colorChannelKey`);
      defaultSwatchKey = exactKey(defaultSwatchKey, `recipe.selections[${index}].defaultSwatchKey`);
      if (!makerV8PlayerColor(player, selection)?.definition.swatches.some((swatch) => swatch.key === defaultSwatchKey)) {
        fail('MAKER_V8_PLAYER_SELECTION_COLOR_INVALID', 'Selection default swatch is not in its exact channel.');
      }
    }
    if (selection.source === 'BASE') {
      const expected = baseSelection(document, { partKey, itemKey, styleKey });
      if (!sameCanonical(expected, selection)) {
        fail(
          'MAKER_V8_PLAYER_BASE_SELECTION_DRIFT',
          'Base selection Track/Color/source fields differ from the certified Style.',
          'VALIDATION',
          { index },
        );
      }
      const ownedKey = `${partKey}/${itemKey}`;
      if (document.composition.itemAssetization === true
        && equippedOwnedBaseItems.has(ownedKey)) {
        fail(
          'MAKER_V8_PLAYER_OWNED_BASE_ITEM_REUSED',
          'One owned Base Item instance can occupy only one loadout slot.',
          'VALIDATION',
          { index, partKey, itemKey },
        );
      }
      equippedOwnedBaseItems.add(ownedKey);
      return expected;
    }
    if (selection.source === 'EXTERNAL') {
      if (part.wardrobeMode !== 'SLOT'
        || document.composition.mode !== 'COMPOSABLE'
        || document.composition.thirdPartyAdmission === 'DISABLED'
        || selection.releaseId !== null
        || selection.semanticPackId !== null) {
        fail(
          'MAKER_V8_PLAYER_EXTERNAL_SELECTION_POLICY_INVALID',
          'External Items require one admitted COMPOSABLE SLOT and cannot impersonate a Pack.',
        );
      }
      const externalProductId = exactId(
        selection.externalProductId,
        `recipe.selections[${index}].externalProductId`,
      );
      const ownedExternalItemId = exactId(
        selection.ownedExternalItemId,
        `recipe.selections[${index}].ownedExternalItemId`,
      );
      if (equippedOwnedBaseItems.has(`external/${ownedExternalItemId}`)) {
        fail(
          'MAKER_V8_PLAYER_OWNED_EXTERNAL_ITEM_REUSED',
          'One owned external Item instance can occupy only one loadout slot.',
        );
      }
      equippedOwnedBaseItems.add(`external/${ownedExternalItemId}`);
      return {
        source: 'EXTERNAL', partKey, itemKey, styleKey, trackKey,
        colorChannelKey, defaultSwatchKey, releaseId: null, semanticPackId: null,
        externalProductId, ownedExternalItemId,
      };
    }
    if (resolvedPart.sourceId === player.rootId
      && (part.wardrobeMode !== 'SLOT' || document.composition.mode !== 'COMPOSABLE')) {
      fail(
        'MAKER_V8_PLAYER_PACK_SELECTION_POLICY_INVALID',
        'Pack Styles require one COMPOSABLE SLOT Part.',
      );
    }
    const releaseId = exactId(selection.releaseId, `recipe.selections[${index}].releaseId`);
    const semanticPackId = exactKey(selection.semanticPackId, `recipe.selections[${index}].semanticPackId`);
    if (selection.externalProductId !== null || selection.ownedExternalItemId !== null) {
      fail('MAKER_V8_PLAYER_PACK_BINDING_INVALID', 'Pack selections cannot claim external Item identities.');
    }
    const priorSemantic = packBindings.get(releaseId);
    if (priorSemantic && priorSemantic !== semanticPackId) {
      fail('MAKER_V8_PLAYER_PACK_BINDING_INVALID', 'One Pack Release cannot claim two semantic Pack IDs.');
    }
    packBindings.set(releaseId, semanticPackId);
    return {
      source: 'PACK', partKey, itemKey, styleKey, trackKey,
      colorChannelKey, defaultSwatchKey, releaseId, semanticPackId,
      externalProductId: null, ownedExternalItemId: null,
    };
  });

  const constraintIssue = makerV8PlayerRecipeConstraintIssue(player, selections);
  if (constraintIssue) fail(constraintIssue.code, constraintIssue.message);

  try { makerV8PlayerColorMap(player, input.colors); }
  catch { fail('MAKER_V8_PLAYER_RECIPE_COLOR_INVALID', 'Recipe Color is unknown or duplicated in its exact scope.'); }
  const normalizedColors = input.colors.map(entry => ({ ...entry }))
    .sort((left, right) => compareMakerV8ProtocolText(makerV8PlayerColorKey(left), makerV8PlayerColorKey(right)));

  const outputKey = exactKey(input.outputKey, 'recipe.outputKey');
  const output = document.outputs.find((entry) => entry.key === outputKey);
  if (!output) fail('MAKER_V8_PLAYER_OUTPUT_UNKNOWN', 'Recipe output does not exist.');
  const usedPacks = [...new Set(selections.filter((entry) => entry.source === 'PACK')
    .map((entry) => entry.semanticPackId))].sort(compareMakerV8ProtocolText);
  if (output.allowedPackPolicy.kind === 'ALLOWLIST'
    && usedPacks.some((packId) => !output.allowedPackPolicy.packIds.includes(packId))) {
    fail(
      'MAKER_V8_PLAYER_OUTPUT_PACK_FORBIDDEN',
      'Selected output does not allow every equipped Pack.',
    );
  }
  const layout = makerV8PlayerRecipeLayout(player, selections);
  selections.sort((left, right) => layout.slot(left).start - layout.slot(right).start);
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_RECIPE_SCHEMA,
    rootId: player.rootId,
    makerVersion: player.makerVersion,
    rootContentCommitment: player.evidence.contentCommitment,
    selections,
    colors: normalizedColors,
    outputKey,
  });
}

function loadoutFor(player, recipe) {
  const colorMap = makerV8PlayerColorMap(player, recipe.colors);
  const layout = makerV8PlayerRecipeLayout(player, recipe.selections);
  const partSelectionOffsets = new Map();
  const selections = recipe.selections.map((selection) => {
    const key = layout.scopeKey(selection);
    const offset = partSelectionOffsets.get(key) || 0;
    partSelectionOffsets.set(
      key,
      offset + 1,
    );
    return {
      selectionIndex: layout.slot(selection).start + offset,
      ...selection,
      swatchKey: makerV8PlayerSwatchKey(player, colorMap, selection),
    };
  });
  const usedPacks = [...new Map(selections.filter((entry) => entry.source === 'PACK')
    .map((entry) => [entry.releaseId, {
      releaseId: entry.releaseId,
      semanticPackId: entry.semanticPackId,
    }])).values()].sort((left, right) => (
    compareMakerV8ProtocolText(left.semanticPackId, right.semanticPackId)
    || compareMakerV8ProtocolText(left.releaseId, right.releaseId)
  ));
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_LOADOUT_SCHEMA,
    rootId: recipe.rootId,
    makerVersion: recipe.makerVersion,
    rootContentCommitment: recipe.rootContentCommitment,
    outputKey: recipe.outputKey,
    selections,
    usedPacks,
    recipeCommitment: makerV8PlayerRecipeCommitmentV8(recipe),
  });
}

function assertActionInput(action, input, recipe, document) {
  if (!ACTION_VALUES.has(action)) fail('MAKER_V8_PLAYER_ACTION_INVALID', 'Unknown exact Player v8 action.');
  const fields = ACTION_INPUT_FIELDS[action];
  exactRecord(input, fields, 'action.input', 'MAKER_V8_PLAYER_ACTION_INPUT_INVALID');
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS) {
    exactId(input.releaseId, 'action.input.releaseId');
    exactKey(input.semanticPackId, 'action.input.semanticPackId');
  }
  if (action === MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM) {
    exactKey(input.partKey, 'action.input.partKey');
    exactKey(input.itemKey, 'action.input.itemKey');
    const part = document.parts.find((row) => row.key === input.partKey);
    const item = part?.items.find((row) => row.key === input.itemKey && row.status === 'PUBLIC');
    if (!item || document.composition.itemAssetization !== true) {
      fail('MAKER_V8_PLAYER_BASE_ITEM_UNAVAILABLE', 'Owned Base Item is not an exact public assetized Item.');
    }
  }
  if (action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
    assertMakerV8NativeCompletionInputV8(input.nativeSoul);
    exactRecord(
      input.render,
      RENDER_INPUT_FIELDS,
      'action.input.render',
      'MAKER_V8_PLAYER_RENDER_INPUT_INVALID',
    );
    if (typeof input.render.blobId !== 'string' || input.render.blobId.length < 1
      || input.render.blobId.length > 512
      || !Number.isSafeInteger(input.render.byteLength) || input.render.byteLength < 1) {
      fail(
        'MAKER_V8_PLAYER_RENDER_INPUT_INVALID',
        'Complete requires one bounded durable render transport.',
      );
    }
    exactHash(input.render.sha256, 'action.input.render.sha256');
    exactHash(input.render.blobCommitment, 'action.input.render.blobCommitment');
  }
  if (action === MAKER_V8_PLAYER_ACTIONS.MATERIALIZE_PHYSICAL) {
    if (!Number.isSafeInteger(input.selectionIndex)
      || input.selectionIndex < 0 || input.selectionIndex >= recipe.selections.length) {
      fail('MAKER_V8_PLAYER_PHYSICAL_SELECTION_INVALID', 'Physical selection index is invalid.');
    }
    const selection = recipe.selections[input.selectionIndex];
    if (selection.source === 'EXTERNAL') {
      fail(
        'MAKER_V8_PLAYER_EXTERNAL_PHYSICAL_UNSUPPORTED',
        'Fresh-v8 Physical assets are defined only for Base and Pack Styles.',
      );
    }
    if (selection.source === 'BASE') {
      const { style } = styleFor(document, selection);
      if (!style?.physical) {
        fail('MAKER_V8_PLAYER_PHYSICAL_POLICY_MISSING', 'Selected base Style has no Physical policy.');
      }
    }
    exactId(input.soulId, 'action.input.soulId');
    exactKey(input.materializationKey, 'action.input.materializationKey');
  }
  return freeze(clone(input));
}

function assertMainnetIdentifier(value) {
  const observed = typeof value === 'string' ? value : value?.chainIdentifier;
  if (observed !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
    fail(
      'MAKER_V8_PLAYER_NETWORK_DRIFT',
      'Player execution is not connected to the pinned Sui Mainnet chain.',
      'CONTEXT',
      { expected: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, observed: observed ?? null },
    );
  }
  return observed;
}

function assertAccount(account) {
  if (!plain(account)) fail('MAKER_V8_PLAYER_WALLET_DISCONNECTED', 'Connect a Sui Mainnet wallet first.', 'WALLET');
  const address = exactId(account.address, 'wallet.account.address');
  if (account.network !== 'mainnet') {
    fail('MAKER_V8_PLAYER_WALLET_NETWORK_DRIFT', 'Wallet is not authorized for Sui Mainnet.', 'WALLET');
  }
  return freeze({ address, network: 'mainnet' });
}

function assertPlayerContext(context, action, player, recipe, account) {
  assertJson(context, 'playerContext');
  if (!plain(context)
    || context.schemaVersion !== MAKER_V8_PLAYER_CONTEXT_SCHEMA
    || context.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || context.network !== 'mainnet'
    || context.action !== action
    || exactId(context.account, 'playerContext.account') !== account.address
    || exactId(context.rootId, 'playerContext.rootId') !== player.rootId
    || exactDecimal(context.makerVersion, 'playerContext.makerVersion', { positive: true }) !== player.makerVersion
    || exactHash(context.rootContentCommitment, 'playerContext.rootContentCommitment')
      !== player.evidence.contentCommitment
    || context.lifecycle !== 'ACTIVE'
    || context.actionEligible !== true
    || typeof context.protectedContentRequired !== 'boolean'
    || !plain(context.builderInput)) {
    fail(
      'MAKER_V8_PLAYER_CONTEXT_INVALID',
      'Custody context does not bind the exact active Player action.',
      'CONTEXT',
      { action, rootId: player.rootId },
    );
  }
  if (context.recipeCommitment !== makerV8PlayerRecipeCommitmentV8(recipe)) {
    fail('MAKER_V8_PLAYER_CONTEXT_RECIPE_DRIFT', 'Custody context binds another Recipe.', 'CONTEXT');
  }
  // Preserve the exact in-process custody capability object while freezing it
  // before certification; cloning here would erase the adapter's WeakMap proof.
  return freeze(context);
}

function assertCompilerPlan(result, compiler, action, player, recipe, context, account) {
  exactRecord(result, ['authority', 'plan'], 'compiler result', 'MAKER_V8_PLAYER_COMPILER_RESULT_INVALID');
  if (result.authority !== compiler.authority) {
    fail(
      'MAKER_V8_PLAYER_COMPILER_AUTHORITY_INVALID',
      'Player plan lacks the exact in-process compiler authority.',
      'COMPILER',
    );
  }
  const plan = result.plan;
  exactRecord(plan, [
    'schemaVersion', 'action', 'chainIdentifier', 'network', 'signer', 'rootId',
    'makerVersion', 'rootContentCommitment', 'recipeCommitment',
    'contextCommitment', 'descriptor', 'targets',
  ], 'compiler plan', 'MAKER_V8_PLAYER_PLAN_INVALID');
  assertJson(plan, 'compilerPlan');
  if (plan.schemaVersion !== MAKER_V8_PLAYER_PLAN_SCHEMA
    || plan.action !== action
    || plan.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || plan.network !== 'mainnet'
    || exactId(plan.signer, 'compilerPlan.signer') !== account.address
    || exactId(plan.rootId, 'compilerPlan.rootId') !== player.rootId
    || exactDecimal(plan.makerVersion, 'compilerPlan.makerVersion', { positive: true }) !== player.makerVersion
    || exactHash(plan.rootContentCommitment, 'compilerPlan.rootContentCommitment')
      !== player.evidence.contentCommitment
    || exactHash(plan.recipeCommitment, 'compilerPlan.recipeCommitment')
      !== makerV8PlayerRecipeCommitmentV8(recipe)
    || exactHash(plan.contextCommitment, 'compilerPlan.contextCommitment')
      !== makerV8PlayerContextCommitmentV8(context)
    || !plain(plan.descriptor)
    || !Array.isArray(plan.targets) || plan.targets.length === 0) {
    fail('MAKER_V8_PLAYER_PLAN_DRIFT', 'Compiler plan differs from the exact Player intent.', 'COMPILER');
  }
  return freeze(clone(plan));
}

function normalizeTarget(target) {
  if (typeof target !== 'string') fail('MAKER_V8_PLAYER_TARGET_INVALID', 'Player target is not a string.', 'COMPILER');
  const pieces = target.split('::');
  if (pieces.length !== 3 || !/^[a-z_][a-z0-9_]*$/.test(pieces[1])
    || !/^[a-z_][a-z0-9_]*$/.test(pieces[2])) {
    fail('MAKER_V8_PLAYER_TARGET_INVALID', 'Player target is not one exact Move function.', 'COMPILER');
  }
  return `${exactId(pieces[0], 'target.package')}::${pieces[1]}::${pieces[2]}`;
}

function actionPackageRoles(action, runtime) {
  const packageRoles = new Map(Object.entries(runtime.roles)
    .map(([role, identity]) => [identity.callablePackageId, role]));
  if (action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT && runtime.nativeSoulIntegration) {
    packageRoles.set(runtime.nativeSoulIntegration.soulidityCallablePackageId, 'nativeSoul');
    packageRoles.set(runtime.nativeSoulIntegration.kioskPackageId, 'nativeKiosk');
    packageRoles.set(`0x${'0'.repeat(63)}2`, 'framework');
  }
  return packageRoles;
}

function assertActionTargets(action, targets, runtime) {
  const packageRoles = actionPackageRoles(action, runtime);
  const allowed = ACTION_TARGETS[action];
  return targets.map((raw) => {
    const target = normalizeTarget(raw);
    const [packageId, moduleName, functionName] = target.split('::');
    const role = packageRoles.get(packageId);
    if (!role || !allowed.has(`${role}::${moduleName}::${functionName}`)) {
      fail(
        'MAKER_V8_PLAYER_TARGET_FORBIDDEN',
        'Compiler emitted a Move target outside the exact Player v8 action.',
        'COMPILER',
        { action, target, role: role ?? null },
      );
    }
    return target;
  });
}

function canonicalTransactionBytes(value) {
  let bytes;
  try {
    if (typeof value !== 'string' || value.length < 8) throw new Error('empty');
    bytes = fromBase64(value);
    if (toBase64(bytes) !== value) throw new Error('non-canonical');
    TransactionDataBuilder.fromBytes(bytes);
  } catch {
    fail(
      'MAKER_V8_PLAYER_TRANSACTION_BYTES_INVALID',
      'Player TransactionData must be canonical Base64 BCS.',
      'BUILD',
    );
  }
  return bytes;
}

function assertBuiltTransaction(built, plan, runtime) {
  assertJson(built, 'builtTransaction');
  if (!plain(built) || typeof built.transactionBytes !== 'string'
    || typeof built.transactionDigest !== 'string') {
    fail('MAKER_V8_PLAYER_BUILD_INVALID', 'Exact boundary returned an invalid build.', 'BUILD');
  }
  if (built.custodyContext !== undefined
    && makerV8PlayerContextCommitmentV8(built.custodyContext) !== plan.contextCommitment) {
    fail('MAKER_V8_PLAYER_CONTEXT_DRIFT', 'Durable custody snapshot differs from the plan.', 'BUILD');
  }
  const bytes = canonicalTransactionBytes(built.transactionBytes);
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const snapshot = TransactionDataBuilder.fromBytes(bytes).snapshot();
  const startEpoch = String(built.epochWindow?.start ?? '');
  const endEpoch = String(built.epochWindow?.end ?? '');
  const validDuring = snapshot.expiration?.ValidDuring;
  const expirationMatches = validDuring
    ? validDuring.chain === MAKER_V8_SUI_MAINNET_GENESIS_DIGEST
      && validDuring.minEpoch === startEpoch && validDuring.maxEpoch === endEpoch
      && validDuring.minTimestamp === null && validDuring.maxTimestamp === null
      && Number.isInteger(validDuring.nonce) && validDuring.nonce >= 0 && validDuring.nonce <= 0xffffffff
    : String(snapshot.expiration?.Epoch ?? '') === endEpoch;
  if (digest !== built.transactionDigest
    || snapshot.sender !== plan.signer
    || snapshot.gasData?.owner !== plan.signer
    || !/^(?:0|[1-9][0-9]*)$/.test(startEpoch)
    || !/^[1-9][0-9]*$/.test(endEpoch)
    || BigInt(endEpoch) !== BigInt(startEpoch) + 1n
    || !expirationMatches) {
    fail(
      'MAKER_V8_PLAYER_TRANSACTION_DRIFT',
      'Built TransactionData digest, sender, gas owner, or expiration differs from the plan.',
      'BUILD',
    );
  }
  const actionPackages = actionPackageRoles(plan.action, runtime);
  const observedTargets = snapshot.commands.map((command) => command?.MoveCall)
    .filter((call) => call && actionPackages.has(String(call.package).toLowerCase()))
    .map((call) => normalizeTarget(
      `${call.package}::${call.module}::${call.function}`,
    ));
  const plannedTargets = assertActionTargets(plan.action, plan.targets, runtime);
  if (!sameCanonical(observedTargets, plannedTargets)) {
    fail(
      'MAKER_V8_PLAYER_TRANSACTION_TARGET_DRIFT',
      'Built TransactionData Move calls differ from the compiler plan.',
      'BUILD',
      { observedTargets, plannedTargets },
    );
  }
  return freeze({
    build: clone(built),
    bytes: built.transactionBytes,
    digest,
    targets: observedTargets,
  });
}

function assertSignatureArtifact(value, transaction, signer) {
  assertJson(value, 'signatureArtifact');
  if (!plain(value)
    || value.bytes !== transaction.bytes
    || value.digest !== transaction.digest
    || exactId(value.signer, 'signature.signer') !== signer
    || typeof value.signature !== 'string' || value.signature.length < 8) {
    fail(
      'MAKER_V8_PLAYER_SIGNATURE_DRIFT',
      'Wallet did not return the exact Player TransactionData/signature tuple.',
      'SIGNING',
    );
  }
  try {
    if (toBase64(fromBase64(value.signature)) !== value.signature) throw new Error('canonical');
  } catch {
    fail('MAKER_V8_PLAYER_SIGNATURE_INVALID', 'Wallet signature is not canonical Base64.', 'SIGNING');
  }
  return freeze(clone(value));
}

function assertDurableError(value, label = 'actionRecord.error') {
  exactRecord(value, DURABLE_ERROR_FIELDS, label, 'MAKER_V8_PLAYER_RECORD_INVALID');
  if (typeof value.code !== 'string' || value.code.length === 0
    || typeof value.layer !== 'string' || value.layer.length === 0
    || typeof value.message !== 'string' || value.message.length === 0
    || typeof value.retryable !== 'boolean' || !plain(value.details)) {
    fail('MAKER_V8_PLAYER_RECORD_INVALID', `${label} is not one exact durable diagnostic.`, 'PERSISTENCE');
  }
  return value;
}

function assertTransactionQuery(value, digest, label = 'actionRecord.query') {
  exactRecord(value, [
    'status', 'digest', 'epoch', 'effectsFingerprint', 'eventsDigest', 'error',
    'absence',
  ], label, 'MAKER_V8_PLAYER_RECORD_INVALID');
  if (value.digest !== digest
    || !['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'NOT_FOUND'].includes(value.status)) {
    fail('MAKER_V8_PLAYER_RECORD_INVALID', `${label} does not bind the exact transaction.`, 'PERSISTENCE');
  }
  if (value.status === 'NOT_FOUND') {
    exactRecord(
      value.absence,
      TYPED_ABSENCE_FIELDS,
      `${label}.absence`,
      'MAKER_V8_PLAYER_RECORD_INVALID',
    );
    if (value.epoch !== null || value.effectsFingerprint !== null
      || value.eventsDigest !== null || value.error !== null
      || value.absence.schemaVersion !== TRANSACTION_ABSENCE_SCHEMA
      || value.absence.kind !== 'SUI_GRPC_TRANSACTION_NOT_FOUND'
      || value.absence.grpcCode !== 'NOT_FOUND'
      || value.absence.grpcService !== 'sui.rpc.v2.LedgerService'
      || value.absence.grpcMethod !== 'GetTransaction'
      || value.absence.requestedDigest !== digest
      || value.absence.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
      || !/^(?:0|[1-9][0-9]*)$/.test(value.absence.watermarkEpoch)
      || !/^(?:0|[1-9][0-9]*)$/.test(value.absence.watermarkCheckpointSequence)
      || typeof value.absence.watermarkCheckpointDigest !== 'string'
      || value.absence.watermarkCheckpointDigest.length < 20) {
      fail('MAKER_V8_PLAYER_ABSENCE_EVIDENCE_INVALID', 'Transaction absence proof is not the exact typed Mainnet double-query evidence.', 'RECOVERY');
    }
    return value;
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(value.epoch)
    || typeof value.effectsFingerprint !== 'string'
    || !/^0x[0-9a-f]{64}$/.test(value.effectsFingerprint)
    || value.absence !== null
    || (value.status === 'FINALIZED_SUCCESS' && value.error !== null)
    || (value.status === 'FINALIZED_FAILURE'
      && (!plain(value.error) || typeof value.error.message !== 'string'))) {
    fail('MAKER_V8_PLAYER_RECORD_INVALID', `${label} has invalid finalized evidence.`, 'PERSISTENCE');
  }
  return value;
}

function assertSignatureIntent(value, label = 'actionRecord.signatureIntent') {
  exactRecord(value, SIGNATURE_INTENT_FIELDS, label, 'MAKER_V8_PLAYER_RECORD_INVALID');
  if (!SIGNATURE_SESSION.test(value.sessionId)
    || !Number.isSafeInteger(value.leaseExpiresAt) || value.leaseExpiresAt < 0) {
    fail('MAKER_V8_PLAYER_RECORD_INVALID', `${label} is invalid.`, 'PERSISTENCE');
  }
  return value;
}

function assertBroadcast(value, digest) {
  if (!plain(value) || value.accepted !== true || value.digest !== digest) {
    fail('MAKER_V8_PLAYER_RECORD_INVALID', 'Durable broadcast receipt is invalid.', 'PERSISTENCE');
  }
  return value;
}

function playerActionScope({ action, signer, playerIdentity, recipeCommitment, input }) {
  // Entry entitlements are acquired for this wallet/Root/source, not its current
  // visual recipe. A color/style edit must not hide an uncertain paid acquisition
  // behind a second scope. Exact original recipe/plan/bytes remain in the record
  // and are revalidated before any signature; Complete remains recipe-specific.
  const acquisition = [MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
    MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM, MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS].includes(action);
  return hashValue({
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    action,
    signer,
    rootId: playerIdentity.rootId,
    makerVersion: playerIdentity.makerVersion,
    rootContentCommitment: playerIdentity.rootContentCommitment,
    recipeCommitment: acquisition ? null : recipeCommitment,
    input,
  });
}

function assertActionRecord(record, runtime = null) {
  exactRecord(record, ACTION_RECORD_FIELDS, 'actionRecord', 'MAKER_V8_PLAYER_RECORD_INVALID');
  if (!plain(record)
    || record.schemaVersion !== MAKER_V8_PLAYER_ACTION_RECORD_SCHEMA
    || !HASH.test(record.actionId)
    || !HASH.test(record.scopeKey)
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0
    || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < record.createdAt
    || !ACTION_VALUES.has(record.action)
    || !ACTION_STATUSES.has(record.status)
    || !plain(record.plan) || !plain(record.playerIdentity)
    || !plain(record.recipe) || !plain(record.loadout)
    || !plain(record.input) || !plain(record.transaction)) {
    fail('MAKER_V8_PLAYER_RECORD_INVALID', 'Durable Player action record is invalid.', 'PERSISTENCE');
  }
  assertJson(record, 'actionRecord');
  exactRecord(record.plan, [
    'schemaVersion', 'action', 'chainIdentifier', 'network', 'signer', 'rootId',
    'makerVersion', 'rootContentCommitment', 'recipeCommitment',
    'contextCommitment', 'descriptor', 'targets',
  ], 'actionRecord.plan', 'MAKER_V8_PLAYER_RECORD_INVALID');
  exactRecord(record.playerIdentity, [
    'rootId', 'makerVersion', 'rootContentCommitment',
  ], 'actionRecord.playerIdentity', 'MAKER_V8_PLAYER_RECORD_INVALID');
  exactRecord(record.transaction, [
    'build', 'bytes', 'digest', 'targets',
  ], 'actionRecord.transaction', 'MAKER_V8_PLAYER_RECORD_INVALID');
  if (record.plan.schemaVersion !== MAKER_V8_PLAYER_PLAN_SCHEMA
    || record.plan.action !== record.action
    || record.plan.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || record.plan.network !== 'mainnet'
    || exactId(record.plan.rootId, 'actionRecord.plan.rootId')
      !== exactId(record.playerIdentity.rootId, 'actionRecord.playerIdentity.rootId')
    || exactDecimal(record.plan.makerVersion, 'actionRecord.plan.makerVersion', { positive: true })
      !== exactDecimal(record.playerIdentity.makerVersion, 'actionRecord.playerIdentity.makerVersion', { positive: true })
    || exactHash(record.plan.rootContentCommitment, 'actionRecord.plan.rootContentCommitment')
      !== exactHash(record.playerIdentity.rootContentCommitment, 'actionRecord.playerIdentity.rootContentCommitment')
    || record.recipe.schemaVersion !== MAKER_V8_PLAYER_RECIPE_SCHEMA
    || record.loadout.schemaVersion !== MAKER_V8_PLAYER_LOADOUT_SCHEMA
    || record.loadout.recipeCommitment !== makerV8PlayerRecipeCommitmentV8(record.recipe)
    || record.plan.recipeCommitment !== record.loadout.recipeCommitment
    || record.recipe.rootId !== record.playerIdentity.rootId
    || record.recipe.makerVersion !== record.playerIdentity.makerVersion
    || record.recipe.rootContentCommitment !== record.playerIdentity.rootContentCommitment
    || record.actionId !== hashValue({ plan: record.plan, digest: record.transaction.digest })
    || record.scopeKey !== playerActionScope({
      action: record.action,
      signer: record.plan.signer,
      playerIdentity: record.playerIdentity,
      recipeCommitment: record.plan.recipeCommitment,
      input: record.input,
    })
    || record.transaction.bytes !== record.transaction.build?.transactionBytes
    || record.transaction.digest !== record.transaction.build?.transactionDigest
    || !sameCanonical(record.transaction.targets, record.plan.targets)) {
    fail(
      'MAKER_V8_PLAYER_RECORD_DRIFT',
      'Durable Player action identities, Recipe, plan, or transaction drifted.',
      'PERSISTENCE',
    );
  }
  if (runtime) {
    const transaction = assertBuiltTransaction(record.transaction.build, record.plan, runtime);
    if (transaction.bytes !== record.transaction.bytes
      || transaction.digest !== record.transaction.digest
      || !sameCanonical(transaction.targets, record.transaction.targets)) {
      fail('MAKER_V8_PLAYER_RECORD_DRIFT', 'Durable Player TransactionData drifted.', 'PERSISTENCE');
    }
  }
  if (record.signature !== null) {
    assertSignatureArtifact(record.signature, {
      bytes: record.transaction.bytes,
      digest: record.transaction.digest,
    }, record.plan.signer);
  }
  if (record.signatureIntent !== null) assertSignatureIntent(record.signatureIntent);
  if (record.broadcast !== null) assertBroadcast(record.broadcast, record.transaction.digest);
  if (record.query !== null) assertTransactionQuery(record.query, record.transaction.digest);
  if (record.error !== null) assertDurableError(record.error);

  const hasSignature = record.signature !== null;
  const hasIntent = record.signatureIntent !== null;
  const hasBroadcast = record.broadcast !== null;
  const hasQuery = record.query !== null;
  const hasCertificate = record.certificate !== null;
  const hasError = record.error !== null;
  const invalid = (() => {
    if (['PREPARED', 'CANCELLED_UNSIGNED'].includes(record.status)) {
      return hasIntent || hasSignature || hasBroadcast || hasQuery || hasCertificate;
    }
    if (record.status === 'SIGNING') {
      return !hasIntent || hasSignature || hasBroadcast || hasQuery || hasCertificate || hasError;
    }
    if (record.status === 'SIGNING_UNKNOWN') {
      return !hasIntent || hasSignature || hasBroadcast || hasQuery || hasCertificate || !hasError;
    }
    if (record.status === 'SIGNED') {
      return hasIntent || !hasSignature || hasBroadcast || hasQuery || hasCertificate || hasError;
    }
    if (record.status === 'BROADCAST_ACCEPTED') {
      return hasIntent || !hasSignature || !hasBroadcast || hasCertificate || hasError
        || (hasQuery && record.query.status !== 'NOT_FOUND');
    }
    if (record.status === 'OUTCOME_UNKNOWN') {
      return hasIntent || !hasSignature || hasCertificate
        || (hasQuery && record.query.status !== 'NOT_FOUND');
    }
    if (record.status === 'FINALIZED_UNCERTIFIED') {
      return hasIntent || !hasSignature || !hasQuery
        || record.query.status !== 'FINALIZED_SUCCESS' || hasCertificate || !hasError;
    }
    if (record.status === 'FINALIZED_SUCCESS') {
      return hasIntent || !hasSignature || !hasQuery
        || record.query.status !== 'FINALIZED_SUCCESS' || !hasCertificate || hasError;
    }
    if (record.status === 'FINALIZED_FAILURE') {
      return hasIntent || !hasSignature || !hasQuery
        || record.query.status !== 'FINALIZED_FAILURE' || hasCertificate || !hasError;
    }
    if (record.status === 'EXPIRED_NOT_FOUND') {
      return hasIntent || !hasSignature || !hasQuery
        || record.query.status !== 'NOT_FOUND' || hasCertificate || !hasError;
    }
    return true;
  })();
  if (invalid) {
    fail(
      'MAKER_V8_PLAYER_RECORD_STATUS_INVALID',
      'Durable Player status is inconsistent with its exact artifacts.',
      'PERSISTENCE',
      { status: record.status },
    );
  }
  if (record.status === 'FINALIZED_SUCCESS') {
    assertReadback(record.certificate, record, record.query);
  }
  return record;
}

function actionView(record, recoveryState = null) {
  return freeze({
    schemaVersion: MAKER_V8_PLAYER_ACTION_RECORD_SCHEMA,
    actionId: record.actionId,
    revision: record.revision,
    action: record.action,
    status: record.status,
    rootId: record.playerIdentity.rootId,
    makerVersion: record.playerIdentity.makerVersion,
    recipeCommitment: record.loadout.recipeCommitment,
    transactionDigest: record.transaction.digest,
    makerEntryQuote: record.plan.descriptor.expected?.makerEntryQuote == null
      ? null : clone(record.plan.descriptor.expected.makerEntryQuote),
    completePaymentQuote: record.plan.descriptor.expected?.completePaymentQuote == null
      ? null : clone(record.plan.descriptor.expected.completePaymentQuote),
    packEntryQuote: record.plan.descriptor.expected?.packEntryQuote == null
      ? null : clone(record.plan.descriptor.expected.packEntryQuote),
    recoveryState,
    query: record.query == null ? null : clone(record.query),
    certificate: record.certificate == null ? null : clone(record.certificate),
    error: record.error == null ? null : clone(record.error),
  });
}

function durableError(error) {
  return freeze({
    code: error.code,
    layer: error.layer,
    message: error.message,
    retryable: error.retryable,
    details: clone(error.details),
  });
}

function assertReadback(certificate, record, query) {
  assertJson(certificate, 'playerReadback');
  exactRecord(certificate, [
    'schemaVersion', 'status', 'actionId', 'action', 'rootId',
    'transactionDigest', 'evidence',
  ], 'playerReadback', 'MAKER_V8_PLAYER_READBACK_INVALID');
  if (!plain(certificate)
    || certificate.schemaVersion !== MAKER_V8_PLAYER_READBACK_SCHEMA
    || certificate.status !== 'CERTIFIED'
    || certificate.actionId !== record.actionId
    || certificate.action !== record.action
    || exactId(certificate.rootId, 'readback.rootId') !== record.playerIdentity.rootId
    || certificate.transactionDigest !== record.transaction.digest
    || !plain(certificate.evidence)
    || query.status !== 'FINALIZED_SUCCESS') {
    fail(
      'MAKER_V8_PLAYER_READBACK_INVALID',
      'Finalized Player action lacks exact custody readback certification.',
      'READBACK',
    );
  }
  if (record.action === MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT) {
    const event = certificate.evidence.certifiedEvent?.fields;
    if (!event || event.root_id !== record.playerIdentity.rootId || event.original_holder !== record.plan.signer
      || query.effectsFingerprint !== `0x${certificate.evidence.effectsBcsSha256}`) fail('MAKER_V8_PLAYER_READBACK_INVALID', 'Native content finality binding is missing.');
    assertMakerV8NativeContentEvidenceV8({ evidence: certificate.evidence.nativeContentEvidence,
      effectsSha256: certificate.evidence.effectsBcsSha256, transactionDigest: record.transaction.digest,
      originalPackageId: record.plan.descriptor.expected.nativeSoul.nativeBinding.soulOriginalType.split('::')[0],
      soulId: event.soul_id, stateId: event.soul_state_id, signer: record.plan.signer, input: record.input.nativeSoul });
  }
  return freeze(clone(certificate));
}

function protectedRequired(player, recipe, context) {
  const output = player.document.outputs.find((entry) => entry.key === recipe.outputKey);
  const baseProtected = recipe.selections.some((selection) => {
    if (selection.source !== 'BASE') return false;
    return styleFor(player.document, selection).style?.protected === true;
  });
  return output?.protected === true || baseProtected || context.protectedContentRequired === true;
}

export function createMakerV8PlayerControllerV8({
  productRuntime,
  compiler = null,
  custody = null,
  boundary = null,
  wallet = null,
  rpc = null,
  persistence = null,
  execution = {},
  now = () => Date.now(),
  randomBytes = (length) => globalThis.crypto?.getRandomValues?.(new Uint8Array(length)),
  signatureLeaseMs = 120_000,
} = {}) {
  if (!plain(productRuntime)
    || productRuntime.schemaVersion !== MAKER_V8_PRODUCT_RUNTIME_SCHEMA
    || typeof productRuntime.catalog?.loadPlayer !== 'function') {
    fail(
      'MAKER_V8_PLAYER_PRODUCT_RUNTIME_INVALID',
      'Player requires the exact Maker v8 product runtime catalog.',
      'CONFIGURATION',
    );
  }
  let runtime;
  try {
    runtime = assertMakerV8Runtime(productRuntime.runtime, { requireEnabled: true });
  } catch (cause) {
    throw asPlayerError(
      cause,
      'MAKER_V8_PLAYER_RUNTIME_INVALID',
      'Player runtime is not the enabled certified Maker v8 tuple.',
      'CONFIGURATION',
    );
  }
  if (!plain(execution)) {
    fail('MAKER_V8_PLAYER_EXECUTION_INVALID', 'Player execution gates must be a plain record.', 'CONFIGURATION');
  }
  const executionFields = Object.keys(execution).sort();
  const expectedExecutionFields = [
    'allowBroadcast', 'allowProtectedContent', 'allowWalletSignature',
  ];
  if (executionFields.some((field) => !expectedExecutionFields.includes(field))) {
    fail(
      'MAKER_V8_PLAYER_EXECUTION_INVALID',
      'Player execution gates contain fields outside the exact v8 schema.',
      'CONFIGURATION',
    );
  }
  const gates = freeze({
    allowWalletSignature: execution.allowWalletSignature === true,
    allowBroadcast: execution.allowBroadcast === true,
    allowProtectedContent: execution.allowProtectedContent === true,
  });
  if (gates.allowWalletSignature !== gates.allowBroadcast) {
    fail(
      'MAKER_V8_PLAYER_EXECUTION_GATE_INVALID',
      'Player signing and exact-byte broadcast gates must change together.',
      'CONFIGURATION',
    );
  }
  const writeEnabled = gates.allowWalletSignature && gates.allowBroadcast;
  if (writeEnabled) {
    if (!plain(compiler?.authority)) {
      fail(
        'MAKER_V8_PLAYER_COMPILER_AUTHORITY_INVALID',
        'Enabled Player writes require one in-process compiler authority.',
        'CONFIGURATION',
      );
    }
    for (const method of ['preparePlayerAction', 'assertPlayerActionFresh']) {
      requireMethod(compiler, method, 'compiler');
    }
    for (const method of ['loadPlayerContext', 'assertPlayerContext', 'readbackPlayerAction']) {
      requireMethod(custody, method, 'custody');
    }
    for (const method of [
      'buildExactTransaction', 'dryRunExactTransaction', 'broadcastExactTransaction',
    ]) requireMethod(boundary, method, 'boundary');
    for (const method of [
      'getCurrentAccount', 'signExactTransaction', 'verifyExactSignature',
    ]) requireMethod(wallet, method, 'wallet');
    for (const method of ['getChainIdentifier', 'queryTransaction']) requireMethod(rpc, method, 'rpc');
    for (const method of [
      'requirePersistentStorage', 'preflightQuota', 'create', 'load', 'compareAndSwap',
      'resolveActive', 'reclaimSignatureIntent',
    ]) requireMethod(persistence, method, 'persistence');
  }

  const listeners = new Set();
  let loadToken = 0;
  let quoteToken = 0;
  let state = freeze({
    schemaVersion: MAKER_V8_PLAYER_CONTROLLER_SCHEMA,
    status: 'IDLE',
    player: null,
    recipe: null,
    loadout: null,
    diagnostics: [],
    execution: freeze({
      ...gates,
      writeEnabled,
      disabledReason: writeEnabled
        ? null : 'Player chain actions are disabled until exact signing and broadcast gates are enabled.',
    }),
    lastError: null,
  });

  const publish = (next) => {
    state = freeze(next);
    for (const listener of listeners) {
      try { listener(state); } catch { /* Observers never control execution. */ }
    }
    return state;
  };

  const clock = () => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < 0) {
      fail('MAKER_V8_PLAYER_CLOCK_INVALID', 'Player clock must be a non-negative safe integer.', 'PERSISTENCE');
    }
    return value;
  };

  if (!Number.isSafeInteger(signatureLeaseMs) || signatureLeaseMs < 30_000
    || signatureLeaseMs > 15 * 60_000) {
    fail('MAKER_V8_PLAYER_SIGNATURE_LEASE_INVALID', 'Player signature lease must be from 30 seconds to 15 minutes.', 'CONFIGURATION');
  }

  const signatureSession = () => {
    let bytes;
    try { bytes = randomBytes(16); } catch { bytes = null; }
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
      fail('MAKER_V8_PLAYER_RANDOMNESS_REQUIRED', 'Cryptographic randomness is required before a wallet prompt.', 'SIGNING');
    }
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  const requireWrite = () => {
    if (!writeEnabled) {
      fail(
        'MAKER_V8_PLAYER_WRITES_DISABLED',
        state.execution.disabledReason,
        'GATE',
      );
    }
  };

  const readExact = async (rootId) => {
    let read;
    try {
      read = await productRuntime.catalog.loadPlayer(exactId(rootId, 'rootId'));
      const player = assertExactPlayer(read, runtime, rootId);
      // Catalog reads remain public. A connected Player receives the exact
      // definitions and attached layout from the SAME read as its choices.
      const contextWallet = wallet ?? productRuntime.wallet;
      if (typeof productRuntime.playerContext?.load !== 'function'
        || typeof contextWallet?.getCurrentAccount !== 'function') return player;
      const account = await contextWallet.getCurrentAccount();
      if (account === null) return player;
      const signer = assertAccount(account).address;
      requireMethod(contextWallet, 'subscribe', 'Player context wallet');
      let walletRevision, walletChanged = false;
      const unsubscribe = contextWallet.subscribe(value => {
        if (!Number.isSafeInteger(value?.revision) || value.revision < 0) walletChanged = true;
        else if (walletRevision === undefined) walletRevision = value.revision;
        else if (walletRevision !== value.revision) walletChanged = true;
      });
      try {
        if (typeof unsubscribe !== 'function' || walletRevision === undefined || walletChanged) {
          fail('MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID', 'Player definition reads require wallet change observation.', 'WALLET');
        }
        const context = await productRuntime.playerContext.load({ address: signer, rootId });
        const after = assertAccount(await contextWallet.getCurrentAccount());
        if (after.address !== signer || walletChanged) fail('MAKER_V8_PLAYER_ACCOUNT_DRIFT',
          'Wallet changed while loading Player definitions.', 'WALLET');
        exactRecord(context, ['choices', 'definitions'], 'Player definition context', 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID');
        const definitions = context.definitions, choices = context.choices;
        exactRecord(choices, ['schemaVersion', 'address', 'rootId', 'baseEntitlements', 'packStyles',
          'externalStyles', 'certifiedAssets', 'diagnostics'], 'Player choices', 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID');
        exactRecord(definitions, ['schemaVersion', 'address', 'rootId', 'packs', 'currentLoadout'],
          'Player definitions', 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID');
        if (definitions.schemaVersion !== 'animacraft.maker-v8-player-definitions.v1'
          || definitions.address !== signer || definitions.rootId !== rootId || !Array.isArray(definitions.packs)
          || choices?.schemaVersion !== 'animacraft.maker-v8-contextual-choices.v1'
          || choices.address !== signer || choices.rootId !== rootId
          || !['baseEntitlements', 'packStyles', 'externalStyles', 'certifiedAssets'].every(key => Array.isArray(choices[key]))
          || !Array.isArray(choices.diagnostics) || choices.diagnostics.length) {
          fail('MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID', 'Player definitions differ from the exact signer/Root choices.', 'READ');
        }
        if (definitions.currentLoadout !== null) {
          const current = definitions.currentLoadout;
          exactRecord(current, ['objectId', 'revision', 'layout'], 'Player current Loadout', 'MAKER_V8_PLAYER_DEFINITION_CONTEXT_INVALID');
          exactId(current.objectId, 'Player current Loadout ID');
          exactDecimal(current.revision, 'Player current Loadout revision');
          makerV8PlayerSlotLayout({ rootId, parts: player.document.parts, packDefinitionLayout: current.layout });
        }
        return freeze({ ...clone(player), definitionContext: clone(definitions), contextualChoices: clone(choices) });
      } finally { if (typeof unsubscribe === 'function') unsubscribe(); }
    } catch (cause) {
      if (!(cause instanceof MakerV8PlayerControllerError)
        && typeof cause?.code === 'string' && typeof cause?.layer === 'string') {
        throw new MakerV8PlayerControllerError(
          cause.code,
          String(cause.message ?? 'Exact ACTIVE Maker/Manifest/Document read failed.'),
          cause.layer,
          {
            causeCode: cause.code,
            causeLayer: cause.layer,
            cause: String(cause.message ?? cause),
          },
          cause.retryable === true,
        );
      }
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_READ_FAILED',
        'Exact ACTIVE Maker/Manifest/Document read failed.',
        'READ',
        cause?.retryable === true,
      );
    }
  };

  const samePlayer = (expected, observed) => {
    if (expected.rootId !== observed.rootId
      || expected.makerVersion !== observed.makerVersion
      || expected.evidence.contentCommitment !== observed.evidence.contentCommitment
      || !sameCanonical(expected.document, observed.document)) {
      fail('MAKER_V8_PLAYER_REFRESH_DRIFT', 'Player changed after the local Recipe was reviewed.', 'CONTEXT');
    }
    return observed;
  };

  const exactChainAndAccount = async () => {
    try {
      assertMainnetIdentifier(await rpc.getChainIdentifier());
    } catch (cause) {
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_NETWORK_READ_FAILED',
        'Pinned Mainnet chain verification failed.',
        'CONTEXT',
        true,
      );
    }
    try {
      return assertAccount(await wallet.getCurrentAccount());
    } catch (cause) {
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_WALLET_UNAVAILABLE',
        'A current Sui Mainnet wallet account is required.',
        'WALLET',
      );
    }
  };

  const liveContext = async ({ action, player, recipe, loadout, input, account }) => {
    let context;
    try {
      context = await custody.loadPlayerContext({
        action, player: clone(player), recipe: clone(recipe),
        loadout: clone(loadout), input: clone(input), account,
      });
      context = assertPlayerContext(context, action, player, recipe, account);
      const certified = await custody.assertPlayerContext({
        action, player: clone(player), recipe: clone(recipe),
        loadout: clone(loadout), input: clone(input), account, context,
      });
      if (certified !== true
        && (!plain(certified) || certified.certified !== true)) {
        fail(
          'MAKER_V8_PLAYER_CUSTODY_CERTIFICATE_INVALID',
          'Custody adapter did not certify access, Pack admission, and ownership.',
          'CUSTODY',
        );
      }
    } catch (cause) {
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_CUSTODY_FAILED',
        'Player access, Pack admission, or custody verification failed.',
        'CUSTODY',
      );
    }
    const protectedAction = ![
      MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS,
      MAKER_V8_PLAYER_ACTIONS.ACQUIRE_BASE_ITEM,
      MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
    ].includes(action);
    if (protectedAction && !gates.allowProtectedContent
      && protectedRequired(player, recipe, context)) {
      fail(
        'MAKER_V8_PLAYER_PROTECTED_CONTENT_DISABLED',
        'Protected Player content remains fail-closed without the server-only credential path.',
        'GATE',
      );
    }
    return context;
  };

  const createContext = async ({ action, player, recipe, loadout, input }) => {
    const account = await exactChainAndAccount();
    const refreshed = samePlayer(player, await readExact(player.rootId));
    const context = await liveContext({
      action, player: refreshed, recipe, loadout, input, account,
    });
    return freeze({ account, player: refreshed, context });
  };

  const persistCas = async (record, patch) => {
    const next = {
      ...clone(record),
      ...clone(patch),
      revision: record.revision + 1,
      updatedAt: clock(),
    };
    let written;
    try {
      written = await persistence.compareAndSwap(record.actionId, record.revision, next);
      assertActionRecord(written, runtime);
      if (!sameCanonical(written, next)) {
        fail('MAKER_V8_PLAYER_PERSISTENCE_DRIFT', 'Player action CAS reread drifted.', 'PERSISTENCE');
      }
      return freeze(clone(written));
    } catch (cause) {
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_PERSISTENCE_FAILED',
        'Durable Player action checkpoint failed.',
        'PERSISTENCE',
      );
    }
  };

  const readRecord = async (actionId) => {
    exactHash(actionId, 'actionId');
    let record;
    try {
      record = await persistence.load(actionId);
    } catch (cause) {
      throw asPlayerError(cause, 'MAKER_V8_PLAYER_LOAD_ACTION_FAILED', 'Player action could not be loaded.', 'PERSISTENCE', true);
    }
    if (!record) fail('MAKER_V8_PLAYER_ACTION_NOT_FOUND', 'Player action was not found.', 'PERSISTENCE');
    assertActionRecord(record, runtime);
    if (record.actionId !== actionId) {
      fail('MAKER_V8_PLAYER_PERSISTENCE_DRIFT', 'Player action lookup returned another record.', 'PERSISTENCE');
    }
    return freeze(clone(record));
  };

  const readbackFinalized = async (record, query) => {
    let certificate;
    try {
      certificate = assertReadback(await custody.readbackPlayerAction({
        record: clone(record), query: clone(query),
      }), record, query);
    } catch (cause) {
      const error = asPlayerError(
        cause,
        'MAKER_V8_PLAYER_READBACK_FAILED',
        'Finalized Player action readback could not be certified.',
        'READBACK',
        true,
      );
      await persistCas(record, {
        status: 'FINALIZED_UNCERTIFIED', query, certificate: null,
        error: durableError(error),
      });
      throw error;
    }
    return persistCas(record, {
      status: 'FINALIZED_SUCCESS', query, certificate, error: null,
    });
  };

  const settleQuery = async (record, query) => {
    if (!plain(query) || query.digest !== record.transaction.digest) {
      fail('MAKER_V8_PLAYER_QUERY_INVALID', 'Transaction query does not bind the exact durable digest.', 'RECOVERY');
    }
    if (query.status === 'FINALIZED_SUCCESS') return readbackFinalized(record, query);
    if (query.status === 'FINALIZED_FAILURE') {
      return persistCas(record, {
        status: 'FINALIZED_FAILURE', query, certificate: null,
        error: freeze({
          code: 'MAKER_V8_PLAYER_TRANSACTION_FAILED', layer: 'FINALITY',
          message: String(query.error?.message ?? 'Player transaction finalized with failure.'),
          retryable: false, details: {},
        }),
      });
    }
    if (query.status === 'NOT_FOUND') return null;
    fail(
      'MAKER_V8_PLAYER_QUERY_STATUS_INVALID',
      'Player transaction query returned an unknown finality state.',
      'RECOVERY',
      { status: query.status ?? null },
    );
  };

  const queryExact = async (record) => {
    try {
      const query = await rpc.queryTransaction({ digest: record.transaction.digest });
      assertJson(query, 'transactionQuery');
      return freeze(clone(assertTransactionQuery(
        query,
        record.transaction.digest,
        'transactionQuery',
      )));
    } catch (cause) {
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_QUERY_FAILED',
        'Exact transaction finality query failed.',
        'RECOVERY',
        true,
      );
    }
  };

  const refreshForExecution = async (record) => {
    const player = await readExact(record.playerIdentity.rootId);
    if (player.makerVersion !== record.playerIdentity.makerVersion
      || player.evidence.contentCommitment !== record.playerIdentity.rootContentCommitment) {
      fail('MAKER_V8_PLAYER_ACTION_ROOT_DRIFT', 'Durable action belongs to another Root version.', 'CONTEXT');
    }
    const recipe = normalizeRecipe(player.document, record.recipe, player);
    const loadout = loadoutFor(player, recipe);
    if (!sameCanonical(loadout, record.loadout)) {
      fail('MAKER_V8_PLAYER_ACTION_RECIPE_DRIFT', 'Durable action Recipe/loadout drifted.', 'CONTEXT');
    }
    const input = assertActionInput(record.action, record.input, recipe, player.document);
    const account = await exactChainAndAccount();
    if (account.address !== record.plan.signer) {
      fail('MAKER_V8_PLAYER_ACCOUNT_DRIFT', 'Wallet differs from the durable Player signer.', 'WALLET');
    }
    const context = await liveContext({
      action: record.action, player, recipe, loadout, input, account,
    });
    if (makerV8PlayerContextCommitmentV8(context) !== record.plan.contextCommitment
      || record.transaction.build.custodyContext !== undefined
        && !makerV8PlayerContextsMatchAfterClockProgressV8(context, record.transaction.build.custodyContext)) {
      fail('MAKER_V8_PLAYER_CONTEXT_DRIFT', 'Live Player custody context differs from the signed plan.', 'CONTEXT');
    }
    let fresh;
    try {
      fresh = await compiler.assertPlayerActionFresh({
        action: record.action, plan: clone(record.plan), player: clone(player), recipe: clone(recipe),
        loadout: clone(loadout), input: clone(input), account, context,
      });
    } catch (cause) {
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_COMPILER_CONTEXT_STALE',
        'Player compiler context is no longer fresh.',
        'COMPILER',
      );
    }
    if (!plain(fresh) || fresh.authority !== compiler.authority || fresh.fresh !== true) {
      fail('MAKER_V8_PLAYER_COMPILER_FRESHNESS_INVALID', 'Compiler did not certify current Player authority.', 'COMPILER');
    }
    const durableTransaction = assertBuiltTransaction(
      record.transaction.build,
      record.plan,
      runtime,
    );
    if (durableTransaction.bytes !== record.transaction.bytes
      || durableTransaction.digest !== record.transaction.digest) {
      fail('MAKER_V8_PLAYER_DURABLE_BYTES_DRIFT', 'Durable Player TransactionData drifted.', 'CONTEXT');
    }
    let transaction;
    try {
      transaction = assertBuiltTransaction(
        await boundary.buildExactTransaction({ descriptor: record.plan.descriptor }),
        record.plan,
        runtime,
      );
    } catch (cause) {
      throw asPlayerError(
        cause,
        'MAKER_V8_PLAYER_REBUILD_FAILED',
        'Exact Player TransactionData could not be re-authorized for simulation.',
        'BUILD',
      );
    }
    if (transaction.bytes !== durableTransaction.bytes
      || transaction.digest !== durableTransaction.digest) {
      fail(
        'MAKER_V8_PLAYER_REBUILD_DRIFT',
        'Fresh exact-boundary build differs from the durable Player TransactionData.',
        'CONTEXT',
      );
    }
    let dryRun;
    try {
      dryRun = await boundary.dryRunExactTransaction({
        transactionBytes: transaction.bytes,
        descriptor: record.plan.descriptor,
      });
    } catch (cause) {
      throw asPlayerError(cause, 'MAKER_V8_PLAYER_SIMULATION_FAILED', 'Exact Player simulation failed.', 'SIMULATION', true);
    }
    if (dryRun?.status !== 'SUCCESS') {
      fail('MAKER_V8_PLAYER_SIMULATION_REJECTED', 'Exact Player simulation did not succeed.', 'SIMULATION', { dryRun: clone(dryRun) });
    }
    return freeze({ player, recipe, loadout, input, account, context, transaction });
  };

  const controller = {
    schemaVersion: MAKER_V8_PLAYER_CONTROLLER_SCHEMA,

    getSnapshot() {
      return state;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') fail('MAKER_V8_PLAYER_LISTENER_INVALID', 'Player listener must be a function.');
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    async loadPlayer(rootId) {
      const token = ++loadToken;
      publish({ ...state, status: 'LOADING', diagnostics: [], lastError: null });
      try {
        const player = await readExact(rootId);
        const recipe = initialRecipe(player);
        const loadout = loadoutFor(player, recipe);
        if (token !== loadToken) return state;
        return publish({
          ...state, status: 'READY', player, recipe, loadout,
          diagnostics: [], lastError: null,
        });
      } catch (cause) {
        const error = asPlayerError(cause, 'MAKER_V8_PLAYER_READ_FAILED', 'Player could not be loaded.', 'READ', true);
        if (token !== loadToken) return state;
        return publish({
          ...state, status: 'ERROR', player: null, recipe: null, loadout: null,
          diagnostics: [diagnostic(error)], lastError: diagnostic(error),
        });
      }
    },

    setRecipe(recipeInput) {
      if (state.status !== 'READY' || !state.player) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load one exact ACTIVE Maker before editing its Recipe.');
      }
      try {
        const recipe = normalizeRecipe(state.player.document, recipeInput, state.player);
        const loadout = loadoutFor(state.player, recipe);
        publish({ ...state, recipe, loadout, lastError: null });
        return recipe;
      } catch (cause) {
        const error = asPlayerError(cause, 'MAKER_V8_PLAYER_RECIPE_INVALID', 'Recipe validation failed.', 'VALIDATION');
        publish({ ...state, lastError: diagnostic(error, 'VALIDATION') });
        throw error;
      }
    },

    updateRecipe(patch) {
      if (state.status !== 'READY' || !state.recipe) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load one exact ACTIVE Maker before editing its Recipe.');
      }
      if (!plain(patch)) fail('MAKER_V8_PLAYER_RECIPE_PATCH_INVALID', 'Recipe patch must be a plain record.');
      const allowed = new Set(['selections', 'colors', 'outputKey']);
      const unknown = Object.keys(patch).filter((field) => !allowed.has(field));
      if (unknown.length) fail('MAKER_V8_PLAYER_RECIPE_PATCH_INVALID', 'Recipe patch contains unknown fields.', 'VALIDATION', { unknown });
      return controller.setRecipe({ ...clone(state.recipe), ...clone(patch) });
    },

    resetRecipe() {
      if (state.status !== 'READY' || !state.player) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load one exact ACTIVE Maker before resetting its Recipe.');
      }
      return controller.setRecipe(initialRecipe(state.player));
    },

    async quotePlayerCompletion() {
      if (state.status !== 'READY' || !state.player || !state.recipe || !state.loadout) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load one exact ACTIVE Maker before quoting completion.');
      }
      requireMethod(custody, 'quotePlayerCompletion', 'custody');
      requireMethod(wallet, 'subscribe', 'wallet');
      const snapshot = state;
      const token = ++quoteToken;
      const recipe = normalizeRecipe(snapshot.player.document, snapshot.recipe, snapshot.player);
      const loadout = loadoutFor(snapshot.player, recipe);
      let revision;
      let walletChanged = false;
      const unsubscribe = wallet.subscribe(value => {
        if (!Number.isSafeInteger(value?.revision) || value.revision < 0) walletChanged = true;
        else if (revision === undefined) revision = value.revision;
        else if (revision !== value.revision) walletChanged = true;
      });
      const assertCurrent = () => {
        if (state !== snapshot || token !== quoteToken || walletChanged || revision === undefined) {
          fail('MAKER_V8_PLAYER_QUOTE_STALE', 'Wallet, Maker or Recipe changed while reading the completion overview.', 'PLAYER');
        }
      };
      try {
        if (typeof unsubscribe !== 'function') fail('MAKER_V8_PLAYER_QUOTE_UNAVAILABLE', 'Wallet change observation is unavailable.', 'CONFIGURATION');
        const account = await exactChainAndAccount();
        assertCurrent();
        const player = samePlayer(snapshot.player, await readExact(snapshot.player.rootId));
        assertCurrent();
        const quote = await custody.quotePlayerCompletion({
          player: clone(player), recipe: clone(recipe), loadout: clone(loadout), account,
        });
        const currentAccount = await exactChainAndAccount();
        assertCurrent();
        if (currentAccount.address !== account.address) fail('MAKER_V8_PLAYER_QUOTE_STALE', 'Completion overview belongs to another wallet.', 'WALLET');
        exactRecord(quote, ['rootId', 'signer', 'recipeCommitment', 'completePaymentQuote', 'entryPaymentQuote',
          'totalBusinessAmountAtomic'], 'completion overview', 'MAKER_V8_PLAYER_QUOTE_INVALID');
        assertJson(quote, 'completion overview');
        if (quote.rootId !== player.rootId || quote.signer !== account.address
          || quote.recipeCommitment !== loadout.recipeCommitment
          || quote.entryPaymentQuote?.paymentCoinType !== runtime.paymentCoinType
          || quote.completePaymentQuote?.paymentCoinType !== runtime.paymentCoinType
          || BigInt(exactDecimal(quote.totalBusinessAmountAtomic, 'completion total'))
            !== BigInt(exactDecimal(quote.entryPaymentQuote.totalAmountAtomic, 'entry total'))
              + BigInt(exactDecimal(quote.completePaymentQuote.totalAmountAtomic, 'Complete total'))) {
          fail('MAKER_V8_PLAYER_QUOTE_INVALID', 'Completion overview does not bind this exact Player intent and payment coin.', 'PLAYER');
        }
        return freeze(clone(quote));
      } finally { if (typeof unsubscribe === 'function') unsubscribe(); }
    },

    async resolveProtectedOutputIdentity() {
      if (gates.allowProtectedContent !== true) {
        fail(
          'MAKER_V8_PLAYER_PROTECTED_CONTENT_DISABLED',
          'Protected Output remains disabled until its server-only Seal path is enabled.',
          'GATE',
        );
      }
      if (state.status !== 'READY' || !state.player || !state.recipe) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load one exact ACTIVE Maker before resolving protected Output identity.');
      }
      if (typeof custody.resolveProtectedOutputIdentity !== 'function') {
        fail(
          'MAKER_V8_PLAYER_PROTECTED_IDENTITY_UNAVAILABLE',
          'The production custody adapter does not expose protected Output identity.',
          'CONFIGURATION',
        );
      }
      const output = state.player.document.outputs.find(
        (entry) => entry.key === state.recipe.outputKey,
      );
      if (output?.protected !== true) {
        fail('MAKER_V8_PLAYER_PROTECTED_OUTPUT_REQUIRED', 'The selected Output is not protected.');
      }
      const recipe = normalizeRecipe(state.player.document, state.recipe, state.player);
      const loadout = loadoutFor(state.player, recipe);
      const account = await exactChainAndAccount();
      const player = samePlayer(state.player, await readExact(state.player.rootId));
      const identity = await custody.resolveProtectedOutputIdentity({
        action: MAKER_V8_PLAYER_ACTIONS.COMPLETE_OUTPUT,
        player: clone(player),
        recipe: clone(recipe),
        loadout: clone(loadout),
        input: {},
        account,
      });
      return assertProtectedRenderIdentity(identity, player, recipe, account);
    },

    async reuseCommittedPlayerLoadout() {
      requireWrite();
      if (state.status !== 'READY' || !state.player || !state.recipe || !state.loadout) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load the exact Player before checking its committed Loadout.');
      }
      requireMethod(custody, 'matchesCommittedPlayerLoadout', 'custody');
      requireMethod(wallet, 'subscribe', 'wallet');
      const snapshot = state;
      const recipe = normalizeRecipe(snapshot.player.document, snapshot.recipe, snapshot.player);
      const loadout = loadoutFor(snapshot.player, recipe);
      let revision, changed = false;
      const unsubscribe = wallet.subscribe(value => {
        if (!Number.isSafeInteger(value?.revision) || value.revision < 0) changed = true;
        else if (revision === undefined) revision = value.revision;
        else if (revision !== value.revision) changed = true;
      });
      const assertCurrent = () => {
        if (state !== snapshot || changed || revision === undefined) {
          fail('MAKER_V8_PLAYER_LOADOUT_REUSE_STALE', 'Wallet or Player changed while checking the committed Loadout.', 'RECOVERY');
        }
      };
      try {
        if (typeof unsubscribe !== 'function') {
          fail('MAKER_V8_PLAYER_LOADOUT_REUSE_STALE', 'Wallet change observation is unavailable.', 'RECOVERY');
        }
        assertCurrent();
        const account = await exactChainAndAccount();
        assertCurrent();
        const rootScope = { rootId: snapshot.player.rootId, signer: account.address };
        const activeId = await persistence.resolveRootActive(rootScope);
        const active = activeId === null ? null : await readRecord(activeId);
        const scopeKey = playerActionScope({ action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT,
          signer: account.address, playerIdentity: { rootId: snapshot.player.rootId,
            makerVersion: snapshot.player.makerVersion,
            rootContentCommitment: snapshot.player.evidence.contentCommitment },
          recipeCommitment: loadout.recipeCommitment, input: {} });
        // Signed/uncertain or differently scoped work must recover through its
        // original action. Only a never-signed duplicate may be retired below.
        if (active && (active.status !== 'PREPARED' || active.scopeKey !== scopeKey
          || active.action !== MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT
          || [active.signatureIntent, active.signature, active.broadcast,
            active.query, active.certificate].some(value => value !== null))) return false;
        const live = await createContext({ action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT,
          player: snapshot.player, recipe, loadout, input: {} });
        assertCurrent();
        if (live.account.address !== account.address) {
          fail('MAKER_V8_PLAYER_ACCOUNT_DRIFT', 'Loadout reuse belongs to another wallet.', 'WALLET');
        }
        const matches = await custody.matchesCommittedPlayerLoadout({
          action: MAKER_V8_PLAYER_ACTIONS.COMMIT_LOADOUT, player: clone(live.player),
          recipe: clone(recipe), loadout: clone(loadout), input: {},
          account: live.account, context: live.context,
        });
        assertCurrent();
        if (typeof matches !== 'boolean') {
          fail('MAKER_V8_PLAYER_CUSTODY_DRIFT', 'Committed Loadout comparison lacks exact custody evidence.', 'CUSTODY');
        }
        const after = await exactChainAndAccount();
        assertCurrent();
        if (after.address !== account.address) {
          fail('MAKER_V8_PLAYER_ACCOUNT_DRIFT', 'Wallet changed while checking the committed Loadout.', 'WALLET');
        }
        if (await persistence.resolveRootActive(rootScope) !== activeId) {
          fail('MAKER_V8_PLAYER_ACTIVE_SCOPE_DRIFT', 'Durable action changed during Loadout reuse.', 'RECOVERY');
        }
        if (!matches) return false;
        if (active) {
          await persistence.requirePersistentStorage();
          await persistence.preflightQuota(1_048_576);
          assertCurrent();
          // The persistence CAS independently rejects any concurrent signing
          // intent/artifact and preserves the original plan and transaction.
          await persistCas(active, { status: 'CANCELLED_UNSIGNED', error: null });
        }
        assertCurrent();
        return true;
      } finally { if (typeof unsubscribe === 'function') unsubscribe(); }
    },

    async preparePlayerAction({ action, input = {} } = {}) {
      requireWrite();
      if (state.status !== 'READY' || !state.player || !state.recipe || !state.loadout) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load and validate one exact Player Recipe first.');
      }
      // All caller-controlled references are checked before wallet or chain access.
      const recipe = normalizeRecipe(state.player.document, state.recipe, state.player);
      const loadout = loadoutFor(state.player, recipe);
      const checkedInput = assertActionInput(action, input, recipe, state.player.document);
      let prepared;
      // A prior signed acquisition may already have changed live ownership.
      // Resolve its durable scope before a new-purchase custody preflight.
      try {
        const pending = await controller.recoverActivePlayerAction({ action, input: checkedInput });
        const original = await readRecord(pending.actionId);
        if (original.status !== 'PREPARED' || original.transaction.build.custodyContext !== undefined
          || original.plan.descriptor.schemaVersion !== 'animacraft.maker-v8-player-descriptor.v2') return pending;
        // The previous writer did not retain a custody snapshot. It cannot be
        // re-authorized safely. Explicit preparation may retire only a record
        // that never entered signing; CAS preserves all original plan/bytes.
        await persistCas(original, { status: 'CANCELLED_UNSIGNED', error: null });
      } catch (error) {
        if (error?.code !== 'MAKER_V8_PLAYER_ACTIVE_ACTION_NOT_FOUND') throw error;
      }
      try {
        await persistence.requirePersistentStorage();
        await persistence.preflightQuota(1_048_576);
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_DURABILITY_REQUIRED', 'Durable storage is required before Player execution.', 'PERSISTENCE');
      }
      const live = await createContext({
        action, player: state.player, recipe, loadout, input: checkedInput,
      });
      const playerIdentity = freeze({
        rootId: live.player.rootId,
        makerVersion: live.player.makerVersion,
        rootContentCommitment: live.player.evidence.contentCommitment,
      });
      const scopeKey = playerActionScope({
        action,
        signer: live.account.address,
        playerIdentity,
        recipeCommitment: loadout.recipeCommitment,
        input: checkedInput,
      });
      let activeId;
      try {
        activeId = await persistence.resolveActive(scopeKey);
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_ACTIVE_LOOKUP_FAILED', 'Durable Player action scope could not be resolved.', 'PERSISTENCE', true);
      }
      if (activeId !== null) {
        exactHash(activeId, 'activeActionId');
        const active = await readRecord(activeId);
        if (active.scopeKey !== scopeKey) {
          fail('MAKER_V8_PLAYER_ACTIVE_SCOPE_DRIFT', 'Active Player scope returned another action.', 'PERSISTENCE');
        }
      if (['SIGNED', 'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN', 'FINALIZED_UNCERTIFIED',
          'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(active.status)) {
          return controller.recoverPlayerAction(active.actionId, { replayIfNotFound: false });
        }
        return actionView(active, active.status === 'PREPARED'
          ? 'AWAITING_SIGNATURE' : 'SIGNATURE_OUTCOME_UNKNOWN');
      }
      try {
        prepared = await compiler.preparePlayerAction({
          action, player: clone(live.player), recipe: clone(recipe),
          loadout: clone(loadout), input: clone(checkedInput),
          account: live.account, context: live.context,
        });
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_COMPILE_FAILED', 'Exact Player action compilation failed.', 'COMPILER');
      }
      const plan = assertCompilerPlan(
        prepared, compiler, action, live.player, recipe, live.context, live.account,
      );
      assertActionTargets(action, plan.targets, runtime);
      let transaction;
      try {
        transaction = assertBuiltTransaction(
          await boundary.buildExactTransaction({ descriptor: plan.descriptor }),
          plan,
          runtime,
        );
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_BUILD_FAILED', 'Exact Player TransactionData build failed.', 'BUILD');
      }
      let dryRun;
      try {
        dryRun = await boundary.dryRunExactTransaction({
          transactionBytes: transaction.bytes, descriptor: plan.descriptor,
        });
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_SIMULATION_FAILED', 'Exact Player simulation failed.', 'SIMULATION', true);
      }
      if (dryRun?.status !== 'SUCCESS') {
        fail('MAKER_V8_PLAYER_SIMULATION_REJECTED', 'Exact Player simulation did not succeed.', 'SIMULATION', { dryRun: clone(dryRun) });
      }
      const createdAt = clock();
      const actionId = hashValue({ plan, digest: transaction.digest });
      const record = {
        schemaVersion: MAKER_V8_PLAYER_ACTION_RECORD_SCHEMA,
        actionId,
        scopeKey,
        revision: 1,
        status: 'PREPARED',
        action,
        createdAt,
        updatedAt: createdAt,
        playerIdentity: clone(playerIdentity),
        recipe: clone(recipe),
        loadout: clone(loadout),
        input: clone(checkedInput),
        plan: clone(plan),
        transaction: {
          build: { ...clone(transaction.build), custodyContext: clone(live.context) },
          bytes: transaction.bytes,
          digest: transaction.digest,
          targets: clone(transaction.targets),
        },
        signatureIntent: null,
        signature: null,
        broadcast: null,
        query: null,
        certificate: null,
        error: null,
      };
      let written;
      try {
        written = await persistence.create(record);
        assertActionRecord(written, runtime);
        if (!sameCanonical(written, record)) {
          fail('MAKER_V8_PLAYER_PERSISTENCE_DRIFT', 'Prepared Player action durable reread drifted.', 'PERSISTENCE');
        }
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_PREPARE_PERSIST_FAILED', 'Prepared Player action was not durably stored.', 'PERSISTENCE');
      }
      return actionView(written);
    },

    async executePlayerAction(actionId) {
      requireWrite();
      let record = await readRecord(actionId);
      if (['SIGNED', 'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN', 'FINALIZED_UNCERTIFIED'].includes(record.status)) {
        return controller.recoverPlayerAction(actionId, { replayIfNotFound: false });
      }
      if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(record.status)) {
        return controller.recoverPlayerAction(actionId, { replayIfNotFound: false });
      }
      if (record.status !== 'PREPARED') {
        fail('MAKER_V8_PLAYER_ACTION_NOT_EXECUTABLE', `Player action is ${record.status}, not PREPARED.`, 'SIGNING');
      }
      try {
        await persistence.requirePersistentStorage();
        await persistence.preflightQuota(262_144);
      } catch (cause) {
        throw asPlayerError(
          cause,
          'MAKER_V8_PLAYER_DURABILITY_REQUIRED',
          'Durable storage is required before the signature prompt.',
          'PERSISTENCE',
        );
      }
      const live = await refreshForExecution(record);
      const intentStartedAt = clock();
      const signatureIntent = freeze({
        sessionId: signatureSession(),
        leaseExpiresAt: intentStartedAt + signatureLeaseMs,
      });
      record = await persistCas(record, {
        status: 'SIGNING', signatureIntent, error: null,
      });
      let signedRaw;
      try {
        signedRaw = await wallet.signExactTransaction({
          bytes: live.transaction.bytes,
          digest: live.transaction.digest,
          signer: live.account.address,
        });
      } catch (cause) {
        const definitive = cause?.definitiveRejection === true
          && cause?.signedArtifactCreated === false
          || isDefinitiveWalletStandardRejectionV8(cause);
        const error = asPlayerError(
          cause,
          definitive
            ? 'MAKER_V8_PLAYER_WALLET_REQUEST_REJECTED'
            : 'MAKER_V8_PLAYER_SIGNATURE_OUTCOME_UNKNOWN',
          definitive
            ? 'Wallet rejected the Player signature request before creating an artifact.'
            : 'Wallet signature outcome is uncertain; automatic replacement signing is forbidden.',
          'SIGNING',
          false,
        );
        await persistCas(record, {
          status: definitive ? 'PREPARED' : 'SIGNING_UNKNOWN',
          signatureIntent: definitive ? null : record.signatureIntent,
          error: durableError(error),
        });
        throw error;
      }
      const signed = assertSignatureArtifact(signedRaw, live.transaction, live.account.address);
      let verified;
      try {
        verified = await wallet.verifyExactSignature({
          bytes: signed.bytes, signature: signed.signature,
          digest: signed.digest, signer: signed.signer,
        });
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_SIGNATURE_VERIFY_FAILED', 'Exact Player signature verification failed.', 'SIGNING');
      }
      if (!verified || verified.verified === false
        || verified.bytes && verified.bytes !== signed.bytes
        || verified.digest && verified.digest !== signed.digest
        || verified.signer && verified.signer !== signed.signer) {
        const error = new MakerV8PlayerControllerError(
          'MAKER_V8_PLAYER_SIGNATURE_INVALID',
          'Signature does not authenticate the exact durable Player TransactionData.',
          'SIGNING',
        );
        await persistCas(record, { status: 'SIGNING_UNKNOWN', error: durableError(error) });
        throw error;
      }
      record = await persistCas(record, {
        status: 'SIGNED', signatureIntent: null, signature: signed, error: null,
      });
      let broadcast;
      try {
        broadcast = await boundary.broadcastExactTransaction({
          bytes: record.signature.bytes,
          signature: record.signature.signature,
          digest: record.signature.digest,
          signer: record.signature.signer,
        });
      } catch (cause) {
        throw asPlayerError(
          cause,
          'MAKER_V8_PLAYER_BROADCAST_OUTCOME_UNKNOWN',
          'Player broadcast outcome is uncertain; recover by querying the exact digest.',
          'BROADCAST',
          true,
          { actionId },
        );
      }
      if (!plain(broadcast) || broadcast.digest !== record.transaction.digest
        || broadcast.accepted !== true) {
        fail('MAKER_V8_PLAYER_BROADCAST_INVALID', 'Broadcast did not accept the exact durable digest.', 'BROADCAST');
      }
      record = await persistCas(record, {
        status: 'BROADCAST_ACCEPTED', broadcast: clone(broadcast), error: null,
      });
      const query = await queryExact(record);
      const finalized = await settleQuery(record, query);
      if (finalized) return actionView(finalized);
      record = await persistCas(record, { status: 'BROADCAST_ACCEPTED', query, error: null });
      return actionView(record, 'AWAITING_FINALITY');
    },

    async recoverPlayerAction(actionId, { replayIfNotFound = false } = {}) {
      requireWrite();
      if (typeof replayIfNotFound !== 'boolean') {
        fail('MAKER_V8_PLAYER_RECOVERY_OPTIONS_INVALID', 'replayIfNotFound must be boolean.', 'RECOVERY');
      }
      let record = await readRecord(actionId);
      if (record.status === 'CANCELLED_UNSIGNED') return actionView(record, 'CANCELLED_UNSIGNED');
      if (record.status === 'PREPARED') return actionView(record, 'AWAITING_SIGNATURE');
      if (['SIGNING', 'SIGNING_UNKNOWN'].includes(record.status)) {
        return actionView(record, 'SIGNATURE_OUTCOME_UNKNOWN');
      }
      if (!['SIGNED', 'BROADCAST_ACCEPTED', 'OUTCOME_UNKNOWN', 'FINALIZED_UNCERTIFIED',
        'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(record.status)
        || !plain(record.signature)) {
        fail('MAKER_V8_PLAYER_RECOVERY_STATE_INVALID', 'Player action has no recoverable exact signed artifact.', 'RECOVERY');
      }
      let query;
      try {
        query = await queryExact(record);
      } catch (error) {
        record = await persistCas(record, {
          status: 'OUTCOME_UNKNOWN', error: durableError(error),
        });
        throw error;
      }
      const finalized = await settleQuery(record, query);
      if (finalized) return actionView(finalized);
      if (!plain(query.absence)
        || query.absence.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
        fail(
          'MAKER_V8_PLAYER_ABSENCE_EVIDENCE_INVALID',
          'NOT_FOUND recovery requires exact Mainnet checkpoint absence evidence.',
          'RECOVERY',
        );
      }
      const expirationEpoch = BigInt(record.transaction.build.epochWindow.end);
      if (BigInt(query.absence.watermarkEpoch) > expirationEpoch) {
        if (record.status === 'EXPIRED_NOT_FOUND') {
          return actionView(record, 'EXPIRED_NOT_FOUND');
        }
        const expired = new MakerV8PlayerControllerError(
          'MAKER_V8_PLAYER_TRANSACTION_EXPIRED',
          'Authoritative Mainnet absence is beyond the signed Player transaction expiration.',
          'RECOVERY',
          { expirationEpoch: expirationEpoch.toString() },
          false,
        );
        record = await persistCas(record, {
          status: 'EXPIRED_NOT_FOUND', query, certificate: null,
          error: durableError(expired),
        });
        return actionView(record, 'EXPIRED_NOT_FOUND');
      }
      if (!replayIfNotFound) {
        record = await persistCas(record, {
          status: 'OUTCOME_UNKNOWN', query, error: null,
        });
        return actionView(record, 'NOT_FOUND_REPLAY_AVAILABLE');
      }
      requireWrite();
      await refreshForExecution(record);
      const verified = await wallet.verifyExactSignature({
        bytes: record.signature.bytes,
        signature: record.signature.signature,
        digest: record.signature.digest,
        signer: record.signature.signer,
      });
      if (!verified || verified.verified === false) {
        fail('MAKER_V8_PLAYER_SIGNATURE_INVALID', 'Durable recovery signature is invalid.', 'RECOVERY');
      }
      let broadcast;
      try {
        broadcast = await boundary.broadcastExactTransaction({
          bytes: record.signature.bytes,
          signature: record.signature.signature,
          digest: record.signature.digest,
          signer: record.signature.signer,
        });
      } catch (cause) {
        throw asPlayerError(
          cause,
          'MAKER_V8_PLAYER_REPLAY_OUTCOME_UNKNOWN',
          'Exact signed Player replay outcome is uncertain.',
          'BROADCAST',
          true,
          { actionId },
        );
      }
      if (broadcast?.accepted !== true || broadcast.digest !== record.transaction.digest) {
        fail('MAKER_V8_PLAYER_BROADCAST_INVALID', 'Recovery replay accepted another digest.', 'BROADCAST');
      }
      record = await persistCas(record, {
        status: 'BROADCAST_ACCEPTED', broadcast: clone(broadcast), query, error: null,
      });
      return actionView(record, 'REPLAYED_EXACT_SIGNATURE');
    },

    async recoverActivePlayerAction({ action, input = {} } = {}) {
      requireWrite();
      if (state.status !== 'READY' || !state.player || !state.recipe || !state.loadout) {
        fail('MAKER_V8_PLAYER_NOT_READY', 'Load the exact Player before resolving its durable action scope.', 'RECOVERY');
      }
      const checkedInput = assertActionInput(action, input, state.recipe, state.player.document);
      const account = await exactChainAndAccount();
      const scopeKey = playerActionScope({
        action,
        signer: account.address,
        playerIdentity: {
          rootId: state.player.rootId,
          makerVersion: state.player.makerVersion,
          rootContentCommitment: state.player.evidence.contentCommitment,
        },
        recipeCommitment: state.loadout.recipeCommitment,
        input: checkedInput,
      });
      let actionId;
      try { actionId = await persistence.resolveActive(scopeKey); } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_ACTIVE_LOOKUP_FAILED', 'Durable Player action scope could not be resolved.', 'PERSISTENCE', true);
      }
      if (actionId === null) {
        fail('MAKER_V8_PLAYER_ACTIVE_ACTION_NOT_FOUND', 'No durable Player action exists for this exact scope.', 'RECOVERY');
      }
      exactHash(actionId, 'activeActionId');
      const record = await readRecord(actionId);
      if (record.scopeKey !== scopeKey) {
        fail('MAKER_V8_PLAYER_ACTIVE_SCOPE_DRIFT', 'Active Player lookup returned another scope.', 'PERSISTENCE');
      }
      return controller.recoverPlayerAction(actionId, { replayIfNotFound: false });
    },

    async reclaimPlayerSignatureIntent(actionId) {
      requireWrite();
      const record = await readRecord(actionId);
      if (!['SIGNING', 'SIGNING_UNKNOWN'].includes(record.status)
        || record.signatureIntent === null) {
        fail('MAKER_V8_PLAYER_SIGNATURE_INTENT_NOT_RECLAIMABLE', 'Player action has no uncertain signature intent.', 'SIGNING');
      }
      let reclaimed;
      try {
        reclaimed = await persistence.reclaimSignatureIntent({
          actionId: record.actionId,
          revision: record.revision,
          signatureIntent: clone(record.signatureIntent),
          checkedAt: clock(),
        });
      } catch (cause) {
        throw asPlayerError(cause, 'MAKER_V8_PLAYER_SIGNATURE_RECLAIM_FAILED', 'Signature intent could not be safely reclaimed.', 'SIGNING');
      }
      assertActionRecord(reclaimed, runtime);
      if (reclaimed.actionId !== record.actionId || reclaimed.scopeKey !== record.scopeKey
        || reclaimed.status !== 'PREPARED' || reclaimed.signatureIntent !== null
        || reclaimed.signature !== null || reclaimed.revision !== record.revision + 1) {
        fail('MAKER_V8_PLAYER_SIGNATURE_RECLAIM_DRIFT', 'Reclaimed Player action differs from the exact durable intent.', 'PERSISTENCE');
      }
      return actionView(reclaimed, 'SIGNATURE_INTENT_RECLAIMED');
    },

    async getPendingPlayerAction(input = {}) {
      if (!writeEnabled) return null;
      exactRecord(input, Object.hasOwn(input, 'rootId') ? ['rootId'] : [], 'pendingPlayer.input');
      requireMethod(persistence, 'resolveRootActive', 'persistence');
      const explicitRoot = Object.hasOwn(input, 'rootId');
      const rootId = exactId(explicitRoot ? input.rootId : state.player?.rootId, 'pendingPlayer.rootId');
      const account = await exactChainAndAccount();
      const actionId = await persistence.resolveRootActive({ rootId, signer: account.address });
      if (actionId === null) return null;
      exactHash(actionId, 'activeActionId');
      const record = await readRecord(actionId);
      const confirmed = await exactChainAndAccount();
      if ((!explicitRoot && state.player?.rootId !== rootId) || confirmed.address !== account.address
        || record.playerIdentity.rootId !== rootId || record.plan.signer !== account.address) {
        fail('MAKER_V8_PLAYER_ACTIVE_SCOPE_DRIFT', 'Pending Player action does not belong to the current wallet and Root.', 'PERSISTENCE');
      }
      // Discovery is read-only: do not require the Pack to remain purchasable,
      // query finality, sign, or replay while restoring the recovery UI.
      return actionView(record);
    },

    async getPlayerAction(actionId) {
      if (!writeEnabled) {
        fail('MAKER_V8_PLAYER_WRITES_DISABLED', state.execution.disabledReason, 'GATE');
      }
      const record = await readRecord(actionId);
      if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(record.status)) {
        return controller.recoverPlayerAction(actionId, { replayIfNotFound: false });
      }
      return actionView(record);
    },
  };
  return freeze(controller);
}
