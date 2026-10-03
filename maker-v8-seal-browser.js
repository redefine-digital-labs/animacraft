import { SealClient } from '@mysten/seal';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT } from './maker-v8-sui-grpc.js';

const CREDENTIAL_COMMITTEE = '0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595';
function fail(message) {
  const error = new Error(message);
  error.code = 'MAKER_V8_PROTECTED_BROWSER_TOPOLOGY_UNAVAILABLE';
  throw error;
}

// These are the exact on-chain policy IDs/weights, never a browser-selected
// replacement committee. No aggregator URL or API credential can enter here.
export function assertMakerV8BrowserSealServers(serverConfigs) {
  const seen = new Set();
  if (!Array.isArray(serverConfigs) || serverConfigs.length < 1 || serverConfigs.length > 64) {
    fail('The certified Seal key topology is unavailable.');
  }
  const servers = serverConfigs.map(row => {
    if (!row || Object.keys(row).sort().join(',') !== 'objectId,weight'
      || !/^0x[0-9a-f]{64}$/.test(row.objectId) || /^0x0+$/.test(row.objectId)
      || seen.has(row.objectId) || !Number.isSafeInteger(row.weight)
      || row.weight < 1 || row.weight > 254 || row.objectId === CREDENTIAL_COMMITTEE) {
      fail('The certified policy requires a browser-compatible no-secret Seal topology; release configuration is not ready.');
    }
    seen.add(row.objectId);
    return Object.freeze({ objectId: row.objectId, weight: row.weight });
  });
  if (servers.reduce((sum, row) => sum + row.weight, 0) >= 255) {
    fail('Seal total key weight exceeds its supported bound.');
  }
  return servers;
}

export function createMakerV8DirectSealFetch(fetcher = globalThis.fetch) {
  if (typeof fetcher !== 'function') fail('Browser fetch is unavailable.');
  return (value, init = {}) => {
    let url;
    try { url = new URL(value); } catch { fail('Seal endpoint is not an absolute URL.'); }
    const headers = new Headers(init.headers);
    const allowed = new Set(['content-type', 'request-id', 'client-sdk-type', 'client-sdk-version']);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || !((init.method === 'GET' && url.pathname.endsWith('/v1/service'))
        || (init.method === 'POST' && url.pathname.endsWith('/v1/fetch_key') && !url.search))
      || [...headers.keys()].some(name => !allowed.has(name))) {
      fail('Seal requested an unsupported endpoint or credential.');
    }
    return fetcher(url.href, { ...init, headers, credentials: 'omit',
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
  };
}

export async function createMakerV8BrowserSealClient({
  client = new SuiGrpcClient({ network: 'mainnet', baseUrl: MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT }),
  serverConfigs, sealFetch = createMakerV8DirectSealFetch(),
} = {}) {
  const servers = assertMakerV8BrowserSealServers(serverConfigs);
  const seal = new SealClient({ suiClient: client, serverConfigs: servers,
    verifyKeyServers: true, timeout: 10_000, fetch: sealFetch });
  const verified = await seal.getKeyServers();
  if (verified.size !== servers.length || servers.some(row =>
    verified.get(row.objectId)?.serverType !== 'Independent')) {
    fail('Seal key servers are not independently verified browser endpoints.');
  }
  return seal;
}
