#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import packageMetadata from '../package.json' with { type: 'json' };

import { bcs } from '@mysten/sui/bcs';
import { GrpcTypes, SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import {
  fromBase58,
  fromBase64,
  fromHex,
  normalizeSuiAddress,
  toBase58,
  toBase64,
  toHex,
} from '@mysten/sui/utils';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { MAINNET_WALRUS_PACKAGE_CONFIG } from '@mysten/walrus';
import { blake2b } from '@noble/hashes/blake2.js';
import { captureNativeSoulSource, restoreNativeSoulSource, inspectNativeSoulSourceRepositories,
  verifyNativeSoulSourceCheckout, assertNativeSoulSourceRevision, NATIVE_SOUL_SOURCE_ORDER,
  NATIVE_SOUL_SOURCE_NAMES } from './native-soul-source-cas.mjs';
import { assertMainnetV8SourcePlan } from './mainnet-v8-release-lib.mjs';
import { readNativeSoulExternalPublications, nativeSoulExternalCommitmentEntries, NATIVE_SOUL_EXTERNAL_PUBLICATIONS,
  NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY } from './native-soul-external-publications.mjs';
import { assertMakerV8WalrusExecutionV1, readMakerV8WalrusExecutionV1 } from '../maker-v8-walrus-execution.js';
import { buildNativeSoulBootstrapTransaction, NATIVE_SOUL_BOOTSTRAP_STAGES } from './native-soul-bootstrap-transactions.mjs';
import { certifyNativeSoulBootstrapHistory, nativeSoulBootstrapPriorKinds } from './native-soul-bootstrap-loader.mjs';
import { deriveNativeSoulBootstrapStageData, deriveNativeSoulFinalBootstrapObjects } from './native-soul-bootstrap-context.mjs';
import { assertMakerV8Runtime } from '../maker-v8-runtime.js';
import { createMakerV8BrowserSealClient } from '../maker-v8-seal-browser.js';
import { deriveMakerV8ProtocolConfigCommitment } from '../maker-v8-protocol-commitment.js';
import { decodeNativeSoulBootstrapHistoryObject } from './native-soul-bootstrap-history.mjs';
import { buildNativeSoulMarketActivationTransaction, nativeSoulMarketActivationOutputReferences,
  validateNativeSoulMarketActivationHistory } from './native-soul-market-activation.mjs';

import {
  MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT,
  MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  createProductionMakerV8SuiGrpcTransport,
  isMakerV8SuiGrpcNotFoundError,
} from '../maker-v8-sui-grpc.js';
import {
  ROLE_ORDER,
  ROLE_PACKAGE_NAMES,
  MAINNET_V8_PUBLISH_ORDER,
  MAINNET_V8_PUBLISH_PACKAGE_NAMES,
  MAINNET_V8_RELEASE_STEPS,
  MAINNET_V8_REPAIRABLE_READBACK_INCIDENTS,
  nativeSoulBootstrapInputFromStageData,
  nativeSoulMarketActivationInputFromStageData,
  deriveMainnetV8MarketActivationWalContext,
  MAINNET_V8_BROWSER_KEY_SERVERS,
  MAINNET_V8_BROWSER_KEY_SERVER_TYPE,
  MAINNET_V8_BROWSER_SEAL_THRESHOLD,
  MAINNET_V8_RELEASE_SIGNER,
  MAINNET_V8_SUI_BINARY_SHA256,
  appendReleaseWal,
  assertMainnetV8FinalSealPolicy,
  assertMainnetV8SealPolicyTemplate,
  assertMainnetV8PackageReadbackBcs,
  assertMainnetV8NativeBootstrapReadback,
  certifyMainnetV8SoulidityInitialization,
  assertMainnetV8PublishedModuleBytes,
  assertReleasePlan,
  assertMainnetV8ReleasePlanContents,
  buildAbiArtifact,
  buildFinalManifest,
  mainnetV8CatalogCommitmentsFromFinalManifest,
  buildMainnetV8AbandonEvidence,
  buildMainnetV8ManifestEvidence,
  buildMainnetV8OutcomeEvidence,
  buildMainnetV8ReadyEvidence,
  buildMainnetV8SignedEvidence,
  buildPackageArtifact,
  buildSealPolicy,
  buildSourceArtifact,
  canonicalJson,
  canonicalMainnetV8WalJson,
  computeAbiCommitment,
  computeExecutionPlanId,
  computePackageCommitment,
  computeSourceCommitment,
  createReleasePlan,
  createReleaseWal,
  readReleaseWal,
  parsePublishedToml,
  renderPublishedToml,
  sha256Hex,
} from './mainnet-v8-release-lib.mjs';
import { attestMakerV8Runtime } from '../maker-v8-chain.js';

export const MAINNET_V8_RELEASE_RUNNER_SCHEMA = 'animacraft.mainnet-v8-release-runner.v1';
export const MAINNET_V8_RELEASE_TOOLCHAIN = Object.freeze({
  suiVersion: '1.80.1',
  suiSourceCommit: '671ba71e69c711ded76a11ef90297c4f2d5ac474',
  suiVersionOutput: 'sui 1.80.1-671ba71e69c7',
  suiBinarySha256: MAINNET_V8_SUI_BINARY_SHA256,
  protocolVersion: '137',
  objectRuntimeMaxCachedObjects: '1000',
  objectRuntimeMaxStoreEntries: '1000',
  frameworkRevision: '722ac4fcf4841346c91775f596c4ce23fb7fbd0f',
});
export const MAINNET_V8_USDC_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export {
  MAINNET_V8_BROWSER_KEY_SERVERS,
  MAINNET_V8_BROWSER_KEY_SERVER_TYPE,
  MAINNET_V8_BROWSER_SEAL_THRESHOLD,
  MAINNET_V8_RELEASE_SIGNER,
};
export const MAINNET_V8_MAX_TRANSACTION_BYTES = 128 * 1024;
export const MAINNET_V8_PRELIMINARY_GAS_BUDGET = 2_000_000_000n;
export const MAINNET_V8_MINIMUM_GAS_CUSHION = 100_000_000n;
export const MAINNET_V8_WAL_FILENAME = 'release-wal.json';
export const MAINNET_V8_PLAN_FILENAME = 'release-plan.json';
export const MAINNET_V8_PUBLISHED_FILENAME = 'Published.toml';
export { MAINNET_V8_REPAIRABLE_READBACK_INCIDENTS };
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const HEX_32 = /^[0-9a-f]{64}$/;
const BASE58_DIGEST_LENGTH = 32;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const LEDGER_SERVICE = 'sui.rpc.v2.LedgerService';
const GET_TRANSACTION = 'GetTransaction';
const COMMANDS = new Set([
  'prepare', 'run', 'resume', 'abandon', 'status', 'verify', 'export-config',
]);
const SUI_EVENT_BCS = bcs.struct('MainnetV8ReleaseSuiEvent', {
  package_id: bcs.Address,
  transaction_module: bcs.string(),
  sender: bcs.Address,
  event_type: bcs.StructTag,
  contents: bcs.vector(bcs.u8()),
});
const SUI_TRANSACTION_EVENTS_BCS = bcs.struct('MainnetV8ReleaseTransactionEvents', {
  data: bcs.vector(SUI_EVENT_BCS),
});
const SEAL_KEY_SERVER_OBJECT_BCS = bcs.struct('MainnetV8SealKeyServerObject', {
  id: bcs.Address,
  first_version: bcs.u64(),
  last_version: bcs.u64(),
});
const UPGRADE_CAP_BCS = bcs.struct('MainnetV8UpgradeCap', {
  id: bcs.Address,
  package: bcs.Address,
  version: bcs.u64(),
  policy: bcs.u8(),
});
const PROTOCOL_CONFIG_BCS = bcs.struct('MainnetV8ProtocolConfig', {
  id: bcs.Address,
  version: bcs.u64(),
  core_original_package_id: bcs.Address,
  core_callable_package_id: bcs.Address,
  revision: bcs.u64(),
  treasury_id: bcs.option(bcs.Address),
  payment_coin_type: bcs.string(),
  primary_content_fee_bps: bcs.u16(),
  fixed_complete_fee_atomic: bcs.u64(),
  maker_market_fee_bps: bcs.u16(),
  soul_market_fee_bps: bcs.u16(),
  enabled: bcs.bool(),
  commitment: bcs.byteVector(),
});
const PROTOCOL_ADMIN_CAP_BCS = bcs.struct('MainnetV8ProtocolAdminCap', {
  id: bcs.Address,
  version: bcs.u64(),
  config_id: bcs.Address,
});

export class MainnetV8ReleaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MainnetV8ReleaseError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new MainnetV8ReleaseError(code, message, details);
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function officialMessage(value, messageType, label) {
  if (!value || typeof value !== 'object'
    || Object.getPrototypeOf(value) !== messageType.messagePrototype
    || !messageType.is(value)) {
    fail('MAINNET_V8_GRPC_MESSAGE_INVALID', `${label} is not an exact official SDK message.`, {
      expectedType: messageType.typeName,
    });
  }
  return value;
}

function bytes(value, label, maximum = 16 * 1024 * 1024) {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > maximum) {
    fail('MAINNET_V8_BYTES_INVALID', `${label} must be non-empty bounded bytes.`);
  }
  return new Uint8Array(value);
}

function namedBcsBytes(container, expectedName, label) {
  const value = officialMessage(container, GrpcTypes.Bcs, label);
  if (value.name !== expectedName) {
    fail('MAINNET_V8_BCS_NAME_INVALID', `${label} is not ${expectedName} BCS.`, {
      expectedName,
      observedName: value.name ?? null,
    });
  }
  return bytes(value.value, `${label}.value`);
}

function canonicalBcs(container, expectedName, schema, label) {
  const encoded = namedBcsBytes(container, expectedName, label);
  let parsed;
  let roundtrip;
  try {
    parsed = schema.parse(encoded);
    roundtrip = schema.serialize(parsed, { maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES }).toBytes();
  } catch (cause) {
    fail('MAINNET_V8_BCS_INVALID', `${label} is not valid canonical ${expectedName} BCS.`, {
      cause: String(cause?.message ?? cause),
    });
  }
  if (!sameBytes(encoded, roundtrip)) {
    fail('MAINNET_V8_BCS_NONCANONICAL', `${label} is not canonical ${expectedName} BCS.`);
  }
  return Object.freeze({ bytes: encoded, parsed });
}

function typedDigest(name, value) {
  const domain = new TextEncoder().encode(`${name}::`);
  const input = new Uint8Array(domain.length + value.length);
  input.set(domain);
  input.set(value, domain.length);
  return toBase58(blake2b(input, { dkLen: 32 }));
}

function exactKeys(value, keys, label) {
  if (!plain(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    fail('MAINNET_V8_FIELDS_INVALID', `${label} has an invalid exact shape.`, {
      expected: [...keys],
      observed: plain(value) ? Object.keys(value) : null,
    });
  }
  return value;
}

function address(value, label) {
  try {
    const normalized = normalizeSuiAddress(value);
    if (normalized !== value) throw new Error('non-canonical');
    return normalized;
  } catch {
    fail('MAINNET_V8_ADDRESS_INVALID', `${label} must be one canonical Sui address.`, { value });
  }
}

function digest(value, label) {
  try {
    const bytes = fromBase58(value);
    if (bytes.length !== BASE58_DIGEST_LENGTH || toBase58(bytes) !== value) throw new Error('wrong length');
    return value;
  } catch {
    fail('MAINNET_V8_DIGEST_INVALID', `${label} must be a 32-byte Base58 digest.`, { value });
  }
}

function decimal(value, label) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    fail('MAINNET_V8_DECIMAL_INVALID', `${label} must be a canonical decimal string.`, { value });
  }
  return value;
}

function hash32(value, label) {
  if (typeof value !== 'string' || !HEX_32.test(value)) {
    fail('MAINNET_V8_HASH_INVALID', `${label} must be one lowercase SHA-256 hex digest.`, { value });
  }
  return value;
}

function ownerEvidence(owner, label) {
  if (!plain(owner) || typeof owner.$kind !== 'string') {
    fail('MAINNET_V8_OWNER_INVALID', `${label} is not one exact Sui owner.`);
  }
  if (owner.$kind === 'AddressOwner') return Object.freeze({ kind: 'AddressOwner', address: address(owner.AddressOwner, label) });
  if (owner.$kind === 'ObjectOwner') return Object.freeze({ kind: 'ObjectOwner', address: address(owner.ObjectOwner, label) });
  if (owner.$kind === 'Shared') {
    return Object.freeze({
      kind: 'Shared',
      initialSharedVersion: decimal(owner.Shared?.initialSharedVersion, `${label}.initialSharedVersion`),
    });
  }
  if (owner.$kind === 'Immutable' && owner.Immutable === true) return Object.freeze({ kind: 'Immutable' });
  fail('MAINNET_V8_OWNER_INVALID', `${label} has an unsupported owner kind.`, { kind: owner.$kind });
}

function canonicalizeSdk(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return toBase64(value);
  if (Array.isArray(value)) return value.map(canonicalizeSdk);
  if (plain(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeSdk(value[key])]));
  }
  if (value === undefined) return null;
  return value;
}

async function runProcess(command, args, {
  cwd = REPOSITORY_ROOT,
  env = process.env,
  stdin = null,
  allowFailure = false,
  maximumBytes = 64 * 1024 * 1024,
} = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let byteLength = 0;
    const collect = (target) => (chunk) => {
      byteLength += chunk.length;
      if (byteLength > maximumBytes) {
        child.kill('SIGKILL');
        reject(new MainnetV8ReleaseError(
          'MAINNET_V8_PROCESS_OUTPUT_TOO_LARGE',
          `${command} emitted more than the bounded output budget.`,
        ));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const result = Object.freeze({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
      if (!allowFailure && code !== 0) {
        reject(new MainnetV8ReleaseError(
          'MAINNET_V8_PROCESS_FAILED',
          `${command} exited unsuccessfully.`,
          { command, args, ...result },
        ));
        return;
      }
      resolve(result);
    });
    if (stdin === null) child.stdin.end();
    else child.stdin.end(stdin);
  });
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    fail('MAINNET_V8_JSON_OUTPUT_INVALID', `${label} did not emit exact JSON.`, {
      stdout: result.stdout.slice(0, 4096),
      stderr: result.stderr.slice(0, 4096),
      cause: String(cause?.message ?? cause),
    });
  }
}

export function parseMainnetV8ReleaseArgs(argv) {
  const input = [...argv];
  const command = input.shift() ?? 'status';
  if (!COMMANDS.has(command)) fail('MAINNET_V8_COMMAND_INVALID', `Unknown release command: ${command}`);
  const options = Object.create(null);
  while (input.length > 0) {
    const token = input.shift();
    if (!token.startsWith('--')) fail('MAINNET_V8_ARGUMENT_INVALID', `Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (['confirm-mainnet', 'allow-signing', 'allow-broadcast', 'repair-readback-incident', 'json']
      .includes(name)) {
      options[name] = true;
      continue;
    }
    const value = input.shift();
    if (value == null || value.startsWith('--')) fail('MAINNET_V8_ARGUMENT_INVALID', `--${name} requires a value.`);
    if (Object.hasOwn(options, name)) fail('MAINNET_V8_ARGUMENT_INVALID', `--${name} was repeated.`);
    options[name] = value;
  }
  return Object.freeze({ command, options: Object.freeze({ ...options }) });
}

export async function inspectMainnetV8Toolchain({ suiBinary }) {
  const resolved = path.resolve(suiBinary);
  const [version, bytes] = await Promise.all([
    runProcess(resolved, ['--version']),
    fsp.readFile(resolved),
  ]);
  const observed = Object.freeze({
    path: resolved,
    versionOutput: version.stdout.trim(),
    suiVersion: MAINNET_V8_RELEASE_TOOLCHAIN.suiVersion,
    suiVersionOutput: MAINNET_V8_RELEASE_TOOLCHAIN.suiVersionOutput,
    suiSourceCommit: MAINNET_V8_RELEASE_TOOLCHAIN.suiSourceCommit,
    suiBinarySha256: createHash('sha256').update(bytes).digest('hex'),
    frameworkRevision: MAINNET_V8_RELEASE_TOOLCHAIN.frameworkRevision,
  });
  if (observed.versionOutput !== MAINNET_V8_RELEASE_TOOLCHAIN.suiVersionOutput
    || observed.suiBinarySha256 !== MAINNET_V8_RELEASE_TOOLCHAIN.suiBinarySha256) {
    fail('MAINNET_V8_TOOLCHAIN_DRIFT', 'Sui release binary differs from the approved protocol-137 toolchain.', {
      expected: MAINNET_V8_RELEASE_TOOLCHAIN,
      observed,
    });
  }
  return observed;
}

async function copyApprovedSuiBinary({ source, destination }) {
  try {
    await fsp.copyFile(source, destination, fs.constants.COPYFILE_FICLONE);
  } catch (error) {
    if (!['ENOTSUP', 'EINVAL', 'EXDEV'].includes(error?.code)) throw error;
    await fsp.rm(destination, { force: true });
    await fsp.copyFile(source, destination);
  }
  await fsp.chmod(destination, 0o700);
  const observed = await inspectMainnetV8Toolchain({ suiBinary: destination });
  return observed.path;
}

async function withApprovedSuiBinarySnapshot(suiBinary, operation) {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'animacraft-mainnet-v8-sui-'));
  await fsp.chmod(temporaryRoot, 0o700);
  try {
    const snapshotPath = await copyApprovedSuiBinary({
      source: path.resolve(suiBinary),
      destination: path.join(temporaryRoot, 'sui'),
    });
    return await operation(snapshotPath);
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function inspectMainnetV8GitSource({ repositoryRoot, soulidityRoot }) {
  const { repositories } = await inspectNativeSoulSourceRepositories({ animacraftRoot: repositoryRoot, soulidityRoot });
  // Base Git provenance only, not the authority for the working-source bytes.
  return Object.freeze(repositories);
}

export async function assertMainnetV8ProtocolProfile(client) {
  const [{ chainIdentifier }, protocol, systemState, referenceGasPrice] = await Promise.all([
    client.core.getChainIdentifier(),
    client.core.getProtocolConfig(),
    client.core.getCurrentSystemState(),
    client.core.getReferenceGasPrice(),
  ]);
  const profile = protocol?.protocolConfig;
  if (chainIdentifier !== MAKER_V8_SUI_MAINNET_GENESIS_DIGEST
    || profile?.protocolVersion !== MAINNET_V8_RELEASE_TOOLCHAIN.protocolVersion
    || profile?.attributes?.object_runtime_max_num_cached_objects
      !== MAINNET_V8_RELEASE_TOOLCHAIN.objectRuntimeMaxCachedObjects
    || profile?.attributes?.object_runtime_max_num_store_entries
      !== MAINNET_V8_RELEASE_TOOLCHAIN.objectRuntimeMaxStoreEntries
    || profile?.featureFlags?.enable_unified_linkage !== true
    || systemState?.systemState?.protocolVersion !== MAINNET_V8_RELEASE_TOOLCHAIN.protocolVersion) {
    fail('MAINNET_V8_PROTOCOL_DRIFT', 'Live gRPC does not expose the approved Sui Mainnet protocol profile.', {
      chainIdentifier,
      profile: canonicalizeSdk(profile),
      systemState: canonicalizeSdk(systemState?.systemState),
    });
  }
  const epoch = decimal(systemState.systemState.epoch, 'systemState.epoch');
  const gasPrice = decimal(referenceGasPrice.referenceGasPrice, 'referenceGasPrice');
  return Object.freeze({
    chainIdentifier,
    protocolVersion: profile.protocolVersion,
    epoch,
    gasPrice,
    attributes: Object.freeze({
      objectRuntimeMaxNumCachedObjects: profile.attributes.object_runtime_max_num_cached_objects,
      objectRuntimeMaxNumStoreEntries: profile.attributes.object_runtime_max_num_store_entries,
    }),
  });
}

async function buildSourceArtifactForRole({ role, checkoutRoot, sourceRevision, toolchain }) {
  assertNativeSoulSourceRevision(sourceRevision);
  const source = sourceRevision.packages.find(pkg => pkg.role === role);
  if (!source) fail('MAINNET_V8_SOURCE_ARTIFACT_INVALID', 'Unknown current source package.');
  const packageName = source.packageName;
  await verifyNativeSoulSourceCheckout({ sourceRevision, checkoutRoot });
  return await buildSourceArtifact({
    role,
    packageName,
    release: { snapshotSha256: sourceRevision.snapshotSha256, repository: source.repository,
      ...sourceRevision.repositories[source.repository] },
    toolchain: {
      suiVersion: toolchain.suiVersion,
      suiVersionOutput: toolchain.suiVersionOutput,
      suiSourceCommit: toolchain.suiSourceCommit,
      suiBinarySha256: toolchain.suiBinarySha256,
      frameworkRevision: toolchain.frameworkRevision,
    },
    originalFiles: source.originalFiles,
    files: source.files,
  });
}

/** Capture and seal the complete current source input. This is deliberately a
 * SOURCE unit, not a publication plan, transaction, simulation or READY record. */
export async function prepareMainnetV8Source({ repositoryRoot, soulidityRoot, storePath, checkoutRoot, toolchain }) {
  const sourceRevision = await captureNativeSoulSource({ animacraftRoot: repositoryRoot, soulidityRoot, storePath });
  await restoreNativeSoulSource({ sourceRevision, storePath, checkoutRoot });
  const packages = [];
  for (const role of NATIVE_SOUL_SOURCE_ORDER) {
    const sourceArtifact = await buildSourceArtifactForRole({ role, checkoutRoot, sourceRevision, toolchain });
    packages.push({ role, packageName: NATIVE_SOUL_SOURCE_NAMES[role], sourceArtifact,
      sourceCommitment: computeSourceCommitment(sourceArtifact) });
  }
  const sourcePlan = { sourceRevision, toolchain: packages[0].sourceArtifact.toolchain, packages };
  assertMainnetV8SourcePlan(sourcePlan);
  return Object.freeze(sourcePlan);
}

async function moduleFiles(packageDirectory, packageName) {
  const directory = path.join(packageDirectory, 'build', packageName, 'bytecode_modules');
  const names = (await fsp.readdir(directory)).filter((name) => name.endsWith('.mv')).sort();
  if (names.length === 0) fail('MAINNET_V8_MODULES_MISSING', `${packageName} produced no bytecode modules.`);
  return await Promise.all(names.map(async (filename) => {
    const bytes = new Uint8Array(await fsp.readFile(path.join(directory, filename)));
    return Object.freeze({
      name: filename.slice(0, -3),
      bytes,
      base64: toBase64(bytes),
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
    });
  }));
}

export async function buildMainnetV8Package({
  role,
  checkoutRoot,
  publishedTomlPath,
  suiBinary,
  sourceRevision,
  toolchain,
  sourceArtifact = null,
}) {
  if (!NATIVE_SOUL_SOURCE_ORDER.includes(role)) fail('MAINNET_V8_ROLE_INVALID', `Unknown source package ${role}.`);
  await verifyNativeSoulSourceCheckout({ sourceRevision, checkoutRoot });
  const externalEntries = readNativeSoulExternalPublications({ sourceRevision, checkoutRoot });
  const publishedText = await fsp.readFile(publishedTomlPath, 'utf8');
  if (canonicalJson(parsePublishedToml(publishedText).externalEntries) !== canonicalJson(externalEntries)) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Build publication metadata differs from the exact external source closure.');
  }
  const packageName = NATIVE_SOUL_SOURCE_NAMES[role];
  const packageDirectory = path.join(checkoutRoot, 'move', packageName);
  const result = await runProcess(suiBinary, [
    'move', 'build', '--path', packageDirectory, '--force', '--warnings-are-errors',
    '--dump-bytecode-as-base64', '--build-env', 'mainnet', '--pubfile-path', publishedTomlPath,
  ], { cwd: checkoutRoot });
  const output = parseJsonOutput(result, `${role} move build`);
  if (await fsp.readFile(publishedTomlPath, 'utf8') !== publishedText
    || canonicalJson(readNativeSoulExternalPublications({ sourceRevision, checkoutRoot })) !== canonicalJson(externalEntries)) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Publication metadata/source changed during build.');
  }
  exactKeys(output, ['modules', 'dependencies', 'digest'], `${role} build output`);
  if (!Array.isArray(output.modules) || !Array.isArray(output.dependencies) || !Array.isArray(output.digest)) {
    fail('MAINNET_V8_BUILD_OUTPUT_INVALID', `${role} build output is incomplete.`);
  }
  const files = await moduleFiles(packageDirectory, packageName);
  const builtModuleHashes = output.modules.map((value) => sha256Hex(fromBase64(value))).sort();
  const fileModuleHashes = files.map((value) => value.sha256).sort();
  if (canonicalJson(builtModuleHashes) !== canonicalJson(fileModuleHashes)) {
    fail('MAINNET_V8_BUILD_MODULE_DRIFT', `${role} dump modules differ from compiled bytecode files.`);
  }
  const observedSourceArtifact = await buildSourceArtifactForRole({
    role, checkoutRoot, sourceRevision, toolchain,
  });
  if (sourceArtifact !== null
    && canonicalJson(sourceArtifact) !== canonicalJson(observedSourceArtifact)) {
    fail('MAINNET_V8_SOURCE_ARTIFACT_DRIFT', `${role} archived source differs from the immutable execution plan.`);
  }
  const checkedSourceArtifact = observedSourceArtifact;
  const packageArtifact = await buildPackageArtifact({
    role,
    modules: files.map(({ name, base64 }) => ({ name, bytesBase64: base64 })),
    dependencies: output.dependencies.map((value) => address(value, `${role}.dependency`)).sort(),
    buildDigest: toHex(Uint8Array.from(output.digest)),
  });
  return Object.freeze({
    role,
    packageName,
    packageDirectory,
    modules: Object.freeze(files),
    publishModules: Object.freeze([...output.modules]),
    // Use the same canonical order that is frozen into packageArtifact.  The
    // published TransactionData and durable READY record must never disagree
    // merely because the CLI emitted a different dependency order.
    dependencies: Object.freeze([...packageArtifact.dependencies]),
    buildDigest: toHex(Uint8Array.from(output.digest)),
    sourceArtifact: checkedSourceArtifact,
    packageArtifact,
    compilerStderr: result.stderr,
  });
}

function expirationFor(profile, nonce) {
  if (!Number.isSafeInteger(nonce) || nonce < 0 || nonce > 0xffff_ffff) {
    fail('MAINNET_V8_NONCE_INVALID', 'Transaction nonce must be uint32.');
  }
  return Object.freeze({
    ValidDuring: Object.freeze({
      minEpoch: profile.epoch,
      maxEpoch: (BigInt(profile.epoch) + 1n).toString(),
      minTimestamp: null,
      maxTimestamp: null,
      chain: profile.chainIdentifier,
      nonce,
    }),
  });
}

export function configureMainnetV8Transaction(transaction, {
  sender,
  gasPrice,
  gasBudget,
  epoch,
  chainIdentifier = MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
  nonce,
}) {
  address(sender, 'sender');
  decimal(String(gasPrice), 'gasPrice');
  decimal(String(gasBudget), 'gasBudget');
  decimal(String(epoch), 'epoch');
  transaction.setSender(sender);
  transaction.setGasOwner(sender);
  transaction.setGasPayment([]);
  transaction.setGasPrice(gasPrice);
  transaction.setGasBudget(gasBudget);
  transaction.setExpiration(expirationFor({ epoch: String(epoch), chainIdentifier }, nonce));
  return transaction;
}

export function buildMainnetV8PublishTransaction({ modules, dependencies, transactionContext }) {
  const transaction = new Transaction();
  const upgradeCap = transaction.publish({ modules, dependencies });
  transaction.transferObjects([upgradeCap], transaction.pure.address(transactionContext.sender));
  return configureMainnetV8Transaction(transaction, transactionContext);
}


export function buildMainnetV8InitTransaction({ packageIds, protocolConfig, protocolAdminCap, transactionContext }) {
  const transaction = buildNativeSoulBootstrapTransaction('INITIALIZE_PROTOCOL', {
    packageIds, protocolConfig, protocolAdminCap,
  });
  return configureMainnetV8Transaction(transaction, transactionContext);
}


export async function inspectMainnetV8Transaction(transaction) {
  const transactionBytes = await transaction.build({ maxSizeBytes: MAINNET_V8_MAX_TRANSACTION_BYTES });
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionData.parse(transactionBytes);
    roundtrip = bcs.TransactionData.serialize(parsed, { maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES }).toBytes();
  } catch (cause) {
    fail('MAINNET_V8_TRANSACTION_INVALID', 'TransactionData is not canonical BCS.', {
      cause: String(cause?.message ?? cause),
    });
  }
  if (!sameBytes(transactionBytes, roundtrip) || parsed.$kind !== 'V1' || !parsed.V1) {
    fail('MAINNET_V8_TRANSACTION_INVALID', 'TransactionData is not canonical supported V1 BCS.');
  }
  const transactionKindBytes = bcs.TransactionKind.serialize(parsed.V1.kind, {
    maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES,
  }).toBytes();
  return Object.freeze({
    transactionBytes,
    transactionBase64: toBase64(transactionBytes),
    transactionByteLength: transactionBytes.length,
    transactionSha256: sha256Hex(transactionBytes),
    transactionKindBytes,
    transactionKindBase64: toBase64(transactionKindBytes),
    transactionKindSha256: sha256Hex(transactionKindBytes),
    digest: TransactionDataBuilder.getDigestFromBytes(transactionBytes),
    sender: address(parsed.V1.sender, 'transaction.sender'),
    gasOwner: address(parsed.V1.gasData.owner, 'transaction.gasOwner'),
    gasBudget: decimal(parsed.V1.gasData.budget, 'transaction.gasBudget'),
    gasPrice: decimal(parsed.V1.gasData.price, 'transaction.gasPrice'),
    expiration: canonicalizeSdk(parsed.V1.expiration),
  });
}

export function durableMainnetV8UnsignedEnvelope(envelope) {
  return Object.freeze({
    transactionBase64: envelope.transactionBase64,
    transactionByteLength: String(envelope.transactionByteLength),
    transactionSha256: envelope.transactionSha256,
    transactionKindBase64: envelope.transactionKindBase64,
    transactionKindSha256: envelope.transactionKindSha256,
    digest: envelope.digest,
    sender: envelope.sender,
    gasOwner: envelope.gasOwner,
    gasBudget: envelope.gasBudget,
    gasPrice: envelope.gasPrice,
    expiration: envelope.expiration,
  });
}

export function hydrateMainnetV8UnsignedEnvelope(durable) {
  exactKeys(durable, [
    'transactionBase64', 'transactionByteLength', 'transactionSha256',
    'transactionKindBase64', 'transactionKindSha256', 'digest', 'sender',
    'gasOwner', 'gasBudget', 'gasPrice', 'expiration',
  ], 'unsigned envelope');
  const transactionBytes = fromBase64(durable.transactionBase64);
  const parsed = bcs.TransactionData.parse(transactionBytes);
  const roundtrip = bcs.TransactionData.serialize(parsed, {
    maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES,
  }).toBytes();
  if (!sameBytes(transactionBytes, roundtrip) || parsed.$kind !== 'V1') {
    fail('MAINNET_V8_UNSIGNED_ENVELOPE_DRIFT', 'Durable unsigned TransactionData is noncanonical.');
  }
  const kindBytes = bcs.TransactionKind.serialize(parsed.V1.kind, {
    maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES,
  }).toBytes();
  if (String(transactionBytes.length) !== decimal(durable.transactionByteLength, 'transactionByteLength')
    || sha256Hex(transactionBytes) !== hash32(durable.transactionSha256, 'transactionSha256')
    || toBase64(kindBytes) !== durable.transactionKindBase64
    || sha256Hex(kindBytes) !== hash32(durable.transactionKindSha256, 'transactionKindSha256')
    || TransactionDataBuilder.getDigestFromBytes(transactionBytes) !== digest(durable.digest, 'digest')
    || address(parsed.V1.sender, 'transaction.sender') !== address(durable.sender, 'sender')
    || address(parsed.V1.gasData.owner, 'transaction.gasOwner') !== address(durable.gasOwner, 'gasOwner')
    || decimal(String(parsed.V1.gasData.budget), 'transaction.gasBudget') !== durable.gasBudget
    || decimal(String(parsed.V1.gasData.price), 'transaction.gasPrice') !== durable.gasPrice
    || canonicalJson(canonicalizeSdk(parsed.V1.expiration)) !== canonicalJson(durable.expiration)) {
    fail('MAINNET_V8_UNSIGNED_ENVELOPE_DRIFT', 'Durable unsigned envelope differs from canonical TransactionData.');
  }
  return Object.freeze({
    ...durable,
    transactionBytes,
    transactionKindBytes: kindBytes,
    transactionByteLength: transactionBytes.length,
  });
}

function exactMainnetV8PackageIds(value, label = 'stageData.packageIds') {
  exactKeys(value, ROLE_ORDER, label);
  return Object.freeze(Object.fromEntries(ROLE_ORDER.map((role) => [
    role,
    address(value[role], `${label}.${role}`),
  ])));
}

function exactMainnetV8Commitments(value, label = 'stageData.commitments') {
  exactKeys(value, ROLE_ORDER, label);
  return Object.freeze(Object.fromEntries(ROLE_ORDER.map((role) => {
    exactKeys(value[role], ['source', 'package', 'abi'], `${label}.${role}`);
    return [role, Object.freeze({
      source: hash32(value[role].source, `${label}.${role}.source`),
      package: hash32(value[role].package, `${label}.${role}.package`),
      abi: hash32(value[role].abi, `${label}.${role}.abi`),
    })];
  })));
}

function transactionContextFromReady(plan, readyArtifact, envelope) {
  const expiration = envelope.expiration;
  if (!plain(expiration) || expiration.$kind !== 'ValidDuring'
    || !plain(expiration.ValidDuring)) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY transaction must use ValidDuring expiration.');
  }
  const window = expiration.ValidDuring;
  exactKeys(window, [
    'minEpoch', 'maxEpoch', 'minTimestamp', 'maxTimestamp', 'chain', 'nonce',
  ], 'READY transaction expiration');
  if (window.minEpoch !== readyArtifact.protocolProfile.epoch
    || window.chain !== plan.chain.chainIdentifier) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY transaction expiration differs from its plan/profile.');
  }
  return Object.freeze({
    sender: plan.sender,
    gasPrice: envelope.gasPrice,
    gasBudget: envelope.gasBudget,
    epoch: window.minEpoch,
    chainIdentifier: window.chain,
    nonce: window.nonce,
  });
}

function readyEffectsChangedObjectCount(parsed, value) {
  if (parsed.$kind === 'V1') {
    return ['created', 'mutated', 'unwrapped', 'deleted', 'unwrappedThenDeleted', 'wrapped']
      .reduce((total, field) => total + value[field].length, 0);
  }
  return value.changedObjects.length;
}

function assertMainnetV8ReadyExecutionGates(plan, readyArtifact, envelope) {
  const profile = readyArtifact.protocolProfile;
  exactKeys(profile, [
    'chainIdentifier', 'protocolVersion', 'epoch', 'gasPrice', 'attributes',
  ], 'READY protocolProfile');
  exactKeys(profile.attributes, [
    'objectRuntimeMaxNumCachedObjects', 'objectRuntimeMaxNumStoreEntries',
  ], 'READY protocolProfile.attributes');
  if (profile.chainIdentifier !== plan.chain.chainIdentifier
    || profile.protocolVersion !== MAINNET_V8_RELEASE_TOOLCHAIN.protocolVersion
    || profile.gasPrice !== envelope.gasPrice
    || profile.attributes.objectRuntimeMaxNumCachedObjects
      !== MAINNET_V8_RELEASE_TOOLCHAIN.objectRuntimeMaxCachedObjects
    || profile.attributes.objectRuntimeMaxNumStoreEntries
      !== MAINNET_V8_RELEASE_TOOLCHAIN.objectRuntimeMaxStoreEntries) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY protocol profile differs from TransactionData or approved Mainnet.');
  }
  decimal(profile.epoch, 'READY protocolProfile.epoch');

  const simulation = readyArtifact.simulation;
  exactKeys(simulation, [
    'digest', 'effectsTransactionDigest', 'effectsBcsBase64', 'gasUsed', 'recommendedGasBudget',
    'changedObjects', 'objectTypes',
  ], 'READY simulation');
  exactKeys(simulation.gasUsed, [
    'computationCost', 'storageCost', 'storageRebate', 'nonRefundableStorageFee',
  ], 'READY simulation.gasUsed');
  const effectsBytes = fromBase64(simulation.effectsBcsBase64);
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionEffects.parse(effectsBytes);
    roundtrip = bcs.TransactionEffects.serialize(parsed, {
      maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES,
    }).toBytes();
  } catch (cause) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY simulation effects are not canonical TransactionEffects.', {
      cause: String(cause?.message ?? cause),
    });
  }
  const value = parsed.V1 ?? parsed.V2;
  const gasUsed = Object.fromEntries(Object.entries(simulation.gasUsed)
    .map(([field, amount]) => [field, decimal(String(amount), `READY simulation.gasUsed.${field}`)]));
  if (!value || !sameBytes(effectsBytes, roundtrip) || value.status?.$kind !== 'Success'
    || value.transactionDigest !== simulation.effectsTransactionDigest
    || String(value.executedEpoch) !== profile.epoch
    || simulation.digest !== envelope.digest
    || canonicalJson(gasUsed) !== canonicalJson(canonicalizeSdk(value.gasUsed))
    || !Array.isArray(simulation.changedObjects)
    || !plain(simulation.objectTypes)
    || simulation.changedObjects.length !== readyEffectsChangedObjectCount(parsed, value)
    || BigInt(decimal(simulation.recommendedGasBudget, 'READY simulation.recommendedGasBudget'))
      > BigInt(envelope.gasBudget)) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY simulation does not certify the exact final TransactionData.');
  }

  const funding = readyArtifact.gasFunding;
  exactKeys(funding, [
    'coinType', 'addressBalance', 'coinBalance', 'checkedAtEpoch',
  ], 'READY gasFunding');
  if (funding.coinType !== `${normalizeSuiAddress('0x2')}::sui::SUI`
    || funding.checkedAtEpoch !== profile.epoch
    || BigInt(decimal(funding.addressBalance, 'READY gasFunding.addressBalance'))
      < BigInt(envelope.gasBudget)) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY gas funding does not cover the exact transaction.');
  }
  decimal(funding.coinBalance, 'READY gasFunding.coinBalance');
}

/**
 * Rebuild the exact reviewed TransactionData from the durable READY artifact.
 * Store/WAL hashes are integrity evidence only; this compiler-side comparison is
 * the execution authority used before signing, querying, or broadcasting.
 */
export function buildMainnetV8ReadyTransaction({ ordinal, readyArtifact, transactionContext }) {
  const ordinalText = decimal(String(ordinal), 'ordinal');
  const step = MAINNET_V8_RELEASE_STEPS.find(entry => entry.ordinal === ordinalText);
  if (!step || step.kind === 'VERIFY_AND_EXPORT') {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'This ordinal does not have a release transaction.');
  }
  if (!plain(readyArtifact) || readyArtifact.kind !== step.kind) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY kind differs from the exact release stage.');
  }
  if (step.kind === 'PUBLISH') {
    if (readyArtifact.role !== step.role
      || !Array.isArray(readyArtifact.modules) || !Array.isArray(readyArtifact.dependencies)) {
      fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'Publish READY artifact differs from its ordinal.');
    }
    return buildMainnetV8PublishTransaction({
      modules: readyArtifact.modules,
      dependencies: readyArtifact.dependencies,
      transactionContext,
    });
  }
  if (step.kind === 'ACTIVATE_SOULIDITY_MARKET') {
    return configureMainnetV8Transaction(buildNativeSoulMarketActivationTransaction(
      nativeSoulMarketActivationInputFromStageData(readyArtifact.stageData)), transactionContext);
  }
  return configureMainnetV8Transaction(buildNativeSoulBootstrapTransaction(
    step.kind, nativeSoulBootstrapInputFromStageData(step.kind, readyArtifact.stageData),
  ), transactionContext);
}

export async function assertMainnetV8TransactionMatchesReady(input) {
  assertReleasePlan(input.plan);
  return assertMainnetV8TransactionMatchesReadyContents(input);
}

/** Offline byte/content comparison shared with the guarded execution matcher.
 * A successful comparison does not authorize WAL writes, signing or submission;
 * execution callers must continue using assertMainnetV8TransactionMatchesReady.
 */
export async function assertMainnetV8TransactionMatchesReadyContents({
  ordinal,
  plan,
  readyArtifact,
  unsignedEnvelope,
}) {
  assertMainnetV8ReleasePlanContents(plan);
  const ordinalText = decimal(String(ordinal), 'ordinal');
  if (!plain(readyArtifact) || !plain(readyArtifact.protocolProfile)) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY artifact is malformed.');
  }
  const hydrated = hydrateMainnetV8UnsignedEnvelope(unsignedEnvelope);
  if (hydrated.sender !== plan.sender || hydrated.gasOwner !== plan.sender) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'READY sender/gas owner differs from the immutable plan.');
  }
  assertMainnetV8ReadyExecutionGates(plan, readyArtifact, hydrated);
  const expected = buildMainnetV8ReadyTransaction({
    ordinal: ordinalText, readyArtifact,
    transactionContext: transactionContextFromReady(plan, readyArtifact, hydrated),
  });
  const rebuilt = await inspectMainnetV8Transaction(expected);
  if (!sameBytes(rebuilt.transactionBytes, hydrated.transactionBytes)
    || !sameBytes(rebuilt.transactionKindBytes, hydrated.transactionKindBytes)
    || rebuilt.digest !== hydrated.digest) {
    fail('MAINNET_V8_READY_TRANSACTION_DRIFT', 'Durable TransactionData is not the exact reviewed READY transaction.', {
      expectedDigest: rebuilt.digest,
      observedDigest: hydrated.digest,
    });
  }
  return Object.freeze({
    ordinal: ordinalText,
    digest: hydrated.digest,
    transactionSha256: hydrated.transactionSha256,
    transactionKindSha256: hydrated.transactionKindSha256,
  });
}

export async function prepareUnsignedMainnetV8Transaction({
  client,
  profile,
  sender,
  buildTransaction,
  nonce = randomUint32(),
}) {
  const balanceResponse = await client.core.getBalance({
    owner: sender,
    coinType: `${normalizeSuiAddress('0x2')}::sui::SUI`,
  });
  const balance = balanceResponse?.balance;
  const addressBalance = decimal(String(balance?.addressBalance), 'gasFunding.addressBalance');
  const coinBalance = decimal(String(balance?.coinBalance), 'gasFunding.coinBalance');
  if (balance?.coinType !== `${normalizeSuiAddress('0x2')}::sui::SUI`
    || BigInt(addressBalance) < MAINNET_V8_MINIMUM_GAS_CUSHION) {
    fail('MAINNET_V8_GAS_FUNDING_INSUFFICIENT', 'Signer address balance cannot fund the minimum simulation cushion.', {
      addressBalance,
      minimumGasCushion: MAINNET_V8_MINIMUM_GAS_CUSHION.toString(),
    });
  }
  let gasBudget = MAINNET_V8_PRELIMINARY_GAS_BUDGET;
  let finalEnvelope = null;
  let finalSimulation = null;
  let checkedPassComplete = false;
  for (let pass = 0; pass < 4; pass += 1) {
    const context = releaseTransactionContext(profile, sender, gasBudget, nonce);
    const transaction = buildTransaction(context);
    const envelope = await inspectMainnetV8Transaction(transaction);
    if (envelope.sender !== sender || envelope.gasOwner !== sender) {
      fail('MAINNET_V8_SIGNER_DRIFT', 'Prepared transaction sender/gas owner differs from release signer.');
    }
    // The first pass is an estimate only.  Disabling address-balance gas
    // selection lets the node use its mock gas coin and report an exact cost
    // even when the signer cannot yet fund the conservative preliminary cap.
    // Every executable READY envelope is rebuilt and simulated again below
    // with normal checks and real address-balance gas selection.
    const estimateOnly = pass === 0;
    const simulation = await simulateMainnetV8Transaction(client, envelope, {
      checksEnabled: !estimateOnly,
      doGasSelection: !estimateOnly,
    });
    const recommended = BigInt(simulation.recommendedGasBudget);
    finalEnvelope = envelope;
    finalSimulation = simulation;
    if (recommended > BigInt(addressBalance)) {
      fail('MAINNET_V8_GAS_FUNDING_INSUFFICIENT', 'Signer address balance cannot fund the dry-run-derived gas budget.', {
        addressBalance,
        recommendedGasBudget: recommended.toString(),
      });
    }
    if (!estimateOnly && recommended === gasBudget) {
      checkedPassComplete = true;
      break;
    }
    gasBudget = recommended;
  }
  if (!checkedPassComplete || finalEnvelope === null
    || BigInt(finalSimulation.recommendedGasBudget) !== BigInt(finalEnvelope.gasBudget)) {
    fail('MAINNET_V8_GAS_BUDGET_UNSTABLE', 'Dry-run gas recommendation did not converge within the bounded passes.');
  }
  if (balance?.coinType !== `${normalizeSuiAddress('0x2')}::sui::SUI`
    || BigInt(addressBalance) < BigInt(finalEnvelope.gasBudget)) {
    fail('MAINNET_V8_GAS_FUNDING_INSUFFICIENT', 'Signer address balance cannot fund exact prepared gas budget.', {
      addressBalance,
      gasBudget: finalEnvelope.gasBudget,
    });
  }
  return Object.freeze({
    unsignedEnvelope: durableMainnetV8UnsignedEnvelope(finalEnvelope),
    simulation: canonicalizeSdk(finalSimulation),
    gasFunding: Object.freeze({
      coinType: balance.coinType,
      addressBalance,
      coinBalance,
      checkedAtEpoch: profile.epoch,
    }),
  });
}

export async function simulateMainnetV8Transaction(client, envelope, {
  checksEnabled = true,
  doGasSelection = true,
} = {}) {
  const result = await client.simulateTransaction({
    transaction: envelope.transactionBytes,
    checksEnabled,
    doGasSelection,
    include: { effects: true, events: true, objectTypes: true, bcs: true, transaction: true },
  });
  const value = result?.$kind === 'Transaction' ? result.Transaction : result?.FailedTransaction;
  if (!value
    || (value.digest !== null && value.digest !== undefined && value.digest !== envelope.digest)) {
    fail('MAINNET_V8_SIMULATION_DRIFT', 'Simulation did not bind the exact transaction digest.');
  }
  if (value.status?.success !== true || value.effects?.status?.success !== true) {
    fail('MAINNET_V8_SIMULATION_FAILED', 'Exact Mainnet transaction simulation failed.', {
      status: canonicalizeSdk(value.status),
      effectsStatus: canonicalizeSdk(value.effects?.status),
    });
  }
  if (!(value.bcs instanceof Uint8Array) || !sameBytes(value.bcs, envelope.transactionBytes)) {
    fail('MAINNET_V8_SIMULATION_TRANSACTION_DRIFT', 'Simulation changed exact TransactionData bytes.');
  }
  const effectsTransactionDigest = digest(
    value.effects?.transactionDigest,
    'simulation.effects.transactionDigest',
  );
  const gasUsed = value.effects.gasUsed;
  const gross = BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost)
    + BigInt(gasUsed.nonRefundableStorageFee);
  const net = gross > BigInt(gasUsed.storageRebate) ? gross - BigInt(gasUsed.storageRebate) : gross;
  return Object.freeze({
    digest: envelope.digest,
    effectsTransactionDigest,
    effectsBcsBase64: value.effects.bcs ? toBase64(value.effects.bcs) : null,
    gasUsed: Object.freeze({ ...gasUsed }),
    recommendedGasBudget: (net * 2n + MAINNET_V8_MINIMUM_GAS_CUSHION).toString(),
    changedObjects: Object.freeze(value.effects.changedObjects.map(canonicalizeSdk)),
    objectTypes: Object.freeze({ ...(value.objectTypes ?? {}) }),
  });
}

export async function signExactMainnetV8Transaction({ suiBinary, sender, envelope }) {
  if (envelope.sender !== sender || envelope.gasOwner !== sender) {
    fail('MAINNET_V8_SIGNER_DRIFT', 'Transaction sender/gas owner differs from the release signer.');
  }
  const result = await withApprovedSuiBinarySnapshot(
    suiBinary,
    async (snapshotPath) => runProcess(snapshotPath, [
      'keytool', 'sign', '--address', sender, '--data', envelope.transactionBase64, '--json',
    ]),
  );
  const output = parseJsonOutput(result, 'sui keytool sign');
  exactKeys(output, ['suiAddress', 'rawTxData', 'intent', 'rawIntentMsg', 'digest', 'suiSignature'], 'keytool signature');
  const rawIntentBytes = fromBase64(output.rawIntentMsg);
  const expectedIntentBytes = new Uint8Array(envelope.transactionBytes.length + 3);
  expectedIntentBytes.set(envelope.transactionBytes, 3);
  const intentDigestBytes = fromBase64(output.digest);
  if (output.suiAddress !== sender || output.rawTxData !== envelope.transactionBase64
    || output.intent?.scope !== 0 || output.intent?.version !== 0 || output.intent?.app_id !== 0
    || toBase64(rawIntentBytes) !== output.rawIntentMsg || toBase64(intentDigestBytes) !== output.digest
    || !sameBytes(rawIntentBytes, expectedIntentBytes)
    || intentDigestBytes.length !== 32
    || !sameBytes(intentDigestBytes, blake2b(rawIntentBytes, { dkLen: 32 }))) {
    fail('MAINNET_V8_SIGNATURE_DRIFT', 'Sui keytool did not sign the exact TransactionData intent.', {
      signer: output.suiAddress,
      intent: output.intent,
    });
  }
  const signatureBytes = fromBase64(output.suiSignature);
  let publicKey;
  try {
    publicKey = await verifyTransactionSignature(envelope.transactionBytes, output.suiSignature);
  } catch (cause) {
    fail('MAINNET_V8_SIGNATURE_INVALID', 'Keytool signature is not valid for exact TransactionData.', {
      cause: String(cause?.message ?? cause),
    });
  }
  if (publicKey.toSuiAddress() !== sender) {
    fail('MAINNET_V8_SIGNATURE_SIGNER_DRIFT', 'Keytool signature belongs to another Sui address.');
  }
  const transactionData = bcs.TransactionData.parse(envelope.transactionBytes);
  const senderSignedDataBytes = bcs.SenderSignedData.serialize([{
    intentMessage: {
      intent: {
        scope: { TransactionData: true },
        version: { V0: true },
        appId: { Sui: true },
      },
      value: transactionData,
    },
    txSignatures: [output.suiSignature],
  }], { maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES }).toBytes();
  return Object.freeze({
    transactionBase64: envelope.transactionBase64,
    transactionSha256: envelope.transactionSha256,
    transactionKindBase64: envelope.transactionKindBase64,
    transactionKindSha256: envelope.transactionKindSha256,
    digest: envelope.digest,
    signature: output.suiSignature,
    signatureSha256: sha256Hex(signatureBytes),
    senderSignedDataBase64: toBase64(senderSignedDataBytes),
    senderSignedDataSha256: sha256Hex(senderSignedDataBytes),
    signer: sender,
  });
}

export async function verifyExactMainnetV8SignedArtifact(artifact) {
  exactKeys(artifact, [
    'transactionBase64', 'transactionSha256', 'transactionKindBase64', 'transactionKindSha256',
    'digest', 'signature', 'signatureSha256', 'senderSignedDataBase64',
    'senderSignedDataSha256', 'signer',
  ], 'signed artifact');
  const transactionBytes = fromBase64(artifact.transactionBase64);
  const signatureBytes = fromBase64(artifact.signature);
  if (sha256Hex(transactionBytes) !== hash32(artifact.transactionSha256, 'transactionSha256')
    || sha256Hex(signatureBytes) !== hash32(artifact.signatureSha256, 'signatureSha256')
    || TransactionDataBuilder.getDigestFromBytes(transactionBytes) !== digest(artifact.digest, 'digest')) {
    fail('MAINNET_V8_SIGNED_ARTIFACT_DRIFT', 'Signed artifact hashes or digest drifted.');
  }
  const parsed = bcs.TransactionData.parse(transactionBytes);
  const kindBytes = bcs.TransactionKind.serialize(parsed.V1.kind, {
    maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES,
  }).toBytes();
  if (parsed.$kind !== 'V1' || parsed.V1.sender !== artifact.signer
    || parsed.V1.gasData.owner !== artifact.signer
    || toBase64(kindBytes) !== artifact.transactionKindBase64
    || sha256Hex(kindBytes) !== hash32(artifact.transactionKindSha256, 'transactionKindSha256')) {
    fail('MAINNET_V8_SIGNED_ARTIFACT_DRIFT', 'Signed artifact sender/gas owner drifted.');
  }
  const senderSignedDataBytes = fromBase64(artifact.senderSignedDataBase64);
  const senderSignedData = bcs.SenderSignedData.parse(senderSignedDataBytes);
  const senderSignedRoundtrip = bcs.SenderSignedData.serialize(senderSignedData, {
    maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES,
  }).toBytes();
  if (!sameBytes(senderSignedDataBytes, senderSignedRoundtrip)
    || sha256Hex(senderSignedDataBytes) !== hash32(artifact.senderSignedDataSha256, 'senderSignedDataSha256')
    || senderSignedData.length !== 1
    || senderSignedData[0].intentMessage.intent.scope?.$kind !== 'TransactionData'
    || senderSignedData[0].intentMessage.intent.version?.$kind !== 'V0'
    || senderSignedData[0].intentMessage.intent.appId?.$kind !== 'Sui'
    || senderSignedData[0].txSignatures.length !== 1
    || senderSignedData[0].txSignatures[0] !== artifact.signature
    || !sameBytes(
      bcs.TransactionData.serialize(senderSignedData[0].intentMessage.value).toBytes(),
      transactionBytes,
    )) {
    fail('MAINNET_V8_SIGNED_ARTIFACT_DRIFT', 'SenderSignedData differs from exact TransactionData/signature intent.');
  }
  const publicKey = await verifyTransactionSignature(transactionBytes, artifact.signature);
  if (publicKey.toSuiAddress() !== artifact.signer) {
    fail('MAINNET_V8_SIGNED_ARTIFACT_DRIFT', 'Signed artifact signature belongs to another signer.');
  }
  return Object.freeze({ ...artifact, transactionBytes, signatureBytes, senderSignedDataBytes });
}

export function writtenReferencesFromEffects(effectsBytes, expectedDigest) {
  const parsed = bcs.TransactionEffects.parse(effectsBytes);
  const value = parsed.V1 ?? parsed.V2;
  if (!value || value.transactionDigest !== expectedDigest || value.status?.$kind !== 'Success') {
    fail('MAINNET_V8_EFFECTS_INVALID', 'TransactionEffects do not bind one successful exact digest.');
  }
  if (parsed.$kind === 'V1') {
    const rows = [];
    for (const [operation, entries] of [
      ['CREATED', value.created],
      ['MUTATED', value.mutated],
      ['MUTATED', value.unwrapped],
    ]) {
      for (const [reference, owner] of entries) {
        rows.push(Object.freeze({
          operation,
          objectId: address(reference.objectId, `effects.${operation}.objectId`),
          version: decimal(String(reference.version), `effects.${operation}.version`),
          digest: digest(reference.digest, `effects.${operation}.digest`),
          owner: ownerEvidence(owner, `effects.${operation}.owner`),
        }));
      }
    }
    return Object.freeze(rows);
  }
  const version = decimal(String(value.lamportVersion), 'effects.lamportVersion');
  return Object.freeze(value.changedObjects.flatMap(([objectId, change]) => {
    const operation = change.idOperation?.$kind === 'Created' ? 'CREATED' : 'MUTATED';
    if (change.outputState?.$kind === 'ObjectWrite') {
      const [objectDigest, owner] = change.outputState.ObjectWrite;
      return [Object.freeze({
        operation,
        objectId: address(objectId, 'effects.changed.objectId'),
        version,
        digest: digest(objectDigest, 'effects.changed.digest'),
        owner: ownerEvidence(owner, 'effects.changed.owner'),
      })];
    }
    if (change.outputState?.$kind === 'PackageWrite') {
      const [packageVersion, packageDigest] = change.outputState.PackageWrite;
      return [Object.freeze({
        operation,
        objectId: address(objectId, 'effects.package.objectId'),
        version: decimal(packageVersion, 'effects.package.version'),
        digest: digest(packageDigest, 'effects.package.digest'),
        owner: Object.freeze({ kind: 'Immutable' }),
      })];
    }
    // Sui effects_v2: a Move object created then wrapped has no live ObjectRef.
    if (change.inputState?.$kind === 'NotExist'
      && change.outputState?.$kind === 'NotExist'
      && change.idOperation?.$kind === 'Created') {
      return [];
    }
    if (change.idOperation?.$kind !== 'Created'
      && ['NotExist', 'AccumulatorWriteV1'].includes(change.outputState?.$kind)) {
      return [];
    }
    fail('MAINNET_V8_CREATED_OUTPUT_INVALID', 'Created effects entry has no object/package output.');
  }));
}

export function createdReferencesFromEffects(effectsBytes, expectedDigest) {
  return Object.freeze(writtenReferencesFromEffects(effectsBytes, expectedDigest)
    .filter((entry) => entry.operation === 'CREATED')
    .map(({ operation: _operation, ...entry }) => Object.freeze(entry)));
}

async function normalizeRawMainnetV8FinalizedOutcome(transaction, transactionDigest, signedArtifact) {
  const raw = officialMessage(transaction, GrpcTypes.ExecutedTransaction, 'raw transaction');
  if (digest(raw.digest, 'raw transaction.digest') !== transactionDigest) {
    fail('MAINNET_V8_FINALIZED_DIGEST_DRIFT', 'Raw finalized transaction returned another digest.');
  }
  const inner = officialMessage(raw.transaction, GrpcTypes.Transaction, 'raw transaction.transaction');
  const transactionEvidence = canonicalBcs(
    inner.bcs,
    'TransactionData',
    bcs.TransactionData,
    'raw transaction.transaction.bcs',
  );
  if (digest(inner.digest, 'raw transaction.transaction.digest') !== transactionDigest
    || TransactionDataBuilder.getDigestFromBytes(transactionEvidence.bytes) !== transactionDigest
    || !sameBytes(transactionEvidence.bytes, fromBase64(signedArtifact.transactionBase64))) {
    fail('MAINNET_V8_FINALIZED_ENVELOPE_DRIFT', 'Raw finalized TransactionData differs from durable signed bytes.');
  }
  if (!Array.isArray(raw.signatures) || raw.signatures.length !== 1) {
    fail('MAINNET_V8_FINALIZED_SIGNATURE_DRIFT', 'Raw finalized transaction must contain exactly one signature.');
  }
  const signatureBytes = namedBcsBytes(raw.signatures[0].bcs, 'UserSignatureBytes', 'raw transaction.signatures[0].bcs');
  if (toBase64(signatureBytes) !== signedArtifact.signature) {
    fail('MAINNET_V8_FINALIZED_SIGNATURE_DRIFT', 'Raw finalized signature differs from durable signature bytes.');
  }
  const verified = await verifyExactMainnetV8SignedArtifact(signedArtifact);
  if (verified.digest !== transactionDigest) {
    fail('MAINNET_V8_FINALIZED_ENVELOPE_DRIFT', 'Durable signed artifact differs from requested digest.');
  }
  const effects = officialMessage(raw.effects, GrpcTypes.TransactionEffects, 'raw transaction.effects');
  const status = officialMessage(effects.status, GrpcTypes.ExecutionStatus, 'raw transaction.effects.status');
  const effectsEvidence = canonicalBcs(
    effects.bcs,
    'TransactionEffects',
    bcs.TransactionEffects,
    'raw transaction.effects.bcs',
  );
  const parsedEffects = effectsEvidence.parsed.V1 ?? effectsEvidence.parsed.V2;
  const expectedEffectsVersion = effectsEvidence.parsed.$kind === 'V1' ? 1
    : effectsEvidence.parsed.$kind === 'V2' ? 2 : null;
  if (!parsedEffects || parsedEffects.transactionDigest !== transactionDigest
    || effects.version !== expectedEffectsVersion
    || digest(effects.transactionDigest, 'raw transaction.effects.transactionDigest') !== transactionDigest
    || typedDigest('TransactionEffects', effectsEvidence.bytes)
      !== digest(effects.digest, 'raw transaction.effects.digest')) {
    fail('MAINNET_V8_FINALIZED_EFFECTS_DRIFT', 'Raw finalized effects do not bind the exact transaction.');
  }
  const executedEpoch = decimal(String(parsedEffects.executedEpoch), 'raw transaction.effects.executedEpoch');
  const epoch = decimal(String(effects.epoch), 'raw transaction.effects.epoch');
  if (executedEpoch !== epoch) {
    fail('MAINNET_V8_FINALIZED_EFFECTS_DRIFT', 'Raw finalized effects epoch disagrees with its BCS envelope.');
  }
  const effectsSucceeded = parsedEffects.status?.$kind === 'Success';
  const executionError = status.error === undefined ? null : normalizeMoveDescriptor(
    GrpcTypes.ExecutionError.toJson(
      officialMessage(status.error, GrpcTypes.ExecutionError, 'raw transaction.effects.status.error'),
      { enumAsInteger: false, useProtoFieldName: false },
    ),
  );
  if (effectsSucceeded !== (status.success === true)
    || effectsSucceeded === (status.error !== undefined)) {
    fail('MAINNET_V8_FINALIZED_STATUS_DRIFT', 'Raw execution status disagrees with TransactionEffects BCS.');
  }
  const parsedEventsDigest = parsedEffects.eventsDigest == null
    ? null
    : digest(parsedEffects.eventsDigest, 'raw transaction.effects.eventsDigest');
  const envelopeEventsDigest = effects.eventsDigest == null
    ? null
    : digest(effects.eventsDigest, 'raw transaction.effects.envelopeEventsDigest');
  if (parsedEventsDigest !== envelopeEventsDigest) {
    fail('MAINNET_V8_FINALIZED_EVENTS_DRIFT', 'Raw finalized events digest disagrees with effects BCS.');
  }
  let transactionEvents = null;
  if (parsedEventsDigest !== null) {
    const events = officialMessage(raw.events, GrpcTypes.TransactionEvents, 'raw transaction.events');
    const eventEvidence = canonicalBcs(
      events.bcs,
      'TransactionEvents',
      SUI_TRANSACTION_EVENTS_BCS,
      'raw transaction.events.bcs',
    );
    if (digest(events.digest, 'raw transaction.events.digest') !== parsedEventsDigest
      || typedDigest('TransactionEvents', eventEvidence.bytes) !== parsedEventsDigest
      || eventEvidence.parsed.data.length === 0) {
      fail('MAINNET_V8_FINALIZED_EVENTS_DRIFT', 'Raw TransactionEvents do not derive the effects event digest.');
    }
    transactionEvents = Object.freeze({
      digest: parsedEventsDigest,
      bcsBase64: toBase64(eventEvidence.bytes),
      eventCount: String(eventEvidence.parsed.data.length),
    });
  } else if (raw.events !== undefined) {
    fail('MAINNET_V8_FINALIZED_EVENTS_DRIFT', 'Raw events exist while effects declare no events digest.');
  }
  return Object.freeze({
    status: effectsSucceeded ? 'FINALIZED_SUCCESS' : 'FINALIZED_FAILURE',
    evidence: Object.freeze({
      schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
      digest: transactionDigest,
      checkpoint: decimal(String(raw.checkpoint), 'raw transaction.checkpoint'),
      epoch,
      transactionBase64: signedArtifact.transactionBase64,
      transactionSha256: signedArtifact.transactionSha256,
      signature: signedArtifact.signature,
      signatureSha256: signedArtifact.signatureSha256,
      effectsBcsBase64: toBase64(effectsEvidence.bytes),
      effectsSha256: sha256Hex(effectsEvidence.bytes),
      effectsDigest: effects.digest,
      effectsStatus: effectsSucceeded
        ? Object.freeze({ success: true, error: null })
        : Object.freeze({ success: false, error: executionError }),
      eventsDigest: parsedEventsDigest,
      transactionEvents,
    }),
  });
}

async function queryRawMainnetV8FinalizedOutcome({ client, transactionDigest, signedArtifact }) {
  let result;
  try {
    result = await client.ledgerService.getTransaction({
      digest: transactionDigest,
      readMask: {
        paths: [
          'digest', 'checkpoint', 'transaction.digest', 'transaction.bcs', 'signatures.bcs',
          'effects.bcs', 'effects.digest', 'effects.version', 'effects.status', 'effects.epoch',
          'effects.transaction_digest', 'effects.events_digest', 'events.bcs', 'events.digest',
        ],
      },
    });
  } catch (error) {
    if (error instanceof RpcError && error.name === 'RpcError'
      && error.code === 'NOT_FOUND' && error.serviceName === LEDGER_SERVICE
      && error.methodName === GET_TRANSACTION) {
      return Object.freeze({ status: 'NOT_FOUND', error });
    }
    throw error;
  }
  const response = officialMessage(result?.response, GrpcTypes.GetTransactionResponse, 'raw getTransaction.response');
  return await normalizeRawMainnetV8FinalizedOutcome(response.transaction, transactionDigest, signedArtifact);
}

export async function queryFinalizedMainnetV8Outcome({ client, transport, digest: transactionDigest, signedArtifact }) {
  const verified = await verifyExactMainnetV8SignedArtifact(signedArtifact);
  if (verified.digest !== transactionDigest) fail('MAINNET_V8_QUERY_DIGEST_DRIFT', 'Query digest differs from signed artifact.');
  try {
    const evidence = await transport.getFinalizedTransactionEvidence({ digest: transactionDigest });
    if (!sameBytes(evidence.transactionBcs, verified.transactionBytes)
      || evidence.signatures.length !== 1 || evidence.signatures[0] !== signedArtifact.signature) {
      fail('MAINNET_V8_FINALIZED_ENVELOPE_DRIFT', 'Finalized envelope differs from durable exact signed bytes.');
    }
    return Object.freeze({ status: 'FINALIZED_SUCCESS', evidence });
  } catch (error) {
    if (isMakerV8SuiGrpcNotFoundError(error, transactionDigest)) {
      return Object.freeze({ status: 'NOT_FOUND', error });
    }
    if (error?.code === 'MAKER_V8_SUI_GRPC_TRANSACTION_FAILED') {
      if (!client?.ledgerService?.getTransaction) throw error;
      const raw = await queryRawMainnetV8FinalizedOutcome({ client, transactionDigest, signedArtifact });
      if (raw.status === 'NOT_FOUND') {
        return Object.freeze({
          status: 'FINALITY_EVIDENCE_UNAVAILABLE',
          error: new MainnetV8ReleaseError(
            'MAINNET_V8_FINALIZED_FAILURE_EVIDENCE_UNAVAILABLE',
            'A finalized failure was observed but its raw effects envelope became unavailable; bytes remain query-only.',
            { digest: transactionDigest },
          ),
        });
      }
      return raw;
    }
    throw error;
  }
}

export function durableMainnetV8FinalityEvidence(evidence, signedArtifact) {
  if (evidence?.schemaVersion === MAINNET_V8_RELEASE_RUNNER_SCHEMA
    && typeof evidence.effectsBcsBase64 === 'string') {
    return assertDurableMainnetV8FinalityEvidence(canonicalizeSdk(evidence), signedArtifact);
  }
  if (!evidence || evidence.digest !== signedArtifact.digest
    || !sameBytes(evidence.transactionBcs, fromBase64(signedArtifact.transactionBase64))
    || evidence.signatures?.length !== 1 || evidence.signatures[0] !== signedArtifact.signature) {
    fail('MAINNET_V8_FINALIZED_ENVELOPE_DRIFT', 'Finality evidence differs from exact durable signed artifact.');
  }
  const effectsBytes = bytes(evidence.effectsBcs, 'finality.effectsBcs');
  const parsedEffects = bcs.TransactionEffects.parse(effectsBytes);
  const value = parsedEffects.V1 ?? parsedEffects.V2;
  if (!value || value.transactionDigest !== signedArtifact.digest) {
    fail('MAINNET_V8_FINALIZED_EFFECTS_DRIFT', 'Finality effects do not bind exact signed digest.');
  }
  return assertDurableMainnetV8FinalityEvidence({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    digest: signedArtifact.digest,
    checkpoint: decimal(String(evidence.checkpoint), 'finality.checkpoint'),
    epoch: decimal(String(evidence.epoch), 'finality.epoch'),
    transactionBase64: signedArtifact.transactionBase64,
    transactionSha256: signedArtifact.transactionSha256,
    signature: signedArtifact.signature,
    signatureSha256: signedArtifact.signatureSha256,
    effectsBcsBase64: toBase64(effectsBytes),
    effectsSha256: sha256Hex(effectsBytes),
    effectsDigest: digest(evidence.effectsDigest, 'finality.effectsDigest'),
    effectsStatus: Object.freeze({ success: true, error: null }),
    eventsDigest: evidence.eventsDigest == null
      ? null
      : digest(evidence.eventsDigest, 'finality.eventsDigest'),
    transactionEvents: evidence.transactionEvents == null ? null : Object.freeze({
      digest: digest(evidence.transactionEvents.digest, 'finality.transactionEvents.digest'),
      bcsBase64: evidence.transactionEvents.bcsBase64,
      eventCount: String(evidence.transactionEvents.eventCount),
    }),
  }, signedArtifact);
}

export function assertDurableMainnetV8FinalityEvidence(evidence, signedArtifact) {
  exactKeys(evidence, [
    'schemaVersion', 'digest', 'checkpoint', 'epoch', 'transactionBase64',
    'transactionSha256', 'signature', 'signatureSha256', 'effectsBcsBase64',
    'effectsSha256', 'effectsDigest', 'effectsStatus', 'eventsDigest',
    'transactionEvents',
  ], 'finality evidence');
  if (evidence.schemaVersion !== MAINNET_V8_RELEASE_RUNNER_SCHEMA
    || evidence.digest !== signedArtifact.digest
    || evidence.transactionBase64 !== signedArtifact.transactionBase64
    || evidence.transactionSha256 !== signedArtifact.transactionSha256
    || evidence.signature !== signedArtifact.signature
    || evidence.signatureSha256 !== signedArtifact.signatureSha256) {
    fail('MAINNET_V8_FINALIZED_ENVELOPE_DRIFT', 'Durable finality envelope differs from exact signed bytes.');
  }
  decimal(String(evidence.checkpoint), 'finality.checkpoint');
  decimal(String(evidence.epoch), 'finality.epoch');
  exactKeys(evidence.effectsStatus, ['success', 'error'], 'finality.effectsStatus');
  if (typeof evidence.effectsStatus.success !== 'boolean'
    || (evidence.effectsStatus.success && evidence.effectsStatus.error !== null)
    || (!evidence.effectsStatus.success && !plain(evidence.effectsStatus.error))) {
    fail('MAINNET_V8_FINALIZED_STATUS_DRIFT', 'Durable finality status/error shape is invalid.');
  }
  const effectsBytes = fromBase64(evidence.effectsBcsBase64);
  let parsed;
  let roundtrip;
  try {
    parsed = bcs.TransactionEffects.parse(effectsBytes);
    roundtrip = bcs.TransactionEffects.serialize(parsed, {
      maxSize: MAINNET_V8_MAX_TRANSACTION_BYTES,
    }).toBytes();
  } catch (cause) {
    fail('MAINNET_V8_FINALIZED_EFFECTS_DRIFT', 'Durable finality effects are not canonical BCS.', {
      cause: String(cause?.message ?? cause),
    });
  }
  const value = parsed.V1 ?? parsed.V2;
  const succeeded = value?.status?.$kind === 'Success';
  if (!value || !sameBytes(effectsBytes, roundtrip)
    || value.transactionDigest !== signedArtifact.digest
    || String(value.executedEpoch) !== String(evidence.epoch)
    || succeeded !== evidence.effectsStatus.success
    || sha256Hex(effectsBytes) !== hash32(evidence.effectsSha256, 'finality.effectsSha256')
    || typedDigest('TransactionEffects', effectsBytes)
      !== digest(evidence.effectsDigest, 'finality.effectsDigest')) {
    fail('MAINNET_V8_FINALIZED_EFFECTS_DRIFT', 'Durable finality fields disagree with TransactionEffects BCS.');
  }
  const eventsDigest = value.eventsDigest == null
    ? null : digest(value.eventsDigest, 'finality.effects.eventsDigest');
  if (eventsDigest !== evidence.eventsDigest) {
    fail('MAINNET_V8_FINALIZED_EVENTS_DRIFT', 'Durable events digest disagrees with TransactionEffects BCS.');
  }
  if (eventsDigest === null) {
    if (evidence.transactionEvents !== null) {
      fail('MAINNET_V8_FINALIZED_EVENTS_DRIFT', 'Durable events exist while effects declare no events.');
    }
  } else {
    exactKeys(evidence.transactionEvents, ['digest', 'bcsBase64', 'eventCount'], 'finality.transactionEvents');
    const eventBytes = fromBase64(evidence.transactionEvents.bcsBase64);
    let eventValue;
    let eventRoundtrip;
    try {
      eventValue = SUI_TRANSACTION_EVENTS_BCS.parse(eventBytes);
      eventRoundtrip = SUI_TRANSACTION_EVENTS_BCS.serialize(eventValue).toBytes();
    } catch (cause) {
      fail('MAINNET_V8_FINALIZED_EVENTS_DRIFT', 'Durable TransactionEvents are not canonical BCS.', {
        cause: String(cause?.message ?? cause),
      });
    }
    if (!sameBytes(eventBytes, eventRoundtrip)
      || evidence.transactionEvents.digest !== eventsDigest
      || typedDigest('TransactionEvents', eventBytes) !== eventsDigest
      || String(eventValue.data.length) !== decimal(
        String(evidence.transactionEvents.eventCount), 'finality.transactionEvents.eventCount',
      )) {
      fail('MAINNET_V8_FINALIZED_EVENTS_DRIFT', 'Durable TransactionEvents disagree with their effects digest.');
    }
  }
  return Object.freeze(canonicalizeSdk(evidence));
}

export async function broadcastExactMainnetV8Transaction({ client, signedArtifact }) {
  const verified = await verifyExactMainnetV8SignedArtifact(signedArtifact);
  const result = await client.executeTransaction({
    transaction: verified.transactionBytes,
    signatures: [signedArtifact.signature],
    include: { effects: true, events: true, objectTypes: true, bcs: true, transaction: true },
  });
  const value = result?.$kind === 'Transaction' ? result.Transaction : result?.FailedTransaction;
  if (!value || value.digest !== signedArtifact.digest) {
    fail('MAINNET_V8_BROADCAST_DIGEST_DRIFT', 'gRPC execute returned another transaction digest.');
  }
  return Object.freeze({
    digest: value.digest,
    status: value.status?.success === true ? 'ACCEPTED_SUCCESS' : 'ACCEPTED_FAILURE',
    effectsBcsBase64: value.effects?.bcs ? toBase64(value.effects.bcs) : null,
  });
}

function normalizeMoveDescriptor(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return toBase64(value);
  if (Array.isArray(value)) return value.map(normalizeMoveDescriptor);
  if (plain(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, entry]) => !['contents', 'documentation', 'sourceLocation'].includes(key) && entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, normalizeMoveDescriptor(entry)]));
  }
  return value;
}

export function normalizeMainnetV8MovePackageDescriptor(value) {
  const descriptor = normalizeMoveDescriptor(value);
  if (!plain(descriptor) || !Array.isArray(descriptor.modules)) {
    fail('MAINNET_V8_PACKAGE_DESCRIPTOR_DRIFT', 'Move package descriptor has no module array.');
  }
  return Object.freeze({
    ...descriptor,
    modules: Object.freeze(descriptor.modules.map((module, index) => {
      if (!plain(module)) {
        fail('MAINNET_V8_PACKAGE_DESCRIPTOR_DRIFT', `Move package module[${index}] is invalid.`);
      }
      return Object.freeze({
        ...module,
        datatypes: Object.freeze([...(module.datatypes ?? [])]),
        functions: Object.freeze([...(module.functions ?? [])]),
      });
    })),
  });
}

export { assertMainnetV8PublishedModuleBytes };

export async function readMainnetV8PackageCertificate({ client, transport, role, build, reference, transactionDigest }) {
  const historical = await transport.getHistoricalObject({
    objectId: reference.objectId,
    version: BigInt(reference.version),
  });
  if (historical.type !== 'package' || historical.previousTransaction !== transactionDigest
    || historical.digest !== reference.digest || historical.owner.Immutable !== true) {
    fail('MAINNET_V8_PACKAGE_HISTORY_DRIFT', `${role} package historical evidence drifted.`);
  }
  const historicalObject = bcs.Object.parse(historical.objectBcs);
  if (historicalObject.data?.$kind !== 'Package') {
    fail('MAINNET_V8_PACKAGE_HISTORY_DRIFT', `${role} historical Object BCS has no Package payload.`);
  }
  const packageData = historicalObject.data.Package;
  const packageModuleMap = Object.fromEntries([...packageData.moduleMap.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => [name, toBase64(value)]));
  const typeOrigins = packageData.typeOriginTable.map((entry, index) => {
    exactKeys(entry, ['moduleName', 'datatypeName', 'package'], `${role}.typeOrigins[${index}]`);
    return Object.freeze({
      moduleName: String(entry.moduleName),
      datatypeName: String(entry.datatypeName),
      package: address(entry.package, `${role}.typeOrigins[${index}].package`),
    });
  })
    .sort((left, right) => {
      const a = canonicalJson(left);
      const b = canonicalJson(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const linkage = [...packageData.linkageTable.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([originalId, value], index) => Object.freeze({
      originalId: address(originalId, `${role}.linkage[${index}].originalId`),
      upgradedId: address(value.upgradedId, `${role}.linkage[${index}].upgradedId`),
      upgradedVersion: decimal(
        String(value.upgradedVersion),
        `${role}.linkage[${index}].upgradedVersion`,
      ),
    }));
  if (address(packageData.id, `${role}.package.id`) !== reference.objectId
    || decimal(String(packageData.version), `${role}.package.version`) !== reference.version) {
    fail('MAINNET_V8_PACKAGE_HISTORY_DRIFT', `${role} Package BCS identity differs from effects.`);
  }
  const current = await transport.getObject({
    id: reference.objectId,
    options: { showBcs: true, showOwner: true },
  });
  if (current.data.version !== reference.version || current.data.digest !== reference.digest
    || current.data.previousTransaction !== transactionDigest) {
    fail('MAINNET_V8_PACKAGE_CURRENT_DRIFT', `${role} immutable package current ref drifted.`);
  }
  const onchainModules = current.data.bcs.moduleMap;
  const expectedModules = Object.fromEntries(build.modules.map((module) => [module.name, module.base64]));
  if (canonicalJson(onchainModules) !== canonicalJson(packageModuleMap)
    || canonicalJson(Object.keys(packageModuleMap).sort())
      !== canonicalJson(Object.keys(expectedModules).sort())) {
    fail('MAINNET_V8_PACKAGE_BYTES_DRIFT', `${role} current/historical module maps differ.`);
  }
  Object.keys(expectedModules).sort().forEach((moduleName) => {
    assertMainnetV8PublishedModuleBytes({
      role,
      moduleName,
      packageId: reference.objectId,
      sourceBase64: expectedModules[moduleName],
      publishedBase64: packageModuleMap[moduleName],
    });
  });
  const call = client.movePackageService.getPackage({ packageId: reference.objectId });
  const response = await call.response;
  const packageMessage = officialMessage(response.package, GrpcTypes.Package, `${role} movePackageService.package`);
  const descriptor = normalizeMainnetV8MovePackageDescriptor(GrpcTypes.Package.toJson(packageMessage, {
    enumAsInteger: false,
    useProtoFieldName: false,
  }));
  if (descriptor.storageId !== reference.objectId || descriptor.originalId !== reference.objectId
    || descriptor.version !== '1') {
    fail('MAINNET_V8_PACKAGE_DESCRIPTOR_DRIFT', `${role} package descriptor identity drifted.`, { descriptor });
  }
  const abiArtifact = await buildAbiArtifact({
    role,
    descriptor,
  });
  const descriptorModuleNames = Array.isArray(descriptor.modules)
    ? descriptor.modules.map((module) => module.name).sort()
    : Object.keys(descriptor.modules ?? {}).sort();
  const expectedModuleNames = build.modules.map((module) => module.name).sort();
  if (canonicalJson(descriptorModuleNames) !== canonicalJson(expectedModuleNames)
    || canonicalJson(Object.keys(onchainModules).sort()) !== canonicalJson(expectedModuleNames)) {
    fail('MAINNET_V8_PACKAGE_MODULE_SET_DRIFT', `${role} package descriptor/module-map names differ from clean build.`);
  }
  const expectedTypeOrigins = descriptor.modules.flatMap((module, moduleIndex) => {
    if (!Array.isArray(module.datatypes)) {
      fail('MAINNET_V8_PACKAGE_DESCRIPTOR_DRIFT', `${role} module[${moduleIndex}] datatypes are invalid.`);
    }
    return module.datatypes.map((datatype, datatypeIndex) => Object.freeze({
      moduleName: String(module.name),
      datatypeName: String(datatype.name),
      package: address(
        datatype.definingId,
        `${role}.modules[${moduleIndex}].datatypes[${datatypeIndex}].definingId`,
      ),
    }));
  }).sort((left, right) => {
    const a = canonicalJson(left);
    const b = canonicalJson(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (canonicalJson(typeOrigins) !== canonicalJson(expectedTypeOrigins)) {
    fail('MAINNET_V8_PACKAGE_TYPE_ORIGIN_DRIFT', `${role} Package BCS type origins differ from its gRPC ABI descriptor.`);
  }
  const expectedDependencies = [...build.packageArtifact.dependencies].sort();
  const observedDependencies = linkage.map((entry) => entry.upgradedId).sort();
  if (expectedDependencies.length > 4096 || new Set(expectedDependencies).size !== expectedDependencies.length
    || new Set(observedDependencies).size !== observedDependencies.length
    || canonicalJson(observedDependencies) !== canonicalJson(expectedDependencies)) {
    fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `${role} Package BCS linkage differs from the exact build dependency DAG.`, {
      expectedDependencies,
      linkage,
    });
  }
  const dependencyPackages = [];
  for (const targetId of expectedDependencies) {
    const edge = linkage.find(row => row.upgradedId === targetId);
    const object = await transport.getHistoricalObject({ objectId: targetId, version: BigInt(edge.upgradedVersion) });
    if (object.type !== 'package' || object.owner?.Immutable !== true || object.objectId !== targetId
      || object.version !== edge.upgradedVersion) {
      fail('MAINNET_V8_PACKAGE_LINKAGE_DRIFT', `${role} exact historical dependency package is unavailable.`);
    }
    dependencyPackages.push(Object.freeze({
      reference: Object.freeze({ objectId: targetId, version: edge.upgradedVersion, digest: object.digest }),
      objectBcsBase64: toBase64(object.objectBcs),
    }));
  }
  const certificate = Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    role,
    transactionDigest,
    reference,
    moduleMapSha256: sha256Hex(new TextEncoder().encode(canonicalJson(expectedModules))),
    objectBcsSha256: sha256Hex(historical.objectBcs),
    objectBcsBase64: toBase64(historical.objectBcs),
    dependencyPackages: Object.freeze(dependencyPackages),
    typeOrigins,
    linkage,
    descriptor,
    abiArtifact,
  });
  assertMainnetV8PackageReadbackBcs(certificate, expectedDependencies,
    build.modules.map(module => ({ name: module.name, bytesBase64: module.base64 })));
  return certificate;
}

function moveFields(value, label) {
  if (plain(value?.fields)) return value.fields;
  if (plain(value)) return value;
  fail('MAINNET_V8_MOVE_FIELDS_INVALID', `${label} has no exact Move field record.`);
}

function moveId(value, label) {
  if (plain(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'id')) {
    return moveId(value.id, label);
  }
  return address(value, label);
}

function moveU64(value, label) {
  return decimal(String(value), label);
}

function moveBool(value, label) {
  if (typeof value !== 'boolean') fail('MAINNET_V8_MOVE_BOOL_INVALID', `${label} must be boolean.`);
  return value;
}

function moveHash(value, label) {
  if ((value instanceof Uint8Array || Array.isArray(value)) && value.length === 32
    && [...value].every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return [...value].map((entry) => entry.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const decoded = fromBase64(value);
    if (decoded.length === 32 && toBase64(decoded) === value) return toHex(decoded);
  }
  const observed = String(value ?? '').replace(/^0x/, '').toLowerCase();
  return hash32(observed, label);
}


export function deriveMainnetV8ProtocolConfigCommitment({
  configId,
  coreOriginalPackageId,
  coreCallablePackageId,
  revision,
  treasuryId,
  enabled,
}) {
  const input = {
    configId: address(configId, 'protocol commitment.configId'),
    coreOriginalPackageId: address(
      coreOriginalPackageId,
      'protocol commitment.coreOriginalPackageId',
    ),
    coreCallablePackageId: address(
      coreCallablePackageId,
      'protocol commitment.coreCallablePackageId',
    ),
    revision: decimal(String(revision), 'protocol commitment.revision'),
    treasuryId: treasuryId == null
      ? null
      : address(treasuryId, 'protocol commitment.treasuryId'),
    paymentCoinType: MAINNET_V8_USDC_TYPE,
    primaryContentFeeBps: 1000,
    fixedCompleteFeeAtomic: '0',
    makerMarketFeeBps: 250,
    soulMarketFeeBps: 250,
    enabled: moveBool(enabled, 'protocol commitment.enabled'),
  };
  try {
    return deriveMakerV8ProtocolConfigCommitment(input);
  } catch (cause) {
    fail('MAINNET_V8_PROTOCOL_COMMITMENT_INVALID', 'ProtocolConfig commitment input is invalid.', {
      cause: String(cause?.message ?? cause),
    });
  }
}

function expectedProtocolConfigCommitment(fields, output, {
  revision,
  treasuryId,
  enabled,
}) {
  return deriveMainnetV8ProtocolConfigCommitment({
    configId: output.reference.objectId,
    coreOriginalPackageId: moveId(
      fields.core_original_package_id,
      'ProtocolConfigV8.core_original_package_id',
    ),
    coreCallablePackageId: moveId(
      fields.core_callable_package_id,
      'ProtocolConfigV8.core_callable_package_id',
    ),
    revision,
    treasuryId,
    enabled,
  });
}

function moveOptionId(value, label) {
  if (value === null) return null;
  if (typeof value === 'string') return moveId(value, label);
  fail('MAINNET_V8_MOVE_OPTION_INVALID', `${label} must be exact gRPC Move Option<ID> JSON.`);
}

function canonicalOwner(value, label) {
  if (value?.kind === 'AddressOwner') return Object.freeze({ AddressOwner: address(value.address, label) });
  if (value?.kind === 'ObjectOwner') return Object.freeze({ ObjectOwner: address(value.address, label) });
  if (value?.kind === 'Shared') {
    return Object.freeze({ Shared: Object.freeze({
      initial_shared_version: decimal(value.initialSharedVersion, `${label}.initialSharedVersion`),
    }) });
  }
  if (value?.kind === 'Immutable') return Object.freeze({ Immutable: true });
  if (plain(value) && Object.keys(value).length === 1) {
    if (typeof value.AddressOwner === 'string') return Object.freeze({ AddressOwner: address(value.AddressOwner, label) });
    if (typeof value.ObjectOwner === 'string') return Object.freeze({ ObjectOwner: address(value.ObjectOwner, label) });
    if (value.Immutable === true) return Object.freeze({ Immutable: true });
    if (plain(value.Shared)) return Object.freeze({ Shared: Object.freeze({
      initial_shared_version: decimal(
        String(value.Shared.initial_shared_version),
        `${label}.initial_shared_version`,
      ),
    }) });
  }
  fail('MAINNET_V8_OWNER_INVALID', `${label} is not one supported owner.`);
}

async function readExactMainnetV8MoveOutput({ transport, reference, transactionDigest }) {
  const [historical, current] = await Promise.all([
    transport.getHistoricalObject({
      objectId: reference.objectId,
      version: BigInt(reference.version),
    }),
    transport.getObject({
      id: reference.objectId,
      options: { showContent: true, showBcs: true, showOwner: true },
    }),
  ]);
  const data = current?.data;
  if (!data || data.objectId !== reference.objectId || data.version !== reference.version
    || data.digest !== reference.digest || data.previousTransaction !== transactionDigest
    || historical.objectId !== reference.objectId || historical.version !== reference.version
    || historical.digest !== reference.digest || historical.previousTransaction !== transactionDigest
    || historical.type !== data.type
    || canonicalJson(canonicalOwner(reference.owner, 'effects.owner'))
      !== canonicalJson(canonicalOwner(historical.owner, 'historical.owner'))
    || canonicalJson(canonicalOwner(data.owner, 'current.owner'))
      !== canonicalJson(canonicalOwner(historical.owner, 'historical.owner'))) {
    fail('MAINNET_V8_OUTPUT_HISTORY_DRIFT', 'Created/mutated object differs across effects, historical BCS, and current JSON.', {
      objectId: reference.objectId,
    });
  }
  if (data.content?.dataType !== 'moveObject' || data.bcs?.dataType !== 'moveObject') {
    fail('MAINNET_V8_OUTPUT_CONTENT_INVALID', 'Exact Move output lacks content/BCS evidence.', {
      objectId: reference.objectId,
    });
  }
  const currentContentBcs = fromBase64(data.bcs.bcsBytes);
  if (!sameBytes(currentContentBcs, historical.contentBcs)) {
    fail('MAINNET_V8_OUTPUT_HISTORY_DRIFT', 'Current decoded JSON is not paired with the exact historical Move contents.', {
      objectId: reference.objectId,
    });
  }
  return Object.freeze({
    reference: Object.freeze({
      objectId: reference.objectId,
      version: reference.version,
      digest: reference.digest,
    }),
    type: data.type,
    owner: canonicalOwner(data.owner, 'current.owner'),
    previousTransaction: transactionDigest,
    fields: canonicalizeSdk(data.content.fields),
    contentBcsBase64: toBase64(currentContentBcs),
    contentBcsSha256: sha256Hex(historical.contentBcs),
    objectBcsBase64: toBase64(historical.objectBcs),
    objectBcsSha256: sha256Hex(historical.objectBcs),
  });
}

function exactType(outputs, expectedType, label) {
  const matches = outputs.filter((output) => output.type === expectedType);
  if (matches.length !== 1) {
    fail('MAINNET_V8_OUTPUT_TYPE_CARDINALITY', `${label} must exist exactly once.`, {
      expectedType,
      observed: outputs.map((output) => output.type),
    });
  }
  return matches[0];
}

function parseExactMoveContents(output, schema, label) {
  const encoded = fromBase64(output.contentBcsBase64);
  let parsed;
  let roundtrip;
  try {
    parsed = schema.parse(encoded);
    roundtrip = schema.serialize(parsed).toBytes();
  } catch (cause) {
    fail('MAINNET_V8_OUTPUT_BCS_INVALID', `${label} has invalid historical Move contents BCS.`, {
      cause: String(cause?.message ?? cause),
    });
  }
  if (!sameBytes(encoded, roundtrip)) {
    fail('MAINNET_V8_OUTPUT_BCS_INVALID', `${label} historical Move contents are noncanonical.`);
  }
  return parsed;
}

function assertUpgradeCap(output, packageId, signer) {
  if (output.type !== `${normalizeSuiAddress('0x2')}::package::UpgradeCap`
    || canonicalJson(output.owner) !== canonicalJson({ AddressOwner: signer })) {
    fail('MAINNET_V8_UPGRADE_CAP_INVALID', 'UpgradeCap type/owner is invalid.');
  }
  const fields = moveFields(output.fields, 'UpgradeCap');
  exactKeys(fields, ['id', 'package', 'policy', 'version'], 'UpgradeCap.fields');
  if (moveId(fields.id, 'UpgradeCap.id') !== output.reference.objectId
    || moveId(fields.package, 'UpgradeCap.package') !== packageId
    || moveU64(fields.version, 'UpgradeCap.version') !== '1'
    || moveU64(fields.policy, 'UpgradeCap.policy') !== '0') {
    fail('MAINNET_V8_UPGRADE_CAP_INVALID', 'UpgradeCap fields differ from a fresh compatible package publish.');
  }
  const parsed = parseExactMoveContents(output, UPGRADE_CAP_BCS, 'UpgradeCap');
  if (parsed.id !== output.reference.objectId
    || parsed.package !== packageId
    || String(parsed.version) !== '1'
    || parsed.policy !== 0) {
    fail('MAINNET_V8_UPGRADE_CAP_INVALID', 'UpgradeCap historical BCS differs from its exact decoded fields.');
  }
  return output;
}

function assertInitialProtocolConfig(output, corePackageId) {
  const fields = moveFields(output.fields, 'ProtocolConfigV8');
  exactKeys(fields, [
    'id', 'version', 'core_original_package_id', 'core_callable_package_id',
    'revision', 'treasury_id', 'payment_coin_type', 'primary_content_fee_bps',
    'fixed_complete_fee_atomic', 'maker_market_fee_bps', 'soul_market_fee_bps',
    'enabled', 'commitment',
  ], 'ProtocolConfigV8.fields');
  if (moveId(fields.id, 'ProtocolConfigV8.id') !== output.reference.objectId
    || moveU64(fields.version, 'ProtocolConfigV8.version') !== '8'
    || moveId(fields.core_original_package_id, 'ProtocolConfigV8.core_original_package_id') !== corePackageId
    || moveId(fields.core_callable_package_id, 'ProtocolConfigV8.core_callable_package_id') !== corePackageId
    || moveU64(fields.revision, 'ProtocolConfigV8.revision') !== '0'
    || moveOptionId(fields.treasury_id, 'ProtocolConfigV8.treasury_id') !== null
    || fields.payment_coin_type !== MAINNET_V8_USDC_TYPE
    || moveU64(fields.primary_content_fee_bps, 'ProtocolConfigV8.primary_content_fee_bps') !== '1000'
    || moveU64(fields.fixed_complete_fee_atomic, 'ProtocolConfigV8.fixed_complete_fee_atomic') !== '0'
    || moveU64(fields.maker_market_fee_bps, 'ProtocolConfigV8.maker_market_fee_bps') !== '250'
    || moveU64(fields.soul_market_fee_bps, 'ProtocolConfigV8.soul_market_fee_bps') !== '250'
    || moveBool(fields.enabled, 'ProtocolConfigV8.enabled') !== false) {
    fail('MAINNET_V8_PROTOCOL_CONFIG_INVALID', 'Initial ProtocolConfigV8 fields differ from the reviewed fresh init.');
  }
  const expectedCommitment = expectedProtocolConfigCommitment(fields, output, {
    revision: '0',
    treasuryId: null,
    enabled: false,
  });
  if (moveHash(fields.commitment, 'ProtocolConfigV8.commitment') !== expectedCommitment) {
    fail('MAINNET_V8_PROTOCOL_COMMITMENT_DRIFT', 'Initial ProtocolConfigV8 commitment is invalid.');
  }
  const parsed = parseExactMoveContents(output, PROTOCOL_CONFIG_BCS, 'initial ProtocolConfigV8');
  if (parsed.id !== output.reference.objectId
    || parsed.version !== '8'
    || parsed.core_original_package_id !== corePackageId
    || parsed.core_callable_package_id !== corePackageId
    || parsed.revision !== '0'
    || parsed.treasury_id !== null
    || parsed.payment_coin_type !== MAINNET_V8_USDC_TYPE
    || parsed.primary_content_fee_bps !== 1000
    || parsed.fixed_complete_fee_atomic !== '0'
    || parsed.maker_market_fee_bps !== 250
    || parsed.soul_market_fee_bps !== 250
    || parsed.enabled !== false
    || moveHash(parsed.commitment, 'ProtocolConfigV8.bcs.commitment') !== expectedCommitment) {
    fail('MAINNET_V8_PROTOCOL_CONFIG_INVALID', 'Initial ProtocolConfigV8 historical BCS differs from its exact decoded fields.');
  }
  return output;
}

function assertProtocolAdminCap(output, configId, signer) {
  if (canonicalJson(output.owner) !== canonicalJson({ AddressOwner: signer })) {
    fail('MAINNET_V8_PROTOCOL_ADMIN_INVALID', 'ProtocolAdminCap is not owned by release signer.');
  }
  const fields = moveFields(output.fields, 'ProtocolAdminCapV8');
  exactKeys(fields, ['id', 'version', 'config_id'], 'ProtocolAdminCapV8.fields');
  if (moveId(fields.id, 'ProtocolAdminCapV8.id') !== output.reference.objectId
    || moveU64(fields.version, 'ProtocolAdminCapV8.version') !== '8'
    || moveId(fields.config_id, 'ProtocolAdminCapV8.config_id') !== configId) {
    fail('MAINNET_V8_PROTOCOL_ADMIN_INVALID', 'ProtocolAdminCap does not bind initial ProtocolConfigV8.');
  }
  const parsed = parseExactMoveContents(output, PROTOCOL_ADMIN_CAP_BCS, 'ProtocolAdminCapV8');
  if (parsed.id !== output.reference.objectId || parsed.version !== '8' || parsed.config_id !== configId) {
    fail('MAINNET_V8_PROTOCOL_ADMIN_INVALID', 'ProtocolAdminCap historical BCS differs from its decoded fields.');
  }
  return output;
}

export async function certifyMainnetV8PackagePublish({
  client,
  transport,
  role,
  build,
  finalityEvidence,
  signer,
}) {
  if (!MAINNET_V8_PUBLISH_ORDER.includes(role)) {
    fail('MAINNET_V8_PACKAGE_OUTPUT_CARDINALITY', 'Unknown native publication role.');
  }
  const transactionDigest = digest(finalityEvidence.digest, 'finality.digest');
  const writes = writtenReferencesFromEffects(
    fromBase64(finalityEvidence.effectsBcsBase64),
    transactionDigest,
  );
  const created = writes.filter((entry) => entry.operation === 'CREATED');
  const expectedCreatedCount = role === 'soulidity' ? 33 : role === 'core' ? 4 : 2;
  if (writes.length !== expectedCreatedCount || created.length !== expectedCreatedCount) {
    fail('MAINNET_V8_PACKAGE_WRITE_SET_INVALID', `${role} publish effects contain unexpected persistent writes.`, {
      expectedCreatedCount,
      writes,
    });
  }
  const packageRefs = created.filter((entry) => entry.owner.kind === 'Immutable');
  if (packageRefs.length !== 1) {
    fail('MAINNET_V8_PACKAGE_OUTPUT_CARDINALITY', `${role} publish did not create exactly one immutable package.`);
  }
  const packageReference = packageRefs[0];
  const packageCertificate = await readMainnetV8PackageCertificate({
    client,
    transport,
    role,
    build,
    reference: packageReference,
    transactionDigest,
  });
  const moveOutputs = await Promise.all(created
    .filter((entry) => entry !== packageReference)
    .map((reference) => readExactMainnetV8MoveOutput({ transport, reference, transactionDigest })));
  const upgradeCap = assertUpgradeCap(
    exactType(moveOutputs, `${normalizeSuiAddress('0x2')}::package::UpgradeCap`, 'UpgradeCap'),
    packageReference.objectId,
    signer,
  );
  let protocolConfig = null;
  let protocolAdminCap = null;
  let soulidityInitialization = null;
  if (role === 'core') {
    protocolConfig = assertInitialProtocolConfig(exactType(
      moveOutputs,
      `${packageReference.objectId}::protocol_config_v8::ProtocolConfigV8`,
      'ProtocolConfigV8',
    ), packageReference.objectId);
    protocolAdminCap = assertProtocolAdminCap(exactType(
      moveOutputs,
      `${packageReference.objectId}::protocol_config_v8::ProtocolAdminCapV8`,
      'ProtocolAdminCapV8',
    ), protocolConfig.reference.objectId, signer);
    if (moveOutputs.length !== 3) {
      fail('MAINNET_V8_CORE_OUTPUT_CARDINALITY', 'Core publish created unexpected additional Move objects.');
    }
  } else if (role === 'soulidity') {
    soulidityInitialization = certifyMainnetV8SoulidityInitialization({ packageCertificate,
      writes, moveOutputs, signer, transactionDigest });
  } else if (moveOutputs.length !== 1) {
    fail('MAINNET_V8_PACKAGE_OUTPUT_CARDINALITY', `${role} publish created unexpected additional Move objects.`);
  }
  return Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'PACKAGE_PUBLISH_CERTIFICATE',
    role,
    transactionDigest,
    package: packageCertificate,
    upgradeCap,
    protocolConfig,
    protocolAdminCap,
    soulidityInitialization,
  });
}




function randomUint32() {
  return randomBytes(4).readUInt32LE(0);
}

function releaseTransactionContext(
  profile,
  sender,
  gasBudget = MAINNET_V8_PRELIMINARY_GAS_BUDGET,
  nonce = randomUint32(),
) {
  return Object.freeze({
    sender,
    gasPrice: profile.gasPrice,
    gasBudget: gasBudget.toString(),
    epoch: profile.epoch,
    chainIdentifier: profile.chainIdentifier,
    nonce,
  });
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/mainnet-v8-release.mjs <command> [options]\n\n`);
  process.stdout.write(`Commands: prepare, run, resume, abandon, status, verify, export-config\n`);
  process.stdout.write(`Required for prepare: --state-dir PATH --soulidity-root PATH --sui-binary PATH --sender 0x...\n`);
  process.stdout.write(`Required for run/resume: --state-dir PATH --sui-binary PATH --execution-plan-id SHA256\n`);
  process.stdout.write(`After manifest seal, run/resume also requires --release-id SHA256\n`);
  process.stdout.write(`Export requires completed verification: --state-dir PATH --format json|soulidity-env (default json); no writes.\n`);
  process.stdout.write(`Abandon requires both IDs plus --reason-code PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH; it never signs or broadcasts.\n`);
  process.stdout.write(`Known parser incidents may be reopened with --repair-readback-incident; this never signs or broadcasts by itself.\n`);
  process.stdout.write(`Writes require all three gates: --confirm-mainnet --allow-signing --allow-broadcast\n`);
}

async function loadSealPolicy(options) {
  if (options['seal-policy']) {
    return assertMainnetV8SealPolicyTemplate(
      JSON.parse(await fsp.readFile(path.resolve(options['seal-policy']), 'utf8')),
    );
  }
  return await buildSealPolicy({
    keyServers: MAINNET_V8_BROWSER_KEY_SERVERS.map(({ objectId }) => ({ objectId, weight: '1' })),
    threshold: MAINNET_V8_BROWSER_SEAL_THRESHOLD,
  });
}

async function writeJsonAtomic(filename, value) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await fsp.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(temporary, filename);
  const directory = await fsp.open(path.dirname(filename), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function prepareMainnetV8Release({
  repositoryRoot = REPOSITORY_ROOT,
  soulidityRoot,
  stateDir,
  suiBinary,
  sender,
  sealPolicy: sealPolicyInput,
  client = new SuiGrpcClient({ network: 'mainnet', baseUrl: MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT }),
  transport = createProductionMakerV8SuiGrpcTransport(),
}) {
  const checkedSender = address(sender, 'sender');
  if (checkedSender !== MAINNET_V8_RELEASE_SIGNER) {
    fail('MAINNET_V8_SIGNER_NOT_APPROVED', 'Release sender differs from the reviewed Mainnet custody address.', {
      expected: MAINNET_V8_RELEASE_SIGNER,
      observed: checkedSender,
    });
  }
  const resolvedState = path.resolve(stateDir);
  let targetExists = true;
  const existing = await fsp.readdir(resolvedState).catch((error) => {
    if (error.code === 'ENOENT') {
      targetExists = false;
      return [];
    }
    throw error;
  });
  if (existing.length > 0) fail('MAINNET_V8_STATE_NOT_EMPTY', 'New release state directory must be empty.');
  const stagingState = `${resolvedState}.preparing.${process.pid}.${randomBytes(8).toString('hex')}`;
  await fsp.mkdir(stagingState, { recursive: true, mode: 0o700 });
  try {
  // Source identity records the required toolchain, not proof of its execution.
  // The actual binary is checked below before any build/RPC/READY is allowed.
  const toolchain = MAINNET_V8_RELEASE_TOOLCHAIN;
  const sealPolicy = assertMainnetV8SealPolicyTemplate(sealPolicyInput);
  await inspectMainnetV8Toolchain({ suiBinary });
  // Fail before any build/READY/publication if the real browser cannot use the
  // exact configured topology without credentials. No application decrypt claim.
  await certifyMainnetV8SealKeyServers({ transport, sealPolicy });
  const checkoutRoot = path.join(stagingState, 'source');
  const sourcePlan = await prepareMainnetV8Source({ repositoryRoot, soulidityRoot,
    storePath: path.join(stagingState, 'source-cas'), checkoutRoot, toolchain });
  const profile = await assertMainnetV8ProtocolProfile(client);
  // Resolve and execute the live external version before publishing anything.
  // Static dependency metadata alone does not prove compatibility with System.
  await preflightMainnetV8WalrusExecution({ client, transport, profile, sender: checkedSender });
  const publishedTomlPath = path.join(stagingState, MAINNET_V8_PUBLISHED_FILENAME);
  await fsp.writeFile(publishedTomlPath, renderPublishedToml({
    buildEnv: 'mainnet', chainId: '35834a8a', entries: [],
    externalEntries: readNativeSoulExternalPublications({ sourceRevision: sourcePlan.sourceRevision, checkoutRoot }),
  }), { encoding: 'utf8', mode: 0o600 });
  const sourceArtifacts = Object.fromEntries(sourcePlan.packages.map(entry => [entry.role, entry.sourceArtifact]));
  const coreBuild = await withApprovedSuiBinarySnapshot(
    suiBinary,
    async (snapshotPath) => buildMainnetV8Package({
      role: 'core',
      checkoutRoot,
      publishedTomlPath,
      suiBinary: snapshotPath,
      sourceRevision: sourcePlan.sourceRevision,
      toolchain: Object.freeze({ ...toolchain, path: snapshotPath }),
      sourceArtifact: sourceArtifacts.core,
    }),
  );
  const plan = await createReleasePlan({
    sender: checkedSender,
    sourceRevision: sourcePlan.sourceRevision,
    toolchain: {
      suiVersion: toolchain.suiVersion,
      suiVersionOutput: toolchain.suiVersionOutput,
      suiSourceCommit: toolchain.suiSourceCommit,
      suiBinarySha256: toolchain.suiBinarySha256,
      frameworkRevision: toolchain.frameworkRevision,
    },
    sealPolicy,
    packages: NATIVE_SOUL_SOURCE_ORDER.map((role) => ({
      role,
      packageName: NATIVE_SOUL_SOURCE_NAMES[role],
      sourceArtifact: sourceArtifacts[role],
    })),
  });
  assertReleasePlan(plan);
  const initialPublished = await bindInitialPublishedPrefix({ executionPlanId: computeExecutionPlanId(plan),
    checkoutRoot, publishedTomlPath,
    externalEntries: readNativeSoulExternalPublications({ sourceRevision: sourcePlan.sourceRevision, checkoutRoot }) });
  const preparedCore = await prepareUnsignedMainnetV8Transaction({
    client,
    profile,
    sender: checkedSender,
    buildTransaction: (transactionContext) => buildMainnetV8PublishTransaction({
      modules: coreBuild.publishModules,
      dependencies: coreBuild.dependencies,
      transactionContext,
    }),
  });
  await writeJsonAtomic(path.join(stagingState, MAINNET_V8_PLAN_FILENAME), plan);
  const coreReadyArtifact = Object.freeze({
    kind: 'PUBLISH',
    role: 'core',
    packageArtifact: coreBuild.packageArtifact,
    packageCommitment: computePackageCommitment(coreBuild.packageArtifact),
    modules: coreBuild.publishModules,
    dependencies: coreBuild.dependencies,
    publishedTomlSha256: initialPublished.sha256,
    simulation: preparedCore.simulation,
    gasFunding: preparedCore.gasFunding,
    protocolProfile: profile,
    predecessorReadback: null,
  });
  const coreReadyEvidence = buildMainnetV8ReadyEvidence({
    ordinal: '0',
    attempt: '0',
    readyArtifact: coreReadyArtifact,
    unsignedEnvelope: preparedCore.unsignedEnvelope,
  });
  await assertMainnetV8TransactionMatchesReady({
    ordinal: '0', plan, readyArtifact: coreReadyArtifact,
    unsignedEnvelope: preparedCore.unsignedEnvelope,
  });
  await createReleaseWal({
    path: path.join(stagingState, MAINNET_V8_WAL_FILENAME),
    plan,
    event: { status: 'READY', attempt: '0', evidence: coreReadyEvidence },
  });
  if (targetExists) await fsp.rmdir(resolvedState);
  await fsp.rename(stagingState, resolvedState);
  const parent = await fsp.open(path.dirname(resolvedState), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
  return Object.freeze({
    stateDir: resolvedState,
    executionPlanId: computeExecutionPlanId(plan),
    plan,
    checkoutRoot: path.join(resolvedState, 'source'),
    publishedTomlPath: path.join(resolvedState, MAINNET_V8_PUBLISHED_FILENAME),
    initialBuild: coreBuild,
    initialTransaction: preparedCore,
  });
  } catch (error) {
    await fsp.rm(stagingState, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function mainnetV8ReleasePaths(stateDir) {
  const root = path.resolve(stateDir);
  return Object.freeze({
    root,
    plan: path.join(root, MAINNET_V8_PLAN_FILENAME),
    wal: path.join(root, MAINNET_V8_WAL_FILENAME),
    published: path.join(root, MAINNET_V8_PUBLISHED_FILENAME),
    checkout: path.join(root, 'source'),
    sourceStore: path.join(root, 'source-cas'),
    exportedConfig: path.join(root, 'animacraft-mainnet-v8-config.json'),
    releaseCertificate: path.join(root, 'chain-release-certificate.json'),
  });
}

function mainnetV8JsonSha(value) {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

function headEvent(wal) {
  const event = wal.events.at(-1);
  if (!event || event.eventSha256 !== wal.headEventSha256) {
    fail('MAINNET_V8_WAL_INVALID', 'Release WAL has no exact durable head.');
  }
  return event;
}

function cursorEvents(wal, ordinal, attempt) {
  return wal.events.filter((event) => event.ordinal === String(ordinal)
    && event.attempt === String(attempt));
}

function cursorEvidence(wal, ordinal, attempt, status) {
  const matches = cursorEvents(wal, ordinal, attempt).filter((event) => event.status === status);
  if (matches.length !== 1) {
    fail('MAINNET_V8_WAL_INVALID', `Cursor ${ordinal}:${attempt} requires exactly one ${status} event.`, {
      observed: matches.length,
    });
  }
  return matches[0].evidence;
}

function finalizedDetails(wal, ordinal) {
  const matches = wal.events.filter((event) => event.ordinal === String(ordinal)
    && event.status === 'FINALIZED_SUCCESS');
  if (matches.length !== 1) {
    fail('MAINNET_V8_WAL_INVALID', `Ordinal ${ordinal} requires exactly one finalized-success certificate.`);
  }
  return matches[0].evidence.observation.details;
}

async function appendAndColdRead(paths, wal, event) {
  const appended = await appendReleaseWal({
    path: paths.wal,
    expectedRevision: wal.revision,
    expectedHeadHash: wal.headEventSha256,
    event,
  });
  const cold = await readReleaseWal({ path: paths.wal });
  if (cold.revision !== appended.revision
    || cold.headEventSha256 !== appended.headEventSha256
    || canonicalMainnetV8WalJson(cold) !== canonicalMainnetV8WalJson(appended)) {
    fail('MAINNET_V8_WAL_COLD_READ_DRIFT', 'Durable WAL cold read differs after append.');
  }
  return cold;
}

// The same durable append/cold-read boundary is independently testable without
// authorizing a network read, signature or transaction submission.
export { appendAndColdRead as appendMainnetV8WalAndColdRead };

function packageIdsFromFinalManifest(wal) {
  if (!wal.finalManifest || wal.releaseId !== wal.finalManifest.releaseId) {
    fail('MAINNET_V8_FINAL_MANIFEST_REQUIRED', 'Final package manifest must be sealed first.');
  }
  return Object.freeze(Object.fromEntries(wal.finalManifest.packages.map((entry) => [
    entry.role, entry.packageId,
  ])));
}

function publishedEntryFromDetails(checkoutRoot, details) {
  const readback = details.certificate.readback;
  return Object.freeze({
    packageName: MAINNET_V8_PUBLISH_PACKAGE_NAMES[readback.role],
    source: path.join(path.resolve(checkoutRoot), 'move', MAINNET_V8_PUBLISH_PACKAGE_NAMES[readback.role]),
    publishedAt: readback.package.reference.objectId,
    originalId: readback.package.reference.objectId,
    version: '1',
    toolchainVersion: MAINNET_V8_RELEASE_TOOLCHAIN.suiVersion,
    buildConfig: Object.freeze({ flavor: 'sui', edition: '2024' }),
    upgradeCapability: readback.upgradeCap.reference.objectId,
  });
}

export function publishedPrefixSnapshot(wal, checkoutRoot, completedCount = MAINNET_V8_PUBLISH_ORDER.length,
  externalEntries) {
  if (!Number.isSafeInteger(completedCount)
    || completedCount < 0 || completedCount > MAINNET_V8_PUBLISH_ORDER.length) {
    fail('MAINNET_V8_PUBLISHED_PREFIX_INVALID', 'Published prefix length is out of bounds.');
  }
  const entries = [];
  for (let ordinal = 0; ordinal < completedCount; ordinal += 1) {
    const success = wal.events.find((event) => event.ordinal === String(ordinal)
      && event.status === 'FINALIZED_SUCCESS');
    if (!success) {
      if (wal.events.some(event => event.status === 'FINALIZED_SUCCESS'
        && Number(event.ordinal) > ordinal && Number(event.ordinal) < completedCount)) {
        fail('MAINNET_V8_PUBLISHED_PREFIX_INVALID', 'Published prefix has a missing predecessor.');
      }
      break;
    }
    if (success.evidence?.observation?.details?.certificate?.readback?.role !== MAINNET_V8_PUBLISH_ORDER[ordinal]) {
      fail('MAINNET_V8_PUBLISHED_PREFIX_INVALID', 'Published readback role differs from the publication ordinal.');
    }
    entries.push(publishedEntryFromDetails(checkoutRoot, success.evidence.observation.details));
  }
  const text = renderPublishedToml({
    buildEnv: 'mainnet',
    chainId: '35834a8a',
    entries,
    externalEntries,
  });
  const parsed = parsePublishedToml(text);
  if (renderPublishedToml(parsed) !== text) {
    fail('MAINNET_V8_PUBLISHED_TOML_INVALID', 'Generated Published.toml is not canonical.');
  }
  // Ephemeral Sui pubfiles require absolute local source paths. Those paths
  // necessarily differ for each clean-room checkout, so the durable READY
  // commitment is computed over the exact same canonical file with only the
  // checkout root replaced by a plan-bound virtual root. All package IDs,
  // versions, caps, toolchain metadata, ordering, and role paths remain bound.
  const commitmentRoot = path.join(
    path.parse(path.resolve(checkoutRoot)).root,
    'animacraft-mainnet-v8',
    wal.executionPlanId,
    'source',
  );
  const commitmentText = renderPublishedToml({
    buildEnv: parsed.buildEnv,
    chainId: parsed.chainId,
    entries: parsed.entries.map((entry) => ({
      ...entry,
      source: path.join(commitmentRoot, 'move', entry.packageName),
    })),
    externalEntries: nativeSoulExternalCommitmentEntries(parsed.externalEntries, commitmentRoot),
  });
  return Object.freeze({
    entries: parsed.entries,
    externalEntries: parsed.externalEntries,
    text,
    rawSha256: sha256Hex(new TextEncoder().encode(text)),
    sha256: sha256Hex(new TextEncoder().encode(commitmentText)),
  });
}

async function writePublishedPrefix(filename, snapshot) {
  const temporary = `${filename}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await fsp.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(snapshot.text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(temporary, filename);
  const directory = await fsp.open(path.dirname(filename), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  const coldBytes = await fsp.readFile(filename);
  const coldText = coldBytes.toString('utf8');
  const coldParsed = parsePublishedToml(coldText);
  if (coldText !== snapshot.text
    || renderPublishedToml(coldParsed) !== snapshot.text
    || sha256Hex(coldBytes) !== snapshot.rawSha256) {
    fail('MAINNET_V8_PUBLISHED_TOML_COLD_READ_DRIFT', 'Durable Published.toml differs after atomic materialization.');
  }
  return snapshot;
}

/** Bind the already-built initial Core pubfile to the same portable commitment
 * used by resumed/clean-room builds, once its execution plan ID is known. */
export async function bindInitialPublishedPrefix({ executionPlanId, checkoutRoot, publishedTomlPath, externalEntries }) {
  if (typeof executionPlanId !== 'string' || !/^[0-9a-f]{64}$/.test(executionPlanId)) {
    fail('MAINNET_V8_PUBLISHED_PREFIX_INVALID', 'Initial publication requires the exact execution plan ID.');
  }
  const snapshot = publishedPrefixSnapshot({ executionPlanId, events: [] }, checkoutRoot, 0, externalEntries);
  if (await fsp.readFile(publishedTomlPath, 'utf8') !== snapshot.text) {
    fail('MAINNET_V8_PUBLISHED_TOML_COLD_READ_DRIFT', 'Initial built publication metadata changed before plan binding.');
  }
  return writePublishedPrefix(publishedTomlPath, snapshot);
}

async function materializePublishedPrefix(paths, wal) {
  return writePublishedPrefix(
    paths.published,
    publishedPrefixSnapshot(wal, paths.checkout, MAINNET_V8_PUBLISH_ORDER.length,
      readNativeSoulExternalPublications({ sourceRevision: wal.plan.sourceRevision, checkoutRoot: paths.checkout })),
  );
}

function predecessorForReady(wal, ordinal) {
  if (ordinal === 0) return null;
  const certificate = finalizedDetails(wal, ordinal - 1);
  return Object.freeze({
    ordinal: String(ordinal - 1),
    certificate,
    certificateSha256: mainnetV8JsonSha(certificate),
  });
}

export function nativeSoulBootstrapPriorReadbacksFromWal({ wal, stage }) {
  const target = MAINNET_V8_RELEASE_STEPS.find(step => step.kind === stage);
  if (!target || !NATIVE_SOUL_BOOTSTRAP_STAGES.includes(target.kind)) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Unknown native bootstrap stage.');
  }
  const prior = { core: finalizedDetails(wal, 0).certificate.readback };
  for (const step of MAINNET_V8_RELEASE_STEPS) {
    if (step.kind === 'PUBLISH') continue;
    if (Number(step.ordinal) >= Number(target.ordinal)) break;
    prior[step.kind] = finalizedDetails(wal, step.ordinal).certificate.readback;
  }
  return prior;
}

export function nativeSoulBootstrapContextFromWal({ wal, stage, keyServerCertificates, walrusSystem, walrusExecution }) {
  if (!wal.finalManifest || wal.finalManifest.releaseId !== wal.releaseId) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Native stage requires the exact sealed final manifest.');
  }
  const extras = {};
  if (keyServerCertificates !== undefined) extras.keyServerCertificates = keyServerCertificates;
  if (walrusSystem !== undefined) extras.walrusSystem = walrusSystem;
  if (walrusExecution !== undefined) extras.walrusExecution = walrusExecution;
  return deriveNativeSoulBootstrapStageData({
    stage, manifest: wal.finalManifest, plan: wal.plan,
    priorReadbacks: nativeSoulBootstrapPriorReadbacksFromWal({ wal, stage }), ...extras,
  });
}

export function nativeSoulMarketActivationContextFromWal(wal) {
  const predecessorSteps = MAINNET_V8_RELEASE_STEPS.filter(row =>
    row.kind === 'PUBLISH' && row.role === 'soulidity' || row.kind === 'FINALIZE_BOOTSTRAP');
  return deriveMainnetV8MarketActivationWalContext({ plan: wal.plan, manifest: wal.finalManifest,
    successfulCertificates: new Map(predecessorSteps.map(row => [row.ordinal, {
      details: finalizedDetails(wal, row.ordinal),
    }])) });
}

// Data/context projection of certified WAL records. Execution still requires
// the guarded plan validator below and the cold WAL's full finality checks.
export function assertMainnetV8ReadyWalContextContents({ wal, ordinal, readyArtifact }) {
  const ordinalText = decimal(String(ordinal), 'READY context ordinal');
  const step = MAINNET_V8_RELEASE_STEPS.find(entry => entry.ordinal === ordinalText);
  if (!step || !plain(readyArtifact) || readyArtifact.kind !== step.kind) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'READY context has no matching release step.');
  }
  const expectedPredecessor = predecessorForReady(wal, Number(ordinalText));
  if (canonicalJson(readyArtifact.predecessorReadback) !== canonicalJson(expectedPredecessor)) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'READY predecessor differs from the durable finalized head.');
  }
  if (step.kind === 'PUBLISH') {
    const role = step.role;
    const planned = wal.plan.packages[Number(ordinalText)];
    if (readyArtifact.role !== role || readyArtifact.packageArtifact?.role !== role
      || planned?.role !== role || planned.packageName !== MAINNET_V8_PUBLISH_PACKAGE_NAMES[role]
      || canonicalJson(readyArtifact.dependencies) !== canonicalJson(readyArtifact.packageArtifact?.dependencies)
      || computePackageCommitment(readyArtifact.packageArtifact) !== readyArtifact.packageCommitment) {
      fail('MAINNET_V8_READY_CONTEXT_DRIFT', `${role} READY is not bound to its immutable plan/build artifact.`);
    }
    return readyArtifact;
  }
  if (!wal.finalManifest || wal.finalManifest.releaseId !== wal.releaseId) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Stage READY requires the exact sealed final manifest.');
  }
  let expectedStageData;
  if (step.kind === 'VERIFY_AND_EXPORT') {
    const finalStage = MAINNET_V8_RELEASE_STEPS.find(entry => entry.kind === 'FINALIZE_BOOTSTRAP');
    const bootstrap = finalizedDetails(wal, finalStage.ordinal).certificate;
    expectedStageData = {
      releaseId: wal.releaseId, finalManifestSha256: mainnetV8JsonSha(wal.finalManifest),
      bootstrapCertificateSha256: bootstrap.readbackSha256,
      marketActivationCertificateSha256: finalizedDetails(wal,
        MAINNET_V8_RELEASE_STEPS.find(row => row.kind === 'ACTIVATE_SOULIDITY_MARKET').ordinal).certificate.readbackSha256,
      exportFilename: 'animacraft-mainnet-v8-config.json',
    };
  } else if (step.kind === 'ACTIVATE_SOULIDITY_MARKET') {
    expectedStageData = nativeSoulMarketActivationContextFromWal(wal).stageData;
  } else {
    const extras = step.kind === 'SETUP_RELEASE' ? {
      keyServerCertificates: readyArtifact.stageData?.keyServerCertificates,
      walrusSystem: readyArtifact.stageData?.walrusSystem,
      walrusExecution: readyArtifact.stageData?.walrusExecution,
    } : {};
    expectedStageData = nativeSoulBootstrapContextFromWal({ wal, stage: step.kind, ...extras }).stageData;
  }
  if (canonicalJson(readyArtifact.stageData) !== canonicalJson(expectedStageData)
    || readyArtifact.stageDataSha256 !== mainnetV8JsonSha(expectedStageData)) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', `Ordinal ${ordinalText} READY differs from sealed manifest/predecessor evidence.`);
  }
  return readyArtifact;
}

export function assertMainnetV8ReadyWalContext(input) {
  assertReleasePlan(input.wal?.plan);
  return assertMainnetV8ReadyWalContextContents(input);
}

async function appendReadyEvent({ paths, wal, ordinal, readyArtifact, unsignedEnvelope }) {
  assertMainnetV8ReadyWalContext({ wal, ordinal, readyArtifact });
  const evidence = buildMainnetV8ReadyEvidence({
    ordinal: String(ordinal), attempt: '0', readyArtifact, unsignedEnvelope,
  });
  if (MAINNET_V8_RELEASE_STEPS.find(step => step.ordinal === String(ordinal))?.kind !== 'VERIFY_AND_EXPORT') {
    await assertMainnetV8TransactionMatchesReady({
      ordinal: String(ordinal), plan: wal.plan, readyArtifact, unsignedEnvelope,
    });
  }
  return appendAndColdRead(paths, wal, {
    ordinal: String(ordinal), attempt: '0', status: 'READY', evidence,
  });
}

function buildIdentityFromPlan(plan, suiBinary) {
  return Object.freeze({
    sourceRevision: plan.sourceRevision,
    toolchain: Object.freeze({ ...plan.toolchain, path: path.resolve(suiBinary) }),
  });
}

async function assertFreshCheckoutSources({ checkoutRoot, plan, identity }) {
  assertMainnetV8SourcePlan(plan);
  const observed = await Promise.all(NATIVE_SOUL_SOURCE_ORDER.map(async (role, index) => {
    const artifact = await buildSourceArtifactForRole({
      role,
      checkoutRoot,
      sourceRevision: identity.sourceRevision,
      toolchain: identity.toolchain,
    });
    const expected = plan.packages[index];
    if (canonicalJson(artifact) !== canonicalJson(expected.sourceArtifact)
      || computeSourceCommitment(artifact) !== expected.sourceCommitment) {
      fail('MAINNET_V8_SOURCE_ARTIFACT_DRIFT', `${role} clean checkout differs from the immutable execution plan.`);
    }
    return artifact;
  }));
  return Object.freeze(observed);
}

async function withFreshSourceArchive({ sourceStorePath, plan }, operation) {
  assertMainnetV8SourcePlan(plan);
  if (typeof sourceStorePath !== 'string' || !path.isAbsolute(sourceStorePath)) {
    fail('NATIVE_SOUL_SOURCE_INVALID', 'Exact source CAS path is required; there is no Git fallback.');
  }
  if (typeof operation !== 'function') {
    fail('MAINNET_V8_BUILD_OPERATION_INVALID', 'Fresh source archive requires one operation.');
  }
  const identity = Object.freeze({
    sourceRevision: plan.sourceRevision,
    toolchain: plan.toolchain,
  });
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'animacraft-mainnet-v8-build-'));
  await fsp.chmod(temporaryRoot, 0o700);
  try {
    const checkoutRoot = path.join(temporaryRoot, 'source');
    await restoreNativeSoulSource({ sourceRevision: plan.sourceRevision, storePath: sourceStorePath, checkoutRoot });
    const sourceArtifacts = await assertFreshCheckoutSources({
      checkoutRoot,
      plan,
      identity,
    });
    return await operation(Object.freeze({
      temporaryRoot,
      checkoutRoot,
      sourceArtifacts,
      identity,
    }));
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function inspectMainnetV8FreshSourceArchive({ sourceStorePath, plan }) {
  return withFreshSourceArchive(
    { sourceStorePath, plan },
    async ({ sourceArtifacts, identity }) => Object.freeze({
      sourceRevision: identity.sourceRevision,
      sourceCommitments: Object.freeze(Object.fromEntries(
        sourceArtifacts.map((artifact) => [artifact.role, computeSourceCommitment(artifact)]),
      )),
    }),
  );
}

async function withFreshReleaseCheckout({ sourceStorePath, wal, suiBinary }, operation) {
  if (typeof operation !== 'function') {
    fail('MAINNET_V8_BUILD_OPERATION_INVALID', 'Fresh release checkout requires one build operation.');
  }
  const identity = buildIdentityFromPlan(wal.plan, suiBinary);
  const observedToolchain = await inspectMainnetV8Toolchain({ suiBinary: identity.toolchain.path });
  if (observedToolchain.suiVersion !== wal.plan.toolchain.suiVersion
    || observedToolchain.suiVersionOutput !== wal.plan.toolchain.suiVersionOutput
    || observedToolchain.suiSourceCommit !== wal.plan.toolchain.suiSourceCommit
    || observedToolchain.suiBinarySha256 !== wal.plan.toolchain.suiBinarySha256
    || observedToolchain.frameworkRevision !== wal.plan.toolchain.frameworkRevision) {
    fail('MAINNET_V8_TOOLCHAIN_DRIFT', 'Clean-room build toolchain differs from the immutable release plan.');
  }
  return withFreshSourceArchive({ sourceStorePath, plan: wal.plan }, async ({
    temporaryRoot,
    checkoutRoot,
  }) => {
    const snapshotPath = await copyApprovedSuiBinary({
      source: identity.toolchain.path,
      destination: path.join(temporaryRoot, 'sui'),
    });
    const snapshotIdentity = Object.freeze({
      sourceRevision: identity.sourceRevision,
      toolchain: Object.freeze({ ...identity.toolchain, path: snapshotPath }),
    });
    const publishedTomlPath = path.join(temporaryRoot, MAINNET_V8_PUBLISHED_FILENAME);
    const published = publishedPrefixSnapshot(wal, checkoutRoot, MAINNET_V8_PUBLISH_ORDER.length,
      readNativeSoulExternalPublications({ sourceRevision: wal.plan.sourceRevision, checkoutRoot }));
    await writePublishedPrefix(publishedTomlPath, published);
    return await operation(Object.freeze({
      checkoutRoot,
      publishedTomlPath,
      published,
      identity: snapshotIdentity,
    }));
  });
}

/**
 * Rebuild the exact publish bytes from the archived clean checkout immediately
 * before signing.  executionPlanId commits the source/toolchain/DAG template;
 * this ordinal build seal is the authority that binds those sources to the
 * concrete package bytecode after predecessor package IDs become known.
 */
export async function assertMainnetV8ReadyBuild({
  paths,
  wal,
  event,
  suiBinary,
  repositoryRoot = REPOSITORY_ROOT,
}) {
  const ordinal = Number(decimal(event.ordinal, 'READY build ordinal'));
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= MAINNET_V8_PUBLISH_ORDER.length) {
    return Object.freeze({ kind: 'NON_PUBLISH', ordinal: event.ordinal });
  }
  if (event.status !== 'READY' || event.attempt !== '0') {
    fail('MAINNET_V8_READY_BUILD_DRIFT', 'Only the canonical publish READY cursor can be rebuilt.');
  }
  const ready = event.evidence?.readyArtifact;
  const role = MAINNET_V8_PUBLISH_ORDER[ordinal];
  if (!plain(ready) || ready.kind !== 'PUBLISH' || ready.role !== role) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} READY does not contain its exact publish artifact.`);
  }
  const persistentPublished = await materializePublishedPrefix(paths, wal);
  if (ready.publishedTomlSha256 !== persistentPublished.sha256) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} READY is not bound to the finalized Published.toml prefix.`);
  }
  const { build, published } = await withFreshReleaseCheckout(
    { sourceStorePath: paths.sourceStore ?? path.join(paths.root, 'source-cas'), wal, suiBinary },
    async ({ checkoutRoot, publishedTomlPath, published: freshPublished, identity }) => ({
      published: freshPublished,
      build: await buildMainnetV8Package({
        role,
        checkoutRoot,
        publishedTomlPath,
        suiBinary: identity.toolchain.path,
        sourceRevision: identity.sourceRevision,
        toolchain: identity.toolchain,
        sourceArtifact: wal.plan.packages[ordinal].sourceArtifact,
      }),
    }),
  );
  if (published.sha256 !== persistentPublished.sha256
    || published.sha256 !== ready.publishedTomlSha256) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} clean-room Published.toml prefix differs from durable READY.`);
  }
  // Exact dependencies come from this approved compiler rebuild of the bound
  // SOURCE, not a stale hand-maintained seven-role dependency expectation.
  if (canonicalJson(build.packageArtifact) !== canonicalJson(ready.packageArtifact)
    || computePackageCommitment(build.packageArtifact) !== ready.packageCommitment
    || canonicalJson(build.publishModules) !== canonicalJson(ready.modules)
    || canonicalJson(build.dependencies) !== canonicalJson(ready.dependencies)) {
    fail('MAINNET_V8_READY_BUILD_DRIFT', `${role} cold rebuild differs from the durable READY build seal.`);
  }
  return Object.freeze({
    kind: 'PUBLISH_BUILD_VERIFIED',
    ordinal: event.ordinal,
    role,
    packageCommitment: ready.packageCommitment,
    publishedTomlSha256: persistentPublished.sha256,
  });
}

export async function verifyMainnetV8FinalPackages({
  repositoryRoot = REPOSITORY_ROOT,
  sourceStorePath,
  wal,
  suiBinary,
  client,
  transport,
}) {
  assertReleasePlan(wal?.plan);
  if (!wal.finalManifest || wal.releaseId !== wal.finalManifest.releaseId) {
    fail('MAINNET_V8_FINAL_MANIFEST_REQUIRED', 'Final package verification requires the sealed manifest.');
  }
  if (canonicalJson(wal.finalManifest.packages) !== canonicalJson(mainnetV8FinalPackageRowsFromWal(wal))) {
    fail('MAINNET_V8_FINAL_PACKAGE_DRIFT', 'Final package inventory differs from the eight finalized publication certificates.');
  }
  return withFreshReleaseCheckout(
    { sourceStorePath, wal, suiBinary },
    async ({ checkoutRoot, publishedTomlPath, identity }) => {
      const packages = [];
      for (let ordinal = 0; ordinal < MAINNET_V8_PUBLISH_ORDER.length; ordinal += 1) {
        const role = MAINNET_V8_PUBLISH_ORDER[ordinal];
        const ready = cursorEvidence(wal, ordinal, '0', 'READY').readyArtifact;
        const details = finalizedDetails(wal, ordinal);
        const durablePackage = details.certificate.readback.package;
        const manifest = wal.finalManifest.packages[ordinal];
        const published = publishedPrefixSnapshot(wal, checkoutRoot, ordinal,
          readNativeSoulExternalPublications({ sourceRevision: wal.plan.sourceRevision, checkoutRoot }));
        await writePublishedPrefix(publishedTomlPath, published);
        if (ready.role !== role || ready.publishedTomlSha256 !== published.sha256) {
          fail('MAINNET_V8_FINAL_PACKAGE_DRIFT', `${role} READY is not bound to its historical Published.toml prefix.`);
        }
        const build = await buildMainnetV8Package({
          role,
          checkoutRoot,
          publishedTomlPath,
          suiBinary: identity.toolchain.path,
          sourceRevision: identity.sourceRevision,
          toolchain: identity.toolchain,
          sourceArtifact: wal.plan.packages[ordinal].sourceArtifact,
        });
        if (canonicalJson(build.packageArtifact) !== canonicalJson(ready.packageArtifact)
          || canonicalJson(build.publishModules) !== canonicalJson(ready.modules)
          || canonicalJson(build.dependencies) !== canonicalJson(ready.dependencies)
          || computePackageCommitment(build.packageArtifact) !== details.packageCommitment) {
          fail('MAINNET_V8_FINAL_PACKAGE_DRIFT', `${role} final clean rebuild differs from durable READY/finality evidence.`);
        }
        const observedPackage = await readMainnetV8PackageCertificate({
          client,
          transport,
          role,
          build: Object.freeze({
            packageArtifact: build.packageArtifact,
            modules: Object.freeze(build.modules.map((module) => Object.freeze({
              name: module.name,
              base64: module.base64,
            }))),
          }),
          reference: durablePackage.reference,
          transactionDigest: details.certificate.finalityEvidence.digest,
        });
        const abiCommitment = computeAbiCommitment(observedPackage.abiArtifact);
        if (canonicalJson(observedPackage) !== canonicalJson(durablePackage)
          || abiCommitment !== details.abiCommitment
          || manifest.role !== role
          || manifest.packageId !== observedPackage.reference.objectId
          || manifest.packageDigest !== observedPackage.reference.digest
          || manifest.packageVersion !== observedPackage.reference.version
          || manifest.publishDigest !== details.certificate.finalityEvidence.digest
          || manifest.sourceCommitment !== wal.plan.packages[ordinal].sourceCommitment
          || manifest.packageCommitment !== details.packageCommitment
          || manifest.abiCommitment !== abiCommitment
          || manifest.readbackSha256 !== details.certificate.readbackSha256) {
          fail('MAINNET_V8_FINAL_PACKAGE_DRIFT', `${role} final on-chain package/ABI differs from the sealed release manifest.`);
        }
        packages.push(Object.freeze({
          role,
          packageId: manifest.packageId,
          packageDigest: manifest.packageDigest,
          packageVersion: manifest.packageVersion,
          publishDigest: manifest.publishDigest,
          sourceCommitment: manifest.sourceCommitment,
          packageCommitment: manifest.packageCommitment,
          abiCommitment: manifest.abiCommitment,
          moduleMapSha256: observedPackage.moduleMapSha256,
          objectBcsSha256: observedPackage.objectBcsSha256,
          readbackSha256: manifest.readbackSha256,
        }));
      }
      return Object.freeze({
        kind: 'FINAL_PACKAGE_REBUILD_VERIFICATION',
        executionPlanId: wal.executionPlanId,
        releaseId: wal.releaseId,
        packages: Object.freeze(packages),
      });
    },
  );
}

async function preparePublishReady({
  paths,
  wal,
  ordinal,
  suiBinary,
  client,
  repositoryRoot = REPOSITORY_ROOT,
}) {
  const role = MAINNET_V8_PUBLISH_ORDER[ordinal];
  const persistentPublished = await materializePublishedPrefix(paths, wal);
  const { build, published } = await withFreshReleaseCheckout(
    { sourceStorePath: paths.sourceStore ?? path.join(paths.root, 'source-cas'), wal, suiBinary },
    async ({ checkoutRoot, publishedTomlPath, published: freshPublished, identity }) => ({
      published: freshPublished,
      build: await buildMainnetV8Package({
        role,
        checkoutRoot,
        publishedTomlPath,
        suiBinary: identity.toolchain.path,
        sourceRevision: identity.sourceRevision,
        toolchain: identity.toolchain,
        sourceArtifact: wal.plan.packages[ordinal].sourceArtifact,
      }),
    }),
  );
  if (published.sha256 !== persistentPublished.sha256) {
    fail('MAINNET_V8_BUILD_DEPENDENCY_DRIFT', `${role} clean-room Published.toml differs from durable prefix.`);
  }
  const profile = await assertMainnetV8ProtocolProfile(client);
  const prepared = await prepareUnsignedMainnetV8Transaction({
    client,
    profile,
    sender: wal.plan.sender,
    buildTransaction: (transactionContext) => buildMainnetV8PublishTransaction({
      modules: build.publishModules,
      dependencies: build.dependencies,
      transactionContext,
    }),
  });
  const readyArtifact = Object.freeze({
    kind: 'PUBLISH',
    role,
    packageArtifact: build.packageArtifact,
    packageCommitment: computePackageCommitment(build.packageArtifact),
    modules: build.publishModules,
    dependencies: build.dependencies,
    publishedTomlSha256: persistentPublished.sha256,
    simulation: prepared.simulation,
    gasFunding: prepared.gasFunding,
    protocolProfile: profile,
    predecessorReadback: predecessorForReady(wal, ordinal),
  });
  return appendReadyEvent({
    paths, wal, ordinal, readyArtifact, unsignedEnvelope: prepared.unsignedEnvelope,
  });
}

function sharedReferenceFromOutput(output, label) {
  const initialSharedVersion = output?.owner?.Shared?.initial_shared_version;
  if (!output?.reference || initialSharedVersion === undefined) {
    fail('MAINNET_V8_SHARED_REFERENCE_INVALID', `${label} lacks a certified shared reference.`);
  }
  return Object.freeze({
    objectId: address(output.reference.objectId, `${label}.objectId`),
    initialSharedVersion: decimal(String(initialSharedVersion), `${label}.initialSharedVersion`),
  });
}

function ownedReferenceFromOutput(output, label) {
  if (!output?.reference) fail('MAINNET_V8_OWNED_REFERENCE_INVALID', `${label} lacks a certified owned reference.`);
  return Object.freeze({
    objectId: address(output.reference.objectId, `${label}.objectId`),
    version: decimal(String(output.reference.version), `${label}.version`),
    digest: digest(output.reference.digest, `${label}.digest`),
  });
}

export async function readMainnetV8WalrusSystemReference({ transport }) {
  const evidence = await readMakerV8WalrusExecutionV1({ transport,
    minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
  return assertMakerV8WalrusExecutionV1(evidence,
    { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY }).system;
}

export async function preflightMainnetV8WalrusExecution({ client, transport, profile, sender }) {
  const evidence = await readMakerV8WalrusExecutionV1({ transport,
    minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
  const target = assertMakerV8WalrusExecutionV1(evidence,
    { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
  await prepareUnsignedMainnetV8Transaction({ client, profile, sender,
    buildTransaction: context => {
      const tx = new Transaction();
      tx.moveCall({ target: target.packageId + '::system::epoch',
        arguments: [tx.sharedObjectRef({ ...target.system, mutable: false })] });
      return configureMainnetV8Transaction(tx, context);
    } });
  return target;
}

export async function prepareMainnetV8StageReady({ paths, wal, stage, client, transport }) {
  assertReleasePlan(wal.plan);
  const step = MAINNET_V8_RELEASE_STEPS.find(entry => entry.kind === stage);
  if (!step || !(NATIVE_SOUL_BOOTSTRAP_STAGES.includes(stage) || stage === 'ACTIVATE_SOULIDITY_MARKET')) {
    fail('MAINNET_V8_READY_CONTEXT_DRIFT', 'Cannot prepare an unknown release stage.');
  }
  const published = await materializePublishedPrefix(paths, wal);
  const extras = {};
  if (stage === 'SETUP_RELEASE') {
    const [keyServerCertificates, walrusExecution] = await Promise.all([
      certifyMainnetV8SealKeyServers({ transport, sealPolicy: wal.finalManifest.sealPolicy }),
      readMakerV8WalrusExecutionV1({ transport, minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY }),
    ]);
    const walrusSystem = assertMakerV8WalrusExecutionV1(walrusExecution,
      { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY }).system;
    Object.assign(extras, { keyServerCertificates, walrusSystem, walrusExecution });
  }
  const { stageData } = stage === 'ACTIVATE_SOULIDITY_MARKET'
    ? nativeSoulMarketActivationContextFromWal(wal) : nativeSoulBootstrapContextFromWal({ wal, stage, ...extras });
  const profile = await assertMainnetV8ProtocolProfile(client);
  const prepared = await prepareUnsignedMainnetV8Transaction({
    client, profile, sender: wal.plan.sender,
    buildTransaction: transactionContext => buildMainnetV8ReadyTransaction({
      ordinal: step.ordinal, readyArtifact: { kind: stage, stageData }, transactionContext,
    }),
  });
  const readyArtifact = Object.freeze({
    kind: stage, stageData, stageDataSha256: mainnetV8JsonSha(stageData),
    publishedTomlSha256: published.sha256, simulation: prepared.simulation,
    gasFunding: prepared.gasFunding, protocolProfile: profile,
    predecessorReadback: predecessorForReady(wal, Number(step.ordinal)),
  });
  return appendReadyEvent({
    paths, wal, ordinal: Number(step.ordinal), readyArtifact, unsignedEnvelope: prepared.unsignedEnvelope,
  });
}

export async function preflightMainnetV8BrowserSeal({ sealPolicy,
  createClient = createMakerV8BrowserSealClient, fetcher = globalThis.fetch,
}) {
  // Final policy includes package binding; validate the shared key-set through
  // the same strict template builder rather than silently accepting other IDs.
  buildSealPolicy({ keyServers: sealPolicy.keyServers, threshold: sealPolicy.threshold });
  const client = await createClient({ serverConfigs: sealPolicy.keyServers.map(row => ({
    objectId: row.objectId, weight: Number(row.weight),
  })) });
  const servers = await client.getKeyServers();
  if (servers.size !== MAINNET_V8_BROWSER_KEY_SERVERS.length) {
    fail('MAINNET_V8_BROWSER_SEAL_UNAVAILABLE', 'Seal topology cardinality drifted.');
  }
  const requestedHeaders = ['content-type', 'request-id', 'client-sdk-type', 'client-sdk-version'];
  const results = [];
  for (const pin of MAINNET_V8_BROWSER_KEY_SERVERS) {
    const server = servers.get(pin.objectId);
    if (!server || server.objectId !== pin.objectId || server.serverType !== 'Independent'
      || server.url !== pin.url) {
      fail('MAINNET_V8_BROWSER_SEAL_UNAVAILABLE', 'Verified Seal endpoint differs from the public Mainnet pin.');
    }
    for (const origin of ['https://animacraft.soulidity.ai', 'https://www.soulidity.ai']) {
      const serviceUrl = `${pin.url}/v1/service?service_id=${pin.objectId}`;
      for (const [url, method] of [[serviceUrl, 'GET'], [`${pin.url}/v1/fetch_key`, 'POST']]) {
        const response = await fetcher(url, {
          method: 'OPTIONS', credentials: 'omit', redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(10_000),
          headers: { Origin: origin, 'Access-Control-Request-Method': method,
            'Access-Control-Request-Headers': requestedHeaders.join(',') },
        });
        const allowOrigin = response.headers.get('access-control-allow-origin');
        const methods = (response.headers.get('access-control-allow-methods') ?? '').split(',').map(x => x.trim());
        const headers = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map(x => x.trim());
        if (!response.ok || !['*', origin].includes(allowOrigin)
          || !(methods.includes('*') || methods.includes(method))
          || !(headers.includes('*') || requestedHeaders.every(x => headers.includes(x)))) {
          fail('MAINNET_V8_BROWSER_SEAL_UNAVAILABLE', 'Seal endpoint does not permit no-secret requests from both production sites.');
        }
        results.push(Object.freeze({ objectId: pin.objectId, origin, method, status: response.status }));
      }
      // Node's SDK verifies PoP, but unlike a browser it ignores response CORS.
      // Check the actual service response and visibility of the SDK's version
      // header as well. Key-share POST responses require S13 authorized tests.
      const service = await fetcher(serviceUrl, { method: 'GET',
        headers: { Origin: origin, 'Content-Type': 'application/json',
          'Request-Id': randomUUID(), 'Client-Sdk-Type': 'typescript',
          'Client-Sdk-Version': packageMetadata.dependencies['@mysten/seal'] },
        credentials: 'omit', redirect: 'error',
        cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const exposed = (service.headers.get('access-control-expose-headers') ?? '')
        .toLowerCase().split(',').map(x => x.trim());
      if (!service.ok || !['*', origin].includes(service.headers.get('access-control-allow-origin'))
        || !service.headers.get('x-keyserver-version')
        || !(exposed.includes('*') || exposed.includes('x-keyserver-version'))) {
        fail('MAINNET_V8_BROWSER_SEAL_UNAVAILABLE', 'Seal service response is not browser-readable with its SDK version header.');
      }
      await service.body?.cancel();
    }
  }
  return Object.freeze({ kind: 'BROWSER_SEAL_TOPOLOGY_VERIFIED',
    authorizedDecryptionTested: false, cors: Object.freeze(results) });
}

export async function certifyMainnetV8SealKeyServers({ transport, sealPolicy,
  createClient, fetcher,
}) {
  await preflightMainnetV8BrowserSeal({ sealPolicy, createClient, fetcher });
  const certificates = [];
  for (const server of sealPolicy.keyServers) {
    const pin = MAINNET_V8_BROWSER_KEY_SERVERS.find(row => row.objectId === server.objectId);
    const response = await transport.getObject({
      id: server.objectId,
      options: { showContent: true, showBcs: true, showOwner: true },
    });
    const data = response?.data;
    if (!data || data.objectId !== server.objectId
      || data.type !== MAINNET_V8_BROWSER_KEY_SERVER_TYPE
      || data.content?.dataType !== 'moveObject'
      || data.content?.type !== MAINNET_V8_BROWSER_KEY_SERVER_TYPE
      || data.bcs?.dataType !== 'moveObject'
      || data.bcs?.type !== MAINNET_V8_BROWSER_KEY_SERVER_TYPE
      || String(data.bcs?.version) !== String(data.version)
      || !plain(data.owner)
      || Object.keys(data.owner).length !== 1 || data.owner.AddressOwner !== pin.owner) {
      fail('MAINNET_V8_SEAL_KEY_SERVER_INVALID', 'Seal key server is absent or has an unapproved Mainnet shape.', {
        objectId: server.objectId,
      });
    }
    const objectBytes = fromBase64(data.bcs.bcsBytes);
    const parsed = SEAL_KEY_SERVER_OBJECT_BCS.parse(objectBytes);
    const roundtrip = SEAL_KEY_SERVER_OBJECT_BCS.serialize(parsed).toBytes();
    if (!sameBytes(objectBytes, roundtrip)
      || address(parsed.id, 'Seal key server BCS id') !== server.objectId
      || decimal(String(parsed.first_version), 'Seal key server first_version') !== '1'
      || decimal(String(parsed.last_version), 'Seal key server last_version') !== '1'
      || canonicalJson(data.content.fields) !== canonicalJson({
        id: server.objectId,
        first_version: '1',
        last_version: '1',
      })
      || sha256Hex(objectBytes) !== pin.contentSha256) {
      fail('MAINNET_V8_SEAL_KEY_SERVER_INVALID', 'Seal key server raw BCS differs from the reviewed Mainnet independent-server snapshot.', {
        objectId: server.objectId,
      });
    }
    certificates.push(Object.freeze({
      objectId: server.objectId,
      type: data.type,
      version: decimal(String(data.version), 'Seal key server version'),
      digest: digest(data.digest, 'Seal key server digest'),
      owner: address(data.owner.AddressOwner, 'Seal key server owner'),
      previousTransaction: digest(data.previousTransaction, 'Seal key server previousTransaction'),
      contentSha256: sha256Hex(objectBytes),
    }));
  }
  return Object.freeze(certificates);
}



export async function rereadNativeBootstrapHistoryObject({ transport, evidence }) {
  decodeNativeSoulBootstrapHistoryObject(evidence);
  const expected = structuredClone(evidence);
  const current = (await transport.getObject({ id: expected.reference.objectId,
    options: { showType: true, showOwner: true } }))?.data;
  if (!current || current.objectId !== expected.reference.objectId
    || current.version !== expected.reference.version || current.digest !== expected.reference.digest) {
    fail('MAINNET_V8_STAGE_AUTHORITY_DRIFT', 'A native bootstrap predecessor changed after READY.');
  }
  const historical = await transport.getHistoricalObject({
    objectId: expected.reference.objectId, version: BigInt(expected.reference.version),
  });
  const observed = nativeBootstrapHistoryEnvelope({
    reference: { objectId: historical.objectId, version: historical.version, digest: historical.digest },
    type: historical.type, owner: historical.owner, previousTransaction: historical.previousTransaction,
    objectBcsBase64: toBase64(historical.objectBcs),
  });
  decodeNativeSoulBootstrapHistoryObject(observed);
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    fail('MAINNET_V8_STAGE_AUTHORITY_DRIFT', 'Historical authority differs from the certified READY predecessor.');
  }
  return observed;
}

export async function assertMainnetV8StageReadyAuthority({ wal, event, transport }) {
  assertReleasePlan(wal.plan);
  const step = MAINNET_V8_RELEASE_STEPS.find(entry => entry.ordinal === event.ordinal);
  if (!step) fail('MAINNET_V8_STAGE_AUTHORITY_DRIFT', 'Unknown READY authority ordinal.');
  if (step.kind === 'PUBLISH' || step.kind === 'VERIFY_AND_EXPORT') {
    if (step.kind === 'PUBLISH') {
      await certifyMainnetV8SealKeyServers({ transport, sealPolicy: wal.plan.sealPolicy });
    }
    return Object.freeze({ kind: 'NON_BOOTSTRAP', ordinal: event.ordinal });
  }
  const readyArtifact = event.evidence.readyArtifact;
  assertMainnetV8ReadyWalContext({ wal, ordinal: event.ordinal, readyArtifact });
  const extras = step.kind === 'SETUP_RELEASE' ? {
    keyServerCertificates: readyArtifact.stageData.keyServerCertificates,
    walrusSystem: readyArtifact.stageData.walrusSystem,
    walrusExecution: readyArtifact.stageData.walrusExecution,
  } : {};
  const { priorObjects } = step.kind === 'ACTIVATE_SOULIDITY_MARKET'
    ? nativeSoulMarketActivationContextFromWal(wal) : nativeSoulBootstrapContextFromWal({ wal, stage: step.kind, ...extras });
  const observed = await Promise.all(Object.entries(priorObjects).map(async ([kind, evidence]) => [
    kind, await rereadNativeBootstrapHistoryObject({ transport, evidence }),
  ]));
  if (step.kind === 'SETUP_RELEASE') {
    const [keyServerCertificates, walrusExecution] = await Promise.all([
      certifyMainnetV8SealKeyServers({ transport, sealPolicy: wal.finalManifest.sealPolicy }),
      readMakerV8WalrusExecutionV1({ transport, minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY }),
    ]);
    const target = assertMakerV8WalrusExecutionV1(walrusExecution,
      { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
    const expectedTarget = assertMakerV8WalrusExecutionV1(extras.walrusExecution,
      { minimumDependency: NATIVE_SOUL_WALRUS_MINIMUM_DEPENDENCY });
    if (canonicalJson(keyServerCertificates) !== canonicalJson(extras.keyServerCertificates)
      || canonicalJson(target.system) !== canonicalJson(extras.walrusSystem)
      || canonicalJson(target) !== canonicalJson(expectedTarget)) {
      fail('MAINNET_V8_STAGE_AUTHORITY_DRIFT', 'SETUP external authority differs from READY.');
    }
  }
  return Object.freeze({ kind: 'RELEASE_STAGE_AUTHORITY_VERIFIED', stage: step.kind,
    priorObjectsSha256: mainnetV8JsonSha(Object.fromEntries(observed)) });
}



async function prepareVerifyReady({ paths, wal, client }) {
  const published = await materializePublishedPrefix(paths, wal);
  const ordinal = MAINNET_V8_RELEASE_STEPS.find(step => step.kind === 'VERIFY_AND_EXPORT').ordinal;
  const bootstrapDetails = finalizedDetails(wal, MAINNET_V8_RELEASE_STEPS.find(step => step.kind === 'FINALIZE_BOOTSTRAP').ordinal);
  const stageData = Object.freeze({
    releaseId: wal.releaseId,
    finalManifestSha256: mainnetV8JsonSha(wal.finalManifest),
    bootstrapCertificateSha256: bootstrapDetails.certificate.readbackSha256,
    marketActivationCertificateSha256: finalizedDetails(wal,
      MAINNET_V8_RELEASE_STEPS.find(row => row.kind === 'ACTIVATE_SOULIDITY_MARKET').ordinal).certificate.readbackSha256,
    exportFilename: path.basename(paths.exportedConfig),
  });
  const profile = await assertMainnetV8ProtocolProfile(client);
  const readyArtifact = Object.freeze({
    kind: 'VERIFY_AND_EXPORT',
    stageData,
    stageDataSha256: mainnetV8JsonSha(stageData),
    publishedTomlSha256: published.sha256,
    simulation: null,
    gasFunding: null,
    protocolProfile: profile,
    predecessorReadback: predecessorForReady(wal, Number(ordinal)),
  });
  return appendReadyEvent({
    paths, wal, ordinal: Number(ordinal), readyArtifact, unsignedEnvelope: null,
  });
}

export function mainnetV8RuntimeConfigFromWal(wal) {
  // Called only after cold WAL certification by the executor. This projection
  // does not establish finality or enable an incomplete release on its own.
  wal = structuredClone(wal);
  const stage = 'FINALIZE_BOOTSTRAP';
  const ordinal = MAINNET_V8_RELEASE_STEPS.find(row => row.kind === stage).ordinal;
  const finalReadback = finalizedDetails(wal, Number(ordinal)).certificate.readback;
  const final = deriveNativeSoulFinalBootstrapObjects({ manifest: wal.finalManifest, plan: wal.plan,
    priorReadbacks: nativeSoulBootstrapPriorReadbacksFromWal({ wal, stage }), finalReadback });
  const { packageIds, decoded } = final;
  const nativeStep = MAINNET_V8_RELEASE_STEPS.find(row => row.kind === 'PUBLISH' && row.role === 'soulidity');
  const native = finalizedDetails(wal, Number(nativeStep.ordinal)).certificate.readback;
  const sealed = wal.finalManifest.packages.find(row => row.role === 'soulidity');
  if (native.package.reference.objectId !== packageIds.soulidity
    || native.package.reference.digest !== sealed.packageDigest
    || native.soulidityInitialization?.packageId !== packageIds.soulidity) {
    fail('MAINNET_V8_FINAL_ATTESTATION_DRIFT', 'Native publication identity differs from the sealed manifest.');
  }
  const external = name => {
    const pin = NATIVE_SOUL_EXTERNAL_PUBLICATIONS.find(row => row.packageName === name);
    const matches = native.package.linkage.filter(row => row.originalId === pin.originalId);
    if (matches.length !== 1 || matches[0].upgradedId !== pin.publishedAt
      || matches[0].upgradedVersion !== pin.version) {
      fail('MAINNET_V8_FINAL_ATTESTATION_DRIFT', `${name} native dependency differs from the verified release pin.`);
    }
    return matches[0].upgradedId;
  };
  const binding = decoded.nativeSoulBinding.fields.value;
  const expectedNativeBinding = Object.fromEntries([
    ['soulOriginalType', 'soul_original'], ['soulDefiningType', 'soul_defining'],
    ['mintWitnessOriginalType', 'mint_original'], ['mintWitnessDefiningType', 'mint_defining'],
    ['ownerWitnessOriginalType', 'owner_original'], ['ownerWitnessDefiningType', 'owner_defining'],
  ].map(([key, field]) => [key, `0x${binding[field].name}`]));
  const ids = native.soulidityInitialization.ids;
  const runtimeConfig = {
    schemaVersion: 'animacraft.maker-v8-runtime.v8', protocolVersion: 8,
    enabled: decoded.protocol.fields.enabled,
    catalogId: decoded.catalog.reference.objectId,
    protocolConfigId: decoded.protocol.reference.objectId,
    protocolTreasuryId: decoded.protocolTreasury.reference.objectId,
    paymentCoinType: decoded.protocol.fields.payment_coin_type,
    clockObjectId: normalizeSuiAddress('0x6'),
    roles: Object.fromEntries(ROLE_ORDER.map(role => [role, {
      typeOriginPackageId: packageIds[role], callablePackageId: packageIds[role],
    }])),
    roleConfigIds: Object.fromEntries(ROLE_ORDER.filter(role => role !== 'core').map(role => [
      role, decoded[`${role}Config`].reference.objectId,
    ])), makerBindings: [],
    nativeSoulIntegration: {
      soulidityOriginalPackageId: packageIds.soulidity, soulidityCallablePackageId: packageIds.soulidity,
      soulidityCallableDigest: sealed.packageDigest, kioskPackageId: external('Kiosk'), walrusPackageId: external('Walrus'),
      marketConfigV2Id: ids.marketConfigV2Id, kindRegistryId: ids.kindRegistryId,
      kioskRegistryId: ids.kioskRegistryId, soulTransferPolicyId: ids.soulTransferPolicyId, expectedNativeBinding,
    },
  };
  const validatedRuntime = assertMakerV8Runtime(runtimeConfig, { requireEnabled: true,
    resolveTypeOriginPackageId: role => packageIds[role] });
  const packageTarget = role => {
    const row = wal.finalManifest.packages.find(entry => entry.role === role);
    return Object.freeze({ originalPackageId: row.packageId, callablePackageId: row.packageId,
      callableDigest: row.packageDigest });
  };
  const output = packageTarget('output');
  const receiveTarget = Object.freeze({
    protocolConfigId: validatedRuntime.protocolConfigId, coreOriginalPackageId: packageIds.core,
    outputOriginalPackageId: output.originalPackageId, outputCallablePackageId: output.callablePackageId,
    outputCallableDigest: output.callableDigest,
    soulidityOriginalPackageId: packageIds.soulidity, soulidityCallablePackageId: packageIds.soulidity,
    soulidityCallableDigest: sealed.packageDigest,
    expectedNativeBinding: validatedRuntime.nativeSoulIntegration.expectedNativeBinding,
    runtime: packageTarget('runtime'), release: packageTarget('release'),
    equipmentMarket: Object.freeze({ ...packageTarget('market'),
      replacementId: decoded.replacement.reference.objectId }),
    // Initialization proves identities, not product acceptance or market enablement.
    equipmentWritesEnabled: false, marketWritesEnabled: false,
  });
  const collectionPolicyId = ids.collectionTransferPolicyId;
  if (typeof collectionPolicyId !== 'string' || !/^0x[0-9a-f]{64}$/.test(collectionPolicyId)
    || /^0x0+$/.test(collectionPolicyId)
    || [ids.marketConfigV2Id, ids.kindRegistryId, ids.kioskRegistryId, ids.soulTransferPolicyId].includes(collectionPolicyId)) {
    fail('MAINNET_V8_FINAL_ATTESTATION_DRIFT', 'Native collection policy must be a distinct certified object.');
  }
  // IDs are derived by the enclosing cold publication BCS verifier.
  // Refuse an incomplete projection rather than exporting undefined values.
  const registryIds = new Set([packageIds.soulidity, ids.marketConfigV2Id,
    ids.kindRegistryId, ids.kioskRegistryId, ids.soulTransferPolicyId, collectionPolicyId]);
  for (const key of ['profileRegistryId', 'socialRegistryId', 'communityRegistryId', 'communityVoteRegistryId']) {
    const value = ids[key];
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)
      || /^0x0+$/.test(value) || registryIds.has(value)) {
      fail('MAINNET_V8_FINAL_ATTESTATION_DRIFT', `${key} must be a distinct certified initialization object.`);
    }
    registryIds.add(value);
  }
  const soulidityEnvironment = Object.freeze({
    NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: packageIds.soulidity,
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: packageIds.soulidity,
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: packageIds.soulidity,
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: ids.marketConfigV2Id,
    NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID: ids.kindRegistryId,
    NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID: ids.profileRegistryId,
    NEXT_PUBLIC_SOULIDITY_SOCIAL_REGISTRY_ID: ids.socialRegistryId,
    NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID: ids.communityRegistryId,
    NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID: ids.communityVoteRegistryId,
    NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID: ids.kioskRegistryId,
    NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: ids.soulTransferPolicyId,
    NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID: collectionPolicyId,
    NEXT_PUBLIC_KIOSK_PACKAGE_ID: validatedRuntime.nativeSoulIntegration.kioskPackageId,
    // Blob identity uses the original type package, not its upgraded callable ID.
    // The matching Walrus linkage was checked above by external('Walrus').
    NEXT_PUBLIC_WALRUS_BLOB_TYPE: `${NATIVE_SOUL_EXTERNAL_PUBLICATIONS.find(row => row.packageName === 'Walrus').originalId}::blob::Blob`,
    NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: validatedRuntime.paymentCoinType,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: canonicalJson(receiveTarget),
  });
  return Object.freeze({ runtimeConfig: validatedRuntime, soulidityEnvironment,
    finalReadback: final.finalReadback, objects: final.objects });
}

export function mainnetV8MarketActivationFromWal(wal) {
  const ordinal = MAINNET_V8_RELEASE_STEPS.find(row => row.kind === 'ACTIVATE_SOULIDITY_MARKET').ordinal;
  const certificate = finalizedDetails(wal, ordinal).certificate;
  const { stageData, priorObjects } = nativeSoulMarketActivationContextFromWal(wal);
  const finality = certificate.finalityEvidence;
  const transactionBytes = fromBase64(finality.transactionBase64);
  if (TransactionDataBuilder.getDigestFromBytes(transactionBytes) !== finality.digest
    || certificate.readbackSha256 !== mainnetV8JsonSha(certificate.readback)
    || canonicalJson(certificate.readback.input) !== canonicalJson(stageData)
    || canonicalJson(certificate.readback.priorObjects) !== canonicalJson(priorObjects)) {
    fail('MAINNET_V8_FINAL_ATTESTATION_DRIFT', 'Market activation differs from its certified transaction or predecessor.');
  }
  const observed = validateNativeSoulMarketActivationHistory({ input: stageData, sender: wal.plan.sender,
    transactionBytes, effectsBytes: fromBase64(finality.effectsBcsBase64), priorObjects,
    objects: certificate.readback.objects });
  if (canonicalJson(observed) !== canonicalJson(certificate.readback)) {
    fail('MAINNET_V8_FINAL_ATTESTATION_DRIFT', 'Market activation readback does not prove the exact enabled configuration.');
  }
  return Object.freeze({ transactionDigest: finality.digest, readbackSha256: certificate.readbackSha256,
    readback: observed });
}

export function buildMainnetV8PairedConfig({ wal, packageVerification }) {
  const bootstrap = mainnetV8RuntimeConfigFromWal(wal);
  const activation = mainnetV8MarketActivationFromWal(wal);
  return Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'ANIMACRAFT_MAINNET_V8_CONFIG', executionPlanId: wal.executionPlanId, releaseId: wal.releaseId,
    runtimeConfig: bootstrap.runtimeConfig, soulidityEnvironment: bootstrap.soulidityEnvironment,
    marketActivation: Object.freeze({ transactionDigest: activation.transactionDigest,
      readbackSha256: activation.readbackSha256, primaryEnabled: true, secondaryEnabled: true }),
    packageIds: packageIdsFromFinalManifest(wal), finalManifest: structuredClone(wal.finalManifest),
    packageVerification: structuredClone(packageVerification), protectedDecryptionReady: false,
    protectedDecryptionBlocker: Object.freeze({ code: 'AUTHORIZED_BROWSER_DECRYPT_NOT_VERIFIED',
      secretStoredInArtifact: false }),
  });
}

// Content verification over an already authenticated cold WAL. The public
// reader below must call readReleaseWal before this projection is reachable.
export function assertMainnetV8ExportConfigContents({ wal, bytes }) {
  const head = headEvent(wal);
  if (head?.status !== 'FINALIZED_SUCCESS' || nextMainnetV8FinalizedAction(head).kind !== 'COMPLETE') {
    fail('MAINNET_V8_EXPORT_INCOMPLETE', 'Only a completed final verification can export deployment configuration.');
  }
  const certificate = finalizedDetails(wal, head.ordinal).certificate;
  const buffer = Buffer.from(bytes);
  if (certificate.exports.filename !== 'animacraft-mainnet-v8-config.json'
    || sha256Hex(buffer) !== certificate.exports.sha256) {
    fail('MAINNET_V8_CONFIG_EXPORT_DRIFT', 'Export bytes differ from the completed release certificate.');
  }
  let config;
  try { config = JSON.parse(buffer.toString('utf8')); }
  catch { fail('MAINNET_V8_CONFIG_EXPORT_DRIFT', 'Export is not valid JSON.'); }
  const expected = buildMainnetV8PairedConfig({ wal, packageVerification: certificate.verification.packageVerification });
  if (canonicalJson(config) !== canonicalJson(expected)) {
    fail('MAINNET_V8_CONFIG_EXPORT_DRIFT', 'Export differs from the certified two-product configuration.');
  }
  return expected;
}

export async function readMainnetV8DeploymentConfig({ stateDir, format = 'json' }) {
  if (!['json', 'soulidity-env'].includes(format)) {
    fail('MAINNET_V8_ARGUMENT_INVALID', 'Export format must be json or soulidity-env.');
  }
  const paths = mainnetV8ReleasePaths(stateDir);
  const wal = await readReleaseWal({ path: paths.wal });
  const bytes = await fsp.readFile(paths.exportedConfig);
  const config = assertMainnetV8ExportConfigContents({ wal, bytes });
  if (format === 'json') return bytes.toString('utf8');
  return Object.entries(config.soulidityEnvironment).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== 'string' || /['\r\n\0]/.test(value)) {
      fail('MAINNET_V8_CONFIG_EXPORT_DRIFT', 'Chain configuration cannot be rendered as a literal env value.');
    }
    return `${key}='${value}'`;
  }).join('\n') + '\n';
}

async function performVerifyAndExport({
  paths,
  wal,
  client,
  transport,
  suiBinary,
  repositoryRoot,
  operations,
}) {
  wal = structuredClone(wal);
  const bootstrap = mainnetV8RuntimeConfigFromWal(wal);
  const activation = mainnetV8MarketActivationFromWal(wal);
  const packageVerification = await operations.verifyFinalPackages({
    repositoryRoot,
    sourceStorePath: paths.sourceStore ?? path.join(paths.root, 'source-cas'),
    wal,
    suiBinary,
    client,
    transport,
  });
  const attested = await attestMakerV8Runtime(transport, bootstrap.runtimeConfig, { network: 'mainnet' });
  // Activation is part of this release, not an assumption derived from publish.
  // Both mutable references must still match the finalized enable transaction.
  await Promise.all(Object.values(activation.readback.objects).map(evidence =>
    rereadNativeBootstrapHistoryObject({ transport, evidence })));
  const packageIds = packageIdsFromFinalManifest(wal);
  for (const role of ROLE_ORDER) {
    const observed = attested.catalog.roles[role];
    const sealed = wal.finalManifest.packages.find((entry) => entry.role === role);
    if (observed.originalPackageId !== packageIds[role]
      || observed.callablePackageId !== packageIds[role]
      || observed.sourceCommitment !== sealed.sourceCommitment
      || observed.packageCommitment !== sealed.packageCommitment
      || observed.abiCommitment !== sealed.abiCommitment) {
      fail('MAINNET_V8_FINAL_ATTESTATION_DRIFT', `${role} final runtime attestation differs from sealed manifest.`);
    }
  }
  const exportedConfig = buildMainnetV8PairedConfig({ wal, packageVerification });
  await writeJsonAtomic(paths.exportedConfig, exportedConfig);
  const cold = JSON.parse(await fsp.readFile(paths.exportedConfig, 'utf8'));
  if (canonicalJson(cold) !== canonicalJson(exportedConfig)) {
    fail('MAINNET_V8_CONFIG_EXPORT_DRIFT', 'Cold-read exported config differs from exact attested config.');
  }
  const verification = Object.freeze({
    kind: 'VERIFY_AND_EXPORT',
    executionPlanId: wal.executionPlanId,
    releaseId: wal.releaseId,
    finalManifestSha256: mainnetV8JsonSha(wal.finalManifest),
    packageVerification,
    packageVerificationSha256: mainnetV8JsonSha(packageVerification),
    runtimeAttestationSha256: mainnetV8JsonSha(bootstrap.finalReadback),
    marketActivationCertificateSha256: finalizedDetails(wal,
      MAINNET_V8_RELEASE_STEPS.find(row => row.kind === 'ACTIVATE_SOULIDITY_MARKET').ordinal).certificate.readbackSha256,
  });
  const exports = Object.freeze({
    filename: path.basename(paths.exportedConfig),
    sha256: sha256Hex(await fsp.readFile(paths.exportedConfig)),
    protectedDecryptionReady: false,
  });
  return Object.freeze({
    verification,
    verificationSha256: mainnetV8JsonSha(verification),
    exports,
    exportsSha256: mainnetV8JsonSha(exports),
  });
}

function signedContext(wal, event = headEvent(wal)) {
  const ready = cursorEvidence(wal, event.ordinal, event.attempt, 'READY');
  const signed = cursorEvidence(wal, event.ordinal, event.attempt, 'SIGNED');
  return Object.freeze({ ready, signed });
}

function outcomeEvidenceFor({ status, event, ready, signed, observation }) {
  return buildMainnetV8OutcomeEvidence({
    status,
    ordinal: event.ordinal,
    attempt: event.attempt,
    readyArtifactSha256: ready.readyArtifactSha256,
    signedArtifact: signed.signedArtifact,
    signedArtifactSha256: signed.signedArtifactSha256,
    digest: signed.signedArtifact.digest,
    observation,
  });
}

function finalityCertificate(finalityEvidence, readback) {
  return Object.freeze({
    finalityEvidence,
    finalityEvidenceSha256: mainnetV8JsonSha(finalityEvidence),
    readback,
    readbackSha256: readback === null ? null : mainnetV8JsonSha(readback),
  });
}

async function appendFinalityObservation({ paths, wal, outcome }) {
  const event = headEvent(wal);
  const { ready, signed } = signedContext(wal, event);
  const finalityEvidence = durableMainnetV8FinalityEvidence(
    outcome.evidence,
    signed.signedArtifact,
  );
  if (outcome.status === 'FINALIZED_SUCCESS') {
    const observation = {
      finalityEvidence,
      finalityEvidenceSha256: mainnetV8JsonSha(finalityEvidence),
    };
    const evidence = outcomeEvidenceFor({
      status: 'FINALIZED_SUCCESS_PENDING_READBACK', event, ready, signed, observation,
    });
    return appendAndColdRead(paths, wal, {
      ordinal: event.ordinal, attempt: event.attempt,
      status: 'FINALIZED_SUCCESS_PENDING_READBACK', evidence,
    });
  }
  if (outcome.status !== 'FINALIZED_FAILURE') {
    fail('MAINNET_V8_FINALITY_STATUS_INVALID', `Unsupported finalized outcome ${outcome.status}.`);
  }
  const certificate = finalityCertificate(finalityEvidence, null);
  const details = Number(event.ordinal) < MAINNET_V8_PUBLISH_ORDER.length
    ? {
        packageArtifact: ready.readyArtifact.packageArtifact,
        packageCommitment: ready.readyArtifact.packageCommitment,
        certificate,
        certificateSha256: mainnetV8JsonSha(certificate),
      }
    : { certificate, certificateSha256: mainnetV8JsonSha(certificate) };
  const evidence = outcomeEvidenceFor({
    status: 'FINALIZED_FAILURE', event, ready, signed, observation: details,
  });
  return appendAndColdRead(paths, wal, {
    ordinal: event.ordinal, attempt: event.attempt, status: 'FINALIZED_FAILURE', evidence,
  });
}

function transientReadbackError(error) {
  const code = String(error?.code ?? '');
  // GRPC is a namespace, not a transient failure: BCS/JSON/identity drift must stop.
  return /(?:^|_)(?:UNAVAILABLE|TIMEOUT|DEADLINE_EXCEEDED|NOT_FOUND|PRUNED|ARCHIVAL_UNAVAILABLE|NETWORK_ERROR|RPC_ERROR)$/.test(code);
}

function nativeBootstrapHistoryEnvelope(output) {
  const owner = canonicalOwner(output.owner, 'native bootstrap historical owner');
  const historicalOwner = owner.Shared ? { kind: 'shared', initialSharedVersion: owner.Shared.initial_shared_version }
    : owner.AddressOwner ? { kind: 'address', address: owner.AddressOwner }
      : owner.ObjectOwner ? { kind: 'object', objectId: owner.ObjectOwner } : { kind: 'immutable' };
  return Object.freeze({ reference: Object.freeze({ ...output.reference }), type: output.type,
    owner: Object.freeze(historicalOwner), previousTransaction: output.previousTransaction,
    objectBcsBase64: output.objectBcsBase64 });
}

export function nativeSoulBootstrapPriorObjectsFromWal({ wal, ordinal }) {
  const step = MAINNET_V8_RELEASE_STEPS.find(entry => entry.ordinal === String(ordinal));
  if (!step || !NATIVE_SOUL_BOOTSTRAP_STAGES.includes(step.kind)) {
    fail('MAINNET_V8_READBACK_ORDINAL_INVALID', 'No native bootstrap predecessor inventory at this ordinal.');
  }
  const core = finalizedDetails(wal, 0).certificate.readback;
  if (core.role !== 'core') fail('MAINNET_V8_READBACK_PREDECESSOR_INVALID', 'Core publication predecessor is missing.');
  const objects = { protocol: nativeBootstrapHistoryEnvelope(core.protocolConfig),
    protocolAdmin: nativeBootstrapHistoryEnvelope(core.protocolAdminCap) };
  for (const previous of MAINNET_V8_RELEASE_STEPS) {
    if (previous.kind === 'PUBLISH') continue;
    if (Number(previous.ordinal) >= Number(step.ordinal)) break;
    const readback = finalizedDetails(wal, previous.ordinal).certificate.readback;
    if (readback.schema !== 'native-soul-bootstrap-history-v1' || readback.stage !== previous.kind
      || !plain(readback.objects)) {
      fail('MAINNET_V8_READBACK_PREDECESSOR_INVALID', 'Native bootstrap predecessor differs from the required stage.');
    }
    Object.assign(objects, readback.objects);
  }
  return Object.freeze(Object.fromEntries(nativeSoulBootstrapPriorKinds(step.kind).map(kind => {
    if (!objects[kind]) fail('MAINNET_V8_READBACK_PREDECESSOR_INVALID', `Missing ${kind} from certified native predecessors.`);
    return [kind, structuredClone(objects[kind])];
  })));
}

export async function certifyMainnetV8NativeBootstrap({ transport, stage, input, priorObjects, signer, finalityEvidence }) {
  // Freeze the whole certificate input before the first historical RPC await;
  // callers cannot swap event bytes while the exact objects are being loaded.
  const snapshot = structuredClone({ input, priorObjects, signer, finalityEvidence });
  const transactionBytes = fromBase64(snapshot.finalityEvidence.transactionBase64);
  const transactionDigest = digest(snapshot.finalityEvidence.digest, 'native bootstrap finality digest');
  if (TransactionDataBuilder.getDigestFromBytes(transactionBytes) !== transactionDigest) {
    fail('MAINNET_V8_READBACK_TRANSACTION_INVALID', 'Native bootstrap bytes differ from the finalized transaction digest.');
  }
  const result = await certifyNativeSoulBootstrapHistory({ stage, input: snapshot.input, sender: snapshot.signer,
    transactionBytes,
    effectsBytes: fromBase64(snapshot.finalityEvidence.effectsBcsBase64), priorObjects: snapshot.priorObjects,
    readHistoricalObject: async reference => {
      // No latest-object JSON lookup: delayed recovery must read the exact
      // version/digest selected by the finalized transaction's effects.
      const historical = await transport.getHistoricalObject({
        objectId: reference.objectId, version: BigInt(reference.version),
      });
      return nativeBootstrapHistoryEnvelope({
        reference: { objectId: historical.objectId, version: historical.version, digest: historical.digest },
        type: historical.type, owner: historical.owner, previousTransaction: historical.previousTransaction,
        objectBcsBase64: toBase64(historical.objectBcs),
      });
    },
  });
  if (result.history.effects.transactionDigest !== transactionDigest) {
    fail('MAINNET_V8_READBACK_TRANSACTION_INVALID', 'Native bootstrap history does not match the finalized transaction digest.');
  }
  const readback = Object.freeze({ schema: result.schema, stage, input: result.input,
    objects: result.objects, priorObjects: result.priorObjects, consensusObjects: result.consensusObjects });
  // Live certification and cold recovery accept exactly the same state,
  // commitment and event proof. A loaded object inventory alone is insufficient.
  return assertMainnetV8NativeBootstrapReadback(readback, stage, snapshot.finalityEvidence, snapshot.signer);
}

export async function certifyMainnetV8MarketActivation({ transport, input, priorObjects, signer, finalityEvidence }) {
  const frozenInput = structuredClone(input), frozenPrior = structuredClone(priorObjects);
  const transactionBytes = fromBase64(finalityEvidence.transactionBase64);
  const effectsBytes = fromBase64(finalityEvidence.effectsBcsBase64);
  const transactionDigest = digest(finalityEvidence.digest, 'market activation finality digest');
  if (TransactionDataBuilder.getDigestFromBytes(transactionBytes) !== transactionDigest) {
    fail('MAINNET_V8_READBACK_TRANSACTION_INVALID', 'Market activation bytes differ from the finalized digest.');
  }
  const args = { input: frozenInput, sender: signer, transactionBytes, effectsBytes, priorObjects: frozenPrior };
  const references = nativeSoulMarketActivationOutputReferences(args);
  const reads = await Promise.allSettled(Object.entries(references).map(async ([kind, reference]) => {
    const historical = await transport.getHistoricalObject({ objectId: reference.objectId, version: BigInt(reference.version) });
    return [kind, nativeBootstrapHistoryEnvelope({
      reference: { objectId: historical.objectId, version: historical.version, digest: historical.digest },
      type: historical.type, owner: historical.owner, previousTransaction: historical.previousTransaction,
      objectBcsBase64: toBase64(historical.objectBcs),
    })];
  }));
  const rejected = reads.find(row => row.status === 'rejected');
  if (rejected) throw rejected.reason;
  return validateNativeSoulMarketActivationHistory({ ...args,
    objects: Object.fromEntries(reads.map(row => row.value)) });
}

export async function certifyOrdinalReadback({ ordinal, wal, ready, client, transport, finalityEvidence }) {
  const step = MAINNET_V8_RELEASE_STEPS.find(entry => entry.ordinal === String(ordinal));
  if (step?.kind === 'PUBLISH') {
    const artifact = ready.readyArtifact.packageArtifact;
    const build = Object.freeze({
      packageArtifact: artifact,
      modules: Object.freeze(artifact.modules.map((module) => Object.freeze({
        name: module.name,
        base64: module.bytesBase64,
      }))),
    });
    return certifyMainnetV8PackagePublish({
      client,
      transport,
      role: step.role,
      build,
      finalityEvidence,
      signer: wal.plan.sender,
    });
  }
  if (step?.kind === 'ACTIVATE_SOULIDITY_MARKET') {
    if (ready.readyArtifact.kind !== step.kind) {
      fail('MAINNET_V8_READBACK_ORDINAL_INVALID', 'READY kind differs from market activation.');
    }
    return certifyMainnetV8MarketActivation({ transport,
      input: nativeSoulMarketActivationInputFromStageData(ready.readyArtifact.stageData),
      priorObjects: nativeSoulMarketActivationContextFromWal(wal).priorObjects,
      signer: wal.plan.sender, finalityEvidence });
  }
  if (step && NATIVE_SOUL_BOOTSTRAP_STAGES.includes(step.kind)) {
    if (ready.readyArtifact.kind !== step.kind) {
      fail('MAINNET_V8_READBACK_ORDINAL_INVALID', 'READY kind differs from the native readback stage.');
    }
    return certifyMainnetV8NativeBootstrap({
      transport, stage: step.kind,
      input: nativeSoulBootstrapInputFromStageData(step.kind, ready.readyArtifact.stageData),
      priorObjects: nativeSoulBootstrapPriorObjectsFromWal({ wal, ordinal }),
      signer: wal.plan.sender, finalityEvidence,
    });
  }
  fail('MAINNET_V8_READBACK_ORDINAL_INVALID', `Ordinal ${ordinal} has no transaction readback.`);
}

async function certifyPendingReadback({ paths, wal, client, transport, operations }) {
  const event = headEvent(wal);
  const { ready, signed } = signedContext(wal, event);
  const finalityEvidence = event.evidence.observation.details.finalityEvidence;
  const ordinal = Number(event.ordinal);
  let readback;
  try {
    readback = await operations.certifyReadback({
      ordinal,
      wal,
      ready,
      signed,
      client,
      transport,
      finalityEvidence,
    });
  } catch (error) {
    if (transientReadbackError(error)) {
      return Object.freeze({ wal, blocked: 'READBACK_RETRY_REQUIRED', error });
    }
    const incident = Object.freeze({
      code: String(error?.code ?? 'MAINNET_V8_READBACK_FAILED'),
      message: String(error?.message ?? error),
      details: canonicalizeSdk(error?.details ?? {}),
    });
    const observation = {
      finalityEvidence,
      finalityEvidenceSha256: mainnetV8JsonSha(finalityEvidence),
      incident,
      incidentSha256: mainnetV8JsonSha(incident),
    };
    const evidence = outcomeEvidenceFor({
      status: 'INCIDENT_STOPPED', event, ready, signed, observation,
    });
    const stopped = await appendAndColdRead(paths, wal, {
      ordinal: event.ordinal, attempt: event.attempt, status: 'INCIDENT_STOPPED', evidence,
    });
    return Object.freeze({ wal: stopped, blocked: 'INCIDENT_STOPPED', error });
  }
  const certificate = finalityCertificate(finalityEvidence, readback);
  const details = ordinal < MAINNET_V8_PUBLISH_ORDER.length
    ? {
        packageArtifact: ready.readyArtifact.packageArtifact,
        packageCommitment: ready.readyArtifact.packageCommitment,
        abiArtifact: readback.package.abiArtifact,
        abiCommitment: computeAbiCommitment(readback.package.abiArtifact),
        certificate,
        certificateSha256: mainnetV8JsonSha(certificate),
      }
    : { certificate, certificateSha256: mainnetV8JsonSha(certificate) };
  const evidence = outcomeEvidenceFor({
    status: 'FINALIZED_SUCCESS', event, ready, signed, observation: details,
  });
  const advanced = await appendAndColdRead(paths, wal, {
    ordinal: event.ordinal, attempt: event.attempt, status: 'FINALIZED_SUCCESS', evidence,
  });
  return Object.freeze({ wal: advanced, blocked: null, error: null });
}

function repairableReadbackIncident(event) {
  const step = MAINNET_V8_RELEASE_STEPS.find(entry => entry.ordinal === event?.ordinal);
  return event?.status === 'INCIDENT_STOPPED' && step !== undefined
    && step.kind !== 'VERIFY_AND_EXPORT'
    && MAINNET_V8_REPAIRABLE_READBACK_INCIDENTS.includes(event.evidence?.observation?.details?.incident?.code);
}

function pendingReadbackRepair(wal) {
  const event = headEvent(wal);
  const previous = wal.events.at(-2);
  return event?.status === 'FINALIZED_SUCCESS_PENDING_READBACK'
    && repairableReadbackIncident(previous)
    && previous.ordinal === event.ordinal
    && previous.attempt === event.attempt;
}

async function reopenReadbackIncident({ paths, wal }) {
  const event = headEvent(wal);
  if (!repairableReadbackIncident(event)) {
    fail(
      'MAINNET_V8_READBACK_INCIDENT_NOT_REPAIRABLE',
      'Only the exact known successful-effects output parser incident can be reopened.',
    );
  }
  const { ready, signed } = signedContext(wal, event);
  const finalityEvidence = event.evidence.observation.details.finalityEvidence;
  const observation = {
    finalityEvidence,
    finalityEvidenceSha256: mainnetV8JsonSha(finalityEvidence),
  };
  const evidence = outcomeEvidenceFor({
    status: 'FINALIZED_SUCCESS_PENDING_READBACK', event, ready, signed, observation,
  });
  return appendAndColdRead(paths, wal, {
    ordinal: event.ordinal,
    attempt: event.attempt,
    status: 'FINALIZED_SUCCESS_PENDING_READBACK',
    evidence,
  });
}

// Collect every publication, not the seven Catalog commitments. This is a
// projection of already-certified WAL evidence, not a standalone authorization.
export function mainnetV8FinalPackageRowsFromWal(wal) {
  if (!Array.isArray(wal?.plan?.packages)
    || wal.plan.packages.length !== MAINNET_V8_PUBLISH_ORDER.length) {
    fail('MAINNET_V8_FINAL_MANIFEST_INVALID', 'Final manifest requires all eight planned publications.');
  }
  return Object.freeze(MAINNET_V8_PUBLISH_ORDER.map((role, ordinal) => {
    const details = finalizedDetails(wal, ordinal);
    const certificate = details.certificate;
    const readback = certificate.readback;
    if (wal.plan.packages[ordinal].role !== role || readback.role !== role) {
      fail('MAINNET_V8_FINAL_MANIFEST_INVALID', `${role} final manifest evidence is at the wrong publication ordinal.`);
    }
    return Object.freeze({
      role,
      packageId: readback.package.reference.objectId,
      packageDigest: readback.package.reference.digest,
      packageVersion: readback.package.reference.version,
      upgradeCapId: readback.upgradeCap.reference.objectId,
      publishDigest: certificate.finalityEvidence.digest,
      sourceCommitment: wal.plan.packages[ordinal].sourceCommitment,
      packageCommitment: details.packageCommitment,
      abiCommitment: details.abiCommitment,
      finalityEvidenceSha256: certificate.finalityEvidenceSha256,
      readbackSha256: certificate.readbackSha256,
    });
  }));
}

function finalManifestFromWal(wal) {
  return buildFinalManifest({ plan: wal.plan, packages: mainnetV8FinalPackageRowsFromWal(wal) });
}

function typedNotFoundQuery({ signed, observedAt, afterWatermark = null }) {
  return Object.freeze({
    kind: 'TYPED_NOT_FOUND',
    code: 'NOT_FOUND',
    service: LEDGER_SERVICE,
    method: GET_TRANSACTION,
    digest: signed.signedArtifact.digest,
    signedArtifactSha256: signed.signedArtifactSha256,
    chainIdentifier: MAKER_V8_SUI_MAINNET_GENESIS_DIGEST,
    endpoint: new URL(MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT).href,
    observedAt,
    afterWatermark,
  });
}

function durableWatermark(value) {
  if (value?.chainIdentifier !== MAKER_V8_SUI_MAINNET_GENESIS_DIGEST) {
    fail('MAINNET_V8_WATERMARK_CHAIN_DRIFT', 'Checkpoint watermark is not Sui Mainnet.');
  }
  return Object.freeze({
    epoch: decimal(String(value.epoch), 'watermark.epoch'),
    checkpointSequence: decimal(String(value.checkpoint.sequenceNumber), 'watermark.checkpointSequence'),
    checkpointDigest: digest(value.checkpoint.digest, 'watermark.checkpointDigest'),
  });
}

function deterministicRpcError(error) {
  return Object.freeze({
    code: String(error?.code ?? 'MAINNET_V8_RPC_UNKNOWN'),
    message: String(error?.message ?? error),
    service: error?.serviceName == null ? null : String(error.serviceName),
    method: error?.methodName == null ? null : String(error.methodName),
    details: canonicalizeSdk(error?.details ?? {}),
  });
}

const MAINNET_V8_EXECUTION_DEPENDENCY_KEYS = Object.freeze([
  'inspectToolchain',
  'assertProtocolProfile',
  'assertReadyBuild',
  'assertReadyAuthority',
  'signExactTransaction',
  'verifySignedArtifact',
  'queryFinalizedOutcome',
  'broadcastExactTransaction',
  'getCheckpointWatermark',
  'certifyReadback',
  'verifyFinalPackages',
  'now',
]);

function mainnetV8ExecutionOperations(dependencies = {}) {
  if (!plain(dependencies)) {
    fail('MAINNET_V8_DEPENDENCIES_INVALID', 'Execution dependencies must be one plain record.');
  }
  const unknown = Object.keys(dependencies)
    .filter((key) => !MAINNET_V8_EXECUTION_DEPENDENCY_KEYS.includes(key));
  if (unknown.length > 0) {
    fail('MAINNET_V8_DEPENDENCIES_INVALID', 'Execution dependencies contain unsupported hooks.', {
      unknown,
    });
  }
  const operations = {
    inspectToolchain: dependencies.inspectToolchain ?? inspectMainnetV8Toolchain,
    assertProtocolProfile: dependencies.assertProtocolProfile ?? assertMainnetV8ProtocolProfile,
    assertReadyBuild: dependencies.assertReadyBuild ?? assertMainnetV8ReadyBuild,
    assertReadyAuthority:
      dependencies.assertReadyAuthority ?? assertMainnetV8StageReadyAuthority,
    signExactTransaction: dependencies.signExactTransaction ?? signExactMainnetV8Transaction,
    verifySignedArtifact:
      dependencies.verifySignedArtifact ?? verifyExactMainnetV8SignedArtifact,
    queryFinalizedOutcome: dependencies.queryFinalizedOutcome ?? queryFinalizedMainnetV8Outcome,
    broadcastExactTransaction:
      dependencies.broadcastExactTransaction ?? broadcastExactMainnetV8Transaction,
    getCheckpointWatermark: dependencies.getCheckpointWatermark
      ?? (async ({ transport }) => transport.getCheckpointWatermark()),
    certifyReadback: dependencies.certifyReadback ?? certifyOrdinalReadback,
    verifyFinalPackages: dependencies.verifyFinalPackages ?? verifyMainnetV8FinalPackages,
    now: dependencies.now ?? (() => new Date()),
  };
  for (const [key, value] of Object.entries(operations)) {
    if (typeof value !== 'function') {
      fail('MAINNET_V8_DEPENDENCIES_INVALID', `Execution dependency ${key} must be a function.`);
    }
  }
  return Object.freeze(operations);
}

function observedAt(operations, label) {
  const raw = operations.now();
  const value = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(value.valueOf())) {
    fail('MAINNET_V8_CLOCK_INVALID', `${label} clock returned an invalid instant.`);
  }
  return value.toISOString();
}

async function appendOutcomeUnknown({ paths, wal, error }) {
  const event = headEvent(wal);
  const { ready, signed } = signedContext(wal, event);
  const record = deterministicRpcError(error);
  const observation = { error: record, errorSha256: mainnetV8JsonSha(record) };
  const evidence = outcomeEvidenceFor({
    status: 'OUTCOME_UNKNOWN', event, ready, signed, observation,
  });
  return appendAndColdRead(paths, wal, {
    ordinal: event.ordinal, attempt: event.attempt, status: 'OUTCOME_UNKNOWN', evidence,
  });
}

async function resolveQueryIntent({ paths, wal, client, transport, operations }) {
  const event = headEvent(wal);
  const { ready, signed } = signedContext(wal, event);
  await operations.verifySignedArtifact(signed.signedArtifact);
  await assertMainnetV8TransactionMatchesReady({
    ordinal: event.ordinal,
    plan: wal.plan,
    readyArtifact: ready.readyArtifact,
    unsignedEnvelope: ready.unsignedEnvelope,
  });
  let first;
  try {
    first = await operations.queryFinalizedOutcome({
      client, transport, digest: signed.signedArtifact.digest,
      signedArtifact: signed.signedArtifact,
    });
  } catch (error) {
    return Object.freeze({ wal: await appendOutcomeUnknown({ paths, wal, error }), blocked: 'QUERY_RETRY_REQUIRED' });
  }
  if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(first.status)) {
    return Object.freeze({ wal: await appendFinalityObservation({ paths, wal, outcome: first }), blocked: null });
  }
  if (first.status === 'FINALITY_EVIDENCE_UNAVAILABLE') {
    return Object.freeze({
      wal: await appendOutcomeUnknown({ paths, wal, error: first.error }),
      blocked: 'FINALITY_EVIDENCE_RETRY_REQUIRED',
    });
  }
  if (first.status !== 'NOT_FOUND') {
    return Object.freeze({
      wal: await appendOutcomeUnknown({
        paths, wal,
        error: new MainnetV8ReleaseError('MAINNET_V8_QUERY_STATUS_UNKNOWN', `Unknown query status ${first.status}.`),
      }),
      blocked: 'QUERY_RETRY_REQUIRED',
    });
  }
  const firstObservedAt = observedAt(operations, 'first NOT_FOUND observation');
  const watermarkRaw = await operations.getCheckpointWatermark({ transport, wal, event });
  const watermark = durableWatermark(watermarkRaw);
  let second;
  try {
    second = await operations.queryFinalizedOutcome({
      client, transport, digest: signed.signedArtifact.digest,
      signedArtifact: signed.signedArtifact,
    });
  } catch (error) {
    return Object.freeze({ wal: await appendOutcomeUnknown({ paths, wal, error }), blocked: 'QUERY_RETRY_REQUIRED' });
  }
  if (['FINALIZED_SUCCESS', 'FINALIZED_FAILURE'].includes(second.status)) {
    return Object.freeze({ wal: await appendFinalityObservation({ paths, wal, outcome: second }), blocked: null });
  }
  if (second.status !== 'NOT_FOUND') {
    return Object.freeze({
      wal: await appendOutcomeUnknown({ paths, wal, error: second.error ?? {
        code: 'MAINNET_V8_SECOND_QUERY_UNKNOWN', status: second.status,
      } }),
      blocked: 'QUERY_RETRY_REQUIRED',
    });
  }
  const firstTime = new Date(firstObservedAt).valueOf();
  const observedSecond = new Date(observedAt(operations, 'second NOT_FOUND observation')).valueOf();
  const secondObservedAt = new Date(Math.max(observedSecond, firstTime + 1)).toISOString();
  const firstQuery = typedNotFoundQuery({ signed, observedAt: firstObservedAt });
  const secondQuery = typedNotFoundQuery({ signed, observedAt: secondObservedAt, afterWatermark: watermark });
  const hydrated = hydrateMainnetV8UnsignedEnvelope(ready.unsignedEnvelope);
  const expiration = hydrated.expiration.ValidDuring;
  if (BigInt(watermark.epoch) > BigInt(expiration.maxEpoch)) {
    const record = Object.freeze({
      kind: 'EXPIRED_NOT_FOUND',
      digest: signed.signedArtifact.digest,
      firstQuery,
      watermark,
      secondQuery,
      expiration: hydrated.expiration,
    });
    const observation = { expiration: record, expirationSha256: mainnetV8JsonSha(record) };
    const evidence = outcomeEvidenceFor({
      status: 'EXPIRED_NOT_FOUND', event, ready, signed, observation,
    });
    return Object.freeze({
      wal: await appendAndColdRead(paths, wal, {
        ordinal: event.ordinal, attempt: event.attempt, status: 'EXPIRED_NOT_FOUND', evidence,
      }),
      blocked: 'EXPIRED_NOT_FOUND',
    });
  }
  const observation = {
    kind: 'BROADCAST_INTENT',
    details: {
      firstQuery,
      firstQuerySha256: mainnetV8JsonSha(firstQuery),
      watermark,
      secondQuery,
      secondQuerySha256: mainnetV8JsonSha(secondQuery),
    },
  };
  const evidence = outcomeEvidenceFor({
    status: 'OUTCOME_PENDING', event, ready, signed, observation,
  });
  const broadcastIntentWal = await appendAndColdRead(paths, wal, {
    ordinal: event.ordinal, attempt: event.attempt, status: 'OUTCOME_PENDING', evidence,
  });
  // The only path that may submit is the same invocation that just durably
  // wrote and cold-read this intent. A process that resumes from this record
  // must query again before it can obtain a fresh submission intent.
  return executeBroadcastIntent({
    paths,
    wal: broadcastIntentWal,
    client,
    operations,
  });
}

async function executeBroadcastIntent({ paths, wal, client, operations }) {
  const event = headEvent(wal);
  const { ready, signed } = signedContext(wal, event);
  const hydrated = hydrateMainnetV8UnsignedEnvelope(ready.unsignedEnvelope);
  await operations.verifySignedArtifact(signed.signedArtifact);
  await assertMainnetV8TransactionMatchesReady({
    ordinal: event.ordinal, plan: wal.plan,
    readyArtifact: ready.readyArtifact, unsignedEnvelope: ready.unsignedEnvelope,
  });
  const profile = await operations.assertProtocolProfile(client);
  if (profile.epoch !== ready.readyArtifact.protocolProfile.epoch
    || profile.gasPrice !== hydrated.gasPrice
    || BigInt(profile.epoch) > BigInt(hydrated.expiration.ValidDuring.maxEpoch)) {
    return Object.freeze({
      wal: await appendOutcomeUnknown({
        paths, wal,
        error: new MainnetV8ReleaseError(
          'MAINNET_V8_BROADCAST_PROFILE_DRIFT',
          'Live protocol/gas/epoch drifted after NOT_FOUND proof; exact bytes remain query-only.',
        ),
      }),
      blocked: 'QUERY_ONLY_PROFILE_DRIFT',
    });
  }
  try {
    const response = await operations.broadcastExactTransaction({
      client, signedArtifact: signed.signedArtifact,
    });
    const observation = { response, responseSha256: mainnetV8JsonSha(response) };
    const evidence = outcomeEvidenceFor({
      status: 'BROADCAST_ACCEPTED', event, ready, signed, observation,
    });
    return Object.freeze({
      wal: await appendAndColdRead(paths, wal, {
        ordinal: event.ordinal, attempt: event.attempt, status: 'BROADCAST_ACCEPTED', evidence,
      }),
      blocked: null,
    });
  } catch (error) {
    return Object.freeze({
      wal: await appendOutcomeUnknown({ paths, wal, error }),
      blocked: 'BROADCAST_OUTCOME_UNKNOWN',
    });
  }
}

async function appendQueryIntent({ paths, wal, operations }) {
  const event = headEvent(wal);
  const { ready, signed } = signedContext(wal, event);
  await operations.verifySignedArtifact(signed.signedArtifact);
  await assertMainnetV8TransactionMatchesReady({
    ordinal: event.ordinal, plan: wal.plan,
    readyArtifact: ready.readyArtifact, unsignedEnvelope: ready.unsignedEnvelope,
  });
  const evidence = outcomeEvidenceFor({
    status: 'OUTCOME_PENDING',
    event,
    ready,
    signed,
    observation: { kind: 'QUERY_INTENT', details: {} },
  });
  return appendAndColdRead(paths, wal, {
    ordinal: event.ordinal, attempt: event.attempt, status: 'OUTCOME_PENDING', evidence,
  });
}

async function signReadyTransaction({
  paths,
  wal,
  suiBinary,
  client,
  transport,
  operations,
  repositoryRoot = REPOSITORY_ROOT,
}) {
  const event = headEvent(wal);
  const ready = event.evidence;
  assertMainnetV8ReadyWalContext({
    wal,
    ordinal: event.ordinal,
    readyArtifact: ready.readyArtifact,
  });
  const liveProfile = await operations.assertProtocolProfile(client);
  if (canonicalJson(liveProfile) !== canonicalJson(ready.readyArtifact.protocolProfile)) {
    fail('MAINNET_V8_SIGNING_PROFILE_DRIFT', 'Live Mainnet profile differs from the frozen READY preflight.');
  }
  await assertMainnetV8TransactionMatchesReady({
    ordinal: event.ordinal, plan: wal.plan,
    readyArtifact: ready.readyArtifact, unsignedEnvelope: ready.unsignedEnvelope,
  });
  await operations.assertReadyBuild({ paths, wal, event, suiBinary, repositoryRoot });
  await operations.assertReadyAuthority({ wal, event, transport });
  const signingToolchain = await operations.inspectToolchain({ suiBinary });
  if (signingToolchain.suiVersion !== wal.plan.toolchain.suiVersion
    || signingToolchain.suiVersionOutput !== wal.plan.toolchain.suiVersionOutput
    || signingToolchain.suiSourceCommit !== wal.plan.toolchain.suiSourceCommit
    || signingToolchain.suiBinarySha256 !== wal.plan.toolchain.suiBinarySha256
    || signingToolchain.frameworkRevision !== wal.plan.toolchain.frameworkRevision) {
    fail('MAINNET_V8_TOOLCHAIN_DRIFT', 'Signing toolchain differs from the immutable release plan.');
  }
  const envelope = hydrateMainnetV8UnsignedEnvelope(ready.unsignedEnvelope);
  const signedArtifact = await operations.signExactTransaction({
    suiBinary, sender: wal.plan.sender, envelope,
  });
  await operations.verifySignedArtifact(signedArtifact);
  const evidence = buildMainnetV8SignedEvidence({
    ordinal: event.ordinal,
    attempt: event.attempt,
    readyArtifactSha256: ready.readyArtifactSha256,
    signedArtifact,
  });
  const signedWal = await appendAndColdRead(paths, wal, {
    ordinal: event.ordinal, attempt: event.attempt, status: 'SIGNED', evidence,
  });
  const coldSigned = cursorEvidence(signedWal, event.ordinal, event.attempt, 'SIGNED');
  await operations.verifySignedArtifact(coldSigned.signedArtifact);
  await assertMainnetV8TransactionMatchesReady({
    ordinal: event.ordinal, plan: signedWal.plan,
    readyArtifact: ready.readyArtifact, unsignedEnvelope: ready.unsignedEnvelope,
  });
  return signedWal;
}

async function sealFinalManifest({ paths, wal }) {
  const finalManifest = finalManifestFromWal(wal);
  const ordinal = String(MAINNET_V8_PUBLISH_ORDER.length - 1);
  const evidence = buildMainnetV8ManifestEvidence({
    ordinal, attempt: '0', finalManifest, plan: wal.plan,
  });
  return appendAndColdRead(paths, wal, {
    ordinal, attempt: '0', status: 'FINAL_MANIFEST_SEALED', evidence,
  });
}

function releaseCertificateFromWal(wal) {
  const event = headEvent(wal);
  if (MAINNET_V8_RELEASE_STEPS.find(step => step.ordinal === event.ordinal)?.kind !== 'VERIFY_AND_EXPORT'
    || event.status !== 'FINALIZED_SUCCESS'
    || wal.releaseId === null || wal.finalManifest?.releaseId !== wal.releaseId) {
    fail('MAINNET_V8_RELEASE_CERTIFICATE_INVALID', 'Release certificate requires the exact completed WAL head.');
  }
  return Object.freeze({
    schemaVersion: MAINNET_V8_RELEASE_RUNNER_SCHEMA,
    kind: 'CHAIN_RELEASE_COMPLETE',
    executionPlanId: wal.executionPlanId,
    releaseId: wal.releaseId,
    executionPlan: wal.plan,
    finalManifest: wal.finalManifest,
    packagePublishes: Object.freeze(MAINNET_V8_PUBLISH_ORDER.map((role, ordinal) => Object.freeze({
      role,
      finalized: finalizedDetails(wal, ordinal),
    }))),
    bootstrapStages: Object.freeze(MAINNET_V8_RELEASE_STEPS
      .filter(step => NATIVE_SOUL_BOOTSTRAP_STAGES.includes(step.kind))
      .map(step => Object.freeze({ stage: step.kind, ordinal: step.ordinal,
        finalized: finalizedDetails(wal, step.ordinal) }))),
    marketActivation: finalizedDetails(wal,
      MAINNET_V8_RELEASE_STEPS.find(row => row.kind === 'ACTIVATE_SOULIDITY_MARKET').ordinal),
    verifyAndExport: event.evidence.observation.details,
  });
}

async function ensureReleaseCertificate(paths, wal) {
  const expected = releaseCertificateFromWal(wal);
  let observed = null;
  try {
    observed = JSON.parse(await fsp.readFile(paths.releaseCertificate, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (observed === null || canonicalJson(observed) !== canonicalJson(expected)) {
    await writeJsonAtomic(paths.releaseCertificate, expected);
  }
  const cold = JSON.parse(await fsp.readFile(paths.releaseCertificate, 'utf8'));
  if (canonicalJson(cold) !== canonicalJson(expected)) {
    fail('MAINNET_V8_RELEASE_CERTIFICATE_DRIFT', 'Cold-read release certificate differs from completed WAL.');
  }
  return expected;
}

async function verifyOnlyOrdinal({
  paths,
  wal,
  client,
  transport,
  suiBinary,
  repositoryRoot,
  operations,
}) {
  const event = headEvent(wal);
  assertMainnetV8ReadyWalContext({
    wal,
    ordinal: event.ordinal,
    readyArtifact: event.evidence.readyArtifact,
  });
  const certificate = await performVerifyAndExport({
    paths,
    wal,
    client,
    transport,
    suiBinary,
    repositoryRoot,
    operations,
  });
  const evidence = buildMainnetV8OutcomeEvidence({
    status: 'FINALIZED_SUCCESS',
    ordinal: event.ordinal,
    attempt: event.attempt,
    readyArtifactSha256: event.evidence.readyArtifactSha256,
    signedArtifact: null,
    signedArtifactSha256: null,
    digest: null,
    observation: {
      certificate,
      certificateSha256: mainnetV8JsonSha(certificate),
    },
  });
  const complete = await appendAndColdRead(paths, wal, {
    ordinal: event.ordinal, attempt: event.attempt, status: 'FINALIZED_SUCCESS', evidence,
  });
  await ensureReleaseCertificate(paths, complete);
  return complete;
}

export function nextMainnetV8FinalizedAction(event) {
  const index = MAINNET_V8_RELEASE_STEPS.findIndex(step => step.ordinal === event?.ordinal);
  if (index < 0 || !['FINALIZED_SUCCESS', 'FINAL_MANIFEST_SEALED'].includes(event.status)) {
    fail('MAINNET_V8_WAL_STATE_UNHANDLED', 'No finalized-stage action for this cursor.');
  }
  const step = MAINNET_V8_RELEASE_STEPS[index];
  const next = MAINNET_V8_RELEASE_STEPS[index + 1];
  const lastPublish = step.kind === 'PUBLISH' && next?.kind !== 'PUBLISH';
  if (event.status === 'FINAL_MANIFEST_SEALED' && !lastPublish) {
    fail('MAINNET_V8_WAL_STATE_UNHANDLED', 'Manifest can only be sealed after the final publication.');
  }
  if (lastPublish && event.status === 'FINALIZED_SUCCESS') return Object.freeze({ kind: 'SEAL_MANIFEST' });
  if (!next) return Object.freeze({ kind: 'COMPLETE' });
  if (next.kind === 'PUBLISH') return Object.freeze({ kind: 'PREPARE_PUBLISH', ordinal: Number(next.ordinal) });
  if (next.kind === 'VERIFY_AND_EXPORT') return Object.freeze({ kind: 'PREPARE_VERIFY' });
  if (next.kind === 'ACTIVATE_SOULIDITY_MARKET') return Object.freeze({ kind: 'PREPARE_MARKET_ACTIVATION' });
  return Object.freeze({ kind: 'PREPARE_BOOTSTRAP', stage: next.kind });
}

export async function executeMainnetV8Release({
  repositoryRoot = REPOSITORY_ROOT,
  stateDir,
  suiBinary,
  expectedExecutionPlanId,
  expectedReleaseId = null,
  client = new SuiGrpcClient({ network: 'mainnet', baseUrl: MAKER_V8_SUI_GRPC_MAINNET_ENDPOINT }),
  transport = createProductionMakerV8SuiGrpcTransport(),
  maximumTransitions = 128,
  repairReadbackIncident = false,
  dependencies = {},
}) {
  if (!Number.isSafeInteger(maximumTransitions) || maximumTransitions < 1 || maximumTransitions > 10_000) {
    fail('MAINNET_V8_TRANSITION_LIMIT_INVALID', 'maximumTransitions must be a bounded positive integer.');
  }
  const paths = mainnetV8ReleasePaths(stateDir);
  const operations = mainnetV8ExecutionOperations(dependencies);
  let wal = await readReleaseWal({ path: paths.wal });
  const planFile = JSON.parse(await fsp.readFile(paths.plan, 'utf8'));
  assertReleasePlan(planFile);
  if (canonicalJson(planFile) !== canonicalJson(wal.plan)) {
    fail('MAINNET_V8_PLAN_FILE_DRIFT', 'Release plan file differs from durable WAL plan.');
  }
  const approvedExecutionPlanId = hash32(
    expectedExecutionPlanId,
    'expectedExecutionPlanId',
  );
  if (approvedExecutionPlanId !== wal.executionPlanId
    || approvedExecutionPlanId !== computeExecutionPlanId(wal.plan)) {
    fail(
      'MAINNET_V8_EXECUTION_PLAN_NOT_APPROVED',
      'Cold WAL/plan identity differs from the explicitly approved executionPlanId.',
    );
  }
  if (wal.releaseId === null) {
    if (expectedReleaseId !== null) {
      fail(
        'MAINNET_V8_RELEASE_ID_PREMATURE',
        'A releaseId cannot be approved before the eight-package final manifest is sealed.',
      );
    }
  } else {
    const approvedReleaseId = hash32(expectedReleaseId, 'expectedReleaseId');
    if (!wal.finalManifest || wal.finalManifest.releaseId !== wal.releaseId
      || approvedReleaseId !== wal.releaseId) {
      fail(
        'MAINNET_V8_RELEASE_ID_NOT_APPROVED',
        'Cold final manifest differs from the explicitly approved releaseId.',
      );
    }
  }
  const approvedHead = headEvent(wal);
  if (approvedHead.status === 'RELEASE_ABANDONED') {
    return Object.freeze({ status: 'RELEASE_ABANDONED', wal, writesComplete: false });
  }
  const toolchain = await operations.inspectToolchain({ suiBinary });
  if (toolchain.suiVersion !== wal.plan.toolchain.suiVersion
    || toolchain.suiVersionOutput !== wal.plan.toolchain.suiVersionOutput
    || toolchain.suiSourceCommit !== wal.plan.toolchain.suiSourceCommit
    || toolchain.suiBinarySha256 !== wal.plan.toolchain.suiBinarySha256
    || toolchain.frameworkRevision !== wal.plan.toolchain.frameworkRevision) {
    fail('MAINNET_V8_TOOLCHAIN_DRIFT', 'Resume toolchain differs from the immutable release plan.');
  }
  const initialEvent = approvedHead;
  if (repairReadbackIncident !== false
    && (repairReadbackIncident !== true
      || !(repairableReadbackIncident(initialEvent) || pendingReadbackRepair(wal)))) {
    fail(
      'MAINNET_V8_READBACK_INCIDENT_NOT_REPAIRABLE',
      'Readback repair requires the exact durable parser incident or its reopened pending state.',
    );
  }
  for (let transition = 0; transition < maximumTransitions; transition += 1) {
    const event = headEvent(wal);
    const ordinal = Number(event.ordinal);
    if (event.status === 'INCIDENT_STOPPED' && repairReadbackIncident === true) {
      wal = await reopenReadbackIncident({ paths, wal });
      continue;
    }
    if (['FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND', 'INCIDENT_STOPPED', 'RELEASE_ABANDONED']
      .includes(event.status)) {
      return Object.freeze({ status: event.status, wal, writesComplete: false });
    }
    if (event.status === 'READY') {
      if (MAINNET_V8_RELEASE_STEPS.find(step => step.ordinal === event.ordinal)?.kind === 'VERIFY_AND_EXPORT') {
        wal = await verifyOnlyOrdinal({
          paths,
          wal,
          client,
          transport,
          suiBinary,
          repositoryRoot,
          operations,
        });
        continue;
      }
      wal = await signReadyTransaction({
        paths, wal, suiBinary, client, transport, operations, repositoryRoot,
      });
      continue;
    }
    if (event.status === 'SIGNED'
      || event.status === 'BROADCAST_ACCEPTED'
      || event.status === 'OUTCOME_UNKNOWN') {
      wal = await appendQueryIntent({ paths, wal, operations });
      continue;
    }
    if (event.status === 'OUTCOME_PENDING') {
      if (event.evidence.observation.kind === 'QUERY_INTENT') {
        const resolved = await resolveQueryIntent({ paths, wal, client, transport, operations });
        wal = resolved.wal;
        if (resolved.blocked) {
          return Object.freeze({ status: resolved.blocked, wal, writesComplete: false });
        }
        continue;
      }
      if (event.evidence.observation.kind === 'BROADCAST_INTENT') {
        // This is necessarily a crash/restart boundary: a live query path
        // submits immediately after it writes the intent. Re-enter query-first
        // instead of replaying an intent whose earlier RPC outcome is unknown.
        wal = await appendQueryIntent({ paths, wal, operations });
        continue;
      }
      fail('MAINNET_V8_WAL_INVALID', 'OUTCOME_PENDING has an unsupported durable intent.');
    }
    if (event.status === 'FINALIZED_SUCCESS_PENDING_READBACK') {
      const certified = await certifyPendingReadback({
        paths, wal, client, transport, operations,
      });
      wal = certified.wal;
      if (certified.blocked) {
        return Object.freeze({ status: certified.blocked, wal, writesComplete: false });
      }
      if (repairReadbackIncident === true) {
        return Object.freeze({
          status: 'READBACK_REPAIR_COMPLETE',
          wal,
          writesComplete: false,
        });
      }
      continue;
    }
    if (event.status === 'FINALIZED_SUCCESS' || event.status === 'FINAL_MANIFEST_SEALED') {
      const action = nextMainnetV8FinalizedAction(event);
      if (action.kind === 'PREPARE_PUBLISH') {
        wal = await preparePublishReady({
          paths,
          wal,
          ordinal: action.ordinal,
          suiBinary,
          client,
          repositoryRoot,
        });
      } else if (action.kind === 'SEAL_MANIFEST') {
        wal = await sealFinalManifest({ paths, wal });
        return Object.freeze({
          status: 'FINAL_MANIFEST_REVIEW_REQUIRED',
          wal,
          writesComplete: false,
        });
      } else if (action.kind === 'PREPARE_BOOTSTRAP') {
        wal = await prepareMainnetV8StageReady({ paths, wal, stage: action.stage, client, transport });
      } else if (action.kind === 'PREPARE_MARKET_ACTIVATION') {
        wal = await prepareMainnetV8StageReady({ paths, wal, stage: 'ACTIVATE_SOULIDITY_MARKET', client, transport });
      } else if (action.kind === 'PREPARE_VERIFY') {
        wal = await prepareVerifyReady({ paths, wal, client });
      } else if (action.kind === 'COMPLETE') {
        await ensureReleaseCertificate(paths, wal);
        return Object.freeze({ status: 'CHAIN_RELEASE_COMPLETE', wal, writesComplete: true });
      }
      continue;
    }
    fail('MAINNET_V8_WAL_STATE_UNHANDLED', `Unhandled durable state ${event.status}.`);
  }
  return Object.freeze({ status: 'TRANSITION_LIMIT_REACHED', wal, writesComplete: false });
}

export async function abandonMainnetV8Release({
  stateDir,
  expectedExecutionPlanId,
  expectedReleaseId,
  reasonCode,
}) {
  const paths = mainnetV8ReleasePaths(stateDir);
  const approvedExecutionPlanId = hash32(
    expectedExecutionPlanId, 'abandon expectedExecutionPlanId',
  );
  const approvedReleaseId = hash32(expectedReleaseId, 'abandon expectedReleaseId');
  if (reasonCode !== 'PROTOCOL_INIT_PAYMENT_COIN_TYPE_MISMATCH') {
    fail('MAINNET_V8_ABANDON_REASON_INVALID', 'Only the reviewed pre-sign protocol-init incident can abandon this release.');
  }
  const wal = await readReleaseWal({ path: paths.wal });
  if (wal.executionPlanId !== approvedExecutionPlanId) {
    fail('MAINNET_V8_EXECUTION_PLAN_NOT_APPROVED', 'Release abandonment differs from the externally approved executionPlanId.');
  }
  if (wal.releaseId !== approvedReleaseId) {
    fail('MAINNET_V8_RELEASE_ID_NOT_APPROVED', 'Release abandonment differs from the externally approved releaseId.');
  }
  const head = headEvent(wal);
  const initialization = MAINNET_V8_RELEASE_STEPS.find(step => step.kind === 'INITIALIZE_PROTOCOL');
  const action = head.status === 'FINAL_MANIFEST_SEALED' ? nextMainnetV8FinalizedAction(head) : null;
  if (action?.kind !== 'PREPARE_BOOTSTRAP' || action.stage !== initialization.kind) {
    fail('MAINNET_V8_ABANDON_STATE_INVALID', 'Only a sealed, pre-init release may be abandoned by this incident path.');
  }
  const core = wal.finalManifest.packages.find((entry) => entry.role === 'core');
  if (!core) fail('MAINNET_V8_WAL_INVALID', 'Sealed manifest has no Core package.');
  const evidence = buildMainnetV8AbandonEvidence({
    ordinal: head.ordinal,
    attempt: head.attempt,
    finalManifest: wal.finalManifest,
    plan: wal.plan,
    reason: {
      code: reasonCode,
      failedOrdinal: initialization.ordinal,
      errorCode: 'MAINNET_V8_SIMULATION_FAILED',
      moveAbort: {
        packageId: core.packageId,
        module: 'protocol_config_v8',
        function: 'initialize_protocol_treasury_v8',
        abortCode: '3',
      },
    },
  });
  const abandoned = await appendAndColdRead(paths, wal, {
    ordinal: head.ordinal,
    attempt: head.attempt,
    status: 'RELEASE_ABANDONED',
    evidence,
  });
  return Object.freeze({ status: 'RELEASE_ABANDONED', wal: abandoned, writesComplete: false });
}

export function assertMainnetV8WriteGates(options) {
  if (options['confirm-mainnet'] !== true || options['allow-signing'] !== true
    || options['allow-broadcast'] !== true) {
    fail(
      'MAINNET_V8_EXECUTION_DISABLED',
      'Mainnet signing/broadcast requires --confirm-mainnet --allow-signing --allow-broadcast together.',
    );
  }
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseMainnetV8ReleaseArgs(argv);
  if (options.help === true) {
    printUsage();
    return;
  }
  const stateDir = options['state-dir'] && path.resolve(options['state-dir']);
  if (!stateDir) fail('MAINNET_V8_STATE_REQUIRED', '--state-dir is required.');
  if (command === 'status') {
    const wal = await readReleaseWal({ path: path.join(stateDir, MAINNET_V8_WAL_FILENAME) });
    process.stdout.write(`${JSON.stringify(wal, null, 2)}\n`);
    return;
  }
  if (command === 'prepare') {
    const sealPolicy = await loadSealPolicy(options);
    const prepared = await prepareMainnetV8Release({
      stateDir,
      soulidityRoot: options['soulidity-root'] && path.resolve(options['soulidity-root']),
      suiBinary: options['sui-binary'],
      sender: options.sender,
      sealPolicy,
    });
    process.stdout.write(`${JSON.stringify({
      status: 'PREPARED',
      writes: 0,
      stateDir: prepared.stateDir,
      executionPlanId: prepared.executionPlanId,
      signer: prepared.plan.sender,
      chainIdentifier: prepared.plan.chain.chainIdentifier,
    }, null, 2)}\n`);
    return;
  }
  if (command === 'abandon') {
    const result = await abandonMainnetV8Release({
      stateDir,
      expectedExecutionPlanId: options['execution-plan-id'],
      expectedReleaseId: options['release-id'],
      reasonCode: options['reason-code'],
    });
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      writes: 0,
      revision: result.wal.revision,
      executionPlanId: result.wal.executionPlanId,
      releaseId: result.wal.releaseId,
    }, null, 2)}\n`);
    return;
  }
  if (['run', 'resume'].includes(command)) {
    assertMainnetV8WriteGates(options);
    if (typeof options['sui-binary'] !== 'string') {
      fail('MAINNET_V8_SUI_BINARY_REQUIRED', '--sui-binary is required for signing/resume.');
    }
    const result = await executeMainnetV8Release({
      stateDir,
      suiBinary: options['sui-binary'],
      expectedExecutionPlanId: options['execution-plan-id'],
      expectedReleaseId: options['release-id'] ?? null,
      repairReadbackIncident: options['repair-readback-incident'] === true,
      maximumTransitions: options['maximum-transitions'] === undefined
        ? 128
        : Number(options['maximum-transitions']),
    });
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      writesComplete: result.writesComplete,
      revision: result.wal.revision,
      ordinal: result.wal.events.at(-1).ordinal,
      durableState: result.wal.events.at(-1).status,
      executionPlanId: result.wal.executionPlanId,
      releaseId: result.wal.releaseId,
    }, null, 2)}\n`);
    if (!result.writesComplete && ![
      'QUERY_RETRY_REQUIRED', 'FINALITY_EVIDENCE_RETRY_REQUIRED',
      'READBACK_RETRY_REQUIRED', 'BROADCAST_OUTCOME_UNKNOWN',
      'QUERY_ONLY_PROFILE_DRIFT', 'TRANSITION_LIMIT_REACHED',
      'FINAL_MANIFEST_REVIEW_REQUIRED', 'READBACK_REPAIR_COMPLETE',
    ].includes(result.status)) process.exitCode = 2;
    return;
  }
  if (command === 'verify') {
    const wal = await readReleaseWal({ path: path.join(stateDir, MAINNET_V8_WAL_FILENAME) });
    const complete = headEvent(wal).status === 'FINALIZED_SUCCESS'
      && nextMainnetV8FinalizedAction(headEvent(wal)).kind === 'COMPLETE';
    process.stdout.write(`${JSON.stringify({
      status: complete ? 'CHAIN_RELEASE_COMPLETE' : 'INCOMPLETE',
      executionPlanId: wal.executionPlanId,
      releaseId: wal.releaseId,
      revision: wal.revision,
    }, null, 2)}\n`);
    if (!complete) process.exitCode = 2;
    return;
  }
  if (command === 'export-config') {
    const content = await readMainnetV8DeploymentConfig({ stateDir, format: options.format ?? 'json' });
    process.stdout.write(content);
    return;
  }
  fail('MAINNET_V8_COMMAND_NOT_IMPLEMENTED', `${command} is not implemented yet.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const output = {
      status: 'FAILED',
      code: error?.code ?? 'MAINNET_V8_RELEASE_FAILED',
      message: String(error?.message ?? error),
      details: error?.details ?? null,
    };
    process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  });
}
