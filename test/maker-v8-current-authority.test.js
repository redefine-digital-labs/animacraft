import assert from 'node:assert/strict';
import test from 'node:test';
import { MAKER_V8_CLOCK_OBJECT_ID, MAKER_V8_PAYMENT_COIN_TYPE, MAKER_V8_RUNTIME_SCHEMA } from '../maker-v8-runtime.js';
import { makerV8ChainTypes, parseMakerV8ActivatedEvent, parseMakerRootV8, parseMakerV8MarketAuthority, loadMakerV8Context, MAKER_V8_MAINNET_CHAIN_IDENTIFIER } from '../maker-v8-chain.js';

const sid = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const hash = (n) => Array(32).fill(n);
function fixture() {
  const roles = Object.fromEntries(['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release']
    .map((role, i) => [role, { typeOriginPackageId: sid(i * 2 + 1), callablePackageId: sid(i * 2 + 1) }]));
  const runtime = {
    schemaVersion: MAKER_V8_RUNTIME_SCHEMA, protocolVersion: 8, enabled: true,
    catalogId: sid(20), protocolConfigId: sid(21), protocolTreasuryId: sid(22),
    paymentCoinType: MAKER_V8_PAYMENT_COIN_TYPE, clockObjectId: MAKER_V8_CLOCK_OBJECT_ID,
    roles, roleConfigIds: { seal: sid(23), runtime: sid(24), output: sid(25),
      physical: sid(26), market: sid(27), release: sid(28) }, makerBindings: [],
  };
  const registry = { runtime_definition_registry_id: sid(104), pack_registry_id: sid(105),
    admission_authority_id: sid(106), seal_registry_id: sid(103), output_registry_id: sid(107),
    soul_registry_id: sid(108), physical_registry_id: sid(109), market_registry_id: sid(110) };
  const event = {
    type: makerV8ChainTypes(runtime).activationEvent,
    id: { txDigest: '4'.repeat(44), eventSeq: '0' },
    parsedJson: {
      root_id: sid(100), version: '8', owner: sid(900), control_epoch: '0',
      admin_cap_id: sid(112), maker_key: 'current-maker', maker_version: '1',
      version_commitment: hash(1), content_commitment: hash(2), renderer_commitment: hash(3),
      protocol_config_id: sid(21), protocol_config_revision: '7', protocol_config_commitment: hash(4),
      protocol_treasury_id: sid(22), maker_treasury_id: sid(102), catalog_id: sid(20),
      product_binding_commitment: hash(5), call_cap_set_commitment: hash(6),
      base_registry_id: sid(101), registry_ids: structuredClone(registry),
      replacement_id: sid(120), bootstrap_certificate_id: sid(121),
    },
  };
  const fields = {
    id: { id: sid(100) }, version: '8', core_original_package_id: roles.core.typeOriginPackageId,
    core_callable_package_id: roles.core.callablePackageId, creator: sid(900), owner: sid(900),
    admin_cap_id: sid(112), control_epoch: '0', lifecycle: '1', maker_key: 'current-maker',
    maker_version: '1', version_commitment: hash(1), previous_root_id: null,
    previous_version_commitment: null, successor_authority_id: null, successor_root_id: null,
    maker_document_commitment: hash(10), creator_defaults_commitment: hash(11),
    living_content_binding_commitment: hash(12),
    content: { renderer_commitment: hash(3), manifest_blob_id: 'real-manifest',
      manifest_sha256: hash(13), content_commitment: hash(2) },
    base_registry_id: sid(101), maker_treasury_id: sid(102), expected_base_definition_count: '4',
    expected_base_registry_commitment: hash(14), expected_pack_admission_policy_commitment: hash(15),
    economics: { protocol_config_id: sid(21), protocol_config_revision: '7',
      protocol_config_commitment: hash(4), protocol_treasury_id: sid(22) },
    rights: {}, publication: { catalog_id: sid(20), sealed_base_registry_commitment: '12'.repeat(32), release_commitments: {
      product_binding_commitment: hash(5), call_cap_set_commitment: hash(6) }, registry_ids: registry },
    created_at_ms: '1',
  };
  const root = { data: { objectId: sid(100), version: '9', digest: '5'.repeat(44),
    type: makerV8ChainTypes(runtime).root, owner: { Shared: { initial_shared_version: '1' } },
    content: { dataType: 'moveObject', fields } } };
  return { runtime, event, root, fields };
}
const parse = (f) => parseMakerRootV8(f.root, f.runtime, f.event);

function marketFixture() {
  const f = fixture();
  f.fields.economics.commitment = hash(16);
  f.fields.rights.commitment = hash(17);
  const object = (type, objectId, fields) => ({ data: { objectId,
    type, version: '10', digest: '5'.repeat(44),
    owner: { Shared: { initial_shared_version: '1' } },
    content: { dataType: 'moveObject', fields: { id: { id: objectId }, ...fields } },
  } });
  const identity = { root_id: sid(100), maker_version: '1', root_content_commitment: hash(2),
    catalog_id: f.runtime.catalogId, package_config_id: f.runtime.roleConfigIds.market };
  f.market = object(makerV8ChainTypes(f.runtime).marketRegistry, sid(110), {
    ...identity, treasury_id: sid(111), sealed: true,
    product_binding_commitment: hash(5), call_cap_set_commitment: hash(6),
    protocol_config_id: sid(21), protocol_config_revision: '7', protocol_config_commitment: hash(4),
    economics_commitment: hash(16), rights_commitment: hash(17),
  });
  f.treasury = object(makerV8ChainTypes(f.runtime).marketTreasury, sid(111), { ...identity, version: '8' });
  return f;
}

test('Market treasury is discovered from exact shared registry, completing the pinned binding', () => {
  const f = marketFixture();
  const partial = parse(f);
  assert.equal(partial.binding.marketTreasuryId, undefined);
  f.runtime.makerBindings = [{ ...partial.binding, marketTreasuryId: sid(111) }];
  const result = parseMakerV8MarketAuthority(f.market, f.treasury, f.runtime, partial);
  assert.equal(result.root.binding.marketTreasuryId, sid(111));
  assert.equal(Object.keys(result.root.binding).length, 12);
  assert.equal(result.registry.objectId, sid(110));
  assert.ok(Object.isFrozen(result.root.binding));
  f.runtime.makerBindings[0].marketTreasuryId = sid(999);
  assert.throws(() => parseMakerV8MarketAuthority(f.market, f.treasury, f.runtime, partial),
    { code: 'MAKER_V8_BINDING_READBACK_MISMATCH' });
});

test('Market readback rejects wrong Root/config, unsealed/private objects, snapshot drift and treasury substitution', () => {
  for (const edit of [
    f => { f.market.data.content.fields.root_id = sid(998); },
    f => { f.market.data.content.fields.package_config_id = sid(998); },
    f => { f.market.data.content.fields.treasury_id = sid(998); },
    f => { f.market.data.content.fields.sealed = false; },
    f => { f.market.data.owner = { AddressOwner: sid(900) }; },
    f => { f.treasury.data.owner = { AddressOwner: sid(900) }; },
    f => { f.treasury.data.type = f.market.data.type; },
    f => { f.treasury.data.content.fields.root_content_commitment = hash(99); },
    f => { f.market.data.content.fields.economics_commitment = hash(99); },
    f => { f.market.data.content.fields.rights_commitment = hash(99); },
    f => { f.market.data.content.fields.call_cap_set_commitment = hash(99); },
  ]) {
    const f = marketFixture(); edit(f);
    assert.throws(() => parseMakerV8MarketAuthority(f.market, f.treasury, f.runtime, parse(f)));
  }
});

test('context loads the actual Market objects without fallback IDs and remains readable when paused', async () => {
  const f = marketFixture(); f.fields.lifecycle = '2';
  const readIds = [];
  const responses = new Map([[sid(100), f.root], [sid(110), f.market], [sid(111), f.treasury]]);
  const rpc = { getChainIdentifier: async () => MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
    getObject: async ({ id }) => { readIds.push(id); return responses.get(id); } };
  const result = await loadMakerV8Context(rpc, f.runtime, f.event);
  assert.deepEqual(readIds, [sid(100), sid(110), sid(111)]);
  assert.equal(result.root.lifecycle, 'PAUSED');
  assert.equal(result.root.binding.marketTreasuryId, sid(111));
  assert.equal(result.marketTreasury.objectId, sid(111));
  const g = marketFixture(); g.market.data.objectId = sid(999); g.market.data.content.fields.id = { id: sid(999) };
  const badReads = [];
  await assert.rejects(loadMakerV8Context({ ...rpc, getObject: async ({ id }) => {
    badReads.push(id); return id === sid(100) ? g.root : g.market;
  } }, g.runtime, g.event), { code: 'MAKER_V8_MARKET_BINDING_MISMATCH' });
  assert.deepEqual(badReads, [sid(100), sid(110)]);
});

test('Market accepts the same nested Move snapshot wrappers as Root and still checks commitments', () => {
  const f = marketFixture();
  f.fields.economics = { fields: f.fields.economics };
  f.fields.rights = { fields: f.fields.rights };
  const root = parse(f);
  assert.equal(parseMakerV8MarketAuthority(f.market, f.treasury, f.runtime, root).treasury.objectId, sid(111));
  const changed = structuredClone(f.market);
  changed.data.content.fields.rights_commitment = hash(99);
  assert.throws(() => parseMakerV8MarketAuthority(changed, f.treasury, f.runtime, root),
    { code: 'MAKER_V8_MARKET_SNAPSHOT_MISMATCH' });
});

test('current activation and nested Root expose only actual certified discovery facts', () => {
  const f = fixture();
  const event = parseMakerV8ActivatedEvent(f.event, f.runtime);
  const root = parse(f);
  assert.equal(Object.keys(event.binding).length, 11);
  assert.equal(event.binding.marketRegistryId, sid(110));
  assert.equal(event.binding.marketTreasuryId, undefined);
  assert.equal(event.capabilityBindingCommitment, undefined);
  assert.equal(event.replacementId, sid(120));
  assert.equal(event.bootstrapCertificateId, sid(121));
  assert.deepEqual(root.binding, event.binding);
  assert.equal(root.content.manifestBlobId, 'real-manifest');
  assert.equal(root.productBindingCommitment, '05'.repeat(32));
  assert.equal(root.callCapSetCommitment, '06'.repeat(32));
  assert.equal(root.catalogId, f.runtime.catalogId);
  assert.ok(Object.isFrozen(root.binding));
  assert.throws(() => parseMakerRootV8(f.root, f.runtime, { ...event, catalogId: sid(999) }),
    { code: 'MAKER_V8_ACTIVATION_RUNTIME_MISMATCH' });
});

test('pinned binding is compared in stages without inventing Market treasury', () => {
  const f = fixture();
  const binding = parseMakerV8ActivatedEvent(f.event, f.runtime).binding;
  f.runtime.makerBindings = [{ ...binding, marketTreasuryId: sid(111) }];
  assert.equal(parse(f).binding.marketTreasuryId, undefined);
  f.runtime.makerBindings[0].outputRegistryId = sid(991);
  assert.throws(() => parse(f), { code: 'MAKER_V8_BINDING_READBACK_MISMATCH' });
});

test('live owner and admin may rotate independently of immutable activation', () => {
  const f = fixture();
  f.fields.owner = sid(901); f.fields.admin_cap_id = sid(113);
  f.fields.control_epoch = '1'; f.fields.lifecycle = '2';
  const root = parse(f);
  assert.equal(root.ownerAddress, sid(901)); assert.equal(root.adminCapId, sid(113));
  assert.equal(root.creatorAddress, sid(900)); assert.equal(root.controlEpoch, 1n);
  assert.equal(root.lifecycle, 'PAUSED');
});

test('lineage remains exact and paired', () => {
  const f = fixture();
  f.fields.previous_root_id = sid(99); f.fields.previous_version_commitment = '09'.repeat(32);
  f.fields.successor_authority_id = sid(98); f.fields.successor_root_id = sid(97);
  const root = parse(f);
  assert.equal(root.previousRootId, sid(99)); assert.equal(root.previousVersionCommitment, '09'.repeat(32));
  assert.equal(root.successorRootId, sid(97));
  const invalid = fixture(); invalid.fields.previous_root_id = sid(99);
  assert.throws(() => parse(invalid), { code: 'MAKER_V8_ROOT_LINEAGE_MISMATCH' });
});

test('activated Root requires its one-time storage seal and keeps it distinct from author intent', () => {
  const f = fixture();
  const root = parse(f);
  assert.equal(root.sealedBaseRegistryCommitment, '12'.repeat(32));
  assert.notEqual(root.sealedBaseRegistryCommitment, root.authorRowsCommitment);
  for (const invalid of [null, undefined, '', 'ab', { vec: [] }, { vec: ['12'.repeat(32), '13'.repeat(32)] }]) {
    const g = fixture();
    if (invalid === undefined) delete g.fields.publication.sealed_base_registry_commitment;
    else g.fields.publication.sealed_base_registry_commitment = invalid;
    assert.throws(() => parse(g));
  }
});

test('all eight companion IDs and sealed publication commitments must match the event', () => {
  for (const key of Object.keys(fixture().fields.publication.registry_ids)) {
    const f = fixture(); f.fields.publication.registry_ids[key] = sid(999);
    assert.throws(() => parse(f), { code: 'MAKER_V8_COMPANION_BINDING_MISMATCH' });
  }
  for (const key of ['product_binding_commitment', 'call_cap_set_commitment']) {
    const f = fixture(); f.fields.publication.release_commitments[key] = hash(99);
    assert.throws(() => parse(f), { code: 'MAKER_V8_ROOT_SNAPSHOT_MISMATCH' });
  }
  for (const key of ['content_commitment', 'renderer_commitment']) {
    const f = fixture(); f.fields.content[key] = hash(99);
    assert.throws(() => parse(f), { code: 'MAKER_V8_ROOT_SNAPSHOT_MISMATCH' });
  }
});

test('removed issuer fields and incomplete nested authority are rejected, never upgraded', () => {
  for (const key of ['native_capability_mask', 'capability_binding_commitment', 'market_treasury_id']) {
    const f = fixture(); f.event.parsedJson[key] = '127';
    assert.throws(() => parse(f), { code: 'MAKER_V8_CHAIN_FIELD_UNKNOWN' });
  }
  const f = fixture(); f.fields.capability_registry_binding = {};
  assert.throws(() => parse(f), { code: 'MAKER_V8_CHAIN_FIELD_UNKNOWN' });
  for (const key of ['registry_ids', 'release_commitments', 'catalog_id']) {
    const g = fixture(); g.fields.publication[key] = null; assert.throws(() => parse(g));
  }
  const g = fixture(); delete g.fields.content.renderer_commitment;
  assert.throws(() => parse(g), { code: 'MAKER_V8_CHAIN_FIELD_MISSING' });
});

test('ID aliasing, missing certificate, wrong type/network and treasury mismatch reject', () => {
  const f = fixture(); f.event.parsedJson.registry_ids.pack_registry_id = sid(100);
  assert.throws(() => parse(f), { code: 'MAKER_V8_BINDING_ID_COLLISION' });
  const g = fixture(); delete g.event.parsedJson.replacement_id;
  assert.throws(() => parse(g), { code: 'MAKER_V8_ACTIVATION_FIELD_MISSING' });
  const h = fixture(); h.event.parsedJson.bootstrap_certificate_id = sid(0);
  assert.throws(() => parse(h), { code: 'MAKER_V8_CHAIN_ID_INVALID' });
  const i = fixture(); i.fields.economics.protocol_treasury_id = sid(999);
  assert.throws(() => parse(i), { code: 'MAKER_V8_ROOT_READBACK_MISMATCH' });
  const j = fixture(); j.event.type = j.event.type.replace('MakerV8Activated', 'OldActivated');
  assert.throws(() => parse(j), { code: 'UNSUPPORTED_LEGACY_PRODUCT' });
  const k = fixture(); assert.throws(() => parseMakerV8ActivatedEvent(k.event, k.runtime, 'testnet'));
  const l = fixture();
  const parsed = parseMakerV8ActivatedEvent(l.event, l.runtime);
  assert.throws(() => parseMakerRootV8(l.root, l.runtime, { ...parsed, network: 'testnet' }));
  assert.throws(() => parseMakerRootV8(l.root, l.runtime, { ...parsed, type: 'old::Event' }),
    { code: 'UNSUPPORTED_LEGACY_PRODUCT' });
});
