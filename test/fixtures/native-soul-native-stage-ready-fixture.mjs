import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { deriveDynamicFieldID, toBase64, toBase58 } from '@mysten/sui/utils';
import {
  MAINNET_V8_CHAIN_IDENTIFIER, MAINNET_V8_RELEASE_SIGNER, MAINNET_V8_RELEASE_STEPS,
  MAINNET_V8_PROTOCOL_PROFILE,
  MAINNET_V8_DEFAULT_COMMITTEE, MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
  MAINNET_V8_DEFAULT_COMMITTEE_OWNER, MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
  nativeSoulBootstrapInputFromStageData as extract, mainnetV8TypedDigest,
  nativeSoulMarketActivationInputFromStageData,
  sha256MainnetV8Bytes as hash, sha256MainnetV8Json as jsonHash,
} from '../../scripts/mainnet-v8-release-lib.mjs';
import { buildNativeSoulBootstrapTransaction as build } from '../../scripts/native-soul-bootstrap-transactions.mjs';
import { bootstrapStages, nativeSoulBootstrapFixture } from './native-soul-bootstrap-fixture.mjs';
import { bootstrapFinalityEvents } from './native-soul-bootstrap-events-fixture.mjs';
import { bootstrapHistoryFixture, rewriteHistoricalObject, bcsOwner } from './native-soul-bootstrap-history-fixture.mjs';
import { nativeSoulMarketActivationFixture } from './native-soul-market-activation-fixture.mjs';
import { buildNativeSoulMarketActivationTransaction } from '../../scripts/native-soul-market-activation.mjs';

const digest = toBase58(new Uint8Array(32).fill(73));
const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const kindBytes = (stage, input) => TransactionDataBuilder.restore(build(stage, input).getData()).build({ onlyTransactionKind: true });

// Offline structural fixtures with actual canonical BCS and content hashes.
// Signature bytes, checkpoint/simulation metadata and READY predecessor are
// synthetic. These fixtures neither sign nor prove a complete connected WAL.
export function nativeSoulStageDataFixture(stage) {
  const input = structuredClone(nativeSoulBootstrapFixture(stage).input);
  if (stage === 'SETUP_RELEASE') input.keyServerCertificates = [{
    objectId: MAINNET_V8_DEFAULT_COMMITTEE, type: MAINNET_V8_DEFAULT_COMMITTEE_TYPE,
    owner: MAINNET_V8_DEFAULT_COMMITTEE_OWNER, contentSha256: MAINNET_V8_DEFAULT_COMMITTEE_CONTENT_SHA256,
    version: '1', digest, previousTransaction: digest,
  }];
  return input;
}

// Actual native transaction bytes, but synthetic successful simulation metadata.
// This is READY data validation, not signatures/checkpoint or runnable WAL proof.
export function nativeSoulStageReadyFixture(stage) {
  const ordinal = MAINNET_V8_RELEASE_STEPS.find(s => s.kind === stage).ordinal;
  const market = stage === 'ACTIVATE_SOULIDITY_MARKET';
  const data = market ? nativeSoulMarketActivationFixture().input : nativeSoulStageDataFixture(stage);
  const input = market ? nativeSoulMarketActivationInputFromStageData(data) : extract(stage, data);
  const kind = market ? TransactionDataBuilder.restore(buildNativeSoulMarketActivationTransaction(input).getData()).build({ onlyTransactionKind: true }) : kindBytes(stage, input);
  const sender = MAINNET_V8_RELEASE_SIGNER;
  const bytes = bcs.TransactionData.serialize({ V1: {
    kind: bcs.TransactionKind.parse(kind), sender,
    gasData: { payment: [], owner: sender, price: '1', budget: '1000' },
    expiration: { ValidDuring: { minEpoch: '999', maxEpoch: '1000', minTimestamp: null,
      maxTimestamp: null, chain: MAINNET_V8_CHAIN_IDENTIFIER, nonce: 42 } },
  } }).toBytes();
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const envelope = { transactionBase64: toBase64(bytes), transactionByteLength: String(bytes.length),
    transactionSha256: hash(bytes), transactionKindBase64: toBase64(kind), transactionKindSha256: hash(kind),
    digest: transactionDigest, sender, gasOwner: sender, gasBudget: '1000', gasPrice: '1',
    expiration: bcs.TransactionData.parse(bytes).V1.expiration };
  const gasUsed = { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' };
  const effects = bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: '999',
    gasUsed, transactionDigest, gasObjectIndex: null, eventsDigest: null, dependencies: [],
    lamportVersion: '1', changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes();
  const certificate = { fixture: 'predecessor identity is separately checked by the WAL' };
  const artifact = { kind: stage, stageData: data, stageDataSha256: jsonHash(data), publishedTomlSha256: 'a'.repeat(64),
    simulation: { digest: transactionDigest, effectsTransactionDigest: transactionDigest, effectsBcsBase64: toBase64(effects),
      gasUsed, recommendedGasBudget: '1000', changedObjects: [], objectTypes: {} },
    gasFunding: { coinType: `${id(2)}::sui::SUI`, addressBalance: '1000', coinBalance: '0', checkedAtEpoch: '999' },
    protocolProfile: { chainIdentifier: MAINNET_V8_CHAIN_IDENTIFIER, protocolVersion: MAINNET_V8_PROTOCOL_PROFILE.protocolVersion,
      epoch: '999', gasPrice: '1', attributes: { objectRuntimeMaxNumCachedObjects: '1000', objectRuntimeMaxNumStoreEntries: '1000' } },
    predecessorReadback: { ordinal: String(BigInt(ordinal) - 1n), certificate, certificateSha256: jsonHash(certificate) } };
  return { ordinal, readyArtifact: artifact, unsignedEnvelope: envelope };
}

// Rebind the independently encoded historical fixture to the release sender
// and address-balance gas. Refresh every affected Object, owned input, effects
// reference and typed digest; no RPC or cryptographic signer is used here.
export function nativeSoulStageOutcomeFixture(stage) {
  if (stage === 'ACTIVATE_SOULIDITY_MARKET') return marketOutcome();
  const f = bootstrapHistoryFixture(stage), sender = MAINNET_V8_RELEASE_SIGNER;
  for (const e of Object.values(f.priorObjects)) {
    if (e.owner.kind === 'address') {
      e.owner.address = sender; rewriteHistoricalObject(e, p => { p.owner = bcsOwner(e.owner); });
    }
  }
  f.input.protocolAdminCap = structuredClone(f.priorObjects.protocolAdmin.reference);
  if (f.input.bootstrapAdmin) f.input.bootstrapAdmin = structuredClone(f.priorObjects.bootstrapAdmin.reference);
  const tx = build(stage, f.input);
  tx.setSender(sender); tx.setGasOwner(sender); tx.setGasPayment([]); tx.setGasBudget(1000); tx.setGasPrice(1);
  tx.setExpiration({ Epoch: 50 });
  const bytes = TransactionDataBuilder.restore(tx.getData()).build();
  const parsed = bcs.TransactionData.parse(bytes), txDigest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const effects = f.effects.V2;
  effects.changedObjects.splice(effects.gasObjectIndex, 1); effects.gasObjectIndex = null;
  effects.transactionDigest = txDigest;
  for (const [kind, e] of Object.entries(f.objects)) {
    const changed = effects.changedObjects.some(([objectId]) => objectId === e.reference.objectId);
    if (!changed) { f.objects[kind] = structuredClone(f.priorObjects[kind]); continue; }
    if (e.owner.kind === 'address') e.owner.address = sender;
    e.previousTransaction = txDigest;
    rewriteHistoricalObject(e, p => { p.owner = bcsOwner(e.owner); p.previousTransaction = txDigest; });
  }
  const prior = new Map(Object.values(f.priorObjects).map(e => [e.reference.objectId, e]));
  const post = new Map(Object.values(f.objects).map(e => [e.reference.objectId, e]));
  for (const [objectId, row] of effects.changedObjects) {
    if (row.inputState.Exist) {
      const e = prior.get(objectId); row.inputState.Exist = [[e.reference.version, e.reference.digest], bcsOwner(e.owner)];
    }
    if (row.outputState.ObjectWrite) {
      const e = post.get(objectId); row.outputState.ObjectWrite = [e.reference.digest, bcsOwner(e.owner)];
    }
  }
  // Actual gas_charger address-balance debit: compute1 + storage2 - rebate0.
  // The accumulator identity is Key<Balance<SUI>>(sender) beneath 0xacc;
  // it is not an arbitrary object write or a missing gas-coin substitute.
  const balanceType = `${id(2)}::balance::Balance<${id(2)}::sui::SUI>`;
  const accumulatorId = deriveDynamicFieldID(id(0xacc), `${id(2)}::accumulator::Key<${balanceType}>`,
    bcs.Address.serialize(sender).toBytes());
  effects.changedObjects.push([accumulatorId, { inputState: { NotExist: true },
    outputState: { AccumulatorWriteV1: { address: { address: sender, ty: TypeTagSerializer.parseFromStr(balanceType, true) },
      operation: { Split: true }, value: { Integer: '3' } } }, idOperation: { None: true } }]);
  const eventFields = bootstrapFinalityEvents({ stage, input: f.input, sender, objects: f.objects });
  effects.eventsDigest = eventFields.eventsDigest;
  const effectsBytes = bcs.TransactionEffects.serialize(f.effects).toBytes();
  const kindBytes = bcs.TransactionKind.serialize(parsed.V1.kind).toBytes();
  const signatureBytes = Uint8Array.of(0, ...new Uint8Array(96).fill(0x55)), signature = toBase64(signatureBytes);
  const senderBytes = bcs.SenderSignedData.serialize([{ intentMessage: {
    intent: { scope: { TransactionData: true }, version: { V0: true }, appId: { Sui: true } }, value: parsed,
  }, txSignatures: [signature] }]).toBytes();
  const signedArtifact = { transactionBase64: toBase64(bytes), transactionSha256: hash(bytes),
    transactionKindBase64: toBase64(kindBytes), transactionKindSha256: hash(kindBytes), digest: txDigest,
    signature, signatureSha256: hash(signatureBytes), senderSignedDataBase64: toBase64(senderBytes),
    senderSignedDataSha256: hash(senderBytes), signer: sender };
  const finalityEvidence = { schemaVersion: 'animacraft.mainnet-v8-release-runner.v1', digest: txDigest,
    checkpoint: '1000', epoch: '49', transactionBase64: signedArtifact.transactionBase64,
    transactionSha256: signedArtifact.transactionSha256, signature, signatureSha256: signedArtifact.signatureSha256,
    effectsBcsBase64: toBase64(effectsBytes), effectsSha256: hash(effectsBytes),
    effectsDigest: mainnetV8TypedDigest('TransactionEffects', effectsBytes),
    effectsStatus: { success: true, error: null }, ...eventFields };
  const readback = { schema: 'native-soul-bootstrap-history-v1', stage, input: f.input,
    objects: f.objects, priorObjects: f.priorObjects, consensusObjects: f.consensusObjects };
  const certificate = { finalityEvidence, finalityEvidenceSha256: jsonHash(finalityEvidence), readback, readbackSha256: jsonHash(readback) };
  return { status: 'FINALIZED_SUCCESS', ordinal: String(8 + bootstrapStages.indexOf(stage)), attempt: '0',
    readyArtifactSha256: 'a'.repeat(64), signedArtifact, signedArtifactSha256: jsonHash(signedArtifact),
    digest: txDigest, observation: { certificate, certificateSha256: jsonHash(certificate) } };
}
function marketOutcome() {
  const f = nativeSoulMarketActivationFixture(), bytes = f.transactionBytes;
  const parsed = bcs.TransactionData.parse(bytes), kind = bcs.TransactionKind.serialize(parsed.V1.kind).toBytes();
  const eventCodec = bcs.struct('MarketActivationEvents', { data: bcs.vector(bcs.struct('Event', {
    package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
    event_type: bcs.StructTag, contents: bcs.vector(bcs.u8()),
  })) });
  // Exact two Move gate-event layouts. Structural offline fixture, not an
  // executed checkpoint or cryptographic signature verification claim.
  const eventBytes = eventCodec.serialize({ data: ['MarketPrimaryGateV2Updated', 'MarketSecondaryGateV2Updated'].map(name => ({
    package_id: f.input.packageId, transaction_module: 'market', sender: f.sender,
    event_type: { address: f.input.packageId, module: 'market', name, typeParams: [] }, contents: [1],
  })) }).toBytes();
  const eventsDigest = mainnetV8TypedDigest('TransactionEvents', eventBytes);
  f.rawEffects.V2.eventsDigest = eventsDigest; f.refresh();
  const signatureBytes = Uint8Array.of(0, ...new Uint8Array(96).fill(0x55)), signature = toBase64(signatureBytes);
  const senderBytes = bcs.SenderSignedData.serialize([{ intentMessage: {
    intent: { scope: { TransactionData: true }, version: { V0: true }, appId: { Sui: true } }, value: parsed,
  }, txSignatures: [signature] }]).toBytes();
  const signedArtifact = { transactionBase64: toBase64(bytes), transactionSha256: hash(bytes),
    transactionKindBase64: toBase64(kind), transactionKindSha256: hash(kind), digest: f.rawEffects.V2.transactionDigest,
    signature, signatureSha256: hash(signatureBytes), senderSignedDataBase64: toBase64(senderBytes),
    senderSignedDataSha256: hash(senderBytes), signer: f.sender };
  const finalityEvidence = { schemaVersion: 'animacraft.mainnet-v8-release-runner.v1', digest: signedArtifact.digest,
    checkpoint: '2000', epoch: '1000', transactionBase64: signedArtifact.transactionBase64,
    transactionSha256: signedArtifact.transactionSha256, signature, signatureSha256: signedArtifact.signatureSha256,
    effectsBcsBase64: toBase64(f.effectsBytes), effectsSha256: hash(f.effectsBytes),
    effectsDigest: mainnetV8TypedDigest('TransactionEffects', f.effectsBytes), effectsStatus: { success: true, error: null },
    eventsDigest, transactionEvents: { digest: eventsDigest, bcsBase64: toBase64(eventBytes), eventCount: '2' } };
  const certificate = { finalityEvidence, finalityEvidenceSha256: jsonHash(finalityEvidence),
    readback: f.journal, readbackSha256: jsonHash(f.journal) };
  return { status: 'FINALIZED_SUCCESS', ordinal: '12', attempt: '0', readyArtifactSha256: 'a'.repeat(64),
    signedArtifact, signedArtifactSha256: jsonHash(signedArtifact), digest: signedArtifact.digest,
    observation: { certificate, certificateSha256: jsonHash(certificate) } };
}
