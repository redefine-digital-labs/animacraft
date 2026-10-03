import { MAKER_V8_MAINNET_CHAIN_IDENTIFIER, attestMakerV8Runtime } from '../../maker-v8-chain.js';
import { currentRuntimeAuthorityFixture } from './maker-v8-current-runtime-authority.js';
import { CORE_BASE_REGISTRY_MODULE_BASE64 } from './maker-v8-approved-core-bytecode.js';
export { CORE_BASE_REGISTRY_MODULE_BASE64 } from './maker-v8-approved-core-bytecode.js';

// Shared test authority uses the actual schema-2 BCS, installation commitments,
// certified slot and immutable replacement. No consumed setup cap is retained.
export function runtimeAttestationRpc(runtime, methods = {}) {
  const current = currentRuntimeAuthorityFixture(runtime);
  const runtimeRoles = Object.keys(runtime.roles);
  return {
    ...methods,
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getDynamicField(input) {
      if (input.parentId === runtime.catalogId && input.name?.type === current.field.name.type) {
        return current.rpc.getDynamicField(input);
      }
      if (typeof methods.getDynamicField === 'function') return methods.getDynamicField(input);
      throw new Error(`unexpected runtime attestation dynamic field ${input.parentId}`);
    },
    async getObject({ id: objectId }) {
      if (current.objects.has(objectId)) return current.objects.get(objectId);
      const packageIndex = runtimeRoles.findIndex((role) => runtime.roles[role].callablePackageId === objectId);
      if (packageIndex >= 0) return {
        data: {
          objectId, version: '1', digest: String(packageIndex + 2).repeat(44),
          owner: { Immutable: true },
          bcs: {
            dataType: 'package', id: objectId, version: '1',
            moduleMap: runtimeRoles[packageIndex] === 'core'
              ? { base_registry_v8: CORE_BASE_REGISTRY_MODULE_BASE64 } : {},
          },
        },
      };
      throw new Error(`unexpected runtime attestation object ${objectId}`);
    },
  };
}

export async function attestFixtureRuntime(runtime, methods = {}) {
  return (await attestMakerV8Runtime(runtimeAttestationRpc(runtime, methods), runtime)).runtime;
}
