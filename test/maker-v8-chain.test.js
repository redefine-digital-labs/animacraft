import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_CLOCK_OBJECT_ID,
  MAKER_V8_PAYMENT_COIN_TYPE,
  MAKER_V8_RUNTIME_SCHEMA,
} from '../maker-v8-runtime.js';
import {
  MakerV8ChainError,
  MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256,
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
  createMakerV8ChainClient,
  discoverMakerV8Activations,
  listOwnedMakerV8Inventory,
  loadReceivingRefV8,
  loadMakerV8OperationalState,
  makerV8ChainTypes,
  parseMakerRootV8,
  parseMakerTreasuryV8,
  parseMakerV8ActivatedEvent,
  parsePhysicalAssetV8,
  parseProtocolConfigV8,
  parseSoulBundleV8,
  readFinalizedMakerV8Transaction,
  isMakerV8RuntimeAttested,
  makerV8AttestedCoreArtifact,
  makerV8AttestedPackageTuple,
} from '../maker-v8-chain.js';
import { CORE_BASE_REGISTRY_MODULE_BASE64 } from './fixtures/maker-v8-runtime-attestation.js';

const sid = (number) => `0x${number.toString(16).padStart(64, '0')}`;
const txDigest = (character = '4') => character.repeat(44);
const objectDigest = (character = '5') => character.repeat(44);
const hash = (byte) => Array(32).fill(byte);
const wallet = sid(900);
const mainnetRpc = (methods = {}) => ({
  async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
  ...methods,
});

function runtime() {
  const roles = {};
  ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .forEach((role, index) => {
      roles[role] = {
        typeOriginPackageId: sid(index * 2 + 1),
        callablePackageId: sid(index * 2 + 1),
      };
    });
  return {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA,
    protocolVersion: 8,
    enabled: true,
    catalogId: sid(20),
    protocolConfigId: sid(21),
    protocolTreasuryId: sid(22),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles,
    roleConfigIds: {
      seal: sid(23), runtime: sid(24), output: sid(25), physical: sid(26),
      market: sid(27), release: sid(28),
    },
    makerBindings: [],
  };
}

function binding() {
  return {
    rootId: sid(100),
    baseRegistryId: sid(101),
    makerTreasuryId: sid(102),
    sealRegistryId: sid(103),
    runtimeDefinitionRegistryId: sid(104),
    packRegistryId: sid(105),
    packAdmissionAuthorityId: sid(106),
    outputRegistryId: sid(107),
    soulRegistryId: sid(108),
    physicalRegistryId: sid(109),
    marketRegistryId: sid(110),
    marketTreasuryId: sid(111),
  };
}

function activationEvent(overrides = {}) {
  const rt = runtime();
  const b = binding();
  return {
    id: { txDigest: txDigest(), eventSeq: '0' },
    type: makerV8ChainTypes(rt).activationEvent,
    parsedJson: {
      root_id: b.rootId,
      version: '8',
      owner: wallet,
      control_epoch: '0',
      admin_cap_id: sid(112),
      maker_key: 'fresh-maker',
      maker_version: '1',
      version_commitment: hash(1),
      content_commitment: hash(2),
      renderer_commitment: hash(3),
      protocol_config_id: rt.protocolConfigId,
      protocol_config_revision: '7',
      protocol_config_commitment: hash(4),
      protocol_treasury_id: rt.protocolTreasuryId,
      maker_treasury_id: b.makerTreasuryId,
      catalog_id: rt.catalogId,
      product_binding_commitment: hash(5),
      call_cap_set_commitment: hash(6),
      native_capability_mask: '127',
      capability_binding_commitment: hash(7),
      base_registry_id: b.baseRegistryId,
      seal_policy_config_id: rt.roleConfigIds.seal,
      seal_registry_id: b.sealRegistryId,
      runtime_definition_registry_id: b.runtimeDefinitionRegistryId,
      pack_registry_id: b.packRegistryId,
      admission_authority_id: b.packAdmissionAuthorityId,
      output_registry_id: b.outputRegistryId,
      soul_registry_id: b.soulRegistryId,
      physical_registry_id: b.physicalRegistryId,
      market_registry_id: b.marketRegistryId,
      market_treasury_id: b.marketTreasuryId,
      ...overrides,
    },
  };
}

function moveObject(type, objectId, fields, owner = { AddressOwner: wallet }, version = '9') {
  return {
    data: {
      objectId,
      version,
      digest: objectDigest(String((Number(version) % 5) + 4)),
      type,
      owner,
      content: { dataType: 'moveObject', type, fields: { id: { id: objectId }, ...fields } },
    },
  };
}

function capabilityFields(rt, b) {
  return {
    native_capability_mask: '127',
    catalog_id: rt.catalogId,
    call_cap_set: {},
    protocol_config_id: rt.protocolConfigId,
    base_registry_id: b.baseRegistryId,
    maker_treasury_id: b.makerTreasuryId,
    protocol_treasury_id: rt.protocolTreasuryId,
    seal_policy_config_id: rt.roleConfigIds.seal,
    seal_registry_id: b.sealRegistryId,
    runtime_definition_registry_id: b.runtimeDefinitionRegistryId,
    pack_registry_id: b.packRegistryId,
    admission_authority_id: b.packAdmissionAuthorityId,
    output_registry_id: b.outputRegistryId,
    soul_registry_id: b.soulRegistryId,
    physical_registry_id: b.physicalRegistryId,
    market_registry_id: b.marketRegistryId,
    market_treasury_id: b.marketTreasuryId,
    seal_readiness_commitment: hash(8),
    runtime_readiness_commitment: hash(9),
    output_readiness_commitment: hash(10),
    physical_readiness_commitment: hash(11),
    market_readiness_commitment: hash(12),
    commitment: hash(7),
  };
}

function rootResponse(overrides = {}) {
  const rt = runtime();
  const b = binding();
  return moveObject(
    makerV8ChainTypes(rt).root,
    b.rootId,
    {
      version: '8',
      core_original_package_id: rt.roles.core.typeOriginPackageId,
      core_callable_package_id: rt.roles.core.callablePackageId,
      creator: wallet,
      owner: wallet,
      admin_cap_id: sid(112),
      control_epoch: '0',
      lifecycle: '1',
      maker_key: 'fresh-maker',
      maker_version: '1',
      version_commitment: hash(1),
      previous_root_id: [],
      previous_version_commitment: [],
      successor_authority_id: [],
      successor_root_id: [],
      renderer_commitment: hash(3),
      manifest_blob_id: 'manifest-blob',
      manifest_sha256: hash(13),
      content_commitment: hash(2),
      base_registry_id: [b.baseRegistryId],
      maker_treasury_id: [b.makerTreasuryId],
      expected_base_definition_count: '4',
      expected_base_registry_commitment: hash(14),
      expected_pack_admission_policy_commitment: hash(15),
      economics: {
        protocol_config_id: rt.protocolConfigId,
        protocol_config_revision: '7',
        protocol_config_commitment: hash(4),
      },
      rights: {},
      product_release_binding: [{}],
      pack_admission_binding: [{}],
      capability_registry_binding: [{ fields: capabilityFields(rt, b) }],
      created_at_ms: '1',
      ...overrides,
    },
    { Shared: { initial_shared_version: '1' } },
  );
}

function parsedRoot() {
  return parseMakerRootV8(rootResponse(), runtime(), activationEvent());
}

function catalogAndConfigResponses(rt, overrides = {}) {
  const roleCommitment = Object.fromEntries(Object.keys(rt.roles).map((role, index) => [role, hash(40 + index)]));
  const roleBindings = Object.fromEntries(Object.entries(rt.roles).map(([role, identity], index) => [role, {
    fields: {
      original_package_id: identity.typeOriginPackageId,
      callable_package_id: identity.callablePackageId,
      source_commitment: hash(10 + index),
      package_commitment: hash(20 + index),
      abi_commitment: hash(30 + index),
      commitment: roleCommitment[role],
    },
  }]));
  const companionRoles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const authority = Object.fromEntries(companionRoles.map((role, index) => [role, sid(300 + index)]));
  const productBindingCommitment = hash(60);
  const callCapSetCommitment = hash(61);
  const catalogType = `${rt.roles.core.typeOriginPackageId}::package_binding_v8::ProductReleaseCatalogV8`;
  const catalog = moveObject(catalogType, rt.catalogId, {
    version: '8',
    protocol_config_id: rt.protocolConfigId,
    protocol_config_revision: '7',
    protocol_config_commitment: hash(4),
    binding: { fields: {
      version: '8',
      native_capability_mask: '127',
      ...roleBindings,
      commitment: productBindingCommitment,
    } },
    call_cap_set: { fields: {
      version: '8',
      catalog_id: rt.catalogId,
      product_binding_commitment: productBindingCommitment,
      ...Object.fromEntries(companionRoles.map((role) => [`${role}_authority_id`, authority[role]])),
      commitment: callCapSetCommitment,
    } },
    ...Object.fromEntries(companionRoles.map((role) => [`${role}_call_cap`, []])),
    ...overrides,
  }, { Shared: { initial_shared_version: '1' } });
  const typeNames = {
    seal: ['seal_v8', 'SealPolicyConfigV8'],
    runtime: ['runtime_binding_v8', 'RuntimePackageConfigV8'],
    output: ['output_v8', 'OutputPackageConfigV8'],
    physical: ['physical_v8', 'PhysicalPackageConfigV8'],
    market: ['market_v8', 'MarketPackageConfigV8'],
    release: ['release_v8', 'ReleasePackageConfigV8'],
  };
  const configs = Object.fromEntries(companionRoles.map((role) => {
    const [moduleName, typeName] = typeNames[role];
    const type = `${rt.roles[role].typeOriginPackageId}::${moduleName}::${typeName}`;
    const callCap = { fields: {
      version: '8',
      authority_id: authority[role],
      catalog_id: rt.catalogId,
      product_binding_commitment: productBindingCommitment,
      role_binding_commitment: roleCommitment[role],
      call_cap_set_commitment: callCapSetCommitment,
    } };
    return [role, moveObject(type, rt.roleConfigIds[role], {
      version: '8',
      catalog_id: rt.catalogId,
      product_binding_commitment: productBindingCommitment,
      call_cap_set_commitment: callCapSetCommitment,
      [`${role}_call_cap`]: callCap,
    }, { Shared: { initial_shared_version: '1' } })];
  }));
  const packages = Object.fromEntries(Object.keys(rt.roles).map((role, index) => [role, {
    data: {
      objectId: rt.roles[role].callablePackageId,
      version: '1',
      digest: String(index + 2).repeat(44),
      owner: { Immutable: true },
      bcs: {
        dataType: 'package', id: rt.roles[role].callablePackageId, version: '1',
        moduleMap: role === 'core' ? { base_registry_v8: CORE_BASE_REGISTRY_MODULE_BASE64 } : {},
      },
    },
  }]));
  return { catalog, configs, packages };
}

test('Mainnet ProductReleaseCatalog and all six installed call caps attest the only signing runtime', async () => {
  const rt = runtime();
  const evidence = catalogAndConfigResponses(rt);
  const rpc = mainnetRpc({
    async getObject({ id: objectId }) {
      if (objectId === rt.catalogId) return evidence.catalog;
      const packageRole = Object.keys(rt.roles).find((candidate) => rt.roles[candidate].callablePackageId === objectId);
      if (packageRole) return evidence.packages[packageRole];
      const role = Object.keys(rt.roleConfigIds).find((candidate) => rt.roleConfigIds[candidate] === objectId);
      return evidence.configs[role];
    },
  });
  const attested = await attestMakerV8Runtime(rpc, rt);
  assert.equal(attested.catalog.productBindingCommitment, '3c'.repeat(32));
  assert.deepEqual(Object.keys(attested.configs), ['seal', 'runtime', 'output', 'physical', 'market', 'release']);
  assert.equal(isMakerV8RuntimeAttested(attested.runtime), true);
  assert.equal(isMakerV8RuntimeAttested(rt), false, 'caller config is not the normalized attested capability');
  assert.deepEqual(makerV8AttestedPackageTuple(attested.runtime), attested.packageTuple);
  assert.deepEqual(attested.packageTuple.map(({ role, packageDigest }) => ({ role, packageDigest })), [
    { role: 'core', packageDigest: '2'.repeat(44) },
    { role: 'seal', packageDigest: '3'.repeat(44) },
    { role: 'runtime', packageDigest: '4'.repeat(44) },
    { role: 'output', packageDigest: '5'.repeat(44) },
    { role: 'physical', packageDigest: '6'.repeat(44) },
    { role: 'market', packageDigest: '7'.repeat(44) },
    { role: 'release', packageDigest: '8'.repeat(44) },
  ]);
  assert.deepEqual(Object.keys(attested.packageTuple[0]), [
    'role', 'originalPackageId', 'callablePackageId', 'packageDigest',
  ]);
  assert.deepEqual(makerV8AttestedCoreArtifact(attested.runtime), attested.coreArtifact);
  assert.deepEqual(Object.keys(attested.coreArtifact), [
    'callablePackageId', 'packageDigest', 'baseRegistryModuleSha256',
  ]);
  assert.equal(attested.coreArtifact.baseRegistryModuleSha256, MAKER_V8_APPROVED_CORE_BASE_REGISTRY_MODULE_SHA256);
  assert.throws(
    () => makerV8AttestedPackageTuple(rt),
    (error) => error.code === 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED',
  );
  assert.throws(
    () => makerV8AttestedCoreArtifact(rt),
    (error) => error.code === 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED',
  );

  const stale = catalogAndConfigResponses(rt);
  stale.configs.market.data.content.fields.market_call_cap.fields.authority_id = sid(999);
  await assert.rejects(() => attestMakerV8Runtime(mainnetRpc({
    async getObject({ id: objectId }) {
      if (objectId === rt.catalogId) return stale.catalog;
      const packageRole = Object.keys(rt.roles).find((candidate) => rt.roles[candidate].callablePackageId === objectId);
      if (packageRole) return stale.packages[packageRole];
      const role = Object.keys(rt.roleConfigIds).find((candidate) => rt.roleConfigIds[candidate] === objectId);
      return stale.configs[role];
    },
  }), rt), (error) => error.code === 'MAKER_V8_COMPANION_CALL_CAP_MISMATCH');

  for (const [name, expectedCode, mutate] of [
    ['digest', 'MAKER_V8_CHAIN_DIGEST_INVALID', (response) => { response.data.digest = 'caller-hash'; }],
    ['owner', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', (response) => { response.data.owner = { AddressOwner: wallet }; }],
    ['object id', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', (response) => { response.data.objectId = sid(998); }],
    ['BCS data type', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', (response) => { response.data.bcs.dataType = 'moveObject'; }],
  ]) {
    const corrupt = catalogAndConfigResponses(rt);
    mutate(corrupt.packages.market);
    await assert.rejects(() => attestMakerV8Runtime(mainnetRpc({
      async getObject({ id: objectId }) {
        if (objectId === rt.catalogId) return corrupt.catalog;
        const packageRole = Object.keys(rt.roles)
          .find((candidate) => rt.roles[candidate].callablePackageId === objectId);
        if (packageRole) return corrupt.packages[packageRole];
        const role = Object.keys(rt.roleConfigIds)
          .find((candidate) => rt.roleConfigIds[candidate] === objectId);
        return corrupt.configs[role];
      },
    }), rt), (error) => error.code === expectedCode, name);
  }

  for (const [name, mutate] of [
    ['missing Core module', (response) => { delete response.data.bcs.moduleMap.base_registry_v8; }],
    ['wrong Core module', (response) => { response.data.bcs.moduleMap.base_registry_v8 = Buffer.from('drift').toString('base64'); }],
    ['non-canonical Core module', (response) => { response.data.bcs.moduleMap.base_registry_v8 = `${response.data.bcs.moduleMap.base_registry_v8}=\n`; }],
    ['malformed Core package digest', (response) => { response.data.digest = 'not-a-sui-digest'; }],
  ]) {
    const corrupt = catalogAndConfigResponses(rt);
    mutate(corrupt.packages.core);
    await assert.rejects(() => attestMakerV8Runtime(mainnetRpc({
      async getObject({ id: objectId }) {
        if (objectId === rt.catalogId) return corrupt.catalog;
        const packageRole = Object.keys(rt.roles).find((candidate) => rt.roles[candidate].callablePackageId === objectId);
        if (packageRole) return corrupt.packages[packageRole];
        const role = Object.keys(rt.roleConfigIds).find((candidate) => rt.roleConfigIds[candidate] === objectId);
        return corrupt.configs[role];
      },
    }), rt), (error) => error.code === 'MAKER_V8_CORE_ARTIFACT_UNMEASURED', name);
  }
});

test('stable chain types use TypeOrigin identities and exact native payment generic', () => {
  const rt = runtime();
  const types = makerV8ChainTypes(rt);
  assert.equal(types.activationEvent, `${rt.roles.release.typeOriginPackageId}::release_v8::MakerV8Activated`);
  assert.equal(types.root, `${rt.roles.core.typeOriginPackageId}::maker_v8::MakerRootV8<${MAKER_V8_PAYMENT_COIN_TYPE}>`);
  assert.equal(Object.isFrozen(types), true);
});

test('MakerV8Activated parses the complete seven-role tuple and rejects old discovery', () => {
  const activation = parseMakerV8ActivatedEvent(activationEvent(), runtime());
  assert.deepEqual(activation.binding, binding());
  assert.equal(activation.owner, wallet);
  assert.equal(activation.productBindingCommitment, '05'.repeat(32));

  const legacy = activationEvent();
  legacy.type = `${sid(1)}::maker_v7::OCMakerPublished`;
  assert.throws(
    () => parseMakerV8ActivatedEvent(legacy, runtime()),
    (error) => error instanceof MakerV8ChainError && error.code === 'UNSUPPORTED_LEGACY_PRODUCT',
  );
});

test('activation rejects missing fields, object collisions, and runtime identity drift', () => {
  const missing = activationEvent();
  delete missing.parsedJson.market_treasury_id;
  assert.throws(() => parseMakerV8ActivatedEvent(missing, runtime()), /required/);
  assert.throws(
    () => parseMakerV8ActivatedEvent(activationEvent({ market_treasury_id: binding().marketRegistryId }), runtime()),
    (error) => error.code === 'MAKER_V8_BINDING_ID_COLLISION',
  );
  assert.throws(
    () => parseMakerV8ActivatedEvent(activationEvent({ catalog_id: sid(777) }), runtime()),
    (error) => error.code === 'MAKER_V8_ACTIVATION_RUNTIME_MISMATCH',
  );
});

test('Root readback verifies lifecycle, immutable snapshot, and every capability binding', () => {
  const root = parsedRoot();
  assert.equal(root.lifecycle, 'ACTIVE');
  assert.equal(root.owner.kind, 'shared');
  assert.equal(root.creatorAddress, wallet);
  assert.equal(root.capabilityBindingCommitment, '07'.repeat(32));
  const corrupted = rootResponse();
  corrupted.data.content.fields.capability_registry_binding[0].fields.market_registry_id = sid(999);
  assert.throws(
    () => parseMakerRootV8(corrupted, runtime(), activationEvent()),
    (error) => error.code === 'MAKER_V8_CAPABILITY_BINDING_MISMATCH',
  );

  const transferred = parseMakerRootV8(rootResponse({
    owner: sid(901),
    admin_cap_id: sid(902),
    control_epoch: '1',
  }), runtime(), activationEvent());
  assert.equal(transferred.ownerAddress, sid(901));
  assert.equal(transferred.adminCapId, sid(902));
  assert.equal(transferred.controlEpoch, 1n);
  assert.equal(transferred.contentCommitment, root.contentCommitment);
});

test('ProtocolConfig and MakerTreasury readback provide live eligibility facts', async () => {
  const rt = runtime();
  const root = parsedRoot();
  const protocolResponse = moveObject(
    makerV8ChainTypes(rt).protocolConfig,
    rt.protocolConfigId,
    {
      version: '8',
      core_original_package_id: rt.roles.core.typeOriginPackageId,
      core_callable_package_id: rt.roles.core.callablePackageId,
      revision: '7',
      treasury_id: [rt.protocolTreasuryId],
      payment_coin_type: rt.paymentCoinType,
      enabled: true,
      commitment: hash(4),
    },
    { Shared: { initial_shared_version: '1' } },
  );
  const treasuryResponse = moveObject(
    makerV8ChainTypes(rt).makerTreasury,
    root.binding.makerTreasuryId,
    {
      version: '8',
      root_id: root.objectId,
      maker_version: '1',
      root_content_commitment: hash(2),
      revenue: { fields: { value: '0' } },
      total_collected: '50',
      total_withdrawn: '50',
    },
    { Shared: { initial_shared_version: '1' } },
  );
  const protocol = parseProtocolConfigV8(protocolResponse, rt, root);
  const treasury = parseMakerTreasuryV8(treasuryResponse, rt, root);
  assert.equal(protocol.enabled, true);
  assert.equal(protocol.revision, 7n);
  assert.equal(protocol.commitment, `0x${'04'.repeat(32)}`);
  assert.equal(treasury.balanceAtomic, 0n);
  assert.equal(treasury.totalCollectedAtomic, 50n);

  const loaded = await loadMakerV8OperationalState(mainnetRpc({
    async getObject({ id: objectId }) {
      return objectId === rt.protocolConfigId ? protocolResponse : treasuryResponse;
    },
  }), rt, root);
  assert.equal(loaded.protocolConfig.commitment, protocol.commitment);
  assert.equal(loaded.makerTreasury.balanceAtomic, 0n);

  const wrong = moveObject(makerV8ChainTypes(rt).protocolConfig, rt.protocolConfigId, {
    version: '8', core_original_package_id: rt.roles.core.typeOriginPackageId,
    core_callable_package_id: rt.roles.core.callablePackageId, revision: '7',
    treasury_id: [rt.protocolTreasuryId], payment_coin_type: `${sid(999)}::coin::BAD`,
    enabled: true, commitment: hash(4),
  });
  assert.throws(() => parseProtocolConfigV8(wrong, rt, root), (error) => error.code === 'MAKER_V8_PROTOCOL_CONFIG_MISMATCH');
});

function soulResponses() {
  const rt = runtime();
  const root = parsedRoot();
  const outputId = sid(200);
  const receiptId = sid(201);
  const soulId = sid(202);
  const common = {
    root_id: root.objectId,
    maker_version: '1',
    root_content_commitment: hash(2),
    output_key: 'default-png',
    holder: wallet,
  };
  return {
    output: moveObject(makerV8ChainTypes(rt).completeOutput, outputId, {
      ...common,
      version: '8', output_registry_id: root.binding.outputRegistryId,
    }),
    receipt: moveObject(makerV8ChainTypes(rt).completeReceipt, receiptId, {
      ...common,
      version: '8', output_id: outputId,
    }),
    soul: moveObject(makerV8ChainTypes(rt).canonicalSoul, soulId, {
      ...common,
      version: '8', soul_registry_id: root.binding.soulRegistryId,
      ownership_epoch: '3', output_id: outputId, receipt_id: receiptId,
    }),
  };
}

test('Soul inventory joins the exact live Output/Receipt/Soul triple', () => {
  const root = parsedRoot();
  const bundle = parseSoulBundleV8(soulResponses(), runtime(), wallet, root);
  assert.equal(bundle.ownershipEpoch, 3n);
  assert.equal(bundle.output.objectRef.objectId, sid(200));
  const wrong = soulResponses();
  wrong.soul.data.content.fields.receipt_id = sid(555);
  assert.throws(
    () => parseSoulBundleV8(wrong, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_SOUL_BUNDLE_MISMATCH',
  );
});

function physicalResponse(sourceKind = 0) {
  const rt = runtime();
  const root = parsedRoot();
  return moveObject(makerV8ChainTypes(rt).physicalAsset, sid(300 + sourceKind), {
    version: '8', registry_id: root.binding.physicalRegistryId,
    root_id: root.objectId, maker_version: '1', root_content_commitment: hash(2),
    source: { fields: {
      source_kind: String(sourceKind), source_id: sourceKind ? sid(400) : root.binding.baseRegistryId,
      source_semantic_id: sourceKind ? 'pack-alpha' : '', source_content_commitment: hash(20),
      source_treasury_id: sourceKind ? [sid(401)] : [], pack_registry_id: sourceKind ? [root.binding.packRegistryId] : [],
      pack_registry_revision: '0', registered_pack_owner: [], registered_pack_control_epoch: '0',
      registered_pack_admin_cap_id: [],
    } },
    style: { fields: {
      part_key: 'body', item_key: 'shirt', style_key: 'default', layer_track_key: 'body',
      color_channel_key: [], default_swatch_key: [], style_asset_blob_id: 'asset',
      style_asset_sha256: hash(21), style_protected: false,
    } },
    holder: wallet, ownership_epoch: '2', transferable: true,
  });
}

test('Physical inventory infers Base versus Pack only from verified custody fields', () => {
  const root = parsedRoot();
  const base = parsePhysicalAssetV8(physicalResponse(0), runtime(), wallet, root);
  const pack = parsePhysicalAssetV8(physicalResponse(1), runtime(), wallet, root);
  assert.equal(base.source, 'BASE');
  assert.equal(base.sourceTreasuryId, null);
  assert.equal(pack.source, 'PACK');
  assert.equal(pack.sourceTreasuryId, sid(401));
  const forged = physicalResponse(0);
  forged.data.content.fields.source.fields.source_treasury_id = [sid(401)];
  assert.throws(
    () => parsePhysicalAssetV8(forged, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_PHYSICAL_SOURCE_MISMATCH',
  );

  const flatConflict = physicalResponse(0);
  flatConflict.data.content.fields.sourceKind = '1';
  assert.throws(
    () => parsePhysicalAssetV8(flatConflict, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_PHYSICAL_FIELDS_LEGACY',
  );

  const flatOnly = physicalResponse(0);
  const flatFields = flatOnly.data.content.fields;
  Object.assign(flatFields, flatFields.source.fields, flatFields.style.fields);
  delete flatFields.source;
  delete flatFields.style;
  assert.throws(
    () => parsePhysicalAssetV8(flatOnly, runtime(), wallet, root),
    (error) => error.code === 'MAKER_V8_CHAIN_FIELDS_INVALID',
  );
});

test('discovery queries only MakerV8Activated and paginates without dual reads', async () => {
  const calls = [];
  const rpc = mainnetRpc({
    async queryEvents(input) {
      calls.push(input);
      return calls.length === 1
        ? { data: [activationEvent()], hasNextPage: true, nextCursor: { txDigest: txDigest(), eventSeq: '1' } }
        : { data: [], hasNextPage: false, nextCursor: null };
    },
  });
  const rows = await discoverMakerV8Activations(rpc, runtime());
  assert.equal(rows.length, 1);
  assert.deepEqual(calls[0].query, { MoveEventType: makerV8ChainTypes(runtime()).activationEvent });
  assert.equal(JSON.stringify(calls).includes('OCMaker'), false);
});

test('owned inventory queries only stable v8 types and requires complete Soul bundles', async () => {
  const root = parsedRoot();
  const types = makerV8ChainTypes(runtime());
  const soul = soulResponses();
  const foreignPhysical = physicalResponse(0);
  foreignPhysical.data.objectId = sid(999);
  foreignPhysical.data.content.fields.id = { id: sid(999) };
  foreignPhysical.data.content.fields.root_id = sid(998);
  const foreignAdmin = moveObject(types.adminCap, sid(997), {
    version: '8', root_id: sid(998), owner: wallet, control_epoch: '0',
  });
  const byType = new Map([
    [types.adminCap, [foreignAdmin]], [types.completeOutput, [soul.output]],
    [types.completeReceipt, [soul.receipt]], [types.canonicalSoul, [soul.soul]],
    [types.physicalAsset, [physicalResponse(0), foreignPhysical]],
  ]);
  const calls = [];
  const rpc = mainnetRpc({
    async getOwnedObjects(input) {
      calls.push(input);
      return { data: byType.get(input.filter.StructType), hasNextPage: false, nextCursor: null };
    },
  });
  const inventory = await listOwnedMakerV8Inventory(rpc, runtime(), wallet, root);
  assert.equal(inventory.soulBundles.length, 1);
  assert.equal(inventory.physicalAssets.length, 1);
  assert.equal(inventory.adminCaps.length, 0);
  assert.deepEqual(new Set(calls.map((call) => call.filter.StructType)), new Set([
    types.adminCap,
    types.completeOutput,
    types.completeReceipt,
    types.canonicalSoul,
    types.physicalAsset,
  ]));
});

test('Receiving uses exact child object ID/version/digest and rejects tx.object substitution context', async () => {
  const rt = runtime();
  const listingId = sid(500);
  const child = moveObject(makerV8ChainTypes(rt).adminCap, sid(501), {
    version: '8', root_id: binding().rootId, owner: wallet, control_epoch: '0',
  }, { ObjectOwner: listingId }, '17');
  const rpc = mainnetRpc({ async getObject() { return child; } });
  const ref = await loadReceivingRefV8(rpc, rt, sid(501), listingId, makerV8ChainTypes(rt).adminCap);
  assert.deepEqual(ref, {
    objectId: sid(501), version: '17', digest: objectDigest('6'), network: 'mainnet',
    type: makerV8ChainTypes(rt).adminCap, listingId,
  });
  child.data.owner = { ObjectOwner: sid(999) };
  assert.rejects(
    () => loadReceivingRefV8(rpc, rt, sid(501), listingId, makerV8ChainTypes(rt).adminCap),
    (error) => error.layer === 'stale' && error.code === 'MAKER_V8_RECEIVING_OWNER_MISMATCH',
  );
});

test('gRPC finalized readback is query-first, sender-bound, event-bound, and failure-layered', async () => {
  const eventType = makerV8ChainTypes(runtime()).activationEvent;
  const finalizedRpc = ({ success = true } = {}) => {
    const transaction = {
      digest: txDigest(),
      epoch: '7',
      status: { success, error: success ? null : { message: 'MoveAbort(...)' } },
      transaction: { sender: wallet },
      effects: {
        transactionDigest: txDigest(),
        status: { success, error: success ? null : { message: 'MoveAbort(...)' } },
        changedObjects: [],
      },
      events: [{ eventType }],
    };
    return mainnetRpc({
      async getTransactionFinality() {
        return {
          digest: txDigest(), checkpoint: '10', epoch: '7',
          status: transaction.status,
        };
      },
      core: {
        async getTransaction() {
          return success
            ? { $kind: 'Transaction', Transaction: transaction }
            : { $kind: 'FailedTransaction', FailedTransaction: transaction };
        },
      },
    });
  };
  const result = await readFinalizedMakerV8Transaction(finalizedRpc(), txDigest(), {
    expectedSender: wallet, expectedEventTypes: [eventType],
  });
  assert.equal(result.digest, txDigest());

  await assert.rejects(
    () => readFinalizedMakerV8Transaction(finalizedRpc({ success: false }), txDigest(), { expectedSender: wallet }),
    (error) => error.layer === 'finalized' && error.code === 'MAKER_V8_FINALIZED_FAILURE',
  );
  await assert.rejects(
    () => readFinalizedMakerV8Transaction(mainnetRpc({
      async getTransactionFinality() { throw new Error('not indexed'); },
      core: { async getTransaction() { throw new Error('must not run'); } },
    }), txDigest(), { expectedSender: wallet }),
    (error) => error.layer === 'signed-outcome' && error.code === 'MAKER_V8_SIGNED_OUTCOME_UNKNOWN',
  );
});

test('client accepts only an RPC attested to the exact Mainnet chain identifier', async () => {
  class Rpc { async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; } }
  const client = createMakerV8ChainClient(runtime(), { rpc: new Rpc(), network: 'mainnet' });
  await assert.doesNotReject(() => client.ready());
  assert.throws(
    () => createMakerV8ChainClient(runtime(), { rpc: new Rpc(), network: 'testnet' }),
    (error) => error.code === 'MAKER_V8_NETWORK_MISMATCH',
  );
  await assert.rejects(
    () => createMakerV8ChainClient(runtime(), {
      rpc: { async getChainIdentifier() { return 'testnet-chain'; } }, network: 'mainnet',
    }).ready(),
    (error) => error.code === 'MAKER_V8_RPC_CHAIN_ID_MISMATCH',
  );
});
