import { createMakerV8BrowserSealClient, assertMakerV8BrowserSealServers } from './maker-v8-seal-browser.js';
import { assertMakerV8Runtime } from './maker-v8-runtime.js';
import { attestMakerV8Runtime, attestMakerV8NativeSoulIntegration,
  attestMakerV8NativeSoulCompletionRecovery, readMakerV8NativePersonalKiosk } from './maker-v8-chain.js';
import { createMakerV8NativeContentProviderV8 } from './maker-v8-native-content-provider.js';
import { createMakerV8NativeContentStoreV8 } from './maker-v8-native-content-store.js';
import { createMakerV8NativeReceiverV8 } from './maker-v8-native-receiver.js';

const ID = /^0x[0-9a-f]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }

/** Lazy production composition: merely opening Creator does not contact Seal,
 * open a popup or require an enabled native mint deployment. */
export function createProductionMakerV8NativeContentV8({ runtime: runtimeInput, client, wallet, walrus, execution,
  win = globalThis.window, indexedDB = win?.indexedDB,
  receiver: receiverInput = null,
  createSealClient = ({ suiClient, serverConfigs }) => createMakerV8BrowserSealClient({ client: suiClient, serverConfigs }),
} = {}) {
  const runtime = assertMakerV8Runtime(runtimeInput);
  let receiver = receiverInput; let provider; let store; let disposed = false;
  function available() {
    if (disposed) fail('MAKER_V8_NATIVE_CONTENT_DISPOSED');
    if (!runtime.nativeSoulIntegration) fail('MAKER_V8_NATIVE_INTEGRATION_REQUIRED');
  }
  function receive() {
    available();
    return receiver ??= createMakerV8NativeReceiverV8({ window: win, crypto: win?.crypto ?? globalThis.crypto });
  }
  async function assertWallet({ rootId, signer }) {
    available();
    if (![rootId, signer].every(value => ID.test(value ?? '') && !/^0x0+$/.test(value))) fail('MAKER_V8_NATIVE_CONTENT_SCOPE_INVALID');
    const account = await wallet?.getCurrentAccount?.();
    if (account?.network !== 'mainnet' || account.address !== signer) fail('MAKER_V8_NATIVE_CONTENT_WALLET_CHANGED');
  }
  async function resolve(scope, recovery) {
    await assertWallet(scope);
    // Always refresh attestation. A cached package/config snapshot is not live
    // permission to start another mint after a policy or wallet change.
    const authority = await attestMakerV8Runtime(client, runtime);
    const integration = recovery
      ? await attestMakerV8NativeSoulCompletionRecovery(client, authority.runtime)
      : await attestMakerV8NativeSoulIntegration(client, authority.runtime);
    const policy = authority.configs.seal.authorityFields;
    const threshold = Number(policy.threshold);
    const serverConfigs = assertMakerV8BrowserSealServers(policy.key_servers.map(row => ({
      objectId: row.key_server_id, weight: Number(row.weight),
    })));
    const totalWeight = serverConfigs.reduce((sum, row) => sum + row.weight, 0);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > totalWeight || totalWeight > 254) fail('MAKER_V8_NATIVE_CONTENT_SEAL_POLICY_UNSUPPORTED');
    if (typeof client?.core?.getObject !== 'function') fail('MAKER_V8_NATIVE_CONTENT_SEAL_CLIENT_REQUIRED');
    // Seal namespaces require the original first package version. Check before
    // storage/signature costs, not for the first time while finalizing a Soul.
    const original = await client.core.getObject({ objectId: integration.config.soulidityOriginalPackageId });
    if (original?.object?.objectId !== integration.config.soulidityOriginalPackageId
      || String(original.object.version) !== '1') fail('MAKER_V8_NATIVE_CONTENT_SEAL_NAMESPACE_INVALID');
    let seal;
    async function loadSeal() {
      if (seal) return seal;
      const candidate = await createSealClient({ suiClient: client, serverConfigs, verifyKeyServers: true, timeout: 10000 });
      if (typeof candidate?.getKeyServers !== 'function' || typeof candidate.encrypt !== 'function') fail('MAKER_V8_NATIVE_CONTENT_SEAL_CLIENT_REQUIRED');
      const servers = await candidate.getKeyServers();
      if (!(servers instanceof Map) || servers.size !== serverConfigs.length
        || serverConfigs.some(row => servers.get(row.objectId)?.objectId !== row.objectId)) fail('MAKER_V8_NATIVE_CONTENT_SEAL_SERVERS_INVALID');
      seal = candidate; return seal;
    }
    // New issuance checks key availability before costs. Recovery with saved
    // envelopes only needs chain proofs; a key-server outage must not stop query.
    if (!recovery) await loadSeal();
    const kiosk = recovery ? {} : await readMakerV8NativePersonalKiosk(client, authority.runtime, integration, scope.signer);
    await assertWallet(scope);
    return { runtime: authority.runtime, threshold, ...kiosk,
      sealClient: { async encrypt(input) {
        await assertWallet(scope);
        const result = await (await loadSeal()).encrypt(input);
        try { await assertWallet(scope); return result; }
        finally { if (result?.key instanceof Uint8Array) result.key.fill(0); }
      } },
    };
  }
  function content() {
    available();
    if (!provider) {
      store = createMakerV8NativeContentStoreV8({ indexedDB, crypto: win?.crypto ?? globalThis.crypto,
        requirePersistentStorage: () => {
          if (typeof walrus?.persistence?.requirePersistentStorage !== 'function') fail('MAKER_V8_NATIVE_CONTENT_WALRUS_REQUIRED');
          return walrus.persistence.requirePersistentStorage();
        } });
      provider = createMakerV8NativeContentProviderV8({ store, walrus, receiver: receive(), locks: win?.navigator?.locks,
        resolveAuthority: scope => resolve(scope, false), resolveCompletionAuthority: scope => resolve(scope, true) });
    }
    return provider;
  }
  return Object.freeze({
    // Configuration only; live authority, wallet and receiver checks remain in preflight.
    isConfigured() {
      const crypto = win?.crypto ?? globalThis.crypto;
      return !disposed && Boolean(runtime.nativeSoulIntegration)
        && typeof client?.getObject === 'function'
        && typeof client?.core?.getObject === 'function'
        && typeof wallet?.getCurrentAccount === 'function'
        && typeof createSealClient === 'function'
        && typeof indexedDB?.open === 'function'
        && typeof crypto?.getRandomValues === 'function'
        && ['generateKey', 'encrypt', 'decrypt'].every(name => typeof crypto?.subtle?.[name] === 'function')
        && typeof win?.navigator?.locks?.request === 'function'
        && typeof walrus?.persistence?.requirePersistentStorage === 'function'
        && ['prepare', 'load', 'resume', 'requestSignature', 'loadContent']
          .every(name => typeof walrus?.publisher?.[name] === 'function')
        && (receiver ? ['open', 'preflight', 'sync'].every(name => typeof receiver[name] === 'function')
          : typeof win?.open === 'function' && typeof win?.addEventListener === 'function'
            && typeof win?.location?.origin === 'string' && win.location.origin !== 'null');
    },
    // Called synchronously in the original Complete button's user gesture.
    open(scope) { receive().open(scope); },
    ...Object.fromEntries(['preflight', 'prepare', 'finalize', 'exportRecovery', 'loadCompletion', 'saveCompletion', 'clearCompletion', 'retireFinalizedCompletion']
      .map(method => [method, async input => {
        await assertWallet(input);
        const guarded = ['prepare', 'finalize'].includes(method) && typeof input.assertBeforeSignature === 'function'
          ? { ...input, async assertBeforeSignature(step) {
            await assertWallet(input); await input.assertBeforeSignature(step); await assertWallet(input);
          } } : input;
        return content()[method](guarded);
      }])),
    async dispose() { disposed = true; receiver?.dispose?.(); await store?.close(); },
  });
}
