import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { toBase58 } from '@mysten/sui/utils';

import {
  MAKER_V8_PACK_COMPILER_RESULT_SCHEMA,
  MAKER_V8_PACK_CHAIN_READBACK_SCHEMA,
  MAKER_V8_PACK_CONTROLLER_SCHEMA,
  MAKER_V8_PACK_DOCUMENT_SCHEMA,
  MAKER_V8_PACK_DRAFT_SCHEMA,
  MAKER_V8_PACK_ERROR_VIEW_SCHEMA,
  MAKER_V8_PACK_EXPORT_SCHEMA,
  MAKER_V8_PACK_PREVIEW_SCHEMA,
  MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
  MAKER_V8_PACK_PUBLICATION_CERTIFICATION_SCHEMA,
  MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA,
  MakerV8PackControllerError,
  assertMakerV8PackDocumentV8,
  canonicalMakerV8PackJson,
  collectMakerV8PackDraftIssuesV8,
  createMakerV8PackControllerV8,
  createMakerV8PackMemoryPersistenceV8,
  makerV8PackErrorViewV8,
} from '../maker-v8-pack-controller.js';

const id = (number) => `0x${BigInt(number).toString(16).padStart(64, '0')}`;
const hash = (byte) => byte.repeat(32);
const digest = (byte) => toBase58(new Uint8Array(32).fill(byte));
const clone = (value) => structuredClone(value);

function ref(number) {
  return { objectId: id(number), version: String(number), digest: digest(number) };
}

function documentFixture({
  authorRole = 'MAKER_OWNER',
  policy = 'OPEN',
  protectedStyle = false,
  blobId = 'walrus-pack-style-1',
  styles = 1,
  parentRootId = id(1),
  parentVersion = '4',
  parentCommitment = hash('aa'),
} = {}) {
  const rootId = parentRootId;
  const rootVersion = parentVersion;
  const contentCommitment = parentCommitment;
  const owner = id(90);
  const author = authorRole === 'MAKER_OWNER' ? owner : id(91);
  const adminCapId = id(10);
  const catalogId = id(20);
  const productBindingCommitment = hash('bb');
  const callCapSetCommitment = hash('cc');
  const definitionRegistryId = id(2);
  const baseRegistryId = id(3);
  const packRegistryId = id(4);
  const admissionAuthorityId = id(5);
  const styleRows = Array.from({ length: styles }, (_, index) => ({
    sequence: String(index),
    partKey: 'accessory',
    itemKey: `moon_item_${index}`,
    styleKey: `moon_style_${index}`,
    layerTrackKey: 'accessory_front',
    colorChannelKey: 'accent',
    defaultSwatchKey: 'moonlit',
    asset: {
      assetId: `moon_asset_${index}`,
      mediaType: 'image/png',
      byteLength: 1024 + index,
      sha256: hash('dd'),
      blobId,
      contentCommitment: hash('ee'),
      protected: protectedStyle,
      sealBindingCommitment: protectedStyle ? hash('ff') : null,
    },
  }));
  return {
    schemaVersion: MAKER_V8_PACK_DOCUMENT_SCHEMA,
    protocolVersion: 8,
    metadata: {
      semanticPackId: 'moon_accessories',
      name: 'Moon Accessories',
      summary: 'Optional moonlit accessories for the approved Maker.',
      coverAssetId: styles ? 'moon_asset_0' : null,
    },
    author: { address: author, role: authorRole },
    admission: {
      makerApproval: 'REQUIRED',
      expectedPackRegistryRevision: '7',
    },
    access: { kind: 'FREE', priceAtomic: '0' },
    completion: {
      mode: 'UNLIMITED_FREE',
      priceAtomic: '0',
      freeQuotaPerWallet: '0',
      totalCap: '0',
    },
    styles: styleRows,
    bindings: {
      root: {
        objectRef: { ...ref(1), objectId: rootId },
        makerVersion: rootVersion,
        contentCommitment,
        lifecycle: 'ACTIVE',
        owner,
        adminCapId,
        controlEpoch: '2',
      },
      makerAdmin: {
        objectRef: { ...ref(10), objectId: adminCapId },
        protocolVersion: 8,
        rootId,
        owner,
        controlEpoch: '2',
      },
      definitionRegistry: {
        objectRef: { ...ref(2), objectId: definitionRegistryId },
        rootId,
        rootVersion,
        rootContentCommitment: contentCommitment,
        baseRegistryId,
        sealed: true,
        admissionCeiling: policy,
      },
      baseRegistry: {
        objectRef: { ...ref(3), objectId: baseRegistryId },
        rootId,
        makerVersion: rootVersion,
        rootContentCommitment: contentCommitment,
        sealed: true,
      },
      packRegistry: {
        objectRef: { ...ref(4), objectId: packRegistryId },
        rootId,
        rootVersion,
        rootContentCommitment: contentCommitment,
        definitionRegistryId,
        admissionAuthorityId,
        admissionPolicyCommitment: hash('13'),
        revision: '7',
      },
      admissionAuthority: {
        objectRef: { ...ref(5), objectId: admissionAuthorityId },
        rootId,
        rootVersion,
        rootContentCommitment: contentCommitment,
      },
      physicalRegistry: {
        objectRef: ref(6),
        catalogId,
        productBindingCommitment,
        callCapSetCommitment,
        rootId,
        makerVersion: rootVersion,
        rootContentCommitment: contentCommitment,
        baseRegistryId,
        revision: '0',
      },
      marketRegistry: {
        objectRef: ref(7),
        catalogId,
        productBindingCommitment,
        callCapSetCommitment,
        rootId,
        makerVersion: rootVersion,
        rootContentCommitment: contentCommitment,
        treasuryId: id(8),
        sealed: true,
        revision: '0',
      },
      releaseConfig: {
        objectRef: ref(9),
        catalogId,
        productBindingCommitment,
        callCapSetCommitment,
      },
    },
  };
}

function chainReadback(document, {
  lifecycle = 'ACTIVE',
  finalizedDigest = digest(30),
  packRegistryRevision = '8',
  owner = document.author.address,
  controlEpoch = '0',
} = {}) {
  const releaseId = id(101);
  return {
    schemaVersion: MAKER_V8_PACK_CHAIN_READBACK_SCHEMA,
    rootId: document.bindings.root.objectRef.objectId,
    packRegistryId: document.bindings.packRegistry.objectRef.objectId,
    semanticPackId: document.metadata.semanticPackId,
    release: {
      objectRef: ref(101),
      owner,
      controlEpoch,
    },
    adminCap: {
      objectRef: ref(102),
      releaseId,
      owner,
      controlEpoch,
    },
    treasury: {
      objectRef: ref(103),
      releaseId,
    },
    lifecycle,
    packRegistryRevision,
    finalizedDigest,
  };
}

function durableStore(order = []) {
  const memory = createMakerV8PackMemoryPersistenceV8();
  return {
    capabilities: { durable: true, atomicCas: true },
    async create(value) {
      order.push('draft:create');
      return memory.create(value);
    },
    async load(draftId) {
      order.push('draft:load');
      return memory.load(draftId);
    },
    async compareAndSwap(input) {
      order.push('draft:cas');
      return memory.compareAndSwap(input);
    },
  };
}

function harness({
  execution = { allowWalletSignature: false, allowBroadcast: false },
  store = null,
  lifecycleResult = null,
  includeLifecycle = true,
  lifecycleSchema = MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
} = {}) {
  const order = [];
  const persistence = store || durableStore(order);
  const authority = {};
  const calls = {
    compile: 0,
    certifyPublication: 0,
    publicationPrepare: 0,
    publicationResume: 0,
    lifecycleBuild: 0,
    lifecyclePrepare: 0,
    lifecycleRecover: 0,
    requestSignature: 0,
    execute: 0,
    broadcast: 0,
  };
  const compiler = {
    authority,
    async compilePack(input) {
      calls.compile += 1;
      order.push('compiler:exact');
      return {
        schemaVersion: MAKER_V8_PACK_COMPILER_RESULT_SCHEMA,
        authority,
        documentSha256: input.documentSha256,
        publicationInput: {
          schemaVersion: 'animacraft.maker-v8-pack-compiled-publication.v1',
          semanticPackId: input.document.metadata.semanticPackId,
          bindings: {
            rootId: input.document.bindings.root.objectRef.objectId,
            packRegistryId: input.document.bindings.packRegistry.objectRef.objectId,
          },
        },
      };
    },
    async certifyPackPublication({ draft, plan, documentSha256 }) {
      calls.certifyPublication += 1;
      order.push('compiler:certified-readback');
      return {
        schemaVersion: MAKER_V8_PACK_PUBLICATION_CERTIFICATION_SCHEMA,
        authority,
        attemptId: plan.attemptId,
        documentSha256,
        readback: chainReadback(draft.document),
      };
    },
  };
  const publication = {
    schemaVersion: MAKER_V8_PACK_PUBLICATION_CONTROLLER_SCHEMA,
    async prepare(request) {
      calls.publicationPrepare += 1;
      order.push('publication:durable-wal');
      assert.equal(request.kind, 'PACK');
      return {
        attemptId: 'pack-attempt-1',
        revision: 1,
        status: 'ACTIVE',
        current: { outcome: { status: 'READY' } },
        terminal: null,
      };
    },
    async resume(attemptId) {
      calls.publicationResume += 1;
      order.push('publication:query-old-digest-first');
      return {
        attemptId,
        revision: 9,
        status: 'COMPLETE',
        current: null,
        terminal: { status: 'COMPLETE' },
      };
    },
    async requestSignature() { calls.requestSignature += 1; throw new Error('must remain explicit'); },
    async recoverOutcome(attemptId) { return this.resume(attemptId); },
    async replayExact() { calls.broadcast += 1; throw new Error('must remain explicit'); },
  };
  let lastLifecycleRequest = null;
  const lifecycle = {
    schemaVersion: lifecycleSchema,
    execution: { ...execution },
    build(request) {
      calls.lifecycleBuild += 1;
      order.push('lifecycle:build');
      lastLifecycleRequest = request;
      return { request, brand: 'built-pack-action' };
    },
    async prepare(built) {
      calls.lifecyclePrepare += 1;
      order.push('lifecycle:prepare-exact-bytes');
      return { built, brand: 'prepared-pack-action' };
    },
    async recover(ticket) {
      calls.lifecycleRecover += 1;
      order.push('lifecycle:query-first-recover');
      if (lifecycleResult !== null) {
        return typeof lifecycleResult === 'function'
          ? lifecycleResult({ ticket, request: lastLifecycleRequest })
          : lifecycleResult;
      }
      const current = lastLifecycleRequest.pack.chain.lifecycle;
      const lifecycleAfter = lastLifecycleRequest.action === 'PAUSE' ? 'PAUSED'
        : lastLifecycleRequest.action === 'RESUME' ? 'ACTIVE'
          : lastLifecycleRequest.action === 'ARCHIVE' ? 'ARCHIVED' : current;
      return {
        schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
        status: 'FINALIZED_SUCCESS',
        recoveryId: ticket.recoveryId,
        digest: ticket.digest,
        readback: chainReadback(documentFixture(), {
          lifecycle: lifecycleAfter,
          finalizedDigest: ticket.digest,
        }),
      };
    },
    async requestSignature() { calls.requestSignature += 1; throw new Error('must remain explicit'); },
    async execute() { calls.execute += 1; throw new Error('must never be automatic'); },
  };
  let time = 100;
  const controller = createMakerV8PackControllerV8({
    persistence,
    compiler,
    publication,
    lifecycle: includeLifecycle ? lifecycle : null,
    execution,
    now: () => time++,
  });
  return { controller, persistence, compiler, publication, lifecycle, calls, order };
}

test('creates, edits, previews, validates and exports one exact local Pack draft', async () => {
  const { controller } = harness();
  const created = await controller.createPackDraft({
    draftId: 'moon-pack',
    document: documentFixture(),
    createdAt: 10,
  });
  assert.equal(created.schemaVersion, MAKER_V8_PACK_DRAFT_SCHEMA);
  assert.equal(created.revision, 1);
  assert.equal(created.publication.status, 'UNPREPARED');
  assert.equal(Object.isFrozen(created), true);
  assert.deepEqual(controller.validate(created), []);

  const edited = documentFixture();
  edited.metadata.summary = 'A revised local Pack description.';
  const saved = await controller.save({
    draftId: 'moon-pack',
    expectedRevision: 1,
    document: edited,
    updatedAt: 11,
  });
  assert.equal(saved.revision, 2);
  assert.equal(saved.document.metadata.summary, edited.metadata.summary);

  const preview = await controller.preview('moon-pack');
  assert.equal(preview.schemaVersion, MAKER_V8_PACK_PREVIEW_SCHEMA);
  assert.equal(preview.status, 'LOCAL_DRAFT');
  assert.equal(preview.styleCount, 1);
  assert.equal(preview.protectedStyleCount, 0);
  assert.equal(preview.styles[0].availability, 'LOCAL_READY');
  assert.equal(preview.styles[0].previewBlobId, 'walrus-pack-style-1');
  assert.equal(Object.hasOwn(preview, 'releaseId'), false, 'local preview must not invent chain state');

  const exported = await controller.export('moon-pack');
  assert.equal(exported.schemaVersion, MAKER_V8_PACK_EXPORT_SCHEMA);
  assert.equal(exported.disposition, 'LOCAL_DRAFT_ONLY');
  assert.match(exported.draftSha256, /^[0-9a-f]{64}$/);
  assert.equal(exported.draft.revision, 2);
  assert.equal(canonicalMakerV8PackJson(exported.draft), canonicalMakerV8PackJson(saved));
});

test('Pack edits cannot silently reparent a saved child project', async () => {
  const { controller } = harness();
  const original = await controller.createPackDraft({
    draftId: 'parent-bound-pack', document: documentFixture(), createdAt: 10,
  });
  for (const change of [
    { parentRootId: id(101) }, { parentVersion: '5' }, { parentCommitment: hash('ab') },
  ]) {
    const replacement = documentFixture(change);
    assertMakerV8PackDocumentV8(replacement);
    await assert.rejects(controller.save({ draftId: original.draftId,
      expectedRevision: 1, document: replacement, updatedAt: 11,
    }), { code: 'MAKER_V8_PACK_PARENT_IMMUTABLE' });
    assert.deepEqual(await controller.load(original.draftId), original);
  }
  const sameParent = clone(original.document);
  sameParent.metadata.name = 'Renamed child';
  sameParent.bindings.root.objectRef.version = '99';
  const saved = await controller.save({ draftId: original.draftId,
    expectedRevision: 1, document: sameParent, updatedAt: 11 });
  assert.equal(saved.revision, 2);
  assert.equal(saved.document.metadata.name, 'Renamed child');
});

test('protected Pack preview is fail-closed and never exposes its blob locator', async () => {
  const { controller } = harness();
  await controller.createPackDraft({
    draftId: 'protected-pack',
    document: documentFixture({ protectedStyle: true }),
    createdAt: 10,
  });
  const preview = await controller.preview('protected-pack');
  assert.equal(preview.protectedStyleCount, 1);
  assert.equal(preview.styles[0].availability, 'PROTECTED_LOCKED');
  assert.equal(preview.styles[0].previewBlobId, null);
  assert.doesNotMatch(JSON.stringify(preview), /walrus-pack-style-1/);
});

test('rejects non-v8 schemas, malformed refs, stale cross-bindings and invalid rows', () => {
  const wrongSchema = documentFixture();
  wrongSchema.schemaVersion = 'animacraft.expansion-pack.v7';
  assert.throws(
    () => assertMakerV8PackDocumentV8(wrongSchema),
    (error) => error.code === 'MAKER_V8_PACK_DOCUMENT_SCHEMA_INVALID',
  );

  const extra = documentFixture();
  extra.legacyPackageId = id(999);
  assert.throws(
    () => assertMakerV8PackDocumentV8(extra),
    (error) => error.code === 'MAKER_V8_PACK_FIELDS_INVALID',
  );

  const malformedRef = documentFixture();
  malformedRef.bindings.packRegistry.objectRef.objectId = '0x4';
  assert.throws(
    () => assertMakerV8PackDocumentV8(malformedRef),
    (error) => error.code === 'MAKER_V8_PACK_ID_INVALID',
  );

  const malformedDigest = documentFixture();
  malformedDigest.bindings.marketRegistry.objectRef.digest = '11111111111111111111111111111111';
  assert.throws(
    () => assertMakerV8PackDocumentV8(malformedDigest),
    (error) => error.code === 'MAKER_V8_PACK_DIGEST_INVALID',
  );

  const wrongRoot = documentFixture();
  wrongRoot.bindings.physicalRegistry.rootId = id(777);
  assert.throws(
    () => assertMakerV8PackDocumentV8(wrongRoot),
    (error) => error.code === 'MAKER_V8_PACK_ROOT_BINDING_MISMATCH',
  );

  const wrongProduct = documentFixture();
  wrongProduct.bindings.marketRegistry.productBindingCommitment = hash('99');
  assert.throws(
    () => assertMakerV8PackDocumentV8(wrongProduct),
    (error) => error.code === 'MAKER_V8_PACK_PRODUCT_BINDING_MISMATCH',
  );

  const wrongSequence = documentFixture();
  wrongSequence.styles[0].sequence = '1';
  const issues = collectMakerV8PackDraftIssuesV8({
    schemaVersion: MAKER_V8_PACK_DRAFT_SCHEMA,
    draftId: 'bad-pack',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    document: wrongSequence,
    publication: {
      attemptId: null, status: 'UNPREPARED', chain: null, updatedAt: null, lastError: null,
    },
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].schemaVersion, MAKER_V8_PACK_ERROR_VIEW_SCHEMA);
  assert.equal(issues[0].code, 'MAKER_V8_PACK_STYLE_SEQUENCE_INVALID');
});

test('enforces author admission, access and completion requirements exactly', () => {
  const missingApproval = documentFixture({ authorRole: 'THIRD_PARTY', policy: 'DISABLED' });
  missingApproval.admission.makerApproval = 'MISSING';
  assert.throws(
    () => assertMakerV8PackDocumentV8(missingApproval),
    (error) => error.code === 'MAKER_V8_PACK_MAKER_APPROVAL_REQUIRED',
  );

  const staleAdmin = documentFixture({ authorRole: 'THIRD_PARTY' });
  staleAdmin.bindings.makerAdmin.controlEpoch = '1';
  assert.throws(
    () => assertMakerV8PackDocumentV8(staleAdmin),
    (error) => error.code === 'MAKER_V8_PACK_MAKER_ADMIN_MISMATCH',
  );

  const thirdParty = documentFixture({ authorRole: 'THIRD_PARTY', policy: 'DISABLED' });
  assert.equal(assertMakerV8PackDocumentV8(thirdParty).admission.makerApproval, 'REQUIRED');

  const paidWithoutPrice = documentFixture();
  paidWithoutPrice.access.kind = 'PAID';
  assert.throws(
    () => assertMakerV8PackDocumentV8(paidWithoutPrice),
    (error) => error.code === 'MAKER_V8_PACK_ACCESS_POLICY_INVALID',
  );

  const badCompletion = documentFixture();
  badCompletion.completion.mode = 'FREE_QUOTA_THEN_PAID';
  badCompletion.completion.freeQuotaPerWallet = '2';
  assert.throws(
    () => assertMakerV8PackDocumentV8(badCompletion),
    (error) => error.code === 'MAKER_V8_PACK_COMPLETION_POLICY_INVALID',
  );

  const externalAttestationClaim = documentFixture({ authorRole: 'THIRD_PARTY' });
  externalAttestationClaim.admission.attestationCommitment = hash('12');
  assert.throws(
    () => assertMakerV8PackDocumentV8(externalAttestationClaim),
    (error) => error.code === 'MAKER_V8_PACK_FIELDS_INVALID',
  );
});

test('publication compiles exact input, writes the WAL boundary first, and never signs or broadcasts automatically', async () => {
  const { controller, calls, order } = harness();
  const created = await controller.createPackDraft({
    draftId: 'publish-pack',
    document: documentFixture(),
    createdAt: 10,
  });
  order.length = 0;
  const prepared = await controller.preparePublication({
    draftId: created.draftId,
    expectedRevision: created.revision,
    context: { source: 'focused-test' },
  });
  assert.equal(prepared.draft.publication.attemptId, 'pack-attempt-1');
  assert.equal(prepared.draft.publication.status, 'READY');
  assert.deepEqual(prepared.execution, { allowWalletSignature: false, allowBroadcast: false });
  assert.equal(calls.compile, 1);
  assert.equal(calls.publicationPrepare, 1);
  assert.equal(calls.requestSignature, 0);
  assert.equal(calls.broadcast, 0);
  assert.ok(order.indexOf('compiler:exact') < order.indexOf('publication:durable-wal'));
  assert.ok(order.indexOf('publication:durable-wal') < order.indexOf('draft:cas'));
  assert.equal(order.some((entry) => /rpc|query|broadcast|signature/i.test(entry)), false);

  await assert.rejects(
    controller.save({
      draftId: prepared.draft.draftId,
      expectedRevision: prepared.draft.revision,
      document: documentFixture(),
    }),
    (error) => error.code === 'MAKER_V8_PACK_DRAFT_LOCKED',
  );
});

test('publication recovery is query-first, cold-linked, and exposes finalized state', async () => {
  const { controller, calls, order } = harness();
  const created = await controller.createPackDraft({
    draftId: 'recovery-pack', document: documentFixture(), createdAt: 10,
  });
  const prepared = await controller.preparePublication({
    draftId: created.draftId, expectedRevision: created.revision,
  });
  order.length = 0;
  const resumed = await controller.resumePublication({
    draftId: prepared.draft.draftId,
    attemptId: prepared.draft.publication.attemptId,
    expectedRevision: prepared.draft.revision,
  });
  assert.equal(calls.publicationResume, 1);
  assert.equal(order[1], 'publication:query-old-digest-first', 'load precedes the delegated query-first resume');
  assert.ok(order.indexOf('publication:query-old-digest-first') < order.indexOf('draft:cas'));
  assert.equal(resumed.draft.publication.status, 'COMPLETE');
  assert.equal(resumed.draft.publication.chain.lifecycle, 'ACTIVE');
  assert.equal(resumed.draft.publication.chain.semanticPackId, 'moon_accessories');
  assert.equal(calls.certifyPublication, 1);
  assert.equal(resumed.draft.revision, 3);
  assert.equal(calls.requestSignature, 0);
  assert.equal(calls.broadcast, 0);
});

test('publication rejects non-durable storage, invalid compiler authority and visible recovery failures', async () => {
  const memory = createMakerV8PackMemoryPersistenceV8();
  const localHarness = harness({ store: memory });
  const local = await localHarness.controller.createPackDraft({
    draftId: 'memory-pack', document: documentFixture(), createdAt: 10,
  });
  await assert.rejects(
    localHarness.controller.preparePublication({ draftId: local.draftId, expectedRevision: 1 }),
    (error) => error.code === 'MAKER_V8_PACK_DURABLE_STORAGE_REQUIRED' && error.recoverable === false,
  );

  const invalid = harness();
  const draft = await invalid.controller.createPackDraft({
    draftId: 'compiler-pack', document: documentFixture(), createdAt: 10,
  });
  invalid.compiler.compilePack = async ({ documentSha256 }) => ({
    schemaVersion: MAKER_V8_PACK_COMPILER_RESULT_SCHEMA,
    authority: {},
    documentSha256,
    publicationInput: {},
  });
  await assert.rejects(
    invalid.controller.preparePublication({ draftId: draft.draftId, expectedRevision: 1 }),
    (error) => error.code === 'MAKER_V8_PACK_COMPILER_RESULT_INVALID',
  );

  const recovery = harness();
  const created = await recovery.controller.createPackDraft({
    draftId: 'failed-recovery', document: documentFixture(), createdAt: 10,
  });
  const prepared = await recovery.controller.preparePublication({
    draftId: created.draftId, expectedRevision: 1,
  });
  recovery.publication.resume = async () => {
    throw Object.assign(new Error('index unavailable'), { code: 'GRPC_READ_FAILED' });
  };
  await assert.rejects(
    recovery.controller.resumePublication({
      draftId: prepared.draft.draftId,
      expectedRevision: prepared.draft.revision,
    }),
    (error) => {
      const view = makerV8PackErrorViewV8(error);
      return error.code === 'MAKER_V8_PACK_PUBLICATION_RESUME_FAILED'
        && view.schemaVersion === MAKER_V8_PACK_ERROR_VIEW_SCHEMA
        && /Query-first/.test(view.message);
    },
  );
});

test('publication rejects missing durable assets, fake completion, uncertified completion and CAS drift', async () => {
  const assets = harness();
  const localOnlyDocument = documentFixture();
  localOnlyDocument.styles[0].asset.blobId = null;
  const localOnly = await assets.controller.createPackDraft({
    draftId: 'local-only-pack', document: localOnlyDocument, createdAt: 10,
  });
  assert.equal((await assets.controller.preview(localOnly.draftId)).styles[0].previewBlobId, null);
  await assert.rejects(
    assets.controller.preparePublication({ draftId: localOnly.draftId, expectedRevision: 1 }),
    (error) => error.code === 'MAKER_V8_PACK_ASSET_BLOB_REQUIRED',
  );
  assert.equal(assets.calls.compile, 0);

  const fake = harness();
  const fakeDraft = await fake.controller.createPackDraft({
    draftId: 'fake-complete-pack', document: documentFixture(), createdAt: 10,
  });
  fake.publication.prepare = async () => ({
    attemptId: 'fake-complete-attempt',
    revision: 1,
    status: 'COMPLETE',
    current: null,
    terminal: { status: 'COMPLETE' },
  });
  await assert.rejects(
    fake.controller.preparePublication({ draftId: fakeDraft.draftId, expectedRevision: 1 }),
    (error) => error.code === 'MAKER_V8_PACK_PUBLICATION_PREPARE_RESULT_INVALID',
  );
  assert.equal((await fake.controller.load(fakeDraft.draftId)).publication.status, 'UNPREPARED');

  const uncertified = harness();
  const draft = await uncertified.controller.createPackDraft({
    draftId: 'uncertified-pack', document: documentFixture(), createdAt: 10,
  });
  const prepared = await uncertified.controller.preparePublication({
    draftId: draft.draftId, expectedRevision: 1,
  });
  delete uncertified.compiler.certifyPackPublication;
  await assert.rejects(
    uncertified.controller.resumePublication({
      draftId: draft.draftId,
      expectedRevision: prepared.draft.revision,
    }),
    (error) => error.code === 'MAKER_V8_PACK_BLOCKED_COMPILER' && error.recoverable === false,
  );
  assert.equal((await uncertified.controller.load(draft.draftId)).publication.status, 'READY');

  const base = durableStore();
  const driftStore = {
    ...base,
    async compareAndSwap(input) {
      const written = await base.compareAndSwap(input);
      const drifted = clone(written);
      drifted.document.metadata.summary = 'tampered persistence return';
      return drifted;
    },
  };
  const drift = harness({ store: driftStore });
  const driftDraft = await drift.controller.createPackDraft({
    draftId: 'cas-drift-pack', document: documentFixture(), createdAt: 10,
  });
  const edited = documentFixture();
  edited.metadata.summary = 'exact requested successor';
  await assert.rejects(
    drift.controller.save({
      draftId: driftDraft.draftId,
      expectedRevision: 1,
      document: edited,
    }),
    (error) => error.code === 'MAKER_V8_PACK_CAS_WRITE_DRIFT',
  );
});

test('execution gates are fail-closed and lifecycle delegates only build/prepare/query-first recover', async () => {
  assert.throws(
    () => harness({ execution: { allowWalletSignature: true, allowBroadcast: false } }),
    (error) => error.code === 'MAKER_V8_PACK_EXECUTION_GATE_INVALID',
  );
  assert.throws(
    () => harness({ lifecycleSchema: 'animacraft.maker-v8-lifecycle-controller.v1' }),
    (error) => error.code === 'MAKER_V8_PACK_LIFECYCLE_BOUNDARY_INVALID',
  );

  const blocked = harness({ includeLifecycle: false });
  const blockedDraft = await blocked.controller.createPackDraft({
    draftId: 'lifecycle-blocked', document: documentFixture(), createdAt: 10,
  });
  await assert.rejects(
    blocked.controller.performLifecycle({ draftId: blockedDraft.draftId, action: 'PAUSE' }),
    (error) => error.code === 'MAKER_V8_PACK_BLOCKED_COMPILER' && error.recoverable === false,
  );

  const disabled = harness();
  const local = await disabled.controller.createPackDraft({
    draftId: 'lifecycle-disabled', document: documentFixture(), createdAt: 10,
  });
  await assert.rejects(
    disabled.controller.performLifecycle({ draftId: local.draftId, action: 'PAUSE' }),
    (error) => error.code === 'MAKER_V8_PACK_EXECUTION_DISABLED',
  );
  assert.equal(disabled.calls.lifecycleBuild, 0);

  const enabled = harness({ execution: { allowWalletSignature: true, allowBroadcast: true } });
  const created = await enabled.controller.createPackDraft({
    draftId: 'lifecycle-pack', document: documentFixture(), createdAt: 10,
  });
  const preparedPublication = await enabled.controller.preparePublication({
    draftId: created.draftId, expectedRevision: 1,
  });
  const complete = await enabled.controller.resumePublication({
    draftId: created.draftId,
    expectedRevision: preparedPublication.draft.revision,
  });
  const prepared = await enabled.controller.performLifecycle({
    draftId: created.draftId,
    expectedRevision: complete.draft.revision,
    action: 'PAUSE',
    request: { wallet: id(90) },
  });
  assert.equal(prepared.stage, 'PREPARED');
  assert.equal(enabled.calls.lifecycleBuild, 1);
  assert.equal(enabled.calls.lifecyclePrepare, 1);
  assert.equal(enabled.calls.requestSignature, 0);
  assert.equal(enabled.calls.execute, 0);

  const recovered = await enabled.controller.performLifecycle({
    draftId: created.draftId,
    expectedRevision: complete.draft.revision,
    action: 'PAUSE',
    stage: 'RECOVER',
    ticket: {
      schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
      recoveryId: 'pack-life-1',
      digest: digest(31),
    },
  });
  assert.equal(recovered.stage, 'FINALIZED_SUCCESS');
  assert.equal(recovered.draft.publication.chain.lifecycle, 'PAUSED');
  assert.equal(enabled.calls.lifecycleRecover, 1);
  assert.equal(enabled.calls.requestSignature, 0);
  assert.equal(enabled.calls.execute, 0);

  await assert.rejects(
    enabled.controller.performLifecycle({
      draftId: created.draftId,
      expectedRevision: recovered.draft.revision,
      action: 'PAUSE',
    }),
    (error) => error.code === 'MAKER_V8_PACK_LIFECYCLE_TRANSITION_INVALID',
  );
});

test('Pack governance persists certified control transfer and admission revocation without rewriting authored content', async () => {
  const recipient = id(91);
  const transferred = harness({
    execution: { allowWalletSignature: true, allowBroadcast: true },
    lifecycleResult: ({ ticket, request }) => ({
      schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
      status: 'FINALIZED_SUCCESS',
      recoveryId: ticket.recoveryId,
      digest: ticket.digest,
      readback: chainReadback(documentFixture(), {
        owner: request.recipient,
        controlEpoch: '1',
        finalizedDigest: ticket.digest,
      }),
    }),
  });
  const created = await transferred.controller.createPackDraft({
    draftId: 'pack-control-transfer', document: documentFixture(), createdAt: 10,
  });
  const preparedPublication = await transferred.controller.preparePublication({
    draftId: created.draftId, expectedRevision: created.revision,
  });
  const published = await transferred.controller.resumePublication({
    draftId: created.draftId, expectedRevision: preparedPublication.draft.revision,
  });
  const preparedTransfer = await transferred.controller.performLifecycle({
    draftId: created.draftId,
    expectedRevision: published.draft.revision,
    action: 'TRANSFER_CONTROL',
    request: { recipient },
  });
  assert.equal(preparedTransfer.prepared.built.request.pack.bindings.root.objectRef.objectId,
    created.document.bindings.root.objectRef.objectId);
  const transferResult = await transferred.controller.performLifecycle({
    draftId: created.draftId,
    expectedRevision: published.draft.revision,
    action: 'TRANSFER_CONTROL',
    stage: 'RECOVER',
    ticket: {
      schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
      recoveryId: 'pack-transfer-1',
      digest: digest(40),
    },
  });
  assert.equal(transferResult.draft.document.author.address, created.document.author.address,
    'immutable authored content is not rewritten by control transfer');
  assert.equal(transferResult.draft.publication.chain.release.owner, recipient);
  assert.equal(transferResult.draft.publication.chain.adminCap.owner, recipient);

  const revoked = harness({
    execution: { allowWalletSignature: true, allowBroadcast: true },
    lifecycleResult: ({ ticket }) => ({
      schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
      status: 'FINALIZED_SUCCESS',
      recoveryId: ticket.recoveryId,
      digest: ticket.digest,
      readback: chainReadback(documentFixture(), {
        packRegistryRevision: '9',
        finalizedDigest: ticket.digest,
      }),
    }),
  });
  const revokeDraft = await revoked.controller.createPackDraft({
    draftId: 'pack-admission-revoke', document: documentFixture(), createdAt: 10,
  });
  const revokePreparedPublication = await revoked.controller.preparePublication({
    draftId: revokeDraft.draftId, expectedRevision: revokeDraft.revision,
  });
  const revokePublished = await revoked.controller.resumePublication({
    draftId: revokeDraft.draftId, expectedRevision: revokePreparedPublication.draft.revision,
  });
  await revoked.controller.performLifecycle({
    draftId: revokeDraft.draftId,
    expectedRevision: revokePublished.draft.revision,
    action: 'REVOKE_ADMISSION',
    request: {},
  });
  const revokeResult = await revoked.controller.performLifecycle({
    draftId: revokeDraft.draftId,
    expectedRevision: revokePublished.draft.revision,
    action: 'REVOKE_ADMISSION',
    stage: 'RECOVER',
    ticket: {
      schemaVersion: MAKER_V8_PACK_LIFECYCLE_CONTROLLER_SCHEMA,
      recoveryId: 'pack-revoke-1',
      digest: digest(41),
    },
  });
  assert.equal(revokeResult.draft.publication.chain.packRegistryRevision, '9');
  assert.equal(revokeResult.draft.publication.chain.lifecycle, 'ACTIVE');
});

test('source contains no legacy Pack dependency, JSON-RPC, signing, broadcast, or transport shortcut', async () => {
  const source = await readFile(new URL('../maker-v8-pack-controller.js', import.meta.url), 'utf8');
  assert.equal(MAKER_V8_PACK_CONTROLLER_SCHEMA, 'animacraft.maker-v8-pack-controller.v1');
  assert.doesNotMatch(source, /^\s*import\s/m, 'Pack controller is an injected orchestration boundary');
  assert.doesNotMatch(source, /expansion-pack|pack-v[1-7]|chain-runtime|commerce-v[1-7]/i);
  assert.doesNotMatch(source, /json-?rpc|suix_|sui_get|fetch\s*\(|XMLHttpRequest|WebSocket/i);
  assert.doesNotMatch(source, /await\s+lifecycle\.requestSignature\s*\(|await\s+lifecycle\.execute\s*\(|broadcastExactTransaction\s*\(/);
  assert.match(source, /publication\.prepare\(/);
  assert.match(source, /publication\.resume\(selectedAttemptId\)/);
  assert.match(source, /query-first/i);

  const visible = makerV8PackErrorViewV8(new MakerV8PackControllerError(
    'TEST', 'PACK_VISIBLE', 'Visible Pack error.', { ignored: true }, false,
  ));
  assert.deepEqual(visible, {
    schemaVersion: MAKER_V8_PACK_ERROR_VIEW_SCHEMA,
    code: 'PACK_VISIBLE',
    message: 'Visible Pack error.',
    recoverable: false,
  });
});
