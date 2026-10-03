import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { toBase64,fromBase64,deriveDynamicFieldID,normalizeStructTag } from '@mysten/sui/utils';
import { WALRUS_MINIMUM_DEPENDENCY_FIXTURE, makerV8WalrusExecutionFixture } from './fixtures/walrus-execution-fixture.js';
import { makerV8ActivationAuthorityFixture,makerV8LivingBlobIdFixture } from './fixtures/maker-v8-activation-authority-fixture.js';
import { MakerV8ActivationAuthorityBcs as B,MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID as W,validateMakerV8ActivationAuthorityV8 as validate,readMakerV8ActivationAuthorityV8 as read } from '../maker-v8-activation-authority.js';
import { assertMakerV8CompilerContextFreshV8 } from '../maker-v8-browser.js';
const id=n=>`0x${n.toString(16).padStart(64,'0')}`;
async function fixture(){
  const names=['core','seal','runtime','output','physical','market','release'];const livingBytes=new Uint8Array([1,2,3]);
  const roles=Object.fromEntries(names.map((r,i)=>[r,{originalPackageId:id(10+i),callablePackageId:id(20+i),bindingCommitment:'12'.repeat(32)}]));
  const options={catalogId:id(1),productBindingCommitment:'34'.repeat(32),callCapSetCommitment:'56'.repeat(32),roles,configIds:Object.fromEntries(names.slice(1).map((r,i)=>[r,id(40+i)])),
    signerAddress:id(2),livingBlobObjectId:id(3),livingBytes,livingByteLength:3,livingBlobId:await makerV8LivingBlobIdFixture(livingBytes)};
  const authority=await makerV8ActivationAuthorityFixture(options);const objects=new Map();
  for(const [name,value]of Object.entries(authority)){
    if(name==='walrusExecution')continue;
    const r=value.reference;const owner=r.kind==='shared'?{Shared:{initial_shared_version:r.initialSharedVersion}}:r.kind==='immutable'?{Immutable:true}:name==='livingBlob'?{AddressOwner:options.signerAddress}:{ObjectOwner:authority.walrusSystem.fields.id};
    objects.set(r.objectId,{objectId:r.objectId,version:r.version??'2',digest:authority.replacement.reference.digest,owner,type:value.type,
      bcs:{dataType:'moveObject',type:value.type,bcsBytes:toBase64(B[name].serialize(value.fields).toBytes())},content:{dataType:'moveObject',type:value.type,fields:structuredClone(value.fields)}});
  }
  Object.assign(objects.get(authority.walrusSystem.reference.objectId),authority.walrusExecution.system.reference);
  const kt=`${roles.core.originalPackageId}::core_v8::WalrusCertificationBootstrapKeyV1`;const vt=`${roles.core.originalPackageId}::core_v8::WalrusCertificationBootstrapSlotV1`;
  const fid=deriveDynamicFieldID(options.catalogId,kt,new Uint8Array([0]));const type=normalizeStructTag(`0x2::dynamic_field::Field<${kt},${vt}>`);
  const fields={id:fid,name:{dummy_field:false},value:{policy_id:authority.walrusPolicy.fields.id,system_id:authority.walrusSystem.fields.id}};
  objects.set(fid,{objectId:fid,version:'2',digest:authority.replacement.reference.digest,owner:{ObjectOwner:options.catalogId},type,
    bcs:{dataType:'moveObject',type,bcsBytes:toBase64(B.policySlot.serialize(fields).toBytes())},content:{dataType:'moveObject',type,fields}});
  const pkg=(objectId,originalId)=>({objectId,version:'2',digest:authority.replacement.reference.digest,owner:{Immutable:true},bcs:{dataType:'package',id:objectId,version:'2',originalId,linkageTable:[],typeOriginTable:[]}});
  const corePackage=pkg(roles.core.callablePackageId,roles.core.originalPackageId);corePackage.bcs.linkageTable=[{originalId:W,upgradedId:WALRUS_MINIMUM_DEPENDENCY_FIXTURE.publishedAt,upgradedVersion:'2'}];
  const walrusPackage=pkg(WALRUS_MINIMUM_DEPENDENCY_FIXTURE.publishedAt,W);walrusPackage.bcs.typeOriginTable=[['blob','Blob'],['system','System'],['system_state_inner','SystemStateInnerV1']].map(([moduleName,datatypeName])=>({moduleName,datatypeName,packageId:W}));
  objects.set(corePackage.objectId,corePackage);objects.set(walrusPackage.objectId,walrusPackage);
  const attested={runtime:{roles:{core:{callablePackageId:roles.core.callablePackageId}}},catalog:{objectId:options.catalogId,productBindingCommitment:options.productBindingCommitment,callCapSetCommitment:options.callCapSetCommitment,roles,configIds:options.configIds},
    replacement:{objectId:authority.replacement.fields.id,type:authority.replacement.type},bootstrapCertificate:{objectId:authority.bootstrapCertificate.fields.id,type:authority.bootstrapCertificate.type},packageTuple:[{role:'core',packageDigest:corePackage.digest}]};
  const calls=[];const client={async getObject({id}){calls.push(id);return{data:structuredClone(objects.get(id))}},
    async getHistoricalObject({objectId,version}){
      const row=objectId===authority.walrusExecution.system.reference.objectId?authority.walrusExecution.system:authority.walrusExecution.package;
      assert.equal(String(version),row.reference.version);assert.equal(objectId,row.reference.objectId);
      const bytes=fromBase64(row.objectBcsBase64),parsed=bcs.Object.parse(bytes);
      return{...row.reference,objectBcs:bytes,contentBcs:parsed.data.Move?.contents??null};
    }};
  const input={client,attested,transport:{livingContent:{blobId:options.livingBlobId,blobObjectId:options.livingBlobObjectId,bytesBase64:toBase64(livingBytes)}},signerAddress:options.signerAddress};
  return{authority,options,objects,client,calls,input,fid,corePackage,walrusPackage};
}
test('pure replay verifies actual offline Walrus encoding and deep freezes an independent result',async()=>{
  const f=await fixture();const result=await validate(f.authority,f.options);assert.deepEqual(result,f.authority);assert(Object.isFrozen(result.livingBlob.fields.storage));f.authority.livingBlob.fields.size='4';assert.equal(result.livingBlob.fields.size,'3');
});
test('reads exact typed objects and dummy-false slot, with a final reference readset and no wallet discovery',async()=>{
  const f=await fixture();assert.deepEqual(await read(f.input),f.authority);assert.equal(f.calls.filter(id=>id===f.fid).length,2);assert.equal(f.calls.filter(id=>id===f.options.livingBlobObjectId).length,2);
});
test('freshness allows a genuinely advancing System while checking current Blob lifetime and preserving old evidence',async()=>{
  const f=await fixture();const context={schemaVersion:'fixture',chainIdentifier:'mainnet',paymentCoinType:'fixture',protocolProfile:{},coreArtifact:{},activationAuthority:f.authority,signerAddress:f.options.signerAddress,
    catalog:{type:'catalog',reference:{objectId:f.options.catalogId},fields:{roles:f.options.roles}},
    configs:Object.fromEntries(Object.entries(f.options.configIds).map(([r,objectId])=>[r,{type:r,reference:{objectId},fields:{}}])),
    ...Object.fromEntries(['clock','protocolConfig','protocolTreasury'].map(name=>[name,{type:name,reference:{objectId:id(500)},fields:{}}])),transport:f.input.transport,
    _derived:{productBindingCommitment:f.options.productBindingCommitment,callCapSetCommitment:f.options.callCapSetCommitment,sealPolicyCommitment:'seal',protocolProfileCommitment:'profile',coreArtifactCommitment:'artifact'}};
  const latest=structuredClone(context);latest.activationAuthority.walrusSystemState.reference.version='3';latest.activationAuthority.walrusSystemState.fields.value.committee.epoch=6;
  latest.activationAuthority.walrusExecution=makerV8WalrusExecutionFixture({systemObjectVersion:'3'});
  await assertMakerV8CompilerContextFreshV8(context,latest);assert.equal(context.activationAuthority.walrusSystemState.fields.value.committee.epoch,5);
  const switched=structuredClone(latest);switched.activationAuthority.walrusExecution=makerV8WalrusExecutionFixture({systemObjectVersion:'3',packageId:id(998)});
  switched.activationAuthority.walrusSystem.fields.package_id=id(998);
  await assert.rejects(assertMakerV8CompilerContextFreshV8(context,switched),{code:'MAKER_V8_COMPILER_CONTEXT_DRIFT'});
  latest.activationAuthority.walrusSystemState.fields.value.committee.epoch=10;
  await assert.rejects(assertMakerV8CompilerContextFreshV8(context,latest));
});
test('a transient readset drift is retried from scratch with a bounded exact target',async()=>{
  const f=await fixture();const prior=f.client.getObject;let seen=0;f.client.getObject=async q=>{const r=await prior(q);if(q.id===f.options.livingBlobObjectId&&++seen===2)r.data.version='3';return r;};
  assert.deepEqual(await read(f.input),f.authority);assert.equal(seen,4);
});
test('pure validation snapshots fields and bytes before its first async boundary',async()=>{
  const f=await fixture();const pending=validate(f.authority,f.options);f.options.livingBytes.fill(0);f.authority.livingBlob.fields.deletable=true;
  assert.equal((await pending).livingBlob.fields.deletable,false);
});
for(const issue of ['tuple','capset','replacement','certificate','mask','mark-order','policy-hash','policy-system','system-key','system-version','missing-execution','execution-package','blob-id','blob-ref','owner','object-owner','deletable','uncertified','expired','future-certified','size','same-length-wrong-bytes','extra','extra-fields','wrong-reference','type'])test(`pure replay rejects ${issue}`,async()=>{
  const f=await fixture();const a=f.authority;
  if(issue==='tuple')f.options.productBindingCommitment='78'.repeat(32);
  if(issue==='capset')f.options.callCapSetCommitment='78'.repeat(32);
  if(issue==='replacement')a.replacement.fields.binding_commitment[0]^=1;
  if(issue==='certificate')a.bootstrapCertificate.fields.certificate_commitment[0]^=1;
  if(issue==='mask')a.bootstrapCertificate.fields.install_mask=15;
  if(issue==='mark-order')a.bootstrapCertificate.fields.install_mark_commitments.reverse();
  if(issue==='policy-hash')a.walrusPolicy.fields.commitment[0]^=1;
  if(issue==='policy-system')a.walrusPolicy.fields.system_id=id(999);
  if(issue==='system-key')a.walrusSystemState.fields.name='1';
  if(issue==='system-version')a.walrusSystem.fields.version='1';
  if(issue==='missing-execution')delete a.walrusExecution;
  if(issue==='execution-package')a.walrusExecution.package.reference.objectId=id(999);
  if(issue==='blob-id')f.options.livingBlobId=await makerV8LivingBlobIdFixture([4,5,6]);
  if(issue==='blob-ref')f.options.livingBlobObjectId=id(999);
  if(issue==='owner')f.options.signerAddress=id(999);
  if(issue==='object-owner')a.livingBlob.owner.kind='object';
  if(issue==='deletable')a.livingBlob.fields.deletable=true;
  if(issue==='uncertified')a.livingBlob.fields.certified_epoch=null;
  if(issue==='expired')a.livingBlob.fields.storage.end_epoch=5;
  if(issue==='future-certified')a.livingBlob.fields.certified_epoch=6;
  if(issue==='size')a.livingBlob.fields.size='4';
  if(issue==='same-length-wrong-bytes')f.options.livingBytes=new Uint8Array([4,5,6]);
  if(issue==='extra')a.approval=true;
  if(issue==='extra-fields')a.walrusSystem.fields.epoch=5;
  if(issue==='wrong-reference')a.livingBlob.reference.kind='immutable';
  if(issue==='type')a.livingBlob.type=`${id(999)}::blob::Blob`;
  await assert.rejects(validate(a,f.options));
});
for(const issue of ['uid','bcs','json','type','object-owner','wrong-wallet','slot-key','slot-parent','system-parent','core-digest','walrus-link','walrus-origin','package-version','readset','missing'])test(`exact read rejects ${issue}`,async()=>{
  const f=await fixture();const blob=f.objects.get(f.options.livingBlobObjectId);const slot=f.objects.get(f.fid);
  if(issue==='uid')blob.objectId=id(999);
  if(issue==='bcs')blob.bcs.bcsBytes=toBase64(new Uint8Array([...Buffer.from(blob.bcs.bcsBytes,'base64'),0]));
  if(issue==='json')blob.content.fields.size='4';
  if(issue==='type')blob.type=`${id(999)}::blob::Blob`;
  if(issue==='object-owner')blob.owner={ObjectOwner:f.options.signerAddress};
  if(issue==='wrong-wallet')blob.owner={AddressOwner:id(999)};
  if(issue==='slot-key'){slot.content.fields.name.dummy_field=true;slot.bcs.bcsBytes=toBase64(B.policySlot.serialize(slot.content.fields).toBytes());}
  if(issue==='slot-parent')slot.owner={ObjectOwner:id(999)};
  if(issue==='system-parent')f.objects.get(f.authority.walrusSystemState.fields.id).owner={ObjectOwner:id(999)};
  if(issue==='core-digest')f.corePackage.digest='bad';
  if(issue==='walrus-link')f.corePackage.bcs.linkageTable=[];
  if(issue==='walrus-origin')f.walrusPackage.bcs.typeOriginTable[0].packageId=id(999);
  if(issue==='package-version')f.walrusPackage.version='3';
  if(issue==='missing')f.objects.delete(f.options.livingBlobObjectId);
  if(issue==='readset'){const prior=f.client.getObject;let seen=0;f.client.getObject=async q=>{const r=await prior(q);if(q.id===f.options.livingBlobObjectId&&++seen%2===0)r.data.version='3';return r;};}
  await assert.rejects(read(f.input));
});
