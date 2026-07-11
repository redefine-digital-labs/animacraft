import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Vercel serves every SPA deep link through the clean root route', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.equal(config.cleanUrls, true);
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/' }]);
});

test('Vercel keeps runtime configuration uncached and ships required browser defenses', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const configHeaders = config.headers.find((rule) => rule.source === '/config.js')?.headers || [];
  const globalHeaders = config.headers.find((rule) => rule.source === '/(.*)')?.headers || [];
  const headerMap = Object.fromEntries(globalHeaders.map(({ key, value }) => [key.toLowerCase(), value]));

  assert.match(configHeaders.find(({ key }) => key === 'Cache-Control')?.value || '', /no-store/);
  assert.equal(headerMap['x-content-type-options'], 'nosniff');
  assert.match(headerMap['content-security-policy'], /object-src 'none'/);
  assert.match(headerMap['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(headerMap['content-security-policy'], /worker-src 'self' blob:/);
  assert.match(headerMap['content-security-policy'], /'wasm-unsafe-eval'/);
});
