import {
  createAnimacraftV8ProtectedIdentityVerifier,
  createAnimacraftV8ProtectedAssetIdentityVerifier,
} from './maker-v8-protected-identity.js';
import {
  createMakerV8ProtectedRenderServiceV8, createMakerV8ProtectedAssetServiceV8,
  MAKER_V8_PROTECTED_TRANSPORT_SCHEMA,
} from './maker-v8-protected-transport.js';
import { createMakerV8BrowserSealClient, createMakerV8DirectSealFetch,
  assertMakerV8BrowserSealServers } from './maker-v8-seal-browser.js';

export function createMakerV8ProtectedBrowserTransportV8({
  runtime, transport, client, fetcher = globalThis.fetch,
  createSealClient = createMakerV8BrowserSealClient,
} = {}) {
  const verifyRender = createAnimacraftV8ProtectedIdentityVerifier({ runtime, transport });
  const verifyAsset = createAnimacraftV8ProtectedAssetIdentityVerifier({ runtime, transport });
  const sealFetch = createMakerV8DirectSealFetch(fetcher);
  // Each invocation owns its proof; simultaneous publications cannot overwrite
  // one another's policy between attestation and encryption.
  const run = async (value, asset) => {
    let verified;
    const service = (asset ? createMakerV8ProtectedAssetServiceV8 : createMakerV8ProtectedRenderServiceV8)({
      async verifyIdentity(identity) {
        verified = await (asset ? verifyAsset : verifyRender)(identity);
        assertMakerV8BrowserSealServers(verified.serverConfigs);
        return verified;
      },
      async encrypt(input) {
        let result;
        try {
          const seal = await createSealClient({ client, serverConfigs: verified.serverConfigs, sealFetch });
          result = await seal.encrypt(input);
          return result;
        } finally {
          input.data.fill(0);
          if (result?.key instanceof Uint8Array) result.key.fill(0);
        }
      },
    });
    return asset ? service.protectAsset(value) : service.protect(value);
  };
  return Object.freeze({ schemaVersion: MAKER_V8_PROTECTED_TRANSPORT_SCHEMA,
    protect: value => run(value, false), protectAsset: value => run(value, true) });
}
