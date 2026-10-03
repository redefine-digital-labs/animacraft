import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import * as L from '../../scripts/mainnet-v8-release-lib.mjs';
import {
  buildMainnetV8ReadyTransaction, inspectMainnetV8Transaction,
  assertMainnetV8TransactionMatchesReadyContents, assertMainnetV8ReadyWalContextContents,
  nativeSoulMarketActivationContextFromWal, buildMainnetV8PairedConfig,
} from '../../scripts/mainnet-v8-release.mjs';
import { nativeSoulMarketActivationFixture } from './native-soul-market-activation-fixture.mjs';
import { rewriteHistoricalObject } from './native-soul-bootstrap-history-fixture.mjs';
import { nativeSoulBootstrapWalFixture } from './native-soul-full-wal-native-fixture.mjs';
import { appendFixtureEvent, fixtureReadyFromOutcome } from './native-soul-full-wal-fixture.mjs';

const clone = value => structuredClone(value);
const jsonHash = L.sha256MainnetV8Json;
const hash = L.sha256MainnetV8Bytes;
const detailsAt = (wal, ordinal) => wal.events.find(row => row.ordinal === String(ordinal)
  && row.status === 'FINALIZED_SUCCESS').evidence.observation.details;

// Connected offline history only. Signature bytes and checkpoint/simulation
// metadata are synthetic; neither runtime attestation nor real Move execution,
// fsync, provider availability, signing or release authorization is proved here.
function signedBytes(bytes) {
  const parsed = bcs.TransactionData.parse(bytes);
  const kind = bcs.TransactionKind.serialize(parsed.V1.kind).toBytes();
  const signatureBytes = Uint8Array.of(0, ...new Uint8Array(96).fill(0x55));
  const signature = toBase64(signatureBytes);
  const sender = bcs.SenderSignedData.serialize([{ intentMessage: { intent: {
    scope: { TransactionData: true }, version: { V0: true }, appId: { Sui: true },
  }, value: parsed }, txSignatures: [signature] }]).toBytes();
  return { transactionBase64: toBase64(bytes), transactionSha256: hash(bytes),
    transactionKindBase64: toBase64(kind), transactionKindSha256: hash(kind),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes), signature,
    signatureSha256: hash(signatureBytes), senderSignedDataBase64: toBase64(sender),
    senderSignedDataSha256: hash(sender), signer: parsed.V1.sender };
}

export async function nativeSoulCompletedWalFixture(prefix) {
  const base = prefix ?? await nativeSoulBootstrapWalFixture();
  let wal = base.wal;
  const { stageData, priorObjects } = nativeSoulMarketActivationContextFromWal(wal);
  const native = detailsAt(wal, 6).certificate;
  const market = nativeSoulMarketActivationFixture({ packageId: stageData.packageId,
    sender: wal.plan.sender, marketConfigId: stageData.marketConfig.objectId,
    marketAdminCapId: stageData.marketAdminCap.objectId,
    priorVersion: priorObjects.marketConfigV2.reference.version,
    previousTransaction: native.finalityEvidence.digest });
  // Never synthesize a replacement predecessor with merely matching IDs.
  assert.deepEqual(market.priorObjects, priorObjects);
  assert.deepEqual(market.input, stageData);
  const epoch = '1242';
  const envelope = await inspectMainnetV8Transaction(buildMainnetV8ReadyTransaction({
    ordinal: '12', readyArtifact: { kind: 'ACTIVATE_SOULIDITY_MARKET', stageData },
    transactionContext: { sender: wal.plan.sender, gasPrice: '1', gasBudget: '1000',
      epoch, chainIdentifier: wal.plan.chain.chainIdentifier, nonce: 512 },
  }));
  const signedArtifact = signedBytes(envelope.transactionBytes);
  for (const object of Object.values(market.objects)) {
    object.previousTransaction = signedArtifact.digest;
    rewriteHistoricalObject(object, raw => { raw.previousTransaction = signedArtifact.digest; });
    const effect = market.rawEffects.V2.changedObjects.find(([id]) => id === object.reference.objectId)[1];
    effect.outputState.ObjectWrite[0] = object.reference.digest;
  }
  const events = bcs.struct('FixtureMarketEvents', { data: bcs.vector(bcs.struct('Event', {
    package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
    event_type: bcs.StructTag, contents: bcs.vector(bcs.u8()),
  })) }).serialize({ data: ['MarketPrimaryGateV2Updated', 'MarketSecondaryGateV2Updated'].map(name => ({
    package_id: stageData.packageId, transaction_module: 'market', sender: wal.plan.sender,
    event_type: { address: stageData.packageId, module: 'market', name, typeParams: [] }, contents: [1],
  })) }).toBytes();
  const eventsDigest = L.mainnetV8TypedDigest('TransactionEvents', events);
  Object.assign(market.rawEffects.V2, { transactionDigest: signedArtifact.digest, executedEpoch: epoch, eventsDigest });
  market.refresh();
  const finalityEvidence = { schemaVersion: L.MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    digest: signedArtifact.digest, checkpoint: '319550171', epoch,
    transactionBase64: signedArtifact.transactionBase64, transactionSha256: signedArtifact.transactionSha256,
    signature: signedArtifact.signature, signatureSha256: signedArtifact.signatureSha256,
    effectsBcsBase64: toBase64(market.effectsBytes), effectsSha256: hash(market.effectsBytes),
    effectsDigest: L.mainnetV8TypedDigest('TransactionEffects', market.effectsBytes),
    effectsStatus: { success: true, error: null }, eventsDigest,
    transactionEvents: { digest: eventsDigest, bcsBase64: toBase64(events), eventCount: '2' } };
  const certificate = { finalityEvidence, finalityEvidenceSha256: jsonHash(finalityEvidence),
    readback: market.journal, readbackSha256: jsonHash(market.journal) };
  const input = { status: 'FINALIZED_SUCCESS', ordinal: '12', attempt: '0',
    readyArtifactSha256: 'a'.repeat(64), signedArtifact, signedArtifactSha256: jsonHash(signedArtifact),
    digest: signedArtifact.digest, observation: { certificate, certificateSha256: jsonHash(certificate) } };
  const predecessor = detailsAt(wal, 11);
  const readyFixture = fixtureReadyFromOutcome(input, predecessor, { stage: 'ACTIVATE_SOULIDITY_MARKET', stageData });
  const { readyArtifact, unsignedEnvelope } = readyFixture;
  assertMainnetV8ReadyWalContextContents({ wal, ordinal: '12', readyArtifact });
  await assertMainnetV8TransactionMatchesReadyContents({ plan: wal.plan, ordinal: '12', readyArtifact, unsignedEnvelope });
  const ready = L.buildMainnetV8ReadyEvidence({ ordinal: '12', attempt: '0', readyArtifact, unsignedEnvelope });
  input.readyArtifactSha256 = ready.readyArtifactSha256;
  wal = appendFixtureEvent(wal, { ordinal: '12', status: 'READY', evidence: ready });
  wal = appendFixtureEvent(wal, { ordinal: '12', status: 'SIGNED', evidence: L.buildMainnetV8SignedEvidence(input) });
  wal = appendFixtureEvent(wal, { ordinal: '12', status: 'OUTCOME_PENDING', evidence: L.buildMainnetV8OutcomeEvidence({
    ...input, status: 'OUTCOME_PENDING', observation: { kind: 'QUERY_INTENT', details: {} },
  }) });
  wal = appendFixtureEvent(wal, { ordinal: '12', status: 'FINALIZED_SUCCESS_PENDING_READBACK', evidence: L.buildMainnetV8OutcomeEvidence({
    ...input, status: 'FINALIZED_SUCCESS_PENDING_READBACK', observation: {
      finalityEvidence, finalityEvidenceSha256: jsonHash(finalityEvidence),
    },
  }) });
  const outcome = L.buildMainnetV8OutcomeEvidence(input);
  wal = appendFixtureEvent(wal, { ordinal: '12', status: 'FINALIZED_SUCCESS', evidence: outcome });

  const packageVerification = { kind: 'FINAL_PACKAGE_REBUILD_VERIFICATION',
    executionPlanId: wal.executionPlanId, releaseId: wal.releaseId,
    packages: wal.finalManifest.packages.map((row, ordinal) => {
      const pkg = detailsAt(wal, ordinal).certificate.readback.package;
      return { ...Object.fromEntries(['role', 'packageId', 'packageDigest', 'packageVersion', 'publishDigest',
        'sourceCommitment', 'packageCommitment', 'abiCommitment', 'readbackSha256'].map(key => [key, row[key]])),
      moduleMapSha256: pkg.moduleMapSha256, objectBcsSha256: pkg.objectBcsSha256 };
    }) };
  L.assertMainnetV8FinalPackageVerification(packageVerification);
  const config = buildMainnetV8PairedConfig({ wal, packageVerification });
  const bytes = Buffer.from(`${L.canonicalMainnetV8Json(config)}\n`);
  const bootstrap = detailsAt(wal, 11).certificate;
  const marketDetails = detailsAt(wal, 12);
  const verification = { kind: 'VERIFY_AND_EXPORT', executionPlanId: wal.executionPlanId,
    releaseId: wal.releaseId, finalManifestSha256: jsonHash(wal.finalManifest),
    packageVerification, packageVerificationSha256: jsonHash(packageVerification),
    runtimeAttestationSha256: jsonHash(bootstrap.readback),
    marketActivationCertificateSha256: marketDetails.certificate.readbackSha256 };
  const exports = { filename: 'animacraft-mainnet-v8-config.json', sha256: hash(bytes), protectedDecryptionReady: false };
  const verifyCertificate = { verification, verificationSha256: jsonHash(verification), exports, exportsSha256: jsonHash(exports) };
  const verifyStageData = { releaseId: wal.releaseId, finalManifestSha256: jsonHash(wal.finalManifest),
    bootstrapCertificateSha256: bootstrap.readbackSha256,
    marketActivationCertificateSha256: marketDetails.certificate.readbackSha256,
    exportFilename: exports.filename };
  const verifyArtifact = { kind: 'VERIFY_AND_EXPORT', stageData: verifyStageData,
    stageDataSha256: jsonHash(verifyStageData), publishedTomlSha256: readyArtifact.publishedTomlSha256,
    simulation: null, gasFunding: null, protocolProfile: clone(readyArtifact.protocolProfile),
    predecessorReadback: { ordinal: '12', certificate: marketDetails, certificateSha256: jsonHash(marketDetails) } };
  assertMainnetV8ReadyWalContextContents({ wal, ordinal: '13', readyArtifact: verifyArtifact });
  const verifyReady = L.buildMainnetV8ReadyEvidence({ ordinal: '13', attempt: '0', readyArtifact: verifyArtifact, unsignedEnvelope: null });
  wal = appendFixtureEvent(wal, { ordinal: '13', status: 'READY', evidence: verifyReady });
  const verifyOutcome = L.buildMainnetV8OutcomeEvidence({ status: 'FINALIZED_SUCCESS', ordinal: '13', attempt: '0',
    readyArtifactSha256: verifyReady.readyArtifactSha256, signedArtifact: null,
    signedArtifactSha256: null, digest: null,
    observation: { certificate: verifyCertificate, certificateSha256: jsonHash(verifyCertificate) } });
  wal = appendFixtureEvent(wal, { ordinal: '13', status: 'FINALIZED_SUCCESS', evidence: verifyOutcome });
  return { ...base, wal, market: { input, outcome, ready, readyArtifact, unsignedEnvelope },
    verify: { ready: verifyReady, outcome: verifyOutcome }, config, bytes };
}
