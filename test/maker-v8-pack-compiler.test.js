import assert from 'node:assert/strict';
import test from 'node:test';

import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64, fromBase64, deriveDynamicFieldID } from '@mysten/sui/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { EncryptedObject } from '@mysten/seal';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  makerV8AttestedPackageTuple,
  makerV8ChainTypes,
} from '../maker-v8-chain.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MAKER_V8_PACK_CHECKPOINT_SCHEMA,
  assertMakerV8PackCompilerTransactionV8,
  assertMakerV8PackSignedArtifactV8,
  createMakerV8PackCompilerV8,
  deriveMakerV8PackCommitmentsV8,
} from '../maker-v8-pack-compiler.js';
import {
  MAKER_V8_PACK_DOCUMENT_SCHEMA,
  MAKER_V8_PACK_DRAFT_SCHEMA,
  canonicalMakerV8PackJson,
} from '../maker-v8-pack-controller.js';
import { createMakerV8PackTransportV8, buildMakerV8PackManifestV8 } from '../maker-v8-pack-transport.js';
import {
  MAKER_V8_PROTECTED_ASSET_SCHEMA,
  MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
  deriveMakerV8ProtectedAssetSealIdentityV8,
} from '../maker-v8-protected-transport.js';
import {
  createMakerV8PackPublicationBoundaryV8,
  createMakerV8PackReadbackV8,
} from '../maker-v8-pack-publication-adapters.js';
import { MAKER_V8_SUI_MAINNET_GENESIS_DIGEST } from '../maker-v8-sui-grpc.js';
import { attestFixtureRuntime } from './fixtures/maker-v8-runtime-attestation.js';
import { createCreatorCharacterStarter } from '../maker-v8-creator-structure.js';
import { packPublicationAuthoringContent } from '../maker-v8-pack-authoring.js';
import { createMakerV8PackPublicationControllerV8, createMakerV8PackPublicationMemoryPersistenceV8 } from '../maker-v8-pack-publication.js';
import { compileMakerV8PackDefinitionRowsV8, planMakerV8PackDefinitionRegistrationV8 } from '../maker-v8-pack-definitions-compiler.js';
import { MAKER_V8_PACK_DEFINITIONS_BCS, MAKER_V8_PACK_DEFINITIONS_DRAFT_BCS,
  MAKER_V8_COLOR_CHANNEL_DRAFT_BCS_V2 } from '../maker-v8-pack-definition-wire.js';

const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = (value) => toBase58(new Uint8Array(32).fill(value));
const hex = (value) => value.repeat(64);
const bytes = new TextEncoder().encode('exact-pack-style-image');
const assetSha256 = [...sha256(bytes)]
  .map((value) => value.toString(16).padStart(2, '0')).join('');

function ref(value) {
  return { objectId: id(value), version: String(value), digest: digest(value) };
}

function runtimeFixture() {
  const roles = {};
  ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .forEach((role, index) => {
      roles[role] = {
        typeOriginPackageId: id(index * 2 + 1),
        callablePackageId: id(index * 2 + 1),
      };
    });
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: id(20),
    protocolConfigId: id(21),
    protocolTreasuryId: id(22),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: {
      seal: id(23), runtime: id(24), output: id(25), physical: id(26),
      market: id(27), release: id(28),
    },
    makerBindings: [],
  };
}

function documentFixture(styles = 2, owner = id(90)) {
  const rootId = id(101);
  const rootContentCommitment = 'aa'.repeat(32);
  const definitionRegistryId = id(102);
  const baseRegistryId = id(103);
  const packRegistryId = id(104);
  const admissionAuthorityId = id(105);
  const adminCapId = id(106);
  return {
    schemaVersion: MAKER_V8_PACK_DOCUMENT_SCHEMA,
    protocolVersion: 8,
    metadata: {
      semanticPackId: 'moon_accessories',
      name: 'Moon Accessories',
      summary: 'Fresh-v8 exact Pack publication compiler fixture.',
      coverAssetId: 'moon_asset_0',
    },
    author: { address: owner, role: 'MAKER_OWNER' },
    admission: { makerApproval: 'REQUIRED', expectedPackRegistryRevision: '7' },
    access: { kind: 'FREE', priceAtomic: '0' },
    completion: {
      mode: 'UNLIMITED_FREE', priceAtomic: '0', freeQuotaPerWallet: '0', totalCap: '0',
    },
    styles: Array.from({ length: styles }, (_, index) => ({
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
        byteLength: bytes.length,
        sha256: assetSha256,
        blobId: `walrus-style-${index}`,
        contentCommitment: assetSha256,
        protected: false,
        sealBindingCommitment: null,
      },
    })),
    bindings: {
      root: {
        objectRef: { ...ref(101), objectId: rootId },
        makerVersion: '4', contentCommitment: rootContentCommitment,
        lifecycle: 'ACTIVE', owner, adminCapId, controlEpoch: '2',
      },
      makerAdmin: {
        objectRef: { ...ref(106), objectId: adminCapId },
        protocolVersion: 8, rootId, owner, controlEpoch: '2',
      },
      definitionRegistry: {
        objectRef: { ...ref(102), objectId: definitionRegistryId },
        rootId, rootVersion: '4', rootContentCommitment,
        baseRegistryId, sealed: true, admissionCeiling: 'OPEN',
      },
      baseRegistry: {
        objectRef: { ...ref(103), objectId: baseRegistryId },
        rootId, makerVersion: '4', rootContentCommitment, sealed: true,
      },
      packRegistry: {
        objectRef: { ...ref(104), objectId: packRegistryId },
        rootId, rootVersion: '4', rootContentCommitment,
        definitionRegistryId, admissionAuthorityId,
        admissionPolicyCommitment: '13'.repeat(32), revision: '7',
      },
      admissionAuthority: {
        objectRef: { ...ref(105), objectId: admissionAuthorityId },
        rootId, rootVersion: '4', rootContentCommitment,
      },
      physicalRegistry: {
        objectRef: ref(107), catalogId: id(20),
        productBindingCommitment: 'bb'.repeat(32), callCapSetCommitment: 'cc'.repeat(32),
        rootId, makerVersion: '4', rootContentCommitment, baseRegistryId, revision: '0',
      },
      marketRegistry: {
        objectRef: ref(108), catalogId: id(20),
        productBindingCommitment: 'bb'.repeat(32), callCapSetCommitment: 'cc'.repeat(32),
        rootId, makerVersion: '4', rootContentCommitment, treasuryId: id(109),
        sealed: true, revision: '0',
      },
      releaseConfig: {
        objectRef: ref(110), catalogId: id(20),
        productBindingCommitment: 'bb'.repeat(32), callCapSetCommitment: 'cc'.repeat(32),
      },
    },
  };
}

async function preparedTransport(document) {
  const transport = createMakerV8PackTransportV8({
    publisher: {
      async load() { return null; },
      async prepare({ mediaType }) {
        return { status: 'COMPLETE', blobId: mediaType === 'application/json' ? 'walrus-manifest' : 'walrus-style' };
      },
      async requestSignature() { throw new Error('not used'); },
      async resume() { throw new Error('not used'); },
    },
  });
  const draft = {
    schemaVersion: MAKER_V8_PACK_DRAFT_SCHEMA,
    draftId: 'moon-pack', revision: 1, createdAt: 1, updatedAt: 1,
    document: structuredClone(document),
    publication: { attemptId: null, status: 'UNPREPARED', chain: null, updatedAt: null, lastError: null },
  };
  const assets = document.styles.map((style, index) => ({
    schemaVersion: 'animacraft.maker-v8-pack-asset.v1',
    draftId: draft.draftId,
    assetId: style.asset.assetId,
    revision: 1,
    createdAt: index + 1,
    updatedAt: index + 1,
    mediaType: style.asset.mediaType,
    bytesBase64: toBase64(bytes),
    byteLength: bytes.length,
    sha256: assetSha256,
  }));
  const view = await transport.prepare({ draft, assets, owner: document.author.address });
  assert.equal(view.status, 'PUBLICATION_TRANSPORT_READY');
  return view.prepared;
}

function authority(document) {
  return {
    root: { kind: 'shared', objectId: document.bindings.root.objectRef.objectId, initialSharedVersion: '1' },
    definitionRegistry: { kind: 'shared', objectId: document.bindings.definitionRegistry.objectRef.objectId, initialSharedVersion: '1' },
    baseRegistry: { kind: 'shared', objectId: document.bindings.baseRegistry.objectRef.objectId, initialSharedVersion: '1' },
    packRegistry: { kind: 'shared', objectId: document.bindings.packRegistry.objectRef.objectId, initialSharedVersion: '1' },
    makerAdmin: { kind: 'owned', ...document.bindings.makerAdmin.objectRef },
    admissionAuthority: { kind: 'owned', ...document.bindings.admissionAuthority.objectRef },
  };
}

function protectionAuthority(document, overrides = {}) {
  const registryState = { registryId: id(120), rootId: document.bindings.root.objectRef.objectId,
    makerVersion: document.bindings.root.makerVersion, rootContentCommitment: document.bindings.root.contentCommitment,
    policyId: id(23), baseCount: '2', packCount: '3', completeCount: '1',
    baseCommitment: 'ab'.repeat(32), packCommitment: 'cd'.repeat(32), completeCommitment: 'ef'.repeat(32),
    revision: '3', runtimeRevision: '3', sealed: true };
  const commitment = deriveMakerV8SealRuntimeRegistryCommitmentV2(registryState);
  return {
    protocolConfig: { kind: 'shared', objectId: id(21), initialSharedVersion: '1' },
    catalog: { kind: 'shared', objectId: id(20), initialSharedVersion: '1' },
    releaseConfig: {
      kind: 'shared',
      objectId: document.bindings.releaseConfig.objectRef.objectId,
      initialSharedVersion: '1',
    },
    sealPolicy: { kind: 'shared', objectId: id(23), initialSharedVersion: '1' },
    sealRegistry: { kind: 'shared', objectId: id(120), initialSharedVersion: '1' },
    catalogId: id(20),
    productBindingCommitment: document.bindings.releaseConfig.productBindingCommitment,
    policyCommitment: 'dd'.repeat(32),
    registryCommitment: commitment,
    runtimeRevision: '3',
    runtimeCommitment: commitment, registryState,
    sealPolicyConfigId: id(23),
    ...overrides,
  };
}

function sealCiphertext(identity) {
  const derived = deriveMakerV8ProtectedAssetSealIdentityV8(identity);
  const bytes = EncryptedObject.serialize({
    version: 0,
    packageId: derived.packageId,
    id: derived.sealId,
    services: [[id(90), 1]],
    threshold: 1,
    encryptedShares: {
      BonehFranklinBLS12381: {
        nonce: new Uint8Array(96).fill(7),
        encryptedShares: [new Uint8Array(32).fill(8)],
        encryptedRandomness: new Uint8Array(32).fill(9),
      },
    },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array([5, 6, 7]), aad: Buffer.from(derived.aadBase64, 'base64') } },
  }).toBytes();
  return { derived, bytes };
}

async function preparedProtectedTransport(document, compiler, expectedSealPackageId = null) {
  const uploads = new Map();
  const content = new Map();
  const transport = createMakerV8PackTransportV8({
    compiler,
    protector: {
      async protectAsset(request) {
        if (expectedSealPackageId) assert.equal(request.identity.releasePackageId, expectedSealPackageId);
        const encrypted = sealCiphertext(request.identity);
        return {
          schemaVersion: MAKER_V8_PROTECTED_ASSET_SCHEMA,
          mediaType: MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE,
          bytesBase64: toBase64(encrypted.bytes),
          byteLength: encrypted.bytes.length,
          sha256: [...sha256(encrypted.bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''),
          packageId: encrypted.derived.packageId,
          sealId: encrypted.derived.sealId,
          aadSha256: encrypted.derived.aadSha256,
        };
      },
    },
    publisher: {
      async load(uploadId) { return uploads.get(uploadId) ?? null; },
      async loadContent(uploadId) { return content.get(uploadId) ?? null; },
      async prepare(input) {
        const raw = Buffer.from(input.bytesBase64, 'base64');
        content.set(input.uploadId, {
          uploadId: input.uploadId,
          owner: document.author.address,
          mediaType: input.mediaType,
          bytesBase64: input.bytesBase64,
          byteLength: raw.length,
          byteSha256: [...sha256(raw)].map((value) => value.toString(16).padStart(2, '0')).join(''),
        });
        const upload = {
          status: 'COMPLETE',
          uploadId: input.uploadId,
          blobId: input.mediaType === 'application/json' ? 'protected-pack-manifest' : 'protected-pack-ciphertext',
        };
        uploads.set(input.uploadId, upload);
        return upload;
      },
      async requestSignature() { throw new Error('not used'); },
      async resume() { throw new Error('not used'); },
    },
  });
  const draftDocument = structuredClone(document);
  draftDocument.styles[0].asset.protected = true;
  draftDocument.styles[0].asset.blobId = null;
  draftDocument.styles[0].asset.sealBindingCommitment = null;
  const draft = {
    schemaVersion: MAKER_V8_PACK_DRAFT_SCHEMA,
    draftId: 'protected-moon-pack', revision: 1, createdAt: 1, updatedAt: 1,
    document: draftDocument,
    publication: { attemptId: null, status: 'UNPREPARED', chain: null, updatedAt: null, lastError: null },
  };
  const view = await transport.prepare({
    draft,
    owner: draftDocument.author.address,
    assets: [{
      schemaVersion: 'animacraft.maker-v8-pack-asset.v1',
      draftId: draft.draftId,
      assetId: draftDocument.styles[0].asset.assetId,
      revision: 1, createdAt: 1, updatedAt: 1,
      mediaType: 'image/png',
      bytesBase64: toBase64(bytes),
      byteLength: bytes.length,
      sha256: assetSha256,
    }],
  });
  assert.equal(view.status, 'PUBLICATION_TRANSPORT_READY');
  return { draft, prepared: view.prepared };
}

function checkpoint(compiled, descriptor, stage, endStyle) {
  return {
    schemaVersion: MAKER_V8_PACK_CHECKPOINT_SCHEMA,
    ordinal: descriptor.ordinal,
    stage,
    digest: digest(200 + descriptor.ordinal),
    kindSha256: descriptor.kindSha256,
    startStyle: descriptor.startStyle,
    endStyle,
    release: {
      objectRef: ref(201),
      input: { kind: 'shared', objectId: id(201), initialSharedVersion: '1' },
    },
    adminCap: {
      objectRef: ref(202),
      input: { kind: 'owned', ...ref(202) },
    },
    treasury: {
      objectRef: ref(203),
      input: { kind: 'shared', objectId: id(203), initialSharedVersion: '1' },
    },
    observedStyleCount: String(endStyle),
    rollingStyleCommitment: compiled.rollingCommitments[endStyle],
    packRegistryRevision: stage === 'FINALIZE' ? '8' : '7',
  };
}

async function authoredTransportFixture(owner = id(90), largePalette = false) {
  const runtime = await attestFixtureRuntime(runtimeFixture());
  // Offline certified-transport fixture; the real upload entry stays blocked.
  const prepared = structuredClone(await preparedTransport(documentFixture(1, owner)));
  const document = prepared.document;
  const parent = createCreatorCharacterStarter();
  parent.assets.push({ id: 'base-image', kind: 'layer', mediaType: 'image/png', byteLength: 3 });
  for (const part of parent.parts) part.items[0].styles[0].assetId = 'base-image';
  document.authoringParent = { draft: { document: parent }, assets: [
    { assetId: 'base-image', kind: 'layer', mediaType: 'image/png', byteLength: 3, sha256: '11'.repeat(32) },
  ] };
  document.authoring = structuredClone(parent);
  const own = { ...structuredClone(parent.parts[0]), key: 'own', label: 'Own', menuOrder: 99, renderOrder: 99 };
  document.authoring.parts.push(own);
  document.authoring.tracks.push({ key: 'overlay', label: 'Overlay', renderOrder: 99, locked: false });
  document.authoring.colors.push({ key: 'tint', label: 'Tint', defaultSwatchKey: 'red',
    swatches: [{ key: 'red', label: 'Red', rgba: '#ff0000ff', stops: [] }] });
  if (largePalette) for (let i = 0; i < 200; i++) document.authoring.colors.at(-1).swatches
    .push({ key: `shade-${i}`, label: 'x'.repeat(120), rgba: '#ff0000ff', stops: [] });
  Object.assign(document.styles[0], { partKey: 'own', itemKey: own.items[0].key,
    styleKey: own.items[0].styles[0].key, layerTrackKey: 'overlay', colorChannelKey: 'tint', defaultSwatchKey: 'red' });
  const encoded = buildMakerV8PackManifestV8(document);
  const manifest = encoded.manifest;
  Object.assign(prepared.manifest, { bytesBase64: encoded.bytesBase64, byteLength: encoded.byteLength,
    sha256: encoded.sha256, contentCommitment: encoded.contentCommitment });
  const documentSha256 = Buffer.from(sha256(new TextEncoder().encode(canonicalMakerV8PackJson(document)))).toString('hex');
  return { runtime, prepared, document, documentSha256, manifest };
}

test('authored compilation and fresh successors require exact independently certified parent, but query-first rehydration stays offline', async () => {
  const { runtime, prepared, document, documentSha256, manifest } = await authoredTransportFixture();
  const input = { draft: { document }, document, documentSha256, context: { transport: prepared } };
  const calls = [];
  let published = structuredClone(manifest.content.authoring.parent), unavailable = false;
  const dependencies = { runtime, loadAuthority: async () => { calls.push('authority'); return authority(document); },
    readback: { async certifyStage() { throw new Error('unused'); } } };
  const missing = createMakerV8PackCompilerV8(dependencies);
  await assert.rejects(missing.compilePack(input), { code: 'MAKER_V8_PACK_PARENT_RESOLVER_REQUIRED' });
  assert.deepEqual(calls, [], 'missing certified parent must fail before live authority or transaction preparation');
  const compiler = createMakerV8PackCompilerV8({ ...dependencies, async loadParent(binding) {
    calls.push('parent');
    assert.deepEqual(binding, { rootId: document.bindings.root.objectRef.objectId,
      rootVersion: document.bindings.root.makerVersion, rootContentCommitment: document.bindings.root.contentCommitment });
    if (unavailable) throw new Error('parent reader offline');
    return published;
  } });
  for (const change of [parent => { parent.document.metadata.name = 'forged parent'; },
    parent => { parent.assets[0].sha256 = '99'.repeat(32); }, parent => { parent.assets = []; }]) {
    published = structuredClone(manifest.content.authoring.parent); change(published);
    await assert.rejects(compiler.compilePack(input), { code: 'MAKER_V8_PACK_PARENT_CONTENT_MISMATCH' });
  }
  published = structuredClone(manifest.content.authoring.parent);
  const compiled = await compiler.compilePack(input);
  const request = { schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1', kind: 'PACK', draftId: 'parent-checked',
    draftRevision: 1, documentSha256, publicationInput: compiled.publicationInput };
  const initial = await compiler.prepare(request);
  const head = checkpoint(compiled.publicationInput, initial.descriptor, 'INIT', 0);
  published.assets[0].sha256 = '99'.repeat(32);
  await assert.rejects(compiler.prepare(request), { code: 'MAKER_V8_PACK_PARENT_CONTENT_MISMATCH' });
  await assert.rejects(compiler.prepareSuccessor({ plan: { immutable: { request } }, head }),
    { code: 'MAKER_V8_PACK_PARENT_CONTENT_MISMATCH' });
  unavailable = true;
  await assert.rejects(compiler.compilePack(input), /parent reader offline/);
  const count = calls.length;
  const rebuilt = await compiler.rehydrate({ plan: { immutable: { request }, head: null,
    current: { descriptor: initial.descriptor } }, purpose: 'FINALIZED_RECOVERY', requireFreshAuthority: false });
  assert.deepEqual(rebuilt.descriptor, initial.descriptor);
  assert.equal(calls.length, count, 'recover already-signed history before requesting fresh external parent state');
});

test('main compiler rebuilds authored definition cursors and scoped Styles while execution remains blocked', async () => {
  const { runtime, prepared, document, documentSha256, manifest } = await authoredTransportFixture();
  const makeCompiler = () => createMakerV8PackCompilerV8({ runtime,
    loadParent: async () => structuredClone(manifest.content.authoring.parent),
    loadAuthority: async () => authority(document), readback: { async certifyStage({ compiled, descriptor, definitions }) {
      if (descriptor.stage.startsWith('DEFINITIONS_')) {
        assert.equal(`DEFINITIONS_${definitions.plan.steps[descriptor.ordinal - 1].stage}`, descriptor.stage);
        assert.equal(definitions.value.rows.parts[0].key, 'own');
        assert.equal(definitions.options.releaseRef.objectId, id(201));
      } else assert.equal(definitions, null);
      return { checkpoint: checkpoint(compiled, descriptor, descriptor.stage, descriptor.endStyle),
        chain: descriptor.stage === 'FINALIZE' ? { releaseId: id(201) } : null };
    } } });
  let compiler = makeCompiler();
  const result = await compiler.compilePack({ draft: { document }, document, documentSha256, context: { transport: prepared } });
  assert.deepEqual(deriveMakerV8PackCommitmentsV8(document, manifest.contentCommitment).styles[0].definition_sources,
    { part: 2, track: 2, color: 2 });
  const request = { schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1', kind: 'PACK',
    draftId: 'authored', draftRevision: 1, documentSha256, publicationInput: result.publicationInput };
  let built = await compiler.prepare(request), head = null;
  const stages = [];
  for (let count = 0; count < 20; count++) {
    stages.push(built.descriptor.stage);
    const plan = { immutable: { request }, head, current: { descriptor: built.descriptor } };
    compiler = makeCompiler();
    const rebuilt = await compiler.rehydrate({ plan });
    assert.deepEqual(rebuilt.descriptor, built.descriptor, 'fresh compiler must reconstruct the exact cursor');
    await assert.rejects(compiler.rehydrate({ plan, purpose: 'REQUEST_SIGNATURE', requireFreshAuthority: true }),
      { code: 'MAKER_V8_PACK_AUTHORING_NOT_PUBLISHABLE' });
    assert.throws(() => assertMakerV8PackCompilerTransactionV8(compiler.authority, rebuilt.transaction),
      { code: 'MAKER_V8_PACK_AUTHORING_NOT_PUBLISHABLE' });
    const certified = await compiler.certifyFinalized({ plan, query: { status: 'FINALIZED_SUCCESS' },
      artifact: { digest: digest(200 + built.descriptor.ordinal) } });
    assert.equal(certified.complete, built.descriptor.stage === 'FINALIZE');
    assert.equal(certified.checkpoint.stage, built.descriptor.stage);
    if (built.descriptor.stage === 'APPEND') {
      const call = rebuilt.transaction.getData().commands.find(row => row.MoveCall?.function === 'new_pack_style_definition_sources_v8').MoveCall;
      const inputs = rebuilt.transaction.getData().inputs;
      assert.deepEqual(call.arguments.map(arg => Buffer.from(inputs[arg.Input].Pure.bytes, 'base64').toString('hex')), ['02', '02', '0102']);
    }
    if (built.descriptor.stage === 'FINALIZE') break;
    head = checkpoint(result.publicationInput, built.descriptor, built.descriptor.stage, built.descriptor.endStyle);
    built = await compiler.prepareSuccessor({ plan: { immutable: { request } }, head });
  }
  assert.deepEqual(stages, ['INIT', 'DEFINITIONS_BEGIN', 'DEFINITIONS_APPEND', 'DEFINITIONS_FINALIZE', 'APPEND', 'FINALIZE']);
});

test('dedicated Pack compiler emits exact INIT, APPEND, FINALIZE Runtime-v8 topology', async () => {
  const runtime = await attestFixtureRuntime(runtimeFixture());
  const initialDocument = documentFixture();
  initialDocument.access = { kind: 'PAID', priceAtomic: '999999999999' };
  initialDocument.completion = { mode: 'FREE_QUOTA_THEN_PAID', priceAtomic: '25', freeQuotaPerWallet: '3', totalCap: '8' };
  const prepared = await preparedTransport(initialDocument);
  const document = prepared.document;
  const moveStyles = deriveMakerV8PackCommitmentsV8(document, prepared.manifest.contentCommitment).styles;
  assert.deepEqual(moveStyles.map(style => style.definition_sources), document.styles.map(style => ({
    part: 1, track: 1, color: style.colorChannelKey === null ? null : 1,
  })));
  const documentSha256 = [...sha256(new TextEncoder().encode(canonicalMakerV8PackJson(document)))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  const compiler = createMakerV8PackCompilerV8({
    runtime,
    loadAuthority: async () => authority(document),
    readback: { async certifyStage() { throw new Error('not used'); } },
    chunkSize: 1,
  });
  const result = await compiler.compilePack({
    draft: { document }, document, documentSha256, context: { transport: prepared },
  });
  const runtimeTuple = makerV8AttestedPackageTuple(runtime).find((entry) => entry.role === 'runtime');
  assert.equal(result.publicationInput.runtimePackageDigest, runtimeTuple.packageDigest);
  assert.equal(result.publicationInput.chainIdentifier, MAKER_V8_MAINNET_CHAIN_IDENTIFIER);
  assert.deepEqual(
    result.publicationInput.styleCommitments,
    deriveMakerV8PackCommitmentsV8(document, prepared.manifest.contentCommitment)
      .styles.map((style) => Buffer.from(style.style_commitment).toString('hex')),
  );

  const request = {
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: 'moon-pack', draftRevision: 1, documentSha256,
    publicationInput: result.publicationInput,
  };
  const init = await compiler.prepare(request);
  const initData = Transaction.fromKind(init.descriptor.kindBytes).getData();
  const releaseCall = initData.commands.find(command => command.MoveCall?.function === 'new_pack_release_v8').MoveCall;
  const pure = (position, type) => type.parse(fromBase64(initData.inputs[releaseCall.arguments[position].Input].Pure.bytes));
  assert.deepEqual([pure(6, bcs.u8()), pure(7, bcs.u64()), pure(8, bcs.u8()),
    pure(9, bcs.u64()), pure(10, bcs.u64()), pure(11, bcs.u64())],
  [1, '999999999999', 1, '25', '3', '8'], 'entry and completion policies remain separate in exact transaction bytes');
  assert.deepEqual(init.descriptor.targets.map((entry) => entry.split('::').at(-1)), [
    'new_pack_release_v8', 'share_pack_release_v8', 'share_pack_treasury_v8',
    'transfer_pack_admin_cap_v8',
  ]);
  assertMakerV8PackCompilerTransactionV8(compiler.authority, init.transaction, {
    signer: document.author.address,
    kindBytes: init.descriptor.kindBytes,
    kindSha256: init.descriptor.kindSha256,
  });

  const initHead = checkpoint(result.publicationInput, init.descriptor, 'INIT', 0);
  const appendOne = await compiler.prepareSuccessor({
    plan: { immutable: { request } }, head: initHead,
  });
  assert.deepEqual(appendOne.descriptor.targets.map((entry) => entry.split('::').at(-1)), [
    'new_pack_style_definition_sources_v8',
    'append_unprotected_pack_style_v8',
  ]);
  const appendCommands = Transaction.fromKind(appendOne.descriptor.kindBytes).getData().commands;
  const appendCall = appendCommands.at(-1).MoveCall;
  assert.equal(appendCall.arguments.length, 16);
  assert.equal(appendCommands[appendCall.arguments[5].Result].MoveCall.function, 'new_pack_style_definition_sources_v8');
  assert.equal(appendCommands[appendCall.arguments[5].Result].MoveCall.arguments.length, 3);
  const appendOneHead = checkpoint(result.publicationInput, appendOne.descriptor, 'APPEND', 1);
  const appendTwo = await compiler.prepareSuccessor({
    plan: { immutable: { request } }, head: appendOneHead,
  });
  assert.equal(appendTwo.descriptor.startStyle, 1);
  assert.equal(appendTwo.descriptor.endStyle, 2);
  const appendTwoHead = checkpoint(result.publicationInput, appendTwo.descriptor, 'APPEND', 2);
  const finalize = await compiler.prepareSuccessor({
    plan: { immutable: { request } }, head: appendTwoHead,
  });
  assert.deepEqual(finalize.descriptor.targets.map((entry) => entry.split('::').at(-1)), [
    'seal_pack_release_v8', 'admit_pack_release_v8',
  ]);

  const kind = bcs.TransactionKind.parse(Buffer.from(finalize.descriptor.kindBytes, 'base64'));
  assert.equal(kind.$kind, 'ProgrammableTransaction');
});

test('protected Pack compiler certifies ciphertext through Release, Seal and Runtime with exact revision binding', async () => {
  const config = runtimeFixture();
  config.roles.release.callablePackageId = id(114);
  const runtime = await attestFixtureRuntime(config);
  const original = documentFixture(1);
  original.bindings.releaseConfig.objectRef = ref(28);
  let liveProtection = protectionAuthority(original);
  const compiler = createMakerV8PackCompilerV8({
    runtime,
    loadAuthority: async ({ document }) => authority(document),
    loadProtectedAuthority: async () => structuredClone(liveProtection),
    readback: { async certifyStage() { throw new Error('not used'); } },
    chunkSize: 1,
  });
  const transport = await preparedProtectedTransport(original, compiler, runtime.roles.release.typeOriginPackageId);
  const document = transport.prepared.document;
  const documentSha256 = [...sha256(new TextEncoder().encode(canonicalMakerV8PackJson(document)))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  const compiled = await compiler.compilePack({
    draft: { document },
    document,
    documentSha256,
    context: { transport: transport.prepared },
  });
  assert.equal(compiled.publicationInput.protection.rows.length, 1);
  assert.equal(compiled.publicationInput.releasePackageId, runtime.roles.release.callablePackageId);
  const protectedRow = compiled.publicationInput.protection.rows[0];
  assert.equal(document.styles[0].asset.mediaType, MAKER_V8_SEAL_CIPHERTEXT_MEDIA_TYPE);
  assert.equal(document.styles[0].asset.sealBindingCommitment, protectedRow.sealBindingCommitment);
  assert.equal(protectedRow.expectedSealRevision, '3');
  assert.equal(protectedRow.nextRuntimeRevision, '4');

  const request = {
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: 'protected-moon-pack', draftRevision: 1, documentSha256,
    publicationInput: compiled.publicationInput,
  };
  const init = await compiler.prepare(request);
  const append = await compiler.prepareSuccessor({
    plan: { immutable: { request } },
    head: checkpoint(compiled.publicationInput, init.descriptor, 'INIT', 0),
  });
  assert.deepEqual(append.descriptor.targets.map((entry) => entry.split('::').slice(-2).join('::')), [
    'runtime_v8::new_pack_style_definition_sources_v8',
    'release_v8::certify_pack_ciphertext_v8',
    'runtime_seal_v8::append_protected_pack_style_v8',
  ]);
  const protectedCommands = Transaction.fromKind(append.descriptor.kindBytes).getData().commands;
  const protectedCall = protectedCommands.at(-1).MoveCall;
  assert.equal(protectedCall.arguments.length, 24);
  assert.equal(protectedCommands[protectedCall.arguments[11].Result].MoveCall.function, 'new_pack_style_definition_sources_v8');
  await assertProtectedAppendReadback(runtime, compiled.publicationInput, append.descriptor,
    checkpoint(compiled.publicationInput, init.descriptor, 'INIT', 0));

  liveProtection = {
    ...structuredClone(liveProtection),
    runtimeRevision: protectedRow.nextRuntimeRevision,
    runtimeCommitment: protectedRow.nextRuntimeCommitment,
    registryCommitment: protectedRow.nextRuntimeCommitment,
    registryState: protectedRow.nextRegistryState,
  };
  const final = await compiler.prepareSuccessor({
    plan: { immutable: { request } },
    head: checkpoint(compiled.publicationInput, append.descriptor, 'APPEND', 1),
  });
  assert.equal(final.descriptor.stage, 'FINALIZE');

  const tampered = structuredClone(compiled.publicationInput);
  tampered.protection.rows[0].certificationCommitment = '01'.repeat(32);
  await assert.rejects(compiler.prepare({ ...request, publicationInput: tampered }), {
    code: 'MAKER_V8_PACK_PROTECTION_DRIFT',
  });
});

test('Pack compiler rejects document, Runtime tuple, request, and authority substitution', async () => {
  const runtime = await attestFixtureRuntime(runtimeFixture());
  const prepared = await preparedTransport(documentFixture(1));
  const document = prepared.document;
  const documentSha256 = [...sha256(new TextEncoder().encode(canonicalMakerV8PackJson(document)))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  const compiler = createMakerV8PackCompilerV8({
    runtime,
    loadAuthority: async () => authority(document),
    readback: { async certifyStage() { throw new Error('not used'); } },
  });
  const result = await compiler.compilePack({
    draft: { document }, document, documentSha256, context: { transport: prepared },
  });
  await assert.rejects(compiler.prepare({
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: '', draftRevision: 1, documentSha256,
    publicationInput: result.publicationInput,
  }), { code: 'MAKER_V8_PACK_COMPILER_REQUEST_DRIFT' });

  const built = await compiler.prepare({
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: 'moon-pack', draftRevision: 1, documentSha256,
    publicationInput: result.publicationInput,
  });
  assert.throws(
    () => assertMakerV8PackCompilerTransactionV8({}, built.transaction),
    { code: 'MAKER_V8_PACK_COMPILER_TRANSACTION_PROOF_REQUIRED' },
  );
  const tampered = structuredClone(result.publicationInput);
  tampered.runtimePackageDigest = digest(42);
  await assert.rejects(compiler.prepare({
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: 'moon-pack', draftRevision: 1, documentSha256,
    publicationInput: tampered,
  }), { code: 'MAKER_V8_PACK_COMPILER_RUNTIME_DRIFT' });
});

test('Pack compiler queries old signed state before live authority and blocks fresh execution after drift', async () => {
  const runtime = await attestFixtureRuntime(runtimeFixture());
  const prepared = await preparedTransport(documentFixture(1));
  const document = prepared.document;
  const documentSha256 = [...sha256(new TextEncoder().encode(canonicalMakerV8PackJson(document)))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  let liveAuthority = authority(document);
  const compiler = createMakerV8PackCompilerV8({
    runtime,
    loadAuthority: async () => structuredClone(liveAuthority),
    readback: { async certifyStage() { throw new Error('not used'); } },
  });
  const compiled = await compiler.compilePack({
    draft: { document }, document, documentSha256, context: { transport: prepared },
  });
  const request = {
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: 'moon-pack', draftRevision: 1, documentSha256,
    publicationInput: compiled.publicationInput,
  };
  const initial = await compiler.prepare(request);
  const plan = {
    immutable: { request },
    head: null,
    current: { descriptor: initial.descriptor, fullTransaction: null, signature: null, outcome: { status: 'READY' } },
  };
  liveAuthority = structuredClone(liveAuthority);
  liveAuthority.makerAdmin.version = '999';
  await compiler.rehydrate({ plan, purpose: 'FINALIZED_RECOVERY', requireFreshAuthority: false });
  await assert.rejects(
    compiler.rehydrate({ plan, purpose: 'READY_RESUME', requireFreshAuthority: true }),
    { code: 'MAKER_V8_PACK_COMPILER_AUTHORITY_DRIFT' },
  );
  await assert.rejects(
    compiler.prepareSuccessor({
      plan,
      head: checkpoint(compiled.publicationInput, initial.descriptor, 'INIT', 0),
    }),
    { code: 'MAKER_V8_PACK_COMPILER_AUTHORITY_DRIFT' },
  );
});

test('cold durable Pack signature reauthorization is required before exact gRPC broadcast', async () => {
  const keypair = new Ed25519Keypair();
  const owner = keypair.toSuiAddress();
  const runtime = await attestFixtureRuntime(runtimeFixture());
  const prepared = await preparedTransport(documentFixture(1, owner));
  const document = prepared.document;
  const documentSha256 = [...sha256(new TextEncoder().encode(canonicalMakerV8PackJson(document)))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  const compiler = createMakerV8PackCompilerV8({
    runtime,
    loadAuthority: async () => authority(document),
    readback: { async certifyStage() { throw new Error('not used'); } },
  });
  const compiled = await compiler.compilePack({
    draft: { document }, document, documentSha256, context: { transport: prepared },
  });
  const request = {
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: 'moon-pack', draftRevision: 1, documentSha256,
    publicationInput: compiled.publicationInput,
  };
  const initial = await compiler.prepare(request);
  initial.transaction.setGasPrice(1);
  initial.transaction.setGasBudget(10_000_000);
  initial.transaction.setGasPayment([{ objectId: id(999), version: '1', digest: digest(9) }]);
  let executeCalls = 0;
  const client = {
    async getChainIdentifier() {
      return { chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST };
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '7' } }; },
      async simulateTransaction({ transaction: raw }) {
        const transactionDigest = TransactionDataBuilder.getDigestFromBytes(raw);
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: transactionDigest, bcs: raw,
            status: { success: true },
            effects: { transactionDigest, status: { success: true } },
          },
        };
      },
      async executeTransaction({ transaction: raw }) {
        executeCalls += 1;
        const transactionDigest = TransactionDataBuilder.getDigestFromBytes(raw);
        return {
          $kind: 'Transaction',
          Transaction: { digest: transactionDigest, effects: { transactionDigest } },
        };
      },
    },
  };
  const boundary = createMakerV8PackPublicationBoundaryV8({
    client,
    compilerAuthority: compiler.authority,
    execution: {
      network: 'mainnet', chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true, allowBroadcast: true,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  const built = await boundary.buildExactTransaction({
    transaction: initial.transaction, descriptor: initial.descriptor, sender: owner,
  });
  assert.deepEqual(await boundary.dryRunExactTransaction({
    transaction: initial.transaction,
    descriptor: initial.descriptor,
    transactionBytes: built.bytes,
    digest: built.digest,
  }), { status: 'SUCCESS' });
  const signed = await keypair.signTransaction(Buffer.from(built.bytes, 'base64'));
  await assert.rejects(boundary.broadcastExactTransaction({
    bytes: built.bytes, signature: signed.signature, digest: built.digest, signer: owner,
  }), { code: 'MAKER_V8_PACK_COMPILER_SIGNED_PROOF_REQUIRED' });
  assert.equal(executeCalls, 0);

  const plan = {
    immutable: { request },
    head: null,
    current: {
      descriptor: initial.descriptor,
      fullTransaction: built.bytes,
      signature: signed.signature,
      outcome: { status: 'OUTCOME_PENDING', digest: built.digest },
    },
  };
  await compiler.rehydrate({ plan });
  assertMakerV8PackSignedArtifactV8(compiler.authority, {
    bytes: built.bytes, signature: signed.signature, digest: built.digest, signer: owner,
  });
  assert.deepEqual(await boundary.broadcastExactTransaction({
    bytes: built.bytes, signature: signed.signature, digest: built.digest, signer: owner,
  }), { accepted: true, digest: built.digest });
  assert.equal(executeCalls, 1);

  const forged = Transaction.fromKind(initial.descriptor.kindBytes);
  forged.setSender(owner);
  assert.throws(
    () => assertMakerV8PackCompilerTransactionV8(compiler.authority, forged),
    { code: 'MAKER_V8_PACK_COMPILER_TRANSACTION_PROOF_REQUIRED' },
  );
});

test('actual compiler, WAL and paired history adapter recover signed authored batches without accepting partial evidence', async () => {
  const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(42));
  const { runtime, prepared, document, documentSha256 } = await authoredTransportFixture(keypair.toSuiAddress(), true);
  const persistence = createMakerV8PackPublicationMemoryPersistenceV8({ durable: true });
  const types = makerV8ChainTypes(runtime), ids = { release: id(201), admin: id(202), treasury: id(203) };
  const history = new Map();
  let response, plan, txDigest, time = 100, queryOffline = false;
  const client = { async getHistoricalObject({ objectId, version }) {
    const object = history.get(objectId);
    assert.equal(object.version, String(version)); return object;
  } };
  const reboot = () => {
    const readback = createMakerV8PackReadbackV8({ runtime, client, assertTransport() {},
      async readFinalized(actualClient, requested, expected) {
        assert.equal(actualClient, client); assert.equal(requested, txDigest);
        assert.deepEqual(await expected.build({ onlyTransactionKind: true }), fromBase64(plan.current.descriptor.kindBytes));
        return response;
      } });
    const compiler = createMakerV8PackCompilerV8({ runtime, loadAuthority: async () => authority(document), readback,
      loadParent: async () => structuredClone(packPublicationAuthoringContent(document).content.parent) });
    const forbidden = async () => { throw new Error('test must not request a signature or broadcast'); };
    const controller = createMakerV8PackPublicationControllerV8({ persistence, compiler,
      boundary: { buildExactTransaction: forbidden, dryRunExactTransaction: forbidden, broadcastExactTransaction: forbidden },
      wallet: { signExactTransaction: forbidden, async verifyExactSignature(input) {
        assert.equal(input.signer, keypair.toSuiAddress());
        return { verified: await keypair.getPublicKey().verifyTransaction(fromBase64(input.bytes), input.signature) };
      } }, rpc: { async queryTransaction({ digest: requested }) {
        if (queryOffline) throw new Error('offline fixture');
        assert.equal(requested, txDigest);
        return { status: 'FINALIZED_SUCCESS', digest: requested, epoch: '1', effectsFingerprint: `0x${'ab'.repeat(32)}`,
          eventsDigest: digest(9), error: null, absence: null };
      } }, execution: { allowWalletSignature: false, allowBroadcast: false }, now: () => time++ });
    return { compiler, controller };
  };
  const first = reboot();
  const result = await first.compiler.compilePack({ draft: { document }, document, documentSha256, context: { transport: prepared } });
  const compiled = result.publicationInput;
  const request = { schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1', kind: 'PACK', draftId: 'authored-recovery',
    draftRevision: 1, documentSha256, publicationInput: compiled };
  plan = await first.controller.prepare(request);
  const source = packPublicationAuthoringContent(document);
  const definitionValue = await compileMakerV8PackDefinitionRowsV8(source.content,
    { expectedParent: source.content.parent, semanticPackId: document.metadata.semanticPackId });
  const definitionPlan = await planMakerV8PackDefinitionRegistrationV8(definitionValue, {
    corePackageId: compiled.corePackageId, coreOriginalPackageId: compiled.coreOriginalPackageId,
    runtimePackageId: compiled.runtimePackageId, paymentCoinType: compiled.paymentCoinType, signer: compiled.signer,
    releaseRef: { objectId: ids.release, initialSharedVersion: '1' }, adminCapRef: ref(202),
    baseRegistryRef: compiled.inputs.baseRegistry, releaseContentCommitment: compiled.contentCommitment });
  assert.ok(definitionPlan.steps.some(step => step.stage === 'COLOR_APPEND'));
  for (const stage of ['INIT', ...definitionPlan.steps.map(step => `DEFINITIONS_${step.stage}`), 'APPEND', 'FINALIZE']) {
    plan = await reboot().controller.resume(plan.attemptId);
    assert.equal(plan.current.descriptor.stage, stage);
    if (stage === 'FINALIZE') await assert.rejects(reboot().controller.requestSignature(plan.attemptId),
      { code: 'MAKER_V8_PACK_PUBLICATION_EXECUTION_DISABLED' });
    const descriptor = plan.current.descriptor;
    // Seed a previously signed fixture, not a production signature authorization.
    const tx = Transaction.fromKind(descriptor.kindBytes); tx.setSender(compiled.signer);
    tx.setGasPrice(1); tx.setGasBudget(1000000); tx.setGasPayment([ref(990)]);
    const full = await tx.build(), signed = await keypair.signTransaction(full);
    txDigest = TransactionDataBuilder.getDigestFromBytes(full);
    const seeded = structuredClone(plan); seeded.revision++; seeded.updatedAt = time++;
    Object.assign(seeded.current, { fullTransaction: toBase64(full), signature: signed.signature,
      outcome: { status: 'SIGNED', digest: txDigest, signedAt: seeded.updatedAt, firstSeenAt: null,
        broadcastAt: null, observedAt: seeded.updatedAt, code: null, absence: null } });
    plan = await persistence.compareAndSwap(plan.attemptId, plan.revision, seeded);
    history.clear();
    const releaseRef = { objectId: ids.release, version: String(10 + descriptor.ordinal), digest: digest(50) };
    const release = historicalValue(releaseRef, types.packRelease, { Shared: { initial_shared_version: '1' } }, txDigest,
      releaseFields(compiled, descriptor, ids, stage === 'FINALIZE' ? 2 : 0));
    history.set(ids.release, release);
    response = { objectChanges: [{ ...releaseRef, type: stage === 'INIT' ? 'created' : 'mutated', objectType: types.packRelease }],
      compilerEffectsOutputRefs: [releaseRef], events: [], compilerTransactionKindProof: { transactionKindSha256: descriptor.kindSha256 } };
    const add = (object, change) => {
      history.set(object.objectId, object);
      const reference = { objectId: object.objectId, version: object.version, digest: object.digest };
      response.objectChanges.push({ ...reference, type: change, objectType: object.type }); response.compilerEffectsOutputRefs.push(reference);
    };
    if (stage === 'INIT') {
      add(historicalValue(ref(202), types.packAdminCap, { AddressOwner: compiled.signer }, txDigest,
        { version: '8', release_id: ids.release, owner: compiled.signer, control_epoch: '0' }), 'created');
      add(historicalValue(ref(203), types.packTreasury, { Shared: { initial_shared_version: '1' } }, txDigest,
        { version: '8', release_id: ids.release, total_collected: '0', total_withdrawn: '0' }), 'created');
    }
    if (stage === 'FINALIZE') {
      const previous = compiled.document.admission.expectedPackRegistryRevision;
      const revision = (BigInt(previous) + 1n).toString();
      const registryRef = { objectId: compiled.inputs.packRegistry.objectId, version: releaseRef.version, digest: digest(56) };
      add(historicalValue(registryRef, types.packRegistry, { Shared: { initial_shared_version: '1' } }, txDigest,
        { id: { id: registryRef.objectId }, revision }), 'mutated');
      const event = (name, parsedJson) => ({ type: `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::${name}`,
        sender: compiled.signer, bcs: 'AA==', parsedJson });
      response.events = [event('PackLifecycleChangedV8', { release_id: ids.release, previous_lifecycle: '0', lifecycle: '1' }),
        event('PackRegistryRevisionAdvancedV8', { root_id: compiled.document.bindings.root.objectRef.objectId,
          previous_revision: previous, revision, subject_id: ids.release, operation: '0' }),
        event('PackLifecycleChangedV8', { release_id: ids.release, previous_lifecycle: '1', lifecycle: '2' })];
      const priorHead = structuredClone(plan.head);
      const validEvents = structuredClone(response.events);
      response.events[2].parsedJson.lifecycle = '1';
      await assert.rejects(reboot().controller.resume(plan.attemptId), { code: 'MAKER_V8_PACK_READBACK_EVENT_DRIFT' });
      assert.deepEqual((await persistence.load(plan.attemptId)).head, priorHead);
      assert.equal((await persistence.load(plan.attemptId)).terminal, null);
      response.events = validEvents;
    }
    let fieldObject;
    if (stage.startsWith('DEFINITIONS_')) {
      const step = definitionPlan.steps[descriptor.ordinal - 1], final = stage === 'DEFINITIONS_FINALIZE';
      const key = `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackDefinitions${final ? '' : 'Draft'}KeyV8`;
      const valueType = key.replace('KeyV8', 'V8');
      const fieldId = deriveDynamicFieldID(ids.release, key, Uint8Array.of(0));
      const rows = { semantic_pack_id: definitionValue.rows.semantic_pack_id };
      let remaining = step.end;
      for (const kind of ['tracks', 'colors', 'parts', 'rules', 'visibility']) {
        rows[kind] = definitionValue.rows[kind].slice(0, remaining); remaining -= rows[kind].length;
      }
      const commitment = Array.from(Buffer.from(definitionPlan.definitionCommitment, 'hex'));
      const stored = final ? { version: 8, release_id: ids.release,
        release_content_commitment: Array.from(Buffer.from(compiled.contentCommitment, 'hex')), rows, commitment }
        : { next_chunk: stage === 'DEFINITIONS_BEGIN' ? 0 : step.chunkIndex + 1, expected_commitment: commitment, rows };
      const schema = bcs.struct('Field', { id: bcs.Address, name: bcs.bool(),
        value: final ? MAKER_V8_PACK_DEFINITIONS_BCS : MAKER_V8_PACK_DEFINITIONS_DRAFT_BCS });
      fieldObject = historicalValue({ objectId: fieldId, version: releaseRef.version, digest: digest(55) },
        `0x2::dynamic_field::Field<${key},${valueType}>`, { ObjectOwner: ids.release }, txDigest, {});
      fieldObject.contentBcs = schema.serialize({ id: fieldId, name: false, value: stored }).toBytes();
      add(fieldObject, stage === 'DEFINITIONS_APPEND' ? 'mutated' : 'created');
      let pendingColor;
      if (step.stage === 'COLOR_BEGIN' || step.stage === 'COLOR_APPEND') {
        const colorKey = `${runtime.roles.runtime.typeOriginPackageId}::runtime_v8::PackColorDraftKeyV8`;
        const colorId = deriveDynamicFieldID(ids.release, colorKey, Uint8Array.of(0));
        const colorSchema = bcs.struct('ColorField', { id: bcs.Address, name: bcs.bool(), value: MAKER_V8_COLOR_CHANNEL_DRAFT_BCS_V2 });
        const row = definitionValue.rows.colors[step.start - definitionValue.rows.tracks.length];
        pendingColor = historicalValue({ objectId: colorId, version: releaseRef.version, digest: digest(56) },
          `0x2::dynamic_field::Field<${colorKey},${compiled.coreOriginalPackageId}::base_registry_v8::ColorChannelDraftV2>`,
          { ObjectOwner: ids.release }, txDigest, {});
        pendingColor.contentBcs = colorSchema.serialize({ id: colorId, name: false, value: {
          ...row, expected_swatches: row.swatches.length, swatches: row.swatches.slice(0, step.swatchEnd),
        } }).toBytes();
        add(pendingColor, step.stage === 'COLOR_BEGIN' ? 'created' : 'mutated');
      }
      const priorHead = structuredClone(plan.head);
      queryOffline = true;
      plan = await reboot().controller.resume(plan.attemptId);
      assert.equal(plan.current.outcome.status, 'OUTCOME_UNKNOWN');
      assert.equal(plan.current.outcome.digest, txDigest); queryOffline = false;
      const correctBytes = fieldObject.contentBcs;
      fieldObject.contentBcs = new Uint8Array([...correctBytes, 0]);
      await assert.rejects(reboot().controller.resume(plan.attemptId), { code: 'MAKER_V8_PACK_READBACK_DEFINITION_DRIFT' });
      assert.deepEqual((await persistence.load(plan.attemptId)).head, priorHead);
      fieldObject.contentBcs = correctBytes;
      if (pendingColor) {
        const correctColor = pendingColor.contentBcs;
        pendingColor.contentBcs = new Uint8Array([...correctColor, 0]);
        await assert.rejects(reboot().controller.resume(plan.attemptId), { code: 'MAKER_V8_PACK_READBACK_DEFINITION_DRIFT' });
        assert.deepEqual((await persistence.load(plan.attemptId)).head, priorHead);
        pendingColor.contentBcs = correctColor;
      }
      release.parsed.observed_style_count = '1';
      await assert.rejects(reboot().controller.resume(plan.attemptId));
      assert.deepEqual((await persistence.load(plan.attemptId)).head, priorHead);
      release.parsed.observed_style_count = '0';
    }
    plan = await reboot().controller.resume(plan.attemptId);
    assert.equal(plan.head.stage, stage); assert.equal(plan.head.digest, txDigest);
    assert.equal(plan.current, null); assert.equal(plan.status, stage === 'FINALIZE' ? 'COMPLETE' : 'ACTIVE');
  }
  assert.equal(plan.terminal.digest, txDigest);
  assert.equal(plan.terminal.status, 'COMPLETE');
  const completed = structuredClone(plan);
  assert.deepEqual(await reboot().controller.resume(plan.attemptId), completed);
});

function historicalValue(refValue, type, ownerValue, transactionDigest, parsed) {
  return {
    ...refValue,
    type,
    owner: ownerValue,
    previousTransaction: transactionDigest,
    contentBcs: Uint8Array.of(1),
    objectBcs: Uint8Array.of(2),
    parsed,
  };
}

async function assertProtectedAppendReadback(runtime, compiled, descriptor, predecessor) {
  const types = makerV8ChainTypes(runtime); const txDigest = digest(45);
  const ids = { release: id(201), admin: id(202), treasury: id(203) };
  const releaseRef = { objectId: ids.release, version: '2', digest: digest(46) };
  const sealRef = { objectId: compiled.protection.authority.sealRegistry.objectId, version: '2', digest: digest(47) };
  const expected = compiled.protection.rows.at(-1); const s = expected.nextRegistryState;
  const sealFields = { root_id: s.rootId, policy_config_id: s.policyId, maker_version: s.makerVersion,
    root_content_commitment: s.rootContentCommitment, sealed: true, revision: s.revision, runtime_revision: s.runtimeRevision,
    commitment: expected.nextRuntimeCommitment,
    ...Object.fromEntries(['base', 'pack', 'complete'].flatMap(scope => [[`${scope}_count`, s[`${scope}Count`]], [`${scope}_commitment`, s[`${scope}Commitment`]]])) };
  const history = new Map([
    [ids.release, historicalValue(releaseRef, types.packRelease, { Shared: { initial_shared_version: '1' } }, txDigest, releaseFields(compiled, descriptor, ids, 0))],
    [sealRef.objectId, historicalValue(sealRef, types.sealRegistry, { Shared: { initial_shared_version: '1' } }, txDigest, sealFields)],
  ]);
  const client = { async getHistoricalObject({ objectId }) { return history.get(objectId); } };
  const response = { objectChanges: [{ type: 'mutated', ...releaseRef, objectType: types.packRelease }, { type: 'mutated', ...sealRef, objectType: types.sealRegistry }],
    compilerEffectsOutputRefs: [releaseRef, sealRef], compilerTransactionKindProof: { transactionKindSha256: descriptor.kindSha256 },
    events: [{ type: `${runtime.roles.seal.typeOriginPackageId}::seal_v8::RuntimeProtectedAssetRegisteredV8`, sender: compiled.signer, bcs: 'AA==',
      parsedJson: { registry_id: sealRef.objectId, root_id: s.rootId, previous_revision: expected.expectedSealRevision,
        new_revision: expected.nextRuntimeRevision, scope_kind: '1', seal_id: expected.sealId, runtime_commitment: expected.nextRuntimeCommitment } }] };
  const readback = createMakerV8PackReadbackV8({ client, runtime, assertTransport() {}, async readFinalized() { return response; } });
  const tx = Transaction.fromKind(descriptor.kindBytes); tx.setSender(compiled.signer); tx.setGasPrice(1); tx.setGasBudget(1000000);
  tx.setGasPayment([{ objectId: id(990), version: '1', digest: digest(10) }]);
  const input = { compiled, descriptor, predecessor, query: { status: 'FINALIZED_SUCCESS', digest: txDigest },
    artifact: { base64: toBase64(await tx.build()), signature: 'AQ==', digest: txDigest } };
  await readback.certifyStage(input);
  for (const [key, value] of [['pack_count', '999'], ['pack_commitment', 'ab'.repeat(32)], ['commitment', 'ab'.repeat(32)], ['root_id', id(999)]]) {
    const before = sealFields[key]; sealFields[key] = value;
    await assert.rejects(readback.certifyStage(input), { code: 'MAKER_V8_PACK_READBACK_SEAL_DRIFT' });
    sealFields[key] = before;
  }
}

function releaseFields(compiled, descriptor, ids, lifecycle) {
  return {
    id: { id: ids.release },
    version: '8',
    root_id: compiled.document.bindings.root.objectRef.objectId,
    root_version: compiled.document.bindings.root.makerVersion,
    root_content_commitment: compiled.document.bindings.root.contentCommitment,
    creator: compiled.signer,
    owner: compiled.signer,
    control_epoch: '0',
    admin_cap_id: ids.admin,
    treasury_id: ids.treasury,
    semantic_pack_id: compiled.document.metadata.semanticPackId,
    manifest_blob_id: compiled.transport.manifest.blobId,
    manifest_sha256: compiled.transport.manifest.sha256,
    content_commitment: compiled.contentCommitment,
    lifecycle: String(lifecycle),
    expected_style_count: String(compiled.document.styles.length),
    observed_style_count: String(descriptor.endStyle),
    expected_style_commitment: compiled.expectedStyleCommitment,
    rolling_style_commitment: compiled.rollingCommitments[descriptor.endStyle],
    protected_style_count: String(compiled.document.styles.slice(0, descriptor.endStyle)
      .filter((style) => style.asset.protected).length),
  };
}

test('Pack readback certifies INIT objects and FINALIZE admission from raw-effects-bound history', async () => {
  const runtime = await attestFixtureRuntime(runtimeFixture());
  const prepared = await preparedTransport(documentFixture(1));
  const document = prepared.document;
  const documentSha256 = [...sha256(new TextEncoder().encode(canonicalMakerV8PackJson(document)))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  const compiler = createMakerV8PackCompilerV8({
    runtime,
    loadAuthority: async () => authority(document),
    readback: { async certifyStage() { throw new Error('not used'); } },
  });
  const compiledResult = await compiler.compilePack({
    draft: { document }, document, documentSha256, context: { transport: prepared },
  });
  const compiled = compiledResult.publicationInput;
  const request = {
    schemaVersion: 'animacraft.maker-v8-pack-publication-request.v1',
    kind: 'PACK', draftId: 'moon-pack', draftRevision: 1, documentSha256,
    publicationInput: compiled,
  };
  const init = await compiler.prepare(request);
  const types = makerV8ChainTypes(runtime);
  const ids = { release: id(301), admin: id(302), treasury: id(303) };
  const initDigest = digest(21);
  const initRefs = {
    release: { objectId: ids.release, version: '9', digest: digest(31) },
    admin: { objectId: ids.admin, version: '9', digest: digest(32) },
    treasury: { objectId: ids.treasury, version: '9', digest: digest(33) },
  };
  const history = new Map([
    [ids.release, historicalValue(
      initRefs.release, types.packRelease,
      { Shared: { initial_shared_version: '9' } }, initDigest,
      releaseFields(compiled, init.descriptor, ids, 0),
    )],
    [ids.admin, historicalValue(
      initRefs.admin, types.packAdminCap,
      { AddressOwner: compiled.signer }, initDigest,
      { id: { id: ids.admin }, version: '8', release_id: ids.release, owner: compiled.signer, control_epoch: '0' },
    )],
    [ids.treasury, historicalValue(
      initRefs.treasury, types.packTreasury,
      { Shared: { initial_shared_version: '9' } }, initDigest,
      { id: { id: ids.treasury }, version: '8', release_id: ids.release, total_collected: '0', total_withdrawn: '0' },
    )],
  ]);
  const client = {
    async getHistoricalObject({ objectId }) { return history.get(objectId); },
  };
  let expectedFinalizedDigest = initDigest;
  let finalized = {
    objectChanges: [
      { type: 'created', ...initRefs.release, objectType: types.packRelease },
      { type: 'created', ...initRefs.admin, objectType: types.packAdminCap },
      { type: 'created', ...initRefs.treasury, objectType: types.packTreasury },
    ],
    compilerEffectsOutputRefs: Object.values(initRefs),
    events: [],
    compilerTransactionKindProof: { transactionKindSha256: init.descriptor.kindSha256 },
  };
  const readback = createMakerV8PackReadbackV8({
    client,
    runtime,
    assertTransport(value) { assert.equal(value, client); },
    async readFinalized(_client, requestedDigest, expected) {
      assert.equal(requestedDigest, expectedFinalizedDigest);
      assert.equal(expected.getData().sender, compiled.signer);
      return finalized;
    },
  });
  const initFull = Transaction.fromKind(init.descriptor.kindBytes);
  initFull.setSender(compiled.signer);
  initFull.setGasPrice(1);
  initFull.setGasBudget(1_000_000);
  initFull.setGasPayment([{ objectId: id(990), version: '1', digest: digest(10) }]);
  const initBytes = toBase64(await initFull.build());
  const initReadback = await readback.certifyStage({
    compiled,
    descriptor: init.descriptor,
    predecessor: null,
    query: { status: 'FINALIZED_SUCCESS', digest: initDigest },
    artifact: { base64: initBytes, signature: toBase64(Uint8Array.of(1)), digest: initDigest },
  });
  assert.equal(initReadback.chain, null);
  assert.equal(initReadback.checkpoint.observedStyleCount, '0');
  assert.equal(initReadback.checkpoint.release.objectRef.objectId, ids.release);

  const append = await compiler.prepareSuccessor({
    plan: { immutable: { request } },
    head: initReadback.checkpoint,
  });
  const appendHead = {
    ...structuredClone(initReadback.checkpoint),
    ordinal: append.descriptor.ordinal,
    stage: 'APPEND',
    kindSha256: append.descriptor.kindSha256,
    startStyle: 0,
    endStyle: 1,
    observedStyleCount: '1',
    rollingStyleCommitment: compiled.rollingCommitments[1],
  };
  const finalize = await compiler.prepareSuccessor({
    plan: { immutable: { request } },
    head: appendHead,
  });
  const finalizeDigest = digest(22);
  expectedFinalizedDigest = finalizeDigest;
  const finalReleaseRef = { objectId: ids.release, version: '10', digest: digest(34) };
  const registryRef = {
    objectId: compiled.inputs.packRegistry.objectId, version: '10', digest: digest(35),
  };
  history.set(ids.release, historicalValue(
    finalReleaseRef, types.packRelease,
    { Shared: { initial_shared_version: '9' } }, finalizeDigest,
    releaseFields(compiled, finalize.descriptor, ids, 2),
  ));
  history.set(registryRef.objectId, historicalValue(
    registryRef, types.packRegistry,
    { Shared: { initial_shared_version: '1' } }, finalizeDigest,
    { id: { id: registryRef.objectId }, revision: '8' },
  ));
  const runtimeOriginal = runtime.roles.runtime.typeOriginPackageId;
  finalized = {
    objectChanges: [
      { type: 'mutated', ...finalReleaseRef, objectType: types.packRelease },
      { type: 'mutated', ...registryRef, objectType: types.packRegistry },
    ],
    compilerEffectsOutputRefs: [finalReleaseRef, registryRef],
    events: [
      {
        type: `${runtimeOriginal}::runtime_v8::PackLifecycleChangedV8`,
        sender: compiled.signer, bcs: 'AA==',
        parsedJson: { release_id: ids.release, previous_lifecycle: '0', lifecycle: '1' },
      },
      {
        type: `${runtimeOriginal}::runtime_v8::PackRegistryRevisionAdvancedV8`,
        sender: compiled.signer, bcs: 'AA==',
        parsedJson: {
          root_id: compiled.document.bindings.root.objectRef.objectId,
          previous_revision: '7', revision: '8', subject_id: ids.release, operation: '0',
        },
      },
      {
        type: `${runtimeOriginal}::runtime_v8::PackLifecycleChangedV8`,
        sender: compiled.signer, bcs: 'AA==',
        parsedJson: { release_id: ids.release, previous_lifecycle: '1', lifecycle: '2' },
      },
    ],
    compilerTransactionKindProof: { transactionKindSha256: finalize.descriptor.kindSha256 },
  };
  const finalFull = Transaction.fromKind(finalize.descriptor.kindBytes);
  finalFull.setSender(compiled.signer);
  finalFull.setGasPrice(1);
  finalFull.setGasBudget(1_000_000);
  finalFull.setGasPayment([{ objectId: id(991), version: '1', digest: digest(11) }]);
  const finalBytes = toBase64(await finalFull.build());
  const finalReadback = await readback.certifyStage({
    compiled,
    descriptor: finalize.descriptor,
    predecessor: initReadback.checkpoint,
    query: { status: 'FINALIZED_SUCCESS', digest: finalizeDigest },
    artifact: { base64: finalBytes, signature: toBase64(Uint8Array.of(2)), digest: finalizeDigest },
  });
  assert.equal(finalReadback.chain.lifecycle, 'ACTIVE');
  assert.equal(finalReadback.chain.packRegistryRevision, '8');

  const tampered = structuredClone(finalized);
  tampered.events[1].parsedJson.revision = '9';
  finalized = tampered;
  await assert.rejects(readback.certifyStage({
    compiled,
    descriptor: finalize.descriptor,
    predecessor: initReadback.checkpoint,
    query: { status: 'FINALIZED_SUCCESS', digest: finalizeDigest },
    artifact: { base64: finalBytes, signature: toBase64(Uint8Array.of(2)), digest: finalizeDigest },
  }), { code: 'MAKER_V8_PACK_READBACK_EVENT_DRIFT' });
});
import { deriveMakerV8SealRuntimeRegistryCommitmentV2 } from '../maker-v8-seal-runtime-compiler.js';
