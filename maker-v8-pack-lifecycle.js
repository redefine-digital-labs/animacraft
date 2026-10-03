import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58, fromBase64, normalizeStructTag, toBase64,
} from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8ChainTypes,
} from './maker-v8-chain.js';
import {
  MAKER_V8_PACK_CHAIN_READBACK_SCHEMA,
  MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
} from './maker-v8-pack-controller.js';
import {
  MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
  createMakerV8PackPublicationControllerV8,
  createMakerV8PackPublicationPersistenceV8,
} from './maker-v8-pack-publication.js';
import {
  createMakerV8PackPublicationBoundaryV8,
} from './maker-v8-pack-publication-adapters.js';
import { assertFinalizedMakerV8CompilerTransactionV8 } from './maker-v8-browser.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';
import { assertMakerV8SuiGrpcTransport } from './maker-v8-sui-grpc.js';

export const MAKER_V8_PACK_LIFECYCLE_REQUEST_SCHEMA =
  'animacraft.maker-v8-pack-lifecycle-request.v1';
export const MAKER_V8_PACK_LIFECYCLE_DATABASE =
  'animacraft-maker-v8-pack-lifecycle-v1';

export const MAKER_V8_PACK_LIFECYCLE_STATES = Object.freeze({
  DRAFT: 0,
  SEALED: 1,
  ACTIVE: 2,
  PAUSED: 3,
  ARCHIVED: 4,
});

const ACTIONS = Object.freeze({
  PAUSE: Object.freeze({ function: 'pause_pack_release_v8', from: 'ACTIVE', to: 'PAUSED' }),
  RESUME: Object.freeze({ function: 'resume_pack_release_v8', from: 'PAUSED', to: 'ACTIVE' }),
  ARCHIVE: Object.freeze({ function: 'archive_pack_release_v8', from: ['ACTIVE', 'PAUSED'], to: 'ARCHIVED' }),
  TRANSFER_CONTROL: Object.freeze({
    function: 'transfer_pack_control_v8', from: ['ACTIVE', 'PAUSED', 'ARCHIVED'], to: null,
  }),
  REVOKE_ADMISSION: Object.freeze({
    function: 'revoke_pack_admission_v8', from: ['ACTIVE', 'PAUSED', 'ARCHIVED'], to: null,
  }),
  WITHDRAW_PACK_REVENUE: Object.freeze({
    function: 'withdraw_pack_revenue_v8', from: ['ACTIVE', 'PAUSED', 'ARCHIVED'], to: null,
  }),
});

const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const SAFE_DRAFT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const encoder = new TextEncoder();
const TRANSACTION_PROOFS = new WeakMap();
const SIGNED_PROOFS = new WeakMap();

const LIFECYCLE_EVENT_BCS = bcs.struct('PackLifecycleChangedV8', {
  release_id: bcs.Address,
  previous_lifecycle: bcs.u8(),
  lifecycle: bcs.u8(),
});
const REGISTRY_EVENT_BCS = bcs.struct('PackRegistryRevisionAdvancedV8', {
  root_id: bcs.Address,
  previous_revision: bcs.u64(),
  revision: bcs.u64(),
  subject_id: bcs.Address,
  operation: bcs.u8(),
});

export class MakerV8PackLifecycleError extends Error {
  constructor(code, message, layer = 'PACK_LIFECYCLE', details = undefined) {
    super(message);
    this.name = 'MakerV8PackLifecycleError';
    this.code = code;
    this.layer = layer;
    if (details !== undefined) this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, layer = 'PACK_LIFECYCLE', details) {
  throw new MakerV8PackLifecycleError(code, message, layer, details);
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
  if (!plain(value)) fail('MAKER_V8_PACK_LIFECYCLE_SHAPE_INVALID', `${label} must be a plain record.`, 'SCHEMA');
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PACK_LIFECYCLE_FIELDS_INVALID', `${label} has fields outside its exact schema.`, 'SCHEMA', { actual, expected });
  }
  return value;
}

function canonicalValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!plain(value)) fail('MAKER_V8_PACK_LIFECYCLE_DURABLE_INVALID', 'Pack lifecycle evidence is not deterministic JSON.', 'SCHEMA');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

function clone(value, label = 'Pack lifecycle value') {
  let result;
  try {
    result = structuredClone(value);
    if (canonical(result) !== canonical(value)) throw new Error('roundtrip');
  } catch {
    fail('MAKER_V8_PACK_LIFECYCLE_DURABLE_INVALID', `${label} must be deterministic structured-cloneable data.`, 'SCHEMA');
  }
  return result;
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  return hashBytes(encoder.encode(canonical(value)));
}

function address(value, label) {
  const result = String(value ?? '').toLowerCase();
  if (!EXACT_ID.test(result) || /^0x0+$/.test(result)) {
    fail('MAKER_V8_PACK_LIFECYCLE_ID_INVALID', `${label} must be one canonical non-zero Sui ID.`, 'INPUT');
  }
  return result;
}

function decimal(value, label, { positive = false } = {}) {
  const result = String(value ?? '');
  if (!UINT.test(result) || positive && result === '0') {
    fail('MAKER_V8_PACK_LIFECYCLE_INTEGER_INVALID', `${label} must be one canonical ${positive ? 'positive ' : ''}u64.`, 'INPUT');
  }
  return result;
}

function digest(value, label) {
  try {
    if (typeof value !== 'string' || fromBase58(value).length !== 32) throw new Error('digest');
  } catch {
    fail('MAKER_V8_PACK_LIFECYCLE_DIGEST_INVALID', `${label} must be one canonical Sui digest.`, 'INPUT');
  }
  return value;
}

function field(fields, name, label) {
  if (!plain(fields)) fail('MAKER_V8_PACK_LIFECYCLE_FIELDS_INVALID', `${label} has no Move fields.`, 'READBACK');
  if (Object.hasOwn(fields, name)) return fields[name];
  const camel = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  if (Object.hasOwn(fields, camel)) return fields[camel];
  fail('MAKER_V8_PACK_LIFECYCLE_FIELD_MISSING', `${label}.${name} is missing.`, 'READBACK');
}

function moveId(value, label) {
  if (typeof value === 'string') return address(value, label);
  if (plain(value?.fields)) return moveId(value.fields, label);
  if (plain(value) && Object.hasOwn(value, 'id')) return moveId(value.id, label);
  fail('MAKER_V8_PACK_LIFECYCLE_ID_INVALID', `${label} is not one Move ID.`, 'READBACK');
}

function moveText(value, label) {
  if (typeof value === 'string') return value;
  const bytes = value?.fields?.bytes ?? value?.bytes;
  if (typeof bytes === 'string') return bytes;
  fail('MAKER_V8_PACK_LIFECYCLE_TEXT_INVALID', `${label} is not one Move String.`, 'READBACK');
}

function objectRef(value, label) {
  exact(value, ['objectId', 'version', 'digest'], `${label}.objectRef`);
  return freeze({
    objectId: address(value.objectId, `${label}.objectId`),
    version: decimal(value.version, `${label}.version`, { positive: true }),
    digest: digest(value.digest, `${label}.digest`),
  });
}

function owner(value, label) {
  if (!plain(value)) fail('MAKER_V8_PACK_LIFECYCLE_OWNER_INVALID', `${label} owner is invalid.`, 'READBACK');
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
  fail('MAKER_V8_PACK_LIFECYCLE_OWNER_INVALID', `${label} has an unsupported owner.`, 'READBACK');
}

function currentObject(response, expectedType, expectedId, label) {
  const data = response?.data;
  if (!plain(data) || response?.error || !plain(data.content)
    || data.content.dataType !== 'moveObject') {
    fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_MISSING', `${label} is unavailable.`, 'READBACK');
  }
  const observedType = normalizeStructTag(String(data.type ?? data.content.type ?? ''));
  if (observedType !== normalizeStructTag(expectedType)) {
    fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_TYPE_DRIFT', `${label} has another stable TypeOrigin.`, 'READBACK');
  }
  const reference = objectRef({
    objectId: String(data.objectId ?? '').toLowerCase(),
    version: String(data.version ?? ''),
    digest: data.digest,
  }, label);
  if (reference.objectId !== expectedId) {
    fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_ID_DRIFT', `${label} returned another object.`, 'READBACK');
  }
  return freeze({
    objectRef: reference,
    type: observedType,
    owner: owner(data.owner, label),
    fields: freeze(clone(data.content.fields, `${label}.fields`)),
  });
}

function lifecycleName(code) {
  return Object.keys(MAKER_V8_PACK_LIFECYCLE_STATES)
    .find((name) => MAKER_V8_PACK_LIFECYCLE_STATES[name] === Number(code)) ?? null;
}

function assertSourceLifecycle(action, observed) {
  const expected = ACTIONS[action].from;
  if (Array.isArray(expected) ? !expected.includes(observed) : expected !== observed) {
    fail('MAKER_V8_PACK_LIFECYCLE_TRANSITION_INVALID', `Cannot ${action} a ${observed} Pack.`, 'STATE');
  }
}

function assertRequest(value) {
  const request = clone(value, 'Pack lifecycle request');
  exact(request, [
    'schemaVersion', 'draftId', 'draftRevision', 'documentSha256',
    'publicationInput', 'action', 'signer', 'pack', 'inputs',
  ], 'Pack lifecycle request');
  if (request.schemaVersion !== MAKER_V8_PACK_LIFECYCLE_REQUEST_SCHEMA
    || !SAFE_DRAFT.test(request.draftId)
    || !Number.isSafeInteger(request.draftRevision) || request.draftRevision < 1
    || !HASH.test(request.documentSha256)
    || !Object.hasOwn(ACTIONS, request.action)) {
    fail('MAKER_V8_PACK_LIFECYCLE_REQUEST_INVALID', 'Pack lifecycle request identity is invalid.', 'SCHEMA');
  }
  exact(request.publicationInput, ['chainIdentifier'], 'Pack lifecycle publicationInput');
  if (request.publicationInput.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER) {
    fail('MAKER_V8_PACK_LIFECYCLE_NETWORK_INVALID', 'Pack lifecycle request is not pinned to Mainnet.', 'CONTEXT');
  }
  request.signer = address(request.signer, 'request.signer');
  exact(request.pack, [
    'rootId', 'packRegistryId', 'semanticPackId', 'packRegistryRevision',
    'sourceLifecycle', 'releaseId', 'adminCapId', 'treasuryId',
  ], 'Pack lifecycle pack identity');
  request.pack.rootId = address(request.pack.rootId, 'pack.rootId');
  request.pack.packRegistryId = address(request.pack.packRegistryId, 'pack.packRegistryId');
  request.pack.releaseId = address(request.pack.releaseId, 'pack.releaseId');
  request.pack.adminCapId = address(request.pack.adminCapId, 'pack.adminCapId');
  request.pack.treasuryId = address(request.pack.treasuryId, 'pack.treasuryId');
  if (typeof request.pack.semanticPackId !== 'string' || !request.pack.semanticPackId.length
    || request.pack.semanticPackId.length > 128
    || !Object.hasOwn(MAKER_V8_PACK_LIFECYCLE_STATES, request.pack.sourceLifecycle)) {
    fail('MAKER_V8_PACK_LIFECYCLE_PACK_INVALID', 'Pack lifecycle semantic identity is invalid.', 'SCHEMA');
  }
  request.pack.packRegistryRevision = decimal(request.pack.packRegistryRevision, 'pack.packRegistryRevision', { positive: true });
  assertSourceLifecycle(request.action, request.pack.sourceLifecycle);
  exact(request.inputs, [
    'release', 'adminCap', 'treasury', 'packRegistry',
    'admissionAuthority', 'definitionRegistry', 'root', 'makerAdmin',
    'amountAtomic', 'recipient',
  ], 'Pack lifecycle inputs');
  for (const name of ['release', 'adminCap', 'treasury', 'packRegistry']) {
    exact(request.inputs[name], ['objectRef', 'type', 'owner', 'fields'], `inputs.${name}`);
    request.inputs[name].objectRef = objectRef(request.inputs[name].objectRef, `inputs.${name}`);
    if (typeof request.inputs[name].type !== 'string' || !plain(request.inputs[name].owner)
      || !plain(request.inputs[name].fields)) {
      fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_INVALID', `inputs.${name} is invalid.`, 'SCHEMA');
    }
  }
  const governanceNames = ['admissionAuthority', 'definitionRegistry', 'root', 'makerAdmin'];
  const governanceRequired = request.action === 'REVOKE_ADMISSION';
  for (const name of governanceNames) {
    if (request.inputs[name] === null) {
      if (governanceRequired) {
        fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_INVALID', `inputs.${name} is required for admission revocation.`, 'SCHEMA');
      }
      continue;
    }
    exact(request.inputs[name], ['objectRef', 'type', 'owner', 'fields'], `inputs.${name}`);
    request.inputs[name].objectRef = objectRef(request.inputs[name].objectRef, `inputs.${name}`);
    if (typeof request.inputs[name].type !== 'string' || !plain(request.inputs[name].owner)
      || !plain(request.inputs[name].fields)) {
      fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_INVALID', `inputs.${name} is invalid.`, 'SCHEMA');
    }
  }
  const controlEpoch = decimal(
    field(request.inputs.release.fields, 'control_epoch', 'inputs.release'),
    'inputs.release.controlEpoch',
  );
  const packControlled = request.action !== 'REVOKE_ADMISSION';
  if (request.inputs.release.owner.kind !== 'SHARED'
    || request.inputs.treasury.owner.kind !== 'SHARED'
    || request.inputs.packRegistry.owner.kind !== 'SHARED'
    || request.inputs.adminCap.owner.kind !== 'ADDRESS'
    || (packControlled && request.inputs.adminCap.owner.address !== request.signer)
    || request.inputs.release.objectRef.objectId !== request.pack.releaseId
    || request.inputs.adminCap.objectRef.objectId !== request.pack.adminCapId
    || request.inputs.treasury.objectRef.objectId !== request.pack.treasuryId
    || request.inputs.packRegistry.objectRef.objectId !== request.pack.packRegistryId
    || moveId(field(request.inputs.release.fields, 'root_id', 'inputs.release'), 'inputs.release.rootId') !== request.pack.rootId
    || moveId(field(request.inputs.release.fields, 'admin_cap_id', 'inputs.release'), 'inputs.release.adminCapId') !== request.pack.adminCapId
    || moveId(field(request.inputs.release.fields, 'treasury_id', 'inputs.release'), 'inputs.release.treasuryId') !== request.pack.treasuryId
    || moveText(field(request.inputs.release.fields, 'semantic_pack_id', 'inputs.release'), 'inputs.release.semanticPackId') !== request.pack.semanticPackId
    || (packControlled
      && address(field(request.inputs.release.fields, 'owner', 'inputs.release'), 'inputs.release.owner') !== request.signer)
    || lifecycleName(decimal(field(request.inputs.release.fields, 'lifecycle', 'inputs.release'), 'inputs.release.lifecycle')) !== request.pack.sourceLifecycle
    || moveId(field(request.inputs.adminCap.fields, 'release_id', 'inputs.adminCap'), 'inputs.adminCap.releaseId') !== request.pack.releaseId
    || address(field(request.inputs.adminCap.fields, 'owner', 'inputs.adminCap'), 'inputs.adminCap.owner')
      !== address(field(request.inputs.release.fields, 'owner', 'inputs.release'), 'inputs.release.owner')
    || (packControlled
      && address(field(request.inputs.adminCap.fields, 'owner', 'inputs.adminCap'), 'inputs.adminCap.owner') !== request.signer)
    || decimal(field(request.inputs.adminCap.fields, 'control_epoch', 'inputs.adminCap'), 'inputs.adminCap.controlEpoch') !== controlEpoch
    || moveId(field(request.inputs.treasury.fields, 'release_id', 'inputs.treasury'), 'inputs.treasury.releaseId') !== request.pack.releaseId
    || moveId(field(request.inputs.packRegistry.fields, 'root_id', 'inputs.packRegistry'), 'inputs.packRegistry.rootId') !== request.pack.rootId
    || decimal(field(request.inputs.packRegistry.fields, 'revision', 'inputs.packRegistry'), 'inputs.packRegistry.revision') !== request.pack.packRegistryRevision) {
    fail('MAKER_V8_PACK_LIFECYCLE_AUTHORITY_DRIFT', 'Pack lifecycle request objects are not one exact control authority.', 'BINDING');
  }
  if (governanceRequired) {
    const root = request.inputs.root;
    const makerAdmin = request.inputs.makerAdmin;
    const definitions = request.inputs.definitionRegistry;
    const admission = request.inputs.admissionAuthority;
    if (root.owner.kind !== 'SHARED' || definitions.owner.kind !== 'SHARED'
      || admission.owner.kind !== 'SHARED' || makerAdmin.owner.kind !== 'ADDRESS'
      || makerAdmin.owner.address !== request.signer
      || address(field(root.fields, 'owner', 'inputs.root'), 'inputs.root.owner') !== request.signer
      || moveId(field(root.fields, 'admin_cap_id', 'inputs.root'), 'inputs.root.adminCapId') !== makerAdmin.objectRef.objectId
      || moveId(field(makerAdmin.fields, 'root_id', 'inputs.makerAdmin'), 'inputs.makerAdmin.rootId') !== request.pack.rootId
      || address(field(makerAdmin.fields, 'owner', 'inputs.makerAdmin'), 'inputs.makerAdmin.owner') !== request.signer
      || decimal(field(makerAdmin.fields, 'control_epoch', 'inputs.makerAdmin'), 'inputs.makerAdmin.controlEpoch')
        !== decimal(field(root.fields, 'control_epoch', 'inputs.root'), 'inputs.root.controlEpoch')
      || moveId(field(definitions.fields, 'root_id', 'inputs.definitionRegistry'), 'inputs.definitionRegistry.rootId') !== request.pack.rootId
      || moveId(field(admission.fields, 'root_id', 'inputs.admissionAuthority'), 'inputs.admissionAuthority.rootId') !== request.pack.rootId
      || moveId(field(request.inputs.packRegistry.fields, 'definition_registry_id', 'inputs.packRegistry'), 'inputs.packRegistry.definitionRegistryId')
        !== definitions.objectRef.objectId
      || moveId(field(request.inputs.packRegistry.fields, 'admission_authority_id', 'inputs.packRegistry'), 'inputs.packRegistry.admissionAuthorityId')
        !== admission.objectRef.objectId) {
      fail('MAKER_V8_PACK_LIFECYCLE_AUTHORITY_DRIFT', 'Pack admission revocation is not one exact Maker governance authority.', 'BINDING');
    }
  }
  if (request.action === 'WITHDRAW_PACK_REVENUE') {
    request.inputs.amountAtomic = decimal(request.inputs.amountAtomic, 'inputs.amountAtomic', { positive: true });
    request.inputs.recipient = address(request.inputs.recipient, 'inputs.recipient');
  } else if (request.action === 'TRANSFER_CONTROL') {
    request.inputs.recipient = address(request.inputs.recipient, 'inputs.recipient');
    if (request.inputs.recipient === request.signer || request.inputs.amountAtomic !== null) {
      fail('MAKER_V8_PACK_LIFECYCLE_REQUEST_INVALID', 'Pack control transfer requires one different recipient and no amount.', 'SCHEMA');
    }
  } else if (request.inputs.amountAtomic !== null || request.inputs.recipient !== null) {
    fail('MAKER_V8_PACK_LIFECYCLE_REQUEST_INVALID', 'Only Pack revenue withdrawal accepts amount and recipient.', 'SCHEMA');
  }
  const identity = {
    action: request.action,
    signer: request.signer,
    pack: request.pack,
    inputs: request.inputs,
  };
  if (request.documentSha256 !== hashValue(identity)) {
    fail('MAKER_V8_PACK_LIFECYCLE_REQUEST_DRIFT', 'Pack lifecycle request hash differs from its exact authority.', 'SCHEMA');
  }
  return freeze(request);
}

export function buildMakerV8PackLifecycleRequestV8({
  draftId,
  draftRevision,
  action,
  signer,
  pack,
  inputs,
} = {}) {
  const identity = freeze({
    action,
    signer: address(signer, 'request.signer'),
    pack: freeze(clone(pack, 'Pack lifecycle pack identity')),
    inputs: freeze(clone(inputs, 'Pack lifecycle inputs')),
  });
  return assertRequest({
    schemaVersion: MAKER_V8_PACK_LIFECYCLE_REQUEST_SCHEMA,
    draftId: String(draftId ?? ''),
    draftRevision: Number(draftRevision),
    documentSha256: hashValue(identity),
    publicationInput: { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER },
    ...identity,
  });
}

function sharedArgument(transaction, input, mutable) {
  if (input.owner.kind !== 'SHARED') {
    fail('MAKER_V8_PACK_LIFECYCLE_SHARED_REQUIRED', 'Pack lifecycle shared input is not shared.', 'BINDING');
  }
  return transaction.sharedObjectRef({
    objectId: input.objectRef.objectId,
    initialSharedVersion: input.owner.initialSharedVersion,
    mutable,
  });
}

function ownedArgument(transaction, input, signer) {
  if (input.owner.kind !== 'ADDRESS' || input.owner.address !== signer) {
    fail('MAKER_V8_PACK_LIFECYCLE_CAP_REQUIRED', 'Pack lifecycle AdminCap is not held by the signer.', 'BINDING');
  }
  return transaction.objectRef(input.objectRef);
}

function buildTransaction(runtime, request) {
  const transaction = new Transaction();
  transaction.setSender(request.signer);
  const target = `${runtime.roles.runtime.callablePackageId}::runtime_v8::${ACTIONS[request.action].function}`;
  if (request.action === 'REVOKE_ADMISSION') {
    transaction.moveCall({
      target,
      typeArguments: [runtime.paymentCoinType],
      arguments: [
        sharedArgument(transaction, request.inputs.packRegistry, true),
        sharedArgument(transaction, request.inputs.admissionAuthority, false),
        sharedArgument(transaction, request.inputs.definitionRegistry, false),
        sharedArgument(transaction, request.inputs.root, false),
        ownedArgument(transaction, request.inputs.makerAdmin, request.signer),
        transaction.pure.address(request.pack.releaseId),
        transaction.pure.u64(request.pack.packRegistryRevision),
      ],
    });
    return { transaction, target };
  }
  const args = [
    sharedArgument(transaction, request.inputs.release, request.action !== 'WITHDRAW_PACK_REVENUE'),
    ownedArgument(transaction, request.inputs.adminCap, request.signer),
  ];
  if (request.action === 'RESUME') {
    args.push(sharedArgument(transaction, request.inputs.packRegistry, false));
  }
  if (request.action === 'WITHDRAW_PACK_REVENUE') {
    args.push(
      sharedArgument(transaction, request.inputs.treasury, true),
      transaction.pure.u64(request.inputs.amountAtomic),
      transaction.pure.address(request.inputs.recipient),
    );
  } else if (request.action === 'TRANSFER_CONTROL') {
    args.push(transaction.pure.address(request.inputs.recipient));
  }
  transaction.moveCall({
    target,
    typeArguments: [runtime.paymentCoinType],
    arguments: args,
  });
  return { transaction, target };
}

async function descriptor(runtime, request) {
  const { transaction, target } = buildTransaction(runtime, request);
  const kind = await transaction.build({ onlyTransactionKind: true });
  const proof = freeze({
    signer: request.signer,
    kindBytes: toBase64(kind),
    kindSha256: hashBytes(kind),
    target,
    requestSha256: request.documentSha256,
  });
  return freeze({
    transaction,
    proof,
    descriptor: freeze({
      schemaVersion: MAKER_V8_PACK_PUBLICATION_DESCRIPTOR_SCHEMA,
      ordinal: 0,
      stage: 'FINALIZE',
      startStyle: 0,
      endStyle: 0,
      signer: request.signer,
      kindBytes: proof.kindBytes,
      kindSha256: proof.kindSha256,
      targets: freeze([target]),
      checkpoint: freeze({
        action: request.action,
        requestSha256: request.documentSha256,
        releaseId: request.pack.releaseId,
        sourceLifecycle: request.pack.sourceLifecycle,
        expectedLifecycle: ACTIONS[request.action].to ?? request.pack.sourceLifecycle,
      }),
    }),
  });
}

function transactionData(value, expected) {
  let bytes; let parsed; let roundtrip;
  try {
    bytes = fromBase64(value);
    parsed = bcs.TransactionData.parse(bytes);
    roundtrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PACK_LIFECYCLE_TRANSACTION_INVALID', 'Durable Pack lifecycle TransactionData is not canonical BCS.', 'EXACT_BYTES');
  }
  const kind = parsed?.$kind === 'V1'
    ? bcs.TransactionKind.serialize(parsed.V1.kind).toBytes() : null;
  const actualDigest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (!(kind instanceof Uint8Array) || toBase64(bytes) !== value
    || roundtrip.length !== bytes.length || roundtrip.some((byte, index) => byte !== bytes[index])
    || parsed.V1.sender !== expected.signer || parsed.V1.gasData?.owner !== expected.signer
    || toBase64(kind) !== expected.kindBytes
    || expected.digest !== undefined && actualDigest !== expected.digest) {
    fail('MAKER_V8_PACK_LIFECYCLE_TRANSACTION_DRIFT', 'Durable Pack lifecycle TransactionData differs from its exact compiler proof.', 'EXACT_BYTES');
  }
  return freeze({ kindBytes: toBase64(kind), digest: actualDigest });
}

export function assertMakerV8PackLifecycleCompilerTransactionV8(authority, transaction, expected) {
  const proof = TRANSACTION_PROOFS.get(transaction);
  if (!plain(authority) || !proof || proof.authority !== authority
    || proof.signer !== expected.signer || proof.kindBytes !== expected.kindBytes
    || proof.kindSha256 !== expected.kindSha256) {
    fail('MAKER_V8_PACK_LIFECYCLE_COMPILER_PROOF_REQUIRED', 'Pack lifecycle transaction lacks exact in-process compiler authority.', 'COMPILER');
  }
  return transaction;
}

export function assertMakerV8PackLifecycleSignedArtifactV8(authority, artifact) {
  const proof = SIGNED_PROOFS.get(authority)?.get(artifact.digest);
  if (!proof || proof.signer !== artifact.signer || proof.bytes !== artifact.bytes
    || proof.signature !== artifact.signature) {
    fail('MAKER_V8_PACK_LIFECYCLE_SIGNED_PROOF_REQUIRED', 'Pack lifecycle signed artifact lacks exact durable compiler authority.', 'COMPILER');
  }
  return proof;
}

export function createMakerV8PackLifecycleCompilerV8({
  runtime: runtimeInput,
  loadFreshRequest,
  certifyFinalized,
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const types = makerV8ChainTypes(runtime);
  if (typeof loadFreshRequest !== 'function' || typeof certifyFinalized !== 'function') {
    fail('MAKER_V8_PACK_LIFECYCLE_DEPENDENCY_INVALID', 'Pack lifecycle compiler requires fresh authority and final readback.', 'CONFIGURATION');
  }
  const authority = freeze({ schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA });
  const register = async (request) => {
    const expectedTypes = {
      release: types.packRelease,
      adminCap: types.packAdminCap,
      treasury: types.packTreasury,
      packRegistry: types.packRegistry,
    };
    if (request.action === 'REVOKE_ADMISSION') {
      Object.assign(expectedTypes, {
        admissionAuthority: types.packAdmissionAuthority,
        definitionRegistry: types.runtimeDefinitions,
        root: types.root,
        makerAdmin: types.adminCap,
      });
    }
    for (const [name, expectedType] of Object.entries(expectedTypes)) {
      if (normalizeStructTag(request.inputs[name].type) !== normalizeStructTag(expectedType)) {
        fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_TYPE_DRIFT', `inputs.${name} has another stable TypeOrigin.`, 'COMPILER');
      }
    }
    const built = await descriptor(runtime, request);
    TRANSACTION_PROOFS.set(built.transaction, freeze({ ...built.proof, authority }));
    return freeze({ authority, request, ...built });
  };
  const prepare = async (raw) => {
    const request = assertRequest(raw);
    const built = await register(request);
    return freeze({
      authority,
      transaction: built.transaction,
      descriptor: built.descriptor,
      attemptId: `pack-life-${hashValue({ draftId: request.draftId, revision: request.draftRevision, requestSha256: request.documentSha256 })}`,
    });
  };
  return freeze({
    authority,
    prepare,
    async rehydrate({ plan, requireFreshAuthority }) {
      const request = assertRequest(plan?.immutable?.request);
      if (requireFreshAuthority) {
        const fresh = assertRequest(await loadFreshRequest(request));
        if (canonical(fresh) !== canonical(request)) {
          fail('MAKER_V8_PACK_LIFECYCLE_AUTHORITY_DRIFT', 'Live Pack lifecycle authority changed before signing or replay.', 'CONTEXT');
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
          kindBytes: built.descriptor.kindBytes,
        }));
        while (proofs.size > 32) proofs.delete(proofs.keys().next().value);
        SIGNED_PROOFS.set(authority, proofs);
      }
      return freeze({ authority, transaction: built.transaction, descriptor: built.descriptor });
    },
    async certifyFinalized({ plan, query, attested, artifact }) {
      if (attested?.authority !== authority || query?.status !== 'FINALIZED_SUCCESS') {
        fail('MAKER_V8_PACK_LIFECYCLE_FINALITY_INVALID', 'Pack lifecycle certification requires exact successful authority.', 'READBACK');
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
          releaseId: request.pack.releaseId,
        }),
      });
    },
    async prepareSuccessor() {
      fail('MAKER_V8_PACK_LIFECYCLE_SUCCESSOR_INVALID', 'Pack lifecycle actions are one-shot transactions.', 'COMPILER');
    },
  });
}

function canonicalFields(value, replacements = {}) {
  const result = clone(value, 'Move fields');
  Object.assign(result, replacements);
  return canonical(result);
}

function changedRef(response, expectedId, expectedType, label) {
  const normalized = normalizeStructTag(expectedType);
  const matches = response.objectChanges.filter((entry) => (
    ['created', 'mutated'].includes(entry.type)
    && entry.objectId === expectedId
    && normalizeStructTag(entry.objectType) === normalized
  ));
  if (matches.length !== 1) {
    fail('MAKER_V8_PACK_LIFECYCLE_EFFECT_INVALID', `${label} requires one exact object write.`, 'READBACK', { observed: matches.length });
  }
  const refs = response.compilerEffectsOutputRefs.filter((entry) => entry.objectId === expectedId);
  if (refs.length !== 1 || String(refs[0].version) !== String(matches[0].version)
    || refs[0].digest !== matches[0].digest) {
    fail('MAKER_V8_PACK_LIFECYCLE_EFFECT_DRIFT', `${label} raw effects and Core object change differ.`, 'READBACK');
  }
  return refs[0];
}

async function historical(client, ref, expectedType, txDigest, label) {
  const value = await client.getHistoricalObject({ objectId: ref.objectId, version: BigInt(ref.version) });
  if (!plain(value) || value.objectId !== ref.objectId || String(value.version) !== String(ref.version)
    || value.digest !== ref.digest || value.previousTransaction !== txDigest
    || normalizeStructTag(value.type) !== normalizeStructTag(expectedType)
    || !plain(value.parsed) || !(value.contentBcs instanceof Uint8Array)
    || !(value.objectBcs instanceof Uint8Array)) {
    fail('MAKER_V8_PACK_LIFECYCLE_HISTORY_DRIFT', `${label} historical BCS/JSON/ref differs from finalized effects.`, 'READBACK');
  }
  return value;
}

function eventFields(event, request, runtime) {
  const expectedType = `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackLifecycleChangedV8`;
  if (normalizeStructTag(event?.type) !== normalizeStructTag(expectedType)
    || event.sender !== request.signer || typeof event.bcs !== 'string' || !plain(event.parsedJson)) {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_INVALID', 'Pack lifecycle finalized event identity is invalid.', 'READBACK');
  }
  let bytes; let decoded; let roundtrip;
  try {
    bytes = fromBase64(event.bcs);
    decoded = LIFECYCLE_EVENT_BCS.parse(bytes);
    roundtrip = LIFECYCLE_EVENT_BCS.serialize(decoded).toBytes();
  } catch {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_INVALID', 'Pack lifecycle event BCS is not canonical.', 'READBACK');
  }
  if (roundtrip.length !== bytes.length || roundtrip.some((byte, index) => byte !== bytes[index])) {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_INVALID', 'Pack lifecycle event BCS is not canonical.', 'READBACK');
  }
  const json = event.parsedJson;
  const observed = {
    releaseId: address(decoded.release_id, 'event.releaseId'),
    previousLifecycle: Number(decoded.previous_lifecycle),
    lifecycle: Number(decoded.lifecycle),
  };
  const displayed = {
    releaseId: moveId(field(json, 'release_id', 'event'), 'event.releaseId'),
    previousLifecycle: Number(decimal(field(json, 'previous_lifecycle', 'event'), 'event.previousLifecycle')),
    lifecycle: Number(decimal(field(json, 'lifecycle', 'event'), 'event.lifecycle')),
  };
  if (canonical(observed) !== canonical(displayed)) {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_DRIFT', 'Pack lifecycle event BCS and JSON differ.', 'READBACK');
  }
  return observed;
}

function registryEventFields(event, request, runtime) {
  const expectedType = `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackRegistryRevisionAdvancedV8`;
  if (normalizeStructTag(event?.type) !== normalizeStructTag(expectedType)
    || event.sender !== request.signer || typeof event.bcs !== 'string' || !plain(event.parsedJson)) {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_INVALID', 'Pack registry event identity is invalid.', 'READBACK');
  }
  let bytes; let decoded; let roundtrip;
  try {
    bytes = fromBase64(event.bcs);
    decoded = REGISTRY_EVENT_BCS.parse(bytes);
    roundtrip = REGISTRY_EVENT_BCS.serialize(decoded).toBytes();
  } catch {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_INVALID', 'Pack registry event BCS is not canonical.', 'READBACK');
  }
  if (roundtrip.length !== bytes.length || roundtrip.some((byte, index) => byte !== bytes[index])) {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_INVALID', 'Pack registry event BCS is not canonical.', 'READBACK');
  }
  const observed = {
    rootId: address(decoded.root_id, 'event.rootId'),
    previousRevision: String(decoded.previous_revision),
    revision: String(decoded.revision),
    subjectId: address(decoded.subject_id, 'event.subjectId'),
    operation: Number(decoded.operation),
  };
  const displayed = {
    rootId: moveId(field(event.parsedJson, 'root_id', 'event'), 'event.rootId'),
    previousRevision: decimal(field(event.parsedJson, 'previous_revision', 'event'), 'event.previousRevision'),
    revision: decimal(field(event.parsedJson, 'revision', 'event'), 'event.revision'),
    subjectId: moveId(field(event.parsedJson, 'subject_id', 'event'), 'event.subjectId'),
    operation: Number(decimal(field(event.parsedJson, 'operation', 'event'), 'event.operation')),
  };
  if (canonical(observed) !== canonical(displayed)) {
    fail('MAKER_V8_PACK_LIFECYCLE_EVENT_DRIFT', 'Pack registry event BCS and JSON differ.', 'READBACK');
  }
  return observed;
}

function balance(fields, label) {
  const revenue = field(fields, 'revenue', label);
  return BigInt(decimal(revenue?.fields?.value ?? revenue?.value ?? revenue, `${label}.revenue`));
}

function coinBalance(fields, label) {
  const value = field(fields, 'balance', label);
  return BigInt(decimal(value?.fields?.value ?? value?.value ?? value, `${label}.balance`));
}

export function createMakerV8PackLifecycleReadbackV8({
  client,
  runtime: runtimeInput,
  readFinalized = assertFinalizedMakerV8CompilerTransactionV8,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const types = makerV8ChainTypes(runtime);
  return async ({ request, artifact, transaction, descriptor: durableDescriptor }) => {
    const response = await readFinalized(client, artifact.digest, transaction);
    if (response.compilerTransactionKindProof.transactionKindSha256 !== durableDescriptor.kindSha256) {
      fail('MAKER_V8_PACK_LIFECYCLE_KIND_DRIFT', 'Finalized Pack lifecycle kind differs from exact compiler bytes.', 'READBACK');
    }
    let releaseRef = request.inputs.release.objectRef;
    let adminCapRef = request.inputs.adminCap.objectRef;
    let treasuryRef = request.inputs.treasury.objectRef;
    let releaseOwner = address(
      field(request.inputs.release.fields, 'owner', 'PackRelease'),
      'PackRelease.owner',
    );
    let controlEpoch = decimal(
      field(request.inputs.release.fields, 'control_epoch', 'PackRelease'),
      'PackRelease.controlEpoch',
    );
    let packRegistryRevision = request.pack.packRegistryRevision;
    if (['PAUSE', 'RESUME', 'ARCHIVE'].includes(request.action)) {
      const raw = changedRef(response, request.pack.releaseId, types.packRelease, 'PackRelease');
      const release = await historical(client, raw, types.packRelease, artifact.digest, 'PackRelease');
      const expectedCode = MAKER_V8_PACK_LIFECYCLE_STATES[ACTIONS[request.action].to];
      if (canonicalFields(release.parsed, { lifecycle: field(request.inputs.release.fields, 'lifecycle', 'pre PackRelease') })
          !== canonicalFields(request.inputs.release.fields)
        || Number(decimal(field(release.parsed, 'lifecycle', 'post PackRelease'), 'post PackRelease.lifecycle')) !== expectedCode) {
        fail('MAKER_V8_PACK_LIFECYCLE_RELEASE_DRIFT', 'Final PackRelease changed outside the authorized lifecycle field.', 'READBACK');
      }
      if (response.events.length !== 1) {
        fail('MAKER_V8_PACK_LIFECYCLE_EVENT_INVALID', 'Pack lifecycle transition must emit exactly one event.', 'READBACK');
      }
      const observed = eventFields(response.events[0], request, runtime);
      if (observed.releaseId !== request.pack.releaseId
        || observed.previousLifecycle !== MAKER_V8_PACK_LIFECYCLE_STATES[request.pack.sourceLifecycle]
        || observed.lifecycle !== expectedCode) {
        fail('MAKER_V8_PACK_LIFECYCLE_EVENT_DRIFT', 'Pack lifecycle event differs from the authorized transition.', 'READBACK');
      }
      releaseRef = freeze({ objectId: release.objectId, version: String(release.version), digest: release.digest });
    } else if (request.action === 'TRANSFER_CONTROL') {
      const releaseRaw = changedRef(response, request.pack.releaseId, types.packRelease, 'PackRelease');
      const capRaw = changedRef(response, request.pack.adminCapId, types.packAdminCap, 'PackAdminCap');
      const [release, cap] = await Promise.all([
        historical(client, releaseRaw, types.packRelease, artifact.digest, 'PackRelease'),
        historical(client, capRaw, types.packAdminCap, artifact.digest, 'PackAdminCap'),
      ]);
      const nextEpoch = (BigInt(controlEpoch) + 1n).toString();
      const preRelease = request.inputs.release.fields;
      const preCap = request.inputs.adminCap.fields;
      if (canonicalFields(release.parsed, {
        owner: field(preRelease, 'owner', 'pre PackRelease'),
        control_epoch: field(preRelease, 'control_epoch', 'pre PackRelease'),
      }) !== canonicalFields(preRelease)
        || canonicalFields(cap.parsed, {
          owner: field(preCap, 'owner', 'pre PackAdminCap'),
          control_epoch: field(preCap, 'control_epoch', 'pre PackAdminCap'),
        }) !== canonicalFields(preCap)
        || address(field(release.parsed, 'owner', 'post PackRelease'), 'post PackRelease.owner') !== request.inputs.recipient
        || address(field(cap.parsed, 'owner', 'post PackAdminCap'), 'post PackAdminCap.owner') !== request.inputs.recipient
        || decimal(field(release.parsed, 'control_epoch', 'post PackRelease'), 'post PackRelease.controlEpoch') !== nextEpoch
        || decimal(field(cap.parsed, 'control_epoch', 'post PackAdminCap'), 'post PackAdminCap.controlEpoch') !== nextEpoch
        || response.events.length !== 0) {
        fail('MAKER_V8_PACK_LIFECYCLE_CONTROL_DRIFT', 'Final Pack control transfer changed fields outside owner and control epoch.', 'READBACK');
      }
      releaseRef = freeze({ objectId: release.objectId, version: String(release.version), digest: release.digest });
      adminCapRef = freeze({ objectId: cap.objectId, version: String(cap.version), digest: cap.digest });
      releaseOwner = request.inputs.recipient;
      controlEpoch = nextEpoch;
    } else if (request.action === 'REVOKE_ADMISSION') {
      const registryRaw = changedRef(response, request.pack.packRegistryId, types.packRegistry, 'PackRegistry');
      const registry = await historical(client, registryRaw, types.packRegistry, artifact.digest, 'PackRegistry');
      const pre = request.inputs.packRegistry.fields;
      const nextRevision = (BigInt(request.pack.packRegistryRevision) + 1n).toString();
      if (canonicalFields(registry.parsed, { revision: field(pre, 'revision', 'pre PackRegistry') })
          !== canonicalFields(pre)
        || decimal(field(registry.parsed, 'revision', 'post PackRegistry'), 'post PackRegistry.revision') !== nextRevision
        || response.events.length !== 1) {
        fail('MAKER_V8_PACK_LIFECYCLE_REGISTRY_DRIFT', 'Final PackRegistry does not prove one exact admission revocation CAS.', 'READBACK');
      }
      const observed = registryEventFields(response.events[0], request, runtime);
      if (observed.rootId !== request.pack.rootId
        || observed.previousRevision !== request.pack.packRegistryRevision
        || observed.revision !== nextRevision
        || observed.subjectId !== request.pack.releaseId
        || observed.operation !== 1) {
        fail('MAKER_V8_PACK_LIFECYCLE_EVENT_DRIFT', 'Pack registry event differs from the authorized revocation.', 'READBACK');
      }
      packRegistryRevision = nextRevision;
    } else {
      const raw = changedRef(response, request.pack.treasuryId, types.packTreasury, 'PackTreasury');
      const treasury = await historical(client, raw, types.packTreasury, artifact.digest, 'PackTreasury');
      const pre = request.inputs.treasury.fields;
      const amount = BigInt(request.inputs.amountAtomic);
      if (canonicalFields(treasury.parsed, {
        revenue: field(pre, 'revenue', 'pre PackTreasury'),
        total_withdrawn: field(pre, 'total_withdrawn', 'pre PackTreasury'),
      }) !== canonicalFields(pre)
        || balance(treasury.parsed, 'post PackTreasury') !== balance(pre, 'pre PackTreasury') - amount
        || BigInt(decimal(field(treasury.parsed, 'total_withdrawn', 'post PackTreasury'), 'post PackTreasury.totalWithdrawn'))
          !== BigInt(decimal(field(pre, 'total_withdrawn', 'pre PackTreasury'), 'pre PackTreasury.totalWithdrawn')) + amount
        || response.events.length !== 0) {
        fail('MAKER_V8_PACK_LIFECYCLE_TREASURY_DRIFT', 'Final PackTreasury does not prove exact withdrawal arithmetic.', 'READBACK');
      }
      const expectedCoin = normalizeStructTag(`0x2::coin::Coin<${runtime.paymentCoinType}>`);
      const recipientWrites = response.objectChanges.filter((change) => (
        change.type === 'created' && normalizeStructTag(change.objectType) === expectedCoin
        && response.compilerEffectsOutputRefs.some((entry) => (
          entry.objectId === change.objectId
          && entry.owner?.kind === 'AddressOwner'
          && entry.owner?.value === request.inputs.recipient
        ))
      ));
      if (recipientWrites.length !== 1) {
        fail('MAKER_V8_PACK_LIFECYCLE_RECIPIENT_DRIFT', 'Pack withdrawal did not create one exact recipient Coin.', 'READBACK');
      }
      const coinRaw = changedRef(response, recipientWrites[0].objectId, expectedCoin, 'withdrawn Coin');
      const coin = await historical(client, coinRaw, expectedCoin, artifact.digest, 'withdrawn Coin');
      if (coinBalance(coin.parsed, 'withdrawn Coin') !== amount) {
        fail('MAKER_V8_PACK_LIFECYCLE_RECIPIENT_DRIFT', 'Recipient Coin value differs from the exact withdrawal amount.', 'READBACK');
      }
      treasuryRef = freeze({ objectId: treasury.objectId, version: String(treasury.version), digest: treasury.digest });
    }
    return freeze({
      schemaVersion: MAKER_V8_PACK_CHAIN_READBACK_SCHEMA,
      rootId: request.pack.rootId,
      packRegistryId: request.pack.packRegistryId,
      semanticPackId: request.pack.semanticPackId,
      release: freeze({
        objectRef: releaseRef,
        owner: releaseOwner,
        controlEpoch,
      }),
      adminCap: freeze({
        objectRef: adminCapRef,
        releaseId: request.pack.releaseId,
        owner: releaseOwner,
        controlEpoch,
      }),
      treasury: freeze({ objectRef: treasuryRef, releaseId: request.pack.releaseId }),
      lifecycle: ACTIONS[request.action].to ?? request.pack.sourceLifecycle,
      packRegistryRevision,
      finalizedDigest: artifact.digest,
    });
  };
}

function accountAddress(value) {
  return address(typeof value === 'string' ? value : value?.address, 'connected wallet');
}

export function createMakerV8PackLifecycleAuthorityLoaderV8({
  client,
  runtime: runtimeInput,
  wallet,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const types = makerV8ChainTypes(runtime);
  if (typeof wallet?.getCurrentAccount !== 'function') {
    fail('MAKER_V8_PACK_LIFECYCLE_WALLET_INVALID', 'Pack lifecycle requires Wallet Standard account readback.', 'CONFIGURATION');
  }
  const read = async (objectId, type, label) => {
    const current = currentObject(await client.getObject({
      id: objectId,
      options: { showType: true, showContent: true, showOwner: true, showBcs: true },
    }), type, objectId, label);
    const historicalValue = await client.getHistoricalObject({
      objectId,
      version: BigInt(current.objectRef.version),
    });
    if (!plain(historicalValue)
      || historicalValue.objectId !== current.objectRef.objectId
      || String(historicalValue.version) !== current.objectRef.version
      || historicalValue.digest !== current.objectRef.digest
      || normalizeStructTag(historicalValue.type) !== normalizeStructTag(type)
      || !plain(historicalValue.parsed)
      || canonical(historicalValue.parsed) !== canonical(current.fields)
      || !(historicalValue.contentBcs instanceof Uint8Array)
      || !(historicalValue.objectBcs instanceof Uint8Array)) {
      fail('MAKER_V8_PACK_LIFECYCLE_CURRENT_BCS_DRIFT', `${label} current JSON/ref differs from exact historical BCS.`, 'READBACK');
    }
    return current;
  };
  return async (raw) => {
    if (raw?.schemaVersion === MAKER_V8_PACK_LIFECYCLE_REQUEST_SCHEMA) {
      const durable = assertRequest(raw);
      raw = {
        action: durable.action,
        draftRevision: durable.draftRevision,
        amountAtomic: durable.inputs.amountAtomic,
        recipient: durable.inputs.recipient,
        pack: {
          draftId: durable.draftId,
          rootId: durable.pack.rootId,
          packRegistryId: durable.pack.packRegistryId,
          semanticPackId: durable.pack.semanticPackId,
          bindings: durable.inputs.root === null ? null : {
            root: { objectRef: durable.inputs.root.objectRef },
            makerAdmin: { objectRef: durable.inputs.makerAdmin.objectRef },
            definitionRegistry: { objectRef: durable.inputs.definitionRegistry.objectRef },
            admissionAuthority: { objectRef: durable.inputs.admissionAuthority.objectRef },
          },
          chain: {
            release: { objectRef: durable.inputs.release.objectRef },
            adminCap: { objectRef: durable.inputs.adminCap.objectRef },
            treasury: { objectRef: durable.inputs.treasury.objectRef },
            lifecycle: durable.pack.sourceLifecycle,
            packRegistryRevision: durable.pack.packRegistryRevision,
          },
        },
      };
    }
    if (!plain(raw) || !plain(raw.pack?.chain) || !Object.hasOwn(ACTIONS, raw.action)) {
      fail('MAKER_V8_PACK_LIFECYCLE_INPUT_INVALID', 'Pack lifecycle build input is invalid.', 'INPUT');
    }
    const signer = accountAddress(await wallet.getCurrentAccount());
    const chain = raw.pack.chain;
    const releaseId = address(chain.release?.objectRef?.objectId, 'chain.releaseId');
    const adminCapId = address(chain.adminCap?.objectRef?.objectId, 'chain.adminCapId');
    const treasuryId = address(chain.treasury?.objectRef?.objectId, 'chain.treasuryId');
    const packRegistryId = address(raw.pack.packRegistryId, 'pack.packRegistryId');
    const [release, adminCap, treasury, packRegistry] = await Promise.all([
      read(releaseId, types.packRelease, 'PackRelease'),
      read(adminCapId, types.packAdminCap, 'PackAdminCap'),
      read(treasuryId, types.packTreasury, 'PackTreasury'),
      read(packRegistryId, types.packRegistry, 'PackRegistry'),
    ]);
    const sourceLifecycle = lifecycleName(decimal(field(release.fields, 'lifecycle', 'PackRelease'), 'PackRelease.lifecycle'));
    if (sourceLifecycle === null || sourceLifecycle !== chain.lifecycle) {
      fail('MAKER_V8_PACK_LIFECYCLE_STATE_DRIFT', 'Live Pack lifecycle differs from the certified Pack draft.', 'CONTEXT');
    }
    assertSourceLifecycle(raw.action, sourceLifecycle);
    const controlEpoch = decimal(field(release.fields, 'control_epoch', 'PackRelease'), 'PackRelease.controlEpoch');
    const packOwner = address(field(release.fields, 'owner', 'PackRelease'), 'PackRelease.owner');
    const packControlled = raw.action !== 'REVOKE_ADMISSION';
    if (release.owner.kind !== 'SHARED' || adminCap.owner.kind !== 'ADDRESS'
      || adminCap.owner.address !== packOwner || treasury.owner.kind !== 'SHARED'
      || packRegistry.owner.kind !== 'SHARED'
      || moveId(field(release.fields, 'root_id', 'PackRelease'), 'PackRelease.rootId') !== address(raw.pack.rootId, 'pack.rootId')
      || moveId(field(release.fields, 'admin_cap_id', 'PackRelease'), 'PackRelease.adminCapId') !== adminCapId
      || moveId(field(release.fields, 'treasury_id', 'PackRelease'), 'PackRelease.treasuryId') !== treasuryId
      || moveText(field(release.fields, 'semantic_pack_id', 'PackRelease'), 'PackRelease.semanticPackId') !== raw.pack.semanticPackId
      || (packControlled && packOwner !== signer)
      || moveId(field(adminCap.fields, 'release_id', 'PackAdminCap'), 'PackAdminCap.releaseId') !== releaseId
      || address(field(adminCap.fields, 'owner', 'PackAdminCap'), 'PackAdminCap.owner') !== packOwner
      || decimal(field(adminCap.fields, 'control_epoch', 'PackAdminCap'), 'PackAdminCap.controlEpoch') !== controlEpoch
      || moveId(field(treasury.fields, 'release_id', 'PackTreasury'), 'PackTreasury.releaseId') !== releaseId
      || moveId(field(packRegistry.fields, 'root_id', 'PackRegistry'), 'PackRegistry.rootId') !== address(raw.pack.rootId, 'pack.rootId')
      || decimal(field(packRegistry.fields, 'revision', 'PackRegistry'), 'PackRegistry.revision') !== String(chain.packRegistryRevision)) {
      fail('MAKER_V8_PACK_LIFECYCLE_AUTHORITY_DRIFT', 'Live Pack control objects differ from the certified publication chain.', 'CONTEXT');
    }
    if (canonical(release.objectRef) !== canonical(chain.release.objectRef)
      || canonical(adminCap.objectRef) !== canonical(chain.adminCap.objectRef)
      || canonical(treasury.objectRef) !== canonical(chain.treasury.objectRef)) {
      fail('MAKER_V8_PACK_LIFECYCLE_OBJECT_REF_DRIFT', 'Live Pack control refs changed before lifecycle preparation.', 'CONTEXT');
    }
    let admissionAuthority = null;
    let definitionRegistry = null;
    let root = null;
    let makerAdmin = null;
    if (raw.action === 'REVOKE_ADMISSION') {
      const bindings = raw.pack.bindings;
      const bindingId = (name) => address(
        bindings?.[name]?.objectRef?.objectId,
        `pack.bindings.${name}.objectId`,
      );
      const rootId = bindingId('root');
      const makerAdminId = bindingId('makerAdmin');
      const definitionRegistryId = bindingId('definitionRegistry');
      const admissionAuthorityId = bindingId('admissionAuthority');
      if (rootId !== address(raw.pack.rootId, 'pack.rootId')) {
        fail('MAKER_V8_PACK_LIFECYCLE_AUTHORITY_DRIFT', 'Pack governance Root differs from the certified Pack Root.', 'CONTEXT');
      }
      [root, makerAdmin, definitionRegistry, admissionAuthority] = await Promise.all([
        read(rootId, types.root, 'MakerRoot'),
        read(makerAdminId, types.adminCap, 'MakerAdminCap'),
        read(definitionRegistryId, types.runtimeDefinitions, 'RuntimeDefinitionRegistry'),
        read(admissionAuthorityId, types.packAdmissionAuthority, 'PackAdmissionAuthority'),
      ]);
      const rootEpoch = decimal(field(root.fields, 'control_epoch', 'MakerRoot'), 'MakerRoot.controlEpoch');
      if (root.owner.kind !== 'SHARED' || makerAdmin.owner.kind !== 'ADDRESS'
        || definitionRegistry.owner.kind !== 'SHARED' || admissionAuthority.owner.kind !== 'SHARED'
        || makerAdmin.owner.address !== signer
        || address(field(root.fields, 'owner', 'MakerRoot'), 'MakerRoot.owner') !== signer
        || moveId(field(root.fields, 'admin_cap_id', 'MakerRoot'), 'MakerRoot.adminCapId') !== makerAdminId
        || moveId(field(makerAdmin.fields, 'root_id', 'MakerAdminCap'), 'MakerAdminCap.rootId') !== rootId
        || address(field(makerAdmin.fields, 'owner', 'MakerAdminCap'), 'MakerAdminCap.owner') !== signer
        || decimal(field(makerAdmin.fields, 'control_epoch', 'MakerAdminCap'), 'MakerAdminCap.controlEpoch') !== rootEpoch
        || moveId(field(definitionRegistry.fields, 'root_id', 'RuntimeDefinitionRegistry'), 'RuntimeDefinitionRegistry.rootId') !== rootId
        || moveId(field(admissionAuthority.fields, 'root_id', 'PackAdmissionAuthority'), 'PackAdmissionAuthority.rootId') !== rootId
        || moveId(field(packRegistry.fields, 'definition_registry_id', 'PackRegistry'), 'PackRegistry.definitionRegistryId') !== definitionRegistryId
        || moveId(field(packRegistry.fields, 'admission_authority_id', 'PackRegistry'), 'PackRegistry.admissionAuthorityId') !== admissionAuthorityId) {
        fail('MAKER_V8_PACK_LIFECYCLE_AUTHORITY_DRIFT', 'Live Maker governance differs from the exact Pack admission tuple.', 'CONTEXT');
      }
    }
    const amountAtomic = raw.action === 'WITHDRAW_PACK_REVENUE'
      ? decimal(raw.amountAtomic, 'amountAtomic', { positive: true }) : null;
    const recipient = ['WITHDRAW_PACK_REVENUE', 'TRANSFER_CONTROL'].includes(raw.action)
      ? address(raw.recipient ?? signer, 'recipient') : null;
    if (amountAtomic !== null && BigInt(amountAtomic) > balance(treasury.fields, 'PackTreasury')) {
      fail('MAKER_V8_PACK_LIFECYCLE_BALANCE_INVALID', 'Pack withdrawal exceeds the exact live treasury balance.', 'STATE');
    }
    const pack = freeze({
      rootId: address(raw.pack.rootId, 'pack.rootId'),
      packRegistryId,
      semanticPackId: raw.pack.semanticPackId,
      packRegistryRevision: decimal(chain.packRegistryRevision, 'packRegistryRevision', { positive: true }),
      sourceLifecycle,
      releaseId,
      adminCapId,
      treasuryId,
    });
    const inputs = freeze({
      release, adminCap, treasury, packRegistry,
      admissionAuthority, definitionRegistry, root, makerAdmin,
      amountAtomic, recipient,
    });
    return buildMakerV8PackLifecycleRequestV8({
      draftId: raw.pack.draftId,
      draftRevision: raw.draftRevision ?? 1,
      action: raw.action,
      signer,
      pack,
      inputs,
    });
  };
}

export function createMakerV8PackLifecycleControllerV8({
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
  const compiler = createMakerV8PackLifecycleCompilerV8({ runtime, loadFreshRequest: loadRequest, certifyFinalized });
  const engine = createMakerV8PackPublicationControllerV8({
    persistence,
    compiler,
    boundary,
    wallet,
    rpc,
    oneShot: true,
    execution,
    ...(now === undefined ? {} : { now }),
  });
  const gates = freeze({
    allowWalletSignature: execution?.allowWalletSignature === true,
    allowBroadcast: execution?.allowBroadcast === true,
  });
  return freeze({
    schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
    execution: gates,
    build: (input) => loadRequest(input),
    async prepare(builtInput) {
      const request = assertRequest(await builtInput);
      let plan = await engine.prepare(request);
      if (plan.status === 'ACTIVE' && plan.current?.outcome.status === 'READY') {
        plan = await engine.requestSignature(plan.attemptId);
      }
      const digestValue = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (typeof digestValue !== 'string') {
        fail('MAKER_V8_PACK_LIFECYCLE_SIGNATURE_REQUIRED', 'Pack lifecycle preparation did not durably persist one signed digest.', 'RECOVERY');
      }
      return freeze({
        schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
        recoveryId: plan.attemptId,
        digest: digestValue,
      });
    },
    async recover(ticket) {
      exact(ticket, ['schemaVersion', 'recoveryId', 'digest'], 'Pack lifecycle ticket');
      if (ticket.schemaVersion !== MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA) {
        fail('MAKER_V8_PACK_LIFECYCLE_TICKET_INVALID', 'Pack lifecycle ticket has another schema.', 'RECOVERY');
      }
      digest(ticket.digest, 'ticket.digest');
      let plan = await engine.recoverOutcome(ticket.recoveryId);
      const observedDigest = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (observedDigest !== ticket.digest) {
        fail('MAKER_V8_PACK_LIFECYCLE_TICKET_DRIFT', 'Pack lifecycle durable attempt has another digest.', 'RECOVERY');
      }
      if (plan.status === 'ACTIVE'
        && plan.current?.outcome.status === 'OUTCOME_PENDING'
        && plan.current.outcome.code === 'TYPED_GRPC_NOT_FOUND') {
        plan = await engine.replayExact(ticket.recoveryId);
      }
      if (plan.status === 'COMPLETE') {
        return freeze({
          schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
          status: 'FINALIZED_SUCCESS',
          recoveryId: ticket.recoveryId,
          digest: ticket.digest,
          readback: freeze(clone(plan.terminal.chain)),
        });
      }
      if (plan.status === 'FAILED') {
        return freeze({
          schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
          status: 'FINALIZED_FAILURE',
          recoveryId: ticket.recoveryId,
          digest: ticket.digest,
          readback: null,
        });
      }
      return freeze({
        schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
        status: 'OUTCOME_UNKNOWN',
        recoveryId: ticket.recoveryId,
        digest: ticket.digest,
        readback: null,
      });
    },
  });
}

export async function createProductionMakerV8PackLifecycleV8({
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
  const loadRequest = createMakerV8PackLifecycleAuthorityLoaderV8({
    client, runtime, wallet, assertTransport,
  });
  const persistence = createMakerV8PackPublicationPersistenceV8(indexedDB, {
    databaseName: MAKER_V8_PACK_LIFECYCLE_DATABASE,
    ...persistenceOptions,
  });
  const certifyFinalized = createMakerV8PackLifecycleReadbackV8({
    client, runtime, assertTransport,
  });
  const compiler = createMakerV8PackLifecycleCompilerV8({ runtime, loadFreshRequest: loadRequest, certifyFinalized });
  const boundary = createMakerV8PackPublicationBoundaryV8({
    client,
    compilerAuthority: compiler.authority,
    execution,
    assertCompilerTransaction: assertMakerV8PackLifecycleCompilerTransactionV8,
    assertSignedArtifact: assertMakerV8PackLifecycleSignedArtifactV8,
    assertTransport,
  });
  const engine = createMakerV8PackPublicationControllerV8({
    persistence,
    compiler,
    boundary,
    wallet,
    rpc,
    oneShot: true,
    execution,
    ...(now === undefined ? {} : { now }),
  });
  const controller = freeze({
    schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
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
      const digestValue = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (typeof digestValue !== 'string') fail('MAKER_V8_PACK_LIFECYCLE_SIGNATURE_REQUIRED', 'Pack lifecycle signature was not durably persisted.', 'RECOVERY');
      return freeze({ schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA, recoveryId: plan.attemptId, digest: digestValue });
    },
    async recover(ticket) {
      exact(ticket, ['schemaVersion', 'recoveryId', 'digest'], 'Pack lifecycle ticket');
      let plan = await engine.recoverOutcome(ticket.recoveryId);
      const observedDigest = plan.current?.outcome?.digest ?? plan.terminal?.digest;
      if (ticket.schemaVersion !== MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA || observedDigest !== ticket.digest) {
        fail('MAKER_V8_PACK_LIFECYCLE_TICKET_DRIFT', 'Pack lifecycle durable attempt differs from its ticket.', 'RECOVERY');
      }
      if (plan.status === 'ACTIVE' && plan.current?.outcome.status === 'OUTCOME_PENDING'
        && plan.current.outcome.code === 'TYPED_GRPC_NOT_FOUND') {
        plan = await engine.replayExact(ticket.recoveryId);
      }
      return freeze({
        schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
        status: plan.status === 'COMPLETE' ? 'FINALIZED_SUCCESS'
          : plan.status === 'FAILED' ? 'FINALIZED_FAILURE' : 'OUTCOME_UNKNOWN',
        recoveryId: ticket.recoveryId,
        digest: ticket.digest,
        readback: plan.status === 'COMPLETE' ? freeze(clone(plan.terminal.chain)) : null,
      });
    },
  });
  return freeze({
    schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
    runtime,
    persistence,
    compiler,
    boundary,
    controller,
  });
}
