import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase64,
  fromHex,
  normalizeStructTag,
  toBase58,
  toBase64,
} from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';

import {
  MAINNET_V8_PACKAGE_NAMES,
  MAINNET_V8_ROLE_DEPENDENCIES,
  MAINNET_V8_ROLE_PUBLISH_DEPENDENCIES,
  MAINNET_V8_ROLE_ORDER,
  appendReleaseWal,
  buildMainnetV8AbiArtifact,
  buildMainnetV8FinalSealPolicy,
  buildMainnetV8OutcomeEvidence,
  buildMainnetV8PackageArtifact,
  buildMainnetV8ReadyEvidence,
  buildMainnetV8ReleasePlan,
  buildMainnetV8SignedEvidence,
  buildMainnetV8SourceArtifact,
  buildSealPolicy,
  canonicalMainnetV8Json,
  createReleaseWal,
  mainnetV8PackageCommitment,
  mainnetV8SourceFileRecord,
  readReleaseWal,
  sha256MainnetV8Json,
} from '../scripts/mainnet-v8-release-lib.mjs';
import {
  MAINNET_V8_PLAN_FILENAME,
  MAINNET_V8_DEFAULT_COMMITTEE,
  MAINNET_V8_RELEASE_TOOLCHAIN,
  MAINNET_V8_RELEASE_SIGNER,
  MAINNET_V8_RELEASE_RUNNER_SCHEMA,
  MAINNET_V8_USDC_TYPE,
  MAINNET_V8_WAL_FILENAME,
  MainnetV8ReleaseError,
  assertMainnetV8BootstrapRawBcs,
  assertMainnetV8BootstrapEvents,
  assertMainnetV8PublishedModuleBytes,
  assertDurableMainnetV8FinalityEvidence,
  assertMainnetV8ProtocolInitEvents,
  assertMainnetV8ReadyWalContext,
  assertMainnetV8WriteGates,
  assertMainnetV8TransactionMatchesReady,
  buildMainnetV8BootstrapTransaction,
  buildMainnetV8InitTransaction,
  buildMainnetV8PublishTransaction,
  createdReferencesFromEffects,
  deriveMainnetV8ProtocolConfigCommitment,
  deriveMainnetV8SealPolicyCommitment,
  durableMainnetV8UnsignedEnvelope,
  executeMainnetV8Release,
  hydrateMainnetV8UnsignedEnvelope,
  inspectMainnetV8FreshSourceArchive,
  inspectMainnetV8Transaction,
  normalizeMainnetV8MovePackageDescriptor,
  parseMainnetV8ReleaseArgs,
  verifyExactMainnetV8SignedArtifact,
  writtenReferencesFromEffects,
} from '../scripts/mainnet-v8-release.mjs';

const execFileAsync = promisify(execFile);

const RELEASE_KEYPAIR = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(0x17));
const ATTACKER_KEYPAIR = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(0x29));
const RELEASE_SENDER = RELEASE_KEYPAIR.toSuiAddress();
const PRODUCTION_SENDER = MAINNET_V8_RELEASE_SIGNER;

const objectId = (byte) => `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
const objectDigest = (byte) => toBase58(new Uint8Array(32).fill(byte));
const hash32 = (byte) => byte.toString(16).padStart(2, '0').repeat(32);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => structuredClone(value);

function typedDigest(name, value) {
  const domain = new TextEncoder().encode(`${name}::`);
  const input = new Uint8Array(domain.length + value.length);
  input.set(domain);
  input.set(value, domain.length);
  return toBase58(blake2b(input, { dkLen: 32 }));
}

function eventStructTag(type) {
  return TypeTagSerializer.parseFromStr(normalizeStructTag(type), true).struct;
}

function finalityEventFixture(data) {
  const bytes = RELEASE_EVENTS_BCS.serialize({ data }).toBytes();
  const eventsDigest = typedDigest('TransactionEvents', bytes);
  return Object.freeze({
    eventsDigest,
    transactionEvents: Object.freeze({
      digest: eventsDigest,
      bcsBase64: toBase64(bytes),
      eventCount: String(data.length),
    }),
  });
}

function mutateFinalityEvents(finalityEvidence, mutate) {
  const envelope = RELEASE_EVENTS_BCS.parse(
    fromBase64(finalityEvidence.transactionEvents.bcsBase64),
  );
  mutate(envelope.data);
  return finalityEventFixture(envelope.data);
}

const PACKAGE_IDS = Object.freeze(Object.fromEntries(
  MAINNET_V8_ROLE_ORDER.map((role, index) => [role, objectId(index + 1)]),
));
const PROTOCOL_CONFIG = Object.freeze({
  objectId: objectId(30),
  initialSharedVersion: '5',
});
const PROTOCOL_ADMIN_CAP = Object.freeze({
  objectId: objectId(31),
  version: '6',
  digest: objectDigest(31),
});
const COMMITMENTS = Object.freeze(Object.fromEntries(
  MAINNET_V8_ROLE_ORDER.map((role, index) => [role, Object.freeze({
    source: hash32(index + 1),
    package: hash32(index + 9),
    abi: hash32(index + 17),
  })]),
));
const SEAL_POLICY_TEMPLATE = buildSealPolicy({
  keyServers: [{ objectId: MAINNET_V8_DEFAULT_COMMITTEE, weight: '1' }],
  threshold: '1',
});
const SEAL_POLICY = buildMainnetV8FinalSealPolicy({
  template: SEAL_POLICY_TEMPLATE,
  sealPackageCommitment: COMMITMENTS.seal.package,
  sealAbiCommitment: COMMITMENTS.seal.abi,
});
const PROTOCOL_COMMITMENT_INPUT_BCS = bcs.struct('ProtocolCommitmentInputTest', {
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
const SEAL_KEY_SERVER_BINDING_BCS = bcs.struct('SealKeyServerBindingTest', {
  key_server_id: bcs.Address,
  weight: bcs.u16(),
});
const SEAL_COMMITMENT_INPUT_BCS = bcs.struct('SealCommitmentInputTest', {
  domain: bcs.byteVector(),
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
  key_servers: bcs.vector(SEAL_KEY_SERVER_BINDING_BCS),
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  encryption_policy_commitment: bcs.byteVector(),
});
const RELEASE_EVENT_BCS = bcs.struct('ReleaseEventTest', {
  package_id: bcs.Address,
  transaction_module: bcs.string(),
  sender: bcs.Address,
  event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()),
});
const RELEASE_EVENTS_BCS = bcs.struct('ReleaseEventsTest', {
  data: bcs.vector(RELEASE_EVENT_BCS),
});
const TREASURY_INITIALIZED_EVENT_BCS = bcs.struct('TreasuryInitializedEventTest', {
  config_id: bcs.Address,
  treasury_id: bcs.Address,
  revision: bcs.u64(),
  commitment: bcs.byteVector(),
});
const ENABLED_CHANGED_EVENT_BCS = bcs.struct('EnabledChangedEventTest', {
  config_id: bcs.Address,
  revision: bcs.u64(),
  enabled: bcs.bool(),
  commitment: bcs.byteVector(),
});
const SEAL_POLICY_CREATED_EVENT_BCS = bcs.struct('SealPolicyCreatedEventTest', {
  config_id: bcs.Address,
  catalog_id: bcs.Address,
  threshold: bcs.u16(),
  key_server_set_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const UPGRADE_CAP_OBJECT_BCS = bcs.struct('UpgradeCapObjectTest', {
  id: bcs.Address,
  package: bcs.Address,
  version: bcs.u64(),
  policy: bcs.u8(),
});
const PROTOCOL_CONFIG_OBJECT_BCS = bcs.struct('ProtocolConfigObjectTest', {
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
const PROTOCOL_ADMIN_CAP_OBJECT_BCS = bcs.struct('ProtocolAdminCapObjectTest', {
  id: bcs.Address,
  version: bcs.u64(),
  config_id: bcs.Address,
});
const RAW_PACKAGE_CALL_CAP_BCS = bcs.struct('RawPackageCallCapTest', {
  version: bcs.u64(),
  authority_id: bcs.Address,
  catalog_id: bcs.Address,
  product_binding_commitment: bcs.byteVector(),
  role_binding_commitment: bcs.byteVector(),
  call_cap_set_commitment: bcs.byteVector(),
});
const RAW_EXACT_PACKAGE_BINDING_BCS = bcs.struct('RawExactPackageBindingTest', {
  original_package_id: bcs.Address,
  callable_package_id: bcs.Address,
  source_commitment: bcs.byteVector(),
  package_commitment: bcs.byteVector(),
  abi_commitment: bcs.byteVector(),
  commitment: bcs.byteVector(),
});
const RAW_PRODUCT_RELEASE_BINDING_BCS = bcs.struct('RawProductReleaseBindingTest', {
  version: bcs.u64(),
  native_capability_mask: bcs.u64(),
  core: RAW_EXACT_PACKAGE_BINDING_BCS,
  seal: RAW_EXACT_PACKAGE_BINDING_BCS,
  runtime: RAW_EXACT_PACKAGE_BINDING_BCS,
  output: RAW_EXACT_PACKAGE_BINDING_BCS,
  physical: RAW_EXACT_PACKAGE_BINDING_BCS,
  market: RAW_EXACT_PACKAGE_BINDING_BCS,
  release: RAW_EXACT_PACKAGE_BINDING_BCS,
  commitment: bcs.byteVector(),
});
const RAW_PACKAGE_CALL_CAP_SET_BCS = bcs.struct('RawPackageCallCapSetTest', {
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
const RAW_PRODUCT_RELEASE_CATALOG_BCS = bcs.struct('RawProductReleaseCatalogTest', {
  id: bcs.Address,
  version: bcs.u64(),
  protocol_config_id: bcs.Address,
  protocol_config_revision: bcs.u64(),
  protocol_config_commitment: bcs.byteVector(),
  binding: RAW_PRODUCT_RELEASE_BINDING_BCS,
  call_cap_set: RAW_PACKAGE_CALL_CAP_SET_BCS,
  seal_call_cap: bcs.option(RAW_PACKAGE_CALL_CAP_BCS),
  runtime_call_cap: bcs.option(RAW_PACKAGE_CALL_CAP_BCS),
  output_call_cap: bcs.option(RAW_PACKAGE_CALL_CAP_BCS),
  physical_call_cap: bcs.option(RAW_PACKAGE_CALL_CAP_BCS),
  market_call_cap: bcs.option(RAW_PACKAGE_CALL_CAP_BCS),
  release_call_cap: bcs.option(RAW_PACKAGE_CALL_CAP_BCS),
});
const SOURCE_REVISION = Object.freeze({
  gitCommit: 'a'.repeat(40),
  gitTree: 'b'.repeat(40),
  clean: true,
});
const PLAN_TOOLCHAIN = Object.freeze({
  suiVersion: '1.77.2',
  suiVersionOutput: 'sui 1.77.2-51d177ad7d65',
  suiSourceCommit: '51d177ad7d65102fc368b582408f466d97b31548',
  suiBinarySha256: MAINNET_V8_RELEASE_TOOLCHAIN.suiBinarySha256,
  frameworkRevision: '73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1',
});

function releasePlanFixture() {
  return buildMainnetV8ReleasePlan({
    sender: PRODUCTION_SENDER,
    sourceRevision: SOURCE_REVISION,
    toolchain: PLAN_TOOLCHAIN,
    sealPolicy: SEAL_POLICY_TEMPLATE,
    packages: MAINNET_V8_ROLE_ORDER.map((role) => ({
      role,
      packageName: MAINNET_V8_PACKAGE_NAMES[role],
      sourceArtifact: buildMainnetV8SourceArtifact({
        role,
        release: {
          gitCommit: SOURCE_REVISION.gitCommit,
          gitTree: SOURCE_REVISION.gitTree,
        },
        toolchain: PLAN_TOOLCHAIN,
        files: [
          mainnetV8SourceFileRecord('Move.toml', `[package]\nname = "${role}"`),
          mainnetV8SourceFileRecord('Move.lock', `[move]\nversion = ${role.length}`),
          mainnetV8SourceFileRecord(`sources/${role}_v8.move`, `module ${role}::${role}_v8 {}`),
        ],
      }),
    })),
  });
}

const RELEASE_PLAN = releasePlanFixture();

function transactionContext(sender = RELEASE_SENDER) {
  return Object.freeze({
    sender,
    gasPrice: '1000',
    gasBudget: '2000000000',
    epoch: '42',
    chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
    nonce: 7,
  });
}

function expectCode(code) {
  return (error) => error instanceof MainnetV8ReleaseError && error.code === code;
}

async function acceptFixtureSignedArtifact(artifact) {
  return Object.freeze({
    digest: artifact.digest,
    transactionBytes: fromBase64(artifact.transactionBase64),
  });
}

function bootstrapCatalogRawBcsFixture() {
  const bytes32 = (byte) => fromHex(hash32(byte));
  const catalogId = objectId(151);
  const exactBindings = Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role, index) => [
    role,
    {
      original_package_id: PACKAGE_IDS[role],
      callable_package_id: PACKAGE_IDS[role],
      source_commitment: bytes32(152 + index),
      package_commitment: bytes32(160 + index),
      abi_commitment: bytes32(168 + index),
      commitment: bytes32(176 + index),
    },
  ]));
  const raw = {
    id: catalogId,
    version: '8',
    protocol_config_id: objectId(184),
    protocol_config_revision: '2',
    protocol_config_commitment: bytes32(185),
    binding: {
      version: '8',
      native_capability_mask: '127',
      ...exactBindings,
      commitment: bytes32(186),
    },
    call_cap_set: {
      version: '8',
      catalog_id: catalogId,
      product_binding_commitment: bytes32(186),
      seal_authority_id: objectId(187),
      runtime_authority_id: objectId(188),
      output_authority_id: objectId(189),
      physical_authority_id: objectId(190),
      market_authority_id: objectId(191),
      release_authority_id: objectId(192),
      commitment: bytes32(193),
    },
    seal_call_cap: null,
    runtime_call_cap: null,
    output_call_cap: null,
    physical_call_cap: null,
    market_call_cap: null,
    release_call_cap: null,
  };
  const contentBcs = RAW_PRODUCT_RELEASE_CATALOG_BCS.serialize(raw).toBytes();
  const fields = structuredClone(raw);
  for (const role of MAINNET_V8_ROLE_ORDER.slice(1)) fields[`${role}_call_cap`] = [];
  return Object.freeze({
    reference: Object.freeze({ objectId: catalogId }),
    fields,
    contentBcsBase64: toBase64(contentBcs),
  });
}

function programmableKind(envelope) {
  const kind = bcs.TransactionKind.parse(envelope.transactionKindBytes);
  assert.equal(kind.$kind, 'ProgrammableTransaction');
  return kind.ProgrammableTransaction;
}

function moveCallTarget(command) {
  if (command.$kind !== 'MoveCall') return command.$kind;
  const call = command.MoveCall;
  return `${call.package}::${call.module}::${call.function}`;
}

async function publishEnvelope(sender = RELEASE_SENDER) {
  return await inspectMainnetV8Transaction(buildMainnetV8PublishTransaction({
    modules: ['AA==', 'AQI='],
    dependencies: [objectId(2), objectId(1)],
    transactionContext: transactionContext(sender),
  }));
}

function predecessorReadback(ordinal) {
  if (ordinal === 0) return null;
  const certificate = { kind: 'TEST_CERTIFICATE', ordinal: String(ordinal - 1) };
  return Object.freeze({
    ordinal: String(ordinal - 1),
    certificate: Object.freeze(certificate),
    certificateSha256: sha256MainnetV8Json(certificate),
  });
}

function readyProtocolProfile(envelope) {
  return Object.freeze({
    chainIdentifier: RELEASE_PLAN.chain.chainIdentifier,
    protocolVersion: '133',
    epoch: envelope.expiration.ValidDuring.minEpoch,
    gasPrice: envelope.gasPrice,
    attributes: Object.freeze({
      objectRuntimeMaxNumCachedObjects: '1000',
      objectRuntimeMaxNumStoreEntries: '1000',
    }),
  });
}

function readyGateFields(envelope, ordinal) {
  const protocolProfile = readyProtocolProfile(envelope);
  const gasUsed = Object.freeze({
    computationCost: '1',
    storageCost: '2',
    storageRebate: '0',
    nonRefundableStorageFee: '0',
  });
  const effectsBcsBase64 = toBase64(bcs.TransactionEffects.serialize({
    V1: {
      status: { Success: true },
      executedEpoch: protocolProfile.epoch,
      gasUsed,
      modifiedAtVersions: [],
      sharedObjects: [],
      transactionDigest: envelope.digest,
      created: [],
      mutated: [],
      unwrapped: [],
      deleted: [],
      unwrappedThenDeleted: [],
      wrapped: [],
      gasObject: [{
        objectId: objectId(79), version: '1', digest: objectDigest(79),
      }, { AddressOwner: envelope.sender }],
      eventsDigest: null,
      dependencies: [],
    },
  }).toBytes());
  return Object.freeze({
    publishedTomlSha256: sha256(`published-${ordinal}`),
    simulation: Object.freeze({
      digest: envelope.digest,
      effectsTransactionDigest: envelope.digest,
      effectsBcsBase64,
      gasUsed,
      recommendedGasBudget: envelope.gasBudget,
      changedObjects: Object.freeze([]),
      objectTypes: Object.freeze({}),
    }),
    gasFunding: Object.freeze({
      coinType: `0x${'0'.repeat(63)}2::sui::SUI`,
      addressBalance: envelope.gasBudget,
      coinBalance: '0',
      checkedAtEpoch: protocolProfile.epoch,
    }),
    protocolProfile,
    predecessorReadback: predecessorReadback(ordinal),
  });
}

async function matcherFixture(ordinal) {
  if (ordinal === 0) {
    const packageArtifact = buildMainnetV8PackageArtifact({
      role: 'core',
      modules: [
        { name: 'alpha', bytes: Uint8Array.of(0) },
        { name: 'beta', bytes: Uint8Array.of(1, 2) },
      ],
      dependencies: [objectId(1), objectId(2)],
      buildDigest: hash32(50),
    });
    const modules = packageArtifact.modules.map(({ bytesBase64 }) => bytesBase64);
    const dependencies = [...packageArtifact.dependencies];
    const envelope = await inspectMainnetV8Transaction(buildMainnetV8PublishTransaction({
      modules,
      dependencies,
      transactionContext: transactionContext(RELEASE_PLAN.sender),
    }));
    return Object.freeze({
      ordinal: '0',
      plan: RELEASE_PLAN,
      readyArtifact: Object.freeze({
        kind: 'PUBLISH',
        role: 'core',
        packageArtifact,
        packageCommitment: mainnetV8PackageCommitment(packageArtifact),
        modules: Object.freeze(modules),
        dependencies: Object.freeze(dependencies),
        ...readyGateFields(envelope, 0),
      }),
      unsignedEnvelope: durableMainnetV8UnsignedEnvelope(envelope),
    });
  }
  if (ordinal === 7) {
    const envelope = await inspectMainnetV8Transaction(buildMainnetV8InitTransaction({
      packageIds: PACKAGE_IDS,
      protocolConfig: PROTOCOL_CONFIG,
      protocolAdminCap: PROTOCOL_ADMIN_CAP,
      transactionContext: transactionContext(RELEASE_PLAN.sender),
    }));
    const stageData = Object.freeze({
      packageIds: PACKAGE_IDS,
      protocolConfig: PROTOCOL_CONFIG,
      protocolAdminCap: PROTOCOL_ADMIN_CAP,
    });
    return Object.freeze({
      ordinal: '7',
      plan: RELEASE_PLAN,
      readyArtifact: Object.freeze({
        kind: 'INITIALIZE_PROTOCOL',
        stageData,
        stageDataSha256: sha256MainnetV8Json(stageData),
        ...readyGateFields(envelope, 7),
      }),
      unsignedEnvelope: durableMainnetV8UnsignedEnvelope(envelope),
    });
  }
  assert.equal(ordinal, 8);
  const envelope = await inspectMainnetV8Transaction(buildMainnetV8BootstrapTransaction({
    packageIds: PACKAGE_IDS,
    protocolConfig: PROTOCOL_CONFIG,
    protocolAdminCap: PROTOCOL_ADMIN_CAP,
    commitments: COMMITMENTS,
    sealPolicy: SEAL_POLICY,
    transactionContext: transactionContext(RELEASE_PLAN.sender),
  }));
  const stageData = Object.freeze({
    packageIds: PACKAGE_IDS,
    protocolConfig: PROTOCOL_CONFIG,
    protocolAdminCap: PROTOCOL_ADMIN_CAP,
    commitments: COMMITMENTS,
    sealPolicy: SEAL_POLICY,
    keyServerCertificates: Object.freeze([Object.freeze({ objectId: SEAL_POLICY.keyServers[0].objectId })]),
  });
  return Object.freeze({
    ordinal: '8',
    plan: RELEASE_PLAN,
    readyArtifact: Object.freeze({
      kind: 'BOOTSTRAP_RELEASE',
      stageData,
      stageDataSha256: sha256MainnetV8Json(stageData),
      ...readyGateFields(envelope, 8),
    }),
    unsignedEnvelope: durableMainnetV8UnsignedEnvelope(envelope),
  });
}

function mutateUnsignedEnvelope(envelope, mutate) {
  const transactionData = bcs.TransactionData.parse(fromBase64(envelope.transactionBase64));
  assert.equal(transactionData.$kind, 'V1');
  mutate(transactionData.V1);
  const transactionBytes = bcs.TransactionData.serialize(transactionData).toBytes();
  const transactionKindBytes = bcs.TransactionKind.serialize(transactionData.V1.kind).toBytes();
  return Object.freeze({
    transactionBase64: toBase64(transactionBytes),
    transactionByteLength: String(transactionBytes.length),
    transactionSha256: sha256(transactionBytes),
    transactionKindBase64: toBase64(transactionKindBytes),
    transactionKindSha256: sha256(transactionKindBytes),
    digest: TransactionDataBuilder.getDigestFromBytes(transactionBytes),
    sender: transactionData.V1.sender,
    gasOwner: transactionData.V1.gasData.owner,
    gasBudget: String(transactionData.V1.gasData.budget),
    gasPrice: String(transactionData.V1.gasData.price),
    expiration: transactionData.V1.expiration,
  });
}

function programmableTransaction(transactionDataV1) {
  assert.equal(transactionDataV1.kind.$kind, 'ProgrammableTransaction');
  return transactionDataV1.kind.ProgrammableTransaction;
}

function replacePureInput(programmable, index, value) {
  assert.equal(programmable.inputs[index].$kind, 'Pure');
  programmable.inputs[index].Pure.bytes = toBase64(value);
}

async function assertMatcherRejects(fixture, label, mutate) {
  const unsignedEnvelope = mutateUnsignedEnvelope(fixture.unsignedEnvelope, mutate);
  await assert.rejects(
    assertMainnetV8TransactionMatchesReady({ ...fixture, unsignedEnvelope }),
    expectCode('MAINNET_V8_READY_TRANSACTION_DRIFT'),
    label,
  );
}

async function signEnvelopeFixture(input) {
  const envelope = input.transactionBytes === undefined
    ? hydrateMainnetV8UnsignedEnvelope(input)
    : input;
  const { signature } = await RELEASE_KEYPAIR.signTransaction(envelope.transactionBytes);
  const transactionData = bcs.TransactionData.parse(envelope.transactionBytes);
  const transactionSigner = transactionData.V1.sender;
  const senderSignedDataBytes = bcs.SenderSignedData.serialize([{
    intentMessage: {
      intent: {
        scope: { TransactionData: true },
        version: { V0: true },
        appId: { Sui: true },
      },
      value: transactionData,
    },
    txSignatures: [signature],
  }]).toBytes();
  const signatureBytes = fromBase64(signature);
  return Object.freeze({
    transactionBase64: envelope.transactionBase64,
    transactionSha256: envelope.transactionSha256,
    transactionKindBase64: envelope.transactionKindBase64,
    transactionKindSha256: envelope.transactionKindSha256,
    digest: envelope.digest,
    signature,
    signatureSha256: sha256(signatureBytes),
    senderSignedDataBase64: toBase64(senderSignedDataBytes),
    senderSignedDataSha256: sha256(senderSignedDataBytes),
    signer: transactionSigner,
  });
}

async function signedFixture() {
  const envelope = await publishEnvelope();
  return {
    envelope,
    artifact: await signEnvelopeFixture(envelope),
  };
}

function successfulFinalityFixture(signedArtifact, gasByte = 84, created = []) {
  const effectsBytes = bcs.TransactionEffects.serialize({
    V1: {
      status: { Success: true },
      executedEpoch: '42',
      gasUsed: {
        computationCost: '1',
        storageCost: '2',
        storageRebate: '0',
        nonRefundableStorageFee: '0',
      },
      modifiedAtVersions: [],
      sharedObjects: [],
      transactionDigest: signedArtifact.digest,
      created,
      mutated: [],
      unwrapped: [],
      deleted: [],
      unwrappedThenDeleted: [],
      wrapped: [],
      gasObject: [{
        objectId: objectId(gasByte),
        version: '7',
        digest: objectDigest(gasByte),
      }, { AddressOwner: signedArtifact.signer }],
      eventsDigest: null,
      dependencies: [],
    },
  }).toBytes();
  return Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    digest: signedArtifact.digest,
    checkpoint: '123',
    epoch: '42',
    transactionBase64: signedArtifact.transactionBase64,
    transactionSha256: signedArtifact.transactionSha256,
    signature: signedArtifact.signature,
    signatureSha256: signedArtifact.signatureSha256,
    effectsBcsBase64: toBase64(effectsBytes),
    effectsSha256: sha256(effectsBytes),
    effectsDigest: typedDigest('TransactionEffects', effectsBytes),
    effectsStatus: Object.freeze({ success: true, error: null }),
    eventsDigest: null,
    transactionEvents: null,
  });
}

async function createExecutionState(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'animacraft-mainnet-v8-runner-'));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const fixture = await matcherFixture(0);
  const readyEvidence = buildMainnetV8ReadyEvidence({
    ordinal: fixture.ordinal,
    attempt: '0',
    readyArtifact: fixture.readyArtifact,
    unsignedEnvelope: fixture.unsignedEnvelope,
  });
  await writeFile(
    join(stateDir, MAINNET_V8_PLAN_FILENAME),
    `${canonicalMainnetV8Json(fixture.plan)}\n`,
  );
  await createReleaseWal({
    path: join(stateDir, MAINNET_V8_WAL_FILENAME),
    plan: fixture.plan,
    event: { evidence: readyEvidence },
  });
  return Object.freeze({ stateDir, fixture });
}

async function publishReadyFixture(ordinal, predecessor) {
  const role = MAINNET_V8_ROLE_ORDER[ordinal];
  const roleDependencies = MAINNET_V8_ROLE_PUBLISH_DEPENDENCIES[role].map((dependencyRole) => {
    const dependencyOrdinal = MAINNET_V8_ROLE_ORDER.indexOf(dependencyRole);
    return objectId(88 + dependencyOrdinal * 5);
  });
  const packageArtifact = buildMainnetV8PackageArtifact({
    role,
    modules: [
      { name: 'alpha', bytes: Uint8Array.of(ordinal, 1) },
      { name: 'beta', bytes: Uint8Array.of(ordinal, 2) },
    ],
    dependencies: [objectId(1), objectId(2), ...roleDependencies],
    buildDigest: hash32(40 + ordinal),
  });
  const modules = packageArtifact.modules.map(({ bytesBase64 }) => bytesBase64);
  const dependencies = [...packageArtifact.dependencies];
  const envelope = await inspectMainnetV8Transaction(buildMainnetV8PublishTransaction({
    modules,
    dependencies,
    transactionContext: transactionContext(RELEASE_PLAN.sender),
  }));
  const readyArtifact = Object.freeze({
    kind: 'PUBLISH',
    role,
    packageArtifact,
    packageCommitment: mainnetV8PackageCommitment(packageArtifact),
    modules: Object.freeze(modules),
    dependencies: Object.freeze(dependencies),
    ...readyGateFields(envelope, ordinal),
    predecessorReadback: predecessor,
  });
  return Object.freeze({
    ordinal: String(ordinal),
    plan: RELEASE_PLAN,
    readyArtifact,
    unsignedEnvelope: durableMainnetV8UnsignedEnvelope(envelope),
  });
}

async function appendWalFixture(stateDir, wal, event) {
  return appendReleaseWal({
    path: join(stateDir, MAINNET_V8_WAL_FILENAME),
    expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256,
    event,
  });
}

async function createSevenPublishFinalizedState(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'animacraft-mainnet-v8-seven-publish-'));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  await writeFile(
    join(stateDir, MAINNET_V8_PLAN_FILENAME),
    `${canonicalMainnetV8Json(RELEASE_PLAN)}\n`,
  );
  let predecessor = null;
  let fixture = await publishReadyFixture(0, predecessor);
  let ready = buildMainnetV8ReadyEvidence({
    ordinal: fixture.ordinal,
    attempt: '0',
    readyArtifact: fixture.readyArtifact,
    unsignedEnvelope: fixture.unsignedEnvelope,
  });
  let wal = await createReleaseWal({
    path: join(stateDir, MAINNET_V8_WAL_FILENAME),
    plan: RELEASE_PLAN,
    event: { evidence: ready },
  });

  for (let ordinal = 0; ordinal < MAINNET_V8_ROLE_ORDER.length; ordinal += 1) {
    const signedArtifact = await signEnvelopeFixture(fixture.unsignedEnvelope);
    const signed = buildMainnetV8SignedEvidence({
      ordinal: fixture.ordinal,
      attempt: '0',
      readyArtifactSha256: ready.readyArtifactSha256,
      signedArtifact,
    });
    wal = await appendWalFixture(stateDir, wal, {
      ordinal: fixture.ordinal,
      attempt: '0',
      status: 'SIGNED',
      evidence: signed,
    });
    const outcomeInput = {
      ordinal: fixture.ordinal,
      attempt: '0',
      readyArtifactSha256: ready.readyArtifactSha256,
      signedArtifact,
      signedArtifactSha256: signed.signedArtifactSha256,
      digest: signedArtifact.digest,
    };
    const queryIntent = buildMainnetV8OutcomeEvidence({
      ...outcomeInput,
      status: 'OUTCOME_PENDING',
      observation: { kind: 'QUERY_INTENT', details: {} },
    });
    wal = await appendWalFixture(stateDir, wal, {
      ordinal: fixture.ordinal,
      attempt: '0',
      status: 'OUTCOME_PENDING',
      evidence: queryIntent,
    });

    const { finalityEvidence, readback } = publishCertificationFixture(
      fixture,
      signedArtifact,
      ordinal,
    );
    const pendingDetails = Object.freeze({
      finalityEvidence,
      finalityEvidenceSha256: sha256MainnetV8Json(finalityEvidence),
    });
    const pending = buildMainnetV8OutcomeEvidence({
      ...outcomeInput,
      status: 'FINALIZED_SUCCESS_PENDING_READBACK',
      observation: pendingDetails,
    });
    wal = await appendWalFixture(stateDir, wal, {
      ordinal: fixture.ordinal,
      attempt: '0',
      status: 'FINALIZED_SUCCESS_PENDING_READBACK',
      evidence: pending,
    });
    const certificate = Object.freeze({
      finalityEvidence,
      finalityEvidenceSha256: sha256MainnetV8Json(finalityEvidence),
      readback,
      readbackSha256: sha256MainnetV8Json(readback),
    });
    const finalizedDetails = Object.freeze({
      packageArtifact: fixture.readyArtifact.packageArtifact,
      packageCommitment: fixture.readyArtifact.packageCommitment,
      abiArtifact: readback.package.abiArtifact,
      abiCommitment: sha256MainnetV8Json(readback.package.abiArtifact),
      certificate,
      certificateSha256: sha256MainnetV8Json(certificate),
    });
    const finalized = buildMainnetV8OutcomeEvidence({
      ...outcomeInput,
      status: 'FINALIZED_SUCCESS',
      observation: finalizedDetails,
    });
    wal = await appendWalFixture(stateDir, wal, {
      ordinal: fixture.ordinal,
      attempt: '0',
      status: 'FINALIZED_SUCCESS',
      evidence: finalized,
    });
    predecessor = Object.freeze({
      ordinal: fixture.ordinal,
      certificate: finalizedDetails,
      certificateSha256: sha256MainnetV8Json(finalizedDetails),
    });
    if (ordinal + 1 < MAINNET_V8_ROLE_ORDER.length) {
      fixture = await publishReadyFixture(ordinal + 1, predecessor);
      ready = buildMainnetV8ReadyEvidence({
        ordinal: fixture.ordinal,
        attempt: '0',
        readyArtifact: fixture.readyArtifact,
        unsignedEnvelope: fixture.unsignedEnvelope,
      });
      wal = await appendWalFixture(stateDir, wal, {
        ordinal: fixture.ordinal,
        attempt: '0',
        status: 'READY',
        evidence: ready,
      });
    }
  }
  return Object.freeze({ stateDir, wal });
}

async function coldHead(stateDir) {
  const wal = await readReleaseWal({ path: join(stateDir, MAINNET_V8_WAL_FILENAME) });
  return Object.freeze({ wal, event: wal.events.at(-1) });
}

function coldHeadSync(stateDir) {
  const wal = JSON.parse(readFileSync(join(stateDir, MAINNET_V8_WAL_FILENAME), 'utf8'));
  assert.equal(wal.events.at(-1).eventSha256, wal.headEventSha256);
  return Object.freeze({ wal, event: wal.events.at(-1) });
}

function durableState(event) {
  return event.status === 'OUTCOME_PENDING'
    ? `${event.status}/${event.evidence.observation.kind}`
    : event.status;
}

function publishCertificationFixture(fixture, signedArtifact, ordinal = 0) {
  const role = MAINNET_V8_ROLE_ORDER[ordinal];
  const base = 88 + ordinal * 5;
  const packageId = objectId(base);
  const upgradeCapId = objectId(base + 1);
  const protocolConfigId = objectId(base + 2);
  const protocolAdminCapId = objectId(base + 3);
  const references = Object.freeze({
    package: Object.freeze({ objectId: packageId, version: '1', digest: objectDigest(base) }),
    upgradeCap: Object.freeze({ objectId: upgradeCapId, version: '1', digest: objectDigest(base + 1) }),
    protocolConfig: Object.freeze({ objectId: protocolConfigId, version: '1', digest: objectDigest(base + 2) }),
    protocolAdminCap: Object.freeze({ objectId: protocolAdminCapId, version: '1', digest: objectDigest(base + 3) }),
  });
  const created = [
    [references.package, { Immutable: true }],
    [references.upgradeCap, { AddressOwner: fixture.plan.sender }],
    ...(role === 'core' ? [
      [references.protocolConfig, { Shared: { initialSharedVersion: '1' } }],
      [references.protocolAdminCap, { AddressOwner: fixture.plan.sender }],
    ] : []),
  ];
  const finalityEvidence = successfulFinalityFixture(signedArtifact, base + 4, created);
  const descriptor = Object.freeze({
    modules: Object.freeze([
      Object.freeze({ name: 'alpha', datatypes: Object.freeze([]), functions: Object.freeze([]) }),
      Object.freeze({ name: 'beta', datatypes: Object.freeze([]), functions: Object.freeze([]) }),
    ]),
  });
  const abiArtifact = buildMainnetV8AbiArtifact({
    role,
    descriptor,
  });
  const moveOutput = ({ reference, type, owner, fields, contentBytes }) => Object.freeze({
    reference,
    type,
    owner,
    previousTransaction: signedArtifact.digest,
    fields,
    contentBcsBase64: toBase64(contentBytes),
    contentBcsSha256: sha256(contentBytes),
    objectBcsBase64: toBase64(contentBytes),
    objectBcsSha256: sha256(contentBytes),
  });
  const readback = Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'PACKAGE_PUBLISH_CERTIFICATE',
    role,
    transactionDigest: signedArtifact.digest,
    package: Object.freeze({
      schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
      role,
      transactionDigest: signedArtifact.digest,
      reference: Object.freeze({
        operation: 'CREATED',
        ...references.package,
        owner: Object.freeze({ kind: 'Immutable' }),
      }),
      moduleMapSha256: sha256MainnetV8Json(Object.fromEntries(
        fixture.readyArtifact.packageArtifact.modules.map((module) => [
          module.name,
          module.bytesBase64,
        ]),
      )),
      objectBcsSha256: hash32(base),
      typeOrigins: Object.freeze([]),
      linkage: Object.freeze(fixture.readyArtifact.packageArtifact.dependencies.map(
        (dependency) => Object.freeze({
          originalId: dependency,
          upgradedId: dependency,
          upgradedVersion: '1',
        }),
      )),
      descriptor,
      abiArtifact,
    }),
    upgradeCap: moveOutput({
      reference: references.upgradeCap,
      type: `${`0x${'0'.repeat(63)}2`}::package::UpgradeCap`,
      owner: Object.freeze({ AddressOwner: fixture.plan.sender }),
      contentBytes: UPGRADE_CAP_OBJECT_BCS.serialize({
        id: upgradeCapId,
        package: packageId,
        version: '1',
        policy: 0,
      }).toBytes(),
      fields: Object.freeze({
        id: Object.freeze({ id: upgradeCapId }),
        package: packageId,
        policy: 0,
        version: '1',
      }),
    }),
    protocolConfig: role === 'core' ? moveOutput({
      reference: references.protocolConfig,
      type: `${packageId}::protocol_config_v8::ProtocolConfigV8`,
      owner: Object.freeze({ Shared: Object.freeze({ initial_shared_version: '1' }) }),
      contentBytes: PROTOCOL_CONFIG_OBJECT_BCS.serialize({
        id: protocolConfigId,
        version: '8',
        core_original_package_id: packageId,
        core_callable_package_id: packageId,
        revision: '0',
        treasury_id: null,
        payment_coin_type: MAINNET_V8_USDC_TYPE,
        primary_content_fee_bps: 1000,
        fixed_complete_fee_atomic: '0',
        maker_market_fee_bps: 250,
        soul_market_fee_bps: 250,
        enabled: false,
        commitment: fromHex(deriveMainnetV8ProtocolConfigCommitment({
          configId: protocolConfigId,
          coreOriginalPackageId: packageId,
          coreCallablePackageId: packageId,
          revision: '0',
          treasuryId: null,
          enabled: false,
        })),
      }).toBytes(),
      fields: Object.freeze({
        id: Object.freeze({ id: protocolConfigId }),
        version: '8',
        core_original_package_id: packageId,
        core_callable_package_id: packageId,
        revision: '0',
        treasury_id: null,
        payment_coin_type: MAINNET_V8_USDC_TYPE,
        primary_content_fee_bps: 1000,
        fixed_complete_fee_atomic: '0',
        maker_market_fee_bps: 250,
        soul_market_fee_bps: 250,
        enabled: false,
        commitment: toBase64(fromHex(deriveMainnetV8ProtocolConfigCommitment({
          configId: protocolConfigId,
          coreOriginalPackageId: packageId,
          coreCallablePackageId: packageId,
          revision: '0',
          treasuryId: null,
          enabled: false,
        }))),
      }),
    }) : null,
    protocolAdminCap: role === 'core' ? moveOutput({
      reference: references.protocolAdminCap,
      type: `${packageId}::protocol_config_v8::ProtocolAdminCapV8`,
      owner: Object.freeze({ AddressOwner: fixture.plan.sender }),
      contentBytes: PROTOCOL_ADMIN_CAP_OBJECT_BCS.serialize({
        id: protocolAdminCapId,
        version: '8',
        config_id: protocolConfigId,
      }).toBytes(),
      fields: Object.freeze({
        id: Object.freeze({ id: protocolAdminCapId }),
        version: '8',
        config_id: protocolConfigId,
      }),
    }) : null,
  });
  return Object.freeze({ finalityEvidence, readback });
}

test('release CLI parsing keeps all three Mainnet write gates explicit and rejects ambiguity', () => {
  assert.deepEqual(parseMainnetV8ReleaseArgs([]), { command: 'status', options: {} });
  assert.deepEqual(parseMainnetV8ReleaseArgs([
    'run', '--state-dir', '/tmp/release-state', '--sui-binary', '/tmp/sui',
    '--confirm-mainnet', '--allow-signing', '--allow-broadcast',
    '--repair-readback-incident', '--maximum-transitions', '1', '--json',
  ]), {
    command: 'run',
    options: {
      'state-dir': '/tmp/release-state',
      'sui-binary': '/tmp/sui',
      'confirm-mainnet': true,
      'allow-signing': true,
      'allow-broadcast': true,
      'repair-readback-incident': true,
      'maximum-transitions': '1',
      json: true,
    },
  });

  assert.throws(
    () => parseMainnetV8ReleaseArgs(['destroy']),
    expectCode('MAINNET_V8_COMMAND_INVALID'),
  );
  assert.throws(
    () => parseMainnetV8ReleaseArgs(['run', 'positional']),
    expectCode('MAINNET_V8_ARGUMENT_INVALID'),
  );
  assert.throws(
    () => parseMainnetV8ReleaseArgs(['run', '--state-dir']),
    expectCode('MAINNET_V8_ARGUMENT_INVALID'),
  );
  assert.throws(
    () => parseMainnetV8ReleaseArgs(['run', '--state-dir', 'one', '--state-dir', 'two']),
    expectCode('MAINNET_V8_ARGUMENT_INVALID'),
  );
  assert.throws(
    () => parseMainnetV8ReleaseArgs(['run', '--allow-signing', 'false']),
    expectCode('MAINNET_V8_ARGUMENT_INVALID'),
  );
});

test('write gate requires the exact conjunction of confirmation, signing, and broadcast authority', () => {
  for (let mask = 0; mask < 7; mask += 1) {
    const options = {
      'confirm-mainnet': Boolean(mask & 1),
      'allow-signing': Boolean(mask & 2),
      'allow-broadcast': Boolean(mask & 4),
    };
    assert.throws(
      () => assertMainnetV8WriteGates(options),
      expectCode('MAINNET_V8_EXECUTION_DISABLED'),
    );
  }
  assert.equal(assertMainnetV8WriteGates({
    'confirm-mainnet': true,
    'allow-signing': true,
    'allow-broadcast': true,
  }), undefined);
  assert.throws(
    () => assertMainnetV8WriteGates({
      'confirm-mainnet': true,
      'allow-signing': true,
      'allow-broadcast': 'true',
    }),
    expectCode('MAINNET_V8_EXECUTION_DISABLED'),
  );
});

test('protocol-133 toolchain identity remains pinned in the runner-facing contract', () => {
  assert.deepEqual(MAINNET_V8_RELEASE_TOOLCHAIN, {
    suiVersion: '1.77.2',
    suiSourceCommit: '51d177ad7d65102fc368b582408f466d97b31548',
    suiVersionOutput: 'sui 1.77.2-51d177ad7d65',
    suiBinarySha256: '91ec4642a3650d65af334728c09e19972833c12f27eafeccc3ce8cc2ac3e007c',
    protocolVersion: '133',
    objectRuntimeMaxCachedObjects: '1000',
    objectRuntimeMaxStoreEntries: '1000',
    frameworkRevision: '73dd2c2ba6f9fdb21d7ffde2b50a3f2f0ac39bc1',
  });
});

test('fresh source archive ignores mutable checkout state and validates all seven plan artifacts', async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'animacraft-mainnet-v8-source-'));
  t.after(async () => rm(repositoryRoot, { recursive: true, force: true }));
  const contents = Object.fromEntries(MAINNET_V8_ROLE_ORDER.map((role) => {
    const packageName = MAINNET_V8_PACKAGE_NAMES[role];
    return [role, Object.freeze({
      moveToml: `[package]\nname = "${packageName}"\nedition = "2024"\n`,
      moveLock: '[move]\nversion = 3\n',
      source: `module 0x0::${role}_v8 { public fun role(): u8 { ${role.length} } }\n`,
    })];
  }));
  await Promise.all(MAINNET_V8_ROLE_ORDER.map(async (role) => {
    const packageDirectory = join(repositoryRoot, 'move', MAINNET_V8_PACKAGE_NAMES[role]);
    await mkdir(join(packageDirectory, 'sources'), { recursive: true });
    await Promise.all([
      writeFile(join(packageDirectory, 'Move.toml'), contents[role].moveToml),
      writeFile(join(packageDirectory, 'Move.lock'), contents[role].moveLock),
      writeFile(join(packageDirectory, 'sources', `${role}_v8.move`), contents[role].source),
    ]);
  }));
  await execFileAsync('git', ['init', '-q'], { cwd: repositoryRoot });
  await execFileAsync('git', ['add', '.'], { cwd: repositoryRoot });
  await execFileAsync('git', [
    '-c', 'user.name=Animacraft Test',
    '-c', 'user.email=animacraft-test@example.invalid',
    'commit', '-qm', 'fixture',
  ], { cwd: repositoryRoot });
  const [{ stdout: commitOutput }, { stdout: treeOutput }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
    execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot }),
  ]);
  const sourceRevision = Object.freeze({
    gitCommit: commitOutput.trim(),
    gitTree: treeOutput.trim(),
    clean: true,
  });
  const planFor = (coreSource = contents.core.source) => buildMainnetV8ReleasePlan({
    sender: PRODUCTION_SENDER,
    sourceRevision,
    toolchain: PLAN_TOOLCHAIN,
    sealPolicy: SEAL_POLICY_TEMPLATE,
    packages: MAINNET_V8_ROLE_ORDER.map((role) => ({
      role,
      packageName: MAINNET_V8_PACKAGE_NAMES[role],
      sourceArtifact: buildMainnetV8SourceArtifact({
        role,
        release: {
          gitCommit: sourceRevision.gitCommit,
          gitTree: sourceRevision.gitTree,
        },
        toolchain: PLAN_TOOLCHAIN,
        files: [
          mainnetV8SourceFileRecord('Move.toml', contents[role].moveToml),
          mainnetV8SourceFileRecord('Move.lock', contents[role].moveLock),
          mainnetV8SourceFileRecord(
            `sources/${role}_v8.move`,
            role === 'core' ? coreSource : contents[role].source,
          ),
        ],
      }),
    })),
  });
  const plan = planFor();
  const first = await inspectMainnetV8FreshSourceArchive({ repositoryRoot, plan });
  assert.deepEqual(first.git, {
    commit: sourceRevision.gitCommit,
    tree: sourceRevision.gitTree,
  });
  assert.deepEqual(first.sourceCommitments, Object.fromEntries(
    plan.packages.map((entry) => [entry.role, entry.sourceCommitment]),
  ));

  const tamperedCore = `${contents.core.source}// mutable working-tree drift\n`;
  await writeFile(
    join(repositoryRoot, 'move', MAINNET_V8_PACKAGE_NAMES.core, 'sources', 'core_v8.move'),
    tamperedCore,
  );
  const second = await inspectMainnetV8FreshSourceArchive({ repositoryRoot, plan });
  assert.deepEqual(second, first, 'approved commit archive must ignore later working-tree mutation');
  await assert.rejects(
    inspectMainnetV8FreshSourceArchive({ repositoryRoot, plan: planFor(tamperedCore) }),
    expectCode('MAINNET_V8_SOURCE_ARTIFACT_DRIFT'),
  );
});

test('ProtocolConfig commitments match independent initial/enabled BCS and bind every mutable input', () => {
  const initial = Object.freeze({
    configId: objectId(100),
    coreOriginalPackageId: objectId(101),
    coreCallablePackageId: objectId(102),
    revision: '0',
    treasuryId: null,
    enabled: false,
  });
  const expected = (input) => sha256(PROTOCOL_COMMITMENT_INPUT_BCS.serialize({
    domain: new TextEncoder().encode('animacraft-v8/protocol-config'),
    version: '8',
    config_id: input.configId,
    core_original_package_id: input.coreOriginalPackageId,
    core_callable_package_id: input.coreCallablePackageId,
    revision: input.revision,
    treasury_id: input.treasuryId,
    payment_coin_type: MAINNET_V8_USDC_TYPE,
    primary_content_fee_bps: 1000,
    fixed_complete_fee_atomic: '0',
    maker_market_fee_bps: 250,
    soul_market_fee_bps: 250,
    enabled: input.enabled,
  }).toBytes());
  const initialCommitment = deriveMainnetV8ProtocolConfigCommitment(initial);
  assert.equal(initialCommitment, expected(initial));

  const enabled = Object.freeze({
    ...initial,
    revision: '2',
    treasuryId: objectId(103),
    enabled: true,
  });
  assert.equal(deriveMainnetV8ProtocolConfigCommitment(enabled), expected(enabled));

  const mutations = [
    { configId: objectId(104) },
    { coreOriginalPackageId: objectId(105) },
    { coreCallablePackageId: objectId(106) },
    { revision: '1' },
    { treasuryId: objectId(107) },
    { enabled: true },
  ];
  for (const mutation of mutations) {
    assert.notEqual(
      deriveMainnetV8ProtocolConfigCommitment({ ...initial, ...mutation }),
      initialCommitment,
    );
  }
  assert.throws(
    () => deriveMainnetV8ProtocolConfigCommitment({ ...initial, configId: '0x1' }),
    expectCode('MAINNET_V8_ADDRESS_INVALID'),
  );
  assert.throws(
    () => deriveMainnetV8ProtocolConfigCommitment({ ...initial, enabled: 1 }),
    expectCode('MAINNET_V8_MOVE_BOOL_INVALID'),
  );
});

test('Seal policy commitment matches independent BCS and rejects binding drift', () => {
  const input = Object.freeze({
    protocolConfigId: objectId(110),
    catalogId: objectId(111),
    productBindingCommitment: hash32(112),
    sealOriginalPackageId: objectId(113),
    sealCallablePackageId: objectId(114),
    sealBindingCommitment: hash32(115),
    sealAuthorityId: objectId(116),
    callCapSetCommitment: hash32(117),
    sealPolicy: SEAL_POLICY,
  });
  const expected = sha256(SEAL_COMMITMENT_INPUT_BCS.serialize({
    domain: new TextEncoder().encode('animacraft-v8/seal/policy'),
    version: '8',
    protocol_config_id: input.protocolConfigId,
    protocol_config_revision: '2',
    catalog_id: input.catalogId,
    product_binding_commitment: fromHex(input.productBindingCommitment),
    seal_original_package_id: input.sealOriginalPackageId,
    seal_callable_package_id: input.sealCallablePackageId,
    seal_binding_commitment: fromHex(input.sealBindingCommitment),
    seal_authority_id: input.sealAuthorityId,
    call_cap_set_commitment: fromHex(input.callCapSetCommitment),
    key_servers: input.sealPolicy.keyServers.map((entry) => ({
      key_server_id: entry.objectId,
      weight: Number(entry.weight),
    })),
    threshold: Number(input.sealPolicy.threshold),
    key_server_set_commitment: fromHex(input.sealPolicy.keyServerSetCommitment),
    encryption_policy_commitment: fromHex(input.sealPolicy.encryptionPolicyCommitment),
  }).toBytes());
  const commitment = deriveMainnetV8SealPolicyCommitment(input);
  assert.equal(commitment, expected);

  for (const mutation of [
    { protocolConfigId: objectId(118) },
    { catalogId: objectId(119) },
    { productBindingCommitment: hash32(120) },
    { sealOriginalPackageId: objectId(121) },
    { sealCallablePackageId: objectId(122) },
    { sealBindingCommitment: hash32(123) },
    { sealAuthorityId: objectId(124) },
    { callCapSetCommitment: hash32(125) },
  ]) {
    assert.notEqual(deriveMainnetV8SealPolicyCommitment({ ...input, ...mutation }), commitment);
  }
  assert.throws(
    () => deriveMainnetV8SealPolicyCommitment({ ...input, callCapSetCommitment: 'bad' }),
    expectCode('MAINNET_V8_HASH_INVALID'),
  );
  assert.throws(
    () => deriveMainnetV8SealPolicyCommitment({ ...input, sealAuthorityId: '0x2' }),
    expectCode('MAINNET_V8_ADDRESS_INVALID'),
  );
});

test('protocol init event certificate binds order, Core package, signer, and both commitments', () => {
  const protocolConfigId = objectId(130);
  const treasuryId = objectId(131);
  const intermediateCommitment = deriveMainnetV8ProtocolConfigCommitment({
    configId: protocolConfigId,
    coreOriginalPackageId: PACKAGE_IDS.core,
    coreCallablePackageId: PACKAGE_IDS.core,
    revision: '1',
    treasuryId,
    enabled: false,
  });
  const finalCommitment = deriveMainnetV8ProtocolConfigCommitment({
    configId: protocolConfigId,
    coreOriginalPackageId: PACKAGE_IDS.core,
    coreCallablePackageId: PACKAGE_IDS.core,
    revision: '2',
    treasuryId,
    enabled: true,
  });
  const finalityEvidence = finalityEventFixture([
    {
      package_id: PACKAGE_IDS.core,
      transaction_module: 'protocol_config_v8',
      sender: RELEASE_SENDER,
      event_type: eventStructTag(
        `${PACKAGE_IDS.core}::protocol_config_v8::ProtocolTreasuryV8Initialized`,
      ),
      contents: TREASURY_INITIALIZED_EVENT_BCS.serialize({
        config_id: protocolConfigId,
        treasury_id: treasuryId,
        revision: '1',
        commitment: fromHex(intermediateCommitment),
      }).toBytes(),
    },
    {
      package_id: PACKAGE_IDS.core,
      transaction_module: 'protocol_config_v8',
      sender: RELEASE_SENDER,
      event_type: eventStructTag(
        `${PACKAGE_IDS.core}::protocol_config_v8::ProtocolV8EnabledChanged`,
      ),
      contents: ENABLED_CHANGED_EVENT_BCS.serialize({
        config_id: protocolConfigId,
        revision: '2',
        enabled: true,
        commitment: fromHex(finalCommitment),
      }).toBytes(),
    },
  ]);
  const options = {
    finalityEvidence,
    packageIds: PACKAGE_IDS,
    signer: RELEASE_SENDER,
    protocolConfigId,
    treasuryId,
  };
  const certified = assertMainnetV8ProtocolInitEvents(options);
  assert.equal(certified.intermediateCommitment, intermediateCommitment);
  assert.equal(certified.finalCommitment, finalCommitment);

  const mutations = [
    ['event order', (events) => events.reverse()],
    ['package', (events) => { events[0].package_id = objectId(132); }],
    ['sender', (events) => { events[0].sender = objectId(133); }],
    ['intermediate commitment', (events) => {
      const value = TREASURY_INITIALIZED_EVENT_BCS.parse(Uint8Array.from(events[0].contents));
      value.commitment = fromHex(hash32(134));
      events[0].contents = TREASURY_INITIALIZED_EVENT_BCS.serialize(value).toBytes();
    }],
    ['final commitment', (events) => {
      const value = ENABLED_CHANGED_EVENT_BCS.parse(Uint8Array.from(events[1].contents));
      value.commitment = fromHex(hash32(135));
      events[1].contents = ENABLED_CHANGED_EVENT_BCS.serialize(value).toBytes();
    }],
  ];
  for (const [label, mutate] of mutations) {
    assert.throws(
      () => assertMainnetV8ProtocolInitEvents({
        ...options,
        finalityEvidence: mutateFinalityEvents(finalityEvidence, mutate),
      }),
      expectCode('MAINNET_V8_PROTOCOL_EVENT_DRIFT'),
      label,
    );
  }
});

test('bootstrap event certificate binds Seal package, signer, cardinality, and policy commitment', () => {
  const sealConfigId = objectId(140);
  const catalogId = objectId(141);
  const sealPolicyCommitment = deriveMainnetV8SealPolicyCommitment({
    protocolConfigId: objectId(142),
    catalogId,
    productBindingCommitment: hash32(143),
    sealOriginalPackageId: PACKAGE_IDS.seal,
    sealCallablePackageId: PACKAGE_IDS.seal,
    sealBindingCommitment: hash32(144),
    sealAuthorityId: objectId(145),
    callCapSetCommitment: hash32(146),
    sealPolicy: SEAL_POLICY,
  });
  const finalityEvidence = finalityEventFixture([{
    package_id: PACKAGE_IDS.seal,
    transaction_module: 'seal_v8',
    sender: RELEASE_SENDER,
    event_type: eventStructTag(`${PACKAGE_IDS.seal}::seal_v8::SealPolicyCreatedV8`),
    contents: SEAL_POLICY_CREATED_EVENT_BCS.serialize({
      config_id: sealConfigId,
      catalog_id: catalogId,
      threshold: Number(SEAL_POLICY.threshold),
      key_server_set_commitment: fromHex(SEAL_POLICY.keyServerSetCommitment),
      commitment: fromHex(sealPolicyCommitment),
    }).toBytes(),
  }]);
  const options = {
    finalityEvidence,
    packageIds: PACKAGE_IDS,
    signer: RELEASE_SENDER,
    sealConfigId,
    catalogId,
    sealPolicy: SEAL_POLICY,
    sealPolicyCommitment,
  };
  assert.deepEqual(
    assertMainnetV8BootstrapEvents(options).config_id,
    sealConfigId,
  );

  const mutations = [
    ['package', 'MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', (events) => {
      events[0].package_id = objectId(147);
    }],
    ['sender', 'MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', (events) => {
      events[0].sender = objectId(148);
    }],
    ['key-server commitment', 'MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', (events) => {
      const value = SEAL_POLICY_CREATED_EVENT_BCS.parse(Uint8Array.from(events[0].contents));
      value.key_server_set_commitment = fromHex(hash32(149));
      events[0].contents = SEAL_POLICY_CREATED_EVENT_BCS.serialize(value).toBytes();
    }],
    ['policy commitment', 'MAINNET_V8_BOOTSTRAP_EVENT_DRIFT', (events) => {
      const value = SEAL_POLICY_CREATED_EVENT_BCS.parse(Uint8Array.from(events[0].contents));
      value.commitment = fromHex(hash32(150));
      events[0].contents = SEAL_POLICY_CREATED_EVENT_BCS.serialize(value).toBytes();
    }],
    ['cardinality', 'MAINNET_V8_BOOTSTRAP_EVENT_CARDINALITY', (events) => {
      events.push(structuredClone(events[0]));
    }],
  ];
  for (const [label, code, mutate] of mutations) {
    assert.throws(
      () => assertMainnetV8BootstrapEvents({
        ...options,
        finalityEvidence: mutateFinalityEvents(finalityEvidence, mutate),
      }),
      expectCode(code),
      label,
    );
  }
});

test('bootstrap historical raw BCS rejects decoded JSON, object identity, and byte drift', () => {
  const catalog = bootstrapCatalogRawBcsFixture();
  const parsed = RAW_PRODUCT_RELEASE_CATALOG_BCS.parse(fromBase64(catalog.contentBcsBase64));
  assert.equal(parsed.id, catalog.reference.objectId);
  assert.equal(String(parsed.protocol_config_revision), '2');

  const jsonDrift = clone(catalog);
  jsonDrift.fields.protocol_config_revision = '3';
  assert.throws(
    () => assertMainnetV8BootstrapRawBcs({ catalog: jsonDrift, configs: {} }),
    expectCode('MAINNET_V8_BOOTSTRAP_BCS_DRIFT'),
    'decoded JSON cannot override raw historical BCS',
  );

  const identityDrift = clone(catalog);
  identityDrift.reference.objectId = objectId(194);
  assert.throws(
    () => assertMainnetV8BootstrapRawBcs({ catalog: identityDrift, configs: {} }),
    expectCode('MAINNET_V8_BOOTSTRAP_BCS_DRIFT'),
    'object reference must equal the raw UID',
  );

  const truncated = clone(catalog);
  const raw = fromBase64(truncated.contentBcsBase64);
  truncated.contentBcsBase64 = toBase64(raw.slice(0, -1));
  assert.throws(
    () => assertMainnetV8BootstrapRawBcs({ catalog: truncated, configs: {} }),
    expectCode('MAINNET_V8_OUTPUT_BCS_INVALID'),
    'truncated historical contents cannot be decoded as canonical BCS',
  );
});

test('publish TransactionKind publishes exact bytes/dependencies then transfers its UpgradeCap', async () => {
  const envelope = await publishEnvelope();
  const kind = programmableKind(envelope);
  assert.deepEqual(kind.commands.map(({ $kind }) => $kind), ['Publish', 'TransferObjects']);
  assert.deepEqual(kind.commands[0].Publish, {
    modules: ['AA==', 'AQI='],
    dependencies: [objectId(2), objectId(1)],
  });
  assert.deepEqual(kind.commands[1].TransferObjects.objects, [{ Result: 0, $kind: 'Result' }]);
  const addressArgument = kind.commands[1].TransferObjects.address;
  assert.equal(addressArgument.$kind, 'Input');
  assert.equal(
    bcs.Address.parse(fromBase64(kind.inputs[addressArgument.Input].Pure.bytes)),
    RELEASE_SENDER,
  );
});

test('init TransactionKind initializes the USDC treasury before enabling protocol', async () => {
  const envelope = await inspectMainnetV8Transaction(buildMainnetV8InitTransaction({
    packageIds: PACKAGE_IDS,
    protocolConfig: PROTOCOL_CONFIG,
    protocolAdminCap: PROTOCOL_ADMIN_CAP,
    transactionContext: transactionContext(),
  }));
  const kind = programmableKind(envelope);
  assert.deepEqual(kind.commands.map(moveCallTarget), [
    `${PACKAGE_IDS.core}::protocol_config_v8::initialize_protocol_treasury_v8`,
    `${PACKAGE_IDS.core}::protocol_config_v8::set_protocol_enabled_v8`,
  ]);
  assert.deepEqual(kind.commands[0].MoveCall.typeArguments, [MAINNET_V8_USDC_TYPE]);
  assert.equal(kind.inputs[0].Object.SharedObject.mutable, true);
  assert.equal(kind.inputs[0].Object.SharedObject.objectId, PROTOCOL_CONFIG.objectId);
  assert.equal(kind.inputs[1].Object.ImmOrOwnedObject.objectId, PROTOCOL_ADMIN_CAP.objectId);
});

test('bootstrap TransactionKind certifies seven commitments then takes, creates, and shares configs in role order', async () => {
  const envelope = await inspectMainnetV8Transaction(buildMainnetV8BootstrapTransaction({
    packageIds: PACKAGE_IDS,
    protocolConfig: PROTOCOL_CONFIG,
    protocolAdminCap: PROTOCOL_ADMIN_CAP,
    commitments: COMMITMENTS,
    sealPolicy: SEAL_POLICY,
    transactionContext: transactionContext(),
  }));
  const kind = programmableKind(envelope);
  const configModules = {
    seal: 'seal_v8',
    runtime: 'runtime_binding_v8',
    output: 'output_v8',
    physical: 'physical_v8',
    market: 'market_v8',
    release: 'release_v8',
  };
  const configFunctions = {
    seal: ['new_seal_policy_config_v8', 'share_seal_policy_config_v8'],
    runtime: ['new_runtime_package_config_v8', 'share_runtime_package_config_v8'],
    output: ['new_output_package_config_v8', 'share_output_package_config_v8'],
    physical: ['new_physical_package_config_v8', 'share_physical_package_config_v8'],
    market: ['new_market_package_config_v8', 'share_market_package_config_v8'],
    release: ['new_release_package_config_v8', 'share_release_package_config_v8'],
  };
  const expectedTargets = [
    ...MAINNET_V8_ROLE_ORDER.map(
      () => `${PACKAGE_IDS.core}::package_binding_v8::new_package_commitments_v8`,
    ),
    `${PACKAGE_IDS.core}::package_binding_v8::certify_product_release_catalog_v8`,
    ...MAINNET_V8_ROLE_ORDER.slice(1).flatMap((role) => [
      `${PACKAGE_IDS.core}::package_binding_v8::take_${role}_call_cap_v8`,
      `${PACKAGE_IDS[role]}::${configModules[role]}::${configFunctions[role][0]}`,
      `${PACKAGE_IDS[role]}::${configModules[role]}::${configFunctions[role][1]}`,
    ]),
    `${PACKAGE_IDS.core}::package_binding_v8::share_product_release_catalog_v8`,
  ];
  assert.equal(kind.commands.length, 27);
  assert.deepEqual(kind.commands.map(moveCallTarget), expectedTargets);
  assert.equal(kind.inputs[0].Object.SharedObject.mutable, false);

  const certify = kind.commands[7].MoveCall;
  assert.equal(certify.typeArguments.length, 14);
  assert.deepEqual(certify.typeArguments.slice(0, 2), [
    `${PACKAGE_IDS.core}::protocol_config_v8::CorePackageMarkerV8`,
    `${PACKAGE_IDS.core}::protocol_config_v8::CorePackageMarkerV8`,
  ]);
  MAINNET_V8_ROLE_ORDER.slice(1).forEach((role, index) => {
    assert.equal(certify.typeArguments[2 + index * 2].startsWith(`${PACKAGE_IDS[role]}::`), true);
    assert.equal(certify.typeArguments[3 + index * 2].startsWith(`${PACKAGE_IDS[role]}::`), true);
  });
});

test('READY matcher accepts exact publish, initialize, and bootstrap cold-read fixtures', async () => {
  for (const ordinal of [0, 7, 8]) {
    const fixture = await matcherFixture(ordinal);
    assert.deepEqual(await assertMainnetV8TransactionMatchesReady(fixture), {
      ordinal: String(ordinal),
      digest: fixture.unsignedEnvelope.digest,
      transactionSha256: fixture.unsignedEnvelope.transactionSha256,
      transactionKindSha256: fixture.unsignedEnvelope.transactionKindSha256,
    });
  }
});

test('READY matcher rejects every publish command/content mutation after envelope rehash', async () => {
  const fixture = await matcherFixture(0);
  await assertMatcherRejects(fixture, 'publish module bytes', (transaction) => {
    programmableTransaction(transaction).commands[0].Publish.modules[0] = 'Ag==';
  });
  await assertMatcherRejects(fixture, 'publish dependency', (transaction) => {
    programmableTransaction(transaction).commands[0].Publish.dependencies[0] = objectId(99);
  });
  await assertMatcherRejects(fixture, 'UpgradeCap transfer address', (transaction) => {
    const programmable = programmableTransaction(transaction);
    const input = programmable.commands[1].TransferObjects.address.Input;
    replacePureInput(programmable, input, bcs.Address.serialize(objectId(98)).toBytes());
  });
  await assertMatcherRejects(fixture, 'publish command order', (transaction) => {
    programmableTransaction(transaction).commands.reverse();
  });
});

test('READY matcher rejects every initialize target, argument, object-ref, bool, and order mutation', async () => {
  const fixture = await matcherFixture(7);
  const mutations = [
    ['init package target', (transaction) => {
      programmableTransaction(transaction).commands[0].MoveCall.package = objectId(99);
    }],
    ['init function target', (transaction) => {
      programmableTransaction(transaction).commands[0].MoveCall.function = 'tampered_init_v8';
    }],
    ['init USDC type argument', (transaction) => {
      programmableTransaction(transaction).commands[0].MoveCall.typeArguments[0] =
        `${objectId(2)}::sui::SUI`;
    }],
    ['init protocol config ref', (transaction) => {
      programmableTransaction(transaction).inputs[0].Object.SharedObject.objectId = objectId(97);
    }],
    ['init protocol admin ref', (transaction) => {
      programmableTransaction(transaction).inputs[1].Object.ImmOrOwnedObject.objectId = objectId(96);
    }],
    ['init enabled bool', (transaction) => {
      replacePureInput(programmableTransaction(transaction), 2, bcs.bool().serialize(false).toBytes());
    }],
    ['init command order', (transaction) => {
      programmableTransaction(transaction).commands.reverse();
    }],
  ];
  for (const [label, mutate] of mutations) {
    await assertMatcherRejects(fixture, label, mutate);
  }
});

test('READY matcher rejects the exhaustive bootstrap command/type/input mutation matrix', async () => {
  const fixture = await matcherFixture(8);
  const baseline = programmableKind(hydrateMainnetV8UnsignedEnvelope(
    fixture.unsignedEnvelope,
  ));
  assert.equal(baseline.commands.length, 27);

  for (let index = 0; index < 27; index += 1) {
    await assertMatcherRejects(fixture, `bootstrap command target ${index}`, (transaction) => {
      programmableTransaction(transaction).commands[index].MoveCall.function = `tampered_${index}`;
    });
  }
  for (let index = 0; index < 14; index += 1) {
    await assertMatcherRejects(fixture, `bootstrap marker type ${index}`, (transaction) => {
      programmableTransaction(transaction).commands[7].MoveCall.typeArguments[index] =
        `${objectId(99)}::tampered::Marker${index}`;
    });
  }
  for (const [label, inputIndex, replacement] of [
    ['bootstrap protocol config ref', 0, objectId(95)],
    ['bootstrap protocol admin ref', 1, objectId(94)],
  ]) {
    await assertMatcherRejects(fixture, label, (transaction) => {
      const input = programmableTransaction(transaction).inputs[inputIndex].Object;
      if (input.$kind === 'SharedObject') input.SharedObject.objectId = replacement;
      else input.ImmOrOwnedObject.objectId = replacement;
    });
  }
  for (let inputIndex = 2; inputIndex <= 22; inputIndex += 1) {
    await assertMatcherRejects(fixture, `bootstrap commitment input ${inputIndex}`, (transaction) => {
      const programmable = programmableTransaction(transaction);
      const value = fromBase64(programmable.inputs[inputIndex].Pure.bytes);
      value[value.length - 1] ^= 1;
      replacePureInput(programmable, inputIndex, value);
    });
  }
  for (let inputIndex = 23; inputIndex <= 27; inputIndex += 1) {
    await assertMatcherRejects(fixture, `bootstrap Seal policy input ${inputIndex}`, (transaction) => {
      const programmable = programmableTransaction(transaction);
      const value = fromBase64(programmable.inputs[inputIndex].Pure.bytes);
      value[value.length - 1] ^= 1;
      replacePureInput(programmable, inputIndex, value);
    });
  }
  for (let index = 0; index < 26; index += 1) {
    await assertMatcherRejects(fixture, `bootstrap adjacent order ${index}`, (transaction) => {
      const commands = programmableTransaction(transaction).commands;
      [commands[index], commands[index + 1]] = [commands[index + 1], commands[index]];
    });
  }
});

test('READY matcher cold-read rejects sender, gas, expiration, nonce, and chain mutation after rehash', async () => {
  const fixture = await matcherFixture(0);
  const mutations = [
    ['sender', (transaction) => { transaction.sender = objectId(90); }],
    ['gas owner', (transaction) => { transaction.gasData.owner = objectId(91); }],
    ['gas price', (transaction) => {
      transaction.gasData.price = String(BigInt(transaction.gasData.price) + 1n);
    }],
    ['gas budget', (transaction) => {
      transaction.gasData.budget = String(BigInt(transaction.gasData.budget) + 1n);
    }],
    ['expiration min epoch', (transaction) => {
      transaction.expiration.ValidDuring.minEpoch = '43';
    }],
    ['expiration max epoch', (transaction) => {
      transaction.expiration.ValidDuring.maxEpoch = '99';
    }],
    ['expiration timestamp', (transaction) => {
      transaction.expiration.ValidDuring.minTimestamp = '1';
    }],
    ['expiration nonce', (transaction) => {
      transaction.expiration.ValidDuring.nonce += 1;
    }],
    ['expiration chain', (transaction) => {
      transaction.expiration.ValidDuring.chain = objectDigest(92);
    }],
  ];
  for (const [label, mutate] of mutations) {
    await assertMatcherRejects(fixture, label, mutate);
  }
});

test('ordinal 7 and 8 READY context is inseparable from the sealed manifest and predecessor', async (t) => {
  const { stateDir } = await createSevenPublishFinalizedState(t);
  const sealed = await executeMainnetV8Release({
    stateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: RELEASE_PLAN.executionPlanId,
    maximumTransitions: 1,
    dependencies: {
      inspectToolchain: async () => RELEASE_PLAN.toolchain,
    },
  });
  assert.equal(sealed.status, 'FINAL_MANIFEST_REVIEW_REQUIRED');
  const wal = sealed.wal;
  const packageIds = Object.freeze(Object.fromEntries(
    wal.finalManifest.packages.map((entry) => [entry.role, entry.packageId]),
  ));
  const detailsAt = (ordinal) => wal.events.find((event) =>
    event.ordinal === String(ordinal) && event.status === 'FINALIZED_SUCCESS')
    .evidence.observation.details;
  const predecessorAt = (ordinal, details = detailsAt(ordinal)) => Object.freeze({
    ordinal: String(ordinal),
    certificate: details,
    certificateSha256: sha256MainnetV8Json(details),
  });
  const core = detailsAt(0).certificate.readback;
  const protocolConfig = Object.freeze({
    objectId: core.protocolConfig.reference.objectId,
    initialSharedVersion: core.protocolConfig.owner.Shared.initial_shared_version,
  });
  const protocolAdminCap = Object.freeze({ ...core.protocolAdminCap.reference });
  const initStageData = Object.freeze({ packageIds, protocolConfig, protocolAdminCap });
  const initReady = Object.freeze({
    kind: 'INITIALIZE_PROTOCOL',
    stageData: initStageData,
    stageDataSha256: sha256MainnetV8Json(initStageData),
    predecessorReadback: predecessorAt(6),
  });
  assert.equal(assertMainnetV8ReadyWalContext({
    wal,
    ordinal: '7',
    readyArtifact: initReady,
  }), initReady);
  for (const [label, mutate] of [
    ['manifest package IDs', (ready) => { ready.stageData.packageIds.seal = objectId(210); }],
    ['Core config ref', (ready) => { ready.stageData.protocolConfig.objectId = objectId(211); }],
    ['Core admin ref', (ready) => { ready.stageData.protocolAdminCap.version = '99'; }],
    ['predecessor', (ready) => { ready.predecessorReadback.certificateSha256 = hash32(212); }],
  ]) {
    const ready = clone(initReady);
    mutate(ready);
    ready.stageDataSha256 = sha256MainnetV8Json(ready.stageData);
    assert.throws(
      () => assertMainnetV8ReadyWalContext({ wal, ordinal: '7', readyArtifact: ready }),
      expectCode('MAINNET_V8_READY_CONTEXT_DRIFT'),
      label,
    );
  }

  const initializedConfig = Object.freeze({
    reference: Object.freeze({
      objectId: objectId(213),
      version: '2',
      digest: objectDigest(213),
    }),
    owner: Object.freeze({ Shared: Object.freeze({ initial_shared_version: '1' }) }),
  });
  const initDetails = Object.freeze({
    certificate: Object.freeze({
      readback: Object.freeze({ protocolConfig: initializedConfig }),
    }),
  });
  const walWithInit = clone(wal);
  walWithInit.events.push({
    ordinal: '7',
    status: 'FINALIZED_SUCCESS',
    evidence: { observation: { details: initDetails } },
  });
  const commitments = Object.freeze(Object.fromEntries(
    wal.finalManifest.packages.map((entry) => [entry.role, Object.freeze({
      source: entry.sourceCommitment,
      package: entry.packageCommitment,
      abi: entry.abiCommitment,
    })]),
  ));
  const keyServerCertificates = Object.freeze(wal.finalManifest.sealPolicy.keyServers.map(
    (entry, index) => Object.freeze({
      objectId: entry.objectId,
      type: `${PACKAGE_IDS.seal}::key_server::KeyServer`,
      version: String(index + 1),
      digest: objectDigest(214 + index),
      owner: objectId(215 + index),
      previousTransaction: objectDigest(216 + index),
      contentSha256: hash32(217 + index),
    }),
  ));
  const bootstrapStageData = Object.freeze({
    packageIds,
    protocolConfig: Object.freeze({
      objectId: initializedConfig.reference.objectId,
      initialSharedVersion: initializedConfig.owner.Shared.initial_shared_version,
    }),
    protocolAdminCap,
    commitments,
    sealPolicy: wal.finalManifest.sealPolicy,
    keyServerCertificates,
  });
  const bootstrapReady = Object.freeze({
    kind: 'BOOTSTRAP_RELEASE',
    stageData: bootstrapStageData,
    stageDataSha256: sha256MainnetV8Json(bootstrapStageData),
    predecessorReadback: predecessorAt(7, initDetails),
  });
  assert.equal(assertMainnetV8ReadyWalContext({
    wal: walWithInit,
    ordinal: '8',
    readyArtifact: bootstrapReady,
  }), bootstrapReady);
  for (const [label, mutate] of [
    ['manifest package IDs', (ready) => { ready.stageData.packageIds.market = objectId(220); }],
    ['manifest commitments', (ready) => { ready.stageData.commitments.output.abi = hash32(221); }],
    ['final Seal policy', (ready) => { ready.stageData.sealPolicy = clone(SEAL_POLICY_TEMPLATE); }],
    ['initialized config ref', (ready) => { ready.stageData.protocolConfig.objectId = objectId(222); }],
    ['key-server certificate', (ready) => {
      ready.stageData.keyServerCertificates[0].objectId = objectId(223);
    }],
    ['predecessor', (ready) => { ready.predecessorReadback.certificateSha256 = hash32(224); }],
  ]) {
    const ready = clone(bootstrapReady);
    mutate(ready);
    ready.stageDataSha256 = sha256MainnetV8Json(ready.stageData);
    assert.throws(
      () => assertMainnetV8ReadyWalContext({
        wal: walWithInit,
        ordinal: '8',
        readyArtifact: ready,
      }),
      expectCode('MAINNET_V8_READY_CONTEXT_DRIFT'),
      label,
    );
  }
});

test('durable unsigned envelope roundtrips exact TransactionData and rejects every binding drift', async () => {
  const envelope = await publishEnvelope();
  const durable = durableMainnetV8UnsignedEnvelope(envelope);
  const hydrated = hydrateMainnetV8UnsignedEnvelope(JSON.parse(JSON.stringify(durable)));
  assert.deepEqual(hydrated.transactionBytes, envelope.transactionBytes);
  assert.deepEqual(hydrated.transactionKindBytes, envelope.transactionKindBytes);
  assert.equal(hydrated.transactionByteLength, envelope.transactionByteLength);
  assert.equal(hydrated.digest, envelope.digest);

  const tamperCases = [
    (value) => { value.transactionByteLength = String(Number(value.transactionByteLength) + 1); },
    (value) => { value.transactionSha256 = hash32(90); },
    (value) => { value.transactionKindBase64 = toBase64(Uint8Array.of(1, 2, 3)); },
    (value) => { value.transactionKindSha256 = hash32(91); },
    (value) => { value.digest = objectDigest(92); },
    (value) => { value.sender = objectId(93); },
    (value) => { value.gasOwner = objectId(94); },
    (value) => { value.gasBudget = '2000000001'; },
    (value) => { value.gasPrice = '1001'; },
    (value) => { value.expiration.ValidDuring.nonce += 1; },
  ];
  for (const tamper of tamperCases) {
    const value = clone(durable);
    tamper(value);
    assert.throws(
      () => hydrateMainnetV8UnsignedEnvelope(value),
      expectCode('MAINNET_V8_UNSIGNED_ENVELOPE_DRIFT'),
    );
  }
  const extra = clone(durable);
  extra.unreviewed = true;
  assert.throws(
    () => hydrateMainnetV8UnsignedEnvelope(extra),
    expectCode('MAINNET_V8_FIELDS_INVALID'),
  );
});

test('exact local Ed25519 artifact binds TransactionData, signature intent, and canonical SenderSignedData', async () => {
  const { artifact, envelope } = await signedFixture();
  const verified = await verifyExactMainnetV8SignedArtifact(artifact);
  assert.deepEqual(verified.transactionBytes, envelope.transactionBytes);
  assert.equal(bcs.SenderSignedData.parse(verified.senderSignedDataBytes).length, 1);
  assert.equal(verified.signer, RELEASE_SENDER);

  const hashTamper = clone(artifact);
  hashTamper.transactionSha256 = hash32(95);
  await assert.rejects(
    verifyExactMainnetV8SignedArtifact(hashTamper),
    expectCode('MAINNET_V8_SIGNED_ARTIFACT_DRIFT'),
  );

  const intentTamper = clone(artifact);
  const tamperedSenderSignedData = bcs.SenderSignedData.parse(
    fromBase64(intentTamper.senderSignedDataBase64),
  );
  tamperedSenderSignedData[0].intentMessage.intent.scope = { PersonalMessage: true };
  const intentBytes = bcs.SenderSignedData.serialize(tamperedSenderSignedData).toBytes();
  intentTamper.senderSignedDataBase64 = toBase64(intentBytes);
  intentTamper.senderSignedDataSha256 = sha256(intentBytes);
  await assert.rejects(
    verifyExactMainnetV8SignedArtifact(intentTamper),
    expectCode('MAINNET_V8_SIGNED_ARTIFACT_DRIFT'),
  );

  const attacker = clone(artifact);
  attacker.signature = (await ATTACKER_KEYPAIR.signTransaction(envelope.transactionBytes)).signature;
  attacker.signatureSha256 = sha256(fromBase64(attacker.signature));
  const attackerSenderSignedData = bcs.SenderSignedData.parse(
    fromBase64(attacker.senderSignedDataBase64),
  );
  attackerSenderSignedData[0].txSignatures = [attacker.signature];
  const attackerBytes = bcs.SenderSignedData.serialize(attackerSenderSignedData).toBytes();
  attacker.senderSignedDataBase64 = toBase64(attackerBytes);
  attacker.senderSignedDataSha256 = sha256(attackerBytes);
  await assert.rejects(
    verifyExactMainnetV8SignedArtifact(attacker),
    expectCode('MAINNET_V8_SIGNED_ARTIFACT_DRIFT'),
  );
});

test('execute runner rejects absent or mismatched external approvals before every side effect', async (t) => {
  const { stateDir, fixture } = await createExecutionState(t);
  const walPath = join(stateDir, MAINNET_V8_WAL_FILENAME);
  const before = await readFile(walPath, 'utf8');
  const calls = [];
  const sideEffect = (name) => (...args) => {
    calls.push([name, args]);
    assert.fail(`${name} must remain unreachable before external approval`);
  };
  const dependencies = {
    inspectToolchain: sideEffect('inspectToolchain'),
    assertProtocolProfile: sideEffect('assertProtocolProfile'),
    assertReadyBuild: sideEffect('assertReadyBuild'),
    signExactTransaction: sideEffect('signExactTransaction'),
    verifySignedArtifact: sideEffect('verifySignedArtifact'),
    queryFinalizedOutcome: sideEffect('queryFinalizedOutcome'),
    broadcastExactTransaction: sideEffect('broadcastExactTransaction'),
    getCheckpointWatermark: sideEffect('getCheckpointWatermark'),
    certifyReadback: sideEffect('certifyReadback'),
    now: sideEffect('now'),
  };
  const base = {
    stateDir,
    suiBinary: '/offline/fake-sui',
    client: {},
    transport: {},
    maximumTransitions: 1,
    dependencies,
  };

  await assert.rejects(
    executeMainnetV8Release(base),
    expectCode('MAINNET_V8_HASH_INVALID'),
  );
  assert.equal(await readFile(walPath, 'utf8'), before);
  assert.deepEqual(calls, []);

  await assert.rejects(
    executeMainnetV8Release({ ...base, expectedExecutionPlanId: hash32(200) }),
    expectCode('MAINNET_V8_EXECUTION_PLAN_NOT_APPROVED'),
  );
  assert.equal(await readFile(walPath, 'utf8'), before);
  assert.deepEqual(calls, []);

  await assert.rejects(
    executeMainnetV8Release({
      ...base,
      expectedExecutionPlanId: fixture.plan.executionPlanId,
      expectedReleaseId: hash32(201),
    }),
    expectCode('MAINNET_V8_RELEASE_ID_PREMATURE'),
  );
  assert.equal(await readFile(walPath, 'utf8'), before);
  assert.deepEqual(calls, []);
});

test('execute runner seals the final manifest then requires a separately approved release ID', async (t) => {
  const { stateDir } = await createSevenPublishFinalizedState(t);
  const walPath = join(stateDir, MAINNET_V8_WAL_FILENAME);
  const calls = [];
  const unreachable = (name) => (...args) => {
    calls.push([name, args]);
    assert.fail(`${name} is unreachable while sealing or rejecting approval`);
  };
  const dependencies = {
    inspectToolchain: async () => {
      calls.push(['inspectToolchain']);
      return RELEASE_PLAN.toolchain;
    },
    assertProtocolProfile: unreachable('assertProtocolProfile'),
    assertReadyBuild: unreachable('assertReadyBuild'),
    signExactTransaction: unreachable('signExactTransaction'),
    verifySignedArtifact: unreachable('verifySignedArtifact'),
    queryFinalizedOutcome: unreachable('queryFinalizedOutcome'),
    broadcastExactTransaction: unreachable('broadcastExactTransaction'),
    getCheckpointWatermark: unreachable('getCheckpointWatermark'),
    certifyReadback: unreachable('certifyReadback'),
    now: unreachable('now'),
  };
  const base = {
    stateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: RELEASE_PLAN.executionPlanId,
    client: {},
    transport: {},
    maximumTransitions: 1,
    dependencies,
  };

  const sealed = await executeMainnetV8Release(base);
  assert.equal(sealed.status, 'FINAL_MANIFEST_REVIEW_REQUIRED');
  assert.equal(sealed.writesComplete, false);
  assert.equal(sealed.wal.events.at(-1).status, 'FINAL_MANIFEST_SEALED');
  assert.equal(sealed.wal.releaseId, sealed.wal.finalManifest.releaseId);
  assert.deepEqual(calls, [['inspectToolchain']]);

  const sealedBytes = await readFile(walPath, 'utf8');
  calls.length = 0;
  await assert.rejects(
    executeMainnetV8Release(base),
    expectCode('MAINNET_V8_HASH_INVALID'),
  );
  assert.equal(await readFile(walPath, 'utf8'), sealedBytes);
  assert.deepEqual(calls, []);

  await assert.rejects(
    executeMainnetV8Release({ ...base, expectedReleaseId: hash32(202) }),
    expectCode('MAINNET_V8_RELEASE_ID_NOT_APPROVED'),
  );
  assert.equal(await readFile(walPath, 'utf8'), sealedBytes);
  assert.deepEqual(calls, []);
});

test('execute runner cold-rebuilds READY publish bytes before signing and fails closed on drift', async (t) => {
  const { stateDir, fixture } = await createExecutionState(t);
  let rebuildCount = 0;
  let signCount = 0;
  await assert.rejects(
    executeMainnetV8Release({
      stateDir,
      suiBinary: '/offline/fake-sui',
      expectedExecutionPlanId: fixture.plan.executionPlanId,
      client: {},
      transport: {},
      maximumTransitions: 1,
      dependencies: {
        inspectToolchain: async () => {
          assert.equal((await coldHead(stateDir)).event.status, 'READY');
          return fixture.plan.toolchain;
        },
        assertProtocolProfile: async () => {
          assert.equal((await coldHead(stateDir)).event.status, 'READY');
          return fixture.readyArtifact.protocolProfile;
        },
        assertReadyBuild: async () => {
          assert.equal((await coldHead(stateDir)).event.status, 'READY');
          rebuildCount += 1;
          throw new MainnetV8ReleaseError(
            'MAINNET_V8_READY_BUILD_DRIFT',
            'offline cold rebuild mismatch',
          );
        },
        signExactTransaction: async () => {
          signCount += 1;
          assert.fail('signing must remain unreachable after cold rebuild drift');
        },
        verifySignedArtifact: acceptFixtureSignedArtifact,
        queryFinalizedOutcome: async () => assert.fail('READY drift cannot query'),
        broadcastExactTransaction: async () => assert.fail('READY drift cannot broadcast'),
        getCheckpointWatermark: async () => assert.fail('READY drift cannot read watermark'),
        certifyReadback: async () => assert.fail('READY drift cannot certify'),
        now: () => assert.fail('READY drift cannot observe outcome time'),
      },
    }),
    expectCode('MAINNET_V8_READY_BUILD_DRIFT'),
  );
  const cold = await coldHead(stateDir);
  assert.equal(cold.event.status, 'READY');
  assert.equal(cold.wal.revision, '1');
  assert.equal(rebuildCount, 1);
  assert.equal(signCount, 0);
});

test('execute runner durably orders signing, double NOT_FOUND, broadcast, and query-first legacy resume', async (t) => {
  const { stateDir, fixture } = await createExecutionState(t);
  const signedArtifact = await signEnvelopeFixture(fixture.unsignedEnvelope);
  const finalityEvidence = successfulFinalityFixture(signedArtifact, 85);
  const calls = [];
  let signCount = 0;
  let queryCount = 0;
  let broadcastCount = 0;
  let broadcastIntentSnapshot = null;
  const clock = [
    '2026-08-23T00:00:00.000Z',
    '2026-08-23T00:00:00.001Z',
  ];

  async function observe(name) {
    const { event } = await coldHead(stateDir);
    calls.push(`${name}:${durableState(event)}`);
    return event;
  }

  const dependencies = {
    inspectToolchain: async () => {
      await observe('inspect');
      return fixture.plan.toolchain;
    },
    assertProtocolProfile: async () => {
      await observe('profile');
      return fixture.readyArtifact.protocolProfile;
    },
    assertReadyBuild: async () => {
      const event = await observe('rebuild');
      assert.equal(event.status, 'READY');
      return Object.freeze({ kind: 'PUBLISH_BUILD_VERIFIED' });
    },
    assertReadyAuthority: async () => {
      const event = await observe('authority');
      assert.equal(event.status, 'READY');
      return Object.freeze({ kind: 'NO_STAGE_AUTHORITY', ordinal: '0' });
    },
    signExactTransaction: async ({ sender, envelope }) => {
      const event = await observe('sign');
      assert.equal(event.status, 'READY');
      assert.equal(sender, fixture.plan.sender);
      assert.equal(envelope.digest, fixture.unsignedEnvelope.digest);
      signCount += 1;
      return signedArtifact;
    },
    verifySignedArtifact: acceptFixtureSignedArtifact,
    queryFinalizedOutcome: async ({ digest, signedArtifact: durableSigned }) => {
      const event = await observe('query');
      assert.equal(durableState(event), 'OUTCOME_PENDING/QUERY_INTENT');
      assert.equal(digest, signedArtifact.digest);
      assert.deepEqual(durableSigned, signedArtifact);
      queryCount += 1;
      return Object.freeze({ status: 'NOT_FOUND' });
    },
    getCheckpointWatermark: async () => {
      const event = await observe('watermark');
      assert.equal(durableState(event), 'OUTCOME_PENDING/QUERY_INTENT');
      return Object.freeze({
        chainIdentifier: fixture.plan.chain.chainIdentifier,
        epoch: '42',
        checkpoint: Object.freeze({
          sequenceNumber: '900',
          digest: objectDigest(86),
        }),
      });
    },
    broadcastExactTransaction: async ({ signedArtifact: durableSigned }) => {
      const event = await observe('broadcast');
      assert.equal(durableState(event), 'OUTCOME_PENDING/BROADCAST_INTENT');
      assert.deepEqual(durableSigned, signedArtifact);
      broadcastCount += 1;
      broadcastIntentSnapshot = await readFile(
        join(stateDir, MAINNET_V8_WAL_FILENAME),
        'utf8',
      );
      return Object.freeze({
        digest: signedArtifact.digest,
        status: 'ACCEPTED_SUCCESS',
        effectsBcsBase64: null,
      });
    },
    certifyReadback: async () => assert.fail('NOT_FOUND path cannot certify before finality'),
    now: () => {
      const { event } = coldHeadSync(stateDir);
      calls.push(`now:${durableState(event)}`);
      return clock.shift() ?? '2026-08-23T00:00:00.002Z';
    },
  };
  const executeOne = () => executeMainnetV8Release({
    stateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: fixture.plan.executionPlanId,
    client: {},
    transport: {},
    maximumTransitions: 1,
    dependencies,
  });

  const signedRun = await executeOne();
  assert.equal(signedRun.status, 'TRANSITION_LIMIT_REACHED');
  assert.equal((await coldHead(stateDir)).event.status, 'SIGNED');
  assert.equal(signCount, 1);
  assert.equal(queryCount, 0);

  const intentRun = await executeOne();
  assert.equal(intentRun.status, 'TRANSITION_LIMIT_REACHED');
  assert.equal(
    durableState((await coldHead(stateDir)).event),
    'OUTCOME_PENDING/QUERY_INTENT',
  );
  assert.equal(signCount, 1, 'crash/resume from SIGNED must not sign again');
  assert.equal(queryCount, 0, 'QUERY_INTENT must be cold-read before the first outcome RPC');

  const broadcastRun = await executeOne();
  assert.equal(broadcastRun.status, 'TRANSITION_LIMIT_REACHED');
  assert.equal((await coldHead(stateDir)).event.status, 'BROADCAST_ACCEPTED');
  assert.equal(signCount, 1);
  assert.equal(queryCount, 2);
  assert.equal(broadcastCount, 1);
  assert.ok(broadcastIntentSnapshot, 'broadcast hook must observe and snapshot durable BROADCAST_INTENT');
  assert.deepEqual(calls, [
    'inspect:READY',
    'profile:READY',
    'rebuild:READY',
    'authority:READY',
    'inspect:READY',
    'sign:READY',
    'inspect:SIGNED',
    'inspect:OUTCOME_PENDING/QUERY_INTENT',
    'query:OUTCOME_PENDING/QUERY_INTENT',
    'now:OUTCOME_PENDING/QUERY_INTENT',
    'watermark:OUTCOME_PENDING/QUERY_INTENT',
    'query:OUTCOME_PENDING/QUERY_INTENT',
    'now:OUTCOME_PENDING/QUERY_INTENT',
    'profile:OUTCOME_PENDING/BROADCAST_INTENT',
    'broadcast:OUTCOME_PENDING/BROADCAST_INTENT',
  ]);

  const legacyStateDir = await mkdtemp(join(tmpdir(), 'animacraft-mainnet-v8-legacy-intent-'));
  t.after(async () => rm(legacyStateDir, { recursive: true, force: true }));
  await writeFile(
    join(legacyStateDir, MAINNET_V8_PLAN_FILENAME),
    `${canonicalMainnetV8Json(fixture.plan)}\n`,
  );
  await writeFile(join(legacyStateDir, MAINNET_V8_WAL_FILENAME), broadcastIntentSnapshot);

  const resumeCalls = [];
  let resumedQueryCount = 0;
  async function observeResume(name) {
    const { event } = await coldHead(legacyStateDir);
    resumeCalls.push(`${name}:${durableState(event)}`);
    return event;
  }
  const resumeDependencies = {
    inspectToolchain: async () => {
      await observeResume('inspect');
      return fixture.plan.toolchain;
    },
    assertProtocolProfile: async () => assert.fail('legacy intent resume must not broadcast'),
    assertReadyBuild: async () => assert.fail('legacy intent resume must not rebuild or re-sign'),
    signExactTransaction: async () => assert.fail('legacy intent resume must not re-sign'),
    verifySignedArtifact: acceptFixtureSignedArtifact,
    queryFinalizedOutcome: async () => {
      const event = await observeResume('query');
      assert.equal(durableState(event), 'OUTCOME_PENDING/QUERY_INTENT');
      resumedQueryCount += 1;
      return Object.freeze({ status: 'FINALIZED_SUCCESS', evidence: finalityEvidence });
    },
    broadcastExactTransaction: async () => assert.fail('legacy intent must never replay directly'),
    getCheckpointWatermark: async () => assert.fail('successful fresh query needs no watermark'),
    certifyReadback: async () => assert.fail('pending readback is outside this transition'),
    now: () => assert.fail('successful fresh query needs no NOT_FOUND clock'),
  };
  const resumeOne = () => executeMainnetV8Release({
    stateDir: legacyStateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: fixture.plan.executionPlanId,
    client: {},
    transport: {},
    maximumTransitions: 1,
    dependencies: resumeDependencies,
  });

  await resumeOne();
  assert.equal(
    durableState((await coldHead(legacyStateDir)).event),
    'OUTCOME_PENDING/QUERY_INTENT',
  );
  assert.equal(resumedQueryCount, 0);
  assert.equal(broadcastCount, 1, 'legacy resume cannot replay the prior broadcast intent');

  await resumeOne();
  assert.equal((await coldHead(legacyStateDir)).event.status, 'FINALIZED_SUCCESS_PENDING_READBACK');
  assert.equal(resumedQueryCount, 1);
  assert.deepEqual(resumeCalls, [
    'inspect:OUTCOME_PENDING/BROADCAST_INTENT',
    'inspect:OUTCOME_PENDING/QUERY_INTENT',
    'query:OUTCOME_PENDING/QUERY_INTENT',
  ]);
});

test('execute runner persists pending readback before certification and advances without re-signing', async (t) => {
  const { stateDir, fixture } = await createExecutionState(t);
  const signedArtifact = await signEnvelopeFixture(fixture.unsignedEnvelope);
  const { finalityEvidence, readback } = publishCertificationFixture(fixture, signedArtifact);
  const calls = [];
  let signCount = 0;
  let queryCount = 0;
  let certifyCount = 0;

  async function observe(name) {
    const { event } = await coldHead(stateDir);
    calls.push(`${name}:${durableState(event)}`);
    return event;
  }

  const dependencies = {
    inspectToolchain: async () => {
      await observe('inspect');
      return fixture.plan.toolchain;
    },
    assertProtocolProfile: async () => {
      const event = await observe('profile');
      assert.equal(event.status, 'READY');
      return fixture.readyArtifact.protocolProfile;
    },
    assertReadyBuild: async () => {
      const event = await observe('rebuild');
      assert.equal(event.status, 'READY');
      return Object.freeze({ kind: 'PUBLISH_BUILD_VERIFIED' });
    },
    assertReadyAuthority: async () => {
      const event = await observe('authority');
      assert.equal(event.status, 'READY');
      return Object.freeze({ kind: 'NO_STAGE_AUTHORITY', ordinal: '0' });
    },
    signExactTransaction: async () => {
      const event = await observe('sign');
      assert.equal(event.status, 'READY');
      signCount += 1;
      return signedArtifact;
    },
    verifySignedArtifact: acceptFixtureSignedArtifact,
    queryFinalizedOutcome: async () => {
      const event = await observe('query');
      assert.equal(durableState(event), 'OUTCOME_PENDING/QUERY_INTENT');
      queryCount += 1;
      return Object.freeze({ status: 'FINALIZED_SUCCESS', evidence: finalityEvidence });
    },
    broadcastExactTransaction: async () => assert.fail('finalized query cannot broadcast'),
    getCheckpointWatermark: async () => assert.fail('finalized query needs no watermark'),
    certifyReadback: async ({ ordinal, signed }) => {
      const event = await observe('certify');
      assert.equal(event.status, 'FINALIZED_SUCCESS_PENDING_READBACK');
      assert.equal(ordinal, 0);
      assert.deepEqual(signed.signedArtifact, signedArtifact);
      certifyCount += 1;
      return readback;
    },
    now: () => assert.fail('finalized query needs no NOT_FOUND clock'),
  };
  const executeOne = () => executeMainnetV8Release({
    stateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: fixture.plan.executionPlanId,
    client: {},
    transport: {},
    maximumTransitions: 1,
    dependencies,
  });

  await executeOne();
  assert.equal((await coldHead(stateDir)).event.status, 'SIGNED');
  await executeOne();
  assert.equal(
    durableState((await coldHead(stateDir)).event),
    'OUTCOME_PENDING/QUERY_INTENT',
  );
  await executeOne();
  const pending = await coldHead(stateDir);
  assert.equal(pending.event.status, 'FINALIZED_SUCCESS_PENDING_READBACK');
  assert.equal(certifyCount, 0, 'finality transition must stop after durable pending readback');

  await executeOne();
  const finalized = await coldHead(stateDir);
  assert.equal(finalized.event.status, 'FINALIZED_SUCCESS');
  assert.equal(finalized.wal.revision, '5');
  assert.equal(signCount, 1);
  assert.equal(queryCount, 1);
  assert.equal(certifyCount, 1);
  assert.equal(finalized.wal.events.filter((event) => event.status === 'SIGNED').length, 1);
  assert.deepEqual(
    finalized.event.evidence.observation.details.certificate.readback,
    readback,
  );
  assert.deepEqual(calls, [
    'inspect:READY',
    'profile:READY',
    'rebuild:READY',
    'authority:READY',
    'inspect:READY',
    'sign:READY',
    'inspect:SIGNED',
    'inspect:OUTCOME_PENDING/QUERY_INTENT',
    'query:OUTCOME_PENDING/QUERY_INTENT',
    'inspect:FINALIZED_SUCCESS_PENDING_READBACK',
    'certify:FINALIZED_SUCCESS_PENDING_READBACK',
  ]);
});

test('execute runner re-certifies the exact known readback incident without signing or broadcasting', async (t) => {
  const { stateDir, fixture } = await createExecutionState(t);
  const signedArtifact = await signEnvelopeFixture(fixture.unsignedEnvelope);
  const { finalityEvidence, readback } = publishCertificationFixture(fixture, signedArtifact);
  let signCount = 0;
  let queryCount = 0;
  let broadcastCount = 0;
  let certifyCount = 0;
  let repairParser = false;
  const dependencies = {
    inspectToolchain: async () => fixture.plan.toolchain,
    assertProtocolProfile: async () => fixture.readyArtifact.protocolProfile,
    assertReadyBuild: async () => Object.freeze({ kind: 'PUBLISH_BUILD_VERIFIED' }),
    assertReadyAuthority: async () => Object.freeze({ kind: 'NO_STAGE_AUTHORITY', ordinal: '0' }),
    signExactTransaction: async () => {
      signCount += 1;
      return signedArtifact;
    },
    verifySignedArtifact: acceptFixtureSignedArtifact,
    queryFinalizedOutcome: async () => {
      queryCount += 1;
      return Object.freeze({ status: 'FINALIZED_SUCCESS', evidence: finalityEvidence });
    },
    broadcastExactTransaction: async () => {
      broadcastCount += 1;
      assert.fail('finalized digest must never be broadcast');
    },
    getCheckpointWatermark: async () => assert.fail('finalized digest needs no watermark'),
    certifyReadback: async () => {
      certifyCount += 1;
      if (!repairParser) {
        const error = new Error('core on-chain modules differ from clean build bytes.');
        error.code = 'MAINNET_V8_PACKAGE_BYTES_DRIFT';
        throw error;
      }
      return readback;
    },
    now: () => assert.fail('finalized digest needs no NOT_FOUND clock'),
  };
  const executeOne = (options = {}) => executeMainnetV8Release({
    stateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: fixture.plan.executionPlanId,
    client: {},
    transport: {},
    maximumTransitions: 1,
    dependencies,
    ...options,
  });

  await executeOne();
  await executeOne();
  await executeOne();
  const stopped = await executeOne();
  assert.equal(stopped.status, 'INCIDENT_STOPPED');
  assert.equal((await coldHead(stateDir)).event.status, 'INCIDENT_STOPPED');
  assert.equal(signCount, 1);
  assert.equal(queryCount, 1);
  assert.equal(broadcastCount, 0);
  assert.equal(certifyCount, 1);

  const unchanged = await executeOne();
  assert.equal(unchanged.status, 'INCIDENT_STOPPED');
  assert.equal(certifyCount, 1, 'ordinary resume must preserve the terminal incident');

  repairParser = true;
  const repaired = await executeOne({
    maximumTransitions: 2,
    repairReadbackIncident: true,
  });
  assert.equal(repaired.status, 'READBACK_REPAIR_COMPLETE');
  assert.equal(repaired.writesComplete, false);
  const head = await coldHead(stateDir);
  assert.equal(head.event.status, 'FINALIZED_SUCCESS');
  assert.equal(head.wal.revision, '7');
  assert.equal(head.wal.events.at(-3).status, 'INCIDENT_STOPPED');
  assert.equal(head.wal.events.at(-2).status, 'FINALIZED_SUCCESS_PENDING_READBACK');
  assert.equal(head.wal.events.at(-1).status, 'FINALIZED_SUCCESS');
  assert.equal(signCount, 1);
  assert.equal(queryCount, 1);
  assert.equal(broadcastCount, 0);
  assert.equal(certifyCount, 2);
  assert.deepEqual(
    head.event.evidence.observation.details.certificate.readback,
    readback,
  );
});

test('durable V1 finality evidence binds canonical effects hash, digest, status, epoch, and events', async () => {
  const { artifact } = await signedFixture();
  const effectsBytes = bcs.TransactionEffects.serialize({
    V1: {
      status: { Success: true },
      executedEpoch: '42',
      gasUsed: {
        computationCost: '1',
        storageCost: '2',
        storageRebate: '0',
        nonRefundableStorageFee: '0',
      },
      modifiedAtVersions: [],
      sharedObjects: [],
      transactionDigest: artifact.digest,
      created: [],
      mutated: [],
      unwrapped: [],
      deleted: [],
      unwrappedThenDeleted: [],
      wrapped: [],
      gasObject: [{
        objectId: objectId(80),
        version: '7',
        digest: objectDigest(80),
      }, { AddressOwner: RELEASE_SENDER }],
      eventsDigest: null,
      dependencies: [],
    },
  }).toBytes();
  const evidence = {
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    digest: artifact.digest,
    checkpoint: '123',
    epoch: '42',
    transactionBase64: artifact.transactionBase64,
    transactionSha256: artifact.transactionSha256,
    signature: artifact.signature,
    signatureSha256: artifact.signatureSha256,
    effectsBcsBase64: toBase64(effectsBytes),
    effectsSha256: sha256(effectsBytes),
    effectsDigest: typedDigest('TransactionEffects', effectsBytes),
    effectsStatus: { success: true, error: null },
    eventsDigest: null,
    transactionEvents: null,
  };
  assert.deepEqual(assertDurableMainnetV8FinalityEvidence(evidence, artifact), evidence);

  const mutations = [
    ['effects hash', 'MAINNET_V8_FINALIZED_EFFECTS_DRIFT', (value) => {
      value.effectsSha256 = hash32(81);
    }],
    ['effects digest', 'MAINNET_V8_FINALIZED_EFFECTS_DRIFT', (value) => {
      value.effectsDigest = objectDigest(82);
    }],
    ['status shape', 'MAINNET_V8_FINALIZED_STATUS_DRIFT', (value) => {
      value.effectsStatus.error = { kind: 'unexpected' };
    }],
    ['status versus BCS', 'MAINNET_V8_FINALIZED_EFFECTS_DRIFT', (value) => {
      value.effectsStatus = { success: false, error: { kind: 'MoveAbort' } };
    }],
    ['executed epoch', 'MAINNET_V8_FINALIZED_EFFECTS_DRIFT', (value) => {
      value.epoch = '43';
    }],
    ['events digest', 'MAINNET_V8_FINALIZED_EVENTS_DRIFT', (value) => {
      value.eventsDigest = objectDigest(83);
    }],
  ];
  for (const [label, code, mutate] of mutations) {
    const value = clone(evidence);
    mutate(value);
    assert.throws(
      () => assertDurableMainnetV8FinalityEvidence(value, artifact),
      expectCode(code),
      label,
    );
  }
});

test('TransactionEffects V1 returns exact created, mutated, and unwrapped write references', () => {
  const transactionDigest = objectDigest(60);
  const created = [{ objectId: objectId(61), version: '10', digest: objectDigest(61) }, {
    AddressOwner: RELEASE_SENDER,
  }];
  const mutated = [{ objectId: objectId(62), version: '11', digest: objectDigest(62) }, {
    Shared: { initialSharedVersion: '4' },
  }];
  const unwrapped = [{ objectId: objectId(63), version: '12', digest: objectDigest(63) }, {
    Immutable: true,
  }];
  const effectsBytes = bcs.TransactionEffects.serialize({
    V1: {
      status: { Success: true },
      executedEpoch: '42',
      gasUsed: {
        computationCost: '1',
        storageCost: '2',
        storageRebate: '0',
        nonRefundableStorageFee: '0',
      },
      modifiedAtVersions: [],
      sharedObjects: [],
      transactionDigest,
      created: [created],
      mutated: [mutated],
      unwrapped: [unwrapped],
      deleted: [],
      unwrappedThenDeleted: [],
      wrapped: [],
      gasObject: [{ objectId: objectId(64), version: '13', digest: objectDigest(64) }, {
        AddressOwner: RELEASE_SENDER,
      }],
      eventsDigest: null,
      dependencies: [],
    },
  }).toBytes();

  assert.deepEqual(writtenReferencesFromEffects(effectsBytes, transactionDigest), [
    {
      operation: 'CREATED', objectId: objectId(61), version: '10', digest: objectDigest(61),
      owner: { kind: 'AddressOwner', address: RELEASE_SENDER },
    },
    {
      operation: 'MUTATED', objectId: objectId(62), version: '11', digest: objectDigest(62),
      owner: { kind: 'Shared', initialSharedVersion: '4' },
    },
    {
      operation: 'MUTATED', objectId: objectId(63), version: '12', digest: objectDigest(63),
      owner: { kind: 'Immutable' },
    },
  ]);
  assert.deepEqual(createdReferencesFromEffects(effectsBytes, transactionDigest), [{
    objectId: objectId(61),
    version: '10',
    digest: objectDigest(61),
    owner: { kind: 'AddressOwner', address: RELEASE_SENDER },
  }]);
  assert.throws(
    () => writtenReferencesFromEffects(effectsBytes, objectDigest(65)),
    expectCode('MAINNET_V8_EFFECTS_INVALID'),
  );
});

test('TransactionEffects V2 returns object and package writes with correct versions and owners', () => {
  const transactionDigest = objectDigest(70);
  const effectsBytes = bcs.TransactionEffects.serialize({
    V2: {
      status: { Success: true },
      executedEpoch: '43',
      gasUsed: {
        computationCost: '1',
        storageCost: '2',
        storageRebate: '0',
        nonRefundableStorageFee: '0',
      },
      transactionDigest,
      gasObjectIndex: null,
      eventsDigest: null,
      dependencies: [],
      lamportVersion: '55',
      changedObjects: [
        [objectId(71), {
          inputState: { NotExist: true },
          outputState: { ObjectWrite: [objectDigest(71), { AddressOwner: RELEASE_SENDER }] },
          idOperation: { Created: true },
        }],
        [objectId(72), {
          inputState: {
            Exist: [['54', objectDigest(72)], { Shared: { initialSharedVersion: '8' } }],
          },
          outputState: {
            ObjectWrite: [objectDigest(73), { Shared: { initialSharedVersion: '8' } }],
          },
          idOperation: { None: true },
        }],
        [objectId(74), {
          inputState: { NotExist: true },
          outputState: { PackageWrite: ['9', objectDigest(74)] },
          idOperation: { Created: true },
        }],
        [objectId(75), {
          inputState: { NotExist: true },
          outputState: {
            AccumulatorWriteV1: {
              address: {
                address: RELEASE_SENDER,
                ty: '0x2::balance::Balance<0x2::sui::SUI>',
              },
              operation: { Split: true },
              value: { Integer: '493223600' },
            },
          },
          idOperation: { None: true },
        }],
      ],
      unchangedConsensusObjects: [],
      auxDataDigest: null,
    },
  }).toBytes();

  assert.deepEqual(writtenReferencesFromEffects(effectsBytes, transactionDigest), [
    {
      operation: 'CREATED', objectId: objectId(71), version: '55', digest: objectDigest(71),
      owner: { kind: 'AddressOwner', address: RELEASE_SENDER },
    },
    {
      operation: 'MUTATED', objectId: objectId(72), version: '55', digest: objectDigest(73),
      owner: { kind: 'Shared', initialSharedVersion: '8' },
    },
    {
      operation: 'CREATED', objectId: objectId(74), version: '9', digest: objectDigest(74),
      owner: { kind: 'Immutable' },
    },
  ]);
  assert.deepEqual(createdReferencesFromEffects(effectsBytes, transactionDigest), [
    {
      objectId: objectId(71), version: '55', digest: objectDigest(71),
      owner: { kind: 'AddressOwner', address: RELEASE_SENDER },
    },
    {
      objectId: objectId(74), version: '9', digest: objectDigest(74),
      owner: { kind: 'Immutable' },
    },
  ]);
  const impossibleCreatedAccumulator = structuredClone(bcs.TransactionEffects.parse(effectsBytes));
  impossibleCreatedAccumulator.V2.changedObjects.at(-1)[1].idOperation = { Created: true };
  const impossibleBytes = bcs.TransactionEffects.serialize(impossibleCreatedAccumulator).toBytes();
  assert.throws(
    () => writtenReferencesFromEffects(impossibleBytes, transactionDigest),
    expectCode('MAINNET_V8_CREATED_OUTPUT_INVALID'),
  );
});

test('published module bytes allow only the one exact Sui self-address substitution', () => {
  const packageId = objectId(76);
  const source = new Uint8Array(96).fill(7);
  source.fill(0, 24, 56);
  const published = Uint8Array.from(source);
  published.set(fromHex(packageId), 24);
  assert.deepEqual(assertMainnetV8PublishedModuleBytes({
    role: 'core',
    moduleName: 'core_v8',
    packageId,
    sourceBase64: toBase64(source),
    publishedBase64: toBase64(published),
  }), {
    sourceSha256: sha256(source),
    publishedSha256: sha256(published),
    selfAddressOffset: '24',
  });

  for (const mutate of [
    (bytes) => { bytes[10] ^= 1; },
    (bytes) => { bytes[24] ^= 1; },
    (bytes) => { bytes[56] ^= 1; },
  ]) {
    const drifted = Uint8Array.from(published);
    mutate(drifted);
    assert.throws(() => assertMainnetV8PublishedModuleBytes({
      role: 'core',
      moduleName: 'core_v8',
      packageId,
      sourceBase64: toBase64(source),
      publishedBase64: toBase64(drifted),
    }), expectCode('MAINNET_V8_PACKAGE_BYTES_DRIFT'));
  }
});

test('official package descriptor canonicalization restores omitted empty repeated fields', () => {
  assert.deepEqual(normalizeMainnetV8MovePackageDescriptor({
    storageId: objectId(77),
    originalId: objectId(77),
    version: '1',
    modules: [
      { name: 'empty' },
      { name: 'functions_only', functions: [{ name: 'f' }] },
      { name: 'datatypes_only', datatypes: [{ name: 'T' }] },
    ],
  }).modules, [
    { name: 'empty', datatypes: [], functions: [] },
    { name: 'functions_only', datatypes: [], functions: [{ name: 'f' }] },
    { name: 'datatypes_only', datatypes: [{ name: 'T' }], functions: [] },
  ]);
  assert.throws(
    () => normalizeMainnetV8MovePackageDescriptor({ modules: {} }),
    expectCode('MAINNET_V8_PACKAGE_DESCRIPTOR_DRIFT'),
  );
});
