import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Transaction } from '@mysten/sui/transactions';
import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';
import { MAKER_V8_PAYMENT_COIN_TYPE } from '../maker-v8-runtime.js';
import {
  MAKER_V8_DOCUMENT_LIMITS,
  assertMakerV8Document,
  compareMakerV8ProtocolText,
} from '../maker-v8-document.js';

import {
  MAKER_V8_BASE_READBACK_SCHEMA,
  MAKER_V8_BASE_CHUNK_READBACK_SCHEMA,
  MAKER_V8_ACTIVATION_CHUNK_READBACK_SCHEMA,
  MAKER_V8_ACTIVATION_READBACK_SCHEMA,
  MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE,
  MAKER_V8_COMMITMENT_FIXTURE_SCHEMA,
  MAKER_V8_COMPANION_READBACK_SCHEMA,
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
  certifyMakerV8TrustedContext,
  compileMakerV8Publication,
  deriveMakerV8ReleaseCommitments,
  exactMakerV8TransactionTargets,
  rehydrateMakerV8ActivationChunkCertificateV8,
  rehydrateMakerV8BaseChunkCertificateV8,
} from '../maker-v8-compiler.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/maker-v8-compiler-v1.json', import.meta.url), 'utf8'));
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
const hashBytes = async (bytes) => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
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
  return { manifest: { blobId: 'walrus-manifest-small-v8', bytesBase64: Buffer.from(manifest).toString('base64') }, assets: clone(assets) };
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
  const configFields = (role) => ({ version: 8, catalogId: fixture.ids.catalog, productBindingCommitment: release.productBindingCommitment, callCapSetCommitment: release.callCapSetCommitment, authorityId: release.authorities[role] });
  const context = {
    schemaVersion: MAKER_V8_TRUSTED_CONTEXT_SCHEMA,
    chainIdentifier: MAKER_V8_MAINNET_CHAIN_IDENTIFIER, signerAddress: fixture.ids.signer, paymentCoinType: COIN,
    protocolProfile: clone(MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE),
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
    transport: await certifiedTransport(document, assets),
  };
  if (mutateTransport) mutateTransport(context.transport);
  await assert.rejects(certifyMakerV8TrustedContext(context), (error) => {
    assert.equal(error.code, 'MAKER_V8_PROTOCOL_COMMITMENT_MISMATCH');
    context.protocolConfig.fields.commitment = error.details.expected;
    context.catalog.fields.protocolConfigCommitment = error.details.expected;
    return true;
  });
  await assert.rejects(certifyMakerV8TrustedContext(context), (error) => {
    assert.equal(error.code, 'MAKER_V8_SEAL_POLICY_COMMITMENT_MISMATCH');
    context.configs.seal.fields.commitment = error.details.expected;
    return true;
  });
  mutateContext?.(context);
  return certifyMakerV8TrustedContext(context);
}

function rootObjects(publication) {
  const c = publication.context; const core = c.catalog.fields.roles.core.originalPackageId; const total = Object.values(publication.counts).reduce((sum, value) => sum + value, 0n);
  const root = shared(fixture.ids.root, `${core}::maker_v8::MakerRootV8<${COIN}>`, {
    version: 8, creator: c.signerAddress, owner: c.signerAddress, adminCapId: fixture.ids.adminCap, controlEpoch: '0', lifecycle: 0,
    makerKey: publication.document.lineage.makerKey, makerVersion: 1, versionCommitment: publication.commitments.version, rendererCommitment: publication.commitments.renderer,
    manifestBlobId: publication.manifest.blobId, manifestSha256: publication.manifest.sha256, contentCommitment: publication.commitments.content,
    protocolConfigId: fixture.ids.protocolConfig, protocolConfigRevision: '3', protocolConfigCommitment: c.protocolConfig.fields.commitment,
    baseRegistryId: fixture.ids.baseRegistry, makerTreasuryId: fixture.ids.makerTreasury, expectedBaseDefinitionCount: String(total), expectedBaseRegistryCommitment: publication.commitments.base.aggregate,
    expectedPackAdmissionPolicyCommitment: publication.commitments.packAdmissionPolicy, economicsCommitment: publication.commitments.economics, rightsCommitment: publication.commitments.rights,
    catalogId: fixture.ids.catalog, productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment,
  });
  const baseRegistry = shared(fixture.ids.baseRegistry, `${core}::base_registry_v8::BaseDefinitionRegistryV8`, {
    version: 8, rootId: nid(fixture.ids.root), makerVersion: 1, rootContentCommitment: publication.commitments.content,
    expectedCounts: Object.fromEntries(Object.entries(publication.counts).map(([key, value]) => [key, String(value)])),
    observedCounts: Object.fromEntries(Object.keys(publication.counts).map((key) => [key, '0'])),
    expectedCommitments: clone(publication.commitments.base), rollingCommitments: Object.fromEntries(Object.keys(publication.commitments.base).map((key) => [key, ZERO])),
    nextSequence: '0', expectedSequenceCount: String(total), protectedStyleCount: '0', sealed: false,
  });
  return {
    root, baseRegistry,
    makerTreasury: shared(fixture.ids.makerTreasury, `${core}::treasury_v8::MakerTreasuryV8<${COIN}>`, { version: 8, rootId: nid(fixture.ids.root), makerVersion: 1, rootContentCommitment: publication.commitments.content }),
    adminCap: owned(fixture.ids.adminCap, `${core}::maker_v8::MakerAdminCapV8`, { version: 8, rootId: nid(fixture.ids.root), owner: c.signerAddress, controlEpoch: '0' }),
  };
}

async function scaffoldReadback(publication) {
  const raw = {
    schemaVersion: MAKER_V8_SCAFFOLD_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    transactionDigest: DIGEST,
    ...await transactionKindProof({ transaction: buildMakerV8ScaffoldTransaction(publication) }),
    ...rootObjects(publication),
  };
  for (const key of ['tracks', 'parts', 'items', 'styles', 'colors', 'rules', 'aggregate']) {
    await assert.rejects(certifyMakerV8ScaffoldReadback(publication, raw), (error) => {
      assert.equal(error.code, 'MAKER_V8_BASE_ROLLING_MISMATCH');
      raw.baseRegistry.fields.rollingCommitments[key] = error.details.expected;
      return true;
    });
  }
  return certifyMakerV8ScaffoldReadback(publication, raw);
}

function baseReadbackRaw(publication, scaffold) {
  const total = Object.values(publication.counts).reduce((sum, value) => sum + value, 0n);
  return {
    schemaVersion: MAKER_V8_BASE_READBACK_SCHEMA,
    baseRegistry: shared(fixture.ids.baseRegistry, scaffold.baseRegistry.type, {
      version: 8, rootId: nid(fixture.ids.root), makerVersion: 1, rootContentCommitment: publication.commitments.content,
      observedCounts: Object.fromEntries(Object.entries(publication.counts).map(([key, value]) => [key, String(value)])), rollingCommitments: clone(publication.commitments.base),
      nextSequence: String(total), protectedStyleCount: String(publication.rows.style.filter((row) => row.protected).length), sealed: true,
    }),
  };
}

async function companionRaw(publication, base, expected, transaction = null) {
  const c = publication.context; const type = (role, module, struct, generic = '') => `${c.catalog.fields.roles[role].originalPackageId}::${module}::${struct}${generic}`; const rootId = nid(fixture.ids.root); const content = publication.commitments.content;
  const sealRegistry = shared(fixture.ids.sealRegistry, type('seal', 'seal_v8', 'SealRegistryV8'), {
    version: 8, rootId, makerVersion: 1, rootContentCommitment: content, catalogId: nid(fixture.ids.catalog), productBindingCommitment: c._derived.productBindingCommitment,
    policyConfigId: nid(fixture.ids.sealConfig), policyCommitment: c._derived.sealPolicyCommitment, expectedBaseCount: String(expected.seal.rows.length), expectedPackCount: '0', expectedCompleteCount: '0', expectedCount: String(expected.seal.rows.length), observedBaseCount: '0', observedPackCount: '0', observedCompleteCount: '0', observedCount: '0', expectedCommitment: expected.seal.commitment, rollingCommitment: ZERO, sealed: false, runtimeRevision: '0', runtimeCommitment: ZERO,
  });
  const runtimeDefinitions = shared(fixture.ids.runtimeDefinitions, type('runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'), { version: 8, rootId, rootVersion: '1', rootContentCommitment: content, baseRegistryId: nid(fixture.ids.baseRegistry), expectedProfileCount: String(publication.runtime.profiles.length), observedProfileCount: '0', expectedProfileCommitment: publication.runtime.profileCommitment, rollingProfileCommitment: ZERO, admissionCeiling: publication.runtime.admission, sealed: false });
  const admissionAuthority = owned(fixture.ids.admissionAuthority, type('runtime', 'runtime_v8', 'PackAdmissionAuthorityV8'), { version: 8, rootId, rootVersion: '1', rootContentCommitment: content });
  const packRegistry = shared(fixture.ids.packRegistry, type('runtime', 'runtime_v8', 'PackRegistryV8'), { version: 8, rootId, rootVersion: '1', rootContentCommitment: content, definitionRegistryId: nid(fixture.ids.runtimeDefinitions), admissionAuthorityId: nid(fixture.ids.admissionAuthority), admissionPolicyCommitment: publication.commitments.packAdmissionPolicy, revision: '0', releaseCount: '0', externalAdmissionCount: '0' });
  const soulRegistry = shared(fixture.ids.soulRegistry, type('output', 'output_v8', 'SoulRegistryV8'), { version: 8, rootId, makerVersion: 1, rootContentCommitment: content, outputRegistryId: nid(fixture.ids.outputRegistry), soulCount: '0' });
  const outputRegistry = shared(fixture.ids.outputRegistry, type('output', 'output_v8', 'OutputRegistryV8'), { version: 8, rootId, makerVersion: 1, rootContentCommitment: content, rendererCommitment: publication.commitments.renderer, soulRegistryId: nid(fixture.ids.soulRegistry), expectedOutputCount: String(expected.output.rows.length), observedOutputCount: '0', expectedPolicyCommitment: expected.output.commitment, rollingPolicyCommitment: ZERO, sealed: false });
  const physicalRegistry = shared(fixture.ids.physicalRegistry, type('physical', 'physical_v8', 'PhysicalRegistryV8'), { version: 8, catalogId: nid(fixture.ids.catalog), packageConfigId: nid(fixture.ids.physicalConfig), productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment, rootId, makerVersion: 1, rootContentCommitment: content, baseRegistryId: nid(fixture.ids.baseRegistry), expectedBasePolicyCount: String(expected.physical.rows.length), observedBasePolicyCount: '0', expectedBasePolicyCommitment: expected.physical.commitment, rollingBasePolicyCommitment: ZERO, baseSealed: false, revision: '0', packPolicyCount: '0' });
  const marketTreasury = shared(fixture.ids.marketTreasury, type('market', 'market_v8', 'MarketTreasuryV8', `<${COIN}>`), { version: 8, catalogId: nid(fixture.ids.catalog), packageConfigId: nid(fixture.ids.marketConfig), rootId, makerVersion: 1, rootContentCommitment: content, balanceAtomic: '0', grossEscrowedAtomic: '0', grossReleasedAtomic: '0' });
  const marketRegistry = shared(fixture.ids.marketRegistry, type('market', 'market_v8', 'MarketRegistryV8', `<${COIN}>`), { version: 8, catalogId: nid(fixture.ids.catalog), packageConfigId: nid(fixture.ids.marketConfig), productBindingCommitment: c._derived.productBindingCommitment, callCapSetCommitment: c._derived.callCapSetCommitment, rootId, makerVersion: 1, rootContentCommitment: content, protocolConfigId: nid(fixture.ids.protocolConfig), protocolConfigRevision: '3', protocolConfigCommitment: c.protocolConfig.fields.commitment, economicsCommitment: publication.commitments.economics, rightsCommitment: publication.commitments.rights, makerMarketFeeBps: 80, soulMarketFeeBps: 90, soulCreatorRoyaltyBps: publication.document.commerce.soulCreatorRoyaltyBps, makerSourceRoyaltyBps: publication.document.commerce.makerSourceRoyaltyBps, makerResaleRoyaltyBps: publication.document.commerce.makerResaleRoyaltyBps, treasuryId: nid(fixture.ids.marketTreasury), sealed: false, revision: '0', listingCount: '0', escrowCount: '0', completedSaleCount: '0', canceledSaleCount: '0', recoveredSaleCount: '0', grossVolumeAtomic: '0', protocolPaidAtomic: '0', creatorPaidAtomic: '0', sourcePaidAtomic: '0', sellerPaidAtomic: '0', zeroStateCommitment: ZERO });
  const companionTransaction = transaction ?? (await buildMakerV8CompanionObjectsTransaction(publication, base)).transaction;
  return { schemaVersion: MAKER_V8_COMPANION_READBACK_SCHEMA, source: 'FINALIZED_RPC', transactionDigest: DIGEST, ...await transactionKindProof({ transaction: companionTransaction }), sealRegistry, runtimeDefinitions, packRegistry, admissionAuthority, outputRegistry, soulRegistry, physicalRegistry, marketRegistry, marketTreasury };
}

async function companionReadback(publication, base, expected, transaction = null) {
  const raw = await companionRaw(publication, base, expected, transaction);
  for (const [code, object, field] of [
    ['MAKER_V8_SEAL_READBACK_MISMATCH', raw.sealRegistry, 'rollingCommitment'],
    ['MAKER_V8_SEAL_READBACK_MISMATCH', raw.sealRegistry, 'runtimeCommitment'],
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

test('trusted context pins the exact measured Sui protocol profile and commitment', async () => {
  const approved = await trustedContext();
  assert.deepEqual(approved.protocolProfile, MAKER_V8_APPROVED_SUI_PROTOCOL_PROFILE);
  assert.match(approved._derived.protocolProfileCommitment, /^[0-9a-f]{64}$/);

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
function argumentObjectId(transaction, argument) {
  const input = transaction.getData().inputs[argument.Input].Object;
  return input.SharedObject?.objectId ?? input.ImmOrOwnedObject?.objectId ?? input.Receiving?.objectId;
}

async function transactionKindProof(build) {
  const bytes = await build.transaction.build({ onlyTransactionKind: true });
  return { transactionKindBytesBase64: Buffer.from(bytes).toString('base64'), transactionKindSha256: await hashBytes(bytes) };
}

async function baseChunkRaw(publication, scaffold, build, digest = DIGEST) {
  const expected = build.checkpoint.expected;
  return {
    schemaVersion: MAKER_V8_BASE_CHUNK_READBACK_SCHEMA,
    source: 'FINALIZED_RPC',
    transactionDigest: digest,
    ...await transactionKindProof(build),
    baseRegistry: shared(fixture.ids.baseRegistry, scaffold.baseRegistry.type, {
      version: 8,
      rootId: nid(fixture.ids.root),
      makerVersion: 1,
      rootContentCommitment: publication.commitments.content,
      observedCounts: clone(expected.observedCounts),
      rollingCommitments: clone(expected.rollingCommitments),
      nextSequence: expected.nextSequence,
      protectedStyleCount: expected.protectedStyleCount,
      sealed: expected.sealed,
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
  if (lane === 'SEAL') { object.fields.observedBaseCount = expected.observedCount; object.fields.observedCount = expected.observedCount; object.fields.rollingCommitment = expected.rollingCommitment; object.fields.sealed = expected.sealed; }
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

test('fresh fixture compiles canonical certified bytes into executable bounded seven-role checkpoints', async () => {
  assert.equal(fixture.schemaVersion, MAKER_V8_COMMITMENT_FIXTURE_SCHEMA);
  const path = await compilePath();
  assert.deepEqual({ manifestSha256: path.publication.manifest.sha256, contentCommitment: path.publication.commitments.content, baseAggregateCommitment: path.publication.commitments.base.aggregate, runtimePolicyCommitment: path.publication.commitments.packAdmissionPolicy }, fixture.expected);
  assert.equal(path.publication.manifest.sha256, path.publication.commitments.content);
  assert.equal(path.publication.counts.styles, 1n);
  assert.equal(path.companionBuild.expected.physical.rows.length, 1);
  const scaffoldTx = buildMakerV8ScaffoldTransaction(path.publication);
  const baseBuild = await buildMakerV8BaseChunkTransaction(path.publication, path.scaffold);
  const activationBuild = await buildMakerV8ActivationChunkTransaction(path.publication, path.base, path.companion);
  for (const tx of [scaffoldTx, baseBuild.transaction, path.companionBuild.transaction, activationBuild.transaction]) { assert.ok(tx instanceof Transaction); assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0); }
  assert.deepEqual(suffixes(scaffoldTx), ['maker_v8::new_economics_snapshot_v8', 'maker_v8::new_onchain_native_rights_snapshot_v8', 'base_registry_v8::new_base_definition_counts_v8', 'base_registry_v8::new_base_definition_commitments_v8', 'core_v8::new_initial_maker_draft_v8', 'release_v8::finalize_product_release_binding_v8', 'core_v8::share_maker_draft_v8']);
  assert.deepEqual(moves(scaffoldTx).map((move) => move.typeArguments), [[ntype(COIN)], [], [], [], [ntype(COIN)], [ntype(COIN)], [ntype(COIN)]]);
  assert.deepEqual(suffixes(baseBuild.transaction), ['base_registry_v8::append_track_v8', 'base_registry_v8::append_part_v8', 'base_registry_v8::append_item_v8', 'base_registry_v8::append_style_v8']);
  assert.ok(moves(baseBuild.transaction).every((move) => JSON.stringify(move.typeArguments) === JSON.stringify([ntype(COIN)])));
  assert.deepEqual(suffixes(path.companionBuild.transaction), ['seal_v8::new_seal_registry_v8', 'seal_v8::share_seal_registry_v8', 'runtime_v8::new_runtime_registries_v8', 'runtime_v8::share_runtime_definition_registry_v8', 'runtime_v8::share_pack_registry_v8', 'runtime_v8::transfer_pack_admission_authority_v8', 'output_v8::new_output_registries_v8', 'output_v8::share_output_registries_v8', 'physical_v8::new_physical_registry_v8', 'physical_v8::share_physical_registry_v8', 'market_v8::new_market_objects_v8', 'market_v8::share_market_registry_v8', 'market_v8::share_market_treasury_v8']);
  assert.deepEqual(moves(path.companionBuild.transaction).map((move) => move.typeArguments.length), [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1]);
  assert.deepEqual(suffixes(activationBuild.transaction), ['seal_v8::seal_registry_v8']);
  const allTargets = [scaffoldTx, baseBuild.transaction, path.companionBuild.transaction, activationBuild.transaction].flatMap(exactMakerV8TransactionTargets);
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
    assert.match(fn, /^[a-z][a-z0-9_]*_v8$/);
  }
});

test('targets use callable packages, stable origins remain readback-only, and ABI order/type arguments are exact', async () => {
  const path = await compilePath(); const activationBuilds = await allActivationBuilds(path);
  const commands = activationBuilds.flatMap((build) => moves(build.transaction));
  for (const move of commands) {
    const role = MAKER_V8_ROLE_ORDER.find((candidate) => nid(fixture.packageRoles[candidate][1]) === move.package);
    assert.ok(role, `unknown callable package ${move.package}`);
    assert.equal(move.package, path.context.catalog.fields.roles[role].callablePackageId);
    assert.deepEqual(move.typeArguments, [ntype(COIN)]);
  }
  const physical = commands.find((move) => move.function === 'append_base_style_policy_v8');
  assert.equal(physical.arguments.length, 17);
  assert.deepEqual(argKinds(physical), Array(17).fill('Input'));
  const physicalTransaction = activationBuilds.find((build) => moves(build.transaction).some((move) => move.function === 'append_base_style_policy_v8')).transaction;
  assert.deepEqual(physical.arguments.slice(0, 6).map((argument) => argumentObjectId(physicalTransaction, argument)), [fixture.ids.physicalRegistry, fixture.ids.root, fixture.ids.adminCap, fixture.ids.baseRegistry, fixture.ids.catalog, fixture.ids.physicalConfig].map(nid));
  const final = commands.at(-1);
  assert.equal(final.function, 'seal_and_activate_maker_v8');
  assert.equal(final.arguments.length, 13);
  assert.deepEqual(argKinds(final), ['Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Result', 'Result', 'Result', 'Result', 'Result']);
  const finalTransaction = activationBuilds.at(-1).transaction;
  assert.deepEqual(final.arguments.slice(0, 8).map((argument) => argumentObjectId(finalTransaction, argument)), [fixture.ids.root, fixture.ids.adminCap, fixture.ids.protocolConfig, fixture.ids.catalog, fixture.ids.baseRegistry, fixture.ids.makerTreasury, fixture.ids.protocolTreasury, fixture.ids.releaseConfig].map(nid));
  assert.equal(path.companion.physicalRegistry.type.startsWith(path.context.catalog.fields.roles.physical.originalPackageId), true);
  assert.notEqual(path.context.catalog.fields.roles.physical.originalPackageId, path.context.catalog.fields.roles.physical.callablePackageId);
});

test('license-wrapped protected Base uses only Release certification wrappers and exact consumed result order', async () => {
  const document = clone(fixture.document); const assets = clone(fixture.transportAssets);
  document.parts[0].items[0].styles[0].protected = true;
  document.commerce.rightsOrigin = 'LICENSE_WRAPPED'; document.commerce.rightsEvidence = { licensor: 'Fixture Licensor', evidenceAssetId: 'rights-proof' };
  document.assets.push({ id: 'rights-proof', kind: 'rights-evidence', mediaType: 'application/pdf', byteLength: '5' });
  assets.push({ assetId: 'rights-proof', blobId: 'walrus-rights-proof-v8', mediaType: 'application/pdf', bytesBase64: 'JVBERi0=' });
  const path = await compilePath(document, assets); const scaffoldTx = buildMakerV8ScaffoldTransaction(path.publication);
  const activationBuild = await buildMakerV8ActivationChunkTransaction(path.publication, path.base, path.companion);
  const activationTx = activationBuild.transaction;
  assert.ok(suffixes(scaffoldTx).includes('release_v8::new_license_wrapped_rights_snapshot_v8'));
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

test('known ABI gaps are reported precisely instead of downgraded to call plans', async () => {
  const context = await trustedContext();
  const itemAssetized = clone(fixture.document); itemAssetized.composition.itemAssetization = true;
  await assert.rejects(compileMakerV8Publication(itemAssetized, context), (error) => error.code === 'MAKER_V8_ABI_ITEM_ASSETIZATION_UNSUPPORTED');
  const capacity = clone(fixture.document); capacity.parts[0].capacity = 2;
  await assert.rejects(compileMakerV8Publication(capacity, context), (error) => error.code === 'MAKER_V8_ABI_CAPACITY_UNSUPPORTED');
  const economics = clone(fixture.document); economics.commerce.makerAccess.purchasePriceAtomic = '1'; const economicsContext = await trustedContext(economics);
  await assert.rejects(compileMakerV8Publication(economics, economicsContext), (error) => ['MAKER_V8_ECONOMICS_ABI_INVALID', 'MAKER_V8_ACCESS_PRICE_INVALID'].includes(error.code));
  const output = clone(fixture.document); output.outputs[0].allowedPackPolicy = { kind: 'ALLOWLIST', packIds: ['z-pack', 'a-pack'] }; const outputContext = await trustedContext(output);
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

test('measured style seal budget accepts exact boundaries and rejects 334 unique pairs or 501 styles', async () => {
  assert.equal(MAKER_V8_DOCUMENT_LIMITS.styles, 500);
  assert.equal(MAKER_V8_DOCUMENT_LIMITS.styleSealObjectRuntimeUnits, 1000);
  const fiveHundred = styleLimitDocument(500, 0);
  const unique333 = styleLimitDocument(333, 333);
  assert.doesNotThrow(() => assertMakerV8Document(fiveHundred, { mode: 'compile' }));
  assert.doesNotThrow(() => assertMakerV8Document(unique333, { mode: 'compile' }));
  assert.throws(
    () => assertMakerV8Document(styleLimitDocument(334, 334), { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_STYLE_SEAL_LIMIT'),
  );
  assert.throws(
    () => assertMakerV8Document(styleLimitDocument(501, 0), { mode: 'compile' }),
    (error) => error.issues.some((entry) => entry.code === 'MAKER_V8_STYLE_SEAL_LIMIT'),
  );

  const context = await trustedContext(fiveHundred);
  const publication = await compileMakerV8Publication(fiveHundred, context);
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

test('bounded chunks require exact prior finalized certificates and certify ACTIVE readback', async () => {
  const document = clone(fixture.document);
  document.rules = Array.from({ length: 1000 }, (_, index) => ({
    key: `r${String(index).padStart(4, '0')}`,
    kind: index % 2 ? 'REQUIRE' : 'EXCLUDE',
    left: { partKey: 'body', itemKey: 'body' },
    right: { partKey: 'body', itemKey: 'body' },
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
    const context = await trustedContext(document);
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
  assert.equal(leftPublication.commitments.base.aggregate, rightPublication.commitments.base.aggregate);
});
