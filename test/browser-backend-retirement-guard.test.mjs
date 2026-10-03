import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import {
  assertBrowserBackendRetirementText, assertBrowserBackendRetirementSource,
  assertBrowserBackendRetirementDist, browserBackendRetirementPlugin,
} from '../scripts/browser-backend-retirement-guard.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animacraft-browser-guard-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    const path = join(root, name); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  put('index.html', '<script type="module" src="/app.js"></script>');
  put('app.js', 'document.body.textContent = "browser";');
  return { root, put };
}

test('guard rejects retired APIs, Node crypto and server-only adapter/config', () => {
  for (const text of [
    'fetch("/api/protected-render")', 'fetch("/api/seal-key")',
    'process.env.ANIMACRAFT_SEAL_API_KEY', 'process.env.ANIMACRAFT_V8_RUNTIME_JSON',
    'import { randomBytes } from "node:crypto"', 'import crypto from "crypto"',
    'const url = "https://seal-aggregator-mainnet.mystenlabs.com"',
    'createAnimacraftV8SealKeyProxyHandler()', 'const config = { aggregatorUrl: url }',
    'const config = { apiKeyName: "X-API-Key", apiKey: secret }',
    'const config = { "aggregatorUrl": url, "apiKey": secret }',
  ]) assert.throws(() => assertBrowserBackendRetirementText(text, 'fixture', { source: true }),
    /Browser retirement guard/);
  // Seal SDK contains inert aggregator support, not an app-configured proxy.
  assert.doesNotThrow(() => assertBrowserBackendRetirementText('x.aggregatorUrl; x.apiKey;', 'sdk.js'));
});

test('source scans current root/public modules, not historical documents, fixtures or Node tools', t => {
  const { root, put } = fixture(t);
  put('docs/history.md', 'ANIMACRAFT_SEAL_API_KEY');
  put('test/fixture.js', 'fetch("/api/seal-key")');
  put('scripts/tool.mjs', 'import crypto from "node:crypto";');
  assert.equal(assertBrowserBackendRetirementSource(root), 2);
  put('public-v8/config.js', 'const key = "ANIMACRAFT_SEAL_API_KEY";');
  assert.throws(() => assertBrowserBackendRetirementSource(root), /private server environment/);
});

test('retired handlers and invalid/missing artifacts fail closed', t => {
  const { root, put } = fixture(t);
  put('api/seal-key.js', 'export default () => {};');
  assert.throws(() => assertBrowserBackendRetirementSource(root), /retired handler remains/);
  assert.throws(() => assertBrowserBackendRetirementDist(join(root, 'missing')), /complete browser build/);
  put('dist/index.html', '<p>browser</p>');
  put('dist/assets/chunk.js', 'fetch("/api/protected-render")');
  assert.throws(() => assertBrowserBackendRetirementDist(join(root, 'dist')), /retired protected API/);
});

test('real Vite build runs source, nested-import and emitted-artifact guards', async t => {
  const { root, put } = fixture(t);
  const compile = plugins => build({ root, configFile: false, logLevel: 'silent',
    plugins: [browserBackendRetirementPlugin(), ...plugins],
    build: { outDir: join(root, 'out') } });
  await compile([]);
  assert.ok(assertBrowserBackendRetirementDist(join(root, 'out')) > 0);
  put('app.js', 'import "./nested/leak.js";');
  put('nested/leak.js', 'globalThis.value = "ANIMACRAFT_SEAL_API_KEY";');
  await assert.rejects(compile([]), /private server environment/);
  put('app.js', 'document.body.textContent = "browser";');
  await assert.rejects(compile([{ name: 'fixture-emitted-leak',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'leaked.js',
      source: 'fetch("/api/seal-key")' }); } }]), /retired protected API/);
});

test('production deployment build and existing release scan retain the guard', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  assert.match(readFileSync(join(root, 'vite.config.js'), 'utf8'), /plugins:\s*\[browserBackendRetirementPlugin\(\)\]/);
  const scan = readFileSync(join(root, 'scripts/fresh-v8-delivery-scan.mjs'), 'utf8');
  assert.match(scan, /assertBrowserBackendRetirementSource\(root\)/);
  assert.match(scan, /assertBrowserBackendRetirementDist\(dist\)/);
  assert.ok(assertBrowserBackendRetirementSource(root) > 0);
});
