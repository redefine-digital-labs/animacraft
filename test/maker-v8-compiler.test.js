import assert from 'node:assert/strict';
import { compilerSealPolicyFixture } from './fixtures/maker-v8-compiler-seal-policy.js';
import { createDefaultMakerV8LivingContentV8 } from '../maker-v8-living-content.js';
import { compileMakerV8LivingContentV8, deriveMakerV8LivingContentBindingV8 } from '../maker-v8-living-content-compiler.js';
import { MAKER_V8_BASE_ROW_BCS_V2 } from '../maker-v8-base-rows.js';
import { deriveMakerV8BaseAuthorCommitmentV2, deriveMakerV8BaseStorageCommitmentsV2, MAKER_V8_BASE_CATEGORIES_V2 } from '../maker-v8-base-commitments.js';
import { compileMakerV8RuleRows } from '../maker-v8-compiler.js';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makerV8ActivationAuthorityFixture, makerV8LivingBlobIdFixture } from './fixtures/maker-v8-activation-authority-fixture.js';
import { Transaction } from '@mysten/sui/transactions';
import { deriveMakerV8SealStorageV2 } from '../maker-v8-seal-compiler.js';
import { bcs } from '@mysten/sui/bcs';
import {
  MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
} from '../maker-v8-chain.js';
import { MAKER_V8_PAYMENT_COIN_TYPE } from '../maker-v8-runtime.js';
import {
  MAKER_V8_DOCUMENT_LIMITS,
  assertMakerV8Document,
  compareMakerV8ProtocolText,
} from '../maker-v8-document.js';
import { assertMakerV8CompilerContextFreshV8 } from '../maker-v8-browser.js';
import { assertMakerV8Manifest } from '../maker-v8-manifest-adapter.js';

import {
  MAKER_V8_BASE_READBACK_SCHEMA,
  MAKER_V8_BASE_CHUNK_READBACK_SCHEMA,
  MAKER_V8_ACTIVATION_CHUNK_READBACK_SCHEMA,
  MAKER_V8_ACTIVATION_READBACK_SCHEMA,
  MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE,
  MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE_COMMITMENT,
  MAKER_V8_COMMITMENT_FIXTURE_SCHEMA,
  MAKER_V8_COMPANION_READBACK_SCHEMA,
  MAKER_V8_PUBLICATION_COMPILER_ABI,
  MAKER_V8_TRANSACTION_LIMITS,
  MAKER_V8_PUBLICATION_TOPOLOGY,
  MAKER_V8_ROLE_ORDER,
  MAKER_V8_SCAFFOLD_READBACK_SCHEMA,
  MAKER_V8_TRUSTED_CONTEXT_SCHEMA,
  buildMakerV8ActivationChunkTransaction,
  buildMakerV8BaseChunkTransaction,
  buildMakerV8CompanionObjectsTransaction,
  buildMakerV8ScaffoldTransaction,
  canonicalMakerV8Json,
  certifyMakerV8BaseReadback,
  certifyMakerV8BaseChunkReadback,
  certifyMakerV8ActivationChunkReadback,
  certifyMakerV8CompanionReadback,
  certifyMakerV8ScaffoldReadback,
  certifyMakerV8SuccessorPredecessorV8,
  certifyMakerV8TrustedContext,
  compileMakerV8Publication,
  deriveMakerV8ReleaseCommitments,
  exactMakerV8TransactionTargets,
  rehydrateMakerV8ActivationChunkCertificateV8,
  rehydrateMakerV8BaseChunkCertificateV8,
} from '../maker-v8-compiler.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/maker-v8-compiler-v1.json', import.meta.url), 'utf8'));
fixture.document.livingContent = createDefaultMakerV8LivingContentV8(fixture.document.metadata);
fixture.expected = {
  manifestSha256: '2503b9d479aeffca31fdd9b01b072f51bf46123071e52698e4012899bf7a383a',
  contentCommitment: '71223935cb78ff24ea844a4abbdf60f0e28f27fa091b753c180a5c8280721e34',
  baseAggregateCommitment: '3fedbdaf1776485e1f713f5f1259fdc3354466c1596d8023842c6c5a0730a241',
  runtimePolicyCommitment: 'fd95a3a98bec50700cab5d2663122d7935351d3a03be80f7477be1d1aadbfa1f',
};
const ZERO = '00'.repeat(32);
const COIN = MAKER_V8_PAYMENT_COIN_TYPE;
const DIGEST = '11111111111111111111111111111111';
const MARKERS = {
  core: ['protocol_config_v8', 'CorePackageMarkerV8', 'CorePackageMarkerV8'],
  seal: ['seal_v8', 'SealOriginalMarkerV8', 'SealCallableMarkerV8'],
  runtime: ['runtime_v8', 'RuntimeOriginalMarkerV8', 'RuntimeCallableMarkerV8'],
  output: ['output_v8', 'OutputOriginalMarkerV8', 'OutputCallableMarkerV8'],
  physical: ['physical_v8', 'PhysicalOriginalMarkerV8', 'PhysicalCallableMarkerV8'],
  market: ['market_v8', 'MarketOriginalMarkerV8', 'MarketCallableMarkerV8'],
  release: ['release_v8', 'ReleaseOriginalMarkerV8', 'ReleaseCallableMarkerV8'],
};
const nid = (value) => `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
const ntype = (value) => value.replace(/0x[0-9a-fA-F]{1,64}/g, nid);
const clone = (value) => structuredClone(value);
function addVisibilityTarget(document) {
  const target = clone(document.parts[0]);
  Object.assign(target, { key: 'visibility-target', menuOrder: 1, renderOrder: 1 });
  document.parts.push(target);
  document.defaultRecipe.selections.push({ partKey: target.key, itemKey: target.items[0].key, styleKey: target.items[0].defaultStyleKey });
}
const hashBytes = async (bytes) => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
// Independently encode the current Move declaration, not the compiler's
// expected-error value or its shared production hashing implementation.
const protocolMove = await readFile(new URL('../move/animacraft_v8_core/sources/protocol_config_v8.move', import.meta.url), 'utf8');
const protocolFieldsFromMove = /public struct ProtocolConfigCommitmentInputV2 has drop \{([^}]+)\}/.exec(protocolMove)[1]
  .split(',').map(value => value.trim()).filter(Boolean).map(value => value.split(':').map(part => part.trim()));
const protocolPrimitives = { String: bcs.string(), u64: bcs.u64(), u16: bcs.u16(), bool: bcs.bool(), ID: bcs.Address, 'Option<ID>': bcs.option(bcs.Address) };
const protocolMoveSchema = bcs.struct('CompilerTestProtocolInputFromMoveV2', Object.fromEntries(protocolFieldsFromMove.map(([name, type]) => {
  assert.ok(protocolPrimitives[type], `supported actual Move type ${type}`); return [name, protocolPrimitives[type]];
})));
const protocolMoveDomain = /domain: b"([^"]+)"\.to_string\(\)/.exec(protocolMove.slice(protocolMove.indexOf('fun refresh_commitment')))[1];
const protocolMoveVersion = /const VERSION: u64 = (\d+);/.exec(protocolMove)[1];
function protocolMoveValues(context) {
  const f = context.protocolConfig.fields;
  return { domain: protocolMoveDomain, schema_revision: protocolMoveVersion,
    config_id: nid(context.protocolConfig.reference.objectId), config_revision: f.revision, enabled: f.enabled,
    core_original_package_id: nid(f.coreOriginalPackageId), core_callable_package_id: nid(f.coreCallablePackageId),
    treasury_id: f.treasuryId === null ? null : nid(f.treasuryId), payment_coin_type: ntype(f.paymentCoinType),
    primary_content_fee_bps: f.primaryContentFeeBps, fixed_complete_fee_atomic: f.fixedCompleteFeeAtomic,
    maker_market_fee_bps: f.makerMarketFeeBps, soul_market_fee_bps: f.soulMarketFeeBps };
}
const protocolCommitmentFromMove = context => hashBytes(protocolMoveSchema.serialize(protocolMoveValues(context)).toBytes());
const shared = (objectId, type, fields) => ({ type: ntype(type), reference: { kind: 'shared', objectId, initialSharedVersion: '1' }, fields });
const owned = (objectId, type, fields) => ({ type: ntype(type), reference: { kind: 'owned', objectId, version: '1', digest: DIGEST }, fields });
const immutable = (objectId, type, fields) => ({ type: ntype(type), reference: { kind: 'immutable', objectId, version: '1', digest: DIGEST }, fields });

function publicProjection(document) {
  const projection = clone(document);
  projection.parts = projection.parts.map((part) => ({ ...part, items: part.items.filter((item) => item.status === 'PUBLIC') }));
  return projection;
}

async function certifiedTransport(document, assets) {
  const rows = [];
  for (const asset of assets) {
    const bytes = Buffer.from(asset.bytesBase64, 'base64');
    rows.push({ assetId: asset.assetId, blobId: asset.blobId, mediaType: asset.mediaType, byteLength: bytes.length, sha256: await hashBytes(bytes) });
  }
  rows.sort((a, b) => compareMakerV8ProtocolText(a.assetId, b.assetId));
  const manifest = canonicalMakerV8Json({ schemaVersion: 'animacraft.maker-v8-manifest.v2', protocolVersion: 8, document: publicProjection(document), certifiedAssets: rows });
  const living = await compileMakerV8LivingContentV8(document);
  return { manifest: { blobId: 'walrus-manifest-small-v8', bytesBase64: Buffer.from(manifest).toString('base64') }, assets: clone(assets), livingContent: { blobId: await makerV8LivingBlobIdFixture(Uint8Array.from(living.bytes)), blobObjectId: nid('0x9001'), bytesBase64: Buffer.from(living.bytes).toString('base64') } };
}

async function releaseTuple() {
  const roles = {};
  for (const [index, role] of MAKER_V8_ROLE_ORDER.entries()) {
    const [originalPackageId, callablePackageId] = fixture.packageRoles[role];
    const [module, originalMarker, callableMarker] = MARKERS[role];
    roles[role] = {
      originalPackageId, callablePackageId,
      sourceCommitment: (index + 1).toString(16).padStart(64, '0'),
      packageCommitment: (index + 17).toString(16).padStart(64, '0'),
      abiCommitment: (index + 33).toString(16).padStart(64, '0'),
      bindingCommitment: ZERO,
      originalMarkerType: `${originalPackageId}::${module}::${originalMarker}`,
      callableMarkerType: `${callablePackageId}::${module}::${callableMarker}`,
    };
  }
  const authorities = Object.fromEntries(['seal', 'runtime', 'output', 'physical', 'market', 'release'].map((role, index) => [role, `0x${(0x501 + index).toString(16)}`]));
  for (const role of MAKER_V8_ROLE_ORDER) {
    await assert.rejects(deriveMakerV8ReleaseCommitments({ catalogId: fixture.ids.catalog, roles, authorities }), (error) => {
      assert.equal(error.code, 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH');
      roles[role].bindingCommitment = error.details.expected;
      return true;
    });
  }
  return deriveMakerV8ReleaseCommitments({ catalogId: fixture.ids.catalog, roles, authorities });
}

async function trustedContext(document = clone(fixture.document), assets = clone(fixture.transportAssets), mutateTransport = null, mutateContext = null) {
  const release = await releaseTuple();
  const core = release.roles.core.originalPackageId;
  const catalogFields = {
    version: 8, protocolConfigId: fixture.ids.protocolConfig, protocolConfigRevision: '3', protocolConfigCommitment: ZERO,
    nativeCapabilityMask: '127', productBindingCommitment: release.productBindingCommitment, callCapSetCommitment: release.callCapSetCommitment,
    roles: release.roles, authorities: release.authorities,
  };
  const protocolFields = {
    version: 8, revision: '3', enabled: true, coreOriginalPackageId: release.roles.core.originalPackageId, coreCallablePackageId: release.roles.core.callablePackageId,
    treasuryId: fixture.ids.protocolTreasury, paymentCoinType: COIN, primaryContentFeeBps: 125, fixedCompleteFeeAtomic: '7', makerMarketFeeBps: 80, soulMarketFeeBps: 90, commitment: ZERO,
  };
  const configFields = (role) => ({ version: 8,
    catalogId: fixture.ids.catalog, productBindingCommitment: release.productBindingCommitment, callCapSetCommitment: release.callCapSetCommitment, authorityId: release.authorities[role] });
  const context = {
    schemaVersion: MAKER_V8_TRUSTED_CONTEXT_SCHEMA,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, signerAddress: fixture.ids.signer, paymentCoinType: COIN,
    protocolProfile: clone(MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE),
    coreArtifact: {
      callablePackageId: release.roles.core.callablePackageId,
      packageDigest: '2'.repeat(44),
      baseRegistryModuleSha256: MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
    },
    clock: shared('0x6', '0x2::clock::Clock', {}),
    protocolConfig: shared(fixture.ids.protocolConfig, `${core}::protocol_config_v8::ProtocolConfigV8`, protocolFields),
    protocolTreasury: shared(fixture.ids.protocolTreasury, `${core}::protocol_config_v8::ProtocolTreasuryV8<${COIN}>`, { version: 8, configId: fixture.ids.protocolConfig }),
    catalog: shared(fixture.ids.catalog, `${core}::package_binding_v8::ProductReleaseCatalogV8`, catalogFields),
    configs: {
      seal: shared(fixture.ids.sealConfig, `${release.roles.seal.originalPackageId}::seal_v8::SealPolicyConfigV8`, { ...configFields('seal'), commitment: ZERO, keyServerIds: ['0x601'], weights: [1], threshold: 1, keyServerSetCommitment: 'aa'.repeat(32), encryptionPolicyCommitment: 'bb'.repeat(32) }),
      runtime: shared(fixture.ids.runtimeConfig, `${release.roles.runtime.originalPackageId}::runtime_binding_v8::RuntimePackageConfigV8`, configFields('runtime')),
      output: shared(fixture.ids.outputConfig, `${release.roles.output.originalPackageId}::output_v8::OutputPackageConfigV8`, configFields('output')),
      physical: shared(fixture.ids.physicalConfig, `${release.roles.physical.originalPackageId}::physical_v8::PhysicalPackageConfigV8`, configFields('physical')),
      market: shared(fixture.ids.marketConfig, `${release.roles.market.originalPackageId}::market_v8::MarketPackageConfigV8`, configFields('market')),
      release: shared(fixture.ids.releaseConfig, `${release.roles.release.originalPackageId}::release_v8::ReleasePackageConfigV8`, configFields('release')),
    },
    activationAuthority: null,
    transport: await certifiedTransport(document, assets),
  };
  if (mutateTransport) mutateTransport(context.transport);
  context.protocolConfig.fields.commitment = await protocolCommitmentFromMove(context);
  context.catalog.fields.protocolConfigCommitment = context.protocolConfig.fields.commitment;
  Object.assign(context.configs.seal.fields, compilerSealPolicyFixture(context));
  context.activationAuthority = JSON.parse(JSON.stringify(await makerV8ActivationAuthorityFixture({
    catalogId: nid(fixture.ids.catalog), productBindingCommitment: release.productBindingCommitment,
    callCapSetCommitment: release.callCapSetCommitment, roles: release.roles,
    configIds: Object.fromEntries(Object.entries(context.configs).map(([role, object]) => [role, nid(object.reference.objectId)])),
    livingBlobId: context.transport.livingContent.blobId,
    livingBlobObjectId: context.transport.livingContent.blobObjectId,
    livingBytes: Buffer.from(context.transport.livingContent.bytesBase64, 'base64'),
    signerAddress: nid(context.signerAddress),
  })));
  mutateContext?.(context);
  return certifyMakerV8TrustedContext(context);
}

function rootObjects(publication) {
  const c = publication.context; const core = c.catalog.fields.roles.core.originalPackageId; const total = Object.values(publication.counts).reduce((sum, value) => sum + value, 0n); const makerVersion = publication.document.lineage.version;
  const root = shared(fixture.ids.root, `${core}::maker_v8::MakerRootV8<${COIN}>`, {
    version: 8, creator: c.signerAddress, owner: c.signerAddress, adminCapId: fixture.ids.adminCap, controlEpoch: '0', lifecycle: 0,
    makerKey: publication.document.lineage.makerKey, makerVersion,
    previousRootId: publication.document.lineage.previousRootId,
    previousVersionCommitment: publication.document.lineage.previousVersionCommitment,
    versionCommitment: publication.commitments.version, rendererCommitment: publication.commitments.renderer,
    sealedBaseRegistryCommitment: null,
    makerDocumentCommitment: publication.commitments.makerDocument,
    creatorDefaultsCommitment: publication.commitments.creatorDefaults,
    livingContentBindingCommitment: publication.commitments.livingContentBinding,
    manifestBlobId: publication.manifest.blobId, manifestSha256: publication.manifest.sha256, contentCommitment: publication.commitments.content,
    protocolConfigId: fixture.ids.protocolConfig, protocolConfigRevision: '3', protocolConfigCommitment: c.protocolConfig.fields.commitment,
    baseRegistryId: fixture.ids.baseRegistry, makerTreasuryId: fixture.ids.makerTreasury, expectedBaseDefinitionCount: String(total), expectedBaseRegistryCommitment: publication.commitments.baseAuthorRows,
    expectedPackAdmissionPolicyCommitment: publication.commitments.packAdmissionPolicy, economicsCommitment: publication.commitments.economics, rightsCommitment: publication.commitments.rights,
    catalogId: fixture.ids.catalog, productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment,
  });
  const baseRegistry = shared(fixture.ids.baseRegistry, `${core}::base_registry_v8::BaseDefinitionRegistryV8`, {
    version: 8, rootId: nid(fixture.ids.root), makerVersion, rootContentCommitment: publication.commitments.content,
    expectedCounts: Object.fromEntries(Object.entries(publication.counts).map(([key, value]) => [key, String(value)])),
    observedCounts: Object.fromEntries(Object.keys(publication.counts).map((key) => [key, '0'])),
    initialCommitments: Object.fromEntries([...MAKER_V8_BASE_CATEGORIES_V2.map(([, k]) => k), 'aggregate'].map(k => [k, ZERO])), rollingCommitments: Object.fromEntries([...MAKER_V8_BASE_CATEGORIES_V2.map(([, k]) => k), 'aggregate'].map(k => [k, ZERO])), sealedCommitments: null, authorRowsRollingCommitment: ZERO,
    colorSwatchCount: '0', totalCapacity: '0', ruleSelectorCount: '0', visibilityLeafCount: '0',
    nextSequence: '0', expectedSequenceCount: String(total), protectedStyleCount: '0', sealed: false,
  });
  const result = {
    root, baseRegistry,
    makerTreasury: shared(fixture.ids.makerTreasury, `${core}::treasury_v8::MakerTreasuryV8<${COIN}>`, { version: 8, rootId: nid(fixture.ids.root), makerVersion, rootContentCommitment: publication.commitments.content }),
    adminCap: owned(fixture.ids.adminCap, `${core}::maker_v8::MakerAdminCapV8`, { version: 8, rootId: nid(fixture.ids.root), owner: c.signerAddress, controlEpoch: '0' }),
  };
  if (makerVersion > 1) {
    result.previousRoot = clone(publication.predecessor.root);
    result.previousRoot.fields.successorRootId = nid(fixture.ids.root);
  }
  return result;
}

const testBaseProgress = new WeakMap();
async function actualBaseProgress(publication, rootId = fixture.ids.root, registryId = fixture.ids.baseRegistry) {
  const rules = await compileMakerV8RuleRows(publication.document.rules);
  const entries = MAKER_V8_BASE_CATEGORIES_V2.flatMap(([kind]) => publication.rows[kind].map((row, i) => ({
    kind, row, bytes: kind === 'rule' ? rules[i].bytes : [...MAKER_V8_BASE_ROW_BCS_V2[kind].serialize(row).toBytes()],
    ...(kind === 'rule' ? { commitment: rules[i].commitment } : {}),
  })));
  const author = await deriveMakerV8BaseAuthorCommitmentV2(entries);
  const storage = await deriveMakerV8BaseStorageCommitmentsV2({ rootId, registryId, makerVersion: publication.document.lineage.version, entries });
  return { author, storage };
}
async function scaffoldReadback(publication, mutate = null) {
  const raw = { schemaVersion: MAKER_V8_SCAFFOLD_READBACK_SCHEMA, source: 'FINALIZED_RPC', transactionDigest: DIGEST,
    ...await transactionKindProof({ transaction: buildMakerV8ScaffoldTransaction(publication) }), ...rootObjects(publication) };
  const progress = await actualBaseProgress(publication);
  Object.assign(raw.baseRegistry.fields, { initialCommitments: clone(progress.storage.initialCommitments), rollingCommitments: clone(progress.storage.initialCommitments), authorRowsRollingCommitment: progress.author.initialCommitment });
  mutate?.(raw);
  const certified = await certifyMakerV8ScaffoldReadback(publication, raw);
  testBaseProgress.set(certified, progress);
  return certified;
}
function baseReadbackRaw(publication, scaffold) {
  const progress = testBaseProgress.get(scaffold);
  const total = Object.values(publication.counts).reduce((sum, value) => sum + value, 0n);
  const root = clone(scaffold.root);
  root.fields.sealedBaseRegistryCommitment = progress.storage.sealedCommitments.aggregate;
  return { schemaVersion: MAKER_V8_BASE_READBACK_SCHEMA, root,
    baseRegistry: shared(fixture.ids.baseRegistry, scaffold.baseRegistry.type, {
      ...clone(scaffold.baseRegistry.fields),
      observedCounts: Object.fromEntries(Object.entries(publication.counts).map(([key, value]) => [key, String(value)])),
      rollingCommitments: clone(progress.storage.rollingCommitments), sealedCommitments: clone(progress.storage.sealedCommitments),
      authorRowsRollingCommitment: progress.author.rollingCommitment,
      nextSequence: String(total), protectedStyleCount: String(publication.rows.style.filter(row => row.protected).length),
      colorSwatchCount: String(publication.rows.color.reduce((sum, row) => sum + row.swatches.length, 0)),
      totalCapacity: String(publication.rows.part.reduce((sum, row) => sum + row.capacity, 0n)),
      ruleSelectorCount: String(publication.rows.rule.reduce((sum, row) => sum + row.targets.length + 1, 0)),
      visibilityLeafCount: String(publication.rows.style.reduce((sum, row) => sum + row.visibility_tokens.filter(token => token.opcode === 0).length, 0)),
      sealed: true,
    }),
  };
}

async function companionRaw(publication, base, expected, transaction = null) {
  const c = publication.context; const type = (role, module, struct, generic = '') => `${c.catalog.fields.roles[role].originalPackageId}::${module}::${struct}${generic}`; const rootId = nid(fixture.ids.root); const content = publication.commitments.content;
  const sealRegistry = shared(fixture.ids.sealRegistry, type('seal', 'seal_v8', 'SealRegistryV8'), {
    version: 8, rootId, makerVersion: 1, rootContentCommitment: content, catalogId: nid(fixture.ids.catalog), productBindingCommitment: c._derived.productBindingCommitment,
    policyConfigId: nid(fixture.ids.sealConfig), policyCommitment: c._derived.sealPolicyCommitment, expectedBaseCount: String(expected.seal.rows.length), expectedPackCount: '0', expectedCompleteCount: '0', ...(await deriveMakerV8SealStorageV2({ registryId: nid(fixture.ids.sealRegistry), rootId, makerVersion: publication.document.lineage.version, rootContentCommitment: content, policyId: nid(fixture.ids.sealConfig), rows: expected.seal.rows })).checkpoints[0],
  });
  const runtimeDefinitions = shared(fixture.ids.runtimeDefinitions, type('runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'), { version: 8, rootId, rootVersion: '1', rootContentCommitment: content, baseRegistryId: nid(fixture.ids.baseRegistry), expectedProfileCount: String(publication.runtime.profiles.length), observedProfileCount: '0', expectedProfileCommitment: publication.runtime.profileCommitment, rollingProfileCommitment: ZERO, admissionCeiling: publication.runtime.admission, itemAssetization: publication.runtime.itemAssetization, sealed: false });
  const admissionAuthority = owned(fixture.ids.admissionAuthority, type('runtime', 'runtime_v8', 'PackAdmissionAuthorityV8'), { version: 8, rootId, rootVersion: '1', rootContentCommitment: content });
  const packRegistry = shared(fixture.ids.packRegistry, type('runtime', 'runtime_v8', 'PackRegistryV8'), { version: 8, rootId, rootVersion: '1', rootContentCommitment: content, definitionRegistryId: nid(fixture.ids.runtimeDefinitions), admissionAuthorityId: nid(fixture.ids.admissionAuthority), admissionPolicyCommitment: publication.commitments.packAdmissionPolicy, revision: '0', releaseCount: '0', externalAdmissionCount: '0', wardrobeRevision: '0', baseItemCount: '0' });
  const soulRegistry = shared(fixture.ids.soulRegistry, type('output', 'output_v8', 'SoulRegistryV8'), { version: 8, rootId, makerVersion: 1, rootContentCommitment: content, outputRegistryId: nid(fixture.ids.outputRegistry), soulCount: '0' });
  const outputRegistry = shared(fixture.ids.outputRegistry, type('output', 'output_v8', 'OutputRegistryV8'), { version: 8, rootId, makerVersion: 1, rootContentCommitment: content, rendererCommitment: publication.commitments.renderer, soulRegistryId: nid(fixture.ids.soulRegistry), expectedOutputCount: String(expected.output.rows.length), observedOutputCount: '0', expectedPolicyCommitment: expected.output.commitment, rollingPolicyCommitment: ZERO, sealed: false });
  const physicalRegistry = shared(fixture.ids.physicalRegistry, type('physical', 'physical_v8', 'PhysicalRegistryV8'), { version: 8, catalogId: nid(fixture.ids.catalog), packageConfigId: nid(fixture.ids.physicalConfig), productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment, rootId, makerVersion: 1, rootContentCommitment: content, baseRegistryId: nid(fixture.ids.baseRegistry), expectedBasePolicyCount: String(expected.physical.rows.length), observedBasePolicyCount: '0', expectedBasePolicyCommitment: expected.physical.commitment, rollingBasePolicyCommitment: ZERO, baseSealed: false, revision: '0', packPolicyCount: '0' });
  const marketTreasury = shared(fixture.ids.marketTreasury, type('market', 'market_v8', 'MarketTreasuryV8', `<${COIN}>`), { version: 8, catalogId: nid(fixture.ids.catalog), packageConfigId: nid(fixture.ids.marketConfig), rootId, makerVersion: 1, rootContentCommitment: content, balanceAtomic: '0', grossEscrowedAtomic: '0', grossReleasedAtomic: '0' });
  const marketRegistry = shared(fixture.ids.marketRegistry, type('market', 'market_v8', 'MarketRegistryV8', `<${COIN}>`), { catalogId: nid(fixture.ids.catalog), packageConfigId: nid(fixture.ids.marketConfig), productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment, rootId, makerVersion: 1, rootContentCommitment: content, protocolConfigId: nid(fixture.ids.protocolConfig), protocolConfigRevision: '3', protocolConfigCommitment: c.protocolConfig.fields.commitment, economicsCommitment: publication.commitments.economics, rightsCommitment: publication.commitments.rights, makerMarketFeeBps: 80, soulMarketFeeBps: 90, soulCreatorRoyaltyBps: publication.document.commerce.soulCreatorRoyaltyBps, makerSourceRoyaltyBps: publication.document.commerce.makerSourceRoyaltyBps, makerResaleRoyaltyBps: publication.document.commerce.makerResaleRoyaltyBps, treasuryId: nid(fixture.ids.marketTreasury), sealed: false, revision: '0', listingCount: '0', escrowCount: '0', completedSaleCount: '0', canceledSaleCount: '0', recoveredSaleCount: '0', grossVolumeAtomic: '0', protocolPaidAtomic: '0', creatorPaidAtomic: '0', sourcePaidAtomic: '0', sellerPaidAtomic: '0', zeroStateCommitment: ZERO });
  const companionTransaction = transaction ?? (await buildMakerV8CompanionObjectsTransaction(publication, base)).transaction;
  return { schemaVersion: MAKER_V8_COMPANION_READBACK_SCHEMA, source: 'FINALIZED_RPC', transactionDigest: DIGEST, ...await transactionKindProof({ transaction: companionTransaction }), sealRegistry, runtimeDefinitions, packRegistry, admissionAuthority, outputRegistry, soulRegistry, physicalRegistry, marketRegistry, marketTreasury };
}

async function companionReadback(publication, base, expected, transaction = null) {
  const raw = await companionRaw(publication, base, expected, transaction);
  for (const [code, object, field] of [
    ['MAKER_V8_RUNTIME_READBACK_MISMATCH', raw.runtimeDefinitions, 'rollingProfileCommitment'],
    ['MAKER_V8_OUTPUT_READBACK_MISMATCH', raw.outputRegistry, 'rollingPolicyCommitment'],
    ['MAKER_V8_PHYSICAL_READBACK_MISMATCH', raw.physicalRegistry, 'rollingBasePolicyCommitment'],
    ['MAKER_V8_MARKET_ZERO_COMMITMENT_MISMATCH', raw.marketRegistry, 'zeroStateCommitment'],
  ]) {
    await assert.rejects(certifyMakerV8CompanionReadback(publication, base, raw), (error) => { assert.equal(error.code, code, `${error.message} ${JSON.stringify(error.details)}`); object.fields[field] = error.details.expected; return true; });
  }
  return certifyMakerV8CompanionReadback(publication, base, raw);
}

async function compilePath(document = clone(fixture.document), assets = clone(fixture.transportAssets)) {
  const context = await trustedContext(document, assets); const publication = await compileMakerV8Publication(document, context); const scaffold = await scaffoldReadback(publication); const base = certifyMakerV8BaseReadback(publication, scaffold, baseReadbackRaw(publication, scaffold)); const companionBuild = await buildMakerV8CompanionObjectsTransaction(publication, base); const companion = await companionReadback(publication, base, companionBuild.expected, companionBuild.transaction); return { context, publication, scaffold, base, companionBuild, companion };
}

const moves = (transaction) => transaction.getData().commands.filter((command) => command.$kind === 'MoveCall').map((command) => command.MoveCall);

test('export background is manifest-bound content, not a new on-chain permission or recipe', async () => {
  const document = clone(fixture.document);
  document.assets.forEach(asset => { asset.byteLength = Number(asset.byteLength); });
  document.parts[0].exportBackground = false;
  const before = await compilePath(document);
  document.parts[0].exportBackground = true;
  const after = await compilePath(document);
  const manifest = assertMakerV8Manifest(JSON.parse(after.publication.manifest.json));
  assert.equal(manifest.document.parts[0].exportBackground, true);
  assert.notEqual(after.publication.manifest.sha256, before.publication.manifest.sha256);
  for (const key of ['makerDocument', 'content', 'version']) {
    assert.notEqual(after.publication.commitments[key], before.publication.commitments[key]);
  }
  for (const key of ['renderer', 'creatorDefaults', 'rights', 'economics', 'baseAuthorRows']) {
    assert.equal(after.publication.commitments[key], before.publication.commitments[key]);
  }
  assert.deepEqual(after.publication.rows, before.publication.rows);
  assert.deepEqual(after.publication.document.defaultRecipe, before.publication.document.defaultRecipe);
  await assert.rejects(compileMakerV8Publication(document, before.context), { code: 'MAKER_V8_MANIFEST_BYTES_MISMATCH' });
  document.parts[0].exportBackground = 'true';
  await assert.rejects(compileMakerV8Publication(document, after.context));
});

test('Maker Info text is manifest-bound public data while the authenticated creator stays the signer', async () => {
  const document = clone(fixture.document);
  document.assets.forEach((asset) => { asset.byteLength = Number(asset.byteLength); });
  const baseline = await compileMakerV8Publication(document, await trustedContext(document));
  for (const field of ['creator', 'style']) {
    const changed = clone(document);
    changed.metadata[field] = field === 'creator' ? 'Public artist 🌍' : '水彩世界';
    const publication = await compileMakerV8Publication(changed, await trustedContext(changed));
    const manifest = assertMakerV8Manifest(JSON.parse(publication.manifest.json));
    assert.equal(manifest.document.metadata[field], changed.metadata[field]);
    assert.notEqual(publication.manifest.sha256, baseline.manifest.sha256);
    for (const key of ['makerDocument', 'content', 'version']) {
      assert.notEqual(publication.commitments[key], baseline.commitments[key]);
    }
    for (const key of ['renderer', 'creatorDefaults', 'rights', 'economics']) {
      assert.equal(publication.commitments[key], baseline.commitments[key]);
    }
    assert.equal(publication.context.signerAddress, baseline.context.signerAddress);
    const scaffold = await scaffoldReadback(publication);
    assert.equal(scaffold.root.fields.creator, baseline.context.signerAddress);
    await assert.rejects(scaffoldReadback(publication, (raw) => { raw.root.fields.creator = nid('0xbad'); }),
      { code: 'MAKER_V8_ROOT_READBACK_MISMATCH' });
    await assert.rejects(compileMakerV8Publication(changed, baseline.context), { code: 'MAKER_V8_MANIFEST_BYTES_MISMATCH' });
  }
  for (const invalid of [null, 12, '界'.repeat(43)]) {
    const changed = clone(document); changed.metadata.creator = invalid;
    await assert.rejects(compileMakerV8Publication(changed, baseline.context));
  }
  const forged = clone(document); forged.parts[0].payload.creator = 'Fake signer';
  await assert.rejects(compileMakerV8Publication(forged, baseline.context));
});

test('independent Maker cover survives compilation and manifest certification without becoming a layer', async () => {
  const document = clone(fixture.document);
  document.assets.forEach((asset) => { asset.byteLength = Number(asset.byteLength); });
  const before = clone(document.parts);
  const cover = { assetId: 'maker-cover', blobId: 'walrus-cover-v8', mediaType: 'image/jpeg',
    bytesBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') };
  document.metadata.coverAssetId = cover.assetId;
  document.assets.push({ id: cover.assetId, kind: 'cover', mediaType: cover.mediaType, byteLength: 4 });
  const assets = [...clone(fixture.transportAssets), cover];
  const publication = await compileMakerV8Publication(document, await trustedContext(document, assets));
  const manifest = assertMakerV8Manifest(JSON.parse(publication.manifest.json));
  assert.equal(manifest.document.metadata.coverAssetId, cover.assetId);
  assert.equal(manifest.certifiedAssets.find((asset) => asset.assetId === cover.assetId).sha256,
    await hashBytes(Buffer.from(cover.bytesBase64, 'base64')));
  assert.deepEqual(manifest.document.parts, before);
  assert.equal(manifest.document.assets.some((asset) => asset.id === cover.assetId), true);
});

test('author finalization uses one actual storage certificate and the complete companion chain', async () => {
  const path = await compilePath();
  const finalBuild = (await allActivationBuilds(path)).at(-1);
  const transaction = finalBuild.transaction;
  const calls = moves(transaction);
  assert.deepEqual(calls.map(call => [call.function, call.arguments.length]), [
    ['seal_market_registry_v8', 8],
    ['new_living_content_binding_v8', 5],
    ['certify_walrus_living_content_v1', 8],
    ['prepare_maker_companion_binding_v2', 19],
    ['bind_maker_market_companion_v2', 9],
    ['finish_maker_companion_binding_v2', 10],
    ['seal_and_activate_maker_v8', 11],
    ['freeze_certified_living_content_v1', 1],
    ['epoch', 1],
  ]);
  // Each single-use result is passed through the real downstream function,
  // not replaced with a caller-authored byte vector or a second authority.
  assert.equal(calls[2].arguments[5].Result, 1);
  assert.equal(calls[3].arguments[7].Result, 2);
  assert.equal(calls[4].arguments[0].Result, 3);
  assert.equal(calls[5].arguments[0].Result, 4);
  assert.equal(calls[5].arguments[8].Result, 2);
  assert.equal(calls[6].arguments[7].Result, 2);
  assert.equal(calls[7].arguments[0].Result, 2);
  const authority = path.context.activationAuthority;
  for (const [callIndex, argIndex, object] of [
    [2, 2, authority.walrusPolicy], [2, 3, path.base.root],
    [2, 4, path.base.adminCap], [2, 6, authority.livingBlob],
    [2, 7, authority.walrusSystem], [3, 4, authority.replacement],
    [4, 5, authority.replacement], [5, 5, authority.replacement],
    [6, 4, authority.replacement], [6, 5, authority.bootstrapCertificate],
    [3, 8, authority.walrusSystem], [5, 9, authority.walrusSystem], [6, 8, authority.walrusSystem],
  ]) assert.equal(argumentObjectId(transaction, calls[callIndex].arguments[argIndex]), nid(object.reference.objectId));
  assert.equal(transaction.getData().sender, nid(path.context.signerAddress));
  const marketCreate = moves(path.companionBuild.transaction).find(call => call.function === 'new_market_objects_v8');
  assert.equal(marketCreate.arguments.length, 6);
  assert.equal(argumentObjectId(path.companionBuild.transaction, marketCreate.arguments[2]), nid(path.context.protocolConfig.reference.objectId));
  assert.equal(argumentObjectId(path.companionBuild.transaction, marketCreate.arguments[4]), authority.replacement.reference.objectId);
  const bytes = await transaction.build({ onlyTransactionKind: true });
  assert.equal(bcs.TransactionKind.parse(bytes).ProgrammableTransaction.commands.length, 9);
  for (const mutate of [
    commands => { commands.pop(); },
    commands => { commands.at(-1).MoveCall.package = authority.walrusPolicy.reference.objectId; },
    commands => { commands.at(-1).MoveCall.arguments = commands[0].MoveCall.arguments.slice(0,1); },
  ]) {
    const kind = bcs.TransactionKind.parse(bytes);
    mutate(kind.ProgrammableTransaction.commands);
    const tamperedBytes = bcs.TransactionKind.serialize(kind).toBytes();
    const raw = await activationChunkRaw(finalBuild, path.companion);
    raw.transactionKindBytesBase64 = Buffer.from(tamperedBytes).toString('base64');
    raw.transactionKindSha256 = await hashBytes(tamperedBytes);
    await assert.rejects(certifyMakerV8ActivationChunkReadback(path.publication,path.base,path.companion,finalBuild,raw),
      {code:'MAKER_V8_TRANSACTION_KIND_MISMATCH'});
    await assert.rejects(rehydrateMakerV8ActivationChunkCertificateV8(path.publication,path.base,path.companion,
      {checkpoint:finalBuild.checkpoint,readback:raw}),{code:'MAKER_V8_TRANSACTION_KIND_MISMATCH'});
  }
});

test('compiler protocol commitment follows current Move V2 domain, schema revision and exact field order', async () => {
  assert.equal(protocolMoveDomain, 'animacraft-fresh-v8/core/protocol-config/v2');
  assert.equal(protocolMoveVersion, '8');
  assert.deepEqual(protocolFieldsFromMove, [
    ['domain', 'String'], ['schema_revision', 'u64'], ['config_id', 'ID'], ['config_revision', 'u64'],
    ['enabled', 'bool'], ['core_original_package_id', 'ID'], ['core_callable_package_id', 'ID'],
    ['treasury_id', 'Option<ID>'], ['payment_coin_type', 'String'], ['primary_content_fee_bps', 'u16'],
    ['fixed_complete_fee_atomic', 'u64'], ['maker_market_fee_bps', 'u16'], ['soul_market_fee_bps', 'u16'],
  ]);
  const context = await trustedContext();
  assert.equal(context.protocolConfig.fields.commitment, await protocolCommitmentFromMove(context));
  assert.equal(context.catalog.fields.protocolConfigCommitment, context.protocolConfig.fields.commitment);
});

for (const variant of ['old domain', 'wrong schema revision', 'old field order', 'complete retired preimage']) {
  test(`compiler refuses self-consistent Catalog/Protocol commitment using ${variant}`, async () => {
    const context = clone(await trustedContext()); delete context._derived;
    const values = protocolMoveValues(context);
    let schema = protocolMoveSchema, input = { ...values };
    if (variant === 'old domain') input.domain = 'animacraft-v8/protocol-config';
    if (variant === 'wrong schema revision') input.schema_revision = '2';
    if (variant === 'old field order') {
      const fields = [...protocolFieldsFromMove.filter(([name]) => name !== 'enabled'), ['enabled', 'bool']];
      schema = bcs.struct('WrongProtocolOrder', Object.fromEntries(fields.map(([name, type]) => [name, protocolPrimitives[type]])));
    }
    if (variant === 'complete retired preimage') {
      // Negative-only old wire shape: never used to initialize a positive fixture.
      schema = bcs.struct('RetiredProtocolInput', { domain: bcs.byteVector(), version: bcs.u64(), config_id: bcs.Address,
        core_original_package_id: bcs.Address, core_callable_package_id: bcs.Address, revision: bcs.u64(),
        treasury_id: bcs.option(bcs.Address), payment_coin_type: bcs.string(), primary_content_fee_bps: bcs.u16(),
        fixed_complete_fee_atomic: bcs.u64(), maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16(), enabled: bcs.bool() });
      input = { ...values, domain: new TextEncoder().encode('animacraft-v8/protocol-config'),
        version: '8', revision: values.config_revision };
    }
    const invalid = await hashBytes(schema.serialize(input).toBytes());
    assert.notEqual(invalid, context.protocolConfig.fields.commitment);
    context.protocolConfig.fields.commitment = invalid;
    context.catalog.fields.protocolConfigCommitment = invalid;
    await assert.rejects(certifyMakerV8TrustedContext(context), { code: 'MAKER_V8_PROTOCOL_COMMITMENT_MISMATCH' });
  });
}
for (const field of ['primaryContentFeeBps', 'fixedCompleteFeeAtomic', 'makerMarketFeeBps', 'soulMarketFeeBps']) {
  test(`compiler protocol commitment independently binds ${field}`, async () => {
    const context = clone(await trustedContext()); delete context._derived;
    context.protocolConfig.fields[field] = String(BigInt(context.protocolConfig.fields[field]) + 1n);
    await assert.rejects(certifyMakerV8TrustedContext(context), { code: 'MAKER_V8_PROTOCOL_COMMITMENT_MISMATCH' });
  });
}

test('trusted context pins exact measured Sui protocol and Core artifact commitments', async () => {
  const approved = await trustedContext();
  assert.deepEqual(approved.protocolProfile, MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE);
  assert.equal(approved._derived.protocolProfileCommitment, MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE_COMMITMENT);
  assert.equal(approved.coreArtifact.callablePackageId, approved.catalog.fields.roles.core.callablePackageId);
  assert.equal(approved.coreArtifact.baseRegistryModuleSha256, MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256);
  assert.match(approved._derived.coreArtifactCommitment, /^[0-9a-f]{64}$/);

  for (const [mutate, code] of [
    [(context) => { context.protocolProfile.protocolVersion = '131'; }, 'MAKER_V8_SUI_PROTOCOL_PROFILE_UNMEASURED'],
    [(context) => { context.protocolProfile.objectRuntimeMaxNumCachedObjects = '999'; }, 'MAKER_V8_SUI_PROTOCOL_PROFILE_UNMEASURED'],
    [(context) => { context.protocolProfile.objectRuntimeMaxNumStoreEntries = '1001'; }, 'MAKER_V8_SUI_PROTOCOL_PROFILE_UNMEASURED'],
    [(context) => { context.protocolProfile.objectRuntimeMaxNumCachedObjects = 1000; }, 'MAKER_V8_SUI_PROTOCOL_PROFILE_INVALID'],
    [(context) => { delete context.protocolProfile.objectRuntimeMaxNumStoreEntries; }, 'MAKER_V8_FIELDS_INVALID'],
  ]) {
    await assert.rejects(
      trustedContext(clone(fixture.document), clone(fixture.transportAssets), null, mutate),
      (error) => error.code === code,
    );
  }
  for (const mutate of [
    (context) => { context.coreArtifact.callablePackageId = fixture.ids.sealConfig; },
    (context) => { context.coreArtifact.baseRegistryModuleSha256 = 'ff'.repeat(32); },
    (context) => { context.coreArtifact.packageDigest = 'not-a-sui-digest'; },
    (context) => { context.coreArtifact.packageDigest = '2'.repeat(32); },
    (context) => { context.coreArtifact.packageDigest = ` ${'2'.repeat(44)}`; },
  ]) {
    await assert.rejects(
      trustedContext(clone(fixture.document), clone(fixture.transportAssets), null, mutate),
      (error) => error.code === 'MAKER_V8_CORE_ARTIFACT_UNMEASURED',
    );
  }
  const packageDigestDrift = await trustedContext(clone(fixture.document), clone(fixture.transportAssets), null, (context) => {
    context.coreArtifact.packageDigest = '3'.repeat(44);
  });
  assert.notEqual(packageDigestDrift._derived.coreArtifactCommitment, approved._derived.coreArtifactCommitment);
  await assert.rejects(
    () => assertMakerV8CompilerContextFreshV8(approved, packageDigestDrift),
    (error) => error.code === 'MAKER_V8_COMPILER_CONTEXT_DRIFT',
  );
});
const suffixes = (transaction) => exactMakerV8TransactionTargets(transaction).map((target) => target.split('::').slice(-2).join('::'));
const argKinds = (move) => move.arguments.map((argument) => argument.$kind);

function styleLimitDocument(styleCount, uniqueColorPairs = 0) {
  const document = clone(fixture.document);
  const template = document.parts[0].items[0].styles[0];
  document.colors = Array.from({ length: uniqueColorPairs }, (_, index) => ({
    key: `c${index}`,
    label: `Color ${index}`,
    defaultSwatchKey: `s${index}`,
    swatches: [{ key: `s${index}`, label: `Swatch ${index}`, rgba: '#ffffffff', stops: [] }],
  }));
  document.parts[0].items[0].styles = Array.from({ length: styleCount }, (_, index) => ({
    ...clone(template),
    key: `style${index}`,
    label: `Style ${index}`,
    displayOrder: index,
    colorChannelKey: index < uniqueColorPairs ? `c${index}` : null,
    defaultSwatchKey: index < uniqueColorPairs ? `s${index}` : null,
    payload: { index },
  }));
  document.parts[0].items[0].defaultStyleKey = 'style0';
  document.defaultRecipe.selections[0].styleKey = 'style0';
  document.defaultRecipe.colors = [];
  return document;
}

function colorRowLimitDocument(colorRowCount) {
  const document = clone(fixture.document);
  document.colors = [{
    key: 'compiler-colors',
    label: 'Compiler colors',
    defaultSwatchKey: 'swatch-0000',
    swatches: Array.from({ length: colorRowCount }, (_, index) => ({
      key: `swatch-${String(index).padStart(4, '0')}`,
      label: `Swatch ${index}`,
      rgba: '#010203ff',
      stops: [],
    })),
  }];
  return document;
}
function argumentObjectId(transaction, argument) {
  const input = transaction.getData().inputs[argument.Input].Object;
  return input.SharedObject?.objectId ?? input.ImmOrOwnedObject?.objectId ?? input.Receiving?.objectId;
}

function assertScaffoldContentAbi(publication, transaction, successor) {
  const call = moves(transaction).find(move => move.function === `new_${successor ? 'successor' : 'initial'}_maker_draft_v8`);
  assert.equal(call.arguments.length, successor ? 18 : 15);
  const read = (argument, type) => type.parse(Buffer.from(transaction.getData().inputs[argument.Input].Pure.bytes, 'base64'));
  const first = successor ? 12 : 2;
  for (const [offset, key] of ['makerDocument', 'creatorDefaults', 'livingContentBinding'].entries()) {
    assert.equal(Buffer.from(read(call.arguments[first + offset], bcs.vector(bcs.u8()))).toString('hex'), publication.commitments[key]);
  }
  assert.equal(Buffer.from(read(call.arguments[10], bcs.vector(bcs.u8()))).toString('hex'), publication.commitments.baseAuthorRows);
  const counts = moves(transaction).find(move => move.function === 'new_base_definition_counts_v8');
  assert.equal(counts.arguments.length, 7);
  assert.deepEqual(counts.arguments.map(argument => read(argument, bcs.u64())), MAKER_V8_BASE_CATEGORIES_V2.map(([, key]) => String(publication.counts[key])));
  assert.equal(suffixes(transaction).includes('base_registry_v8::new_base_definition_commitments_v8'), false);
}

async function transactionKindProof(build) {
  const bytes = await build.transaction.build({ onlyTransactionKind: true });
  return { transactionKindBytesBase64: Buffer.from(bytes).toString('base64'), transactionKindSha256: await hashBytes(bytes) };
}

async function baseChunkRaw(publication, scaffold, build, digest = DIGEST) {
  const expected = build.checkpoint.expected;
  const root = expected.sealed ? clone(scaffold.root) : null;
  if (root) root.fields.sealedBaseRegistryCommitment = expected.sealedCommitments.aggregate;
  return { schemaVersion: MAKER_V8_BASE_CHUNK_READBACK_SCHEMA, source: 'FINALIZED_RPC', transactionDigest: digest,
    ...await transactionKindProof(build), root,
    baseRegistry: shared(fixture.ids.baseRegistry, scaffold.baseRegistry.type, {
      ...clone(scaffold.baseRegistry.fields), ...clone(expected),
    }),
  };
}

async function activationChunkRaw(build, companion, digest = DIGEST) {
  const phase = build.checkpoint.phase.replace('ACTIVATION_', '');
  const lane = build.checkpoint.lane;
  if (phase === 'FINALIZE') return {
    schemaVersion: MAKER_V8_ACTIVATION_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    transactionDigest: digest,
    ...await transactionKindProof(build),
    rootId: companion.sealRegistry.fields.rootId,
    makerVersion: 1,
    lifecycle: 'ACTIVE',
    makerKey: null,
    versionCommitment: null,
    manifestSha256: null,
    contentCommitment: null,
    protocolConfigCommitment: null,
    productBindingCommitment: null,
    callCapSetCommitment: null,
  };
  const expected = build.checkpoint.expected;
  const object = clone(companion[expected.objectKey]);
  if (lane === 'SEAL') Object.assign(object.fields, expected.fields);
  if (lane === 'RUNTIME') { object.fields.observedProfileCount = expected.observedCount; object.fields.rollingProfileCommitment = expected.rollingCommitment; object.fields.sealed = expected.sealed; }
  if (lane === 'OUTPUT') { object.fields.observedOutputCount = expected.observedCount; object.fields.rollingPolicyCommitment = expected.rollingCommitment; object.fields.sealed = expected.sealed; }
  if (lane === 'PHYSICAL') { object.fields.observedBasePolicyCount = expected.observedCount; object.fields.rollingBasePolicyCommitment = expected.rollingCommitment; object.fields.baseSealed = expected.sealed; }
  return { schemaVersion: MAKER_V8_ACTIVATION_CHUNK_READBACK_SCHEMA, source: 'FINALIZED_RPC', transactionDigest: digest, ...await transactionKindProof(build), phase, object };
}

async function allActivationBuilds(path) {
  const builds = []; let prior = null;
  do {
    const build = await buildMakerV8ActivationChunkTransaction(path.publication, path.base, path.companion, prior);
    builds.push(build);
    const raw = await activationChunkRaw(build, path.companion, `${DIGEST}p${builds.length}`);
    if (build.checkpoint.final) Object.assign(raw, {
      makerKey: path.publication.document.lineage.makerKey,
      versionCommitment: path.publication.commitments.version,
      manifestSha256: path.publication.manifest.sha256,
      contentCommitment: path.publication.commitments.content,
      protocolConfigCommitment: path.publication.context.protocolConfig.fields.commitment,
      productBindingCommitment: path.publication.context._derived.productBindingCommitment,
      callCapSetCommitment: path.publication.context._derived.callCapSetCommitment,
    });
    prior = await certifyMakerV8ActivationChunkReadback(path.publication, path.base, path.companion, build, raw);
  } while (!builds.at(-1).checkpoint.final);
  return builds;
}

async function allBaseBuilds(publication, scaffold) {
  const builds = []; let prior = null;
  do {
    const build = await buildMakerV8BaseChunkTransaction(publication, scaffold, prior);
    builds.push(build);
    prior = await certifyMakerV8BaseChunkReadback(
      publication,
      scaffold,
      build,
      await baseChunkRaw(publication, scaffold, build, `${DIGEST}b${builds.length}`),
    );
  } while (!builds.at(-1).checkpoint.final);
  return { builds, base: prior.base };
}

function compilerTargetKey(target) {
  const [packageId, module, fn] = target.split('::');
  if (packageId === nid('0x1') && module === 'option' && ['some', 'none'].includes(fn)) return `stdlib:option::${fn}`;
  if (packageId === '0x98da433aa0139512c210597b1c5e3df6cd121d8d77f8652691bb66fadfc8aa1b'
    && module === 'system' && fn === 'epoch') return 'walrus:system::epoch';
  const role = MAKER_V8_ROLE_ORDER.find((candidate) => packageId === nid(fixture.packageRoles[candidate][1]));
  assert.ok(role, `unknown compiler callable package ${packageId}`);
  return `${role}:${module}::${fn}`;
}

test('fresh fixture compiles canonical certified bytes into executable bounded seven-role checkpoints', async () => {
  assert.equal(fixture.schemaVersion, MAKER_V8_COMMITMENT_FIXTURE_SCHEMA);
  const path = await compilePath();
  assert.deepEqual({ manifestSha256: path.publication.manifest.sha256, contentCommitment: path.publication.commitments.content, baseAggregateCommitment: path.publication.commitments.baseAuthorRows, runtimePolicyCommitment: path.publication.commitments.packAdmissionPolicy }, { ...fixture.expected, baseAggregateCommitment: '3fedbdaf1776485e1f713f5f1259fdc3354466c1596d8023842c6c5a0730a241' });
  assert.notEqual(path.publication.manifest.sha256, path.publication.commitments.content,
    'semantic content must not depend on ciphertext/transport bytes');
  assert.equal(path.publication.counts.styles, 1n);
  assert.equal(path.companionBuild.expected.physical.rows.length, 1);
  const scaffoldTx = buildMakerV8ScaffoldTransaction(path.publication);
  assertScaffoldContentAbi(path.publication, scaffoldTx, false);
  const baseBuild = await buildMakerV8BaseChunkTransaction(path.publication, path.scaffold);
  const activationBuild = await buildMakerV8ActivationChunkTransaction(path.publication, path.base, path.companion);
  for (const tx of [scaffoldTx, baseBuild.transaction, path.companionBuild.transaction, activationBuild.transaction]) { assert.ok(tx instanceof Transaction); assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0); }
  assert.deepEqual(suffixes(scaffoldTx), ['maker_v8::new_economics_snapshot_v8', 'maker_v8::new_onchain_native_rights_snapshot_v8', 'base_registry_v8::new_base_definition_counts_v8', 'core_v8::new_initial_maker_draft_v8', 'release_v8::finalize_product_release_binding_v8', 'core_v8::share_maker_draft_v8']);
  assert.deepEqual(moves(scaffoldTx).map((move) => move.typeArguments), [[ntype(COIN)], [], [], [ntype(COIN)], [ntype(COIN)], [ntype(COIN)]]);
  assert.deepEqual(suffixes(baseBuild.transaction), ['base_registry_v8::new_track_row_v2', 'base_registry_v8::append_track_v2', 'base_registry_v8::new_visibility_program_v1', 'base_registry_v8::new_part_row_v2', 'base_registry_v8::append_part_v2', 'base_registry_v8::new_visibility_program_v1', 'base_registry_v8::new_item_row_v2', 'base_registry_v8::append_item_v2', ...Array(3).fill('base_registry_v8::new_signed_milli_v1'), 'base_registry_v8::new_transform_fixed_v1', 'base_registry_v8::new_physical_policy_v1', 'option::some', 'base_registry_v8::new_visibility_program_v1', 'base_registry_v8::new_style_row_v2', 'base_registry_v8::append_style_v2', 'base_registry_v8::new_asset_row_v2', 'base_registry_v8::append_asset_v2']);
  assert.ok(moves(baseBuild.transaction).filter(move => move.function.startsWith('append_')).every(move => JSON.stringify(move.typeArguments) === JSON.stringify([ntype(COIN)])));
  assert.deepEqual(suffixes(path.companionBuild.transaction), ['seal_v8::new_seal_registry_v8', 'seal_v8::share_seal_registry_v8', 'runtime_v8::new_runtime_registries_v8', 'runtime_v8::share_runtime_definition_registry_v8', 'runtime_v8::share_pack_registry_v8', 'runtime_v8::transfer_pack_admission_authority_v8', 'output_v8::new_output_registries_v8', 'output_v8::share_output_registries_v8', 'physical_v8::new_physical_registry_v8', 'physical_v8::share_physical_registry_v8', 'market_v8::new_market_objects_v8', 'market_v8::share_market_registry_v8', 'market_v8::share_market_treasury_v8']);
  assert.deepEqual(moves(path.companionBuild.transaction).map((move) => move.typeArguments.length), [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1]);
  assert.deepEqual(suffixes(activationBuild.transaction), ['seal_v8::seal_registry_v8']);
  const allTargets = [scaffoldTx, baseBuild.transaction, path.companionBuild.transaction, activationBuild.transaction].flatMap(exactMakerV8TransactionTargets).filter(target => !target.startsWith(nid('0x1') + '::option::'));
  assert.deepEqual(new Set(allTargets.map((target) => MAKER_V8_ROLE_ORDER.find((role) => target.startsWith(nid(fixture.packageRoles[role][1]))))), new Set(MAKER_V8_ROLE_ORDER));
  const modulesByRole = Object.freeze({
    core: ['maker_v8', 'base_registry_v8', 'core_v8'], seal: ['seal_v8'],
    runtime: ['runtime_v8', 'runtime_binding_v8'], output: ['output_v8'],
    physical: ['physical_v8'], market: ['market_v8'], release: ['release_v8'],
  });
  for (const target of allTargets) {
    const [packageId, module, fn] = target.split('::');
    const role = MAKER_V8_ROLE_ORDER.find((candidate) => packageId === nid(fixture.packageRoles[candidate][1]));
    assert.ok(role);
    assert.ok(modulesByRole[role].includes(module), `${role} cannot call ${module}`);
    assert.match(fn, /^[a-z][a-z0-9_]*_v[128]$/);
  }
});

test('successor publication consumes the archived predecessor authority atomically and certifies both roots', async () => {
  const document = clone(fixture.document);
  const previousRootId = nid('0x401');
  const previousAdminId = nid('0x402');
  const previousVersionCommitment = 'ab'.repeat(32);
  document.lineage.version = 2;
  document.lineage.previousRootId = previousRootId;
  document.lineage.previousVersionCommitment = previousVersionCommitment;
  document.lineage.changelog = ['Version 2'];

  const context = await trustedContext(document);
  const core = context.catalog.fields.roles.core.originalPackageId;
  const predecessor = certifyMakerV8SuccessorPredecessorV8(context, {
    schemaVersion: 'animacraft.maker-v8-successor-predecessor.v1',
    root: shared(previousRootId, `${core}::maker_v8::MakerRootV8<${COIN}>`, {
      version: 8,
      owner: context.signerAddress,
      adminCapId: previousAdminId,
      controlEpoch: '7',
      lifecycle: 3,
      makerKey: document.lineage.makerKey,
      makerVersion: 1,
      versionCommitment: previousVersionCommitment,
      successorAuthorityId: null,
      successorRootId: null,
    }),
    adminCap: owned(previousAdminId, `${core}::maker_v8::MakerAdminCapV8`, {
      version: 8,
      rootId: previousRootId,
      owner: context.signerAddress,
      controlEpoch: '7',
    }),
  });
  const publication = await compileMakerV8Publication(document, context, predecessor);
  const transaction = buildMakerV8ScaffoldTransaction(publication);
  assertScaffoldContentAbi(publication, transaction, true);
  assert.deepEqual(suffixes(transaction), [
    'maker_v8::new_economics_snapshot_v8',
    'maker_v8::new_onchain_native_rights_snapshot_v8',
    'base_registry_v8::new_base_definition_counts_v8',
    'maker_v8::issue_successor_authority_v8',
    'core_v8::new_successor_maker_draft_v8',
    'release_v8::finalize_product_release_binding_v8',
    'core_v8::share_maker_draft_v8',
  ]);
  assert.equal(suffixes(transaction).includes('core_v8::new_initial_maker_draft_v8'), false);

  const scaffold = await scaffoldReadback(publication);
  assert.equal(scaffold.root.fields.makerVersion, 2);
  assert.equal(scaffold.root.fields.previousRootId, previousRootId);
  assert.equal(scaffold.previousRoot.fields.successorAuthorityId, null);
  assert.equal(scaffold.previousRoot.fields.successorRootId, nid(fixture.ids.root));

  const wrongLineage = clone(document);
  wrongLineage.lineage.previousVersionCommitment = 'cd'.repeat(32);
  await assert.rejects(
    compileMakerV8Publication(wrongLineage, context, predecessor),
    (error) => ['MAKER_V8_MANIFEST_BYTES_MISMATCH', 'MAKER_V8_SUCCESSOR_LINEAGE_MISMATCH'].includes(error.code),
  );
  const tamperedReadback = clone({
    schemaVersion: MAKER_V8_SCAFFOLD_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    transactionDigest: DIGEST,
    ...await transactionKindProof({ transaction }),
    ...rootObjects(publication),
  });
  tamperedReadback.previousRoot.fields.successorRootId = nid('0x999');
  await assert.rejects(
    certifyMakerV8ScaffoldReadback(publication, tamperedReadback),
    (error) => error.code === 'MAKER_V8_SUCCESSOR_PREDECESSOR_READBACK_MISMATCH',
  );
});

test('targets use callable packages, stable origins remain readback-only, and ABI order/type arguments are exact', async () => {
  const path = await compilePath(); const activationBuilds = await allActivationBuilds(path);
  const commands = activationBuilds.flatMap((build) => moves(build.transaction));
  for (const move of commands) {
    if (move.function === 'epoch') {
      assert.equal(move.module, 'system');
      assert.equal(move.package, path.context.activationAuthority.walrusExecution.package.reference.objectId);
      assert.deepEqual(move.typeArguments, []);
      assert.equal(argumentObjectId(activationBuilds.at(-1).transaction, move.arguments[0]), path.context.activationAuthority.walrusSystem.reference.objectId);
      continue;
    }
    const role = MAKER_V8_ROLE_ORDER.find((candidate) => nid(fixture.packageRoles[candidate][1]) === move.package);
    assert.ok(role, `unknown callable package ${move.package}`);
    assert.equal(move.package, path.context.catalog.fields.roles[role].callablePackageId);
    const nongeneric = ['new_living_content_binding_v8', 'freeze_certified_living_content_v1'].includes(move.function);
    assert.deepEqual(move.typeArguments, nongeneric ? [] : [ntype(COIN)]);
  }
  const physical = commands.find((move) => move.function === 'append_base_style_policy_v8');
  assert.equal(physical.arguments.length, 17);
  assert.deepEqual(argKinds(physical), Array(17).fill('Input'));
  const physicalTransaction = activationBuilds.find((build) => moves(build.transaction).some((move) => move.function === 'append_base_style_policy_v8')).transaction;
  assert.deepEqual(physical.arguments.slice(0, 6).map((argument) => argumentObjectId(physicalTransaction, argument)), [fixture.ids.physicalRegistry, fixture.ids.root, fixture.ids.adminCap, fixture.ids.baseRegistry, fixture.ids.catalog, fixture.ids.physicalConfig].map(nid));
  const final = commands.at(-3);
  assert.equal(final.function, 'seal_and_activate_maker_v8');
  assert.equal(final.arguments.length, 11);
  assert.deepEqual(argKinds(final), ['Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Result', 'Input', 'Input', 'Input']);
  const finalTransaction = activationBuilds.at(-1).transaction;
  assert.deepEqual(final.arguments.slice(0, 4).map((argument) => argumentObjectId(finalTransaction, argument)), [fixture.ids.root, fixture.ids.adminCap, fixture.ids.protocolConfig, fixture.ids.catalog].map(nid));
  assert.equal(commands.at(-2).function, 'freeze_certified_living_content_v1');
  assert.equal(commands.at(-1).function, 'epoch');
  assert.equal(path.companion.physicalRegistry.type.startsWith(path.context.catalog.fields.roles.physical.originalPackageId), true);
  assert.notEqual(path.context.catalog.fields.roles.physical.originalPackageId, path.context.catalog.fields.roles.physical.callablePackageId);
});

test('publication topology, Activation append-to-seal cursors, and the exact 61-target ABI match compiler output', async () => {
  const document = clone(fixture.document); const assets = clone(fixture.transportAssets);
  document.colors = [{
    key: 'primary', label: 'Primary', defaultSwatchKey: 'black',
    swatches: [{ key: 'black', label: 'Black', rgba: '#000000ff', stops: [{ offset: 0, rgba: '#000000ff' }, { offset: 1, rgba: '#ffffffff' }] }],
  }];
  document.parts[0].items[0].styles[0].colorChannelKey = 'primary';
  document.parts[0].items[0].styles[0].defaultSwatchKey = 'black';
  document.parts[0].items[0].styles[0].protected = true;
  document.parts[0].items[0].styles[0].payload.animacraftSourceAsset = {
    sha256: await hashBytes(Buffer.from(assets[0].bytesBase64, 'base64')),
    mediaType: document.assets[0].mediaType, byteLength: Number(document.assets[0].byteLength),
  };
  assets.find((asset) => asset.assetId === document.parts[0].items[0].styles[0].assetId)
    .mediaType = 'application/vnd.animacraft.seal-ciphertext';
  document.defaultRecipe.colors = [{ channelKey: 'primary', swatchKey: 'black' }];
  document.rules = [{
    key: 'body-required', kind: 'REQUIRE',
    trigger: { source: 'BASE', sourceKey: null, partKey: 'body', itemKey: 'body', styleKey: null },
    targetMode: 'ALL',
    targets: [{ source: 'BASE', sourceKey: null, partKey: 'body', itemKey: 'body', styleKey: null }],
    payload: { fixture: 'abi-complete' },
  }];
  const outputTemplate = document.outputs[0];
  document.outputs = Array.from({ length: 17 }, (_, index) => ({
    ...clone(outputTemplate),
    key: `output${String(index).padStart(2, '0')}`,
    label: `Output ${index}`,
    payload: { fixture: 'abi-complete', index },
  }));
  document.commerce.rightsOrigin = 'LICENSE_WRAPPED';
  document.commerce.rightsEvidence = { licensor: 'Fixture Licensor', evidenceAssetId: 'rights-proof' };
  document.assets.push({ id: 'rights-proof', kind: 'rights-evidence', mediaType: 'application/pdf', byteLength: '5' });
  assets.push({ assetId: 'rights-proof', blobId: 'walrus-rights-proof-v8', mediaType: 'application/pdf', bytesBase64: 'JVBERi0=' });

  const context = await trustedContext(document, assets);
  const publication = await compileMakerV8Publication(document, context);
  const scaffold = await scaffoldReadback(publication);
  const baseRun = await allBaseBuilds(publication, scaffold);
  const companionBuild = await buildMakerV8CompanionObjectsTransaction(publication, baseRun.base);
  const companion = await companionReadback(publication, baseRun.base, companionBuild.expected, companionBuild.transaction);
  const activationBuilds = await allActivationBuilds({ publication, base: baseRun.base, companion });

  assert.deepEqual(
    baseRun.builds.map((build) => build.checkpoint.phase),
    MAKER_V8_PUBLICATION_TOPOLOGY.base.phases,
  );
  const activationPhases = activationBuilds.map((build) => build.checkpoint.phase);
  assert.deepEqual(
    activationPhases.filter((phase, index) => index === 0 || phase !== activationPhases[index - 1]),
    MAKER_V8_PUBLICATION_TOPOLOGY.activation.phases,
  );
  assert.ok(activationPhases.filter((phase) => phase === 'ACTIVATION_OUTPUT_APPEND').length > 1);
  const appendSealBoundaries = [];
  for (let index = 1; index < activationBuilds.length; index += 1) {
    const append = activationBuilds[index - 1].checkpoint;
    const seal = activationBuilds[index].checkpoint;
    if (append.action === 'APPEND' && seal.action === 'APPEND' && append.lane === seal.lane) {
      assert.equal(seal.startSequence, append.endSequence, `${append.lane} append chunks must be contiguous`);
    }
    if (append.action === 'APPEND' && seal.action === 'SEAL' && append.lane === seal.lane) {
      appendSealBoundaries.push(append.lane);
      assert.equal(seal.startSequence, append.endSequence, `${append.lane} seal must resume at the append end`);
      assert.equal(seal.endSequence, append.endSequence, `${append.lane} seal must cover the exact appended prefix`);
    }
  }
  assert.deepEqual(appendSealBoundaries, ['SEAL', 'RUNTIME', 'OUTPUT', 'PHYSICAL']);

  const nativeDocument = clone(fixture.document);
  addVisibilityTarget(nativeDocument);
  nativeDocument.parts[0].items[0].styles[0].visibleWhen = { op: 'selected', source: 'BASE', sourceKey: null, partKey: 'visibility-target', itemKey: 'body', styleKey: null };
  const nativePath = await compilePath(nativeDocument);
  const nativeBaseRun = await allBaseBuilds(nativePath.publication, nativePath.scaffold);
  const nativeActivationBuilds = await allActivationBuilds(nativePath);
  const emptySealExpected = MAKER_V8_PUBLICATION_TOPOLOGY.activation.phases
    .filter((phase) => phase !== 'ACTIVATION_SEAL_APPEND');
  assert.deepEqual(nativeActivationBuilds.map((build) => build.checkpoint.phase), emptySealExpected);
  assert.equal(nativeActivationBuilds.some((build) => build.checkpoint.phase === 'ACTIVATION_SEAL_APPEND'), false);
  assert.equal(nativeActivationBuilds.some((build) => build.checkpoint.phase === 'ACTIVATION_SEAL_SEAL'), true);
  const transactions = [
    buildMakerV8ScaffoldTransaction(nativePath.publication),
    buildMakerV8ScaffoldTransaction(publication),
    ...baseRun.builds.map((build) => build.transaction),
    companionBuild.transaction,
    ...activationBuilds.map((build) => build.transaction),
    ...nativeBaseRun.builds.map(build => build.transaction),
  ];
  assert.deepEqual(suffixes(transactions[0]), [
    'maker_v8::new_economics_snapshot_v8', 'maker_v8::new_onchain_native_rights_snapshot_v8',
    'base_registry_v8::new_base_definition_counts_v8',
    'core_v8::new_initial_maker_draft_v8', 'release_v8::finalize_product_release_binding_v8',
    'core_v8::share_maker_draft_v8',
  ]);
  assert.deepEqual(suffixes(transactions[1]), [
    'maker_v8::new_economics_snapshot_v8', 'release_v8::new_license_wrapped_rights_snapshot_v8',
    'base_registry_v8::new_base_definition_counts_v8',
    'core_v8::new_initial_maker_draft_v8', 'release_v8::finalize_product_release_binding_v8',
    'core_v8::share_maker_draft_v8',
  ]);
  assert.deepEqual(baseRun.builds.flatMap(build => suffixes(build.transaction).filter(fn => fn.startsWith('base_registry_v8::append_'))), [
    'base_registry_v8::append_track_v2', 'base_registry_v8::append_color_v2',
    'base_registry_v8::append_part_v2', 'base_registry_v8::append_item_v2',
    'base_registry_v8::append_style_v2', 'base_registry_v8::append_rule_v2',
    'base_registry_v8::append_asset_v2', 'base_registry_v8::append_asset_v2',
  ]);
  assert.deepEqual(suffixes(baseRun.builds.at(-1).transaction), ['base_registry_v8::seal_base_definition_registry_v8']);
  assert.deepEqual(suffixes(companionBuild.transaction), [
    'seal_v8::new_seal_registry_v8', 'seal_v8::share_seal_registry_v8',
    'runtime_v8::new_runtime_registries_v8', 'runtime_v8::share_runtime_definition_registry_v8',
    'runtime_v8::share_pack_registry_v8', 'runtime_v8::transfer_pack_admission_authority_v8',
    'output_v8::new_output_registries_v8', 'output_v8::share_output_registries_v8',
    'physical_v8::new_physical_registry_v8', 'physical_v8::share_physical_registry_v8',
    'market_v8::new_market_objects_v8', 'market_v8::share_market_registry_v8',
    'market_v8::share_market_treasury_v8',
  ]);
  const actualKeys = [];
  const activationOrder = Object.freeze({
    ACTIVATION_SEAL_APPEND: ['release_v8::certify_base_ciphertext_v8', 'seal_v8::append_protected_asset_v8'],
    ACTIVATION_SEAL_SEAL: ['seal_v8::seal_registry_v8'],
    ACTIVATION_RUNTIME_APPEND: ['runtime_v8::append_part_profile_v8'],
    ACTIVATION_RUNTIME_SEAL: ['runtime_v8::seal_runtime_definitions_v8'],
    ACTIVATION_OUTPUT_APPEND: ['output_v8::append_output_policy_v8'],
    ACTIVATION_OUTPUT_SEAL: ['output_v8::seal_output_registry_v8'],
    ACTIVATION_PHYSICAL_APPEND: ['physical_v8::append_base_style_policy_v8'],
    ACTIVATION_PHYSICAL_SEAL: ['physical_v8::seal_physical_registry_v8'],
    ACTIVATION_FINALIZE: [
      'market_v8::seal_market_registry_v8',
      'core_v8::new_living_content_binding_v8',
      'core_v8::certify_walrus_living_content_v1',
      'release_v8::prepare_maker_companion_binding_v2',
      'market_v8::bind_maker_market_companion_v2',
      'core_v8::finish_maker_companion_binding_v2',
      'release_v8::seal_and_activate_maker_v8',
      'core_v8::freeze_certified_living_content_v1',
      'system::epoch',
    ],
  });
  for (const build of activationBuilds) {
    const expected = activationOrder[build.checkpoint.phase];
    const repeat = build.checkpoint.action === 'APPEND'
      ? Number(build.checkpoint.endSequence) - Number(build.checkpoint.startSequence)
      : 1;
    assert.deepEqual(suffixes(build.transaction), expected.length === 1 ? Array(repeat).fill(expected[0]) : expected);
  }
  for (const transaction of transactions) {
    // Compare generated calls to the actual contracts, not another JS ABI copy.
    for (const move of moves(transaction)) {
      const role = MAKER_V8_ROLE_ORDER.find(candidate => nid(fixture.packageRoles[candidate][1]) === move.package);
      if (!role) continue; // Sui stdlib has its own SDK coverage.
      const source = await readFile(new URL(`../move/animacraft_v8_${role}/sources/${move.module}.move`, import.meta.url), 'utf8');
      const declaration = new RegExp(`public(?:\\s+entry)?\\s+fun\\s+${move.function}(?:<([^>]+)>)?\\s*\\(([\\s\\S]*?)\\)`).exec(source);
      assert.ok(declaration, `missing production declaration ${role}::${move.function}`);
      const parameters = []; let depth = 0; let start = 0;
      const signature = declaration[2].replace(/\/\/[^\n]*/g, '');
      for (let i = 0; i <= signature.length; i += 1) {
        if (signature[i] === '<' || signature[i] === '(') depth += 1;
        if (signature[i] === '>' || signature[i] === ')') depth -= 1;
        if (i === signature.length || (signature[i] === ',' && depth === 0)) {
          const parameter = signature.slice(start, i).trim(); start = i + 1;
          if (parameter && !/:\s*&(?:mut\s+)?TxContext$/.test(parameter)) parameters.push(parameter);
        }
      }
      assert.equal(move.arguments.length, parameters.length, `${role}::${move.function} actual Move parameter count`);
      assert.equal(move.typeArguments.length, declaration[1] ? declaration[1].split(',').filter(x => x.trim()).length : 0, `${role}::${move.function} actual Move type parameters`);
    }
    const extracted = exactMakerV8TransactionTargets(transaction).map(compilerTargetKey);
    const commandOrder = moves(transaction).map((move) => compilerTargetKey(`${move.package}::${move.module}::${move.function}`));
    assert.deepEqual(extracted, commandOrder, 'target projection must preserve exact MoveCall order');
    actualKeys.push(...extracted.filter(key => !key.startsWith('stdlib:') && !key.startsWith('walrus:')));
  }
  // The exact successor test above executes both conditional scaffold calls;
  // include that mutually exclusive branch in the compiler-wide ABI union.
  actualKeys.push(
    'core:maker_v8::issue_successor_authority_v8',
    'core:core_v8::new_successor_maker_draft_v8',
  );

  assert.deepEqual(Object.keys(MAKER_V8_PUBLICATION_COMPILER_ABI), MAKER_V8_ROLE_ORDER);
  const declaredKeys = MAKER_V8_ROLE_ORDER.flatMap((role) => (
    MAKER_V8_PUBLICATION_COMPILER_ABI[role].map((suffix) => `${role}:${suffix}`)
  ));
  assert.equal(declaredKeys.length, 61);
  assert.equal(new Set(declaredKeys).size, 61);
  assert.deepEqual(
    [...new Set(actualKeys)].sort(compareMakerV8ProtocolText),
    [...declaredKeys].sort(compareMakerV8ProtocolText),
  );

  const source = await readFile(new URL('../maker-v8-compiler.js', import.meta.url), 'utf8');
  const literalKeys = [...source.matchAll(/call\(tx,\s*publication,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/g)]
    .map((match) => `${match[1]}:${match[2]}::${match[3]}`);
  assert.match(source, /appendMakerV8BaseRowCommandsV2\(tx, args\)/);
  const dynamicKeys = [
    ...['track', 'color', 'part', 'item', 'style', 'asset'].map(kind => `core:base_registry_v8::append_${kind}_v2`),
    ...['track', 'color_channel', 'part', 'item', 'style', 'asset'].map(kind => `core:base_registry_v8::new_${kind}_row_v2`),
    ...['color_stop_v2', 'color_swatch_v2', 'signed_milli_v1', 'transform_fixed_v1', 'physical_policy_v1', 'visibility_program_v1'].map(name => `core:base_registry_v8::new_${name}`),
  ];
  const ruleConstructorKeys = [...source.matchAll(/target: `\$\{module\}::([a-z0-9_]+)`/g)]
    .map(match => `core:base_registry_v8::${match[1]}`);
  assert.deepEqual(ruleConstructorKeys, [
    'core:base_registry_v8::new_semantic_selector_v2',
    'core:base_registry_v8::new_rule_row_v2',
    'core:base_registry_v8::append_rule_v2',
  ]);
  const callSites = [...source.matchAll(/\bcall\(tx,\s*publication,\s*([^,]+),\s*([^,]+),\s*([^,]+),/g)]
    .filter((match) => match[1].trim() !== 'role');
  const dynamicSites = callSites
    .filter((match) => ![match[1], match[2], match[3]].every((value) => /^'[^']+'$/.test(value.trim())))
    .map((match) => [match[1], match[2], match[3]].map((value) => value.trim()).join('|'));
  assert.equal(callSites.length, literalKeys.length);
  assert.deepEqual(dynamicSites, []);
  assert.deepEqual(
    [...new Set([...literalKeys, ...dynamicKeys, ...ruleConstructorKeys])].sort(compareMakerV8ProtocolText),
    [...declaredKeys].sort(compareMakerV8ProtocolText),
    'the exported ABI must have no missing or extra literal/dynamic compiler target',
  );
});

test('license-wrapped protected Base uses only Release certification wrappers and exact consumed result order', async () => {
  const document = clone(fixture.document); const assets = clone(fixture.transportAssets);
  document.parts[0].items[0].styles[0].protected = true;
  document.parts[0].items[0].styles[0].payload.animacraftSourceAsset = {
    sha256: await hashBytes(Buffer.from(assets[0].bytesBase64, 'base64')),
    mediaType: document.assets[0].mediaType, byteLength: Number(document.assets[0].byteLength),
  };
  assets.find((asset) => asset.assetId === document.parts[0].items[0].styles[0].assetId)
    .mediaType = 'application/vnd.animacraft.seal-ciphertext';
  const missingSource = clone(document);
  delete missingSource.parts[0].items[0].styles[0].payload.animacraftSourceAsset;
  await assert.rejects(compilePath(missingSource, assets), { code: 'MAKER_V8_SOURCE_ASSET_MISMATCH' });
  document.commerce.rightsOrigin = 'LICENSE_WRAPPED'; document.commerce.rightsEvidence = { licensor: 'Fixture Licensor', evidenceAssetId: 'rights-proof' };
  document.assets.push({ id: 'rights-proof', kind: 'rights-evidence', mediaType: 'application/pdf', byteLength: '5' });
  assets.push({ assetId: 'rights-proof', blobId: 'walrus-rights-proof-v8', mediaType: 'application/pdf', bytesBase64: 'JVBERi0=' });
  const path = await compilePath(document, assets); const scaffoldTx = buildMakerV8ScaffoldTransaction(path.publication);
  const sealConstructor = moves(path.companionBuild.transaction).find(call => call.function === 'new_seal_registry_v8');
  assert.equal(sealConstructor.arguments.length, 6);
  const forgedSeal = await companionRaw(path.publication, path.base, path.companionBuild.expected, path.companionBuild.transaction);
  forgedSeal.sealRegistry.fields.packCommitment = '99'.repeat(32);
  await assert.rejects(certifyMakerV8CompanionReadback(path.publication, path.base, forgedSeal), error => error.code === 'MAKER_V8_SEAL_READBACK_MISMATCH');
  const activationBuild = await buildMakerV8ActivationChunkTransaction(path.publication, path.base, path.companion);
  const activationTx = activationBuild.transaction;
  assert.ok(suffixes(scaffoldTx).includes('release_v8::new_license_wrapped_rights_snapshot_v8'));
  const rightsCall = moves(scaffoldTx).find(call => call.function === 'new_license_wrapped_rights_snapshot_v8');
  assert.equal(rightsCall.arguments.length, 11);
  const releaseSource = await readFile(new URL('../move/animacraft_v8_release/sources/release_v8.move', import.meta.url), 'utf8');
  const rightsSignature = /public fun new_license_wrapped_rights_snapshot_v8\(([\s\S]*?)\): RightsSnapshotV8/.exec(releaseSource);
  assert.ok(rightsSignature, 'license wrapper must remain an actual production declaration');
  const rightsParameters = rightsSignature[1].split(',').map(x => x.trim()).filter(x => x && !x.endsWith(': &TxContext'));
  assert.equal(rightsCall.arguments.length, rightsParameters.length, 'license calls also track actual Move ABI, not the native-only branch');
  assert.deepEqual(rightsCall.arguments.slice(0, 4).map(argument => argumentObjectId(scaffoldTx, argument)), [fixture.ids.protocolConfig, fixture.ids.catalog, path.context.activationAuthority.replacement.reference.objectId, fixture.ids.releaseConfig].map(nid));
  assert.equal(suffixes(scaffoldTx).includes('maker_v8::new_onchain_native_rights_snapshot_v8'), false);
  assert.deepEqual(suffixes(activationTx), ['release_v8::certify_base_ciphertext_v8', 'seal_v8::append_protected_asset_v8']);
  const [certify, append] = moves(activationTx);
  assert.equal(certify.arguments.length, 12);
  assert.deepEqual(argKinds(certify), Array(12).fill('Input'));
  assert.deepEqual(argKinds(append), ['Input', 'Input', 'Input', 'Input', 'Input', 'Result']);
  assert.deepEqual(certify.arguments.slice(0, 5).map((argument) => argumentObjectId(activationTx, argument)), [fixture.ids.protocolConfig, fixture.ids.catalog, fixture.ids.releaseConfig, fixture.ids.sealConfig, fixture.ids.root].map(nid));
  assert.deepEqual(append.arguments.slice(0, 4).map((argument) => argumentObjectId(activationTx, argument)), [fixture.ids.sealRegistry, fixture.ids.root, fixture.ids.adminCap, fixture.ids.sealConfig].map(nid));
  assert.equal(certify.package, path.context.catalog.fields.roles.release.callablePackageId);
  assert.equal(append.package, path.context.catalog.fields.roles.seal.callablePackageId);
  const forged = clone(document); forged.parts[0].items[0].styles[0].payload.ciphertextSha256 = 'ff'.repeat(32);
  await assert.rejects(compileMakerV8Publication(forged, path.context), (error) => ['MAKER_V8_AUTHOR_AUTHORITY_FORBIDDEN', 'MAKER_V8_COMPILER_FIELD_FORBIDDEN'].includes(error.code));
});

test('caller-authored authority and unverified lookalikes cannot reach a transaction', async () => {
  const document = clone(fixture.document); document.rootId = fixture.ids.root;
  const context = await trustedContext();
  const disabled = clone(context); delete disabled._derived; disabled.protocolConfig.fields.enabled = false;
  await assert.rejects(certifyMakerV8TrustedContext(disabled), (error) => error.code === 'MAKER_V8_PROTOCOL_DISABLED');
  const inventedCommitment = clone(context); delete inventedCommitment._derived; inventedCommitment.protocolConfig.fields.commitment = 'ff'.repeat(32); inventedCommitment.catalog.fields.protocolConfigCommitment = 'ff'.repeat(32);
  await assert.rejects(certifyMakerV8TrustedContext(inventedCommitment), (error) => error.code === 'MAKER_V8_PROTOCOL_COMMITMENT_MISMATCH');
  await assert.rejects(compileMakerV8Publication(document, context), (error) => ['MAKER_V8_FIELDS_INVALID', 'MAKER_V8_AUTHOR_AUTHORITY_FORBIDDEN', 'MAKER_V8_COMPILER_FIELD_FORBIDDEN'].includes(error.code));
  await assert.rejects(compileMakerV8Publication(fixture.document, clone(context)), (error) => error.code === 'MAKER_V8_TRUSTED_CONTEXT_REQUIRED');
  const publication = await compileMakerV8Publication(fixture.document, context);
  await assert.rejects(buildMakerV8BaseChunkTransaction(publication, rootObjects(publication)), (error) => error.code === 'MAKER_V8_SCAFFOLD_CONTEXT_REQUIRED');
  const scaffold = await scaffoldReadback(publication); const base = certifyMakerV8BaseReadback(publication, scaffold, baseReadbackRaw(publication, scaffold)); const built = await buildMakerV8CompanionObjectsTransaction(publication, base); const lookalike = await companionRaw(publication, base, built.expected, built.transaction);
  await assert.rejects(buildMakerV8ActivationChunkTransaction(publication, base, lookalike), (error) => error.code === 'MAKER_V8_COMPANION_CONTEXT_REQUIRED');
});

test('current Seal policy binds its own object identity and exact canonical committee', async t => {
  const context = await trustedContext();
  const raw = () => Object.fromEntries(['schemaVersion', 'chainIdentifier', 'signerAddress', 'paymentCoinType',
    'protocolProfile', 'coreArtifact', 'clock', 'protocolConfig', 'protocolTreasury', 'catalog', 'configs',
    'activationAuthority', 'transport'].map(key => [key, clone(context[key])]));
  for (const [label, mutate] of Object.entries({
    'different policy object': c => { c.configs.seal.reference.objectId = nid('0x123456'); },
    'different policy hash': c => { c.configs.seal.fields.commitment = 'ff'.repeat(32); },
    'different encryption hash': c => { c.configs.seal.fields.encryptionPolicyCommitment = 'ff'.repeat(32); },
    'different key hash': c => { c.configs.seal.fields.keyServerSetCommitment = 'ff'.repeat(32); },
    'zero key': c => { c.configs.seal.fields.keyServerIds = ['0x0']; },
    'zero weight': c => { c.configs.seal.fields.weights = [0]; },
    'too many shares': c => { c.configs.seal.fields.weights = [255]; },
    'zero threshold': c => { c.configs.seal.fields.threshold = 0; },
    'threshold exceeds shares': c => { c.configs.seal.fields.threshold = 2; },
    'duplicate keys': c => { const f = c.configs.seal.fields; f.keyServerIds.push(f.keyServerIds[0]); f.weights.push(1); },
    'reversed keys': c => { const f = c.configs.seal.fields; f.keyServerIds.push(nid('0x600')); f.weights.push(1); },
    'malformed weights': c => { c.configs.seal.fields.weights = null; },
  })) await t.test(label, async () => {
    const candidate = raw(); mutate(candidate);
    await assert.rejects(certifyMakerV8TrustedContext(candidate), error =>
      ['MAKER_V8_SEAL_POLICY_COMMITMENT_MISMATCH', 'MAKER_V8_SEAL_SERVERS_INVALID'].includes(error.code));
  });
});

test('manifest, asset bytes, package tuple, stable TypeOrigin, and zero-state tampering fail closed', async () => {
  const manifestContext = await trustedContext();
  const differentDocument = clone(fixture.document); differentDocument.metadata.summary = 'tampered after certification';
  await assert.rejects(compileMakerV8Publication(differentDocument, manifestContext), (error) => error.code === 'MAKER_V8_MANIFEST_BYTES_MISMATCH');
  const badLength = clone(fixture.document); badLength.assets[0].byteLength = '9'; const badLengthContext = await trustedContext(badLength);
  await assert.rejects(compileMakerV8Publication(badLength, badLengthContext), (error) => error.code === 'MAKER_V8_CERTIFIED_ASSET_METADATA_MISMATCH');
  const tuple = await releaseTuple(); const collision = clone(tuple.roles); collision.runtime.originalPackageId = collision.seal.callablePackageId; collision.runtime.originalMarkerType = `${collision.runtime.originalPackageId}::runtime_v8::RuntimeOriginalMarkerV8`;
  await assert.rejects(deriveMakerV8ReleaseCommitments({ catalogId: fixture.ids.catalog, roles: collision, authorities: tuple.authorities }), (error) => { assert.equal(error.code, 'MAKER_V8_PACKAGE_BINDING_COMMITMENT_MISMATCH'); collision.runtime.bindingCommitment = error.details.expected; return true; });
  await assert.rejects(deriveMakerV8ReleaseCommitments({ catalogId: fixture.ids.catalog, roles: collision, authorities: tuple.authorities }), (error) => error.code === 'MAKER_V8_PACKAGE_ROLE_COLLISION');
  const path = await compilePath(); const wrongType = await companionRaw(path.publication, path.base, path.companionBuild.expected, path.companionBuild.transaction); wrongType.physicalRegistry.type = wrongType.physicalRegistry.type.replace(path.context.catalog.fields.roles.physical.originalPackageId, path.context.catalog.fields.roles.physical.callablePackageId);
  await assert.rejects(certifyMakerV8CompanionReadback(path.publication, path.base, wrongType), (error) => error.code === 'MAKER_V8_TYPE_ORIGIN_MISMATCH');
  const zero = clone(path.companion); delete zero.expected; delete zero.transactionKind; Object.assign(zero, await transactionKindProof(path.companionBuild)); zero.marketRegistry.fields.zeroStateCommitment = 'ff'.repeat(32);
  await assert.rejects(certifyMakerV8CompanionReadback(path.publication, path.base, zero), (error) => error.code === 'MAKER_V8_MARKET_ZERO_COMMITMENT_MISMATCH');
});

test('owned Base Item policy and multi-capacity Parts compile exactly', async () => {
  const context = await trustedContext();
  const itemAssetized = clone(fixture.document); itemAssetized.composition.itemAssetization = true;
  itemAssetized.composition.mode = 'COMPOSABLE';
  itemAssetized.parts[0].wardrobeMode = 'SLOT';
  const itemAssetizedPublication = await compileMakerV8Publication(
    itemAssetized,
    await trustedContext(itemAssetized),
  );
  assert.equal(itemAssetizedPublication.runtime.itemAssetization, true);
  assert.notEqual(itemAssetizedPublication.commitments.packAdmissionPolicy, fixture.expected.runtimePolicyCommitment);
  const capacity = clone(fixture.document); capacity.parts[0].capacity = 2;
  const capacityPublication = await compileMakerV8Publication(capacity, await trustedContext(capacity));
  assert.equal(capacityPublication.runtime.profiles[0].capacity, 2n);
  const economics = clone(fixture.document); economics.commerce.makerAccess.purchasePriceAtomic = '1'; const economicsContext = context;
  await assert.rejects(compileMakerV8Publication(economics, economicsContext), (error) => ['MAKER_V8_ECONOMICS_ABI_INVALID', 'MAKER_V8_ACCESS_PRICE_INVALID'].includes(error.code));
  const output = clone(fixture.document); output.outputs[0].allowedPackPolicy = { kind: 'ALLOWLIST', packIds: ['z-pack', 'a-pack'] }; const outputContext = context;
  await assert.rejects(compileMakerV8Publication(output, outputContext), (error) => ['MAKER_V8_OUTPUT_PACK_POLICY_INVALID', 'MAKER_V8_PACK_ALLOWLIST_INVALID'].includes(error.code));
  const physical = clone(fixture.document); physical.parts[0].items[0].styles[0].physical.proof = 'CANONICAL_SOUL';
  await assert.rejects(compilePath(physical), (error) => error.code === 'MAKER_V8_PHYSICAL_POLICY_ABI_INVALID');
  assert.equal(Object.keys(await import('../maker-v8-compiler.js')).some((name) => /plan.*call/i.test(name)), false);
});

test('certified bytes above one MiB compile without argument spread and tamper fails exactly', async () => {
  const document = clone(fixture.document);
  const bytes = Buffer.alloc((1024 * 1024) + 333, 0xa5);
  const assets = clone(fixture.transportAssets);
  assets[0].bytesBase64 = bytes.toString('base64');
  document.assets[0].byteLength = String(bytes.length);
  const context = await trustedContext(document, assets);
  const publication = await compileMakerV8Publication(document, context);
  assert.equal(publication.rows.style[0].source.transport.byteLength, bytes.length);

  const tampered = await trustedContext(document, assets, (transport) => {
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    transport.assets[0].bytesBase64 = changed.toString('base64');
  });
  await assert.rejects(compileMakerV8Publication(document, tampered), (error) => error.code === 'MAKER_V8_MANIFEST_BYTES_MISMATCH');

  const largeManifestDocument = clone(document);
  largeManifestDocument.parts[0].items[0].styles[0].payload.large = 'm'.repeat((1024 * 1024) + 111);
  await assert.rejects(compileMakerV8Publication(largeManifestDocument, context), (error) => {
    assert.equal(error.code, 'MAKER_V8_MANIFEST_BYTES_MISMATCH');
    assert.deepEqual(Object.keys(error.details).sort(), ['canonicalByteLength', 'canonicalSha256', 'certifiedByteLength', 'certifiedSha256']);
    assert.ok(error.details.canonicalByteLength > 1024 * 1024);
    assert.equal(JSON.stringify(error.details).includes('mmmmmmmm'), false);
    return true;
  });
});

test('current seal budget includes Part, Item and Asset children at exact publication boundaries', async () => {
  assert.equal(MAKER_V8_DOCUMENT_LIMITS.styles, 500);
  assert.equal(MAKER_V8_DOCUMENT_LIMITS.styleSealObjectRuntimeUnits, 1000);
  const colorless497 = styleLimitDocument(497, 0);
  const colored331 = styleLimitDocument(331, 331);
  assert.doesNotThrow(() => assertMakerV8Document(colorless497, { mode: 'compile' }));
  assert.doesNotThrow(() => assertMakerV8Document(colored331, { mode: 'compile' }));
  assert.throws(
    () => assertMakerV8Document(styleLimitDocument(332, 332), { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_STYLE_SEAL_LIMIT'),
  );
  assert.throws(
    () => assertMakerV8Document(styleLimitDocument(498, 0), { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_STYLE_SEAL_LIMIT'),
  );

  const context = await trustedContext(colorless497);
  const publication = await compileMakerV8Publication(colorless497, context);
  const scaffold = await scaffoldReadback(publication);
  let prior = null; let build; let chunks = 0;
  do {
    build = await buildMakerV8BaseChunkTransaction(publication, scaffold, prior);
    assert.ok(build.checkpoint.metrics.kindBytes <= 96 * 1024);
    assert.ok(build.checkpoint.metrics.commands <= 64);
    prior = await certifyMakerV8BaseChunkReadback(
      publication,
      scaffold,
      build,
      await baseChunkRaw(publication, scaffold, build, `${DIGEST}m${chunks}`),
    );
    chunks += 1;
  } while (!build.checkpoint.final);
  assert.ok(chunks > 30);
});

test('compiler Color rows exactly match the canonical document and Move count limit', async () => {
  const accepted = colorRowLimitDocument(MAKER_V8_DOCUMENT_LIMITS.colors);
  const context = await trustedContext(accepted);
  assert.doesNotThrow(() => assertMakerV8Document(accepted, { mode: 'compile' }));
  await assert.rejects(compileMakerV8Publication(accepted, context), error =>
    error.code === 'MAKER_V8_TRANSACTION_LIMIT_UNSATISFIABLE'
      && error.details.phase === 'BASE_PREFLIGHT' && error.details.kind === 'color'
      && error.details.metrics.commands > 64);

  const overLimit = colorRowLimitDocument(MAKER_V8_DOCUMENT_LIMITS.colors + 1);
  await assert.rejects(
    compileMakerV8Publication(overLimit, context),
    (error) => error.issues?.some((entry) => entry.code === 'MAKER_V8_COLOR_LIMIT'
      && entry.details.observedColorRows === MAKER_V8_DOCUMENT_LIMITS.colors + 1),
  );
});

test('visibility publication binds nonempty rows and restores exact leaf counts with real PTB budgets', async () => {
  const document = clone(fixture.document);
  addVisibilityTarget(document);
  const leaf = () => ({ op: 'selected', source: 'BASE', sourceKey: null, partKey: 'visibility-target', itemKey: 'body', styleKey: null });
  const item = document.parts[0].items[0];
  item.styles = Array.from({ length: 5 }, (_, index) => ({ ...clone(item.styles[0]), key: index ? `conditional-${index}` : item.styles[0].key,
    displayOrder: index, visibleWhen: { op: 'all', conditions: [leaf(), { op: 'not', condition: { op: 'not', condition: leaf() } }] } }));
  const publication = await compileMakerV8Publication(document, await trustedContext(document));
  const unconditional = clone(document); unconditional.parts[0].items[0].styles.forEach(style => { delete style.visibleWhen; });
  const baseline = await compileMakerV8Publication(unconditional, await trustedContext(unconditional));
  assert.notEqual(publication.commitments.baseAuthorRows, baseline.commitments.baseAuthorRows);
  assert.notEqual(publication.commitments.content, baseline.commitments.content);
  const scaffold = await scaffoldReadback(publication);
  let prior = null; let build; let count = 0;
  const flatRows = MAKER_V8_BASE_CATEGORIES_V2.flatMap(([kind]) => publication.rows[kind]);
  do {
    build = await buildMakerV8BaseChunkTransaction(publication, scaffold, prior);
    const expectedLeaves = flatRows.slice(0, Number(build.checkpoint.endSequence))
      .reduce((sum, row) => sum + (row.visibility_tokens ?? []).filter(token => token.opcode === 0).length, 0);
    assert.equal(build.checkpoint.expected.visibilityLeafCount, String(expectedLeaves));
    const actualBytes = await build.transaction.build({ onlyTransactionKind: true });
    assert.equal(build.checkpoint.metrics.kindBytes, actualBytes.length);
    assert.equal(build.checkpoint.metrics.commands, build.transaction.getData().commands.length);
    assert.ok(build.checkpoint.metrics.commands <= 64);
    const raw = await baseChunkRaw(publication, scaffold, build, `${DIGEST}visibility${count}`);
    if (expectedLeaves > 0) {
      const altered = clone(raw); altered.baseRegistry.fields.visibilityLeafCount = '0';
      await assert.rejects(certifyMakerV8BaseChunkReadback(publication, scaffold, build, altered), { code: 'MAKER_V8_BASE_SEQUENCE_MISMATCH' });
    }
    prior = await rehydrateMakerV8BaseChunkCertificateV8(publication, scaffold, { checkpoint: build.checkpoint, readback: raw });
    count++;
  } while (!build.checkpoint.final);
  assert.ok(count > 2, 'actual row constructors must still split the unchanged command budget');
  assert.equal(prior.base.baseRegistry.fields.visibilityLeafCount, '10');
  assert.ok(MAKER_V8_PUBLICATION_COMPILER_ABI.core.includes('base_registry_v8::new_visibility_program_v1'));
});

test('Base preflight rejects oversized pure arguments before issuing any scaffold publication', async () => {
  const document = clone(fixture.document);
  const style = document.parts[0].items[0].styles[0];
  document.tracks = Array.from({ length: 130 }, (_, index) => ({ key: `track-${index}`.padEnd(128, 'x'), label: `Track ${index}`, renderOrder: index, locked: false }));
  document.parts[0].items[0].styles = document.tracks.map((track, index) => ({ ...clone(style), key: index === 0 ? style.key : `style-${index}`, displayOrder: index, trackKey: track.key }));
  const context = await trustedContext(document);
  await assert.rejects(compileMakerV8Publication(document, context), error =>
    error.code === 'MAKER_V8_TRANSACTION_LIMIT_UNSATISFIABLE'
      && error.details.phase === 'BASE_PREFLIGHT' && error.details.kind === 'part'
      && error.details.metrics.commands < 64 && error.details.metrics.inputs < 256
      && error.details.metrics.kindBytes < 96 * 1024
      && error.details.metrics.maxPureArgumentBytes > 16384);
});

test('32 distinct visibility leaves at depth eight publish and recover within unchanged PTB budgets', async () => {
  const protocol = JSON.parse(await readFile(new URL('./harness/animacraft_v8_seal_cap_harness/evidence/protocol-config-v137.rpc.json', import.meta.url), 'utf8'));
  assert.equal(MAKER_V8_TRANSACTION_LIMITS.maxPureArgumentBytes, Number(protocol.result.attributes.max_pure_argument_size.u32));
  assert.equal(MAKER_V8_TRANSACTION_LIMITS.maxCommands, 64);
  const document = clone(fixture.document);
  addVisibilityTarget(document);
  const target = document.parts[1].items[0];
  target.styles = Array.from({ length: 32 }, (_, i) => ({ ...clone(target.styles[0]), key: i === 0 ? target.defaultStyleKey : `choice-${i}`.padEnd(128, 'x'), displayOrder: i }));
  document.parts[0].items[0].styles[0].visibleWhen = { op: 'any', conditions: target.styles.map(style => {
    let condition = { op: 'selected', source: 'BASE', sourceKey: null, partKey: 'visibility-target', itemKey: 'body', styleKey: style.key };
    for (let i = 0; i < 6; i++) condition = { op: 'not', condition };
    return condition;
  }) };
  const publication = await compileMakerV8Publication(document, await trustedContext(document));
  const scaffold = await scaffoldReadback(publication);
  assert.equal(publication.rows.style[0].visibility_tokens.length, 225);
  let prior = null, build;
  do {
    build = await buildMakerV8BaseChunkTransaction(publication, scaffold, prior);
    assert.ok(build.checkpoint.metrics.commands <= 64);
    assert.ok(build.checkpoint.metrics.inputs <= 256);
    assert.ok(build.checkpoint.metrics.maxPureArgumentBytes <= 16384);
    assert.ok(build.checkpoint.metrics.kindBytes <= 96 * 1024);
    prior = await rehydrateMakerV8BaseChunkCertificateV8(publication, scaffold, { checkpoint: build.checkpoint, readback: await baseChunkRaw(publication, scaffold, build) });
  } while (!build.checkpoint.final);
  assert.equal(prior.base.baseRegistry.fields.visibilityLeafCount, '32');
});

test('bounded chunks require exact prior finalized certificates and certify ACTIVE readback', async () => {
  const document = clone(fixture.document);
  document.rules = Array.from({ length: 1000 }, (_, index) => ({
    key: `r${String(index).padStart(4, '0')}`,
    kind: index % 2 ? 'REQUIRE' : 'EXCLUDE',
    trigger: { source: 'BASE', sourceKey: null, partKey: 'body', itemKey: 'body', styleKey: null },
    targetMode: index % 2 ? 'ALL' : 'ANY',
    targets: [{ source: 'BASE', sourceKey: null, partKey: 'body', itemKey: 'body', styleKey: null }],
    payload: { index },
  }));
  const context = await trustedContext(document);
  const publication = await compileMakerV8Publication(document, context);
  const scaffold = await scaffoldReadback(publication);
  let prior = null; let build; let certificate; let chunkCount = 0;
  do {
    build = await buildMakerV8BaseChunkTransaction(publication, scaffold, prior);
    assert.ok(build.checkpoint.metrics.kindBytes <= 96 * 1024);
    assert.ok(build.checkpoint.metrics.commands <= 64);
    assert.ok(build.checkpoint.metrics.inputs <= 256);
    const raw = await baseChunkRaw(publication, scaffold, build, `${DIGEST}${chunkCount}`);
    certificate = await certifyMakerV8BaseChunkReadback(publication, scaffold, build, raw);
    if (chunkCount === 0) {
      prior = await rehydrateMakerV8BaseChunkCertificateV8(publication, scaffold, { checkpoint: build.checkpoint, readback: raw });
      const tampered = { checkpoint: clone(build.checkpoint), readback: raw };
      tampered.checkpoint.endSequence = String(Number(tampered.checkpoint.endSequence) + 1);
      await assert.rejects(rehydrateMakerV8BaseChunkCertificateV8(publication, scaffold, tampered), (error) => error.code === 'MAKER_V8_BASE_PROGRESS_INVALID');
    } else prior = certificate;
    chunkCount += 1;
  } while (!build.checkpoint.final);
  assert.ok(chunkCount > 4);
  assert.ok(certificate.base);
  await assert.rejects(buildMakerV8BaseChunkTransaction(publication, scaffold, clone(certificate)), (error) => error.code === 'MAKER_V8_BASE_CHUNK_CERTIFICATE_REQUIRED');

  const companionBuild = await buildMakerV8CompanionObjectsTransaction(publication, certificate.base);
  const companion = await companionReadback(publication, certificate.base, companionBuild.expected);
  let activationPrior = null; let activationBuild; let activationCertificate; const phases = [];
  do {
    activationBuild = await buildMakerV8ActivationChunkTransaction(publication, certificate.base, companion, activationPrior);
    phases.push(activationBuild.checkpoint.phase);
    assert.ok(activationBuild.checkpoint.metrics.kindBytes <= 96 * 1024);
    const raw = await activationChunkRaw(activationBuild, companion, `${DIGEST}a${phases.length}`);
    if (activationBuild.checkpoint.final) Object.assign(raw, {
      makerKey: publication.document.lineage.makerKey,
      versionCommitment: publication.commitments.version,
      manifestSha256: publication.manifest.sha256,
      contentCommitment: publication.commitments.content,
      protocolConfigCommitment: publication.context.protocolConfig.fields.commitment,
      productBindingCommitment: publication.context._derived.productBindingCommitment,
      callCapSetCommitment: publication.context._derived.callCapSetCommitment,
    });
    activationCertificate = await certifyMakerV8ActivationChunkReadback(publication, certificate.base, companion, activationBuild, raw);
    if (phases.length === 1) {
      activationPrior = await rehydrateMakerV8ActivationChunkCertificateV8(publication, certificate.base, companion, { checkpoint: activationBuild.checkpoint, readback: raw });
      const tampered = { checkpoint: clone(activationBuild.checkpoint), readback: raw };
      tampered.checkpoint.endSequence = String(Number(tampered.checkpoint.endSequence) + 1);
      await assert.rejects(rehydrateMakerV8ActivationChunkCertificateV8(publication, certificate.base, companion, tampered), (error) => error.code === 'MAKER_V8_ACTIVATION_PROGRESS_INVALID');
    } else activationPrior = activationCertificate;
  } while (!activationBuild.checkpoint.final);
  assert.deepEqual(phases, ['ACTIVATION_SEAL_SEAL', 'ACTIVATION_RUNTIME_APPEND', 'ACTIVATION_RUNTIME_SEAL', 'ACTIVATION_OUTPUT_APPEND', 'ACTIVATION_OUTPUT_SEAL', 'ACTIVATION_PHYSICAL_APPEND', 'ACTIVATION_PHYSICAL_SEAL', 'ACTIVATION_FINALIZE']);
  assert.equal(activationCertificate.lifecycle, 'ACTIVE');
  await assert.rejects(buildMakerV8ActivationChunkTransaction(publication, certificate.base, companion, clone(activationCertificate)), (error) => error.code === 'MAKER_V8_ACTIVATION_CHUNK_CERTIFICATE_REQUIRED');
});

test('Living transport binds real independent bundle bytes and all three version commitments', async () => {
  const document = clone(fixture.document);
  const context = await trustedContext(document);
  const publication = await compileMakerV8Publication(document, context);
  const living = await compileMakerV8LivingContentV8(document);
  assert.equal(publication.commitments.makerDocument, living.makerDocumentCommitment);
  assert.equal(publication.commitments.creatorDefaults, living.creatorDefaultsCommitment);
  assert.equal(publication.commitments.livingContentBinding, deriveMakerV8LivingContentBindingV8({ creatorDefaultsCommitment: living.creatorDefaultsCommitment, blobId: context.transport.livingContent.blobId, sha256: living.sha256, byteLength: living.byteLength, bundleCommitment: living.bundleCommitment }));
  assert.notEqual(publication.livingContent.sha256, publication.manifest.sha256);
  assert.deepEqual(publication.livingContent.bytes, living.bytes);
  const V = bcs.vector(bcs.u8());
  const Version = bcs.struct('IndependentVersionCommitmentInputV8', {
    domain: V, version: bcs.u64(), core_original_package_id: bcs.Address,
    protocol_config_id: bcs.Address, protocol_config_revision: bcs.u64(), protocol_config_commitment: V,
    maker_key: bcs.string(), maker_version: bcs.u64(), previous_root_id: bcs.option(bcs.Address), previous_version_commitment: bcs.option(V),
    maker_document_commitment: V, creator_defaults_commitment: V, living_content_binding_commitment: V,
    renderer_commitment: V, manifest_blob_id: bcs.string(), manifest_sha256: V, content_commitment: V,
    expected_base_definition_count: bcs.u64(), expected_base_registry_commitment: V, expected_pack_admission_policy_commitment: V,
    economics_commitment: V, rights_commitment: V,
  });
  const hash = key => [...Buffer.from(publication.commitments[key], 'hex')];
  const value = {
    domain: [...Buffer.from('animacraft-v8/maker-version')], version: 8,
    core_original_package_id: context.catalog.fields.roles.core.originalPackageId,
    protocol_config_id: context.protocolConfig.reference.objectId, protocol_config_revision: context.protocolConfig.fields.revision,
    protocol_config_commitment: [...Buffer.from(context.protocolConfig.fields.commitment, 'hex')],
    maker_key: document.lineage.makerKey, maker_version: 1, previous_root_id: null, previous_version_commitment: null,
    maker_document_commitment: hash('makerDocument'), creator_defaults_commitment: hash('creatorDefaults'), living_content_binding_commitment: hash('livingContentBinding'),
    renderer_commitment: hash('renderer'), manifest_blob_id: publication.manifest.blobId, manifest_sha256: [...Buffer.from(publication.manifest.sha256, 'hex')], content_commitment: hash('content'),
    expected_base_definition_count: Object.values(publication.counts).reduce((sum, count) => sum + count, 0n), expected_base_registry_commitment: hash('baseAuthorRows'), expected_pack_admission_policy_commitment: hash('packAdmissionPolicy'),
    economics_commitment: hash('economics'), rights_commitment: hash('rights'),
  };
  assert.equal(await hashBytes(Version.serialize(value).toBytes()), publication.commitments.version);
  for (const field of ['maker_document_commitment', 'creator_defaults_commitment', 'living_content_binding_commitment']) {
    assert.notEqual(await hashBytes(Version.serialize({ ...value, [field]: Array(32).fill(0xab) }).toBytes()), publication.commitments.version);
  }
  await assert.rejects(trustedContext(document, fixture.transportAssets, transport => { transport.livingContent.bytesBase64 = transport.manifest.bytesBase64; }), { code: 'MAKER_V8_ACTIVATION_AUTHORITY_INVALID' });
  const changed = clone(document); changed.livingContent.memoryMd += '\nOwner approved memory.';
  await assert.rejects(trustedContext(changed, fixture.transportAssets, transport => { transport.livingContent.bytesBase64 = context.transport.livingContent.bytesBase64; }), { code: 'MAKER_V8_ACTIVATION_AUTHORITY_INVALID' });
  // Content-addressed storage cannot give identical bytes an arbitrary new Blob ID.
  await assert.rejects(trustedContext(document, fixture.transportAssets, transport => { transport.livingContent.blobId = 'different-real-living-blob'; }));
});

test('Base author progress, storage seals and final Root slot are independently enforced', async () => {
  const publication = await compileMakerV8Publication(fixture.document, await trustedContext());
  assert.equal(Object.hasOwn(publication.commitments, 'base'), false, 'no object-bound storage commitments exist before scaffold IDs');
  const scaffold = await scaffoldReadback(publication);
  const build = await buildMakerV8BaseChunkTransaction(publication, scaffold);
  const wrongAuthor = await baseChunkRaw(publication, scaffold, build);
  assert.ok(build.transaction.getData().commands.some(command => command.MoveCall?.function === 'new_visibility_program_v1'));
  const rootInput = tx => tx.getData().inputs.find(input => input.Object?.SharedObject?.objectId === nid(fixture.ids.root)).Object.SharedObject;
  assert.equal(rootInput(build.transaction).mutable, false);
  const appended = await certifyMakerV8BaseChunkReadback(publication, scaffold, build, await baseChunkRaw(publication, scaffold, build));
  const sealBuild = await buildMakerV8BaseChunkTransaction(publication, scaffold, appended);
  assert.equal(sealBuild.checkpoint.phase, 'BASE_SEAL');
  assert.equal(rootInput(sealBuild.transaction).mutable, true);
  wrongAuthor.baseRegistry.fields.authorRowsRollingCommitment = ZERO;
  await assert.rejects(certifyMakerV8BaseChunkReadback(publication, scaffold, build, wrongAuthor), { code: 'MAKER_V8_BASE_AUTHOR_COMMITMENT_MISMATCH' });
  const prematureSeal = await baseChunkRaw(publication, scaffold, build);
  prematureSeal.baseRegistry.fields.sealedCommitments = clone(prematureSeal.baseRegistry.fields.rollingCommitments);
  await assert.rejects(certifyMakerV8BaseChunkReadback(publication, scaffold, build, prematureSeal), { code: 'MAKER_V8_BASE_COMMITMENT_MISMATCH' });
  const wrongRoot = baseReadbackRaw(publication, scaffold);
  wrongRoot.root.fields.sealedBaseRegistryCommitment = publication.commitments.baseAuthorRows;
  assert.throws(() => certifyMakerV8BaseReadback(publication, scaffold, wrongRoot), { code: 'MAKER_V8_BASE_ROOT_MISMATCH' });
  const missingRoot = baseReadbackRaw(publication, scaffold); missingRoot.root = null;
  assert.throws(() => certifyMakerV8BaseReadback(publication, scaffold, missingRoot));
  const sealed = certifyMakerV8BaseReadback(publication, scaffold, baseReadbackRaw(publication, scaffold));
  assert.notEqual(sealed.root.fields.sealedBaseRegistryCommitment, publication.commitments.baseAuthorRows);
  assert.notDeepEqual(sealed.baseRegistry.fields.rollingCommitments, sealed.baseRegistry.fields.sealedCommitments);
});

test('storage progress is bound to each exact scaffold, not overwritten by another scaffold for the same publication', async () => {
  const publication = await compileMakerV8Publication(fixture.document, await trustedContext());
  const first = await scaffoldReadback(publication);
  const firstBuild = await buildMakerV8BaseChunkTransaction(publication, first);
  const replacementIds = new Map([[nid(fixture.ids.root), nid('0x9991')], [nid(fixture.ids.baseRegistry), nid('0x9992')]]);
  const replace = value => Array.isArray(value) ? value.map(replace) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, replace(v)])) : typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) ? replacementIds.get(nid(value)) ?? value : value;
  const raw = { schemaVersion: MAKER_V8_SCAFFOLD_READBACK_SCHEMA, source: 'FINALIZED_RPC', transactionDigest: DIGEST,
    ...await transactionKindProof({ transaction: buildMakerV8ScaffoldTransaction(publication) }), ...replace(rootObjects(publication)) };
  const progress = await actualBaseProgress(publication, '0x9991', '0x9992');
  Object.assign(raw.baseRegistry.fields, { initialCommitments: clone(progress.storage.initialCommitments), rollingCommitments: clone(progress.storage.initialCommitments), authorRowsRollingCommitment: progress.author.initialCommitment });
  const second = await certifyMakerV8ScaffoldReadback(publication, raw);
  const secondBuild = await buildMakerV8BaseChunkTransaction(publication, second);
  assert.notDeepEqual(firstBuild.checkpoint.expected.initialCommitments, secondBuild.checkpoint.expected.initialCommitments);
  assert.deepEqual(firstBuild.checkpoint, (await buildMakerV8BaseChunkTransaction(publication, first)).checkpoint);
  assert.equal(firstBuild.checkpoint.expected.authorRowsRollingCommitment, secondBuild.checkpoint.expected.authorRowsRollingCommitment);
});

test('production compiler has no monolithic Base or Activation transaction escape hatch', async () => {
  const source = await readFile(new URL('../maker-v8-compiler.js', import.meta.url), 'utf8');
  assert.equal(source.includes('buildMakerV8BaseTransaction'), false);
  assert.equal(source.includes('buildMakerV8ActivationTransaction'), false);
  assert.equal(source.includes('localeCompare'), false);
});

test('compiler reuses canonical document validation and code-unit ordering for tricky Unicode payload keys', async () => {
  for (const mutate of [
    (document) => { document.canvas.width = -1; },
    (document) => { document.canvas.pixelMode = 'author-defined'; },
    (document) => { document.parts[0].items[0].styles[0].opacity = 2; },
  ]) {
    const document = clone(fixture.document); mutate(document);
    const context = await trustedContext();
    await assert.rejects(
      compileMakerV8Publication(document, context),
      (error) => error.name === 'MakerV8DocumentError',
    );
  }
  const left = clone(fixture.document); const right = clone(fixture.document);
  const entries = [['ä', 1], ['ä', 2], ['İ', 3], ['I', 4]];
  left.parts[0].items[0].styles[0].payload = Object.fromEntries(entries);
  right.parts[0].items[0].styles[0].payload = Object.fromEntries([...entries].reverse());
  const leftPublication = await compileMakerV8Publication(left, await trustedContext(left));
  const rightPublication = await compileMakerV8Publication(right, await trustedContext(right));
  assert.equal(leftPublication.commitments.content, rightPublication.commitments.content);
  assert.equal(leftPublication.commitments.baseAuthorRows, rightPublication.commitments.baseAuthorRows);
});
