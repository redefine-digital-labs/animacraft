import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMakerV8BrowserSealServers, createMakerV8DirectSealFetch,
  createMakerV8BrowserSealClient } from '../maker-v8-seal-browser.js';

const id = n => `0x${n.toString(16).padStart(64, '0')}`;
const committee = '0x686098f1439237fff9f36b99c7329683c22979d2005c2465cb891acb012a7595';
test('browser policy preserves exact independently weighted identities and rejects secret topology', async () => {
  const rows = [{ objectId: id(1), weight: 1 }, { objectId: id(2), weight: 1 }];
  const checked = assertMakerV8BrowserSealServers(rows);
  assert.deepEqual(checked, rows);
  rows[0].weight = 9;
  assert.equal(checked[0].weight, 1);
  for (const bad of [[], [{ objectId: committee, weight: 1 }],
    [{ objectId: id(1), weight: 1, apiKey: 'do-not-send' }],
    [{ objectId: id(1), weight: 1, aggregatorUrl: 'https://example.org' }],
    [{ objectId: id(1), weight: 254 }, { objectId: id(2), weight: 1 }],
    [{ objectId: id(1), weight: 1 }, { objectId: id(1), weight: 1 }]]) {
    assert.throws(() => assertMakerV8BrowserSealServers(bad),
      { code: 'MAKER_V8_PROTECTED_BROWSER_TOPOLOGY_UNAVAILABLE' });
  }
  await assert.rejects(createMakerV8BrowserSealClient({ client: {},
    serverConfigs: [{ objectId: committee, weight: 1 }] }),
  { code: 'MAKER_V8_PROTECTED_BROWSER_TOPOLOGY_UNAVAILABLE' });
});

test('direct browser fetch retains SDK headers and cancellation without proxy or credentials', async () => {
  let observed;
  const fetch = createMakerV8DirectSealFetch(async (url, options) => {
    observed = { url, options }; return { ok: true };
  });
  const controller = new AbortController();
  await fetch('https://keys.example/v1/fetch_key', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Request-Id': 'test',
      'Client-Sdk-Type': 'typescript', 'Client-Sdk-Version': 'test' },
    body: '{"ptb":"authorized-proof"}', signal: controller.signal });
  assert.equal(observed.url, 'https://keys.example/v1/fetch_key');
  assert.equal(observed.options.credentials, 'omit');
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.signal, controller.signal);
  assert.equal(observed.options.headers.get('request-id'), 'test');
  await fetch('https://keys.example/v1/service?service_id=' + id(1), { method: 'GET' });
  for (const [url, options] of [
    ['/api/seal-key', { method: 'POST' }],
    ['http://keys.example/v1/fetch_key', { method: 'POST' }],
    ['https://keys.example/v1/fetch_key', { method: 'POST', headers: { 'X-API-Key': 'secret' } }],
    ['https://user:secret@keys.example/v1/fetch_key', { method: 'POST' }],
    ['https://keys.example/other', { method: 'POST' }],
  ]) assert.throws(() => fetch(url, options),
    { code: 'MAKER_V8_PROTECTED_BROWSER_TOPOLOGY_UNAVAILABLE' });
});
