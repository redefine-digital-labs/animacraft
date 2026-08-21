import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Transaction } from '@mysten/sui/transactions';

import {
  MAKER_V8_BASE_READBACK_SCHEMA,
  MAKER_V8_COMMITMENT_FIXTURE_SCHEMA,
  MAKER_V8_COMPANION_READBACK_SCHEMA,
  MAKER_V8_ROLE_ORDER,
  MAKER_V8_SCAFFOLD_READBACK_SCHEMA,
  MAKER_V8_TRUSTED_CONTEXT_SCHEMA,
  buildMakerV8ActivationTransaction,
  buildMakerV8BaseTransaction,
  buildMakerV8CompanionObjectsTransaction,
  buildMakerV8ScaffoldTransaction,
  canonicalMakerV8Json,
  certifyMakerV8BaseReadback,
  certifyMakerV8CompanionReadback,
  certifyMakerV8ScaffoldReadback,
  certifyMakerV8TrustedContext,
  compileMakerV8Publication,
  deriveMakerV8ReleaseCommitments,
  exactMakerV8TransactionTargets,
} from '../maker-v8-compiler.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/maker-v8-compiler-v1.json', import.meta.url), 'utf8'));
const ZERO = '00'.repeat(32);
const COIN = '0x2::sui::SUI';
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
  rows.sort((a, b) => a.assetId.localeCompare(b.assetId));
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

async function trustedContext(document = clone(fixture.document), assets = clone(fixture.transportAssets)) {
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
    chainIdentifier: 'fixture-chain-v8', signerAddress: fixture.ids.signer, paymentCoinType: COIN,
    clock: immutable('0x6', '0x2::clock::Clock', {}),
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
  const raw = { schemaVersion: MAKER_V8_SCAFFOLD_READBACK_SCHEMA, ...rootObjects(publication) };
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

function companionRaw(publication, base, expected) {
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
  return { schemaVersion: MAKER_V8_COMPANION_READBACK_SCHEMA, sealRegistry, runtimeDefinitions, packRegistry, admissionAuthority, outputRegistry, soulRegistry, physicalRegistry, marketRegistry, marketTreasury };
}

async function companionReadback(publication, base, expected) {
  const raw = companionRaw(publication, base, expected);
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
  const context = await trustedContext(document, assets); const publication = await compileMakerV8Publication(document, context); const scaffold = await scaffoldReadback(publication); const base = certifyMakerV8BaseReadback(publication, scaffold, baseReadbackRaw(publication, scaffold)); const companionBuild = await buildMakerV8CompanionObjectsTransaction(publication, base); const companion = await companionReadback(publication, base, companionBuild.expected); return { context, publication, scaffold, base, companionBuild, companion };
}

const moves = (transaction) => transaction.getData().commands.filter((command) => command.$kind === 'MoveCall').map((command) => command.MoveCall);
const suffixes = (transaction) => exactMakerV8TransactionTargets(transaction).map((target) => target.split('::').slice(-2).join('::'));
const argKinds = (move) => move.arguments.map((argument) => argument.$kind);
function argumentObjectId(transaction, argument) {
  const input = transaction.getData().inputs[argument.Input].Object;
  return input.SharedObject?.objectId ?? input.ImmOrOwnedObject?.objectId ?? input.Receiving?.objectId;
}

test('fresh fixture compiles canonical certified bytes and four executable seven-role PTBs', async () => {
  assert.equal(fixture.schemaVersion, MAKER_V8_COMMITMENT_FIXTURE_SCHEMA);
  const path = await compilePath();
  assert.deepEqual({ manifestSha256: path.publication.manifest.sha256, contentCommitment: path.publication.commitments.content, baseAggregateCommitment: path.publication.commitments.base.aggregate, runtimePolicyCommitment: path.publication.commitments.packAdmissionPolicy }, fixture.expected);
  assert.equal(path.publication.manifest.sha256, path.publication.commitments.content);
  assert.equal(path.publication.counts.styles, 1n);
  assert.equal(path.companionBuild.expected.physical.rows.length, 1);
  const scaffoldTx = buildMakerV8ScaffoldTransaction(path.publication); const baseTx = buildMakerV8BaseTransaction(path.publication, path.scaffold); const activationTx = await buildMakerV8ActivationTransaction(path.publication, path.base, path.companion);
  for (const tx of [scaffoldTx, baseTx, path.companionBuild.transaction, activationTx]) { assert.ok(tx instanceof Transaction); assert.ok((await tx.build({ onlyTransactionKind: true })).length > 0); }
  assert.deepEqual(suffixes(scaffoldTx), ['maker_v8::new_economics_snapshot_v8', 'maker_v8::new_onchain_native_rights_snapshot_v8', 'base_registry_v8::new_base_definition_counts_v8', 'base_registry_v8::new_base_definition_commitments_v8', 'core_v8::new_initial_maker_draft_v8', 'release_v8::finalize_product_release_binding_v8', 'core_v8::share_maker_draft_v8']);
  assert.deepEqual(moves(scaffoldTx).map((move) => move.typeArguments), [[ntype(COIN)], [], [], [], [ntype(COIN)], [ntype(COIN)], [ntype(COIN)]]);
  assert.deepEqual(suffixes(baseTx), ['base_registry_v8::append_track_v8', 'base_registry_v8::append_part_v8', 'base_registry_v8::append_item_v8', 'base_registry_v8::append_style_v8', 'base_registry_v8::seal_base_definition_registry_v8']);
  assert.ok(moves(baseTx).every((move) => JSON.stringify(move.typeArguments) === JSON.stringify([ntype(COIN)])));
  assert.deepEqual(suffixes(path.companionBuild.transaction), ['seal_v8::new_seal_registry_v8', 'seal_v8::share_seal_registry_v8', 'runtime_v8::new_runtime_registries_v8', 'runtime_v8::share_runtime_definition_registry_v8', 'runtime_v8::share_pack_registry_v8', 'runtime_v8::transfer_pack_admission_authority_v8', 'output_v8::new_output_registries_v8', 'output_v8::share_output_registries_v8', 'physical_v8::new_physical_registry_v8', 'physical_v8::share_physical_registry_v8', 'market_v8::new_market_objects_v8', 'market_v8::share_market_registry_v8', 'market_v8::share_market_treasury_v8']);
  assert.deepEqual(moves(path.companionBuild.transaction).map((move) => move.typeArguments.length), [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1]);
  assert.deepEqual(suffixes(activationTx), ['seal_v8::seal_registry_v8', 'runtime_v8::append_part_profile_v8', 'runtime_v8::seal_runtime_definitions_v8', 'output_v8::append_output_policy_v8', 'output_v8::seal_output_registry_v8', 'physical_v8::append_base_style_policy_v8', 'physical_v8::seal_physical_registry_v8', 'market_v8::seal_market_registry_v8', 'seal_v8::issue_seal_readiness_v8', 'seal_v8::certify_activation_readiness_v8', 'runtime_v8::runtime_activation_readiness_v8', 'runtime_binding_v8::certify_runtime_activation_readiness_v8', 'output_v8::certify_output_activation_readiness_v8', 'physical_v8::certify_physical_activation_readiness_v8', 'market_v8::certify_market_activation_readiness_v8', 'release_v8::seal_and_activate_maker_v8']);
  const allTargets = [scaffoldTx, baseTx, path.companionBuild.transaction, activationTx].flatMap(exactMakerV8TransactionTargets);
  assert.deepEqual(new Set(allTargets.map((target) => MAKER_V8_ROLE_ORDER.find((role) => target.startsWith(nid(fixture.packageRoles[role][1]))))), new Set(MAKER_V8_ROLE_ORDER));
  assert.equal(allTargets.some((target) => ['publication', 'composition', 'expansion_pack', 'complete'].some((name) => target.includes(`${name}_v8`)) || /animacraft_v[4-7]/.test(target) || target.includes(`${'physical'}_v7`)), false);
});

test('targets use callable packages, stable origins remain readback-only, and ABI order/type arguments are exact', async () => {
  const path = await compilePath(); const activation = await buildMakerV8ActivationTransaction(path.publication, path.base, path.companion); const commands = moves(activation);
  for (const move of commands) {
    const role = MAKER_V8_ROLE_ORDER.find((candidate) => nid(fixture.packageRoles[candidate][1]) === move.package);
    assert.ok(role, `unknown callable package ${move.package}`);
    assert.equal(move.package, path.context.catalog.fields.roles[role].callablePackageId);
    assert.deepEqual(move.typeArguments, [ntype(COIN)]);
  }
  const physical = commands.find((move) => move.function === 'append_base_style_policy_v8');
  assert.equal(physical.arguments.length, 17);
  assert.deepEqual(argKinds(physical), Array(17).fill('Input'));
  assert.deepEqual(physical.arguments.slice(0, 6).map((argument) => argumentObjectId(activation, argument)), [fixture.ids.physicalRegistry, fixture.ids.root, fixture.ids.adminCap, fixture.ids.baseRegistry, fixture.ids.catalog, fixture.ids.physicalConfig].map(nid));
  const final = commands.at(-1);
  assert.equal(final.function, 'seal_and_activate_maker_v8');
  assert.equal(final.arguments.length, 13);
  assert.deepEqual(argKinds(final), ['Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Input', 'Result', 'Result', 'Result', 'Result', 'Result']);
  assert.deepEqual(final.arguments.slice(0, 8).map((argument) => argumentObjectId(activation, argument)), [fixture.ids.root, fixture.ids.adminCap, fixture.ids.protocolConfig, fixture.ids.catalog, fixture.ids.baseRegistry, fixture.ids.makerTreasury, fixture.ids.protocolTreasury, fixture.ids.releaseConfig].map(nid));
  assert.equal(path.companion.physicalRegistry.type.startsWith(path.context.catalog.fields.roles.physical.originalPackageId), true);
  assert.notEqual(path.context.catalog.fields.roles.physical.originalPackageId, path.context.catalog.fields.roles.physical.callablePackageId);
});

test('license-wrapped protected Base uses only Release certification wrappers and exact consumed result order', async () => {
  const document = clone(fixture.document); const assets = clone(fixture.transportAssets);
  document.parts[0].items[0].styles[0].protected = true;
  document.commerce.rightsOrigin = 'LICENSE_WRAPPED'; document.commerce.rightsEvidence = { licensor: 'Fixture Licensor', evidenceAssetId: 'rights-proof' };
  document.assets.push({ id: 'rights-proof', kind: 'rights-evidence', mediaType: 'application/pdf', byteLength: '5' });
  assets.push({ assetId: 'rights-proof', blobId: 'walrus-rights-proof-v8', mediaType: 'application/pdf', bytesBase64: 'JVBERi0=' });
  const path = await compilePath(document, assets); const scaffoldTx = buildMakerV8ScaffoldTransaction(path.publication); const activationTx = await buildMakerV8ActivationTransaction(path.publication, path.base, path.companion);
  assert.ok(suffixes(scaffoldTx).includes('release_v8::new_license_wrapped_rights_snapshot_v8'));
  assert.equal(suffixes(scaffoldTx).includes('maker_v8::new_onchain_native_rights_snapshot_v8'), false);
  assert.deepEqual(suffixes(activationTx).slice(0, 3), ['release_v8::certify_base_ciphertext_v8', 'seal_v8::append_protected_asset_v8', 'seal_v8::seal_registry_v8']);
  const [certify, append] = moves(activationTx);
  assert.equal(certify.arguments.length, 12);
  assert.deepEqual(argKinds(certify), Array(12).fill('Input'));
  assert.deepEqual(argKinds(append), ['Input', 'Input', 'Input', 'Input', 'Input', 'Result']);
  assert.deepEqual(certify.arguments.slice(0, 5).map((argument) => argumentObjectId(activationTx, argument)), [fixture.ids.protocolConfig, fixture.ids.catalog, fixture.ids.releaseConfig, fixture.ids.sealConfig, fixture.ids.root].map(nid));
  assert.deepEqual(append.arguments.slice(0, 4).map((argument) => argumentObjectId(activationTx, argument)), [fixture.ids.sealRegistry, fixture.ids.root, fixture.ids.adminCap, fixture.ids.sealConfig].map(nid));
  assert.equal(certify.package, path.context.catalog.fields.roles.release.callablePackageId);
  assert.equal(append.package, path.context.catalog.fields.roles.seal.callablePackageId);
  const forged = clone(document); forged.parts[0].items[0].styles[0].payload.ciphertextSha256 = 'ff'.repeat(32);
  await assert.rejects(compileMakerV8Publication(forged, path.context), (error) => error.code === 'MAKER_V8_AUTHOR_AUTHORITY_FORBIDDEN');
});

test('caller-authored authority and unverified lookalikes cannot reach a transaction', async () => {
  const document = clone(fixture.document); document.rootId = fixture.ids.root;
  const context = await trustedContext();
  const disabled = clone(context); delete disabled._derived; disabled.protocolConfig.fields.enabled = false;
  await assert.rejects(certifyMakerV8TrustedContext(disabled), (error) => error.code === 'MAKER_V8_PROTOCOL_DISABLED');
  const inventedCommitment = clone(context); delete inventedCommitment._derived; inventedCommitment.protocolConfig.fields.commitment = 'ff'.repeat(32); inventedCommitment.catalog.fields.protocolConfigCommitment = 'ff'.repeat(32);
  await assert.rejects(certifyMakerV8TrustedContext(inventedCommitment), (error) => error.code === 'MAKER_V8_PROTOCOL_COMMITMENT_MISMATCH');
  await assert.rejects(compileMakerV8Publication(document, context), (error) => error.code === 'MAKER_V8_FIELDS_INVALID' || error.code === 'MAKER_V8_AUTHOR_AUTHORITY_FORBIDDEN');
  await assert.rejects(compileMakerV8Publication(fixture.document, clone(context)), (error) => error.code === 'MAKER_V8_TRUSTED_CONTEXT_REQUIRED');
  const publication = await compileMakerV8Publication(fixture.document, context);
  assert.throws(() => buildMakerV8BaseTransaction(publication, rootObjects(publication)), (error) => error.code === 'MAKER_V8_SCAFFOLD_CONTEXT_REQUIRED');
  const scaffold = await scaffoldReadback(publication); const base = certifyMakerV8BaseReadback(publication, scaffold, baseReadbackRaw(publication, scaffold)); const built = await buildMakerV8CompanionObjectsTransaction(publication, base); const lookalike = companionRaw(publication, base, built.expected);
  await assert.rejects(buildMakerV8ActivationTransaction(publication, base, lookalike), (error) => error.code === 'MAKER_V8_COMPANION_CONTEXT_REQUIRED');
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
  const path = await compilePath(); const wrongType = companionRaw(path.publication, path.base, path.companionBuild.expected); wrongType.physicalRegistry.type = wrongType.physicalRegistry.type.replace(path.context.catalog.fields.roles.physical.originalPackageId, path.context.catalog.fields.roles.physical.callablePackageId);
  await assert.rejects(certifyMakerV8CompanionReadback(path.publication, path.base, wrongType), (error) => error.code === 'MAKER_V8_TYPE_ORIGIN_MISMATCH');
  const zero = clone(path.companion); delete zero.expected; zero.marketRegistry.fields.zeroStateCommitment = 'ff'.repeat(32);
  await assert.rejects(certifyMakerV8CompanionReadback(path.publication, path.base, zero), (error) => error.code === 'MAKER_V8_MARKET_ZERO_COMMITMENT_MISMATCH');
});

test('known ABI gaps are reported precisely instead of downgraded to call plans', async () => {
  const context = await trustedContext();
  const itemAssetized = clone(fixture.document); itemAssetized.composition.itemAssetization = true;
  await assert.rejects(compileMakerV8Publication(itemAssetized, context), (error) => error.code === 'MAKER_V8_ABI_ITEM_ASSETIZATION_UNSUPPORTED');
  const capacity = clone(fixture.document); capacity.parts[0].capacity = 2;
  await assert.rejects(compileMakerV8Publication(capacity, context), (error) => error.code === 'MAKER_V8_ABI_CAPACITY_UNSUPPORTED');
  const economics = clone(fixture.document); economics.commerce.makerAccess.purchasePriceAtomic = '1'; const economicsContext = await trustedContext(economics);
  await assert.rejects(compileMakerV8Publication(economics, economicsContext), (error) => error.code === 'MAKER_V8_ECONOMICS_ABI_INVALID');
  const output = clone(fixture.document); output.outputs[0].allowedPackPolicy = { kind: 'ALLOWLIST', packIds: ['z-pack', 'a-pack'] }; const outputContext = await trustedContext(output);
  await assert.rejects(compileMakerV8Publication(output, outputContext), (error) => error.code === 'MAKER_V8_OUTPUT_PACK_POLICY_INVALID');
  const physical = clone(fixture.document); physical.parts[0].items[0].styles[0].physical.proof = 'CANONICAL_SOUL';
  await assert.rejects(compilePath(physical), (error) => error.code === 'MAKER_V8_PHYSICAL_POLICY_ABI_INVALID');
  assert.equal(Object.keys(await import('../maker-v8-compiler.js')).some((name) => /plan.*call/i.test(name)), false);
});
