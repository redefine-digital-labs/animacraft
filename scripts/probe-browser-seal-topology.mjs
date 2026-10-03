// Read-only candidate evidence, NOT release configuration or an approved policy.
// No wallet, user data, signature, encryption key or fetch_key POST is involved.
import { createMakerV8BrowserSealClient } from '../maker-v8-seal-browser.js';
const candidates = [
  { objectId: '0xe0eb52eba9261b96e895bbb4deca10dcd64fbc626a1133017adcd5131353fd10', weight: 1 },
  { objectId: '0x145540d931f182fef76467dd8074c9839aea126852d90d18e1556fcbbd1208b6', weight: 1 },
];
const client = await createMakerV8BrowserSealClient({ serverConfigs: candidates });
const servers = [...(await client.getKeyServers()).values()];
const evidence = [];
for (const server of servers) {
  const cors = [];
  for (const origin of ['https://animacraft.soulidity.ai', 'https://www.soulidity.ai']) {
    const response = await fetch(server.url + '/v1/fetch_key', {
      method: 'OPTIONS', redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(10000),
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,request-id,client-sdk-type,client-sdk-version' },
    });
    const allowOrigin = response.headers.get('access-control-allow-origin');
    const allowMethods = response.headers.get('access-control-allow-methods');
    const allowHeaders = response.headers.get('access-control-allow-headers');
    if (!response.ok || !['*', origin].includes(allowOrigin)
      || !(allowMethods === '*' || allowMethods?.includes('POST'))
      || !(allowHeaders === '*' || ['content-type', 'request-id', 'client-sdk-type', 'client-sdk-version']
        .every(header => allowHeaders?.toLowerCase().includes(header)))) {
      throw new Error('Candidate CORS preflight failed: ' + server.objectId);
    }
    cors.push({ origin, status: response.status, allowOrigin, allowMethods, allowHeaders });
  }
  evidence.push({ objectId: server.objectId, name: server.name, url: server.url,
    serverType: server.serverType, publicKeyProofOfPossessionVerified: true, cors });
}
console.log(JSON.stringify({ schemaVersion: 'animacraft.browser-seal-candidate-probe.v1',
  observedAt: new Date().toISOString(), network: 'mainnet',
  releasedPolicy: false, authorizedDecryptionTested: false,
  limitation: 'Open services may rate-limit or fail; PoP and CORS are not a wallet-authorized decrypt or availability SLA.',
  servers: evidence }, null, 2));
