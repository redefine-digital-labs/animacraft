import test from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { ObjectError } from '@mysten/sui/client';
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils';
import { makerV8StableType, MAKER_V8_RUNTIME_SCHEMA, MAKER_V8_PAYMENT_COIN_TYPE, MAKER_V8_CLOCK_OBJECT_ID } from '../maker-v8-runtime.js';
import { assertMakerV8PlayerProtocolCurrentV8 as verify } from '../maker-v8-player-protocol.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
function fixture() {
  const runtime = { schemaVersion: MAKER_V8_RUNTIME_SCHEMA, protocolVersion: 8, enabled: true,
    catalogId: id(20), protocolConfigId: id(21), protocolTreasuryId: id(22), paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE,
    clockObjectId: MAKER_V8_CLOCK_OBJECT_ID, makerBindings: [],
    roles: Object.fromEntries(['core','seal','runtime','output','physical','market','release'].map((role,i)=>[role,{ typeOriginPackageId:id(i*2+1),callablePackageId:id(i*2+1) }])),
    roleConfigIds: Object.fromEntries(['seal','runtime','output','physical','market','release'].map((role,i)=>[role,id(30+i)])) };
  const type = (module, name) => makerV8StableType(runtime,'core',module,name);
  const p = { id: {id:id(21)}, version:'8', enabled:true, revision:'7', commitment:Array(32).fill(1),
    core_original_package_id:id(1), core_callable_package_id:id(1), treasury_id:id(22), payment_coin_type:runtime.paymentCoinType };
  const c = { id:{id:id(20)}, schema_revision:'2', protocol_config_id:id(21), protocol_config_revision:'7', protocol_config_commitment:Array(32).fill(1) };
  const objects = {
    protocolConfig:{objectId:id(21),owner:{kind:'SHARED'},type:type('protocol_config_v8','ProtocolConfigV8'),fields:p},
    catalog:{objectId:id(20),owner:{kind:'SHARED'},type:type('package_binding_v8','ProductReleaseCatalogV8'),fields:c},
  };
  const key = type('protocol_config_v8','ProductReleaseCatalogSlotKeyV2');
  const value = type('protocol_config_v8','ProductReleaseCatalogSlotV2');
  const fieldId = deriveDynamicFieldID(id(21),key,new Uint8Array([0]));
  const slot = { kind:'DynamicField',childId:null,fieldId,type:`0x2::dynamic_field::Field<${key},${value}>`,
    name:{type:key,bcsBase64:'AA=='},value:{type:value,bcsBase64:toBase64(bcs.Address.serialize(id(20)).toBytes())} };
  const client = {getDynamicField:async input=>{ assert.deepEqual(input,{parentId:id(21),name:{type:key,bcsBase64:'AA=='}}); return slot; }};
  return {runtime,objects,client,slot,fieldId};
}
test('current shared protocol and exact catalog claim allow new-write preflight', async()=>{ await verify(fixture()); });
test('canonical gRPC Base64 hashes and explicit Move treasury Options remain exact',async()=>{
  for(const treasury of [id(22),{id:id(22)},{fields:{bytes:id(22)}},[id(22)],{vec:[id(22)]},{fields:{vec:[id(22)]}}]) {
    const f=fixture(); f.objects.protocolConfig.fields.treasury_id=treasury;
    f.objects.protocolConfig.fields.commitment=toBase64(new Uint8Array(32).fill(1));
    await verify(f);
  }
  for(const commitment of [toBase64(new Uint8Array(31)),toBase64(new Uint8Array(33)),toBase64(new Uint8Array(32)).replace(/=$/,''),`${toBase64(new Uint8Array(32))}\n`,`${'A'.repeat(42)}B=`]) {
    const f=fixture();f.objects.protocolConfig.fields.commitment=commitment; await assert.rejects(verify(f));
  }
  for(const treasury of [null,[],{vec:[]},{fields:{vec:[id(22),id(22)]}},{vec:[id(22)],extra:true},{fields:{vec:[id(22)]},extra:true},{some:id(22)}]) {
    const f=fixture();f.objects.protocolConfig.fields.treasury_id=treasury; await assert.rejects(verify(f));
  }
});
test('live protocol identity, enabled state, snapshots and payment bindings fail closed', async t=>{
  const changes = {
    disabled:f=>f.objects.protocolConfig.fields.enabled=false,
    revision:f=>f.objects.protocolConfig.fields.revision='8',
    hash:f=>f.objects.catalog.fields.protocol_config_commitment=Array(32).fill(2),
    coin:f=>f.objects.protocolConfig.fields.payment_coin_type='0x2::fake::FAKE',
    treasury:f=>f.objects.protocolConfig.fields.treasury_id=id(999),
    core:f=>f.objects.protocolConfig.fields.core_callable_package_id=id(999),
    version:f=>f.objects.protocolConfig.fields.version='2',
    catalogVersion:f=>f.objects.catalog.fields.schema_revision='8',
    catalogProtocol:f=>f.objects.catalog.fields.protocol_config_id=id(999),
    objectId:f=>f.objects.catalog.objectId=id(999),
    uid:f=>f.objects.protocolConfig.fields.id={id:id(999)},
    type:f=>f.objects.protocolConfig.type=f.objects.catalog.type,
    owner:f=>f.objects.catalog.owner.kind='ADDRESS',
    claimedOther:f=>f.slot.value.bcsBase64=toBase64(bcs.Address.serialize(id(999)).toBytes()),
    slotID:f=>f.slot.fieldId=id(999),
    slotKind:f=>f.slot.kind='DynamicObject',
    emptyKeyBytes:f=>f.slot.name.bcsBase64='',
    trueKeyBytes:f=>f.slot.name.bcsBase64='AQ==',
    emptyDerivedID:f=>f.slot.fieldId=deriveDynamicFieldID(id(21),f.slot.name.type,new Uint8Array()),
    trueDerivedID:f=>f.slot.fieldId=deriveDynamicFieldID(id(21),f.slot.name.type,new Uint8Array([1])),
    valueType:f=>f.slot.value.type=f.slot.name.type,
    trailingBytes:f=>f.slot.value.bcsBase64=toBase64(new Uint8Array([...bcs.Address.serialize(id(20)).toBytes(),0])),
  };
  for(const [name,change] of Object.entries(changes)) await t.test(name,async()=>{const f=fixture();change(f);await assert.rejects(verify(f));});
});
test('only SDK notFound for the exact derived field permits an unclaimed catalog',async()=>{
  const f=fixture(); f.client.getDynamicField=async()=>{throw new ObjectError('notExists','missing',{reason:'notFound',objectId:f.fieldId});};
  await verify(f);
  for(const failure of [new Error('network'), new ObjectError('notExists','wrong',{reason:'notFound',objectId:id(999)}),new ObjectError('deleted','deleted',{reason:'deleted',objectId:f.fieldId}),new ObjectError('notExists','ambiguous',{reason:'notFound'})]){
    f.client.getDynamicField=async()=>{throw failure;};await assert.rejects(verify(f),error=>error===failure);
  }
  f.client.getDynamicField=async()=>null;await assert.rejects(verify(f));
});
