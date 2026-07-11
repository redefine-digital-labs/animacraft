import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeRuntimeConfig, validateRuntimeConfig } from '../runtime-config.js';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const network = args.has('--network');
const requireSoulidity = args.has('--require-soulidity');
const json = args.has('--json');
const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail: String(detail || '') });
}

async function deadline(label, task, timeout = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeout);
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function loadPublicConfig() {
  const source = await readFile(new URL('../public/config.js', import.meta.url), 'utf8');
  const context = vm.createContext({ window: {} });
  new vm.Script(source, { filename: 'public/config.js' }).runInContext(context, { timeout: 1_000 });
  return normalizeRuntimeConfig(context.window.ANIMACRAFT_CONFIG || {});
}

async function checkHttp(name, url, path) {
  try {
    const response = await deadline(name, (signal) => fetch(`${String(url).replace(/\/$/, '')}${path}`, { signal }));
    record(name, response.ok, `HTTP ${response.status}`);
  } catch (error) {
    record(name, false, error.message);
  }
}

async function checkNetwork(config, validation) {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: config.grpcUrl });
  try {
    const result = await deadline('Sui gRPC', () => client.core.getChainIdentifier());
    record('Sui gRPC', Boolean(result.chainIdentifier), result.chainIdentifier || 'Missing chain identifier');
  } catch (error) {
    record('Sui gRPC', false, error.message);
  }

  try {
    const makerEventType = validation.packageReady
      ? `${config.packageId}::animacraft::OCMakerPublished`
      : null;
    const query = makerEventType
      ? `query PublishedAnimacraftMakers($type: String!) {
          chainIdentifier
          events(filter: { type: $type }, last: 1) {
            pageInfo { hasPreviousPage startCursor }
            nodes { contents { json } }
          }
        }`
      : '{ chainIdentifier }';
    const response = await deadline('Sui GraphQL', (signal) => fetch(config.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        ...(makerEventType ? { variables: { type: makerEventType } } : {}),
      }),
      signal,
    }));
    const body = await response.json();
    const eventQueryReady = !makerEventType || Array.isArray(body.data?.events?.nodes);
    const detail = body.errors?.[0]?.message
      || (body.data?.chainIdentifier
        ? `${body.data.chainIdentifier}${makerEventType ? '; Maker event query OK' : ''}`
        : `HTTP ${response.status}`);
    record(
      'Sui GraphQL',
      response.ok && Boolean(body.data?.chainIdentifier) && eventQueryReady && !body.errors?.length,
      detail,
    );
  } catch (error) {
    record('Sui GraphQL', false, error.message);
  }

  await Promise.all([
    checkHttp('Walrus aggregator', config.walrusAggregatorUrl, '/v1/api'),
    checkHttp('Walrus upload relay', config.walrusUploadRelayUrl, '/v1/tip-config'),
  ]);

  if (validation.packageReady) {
    try {
      const result = await deadline('Animacraft package', () => client.core.getMoveFunction({
        packageId: config.packageId,
        moduleName: 'animacraft',
        name: 'protocol_version',
      }));
      record('Animacraft package', result.function?.name === 'protocol_version', `${config.packageId}::animacraft::protocol_version`);
    } catch (error) {
      record('Animacraft package', false, error.message);
    }
  }

  if (validation.soulidityReady) {
    const soulidityMintFunction = config.canonicalSoulMintEnabled
      ? 'mint_animacraft_in_personal_kiosk'
      : 'mint_imported_in_personal_kiosk';
    try {
      const result = await deadline('Soulidity package', () => client.core.getMoveFunction({
        packageId: config.soulidityPackageId,
        moduleName: 'market',
        name: soulidityMintFunction,
      }));
      record(
        'Soulidity package',
        result.function?.name === soulidityMintFunction,
        `${config.soulidityPackageId}::market::${soulidityMintFunction}`,
      );
    } catch (error) {
      record('Soulidity package', false, error.message);
    }
  }

  const featuredIds = Object.values(config.featuredMakers || {});
  if (featuredIds.length) {
    try {
      const result = await deadline('Featured Makers', () => client.getObjects({ objectIds: featuredIds, include: { json: true } }));
      const failures = result.objects.filter((object) => object instanceof Error);
      record('Featured Makers', failures.length === 0, failures.length ? failures.map((error) => error.message).join('; ') : `${result.objects.length} object(s)`);
    } catch (error) {
      record('Featured Makers', false, error.message);
    }
  }
}

const config = await loadPublicConfig();
const validation = validateRuntimeConfig(config, { strict, requireSoulidity });
validation.errors.forEach((message) => record('Runtime config', false, message));
validation.warnings.forEach((message) => record('Runtime config warning', true, message));
if (!validation.errors.length) record('Runtime config', true, strict ? 'Strict production fields are complete.' : 'Source configuration is structurally valid.');
if (network) await checkNetwork(config, validation);

const failed = checks.filter((check) => !check.ok);
if (json) {
  process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, strict, network, checks }, null, 2)}\n`);
} else {
  checks.forEach((check) => process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}\n`));
  process.stdout.write(`\n${failed.length ? `${failed.length} preflight check(s) failed.` : 'Animacraft preflight passed.'}\n`);
}
process.exitCode = failed.length ? 1 : 0;
