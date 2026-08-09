/**
 * Independent, revision-checked persistence for Expansion Pack projects.
 *
 * Pack drafts intentionally live outside the Maker draft database. The full
 * key is fixed before every transaction, so a late save cannot read whatever
 * Maker or Pack happens to be selected in the UI when it eventually runs.
 */

import {
  EXPANSION_PACK_PARENT_BINDING_KINDS,
  rehydrateExpansionPackProject,
} from './expansion-pack-project.js';

export const EXPANSION_PACK_DRAFT_DATABASE_NAME = 'animacraft-expansion-pack-workspace-v8';
export const EXPANSION_PACK_DRAFT_DATABASE_VERSION = 1;
export const EXPANSION_PACK_DRAFT_STORE = 'expansion-pack-projects';

export class ExpansionPackDraftStoreError extends Error {
  constructor(message, code = 'expansion-pack-draft-store-error', details = {}) {
    super(message);
    this.name = 'ExpansionPackDraftStoreError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function keySegment(value, label, { lowerCase = false } = {}) {
  let result = String(value ?? '').trim();
  if (!result) {
    throw new ExpansionPackDraftStoreError(
      `${label} is required.`,
      'missing-expansion-pack-draft-key',
      { field: label },
    );
  }
  if (result.includes(':')) {
    throw new ExpansionPackDraftStoreError(
      `${label} cannot contain a colon.`,
      'invalid-expansion-pack-draft-key',
      { field: label, value: result },
    );
  }
  if (lowerCase) result = result.toLowerCase();
  return result;
}

function normalizeIdentity(identity = {}) {
  const walletAddress = keySegment(identity.walletAddress, 'Wallet address', { lowerCase: true });
  const parentRootId = keySegment(
    identity.parentRootId ?? identity.rootMakerId,
    'Parent Maker root id',
  );
  const parentVersion = keySegment(
    identity.parentVersion ?? identity.versionNumber,
    'Parent Maker version',
  );
  const parentBindingKind = keySegment(identity.parentBindingKind, 'Parent binding kind');
  if (!Object.values(EXPANSION_PACK_PARENT_BINDING_KINDS).includes(parentBindingKind)) {
    throw new ExpansionPackDraftStoreError(
      'Parent binding kind is invalid.',
      'invalid-expansion-pack-parent-binding-kind',
      { parentBindingKind },
    );
  }
  const parentVersionId = keySegment(identity.parentVersionId, 'Parent Maker version id');
  const published = parentBindingKind === EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE;
  const parentReleaseId = published
    ? keySegment(identity.parentReleaseId, 'Parent Maker release id')
    : '';
  const parentManifestBlobId = published
    ? keySegment(identity.parentManifestBlobId, 'Parent manifest Blob/Quilt id')
    : '';
  const parentManifestHash = String(identity.parentManifestHash ?? '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase();
  if (published && !/^[0-9a-f]{64}$/.test(parentManifestHash)) {
    throw new ExpansionPackDraftStoreError(
      'Published parent manifest SHA-256 is required.',
      'invalid-expansion-pack-parent-manifest-hash',
    );
  }
  const packId = keySegment(identity.packId, 'Expansion Pack id');
  const releaseSegments = [
    parentBindingKind,
    parentVersionId,
    parentReleaseId || '~local',
    parentManifestBlobId || '~local',
    parentManifestHash || '~local-uncommitted',
  ];
  const encoded = [
    walletAddress,
    parentRootId,
    parentVersion,
    ...releaseSegments,
    packId,
  ].map((value) => encodeURIComponent(value));
  const scopeSegments = encoded.slice(0, -1);
  return {
    walletAddress,
    parentRootId,
    parentVersion,
    parentBindingKind,
    parentVersionId,
    parentReleaseId,
    parentManifestBlobId,
    parentManifestHash,
    packId,
    key: encoded.join(':'),
    scopeKey: scopeSegments.join(':'),
    releaseScopeKey: scopeSegments.slice(1).join(':'),
    rootScopeKey: `${walletAddress}:${parentRootId}`,
  };
}

export function expansionPackDraftKey(identity) {
  return normalizeIdentity(identity).key;
}

function expectedRevision(value) {
  if (value === null || value === undefined) return null;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ExpansionPackDraftStoreError(
      'Expected Expansion Pack draft revision must be null or a positive safe integer.',
      'invalid-expansion-pack-draft-revision',
    );
  }
  return revision;
}

function requestedRevision(value, expected) {
  const defaultRevision = expected === null ? 1 : expected + 1;
  const revision = value === undefined ? defaultRevision : Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ExpansionPackDraftStoreError(
      'Expansion Pack draft revision must be a positive safe integer.',
      'invalid-expansion-pack-draft-revision',
    );
  }
  if (revision !== defaultRevision) {
    throw new ExpansionPackDraftStoreError(
      `Expansion Pack draft revision must advance exactly to ${defaultRevision}.`,
      'nonsequential-expansion-pack-draft-revision',
      { expectedRevision: expected, requestedRevision: revision },
    );
  }
  return revision;
}

function verifyProjectIdentity(projectValue, identity) {
  const project = rehydrateExpansionPackProject(projectValue);
  const actual = {
    walletAddress: String(project.ownerWalletAddress ?? '').trim().toLowerCase(),
    parentRootId: String(project.parentBinding?.rootMakerId ?? '').trim(),
    parentVersion: String(project.parentBinding?.versionNumber ?? '').trim(),
    parentBindingKind: String(project.parentBinding?.kind ?? '').trim(),
    parentVersionId: String(project.parentBinding?.versionId ?? '').trim(),
    parentReleaseId: String(project.parentBinding?.releaseId ?? '').trim(),
    parentManifestBlobId: String(project.parentBinding?.manifestBlobId ?? '').trim(),
    parentManifestHash: String(project.parentBinding?.manifestHash ?? '')
      .trim()
      .replace(/^0x/i, '')
      .toLowerCase(),
    packId: String(project.packId ?? '').trim(),
    overlayPackId: String(project.pack?.packId ?? '').trim(),
    overlayParentRootId: String(project.pack?.baseMakerId ?? '').trim(),
    overlayParentVersion: String(project.pack?.baseVersion ?? '').trim(),
  };
  const mismatches = [];
  if (actual.walletAddress !== identity.walletAddress) mismatches.push('walletAddress');
  if (actual.parentRootId !== identity.parentRootId) mismatches.push('parentRootId');
  if (actual.parentVersion !== identity.parentVersion) mismatches.push('parentVersion');
  if (actual.parentBindingKind !== identity.parentBindingKind) mismatches.push('parentBindingKind');
  if (actual.parentVersionId !== identity.parentVersionId) mismatches.push('parentVersionId');
  if (actual.parentReleaseId !== identity.parentReleaseId) mismatches.push('parentReleaseId');
  if (actual.parentManifestBlobId !== identity.parentManifestBlobId) mismatches.push('parentManifestBlobId');
  if (actual.parentManifestHash !== identity.parentManifestHash) mismatches.push('parentManifestHash');
  if (actual.packId !== identity.packId || actual.overlayPackId !== identity.packId) mismatches.push('packId');
  if (actual.overlayParentRootId !== identity.parentRootId) mismatches.push('overlayParentRootId');
  if (actual.overlayParentVersion !== identity.parentVersion) mismatches.push('overlayParentVersion');
  if (mismatches.length) {
    throw new ExpansionPackDraftStoreError(
      'Expansion Pack draft identity does not match its fixed persistence key.',
      'expansion-pack-draft-key-mismatch',
      { key: identity.key, mismatches, actual },
    );
  }
  return project;
}

function requestResult(request, fallbackMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new ExpansionPackDraftStoreError(fallbackMessage));
  });
}

function transactionComplete(transaction, callbackError) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      if (callbackError?.current) reject(callbackError.current);
      else resolve();
    };
    transaction.onabort = () => reject(
      callbackError?.current
      || transaction.error
      || new ExpansionPackDraftStoreError('Expansion Pack draft transaction was aborted.'),
    );
    transaction.onerror = () => {
      // onabort is the final signal for an IndexedDB transaction error.
    };
  });
}

function openDatabase(indexedDb) {
  if (!indexedDb) {
    throw new ExpansionPackDraftStoreError(
      'This browser does not support persistent Expansion Pack drafts.',
      'indexeddb-unavailable',
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(
      EXPANSION_PACK_DRAFT_DATABASE_NAME,
      EXPANSION_PACK_DRAFT_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EXPANSION_PACK_DRAFT_STORE)) {
        const store = database.createObjectStore(EXPANSION_PACK_DRAFT_STORE, { keyPath: 'key' });
        store.createIndex('walletAddress', 'walletAddress', { unique: false });
        store.createIndex('parentRootId', 'parentRootId', { unique: false });
        store.createIndex('parentVersion', 'parentVersion', { unique: false });
        store.createIndex('scopeKey', 'scopeKey', { unique: false });
        store.createIndex('releaseScopeKey', 'releaseScopeKey', { unique: false });
        store.createIndex('rootScopeKey', 'rootScopeKey', { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new ExpansionPackDraftStoreError(
      'Close other Animacraft tabs once so Expansion Pack draft storage can be upgraded.',
      'expansion-pack-draft-upgrade-blocked',
    ));
    request.onerror = () => reject(
      request.error
      || new ExpansionPackDraftStoreError('Could not open Expansion Pack draft storage.'),
    );
  });
}

function publicRecord(record) {
  if (!record) return null;
  return {
    ...clone(record),
    project: rehydrateExpansionPackProject(record.project),
  };
}

/**
 * Create an isolated store. Supplying indexedDB makes the storage boundary
 * deterministic in tests; browsers use globalThis.indexedDB by default.
 */
export function createExpansionPackDraftStore(options = {}) {
  const indexedDb = options.indexedDB ?? globalThis.indexedDB;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;

  return {
    async load(identityValue) {
      const identity = normalizeIdentity(identityValue);
      const database = await openDatabase(indexedDb);
      try {
        const transaction = database.transaction(EXPANSION_PACK_DRAFT_STORE, 'readonly');
        const completion = transactionComplete(transaction);
        const record = await requestResult(
          transaction.objectStore(EXPANSION_PACK_DRAFT_STORE).get(identity.key),
          'Expansion Pack draft could not be loaded.',
        );
        await completion;
        return publicRecord(record);
      } finally {
        database.close();
      }
    },

    async list(filter = {}) {
      const walletAddress = filter.walletAddress
        ? keySegment(filter.walletAddress, 'Wallet address', { lowerCase: true })
        : '';
      const parentRootId = filter.parentRootId || filter.rootMakerId
        ? keySegment(filter.parentRootId ?? filter.rootMakerId, 'Parent Maker root id')
        : '';
      const parentVersion = filter.parentVersion || filter.versionNumber
        ? keySegment(filter.parentVersion ?? filter.versionNumber, 'Parent Maker version')
        : '';
      const parentBindingKind = filter.parentBindingKind
        ? keySegment(filter.parentBindingKind, 'Parent binding kind')
        : '';
      const parentVersionId = filter.parentVersionId
        ? keySegment(filter.parentVersionId, 'Parent Maker version id')
        : '';
      const parentReleaseId = filter.parentReleaseId
        ? keySegment(filter.parentReleaseId, 'Parent Maker release id')
        : '';
      const parentManifestBlobId = filter.parentManifestBlobId
        ? keySegment(filter.parentManifestBlobId, 'Parent manifest Blob/Quilt id')
        : '';
      const parentManifestHash = String(filter.parentManifestHash ?? '')
        .trim()
        .replace(/^0x/i, '')
        .toLowerCase();
      const database = await openDatabase(indexedDb);
      try {
        const transaction = database.transaction(EXPANSION_PACK_DRAFT_STORE, 'readonly');
        const completion = transactionComplete(transaction);
        const records = await requestResult(
          transaction.objectStore(EXPANSION_PACK_DRAFT_STORE).getAll(),
          'Expansion Pack drafts could not be listed.',
        );
        await completion;
        return (records || [])
          .filter((record) => !walletAddress || record.walletAddress === walletAddress)
          .filter((record) => !parentRootId || record.parentRootId === parentRootId)
          .filter((record) => !parentVersion || record.parentVersion === parentVersion)
          .filter((record) => !parentBindingKind || record.parentBindingKind === parentBindingKind)
          .filter((record) => !parentVersionId || record.parentVersionId === parentVersionId)
          .filter((record) => !parentReleaseId || record.parentReleaseId === parentReleaseId)
          .filter((record) => !parentManifestBlobId || record.parentManifestBlobId === parentManifestBlobId)
          .filter((record) => !parentManifestHash || record.parentManifestHash === parentManifestHash)
          .sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0))
          .map(publicRecord);
      } finally {
        database.close();
      }
    },

    async save(identityValue, projectValue, saveOptions = {}) {
      const identity = normalizeIdentity(identityValue);
      const project = verifyProjectIdentity(projectValue, identity);
      const expected = expectedRevision(saveOptions.expectedRevision);
      const revision = requestedRevision(saveOptions.revision, expected);
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      try {
        const transaction = database.transaction(EXPANSION_PACK_DRAFT_STORE, 'readwrite');
        const completion = transactionComplete(transaction, callbackError);
        const store = transaction.objectStore(EXPANSION_PACK_DRAFT_STORE);
        let outcome = null;
        const getRequest = store.get(identity.key);
        getRequest.onsuccess = () => {
          try {
            const existing = getRequest.result || null;
            const persistedRevision = existing?.revision ?? null;
            const baseMatches = expected === null
              ? !existing
              : Boolean(existing) && persistedRevision === expected;
            if (!baseMatches) {
              outcome = {
                saved: false,
                conflict: true,
                key: identity.key,
                requestedRevision: revision,
                persistedRevision,
                savedAt: existing?.savedAt ?? null,
              };
              return;
            }
            const savedAtValue = Number(clock());
            const record = {
              ...identity,
              project: clone(project),
              revision,
              savedAt: Number.isFinite(savedAtValue) ? savedAtValue : Date.now(),
            };
            store.put(record);
            outcome = {
              saved: true,
              conflict: false,
              key: identity.key,
              requestedRevision: revision,
              persistedRevision: revision,
              savedAt: record.savedAt,
            };
          } catch (error) {
            callbackError.current = error;
            transaction.abort();
          }
        };
        getRequest.onerror = () => {
          callbackError.current = getRequest.error
            || new ExpansionPackDraftStoreError('Expansion Pack draft revision could not be read.');
        };
        await completion;
        return outcome;
      } finally {
        database.close();
      }
    },

    async delete(identityValue, deleteOptions = {}) {
      const identity = normalizeIdentity(identityValue);
      const expected = expectedRevision(deleteOptions.expectedRevision);
      if (expected === null) {
        throw new ExpansionPackDraftStoreError(
          'Deleting an Expansion Pack draft requires its current revision.',
          'missing-expansion-pack-draft-revision',
        );
      }
      const database = await openDatabase(indexedDb);
      const callbackError = { current: null };
      try {
        const transaction = database.transaction(EXPANSION_PACK_DRAFT_STORE, 'readwrite');
        const completion = transactionComplete(transaction, callbackError);
        const store = transaction.objectStore(EXPANSION_PACK_DRAFT_STORE);
        let outcome = null;
        const getRequest = store.get(identity.key);
        getRequest.onsuccess = () => {
          try {
            const existing = getRequest.result || null;
            if (!existing || existing.revision !== expected) {
              outcome = {
                deleted: false,
                conflict: true,
                key: identity.key,
                persistedRevision: existing?.revision ?? null,
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
        getRequest.onerror = () => {
          callbackError.current = getRequest.error
            || new ExpansionPackDraftStoreError('Expansion Pack draft revision could not be read.');
        };
        await completion;
        return outcome;
      } finally {
        database.close();
      }
    },
  };
}

export async function loadExpansionPackDraft(identity) {
  return createExpansionPackDraftStore().load(identity);
}

export async function listExpansionPackDrafts(filter) {
  return createExpansionPackDraftStore().list(filter);
}

export async function saveExpansionPackDraft(identity, project, options) {
  return createExpansionPackDraftStore().save(identity, project, options);
}

export async function deleteExpansionPackDraft(identity, options) {
  return createExpansionPackDraftStore().delete(identity, options);
}
