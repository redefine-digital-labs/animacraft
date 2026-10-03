import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  MAKER_V8_BYTE_BUDGETS,
  MAKER_V8_TRANSACTION_LIMITS,
  exactMakerV8TransactionTargets,
} from './maker-v8-compiler.js';
import { isDefinitiveWalletStandardRejectionV8 } from './maker-v8-browser.js';
import {
  MAKER_V8_PUBLICATION_BYTE_LIMITS,
  MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
  makerV8Base64BlobV8,
  makerV8BlobRefV8,
  makerV8PublicationAttemptSha256V8,
  makerV8PublicationCheckpointSha256V8,
  readMakerV8PublicationBlobV8,
} from './maker-v8-publication-store.js';

export const MAKER_V8_PUBLICATION_CONTROLLER_SCHEMA =
  'animacraft.maker-v8-publication-controller.v1';

const DESCRIPTOR_FIELDS = Object.freeze([
  'ordinal', 'kind', 'phase', 'lane', 'action', 'startSequence', 'endSequence',
  'rowCommitments', 'preState', 'postState', 'compilerCheckpoint',
  'transactionKindSha256', 'commandCount', 'targets',
]);
const HASH = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const WAL_RESERVE_BYTES = MAKER_V8_PUBLICATION_BYTE_LIMITS.maxPlanCanonicalUtf8Bytes
  + MAKER_V8_PUBLICATION_BYTE_LIMITS.maxCheckpointCanonicalUtf8Bytes
  + MAKER_V8_PUBLICATION_BYTE_LIMITS.maxAttemptCanonicalUtf8Bytes;

export class MakerV8PublicationControllerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MakerV8PublicationControllerError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details = {}) {
  throw new MakerV8PublicationControllerError(code, message, details);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return structuredClone(value);
}

function canonicalValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

function hashBytes(bytes) {
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashValue(value) {
  return hashBytes(encoder.encode(canonical(value)));
}

function canonicalBase64(value, label) {
  try {
    if (typeof value !== 'string' || !value.length) throw new Error('empty');
    const bytes = fromBase64(value);
    if (toBase64(bytes) !== value) throw new Error('non-canonical');
    return bytes;
  } catch {
    fail('MAKER_V8_PUBLICATION_BASE64_INVALID', `${label} must be canonical Base64.`);
  }
}

function descriptor(value) {
  return Object.fromEntries(DESCRIPTOR_FIELDS.map((field) => [field, value?.[field]]));
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    fail(
      'MAKER_V8_PUBLICATION_CONTROLLER_DEPENDENCY_INVALID',
      `${label}.${method} is required.`,
    );
  }
}

function kindProof(base64, label = 'TransactionKind') {
  const bytes = canonicalBase64(base64, label);
  if (bytes.length > MAKER_V8_TRANSACTION_LIMITS.maxKindBytes) {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_LIMIT', `${label} exceeds the compiler byte limit.`);
  }
  let parsed;
  let roundTrip;
  try {
    parsed = bcs.TransactionKind.parse(bytes);
    roundTrip = bcs.TransactionKind.serialize(parsed).toBytes();
  } catch {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID', `${label} is not canonical BCS.`);
  }
  if (roundTrip.length !== bytes.length
    || roundTrip.some((byte, index) => byte !== bytes[index])
    || parsed?.$kind !== 'ProgrammableTransaction') {
    fail(
      'MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID',
      `${label} is not one canonical ProgrammableTransaction.`,
    );
  }
  const commands = parsed.ProgrammableTransaction?.commands;
  const inputs = parsed.ProgrammableTransaction?.inputs;
  if (!Array.isArray(commands) || !Array.isArray(inputs)
    || commands.length > MAKER_V8_TRANSACTION_LIMITS.maxCommands
    || inputs.length > MAKER_V8_TRANSACTION_LIMITS.maxInputs) {
    fail('MAKER_V8_PUBLICATION_TRANSACTION_KIND_LIMIT', `${label} exceeds compiler limits.`);
  }
  const targets = commands.map((command) => {
    if (command?.$kind !== 'MoveCall' || !plain(command.MoveCall)) {
      fail(
        'MAKER_V8_PUBLICATION_TRANSACTION_KIND_COMMAND_INVALID',
        'Publication TransactionKind may contain only compiler MoveCall commands.',
      );
    }
    const call = command.MoveCall;
    return `${call.package}::${call.module}::${call.function}`;
  });
  return Object.freeze({ bytes, base64, sha256: hashBytes(bytes), targets });
}

function attestedKindBase64(attested) {
  return attested?.transactionKindBytes
    ?? attested?.kindBytes
    ?? attested?.transactionKindBytesBase64
    ?? null;
}

async function assertCompilerAttestation(compiler, plan, kindBase64, attested) {
  if (!plain(attested) || attested.authority !== compiler.authority) {
    fail(
      'MAKER_V8_PUBLICATION_COMPILER_REHYDRATION_REQUIRED',
      'Publication execution requires the exact in-process compiler authority.',
    );
  }
  const durable = kindProof(kindBase64, 'durable TransactionKind');
  let rebuiltBase64 = attestedKindBase64(attested);
  if (attested.transaction instanceof Transaction) {
    const rebuilt = await attested.transaction.build({ onlyTransactionKind: true });
    const transactionBase64 = toBase64(rebuilt);
    if (rebuiltBase64 !== null && rebuiltBase64 !== transactionBase64) {
      fail(
        'MAKER_V8_PUBLICATION_COMPILER_REHYDRATION_DRIFT',
        'Compiler attestation and rebuilt TransactionKind differ.',
      );
    }
    rebuiltBase64 = transactionBase64;
    if (attested.transaction.getData().sender !== plan.immutable.signerAddress
      || canonical(exactMakerV8TransactionTargets(attested.transaction))
        !== canonical(plan.current.targets)) {
      fail(
        'MAKER_V8_PUBLICATION_COMPILER_REHYDRATION_DRIFT',
        'Compiler transaction sender or Move-call sequence differs from the durable plan.',
      );
    }
  }
  if (rebuiltBase64 === null
    || rebuiltBase64 !== durable.base64
    || attested.signerAddress !== plan.immutable.signerAddress
    || durable.sha256 !== plan.current.transactionKindSha256
    || plan.current.transactionKindRef.sha256 !== durable.sha256
    || durable.targets.length !== plan.current.commandCount
    || canonical(durable.targets) !== canonical(plan.current.targets)
    || (attested.descriptor
      && canonical(descriptor(attested.descriptor)) !== canonical(descriptor(plan.current)))) {
    fail(
      'MAKER_V8_PUBLICATION_COMPILER_REHYDRATION_DRIFT',
      'Rehydrated compiler TransactionKind, signer, hash, or descriptor drifted.',
    );
  }
  return Object.freeze({ ...attested, transactionKindBytes: durable.base64 });
}

function transactionDataProof(base64, expected) {
  const bytes = canonicalBase64(base64, 'TransactionData');
  if (bytes.length > MAKER_V8_BYTE_BUDGETS.maxTransactionDataBytes) {
    fail(
      'MAKER_V8_PUBLICATION_TRANSACTION_DATA_LIMIT',
      'TransactionData exceeds the compiler byte limit.',
    );
  }
  let parsed;
  let roundTrip;
  try {
    parsed = bcs.TransactionData.parse(bytes);
    roundTrip = bcs.TransactionData.serialize(parsed).toBytes();
  } catch {
    fail(
      'MAKER_V8_PUBLICATION_TRANSACTION_DATA_INVALID',
      'TransactionData is not canonical BCS.',
    );
  }
  if (parsed?.$kind !== 'V1'
    || roundTrip.length !== bytes.length
    || roundTrip.some((byte, index) => byte !== bytes[index])) {
    fail(
      'MAKER_V8_PUBLICATION_TRANSACTION_DATA_INVALID',
      'TransactionData is not canonical V1 BCS.',
    );
  }
  const transactionData = parsed.V1;
  const kindBytes = bcs.TransactionKind.serialize(transactionData.kind).toBytes();
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (transactionData.sender !== expected.signer
    || transactionData.gasData?.owner !== expected.signer
    || toBase64(kindBytes) !== expected.kindBytes
    || (expected.digest != null && digest !== expected.digest)) {
    fail(
      'MAKER_V8_PUBLICATION_TRANSACTION_DATA_DRIFT',
      'TransactionData sender, gas owner, TransactionKind, or digest drifted.',
    );
  }
  return Object.freeze({ bytes, base64, digest });
}

function attemptHistory(plan, attempt) {
  return {
    totalEvents: plan.attemptHistory.totalEvents + 1,
    excessEvents: plan.attemptHistory.excessEvents + (attempt.sequence >= 3 ? 1 : 0),
    globalAttemptHeadSha256: attempt.eventSha256,
  };
}

function eventCode(error) {
  const value = typeof error?.code === 'string' && error.code
    ? error.code : 'RPC_OUTCOME_UNKNOWN';
  return encoder.encode(value).length <= 128 ? value : 'RPC_OUTCOME_UNKNOWN';
}

function makeAttempt(plan, prior, status, {
  at,
  digest = plan.current?.outcome?.digest ?? null,
  fullTransactionRef = plan.current?.fullTransactionRef ?? null,
  signatureRef = plan.current?.signatureRef ?? null,
  code = null,
} = {}) {
  const source = 'WALLET';
  const signedAt = status === 'SIGNED' ? at
    : status === 'WALLET_REJECTED' ? null
      : prior?.details.signedAt ?? plan.current?.outcome?.signedAt ?? null;
  const firstSeenAt = ['SIGNED', 'WALLET_REJECTED'].includes(status) ? null
    : prior?.details.firstSeenAt ?? plan.current?.outcome?.firstSeenAt ?? at;
  const broadcastAt = status === 'BROADCAST_ACCEPTED' ? at
    : ['SIGNED', 'WALLET_REJECTED'].includes(status) ? null
      : prior?.details.broadcastAt ?? plan.current?.outcome?.broadcastAt ?? null;
  const attempt = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    attemptId: plan.attemptId,
    ordinal: plan.current.ordinal,
    sequence: prior ? prior.sequence + 1 : 0,
    status,
    digest: status === 'WALLET_REJECTED' ? null : digest,
    kindSha256: plan.current.transactionKindSha256,
    fullTransactionRef: status === 'WALLET_REJECTED' ? null : fullTransactionRef,
    signatureRef: status === 'WALLET_REJECTED' ? null : signatureRef,
    details: {
      source,
      at,
      code,
      signedAt,
      firstSeenAt,
      broadcastAt,
    },
    observedAt: at,
    previousAttemptSha256: prior?.eventSha256 ?? null,
    previousGlobalAttemptSha256: plan.attemptHistory.globalAttemptHeadSha256,
    eventSha256: '0'.repeat(64),
  };
  attempt.eventSha256 = makerV8PublicationAttemptSha256V8(attempt);
  return attempt;
}

function pendingOutcome(plan, attempt) {
  return {
    status: 'OUTCOME_PENDING',
    digest: attempt.digest,
    kindSha256: attempt.kindSha256,
    signedAt: attempt.details.signedAt,
    firstSeenAt: attempt.details.firstSeenAt,
    source: 'WALLET',
    broadcastAt: attempt.details.broadcastAt,
    observedAt: attempt.observedAt,
  };
}

function unknownOutcome(attempt) {
  return {
    ...pendingOutcome(null, attempt),
    status: 'OUTCOME_UNKNOWN',
    code: attempt.details.code,
  };
}

function failureOutcome(attempt) {
  return {
    ...pendingOutcome(null, attempt),
    status: 'FINALIZED_FAILURE',
    failureCode: 'MAKER_V8_COMPILER_TRANSACTION_FAILED',
  };
}

function definitiveWalletRejection(error) {
  return error?.definitiveRejection === true && error?.signedArtifactCreated === false
    || isDefinitiveWalletStandardRejectionV8(error);
}

function exactPreparedBlob(blobs, ref, label) {
  const value = blobs.find((blob) => blob?.sha256 === ref?.sha256);
  if (!value || value.byteLength !== ref.byteLength || value.encoding !== ref.encoding) {
    fail('MAKER_V8_PUBLICATION_BLOB_MISSING', `${label} is absent from the atomic blob set.`);
  }
  if (value.encoding !== 'BASE64') {
    fail('MAKER_V8_PUBLICATION_BLOB_INVALID', `${label} must be a Base64 blob.`);
  }
  const proof = kindProof(value.data, label);
  if (proof.sha256 !== value.sha256 || proof.bytes.length !== value.byteLength) {
    fail('MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH', `${label} failed its exact hash check.`);
  }
  return value.data;
}

export function createMakerV8PublicationControllerV8({
  persistence,
  compiler,
  boundary,
  wallet,
  rpc,
  execution = {},
  now = () => Date.now(),
} = {}) {
  for (const method of [
    'requirePersistentStorage', 'preflightQuota', 'createAttempt', 'loadPlan',
    'loadHead', 'loadAttemptHead', 'getBlob', 'compareAndSwap', 'deleteUnsigned',
  ]) requireMethod(persistence, method, 'persistence');
  for (const method of ['prepare', 'rehydrate', 'certifyFinalized', 'prepareSuccessor']) {
    requireMethod(compiler, method, 'compiler');
  }
  for (const method of [
    'buildExactTransaction', 'dryRunExactTransaction', 'broadcastExactTransaction',
  ]) requireMethod(boundary, method, 'boundary');
  for (const method of ['signExactTransaction', 'verifyExactSignature']) {
    requireMethod(wallet, method, 'wallet');
  }
  requireMethod(rpc, 'queryTransaction', 'rpc');
  if (!plain(compiler.authority)) {
    fail(
      'MAKER_V8_PUBLICATION_COMPILER_AUTHORITY_INVALID',
      'Compiler must expose one in-process authority token.',
    );
  }
  const gates = Object.freeze({
    allowWalletSignature: execution.allowWalletSignature === true,
    allowBroadcast: execution.allowBroadcast === true,
  });
  if (gates.allowWalletSignature !== gates.allowBroadcast) {
    fail(
      'MAKER_V8_PUBLICATION_EXECUTION_GATE_INVALID',
      'Publication signing and exact-byte broadcast gates must change together.',
    );
  }

  const listeners = new Set();
  const publish = (reason, plan) => {
    const event = Object.freeze({
      schemaVersion: MAKER_V8_PUBLICATION_CONTROLLER_SCHEMA,
      reason,
      plan: plan == null ? null : clone(plan),
    });
    for (const listener of listeners) {
      try { listener(event); } catch { /* UI observers never control WAL progress. */ }
    }
  };

  const clock = (minimum) => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < minimum) {
      fail(
        'MAKER_V8_PUBLICATION_CLOCK_INVALID',
        'Publication clock must be a monotonic non-negative safe integer.',
        { minimum, actual: value },
      );
    }
    return value;
  };

  const requireDurability = async (bytes = WAL_RESERVE_BYTES) => {
    await persistence.requirePersistentStorage();
    await persistence.preflightQuota(bytes);
  };

  const readKind = (plan) => readMakerV8PublicationBlobV8(
    persistence,
    plan.current.transactionKindRef,
    'publication TransactionKind',
  );

  const coldAuthorize = async (attemptId, purpose, requireFreshAuthority) => {
    const plan = await persistence.loadPlan(attemptId);
    if (!plan) fail('MAKER_V8_PUBLICATION_NOT_FOUND', 'Publication attempt was not found.');
    if (!plan.current) {
      fail('MAKER_V8_PUBLICATION_CURRENT_REQUIRED', 'Publication has no current transaction cursor.');
    }
    const [kindBytes, head] = await Promise.all([
      readKind(plan),
      plan.head ? persistence.loadHead(attemptId) : Promise.resolve(null),
    ]);
    const attested = await compiler.rehydrate({
      plan: clone(plan),
      head: head == null ? null : clone(head),
      transactionKindBytes: kindBytes,
      purpose,
      requireFreshAuthority,
    });
    return Object.freeze({
      plan,
      head,
      attested: await assertCompilerAttestation(compiler, plan, kindBytes, attested),
    });
  };

  const readArtifacts = async (plan, kindBytes = null) => {
    if (!plan.current?.fullTransactionRef || !plan.current?.signatureRef
      || !plan.current.outcome?.digest) {
      fail(
        'MAKER_V8_PUBLICATION_SIGNED_ARTIFACT_REQUIRED',
        'Publication cursor has no complete durable signed artifact.',
      );
    }
    const [full, signature, durableKind] = await Promise.all([
      readMakerV8PublicationBlobV8(
        persistence, plan.current.fullTransactionRef, 'publication TransactionData',
      ),
      readMakerV8PublicationBlobV8(
        persistence, plan.current.signatureRef, 'publication signature',
      ),
      kindBytes == null ? readKind(plan) : Promise.resolve(kindBytes),
    ]);
    canonicalBase64(signature, 'publication signature');
    const transaction = transactionDataProof(full, {
      signer: plan.immutable.signerAddress,
      kindBytes: durableKind,
      digest: plan.current.outcome.digest,
    });
    return Object.freeze({
      bytes: transaction.base64,
      signature,
      digest: transaction.digest,
      kindBytes: durableKind,
    });
  };

  const verifyArtifacts = async (plan, artifacts) => {
    const result = await wallet.verifyExactSignature({
      bytes: artifacts.bytes,
      signature: artifacts.signature,
      digest: artifacts.digest,
      signer: plan.immutable.signerAddress,
    });
    if (!result || result.verified === false
      || result.bytes && result.bytes !== artifacts.bytes
      || result.digest && result.digest !== artifacts.digest
      || result.signer && result.signer !== plan.immutable.signerAddress) {
      fail(
        'MAKER_V8_PUBLICATION_SIGNATURE_INVALID',
        'Signature does not authenticate the exact durable TransactionData and signer.',
      );
    }
    return artifacts;
  };

  const rereadAfterCas = async (expected, reason) => {
    const reread = await persistence.loadPlan(expected.attemptId);
    if (!reread || reread.revision !== expected.revision
      || reread.planId !== expected.planId
      || reread.attemptHistory.globalAttemptHeadSha256
        !== expected.attemptHistory.globalAttemptHeadSha256) {
      fail(
        'MAKER_V8_PUBLICATION_DURABLE_REREAD_FAILED',
        'Publication CAS was not observed by an exact cold reread.',
      );
    }
    publish(reason, reread);
    return reread;
  };

  const casEvent = async (plan, next, attempt, reason, options = {}) => {
    const written = await persistence.compareAndSwap(
      plan.attemptId,
      plan.revision,
      next,
      { ...options, attempt },
    );
    return rereadAfterCas(written, reason);
  };

  const appendPending = async (plan) => {
    if (plan.current.outcome.status === 'OUTCOME_PENDING') {
      const prior = await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal);
      if (prior?.status !== 'BROADCAST_ACCEPTED') return plan;
      const at = clock(plan.updatedAt);
      const attempt = makeAttempt(plan, prior, 'OUTCOME_PENDING', { at, code: null });
      return casEvent(plan, {
        ...plan,
        revision: plan.revision + 1,
        updatedAt: at,
        attemptHistory: attemptHistory(plan, attempt),
        current: { ...plan.current, outcome: pendingOutcome(plan, attempt) },
      }, attempt, 'OUTCOME_PENDING');
    }
    if (!['SIGNED', 'OUTCOME_UNKNOWN'].includes(plan.current.outcome.status)) {
      fail(
        'MAKER_V8_PUBLICATION_PENDING_TRANSITION_INVALID',
        'Only SIGNED or OUTCOME_UNKNOWN may enter query-first pending recovery.',
      );
    }
    const prior = await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal);
    if (!prior || prior.status !== plan.current.outcome.status) {
      fail(
        'MAKER_V8_PUBLICATION_ATTEMPT_REQUIRED',
        'Pending recovery requires the exact durable attempt-head predecessor.',
      );
    }
    const at = clock(plan.updatedAt);
    const attempt = makeAttempt(plan, prior, 'OUTCOME_PENDING', { at, code: null });
    return casEvent(plan, {
      ...plan,
      revision: plan.revision + 1,
      updatedAt: at,
      attemptHistory: attemptHistory(plan, attempt),
      current: { ...plan.current, outcome: pendingOutcome(plan, attempt) },
    }, attempt, 'OUTCOME_PENDING');
  };

  const appendUnknown = async (plan, error) => {
    const prior = await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal);
    if (!prior || !['OUTCOME_PENDING', 'BROADCAST_ACCEPTED'].includes(prior.status)) {
      fail(
        'MAKER_V8_PUBLICATION_ATTEMPT_REQUIRED',
        'Unknown outcome requires the exact durable pending predecessor.',
      );
    }
    const at = clock(plan.updatedAt);
    const attempt = makeAttempt(plan, prior, 'OUTCOME_UNKNOWN', {
      at,
      code: eventCode(error),
    });
    return casEvent(plan, {
      ...plan,
      revision: plan.revision + 1,
      updatedAt: at,
      attemptHistory: attemptHistory(plan, attempt),
      current: { ...plan.current, outcome: unknownOutcome(attempt) },
    }, attempt, 'OUTCOME_UNKNOWN');
  };

  const appendFailure = async (plan) => {
    const prior = await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal);
    if (!prior || !['OUTCOME_PENDING', 'BROADCAST_ACCEPTED'].includes(prior.status)) {
      fail(
        'MAKER_V8_PUBLICATION_ATTEMPT_REQUIRED',
        'Finalized failure requires the exact durable pending predecessor.',
      );
    }
    const at = clock(plan.updatedAt);
    const attempt = makeAttempt(plan, prior, 'FINALIZED_FAILURE', {
      at,
      code: 'MAKER_V8_COMPILER_TRANSACTION_FAILED',
    });
    return casEvent(plan, {
      ...plan,
      revision: plan.revision + 1,
      updatedAt: at,
      attemptHistory: attemptHistory(plan, attempt),
      current: { ...plan.current, outcome: failureOutcome(attempt) },
    }, attempt, 'FINALIZED_FAILURE');
  };

  const finalizeSuccess = async (plan, query, authorized, artifacts) => {
    const certified = await compiler.certifyFinalized({
      plan: clone(plan),
      query: clone(query),
      attested: authorized.attested,
      artifacts: clone(artifacts),
    });
    if (!plain(certified)) {
      fail(
        'MAKER_V8_PUBLICATION_FINALIZED_READBACK_INVALID',
        'Compiler omitted deterministic finalized readback evidence.',
      );
    }
    const readback = {
      schemaVersion: 'animacraft.maker-v8-publication-finalized-readback.v1',
      source: 'FINALIZED_RPC',
      transactionDigest: plan.current.outcome.digest,
      transactionKindSha256: plan.current.transactionKindSha256,
      compiler: clone(certified),
    };
    // Reject values that are not deterministic JSON before the store sees them.
    try {
      if (canonical(JSON.parse(JSON.stringify(readback))) !== canonical(readback)) {
        throw new Error('non-deterministic');
      }
    } catch {
      fail(
        'MAKER_V8_PUBLICATION_FINALIZED_READBACK_INVALID',
        'Compiler finalized evidence is not deterministic JSON.',
      );
    }
    const finalizedAt = clock(plan.updatedAt);
    const checkpoint = {
      schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
      attemptId: plan.attemptId,
      planId: plan.planId,
      ordinal: plan.current.ordinal,
      kind: plan.current.kind,
      phase: plan.current.phase,
      lane: plan.current.lane,
      action: plan.current.action,
      startSequence: plan.current.startSequence,
      endSequence: plan.current.endSequence,
      rowCommitments: clone(plan.current.rowCommitments),
      preState: clone(plan.current.preState),
      postState: clone(plan.current.postState),
      compilerCheckpoint: clone(plan.current.compilerCheckpoint),
      transactionKindRef: clone(plan.current.transactionKindRef),
      transactionKindSha256: plan.current.transactionKindSha256,
      commandCount: plan.current.commandCount,
      targets: clone(plan.current.targets),
      fullTransactionRef: clone(plan.current.fullTransactionRef),
      signatureRef: clone(plan.current.signatureRef),
      digest: plan.current.outcome.digest,
      certificate: {
        source: 'FINALIZED_RPC',
        transactionDigest: plan.current.outcome.digest,
        transactionKindSha256: plan.current.transactionKindSha256,
        readbackSha256: hashValue(readback),
      },
      readback,
      submissionSource: 'WALLET',
      checkpointSha256: '0'.repeat(64),
      previousCheckpointSha256: plan.head?.checkpointSha256 ?? null,
      finalizedAt,
    };
    checkpoint.checkpointSha256 = await makerV8PublicationCheckpointSha256V8(checkpoint);
    const prior = await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal);
    if (!prior || !['OUTCOME_PENDING', 'BROADCAST_ACCEPTED'].includes(prior.status)) {
      fail(
        'MAKER_V8_PUBLICATION_ATTEMPT_REQUIRED',
        'Finalized success requires the exact durable query-first predecessor.',
      );
    }
    const attempt = makeAttempt(plan, prior, 'FINALIZED_SUCCESS', {
      at: finalizedAt,
      code: null,
    });
    const complete = plan.current.kind === 'ACTIVATION_CHUNK'
      && plan.current.compilerCheckpoint?.final === true;
    const next = {
      ...plan,
      status: complete ? 'COMPLETE' : 'ACTIVE',
      revision: plan.revision + 1,
      updatedAt: finalizedAt,
      attemptHistory: attemptHistory(plan, attempt),
      head: {
        ordinal: checkpoint.ordinal,
        digest: checkpoint.digest,
        transactionKindSha256: checkpoint.transactionKindSha256,
        checkpointSha256: checkpoint.checkpointSha256,
        phase: checkpoint.phase,
        lane: checkpoint.lane,
      },
      current: null,
      nextPreparation: complete ? null : {
        status: 'REQUIRED',
        ordinal: checkpoint.ordinal + 1,
        reason: null,
      },
      terminal: complete ? {
        status: 'COMPLETE',
        reason: 'ACTIVATION_FINALIZED',
        at: finalizedAt,
      } : null,
    };
    const written = await persistence.compareAndSwap(
      plan.attemptId,
      plan.revision,
      next,
      { checkpoint, attempt },
    );
    const [reread, head] = await Promise.all([
      persistence.loadPlan(written.attemptId),
      persistence.loadHead(written.attemptId),
    ]);
    if (!reread || reread.revision !== written.revision
      || !head || head.checkpointSha256 !== checkpoint.checkpointSha256
      || reread.head?.checkpointSha256 !== checkpoint.checkpointSha256) {
      fail(
        'MAKER_V8_PUBLICATION_DURABLE_REREAD_FAILED',
        'Finalized checkpoint CAS was not observed by an exact cold reread.',
      );
    }
    publish('FINALIZED_SUCCESS', reread);
    return reread;
  };

  const recover = async (attemptId) => {
    await requireDurability();
    let plan = await persistence.loadPlan(attemptId);
    if (!plan) fail('MAKER_V8_PUBLICATION_NOT_FOUND', 'Publication attempt was not found.');
    if (plan.status !== 'ACTIVE' || !plan.current) return plan;
    if (['SIGNED', 'OUTCOME_PENDING', 'OUTCOME_UNKNOWN'].includes(plan.current.outcome.status)) {
      plan = await appendPending(plan);
    }
    if (plan.current?.outcome.status !== 'OUTCOME_PENDING') return plan;

    // This exact-digest query intentionally precedes every live-authority read.
    let query;
    try {
      query = await rpc.queryTransaction({ digest: plan.current.outcome.digest });
    } catch (error) {
      return appendUnknown(plan, error);
    }
    if (!plain(query) || query.digest !== plan.current.outcome.digest
      || !['NOT_FOUND', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(query.status)) {
      return appendUnknown(plan, {
        code: 'RPC_OUTCOME_INVALID',
      });
    }
    if (query.status === 'NOT_FOUND') return plan;

    const authorized = await coldAuthorize(attemptId, 'FINALIZED_RECOVERY', false);
    if (authorized.plan.revision !== plan.revision
      || authorized.plan.current?.outcome.digest !== query.digest) {
      fail(
        'MAKER_V8_PUBLICATION_CAS_MISMATCH',
        'Publication changed after its exact-digest query.',
      );
    }
    const artifacts = await verifyArtifacts(
      authorized.plan,
      await readArtifacts(authorized.plan, authorized.attested.transactionKindBytes),
    );
    if (query.status === 'FINALIZED_FAILURE') return appendFailure(authorized.plan);
    return finalizeSuccess(authorized.plan, query, authorized, artifacts);
  };

  const prepareSuccessor = async (plan) => {
    const head = await persistence.loadHead(plan.attemptId);
    if (!head || head.checkpointSha256 !== plan.head?.checkpointSha256) {
      fail(
        'MAKER_V8_PUBLICATION_HEAD_DRIFT',
        'Successor preparation requires the exact durable finalized head.',
      );
    }
    const prepared = await compiler.prepareSuccessor({
      plan: clone(plan),
      head: clone(head),
      requireFreshAuthority: true,
    });
    if (!plain(prepared) || !plain(prepared.descriptor)) {
      fail(
        'MAKER_V8_PUBLICATION_SUCCESSOR_INVALID',
        'Compiler omitted the next deterministic publication descriptor.',
      );
    }
    const kindBytes = attestedKindBase64(prepared);
    const proof = kindProof(kindBytes, 'successor TransactionKind');
    if (prepared.descriptor.ordinal !== plan.head.ordinal + 1
      || prepared.descriptor.transactionKindSha256 !== proof.sha256) {
      fail(
        'MAKER_V8_PUBLICATION_SUCCESSOR_INVALID',
        'Compiler successor does not extend the exact finalized ordinal and kind hash.',
      );
    }
    const kindBlob = await makerV8Base64BlobV8(kindBytes);
    const current = {
      ...clone(prepared.descriptor),
      transactionKindRef: makerV8BlobRefV8(kindBlob),
      transactionKindSha256: kindBlob.sha256,
      fullTransactionRef: null,
      signatureRef: null,
      outcome: { status: 'READY' },
    };
    await assertCompilerAttestation(compiler, { ...plan, current }, kindBytes, prepared);
    const at = clock(plan.updatedAt);
    const written = await persistence.compareAndSwap(plan.attemptId, plan.revision, {
      ...plan,
      revision: plan.revision + 1,
      updatedAt: at,
      current,
      nextPreparation: null,
    }, { blobs: [...(prepared.blobs ?? []), kindBlob] });
    const authorized = await coldAuthorize(written.attemptId, 'SUCCESSOR_REREAD', false);
    if (authorized.plan.revision !== written.revision) {
      fail(
        'MAKER_V8_PUBLICATION_DURABLE_REREAD_FAILED',
        'Prepared successor was not observed by an exact cold reread.',
      );
    }
    publish('READY', authorized.plan);
    return authorized.plan;
  };

  return Object.freeze({
    schemaVersion: MAKER_V8_PUBLICATION_CONTROLLER_SCHEMA,

    subscribe(listener) {
      if (typeof listener !== 'function') {
        fail('MAKER_V8_PUBLICATION_LISTENER_INVALID', 'Publication listener must be a function.');
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async prepare(input) {
      await requireDurability();
      const prepared = await compiler.prepare(clone(input));
      if (!plain(prepared) || !plain(prepared.plan) || !Array.isArray(prepared.blobs)) {
        fail(
          'MAKER_V8_PUBLICATION_PREPARE_INVALID',
          'Compiler prepare must return one plan, atomic blob set, and attestation.',
        );
      }
      const plan = clone(prepared.plan);
      if (plan.status !== 'ACTIVE' || plan.revision !== 1
        || plan.current?.outcome?.status !== 'READY') {
        fail(
          'MAKER_V8_PUBLICATION_PREPARE_INVALID',
          'Initial publication plan must be ACTIVE revision 1 with one READY cursor.',
        );
      }
      const kindBytes = exactPreparedBlob(
        prepared.blobs,
        plan.current.transactionKindRef,
        'prepared TransactionKind',
      );
      await assertCompilerAttestation(
        compiler,
        plan,
        kindBytes,
        prepared.attested ?? prepared,
      );
      // A crash may happen after the strict create transaction commits but
      // before prepare() returns to the UI. Rebuilding the same deterministic
      // plan resumes that exact attempt instead of minting a replacement.
      const existing = await persistence.loadPlan(plan.attemptId);
      if (existing) {
        if (existing.planId !== plan.planId) {
          fail(
            'MAKER_V8_PUBLICATION_PREPARE_COLLISION',
            'The deterministic publication attempt ID is already bound to another plan.',
          );
        }
        const authorizedExisting = await coldAuthorize(
          existing.attemptId,
          'PREPARE_IDEMPOTENT_REREAD',
          false,
        );
        publish('READY', authorizedExisting.plan);
        return authorizedExisting.plan;
      }
      const created = await persistence.createAttempt(plan, prepared.blobs);
      const authorized = await coldAuthorize(created.attemptId, 'PREPARE_REREAD', false);
      if (authorized.plan.revision !== 1 || authorized.plan.planId !== created.planId) {
        fail(
          'MAKER_V8_PUBLICATION_DURABLE_REREAD_FAILED',
          'Prepared publication was not observed by an exact cold reread.',
        );
      }
      publish('READY', authorized.plan);
      return authorized.plan;
    },

    async resume(attemptId) {
      await requireDurability();
      const plan = await persistence.loadPlan(attemptId);
      if (!plan) fail('MAKER_V8_PUBLICATION_NOT_FOUND', 'Publication attempt was not found.');
      if (plan.status !== 'ACTIVE') return plan;
      if (plan.current === null) {
        if (plan.nextPreparation?.status !== 'REQUIRED') return plan;
        return prepareSuccessor(plan);
      }
      if (['SIGNED', 'OUTCOME_PENDING', 'OUTCOME_UNKNOWN'].includes(plan.current.outcome.status)) {
        return recover(attemptId);
      }
      const authorized = await coldAuthorize(attemptId, 'RESUME_READY', false);
      return authorized.plan;
    },

    async requestSignature(attemptId) {
      if (!gates.allowWalletSignature || !gates.allowBroadcast) {
        fail(
          'MAKER_V8_PUBLICATION_EXECUTION_DISABLED',
          'Publication wallet signing and exact-byte broadcast are disabled.',
        );
      }
      await requireDurability();
      const authorized = await coldAuthorize(attemptId, 'REQUEST_SIGNATURE', true);
      const { plan, attested } = authorized;
      if (plan.status !== 'ACTIVE' || plan.current?.outcome.status !== 'READY') {
        fail(
          'MAKER_V8_PUBLICATION_NOT_READY',
          'Only an exact ACTIVE READY cursor may request a wallet signature.',
        );
      }
      const built = await boundary.buildExactTransaction({
        transaction: attested.transaction,
        sender: plan.immutable.signerAddress,
        expectedKindBytes: attested.transactionKindBytes,
      });
      const bytes = built?.bytes ?? built?.transactionBytes;
      const digest = built?.digest ?? built?.transactionDigest;
      const proof = transactionDataProof(bytes, {
        signer: plan.immutable.signerAddress,
        kindBytes: attested.transactionKindBytes,
        digest,
      });
      const dryRun = await boundary.dryRunExactTransaction({
        bytes: proof.base64,
        transactionBytes: proof.base64,
        digest: proof.digest,
        signer: plan.immutable.signerAddress,
        expectedKindBytes: attested.transactionKindBytes,
        transaction: attested.transaction,
      });
      if (dryRun?.status !== 'SUCCESS') {
        fail(
          'MAKER_V8_PUBLICATION_DRY_RUN_FAILED',
          'Exact compiler publication dry-run failed.',
          { error: dryRun?.error ?? null },
        );
      }

      let signed;
      try {
        signed = await wallet.signExactTransaction({
          bytes: proof.base64,
          digest: proof.digest,
          signer: plan.immutable.signerAddress,
        });
      } catch (error) {
        if (!definitiveWalletRejection(error)) throw error;
        const prior = await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal);
        const at = clock(plan.updatedAt);
        const attempt = makeAttempt(plan, prior, 'WALLET_REJECTED', {
          at,
          digest: null,
          fullTransactionRef: null,
          signatureRef: null,
          code: 'WALLET_STANDARD_REQUEST_REJECTED',
        });
        return casEvent(plan, {
          ...plan,
          revision: plan.revision + 1,
          updatedAt: at,
          attemptHistory: attemptHistory(plan, attempt),
        }, attempt, 'WALLET_REJECTED');
      }
      if (!plain(signed)
        || signed.bytes !== proof.base64
        || signed.digest !== proof.digest
        || signed.signer !== plan.immutable.signerAddress) {
        fail(
          'MAKER_V8_PUBLICATION_SIGNED_ARTIFACT_DRIFT',
          'Wallet returned different TransactionData, digest, or signer.',
        );
      }
      canonicalBase64(signed.signature, 'wallet signature');
      await verifyArtifacts(plan, {
        bytes: signed.bytes,
        signature: signed.signature,
        digest: signed.digest,
      });
      const [fullBlob, signatureBlob] = await Promise.all([
        makerV8Base64BlobV8(signed.bytes),
        makerV8Base64BlobV8(signed.signature),
      ]);
      const fullTransactionRef = makerV8BlobRefV8(fullBlob);
      const signatureRef = makerV8BlobRefV8(signatureBlob);
      const prior = await persistence.loadAttemptHead(plan.attemptId, plan.current.ordinal);
      const signedAt = clock(plan.updatedAt);
      const attempt = makeAttempt(plan, prior, 'SIGNED', {
        at: signedAt,
        digest: signed.digest,
        fullTransactionRef,
        signatureRef,
        code: null,
      });
      const written = await casEvent(plan, {
        ...plan,
        revision: plan.revision + 1,
        updatedAt: signedAt,
        attemptHistory: attemptHistory(plan, attempt),
        current: {
          ...plan.current,
          fullTransactionRef,
          signatureRef,
          outcome: {
            status: 'SIGNED',
            digest: signed.digest,
            kindSha256: plan.current.transactionKindSha256,
            signedAt,
          },
        },
      }, attempt, 'SIGNED', { blobs: [fullBlob, signatureBlob] });

      // No RPC or broadcast is allowed until this cold WAL reread succeeds.
      const reread = await coldAuthorize(written.attemptId, 'SIGNED_REREAD', false);
      await verifyArtifacts(
        reread.plan,
        await readArtifacts(reread.plan, reread.attested.transactionKindBytes),
      );
      return reread.plan;
    },

    async recoverOutcome(attemptId) {
      return recover(attemptId);
    },

    async replayExact(attemptId) {
      if (!gates.allowBroadcast) {
        fail(
          'MAKER_V8_PUBLICATION_EXECUTION_DISABLED',
          'Exact-byte publication replay is disabled.',
        );
      }
      // recover() performs the mandatory old-digest query before live authority.
      let plan = await recover(attemptId);
      if (plan.status !== 'ACTIVE' || plan.current?.outcome.status !== 'OUTCOME_PENDING') {
        return plan;
      }
      if (plan.current.outcome.source !== 'WALLET') {
        fail(
          'MAKER_V8_PUBLICATION_REPLAY_FORBIDDEN',
          'Only a durable wallet-signed TransactionData artifact may be replayed.',
        );
      }
      const authorized = await coldAuthorize(attemptId, 'EXACT_REPLAY', true);
      if (authorized.plan.revision !== plan.revision
        || authorized.plan.current?.outcome.digest !== plan.current.outcome.digest) {
        fail(
          'MAKER_V8_PUBLICATION_CAS_MISMATCH',
          'Publication changed after its query-first replay check.',
        );
      }
      const artifacts = await verifyArtifacts(
        authorized.plan,
        await readArtifacts(authorized.plan, authorized.attested.transactionKindBytes),
      );
      await boundary.broadcastExactTransaction({
        bytes: artifacts.bytes,
        signature: artifacts.signature,
        digest: artifacts.digest,
        signer: authorized.plan.immutable.signerAddress,
      });
      const prior = await persistence.loadAttemptHead(
        authorized.plan.attemptId,
        authorized.plan.current.ordinal,
      );
      if (!prior || prior.status !== 'OUTCOME_PENDING') {
        fail(
          'MAKER_V8_PUBLICATION_ATTEMPT_REQUIRED',
          'Broadcast acceptance requires its exact durable pending predecessor.',
        );
      }
      const at = clock(authorized.plan.updatedAt);
      const accepted = makeAttempt(authorized.plan, prior, 'BROADCAST_ACCEPTED', {
        at,
        code: null,
      });
      plan = await casEvent(authorized.plan, {
        ...authorized.plan,
        revision: authorized.plan.revision + 1,
        updatedAt: at,
        attemptHistory: attemptHistory(authorized.plan, accepted),
        current: {
          ...authorized.plan.current,
          outcome: pendingOutcome(authorized.plan, accepted),
        },
      }, accepted, 'BROADCAST_ACCEPTED');
      // A second query is safe only after the broadcast-accepted WAL cold reread.
      return recover(plan.attemptId);
    },

    async discardUnsigned(attemptId) {
      const plan = await persistence.loadPlan(attemptId);
      if (!plan) return false;
      const deleted = await persistence.deleteUnsigned(attemptId, plan.revision);
      const reread = await persistence.loadPlan(attemptId);
      if (deleted !== true || reread !== null) {
        fail(
          'MAKER_V8_PUBLICATION_DURABLE_REREAD_FAILED',
          'Unsigned publication discard was not observed by a cold reread.',
        );
      }
      publish('DISCARDED_UNSIGNED', null);
      return true;
    },
  });
}
