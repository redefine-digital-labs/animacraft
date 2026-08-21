import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
} from '../../maker-v8-chain.js';

const bytes32 = (value) => Array(32).fill(value);
const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = '11111111111111111111111111111111';

function moveObject(type, objectId, fields) {
  return {
    data: {
      objectId,
      version: '1',
      digest,
      type,
      owner: { Shared: { initial_shared_version: '1' } },
      content: {
        dataType: 'moveObject',
        type,
        fields: { id: { id: objectId }, ...fields },
      },
    },
  };
}

export function runtimeAttestationRpc(runtime, methods = {}) {
  const runtimeRoles = Object.keys(runtime.roles);
  const companionRoles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const authorities = Object.fromEntries(companionRoles.map((role, index) => [role, id(9_000 + index)]));
  const roleCommitments = Object.fromEntries(Object.keys(runtime.roles).map((role, index) => [role, bytes32(40 + index)]));
  const productBindingCommitment = bytes32(60);
  const callCapSetCommitment = bytes32(61);
  const bindings = Object.fromEntries(Object.entries(runtime.roles).map(([role, identity], index) => [role, {
    fields: {
      original_package_id: identity.typeOriginPackageId,
      callable_package_id: identity.callablePackageId,
      source_commitment: bytes32(10 + index),
      package_commitment: bytes32(20 + index),
      abi_commitment: bytes32(30 + index),
      commitment: roleCommitments[role],
    },
  }]));
  const catalog = moveObject(
    `${runtime.roles.core.typeOriginPackageId}::package_binding_v8::ProductReleaseCatalogV8`,
    runtime.catalogId,
    {
      version: '8',
      protocol_config_id: runtime.protocolConfigId,
      protocol_config_revision: '7',
      protocol_config_commitment: bytes32(4),
      binding: { fields: {
        version: '8', native_capability_mask: '127', ...bindings,
        commitment: productBindingCommitment,
      } },
      call_cap_set: { fields: {
        version: '8', catalog_id: runtime.catalogId,
        product_binding_commitment: productBindingCommitment,
        ...Object.fromEntries(companionRoles.map((role) => [`${role}_authority_id`, authorities[role]])),
        commitment: callCapSetCommitment,
      } },
      ...Object.fromEntries(companionRoles.map((role) => [`${role}_call_cap`, []])),
    },
  );
  const configTypes = {
    seal: ['seal_v8', 'SealPolicyConfigV8'],
    runtime: ['runtime_binding_v8', 'RuntimePackageConfigV8'],
    output: ['output_v8', 'OutputPackageConfigV8'],
    physical: ['physical_v8', 'PhysicalPackageConfigV8'],
    market: ['market_v8', 'MarketPackageConfigV8'],
    release: ['release_v8', 'ReleasePackageConfigV8'],
  };
  const configs = Object.fromEntries(companionRoles.map((role) => {
    const [moduleName, typeName] = configTypes[role];
    return [role, moveObject(
      `${runtime.roles[role].typeOriginPackageId}::${moduleName}::${typeName}`,
      runtime.roleConfigIds[role],
      {
        version: '8',
        catalog_id: runtime.catalogId,
        product_binding_commitment: productBindingCommitment,
        call_cap_set_commitment: callCapSetCommitment,
        [`${role}_call_cap`]: { fields: {
          version: '8', authority_id: authorities[role], catalog_id: runtime.catalogId,
          product_binding_commitment: productBindingCommitment,
          role_binding_commitment: roleCommitments[role],
          call_cap_set_commitment: callCapSetCommitment,
        } },
      },
    )];
  }));
  return {
    ...methods,
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getObject({ id: objectId }) {
      if (objectId === runtime.catalogId) return catalog;
      const packageIndex = runtimeRoles.findIndex((role) => runtime.roles[role].callablePackageId === objectId);
      if (packageIndex >= 0) return {
        data: {
          objectId,
          version: '1',
          digest: String(packageIndex + 2).repeat(32),
          owner: { Immutable: true },
          bcs: { dataType: 'package', id: objectId, version: '1', moduleMap: {} },
        },
      };
      const role = companionRoles.find((candidate) => runtime.roleConfigIds[candidate] === objectId);
      if (!role) throw new Error(`unexpected runtime attestation object ${objectId}`);
      return configs[role];
    },
  };
}

export async function attestFixtureRuntime(runtime, methods = {}) {
  return (await attestMakerV8Runtime(runtimeAttestationRpc(runtime, methods), runtime)).runtime;
}
