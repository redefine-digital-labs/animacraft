import { normalizeSuiAddress } from '@mysten/sui/utils';
import {
  createExpansionPackLifecycleAction,
  readExpansionPackLifecycleSubmission,
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

function recoveryAction(identity, runtime, descriptor) {
  const callablePackage = normalizeSuiAddress(String(
    runtime?.expansionPackV8CallablePackageId || runtime?.expansionPackV8PackageId || '',
  ));
  const inputs = {
    packReleaseId: identity.releaseId,
    packAdminCapId: identity.adminCapId,
  };
  if (identity.action === 'resume') {
    inputs.baseMakerRootId = identity.parentRootId;
    inputs.commerceProtocolConfigV5Id = descriptor?.parent?.config?.objectId;
  }
  return deepFreeze({
    id: `chain.pack.${identity.action}`,
    transport: 'SUI',
    target: `${callablePackage}::expansion_pack_v8::${identity.action}_expansion_pack_v8`,
    authority: { signer: identity.walletAddress },
    typeArguments: [],
    inputs,
    fromLifecycle: identity.fromLifecycle,
    toLifecycle: identity.toLifecycle,
  });
}

function identityForDescriptor(kind, walletAddress, descriptor, transition) {
  return expansionPackLifecycleRecoveryIdentity({
    walletAddress,
    releaseId: descriptor?.release?.objectId,
    adminCapId: descriptor?.adminCap?.objectId,
    parentRootId: descriptor?.parent?.objectId,
    action: kind,
    fromLifecycle: transition.fromLifecycle,
    toLifecycle: transition.toLifecycle,
  });
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
  sessionIdFactory = defaultSessionId,
} = {}) {
  const sign = dependency(signTransactionForRecovery, 'signTransactionForRecovery');
  const executeSigned = dependency(
    executeSignedTransactionAndWait,
    'executeSignedTransactionAndWait',
  );
  const nextSessionId = dependency(sessionIdFactory, 'sessionIdFactory');
  const loadPending = storeDependency(recoveryStore, 'loadPending');
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
      action: identity.action,
    });
    if (!sameIdentity(observed, identity)) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
      'The authoritative Expansion Pack linkage changed after this transaction was signed.',
    );
    const accepted = broadcast
      ? [identity.fromLifecycle]
      : [identity.fromLifecycle, identity.toLifecycle];
    if (!accepted.includes(Number(descriptor.lifecycle))) fail(
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

  async function submitPending(identity, pending, assertActive, descriptor = null) {
    await assertContext(assertActive, identity, pending.signed.digest);
    const currentDescriptor = descriptor || await descriptorForIdentity(identity);
    if (![identity.fromLifecycle, identity.toLifecycle].includes(
      Number(currentDescriptor.lifecycle),
    )) fail(
      EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
      'The Expansion Pack lifecycle no longer matches the exact persisted transition.',
    );
    const action = recoveryAction(identity, runtime, currentDescriptor);
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
      readback = await readExpansionPackLifecycleSubmission({
        action,
        submission,
        suiClient,
        runtime,
        fromLifecycle: identity.fromLifecycle,
        toLifecycle: identity.toLifecycle,
      });
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
    const initialDescriptor = await freshRead(input);
    const initial = createExpansionPackLifecycleAction({
      kind,
      runtime,
      descriptor: initialDescriptor,
      sender: input.walletAddress,
    });
    const identity = identityForDescriptor(kind, input.walletAddress, initialDescriptor, initial);

    return withLane(identity.walletReleaseKey, async () => {
      if (terminalResults.has(identity.key)) return terminalResults.get(identity.key);
      const receipt = await loadReceipt(identity);
      if (receipt) {
        const result = verifiedResult(identity, receipt);
        terminalResults.set(identity.key, result);
        return result;
      }
      let pending = await loadPending(identity);
      if (pending) {
        const failure = await loadFailure(identity, pending.signed.digest);
        if (failure) {
          const result = failureResult(identity, failure);
          terminalResults.set(identity.key, result);
          return result;
        }
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
    });
  }

  async function recover(input = {}) {
    const identity = expansionPackLifecycleRecoveryIdentity(input.identity);
    return withLane(identity.walletReleaseKey, async () => {
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
        const descriptor = await descriptorForIdentity(identity);
        if (Number(descriptor.lifecycle) === identity.fromLifecycle
          && !descriptor.allowedActions?.includes(identity.action)) fail(
          EXPANSION_PACK_LIFECYCLE_CONTROLLER_ERROR.TRANSITION_DRIFT,
          'The exact persisted lifecycle action is no longer authorized by the fresh chain read.',
        );
        return submitPending(identity, pending, input.assertActive, descriptor);
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
    });
  }

  return Object.freeze({ freshRead, execute, recover });
}
