import { bcs } from '@mysten/sui/bcs';
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils';

// Pure wire/identity decoding only. No RPC, effects, finality, commitment
// recomputation or stage-readiness assertion is performed by this module.
// Existing chain schemas are private; activation's public schemas import WASM.
// These layouts are checked against actual Move field order in the paired test.
export const NATIVE_SOUL_BOOTSTRAP_PACKAGE_ROLES = Object.freeze([
  'core', 'seal', 'runtime', 'output', 'physical', 'market', 'release', 'soulidity',
]);
export const NATIVE_SOUL_BOOTSTRAP_USDC_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const MAX_OBJECT_BYTES = 1024 * 1024;
const bytes = bcs.vector(bcs.u8());
const addresses = bcs.vector(bcs.Address);
const hashes = bcs.vector(bytes);
const optionId = bcs.option(bcs.Address);
const typeName = bcs.struct('TypeName', { name: bcs.string() });
const emptyKey = name => bcs.struct(name, { dummy_field: bcs.bool() });
const field = (key, value) => bcs.struct('Field', { id: bcs.Address, name: key, value });

const exactPackageBinding = bcs.struct('ExactPackageBindingV8', {
  original_package_id: bcs.Address, callable_package_id: bcs.Address,
  source_commitment: bytes, package_commitment: bytes, abi_commitment: bytes, commitment: bytes,
});
const productBinding = bcs.struct('ProductReleaseBindingV8', {
  bindings: bcs.vector(exactPackageBinding), commitment: bytes,
});
const runtimeCaller = bcs.struct('RuntimeCallerCapV1', {
  schema_revision: bcs.u64(), role: bcs.u8(), catalog_id: bcs.Address,
  replacement_binding_id: bcs.Address, package_tuple_commitment: bytes,
  caller_original_package_id: bcs.Address, caller_callable_package_id: bcs.Address,
  call_cap_set_commitment: bytes, cap_commitment: bytes,
});
const configHead = { id: bcs.Address, version: bcs.u64(), catalog_id: bcs.Address,
  product_binding_commitment: bytes };
const configWithCapSet = { ...configHead, call_cap_set_commitment: bytes, installation_commitment: bytes };
const replacementRoleHashes = Object.fromEntries(NATIVE_SOUL_BOOTSTRAP_PACKAGE_ROLES.slice(0, 7)
  .map(role => [`${role}_binding_commitment`, bytes]));
const bootstrapSlotKey = emptyKey('FreshTupleBootstrapSlotKeyV2');
const bootstrapSlotValue = bcs.struct('FreshTupleBootstrapSlotV2', {
  state: bcs.u8(), replacement_binding_id: bcs.Address, admin_id: optionId,
  certificate_id: optionId, certificate_commitment: bcs.option(bytes),
});
const walrusPolicySlotKey = emptyKey('WalrusCertificationBootstrapKeyV1');
const walrusPolicySlotValue = bcs.struct('WalrusCertificationBootstrapSlotV1', {
  policy_id: bcs.Address, system_id: bcs.Address,
});
const nativeSoulBindingKey = emptyKey('SoulidityBindingSlotKeyV8');
const nativeSoulBindingValue = bcs.struct('SoulidityBindingV8', {
  config_id: bcs.Address, soul_original: typeName, soul_defining: typeName,
  mint_original: typeName, mint_defining: typeName, owner_original: typeName, owner_defining: typeName,
});
const protocolCatalogSlotKey = emptyKey('ProductReleaseCatalogSlotKeyV2');
const protocolCatalogSlotValue = bcs.struct('ProductReleaseCatalogSlotV2', { catalog_id: bcs.Address });

export const NativeSoulBootstrapBcs = Object.freeze({
  protocol: bcs.struct('ProtocolConfigV8', {
    id: bcs.Address, version: bcs.u64(), core_original_package_id: bcs.Address,
    core_callable_package_id: bcs.Address, revision: bcs.u64(), treasury_id: optionId,
    payment_coin_type: bcs.string(), primary_content_fee_bps: bcs.u16(),
    fixed_complete_fee_atomic: bcs.u64(), maker_market_fee_bps: bcs.u16(),
    soul_market_fee_bps: bcs.u16(), enabled: bcs.bool(), commitment: bytes,
  }),
  protocolAdmin: bcs.struct('ProtocolAdminCapV8', {
    id: bcs.Address, version: bcs.u64(), config_id: bcs.Address,
  }),
  protocolTreasury: bcs.struct('ProtocolTreasuryV8', {
    id: bcs.Address, version: bcs.u64(), config_id: bcs.Address,
    revenue: bcs.struct('Balance', { value: bcs.u64() }),
    total_collected: bcs.u128(), total_withdrawn: bcs.u128(),
  }),
  catalog: bcs.struct('ProductReleaseCatalogV8', {
    id: bcs.Address, schema_revision: bcs.u64(), protocol_config_id: bcs.Address,
    protocol_config_revision: bcs.u64(), protocol_config_commitment: bytes, binding: productBinding,
    authority_ids: addresses, call_cap_set_commitment: bytes, catalog_commitment: bytes,
    next_setup_role: bcs.u8(), role_config_ids: addresses, role_config_commitments: hashes,
  }),
  sealConfig: bcs.struct('SealPolicyConfigV8', {
    id: bcs.Address, version: bcs.u64(), protocol_config_id: bcs.Address,
    protocol_config_revision: bcs.u64(), catalog_id: bcs.Address, product_binding_commitment: bytes,
    seal_original_package_id: bcs.Address, seal_callable_package_id: bcs.Address,
    seal_binding_commitment: bytes, seal_authority_id: bcs.Address, call_cap_set_commitment: bytes,
    role: bcs.u8(), finalized: bcs.bool(),
    key_servers: bcs.vector(bcs.struct('KeyServerRowV2', { key_server_id: bcs.Address, weight: bcs.u16() })),
    threshold: bcs.u16(), cipher_suite: bcs.string(), key_derivation: bcs.string(),
    ciphertext_format: bcs.string(), max_plaintext_bytes: bcs.u64(), key_server_set_commitment: bytes,
    encryption_policy_commitment: bytes, commitment: bytes, config_commitment: bytes,
  }),
  runtimeConfig: bcs.struct('RuntimePackageConfigV8', { ...configHead, installation_commitment: bytes }),
  outputConfig: bcs.struct('OutputPackageConfigV8', {
    ...configHead, installation_commitment: bytes, runtime_caller_cap: bcs.option(runtimeCaller),
  }),
  physicalConfig: bcs.struct('PhysicalPackageConfigV8', configWithCapSet),
  marketConfig: bcs.struct('MarketPackageConfigV8', {
    ...configWithCapSet, runtime_caller_cap: bcs.option(runtimeCaller),
  }),
  releaseConfig: bcs.struct('ReleasePackageConfigV8', configWithCapSet),
  replacement: bcs.struct('FreshTupleReplacementBindingV2', {
    id: bcs.Address, version: bcs.u64(), catalog_id: bcs.Address, ...replacementRoleHashes,
    package_tuple_commitment: bytes, call_cap_set_commitment: bytes,
    runtime_config_id: bcs.Address, output_config_id: bcs.Address,
    market_config_id: bcs.Address, release_config_id: bcs.Address, binding_commitment: bytes,
  }),
  bootstrapAdmin: bcs.struct('FreshTupleBootstrapAdminV2', {
    id: bcs.Address, version: bcs.u64(), protocol_admin_id: bcs.Address,
    replacement_binding_id: bcs.Address, catalog_id: bcs.Address,
    package_tuple_commitment: bytes, call_cap_set_commitment: bytes, caps_minted: bcs.bool(),
    install_mask: bcs.u8(), install_mark_commitments: hashes, bootstrap_commitment: bytes,
  }),
  bootstrapCertificate: bcs.struct('FreshTupleBootstrapCertificateV2', {
    id: bcs.Address, version: bcs.u64(), replacement_binding_id: bcs.Address,
    catalog_id: bcs.Address, package_tuple_commitment: bytes, call_cap_set_commitment: bytes,
    install_mask: bcs.u8(), install_mark_commitments: hashes, certificate_commitment: bytes,
  }),
  bootstrapSlot: field(bootstrapSlotKey, bootstrapSlotValue),
  walrusPolicy: bcs.struct('WalrusCertificationPolicyV1', {
    id: bcs.Address, version: bcs.u64(), catalog_id: bcs.Address,
    package_tuple_commitment: bytes, system_id: bcs.Address, commitment: bytes,
  }),
  walrusPolicySlot: field(walrusPolicySlotKey, walrusPolicySlotValue),
  nativeSoulBinding: field(nativeSoulBindingKey, nativeSoulBindingValue),
  protocolCatalogSlot: field(protocolCatalogSlotKey, protocolCatalogSlotValue),
});

const objectTypes = Object.freeze({
  protocol: ['core', 'protocol_config_v8', 'ProtocolConfigV8', 'shared'],
  protocolAdmin: ['core', 'protocol_config_v8', 'ProtocolAdminCapV8', 'address'],
  protocolTreasury: ['core', 'protocol_config_v8', `ProtocolTreasuryV8<${NATIVE_SOUL_BOOTSTRAP_USDC_TYPE}>`, 'shared'],
  catalog: ['core', 'package_binding_v8', 'ProductReleaseCatalogV8', 'shared'],
  sealConfig: ['seal', 'seal_v8', 'SealPolicyConfigV8', 'shared'],
  runtimeConfig: ['runtime', 'runtime_binding_v8', 'RuntimePackageConfigV8', 'shared'],
  outputConfig: ['output', 'output_v8', 'OutputPackageConfigV8', 'shared'],
  physicalConfig: ['physical', 'physical_v8', 'PhysicalPackageConfigV8', 'shared'],
  marketConfig: ['market', 'market_v8', 'MarketPackageConfigV8', 'shared'],
  releaseConfig: ['release', 'release_v8', 'ReleasePackageConfigV8', 'shared'],
  replacement: ['core', 'package_binding_v8', 'FreshTupleReplacementBindingV2', 'immutable'],
  bootstrapAdmin: ['core', 'package_binding_v8', 'FreshTupleBootstrapAdminV2', 'address'],
  bootstrapCertificate: ['core', 'package_binding_v8', 'FreshTupleBootstrapCertificateV2', 'immutable'],
  walrusPolicy: ['core', 'core_v8', 'WalrusCertificationPolicyV1', 'shared'],
});
const dynamicTypes = Object.freeze({
  bootstrapSlot: ['package_binding_v8', 'FreshTupleBootstrapSlotKeyV2', 'FreshTupleBootstrapSlotV2'],
  walrusPolicySlot: ['core_v8', 'WalrusCertificationBootstrapKeyV1', 'WalrusCertificationBootstrapSlotV1'],
  nativeSoulBinding: ['protocol_config_v8', 'SoulidityBindingSlotKeyV8', 'SoulidityBindingV8'],
  protocolCatalogSlot: ['protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2', 'ProductReleaseCatalogSlotV2'],
});
function check(condition, label) {
  if (!condition) {
    const error = new Error(`Invalid native Soul bootstrap object: ${label}`);
    error.code = 'NATIVE_SOUL_BOOTSTRAP_OBJECT_INVALID';
    throw error;
  }
}
function exact(value, keys, label) {
  check(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), label);
}
function id(value, label) {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)
    && value !== `0x${'0'.repeat(64)}`, label);
  return value;
}
function sharedVersion(value) {
  check(typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    && value.length <= 20 && BigInt(value) < 2n ** 64n, 'shared initial version');
}
function owner(value, expected) {
  check(value?.kind === expected, 'owner kind');
  if (expected === 'immutable') exact(value, ['kind'], 'immutable owner');
  if (expected === 'shared') {
    exact(value, ['kind', 'initialSharedVersion'], 'shared owner'); sharedVersion(value.initialSharedVersion);
  }
  if (expected === 'address') {
    exact(value, ['kind', 'address'], 'address owner'); id(value.address, 'owner address');
  }
  if (expected === 'object') {
    exact(value, ['kind', 'objectId'], 'object owner'); id(value.objectId, 'owner object ID');
  }
}

/** Returns decoded Move fields, not an attestation or executable reference. */
export function decodeNativeSoulBootstrapObject(kind, value, packageIds) {
  try {
    check(typeof kind === 'string' && Object.hasOwn(NativeSoulBootstrapBcs, kind), 'kind');
    exact(packageIds, NATIVE_SOUL_BOOTSTRAP_PACKAGE_ROLES, 'eight fresh package IDs');
    const packageValues = NATIVE_SOUL_BOOTSTRAP_PACKAGE_ROLES.map(role => id(packageIds[role], `${role} original ID`));
    check(new Set(packageValues).size === 8, 'distinct fresh package IDs');
    exact(value, ['type', 'objectId', 'bcsBase64', 'owner'], 'object envelope');
    id(value.objectId, 'object ID');
    check(typeof value.type === 'string' && value.type.length <= 4096, 'object type');
    let expectedType;
    let keyType;
    if (Object.hasOwn(dynamicTypes, kind)) {
      const [module, key, fieldValue] = dynamicTypes[kind];
      keyType = `${packageIds.core}::${module}::${key}`;
      expectedType = `0x2::dynamic_field::Field<${keyType},${packageIds.core}::${module}::${fieldValue}>`;
      owner(value.owner, 'object');
    } else {
      const [role, module, name, expectedOwner] = objectTypes[kind];
      expectedType = `${packageIds[role]}::${module}::${name}`;
      owner(value.owner, expectedOwner);
    }
    check(normalizeStructTag(value.type) === normalizeStructTag(expectedType), 'exact TypeOrigin');
    check(typeof value.bcsBase64 === 'string' && value.bcsBase64.length > 0
      && value.bcsBase64.length <= Math.ceil(MAX_OBJECT_BYTES / 3) * 4, 'BCS byte bound');
    const wire = fromBase64(value.bcsBase64);
    check(wire.length <= MAX_OBJECT_BYTES && toBase64(wire) === value.bcsBase64, 'canonical base64');
    const schema = NativeSoulBootstrapBcs[kind];
    const fields = schema.parse(wire);
    check(toBase64(schema.serialize(fields, { maxSize: MAX_OBJECT_BYTES }).toBytes()) === value.bcsBase64, 'canonical complete BCS');
    check(fields.id === value.objectId, 'object UID');
    if (keyType) {
      check(fields.name.dummy_field === false, 'empty Move key');
      check(deriveDynamicFieldID(value.owner.objectId, keyType, new Uint8Array([0])) === value.objectId, 'dynamic field parent/key UID');
      if (kind === 'nativeSoulBinding') check(fields.value.config_id === value.owner.objectId, 'native binding parent ID');
    }
    return fields;
  } catch (error) {
    if (error?.code === 'NATIVE_SOUL_BOOTSTRAP_OBJECT_INVALID') throw error;
    check(false, 'BCS or type encoding');
  }
}
