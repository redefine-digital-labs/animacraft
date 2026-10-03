import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, fromBase64, toBase64, fromBase58, toBase58, fromHex, toHex, normalizeStructTag } from '@mysten/sui/utils';
import { blobIdToInt, blobIdFromInt } from '@mysten/walrus';
import { sha256 } from '@noble/hashes/sha2.js';
import initWalrusWasm, { BlobEncoder } from '@mysten/walrus-wasm';
import { assertMakerV8WalrusExecutionV1, readMakerV8WalrusExecutionV1, MakerV8WalrusSystemBcs,
  MAKER_V8_WALRUS_MINIMUM_DEPENDENCY, MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID,
  MAKER_V8_WALRUS_SYSTEM_ID } from './maker-v8-walrus-execution.js';
export { MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID, MAKER_V8_WALRUS_SYSTEM_ID } from './maker-v8-walrus-execution.js';

// Original identity in the pinned a19764ff… mainnet Published.toml. Callable
// linkage remains independently attested; execution upgrades use full Object
// evidence from the same real System, never a replacement static-link claim.
const roles=['core','seal','runtime','output','physical','market','release'];
const bytes=bcs.vector(bcs.u8());
const hashes=Object.fromEntries(roles.map(r=>[`${r}_binding_commitment`,bytes]));
const replacementInput={...hashes,package_tuple_commitment:bytes,call_cap_set_commitment:bytes,
  runtime_config_id:bcs.Address,output_config_id:bcs.Address,market_config_id:bcs.Address,release_config_id:bcs.Address};
const replacementShape={id:bcs.Address,version:bcs.u64(),catalog_id:bcs.Address,...replacementInput,binding_commitment:bytes};
const certificateShape={id:bcs.Address,version:bcs.u64(),replacement_binding_id:bcs.Address,catalog_id:bcs.Address,
  package_tuple_commitment:bytes,call_cap_set_commitment:bytes,install_mask:bcs.u8(),install_mark_commitments:bcs.vector(bytes),certificate_commitment:bytes};
const policyShape={id:bcs.Address,version:bcs.u64(),catalog_id:bcs.Address,package_tuple_commitment:bytes,system_id:bcs.Address,commitment:bytes};
const storage=bcs.struct('Storage',{id:bcs.Address,start_epoch:bcs.u32(),end_epoch:bcs.u32(),storage_size:bcs.u64()});
const blobShape={id:bcs.Address,registered_epoch:bcs.u32(),blob_id:bcs.u256(),size:bcs.u64(),encoding_type:bcs.u8(),certified_epoch:bcs.option(bcs.u32()),storage,deletable:bcs.bool()};
const element=bcs.struct('Element',{bytes});
const eventBlob=bcs.struct('EventBlob',{blob_id:bcs.u256(),ending_checkpoint_sequence_number:bcs.u64()});
const inner=bcs.struct('SystemStateInnerV1',{
  committee:bcs.struct('BlsCommittee',{members:bcs.vector(bcs.struct('BlsCommitteeMember',{public_key:element,weight:bcs.u16(),node_id:bcs.Address})),n_shards:bcs.u16(),epoch:bcs.u32(),total_aggregated_key:element}),
  total_capacity_size:bcs.u64(),used_capacity_size:bcs.u64(),storage_price_per_unit_size:bcs.u64(),write_price_per_unit_size:bcs.u64(),
  future_accounting:bcs.struct('FutureAccountingRingBuffer',{current_index:bcs.u32(),length:bcs.u32(),ring_buffer:bcs.vector(bcs.struct('FutureAccounting',{epoch:bcs.u32(),used_capacity:bcs.u64(),rewards_to_distribute:bcs.struct('Balance',{value:bcs.u64()})}))}),
  event_blob_certification_state:bcs.struct('EventBlobCertificationState',{latest_certified_blob:bcs.option(eventBlob),aggregate_weight_per_blob:bcs.struct('VecMap',{contents:bcs.vector(bcs.struct('Entry',{key:eventBlob,value:bcs.u16()}))})}),
  deny_list_sizes:bcs.struct('ExtendedField',{id:bcs.Address}),
});
const key=bcs.struct('WalrusCertificationBootstrapKeyV1',{dummy_field:bcs.bool()});
const slot=bcs.struct('WalrusCertificationBootstrapSlotV1',{policy_id:bcs.Address,system_id:bcs.Address});
export const MakerV8ActivationAuthorityBcs=Object.freeze({
  replacement:bcs.struct('FreshTupleReplacementBindingV2',replacementShape),
  bootstrapCertificate:bcs.struct('FreshTupleBootstrapCertificateV2',certificateShape),
  walrusPolicy:bcs.struct('WalrusCertificationPolicyV1',policyShape),walrusSystem:MakerV8WalrusSystemBcs,livingBlob:bcs.struct('Blob',blobShape),
  walrusSystemState:bcs.struct('Field',{id:bcs.Address,name:bcs.u64(),value:inner}),
  policySlot:bcs.struct('Field',{id:bcs.Address,name:key,value:slot}),
});
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function check(v,label){if(!v){const error=new Error(`Invalid Maker activation authority: ${label}`);error.code='MAKER_V8_ACTIVATION_AUTHORITY_INVALID';throw error;}}
function exact(v,keys,label){check(v&&Object.getPrototypeOf(v)===Object.prototype&&canonical(Object.keys(v).sort())===canonical([...keys].sort()),label);}
function id(v){check(typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v),'canonical ID');return v;}
function uint(v,positive=false){check(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&BigInt(v)<2n**64n&&(!positive||BigInt(v)>0n),'canonical u64');return v;}
function digest(v){check(typeof v==='string'&&toBase58(fromBase58(v))===v&&fromBase58(v).length===32,'digest');return v;}
function hash(v){check(Array.isArray(v)&&v.length===32&&v.some(n=>n!==0)&&v.every(n=>Number.isInteger(n)&&n>=0&&n<=255),'32-byte commitment');return toHex(Uint8Array.from(v));}
function equalHash(v,expected){check(hash(v)===expected,'commitment equality');}
function commitment(fields,value,domain,revision='2'){
  return toHex(sha256(bcs.struct('Input',{domain:bcs.string(),schema_revision:bcs.u64(),...fields}).serialize({domain,schema_revision:revision,...value}).toBytes()));
}
function schemaFields(name,value){
  const codec=MakerV8ActivationAuthorityBcs[name];const encoded=codec.serialize(value).toBytes();
  check(encoded.length<=1024*1024&&canonical(codec.parse(encoded))===canonical(value),`${name} exact canonical fields`);
}
function object(value,name,type,kind){
  exact(value,name==='livingBlob'?['type','reference','fields','owner']:['type','reference','fields'],name);
  check(value.type===normalizeStructTag(type),`${name} type`);
  const ref=value.reference;
  exact(ref,kind==='shared'?['kind','objectId','initialSharedVersion']:['kind','objectId','version','digest'],`${name} reference`);
  check(ref.kind===kind,`${name} owner kind`);id(ref.objectId);
  if(kind==='shared')uint(ref.initialSharedVersion,true);else{uint(ref.version,true);digest(ref.digest);}
  schemaFields(name,value.fields);check(value.fields.id===ref.objectId,`${name} UID`);
  return value.fields;
}
/** Pure replay validation, independent of runtime WeakSets or caller booleans.
 * RPC package/type/BCS provenance is established by the reader; this validates
 * the exact frozen evidence and all executable binding relationships again. */
export async function validateMakerV8ActivationAuthorityV8(value,options){
  const v=structuredClone(value);const o=structuredClone(options);
  exact(v,['replacement','bootstrapCertificate','walrusPolicy','walrusSystem','walrusSystemState','livingBlob','walrusExecution'],'authority');
  const execution=assertMakerV8WalrusExecutionV1(v.walrusExecution,{minimumDependency:MAKER_V8_WALRUS_MINIMUM_DEPENDENCY});
  const core=id(o.roles.core.originalPackageId);const walrus=MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID;
  const r=object(v.replacement,'replacement',`${core}::package_binding_v8::FreshTupleReplacementBindingV2`,'immutable');
  const c=object(v.bootstrapCertificate,'bootstrapCertificate',`${core}::package_binding_v8::FreshTupleBootstrapCertificateV2`,'immutable');
  const p=object(v.walrusPolicy,'walrusPolicy',`${core}::core_v8::WalrusCertificationPolicyV1`,'shared');
  const s=object(v.walrusSystem,'walrusSystem',`${walrus}::system::System`,'shared');
  const state=object(v.walrusSystemState,'walrusSystemState',`0x2::dynamic_field::Field<u64,${walrus}::system_state_inner::SystemStateInnerV1>`,'owned');
  const blob=object(v.livingBlob,'livingBlob',`${walrus}::blob::Blob`,'owned');
  check(r.version==='2'&&r.catalog_id===id(o.catalogId),'replacement identity');
  equalHash(r.package_tuple_commitment,o.productBindingCommitment);equalHash(r.call_cap_set_commitment,o.callCapSetCommitment);
  for(const role of roles)equalHash(r[`${role}_binding_commitment`],o.roles[role].bindingCommitment??o.roles[role].commitment);
  for(const role of ['runtime','output','market','release'])check(r[`${role}_config_id`]===o.configIds[role],'replacement config');
  equalHash(r.binding_commitment,commitment({binding_id:bcs.Address,catalog_id:bcs.Address,...replacementInput},{...r,binding_id:r.id},'animacraft-fresh-v8/core/fresh-tuple-replacement-binding/v2'));
  check(c.version==='2'&&c.catalog_id===o.catalogId&&c.replacement_binding_id===r.id&&c.install_mask===12&&c.install_mark_commitments.length===2,'bootstrap certificate');
  equalHash(c.package_tuple_commitment,o.productBindingCommitment);equalHash(c.call_cap_set_commitment,o.callCapSetCommitment);c.install_mark_commitments.forEach(hash);
  for(const [role,callerRole,index,kind,witness] of [['output',0,0,4,'OutputRuntimeCallerCapInstallWitnessV2'],['market',1,1,8,'MarketRuntimeCallerCapInstallWitnessV2']]){
    const cap=commitment({role:bcs.u8(),catalog_id:bcs.Address,replacement_binding_id:bcs.Address,package_tuple_commitment:bytes,caller_original_package_id:bcs.Address,caller_callable_package_id:bcs.Address,call_cap_set_commitment:bytes},
      {role:callerRole,catalog_id:o.catalogId,replacement_binding_id:r.id,package_tuple_commitment:r.package_tuple_commitment,caller_original_package_id:o.roles[role].originalPackageId,caller_callable_package_id:o.roles[role].callablePackageId,call_cap_set_commitment:r.call_cap_set_commitment},'animacraft-fresh-v8/core/runtime-caller-cap/v1');
    equalHash(c.install_mark_commitments[index],commitment({replacement_binding_id:bcs.Address,role:bcs.u8(),install_kind:bcs.u8(),config_id:bcs.Address,installed_object_id:bcs.option(bcs.Address),installed_commitment:bytes,role_witness_type_name:bcs.string()},
      {replacement_binding_id:r.id,role:roles.indexOf(role),install_kind:kind,config_id:o.configIds[role],installed_object_id:null,installed_commitment:[...fromHex(cap)],role_witness_type_name:`${o.roles[role].originalPackageId.slice(2)}::${role}_v8::${witness}`},'animacraft-fresh-v8/core/fresh-tuple-bootstrap-install-mark/v2'));
  }
  equalHash(c.certificate_commitment,commitment({certificate_id:bcs.Address,replacement_binding_id:bcs.Address,catalog_id:bcs.Address,package_tuple_commitment:bytes,call_cap_set_commitment:bytes,install_mask:bcs.u8(),ordered_install_mark_commitments:bcs.vector(bytes)},
    {...c,certificate_id:c.id,ordered_install_mark_commitments:c.install_mark_commitments},'animacraft-fresh-v8/core/fresh-tuple-bootstrap-certificate/v2'));
  check(p.version==='1'&&p.catalog_id===o.catalogId&&p.system_id===MAKER_V8_WALRUS_SYSTEM_ID&&s.id===p.system_id,'Walrus policy System');
  equalHash(p.package_tuple_commitment,o.productBindingCommitment);
  equalHash(p.commitment,commitment({policy_id:bcs.Address,catalog_id:bcs.Address,package_tuple_commitment:bytes,system_id:bcs.Address},{...p,policy_id:p.id},'animacraft-fresh-v8/core/walrus-certification-policy/v1','1'));
  check(s.version===execution.systemVersion&&s.package_id===execution.packageId
    &&s.id===execution.system.objectId&&v.walrusSystem.reference.initialSharedVersion===execution.system.initialSharedVersion,'effective Walrus System');
  const provenSystem=bcs.Object.parse(fromBase64(v.walrusExecution.system.objectBcsBase64)).data.Move;
  check(canonical(MakerV8WalrusSystemBcs.parse(provenSystem.contents))===canonical(s),'full Object System fields');
  check(state.name===s.version&&state.id===deriveDynamicFieldID(s.id,'u64',bcs.u64().serialize(s.version).toBytes()),'System epoch dynamic field');
  exact(v.livingBlob.owner,['kind','address'],'Blob owner');check(v.livingBlob.owner.kind==='address'&&v.livingBlob.owner.address===id(o.signerAddress),'Blob author owner');
  check(blob.id===id(o.livingBlobObjectId)&&typeof o.livingBlobId==='string'&&blobIdFromInt(blobIdToInt(o.livingBlobId))===o.livingBlobId&&blob.blob_id===String(blobIdToInt(o.livingBlobId)),'actual living blob ID');
  check(Number.isSafeInteger(o.livingByteLength)&&o.livingByteLength>0&&blob.size===String(o.livingByteLength),'living byte size');
  check(blob.deletable===false&&blob.certified_epoch!==null&&blob.certified_epoch>=blob.registered_epoch&&blob.certified_epoch<=state.value.committee.epoch
    &&blob.storage.start_epoch<=state.value.committee.epoch&&blob.storage.end_epoch>state.value.committee.epoch
    &&blob.storage.end_epoch>blob.storage.start_epoch&&BigInt(blob.storage.storage_size)>=BigInt(blob.size),'certified non-deletable unexpired storage');
  check(o.livingBytes instanceof Uint8Array&&o.livingBytes.length===o.livingByteLength&&o.livingByteLength<=16*1024*1024,'bounded actual living bytes');
  const shards=state.value.committee.n_shards;check(shards>0&&shards<=1000,'bounded actual Walrus shards');
  await initWalrusWasm();
  const encoder=new BlobEncoder(shards);
  try{
    const [actualId,,actualLength,encoding]=encoder.compute_metadata(o.livingBytes);
    const blobId=toBase64(Uint8Array.from(actualId)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    check(blobId===o.livingBlobId&&String(actualLength)===blob.size&&encoding==='RS2'&&blob.encoding_type===1,'actual bytes Walrus encoding');
  }finally{encoder.free();}
  return freeze(v);
}

function decode(codec,encoded){const raw=fromBase64(encoded);check(raw.length<=1024*1024&&toBase64(raw)===encoded,'canonical BCS bytes');const value=codec.parse(raw);check(toBase64(codec.serialize(value).toBytes())===encoded,'canonical BCS roundtrip');return value;}
function unwrap(v){if(v&&typeof v==='object'&&!Array.isArray(v)&&v.fields)return unwrap(v.fields);return v;}
function jsonMatches(actual,expected){
  actual=unwrap(actual);
  if(expected===null){check(actual===null||Array.isArray(actual?.vec)&&actual.vec.length===0,'JSON option');return;}
  if(actual&&typeof actual==='object'&&Array.isArray(actual.vec)){check(actual.vec.length===1,'JSON some');actual=actual.vec[0];}
  if(Array.isArray(expected)){if(typeof actual==='string')actual=[...fromBase64(actual)];check(Array.isArray(actual)&&actual.length===expected.length,'JSON vector');expected.forEach((v,i)=>jsonMatches(actual[i],v));}
  else if(expected&&typeof expected==='object'){exact(actual,Object.keys(expected),'JSON fields');Object.entries(expected).forEach(([k,v])=>jsonMatches(actual[k],v));}
  else if(typeof expected==='string'&&expected.startsWith('0x')){while(actual&&typeof actual==='object')actual=actual.id??actual.bytes;check(actual===expected,'JSON ID');}
  else check(typeof expected==='boolean'?actual===expected:String(actual)===String(expected),'JSON scalar');
}
/** No wallet discovery: only exact durable Blob object id, certified tuple and
 * pinned Mainnet System. Every mutable object is reread before returning. */
export async function readMakerV8ActivationAuthorityV8(input){
  const scope={...input,transport:structuredClone(input.transport)};
  for(let attempt=0;attempt<3;attempt++){
    try{return await readOnce(scope);}catch(error){
      if(attempt===2||error?.message!=='Invalid Maker activation authority: activation readset drift')throw error;
    }
  }
}
async function readOnce({client,attested,transport,signerAddress}){
  const live=[];const runtime=attested.runtime;const core=attested.catalog.roles.core.originalPackageId;
  const get=async objectId=>{const response=await client.getObject({id:objectId,options:{showType:true,showContent:true,showOwner:true,showBcs:true}});check(response?.data&&!response.error&&response.data.objectId===objectId,'object read');return response.data;};
  const read=async(objectId,type,name,kind,ownerId)=>{
    const data=await get(objectId);check(data.objectId===objectId&&normalizeStructTag(data.type)===normalizeStructTag(type)&&data.bcs?.dataType==='moveObject'&&normalizeStructTag(data.bcs.type)===normalizeStructTag(type),'object/type evidence');
    uint(String(data.version),true);digest(data.digest);
    const fields=decode(MakerV8ActivationAuthorityBcs[name],data.bcs.bcsBytes);check(fields.id===objectId,'object UID');
    check(data.content?.dataType==='moveObject'&&normalizeStructTag(data.content.type)===normalizeStructTag(type),'parsed type');jsonMatches(data.content.fields,fields);
    const owner=data.owner;let reference;
    if(kind==='shared'){exact(owner,['Shared'],'shared owner');reference={kind,objectId,initialSharedVersion:String(owner.Shared.initial_shared_version)};uint(reference.initialSharedVersion,true);}
    else{check(kind==='immutable'?owner==='Immutable'||Object.hasOwn(owner??{},'Immutable'):owner?.[name==='livingBlob'?'AddressOwner':'ObjectOwner']===ownerId,'exact owner custody');reference={kind,objectId,version:String(data.version),digest:data.digest};}
    const value={type:normalizeStructTag(type),reference,fields,...(name==='livingBlob'?{owner:{kind:'address',address:ownerId}}:{})};
    live.push({objectId,version:String(data.version),digest:data.digest,owner:canonical(owner)});return value;
  };
  const replacement=await read(attested.replacement.objectId,attested.replacement.type,'replacement','immutable');
  const bootstrapCertificate=await read(attested.bootstrapCertificate.objectId,attested.bootstrapCertificate.type,'bootstrapCertificate','immutable');
  const keyType=`${core}::core_v8::WalrusCertificationBootstrapKeyV1`;const slotType=`${core}::core_v8::WalrusCertificationBootstrapSlotV1`;
  const keyBytes=key.serialize({dummy_field:false}).toBytes();const fieldId=deriveDynamicFieldID(attested.catalog.objectId,keyType,keyBytes);
  const field=await read(fieldId,`0x2::dynamic_field::Field<${keyType},${slotType}>`,'policySlot','owned',attested.catalog.objectId);
  check(field.fields.name.dummy_field===false&&field.fields.value.system_id===MAKER_V8_WALRUS_SYSTEM_ID,'policy slot');
  const walrusPolicy=await read(field.fields.value.policy_id,`${core}::core_v8::WalrusCertificationPolicyV1`,'walrusPolicy','shared');
  const walrusSystem=await read(MAKER_V8_WALRUS_SYSTEM_ID,`${MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID}::system::System`,'walrusSystem','shared');
  const corePackage=await get(runtime.roles.core.callablePackageId);
  check(corePackage.bcs?.dataType==='package'&&corePackage.bcs.id===corePackage.objectId&&corePackage.bcs.originalId===core&&corePackage.owner?.Immutable===true
    &&String(corePackage.version)===String(corePackage.bcs.version),'Core package evidence');uint(String(corePackage.version),true);
  const pinned=attested.packageTuple?.find(r=>r.role==='core');check(pinned&&pinned.packageDigest===corePackage.digest,'attested Core digest');
  const links=corePackage.bcs.linkageTable.filter(r=>r.originalId===MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID);check(links.length===1,'exact Walrus linkage');
  check(links[0].upgradedId===MAKER_V8_WALRUS_MINIMUM_DEPENDENCY.publishedAt
    &&links[0].upgradedVersion===MAKER_V8_WALRUS_MINIMUM_DEPENDENCY.version,'approved static Walrus minimum');
  const walrusPackage=await get(links[0].upgradedId);
  check(walrusPackage.bcs?.dataType==='package'&&walrusPackage.bcs.id===walrusPackage.objectId&&walrusPackage.bcs.originalId===MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID&&walrusPackage.owner?.Immutable===true
    &&String(walrusPackage.version)===links[0].upgradedVersion&&String(walrusPackage.bcs.version)===String(walrusPackage.version),'static linked Walrus package');
  for(const [moduleName,datatypeName]of [['blob','Blob'],['system','System'],['system_state_inner','SystemStateInnerV1']]){
    const rows=walrusPackage.bcs.typeOriginTable.filter(r=>r.moduleName===moduleName&&r.datatypeName===datatypeName);check(rows.length===1&&rows[0].packageId===MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID,'Walrus exact TypeOrigin');
  }
  const walrusExecution=await readMakerV8WalrusExecutionV1({transport:client,minimumDependency:MAKER_V8_WALRUS_MINIMUM_DEPENDENCY});
  const stateId=deriveDynamicFieldID(walrusSystem.reference.objectId,'u64',bcs.u64().serialize(walrusSystem.fields.version).toBytes());
  const walrusSystemState=await read(stateId,`0x2::dynamic_field::Field<u64,${MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID}::system_state_inner::SystemStateInnerV1>`,'walrusSystemState','owned',walrusSystem.reference.objectId);
  const livingBlob=await read(id(transport.livingContent.blobObjectId),`${MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID}::blob::Blob`,'livingBlob','owned',id(signerAddress));
  const encoded=transport.livingContent.bytesBase64;const raw=fromBase64(encoded);check(toBase64(raw)===encoded,'living bytes');
  const result=await validateMakerV8ActivationAuthorityV8({replacement,bootstrapCertificate,walrusPolicy,walrusSystem,walrusSystemState,livingBlob,walrusExecution},{
    catalogId:attested.catalog.objectId,productBindingCommitment:attested.catalog.productBindingCommitment,callCapSetCommitment:attested.catalog.callCapSetCommitment,
    roles:attested.catalog.roles,configIds:attested.catalog.configIds,livingBlobId:transport.livingContent.blobId,livingBlobObjectId:transport.livingContent.blobObjectId,livingByteLength:raw.length,livingBytes:raw,signerAddress});
  await Promise.all(live.filter(ref=>ref.objectId!==MAKER_V8_WALRUS_SYSTEM_ID).map(async ref=>{const current=await get(ref.objectId);check(String(current.version)===ref.version&&current.digest===ref.digest&&canonical(current.owner)===ref.owner,'activation readset drift');}));
  const latestExecution=await readMakerV8WalrusExecutionV1({transport:client,minimumDependency:MAKER_V8_WALRUS_MINIMUM_DEPENDENCY});
  check(canonical(assertMakerV8WalrusExecutionV1(latestExecution,{minimumDependency:MAKER_V8_WALRUS_MINIMUM_DEPENDENCY}))
    ===canonical(assertMakerV8WalrusExecutionV1(walrusExecution,{minimumDependency:MAKER_V8_WALRUS_MINIMUM_DEPENDENCY})),'activation readset drift');
  return result;
}
