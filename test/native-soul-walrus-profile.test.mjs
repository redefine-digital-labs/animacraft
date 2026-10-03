import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMainnetV8ProtocolProfile, MAINNET_V8_RELEASE_TOOLCHAIN as pin } from '../scripts/mainnet-v8-release.mjs';
import { MAKER_V8_SUI_MAINNET_GENESIS_DIGEST } from '../maker-v8-sui-grpc.js';

function client(flag) {
  return { core: {
    getChainIdentifier: async () => ({ chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST }),
    getProtocolConfig: async () => ({ protocolConfig: {
      protocolVersion: pin.protocolVersion,
      attributes: { object_runtime_max_num_cached_objects: pin.objectRuntimeMaxCachedObjects,
        object_runtime_max_num_store_entries: pin.objectRuntimeMaxStoreEntries },
      featureFlags: flag === undefined ? {} : { enable_unified_linkage: flag },
    } }),
    getCurrentSystemState: async () => ({ systemState: { protocolVersion: pin.protocolVersion, epoch: '1246' } }),
    getReferenceGasPrice: async () => ({ referenceGasPrice: '100' }),
  } };
}
test('release profile requires actual unified linkage before external-target execution', async () => {
  assert.equal((await assertMainnetV8ProtocolProfile(client(true))).protocolVersion, pin.protocolVersion);
  for (const flag of [false, undefined, 'true', 1]) {
    await assert.rejects(assertMainnetV8ProtocolProfile(client(flag)), { code: 'MAINNET_V8_PROTOCOL_DRIFT' });
  }
});
