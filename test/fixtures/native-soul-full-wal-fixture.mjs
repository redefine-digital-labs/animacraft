import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import * as L from '../../scripts/mainnet-v8-release-lib.mjs';
import { assertMainnetV8TransactionMatchesReadyContents } from '../../scripts/mainnet-v8-release.mjs';
import { contextFixture } from './native-soul-bootstrap-context-fixture.mjs';
import { nativeSoulBootstrapFixture } from './native-soul-bootstrap-fixture.mjs';
import { nativeSoulPublicationOutcomeFixture } from './native-soul-publication-certificate-fixture.mjs';

// Connected offline data fixture: real canonical Object/transaction/effects BCS,
// but sample modules, dummy signatures and synthetic checkpoint/simulation data.
// It does not prove compilation, cryptographic finality or a runnable release.
export function fixtureReadyFromOutcome(input, predecessor = null, native = null) {
  const signed = input.signedArtifact;
  const bytes = fromBase64(signed.transactionBase64);
  const tx = bcs.TransactionData.parse(bytes).V1;
  const unsignedEnvelope = {
    transactionBase64: signed.transactionBase64, transactionByteLength: String(bytes.length),
    transactionSha256: signed.transactionSha256, transactionKindBase64: signed.transactionKindBase64,
    transactionKindSha256: signed.transactionKindSha256, digest: signed.digest,
    sender: tx.sender, gasOwner: tx.gasData.owner, gasBudget: tx.gasData.budget,
    gasPrice: tx.gasData.price, expiration: tx.expiration,
  };
  const epoch = tx.expiration.ValidDuring.minEpoch;
  const gasUsed = { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' };
  const simulationBytes = bcs.TransactionEffects.serialize({ V2: {
    status: { Success: true }, executedEpoch: epoch, gasUsed, transactionDigest: signed.digest,
    gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '1',
    changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBytes();
  const artifact = input.observation.packageArtifact;
  const readyArtifact = {
    ...(native ? { kind: native.stage, stageData: structuredClone(native.stageData),
      stageDataSha256: L.sha256MainnetV8Json(native.stageData) } : {
    kind: 'PUBLISH', role: artifact.role, packageArtifact: structuredClone(artifact),
    packageCommitment: input.observation.packageCommitment,
    modules: artifact.modules.map(m => m.bytesBase64), dependencies: [...artifact.dependencies] }),
    publishedTomlSha256: L.sha256MainnetV8Bytes(`offline prefix/${input.ordinal}`),
    simulation: { digest: signed.digest, effectsTransactionDigest: signed.digest,
      effectsBcsBase64: toBase64(simulationBytes), gasUsed, recommendedGasBudget: tx.gasData.budget,
      changedObjects: [], objectTypes: {} },
    gasFunding: { coinType: `0x${'2'.padStart(64, '0')}::sui::SUI`,
      addressBalance: tx.gasData.budget, coinBalance: '0', checkedAtEpoch: epoch },
    protocolProfile: { chainIdentifier: L.MAINNET_V8_CHAIN_IDENTIFIER,
      protocolVersion: L.MAINNET_V8_PROTOCOL_PROFILE.protocolVersion, epoch, gasPrice: tx.gasData.price,
      attributes: { objectRuntimeMaxNumCachedObjects: '1000', objectRuntimeMaxNumStoreEntries: '1000' } },
    predecessorReadback: predecessor === null ? null : {
      ordinal: String(BigInt(input.ordinal) - 1n), certificate: structuredClone(predecessor),
      certificateSha256: L.sha256MainnetV8Json(predecessor),
    },
  };
  const ready = L.buildMainnetV8ReadyEvidence({ ordinal: input.ordinal, attempt: input.attempt,
    readyArtifact, unsignedEnvelope });
  return { ready, readyArtifact, unsignedEnvelope };
}

export function appendFixtureEvent(wal, { ordinal, status, evidence, attempt = '0' }) {
  return L.appendMainnetV8WalContents(wal, { expectedRevision: wal.revision,
    expectedHeadEventSha256: wal.headEventSha256, ordinal, attempt, status, evidence,
    recordedAt: new Date(Date.UTC(2026, 8, 9, 0, 0, Number(wal.revision))).toISOString() });
}

export async function nativeSoulPublicationWalFixture() {
  const plan = contextFixture('INITIALIZE_PROTOCOL').plan;
  const bootstrap = nativeSoulBootstrapFixture('INITIALIZE_PROTOCOL').input;
  const publications = [];
  let wal;
  for (const [index, role] of L.MAINNET_V8_PUBLISH_ORDER.entries()) {
    const { input } = await nativeSoulPublicationOutcomeFixture({ role,
      packageId: bootstrap.packageIds[role], objectIdBase: 10000 + index * 1000,
      protocolConfigId: bootstrap.protocolConfig.objectId,
      protocolAdminCapId: bootstrap.protocolAdminCap.objectId, nonce: 42 + index, currentExternalPins: true });
    const readyFields = fixtureReadyFromOutcome(input, publications.at(-1)?.input.observation ?? null);
    input.readyArtifactSha256 = readyFields.ready.readyArtifactSha256;
    await assertMainnetV8TransactionMatchesReadyContents({ ordinal: input.ordinal, plan,
      readyArtifact: readyFields.readyArtifact, unsignedEnvelope: readyFields.unsignedEnvelope });
    wal = wal ? appendFixtureEvent(wal, { ordinal: input.ordinal, status: 'READY', evidence: readyFields.ready })
      : L.buildMainnetV8InitialWalContents(plan, { evidence: readyFields.ready, recordedAt: '2026-09-09T00:00:00.000Z' });
    const signed = L.buildMainnetV8SignedEvidence(input);
    wal = appendFixtureEvent(wal, { ordinal: input.ordinal, status: 'SIGNED', evidence: signed });
    const query = L.buildMainnetV8OutcomeEvidence({ ...input, status: 'OUTCOME_PENDING',
      observation: { kind: 'QUERY_INTENT', details: {} } });
    wal = appendFixtureEvent(wal, { ordinal: input.ordinal, status: 'OUTCOME_PENDING', evidence: query });
    const pending = L.buildMainnetV8OutcomeEvidence({ ...input, status: 'FINALIZED_SUCCESS_PENDING_READBACK',
      observation: { finalityEvidence: input.observation.certificate.finalityEvidence,
        finalityEvidenceSha256: input.observation.certificate.finalityEvidenceSha256 } });
    wal = appendFixtureEvent(wal, { ordinal: input.ordinal, status: 'FINALIZED_SUCCESS_PENDING_READBACK', evidence: pending });
    const outcome = L.buildMainnetV8OutcomeEvidence(input);
    wal = appendFixtureEvent(wal, { ordinal: input.ordinal, status: 'FINALIZED_SUCCESS', evidence: outcome });
    publications.push({ role, ordinal: input.ordinal, ...readyFields, input, outcome });
  }
  const packages = publications.map(({ role, input }, i) => {
    const details = input.observation, certificate = details.certificate, readback = certificate.readback;
    return { role, packageId: readback.package.reference.objectId, packageDigest: readback.package.reference.digest,
      packageVersion: readback.package.reference.version, upgradeCapId: readback.upgradeCap.reference.objectId,
      publishDigest: input.digest, sourceCommitment: plan.packages[i].sourceCommitment,
      packageCommitment: details.packageCommitment, abiCommitment: details.abiCommitment,
      finalityEvidenceSha256: certificate.finalityEvidenceSha256, readbackSha256: certificate.readbackSha256 };
  });
  const manifest = L.buildMainnetV8FinalManifestContents({ plan, packages });
  wal = appendFixtureEvent(wal, { ordinal: '7', status: 'FINAL_MANIFEST_SEALED',
    evidence: L.buildMainnetV8ManifestEvidenceContents({ plan, finalManifest: manifest }) });
  return { plan, manifest, wal, publications };
}
