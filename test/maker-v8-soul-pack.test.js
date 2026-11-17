import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { SoulPackPassV1Bcs, SoulPackAccessKeyV1Bcs, soulPackPassCommitmentV1,
  readSoulPackPassV1, appendSoulPackPurchaseV1, soulPackPurchaseContinuationV1 } from '../maker-v8-soul-pack.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const rootHash = Array(32).fill(7);
const releaseHash = Array(32).fill(8);

function fixture() {
  const input = { runtimeTypePackageId: id(1), releaseId: id(2), soulId: id(3), soulStateId: id(4),
    protocolConfigId: id(5), rootId: id(6), rootVersion: '2',
    rootContentCommitment: rootHash, releaseContentCommitment: releaseHash };
  const pass = { id: id(9), version: '1', protocol_config_id: input.protocolConfigId,
    soul_id: input.soulId, soul_state_id: input.soulStateId, release_id: input.releaseId,
    root_id: input.rootId, root_version: input.rootVersion, root_content_commitment: rootHash,
    release_content_commitment: releaseHash, buyer: id(10), paid_atomic: '1000',
    issued_at_ms: '700', legacy_pass_id: null, commitment: [] };
  pass.commitment = [...soulPackPassCommitmentV1(pass)];
  const keyType = `${id(1)}::runtime_v8::SoulPackAccessKeyV1`;
  const key = { soul_id: input.soulId };
  const fieldId = deriveDynamicFieldID(input.releaseId, keyType, SoulPackAccessKeyV1Bcs.serialize(key).toBytes());
  const field = { objectId: fieldId, owner: { $kind: 'ObjectOwner', ObjectOwner: input.releaseId },
    type: `0x2::dynamic_field::Field<${keyType},0x2::object::ID>`,
    content: bcs.struct('Field', { id: bcs.Address, name: SoulPackAccessKeyV1Bcs, value: bcs.Address })
      .serialize({ id: fieldId, name: key, value: pass.id }).toBytes() };
  const object = { objectId: pass.id, version: '2', digest: 'receipt',
    owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
    type: `${id(1)}::runtime_v8::SoulPackPassV1`, content: SoulPackPassV1Bcs.serialize(pass).toBytes() };
  const client = { core: {
    async getChainIdentifier() { return { chainIdentifier: '35834a8a' }; },
    async getObject({ objectId }) { return { object: objectId === fieldId ? field : object }; },
  } };
  return { input: { ...input, client }, pass, field, object, client, fieldId };
}

test('one exact Soul reads its shared Pass with the original buyer receipt', async () => {
  const f = fixture();
  const result = await readSoulPackPassV1(f.input);
  assert.equal(result.pass.id, f.pass.id);
  assert.equal(result.pass.buyer, id(10));
  assert.equal(result.pass.soul_id, f.input.soulId);
});

for (const field of ['soulId', 'soulStateId', 'protocolConfigId', 'rootId', 'rootVersion', 'releaseId']) {
  test(`a different ${field} cannot borrow the same Pass`, async () => {
    const f = fixture();
    f.input[field] = field === 'rootVersion' ? '3' : id(99);
    await assert.rejects(readSoulPackPassV1(f.input), /SOUL_PACK_V1/);
  });
}

test('the original buyer is receipt data, outside the current owner query', async () => {
  const f = fixture();
  assert.equal((await readSoulPackPassV1(f.input)).pass.id, f.pass.id);
  assert.equal(Object.hasOwn(f.input, 'wallet'), false);
});

test('an absent exact Soul field is distinguished from an RPC failure', async () => {
  const f = fixture();
  f.client.core.getObject = async () => { throw new ObjectError('NOT_FOUND', 'missing', { reason: 'notFound', objectId: f.fieldId }); };
  assert.equal(await readSoulPackPassV1(f.input), null);
  f.client.core.getObject = async () => { throw new Error('transport timeout'); };
  await assert.rejects(readSoulPackPassV1(f.input), /transport timeout/);
});

test('a wallet-owned Pass cannot substitute for the shared Soul Pass', async () => {
  const f = fixture();
  f.object.owner = { $kind: 'AddressOwner', AddressOwner: f.pass.buyer };
  await assert.rejects(readSoulPackPassV1(f.input), /custody mismatch/);
});

test('changed receipt commitment and extra BCS bytes are rejected', async () => {
  const f = fixture();
  f.object.content = SoulPackPassV1Bcs.serialize({ ...f.pass, paid_atomic: '2000' }).toBytes();
  await assert.rejects(readSoulPackPassV1(f.input), /commitment mismatch/);
  f.object.content = new Uint8Array([...SoulPackPassV1Bcs.serialize(f.pass).toBytes(), 0]);
  await assert.rejects(readSoulPackPassV1(f.input));
});

test('purchase builder binds the native adapter, reviewed price and expiry', () => {
  const tx = new Transaction();
  const quote = { network: 'mainnet', nativePackageId: id(1), stateId: id(2), equipmentId: id(3),
    releaseId: id(4), packRegistryId: id(5), packTreasuryId: id(6), rootId: id(7),
    protocolConfigId: id(8), protocolTreasuryId: id(9), priceAtomic: '1000', expiresAtMs: '10000',
    paymentCoinType: '0x2::sui::SUI' };
  appendSoulPackPurchaseV1(tx, quote, tx.object(id(10)));
  const call = tx.getData().commands[0].MoveCall;
  assert.equal(call.package, id(1));
  assert.equal(call.module, 'animacraft_pack_adapter_v1');
  assert.equal(call.function, 'purchase_soul_pack_v1');
  assert.equal(call.arguments.length, 12);
  assert.throws(() => appendSoulPackPurchaseV1(tx, { ...quote, priceAtomic: '0' }, tx.object(id(10))));
});

test('Player continues purchase with the completed exact Soul ID', () => {
  const url = new URL(soulPackPurchaseContinuationV1({ origin: 'https://www.soulidity.ai', soulId: id(3), releaseId: id(2) }));
  assert.equal(url.pathname, `/packs/${id(2)}`);
  assert.equal(url.searchParams.get('soul'), id(3));
});
