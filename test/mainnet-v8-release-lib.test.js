import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod, mkdir, mkdtemp, readFile, readdir, rm, rmdir, stat, unlink, writeFile,
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
  MAINNET_V8_PUBLISH_ORDER,
  MAINNET_V8_PUBLISH_PACKAGE_NAMES,
  MAINNET_V8_PAYMENT_COIN_TYPE,
  MAINNET_V8_DEFAULT_COMMITTEE,
  MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
  MAINNET_V8_RELEASE_SIGNER,
  MAINNET_V8_SUI_BINARY_SHA256,
  MAINNET_V8_RELEASE_STEPS,
  MAINNET_V8_ROLE_ORDER,
  MAINNET_V8_SOURCE_ARTIFACT_DOMAIN,
  MAINNET_V8_SUI_SOURCE_COMMIT,
  MAINNET_V8_SUI_VERSION,
  MAINNET_V8_SUI_VERSION_OUTPUT,
  MAINNET_V8_WAL_EVIDENCE_SCHEMA,
  MainnetV8ReleaseError,
  appendReleaseWal,
  appendMainnetV8ReleaseWal,
  assertMainnetV8AbiArtifact,
  assertMainnetV8DeterministicJson,
  assertMainnetV8PackageArtifact,
  assertMainnetV8ReleasePlan,
  assertMainnetV8ReleasePlanContents,
  assertMainnetV8FinalSealPolicy,
  assertMainnetV8SealPolicy,
  assertMainnetV8SourceArtifact,
  buildMainnetV8AbiArtifact,
  buildMainnetV8PackageArtifact,
  buildMainnetV8ReleasePlan,
  buildMainnetV8ReleasePlanContents,
  buildMainnetV8ReadyEvidence,
  buildMainnetV8FinalSealPolicy,
  buildMainnetV8SealPolicy,
  buildMainnetV8SignedEvidence,
  buildMainnetV8OutcomeEvidence,
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
import { NATIVE_SOUL_EXTERNAL_PUBLICATIONS } from '../scripts/native-soul-external-publications.mjs';
import { nativeSoulPublicationOutcomeFixture } from './fixtures/native-soul-publication-certificate-fixture.mjs';
import { nativeSoulStageReadyFixture, nativeSoulStageOutcomeFixture } from './fixtures/native-soul-native-stage-ready-fixture.mjs';
import { rewriteHistoricalObject } from './fixtures/native-soul-bootstrap-history-fixture.mjs';
import { NativeSoulBootstrapBcs } from '../scripts/native-soul-bootstrap-readback.mjs';
import { nativeSoulCompletedWalFixture } from './fixtures/native-soul-completed-wal-fixture.mjs';
import { nativeSoulPublicationWalFixture } from './fixtures/native-soul-full-wal-fixture.mjs';
import { assertMainnetV8TransactionMatchesReady } from '../scripts/mainnet-v8-release.mjs';

const id = (byte) => `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => structuredClone(value);
// Synthetic current source inventory, not a claim of compilation or a clean checkout.
const sourceRevision = {
  schema: 'animacraft.native-source-snapshot.v1',
  repositories: {
    animacraft: { baseGitCommit: 'a'.repeat(40), baseGitTree: 'b'.repeat(40) },
    soulidity: { baseGitCommit: 'c'.repeat(40), baseGitTree: 'd'.repeat(40) },
  },
  packages: MAINNET_V8_PUBLISH_ORDER.map((role, index) => {
    const packageName = MAINNET_V8_PUBLISH_PACKAGE_NAMES[role];
    const originalFiles = [
      mainnetV8SourceFileRecord('Move.lock', `[move]\nversion = ${index + 1}`),
      mainnetV8SourceFileRecord('Move.toml', `[package]\nname = "${packageName}"`),
      mainnetV8SourceFileRecord('sources/alpha.move', `module ${role}::alpha {}`),
      mainnetV8SourceFileRecord('sources/zeta.move', `module ${role}::zeta {}`),
    ];
    return { role, packageName, repository: role === 'soulidity' ? 'soulidity' : 'animacraft',
      originalFiles, files: clone(originalFiles) };
  }),
};
sourceRevision.snapshotSha256 = sha256MainnetV8Json(sourceRevision);
const toolchain = Object.freeze({
  suiVersion: '1.80.1',
  suiVersionOutput: 'sui 1.80.1-671ba71e69c7',
  suiSourceCommit: '671ba71e69c711ded76a11ef90297c4f2d5ac474',
  suiBinarySha256: MAINNET_V8_SUI_BINARY_SHA256,
  frameworkRevision: '722ac4fcf4841346c91775f596c4ce23fb7fbd0f',
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
  protocolVersion: '137',
  epoch: '999',
  gasPrice: unsignedEnvelope.gasPrice,
  attributes: Object.freeze({
    objectRuntimeMaxNumCachedObjects: '1000',
    objectRuntimeMaxNumStoreEntries: '1000',
  }),
});
const TEST_PROTOCOL_CONFIG_COMMITMENT_INPUT_BCS = bcs.struct('MainnetV8ReleaseTestProtocolCommitment', {
  domain: bcs.string(),
  schema_revision: bcs.u64(),
  config_id: bcs.Address,
  config_revision: bcs.u64(),
  enabled: bcs.bool(),
  core_original_package_id: bcs.Address,
  core_callable_package_id: bcs.Address,
  treasury_id: bcs.option(bcs.Address),
  payment_coin_type: bcs.string(),
  primary_content_fee_bps: bcs.u16(),
  fixed_complete_fee_atomic: bcs.u64(),
  maker_market_fee_bps: bcs.u16(),
  soul_market_fee_bps: bcs.u16(),
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

function sourceArtifactFor(role) {
  const source = sourceRevision.packages.find((entry) => entry.role === role);
  return buildMainnetV8SourceArtifact({
    ...source,
    release: { snapshotSha256: sourceRevision.snapshotSha256, repository: source.repository,
      ...sourceRevision.repositories[source.repository] },
    toolchain,
  });
}

function artifacts(role, index) {
  const sourceArtifact = sourceArtifactFor(role);
  const packageArtifact = buildMainnetV8PackageArtifact({
    role,
    modules: [
      { name: 'zeta', bytes: Uint8Array.of(index + 3, 2, 1) },
      { name: 'alpha', bytes: Uint8Array.of(index + 1, 4, 5) },
    ],
    dependencies: [
      id(index + 20), id(2), id(1),
      // Synthetic dependencies for Catalog serialization, not a claim about
      // compiler linkage or the complete eight-package publication graph.
      ...MAINNET_V8_ROLE_ORDER.slice(0, index).map((dependency) => (
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
  return buildMainnetV8ReleasePlanContents({
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
    packages: MAINNET_V8_PUBLISH_ORDER.map((role) => ({ role, sourceArtifact: sourceArtifactFor(role) })),
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
    domain: 'animacraft-fresh-v8/core/protocol-config/v2',
    schema_revision: '8',
    config_id: configId,
    config_revision: revision,
    enabled,
    core_original_package_id: corePackageId,
    core_callable_package_id: corePackageId,
    treasury_id: treasuryId,
    payment_coin_type: MAINNET_V8_PAYMENT_COIN_TYPE,
    primary_content_fee_bps: 1000,
    fixed_complete_fee_atomic: '0',
    maker_market_fee_bps: 250,
    soul_market_fee_bps: 250,
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
  return [];
}

function finalityEvidence(success = true, writes = []) {
  // Remaining local callers cover publication and failure recovery; current
  // native-stage event/history fixtures live in their dedicated shared module.
  const eventsDigest = null;
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
    transactionEvents: null,
  };
}

function finalityCertificate(readback, success = true) {
  const evidence = finalityEvidence(
    success,
    success ? readbackWrites(readback) : [],
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

  // A full release WAL contains full ABI and predecessor certificates;
  // keep its accepted deterministic domain above the former 200k-node limit.
  assert.doesNotThrow(() => assertMainnetV8DeterministicJson(
    Array.from({ length: 210_000 }, () => null),
    'bounded release WAL fixture',
  ));
});

test('seven Catalog roles remain distinct from eight publications and fourteen release ordinals', () => {
  assert.deepEqual(MAINNET_V8_ROLE_ORDER, ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']);
  assert.deepEqual(Object.values(MAINNET_V8_PACKAGE_NAMES), MAINNET_V8_ROLE_ORDER.map((role) => `animacraft_v8_${role}`));
  assert.deepEqual(MAINNET_V8_PUBLISH_ORDER, ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'soulidity', 'release']);
  assert.deepEqual(MAINNET_V8_PUBLISH_PACKAGE_NAMES, { ...MAINNET_V8_PACKAGE_NAMES, soulidity: 'soulidity' });
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.slice(0, 8).map(({ role }) => role), MAINNET_V8_PUBLISH_ORDER);
  assert.deepEqual(MAINNET_V8_RELEASE_STEPS.map(({ ordinal, kind }) => [ordinal, kind]), [
    ['0', 'PUBLISH'], ['1', 'PUBLISH'], ['2', 'PUBLISH'], ['3', 'PUBLISH'],
    ['4', 'PUBLISH'], ['5', 'PUBLISH'], ['6', 'PUBLISH'], ['7', 'PUBLISH'],
    ['8', 'INITIALIZE_PROTOCOL'], ['9', 'SETUP_RELEASE'], ['10', 'BEGIN_BOOTSTRAP'],
    ['11', 'FINALIZE_BOOTSTRAP'], ['12', 'ACTIVATE_SOULIDITY_MARKET'], ['13', 'VERIFY_AND_EXPORT'],
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
  assert.deepEqual(artifact.originalFiles, artifact.files);
  assert.equal(artifact.release.snapshotSha256, sourceRevision.snapshotSha256);
  assert.equal(artifact.release.repository, 'animacraft');
  const soulidityArtifact = sourceArtifactFor('soulidity');
  assert.equal(soulidityArtifact.release.repository, 'soulidity');
  assert.equal(soulidityArtifact.release.baseGitCommit, sourceRevision.repositories.soulidity.baseGitCommit);
  assert.doesNotThrow(() => assertMainnetV8SourceArtifact(soulidityArtifact));
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
  binaryCommitVersion.toolchain.suiVersion = '1.80.1-671ba71e69c7';
  assert.throws(() => assertMainnetV8SourceArtifact(binaryCommitVersion), expectCode('MAINNET_V8_TOOLCHAIN_INVALID'));
  const sourceCommitTamper = clone(artifact);
  sourceCommitTamper.toolchain.suiSourceCommit = 'd'.repeat(40);
  assert.throws(() => assertMainnetV8SourceArtifact(sourceCommitTamper), expectCode('MAINNET_V8_TOOLCHAIN_INVALID'));
  const binaryHashTamper = clone(artifact);
  binaryHashTamper.toolchain.suiBinarySha256 = 'd'.repeat(64);
  assert.throws(() => assertMainnetV8SourceArtifact(binaryHashTamper), expectCode('MAINNET_V8_TOOLCHAIN_INVALID'));
  const sourceBytesTamper = clone(artifact);
  sourceBytesTamper.files[2].sha256 = hash('unapproved source rewrite');
  assert.throws(() => assertMainnetV8SourceArtifact(sourceBytesTamper), expectCode('MAINNET_V8_SOURCE_ARTIFACT_INVALID'));
  const wrongRepository = clone(soulidityArtifact);
  wrongRepository.release.repository = 'animacraft';
  assert.throws(() => assertMainnetV8SourceArtifact(wrongRepository), expectCode('MAINNET_V8_SOURCE_ARTIFACT_INVALID'));
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

test('executionPlanId binds Mainnet, sender, dual-repository source snapshot, protocol 137, USDC, Seal and eight source artifacts', () => {
  const plan = fixturePlan();
  assert.equal(plan.chain.chainIdentifier, MAINNET_V8_CHAIN_IDENTIFIER);
  assert.equal(plan.chain.legacyChainIdentifier, MAINNET_V8_LEGACY_CHAIN_IDENTIFIER);
  assert.equal(plan.paymentCoinType, MAINNET_V8_PAYMENT_COIN_TYPE);
  assert.equal(plan.packages.length, 8);
  assert.equal(plan.steps.length, 14);
  assert.deepEqual(plan.sourceRevision.repositories, sourceRevision.repositories);
  assert.equal(Object.hasOwn(plan.sourceRevision, 'clean'), false);
  assert.equal(plan.packages.some((entry) => [
    'packageArtifact', 'packageCommitment', 'abiArtifact', 'abiCommitment',
  ].some((field) => Object.hasOwn(entry, field))), false);
  assert.equal(plan.executionPlanId, sha256MainnetV8Json(Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== 'executionPlanId'),
  )));
  assert.equal(computeExecutionPlanId(plan), plan.executionPlanId);
  assert.doesNotThrow(() => assertMainnetV8ReleasePlanContents(plan));

  const obsoleteCleanClaim = clone(plan);
  obsoleteCleanClaim.sourceRevision.clean = true;
  assert.throws(() => assertMainnetV8ReleasePlanContents(obsoleteCleanClaim), { code: 'NATIVE_SOUL_SOURCE_INVALID' });
  const signerTamper = clone(plan);
  signerTamper.sender = id(173);
  signerTamper.executionPlanId = computeExecutionPlanId(signerTamper);
  assert.throws(() => assertMainnetV8ReleasePlanContents(signerTamper), expectCode('MAINNET_V8_PLAN_INVALID'));
  const artifactTamper = clone(plan);
  artifactTamper.packages[3].sourceArtifact.files[0].sha256 = 'd'.repeat(64);
  artifactTamper.executionPlanId = sha256MainnetV8Json(Object.fromEntries(
    Object.entries(artifactTamper).filter(([key]) => key !== 'executionPlanId'),
  ));
  assert.throws(() => assertMainnetV8ReleasePlanContents(artifactTamper), expectCode('MAINNET_V8_PLAN_INVALID'));

  const rebuiltInputs = plan.packages.map((source, index) => {
    const entry = clone(source), { role } = entry;
    entry.packageArtifact = buildMainnetV8PackageArtifact({
      role, modules: [{ name: 'changed', bytes: Uint8Array.of(99, index) }],
      dependencies: [id(index + 40)], buildDigest: String(index + 1).repeat(64).slice(0, 64),
    });
    entry.packageCommitment = mainnetV8PackageCommitment(entry.packageArtifact);
    return entry;
  });
  const sameSourcePlan = buildMainnetV8ReleasePlanContents({
    sender, sourceRevision, toolchain, sealPolicy: plan.sealPolicy, packages: rebuiltInputs,
  });
  assert.equal(sameSourcePlan.executionPlanId, plan.executionPlanId);
  for (const mutate of [
    value => { value.packages.splice(6, 1); },
    value => { value.steps.splice(12, 1); },
    value => { value.steps[9].kind = 'BOOTSTRAP_RELEASE'; },
    value => { [value.steps[9], value.steps[10]] = [value.steps[10], value.steps[9]]; },
    value => { value.chain.chainIdentifier = MAINNET_V8_LEGACY_CHAIN_IDENTIFIER; },
    value => { value.protocolProfile.protocolVersion = '134'; },
    value => { value.paymentCoinType = `${id(1)}::fake::USDC`; },
  ]) {
    const tampered = clone(plan); mutate(tampered);
    tampered.executionPlanId = computeExecutionPlanId(tampered);
    assert.throws(() => assertMainnetV8ReleasePlanContents(tampered), expectCode('MAINNET_V8_PLAN_INVALID'));
  }
  const stalePlanHash = clone(plan);
  stalePlanHash.executionPlanId = 'f'.repeat(64);
  assert.throws(() => assertMainnetV8ReleasePlanContents(stalePlanHash), expectCode('MAINNET_V8_PLAN_INVALID'));
});

test('public release-plan entry points validate the same exact current plan', () => {
  const plan = fixturePlan();
  assert.doesNotThrow(() => assertMainnetV8ReleasePlanContents(plan));
  assert.deepEqual(assertMainnetV8ReleasePlan(plan), plan);
  assert.deepEqual(buildMainnetV8ReleasePlan(plan), plan);
  const drift = clone(plan);
  drift.executionPlanId = 'f'.repeat(64);
  assert.throws(() => assertMainnetV8ReleasePlan(drift), expectCode('MAINNET_V8_PLAN_INVALID'));
});

test('Published.toml renderer/parser roundtrips the exact deterministic Sui ephemeral prefix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-published-'));
  const entries = MAINNET_V8_ROLE_ORDER.slice(0, 3).map((role, index) => ({
    packageName: MAINNET_V8_PACKAGE_NAMES[role],
    source: join(root, MAINNET_V8_PACKAGE_NAMES[role]),
    publishedAt: id(index + 10),
    originalId: id(index + 10),
    version: '1',
    toolchainVersion: '1.80.1',
    buildConfig: { flavor: 'sui', edition: '2024' },
    upgradeCapability: id(index + 30),
  }));
  const externalEntries = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.map(pin => ({
    packageName: pin.packageName, source: join(root, 'external', pin.rev, pin.subdir),
    publishedAt: pin.publishedAt, originalId: pin.originalId, version: pin.version,
  }));
  const value = { buildEnv: 'mainnet', chainId: MAINNET_V8_LEGACY_CHAIN_IDENTIFIER, entries, externalEntries };
  const text = renderMainnetV8PublishedToml(value);
  assert.match(text, /^# generated by Move\n/);
  assert.match(text, /build-env = "mainnet"\nchain-id = "35834a8a"/);
  assert.deepEqual(parseMainnetV8PublishedToml(text), value);
  assert.equal(renderMainnetV8PublishedToml(parseMainnetV8PublishedToml(text)), text);
  assert.throws(() => parseMainnetV8PublishedToml(text.replace('version = 1', 'version = 01')), expectCode('MAINNET_V8_DECIMAL_INVALID'));
  assert.equal(parseMainnetV8PublishedToml(text).externalEntries.length, 6);
  const wrongPin = clone(value);
  wrongPin.externalEntries[0].publishedAt = wrongPin.externalEntries[0].originalId;
  assert.throws(() => renderMainnetV8PublishedToml(wrongPin), { code: 'NATIVE_SOUL_EXTERNAL_PUBLICATION_INVALID' });
  const missingExternal = clone(value);
  missingExternal.externalEntries.pop();
  assert.throws(() => renderMainnetV8PublishedToml(missingExternal), { code: 'NATIVE_SOUL_EXTERNAL_PUBLICATION_INVALID' });
  const missingField = clone(value); delete missingField.externalEntries;
  assert.throws(() => renderMainnetV8PublishedToml(missingField), expectCode('MAINNET_V8_FIELDS_INVALID'));
  await rm(root, { recursive: true, force: true });
});

test('fsync WAL is hash-linked, append-only, atomically replaced, and CAS protected', async (t) => {
  const fixture = await nativeSoulPublicationWalFixture();
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-release-wal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const path = join(root, 'release.json');
  const initial = fixture.wal.events[0];
  let wal = await createMainnetV8ReleaseWal(path, fixture.plan, {
    recordedAt: initial.recordedAt, evidence: initial.evidence,
  });
  const firstHead = wal.headEventSha256;
  const append = (event, evidence = event.evidence) => appendMainnetV8ReleaseWal(path, {
    expectedRevision: wal.revision, expectedHeadEventSha256: wal.headEventSha256,
    ordinal: event.ordinal, attempt: event.attempt, status: event.status,
    evidence, recordedAt: event.recordedAt,
  });
  let dependencyDriftChecks = 0;
  for (const event of fixture.wal.events.slice(1, 11)) {
    if (event.status === 'FINALIZED_SUCCESS') {
      const input = clone(fixture.publications[Number(event.ordinal)].input);
      const drifted = input.observation;
      drifted.certificate.finalityEvidence.checkpoint = String(BigInt(drifted.certificate.finalityEvidence.checkpoint) + 1n);
      drifted.certificate.finalityEvidenceSha256 = sha256MainnetV8Json(
        drifted.certificate.finalityEvidence,
      );
      drifted.certificateSha256 = sha256MainnetV8Json(drifted.certificate);
      await assert.rejects(() => append(event, buildMainnetV8OutcomeEvidence(input)), expectCode('MAINNET_V8_WAL_INVALID'));
    }
    // Remove an actual dependency from the sample Runtime READY artifact.
    // Its dependency list is fixture data, not the real compiled package graph.
    if (event.status === 'READY' && event.ordinal === '2') {
      dependencyDriftChecks += 1;
      const driftedArtifact = clone(event.evidence.readyArtifact);
      const dependencyId = driftedArtifact.dependencies[0];
      assert.ok(dependencyId);
      assert.ok(driftedArtifact.packageArtifact.dependencies.includes(dependencyId));
      driftedArtifact.packageArtifact.dependencies = driftedArtifact.packageArtifact.dependencies
        .filter((dependency) => dependency !== dependencyId);
      driftedArtifact.dependencies = clone(driftedArtifact.packageArtifact.dependencies);
      driftedArtifact.packageCommitment = mainnetV8PackageCommitment(
        driftedArtifact.packageArtifact,
      );
      const driftedReady = buildMainnetV8ReadyEvidence({
        ordinal: event.ordinal, attempt: '0', unsignedEnvelope: event.evidence.unsignedEnvelope, readyArtifact: driftedArtifact,
      });
      // Dependency completeness belongs to the exact-byte boundary also used
      // before signing. WAL context alone checks the allowed finalized prefix.
      const exactReady = {
        ordinal: event.ordinal, plan: fixture.plan,
        unsignedEnvelope: event.evidence.unsignedEnvelope,
      };
      await assertMainnetV8TransactionMatchesReady({
        ...exactReady, readyArtifact: event.evidence.readyArtifact,
      });
      const beforeAttack = await readFile(path, 'utf8');
      await assert.rejects(() => assertMainnetV8TransactionMatchesReady({
        ...exactReady, readyArtifact: driftedReady.readyArtifact,
      }), { code: 'MAINNET_V8_READY_TRANSACTION_DRIFT' });
      assert.equal(await readFile(path, 'utf8'), beforeAttack);
    }
    wal = await append(event);
  }
  assert.equal(dependencyDriftChecks, 1);
  assert.equal(wal.revision, '11');
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

// Current typed certificate cases replace the former mixed publish/old single-
// bootstrap test. Every attack starts from a passing actual outcome. Fresh state
// is the policy authority: Seal threshold is checked in SealPolicyConfigV8, not
// in an obsolete event projection. Full WAL/predecessor tests below stay separate.
function rehashCurrentOutcome(input) {
  input.observation = rehashFinalizedDetails(input.observation);
  return input;
}
function currentProofError(error) {
  return typeof error.code === 'string'
    && /^(MAINNET_V8_|NATIVE_SOUL_|MAKER_V8_)/.test(error.code)
    && !(error instanceof TypeError);
}
function rewriteCurrentNativeObject(input, kind, mutate) {
  const c = input.observation.certificate, evidence = c.readback.objects[kind];
  rewriteHistoricalObject(evidence, object => {
    const fields = NativeSoulBootstrapBcs[kind].parse(object.data.Move.contents);
    mutate(fields);
    object.data.Move.contents = NativeSoulBootstrapBcs[kind].serialize(fields).toBytes();
  });
  // Refresh the real full Object and its exact effects reference, not merely
  // JSON fields. The rejection must reach semantic identity/commitment checks.
  const effects = bcs.TransactionEffects.parse(Buffer.from(c.finalityEvidence.effectsBcsBase64, 'base64'));
  const row = effects.V2.changedObjects.find(([objectId]) => objectId === evidence.reference.objectId);
  assert.ok(row?.[1]?.outputState?.ObjectWrite, kind + ' must be an actual write in this stage');
  row[1].outputState.ObjectWrite[0] = evidence.reference.digest;
  const bytes = bcs.TransactionEffects.serialize(effects).toBytes();
  Object.assign(c.finalityEvidence, { effectsBcsBase64: toBase64(bytes),
    effectsSha256: sha256MainnetV8Bytes(bytes), effectsDigest: mainnetV8TypedDigest('TransactionEffects', bytes) });
  return rehashCurrentOutcome(input);
}

test('Core publication certificate accepts current full Object/module/linkage evidence', async () => {
  const { input } = await nativeSoulPublicationOutcomeFixture({ role: 'core' });
  const result = buildMainnetV8OutcomeEvidence(input);
  assert.equal(result.observation.details.certificate.readback.role, 'core');
  assert.equal(result.observation.details.certificate.readback.soulidityInitialization, null);
});
for (const [name, mutate] of Object.entries({
  'role substitution': r => { r.role = 'seal'; },
  'package digest drift': r => { r.package.reference.digest = toBase58(new Uint8Array(32).fill(0x77)); },
  'UpgradeCap package drift': r => { r.upgradeCap.fields.package = id(77); },
  'descriptor ABI drift': r => { r.package.descriptor.modules[0].functions.push({ name: 'injected', visibility: 'public', parameters: [], returns: [] }); },
  'unexpected own type origin': r => { r.package.typeOrigins.push({ moduleName: 'sample', datatypeName: 'Injected', package: id(77) }); },
  'dependency linkage substitution': r => { r.package.linkage[0].upgradedId = id(77); },
  'raw UpgradeCap package drift': r => {
    const raw = TEST_UPGRADE_CAP_BCS.serialize({ id: r.upgradeCap.reference.objectId, package: id(77), version: '1', policy: 0 }).toBytes();
    r.upgradeCap.contentBcsBase64 = toBase64(raw);
    r.upgradeCap.contentBcsSha256 = sha256MainnetV8Bytes(raw);
  },
})) test('Core publication certificate rejects rehashed ' + name, async () => {
  const input = clone((await nativeSoulPublicationOutcomeFixture({ role: 'core' })).input);
  assert.doesNotThrow(() => buildMainnetV8OutcomeEvidence(input));
  mutate(input.observation.certificate.readback);
  assert.throws(() => buildMainnetV8OutcomeEvidence(rehashCurrentOutcome(input)), currentProofError);
});

test('Soulidity publication certificate rejects rehashed existing dependency Config origin substitution', async () => {
  const input = clone((await nativeSoulPublicationOutcomeFixture({ role: 'soulidity' })).input);
  assert.doesNotThrow(() => buildMainnetV8OutcomeEvidence(input));
  const evidence = input.observation.certificate.readback.package.dependencyPackages[0];
  const object = bcs.Object.parse(Buffer.from(evidence.objectBcsBase64, 'base64'));
  const origins = object.data.Package.typeOriginTable;
  assert.equal(origins[0].datatypeName, 'Config');
  // Preserve module/datatype/order/count and rehash the full dependency Object.
  // Soulidity's initialized Config must still match its exact Kiosk origin.
  // This is dependency/init coverage, not an own-package datatype fixture.
  origins[0].package = id(77);
  const raw = bcs.Object.serialize(object).toBytes();
  evidence.objectBcsBase64 = toBase64(raw);
  evidence.reference.digest = mainnetV8TypedDigest('Object', raw);
  assert.throws(() => buildMainnetV8OutcomeEvidence(rehashCurrentOutcome(input)), currentProofError);
});

for (const stage of ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP',
  'FINALIZE_BOOTSTRAP', 'ACTIVATE_SOULIDITY_MARKET']) {
  test(stage + ' certificate uses the current separate native stage', () => {
    const input = nativeSoulStageOutcomeFixture(stage);
    assert.equal(buildMainnetV8OutcomeEvidence(input).observation.kind, stage + '_FINALIZED_SUCCESS');
  });
}
for (const [name, stage, kind, mutate] of [
  // Former finalCommitment drift must fail even after all proof envelopes and
  // effects are repaired. Changing a fee alone would not preserve this check.
  ['protocol commitment substitution', 'INITIALIZE_PROTOCOL', 'protocol', x => { x.commitment = Array(32).fill(77); }],
  ['fresh treasury schema drift', 'INITIALIZE_PROTOCOL', 'protocolTreasury', x => { x.version = '3'; }],
  ['Seal package commitment drift', 'SETUP_RELEASE', 'catalog', x => { x.binding.bindings[1].package_commitment = Array(32).fill(77); }],
  ['Seal threshold drift', 'SETUP_RELEASE', 'sealConfig', x => { x.threshold = 2; }],
  // The retired native_capability_mask field is not in CatalogV2. Complete
  // seven-role inventory and FINAL's two actual installation bits replace it.
  ['missing Catalog role', 'SETUP_RELEASE', 'catalog', x => { x.binding.bindings.pop(); }],
  ['incomplete setup role inventory', 'SETUP_RELEASE', 'catalog', x => { x.next_setup_role = 5; }],
  ['incomplete final install mask', 'FINALIZE_BOOTSTRAP', 'bootstrapCertificate', x => { x.install_mask = 8; }],
  // Setup's PackageCallCap is consumed; its authority remains bound in the
  // catalog cap-set and the config's installation commitment. RuntimeCallerCap
  // below is an additional native permission, not a replacement of that proof.
  ['consumed Market setup authority substitution', 'SETUP_RELEASE', 'catalog', x => { x.authority_ids[4] = id(250); }],
  ['Market installation commitment drift', 'SETUP_RELEASE', 'marketConfig', x => { x.installation_commitment = Array(32).fill(77); }],
  ['bootstrap admin protocol authority drift', 'BEGIN_BOOTSTRAP', 'bootstrapAdmin', x => { x.protocol_admin_id = id(250); }],
  ['Market runtime caller replacement drift', 'FINALIZE_BOOTSTRAP', 'marketConfig', x => { x.runtime_caller_cap.replacement_binding_id = id(250); }],
  ['raw Market runtime caller package drift', 'FINALIZE_BOOTSTRAP', 'marketConfig', x => { x.runtime_caller_cap.caller_original_package_id = id(250); }],
]) test('native certificate rejects fully rehashed ' + name, () => {
  const input = nativeSoulStageOutcomeFixture(stage);
  assert.doesNotThrow(() => buildMainnetV8OutcomeEvidence(input));
  rewriteCurrentNativeObject(input, kind, mutate);
  assert.throws(() => buildMainnetV8OutcomeEvidence(input), currentProofError);
});

test('INIT8 certificate rejects historical treasury reference drift', () => {
  const input = nativeSoulStageOutcomeFixture('INITIALIZE_PROTOCOL');
  assert.doesNotThrow(() => buildMainnetV8OutcomeEvidence(input));
  input.observation.certificate.readback.objects.protocolTreasury.reference.version = '3';
  assert.throws(() => buildMainnetV8OutcomeEvidence(rehashCurrentOutcome(input)), currentProofError);
});
test('SETUP9 READY rejects wrong key-server certificate type after stage rehash', () => {
  const input = nativeSoulStageReadyFixture('SETUP_RELEASE');
  assert.doesNotThrow(() => buildMainnetV8ReadyEvidence(input));
  input.readyArtifact.stageData.keyServerCertificates[0].type = id(2) + '::key_server::KeyServer';
  input.readyArtifact.stageDataSha256 = sha256MainnetV8Json(input.readyArtifact.stageData);
  assert.throws(() => buildMainnetV8ReadyEvidence(input), currentProofError);
});
test('Market12 certificate cannot omit its own admin output', () => {
  const input = nativeSoulStageOutcomeFixture('ACTIVATE_SOULIDITY_MARKET');
  assert.doesNotThrow(() => buildMainnetV8OutcomeEvidence(input));
  delete input.observation.certificate.readback.objects.marketAdminCapV2;
  assert.throws(() => buildMainnetV8OutcomeEvidence(rehashCurrentOutcome(input)), currentProofError);
});

test('all fourteen ordinals bind predecessor certificates and verify ordinal 13 without a signature through actual filesystem APIs', async (t) => {
  const fixture = await nativeSoulCompletedWalFixture();
  assert.equal(fixture.wal.events.length, 68);
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-stage-wal-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const path = join(root, 'stages.json');
  const first = fixture.wal.events[0];
  // Keep actual guarded create/append/read: offline fixture validity is not
  // filesystem acceptance. This remains failing while the public gate is closed.
  let wal = await createMainnetV8ReleaseWal(path, fixture.plan, {
    evidence: first.evidence, recordedAt: first.recordedAt,
  });
  const append = (target, event, evidence = event.evidence) => appendMainnetV8ReleaseWal(target, {
    expectedRevision: wal.revision, expectedHeadEventSha256: wal.headEventSha256,
    ordinal: event.ordinal, attempt: event.attempt, status: event.status,
    evidence, recordedAt: event.recordedAt,
  });
  const unsignedVerify = (status, observation) => buildMainnetV8OutcomeEvidence({
    status, ordinal: '13', attempt: '0',
    readyArtifactSha256: fixture.verify.ready.readyArtifactSha256,
    signedArtifact: null, signedArtifactSha256: null, digest: null, observation,
  });
  for (const event of fixture.wal.events.slice(1)) {
    if (event.ordinal === '8' && event.status === 'READY') {
      assert.equal(wal.events.at(-1).status, 'FINAL_MANIFEST_SEALED');
      const drifted = clone(event.evidence.readyArtifact);
      drifted.stageData.packageIds.core = id(250);
      drifted.stageDataSha256 = sha256MainnetV8Json(drifted.stageData);
      const evidence = buildMainnetV8ReadyEvidence({ ordinal: '8', attempt: '0',
        unsignedEnvelope: event.evidence.unsignedEnvelope, readyArtifact: drifted });
      await assert.rejects(() => append(path, event, evidence), expectCode('MAINNET_V8_WAL_INVALID'));
    }
    wal = await append(path, event);
    if (event.ordinal !== '13' || event.status !== 'READY') continue;
    const next = fixture.wal.events.at(-1);
    const drifted = clone(next.evidence.observation.details);
    drifted.certificate.verification.packageVerification.packages[0].packageId = id(250);
    drifted.certificate.verification.packageVerificationSha256 =
      sha256MainnetV8Json(drifted.certificate.verification.packageVerification);
    drifted.certificate.verificationSha256 = sha256MainnetV8Json(drifted.certificate.verification);
    drifted.certificateSha256 = sha256MainnetV8Json(drifted.certificate);
    const driftPath = join(root, 'stages-package-verification-drift.json');
    await writeFile(driftPath, `${canonicalMainnetV8Json(wal)}\n`, { mode: 0o600 });
    await assert.rejects(() => append(driftPath, next, unsignedVerify('FINALIZED_SUCCESS', drifted)),
      expectCode('MAINNET_V8_WAL_INVALID'));
    const data = event.evidence.readyArtifact.stageData;
    const incident = { code: 'MAINNET_V8_VERIFY_MISMATCH',
      message: 'Cold verification differs from sealed release evidence.',
      details: { executionPlanId: wal.executionPlanId, releaseId: wal.releaseId,
        finalManifestSha256: data.finalManifestSha256,
        bootstrapCertificateSha256: data.bootstrapCertificateSha256,
        marketActivationCertificateSha256: data.marketActivationCertificateSha256,
        check: 'runtime-attestation', expectedSha256: hash('expected-runtime-attestation'),
        observedSha256: hash('observed-runtime-attestation') } };
    const details = { incident, incidentSha256: sha256MainnetV8Json(incident) };
    const missingContext = clone(details);
    delete missingContext.incident.details.check;
    missingContext.incidentSha256 = sha256MainnetV8Json(missingContext.incident);
    assert.throws(() => unsignedVerify('INCIDENT_STOPPED', missingContext), expectCode('MAINNET_V8_FIELDS_INVALID'));
    const wrongRelease = clone(details);
    wrongRelease.incident.details.releaseId = 'f'.repeat(64);
    wrongRelease.incidentSha256 = sha256MainnetV8Json(wrongRelease.incident);
    const incidentPath = join(root, 'stages-incident.json');
    await writeFile(incidentPath, `${canonicalMainnetV8Json(wal)}\n`, { mode: 0o600 });
    const incidentEvent = { ...next, status: 'INCIDENT_STOPPED' };
    await assert.rejects(() => append(incidentPath, incidentEvent, unsignedVerify('INCIDENT_STOPPED', wrongRelease)),
      expectCode('MAINNET_V8_WAL_INVALID'));
    const incidentWal = await append(incidentPath, incidentEvent, unsignedVerify('INCIDENT_STOPPED', details));
    assert.equal(incidentWal.events.at(-1).status, 'INCIDENT_STOPPED');
    assert.equal(Object.hasOwn(incidentWal.events.at(-1).evidence, 'signedArtifact'), false);
    assert.deepEqual(await readMainnetV8ReleaseWal(incidentPath), incidentWal);
  }
  assert.equal(wal.events.at(-1).ordinal, '13');
  assert.equal(wal.events.at(-1).status, 'FINALIZED_SUCCESS');
  assert.equal(Object.hasOwn(wal.events.at(-1).evidence, 'signedArtifact'), false);
  assert.deepEqual(wal, fixture.wal);
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
    code: 'MAINNET_V8_INIT_WRITE_SET_INVALID',
    message: 'Protocol init write set omitted the owned AdminCap mutation.',
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

test('WAL lock never steals a live marker and reclaims only a dead local owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-v8-lock-wal-'));
  const livePath = join(root, 'live.json');
  const liveLock = `${livePath}.lock`;
  const hostHash = createHash('sha256').update(hostname()).digest('hex');
  const liveMarker = `owner.${hostHash}.${process.pid}.${'a'.repeat(32)}`;
  await mkdir(liveLock, { mode: 0o700 });
  await mkdir(join(liveLock, liveMarker), { mode: 0o700 });
  await assert.rejects(() => createMainnetV8ReleaseWal(
    livePath, fixturePlan(), { evidence: readyPublishEvidence(0) },
  ), expectCode('MAINNET_V8_WAL_LOCKED'));
  assert.deepEqual(await readdir(liveLock), [liveMarker]);
  await rmdir(join(liveLock, liveMarker));
  await rmdir(liveLock);

  const deadPath = join(root, 'dead.json');
  const deadLock = `${deadPath}.lock`;
  const deadMarker = `owner.${hostHash}.99999999.${'b'.repeat(32)}`;
  await mkdir(deadLock, { mode: 0o700 });
  await mkdir(join(deadLock, deadMarker), { mode: 0o700 });
  const wal = await createMainnetV8ReleaseWal(
    deadPath, fixturePlan(), { evidence: readyPublishEvidence(0) },
  );
  assert.equal(wal.revision, '1');
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('.lock')), []);
});
