import assert from 'node:assert/strict';
import { compilerSealPolicyFixture } from './fixtures/maker-v8-compiler-seal-policy.js';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { bindMakerV8SourceAssets } from '../maker-v8-source-asset.js';
import { sha256 as sourceSha256 } from '@noble/hashes/sha2.js';
import { compileMakerV8LivingContentV8 } from '../maker-v8-living-content-compiler.js';
import { makerV8ActivationAuthorityFixture, makerV8LivingBlobIdFixture } from './fixtures/maker-v8-activation-authority-fixture.js';
import { createDefaultMakerV8LivingContentV8 } from '../maker-v8-living-content.js';
import { MAKER_V8_BASE_CATEGORIES_V2, deriveMakerV8BaseAuthorCommitmentV2, deriveMakerV8BaseStorageCommitmentsV2 } from '../maker-v8-base-commitments.js';
import { MAKER_V8_BASE_ROW_BCS_V2 } from '../maker-v8-base-rows.js';
import { compileMakerV8RuleRows } from '../maker-v8-compiler.js';

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  normalizeSuiAddress,
  toBase58,
  toBase64,
} from '@mysten/sui/utils';

import {
  MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
} from '../maker-v8-chain.js';
import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE,
  MAKER_V8_ROLE_ORDER,
  MAKER_V8_SCAFFOLD_READBACK_SCHEMA,
  MAKER_V8_TRUSTED_CONTEXT_SCHEMA,
  buildMakerV8ScaffoldTransaction,
  canonicalMakerV8Json,
  certifyMakerV8ScaffoldReadback,
  certifyMakerV8TrustedContext,
  deriveMakerV8ReleaseCommitments,
} from '../maker-v8-compiler.js';
import { createMakerV8LiveDataSourceV8 } from '../maker-v8-browser.js';
import {
  MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
  assertMakerV8PublicationPlanIdentityV8,
  makerV8Base64BlobV8,
  makerV8BlobRefV8,
  createMakerV8PublicationPersistenceV8,
  makerV8PublicationAttemptSha256V8,
  makerV8PublicationCheckpointSha256V8,
  makerV8Utf8BlobV8,
} from '../maker-v8-publication-store.js';
import {
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
} from '../maker-v8-sui-grpc.js';
import {
  MAKER_V8_PUBLICATION_CAPSULE_SCHEMA,
  MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_SCHEMA,
  createMakerV8PublicationBoundaryAdapterV8,
  createMakerV8PublicationCompilerAdapterV8,
  createProductionMakerV8PublicationAdaptersV8,
} from '../maker-v8-publication-adapters.js';
import { createMakerV8PublicationControllerV8 } from '../maker-v8-publication-controller.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/maker-v8-compiler-v1.json', import.meta.url),
  'utf8',
));
const ZERO = '00'.repeat(32);
fixture.document.livingContent = createDefaultMakerV8LivingContentV8(fixture.document.metadata);
const DIGEST = '11111111111111111111111111111111';
const COIN = MAKER_V8_PAYMENT_COIN_TYPE;
const MARKERS = {
  core: ['protocol_config_v8', 'CorePackageMarkerV8', 'CorePackageMarkerV8'],
  seal: ['seal_v8', 'SealOriginalMarkerV8', 'SealCallableMarkerV8'],
  runtime: ['runtime_v8', 'RuntimeOriginalMarkerV8', 'RuntimeCallableMarkerV8'],
  output: ['output_v8', 'OutputOriginalMarkerV8', 'OutputCallableMarkerV8'],
  physical: ['physical_v8', 'PhysicalOriginalMarkerV8', 'PhysicalCallableMarkerV8'],
  market: ['market_v8', 'MarketOriginalMarkerV8', 'MarketCallableMarkerV8'],
  release: ['release_v8', 'ReleaseOriginalMarkerV8', 'ReleaseCallableMarkerV8'],
};
const clone = (value) => structuredClone(value);
const nid = (value) => normalizeSuiAddress(value);
const ntype = (value) => value.replace(/0x[0-9a-fA-F]{1,64}/g, nid);
const shared = (objectId, type, fields) => ({
  type: ntype(type),
  reference: { kind: 'shared', objectId: nid(objectId), initialSharedVersion: '1' },
  fields,
});
const owned = (objectId, type, fields) => ({
  type: ntype(type),
  reference: { kind: 'owned', objectId: nid(objectId), version: '1', digest: DIGEST },
  fields,
});

function productionRuntimeFixture() {
  const configIds = {
    seal: fixture.ids.sealConfig,
    runtime: fixture.ids.runtimeConfig,
    output: fixture.ids.outputConfig,
    physical: fixture.ids.physicalConfig,
    market: fixture.ids.marketConfig,
    release: fixture.ids.releaseConfig,
  };
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: nid(fixture.ids.catalog),
    protocolConfigId: nid(fixture.ids.protocolConfig),
    protocolTreasuryId: nid(fixture.ids.protocolTreasury),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles: Object.fromEntries(MAKER_V8_ROLE_ORDER.map((role) => [role, {
      typeOriginPackageId: nid(fixture.packageRoles[role][0]),
      callablePackageId: nid(fixture.packageRoles[role][1]),
    }])),
    roleConfigIds: Object.fromEntries(Object.entries(configIds).map(([role, id]) => [role, nid(id)])),
    makerBindings: [],
  };
}

function controllerPersistenceStub() {
  return Object.freeze(Object.fromEntries([
    'requirePersistentStorage', 'preflightQuota', 'createAttempt', 'loadPlan',
    'loadHead', 'loadAttemptHead', 'getBlob', 'compareAndSwap', 'deleteUnsigned',
  ].map((method) => [method, async () => null])));
}

function browserDataSourceStub() {
  return Object.freeze(Object.fromEntries([
    'resolveRoleLineages', 'loadRoute', 'browseMarket', 'loadOwnedInventory',
    'loadActionContext', 'queryTransaction', 'readbackMarketAction',
  ].map((method) => [method, async () => null])));
}

function publicProjection(document) {
  const result = clone(document);
  result.parts = result.parts.map((part) => ({
    ...part,
    items: part.items.filter((item) => item.status === 'PUBLIC'),
  }));
  return result;
}

async function hashBytes(bytes) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

async function transportFor(document = clone(fixture.document), assets = clone(fixture.transportAssets)) {
  const certifiedAssets = [];
  for (const asset of assets) {
    const bytes = Buffer.from(asset.bytesBase64, 'base64');
    certifiedAssets.push({
      assetId: asset.assetId,
      blobId: asset.blobId,
      mediaType: asset.mediaType,
      byteLength: bytes.length,
      sha256: await hashBytes(bytes),
    });
  }
  certifiedAssets.sort((left, right) => left.assetId < right.assetId ? -1 : 1);
  const manifest = canonicalMakerV8Json({
    schemaVersion: 'animacraft.maker-v8-manifest.v2',
    protocolVersion: 8,
    document: publicProjection(document),
    certifiedAssets,
  });
  return {
    livingContent: { blobId: await makerV8LivingBlobIdFixture((await compileMakerV8LivingContentV8(document)).bytes),blobObjectId:`0x${'a'.repeat(64)}`, bytesBase64: toBase64(Uint8Array.from((await compileMakerV8LivingContentV8(document)).bytes)) },
    manifest: {
      blobId: 'walrus-publication-adapter-manifest-v8',
      bytesBase64: Buffer.from(manifest).toString('base64'),
    },
    assets,
  };
}

async function releaseTuple() {
  const roles = {};
  for (const [index, role] of MAKER_V8_ROLE_ORDER.entries()) {
    const [originalPackageId, callablePackageId] = fixture.packageRoles[role];
    const [module, originalMarker, callableMarker] = MARKERS[role];
    roles[role] = {
      originalPackageId,
      callablePackageId,
      sourceCommitment: (index + 1).toString(16).padStart(64, '0'),
      packageCommitment: (index + 17).toString(16).padStart(64, '0'),
      abiCommitment: (index + 33).toString(16).padStart(64, '0'),
      bindingCommitment: ZERO,
      originalMarkerType: `${originalPackageId}::${module}::${originalMarker}`,
      callableMarkerType: `${callablePackageId}::${module}::${callableMarker}`,
    };
  }
  const authorities = Object.fromEntries(
    ['seal', 'runtime', 'output', 'physical', 'market', 'release']
      .map((role, index) => [role, `0x${(0x501 + index).toString(16)}`]),
  );
  for (const role of MAKER_V8_ROLE_ORDER) {
    await assert.rejects(
      deriveMakerV8ReleaseCommitments({ catalogId: fixture.ids.catalog, roles, authorities }),
      (error) => {
        assert.equal(error.code, 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH');
        roles[role].bindingCommitment = error.details.expected;
        return true;
      },
    );
  }
  return deriveMakerV8ReleaseCommitments({ catalogId: fixture.ids.catalog, roles, authorities });
}

async function contextTemplate(transport) {
  const release = await releaseTuple();
  const core = release.roles.core.originalPackageId;
  const protocolFields = {
    version: 8,
    revision: '3',
    enabled: true,
    coreOriginalPackageId: release.roles.core.originalPackageId,
    coreCallablePackageId: release.roles.core.callablePackageId,
    treasuryId: fixture.ids.protocolTreasury,
    paymentCoinType: COIN,
    primaryContentFeeBps: 125,
    fixedCompleteFeeAtomic: '7',
    makerMarketFeeBps: 80,
    soulMarketFeeBps: 90,
    commitment: ZERO,
  };
  const catalogFields = {
    version: 8,
    protocolConfigId: fixture.ids.protocolConfig,
    protocolConfigRevision: '3',
    protocolConfigCommitment: ZERO,
    nativeCapabilityMask: '127',
    productBindingCommitment: release.productBindingCommitment,
    callCapSetCommitment: release.callCapSetCommitment,
    roles: release.roles,
    authorities: release.authorities,
  };
  const common = (role) => ({
    version: 8,
    catalogId: fixture.ids.catalog,
    productBindingCommitment: release.productBindingCommitment,
    callCapSetCommitment: release.callCapSetCommitment,
    authorityId: release.authorities[role],
  });
  const value = {
    schemaVersion: MAKER_V8_TRUSTED_CONTEXT_SCHEMA,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    signerAddress: fixture.ids.signer,
    paymentCoinType: COIN,
    protocolProfile: clone(MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE),
    coreArtifact: {
      callablePackageId: release.roles.core.callablePackageId,
      packageDigest: '2'.repeat(44),
      baseRegistryModuleSha256: MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
    },
    clock: shared('0x6', '0x2::clock::Clock', {}),
    protocolConfig: shared(
      fixture.ids.protocolConfig,
      `${core}::protocol_config_v8::ProtocolConfigV8`,
      protocolFields,
    ),
    protocolTreasury: shared(
      fixture.ids.protocolTreasury,
      `${core}::protocol_config_v8::ProtocolTreasuryV8<${COIN}>`,
      { version: 8, configId: fixture.ids.protocolConfig },
    ),
    catalog: shared(
      fixture.ids.catalog,
      `${core}::package_binding_v8::ProductReleaseCatalogV8`,
      catalogFields,
    ),
    configs: {
      seal: shared(fixture.ids.sealConfig, `${release.roles.seal.originalPackageId}::seal_v8::SealPolicyConfigV8`, {
        ...common('seal'),
        commitment: ZERO,
        keyServerIds: ['0x601'],
        weights: [1],
        threshold: 1,
        keyServerSetCommitment: 'aa'.repeat(32),
        encryptionPolicyCommitment: 'bb'.repeat(32),
      }),
      runtime: shared(fixture.ids.runtimeConfig, `${release.roles.runtime.originalPackageId}::runtime_binding_v8::RuntimePackageConfigV8`, common('runtime')),
      output: shared(fixture.ids.outputConfig, `${release.roles.output.originalPackageId}::output_v8::OutputPackageConfigV8`, common('output')),
      physical: shared(fixture.ids.physicalConfig, `${release.roles.physical.originalPackageId}::physical_v8::PhysicalPackageConfigV8`, common('physical')),
      market: shared(fixture.ids.marketConfig, `${release.roles.market.originalPackageId}::market_v8::MarketPackageConfigV8`, common('market')),
      release: shared(fixture.ids.releaseConfig, `${release.roles.release.originalPackageId}::release_v8::ReleasePackageConfigV8`, common('release')),
    },
    transport,
  };
  value.activationAuthority=await makerV8ActivationAuthorityFixture({catalogId:value.catalog.reference.objectId,productBindingCommitment:release.productBindingCommitment,callCapSetCommitment:release.callCapSetCommitment,roles:release.roles,
    configIds:Object.fromEntries(Object.entries(value.configs).map(([role,v])=>[role,v.reference.objectId])),signerAddress:value.signerAddress,livingBlobObjectId:transport.livingContent.blobObjectId,livingBlobId:transport.livingContent.blobId,livingBytes:Buffer.from(transport.livingContent.bytesBase64,'base64')});
  await assert.rejects(certifyMakerV8TrustedContext(value), (error) => {
    assert.equal(error.code, 'MAKER_V8_PROTOCOL_COMMITMENT_MISMATCH');
    value.protocolConfig.fields.commitment = error.details.expected;
    value.catalog.fields.protocolConfigCommitment = error.details.expected;
    return true;
  });
  Object.assign(value.configs.seal.fields, compilerSealPolicyFixture(value));
  const certified = await certifyMakerV8TrustedContext(value);
  return Object.fromEntries([
    'schemaVersion', 'chainIdentifier', 'signerAddress', 'paymentCoinType',
    'protocolProfile', 'coreArtifact', 'clock', 'protocolConfig', 'protocolTreasury',
    'catalog', 'configs', 'activationAuthority',
  ].map((field) => [field, clone(certified[field])]));
}

function runtimeAttestation(context, driftRole = null) {
  return {
    packageTuple: MAKER_V8_ROLE_ORDER.map((role, index) => ({
      role,
      originalPackageId: context.catalog.fields.roles[role].originalPackageId,
      callablePackageId: context.catalog.fields.roles[role].callablePackageId,
      packageDigest: role === driftRole ? '9'.repeat(44)
        : role === 'core' ? context.coreArtifact.packageDigest : String(index + 2).repeat(44),
    })),
    coreArtifact: clone(context.coreArtifact),
  };
}

function rootObjects(publication) {
  const context = publication.context;
  const core = context.catalog.fields.roles.core.originalPackageId;
  const total = Object.values(publication.counts).reduce((sum, value) => sum + value, 0n);
  return {
    root: shared(fixture.ids.root, `${core}::maker_v8::MakerRootV8<${COIN}>`, {
      version: 8,
      creator: context.signerAddress,
      owner: context.signerAddress,
      adminCapId: fixture.ids.adminCap,
      controlEpoch: '0',
      lifecycle: 0,
      makerKey: publication.document.lineage.makerKey,
      makerVersion: 1,
      previousRootId: null,
      previousVersionCommitment: null,
      versionCommitment: publication.commitments.version,
      sealedBaseRegistryCommitment: null,
      makerDocumentCommitment: publication.commitments.makerDocument,
      creatorDefaultsCommitment: publication.commitments.creatorDefaults,
      livingContentBindingCommitment: publication.commitments.livingContentBinding,
      rendererCommitment: publication.commitments.renderer,
      manifestBlobId: publication.manifest.blobId,
      manifestSha256: publication.manifest.sha256,
      contentCommitment: publication.commitments.content,
      protocolConfigId: fixture.ids.protocolConfig,
      protocolConfigRevision: '3',
      protocolConfigCommitment: context.protocolConfig.fields.commitment,
      baseRegistryId: fixture.ids.baseRegistry,
      makerTreasuryId: fixture.ids.makerTreasury,
      expectedBaseDefinitionCount: String(total),
      expectedBaseRegistryCommitment: publication.commitments.baseAuthorRows,
      expectedPackAdmissionPolicyCommitment: publication.commitments.packAdmissionPolicy,
      economicsCommitment: publication.commitments.economics,
      rightsCommitment: publication.commitments.rights,
      catalogId: fixture.ids.catalog,
      productBindingCommitment: context._derived.productBindingCommitment,
      callCapSetCommitment: context._derived.callCapSetCommitment,
    }),
    baseRegistry: shared(fixture.ids.baseRegistry, `${core}::base_registry_v8::BaseDefinitionRegistryV8`, {
      version: 8,
      rootId: nid(fixture.ids.root),
      makerVersion: 1,
      rootContentCommitment: publication.commitments.content,
      expectedCounts: Object.fromEntries(Object.entries(publication.counts).map(([key, value]) => [key, String(value)])),
      observedCounts: Object.fromEntries(Object.keys(publication.counts).map((key) => [key, '0'])),
      initialCommitments: {}, rollingCommitments: {}, sealedCommitments: null,
      authorRowsRollingCommitment: ZERO,
      colorSwatchCount: '0', totalCapacity: '0', ruleSelectorCount: '0', visibilityLeafCount: '0',
      nextSequence: '0',
      expectedSequenceCount: String(total),
      protectedStyleCount: '0',
      sealed: false,
    }),
    makerTreasury: shared(fixture.ids.makerTreasury, `${core}::treasury_v8::MakerTreasuryV8<${COIN}>`, {
      version: 8,
      rootId: nid(fixture.ids.root),
      makerVersion: 1,
      rootContentCommitment: publication.commitments.content,
    }),
    adminCap: owned(fixture.ids.adminCap, `${core}::maker_v8::MakerAdminCapV8`, {
      version: 8,
      rootId: nid(fixture.ids.root),
      owner: context.signerAddress,
      controlEpoch: '0',
    }),
  };
}

async function kindProof(transaction) {
  const bytes = await transaction.build({ onlyTransactionKind: true });
  return {
    transactionKindBytesBase64: toBase64(bytes),
    transactionKindSha256: await hashBytes(bytes),
  };
}

async function scaffoldRaw(publication, transaction, digest = DIGEST) {
  const raw = {
    schemaVersion: MAKER_V8_SCAFFOLD_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    transactionDigest: digest,
    ...await kindProof(transaction),
    ...rootObjects(publication),
  };
  const rules = await compileMakerV8RuleRows(publication.document.rules);
  const entries = MAKER_V8_BASE_CATEGORIES_V2.flatMap(([kind]) => publication.rows[kind].map((row, i) => ({
    kind, row, bytes: kind === 'rule' ? rules[i].bytes : [...MAKER_V8_BASE_ROW_BCS_V2[kind].serialize(row).toBytes()],
    ...(kind === 'rule' ? { commitment: rules[i].commitment } : {}),
  })));
  const author = await deriveMakerV8BaseAuthorCommitmentV2(entries);
  const storage = await deriveMakerV8BaseStorageCommitmentsV2({ rootId: fixture.ids.root, registryId: fixture.ids.baseRegistry,
    makerVersion: publication.document.lineage.version, entries });
  Object.assign(raw.baseRegistry.fields, { initialCommitments: clone(storage.initialCommitments),
    rollingCommitments: clone(storage.initialCommitments), authorRowsRollingCommitment: author.initialCommitment });
  await certifyMakerV8ScaffoldReadback(publication, raw);
  return raw;
}

async function compilerHarness(name = 'default', signerAddress = nid(fixture.ids.signer), configureDocument = null) {
  const document = clone(fixture.document);
  configureDocument?.(document);
  const transport = await transportFor(document);
  const template = await contextTemplate(transport);
  template.activationAuthority.livingBlob.owner.address = signerAddress;
  const blobs = new Map();
  const calls = {
    getBlob: 0,
    loadHead: 0,
    loadPlan: 0,
    loadTrustedContext: 0,
    recoverCheckpoint: 0,
    runtimeAttestation: 0,
  };
  const controls = { driftRole: null, head: null, plan: null, tamperHash: null };
  const persistence = {
    async getBlob(hash) {
      calls.getBlob += 1;
      const value = blobs.get(hash);
      if (!value) return null;
      const copy = clone(value);
      if (controls.tamperHash === hash) {
        copy.data = copy.data.endsWith('A')
          ? `${copy.data.slice(0, -1)}B` : `${copy.data.slice(0, -1)}A`;
      }
      return copy;
    },
    async loadHead() {
      calls.loadHead += 1;
      return controls.head && clone(controls.head);
    },
    async loadPlan() {
      calls.loadPlan += 1;
      return controls.plan && clone(controls.plan);
    },
  };
  const compilerRpc = {
    async loadTrustedContext({ signerAddress, transport: liveTransport }) {
      calls.loadTrustedContext += 1;
      return certifyMakerV8TrustedContext({
        ...clone(template),
        signerAddress,
        transport: clone(liveTransport),
      });
    },
    async recoverCheckpoint({ kind, publication, transaction, digest }) {
      calls.recoverCheckpoint += 1;
      assert.equal(kind, 'SCAFFOLD');
      return scaffoldRaw(publication, transaction, digest);
    },
  };
  const adapter = createMakerV8PublicationCompilerAdapterV8({
    persistence,
    compilerRpc,
    async loadRuntimeAttestation() {
      calls.runtimeAttestation += 1;
      return runtimeAttestation({
        ...clone(template),
        _derived: {},
      }, controls.driftRole);
    },
    now: () => 100,
  });
  const prepared = await adapter.prepare({
    document,
    transport,
    signerAddress,
    attemptNonce: `publication-adapter:${name}`,
  });
  controls.plan = clone(prepared.plan);
  prepared.blobs.forEach((blob) => blobs.set(blob.sha256, clone(blob)));
  return { adapter, prepared, persistence, compilerRpc, blobs, calls, controls, document, transport };
}

test('compiler adapter prepares an identity-valid exact v8 plan and rehydrates byte-for-byte', async () => {
  const value = await compilerHarness('prepare');
  const { plan } = value.prepared;
  await assertMakerV8PublicationPlanIdentityV8(plan);
  assert.equal(plan.current.kind, 'SCAFFOLD');
  assert.equal(plan.immutable.compilerAuthority.packageTuple.length, 7);
  assert.deepEqual(
    plan.current.targets,
    value.prepared.attested.transaction.getData().commands
      .filter((command) => command.$kind === 'MoveCall')
      .map((command) => `${command.MoveCall.package}::${command.MoveCall.module}::${command.MoveCall.function}`),
  );

  const beforeFresh = value.calls.loadTrustedContext;
  const rehydrated = await value.adapter.rehydrate({
    plan: clone(plan),
    head: null,
    transactionKindBytes: value.prepared.attested.transactionKindBytes,
    purpose: 'PREPARE_REREAD',
    requireFreshAuthority: false,
  });
  assert.equal(value.calls.loadTrustedContext, beforeFresh, 'cold historical rehydrate performs no live authority query');
  assert.equal(rehydrated.transactionKindBytes, value.prepared.attested.transactionKindBytes);
  assert.deepEqual(rehydrated.descriptor, value.prepared.attested.descriptor);
  assert.equal(rehydrated.authority, value.adapter.authority);
});

test('read-only transport preparation compiles one canonical Manifest before the real Walrus blob id', async () => {
  const value = await compilerHarness('transport-preparation');
  const blobCount = value.blobs.size;
  const runtimeReads = value.calls.runtimeAttestation;
  const prepared = await value.adapter.prepareTransportManifest({
    document: clone(value.document),
    signerAddress: nid(fixture.ids.signer),
    assetTransports: clone(value.transport.assets),
    livingContentTransport: clone(value.transport.livingContent),
    manifestBlobIdPlaceholder: 'walrus-mainnet-manifest-upload-pending-v8',
  });
  assert.equal(prepared.schemaVersion, MAKER_V8_PUBLICATION_TRANSPORT_PREPARATION_SCHEMA);
  assert.equal(prepared.signerAddress, nid(fixture.ids.signer));
  assert.equal(prepared.manifest.bytesBase64, value.transport.manifest.bytesBase64);
  assert.equal(prepared.manifest.sha256, value.prepared.plan.immutable.manifestSha256);
  assert.equal(prepared.manifest.byteLength, Buffer.from(prepared.manifest.bytesBase64, 'base64').length);
  assert.deepEqual(prepared.requiredAssets, value.transport.assets.map((asset) => {
    const bytes = Buffer.from(asset.bytesBase64, 'base64');
    return {
      assetId: asset.assetId,
      blobId: asset.blobId,
      mediaType: asset.mediaType,
      byteLength: bytes.length,
      sha256: value.prepared.plan.blobRefs.assets
        .find((entry) => entry.assetId === asset.assetId).blob.sha256,
    };
  }));
  assert.equal(value.calls.runtimeAttestation, runtimeReads + 1);
  assert.equal(value.blobs.size, blobCount, 'transport preparation performs no persistence write');

  const final = await value.adapter.prepare({
    document: clone(value.document),
    transport: clone(value.transport),
    signerAddress: nid(fixture.ids.signer),
    attemptNonce: 'publication-adapter:transport-final',
  });
  assert.equal(final.plan.immutable.manifestSha256, prepared.manifest.sha256);
  assert.notEqual(
    final.plan.immutable.compilerAuthority.trustedContextCommitment,
    undefined,
    'final preparation recompiles against fresh authority and the real Manifest blob id',
  );
  await assert.rejects(
    value.adapter.prepareTransportManifest({
      document: clone(value.document),
      signerAddress: nid(fixture.ids.signer),
      assetTransports: [],
      livingContentTransport: clone(value.transport.livingContent),
      manifestBlobIdPlaceholder: 'walrus-mainnet-manifest-upload-pending-v8',
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_ASSET_SET_DRIFT',
  );
  await assert.rejects(
    value.adapter.prepareTransportManifest({
      document: clone(value.document),
      signerAddress: nid(fixture.ids.signer),
      assetTransports: clone(value.transport.assets),
      livingContentTransport: clone(value.transport.livingContent),
      manifestBlobIdPlaceholder: 'walrus-mainnet-manifest-upload-pending-v8',
      uploadNow: true,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_ADAPTER_SHAPE_INVALID',
  );
});

test('transport and final preparation reject unbuildable Base rows before returning a scaffold plan', async () => {
  const value = await compilerHarness('base-budget-preflight');
  const document = clone(value.document);
  const style = document.parts[0].items[0].styles[0];
  document.tracks = Array.from({ length: 130 }, (_, index) => ({
    key: `track-${index}`.padEnd(128, 'x'), label: `Track ${index}`,
    renderOrder: index, locked: false,
  }));
  document.parts[0].items[0].styles = document.tracks.map((track, index) => ({
    ...clone(style), key: index === 0 ? style.key : `style-${index}`,
    displayOrder: index, trackKey: track.key,
  }));
  const transport = await transportFor(document);
  const before = { plan: clone(value.controls.plan), blobs: clone(value.blobs), calls: clone(value.calls) };
  const expected = error => error.code === 'MAKER_V8_TRANSACTION_LIMIT_UNSATISFIABLE'
    && error.details.phase === 'BASE_PREFLIGHT' && error.details.kind === 'part'
    && error.details.metrics.maxPureArgumentBytes > 16 * 1024
    && error.details.metrics.kindBytes < 96 * 1024;
  await assert.rejects(value.adapter.prepareTransportManifest({
    document, signerAddress: nid(fixture.ids.signer),
    assetTransports: transport.assets, livingContentTransport: transport.livingContent,
    manifestBlobIdPlaceholder: 'walrus-mainnet-manifest-upload-pending-v8',
  }), expected);
  await assert.rejects(value.adapter.prepare({
    document, transport, signerAddress: nid(fixture.ids.signer),
    attemptNonce: 'publication-adapter:base-budget-rejected',
  }), expected);
  assert.deepEqual(value.controls.plan, before.plan, 'failed preparation leaves the previous plan untouched');
  assert.deepEqual(value.blobs, before.blobs, 'failed preparation performs no persistence writes');
  assert.equal(value.calls.recoverCheckpoint, before.calls.recoverCheckpoint);
  assert.equal(value.calls.loadPlan, before.calls.loadPlan);
  assert.equal(value.calls.loadHead, before.calls.loadHead);
});

test('protected Base encryption identity uses original Release lineage', async () => {
  const value = await compilerHarness('protected-original-namespace');
  const document = bindMakerV8SourceAssets(value.document, value.transport.assets.map(asset => {
    const bytes = Buffer.from(asset.bytesBase64, 'base64');
    return { assetId: asset.assetId, mediaType: asset.mediaType, byteLength: bytes.length,
      sha256: Buffer.from(sourceSha256(bytes)).toString('hex') };
  }));
  document.parts[0].items[0].styles[0].protected = true;
  const prepared = await value.adapter.prepareProtectedAssetIdentities({
    document, signerAddress: nid(fixture.ids.signer), assetTransports: clone(value.transport.assets),
    manifestBlobIdPlaceholder: 'pending-manifest', livingContentTransport: clone(value.transport.livingContent),
  });
  assert.equal(prepared.assets.length, 1);
  assert.equal(prepared.assets[0].identity.releasePackageId, nid(fixture.packageRoles.release[0]));
  assert.notEqual(fixture.packageRoles.release[0], fixture.packageRoles.release[1]);
  const tampered = clone(value.transport.assets);
  const bytes = Buffer.from(tampered[0].bytesBase64, 'base64');
  bytes[0] ^= 1;
  tampered[0].bytesBase64 = bytes.toString('base64');
  await assert.rejects(value.adapter.prepareProtectedAssetIdentities({
    document, signerAddress: nid(fixture.ids.signer), assetTransports: tampered,
    manifestBlobIdPlaceholder: 'pending-manifest', livingContentTransport: clone(value.transport.livingContent),
  }), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
});

test('durable blob tamper and fresh seven-package digest drift fail closed', async () => {
  const value = await compilerHarness('tamper');
  value.controls.tamperHash = value.prepared.plan.blobRefs.document.sha256;
  await assert.rejects(
    value.adapter.rehydrate({
      plan: clone(value.prepared.plan),
      head: null,
      transactionKindBytes: value.prepared.attested.transactionKindBytes,
      purpose: 'RESUME_READY',
      requireFreshAuthority: false,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH',
  );

  value.controls.tamperHash = null;
  value.controls.driftRole = 'market';
  await assert.rejects(
    value.adapter.rehydrate({
      plan: clone(value.prepared.plan),
      head: null,
      transactionKindBytes: value.prepared.attested.transactionKindBytes,
      purpose: 'REQUEST_SIGNATURE',
      requireFreshAuthority: true,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_AUTHORITY_DRIFT',
  );
});

test('Living bundle bytes are bound into the existing durable context and cannot be substituted', async () => {
  const value = await compilerHarness('living-binding');
  const ref = value.prepared.plan.blobRefs.compilerContext;
  const contextBlob = value.blobs.get(ref.sha256);
  assert.ok(contextBlob, 'Living bytes reuse the existing compiler-context blob');
  assert.ok(JSON.stringify(contextBlob).includes(value.transport.livingContent.bytesBase64));
  const bad = clone(value.transport);
  bad.livingContent.bytesBase64 = toBase64(new Uint8Array([1, 2, 3]));
  await assert.rejects(value.adapter.prepare({ document: clone(value.document), transport: bad,
    signerAddress: nid(fixture.ids.signer), attemptNonce: 'living-substitution' }),
  error => error.code === 'MAKER_V8_ACTIVATION_AUTHORITY_INVALID');
  for (const method of ['prepareTransportManifest', 'prepareProtectedAssetIdentities']) {
    const input = { document: clone(value.document), signerAddress: nid(fixture.ids.signer),
      assetTransports: clone(value.transport.assets), manifestBlobIdPlaceholder: 'manifest-pending',
      livingContentTransport: clone(value.transport.livingContent) };
    await value.adapter[method](input);
    await assert.rejects(value.adapter[method]({ ...input, livingContentTransport: bad.livingContent }),
      error => ['MAKER_V8_LIVING_TRANSPORT_MISMATCH','MAKER_V8_ACTIVATION_AUTHORITY_INVALID'].includes(error.code));
    await assert.rejects(value.adapter[method]({ ...input, livingContentTransport: { ...input.livingContentTransport, sha256: 'ab'.repeat(32) } }));
    await assert.rejects(value.adapter[method]({ ...input, livingContentTransport: { ...input.livingContentTransport, bytesBase64: input.livingContentTransport.bytesBase64 + '\n' } }));
  }
  value.controls.tamperHash = ref.sha256;
  await assert.rejects(value.adapter.rehydrate({ plan: clone(value.prepared.plan), head: null,
    transactionKindBytes: value.prepared.attested.transactionKindBytes, purpose: 'RESUME_READY', requireFreshAuthority: false }),
  error => error.code === 'MAKER_V8_PUBLICATION_BLOB_HASH_MISMATCH');
});

test('finalized browser readback produces a fixed milestone capsule and O(1) successor boundary', async () => {
  const value = await compilerHarness('successor', nid(fixture.ids.signer), document => {
    document.colors = [{ key: 'primary', label: 'Primary', defaultSwatchKey: 'black', swatches: [
      { key: 'black', label: 'Black', rgba: '#000000ff', stops: [{ offset: 0, rgba: '#000000ff' }, { offset: 1, rgba: '#ffffffff' }] },
      { key: 'white', label: 'White', rgba: '#ffffffff', stops: [] },
    ] }];
    document.defaultRecipe.colors = [{ channelKey: 'primary', swatchKey: 'black' }];
    const style = clone(document.parts[0].items[0].styles[0]);
    style.key = 'digital'; style.physical = null;
    document.parts[0].items[0].styles.push(style);
    document.rules = [{ key: 'body-required', kind: 'REQUIRE',
      trigger: { source: 'BASE', sourceKey: null, partKey: 'body', itemKey: 'body', styleKey: null },
      targetMode: 'ALL', targets: [{ source: 'BASE', sourceKey: null, partKey: 'body', itemKey: 'body', styleKey: null }], payload: {} }];
  });
  const plan = clone(value.prepared.plan);
  const transaction = value.prepared.attested.transaction;
  const signer = plan.immutable.signerAddress;
  transaction.setGasOwner(signer);
  transaction.setGasBudget(10_000_000);
  transaction.setGasPrice(1_000);
  transaction.setGasPayment([{
    objectId: `0x${'ab'.repeat(32)}`,
    version: '1',
    digest: toBase58(new Uint8Array(32).fill(3)),
  }]);
  const bytes = await transaction.build();
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  plan.current.outcome = { status: 'SIGNED', digest };
  const query = await createMakerV8LiveDataSourceV8({
    runtime: {},
    client: {
      async getChainIdentifier() {
        return { chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER };
      },
      async getTransactionFinality() {
        return {
          digest,
          checkpoint: '18',
          epoch: '7',
          status: { success: true, error: null },
        };
      },
      core: {
        async getTransaction() {
          return {
            $kind: 'Transaction',
            Transaction: {
              digest,
              epoch: '7',
              status: { success: true },
              effects: {
                transactionDigest: digest,
                status: { success: true },
                eventsDigest: null,
                bcs: new Uint8Array([8, 7, 6]),
              },
            },
          };
        },
      },
    },
  }).queryTransaction({ digest });
  assert.match(query.effectsFingerprint, /^0x[0-9a-f]{64}$/);
  const freshReadsBeforeFinality = value.calls.runtimeAttestation;
  value.controls.driftRole = 'market';
  const capsule = await value.adapter.certifyFinalized({
    plan,
    query,
    attested: value.prepared.attested,
    artifacts: {
      bytes: toBase64(bytes),
      signature: toBase64(new Uint8Array([1])),
      digest,
      kindBytes: value.prepared.attested.transactionKindBytes,
    },
  });
  assert.equal(capsule.schemaVersion, MAKER_V8_PUBLICATION_CAPSULE_SCHEMA);
  assert.equal(capsule.milestones.scaffold.kind, 'SCAFFOLD');
  assert.equal(capsule.milestones.baseFinal, null);
  assert.equal(value.calls.recoverCheckpoint, 1);
  assert.equal(
    value.calls.runtimeAttestation,
    freshReadsBeforeFinality,
    'known finalized bytes are certified from exact historical readback, not mutable live authority',
  );
  value.controls.driftRole = null;

  const checkpointHash = 'cd'.repeat(32);
  const head = {
    schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA,
    attemptId: plan.attemptId,
    planId: plan.planId,
    ordinal: 0,
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
    fullTransactionRef: null,
    signatureRef: null,
    digest,
    certificate: {
      source: 'FINALIZED_RPC',
      transactionDigest: digest,
      transactionKindSha256: plan.current.transactionKindSha256,
      readbackSha256: 'ab'.repeat(32),
    },
    readback: {
      schemaVersion: 'animacraft.maker-v8-publication-finalized-readback.v1',
      source: 'FINALIZED_RPC',
      transactionDigest: digest,
      transactionKindSha256: plan.current.transactionKindSha256,
      compiler: capsule,
    },
    submissionSource: 'WALLET',
    checkpointSha256: checkpointHash,
    previousCheckpointSha256: null,
    finalizedAt: 101,
  };
  const successorPlan = clone(value.prepared.plan);
  successorPlan.revision = 2;
  successorPlan.updatedAt = 101;
  successorPlan.head = {
    ordinal: 0,
    digest,
    transactionKindSha256: plan.current.transactionKindSha256,
    checkpointSha256: checkpointHash,
    phase: plan.current.phase,
    lane: plan.current.lane,
  };
  successorPlan.current = null;
  successorPlan.nextPreparation = { status: 'REQUIRED', ordinal: 1, reason: null };
  await assertMakerV8PublicationPlanIdentityV8(successorPlan);
  const identity = await value.adapter.describeFinalized(successorPlan, head);
  assert.equal(identity.rootId, capsule.milestones.scaffold.readback.root.reference.objectId);
  assert.equal(identity.makerVersion, value.document.lineage.version);
  assert.equal(identity.complete, false, 'certified scaffold is not a complete published Maker');
  value.calls.getBlob = 0;
  const successor = await value.adapter.prepareSuccessor({
    plan: successorPlan,
    head,
    requireFreshAuthority: true,
  });
  assert.equal(successor.descriptor.ordinal, 1);
  assert.equal(successor.descriptor.kind, 'BASE_CHUNK');
  const successorCommands = successor.transaction.getData().commands;
  for (const name of ['none', 'some']) assert.ok(successorCommands.some(c => c.MoveCall?.module === 'option' && c.MoveCall.function === name));
  for (const name of ['ColorStopV2', 'ColorSwatchV2', 'SemanticSelectorV2']) assert.ok(successorCommands.some(c => c.MakeMoveVec?.type.endsWith(`::${name}`)));
  const readySuccessor = clone(successorPlan);
  const successorBlob = await makerV8Base64BlobV8(successor.transactionKindBytes);
  readySuccessor.current = { ...clone(successor.descriptor), transactionKindRef: makerV8BlobRefV8(successorBlob),
    fullTransactionRef: null, signatureRef: null, outcome: { status: 'READY' } };
  readySuccessor.nextPreparation = null;
  await assertMakerV8PublicationPlanIdentityV8(readySuccessor);
  const indexedDB = new IDBFactory();
  const store = createMakerV8PublicationPersistenceV8(indexedDB, { databaseName: 'real-compiler-successor',
    storageManager: { async persisted() { return true; }, async persist() { return true; } } });
  await store.requirePersistentStorage();
  await store.createAttempt(value.prepared.plan, value.prepared.blobs);
  const event = (status, sequence, previous = null) => {
    const result = { schemaVersion: MAKER_V8_PUBLICATION_PERSISTENCE_SCHEMA, attemptId: plan.attemptId, ordinal: 0, sequence,
      status, digest, kindSha256: plan.current.transactionKindSha256, fullTransactionRef: null, signatureRef: null,
      details: { source: 'EXTERNAL_FINALIZED', at: 101 + sequence, code: null, signedAt: null, firstSeenAt: 101, broadcastAt: null },
      observedAt: 101 + sequence, previousAttemptSha256: previous?.eventSha256 ?? null,
      previousGlobalAttemptSha256: previous?.eventSha256 ?? null, eventSha256: '0'.repeat(64) };
    result.eventSha256 = makerV8PublicationAttemptSha256V8(result); return result;
  };
  const pendingEvent = event('EXTERNAL_PENDING', 0);
  const pending = { ...clone(value.prepared.plan), revision: 2, updatedAt: 101,
    attemptHistory: { totalEvents: 1, excessEvents: 0, globalAttemptHeadSha256: pendingEvent.eventSha256 } };
  pending.current.outcome = { status: 'OUTCOME_PENDING', digest, kindSha256: plan.current.transactionKindSha256,
    signedAt: null, firstSeenAt: 101, source: 'EXTERNAL_FINALIZED', broadcastAt: null, observedAt: 101 };
  await store.compareAndSwap(plan.attemptId, 1, pending, { attempt: pendingEvent });
  const durableHead = clone(head);
  durableHead.submissionSource = 'EXTERNAL_FINALIZED'; durableHead.finalizedAt = 102;
  durableHead.certificate.readbackSha256 = (await makerV8Utf8BlobV8(canonicalMakerV8Json(durableHead.readback))).sha256;
  durableHead.checkpointSha256 = await makerV8PublicationCheckpointSha256V8(durableHead);
  const successEvent = event('FINALIZED_SUCCESS', 1, pendingEvent);
  const finalized = { ...clone(successorPlan), revision: 3, updatedAt: 102,
    attemptHistory: { totalEvents: 2, excessEvents: 0, globalAttemptHeadSha256: successEvent.eventSha256 } };
  finalized.head.checkpointSha256 = durableHead.checkpointSha256;
  await store.compareAndSwap(plan.attemptId, 2, finalized, { checkpoint: durableHead, attempt: successEvent });
  const installed = await store.compareAndSwap(plan.attemptId, 3, { ...finalized, revision: 4, updatedAt: 103,
    current: readySuccessor.current, nextPreparation: null }, { blobs: [successorBlob] });
  const coldStore = createMakerV8PublicationPersistenceV8(indexedDB, { databaseName: 'real-compiler-successor' });
  const restored = await coldStore.loadPlan(plan.attemptId);
  assert.deepEqual(restored, installed);
  const coldCompiler = createMakerV8PublicationCompilerAdapterV8({ persistence: coldStore,
    compilerRpc: value.compilerRpc, loadRuntimeAttestation() { throw new Error('cold recovery must not query authority'); } });
  const cold = await coldCompiler.rehydrate({ plan: restored, head: await coldStore.loadHead(plan.attemptId),
    transactionKindBytes: successor.transactionKindBytes, purpose: 'RESUME_READY', requireFreshAuthority: false });
  assert.equal(cold.transactionKindBytes, successor.transactionKindBytes);
  assert.equal(value.calls.getBlob, 3 + successorPlan.blobRefs.assets.length);
  assert.equal(value.calls.loadHead, 0, 'successor consumes one passed head and never scans history');

  const tamperedHead = clone(head);
  tamperedHead.readback.compiler.milestones.scaffold.readback.transactionKindSha256 = 'ff'.repeat(32);
  await assert.rejects(value.adapter.describeFinalized(successorPlan, tamperedHead));
  await assert.rejects(
    value.adapter.prepareSuccessor({
      plan: successorPlan,
      head: tamperedHead,
      requireFreshAuthority: true,
    }),
    (error) => [
      'MAKER_V8_PUBLICATION_CAPSULE_INVALID',
      'MAKER_V8_PUBLICATION_TRANSACTION_KIND_INVALID',
    ].includes(error.code),
  );
});

function boundaryTransaction(keypair) {
  const signer = keypair.toSuiAddress();
  const transaction = new Transaction();
  transaction.setSender(signer);
  transaction.moveCall({
    target: `0x${'31'.repeat(32)}::core_v8::publication_boundary_probe_v8`,
    arguments: [transaction.pure.u8(8)],
  });
  transaction.setGasOwner(signer);
  transaction.setGasBudget(10_000_000);
  transaction.setGasPrice(1_000);
  transaction.setGasPayment([{
    objectId: `0x${'32'.repeat(32)}`,
    version: '1',
    digest: toBase58(new Uint8Array(32).fill(4)),
  }]);
  return transaction;
}

function setBoundaryGas(transaction, signer, fill = 4) {
  transaction.setGasOwner(signer);
  transaction.setGasBudget(10_000_000);
  transaction.setGasPrice(1_000);
  transaction.setGasPayment([{
    objectId: `0x${'32'.repeat(32)}`,
    version: '1',
    digest: toBase58(new Uint8Array(32).fill(fill)),
  }]);
  return transaction;
}

test('gRPC boundary binds canonical sender/kind/digest/signature and never broadcasts early', async () => {
  const keypair = new Ed25519Keypair();
  const signer = keypair.toSuiAddress();
  const compiler = await compilerHarness('boundary', signer);
  const transaction = setBoundaryGas(compiler.prepared.attested.transaction, signer);
  const duplicate = setBoundaryGas((await compiler.adapter.rehydrate({
    plan: clone(compiler.prepared.plan),
    head: null,
    transactionKindBytes: compiler.prepared.attested.transactionKindBytes,
    purpose: 'BOUNDARY_DUPLICATE',
    requireFreshAuthority: false,
  })).transaction, signer);
  const expectedKindBytes = toBase64(await transaction.build({ onlyTransactionKind: true }));
  const calls = { simulate: 0, execute: 0, chain: 0 };
  const controls = { driftAt: null };
  const simulationDigest = toBase58(new Uint8Array(32).fill(6));
  const client = {
    async getChainIdentifier() {
      calls.chain += 1;
      return {
        chainIdentifier: calls.chain === controls.driftAt
          ? 'not-mainnet' : MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
      };
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '19' } }; },
      async simulateTransaction({ transaction: bytes }) {
        calls.simulate += 1;
        const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
        return {
          $kind: 'Transaction',
          Transaction: {
            digest,
            status: { success: true },
            effects: { transactionDigest: simulationDigest, status: { success: true } },
          },
        };
      },
      async executeTransaction({ transaction: bytes }) {
        calls.execute += 1;
        const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
        return {
          $kind: 'Transaction',
          Transaction: {
            digest,
            effects: { transactionDigest: digest, status: { success: true } },
          },
        };
      },
    },
  };
  const boundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: compiler.adapter.authority,
    execution: {
      network: 'mainnet',
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: true,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  await assert.rejects(
    boundary.buildExactTransaction({
      transaction: boundaryTransaction(keypair),
      sender: signer,
      expectedKindBytes: toBase64(await boundaryTransaction(keypair).build({ onlyTransactionKind: true })),
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_COMPILER_KIND_PROOF_REQUIRED',
  );
  const built = await boundary.buildExactTransaction({ transaction, sender: signer, expectedKindBytes });
  const duplicateBuilt = await boundary.buildExactTransaction({
    transaction: duplicate,
    sender: signer,
    expectedKindBytes,
  });
  assert.equal(Transaction.from(Buffer.from(duplicateBuilt.bytes, 'base64')).getData().expiration.ValidDuring.maxEpoch, '20');
  const expiration = Transaction.from(Buffer.from(built.bytes, 'base64')).getData().expiration.ValidDuring;
  assert.equal(expiration.minEpoch, '19');
  assert.equal(expiration.maxEpoch, '20');
  assert.equal(expiration.chain, MAKER_V8_SUI_MAINNET_GENESIS_DIGEST);
  assert.equal(calls.execute, 0);
  const dryRun = await boundary.dryRunExactTransaction({
    bytes: built.bytes,
    transactionBytes: built.bytes,
    digest: built.digest,
    signer,
    expectedKindBytes,
    transaction,
  });
  assert.equal(dryRun.status, 'SUCCESS');
  assert.equal(calls.simulate, 1);
  assert.equal(calls.execute, 0);
  const signed = await keypair.signTransaction(Buffer.from(built.bytes, 'base64'));
  await assert.rejects(
    boundary.broadcastExactTransaction({
      bytes: built.bytes,
      signature: signed.signature,
      digest: DIGEST,
      signer,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_TRANSACTION_DATA_DRIFT',
  );
  assert.equal(calls.execute, 0);
  const restartedBoundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: compiler.adapter.authority,
    execution: {
      network: 'mainnet',
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: true,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  await assert.rejects(
    restartedBoundary.broadcastExactTransaction({
      bytes: built.bytes,
      signature: signed.signature,
      digest: built.digest,
      signer,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_COMPILER_TRANSACTION_PROOF_REQUIRED',
  );
  assert.equal(calls.execute, 0, 'build and dry-run never grant a broadcast capability before the WAL');

  const [fullBlob, signatureBlob] = await Promise.all([
    makerV8Base64BlobV8(built.bytes),
    makerV8Base64BlobV8(signed.signature),
  ]);
  const signedPlan = {
    ...clone(compiler.prepared.plan),
    revision: 2,
    updatedAt: 101,
    current: {
      ...clone(compiler.prepared.plan.current),
      fullTransactionRef: makerV8BlobRefV8(fullBlob),
      signatureRef: makerV8BlobRefV8(signatureBlob),
      outcome: {
        status: 'SIGNED',
        digest: built.digest,
        kindSha256: compiler.prepared.plan.current.transactionKindSha256,
        signedAt: 101,
      },
    },
  };
  await assertMakerV8PublicationPlanIdentityV8(signedPlan);
  const coldCompiler = createMakerV8PublicationCompilerAdapterV8({
    persistence: compiler.persistence,
    compilerRpc: compiler.compilerRpc,
    loadRuntimeAttestation() {
      throw new Error('historical cold recovery must not query mutable runtime authority');
    },
  });
  await assert.rejects(
    coldCompiler.rehydrate({
      plan: clone(signedPlan),
      head: null,
      transactionKindBytes: compiler.prepared.attested.transactionKindBytes,
      purpose: 'FORGED_COLD_REPLAY',
      requireFreshAuthority: false,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_DURABLE_PLAN_DRIFT',
  );
  compiler.controls.plan = clone(signedPlan);
  await assert.rejects(
    coldCompiler.rehydrate({
      plan: clone(signedPlan),
      head: null,
      transactionKindBytes: compiler.prepared.attested.transactionKindBytes,
      purpose: 'MISSING_WAL_ARTIFACT_REPLAY',
      requireFreshAuthority: false,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_BLOB_MISSING',
  );
  compiler.blobs.set(fullBlob.sha256, clone(fullBlob));
  const wrongSigned = await new Ed25519Keypair().signTransaction(Buffer.from(built.bytes, 'base64'));
  const wrongSignatureBlob = await makerV8Base64BlobV8(wrongSigned.signature);
  const wrongSignaturePlan = {
    ...clone(signedPlan),
    current: {
      ...clone(signedPlan.current),
      signatureRef: makerV8BlobRefV8(wrongSignatureBlob),
    },
  };
  compiler.controls.plan = clone(wrongSignaturePlan);
  compiler.blobs.set(wrongSignatureBlob.sha256, clone(wrongSignatureBlob));
  const invalidSignatureCompiler = createMakerV8PublicationCompilerAdapterV8({
    persistence: compiler.persistence,
    compilerRpc: compiler.compilerRpc,
    loadRuntimeAttestation() {
      throw new Error('historical invalid-signature proof must not query mutable runtime authority');
    },
  });
  await invalidSignatureCompiler.rehydrate({
    plan: clone(wrongSignaturePlan),
    head: null,
    transactionKindBytes: compiler.prepared.attested.transactionKindBytes,
    purpose: 'INVALID_SIGNATURE_COLD_REPLAY',
    requireFreshAuthority: false,
  });
  const invalidSignatureBoundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: invalidSignatureCompiler.authority,
    execution: {
      network: 'mainnet',
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: true,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  await assert.rejects(
    invalidSignatureBoundary.broadcastExactTransaction({
      bytes: built.bytes,
      signature: signed.signature,
      digest: built.digest,
      signer,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_COMPILER_TRANSACTION_PROOF_REQUIRED',
  );
  await assert.rejects(
    invalidSignatureBoundary.broadcastExactTransaction({
      bytes: built.bytes,
      signature: wrongSigned.signature,
      digest: built.digest,
      signer,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_SIGNATURE_INVALID',
  );
  assert.equal(calls.execute, 0, 'a canonical but wrong durable signature cannot mint an executable capability');

  compiler.controls.plan = clone(signedPlan);
  compiler.blobs.set(signatureBlob.sha256, clone(signatureBlob));
  await coldCompiler.rehydrate({
    plan: clone(signedPlan),
    head: null,
    transactionKindBytes: compiler.prepared.attested.transactionKindBytes,
    purpose: 'EXACT_COLD_REPLAY',
    requireFreshAuthority: false,
  });
  const coldBoundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: coldCompiler.authority,
    execution: {
      network: 'mainnet',
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: true,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  controls.driftAt = calls.chain + 2;
  await assert.rejects(
    coldBoundary.broadcastExactTransaction({
      bytes: built.bytes,
      signature: signed.signature,
      digest: built.digest,
      signer,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_NETWORK_DRIFT',
  );
  assert.equal(calls.execute, 0, 'network is freshly pinned after signature verification and before execute');
  controls.driftAt = null;
  assert.deepEqual(await coldBoundary.broadcastExactTransaction({
    bytes: built.bytes,
    signature: signed.signature,
    digest: built.digest,
    signer,
  }), { accepted: true, digest: built.digest });
  assert.equal(calls.execute, 1, 'cold compiler reread authorizes the durable digest without rebuilding TransactionData');
  assert.equal('executeTransactionBlock' in client, false);
  assert.equal('dryRunTransactionBlock' in client, false);
});

test('cold authority retains two distinct valid multisig signatures for one exact digest', async () => {
  const first = new Ed25519Keypair();
  const second = new Ed25519Keypair();
  const multisig = MultiSigPublicKey.fromPublicKeys({
    threshold: 1,
    publicKeys: [
      { publicKey: first.getPublicKey(), weight: 1 },
      { publicKey: second.getPublicKey(), weight: 1 },
    ],
  });
  const signer = multisig.toSuiAddress();
  const compiler = await compilerHarness('multisig-signature-set', signer);
  const transaction = setBoundaryGas(compiler.prepared.attested.transaction, signer, 7);
  const expectedKindBytes = compiler.prepared.attested.transactionKindBytes;
  let execute = 0;
  const client = {
    async getChainIdentifier() {
      return { chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST };
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '22' } }; },
      async executeTransaction({ transaction: bytes }) {
        execute += 1;
        const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
        return {
          $kind: 'Transaction',
          Transaction: {
            digest,
            effects: { transactionDigest: digest, status: { success: true } },
          },
        };
      },
    },
  };
  const builderBoundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: compiler.adapter.authority,
    execution: {
      network: 'mainnet',
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: true,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  const built = await builderBoundary.buildExactTransaction({
    transaction,
    sender: signer,
    expectedKindBytes,
  });
  const transactionBytes = Buffer.from(built.bytes, 'base64');
  const [firstPartial, secondPartial] = await Promise.all([
    first.signTransaction(transactionBytes),
    second.signTransaction(transactionBytes),
  ]);
  const signatures = [
    multisig.combinePartialSignatures([firstPartial.signature]),
    multisig.combinePartialSignatures([secondPartial.signature]),
  ];
  assert.notEqual(signatures[0], signatures[1]);
  const fullBlob = await makerV8Base64BlobV8(built.bytes);
  compiler.blobs.set(fullBlob.sha256, clone(fullBlob));

  const coldCompiler = createMakerV8PublicationCompilerAdapterV8({
    persistence: compiler.persistence,
    compilerRpc: compiler.compilerRpc,
    loadRuntimeAttestation() {
      throw new Error('multisig cold recovery must not query mutable runtime authority');
    },
  });
  for (const [index, signature] of signatures.entries()) {
    const signatureBlob = await makerV8Base64BlobV8(signature);
    compiler.blobs.set(signatureBlob.sha256, clone(signatureBlob));
    const plan = {
      ...clone(compiler.prepared.plan),
      revision: index + 2,
      updatedAt: 101 + index,
      current: {
        ...clone(compiler.prepared.plan.current),
        fullTransactionRef: makerV8BlobRefV8(fullBlob),
        signatureRef: makerV8BlobRefV8(signatureBlob),
        outcome: {
          status: 'SIGNED',
          digest: built.digest,
          kindSha256: compiler.prepared.plan.current.transactionKindSha256,
          signedAt: 101 + index,
        },
      },
    };
    compiler.controls.plan = clone(plan);
    await coldCompiler.rehydrate({
      plan: clone(plan),
      head: null,
      transactionKindBytes: expectedKindBytes,
      purpose: `MULTISIG_COLD_REPLAY_${index}`,
      requireFreshAuthority: false,
    });
  }
  const coldBoundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: coldCompiler.authority,
    execution: {
      network: 'mainnet',
      chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
      allowWalletSignature: true,
      allowBroadcast: true,
    },
    assertTransport(value) { assert.equal(value, client); },
  });
  for (const signature of signatures) {
    assert.deepEqual(await coldBoundary.broadcastExactTransaction({
      bytes: built.bytes,
      signature,
      digest: built.digest,
      signer,
    }), { accepted: true, digest: built.digest });
  }
  assert.equal(execute, 2);
});

test('adapters reject shape injection, unbranded production transport, and disabled broadcast', async () => {
  const value = await compilerHarness('shape');
  await assert.rejects(
    value.adapter.prepare({
      document: value.document,
      transport: value.transport,
      signerAddress: nid(fixture.ids.signer),
      attemptNonce: 'extra-field',
      legacyRestore: true,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_ADAPTER_SHAPE_INVALID',
  );
  assert.throws(
    () => createProductionMakerV8PublicationAdaptersV8({
      client: {}, runtime: {}, persistence: {}, execution: {},
    }),
    (error) => error.code === 'MAKER_V8_SUI_GRPC_TRANSPORT_INVALID',
  );

  const keypair = new Ed25519Keypair();
  const signer = keypair.toSuiAddress();
  const compiler = await compilerHarness('disabled-boundary', signer);
  const transaction = setBoundaryGas(compiler.prepared.attested.transaction, signer);
  const client = {
    async getChainIdentifier() {
      return { chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST };
    },
    core: {
      async getCurrentSystemState() { return { systemState: { epoch: '1' } }; },
    },
  };
  const boundary = createMakerV8PublicationBoundaryAdapterV8({
    client,
    compilerAuthority: compiler.adapter.authority,
    assertTransport: () => client,
  });
  const expectedKindBytes = toBase64(await transaction.build({ onlyTransactionKind: true }));
  const built = await boundary.buildExactTransaction({
    transaction,
    sender: signer,
    expectedKindBytes,
  });
  const signed = await keypair.signTransaction(Buffer.from(built.bytes, 'base64'));
  await assert.rejects(
    boundary.broadcastExactTransaction({
      bytes: built.bytes,
      signature: signed.signature,
      digest: built.digest,
      signer,
    }),
    (error) => error.code === 'MAKER_V8_PUBLICATION_EXECUTION_DISABLED',
  );
});

test('production factory returns one exact controller DI bundle with the same frozen execution gates', () => {
  const execution = Object.freeze({
    network: 'mainnet',
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    allowWalletSignature: false,
    allowBroadcast: false,
  });
  const persistence = controllerPersistenceStub();
  const walletAdapter = Object.freeze({
    async getCurrentAccount() { return { address: nid(fixture.ids.signer), network: 'mainnet' }; },
    async reconnect() { return this.getCurrentAccount(); },
    async signExactTransaction() { throw new Error('not exercised'); },
    async verifyExactSignature() { return false; },
    subscribe() { return () => {}; },
    dispose() {},
  });
  const production = createProductionMakerV8PublicationAdaptersV8({
    runtime: productionRuntimeFixture(),
    persistence,
    execution,
    walletAdapter,
    dataSource: browserDataSourceStub(),
    walletRegistry: {
      get() { return []; },
      on() { return () => {}; },
    },
  });
  assert.deepEqual(Object.keys(production).sort(), [
    'boundary', 'client', 'compiler', 'execution', 'persistence', 'rpc', 'schemaVersion', 'wallet',
  ]);
  assert.equal(production.persistence, persistence);
  assert.equal(production.execution, production.boundary.execution);
  assert.equal(production.wallet, walletAdapter);
  assert.equal(Object.isFrozen(production.execution), true);
  assert.deepEqual(production.execution, execution);
  assert.doesNotThrow(() => createMakerV8PublicationControllerV8(production));
});
