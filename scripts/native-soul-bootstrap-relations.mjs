import { buildNativeSoulBootstrapTransaction } from './native-soul-bootstrap-transactions.mjs';
import { decodeNativeSoulBootstrapObject, NATIVE_SOUL_BOOTSTRAP_USDC_TYPE } from './native-soul-bootstrap-readback.mjs';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE } from '../maker-v8-seal-profile.js';

const ROLES = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const CONFIGS = ROLES.slice(1).map(role => `${role}Config`);
const OBJECTS = {
  INITIALIZE_PROTOCOL: ['protocol', 'protocolAdmin', 'protocolTreasury'],
  SETUP_RELEASE: ['protocol', 'protocolAdmin', 'catalog', ...CONFIGS, 'replacement',
    'bootstrapSlot', 'walrusPolicy', 'walrusPolicySlot', 'nativeSoulBinding', 'protocolCatalogSlot'],
  BEGIN_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapAdmin', 'bootstrapSlot'],
  FINALIZE_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapCertificate',
    'bootstrapSlot', 'outputConfig', 'marketConfig'],
};
function check(value, label) {
  if (!value) { const e = new Error(`Invalid native bootstrap relationship: ${label}`);
    e.code = 'NATIVE_SOUL_BOOTSTRAP_RELATION_INVALID'; throw e; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function hash(value, label) {
  check(Array.isArray(value) && value.length === 32 && value.some(n => n !== 0)
    && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255), label);
}
function hashEqual(a, b, label) { hash(a, label); hash(b, label); check(same(a, b), label); }
function id(value) { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'nonzero identity'); return value; }
function exactKeys(value, keys) {
  check(value && Object.getPrototypeOf(value) === Object.prototype
    && same(Object.keys(value).sort(), [...keys].sort()), 'exact object inventory');
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Relationship checks over exact typed object contents. They do not establish
 * historical object digests, package bytecode provenance, transaction finality,
 * write/deletion cardinality or readiness. The release runner must establish
 * those independently before using this decoded result to advance its WAL. */
export function validateNativeSoulBootstrapStageRelations({ stage, input, sender, objects }) {
  buildNativeSoulBootstrapTransaction(stage, input); // Same input validation as exact kind construction.
  id(sender); exactKeys(objects, OBJECTS[stage]);
  const decoded = Object.fromEntries(OBJECTS[stage].map(kind => [kind,
    decodeNativeSoulBootstrapObject(kind, objects[kind], input.packageIds)]));
  check(new Set(Object.values(decoded).map(row => row.id)).size === OBJECTS[stage].length, 'object identity collision');
  const p = decoded.protocol, a = decoded.protocolAdmin, packageIds = input.packageIds;
  check(p.id === input.protocolConfig.objectId && objects.protocol.owner.initialSharedVersion === input.protocolConfig.initialSharedVersion
    && p.version === '8' && p.core_original_package_id === packageIds.core && p.core_callable_package_id === packageIds.core,
  'protocol source');
  check(a.id === input.protocolAdminCap.objectId && a.version === '8' && a.config_id === p.id
    && objects.protocolAdmin.owner.address === sender, 'protocol admin');
  check(p.enabled && p.revision === '2' && p.treasury_id !== null
    && p.payment_coin_type === NATIVE_SOUL_BOOTSTRAP_USDC_TYPE && p.primary_content_fee_bps === 1000
    && p.fixed_complete_fee_atomic === '0' && p.maker_market_fee_bps === 250 && p.soul_market_fee_bps === 250,
  'fresh initialized protocol terms'); hash(p.commitment, 'protocol commitment');
  if (stage === 'INITIALIZE_PROTOCOL') {
    const t = decoded.protocolTreasury;
    check(t.id === p.treasury_id && t.version === '8' && t.config_id === p.id
      && t.revenue.value === '0' && t.total_collected === '0' && t.total_withdrawn === '0', 'fresh treasury');
    return freeze(decoded);
  }
  const c = decoded.catalog, r = decoded.replacement, slot = decoded.bootstrapSlot.value;
  check(c.schema_revision === '2' && c.protocol_config_id === p.id && c.protocol_config_revision === p.revision
    && c.binding.bindings.length === 7 && c.authority_ids.length === 6 && c.next_setup_role === 6
    && c.role_config_ids.length === 6 && c.role_config_commitments.length === 6, 'complete catalog shape');
  hashEqual(c.protocol_config_commitment, p.commitment, 'catalog protocol commitment');
  hash(c.binding.commitment, 'package tuple'); hash(c.call_cap_set_commitment, 'call cap set'); hash(c.catalog_commitment, 'catalog commitment');
  check(new Set(c.authority_ids.map(id)).size === 6 && new Set(c.role_config_ids.map(id)).size === 6, 'unique authorities/configs');
  c.role_config_commitments.forEach(h => hash(h, 'installed config commitment'));
  ROLES.forEach((role, index) => {
    const binding = c.binding.bindings[index];
    check(binding.original_package_id === packageIds[role] && binding.callable_package_id === packageIds[role], 'fresh catalog role identity');
    ['source_commitment', 'package_commitment', 'abi_commitment', 'commitment'].forEach(key => hash(binding[key], 'role commitment'));
    if (stage === 'SETUP_RELEASE') for (const key of ['source', 'package', 'abi']) {
      check(Buffer.from(binding[`${key}_commitment`]).toString('hex') === input.commitments[role][key], 'role matches prepared artifact');
    }
  });
  check(r.version === '2' && r.catalog_id === c.id, 'replacement catalog');
  hashEqual(r.package_tuple_commitment, c.binding.commitment, 'replacement tuple');
  hashEqual(r.call_cap_set_commitment, c.call_cap_set_commitment, 'replacement cap set');
  hash(r.binding_commitment, 'replacement commitment');
  ROLES.forEach((role, index) => hashEqual(r[`${role}_binding_commitment`], c.binding.bindings[index].commitment, 'replacement role'));
  ['runtime', 'output', 'market', 'release'].forEach(role => check(r[`${role}_config_id`] === c.role_config_ids[ROLES.indexOf(role) - 1], 'replacement config'));
  check(objects.bootstrapSlot.owner.objectId === c.id && slot.replacement_binding_id === r.id, 'bootstrap slot parent/binding');
  if (stage !== 'SETUP_RELEASE') {
    check(c.id === input.catalog.objectId && objects.catalog.owner.initialSharedVersion === input.catalog.initialSharedVersion
      && r.id === input.replacement.objectId, 'exact prior stage objects');
  }
  for (const role of ROLES.slice(1)) {
    const config = decoded[`${role}Config`]; if (!config) continue;
    check(config.version === '8' && config.catalog_id === c.id
      && config.id === c.role_config_ids[ROLES.indexOf(role) - 1], 'installed config identity');
    hashEqual(config.product_binding_commitment, c.binding.commitment, 'config tuple');
    const installation = role === 'seal' ? config.config_commitment : config.installation_commitment;
    hashEqual(installation, c.role_config_commitments[ROLES.indexOf(role) - 1], 'config install');
    if ('call_cap_set_commitment' in config) hashEqual(config.call_cap_set_commitment, c.call_cap_set_commitment, 'config cap set');
    if ('runtime_caller_cap' in config && stage !== 'FINALIZE_BOOTSTRAP') check(config.runtime_caller_cap === null, 'caller not yet installed');
  }
  if (stage === 'SETUP_RELEASE') {
    check(slot.state === 0 && slot.admin_id === null && slot.certificate_id === null && slot.certificate_commitment === null, 'sealed bootstrap state');
    const policy = decoded.walrusPolicy, policySlot = decoded.walrusPolicySlot;
    check(policy.version === '1' && policy.catalog_id === c.id && policy.system_id === input.walrusSystem.objectId
      && objects.walrusPolicySlot.owner.objectId === c.id && policySlot.value.policy_id === policy.id
      && policySlot.value.system_id === policy.system_id, 'Walrus policy binding');
    hashEqual(policy.package_tuple_commitment, c.binding.commitment, 'Walrus policy tuple'); hash(policy.commitment, 'Walrus policy commitment');
    check(objects.protocolCatalogSlot.owner.objectId === p.id && decoded.protocolCatalogSlot.value.catalog_id === c.id, 'protocol catalog claim');
    const native = decoded.nativeSoulBinding.value;
    check(objects.nativeSoulBinding.owner.objectId === p.id && native.config_id === p.id, 'native binding parent');
    for (const [prefix, suffix] of [['soul', 'soul::Soul'], ['mint', 'animacraft_v8_binding::MintBindingWitnessV8'], ['owner', 'animacraft_v8_binding::SoulOwnerWitnessV8']]) {
      for (const origin of ['original', 'defining']) check(native[`${prefix}_${origin}`].name === `${packageIds.soulidity.slice(2)}::${suffix}`, 'exact fresh native type identity');
    }
    const s = decoded.sealConfig;
    check(s.protocol_config_id === p.id && s.protocol_config_revision === p.revision
      && s.seal_original_package_id === packageIds.seal && s.seal_callable_package_id === packageIds.seal
      && s.seal_authority_id === c.authority_ids[0] && s.role === 1 && s.finalized,
    'Seal authority');
    hashEqual(s.seal_binding_commitment, c.binding.bindings[1].commitment, 'Seal role binding');
    check(same(s.key_servers, input.sealPolicy.keyServers.map(row => ({ key_server_id: row.objectId, weight: Number(row.weight) })))
      && s.threshold === Number(input.sealPolicy.threshold)
      && s.cipher_suite === MAKER_V8_SEAL_ENCRYPTION_PROFILE.cipherSuite
      && s.key_derivation === MAKER_V8_SEAL_ENCRYPTION_PROFILE.keyDerivation
      && s.ciphertext_format === MAKER_V8_SEAL_ENCRYPTION_PROFILE.ciphertextFormat
      && s.max_plaintext_bytes === '3145728', 'Seal exact prepared profile');
    for (const key of ['key_server_set_commitment', 'encryption_policy_commitment', 'commitment']) hash(s[key], 'Seal policy commitment');
  } else if (stage === 'BEGIN_BOOTSTRAP') {
    const admin = decoded.bootstrapAdmin;
    check(admin.version === '2' && admin.protocol_admin_id === a.id && admin.replacement_binding_id === r.id
      && admin.catalog_id === c.id && objects.bootstrapAdmin.owner.address === sender
      && !admin.caps_minted && admin.install_mask === 0 && admin.install_mark_commitments.length === 0,
    'fresh owned bootstrap admin');
    hashEqual(admin.package_tuple_commitment, c.binding.commitment, 'bootstrap admin tuple');
    hashEqual(admin.call_cap_set_commitment, c.call_cap_set_commitment, 'bootstrap admin cap set');
    hash(admin.bootstrap_commitment, 'bootstrap admin commitment');
    check(slot.state === 1 && slot.admin_id === admin.id && slot.certificate_id === null && slot.certificate_commitment === null, 'in-progress bootstrap slot');
  } else {
    const certificate = decoded.bootstrapCertificate;
    check(certificate.version === '2' && certificate.replacement_binding_id === r.id && certificate.catalog_id === c.id
      && certificate.install_mask === 12 && certificate.install_mark_commitments.length === 2, 'final certificate');
    hashEqual(certificate.package_tuple_commitment, c.binding.commitment, 'certificate tuple');
    hashEqual(certificate.call_cap_set_commitment, c.call_cap_set_commitment, 'certificate cap set');
    certificate.install_mark_commitments.forEach(h => hash(h, 'install mark'));
    check(slot.state === 2 && slot.admin_id === null && slot.certificate_id === certificate.id, 'certified bootstrap slot');
    hashEqual(slot.certificate_commitment, certificate.certificate_commitment, 'slot certificate commitment');
    ['output', 'market'].forEach((role, index) => {
      const config = decoded[`${role}Config`], cap = config.runtime_caller_cap;
      check(config.id === input[`${role}Config`].objectId
        && objects[`${role}Config`].owner.initialSharedVersion === input[`${role}Config`].initialSharedVersion,
      'exact installed caller config');
      check(cap && cap.schema_revision === '2' && cap.role === index && cap.catalog_id === c.id
        && cap.replacement_binding_id === r.id && cap.caller_original_package_id === packageIds[role]
        && cap.caller_callable_package_id === packageIds[role], 'exact caller role');
      hashEqual(cap.package_tuple_commitment, c.binding.commitment, 'caller tuple');
      hashEqual(cap.call_cap_set_commitment, c.call_cap_set_commitment, 'caller cap set'); hash(cap.cap_commitment, 'caller commitment');
    });
  }
  return freeze(decoded);
}
