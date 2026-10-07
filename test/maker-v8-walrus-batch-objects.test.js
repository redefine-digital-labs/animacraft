import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { toBase58, toBase64, fromBase64 } from '@mysten/sui/utils';
import { blobIdFromInt } from '@mysten/walrus';
import { MakerV8WalrusBlobBcs as Blob, MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID as ORIGINAL,
  assertMakerV8WalrusBatchObjectsV1 as validate, readMakerV8WalrusBatchObjectsV1 as read } from '../maker-v8-walrus-execution.js';
import { walrusExecutionObjectFixture as proof } from './fixtures/walrus-execution-fixture.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const owner = id(1), transactionDigest = toBase58(new Uint8Array(32).fill(7));
function fixture() {
  const members = [0, 1, 2, 3].map(i => ({ uploadId: `member-${i}`, blobId: blobIdFromInt(BigInt(i + 1)),
    byteLength: 1031 + i, epochs: 3 }));
  const objects = members.map((member, i) => proof({ data: { Move: {
    type: { Other: TypeTagSerializer.parseFromStr(`${ORIGINAL}::blob::Blob`, true).struct }, version: '11',
    hasPublicTransfer: true, contents: Blob.serialize({ id: id(10 + i), registered_epoch: 43, blob_id: String(i + 1),
      size: String(member.byteLength), encoding_type: 1, certified_epoch: null,
      storage: { id: id(20 + i), start_epoch: 43, end_epoch: 46, storage_size: '66000000' }, deletable: false }).toBytes(),
  } }, owner: { AddressOwner: owner }, previousTransaction: transactionDigest, storageRebate: '0' }));
  const effects = { V2: { status: { Success: true }, executedEpoch: '1272',
    gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
    transactionDigest, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '11',
    changedObjects: objects.map(object => [object.reference.objectId, { inputState: { NotExist: true },
      outputState: { ObjectWrite: [object.reference.digest, { AddressOwner: owner }] }, idOperation: { Created: true } }]),
    unchangedConsensusObjects: [], auxDataDigest: null } };
  return { evidence: { effectsBcsBase64: bcs.TransactionEffects.serialize(effects).toBase64(), objects },
    options: { transactionDigest, owner, members }, effects };
}

test('all four historical Blob objects map by exact encoded ID, independently of effects order and Sui epoch', () => {
  const f = fixture(); f.evidence.objects.reverse();
  const mapping = validate(f.evidence, f.options);
  assert.deepEqual(mapping.map(m => m.blobObjectId), [10, 11, 12, 13].map(id));
  assert.deepEqual(mapping.map(m => m.uploadId), f.options.members.map(m => m.uploadId));
  assert.ok(Object.isFrozen(mapping));
  assert.equal(mapping[1].registrationDigest, transactionDigest);
});

for (const issue of ['missing', 'duplicate', 'member-id', 'member-size', 'epochs', 'effects-digest', 'object-digest',
  'mutation', 'previous-transaction', 'type', 'owner', 'version', 'blob-id', 'size', 'deletable',
  'certified', 'encoding', 'uid', 'start-epoch', 'end-epoch', 'trailing-object']) {
  test(`batch mapping rejects ${issue}, including rehashed objects`, () => {
    const f = fixture(); const object = bcs.Object.parse(fromBase64(f.evidence.objects[1].objectBcsBase64));
    const blob = Blob.parse(object.data.Move.contents);
    if (issue === 'missing') f.evidence.objects.pop();
    if (issue === 'duplicate') f.evidence.objects[2] = structuredClone(f.evidence.objects[1]);
    if (issue === 'member-id') f.options.members[1].blobId = f.options.members[0].blobId;
    if (issue === 'member-size') f.options.members[1].byteLength++;
    if (issue === 'epochs') f.options.members[1].epochs++;
    if (issue === 'effects-digest') f.effects.V2.transactionDigest = toBase58(new Uint8Array(32).fill(8));
    if (issue === 'mutation') f.effects.V2.changedObjects[1][1].idOperation = { None: true };
    if (issue === 'previous-transaction') object.previousTransaction = toBase58(new Uint8Array(32).fill(8));
    if (issue === 'type') object.data.Move.type.Other.address = id(99);
    if (issue === 'owner') object.owner = { AddressOwner: id(99) };
    if (issue === 'version') object.data.Move.version = '12';
    if (issue === 'blob-id') blob.blob_id = '1';
    if (issue === 'size') blob.size = '999';
    if (issue === 'deletable') blob.deletable = true;
    if (issue === 'certified') blob.certified_epoch = 43;
    if (issue === 'encoding') blob.encoding_type = 0;
    if (issue === 'uid') blob.id = id(99);
    if (issue === 'start-epoch') blob.storage.start_epoch++;
    if (issue === 'end-epoch') blob.storage.end_epoch++;
    const objectIssues = ['previous-transaction', 'type', 'owner', 'version', 'blob-id', 'size', 'deletable',
      'certified', 'encoding', 'uid', 'start-epoch', 'end-epoch'];
    if (objectIssues.includes(issue)) {
      object.data.Move.contents = Blob.serialize(blob).toBytes();
      f.evidence.objects[1] = proof(object);
      // Keep the requested effects ID fixed while changing embedded Move UID.
      f.evidence.objects[1].reference.objectId = id(11);
      f.effects.V2.changedObjects[1][1].outputState.ObjectWrite = [f.evidence.objects[1].reference.digest, object.owner];
    }
    f.evidence.effectsBcsBase64 = bcs.TransactionEffects.serialize(f.effects).toBase64();
    if (issue === 'object-digest') f.evidence.objects[1].reference.digest = f.evidence.objects[0].reference.digest;
    if (issue === 'trailing-object') f.evidence.objects[1].objectBcsBase64 = toBase64(new Uint8Array([
      ...fromBase64(f.evidence.objects[1].objectBcsBase64), 0]));
    assert.throws(() => validate(f.evidence, f.options), { code: 'MAKER_V8_WALRUS_EXECUTION_INVALID' });
  });
}

test('online collector reads exact effects versions, accepts shuffled objects, and rejects a different signed transaction', async () => {
  const f = fixture(); const bytesBase64 = toBase64(new Uint8Array([1, 2, 3]));
  const calls = [];
  const transport = { async getFinalizedTransactionEvidence({ digest }) {
    assert.equal(digest, transactionDigest);
    return { digest, effectsStatus: { success: true }, checkpoint: '331071794',
      transactionBcsBase64: bytesBase64, effectsBcsBase64: f.evidence.effectsBcsBase64 };
  }, async getHistoricalObject({ objectId, version }) {
    calls.push([objectId, version]); const entry = f.evidence.objects.find(o => o.reference.objectId === objectId);
    return { objectId, version: String(version), digest: entry.reference.digest, objectBcs: fromBase64(entry.objectBcsBase64) };
  } };
  const result = await read({ transport, ...f.options, transactionBytesBase64: bytesBase64 });
  assert.deepEqual(result.mapping, validate(f.evidence, f.options));
  assert.ok(calls.every(([, version]) => version === 11n));
  await assert.rejects(read({ transport, ...f.options, transactionBytesBase64: toBase64(new Uint8Array([9])) }),
    { code: 'MAKER_V8_WALRUS_EXECUTION_INVALID' });
  assert.equal(calls.length, 4, 'A mismatched transaction is rejected before object reads.');
});
