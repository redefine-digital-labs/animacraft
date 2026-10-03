import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { blake2b } from '@noble/hashes/blake2.js';
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils';
import { NativeSoulPublicationBcs as B, verifyNativeSoulPublicationOutputs as verify } from '../scripts/native-soul-publication-outputs.mjs';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const SUI = id(2), STD = id(1), PACKAGE = id(1000), SIGNER = id(1001);
const INVALID = { code: 'NATIVE_SOUL_PUBLICATION_OUTPUT_INVALID' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const objectDigest = bytes => toBase58(blake2b(Buffer.concat([Buffer.from('Object::'), Buffer.from(bytes)]), { dkLen: 32 }));
const txDigest = toBase58(new Uint8Array(32).fill(22));
const own = (module, name) => `${PACKAGE}::${module}::${name}`;
const empty = bcs.struct('Empty', { dummy_field: bcs.bool() });

import { nativeSoulPublicationFixture as fixture } from './fixtures/native-soul-publication-fixture.mjs';

test('fresh eight init modules produce exactly 33 typed outputs and export closed gates/caps/displays/registries', () => {
  const f = fixture(), result = verify(f.args);
  assert.equal(result.schema, 'native-soul-publication-outputs-v1');
  assert.equal(Object.keys(result.objects).length, 32);
  assert.equal(result.ids.marketConfigV2Id, f.records.get('marketConfigV2').value.id);
  assert.equal(result.decoded.marketConfigV2.primary_enabled, false);
  assert.equal(result.decoded.marketConfigV2.secondary_enabled, false);
  assert.deepEqual(f.args.created.reduce((counts, row) => { counts[row.owner.kind] = (counts[row.owner.kind] ?? 0) + 1; return counts; }, {}), { Immutable: 1, AddressOwner: 7, Shared: 9, ObjectOwner: 16 });
  for (const name of ['profileRegistry', 'socialRegistry', 'communityRegistry', 'communityVoteRegistry']) {
    assert.equal(result.ids[`${name}Id`], f.records.get(name).value.id);
    assert.equal(result.decoded[name].version, '1');
  }
});
test('effects and Move output order are not authority', () => {
  const f = fixture(); f.args.created.reverse(); f.args.moveOutputs.reverse(); assert.equal(verify(f.args).ids.upgradeCapId, id(10));
});
test('untrusted JSON fields cannot replace canonical BCS authority', () => {
  const f = fixture(); f.records.get('marketConfigV2').output.fields = { primary_enabled: true, fee_recipient: id(999) };
  assert.equal(verify(f.args).decoded.marketConfigV2.primary_enabled, false);
  f.mutate('marketConfigV2', value => { value.primary_enabled = true; });
  assert.throws(() => verify(f.args), INVALID);
});

const mutations = [
  ['upgrade package', 'upgradeCap', v => { v.package = id(999); }],
  ['upgrade version', 'upgradeCap', v => { v.version = '2'; }],
  ['upgrade restriction', 'upgradeCap', v => { v.policy = 128; }],
  ['old predecessor', 'marketConfigV2', v => { v.legacy_config_id = id(999); }],
  ['config version', 'marketConfigV2', v => { v.version = '6'; }],
  ['config fee', 'marketConfigV2', v => { v.platform_fee_bps = 251; }],
  ['config recipient', 'marketConfigV2', v => { v.fee_recipient = id(999); }],
  ['primary open', 'marketConfigV2', v => { v.primary_enabled = true; }],
  ['secondary open', 'marketConfigV2', v => { v.secondary_enabled = true; }],
  ['admin target', 'marketAdminCapV2', v => { v.config_id = id(999); }],
  ['registry version', 'kioskRegistry', v => { v.version = '2'; }],
  ['kind registry version', 'kindRegistry', v => { v.version = '2'; }],
  ['custom counter', 'kindRegistry', v => { v.next_kind = 17; }],
  ['kind size', 'kindRegistry', v => { v.kinds.size = '6'; }],
  ['names size', 'kindRegistry', v => { v.name_to_kind.size = '4'; }],
  ['table alias', 'kindRegistry', v => { v.name_to_kind.id = v.kinds.id; }],
  ['table missing fields', 'kindRegistry', v => { v.kinds.id = id(999); }],
  ['policy nonzero balance', 'soulTransferPolicy', v => { v.balance.value = '1'; }],
  ['policy missing rule', 'soulTransferPolicy', v => { v.rules.contents.pop(); }],
  ['policy duplicate rule', 'collectionTransferPolicy', v => { v.rules.contents[2] = v.rules.contents[0]; }],
  ['policy rule order', 'soulTransferPolicy', v => { v.rules.contents.reverse(); }],
  ['policy wrong witness', 'collectionTransferPolicy', v => { v.rules.contents[2].name = v.rules.contents[2].name.replace('CollectionMarketProof', 'SoulMarketProof'); }],
  ['cap cross policy', 'soulPolicyCap', v => { v.policy_id = id(999); }],
  ['display version', 'soulDisplay', v => { v.version = 0; }],
  ['display field', 'soulDisplay', v => { v.fields.contents[4].value = '{image_url}'; }],
  ['collection display extra', 'collectionDisplay', v => { v.fields.contents.push({ key: 'link', value: '{origin_ref}' }); }],
  ['lock config', 'soulRule0', v => { v.value.dummy_field = true; }],
  ['personal config', 'soulRule1', v => { v.value = false; }],
  ['witness config', 'collectionRule2', v => { v.value = false; }],
  ['rule key', 'soulRule0', v => { v.name.dummy_field = true; }],
  ['DF substituted ID', 'kind0', v => { v.id = id(999); }],
  ['descriptor key', 'kind1', v => { v.name = 2; }],
  ['name index key', 'kindName0', v => { v.name = 'soul_doc_other'; }],
  ['name index value', 'kindName1', v => { v.value = 4; }],
];
for (const [label, name, mutate] of mutations) test(`rejects rehashed canonical BCS: ${label}`, () => {
  const f = fixture(); f.mutate(name, mutate); assert.throws(() => verify(f.args), INVALID);
});
for (const key of ['version', 'kind', 'name', 'op_mask', 'read_mode_mask', 'has_active_binding', 'requires_download_policy', 'default_grant_scope_mask', 'deprecated']) {
  test(`rejects changed built-in descriptor ${key}`, () => {
    const f = fixture(); f.mutate('kind3', v => { const x = v.value[key]; v.value[key] = typeof x === 'boolean' ? !x : typeof x === 'number' ? x + 1 : key === 'name' ? 'wrong' : String(BigInt(x) + 1n); });
    assert.throws(() => verify(f.args), INVALID);
  });
}

for (const [name, mutate] of [
  ['missing creation', a => a.created.pop()], ['extra creation', a => a.created.push({ ...a.created[0], objectId: id(999) })],
  ['duplicate creation', a => { a.created[1] = a.created[2]; }], ['mutated entry', a => { a.created[1].operation = 'MUTATED'; }],
  ['missing Move output', a => a.moveOutputs.pop()], ['duplicate Move output', a => { a.moveOutputs[1] = a.moveOutputs[2]; }],
  ['wrong signer', a => { a.signer = id(999); }], ['wrong package', a => { a.packageId = id(999); }],
  ['zero package', a => { a.packageId = id(0); }], ['short signer', a => { a.signer = '0x1'; }],
  ['wrong Kiosk Config origin', a => { a.kioskTypeOrigins.kioskLockConfig = a.kioskTypeOrigins.kioskLockRule; }],
  ['wrong Kiosk witness origin', a => { a.kioskTypeOrigins.witnessRule = id(999); }],
  ['unexpected mapping field', a => { a.kioskTypeOrigins.callable = id(999); }],
  ['package nonfresh', a => { a.created[0].version = '2'; }], ['package not immutable', a => { a.created[0].owner = { kind: 'AddressOwner', address: SIGNER }; }],
  ['created owner substitution', a => { a.created[1].owner.address = id(999); }],
  ['shared initial version mismatch', a => { a.created.find(r => r.owner.kind === 'Shared').owner.initialSharedVersion = '6'; }],
  ['effect digest mismatch', a => { a.created[1].digest = txDigest; }],
  ['effect version mismatch', a => { a.created[1].version = '8'; }],
  ['Object hash mismatch', a => { a.moveOutputs[0].objectBcsSha256 = '0'.repeat(64); }],
  ['content hash mismatch', a => { a.moveOutputs[0].contentBcsSha256 = '0'.repeat(64); }],
  ['type JSON substitution', a => { a.moveOutputs[0].type = `${SUI}::package::Publisher`; }],
  ['owner JSON substitution', a => { a.moveOutputs[0].owner = { AddressOwner: id(999) }; }],
  ['previousTransaction substitution', a => { a.moveOutputs[0].previousTransaction = toBase58(new Uint8Array(32).fill(23)); }],
  ['base64 whitespace', a => { a.moveOutputs[0].contentBcsBase64 += '\n'; }],
]) test(`rejects envelope/effects: ${name}`, () => { const f = fixture(); mutate(f.args); assert.throws(() => verify(f.args), INVALID); });

test('rejects object BCS trailing bytes even after content hash is recomputed', () => {
  const f = fixture(), o = f.args.moveOutputs[0]; const raw = Buffer.concat([fromBase64(o.objectBcsBase64), Buffer.from([0])]);
  o.objectBcsBase64 = toBase64(raw); o.objectBcsSha256 = sha(raw); o.reference.digest = objectDigest(raw); f.args.created[1].digest = o.reference.digest;
  assert.throws(() => verify(f.args), INVALID);
});
test('rejects content BCS trailing bytes after the entire Object and effects are rehashed', () => {
  const f = fixture(), o = f.args.moveOutputs[0];
  const content = Buffer.concat([fromBase64(o.contentBcsBase64), Buffer.from([0])]);
  const parsed = bcs.Object.parse(fromBase64(o.objectBcsBase64)); parsed.data.Move.contents = content;
  const raw = bcs.Object.serialize(parsed).toBytes();
  o.contentBcsBase64 = toBase64(content); o.contentBcsSha256 = sha(content);
  o.objectBcsBase64 = toBase64(raw); o.objectBcsSha256 = sha(raw); o.reference.digest = objectDigest(raw); f.args.created[1].digest = o.reference.digest;
  assert.throws(() => verify(f.args), /upgradeCap: canonical BCS layout required/);
});
test('rehashed arbitrary Field UID is rejected specifically by dynamic-field derivation', () => {
  const f = fixture(); f.mutate('kind0', v => { v.id = id(999); });
  assert.throws(() => verify(f.args), /kind0: derived field ID\/type mismatch/);
});
test('all identical effect and output owner substitutions still fail the wallet ownership requirement', () => {
  const f = fixture(); f.mutate('kindAdminCap', (_, r) => { r.owner = { kind: 'AddressOwner', address: id(999) }; });
  assert.throws(() => verify(f.args), /kindAdminCap: unexpected owner/);
});
test('same number of outputs cannot substitute a retained Publisher for KindAdminCap', () => {
  const f = fixture(); f.mutate('kindAdminCap', (_, r) => { r.type = `${SUI}::package::Publisher`; });
  assert.throws(() => verify(f.args), /kindAdminCap: expected one exact type/);
});
test('substituted embedded table ID cannot masquerade as another created object', () => {
  const f = fixture(); f.mutate('kindRegistry', v => { v.kinds.id = id(10); });
  assert.throws(() => verify(f.args), /Embedded tables have conflicting UIDs/);
});
for (const name of ['kind0', 'marketConfigV2', 'soulTransferPolicy', 'soulDisplay']) test(`rejects wrong Object public-transfer flag: ${name}`, () => {
  const f = fixture(); f.mutate(name, (_, row) => { row.publicTransfer = !row.publicTransfer; }); assert.throws(() => verify(f.args), INVALID);
});
test('rejects canonical rehashed DF custody substitution', () => {
  const f = fixture(); f.mutate('kind0', (_, row) => { row.owner = { kind: 'ObjectOwner', address: id(999) }; }); assert.throws(() => verify(f.args), INVALID);
});
const registryTables = {
  profileRegistry: ['by_owner', 'by_handle', 'by_index'], socialRegistry: ['counts', 'edges'],
  communityRegistry: ['by_index'], communityVoteRegistry: ['counts', 'edges'],
};
for (const [name, tables] of Object.entries(registryTables)) {
  for (const [label, mutation] of [
    ['version', v => { v.version = '2'; }],
    ['public transfer', (_, r) => { r.publicTransfer = true; }],
    ['address owner', (_, r) => { r.owner = { kind: 'AddressOwner', address: SIGNER }; }],
    ['object owner', (_, r) => { r.owner = { kind: 'ObjectOwner', address: SIGNER }; }],
    ['foreign package type', (_, r) => { r.type = r.type.replace(PACKAGE, id(999)); }],
    ['wrong module type', (_, r) => { r.type = r.type.replace(/::[^:]+::/, '::wrong_module::'); }],
    ['wrong struct type', (_, r) => { r.type += 'Other'; }],
  ]) test(`${name} rejects canonical rehashed ${label}`, () => {
    const f = fixture(); f.mutate(name, mutation); assert.throws(() => verify(f.args), INVALID);
  });
  for (const key of tables) {
    test(`${name}.${key} must be empty`, () => {
      const f = fixture(); f.mutate(name, v => { v[key].size = '1'; }); assert.throws(() => verify(f.args), INVALID);
    });
    for (const alias of ['zero', 'package', 'self', 'other output', 'dynamic field', 'kind table', 'kind name table', 'other registry table']) {
      test(`${name}.${key} rejects ${alias} UID`, () => {
        const f = fixture();
        const replacement = {
          zero: id(0), package: PACKAGE, self: f.records.get(name).value.id,
          'other output': f.records.get('upgradeCap').value.id,
          'dynamic field': f.records.get('kind0').value.id,
          'kind table': f.records.get('kindRegistry').value.kinds.id,
          'kind name table': f.records.get('kindRegistry').value.name_to_kind.id,
          'other registry table': name === 'profileRegistry' ? f.records.get('communityVoteRegistry').value.edges.id : f.records.get('profileRegistry').value.by_owner.id,
        }[alias];
        f.mutate(name, v => { v[key].id = replacement; }); assert.throws(() => verify(f.args), INVALID);
      });
    }
  }
  if (tables.length > 1) test(`${name} rejects internally aliased tables`, () => {
    const f = fixture(); f.mutate(name, v => { v[tables[1]].id = v[tables[0]].id; });
    assert.throws(() => verify(f.args), /Embedded tables have conflicting UIDs/);
  });
  test(`${name} JSON fields cannot replace BCS authority`, () => {
    const f = fixture(); f.records.get(name).output.fields = { id: id(999), version: '9' };
    assert.equal(verify(f.args).ids[`${name}Id`], f.records.get(name).value.id);
  });
  test(`${name} rejects trailing content after complete Object/effect rehash`, () => {
    const f = fixture(), o = f.records.get(name).output;
    const content = Buffer.concat([fromBase64(o.contentBcsBase64), Buffer.from([0])]);
    const parsed = bcs.Object.parse(fromBase64(o.objectBcsBase64)); parsed.data.Move.contents = content;
    const raw = bcs.Object.serialize(parsed).toBytes();
    o.contentBcsBase64 = toBase64(content); o.contentBcsSha256 = sha(content);
    o.objectBcsBase64 = toBase64(raw); o.objectBcsSha256 = sha(raw); o.reference.digest = objectDigest(raw);
    f.args.created.find(row => row.objectId === o.reference.objectId).digest = o.reference.digest;
    assert.throws(() => verify(f.args), new RegExp(`${name}: canonical BCS layout required`));
  });
}
for (const [name, key] of [['profileRegistry', 'profile_count'], ['communityRegistry', 'post_count']]) {
  test(`${name} requires zero initial ${key}`, () => {
    const f = fixture(); f.mutate(name, v => { v[key] = '1'; }); assert.throws(() => verify(f.args), INVALID);
  });
}
test('old 29-object publication cannot omit all four new registries', () => {
  const f = fixture(); f.args.created.splice(-4); f.args.moveOutputs.splice(-4);
  assert.throws(() => verify(f.args), /exact fresh init inventory/);
});
test('kind embedded table cannot alias a later registry object', () => {
  const f = fixture(); f.mutate('kindRegistry', v => { v.kinds.id = f.records.get('profileRegistry').value.id; });
  assert.throws(() => verify(f.args), /Embedded tables have conflicting UIDs/);
});
test('exact kind and display constants stay anchored to current production init source', () => {
  const workspace = process.env.SOULIDITY_WORKSPACE ?? fileURLToPath(new URL('../_paired/soulidity', import.meta.url));
  const root = join(workspace, 'move/soulidity/sources/');
  const kinds = readFileSync(`${root}kind_registry.move`, 'utf8');
  for (const name of ['soul_doc', 'memory', 'skill', 'sprite', 'audio']) assert.ok(kinds.includes(`b"${name}".to_string()`));
  assert.match(kinds, /FIRST_CUSTOM_KIND: u32 = 16/);
  const market = readFileSync(`${root}market.move`, 'utf8');
  const init = market.slice(market.indexOf('fun init_fresh_impl('), market.indexOf('#[test_only]\nfun init_impl('));
  assert.match(init, /primary_enabled: false/); assert.match(init, /secondary_enabled: false/); assert.match(init, /publisher.burn\(\)/);
  for (const module of ['soul', 'collection']) assert.match(readFileSync(`${root}${module}.move`, 'utf8'), /publisher.burn\(\)/);
  for (const [module, struct, fields] of [
    ['profile', 'ProfileRegistryV1', ['id: UID', 'version: u64', 'profile_count: u64', 'by_owner: Table<address, ID>', 'by_handle: Table<String, ID>', 'by_index: Table<u64, ID>']],
    ['social', 'SocialRegistryV1', ['id: UID', 'version: u64', 'counts: Table<ID, FollowCountsV1>', 'edges: Table<FollowKeyV1, FollowEdgeV1>']],
    ['community_posts', 'CommunityRegistryV1', ['id: UID', 'version: u64', 'post_count: u64', 'by_index: Table<u64, ID>']],
    ['community_votes', 'VoteRegistryV1', ['id: UID', 'version: u64', 'counts: Table<ID, VoteCountsV1>', 'edges: Table<VoteKeyV1, VoteEdgeV1>']],
  ]) {
    const source = readFileSync(`${root}${module}.move`, 'utf8');
    assert.match(source, /const VERSION: u64 = 1;/);
    const body = source.match(new RegExp(`public struct ${struct} has key \\{([^}]+)\\}`))?.[1];
    assert.equal(body?.replace(/\s+/g, ''), `${fields.join(',')},`.replace(/\s+/g, ''));
    const initBody = source.slice(source.indexOf('fun init(ctx:'), source.indexOf('transfer::share_object(registry);') + 'transfer::share_object(registry);'.length);
    assert.ok(initBody.includes(`let registry = ${struct} {`));
    assert.match(initBody, /id: object::new\(ctx\), version: VERSION/);
    for (const field of fields.slice(2)) {
      const [key, type] = field.split(': ');
      assert.ok(initBody.includes(`${key}: ${type.startsWith('Table') ? 'table::new(ctx)' : '0'}`));
    }
    assert.match(initBody, /transfer::share_object\(registry\);/);
  }
});
