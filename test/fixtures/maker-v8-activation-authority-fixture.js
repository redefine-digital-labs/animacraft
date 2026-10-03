import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';
import { toBase58,fromHex,deriveDynamicFieldID,normalizeStructTag,normalizeSuiAddress } from '@mysten/sui/utils';
import { WalrusClient,blobIdToInt } from '@mysten/walrus';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { MAKER_V8_WALRUS_ORIGINAL_PACKAGE_ID as W,MAKER_V8_WALRUS_SYSTEM_ID as SYSTEM } from '../../maker-v8-activation-authority.js';
import { makerV8WalrusExecutionFixture, WALRUS_V3_PACKAGE_FIXTURE } from './walrus-execution-fixture.js';
const id=n=>`0x${n.toString(16).padStart(64,'0')}`;
const V=bcs.vector(bcs.u8());const names=['core','seal','runtime','output','physical','market','release'];
const hash=(shape,value,domain,revision=2)=>[...sha256(bcs.struct('Input',{domain:bcs.string(),schema_revision:bcs.u64(),...shape}).serialize({domain,schema_revision:revision,...value}).toBytes())];
const hex=v=>[...fromHex(v)];
const metadataCache=new Map();
export async function makerV8LivingBlobIdFixture(livingBytes){
  // Actual installed Walrus WASM metadata computation; explicit shard count
  // makes this completely offline (no wallet, object reads or RPC transport).
  const key=Buffer.from(livingBytes).toString('base64');
  if(!metadataCache.has(key)){
    const client=new WalrusClient({network:'mainnet',suiClient:new SuiGrpcClient({network:'mainnet',baseUrl:'https://offline-fixture.invalid'})});
    metadataCache.set(key,client.computeBlobMetadata({bytes:Uint8Array.from(livingBytes),numShards:1000,nonce:new Uint8Array(32)}).then(value=>value.blobId));
  }
  return metadataCache.get(key);
}
export async function makerV8ActivationAuthorityFixture(o){
  const {roles,configIds,signerAddress,livingBlobObjectId}=o;
  const livingBytes=Uint8Array.from(o.livingBytes);
  const livingBlobId=o.livingBlobId??await makerV8LivingBlobIdFixture(livingBytes);
  const core=roles.core.originalPackageId;
  const replacementInput={...Object.fromEntries(names.map(r=>[`${r}_binding_commitment`,V])),package_tuple_commitment:V,call_cap_set_commitment:V,
    runtime_config_id:bcs.Address,output_config_id:bcs.Address,market_config_id:bcs.Address,release_config_id:bcs.Address};
  const r={id:id(9101),version:'2',catalog_id:o.catalogId,...Object.fromEntries(names.map(r=>[`${r}_binding_commitment`,hex(roles[r].bindingCommitment??roles[r].commitment)])),
    package_tuple_commitment:hex(o.productBindingCommitment),call_cap_set_commitment:hex(o.callCapSetCommitment),...Object.fromEntries(['runtime','output','market','release'].map(r=>[`${r}_config_id`,configIds[r]]))};
  r.binding_commitment=hash({binding_id:bcs.Address,catalog_id:bcs.Address,...replacementInput},{...r,binding_id:r.id},'animacraft-fresh-v8/core/fresh-tuple-replacement-binding/v2');
  const c={id:id(9102),version:'2',replacement_binding_id:r.id,catalog_id:o.catalogId,package_tuple_commitment:r.package_tuple_commitment,call_cap_set_commitment:r.call_cap_set_commitment,install_mask:12,install_mark_commitments:[Array(32).fill(13),Array(32).fill(14)]};
  for(const [role,callerRole,index,kind,witness]of [['output',0,0,4,'OutputRuntimeCallerCapInstallWitnessV2'],['market',1,1,8,'MarketRuntimeCallerCapInstallWitnessV2']]){
    const cap=hash({role:bcs.u8(),catalog_id:bcs.Address,replacement_binding_id:bcs.Address,package_tuple_commitment:V,caller_original_package_id:bcs.Address,caller_callable_package_id:bcs.Address,call_cap_set_commitment:V},
      {role:callerRole,catalog_id:o.catalogId,replacement_binding_id:r.id,package_tuple_commitment:r.package_tuple_commitment,caller_original_package_id:roles[role].originalPackageId,caller_callable_package_id:roles[role].callablePackageId,call_cap_set_commitment:r.call_cap_set_commitment},'animacraft-fresh-v8/core/runtime-caller-cap/v1');
    c.install_mark_commitments[index]=hash({replacement_binding_id:bcs.Address,role:bcs.u8(),install_kind:bcs.u8(),config_id:bcs.Address,installed_object_id:bcs.option(bcs.Address),installed_commitment:V,role_witness_type_name:bcs.string()},
      {replacement_binding_id:r.id,role:names.indexOf(role),install_kind:kind,config_id:configIds[role],installed_object_id:null,installed_commitment:cap,role_witness_type_name:`${roles[role].originalPackageId.slice(2)}::${role}_v8::${witness}`},'animacraft-fresh-v8/core/fresh-tuple-bootstrap-install-mark/v2');
  }
  c.certificate_commitment=hash({certificate_id:bcs.Address,replacement_binding_id:bcs.Address,catalog_id:bcs.Address,package_tuple_commitment:V,call_cap_set_commitment:V,install_mask:bcs.u8(),ordered_install_mark_commitments:bcs.vector(V)},
    {...c,certificate_id:c.id,ordered_install_mark_commitments:c.install_mark_commitments},'animacraft-fresh-v8/core/fresh-tuple-bootstrap-certificate/v2');
  const p={id:id(9103),version:'1',catalog_id:o.catalogId,package_tuple_commitment:r.package_tuple_commitment,system_id:SYSTEM};
  p.commitment=hash({policy_id:bcs.Address,catalog_id:bcs.Address,package_tuple_commitment:V,system_id:bcs.Address},{...p,policy_id:p.id},'animacraft-fresh-v8/core/walrus-certification-policy/v1',1);
  const obj=(type,fields,kind)=>({type:normalizeStructTag(type),reference:kind==='shared'?{kind,objectId:fields.id,initialSharedVersion:'1'}:{kind,objectId:fields.id,version:'2',digest:toBase58(new Uint8Array(32).fill(9))},fields});
  const system={id:SYSTEM,version:'3',package_id:WALRUS_V3_PACKAGE_FIXTURE,new_package_id:null};
  const walrusExecution=makerV8WalrusExecutionFixture();
  const state={id:deriveDynamicFieldID(SYSTEM,'u64',bcs.u64().serialize('3').toBytes()),name:'3',value:{
    committee:{members:[],n_shards:1000,epoch:5,total_aggregated_key:{bytes:Array(48).fill(0)}},total_capacity_size:'1000000000',used_capacity_size:'0',storage_price_per_unit_size:'1',write_price_per_unit_size:'1',
    future_accounting:{current_index:0,length:0,ring_buffer:[]},event_blob_certification_state:{latest_certified_blob:null,aggregate_weight_per_blob:{contents:[]}},deny_list_sizes:{id:id(9104)}}};
  const blob={id:livingBlobObjectId,registered_epoch:3,blob_id:String(blobIdToInt(livingBlobId)),size:String(livingBytes.length),encoding_type:1,certified_epoch:4,
    storage:{id:id(9105),start_epoch:3,end_epoch:10,storage_size:String(livingBytes.length)},deletable:false};
  return JSON.parse(JSON.stringify({walrusExecution,replacement:obj(`${core}::package_binding_v8::FreshTupleReplacementBindingV2`,r,'immutable'),
    bootstrapCertificate:obj(`${core}::package_binding_v8::FreshTupleBootstrapCertificateV2`,c,'immutable'),walrusPolicy:obj(`${core}::core_v8::WalrusCertificationPolicyV1`,p,'shared'),
    walrusSystem:obj(`${W}::system::System`,system,'shared'),walrusSystemState:obj(`0x2::dynamic_field::Field<u64,${W}::system_state_inner::SystemStateInnerV1>`,state,'owned'),
    livingBlob:{...obj(`${W}::blob::Blob`,blob,'owned'),owner:{kind:'address',address:normalizeSuiAddress(signerAddress)}}}));
}
