import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addExpansionPackItem,
  createExpansionPackProject,
} from '../expansion-pack-project.js';
import { buildExpansionPackPublicationCandidate, hashExpansionPackContent } from '../expansion-pack-publication.js';
import { createExpansionPackPublicationController } from '../expansion-pack-publication-controller.js';
import { deriveExpansionPackSealReleaseCommitmentV8 } from '../maker-seal-v5.js';

const OWNER = '0x111';
const ROOT = '0x222';
const LEGACY = '0x333';
const INDEPENDENT_EXTENSION_AUTHORITY = '0x444';
const CALLABLE_PACKAGE = '0x555';
const TYPE_ORIGIN_PACKAGE = '0x556';
const INDEPENDENT_EXTENSION_TYPE_ORIGIN_PACKAGE = '0x557';
const PARENT_HASH = '11'.repeat(32);

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

async function fixture({ corruptBlob = false, paid = false } = {}) {
  const bytes = new TextEncoder().encode('exact pack png bytes');
  const hash = await hashExpansionPackContent(bytes);
  const blob = new Blob([corruptBlob ? 'changed bytes' : bytes], { type: 'image/png' });
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
      sha256: hash,
      byteLength: bytes.byteLength,
      width: 1024,
      height: 1024,
      blob,
    }],
  });
  return {
    project,
    candidate: await buildExpansionPackPublicationCandidate(project, paid ? {
      commerce: { accessMode: 'PAID_ONCE', price: '100' },
    } : {}),
  };
}

function runtime() {
  return {
    network: 'mainnet',
    callablePackageId: CALLABLE_PACKAGE,
    expansionPackV8ReleaseEnabled: true,
    expansionPackV8CallablePackageId: CALLABLE_PACKAGE,
    expansionPackV8TypeOriginPackageId: TYPE_ORIGIN_PACKAGE,
    independentExtensionV5TypeOriginPackageId: INDEPENDENT_EXTENSION_TYPE_ORIGIN_PACKAGE,
    commerceProtocolConfigV5Id: '0x666',
    paymentCoinType: '0x2::sui::SUI',
  };
}

async function chainConfirmation(action, digest) {
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
  if (action.id === 'chain.pack.seal-policy.bind') {
    const scoped = (
      await deriveExpansionPackSealReleaseCommitmentV8({
        releaseId: action.inputs.packReleaseId,
        contentCommitment: action.inputs.contentCommitment,
      })
    ).id.replace(/^0x/i, '').toLowerCase();
    return {
      transactionDigest: digest,
      sealPolicyBound: true,
      readbackVerified: true,
      sealPolicyId: action.inputs.packReleaseId,
      sealReleaseCommitment: scoped,
      sealPackageId: action.inputs.sealPackageId,
    };
  }
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
    parentOwnershipEpoch: action.inputs.parentOwnershipEpoch,
    admittedParentOwnershipEpoch: action.inputs.parentOwnershipEpoch,
  };
  if (action.id === 'chain.pack.activate') return {
    transactionDigest: digest,
    readbackVerified: true,
    lifecycleState: 'ACTIVE',
  };
  throw new Error(`Unexpected ${action.id}`);
}

function dependencies(log) {
  let digestNumber = 0;
  return {
    async persist(snapshot) {
      const current = snapshot.recovery.actions[snapshot.recovery.currentActionIndex];
      log.push({
        kind: 'persist',
        cursor: snapshot.recovery.currentActionIndex,
        receipt: snapshot.receipt,
        actionId: current?.id || '',
        status: current?.status || '',
        submission: structuredClone(current?.submission || null),
        finalizedFailures: structuredClone(snapshot.recovery.finalizedFailures || []),
      });
      return { saved: true, verified: true };
    },
    async verifyParent(action) {
      log.push({ kind: 'parent', id: action.id });
      return {
        parentVerified: true,
        independentExtensionAuthorityVerified: true,
        parentReleaseEvidenceBound: true,
        parentLifecycleState: 'PAUSED',
        parentOwnershipEpoch: '7',
        baseMakerRootId: ROOT,
        parentLegacyMakerId: LEGACY,
        parentVersion: '7',
        parentManifestBlobId: 'parent-quilt',
        parentManifestSha256: PARENT_HASH,
      };
    },
    async prepareWalrusUpload(entries) {
      log.push({ kind: 'prepare', identifiers: entries.map((entry) => entry.identifier) });
      return {
        owner: OWNER,
        uploadSessionId: 'session-1',
        recoveryRevision: 0,
        stage: 'encoded',
        checkpoint: { step: 'encoded', blobId: 'pack-quilt' },
        quiltBlobId: 'pack-quilt',
        files: [],
      };
    },
    async resumeWalrusUpload(_entries, recovery) {
      return { ...structuredClone(recovery), files: recovery.files || [] };
    },
    async registerAndUploadWalrus(session, { onCheckpoint }) {
      session.stage = 'uploaded';
      session.registerDigest = 'register-digest';
      session.checkpoint = {
        step: 'uploaded',
        blobId: session.quiltBlobId,
        blobObjectId: '0x888',
        certificate: 'certificate',
      };
      await onCheckpoint(session);
    },
    async certifyWalrusUpload(session, { onCheckpoint }) {
      session.stage = 'certified';
      session.certifyDigest = 'certify-digest';
      session.checkpoint = {
        step: 'certified',
        blobId: session.quiltBlobId,
        blobObjectId: '0x888',
      };
      session.files = [
        { id: 'manifest-patch', blobId: session.quiltBlobId },
        { id: 'shirt-patch', blobId: session.quiltBlobId },
      ];
      await onCheckpoint(session);
    },
    transactionFromAction(action) {
      log.push({ kind: 'transaction', id: action.id });
      return { action };
    },
    async signTransactionForRecovery(transaction) {
      digestNumber += 1;
      const signed = {
        digest: `digest-${digestNumber}`,
        bytes: `bytes-${digestNumber}`,
        signature: `signature-${digestNumber}`,
        transaction,
      };
      log.push({ kind: 'sign', actionId: transaction.action.id, signed });
      return signed;
    },
    async executeSignedTransactionAndWait(signed, { assertBeforeExecute } = {}) {
      await assertBeforeExecute?.();
      log.push({ kind: 'execute', digest: signed.digest, bytes: signed.bytes });
      return { digest: signed.digest, transactionDigest: signed.digest };
    },
    async readSuiSubmission(action, submission) {
      return chainConfirmation(action, submission.transactionDigest);
    },
    async onCompleted(receipt) {
      log.push({ kind: 'completed', receipt });
    },
  };
}

function sealDependencies(encryptionPackages = []) {
  return {
    sealClient: {
      async encrypt({ data, packageId }) {
        encryptionPackages.push(packageId);
        return { encryptedObject: new Uint8Array([83, 69, 65, 76, ...data]) };
      },
    },
    sealThreshold: 1,
    sealKeyServers: [{
      objectId: '0x888',
      weight: 1,
      aggregatorUrl: 'https://seal.example',
    }],
  };
}

async function certifiedController({ log, deps, isActive = () => true }) {
  const { project, candidate } = await fixture();
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: deps,
    isActive,
  });
  await controller.prepare();
  await controller.register();
  await controller.certify();
  assert.equal(controller.currentEntry().id, 'chain.pack.manifest.bind');
  return controller;
}

test('executes all four visible steps and persists a verified receipt before success', async () => {
  const { project, candidate } = await fixture();
  const log = [];
  const states = [];
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: dependencies(log),
    onState: (state) => states.push(state),
  });

  await controller.prepare();
  assert.equal(controller.uiState().step, 2);
  await controller.register();
  assert.equal(controller.uiState().step, 3);
  await controller.certify();
  assert.equal(controller.uiState().step, 4);
  await controller.publish();

  const state = controller.uiState();
  assert.equal(state.receipt.packObjectId, '0x901');
  assert.equal(state.receipt.digest, 'digest-6');
  assert.deepEqual(state.completedSteps, [1, 2, 3, 4]);
  assert.deepEqual(log.find((entry) => entry.kind === 'prepare').identifiers, [
    'animacraft-expansion-pack-manifest.json',
    'assets/shirt.png',
  ]);
  const finalPersist = log.findLast((entry) => entry.kind === 'persist' && entry.receipt);
  const completed = log.find((entry) => entry.kind === 'completed');
  assert.ok(finalPersist);
  assert.equal(finalPersist.receipt.packReleaseId, '0x901');
  assert.equal(completed.receipt.packReleaseId, '0x901');
  assert.ok(states.some((entry) => entry.busy));
});

test('keeps the exact Draft shell recoverable but fails before Walrus when a frozen asset Blob changed', async () => {
  const { project, candidate } = await fixture({ corruptBlob: true });
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: dependencies([]),
  });
  await assert.rejects(
    controller.prepare(),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_ASSET_BLOB_CHANGED',
  );
  assert.ok(controller.plan);
  assert.equal(
    controller.recovery.actions.find((entry) => entry.id === 'chain.pack.create').status,
    'CONFIRMED',
  );
  assert.equal(controller.currentEntry().id, 'local.pack.materialize');
  assert.equal(controller.entries, null);
});

test('encrypts every paid Pack PNG before Walrus preparation and freezes exact transport proof', async () => {
  const { project, candidate } = await fixture({ paid: true });
  const log = [];
  const encryptionPackages = [];
  const deps = Object.assign(dependencies(log), sealDependencies(encryptionPackages));
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: deps,
  });
  await controller.prepare();
  assert.equal(controller.candidate.transportProtected, true);
  assert.equal(controller.candidate.contentCommitment, candidate.contentCommitment);
  assert.notEqual(controller.candidate.manifestSha256, candidate.manifestSha256);
  assert.equal(controller.candidate.manifest.transportProtection.mode, 'SEAL_PAID_PACK');
  assert.deepEqual(encryptionPackages.map(BigInt), [BigInt(TYPE_ORIGIN_PACKAGE)]);
  assert.equal(
    BigInt(controller.candidate.manifest.transportProtection.assets[0].sealPackageId),
    BigInt(TYPE_ORIGIN_PACKAGE),
  );
  assert.notEqual(TYPE_ORIGIN_PACKAGE, CALLABLE_PACKAGE);
  assert.equal(controller.candidate.manifest.overlay.assets[0].sha256, candidate.manifest.overlay.assets[0].sha256);
  assert.equal(controller.entries[1].blob.type, 'application/vnd.animacraft.seal-v5');
  assert.notEqual(
    await hashExpansionPackContent(await controller.entries[1].blob.arrayBuffer()),
    candidate.manifest.overlay.assets[0].sha256,
  );
  assert.equal(
    controller.recovery.actions.find((entry) => entry.id === 'local.pack.materialize')
      .outputs.styles[0].assetSealId,
    controller.candidate.manifest.transportProtection.assets[0].sealId.replace(/^0x/i, ''),
  );
  await controller.register();
  await controller.certify();
  await controller.publish();
  const bindOutput = controller.recovery.actions.find(
    (entry) => entry.id === 'chain.pack.seal-policy.bind',
  ).outputs;
  assert.equal(bindOutput.sealPackageId, TYPE_ORIGIN_PACKAGE);
});

test('keeps the exact Draft shell recoverable but fails before Walrus without a paid Seal client', async () => {
  const { project, candidate } = await fixture({ paid: true });
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: dependencies([]),
  });
  await assert.rejects(
    controller.prepare(),
    (error) => error?.code === 'MAKER_SEAL_V5_CLIENT_MISSING',
  );
  assert.ok(controller.plan);
  assert.equal(
    controller.recovery.actions.find((entry) => entry.id === 'chain.pack.create').status,
    'CONFIRMED',
  );
  assert.equal(controller.currentEntry().id, 'local.pack.materialize');
  assert.equal(controller.entries, null);
});

test('rejects a changed paid ciphertext when restoring a publication checkpoint', async () => {
  const { project, candidate } = await fixture({ paid: true });
  const first = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: Object.assign(dependencies([]), sealDependencies()),
  });
  await first.prepare();
  const changedEntries = first.entries.map((entry, index) => index === 1
    ? { ...entry, blob: new Blob(['changed ciphertext'], { type: entry.blob.type }) }
    : entry);
  const restored = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate: first.candidate,
    plan: first.plan,
    recovery: first.recovery,
    entries: changedEntries,
    dependencies: Object.assign(dependencies([]), sealDependencies()),
  });
  await assert.rejects(
    restored.register(),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_ASSET_BLOB_CHANGED',
  );
});

test('keeps a submitted Sui digest recoverable when readback is delayed', async () => {
  const { project, candidate } = await fixture();
  const deps = dependencies([]);
  let delayed = true;
  const originalReadback = deps.readSuiSubmission;
  deps.readSuiSubmission = async (action, ...args) => {
    if (delayed && action.id === 'chain.pack.manifest.bind') {
      delayed = false;
      const error = new Error('Indexer delayed');
      error.code = 'READBACK_DELAYED';
      throw error;
    }
    return originalReadback(action, ...args);
  };
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: deps,
  });
  await controller.prepare();
  await controller.register();
  await controller.certify();
  await assert.rejects(controller.publish(), /Indexer delayed/);
  assert.equal(controller.currentEntry().status, 'SUBMITTED');
  assert.equal(controller.uiState().actions.review, true);
  await controller.review();
  assert.equal(controller.currentEntry()?.id.startsWith('chain.pack.style.register.'), true);
});

test('durably archives a finalized failed Sui digest before signing a fresh attempt', async () => {
  const log = [];
  const deps = dependencies(log);
  const originalExecute = deps.executeSignedTransactionAndWait;
  let failManifestOnce = true;
  deps.executeSignedTransactionAndWait = async (signed, options) => {
    if (failManifestOnce && signed.digest === 'digest-2') {
      failManifestOnce = false;
      const error = new Error('MoveAbort EInvalidLifecycle');
      error.code = 'TRANSACTION_FINALIZED_FAILURE';
      error.digest = signed.digest;
      error.finalizedFailure = {
        finalized: true,
        transactionDigest: signed.digest,
        executionStatus: 'FAILURE',
        executionError: {
          kind: 'MoveAbort',
          message: error.message,
          command: 1,
          abortCode: '17',
        },
      };
      throw error;
    }
    return originalExecute(signed, options);
  };
  const controller = await certifiedController({ log, deps });
  const baseline = log.length;

  await assert.rejects(
    controller.publish(),
    (error) => error?.code === 'TRANSACTION_FINALIZED_FAILURE',
  );
  assert.equal(controller.currentEntry().id, 'chain.pack.manifest.bind');
  assert.equal(controller.currentEntry().status, 'PENDING');
  assert.equal(controller.currentEntry().submission, null);
  assert.equal(controller.recovery.finalizedFailures.length, 1);
  assert.equal(controller.recovery.finalizedFailures[0].transactionDigest, 'digest-2');
  const failureArchive = log.slice(baseline).find((entry) => (
    entry.kind === 'persist'
    && entry.actionId === 'chain.pack.manifest.bind'
    && entry.status === 'PENDING'
    && entry.finalizedFailures.length === 1
  ));
  assert.ok(failureArchive, 'the failed digest must be durably archived before retry is exposed');

  await controller.publish();
  const manifestSignatures = log.filter((entry) => (
    entry.kind === 'sign' && entry.actionId === 'chain.pack.manifest.bind'
  ));
  assert.deepEqual(manifestSignatures.map((entry) => entry.signed.digest), [
    'digest-2',
    'digest-3',
  ]);
  assert.ok(controller.receipt);
});

test('never retires failed signed bytes when finalized-failure persistence is unavailable', async () => {
  const log = [];
  const deps = dependencies(log);
  const originalPersist = deps.persist;
  const originalExecute = deps.executeSignedTransactionAndWait;
  let rejectFailureArchive = true;
  deps.persist = async (snapshot) => {
    const current = snapshot.recovery.actions[snapshot.recovery.currentActionIndex];
    if (
      rejectFailureArchive
      && current?.id === 'chain.pack.manifest.bind'
      && current?.status === 'PENDING'
      && snapshot.recovery.finalizedFailures?.length
    ) {
      throw Object.assign(new Error('failure archive unavailable'), {
        code: 'EXPANSION_PACK_PUBLICATION_PERSISTENCE_FAILED',
      });
    }
    return originalPersist(snapshot);
  };
  deps.executeSignedTransactionAndWait = async (signed, options) => {
    if (signed.digest === 'digest-2') {
      const error = new Error('MoveAbort EInvalidLifecycle');
      error.code = 'TRANSACTION_FINALIZED_FAILURE';
      error.digest = signed.digest;
      error.finalizedFailure = {
        finalized: true,
        transactionDigest: signed.digest,
        executionStatus: 'FAILURE',
        executionError: {
          kind: 'MoveAbort',
          message: error.message,
          command: 1,
          abortCode: '17',
        },
      };
      throw error;
    }
    return originalExecute(signed, options);
  };
  const controller = await certifiedController({ log, deps });

  await assert.rejects(controller.publish(), /failure archive unavailable/);
  assert.equal(controller.currentEntry().status, 'SUBMITTED');
  assert.equal(controller.currentEntry().submission.transactionDigest, 'digest-2');
  assert.equal(controller.recovery.finalizedFailures.length, 0);
  assert.equal(log.filter((entry) => (
    entry.kind === 'sign' && entry.actionId === 'chain.pack.manifest.bind'
  )).length, 1);

  rejectFailureArchive = false;
  await assert.rejects(
    controller.review(),
    (error) => error?.code === 'TRANSACTION_FINALIZED_FAILURE',
  );
  assert.equal(controller.currentEntry().status, 'PENDING');
  assert.equal(controller.recovery.finalizedFailures[0].transactionDigest, 'digest-2');
  assert.equal(log.filter((entry) => (
    entry.kind === 'sign' && entry.actionId === 'chain.pack.manifest.bind'
  )).length, 1, 'review must not sign a replacement before the archive is durable');
});

test('rechecks activity after the durable intent persist before requesting a signature', async () => {
  const log = [];
  const deps = dependencies(log);
  const originalPersist = deps.persist;
  let active = true;
  let flipDuringIntentPersist = false;
  deps.persist = async (snapshot) => {
    const saved = await originalPersist(snapshot);
    const current = snapshot.recovery.actions[snapshot.recovery.currentActionIndex];
    if (
      flipDuringIntentPersist
      && current?.id === 'chain.pack.manifest.bind'
      && current?.status === 'INTENT'
    ) active = false;
    return saved;
  };
  const controller = await certifiedController({ log, deps, isActive: () => active });
  const baseline = log.length;
  flipDuringIntentPersist = true;

  await assert.rejects(
    controller.publish(),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED',
  );
  const fenced = log.slice(baseline);
  assert.equal(fenced.filter((entry) => entry.kind === 'sign').length, 0);
  assert.equal(fenced.filter((entry) => entry.kind === 'execute').length, 0);
  assert.equal(controller.currentEntry().status, 'INTENT');
});

test('persists signed bytes but never broadcasts when activity changes during signing', async () => {
  const log = [];
  const deps = dependencies(log);
  const originalSign = deps.signTransactionForRecovery;
  let active = true;
  let flipDuringSign = false;
  deps.signTransactionForRecovery = async (...args) => {
    const signed = await originalSign(...args);
    if (flipDuringSign) active = false;
    return signed;
  };
  const controller = await certifiedController({ log, deps, isActive: () => active });
  const baseline = log.length;
  flipDuringSign = true;

  await assert.rejects(
    controller.publish(),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED',
  );
  const fenced = log.slice(baseline);
  assert.equal(fenced.filter((entry) => entry.kind === 'sign').length, 1);
  assert.equal(fenced.filter((entry) => entry.kind === 'execute').length, 0);
  assert.deepEqual(
    controller.currentEntry().submission,
    fenced.find((entry) => entry.kind === 'persist' && entry.submission?.bytes)?.submission,
  );
  assert.equal(controller.currentEntry().submission.bytes, 'bytes-2');
});

test('restores controller recovery when a Walrus failure-archive checkpoint cannot persist', async () => {
  const { project, candidate } = await fixture();
  const log = [];
  const deps = dependencies(log);
  const originalPersist = deps.persist;
  deps.persist = async (snapshot) => {
    const current = snapshot.recovery.actions[snapshot.recovery.currentActionIndex];
    if (current?.progress?.finalizedFailures?.length) {
      throw new Error('archive checkpoint unavailable');
    }
    return originalPersist(snapshot);
  };
  deps.registerAndUploadWalrus = async (session, { onCheckpoint }) => {
    const pending = {
      digest: 'walrus-failed-digest',
      bytes: 'walrus-signed-bytes',
      signature: 'walrus-signature',
    };
    session.pendingRegisterTransaction = pending;
    session.finalizedFailures = [];
    await onCheckpoint(session);
    session.pendingRegisterTransaction = null;
    session.finalizedFailures = [{
      transactionKind: 'REGISTER',
      transactionDigest: pending.digest,
      finalized: true,
      executionStatus: 'FAILURE',
      executionError: {
        kind: 'MoveAbort',
        message: 'registration failed',
        command: 1,
        abortCode: '17',
      },
      recordedAt: '2026-08-12T04:02:03.000Z',
    }];
    try {
      await onCheckpoint(session);
    } catch (error) {
      session.pendingRegisterTransaction = pending;
      session.finalizedFailures = [];
      throw error;
    }
  };
  const controller = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: deps,
  });
  await controller.prepare();
  await assert.rejects(controller.register(), /archive checkpoint unavailable/);

  assert.equal(controller.currentEntry().status, 'INTENT');
  assert.equal(
    controller.currentEntry().progress.pendingRegisterTransaction.digest,
    'walrus-failed-digest',
  );
  assert.equal(controller.currentEntry().progress.finalizedFailures.length, 0);
  assert.equal(controller.session.pendingRegisterTransaction.digest, 'walrus-failed-digest');
  assert.equal(controller.session.finalizedFailures.length, 0);
});

test('resumes submitted Walrus registration from durable recovery without registering again', async () => {
  const { project, candidate } = await fixture();
  const log = [];
  const deps = dependencies(log);
  const basePersist = deps.persist;
  let active = true;
  deps.persist = async (snapshot) => {
    const saved = await basePersist(snapshot);
    const current = snapshot.recovery.actions[snapshot.recovery.currentActionIndex];
    if (current?.id === 'walrus.pack.register-upload' && current.status === 'SUBMITTED') {
      active = false;
    }
    return saved;
  };
  const first = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: deps,
    isActive: () => active,
  });
  await first.prepare();
  await assert.rejects(
    first.register(),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED',
  );
  assert.equal(first.currentEntry().status, 'SUBMITTED');
  const restoredRecovery = structuredClone(first.recovery);
  restoredRecovery.actions[restoredRecovery.currentActionIndex].progress = null;

  const restoreDeps = dependencies([]);
  let registerCalls = 0;
  restoreDeps.registerAndUploadWalrus = async () => {
    registerCalls += 1;
    throw new Error('submitted registration must not run again');
  };
  const restored = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate: first.candidate,
    plan: first.plan,
    recovery: restoredRecovery,
    entries: first.entries,
    dependencies: restoreDeps,
  });
  await restored.resume();
  assert.equal(registerCalls, 0);
  assert.equal(restored.recovery.actions.find(
    (entry) => entry.id === 'walrus.pack.register-upload',
  ).status, 'CONFIRMED');
  assert.equal(restored.currentEntry().id, 'walrus.pack.certify');
});

test('resumes submitted Walrus certification by readback without certifying again', async () => {
  const { project, candidate } = await fixture();
  const log = [];
  const deps = dependencies(log);
  const basePersist = deps.persist;
  let active = true;
  deps.persist = async (snapshot) => {
    const saved = await basePersist(snapshot);
    const current = snapshot.recovery.actions[snapshot.recovery.currentActionIndex];
    if (current?.id === 'walrus.pack.certify' && current.status === 'SUBMITTED') {
      active = false;
    }
    return saved;
  };
  const first = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate,
    dependencies: deps,
    isActive: () => active,
  });
  await first.prepare();
  await first.register();
  await assert.rejects(
    first.certify(),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED',
  );
  assert.equal(first.currentEntry().status, 'SUBMITTED');
  const restoredRecovery = structuredClone(first.recovery);
  restoredRecovery.actions[restoredRecovery.currentActionIndex].progress = null;

  const restoreDeps = dependencies([]);
  let certifyCalls = 0;
  let restoredCheckpoint = null;
  restoreDeps.resumeWalrusUpload = async (_entries, recovery) => {
    restoredCheckpoint = structuredClone(recovery);
    return { ...structuredClone(recovery), files: recovery.files || [] };
  };
  restoreDeps.certifyWalrusUpload = async () => {
    certifyCalls += 1;
    throw new Error('submitted certification must not run again');
  };
  const restored = createExpansionPackPublicationController({
    runtime: runtime(),
    context: {
      owner: OWNER,
      baseMakerRootId: ROOT,
      parentLegacyMakerId: LEGACY,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    project,
    candidate: first.candidate,
    plan: first.plan,
    recovery: restoredRecovery,
    entries: first.entries,
    dependencies: restoreDeps,
  });
  await restored.resume();
  assert.equal(certifyCalls, 0);
  assert.equal(restoredCheckpoint.stage, 'certified');
  assert.equal(restoredCheckpoint.certifyDigest, 'certify-digest');
  assert.equal(restored.recovery.actions.find(
    (entry) => entry.id === 'walrus.pack.certify',
  ).status, 'CONFIRMED');
  assert.equal(restored.currentEntry().id, 'chain.pack.manifest.bind');
});

test('rechecks activity after signed-byte persistence and replays only those exact bytes', async () => {
  const log = [];
  const deps = dependencies(log);
  const originalPersist = deps.persist;
  let active = true;
  let flipDuringSignedPersist = false;
  deps.persist = async (snapshot) => {
    const saved = await originalPersist(snapshot);
    const current = snapshot.recovery.actions[snapshot.recovery.currentActionIndex];
    if (
      flipDuringSignedPersist
      && current?.id === 'chain.pack.manifest.bind'
      && current?.submission?.bytes
    ) active = false;
    return saved;
  };
  const controller = await certifiedController({ log, deps, isActive: () => active });
  const baseline = log.length;
  flipDuringSignedPersist = true;

  await assert.rejects(
    controller.publish(),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_CONTEXT_CHANGED',
  );
  const fenced = log.slice(baseline);
  assert.equal(fenced.filter((entry) => entry.kind === 'sign').length, 1);
  assert.equal(fenced.filter((entry) => entry.kind === 'execute').length, 0);
  const exactSubmission = structuredClone(controller.currentEntry().submission);
  assert.equal(exactSubmission.bytes, 'bytes-2');

  active = true;
  flipDuringSignedPersist = false;
  const replayBaseline = log.length;
  await controller.review();
  const replay = log.slice(replayBaseline);
  assert.equal(replay.filter((entry) => entry.kind === 'sign').length, 0);
  assert.deepEqual(
    replay.filter((entry) => entry.kind === 'execute'),
    [{ kind: 'execute', digest: exactSubmission.digest, bytes: exactSubmission.bytes }],
  );
  assert.equal(controller.currentEntry()?.id.startsWith('chain.pack.style.register.'), true);
});
