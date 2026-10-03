import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, toBase64, toBase58, normalizeStructTag } from '@mysten/sui/utils';
import { blake2b } from '@noble/hashes/blake2.js';
import { NativeSoulBootstrapBcs as B } from '../../scripts/native-soul-bootstrap-readback.mjs';
import { buildNativeSoulBootstrapTransaction } from '../../scripts/native-soul-bootstrap-transactions.mjs';
import { nativeSoulBootstrapFixture, bootstrapProtocolCommitment, bootstrapId as id } from './native-soul-bootstrap-fixture.mjs';

export const objectDigest = bytes => toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...bytes]), { dkLen: 32 }));
export function bcsOwner(owner) {
  if (owner.kind === 'shared') return { Shared: { initialSharedVersion: owner.initialSharedVersion } };
  if (owner.kind === 'address') return { AddressOwner: owner.address };
  if (owner.kind === 'object') return { ObjectOwner: owner.objectId };
  return { Immutable: true };
}
export function historicalObject(envelope, version, previousTransaction) {
  const bytes = bcs.Object.serialize({ data: { Move: {
    type: { Other: TypeTagSerializer.parseFromStr(envelope.type, true).struct }, hasPublicTransfer: false,
    version, contents: fromBase64(envelope.bcsBase64),
  } }, owner: bcsOwner(envelope.owner), previousTransaction, storageRebate: '0' }).toBytes();
  return { reference: { objectId: envelope.objectId, version, digest: objectDigest(bytes) },
    type: envelope.type, owner: structuredClone(envelope.owner), previousTransaction, objectBcsBase64: toBase64(bytes) };
}
export function rewriteHistoricalObject(evidence, mutate) {
  const data = bcs.Object.parse(fromBase64(evidence.objectBcsBase64)); mutate(data);
  const bytes = bcs.Object.serialize(data).toBytes();
  evidence.objectBcsBase64 = toBase64(bytes); evidence.reference.digest = objectDigest(bytes);
  return evidence;
}
const plans = {
  INITIALIZE_PROTOCOL: { created: ['protocolTreasury'], mutated: ['protocol', 'protocolAdmin'], prior: ['protocol', 'protocolAdmin'] },
  SETUP_RELEASE: { created: ['catalog', 'sealConfig', 'runtimeConfig', 'outputConfig', 'physicalConfig', 'marketConfig', 'releaseConfig',
    'replacement', 'bootstrapSlot', 'walrusPolicy', 'walrusPolicySlot', 'nativeSoulBinding', 'protocolCatalogSlot'],
  mutated: ['protocol', 'protocolAdmin'], prior: ['protocol', 'protocolAdmin'] },
  BEGIN_BOOTSTRAP: { created: ['bootstrapAdmin'], mutated: ['protocolAdmin', 'catalog', 'bootstrapSlot'],
    prior: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot'] },
  FINALIZE_BOOTSTRAP: { created: ['bootstrapCertificate'], mutated: ['catalog', 'outputConfig', 'marketConfig', 'bootstrapSlot'],
    prior: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapSlot', 'outputConfig', 'marketConfig', 'bootstrapAdmin'] },
};

// Cryptographically self-consistent local Object/Transaction/Effects fixtures.
// They prove serialization/digest relationships, NOT checkpoint signatures or
// that the synthetic commitment fields were emitted by a real network.
export function bootstrapHistoryFixture(stage) {
  const f = nativeSoulBootstrapFixture(stage), plan = plans[stage], priorTx = toBase58(new Uint8Array(32).fill(17));
  const priorObjects = {}, objects = {}, consensusObjects = {};
  const predecessor = stage === 'BEGIN_BOOTSTRAP' ? nativeSoulBootstrapFixture('SETUP_RELEASE')
    : stage === 'FINALIZE_BOOTSTRAP' ? nativeSoulBootstrapFixture('BEGIN_BOOTSTRAP') : f;
  for (const kind of plan.prior) {
    let envelope = structuredClone(predecessor.objects[kind] ?? f.objects[kind]);
    if (stage === 'FINALIZE_BOOTSTRAP' && ['outputConfig', 'marketConfig'].includes(kind)) {
      envelope = nativeSoulBootstrapFixture('SETUP_RELEASE').objects[kind];
    }
    if (stage === 'INITIALIZE_PROTOCOL' && kind === 'protocol') {
      const fields = structuredClone(f.fields.protocol);
      Object.assign(fields, { enabled: false, revision: '0', treasury_id: null });
      fields.commitment = bootstrapProtocolCommitment(fields);
      envelope.bcsBase64 = toBase64(B.protocol.serialize(fields).toBytes());
    }
    priorObjects[kind] = historicalObject(envelope, '9', priorTx);
  }
  f.input.protocolAdminCap = structuredClone(priorObjects.protocolAdmin.reference);
  if (f.input.replacement) f.input.replacement = structuredClone(priorObjects.replacement.reference);
  if (f.input.bootstrapAdmin) f.input.bootstrapAdmin = structuredClone(priorObjects.bootstrapAdmin.reference);
  const gasEnvelope = { objectId: id(901), type: normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>'),
    owner: { kind: 'address', address: f.sender },
    bcsBase64: toBase64(bcs.struct('Coin', { id: bcs.Address, balance: bcs.U64 }).serialize({ id: id(901), balance: '100000' }).toBytes()) };
  const gasBefore = historicalObject(gasEnvelope, '9', priorTx);
  const tx = buildNativeSoulBootstrapTransaction(stage, f.input);
  tx.setSender(f.sender); tx.setGasOwner(f.sender); tx.setGasPrice(1); tx.setGasBudget(1000);
  tx.setGasPayment([gasBefore.reference]); tx.setExpiration({ Epoch: 50 });
  const transactionBytes = TransactionDataBuilder.restore(tx.getData()).build();
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  for (const [kind, original] of Object.entries(f.objects)) {
    if (![...plan.created, ...plan.mutated].includes(kind)) { objects[kind] = structuredClone(priorObjects[kind]); continue; }
    const envelope = structuredClone(original);
    if (plan.created.includes(kind) && envelope.owner.kind === 'shared') envelope.owner.initialSharedVersion = '12';
    objects[kind] = historicalObject(envelope, '12', transactionDigest);
  }
  const before = evidence => ({ Exist: [[evidence.reference.version, evidence.reference.digest], bcsOwner(evidence.owner)] });
  const output = evidence => ({ ObjectWrite: [evidence.reference.digest, bcsOwner(evidence.owner)] });
  const changedObjects = [...plan.created.map(kind => [objects[kind].reference.objectId, {
    inputState: { NotExist: true }, outputState: output(objects[kind]), idOperation: { Created: true } }]),
  ...plan.mutated.map(kind => [objects[kind].reference.objectId, { inputState: before(priorObjects[kind]),
    outputState: output(objects[kind]), idOperation: { None: true } }])];
  if (stage === 'FINALIZE_BOOTSTRAP') changedObjects.push([priorObjects.bootstrapAdmin.reference.objectId, {
    inputState: before(priorObjects.bootstrapAdmin), outputState: { NotExist: true }, idOperation: { Deleted: true } }]);
  const gasAfter = historicalObject(gasEnvelope, '12', transactionDigest), gasObjectIndex = changedObjects.length;
  changedObjects.push([gasBefore.reference.objectId, { inputState: before(gasBefore), outputState: output(gasAfter), idOperation: { None: true } }]);
  if (stage === 'SETUP_RELEASE') {
    const type = '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::system::System';
    const system = { objectId: f.input.walrusSystem.objectId, type, owner: { kind: 'shared', initialSharedVersion: f.input.walrusSystem.initialSharedVersion },
      bcsBase64: toBase64(bcs.struct('System', { id: bcs.Address, version: bcs.U64, package_id: bcs.Address, new_package_id: bcs.option(bcs.Address) }).serialize({
        id: f.input.walrusSystem.objectId, version: '3', package_id: f.input.walrusExecution.package.reference.objectId, new_package_id: null }).toBytes()) };
    const executionSystem = bcs.Object.parse(fromBase64(f.input.walrusExecution.system.objectBcsBase64));
    consensusObjects[system.objectId] = historicalObject(system, f.input.walrusExecution.system.reference.version,
      executionSystem.previousTransaction);
  } else if (stage !== 'INITIALIZE_PROTOCOL') consensusObjects[f.input.protocolConfig.objectId] = structuredClone(priorObjects.protocol);
  const effects = { V2: { status: { Success: true }, executedEpoch: '49',
    gasUsed: { computationCost: '1', storageCost: '2', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest, gasObjectIndex, eventsDigest: null, dependencies: [], lamportVersion: '12', changedObjects,
    unchangedConsensusObjects: Object.values(consensusObjects).map(e => [e.reference.objectId, { ReadOnlyRoot: [e.reference.version, e.reference.digest] }]), auxDataDigest: null } };
  const args = { stage, input: f.input, sender: f.sender, transactionBytes,
    effectsBytes: bcs.TransactionEffects.serialize(effects).toBytes(), objects, priorObjects, consensusObjects };
  return { ...args, effects, refreshEffects() { this.effectsBytes = bcs.TransactionEffects.serialize(effects).toBytes(); },
    args() { return { ...args, effectsBytes: this.effectsBytes }; } };
}
