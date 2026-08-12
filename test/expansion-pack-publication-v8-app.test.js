import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { deriveExpansionPackSealReleaseCommitmentV8 } from '../maker-seal-v5.js';
import {
  EXPANSION_PACK_V8_LIFECYCLE,
  buildArchiveExpansionPackV8,
  buildClaimFreeExpansionPackV8,
  buildExpansionPackStyleSealApprovalV8,
  buildPauseExpansionPackV8,
  buildPurchaseExpansionPackV8,
  buildResumeExpansionPackV8,
  buildWithdrawExpansionPackRevenueV8,
  parseExpansionPackPassV8,
  parseExpansionPackReleaseV8,
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
const PAYMENT = '0xe::usdc::USDC';
const HASH = (byte) => byte.repeat(32);
const BYTES = (byte) => Array(32).fill(Number.parseInt(byte, 16));
const id = (value) => `0x${value}`;

const runtime = Object.freeze({
  expansionPackV8TypeOriginPackageId: TYPE_ORIGIN,
  expansionPackV8CallablePackageId: CALLABLE,
  commerceV5TypeOriginPackageId: COMMERCE_ORIGIN,
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
        lifecycle: 0,
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
      objectId: id(8),
      type: `${COMMERCE_ORIGIN}::commerce_v5::MakerControlCapV5`,
      owner: { AddressOwner: id(9) },
      json: { fields: { root_id: id(1), ownership_epoch: '7' } },
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

function getObjectsClient(objects) {
  const values = [...objects];
  return {
    async getObjects(request) {
      return {
        objects: request.objectIds.map((requested) => values.find((entry) => {
          const left = BigInt(entry.objectId);
          const right = BigInt(requested);
          return left === right;
        })).filter(Boolean),
      };
    },
    async getDynamicField(request) {
      if (BigInt(request.parentId) !== 1n) throw new Error('dynamic field not found');
      return { dynamicField: { value: { bcs: parentEvidenceBytes() } } };
    },
  };
}

function publicationAction(functionName, inputs, extra = {}) {
  return {
    id: extra.id || `fixture.${functionName}`,
    transport: 'SUI',
    target: extra.target || `${CALLABLE}::expansion_pack_v8::${functionName}`,
    authority: { signer: id(9), capability: id(8) },
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
    makerControlCapId: id(8),
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
    admit_expansion_pack_v8: 4,
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
  const bindParent = transactionFromExpansionPackV8PublicationAction(publicationAction(
    'bind_maker_release_evidence_v5',
    common,
    { target: `${CALLABLE}::commerce_v5::bind_maker_release_evidence_v5` },
  )).getData().commands[0].MoveCall;
  assert.equal(bindParent.module, 'commerce_v5');
  assert.equal(bindParent.function, 'bind_maker_release_evidence_v5');
  assert.equal(bindParent.arguments.length, 6);
  assert.ok(bindParent.arguments.slice(0, 3).every((entry) => entry.type === 'object'));
  assert.ok(bindParent.arguments.slice(3).every((entry) => entry.type === 'pure'));
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

test('parent verifier requires the exact root, legacy Maker, current Cap and Walrus evidence', async () => {
  const action = {
    id: 'parent.release.verify',
    authority: { signer: id(9) },
    inputs: {
      baseMakerRootId: id(1),
      parentLegacyMakerId: id(2),
      makerControlCapId: id(8),
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
  assert.equal(verified.makerControlCapVerified, true);
  assert.equal(verified.parentReleaseEvidenceBound, true);
  assert.deepEqual(await queryMakerReleaseEvidenceV5(
    getObjectsClient(parentObjects()),
    { rootId: id(1) },
  ), {
    rootId: id(1),
    parentVersion: '1',
    parentManifestBlobId: 'parent-quilt',
    parentManifestSha256: HASH('11'),
  });

  const drifted = parentObjects();
  drifted[2] = { ...drifted[2], owner: { AddressOwner: '0x66' } };
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
});

test('parent evidence binding readback requires the exact Root-owned tuple', async () => {
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
  const confirmation = await readExpansionPackV8PublicationSubmission({
    action,
    submission: {
      transactionDigest: 'parent-evidence',
      indexed: { effects: { status: { status: 'success' } }, events: [] },
    },
    suiClient: getObjectsClient(parentObjects()),
    runtime,
  });
  assert.equal(confirmation.parentReleaseEvidenceBound, true);
  assert.equal(confirmation.parentEvidenceReadbackVerified, true);
  assert.equal(confirmation.parentManifestSha256, HASH('11'));

  const mismatch = getObjectsClient(parentObjects());
  mismatch.getDynamicField = async () => ({
    dynamicField: { value: { bcs: parentEvidenceBytes({ manifest_sha256: BYTES('22') }) } },
  });
  await assert.rejects(
    readExpansionPackV8PublicationSubmission({
      action,
      submission: {
        transactionDigest: 'parent-evidence-mismatch',
        indexed: { effects: { status: { status: 'success' } }, events: [] },
      },
      suiClient: mismatch,
      runtime,
    }),
    { code: 'EXPANSION_PACK_V8_PARENT_EVIDENCE_MISMATCH' },
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
    }), capObject(), treasuryObject(), ...parentObjects(),
  ]);
  client.getTransaction = async () => ({
    effects: { status: { status: 'success' } },
    objectTypes: {
      [id(3)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackReleaseV8`,
      [id(4)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackAdminCapV8`,
      [id(5)]: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackTreasuryV8<${PAYMENT}>`,
    },
    events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackCreatedV8`,
      parsedJson: {
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

  const wrong = { ...client, getTransaction: async () => ({
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
    submission: { transactionDigest: 'style', indexed: { events: [{
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
    submission: { transactionDigest: 'seal', indexed: { events: [{
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
    action: publicationAction('admit_expansion_pack_v8', {
      packReleaseId: id(3),
      baseMakerRootId: id(1),
      parentLegacyMakerId: id(2),
      makerControlCapId: id(8),
      parentVersion: '1',
      parentManifestBlobId: 'parent-quilt',
      parentManifestSha256: HASH('11'),
    }, { id: 'chain.pack.admit' }),
    submission: { transactionDigest: 'admit', indexed: { events: [{
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
    submission: { transactionDigest: 'activate', indexed: { events: [{
      type: `${TYPE_ORIGIN}::expansion_pack_v8::ExpansionPackLifecycleChangedV8`,
      parsedJson: { release_id: id(3), previous_lifecycle: 2, lifecycle: 3 },
    }] } },
    suiClient: getObjectsClient([activeRelease, capObject(), parentObjects()[0]]),
    runtime,
  });
  assert.equal(activeResult.lifecycleState, 'ACTIVE');
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
