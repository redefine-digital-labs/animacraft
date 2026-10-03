import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, fromBase58, fromBase64, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils';

// These layouts are the fresh Soulidity init, not an acceptance of historical
// configuration families. No network, signing, finality or package-ABI claim.
const A = bcs.Address;
const table = bcs.struct('Table', { id: A, size: bcs.u64() });
const empty = bcs.struct('Empty', { dummy_field: bcs.bool() });
const descriptor = bcs.struct('KindDescriptor', {
  version: bcs.u64(), kind: bcs.u32(), name: bcs.string(), op_mask: bcs.u64(),
  read_mode_mask: bcs.u64(), has_active_binding: bcs.bool(), requires_download_policy: bcs.bool(),
  default_grant_scope_mask: bcs.u64(), deprecated: bcs.bool(),
});
const field = (name, value) => bcs.struct('Field', { id: A, name, value });
export const NativeSoulPublicationBcs = Object.freeze({
  upgradeCap: bcs.struct('UpgradeCap', { id: A, package: A, version: bcs.u64(), policy: bcs.u8() }),
  marketConfigV2: bcs.struct('MarketConfigV2', { id: A, version: bcs.u64(), legacy_config_id: A,
    fee_recipient: A, platform_fee_bps: bcs.u16(), primary_enabled: bcs.bool(), secondary_enabled: bcs.bool() }),
  marketAdminCapV2: bcs.struct('MarketAdminCapV2', { id: A, config_id: A }),
  kioskRegistry: bcs.struct('KioskRegistry', { id: A, version: bcs.u64() }),
  kindRegistry: bcs.struct('KindRegistry', { id: A, version: bcs.u64(), next_kind: bcs.u32(),
    kinds: table, name_to_kind: table }),
  kindAdminCap: bcs.struct('KindAdminCap', { id: A }),
  profileRegistry: bcs.struct('ProfileRegistryV1', { id: A, version: bcs.u64(), profile_count: bcs.u64(),
    by_owner: table, by_handle: table, by_index: table }),
  socialRegistry: bcs.struct('SocialRegistryV1', { id: A, version: bcs.u64(), counts: table, edges: table }),
  communityRegistry: bcs.struct('CommunityRegistryV1', { id: A, version: bcs.u64(), post_count: bcs.u64(), by_index: table }),
  communityVoteRegistry: bcs.struct('VoteRegistryV1', { id: A, version: bcs.u64(), counts: table, edges: table }),
  policy: bcs.struct('TransferPolicy', { id: A, balance: bcs.struct('Balance', { value: bcs.u64() }),
    rules: bcs.struct('VecSet', { contents: bcs.vector(bcs.struct('TypeName', { name: bcs.string() })) }) }),
  policyCap: bcs.struct('TransferPolicyCap', { id: A, policy_id: A }),
  display: bcs.struct('Display', { id: A,
    fields: bcs.struct('VecMap', { contents: bcs.vector(bcs.struct('Entry', { key: bcs.string(), value: bcs.string() })) }),
    version: bcs.u16() }),
  descriptorField: field(bcs.u32(), descriptor), nameField: field(bcs.string(), bcs.u32()),
  lockRuleField: field(empty, empty), boolRuleField: field(empty, bcs.bool()),
});

const ZERO = `0x${'0'.repeat(64)}`;
const SUI = `0x${'2'.padStart(64, '0')}`;
const STD = `0x${'1'.padStart(64, '0')}`;
const MAX_BYTES = 1024 * 1024;
const fail = message => { const error = new Error(message); error.code = 'NATIVE_SOUL_PUBLICATION_OUTPUT_INVALID'; throw error; };
const check = (condition, message) => { if (!condition) fail(message); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sameBytes = (a, b) => Buffer.from(a).equals(Buffer.from(b));
function keys(value, expected, label) {
  check(plain(value) && equal(Object.keys(value).sort(), [...expected].sort()), `${label}: exact fields required`);
}
function id(value, label) {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value !== ZERO, `${label}: canonical nonzero ID required`);
  return value;
}
function decimal(value, label) {
  check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 18446744073709551615n, `${label}: positive u64 required`);
  return value;
}
function digest(value, label) {
  try { check(typeof value === 'string' && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, `${label}: digest required`); }
  catch { fail(`${label}: digest required`); }
}
function bytes(value, hash, label) {
  check(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(MAX_BYTES / 3) * 4, `${label}: bounded BCS required`);
  let result;
  try { result = fromBase64(value); } catch { fail(`${label}: invalid base64`); }
  check(toBase64(result) === value && result.length <= MAX_BYTES && sha(result) === hash, `${label}: canonical bytes/hash mismatch`);
  return result;
}
function parse(schema, raw, label) {
  try {
    const result = schema.parse(raw);
    check(sameBytes(schema.serialize(result, { maxSize: MAX_BYTES }).toBytes(), raw), `${label}: noncanonical BCS`);
    return result;
  } catch { fail(`${label}: canonical BCS layout required`); }
}
function tag(value) {
  check(typeof value === 'string' && value.length <= 8192 && !/\s/.test(value), 'Invalid Move type');
  try { return normalizeStructTag(value); } catch { fail('Invalid Move type'); }
}
function canonicalOwner(value) {
  if (value?.kind === 'Immutable') { keys(value, ['kind'], 'effect owner'); return { Immutable: true }; }
  if (value?.kind === 'AddressOwner' || value?.kind === 'ObjectOwner') {
    keys(value, ['kind', 'address'], 'effect owner'); return { [value.kind]: id(value.address, 'effect owner') };
  }
  if (value?.kind === 'Shared') {
    keys(value, ['kind', 'initialSharedVersion'], 'effect owner');
    return { Shared: { initial_shared_version: decimal(value.initialSharedVersion, 'shared version') } };
  }
  fail('Unsupported effect owner');
}
function rawOwner(value) {
  if (value.$kind === 'Immutable') return { Immutable: true };
  if (value.$kind === 'AddressOwner') return { AddressOwner: value.AddressOwner };
  if (value.$kind === 'ObjectOwner') return { ObjectOwner: value.ObjectOwner };
  if (value.$kind === 'Shared') return { Shared: { initial_shared_version: String(value.Shared.initialSharedVersion) } };
  fail('Unsupported Object BCS owner');
}

/** Pure structural/initial-state proof. `created` MUST be all 33 business CREATED
 * references from the already verified publish effects. The caller separately
 * rejects non-creation effects (except its exact verified gas input) and proves
 * package bytecode/linkage/finality. Kiosk origins come from that exact linkage,
 * never ambient SDK defaults. JSON `fields` is retained evidence, not authority;
 * every decision and returned ID below is derived from canonical Object/content BCS.
 */
export function verifyNativeSoulPublicationOutputs({ packageId, signer, kioskTypeOrigins, created, moveOutputs }) {
  id(packageId, 'packageId'); id(signer, 'signer');
  keys(kioskTypeOrigins, ['kioskLockRule', 'kioskLockConfig', 'personalKioskRule', 'witnessRule'], 'Kiosk TypeOrigins');
  Object.values(kioskTypeOrigins).forEach(value => id(value, 'Kiosk TypeOrigin'));
  check(Array.isArray(created) && created.length === 33 && Array.isArray(moveOutputs) && moveOutputs.length === 32, 'Expected exact fresh init inventory: package 1 + Move objects 32');
  const effects = new Map();
  for (const row of created) {
    keys(row, ['operation', 'objectId', 'version', 'digest', 'owner'], 'created effect');
    check(row.operation === 'CREATED', 'Non-created effect is not a fresh init output');
    id(row.objectId, 'created ID'); decimal(row.version, 'created version'); digest(row.digest, 'created digest');
    check(!effects.has(row.objectId), 'Duplicate created ID');
    const owner = canonicalOwner(row.owner);
    if (owner.Shared) check(owner.Shared.initial_shared_version === row.version, 'Fresh shared version differs from creation version');
    effects.set(row.objectId, { row, owner });
  }
  const packageEffect = effects.get(packageId);
  check(packageEffect && equal(packageEffect.owner, { Immutable: true }) && packageEffect.row.version === '1', 'Fresh immutable package effect missing');
  effects.delete(packageId);
  const inventory = new Map();
  let previousTransaction;
  for (const output of moveOutputs) {
    keys(output, ['reference', 'type', 'owner', 'previousTransaction', 'fields', 'contentBcsBase64', 'contentBcsSha256', 'objectBcsBase64', 'objectBcsSha256'], 'Move output');
    keys(output.reference, ['objectId', 'version', 'digest'], 'Move reference');
    const ref = output.reference;
    const effect = effects.get(ref.objectId);
    check(effect && !inventory.has(ref.objectId) && ref.version === effect.row.version && ref.digest === effect.row.digest && equal(output.owner, effect.owner), 'Move output differs from unique effect reference/owner');
    digest(output.previousTransaction, 'previousTransaction');
    previousTransaction ??= output.previousTransaction;
    check(previousTransaction === output.previousTransaction, 'Init outputs belong to different transactions');
    const content = bytes(output.contentBcsBase64, output.contentBcsSha256, 'Move contents');
    const objectBytes = bytes(output.objectBcsBase64, output.objectBcsSha256, 'Object');
    const object = parse(bcs.Object, objectBytes, 'Object');
    const typedDigest = toBase58(blake2b(Buffer.concat([Buffer.from('Object::'), Buffer.from(objectBytes)]), { dkLen: 32 }));
    check(typedDigest === ref.digest && object.data.$kind === 'Move' && object.previousTransaction === output.previousTransaction && equal(rawOwner(object.owner), output.owner), 'Object BCS reference/transaction/owner mismatch');
    const move = object.data.Move;
    check(move.type.$kind === 'Other' && String(move.version) === ref.version && sameBytes(move.contents, content), 'Object BCS version/content mismatch');
    check(tag(TypeTagSerializer.tagToString({ struct: move.type.Other }).replaceAll(' ', '')) === tag(output.type), 'Object BCS type mismatch');
    check(`0x${Buffer.from(content.subarray(0, 32)).toString('hex')}` === ref.objectId, 'Content UID mismatch');
    inventory.set(ref.objectId, { output, type: tag(output.type), content, publicTransfer: move.hasPublicTransfer });
  }
  check(inventory.size === effects.size, 'Missing Move output');
  const objects = {}; const decoded = {}; const ids = {};
  const ownType = (module, name) => `${packageId}::${module}::${name}`;
  function take(name, type, schema, ownerKind, publicTransfer) {
    const matches = [...inventory].filter(([, row]) => row.type === tag(type));
    check(matches.length === 1, `${name}: expected one exact type`);
    const [objectId, row] = matches[0];
    const owner = row.output.owner;
    check(ownerKind === 'shared' ? Boolean(owner.Shared) : ownerKind === 'address' ? owner.AddressOwner === signer : owner.ObjectOwner === ownerKind, `${name}: unexpected owner`);
    check(row.publicTransfer === publicTransfer, `${name}: wrong public-transfer ability`);
    const value = parse(schema, row.content, name);
    objects[name] = row.output; decoded[name] = value; ids[`${name}Id`] = objectId;
    inventory.delete(objectId);
    return value;
  }
  const B = NativeSoulPublicationBcs;
  const upgrade = take('upgradeCap', `${SUI}::package::UpgradeCap`, B.upgradeCap, 'address', true);
  check(upgrade.package === packageId && upgrade.version === '1' && upgrade.policy === 0, 'UpgradeCap is not fresh compatible authority for this package');
  const config = take('marketConfigV2', ownType('market', 'MarketConfigV2'), B.marketConfigV2, 'shared', false);
  check(config.version === '2' && config.legacy_config_id === ZERO && config.fee_recipient === signer && config.platform_fee_bps === 250 && !config.primary_enabled && !config.secondary_enabled, 'MarketConfigV2 is not the disabled fresh configuration');
  const admin = take('marketAdminCapV2', ownType('market', 'MarketAdminCapV2'), B.marketAdminCapV2, 'address', true);
  check(admin.config_id === config.id, 'Market admin controls another config');
  const registry = take('kioskRegistry', ownType('market', 'KioskRegistry'), B.kioskRegistry, 'shared', false);
  check(registry.version === '1', 'KioskRegistry version mismatch');
  const kinds = take('kindRegistry', ownType('kind_registry', 'KindRegistry'), B.kindRegistry, 'shared', false);
  take('kindAdminCap', ownType('kind_registry', 'KindAdminCap'), B.kindAdminCap, 'address', true);
  check(kinds.version === '1' && kinds.next_kind === 16 && kinds.kinds.size === '5' && kinds.name_to_kind.size === '5', 'KindRegistry initial counters mismatch');
  // Embedded Table UIDs are not separate CREATED effects, but must be globally
  // distinct from every output, the package, and all other embedded tables.
  const occupiedIds = new Set([packageId, ...effects.keys()]);
  function embeddedTable(value, label, size) {
    id(value.id, `${label} table`);
    check(value.size === size, `${label}: initial table size mismatch`);
    check(!occupiedIds.has(value.id), 'Embedded tables have conflicting UIDs');
    occupiedIds.add(value.id);
  }
  embeddedTable(kinds.kinds, 'kindRegistry.kinds', '5');
  embeddedTable(kinds.name_to_kind, 'kindRegistry.name_to_kind', '5');
  for (const [name, module, struct, tables, counter] of [
    ['profileRegistry', 'profile', 'ProfileRegistryV1', ['by_owner', 'by_handle', 'by_index'], 'profile_count'],
    ['socialRegistry', 'social', 'SocialRegistryV1', ['counts', 'edges']],
    ['communityRegistry', 'community_posts', 'CommunityRegistryV1', ['by_index'], 'post_count'],
    ['communityVoteRegistry', 'community_votes', 'VoteRegistryV1', ['counts', 'edges']],
  ]) {
    const value = take(name, ownType(module, struct), B[name], 'shared', false);
    check(value.version === '1' && (!counter || value[counter] === '0'), `${name}: initial version/counter mismatch`);
    for (const key of tables) embeddedTable(value[key], `${name}.${key}`, '0');
  }
  const types = [ownType('soul', 'Soul'), ownType('collection', 'SoulCollectionRight')];
  const lock = `${kioskTypeOrigins.kioskLockRule}::kiosk_lock_rule::Rule`;
  const lockConfig = `${kioskTypeOrigins.kioskLockConfig}::kiosk_lock_rule::Config`;
  const personal = `${kioskTypeOrigins.personalKioskRule}::personal_kiosk_rule::Rule`;
  function dynamic(name, parent, keyType, keySchema, key, valueType, schema) {
    const expected = deriveDynamicFieldID(parent, keyType, keySchema.serialize(key).toBytes());
    const row = inventory.get(expected);
    check(row && row.type === tag(`${SUI}::dynamic_field::Field<${keyType},${valueType}>`), `${name}: derived field ID/type mismatch`);
    // Different parents can have fields of the same type, so select by derived ID.
    check(row.output.owner.ObjectOwner === parent && !row.publicTransfer, `${name}: field owner/ability mismatch`);
    const value = parse(schema, row.content, name);
    check(value.id === expected && equal(value.name, key), `${name}: field key mismatch`);
    inventory.delete(expected); objects[name] = row.output; decoded[name] = value; ids[`${name}Id`] = expected;
    return value.value;
  }
  for (const [index, prefix] of ['soul', 'collection'].entries()) {
    const proof = ownType('market', index === 0 ? 'SoulMarketProof' : 'CollectionMarketProof');
    const rules = [lock, personal, `${kioskTypeOrigins.witnessRule}::witness_rule::Rule<${proof}>`];
    const policy = take(`${prefix}TransferPolicy`, `${SUI}::transfer_policy::TransferPolicy<${types[index]}>`, B.policy, 'shared', true);
    check(policy.balance.value === '0' && equal(policy.rules.contents.map(row => row.name), rules.map(rule => rule.replaceAll('0x', ''))), `${prefix}: exact ordered initial policy rules/balance mismatch`);
    const cap = take(`${prefix}PolicyCap`, `${SUI}::transfer_policy::TransferPolicyCap<${types[index]}>`, B.policyCap, 'address', true);
    check(cap.policy_id === policy.id, `${prefix}: cap policy mismatch`);
    const display = take(`${prefix}Display`, `${SUI}::display::Display<${types[index]}>`, B.display, 'address', true);
    const displayKeys = ['name', 'description', 'image_url', 'creator', ...(index === 0 ? ['link', 'project_url'] : [])];
    check(display.version === 1 && equal(display.fields.contents, displayKeys.map(key => ({ key, value: `{${['link', 'project_url'].includes(key) ? 'origin_ref' : key}}` }))), `${prefix}: initial display mismatch`);
    for (const [ruleIndex, rule] of rules.entries()) {
      const value = dynamic(`${prefix}Rule${ruleIndex}`, policy.id, `${SUI}::transfer_policy::RuleKey<${rule}>`, empty, { dummy_field: false }, ruleIndex === 0 ? lockConfig : 'bool', ruleIndex === 0 ? B.lockRuleField : B.boolRuleField);
      check(ruleIndex === 0 ? equal(value, { dummy_field: false }) : value === true, `${prefix}: initial rule config mismatch`);
    }
  }
  const names = ['soul_doc', 'memory', 'skill', 'sprite', 'audio'];
  for (const [kind, name] of names.entries()) {
    const value = dynamic(`kind${kind}`, kinds.kinds.id, 'u32', bcs.u32(), kind, ownType('kind_registry', 'KindDescriptor'), B.descriptorField);
    check(equal(value, { version: '1', kind, name, op_mask: String([0, 7, 7, 15, 15][kind]), read_mode_mask: kind < 3 ? '3' : '15', has_active_binding: kind >= 3, requires_download_policy: kind >= 3, default_grant_scope_mask: String([1, 2, 4, 8, 8][kind]), deprecated: false }), `kind ${kind}: built-in descriptor mismatch`);
    check(dynamic(`kindName${kind}`, kinds.name_to_kind.id, `${STD}::string::String`, bcs.string(), name, 'u32', B.nameField) === kind, `kind ${kind}: name index mismatch`);
  }
  check(inventory.size === 0, 'Unexpected init output remains');
  return Object.freeze({ schema: 'native-soul-publication-outputs-v1', packageId, ids: Object.freeze(ids), objects: Object.freeze(objects), decoded: Object.freeze(decoded) });
}
