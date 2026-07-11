import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeRuntimeConfig, validateRuntimeConfig } from '../runtime-config.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const requestedUrl = args.find((arg) => arg.startsWith('--url='))?.slice('--url='.length);
const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail: String(detail || '') });
}

function parseConfig(source, filename) {
  const context = vm.createContext({ window: {} });
  new vm.Script(source, { filename }).runInContext(context, { timeout: 1_000 });
  return normalizeRuntimeConfig(context.window.ANIMACRAFT_CONFIG || {});
}

async function loadExpectedConfig() {
  const source = await readFile(new URL('../public/config.js', import.meta.url), 'utf8');
  return parseConfig(source, 'public/config.js');
}

async function fetchText(label, url, timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeout);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function sameObject(left, right) {
  const sorted = (value) => JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort()));
  return sorted(left) === sorted(right);
}

const expected = await loadExpectedConfig();
let origin;
try {
  origin = new URL(requestedUrl || expected.appUrl);
  origin.pathname = '/';
  origin.search = '';
  origin.hash = '';
  record('Production origin', origin.protocol === 'https:', origin.href);
} catch (error) {
  record('Production origin', false, error.message);
}

if (origin) {
  try {
    const { response, text } = await fetchText('Application shell', origin);
    const csp = response.headers.get('content-security-policy') || '';
    const securityHeaders = [
      response.headers.get('strict-transport-security'),
      response.headers.get('x-content-type-options') === 'nosniff',
      response.headers.get('referrer-policy'),
      response.headers.get('permissions-policy'),
      csp.includes("object-src 'none'"),
      csp.includes("frame-ancestors 'none'"),
      csp.includes("worker-src 'self' blob:"),
      csp.includes("'wasm-unsafe-eval'"),
    ].every(Boolean);
    record('Application shell', response.ok && text.includes('The Fully onchain Character Maker & Creator'), `HTTP ${response.status}`);
    record('Security headers', securityHeaders, securityHeaders ? 'Required production headers are present.' : 'One or more required headers are missing.');
  } catch (error) {
    record('Application shell', false, error.message);
  }

  let remote;
  try {
    const configUrl = new URL('/config.js', origin);
    const { response, text } = await fetchText('Runtime config', configUrl);
    record('Runtime config response', response.ok, `HTTP ${response.status}`);
    record('Runtime config cache', (response.headers.get('cache-control') || '').includes('no-store'), response.headers.get('cache-control') || 'Missing Cache-Control');
    remote = parseConfig(text, configUrl.href);
  } catch (error) {
    record('Runtime config response', false, error.message);
  }

  if (remote) {
    const validation = validateRuntimeConfig(remote, { strict: true, requireSoulidity: true });
    record('Runtime config validation', validation.valid, validation.errors.join('; ') || 'Strict Mainnet fields are valid.');
    const exactFields = [
      'network',
      'grpcUrl',
      'graphqlUrl',
      'packageId',
      'paymentCoinType',
      'paymentCoinSymbol',
      'paymentCoinDecimals',
      'walrusAggregatorUrl',
      'walrusUploadRelayUrl',
      'walrusRelayMaxTipMist',
      'walrusEpochs',
      'appUrl',
      'soulidityAppUrl',
      'soulidityPackageId',
      'canonicalSoulMintEnabled',
    ];
    const drift = exactFields.filter((field) => remote[field] !== expected[field]);
    if (!sameObject(remote.featuredMakers, expected.featuredMakers)) drift.push('featuredMakers');
    record('Deployed config matches Git', drift.length === 0, drift.length ? `Drift: ${drift.join(', ')}` : 'No runtime drift detected.');
  }

  for (const path of ['/maker/production-smoke', '/creator/production-smoke', '/oc/production-smoke']) {
    try {
      const url = new URL(path, origin);
      const { response, text } = await fetchText(`SPA route ${path}`, url);
      record(`SPA route ${path}`, response.ok && text.includes('The Fully onchain Character Maker & Creator'), `HTTP ${response.status}`);
    } catch (error) {
      record(`SPA route ${path}`, false, error.message);
    }
  }
}

const failed = checks.filter((check) => !check.ok);
if (json) {
  process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, origin: origin?.href || null, checks }, null, 2)}\n`);
} else {
  checks.forEach((check) => process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}\n`));
  process.stdout.write(`\n${failed.length ? `${failed.length} production smoke check(s) failed.` : 'Animacraft production deployment smoke passed.'}\n`);
}
process.exitCode = failed.length ? 1 : 0;
