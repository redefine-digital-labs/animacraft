import {
  MAKER_V8_MAKER_BINDING_FIELDS,
  assertMakerV8Runtime,
  inspectMakerV8Runtime,
  makerV8StableType,
} from './maker-v8-runtime.js';

export const MAKER_V8_CHAIN_NETWORK = 'mainnet';
export const MAKER_V8_CHAIN_SCHEMA = 'animacraft.maker-v8-chain.v8';
export const MAKER_V8_MAINNET_CHAIN_IDENTIFIER = '35834a8a';
export const MAKER_V8_MAINNET_GENESIS_DIGEST = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';

export const MAKER_V8_LIFECYCLES = Object.freeze({
  0: 'DRAFT',
  1: 'ACTIVE',
  2: 'PAUSED',
  3: 'ARCHIVED',
});

export const MAKER_V8_CHAIN_ERROR_LAYERS = Object.freeze([
  'local',
  'config',
  'schema',
  'stale',
  'dry-run',
  'wallet',
  'signed-outcome',
  'finalized',
  'readback',
]);

const SUI_ID = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const DIGEST = /^[1-9A-HJ-NP-Za-km-z]{20,64}$/;
const HASH_HEX = /^(?:0x)?[0-9a-fA-F]{64}$/;
const LEGACY_TYPE = /(?:::OCMaker|::maker_v[4-7]|::commerce_v5|::composition_v6|::physical_v7|::publication_v[4-7])/;
const VERIFIED_MAINNET_RPCS = new WeakSet();
const ATTESTED_MAKER_V8_RUNTIMES = new WeakSet();
const ATTESTED_MAKER_V8_PACKAGE_TUPLES = new WeakMap();

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactRecord(value, fields, label) {
  if (!record(value)) fail('schema', 'MAKER_V8_CHAIN_RECORD_INVALID', `${label} must be a plain record.`);
  const expected = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !expected.has(field));
  if (unknown.length) fail('schema', 'MAKER_V8_CHAIN_FIELD_UNKNOWN', `${label} contains unknown fields: ${unknown.join(', ')}.`, { fields: unknown });
}

function fail(layer, code, message, details = {}) {
  throw new MakerV8ChainError(layer, code, message, details);
}

export class MakerV8ChainError extends Error {
  constructor(layer, code, message, details = {}) {
    super(message);
    this.name = 'MakerV8ChainError';
    this.layer = layer;
    this.code = code;
    this.details = freeze({ ...details });
  }
}

function id(value, label) {
  if (record(value) && typeof value.id === 'string') return id(value.id, label);
  if (record(value) && record(value.fields)) return id(value.fields, label);
  const normalized = String(value || '').toLowerCase();
  if (!SUI_ID.test(normalized) || /^0x0{64}$/.test(normalized)) {
    fail('schema', 'MAKER_V8_CHAIN_ID_INVALID', `${label} is not an exact non-zero Sui ID.`, { label });
  }
  return normalized;
}

function address(value, label) {
  return id(value, label);
}

function decimal(value, label, { positive = false } = {}) {
  const text = String(value ?? '');
  if (!DECIMAL.test(text) || (positive && text === '0')) {
    fail('schema', 'MAKER_V8_CHAIN_INTEGER_INVALID', `${label} must be a canonical${positive ? ' positive' : ''} integer.`, { label });
  }
  return BigInt(text);
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail('schema', 'MAKER_V8_CHAIN_DIGEST_INVALID', `${label} is not an exact Sui digest.`, { label });
  }
  return value;
}

function hash(value, label) {
  if (Array.isArray(value) && value.length === 32
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return value.map((entry) => entry.toString(16).padStart(2, '0')).join('');
  }
  const text = String(value || '').replace(/^0x/i, '').toLowerCase();
  if (!HASH_HEX.test(text)) fail('schema', 'MAKER_V8_CHAIN_HASH_INVALID', `${label} must contain exactly 32 bytes.`, { label });
  return text;
}

function text(value, label) {
  if (typeof value !== 'string' || !value.length || new TextEncoder().encode(value).length > 1024) {
    fail('schema', 'MAKER_V8_CHAIN_TEXT_INVALID', `${label} is not valid bounded text.`, { label });
  }
  return value;
}

function network(value) {
  if (value !== MAKER_V8_CHAIN_NETWORK) {
    fail('config', 'MAKER_V8_NETWORK_MISMATCH', `Maker v8 chain access is pinned to ${MAKER_V8_CHAIN_NETWORK}.`, { observed: value });
  }
  return value;
}

export async function assertMakerV8MainnetRpc(rpc) {
  if (!rpc || typeof rpc !== 'object') fail('config', 'MAKER_V8_RPC_INVALID', 'A concrete Sui RPC client is required.');
  if (VERIFIED_MAINNET_RPCS.has(rpc)) return rpc;
  let response;
  if (typeof rpc.getChainIdentifier === 'function') response = await rpc.getChainIdentifier();
  else if (typeof rpc.core?.getChainIdentifier === 'function') response = await rpc.core.getChainIdentifier();
  else fail('config', 'MAKER_V8_RPC_CHAIN_ID_UNAVAILABLE', 'RPC must expose an authoritative chain identifier.');
  const observed = typeof response === 'string' ? response : response?.chainIdentifier;
  if (![MAKER_V8_MAINNET_CHAIN_IDENTIFIER, MAKER_V8_MAINNET_GENESIS_DIGEST].includes(observed)) {
    fail('config', 'MAKER_V8_RPC_CHAIN_ID_MISMATCH', 'RPC is not the pinned Sui Mainnet chain.', { observed });
  }
  VERIFIED_MAINNET_RPCS.add(rpc);
  return rpc;
}

function fieldsOf(value, label) {
  if (record(value?.fields)) return value.fields;
  if (record(value)) return value;
  fail('schema', 'MAKER_V8_CHAIN_FIELDS_INVALID', `${label} has no Move fields.`);
}

function moveOption(value, label) {
  if (!Array.isArray(value) || value.length > 1) {
    fail('schema', 'MAKER_V8_CHAIN_OPTION_INVALID', `${label} is not an exact Move Option.`);
  }
  if (!value.length) return null;
  return record(value[0]) ? fieldsOf(value[0], label) : value[0];
}

function typeEquals(observed, expected) {
  return String(observed || '').replace(/\s+/g, '') === String(expected).replace(/\s+/g, '');
}

function assertType(observed, expected, label) {
  if (LEGACY_TYPE.test(String(observed || ''))) {
    fail('schema', 'UNSUPPORTED_LEGACY_PRODUCT', `${label} belongs to an unsupported pre-v8 product.`, { observed });
  }
  if (!typeEquals(observed, expected)) {
    fail('schema', 'MAKER_V8_CHAIN_TYPE_MISMATCH', `${label} has the wrong stable TypeOrigin.`, { expected, observed });
  }
}

function ownerOf(value) {
  if (typeof value === 'string') return freeze({ kind: 'address', address: address(value, 'owner') });
  if (!record(value)) fail('schema', 'MAKER_V8_CHAIN_OWNER_INVALID', 'Sui object owner is invalid.');
  if (typeof value.AddressOwner === 'string') return freeze({ kind: 'address', address: address(value.AddressOwner, 'owner.AddressOwner') });
  if (typeof value.ObjectOwner === 'string') return freeze({ kind: 'object', objectId: id(value.ObjectOwner, 'owner.ObjectOwner') });
  if (record(value.Shared)) return freeze({
    kind: 'shared',
    initialSharedVersion: decimal(value.Shared.initial_shared_version ?? value.Shared.initialSharedVersion, 'owner.Shared.initialSharedVersion', { positive: true }),
  });
  if (Object.hasOwn(value, 'Immutable')) return freeze({ kind: 'immutable' });
  fail('schema', 'MAKER_V8_CHAIN_OWNER_INVALID', 'Sui object owner has an unsupported shape.');
}

function parsedObject(response, expectedType, observedNetwork, label) {
  network(observedNetwork);
  if (!record(response) || response.error || !record(response.data)) {
    fail('readback', 'MAKER_V8_OBJECT_READ_FAILED', `${label} could not be read from the current RPC.`, { error: response?.error ?? null });
  }
  const data = response.data;
  assertType(data.type ?? data.content?.type, expectedType, label);
  if (!record(data.content) || data.content.dataType !== 'moveObject') {
    fail('schema', 'MAKER_V8_MOVE_OBJECT_REQUIRED', `${label} is not a parsed Move object.`);
  }
  const objectId = id(data.objectId, `${label}.objectId`);
  const version = decimal(data.version, `${label}.version`, { positive: true });
  const objectDigest = digest(data.digest, `${label}.digest`);
  const fields = fieldsOf(data.content.fields, `${label}.content.fields`);
  if (fields.id !== undefined && id(fields.id, `${label}.fields.id`) !== objectId) {
    fail('readback', 'MAKER_V8_OBJECT_ID_READBACK_MISMATCH', `${label} UID does not match its RPC object ID.`);
  }
  return freeze({
    schemaVersion: MAKER_V8_CHAIN_SCHEMA,
    network: observedNetwork,
    objectId,
    version,
    digest: objectDigest,
    type: String(data.type ?? data.content.type).replace(/\s+/g, ''),
    owner: ownerOf(data.owner),
    fields,
    objectRef: freeze({ objectId, version: version.toString(), digest: objectDigest }),
  });
}

export function makerV8ChainTypes(runtimeInput) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  return freeze({
    activationEvent: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8Activated'),
    lifecycleEvent: makerV8StableType(runtime, 'release', 'release_v8', 'MakerV8LifecycleChanged'),
    root: `${makerV8StableType(runtime, 'core', 'maker_v8', 'MakerRootV8')}<${runtime.paymentCoinType}>`,
    adminCap: makerV8StableType(runtime, 'core', 'maker_v8', 'MakerAdminCapV8'),
    protocolConfig: makerV8StableType(runtime, 'core', 'protocol_config_v8', 'ProtocolConfigV8'),
    makerTreasury: `${makerV8StableType(runtime, 'core', 'treasury_v8', 'MakerTreasuryV8')}<${runtime.paymentCoinType}>`,
    productReleaseCatalog: makerV8StableType(runtime, 'core', 'package_binding_v8', 'ProductReleaseCatalogV8'),
    sealConfig: makerV8StableType(runtime, 'seal', 'seal_v8', 'SealPolicyConfigV8'),
    runtimeConfig: makerV8StableType(runtime, 'runtime', 'runtime_binding_v8', 'RuntimePackageConfigV8'),
    outputConfig: makerV8StableType(runtime, 'output', 'output_v8', 'OutputPackageConfigV8'),
    physicalConfig: makerV8StableType(runtime, 'physical', 'physical_v8', 'PhysicalPackageConfigV8'),
    marketConfig: makerV8StableType(runtime, 'market', 'market_v8', 'MarketPackageConfigV8'),
    releaseConfig: makerV8StableType(runtime, 'release', 'release_v8', 'ReleasePackageConfigV8'),
    completeOutput: makerV8StableType(runtime, 'output', 'output_v8', 'CompleteOutputV8'),
    completeReceipt: makerV8StableType(runtime, 'output', 'output_v8', 'CompleteReceiptV8'),
    canonicalSoul: makerV8StableType(runtime, 'output', 'output_v8', 'CanonicalSoulV8'),
    physicalAsset: makerV8StableType(runtime, 'physical', 'physical_v8', 'PhysicalAssetV8'),
  });
}

const ROLE_BINDING_FIELDS = Object.freeze([
  'original_package_id', 'callable_package_id', 'source_commitment',
  'package_commitment', 'abi_commitment', 'commitment',
]);

const PRODUCT_BINDING_FIELDS = Object.freeze([
  'version', 'native_capability_mask', 'core', 'seal', 'runtime', 'output',
  'physical', 'market', 'release', 'commitment',
]);

const CALL_CAP_SET_FIELDS = Object.freeze([
  'version', 'catalog_id', 'product_binding_commitment', 'seal_authority_id',
  'runtime_authority_id', 'output_authority_id', 'physical_authority_id',
  'market_authority_id', 'release_authority_id', 'commitment',
]);

const CATALOG_FIELDS = Object.freeze([
  'id', 'version', 'protocol_config_id', 'protocol_config_revision',
  'protocol_config_commitment', 'binding', 'call_cap_set', 'seal_call_cap',
  'runtime_call_cap', 'output_call_cap', 'physical_call_cap', 'market_call_cap',
  'release_call_cap',
]);

function parseRoleBinding(fieldsInput, role, runtime) {
  const fields = fieldsOf(fieldsInput, `catalog.binding.${role}`);
  exactRecord(fields, ROLE_BINDING_FIELDS, `catalog.binding.${role}`);
  const expected = runtime.roles[role];
  const originalPackageId = id(fields.original_package_id, `catalog.binding.${role}.original_package_id`);
  const callablePackageId = id(fields.callable_package_id, `catalog.binding.${role}.callable_package_id`);
  if (originalPackageId !== expected.typeOriginPackageId || callablePackageId !== expected.callablePackageId) {
    fail('readback', 'MAKER_V8_CATALOG_ROLE_MISMATCH', `Catalog ${role} package identity differs from the configured seven-role tuple.`, {
      role, originalPackageId, callablePackageId,
    });
  }
  return freeze({
    role,
    originalPackageId,
    callablePackageId,
    sourceCommitment: hash(fields.source_commitment, `catalog.binding.${role}.source_commitment`),
    packageCommitment: hash(fields.package_commitment, `catalog.binding.${role}.package_commitment`),
    abiCommitment: hash(fields.abi_commitment, `catalog.binding.${role}.abi_commitment`),
    commitment: hash(fields.commitment, `catalog.binding.${role}.commitment`),
  });
}

function parseCatalogWithRuntime(response, runtime, observedNetwork) {
  const object = parsedObject(response, makerV8ChainTypes(runtime).productReleaseCatalog, observedNetwork, 'ProductReleaseCatalogV8');
  const fields = object.fields;
  exactRecord(fields, CATALOG_FIELDS, 'ProductReleaseCatalogV8.fields');
  if (object.objectId !== runtime.catalogId
    || decimal(fields.version, 'catalog.version') !== 8n
    || id(fields.protocol_config_id, 'catalog.protocol_config_id') !== runtime.protocolConfigId) {
    fail('readback', 'MAKER_V8_CATALOG_RUNTIME_MISMATCH', 'ProductReleaseCatalog does not match the pinned runtime identities.');
  }
  const bindingFields = fieldsOf(fields.binding, 'catalog.binding');
  exactRecord(bindingFields, PRODUCT_BINDING_FIELDS, 'catalog.binding');
  if (decimal(bindingFields.version, 'catalog.binding.version') !== 8n
    || decimal(bindingFields.native_capability_mask, 'catalog.binding.native_capability_mask') !== 127n) {
    fail('readback', 'MAKER_V8_CATALOG_CAPABILITY_MISMATCH', 'ProductReleaseCatalog is not the complete seven-role native v8 binding.');
  }
  const roles = Object.fromEntries(Object.keys(runtime.roles).map((role) => [
    role,
    parseRoleBinding(bindingFields[role], role, runtime),
  ]));
  const productBindingCommitment = hash(bindingFields.commitment, 'catalog.binding.commitment');
  const callCapFields = fieldsOf(fields.call_cap_set, 'catalog.call_cap_set');
  exactRecord(callCapFields, CALL_CAP_SET_FIELDS, 'catalog.call_cap_set');
  if (decimal(callCapFields.version, 'catalog.call_cap_set.version') !== 8n
    || id(callCapFields.catalog_id, 'catalog.call_cap_set.catalog_id') !== object.objectId
    || hash(callCapFields.product_binding_commitment, 'catalog.call_cap_set.product_binding_commitment') !== productBindingCommitment) {
    fail('readback', 'MAKER_V8_CALL_CAP_SET_MISMATCH', 'Catalog call-cap set does not bind the exact product release.');
  }
  const authorities = {};
  for (const role of ['seal', 'runtime', 'output', 'physical', 'market', 'release']) {
    authorities[role] = id(callCapFields[`${role}_authority_id`], `catalog.call_cap_set.${role}_authority_id`);
    const remainingCap = moveOption(fields[`${role}_call_cap`], `catalog.${role}_call_cap`);
    if (remainingCap !== null) {
      fail('readback', 'MAKER_V8_CALL_CAP_NOT_INSTALLED', `Catalog still owns the ${role} call capability; companion configuration is not release-ready.`, { role });
    }
  }
  if (new Set(Object.values(authorities)).size !== 6) {
    fail('readback', 'MAKER_V8_CALL_CAP_AUTHORITY_COLLISION', 'Catalog companion call-cap authority IDs must be distinct.');
  }
  return freeze({
    ...object,
    protocolConfigRevision: decimal(fields.protocol_config_revision, 'catalog.protocol_config_revision'),
    protocolConfigCommitment: hash(fields.protocol_config_commitment, 'catalog.protocol_config_commitment'),
    productBindingCommitment,
    callCapSetCommitment: hash(callCapFields.commitment, 'catalog.call_cap_set.commitment'),
    roles: freeze(roles),
    authorities: freeze(authorities),
  });
}

function rawCatalogIdentity(config) {
  if (!record(config) || !record(config.roles) || !record(config.roles.core)) {
    fail('config', 'MAKER_V8_RUNTIME_CONFIG_INVALID', 'Runtime config cannot identify the Core ProductReleaseCatalog TypeOrigin.');
  }
  return {
    catalogId: id(config.catalogId, 'runtime.catalogId'),
    coreOriginalPackageId: id(config.roles.core.typeOriginPackageId, 'runtime.roles.core.typeOriginPackageId'),
  };
}

function companionConfigType(types, role) {
  return types[`${role}Config`];
}

function assertCompanionCallCap(value, role, catalog) {
  const fields = fieldsOf(value, `${role}Config.${role}_call_cap`);
  const expectedFields = [
    'version', 'authority_id', 'catalog_id', 'product_binding_commitment',
    'role_binding_commitment', 'call_cap_set_commitment',
  ];
  exactRecord(fields, expectedFields, `${role}Config.${role}_call_cap`);
  if (decimal(fields.version, `${role}Config.callCap.version`) !== 8n
    || id(fields.authority_id, `${role}Config.callCap.authority_id`) !== catalog.authorities[role]
    || id(fields.catalog_id, `${role}Config.callCap.catalog_id`) !== catalog.objectId
    || hash(fields.product_binding_commitment, `${role}Config.callCap.product_binding_commitment`) !== catalog.productBindingCommitment
    || hash(fields.role_binding_commitment, `${role}Config.callCap.role_binding_commitment`) !== catalog.roles[role].commitment
    || hash(fields.call_cap_set_commitment, `${role}Config.callCap.call_cap_set_commitment`) !== catalog.callCapSetCommitment) {
    fail('readback', 'MAKER_V8_COMPANION_CALL_CAP_MISMATCH', `${role} config does not own the exact Catalog-issued call capability.`, { role });
  }
}

function parseCompanionConfig(response, runtime, catalog, role, observedNetwork) {
  const object = parsedObject(response, companionConfigType(makerV8ChainTypes(runtime), role), observedNetwork, `${role}Config`);
  const fields = object.fields;
  if (object.objectId !== runtime.roleConfigIds[role]
    || decimal(fields.version, `${role}Config.version`) !== 8n
    || id(fields.catalog_id, `${role}Config.catalog_id`) !== catalog.objectId
    || hash(fields.product_binding_commitment, `${role}Config.product_binding_commitment`) !== catalog.productBindingCommitment) {
    fail('readback', 'MAKER_V8_COMPANION_CONFIG_MISMATCH', `${role} config does not match the attested ProductReleaseCatalog.`, { role });
  }
  if (Object.hasOwn(fields, 'call_cap_set_commitment')
    && hash(fields.call_cap_set_commitment, `${role}Config.call_cap_set_commitment`) !== catalog.callCapSetCommitment) {
    fail('readback', 'MAKER_V8_COMPANION_CONFIG_MISMATCH', `${role} config has a stale call-cap set commitment.`, { role });
  }
  assertCompanionCallCap(fields[`${role}_call_cap`], role, catalog);
  return freeze({ ...object, role });
}

export function isMakerV8RuntimeAttested(runtime) {
  return Boolean(runtime) && ATTESTED_MAKER_V8_RUNTIMES.has(runtime);
}

export function makerV8AttestedPackageTuple(runtime) {
  if (!isMakerV8RuntimeAttested(runtime) || !ATTESTED_MAKER_V8_PACKAGE_TUPLES.has(runtime)) {
    fail('config', 'MAKER_V8_RUNTIME_ATTESTATION_REQUIRED', 'Package digests require the exact Mainnet-attested Maker v8 runtime.');
  }
  return ATTESTED_MAKER_V8_PACKAGE_TUPLES.get(runtime);
}

function parseCallablePackageIdentity(response, runtime, role) {
  if (!record(response) || response.error || !record(response.data)) {
    fail('readback', 'MAKER_V8_PACKAGE_READ_FAILED', `${role} callable package could not be read from Mainnet.`);
  }
  const data = response.data;
  const expectedId = runtime.roles[role].callablePackageId;
  const packageId = id(data.objectId, `${role}.callablePackageId`);
  const packageDigest = digest(data.digest, `${role}.packageDigest`);
  const packageVersion = decimal(data.version, `${role}.packageVersion`, { positive: true });
  const packageDataType = data.bcs?.dataType ?? data.content?.dataType;
  const packageOwner = ownerOf(data.owner);
  if (packageId !== expectedId || packageDataType !== 'package' || packageOwner.kind !== 'immutable') {
    fail('readback', 'MAKER_V8_PACKAGE_IDENTITY_MISMATCH', `${role} callable package object does not match the attested runtime.`, {
      expectedId,
      packageId,
      packageDataType,
      ownerKind: packageOwner.kind,
    });
  }
  return freeze({
    role,
    originalPackageId: runtime.roles[role].typeOriginPackageId,
    callablePackageId: packageId,
    packageVersion: packageVersion.toString(),
    packageDigest,
  });
}

export async function attestMakerV8Runtime(rpc, config, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required for runtime attestation.');
  const raw = rawCatalogIdentity(config);
  const rawCatalogType = `${raw.coreOriginalPackageId}::package_binding_v8::ProductReleaseCatalogV8`;
  const catalogResponse = await rpc.getObject({
    id: raw.catalogId,
    options: { showType: true, showContent: true, showOwner: true },
  });
  const rawCatalog = parsedObject(catalogResponse, rawCatalogType, observedNetwork, 'ProductReleaseCatalogV8');
  const rawBinding = fieldsOf(rawCatalog.fields.binding, 'catalog.binding');
  const resolver = (role, callablePackageId) => {
    const roleFields = fieldsOf(rawBinding[role], `catalog.binding.${role}`);
    return id(roleFields.callable_package_id, `catalog.binding.${role}.callable_package_id`) === callablePackageId
      ? id(roleFields.original_package_id, `catalog.binding.${role}.original_package_id`)
      : null;
  };
  const runtime = assertMakerV8Runtime(config, { requireEnabled: true, resolveTypeOriginPackageId: resolver });
  const catalog = parseCatalogWithRuntime(catalogResponse, runtime, observedNetwork);
  const roles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const responses = await Promise.all(roles.map((role) => rpc.getObject({
    id: runtime.roleConfigIds[role],
    options: { showType: true, showContent: true, showOwner: true },
  })));
  const configs = Object.fromEntries(roles.map((role, index) => [
    role,
    parseCompanionConfig(responses[index], runtime, catalog, role, observedNetwork),
  ]));
  const packageResponses = await Promise.all(Object.keys(runtime.roles).map((role) => rpc.getObject({
    id: runtime.roles[role].callablePackageId,
    options: { showBcs: true, showOwner: true },
  })));
  const packageTuple = freeze(Object.keys(runtime.roles).map((role, index) => (
    parseCallablePackageIdentity(packageResponses[index], runtime, role)
  )));
  ATTESTED_MAKER_V8_RUNTIMES.add(runtime);
  ATTESTED_MAKER_V8_PACKAGE_TUPLES.set(runtime, packageTuple);
  return freeze({ runtime, catalog, configs: freeze(configs), packageTuple, network: observedNetwork });
}

const ACTIVATION_FIELDS = Object.freeze([
  'root_id', 'version', 'owner', 'control_epoch', 'admin_cap_id', 'maker_key',
  'maker_version', 'version_commitment', 'content_commitment', 'renderer_commitment',
  'protocol_config_id', 'protocol_config_revision', 'protocol_config_commitment',
  'protocol_treasury_id', 'maker_treasury_id', 'catalog_id',
  'product_binding_commitment', 'call_cap_set_commitment', 'native_capability_mask',
  'capability_binding_commitment', 'base_registry_id', 'seal_policy_config_id',
  'seal_registry_id', 'runtime_definition_registry_id', 'pack_registry_id',
  'admission_authority_id', 'output_registry_id', 'soul_registry_id',
  'physical_registry_id', 'market_registry_id', 'market_treasury_id',
]);

function bindingFromActivation(fields) {
  return freeze({
    rootId: id(fields.root_id, 'activation.root_id'),
    baseRegistryId: id(fields.base_registry_id, 'activation.base_registry_id'),
    makerTreasuryId: id(fields.maker_treasury_id, 'activation.maker_treasury_id'),
    sealRegistryId: id(fields.seal_registry_id, 'activation.seal_registry_id'),
    runtimeDefinitionRegistryId: id(fields.runtime_definition_registry_id, 'activation.runtime_definition_registry_id'),
    packRegistryId: id(fields.pack_registry_id, 'activation.pack_registry_id'),
    packAdmissionAuthorityId: id(fields.admission_authority_id, 'activation.admission_authority_id'),
    outputRegistryId: id(fields.output_registry_id, 'activation.output_registry_id'),
    soulRegistryId: id(fields.soul_registry_id, 'activation.soul_registry_id'),
    physicalRegistryId: id(fields.physical_registry_id, 'activation.physical_registry_id'),
    marketRegistryId: id(fields.market_registry_id, 'activation.market_registry_id'),
    marketTreasuryId: id(fields.market_treasury_id, 'activation.market_treasury_id'),
  });
}

function assertBindingDistinct(binding) {
  const seen = new Map();
  for (const field of MAKER_V8_MAKER_BINDING_FIELDS) {
    const value = binding[field];
    if (seen.has(value)) fail('readback', 'MAKER_V8_BINDING_ID_COLLISION', `${field} collides with ${seen.get(value)}.`, { objectId: value });
    seen.set(value, field);
  }
}

function compareConfiguredBinding(runtime, binding) {
  const configured = runtime.makerBindings.find((entry) => entry.rootId === binding.rootId);
  if (!configured) {
    if (runtime.makerBindings.length > 0) {
      fail('config', 'MAKER_V8_ROOT_NOT_CONFIGURED', 'Activated Root is not present in the configured Maker binding allowlist.', { rootId: binding.rootId });
    }
    return;
  }
  for (const field of MAKER_V8_MAKER_BINDING_FIELDS) {
    if (configured[field] !== binding[field]) {
      fail('readback', 'MAKER_V8_BINDING_READBACK_MISMATCH', `${field} does not match the pinned Maker binding.`, { expected: configured[field], observed: binding[field] });
    }
  }
}

export function parseMakerV8ActivatedEvent(event, runtimeInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  const expectedType = makerV8ChainTypes(runtime).activationEvent;
  assertType(event?.type, expectedType, 'MakerV8Activated event');
  if (!record(event?.parsedJson)) fail('schema', 'MAKER_V8_ACTIVATION_EVENT_INVALID', 'MakerV8Activated has no parsed JSON payload.');
  exactRecord(event.parsedJson, ACTIVATION_FIELDS, 'MakerV8Activated');
  for (const field of ACTIVATION_FIELDS) {
    if (!Object.hasOwn(event.parsedJson, field)) fail('schema', 'MAKER_V8_ACTIVATION_FIELD_MISSING', `MakerV8Activated.${field} is required.`);
  }
  const fields = event.parsedJson;
  const binding = bindingFromActivation(fields);
  assertBindingDistinct(binding);
  compareConfiguredBinding(runtime, binding);
  const exactChecks = [
    ['catalog_id', runtime.catalogId],
    ['protocol_config_id', runtime.protocolConfigId],
    ['protocol_treasury_id', runtime.protocolTreasuryId],
    ['seal_policy_config_id', runtime.roleConfigIds.seal],
  ];
  exactChecks.forEach(([field, expected]) => {
    const observed = id(fields[field], `activation.${field}`);
    if (observed !== expected) fail('readback', 'MAKER_V8_ACTIVATION_RUNTIME_MISMATCH', `${field} does not match the pinned runtime.`, { expected, observed });
  });
  if (decimal(fields.version, 'activation.version') !== 8n
    || decimal(fields.native_capability_mask, 'activation.native_capability_mask') !== 127n) {
    fail('readback', 'MAKER_V8_ACTIVATION_VERSION_MISMATCH', 'MakerV8Activated is not the complete native v8 product.');
  }
  const result = {
    schemaVersion: MAKER_V8_CHAIN_SCHEMA,
    network: observedNetwork,
    type: expectedType,
    eventId: event.id ?? null,
    transactionDigest: event.id?.txDigest ? digest(event.id.txDigest, 'event.id.txDigest') : null,
    binding,
    owner: address(fields.owner, 'activation.owner'),
    adminCapId: id(fields.admin_cap_id, 'activation.admin_cap_id'),
    controlEpoch: decimal(fields.control_epoch, 'activation.control_epoch'),
    makerKey: text(fields.maker_key, 'activation.maker_key'),
    makerVersion: decimal(fields.maker_version, 'activation.maker_version', { positive: true }),
    protocolConfigRevision: decimal(fields.protocol_config_revision, 'activation.protocol_config_revision'),
    versionCommitment: hash(fields.version_commitment, 'activation.version_commitment'),
    contentCommitment: hash(fields.content_commitment, 'activation.content_commitment'),
    rendererCommitment: hash(fields.renderer_commitment, 'activation.renderer_commitment'),
    protocolConfigCommitment: hash(fields.protocol_config_commitment, 'activation.protocol_config_commitment'),
    productBindingCommitment: hash(fields.product_binding_commitment, 'activation.product_binding_commitment'),
    callCapSetCommitment: hash(fields.call_cap_set_commitment, 'activation.call_cap_set_commitment'),
    capabilityBindingCommitment: hash(fields.capability_binding_commitment, 'activation.capability_binding_commitment'),
  };
  return freeze(result);
}

const CAPABILITY_BINDING_MAP = Object.freeze({
  catalog_id: ['catalogId'],
  base_registry_id: ['binding', 'baseRegistryId'],
  maker_treasury_id: ['binding', 'makerTreasuryId'],
  protocol_treasury_id: ['protocolTreasuryId'],
  seal_policy_config_id: ['roleConfigIds', 'seal'],
  seal_registry_id: ['binding', 'sealRegistryId'],
  runtime_definition_registry_id: ['binding', 'runtimeDefinitionRegistryId'],
  pack_registry_id: ['binding', 'packRegistryId'],
  admission_authority_id: ['binding', 'packAdmissionAuthorityId'],
  output_registry_id: ['binding', 'outputRegistryId'],
  soul_registry_id: ['binding', 'soulRegistryId'],
  physical_registry_id: ['binding', 'physicalRegistryId'],
  market_registry_id: ['binding', 'marketRegistryId'],
  market_treasury_id: ['binding', 'marketTreasuryId'],
});

function pathValue(source, path) {
  return path.reduce((value, field) => value?.[field], source);
}

export function parseMakerRootV8(response, runtimeInput, activationInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const activation = activationInput?.binding
    ? activationInput
    : parseMakerV8ActivatedEvent(activationInput, runtime, observedNetwork);
  const object = parsedObject(response, makerV8ChainTypes(runtime).root, observedNetwork, 'MakerRootV8');
  const fields = object.fields;
  if (object.objectId !== activation.binding.rootId) fail('readback', 'MAKER_V8_ROOT_ID_MISMATCH', 'Root object does not match MakerV8Activated.');
  const checks = [
    [id(fields.core_original_package_id, 'root.core_original_package_id'), runtime.roles.core.typeOriginPackageId, 'core original'],
    [id(fields.core_callable_package_id, 'root.core_callable_package_id'), runtime.roles.core.callablePackageId, 'core callable'],
    [id(fields.protocol_config_id, 'root.protocol_config_id'), runtime.protocolConfigId, 'protocol config'],
  ];
  checks.forEach(([observed, expected, label]) => {
    if (observed !== expected) fail('readback', 'MAKER_V8_ROOT_READBACK_MISMATCH', `Root ${label} does not match verified context.`, { expected, observed });
  });
  if (decimal(fields.version, 'root.version') !== 8n
    || decimal(fields.maker_version, 'root.maker_version') !== activation.makerVersion
    || text(fields.maker_key, 'root.maker_key') !== activation.makerKey
    || hash(fields.content_commitment, 'root.content_commitment') !== activation.contentCommitment
    || hash(fields.version_commitment, 'root.version_commitment') !== activation.versionCommitment) {
    fail('readback', 'MAKER_V8_ROOT_SNAPSHOT_MISMATCH', 'Root immutable/control snapshot does not match activation readback.');
  }
  const lifecycleCode = Number(decimal(fields.lifecycle, 'root.lifecycle'));
  if (!Object.hasOwn(MAKER_V8_LIFECYCLES, lifecycleCode)) fail('schema', 'MAKER_V8_LIFECYCLE_INVALID', 'Root lifecycle is unknown.');
  const capability = moveOption(fields.capability_registry_binding, 'root.capability_registry_binding');
  if (!capability) fail('readback', 'MAKER_V8_CAPABILITY_BINDING_MISSING', 'Activated Root has no capability binding.');
  if (decimal(capability.native_capability_mask, 'capability.native_capability_mask') !== 127n) {
    fail('readback', 'MAKER_V8_CAPABILITY_MASK_MISMATCH', 'Root capability mask is not the complete native value 127.');
  }
  const expectedSource = { ...runtime, binding: activation.binding };
  for (const [field, path] of Object.entries(CAPABILITY_BINDING_MAP)) {
    const observed = id(capability[field], `capability.${field}`);
    const expected = pathValue(expectedSource, path);
    if (observed !== expected) fail('readback', 'MAKER_V8_CAPABILITY_BINDING_MISMATCH', `${field} does not match the verified v8 tuple.`, { expected, observed });
  }
  return freeze({
    ...object,
    binding: activation.binding,
    ownerAddress: address(fields.owner, 'root.owner'),
    creatorAddress: address(fields.creator, 'root.creator'),
    adminCapId: id(fields.admin_cap_id, 'root.admin_cap_id'),
    controlEpoch: decimal(fields.control_epoch, 'root.control_epoch'),
    lifecycleCode,
    lifecycle: MAKER_V8_LIFECYCLES[lifecycleCode],
    makerKey: activation.makerKey,
    makerVersion: activation.makerVersion,
    contentCommitment: activation.contentCommitment,
    capabilityBindingCommitment: hash(capability.commitment, 'capability.commitment'),
  });
}

export function parseMakerAdminCapV8(response, runtimeInput, walletAddress, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).adminCap, observedNetwork, 'MakerAdminCapV8');
  const owner = address(walletAddress, 'wallet.address');
  const root = rootInput;
  if (object.owner.kind !== 'address' || object.owner.address !== owner
    || address(object.fields.owner, 'admin.owner') !== owner
    || id(object.fields.root_id, 'admin.root_id') !== root.objectId
    || object.objectId !== root.adminCapId
    || decimal(object.fields.control_epoch, 'admin.control_epoch') !== root.controlEpoch
    || decimal(object.fields.version, 'admin.version') !== 8n) {
    fail('readback', 'MAKER_V8_ADMIN_CAP_MISMATCH', 'Maker AdminCap does not match the connected wallet and live Root epoch.');
  }
  return freeze({ ...object, rootId: root.objectId, holder: owner, controlEpoch: root.controlEpoch });
}

function observedBalance(value, label) {
  let candidate = value;
  if (record(candidate) && record(candidate.fields)) candidate = candidate.fields;
  if (record(candidate) && Object.hasOwn(candidate, 'value')) candidate = candidate.value;
  return decimal(candidate, label);
}

export function parseProtocolConfigV8(response, runtimeInput, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).protocolConfig, observedNetwork, 'ProtocolConfigV8');
  const fields = object.fields;
  const treasuryId = moveOption(fields.treasury_id, 'protocol.treasury_id');
  if (object.objectId !== runtime.protocolConfigId
    || decimal(fields.version, 'protocol.version') !== 8n
    || id(fields.core_original_package_id, 'protocol.core_original_package_id') !== runtime.roles.core.typeOriginPackageId
    || id(fields.core_callable_package_id, 'protocol.core_callable_package_id') !== runtime.roles.core.callablePackageId
    || treasuryId === null
    || id(treasuryId, 'protocol.treasury_id') !== runtime.protocolTreasuryId
    || fields.payment_coin_type !== runtime.paymentCoinType
    || (rootInput && id(rootInput.fields.protocol_config_id, 'root.protocol_config_id') !== object.objectId)) {
    fail('readback', 'MAKER_V8_PROTOCOL_CONFIG_MISMATCH', 'ProtocolConfig does not match the pinned runtime and live Root.');
  }
  if (typeof fields.enabled !== 'boolean') fail('schema', 'MAKER_V8_PROTOCOL_ENABLED_INVALID', 'Protocol enabled state is not boolean.');
  return freeze({
    ...object,
    enabled: fields.enabled,
    revision: decimal(fields.revision, 'protocol.revision'),
    commitment: `0x${hash(fields.commitment, 'protocol.commitment')}`,
    treasuryId: runtime.protocolTreasuryId,
  });
}

export function parseMakerTreasuryV8(response, runtimeInput, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).makerTreasury, observedNetwork, 'MakerTreasuryV8');
  const fields = object.fields;
  if (object.objectId !== rootInput.binding.makerTreasuryId
    || decimal(fields.version, 'makerTreasury.version') !== 8n
    || id(fields.root_id, 'makerTreasury.root_id') !== rootInput.objectId
    || decimal(fields.maker_version, 'makerTreasury.maker_version') !== rootInput.makerVersion
    || hash(fields.root_content_commitment, 'makerTreasury.root_content_commitment') !== rootInput.contentCommitment) {
    fail('readback', 'MAKER_V8_MAKER_TREASURY_MISMATCH', 'MakerTreasury does not match the verified live Root.');
  }
  return freeze({
    ...object,
    rootId: rootInput.objectId,
    balanceAtomic: observedBalance(fields.revenue, 'makerTreasury.revenue'),
    totalCollectedAtomic: decimal(fields.total_collected, 'makerTreasury.total_collected'),
    totalWithdrawnAtomic: decimal(fields.total_withdrawn, 'makerTreasury.total_withdrawn'),
  });
}

function parseOwnedOutputObject(response, runtime, type, label, wallet, observedNetwork) {
  const object = parsedObject(response, type, observedNetwork, label);
  const holder = address(object.fields.holder, `${label}.holder`);
  if (object.owner.kind !== 'address' || object.owner.address !== wallet || holder !== wallet) {
    fail('readback', 'MAKER_V8_INVENTORY_OWNER_MISMATCH', `${label} is not held by the connected wallet.`);
  }
  return object;
}

export function parseSoulBundleV8(input, runtimeInput, walletAddress, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  exactRecord(input, ['output', 'receipt', 'soul'], 'Soul bundle input');
  const runtime = assertMakerV8Runtime(runtimeInput);
  const types = makerV8ChainTypes(runtime);
  const wallet = address(walletAddress, 'wallet.address');
  const output = parseOwnedOutputObject(input.output, runtime, types.completeOutput, 'CompleteOutputV8', wallet, observedNetwork);
  const receipt = parseOwnedOutputObject(input.receipt, runtime, types.completeReceipt, 'CompleteReceiptV8', wallet, observedNetwork);
  const soul = parseOwnedOutputObject(input.soul, runtime, types.canonicalSoul, 'CanonicalSoulV8', wallet, observedNetwork);
  const rootId = rootInput.objectId;
  const content = rootInput.contentCommitment;
  const outputId = id(soul.fields.output_id, 'soul.output_id');
  const receiptId = id(soul.fields.receipt_id, 'soul.receipt_id');
  const objects = [output, receipt, soul];
  if (objects.some((object) => id(object.fields.root_id, `${object.type}.root_id`) !== rootId
      || hash(object.fields.root_content_commitment, `${object.type}.root_content_commitment`) !== content)
    || output.objectId !== outputId || receipt.objectId !== receiptId
    || id(receipt.fields.output_id, 'receipt.output_id') !== outputId
    || id(output.fields.output_registry_id, 'output.output_registry_id') !== rootInput.binding.outputRegistryId
    || id(soul.fields.soul_registry_id, 'soul.soul_registry_id') !== rootInput.binding.soulRegistryId) {
    fail('readback', 'MAKER_V8_SOUL_BUNDLE_MISMATCH', 'Soul/Output/Receipt do not form one exact verified bundle.');
  }
  return freeze({
    network: observedNetwork,
    rootId,
    holder: wallet,
    ownershipEpoch: decimal(soul.fields.ownership_epoch, 'soul.ownership_epoch'),
    output,
    receipt,
    soul,
  });
}

export function parsePhysicalAssetV8(response, runtimeInput, walletAddress, rootInput, observedNetwork = MAKER_V8_CHAIN_NETWORK) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const object = parsedObject(response, makerV8ChainTypes(runtime).physicalAsset, observedNetwork, 'PhysicalAssetV8');
  const wallet = address(walletAddress, 'wallet.address');
  if (object.owner.kind !== 'address' || object.owner.address !== wallet
    || address(object.fields.holder, 'physical.holder') !== wallet
    || id(object.fields.root_id, 'physical.root_id') !== rootInput.objectId
    || id(object.fields.registry_id, 'physical.registry_id') !== rootInput.binding.physicalRegistryId
    || hash(object.fields.root_content_commitment, 'physical.root_content_commitment') !== rootInput.contentCommitment) {
    fail('readback', 'MAKER_V8_PHYSICAL_ASSET_MISMATCH', 'Physical asset does not match the wallet and verified Maker binding.');
  }
  const sourceKind = Number(decimal(object.fields.source_kind, 'physical.source_kind'));
  if (![0, 1].includes(sourceKind)) fail('schema', 'MAKER_V8_PHYSICAL_SOURCE_INVALID', 'Physical source must be Base or Pack.');
  const sourceTreasuryId = moveOption(object.fields.source_treasury_id, 'physical.source_treasury_id');
  if ((sourceKind === 0 && sourceTreasuryId !== null)
    || (sourceKind === 1 && sourceTreasuryId === null)) {
    fail('readback', 'MAKER_V8_PHYSICAL_SOURCE_MISMATCH', 'Physical Base/Pack custody fields are inconsistent.');
  }
  return freeze({
    ...object,
    rootId: rootInput.objectId,
    holder: wallet,
    sourceKind,
    source: sourceKind === 0 ? 'BASE' : 'PACK',
    sourceId: id(object.fields.source_id, 'physical.source_id'),
    sourceTreasuryId: sourceTreasuryId === null
      ? null
      : id(sourceTreasuryId, 'physical.source_treasury_id'),
    ownershipEpoch: decimal(object.fields.ownership_epoch, 'physical.ownership_epoch'),
    transferable: object.fields.transferable === true,
  });
}

async function allPages(fetchPage, maximum = 10_000) {
  const rows = [];
  let cursor = null;
  do {
    const page = await fetchPage(cursor);
    if (!record(page) || !Array.isArray(page.data)) fail('readback', 'MAKER_V8_RPC_PAGE_INVALID', 'RPC returned an invalid page.');
    rows.push(...page.data);
    if (rows.length > maximum) fail('local', 'MAKER_V8_RPC_PAGE_LIMIT', 'RPC result exceeds the bounded client limit.');
    cursor = page.hasNextPage ? page.nextCursor : null;
    if (page.hasNextPage && !cursor) fail('readback', 'MAKER_V8_RPC_CURSOR_INVALID', 'RPC omitted a required next cursor.');
  } while (cursor);
  return rows;
}

export async function discoverMakerV8Activations(rpc, runtimeInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.queryEvents !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC queryEvents is required.');
  const eventType = makerV8ChainTypes(runtime).activationEvent;
  const events = await allPages((cursor) => rpc.queryEvents({
    query: { MoveEventType: eventType }, cursor, limit: 100, order: 'descending',
  }));
  return freeze(events.map((event) => parseMakerV8ActivatedEvent(event, runtime, observedNetwork)));
}

export async function loadMakerV8Context(rpc, runtimeInput, activationInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const activation = activationInput?.binding
    ? activationInput
    : parseMakerV8ActivatedEvent(activationInput, runtime, observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required.');
  const response = await rpc.getObject({
    id: activation.binding.rootId,
    options: { showType: true, showContent: true, showOwner: true },
  });
  const root = parseMakerRootV8(response, runtime, activation, observedNetwork);
  return freeze({ runtime, activation, root });
}

export async function loadMakerV8OperationalState(rpc, runtimeInput, rootInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required.');
  const options = { showType: true, showContent: true, showOwner: true };
  const [protocolResponse, makerTreasuryResponse] = await Promise.all([
    rpc.getObject({ id: runtime.protocolConfigId, options }),
    rpc.getObject({ id: rootInput.binding.makerTreasuryId, options }),
  ]);
  return freeze({
    network: observedNetwork,
    root: rootInput,
    protocolConfig: parseProtocolConfigV8(protocolResponse, runtime, rootInput, observedNetwork),
    makerTreasury: parseMakerTreasuryV8(makerTreasuryResponse, runtime, rootInput, observedNetwork),
  });
}

async function ownedByType(rpc, owner, type) {
  return allPages((cursor) => rpc.getOwnedObjects({
    owner,
    filter: { StructType: type },
    options: { showType: true, showContent: true, showOwner: true },
    cursor,
    limit: 100,
  }));
}

export async function listOwnedMakerV8Inventory(rpc, runtimeInput, walletAddress, rootInput, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  const wallet = address(walletAddress, 'wallet.address');
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getOwnedObjects !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getOwnedObjects is required.');
  const types = makerV8ChainTypes(runtime);
  const [adminRows, outputRows, receiptRows, soulRows, physicalRows] = await Promise.all([
    ownedByType(rpc, wallet, types.adminCap),
    ownedByType(rpc, wallet, types.completeOutput),
    ownedByType(rpc, wallet, types.completeReceipt),
    ownedByType(rpc, wallet, types.canonicalSoul),
    ownedByType(rpc, wallet, types.physicalAsset),
  ]);
  const selectedRoot = (entry, label) => (
    id(fieldsOf(entry.data?.content?.fields, `${label}.fields`).root_id, `${label}.root_id`)
      === rootInput.objectId
  );
  const selectedAdmins = adminRows.filter((entry) => selectedRoot(entry, 'admin'));
  const selectedOutputs = outputRows.filter((entry) => selectedRoot(entry, 'output'));
  const selectedReceipts = receiptRows.filter((entry) => selectedRoot(entry, 'receipt'));
  const selectedSouls = soulRows.filter((entry) => selectedRoot(entry, 'soul'));
  const selectedPhysical = physicalRows.filter((entry) => selectedRoot(entry, 'physical'));
  const adminCaps = selectedAdmins.map((entry) => parseMakerAdminCapV8(entry, runtime, wallet, rootInput, observedNetwork));
  const outputs = new Map(selectedOutputs.map((entry) => [id(entry.data?.objectId, 'output.objectId'), entry]));
  const receipts = new Map(selectedReceipts.map((entry) => [id(entry.data?.objectId, 'receipt.objectId'), entry]));
  const soulBundles = selectedSouls.map((soulResponse) => {
    const soulFields = fieldsOf(soulResponse.data?.content?.fields, 'soul.fields');
    const outputId = id(soulFields.output_id, 'soul.output_id');
    const receiptId = id(soulFields.receipt_id, 'soul.receipt_id');
    if (!outputs.has(outputId) || !receipts.has(receiptId)) fail('readback', 'MAKER_V8_SOUL_BUNDLE_INCOMPLETE', 'Owned Soul is missing its exact Output or Receipt.');
    return parseSoulBundleV8({ output: outputs.get(outputId), receipt: receipts.get(receiptId), soul: soulResponse }, runtime, wallet, rootInput, observedNetwork);
  });
  const physicalAssets = selectedPhysical.map((entry) => parsePhysicalAssetV8(entry, runtime, wallet, rootInput, observedNetwork));
  return freeze({ network: observedNetwork, wallet, rootId: rootInput.objectId, adminCaps, soulBundles, physicalAssets });
}

export async function loadReceivingRefV8(rpc, runtimeInput, objectIdInput, listingIdInput, expectedType, { network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  assertMakerV8Runtime(runtimeInput);
  const objectId = id(objectIdInput, 'receiving.objectId');
  const listingId = id(listingIdInput, 'receiving.listingId');
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  if (typeof rpc?.getObject !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getObject is required.');
  const response = await rpc.getObject({ id: objectId, options: { showType: true, showContent: true, showOwner: true } });
  const object = parsedObject(response, expectedType, observedNetwork, 'Receiving child');
  if (object.owner.kind !== 'object' || object.owner.objectId !== listingId) {
    fail('stale', 'MAKER_V8_RECEIVING_OWNER_MISMATCH', 'Receiving child is not currently owned by the exact listing.', { expected: listingId, observed: object.owner });
  }
  return freeze({ ...object.objectRef, network: observedNetwork, type: object.type, listingId });
}

export async function readFinalizedMakerV8Transaction(rpc, digestInput, {
  network: observedNetwork = MAKER_V8_CHAIN_NETWORK,
  expectedSender,
  expectedEventTypes = [],
} = {}) {
  network(observedNetwork);
  await assertMakerV8MainnetRpc(rpc);
  const transactionDigest = digest(digestInput, 'transaction.digest');
  const sender = address(expectedSender, 'expectedSender');
  if (typeof rpc?.getTransactionBlock !== 'function') fail('config', 'MAKER_V8_RPC_INVALID', 'RPC getTransactionBlock is required.');
  let transaction;
  try {
    transaction = await rpc.getTransactionBlock({
      digest: transactionDigest,
      options: { showEffects: true, showEvents: true, showObjectChanges: true, showInput: true },
    });
  } catch (error) {
    fail('signed-outcome', 'MAKER_V8_SIGNED_OUTCOME_UNKNOWN', 'Signed transaction is not yet queryable; keep the exact signed bytes for query-first recovery.', { cause: String(error?.message || error) });
  }
  if (!record(transaction) || transaction.digest !== transactionDigest || !record(transaction.effects?.status)) {
    fail('readback', 'MAKER_V8_TRANSACTION_READBACK_INVALID', 'RPC transaction readback is malformed.');
  }
  if (address(transaction.transaction?.data?.sender, 'transaction.sender') !== sender) {
    fail('readback', 'MAKER_V8_TRANSACTION_SENDER_MISMATCH', 'Finalized transaction sender differs from the connected signer.');
  }
  const status = transaction.effects.status.status;
  if (status !== 'success') {
    fail('finalized', 'MAKER_V8_FINALIZED_FAILURE', 'Transaction finalized with a Move failure.', {
      error: transaction.effects.status.error ?? null,
    });
  }
  const events = Array.isArray(transaction.events) ? transaction.events : [];
  const observedTypes = new Set(events.map((event) => String(event.type).replace(/\s+/g, '')));
  expectedEventTypes.forEach((type) => {
    if (!observedTypes.has(String(type).replace(/\s+/g, ''))) {
      fail('readback', 'MAKER_V8_FINALIZED_EVENT_MISSING', `Finalized transaction omitted expected event ${type}.`);
    }
  });
  return freeze({
    network: observedNetwork,
    digest: transactionDigest,
    sender,
    checkpoint: transaction.checkpoint ?? null,
    effects: transaction.effects,
    events,
    objectChanges: Array.isArray(transaction.objectChanges) ? transaction.objectChanges : [],
    raw: transaction,
  });
}

export function createMakerV8ChainClient(runtimeInput, { rpc, network: observedNetwork = MAKER_V8_CHAIN_NETWORK } = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  network(observedNetwork);
  if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) {
    fail('config', 'MAKER_V8_RPC_INVALID', 'A concrete Sui RPC client is required.');
  }
  return freeze({
    runtime,
    network: observedNetwork,
    types: makerV8ChainTypes(runtime),
    ready: () => assertMakerV8MainnetRpc(rpc),
    discover: () => discoverMakerV8Activations(rpc, runtime, { network: observedNetwork }),
    loadContext: (activation) => loadMakerV8Context(rpc, runtime, activation, { network: observedNetwork }),
    loadOperationalState: (root) => loadMakerV8OperationalState(rpc, runtime, root, { network: observedNetwork }),
    inventory: (wallet, root) => listOwnedMakerV8Inventory(rpc, runtime, wallet, root, { network: observedNetwork }),
    receivingRef: (objectId, listingId, expectedType) => loadReceivingRefV8(rpc, runtime, objectId, listingId, expectedType, { network: observedNetwork }),
    finalized: (transactionDigest, options) => readFinalizedMakerV8Transaction(rpc, transactionDigest, { ...options, network: observedNetwork }),
  });
}
