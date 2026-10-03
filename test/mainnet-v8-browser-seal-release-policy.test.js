import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { buildSealPolicy, MAINNET_V8_BROWSER_KEY_SERVERS,
  MAINNET_V8_BROWSER_KEY_SERVER_TYPE } from '../scripts/mainnet-v8-release-lib.mjs';
import { preflightMainnetV8BrowserSeal, certifyMainnetV8SealKeyServers }
  from '../scripts/mainnet-v8-release.mjs';

const publicServers = [
  { objectId: '0x145540d931f182fef76467dd8074c9839aea126852d90d18e1556fcbbd1208b6', weight: '1' },
  { objectId: '0xe0eb52eba9261b96e895bbb4deca10dcd64fbc626a1133017adcd5131353fd10', weight: '1' },
];

test('fresh Mainnet release policy accepts the verified two-of-two no-secret browser topology', () => {
  const policy = buildSealPolicy({ keyServers: publicServers, threshold: '2' });
  assert.deepEqual(policy.keyServers, publicServers);
  assert.equal(policy.threshold, '2');
});

test('fresh Mainnet release rejects the obsolete credential-only committee before any publication', () => {
  assert.throws(() => buildSealPolicy({
    keyServers: [{ objectId: '0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595', weight: '1' }],
    threshold: '1',
  }), { code: 'MAINNET_V8_SEAL_POLICY_INVALID' });
});

const policy = () => buildSealPolicy({ keyServers: publicServers, threshold: '2' });
function dependencies() {
  const calls = [];
  const servers = new Map(MAINNET_V8_BROWSER_KEY_SERVERS.map(row => [row.objectId,
    { objectId: row.objectId, serverType: 'Independent', url: row.url }]));
  return { calls, servers,
    createClient: async options => {
      assert.deepEqual(options.serverConfigs, publicServers.map(row => ({ ...row, weight: 1 })));
      return { getKeyServers: async () => servers };
    },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: 200, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, request-id, client-sdk-type, client-sdk-version',
        'access-control-expose-headers': 'X-KeyServer-Version', 'x-keyserver-version': '0.4.1',
      } });
    },
  };
}

test('preflight checks the exact browser topology and both production origins without credentials', async () => {
  const deps = dependencies();
  const result = await preflightMainnetV8BrowserSeal({ sealPolicy: policy(), ...deps });
  assert.equal(result.authorizedDecryptionTested, false);
  assert.equal(deps.calls.length, 12);
  for (const { url, options } of deps.calls) {
    assert.ok(MAINNET_V8_BROWSER_KEY_SERVERS.some(row => url === row.url + '/v1/fetch_key'
      || url === row.url + '/v1/service?service_id=' + row.objectId));
    assert.ok(['OPTIONS', 'GET'].includes(options.method));
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(Object.keys(options.headers).sort(), options.method === 'GET'
      ? ['Client-Sdk-Type', 'Client-Sdk-Version', 'Content-Type', 'Origin', 'Request-Id'] :
      ['Access-Control-Request-Headers', 'Access-Control-Request-Method', 'Origin']);
  }
});

test('service GET CORS and exposed SDK version are mandatory, not just fetch-key preflight', async () => {
  for (const mutation of [
    headers => headers.delete('access-control-allow-origin'),
    headers => headers.delete('access-control-expose-headers'),
    headers => headers.delete('x-keyserver-version'),
    headers => headers.set('access-control-expose-headers', 'not-x-keyserver-version'),
  ]) {
    const deps = dependencies();
    const original = deps.fetcher;
    deps.fetcher = async (url, options) => {
      const response = await original(url, options);
      if (options.method === 'GET') mutation(response.headers);
      return response;
    };
    await assert.rejects(preflightMainnetV8BrowserSeal({ sealPolicy: policy(), ...deps }),
      { code: 'MAINNET_V8_BROWSER_SEAL_UNAVAILABLE' });
  }
});

test('preflight rejects unavailable PoP, incomplete topology, type and URL drift before any CORS request', async () => {
  for (const mutation of [
    deps => { deps.createClient = async () => { throw new Error('PoP failed'); }; },
    deps => deps.servers.delete(publicServers[0].objectId),
    deps => { deps.servers.get(publicServers[0].objectId).serverType = 'Committee'; },
    deps => { deps.servers.get(publicServers[0].objectId).url += '/unexpected'; },
  ]) {
    const deps = dependencies();
    mutation(deps);
    await assert.rejects(preflightMainnetV8BrowserSeal({ sealPolicy: policy(), ...deps }));
    assert.equal(deps.calls.length, 0);
  }
});

test('CORS denial, non-token matches and network errors fail closed', async () => {
  for (const headers of [
    {},
    { 'access-control-allow-origin': 'https://other.example', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' },
    { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'XPOST', 'access-control-allow-headers': '*' },
    { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'x-content-type,request-id,client-sdk-type,client-sdk-version' },
  ]) {
    await assert.rejects(preflightMainnetV8BrowserSeal({ sealPolicy: policy(), ...dependencies(),
      fetcher: async () => new Response(null, { status: 200, headers }),
    }), { code: 'MAINNET_V8_BROWSER_SEAL_UNAVAILABLE' });
  }
  await assert.rejects(preflightMainnetV8BrowserSeal({ sealPolicy: policy(), ...dependencies(),
    fetcher: async () => { throw new Error('network unavailable'); },
  }), /network unavailable/);
});

function objectTransport(mutate = () => {}) {
  return { getObject: async ({ id }) => {
    const pin = MAINNET_V8_BROWSER_KEY_SERVERS.find(row => row.objectId === id);
    const bytes = Buffer.concat([Buffer.from(id.slice(2), 'hex'), Buffer.from('01000000000000000100000000000000', 'hex')]);
    const data = { objectId: id, version: '1', type: MAINNET_V8_BROWSER_KEY_SERVER_TYPE,
      digest: 'CUMYYRGzJf1kaCRVYbtzwhJfukMigrQ3E7FUahj5woa4',
      previousTransaction: 'BL9H4MDJJsQnq9Z9s83BYgpEbBcfzAyok4vwmNLEdwHP',
      owner: { AddressOwner: pin.owner },
      content: { dataType: 'moveObject', type: MAINNET_V8_BROWSER_KEY_SERVER_TYPE,
        fields: { id, first_version: '1', last_version: '1' } },
      bcs: { dataType: 'moveObject', type: MAINNET_V8_BROWSER_KEY_SERVER_TYPE,
        version: '1', bcsBytes: bytes.toString('base64') } };
    mutate(data);
    return { data };
  } };
}

test('key-server certificates bind both exact raw identities, owners and content hashes', async () => {
  const result = await certifyMainnetV8SealKeyServers({ sealPolicy: policy(), ...dependencies(), transport: objectTransport() });
  assert.deepEqual(result.map(({ objectId, owner, contentSha256 }) => ({ objectId, owner, contentSha256 })),
    MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId, owner, contentSha256 }) => ({ objectId, owner, contentSha256 })));
});

test('key-server certification rejects owner kind, type, projection and raw BCS drift', async () => {
  for (const mutation of [
    data => { data.owner = { ObjectOwner: data.owner.AddressOwner }; },
    data => { data.owner.AddressOwner = publicServers[0].objectId; },
    data => { data.type += 'Other'; },
    data => { data.bcs.version = '2'; },
    data => { data.content.fields.first_version = '2'; },
    data => { data.bcs.bcsBytes = Buffer.concat([Buffer.from(data.bcs.bcsBytes, 'base64'), Buffer.from([0])]).toString('base64'); },
  ]) {
    await assert.rejects(certifyMainnetV8SealKeyServers({ sealPolicy: policy(), ...dependencies(),
      transport: objectTransport(mutation),
    }));
  }
});

test('prepare certifies browser dependencies before source/build/READY; live signing and setup also recertify', async () => {
  const source = await fs.readFile(new URL('../scripts/mainnet-v8-release.mjs', import.meta.url), 'utf8');
  const prepare = source.slice(source.indexOf('export async function prepareMainnetV8Release('));
  assert.ok(prepare.indexOf('await certifyMainnetV8SealKeyServers(') < prepare.indexOf('await prepareMainnetV8Source('));
  assert.match(source, /if \(step\.kind === 'PUBLISH'\) \{\s+await certifyMainnetV8SealKeyServers\(\{ transport, sealPolicy: wal\.plan\.sealPolicy \}\)/);
  assert.equal((source.match(/certifyMainnetV8SealKeyServers\(\{ transport, sealPolicy: wal\.finalManifest\.sealPolicy \}\)/g) ?? []).length, 2);
});
