import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addExpansionPackItem,
  createExpansionPackProject,
} from '../expansion-pack-project.js';
import {
  buildExpansionPackPublicationCandidate,
  hashExpansionPackContent,
  protectExpansionPackPublicationCandidate,
} from '../expansion-pack-publication.js';
import {
  beginExpansionPackPublicationAction,
  buildExpansionPackPublicationPlan,
  confirmExpansionPackPublicationAction,
  createExpansionPackPublicationRecovery,
  markExpansionPackPublicationSubmitted,
  materializeExpansionPackPublicationCandidate,
  nextExpansionPackPublicationAction,
} from '../expansion-pack-publication-recovery.js';
import { createExpansionPackPublicationController } from '../expansion-pack-publication-controller.js';
import {
  EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE,
  EXPANSION_PACK_PUBLICATION_DATABASE_NAME,
  EXPANSION_PACK_PUBLICATION_DATABASE_VERSION,
  EXPANSION_PACK_PUBLICATION_RECEIPT_STORE,
  createExpansionPackPublicationStore,
  expansionPackPublicationIdentity,
} from '../expansion-pack-publication-store.js';

const OWNER = '0x111';
const ROOT = '0x222';
const LEGACY = '0x333';
const CONTROL = '0x444';
const CALLABLE_PACKAGE = '0x555';
const TYPE_ORIGIN_PACKAGE = '0x556';
const PARENT_HASH = '11'.repeat(32);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class MemoryRequest {
  constructor(run) {
    queueMicrotask(() => {
      try {
        this.result = run();
        this.onsuccess?.();
      } catch (error) {
        this.error = error;
        this.onerror?.();
      }
    });
  }
}

class MemoryStore {
  constructor(transaction, records, definition) {
    this.transaction = transaction;
    this.records = records;
    this.definition = definition;
    this.indexNames = {
      contains: (name) => this.definition.indexes.has(name),
    };
  }

  createIndex(name, keyPath) {
    this.definition.indexes.set(name, keyPath);
  }

  get(key) {
    const request = new MemoryRequest(() => clone(this.records.get(key)));
    this.transaction.scheduleComplete();
    return request;
  }

  put(value) {
    const record = clone(value);
    this.records.set(record[this.definition.keyPath], record);
    this.transaction.scheduleComplete();
  }

  delete(key) {
    this.records.delete(key);
    this.transaction.scheduleComplete();
  }
}

class MemoryTransaction {
  constructor(database) {
    this.database = database;
    this.completionScheduled = false;
    this.aborted = false;
    this.error = null;
  }

  objectStore(name) {
    return new MemoryStore(this, this.database.records.get(name), this.database.definitions.get(name));
  }

  scheduleComplete() {
    if (this.completionScheduled) return;
    this.completionScheduled = true;
    setTimeout(() => {
      if (!this.aborted) this.oncomplete?.();
    }, 0);
  }

  abort() {
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }
}

class MemoryDatabase {
  constructor() {
    this.records = new Map();
    this.definitions = new Map();
    this.objectStoreNames = { contains: (name) => this.records.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    this.records.set(name, new Map());
    this.definitions.set(name, { keyPath, indexes: new Map() });
    return new MemoryStore({ scheduleComplete() {} }, this.records.get(name), this.definitions.get(name));
  }

  transaction() {
    return new MemoryTransaction(this);
  }

  close() {}
}

function memoryIndexedDb() {
  const database = new MemoryDatabase();
  let initialized = false;
  const openCalls = [];
  return {
    database,
    openCalls,
    factory: {
      open(name, version) {
        openCalls.push({ name, version });
        const request = {};
        queueMicrotask(() => {
          try {
            request.result = database;
            request.transaction = database.transaction();
            if (!initialized) {
              initialized = true;
              request.onupgradeneeded?.();
            }
            queueMicrotask(() => request.onsuccess?.());
          } catch (error) {
            request.error = error;
            queueMicrotask(() => request.onerror?.());
          }
        });
        return request;
      },
    },
  };
}

function parentMaker() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: 'parent-maker', versionId: 'parent-v7', number: 7 },
    metadata: { id: 'parent-maker', name: 'Parent', license: { kind: 'personal-use' } },
    canvas: { width: 1024, height: 1024, pixelMode: 'smooth' },
    layerTracks: [{ id: 'body-track', name: 'Body', order: 0 }],
    colorChannels: [],
    assets: [],
    parts: [{
      id: 'body',
      name: 'Body',
      required: true,
      allowRemove: false,
      defaultItemId: 'base',
      items: [{
        id: 'base',
        name: 'Base',
        defaultStyleId: 'default',
        styles: [{
          id: 'default',
          layerTrackId: 'body-track',
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
        }],
      }],
    }],
    defaultRecipe: { selections: [], colors: [] },
    rules: [],
  };
}

function runtime() {
  return {
    network: 'mainnet',
    callablePackageId: CALLABLE_PACKAGE,
    expansionPackV8ReleaseEnabled: true,
    expansionPackV8CallablePackageId: CALLABLE_PACKAGE,
    expansionPackV8TypeOriginPackageId: TYPE_ORIGIN_PACKAGE,
    commerceProtocolConfigV5Id: '0x666',
    paymentCoinType: '0x2::sui::SUI',
  };
}

function publicationContext() {
  return {
    owner: OWNER,
    baseMakerRootId: ROOT,
    parentLegacyMakerId: LEGACY,
    makerControlCapId: CONTROL,
  };
}

async function confirmAction(recovery, plan, actionId, confirmation) {
  let next = recovery;
  if (next.actions[next.currentActionIndex]?.id === 'chain.parent.evidence.bind'
    && actionId !== 'chain.parent.evidence.bind') {
    next = await confirmAction(next, plan, 'chain.parent.evidence.bind', {
      transactionDigest: 'parent-evidence',
      parentReleaseEvidenceBound: true,
      parentEvidenceReadbackVerified: true,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      parentVersion: '7',
      parentManifestBlobId: 'parent-quilt',
      parentManifestSha256: PARENT_HASH,
    });
  }
  const exactConfirmation = actionId === 'parent.release.verify'
    && typeof confirmation?.parentReleaseEvidenceBound !== 'boolean'
    ? { ...confirmation, parentReleaseEvidenceBound: false }
    : confirmation;
  next = await beginExpansionPackPublicationAction({ recovery: next, plan, runtime: runtime() });
  const transactionDigest = exactConfirmation?.transactionDigest;
  next = await markExpansionPackPublicationSubmitted({
    recovery: next,
    plan,
    actionId,
    submission: transactionDigest
      ? { actionId, transactionDigest }
      : { actionId },
  });
  return confirmExpansionPackPublicationAction({
    recovery: next,
    plan,
    actionId,
    confirmation: exactConfirmation,
  });
}

async function fixture({ paid = false } = {}) {
  const bytes = new TextEncoder().encode('immutable Pack PNG bytes');
  const assetHash = await hashExpansionPackContent(bytes);
  const assetBlob = new Blob([bytes], { type: 'image/png' });
  let project = createExpansionPackProject(parentMaker(), {
    packId: 'moon-pack',
    namespace: 'moon-pack',
    name: 'Moon Pack',
    version: '1.0.0',
    walletAddress: OWNER,
    parentRelease: {
      identityVerified: true,
      releaseId: LEGACY,
      versionId: 'parent-v7',
      versionNumber: '7',
      manifestBlobId: 'parent-quilt',
      manifestHash: PARENT_HASH,
    },
  });
  project = addExpansionPackItem(project, {
    partId: 'body',
    item: {
      id: 'moon-shirt',
      name: 'Moon Shirt',
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default',
        assetId: 'shirt-png',
        layerTrackId: 'body-track',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'normal',
      }],
    },
    assets: [{
      id: 'shirt-png',
      identifier: 'assets/shirt.png',
      mediaType: 'image/png',
      kind: 'layer',
      sha256: assetHash,
      byteLength: bytes.byteLength,
      width: 1024,
      height: 1024,
      blob: assetBlob,
    }],
  });
  const candidate = await buildExpansionPackPublicationCandidate(project, paid ? {
    commerce: { accessMode: 'PAID_ONCE', price: '100' },
  } : {});
  if (paid) return { project, candidate, assetBlob };
  const plan = await buildExpansionPackPublicationPlan({
    candidate,
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      makerControlCapId: CONTROL,
    },
    runtime: runtime(),
  });
  const recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-publication-session-0001',
    createdAt: 100,
  });
  const entries = candidate.files.map((file) => ({
    identifier: file.identifier,
    kind: file.kind,
    blob: file.identifier === candidate.manifestIdentifier
      ? new Blob([candidate.manifestJson], { type: 'application/json' })
      : assetBlob,
  }));
  return { project, candidate, plan, recovery, entries };
}

function identityOf(source) {
  return expansionPackPublicationIdentity({ plan: source.plan });
}

test('uses the exact immutable publication identity and reads every Blob back after CAS save', async () => {
  const memory = memoryIndexedDb();
  const source = await fixture();
  const identity = identityOf(source);
  const store = createExpansionPackPublicationStore({ indexedDB: memory.factory, clock: () => 123 });
  const snapshot = { ...source, walrusRecovery: null, receipt: null };
  assert.equal(EXPANSION_PACK_PUBLICATION_DATABASE_VERSION, 3);

  const saved = await store.save(identity, snapshot, { expectedRevision: null });
  assert.deepEqual(
    { saved: saved.saved, verified: saved.verified, revision: saved.persistedRevision },
    { saved: true, verified: true, revision: 1 },
  );
  assert.ok(memory.openCalls.every(({ name, version }) => (
    name === EXPANSION_PACK_PUBLICATION_DATABASE_NAME
    && version === EXPANSION_PACK_PUBLICATION_DATABASE_VERSION
  )));
  assert.ok(memory.database.records.has(EXPANSION_PACK_PUBLICATION_CHECKPOINT_STORE));
  assert.ok(memory.database.records.has(EXPANSION_PACK_PUBLICATION_RECEIPT_STORE));

  const loaded = await store.load(identity);
  assert.equal(loaded.persistenceRevision, 1);
  assert.equal(loaded.snapshot.recovery.nonce, source.recovery.nonce);
  assert.equal(await loaded.snapshot.entries[1].blob.text(), 'immutable Pack PNG bytes');

  const next = await store.save(identity, snapshot, { expectedRevision: 1 });
  assert.equal(next.persistedRevision, 2);
  const stale = await store.save(identity, snapshot, { expectedRevision: 1 });
  assert.equal(stale.saved, false);
  assert.equal(stale.reason, 'revision');
  assert.equal(stale.persistedRevision, 2);
});

test('rejects disposable v2 plans and recovery snapshots before persistence', async () => {
  const memory = memoryIndexedDb();
  const source = await fixture();
  const identity = identityOf(source);
  const snapshot = clone({ ...source, walrusRecovery: null, receipt: null });
  snapshot.plan.schema = 'animacraft.expansion-pack-publication-plan.v2';
  snapshot.plan.version = 2;
  snapshot.recovery.schema = 'animacraft.expansion-pack-publication-recovery.v2';
  snapshot.recovery.version = 2;
  const store = createExpansionPackPublicationStore({ indexedDB: memory.factory });
  await assert.rejects(
    store.save(identity, snapshot, { expectedRevision: null }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_PLAN_INVALID',
  );
});

test('keeps a paid ciphertext snapshot in its exact pre-encryption persistence lane', async () => {
  const memory = memoryIndexedDb();
  const source = await fixture({ paid: true });
  const plan = await buildExpansionPackPublicationPlan({
    candidate: source.candidate,
    context: publicationContext(),
    runtime: runtime(),
  });
  let recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-paid-publication-session-0001',
    createdAt: 100,
  });
  recovery = await confirmAction(recovery, plan, 'parent.release.verify', {
    parentVerified: true,
    makerControlCapVerified: true,
    parentLifecycleState: 'ACTIVE',
    baseMakerRootId: ROOT,
    parentLegacyMakerId: LEGACY,
    parentVersion: '7',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: PARENT_HASH,
  });
  let createAction = await nextExpansionPackPublicationAction({
    recovery,
    plan,
    runtime: runtime(),
  });
  if (createAction.id === 'chain.parent.evidence.bind') {
    recovery = await confirmAction(recovery, plan, createAction.id, {
      transactionDigest: 'parent-evidence-paid',
      parentReleaseEvidenceBound: true,
      parentEvidenceReadbackVerified: true,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      parentVersion: '7',
      parentManifestBlobId: 'parent-quilt',
      parentManifestSha256: PARENT_HASH,
    });
    createAction = await nextExpansionPackPublicationAction({
      recovery,
      plan,
      runtime: runtime(),
    });
  }
  recovery = await confirmAction(recovery, plan, 'chain.pack.create', {
    packReleaseId: '0x901',
    packAdminCapId: '0x902',
    packTreasuryId: '0x903',
    transactionDigest: 'create-paid',
    readbackVerified: true,
    manifestBound: false,
    lifecycleState: 'DRAFT',
    creator: OWNER,
    baseMakerRootId: createAction.inputs.baseMakerRootId,
    parentLegacyMakerId: createAction.inputs.parentLegacyMakerId,
    parentVersion: createAction.inputs.parentVersion,
    parentManifestBlobId: createAction.inputs.parentManifestBlobId,
    parentManifestSha256: createAction.inputs.parentManifestSha256,
    packId: createAction.inputs.packId,
    packVersion: createAction.inputs.packVersion,
    contentCommitment: createAction.inputs.contentCommitment,
    accessKind: createAction.inputs.accessKind,
    purchasePriceAtomic: createAction.inputs.purchasePriceAtomic,
  });
  const protectedTransport = await protectExpansionPackPublicationCandidate(
    source.candidate,
    source.project,
    {
      sealClient: {
        async encrypt({ data }) {
          return { encryptedObject: new Uint8Array([83, 69, 65, 76, ...data]) };
        },
      },
      sealPackageId: TYPE_ORIGIN_PACKAGE,
      releaseId: '0x901',
      threshold: 1,
      serverConfigs: [{
        objectId: '0x888',
        weight: 1,
        aggregatorUrl: 'https://seal.example',
      }],
    },
  );
  const candidate = protectedTransport.candidate;
  const materialized = await materializeExpansionPackPublicationCandidate({
    candidate,
    context: publicationContext(),
    runtime: runtime(),
    releaseId: '0x901',
  });
  recovery = await confirmAction(
    recovery,
    plan,
    'local.pack.materialize',
    materialized,
  );
  const ciphertext = protectedTransport.encryptedAssets[0];
  const entries = candidate.files.map((file) => ({
    identifier: file.identifier,
    kind: file.kind,
    blob: file.identifier === candidate.manifestIdentifier
      ? new Blob([candidate.manifestJson], { type: 'application/json' })
      : ciphertext.blob,
  }));
  const persistenceIdentity = expansionPackPublicationIdentity({
    walletAddress: OWNER,
    baseMakerRootId: ROOT,
    parentVersionNumber: '7',
    parentVersionId: 'parent-v7',
    parentReleaseId: LEGACY,
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: PARENT_HASH,
    packId: 'moon-pack',
    packVersion: '1.0.0',
    candidateCommitment: source.candidate.candidateCommitment,
    manifestSha256: source.candidate.manifestSha256,
  });
  const store = createExpansionPackPublicationStore({ indexedDB: memory.factory });
  const saved = await store.save(persistenceIdentity, {
    project: source.project,
    candidate,
    plan,
    recovery,
    entries,
    walrusRecovery: null,
    receipt: null,
  }, { expectedRevision: null });
  assert.equal(saved.verified, true);
  const loaded = await store.load(persistenceIdentity);
  assert.equal(loaded.snapshot.candidate.transportProtected, true);
  assert.equal(
    loaded.snapshot.candidate.transportSource.candidateCommitment,
    source.candidate.candidateCommitment,
  );
  assert.equal(loaded.snapshot.entries[1].blob.type, 'application/vnd.animacraft.seal-v5');
});

test('never lets another Walrus session or immutable candidate reuse a recovery lane', async () => {
  const memory = memoryIndexedDb();
  const source = await fixture();
  const identity = identityOf(source);
  const store = createExpansionPackPublicationStore({ indexedDB: memory.factory });
  const first = {
    ...source,
    walrusRecovery: { uploadSessionId: 'upload-a', checkpoint: { step: 'encoded' } },
    receipt: null,
  };
  await store.save(identity, first, { expectedRevision: null });
  const wrongSession = await store.save(
    identity,
    {
      ...first,
      walrusRecovery: { uploadSessionId: 'upload-b', checkpoint: { step: 'encoded' } },
    },
    { expectedRevision: 1 },
  );
  assert.equal(wrongSession.saved, false);
  assert.equal(wrongSession.reason, 'upload-session');

  await assert.rejects(
    store.save(
      { ...identity, packVersion: '2.0.0' },
      first,
      { expectedRevision: null },
    ),
    { code: 'EXPANSION_PACK_PUBLICATION_SNAPSHOT_IDENTITY_MISMATCH' },
  );
});

function chainConfirmation(action, digest) {
  if (action.id === 'chain.parent.evidence.bind') return {
    transactionDigest: digest,
    parentReleaseEvidenceBound: true,
    parentEvidenceReadbackVerified: true,
    baseMakerRootId: action.inputs.baseMakerRootId,
    parentLegacyMakerId: action.inputs.parentLegacyMakerId,
    parentVersion: action.inputs.parentVersion,
    parentManifestBlobId: action.inputs.parentManifestBlobId,
    parentManifestSha256: action.inputs.parentManifestSha256,
  };
  if (action.id === 'chain.pack.create') return {
    packReleaseId: '0x901',
    packAdminCapId: '0x902',
    packTreasuryId: '0x903',
    transactionDigest: digest,
    readbackVerified: true,
    manifestBound: false,
    lifecycleState: 'DRAFT',
    creator: OWNER,
    baseMakerRootId: action.inputs.baseMakerRootId,
    parentLegacyMakerId: action.inputs.parentLegacyMakerId,
    parentVersion: action.inputs.parentVersion,
    parentManifestBlobId: action.inputs.parentManifestBlobId,
    parentManifestSha256: action.inputs.parentManifestSha256,
    packId: action.inputs.packId,
    packVersion: action.inputs.packVersion,
    contentCommitment: action.inputs.contentCommitment,
    accessKind: action.inputs.accessKind,
    purchasePriceAtomic: action.inputs.purchasePriceAtomic,
  };
  if (action.id === 'chain.pack.manifest.bind') return {
    transactionDigest: digest,
    manifestBound: true,
    readbackVerified: true,
    manifestBlobId: action.inputs.manifestBlobId,
    manifestSha256: action.inputs.manifestSha256,
  };
  if (action.id.startsWith('chain.pack.style.register.')) return {
    transactionDigest: digest,
    styleRegistered: true,
    readbackVerified: true,
    partKey: action.inputs.partKey,
    itemKey: action.inputs.itemKey,
    styleKey: action.inputs.styleKey,
    assetBlobId: action.inputs.assetBlobId,
    assetSha256: action.inputs.assetSha256,
    assetSealId: action.inputs.assetSealId,
  };
  if (action.id === 'chain.pack.seal') return {
    transactionDigest: digest,
    sealed: true,
    readbackVerified: true,
    styleRegistryCommitment: action.inputs.styleRegistryCommitment,
  };
  if (action.id === 'chain.pack.admit') return {
    transactionDigest: digest,
    admitted: true,
    parentBindingVerified: true,
    readbackVerified: true,
    baseMakerRootId: action.inputs.baseMakerRootId,
    parentLegacyMakerId: action.inputs.parentLegacyMakerId,
    parentVersion: action.inputs.parentVersion,
    parentManifestBlobId: action.inputs.parentManifestBlobId,
    parentManifestSha256: action.inputs.parentManifestSha256,
  };
  if (action.id === 'chain.pack.activate') return {
    transactionDigest: digest,
    readbackVerified: true,
    lifecycleState: 'ACTIVE',
  };
  throw new Error(`Unexpected action ${action.id}`);
}

async function completedSnapshot(source) {
  let latest = null;
  let digest = 0;
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      makerControlCapId: CONTROL,
    },
    project: source.project,
    candidate: source.candidate,
    dependencies: {
      async persist(snapshot) {
        latest = clone(snapshot);
        return { saved: true, verified: true };
      },
      async verifyParent() {
        return {
          parentVerified: true,
          makerControlCapVerified: true,
          parentReleaseEvidenceBound: false,
          parentLifecycleState: 'ACTIVE',
          baseMakerRootId: ROOT,
          parentLegacyMakerId: LEGACY,
          parentVersion: '7',
          parentManifestBlobId: 'parent-quilt',
          parentManifestSha256: PARENT_HASH,
        };
      },
      async prepareWalrusUpload(entries) {
        return {
          owner: OWNER,
          uploadSessionId: 'upload-complete',
          recoveryRevision: 0,
          stage: 'encoded',
          checkpoint: { step: 'encoded', blobId: 'pack-quilt' },
          quiltBlobId: 'pack-quilt',
          files: [],
          entries,
        };
      },
      async resumeWalrusUpload(_entries, recovery) {
        return { ...clone(recovery), files: recovery.files || [] };
      },
      async registerAndUploadWalrus(session, { onCheckpoint }) {
        session.stage = 'uploaded';
        session.registerDigest = 'register';
        session.checkpoint = { step: 'uploaded', blobObjectId: '0x888' };
        await onCheckpoint(session);
      },
      async certifyWalrusUpload(session, { onCheckpoint }) {
        session.stage = 'certified';
        session.certifyDigest = 'certify';
        session.checkpoint = { step: 'certified', blobObjectId: '0x888' };
        session.files = [
          { id: 'manifest-patch', blobId: 'pack-quilt' },
          { id: 'asset-patch', blobId: 'pack-quilt' },
        ];
        await onCheckpoint(session);
      },
      transactionFromAction(action) { return { action }; },
      async signTransactionForRecovery() {
        digest += 1;
        return {
          digest: `digest-${digest}`,
          bytes: `bytes-${digest}`,
          signature: `signature-${digest}`,
        };
      },
      async executeSignedTransactionAndWait(signed) {
        return { digest: signed.digest, transactionDigest: signed.digest };
      },
      async readSuiSubmission(action, submission) {
        return chainConfirmation(action, submission.transactionDigest);
      },
    },
  });
  await controller.prepare();
  await controller.register();
  await controller.certify();
  await controller.publish();
  return latest;
}

test('persists a verified receipt before allowing guarded checkpoint cleanup', async () => {
  const memory = memoryIndexedDb();
  const source = await fixture();
  const snapshot = await completedSnapshot(source);
  const identity = expansionPackPublicationIdentity({ plan: snapshot.plan });
  const store = createExpansionPackPublicationStore({ indexedDB: memory.factory });
  const saved = await store.save(identity, snapshot, { expectedRevision: null });
  assert.equal(saved.verified, true);
  const receipt = await store.loadReceipt(identity);
  assert.equal(receipt.receipt.packReleaseId, '0x901');

  const refused = await store.delete(identity, {
    expectedRevision: saved.persistedRevision,
    recoveryNonce: 'another-recovery',
    uploadSessionId: 'upload-complete',
  });
  assert.equal(refused.deleted, false);
  const deleted = await store.delete(identity, {
    expectedRevision: saved.persistedRevision,
    recoveryNonce: snapshot.recovery.nonce,
    uploadSessionId: 'upload-complete',
  });
  assert.equal(deleted.deleted, true);
  assert.equal(await store.load(identity), null);
  assert.equal((await store.loadReceipt(identity)).receipt.packReleaseId, '0x901');
});
