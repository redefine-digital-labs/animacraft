import { createHash } from 'node:crypto';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { blake2b } from '@noble/hashes/blake2.js';
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils';
import { NativeSoulPublicationBcs as B } from '../../scripts/native-soul-publication-outputs.mjs';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const SUI = id(2), STD = id(1), PACKAGE = id(1000), SIGNER = id(1001);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const objectDigest = bytes => toBase58(blake2b(Buffer.concat([Buffer.from('Object::'), Buffer.from(bytes)]), { dkLen: 32 }));
const txDigest = toBase58(new Uint8Array(32).fill(22));
const empty = bcs.struct('Empty', { dummy_field: bcs.bool() });

// Storage/transaction fixtures only: real Object and content BCS, not a live
// publication/finality certificate. Distinct Rule/Config origins catch shortcuts.
export function nativeSoulPublicationFixture({ signer = SIGNER, transactionDigest = txDigest, packageId = PACKAGE, objectIdBase = 10 } = {}) {
  const SIGNER = signer, txDigest = transactionDigest, PACKAGE = packageId;
  const own = (module, name) => `${PACKAGE}::${module}::${name}`;
  const args = { packageId: PACKAGE, signer: SIGNER,
    kioskTypeOrigins: { kioskLockRule: id(80), kioskLockConfig: id(81), personalKioskRule: id(82), witnessRule: id(83) },
    created: [{ operation: 'CREATED', objectId: PACKAGE, version: '1', digest: toBase58(new Uint8Array(32).fill(5)), owner: { kind: 'Immutable' } }], moveOutputs: [] };
  const records = new Map(); let nextId = objectIdBase;
  function encode(name, type, schema, value, owner, publicTransfer) {
    const content = schema.serialize(value).toBytes();
    const objectOwner = owner.kind === 'Shared' ? { Shared: { initialSharedVersion: owner.initialSharedVersion } }
      : { [owner.kind]: owner.address };
    const object = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type, true).struct },
      hasPublicTransfer: publicTransfer, version: '7', contents: content } }, owner: objectOwner, previousTransaction: txDigest, storageRebate: '100' }).toBytes();
    const reference = { objectId: value.id, version: '7', digest: objectDigest(object) };
    const outputOwner = owner.kind === 'Shared' ? { Shared: { initial_shared_version: owner.initialSharedVersion } } : { [owner.kind]: owner.address };
    const output = { reference, type: normalizeStructTag(type), owner: outputOwner, previousTransaction: txDigest,
      fields: structuredClone(value), contentBcsBase64: toBase64(content), contentBcsSha256: sha(content), objectBcsBase64: toBase64(object), objectBcsSha256: sha(object) };
    const previous = records.get(name);
    if (previous) {
      args.moveOutputs[args.moveOutputs.indexOf(previous.output)] = output;
      args.created[args.created.findIndex(row => row.objectId === previous.output.reference.objectId)] = { operation: 'CREATED', ...reference, owner };
    } else { args.moveOutputs.push(output); args.created.push({ operation: 'CREATED', ...reference, owner }); }
    records.set(name, { type, schema, value, owner, publicTransfer, output }); return value;
  }
  const shared = { kind: 'Shared', initialSharedVersion: '7' }, address = { kind: 'AddressOwner', address: SIGNER };
  const add = (name, type, schema, rest, owner, publicTransfer) => encode(name, type, schema, { id: id(nextId++), ...rest }, owner, publicTransfer);
  add('upgradeCap', `${SUI}::package::UpgradeCap`, B.upgradeCap, { package: PACKAGE, version: '1', policy: 0 }, address, true);
  const config = add('marketConfigV2', own('market', 'MarketConfigV2'), B.marketConfigV2, { version: '2', legacy_config_id: id(0), fee_recipient: SIGNER, platform_fee_bps: 250, primary_enabled: false, secondary_enabled: false }, shared, false);
  add('marketAdminCapV2', own('market', 'MarketAdminCapV2'), B.marketAdminCapV2, { config_id: config.id }, address, true);
  add('kioskRegistry', own('market', 'KioskRegistry'), B.kioskRegistry, { version: '1' }, shared, false);
  const kinds = add('kindRegistry', own('kind_registry', 'KindRegistry'), B.kindRegistry, { version: '1', next_kind: 16, kinds: { id: id(objectIdBase + 490), size: '5' }, name_to_kind: { id: id(objectIdBase + 491), size: '5' } }, shared, false);
  add('kindAdminCap', own('kind_registry', 'KindAdminCap'), B.kindAdminCap, {}, address, true);
  function dynamic(name, parent, keyType, keySchema, key, valueType, schema, value) {
    const objectId = deriveDynamicFieldID(parent, keyType, keySchema.serialize(key).toBytes());
    encode(name, `${SUI}::dynamic_field::Field<${keyType},${valueType}>`, schema, { id: objectId, name: key, value }, { kind: 'ObjectOwner', address: parent }, false);
  }
  for (const prefix of ['soul', 'collection']) {
    const soul = prefix === 'soul';
    const type = soul ? own('soul', 'Soul') : own('collection', 'SoulCollectionRight');
    const origins = args.kioskTypeOrigins;
    const rules = [`${origins.kioskLockRule}::kiosk_lock_rule::Rule`, `${origins.personalKioskRule}::personal_kiosk_rule::Rule`, `${origins.witnessRule}::witness_rule::Rule<${own('market', soul ? 'SoulMarketProof' : 'CollectionMarketProof')}>`];
    const policy = add(`${prefix}TransferPolicy`, `${SUI}::transfer_policy::TransferPolicy<${type}>`, B.policy,
      { balance: { value: '0' }, rules: { contents: rules.map(rule => ({ name: rule.replaceAll('0x', '') })) } }, shared, true);
    add(`${prefix}PolicyCap`, `${SUI}::transfer_policy::TransferPolicyCap<${type}>`, B.policyCap, { policy_id: policy.id }, address, true);
    const fields = ['name', 'description', 'image_url', 'creator', ...(soul ? ['link', 'project_url'] : [])];
    add(`${prefix}Display`, `${SUI}::display::Display<${type}>`, B.display, { version: 1, fields: { contents: fields.map(key => ({ key, value: `{${['link', 'project_url'].includes(key) ? 'origin_ref' : key}}` })) } }, address, true);
    rules.forEach((rule, i) => dynamic(`${prefix}Rule${i}`, policy.id, `${SUI}::transfer_policy::RuleKey<${rule}>`, empty, { dummy_field: false }, i === 0 ? `${origins.kioskLockConfig}::kiosk_lock_rule::Config` : 'bool', i === 0 ? B.lockRuleField : B.boolRuleField, i === 0 ? { dummy_field: false } : true));
  }
  ['soul_doc', 'memory', 'skill', 'sprite', 'audio'].forEach((name, kind) => {
    dynamic(`kind${kind}`, kinds.kinds.id, 'u32', bcs.u32(), kind, own('kind_registry', 'KindDescriptor'), B.descriptorField, {
      version: '1', kind, name, op_mask: String([0, 7, 7, 15, 15][kind]), read_mode_mask: kind < 3 ? '3' : '15', has_active_binding: kind >= 3,
      requires_download_policy: kind >= 3, default_grant_scope_mask: String([1, 2, 4, 8, 8][kind]), deprecated: false,
    });
    dynamic(`kindName${kind}`, kinds.name_to_kind.id, `${STD}::string::String`, bcs.string(), name, 'u32', B.nameField, kind);
  });
  // Append new init objects so existing fixture IDs remain stable.
  let tableId = objectIdBase + 492;
  const emptyTable = () => ({ id: id(tableId++), size: '0' });
  add('profileRegistry', own('profile', 'ProfileRegistryV1'), B.profileRegistry,
    { version: '1', profile_count: '0', by_owner: emptyTable(), by_handle: emptyTable(), by_index: emptyTable() }, shared, false);
  add('socialRegistry', own('social', 'SocialRegistryV1'), B.socialRegistry,
    { version: '1', counts: emptyTable(), edges: emptyTable() }, shared, false);
  add('communityRegistry', own('community_posts', 'CommunityRegistryV1'), B.communityRegistry,
    { version: '1', post_count: '0', by_index: emptyTable() }, shared, false);
  add('communityVoteRegistry', own('community_votes', 'VoteRegistryV1'), B.communityVoteRegistry,
    { version: '1', counts: emptyTable(), edges: emptyTable() }, shared, false);
  return { args, records, encode, mutate(name, fn) {
    const r = records.get(name); fn(r.value, r); encode(name, r.type, r.schema, r.value, r.owner, r.publicTransfer);
  } };
}
