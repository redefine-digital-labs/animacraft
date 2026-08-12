import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { deriveExpansionPackSealReleaseCommitmentV8 } from '../maker-seal-v5.js';
import {
  EXPANSION_PACK_V8_LIFECYCLE,
  INDEPENDENT_EXTENSION_LOCK_V5_FIELD_KEY,
  MAKER_RELEASE_EVIDENCE_V5_FIELD_KEY,
  buildArchiveExpansionPackV8,
  buildClaimFreeExpansionPackV8,
  buildExpansionPackStyleSealApprovalV8,
  buildPauseExpansionPackV8,
  buildPurchaseExpansionPackV8,
  buildResumeExpansionPackV8,
  buildWithdrawExpansionPackRevenueV8,
  parseExpansionPackPassV8,
  parseExpansionPackReleaseV8,
  queryIndependentExtensionLockV5,
  queryMakerReleaseEvidenceV5,
  queryExpansionPackReleasesV8,
  queryExpansionPackStyleRecordsV8,
  queryOwnedExpansionPackPassesV8,
  readExpansionPackV8PublicationSubmission,
  transactionFromExpansionPackV8PublicationAction,
  verifyExpansionPackV8ParentAction,
} from '../expansion-pack-publication-v8-app.js';

const TYPE_ORIGIN = '0xa';
const CALLABLE = '0xb';
const COMMERCE_ORIGIN = '0xc';
const ORIGINAL = '0xd';
const INDEPENDENT_EXTENSION_ORIGIN = '0xf';
const PAYMENT = '0xe::usdc::USDC';
const HASH = (byte) => byte.repeat(32);
const BYTES = (byte) => Array(32).fill(Number.parseInt(byte, 16));
const id = (value) => `0x${value}`;
const INDEPENDENT_EXTENSION_AUTHORITY = id(70);
const PROTOCOL_ADMIN_CAP = id(71);
const RETIRED_CONTROL_CAP = id(8);
const AUDIT_HASH = HASH('66');

const runtime = Object.freeze({
  expansionPackV8TypeOriginPackageId: TYPE_ORIGIN,
  expansionPackV8CallablePackageId: CALLABLE,
  commerceV5TypeOriginPackageId: COMMERCE_ORIGIN,
  independentExtensionV5TypeOriginPackageId: INDEPENDENT_EXTENSION_ORIGIN,
  independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
  callablePackageId: CALLABLE,
  originalPackageId: ORIGINAL,
  commerceProtocolConfigV5Id: id(6),
  commerceProtocolTreasuryV5Id: id(7),
  paymentCoinType: PAYMENT,
  expansionPackV8ReleaseEnabled: true,
});

function table(idValue) {
  return { id: { id: { bytes: idValue } } };
}

function releaseFields(overrides = {}) {
  return {
    version: '8',
    parent_root_id: id(1),
    parent_legacy_maker_id: id(2),
    parent_version: '1',
    parent_manifest_blob_id: 'parent-quilt',
    parent_manifest_sha256: BYTES('11'),
    pack_id: 'pack-1',
    namespace: 'maker.pack-1',
    pack_version: '1.0.0',
    creator: id(9),
    manifest_bound: true,
    manifest_blob_id: 'pack-quilt',
    manifest_sha256: BYTES('22'),
    content_commitment: BYTES('33'),
    style_registry_commitment: [],
    seal_policy_id: { vec: [] },
    seal_package_id: { vec: [] },
    seal_release_commitment: [],
    access_kind: 0,
    purchase_price_atomic: '0',
    lifecycle: 0,
    admin_cap_id: id(4),
    treasury_id: id(5),
    admitted_by: '0x0',
    admitted_parent_ownership_epoch: '0',
    styles: table('0x81'),
    seal_assets: table('0x82'),
    entitlements: table('0x83'),
    style_count: '0',
    entitlement_count: '0',
    ...overrides,
  };
}

function releaseObject(overrides = {}, objectOverrides = {}) {
  return {
    objectId: id(3),
    type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackReleaseV8`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: releaseFields(overrides) },
    ...objectOverrides,
  };
}

function capObject(overrides = {}) {
  return {
    objectId: id(4),
    type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdminCapV8`,
    owner: { AddressOwner: id(9) },
    json: { fields: { version: '8', release_id: id(3), creator: id(9) } },
    ...overrides,
  };
}

function treasuryObject(overrides = {}) {
  return {
    objectId: id(5),
    type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackTreasuryV8<${PAYMENT}>`,
    owner: { Shared: { initial_shared_version: '1' } },
    json: { fields: {
      version: '8',
      release_id: id(3),
      revenue: { fields: { value: '0' } },
      total_collected: '0',
      total_withdrawn: '0',
    } },
    ...overrides,
  };
}

function passObject(overrides = {}, objectOverrides = {}) {
  return {
    objectId: '0x44',
    type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackPassV8`,
    owner: { AddressOwner: id(9) },
    json: { fields: {
      version: '8',
      release_id: id(3),
      parent_root_id: id(1),
      holder: id(9),
      paid_atomic: '0',
      issued_at_ms: '1234',
      admitted_parent_ownership_epoch: '7',
      content_commitment: BYTES('33'),
      ...overrides,
    } },
    ...objectOverrides,
  };
}

function admittedEvent(releaseIdValue = id(3), overrides = {}, type = `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdmittedV8`) {
  return {
    type,
    parsedJson: {
      release_id: releaseIdValue,
      parent_root_id: id(1),
      parent_legacy_maker_id: id(2),
      admitted_by: id(9),
      parent_ownership_epoch: '7',
      parent_version: '1',
      parent_manifest_blob_id: 'parent-quilt',
      parent_manifest_sha256: BYTES('11'),
      ...overrides,
    },
  };
}

function parentObjects() {
  return [
    {
      objectId: id(1),
      type: `${COMMERCE_ORIGIN}::commerce_v5::MakerRootV5`,
      owner: { Shared: { initial_shared_version: '1' } },
      json: { fields: {
        legacy_maker_id: id(2),
        current_owner: id(9),
        current_control_cap_id: id(8),
        ownership_epoch: '7',
        lifecycle: 1,
        protocol_config_id: id(6),
        release: { fields: { style_registry_sealed: true } },
      } },
    },
    {
      objectId: id(2),
      type: `${ORIGINAL}::animacraft::OCMaker`,
      owner: { Shared: { initial_shared_version: '1' } },
      json: { fields: { manifest_blob_id: 'parent-quilt' } },
    },
    {
      objectId: INDEPENDENT_EXTENSION_AUTHORITY,
      type: `${INDEPENDENT_EXTENSION_ORIGIN}::commerce_v5::IndependentExtensionAuthorityV5`,
      owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
      json: { fields: {
        version: '5',
        root_id: id(1),
        legacy_maker_id: id(2),
        protocol_config_id: id(6),
        protocol_admin_cap_id: PROTOCOL_ADMIN_CAP,
        owner: id(9),
        retired_control_cap_id: RETIRED_CONTROL_CAP,
        retired_control_cap_epoch: '6',
        locked_ownership_epoch: '7',
        audit_hash: BYTES('66'),
      } },
    },
  ];
}

function parentEvidenceBytes(overrides = {}) {
  return bcs.struct('MakerReleaseEvidenceV5', {
    parent_version: bcs.string(),
    manifest_blob_id: bcs.string(),
    manifest_sha256: bcs.byteVector(),
  }).serialize({
    parent_version: '1',
    manifest_blob_id: 'parent-quilt',
    manifest_sha256: BYTES('11'),
    ...overrides,
  }).toBytes();
}

function independentExtensionLockBytes(overrides = {}) {
  const suiId = bcs.struct('ID', { bytes: bcs.Address });
  return bcs.struct('IndependentExtensionLockStateV5', {
    authority_id: suiId,
    legacy_maker_id: suiId,
    protocol_config_id: suiId,
    protocol_admin_cap_id: suiId,
    owner: bcs.Address,
    retired_control_cap_id: suiId,
    retired_control_cap_epoch: bcs.u64(),
    locked_ownership_epoch: bcs.u64(),
    audit_hash: bcs.byteVector(),
    finalized: bcs.bool(),
  }).serialize({
    authority_id: { bytes: INDEPENDENT_EXTENSION_AUTHORITY },
    legacy_maker_id: { bytes: id(2) },
    protocol_config_id: { bytes: id(6) },
    protocol_admin_cap_id: { bytes: PROTOCOL_ADMIN_CAP },
    owner: id(9),
    retired_control_cap_id: { bytes: RETIRED_CONTROL_CAP },
    retired_control_cap_epoch: '6',
    locked_ownership_epoch: '7',
    audit_hash: BYTES('66'),
    finalized: true,
    ...overrides,
  }).toBytes();
}

function getObjectsClient(objects, {
  lockOverrides = {},
  lockType = `${INDEPENDENT_EXTENSION_ORIGIN}::commerce_v5::IndependentExtensionLockStateV5`,
  retiredControlCapState = 'deleted',
} = {}) {
  const values = [...objects];
  return {
    async getObjects(request) {
      return {
        objects: request.objectIds.flatMap((requested) => {
          const found = values.find((entry) => {
            const left = BigInt(entry.objectId);
            const right = BigInt(requested);
            return left === right;
          });
          if (found) return [found];
          if (BigInt(requested) === BigInt(RETIRED_CONTROL_CAP)) {
            if (retiredControlCapState === 'omitted') return [];
            if (retiredControlCapState === 'unknown') {
              return [{ error: { code: 'unknown', object_id: requested } }];
            }
            return [{
              error: {
                code: 'deleted',
                object_id: RETIRED_CONTROL_CAP,
                version: '6',
                digest: 'retired-control-cap',
              },
            }];
          }
          return [{ error: { code: 'notExists', object_id: requested } }];
        }),
      };
    },
    async getDynamicField(request) {
      if (BigInt(request.parentId) !== 1n) throw new Error('dynamic field not found');
      const key = bcs.string().parse(request.name.bcs);
      if (key === MAKER_RELEASE_EVIDENCE_V5_FIELD_KEY) {
        return { dynamicField: { value: {
          type: `${COMMERCE_ORIGIN}::commerce_v5::MakerReleaseEvidenceV5`,
          bcs: parentEvidenceBytes(),
        } } };
      }
      if (key === INDEPENDENT_EXTENSION_LOCK_V5_FIELD_KEY) {
        return { dynamicField: { value: {
          type: lockType,
          bcs: independentExtensionLockBytes(lockOverrides),
        } } };
      }
      throw new Error('dynamic field not found');
    },
  };
}

function publicationAction(functionName, inputs, extra = {}) {
  return {
    id: extra.id || `fixture.${functionName}`,
    transport: 'SUI',
    target: extra.target || `${CALLABLE}::expansion_pack_v8::${functionName}`,
    authority: { signer: id(9), capability: INDEPENDENT_EXTENSION_AUTHORITY },
    typeArguments: extra.typeArguments || [],
    inputs,
  };
}

test('publication PTBs encode the exact audited v8 Move argument orders', () => {
  const common = {
    baseMakerRootId: id(1),
    parentLegacyMakerId: id(2),
    commerceProtocolConfigV5Id: id(6),
    parentVersion: '1',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: HASH('11'),
    packId: 'pack-1',
    packNamespace: 'maker.pack-1',
    packVersion: '1.0.0',
    manifestBlobId: 'pack-quilt',
    manifestSha256: HASH('22'),
    contentCommitment: HASH('33'),
    accessKind: 0,
    purchasePriceAtomic: '0',
    packReleaseId: id(3),
    packAdminCapId: id(4),
    independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
    partKey: 'hair',
    itemKey: 'long',
    styleKey: 'black',
    assetBlobId: 'style-patch',
    assetSha256: HASH('44'),
    assetSealId: '',
    styleRegistryCommitment: HASH('55'),
    sealPolicyId: id(3),
    sealReleaseCommitment: HASH('33'),
  };
  const expected = {
    create_expansion_pack_v8: 12,
    bind_expansion_pack_manifest_v8: 4,
    register_style_asset_v8: 8,
    seal_expansion_pack_v8: 3,
    bind_expansion_pack_seal_policy_v8: 2,
    admit_expansion_pack_with_authority_v8: 4,
    activate_expansion_pack_v8: 4,
  };
  for (const [functionName, count] of Object.entries(expected)) {
    const tx = transactionFromExpansionPackV8PublicationAction(publicationAction(
      functionName,
      common,
      { typeArguments: functionName === 'create_expansion_pack_v8' ? [PAYMENT] : [] },
    ));
    const call = tx.getData().commands[0].MoveCall;
    assert.equal(call.function, functionName);
    assert.equal(call.arguments.length, count);
  }
  for (const [legacyFunction, target] of [
    ['admit_expansion_pack_v8', `${CALLABLE}::expansion_pack_v8::admit_expansion_pack_v8`],
    ['bind_maker_release_evidence_v5', `${CALLABLE}::commerce_v5::bind_maker_release_evidence_v5`],
  ]) {
    assert.throws(
      () => transactionFromExpansionPackV8PublicationAction(publicationAction(
        legacyFunction,
        common,
        { target },
      )),
      { code: 'EXPANSION_PACK_V8_CHAIN_TARGET_UNSUPPORTED' },
    );
  }
  const create = transactionFromExpansionPackV8PublicationAction(publicationAction(
    'create_expansion_pack_v8', common, { typeArguments: [PAYMENT] },
  )).getData();
  assert.equal(create.commands[0].MoveCall.arguments[0].type, 'object');
  assert.equal(create.commands[0].MoveCall.arguments[1].type, 'object');
  assert.equal(create.commands[0].MoveCall.arguments[2].type, 'object');
  assert.ok(create.commands[0].MoveCall.arguments.slice(3).every((entry) => entry.type === 'pure'));
});

test('lifecycle, acquisition and withdrawal builders use v8 package and exact payment split', () => {
  const operations = [
    buildPauseExpansionPackV8({ runtime, releaseId: id(3), adminCapId: id(4), sender: id(9) }),
    buildResumeExpansionPackV8({
      runtime, releaseId: id(3), adminCapId: id(4), parentRootId: id(1), sender: id(9),
    }),
    buildArchiveExpansionPackV8({ runtime, releaseId: id(3), adminCapId: id(4), sender: id(9) }),
    buildClaimFreeExpansionPackV8({ runtime, releaseId: id(3), parentRootId: id(1), sender: id(9) }),
    buildWithdrawExpansionPackRevenueV8({
      runtime,
      releaseId: id(3),
      treasuryId: id(5),
      adminCapId: id(4),
      amountAtomic: '5',
      recipient: '0x99',
      sender: id(9),
    }),
  ];
  assert.deepEqual(
    operations.map((entry) => entry.getData().commands.at(-1).MoveCall.function),
    [
      'pause_expansion_pack_v8',
      'resume_expansion_pack_v8',
      'archive_expansion_pack_v8',
      'claim_free_expansion_pack_v8',
      'withdraw_expansion_pack_revenue_v8',
    ],
  );
  const purchase = buildPurchaseExpansionPackV8({
    runtime,
    releaseId: id(3),
    treasuryId: id(5),
    parentRootId: id(1),
    priceAtomic: '4534560',
    sender: id(9),
  });
  const commands = purchase.getData().commands;
  assert.equal(commands[0].$kind, '$Intent');
  assert.equal(commands[1].MoveCall.function, 'purchase_expansion_pack_v8');
  assert.deepEqual(commands[1].MoveCall.arguments[5].Result, 0);
  assert.throws(
    () => buildClaimFreeExpansionPackV8({
      runtime: { ...runtime, expansionPackV8ReleaseEnabled: false },
      releaseId: id(3),
      parentRootId: id(1),
      sender: id(9),
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_RELEASE_DISABLED',
  );
});

test('paid Style Seal approval binds the exact v8 package, release and scoped commitment', async () => {
  const sealId = HASH('44');
  const contentCommitment = HASH('33');
  const releaseCommitment = (
    await deriveExpansionPackSealReleaseCommitmentV8({
      releaseId: id(3),
      contentCommitment,
    })
  ).id.replace(/^0x/i, '').toLowerCase();
  const protection = {
    schemaVersion: 'animacraft.sealed-asset.v5',
    mode: 'SEAL_PAID_PACK',
    sealPackageId: TYPE_ORIGIN,
    sealId,
    releaseCommitment,
  };
  const approval = await buildExpansionPackStyleSealApprovalV8({
    runtime: { ...runtime, expansionPackV8ReleaseEnabled: false },
    releaseId: id(3),
    parentRootId: id(1),
    sealId,
    sealPackageId: TYPE_ORIGIN,
    contentCommitment,
    protection,
    sender: id(9),
  });
  const call = approval.getData().commands[0].MoveCall;
  assert.equal(BigInt(call.package), BigInt(CALLABLE));
  assert.notEqual(BigInt(call.package), BigInt(TYPE_ORIGIN));
  assert.equal(call.module, 'expansion_pack_v8');
  assert.equal(call.function, 'seal_approve_style_v8');
  assert.equal(call.arguments.length, 3);

  await assert.rejects(
    buildExpansionPackStyleSealApprovalV8({
      runtime,
      releaseId: id(3),
      parentRootId: id(1),
      sealId,
      sealPackageId: TYPE_ORIGIN,
      contentCommitment,
      protection: { ...protection, sealPackageId: '0xff' },
      sender: id(9),
    }),
    { code: 'EXPANSION_PACK_V8_SEAL_PROTECTION_MISMATCH' },
  );
});

test('release and wallet-bound Pass parsers require the stable TypeOrigin and exact owner', () => {
  const release = parseExpansionPackReleaseV8(releaseObject(), { runtime });
  assert.equal(release.lifecycleState, 'DRAFT');
  assert.equal(release.parentManifestSha256, HASH('11'));
  assert.equal(release.purchasePriceAtomic, 0n);

  const pass = parseExpansionPackPassV8(passObject(), { runtime });
  assert.equal(pass.releaseId, id(3));
  assert.equal(pass.holder, id(9));

  assert.throws(
    () => parseExpansionPackReleaseV8(
      releaseObject({}, { type: `${CALLABLE}::expansion_pack_v8::ExpansionPackReleaseV8` }),
      { runtime },
    ),
    (error) => error.code === 'EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH',
  );
  assert.throws(
    () => parseExpansionPackPassV8(passObject({}, { owner: { AddressOwner: '0x88' } }), { runtime }),
    (error) => error.code === 'EXPANSION_PACK_V8_OWNER_MISMATCH',
  );
});

test('parent verifier requires the exact Root lock, shared authority, deleted Cap and Walrus evidence', async () => {
  const action = {
    id: 'parent.release.verify',
    authority: { signer: id(9) },
    inputs: {
      baseMakerRootId: id(1),
      parentLegacyMakerId: id(2),
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
      parentVersion: '1',
      parentVersionId: 'version-1',
      parentManifestBlobId: 'parent-quilt',
      parentManifestSha256: HASH('11'),
      parentIdentity: 'parent-identity',
    },
  };
  const verified = await verifyExpansionPackV8ParentAction({
    action,
    runtime,
    suiClient: getObjectsClient(parentObjects()),
    async manifestReadback() {
      return {
        sha256: HASH('11'),
        version: '1',
        versionId: 'version-1',
        identity: 'parent-identity',
      };
    },
  });
  assert.equal(verified.parentVerified, true);
  assert.equal(verified.independentExtensionAuthorityVerified, true);
  assert.equal(verified.retiredMakerControlCapUnavailable, true);
  assert.equal(verified.parentReleaseEvidenceBound, true);
  assert.equal(verified.parentLifecycleState, 'PAUSED');
  assert.equal(verified.parentOwnershipEpoch, '7');
  const grpcJsonObjects = parentObjects();
  grpcJsonObjects[2].json.fields.audit_hash = Buffer.from(BYTES('66')).toString('base64');
  const grpcJsonVerified = await verifyExpansionPackV8ParentAction({
    action,
    runtime,
    suiClient: getObjectsClient(grpcJsonObjects),
    async manifestReadback() {
      return {
        sha256: HASH('11'),
        version: '1',
        versionId: 'version-1',
        identity: 'parent-identity',
      };
    },
  });
  assert.equal(grpcJsonVerified.parentVerified, true);
  assert.equal(grpcJsonVerified.independentExtensionAuthorityVerified, true);
  for (const invalidAuditHash of [
    Buffer.alloc(31, 0x66).toString('base64'),
    Buffer.alloc(33, 0x66).toString('base64'),
    Buffer.from(BYTES('66')).toString('base64').replace(/=$/, ''),
    `${Buffer.from(BYTES('66')).toString('base64')}=`,
    'fCB5l05PWfSszsRGEkwO1_OU2RFLjJk5O-EmXMo89lg=',
  ]) {
    const invalidObjects = parentObjects();
    invalidObjects[2].json.fields.audit_hash = invalidAuditHash;
    await assert.rejects(
      verifyExpansionPackV8ParentAction({
        action,
        runtime,
        suiClient: getObjectsClient(invalidObjects),
        async manifestReadback() {
          return {
            sha256: HASH('11'),
            version: '1',
            versionId: 'version-1',
            identity: 'parent-identity',
          };
        },
      }),
      (error) => error.code === 'EXPANSION_PACK_V8_HASH_INVALID',
    );
  }
  assert.deepEqual(await queryMakerReleaseEvidenceV5(
    getObjectsClient(parentObjects()),
    { rootId: id(1) },
  ), {
    rootId: id(1),
    parentVersion: '1',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: HASH('11'),
  });
  const lock = await queryIndependentExtensionLockV5(
    getObjectsClient(parentObjects()),
    { runtime, rootId: id(1) },
  );
  assert.match(lock.type, /::commerce_v5::IndependentExtensionLockStateV5$/);
  for (const [actual, expected] of [
    [lock.rootId, id(1)],
    [lock.authorityId, INDEPENDENT_EXTENSION_AUTHORITY],
    [lock.legacyMakerId, id(2)],
    [lock.protocolConfigId, id(6)],
    [lock.protocolAdminCapId, PROTOCOL_ADMIN_CAP],
    [lock.owner, id(9)],
    [lock.retiredControlCapId, RETIRED_CONTROL_CAP],
  ]) assert.equal(BigInt(actual), BigInt(expected));
  assert.equal(lock.retiredControlCapEpoch, 6n);
  assert.equal(lock.lockedOwnershipEpoch, 7n);
  assert.equal(lock.auditHash, AUDIT_HASH);
  assert.equal(lock.finalized, true);

  const drifted = parentObjects();
  drifted[2] = { ...drifted[2], json: { fields: {
    ...drifted[2].json.fields,
    audit_hash: BYTES('77'),
  } } };
  await assert.rejects(
    verifyExpansionPackV8ParentAction({
      action,
      runtime,
      suiClient: getObjectsClient(drifted),
      manifestReadback: async () => ({
        sha256: HASH('11'), version: '1', versionId: 'version-1', identity: 'parent-identity',
      }),
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH',
  );

  await assert.rejects(
    verifyExpansionPackV8ParentAction({
      action,
      runtime,
      suiClient: getObjectsClient(parentObjects(), {
        lockType: `${COMMERCE_ORIGIN}::commerce_v5::IndependentExtensionLockStateV5`,
      }),
      manifestReadback: async () => ({
        sha256: HASH('11'), version: '1', versionId: 'version-1', identity: 'parent-identity',
      }),
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_PARENT_LOCK_INVALID',
  );

  const addressOwnedAuthority = parentObjects();
  addressOwnedAuthority[2] = {
    ...addressOwnedAuthority[2],
    owner: { AddressOwner: id(9) },
  };
  await assert.rejects(
    verifyExpansionPackV8ParentAction({
      action,
      runtime,
      suiClient: getObjectsClient(addressOwnedAuthority),
      manifestReadback: async () => ({
        sha256: HASH('11'), version: '1', versionId: 'version-1', identity: 'parent-identity',
      }),
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH',
  );

  await assert.rejects(
    verifyExpansionPackV8ParentAction({
      action: {
        ...action,
        inputs: {
          ...action.inputs,
          independentExtensionAuthorityV5Id: id(72),
        },
      },
      runtime,
      suiClient: getObjectsClient(parentObjects()),
      manifestReadback: async () => ({
        sha256: HASH('11'), version: '1', versionId: 'version-1', identity: 'parent-identity',
      }),
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH',
  );

  for (const retiredControlCapState of ['omitted', 'unknown']) {
    await assert.rejects(
      verifyExpansionPackV8ParentAction({
        action,
        runtime,
        suiClient: getObjectsClient(parentObjects(), { retiredControlCapState }),
        manifestReadback: async () => ({
          sha256: HASH('11'), version: '1', versionId: 'version-1', identity: 'parent-identity',
        }),
      }),
      (error) => error.code === 'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH',
      `retired Cap state ${retiredControlCapState} is not deletion proof`,
    );
  }

  const liveRetiredCap = {
    objectId: RETIRED_CONTROL_CAP,
    type: `${COMMERCE_ORIGIN}::commerce_v5::MakerControlCapV5`,
    owner: { AddressOwner: id(9) },
    json: { fields: { version: '5', root_id: id(1), ownership_epoch: '6' } },
  };
  await assert.rejects(
    verifyExpansionPackV8ParentAction({
      action,
      runtime,
      suiClient: getObjectsClient([...parentObjects(), liveRetiredCap]),
      manifestReadback: async () => ({
        sha256: HASH('11'), version: '1', versionId: 'version-1', identity: 'parent-identity',
      }),
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH',
  );

  const active = parentObjects();
  active[0].json.fields.lifecycle = 0;
  await assert.rejects(
    verifyExpansionPackV8ParentAction({
      action,
      runtime,
      suiClient: getObjectsClient(active),
      manifestReadback: async () => ({
        sha256: HASH('11'), version: '1', versionId: 'version-1', identity: 'parent-identity',
      }),
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH',
  );
});

test('legacy parent evidence binding readback is not a v8 publication action', async () => {
  const action = publicationAction('bind_maker_release_evidence_v5', {
    baseMakerRootId: id(1),
    makerControlCapId: id(8),
    parentLegacyMakerId: id(2),
    parentVersion: '1',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: HASH('11'),
  }, {
    id: 'chain.parent.evidence.bind',
    target: `${CALLABLE}::commerce_v5::bind_maker_release_evidence_v5`,
  });
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action,
      submission: {
        transactionDigest: 'parent-evidence',
        indexed: { effects: { status: { status: 'success' } }, events: [] },
      },
      suiClient: getObjectsClient(parentObjects()),
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_CHAIN_TARGET_UNSUPPORTED' },
  );
});

test('legacy admission readback cannot masquerade as authority-bound admission', async () => {
  const legacyAdmission = publicationAction('admit_expansion_pack_v8', {
    packReleaseId: id(3),
    baseMakerRootId: id(1),
    parentLegacyMakerId: id(2),
    makerControlCapId: RETIRED_CONTROL_CAP,
  }, { id: 'chain.pack.admit' });
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action: legacyAdmission,
      submission: {
        transactionDigest: 'legacy-admission',
        indexed: { effects: { status: { status: 'success' } }, events: [] },
      },
      suiClient: getObjectsClient(parentObjects()),
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_CHAIN_TARGET_UNSUPPORTED' },
  );
});

test('create readback proves the exact three created objects, event and parent authority', async () => {
  const inputs = {
    baseMakerRootId: id(1),
    parentLegacyMakerId: id(2),
    parentVersion: '1',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: HASH('11'),
    packId: 'pack-1',
    packNamespace: 'maker.pack-1',
    packVersion: '1.0.0',
    manifestBlobId: 'pack-quilt',
    manifestSha256: HASH('22'),
    contentCommitment: HASH('33'),
    accessKind: 0,
    purchasePriceAtomic: '0',
  };
  const action = publicationAction('create_expansion_pack_v8', inputs, {
    id: 'chain.pack.create', typeArguments: [PAYMENT],
  });
  const client = getObjectsClient([
    releaseObject({
      manifest_bound: false,
      manifest_blob_id: '',
      manifest_sha256: [],
    }), capObject(), treasuryObject({
      json: { fields: {
        version: '8',
        release_id: id(3),
        revenue: '0',
        total_collected: '0',
        total_withdrawn: '0',
      } },
    }), ...parentObjects(),
  ]);
  client.getTransaction = async () => ({
    effects: { status: { success: true, error: null } },
    objectTypes: {
      [id(3)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackReleaseV8`,
      [id(4)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdminCapV8`,
      [id(5)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackTreasuryV8<${PAYMENT}>`,
    },
    events: [{
      eventType: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackCreatedV8`,
      json: {
        release_id: id(3),
        admin_cap_id: id(4),
        treasury_id: id(5),
        parent_root_id: id(1),
        parent_legacy_maker_id: id(2),
        pack_id: 'pack-1',
        pack_version: '1.0.0',
        creator: id(9),
        access_kind: 0,
        purchase_price_atomic: '0',
        content_commitment: BYTES('33'),
      },
    }],
  });
  const confirmation = await readExpansionPackV8PublicationSubmission({
    action,
    submission: { transactionDigest: 'create-digest' },
    suiClient: client,
    runtime,
  });
  assert.equal(confirmation.packReleaseId, id(3));
  assert.equal(confirmation.packAdminCapId, id(4));
  assert.equal(confirmation.packTreasuryId, id(5));
  assert.equal(confirmation.manifestBound, false);

  const missingStatus = { ...client, getTransaction: async () => ({
    objectTypes: {},
    events: [],
  }) };
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action,
      submission: { transactionDigest: 'missing-status' },
      suiClient: missingStatus,
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_CHAIN_EXECUTION_FAILED' },
  );

  const failedStatus = { ...client, getTransaction: async () => ({
    effects: { status: { success: false, error: 'move abort' } },
    objectTypes: {},
    events: [],
  }) };
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action,
      submission: { transactionDigest: 'failed-status' },
      suiClient: failedStatus,
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_CHAIN_EXECUTION_FAILED' },
  );

  const wrong = { ...client, getTransaction: async () => ({
    effects: { status: { status: 'success' } },
    objectTypes: {
      [id(3)]: `${CALLABLE}::expansion_pack_v8::ExpansionPackReleaseV8`,
      [id(4)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdminCapV8`,
      [id(5)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackTreasuryV8<${PAYMENT}>`,
    },
    events: [],
  }) };
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action,
      submission: { transactionDigest: 'wrong-origin' },
      suiClient: wrong,
      runtime,
    }),
    (error) => error.code === 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH',
  );
});

test('manifest binding readback proves one exact empty Draft binding before Style registration', async () => {
  const action = publicationAction('bind_expansion_pack_manifest_v8', {
    packReleaseId: id(3),
    packAdminCapId: id(4),
    manifestBlobId: 'pack-quilt',
    manifestSha256: HASH('22'),
  }, { id: 'chain.pack.manifest.bind' });
  const client = getObjectsClient([
    releaseObject({ manifest_bound: true }),
    capObject(),
  ]);
  client.getTransaction = async () => ({
    effects: { status: { status: 'success' } },
    events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackManifestBoundV8`,
      parsedJson: {
        release_id: id(3),
        manifest_blob_id: 'pack-quilt',
        manifest_sha256: BYTES('22'),
      },
    }],
  });
  const confirmation = await readExpansionPackV8PublicationSubmission({
    action,
    submission: { transactionDigest: 'manifest-bind' },
    suiClient: client,
    runtime,
  });
  assert.equal(confirmation.manifestBound, true);
  assert.equal(confirmation.manifestBlobId, 'pack-quilt');
  assert.equal(confirmation.manifestSha256, HASH('22'));
});

test('paid Seal policy readback requires the release-scoped commitment', async () => {
  const scopedCommitment = (
    await deriveExpansionPackSealReleaseCommitmentV8({
      releaseId: id(3),
      contentCommitment: HASH('33'),
    })
  ).id.replace(/^0x/i, '').toLowerCase();
  const action = publicationAction('bind_expansion_pack_seal_policy_v8', {
    packReleaseId: id(3),
    packAdminCapId: id(4),
    sealPackageId: TYPE_ORIGIN,
  }, { id: 'chain.pack.seal-policy.bind' });
  const client = getObjectsClient([
    releaseObject({
      lifecycle: EXPANSION_PACK_V8_LIFECYCLE.SEALED,
      style_count: '1',
      style_registry_commitment: BYTES('55'),
      seal_policy_id: { vec: [id(3)] },
      seal_package_id: { vec: [TYPE_ORIGIN] },
      seal_release_commitment: [...Buffer.from(scopedCommitment, 'hex')],
    }),
    capObject(),
  ]);
  client.getTransaction = async () => ({
    effects: { status: { status: 'success' } },
    events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackSealPolicyBoundV8`,
      parsedJson: {
        release_id: id(3),
        seal_policy_id: id(3),
        seal_package_id: TYPE_ORIGIN,
        seal_release_commitment: [...Buffer.from(scopedCommitment, 'hex')],
      },
    }],
  });
  const confirmation = await readExpansionPackV8PublicationSubmission({
    action,
    submission: { transactionDigest: 'policy-bind' },
    suiClient: client,
    runtime,
  });
  assert.equal(confirmation.sealPolicyBound, true);
  assert.equal(BigInt(confirmation.sealPackageId), BigInt(TYPE_ORIGIN));
  assert.equal(confirmation.sealReleaseCommitment, scopedCommitment);

  const wrong = getObjectsClient([
    releaseObject({
      lifecycle: EXPANSION_PACK_V8_LIFECYCLE.SEALED,
      style_count: '1',
      style_registry_commitment: BYTES('55'),
      seal_policy_id: { vec: [id(3)] },
      seal_package_id: { vec: [TYPE_ORIGIN] },
      seal_release_commitment: BYTES('33'),
    }),
    capObject(),
  ]);
  wrong.getTransaction = client.getTransaction;
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action,
      submission: { transactionDigest: 'policy-bind-wrong' },
      suiClient: wrong,
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH' },
  );
});

test('Style, seal, admission and activation readbacks reject drift and expose recovery outputs', async () => {
  const styleRelease = releaseObject({ style_count: '1' });
  const styleAction = publicationAction('register_style_asset_v8', {
    packReleaseId: id(3),
    packAdminCapId: id(4),
    partKey: 'hair',
    itemKey: 'long',
    styleKey: 'black',
    assetBlobId: 'style-patch',
    assetSha256: HASH('44'),
    assetSealId: '',
  }, { id: 'chain.pack.style.register.fixture' });
  const styleResult = await readExpansionPackV8PublicationSubmission({
    action: styleAction,
    submission: { transactionDigest: 'style', indexed: {
      effects: { status: { status: 'success' } }, events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackStyleRegisteredV8`,
      parsedJson: {
        release_id: id(3),
        part_key: 'hair',
        item_key: 'long',
        style_key: 'black',
        asset_blob_id: 'style-patch',
        asset_sha256: BYTES('44'),
        asset_seal_id: [],
      },
    }] } },
    suiClient: {
      ...getObjectsClient([styleRelease, capObject()]),
      async getDynamicField(request) {
        assert.equal(BigInt(request.parentId), 0x81n);
        return { dynamicField: { value: { bcs: bcs.struct('StyleAssetRecordV8', {
          asset_blob_id: bcs.string(),
          asset_sha256: bcs.byteVector(),
          asset_seal_id: bcs.byteVector(),
        }).serialize({
          asset_blob_id: 'style-patch',
          asset_sha256: BYTES('44'),
          asset_seal_id: [],
        }).toBytes() } } };
      },
    },
    runtime,
  });
  assert.equal(styleResult.styleRegistered, true);

  const sealedRelease = releaseObject({
    lifecycle: EXPANSION_PACK_V8_LIFECYCLE.SEALED,
    style_count: '1',
    style_registry_commitment: BYTES('55'),
  });
  const sealResult = await readExpansionPackV8PublicationSubmission({
    action: publicationAction('seal_expansion_pack_v8', {
      packReleaseId: id(3), packAdminCapId: id(4), styleRegistryCommitment: HASH('55'),
    }, { id: 'chain.pack.seal' }),
    submission: { transactionDigest: 'seal', indexed: {
      effects: { status: { status: 'success' } }, events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackSealedV8`,
      parsedJson: { release_id: id(3), style_count: '1', style_registry_commitment: BYTES('55') },
    }] } },
    suiClient: getObjectsClient([sealedRelease, capObject()]),
    runtime,
  });
  assert.equal(sealResult.sealed, true);

  const admittedRelease = releaseObject({
    lifecycle: EXPANSION_PACK_V8_LIFECYCLE.ADMITTED,
    style_count: '1',
    style_registry_commitment: BYTES('55'),
    admitted_by: id(9),
    admitted_parent_ownership_epoch: '7',
  });
  const admittedResult = await readExpansionPackV8PublicationSubmission({
    action: publicationAction('admit_expansion_pack_with_authority_v8', {
      packReleaseId: id(3),
      baseMakerRootId: id(1),
      parentLegacyMakerId: id(2),
      independentExtensionAuthorityV5Id: INDEPENDENT_EXTENSION_AUTHORITY,
      parentVersion: '1',
      parentManifestBlobId: 'parent-quilt',
      parentManifestSha256: HASH('11'),
    }, { id: 'chain.pack.admit' }),
    submission: { transactionDigest: 'admit', indexed: {
      effects: { status: { status: 'success' } }, events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdmittedV8`,
      parsedJson: {
        release_id: id(3),
        parent_root_id: id(1),
        parent_legacy_maker_id: id(2),
        admitted_by: id(9),
        parent_ownership_epoch: '7',
        parent_version: '1',
        parent_manifest_blob_id: 'parent-quilt',
        parent_manifest_sha256: BYTES('11'),
      },
    }] } },
    suiClient: getObjectsClient([admittedRelease, ...parentObjects()]),
    runtime,
  });
  assert.equal(admittedResult.parentBindingVerified, true);
  assert.equal(admittedResult.parentOwnershipEpoch, '7');
  assert.equal(admittedResult.admittedParentOwnershipEpoch, '7');

  const activeRelease = releaseObject({
    lifecycle: EXPANSION_PACK_V8_LIFECYCLE.ACTIVE,
    style_count: '1',
    style_registry_commitment: BYTES('55'),
    admitted_by: id(9),
    admitted_parent_ownership_epoch: '7',
  });
  const activeResult = await readExpansionPackV8PublicationSubmission({
    action: publicationAction('activate_expansion_pack_v8', {
      packReleaseId: id(3),
      packAdminCapId: id(4),
      baseMakerRootId: id(1),
      commerceProtocolConfigV5Id: id(6),
    }, { id: 'chain.pack.activate' }),
    submission: { transactionDigest: 'activate', indexed: {
      effects: { status: { status: 'success' } }, events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackLifecycleChangedV8`,
      parsedJson: { release_id: id(3), previous_lifecycle: 2, lifecycle: 3 },
    }] } },
    suiClient: getObjectsClient([activeRelease, capObject(), parentObjects()[0]]),
    runtime,
  });
  assert.equal(activeResult.lifecycleState, 'ACTIVE');

  const activeParent = parentObjects()[0];
  activeParent.json.fields.lifecycle = 0;
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action: publicationAction('activate_expansion_pack_v8', {
        packReleaseId: id(3),
        packAdminCapId: id(4),
        baseMakerRootId: id(1),
        commerceProtocolConfigV5Id: id(6),
      }, { id: 'chain.pack.activate' }),
      submission: { transactionDigest: 'activate-active-parent', indexed: {
        effects: { status: { status: 'success' } }, events: [{
        type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackLifecycleChangedV8`,
        parsedJson: { release_id: id(3), previous_lifecycle: 2, lifecycle: 3 },
      }] } },
      suiClient: getObjectsClient([activeRelease, capObject(), activeParent]),
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_PARENT_READBACK_MISMATCH' },
  );
});

test('FREE claim readback binds the created Pass and entitlement event to the active current parent epoch', async () => {
  const action = publicationAction('claim_free_expansion_pack_v8', {
    packReleaseId: id(3),
    baseMakerRootId: id(1),
    commerceProtocolConfigV5Id: id(6),
    clockObjectId: '0x6',
  }, { id: 'chain.pack.claim.free' });
  const release = releaseObject({
    lifecycle: EXPANSION_PACK_V8_LIFECYCLE.ACTIVE,
    style_count: '1',
    style_registry_commitment: BYTES('55'),
    admitted_by: id(9),
    admitted_parent_ownership_epoch: '7',
    entitlement_count: '1',
  });
  const pass = passObject({}, { objectId: '0x44' });
  const client = getObjectsClient([release, pass]);
  client.getTransaction = async () => ({
    effects: { status: { success: true, error: null } },
    objectTypes: {
      '0x44': `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackPassV8`,
    },
    events: [{
      eventType: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackEntitlementGrantedV8`,
      json: {
        release_id: id(3),
        parent_root_id: id(1),
        holder: id(9),
        paid_atomic: '0',
        pass_id: '0x44',
        admitted_parent_ownership_epoch: '7',
      },
    }],
  });
  const confirmation = await readExpansionPackV8PublicationSubmission({
    action,
    submission: { transactionDigest: 'claim-free' },
    suiClient: client,
    runtime,
  });
  assert.equal(confirmation.passId, '0x44');
  assert.equal(confirmation.holder, id(9));
  assert.equal(confirmation.paidAtomic, '0');
  assert.equal(confirmation.issuedAtMs, '1234');
  assert.equal(confirmation.admittedParentOwnershipEpoch, '7');
  assert.equal(confirmation.entitlementCount, '1');

  const staleEvent = { ...client, getTransaction: async () => ({
    effects: { status: { status: 'success' } },
    objectTypes: { '0x44': `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackPassV8` },
    events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackEntitlementGrantedV8`,
      parsedJson: {
        release_id: id(3),
        parent_root_id: id(1),
        holder: id(9),
        paid_atomic: '0',
        pass_id: '0x44',
        admitted_parent_ownership_epoch: '6',
      },
    }],
  }) };
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action,
      submission: { transactionDigest: 'claim-stale' },
      suiClient: staleEvent,
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_CHAIN_READBACK_MISMATCH' },
  );
});

test('stable-origin release discovery and wallet Pass query reject event/object substitutions', async () => {
  const release = releaseObject({
    lifecycle: EXPANSION_PACK_V8_LIFECYCLE.ACTIVE,
    style_registry_commitment: BYTES('55'),
    admitted_by: id(9),
    admitted_parent_ownership_epoch: '7',
  });
  const pass = passObject();
  const client = getObjectsClient([release]);
  client.queryEvents = async () => ({
    data: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdmittedV8`,
      parsedJson: {
        release_id: id(3),
        parent_root_id: id(1),
        parent_legacy_maker_id: id(2),
        admitted_by: id(9),
        parent_ownership_epoch: '7',
        parent_version: '1',
        parent_manifest_blob_id: 'parent-quilt',
        parent_manifest_sha256: BYTES('11'),
      },
    }],
    hasNextPage: false,
  });
  client.listOwnedObjects = async (request) => {
    assert.equal(request.type.includes('ExpansionPackPassV8'), true);
    return { objects: [pass], hasNextPage: false };
  };
  const releases = await queryExpansionPackReleasesV8(client, { runtime, parentRootId: id(1) });
  const passes = await queryOwnedExpansionPackPassesV8(client, {
    runtime, owner: id(9), releaseId: id(3),
  });
  assert.equal(releases.length, 1);
  assert.equal(passes.length, 1);

  const wrongClient = { ...client, queryEvents: async () => ({
    data: [{
      type: `${CALLABLE}::expansion_pack_v8::ExpansionPackAdmittedV8`,
      parsedJson: { release_id: id(3) },
    }],
    hasNextPage: false,
  }) };
  await assert.rejects(
    queryExpansionPackReleasesV8(wrongClient, { runtime }),
    (error) => error.code === 'EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH',
  );
});

test('trusted release discovery queries admission events and rejects Created substitution', async () => {
  let eventQueries = 0;
  const client = {
    ...getObjectsClient([]),
    async queryEvents(request) {
      eventQueries += 1;
      const [packageId, moduleName, eventName] = request.query.MoveEventType.split('::');
      assert.equal(BigInt(packageId), BigInt(TYPE_ORIGIN));
      assert.equal(moduleName, 'expansion_pack_v8');
      assert.equal(eventName, 'ExpansionPackAdmittedV8');
      assert.equal(request.order, 'descending');
      assert.equal(request.cursor, null);
      return {
        data: [admittedEvent(
          id(3),
          {},
          `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackCreatedV8`,
        )],
        hasNextPage: false,
      };
    },
  };

  await assert.rejects(
    queryExpansionPackReleasesV8(client, { runtime }),
    { code: 'EXPANSION_PACK_V8_TYPE_ORIGIN_MISMATCH' },
  );
  assert.equal(eventQueries, 1);
});

test('trusted discovery applies creator filtering and limit only after paginated current-object verification', async () => {
  const releaseIds = [id('a1'), id('a2'), id('a3')];
  const releases = [
    releaseObject({
      creator: id('f1'),
      admitted_by: id(9),
      admitted_parent_ownership_epoch: '7',
    }, { objectId: releaseIds[0] }),
    releaseObject({
      creator: id(9),
      admitted_by: id(9),
      admitted_parent_ownership_epoch: '7',
    }, { objectId: releaseIds[1] }),
    releaseObject({
      creator: id(9),
      admitted_by: id(9),
      admitted_parent_ownership_epoch: '7',
    }, { objectId: releaseIds[2] }),
  ];
  const requestedObjectIds = [];
  const client = getObjectsClient(releases);
  const getObjects = client.getObjects.bind(client);
  client.getObjects = async (request) => {
    requestedObjectIds.push(...request.objectIds);
    return getObjects(request);
  };
  client.queryEvents = async (request) => {
    if (request.cursor === null) {
      return {
        data: [admittedEvent(releaseIds[0])],
        hasNextPage: true,
        nextCursor: 'page-2',
      };
    }
    assert.equal(request.cursor, 'page-2');
    return {
      data: [admittedEvent(releaseIds[1]), admittedEvent(releaseIds[2])],
      hasNextPage: false,
    };
  };

  const discovered = await queryExpansionPackReleasesV8(client, {
    runtime,
    creator: id(9),
    limit: 1,
  });

  assert.deepEqual(requestedObjectIds, releaseIds);
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].objectId, releaseIds[1]);
  assert.equal(discovered[0].creator, id(9));
});

test('trusted discovery preserves the newest admission when a release was re-admitted', async () => {
  const currentRelease = releaseObject({
    admitted_by: id(9),
    admitted_parent_ownership_epoch: '7',
  });
  const client = getObjectsClient([currentRelease]);
  client.queryEvents = async (request) => {
    if (request.cursor === null) {
      return {
        data: [admittedEvent()],
        hasNextPage: true,
        nextCursor: 'older',
      };
    }
    assert.equal(request.cursor, 'older');
    return {
      data: [admittedEvent(id(3), {
        admitted_by: id(8),
        parent_ownership_epoch: '6',
      })],
      hasNextPage: false,
    };
  };

  const discovered = await queryExpansionPackReleasesV8(client, { runtime });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].admittedBy, id(9));
  assert.equal(discovered[0].admittedParentOwnershipEpoch, 7n);
});

test('trusted discovery fails closed at a bounded global admission scan budget', async () => {
  let queries = 0;
  let objectReads = 0;
  const client = {
    async queryEvents(request) {
      queries += 1;
      assert.equal(request.limit, 1);
      return {
        data: [admittedEvent(id(8), { parent_root_id: id(7) })],
        hasNextPage: true,
        nextCursor: 'older-events-remain',
      };
    },
    async getObjects() {
      objectReads += 1;
      return { objects: [] };
    },
  };
  await assert.rejects(
    queryExpansionPackReleasesV8(client, {
      runtime,
      parentRootId: id(1),
      scanLimit: 1,
    }),
    (error) => error?.code === 'EXPANSION_PACK_V8_DISCOVERY_SCAN_LIMIT'
      && error?.details?.scannedEvents === 1,
  );
  assert.equal(queries, 1);
  assert.equal(objectReads, 0);
});

test('trusted discovery rejects every mismatched admission field', async () => {
  const mismatches = [
    ['parent root', { parent_root_id: id('f1') }],
    ['parent legacy Maker', { parent_legacy_maker_id: id('f2') }],
    ['admitting wallet', { admitted_by: id('f3') }],
    ['parent ownership epoch', { parent_ownership_epoch: '8' }],
    ['parent version', { parent_version: '2' }],
    ['parent manifest Blob ID', { parent_manifest_blob_id: 'other-parent-quilt' }],
    ['parent manifest SHA-256', { parent_manifest_sha256: BYTES('22') }],
  ];
  const release = releaseObject({
    admitted_by: id(9),
    admitted_parent_ownership_epoch: '7',
  });

  for (const [label, overrides] of mismatches) {
    const client = getObjectsClient([release]);
    client.queryEvents = async () => ({
      data: [admittedEvent(id(3), overrides)],
      hasNextPage: false,
    });
    await assert.rejects(
      queryExpansionPackReleasesV8(client, { runtime }),
      (error) => {
        assert.equal(error.code, 'EXPANSION_PACK_V8_DISCOVERY_MISMATCH', label);
        return true;
      },
    );
  }
});

test('public Player Style queries require the complete sealed key set and exact BCS rows', async () => {
  const release = parseExpansionPackReleaseV8(releaseObject({ style_count: '1' }), { runtime });
  const rows = await queryExpansionPackStyleRecordsV8({
    async getDynamicField(request) {
      assert.equal(BigInt(request.parentId), 0x81n);
      return { dynamicField: { value: { bcs: bcs.struct('StyleAssetRecordV8', {
        asset_blob_id: bcs.string(),
        asset_sha256: bcs.byteVector(),
        asset_seal_id: bcs.byteVector(),
      }).serialize({
        asset_blob_id: 'style-patch',
        asset_sha256: BYTES('44'),
        asset_seal_id: [],
      }).toBytes() } } };
    },
  }, {
    runtime,
    release,
    styles: [{ partKey: 'hair', itemKey: 'long', styleKey: 'black' }],
  });
  assert.deepEqual(rows[0], {
    partKey: 'hair',
    itemKey: 'long',
    styleKey: 'black',
    assetBlobId: 'style-patch',
    assetSha256: HASH('44'),
    assetSealId: '',
  });
  await assert.rejects(
    queryExpansionPackStyleRecordsV8({ getDynamicField() {} }, {
      runtime,
      release,
      styles: [],
    }),
    { code: 'EXPANSION_PACK_V8_STYLE_QUERY_MISMATCH' },
  );
});
