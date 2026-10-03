import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { deriveDynamicFieldID, fromBase64, toBase58 } from '@mysten/sui/utils';
import { NativeSoulPublicationBcs, verifyNativeSoulPublicationOutputs } from '../../scripts/native-soul-publication-outputs.mjs';
import { buildNativeSoulMarketActivationTransaction, deriveNativeSoulMarketActivationInput } from '../../scripts/native-soul-market-activation.mjs';
import { nativeSoulPublicationFixture } from './native-soul-publication-fixture.mjs';
import { rewriteHistoricalObject } from './native-soul-bootstrap-history-fixture.mjs';
import { MAINNET_V8_CHAIN_IDENTIFIER, MAINNET_V8_RELEASE_SIGNER } from '../../scripts/mainnet-v8-release-lib.mjs';

// Actual canonical Object/Transaction/Effects BCS over the existing publication
// fixture. No signature, RPC result, Move execution or finality is fabricated.
export function nativeSoulMarketActivationFixture({ net = 3n, packageId, sender = MAINNET_V8_RELEASE_SIGNER,
  marketConfigId, marketAdminCapId, priorVersion = '7', previousTransaction } = {}) {
  const publication = nativeSoulPublicationFixture({ signer: sender });
  const verified = verifyNativeSoulPublicationOutputs(publication.args);
  packageId ??= publication.args.packageId;
  marketConfigId ??= verified.objects.marketConfigV2.reference.objectId;
  marketAdminCapId ??= verified.objects.marketAdminCapV2.reference.objectId;
  const priorObjects = Object.fromEntries(['marketConfigV2', 'marketAdminCapV2'].map(key => {
    const row = verified.objects[key];
    return [key, { reference: structuredClone(row.reference), type: row.type,
      owner: row.owner.Shared ? { kind: 'shared', initialSharedVersion: row.owner.Shared.initial_shared_version }
        : { kind: 'address', address: row.owner.AddressOwner },
      previousTransaction: row.previousTransaction, objectBcsBase64: row.objectBcsBase64 }];
  }));
  for (const [key, row] of Object.entries(priorObjects)) {
    row.type = `${packageId}::market::${NativeSoulPublicationBcs[key].name}`;
    row.reference.objectId = key === 'marketConfigV2' ? marketConfigId : marketAdminCapId;
    row.reference.version = priorVersion;
    row.previousTransaction = previousTransaction ?? row.previousTransaction;
    if (key === 'marketConfigV2') row.owner.initialSharedVersion = priorVersion;
    rewriteHistoricalObject(row, object => {
      object.data.Move.type = { Other: TypeTagSerializer.parseFromStr(row.type, true).struct };
      object.data.Move.version = priorVersion;
      object.previousTransaction = row.previousTransaction;
      if (key === 'marketConfigV2') object.owner = { Shared: { initialSharedVersion: priorVersion } };
      const fields = NativeSoulPublicationBcs[key].parse(new Uint8Array(object.data.Move.contents));
      fields.id = row.reference.objectId;
      if (key === 'marketAdminCapV2') fields.config_id = marketConfigId;
      object.data.Move.contents = [...NativeSoulPublicationBcs[key].serialize(fields).toBytes()];
    });
  }
  const input = deriveNativeSoulMarketActivationInput({ packageId, sender, priorObjects });
  const tx = buildNativeSoulMarketActivationTransaction(input);
  const kind = TransactionDataBuilder.restore(tx.getData()).build({ onlyTransactionKind: true });
  const transactionBytes = bcs.TransactionData.serialize({ V1: { kind: bcs.TransactionKind.parse(kind), sender,
    gasData: { owner: sender, payment: [], price: '1000', budget: '50000000' }, expiration: { ValidDuring: {
      minEpoch: '999', maxEpoch: '1000', minTimestamp: null, maxTimestamp: null, chain: MAINNET_V8_CHAIN_IDENTIFIER, nonce: 42,
    } } } }).toBytes();
  const transactionDigest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  const objects = structuredClone(priorObjects), changedObjects = [], outputVersion = String(BigInt(priorVersion) + 5n);
  for (const [key, row] of Object.entries(objects)) {
    rewriteHistoricalObject(row, object => {
      object.data.Move.version = outputVersion; object.previousTransaction = transactionDigest;
      if (key === 'marketConfigV2') {
        const fields = NativeSoulPublicationBcs.marketConfigV2.parse(new Uint8Array(object.data.Move.contents));
        fields.primary_enabled = true; fields.secondary_enabled = true;
        object.data.Move.contents = [...NativeSoulPublicationBcs.marketConfigV2.serialize(fields).toBytes()];
      }
    });
    row.reference.version = outputVersion; row.previousTransaction = transactionDigest;
    const owner = bcs.Object.parse(fromBase64(row.objectBcsBase64)).owner;
    changedObjects.push([row.reference.objectId, { inputState: { Exist: [[priorObjects[key].reference.version, priorObjects[key].reference.digest], owner] },
      outputState: { ObjectWrite: [row.reference.digest, owner] }, idOperation: { None: true } }]);
  }
  if (net !== 0n) changedObjects.push([
    deriveDynamicFieldID('0xacc', '0x2::accumulator::Key<0x2::balance::Balance<0x2::sui::SUI>>', bcs.Address.serialize(sender).toBytes()), {
      inputState: { NotExist: true }, idOperation: { None: true }, outputState: { AccumulatorWriteV1: {
        address: { address: sender, ty: '0x2::balance::Balance<0x2::sui::SUI>' },
        operation: net > 0n ? { Split: true } : { Merge: true }, value: { Integer: String(net < 0n ? -net : net) },
      } },
    },
  ]);
  const rawEffects = { V2: { status: { Success: true }, executedEpoch: '1000',
    gasUsed: { computationCost: net > 0n ? String(net) : '0', storageCost: '0', storageRebate: net < 0n ? String(-net) : '0', nonRefundableStorageFee: '11' },
    transactionDigest, gasObjectIndex: null, eventsDigest: toBase58(new Uint8Array(32).fill(33)), dependencies: [], lamportVersion: outputVersion,
    changedObjects, unchangedConsensusObjects: [], auxDataDigest: null } };
  return { input: structuredClone(input), sender, priorObjects, objects, transactionBytes, rawEffects,
    journal: { schema: 'native-soul-market-activation-history-v1', stage: 'ACTIVATE_SOULIDITY_MARKET', input: structuredClone(input), priorObjects, objects },
    effectsBytes: bcs.TransactionEffects.serialize(rawEffects).toBytes(),
    refresh() { this.effectsBytes = bcs.TransactionEffects.serialize(this.rawEffects).toBytes(); },
    args() { return { input: this.input, sender: this.sender, priorObjects: this.priorObjects, objects: this.objects,
      transactionBytes: this.transactionBytes, effectsBytes: this.effectsBytes }; } };
}
export const marketActivationFixture = nativeSoulMarketActivationFixture;
