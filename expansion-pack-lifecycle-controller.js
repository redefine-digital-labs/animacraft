import { fromBase64 } from '@mysten/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import {
  createExpansionPackLifecycleAction,
  readExpansionPackLifecycleV8,
} from './expansion-pack-lifecycle-v8.js';
import {
  EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE,
  expansionPackLifecycleRecoveryIdentity,
} from './expansion-pack-lifecycle-recovery-store.js';

export const EXPANSION_PACK_LIFECYCLE_CONTROLLER_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  OUTCOME_PENDING: 'OUTCOME_PENDING',
  FINALIZED_FAILURE: 'FINALIZED_FAILURE',
});

export const EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR = Object.freeze({
  DEPENDENCY_MISSING: 'EXPANSION_PACK_LIFECYCLE_CONTROLLER_DEPENDENCY_MISSING',
  CONTEXT_CHANGED: 'EXPANSION_PACK_LIFECYCLE_CONTEXT_CHANGED',
  TRANSITION_DRIFT: 'EXPANSION_PACK_LIFECYCLE_TRANSITION_DRIFT',
  RECOVERY_NOT_FOUND: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_NOT_FOUND',
  RECOVERY_DIGEST_REQUIRED: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_DIGEST_REQUIRED',
  RECOVERY_DIGEST_MISMATCH: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_DIGEST_MISMATCH',
  RECOVERY_READBACK_MISMATCH: 'EXPANSION_PACK_LIFECYCLE_RECOVERY_READBACK_MISMATCH',
  SUBMISSION_DIGEST_MISMATCH: 'EXPANSION_PACK_LIFECYCLE_SUBMISSION_DIGEST_MISMATCH',
  SIGNED_TRANSACTION_MISMATCH: 'EXPANSION_PACK_LIFECYCLE_SIGNED_TRANSACTION_MISMATCH',
  RELEASE_PENDING_CONFLICT: 'EXPANSION_PACK_LIFECYCLE_RELEASE_PENDING_CONFLICT',
});

export class ExpansionPackLifecycleControllerError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ExpansionPackLifecycleControllerError';
    this.code = code;
    this.details = details;
  }
}

// Serializes identical lifecycle lanes across controller instances in this JS
// realm. IndexedDB CAS remains the authority across tabs/processes.
const LIFECYCLE_LANE_TAILS = new Map();

function fail(code, message, details = {}) {
  throw new ExpansionPackLifecycleControllerError(message, code, details);
}

function text(value, maximum = 160) {
  return String(value ?? '').trim().slice(0, maximum);
}

function dependency(value, name) {
  if (typeof value !== 'function') fail(
    EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.DEPENDENCY_MISSING,
    `Expansion Pack lifecycle execution requires ${name}.`,
    { name },
  );
  return value;
}

function storeDependency(store, name) {
  return dependency(store?.[name]?.bind(store), `recoveryStore.${name}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function sameIdentity(left, right) {
  return Boolean(left?.key) && left.key === right?.key;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function indexedTransaction(value) {
  return value?.Transaction || value?.transaction || value || {};
}

function transactionStatus(indexed) {
  const status = indexed?.effects?.status?.status || indexed?.effects?.status;
  if (typeof status === 'string') return status.toLowerCase();
  if (status && typeof status === 'object') {
    if (status.success === true && status.error == null) return 'success';
    if (status.success === false || status.error != null) return 'failure';
  }
  return '';
}

function eventJson(value) {
  const json = value?.parsedJson || value?.parsed_json || value?.json || value?.contents?.json;
  return object(json?.fields || json);
}

function lifecycleEventMatchesType(value, runtime) {
  const type = text(
    value?.type || value?.eventType || value?.event_type || value?.contents?.type?.repr,
    1000,
  );
  const [packageId, module, name] = type.split('::');
  try {
    return normalizeSuiAddress(packageId) === normalizeSuiAddress(String(
      runtime?.expansionPackV8TypeOriginPackageId || '',
    )) && module === 'expansion_pack_v8' && name === 'ExpansionPackLifecycleChangedV8';
  } catch {
    return false;
  }
}

function normalizedType(value) {
  const [packageId, module, name] = text(value, 1000).split('::');
  try {
    return `${normalizeSuiAddress(packageId)}::${module}::${name}`;
  } catch {
    return '';
  }
}

function exactReleaseWrite(indexed, identity, runtime) {
  const matches = array(indexed?.effects?.changedObjects).filter((entry) => {
    try {
      return normalizeSuiAddress(String(entry?.objectId ?? '')) === identity.releaseId;
    } catch {
      return false;
    }
  });
  const changed = matches[0];
  const typeEntry = Object.entries(object(indexed?.objectTypes || indexed?.object_types))
    .find(([objectId]) => {
      try { return normalizeSuiAddress(objectId) === identity.releaseId; } catch { return false; }
    });
  const expectedType = normalizedType(
    `${runtime?.expansionPackV8TypeOriginPackageId || ''}`
      + '::expansion_pack_v8::ExpansionPackReleaseV8',
  );
  let outputAdvanced = false;
  try {
    // Sui object versions follow transaction Lamport ordering and may jump
    // when another input has a higher version. They must advance, but are not
    // required to equal input + 1.
    outputAdvanced = BigInt(changed?.outputVersion ?? 0) > BigInt(identity.releaseObjectVersion);
  } catch {
    outputAdvanced = false;
  }
  if (matches.length !== 1
    || changed?.inputState !== 'Exists'
    || changed?.outputState !== 'ObjectWrite'
    || changed?.idOperation !== 'None'
    || String(changed?.inputVersion ?? '') !== identity.releaseObjectVersion
    || String(changed?.inputDigest ?? '') !== identity.releaseObjectDigest
    || !outputAdvanced
    || normalizedType(typeEntry?.[1]) !== expectedType) fail(
    EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
    'The exact lifecycle transaction effects do not prove one write of the signed Release version.',
    { releaseId: identity.releaseId, changedCount: matches.length },
  );
  return changed;
}

function lifecycleState(lifecycle) {
  return ({ 0: 'DRAFT', 1: 'SEALED', 2: 'ADMITTED', 3: 'ACTIVE', 4: 'PAUSED', 5: 'ARCHIVED' })[
    Number(lifecycle)
  ] || '';
}

function publicIdentity(identity) {
  return {
    kind: identity.action,
    walletAddress: identity.walletAddress,
    releaseId: identity.releaseId,
    adminCapId: identity.adminCapId,
    parentRootId: identity.parentRootId,
    releaseObjectVersion: identity.releaseObjectVersion,
    releaseObjectDigest: identity.releaseObjectDigest,
    fromLifecycle: identity.fromLifecycle,
    toLifecycle: identity.toLifecycle,
  };
}

function verifiedResult(identity, receipt) {
  return deepFreeze({
    status: EXPANSION_PACK_LIFECYCLE_CONTROLLER_STATUS.VERIFIED,
    ...publicIdentity(identity),
    transactionDigest: text(receipt?.transactionDigest ?? receipt?.digest),
    previousLifecycle: identity.fromLifecycle,
    lifecycle: identity.toLifecycle,
    lifecycleState: lifecycleState(identity.toLifecycle),
    readbackVerified: true,
    recoverable: false,
  });
}

function pendingResult(identity, pending, error) {
  return deepFreeze({
    status: EXPANSION_PACK_LIFECYCLE_CONTROLLER_STATUS.OUTCOME_PENDING,
    ...publicIdentity(identity),
    transactionDigest: text(pending?.signed?.digest),
    recoveryState: EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE.OUTCOME_PENDING,
    lastErrorCode: text(error?.code, 160) || 'EXPANSION_PACK_LIFECYCLE_OUTCOME_PENDING',
    recoverable: true,
  });
}

function failureResult(identity, failure) {
  return deepFreeze({
    status: EXPANSION_PACK_LIFECYCLE_CONTROLLER_STATUS.FINALIZED_FAILURE,
    ...publicIdentity(identity),
    transactionDigest: text(failure?.transactionDigest ?? failure?.digest),
    finalized: true,
    executionStatus: 'FAILURE',
    error: {
      kind: text(failure?.executionError?.kind, 80) || 'Unknown',
      message: text(failure?.executionError?.message, 240) || 'Sui transaction failed.',
    },
    recoverable: false,
  });
}

function defaultSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `lifecycle-${globalThis.crypto.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `lifecycle-${Date.now().toString(36)}-${suffix || 'recovery-session'}`;
}

function finalizedFailure(error, digest) {
  const failure = error?.finalizedFailure;
  return error?.code === 'TRANSACTION_FINALIZED_FAILURE'
    && failure?.finalized === true
    && text(failure?.executionStatus).toUpperCase() === 'FAILURE'
    && text(failure?.transactionDigest ?? failure?.digest) === digest
    ? failure
    : null;
}

function identityForDescriptor(kind, walletAddress, descriptor, transition) {
  return expansionPackLifecycleRecoveryIdentity({
    walletAddress,
    releaseId: descriptor?.release?.objectId,
    adminCapId: descriptor?.adminCap?.objectId,
    parentRootId: descriptor?.parent?.objectId,
    releaseObjectVersion: descriptor?.release?.objectVersion,
    releaseObjectDigest: descriptor?.release?.objectDigest,
    action: kind,
    fromLifecycle: transition.fromLifecycle,
    toLifecycle: transition.toLifecycle,
  });
}

function objectInput(data, argument, { shared = null, mutable = null } = {}) {
  if (!Number.isInteger(argument?.Input)) return '';
  const objectValue = data?.inputs?.[argument.Input]?.Object;
  const sharedValue = objectValue?.SharedObject;
  const ownedValue = objectValue?.ImmOrOwnedObject || objectValue?.Receiving;
  if (shared === true && !sharedValue) return '';
  if (shared === false && !ownedValue) return '';
  if (sharedValue && mutable != null && sharedValue.mutable !== mutable) return '';
  try {
    return normalizeSuiAddress(String(sharedValue?.objectId || ownedValue?.objectId || ''));
  } catch {
    return '';
  }
}

/**
 * Prove that wallet-returned bytes are only the one lifecycle Move call bound
 * by the recovery identity. Shared objects do not encode their current object
 * version, so the pre-sign fresh read and post-effects input version/digest
 * checks remain separate mandatory boundaries.
 */
export async function validateExpansionPackLifecycleSignedTransaction({
  signed,
  identity: identityValue,
  runtime,
  suiClient,
  verifySignature = verifyTransactionSignature,
} = {}) {
  const identity = expansionPackLifecycleRecoveryIdentity(identityValue);
  let bytes;
  let data;
  try {
    bytes = fromBase64(String(signed?.bytes || ''));
    data = TransactionDataBuilder.fromBytes(bytes).snapshot();
  } catch {
    fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SIGNED_TRANSACTION_MISMATCH,
      'Wallet-returned lifecycle transaction bytes are not valid Sui TransactionData.',
    );
  }
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const suppliedDigest = text(signed?.transactionDigest ?? signed?.digest);
  const expectedFunction = `${identity.action}_expansion_pack_v8`;
  const command = data?.commands?.[0]?.MoveCall;
  const expectedArgumentCount = identity.action === 'resume' ? 4 : 2;
  let sender = '';
  let gasOwner = '';
  let callable = '';
  let commandPackage = '';
  let commerceConfigId = '';
  try {
    sender = normalizeSuiAddress(String(data?.sender || ''));
    gasOwner = normalizeSuiAddress(String(data?.gasData?.owner || data?.sender || ''));
    callable = normalizeSuiAddress(String(runtime?.expansionPackV8CallablePackageId || ''));
    commandPackage = normalizeSuiAddress(String(command?.package || ''));
    commerceConfigId = normalizeSuiAddress(String(runtime?.commerceProtocolConfigV5Id || ''));
  } catch {
    // Exact comparison below remains fail closed.
  }
  const exactArguments = Array.isArray(command?.arguments)
    && command.arguments.length === expectedArgumentCount
    && command.arguments.every((argument, index) => argument?.Input === index);
  const exactInputs = Array.isArray(data?.inputs)
    && data.inputs.length === expectedArgumentCount
    && objectInput(data, command?.arguments?.[0], { shared: true, mutable: true })
      === identity.releaseId
    && objectInput(data, command?.arguments?.[1], { shared: false }) === identity.adminCapId
    && (identity.action !== 'resume'
      || (
        objectInput(data, command?.arguments?.[2], { shared: true, mutable: false })
          === identity.parentRootId
        && objectInput(data, command?.arguments?.[3], { shared: true, mutable: false })
          === commerceConfigId
      ));
  if (!bytes.length
    || !suppliedDigest
    || digest !== suppliedDigest
    || sender !== identity.walletAddress
    || gasOwner !== identity.walletAddress
    || data?.commands?.length !== 1
    || !command
    || commandPackage !== callable
    || command.module !== 'expansion_pack_v8'
    || command.function !== expectedFunction
    || !Array.isArray(command.typeArguments)
    || command.typeArguments.length !== 0
    || !exactArguments
    || !exactInputs) fail(
    EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SIGNED_TRANSACTION_MISMATCH,
    'Wallet-returned bytes do not match the exact lifecycle action and authority identity.',
    { action: identity.action, releaseId: identity.releaseId },
  );
  try {
    await verifySignature(bytes, String(signed?.signature || ''), {
      address: identity.walletAddress,
      client: suiClient,
    });
  } catch {
    fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SIGNED_TRANSACTION_MISMATCH,
      'The lifecycle signature is not valid for the exact transaction bytes and wallet.',
    );
  }
  return deepFreeze({ digest, sender, action: identity.action, releaseId: identity.releaseId });
}

/**
 * Pure coordinator for one durable Expansion Pack lifecycle transition. It has
 * no UI or global wallet dependencies and never returns signed bytes.
 */
export function createExpansionPackLifecycleController({
  runtime,
  suiClient,
  recoveryStore,
  signTransactionForRecovery,
  executeSignedTransactionAndWait,
  withExclusiveReleaseLock,
  validateSignedTransaction = validateExpansionPackLifecycleSignedTransaction,
  sessionIdFactory = defaultSessionId,
} = {}) {
  const sign = dependency(signTransactionForRecovery, 'signTransactionForRecovery');
  const executeSigned = dependency(
    executeSignedTransactionAndWait,
    'executeSignedTransactionAndWait',
  );
  const nextSessionId = dependency(sessionIdFactory, 'sessionIdFactory');
  const withReleaseLock = dependency(withExclusiveReleaseLock, 'withExclusiveReleaseLock');
  const validateSigned = dependency(validateSignedTransaction, 'validateSignedTransaction');
  const loadPending = storeDependency(recoveryStore, 'loadPending');
  const listPendingForRelease = storeDependency(recoveryStore, 'listPendingForRelease');
  const listFailuresForRelease = storeDependency(
    recoveryStore,
    'listFinalizedFailuresForRelease',
  );
  const loadReceipt = storeDependency(recoveryStore, 'loadVerifiedReceipt');
  const loadFailure = storeDependency(recoveryStore, 'loadFinalizedFailure');
  const persistSigned = storeDependency(recoveryStore, 'persistSignedTransaction');
  const checkpoint = storeDependency(recoveryStore, 'checkpointPending');
  const storeReceipt = storeDependency(recoveryStore, 'storeVerifiedReceipt');
  const storeFailure = storeDependency(recoveryStore, 'storeFinalizedFailure');
  const terminalResults = new Map();

  async function freshRead(input = {}) {
    return readExpansionPackLifecycleV8({
      suiClient,
      runtime,
      walletAddress: input.walletAddress,
      releaseId: input.releaseId,
      adminCapId: input.adminCapId,
      treasuryId: input.treasuryId,
      parentRootId: input.parentRootId,
    });
  }

  async function assertContext(assertActive, identity, digest = '') {
    if (typeof assertActive !== 'function') return;
    try {
      const active = await assertActive(deepFreeze({
        ...publicIdentity(identity),
        transactionDigest: text(digest),
      }));
      if (active === false) throw new Error('inactive');
    } catch (cause) {
      fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.CONTEXT_CHANGED,
        'The active wallet or Expansion Pack changed. The signed checkpoint was kept and was not broadcast.',
        { causeCode: text(cause?.code) },
      );
    }
  }

  async function descriptorForIdentity(identity, { broadcast = false } = {}) {
    const descriptor = await freshRead({
      walletAddress: identity.walletAddress,
      releaseId: identity.releaseId,
      adminCapId: identity.adminCapId,
      parentRootId: identity.parentRootId,
    });
    const observed = expansionPackLifecycleRecoveryIdentity({
      ...publicIdentity(identity),
      releaseId: descriptor.release.objectId,
      adminCapId: descriptor.adminCap.objectId,
      parentRootId: descriptor.parent.objectId,
      releaseObjectVersion: descriptor.release.objectVersion,
      releaseObjectDigest: descriptor.release.objectDigest,
      action: identity.action,
    });
    const observedLifecycle = Number(descriptor.lifecycle);
    if (!sameIdentity(observed, identity)) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
      'The authoritative Expansion Pack linkage changed after this transaction was signed.',
    );
    const accepted = broadcast
      ? [identity.fromLifecycle]
      : [identity.fromLifecycle, identity.toLifecycle];
    if (!accepted.includes(observedLifecycle)) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
      'The Expansion Pack lifecycle no longer matches the exact persisted transition.',
      {
        observedLifecycle: Number(descriptor.lifecycle),
        expectedFromLifecycle: identity.fromLifecycle,
        expectedToLifecycle: identity.toLifecycle,
      },
    );
    if (broadcast && (!descriptor.authorityReady
      || !descriptor.allowedActions?.includes(identity.action))) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
      'The exact persisted lifecycle action is no longer authorized by the fresh chain read.',
    );
    return descriptor;
  }

  async function withLane(key, operation) {
    const previous = LIFECYCLE_LANE_TAILS.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    LIFECYCLE_LANE_TAILS.set(key, current);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (LIFECYCLE_LANE_TAILS.get(key) === current) LIFECYCLE_LANE_TAILS.delete(key);
    }
  }

  async function exactStoredReceipt(identity, pending, readback) {
    await storeReceipt(identity, {
      ...readback,
      transactionDigest: pending.signed.digest,
      readbackVerified: true,
    }, {
      expectedRevision: pending.revision,
      sessionId: pending.sessionId,
    });
    const [receipt, remaining] = await Promise.all([
      loadReceipt(identity),
      loadPending(identity),
    ]);
    if (!receipt || remaining
      || receipt.transactionDigest !== pending.signed.digest
      || receipt.previousLifecycle !== identity.fromLifecycle
      || receipt.lifecycle !== identity.toLifecycle) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
      'The verified lifecycle receipt did not survive exact durable readback.',
    );
    const result = verifiedResult(identity, receipt);
    terminalResults.set(identity.key, result);
    return result;
  }

  async function exactStoredFailure(identity, pending, failure) {
    await storeFailure(identity, failure, {
      expectedRevision: pending.revision,
      sessionId: pending.sessionId,
    });
    const [stored, remaining] = await Promise.all([
      loadFailure(identity, pending.signed.digest),
      loadPending(identity),
    ]);
    if (!stored || remaining
      || stored.transactionDigest !== pending.signed.digest
      || stored.finalized !== true
      || stored.executionStatus !== 'FAILURE') fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
      'The finalized lifecycle failure did not survive exact durable readback.',
    );
    const result = failureResult(identity, stored);
    terminalResults.set(identity.key, result);
    return result;
  }

  async function markOutcomePending(identity, pending, error) {
    const saved = await checkpoint(identity, {
      state: EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE.OUTCOME_PENDING,
      lastErrorCode: text(error?.code) || 'EXPANSION_PACK_LIFECYCLE_OUTCOME_PENDING',
    }, {
      expectedRevision: pending.revision,
      sessionId: pending.sessionId,
    });
    const readback = await loadPending(identity);
    if (!readback || readback.revision !== saved.revision
      || readback.state !== EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE.OUTCOME_PENDING
      || readback.signed?.digest !== pending.signed.digest) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
      'The uncertain lifecycle outcome was not durably checkpointed.',
    );
    return pendingResult(identity, readback, error);
  }

  async function restoreSignedAfterBlockedBroadcast(identity, pending, error) {
    const saved = await checkpoint(identity, {
      state: EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE.SIGNED,
      lastErrorCode: text(error?.code),
    }, {
      expectedRevision: pending.revision,
      sessionId: pending.sessionId,
    });
    const readback = await loadPending(identity);
    if (!readback || readback.revision !== saved.revision
      || readback.state !== EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE.SIGNED
      || readback.signed?.digest !== pending.signed.digest) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
      'The blocked lifecycle broadcast did not preserve its signed checkpoint.',
    );
  }

  function transactionBoundReadback(identity, transactionDigest, submission) {
    const digest = text(submission?.transactionDigest ?? submission?.digest);
    if (digest !== transactionDigest) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SUBMISSION_DIGEST_MISMATCH,
      'Sui returned a different digest for the persisted lifecycle transaction.',
    );
    const indexed = indexedTransaction(submission?.indexed);
    if (transactionStatus(indexed) !== 'success') fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
      'The exact lifecycle transaction did not include successful finalized effects.',
    );
    exactReleaseWrite(indexed, identity, runtime);
    const matches = array(indexed.events).filter((entry) => {
      if (!lifecycleEventMatchesType(entry, runtime)) return false;
      const event = eventJson(entry);
      let releaseId;
      try {
        releaseId = normalizeSuiAddress(String(event.release_id ?? event.releaseId ?? ''));
      } catch {
        return false;
      }
      return releaseId === identity.releaseId
        && Number(event.previous_lifecycle ?? event.previousLifecycle) === identity.fromLifecycle
        && Number(event.lifecycle) === identity.toLifecycle;
    });
    if (matches.length !== 1) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
      'The exact lifecycle transaction must contain one matching transition event.',
      { eventCount: matches.length },
    );
    return deepFreeze({
      transactionDigest: digest,
      previousLifecycle: identity.fromLifecycle,
      lifecycle: identity.toLifecycle,
      readbackVerified: true,
    });
  }

  async function submitPending(identity, pending, assertActive) {
    await validateSigned({ signed: pending.signed, identity, runtime, suiClient });
    pending = await checkpoint(identity, {
      state: EXPANSION_PACK_LIFECYCLE_RECOVERY_STATE.BROADCASTING,
      lastErrorCode: '',
    }, {
      expectedRevision: pending.revision,
      sessionId: pending.sessionId,
    });

    let atBroadcastBoundary = false;
    let readback;
    try {
      const submission = await executeSigned(pending.signed, {
        assertBeforeExecute: async () => {
          try {
            await assertContext(assertActive, identity, pending.signed.digest);
            await descriptorForIdentity(identity, { broadcast: true });
          } catch (error) {
            error.lifecycleBroadcastBlocked = true;
            throw error;
          }
          atBroadcastBoundary = true;
        },
      });
      const digest = text(submission?.transactionDigest ?? submission?.digest);
      if (digest !== pending.signed.digest) fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.SUBMISSION_DIGEST_MISMATCH,
        'Sui returned a different digest for the persisted lifecycle transaction.',
      );
      readback = transactionBoundReadback(identity, pending.signed.digest, submission);
    } catch (error) {
      const failure = finalizedFailure(error, pending.signed.digest);
      if (failure) return exactStoredFailure(identity, pending, failure);
      if (error?.lifecycleBroadcastBlocked === true && !atBroadcastBoundary) {
        await restoreSignedAfterBlockedBroadcast(identity, pending, error);
        throw error;
      }
      return markOutcomePending(identity, pending, error);
    }
    return exactStoredReceipt(identity, pending, readback);
  }

  async function execute(input = {}) {
    const kind = text(input.kind).toLowerCase();
    const walletAddress = normalizeSuiAddress(String(input.walletAddress ?? ''));
    const releaseId = normalizeSuiAddress(String(input.releaseId ?? ''));
    const walletReleaseKey = [walletAddress, releaseId].map(encodeURIComponent).join(':');

    return withLane(walletReleaseKey, () => withReleaseLock(
      walletReleaseKey,
      async () => {
      const releasePending = await listPendingForRelease({ walletAddress, releaseId });
      if (releasePending.length > 1) fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
        'More than one lifecycle transaction is pending for this wallet and Release.',
      );
      if (releasePending[0]) {
        const pending = releasePending[0];
        const identity = expansionPackLifecycleRecoveryIdentity(pending);
        const receipt = await loadReceipt(identity);
        if (receipt) {
          const result = verifiedResult(identity, receipt);
          terminalResults.set(identity.key, result);
          return result;
        }
        const failure = await loadFailure(identity, pending.signed.digest);
        if (failure) {
          const result = failureResult(identity, failure);
          terminalResults.set(identity.key, result);
          return result;
        }
        return submitPending(identity, pending, input.assertActive);
      }

      const initialDescriptor = await freshRead(input);
      const initial = createExpansionPackLifecycleAction({
        kind,
        runtime,
        descriptor: initialDescriptor,
        sender: input.walletAddress,
      });
      const identity = identityForDescriptor(kind, input.walletAddress, initialDescriptor, initial);
      if (terminalResults.has(identity.key)) return terminalResults.get(identity.key);
      const receipt = await loadReceipt(identity);
      if (receipt) {
        const result = verifiedResult(identity, receipt);
        terminalResults.set(identity.key, result);
        return result;
      }
      const failure = await loadFailure(identity);
      if (failure) {
        const result = failureResult(identity, failure);
        terminalResults.set(identity.key, result);
        return result;
      }
      const releaseFailures = await listFailuresForRelease({
        walletAddress: identity.walletAddress,
        releaseId: identity.releaseId,
      });
      const exactStateFailure = releaseFailures.find((record) => (
        record.releaseObjectVersion === identity.releaseObjectVersion
        && record.releaseObjectDigest === identity.releaseObjectDigest
      ));
      if (exactStateFailure) {
        if (sameIdentity(exactStateFailure, identity)) {
          const result = failureResult(identity, exactStateFailure);
          terminalResults.set(identity.key, result);
          return result;
        }
        fail(
          EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RELEASE_PENDING_CONFLICT,
          'This exact Release state already has a finalized lifecycle failure. No alternative action may be signed.',
          { failureKey: text(exactStateFailure.key, 1000) },
        );
      }
      let pending = await loadPending(identity);
      if (pending) {
        return submitPending(identity, pending, input.assertActive);
      }

      await assertContext(input.assertActive, identity);
      // The second authoritative read is deliberately adjacent to the signing
      // boundary. Any changed transition produces a different identity or is
      // rejected by the audited action builder before the wallet is opened.
      const signingDescriptor = await freshRead(input);
      if (Number(signingDescriptor.lifecycle) !== identity.fromLifecycle) fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
        'The Expansion Pack transition changed immediately before signing.',
        {
          observedLifecycle: Number(signingDescriptor.lifecycle),
          expectedFromLifecycle: identity.fromLifecycle,
        },
      );
      const signingAction = createExpansionPackLifecycleAction({
        kind,
        runtime,
        descriptor: signingDescriptor,
        sender: input.walletAddress,
      });
      const signingIdentity = identityForDescriptor(
        kind,
        input.walletAddress,
        signingDescriptor,
        signingAction,
      );
      if (!sameIdentity(signingIdentity, identity)) fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
        'The Expansion Pack transition changed immediately before signing.',
      );
      await assertContext(input.assertActive, identity);
      const signed = await sign(signingAction.transaction, {
        expectedWallet: identity.walletAddress,
      });
      await validateSigned({ signed, identity, runtime, suiClient });
      // Always persist a wallet-returned signature before another context check.
      const persisted = await persistSigned(identity, signed, {
        expectedRevision: 0,
        sessionId: await nextSessionId(deepFreeze(publicIdentity(identity))),
      });
      pending = persisted?.record;
      if (persisted?.saved !== true || persisted?.verified !== true || !pending
        || pending.signed?.digest !== text(signed?.transactionDigest ?? signed?.digest)) fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_READBACK_MISMATCH,
        'Signed lifecycle bytes were not durably saved before broadcast.',
      );
      return submitPending(identity, pending, input.assertActive);
      },
    ));
  }

  async function recover(input = {}) {
    const identity = expansionPackLifecycleRecoveryIdentity(input.identity);
    return withLane(identity.walletReleaseKey, () => withReleaseLock(
      identity.walletReleaseKey,
      async () => {
      if (terminalResults.has(identity.key)) return terminalResults.get(identity.key);
      const receipt = await loadReceipt(identity);
      if (receipt) {
        const result = verifiedResult(identity, receipt);
        terminalResults.set(identity.key, result);
        return result;
      }
      const requestedDigest = text(
        input.transactionDigest ?? input.digest ?? input.identity?.transactionDigest,
      );
      const pending = await loadPending(identity);
      if (pending) {
        if (requestedDigest && requestedDigest !== pending.signed.digest) fail(
          EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_DIGEST_MISMATCH,
          'The requested recovery digest does not match the persisted signed transaction.',
        );
        const failure = await loadFailure(identity, pending.signed.digest);
        if (failure) {
          const result = failureResult(identity, failure);
          terminalResults.set(identity.key, result);
          return result;
        }
        return submitPending(identity, pending, input.assertActive);
      }
      if (!requestedDigest) fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_DIGEST_REQUIRED,
        'An exact transaction digest is required to recover a terminal lifecycle failure.',
      );
      const failure = await loadFailure(identity, requestedDigest);
      if (failure) {
        const result = failureResult(identity, failure);
        terminalResults.set(identity.key, result);
        return result;
      }
      fail(
        EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.RECOVERY_NOT_FOUND,
        'No exact pending, verified or finalized lifecycle recovery record exists.',
      );
      },
    ));
  }

  return Object.freeze({ freshRead, execute, recover });
}
