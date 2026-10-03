import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58, fromBase64, normalizeStructTag, toBase64,
} from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8ChainTypes,
  makerV8AttestedReplacement,
} from './maker-v8-chain.js';
import {
  MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
  createMakerV8PackPublicationControllerV8,
  createMakerV8PackPublicationPersistenceV8,
} from './maker-v8-pack-publication.js';
import {
  createMakerV8PackPublicationBoundaryV8,
} from './maker-v8-pack-publication-adapters.js';
import { assertFinalizedMakerV8CompilerTransactionV8 } from './maker-v8-browser.js';
import { assertMakerV8Runtime, makerV8StableType } from './maker-v8-runtime.js';
import { assertMakerV8SuiGrpcTransport } from './maker-v8-sui-grpc.js';

export const MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA =
  'animacraft.maker-v8-composable-controller.v1';
export const MAKER_V8_COMPOSABLE_REQUEST_SCHEMA =
  'animacraft.maker-v8-composable-request.v1';
export const MAKER_V8_COMPOSABLE_READBACK_SCHEMA =
  'animacraft.maker-v8-composable-readback.v1';
export const MAKER_V8_COMPOSABLE_DATABASE =
  'animacraft-maker-v8-composable-v1';

export const MAKER_V8_COMPOSABLE_ACTIONS = Object.freeze({
  CREATE_PRODUCT: 'CREATE_PRODUCT',
  ADMIT_OPEN: 'ADMIT_OPEN',
  ADMIT_CERTIFIED: 'ADMIT_CERTIFIED',
  REVOKE_ADMISSION: 'REVOKE_ADMISSION',
  PAUSE_PRODUCT: 'PAUSE_PRODUCT',
  RESUME_PRODUCT: 'RESUME_PRODUCT',
  ARCHIVE_PRODUCT: 'ARCHIVE_PRODUCT',
  TRANSFER_CONTROL: 'TRANSFER_CONTROL',
  MINT_ITEM: 'MINT_ITEM',
});

const ACTIONS = Object.freeze({
  CREATE_PRODUCT: Object.freeze({ functions: ['new_external_item_product_v8', 'share_external_item_product_v8', 'transfer_external_item_admin_cap_v8'] }),
  ADMIT_OPEN: Object.freeze({ functions: ['admit_open_external_product_v8'] }),
  ADMIT_CERTIFIED: Object.freeze({ functions: ['certify_external_item_product_v8', 'admit_certified_external_product_v8'] }),
  REVOKE_ADMISSION: Object.freeze({ functions: ['revoke_external_product_v8'] }),
  PAUSE_PRODUCT: Object.freeze({ functions: ['pause_external_product_v8'], from: 0, to: 1 }),
  RESUME_PRODUCT: Object.freeze({ functions: ['resume_external_product_v8'], from: 1, to: 0 }),
  ARCHIVE_PRODUCT: Object.freeze({ functions: ['archive_external_product_v8'], from: [0, 1], to: 2 }),
  TRANSFER_CONTROL: Object.freeze({ functions: ['transfer_external_item_control_v8'] }),
  MINT_ITEM: Object.freeze({ functions: ['mint_owned_external_item_v8', 'transfer_new_owned_item_to_holder_v8'] }),
});

const INPUT_NAMES = Object.freeze([
  'root', 'definitionRegistry', 'baseRegistry', 'packRegistry',
  'admissionAuthority', 'makerAdmin', 'catalog', 'runtimeConfig',
  'protocolConfig', 'replacement',
  'product', 'adminCap',
]);
const PRODUCT_FIELDS = Object.freeze([
  'rootId', 'productId', 'adminCapId', 'sourceLifecycle',
  'controlEpoch', 'packRegistryRevision',
]);
const PAYLOAD_FIELDS = Object.freeze([
  'partKey', 'itemKey', 'styleKey', 'layerTrackKey',
  'colorChannelKey', 'defaultSwatchKey', 'assetBlobId', 'assetSha256',
  'assetMediaType', 'assetByteLength', 'assetContentCommitment',
  'transferable', 'recipient',
]);
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const SAFE_MEDIA = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,127}$/;
const encoder = new TextEncoder();
const TRANSACTION_PROOFS = new WeakMap();
const SIGNED_PROOFS = new WeakMap();

const REGISTRY_EVENT_BCS = bcs.struct('PackRegistryRevisionAdvancedV8', {
  root_id: bcs.Address,
  previous_revision: bcs.u64(),
  revision: bcs.u64(),
  subject_id: bcs.Address,
  operation: bcs.u8(),
});

export class MakerV8ComposableError extends Error {
  constructor(code, message, layer = 'COMPOSABLE', details = undefined) {
    super(message);
    this.name = 'MakerV8ComposableError';
    this.code = code;
    this.layer = layer;
    if (details !== undefined) this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, layer = 'COMPOSABLE', details) {
  throw new MakerV8ComposableError(code, message, layer, details);
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_COMPOSABLE_SHAPE_INVALID', `${label} must be a plain record.`, 'SCHEMA');
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_COMPOSABLE_FIELDS_INVALID', `${label} has fields outside its exact schema.`, 'SCHEMA', { actual, expected });
  }
  return value;
}

function canonicalValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!plain(value)) fail('MAKER_V8_COMPOSABLE_DURABLE_INVALID', 'Composable evidence is not deterministic JSON.', 'SCHEMA');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

function clone(value, label = 'Composable value') {
  let result;
  try {
    result = structuredClone(value);
    if (canonical(result) !== canonical(value)) throw new Error('roundtrip');
  } catch {
    fail('MAKER_V8_COMPOSABLE_DURABLE_INVALID', `${label} must be deterministic structured-cloneable data.`, 'SCHEMA');
  }
  return result;
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  return hashBytes(encoder.encode(canonical(value)));
}

function composableAttemptId({ requestId, action, signer }) {
  if (typeof requestId !== 'string' || !SAFE_KEY.test(requestId) || !Object.hasOwn(ACTIONS, action)) {
    fail('MAKER_V8_COMPOSABLE_INPUT_INVALID', 'Invalid durable Composable request identity.', 'INPUT');
  }
  return `composable-${hashValue({ requestId, action, signer: address(signer, 'signer') })}`;
}

async function loadComposableAttempt(persistence, wallet, { requestId, action }) {
  const signer = walletAddress(await wallet.getCurrentAccount());
  const plan = await persistence.load(composableAttemptId({ requestId, action, signer }));
  if (!plan) return null;
  if (plan.immutable.signer !== signer || plan.immutable.request.requestId !== requestId
    || plan.immutable.request.action !== action || walletAddress(await wallet.getCurrentAccount()) !== signer) {
    fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Durable Composable request identity differs.', 'RECOVERY');
  }
  const digest = plan.current?.outcome?.digest ?? plan.terminal?.digest;
  return freeze({ status: plan.status, request: clone(plan.immutable.request),
    readback: plan.status === 'COMPLETE' ? clone(plan.terminal.chain) : null,
    ticket: typeof digest === 'string' ? { schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA,
      recoveryId: plan.attemptId, digest } : null });
}

async function listComposableAttempts(persistence, wallet) {
  const signer = walletAddress(await wallet.getCurrentAccount());
  const plans = await persistence.listPlans(signer);
  const rows = [];
  for (const plan of plans) {
    const request = assertRequest(plan.immutable.request);
    const saved = await loadComposableAttempt(persistence, wallet, request);
    if (!saved || request.signer !== signer) fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Saved operation changed during listing.', 'RECOVERY');
    rows.push(saved);
  }
  if (walletAddress(await wallet.getCurrentAccount()) !== signer) fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Wallet changed during operation listing.', 'RECOVERY');
  return freeze({ address: signer, rows });
}

function address(value, label) {
  const result = String(value ?? '').toLowerCase();
  if (!EXACT_ID.test(result) || /^0x0+$/.test(result)) {
    fail('MAKER_V8_COMPOSABLE_ID_INVALID', `${label} must be one canonical non-zero Sui ID.`, 'INPUT');
  }
  return result;
}

function nullableAddress(value, label) {
  return value === null ? null : address(value, label);
}

function decimal(value, label, { positive = false } = {}) {
  const result = String(value ?? '');
  if (!UINT.test(result) || BigInt(result) > (1n << 64n) - 1n || positive && result === '0') {
    fail('MAKER_V8_COMPOSABLE_INTEGER_INVALID', `${label} must be one canonical ${positive ? 'positive ' : ''}u64.`, 'INPUT');
  }
  return result;
}

function nullableDecimal(value, label) {
  return value === null ? null : decimal(value, label);
}

function digest(value, label) {
  try {
    if (typeof value !== 'string' || fromBase58(value).length !== 32) throw new Error('digest');
  } catch {
    fail('MAKER_V8_COMPOSABLE_DIGEST_INVALID', `${label} must be one canonical Sui digest.`, 'INPUT');
  }
  return value;
}

function key(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !SAFE_KEY.test(value)) {
    fail('MAKER_V8_COMPOSABLE_KEY_INVALID', `${label} must be one bounded semantic key.`, 'INPUT');
  }
  return value;
}

function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail('MAKER_V8_COMPOSABLE_HASH_INVALID', `${label} must be one lowercase SHA-256.`, 'INPUT');
  }
  return value;
}

function bytesFromHex(value, label) {
  hash(value, label);
  return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

function suiType(value, label) {
  if (typeof value !== 'string' || !value.includes('::')) {
    fail('MAKER_V8_COMPOSABLE_TYPE_INVALID', `${label} must be one exact Move type.`, 'INPUT');
  }
  try { return normalizeStructTag(value); } catch {
    fail('MAKER_V8_COMPOSABLE_TYPE_INVALID', `${label} must be one exact Move type.`, 'INPUT');
  }
}

function owner(value, label) {
  if (value?.kind === 'IMMUTABLE') { exact(value, ['kind'], label); return freeze({ kind: 'IMMUTABLE' }); }
  exact(value, value?.kind === 'SHARED'
    ? ['kind', 'initialSharedVersion'] : ['kind', 'address'], label);
  if (value.kind === 'SHARED') {
    return freeze({ kind: 'SHARED', initialSharedVersion: decimal(value.initialSharedVersion, `${label}.initialSharedVersion`, { positive: true }) });
  }
  if (value.kind === 'ADDRESS') {
    return freeze({ kind: 'ADDRESS', address: address(value.address, `${label}.address`) });
  }
  fail('MAKER_V8_COMPOSABLE_OWNER_INVALID', `${label} has an unsupported owner.`, 'INPUT');
}

function objectInput(value, label) {
  if (value === null) return null;
  exact(value, ['objectRef', 'owner', 'type', 'fields'], label);
  exact(value.objectRef, ['objectId', 'version', 'digest'], `${label}.objectRef`);
  return freeze({
    objectRef: freeze({
      objectId: address(value.objectRef.objectId, `${label}.objectId`),
      version: decimal(value.objectRef.version, `${label}.version`, { positive: true }),
      digest: digest(value.objectRef.digest, `${label}.digest`),
    }),
    owner: owner(value.owner, `${label}.owner`),
    type: suiType(value.type, `${label}.type`),
    fields: freeze(clone(value.fields, `${label}.fields`)),
  });
}

function field(fields, name, label) {
  if (!plain(fields)) fail('MAKER_V8_COMPOSABLE_FIELD_INVALID', `${label} has no Move fields.`, 'READBACK');
  if (Object.hasOwn(fields, name)) return fields[name];
  const camel = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  if (Object.hasOwn(fields, camel)) return fields[camel];
  fail('MAKER_V8_COMPOSABLE_FIELD_MISSING', `${label}.${name} is missing.`, 'READBACK');
}

function moveId(value, label) {
  if (typeof value === 'string') return address(value, label);
  if (plain(value?.fields)) return moveId(value.fields, label);
  if (plain(value) && Object.hasOwn(value, 'id')) return moveId(value.id, label);
  fail('MAKER_V8_COMPOSABLE_ID_INVALID', `${label} is not one Move ID.`, 'READBACK');
}

function moveText(value, label) {
  if (typeof value === 'string') return value;
  const bytes = value?.fields?.bytes ?? value?.bytes;
  if (typeof bytes === 'string') return bytes;
  fail('MAKER_V8_COMPOSABLE_TEXT_INVALID', `${label} is not one Move String.`, 'READBACK');
}

function moveOptionText(value, label) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return moveText(value[0], label);
  }
  const vec = value?.vec ?? value?.fields?.vec;
  if (Array.isArray(vec)) return moveOptionText(vec, label);
  return moveText(value, label);
}

function hexVector(value, label) {
  const vector = Array.isArray(value) ? value : value?.fields?.contents ?? value?.contents;
  if (!Array.isArray(vector) || vector.length !== 32
    || vector.some((entry) => !Number.isInteger(Number(entry)) || Number(entry) < 0 || Number(entry) > 255)) {
    fail('MAKER_V8_COMPOSABLE_HASH_INVALID', `${label} is not one Move vector<u8>[32].`, 'READBACK');
  }
  return vector.map((entry) => Number(entry).toString(16).padStart(2, '0')).join('');
}

function assertPayload(value, action) {
  exact(value, PAYLOAD_FIELDS, 'request.payload');
  const creation = action === MAKER_V8_COMPOSABLE_ACTIONS.CREATE_PRODUCT;
  const recipientAction = [
    MAKER_V8_COMPOSABLE_ACTIONS.TRANSFER_CONTROL,
    MAKER_V8_COMPOSABLE_ACTIONS.MINT_ITEM,
  ].includes(action);
  const result = {
    partKey: creation ? key(value.partKey, 'payload.partKey') : null,
    itemKey: creation ? key(value.itemKey, 'payload.itemKey') : null,
    styleKey: creation ? key(value.styleKey, 'payload.styleKey') : null,
    layerTrackKey: creation ? key(value.layerTrackKey, 'payload.layerTrackKey') : null,
    colorChannelKey: creation ? key(value.colorChannelKey, 'payload.colorChannelKey', { nullable: true }) : null,
    defaultSwatchKey: creation ? key(value.defaultSwatchKey, 'payload.defaultSwatchKey', { nullable: true }) : null,
    assetBlobId: creation ? key(value.assetBlobId, 'payload.assetBlobId') : null,
    assetSha256: creation ? hash(value.assetSha256, 'payload.assetSha256') : null,
    assetMediaType: creation ? String(value.assetMediaType ?? '').toLowerCase() : null,
    assetByteLength: creation ? decimal(value.assetByteLength, 'payload.assetByteLength', { positive: true }) : null,
    assetContentCommitment: creation ? hash(value.assetContentCommitment, 'payload.assetContentCommitment') : null,
    transferable: creation ? value.transferable : null,
    recipient: recipientAction ? address(value.recipient, 'payload.recipient') : null,
  };
  if (creation && (!SAFE_MEDIA.test(result.assetMediaType) || typeof result.transferable !== 'boolean'
    || (result.colorChannelKey === null) !== (result.defaultSwatchKey === null))) {
    fail('MAKER_V8_COMPOSABLE_PRODUCT_INVALID', 'External Item product metadata is invalid.', 'INPUT');
  }
  for (const name of PAYLOAD_FIELDS) {
    if (!creation && name !== 'recipient' && value[name] !== null
      || !recipientAction && name === 'recipient' && value[name] !== null) {
      fail('MAKER_V8_COMPOSABLE_UNUSED_INPUT', `payload.${name} must be null for ${action}.`, 'INPUT');
    }
  }
  return freeze(result);
}

function requiredInputs(action) {
  if (action === 'CREATE_PRODUCT') return ['root', 'definitionRegistry', 'baseRegistry'];
  if (['ADMIT_OPEN', 'REVOKE_ADMISSION'].includes(action)) {
    return ['packRegistry', 'admissionAuthority', 'definitionRegistry', 'root', 'makerAdmin', ...(action === 'ADMIT_OPEN' ? ['product'] : [])];
  }
  if (action === 'ADMIT_CERTIFIED') {
    return ['packRegistry', 'admissionAuthority', 'definitionRegistry', 'root', 'makerAdmin', 'catalog', 'runtimeConfig', 'product', 'protocolConfig', 'replacement'];
  }
  return ['product', 'adminCap'];
}

function assertRequest(value) {
  exact(value, [
    'schemaVersion', 'action', 'requestId', 'draftId', 'draftRevision',
    'documentSha256', 'signer', 'chainIdentifier', 'publicationInput',
    'inputs', 'product', 'payload',
  ], 'Composable request');
  if (value.schemaVersion !== MAKER_V8_COMPOSABLE_REQUEST_SCHEMA || !Object.hasOwn(ACTIONS, value.action)
    || value.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || typeof value.requestId !== 'string' || !SAFE_KEY.test(value.requestId)
    || value.draftId !== value.requestId
    || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1) {
    fail('MAKER_V8_COMPOSABLE_REQUEST_INVALID', 'Composable request identity is invalid.', 'INPUT');
  }
  exact(value.publicationInput, ['chainIdentifier'], 'request.publicationInput');
  if (value.publicationInput.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
    fail('MAKER_V8_COMPOSABLE_REQUEST_INVALID', 'Composable publication input must pin Sui Mainnet.', 'INPUT');
  }
  exact(value.inputs, INPUT_NAMES, 'request.inputs');
  const inputs = Object.fromEntries(INPUT_NAMES.map((name) => [name, objectInput(value.inputs[name], `inputs.${name}`)]));
  const required = new Set(requiredInputs(value.action));
  for (const name of INPUT_NAMES) {
    if (required.has(name) !== (inputs[name] !== null)) {
      fail('MAKER_V8_COMPOSABLE_INPUT_SET_INVALID', `inputs.${name} has the wrong presence for ${value.action}.`, 'INPUT');
    }
  }
  exact(value.product, PRODUCT_FIELDS, 'request.product');
  const productNeeded = value.action !== 'CREATE_PRODUCT';
  const product = freeze({
    rootId: address(value.product.rootId, 'product.rootId'),
    productId: productNeeded ? address(value.product.productId, 'product.productId') : null,
    adminCapId: ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL', 'MINT_ITEM'].includes(value.action)
      ? address(value.product.adminCapId, 'product.adminCapId') : null,
    sourceLifecycle: ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL', 'MINT_ITEM'].includes(value.action)
      ? Number(decimal(value.product.sourceLifecycle, 'product.sourceLifecycle')) : null,
    controlEpoch: ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL', 'MINT_ITEM'].includes(value.action)
      ? decimal(value.product.controlEpoch, 'product.controlEpoch') : null,
    packRegistryRevision: ['ADMIT_OPEN', 'ADMIT_CERTIFIED', 'REVOKE_ADMISSION'].includes(value.action)
      ? decimal(value.product.packRegistryRevision, 'product.packRegistryRevision') : null,
  });
  for (const name of PRODUCT_FIELDS) {
    const expected = product[name];
    if ((expected === null) !== (value.product[name] === null)) {
      fail('MAKER_V8_COMPOSABLE_PRODUCT_INVALID', `product.${name} has the wrong presence for ${value.action}.`, 'INPUT');
    }
  }
  const signer = address(value.signer, 'request.signer');
  if (inputs.adminCap !== null && (inputs.adminCap.owner.kind !== 'ADDRESS' || inputs.adminCap.owner.address !== signer)
    || inputs.makerAdmin !== null && (inputs.makerAdmin.owner.kind !== 'ADDRESS' || inputs.makerAdmin.owner.address !== signer)) {
    fail('MAKER_V8_COMPOSABLE_AUTHORITY_INVALID', 'The exact required capability is not owned by the signer.', 'AUTHORITY');
  }
  const lifecycleRule = ACTIONS[value.action];
  if (lifecycleRule.from !== undefined) {
    const allowed = Array.isArray(lifecycleRule.from) ? lifecycleRule.from : [lifecycleRule.from];
    if (!allowed.includes(product.sourceLifecycle)) {
      fail('MAKER_V8_COMPOSABLE_LIFECYCLE_INVALID', `${value.action} is invalid from this product state.`, 'STATE');
    }
  }
  const payload = assertPayload(value.payload, value.action);
  if (value.action === 'TRANSFER_CONTROL' && payload.recipient === signer) {
    fail('MAKER_V8_COMPOSABLE_RECIPIENT_INVALID', 'Control transfer must change the owner.', 'INPUT');
  }
  const result = {
    schemaVersion: MAKER_V8_COMPOSABLE_REQUEST_SCHEMA,
    action: value.action,
    requestId: value.requestId,
    draftId: value.draftId,
    draftRevision: value.draftRevision,
    documentSha256: value.documentSha256,
    signer,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    publicationInput: freeze({ chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER }),
    inputs: freeze(inputs),
    product,
    payload,
  };
  const identity = { ...result };
  delete identity.documentSha256;
  if (typeof value.documentSha256 !== 'string' || value.documentSha256 !== hashValue(identity)) {
    fail('MAKER_V8_COMPOSABLE_REQUEST_HASH_INVALID', 'Composable request identity hash is invalid.', 'INPUT');
  }
  return freeze(result);
}

export function buildMakerV8ComposableRequestV8(input) {
  const candidate = clone(input);
  candidate.draftId ??= candidate.requestId;
  candidate.draftRevision ??= 1;
  candidate.publicationInput ??= { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER };
  if (candidate.documentSha256 === undefined) {
    const identity = { ...candidate };
    delete identity.documentSha256;
    candidate.documentSha256 = hashValue(identity);
  }
  return assertRequest(candidate);
}

function transactionObject(transaction, input, mutable = false) {
  if (input.owner.kind === 'SHARED') {
    return transaction.sharedObjectRef({
      objectId: input.objectRef.objectId,
      initialSharedVersion: input.owner.initialSharedVersion,
      mutable,
    });
  }
  return transaction.objectRef(input.objectRef);
}

function pureHash(transaction, value) {
  return transaction.pure.vector('u8', [...bytesFromHex(value, 'Move hash')]);
}

function call(transaction, targets, runtime, role, moduleName, functionName, argumentsList, typeArguments = []) {
  const target = `${runtime.roles[role].callablePackageId}::${moduleName}::${functionName}`;
  targets.push(target);
  return transaction.moveCall({ target, typeArguments, arguments: argumentsList });
}

function assertCertifiedAuthorityInputs(runtime, inputs) {
  const replacement = makerV8AttestedReplacement(runtime);
  const types = makerV8ChainTypes(runtime);
  if (inputs.protocolConfig.owner.kind !== 'SHARED'
    || inputs.protocolConfig.objectRef.objectId !== runtime.protocolConfigId
    || normalizeStructTag(inputs.protocolConfig.type) !== normalizeStructTag(types.protocolConfig)
    || inputs.catalog.objectRef.objectId !== runtime.catalogId
    || inputs.runtimeConfig.objectRef.objectId !== runtime.roleConfigIds.runtime
    || inputs.replacement.owner.kind !== 'IMMUTABLE'
    || inputs.replacement.objectRef.objectId !== replacement.objectId
    || inputs.replacement.objectRef.version !== String(replacement.version)
    || inputs.replacement.objectRef.digest !== replacement.digest
    || normalizeStructTag(inputs.replacement.type) !== normalizeStructTag(
      makerV8StableType(runtime, 'core', 'package_binding_v8', 'FreshTupleReplacementBindingV2'))
    || moveId(field(inputs.replacement.fields, 'catalog_id', 'Replacement'), 'replacement.catalogId') !== runtime.catalogId) {
    fail('MAKER_V8_COMPOSABLE_CERTIFICATION_AUTHORITY_DRIFT', 'Certified admission requires the exact current protocol and immutable release binding.', 'AUTHORITY');
  }
}

export async function buildMakerV8ComposableTransactionV8(runtimeInput, requestInput) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const request = assertRequest(requestInput);
  const transaction = new Transaction();
  const targets = [];
  const coin = [runtime.paymentCoinType];
  transaction.setSender(request.signer);
  const i = request.inputs;
  const p = request.payload;
  if (request.action === 'CREATE_PRODUCT') {
    const result = call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'new_external_item_product_v8', [
      transactionObject(transaction, i.root),
      transactionObject(transaction, i.definitionRegistry),
      transactionObject(transaction, i.baseRegistry),
      transaction.pure.string(p.partKey),
      transaction.pure.string(p.itemKey),
      transaction.pure.string(p.styleKey),
      transaction.pure.string(p.layerTrackKey),
      transaction.pure.option('string', p.colorChannelKey),
      transaction.pure.option('string', p.defaultSwatchKey),
      transaction.pure.string(p.assetBlobId),
      pureHash(transaction, p.assetSha256),
      transaction.pure.string(p.assetMediaType),
      transaction.pure.u64(p.assetByteLength),
      pureHash(transaction, p.assetContentCommitment),
      transaction.pure.bool(p.transferable),
    ], coin);
    const [product, adminCap] = result;
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'share_external_item_product_v8', [product]);
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'transfer_external_item_admin_cap_v8', [
      adminCap, transaction.pure.address(request.signer),
    ]);
  } else if (request.action === 'ADMIT_CERTIFIED') {
    assertCertifiedAuthorityInputs(runtime, i);
    const attestation = call(transaction, targets, runtime, 'runtime', 'runtime_binding_v8', 'certify_external_item_product_v8', [
      transactionObject(transaction, i.protocolConfig),
      transactionObject(transaction, i.catalog),
      transactionObject(transaction, i.replacement),
      transactionObject(transaction, i.runtimeConfig),
      transactionObject(transaction, i.product),
    ]);
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'admit_certified_external_product_v8', [
      transactionObject(transaction, i.packRegistry, true),
      transactionObject(transaction, i.admissionAuthority),
      transactionObject(transaction, i.definitionRegistry),
      transactionObject(transaction, i.root),
      transactionObject(transaction, i.makerAdmin),
      transactionObject(transaction, i.product),
      attestation,
      transaction.pure.u64(request.product.packRegistryRevision),
    ], coin);
  } else if (request.action === 'ADMIT_OPEN') {
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'admit_open_external_product_v8', [
      transactionObject(transaction, i.packRegistry, true),
      transactionObject(transaction, i.admissionAuthority),
      transactionObject(transaction, i.definitionRegistry),
      transactionObject(transaction, i.root),
      transactionObject(transaction, i.makerAdmin),
      transactionObject(transaction, i.product),
      transaction.pure.u64(request.product.packRegistryRevision),
    ], coin);
  } else if (request.action === 'REVOKE_ADMISSION') {
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'revoke_external_product_v8', [
      transactionObject(transaction, i.packRegistry, true),
      transactionObject(transaction, i.admissionAuthority),
      transactionObject(transaction, i.definitionRegistry),
      transactionObject(transaction, i.root),
      transactionObject(transaction, i.makerAdmin),
      transaction.pure.address(request.product.productId),
      transaction.pure.u64(request.product.packRegistryRevision),
    ], coin);
  } else if (['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT'].includes(request.action)) {
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', ACTIONS[request.action].functions[0], [
      transactionObject(transaction, i.product, true),
      transactionObject(transaction, i.adminCap),
    ]);
  } else if (request.action === 'TRANSFER_CONTROL') {
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'transfer_external_item_control_v8', [
      transactionObject(transaction, i.product, true),
      transactionObject(transaction, i.adminCap),
      transaction.pure.address(p.recipient),
    ]);
  } else if (request.action === 'MINT_ITEM') {
    const item = call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'mint_owned_external_item_v8', [
      transactionObject(transaction, i.product, true),
      transactionObject(transaction, i.adminCap),
      transaction.pure.address(p.recipient),
    ]);
    call(transaction, targets, runtime, 'runtime', 'runtime_v8', 'transfer_new_owned_item_to_holder_v8', [item]);
  }
  const kind = await transaction.build({ onlyTransactionKind: true });
  return freeze({
    transaction,
    targets: freeze(targets),
    kindBytes: toBase64(kind),
    kindSha256: hashBytes(kind),
  });
}

function transactionData(value, expected) {
  let bytes; let parsed; let roundtrip;
  try {
    bytes = fromBase64(value);
    parsed = bcs.TransactionData.parse(bytes);
    roundtrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_COMPOSABLE_TRANSACTION_INVALID', 'Durable Composable TransactionData is not canonical BCS.', 'EXACT_BYTES');
  }
  const kind = parsed?.$kind === 'V1' ? bcs.TransactionKind.serialize(parsed.V1.kind).toBytes() : null;
  const observedDigest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (!(kind instanceof Uint8Array) || toBase64(bytes) !== value
    || roundtrip.length !== bytes.length || roundtrip.some((byte, index) => byte !== bytes[index])
    || parsed.V1.sender !== expected.signer || parsed.V1.gasData?.owner !== expected.signer
    || toBase64(kind) !== expected.kindBytes
    || expected.digest !== undefined && observedDigest !== expected.digest) {
    fail('MAKER_V8_COMPOSABLE_TRANSACTION_DRIFT', 'Durable Composable TransactionData differs from its compiler proof.', 'EXACT_BYTES');
  }
  return freeze({ digest: observedDigest, kindBytes: toBase64(kind) });
}

export function assertMakerV8ComposableCompilerTransactionV8(authority, transaction, expected) {
  const proof = TRANSACTION_PROOFS.get(transaction);
  if (!proof || proof.authority !== authority || proof.signer !== expected.signer
    || proof.kindBytes !== expected.kindBytes || proof.kindSha256 !== expected.kindSha256) {
    fail('MAKER_V8_COMPOSABLE_COMPILER_PROOF_REQUIRED', 'Composable transaction lacks exact in-process compiler authority.', 'COMPILER');
  }
  return transaction;
}

export function assertMakerV8ComposableSignedArtifactV8(authority, artifact) {
  const proof = SIGNED_PROOFS.get(authority)?.get(artifact.digest);
  if (!proof || proof.signer !== artifact.signer || proof.bytes !== artifact.bytes
    || proof.signature !== artifact.signature) {
    fail('MAKER_V8_COMPOSABLE_SIGNED_PROOF_REQUIRED', 'Composable signed artifact lacks exact durable compiler authority.', 'COMPILER');
  }
  return proof;
}

export function createMakerV8ComposableCompilerV8({
  runtime: runtimeInput,
  loadFreshRequest,
  certifyFinalized,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  if (typeof loadFreshRequest !== 'function' || typeof certifyFinalized !== 'function') {
    fail('MAKER_V8_COMPOSABLE_DEPENDENCY_INVALID', 'Composable compiler requires fresh authority and final readback.', 'CONFIGURATION');
  }
  const authority = freeze({ schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA });
  const register = async (request) => {
    const built = await buildMakerV8ComposableTransactionV8(runtime, request);
    const proof = freeze({ authority, signer: request.signer, kindBytes: built.kindBytes, kindSha256: built.kindSha256 });
    TRANSACTION_PROOFS.set(built.transaction, proof);
    return freeze({
      authority,
      transaction: built.transaction,
      descriptor: freeze({
        schemaVersion: MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
        ordinal: 0,
        stage: 'FINALIZE',
        startStyle: 0,
        endStyle: 0,
        signer: request.signer,
        kindBytes: built.kindBytes,
        kindSha256: built.kindSha256,
        targets: built.targets,
        checkpoint: freeze({
          action: request.action,
          requestSha256: hashValue(request),
          productId: request.product.productId,
          rootId: request.product.rootId,
        }),
      }),
    });
  };
  return freeze({
    authority,
    async prepare(raw) {
      const request = assertRequest(raw);
      const built = await register(request);
      return freeze({
        ...built,
        attemptId: composableAttemptId(request),
      });
    },
    async rehydrate({ plan, requireFreshAuthority }) {
      const request = assertRequest(plan?.immutable?.request);
      if (requireFreshAuthority) {
        const fresh = assertRequest(await loadFreshRequest(request));
        if (canonical(fresh) !== canonical(request)) {
          fail('MAKER_V8_COMPOSABLE_AUTHORITY_DRIFT', 'Live Composable authority changed before signing or replay.', 'CONTEXT');
        }
      }
      const built = await register(request);
      if (plan.current?.fullTransaction !== null && plan.current?.fullTransaction !== undefined) {
        const artifact = transactionData(plan.current.fullTransaction, {
          signer: request.signer,
          kindBytes: built.descriptor.kindBytes,
          digest: plan.current.outcome.digest,
        });
        const proofs = SIGNED_PROOFS.get(authority) ?? new Map();
        proofs.set(artifact.digest, freeze({
          digest: artifact.digest,
          signer: request.signer,
          bytes: plan.current.fullTransaction,
          signature: plan.current.signature,
        }));
        while (proofs.size > 32) proofs.delete(proofs.keys().next().value);
        SIGNED_PROOFS.set(authority, proofs);
      }
      return built;
    },
    async certifyFinalized({ plan, query, attested, artifact }) {
      if (attested?.authority !== authority || query?.status !== 'FINALIZED_SUCCESS') {
        fail('MAKER_V8_COMPOSABLE_FINALITY_INVALID', 'Composable certification requires exact successful authority.', 'READBACK');
      }
      const request = assertRequest(plan.immutable.request);
      const chain = await certifyFinalized(freeze({
        request,
        query: freeze(clone(query)),
        artifact,
        transaction: attested.transaction,
        descriptor: attested.descriptor,
      }));
      return freeze({
        authority,
        complete: true,
        chain,
        checkpoint: freeze({
          ordinal: 0,
          stage: 'FINALIZE',
          digest: artifact.digest,
          kindSha256: attested.descriptor.kindSha256,
          action: request.action,
          productId: chain.productId,
        }),
      });
    },
    async prepareSuccessor() {
      fail('MAKER_V8_COMPOSABLE_SUCCESSOR_INVALID', 'Composable actions are one-shot transactions.', 'COMPILER');
    },
  });
}

export function createMakerV8ComposableControllerV8({
  runtime: runtimeInput,
  loadRequest,
  persistence,
  boundary,
  wallet,
  rpc,
  certifyFinalized,
  execution,
  now,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  if (typeof loadRequest !== 'function') {
    fail('MAKER_V8_COMPOSABLE_AUTHORITY_LOADER_REQUIRED', 'Composable controller requires one fresh authority loader.', 'CONFIGURATION');
  }
  const compiler = createMakerV8ComposableCompilerV8({ runtime, loadFreshRequest: loadRequest, certifyFinalized });
  const engine = createMakerV8PackPublicationControllerV8({
    persistence, compiler, boundary, wallet, rpc, oneShot: true, execution,
    ...(now === undefined ? {} : { now }),
  });
  const gates = freeze({
    allowWalletSignature: execution?.allowWalletSignature === true,
    allowBroadcast: execution?.allowBroadcast === true,
  });
  return freeze({
    schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA,
    execution: gates,
    load: input => loadComposableAttempt(persistence, wallet, input),
    list: () => listComposableAttempts(persistence, wallet),
    async stage(input) {
      const request = assertRequest(input);
      if (request.signer !== walletAddress(await wallet.getCurrentAccount())) fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Wallet differs from reviewed request.', 'CONTEXT');
      await engine.prepare(request);
      return loadComposableAttempt(persistence, wallet, request);
    },
    build: (input) => loadRequest(input),
    async prepare(builtInput) {
      const request = assertRequest(await builtInput);
      let plan = await engine.prepare(request);
      if (plan.status === 'ACTIVE' && plan.current?.outcome.status === 'READY') {
        plan = await engine.requestSignature(plan.attemptId);
      }
      const observedDigest = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (typeof observedDigest !== 'string') {
        fail('MAKER_V8_COMPOSABLE_SIGNATURE_REQUIRED', 'Composable preparation did not durably persist one signed digest.', 'RECOVERY');
      }
      return freeze({ schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA, recoveryId: plan.attemptId, digest: observedDigest });
    },
    async recover(ticket) {
      exact(ticket, ['schemaVersion', 'recoveryId', 'digest'], 'Composable recovery ticket');
      if (ticket.schemaVersion !== MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA) {
        fail('MAKER_V8_COMPOSABLE_TICKET_INVALID', 'Composable ticket has another schema.', 'RECOVERY');
      }
      digest(ticket.digest, 'ticket.digest');
      let plan = await engine.recoverOutcome(ticket.recoveryId);
      const observedDigest = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (observedDigest !== ticket.digest) {
        fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Composable durable attempt has another digest.', 'RECOVERY');
      }
      if (plan.status === 'ACTIVE' && plan.current?.outcome.status === 'OUTCOME_PENDING'
        && plan.current.outcome.code === 'TYPED_GRPC_NOT_FOUND') {
        plan = await engine.replayExact(ticket.recoveryId);
      }
      return freeze({
        schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA,
        status: plan.status === 'COMPLETE' ? 'FINALIZED_SUCCESS'
          : plan.status === 'FAILED' ? 'FINALIZED_FAILURE' : 'OUTCOME_UNKNOWN',
        recoveryId: ticket.recoveryId,
        digest: ticket.digest,
        readback: plan.status === 'COMPLETE' ? freeze(clone(plan.terminal.chain)) : null,
      });
    },
  });
}

export function createMakerV8ComposablePersistenceV8(indexedDB, options = {}) {
  return createMakerV8PackPublicationPersistenceV8(indexedDB, {
    databaseName: MAKER_V8_COMPOSABLE_DATABASE,
    ...options,
  });
}

function normalizedOwner(value, label) {
  if (value === 'Immutable' || plain(value) && value.Immutable === true && Object.keys(value).length === 1) {
    return freeze({ kind: 'IMMUTABLE' });
  }
  if (!plain(value)) fail('MAKER_V8_COMPOSABLE_OWNER_INVALID', `${label} owner is invalid.`, 'READBACK');
  const shared = value.Shared ?? value.shared;
  if (plain(shared)) {
    return freeze({
      kind: 'SHARED',
      initialSharedVersion: decimal(
        shared.initial_shared_version ?? shared.initialSharedVersion,
        `${label}.initialSharedVersion`,
        { positive: true },
      ),
    });
  }
  const owned = value.AddressOwner ?? value.addressOwner ?? value.address;
  if (typeof owned === 'string') return freeze({ kind: 'ADDRESS', address: address(owned, `${label}.address`) });
  fail('MAKER_V8_COMPOSABLE_OWNER_INVALID', `${label} has an unsupported owner.`, 'READBACK');
}

function currentObject(response, expectedType, expectedId, label) {
  const data = response?.data;
  if (!plain(data) || response?.error || !plain(data.content)
    || data.content.dataType !== 'moveObject'
    || address(data.objectId, `${label}.objectId`) !== expectedId
    || normalizeStructTag(data.type ?? data.content.type) !== normalizeStructTag(expectedType)
    || !plain(data.content.fields)) {
    fail('MAKER_V8_COMPOSABLE_OBJECT_INVALID', `${label} is missing or has another exact TypeOrigin.`, 'READBACK');
  }
  return freeze({
    objectRef: freeze({
      objectId: expectedId,
      version: decimal(data.version, `${label}.version`, { positive: true }),
      digest: digest(data.digest, `${label}.digest`),
    }),
    owner: normalizedOwner(data.owner, label),
    type: normalizeStructTag(expectedType),
    fields: freeze(clone(data.content.fields, `${label}.fields`)),
  });
}

function changedRef(response, expectedId, expectedType, label, changeTypes = ['created', 'mutated']) {
  const normalized = normalizeStructTag(expectedType);
  const matches = response.objectChanges.filter((entry) => (
    changeTypes.includes(entry.type)
    && entry.objectId === expectedId
    && normalizeStructTag(entry.objectType) === normalized
  ));
  if (matches.length !== 1) {
    fail('MAKER_V8_COMPOSABLE_EFFECT_INVALID', `${label} requires one exact object write.`, 'READBACK', { observed: matches.length });
  }
  const refs = response.compilerEffectsOutputRefs.filter((entry) => entry.objectId === expectedId);
  if (refs.length !== 1 || String(refs[0].version) !== String(matches[0].version)
    || refs[0].digest !== matches[0].digest) {
    fail('MAKER_V8_COMPOSABLE_EFFECT_DRIFT', `${label} raw effects and Core object change differ.`, 'READBACK');
  }
  return refs[0];
}

function createdRefByType(response, expectedType, label) {
  const matches = response.objectChanges.filter((entry) => (
    entry.type === 'created' && normalizeStructTag(entry.objectType) === normalizeStructTag(expectedType)
  ));
  if (matches.length !== 1) {
    fail('MAKER_V8_COMPOSABLE_EFFECT_INVALID', `${label} requires one exact created object.`, 'READBACK', { observed: matches.length });
  }
  return changedRef(response, matches[0].objectId, expectedType, label, ['created']);
}

async function historical(client, ref, expectedType, txDigest, label) {
  const value = await client.getHistoricalObject({ objectId: ref.objectId, version: BigInt(ref.version) });
  if (!plain(value) || value.objectId !== ref.objectId || String(value.version) !== String(ref.version)
    || value.digest !== ref.digest || value.previousTransaction !== txDigest
    || normalizeStructTag(value.type) !== normalizeStructTag(expectedType)
    || !plain(value.parsed) || !(value.contentBcs instanceof Uint8Array)
    || !(value.objectBcs instanceof Uint8Array)) {
    fail('MAKER_V8_COMPOSABLE_HISTORY_DRIFT', `${label} historical BCS/JSON/ref differs from finalized effects.`, 'READBACK');
  }
  return value;
}

function assertHistoricalSharedOwner(owner, expectedInitialVersion, label) {
  if (!plain(owner) || Object.keys(owner).length !== 1 || !plain(owner.Shared)) {
    fail('MAKER_V8_COMPOSABLE_CUSTODY_DRIFT', `${label} is not one exact shared object.`, 'READBACK');
  }
  const observed = decimal(
    owner.Shared.initial_shared_version ?? owner.Shared.initialSharedVersion,
    `${label}.initialSharedVersion`,
    { positive: true },
  );
  if (expectedInitialVersion !== null && observed !== String(expectedInitialVersion)) {
    fail('MAKER_V8_COMPOSABLE_CUSTODY_DRIFT', `${label} shared initial version drifted.`, 'READBACK');
  }
  return observed;
}

function assertHistoricalAddressOwner(owner, expectedAddress, label) {
  if (!plain(owner) || Object.keys(owner).length !== 1
    || address(owner.AddressOwner, `${label}.address`) !== expectedAddress) {
    fail('MAKER_V8_COMPOSABLE_CUSTODY_DRIFT', `${label} is not owned by the authorized address.`, 'READBACK');
  }
}

function replaceMoveField(fields, name, value) {
  const result = clone(fields, 'Move field replacement');
  if (Object.hasOwn(result, name)) result[name] = value;
  else {
    const camel = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!Object.hasOwn(result, camel)) fail('MAKER_V8_COMPOSABLE_FIELD_MISSING', `Move field ${name} is missing.`, 'READBACK');
    result[camel] = value;
  }
  return result;
}

function sameExcept(post, pre, replacements) {
  let normalized = post;
  for (const [name, value] of Object.entries(replacements)) normalized = replaceMoveField(normalized, name, value);
  return canonical(normalized) === canonical(pre);
}

function registryEvent(event, request, runtime, operation) {
  const expectedType = `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackRegistryRevisionAdvancedV8`;
  if (normalizeStructTag(event?.type) !== normalizeStructTag(expectedType)
    || event.sender !== request.signer || typeof event.bcs !== 'string' || !plain(event.parsedJson)) {
    fail('MAKER_V8_COMPOSABLE_EVENT_INVALID', 'Pack registry event identity is invalid.', 'READBACK');
  }
  let bytes; let decoded; let roundtrip;
  try {
    bytes = fromBase64(event.bcs);
    decoded = REGISTRY_EVENT_BCS.parse(bytes);
    roundtrip = REGISTRY_EVENT_BCS.serialize(decoded).toBytes();
  } catch {
    fail('MAKER_V8_COMPOSABLE_EVENT_INVALID', 'Pack registry event BCS is not canonical.', 'READBACK');
  }
  if (roundtrip.length !== bytes.length || roundtrip.some((byte, index) => byte !== bytes[index])) {
    fail('MAKER_V8_COMPOSABLE_EVENT_INVALID', 'Pack registry event BCS is not canonical.', 'READBACK');
  }
  const observed = freeze({
    rootId: address(decoded.root_id, 'event.rootId'),
    previousRevision: String(decoded.previous_revision),
    revision: String(decoded.revision),
    subjectId: address(decoded.subject_id, 'event.subjectId'),
    operation: Number(decoded.operation),
  });
  const displayed = freeze({
    rootId: moveId(field(event.parsedJson, 'root_id', 'event'), 'event.rootId'),
    previousRevision: decimal(field(event.parsedJson, 'previous_revision', 'event'), 'event.previousRevision'),
    revision: decimal(field(event.parsedJson, 'revision', 'event'), 'event.revision'),
    subjectId: moveId(field(event.parsedJson, 'subject_id', 'event'), 'event.subjectId'),
    operation: Number(decimal(field(event.parsedJson, 'operation', 'event'), 'event.operation')),
  });
  const expectedRevision = request.product.packRegistryRevision;
  if (canonical(observed) !== canonical(displayed)
    || observed.rootId !== request.product.rootId
    || observed.previousRevision !== expectedRevision
    || observed.revision !== (BigInt(expectedRevision) + 1n).toString()
    || observed.subjectId !== request.product.productId
    || observed.operation !== operation) {
    fail('MAKER_V8_COMPOSABLE_EVENT_DRIFT', 'Pack registry event differs from the authorized external product transition.', 'READBACK');
  }
  return observed;
}

function assertProductCreation(fields, capFields, request, productId, capId) {
  const p = request.payload;
  const definitions = request.inputs.definitionRegistry.fields;
  const expected = {
    version: '8',
    rootId: request.product.rootId,
    rootVersion: decimal(field(definitions, 'root_version', 'RuntimeDefinitionRegistry'), 'definitions.rootVersion'),
    rootContentCommitment: hexVector(field(definitions, 'root_content_commitment', 'RuntimeDefinitionRegistry'), 'definitions.rootContentCommitment'),
    creator: request.signer,
    owner: request.signer,
    controlEpoch: '0',
    adminCapId: capId,
    lifecycle: '0',
    partKey: p.partKey,
    itemKey: p.itemKey,
    styleKey: p.styleKey,
    layerTrackKey: p.layerTrackKey,
    colorChannelKey: p.colorChannelKey,
    defaultSwatchKey: p.defaultSwatchKey,
    assetBlobId: p.assetBlobId,
    assetSha256: p.assetSha256,
    assetMediaType: p.assetMediaType,
    assetByteLength: p.assetByteLength,
    assetContentCommitment: p.assetContentCommitment,
    transferable: p.transferable,
    supply: '0',
  };
  const observed = {
    version: decimal(field(fields, 'version', 'ExternalItemProduct'), 'product.version'),
    rootId: moveId(field(fields, 'root_id', 'ExternalItemProduct'), 'product.rootId'),
    rootVersion: decimal(field(fields, 'root_version', 'ExternalItemProduct'), 'product.rootVersion'),
    rootContentCommitment: hexVector(field(fields, 'root_content_commitment', 'ExternalItemProduct'), 'product.rootContentCommitment'),
    creator: address(field(fields, 'creator', 'ExternalItemProduct'), 'product.creator'),
    owner: address(field(fields, 'owner', 'ExternalItemProduct'), 'product.owner'),
    controlEpoch: decimal(field(fields, 'control_epoch', 'ExternalItemProduct'), 'product.controlEpoch'),
    adminCapId: moveId(field(fields, 'admin_cap_id', 'ExternalItemProduct'), 'product.adminCapId'),
    lifecycle: decimal(field(fields, 'lifecycle', 'ExternalItemProduct'), 'product.lifecycle'),
    partKey: moveText(field(fields, 'part_key', 'ExternalItemProduct'), 'product.partKey'),
    itemKey: moveText(field(fields, 'item_key', 'ExternalItemProduct'), 'product.itemKey'),
    styleKey: moveText(field(fields, 'style_key', 'ExternalItemProduct'), 'product.styleKey'),
    layerTrackKey: moveText(field(fields, 'layer_track_key', 'ExternalItemProduct'), 'product.layerTrackKey'),
    colorChannelKey: moveOptionText(field(fields, 'color_channel_key', 'ExternalItemProduct'), 'product.colorChannelKey'),
    defaultSwatchKey: moveOptionText(field(fields, 'default_swatch_key', 'ExternalItemProduct'), 'product.defaultSwatchKey'),
    assetBlobId: moveText(field(fields, 'asset_blob_id', 'ExternalItemProduct'), 'product.assetBlobId'),
    assetSha256: hexVector(field(fields, 'asset_sha256', 'ExternalItemProduct'), 'product.assetSha256'),
    assetMediaType: moveText(field(fields, 'asset_media_type', 'ExternalItemProduct'), 'product.assetMediaType'),
    assetByteLength: decimal(field(fields, 'asset_byte_length', 'ExternalItemProduct'), 'product.assetByteLength'),
    assetContentCommitment: hexVector(field(fields, 'asset_content_commitment', 'ExternalItemProduct'), 'product.assetContentCommitment'),
    transferable: field(fields, 'transferable', 'ExternalItemProduct'),
    supply: decimal(field(fields, 'supply', 'ExternalItemProduct'), 'product.supply'),
  };
  if (canonical(observed) !== canonical(expected)
    || decimal(field(capFields, 'version', 'ExternalItemAdminCap'), 'cap.version') !== '8'
    || moveId(field(capFields, 'product_id', 'ExternalItemAdminCap'), 'cap.productId') !== productId
    || address(field(capFields, 'owner', 'ExternalItemAdminCap'), 'cap.owner') !== request.signer
    || decimal(field(capFields, 'control_epoch', 'ExternalItemAdminCap'), 'cap.controlEpoch') !== '0') {
    fail('MAKER_V8_COMPOSABLE_CREATE_DRIFT', 'Created external product/cap differs from the exact author request.', 'READBACK');
  }
}

export function createMakerV8ComposableReadbackV8({
  client,
  runtime: runtimeInput,
  readFinalized = assertFinalizedMakerV8CompilerTransactionV8,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const types = makerV8ChainTypes(runtime);
  return async ({ request, artifact, transaction, descriptor }) => {
    const response = await readFinalized(client, artifact.digest, transaction);
    if (response.compilerTransactionKindProof.transactionKindSha256 !== descriptor.kindSha256) {
      fail('MAKER_V8_COMPOSABLE_KIND_DRIFT', 'Finalized Composable kind differs from exact compiler bytes.', 'READBACK');
    }
    let productId = request.product.productId;
    let productRef = request.inputs.product?.objectRef ?? null;
    let adminCapRef = request.inputs.adminCap?.objectRef ?? null;
    let itemRef = null;
    let packRegistryRevision = request.product.packRegistryRevision;
    let lifecycle = request.product.sourceLifecycle;
    let ownerAddress = request.inputs.product === null
      ? request.signer : address(field(request.inputs.product.fields, 'owner', 'ExternalItemProduct'), 'product.owner');
    let controlEpoch = request.product.controlEpoch;
    if (request.action === 'CREATE_PRODUCT') {
      const productRaw = createdRefByType(response, types.externalItemProduct, 'ExternalItemProduct');
      const capRaw = createdRefByType(response, types.externalItemAdminCap, 'ExternalItemAdminCap');
      const [product, cap] = await Promise.all([
        historical(client, productRaw, types.externalItemProduct, artifact.digest, 'ExternalItemProduct'),
        historical(client, capRaw, types.externalItemAdminCap, artifact.digest, 'ExternalItemAdminCap'),
      ]);
      assertHistoricalSharedOwner(product.owner, product.version, 'ExternalItemProduct.owner');
      assertHistoricalAddressOwner(cap.owner, request.signer, 'ExternalItemAdminCap.owner');
      assertProductCreation(product.parsed, cap.parsed, request, product.objectId, cap.objectId);
      productId = product.objectId;
      productRef = freeze({ objectId: product.objectId, version: String(product.version), digest: product.digest });
      adminCapRef = freeze({ objectId: cap.objectId, version: String(cap.version), digest: cap.digest });
      lifecycle = 0;
      controlEpoch = '0';
    } else if (['ADMIT_OPEN', 'ADMIT_CERTIFIED', 'REVOKE_ADMISSION'].includes(request.action)) {
      const registryRaw = changedRef(response, request.inputs.packRegistry.objectRef.objectId, types.packRegistry, 'PackRegistry');
      const registry = await historical(client, registryRaw, types.packRegistry, artifact.digest, 'PackRegistry');
      assertHistoricalSharedOwner(
        registry.owner,
        request.inputs.packRegistry.owner.initialSharedVersion,
        'PackRegistry.owner',
      );
      packRegistryRevision = (BigInt(request.product.packRegistryRevision) + 1n).toString();
      if (decimal(field(registry.parsed, 'revision', 'PackRegistry'), 'PackRegistry.revision') !== packRegistryRevision
        || response.events.length !== 1) {
        fail('MAKER_V8_COMPOSABLE_REGISTRY_DRIFT', 'PackRegistry revision does not prove the external admission transition.', 'READBACK');
      }
      registryEvent(response.events[0], request, runtime, request.action === 'REVOKE_ADMISSION' ? 3 : 2);
    } else if (['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT'].includes(request.action)) {
      const raw = changedRef(response, productId, types.externalItemProduct, 'ExternalItemProduct');
      const product = await historical(client, raw, types.externalItemProduct, artifact.digest, 'ExternalItemProduct');
      assertHistoricalSharedOwner(
        product.owner,
        request.inputs.product.owner.initialSharedVersion,
        'ExternalItemProduct.owner',
      );
      const expectedLifecycle = ACTIONS[request.action].to;
      if (!sameExcept(product.parsed, request.inputs.product.fields, { lifecycle: field(request.inputs.product.fields, 'lifecycle', 'pre product') })
        || Number(decimal(field(product.parsed, 'lifecycle', 'post product'), 'post product.lifecycle')) !== expectedLifecycle
        || response.events.length !== 0) {
        fail('MAKER_V8_COMPOSABLE_LIFECYCLE_DRIFT', 'External product changed outside the authorized lifecycle field.', 'READBACK');
      }
      productRef = freeze({ objectId: product.objectId, version: String(product.version), digest: product.digest });
      lifecycle = expectedLifecycle;
    } else if (request.action === 'TRANSFER_CONTROL') {
      const productRaw = changedRef(response, productId, types.externalItemProduct, 'ExternalItemProduct');
      const capRaw = changedRef(response, request.product.adminCapId, types.externalItemAdminCap, 'ExternalItemAdminCap');
      const [product, cap] = await Promise.all([
        historical(client, productRaw, types.externalItemProduct, artifact.digest, 'ExternalItemProduct'),
        historical(client, capRaw, types.externalItemAdminCap, artifact.digest, 'ExternalItemAdminCap'),
      ]);
      assertHistoricalSharedOwner(
        product.owner,
        request.inputs.product.owner.initialSharedVersion,
        'ExternalItemProduct.owner',
      );
      assertHistoricalAddressOwner(cap.owner, request.payload.recipient, 'ExternalItemAdminCap.owner');
      const nextEpoch = (BigInt(request.product.controlEpoch) + 1n).toString();
      if (!sameExcept(product.parsed, request.inputs.product.fields, {
        owner: field(request.inputs.product.fields, 'owner', 'pre product'),
        control_epoch: field(request.inputs.product.fields, 'control_epoch', 'pre product'),
      })
        || address(field(product.parsed, 'owner', 'post product'), 'post product.owner') !== request.payload.recipient
        || decimal(field(product.parsed, 'control_epoch', 'post product'), 'post product.controlEpoch') !== nextEpoch
        || moveId(field(cap.parsed, 'product_id', 'post cap'), 'post cap.productId') !== productId
        || address(field(cap.parsed, 'owner', 'post cap'), 'post cap.owner') !== request.payload.recipient
        || decimal(field(cap.parsed, 'control_epoch', 'post cap'), 'post cap.controlEpoch') !== nextEpoch
        || response.events.length !== 0) {
        fail('MAKER_V8_COMPOSABLE_CONTROL_DRIFT', 'External product control transfer readback is invalid.', 'READBACK');
      }
      productRef = freeze({ objectId: product.objectId, version: String(product.version), digest: product.digest });
      adminCapRef = freeze({ objectId: cap.objectId, version: String(cap.version), digest: cap.digest });
      ownerAddress = request.payload.recipient;
      controlEpoch = nextEpoch;
    } else if (request.action === 'MINT_ITEM') {
      const productRaw = changedRef(response, productId, types.externalItemProduct, 'ExternalItemProduct');
      const itemRaw = createdRefByType(response, types.ownedExternalItem, 'OwnedExternalItem');
      const [product, item] = await Promise.all([
        historical(client, productRaw, types.externalItemProduct, artifact.digest, 'ExternalItemProduct'),
        historical(client, itemRaw, types.ownedExternalItem, artifact.digest, 'OwnedExternalItem'),
      ]);
      assertHistoricalSharedOwner(
        product.owner,
        request.inputs.product.owner.initialSharedVersion,
        'ExternalItemProduct.owner',
      );
      assertHistoricalAddressOwner(item.owner, request.payload.recipient, 'OwnedExternalItem.owner');
      if (!sameExcept(product.parsed, request.inputs.product.fields, { supply: field(request.inputs.product.fields, 'supply', 'pre product') })
        || BigInt(decimal(field(product.parsed, 'supply', 'post product'), 'post product.supply'))
          !== BigInt(decimal(field(request.inputs.product.fields, 'supply', 'pre product'), 'pre product.supply')) + 1n
        || moveId(field(item.parsed, 'product_id', 'OwnedExternalItem'), 'item.productId') !== productId
        || hexVector(field(item.parsed, 'product_content_commitment', 'OwnedExternalItem'), 'item.productContent')
          !== hexVector(field(product.parsed, 'content_commitment', 'ExternalItemProduct'), 'product.contentCommitment')
        || hexVector(field(item.parsed, 'asset_content_commitment', 'OwnedExternalItem'), 'item.assetContent')
          !== hexVector(field(product.parsed, 'asset_content_commitment', 'ExternalItemProduct'), 'product.assetContentCommitment')
        || address(field(item.parsed, 'holder', 'OwnedExternalItem'), 'item.holder') !== request.payload.recipient
        || decimal(field(item.parsed, 'ownership_epoch', 'OwnedExternalItem'), 'item.ownershipEpoch') !== '0'
        || field(item.parsed, 'transferable', 'OwnedExternalItem') !== field(product.parsed, 'transferable', 'ExternalItemProduct')
        || response.events.length !== 0) {
        fail('MAKER_V8_COMPOSABLE_MINT_DRIFT', 'Minted external Item differs from the exact product and recipient.', 'READBACK');
      }
      productRef = freeze({ objectId: product.objectId, version: String(product.version), digest: product.digest });
      itemRef = freeze({ objectId: item.objectId, version: String(item.version), digest: item.digest });
    }
    return freeze({
      schemaVersion: MAKER_V8_COMPOSABLE_READBACK_SCHEMA,
      action: request.action,
      rootId: request.product.rootId,
      productId,
      productRef,
      adminCapRef,
      itemRef,
      lifecycle,
      owner: ownerAddress,
      controlEpoch,
      packRegistryRevision,
      finalizedDigest: artifact.digest,
    });
  };
}

function walletAddress(value) {
  return address(typeof value === 'string' ? value : value?.address, 'connected wallet');
}

export function createMakerV8ComposableAuthorityLoaderV8({
  client,
  runtime: runtimeInput,
  wallet,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const types = makerV8ChainTypes(runtime);
  if (typeof wallet?.getCurrentAccount !== 'function') {
    fail('MAKER_V8_COMPOSABLE_WALLET_INVALID', 'Composable actions require Wallet Standard account readback.', 'CONFIGURATION');
  }
  const read = async (objectId, type, label) => {
    const current = currentObject(await client.getObject({
      id: objectId,
      options: { showType: true, showContent: true, showOwner: true, showBcs: true },
    }), type, objectId, label);
    const history = await client.getHistoricalObject({ objectId, version: BigInt(current.objectRef.version) });
    if (!plain(history) || history.objectId !== objectId
      || String(history.version) !== current.objectRef.version
      || history.digest !== current.objectRef.digest
      || normalizeStructTag(history.type) !== normalizeStructTag(type)
      || !plain(history.parsed) || canonical(history.parsed) !== canonical(current.fields)
      || !(history.contentBcs instanceof Uint8Array) || !(history.objectBcs instanceof Uint8Array)) {
      fail('MAKER_V8_COMPOSABLE_CURRENT_BCS_DRIFT', `${label} current JSON/ref differs from exact historical BCS.`, 'READBACK');
    }
    return current;
  };
  const durableRaw = (request) => ({
    action: request.action,
    requestId: request.requestId,
    draftRevision: request.draftRevision,
    documentSha256: request.documentSha256,
    rootId: request.product.rootId,
    productId: request.product.productId,
    rootObjectId: request.inputs.root?.objectRef.objectId ?? null,
    definitionRegistryId: request.inputs.definitionRegistry?.objectRef.objectId ?? null,
    baseRegistryId: request.inputs.baseRegistry?.objectRef.objectId ?? null,
    packRegistryId: request.inputs.packRegistry?.objectRef.objectId ?? null,
    admissionAuthorityId: request.inputs.admissionAuthority?.objectRef.objectId ?? null,
    makerAdminId: request.inputs.makerAdmin?.objectRef.objectId ?? null,
    adminCapId: request.inputs.adminCap?.objectRef.objectId ?? null,
    payload: clone(request.payload),
  });
  return async (rawInput) => {
    const raw = rawInput?.schemaVersion === MAKER_V8_COMPOSABLE_REQUEST_SCHEMA
      ? durableRaw(assertRequest(rawInput)) : clone(rawInput, 'Composable build input');
    if (!plain(raw) || !Object.hasOwn(ACTIONS, raw.action)
      || typeof raw.requestId !== 'string' || !SAFE_KEY.test(raw.requestId)) {
      fail('MAKER_V8_COMPOSABLE_INPUT_INVALID', 'Composable build input is invalid.', 'INPUT');
    }
    const signer = walletAddress(await wallet.getCurrentAccount());
    const rootId = address(raw.rootId ?? raw.rootObjectId, 'rootId');
    const needed = new Set(requiredInputs(raw.action));
    const ids = {
      root: raw.rootObjectId ?? rootId,
      definitionRegistry: raw.definitionRegistryId,
      baseRegistry: raw.baseRegistryId,
      packRegistry: raw.packRegistryId,
      admissionAuthority: raw.admissionAuthorityId,
      makerAdmin: raw.makerAdminId,
      catalog: runtime.catalogId,
      runtimeConfig: runtime.roleConfigIds.runtime,
      protocolConfig: runtime.protocolConfigId,
      replacement: needed.has('replacement') ? makerV8AttestedReplacement(runtime).objectId : null,
      product: raw.productId,
      adminCap: raw.adminCapId,
    };
    const typeMap = {
      root: types.root,
      definitionRegistry: types.runtimeDefinitions,
      baseRegistry: types.baseRegistry,
      packRegistry: types.packRegistry,
      admissionAuthority: types.packAdmissionAuthority,
      makerAdmin: types.adminCap,
      catalog: types.productReleaseCatalog,
      runtimeConfig: types.runtimeConfig,
      protocolConfig: types.protocolConfig,
      replacement: makerV8StableType(runtime, 'core', 'package_binding_v8', 'FreshTupleReplacementBindingV2'),
      product: types.externalItemProduct,
      adminCap: types.externalItemAdminCap,
    };
    const inputs = Object.fromEntries(await Promise.all(INPUT_NAMES.map(async (name) => {
      if (!needed.has(name)) return [name, null];
      return [name, await read(address(ids[name], `${name}Id`), typeMap[name], name)];
    })));
    if (raw.action === 'ADMIT_CERTIFIED') assertCertifiedAuthorityInputs(runtime, inputs);
    const root = inputs.root;
    const definitions = inputs.definitionRegistry;
    const base = inputs.baseRegistry;
    const registry = inputs.packRegistry;
    const authority = inputs.admissionAuthority;
    const makerAdmin = inputs.makerAdmin;
    const productInput = inputs.product;
    const adminCap = inputs.adminCap;
    if (root !== null && (root.owner.kind !== 'SHARED'
      || Number(decimal(field(root.fields, 'lifecycle', 'MakerRoot'), 'MakerRoot.lifecycle')) !== 1)) {
      fail('MAKER_V8_COMPOSABLE_ROOT_INACTIVE', 'Composable action requires the exact active shared Maker Root.', 'AUTHORITY');
    }
    if (definitions !== null && (definitions.owner.kind !== 'SHARED'
      || moveId(field(definitions.fields, 'root_id', 'RuntimeDefinitionRegistry'), 'definitions.rootId') !== rootId
      || field(definitions.fields, 'sealed', 'RuntimeDefinitionRegistry') !== true
      || Number(decimal(field(definitions.fields, 'admission_ceiling', 'RuntimeDefinitionRegistry'), 'definitions.admissionCeiling')) === 0)) {
      fail('MAKER_V8_COMPOSABLE_DEFINITION_DRIFT', 'Runtime definitions do not authorize external Composable Items.', 'AUTHORITY');
    }
    if (base !== null && (base.owner.kind !== 'SHARED'
      || moveId(field(definitions.fields, 'base_registry_id', 'RuntimeDefinitionRegistry'), 'definitions.baseRegistryId') !== base.objectRef.objectId)) {
      fail('MAKER_V8_COMPOSABLE_BASE_DRIFT', 'Base registry differs from the exact Runtime definition binding.', 'AUTHORITY');
    }
    if (registry !== null && (registry.owner.kind !== 'SHARED'
      || moveId(field(registry.fields, 'root_id', 'PackRegistry'), 'registry.rootId') !== rootId
      || moveId(field(registry.fields, 'definition_registry_id', 'PackRegistry'), 'registry.definitionRegistryId') !== definitions.objectRef.objectId)) {
      fail('MAKER_V8_COMPOSABLE_REGISTRY_DRIFT', 'Pack registry differs from the exact Runtime definition binding.', 'AUTHORITY');
    }
    if (authority !== null && (authority.owner.kind !== 'SHARED'
      || moveId(field(authority.fields, 'root_id', 'PackAdmissionAuthority'), 'authority.rootId') !== rootId
      || moveId(field(registry.fields, 'admission_authority_id', 'PackRegistry'), 'registry.admissionAuthorityId') !== authority.objectRef.objectId)) {
      fail('MAKER_V8_COMPOSABLE_AUTHORITY_DRIFT', 'Admission authority differs from the exact Pack registry binding.', 'AUTHORITY');
    }
    if (makerAdmin !== null && (makerAdmin.owner.kind !== 'ADDRESS'
      || makerAdmin.owner.address !== signer
      || address(field(root.fields, 'owner', 'MakerRoot'), 'root.owner') !== signer
      || moveId(field(root.fields, 'admin_cap_id', 'MakerRoot'), 'root.adminCapId') !== makerAdmin.objectRef.objectId
      || moveId(field(makerAdmin.fields, 'root_id', 'MakerAdminCap'), 'makerAdmin.rootId') !== rootId
      || address(field(makerAdmin.fields, 'owner', 'MakerAdminCap'), 'makerAdmin.owner') !== signer
      || decimal(field(makerAdmin.fields, 'control_epoch', 'MakerAdminCap'), 'makerAdmin.controlEpoch')
        !== decimal(field(root.fields, 'control_epoch', 'MakerRoot'), 'root.controlEpoch'))) {
      fail('MAKER_V8_COMPOSABLE_MAKER_ADMIN_DRIFT', 'Maker governance does not belong to the connected wallet.', 'AUTHORITY');
    }
    if (productInput !== null && (productInput.owner.kind !== 'SHARED'
      || moveId(field(productInput.fields, 'root_id', 'ExternalItemProduct'), 'product.rootId') !== rootId
      || moveId(field(productInput.fields, 'admin_cap_id', 'ExternalItemProduct'), 'product.adminCapId')
        !== (adminCap?.objectRef.objectId ?? moveId(field(productInput.fields, 'admin_cap_id', 'ExternalItemProduct'), 'product.adminCapId')))) {
      fail('MAKER_V8_COMPOSABLE_PRODUCT_DRIFT', 'External product differs from the selected active Maker.', 'AUTHORITY');
    }
    if (adminCap !== null) {
      const productOwner = address(field(productInput.fields, 'owner', 'ExternalItemProduct'), 'product.owner');
      const productEpoch = decimal(field(productInput.fields, 'control_epoch', 'ExternalItemProduct'), 'product.controlEpoch');
      if (adminCap.owner.kind !== 'ADDRESS' || adminCap.owner.address !== signer
        || productOwner !== signer
        || moveId(field(adminCap.fields, 'product_id', 'ExternalItemAdminCap'), 'adminCap.productId') !== productInput.objectRef.objectId
        || address(field(adminCap.fields, 'owner', 'ExternalItemAdminCap'), 'adminCap.owner') !== productOwner
        || decimal(field(adminCap.fields, 'control_epoch', 'ExternalItemAdminCap'), 'adminCap.controlEpoch') !== productEpoch) {
        fail('MAKER_V8_COMPOSABLE_PRODUCT_CONTROL_DRIFT', 'External product control cap differs from the connected wallet.', 'AUTHORITY');
      }
    }
    if (inputs.catalog !== null && (inputs.catalog.owner.kind !== 'SHARED'
      || inputs.catalog.objectRef.objectId !== runtime.catalogId)) {
      fail('MAKER_V8_COMPOSABLE_CATALOG_DRIFT', 'Certified admission catalog differs from the runtime identity.', 'AUTHORITY');
    }
    if (inputs.runtimeConfig !== null && (inputs.runtimeConfig.owner.kind !== 'SHARED'
      || moveId(field(inputs.runtimeConfig.fields, 'catalog_id', 'RuntimePackageConfig'), 'runtimeConfig.catalogId') !== runtime.catalogId)) {
      fail('MAKER_V8_COMPOSABLE_CONFIG_DRIFT', 'Certified admission Runtime config differs from the catalog.', 'AUTHORITY');
    }
    const productId = productInput?.objectRef.objectId ?? null;
    const stateBound = ['PAUSE_PRODUCT', 'RESUME_PRODUCT', 'ARCHIVE_PRODUCT', 'TRANSFER_CONTROL', 'MINT_ITEM']
      .includes(raw.action);
    const product = freeze({
      rootId,
      productId,
      adminCapId: adminCap?.objectRef.objectId ?? null,
      sourceLifecycle: !stateBound ? null
        : Number(decimal(field(productInput.fields, 'lifecycle', 'ExternalItemProduct'), 'product.lifecycle')),
      controlEpoch: !stateBound ? null
        : decimal(field(productInput.fields, 'control_epoch', 'ExternalItemProduct'), 'product.controlEpoch'),
      packRegistryRevision: registry === null ? null
        : decimal(field(registry.fields, 'revision', 'PackRegistry'), 'registry.revision'),
    });
    const payload = Object.fromEntries(PAYLOAD_FIELDS.map((name) => [name, null]));
    if (raw.action === 'CREATE_PRODUCT') Object.assign(payload, raw.payload);
    if (['TRANSFER_CONTROL', 'MINT_ITEM'].includes(raw.action)) payload.recipient = raw.payload?.recipient;
    const candidate = {
      schemaVersion: MAKER_V8_COMPOSABLE_REQUEST_SCHEMA,
      action: raw.action,
      requestId: raw.requestId,
      draftId: raw.requestId,
      draftRevision: raw.draftRevision ?? 1,
      documentSha256: raw.documentSha256,
      signer,
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      publicationInput: { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER },
      inputs,
      product,
      payload,
    };
    if (candidate.documentSha256 === undefined) {
      const identity = { ...candidate };
      delete identity.documentSha256;
      candidate.documentSha256 = hashValue(identity);
    }
    return assertRequest(candidate);
  };
}

export async function createProductionMakerV8ComposableControllerV8({
  client,
  runtime: runtimeInput,
  wallet,
  rpc,
  execution,
  indexedDB = globalThis.indexedDB,
  persistenceOptions = {},
  now,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const loadRequest = createMakerV8ComposableAuthorityLoaderV8({ client, runtime, wallet, assertTransport });
  const certifyFinalized = createMakerV8ComposableReadbackV8({ client, runtime, assertTransport });
  const persistence = createMakerV8ComposablePersistenceV8(indexedDB, persistenceOptions);
  const compiler = createMakerV8ComposableCompilerV8({ runtime, loadFreshRequest: loadRequest, certifyFinalized });
  const boundary = createMakerV8PackPublicationBoundaryV8({
    client,
    compilerAuthority: compiler.authority,
    execution,
    assertCompilerTransaction: assertMakerV8ComposableCompilerTransactionV8,
    assertSignedArtifact: assertMakerV8ComposableSignedArtifactV8,
    assertTransport,
  });
  const engine = createMakerV8PackPublicationControllerV8({
    persistence, compiler, boundary, wallet, rpc, oneShot: true, execution,
    ...(now === undefined ? {} : { now }),
  });
  const controller = freeze({
    schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA,
    load: input => loadComposableAttempt(persistence, wallet, input),
    list: () => listComposableAttempts(persistence, wallet),
    async stage(input) {
      const request = assertRequest(input);
      if (request.signer !== walletAddress(await wallet.getCurrentAccount())) fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Wallet differs from reviewed request.', 'CONTEXT');
      await engine.prepare(request);
      return loadComposableAttempt(persistence, wallet, request);
    },
    execution: freeze({
      allowWalletSignature: execution?.allowWalletSignature === true,
      allowBroadcast: execution?.allowBroadcast === true,
    }),
    build: (input) => loadRequest(input),
    async prepare(builtInput) {
      const request = assertRequest(await builtInput);
      let plan = await engine.prepare(request);
      if (plan.status === 'ACTIVE' && plan.current?.outcome.status === 'READY') {
        plan = await engine.requestSignature(plan.attemptId);
      }
      const observedDigest = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (typeof observedDigest !== 'string') {
        fail('MAKER_V8_COMPOSABLE_SIGNATURE_REQUIRED', 'Composable signature was not durably persisted.', 'RECOVERY');
      }
      return freeze({ schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA, recoveryId: plan.attemptId, digest: observedDigest });
    },
    async recover(ticket) {
      exact(ticket, ['schemaVersion', 'recoveryId', 'digest'], 'Composable recovery ticket');
      let plan = await engine.recoverOutcome(ticket.recoveryId);
      const observedDigest = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (ticket.schemaVersion !== MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA || observedDigest !== ticket.digest) {
        fail('MAKER_V8_COMPOSABLE_TICKET_DRIFT', 'Composable durable attempt differs from its ticket.', 'RECOVERY');
      }
      if (plan.status === 'ACTIVE' && plan.current?.outcome.status === 'OUTCOME_PENDING'
        && plan.current.outcome.code === 'TYPED_GRPC_NOT_FOUND') {
        plan = await engine.replayExact(ticket.recoveryId);
      }
      return freeze({
        schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA,
        status: plan.status === 'COMPLETE' ? 'FINALIZED_SUCCESS'
          : plan.status === 'FAILED' ? 'FINALIZED_FAILURE' : 'OUTCOME_UNKNOWN',
        recoveryId: ticket.recoveryId,
        digest: ticket.digest,
        readback: plan.status === 'COMPLETE' ? freeze(clone(plan.terminal.chain)) : null,
      });
    },
  });
  return freeze({
    schemaVersion: MAKER_V8_COMPOSABLE_CONTROLLER_SCHEMA,
    runtime,
    persistence,
    compiler,
    boundary,
    controller,
  });
}
