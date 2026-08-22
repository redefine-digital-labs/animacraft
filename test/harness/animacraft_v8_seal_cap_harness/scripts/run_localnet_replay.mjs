#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
} from './evidence.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const harnessDirectory = resolve(scriptDirectory, '..');
const root = resolve(harnessDirectory, '../../..');
const fixtureSource = join(harnessDirectory, 'fixture/slim-core');
const quickGate = join(scriptDirectory, 'verify_reproducibility.mjs');
const gasBudget = '100000000000';
const totalTimeoutMs = 15 * 60_000;
const transactionTimeoutMs = 45_000;
const deadline = Date.now() + totalTimeoutMs;

let localnet = null;
let localnetExit = null;
let temporaryRoot = null;
let cleanupPromise = null;

function fail(message) {
  throw new Error(`seal-cap localnet replay: ${message}`);
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

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (localnet && localnet.exitCode === null && localnet.signalCode === null) {
      try {
        process.kill(-localnet.pid, 'SIGTERM');
      } catch {}
      await Promise.race([
        localnetExit,
        new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
      ]);
      if (localnet.exitCode === null && localnet.signalCode === null) {
        try {
          process.kill(-localnet.pid, 'SIGKILL');
        } catch {}
        await Promise.race([
          localnetExit,
          new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
        ]);
      }
    }
    if (temporaryRoot) {
      const expectedPrefix = join(tmpdir(), 'animacraft-seal-cap-localnet-');
      if (!temporaryRoot.startsWith(expectedPrefix)
          || dirname(temporaryRoot) !== resolve(tmpdir())
          || !basename(temporaryRoot).startsWith('animacraft-seal-cap-localnet-')) {
        fail(`refusing unsafe temporary cleanup target ${temporaryRoot}`);
      }
      rmSync(temporaryRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
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

async function waitForRpc(rpcUrl, getLocalnetLogs) {
  const stopAt = Date.now() + remaining(60_000);
  let lastError = null;
  while (Date.now() < stopAt) {
    if (localnet.exitCode !== null || localnet.signalCode !== null) {
      fail(`localnet exited before RPC readiness:\n${getLocalnetLogs()}`);
    }
    try {
      const envelope = await rpc(rpcUrl, 'sui_getProtocolConfig', []);
      if (envelope?.result) return envelope;
      lastError = new Error(canonicalJson(envelope?.error ?? envelope));
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  fail(`localnet RPC did not become ready: ${lastError?.message ?? 'unknown error'}`);
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

async function main() {
  if (process.argv.length !== 2) {
    fail('this runner takes no arguments; use `npm run move:seal-cap:localnet`');
  }

  await run(process.execPath, [quickGate], { timeoutMs: 4 * 60_000 });
  const evidence = loadAndVerifyEvidence(harnessDirectory);

  temporaryRoot = mkdtempSync(join(tmpdir(), 'animacraft-seal-cap-localnet-'));
  const networkDirectory = join(temporaryRoot, 'network');
  const fixtureDirectory = join(temporaryRoot, 'slim-core');
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
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  const clientConfig = join(networkDirectory, 'client.yaml');
  const clientYaml = readFileSync(clientConfig, 'utf8')
    .replaceAll('http://127.0.0.1:9000', rpcUrl)
    .replaceAll('ws://127.0.0.1:9000', `ws://127.0.0.1:${rpcPort}`);
  if (!clientYaml.includes(rpcUrl)) fail('generated client config did not expose localnet RPC');
  writeFileSync(clientConfig, clientYaml, { mode: 0o600 });

  const getLocalnetLogs = startLocalnet(networkDirectory, rpcPort);
  const protocolEnvelope = await waitForRpc(rpcUrl, getLocalnetLogs);
  const profile = assertApprovedProtocolProfile(
    protocolEnvelope,
    evidence.approvedProfile,
    evidence.manifest.approvedProtocolProfile.canonicalSha256,
  );
  process.stdout.write(
    `ok: exact approved protocol profile ${canonicalJson(profile)} (${evidence.manifest.approvedProtocolProfile.canonicalSha256})\n`,
  );

  cpSync(fixtureSource, fixtureDirectory, {
    recursive: true,
    filter(source) {
      const components = relative(fixtureSource, source).split(sep);
      return !components.includes('build')
        && !['Published.toml', 'SlimPublished.toml'].includes(basename(source));
    },
  });

  const clientPrefix = [
    'client',
    '--client.config', clientConfig,
    '--client.env', 'localnet',
    '-y',
  ];
  const published = await run('sui', [
    ...clientPrefix,
    'publish', fixtureDirectory,
    '--build-env', 'sealcap',
    '--pubfile-path', join(temporaryRoot, 'SlimPublished.toml'),
    '--gas-budget', gasBudget,
    '--warnings-are-errors',
    '--json',
  ], { timeoutMs: 180_000 });
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
    process.stdout.write(`ok: ${name} typed seal effects match canonical evidence\n`);
  }

  process.stdout.write(`${JSON.stringify({
    schema: 'animacraft-v8-seal-cap-localnet-replay.v1',
    approvedProtocolProfileHash: evidence.manifest.approvedProtocolProfile.canonicalSha256,
    scenarios: summaries,
  }, null, 2)}\n`);
}

try {
  await main();
} finally {
  await cleanup();
}
