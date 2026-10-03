import { deriveDynamicFieldID, normalizeStructTag, toBase64, toBase58 } from '@mysten/sui/utils';
import { MAINNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';
import { bcs } from '@mysten/sui/bcs';
import { createHash } from 'node:crypto';
import { NativeSoulBootstrapBcs as B, NATIVE_SOUL_BOOTSTRAP_USDC_TYPE as USDC } from '../../scripts/native-soul-bootstrap-readback.mjs';
import { buildMainnetV8SealPolicyTemplate, buildMainnetV8FinalSealPolicy, MAINNET_V8_DEFAULT_COMMITTEE } from '../../scripts/mainnet-v8-release-lib.mjs';
import { MAKER_V8_SEAL_ENCRYPTION_PROFILE as PROFILE } from '../../maker-v8-seal-profile.js';
import { makerV8WalrusExecutionFixture } from './walrus-execution-fixture.js';

export const bootstrapId = n => `0x${n.toString(16).padStart(64, '0')}`;
export const bootstrapHash = n => Array(32).fill(n);
export const bootstrapStages = ['INITIALIZE_PROTOCOL', 'SETUP_RELEASE', 'BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'];
const roles = ['core', 'seal', 'runtime', 'output', 'physical', 'market', 'release'];
const id = bootstrapId, hash = bootstrapHash;
// Independent exact Move ProtocolConfigCommitmentInputV2 preimage. Its schema
// revision is the actual Protocol VERSION (8), not the V2 name suffix.
const ProtocolCommitmentInput = bcs.struct('FixtureProtocolConfigCommitmentInputV2', {
  domain: bcs.string(), schema_revision: bcs.u64(), config_id: bcs.Address,
  config_revision: bcs.u64(), enabled: bcs.bool(), core_original_package_id: bcs.Address,
  core_callable_package_id: bcs.Address, treasury_id: bcs.option(bcs.Address), payment_coin_type: bcs.string(),
  primary_content_fee_bps: bcs.u16(), fixed_complete_fee_atomic: bcs.u64(), maker_market_fee_bps: bcs.u16(), soul_market_fee_bps: bcs.u16(),
});
export function bootstrapProtocolCommitment(fields) {
  return [...createHash('sha256').update(ProtocolCommitmentInput.serialize({
    domain: 'animacraft-fresh-v8/core/protocol-config/v2', schema_revision: '8', config_id: fields.id,
    config_revision: fields.revision, enabled: fields.enabled,
    core_original_package_id: fields.core_original_package_id, core_callable_package_id: fields.core_callable_package_id,
    treasury_id: fields.treasury_id, payment_coin_type: fields.payment_coin_type,
    primary_content_fee_bps: fields.primary_content_fee_bps, fixed_complete_fee_atomic: fields.fixed_complete_fee_atomic,
    maker_market_fee_bps: fields.maker_market_fee_bps, soul_market_fee_bps: fields.soul_market_fee_bps,
  }).toBytes()).digest()];
}
// Independent package_binding_v8 V2 preimages. Named seven-role/six-authority
// fields are expanded in Move declaration order, not serialized as vectors.
const V = bcs.vector(bcs.u8());
const header = { domain: bcs.string(), schema_revision: bcs.u64() };
const roleHashes = Object.fromEntries(roles.map(role => [`${role}_binding_commitment`, V]));
const authorityShape = Object.fromEntries(roles.slice(1).map(role => [`${role}_authority_id`, bcs.Address]));
const bindingInput = { role: bcs.u8(), original_package_id: bcs.Address, callable_package_id: bcs.Address,
  source_commitment: V, package_commitment: V, abi_commitment: V };
function catalogHash(shape, fields, domain) {
  return [...createHash('sha256').update(bcs.struct('FixtureCatalogCommitmentInputV2', { ...header, ...shape })
    .serialize({ domain, schema_revision: '2', ...fields }).toBytes()).digest()];
}
// Independent actual seal_v8.move V2 preimages. Installation/capability hashes
// below remain explicit synthetic subproofs; these three policy hashes do not.
export function bootstrapSealCommitments(fields) {
  const s = structuredClone(fields);
  s.key_server_set_commitment = catalogHash({ ordered_key_servers: bcs.vector(bcs.struct('FixtureKeyServerRowV2', {
    key_server_id: bcs.Address, weight: bcs.u16() })), threshold: bcs.u16() },
  { ordered_key_servers: s.key_servers, threshold: s.threshold }, 'animacraft-fresh-v8/seal/key-server-set/v2');
  s.encryption_policy_commitment = catalogHash({ cipher_suite: bcs.string(), key_derivation: bcs.string(),
    ciphertext_format: bcs.string(), max_plaintext_bytes: bcs.u64() },
  { cipher_suite: s.cipher_suite, key_derivation: s.key_derivation, ciphertext_format: s.ciphertext_format,
    max_plaintext_bytes: s.max_plaintext_bytes }, 'animacraft-fresh-v8/seal/encryption-policy/v2');
  s.commitment = catalogHash({ policy_id: bcs.Address, catalog_id: bcs.Address, package_tuple_commitment: V,
    call_cap_set_commitment: V, key_server_set_commitment: V, encryption_policy_commitment: V },
  { policy_id: s.id, catalog_id: s.catalog_id, package_tuple_commitment: s.product_binding_commitment,
    call_cap_set_commitment: s.call_cap_set_commitment, key_server_set_commitment: s.key_server_set_commitment,
    encryption_policy_commitment: s.encryption_policy_commitment }, 'animacraft-fresh-v8/seal/policy/v2');
  return s;
}
export function bootstrapCatalogCommitments(catalogFields) {
  const catalog = structuredClone(catalogFields);
  if (catalog.binding.bindings.length !== 7 || catalog.authority_ids.length !== 6) throw new Error('Fixture requires seven bindings and six authorities');
  catalog.binding.bindings = catalog.binding.bindings.map((binding, role) => ({ ...binding,
    commitment: catalogHash(bindingInput, { role, ...binding }, 'animacraft-fresh-v8/package/exact-binding/v2') }));
  const bindings = catalog.binding.bindings;
  const hashes = Object.fromEntries(roles.map((role, i) => [`${role}_binding_commitment`, bindings[i].commitment]));
  const authorities = Object.fromEntries(roles.slice(1).map((role, i) => [`${role}_authority_id`, catalog.authority_ids[i]]));
  const capSet = catalogHash({ catalog_id: bcs.Address, ...roleHashes, ...authorityShape },
    { catalog_id: catalog.id, ...hashes, ...authorities }, 'animacraft-fresh-v8/package/call-cap-set/v2');
  const tuple = catalogHash({ catalog_id: bcs.Address, native_capability_mask: bcs.u64(), call_cap_set_commitment: V,
    ...Object.fromEntries(roles.map(role => [`${role}_binding`, V])) },
  { catalog_id: catalog.id, native_capability_mask: '127', call_cap_set_commitment: capSet,
    ...Object.fromEntries(roles.map((role, i) => [`${role}_binding`, bindings[i].commitment])) }, 'animacraft-fresh-v8/package/product-tuple/v2');
  const commitment = catalogHash({ catalog_id: bcs.Address, protocol_config_id: bcs.Address,
    protocol_config_revision: bcs.u64(), protocol_config_commitment: V, package_tuple_commitment: V,
    call_cap_set_commitment: V, native_capability_mask: bcs.u64(), ...authorityShape },
  { catalog_id: catalog.id, protocol_config_id: catalog.protocol_config_id,
    protocol_config_revision: catalog.protocol_config_revision, protocol_config_commitment: catalog.protocol_config_commitment,
    package_tuple_commitment: tuple, call_cap_set_commitment: capSet, native_capability_mask: '127', ...authorities },
  'animacraft-fresh-v8/core/catalog/v2');
  catalog.binding.commitment = tuple; catalog.call_cap_set_commitment = capSet; catalog.catalog_commitment = commitment;
  return catalog;
}
const shared = objectId => ({ objectId, initialSharedVersion: '7' });
const owned = objectId => ({ objectId, version: '9', digest: toBase58(new Uint8Array(32).fill(9)) });
const dynamic = {
  bootstrapSlot: ['package_binding_v8', 'FreshTupleBootstrapSlotKeyV2', 'FreshTupleBootstrapSlotV2'],
  walrusPolicySlot: ['core_v8', 'WalrusCertificationBootstrapKeyV1', 'WalrusCertificationBootstrapSlotV1'],
  nativeSoulBinding: ['protocol_config_v8', 'SoulidityBindingSlotKeyV8', 'SoulidityBindingV8'],
  protocolCatalogSlot: ['protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2', 'ProductReleaseCatalogSlotV2'],
};

// Encoded structural relationship fixtures, not package/finality/hash attestations.
// The codec's separate source-schema tests check these wire layouts against Move.
export function nativeSoulBootstrapFixture(stage, { commitments: suppliedCommitments } = {}) {
  const packageIds = Object.fromEntries([...roles, 'soulidity'].map((r, i) => [r, id(11 + i)]));
  const sender = id(900), protocolId = id(100), catalogId = id(102);
  const input = { packageIds, protocolConfig: shared(protocolId), protocolAdminCap: owned(id(101)) };
  const commitments = suppliedCommitments ? structuredClone(suppliedCommitments) : Object.fromEntries(roles.map((r, i) => [r, Object.fromEntries(
    ['source', 'package', 'abi'].map((k, j) => [k, Buffer.from(hash(i * 3 + j + 1)).toString('hex')]))]));
  const sealPolicy = buildMainnetV8FinalSealPolicy({ template: buildMainnetV8SealPolicyTemplate({
    keyServers: [{ objectId: MAINNET_V8_DEFAULT_COMMITTEE, weight: '1' }], threshold: '1' }),
    sealPackageCommitment: commitments.seal.package, sealAbiCommitment: commitments.seal.abi });
  if (stage === 'SETUP_RELEASE') Object.assign(input, { commitments, sealPolicy,
    walrusSystem: shared(MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId),
    walrusExecution: makerV8WalrusExecutionFixture({ initialSharedVersion: '7', systemObjectVersion: '9' }) });
  if (['BEGIN_BOOTSTRAP', 'FINALIZE_BOOTSTRAP'].includes(stage)) Object.assign(input, {
    catalog: shared(catalogId), replacement: owned(id(120)) });
  if (stage === 'FINALIZE_BOOTSTRAP') Object.assign(input, { bootstrapAdmin: owned(id(121)),
    outputConfig: shared(id(212)), marketConfig: shared(id(214)) });
  const protocolHash = bootstrapProtocolCommitment({ id: protocolId,
    revision: '2', enabled: true, core_original_package_id: packageIds.core,
    core_callable_package_id: packageIds.core, treasury_id: id(103), payment_coin_type: USDC,
    primary_content_fee_bps: 1000, fixed_complete_fee_atomic: '0', maker_market_fee_bps: 250, soul_market_fee_bps: 250,
  });
  const catalog = bootstrapCatalogCommitments({ id: catalogId, schema_revision: '2', protocol_config_id: protocolId,
    protocol_config_revision: '2', protocol_config_commitment: protocolHash,
    binding: { bindings: roles.map(r => ({ original_package_id: packageIds[r], callable_package_id: packageIds[r],
      ...Object.fromEntries(['source', 'package', 'abi'].map(k => [`${k}_commitment`, [...Buffer.from(commitments[r][k], 'hex')]])) })) },
    authority_ids: roles.slice(1).map((_, i) => id(200 + i)), next_setup_role: 6,
    role_config_ids: roles.slice(1).map((_, i) => id(210 + i)), role_config_commitments: roles.slice(1).map((_, i) => hash(40 + i)) });
  const bindings = catalog.binding.bindings, tuple = catalog.binding.commitment, capSet = catalog.call_cap_set_commitment;
  const fields = {
    protocol: { id: protocolId, version: '8', core_original_package_id: packageIds.core,
      core_callable_package_id: packageIds.core, revision: '2', treasury_id: id(103), payment_coin_type: USDC,
      primary_content_fee_bps: 1000, fixed_complete_fee_atomic: '0', maker_market_fee_bps: 250,
      soul_market_fee_bps: 250, enabled: true, commitment: protocolHash },
    protocolAdmin: { id: id(101), version: '8', config_id: protocolId },
    protocolTreasury: { id: id(103), version: '8', config_id: protocolId, revenue: { value: '0' }, total_collected: '0', total_withdrawn: '0' },
    catalog,
    replacement: { id: id(120), version: '2', catalog_id: catalogId,
      ...Object.fromEntries(roles.map((r, i) => [`${r}_binding_commitment`, bindings[i].commitment])),
      package_tuple_commitment: tuple, call_cap_set_commitment: capSet,
      runtime_config_id: id(211), output_config_id: id(212), market_config_id: id(214), release_config_id: id(215), binding_commitment: hash(84) },
    bootstrapAdmin: { id: id(121), version: '2', protocol_admin_id: id(101), replacement_binding_id: id(120),
      catalog_id: catalogId, package_tuple_commitment: tuple, call_cap_set_commitment: capSet,
      caps_minted: false, install_mask: 0, install_mark_commitments: [], bootstrap_commitment: hash(85) },
    bootstrapCertificate: { id: id(122), version: '2', replacement_binding_id: id(120), catalog_id: catalogId,
      package_tuple_commitment: tuple, call_cap_set_commitment: capSet, install_mask: 12,
      install_mark_commitments: [hash(86), hash(87)], certificate_commitment: hash(88) },
    walrusPolicy: { id: id(123), version: '1', catalog_id: catalogId, package_tuple_commitment: tuple,
      system_id: MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId, commitment: hash(89) },
    bootstrapSlot: { state: stage === 'SETUP_RELEASE' ? 0 : stage === 'BEGIN_BOOTSTRAP' ? 1 : 2,
      replacement_binding_id: id(120), admin_id: stage === 'BEGIN_BOOTSTRAP' ? id(121) : null,
      certificate_id: stage === 'FINALIZE_BOOTSTRAP' ? id(122) : null,
      certificate_commitment: stage === 'FINALIZE_BOOTSTRAP' ? hash(88) : null },
    walrusPolicySlot: { policy_id: id(123), system_id: MAINNET_WALRUS_PACKAGE_CONFIG.systemObjectId },
    nativeSoulBinding: { config_id: protocolId, ...Object.fromEntries(
      [['soul', 'soul::Soul'], ['mint', 'animacraft_v8_binding::MintBindingWitnessV8'], ['owner', 'animacraft_v8_binding::SoulOwnerWitnessV8']]
        .flatMap(([prefix, name]) => ['original', 'defining'].map(origin => [`${prefix}_${origin}`, { name: `${packageIds.soulidity.slice(2)}::${name}` }]))) },
    protocolCatalogSlot: { catalog_id: catalogId },
  };
  for (const [i, role] of roles.slice(1).entries()) {
    const config = { id: id(210 + i), version: '8', catalog_id: catalogId, product_binding_commitment: tuple,
      installation_commitment: hash(40 + i) };
    if (['physical', 'market', 'release'].includes(role)) config.call_cap_set_commitment = capSet;
    if (['output', 'market'].includes(role)) config.runtime_caller_cap = stage !== 'FINALIZE_BOOTSTRAP' ? null : {
      schema_revision: '2', role: role === 'output' ? 0 : 1, catalog_id: catalogId, replacement_binding_id: id(120),
      package_tuple_commitment: tuple, caller_original_package_id: packageIds[role], caller_callable_package_id: packageIds[role],
      call_cap_set_commitment: capSet, cap_commitment: hash(90 + i) };
    if (role === 'seal') {
      delete config.installation_commitment;
      Object.assign(config, { protocol_config_id: protocolId, protocol_config_revision: '2',
        seal_original_package_id: packageIds.seal, seal_callable_package_id: packageIds.seal,
        seal_binding_commitment: bindings[1].commitment, seal_authority_id: id(200), call_cap_set_commitment: capSet,
        role: 1, finalized: true, key_servers: sealPolicy.keyServers.map(r => ({ key_server_id: r.objectId, weight: Number(r.weight) })),
        threshold: Number(sealPolicy.threshold), cipher_suite: PROFILE.cipherSuite, key_derivation: PROFILE.keyDerivation,
        ciphertext_format: PROFILE.ciphertextFormat, max_plaintext_bytes: '3145728', key_server_set_commitment: hash(93),
        encryption_policy_commitment: hash(94), commitment: hash(95), config_commitment: hash(40) });
      Object.assign(config, bootstrapSealCommitments(config));
    }
    fields[role + 'Config'] = config;
  }
  const inventory = {
    INITIALIZE_PROTOCOL: ['protocol', 'protocolAdmin', 'protocolTreasury'],
    SETUP_RELEASE: ['protocol', 'protocolAdmin', 'catalog', ...roles.slice(1).map(r => r + 'Config'), 'replacement', 'bootstrapSlot', 'walrusPolicy', 'walrusPolicySlot', 'nativeSoulBinding', 'protocolCatalogSlot'],
    BEGIN_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapAdmin', 'bootstrapSlot'],
    FINALIZE_BOOTSTRAP: ['protocol', 'protocolAdmin', 'catalog', 'replacement', 'bootstrapCertificate', 'bootstrapSlot', 'outputConfig', 'marketConfig'],
  }[stage];
  const objects = {};
  for (const kind of inventory) {
    let owner = ['protocolAdmin', 'bootstrapAdmin'].includes(kind) ? { kind: 'address', address: sender }
      : ['replacement', 'bootstrapCertificate'].includes(kind) ? { kind: 'immutable' } : { kind: 'shared', initialSharedVersion: '7' };
    let type;
    if (dynamic[kind]) {
      const [module, key, value] = dynamic[kind], keyType = `${packageIds.core}::${module}::${key}`;
      const parent = ['nativeSoulBinding', 'protocolCatalogSlot'].includes(kind) ? protocolId : catalogId;
      fields[kind] = { id: deriveDynamicFieldID(parent, keyType, new Uint8Array([0])), name: { dummy_field: false }, value: fields[kind] };
      owner = { kind: 'object', objectId: parent };
      type = `0x2::dynamic_field::Field<${keyType},${packageIds.core}::${module}::${value}>`;
    } else {
      const role = kind.endsWith('Config') ? kind.slice(0, -6) : 'core';
      const module = kind.startsWith('protocol') ? 'protocol_config_v8' : kind === 'walrusPolicy' ? 'core_v8'
        : role === 'core' ? 'package_binding_v8' : role === 'runtime' ? 'runtime_binding_v8' : `${role}_v8`;
      type = `${packageIds[role]}::${module}::${B[kind].name}${kind === 'protocolTreasury' ? `<${USDC}>` : ''}`;
    }
    objects[kind] = { type: normalizeStructTag(type), objectId: fields[kind].id, owner, bcsBase64: '' };
  }
  // Isolated trees: callers can mutate a single field without corrupting another relation.
  const f = structuredClone({ stage, input, sender, objects, fields });
  f.fields = JSON.parse(JSON.stringify(f.fields));
  f.encode = kind => { f.objects[kind].bcsBase64 = toBase64(B[kind].serialize(f.fields[kind]).toBytes()); };
  f.mutate = (kind, change) => { change(f.fields[kind]); f.encode(kind); return f; };
  inventory.forEach(f.encode);
  f.args = () => ({ stage: f.stage, input: f.input, sender: f.sender, objects: f.objects });
  return f;
}
