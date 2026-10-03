import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58, fromBase64, normalizeStructTag, toBase58, toBase64, deriveDynamicFieldID,
} from '@mysten/sui/utils';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8ChainTypes,
} from './maker-v8-chain.js';
import {
  assertFinalizedMakerV8CompilerTransactionV8,
} from './maker-v8-browser.js';
import {
  MAKER_V8_PACK_CHAIN_READBACK_SCHEMA,
} from './maker-v8-pack-controller.js';
import {
  MAKER_V8_PACK_CHECKPOINT_SCHEMA,
  assertMakerV8PackCompilerTransactionV8,
  assertMakerV8PackSignedArtifactV8,
} from './maker-v8-pack-compiler.js';
import {
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  assertMakerV8SuiGrpcTransport,
} from './maker-v8-sui-grpc.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';
import { buildMakerV8PackDefinitionStepV8 } from './maker-v8-pack-definitions-compiler.js';
import { MAKER_V8_PACK_DEFINITIONS_BCS, MAKER_V8_PACK_DEFINITIONS_DRAFT_BCS,
  MAKER_V8_COLOR_CHANNEL_DRAFT_BCS_V2 } from './maker-v8-pack-definition-wire.js';

export const MAKER_V8_PACK_PUBLICATION_ADAPTERS_SCHEMA =
  'animacraft.maker-v8-pack-publication-adapters.v1';

const EXACT_ID = /^0x[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;

export class MakerV8PackPublicationAdaptersError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MakerV8PackPublicationAdaptersError';
    this.code = code;
    if (details !== undefined) this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, details) {
  throw new MakerV8PackPublicationAdaptersError(code, message, details);
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
  if (!plain(value)) fail('MAKER_V8_PACK_ADAPTER_SHAPE_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PACK_ADAPTER_SHAPE_INVALID', `${label} has fields outside its exact schema.`, {
      actual, expected,
    });
  }
  return value;
}

function address(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!EXACT_ID.test(normalized) || /^0x0+$/.test(normalized)) {
    fail('MAKER_V8_PACK_ADAPTER_ID_INVALID', `${label} must be one canonical non-zero Sui ID.`);
  }
  return normalized;
}

function decimal(value, label) {
  const text = String(value ?? '');
  if (!UINT.test(text)) fail('MAKER_V8_PACK_ADAPTER_INTEGER_INVALID', `${label} must be one canonical u64.`);
  return text;
}

function suiDigest(value, label) {
  try {
    const bytes = fromBase58(value);
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('digest');
  } catch {
    fail('MAKER_V8_PACK_ADAPTER_DIGEST_INVALID', `${label} must be one canonical Sui digest.`);
  }
  return value;
}

function canonicalBase64(value, label) {
  try {
    if (typeof value !== 'string' || !value.length) throw new Error('shape');
    const bytes = fromBase64(value);
    if (toBase64(bytes) !== value) throw new Error('canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_PACK_ADAPTER_BASE64_INVALID', `${label} must be non-empty canonical Base64.`);
  }
}

function sameBytes(left, right) {
  return left.length === right.length
    && left.every((byte, index) => byte === right[index]);
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function transactionKind(value, label) {
  const raw = canonicalBase64(value, label);
  let parsed; let roundtrip;
  try {
    parsed = bcs.TransactionKind.parse(raw);
    roundtrip = bcs.TransactionKind.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PACK_ADAPTER_KIND_INVALID', `${label} is not canonical TransactionKind BCS.`);
  }
  if (parsed?.$kind !== 'ProgrammableTransaction' || !sameBytes(raw, roundtrip)) {
    fail('MAKER_V8_PACK_ADAPTER_KIND_INVALID', `${label} is not a canonical programmable transaction.`);
  }
  return freeze({ raw, base64: value, sha256: hashBytes(raw) });
}

function transactionData(value, expected) {
  const raw = canonicalBase64(value, 'Pack TransactionData');
  let parsed; let roundtrip;
  try {
    parsed = bcs.TransactionData.parse(raw);
    roundtrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PACK_ADAPTER_TRANSACTION_INVALID', 'Pack TransactionData is not canonical BCS.');
  }
  if (parsed?.$kind !== 'V1' || !sameBytes(raw, roundtrip)) {
    fail('MAKER_V8_PACK_ADAPTER_TRANSACTION_INVALID', 'Pack TransactionData must be canonical V1 BCS.');
  }
  const kind = toBase64(bcs.TransactionKind.serialize(parsed.V1.kind).toBytes());
  const digest = TransactionDataBuilder.getDigestFromBytes(raw);
  if (parsed.V1.sender !== expected.signer || parsed.V1.gasData?.owner !== expected.signer
    || kind !== expected.kindBytes || expected.digest !== undefined && digest !== expected.digest) {
    fail('MAKER_V8_PACK_ADAPTER_TRANSACTION_DRIFT', 'Pack TransactionData differs from its exact signer, kind, or digest.');
  }
  return freeze({ raw, base64: value, digest });
}

function executionConfig(value) {
  const checked = value ?? {};
  if (checked.network !== undefined && checked.network !== MAKER_V8_CHAIN_NETWORK
    || checked.chainIdentifier !== undefined
      && checked.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || (checked.allowWalletSignature === true) !== (checked.allowBroadcast === true)) {
    fail('MAKER_V8_PACK_ADAPTER_EXECUTION_INVALID', 'Pack execution must be one paired Mainnet gate.');
  }
  return freeze({
    network: MAKER_V8_CHAIN_NETWORK,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: checked.allowWalletSignature === true,
    allowBroadcast: checked.allowBroadcast === true,
  });
}

async function assertPinnedMainnet(client) {
  const result = await client.getChainIdentifier();
  const observed = typeof result === 'string' ? result : result?.chainIdentifier;
  if (observed !== MAKER_V8_SUI_MAINNET_GENESIS_DIGEST) {
    fail('MAKER_V8_PACK_ADAPTER_NETWORK_DRIFT', 'Pack publication transport is not pinned to Sui Mainnet.');
  }
}

/** Exact compiler Transaction -> canonical TransactionData -> gRPC simulation/execution. */
export function createMakerV8PackPublicationBoundaryV8({
  client,
  compilerAuthority,
  execution,
  assertCompilerTransaction = assertMakerV8PackCompilerTransactionV8,
  assertSignedArtifact = assertMakerV8PackSignedArtifactV8,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  if (!plain(compilerAuthority)) {
    fail('MAKER_V8_PACK_ADAPTER_COMPILER_AUTHORITY_REQUIRED', 'Pack boundary requires its exact in-process compiler authority.');
  }
  if (typeof assertCompilerTransaction !== 'function' || typeof assertSignedArtifact !== 'function') {
    fail('MAKER_V8_PACK_ADAPTER_COMPILER_AUTHORITY_REQUIRED', 'Pack boundary requires exact compiler transaction and signed-artifact assertions.');
  }
  const gates = executionConfig(execution);
  const builds = new Map();

  return freeze({
    schemaVersion: MAKER_V8_PACK_PUBLICATION_ADAPTERS_SCHEMA,
    execution: gates,

    async buildExactTransaction(input) {
      exact(input, ['transaction', 'descriptor', 'sender'], 'Pack build request');
      const signer = address(input.sender, 'Pack signer');
      const expectedKind = transactionKind(input.descriptor?.kindBytes, 'Pack descriptor kind');
      assertCompilerTransaction(compilerAuthority, input.transaction, {
        signer,
        kindBytes: expectedKind.base64,
        kindSha256: expectedKind.sha256,
      });
      if (!(input.transaction instanceof Transaction)
        || input.transaction.getData().sender !== signer
        || input.descriptor.kindSha256 !== expectedKind.sha256) {
        fail('MAKER_V8_PACK_ADAPTER_COMPILER_DRIFT', 'Pack compiler transaction differs before gas resolution.');
      }
      await assertPinnedMainnet(client);
      const state = await client.core.getCurrentSystemState();
      const epoch = decimal(state?.systemState?.epoch, 'current epoch');
      input.transaction.setExpiration({ Epoch: (BigInt(epoch) + 1n).toString() });
      const raw = await input.transaction.build({ client });
      await assertPinnedMainnet(client);
      const rebuiltKind = toBase64(await input.transaction.build({ onlyTransactionKind: true }));
      if (rebuiltKind !== expectedKind.base64) {
        fail('MAKER_V8_PACK_ADAPTER_COMPILER_DRIFT', 'Gas resolution changed the exact Pack TransactionKind.');
      }
      const proof = transactionData(toBase64(raw), { signer, kindBytes: expectedKind.base64 });
      builds.set(proof.digest, freeze({
        bytes: proof.base64,
        signer,
        kindBytes: expectedKind.base64,
        kindSha256: expectedKind.sha256,
      }));
      while (builds.size > 32) builds.delete(builds.keys().next().value);
      return freeze({ bytes: proof.base64, digest: proof.digest });
    },

    async dryRunExactTransaction(input) {
      exact(input, [
        'transaction', 'descriptor', 'transactionBytes', 'digest',
      ], 'Pack dry-run request');
      const expectedKind = transactionKind(input.descriptor?.kindBytes, 'Pack descriptor kind');
      const proof = transactionData(input.transactionBytes, {
        signer: input.descriptor.signer,
        kindBytes: expectedKind.base64,
        digest: input.digest,
      });
      const built = builds.get(proof.digest);
      assertCompilerTransaction(compilerAuthority, input.transaction, {
        signer: input.descriptor.signer,
        kindBytes: expectedKind.base64,
        kindSha256: expectedKind.sha256,
      });
      if (!built || built.bytes !== proof.base64 || built.signer !== input.descriptor.signer
        || built.kindBytes !== expectedKind.base64) {
        fail('MAKER_V8_PACK_ADAPTER_BUILD_PROOF_REQUIRED', 'Pack dry-run requires one freshly built exact compiler transaction.');
      }
      await assertPinnedMainnet(client);
      const result = await client.core.simulateTransaction({
        transaction: proof.raw,
        include: { effects: true, bcs: true },
      });
      await assertPinnedMainnet(client);
      const simulated = result?.$kind === 'Transaction' ? result.Transaction
        : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
      if (!simulated || simulated.digest !== proof.digest
        || !(simulated.bcs instanceof Uint8Array)
        || toBase64(simulated.bcs) !== proof.base64
        || simulated.effects?.transactionDigest !== proof.digest) {
        fail('MAKER_V8_PACK_ADAPTER_SIMULATION_DRIFT', 'Pack simulation did not echo the exact TransactionData and digest.');
      }
      const success = result.$kind === 'Transaction'
        && simulated.status?.success === true && simulated.effects?.status?.success === true;
      return freeze({ status: success ? 'SUCCESS' : 'FAILURE' });
    },

    async broadcastExactTransaction(input) {
      exact(input, ['bytes', 'signature', 'digest', 'signer'], 'Pack broadcast request');
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail('MAKER_V8_PACK_ADAPTER_EXECUTION_DISABLED', 'Pack exact-byte broadcast is disabled.');
      }
      const signer = address(input.signer, 'Pack signer');
      const built = assertSignedArtifact(compilerAuthority, {
        digest: input.digest, bytes: input.bytes, signature: input.signature, signer,
      });
      const proof = transactionData(input.bytes, {
        signer, kindBytes: built.kindBytes, digest: input.digest,
      });
      canonicalBase64(input.signature, 'Pack signature');
      await assertPinnedMainnet(client);
      if (!await isValidTransactionSignature(proof.raw, input.signature, { client, address: signer })) {
        fail('MAKER_V8_PACK_ADAPTER_SIGNATURE_INVALID', 'Pack signature does not authenticate exact TransactionData.');
      }
      const result = await client.core.executeTransaction({
        transaction: proof.raw,
        signatures: [input.signature],
        include: { effects: true, events: true, objectTypes: true },
      });
      await assertPinnedMainnet(client);
      const executed = result?.$kind === 'Transaction' ? result.Transaction
        : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
      if (!executed || executed.digest !== proof.digest
        || executed.effects?.transactionDigest !== proof.digest) {
        fail('MAKER_V8_PACK_ADAPTER_BROADCAST_DRIFT', 'Pack execution returned another transaction digest.');
      }
      return freeze({ accepted: true, digest: proof.digest });
    },
  });
}

function field(fields, name, label) {
  if (!plain(fields)) fail('MAKER_V8_PACK_READBACK_FIELDS_INVALID', `${label} has no exact Move fields.`);
  if (Object.hasOwn(fields, name)) return fields[name];
  const snake = name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  if (Object.hasOwn(fields, snake)) return fields[snake];
  fail('MAKER_V8_PACK_READBACK_FIELD_MISSING', `${label}.${snake} is missing.`);
}

function moveId(value, label) {
  if (typeof value === 'string') return address(value, label);
  if (plain(value) && typeof value.id === 'string') return address(value.id, label);
  if (plain(value?.fields)) return moveId(value.fields, label);
  fail('MAKER_V8_PACK_READBACK_ID_INVALID', `${label} is not one exact Move ID.`);
}

function hash(value, label) {
  if (Array.isArray(value) && value.length === 32
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return value.map((entry) => entry.toString(16).padStart(2, '0')).join('');
  }
  const normalized = String(value ?? '').replace(/^0x/, '').toLowerCase();
  if (!HASH.test(normalized)) fail('MAKER_V8_PACK_READBACK_HASH_INVALID', `${label} is not one exact 32-byte value.`);
  return normalized;
}

function text(value, label) {
  const result = typeof value === 'string' ? value : value?.fields?.bytes ?? value?.bytes;
  if (typeof result !== 'string') fail('MAKER_V8_PACK_READBACK_TEXT_INVALID', `${label} is not one Move string.`);
  return result;
}

function outputChange(response, expectedType, label, expectedId = null) {
  const normalized = normalizeStructTag(expectedType);
  const matches = response.objectChanges.filter((change) => (
    ['created', 'mutated'].includes(change.type)
    && (expectedId === null || change.objectId === expectedId)
    && normalizeStructTag(change.objectType) === normalized
  ));
  if (matches.length !== 1) {
    fail('MAKER_V8_PACK_READBACK_CARDINALITY_INVALID', `${label} requires one exact finalized object write.`, {
      observed: matches.length,
    });
  }
  const change = matches[0];
  const raw = response.compilerEffectsOutputRefs.filter((entry) => entry.objectId === change.objectId);
  if (raw.length !== 1 || raw[0].version !== change.version || raw[0].digest !== change.digest) {
    fail('MAKER_V8_PACK_READBACK_EFFECTS_DRIFT', `${label} Core object change differs from raw TransactionEffects.`);
  }
  return raw[0];
}

async function historical(client, ref, expectedType, transactionDigest, label) {
  const value = await client.getHistoricalObject({
    objectId: ref.objectId,
    version: BigInt(ref.version),
  });
  if (!plain(value) || value.objectId !== ref.objectId || value.version !== ref.version
    || value.digest !== ref.digest || value.previousTransaction !== transactionDigest
    || normalizeStructTag(value.type) !== normalizeStructTag(expectedType)
    || !plain(value.parsed) || !(value.contentBcs instanceof Uint8Array)
    || !(value.objectBcs instanceof Uint8Array)) {
    fail('MAKER_V8_PACK_READBACK_HISTORY_DRIFT', `${label} historical BCS/JSON/ref differs from finalized effects.`);
  }
  return value;
}

function sharedInput(object, label) {
  const initial = object.owner?.Shared?.initial_shared_version
    ?? object.owner?.Shared?.initialSharedVersion;
  return freeze({
    kind: 'shared',
    objectId: object.objectId,
    initialSharedVersion: decimal(initial, `${label}.initialSharedVersion`),
  });
}

function ownedInput(object, expectedOwner, label) {
  const owner = object.owner?.AddressOwner;
  if (owner !== expectedOwner) fail('MAKER_V8_PACK_READBACK_OWNER_DRIFT', `${label} has another owner.`);
  return freeze({
    kind: 'owned', objectId: object.objectId, version: object.version, digest: object.digest,
  });
}

function objectRef(object) {
  return freeze({ objectId: object.objectId, version: object.version, digest: object.digest });
}

function validateRelease(object, compiled, descriptor, expectedLifecycle) {
  const fields = object.parsed;
  const document = compiled.document;
  if (decimal(field(fields, 'version', 'PackRelease'), 'PackRelease.version') !== '8'
    || moveId(field(fields, 'rootId', 'PackRelease'), 'PackRelease.rootId')
      !== document.bindings.root.objectRef.objectId
    || decimal(field(fields, 'rootVersion', 'PackRelease'), 'PackRelease.rootVersion')
      !== document.bindings.root.makerVersion
    || hash(field(fields, 'rootContentCommitment', 'PackRelease'), 'PackRelease.rootContentCommitment')
      !== document.bindings.root.contentCommitment
    || address(field(fields, 'creator', 'PackRelease'), 'PackRelease.creator') !== compiled.signer
    || address(field(fields, 'owner', 'PackRelease'), 'PackRelease.owner') !== compiled.signer
    || decimal(field(fields, 'controlEpoch', 'PackRelease'), 'PackRelease.controlEpoch') !== '0'
    || text(field(fields, 'semanticPackId', 'PackRelease'), 'PackRelease.semanticPackId')
      !== document.metadata.semanticPackId
    || text(field(fields, 'manifestBlobId', 'PackRelease'), 'PackRelease.manifestBlobId')
      !== compiled.transport.manifest.blobId
    || hash(field(fields, 'manifestSha256', 'PackRelease'), 'PackRelease.manifestSha256')
      !== compiled.transport.manifest.sha256
    || hash(field(fields, 'contentCommitment', 'PackRelease'), 'PackRelease.contentCommitment')
      !== compiled.contentCommitment
    || Number(decimal(field(fields, 'lifecycle', 'PackRelease'), 'PackRelease.lifecycle')) !== expectedLifecycle
    || decimal(field(fields, 'expectedStyleCount', 'PackRelease'), 'PackRelease.expectedStyleCount')
      !== String(document.styles.length)
    || decimal(field(fields, 'observedStyleCount', 'PackRelease'), 'PackRelease.observedStyleCount')
      !== String(descriptor.endStyle)
    || hash(field(fields, 'expectedStyleCommitment', 'PackRelease'), 'PackRelease.expectedStyleCommitment')
      !== compiled.expectedStyleCommitment
    || hash(field(fields, 'rollingStyleCommitment', 'PackRelease'), 'PackRelease.rollingStyleCommitment')
      !== compiled.rollingCommitments[descriptor.endStyle]
    || decimal(field(fields, 'protectedStyleCount', 'PackRelease'), 'PackRelease.protectedStyleCount')
      !== String(compiled.document.styles.slice(0, descriptor.endStyle)
        .filter((style) => style.asset.protected).length)) {
    fail('MAKER_V8_PACK_READBACK_RELEASE_DRIFT', 'Finalized PackRelease differs from the exact compiled Pack.');
  }
  return fields;
}

function validateAdmin(object, release, compiled) {
  const fields = object.parsed;
  if (decimal(field(fields, 'version', 'PackAdminCap'), 'PackAdminCap.version') !== '8'
    || moveId(field(fields, 'releaseId', 'PackAdminCap'), 'PackAdminCap.releaseId') !== release.objectId
    || address(field(fields, 'owner', 'PackAdminCap'), 'PackAdminCap.owner') !== compiled.signer
    || decimal(field(fields, 'controlEpoch', 'PackAdminCap'), 'PackAdminCap.controlEpoch') !== '0') {
    fail('MAKER_V8_PACK_READBACK_ADMIN_DRIFT', 'Finalized PackAdminCap differs from PackRelease control.');
  }
  return fields;
}

function validateTreasury(object, release) {
  const fields = object.parsed;
  if (decimal(field(fields, 'version', 'PackTreasury'), 'PackTreasury.version') !== '8'
    || moveId(field(fields, 'releaseId', 'PackTreasury'), 'PackTreasury.releaseId') !== release.objectId
    || decimal(field(fields, 'totalCollected', 'PackTreasury'), 'PackTreasury.totalCollected') !== '0'
    || decimal(field(fields, 'totalWithdrawn', 'PackTreasury'), 'PackTreasury.totalWithdrawn') !== '0') {
    fail('MAKER_V8_PACK_READBACK_TREASURY_DRIFT', 'Finalized PackTreasury is not the fresh zero-value treasury.');
  }
  return fields;
}

function eventFields(event, expectedType, sender, label) {
  if (normalizeStructTag(event.type) !== normalizeStructTag(expectedType)
    || event.sender !== sender || !plain(event.parsedJson) || event.bcs === null) {
    fail('MAKER_V8_PACK_READBACK_EVENT_DRIFT', `${label} lacks exact finalized event evidence.`);
  }
  return event.parsedJson;
}

/** Raw effects + historical BCS/JSON readback for all three Pack publication stages. */
export function createMakerV8PackReadbackV8({
  client,
  runtime: runtimeInput,
  readFinalized = assertFinalizedMakerV8CompilerTransactionV8,
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  assertTransport(client);
  if (typeof readFinalized !== 'function') {
    fail('MAKER_V8_PACK_READBACK_DEPENDENCY_INVALID', 'Pack readback requires the exact finalized transaction reader.');
  }
  const runtime = assertMakerV8Runtime(runtimeInput, { requireEnabled: true });
  const types = makerV8ChainTypes(runtime);
  const runtimeOriginal = runtime.roles.runtime.typeOriginPackageId;
  const sealOriginal = runtime.roles.seal.typeOriginPackageId;
  return freeze({
    schemaVersion: MAKER_V8_PACK_PUBLICATION_ADAPTERS_SCHEMA,
    // Definition-field evidence only. The publication cursor must also certify
    // Release lifecycle/style state before committing its durable checkpoint.
    async certifyDefinitionStep({ value, plan, ordinal, options, query }) {
      options = structuredClone(options);
      if (query?.status !== 'FINALIZED_SUCCESS') {
        fail('MAKER_V8_PACK_READBACK_FINALITY_INVALID', 'Definition readback requires a finalized successful digest.');
      }
      const digest = suiDigest(query.digest, 'Definition finalized digest');
      if (options?.runtimePackageId !== runtime.roles.runtime.callablePackageId
        || options?.corePackageId !== runtime.roles.core.callablePackageId
        || options?.coreOriginalPackageId !== runtime.roles.core.typeOriginPackageId
        || options?.paymentCoinType !== runtime.paymentCoinType) {
        fail('MAKER_V8_PACK_READBACK_DEFINITION_DRIFT', 'Definition compiler tuple differs from the readback runtime.');
      }
      // Rebuild from the private compiler plan proof; serialized ranges alone
      // cannot choose which historical prefix counts as publication progress.
      const built = await buildMakerV8PackDefinitionStepV8(value, plan, ordinal, options);
      const expected = Transaction.fromKind(built.kindBytesBase64);
      expected.setSender(options.signer);
      const response = await readFinalized(client, digest, expected);
      const kindSha256 = hashBytes(fromBase64(built.kindBytesBase64));
      if (response.compilerTransactionKindProof.transactionKindSha256 !== kindSha256) {
        fail('MAKER_V8_PACK_READBACK_KIND_DRIFT', 'Finalized definition TransactionKind differs from its compiled step.');
      }
      const finalized = built.step.stage === 'FINALIZE';
      const keyType = `${runtimeOriginal}::runtime_v8::PackDefinitions${finalized ? '' : 'Draft'}KeyV8`;
      const valueType = `${runtimeOriginal}::runtime_v8::PackDefinitions${finalized ? '' : 'Draft'}V8`;
      const fieldType = `0x2::dynamic_field::Field<${keyType},${valueType}>`;
      const fieldId = deriveDynamicFieldID(options.releaseRef.objectId, keyType, Uint8Array.of(0));
      const ref = outputChange(response, fieldType, 'Pack definition field', fieldId);
      const object = await historical(client, ref, fieldType, digest, 'Pack definition field');
      const kinds = ['tracks', 'colors', 'parts', 'rules', 'visibility'];
      const prefix = kinds.flatMap(kind => value.rows[kind].map(row => ({ kind, row }))).slice(0, built.step.end);
      const rows = { semantic_pack_id: value.rows.semantic_pack_id,
        ...Object.fromEntries(kinds.map(kind => [kind, prefix.filter(entry => entry.kind === kind).map(entry => entry.row)])) };
      const commitment = Array.from(plan.definitionCommitment.match(/../g), byte => parseInt(byte, 16));
      const stored = finalized ? { version: '8', release_id: options.releaseRef.objectId,
        release_content_commitment: Array.from(options.releaseContentCommitment.match(/../g), byte => parseInt(byte, 16)),
        rows, commitment } : { next_chunk: String(built.step.stage === 'BEGIN' ? 0 : built.step.chunkIndex + 1),
        expected_commitment: commitment, rows };
      const schema = bcs.struct('Field', { id: bcs.Address,
        name: bcs.struct('Key', { dummy_field: bcs.bool() }),
        value: finalized ? MAKER_V8_PACK_DEFINITIONS_BCS : MAKER_V8_PACK_DEFINITIONS_DRAFT_BCS });
      const expectedBytes = schema.serialize({ id: fieldId, name: { dummy_field: false }, value: stored }).toBytes();
      if (object.owner?.ObjectOwner !== options.releaseRef.objectId
        || !sameBytes(object.contentBcs, expectedBytes) || response.events.length !== 0) {
        fail('MAKER_V8_PACK_READBACK_DEFINITION_DRIFT', 'Historical definition owner, prefix, ordinal or commitment differs from the exact compiled step.');
      }
      if (built.step.stage === 'COLOR_BEGIN' || built.step.stage === 'COLOR_APPEND') {
        const colorKey = `${runtimeOriginal}::runtime_v8::PackColorDraftKeyV8`;
        const colorType = `0x2::dynamic_field::Field<${colorKey},${options.coreOriginalPackageId}::base_registry_v8::ColorChannelDraftV2>`;
        const colorId = deriveDynamicFieldID(options.releaseRef.objectId, colorKey, Uint8Array.of(0));
        const colorRef = outputChange(response, colorType, 'Pack pending Color', colorId);
        const color = await historical(client, colorRef, colorType, digest, 'Pack pending Color');
        const row = value.rows.colors[built.step.start - value.rows.tracks.length];
        const fieldSchema = bcs.struct('Field', { id: bcs.Address,
          name: bcs.struct('Key', { dummy_field: bcs.bool() }), value: MAKER_V8_COLOR_CHANNEL_DRAFT_BCS_V2 });
        const expectedColor = fieldSchema.serialize({ id: colorId, name: { dummy_field: false }, value: {
          ...row, expected_swatches: row.swatches.length, swatches: row.swatches.slice(0, built.step.swatchEnd),
        } }).toBytes();
        if (color.owner?.ObjectOwner !== options.releaseRef.objectId || !sameBytes(color.contentBcs, expectedColor)) {
          fail('MAKER_V8_PACK_READBACK_DEFINITION_DRIFT', 'Historical pending Color differs from the exact swatch prefix.');
        }
      }
      return freeze({ ordinal, stage: built.step.stage, digest, kindSha256,
        field: objectRef(object), definitionCommitment: plan.definitionCommitment,
        observedRows: built.step.end, nextChunk: finalized ? built.step.chunkIndex : Number(stored.next_chunk) });
    },
    async certifyStage({ compiled, descriptor, predecessor, query, artifact, definitions = null }) {
      if (query?.status !== 'FINALIZED_SUCCESS' || query.digest !== artifact.digest
        || descriptor.signer !== compiled.signer || artifact.digest !== descriptorDigest(artifact)) {
        fail('MAKER_V8_PACK_READBACK_FINALITY_INVALID', 'Pack readback requires one exact successful digest.');
      }
      const expected = Transaction.fromKind(descriptor.kindBytes);
      expected.setSender(compiled.signer);
      const response = await readFinalized(
        client, artifact.digest, expected,
      );
      if (response.compilerTransactionKindProof.transactionKindSha256 !== descriptor.kindSha256) {
        fail('MAKER_V8_PACK_READBACK_KIND_DRIFT', 'Finalized Pack TransactionKind differs from the compiler descriptor.');
      }
      if (descriptor.stage.startsWith('DEFINITIONS_')) {
        if (!definitions || descriptor.startStyle !== 0 || descriptor.endStyle !== 0) {
          fail('MAKER_V8_PACK_READBACK_DEFINITION_DRIFT', 'Definition stage requires compiler-derived rows with an unchanged Style cursor.');
        }
        const proof = await this.certifyDefinitionStep({ ...definitions, ordinal: descriptor.ordinal - 1, query });
        if (`DEFINITIONS_${proof.stage}` !== descriptor.stage || proof.kindSha256 !== descriptor.kindSha256) {
          fail('MAKER_V8_PACK_READBACK_DEFINITION_DRIFT', 'Definition history differs from the publication cursor.');
        }
      } else if (definitions !== null) {
        fail('MAKER_V8_PACK_READBACK_DEFINITION_DRIFT', 'Non-definition stage cannot consume definition history.');
      }
      let release; let admin; let treasury; let packRegistryRevision;
      if (descriptor.stage === 'INIT') {
        const releaseRef = outputChange(response, types.packRelease, 'PackRelease');
        const adminRef = outputChange(response, types.packAdminCap, 'PackAdminCap');
        const treasuryRef = outputChange(response, types.packTreasury, 'PackTreasury');
        [release, admin, treasury] = await Promise.all([
          historical(client, releaseRef, types.packRelease, artifact.digest, 'PackRelease'),
          historical(client, adminRef, types.packAdminCap, artifact.digest, 'PackAdminCap'),
          historical(client, treasuryRef, types.packTreasury, artifact.digest, 'PackTreasury'),
        ]);
        const releaseFields = validateRelease(release, compiled, descriptor, 0);
        validateAdmin(admin, release, compiled);
        validateTreasury(treasury, release);
        if (moveId(field(releaseFields, 'adminCapId', 'PackRelease'), 'PackRelease.adminCapId') !== admin.objectId
          || moveId(field(releaseFields, 'treasuryId', 'PackRelease'), 'PackRelease.treasuryId') !== treasury.objectId) {
          fail('MAKER_V8_PACK_READBACK_OBJECT_BINDING_DRIFT', 'PackRelease does not bind its exact admin cap and treasury.');
        }
        packRegistryRevision = compiled.document.bindings.packRegistry.revision;
      } else {
        if (!plain(predecessor?.release) || !plain(predecessor?.adminCap)
          || !plain(predecessor?.treasury)) {
          fail('MAKER_V8_PACK_READBACK_PREDECESSOR_INVALID', 'Pack append/finalize readback requires its exact durable predecessor.');
        }
        const releaseRef = outputChange(
          response, types.packRelease, 'PackRelease', predecessor.release.objectRef.objectId,
        );
        release = await historical(client, releaseRef, types.packRelease, artifact.digest, 'PackRelease');
        admin = predecessor.adminCap;
        treasury = predecessor.treasury;
        validateRelease(release, compiled, descriptor, descriptor.stage === 'FINALIZE' ? 2 : 0);
        if (descriptor.stage === 'FINALIZE') {
          const registryRef = outputChange(
            response, types.packRegistry, 'PackRegistry', compiled.inputs.packRegistry.objectId,
          );
          const registry = await historical(client, registryRef, types.packRegistry, artifact.digest, 'PackRegistry');
          packRegistryRevision = decimal(field(registry.parsed, 'revision', 'PackRegistry'), 'PackRegistry.revision');
          const expectedRevision = (BigInt(compiled.document.admission.expectedPackRegistryRevision) + 1n).toString();
          if (packRegistryRevision !== expectedRevision || response.events.length !== 3) {
            fail('MAKER_V8_PACK_READBACK_ADMISSION_DRIFT', 'Pack admission revision or event count differs from the exact compiler boundary.');
          }
          const sealed = eventFields(
            response.events[0], `${runtimeOriginal}::runtime_v8::PackLifecycleChangedV8`,
            compiled.signer, 'Pack sealed event',
          );
          const admitted = eventFields(
            response.events[1], `${runtimeOriginal}::runtime_v8::PackRegistryRevisionAdvancedV8`,
            compiled.signer, 'Pack admission event',
          );
          const active = eventFields(
            response.events[2], `${runtimeOriginal}::runtime_v8::PackLifecycleChangedV8`,
            compiled.signer, 'Pack active event',
          );
          if (moveId(field(sealed, 'releaseId', 'sealed event'), 'sealed event.releaseId') !== release.objectId
            || decimal(field(sealed, 'previousLifecycle', 'sealed event'), 'sealed event.previousLifecycle') !== '0'
            || decimal(field(sealed, 'lifecycle', 'sealed event'), 'sealed event.lifecycle') !== '1'
            || moveId(field(admitted, 'rootId', 'admission event'), 'admission event.rootId')
              !== compiled.document.bindings.root.objectRef.objectId
            || decimal(field(admitted, 'previousRevision', 'admission event'), 'admission event.previousRevision')
              !== compiled.document.admission.expectedPackRegistryRevision
            || decimal(field(admitted, 'revision', 'admission event'), 'admission event.revision') !== expectedRevision
            || moveId(field(admitted, 'subjectId', 'admission event'), 'admission event.subjectId') !== release.objectId
            || decimal(field(admitted, 'operation', 'admission event'), 'admission event.operation') !== '0'
            || moveId(field(active, 'releaseId', 'active event'), 'active event.releaseId') !== release.objectId
            || decimal(field(active, 'previousLifecycle', 'active event'), 'active event.previousLifecycle') !== '1'
            || decimal(field(active, 'lifecycle', 'active event'), 'active event.lifecycle') !== '2') {
            fail('MAKER_V8_PACK_READBACK_EVENT_DRIFT', 'Pack seal/admission/activation events differ from exact state.');
          }
        } else {
          const protectedRows = compiled.protection?.rows.filter((row) => (
            row.styleIndex >= descriptor.startStyle && row.styleIndex < descriptor.endStyle
          )) ?? [];
          if (response.events.length !== protectedRows.length) {
            fail('MAKER_V8_PACK_READBACK_EVENT_DRIFT', 'Pack append emitted another protected registration event set.');
          }
          if (protectedRows.length) {
            const registryRef = outputChange(
              response,
              types.sealRegistry,
              'SealRegistry',
              compiled.protection.authority.sealRegistry.objectId,
            );
            const registry = await historical(
              client,
              registryRef,
              types.sealRegistry,
              artifact.digest,
              'SealRegistry',
            );
            const finalRow = protectedRows.at(-1);
            const finalState = finalRow.nextRegistryState;
            if (moveId(field(registry.parsed, 'rootId', 'SealRegistry'), 'SealRegistry.rootId') !== finalState.rootId
              || moveId(field(registry.parsed, 'policyConfigId', 'SealRegistry'), 'SealRegistry.policyConfigId') !== finalState.policyId
              || decimal(field(registry.parsed, 'makerVersion', 'SealRegistry'), 'SealRegistry.makerVersion') !== finalState.makerVersion
              || hash(field(registry.parsed, 'rootContentCommitment', 'SealRegistry'), 'SealRegistry.rootContentCommitment') !== finalState.rootContentCommitment
              || field(registry.parsed, 'sealed', 'SealRegistry') !== true) {
              fail('MAKER_V8_PACK_READBACK_SEAL_DRIFT', 'Finalized Seal identity differs from the exact Maker registry.');
            }
            if (decimal(field(registry.parsed, 'runtimeRevision', 'SealRegistry'), 'SealRegistry.runtimeRevision')
                !== finalRow.nextRuntimeRevision
              || hash(field(registry.parsed, 'commitment', 'SealRegistry'), 'SealRegistry.commitment')
                !== finalRow.nextRuntimeCommitment
              || decimal(field(registry.parsed, 'revision', 'SealRegistry'), 'SealRegistry.revision') !== finalRow.nextRuntimeRevision) {
              fail('MAKER_V8_PACK_READBACK_SEAL_DRIFT', 'Finalized Seal registry differs from the exact protected Pack prefix.');
            }
            for (const key of ['baseCount', 'packCount', 'completeCount', 'baseCommitment', 'packCommitment', 'completeCommitment']) {
              const actual = key.endsWith('Count') ? decimal(field(registry.parsed, key, 'SealRegistry'), key)
                : hash(field(registry.parsed, key, 'SealRegistry'), key);
              if (actual !== finalRow.nextRegistryState[key]) fail('MAKER_V8_PACK_READBACK_SEAL_DRIFT', 'Finalized Seal scope state differs from the exact protected Pack prefix.');
            }
            response.events.forEach((event, index) => {
              const expected = protectedRows[index];
              const fields = eventFields(
                event,
                `${sealOriginal}::seal_v8::RuntimeProtectedAssetRegisteredV8`,
                compiled.signer,
                `protected Pack registration event ${index}`,
              );
              if (moveId(field(fields, 'registryId', 'protected event'), 'protected event.registryId')
                    !== compiled.protection.authority.sealRegistry.objectId
                || moveId(field(fields, 'rootId', 'protected event'), 'protected event.rootId')
                    !== compiled.document.bindings.root.objectRef.objectId
                || decimal(field(fields, 'previousRevision', 'protected event'), 'protected event.previousRevision')
                    !== expected.expectedSealRevision
                || decimal(field(fields, 'newRevision', 'protected event'), 'protected event.newRevision')
                    !== expected.nextRuntimeRevision
                || decimal(field(fields, 'scopeKind', 'protected event'), 'protected event.scopeKind') !== '1'
                || hash(field(fields, 'sealId', 'protected event'), 'protected event.sealId') !== expected.sealId
                || hash(field(fields, 'runtimeCommitment', 'protected event'), 'protected event.runtimeCommitment')
                    !== expected.nextRuntimeCommitment) {
                fail('MAKER_V8_PACK_READBACK_SEAL_DRIFT', 'Protected Pack registration event differs from its exact Seal row.');
              }
            });
          }
          packRegistryRevision = compiled.document.bindings.packRegistry.revision;
        }
      }
      const releaseFields = release.parsed;
      const checkpoint = freeze({
        schemaVersion: MAKER_V8_PACK_CHECKPOINT_SCHEMA,
        ordinal: descriptor.ordinal,
        stage: descriptor.stage,
        digest: artifact.digest,
        kindSha256: descriptor.kindSha256,
        startStyle: descriptor.startStyle,
        endStyle: descriptor.endStyle,
        release: freeze({ objectRef: objectRef(release), input: sharedInput(release, 'PackRelease') }),
        adminCap: descriptor.stage === 'INIT'
          ? freeze({ objectRef: objectRef(admin), input: ownedInput(admin, compiled.signer, 'PackAdminCap') })
          : admin,
        treasury: descriptor.stage === 'INIT'
          ? freeze({ objectRef: objectRef(treasury), input: sharedInput(treasury, 'PackTreasury') })
          : treasury,
        observedStyleCount: decimal(field(releaseFields, 'observedStyleCount', 'PackRelease'), 'PackRelease.observedStyleCount'),
        rollingStyleCommitment: hash(field(releaseFields, 'rollingStyleCommitment', 'PackRelease'), 'PackRelease.rollingStyleCommitment'),
        packRegistryRevision,
      });
      const chain = descriptor.stage === 'FINALIZE' ? freeze({
        schemaVersion: MAKER_V8_PACK_CHAIN_READBACK_SCHEMA,
        rootId: compiled.document.bindings.root.objectRef.objectId,
        packRegistryId: compiled.document.bindings.packRegistry.objectRef.objectId,
        semanticPackId: compiled.document.metadata.semanticPackId,
        release: freeze({
          objectRef: objectRef(release),
          owner: address(field(releaseFields, 'owner', 'PackRelease'), 'PackRelease.owner'),
          controlEpoch: decimal(field(releaseFields, 'controlEpoch', 'PackRelease'), 'PackRelease.controlEpoch'),
        }),
        adminCap: freeze({
          objectRef: admin.objectRef,
          releaseId: release.objectId,
          owner: compiled.signer,
          controlEpoch: '0',
        }),
        treasury: freeze({ objectRef: treasury.objectRef, releaseId: release.objectId }),
        lifecycle: 'ACTIVE',
        packRegistryRevision,
        finalizedDigest: artifact.digest,
      }) : null;
      return freeze({ checkpoint, chain });
    },
  });
}

function descriptorDigest(artifact) {
  suiDigest(artifact?.digest, 'Pack finalized digest');
  canonicalBase64(artifact?.base64, 'Pack finalized TransactionData');
  canonicalBase64(artifact?.signature, 'Pack finalized signature');
  return artifact.digest;
}
