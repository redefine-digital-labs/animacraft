import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addExpansionPackItem,
  createExpansionPackProject,
} from '../expansion-pack-project.js';
import {
  buildExpansionPackPublicationCandidate,
  canonicalExpansionPackJson,
  hashExpansionPackContent,
  protectExpansionPackPublicationCandidate,
} from '../expansion-pack-publication.js';
import {
  EXPANSION_PACK_PUBLICATION_ACTION_STATUS,
  EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA,
  EXPANSION_PACK_PUBLICATION_RECOVERY_SCHEMA,
  EXPANSION_PACK_PUBLICATION_STAGES,
  ExpansionPackPublicationRecoveryError,
  beginExpansionPackPublicationAction,
  buildExpansionPackPublicationPlan,
  completedExpansionPackPublication,
  confirmExpansionPackPublicationAction,
  createExpansionPackPublicationRecovery,
  hydrateExpansionPackPublicationRecovery,
  materializeExpansionPackPublicationCandidate,
  markExpansionPackPublicationSubmitted,
  nextExpansionPackPublicationAction,
  recordExpansionPackPublicationError,
  recordExpansionPackPublicationFinalizedFailure,
  recordExpansionPackPublicationProgress,
} from '../expansion-pack-publication-recovery.js';

const OWNER = '0x111';
const BASE_ROOT = '0x222';
const PARENT_RELEASE = '0x333';
const INDEPENDENT_EXTENSION_AUTHORITY = '0x444';
const CALLABLE_PACKAGE = '0x555';
const TYPE_ORIGIN_PACKAGE = '0x556';
const INDEPENDENT_EXTENSION_TYPE_ORIGIN_PACKAGE = '0x557';
const PARENT_HASH = '11'.repeat(32);
const ASSET_HASH = '22'.repeat(32);

function parentMaker() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: 'maker-root', versionId: 'maker-root-v7', number: 7 },
    metadata: {
      id: 'maker-root',
      name: 'Parent Maker',
      license: { kind: 'personal-use', note: 'Parent terms.' },
    },
    canvas: { width: 1024, height: 1024, pixelMode: 'smooth' },
    layerTracks: [{ id: 'body-track', name: 'Body', order: 0 }],
    colorChannels: [],
    assets: [{
      id: 'body-art',
      identifier: 'parent/body.png',
      mediaType: 'image/png',
      sha256: '33'.repeat(32),
    }],
    parts: [{
      id: 'body',
      name: 'Body',
      required: true,
      allowRemove: false,
      defaultItemId: 'default',
      items: [{
        id: 'default',
        name: 'Default',
        defaultStyleId: 'default',
        styles: [{
          id: 'default',
          assetId: 'body-art',
          layerTrackId: 'body-track',
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
        }],
      }],
    }],
    defaultRecipe: {
      selections: [{ partId: 'body', itemId: 'default', styleId: 'default' }],
      colors: [],
    },
    rules: [],
  };
}

async function candidateProjectFixture({ paid = false } = {}) {
  const paidBytes = new TextEncoder().encode('exact paid moon armor PNG');
  const assetHash = paid ? await hashExpansionPackContent(paidBytes) : ASSET_HASH;
  const project = createExpansionPackProject(parentMaker(), {
    packId: 'moon-pack',
    namespace: 'moon',
    name: 'Moon Pack',
    version: '1.0.0',
    walletAddress: OWNER,
    parentRelease: {
      identityVerified: true,
      releaseId: PARENT_RELEASE,
      versionId: 'maker-root-v7',
      versionNumber: '7',
      manifestBlobId: 'parent-quilt',
      manifestHash: PARENT_HASH,
    },
  });
  const withItem = addExpansionPackItem(project, {
    partId: 'body',
    partName: 'Body',
    item: {
      id: 'moon-armor',
      name: 'Moon Armor',
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default',
        assetId: 'moon-armor-art',
        layerTrackId: 'body-track',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'normal',
      }],
    },
    assets: [{
      id: 'moon-armor-art',
      identifier: 'assets/moon-armor.png',
      kind: 'layer',
      mediaType: 'image/png',
      sha256: assetHash,
      byteLength: 1234,
      width: 1024,
      height: 1024,
      ...(paid ? { blob: new Blob([paidBytes], { type: 'image/png' }) } : {}),
    }],
  });
  const candidate = await buildExpansionPackPublicationCandidate(withItem, paid ? {
    commerce: { accessMode: 'PAID', price: '100' },
  } : {});
  return { candidate, project: withItem };
}

async function candidateFixture(options = {}) {
  return (await candidateProjectFixture(options)).candidate;
}

function sealDependencies(releaseId) {
  return {
    sealClient: {
      async encrypt({ data }) {
        return { encryptedObject: new Uint8Array([83, 69, 65, 76, ...data]) };
      },
    },
    sealPackageId: TYPE_ORIGIN_PACKAGE,
    releaseId,
    threshold: 1,
    serverConfigs: [{
      objectId: '0x888',
      weight: 1,
      aggregatorUrl: 'https://seal.example',
    }],
  };
}

function runtime(enabled = true) {
  return {
    network: 'mainnet',
    expansionPackV8ReleaseEnabled: enabled,
    callablePackageId: CALLABLE_PACKAGE,
    commerceV5CallablePackageId: '0x777',
    expansionPackV8CallablePackageId: CALLABLE_PACKAGE,
    expansionPackV8TypeOriginPackageId: TYPE_ORIGIN_PACKAGE,
    independentExtensionV5TypeOriginPackageId: INDEPENDENT_EXTENSION_TYPE_ORIGIN_PACKAGE,
    commerceProtocolConfigV5Id: '0x666',
    paymentCoinType: '0x2::sui::SUI',
  };
}

async function planFixture(options = {}) {
  return buildExpansionPackPublicationPlan({
    candidate: await candidateFixture(options),
    context: {
      owner: OWNER,
      baseMakerRootId: BASE_ROOT,
      parentLegacyMakerId: PARENT_RELEASE,
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    },
    runtime: runtime(),
  });
}

function publicationContext() {
  return {
    owner: OWNER,
    baseMakerRootId: BASE_ROOT,
    parentLegacyMakerId: PARENT_RELEASE,
    independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
  };
}

async function executeReadback(recovery, plan, actionId, confirmation, submission = {}) {
  let next = recovery;
  const exactConfirmation = actionId === 'parent.release.verify'
    && typeof confirmation?.parentReleaseEvidenceBound !== 'boolean'
    ? {
        parentOwnershipEpoch: '7',
        ...confirmation,
        parentReleaseEvidenceBound: true,
      }
    : confirmation;
  next = await beginExpansionPackPublicationAction({ recovery: next, plan, runtime: runtime() });
  assert.equal(next.actions[next.currentActionIndex].status, EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT);
  next = await markExpansionPackPublicationSubmitted({
    recovery: next,
    plan,
    actionId,
    submission: {
      actionId,
      ...(exactConfirmation?.transactionDigest
        ? { transactionDigest: exactConfirmation.transactionDigest }
        : {}),
      ...submission,
    },
  });
  return confirmExpansionPackPublicationAction({
    recovery: next,
    plan,
    actionId,
    confirmation: exactConfirmation,
  });
}

test('builds a deterministic real Pack v8 lifecycle after the recoverable Walrus actions', async () => {
  const first = await planFixture();
  const second = await planFixture();
  assert.equal(first.planIdentity, second.planIdentity);
  assert.equal(first.bindingIdentity, second.bindingIdentity);
  assert.equal(first.schema, EXPANSION_PACK_PUBLICATION_PLAN_SCHEMA);
  assert.equal(first.version, 5);
  assert.equal(first.context.commerceV5CallablePackageId, '0x777');
  assert.equal(first.context.expansionPackV8CallablePackageId, CALLABLE_PACKAGE);
  assert.equal(first.context.expansionPackV8TypeOriginPackageId, TYPE_ORIGIN_PACKAGE);
  assert.equal(
    first.context.independentExtensionV5TypeOriginPackageId,
    INDEPENDENT_EXTENSION_TYPE_ORIGIN_PACKAGE,
  );
  assert.equal(first.binding.expansionPackV8TypeOriginPackageId, TYPE_ORIGIN_PACKAGE);
  assert.equal(
    first.binding.independentExtensionAuthorityV5Id,
    INDEPENDENT_EXTENSION_AUTHORITY,
  );
  assert.equal(
    first.binding.independentExtensionV5TypeOriginPackageId,
    INDEPENDENT_EXTENSION_TYPE_ORIGIN_PACKAGE,
  );
  assert.notEqual(first.context.expansionPackV8CallablePackageId, TYPE_ORIGIN_PACKAGE);
  assert.deepEqual(first.actions.map((entry) => entry.id), [
    'parent.release.verify',
    'chain.pack.create',
    'local.pack.materialize',
    'walrus.pack.prepare',
    'walrus.pack.register-upload',
    'walrus.pack.certify',
    'chain.pack.manifest.bind',
    'chain.pack.style.register.body_3Amoon-armor_3Adefault',
    'chain.pack.seal',
    'chain.pack.admit',
    'chain.pack.activate',
  ]);
  assert.match(first.actions[1].target, /::expansion_pack_v8::create_expansion_pack_v8$/);
  assert.match(first.actions[6].target, /::expansion_pack_v8::bind_expansion_pack_manifest_v8$/);
  assert.match(first.actions[7].target, /::expansion_pack_v8::register_style_asset_v8$/);
  assert.match(first.actions[9].target, /::expansion_pack_v8::admit_expansion_pack_with_authority_v8$/);
  assert.deepEqual(first.actions[9].inputs.independentExtensionAuthorityV5Id, {
    $context: 'independentExtensionAuthorityV5Id',
  });
  assert.equal(first.styles[0].assetIdentifier, 'assets/moon-armor.png');
  assert.equal(first.styles[0].assetSha256, ASSET_HASH);
  assert.match(first.styles[0].styleCommitment, /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(first));
});

test('archives a definitive failed Sui digest before allowing a fresh signature', async () => {
  const plan = await planFixture();
  let recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-finalized-failure-0001',
  });
  recovery = await executeReadback(recovery, plan, 'parent.release.verify', {
    parentVerified: true,
    independentExtensionAuthorityVerified: true,
    parentLifecycleState: 'PAUSED',
    parentOwnershipEpoch: '7',
    baseMakerRootId: BASE_ROOT,
    parentLegacyMakerId: PARENT_RELEASE,
    parentVersion: '7',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: PARENT_HASH,
  });
  recovery = await beginExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  recovery = await markExpansionPackPublicationSubmitted({
    recovery,
    plan,
    actionId: 'chain.pack.create',
    submission: {
      transactionDigest: 'failed-digest-1',
      digest: 'failed-digest-1',
      bytes: 'signed-bytes-1',
      signature: 'signature-1',
    },
  });
  const error = Object.assign(new Error('MoveAbort EInvalidLifecycle'), {
    code: 'TRANSACTION_FINALIZED_FAILURE',
    digest: 'failed-digest-1',
    finalizedFailure: {
      finalized: true,
      transactionDigest: 'failed-digest-1',
      executionStatus: 'FAILURE',
      executionError: {
        kind: 'MoveAbort',
        message: 'MoveAbort EInvalidLifecycle',
        command: 2,
        abortCode: '17',
      },
    },
  });
  const archived = await recordExpansionPackPublicationFinalizedFailure({
    recovery,
    plan,
    error,
    recordedAt: '2026-08-12T01:02:03.000Z',
  });
  const archivedCreate = archived.actions.find((entry) => entry.id === 'chain.pack.create');
  assert.equal(archivedCreate.status, EXPANSION_PACK_PUBLICATION_ACTION_STATUS.PENDING);
  assert.equal(archivedCreate.intentKey, '');
  assert.equal(archivedCreate.submission, null);
  assert.equal(archived.currentActionIndex, 1);
  assert.equal(archived.finalizedFailures.length, 1);
  assert.deepEqual(archived.finalizedFailures[0], {
    actionId: 'chain.pack.create',
    transactionDigest: 'failed-digest-1',
    finalized: true,
    executionStatus: 'FAILURE',
    executionError: {
      kind: 'MoveAbort',
      message: 'MoveAbort EInvalidLifecycle',
      command: 2,
      abortCode: '17',
    },
    recordedAt: '2026-08-12T01:02:03.000Z',
  });
  assert.equal(archived.lastError.finalized, true);
  assert.equal(archived.lastError.transactionDigest, 'failed-digest-1');
  const hydrated = await hydrateExpansionPackPublicationRecovery(archived, { plan });
  assert.deepEqual(hydrated.finalizedFailures, archived.finalizedFailures);
  const impossibleTransport = structuredClone(hydrated);
  impossibleTransport.finalizedFailures[0].actionId = 'walrus.pack.prepare';
  await assert.rejects(
    hydrateExpansionPackPublicationRecovery(impossibleTransport, { plan }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_INVALID',
  );
  const reusedDigest = structuredClone(hydrated);
  reusedDigest.finalizedFailures.push({
    ...structuredClone(reusedDigest.finalizedFailures[0]),
    actionId: 'chain.pack.manifest.bind',
  });
  await assert.rejects(
    hydrateExpansionPackPublicationRecovery(reusedDigest, { plan }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_DIGEST_REUSED',
  );
  const duplicate = await recordExpansionPackPublicationFinalizedFailure({
    recovery: hydrated,
    plan,
    error,
    recordedAt: '2026-08-12T02:02:03.000Z',
  });
  assert.equal(duplicate.sequence, hydrated.sequence);
  assert.equal(duplicate.finalizedFailures.length, 1);

  const nextAttempt = await beginExpansionPackPublicationAction({
    recovery: duplicate,
    plan,
    runtime: runtime(),
  });
  const nextCreate = nextAttempt.actions.find((entry) => entry.id === 'chain.pack.create');
  const failedCreate = recovery.actions.find((entry) => entry.id === 'chain.pack.create');
  assert.equal(nextCreate.status, EXPANSION_PACK_PUBLICATION_ACTION_STATUS.INTENT);
  assert.notEqual(nextCreate.intentKey, failedCreate.intentKey);
});

test('rejects mismatched or conflicting definitive failure evidence and preserves ambiguous submissions', async () => {
  const plan = await planFixture();
  let recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-finalized-failure-0002',
  });
  recovery = await executeReadback(recovery, plan, 'parent.release.verify', {
    parentVerified: true,
    independentExtensionAuthorityVerified: true,
    parentLifecycleState: 'PAUSED',
    parentOwnershipEpoch: '7',
    baseMakerRootId: BASE_ROOT,
    parentLegacyMakerId: PARENT_RELEASE,
    parentVersion: '7',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: PARENT_HASH,
  });
  recovery = await beginExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  recovery = await markExpansionPackPublicationSubmitted({
    recovery,
    plan,
    actionId: 'chain.pack.create',
    submission: { transactionDigest: 'exact-digest', digest: 'exact-digest' },
  });
  await assert.rejects(
    confirmExpansionPackPublicationAction({
      recovery,
      plan,
      actionId: 'chain.pack.create',
      confirmation: { transactionDigest: 'different-digest' },
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_CONFIRMATION_DIGEST_MISMATCH',
  );
  const failed = (digest, message = 'failed') => Object.assign(new Error(message), {
    code: 'TRANSACTION_FINALIZED_FAILURE',
    digest,
    finalizedFailure: {
      finalized: true,
      transactionDigest: digest,
      executionStatus: 'FAILURE',
      executionError: { kind: 'MoveAbort', message, command: 1, abortCode: '9' },
    },
  });
  await assert.rejects(
    recordExpansionPackPublicationFinalizedFailure({
      recovery,
      plan,
      error: failed('other-digest'),
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_DIGEST_MISMATCH',
  );
  const ambiguous = await recordExpansionPackPublicationError({
    recovery,
    plan,
    error: Object.assign(new Error('still indexing'), { code: 'TRANSACTION_OUTCOME_PENDING' }),
  });
  const ambiguousCreate = ambiguous.actions.find((entry) => entry.id === 'chain.pack.create');
  assert.equal(ambiguousCreate.status, EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED);
  assert.equal(ambiguousCreate.submission.transactionDigest, 'exact-digest');

  const archived = await recordExpansionPackPublicationFinalizedFailure({
    recovery,
    plan,
    error: failed('exact-digest'),
    recordedAt: '2026-08-12T03:02:03.000Z',
  });
  await assert.rejects(
    recordExpansionPackPublicationFinalizedFailure({
      recovery: archived,
      plan,
      error: failed('exact-digest', 'different failure'),
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_FINALIZED_FAILURE_CONFLICT',
  );
});

test('derives paid Style Seal ids and inserts the exact release-as-policy binding', async () => {
  const { candidate, project } = await candidateProjectFixture({ paid: true });
  const plan = await buildExpansionPackPublicationPlan({
    candidate,
    context: publicationContext(),
    runtime: runtime(),
  });
  assert.equal(plan.context.accessKind, 1);
  assert.equal(plan.context.purchasePriceAtomic, '100');
  assert.equal(plan.styles[0].assetSealId, undefined);
  assert.deepEqual(
    plan.actions.slice(-4).map((entry) => entry.id),
    [
      'chain.pack.seal',
      'chain.pack.seal-policy.bind',
      'chain.pack.admit',
      'chain.pack.activate',
    ],
  );
  const bind = plan.actions.find((entry) => entry.id === 'chain.pack.seal-policy.bind');
  assert.equal(bind.inputs.contentCommitment, plan.candidate.contentCommitment);
  assert.deepEqual(bind.inputs.sealPackageId, {
    $context: 'expansionPackV8TypeOriginPackageId',
  });
  assert.ok(bind.outputs.includes('sealPackageId'));
  assert.deepEqual(bind.inputs.packReleaseId, {
    $output: { actionId: 'chain.pack.create', field: 'packReleaseId', path: [] },
  });
  assert.equal(bind.inputs.sealPolicyId, undefined);
  assert.equal(bind.inputs.sealReleaseCommitment, undefined);

  const firstProtected = await protectExpansionPackPublicationCandidate(
    candidate,
    project,
    sealDependencies('0x901'),
  );
  const firstMaterialized = await materializeExpansionPackPublicationCandidate({
    candidate: firstProtected.candidate,
    context: publicationContext(),
    runtime: runtime(),
    releaseId: '0x901',
  });
  const secondProtected = await protectExpansionPackPublicationCandidate(
    candidate,
    project,
    sealDependencies('0x902'),
  );
  const secondMaterialized = await materializeExpansionPackPublicationCandidate({
    candidate: secondProtected.candidate,
    context: publicationContext(),
    runtime: runtime(),
    releaseId: '0x902',
  });
  assert.match(firstMaterialized.styles[0].assetSealId, /^[0-9a-f]{64}$/);
  assert.notEqual(
    firstMaterialized.styles[0].assetSealId,
    secondMaterialized.styles[0].assetSealId,
  );
  assert.notEqual(
    firstMaterialized.sealReleaseCommitment,
    secondMaterialized.sealReleaseCommitment,
  );

  const callableProtected = await protectExpansionPackPublicationCandidate(
    candidate,
    project,
    { ...sealDependencies('0x901'), sealPackageId: CALLABLE_PACKAGE },
  );
  await assert.rejects(
    materializeExpansionPackPublicationCandidate({
      candidate: callableProtected.candidate,
      context: publicationContext(),
      runtime: runtime(),
      releaseId: '0x901',
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_TRANSPORT_BINDING_MISMATCH',
  );
});

test('rejects disposable pre-v5 publication plans and recovery checkpoints', async () => {
  const plan = await planFixture();
  const recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-recovery-v5-only',
  });
  assert.equal(recovery.schema, EXPANSION_PACK_PUBLICATION_RECOVERY_SCHEMA);
  assert.equal(recovery.version, 5);

  const v2Plan = structuredClone(plan);
  v2Plan.schema = 'animacraft.expansion-pack-publication-plan.v2';
  v2Plan.version = 2;
  await assert.rejects(
    createExpansionPackPublicationRecovery({ plan: v2Plan, nonce: 'pack-recovery-v2-plan' }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_PLAN_INVALID',
  );

  const v2Recovery = structuredClone(recovery);
  v2Recovery.schema = 'animacraft.expansion-pack-publication-recovery.v2';
  v2Recovery.version = 2;
  await assert.rejects(
    hydrateExpansionPackPublicationRecovery(v2Recovery, { plan }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_RECOVERY_SCOPE_MISMATCH',
  );
});

test('gates all action execution and rejects a recovery from another immutable Pack', async () => {
  const plan = await planFixture();
  const recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-recovery-0001',
    createdAt: '2026-08-10T00:00:00.000Z',
  });
  await assert.rejects(
    nextExpansionPackPublicationAction({ recovery, plan, runtime: runtime(false) }),
    (error) => error instanceof ExpansionPackPublicationRecoveryError
      && error.code === 'EXPANSION_PACK_V8_RELEASE_DISABLED',
  );
  await assert.rejects(
    nextExpansionPackPublicationAction({
      recovery,
      plan,
      runtime: { ...runtime(), network: 'testnet' },
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_NETWORK_MISMATCH',
  );
  await assert.rejects(
    nextExpansionPackPublicationAction({
      recovery,
      plan,
      runtime: { ...runtime(), expansionPackV8TypeOriginPackageId: '0x999' },
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_RUNTIME_SCOPE_MISMATCH'
      && error.details.fields.includes('expansionPackV8TypeOriginPackageId'),
  );
  await assert.rejects(
    nextExpansionPackPublicationAction({
      recovery,
      plan,
      runtime: { ...runtime(), independentExtensionV5TypeOriginPackageId: '0x999' },
    }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_RUNTIME_SCOPE_MISMATCH'
      && error.details.fields.includes('independentExtensionV5TypeOriginPackageId'),
  );
  const otherPlan = structuredClone(plan);
  otherPlan.planIdentity = 'ff'.repeat(32);
  await assert.rejects(
    hydrateExpansionPackPublicationRecovery(recovery, { plan: otherPlan }),
    (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_RECOVERY_SCOPE_MISMATCH',
  );
});

test('persists signed Walrus progress, resumes submitted actions read-only and completes exact readbacks', async () => {
  const sourceCandidate = await candidateFixture();
  const plan = await buildExpansionPackPublicationPlan({
    candidate: sourceCandidate,
    context: publicationContext(),
    runtime: runtime(),
  });
  let recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-recovery-0002',
    createdAt: '2026-08-10T00:00:00.000Z',
  });

  recovery = await executeReadback(recovery, plan, 'parent.release.verify', {
    parentVerified: true,
    independentExtensionAuthorityVerified: true,
    parentLifecycleState: 'PAUSED',
    parentOwnershipEpoch: '7',
    baseMakerRootId: BASE_ROOT,
    parentLegacyMakerId: PARENT_RELEASE,
    parentVersion: '7',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: PARENT_HASH,
  });

  const createAction = await nextExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  assert.deepEqual(createAction.typeArguments, ['0x2::sui::SUI']);
  assert.equal(createAction.inputs.manifestBlobId, undefined);
  recovery = await executeReadback(recovery, plan, 'chain.pack.create', {
    packReleaseId: '0x901',
    packAdminCapId: '0x902',
    packTreasuryId: '0x903',
    transactionDigest: 'create-digest',
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

  const materialized = await materializeExpansionPackPublicationCandidate({
    candidate: sourceCandidate,
    context: publicationContext(),
    runtime: runtime(),
    releaseId: '0x901',
  });
  recovery = await executeReadback(
    recovery,
    plan,
    'local.pack.materialize',
    materialized,
  );

  recovery = await beginExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  recovery = await recordExpansionPackPublicationProgress({
    recovery,
    plan,
    actionId: 'walrus.pack.prepare',
    progress: {
      stage: 'encoded',
      uploadSessionId: 'upload-session-1',
      quiltBlobId: 'pack-quilt',
      checkpoint: { step: 'encoded', blobId: 'pack-quilt' },
    },
  });
  assert.equal(
    recovery.actions.find((entry) => entry.id === 'walrus.pack.prepare')
      .progress.checkpoint.step,
    'encoded',
  );
  recovery = await markExpansionPackPublicationSubmitted({
    recovery,
    plan,
    actionId: 'walrus.pack.prepare',
    submission: { uploadSessionId: 'upload-session-1' },
  });
  const recoverable = await recordExpansionPackPublicationError({
    recovery,
    plan,
    error: Object.assign(new Error('readback delayed'), { code: 'READBACK_DELAYED' }),
  });
  const resumedAction = await nextExpansionPackPublicationAction({
    recovery: recoverable,
    plan,
    runtime: runtime(),
  });
  assert.equal(resumedAction.id, 'walrus.pack.prepare');
  const recoverablePrepare = recoverable.actions.find(
    (entry) => entry.id === 'walrus.pack.prepare',
  );
  assert.equal(recoverablePrepare.status, EXPANSION_PACK_PUBLICATION_ACTION_STATUS.SUBMITTED);
  assert.deepEqual(recoverablePrepare.submission, { uploadSessionId: 'upload-session-1' });
  recovery = await confirmExpansionPackPublicationAction({
    recovery: recoverable,
    plan,
    actionId: 'walrus.pack.prepare',
    confirmation: {
      uploadSessionId: 'upload-session-1',
      quiltBlobId: 'pack-quilt',
      walrusRecovery: {
        stage: 'encoded',
        uploadSessionId: 'upload-session-1',
        quiltBlobId: 'pack-quilt',
      },
    },
  });

  recovery = await executeReadback(recovery, plan, 'walrus.pack.register-upload', {
    uploadSessionId: 'upload-session-1',
    quiltBlobId: 'pack-quilt',
    blobObjectId: '0x888',
    registerDigest: 'register-digest',
    uploaded: true,
    walrusRecovery: {
      stage: 'uploaded',
      uploadSessionId: 'upload-session-1',
      quiltBlobId: 'pack-quilt',
    },
  });
  recovery = await executeReadback(recovery, plan, 'walrus.pack.certify', {
    uploadSessionId: 'upload-session-1',
    quiltBlobId: 'pack-quilt',
    blobObjectId: '0x888',
    certifyDigest: 'certify-digest',
    certified: true,
    certificationVisible: true,
    manifestQuiltPatchId: 'pack-manifest-patch',
    manifestIdentifier: materialized.candidate.manifestIdentifier,
    manifestSha256: materialized.manifestSha256,
    filePatchIds: {
      [materialized.candidate.manifestIdentifier]: 'pack-manifest-patch',
      'assets/moon-armor.png': 'pack-style-patch',
    },
    styleRegistryCommitment: await hashExpansionPackContent(canonicalExpansionPackJson([{
      partKey: 'body',
      itemKey: 'moon-armor',
      styleKey: 'default',
      assetBlobId: 'pack-style-patch',
      assetSha256: ASSET_HASH,
      assetSealId: '',
    }])),
    walrusRecovery: {
      stage: 'certified',
      uploadSessionId: 'upload-session-1',
      quiltBlobId: 'pack-quilt',
    },
  });

  const manifestBindAction = await nextExpansionPackPublicationAction({
    recovery,
    plan,
    runtime: runtime(),
  });
  recovery = await executeReadback(recovery, plan, 'chain.pack.manifest.bind', {
    transactionDigest: 'manifest-bind-digest',
    manifestBound: true,
    readbackVerified: true,
    manifestBlobId: manifestBindAction.inputs.manifestBlobId,
    manifestSha256: manifestBindAction.inputs.manifestSha256,
  });

  const styleActionId = plan.actions.find((entry) => entry.id.startsWith('chain.pack.style.register.')).id;
  const styleAction = await nextExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  assert.equal(styleAction.authority.capability, '0x902');
  assert.equal(styleAction.inputs.assetBlobId, 'pack-style-patch');
  recovery = await executeReadback(recovery, plan, styleActionId, {
    transactionDigest: 'style-digest',
    styleRegistered: true,
    readbackVerified: true,
    partKey: styleAction.inputs.partKey,
    itemKey: styleAction.inputs.itemKey,
    styleKey: styleAction.inputs.styleKey,
    assetBlobId: styleAction.inputs.assetBlobId,
    assetSha256: styleAction.inputs.assetSha256,
    assetSealId: styleAction.inputs.assetSealId,
  });
  const sealAction = await nextExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  recovery = await executeReadback(recovery, plan, 'chain.pack.seal', {
    transactionDigest: 'seal-digest',
    sealed: true,
    readbackVerified: true,
    styleRegistryCommitment: sealAction.inputs.styleRegistryCommitment,
  });
  const admitAction = await nextExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  await assert.rejects(
    executeReadback(recovery, plan, 'chain.pack.admit', {
      transactionDigest: 'stale-admit-digest',
      admitted: true,
      parentBindingVerified: true,
      readbackVerified: true,
      baseMakerRootId: admitAction.inputs.baseMakerRootId,
      parentLegacyMakerId: admitAction.inputs.parentLegacyMakerId,
      parentVersion: admitAction.inputs.parentVersion,
      parentManifestBlobId: admitAction.inputs.parentManifestBlobId,
      parentManifestSha256: admitAction.inputs.parentManifestSha256,
      parentOwnershipEpoch: admitAction.inputs.parentOwnershipEpoch,
      admittedParentOwnershipEpoch: '6',
    }),
    (error) => error?.code === 'EXPANSION_PACK_CHAIN_ADMISSION_EPOCH_MISMATCH',
  );
  recovery = await executeReadback(recovery, plan, 'chain.pack.admit', {
    transactionDigest: 'admit-digest',
    admitted: true,
    parentBindingVerified: true,
    readbackVerified: true,
    baseMakerRootId: admitAction.inputs.baseMakerRootId,
    parentLegacyMakerId: admitAction.inputs.parentLegacyMakerId,
    parentVersion: admitAction.inputs.parentVersion,
    parentManifestBlobId: admitAction.inputs.parentManifestBlobId,
    parentManifestSha256: admitAction.inputs.parentManifestSha256,
    parentOwnershipEpoch: admitAction.inputs.parentOwnershipEpoch,
    admittedParentOwnershipEpoch: admitAction.inputs.parentOwnershipEpoch,
  });
  recovery = await executeReadback(recovery, plan, 'chain.pack.activate', {
    transactionDigest: 'activate-digest',
    readbackVerified: true,
    lifecycleState: 'ACTIVE',
  });

  assert.equal(recovery.completed, true);
  assert.equal(recovery.stage, EXPANSION_PACK_PUBLICATION_STAGES.COMPLETE);
  const completed = completedExpansionPackPublication({ plan, recovery });
  assert.deepEqual(completed, {
    packReleaseId: '0x901',
    packAdminCapId: '0x902',
    packTreasuryId: '0x903',
    transactionDigest: 'activate-digest',
    manifestBlobId: 'pack-quilt',
    manifestQuiltPatchId: 'pack-manifest-patch',
    manifestSha256: materialized.manifestSha256,
    candidateCommitment: materialized.candidateCommitment,
    parentLegacyMakerId: PARENT_RELEASE,
    baseMakerRootId: BASE_ROOT,
  });
});

test('fails closed when certification or parent readback differs from the immutable plan', async () => {
  const plan = await planFixture();
  let recovery = await createExpansionPackPublicationRecovery({
    plan,
    nonce: 'pack-recovery-0003',
  });
  recovery = await beginExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
  recovery = await markExpansionPackPublicationSubmitted({
    recovery,
    plan,
    actionId: 'parent.release.verify',
    submission: { query: 'parent' },
  });
  await assert.rejects(
    confirmExpansionPackPublicationAction({
      recovery,
      plan,
      actionId: 'parent.release.verify',
      confirmation: {
        parentVerified: true,
        independentExtensionAuthorityVerified: true,
        parentReleaseEvidenceBound: true,
        parentLifecycleState: 'PAUSED',
        parentOwnershipEpoch: '7',
        baseMakerRootId: BASE_ROOT,
        parentLegacyMakerId: '0x999',
        parentManifestBlobId: 'parent-quilt',
        parentManifestSha256: PARENT_HASH,
      },
    }),
    (error) => error?.code === 'EXPANSION_PACK_PARENT_READBACK_MISMATCH',
  );

  await assert.rejects(
    confirmExpansionPackPublicationAction({
      recovery,
      plan,
      actionId: 'parent.release.verify',
      confirmation: {
        parentVerified: true,
        independentExtensionAuthorityVerified: true,
        parentReleaseEvidenceBound: true,
        parentLifecycleState: 'ACTIVE',
        parentOwnershipEpoch: '7',
        baseMakerRootId: BASE_ROOT,
        parentLegacyMakerId: PARENT_RELEASE,
        parentVersion: '7',
        parentManifestBlobId: 'parent-quilt',
        parentManifestSha256: PARENT_HASH,
      },
    }),
    (error) => error?.code === 'EXPANSION_PACK_PARENT_INACTIVE',
  );
});

test('recovery rejects missing, stale, unsafe, and out-of-range ownership epochs', async () => {
  const plan = await planFixture();
  const parentCases = [undefined, -1, 2 ** 53, '18446744073709551616'];
  for (const parentOwnershipEpoch of parentCases) {
    let recovery = await createExpansionPackPublicationRecovery({
      plan,
      nonce: `pack-parent-epoch-${String(parentOwnershipEpoch)}-0001`,
    });
    recovery = await beginExpansionPackPublicationAction({ recovery, plan, runtime: runtime() });
    recovery = await markExpansionPackPublicationSubmitted({
      recovery,
      plan,
      actionId: 'parent.release.verify',
      submission: { query: 'parent' },
    });
    await assert.rejects(
      confirmExpansionPackPublicationAction({
        recovery,
        plan,
        actionId: 'parent.release.verify',
        confirmation: {
          parentVerified: true,
          independentExtensionAuthorityVerified: true,
          parentReleaseEvidenceBound: true,
          parentLifecycleState: 'PAUSED',
          parentOwnershipEpoch,
          baseMakerRootId: BASE_ROOT,
          parentLegacyMakerId: PARENT_RELEASE,
          parentVersion: '7',
          parentManifestBlobId: 'parent-quilt',
          parentManifestSha256: PARENT_HASH,
        },
      }),
      (error) => error?.code === 'EXPANSION_PACK_PUBLICATION_U64_INVALID',
    );
  }
});
