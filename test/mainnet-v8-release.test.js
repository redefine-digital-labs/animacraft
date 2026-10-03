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

import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase64,
  fromHex,
  toBase58,
  toBase64,
} from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { populateFixtureLockDigests } from './fixtures/native-source-digest-fixture.mjs';
import { nativeSoulStageReadyFixture, nativeSoulStageOutcomeFixture } from './fixtures/native-soul-native-stage-ready-fixture.mjs';
import { decodeNativeSoulBootstrapHistoryObject } from '../scripts/native-soul-bootstrap-history.mjs';
import { nativeSoulPublicationWalFixture } from './fixtures/native-soul-full-wal-fixture.mjs';
import { nativeSoulCompletedWalFixture } from './fixtures/native-soul-completed-wal-fixture.mjs';

import {
  MAINNET_V8_PACKAGE_NAMES,
  MAINNET_V8_ROLE_ORDER,
  MAINNET_V8_PUBLISH_ORDER,
  MAINNET_V8_PUBLISH_PACKAGE_NAMES,
  MAINNET_V8_RELEASE_STEPS,
  appendReleaseWal,
  assertMainnetV8ReleaseWalContents,
  buildMainnetV8FinalSealPolicy,
  buildMainnetV8OutcomeEvidence,
  buildMainnetV8PackageArtifact,
  buildMainnetV8ReadyEvidence,
  buildMainnetV8ReleasePlanContents,
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
  abandonMainnetV8Release,
  assertMainnetV8PublishedModuleBytes,
  assertDurableMainnetV8FinalityEvidence,
  assertMainnetV8ReadyWalContext,
  assertMainnetV8ReadyWalContextContents,
  assertMainnetV8WriteGates,
  assertMainnetV8TransactionMatchesReady,
  assertMainnetV8TransactionMatchesReadyContents,
  buildMainnetV8InitTransaction,
  buildMainnetV8ReadyTransaction,
  buildMainnetV8PublishTransaction,
  createdReferencesFromEffects,
  deriveMainnetV8ProtocolConfigCommitment,
  durableMainnetV8UnsignedEnvelope,
  executeMainnetV8Release,
  hydrateMainnetV8UnsignedEnvelope,
  inspectMainnetV8FreshSourceArchive,
  inspectMainnetV8Transaction,
  normalizeMainnetV8MovePackageDescriptor,
  parseMainnetV8ReleaseArgs,
  prepareUnsignedMainnetV8Transaction,
  prepareMainnetV8Source,
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


const PACKAGE_IDS = Object.freeze(Object.fromEntries(
  MAINNET_V8_PUBLISH_ORDER.map((role, index) => [role, objectId(index + 1)]),
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
const SOURCE_REVISION_CONTENTS = {
  schema: 'animacraft.native-source-snapshot.v1',
  repositories: {
    animacraft: { baseGitCommit: 'a'.repeat(40), baseGitTree: 'b'.repeat(40) },
    soulidity: { baseGitCommit: 'c'.repeat(40), baseGitTree: 'd'.repeat(40) },
  },
  packages: MAINNET_V8_PUBLISH_ORDER.map(role => {
    const files = [
      mainnetV8SourceFileRecord('Move.toml', `[package]\nname = "${MAINNET_V8_PUBLISH_PACKAGE_NAMES[role]}"`),
      mainnetV8SourceFileRecord('Move.lock', '[move]\nversion = 4\n'),
      mainnetV8SourceFileRecord(`sources/${role}_v8.move`, `module ${role}::${role}_v8 {}`),
    ].sort((a, b) => a.path.localeCompare(b.path));
    return { role, packageName: MAINNET_V8_PUBLISH_PACKAGE_NAMES[role], repository: role === 'soulidity' ? 'soulidity' : 'animacraft',
      files, originalFiles: clone(files) };
  }),
};
const SOURCE_REVISION = Object.freeze({ ...SOURCE_REVISION_CONTENTS,
  snapshotSha256: sha256MainnetV8Json(SOURCE_REVISION_CONTENTS) });
const PLAN_TOOLCHAIN = Object.freeze({
  suiVersion: '1.80.1',
  suiVersionOutput: 'sui 1.80.1-671ba71e69c7',
  suiSourceCommit: '671ba71e69c711ded76a11ef90297c4f2d5ac474',
  suiBinarySha256: MAINNET_V8_RELEASE_TOOLCHAIN.suiBinarySha256,
  frameworkRevision: '722ac4fcf4841346c91775f596c4ce23fb7fbd0f',
});

function releasePlanFixture() {
  // Data fixture only. Execution tests below still invoke the guarded public
  // runner/WAL APIs; this does not certify a runnable release or compiled code.
  return buildMainnetV8ReleasePlanContents({
    sender: PRODUCTION_SENDER,
    sourceRevision: SOURCE_REVISION,
    toolchain: PLAN_TOOLCHAIN,
    sealPolicy: SEAL_POLICY_TEMPLATE,
    packages: SOURCE_REVISION.packages.map((source) => ({
      role: source.role,
      packageName: source.packageName,
      sourceArtifact: buildMainnetV8SourceArtifact({
        ...source,
        release: {
          snapshotSha256: SOURCE_REVISION.snapshotSha256,
          repository: source.repository,
          ...SOURCE_REVISION.repositories[source.repository],
        },
        toolchain: PLAN_TOOLCHAIN,
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
    protocolVersion: '137',
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
  const step = MAINNET_V8_RELEASE_STEPS[ordinal];
  assert.ok(step && step.kind !== 'VERIFY_AND_EXPORT');
  if (step.kind !== 'PUBLISH') {
    return { ...nativeSoulStageReadyFixture(step.kind), plan: RELEASE_PLAN };
  }
  const packageArtifact = buildMainnetV8PackageArtifact({
    role: step.role,
    modules: [{ name: 'alpha', bytes: Uint8Array.of(0) }, { name: 'beta', bytes: Uint8Array.of(1, 2) }],
    dependencies: [objectId(1), objectId(2)], buildDigest: hash32(50),
  });
  const modules = packageArtifact.modules.map(({ bytesBase64 }) => bytesBase64);
  const dependencies = [...packageArtifact.dependencies];
  const envelope = await inspectMainnetV8Transaction(buildMainnetV8PublishTransaction({
    modules, dependencies, transactionContext: transactionContext(RELEASE_PLAN.sender),
  }));
  return Object.freeze({ ordinal: String(ordinal), plan: RELEASE_PLAN,
    readyArtifact: Object.freeze({ kind: 'PUBLISH', role: step.role, packageArtifact,
      packageCommitment: mainnetV8PackageCommitment(packageArtifact),
      modules: Object.freeze(modules), dependencies: Object.freeze(dependencies),
      ...readyGateFields(envelope, ordinal),
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

async function assertMatcherRejects(fixture, label, mutate, { refreshSimulation = true } = {}) {
  const unsignedEnvelope = mutateUnsignedEnvelope(fixture.unsignedEnvelope, mutate);
  const readyArtifact = clone(fixture.readyArtifact);
  if (refreshSimulation) {
    readyArtifact.simulation.digest = unsignedEnvelope.digest;
    readyArtifact.simulation.effectsTransactionDigest = unsignedEnvelope.digest;
    const effects = bcs.TransactionEffects.parse(fromBase64(readyArtifact.simulation.effectsBcsBase64));
    (effects.V1 ?? effects.V2).transactionDigest = unsignedEnvelope.digest;
    readyArtifact.simulation.effectsBcsBase64 = toBase64(bcs.TransactionEffects.serialize(effects).toBytes());
  }
  await assert.rejects(
    assertMainnetV8TransactionMatchesReadyContents({ ...fixture, readyArtifact, unsignedEnvelope }),
    error => error.code === 'MAINNET_V8_READY_TRANSACTION_DRIFT'
      && (!refreshSimulation || /exact reviewed READY transaction/.test(error.message)),
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

let connectedPublicationPromise;
let connectedCompletedPromise;
const connectedPublications = () => connectedPublicationPromise ??= nativeSoulPublicationWalFixture();
const connectedCompleted = () => connectedCompletedPromise ??= nativeSoulCompletedWalFixture();

// Retain a validated prefix, never a hand-inserted success event. Event hashes
// stay exact; only the root head/revision/manifest projection is rebuilt.
function connectedWalPrefix(wal, length) {
  const prefix = clone(wal);
  prefix.events = prefix.events.slice(0, length);
  prefix.revision = String(length);
  prefix.headEventSha256 = prefix.events.at(-1).eventSha256;
  if (!prefix.events.some(e => e.status === 'FINAL_MANIFEST_SEALED')) {
    prefix.finalManifest = null; prefix.releaseId = null;
  }
  delete prefix.walSha256;
  prefix.walSha256 = sha256MainnetV8Json(prefix);
  assertMainnetV8ReleaseWalContents(prefix);
  return prefix;
}

async function createExecutionState(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'animacraft-mainnet-v8-runner-'));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const connected = await connectedPublications();
  const fixture = { ...connected.publications[0], plan: connected.plan };
  // Dummy fixture signatures are not authority for the fixed production signer.
  assertMainnetV8ReleaseWalContents(connectedWalPrefix(connected.wal, 1));
  await writeFile(join(stateDir, MAINNET_V8_PLAN_FILENAME), canonicalMainnetV8Json(fixture.plan) + '\n');
  await createReleaseWal({ path: join(stateDir, MAINNET_V8_WAL_FILENAME),
    plan: fixture.plan, event: { evidence: fixture.ready } });
  return Object.freeze({ stateDir, fixture });
}

async function appendWalFixture(stateDir, wal, event) {
  return appendReleaseWal({ path: join(stateDir, MAINNET_V8_WAL_FILENAME),
    expectedRevision: wal.revision, expectedHeadEventSha256: wal.headEventSha256, event });
}

async function createEightPublishFinalizedState(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'animacraft-mainnet-v8-eight-publish-'));
  t.after(async () => rm(stateDir, { recursive: true, force: true }));
  const connected = await connectedPublications();
  // The actual executor must seal the eighth certificate and request approval.
  const prefix = connectedWalPrefix(connected.wal, 40);
  await writeFile(join(stateDir, MAINNET_V8_PLAN_FILENAME), canonicalMainnetV8Json(connected.plan) + '\n');
  let wal = await createReleaseWal({ path: join(stateDir, MAINNET_V8_WAL_FILENAME),
    plan: connected.plan, event: { evidence: prefix.events[0].evidence } });
  for (const event of prefix.events.slice(1)) {
    wal = await appendWalFixture(stateDir, wal, { ordinal: event.ordinal, attempt: event.attempt,
      status: event.status, evidence: event.evidence });
  }
  assert.equal(wal.events.at(-1).ordinal, '7');
  assert.equal(wal.events.at(-1).status, 'FINALIZED_SUCCESS');
  assert.equal(wal.events.filter(e => e.status === 'FINALIZED_SUCCESS').length, 8);
  return Object.freeze({ stateDir, wal, plan: connected.plan, connected });
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

function publishCertificationFixture(fixture, signedArtifact) {
  // Full Object/package/ABI/effects evidence comes from the connected fixture.
  // Injected signature verification below tests ordering, not authorization:
  // RELEASE_KEYPAIR is not the fixed approved production signer.
  const { certificate } = fixture.input.observation;
  assert.equal(signedArtifact.digest, certificate.finalityEvidence.digest);
  assert.equal(signedArtifact.transactionBase64, certificate.finalityEvidence.transactionBase64);
  const finalityEvidence = Object.freeze({ ...certificate.finalityEvidence,
    signature: signedArtifact.signature, signatureSha256: signedArtifact.signatureSha256 });
  return Object.freeze({ finalityEvidence, readback: certificate.readback });
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
  assert.deepEqual(parseMainnetV8ReleaseArgs([
    'abandon', '--state-dir', '/tmp/release-state',
    '--execution-plan-id', hash32(1), '--release-id', hash32(2),
    '--reason-code', 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH',
  ]), {
    command: 'abandon',
    options: {
      'state-dir': '/tmp/release-state',
      'execution-plan-id': hash32(1),
      'release-id': hash32(2),
      'reason-code': 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH',
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

test('protocol-137 toolchain identity remains pinned in the runner-facing contract', () => {
  assert.deepEqual(MAINNET_V8_RELEASE_TOOLCHAIN, {
    suiVersion: '1.80.1',
    suiSourceCommit: '671ba71e69c711ded76a11ef90297c4f2d5ac474',
    suiVersionOutput: 'sui 1.80.1-671ba71e69c7',
    suiBinarySha256: '1d7baa7c7314113671415acfa20279b1eedb6ae6d04f286988a00da285e769c3',
    protocolVersion: '137',
    objectRuntimeMaxCachedObjects: '1000',
    objectRuntimeMaxStoreEntries: '1000',
    frameworkRevision: '722ac4fcf4841346c91775f596c4ce23fb7fbd0f',
  });
});

test('fresh source archive freezes both dirty repositories and validates all eight plan artifacts', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'animacraft-mainnet-v8-source-'));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const roots = { animacraft: join(temp, 'animacraft'), soulidity: join(temp, 'soulidity') };
  for (const root of Object.values(roots)) {
    await mkdir(root); await execFileAsync('git', ['init', '-q'], { cwd: root });
    await writeFile(join(root, 'base.txt'), 'base identity only');
    await execFileAsync('git', ['add', 'base.txt'], { cwd: root });
    await execFileAsync('git', ['-c', 'user.name=Animacraft Test', '-c', 'user.email=source@example.invalid',
      'commit', '-qm', 'fixture'], { cwd: root });
  }
  const pkg = role => join(roots[role === 'soulidity' ? 'soulidity' : 'animacraft'], 'move', MAINNET_V8_PUBLISH_PACKAGE_NAMES[role]);
  for (const role of MAINNET_V8_PUBLISH_ORDER) {
    const name = MAINNET_V8_PUBLISH_PACKAGE_NAMES[role], deps = role === 'core' ? [] : role === 'release' ? ['core', 'soulidity'] : ['core'];
    await mkdir(join(pkg(role), 'sources'), { recursive: true });
    await writeFile(join(pkg(role), 'Move.toml'), `[package]\nname = "${name}"\nedition = "2024.beta"\n[dependencies]\n`
      + deps.map(dep => `${MAINNET_V8_PUBLISH_PACKAGE_NAMES[dep]} = { local = "${pkg(dep)}" }`).join('\n')
      + `\n[addresses]\n${name} = "0x0"\n`);
    await writeFile(join(pkg(role), 'Move.lock'), '[move]\nversion = 4\n');
    await writeFile(join(pkg(role), 'sources', `${role}_v8.move`), `module ${name}::${role}_v8;\npublic fun role(): u8 { ${role.length} }\n`);
  }
  await populateFixtureLockDigests(pkg, MAINNET_V8_PUBLISH_ORDER, MAINNET_V8_PUBLISH_PACKAGE_NAMES);
  const args = { repositoryRoot: roots.animacraft, soulidityRoot: roots.soulidity, toolchain: PLAN_TOOLCHAIN };
  const sourceStorePath = join(temp, 'cas');
  const captured = await prepareMainnetV8Source({ ...args, storePath: sourceStorePath, checkoutRoot: join(temp, 'checkout') });
  const plan = buildMainnetV8ReleasePlanContents({ ...captured, sender: PRODUCTION_SENDER, sealPolicy: SEAL_POLICY_TEMPLATE });
  assert.equal(plan.packages.length, 8); assert.equal(plan.steps.length, 14);
  const first = await inspectMainnetV8FreshSourceArchive({ sourceStorePath, plan });
  assert.deepEqual(first.sourceRevision, captured.sourceRevision);
  assert.deepEqual(first.sourceCommitments, Object.fromEntries(plan.packages.map(row => [row.role, row.sourceCommitment])));
  // SOURCE is captured dirty bytes, not HEAD. Later edits must not change the
  // old CAS; a new capture must have different commitments in both repositories.
  for (const role of ['core', 'soulidity']) {
    const filename = join(pkg(role), 'sources', `${role}_v8.move`);
    await writeFile(filename, `${await readFile(filename, 'utf8')}// later dirty edit\n`);
  }
  assert.deepEqual(await inspectMainnetV8FreshSourceArchive({ sourceStorePath, plan }), first);
  const changed = await prepareMainnetV8Source({ ...args, storePath: join(temp, 'changed-cas'), checkoutRoot: join(temp, 'changed-checkout') });
  for (const role of ['core', 'soulidity']) assert.notEqual(changed.packages.find(row => row.role === role).sourceCommitment,
    first.sourceCommitments[role]);
  await assert.rejects(inspectMainnetV8FreshSourceArchive({ sourceStorePath, plan: changed }), /source|snapshot|CAS/i);
  const corrupt = plan.sourceRevision.packages[0].files.find(row => row.path.endsWith('.move'));
  await writeFile(join(sourceStorePath, corrupt.sha256), 'corrupt frozen bytes');
  await assert.rejects(inspectMainnetV8FreshSourceArchive({ sourceStorePath, plan }), /source|CAS/i);
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
    domain: 'animacraft-fresh-v8/core/protocol-config/v2',
    schema_revision: '8',
    config_id: input.configId,
    config_revision: input.revision,
    enabled: input.enabled,
    core_original_package_id: input.coreOriginalPackageId,
    core_callable_package_id: input.coreCallablePackageId,
    treasury_id: input.treasuryId,
    payment_coin_type: MAINNET_V8_USDC_TYPE,
    primary_content_fee_bps: 1000,
    fixed_complete_fee_atomic: '0',
    maker_market_fee_bps: 250,
    soul_market_fee_bps: 250,
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


test('native bootstrap full Object BCS rejects decoded JSON, object identity, retired option projection and truncated bytes', () => {
  const input = nativeSoulStageOutcomeFixture('SETUP_RELEASE');
  const readback = input.observation.certificate.readback;
  const catalog = readback.objects.catalog;
  const options = { kind: 'catalog', packageIds: readback.input.packageIds };
  const parsed = decodeNativeSoulBootstrapHistoryObject(catalog, options);
  assert.equal(parsed.fields.id, catalog.reference.objectId);
  assert.equal(parsed.fields.protocol_config_revision, '2');
  const slot = readback.objects.bootstrapSlot;
  const slotOptions = { kind: 'bootstrapSlot', packageIds: readback.input.packageIds };
  assert.equal(decodeNativeSoulBootstrapHistoryObject(slot, slotOptions).fields.value.admin_id, null);

  const jsonDrift = clone(catalog);
  jsonDrift.fields = { protocol_config_revision: '3' };
  assert.throws(() => decodeNativeSoulBootstrapHistoryObject(jsonDrift, options),
    error => error.code === 'NATIVE_SOUL_BOOTSTRAP_HISTORY_INVALID',
    'decoded JSON cannot override full historical Object BCS');

  const identityDrift = clone(catalog);
  identityDrift.reference.objectId = objectId(194);
  assert.throws(() => decodeNativeSoulBootstrapHistoryObject(identityDrift, options),
    error => error.code === 'MAKER_V8_SUI_GRPC_HISTORY_BCS_DRIFT',
    'object reference must equal the UID inside full Object BCS');

  const retiredOptionArray = clone(slot);
  retiredOptionArray.fields = { value: { admin_id: [] } };
  assert.throws(() => decodeNativeSoulBootstrapHistoryObject(retiredOptionArray, slotOptions),
    error => error.code === 'NATIVE_SOUL_BOOTSTRAP_HISTORY_INVALID',
    'caller-projected Move Option JSON cannot enter the raw-only historical journal');

  const truncated = clone(catalog);
  truncated.objectBcsBase64 = toBase64(fromBase64(truncated.objectBcsBase64).slice(0, -1));
  assert.throws(() => decodeNativeSoulBootstrapHistoryObject(truncated, options), RangeError,
    'truncated full Object cannot be decoded as canonical BCS');
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

test('unsigned preparation converges from available balance to the exact dry-run budget', async () => {
  const addressBalance = '262225153';
  const observedBudgets = [];
  const observedSimulationModes = [];
  const gasUsed = Object.freeze({
    computationCost: '10000000',
    storageCost: '20000000',
    storageRebate: '0',
    nonRefundableStorageFee: '0',
  });
  const client = {
    core: {
      async getBalance() {
        return { balance: {
          coinType: `0x${'0'.repeat(63)}2::sui::SUI`,
          addressBalance,
          coinBalance: addressBalance,
        } };
      },
    },
    async simulateTransaction({ transaction, checksEnabled, doGasSelection }) {
      const parsed = bcs.TransactionData.parse(transaction);
      observedBudgets.push(String(parsed.V1.gasData.budget));
      observedSimulationModes.push({ checksEnabled, doGasSelection });
      const digest = TransactionDataBuilder.getDigestFromBytes(transaction);
      const effectsBcs = bcs.TransactionEffects.serialize({
        V1: {
          status: { Success: true },
          executedEpoch: '1233',
          gasUsed,
          modifiedAtVersions: [],
          sharedObjects: [],
          transactionDigest: digest,
          created: [],
          mutated: [],
          unwrapped: [],
          deleted: [],
          unwrappedThenDeleted: [],
          wrapped: [],
          gasObject: [{
            objectId: objectId(79), version: '1', digest: objectDigest(79),
          }, { AddressOwner: PRODUCTION_SENDER }],
          eventsDigest: null,
          dependencies: [],
        },
      }).toBytes();
      return {
        $kind: 'Transaction',
        Transaction: {
          digest,
          status: { success: true },
          bcs: transaction,
          effects: {
            status: { success: true },
            transactionDigest: digest,
            gasUsed,
            bcs: effectsBcs,
            changedObjects: [],
          },
          objectTypes: {},
        },
      };
    },
  };
  const profile = Object.freeze({
    chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
    protocolVersion: '137',
    epoch: '1233',
    gasPrice: '1000',
    attributes: Object.freeze({
      objectRuntimeMaxNumCachedObjects: '1000',
      objectRuntimeMaxNumStoreEntries: '1000',
    }),
  });
  const prepared = await prepareUnsignedMainnetV8Transaction({
    client,
    profile,
    sender: PRODUCTION_SENDER,
    nonce: 1,
    buildTransaction: (transactionContext) => buildMainnetV8PublishTransaction({
      modules: ['AA=='],
      dependencies: [objectId(1)],
      transactionContext,
    }),
  });
  assert.deepEqual(observedBudgets, ['2000000000', '160000000']);
  assert.deepEqual(observedSimulationModes, [
    { checksEnabled: false, doGasSelection: false },
    { checksEnabled: true, doGasSelection: true },
  ]);
  assert.equal(prepared.unsignedEnvelope.gasBudget, '160000000');
  assert.equal(prepared.simulation.recommendedGasBudget, '160000000');
  assert.equal(prepared.gasFunding.addressBalance, addressBalance);
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

test('four native bootstrap TransactionKinds preserve exact commitments, markers, configs, replacement and caller-cap ordering', async () => {
  const connected = await connectedCompleted();
  const expected = {
    INITIALIZE_PROTOCOL: ['initialize_protocol_treasury_v8', 'set_protocol_enabled_v8'],
    SETUP_RELEASE: [
      'install_soulidity_binding_v8',
      ...Array(7).fill('new_package_commitments_v8'), 'certify_product_release_catalog_v8',
      ...MAINNET_V8_ROLE_ORDER.slice(1).flatMap(role => ['take_' + role + '_call_cap_v8',
        role === 'seal' ? 'new_seal_policy_config_v8' : 'new_' + role + '_package_config_v8']),
      'assert_catalog_setup_complete_v2', 'bootstrap_walrus_certification_policy_v1',
      ...Array(4).fill('id'), 'new_fresh_tuple_replacement_binding_input_v2',
      'seal_fresh_tuple_replacement_binding_v2',
      ...MAINNET_V8_ROLE_ORDER.slice(1).map(role => role === 'seal'
        ? 'share_seal_policy_config_v8' : 'share_' + role + '_package_config_v8'),
      'share_product_release_catalog_v8', 'epoch',
    ],
    BEGIN_BOOTSTRAP: ['begin_fresh_tuple_bootstrap_v2'],
    FINALIZE_BOOTSTRAP: ['mint_runtime_caller_caps_v1', 'install_output_runtime_caller_cap_v2',
      'install_market_runtime_caller_cap_v2', 'finalize_fresh_tuple_bootstrap_v2'],
  };
  for (const row of connected.stages) {
    const envelope = hydrateMainnetV8UnsignedEnvelope(row.unsignedEnvelope);
    const tx = bcs.TransactionData.parse(envelope.transactionBytes).V1;
    const rebuilt = await inspectMainnetV8Transaction(buildMainnetV8ReadyTransaction({
      ordinal: row.ordinal, readyArtifact: row.readyArtifact,
      transactionContext: { sender: tx.sender, gasPrice: tx.gasData.price, gasBudget: tx.gasData.budget,
        epoch: tx.expiration.ValidDuring.minEpoch, chainIdentifier: tx.expiration.ValidDuring.chain,
        nonce: tx.expiration.ValidDuring.nonce },
    }));
    assert.equal(rebuilt.transactionBase64, envelope.transactionBase64);
    const kind = programmableKind(envelope);
    assert.deepEqual(kind.commands.map(c => c.MoveCall.function), expected[row.stage]);
    const ids = row.readyArtifact.stageData.packageIds;
    const modules = { seal: 'seal_v8', runtime: 'runtime_binding_v8', output: 'output_v8',
      physical: 'physical_v8', market: 'market_v8', release: 'release_v8' };
    const expectedTargets = expected[row.stage].map(name => {
      if (name === 'epoch') return `${row.readyArtifact.stageData.walrusExecution.package.reference.objectId}::system::epoch`;
      if (name === 'id') return `0x${'2'.padStart(64, '0')}::object::id`;
      if (row.stage === 'INITIALIZE_PROTOCOL') return `${ids.core}::protocol_config_v8::${name}`;
      if (name === 'install_soulidity_binding_v8') return `${ids.core}::soulidity_binding_v8::${name}`;
      if (name === 'bootstrap_walrus_certification_policy_v1') return `${ids.core}::core_v8::${name}`;
      const role = MAINNET_V8_ROLE_ORDER.slice(1).find(role => name === `new_${role}_package_config_v8`
        || name === `share_${role}_package_config_v8`
        || role === 'seal' && ['new_seal_policy_config_v8', 'share_seal_policy_config_v8'].includes(name)
        || name === `install_${role}_runtime_caller_cap_v2`);
      return role ? `${ids[role]}::${modules[role]}::${name}` : `${ids.core}::package_binding_v8::${name}`;
    });
    assert.deepEqual(kind.commands.map(moveCallTarget), expectedTargets);
    assert.equal(kind.commands.length, { INITIALIZE_PROTOCOL: 2, SETUP_RELEASE: 37,
      BEGIN_BOOTSTRAP: 1, FINALIZE_BOOTSTRAP: 4 }[row.stage]);
    assert.equal(kind.inputs[0].Object.SharedObject.mutable, ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE'].includes(row.stage));
    if (row.stage === 'SETUP_RELEASE') {
      assert.deepEqual(kind.commands[0].MoveCall.typeArguments, [
        ids.soulidity + '::soul::Soul',
        ids.soulidity + '::animacraft_v8_binding::MintBindingWitnessV8',
        ids.soulidity + '::animacraft_v8_binding::SoulOwnerWitnessV8',
      ]);
      const certify = kind.commands[8].MoveCall;
      assert.equal(certify.typeArguments.length, 14);
      assert.deepEqual(certify.typeArguments.slice(0, 2), [
        ids.core + '::protocol_config_v8::CorePackageMarkerV8',
        ids.core + '::protocol_config_v8::CorePackageMarkerV8',
      ]);
      MAINNET_V8_ROLE_ORDER.slice(1).forEach((role, i) => {
        assert.ok(certify.typeArguments[2 + i * 2].startsWith(ids[role] + '::'));
        assert.ok(certify.typeArguments[3 + i * 2].startsWith(ids[role] + '::'));
      });
    }
  }
});

test('READY matcher accepts exact eight publications and all five current native transaction stages', async () => {
  for (let ordinal = 0; ordinal <= 12; ordinal++) {
    const fixture = await matcherFixture(ordinal);
    assert.deepEqual(await assertMainnetV8TransactionMatchesReadyContents(fixture), {
      ordinal: String(ordinal), digest: fixture.unsignedEnvelope.digest,
      transactionSha256: fixture.unsignedEnvelope.transactionSha256,
      transactionKindSha256: fixture.unsignedEnvelope.transactionKindSha256,
    });
  }
});

test('READY matcher rejects every publish command/content mutation after envelope rehash', async () => {
  for (let ordinal = 0; ordinal < MAINNET_V8_PUBLISH_ORDER.length; ordinal++) {
    const fixture = await matcherFixture(ordinal);
    await assertMatcherRejects(fixture, 'publish module bytes', transaction => {
      programmableTransaction(transaction).commands[0].Publish.modules[0] = 'Ag==';
    });
    await assertMatcherRejects(fixture, 'publish dependency', transaction => {
      programmableTransaction(transaction).commands[0].Publish.dependencies[0] = objectId(99);
    });
    await assertMatcherRejects(fixture, 'UpgradeCap transfer address', transaction => {
      const programmable = programmableTransaction(transaction);
      const input = programmable.commands[1].TransferObjects.address.Input;
      replacePureInput(programmable, input, bcs.Address.serialize(objectId(98)).toBytes());
    });
    await assertMatcherRejects(fixture, 'publish command order', transaction => {
      programmableTransaction(transaction).commands.reverse();
    });
  }
});

test('READY matcher rejects every initialize target, argument, object-ref, bool, and order mutation', async () => {
  const fixture = await matcherFixture(8);
  const mutations = [
    ['init package target', transaction => { programmableTransaction(transaction).commands[0].MoveCall.package = objectId(99); }],
    ['init function target', transaction => { programmableTransaction(transaction).commands[0].MoveCall.function = 'tampered_init_v8'; }],
    ['init USDC type argument', transaction => { programmableTransaction(transaction).commands[0].MoveCall.typeArguments[0] = `${objectId(2)}::sui::SUI`; }],
    ['init protocol config ref', transaction => { programmableTransaction(transaction).inputs[0].Object.SharedObject.objectId = objectId(97); }],
    ['init protocol admin ref', transaction => { programmableTransaction(transaction).inputs[1].Object.ImmOrOwnedObject.objectId = objectId(96); }],
    ['init enabled bool', transaction => { replacePureInput(programmableTransaction(transaction), 2, bcs.bool().serialize(false).toBytes()); }],
    ['init command order', transaction => { programmableTransaction(transaction).commands.reverse(); }],
  ];
  for (const [label, mutate] of mutations) await assertMatcherRejects(fixture, label, mutate);
});

test('READY matcher rejects the exhaustive current bootstrap and market command/type/input mutation matrix', async () => {
  // These are the real current PTB inventories, replacing the retired monolithic
  // 27-command graph. Rehashed simulation evidence ensures failures reach exact
  // transaction-byte comparison, not merely the old simulation digest gate.
  const counts = { 8: [2, 1, 3], 9: [37, 21, 31], 10: [1, 0, 4], 11: [4, 0, 6], 12: [2, 0, 4] };
  for (let ordinal = 8; ordinal <= 12; ordinal++) {
    const fixture = await matcherFixture(ordinal);
    const baseline = programmableKind(hydrateMainnetV8UnsignedEnvelope(fixture.unsignedEnvelope));
    assert.deepEqual([baseline.commands.length, baseline.commands.reduce((n, command) => n + (command.MoveCall?.typeArguments.length ?? 0), 0),
      baseline.inputs.length], counts[ordinal]);
    for (const [index, command] of baseline.commands.entries()) {
      assert.equal(command.$kind, 'MoveCall');
      for (const field of ['package', 'module', 'function']) await assertMatcherRejects(fixture,
        `${ordinal} command ${index} ${field}`, transaction => {
          programmableTransaction(transaction).commands[index].MoveCall[field] = field === 'package' ? objectId(99) : `tampered_${index}`;
        });
      for (let typeIndex = 0; typeIndex < command.MoveCall.typeArguments.length; typeIndex++) {
        await assertMatcherRejects(fixture, `${ordinal} command ${index} type ${typeIndex}`, transaction => {
          programmableTransaction(transaction).commands[index].MoveCall.typeArguments[typeIndex] = `${objectId(99)}::tampered::Marker${typeIndex}`;
        });
      }
      for (const [argumentIndex, argument] of command.MoveCall.arguments.entries()) {
        await assertMatcherRejects(fixture, `${ordinal} command ${index} argument ${argumentIndex}`, transaction => {
          programmableTransaction(transaction).commands[index].MoveCall.arguments[argumentIndex] = {
            Input: argument.$kind === 'Input' ? (argument.Input + 1) % baseline.inputs.length : 0,
          };
        });
      }
    }
    for (const [index, input] of baseline.inputs.entries()) {
      if (input.$kind === 'Pure') {
        await assertMatcherRejects(fixture, `${ordinal} pure input ${index}`, transaction => {
          const bytes = fromBase64(programmableTransaction(transaction).inputs[index].Pure.bytes);
          assert.ok(bytes.length > 0); bytes[bytes.length - 1] ^= 1;
          replacePureInput(programmableTransaction(transaction), index, bytes);
        });
      } else {
        assert.equal(input.$kind, 'Object');
        const shared = input.Object.$kind === 'SharedObject';
        assert.ok(shared || input.Object.$kind === 'ImmOrOwnedObject');
        for (const field of shared ? ['objectId', 'initialSharedVersion', 'mutable'] : ['objectId', 'version', 'digest']) {
          await assertMatcherRejects(fixture, `${ordinal} object input ${index} ${field}`, transaction => {
            const object = programmableTransaction(transaction).inputs[index].Object;
            const row = shared ? object.SharedObject : object.ImmOrOwnedObject;
            row[field] = field === 'objectId' ? objectId(95) : field === 'digest' ? objectDigest(95)
              : field === 'mutable' ? !row.mutable : String(BigInt(row[field]) + 1n);
          });
        }
      }
    }
    for (let index = 0; index < baseline.commands.length - 1; index++) {
      await assertMatcherRejects(fixture, `${ordinal} adjacent order ${index}`, transaction => {
        const commands = programmableTransaction(transaction).commands;
        [commands[index], commands[index + 1]] = [commands[index + 1], commands[index]];
      });
    }
    await assertMatcherRejects(fixture, `${ordinal} missing command`, transaction => { programmableTransaction(transaction).commands.pop(); });
    await assertMatcherRejects(fixture, `${ordinal} extra command`, transaction => {
      const commands = programmableTransaction(transaction).commands; commands.push(structuredClone(commands[0]));
    });
  }
});

test('READY matcher cold-read rejects sender, gas, expiration, nonce, and chain mutation after rehash', async () => {
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
  for (let ordinal = 0; ordinal <= 12; ordinal++) {
    const fixture = await matcherFixture(ordinal);
    for (const [label, mutate] of mutations) {
      await assertMatcherRejects(fixture, label, mutate, { refreshSimulation: false });
    }
  }
});

test('ordinal 8 through 13 READY contexts are inseparable from the sealed manifest and exact certified predecessors', async (t) => {
  const connected = await connectedCompleted();
  const rows = [...connected.stages, { ...connected.market, ordinal: '12' },
    { ordinal: '13', readyArtifact: connected.verify.ready.readyArtifact }];
  for (const row of rows) {
    const index = connected.wal.events.findIndex(e => e.ordinal === row.ordinal && e.status === 'READY');
    const prior = connectedWalPrefix(connected.wal, index);
    const ready = row.readyArtifact;
    assert.equal(assertMainnetV8ReadyWalContextContents({ wal: prior, ordinal: row.ordinal, readyArtifact: ready }), ready);
    const mutations = [
      ['predecessor', r => { r.predecessorReadback.certificateSha256 = hash32(212); }],
    ];
    if (BigInt(row.ordinal) <= 11n) mutations.push(
      ['manifest package IDs', r => { r.stageData.packageIds.seal = objectId(210); }],
      ['Core config ref', r => { r.stageData.protocolConfig.objectId = objectId(211); }],
      ['Core admin ref', r => { r.stageData.protocolAdminCap.version = '99'; }],
    );
    if (row.ordinal === '9') mutations.push(
      ['manifest commitments', r => { r.stageData.commitments.output.abi = hash32(221); }],
      ['final Seal policy', r => { r.stageData.sealPolicy = clone(SEAL_POLICY_TEMPLATE); }],
      ['key-server certificate', r => { r.stageData.keyServerCertificates[0].objectId = objectId(223); }],
    );
    if (row.ordinal === '10' || row.ordinal === '11') mutations.push(
      ['catalog', r => { r.stageData.catalog.objectId = objectId(222); }],
      ['replacement', r => { r.stageData.replacement.version = '99'; }],
    );
    if (row.ordinal === '11') mutations.push(
      ['bootstrap admin', r => { r.stageData.bootstrapAdmin.version = '99'; }],
      ['actual installed output config', r => { r.stageData.outputConfig.objectId = objectId(220); }],
    );
    if (row.ordinal === '12') mutations.push(
      ['Soulidity package', r => { r.stageData.packageId = objectId(210); }],
      ['market config', r => { r.stageData.marketConfig.objectId = objectId(211); }],
      ['market admin', r => { r.stageData.marketAdminCap.version = '99'; }],
    );
    if (row.ordinal === '13') mutations.push(
      ['bootstrap certificate', r => { r.stageData.bootstrapCertificateSha256 = hash32(220); }],
      ['activation certificate', r => { r.stageData.marketActivationCertificateSha256 = hash32(221); }],
    );
    for (const [label, mutate] of mutations) {
      const changed = clone(ready); mutate(changed);
      changed.stageDataSha256 = sha256MainnetV8Json(changed.stageData);
      assert.throws(() => assertMainnetV8ReadyWalContextContents({
        wal: prior, ordinal: row.ordinal, readyArtifact: changed,
      }), error => error.code === (label === 'key-server certificate'
        ? 'MAINNET_V8_WAL_EVIDENCE_INVALID' : 'MAINNET_V8_READY_CONTEXT_DRIFT'),
      row.ordinal + ': ' + label);
    }
  }

  // Keep the original real FS/executor boundary and its public context check.
  // The offline Contents positives above do not open this guarded execution.
  const { stateDir, plan } = await createEightPublishFinalizedState(t);
  const sealed = await executeMainnetV8Release({
    stateDir, suiBinary: '/offline/fake-sui', expectedExecutionPlanId: plan.executionPlanId,
    maximumTransitions: 1, dependencies: { inspectToolchain: async () => plan.toolchain },
  });
  assert.equal(sealed.status, 'FINAL_MANIFEST_REVIEW_REQUIRED');
  const initReady = connected.stages[0].readyArtifact;
  assert.equal(assertMainnetV8ReadyWalContext({ wal: sealed.wal, ordinal: '8', readyArtifact: initReady }), initReady);
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
  const { stateDir, plan } = await createEightPublishFinalizedState(t);
  const walPath = join(stateDir, MAINNET_V8_WAL_FILENAME);
  const calls = [];
  const unreachable = (name) => (...args) => {
    calls.push([name, args]);
    assert.fail(`${name} is unreachable while sealing or rejecting approval`);
  };
  const dependencies = {
    inspectToolchain: async () => {
      calls.push(['inspectToolchain']);
      return plan.toolchain;
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
    expectedExecutionPlanId: plan.executionPlanId,
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

test('sealed pre-init release records the reviewed payment-type incident as terminal abandonment', async (t) => {
  const { stateDir, plan } = await createEightPublishFinalizedState(t);
  const walPath = join(stateDir, MAINNET_V8_WAL_FILENAME);
  const sealed = await executeMainnetV8Release({
    stateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: plan.executionPlanId,
    maximumTransitions: 1,
    dependencies: {
      inspectToolchain: async () => plan.toolchain,
    },
  });
  assert.equal(sealed.status, 'FINAL_MANIFEST_REVIEW_REQUIRED');
  const sealedBytes = await readFile(walPath, 'utf8');

  await assert.rejects(abandonMainnetV8Release({
    stateDir,
    expectedExecutionPlanId: plan.executionPlanId,
    expectedReleaseId: sealed.wal.releaseId,
    reasonCode: 'UNREVIEWED_REASON',
  }), expectCode('MAINNET_V8_ABANDON_REASON_INVALID'));
  assert.equal(await readFile(walPath, 'utf8'), sealedBytes);

  await assert.rejects(abandonMainnetV8Release({
    stateDir,
    expectedExecutionPlanId: plan.executionPlanId,
    expectedReleaseId: hash32(203),
    reasonCode: 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH',
  }), expectCode('MAINNET_V8_RELEASE_ID_NOT_APPROVED'));
  assert.equal(await readFile(walPath, 'utf8'), sealedBytes);

  const result = await abandonMainnetV8Release({
    stateDir,
    expectedExecutionPlanId: plan.executionPlanId,
    expectedReleaseId: sealed.wal.releaseId,
    reasonCode: 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH',
  });
  const head = result.wal.events.at(-1);
  assert.equal(result.status, 'RELEASE_ABANDONED');
  assert.equal(head.status, 'RELEASE_ABANDONED');
  assert.equal(head.evidence.releaseId, sealed.wal.releaseId);
  assert.equal(head.evidence.reason.failedOrdinal, '8');
  assert.equal(head.evidence.reason.errorCode, 'MAINNET_V8_SIMULATION_FAILED');
  assert.equal(head.evidence.reason.moveAbort.abortCode, '3');
  assert.equal(
    head.evidence.reason.moveAbort.packageId,
    sealed.wal.finalManifest.packages.find((entry) => entry.role === 'core').packageId,
  );

  let externalCalls = 0;
  const resumed = await executeMainnetV8Release({
    stateDir,
    suiBinary: '/offline/fake-sui',
    expectedExecutionPlanId: plan.executionPlanId,
    expectedReleaseId: sealed.wal.releaseId,
    maximumTransitions: 1,
    dependencies: {
      inspectToolchain: async () => { externalCalls += 1; },
    },
  });
  assert.equal(resumed.status, 'RELEASE_ABANDONED');
  assert.equal(externalCalls, 0);
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

test('execute runner durably orders signing, double NOT_FOUND, broadcast, and query-first saved-intent resume', async (t) => {
  const { stateDir, fixture } = await createExecutionState(t);
  const signedArtifact = await signEnvelopeFixture(fixture.unsignedEnvelope);
  const { finalityEvidence } = publishCertificationFixture(fixture, signedArtifact);
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
        epoch: fixture.unsignedEnvelope.expiration.ValidDuring.minEpoch,
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

test('execute runner distinguishes transient transport failure from semantic gRPC drift', async (t) => {
  for (const code of ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'MAKER_V8_SUI_GRPC_HISTORY_JSON_DRIFT', 'MAKER_V8_SUI_GRPC_HISTORY_BCS_INVALID']) {
    await t.test(code, async (t) => {
      const { stateDir, fixture } = await createExecutionState(t);
      const signedArtifact = await signEnvelopeFixture(fixture.unsignedEnvelope);
      const { finalityEvidence } = publishCertificationFixture(fixture, signedArtifact);
      let signs = 0;
      const result = await executeMainnetV8Release({
        stateDir, suiBinary: '/offline/fake-sui', expectedExecutionPlanId: fixture.plan.executionPlanId,
        client: {}, transport: {}, maximumTransitions: 4,
        dependencies: {
          inspectToolchain: async () => fixture.plan.toolchain,
          assertProtocolProfile: async () => fixture.readyArtifact.protocolProfile,
          assertReadyBuild: async () => Object.freeze({ kind: 'PUBLISH_BUILD_VERIFIED' }),
          assertReadyAuthority: async () => Object.freeze({ kind: 'NO_STAGE_AUTHORITY', ordinal: '0' }),
          signExactTransaction: async () => { signs += 1; return signedArtifact; },
          verifySignedArtifact: acceptFixtureSignedArtifact,
          queryFinalizedOutcome: async () => ({ status: 'FINALIZED_SUCCESS', evidence: finalityEvidence }),
          broadcastExactTransaction: async () => assert.fail('finalized transaction cannot broadcast'),
          certifyReadback: async () => { throw Object.assign(new Error('readback failure'), { code }); },
        },
      });
      const transient = ['UNAVAILABLE', 'DEADLINE_EXCEEDED'].includes(code);
      assert.equal(result.status, transient ? 'READBACK_RETRY_REQUIRED' : 'INCIDENT_STOPPED');
      assert.equal((await coldHead(stateDir)).event.status,
        transient ? 'FINALIZED_SUCCESS_PENDING_READBACK' : 'INCIDENT_STOPPED');
      assert.equal(signs, 1);
    });
  }
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
        [objectId(76), {
          inputState: { NotExist: true },
          outputState: { NotExist: true },
          idOperation: { Created: true },
        }],
        [objectId(77), {
          inputState: { NotExist: true },
          outputState: { NotExist: true },
          idOperation: { Created: true },
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
  impossibleCreatedAccumulator.V2.changedObjects.find(([id]) => id === objectId(75))[1].idOperation = { Created: true };
  const impossibleBytes = bcs.TransactionEffects.serialize(impossibleCreatedAccumulator).toBytes();
  assert.throws(
    () => writtenReferencesFromEffects(impossibleBytes, transactionDigest),
    expectCode('MAINNET_V8_CREATED_OUTPUT_INVALID'),
  );
  // Only NotExist -> NotExist + Created is the legitimate created-and-wrapped
  // shape; an existing input cannot masquerade as a newly created hidden object.
  const impossibleCreatedExisting = structuredClone(bcs.TransactionEffects.parse(effectsBytes));
  impossibleCreatedExisting.V2.changedObjects.at(-1)[1].inputState = {
    Exist: [['54', objectDigest(77)], { AddressOwner: RELEASE_SENDER }],
  };
  assert.throws(() => writtenReferencesFromEffects(
    bcs.TransactionEffects.serialize(impossibleCreatedExisting).toBytes(), transactionDigest,
  ), expectCode('MAINNET_V8_CREATED_OUTPUT_INVALID'));
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
    }), { code: 'MAINNET_V8_PACKAGE_BYTES_DRIFT' });
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
