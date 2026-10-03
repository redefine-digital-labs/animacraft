// Read-only release prerequisite evidence, not wallet-authorized decryption.
// No wallet, user data, signature, encryption key or fetch_key POST is involved.
import { preflightMainnetV8BrowserSeal } from './mainnet-v8-release.mjs';
import { buildSealPolicy, MAINNET_V8_BROWSER_KEY_SERVERS, MAINNET_V8_BROWSER_SEAL_THRESHOLD }
  from './mainnet-v8-release-lib.mjs';
const sealPolicy = buildSealPolicy({
  keyServers: MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId }) => ({ objectId, weight: '1' })),
  threshold: MAINNET_V8_BROWSER_SEAL_THRESHOLD,
});
const evidence = await preflightMainnetV8BrowserSeal({ sealPolicy });
console.log(JSON.stringify({ schemaVersion: 'animacraft.browser-seal-candidate-probe.v1',
  observedAt: new Date().toISOString(), network: 'mainnet',
  releasedPolicy: false, ...evidence,
  limitation: 'Public services may rate-limit or fail; PoP and browser CORS are not an authorized decrypt or availability SLA.',
}, null, 2));
