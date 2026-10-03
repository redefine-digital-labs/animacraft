import assert from 'node:assert/strict';
import test from 'node:test';
import { attestMakerV8Runtime, makerV8ChainTypes } from '../maker-v8-chain.js';
import { makerV8PlayerRootBindingV2, createMakerV8PlayerCustodyAdapterV8 } from '../maker-v8-player-adapters.js';
import { makerV8StableType } from '../maker-v8-runtime.js';
import { MAKER_V8_PLAYER_ACTIONS } from '../maker-v8-player-controller.js';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils';
import { currentRuntimeAuthorityFixture } from './fixtures/maker-v8-current-runtime-authority.js';
const id = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const hash = n => Array(32).fill(n);
const some = value => ({ vec: [value] });
async function fixture() {
  const authority = currentRuntimeAuthorityFixture();
  const { runtime, replacement } = await attestMakerV8Runtime(authority.rpc, authority.config);
  const root = { objectId: id(200), type: makerV8ChainTypes(runtime).root, owner: { kind: 'SHARED' }, fields: {
    version: '8', lifecycle: '1', maker_version: '2', core_original_package_id: runtime.roles.core.typeOriginPackageId,
    core_callable_package_id: runtime.roles.core.callablePackageId, admin_cap_id: id(201),
    content: { content_commitment: hash(1), renderer_commitment: hash(2), manifest_blob_id: 'blob', manifest_sha256: hash(1) },
    base_registry_id: some(id(202)), maker_treasury_id: some(id(203)),
    publication: { catalog_id: some(runtime.catalogId), sealed_base_registry_commitment: some(hash(3)), release_commitments: some({ product_binding_commitment: replacement.fields.package_tuple_commitment,
      call_cap_set_commitment: replacement.fields.call_cap_set_commitment }), registry_ids: some(Object.fromEntries([
      'runtime_definition_registry_id', 'pack_registry_id', 'admission_authority_id', 'seal_registry_id', 'output_registry_id',
      'soul_registry_id', 'physical_registry_id', 'market_registry_id'].map((name, index) => [name, id(204 + index)]))) },
    economics: { protocol_config_id: runtime.protocolConfigId, protocol_treasury_id: runtime.protocolTreasuryId,
      maker_access: 1, maker_price_atomic: '17', complete_mode: 2, complete_price_atomic: '19', complete_per_wallet_quota: '3',
      complete_total_cap: '21', fixed_complete_fee_atomic: '5' },
  } };
  const player = { rootId: root.objectId, makerVersion: '2', evidence: { makerVersion: '2', contentCommitment: '01'.repeat(32), rendererCommitment: '02'.repeat(32) } };
  return { root, runtime, player, authority };
}
test('Player reads exact schema2 Root companions and economics with certified runtime', async () => {
  const { root, runtime, player } = await fixture();
  const result = makerV8PlayerRootBindingV2(root, runtime, player);
  assert.deepEqual(result.binding, { baseRegistryId: id(202), makerTreasuryId: id(203), sealPolicyConfigId: runtime.roleConfigIds.seal,
    runtimeDefinitionsId: id(204), packRegistryId: id(205), packAdmissionAuthorityId: id(206), sealRegistryId: id(207),
    outputRegistryId: id(208), soulRegistryId: id(209), physicalRegistryId: id(210), marketRegistryId: id(211) });
  assert.deepEqual(result.economics, { makerAccess: 1, makerPriceAtomic: '17', completeMode: 2, completePriceAtomic: '19', completeQuota: '3', completeTotalCap: '21', fixedCompleteFeeAtomic: '5' });
});
test('Player refuses missing or drifted current Root authority without legacy fallback', async t => {
  const mutations = {
    'legacy-only content': f => { f.root.fields.content_commitment = hash(1); delete f.root.fields.content; },
    'legacy-only registry binding': f => { f.root.fields.capability_registry_binding = f.root.fields.publication.registry_ids; delete f.root.fields.publication; },
    'missing publication slot': f => { f.root.fields.publication.registry_ids = { vec: [] }; },
    'missing sealed Base': f => { f.root.fields.publication.sealed_base_registry_commitment = { vec: [] }; },
    'malformed sealed Base': f => { f.root.fields.publication.sealed_base_registry_commitment = some([1]); },
    'wrong catalog': f => { f.root.fields.publication.catalog_id = some(id(99)); },
    'wrong tuple': f => { f.root.fields.publication.release_commitments.vec[0].product_binding_commitment = hash(99); },
    'wrong cap set': f => { f.root.fields.publication.release_commitments.vec[0].call_cap_set_commitment = hash(99); },
    'wrong protocol': f => { f.root.fields.economics.protocol_config_id = id(99); },
    'wrong treasury': f => { f.root.fields.economics.protocol_treasury_id = id(99); },
    'wrong content': f => { f.root.fields.content.content_commitment = hash(99); },
    'wrong renderer': f => { f.root.fields.content.renderer_commitment = hash(99); },
    'wrong evidence version': f => { f.player.evidence.makerVersion = '3'; },
    'paused': f => { f.root.fields.lifecycle = '2'; },
    'missing base': f => { f.root.fields.base_registry_id = { vec: [] }; },
    'missing admission ID': f => { delete f.root.fields.publication.registry_ids.vec[0].admission_authority_id; },
    'registry collision': f => { f.root.fields.publication.registry_ids.vec[0].market_registry_id = id(204); },
    'unattested runtime': f => { f.runtime = f.authority.config; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const f = await fixture(); mutate(f); assert.throws(() => makerV8PlayerRootBindingV2(f.root, f.runtime, f.player));
  });
});

test('production default custody reader gates new writes before inventory and accepts current acquisition', async t => {
  for (const mode of ['current', 'disabled', 'revision-rotated', 'catalog-rotated']) await t.test(mode, async () => {
    const f = await fixture();
    const { runtime, root } = f;
    const types = makerV8ChainTypes(runtime);
    const counters = { owned: 0, coins: 0, sign: 0, claim: 0 };
    const entries = new Map();
    const type = (role, module, name, generic = false) => `${makerV8StableType(runtime, role, module, name)}${generic ? `<${runtime.paymentCoinType}>` : ''}`;
    const put = (objectId, objectType, fields) => entries.set(objectId, { data: { objectId, type: objectType,
      version: '1', digest: '2'.repeat(44), owner: { Shared: { initial_shared_version: '1' } },
      content: { dataType: 'moveObject', type: objectType, fields: structuredClone(fields) } } });
    for (const [objectId, response] of f.authority.objects) entries.set(objectId, JSON.parse(JSON.stringify(response)));
    put(root.objectId, root.type, root.fields);
    put(runtime.clockObjectId, '0x0000000000000000000000000000000000000000000000000000000000000002::clock::Clock', { id: runtime.clockObjectId, timestamp_ms: '10' });
    const catalog = entries.get(runtime.catalogId).data.content.fields;
    put(runtime.protocolConfigId, types.protocolConfig, { id: runtime.protocolConfigId, version: '8', enabled: mode !== 'disabled',
      core_original_package_id: runtime.roles.core.typeOriginPackageId, core_callable_package_id: runtime.roles.core.callablePackageId,
      revision: mode === 'revision-rotated' ? '2' : catalog.protocol_config_revision, commitment: catalog.protocol_config_commitment,
      treasury_id: runtime.protocolTreasuryId, payment_coin_type: runtime.paymentCoinType });
    for (const [objectId, role, module, name, generic] of [
      [runtime.protocolTreasuryId, 'core', 'protocol_config_v8', 'ProtocolTreasuryV8', true],
      [id(202), 'core', 'base_registry_v8', 'BaseDefinitionRegistryV8'], [id(203), 'core', 'treasury_v8', 'MakerTreasuryV8', true],
      [id(204), 'runtime', 'runtime_v8', 'RuntimeDefinitionRegistryV8'], [id(205), 'runtime', 'runtime_v8', 'PackRegistryV8'],
      [id(207), 'seal', 'seal_v8', 'SealRegistryV8'], [id(208), 'output', 'output_v8', 'OutputRegistryV8'],
      [id(209), 'output', 'output_v8', 'SoulRegistryV8'], [id(210), 'physical', 'physical_v8', 'PhysicalRegistryV8'],
    ]) put(objectId, type(role, module, name, generic), { id: objectId });
    const keyType = type('core', 'protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2');
    const valueType = type('core', 'protocol_config_v8', 'ProductReleaseCatalogSlotV2');
    const client = {
      async getChainIdentifier() { return '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'; },
      async getObject({ id: objectId }) { assert.ok(entries.has(objectId), `unexpected object ${objectId}`); return entries.get(objectId); },
      async getDynamicField(input) {
        counters.claim++;
        assert.deepEqual(input, { parentId: runtime.protocolConfigId, name: { type: keyType, bcsBase64: 'AA==' } });
        return { kind: 'DynamicField', childId: null, fieldId: deriveDynamicFieldID(runtime.protocolConfigId, keyType, new Uint8Array([0])),
          type: `0x2::dynamic_field::Field<${keyType},${valueType}>`, name: input.name,
          value: { type: valueType, bcsBase64: toBase64(bcs.Address.serialize(mode === 'catalog-rotated' ? id(999) : runtime.catalogId).toBytes()) } };
      },
      async getOwnedObjects() { counters.owned++; return { data: [], hasNextPage: false, nextCursor: null }; },
      async getCoins() { counters.coins++; throw new Error('No coin lookup expected'); },
      async signTransaction() { counters.sign++; throw new Error('No signing expected'); },
    };
    const custody = createMakerV8PlayerCustodyAdapterV8({ client, runtime, assertTransport() {},
      loadRuntimeAttestation: async () => ({ runtime }) });
    const player = { ...f.player, document: createCharacterMakerV8Starter() };
    const request = { action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_MAKER_ACCESS, player,
      recipe: { selections: [], colors: [], outputKey: 'soul' }, loadout: { selections: [] }, input: {}, account: { address: id(300) } };
    if (mode === 'current') {
      const context = await custody.loadPlayerContext(request);
      assert.equal(context.actionEligible, true);
      assert.equal(context.builderInput.objects.root.objectId, root.objectId);
      assert.equal(context.builderInput.objects.replacement.objectId, f.authority.replacement.id);
      assert.equal(context.builderInput.rootInfo.economics.makerPriceAtomic, '17');
      assert.equal(counters.owned, 4);
    } else {
      await assert.rejects(custody.loadPlayerContext(request), { code: 'MAKER_V8_PLAYER_PROTOCOL_NOT_CURRENT' });
      assert.equal(counters.owned, 0);
    }
    assert.equal(counters.coins, 0); assert.equal(counters.sign, 0);
    assert.equal(counters.claim, ['current', 'catalog-rotated'].includes(mode) ? 1 : 0);
    if (mode === 'current') {
      const releaseId = id(340), treasuryId = id(341);
      put(releaseId, types.packRelease, { id: releaseId, root_id: root.objectId,
        root_version: '2', root_content_commitment: hash(1), semantic_pack_id: 'real-pack', lifecycle: '2',
        access_kind: '0', treasury_id: treasuryId });
      put(treasuryId, types.packTreasury, { id: treasuryId });
      const packRequest = { ...request, action: MAKER_V8_PLAYER_ACTIONS.ACQUIRE_PACK_ACCESS,
        input: { releaseId, semanticPackId: 'real-pack' } };
      const packContext = await custody.loadPlayerContext(packRequest);
      assert.equal(packContext.builderInput.objects.releases[0].objectId, releaseId);
      assert.equal(packContext.builderInput.objects.makerAccess, null);
      entries.get(releaseId).data.content.fields.root_content_commitment = hash(99);
      await assert.rejects(custody.loadPlayerContext(packRequest), { code: 'MAKER_V8_PLAYER_PACK_RELEASE_DRIFT' });
      assert.equal(counters.coins, 0); assert.equal(counters.sign, 0);
    }
  });
});
