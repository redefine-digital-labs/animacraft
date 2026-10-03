import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMakerV8SealRuntimeRegistryCommitmentV2 } from '../maker-v8-seal-runtime-compiler.js';
import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils';
import { attestMakerV8Runtime, makerV8ChainTypes } from '../maker-v8-chain.js';
import { createMakerV8PackProtectionAuthorityLoaderV8 } from '../maker-v8-pack-compiler.js';
import { currentRuntimeAuthorityFixture } from './fixtures/maker-v8-current-runtime-authority.js';

const id = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const hash = n => Array(32).fill(n);
const hex = bytes => Buffer.from(bytes).toString('hex');
async function fixture() {
  const original = currentRuntimeAuthorityFixture();
  const { runtime, replacement } = await attestMakerV8Runtime(original.rpc, original.config);
  const types = makerV8ChainTypes(runtime);
  const objects = new Map([...original.objects].map(([key, value]) => [key, structuredClone(value)]));
  const put = (objectId, type, fields) => objects.set(objectId, { data: {
    objectId, version: '1', digest: '2'.repeat(44), type,
    owner: { Shared: { initial_shared_version: '1' } },
    content: { dataType: 'moveObject', type, fields: { id: objectId, ...fields } },
  } });
  const catalog = objects.get(runtime.catalogId).data.content.fields;
  const seal = objects.get(runtime.roleConfigIds.seal).data.content.fields;
  const tuple = replacement.fields.package_tuple_commitment;
  const caps = replacement.fields.call_cap_set_commitment;
  put(id(100), types.root, { version: '8', lifecycle: '1', maker_version: '2',
    content: { content_commitment: hash(1) }, publication: { catalog_id: runtime.catalogId, sealed_base_registry_commitment: '03'.repeat(32),
      registry_ids: { seal_registry_id: id(101) }, release_commitments: {
        product_binding_commitment: tuple, call_cap_set_commitment: caps } } });
  put(runtime.protocolConfigId, types.protocolConfig, { version: '8', enabled: true,
    core_original_package_id: runtime.roles.core.typeOriginPackageId,
    core_callable_package_id: runtime.roles.core.callablePackageId,
    revision: catalog.protocol_config_revision, commitment: catalog.protocol_config_commitment,
    treasury_id: runtime.protocolTreasuryId, payment_coin_type: runtime.paymentCoinType });
  const registryState = { registryId: id(101), rootId: id(100), makerVersion: '2', rootContentCommitment: hex(hash(1)), policyId: runtime.roleConfigIds.seal,
    baseCount: '2', packCount: '3', completeCount: '1', baseCommitment: hex(hash(2)), packCommitment: hex(hash(3)), completeCommitment: hex(hash(4)), revision: '3', runtimeRevision: '3', sealed: true };
  put(id(101), types.sealRegistry, { root_id: id(100), maker_version: '2', root_content_commitment: hash(1),
    catalog_id: runtime.catalogId, policy_config_id: runtime.roleConfigIds.seal, policy_commitment: seal.commitment,
    product_binding_commitment: tuple, sealed: true, runtime_revision: '3', revision: '3',
    base_count: '2', pack_count: '3', complete_count: '1', base_commitment: hash(2), pack_commitment: hash(3), complete_commitment: hash(4),
    commitment: deriveMakerV8SealRuntimeRegistryCommitmentV2(registryState) });
  const document = { bindings: {
    root: { objectRef: { objectId: id(100), version: '1', digest: '2'.repeat(44) }, makerVersion: '2', contentCommitment: hex(hash(1)) },
    releaseConfig: { objectRef: { objectId: runtime.roleConfigIds.release, version: '1', digest: '2'.repeat(44) },
      productBindingCommitment: hex(tuple) },
  } };
  const core = runtime.roles.core.typeOriginPackageId;
  const keyType = `${core}::protocol_config_v8::ProductReleaseCatalogSlotKeyV2`;
  const valueType = `${core}::protocol_config_v8::ProductReleaseCatalogSlotV2`;
  const reads = [];
  const client = {
    getChainIdentifier: original.rpc.getChainIdentifier,
    async getObject({ id: objectId }) { reads.push(objectId); return objects.get(objectId); },
    async getDynamicField({ parentId, name }) {
      assert.equal(parentId, runtime.protocolConfigId); assert.deepEqual(name, { type: keyType, bcsBase64: 'AA==' });
      return { kind: 'DynamicField', fieldId: deriveDynamicFieldID(parentId, keyType, new Uint8Array([0])),
        type: `0x2::dynamic_field::Field<${keyType},${valueType}>`, name,
        value: { type: valueType, bcsBase64: toBase64(bcs.Address.serialize(runtime.catalogId).toBytes()) } };
    },
  };
  return { runtime, document, client, objects, reads, load: createMakerV8PackProtectionAuthorityLoaderV8({ client, runtime }) };
}

test('protected Pack default authority follows current Root publication and live protocol', async () => {
  const f = await fixture();
  const result = await f.load({ document: f.document });
  assert.equal(result.sealRegistry.objectId, id(101));
  assert.equal(result.productBindingCommitment, f.document.bindings.releaseConfig.productBindingCommitment);
  assert.equal(result.runtimeRevision, '3');
  assert.deepEqual(f.reads, [id(100), f.runtime.protocolConfigId, f.runtime.catalogId,
    f.runtime.roleConfigIds.release, f.runtime.roleConfigIds.seal, id(101)]);
});

test('protected Pack current authority rejects legacy fallback and cross-release drift', async t => {
  const root = f => f.objects.get(id(100)).data.content.fields;
  for (const [name, mutate] of Object.entries({
    'legacy content only': f => { root(f).content_commitment = hash(1); delete root(f).content; },
    'legacy registry only': f => { root(f).capability_registry_binding = { seal_registry_id: id(101) }; delete root(f).publication; },
    'root reference version': f => { f.document.bindings.root.objectRef.version = '2'; },
    'root content': f => { root(f).content.content_commitment = hash(9); },
    'paused root': f => { root(f).lifecycle = '2'; },
    'wrong catalog': f => { root(f).publication.catalog_id = id(999); },
    'wrong tuple': f => { root(f).publication.release_commitments.product_binding_commitment = hash(9); },
    'wrong caps': f => { root(f).publication.release_commitments.call_cap_set_commitment = hash(9); },
    'uninstalled registries': f => { root(f).publication.registry_ids = null; },
    'disabled protocol': f => { f.objects.get(f.runtime.protocolConfigId).data.content.fields.enabled = false; },
    'wrong release tuple': f => { f.objects.get(f.runtime.roleConfigIds.release).data.content.fields.product_binding_commitment = hash(9); },
    'wrong Seal root': f => { f.objects.get(id(101)).data.content.fields.root_id = id(999); },
    'wrong Seal catalog': f => { f.objects.get(id(101)).data.content.fields.catalog_id = id(999); },
    'unsealed registry': f => { f.objects.get(id(101)).data.content.fields.sealed = false; },
    'scope count drift': f => { f.objects.get(id(101)).data.content.fields.pack_count = '4'; },
    'scope commitment drift': f => { f.objects.get(id(101)).data.content.fields.pack_commitment = hash(9); },
    'legacy runtime only': f => { const r = f.objects.get(id(101)).data.content.fields; r.runtime_commitment = r.commitment; delete r.commitment; },
  })) await t.test(name, async () => {
    const f = await fixture(); mutate(f); await assert.rejects(f.load({ document: f.document }));
  });
});

test('protected Pack keeps supported Move Option wrappers and canonical byte projections', async () => {
  const f = await fixture();
  const fields = f.objects.get(id(100)).data.content.fields;
  for (const key of ['catalog_id', 'registry_ids', 'release_commitments']) {
    fields.publication[key] = { fields: { vec: [fields.publication[key]] } };
  }
  fields.content.content_commitment = toBase64(Uint8Array.from(hash(1)));
  assert.equal((await f.load({ document: f.document })).sealRegistry.objectId, id(101));
});
