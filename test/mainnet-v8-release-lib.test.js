import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase58, toBase64 } from '@mysten/sui/utils';

import {
  MAINNET_V8_ABI_ARTIFACT_DOMAIN,
  MAINNET_V8_CHAIN_IDENTIFIER,
  MAINNET_V8_ENCRYPTION_POLICY_DOMAIN,
  MAINNET_V8_KEY_SERVER_SET_DOMAIN,
  MAINNET_V8_LEGACY_CHAIN_IDENTIFIER,
  MAINNET_V8_PACKAGE_NAMES,
  MAINNET_V8_PAYMENT_COIN_TYPE,
  MAINNET_V8_DEFAULT_COMMITTEE,
  MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
  MAINNET_V8_DEFAULT_COMMITTEE_OWNER,
  MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
  MAINNET_V8_RELEASE_SIGNER,
  MAINNET_V8_SUI_BINARY_SHA256,
  MAINNET_V8_RELEASE_STEPS,
  MAINNET_V8_ROLE_DEPENDENCIES,
  MAINNET_V8_ROLE_ORDER,
  MAINNET_V8_SOURCE_ARTIFACT_DOMAIN,
  MAINNET_V8_SUI_SOURCE_COMMIT,
  MAINNET_V8_SUI_VERSION,
  MAINNET_V8_SUI_VERSION_OUTPUT,
  MAINNET_V8_WAL_EVIDENCE_SCHEMA,
  MAINNET_V8_WAL_LOCK_LEASE_MS,
  MainnetV8ReleaseError,
  appendReleaseWal,
  appendMainnetV8ReleaseWal,
  assertMainnetV8AbiArtifact,
  assertMainnetV8DeterministicJson,
  assertMainnetV8PackageArtifact,
  assertMainnetV8ReleasePlan,
  assertMainnetV8FinalSealPolicy,
  assertMainnetV8SealPolicy,
  assertMainnetV8SourceArtifact,
  buildMainnetV8AbiArtifact,
  buildMainnetV8PackageArtifact,
  buildMainnetV8ReleasePlan,
  buildMainnetV8ReadyEvidence,
  buildMainnetV8FinalSealPolicy,
  buildMainnetV8SealPolicy,
  buildMainnetV8SignedEvidence,
  buildMainnetV8OutcomeEvidence,
  buildMainnetV8FinalManifest,
  buildMainnetV8ManifestEvidence,
  buildMainnetV8SourceArtifact,
  canonicalMainnetV8Json,
  compareMainnetV8Text,
  computeExecutionPlanId,
  createReleaseWal,
  createMainnetV8ReleaseWal,
  mainnetV8AbiCommitment,
  mainnetV8PackageCommitment,
  mainnetV8PackageModuleRecord,
  mainnetV8SourceCommitment,
  mainnetV8SourceFileRecord,
  mainnetV8TypedDigest,
  parseMainnetV8PublishedToml,
  readMainnetV8ReleaseWal,
  readReleaseWal,
  renderMainnetV8PublishedToml,
  sha256MainnetV8Bytes,
  sha256MainnetV8Json,
  sha256Bytes,
  sha256Hex,
} from '../scripts/mainnet-v8-release-lib.mjs';

const id = (byte) => `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => structuredClone(value);
const sourceRevision = Object.freeze({ gitCommit: 'a'.repeat(40), gitTree: 'b'.repeat(40), clean: true });
const toolchain = Object.freeze({
  suiVersion: '1.77.2',
  suiVersionOutput: 'sui 1.77.2-51d177ad7d65',
  suiSourceCommit: '51d177ad7d65102fc368b582408f466d97b31548',
  suiBinarySha256: MAINNET_V8_SUI_BINARY_SHA256,
  frameworkRevision: '73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1',
});
const sender = MAINNET_V8_RELEASE_SIGNER;
const transactionKind = { ProgrammableTransaction: { inputs: [], commands: [] } };
const transactionKindBytes = bcs.TransactionKind.serialize(transactionKind).toBytes();
const transactionBytes = bcs.TransactionData.serialize({
  V1: {
    kind: transactionKind,
    sender,
    gasData: {
      payment: [],
      owner: sender,
      price: '1',
      budget: '1000',
    },
    expiration: {
      ValidDuring: {
        minEpoch: '999', maxEpoch: '1000', minTimestamp: null, maxTimestamp: null,
        chain: MAINNET_V8_CHAIN_IDENTIFIER, nonce: 42,
      },
    },
  },
}).toBytes();
const parsedTransaction = bcs.TransactionData.parse(transactionBytes);
const unsignedEnvelope = Object.freeze({
  transactionBase64: toBase64(transactionBytes),
  transactionByteLength: String(transactionBytes.length),
  transactionSha256: sha256Hex(transactionBytes),
  transactionKindBase64: toBase64(transactionKindBytes),
  transactionKindSha256: sha256Hex(transactionKindBytes),
  digest: TransactionDataBuilder.getDigestFromBytes(transactionBytes),
  sender,
  gasOwner: sender,
  gasBudget: '1000',
  gasPrice: '1',
  expiration: parsedTransaction.V1.expiration,
});
const signatureBytes = Uint8Array.of(0, ...new Uint8Array(96).fill(0x55));
const signature = toBase64(signatureBytes);
const senderSignedDataBytes = bcs.SenderSignedData.serialize([{
  intentMessage: {
    intent: {
      scope: { TransactionData: true },
      version: { V0: true },
      appId: { Sui: true },
    },
    value: parsedTransaction,
  },
  txSignatures: [signature],
}]).toBytes();
const signedArtifact = Object.freeze({
  transactionBase64: unsignedEnvelope.transactionBase64,
  transactionSha256: unsignedEnvelope.transactionSha256,
  transactionKindBase64: unsignedEnvelope.transactionKindBase64,
  transactionKindSha256: unsignedEnvelope.transactionKindSha256,
  digest: unsignedEnvelope.digest,
  signature,
  signatureSha256: sha256Hex(signatureBytes),
  senderSignedDataBase64: toBase64(senderSignedDataBytes),
  senderSignedDataSha256: sha256Hex(senderSignedDataBytes),
  signer: sender,
});

const protocolProfile = Object.freeze({
  chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER,
  protocolVersion: '133',
  epoch: '999',
  gasPrice: unsignedEnvelope.gasPrice,
  attributes: Object.freeze({
    objectRuntimeMaxNumCachedObjects: '1000',
    objectRuntimeMaxNumStoreEntries: '1000',
  }),
});
const TEST_SUI_EVENT_BCS = bcs.struct('MainnetV8ReleaseTestSuiEvent', {
  package_id: bcs.Address,
  transaction_module: bcs.string(),
  sender: bcs.Address,
  event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()),
});
const TEST_SUI_TRANSACTION_EVENTS_BCS = bcs.struct('MainnetV8ReleaseTestTransactionEvents', {
  data: bcs.vector(TEST_SUI_EVENT_BCS),
});
const TEST_PROTOCOL_CONFIG_COMMITMENT_INPUT_BCS = bcs.struct('MainnetV8ReleaseTestProtocolCommitment', {
  domain: bcs.byteVector(),
  version: bcs.u64(),
  config_id: bcs.Address,
  core_original_package_id: bcs.Address,
  core_callable_package_id: bcs.Address,
  revision: bcs.u64(),
  treasury_id: bcs.option(bcs.Address),
  payment_coin_type: bcs.string(),
  primary_content_fee_bps: bcs.u16(),
  fixed_complete_fee_atomic: bcs.u64(),
  maker_market_fee_bps: bcs.u16(),
  soul_market_fee_bps: bcs.u16(),
  enabled: bcs.bool(),
});
const TEST_PROTOCOL_TREASURY_INITIALIZED_EVENT_BCS = bcs.struct(
  'MainnetV8ReleaseTestTreasuryInitialized', {
    config_id: bcs.Address,
    treasury_id: bcs.Address,
    revision: bcs.u64(),
    commitment: bcs.byteVector(),
  },
);
const TEST_PROTOCOL_ENABLED_CHANGED_EVENT_BCS = bcs.struct('MainnetV8ReleaseTestProtocolEnabled', {
  config_id: bcs.Address,
  revision: bcs.u64(),
  enabled: bcs.bool(),
  commitment: bcs.byteVector(),
});
const TEST_SEAL_POLICY_CREATED_EVENT_BCS = bcs.struct('MainnetV8ReleaseTestSealPolicyCreated', {
  config_id: bcs.Address,
  catalog_id: bcs.Address,
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const TEST_UPGRADE_CAP_BCS = bcs.struct('MainnetV8ReleaseTestUpgradeCap', {
  id: bcs.Address,
  package: bcs.Address,
  version: bcs.u64(),
  policy: bcs.u8(),
});
const TEST_PROTOCOL_CONFIG_BCS = bcs.struct('MainnetV8ReleaseTestProtocolConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  core_original_package_id: bcs.Address,
  core_callable_package_id: bcs.Address,
  revision: bcs.u64(),
  treasury_id: bcs.option(bcs.Address),
  payment_coin_type: bcs.string(),
  primary_content_fee_bps: bcs.u16(),
  fixed_complete_fee_atomic: bcs.u64(),
  maker_market_fee_bps: bcs.u16(),
  soul_market_fee_bps: bcs.u16(),
  enabled: bcs.bool(),
  commitment: bcs.byteVector(),
});
const TEST_PROTOCOL_ADMIN_CAP_BCS = bcs.struct('MainnetV8ReleaseTestProtocolAdminCap', {
  id: bcs.Address,
  version: bcs.u64(),
  config_id: bcs.Address,
});
const TEST_PROTOCOL_TREASURY_BCS = bcs.struct('MainnetV8ReleaseTestProtocolTreasury', {
  id: bcs.Address,
  version: bcs.u64(),
  config_id: bcs.Address,
  revenue: bcs.struct('MainnetV8ReleaseTestProtocolBalance', { value: bcs.u64() }),
  total_collected: bcs.u128(),
  total_withdrawn: bcs.u128(),
});
const TEST_PACKAGE_CALL_CAP_BCS = bcs.struct('MainnetV8ReleaseTestPackageCallCap', {
  version: bcs.u64(),
  authority_id: bcs.Address,
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  role_binding_commitment: bcs.byteVector(),
  call_cap_set_commitment: bcs.byteVector(),
});
const TEST_EXACT_PACKAGE_BINDING_BCS = bcs.struct('MainnetV8ReleaseTestExactBinding', {
  original_package_id: bcs.Address,
  callable_package_id: bcs.Address,
  source_commitment: bcs.byteVector(),
  package_commitment: bcs.byteVector(),
  abi_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const TEST_PRODUCT_RELEASE_BINDING_BCS = bcs.struct('MainnetV8ReleaseTestProductBinding', {
  version: bcs.u64(),
  native_capability_mask: bcs.u64(),
  core: TEST_EXACT_PACKAGE_BINDING_BCS,
  seal: TEST_EXACT_PACKAGE_BINDING_BCS,
  runtime: TEST_EXACT_PACKAGE_BINDING_BCS,
  output: TEST_EXACT_PACKAGE_BINDING_BCS,
  physical: TEST_EXACT_PACKAGE_BINDING_BCS,
  market: TEST_EXACT_PACKAGE_BINDING_BCS,
  release: TEST_EXACT_PACKAGE_BINDING_BCS,
  commitment: bcs.byteVector(),
});
const TEST_PACKAGE_CALL_CAP_SET_BCS = bcs.struct('MainnetV8ReleaseTestCallCapSet', {
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  seal_authority_id: bcs.Address,
  runtime_authority_id: bcs.Address,
  output_authority_id: bcs.Address,
  physical_authority_id: bcs.Address,
  market_authority_id: bcs.Address,
  release_authority_id: bcs.Address,
  commitment: bcs.byteVector(),
});
const TEST_PRODUCT_RELEASE_CATALOG_BCS = bcs.struct('MainnetV8ReleaseTestCatalog', {
  id: bcs.Address,
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  protocol_config_commitment: bcs.byteVector(),
  binding: TEST_PRODUCT_RELEASE_BINDING_BCS,
  call_cap_set: TEST_PACKAGE_CALL_CAP_SET_BCS,
  seal_call_cap: bcs.option(TEST_PACKAGE_CALL_CAP_BCS),
  runtime_call_cap: bcs.option(TEST_PACKAGE_CALL_CAP_BCS),
  output_call_cap: bcs.option(TEST_PACKAGE_CALL_CAP_BCS),
  physical_call_cap: bcs.option(TEST_PACKAGE_CALL_CAP_BCS),
  market_call_cap: bcs.option(TEST_PACKAGE_CALL_CAP_BCS),
  release_call_cap: bcs.option(TEST_PACKAGE_CALL_CAP_BCS),
});
const TEST_SEAL_KEY_SERVER_BINDING_BCS = bcs.struct('MainnetV8ReleaseTestSealKeyServer', {
  key_server_id: bcs.Address,
  weight: bcs.u16(),
});
const TEST_SEAL_POLICY_CONFIG_BCS = bcs.struct('MainnetV8ReleaseTestSealConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  seal_original_package_id: bcs.Address,
  seal_callable_package_id: bcs.Address,
  seal_binding_commitment: bcs.byteVector(),
  seal_authority_id: bcs.Address,
  call_cap_set_commitment: bcs.byteVector(),
  seal_call_cap: TEST_PACKAGE_CALL_CAP_BCS,
  key_servers: bcs.vector(TEST_SEAL_KEY_SERVER_BINDING_BCS),
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  encryption_policy_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const TEST_SIMPLE_PACKAGE_CONFIG_BCS = bcs.struct('MainnetV8ReleaseTestSimpleConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  call_cap: TEST_PACKAGE_CALL_CAP_BCS,
});
const TEST_BOUND_PACKAGE_CONFIG_BCS = bcs.struct('MainnetV8ReleaseTestBoundConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  call_cap_set_commitment: bcs.byteVector(),
  call_cap: TEST_PACKAGE_CALL_CAP_BCS,
});
const effectsObjectDigest = toBase58(new Uint8Array(32).fill(0x66));
function bcsOwner(owner) {
  if (owner.kind === 'Immutable') return { Immutable: true };
  if (owner.kind === 'AddressOwner') return { AddressOwner: owner.address };
  if (owner.kind === 'ObjectOwner') return { ObjectOwner: owner.address };
  return { Shared: { initialSharedVersion: owner.initialSharedVersion } };
}

function transactionEffectsBytes(success = true, writes = [], eventsDigest = null) {
  const entries = (operation) => writes.filter((entry) => entry.operation === operation).map((entry) => [{
    objectId: entry.objectId, version: entry.version, digest: entry.digest,
  }, bcsOwner(entry.owner)]);
  return bcs.TransactionEffects.serialize({
    V1: {
      status: success
        ? { Success: true }
        : { Failure: { error: { InsufficientGas: true }, command: null } },
      executedEpoch: protocolProfile.epoch,
      gasUsed: {
        computationCost: '1', storageCost: '2', storageRebate: '0', nonRefundableStorageFee: '0',
      },
      modifiedAtVersions: [], sharedObjects: [], transactionDigest: unsignedEnvelope.digest,
      created: entries('CREATED'), mutated: entries('MUTATED'),
      unwrapped: [], deleted: [], unwrappedThenDeleted: [], wrapped: [],
      gasObject: [{ objectId: id(201), version: '1', digest: effectsObjectDigest }, { AddressOwner: sender }],
      eventsDigest, dependencies: [],
    },
  }).toBytes();
}
const successfulEffectsBytes = transactionEffectsBytes(true);
const simulation = Object.freeze({
  digest: unsignedEnvelope.digest,
  effectsTransactionDigest: unsignedEnvelope.digest,
  effectsBcsBase64: toBase64(successfulEffectsBytes),
  gasUsed: Object.freeze({
    computationCost: '1', storageCost: '2', storageRebate: '0', nonRefundableStorageFee: '0',
  }),
  recommendedGasBudget: '900',
  changedObjects: Object.freeze([]),
  objectTypes: Object.freeze({}),
});
const gasFunding = Object.freeze({
  coinType: `0x${'0'.repeat(63)}2::sui::SUI`,
  addressBalance: '1000000',
  coinBalance: '1000000',
  checkedAtEpoch: protocolProfile.epoch,
});

function abiDescriptor(definingId = id(40)) {
  return {
    modules: {
      zeta: {
        documentation: 'must disappear',
        datatypes: { Zed: { abilities: ['drop'], definingId, sourceLocation: { line: 1 } } },
        functions: { zed: { visibility: 'public', parameters: [], returns: [] } },
      },
      alpha: {
        datatypes: { Alpha: { abilities: [], typeParameters: [], definingId } },
        functions: { alpha: { visibility: 'public', parameters: [], returns: [], index: '0' } },
      },
    },
  };
}

function artifacts(role, index) {
  const sourceArtifact = buildMainnetV8SourceArtifact({
    role,
    release: { gitCommit: sourceRevision.gitCommit, gitTree: sourceRevision.gitTree },
    toolchain,
    files: [
      mainnetV8SourceFileRecord('sources/zeta.move', `module ${role}::zeta {}`),
      mainnetV8SourceFileRecord('Move.lock', `[move]\nversion = ${index + 1}`),
      mainnetV8SourceFileRecord('Move.toml', `[package]\nname = "${MAINNET_V8_PACKAGE_NAMES[role]}"`),
      mainnetV8SourceFileRecord('sources/alpha.move', `module ${role}::alpha {}`),
    ],
  });
  const packageArtifact = buildMainnetV8PackageArtifact({
    role,
    modules: [
      { name: 'zeta', bytes: Uint8Array.of(index + 3, 2, 1) },
      { name: 'alpha', bytes: Uint8Array.of(index + 1, 4, 5) },
    ],
    dependencies: [
      id(index + 20), id(2), id(1),
      ...MAINNET_V8_ROLE_DEPENDENCIES[role].map((dependency) => (
        id(40 + MAINNET_V8_ROLE_ORDER.indexOf(dependency))
      )),
    ],
    buildDigest: Uint8Array.from({ length: 32 }, () => index + 1),
  });
  const abiArtifact = buildMainnetV8AbiArtifact({
    role,
    descriptor: abiDescriptor(id(40 + index)),
  });
  return {
    role,
    packageName: MAINNET_V8_PACKAGE_NAMES[role],
    sourceArtifact,
    sourceCommitment: mainnetV8SourceCommitment(sourceArtifact),
    packageArtifact,
    packageCommitment: mainnetV8PackageCommitment(packageArtifact),
    abiArtifact,
    abiCommitment: mainnetV8AbiCommitment(abiArtifact),
  };
}

function fixturePlan() {
  return buildMainnetV8ReleasePlan({
    sender,
    sourceRevision,
    toolchain,
    sealPolicy: buildMainnetV8SealPolicy({
      keyServers: [{
        objectId: MAINNET_V8_DEFAULT_COMMITTEE,
        weight: 1,
      }],
      threshold: 1,
    }),
    packages: MAINNET_V8_ROLE_ORDER.map(artifacts),
  });
}

function predecessorReadback(ordinal, certificate) {
  if (ordinal === 0) return null;
  return {
    ordinal: String(ordinal - 1),
    certificate,
    certificateSha256: sha256MainnetV8Json(certificate),
  };
}

function readyPublishEvidence(index, { attempt = '0', predecessor = null } = {}) {
  const artifact = artifacts(MAINNET_V8_ROLE_ORDER[index], index);
  return buildMainnetV8ReadyEvidence({
    ordinal: String(index),
    attempt,
    unsignedEnvelope,
    readyArtifact: {
      kind: 'PUBLISH',
      role: artifact.role,
      packageArtifact: artifact.packageArtifact,
      packageCommitment: artifact.packageCommitment,
      modules: artifact.packageArtifact.modules.map(({ bytesBase64 }) => bytesBase64),
      dependencies: artifact.packageArtifact.dependencies,
      publishedTomlSha256: hash(`published-${index}-${attempt}`),
      simulation,
      gasFunding,
      protocolProfile,
      predecessorReadback: predecessorReadback(index, predecessor),
    },
  });
}

function fixtureStageData(ordinal) {
  const packageIds = Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role, index) => [
    role, id(40 + index),
  ]));
  const core = packageReadback(0);
  const ownedAdmin = clone(core.protocolAdminCap.reference);
  if (ordinal === 7) {
    return {
      packageIds,
      protocolConfig: {
        objectId: core.protocolConfig.reference.objectId,
        initialSharedVersion: core.protocolConfig.owner.Shared.initial_shared_version,
      },
      protocolAdminCap: ownedAdmin,
    };
  }
  const initialized = protocolInitReadback();
  const finalSealPolicy = fixtureFinalSealPolicy();
  return {
    packageIds,
    protocolConfig: {
      objectId: initialized.protocolConfig.reference.objectId,
      initialSharedVersion: initialized.protocolConfig.owner.Shared.initial_shared_version,
    },
    protocolAdminCap: ownedAdmin,
    commitments: Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role, index) => {
      const artifact = artifacts(role, index);
      return [role, {
        source: fixturePlan().packages[index].sourceCommitment,
        package: artifact.packageCommitment,
        abi: artifact.abiCommitment,
      }];
    })),
    sealPolicy: finalSealPolicy,
    keyServerCertificates: finalSealPolicy.keyServers.map((entry, index) => ({
      objectId: entry.objectId,
      type: MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
      version: '1',
      digest: toBase58(new Uint8Array(32).fill(150 + index)),
      owner: MAINNET_V8_DEFAULT_COMMITTEE_OWNER,
      previousTransaction: toBase58(new Uint8Array(32).fill(160 + index)),
      contentSha256: MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
    })),
  };
}

function readyStageEvidence(ordinal, predecessor, stageDataOverride = null) {
  const kind = MAINNET_V8_RELEASE_STEPS[ordinal].kind;
  const stageData = stageDataOverride
    ?? fixtureStageData(ordinal);
  return buildMainnetV8ReadyEvidence({
    ordinal: String(ordinal),
    unsignedEnvelope: ordinal === 9 ? null : unsignedEnvelope,
    readyArtifact: {
      kind,
      stageData,
      stageDataSha256: sha256MainnetV8Json(stageData),
      publishedTomlSha256: hash(`published-${ordinal}`),
      simulation: ordinal === 9 ? null : simulation,
      gasFunding: ordinal === 9 ? null : gasFunding,
      protocolProfile,
      predecessorReadback: predecessorReadback(ordinal, predecessor),
    },
  });
}

function signedWalEvidence(ready, ordinal, attempt) {
  return buildMainnetV8SignedEvidence({
    ordinal, attempt,
    readyArtifactSha256: ready.readyArtifactSha256,
    signedArtifact,
  });
}

function outcomeWalEvidence(status, ready, signed, ordinal, attempt, details = {}) {
  return buildMainnetV8OutcomeEvidence({
    status, ordinal, attempt,
    readyArtifactSha256: ready.readyArtifactSha256,
    ...(signed ? {
      signedArtifact,
      signedArtifactSha256: signed.signedArtifactSha256,
      digest: signedArtifact.digest,
    } : {}),
    observation: details,
  });
}

function canonicalOwnerToEffect(owner) {
  if (owner.Immutable === true) return { kind: 'Immutable' };
  if (typeof owner.AddressOwner === 'string') return { kind: 'AddressOwner', address: owner.AddressOwner };
  if (typeof owner.ObjectOwner === 'string') return { kind: 'ObjectOwner', address: owner.ObjectOwner };
  return { kind: 'Shared', initialSharedVersion: owner.Shared.initial_shared_version };
}

function moveContentBytes(type, fields) {
  if (type.endsWith('::package::UpgradeCap')) {
    return TEST_UPGRADE_CAP_BCS.serialize({
      id: fields.id,
      package: fields.package,
      version: fields.version,
      policy: Number(fields.policy),
    }).toBytes();
  }
  if (type.endsWith('::protocol_config_v8::ProtocolConfigV8')) {
    return TEST_PROTOCOL_CONFIG_BCS.serialize({
      ...fields,
      treasury_id: fields.treasury_id,
      primary_content_fee_bps: Number(fields.primary_content_fee_bps),
      maker_market_fee_bps: Number(fields.maker_market_fee_bps),
      soul_market_fee_bps: Number(fields.soul_market_fee_bps),
      commitment: Buffer.from(fields.commitment, 'hex'),
    }).toBytes();
  }
  if (type.endsWith('::protocol_config_v8::ProtocolAdminCapV8')) {
    return TEST_PROTOCOL_ADMIN_CAP_BCS.serialize(fields).toBytes();
  }
  if (type.includes('::protocol_config_v8::ProtocolTreasuryV8<')) {
    return TEST_PROTOCOL_TREASURY_BCS.serialize(fields).toBytes();
  }
  return null;
}

function moveOutput({ objectId, byte, type, owner, fields, version = '1' }) {
  const contentBytes = moveContentBytes(type, fields) ?? Uint8Array.of(0x11, byte);
  const objectBytes = Uint8Array.of(0x22, byte);
  return {
    reference: { objectId, version, digest: toBase58(new Uint8Array(32).fill(byte)) },
    type,
    owner,
    previousTransaction: signedArtifact.digest,
    fields,
    contentBcsBase64: toBase64(contentBytes),
    contentBcsSha256: sha256Hex(contentBytes),
    objectBcsBase64: toBase64(objectBytes),
    objectBcsSha256: sha256Hex(objectBytes),
  };
}

function outputWrite(output, operation = 'CREATED') {
  return {
    operation,
    ...output.reference,
    owner: canonicalOwnerToEffect(output.owner),
  };
}

function fixtureProtocolConfigCommitment({
  corePackageId, configId, revision, treasuryId = null, enabled,
}) {
  const bytes = TEST_PROTOCOL_CONFIG_COMMITMENT_INPUT_BCS.serialize({
    domain: new TextEncoder().encode('animacraft-v8/protocol-config'),
    version: '8',
    config_id: configId,
    core_original_package_id: corePackageId,
    core_callable_package_id: corePackageId,
    revision,
    treasury_id: treasuryId,
    payment_coin_type: MAINNET_V8_PAYMENT_COIN_TYPE,
    primary_content_fee_bps: 1000,
    fixed_complete_fee_atomic: '0',
    maker_market_fee_bps: 250,
    soul_market_fee_bps: 250,
    enabled,
  }).toBytes();
  return sha256MainnetV8Bytes(bytes);
}

function protocolConfigFields(corePackageId, configId, {
  enabled = false, revision = '0', treasuryId = null,
} = {}) {
  return {
    id: configId,
    version: '8',
    core_original_package_id: corePackageId,
    core_callable_package_id: corePackageId,
    revision,
    treasury_id: treasuryId,
    payment_coin_type: MAINNET_V8_PAYMENT_COIN_TYPE,
    primary_content_fee_bps: '1000',
    fixed_complete_fee_atomic: '0',
    maker_market_fee_bps: '250',
    soul_market_fee_bps: '250',
    enabled,
    commitment: fixtureProtocolConfigCommitment({
      corePackageId, configId, revision, treasuryId, enabled,
    }),
  };
}

function readbackWrites(readback) {
  if (readback.kind === 'PACKAGE_PUBLISH_CERTIFICATE') {
    return [
      readback.package.reference,
      outputWrite(readback.upgradeCap),
      ...(readback.role === 'core'
        ? [outputWrite(readback.protocolConfig), outputWrite(readback.protocolAdminCap)] : []),
    ];
  }
  if (readback.kind === 'PROTOCOL_INIT_CERTIFICATE') {
    return [outputWrite(readback.protocolConfig, 'MUTATED'), outputWrite(readback.protocolTreasury)];
  }
  if (readback.kind === 'BOOTSTRAP_CERTIFICATE') {
    return [outputWrite(readback.catalog), ...Object.values(readback.configs).map((entry) => outputWrite(entry))];
  }
  return [];
}

function finalityEvidence(success = true, writes = [], eventRows = []) {
  const eventBytes = eventRows.length === 0
    ? null
    : TEST_SUI_TRANSACTION_EVENTS_BCS.serialize({ data: eventRows }).toBytes();
  const eventsDigest = eventBytes === null
    ? null : mainnetV8TypedDigest('TransactionEvents', eventBytes);
  const effectsBytes = success
    ? transactionEffectsBytes(true, writes, eventsDigest) : transactionEffectsBytes(false);
  return {
    schemaVersion: 'animacraft.mainnet-v8-release-runner.v1',
    digest: signedArtifact.digest,
    checkpoint: '12345',
    epoch: protocolProfile.epoch,
    transactionBase64: signedArtifact.transactionBase64,
    transactionSha256: signedArtifact.transactionSha256,
    signature: signedArtifact.signature,
    signatureSha256: signedArtifact.signatureSha256,
    effectsBcsBase64: toBase64(effectsBytes),
    effectsSha256: sha256Hex(effectsBytes),
    effectsDigest: mainnetV8TypedDigest('TransactionEffects', effectsBytes),
    effectsStatus: success
      ? { success: true, error: null }
      : { success: false, error: { kind: 'InsufficientGas' } },
    eventsDigest,
    transactionEvents: eventBytes === null ? null : {
      digest: eventsDigest,
      bcsBase64: toBase64(eventBytes),
      eventCount: String(eventRows.length),
    },
  };
}

function finalityCertificate(readback, success = true) {
  const evidence = finalityEvidence(
    success,
    success ? readbackWrites(readback) : [],
    success ? readbackEventRows(readback) : [],
  );
  return {
    finalityEvidence: evidence,
    finalityEvidenceSha256: sha256MainnetV8Json(evidence),
    readback: success ? readback : null,
    readbackSha256: success ? sha256MainnetV8Json(readback) : null,
  };
}

function packageReadback(index) {
  const role = MAINNET_V8_ROLE_ORDER[index];
  const artifact = artifacts(role, index);
  const packageId = id(40 + index);
  const packageDigest = toBase58(new Uint8Array(32).fill(40 + index));
  const upgradeCapId = id(60 + index);
  const upgradeCap = moveOutput({
    objectId: upgradeCapId,
    byte: 60 + index,
    type: `0x${'0'.repeat(63)}2::package::UpgradeCap`,
    owner: { AddressOwner: sender },
    fields: { id: upgradeCapId, package: packageId, policy: '0', version: '1' },
  });
  const descriptor = abiDescriptor(packageId);
  const packageCertificate = {
    schemaVersion: 'animacraft.mainnet-v8-release-runner.v1',
    role,
    transactionDigest: signedArtifact.digest,
    reference: {
      operation: 'CREATED', objectId: packageId, version: '1', digest: packageDigest,
      owner: { kind: 'Immutable' },
    },
    moduleMapSha256: sha256MainnetV8Json(Object.fromEntries(
      artifact.packageArtifact.modules.map((module) => [module.name, module.bytesBase64]),
    )),
    objectBcsSha256: hash(`package-object-${index}`),
    typeOrigins: [
      { moduleName: 'alpha', datatypeName: 'Alpha', package: packageId },
      { moduleName: 'zeta', datatypeName: 'Zed', package: packageId },
    ],
    linkage: artifact.packageArtifact.dependencies.map((dependency) => ({
      originalId: dependency, upgradedId: dependency, upgradedVersion: '1',
    })),
    descriptor,
    abiArtifact: artifact.abiArtifact,
  };
  let protocolConfig = null;
  let protocolAdminCap = null;
  if (role === 'core') {
    const configId = id(90);
    protocolConfig = moveOutput({
      objectId: configId,
      byte: 90,
      type: `${packageId}::protocol_config_v8::ProtocolConfigV8`,
      owner: { Shared: { initial_shared_version: '1' } },
      fields: protocolConfigFields(packageId, configId),
    });
    const adminId = id(91);
    protocolAdminCap = moveOutput({
      objectId: adminId,
      byte: 91,
      type: `${packageId}::protocol_config_v8::ProtocolAdminCapV8`,
      owner: { AddressOwner: sender },
      fields: { id: adminId, version: '8', config_id: configId },
    });
  }
  return {
    schemaVersion: 'animacraft.mainnet-v8-release-runner.v1',
    kind: 'PACKAGE_PUBLISH_CERTIFICATE',
    role,
    transactionDigest: signedArtifact.digest,
    package: packageCertificate,
    upgradeCap,
    protocolConfig,
    protocolAdminCap,
  };
}

function finalizedPublishDetails(index, readback = packageReadback(index)) {
  const artifact = artifacts(MAINNET_V8_ROLE_ORDER[index], index);
  const certificate = finalityCertificate(readback);
  return {
    packageArtifact: artifact.packageArtifact,
    packageCommitment: artifact.packageCommitment,
    abiArtifact: artifact.abiArtifact,
    abiCommitment: artifact.abiCommitment,
    certificate,
    certificateSha256: sha256MainnetV8Json(certificate),
  };
}

function pendingReadbackDetails(finalizedDetails) {
  const evidence = finalizedDetails.certificate.finalityEvidence;
  return {
    finalityEvidence: evidence,
    finalityEvidenceSha256: sha256MainnetV8Json(evidence),
  };
}

function rehashFinalizedDetails(details) {
  const value = clone(details);
  if (value.certificate.readback !== null) {
    value.certificate.readbackSha256 = sha256MainnetV8Json(value.certificate.readback);
  }
  value.certificate.finalityEvidenceSha256 = sha256MainnetV8Json(
    value.certificate.finalityEvidence,
  );
  value.certificateSha256 = sha256MainnetV8Json(value.certificate);
  return value;
}

function manifestPackage(index, details) {
  const readback = details.certificate.readback;
  return {
    role: MAINNET_V8_ROLE_ORDER[index],
    packageId: readback.package.reference.objectId,
    packageDigest: readback.package.reference.digest,
    packageVersion: readback.package.reference.version,
    upgradeCapId: readback.upgradeCap.reference.objectId,
    publishDigest: details.certificate.finalityEvidence.digest,
    sourceCommitment: fixturePlan().packages[index].sourceCommitment,
    packageCommitment: details.packageCommitment,
    abiCommitment: details.abiCommitment,
    finalityEvidenceSha256: details.certificate.finalityEvidenceSha256,
    readbackSha256: details.certificate.readbackSha256,
  };
}

function finalizedFailureDetails(index) {
  const artifact = artifacts(MAINNET_V8_ROLE_ORDER[index], index);
  const certificate = finalityCertificate(null, false);
  return {
    packageArtifact: artifact.packageArtifact,
    packageCommitment: artifact.packageCommitment,
    certificate,
    certificateSha256: sha256MainnetV8Json(certificate),
  };
}

function protocolInitReadback() {
  const corePackageId = id(40);
  const configId = id(90);
  const treasuryId = id(100);
  const protocolTreasury = moveOutput({
    objectId: treasuryId,
    byte: 100,
    type: `${corePackageId}::protocol_config_v8::ProtocolTreasuryV8<${MAINNET_V8_PAYMENT_COIN_TYPE}>`,
    owner: { Shared: { initial_shared_version: '2' } },
    fields: {
      id: treasuryId, version: '8', config_id: configId, revenue: { value: '0' },
      total_collected: '0', total_withdrawn: '0',
    },
  });
  const protocolConfig = moveOutput({
    objectId: configId,
    byte: 92,
    version: '2',
    type: `${corePackageId}::protocol_config_v8::ProtocolConfigV8`,
    owner: { Shared: { initial_shared_version: '1' } },
    fields: protocolConfigFields(corePackageId, configId, {
      enabled: true, revision: '2', treasuryId,
    }),
  });
  const intermediateCommitment = fixtureProtocolConfigCommitment({
    corePackageId, configId, revision: '1', treasuryId, enabled: false,
  });
  const finalCommitment = protocolConfig.fields.commitment;
  return {
    schemaVersion: 'animacraft.mainnet-v8-release-runner.v1',
    kind: 'PROTOCOL_INIT_CERTIFICATE',
    transactionDigest: signedArtifact.digest,
    protocolConfig,
    protocolTreasury,
    events: {
      treasuryInitialized: {
        config_id: configId,
        treasury_id: treasuryId,
        revision: '1',
        commitment: toBase64(Buffer.from(intermediateCommitment, 'hex')),
      },
      enabledChanged: {
        config_id: configId,
        revision: '2',
        enabled: true,
        commitment: toBase64(Buffer.from(finalCommitment, 'hex')),
      },
      intermediateCommitment,
      finalCommitment,
    },
  };
}

function attestedObject({ objectId, byte, type, fields, role = null }) {
  const base = {
    schemaVersion: 'animacraft.maker-v8-chain.v8',
    network: 'mainnet',
    objectId,
    version: '1',
    digest: toBase58(new Uint8Array(32).fill(byte)),
    type,
    owner: { kind: 'shared', initialSharedVersion: '1' },
    fields,
    objectRef: { objectId, version: '1', digest: toBase58(new Uint8Array(32).fill(byte)) },
  };
  return role === null ? base : { ...base, role };
}

function fixtureFinalSealPolicy() {
  const seal = artifacts('seal', 1);
  return buildMainnetV8FinalSealPolicy({
    template: fixturePlan().sealPolicy,
    sealPackageCommitment: seal.packageCommitment,
    sealAbiCommitment: seal.abiCommitment,
  });
}

const bytes32 = (value) => Buffer.from(value, 'hex');
const fixtureMoveFields = (value) => value?.fields ?? value;

function fixtureCallCapBcs(value) {
  const fields = fixtureMoveFields(value);
  return {
    version: fields.version,
    authority_id: fields.authority_id,
    catalog_id: fields.catalog_id,
    product_binding_commitment: bytes32(fields.product_binding_commitment),
    role_binding_commitment: bytes32(fields.role_binding_commitment),
    call_cap_set_commitment: bytes32(fields.call_cap_set_commitment),
  };
}

function fixtureExactBindingBcs(value) {
  const fields = fixtureMoveFields(value);
  return {
    original_package_id: fields.original_package_id,
    callable_package_id: fields.callable_package_id,
    source_commitment: bytes32(fields.source_commitment),
    package_commitment: bytes32(fields.package_commitment),
    abi_commitment: bytes32(fields.abi_commitment),
    commitment: bytes32(fields.commitment),
  };
}

function setFixtureContentBcs(output, bytes) {
  output.contentBcsBase64 = toBase64(bytes);
  output.contentBcsSha256 = sha256Hex(bytes);
}

function setFixtureBootstrapRawBcs(catalog, configs) {
  const catalogFields = catalog.fields;
  const binding = fixtureMoveFields(catalogFields.binding);
  const callCapSet = fixtureMoveFields(catalogFields.call_cap_set);
  setFixtureContentBcs(catalog, TEST_PRODUCT_RELEASE_CATALOG_BCS.serialize({
    id: catalogFields.id,
    version: catalogFields.version,
    protocol_config_id: catalogFields.protocol_config_id,
    protocol_config_revision: catalogFields.protocol_config_revision,
    protocol_config_commitment: bytes32(catalogFields.protocol_config_commitment),
    binding: {
      version: binding.version,
      native_capability_mask: binding.native_capability_mask,
      ...Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role) => [
        role, fixtureExactBindingBcs(binding[role]),
      ])),
      commitment: bytes32(binding.commitment),
    },
    call_cap_set: {
      version: callCapSet.version,
      catalog_id: callCapSet.catalog_id,
      product_binding_commitment: bytes32(callCapSet.product_binding_commitment),
      ...Object.fromEntries(MAINNET_V8_ROLE_ORDER.slice(1).map((role) => [
        `${role}_authority_id`, callCapSet[`${role}_authority_id`],
      ])),
      commitment: bytes32(callCapSet.commitment),
    },
    ...Object.fromEntries(MAINNET_V8_ROLE_ORDER.slice(1).map((role) => [
      `${role}_call_cap`, catalogFields[`${role}_call_cap`].length === 0
        ? null : fixtureCallCapBcs(catalogFields[`${role}_call_cap`][0]),
    ])),
  }).toBytes());

  MAINNET_V8_ROLE_ORDER.slice(1).forEach((role) => {
    const fields = configs[role].fields;
    if (role === 'seal') {
      setFixtureContentBcs(configs[role], TEST_SEAL_POLICY_CONFIG_BCS.serialize({
        id: fields.id,
        version: fields.version,
        protocol_config_id: fields.protocol_config_id,
        protocol_config_revision: fields.protocol_config_revision,
        catalog_id: fields.catalog_id,
        product_binding_commitment: bytes32(fields.product_binding_commitment),
        seal_original_package_id: fields.seal_original_package_id,
        seal_callable_package_id: fields.seal_callable_package_id,
        seal_binding_commitment: bytes32(fields.seal_binding_commitment),
        seal_authority_id: fields.seal_authority_id,
        call_cap_set_commitment: bytes32(fields.call_cap_set_commitment),
        seal_call_cap: fixtureCallCapBcs(fields.seal_call_cap),
        key_servers: fields.key_servers.map((entry) => {
          const row = fixtureMoveFields(entry);
          return { key_server_id: row.key_server_id, weight: Number(row.weight) };
        }),
        threshold: Number(fields.threshold),
        key_server_set_commitment: bytes32(fields.key_server_set_commitment),
        encryption_policy_commitment: bytes32(fields.encryption_policy_commitment),
        commitment: bytes32(fields.commitment),
      }).toBytes());
      return;
    }
    const simple = ['runtime', 'output'].includes(role);
    const schema = simple ? TEST_SIMPLE_PACKAGE_CONFIG_BCS : TEST_BOUND_PACKAGE_CONFIG_BCS;
    setFixtureContentBcs(configs[role], schema.serialize({
      id: fields.id,
      version: fields.version,
      catalog_id: fields.catalog_id,
      product_binding_commitment: bytes32(fields.product_binding_commitment),
      ...(!simple ? {
        call_cap_set_commitment: bytes32(fields.call_cap_set_commitment),
      } : {}),
      call_cap: fixtureCallCapBcs(fields[`${role}_call_cap`]),
    }).toBytes());
  });
}

function bootstrapReadback() {
  const packageIds = Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role, index) => [role, id(40 + index)]));
  const catalogId = id(110);
  const configRoles = MAINNET_V8_ROLE_ORDER.slice(1);
  const roleConfigIds = Object.fromEntries(configRoles.map((role, index) => [role, id(111 + index)]));
  const runtimeConfig = {
    schemaVersion: 'animacraft.maker-v8-runtime.v8',
    protocolVersion: 8,
    enabled: true,
    catalogId,
    protocolConfigId: id(90),
    protocolTreasuryId: id(100),
    paymentCoinType: MAINNET_V8_PAYMENT_COIN_TYPE,
    clockObjectId: `0x${'0'.repeat(63)}6`,
    roles: Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role) => [role, {
      typeOriginPackageId: packageIds[role], callablePackageId: packageIds[role],
    }])),
    roleConfigIds,
    makerBindings: [],
  };
  const catalog = moveOutput({
    objectId: catalogId,
    byte: 110,
    type: `${packageIds.core}::package_binding_v8::ProductReleaseCatalogV8`,
    owner: { Shared: { initial_shared_version: '3' } },
    fields: { id: catalogId },
  });
  const typeSuffixes = {
    seal: 'seal_v8::SealPolicyConfigV8', runtime: 'runtime_binding_v8::RuntimePackageConfigV8',
    output: 'output_v8::OutputPackageConfigV8', physical: 'physical_v8::PhysicalPackageConfigV8',
    market: 'market_v8::MarketPackageConfigV8', release: 'release_v8::ReleasePackageConfigV8',
  };
  const finalSealPolicy = fixtureFinalSealPolicy();
  const sealPolicyCommitment = hash('onchain-seal-policy');
  const configs = Object.fromEntries(configRoles.map((role, index) => [role, moveOutput({
    objectId: roleConfigIds[role],
    byte: 111 + index,
    type: `${packageIds[role]}::${typeSuffixes[role]}`,
    owner: { Shared: { initial_shared_version: '3' } },
    fields: role === 'seal' ? {
      id: roleConfigIds[role],
      key_server_set_commitment: finalSealPolicy.keyServerSetCommitment,
      encryption_policy_commitment: finalSealPolicy.encryptionPolicyCommitment,
    } : { id: roleConfigIds[role] },
  })]));
  const catalogRoles = Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role, index) => {
    const artifact = artifacts(role, index);
    return [role, {
      role,
      originalPackageId: packageIds[role],
      callablePackageId: packageIds[role],
      sourceCommitment: fixturePlan().packages[index].sourceCommitment,
      packageCommitment: artifact.packageCommitment,
      abiCommitment: artifact.abiCommitment,
      commitment: hash(`catalog-role-${role}`),
    }];
  }));
  const attestedCatalog = {
    ...attestedObject({ objectId: catalogId, byte: 110, type: catalog.type, fields: { id: catalogId } }),
    protocolConfigRevision: '2',
    protocolConfigCommitment: fixtureProtocolConfigCommitment({
      corePackageId: packageIds.core,
      configId: id(90),
      revision: '2',
      treasuryId: id(100),
      enabled: true,
    }),
    productBindingCommitment: hash('product-binding'),
    callCapSetCommitment: hash('call-cap-set'),
    roles: catalogRoles,
    authorities: Object.fromEntries(configRoles.map((role, index) => [role, id(130 + index)])),
  };
  const bindingFields = Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role) => [role, {
    fields: {
      original_package_id: catalogRoles[role].originalPackageId,
      callable_package_id: catalogRoles[role].callablePackageId,
      source_commitment: catalogRoles[role].sourceCommitment,
      package_commitment: catalogRoles[role].packageCommitment,
      abi_commitment: catalogRoles[role].abiCommitment,
      commitment: catalogRoles[role].commitment,
    },
  }]));
  catalog.fields = {
    id: catalogId,
    version: '8',
    protocol_config_id: id(90),
    protocol_config_revision: '2',
    protocol_config_commitment: attestedCatalog.protocolConfigCommitment,
    binding: { fields: {
      version: '8',
      native_capability_mask: '127',
      ...bindingFields,
      commitment: attestedCatalog.productBindingCommitment,
    } },
    call_cap_set: { fields: {
      version: '8',
      catalog_id: catalogId,
      product_binding_commitment: attestedCatalog.productBindingCommitment,
      ...Object.fromEntries(configRoles.map((role) => [
        `${role}_authority_id`, attestedCatalog.authorities[role],
      ])),
      commitment: attestedCatalog.callCapSetCommitment,
    } },
    ...Object.fromEntries(configRoles.map((role) => [`${role}_call_cap`, []])),
  };
  attestedCatalog.fields = clone(catalog.fields);
  configRoles.forEach((role) => {
    const callCap = { fields: {
      version: '8',
      authority_id: attestedCatalog.authorities[role],
      catalog_id: catalogId,
      product_binding_commitment: attestedCatalog.productBindingCommitment,
      role_binding_commitment: catalogRoles[role].commitment,
      call_cap_set_commitment: attestedCatalog.callCapSetCommitment,
    } };
    configs[role].fields = role === 'seal' ? {
      id: roleConfigIds[role],
      version: '8',
      protocol_config_id: id(90),
      protocol_config_revision: '2',
      catalog_id: catalogId,
      product_binding_commitment: attestedCatalog.productBindingCommitment,
      seal_original_package_id: packageIds.seal,
      seal_callable_package_id: packageIds.seal,
      seal_binding_commitment: catalogRoles.seal.commitment,
      seal_authority_id: attestedCatalog.authorities.seal,
      call_cap_set_commitment: attestedCatalog.callCapSetCommitment,
      seal_call_cap: callCap,
      key_servers: finalSealPolicy.keyServers.map((entry) => ({ fields: {
        key_server_id: entry.objectId,
        weight: entry.weight,
      } })),
      threshold: finalSealPolicy.threshold,
      key_server_set_commitment: finalSealPolicy.keyServerSetCommitment,
      encryption_policy_commitment: finalSealPolicy.encryptionPolicyCommitment,
      commitment: sealPolicyCommitment,
    } : {
      id: roleConfigIds[role],
      version: '8',
      catalog_id: catalogId,
      product_binding_commitment: attestedCatalog.productBindingCommitment,
      ...(['runtime', 'output'].includes(role) ? {} : {
        call_cap_set_commitment: attestedCatalog.callCapSetCommitment,
      }),
      [`${role}_call_cap`]: callCap,
    };
  });
  const attestedConfigs = Object.fromEntries(configRoles.map((role, index) => [role, attestedObject({
    objectId: roleConfigIds[role], byte: 111 + index, type: configs[role].type,
    fields: clone(configs[role].fields), role,
  })]));
  const packageTuple = MAINNET_V8_ROLE_ORDER.map((role, index) => ({
    role,
    originalPackageId: packageIds[role],
    callablePackageId: packageIds[role],
    packageDigest: toBase58(new Uint8Array(32).fill(40 + index)),
  }));
  const markerTypes = {
    core: ['protocol_config_v8', 'CorePackageMarkerV8', 'CorePackageMarkerV8'],
    seal: ['seal_v8', 'SealOriginalMarkerV8', 'SealCallableMarkerV8'],
    runtime: ['runtime_v8', 'RuntimeOriginalMarkerV8', 'RuntimeCallableMarkerV8'],
    output: ['output_v8', 'OutputOriginalMarkerV8', 'OutputCallableMarkerV8'],
    physical: ['physical_v8', 'PhysicalOriginalMarkerV8', 'PhysicalCallableMarkerV8'],
    market: ['market_v8', 'MarketOriginalMarkerV8', 'MarketCallableMarkerV8'],
    release: ['release_v8', 'ReleaseOriginalMarkerV8', 'ReleaseCallableMarkerV8'],
  };
  const releaseCommitments = {
    roles: Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role) => {
      const attested = catalogRoles[role];
      const [module, original, callable] = markerTypes[role];
      return [role, {
        originalPackageId: packageIds[role],
        callablePackageId: packageIds[role],
        sourceCommitment: attested.sourceCommitment,
        packageCommitment: attested.packageCommitment,
        abiCommitment: attested.abiCommitment,
        bindingCommitment: attested.commitment,
        originalMarkerType: `${packageIds[role]}::${module}::${original}`,
        callableMarkerType: `${packageIds[role]}::${module}::${callable}`,
      }];
    })),
    authorities: { ...attestedCatalog.authorities },
    productBindingCommitment: attestedCatalog.productBindingCommitment,
    callCapSetCommitment: attestedCatalog.callCapSetCommitment,
  };
  const events = {
    config_id: roleConfigIds.seal,
    catalog_id: catalogId,
    threshold: Number(finalSealPolicy.threshold),
    key_server_set_commitment: toBase64(Buffer.from(finalSealPolicy.keyServerSetCommitment, 'hex')),
    commitment: toBase64(Buffer.from(sealPolicyCommitment, 'hex')),
  };
  setFixtureBootstrapRawBcs(catalog, configs);
  return {
    schemaVersion: 'animacraft.mainnet-v8-release-runner.v1',
    kind: 'BOOTSTRAP_CERTIFICATE',
    transactionDigest: signedArtifact.digest,
    runtimeConfig,
    catalog,
    configs,
    releaseCommitments,
    sealPolicyCommitment,
    events,
    attestation: {
      catalog: attestedCatalog,
      configs: attestedConfigs,
      packageTuple,
      coreArtifact: {
        callablePackageId: packageIds.core,
        packageDigest: packageTuple[0].packageDigest,
        baseRegistryModuleSha256: hash('core-base-registry'),
      },
    },
  };
}

function suiEvent({ packageId, module, name, contents }) {
  return {
    package_id: packageId,
    transaction_module: module,
    sender,
    event_type: { address: packageId, module, name, typeParams: [] },
    contents,
  };
}

function readbackEventRows(readback) {
  if (!readback) return [];
  if (readback.kind === 'PROTOCOL_INIT_CERTIFICATE') {
    const corePackageId = readback.protocolConfig.type.split('::')[0];
    const first = readback.events.treasuryInitialized;
    const second = readback.events.enabledChanged;
    return [
      suiEvent({
        packageId: corePackageId,
        module: 'protocol_config_v8',
        name: 'ProtocolTreasuryV8Initialized',
        contents: TEST_PROTOCOL_TREASURY_INITIALIZED_EVENT_BCS.serialize({
          ...first, commitment: Buffer.from(first.commitment, 'base64'),
        }).toBytes(),
      }),
      suiEvent({
        packageId: corePackageId,
        module: 'protocol_config_v8',
        name: 'ProtocolV8EnabledChanged',
        contents: TEST_PROTOCOL_ENABLED_CHANGED_EVENT_BCS.serialize({
          ...second, commitment: Buffer.from(second.commitment, 'base64'),
        }).toBytes(),
      }),
    ];
  }
  if (readback.kind === 'BOOTSTRAP_CERTIFICATE') {
    return [suiEvent({
      packageId: readback.runtimeConfig.roles.seal.callablePackageId,
      module: 'seal_v8',
      name: 'SealPolicyCreatedV8',
      contents: TEST_SEAL_POLICY_CREATED_EVENT_BCS.serialize({
        ...readback.events,
        key_server_set_commitment: Buffer.from(readback.events.key_server_set_commitment, 'base64'),
        commitment: Buffer.from(readback.events.commitment, 'base64'),
      }).toBytes(),
    })];
  }
  return [];
}

function finalizedStageDetails(ordinal) {
  const readback = ordinal === 7 ? protocolInitReadback() : bootstrapReadback();
  const certificate = finalityCertificate(readback);
  return { certificate, certificateSha256: sha256MainnetV8Json(certificate) };
}

const queryIntent = Object.freeze({ kind: 'QUERY_INTENT', details: Object.freeze({}) });
const broadcastIntent = Object.freeze({
  kind: 'BROADCAST_INTENT',
  details: (() => {
    const watermark = Object.freeze({
      epoch: protocolProfile.epoch,
      checkpointSequence: '12345',
      checkpointDigest: toBase58(new Uint8Array(32).fill(0x42)),
    });
    const common = {
      kind: 'TYPED_NOT_FOUND',
      code: 'NOT_FOUND',
      service: 'sui.rpc.v2.LedgerService',
      method: 'GetTransaction',
      digest: signedArtifact.digest,
      signedArtifactSha256: sha256MainnetV8Json(signedArtifact),
      chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER,
      endpoint: 'https://fullnode.mainnet.sui.io/',
    };
    const firstQuery = { ...common, observedAt: '2026-08-22T00:00:01.000Z', afterWatermark: null };
    const secondQuery = { ...common, observedAt: '2026-08-22T00:00:02.000Z', afterWatermark: watermark };
    return Object.freeze({
      firstQuery,
      firstQuerySha256: sha256MainnetV8Json(firstQuery),
      watermark,
      secondQuery,
      secondQuerySha256: sha256MainnetV8Json(secondQuery),
    });
  })(),
});

function acceptedDetails() {
  const response = { digest: signedArtifact.digest, status: 'ACCEPTED_SUCCESS', effectsBcsBase64: null };
  return { response, responseSha256: sha256MainnetV8Json(response) };
}

function unknownDetails() {
  const error = {
    code: 'RPC_UNAVAILABLE', message: 'temporary transport failure',
    service: 'sui.rpc.v2.LedgerService', method: 'GetTransaction', details: {},
  };
  return { error, errorSha256: sha256MainnetV8Json(error) };
}

function expiredNotFoundDetails({ watermarkEpoch = '1001', signedHash = null } = {}) {
  const watermark = {
    epoch: watermarkEpoch,
    checkpointSequence: '12346',
    checkpointDigest: toBase58(new Uint8Array(32).fill(0x43)),
  };
  const common = {
    kind: 'TYPED_NOT_FOUND',
    code: 'NOT_FOUND',
    service: 'sui.rpc.v2.LedgerService',
    method: 'GetTransaction',
    digest: signedArtifact.digest,
    signedArtifactSha256: signedHash ?? sha256MainnetV8Json(signedArtifact),
    chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER,
    endpoint: 'https://fullnode.mainnet.sui.io/',
  };
  const expiration = {
    kind: 'EXPIRED_NOT_FOUND',
    digest: signedArtifact.digest,
    firstQuery: {
      ...common, observedAt: '2026-08-22T00:00:03.000Z', afterWatermark: null,
    },
    watermark,
    secondQuery: {
      ...common, observedAt: '2026-08-22T00:00:04.000Z', afterWatermark: watermark,
    },
    expiration: clone(parsedTransaction.V1.expiration),
  };
  return { expiration, expirationSha256: sha256MainnetV8Json(expiration) };
}

function expectCode(code) {
  return (error) => error instanceof MainnetV8ReleaseError && error.code === code;
}

test('canonical JSON is safe, injective, and sorted by ECMAScript UTF-16 code units', () => {
  const value = { '\ue000': 2, '😀': 1, a: true };
  assert.equal(compareMainnetV8Text('😀', '\ue000'), -1);
  assert.equal(canonicalMainnetV8Json(value), '{"a":true,"😀":1,"":2}');
  assert.equal(sha256MainnetV8Json(value), hash(canonicalMainnetV8Json(value)));
  assert.equal(sha256MainnetV8Bytes(Uint8Array.of(0, 1, 2)), hash(Buffer.from([0, 1, 2])));
  assert.equal(sha256Hex('runner-api'), hash('runner-api'));
  assert.equal(Buffer.from(sha256Bytes('runner-api')).toString('hex'), hash('runner-api'));

  const cases = [];
  const cycle = {}; cycle.self = cycle; cases.push(cycle);
  const accessor = {}; Object.defineProperty(accessor, 'trap', { enumerable: true, get() { return 1; } }); cases.push(accessor);
  const sparse = new Array(1); cases.push(sparse);
  const decorated = []; decorated.extra = true; cases.push(decorated);
  const symbol = { [Symbol('hidden')]: true }; cases.push(symbol);
  cases.push({ value: 1n }, { value: Infinity }, { value: -0 }, { value: undefined });
  cases.forEach((entry) => assert.throws(
    () => assertMainnetV8DeterministicJson(entry),
    expectCode('MAINNET_V8_JSON_DOMAIN_INVALID'),
  ));
});

test('the seven roles, direct dependency DAG, package names, and ten release ordinals are frozen', () => {
  assert.deepEqual(MAINNET_V8_ROLE_ORDER, ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']);
  assert.deepEqual(MAINNET_V8_ROLE_DEPENDENCIES, {
    core: [],
    seal: ['core'],
    runtime: ['core', 'seal'],
    output: ['core', 'seal', 'runtime'],
    physical: ['core', 'output', 'runtime'],
    market: ['core', 'output', 'physical', 'runtime'],
    release: ['core', 'seal', 'runtime', 'output', 'physical'],
  });
  assert.deepEqual(Object.values(MAINNET_V8_PACKAGE_NAMES), MAINNET_V8_ROLE_ORDER.map((role) => `animacraft_v8_${role}`));
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.map(({ ordinal, kind }) => [ordinal, kind]), [
    ['0', 'PUBLISH'], ['1', 'PUBLISH'], ['2', 'PUBLISH'], ['3', 'PUBLISH'],
    ['4', 'PUBLISH'], ['5', 'PUBLISH'], ['6', 'PUBLISH'],
    ['7', 'INITIALIZE_PROTOCOL'], ['8', 'BOOTSTRAP_RELEASE'], ['9', 'VERIFY_AND_EXPORT'],
  ]);
});

test('source artifacts bind the exact source set, release revision, toolchain, sizes, and hashes', () => {
  const artifact = artifacts('core', 0).sourceArtifact;
  assert.equal(artifact.domain, MAINNET_V8_SOURCE_ARTIFACT_DOMAIN);
  assert.equal(artifact.toolchain.suiVersion, MAINNET_V8_SUI_VERSION);
  assert.equal(artifact.toolchain.suiVersionOutput, MAINNET_V8_SUI_VERSION_OUTPUT);
  assert.equal(artifact.toolchain.suiSourceCommit, MAINNET_V8_SUI_SOURCE_COMMIT);
  assert.deepEqual(artifact.files.map(({ path }) => path), [
    'Move.lock', 'Move.toml', 'sources/alpha.move', 'sources/zeta.move',
  ]);
  assert.doesNotThrow(() => assertMainnetV8SourceArtifact(artifact));
  assert.equal(mainnetV8SourceCommitment(artifact), sha256MainnetV8Json(artifact));

  const sizeTamper = clone(artifact);
  sizeTamper.files[0].byteLength = String(BigInt(sizeTamper.files[0].byteLength) + 1n);
  assert.doesNotThrow(() => assertMainnetV8SourceArtifact(sizeTamper));
  assert.notEqual(mainnetV8SourceCommitment(sizeTamper), mainnetV8SourceCommitment(artifact));
  const orderTamper = clone(artifact);
  orderTamper.files.reverse();
  assert.throws(() => assertMainnetV8SourceArtifact(orderTamper), expectCode('MAINNET_V8_SOURCE_ARTIFACT_INVALID'));
  const pathTamper = clone(artifact);
  pathTamper.files[2].path = '../alpha.move';
  assert.throws(() => assertMainnetV8SourceArtifact(pathTamper), expectCode('MAINNET_V8_SOURCE_PATH_INVALID'));
  const binaryCommitVersion = clone(artifact);
  binaryCommitVersion.toolchain.suiVersion = '1.77.2-51d177ad7d65';
  assert.throws(() => assertMainnetV8SourceArtifact(binaryCommitVersion), expectCode('MAINNET_V8_TOOLCHAIN_INVALID'));
  const sourceCommitTamper = clone(artifact);
  sourceCommitTamper.toolchain.suiSourceCommit = 'd'.repeat(40);
  assert.throws(() => assertMainnetV8SourceArtifact(sourceCommitTamper), expectCode('MAINNET_V8_TOOLCHAIN_INVALID'));
  const binaryHashTamper = clone(artifact);
  binaryHashTamper.toolchain.suiBinarySha256 = 'd'.repeat(64);
  assert.throws(() => assertMainnetV8SourceArtifact(binaryHashTamper), expectCode('MAINNET_V8_TOOLCHAIN_INVALID'));
});

test('package artifacts bind exact module bytes, normalized dependencies, and build digest', () => {
  const module = mainnetV8PackageModuleRecord('alpha', Uint8Array.of(1, 2, 3));
  assert.deepEqual(module, {
    name: 'alpha', bytesBase64: 'AQID', byteLength: '3', sha256: hash(Buffer.from([1, 2, 3])),
  });
  const artifact = artifacts('runtime', 2).packageArtifact;
  assert.deepEqual(artifact.modules.map(({ name }) => name), ['alpha', 'zeta']);
  assert.deepEqual(artifact.dependencies, [id(1), id(2), id(22), id(40), id(41)]);
  assert.doesNotThrow(() => assertMainnetV8PackageArtifact(artifact));

  const byteTamper = clone(artifact);
  byteTamper.modules[0].bytesBase64 = 'AQIE';
  assert.throws(() => assertMainnetV8PackageArtifact(byteTamper), expectCode('MAINNET_V8_PACKAGE_ARTIFACT_INVALID'));
  assert.throws(() => buildMainnetV8PackageArtifact({
    role: 'core', modules: [module], dependencies: ['0x2', `0x${'0'.repeat(63)}2`], buildDigest: '1'.repeat(64),
  }), expectCode('MAINNET_V8_PACKAGE_ARTIFACT_INVALID'));
});

test('ABI artifacts strip docs/source locations, decimalize integers, and canonically sort modules and symbols', () => {
  const artifact = artifacts('seal', 1).abiArtifact;
  assert.equal(artifact.domain, MAINNET_V8_ABI_ARTIFACT_DOMAIN);
  assert.deepEqual(artifact.modules.map(({ name }) => name), ['alpha', 'zeta']);
  assert.equal(artifact.modules[0].functions[0].index, '0');
  assert.equal(canonicalMainnetV8Json(artifact).includes('documentation'), false);
  assert.equal(canonicalMainnetV8Json(artifact).includes('sourceLocation'), false);
  assert.doesNotThrow(() => assertMainnetV8AbiArtifact(artifact));

  const orderTamper = clone(artifact);
  orderTamper.modules.reverse();
  assert.throws(() => assertMainnetV8AbiArtifact(orderTamper), expectCode('MAINNET_V8_ABI_INVALID'));
  const docTamper = clone(artifact);
  docTamper.modules[0].functions[0].docs = 'smuggled';
  assert.throws(() => assertMainnetV8AbiArtifact(docTamper), expectCode('MAINNET_V8_ABI_INVALID'));
});

test('Seal policy commitments bind the reviewed Mainnet committee and final artifact policy', () => {
  const template = buildMainnetV8SealPolicy({
    keyServers: [{ objectId: MAINNET_V8_DEFAULT_COMMITTEE, weight: 1 }],
    threshold: 1,
  });
  assert.equal(template.keyServerSetArtifact.domain, MAINNET_V8_KEY_SERVER_SET_DOMAIN);
  assert.equal(template.keyServerSetArtifact.chainIdentifier, MAINNET_V8_CHAIN_IDENTIFIER);
  assert.deepEqual(template.keyServers.map(({ objectId }) => objectId), [MAINNET_V8_DEFAULT_COMMITTEE]);
  assert.deepEqual(template.keyServers.map(({ weight }) => weight), ['1']);
  assert.equal(template.threshold, '1');
  assert.equal(template.keyServerSetCommitment, sha256MainnetV8Json(template.keyServerSetArtifact));
  assert.equal(Object.hasOwn(template, 'encryptionPolicyArtifact'), false);
  assert.equal(canonicalMainnetV8Json(template).includes('apiKey'), false);
  assert.doesNotThrow(() => assertMainnetV8SealPolicy(template));

  const finalPolicy = buildMainnetV8FinalSealPolicy({
    template,
    sealPackageCommitment: '1'.repeat(64),
    sealAbiCommitment: '2'.repeat(64),
  });
  assert.equal(finalPolicy.encryptionPolicyArtifact.domain, MAINNET_V8_ENCRYPTION_POLICY_DOMAIN);
  assert.equal(finalPolicy.encryptionPolicyArtifact.sealPackageCommitment, '1'.repeat(64));
  assert.equal(finalPolicy.encryptionPolicyArtifact.sealAbiCommitment, '2'.repeat(64));
  assert.deepEqual(finalPolicy.encryptionPolicyArtifact.holderReadLifecycle, [
    'ACTIVE', 'PAUSED', 'ARCHIVED',
  ]);
  assert.equal(
    finalPolicy.encryptionPolicyCommitment,
    sha256MainnetV8Json(finalPolicy.encryptionPolicyArtifact),
  );
  assert.doesNotThrow(() => assertMainnetV8FinalSealPolicy(finalPolicy, template));

  assert.throws(() => buildMainnetV8SealPolicy({ keyServers: [], threshold: 1 }), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
  assert.throws(() => buildMainnetV8SealPolicy({
    keyServers: [{ objectId: '0x1', weight: 1 }], threshold: 2,
  }), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
  assert.throws(() => buildMainnetV8SealPolicy({
    keyServers: [{ objectId: id(3), weight: 1 }], threshold: 1,
  }), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
  const commitmentTamper = clone(template);
  commitmentTamper.keyServerSetCommitment = 'f'.repeat(64);
  assert.throws(() => assertMainnetV8SealPolicy(commitmentTamper), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
  const chainTamper = clone(template);
  chainTamper.keyServerSetArtifact.chainIdentifier = MAINNET_V8_LEGACY_CHAIN_IDENTIFIER;
  assert.throws(() => assertMainnetV8SealPolicy(chainTamper), expectCode('MAINNET_V8_SEAL_POLICY_INVALID'));
  const packageTamper = clone(finalPolicy);
  packageTamper.encryptionPolicyArtifact.sealPackageCommitment = '3'.repeat(64);
  assert.throws(
    () => assertMainnetV8FinalSealPolicy(packageTamper, template),
    expectCode('MAINNET_V8_SEAL_POLICY_INVALID'),
  );
  const committeeTamper = clone(finalPolicy);
  committeeTamper.keyServers[0].objectId = id(3);
  committeeTamper.keyServerSetArtifact.keyServers[0].objectId = id(3);
  committeeTamper.keyServerSetCommitment = sha256MainnetV8Json(
    committeeTamper.keyServerSetArtifact,
  );
  assert.throws(
    () => assertMainnetV8FinalSealPolicy(committeeTamper),
    expectCode('MAINNET_V8_SEAL_POLICY_INVALID'),
  );
});

test('executionPlanId binds exact Mainnet, sender, clean Git revision, protocol 133, USDC, Seal, and seven source artifacts only', () => {
  const plan = fixturePlan();
  assert.equal(plan.chain.chainIdentifier, MAINNET_V8_CHAIN_IDENTIFIER);
  assert.equal(plan.chain.legacyChainIdentifier, MAINNET_V8_LEGACY_CHAIN_IDENTIFIER);
  assert.equal(plan.paymentCoinType, MAINNET_V8_PAYMENT_COIN_TYPE);
  assert.equal(plan.packages.length, 7);
  assert.equal(plan.packages.some((entry) => [
    'packageArtifact', 'packageCommitment', 'abiArtifact', 'abiCommitment',
  ].some((field) => Object.hasOwn(entry, field))), false);
  assert.equal(plan.executionPlanId, sha256MainnetV8Json(Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== 'executionPlanId'),
  )));
  assert.equal(computeExecutionPlanId(plan), plan.executionPlanId);
  assert.doesNotThrow(() => assertMainnetV8ReleasePlan(plan));

  const dirty = clone(plan);
  dirty.sourceRevision.clean = false;
  assert.throws(() => assertMainnetV8ReleasePlan(dirty), expectCode('MAINNET_V8_PLAN_INVALID'));
  const signerTamper = clone(plan);
  signerTamper.sender = id(173);
  signerTamper.executionPlanId = computeExecutionPlanId(signerTamper);
  assert.throws(() => assertMainnetV8ReleasePlan(signerTamper), expectCode('MAINNET_V8_PLAN_INVALID'));
  const artifactTamper = clone(plan);
  artifactTamper.packages[3].sourceArtifact.files[0].sha256 = 'd'.repeat(64);
  artifactTamper.executionPlanId = sha256MainnetV8Json(Object.fromEntries(
    Object.entries(artifactTamper).filter(([key]) => key !== 'executionPlanId'),
  ));
  assert.throws(() => assertMainnetV8ReleasePlan(artifactTamper), expectCode('MAINNET_V8_PLAN_INVALID'));

  const rebuiltInputs = MAINNET_V8_ROLE_ORDER.map((role, index) => {
    const entry = artifacts(role, index);
    entry.packageArtifact = buildMainnetV8PackageArtifact({
      role, modules: [{ name: 'changed', bytes: Uint8Array.of(99, index) }],
      dependencies: [id(index + 40)], buildDigest: String(index + 1).repeat(64).slice(0, 64),
    });
    entry.packageCommitment = mainnetV8PackageCommitment(entry.packageArtifact);
    return entry;
  });
  const sameSourcePlan = buildMainnetV8ReleasePlan({
    sender, sourceRevision, toolchain, sealPolicy: plan.sealPolicy, packages: rebuiltInputs,
  });
  assert.equal(sameSourcePlan.executionPlanId, plan.executionPlanId);
});

test('Published.toml renderer/parser roundtrips the exact deterministic Sui ephemeral prefix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-published-'));
  const entries = MAINNET_V8_ROLE_ORDER.slice(0, 3).map((role, index) => ({
    packageName: MAINNET_V8_PACKAGE_NAMES[role],
    source: join(root, MAINNET_V8_PACKAGE_NAMES[role]),
    publishedAt: id(index + 10),
    originalId: id(index + 10),
    version: '1',
    toolchainVersion: '1.77.2',
    buildConfig: { flavor: 'sui', edition: '2024' },
    upgradeCapability: id(index + 30),
  }));
  const value = { buildEnv: 'mainnet', chainId: MAINNET_V8_LEGACY_CHAIN_IDENTIFIER, entries };
  const text = renderMainnetV8PublishedToml(value);
  assert.match(text, /^# generated by Move\n/);
  assert.match(text, /build-env = "mainnet"\nchain-id = "35834a8a"/);
  assert.deepEqual(parseMainnetV8PublishedToml(text), value);
  assert.equal(renderMainnetV8PublishedToml(parseMainnetV8PublishedToml(text)), text);
  assert.throws(() => parseMainnetV8PublishedToml(text.replace('version = 1', 'version = 01')), expectCode('MAINNET_V8_DECIMAL_INVALID'));
});

test('fsync WAL is hash-linked, append-only, atomically replaced, and CAS protected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-release-wal-'));
  await chmod(root, 0o700);
  const path = join(root, 'release.json');
  const ready0 = readyPublishEvidence(0);
  let wal = await createMainnetV8ReleaseWal(path, fixturePlan(), {
    recordedAt: '2026-08-22T00:00:00.000Z', evidence: ready0,
  });
  const firstHead = wal.headEventSha256;
  const signed0 = signedWalEvidence(ready0, '0', '0');
  const success0 = finalizedPublishDetails(0);
  for (const [status, evidence, recordedAt] of [
    ['SIGNED', signed0, '2026-08-22T00:00:01.000Z'],
    ['OUTCOME_PENDING', outcomeWalEvidence('OUTCOME_PENDING', ready0, signed0, '0', '0', queryIntent), '2026-08-22T00:00:02.000Z'],
    ['FINALIZED_SUCCESS_PENDING_READBACK', outcomeWalEvidence(
      'FINALIZED_SUCCESS_PENDING_READBACK', ready0, signed0, '0', '0', pendingReadbackDetails(success0),
    ), '2026-08-22T00:00:03.000Z'],
    ['FINALIZED_SUCCESS', outcomeWalEvidence('FINALIZED_SUCCESS', ready0, signed0, '0', '0', success0), '2026-08-22T00:00:04.000Z'],
    ['READY', readyPublishEvidence(1, { predecessor: success0 }), '2026-08-22T00:00:05.000Z'],
  ]) {
    const ordinal = status === 'READY' ? '1' : '0';
    if (status === 'FINALIZED_SUCCESS') {
      const drifted = clone(success0);
      drifted.certificate.finalityEvidence.checkpoint = '12346';
      drifted.certificate.finalityEvidenceSha256 = sha256MainnetV8Json(
        drifted.certificate.finalityEvidence,
      );
      drifted.certificateSha256 = sha256MainnetV8Json(drifted.certificate);
      await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
        expectedRevision: wal.revision,
        expectedHeadEventSha256: wal.headEventSha256,
        ordinal: '0', attempt: '0', status,
        evidence: outcomeWalEvidence(status, ready0, signed0, '0', '0', drifted),
        recordedAt: '2026-08-22T00:00:03.500Z',
      }), expectCode('MAINNET_V8_WAL_INVALID'));
    }
    if (status === 'READY') {
      const driftedArtifact = clone(evidence.readyArtifact);
      driftedArtifact.packageArtifact.dependencies = driftedArtifact.packageArtifact.dependencies
        .filter((dependency) => dependency !== id(40));
      driftedArtifact.dependencies = clone(driftedArtifact.packageArtifact.dependencies);
      driftedArtifact.packageCommitment = mainnetV8PackageCommitment(
        driftedArtifact.packageArtifact,
      );
      const driftedReady = buildMainnetV8ReadyEvidence({
        ordinal: '1', attempt: '0', unsignedEnvelope, readyArtifact: driftedArtifact,
      });
      await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
        expectedRevision: wal.revision,
        expectedHeadEventSha256: wal.headEventSha256,
        ordinal: '1', attempt: '0', status, evidence: driftedReady,
        recordedAt: '2026-08-22T00:00:04.500Z',
      }), expectCode('MAINNET_V8_WAL_INVALID'));
    }
    wal = await appendMainnetV8ReleaseWal(path, {
      expectedRevision: wal.revision,
      expectedHeadEventSha256: wal.headEventSha256,
      ordinal, attempt: '0', status, evidence, recordedAt,
    });
  }
  assert.equal(wal.revision, '6');
  assert.equal(wal.events[1].previousEventSha256, firstHead);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readMainnetV8ReleaseWal(path), wal);
  assert.deepEqual((await readdir(root)).filter((name) => /\.(?:tmp|lock|candidate|reclaim)$/.test(name)), []);

  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: '1', expectedHeadEventSha256: firstHead,
    ordinal: '1', attempt: '0', status: 'SIGNED', evidence: {},
  }), expectCode('MAINNET_V8_WAL_CAS_MISMATCH'));
  const tampered = JSON.parse(await readFile(path, 'utf8'));
  tampered.walSha256 = 'f'.repeat(64);
  await writeFile(path, `${canonicalMainnetV8Json(tampered)}\n`, { mode: 0o600 });
  await assert.rejects(() => readMainnetV8ReleaseWal(path), expectCode('MAINNET_V8_WAL_INVALID'));
});

test('runner-facing WAL aliases preserve exact signed bytes and reject side-channel blobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-runner-wal-'));
  const path = join(root, 'runner.json');
  const ready = readyPublishEvidence(0);
  let wal = await createReleaseWal({
    path, plan: fixturePlan(),
    event: { status: 'READY', recordedAt: '2026-08-22T01:00:00.000Z', evidence: ready },
  });
  const signed = signedWalEvidence(ready, '0', '0');
  await assert.rejects(() => appendReleaseWal({
    path, expectedRevision: wal.revision, expectedHeadHash: wal.headEventSha256,
    event: { ordinal: '0', attempt: '0', status: 'SIGNED', evidence: signed },
    blobs: { signedTransaction: { encoding: 'BASE64', data: 'AQID' } },
  }), expectCode('MAINNET_V8_WAL_INVALID'));
  wal = await appendReleaseWal({
    path, expectedRevision: wal.revision, expectedHeadHash: wal.headEventSha256,
    event: {
      ordinal: '0', attempt: '0', status: 'SIGNED', evidence: signed,
      recordedAt: '2026-08-22T01:00:01.000Z',
    },
  });
  assert.deepEqual(wal.events[1].evidence.signedArtifact, signedArtifact);
  assert.deepEqual(await readReleaseWal({ path }), wal);
});

test('WAL enforces durable query intent before broadcast and makes failure terminal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-query-first-wal-'));
  const path = join(root, 'query-first.json');
  const ready = readyPublishEvidence(0);
  const signed = signedWalEvidence(ready, '0', '0');
  let wal = await createMainnetV8ReleaseWal(path, fixturePlan(), { evidence: ready });
  let tick = 1;
  const next = async (status, evidence) => {
    wal = await appendMainnetV8ReleaseWal(path, {
      expectedRevision: wal.revision,
      expectedHeadEventSha256: wal.headEventSha256,
      ordinal: '0', attempt: '0', status, evidence,
      recordedAt: `2026-08-22T02:00:${String(tick++).padStart(2, '0')}.000Z`,
    });
  };
  await next('SIGNED', signed);
  const query = outcomeWalEvidence('OUTCOME_PENDING', ready, signed, '0', '0', queryIntent);
  await next('OUTCOME_PENDING', query);
  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision, expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', attempt: '0', status: 'BROADCAST_ACCEPTED',
    evidence: outcomeWalEvidence('BROADCAST_ACCEPTED', ready, signed, '0', '0', acceptedDetails()),
  }), expectCode('MAINNET_V8_WAL_TRANSITION_INVALID'));
  const broadcast = outcomeWalEvidence('OUTCOME_PENDING', ready, signed, '0', '0', broadcastIntent);
  await next('OUTCOME_PENDING', broadcast);
  // A process may crash after the durable broadcast intent but before the RPC
  // returns.  Recovery must query first; the old intent is not replay authority.
  await next('OUTCOME_PENDING', query);
  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision, expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', attempt: '0', status: 'BROADCAST_ACCEPTED',
    evidence: outcomeWalEvidence('BROADCAST_ACCEPTED', ready, signed, '0', '0', acceptedDetails()),
  }), expectCode('MAINNET_V8_WAL_TRANSITION_INVALID'));
  await next('OUTCOME_PENDING', broadcast);
  await next('BROADCAST_ACCEPTED', outcomeWalEvidence(
    'BROADCAST_ACCEPTED', ready, signed, '0', '0', acceptedDetails(),
  ));
  await next('OUTCOME_PENDING', query);
  await next('OUTCOME_UNKNOWN', outcomeWalEvidence(
    'OUTCOME_UNKNOWN', ready, signed, '0', '0', unknownDetails(),
  ));
  await next('OUTCOME_PENDING', query);
  await next('FINALIZED_FAILURE', outcomeWalEvidence(
    'FINALIZED_FAILURE', ready, signed, '0', '0', finalizedFailureDetails(0),
  ));
  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision, expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', attempt: '1', status: 'READY', evidence: readyPublishEvidence(0, { attempt: '1' }),
  }), expectCode('MAINNET_V8_WAL_TRANSITION_INVALID'));
  assert.throws(() => buildMainnetV8OutcomeEvidence({
    status: 'OUTCOME_PENDING', ordinal: '0', attempt: '0',
    readyArtifactSha256: ready.readyArtifactSha256,
    signedArtifact, signedArtifactSha256: signed.signedArtifactSha256,
    digest: signedArtifact.digest,
    observation: {
      kind: 'BROADCAST_INTENT',
      details: { ...broadcastIntent.details, secondQuerySha256: broadcastIntent.details.firstQuerySha256 },
    },
  }), expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'));
  const credentialIntent = structuredClone(broadcastIntent);
  credentialIntent.details.firstQuery.endpoint = 'https://fullnode.mainnet.sui.io/?token=forbidden';
  credentialIntent.details.secondQuery.endpoint = credentialIntent.details.firstQuery.endpoint;
  credentialIntent.details.firstQuerySha256 = sha256MainnetV8Json(credentialIntent.details.firstQuery);
  credentialIntent.details.secondQuerySha256 = sha256MainnetV8Json(credentialIntent.details.secondQuery);
  assert.throws(() => outcomeWalEvidence(
    'OUTCOME_PENDING', ready, signed, '0', '0', credentialIntent,
  ), expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'));
});

test('expired NOT_FOUND is typed, signed-transaction-bound, post-epoch, and terminal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-expired-wal-'));
  const path = join(root, 'expired.json');
  const ready = readyPublishEvidence(0);
  const signed = signedWalEvidence(ready, '0', '0');
  let wal = await createMainnetV8ReleaseWal(path, fixturePlan(), { evidence: ready });
  const append = async (status, evidence, second) => {
    wal = await appendMainnetV8ReleaseWal(path, {
      expectedRevision: wal.revision,
      expectedHeadEventSha256: wal.headEventSha256,
      ordinal: '0', attempt: '0', status, evidence,
      recordedAt: `2026-08-22T02:10:0${second}.000Z`,
    });
  };
  await append('SIGNED', signed, 1);
  await append('OUTCOME_PENDING', outcomeWalEvidence(
    'OUTCOME_PENDING', ready, signed, '0', '0', queryIntent,
  ), 2);

  assert.throws(() => outcomeWalEvidence(
    'EXPIRED_NOT_FOUND', ready, signed, '0', '0', expiredNotFoundDetails({ watermarkEpoch: '1000' }),
  ), expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'));
  const wrongMethod = expiredNotFoundDetails();
  wrongMethod.expiration.secondQuery.method = 'GetObject';
  wrongMethod.expirationSha256 = sha256MainnetV8Json(wrongMethod.expiration);
  assert.throws(() => outcomeWalEvidence(
    'EXPIRED_NOT_FOUND', ready, signed, '0', '0', wrongMethod,
  ), expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'));
  const wrongSigner = outcomeWalEvidence(
    'EXPIRED_NOT_FOUND', ready, signed, '0', '0',
    expiredNotFoundDetails({ signedHash: 'f'.repeat(64) }),
  );
  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', attempt: '0', status: 'EXPIRED_NOT_FOUND', evidence: wrongSigner,
    recordedAt: '2026-08-22T02:10:03.000Z',
  }), expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'));

  await append('EXPIRED_NOT_FOUND', outcomeWalEvidence(
    'EXPIRED_NOT_FOUND', ready, signed, '0', '0', expiredNotFoundDetails(),
  ), 4);
  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', attempt: '1', status: 'READY', evidence: readyPublishEvidence(0, { attempt: '1' }),
    recordedAt: '2026-08-22T02:10:05.000Z',
  }), expectCode('MAINNET_V8_WAL_TRANSITION_INVALID'));

  const acceptedExtra = acceptedDetails();
  acceptedExtra.response.requestId = 'smuggled';
  acceptedExtra.responseSha256 = sha256MainnetV8Json(acceptedExtra.response);
  assert.throws(() => outcomeWalEvidence(
    'BROADCAST_ACCEPTED', ready, signed, '0', '0', acceptedExtra,
  ), expectCode('MAINNET_V8_FIELDS_INVALID'));
  const unknownExtra = unknownDetails();
  unknownExtra.error.retry = true;
  unknownExtra.errorSha256 = sha256MainnetV8Json(unknownExtra.error);
  assert.throws(() => outcomeWalEvidence(
    'OUTCOME_UNKNOWN', ready, signed, '0', '0', unknownExtra,
  ), expectCode('MAINNET_V8_FIELDS_INVALID'));
  for (const field of ['apiKey', 'api_key_header', 'Authorization', 'clientSecret', 'sessionCookie']) {
    const unknownSecret = unknownDetails();
    unknownSecret.error.details = { [field]: 'forbidden' };
    unknownSecret.errorSha256 = sha256MainnetV8Json(unknownSecret.error);
    assert.throws(() => outcomeWalEvidence(
      'OUTCOME_UNKNOWN', ready, signed, '0', '0', unknownSecret,
    ), expectCode('MAINNET_V8_SECRET_MATERIAL_FORBIDDEN'));
  }
});

test('stage certificates reject role, effects, event, commitment, and output drift', () => {
  const buildSuccess = (ordinal, details) => buildMainnetV8OutcomeEvidence({
    status: 'FINALIZED_SUCCESS',
    ordinal: String(ordinal),
    attempt: '0',
    readyArtifactSha256: 'a'.repeat(64),
    signedArtifact,
    signedArtifactSha256: sha256MainnetV8Json(signedArtifact),
    digest: signedArtifact.digest,
    observation: details,
  });

  const publish = finalizedPublishDetails(0);
  assert.doesNotThrow(() => buildSuccess(0, publish));
  for (const mutate of [
    (value) => { value.certificate.readback.role = 'seal'; },
    (value) => {
      value.certificate.readback.package.reference.digest = toBase58(new Uint8Array(32).fill(0x77));
    },
    (value) => { value.certificate.readback.upgradeCap.fields.package = id(77); },
    (value) => {
      value.certificate.readback.package.descriptor.modules.alpha.functions.alpha.index = '1';
    },
    (value) => { value.certificate.readback.package.typeOrigins[0].package = id(77); },
    (value) => { value.certificate.readback.package.linkage[0].upgradedId = id(77); },
  ]) {
    const drifted = clone(publish);
    mutate(drifted);
    const rehashed = rehashFinalizedDetails(drifted);
    assert.throws(() => buildSuccess(0, rehashed), expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'));
  }
  const rawCapDrift = clone(publish);
  const rawCap = TEST_UPGRADE_CAP_BCS.serialize({
    id: rawCapDrift.certificate.readback.upgradeCap.reference.objectId,
    package: id(77),
    version: '1',
    policy: 0,
  }).toBytes();
  rawCapDrift.certificate.readback.upgradeCap.contentBcsBase64 = toBase64(rawCap);
  rawCapDrift.certificate.readback.upgradeCap.contentBcsSha256 = sha256Hex(rawCap);
  assert.throws(
    () => buildSuccess(0, rehashFinalizedDetails(rawCapDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );

  const initialized = finalizedStageDetails(7);
  assert.doesNotThrow(() => buildSuccess(7, initialized));
  const eventDrift = clone(initialized);
  eventDrift.certificate.readback.events.finalCommitment = 'f'.repeat(64);
  assert.throws(
    () => buildSuccess(7, rehashFinalizedDetails(eventDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );
  const effectDrift = clone(initialized);
  effectDrift.certificate.readback.protocolTreasury.reference.version = '3';
  assert.throws(
    () => buildSuccess(7, rehashFinalizedDetails(effectDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );

  const bootstrapped = finalizedStageDetails(8);
  assert.doesNotThrow(() => buildSuccess(8, bootstrapped));
  const commitmentDrift = clone(bootstrapped);
  commitmentDrift.certificate.readback.releaseCommitments.roles.seal.packageCommitment = 'f'.repeat(64);
  assert.throws(
    () => buildSuccess(8, rehashFinalizedDetails(commitmentDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );
  const bootstrapEventDrift = clone(bootstrapped);
  bootstrapEventDrift.certificate.readback.events.threshold = 2;
  assert.throws(
    () => buildSuccess(8, rehashFinalizedDetails(bootstrapEventDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );
  const catalogFieldDrift = clone(bootstrapped);
  catalogFieldDrift.certificate.readback.catalog.fields.binding.fields.native_capability_mask = '126';
  catalogFieldDrift.certificate.readback.attestation.catalog.fields.binding.fields
    .native_capability_mask = '126';
  assert.throws(
    () => buildSuccess(8, rehashFinalizedDetails(catalogFieldDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );
  const catalogRawDrift = clone(bootstrapped);
  const rawCatalog = TEST_PRODUCT_RELEASE_CATALOG_BCS.parse(Buffer.from(
    catalogRawDrift.certificate.readback.catalog.contentBcsBase64, 'base64',
  ));
  rawCatalog.binding.native_capability_mask = '126';
  const rawCatalogBytes = TEST_PRODUCT_RELEASE_CATALOG_BCS.serialize(rawCatalog).toBytes();
  catalogRawDrift.certificate.readback.catalog.contentBcsBase64 = toBase64(rawCatalogBytes);
  catalogRawDrift.certificate.readback.catalog.contentBcsSha256 = sha256Hex(rawCatalogBytes);
  assert.throws(
    () => buildSuccess(8, rehashFinalizedDetails(catalogRawDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );
  const installedCapDrift = clone(bootstrapped);
  installedCapDrift.certificate.readback.configs.market.fields.market_call_cap.fields.authority_id = id(250);
  installedCapDrift.certificate.readback.attestation.configs.market.fields.market_call_cap.fields
    .authority_id = id(250);
  assert.throws(
    () => buildSuccess(8, rehashFinalizedDetails(installedCapDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );
  const configRawDrift = clone(bootstrapped);
  const marketOutput = configRawDrift.certificate.readback.configs.market;
  const rawMarket = TEST_BOUND_PACKAGE_CONFIG_BCS.parse(Buffer.from(
    marketOutput.contentBcsBase64, 'base64',
  ));
  rawMarket.call_cap.authority_id = id(250);
  const rawMarketBytes = TEST_BOUND_PACKAGE_CONFIG_BCS.serialize(rawMarket).toBytes();
  marketOutput.contentBcsBase64 = toBase64(rawMarketBytes);
  marketOutput.contentBcsSha256 = sha256Hex(rawMarketBytes);
  assert.throws(
    () => buildSuccess(8, rehashFinalizedDetails(configRawDrift)),
    expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'),
  );

  const keyServerDrift = fixtureStageData(8);
  keyServerDrift.keyServerCertificates[0].type = `${id(2)}::key_server::KeyServer`;
  assert.throws(() => buildMainnetV8ReadyEvidence({
    ordinal: '8', unsignedEnvelope,
    readyArtifact: {
      kind: 'BOOTSTRAP_RELEASE', stageData: keyServerDrift,
      stageDataSha256: sha256MainnetV8Json(keyServerDrift),
      publishedTomlSha256: hash('published-key-server-drift'),
      simulation, gasFunding, protocolProfile,
      predecessorReadback: predecessorReadback(8, finalizedStageDetails(7)),
    },
  }), expectCode('MAINNET_V8_WAL_EVIDENCE_INVALID'));
});

test('all ten ordinals bind predecessor certificates and verify ordinal 9 without a signature', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-stage-wal-'));
  const path = join(root, 'stages.json');
  const plan = fixturePlan();
  let ready = readyPublishEvidence(0);
  let wal = await createMainnetV8ReleaseWal(path, plan, { evidence: ready });
  let previousCertificate = null;
  const publishSuccesses = [];
  let tick = 1;
  const append = async (ordinal, status, evidence) => {
    wal = await appendMainnetV8ReleaseWal(path, {
      expectedRevision: wal.revision,
      expectedHeadEventSha256: wal.headEventSha256,
      ordinal: String(ordinal), attempt: '0', status, evidence,
      recordedAt: `2026-08-22T03:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}.000Z`,
    });
  };
  for (let ordinal = 0; ordinal <= 8; ordinal += 1) {
    const signed = signedWalEvidence(ready, String(ordinal), '0');
    const details = ordinal < 7 ? finalizedPublishDetails(ordinal) : finalizedStageDetails(ordinal);
    await append(ordinal, 'SIGNED', signed);
    await append(ordinal, 'OUTCOME_PENDING', outcomeWalEvidence(
      'OUTCOME_PENDING', ready, signed, String(ordinal), '0', queryIntent,
    ));
    await append(ordinal, 'FINALIZED_SUCCESS_PENDING_READBACK', outcomeWalEvidence(
      'FINALIZED_SUCCESS_PENDING_READBACK', ready, signed, String(ordinal), '0',
      pendingReadbackDetails(details),
    ));
    await append(ordinal, 'FINALIZED_SUCCESS', outcomeWalEvidence(
      'FINALIZED_SUCCESS', ready, signed, String(ordinal), '0', details,
    ));
    if (ordinal < 7) publishSuccesses.push(details);
    previousCertificate = details;
    if (ordinal === 6) {
      const finalManifest = buildMainnetV8FinalManifest({
        plan,
        packages: publishSuccesses.map((entry, index) => manifestPackage(index, entry)),
      });
      await append(6, 'FINAL_MANIFEST_SEALED', buildMainnetV8ManifestEvidence({
        ordinal: '6', attempt: '0', finalManifest, plan,
      }));
    }
    if (ordinal < 8) {
      ready = ordinal + 1 < 7
        ? readyPublishEvidence(ordinal + 1, { predecessor: previousCertificate })
        : readyStageEvidence(ordinal + 1, previousCertificate);
      if (ordinal === 6) {
        const driftedStage = clone(ready.readyArtifact);
        driftedStage.stageData.packageIds.core = id(250);
        driftedStage.stageDataSha256 = sha256MainnetV8Json(driftedStage.stageData);
        const driftedReady = buildMainnetV8ReadyEvidence({
          ordinal: '7', attempt: '0', unsignedEnvelope, readyArtifact: driftedStage,
        });
        await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
          expectedRevision: wal.revision,
          expectedHeadEventSha256: wal.headEventSha256,
          ordinal: '7', attempt: '0', status: 'READY', evidence: driftedReady,
          recordedAt: '2026-08-22T03:00:40.000Z',
        }), expectCode('MAINNET_V8_WAL_INVALID'));
      }
      await append(ordinal + 1, 'READY', ready);
    }
  }
  ready = readyStageEvidence(9, previousCertificate, {
    releaseId: wal.releaseId,
    finalManifestSha256: sha256MainnetV8Json(wal.finalManifest),
    bootstrapCertificateSha256: previousCertificate.certificate.readbackSha256,
    exportFilename: 'animacraft-mainnet-v8-config.json',
  });
  await append(9, 'READY', ready);
  const packageVerification = {
    kind: 'FINAL_PACKAGE_REBUILD_VERIFICATION',
    executionPlanId: wal.executionPlanId,
    releaseId: wal.releaseId,
    packages: wal.finalManifest.packages.map((entry, index) => ({
      role: entry.role,
      packageId: entry.packageId,
      packageDigest: entry.packageDigest,
      packageVersion: entry.packageVersion,
      publishDigest: entry.publishDigest,
      sourceCommitment: entry.sourceCommitment,
      packageCommitment: entry.packageCommitment,
      abiCommitment: entry.abiCommitment,
      moduleMapSha256: hash(`verified-module-map-${index}`),
      objectBcsSha256: hash(`verified-package-object-${index}`),
      readbackSha256: entry.readbackSha256,
    })),
  };
  const verification = {
    kind: 'VERIFY_AND_EXPORT',
    executionPlanId: wal.executionPlanId,
    releaseId: wal.releaseId,
    finalManifestSha256: sha256MainnetV8Json(wal.finalManifest),
    packageVerification,
    packageVerificationSha256: sha256MainnetV8Json(packageVerification),
    runtimeAttestationSha256: sha256MainnetV8Json(
      previousCertificate.certificate.readback.attestation,
    ),
  };
  const exports = {
    filename: 'animacraft-mainnet-v8-config.json',
    sha256: hash('production-config'),
    protectedDecryptionReady: false,
  };
  const verifyCertificate = {
    verification,
    verificationSha256: sha256MainnetV8Json(verification),
    exports,
    exportsSha256: sha256MainnetV8Json(exports),
  };
  const verifyDetails = {
    certificate: verifyCertificate,
    certificateSha256: sha256MainnetV8Json(verifyCertificate),
  };
  const packageVerificationDrift = clone(verifyDetails);
  packageVerificationDrift.certificate.verification.packageVerification
    .packages[0].packageId = id(250);
  packageVerificationDrift.certificate.verification.packageVerificationSha256 =
    sha256MainnetV8Json(
      packageVerificationDrift.certificate.verification.packageVerification,
    );
  packageVerificationDrift.certificate.verificationSha256 = sha256MainnetV8Json(
    packageVerificationDrift.certificate.verification,
  );
  packageVerificationDrift.certificateSha256 = sha256MainnetV8Json(
    packageVerificationDrift.certificate,
  );
  const packageVerificationDriftPath = join(root, 'stages-package-verification-drift.json');
  await writeFile(packageVerificationDriftPath, `${canonicalMainnetV8Json(wal)}\n`, { mode: 0o600 });
  await assert.rejects(() => appendMainnetV8ReleaseWal(packageVerificationDriftPath, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '9', attempt: '0', status: 'FINALIZED_SUCCESS',
    evidence: outcomeWalEvidence(
      'FINALIZED_SUCCESS', ready, null, '9', '0', packageVerificationDrift,
    ),
    recordedAt: '2026-08-22T03:00:58.000Z',
  }), expectCode('MAINNET_V8_WAL_INVALID'));
  const incident = {
    code: 'MAINNET_V8_VERIFY_MISMATCH',
    message: 'Cold verification differs from sealed release evidence.',
    details: {
      executionPlanId: wal.executionPlanId,
      releaseId: wal.releaseId,
      finalManifestSha256: sha256MainnetV8Json(wal.finalManifest),
      bootstrapCertificateSha256: previousCertificate.certificate.readbackSha256,
      check: 'runtime-attestation',
      expectedSha256: hash('expected-runtime-attestation'),
      observedSha256: hash('observed-runtime-attestation'),
    },
  };
  const incidentDetails = { incident, incidentSha256: sha256MainnetV8Json(incident) };
  const missingIncidentContext = clone(incidentDetails);
  delete missingIncidentContext.incident.details.check;
  assert.throws(() => outcomeWalEvidence(
    'INCIDENT_STOPPED', ready, null, '9', '0', missingIncidentContext,
  ), expectCode('MAINNET_V8_FIELDS_INVALID'));
  const incidentPath = join(root, 'stages-incident.json');
  await writeFile(incidentPath, `${canonicalMainnetV8Json(wal)}\n`, { mode: 0o600 });
  const wrongRootIncident = clone(incidentDetails);
  wrongRootIncident.incident.details.releaseId = 'f'.repeat(64);
  wrongRootIncident.incidentSha256 = sha256MainnetV8Json(wrongRootIncident.incident);
  await assert.rejects(() => appendMainnetV8ReleaseWal(incidentPath, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '9', attempt: '0', status: 'INCIDENT_STOPPED',
    evidence: outcomeWalEvidence('INCIDENT_STOPPED', ready, null, '9', '0', wrongRootIncident),
    recordedAt: '2026-08-22T03:00:59.000Z',
  }), expectCode('MAINNET_V8_WAL_INVALID'));
  const incidentWal = await appendMainnetV8ReleaseWal(incidentPath, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '9', attempt: '0', status: 'INCIDENT_STOPPED',
    evidence: outcomeWalEvidence('INCIDENT_STOPPED', ready, null, '9', '0', incidentDetails),
    recordedAt: '2026-08-22T03:01:00.000Z',
  });
  assert.equal(incidentWal.events.at(-1).status, 'INCIDENT_STOPPED');
  assert.equal(Object.hasOwn(incidentWal.events.at(-1).evidence, 'signedArtifact'), false);
  await append(9, 'FINALIZED_SUCCESS', outcomeWalEvidence(
    'FINALIZED_SUCCESS', ready, null, '9', '0', verifyDetails,
  ));
  assert.equal(wal.events.at(-1).status, 'FINALIZED_SUCCESS');
  assert.equal(wal.events.at(-1).ordinal, '9');
  assert.equal(Object.hasOwn(wal.events.at(-1).evidence, 'signedArtifact'), false);
  assert.deepEqual(await readMainnetV8ReleaseWal(path), wal);
});

test('known successful-readback parser incident only reopens the exact durable finality', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-readback-repair-wal-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const path = join(root, 'release.json');
  const ready = readyPublishEvidence(0);
  const signed = signedWalEvidence(ready, '0', '0');
  const finalized = finalizedPublishDetails(0);
  const pendingDetails = pendingReadbackDetails(finalized);
  let wal = await createMainnetV8ReleaseWal(path, fixturePlan(), {
    recordedAt: '2026-08-23T00:00:00.000Z', evidence: ready,
  });
  const append = async (status, evidence, recordedAt) => {
    wal = await appendMainnetV8ReleaseWal(path, {
      expectedRevision: wal.revision,
      expectedHeadEventSha256: wal.headEventSha256,
      ordinal: '0', attempt: '0', status, evidence, recordedAt,
    });
    return wal;
  };
  await append('SIGNED', signed, '2026-08-23T00:00:01.000Z');
  await append('OUTCOME_PENDING', outcomeWalEvidence(
    'OUTCOME_PENDING', ready, signed, '0', '0', queryIntent,
  ), '2026-08-23T00:00:02.000Z');
  await append('FINALIZED_SUCCESS_PENDING_READBACK', outcomeWalEvidence(
    'FINALIZED_SUCCESS_PENDING_READBACK', ready, signed, '0', '0', pendingDetails,
  ), '2026-08-23T00:00:03.000Z');
  const incident = {
    code: 'MAINNET_V8_CREATED_OUTPUT_INVALID',
    message: 'Created effects entry has no object/package output.',
    details: {},
  };
  await append('INCIDENT_STOPPED', outcomeWalEvidence(
    'INCIDENT_STOPPED', ready, signed, '0', '0', {
      ...pendingDetails,
      incident,
      incidentSha256: sha256MainnetV8Json(incident),
    },
  ), '2026-08-23T00:00:04.000Z');

  const drifted = clone(pendingDetails);
  drifted.finalityEvidence.checkpoint = '999';
  drifted.finalityEvidenceSha256 = sha256MainnetV8Json(drifted.finalityEvidence);
  await assert.rejects(() => appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    ordinal: '0', attempt: '0', status: 'FINALIZED_SUCCESS_PENDING_READBACK',
    evidence: outcomeWalEvidence(
      'FINALIZED_SUCCESS_PENDING_READBACK', ready, signed, '0', '0', drifted,
    ),
    recordedAt: '2026-08-23T00:00:05.000Z',
  }), expectCode('MAINNET_V8_WAL_TRANSITION_INVALID'));

  await append('FINALIZED_SUCCESS_PENDING_READBACK', outcomeWalEvidence(
    'FINALIZED_SUCCESS_PENDING_READBACK', ready, signed, '0', '0', pendingDetails,
  ), '2026-08-23T00:00:05.000Z');
  assert.equal(wal.revision, '6');
  assert.equal(wal.events.at(-2).status, 'INCIDENT_STOPPED');
  assert.equal(wal.events.at(-1).status, 'FINALIZED_SUCCESS_PENDING_READBACK');
  assert.deepEqual(await readMainnetV8ReleaseWal(path), wal);
});

test('WAL lock lease never steals a live process and atomically reclaims a dead local owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-lock-wal-'));
  const livePath = join(root, 'live.json');
  const liveLock = `${livePath}.lock`;
  const staleInstant = new Date(Date.now() - MAINNET_V8_WAL_LOCK_LEASE_MS * 2).toISOString();
  const liveRecord = {
    pid: String(process.pid), hostname: hostname(), createdAt: staleInstant, nonce: 'a'.repeat(32),
  };
  await writeFile(liveLock, `${canonicalMainnetV8Json(liveRecord)}\n`, { mode: 0o600 });
  await assert.rejects(() => createMainnetV8ReleaseWal(
    livePath, fixturePlan(), { evidence: readyPublishEvidence(0) },
  ), expectCode('MAINNET_V8_WAL_LOCKED'));
  assert.deepEqual(JSON.parse(await readFile(liveLock, 'utf8')), liveRecord);
  await unlink(liveLock);

  const deadPath = join(root, 'dead.json');
  const deadLock = `${deadPath}.lock`;
  const deadRecord = {
    pid: '99999999', hostname: hostname(), createdAt: staleInstant, nonce: 'b'.repeat(32),
  };
  await writeFile(deadLock, `${canonicalMainnetV8Json(deadRecord)}\n`, { mode: 0o600 });
  const wal = await createMainnetV8ReleaseWal(
    deadPath, fixturePlan(), { evidence: readyPublishEvidence(0) },
  );
  assert.equal(wal.revision, '1');
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('.lock')), []);
});
