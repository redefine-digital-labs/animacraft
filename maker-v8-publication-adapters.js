import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58,
  fromBase64,
  normalizeSuiAddress,
  toBase58,
  toBase64,
  toHex,
} from '@mysten/sui/utils';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import { sha256 } from '@noble/hashes/sha2.js';
import { makerV8PublicationExpiration } from './maker-v8-publication-expiration.js';
import { bindMakerV8SourceAssets } from './maker-v8-source-asset.js';

import {
  MAKER_V8_CHAIN_NETWORK,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
} from './maker-v8-chain.js';
import {
  assertMakerV8CompilerContextFreshV8,
  createMakerV8CompilerRpcAdapterV8,
  createProductionMakerV8BrowserAdapters,
} from './maker-v8-browser.js';
import {
  MAKER_V8_PUBLICATION_COMPILER_ABI,
  MAKER_V8_PUBLICATION_TOPOLOGY,
  MAKER_V8_ROLE_ORDER,
  buildMakerV8ActivationChunkTransaction,
  buildMakerV8BaseChunkTransaction,
  buildMakerV8CompanionObjectsTransaction,
  buildMakerV8ScaffoldTransaction,
  canonicalMakerV8Json,
  certifyMakerV8ActivationChunkReadback,
  certifyMakerV8BaseChunkReadback,
  certifyMakerV8CompanionReadback,
  certifyMakerV8ScaffoldReadback,
  certifyMakerV8SuccessorPredecessorV8,
  certifyMakerV8TrustedContext,
  compileMakerV8Publication,
  exactMakerV8TransactionTargets,
  rehydrateMakerV8ActivationChunkCertificateV8,
  rehydrateMakerV8BaseChunkCertificateV8,
} from './maker-v8-compiler.js';
import { projectPublicMakerV8Document } from './maker-v8-document.js';
import {
  MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
  MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
} from './maker-v8-protected-transport.js';
import {
  MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
  assertMakerV8PublicationPlanIdentityV8,
  assertMakerV8UnsignedOwnedReferenceDeltaV8,
  createMakerV8PublicationPersistenceV8,
  makerV8Base64BlobV8,
  makerV8BlobRefV8,
  makerV8PublicationAttemptIdV8,
  makerV8PublicationBlobRefsCommitmentV8,
  makerV8PublicationCompilerAuthorityV8,
  makerV8PublicationPlanIdV8,
  makerV8PublicationScopeKeyV8,
  makerV8Utf8BlobV8,
  readMakerV8PublicationBlobV8,
} from './maker-v8-publication-store.js';
import {
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  assertMakerV8SuiGrpcTransport,
  createProductionMakerV8SuiGrpcTransport,
} from './maker-v8-sui-grpc.js';

export const MAKER_V8_PUBLICATION_ADAPTERS_SCHEMA =
  'animacraft.maker-v8-publication-adapters.v1';
export const MAKER_V8_PUBLICATION_CONTEXT_SNAPSHOT_SCHEMA =
  'animacraft.maker-v8-publication-context-snapshot.v2';
export const MAKER_V8_PUBLICATION_STATE_SCHEMA =
  'animacraft.maker-v8-publication-state.v1';
export const MAKER_V8_PUBLICATION_CAPSULE_SCHEMA =
  'animacraft.maker-v8-publication-milestone-capsule.v1';
export const MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_SCHEMA =
  'animacraft.maker-v8-publication-transport-preparation.v1';

const HASH = /^[0-9a-f]{64}$/;
const EFFECTS_FINGERPRINT = /^0x[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const EXACT_ID = /^0x[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const COMPILER_STATES = new WeakSet();
const COMPILER_KIND_AUTHORITIES = new WeakMap();
const KIND_AUTHORITY_LIMIT = 128;
const TRANSACTION_SIGNATURE_AUTHORITY_LIMIT = 16;
const DESCRIPTOR_FIELDS = Object.freeze([
  'ordinal', 'kind', 'phase', 'lane', 'action', 'startSequence', 'endSequence',
  'rowCommitments', 'preState', 'postState', 'compilerCheckpoint',
  'transactionKindSha256', 'commandCount', 'targets',
]);

export class MakerV8PublicationAdaptersError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MakerV8PublicationAdaptersError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details = {}) {
  throw new MakerV8PublicationAdaptersError(code, message, details);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exact(value, fields, label) {
  if (!plain(value)) fail('MAKER_V8_PUBLICATION_ADAPTER_SHAPE_INVALID', `${label} must be a plain record.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('MAKER_V8_PUBLICATION_ADAPTER_SHAPE_INVALID', `${label} has fields outside its exact schema.`, {
      actual,
      expected,
    });
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function canonical(value) {
  return canonicalMakerV8Json(value);
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  return hashBytes(encoder.encode(canonical(value)));
}

function deterministicClone(value, label) {
  let text;
  let result;
  try {
    text = JSON.stringify(value);
    result = JSON.parse(text);
    if (canonical(result) !== canonical(value)) throw new Error('round trip');
  } catch {
    fail('MAKER_V8_PUBLICATION_EVIDENCE_INVALID', `${label} must be deterministic JSON.`);
  }
  return result;
}

function canonicalBase64(value, label, { empty = false } = {}) {
  try {
    if (typeof value !== 'string' || (!empty && value.length === 0)) throw new Error('shape');
    const bytes = fromBase64(value);
    if (toBase64(bytes) !== value) throw new Error('canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_PUBLICATION_BASE64_INVALID', `${label} must be canonical Base64.`);
  }
}

function address(value, label) {
  try {
    const result = normalizeSuiAddress(value);
    if (result !== value || !EXACT_ID.test(result)) throw new Error('canonical');
    return result;
  } catch {
    fail('MAKER_V8_PUBLICATION_ADDRESS_INVALID', `${label} must be one canonical Sui address.`);
  }
}

function suiDigest(value, label) {
  try {
    if (typeof value !== 'string') throw new Error('shape');
    const bytes = fromBase58(value);
    if (bytes.length !== 32 || toBase58(bytes) !== value) throw new Error('canonical');
    return value;
  } catch {
    fail('MAKER_V8_PUBLICATION_SUI_DIGEST_INVALID', `${label} must be one canonical Sui digest.`);
  }
}

function objectId(value, label) {
  const result = value?.reference?.objectId;
  return address(result, `${label}.reference.objectId`);
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail('MAKER_V8_PUBLICATION_ADAPTER_DEPENDENCY_INVALID', `${label}.${method} is required.`);
  }
}

function sameBytes(left, right) {
  return left.length === right.length
    && left.every((byte, index) => byte === right[index]);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function transactionKindProof(value, label) {
  const bytes = typeof value === 'string' ? canonicalBase64(value, label) : value;
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionKind.parse(bytes);
    roundtrip = bcs.TransactionKind.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID', `${label} is not canonical TransactionKind BCS.`);
  }
  if (parsed?.$kind !== 'ProgrammableTransaction' || !sameBytes(bytes, roundtrip)) {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID', `${label} is not one canonical ProgrammableTransaction.`);
  }
  const commands = parsed.ProgrammableTransaction?.commands;
  if (!Array.isArray(commands) || !commands.length
    || commands.some((command) => !['MoveCall', 'MakeMoveVec'].includes(command?.$kind))) {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID', `${label} contains a non-compiler command.`);
  }
  return Object.freeze({ bytes, base64: toBase64(bytes), sha256: hashBytes(bytes) });
}

function createCompilerKindAuthority() {
  const kinds = new Map();
  const transactions = new Map();
  const compilerTransactions = new WeakMap();
  const trim = (values) => {
    while (values.size > KIND_AUTHORITY_LIMIT) values.delete(values.keys().next().value);
  };
  const kindKey = (signer, proof) => `${signer}:${proof.sha256}`;

  const authorizeKind = (signerValue, kindValue) => {
    const signer = address(signerValue, 'compiler kind signer');
    const proof = transactionKindProof(kindValue, 'compiler-authorized TransactionKind');
    const key = kindKey(signer, proof);
    const prior = kinds.get(key);
    if (prior && prior.base64 !== proof.base64) {
      fail('MAKER_V8_PUBLICATION_COMPILER_KIND_DRIFT', 'Compiler kind authority observed a hash collision or byte drift.');
    }
    kinds.delete(key);
    kinds.set(key, Object.freeze({ signer, base64: proof.base64, sha256: proof.sha256 }));
    trim(kinds);
    return proof;
  };

  const requireKind = (signerValue, kindValue) => {
    const signer = address(signerValue, 'compiler kind signer');
    const proof = transactionKindProof(kindValue, 'candidate TransactionKind');
    const authorized = kinds.get(kindKey(signer, proof));
    if (!authorized || authorized.base64 !== proof.base64) {
      fail(
        'MAKER_V8_PUBLICATION_COMPILER_KIND_PROOF_REQUIRED',
        'Exact broadcast requires a TransactionKind independently authorized by the compiler.',
      );
    }
    return proof;
  };

  const authorizeCompilerTransaction = ({ signer, kindBytes, transaction }) => {
    if (!(transaction instanceof Transaction)) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_REQUIRED', 'Compiler authority can brand only a Sui Transaction instance.');
    }
    const checkedSigner = address(signer, 'compiler transaction signer');
    const kind = authorizeKind(checkedSigner, kindBytes);
    compilerTransactions.set(transaction, Object.freeze({
      signer: checkedSigner,
      kindBytes: kind.base64,
      kindSha256: kind.sha256,
    }));
    return kind;
  };

  const requireCompilerTransaction = ({ signer, kindBytes, transaction }) => {
    if (!(transaction instanceof Transaction)) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_REQUIRED', 'Boundary requires a compiler-branded Sui Transaction instance.');
    }
    const checkedSigner = address(signer, 'compiler transaction signer');
    const kind = requireKind(checkedSigner, kindBytes);
    const branded = compilerTransactions.get(transaction);
    if (!branded || branded.signer !== checkedSigner
      || branded.kindBytes !== kind.base64 || branded.kindSha256 !== kind.sha256) {
      fail(
        'MAKER_V8_PUBLICATION_COMPILER_TRANSACTION_PROOF_REQUIRED',
        'Boundary accepts only the exact Transaction instance produced by this compiler authority.',
      );
    }
    return kind;
  };

  const authorizeTransaction = ({ digest, signer, kindBytes, signature }) => {
    const checkedDigest = suiDigest(digest, 'compiler-authorized transaction digest');
    const checkedSigner = address(signer, 'compiler-authorized transaction signer');
    const kind = requireKind(checkedSigner, kindBytes);
    const signatureBytes = canonicalBase64(signature, 'compiler-authorized signature');
    const proof = Object.freeze({
      digest: checkedDigest,
      signer: checkedSigner,
      kindBytes: kind.base64,
      kindSha256: kind.sha256,
      signature,
      signatureSha256: hashBytes(signatureBytes),
    });
    const prior = transactions.get(checkedDigest);
    if (prior && (prior.signer !== proof.signer
      || prior.kindBytes !== proof.kindBytes || prior.kindSha256 !== proof.kindSha256)) {
      fail('MAKER_V8_PUBLICATION_COMPILER_TRANSACTION_DRIFT', 'One transaction digest was bound to another compiler proof.');
    }
    const signatures = prior?.signatures ?? new Map();
    const priorSignature = signatures.get(signature);
    if (priorSignature && priorSignature.signatureSha256 !== proof.signatureSha256) {
      fail('MAKER_V8_PUBLICATION_COMPILER_TRANSACTION_DRIFT', 'One exact signature changed under its compiler proof.');
    }
    signatures.delete(signature);
    signatures.set(signature, proof);
    while (signatures.size > TRANSACTION_SIGNATURE_AUTHORITY_LIMIT) {
      signatures.delete(signatures.keys().next().value);
    }
    transactions.delete(checkedDigest);
    transactions.set(checkedDigest, {
      signer: proof.signer,
      kindBytes: proof.kindBytes,
      kindSha256: proof.kindSha256,
      signatures,
    });
    trim(transactions);
    return proof;
  };

  const requireTransaction = ({ digest, signer, kindBytes, signature }) => {
    const checkedDigest = suiDigest(digest, 'broadcast transaction digest');
    const checkedSigner = address(signer, 'broadcast transaction signer');
    const kind = requireKind(checkedSigner, kindBytes);
    const signatureBytes = canonicalBase64(signature, 'broadcast signature');
    const authorized = transactions.get(checkedDigest);
    const signatureProof = authorized?.signatures.get(signature);
    if (!authorized || authorized.signer !== checkedSigner
      || authorized.kindBytes !== kind.base64 || authorized.kindSha256 !== kind.sha256
      || !signatureProof || signatureProof.signature !== signature
      || signatureProof.signatureSha256 !== hashBytes(signatureBytes)) {
      fail(
        'MAKER_V8_PUBLICATION_COMPILER_TRANSACTION_PROOF_REQUIRED',
        'Exact broadcast requires an independently authorized compiler transaction digest.',
      );
    }
    return signatureProof;
  };

  return Object.freeze({
    authorizeKind,
    requireKind,
    authorizeCompilerTransaction,
    requireCompilerTransaction,
    authorizeTransaction,
    requireTransaction,
  });
}

function transactionDataProof(value, expected) {
  const bytes = typeof value === 'string'
    ? canonicalBase64(value, 'TransactionData') : value;
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionData.parse(bytes);
    roundtrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_DATA_INVALID', 'TransactionData is not canonical BCS.');
  }
  if (parsed?.$kind !== 'V1' || !sameBytes(bytes, roundtrip)) {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_DATA_INVALID', 'TransactionData is not canonical V1 BCS.');
  }
  const valueV1 = parsed.V1;
  const kind = bcs.TransactionKind.serialize(valueV1.kind).toBytes();
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (valueV1.sender !== expected.sender || valueV1.gasData?.owner !== expected.sender
    || !sameBytes(kind, canonicalBase64(expected.kindBytes, 'expected TransactionKind'))
    || expected.digest != null && digest !== expected.digest) {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_DATA_DRIFT', 'TransactionData sender, gas owner, kind, or digest drifted.');
  }
  return Object.freeze({ bytes, base64: toBase64(bytes), digest });
}

function staticCheckpoint(kind) {
  const topology = kind === 'SCAFFOLD'
    ? MAKER_V8_PUBLICATION_TOPOLOGY.scaffold
    : MAKER_V8_PUBLICATION_TOPOLOGY.companion;
  return Object.freeze({
    schemaVersion: topology.checkpointSchema,
    phase: topology.phase,
    lane: topology.lane,
    action: topology.action,
    index: 0,
    startSequence: '0',
    endSequence: '0',
    final: true,
  });
}

function transactionAndCheckpoint(kind, build) {
  if (kind === 'SCAFFOLD') return { transaction: build, checkpoint: staticCheckpoint(kind) };
  if (kind === 'COMPANION_OBJECTS') {
    return { transaction: build.transaction, checkpoint: staticCheckpoint(kind) };
  }
  return { transaction: build.transaction, checkpoint: build.checkpoint };
}

function descriptorRowCommitments(checkpoint) {
  if (checkpoint.lane === 'BASE' && plain(checkpoint.expected?.rollingCommitments)) {
    return Object.entries(checkpoint.expected.rollingCommitments).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    )).map(([name, commitment]) => ({ lane: `BASE/${name}`, commitment }));
  }
  if (HASH.test(checkpoint.expected?.rollingCommitment)) {
    return [{ lane: checkpoint.lane, commitment: checkpoint.expected.rollingCommitment }];
  }
  return [];
}

function publicationState(publication, checkpoint) {
  return {
    schemaVersion: MAKER_V8_PUBLICATION_STATE_SCHEMA,
    contentCommitment: publication.commitments.content,
    phase: checkpoint.phase,
    lane: checkpoint.lane,
    startSequence: checkpoint.startSequence,
    endSequence: checkpoint.endSequence,
    final: checkpoint.final,
    expectedCommitment: hashValue(checkpoint.expected ?? null),
  };
}

async function descriptorFromBuild({ ordinal, kind, build, publication, head }) {
  const { transaction, checkpoint } = transactionAndCheckpoint(kind, build);
  if (!(transaction instanceof Transaction)) {
    fail('MAKER_V8_PUBLICATION_COMPILER_BUILD_INVALID', 'Compiler did not return one Sui Transaction.');
  }
  const kindProof = transactionKindProof(
    await transaction.build({ onlyTransactionKind: true }),
    `${kind} TransactionKind`,
  );
  const targets = [...exactMakerV8TransactionTargets(transaction)];
  const preState = head ? deterministicClone(head.postState, 'prior publication state') : {
    schemaVersion: MAKER_V8_PUBLICATION_STATE_SCHEMA,
    contentCommitment: publication.commitments.content,
    phase: 'UNPUBLISHED',
    lane: 'NONE',
    startSequence: '0',
    endSequence: '0',
    final: false,
    expectedCommitment: hashValue(null),
  };
  const descriptor = {
    ordinal,
    kind,
    phase: checkpoint.phase,
    lane: checkpoint.lane,
    action: checkpoint.action ?? (checkpoint.phase === 'BASE_APPEND' ? 'APPEND' : 'SEAL'),
    startSequence: checkpoint.startSequence,
    endSequence: checkpoint.endSequence,
    rowCommitments: descriptorRowCommitments(checkpoint),
    preState,
    postState: publicationState(publication, checkpoint),
    compilerCheckpoint: deterministicClone(checkpoint, 'compiler checkpoint'),
    transactionKindSha256: kindProof.sha256,
    commandCount: targets.length,
    targets,
  };
  exact(descriptor, DESCRIPTOR_FIELDS, 'publication descriptor');
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || targets.length === 0) {
    fail('MAKER_V8_PUBLICATION_DESCRIPTOR_INVALID', 'Compiler descriptor ordinal or target set is invalid.');
  }
  return Object.freeze({ descriptor: freeze(descriptor), transaction, kindBytes: kindProof.base64 });
}

function compilerContextSnapshot(context, transport, predecessor) {
  const snapshot = {
    schemaVersion: MAKER_V8_PUBLICATION_CONTEXT_SNAPSHOT_SCHEMA,
    context: Object.fromEntries([
      'schemaVersion', 'chainIdentifier', 'signerAddress', 'paymentCoinType',
      'protocolProfile', 'coreArtifact', 'clock', 'protocolConfig', 'protocolTreasury',
      'catalog', 'configs', 'activationAuthority',
    ].map((field) => [field, clone(context[field])])),
    transport: {
      manifest: { blobId: transport.manifest.blobId },
      livingContent: clone(transport.livingContent),
      assets: transport.assets.map(({ assetId, blobId, mediaType }) => ({
        assetId, blobId, mediaType,
      })).sort((left, right) => compareText(left.assetId, right.assetId)),
    },
    predecessor: predecessor === null ? null : clone(predecessor),
  };
  return deterministicClone(snapshot, 'compiler context snapshot');
}

function livingContentEvidence(value) {
  exact(value, ['blobId', 'blobObjectId', 'bytesBase64'], 'Walrus living content');
  if(typeof value.blobObjectId!=='string'||!/^0x[0-9a-f]{64}$/.test(value.blobObjectId)||/^0x0+$/.test(value.blobObjectId)) {
    fail('MAKER_V8_PUBLICATION_TRANSPORT_INVALID', 'Living content requires its exact durable Walrus Blob object ID.');
  }
  if (typeof value.blobId !== 'string' || !value.blobId || encoder.encode(value.blobId).length > 512) {
    fail('MAKER_V8_PUBLICATION_TRANSPORT_INVALID', 'Living content requires a bounded actual blob ID.');
  }
  canonicalBase64(value.bytesBase64, 'Walrus living content bytes');
  return clone(value);
}

function transportEvidence(transport) {
  exact(transport, ['manifest', 'assets', 'livingContent'], 'Walrus transport');
  livingContentEvidence(transport.livingContent);
  exact(transport.manifest, ['blobId', 'bytesBase64'], 'Walrus manifest');
  if (typeof transport.manifest.blobId !== 'string' || !transport.manifest.blobId
    || !Array.isArray(transport.assets)) {
    fail('MAKER_V8_PUBLICATION_TRANSPORT_INVALID', 'Walrus transport is incomplete.');
  }
  const manifestBytes = canonicalBase64(transport.manifest.bytesBase64, 'Walrus manifest bytes');
  let manifestText;
  try {
    manifestText = decoder.decode(manifestBytes);
    if (!sameBytes(encoder.encode(manifestText), manifestBytes)
      || canonical(JSON.parse(manifestText)) !== manifestText) throw new Error('canonical JSON');
  } catch {
    fail('MAKER_V8_PUBLICATION_MANIFEST_INVALID', 'Walrus manifest must be canonical UTF-8 Maker JSON.');
  }
  const seen = new Set();
  const assets = transport.assets.map((asset, index) => {
    exact(asset, ['assetId', 'blobId', 'mediaType', 'bytesBase64'], `Walrus asset[${index}]`);
    if (typeof asset.assetId !== 'string' || !asset.assetId || seen.has(asset.assetId)
      || typeof asset.blobId !== 'string' || !asset.blobId
      || typeof asset.mediaType !== 'string' || !asset.mediaType) {
      fail('MAKER_V8_PUBLICATION_TRANSPORT_INVALID', `Walrus asset[${index}] is invalid.`);
    }
    seen.add(asset.assetId);
    canonicalBase64(asset.bytesBase64, `Walrus asset ${asset.assetId}`, { empty: true });
    return clone(asset);
  }).sort((left, right) => compareText(left.assetId, right.assetId));
  return Object.freeze({ manifestText, assets });
}

function transportManifestCandidate(documentValue, assetTransports, manifestBlobIdPlaceholder, livingContentTransport) {
  const livingContent = livingContentEvidence(livingContentTransport);
  const document = projectPublicMakerV8Document(documentValue);
  if (typeof manifestBlobIdPlaceholder !== 'string' || !manifestBlobIdPlaceholder
    || encoder.encode(manifestBlobIdPlaceholder).length > 512
    || !Array.isArray(assetTransports)) {
    fail(
      'MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_INVALID',
      'Transport preparation requires one bounded Manifest placeholder and an exact asset transport array.',
    );
  }
  const expected = new Map(document.assets.map((asset) => [asset.id, asset]));
  const protectedAssets = new Map();
  const usageByAsset = new Map();
  for (const part of document.parts) for (const item of part.items) for (const style of item.styles) {
    const usage = usageByAsset.get(style.assetId) ?? [];
    usage.push(style.protected === true);
    usageByAsset.set(style.assetId, usage);
    if (style.protected !== true) continue;
    if (protectedAssets.has(style.assetId)) {
      fail('MAKER_V8_PROTECTED_ASSET_IDENTITY_AMBIGUOUS', `Protected asset ${style.assetId} is shared by multiple public Styles.`);
    }
    protectedAssets.set(style.assetId, style);
  }
  for (const [assetId, usages] of usageByAsset) {
    if (usages.some(Boolean) && (usages.length !== 1 || usages[0] !== true)) {
      fail('MAKER_V8_PROTECTED_ASSET_IDENTITY_AMBIGUOUS', `Protected asset ${assetId} must belong to exactly one public protected Style.`);
    }
  }
  const seen = new Set();
  const assets = assetTransports.map((asset, index) => {
    exact(asset, ['assetId', 'blobId', 'mediaType', 'bytesBase64'], `asset transport[${index}]`);
    if (typeof asset.assetId !== 'string' || !asset.assetId || seen.has(asset.assetId)
      || typeof asset.blobId !== 'string' || !asset.blobId
      || encoder.encode(asset.blobId).length > 512
      || typeof asset.mediaType !== 'string' || !asset.mediaType) {
      fail(
        'MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_INVALID',
        `Asset transport[${index}] is incomplete or duplicated.`,
      );
    }
    const documentAsset = expected.get(asset.assetId);
    const bytes = canonicalBase64(
      asset.bytesBase64,
      `asset transport ${asset.assetId}`,
      { empty: true },
    );
    const protectedAsset = protectedAssets.has(asset.assetId);
    if (!documentAsset
      || !protectedAsset && (documentAsset.mediaType !== asset.mediaType
        || String(documentAsset.byteLength) !== String(bytes.length))
      || protectedAsset && asset.mediaType !== MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE) {
      fail(
        'MAKER_V8_PUBLICATION_ASSET_SET_DRIFT',
        `Asset transport ${asset.assetId} differs from the exact Maker document asset set.`,
      );
    }
    seen.add(asset.assetId);
    return Object.freeze({
      transport: clone(asset),
      required: Object.freeze({
        assetId: asset.assetId,
        blobId: asset.blobId,
        mediaType: asset.mediaType,
        byteLength: bytes.length,
        sha256: hashBytes(bytes),
      }),
    });
  }).sort((left, right) => compareText(left.required.assetId, right.required.assetId));
  if (assets.length !== expected.size || [...expected.keys()].some((assetId) => !seen.has(assetId))) {
    fail(
      'MAKER_V8_PUBLICATION_ASSET_SET_DRIFT',
      'Asset transports do not exactly cover the Maker document asset set.',
    );
  }
  const requiredAssets = assets.map(({ required }) => required);
  const manifestText = canonical({
    schemaVersion: 'animacraft.maker-v8-manifest.v2',
    protocolVersion: 8,
    document,
    certifiedAssets: requiredAssets,
  });
  const manifestBytes = encoder.encode(manifestText);
  const manifest = Object.freeze({
    blobIdPlaceholder: manifestBlobIdPlaceholder,
    bytesBase64: toBase64(manifestBytes),
    byteLength: manifestBytes.length,
    sha256: hashBytes(manifestBytes),
  });
  return Object.freeze({
    transport: Object.freeze({
      manifest: Object.freeze({
        blobId: manifestBlobIdPlaceholder,
        bytesBase64: manifest.bytesBase64,
      }),
      assets: Object.freeze(assets.map(({ transport }) => freeze(transport))),
      livingContent: freeze(livingContent),
    }),
    manifest,
    requiredAssets: Object.freeze(requiredAssets),
  });
}

function selectedConfigFields(context, role) {
  const source = context.configs[role];
  const common = {
    version: source.fields.version,
    catalogId: source.fields.catalogId,
    productBindingCommitment: source.fields.productBindingCommitment,
    callCapSetCommitment: source.fields.callCapSetCommitment,
    authorityId: source.fields.authorityId,
  };
  if (role !== 'seal') return common;
  return {
    ...common,
    commitment: source.fields.commitment,
    keyServerIds: clone(source.fields.keyServerIds),
    weights: clone(source.fields.weights),
    threshold: source.fields.threshold,
    keyServerSetCommitment: source.fields.keyServerSetCommitment,
    encryptionPolicyCommitment: source.fields.encryptionPolicyCommitment,
  };
}

async function authorityFromContext(context, attestation) {
  if (!Array.isArray(attestation?.packageTuple)
    || attestation.packageTuple.length !== MAKER_V8_ROLE_ORDER.length) {
    fail(
      'MAKER_V8_PUBLICATION_PACKAGE_ATTESTATION_REQUIRED',
      'Fresh runtime attestation must expose all seven callable package digests.',
    );
  }
  const packageTuple = MAKER_V8_ROLE_ORDER.map((role, index) => {
    const identity = context.catalog?.fields?.roles?.[role];
    const evidence = attestation.packageTuple[index];
    if (!identity || evidence?.role !== role
      || evidence.originalPackageId !== identity.originalPackageId
      || evidence.callablePackageId !== identity.callablePackageId) {
      fail('MAKER_V8_PUBLICATION_PACKAGE_ATTESTATION_DRIFT', `Fresh ${role} package evidence differs from compiler context.`);
    }
    return {
      role,
      originalPackageId: identity.originalPackageId,
      callablePackageId: identity.callablePackageId,
      packageDigest: evidence.packageDigest,
      sourceCommitment: identity.sourceCommitment,
      packageCommitment: identity.packageCommitment,
      abiCommitment: identity.abiCommitment,
      bindingCommitment: identity.bindingCommitment,
    };
  });
  if (packageTuple[0].packageDigest !== context.coreArtifact.packageDigest
    || attestation.coreArtifact
      && canonical(attestation.coreArtifact) !== canonical(context.coreArtifact)) {
    fail('MAKER_V8_PUBLICATION_PACKAGE_ATTESTATION_DRIFT', 'Fresh Core artifact differs from compiler context.');
  }
  return makerV8PublicationCompilerAuthorityV8({
    schemaVersion: 'animacraft.maker-v8-publication-authority.v1',
    protocolProfile: clone(context.protocolProfile),
    coreArtifact: clone(context.coreArtifact),
    packageTuple,
    protocolConfig: {
      objectId: objectId(context.protocolConfig, 'protocolConfig'),
      revision: String(context.protocolConfig.fields.revision),
      commitment: context.protocolConfig.fields.commitment,
    },
    catalog: {
      objectId: objectId(context.catalog, 'catalog'),
      protocolConfigId: context.catalog.fields.protocolConfigId,
      protocolConfigRevision: String(context.catalog.fields.protocolConfigRevision),
      protocolConfigCommitment: context.catalog.fields.protocolConfigCommitment,
      productBindingCommitment: context.catalog.fields.productBindingCommitment,
      callCapSetCommitment: context.catalog.fields.callCapSetCommitment,
    },
    configs: Object.fromEntries(['seal', 'runtime', 'output', 'physical', 'market', 'release'].map((role) => [
      role,
      {
        objectId: objectId(context.configs[role], `configs.${role}`),
        fields: selectedConfigFields(context, role),
      },
    ])),
    sealPolicyCommitment: context._derived.sealPolicyCommitment,
    compilerAbi: Object.fromEntries(MAKER_V8_ROLE_ORDER.map((role, index) => [
      role,
      MAKER_V8_PUBLICATION_COMPILER_ABI[role].map(
        (suffix) => `${packageTuple[index].callablePackageId}::${suffix}`,
      ),
    ])),
  });
}

function assertAuthority(expected, observed) {
  if (canonical(expected) !== canonical(observed)) {
    fail(
      'MAKER_V8_PUBLICATION_AUTHORITY_DRIFT',
      'Fresh seven-package compiler authority differs from the durable publication authority.',
    );
  }
}

function milestone(kind, checkpoint, readback) {
  return {
    kind,
    checkpoint: deterministicClone(checkpoint, `${kind} milestone checkpoint`),
    readback: deterministicClone(readback, `${kind} milestone readback`),
  };
}

function finalityEvidence(query) {
  exact(query, ['status', 'digest', 'epoch', 'effectsFingerprint', 'eventsDigest', 'error', 'absence'], 'finality query');
  if (query.status !== 'FINALIZED_SUCCESS' || typeof query.digest !== 'string'
    || typeof query.epoch !== 'string' || !UINT.test(query.epoch)
    || !EFFECTS_FINGERPRINT.test(query.effectsFingerprint)
    || query.error !== null || query.absence !== null) {
    fail('MAKER_V8_PUBLICATION_FINALITY_INVALID', 'Finality query is not one successful exact-digest result.');
  }
  suiDigest(query.digest, 'finality transaction digest');
  if (query.eventsDigest !== null) suiDigest(query.eventsDigest, 'finality events digest');
  return deterministicClone(query, 'finality query');
}

function currentCapsuleMilestone(head, milestones) {
  if (head.kind === 'SCAFFOLD') return milestones.scaffold;
  if (head.kind === 'BASE_CHUNK') {
    return head.compilerCheckpoint.final ? milestones.baseFinal : milestones.progress;
  }
  if (head.kind === 'COMPANION_OBJECTS') return milestones.companion;
  if (head.kind === 'ACTIVATION_CHUNK') return milestones.progress;
  return null;
}

function validateCapsule(head, plan) {
  if (!head || head.checkpointSha256 !== plan.head?.checkpointSha256
    || head.ordinal !== plan.head.ordinal || head.digest !== plan.head.digest) {
    fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Historical reconstruction requires the exact durable head.');
  }
  const wrapper = head.readback;
  if (!plain(wrapper) || wrapper.schemaVersion !== 'animacraft.maker-v8-publication-finalized-readback.v1'
    || wrapper.source !== 'FINALIZED_RPC' || wrapper.transactionDigest !== head.digest
    || wrapper.transactionKindSha256 !== head.transactionKindSha256) {
    fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Durable head lacks exact finalized wrapper evidence.');
  }
  const capsule = wrapper.compiler;
  exact(capsule, [
    'schemaVersion', 'ordinal', 'kind', 'transactionDigest', 'transactionKindSha256',
    'authorityCommitment', 'finality', 'milestones',
  ], 'milestone capsule');
  exact(capsule.milestones, ['scaffold', 'baseFinal', 'companion', 'progress'], 'milestone capsule set');
  const checkedFinality = finalityEvidence(capsule.finality);
  if (capsule.schemaVersion !== MAKER_V8_PUBLICATION_CAPSULE_SCHEMA
    || capsule.ordinal !== head.ordinal || capsule.kind !== head.kind
    || capsule.transactionDigest !== head.digest
    || capsule.transactionKindSha256 !== head.transactionKindSha256
    || capsule.authorityCommitment !== plan.immutable.compilerAuthority.trustedContextCommitment
    || canonical(checkedFinality) !== canonical({
      status: 'FINALIZED_SUCCESS',
      digest: head.digest,
      epoch: capsule.finality.epoch,
      effectsFingerprint: capsule.finality.effectsFingerprint,
      eventsDigest: capsule.finality.eventsDigest,
      error: null,
      absence: null,
    })) {
    fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Durable milestone capsule is not bound to its head and authority.');
  }
  for (const [name, entry] of Object.entries(capsule.milestones)) {
    if (entry === null) continue;
    exact(entry, ['kind', 'checkpoint', 'readback'], `milestone ${name}`);
    if (!plain(entry.checkpoint) || !plain(entry.readback)
      || entry.readback.source !== 'FINALIZED_RPC'
      || typeof entry.readback.transactionDigest !== 'string'
      || !HASH.test(entry.readback.transactionKindSha256)) {
      fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', `Milestone ${name} is malformed.`);
    }
    suiDigest(entry.readback.transactionDigest, `${name} finalized transaction digest`);
    const proof = transactionKindProof(
      entry.readback.transactionKindBytesBase64,
      `${name} finalized TransactionKind`,
    );
    if (proof.sha256 !== entry.readback.transactionKindSha256) {
      fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', `Milestone ${name} TransactionKind hash drifted.`);
    }
  }
  const current = currentCapsuleMilestone(head, capsule.milestones);
  if (!current || current.kind !== head.kind
    || current.readback.transactionDigest !== head.digest
    || current.readback.transactionKindSha256 !== head.transactionKindSha256
    || canonical(current.checkpoint) !== canonical(head.compilerCheckpoint)) {
    fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Current milestone differs from the durable finalized head.');
  }
  const { scaffold, baseFinal, companion, progress } = capsule.milestones;
  if (scaffold?.kind !== 'SCAFFOLD'
    || baseFinal && (baseFinal.kind !== 'BASE_CHUNK' || baseFinal.checkpoint.final !== true)
    || companion && companion.kind !== 'COMPANION_OBJECTS'
    || progress && !['BASE_CHUNK', 'ACTIVATION_CHUNK'].includes(progress.kind)
    || progress?.kind === 'BASE_CHUNK' && progress.checkpoint.final !== false) {
    fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Named milestones contain an invalid compiler kind or finality marker.');
  }
  const validTopology = head.kind === 'SCAFFOLD'
    ? scaffold && !baseFinal && !companion && !progress
    : head.kind === 'BASE_CHUNK' && !head.compilerCheckpoint.final
      ? scaffold && !baseFinal && !companion && progress?.kind === 'BASE_CHUNK'
      : head.kind === 'BASE_CHUNK'
        ? scaffold && baseFinal && !companion && !progress
        : head.kind === 'COMPANION_OBJECTS'
          ? scaffold && baseFinal && companion && !progress
          : head.kind === 'ACTIVATION_CHUNK'
            ? scaffold && baseFinal && companion && progress?.kind === 'ACTIVATION_CHUNK'
            : false;
  if (!validTopology) {
    fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Milestone capsule skips or duplicates a compiler boundary.');
  }
  return capsule;
}

function expectedNextKind(head) {
  if (head === null) return 'SCAFFOLD';
  if (head.kind === 'SCAFFOLD') return 'BASE_CHUNK';
  if (head.kind === 'BASE_CHUNK') {
    return head.compilerCheckpoint.final ? 'COMPANION_OBJECTS' : 'BASE_CHUNK';
  }
  if (head.kind === 'COMPANION_OBJECTS') return 'ACTIVATION_CHUNK';
  if (head.kind === 'ACTIVATION_CHUNK' && !head.compilerCheckpoint.final) return 'ACTIVATION_CHUNK';
  fail('MAKER_V8_PUBLICATION_SUCCESSOR_COMPLETE', 'Final activation has no publication successor.');
}

function exactDescriptor(left, right) {
  return canonical(Object.fromEntries(DESCRIPTOR_FIELDS.map((field) => [field, left?.[field]])))
    === canonical(Object.fromEntries(DESCRIPTOR_FIELDS.map((field) => [field, right?.[field]])));
}

/**
 * Durable compiler adapter. Historical reconstruction reads one content-addressed
 * snapshot and one fixed milestone capsule; it never scans publication history.
 */
export function createMakerV8PublicationCompilerAdapterV8({
  persistence,
  compilerRpc,
  loadRuntimeAttestation,
  now = () => Date.now(),
} = {}) {
  requireMethod(persistence, 'getBlob', 'persistence');
  requireMethod(persistence, 'loadHead', 'persistence');
  requireMethod(persistence, 'loadPlan', 'persistence');
  requireMethod(compilerRpc, 'loadTrustedContext', 'compilerRpc');
  requireMethod(compilerRpc, 'recoverCheckpoint', 'compilerRpc');
  if (typeof loadRuntimeAttestation !== 'function') {
    fail(
      'MAKER_V8_PUBLICATION_PACKAGE_ATTESTATION_REQUIRED',
      'Compiler adapter requires a fresh seven-package runtime attestation provider.',
    );
  }
  const authority = Object.freeze({
    schemaVersion: 'animacraft.maker-v8-publication-in-process-authority.v1',
  });
  const kindAuthority = createCompilerKindAuthority();
  COMPILER_KIND_AUTHORITIES.set(authority, kindAuthority);

  async function freshBundle({ signerAddress, transport, expectedContext = null, expectedAuthority = null }) {
    const [context, attestation] = await Promise.all([
      compilerRpc.loadTrustedContext({ signerAddress, transport: clone(transport) }),
      loadRuntimeAttestation({ signerAddress, transport: clone(transport) }),
    ]);
    const observedAuthority = await authorityFromContext(context, attestation);
    if (expectedContext) await assertMakerV8CompilerContextFreshV8(expectedContext, context);
    if (expectedAuthority) assertAuthority(expectedAuthority, observedAuthority);
    return Object.freeze({ context, authority: observedAuthority });
  }

  async function successorPredecessor(document, context) {
    if (document.lineage.version === 1) return null;
    requireMethod(compilerRpc, 'loadSuccessorPredecessor', 'compilerRpc');
    const raw = await compilerRpc.loadSuccessorPredecessor({
      signerAddress: context.signerAddress,
      previousRootId: document.lineage.previousRootId,
      previousVersionCommitment: document.lineage.previousVersionCommitment,
      makerKey: document.lineage.makerKey,
      makerVersion: document.lineage.version,
    });
    return certifyMakerV8SuccessorPredecessorV8(context, clone(raw));
  }

  async function durablePublication(plan, requireFreshAuthority) {
    await assertMakerV8PublicationPlanIdentityV8(plan);
    const assetReads = plan.blobRefs.assets.map(async (entry) => ({
      assetId: entry.assetId,
      data: await readMakerV8PublicationBlobV8(
        persistence, entry.blob, `publication asset ${entry.assetId}`,
      ),
    }));
    const [documentText, manifestText, contextText, assets] = await Promise.all([
      readMakerV8PublicationBlobV8(persistence, plan.blobRefs.document, 'Maker document'),
      readMakerV8PublicationBlobV8(persistence, plan.blobRefs.transportMetadata, 'Maker manifest'),
      readMakerV8PublicationBlobV8(persistence, plan.blobRefs.compilerContext, 'compiler context'),
      Promise.all(assetReads),
    ]);
    let document;
    let snapshot;
    try {
      document = JSON.parse(documentText);
      snapshot = JSON.parse(contextText);
      if (canonical(document) !== documentText || canonical(snapshot) !== contextText) throw new Error('canonical');
    } catch {
      fail('MAKER_V8_PUBLICATION_SNAPSHOT_INVALID', 'Durable document or compiler context is not canonical JSON.');
    }
    exact(snapshot, ['schemaVersion', 'context', 'transport', 'predecessor'], 'compiler context snapshot');
    exact(snapshot.transport, ['manifest', 'assets', 'livingContent'], 'compiler transport snapshot');
    exact(snapshot.transport.manifest, ['blobId'], 'compiler manifest snapshot');
    if (snapshot.schemaVersion !== MAKER_V8_PUBLICATION_CONTEXT_SNAPSHOT_SCHEMA
      || !Array.isArray(snapshot.transport.assets)
      || snapshot.transport.assets.length !== assets.length) {
      fail('MAKER_V8_PUBLICATION_SNAPSHOT_INVALID', 'Durable compiler context snapshot is incomplete.');
    }
    const bytesById = new Map(assets.map((entry) => [entry.assetId, entry.data]));
    const transportAssets = snapshot.transport.assets.map((entry, index) => {
      exact(entry, ['assetId', 'blobId', 'mediaType'], `compiler transport asset[${index}]`);
      const data = bytesById.get(entry.assetId);
      if (data == null || plan.blobRefs.assets[index]?.assetId !== entry.assetId) {
        fail('MAKER_V8_PUBLICATION_SNAPSHOT_INVALID', 'Durable compiler asset identities drifted.');
      }
      return { ...entry, bytesBase64: data };
    });
    const transport = {
      manifest: {
        blobId: snapshot.transport.manifest.blobId,
        bytesBase64: toBase64(encoder.encode(manifestText)),
      },
      assets: transportAssets,
      livingContent: livingContentEvidence(snapshot.transport.livingContent),
    };
    const context = await certifyMakerV8TrustedContext({
      ...clone(snapshot.context),
      transport: clone(transport),
    });
    const predecessor = snapshot.predecessor === null
      ? null : certifyMakerV8SuccessorPredecessorV8(context, clone(snapshot.predecessor));
    const publication = await compileMakerV8Publication(document, context, predecessor);
    const durableAuthority = await authorityFromContext(context, {
      packageTuple: plan.immutable.compilerAuthority.packageTuple.map((entry) => ({
        role: entry.role,
        originalPackageId: entry.originalPackageId,
        callablePackageId: entry.callablePackageId,
        packageDigest: entry.packageDigest,
      })),
      coreArtifact: plan.immutable.compilerAuthority.coreArtifact,
    });
    assertAuthority(plan.immutable.compilerAuthority, durableAuthority);
    if (publication.manifest.sha256 !== plan.immutable.manifestSha256
      || publication.commitments.content !== plan.immutable.contentCommitment
      || context._derived.protocolProfileCommitment !== plan.immutable.protocolProfileCommitment
      || context._derived.coreArtifactCommitment !== plan.immutable.coreArtifactCommitment
      || context.signerAddress !== plan.immutable.signerAddress
      || document.lineage.makerKey !== plan.immutable.makerKey) {
      fail('MAKER_V8_PUBLICATION_SNAPSHOT_DRIFT', 'Recompiled publication differs from immutable durable commitments.');
    }
    if (requireFreshAuthority) {
      await freshBundle({
        signerAddress: context.signerAddress,
        transport,
        expectedContext: context,
        expectedAuthority: plan.immutable.compilerAuthority,
      });
      if (predecessor !== null) {
        const livePredecessor = await successorPredecessor(document, context);
        if (canonical(livePredecessor) !== canonical(predecessor)) {
          fail('MAKER_V8_PUBLICATION_SUCCESSOR_PREDECESSOR_DRIFT', 'Archived predecessor changed before successor signing.');
        }
      }
    }
    return { publication, transport };
  }

  async function historicalProgress(publication, anchor, raw) {
    const value = clone(raw);
    if (Object.hasOwn(value, 'inputAdminCap') || Object.hasOwn(value, 'adminCap')) return value;
    requireMethod(compilerRpc, 'recoverOwnedReferenceProgress', 'compilerRpc');
    const proof = await compilerRpc.recoverOwnedReferenceProgress({
      publication, adminCap: anchor, digest: value.transactionDigest,
      transactionKindBytesBase64: value.transactionKindBytesBase64,
    });
    exact(proof, ['inputAdminCap', 'adminCap'], 'historical owned-reference progression');
    return { ...value, ...clone(proof) };
  }

  async function compilerState(plan, head, requireFreshAuthority) {
    const { publication, transport } = await durablePublication(plan, requireFreshAuthority);
    const state = {
      publication,
      transport,
      capsule: null,
      scaffold: null,
      base: null,
      companion: null,
      priorBase: null,
      priorActivation: null,
    };
    if (plan.head !== null) {
      const capsule = validateCapsule(head, plan);
      state.capsule = capsule;
      const milestones = capsule.milestones;
      state.scaffold = await certifyMakerV8ScaffoldReadback(
        publication, clone(milestones.scaffold.readback),
      );
      if (milestones.baseFinal) {
        const certificate = await rehydrateMakerV8BaseChunkCertificateV8(
          publication,
          state.scaffold,
          {
            checkpoint: clone(milestones.baseFinal.checkpoint),
            readback: await historicalProgress(publication, state.scaffold.adminCap, milestones.baseFinal.readback),
          },
        );
        if (!certificate.base) {
          fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Final Base milestone did not rebuild a sealed Base certificate.');
        }
        state.base = certificate.base;
      }
      if (milestones.companion) {
        if (!state.base) fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Companion milestone lacks sealed Base state.');
        state.companion = await certifyMakerV8CompanionReadback(
          publication, state.base, await historicalProgress(publication, state.base.adminCap, milestones.companion.readback),
        );
      }
      if (milestones.progress?.kind === 'BASE_CHUNK') {
        state.priorBase = await rehydrateMakerV8BaseChunkCertificateV8(
          publication,
          state.scaffold,
          {
            checkpoint: clone(milestones.progress.checkpoint),
            readback: await historicalProgress(publication, state.scaffold.adminCap, milestones.progress.readback),
          },
        );
      }
      if (milestones.progress?.kind === 'ACTIVATION_CHUNK') {
        if (!state.base || !state.companion) {
          fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Activation milestone lacks fixed Base/Companion state.');
        }
        state.priorActivation = await rehydrateMakerV8ActivationChunkCertificateV8(
          publication,
          state.base,
          state.companion,
          {
            checkpoint: clone(milestones.progress.checkpoint),
            readback: await historicalProgress(publication, state.base.adminCap, milestones.progress.readback),
          },
        );
      }
    } else if (head !== null) {
      fail('MAKER_V8_PUBLICATION_HEAD_DRIFT', 'Publication without a durable head cannot accept historical evidence.');
    }
    freeze(state);
    COMPILER_STATES.add(state);
    return state;
  }

  async function nextBuild(state, head) {
    if (!COMPILER_STATES.has(state)) fail('MAKER_V8_PUBLICATION_COMPILER_STATE_REQUIRED', 'Branded compiler state is required.');
    const kind = expectedNextKind(head);
    if (kind === 'SCAFFOLD') {
      return { kind, build: buildMakerV8ScaffoldTransaction(state.publication) };
    }
    if (kind === 'BASE_CHUNK') {
      if (!state.scaffold) fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Base build lacks certified Scaffold state.');
      return {
        kind,
        build: await buildMakerV8BaseChunkTransaction(
          state.publication, state.scaffold, state.priorBase,
        ),
      };
    }
    if (kind === 'COMPANION_OBJECTS') {
      if (!state.base) fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Companion build lacks certified sealed Base state.');
      return {
        kind,
        build: await buildMakerV8CompanionObjectsTransaction(state.publication, state.base),
      };
    }
    if (!state.base || !state.companion) {
      fail('MAKER_V8_PUBLICATION_CAPSULE_INVALID', 'Activation build lacks fixed Base/Companion state.');
    }
    return {
      kind,
      build: await buildMakerV8ActivationChunkTransaction(
        state.publication, state.base, state.companion, state.priorActivation,
      ),
    };
  }

  async function attestBuild(plan, head, state) {
    const next = await nextBuild(state, head);
    const built = await descriptorFromBuild({
      ordinal: (head?.ordinal ?? -1) + 1,
      kind: next.kind,
      build: next.build,
      publication: state.publication,
      head,
    });
    if (plan.current && !exactDescriptor(plan.current, built.descriptor)) {
      fail('MAKER_V8_PUBLICATION_COMPILER_REHYDRATION_DRIFT', 'Rebuilt compiler descriptor differs from durable plan.');
    }
    return { ...built, build: next.build };
  }

  async function prepareTransportManifest(input) {
    exact(input, [
      'document', 'signerAddress', 'assetTransports', 'manifestBlobIdPlaceholder', 'livingContentTransport',
    ], 'publication transport preparation input');
    const signerAddress = address(input.signerAddress, 'publication signer');
    const candidate = transportManifestCandidate(
      clone(input.document),
      clone(input.assetTransports),
      input.manifestBlobIdPlaceholder,
      input.livingContentTransport,
    );
    const transportProof = transportEvidence(candidate.transport);
    const fresh = await freshBundle({ signerAddress, transport: candidate.transport });
    const predecessor = await successorPredecessor(input.document, fresh.context);
    const publication = await compileMakerV8Publication(clone(input.document), fresh.context, predecessor);
    if (publication.manifest.json !== transportProof.manifestText
      || publication.manifest.sha256 !== candidate.manifest.sha256
      || publication.manifest.blobId !== candidate.manifest.blobIdPlaceholder) {
      fail(
        'MAKER_V8_PUBLICATION_MANIFEST_DRIFT',
        'Fresh compiler output differs from the canonical transport preparation.',
      );
    }
    return freeze({
      schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_SCHEMA,
      signerAddress,
      manifest: clone(candidate.manifest),
      requiredAssets: clone(candidate.requiredAssets),
    });
  }

  async function prepareProtectedAssetIdentities(input) {
    exact(input, [
      'document', 'signerAddress', 'assetTransports', 'manifestBlobIdPlaceholder', 'livingContentTransport',
    ], 'protected publication asset preparation input');
    const signerAddress = address(input.signerAddress, 'publication signer');
    livingContentEvidence(input.livingContentTransport);
    const living = await compileMakerV8LivingContentV8(input.document);
    if (toBase64(Uint8Array.from(living.bytes)) !== input.livingContentTransport.bytesBase64) {
      fail('MAKER_V8_LIVING_TRANSPORT_MISMATCH', 'Living Content transport must contain the exact compiled author bundle.');
    }
    const publicDocument = projectPublicMakerV8Document(clone(input.document));
    const protectedByAsset = new Map();
    for (const part of publicDocument.parts) for (const item of part.items) for (const style of item.styles) {
      if (style.protected !== true) continue;
      if (protectedByAsset.has(style.assetId)) {
        fail('MAKER_V8_PROTECTED_ASSET_IDENTITY_AMBIGUOUS', `Protected asset ${style.assetId} is shared by multiple public Styles.`);
      }
      protectedByAsset.set(style.assetId, {
        partKey: part.key,
        itemKey: item.key,
        styleKey: style.key,
      });
    }
    if (protectedByAsset.size === 0) {
      return freeze({
        schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_SCHEMA,
        signerAddress,
        assets: [],
      });
    }
    bindMakerV8SourceAssets(input.document, input.assetTransports.map(asset => {
      const bytes = canonicalBase64(asset.bytesBase64, 'source asset');
      return { assetId: asset.assetId, mediaType: asset.mediaType, byteLength: bytes.length, sha256: hashBytes(bytes) };
    }), { requireExisting: true });
    const provisionalTransports = clone(input.assetTransports).map((asset) => (
      protectedByAsset.has(asset.assetId)
        ? { ...asset, mediaType: MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE }
        : asset
    ));
    const candidate = transportManifestCandidate(
      clone(input.document),
      provisionalTransports,
      input.manifestBlobIdPlaceholder,
      input.livingContentTransport,
    );
    const fresh = await freshBundle({ signerAddress, transport: candidate.transport });
    const predecessor = await successorPredecessor(input.document, fresh.context);
    const publication = await compileMakerV8Publication(clone(input.document), fresh.context, predecessor);
    const byAsset = new Map(publication.rows.style
      .filter((row) => row.protected)
      .map((row) => [row.source.style.assetId, row]));
    const assets = [...protectedByAsset.entries()].map(([assetId, semantic]) => {
      const row = byAsset.get(assetId);
      if (!row) {
        fail('MAKER_V8_PROTECTED_ASSET_IDENTITY_MISSING', `Protected asset ${assetId} did not compile into one public Base Style.`);
      }
      return freeze({
        assetId,
        semantic: freeze(semantic),
        identity: freeze({
          schemaVersion: MAKER_V8_PROTECTED_ASSET_IDENTITY_SCHEMA,
          signer: signerAddress,
          scopeKind: 0,
          scopeKey: 'maker/base',
          assetKey: `${semantic.partKey}/${semantic.itemKey}/${semantic.styleKey}`,
          rootContentCommitment: publication.commitments.content,
          makerVersion: String(publication.document.lineage.version),
          releasePackageId: fresh.context.catalog.fields.roles.release.originalPackageId,
          productBindingCommitment: fresh.context._derived.productBindingCommitment,
          policyCommitment: fresh.context._derived.sealPolicyCommitment,
          sealPolicyConfigId: objectId(fresh.context.configs.seal, 'configs.seal'),
          assetContentCommitment: toHex(row.payload_commitment),
        }),
      });
    }).sort((left, right) => compareText(left.assetId, right.assetId));
    return freeze({
      schemaVersion: MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_SCHEMA,
      signerAddress,
      assets,
    });
  }

  async function prepare(input) {
    exact(input, ['document', 'transport', 'signerAddress', 'attemptNonce'], 'publication prepare input');
    const signerAddress = address(input.signerAddress, 'publication signer');
    if (typeof input.attemptNonce !== 'string' || !input.attemptNonce
      || encoder.encode(input.attemptNonce).length > 192) {
      fail('MAKER_V8_PUBLICATION_ATTEMPT_NONCE_INVALID', 'Publication attempt nonce is invalid.');
    }
    const transport = clone(input.transport);
    const transportProof = transportEvidence(transport);
    const fresh = await freshBundle({ signerAddress, transport });
    const predecessor = await successorPredecessor(input.document, fresh.context);
    const publication = await compileMakerV8Publication(clone(input.document), fresh.context, predecessor);
    if (publication.manifest.json !== transportProof.manifestText
      || publication.manifest.sha256 !== hashBytes(encoder.encode(transportProof.manifestText))) {
      fail(
        'MAKER_V8_PUBLICATION_MANIFEST_DRIFT',
        'Final compiler preparation differs from the exact uploaded Manifest bytes.',
      );
    }
    const documentText = canonical(publication.document);
    const contextText = canonical(compilerContextSnapshot(fresh.context, transport, predecessor));
    const assetBlobs = await Promise.all(transportProof.assets.map(async (asset) => ({
      assetId: asset.assetId,
      blob: await makerV8Base64BlobV8(asset.bytesBase64),
    })));
    const [documentBlob, manifestBlob, contextBlob] = await Promise.all([
      makerV8Utf8BlobV8(documentText),
      makerV8Utf8BlobV8(transportProof.manifestText),
      makerV8Utf8BlobV8(contextText),
    ]);
    const blobRefs = {
      document: makerV8BlobRefV8(documentBlob),
      transportMetadata: makerV8BlobRefV8(manifestBlob),
      compilerContext: makerV8BlobRefV8(contextBlob),
      assets: assetBlobs.map(({ assetId, blob }) => ({ assetId, blob: makerV8BlobRefV8(blob) })),
    };
    const immutable = {
      chainIdentifier: fresh.context.chainIdentifier,
      paymentCoinType: fresh.context.paymentCoinType,
      signerAddress,
      makerKey: publication.document.lineage.makerKey,
      manifestSha256: publication.manifest.sha256,
      contentCommitment: publication.commitments.content,
      protocolProfileCommitment: fresh.context._derived.protocolProfileCommitment,
      coreArtifactCommitment: fresh.context._derived.coreArtifactCommitment,
      blobRefsCommitment: await makerV8PublicationBlobRefsCommitmentV8(blobRefs),
      compilerAuthority: fresh.authority,
    };
    const [scopeKey, planId] = await Promise.all([
      makerV8PublicationScopeKeyV8(immutable),
      makerV8PublicationPlanIdV8(immutable),
    ]);
    const attemptId = await makerV8PublicationAttemptIdV8({
      planId, scopeKey, attemptNonce: input.attemptNonce,
    });
    const initialBuild = buildMakerV8ScaffoldTransaction(publication);
    const built = await descriptorFromBuild({
      ordinal: 0,
      kind: 'SCAFFOLD',
      build: initialBuild,
      publication,
      head: null,
    });
    kindAuthority.authorizeCompilerTransaction({
      signer: signerAddress,
      kindBytes: built.kindBytes,
      transaction: built.transaction,
    });
    const kindBlob = await makerV8Base64BlobV8(built.kindBytes);
    const createdAt = Number(now());
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      fail('MAKER_V8_PUBLICATION_CLOCK_INVALID', 'Publication clock must return a non-negative safe integer.');
    }
    const current = {
      ...clone(built.descriptor),
      transactionKindRef: makerV8BlobRefV8(kindBlob),
      fullTransactionRef: null,
      signatureRef: null,
      outcome: { status: 'READY' },
    };
    const plan = {
      schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
      attemptId,
      attemptNonce: input.attemptNonce,
      planId,
      scopeKey,
      status: 'ACTIVE',
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      immutable,
      blobRefs,
      head: null,
      current,
      nextPreparation: null,
      terminal: null,
      attemptHistory: {
        totalEvents: 0,
        excessEvents: 0,
        globalAttemptHeadSha256: null,
      },
    };
    await assertMakerV8PublicationPlanIdentityV8(plan);
    const state = freeze({
      publication,
      transport,
      capsule: null,
      scaffold: null,
      base: null,
      companion: null,
      priorBase: null,
      priorActivation: null,
    });
    COMPILER_STATES.add(state);
    return Object.freeze({
      plan,
      blobs: [
        documentBlob,
        manifestBlob,
        contextBlob,
        ...assetBlobs.map(({ blob }) => blob),
        kindBlob,
      ],
      attested: Object.freeze({
        authority,
        signerAddress,
        transaction: built.transaction,
        transactionKindBytes: built.kindBytes,
        descriptor: built.descriptor,
        compilerState: state,
        compilerBuild: initialBuild,
      }),
    });
  }

  async function rehydrate(input) {
    exact(input, [
      'plan', 'head', 'transactionKindBytes', 'purpose', 'requireFreshAuthority',
    ], 'publication rehydrate input');
    if (typeof input.purpose !== 'string' || !input.purpose
      || typeof input.requireFreshAuthority !== 'boolean' || !input.plan?.current) {
      fail('MAKER_V8_PUBLICATION_REHYDRATE_INVALID', 'Publication rehydrate input is incomplete.');
    }
    const state = await compilerState(input.plan, input.head, input.requireFreshAuthority);
    const built = await attestBuild(input.plan, input.head, state);
    const durable = transactionKindProof(input.transactionKindBytes, 'durable TransactionKind');
    if (built.kindBytes !== durable.base64
      || built.descriptor.transactionKindSha256 !== durable.sha256) {
      fail('MAKER_V8_PUBLICATION_COMPILER_REHYDRATION_DRIFT', 'Rebuilt TransactionKind differs byte-for-byte from durable bytes.');
    }
    kindAuthority.authorizeCompilerTransaction({
      signer: input.plan.immutable.signerAddress,
      kindBytes: durable.base64,
      transaction: built.transaction,
    });
    const durableDigest = input.plan.current.outcome?.digest;
    if (durableDigest !== null && durableDigest !== undefined
      && input.plan.current.fullTransactionRef !== null) {
      const reread = await persistence.loadPlan(input.plan.attemptId);
      if (!reread || canonical(reread) !== canonical(input.plan)) {
        fail(
          'MAKER_V8_PUBLICATION_DURABLE_PLAN_DRIFT',
          'Compiler transaction recovery requires an exact cold reread of the durable publication plan.',
        );
      }
      if (input.plan.current.signatureRef === null) {
        fail(
          'MAKER_V8_PUBLICATION_SIGNED_ARTIFACT_REQUIRED',
          'A durable TransactionData recovery proof requires its content-addressed wallet signature.',
        );
      }
      const [transactionBytes, signature] = await Promise.all([
        readMakerV8PublicationBlobV8(
          persistence,
          input.plan.current.fullTransactionRef,
          'durable publication TransactionData',
        ),
        readMakerV8PublicationBlobV8(
          persistence,
          input.plan.current.signatureRef,
          'durable publication signature',
        ),
      ]);
      canonicalBase64(signature, 'durable publication signature');
      const transaction = transactionDataProof(transactionBytes, {
        sender: input.plan.immutable.signerAddress,
        kindBytes: durable.base64,
        digest: durableDigest,
      });
      kindAuthority.authorizeTransaction({
        digest: transaction.digest,
        signer: input.plan.immutable.signerAddress,
        kindBytes: durable.base64,
        signature,
      });
    }
    return Object.freeze({
      authority,
      signerAddress: input.plan.immutable.signerAddress,
      transaction: built.transaction,
      transactionKindBytes: built.kindBytes,
      descriptor: built.descriptor,
      compilerState: state,
      compilerBuild: built.build,
    });
  }

  async function certifyFinalized(input) {
    exact(input, ['plan', 'query', 'attested', 'artifacts'], 'publication finalized certification input');
    const { plan, query, attested, artifacts } = input;
    const state = attested?.compilerState;
    if (!COMPILER_STATES.has(state) || !plan?.current
      || attested.authority !== authority || !(attested.transaction instanceof Transaction)) {
      fail('MAKER_V8_PUBLICATION_COMPILER_STATE_REQUIRED', 'Finalized certification requires the exact rehydrated compiler state.');
    }
    const finality = finalityEvidence(query);
    if (query.digest !== plan.current.outcome?.digest || artifacts?.digest !== query.digest) {
      fail('MAKER_V8_PUBLICATION_FINALITY_INVALID', 'Finality digest differs from durable signed artifacts.');
    }
    transactionDataProof(artifacts.bytes, {
      sender: plan.immutable.signerAddress,
      kindBytes: artifacts.kindBytes,
      digest: artifacts.digest,
    });
    if (artifacts.kindBytes !== attested.transactionKindBytes) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_DRIFT', 'Finalized artifact kind differs from compiler attestation.');
    }
    const raw = await compilerRpc.recoverCheckpoint({
      kind: plan.current.kind,
      digest: query.digest,
      build: attested.compilerBuild,
      transaction: attested.transaction,
      publication: state.publication,
      transport: clone(state.transport),
      scaffold: state.scaffold,
      base: state.base,
      companion: state.companion,
    });
    if (plan.current.kind === 'SCAFFOLD') {
      await certifyMakerV8ScaffoldReadback(state.publication, clone(raw));
    } else if (plan.current.kind === 'BASE_CHUNK') {
      await certifyMakerV8BaseChunkReadback(
        state.publication, state.scaffold, attested.compilerBuild, clone(raw),
      );
    } else if (plan.current.kind === 'COMPANION_OBJECTS') {
      await certifyMakerV8CompanionReadback(state.publication, state.base, clone(raw));
    } else if (plan.current.kind === 'ACTIVATION_CHUNK') {
      await certifyMakerV8ActivationChunkReadback(
        state.publication,
        state.base,
        state.companion,
        attested.compilerBuild,
        clone(raw),
      );
    } else {
      fail('MAKER_V8_PUBLICATION_COMPILER_KIND_INVALID', 'Unknown compiler publication kind.');
    }
    let priorCapsule = null;
    if (plan.head) {
      const priorHead = await persistence.loadHead(plan.attemptId);
      priorCapsule = validateCapsule(priorHead, plan);
    }
    const milestones = priorCapsule ? clone(priorCapsule.milestones) : {
      scaffold: null,
      baseFinal: null,
      companion: null,
      progress: null,
    };
    const current = milestone(plan.current.kind, plan.current.compilerCheckpoint, raw);
    if (plan.current.kind === 'SCAFFOLD') milestones.scaffold = current;
    if (plan.current.kind === 'BASE_CHUNK') {
      if (plan.current.compilerCheckpoint.final) {
        milestones.baseFinal = current;
        milestones.progress = null;
      } else milestones.progress = current;
    }
    if (plan.current.kind === 'COMPANION_OBJECTS') milestones.companion = current;
    if (plan.current.kind === 'ACTIVATION_CHUNK') milestones.progress = current;
  return freeze({
      schemaVersion: MAKER_V8_PUBLICATION_CAPSULE_SCHEMA,
      ordinal: plan.current.ordinal,
      kind: plan.current.kind,
      transactionDigest: query.digest,
      transactionKindSha256: plan.current.transactionKindSha256,
      authorityCommitment: plan.immutable.compilerAuthority.trustedContextCommitment,
      finality,
      milestones,
    });
  }

  async function prepareUnsignedReferenceRepair(input) {
    exact(input, ['plan', 'head', 'transactionKindBytes'], 'unsigned reference repair');
    const { plan, head } = input;
    if (!plan.head || plan.status !== 'ACTIVE' || plan.current?.outcome.status !== 'READY'
      || plan.current.fullTransactionRef !== null || plan.current.signatureRef !== null
      || await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal)) {
      fail('MAKER_V8_PUBLICATION_UNSIGNED_REPAIR_INVALID', 'Only a never-attempted unsigned cursor can refresh its proved owned reference.');
    }
    const state = await compilerState(plan, head, true);
    const built = await attestBuild({ ...plan, current: null }, head, state);
    const expected = { ...built.descriptor, transactionKindSha256: plan.current.transactionKindSha256 };
    if (!exactDescriptor(plan.current, expected)) {
      fail('MAKER_V8_PUBLICATION_UNSIGNED_REPAIR_INVALID', 'Owned-reference repair changed compiler stage or semantics.');
    }
    const adminCap = state.priorActivation?.adminCap ?? state.companion?.adminCap
      ?? state.priorBase?.adminCap ?? state.base?.adminCap ?? state.scaffold?.adminCap;
    assertMakerV8UnsignedOwnedReferenceDeltaV8(input.transactionKindBytes, built.kindBytes, adminCap.reference);
    return Object.freeze({ descriptor: built.descriptor, transactionKindBytes: built.kindBytes });
  }

  async function prepareSuccessor(input) {
    exact(input, ['plan', 'head', 'requireFreshAuthority'], 'publication successor input');
    if (input.requireFreshAuthority !== true || input.plan?.current !== null
      || input.plan?.nextPreparation?.status !== 'REQUIRED') {
      fail('MAKER_V8_PUBLICATION_SUCCESSOR_INVALID', 'Successor requires one fresh-authority durable boundary.');
    }
    const state = await compilerState(input.plan, input.head, true);
    const built = await attestBuild(input.plan, input.head, state);
    kindAuthority.authorizeCompilerTransaction({
      signer: input.plan.immutable.signerAddress,
      kindBytes: built.kindBytes,
      transaction: built.transaction,
    });
    return Object.freeze({
      authority,
      signerAddress: input.plan.immutable.signerAddress,
      transaction: built.transaction,
      transactionKindBytes: built.kindBytes,
      descriptor: built.descriptor,
      compilerState: state,
      compilerBuild: built.build,
      blobs: [],
    });
  }

  return Object.freeze({
    schemaVersion: MAKER_V8_PUBLICATION_ADAPTERS_SCHEMA,
    authority,
    prepareTransportManifest,
    prepareProtectedAssetIdentities,
    prepare,
    rehydrate,
    certifyFinalized,
    prepareSuccessor,
    prepareUnsignedReferenceRepair,
    async describeFinalized(plan, head) {
      // Recompile durable commitments and recertify every milestone before
      // projecting the Root identity. A scaffold alone never means COMPLETE.
      const state = await compilerState(plan, head, false);
      if (!state.scaffold) return null;
      return freeze({ rootId: state.scaffold.root.reference.objectId,
        makerVersion: state.publication.document.lineage.version,
        complete: plan.status === 'COMPLETE' && state.capsule?.kind === 'ACTIVATION_CHUNK' });
    },
  });
}

function executionConfig(value) {
  exact(value, [
    'network', 'chainIdentifier', 'allowWalletSignature', 'allowBroadcast',
  ], 'publication boundary execution');
  if (value.network !== MAKER_V8_CHAIN_NETWORK
    || value.chainIdentifier !== MAKER_V8_MAINNET_CHAIN_IDENTIFIER
    || typeof value.allowWalletSignature !== 'boolean'
    || value.allowWalletSignature !== value.allowBroadcast) {
    fail('MAKER_V8_PUBLICATION_EXECUTION_INVALID', 'Publication execution must pin Mainnet and gate signing/broadcast together.');
  }
  return Object.freeze({ ...value });
}

/** Canonical SDK TransactionData plus strict Sui gRPC simulation/execution boundary. */
export function createMakerV8PublicationBoundaryAdapterV8({
  client,
  compilerAuthority,
  execution = {
    network: MAKER_V8_CHAIN_NETWORK,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: false,
    allowBroadcast: false,
  },
  assertTransport = assertMakerV8SuiGrpcTransport,
} = {}) {
  if (typeof assertTransport !== 'function') {
    fail('MAKER_V8_PUBLICATION_ADAPTER_DEPENDENCY_INVALID', 'assertTransport is required.');
  }
  assertTransport(client);
  const gates = executionConfig(execution);
  const kindAuthority = COMPILER_KIND_AUTHORITIES.get(compilerAuthority);
  if (!kindAuthority) {
    fail(
      'MAKER_V8_PUBLICATION_COMPILER_AUTHORITY_INVALID',
      'Boundary requires the exact in-process publication compiler authority.',
    );
  }
  const built = new Map();

  const assertPinned = async () => {
    requireMethod(client, 'getChainIdentifier', 'Sui gRPC transport');
    const response = await client.getChainIdentifier();
    const observed = typeof response === 'string' ? response : response?.chainIdentifier;
    if (observed !== MAKER_V8_SUI_MAINNET_GENESIS_DIGEST) {
      fail('MAKER_V8_PUBLICATION_NETWORK_DRIFT', 'Sui gRPC transport no longer identifies Mainnet.');
    }
  };

  async function buildExactTransaction(input) {
    exact(input, ['transaction', 'sender', 'expectedKindBytes'], 'publication build input');
    if (!(input.transaction instanceof Transaction)) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_REQUIRED', 'Boundary requires a compiler-produced Sui Transaction.');
    }
    const sender = address(input.sender, 'publication sender');
    const expectedKind = transactionKindProof(input.expectedKindBytes, 'expected TransactionKind');
    kindAuthority.requireCompilerTransaction({
      signer: sender,
      kindBytes: expectedKind.base64,
      transaction: input.transaction,
    });
    const before = transactionKindProof(
      await input.transaction.build({ onlyTransactionKind: true }),
      'compiler TransactionKind',
    );
    if (input.transaction.getData().sender !== sender || before.base64 !== expectedKind.base64) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_DRIFT', 'Compiler Transaction sender or kind differs before gas resolution.');
    }
    await assertPinned();
    requireMethod(client?.core, 'getCurrentSystemState', 'Sui gRPC core');
    const system = await client.core.getCurrentSystemState();
    const epoch = system?.systemState?.epoch;
    if (typeof epoch !== 'string' || !UINT.test(epoch)) {
      fail('MAKER_V8_PUBLICATION_EPOCH_INVALID', 'Sui gRPC current epoch is unavailable.');
    }
    input.transaction.setExpiration(makerV8PublicationExpiration(epoch));
    const raw = await input.transaction.build({ client });
    await assertPinned();
    const after = transactionKindProof(
      await input.transaction.build({ onlyTransactionKind: true }),
      'resolved compiler TransactionKind',
    );
    if (after.base64 !== expectedKind.base64) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_DRIFT', 'Gas resolution changed the compiler TransactionKind.');
    }
    const proof = transactionDataProof(raw, { sender, kindBytes: expectedKind.base64, digest: null });
    built.set(proof.base64, Object.freeze({
      sender,
      kindBytes: expectedKind.base64,
      digest: proof.digest,
    }));
    while (built.size > 32) built.delete(built.keys().next().value);
    return Object.freeze({ bytes: proof.base64, digest: proof.digest });
  }

  async function dryRunExactTransaction(input) {
    exact(input, [
      'bytes', 'transactionBytes', 'digest', 'signer', 'expectedKindBytes', 'transaction',
    ], 'publication dry-run input');
    if (input.bytes !== input.transactionBytes) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_DATA_DRIFT', 'Dry-run aliases contain different TransactionData.');
    }
    const signer = address(input.signer, 'publication signer');
    const proof = transactionDataProof(input.bytes, {
      sender: signer,
      kindBytes: input.expectedKindBytes,
      digest: input.digest,
    });
    const registered = built.get(proof.base64);
    if (!(input.transaction instanceof Transaction)) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_REQUIRED', 'Dry-run requires a compiler-produced Sui Transaction.');
    }
    const liveKind = transactionKindProof(
      await input.transaction.build({ onlyTransactionKind: true }),
      'dry-run compiler TransactionKind',
    );
    if (!registered || registered.sender !== signer || registered.digest !== proof.digest
      || registered.kindBytes !== input.expectedKindBytes) {
      fail('MAKER_V8_PUBLICATION_BUILD_PROOF_REQUIRED', 'Dry-run accepts only freshly built exact compiler bytes.');
    }
    if (input.transaction.getData().sender !== signer || liveKind.base64 !== registered.kindBytes) {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_DRIFT', 'Dry-run transaction instance differs from the compiler kind proof.');
    }
    await assertPinned();
    requireMethod(client?.core, 'simulateTransaction', 'Sui gRPC core');
    const result = await client.core.simulateTransaction({
      transaction: proof.bytes,
      include: { effects: true },
    });
    await assertPinned();
    const simulated = result?.$kind === 'Transaction' ? result.Transaction
      : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
    if (!simulated || simulated.digest !== proof.digest
      || typeof simulated.effects?.transactionDigest !== 'string') {
      fail('MAKER_V8_PUBLICATION_SIMULATION_DRIFT', 'Sui gRPC simulation returned another transaction.');
    }
    suiDigest(simulated.effects.transactionDigest, 'simulation effects transaction digest');
    if (result.$kind !== 'Transaction' || simulated.status?.success !== true
      || simulated.effects?.status?.success !== true) {
      return Object.freeze({
        status: 'FAILURE',
        error: simulated.effects?.status?.error ?? simulated.status?.error ?? null,
      });
    }
    return Object.freeze({ status: 'SUCCESS' });
  }

  async function broadcastExactTransaction(input) {
    exact(input, ['bytes', 'signature', 'digest', 'signer'], 'publication broadcast input');
    if (!gates.allowBroadcast || !gates.allowWalletSignature) {
      fail('MAKER_V8_PUBLICATION_EXECUTION_DISABLED', 'Publication exact-byte broadcast is disabled.');
    }
    const signer = address(input.signer, 'publication signer');
    const raw = canonicalBase64(input.bytes, 'TransactionData');
    let parsed;
    try {
      parsed = bcs.TransactionData.parse(raw);
    } catch {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_DATA_INVALID', 'Broadcast TransactionData is not canonical BCS.');
    }
    if (parsed?.$kind !== 'V1') {
      fail('MAKER_V8_PUBLICATION_TRANSACTION_DATA_INVALID', 'Broadcast TransactionData is not canonical V1 BCS.');
    }
    const kindBytes = toBase64(bcs.TransactionKind.serialize(parsed.V1.kind).toBytes());
    const proof = transactionDataProof(input.bytes, {
      sender: signer,
      kindBytes,
      digest: input.digest,
    });
    canonicalBase64(input.signature, 'publication signature');
    kindAuthority.requireTransaction({
      digest: proof.digest,
      signer,
      kindBytes,
      signature: input.signature,
    });
    await assertPinned();
    if (!await isValidTransactionSignature(proof.bytes, input.signature, { client, address: signer })) {
      fail('MAKER_V8_PUBLICATION_SIGNATURE_INVALID', 'Signature does not authenticate exact TransactionData and signer.');
    }
    requireMethod(client?.core, 'executeTransaction', 'Sui gRPC core');
    await assertPinned();
    const result = await client.core.executeTransaction({
      transaction: proof.bytes,
      signatures: [input.signature],
      include: { effects: true, events: true, objectTypes: true },
    });
    await assertPinned();
    const executed = result?.$kind === 'Transaction' ? result.Transaction
      : result?.$kind === 'FailedTransaction' ? result.FailedTransaction : null;
    if (!executed || executed.digest !== proof.digest
      || executed.effects?.transactionDigest !== proof.digest) {
      fail('MAKER_V8_PUBLICATION_BROADCAST_DRIFT', 'Sui gRPC execution returned another transaction digest.');
    }
    return Object.freeze({ accepted: true, digest: proof.digest });
  }

  return Object.freeze({
    schemaVersion: MAKER_V8_PUBLICATION_ADAPTERS_SCHEMA,
    execution: gates,
    buildExactTransaction,
    dryRunExactTransaction,
    broadcastExactTransaction,
  });
}

/** Production composition: browser compiler readback + runtime attestation + strict gRPC boundary. */
export function createProductionMakerV8PublicationAdaptersV8({
  client = createProductionMakerV8SuiGrpcTransport(),
  runtime,
  persistence: persistenceInput = null,
  indexedDB = globalThis.indexedDB,
  persistenceOptions,
  execution,
  now,
  walletAdapter = null,
  walletRegistry,
  walletId = null,
  dataSource = null,
} = {}) {
  assertMakerV8SuiGrpcTransport(client);
  const persistence = persistenceInput ?? createMakerV8PublicationPersistenceV8(
    indexedDB,
    persistenceOptions,
  );
  const browser = createProductionMakerV8BrowserAdapters({
    runtime,
    execution,
    client,
    walletRegistry,
    walletId,
    wallet: walletAdapter,
    dataSource,
    persistence,
  });
  const compilerRpc = browser.compiler
    ?? createMakerV8CompilerRpcAdapterV8({ client, runtime });
  const compiler = createMakerV8PublicationCompilerAdapterV8({
    persistence,
    compilerRpc,
    loadRuntimeAttestation: () => attestMakerV8Runtime(
      client, runtime, { network: MAKER_V8_CHAIN_NETWORK },
    ),
    ...(now === undefined ? {} : { now }),
  });
  const boundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: compiler.authority,
    execution,
  });
  return Object.freeze({
    schemaVersion: MAKER_V8_PUBLICATION_ADAPTERS_SCHEMA,
    client,
    persistence,
    compiler,
    boundary,
    execution: boundary.execution,
    wallet: browser.wallet,
    rpc: Object.freeze({
      queryTransaction: (request) => browser.rpc.queryTransaction(request),
    }),
  });
}
import { compileMakerV8LivingContentV8 } from './maker-v8-living-content-compiler.js';
