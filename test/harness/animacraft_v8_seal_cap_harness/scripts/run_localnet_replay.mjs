#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertApprovedProtocolProfile,
  assertReplayMatchesEvidence,
  canonicalJson,
  EVIDENCE_SCENARIO_NAMES,
  loadAndVerifyEvidence,
  sha256Bytes,
} from './evidence.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const harnessDirectory = resolve(scriptDirectory, '..');
const root = resolve(harnessDirectory, '../../..');
const fixtureSource = join(harnessDirectory, 'fixture/slim-core');
const productionCoreSource = join(root, 'move/animacraft_v8_core');
const quickGate = join(scriptDirectory, 'verify_reproducibility.mjs');
const gasBudget = '100000000000';
const totalTimeoutMs = 15 * 60_000;
const transactionTimeoutMs = 45_000;
const deadline = Date.now() + totalTimeoutMs;
const temporaryPrefix = 'animacraft-seal-cap-localnet-';
const fullnodeRpcKeys = new Set(['json-rpc-address', 'json_rpc_address']);
const liveIndexMissingMessage = "the embedded rpc-store's live index has no committed checkpoint yet";
const liveIndexMissingStdout = `code: 'Some requested entity was not found', message: "Error { inner: Inner { kind: Missing, source: Some(\\\"${liveIndexMissingMessage}\\\") } }"`;
const testPublishMaximumAttempts = 6;
const testPublishRetryDelayMs = 500;

let localnet = null;
let localnetExit = null;
let temporaryRoot = null;
let cleanupPromise = null;

function fail(message) {
  throw new Error(`seal-cap localnet replay: ${message}`);
}

function checkedTemporaryRoot(path) {
  const target = resolve(path);
  const temporaryDirectory = resolve(tmpdir());
  if (dirname(target) !== temporaryDirectory
      || !basename(target).startsWith(temporaryPrefix)
      || !target.startsWith(join(temporaryDirectory, temporaryPrefix))) {
    fail(`refusing unsafe temporary root ${path}`);
  }
  return target;
}

function checkedTemporaryChild(path, label) {
  if (!temporaryRoot) fail(`${label} requested before temporary root creation`);
  const safeRoot = checkedTemporaryRoot(temporaryRoot);
  const target = resolve(path);
  if (!target.startsWith(`${safeRoot}${sep}`)) {
    fail(`refusing ${label} outside temporary root: ${path}`);
  }
  return target;
}

function prepareTemporaryWorkspace() {
  temporaryRoot = checkedTemporaryRoot(
    mkdtempSync(join(resolve(tmpdir()), temporaryPrefix)),
  );
  return {
    fixtureDirectory: checkedTemporaryChild(
      join(temporaryRoot, 'slim-core'),
      'fixture directory',
    ),
    publicationFile: checkedTemporaryChild(
      join(temporaryRoot, 'SlimPublished.toml'),
      'publication file',
    ),
  };
}

function prepareNetworkDirectory(attempt) {
  const name = attempt === 1 ? 'network' : `network-retry-${attempt}`;
  const networkDirectory = checkedTemporaryChild(
    join(temporaryRoot, name),
    'network directory',
  );
  mkdirSync(networkDirectory, { mode: 0o700, recursive: true });
  if (!statSync(networkDirectory).isDirectory()) {
    fail('network directory was not created before genesis');
  }
  return networkDirectory;
}

function remaining(maximum) {
  const value = Math.min(maximum, deadline - Date.now());
  if (value <= 0) fail(`exceeded the bounded ${totalTimeoutMs / 60_000}-minute runtime`);
  return value;
}

function scrubbedEnvironment() {
  const overrides = Object.keys(process.env)
    .filter((name) => name.startsWith('SUI_PROTOCOL_CONFIG_OVERRIDE'));
  if (overrides.length > 0) {
    fail(`refusing protocol overrides: ${overrides.join(', ')}`);
  }
  return {
    ...process.env,
    NO_PROXY: [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(','),
  };
}

const childEnvironment = scrubbedEnvironment();

function run(command, args, { allowFailure = false, timeoutMs = transactionTimeoutMs } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    process.stdout.write(`+ ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, {
      cwd: root,
      detached: true,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const limit = 64 * 1024 * 1024;
    const collect = (chunks, key) => (chunk) => {
      if (key === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes > limit || stderrBytes > limit) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
        rejectRun(new Error(`${command} output exceeded ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdout, 'stdout'));
    child.stderr.on('data', collect(stderr, 'stderr'));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, remaining(timeoutMs));
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (!allowFailure && code !== 0) {
        rejectRun(new Error(
          `${command} exited ${code ?? signal}: ${(result.stderr || result.stdout).trim()}`,
        ));
      } else {
        resolveRun(result);
      }
    });
  });
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output.trim());
  } catch (error) {
    fail(`${label} did not return JSON: ${error.message}`);
  }
}

function combinedCommandOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function normalizedCommandStream(stream) {
  return String(stream ?? '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .trim();
}

function jsonContainsExecutionEvidence(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(jsonContainsExecutionEvidence);
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:digest|transactionDigest|effects|rawEffects|objectChanges|balanceChanges)$/i.test(key)) {
      return true;
    }
    if (jsonContainsExecutionEvidence(child)) return true;
  }
  return false;
}

function hasTransactionExecutionEvidence(result) {
  const stdout = result.stdout?.trim();
  if (stdout) {
    try {
      if (jsonContainsExecutionEvidence(JSON.parse(stdout))) return true;
    } catch {}
  }
  const combined = combinedCommandOutput(result);
  return /\btransaction(?:\s+digest)?\s*(?::|=|is)?\s*['"]?[1-9A-HJ-NP-Za-km-z]{40,}\b/i.test(combined)
    || /["'](?:digest|transactionDigest)["']\s*:\s*["'][1-9A-HJ-NP-Za-km-z]{40,}\b/i.test(combined);
}

function isPreExecutionLiveIndexMissing(result) {
  return result.code !== 0
    && result.signal === null
    && normalizedCommandStream(result.stdout) === liveIndexMissingStdout
    && normalizedCommandStream(result.stderr) === ''
    && !hasTransactionExecutionEvidence(result);
}

async function runTestPublishWithRetry(
  invoke,
  {
    wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs)),
    onRetry = (attempt) => process.stderr.write(
      `retry: pre-execution embedded rpc-store live index missing (${attempt}/${testPublishMaximumAttempts})\n`,
    ),
  } = {},
) {
  let result = null;
  for (let attempt = 1; attempt <= testPublishMaximumAttempts; attempt += 1) {
    result = await invoke(attempt);
    if (result.code === 0 || !isPreExecutionLiveIndexMissing(result)) return result;
    if (attempt < testPublishMaximumAttempts) {
      onRetry(attempt);
      await wait(testPublishRetryDelayMs);
    }
  }
  return result;
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(address.port);
      });
    });
  });
}

function checkedRpcPort(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    fail(`${label} is not a valid TCP port: ${value}`);
  }
  return value;
}

function parseRpcEndpoint(value, label) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(value);
  if (!match) fail(`${label} is not an IPv4 host:port scalar: ${value}`);
  const octets = match[1].split('.').map(Number);
  if (octets.some((octet) => octet > 255)) {
    fail(`${label} has an invalid IPv4 address: ${value}`);
  }
  return {
    address: value,
    host: match[1],
    port: checkedRpcPort(Number(match[2]), `${label} port`),
  };
}

function parseFullnodeRpcBinding(yaml, label = 'fullnode config') {
  if (typeof yaml !== 'string' || yaml.length === 0) {
    fail(`${label} is empty or not text`);
  }
  const bindings = [];
  const unknownKeys = [];
  const topLevelScalar = /^([A-Za-z0-9_-]+):([^\r\n]*)(?:\r?\n|$)/gm;
  for (const match of yaml.matchAll(topLevelScalar)) {
    const key = match[1];
    const normalizedKey = key.replaceAll('-', '').replaceAll('_', '').toLowerCase();
    if (normalizedKey !== 'jsonrpcaddress') continue;
    if (!fullnodeRpcKeys.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    const valueText = match[2];
    const scalar = /^(\s*)("([^"\\\r\n]*)"|'([^'\r\n]*)'|([^\s#]+))(\s*(?:#.*)?)$/.exec(valueText);
    if (!scalar) {
      fail(`${label} ${key} must be one plain or quoted host:port scalar`);
    }
    const scalarStart = match.index + key.length + 1 + scalar[1].length;
    bindings.push({
      address: scalar[3] ?? scalar[4] ?? scalar[5],
      key,
      scalarEnd: scalarStart + scalar[2].length,
      scalarStart,
    });
  }
  if (unknownKeys.length > 0) {
    fail(`${label} has unknown JSON-RPC bind key(s): ${unknownKeys.join(', ')}`);
  }
  if (bindings.length !== 1) {
    fail(`${label} must contain exactly one JSON-RPC bind, found ${bindings.length}`);
  }
  return bindings[0];
}

function rewriteFullnodeRpcLoopback(yaml, rpcPort, label = 'fullnode config') {
  const port = checkedRpcPort(rpcPort, 'chosen JSON-RPC port');
  const binding = parseFullnodeRpcBinding(yaml, label);
  const endpoint = parseRpcEndpoint(binding.address, `${label} ${binding.key}`);
  if (!['0.0.0.0', '127.0.0.1'].includes(endpoint.host)) {
    fail(`${label} refused unexpected non-loopback JSON-RPC host ${endpoint.host}`);
  }
  return `${yaml.slice(0, binding.scalarStart)}"127.0.0.1:${port}"${yaml.slice(binding.scalarEnd)}`;
}

function assertFullnodeRpcLoopback(yaml, rpcPort, label = 'fullnode config') {
  const port = checkedRpcPort(rpcPort, 'chosen JSON-RPC port');
  const binding = parseFullnodeRpcBinding(yaml, label);
  const endpoint = parseRpcEndpoint(binding.address, `${label} ${binding.key}`);
  if (endpoint.host !== '127.0.0.1' || endpoint.port !== port) {
    fail(`${label} JSON-RPC bind is not exact loopback 127.0.0.1:${port}: ${endpoint.address}`);
  }
  return endpoint.address;
}

function configureFullnodeRpcLoopback(networkDirectory, rpcPort) {
  const fullnodeConfig = checkedTemporaryChild(
    join(networkDirectory, 'fullnode.yaml'),
    'fullnode config',
  );
  if (!existsSync(fullnodeConfig) || !statSync(fullnodeConfig).isFile()) {
    fail('genesis did not create fullnode.yaml before localnet start');
  }
  const rewritten = rewriteFullnodeRpcLoopback(
    readFileSync(fullnodeConfig, 'utf8'),
    rpcPort,
    'generated fullnode.yaml',
  );
  writeFileSync(fullnodeConfig, rewritten, { encoding: 'utf8', mode: 0o600 });
  assertFullnodeRpcLoopback(
    readFileSync(fullnodeConfig, 'utf8'),
    rpcPort,
    're-read fullnode.yaml',
  );
  return fullnodeConfig;
}

function startLocalnet(networkDirectory, rpcPort) {
  const logs = [];
  let logBytes = 0;
  const keepTail = (chunk) => {
    logs.push(chunk);
    logBytes += chunk.length;
    while (logBytes > 64 * 1024 && logs.length > 1) logBytes -= logs.shift().length;
  };
  process.stdout.write(`+ sui start --network.config ${networkDirectory} --fullnode-rpc-port ${rpcPort} --quiet\n`);
  localnet = spawn('sui', [
    'start',
    '--network.config', networkDirectory,
    '--fullnode-rpc-port', String(rpcPort),
    '--quiet',
  ], {
    cwd: temporaryRoot,
    detached: true,
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  localnet.stdout.on('data', keepTail);
  localnet.stderr.on('data', keepTail);
  localnetExit = new Promise((resolveExit) => {
    localnet.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  localnet.once('error', (error) => logs.push(Buffer.from(error.stack ?? error.message)));
  return () => Buffer.concat(logs).toString('utf8');
}

async function stopLocalnet() {
  const process_ = localnet;
  const exit = localnetExit;
  if (process_) {
    if (process_.exitCode === null && process_.signalCode === null) {
      try {
        process.kill(-process_.pid, 'SIGTERM');
      } catch {}
      await Promise.race([
        exit,
        new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
      ]);
      if (process_.exitCode === null && process_.signalCode === null) {
        try {
          process.kill(-process_.pid, 'SIGKILL');
        } catch {}
        await Promise.race([
          exit,
          new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
        ]);
      }
    }
    localnet = null;
    localnetExit = null;
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await stopLocalnet();
    if (temporaryRoot) {
      const safeRoot = checkedTemporaryRoot(temporaryRoot);
      rmSync(safeRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
    }
  })();
  return cleanupPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

async function rpc(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(remaining(5_000)),
  });
  if (!response.ok) fail(`${method} HTTP ${response.status}`);
  return response.json();
}

async function waitForRpc(rpcUrl, activeAddress, getLocalnetLogs) {
  const stopAt = Date.now() + remaining(60_000);
  let lastError = null;
  let protocolEnvelope = null;
  while (Date.now() < stopAt) {
    if (localnet.exitCode !== null || localnet.signalCode !== null) {
      fail(`localnet exited before RPC readiness:\n${getLocalnetLogs()}`);
    }
    try {
      protocolEnvelope ??= await rpc(rpcUrl, 'sui_getProtocolConfig', []);
      if (!protocolEnvelope?.result) {
        lastError = new Error(canonicalJson(
          protocolEnvelope?.error ?? protocolEnvelope,
        ));
        protocolEnvelope = null;
      } else {
        const checkpoint = await rpc(
          rpcUrl,
          'sui_getLatestCheckpointSequenceNumber',
          [],
        );
        if (!/^(?:0|[1-9][0-9]*)$/.test(checkpoint?.result ?? '')) {
          lastError = new Error(canonicalJson(checkpoint?.error ?? checkpoint));
        } else {
          const coins = await rpc(
            rpcUrl,
            'suix_getAllCoins',
            [activeAddress, null, null],
          );
          if (Array.isArray(coins?.result?.data)
              && coins.result.data.length > 0) {
            return protocolEnvelope;
          }
          lastError = new Error(canonicalJson(coins?.error ?? coins));
        }
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  fail(`localnet RPC/checkpoint did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

async function transactionEnvelope(rpcUrl, digest) {
  const stopAt = Date.now() + remaining(20_000);
  let envelope = null;
  while (Date.now() < stopAt) {
    envelope = await rpc(rpcUrl, 'sui_getTransactionBlock', [digest, {
      showInput: true,
      showRawInput: true,
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true,
      showRawEffects: true,
    }]);
    if (envelope?.result) return envelope;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  fail(`transaction ${digest} was not queryable: ${canonicalJson(envelope?.error ?? envelope)}`);
}

function transactionDigest(commandResult, label) {
  if (commandResult.code === 0) {
    const parsed = parseJsonOutput(commandResult.stdout, label);
    if (typeof parsed.digest !== 'string') fail(`${label} JSON omitted digest`);
    return { digest: parsed.digest, parsed };
  }
  const combined = `${commandResult.stdout}\n${commandResult.stderr}`;
  const digest = combined.match(/transaction\s+['"]([1-9A-HJ-NP-Za-km-z]{40,})['"]/)?.[1];
  if (!digest) fail(`${label} failed without an executed transaction digest: ${combined.trim()}`);
  return { digest, parsed: null };
}

function assertSuccess(envelope, label) {
  const status = envelope.result?.effects?.status;
  if (status?.status !== 'success') fail(`${label} failed: ${canonicalJson(status)}`);
}

async function main({
  diagnoseFullCorePublish = false,
  diagnoseSevenPackagePublish = false,
  recordProtocol133Evidence = false,
} = {}) {
  await run(process.execPath, [quickGate], { timeoutMs: 4 * 60_000 });
  const evidence = loadAndVerifyEvidence(harnessDirectory);

  const { fixtureDirectory, publicationFile } = prepareTemporaryWorkspace();
  let clientConfig = null;
  let protocolEnvelope = null;
  let getLocalnetLogs = () => '';
  let rpcUrl = null;
  const startAttempts = 3;
  for (let attempt = 1; attempt <= startAttempts; attempt += 1) {
    const networkDirectory = prepareNetworkDirectory(attempt);
    await run('sui', [
      'genesis',
      '--force',
      '--with-faucet',
      '--working-dir', networkDirectory,
      '--committee-size', '1',
      '--epoch-duration-ms', '3600000',
      '--quiet',
    ], { timeoutMs: 60_000 });

    const rpcPort = await freePort();
    rpcUrl = `http://127.0.0.1:${rpcPort}`;
    configureFullnodeRpcLoopback(networkDirectory, rpcPort);
    clientConfig = checkedTemporaryChild(
      join(networkDirectory, 'client.yaml'),
      'client config',
    );
    const clientYaml = readFileSync(clientConfig, 'utf8')
      .replaceAll('http://127.0.0.1:9000', rpcUrl)
      .replaceAll('ws://127.0.0.1:9000', `ws://127.0.0.1:${rpcPort}`);
    if (!clientYaml.includes(rpcUrl)) fail('generated client config did not expose localnet RPC');
    const activeAddress = clientYaml.match(
      /^active_address:\s*["']?(0x[0-9a-fA-F]{64})["']?\s*$/m,
    )?.[1];
    if (!activeAddress) fail('generated client config omitted its active address');
    writeFileSync(clientConfig, clientYaml, { mode: 0o600 });

    getLocalnetLogs = startLocalnet(networkDirectory, rpcPort);
    try {
      protocolEnvelope = await waitForRpc(rpcUrl, activeAddress, getLocalnetLogs);
      break;
    } catch (error) {
      const collision = /Address already in use/.test(
        `${error.stack ?? error.message}\n${getLocalnetLogs()}`,
      );
      await stopLocalnet();
      if (!collision || attempt === startAttempts) throw error;
      process.stderr.write(
        `retry: Sui swarm port collision (${attempt}/${startAttempts})\n`,
      );
    }
  }
  if (!protocolEnvelope || !rpcUrl || !clientConfig) {
    fail('localnet start attempts completed without an RPC/profile result');
  }
  const profile = assertApprovedProtocolProfile(
    protocolEnvelope,
    evidence.approvedProfile,
    evidence.manifest.approvedProtocolProfile.canonicalSha256,
  );
  process.stdout.write(
    `ok: exact approved protocol profile ${canonicalJson(profile)} (${evidence.manifest.approvedProtocolProfile.canonicalSha256})\n`,
  );

  const clientPrefix = [
    'client',
    '--client.config', clientConfig,
    '--client.env', 'localnet',
    '-y',
  ];
  if (diagnoseSevenPackagePublish) {
    const packageNames = [
      'animacraft_v8_core',
      'animacraft_v8_seal',
      'animacraft_v8_runtime',
      'animacraft_v8_output',
      'animacraft_v8_physical',
      'animacraft_v8_market',
      'animacraft_v8_release',
    ];
    const packageTargets = new Map();
    for (const packageName of packageNames) {
      const source = join(root, 'move', packageName);
      const target = checkedTemporaryChild(
        join(temporaryRoot, packageName),
        `${packageName} diagnostic directory`,
      );
      cpSync(source, target, {
        recursive: true,
        filter(path) {
          const components = relative(source, path).split(sep);
          return !components.includes('build')
            && !['Published.toml', 'SlimPublished.toml'].includes(basename(path));
        },
      });
      packageTargets.set(packageName, target);
    }
    const results = [];
    for (const packageName of packageNames) {
      const target = packageTargets.get(packageName);
      const published = await runTestPublishWithRetry(() => run('sui', [
        ...clientPrefix,
        'test-publish', target,
        '--build-env', 'mainnet',
        '--pubfile-path', publicationFile,
        '--gas-budget', gasBudget,
        '--warnings-are-errors',
        '--json',
      ], { allowFailure: true, timeoutMs: 180_000 }));
      if (published.code !== 0) {
        fail(`${packageName} test-publish exited ${published.code ?? published.signal}: ${combinedCommandOutput(published).trim()}`);
      }
      const parsed = parseJsonOutput(published.stdout, `${packageName} publish`);
      if (parsed.effects?.status?.status !== 'success') {
        fail(`${packageName} publish failed: ${canonicalJson(parsed.effects?.status)}`);
      }
      const packageId = parsed.objectChanges
        ?.find(({ type }) => type === 'published')?.packageId;
      if (typeof packageId !== 'string') {
        fail(`${packageName} publish omitted packageId`);
      }
      results.push({
        packageName,
        packageId,
        digest: parsed.digest,
        gasUsed: parsed.effects?.gasUsed,
      });
      process.stdout.write(`ok: ${packageName} published as ${packageId}\n`);
    }
    process.stdout.write(`${JSON.stringify({
      schema: 'animacraft-v8-seven-package-publish-diagnostic.v1',
      approvedProtocolProfileHash: evidence.manifest.approvedProtocolProfile.canonicalSha256,
      packages: results,
    }, null, 2)}\n`);
    return;
  }

  const diagnosticSourceRelative = String(
    process.env.CORE_DIAGNOSTIC_SOURCE ?? 'move/animacraft_v8_core',
  );
  const diagnosticSource = resolve(root, diagnosticSourceRelative);
  if (diagnoseFullCorePublish
      && (!diagnosticSource.startsWith(`${root}${sep}`)
        || diagnosticSourceRelative.includes('..'))) {
    fail(`diagnostic publication source must stay below the worktree: ${diagnosticSourceRelative}`);
  }
  const publicationSource = diagnoseFullCorePublish
    ? diagnosticSource
    : fixtureSource;
  cpSync(publicationSource, fixtureDirectory, {
    recursive: true,
    filter(source) {
      const components = relative(publicationSource, source).split(sep);
      return !components.includes('build')
        && !['Published.toml', 'SlimPublished.toml'].includes(basename(source));
    },
  });
  const diagnosticOmissions = diagnoseFullCorePublish
    ? String(process.env.CORE_DIAGNOSTIC_OMIT ?? '').split(',').filter(Boolean)
    : [];
  for (const moduleName of diagnosticOmissions) {
    if (!/^[a-z][a-z0-9_]*\.move$/.test(moduleName)) {
      fail(`invalid diagnostic module omission ${moduleName}`);
    }
    const omittedPath = checkedTemporaryChild(
      join(fixtureDirectory, 'sources', moduleName),
      'diagnostic omitted module',
    );
    if (!existsSync(omittedPath)) fail(`diagnostic omitted module not found: ${moduleName}`);
    rmSync(omittedPath);
  }

  const testPublishArgs = [
    ...clientPrefix,
    'test-publish', fixtureDirectory,
    '--build-env', diagnoseFullCorePublish
      ? String(process.env.CORE_DIAGNOSTIC_BUILD_ENV ?? 'mainnet')
      : 'sealcap',
    '--pubfile-path', publicationFile,
    '--gas-budget', gasBudget,
    '--warnings-are-errors',
    '--json',
  ];
  const published = await runTestPublishWithRetry(() => run(
    'sui',
    testPublishArgs,
    { allowFailure: true, timeoutMs: 180_000 },
  ));
  if (diagnoseFullCorePublish) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    process.stdout.write(`${JSON.stringify({
      schema: 'animacraft-v8-full-core-publish-diagnostic.v1',
      omittedModules: diagnosticOmissions,
      publicationSource: diagnosticSourceRelative,
      exitCode: published.code,
      signal: published.signal,
      stdout: published.stdout,
      stderr: published.stderr,
      localnetLogTail: getLocalnetLogs(),
    }, null, 2)}\n`);
    return;
  }
  if (published.code !== 0) {
    fail(`slim fixture test-publish exited ${published.code ?? published.signal}: ${combinedCommandOutput(published).trim()}`);
  }
  const publishJson = parseJsonOutput(published.stdout, 'slim fixture publish');
  if (publishJson.effects?.status?.status !== 'success') {
    fail(`slim fixture publish failed: ${canonicalJson(publishJson.effects?.status)}`);
  }
  const packageId = publishJson.objectChanges
    ?.find(({ type }) => type === 'published')?.packageId;
  if (typeof packageId !== 'string') fail('slim fixture publish omitted packageId');

  const executeCall = async (functionName, args, { allowFailure = false } = {}) => {
    const result = await run('sui', [
      ...clientPrefix,
      'call',
      '--package', packageId,
      '--module', 'core_v8',
      '--function', functionName,
      '--args', ...args.map(String),
      '--gas-budget', gasBudget,
      '--json',
    ], { allowFailure, timeoutMs: transactionTimeoutMs });
    const { digest } = transactionDigest(result, `core_v8::${functionName}`);
    return transactionEnvelope(rpcUrl, digest);
  };

  const summaries = [];
  const recordedEnvelopes = new Map();
  for (const name of EVIDENCE_SCENARIO_NAMES) {
    const scenario = evidence.manifest.scenarios[name];
    const colored = scenario.colors > 0;
    const created = await executeCall('create_registry', [scenario.styles, colored]);
    assertSuccess(created, `${name} create_registry setup`);
    const objectChanges = created.result.objectChanges ?? [];
    const registry = objectChanges.find(
      ({ objectType }) => objectType === `${packageId}::base_registry_v8::BaseDefinitionRegistryV8`,
    )?.objectId;
    const makerRoot = objectChanges.find(
      ({ objectType }) => objectType === `${packageId}::maker_v8::MakerRootV8<0x2::sui::SUI>`,
    )?.objectId;
    const admin = objectChanges.find(
      ({ objectType }) => objectType === `${packageId}::maker_v8::MakerAdminCapV8`,
    )?.objectId;
    if (![registry, makerRoot, admin].every((value) => typeof value === 'string')) {
      fail(`${name} create_registry did not create typed registry/root/admin objects`);
    }

    for (let start = 0; start < scenario.styles; start += 100) {
      const count = Math.min(100, scenario.styles - start);
      const appended = await executeCall(
        'append_styles',
        [registry, makerRoot, admin, start, count, colored],
      );
      assertSuccess(appended, `${name} append_styles ${start}+${count}`);
    }
    for (let start = 0; start < scenario.colors; start += 100) {
      const count = Math.min(100, scenario.colors - start);
      const appended = await executeCall(
        'append_colors',
        [registry, makerRoot, admin, scenario.styles, start, count],
      );
      assertSuccess(appended, `${name} append_colors ${start}+${count}`);
    }

    // The measured seal is deliberately its own transaction after every setup
    // transaction above has finalized.
    const sealed = await executeCall(
      'seal',
      [registry, makerRoot, admin],
      { allowFailure: scenario.status === 'failure' },
    );
    summaries.push(assertReplayMatchesEvidence(name, sealed, evidence));
    if (recordProtocol133Evidence) recordedEnvelopes.set(name, sealed);
    process.stdout.write(`ok: ${name} typed seal effects match the protocol retest boundary\n`);
  }

  if (recordProtocol133Evidence) {
    const manifest = structuredClone(evidence.manifest);
    manifest.replayProvenance = {
      binaryTag: 'mainnet-v1.77.2',
      commit: '51d177ad7d65102fc368b582408f466d97b31548',
      asset: 'sui-mainnet-v1.77.2-macos-arm64.tgz',
      assetSha256: 'f0871c35ce1f3261028a3b0d389c2e34166fbf2f4982fd52d728806a03736d0d',
      cliVersion: 'sui 1.77.2-51d177ad7d65',
      protocolVersion: '133',
    };
    const artifacts = new Map([
      ['protocol-config-v133.rpc.json', protocolEnvelope],
      ...EVIDENCE_SCENARIO_NAMES.map((name) => [
        manifest.scenarios[name].artifact,
        recordedEnvelopes.get(name),
      ]),
    ]);
    for (const [file, value] of artifacts) {
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      writeFileSync(join(evidence.evidenceDirectory, file), bytes);
      manifest.artifacts[file] = {
        bytes: bytes.length,
        sha256: sha256Bytes(bytes),
      };
    }
    for (const name of EVIDENCE_SCENARIO_NAMES) {
      const result = recordedEnvelopes.get(name).result;
      const scenario = manifest.scenarios[name];
      scenario.originalDigest = result.digest;
      scenario.gasUsed = result.effects.gasUsed;
      scenario.rawEffectsLength = result.rawEffects.length;
      scenario.eventCount = (result.events ?? []).length;
      scenario.effectsShape = {
        messageVersion: result.effects.messageVersion,
        created: (result.effects.created ?? []).length,
        mutated: (result.effects.mutated ?? []).length,
        deleted: (result.effects.deleted ?? []).length,
        wrapped: (result.effects.wrapped ?? []).length,
        unwrapped: (result.effects.unwrapped ?? []).length,
        eventCount: (result.events ?? []).length,
        objectChangeTypes: (result.objectChanges ?? []).map(({ type }) => type),
      };
    }
    writeFileSync(
      join(evidence.evidenceDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    process.stdout.write('ok: recorded same-run protocol 133 profile and four complete RPC envelopes\n');
  }

  process.stdout.write(`${JSON.stringify({
    schema: 'animacraft-v8-seal-cap-localnet-replay.v1',
    approvedProtocolProfileHash: evidence.manifest.approvedProtocolProfile.canonicalSha256,
    scenarios: summaries,
  }, null, 2)}\n`);
}

async function workspaceSelfTest() {
  const genesisHelp = await run('sui', ['genesis', '--help'], { timeoutMs: 10_000 });
  if (!genesisHelp.stdout.includes('--working-dir')) {
    fail('Sui genesis CLI omitted required --working-dir support');
  }
  const publishHelp = await run(
    'sui',
    ['client', 'test-publish', '--help'],
    { timeoutMs: 10_000 },
  );
  if (!publishHelp.stdout.includes('--pubfile-path')) {
    fail('Sui test-publish CLI omitted required --pubfile-path support');
  }
  const rpcPort = 45_678;
  for (const [shape, key] of [
    ['kebab', 'json-rpc-address'],
    ['snake', 'json_rpc_address'],
  ]) {
    const yaml = [
      '---',
      'network-address: /ip4/127.0.0.1/tcp/5555/https',
      `${key}: "0.0.0.0:9000"`,
      'rpc:',
      '  enable-indexing: true',
      'metrics-address: "127.0.0.1:9184"',
      '',
    ].join('\n');
    const rewritten = rewriteFullnodeRpcLoopback(yaml, rpcPort, `${shape} self-test config`);
    if (!rewritten.includes(`${key}: "127.0.0.1:${rpcPort}"`)
        || rewritten.replace(`127.0.0.1:${rpcPort}`, '0.0.0.0:9000') !== yaml) {
      fail(`${shape} JSON-RPC shape self-test changed anything except its bind scalar`);
    }
    assertFullnodeRpcLoopback(rewritten, rpcPort, `${shape} re-read self-test config`);
  }
  const expectRpcConfigFailure = (yaml, pattern, label, operation = rewriteFullnodeRpcLoopback) => {
    let error = null;
    try {
      operation(yaml, rpcPort, `${label} self-test config`);
    } catch (caught) {
      error = caught;
    }
    if (!error || !pattern.test(error.message)) {
      fail(`${label} RPC config self-test was not rejected by ${pattern}`);
    }
  };
  expectRpcConfigFailure(
    'jsonRpcAddress: "0.0.0.0:9000"\n',
    /unknown JSON-RPC bind key/,
    'unknown-key',
  );
  expectRpcConfigFailure(
    'json-rpc-bind-address: "0.0.0.0:9000"\n',
    /exactly one JSON-RPC bind, found 0/,
    'unknown-shape',
  );
  for (const yaml of [
    'json-rpc-address: "0.0.0.0:9000"\njson-rpc-address: "0.0.0.0:9001"\n',
    'json-rpc-address: "0.0.0.0:9000"\njson_rpc_address: "0.0.0.0:9000"\n',
  ]) {
    expectRpcConfigFailure(yaml, /exactly one JSON-RPC bind, found 2/, 'multiple-bind');
  }
  expectRpcConfigFailure(
    'json-rpc-address: "192.0.2.10:9000"\n',
    /refused unexpected non-loopback JSON-RPC host/,
    'non-loopback-source',
  );
  expectRpcConfigFailure(
    'json-rpc-address: "0.0.0.0:45678"\n',
    /is not exact loopback/,
    'wildcard-re-read',
    assertFullnodeRpcLoopback,
  );
  expectRpcConfigFailure(
    'json_rpc_address: "127.0.0.1:45679"\n',
    /is not exact loopback/,
    'wrong-port-re-read',
    assertFullnodeRpcLoopback,
  );
  const knownMissing = {
    code: 1,
    signal: null,
    stdout: `${liveIndexMissingStdout}\n`,
    stderr: '',
  };
  const success = { code: 0, signal: null, stdout: '{}', stderr: '' };
  const fakeRun = async (results, observed, delays) => runTestPublishWithRetry(
    async () => {
      observed.count += 1;
      return results[Math.min(observed.count - 1, results.length - 1)];
    },
    {
      wait: async (delayMs) => delays.push(delayMs),
      onRetry: () => {},
    },
  );

  let observed = { count: 0 };
  let delays = [];
  let result = await fakeRun([knownMissing, success], observed, delays);
  if (result.code !== 0 || observed.count !== 2
      || canonicalJson(delays) !== canonicalJson([testPublishRetryDelayMs])) {
    fail('retry self-test did not retry the exact pre-execution live-index miss once');
  }

  for (const rejected of [
    {
      ...knownMissing,
      stdout: 'Some requested entity was not found',
    },
    {
      ...knownMissing,
      stdout: `unknown prefix: ${liveIndexMissingStdout}`,
    },
    {
      ...knownMissing,
      stdout: `${liveIndexMissingStdout}: unknown suffix`,
    },
    {
      ...knownMissing,
      stderr: 'unknown extra error',
    },
    {
      ...knownMissing,
      stdout: `${knownMissing.stdout.trim()}; transaction '${'2'.repeat(44)}'`,
    },
    {
      ...knownMissing,
      stdout: JSON.stringify({ digest: '3'.repeat(44), effects: {} }),
    },
    {
      ...knownMissing,
      signal: 'SIGTERM',
    },
  ]) {
    observed = { count: 0 };
    delays = [];
    result = await fakeRun([rejected, success], observed, delays);
    if (result !== rejected || observed.count !== 1 || delays.length !== 0) {
      fail('retry self-test retried an unknown or possibly executed failure');
    }
  }

  observed = { count: 0 };
  delays = [];
  result = await fakeRun([{
    ...knownMissing,
    stdout: `\u001B[31m${liveIndexMissingStdout}\u001B[0m\n`,
  }, success], observed, delays);
  if (result.code !== 0 || observed.count !== 2 || delays.length !== 1) {
    fail('retry self-test did not accept ANSI-only decoration of the exact framing');
  }

  observed = { count: 0 };
  delays = [];
  result = await fakeRun([knownMissing], observed, delays);
  if (result !== knownMissing || observed.count !== testPublishMaximumAttempts
      || delays.length !== testPublishMaximumAttempts - 1
      || delays.some((delay) => delay !== testPublishRetryDelayMs)) {
    fail('retry self-test exceeded or under-ran its exact attempt bound');
  }
  prepareTemporaryWorkspace();
  const networkDirectory = prepareNetworkDirectory(1);
  if (!existsSync(networkDirectory) || !statSync(networkDirectory).isDirectory()) {
    fail('workspace self-test did not create the genesis network directory');
  }
  for (const unsafePath of [
    temporaryRoot,
    dirname(temporaryRoot),
    join(dirname(temporaryRoot), `${temporaryPrefix}outside`),
  ]) {
    let rejected = false;
    try {
      checkedTemporaryChild(unsafePath, 'workspace self-test target');
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`workspace self-test accepted unsafe path ${unsafePath}`);
  }
  const safeRoot = temporaryRoot;
  await cleanup();
  if (existsSync(safeRoot)) fail(`workspace self-test did not clean ${safeRoot}`);
  process.stdout.write(
    'ok: localnet CLI/workspace, strict loopback RPC config, and bounded pre-execution retry self-test\n',
  );
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0) {
    await main();
  } else if (arguments_.length === 1 && arguments_[0] === '--workspace-self-test') {
    await workspaceSelfTest();
  } else if (arguments_.length === 1 && arguments_[0] === '--diagnose-full-core-publish') {
    await main({ diagnoseFullCorePublish: true });
  } else if (arguments_.length === 1 && arguments_[0] === '--diagnose-seven-package-publish') {
    await main({ diagnoseSevenPackagePublish: true });
  } else if (arguments_.length === 1 && arguments_[0] === '--record-protocol133-evidence') {
    await main({ recordProtocol133Evidence: true });
  } else {
    fail('runner accepts only `--workspace-self-test`, `--diagnose-full-core-publish`, `--diagnose-seven-package-publish`, or `--record-protocol133-evidence`; use `npm run move:seal-cap:localnet` for replay');
  }
} finally {
  await cleanup();
}
