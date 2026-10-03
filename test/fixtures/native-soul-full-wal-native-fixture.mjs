import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { deriveDynamicFieldID, fromBase64, toBase64 } from '@mysten/sui/utils';
import * as L from '../../scripts/mainnet-v8-release-lib.mjs';
import { nativeSoulBootstrapContextFromWal, assertMainnetV8TransactionMatchesReadyContents } from '../../scripts/mainnet-v8-release.mjs';
import { buildNativeSoulBootstrapTransaction } from '../../scripts/native-soul-bootstrap-transactions.mjs';
import { bootstrapStages, bootstrapId as id, nativeSoulBootstrapFixture } from './native-soul-bootstrap-fixture.mjs';
import { bootstrapHistoryFixture, historicalObject, rewriteHistoricalObject, bcsOwner } from './native-soul-bootstrap-history-fixture.mjs';
import { nativeSoulStageDataFixture } from './native-soul-native-stage-ready-fixture.mjs';
import { bootstrapFinalityEvents } from './native-soul-bootstrap-events-fixture.mjs';
import { nativeSoulPublicationWalFixture, fixtureReadyFromOutcome, appendFixtureEvent } from './native-soul-full-wal-fixture.mjs';

// Connected offline Contents evidence, not signatures, checkpoint execution or
// network certification. Events use actual Move layouts and state commitments;
// installation/capability fields retain the independent fixture's explicitly
// synthetic subproofs. Encoded events are not proof of VM execution.
export async function nativeSoulBootstrapWalStageFixture({ wal, stage, contextOverride }) {
  const extras = stage === 'SETUP_RELEASE' ? nativeSoulStageDataFixture(stage) : {};
  const derived = nativeSoulBootstrapContextFromWal({ wal, stage,
    ...(stage === 'SETUP_RELEASE' ? { keyServerCertificates: extras.keyServerCertificates,
      walrusSystem: extras.walrusSystem, walrusExecution: extras.walrusExecution } : {}) });
  const { stageData, priorObjects } = structuredClone(contextOverride ?? derived);
  const input = L.nativeSoulBootstrapInputFromStageData(stage, stageData);
  const ordinal = L.MAINNET_V8_RELEASE_STEPS.find(row => row.kind === stage).ordinal;
  const sender = wal.plan.sender;
  const contents = nativeSoulBootstrapFixture(stage, {
    commitments: L.mainnetV8CatalogCommitmentsFromFinalManifest(wal.finalManifest, wal.plan),
  });
  const template = bootstrapHistoryFixture(stage);
  const consensusObjects = stage === 'SETUP_RELEASE' ? structuredClone(template.consensusObjects)
    : stage === 'INITIALIZE_PROTOCOL' ? {} : { [input.protocolConfig.objectId]: structuredClone(priorObjects.protocol) };
  const versions = [...Object.values(priorObjects), ...Object.values(consensusObjects)].map(row => BigInt(row.reference.version));
  const version = String(versions.reduce((a, b) => a > b ? a : b, 0n) + 1n);
  const tx = buildNativeSoulBootstrapTransaction(stage, input);
  tx.setSender(sender); tx.setGasOwner(sender); tx.setGasPayment([]); tx.setGasBudget(1000); tx.setGasPrice(1);
  tx.setExpiration({ ValidDuring: { minEpoch: 1242, maxEpoch: 1243, minTimestamp: null,
    maxTimestamp: null, chain: L.MAINNET_V8_CHAIN_IDENTIFIER, nonce: 100 + Number(ordinal) } });
  const bytes = TransactionDataBuilder.restore(tx.getData()).build();
  const parsed = bcs.TransactionData.parse(bytes), digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const effects = structuredClone(template.effects);
  effects.V2.changedObjects.splice(effects.V2.gasObjectIndex, 1);
  Object.assign(effects.V2, { transactionDigest: digest, executedEpoch: '1242', gasObjectIndex: null,
    lamportVersion: version, unchangedConsensusObjects: Object.values(consensusObjects)
      .map(row => [row.reference.objectId, { ReadOnlyRoot: [row.reference.version, row.reference.digest] }]) });
  const changed = new Map(effects.V2.changedObjects.map(([objectId, row]) => [objectId, row]));
  const objects = {};
  for (const [kind, original] of Object.entries(contents.objects)) {
    const change = changed.get(original.objectId);
    if (!change) { objects[kind] = structuredClone(priorObjects[kind]); continue; }
    const envelope = structuredClone(original);
    if (envelope.owner.kind === 'address') envelope.owner.address = sender;
    if (envelope.owner.kind === 'shared') envelope.owner.initialSharedVersion = change.inputState.NotExist
      ? version : priorObjects[kind].owner.initialSharedVersion;
    const evidence = historicalObject(envelope, version, digest);
    // Existing objects retain their genuine public-transfer flag from the
    // preceding publication/history, rather than resetting it in each stage.
    if (priorObjects[kind]) {
      const before = bcs.Object.parse(fromBase64(priorObjects[kind].objectBcsBase64));
      rewriteHistoricalObject(evidence, p => { p.data.Move.hasPublicTransfer = before.data.Move.hasPublicTransfer; });
    }
    objects[kind] = evidence;
  }
  const before = new Map(Object.values(priorObjects).map(row => [row.reference.objectId, row]));
  const after = new Map(Object.values(objects).map(row => [row.reference.objectId, row]));
  for (const [objectId, row] of effects.V2.changedObjects) {
    if (row.inputState.Exist) {
      const previous = before.get(objectId);
      row.inputState.Exist = [[previous.reference.version, previous.reference.digest], bcsOwner(previous.owner)];
    }
    if (row.outputState.ObjectWrite) {
      const current = after.get(objectId); row.outputState.ObjectWrite = [current.reference.digest, bcsOwner(current.owner)];
    }
  }
  const balanceType = `${id(2)}::balance::Balance<${id(2)}::sui::SUI>`;
  const gasId = deriveDynamicFieldID(id(0xacc), `${id(2)}::accumulator::Key<${balanceType}>`, bcs.Address.serialize(sender).toBytes());
  effects.V2.changedObjects.push([gasId, { inputState: { NotExist: true }, outputState: { AccumulatorWriteV1: {
    address: { address: sender, ty: TypeTagSerializer.parseFromStr(balanceType, true) },
    operation: { Split: true }, value: { Integer: '3' },
  } }, idOperation: { None: true } }]);
  const eventFields = bootstrapFinalityEvents({ stage, input, sender, objects });
  effects.V2.eventsDigest = eventFields.eventsDigest;
  const effectsBytes = bcs.TransactionEffects.serialize(effects).toBytes();
  const kindBytes = bcs.TransactionKind.serialize(parsed.V1.kind).toBytes();
  const signatureBytes = Uint8Array.of(0, ...new Uint8Array(96).fill(0x55)), signature = toBase64(signatureBytes);
  const senderBytes = bcs.SenderSignedData.serialize([{ intentMessage: {
    intent: { scope: { TransactionData: true }, version: { V0: true }, appId: { Sui: true } }, value: parsed,
  }, txSignatures: [signature] }]).toBytes();
  const signedArtifact = { transactionBase64: toBase64(bytes), transactionSha256: L.sha256MainnetV8Bytes(bytes),
    transactionKindBase64: toBase64(kindBytes), transactionKindSha256: L.sha256MainnetV8Bytes(kindBytes), digest,
    signature, signatureSha256: L.sha256MainnetV8Bytes(signatureBytes), senderSignedDataBase64: toBase64(senderBytes),
    senderSignedDataSha256: L.sha256MainnetV8Bytes(senderBytes), signer: sender };
  const finalityEvidence = { schemaVersion: 'animacraft.mainnet-v8-release-runner.v1', digest,
    checkpoint: String(319550160 + Number(ordinal)), epoch: '1242', transactionBase64: signedArtifact.transactionBase64,
    transactionSha256: signedArtifact.transactionSha256, signature, signatureSha256: signedArtifact.signatureSha256,
    effectsBcsBase64: toBase64(effectsBytes), effectsSha256: L.sha256MainnetV8Bytes(effectsBytes),
    effectsDigest: L.mainnetV8TypedDigest('TransactionEffects', effectsBytes), effectsStatus: { success: true, error: null },
    ...eventFields };
  const readback = { schema: 'native-soul-bootstrap-history-v1', stage, input, objects, priorObjects, consensusObjects };
  const certificate = { finalityEvidence, finalityEvidenceSha256: L.sha256MainnetV8Json(finalityEvidence),
    readback, readbackSha256: L.sha256MainnetV8Json(readback) };
  const outcomeInput = { status: 'FINALIZED_SUCCESS', ordinal, attempt: '0', readyArtifactSha256: 'a'.repeat(64),
    signedArtifact, signedArtifactSha256: L.sha256MainnetV8Json(signedArtifact), digest,
    observation: { certificate, certificateSha256: L.sha256MainnetV8Json(certificate) } };
  const previous = [...wal.events].reverse().find(event => event.status === 'FINALIZED_SUCCESS');
  const predecessor = previous.evidence.observation.details;
  const readyFields = fixtureReadyFromOutcome(outcomeInput, predecessor, { stage, stageData });
  outcomeInput.readyArtifactSha256 = readyFields.ready.readyArtifactSha256;
  await assertMainnetV8TransactionMatchesReadyContents({ ordinal, plan: wal.plan,
    readyArtifact: readyFields.readyArtifact, unsignedEnvelope: readyFields.unsignedEnvelope });
  const outcome = L.buildMainnetV8OutcomeEvidence(outcomeInput);
  return { stage, ordinal, ...readyFields, input: outcomeInput, outcome };
}

export function appendNativeSoulBootstrapWalStage(wal, row) {
  const { input, ordinal } = row;
  wal = appendFixtureEvent(wal, { ordinal, status: 'READY', evidence: row.ready });
  wal = appendFixtureEvent(wal, { ordinal, status: 'SIGNED', evidence: L.buildMainnetV8SignedEvidence(input) });
  wal = appendFixtureEvent(wal, { ordinal, status: 'OUTCOME_PENDING', evidence: L.buildMainnetV8OutcomeEvidence({
    ...input, status: 'OUTCOME_PENDING', observation: { kind: 'QUERY_INTENT', details: {} } }) });
  wal = appendFixtureEvent(wal, { ordinal, status: 'FINALIZED_SUCCESS_PENDING_READBACK', evidence: L.buildMainnetV8OutcomeEvidence({
    ...input, status: 'FINALIZED_SUCCESS_PENDING_READBACK', observation: {
      finalityEvidence: input.observation.certificate.finalityEvidence,
      finalityEvidenceSha256: input.observation.certificate.finalityEvidenceSha256,
    } }) });
  return appendFixtureEvent(wal, { ordinal, status: 'FINALIZED_SUCCESS', evidence: row.outcome });
}

export async function nativeSoulBootstrapWalFixture() {
  const prefix = await nativeSoulPublicationWalFixture(), stages = [];
  let wal = prefix.wal;
  for (const stage of bootstrapStages) {
    const row = await nativeSoulBootstrapWalStageFixture({ wal, stage });
    wal = appendNativeSoulBootstrapWalStage(wal, row); stages.push(row);
  }
  return { ...prefix, wal, stages };
}
