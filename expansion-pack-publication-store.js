/**
 * Durable, exact-identity persistence for independent Expansion Pack v8
 * publication. This store is deliberately separate from editable Pack drafts:
 * once publication starts, its bytes and parent binding are immutable.
 */

import {
  EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA,
  hydrateExpansionPackPublicationRecovery,
} from './expansion-pack-publication-recovery.js';

export const EXPANSION_PACK_PUBLICATION_DATABASE_NAME =
  'animacraft-expansion-pack-publication-v8';
export const EXPANSION_PACK_PUBLICATION_DATABASE_VERSION = 3;
export const EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE = 'publication-checkpoints';
export const EXPANSION_PACK_PUBLICATION_RECEIPT_STORE = 'published-receipts';

export class ExpansionPackPublicationStoreError extends Error {
  constructor(message, code = 'EXPANSION_PACK_PUBLICATION_STORE_ERROR', details = {}) {
    super(message);
    this.name = 'ExpansionPackPublicationStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ExpansionPackPublicationStoreError(message, code, details);
}

function text(value) {
  return String(value ?? '').trim();
}

function sameObjectId(left, right) {
  try {
    return BigInt(text(left)) === BigInt(text(right));
  } catch {
    return text(left).toLowerCase() === text(right).toLowerCase();
  }
}

function required(value, label, { lowerCase = false } = {}) {
  const normalized = text(value);
  if (!normalized) fail('EXPANSION_PACK_PUBLICATION_IDENTITY_MISSING', `${label} is required.`, { label });
  return lowerCase ? normalized.toLowerCase() : normalized;
}

function normalizedHash(value, label) {
  const normalized = required(value, label).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_IDENTITY_HASH_INVALID',
      `${label} must be an exact SHA-256 commitment.`,
      { label },
    );
  }
  return normalized;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizedIdentity(identityValue = {}) {
  const plan = identityValue.plan?.schema === EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA
    ? identityValue.plan
    : null;
  const context = plan?.context || {};
  const candidate = plan?.candidate || {};
  const identity = {
    walletAddress: required(
      identityValue.walletAddress ?? identityValue.owner ?? context.owner,
      'Wallet address',
      { lowerCase: true },
    ),
    baseMakerRootId: required(
      identityValue.baseMakerRootId ?? context.baseMakerRootId,
      'Parent MakerRootV5 id',
      { lowerCase: true },
    ),
    parentVersionNumber: required(
      identityValue.parentVersionNumber ?? identityValue.parentVersion ?? context.parentVersion,
      'Parent Maker version number',
    ),
    parentVersionId: required(
      identityValue.parentVersionId ?? context.parentVersionId,
      'Parent Maker version id',
    ),
    parentReleaseId: required(
      identityValue.parentReleaseId
        ?? identityValue.parentLegacyMakerId
        ?? context.parentLegacyMakerId,
      'Parent release id',
      { lowerCase: true },
    ),
    parentManifestBlobId: required(
      identityValue.parentManifestBlobId ?? context.parentManifestBlobId,
      'Parent manifest Blob/Quilt id',
    ),
    parentManifestSha256: normalizedHash(
      identityValue.parentManifestSha256 ?? identityValue.parentManifestHash
        ?? context.parentManifestSha256,
      'Parent manifest SHA-256',
    ),
    packId: required(identityValue.packId ?? context.packId, 'Expansion Pack id'),
    packVersion: required(identityValue.packVersion ?? context.packVersion, 'Expansion Pack version'),
    candidateCommitment: normalizedHash(
      identityValue.candidateCommitment ?? candidate.candidateCommitment,
      'Pack candidate commitment',
    ),
    manifestSha256: normalizedHash(
      identityValue.manifestSha256 ?? candidate.manifestSha256,
      'Pack manifest SHA-256',
    ),
  };
  const sourceKey = Object.values(identity).map((value) => encodeURIComponent(value)).join(':');
  const logicalLaneKey = [
    identity.walletAddress,
    identity.baseMakerRootId,
    identity.parentVersionNumber,
    identity.parentVersionId,
    identity.parentReleaseId,
    identity.parentManifestBlobId,
    identity.parentManifestSha256,
    identity.packId,
    identity.packVersion,
  ].map((value) => encodeURIComponent(value)).join(':');
  return Object.freeze({
    ...identity,
    // One logical parent/Pack version has exactly one recoverable publication
    // lane. Candidate hashes stay as immutable source evidence but are not
    // allowed to create a second child Release after an edit or reload.
    key: logicalLaneKey,
    sourceKey,
    walletParentKey: `${encodeURIComponent(identity.walletAddress)}:${encodeURIComponent(identity.baseMakerRootId)}`,
    parentReleaseKey: [
      identity.baseMakerRootId,
      identity.parentVersionNumber,
      identity.parentVersionId,
      identity.parentReleaseId,
      identity.parentManifestBlobId,
      identity.parentManifestSha256,
    ].map((value) => encodeURIComponent(value)).join(':'),
    packReleaseKey: [identity.packId, identity.packVersion]
      .map((value) => encodeURIComponent(value)).join(':'),
    logicalLaneKey,
  });
}

export function expansionPackPublicationIdentity(value) {
  return normalizedIdentity(value);
}

export function expansionPackPublicationKey(value) {
  return normalizedIdentity(value).key;
}

function persistenceRevision(value, { allowNull = true } = {}) {
  if ((value === null || value === undefined) && allowNull) return null;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    fail(
      'EXPANSION_PACK_PUBLICATION_REVISION_INVALID',
      'Publication persistence revision must be a positive safe integer.',
    );
  }
  return revision;
}

function uploadSessionId(snapshot) {
  return text(
    snapshot?.walrusRecovery?.uploadSessionId
      || snapshot?.recovery?.actions?.find((entry) => entry?.outputs?.walrusRecovery)
        ?.outputs?.walrusRecovery?.uploadSessionId,
  );
}

function verifyCandidate(candidate, candidateIdentity, sourceIdentity, plan) {
  if (
    text(candidate?.candidateCommitment).replace(/^0x/i, '').toLowerCase()
      !== candidateIdentity.candidateCommitment
    || text(candidate?.manifestSha256).replace(/^0x/i, '').toLowerCase()
      !== candidateIdentity.manifestSha256
    || text(plan?.candidate?.candidateCommitment).replace(/^0x/i, '').toLowerCase()
      !== sourceIdentity.candidateCommitment
    || text(plan?.candidate?.manifestSha256).replace(/^0x/i, '').toLowerCase()
      !== sourceIdentity.manifestSha256
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_IDENTITY_MISMATCH',
      'The frozen Pack candidate does not match this persistence lane.',
    );
  }
  const identifiers = (candidate?.files || []).map((entry) => text(entry?.identifier));
  if (!identifiers.length || new Set(identifiers).size !== identifiers.length) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_FILES_INVALID',
      'The frozen Pack candidate file list is missing or duplicated.',
    );
  }
  return identifiers;
}

function verifiedSnapshotIdentity(persistenceIdentity, candidate, plan) {
  const sourceIdentity = normalizedIdentity({ plan });
  if (sourceIdentity.sourceKey !== persistenceIdentity.sourceKey) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_IDENTITY_MISMATCH',
      'The publication plan belongs to another wallet, parent release or Pack release.',
    );
  }
  const candidateCommitment = normalizedHash(
    candidate?.candidateCommitment,
    'Snapshot candidate commitment',
  );
  const manifestSha256 = normalizedHash(
    candidate?.manifestSha256,
    'Snapshot manifest SHA-256',
  );
  if (
    candidateCommitment === sourceIdentity.candidateCommitment
    && manifestSha256 === sourceIdentity.manifestSha256
  ) {
    return { sourceIdentity, candidateIdentity: sourceIdentity, protected: false };
  }
  const protection = candidate?.manifest?.transportProtection || {};
  const source = candidate?.transportSource || {};
  if (
    protection.mode !== 'SEAL_PAID_PACK'
    || !text(protection.sourceCandidateCommitment)
    || !text(protection.sourceManifestSha256)
    || !text(source.candidateCommitment)
    || !text(source.manifestSha256)
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_IDENTITY_MISMATCH',
      'The publication plan belongs to another wallet, parent release or Pack release.',
    );
  }
  const sourceCandidateCommitment = normalizedHash(
    protection.sourceCandidateCommitment,
    'Protected source candidate commitment',
  );
  const sourceManifestSha256 = normalizedHash(
    protection.sourceManifestSha256,
    'Protected source manifest SHA-256',
  );
  if (
    normalizedHash(source.candidateCommitment, 'Candidate transport source commitment')
      !== sourceCandidateCommitment
    || normalizedHash(source.manifestSha256, 'Candidate transport source manifest SHA-256')
      !== sourceManifestSha256
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_IDENTITY_MISMATCH',
      'The paid Pack transport snapshot is not linked to its pre-encryption persistence lane.',
    );
  }
  const protectedSourceIdentity = normalizedIdentity({
    ...sourceIdentity,
    candidateCommitment: sourceCandidateCommitment,
    manifestSha256: sourceManifestSha256,
  });
  if (protectedSourceIdentity.sourceKey !== persistenceIdentity.sourceKey) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_IDENTITY_MISMATCH',
      'The protected Pack snapshot belongs to another immutable publication lane.',
    );
  }
  return {
    sourceIdentity,
    candidateIdentity: normalizedIdentity({
      ...sourceIdentity,
      candidateCommitment,
      manifestSha256,
    }),
    protected: true,
  };
}

async function verifiedSnapshot(identity, snapshotValue) {
  const snapshot = clone(snapshotValue || {});
  const plan = snapshot.plan;
  if (plan?.schema !== EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA) {
    fail('EXPANSION_PACK_PUBLICATION_PLAN_INVALID', 'A supported immutable Pack plan is required.');
  }
  const snapshotIdentity = verifiedSnapshotIdentity(identity, snapshot.candidate, plan);
  const identifiers = verifyCandidate(
    snapshot.candidate,
    snapshotIdentity.candidateIdentity,
    snapshotIdentity.sourceIdentity,
    plan,
  );
  snapshot.recovery = await hydrateExpansionPackPublicationRecovery(snapshot.recovery, { plan });
  const localAction = snapshot.recovery.actions.find((entry) => entry.id === 'local.pack.materialize');
  const createAction = snapshot.recovery.actions.find((entry) => entry.id === 'chain.pack.create');
  const localMaterialized = ['SUBMITTED', 'CONFIRMED'].includes(localAction?.status);
  if (snapshotIdentity.protected && !localMaterialized) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_PHASE_MISMATCH',
      'Protected Pack bytes cannot be persisted before the Release-scoped materialization action.',
    );
  }
  if (localAction?.status === 'CONFIRMED' && Number(plan.context?.accessKind) === 1
    && !snapshotIdentity.protected) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_PHASE_MISMATCH',
      'A confirmed paid Pack materialization cannot retain plaintext upload bytes.',
    );
  }
  if (snapshotIdentity.protected) {
    const releaseId = text(
      createAction?.outputs?.packReleaseId
        || localAction?.submission?.packReleaseId
        || localAction?.outputs?.packReleaseId,
    ).toLowerCase();
    const protectedReleaseId = text(
      snapshot.candidate?.manifest?.transportProtection?.releaseId,
    ).toLowerCase();
    if (!releaseId || !sameObjectId(protectedReleaseId, releaseId)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_SNAPSHOT_RELEASE_MISMATCH',
        'The encrypted Pack snapshot is not scoped to the confirmed child Release object.',
      );
    }
    if (localAction?.status === 'CONFIRMED' && (
      text(localAction.outputs?.candidateCommitment).replace(/^0x/i, '').toLowerCase()
        !== snapshotIdentity.candidateIdentity.candidateCommitment
      || text(localAction.outputs?.manifestSha256).replace(/^0x/i, '').toLowerCase()
        !== snapshotIdentity.candidateIdentity.manifestSha256
      || !sameObjectId(localAction.outputs?.packReleaseId, releaseId)
    )) {
      fail(
        'EXPANSION_PACK_PUBLICATION_SNAPSHOT_RELEASE_MISMATCH',
        'The stored ciphertext does not match the confirmed local materialization output.',
      );
    }
  }
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const entriesRequired = localMaterialized;
  if ((entriesRequired && entries.length !== identifiers.length)
    || (!entriesRequired && entries.length && entries.length !== identifiers.length)) {
    fail(
      'EXPANSION_PACK_PUBLICATION_SNAPSHOT_FILES_INVALID',
      'Every frozen Pack file must be persisted with the publication checkpoint.',
    );
  }
  entries.forEach((entry, index) => {
    if (text(entry?.identifier) !== identifiers[index] || !(entry?.blob instanceof Blob)) {
      fail(
        'EXPANSION_PACK_PUBLICATION_SNAPSHOT_FILES_INVALID',
        'A frozen Pack publication Blob is missing or out of order.',
        { index, identifier: identifiers[index] },
      );
    }
  });
  if (snapshot.receipt && snapshot.recovery.completed !== true) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECEIPT_PREMATURE',
      'A Pack publication receipt can only be persisted after every exact readback completed.',
    );
  }
  if (
    snapshot.receipt
    && (
      text(snapshot.receipt.candidateCommitment).replace(/^0x/i, '').toLowerCase()
        !== snapshotIdentity.candidateIdentity.candidateCommitment
      || text(snapshot.receipt.manifestSha256).replace(/^0x/i, '').toLowerCase()
        !== snapshotIdentity.candidateIdentity.manifestSha256
      || text(snapshot.receipt.parentLegacyMakerId).toLowerCase()
        !== snapshotIdentity.sourceIdentity.parentReleaseId
      || text(snapshot.receipt.baseMakerRootId).toLowerCase()
        !== snapshotIdentity.sourceIdentity.baseMakerRootId
    )
  ) {
    fail(
      'EXPANSION_PACK_PUBLICATION_RECEIPT_IDENTITY_MISMATCH',
      'The verified Pack receipt belongs to another immutable publication.',
    );
  }
  return snapshot;
}

function requestResult(request, message) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new ExpansionPackPublicationStoreError(message),
    );
  });
}

function transactionComplete(transaction, callbackError) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => (
      callbackError?.current ? reject(callbackError.current) : resolve()
    );
    transaction.onabort = () => reject(
      callbackError?.current
      || transaction.error
      || new ExpansionPackPublicationStoreError('Publication storage transaction was aborted.'),
    );
    transaction.onerror = () => {};
  });
}

function openDatabase(indexedDb) {
  if (!indexedDb) {
    fail(
      'EXPANSION_PACK_PUBLICATION_INDEXEDDB_UNAVAILABLE',
      'This browser cannot persist Expansion Pack publication recovery.',
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(
      EXPANSION_PACK_PUBLICATION_DATABASE_NAME,
      EXPANSION_PACK_PUBLICATION_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      let checkpointStore;
      if (!database.objectStoreNames.contains(EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE)) {
        checkpointStore = database.createObjectStore(
          EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE,
          { keyPath: 'key' },
        );
        checkpointStore.createIndex('walletParentKey', 'walletParentKey', { unique: false });
        checkpointStore.createIndex('parentReleaseKey', 'parentReleaseKey', { unique: false });
        checkpointStore.createIndex('packReleaseKey', 'packReleaseKey', { unique: false });
      } else {
        checkpointStore = request.transaction.objectStore(
          EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE,
        );
      }
      if (!checkpointStore.indexNames.contains('logicalLaneKey')) {
        checkpointStore.createIndex('logicalLaneKey', 'logicalLaneKey', { unique: false });
      }
      let receiptStore;
      if (!database.objectStoreNames.contains(EXPANSION_PACK_PUBLICATION_RECEIPT_STORE)) {
        receiptStore = database.createObjectStore(
          EXPANSION_PACK_PUBLICATION_RECEIPT_STORE,
          { keyPath: 'key' },
        );
      } else {
        receiptStore = request.transaction.objectStore(EXPANSION_PACK_PUBLICATION_RECEIPT_STORE);
      }
      if (!receiptStore.indexNames.contains('logicalLaneKey')) {
        receiptStore.createIndex('logicalLaneKey', 'logicalLaneKey', { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new ExpansionPackPublicationStoreError(
      'Close other Animacraft tabs once so Pack publication storage can be upgraded.',
      'EXPANSION_PACK_PUBLICATION_DATABASE_BLOCKED',
    ));
    request.onerror = () => reject(
      request.error
      || new ExpansionPackPublicationStoreError('Could not open Pack publication storage.'),
    );
  });
}

function publicRecord(record) {
  return record ? clone(record) : null;
}

export function createExpansionPackPublicationStore(options = {}) {
  const indexedDb = options.indexedDB ?? globalThis.indexedDB;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;

  const api = {
    async load(identityValue) {
      const identity = normalizedIdentity(identityValue);
      const database = await openDatabase(indexedDb);
      try {
        const transaction = database.transaction(
          EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE,
          'readonly',
        );
        const completion = transactionComplete(transaction);
        const record = await requestResult(
          transaction.objectStore(EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE).get(identity.key),
          'Pack publication checkpoint could not be loaded.',
        );
        await completion;
        return publicRecord(record);
      } finally {
        database.close();
      }
    },

    async loadReceipt(identityValue) {
      const identity = normalizedIdentity(identityValue);
      const database = await openDatabase(indexedDb);
      try {
        const transaction = database.transaction(EXPANSION_PACK_PUBLICATION_RECEIPT_STORE, 'readonly');
        const completion = transactionComplete(transaction);
        const record = await requestResult(
          transaction.objectStore(EXPANSION_PACK_PUBLICATION_RECEIPT_STORE).get(identity.key),
          'Pack publication receipt could not be loaded.',
        );
        await completion;
        return publicRecord(record);
      } finally {
        database.close();
      }
    },

    async save(identityValue, snapshotValue, saveOptions = {}) {
      const identity = normalizedIdentity(identityValue);
      const snapshot = await verifiedSnapshot(identity, snapshotValue);
      const expected = persistenceRevision(saveOptions.expectedRevision);
      const requested = expected === null ? 1 : expected + 1;
      if (
        saveOptions.revision !== undefined
        && persistenceRevision(saveOptions.revision, { allowNull: false }) !== requested
      ) {
        fail(
          'EXPANSION_PACK_PUBLICATION_REVISION_NONSEQUENTIAL',
          `Publication persistence revision must advance exactly to ${requested}.`,
        );
      }
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      let outcome = null;
      try {
        const transaction = database.transaction(
          [
            EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE,
            EXPANSION_PACK_PUBLICATION_RECEIPT_STORE,
          ],
          'readwrite',
        );
        const completion = transactionComplete(transaction, callbackError);
        const store = transaction.objectStore(EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE);
        const receiptStore = transaction.objectStore(EXPANSION_PACK_PUBLICATION_RECEIPT_STORE);
        const receiptRequest = receiptStore.get(identity.key);
        const getRequest = store.get(identity.key);
        getRequest.onsuccess = () => {
          try {
            const existing = getRequest.result || null;
            const published = receiptRequest.result || null;
            const persistedRevision = existing?.persistenceRevision ?? null;
            if (!existing && expected === null && published) {
              outcome = {
                saved: false,
                verified: false,
                conflict: true,
                reason: 'published-lane',
                key: identity.key,
                persistedRevision: null,
              };
              return;
            }
            if ((expected === null && existing) || (expected !== null && persistedRevision !== expected)) {
              outcome = {
                saved: false,
                verified: false,
                conflict: true,
                reason: 'revision',
                key: identity.key,
                persistedRevision,
              };
              return;
            }
            const existingNonce = text(existing?.recoveryNonce);
            const nextNonce = text(snapshot.recovery?.nonce);
            if (existingNonce && existingNonce !== nextNonce) {
              outcome = {
                saved: false,
                verified: false,
                conflict: true,
                reason: 'recovery-session',
                key: identity.key,
                persistedRevision,
              };
              return;
            }
            const existingUploadSession = text(existing?.uploadSessionId);
            const nextUploadSession = uploadSessionId(snapshot);
            if (existingUploadSession && nextUploadSession && existingUploadSession !== nextUploadSession) {
              outcome = {
                saved: false,
                verified: false,
                conflict: true,
                reason: 'upload-session',
                key: identity.key,
                persistedRevision,
              };
              return;
            }
            if (Number(snapshot.recovery?.sequence || 0) < Number(existing?.recoverySequence || 0)) {
              outcome = {
                saved: false,
                verified: false,
                conflict: true,
                reason: 'stale-recovery',
                key: identity.key,
                persistedRevision,
              };
              return;
            }
            const savedAt = Number(clock());
            const record = {
              ...identity,
              persistenceRevision: requested,
              recoverySequence: Number(snapshot.recovery.sequence || 0),
              recoveryNonce: nextNonce,
              uploadSessionId: nextUploadSession || existingUploadSession,
              savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
              snapshot,
            };
            store.put(record);
            if (snapshot.receipt) {
              receiptStore.put({
                ...identity,
                receipt: clone(snapshot.receipt),
                planIdentity: text(snapshot.plan?.planIdentity),
                recoveryIdentity: text(snapshot.recovery?.recoveryIdentity),
                persistedAt: record.savedAt,
              });
            }
            outcome = {
              saved: true,
              verified: false,
              conflict: false,
              key: identity.key,
              persistedRevision: requested,
              savedAt: record.savedAt,
            };
          } catch (error) {
            callbackError.current = error;
            transaction.abort();
          }
        };
        getRequest.onerror = () => {
          callbackError.current = getRequest.error
            || new ExpansionPackPublicationStoreError('Pack publication revision could not be read.');
          transaction.abort();
        };
        receiptRequest.onerror = () => {
          callbackError.current = receiptRequest.error
            || new ExpansionPackPublicationStoreError('Pack publication receipt lane could not be read.');
          transaction.abort();
        };
        await completion;
      } finally {
        database.close();
      }
      if (!outcome?.saved) return outcome;
      const readback = await api.load(identity);
      const verified = Boolean(
        readback
        && readback.persistenceRevision === outcome.persistedRevision
        && readback.key === identity.key
        && readback.recoveryNonce === text(snapshot.recovery?.nonce)
        && Number(readback.recoverySequence) === Number(snapshot.recovery?.sequence || 0)
      );
      if (!verified) {
        return { ...outcome, saved: false, verified: false, conflict: false, reason: 'readback' };
      }
      if (snapshot.receipt) {
        const receiptReadback = await api.loadReceipt(identity);
        if (
          !receiptReadback
          || text(receiptReadback.receipt?.packReleaseId).toLowerCase()
            !== text(snapshot.receipt.packReleaseId).toLowerCase()
          || text(receiptReadback.receipt?.transactionDigest)
            !== text(snapshot.receipt.transactionDigest)
        ) {
          return { ...outcome, saved: false, verified: false, conflict: false, reason: 'receipt-readback' };
        }
      }
      return { ...outcome, verified: true };
    },

    async delete(identityValue, deleteOptions = {}) {
      const identity = normalizedIdentity(identityValue);
      const expected = persistenceRevision(deleteOptions.expectedRevision, { allowNull: false });
      const expectedNonce = required(deleteOptions.recoveryNonce, 'Publication recovery nonce');
      const expectedUploadSession = text(deleteOptions.uploadSessionId);
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      let outcome = null;
      try {
        const transaction = database.transaction(
          EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE,
          'readwrite',
        );
        const completion = transactionComplete(transaction, callbackError);
        const store = transaction.objectStore(EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE);
        const request = store.get(identity.key);
        request.onsuccess = () => {
          try {
            const existing = request.result || null;
            const matches = existing
              && existing.persistenceRevision === expected
              && existing.recoveryNonce === expectedNonce
              && (!expectedUploadSession || existing.uploadSessionId === expectedUploadSession);
            if (!matches) {
              outcome = {
                deleted: false,
                conflict: true,
                key: identity.key,
                persistedRevision: existing?.persistenceRevision ?? null,
              };
              return;
            }
            store.delete(identity.key);
            outcome = {
              deleted: true,
              conflict: false,
              key: identity.key,
              persistedRevision: expected,
            };
          } catch (error) {
            callbackError.current = error;
            transaction.abort();
          }
        };
        request.onerror = () => {
          callbackError.current = request.error
            || new ExpansionPackPublicationStoreError('Pack publication checkpoint could not be read.');
          transaction.abort();
        };
        await completion;
        return outcome;
      } finally {
        database.close();
      }
    },
  };
  return api;
}
